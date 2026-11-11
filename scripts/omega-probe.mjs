// Campaign clear probe (The Omega Works vs a flat reference arena):
//   node scripts/omega-probe.mjs [--arenas 5,4] [--plows classic,volt,brute,isotope,arsenal] [--tiers fresh,mid,high]
//                                [--runs 2] [--par 2] [--cap 240] [--out DIR] [--resume] [--report-only]
// An autopilot plays a full campaign arena (all rounds + the boss) with a chosen plow at a chosen upgrade tier and logs
// per round: clear time (s), HP lost, deaths (the plow is revived in place and the death counted), damage dealt by
// source (basic = rams / slams / whirls / dash, air = stomps / air slams, F, ult, passive auras; ARSENAL: laser /
// shotgun / repulsor / burst / singularity), the share of bot-time spent on another level than the player (|dy| > 2 m), time stuck
// (moving < 1 m/s while throttling for > 1 s; "free" = no bot within 6 m, i.e. not a shoving match) and the boss fight
// length. Each round is capped at --cap s (then force-cleared and flagged).
// Tiers mirror scripts/balance/sim.ts levelsFor: LINE / TIER_DEF / the core four are read out of sim.ts at start-up
// and rebuilt in the page through the progression API (garage levels + owned / equipped gear).
// The autopilot drives at the nearest living bot (through ctx.enemies.nav waypoints when it is on another level, as the
// bots route), plows snow on the way, uses every ability on cooldown (legend-probe style), fires the ultimate when the
// meter is full, and on ARSENAL holds the Mag Shotgun, fires the Mag Repulsor and Polarity Burst on cooldown.
// The sim runs with window.__game.tick(1/60) (no render loop). Vite runs with HMR off, so edits other agents make to
// src/ while a run is going don't reload the page (each run loads the current source).
// Output: DIR/runs.jsonl (one line per run, appended), DIR/summary.json and DIR/summary.md (aggregated tables).
// Chromium: PW_EXE (default /opt/pw-browsers/chromium if it exists, else the 'chrome' channel).
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);
const ARENAS = opt('arenas', '5,4').split(',').map(Number);
const PLOWS = opt('plows', 'classic,volt,brute,isotope,arsenal').split(',');
const TIERS = opt('tiers', 'fresh,mid,high').split(',');
const RUNS = Number(opt('runs', '2'));
const PAR = Number(opt('par', '2'));
const CAP = Number(opt('cap', '240'));
/** --hard: play each arena's Hard mode (the arena's normal clear is granted first, Hard needs it). */
const HARD = flag('hard');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = opt('out', resolve(root, 'omega-probe-out'));
mkdirSync(OUT, { recursive: true });
const RUNS_FILE = `${OUT}/runs.jsonl`;

/* ------------------------------------------------------------------ tiers, read out of scripts/balance/sim.ts */
function readTierDefs() {
  const src = readFileSync(resolve(root, 'scripts/balance/sim.ts'), 'utf8');
  const grab = (re, what) => {
    const m = src.match(re);
    if (!m) throw new Error(`omega-probe: could not find ${what} in scripts/balance/sim.ts`);
    return new Function(`return (${m[1]});`)();
  };
  const LINE = grab(/const LINE\b[^=]*=\s*(\{[\s\S]*?\n\});/, 'LINE');
  const TIER_DEF = grab(/const TIER_DEF\b[^=]*=\s*(\{[\s\S]*?\n\});/, 'TIER_DEF');
  const CORE = grab(/for \(const id of (\[[^\]]*\]) as UpgradeId\[\]\) if \(t\.core\)/, 'core upgrade list');
  return { LINE, TIER_DEF, CORE };
}
const TIER_SRC = readTierDefs();

/* ------------------------------------------------------------------ report */
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : NaN);
const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '-');
function loadRuns() {
  if (!existsSync(RUNS_FILE)) return [];
  return readFileSync(RUNS_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
function aggregate(runs) {
  const cells = {};
  for (const r of runs) (cells[`${r.arena}|${r.tier}|${r.plow}`] ??= []).push(r);
  const out = {};
  for (const [k, rs] of Object.entries(cells)) {
    const [arena, tier, plow] = k.split('|');
    const f = (fn) => rs.map(fn);
    const spread = (xs) => (xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : 0);
    const totals = f((r) => r.total);
    const dmg = {};
    for (const r of rs) for (const [s, v] of Object.entries(r.dmg)) dmg[s] = (dmg[s] ?? 0) + v / rs.length;
    const dmgSum = Object.values(dmg).reduce((a, b) => a + b, 0) || 1;
    out[k] = {
      arena: +arena, tier, plow, n: rs.length,
      total: r1(mean(totals)), totalMin: r1(Math.min(...totals)), totalMax: r1(Math.max(...totals)), spread: r1(spread(totals)),
      boss: r1(mean(f((r) => r.rounds.at(-1)?.t ?? NaN))),
      bossFight: r1(mean(f((r) => r.bossFight ?? NaN))),
      hpLost: Math.round(mean(f((r) => r.hpLost))),
      maxHp: rs[0].stats?.maxHp,
      deaths: r1(mean(f((r) => r.deaths))),
      deathsMax: Math.max(...f((r) => r.deaths)),
      otherLevel: mean(f((r) => r.otherLevel)),
      targetOtherLevel: mean(f((r) => r.targetOtherLevel)),
      stuck: r1(mean(f((r) => r.stuck))),
      stuckFree: r1(mean(f((r) => r.stuckFree))),
      stuckFreeRoundMax: Math.max(...rs.flatMap((r) => r.rounds.map((x) => x.stuckFree / Math.max(1, x.t)))),
      stuckRoundMax: Math.max(...rs.flatMap((r) => r.rounds.map((x) => x.stuck / Math.max(1, x.t)))),
      minions: r1(mean(f((r) => r.rounds.slice(0, -1).reduce((a, x) => a + x.t, 0)))),
      unsticks: rs.reduce((a, r) => a + r.rounds.reduce((b, x) => b + (x.unsticks ?? 0), 0), 0),
      stalls: rs.reduce((a, r) => a + r.rounds.reduce((b, x) => b + (x.stalls ?? 0), 0), 0),
      timeouts: rs.reduce((a, r) => a + r.rounds.filter((x) => x.timeout).length, 0),
      rounds: rs[0].rounds.map((_, i) => r1(mean(rs.map((r) => r.rounds[i]?.t ?? NaN)))),
      dmgShare: Object.fromEntries(Object.entries(dmg).filter(([, v]) => v > 0).map(([s, v]) => [s, +(v / dmgSum).toFixed(3)])),
      dmgTotal: Math.round(dmgSum),
      errors: rs.reduce((a, r) => a + (r.errors?.length ?? 0), 0),
    };
  }
  return out;
}
function report() {
  const runs = loadRuns();
  const agg = aggregate(runs);
  const lines = [];
  const arenas = [...new Set(runs.map((r) => r.arena))].sort((a, b) => b - a);
  const tiers = TIERS.filter((t) => runs.some((r) => r.tier === t));
  const plows = PLOWS.filter((p) => runs.some((r) => r.plow === p));
  const flags = [];
  for (const tier of tiers) {
    lines.push(`### ${tier}`, '');
    lines.push('| plow | arena | n | total s (min-max) | rounds s | boss round s | boss fight s | HP lost (max HP) | deaths (max) | bots on other level | target on other level | stuck s (free) | timeouts |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const plow of plows) {
      for (const arena of arenas) {
        const c = agg[`${arena}|${tier}|${plow}`];
        if (!c) continue;
        lines.push(`| ${plow} | ${arena + 1} | ${c.n} | ${c.total} (${c.totalMin}-${c.totalMax}) | ${c.rounds.join(' / ')} | ${c.boss} | ${c.bossFight} | ${c.hpLost} (${c.maxHp}) | ${c.deaths} (${c.deathsMax}) | ${pct(c.otherLevel)} | ${pct(c.targetOtherLevel)} | ${c.stuck} (${c.stuckFree}) | ${c.timeouts} |`);
      }
    }
    lines.push('');
    // Ratio + outliers on each arena.
    lines.push('| plow | arena-6 / arena-5 time | minion rounds a6 / a5 | damage share (arena 6) |', '|---|---|---|---|');
    for (const plow of plows) {
      const a6 = agg[`5|${tier}|${plow}`];
      const a5 = agg[`4|${tier}|${plow}`];
      const share = a6 ? Object.entries(a6.dmgShare).sort((a, b) => b[1] - a[1]).map(([s, v]) => `${s} ${pct(v)}`).join(', ') : '-';
      lines.push(`| ${plow} | ${a6 && a5 ? (a6.total / a5.total).toFixed(2) : '-'} | ${a6 && a5 ? `${a6.minions} / ${a5.minions} = ${(a6.minions / a5.minions).toFixed(2)}` : '-'} | ${share} |`);
    }
    lines.push('');
    for (const arena of arenas) {
      const cs = plows.map((p) => agg[`${arena}|${tier}|${p}`]).filter(Boolean);
      const m = mean(cs.map((c) => c.total));
      for (const c of cs) {
        if (c.total > m * 1.25) flags.push(`${tier} arena ${arena + 1}: ${c.plow} ${c.total}s is ${pct(c.total / m - 1)} slower than the tier mean ${r1(m)}s`);
        if (c.deaths >= 2 || c.deathsMax >= 3) flags.push(`${tier} arena ${arena + 1}: ${c.plow} dies ${c.deaths}/run (max ${c.deathsMax})`);
        if (c.stuckRoundMax > 0.1 && c.stuckFreeRoundMax <= 0.1) flags.push(`${tier} arena ${arena + 1}: ${c.plow} stuck up to ${pct(c.stuckRoundMax)} of a round, all pinned against a bot within 6 m (no free stuck)`);
        if (c.unsticks || c.stalls) flags.push(`${tier} arena ${arena + 1}: ${c.plow} autopilot needed ${c.unsticks} unstick manoeuvre(s), ${c.stalls} target stall(s)`);
        if (c.stuckFreeRoundMax > 0.1) flags.push(`${tier} arena ${arena + 1}: ${c.plow} autopilot free-stuck up to ${pct(c.stuckFreeRoundMax)} of a round (avg ${c.stuckFree}s/run)`);
        if (c.timeouts) flags.push(`${tier} arena ${arena + 1}: ${c.plow} ${c.timeouts} round(s) hit the ${CAP}s cap`);
      }
    }
  }
  lines.push('### Flags', '', ...(flags.length ? flags.map((f) => `- ${f}`) : ['- none']), '');
  writeFileSync(`${OUT}/summary.json`, JSON.stringify(agg, null, 1));
  writeFileSync(`${OUT}/summary.md`, lines.join('\n'));
  console.log(lines.join('\n'));
}
if (flag('report-only')) {
  report();
  process.exit(0);
}

/* ------------------------------------------------------------------ page-side code */
// Runs in the page: set the garage for (plow, tier), start the arena, wire the counters and the autopilot.
async function pageSetup({ arena, plow, tier, tiers, cap, hard }) {
  const g = window.__game, c = g.ctx, pr = c.progression;
  g.setLoop(false);
  g.impact.enabled = false;
  pr.isZoneUnlocked = () => true;
  pr.save = () => {};
  // Garage per scripts/balance/sim.ts levelsFor: core four + the plow's line, and the tier's gear owned + equipped.
  const t = tiers.TIER_DEF[tier];
  const ups = {};
  for (const id of tiers.CORE) if (t.core) ups[id] = t.core;
  for (const id of tiers.LINE[plow]) if (t.line) ups[id] = t.line;
  const { GEAR_BY_ID } = await import('/src/config/gear.ts');
  let detour = null;
  try { ({ detour } = await import('/src/world/omega/nav.ts')); } catch { /* no detour helper */ }
  const gear = { owned: { ...t.gear }, equipped: {} };
  for (const id of Object.keys(t.gear)) gear.equipped[GEAR_BY_ID[id].slot] = id;
  pr.data.upgrades = ups;
  pr.data.gear = gear;
  pr.setPlow(plow);
  // Cross-check against sim.ts itself when it imports in the browser.
  let levelsMatch = null;
  try {
    const sim = await import('/scripts/balance/sim.ts');
    const want = sim.levelsFor(plow, tier);
    const have = pr.effectiveLevels();
    const keys = new Set([...Object.keys(want), ...Object.keys(have)].filter((k) => (want[k] ?? 0) || (have[k] ?? 0)));
    levelsMatch = [...keys].every((k) => (want[k] ?? 0) === (have[k] ?? 0));
  } catch (e) {
    levelsMatch = `sim.ts import failed: ${e.message}`;
  }
  if (hard) {
    const id = c.progression.data && (await import('/src/config/zones.ts')).ZONES[arena].id;
    c.progression.data.zones[id] = { cleared: true, bestRound: 99 };
  }
  g.startRun(arena, !!hard);
  if (hard && !g.hard) throw new Error(`startRun(${arena}, hard) did not start Hard mode`);
  if (g.zoneIndex !== arena) throw new Error(`startRun(${arena}) did not start (zone ${g.zoneIndex})`);
  c.ui.hideOverlays?.();

  // ---- damage attribution: tag the Combat kit methods that deal each kind of damage, count HP removed per tag.
  const tags = [];
  window.__tags = tags;
  const cb = c.combat;
  const wrap = (obj, m, tag) => {
    const proto = obj && Object.getPrototypeOf(obj);
    const orig = proto?.[m];
    if (!orig || orig.__omega) return;
    const f = typeof tag === 'function'
      ? function (...a) { tags.push(tag(...a)); try { return orig.apply(this, a); } finally { tags.pop(); } }
      : function (...a) { tags.push(tag); try { return orig.apply(this, a); } finally { tags.pop(); } };
    f.__omega = true;
    proto[m] = f;
  };
  const isArs = plow === 'arsenal';
  // Held SPACE primaries of the vehicle kits (no snowball to slam): Arc Lance, Wrecking Fist, Rad Sprayer reach (m,
  // centre to centre, before the target's radius), with Mega Hopper (as src/duel/plumbing.ts autoHoldRange: arcRange,
  // FIST_REACH x fistSize + hull, sprayRange + Long Nozzle). Read live: Mega Hopper changes it mid-run.
  const hopR = () => Math.max(0, c.stats.maxBallRadius - 1.2);
  const kitReach = () => {
    const s = c.stats;
    if (plow === 'volt') return 14 + 2.5 * hopR();
    if (plow === 'brute') return 1.6 + 4 * Math.max(1, s.maxBallRadius / 1.2) + (s.fistReach || 0);
    if (plow === 'isotope') return 8.5 + 2 * hopR() + (s.sprayReach || 0);
    return 0;
  };
  const KIT_REACH = kitReach() > 0;
  // ARSENAL's Mag Laser reach (tankGunRange: gunRange + 1.5 m per extra metre of max ball radius) and beam half-width
  // (tankBeamRadius: 0.8 m + 0.1 per extra metre of spin radius, 1.2 at most).
  const laserReach = () => (c.stats.gunRange || 0) + 1.5 * hopR();
  const laserHalfW = () => Math.min(1.2, 0.8 + 0.1 * Math.max(0, (c.stats.whirlRadius || 4) - 4));
  // Classic Plow: tap-slam reach (centre distance, as the snowball kit's slam below) and PLOW RUSH limits (classicRush.ts).
  const SLAM_D = 5.5, RUSH_MAX = 20, rushCost = (d) => Math.max(0.25, Math.min(RUSH_MAX, d) / RUSH_MAX);
  wrap(cb.air, 'update', 'air');
  wrap(cb.classic, 'updateFlame', 'F');
  wrap(cb.classic, 'updateBurns', 'F');
  wrap(cb.classic, 'updateFireField', 'ult');
  wrap(cb.classic, 'firestorm', 'ult');
  wrap(cb.volt, 'updateClap', 'F');
  wrap(cb.volt, 'updateStorm', 'F');
  wrap(cb.volt, 'updateField', 'passive');
  wrap(cb.volt, 'updateShield', 'passive');
  wrap(cb.brute, 'updatePound', 'F');
  wrap(cb.brute, 'poundImpact', 'F');
  wrap(cb.brute, 'updateSaws', 'passive');
  wrap(cb.isotope, 'updateMeltdown', 'F');
  wrap(cb.isotope, 'updatePools', 'F');
  wrap(cb.isotope, 'armNuke', 'ult');
  wrap(cb.isotope, 'updateAura', 'passive');
  wrap(cb.isotope, 'updateRads', 'passive');
  wrap(cb.arsenal, 'updateGuns', 'laser');
  wrap(cb.arsenal, 'updateLaser', 'lance');
  wrap(cb.arsenal, 'updateBurst', 'burst');
  wrap(cb.ult, 'update', isArs ? 'singularity' : 'ult');
  wrap(cb.ult, 'start', isArs ? 'singularity' : 'ult');
  const emProto = Object.getPrototypeOf(c.enemies);
  if (!emProto.damage.__omega) {
    const orig = emProto.damage;
    emProto.damage = function (e, amount, opts) {
      const hp0 = e && e.alive ? e.hp : 0;
      const r = orig.call(this, e, amount, opts);
      const dealt = Math.max(0, hp0 - Math.max(0, e?.hp ?? 0));
      const P = window.__P;
      if (dealt > 0 && P && P.round) {
        const tag = tags.length ? tags[tags.length - 1] : 'basic';
        P.round.dmg[tag] = (P.round.dmg[tag] ?? 0) + dealt;
      }
      return r;
    };
    emProto.damage.__omega = true;
  }

  // ---- per-round counters
  const P = (window.__P = { rounds: [], round: null, deaths: 0, bossT0: -1, bossFight: null, done: false, cap, frames: 0, errors: [] });
  const newRound = () => ({ idx: g.roundIndex, t: 0, hpLost: 0, deaths: 0, dmg: {}, botFrames: 0, otherBotFrames: 0, tgtFrames: 0, tgtOther: 0, stuck: 0, stuckFree: 0, timeout: false, ults: 0, fUses: 0 });
  c.events.on('plowDamaged', (e) => { if (P.round) P.round.hpLost += e.amount; });
  c.events.on('bossSpawned', () => { if (P.bossT0 < 0) P.bossT0 = c.time; if (P.round && P.round.bossAt == null) P.round.bossAt = +P.round.t.toFixed(2); });
  c.events.on('bossDefeated', () => {
    if (P.bossT0 >= 0 && P.bossFight == null) P.bossFight = c.time - P.bossT0;
    if (P.round) { P.round.bossDeadAt = +P.round.t.toFixed(2); P.round.aliveAtBossDeath = c.enemies.aliveCount(); }
  });
  c.events.on('ability', (e) => { if (P.round) e.nuke ? P.round.ults++ : P.round.fUses++; });

  // ---- autopilot (keyboard events, as legend-probe)
  const keys = (window.__keys = {});
  const set = (code, on) => { if (!!keys[code] === on) return; keys[code] = on; window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code })); };
  const tap = (code) => { set(code, false); set(code, true); };
  const AP = { stuckT: 0, stuckFreeT: 0, revT: 0, revSteer: 1, lastX: 0, lastZ: 0, way: { x: 0, z: 0 }, det: { x: 0, z: 0 },
    // Escalating unstick: episodes in a row -> reverse, then drive off sideways for a while.
    episodes: 0, lastEpisodeT: -99, escT: 0, escHeading: 0,
    // Stall: no damage dealt for a while -> ignore that target for a bit (pick the next one, or wander).
    lastHitT: 0, ignore: new Map(), wanderT: 0, wander: { x: 0, z: 0 }, tgt: null };
  window.__AP = AP;
  const LEVEL_DY = 2;
  const ap = () => {
    const p = c.plow, s = c.stats, en = c.enemies, nav = en.nav;
    for (const k of ['ShiftLeft', 'KeyE', 'KeyF']) if (keys[k]) set(k, false);
    // Classic: SPACE stays down only while charging a PLOW RUSH (AP.rush).
    if (!isArs && !KIT_REACH && keys.Space && !AP.rush) set('Space', false);
    if (p.dead) { AP.rush = false; for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space']) set(k, false); return; }
    const px = p.position.x, py = p.position.y, pz = p.position.z;
    const dReach = isArs ? laserReach() : 0;
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading), halfW = isArs ? laserHalfW() : 0;
    let best = null, bScore = 1e9, bd = 1e9, near = 0, inF = 0, anyIn = 0, gunIn = 0, laserIn = 0, bossNear = 0;
    const fR = plow === 'volt' ? s.clapRadius * 0.8 : plow === 'brute' ? s.poundRadius * 0.7 : plow === 'isotope' ? s.meltRadius * 0.7 : plow === 'arsenal' ? 14 : s.flameRange * 0.9;
    for (const e of en.list) {
      if (!e.alive) continue;
      const dx = e.position.x - px, dz = e.position.z - pz;
      const d = Math.hypot(dx, dz);
      const dy = Math.abs(e.position.y - py);
      const same = dy < LEVEL_DY;
      if (same && d < 7) near++;
      if (same && d < fR) inF++;
      if (d < 45) anyIn++;
      // Mag Laser: dead straight off the nose, so only a bot on the beam's line (ahead, inside its width and reach).
      if (same && d < dReach + (e.radius || 1)) {
        const u = dx * fx + dz * fz;
        if (u > 0 && Math.abs(dx * fz - dz * fx) < (e.radius || 1) + halfW) gunIn++;
      }
      if (d < (s.laserRange || 0) && d > 0.5) {
        const a = Math.atan2(dx, dz) - p.heading;
        if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 1.2) laserIn++;
      }
      if (e.isBoss && d < 20) bossNear++;
      if ((AP.ignore.get(e) ?? -1) > c.time) continue;
      // Nearest bot, levels weighted (a bot right above you on a deck is a long way round).
      const score = d + (same ? 0 : 4 * dy + 10);
      if (score < bScore) { bScore = score; best = e; bd = d; }
    }
    // Movement bookkeeping (actual displacement, so walls / decks count even if the plow thinks it is moving).
    const mv = Math.hypot(px - AP.lastX, pz - AP.lastZ) * 60;
    AP.lastX = px; AP.lastZ = pz;
    // Stall bookkeeping: damage dealt this round resets the clock; 25 s without a hit on a far target -> ignore it 20 s.
    const R0 = P.round;
    const dealtNow = R0 ? Object.values(R0.dmg).reduce((a, b) => a + b, 0) : 0;
    if (dealtNow !== AP.lastDealt || best !== AP.tgt) { AP.lastDealt = dealtNow; AP.lastHitT = c.time; AP.tgt = best; }
    if (best && c.time - AP.lastHitT > 25 && bd > 8) {
      AP.ignore.set(best, c.time + 20);
      AP.lastHitT = c.time;
      if (R0) R0.stalls = (R0.stalls ?? 0) + 1;
      // Everything else ignored too: wander to a random point for a few seconds.
      AP.wanderT = 6;
      const a = Math.random() * Math.PI * 2, rr = 15 + Math.random() * 30;
      AP.wander.x = Math.max(-60, Math.min(60, px + Math.sin(a) * rr));
      AP.wander.z = Math.max(-60, Math.min(60, pz + Math.cos(a) * rr));
    }
    if (AP.wanderT > 0) AP.wanderT -= 1 / 60;
    if (!best) {
      // Only ignored bots left: wander, then forget the ignores.
      if (AP.wanderT <= 0) AP.ignore.clear();
      const dd = Math.atan2(AP.wander.x - px, AP.wander.z - pz) - p.heading, da = Math.atan2(Math.sin(dd), Math.cos(dd));
      AP.rush = false;
      set('KeyS', false); set('Space', false); set('KeyW', AP.wanderT > 0); set('KeyA', da > 0.08); set('KeyD', da < -0.08);
      return;
    }
    const sameT = Math.abs(best.position.y - py) < LEVEL_DY;
    let tx = best.position.x, tz = best.position.z, routed = false;
    if (nav && nav.next(px, pz, p.deck, tx, tz, best.deck ?? best.vert?.deck ?? -1, AP.way)) { tx = AP.way.x; tz = AP.way.z; routed = true; }
    // Steer round a deck side in the way, when the terrain has decks.
    const terr = c.terrain;
    if (detour && terr && terr.active && terr.decks?.length && !p.airborne && detour(terr, px, pz, p.vert.y, 2.4, p.radius, tx, tz, AP.det)) {
      tx = AP.det.x; tz = AP.det.z; routed = true;
      if (P.round) P.round.detourFrames = (P.round.detourFrames ?? 0) + 1;
    }
    const want = Math.atan2(tx - px, tz - pz);
    const diffA = Math.atan2(Math.sin(want - p.heading), Math.cos(want - p.heading));
    const bwant = Math.atan2(best.position.x - px, best.position.z - pz);
    const bdiff = Math.atan2(Math.sin(bwant - p.heading), Math.cos(bwant - p.heading));
    // Stuck bookkeeping + unstick: reverse out for a moment, turning the other way.
    const busy = p.slamPhase > 0 || p.whirling || p.hitStopT > 0 || p.airborne;
    if (AP.revT > 0) {
      AP.revT -= 1 / 60;
      set('KeyW', false); set('KeyS', true);
      set('KeyA', AP.revSteer < 0); set('KeyD', AP.revSteer > 0);
    } else if (AP.escT > 0) {
      AP.escT -= 1 / 60;
      const ed = Math.atan2(Math.sin(AP.escHeading - p.heading), Math.cos(AP.escHeading - p.heading));
      set('KeyS', false); set('KeyW', true); set('KeyA', ed > 0.08); set('KeyD', ed < -0.08);
    } else {
      set('KeyS', false);
      set('KeyW', true);
      set('KeyA', diffA > 0.08);
      set('KeyD', diffA < -0.08);
    }
    const throttling = AP.revT <= 0; // escape drives count as throttling
    const free = !(sameT && bd < 6);
    if (throttling && !busy && mv < 1) {
      AP.stuckT += 1 / 60;
      if (free) AP.stuckFreeT += 1 / 60; else AP.stuckFreeT = 0;
    } else {
      AP.stuckT = 0;
      AP.stuckFreeT = 0;
    }
    const R = P.round;
    if (R) {
      // An episode counts in full once it passes 1 s.
      if (AP.stuckT > 1) { R.stuck += AP.sc ? 1 / 60 : AP.stuckT; AP.sc = true; } else AP.sc = false;
      if (AP.stuckFreeT > 1) { R.stuckFree += AP.sf ? 1 / 60 : AP.stuckFreeT; AP.sf = true; } else AP.sf = false;
    }
    if (AP.stuckFreeT > 1.5) {
      AP.episodes = c.time - AP.lastEpisodeT < 8 ? AP.episodes + 1 : 1;
      AP.lastEpisodeT = c.time;
      AP.revT = AP.episodes > 1 ? 1.4 : 0.9;
      AP.revSteer = (diffA > 0 ? -1 : 1) * (AP.episodes % 2 ? 1 : -1);
      // Second episode in a row: after reversing, drive off at right angles (alternating sides) for a while.
      if (AP.episodes > 1) { AP.escT = 1.2 + 0.4 * Math.min(AP.episodes, 5); AP.escHeading = p.heading + (AP.episodes % 2 ? 1 : -1) * (Math.PI / 2 + Math.random() * 0.6); }
      AP.stuckFreeT = 0; AP.stuckT = 0;
      if (P.round) P.round.unsticks = (P.round.unsticks ?? 0) + 1;
    }

    // Abilities.
    const cbx = c.combat;
    const crit = cbx.critMass;
    const fReady = cbx.flameReady;
    let usedF = false;
    if (crit >= 1) {
      // Ultimate: when something is in reach (ARSENAL's singularity seeks 40 m; the others want a cluster / the boss close).
      const ok = isArs ? anyIn >= 2 : inF >= 1 || near >= 2 || bossNear >= 1 && sameT && bd < 12;
      if (ok) { tap('KeyF'); usedF = true; }
    } else if (fReady >= 1) {
      let useF = false;
      if (plow === 'classic') useF = sameT && bd < fR && Math.abs(bdiff) < 0.5;
      else if (plow === 'volt') useF = inF >= 1 && cbx.overloadHeat < 0.6 && p.hp > p.maxHp * 0.25;
      else if (plow === 'arsenal') useF = inF >= 1; // Polarity Burst: a 16 m horizon
      else useF = inF >= 1;
      if (useF) { tap('KeyF'); usedF = true; }
    }
    if (isArs) {
      set('Space', gunIn >= 1); // Mag Laser: hold while a bot is on the beam's line (it fires dead straight)
      if (!usedF && p.whirlReady >= 1 && laserIn >= 1) tap('KeyE');
      else if (!usedF && p.dashReady >= 1 && !routed && bd > 8 && bd < 16 && Math.abs(diffA) < 0.15) tap('ShiftLeft');
      return;
    }
    // Vehicle kits: hold the primary while the target is in reach and roughly ahead.
    if (KIT_REACH) set('Space', sameT && bd < kitReach() + (best.radius || 1) * 0.5 && Math.abs(bdiff) < 0.7);
    if (plow === 'classic') {
      // Tap the ball slam when the target is inside slam reach with a ball on the blade (plowing a new one in between);
      // lined up at range with meter for a rush that reaches it,
      // hold SPACE to charge a PLOW RUSH and let go once the telegraph reaches the target (or the charge is full); the
      // rush slams at the first bot it touches, so a longer line only costs meter.
      if (AP.rush) {
        const k = p.rushCharge;
        if (!sameT || routed || Math.abs(bdiff) > 0.6 || bd < SLAM_D || (k >= 0 && (p.rushPreview >= bd - 2 || k >= 1)) || c.time - AP.rushT > 2.5) {
          AP.rush = false;
          set('Space', false);
        }
        return;
      }
      if (usedF || p.rushing) return;
      if (sameT && !routed && bd > SLAM_D + 1 && bd < RUSH_MAX + 1 && Math.abs(bdiff) < 0.2 && p.dashReady >= rushCost(bd - 2)) {
        AP.rush = true;
        AP.rushT = c.time;
        tap('Space');
        return;
      }
      if (p.heldBallRadius >= 0.5 && sameT && bd < SLAM_D && Math.abs(bdiff) < 0.45) tap('Space');
      else if (p.dashReady >= 1 && !routed && sameT && bd > RUSH_MAX + 1 && bd < 28 && Math.abs(diffA) < 0.15) tap('ShiftLeft');
      else if (p.whirlReady >= 1 && near >= 1 && bd < 5) tap('KeyE');
      return;
    }
    if (usedF) return;
    if (p.heldBallRadius >= 0.5 && sameT && bd < 5.5 && Math.abs(bdiff) < 0.45) tap('Space');
    else if (p.dashReady >= 1 && !routed && sameT && bd > 6 && bd < 14 && Math.abs(diffA) < 0.15) tap('ShiftLeft');
    else if (p.whirlReady >= 1 && near >= 1 && bd < 5) tap('KeyE');
  };

  // ---- one sim step: round flow (skip countdowns, revive on death, emulate the shop, cap rounds) + metrics.
  window.__step = () => {
    if (P.done) return;
    const st = g.state;
    if (st === 'countdown') g.countdown = 0;
    if (st === 'playing') {
      if (!P.round) P.round = newRound();
      ap();
    }
    g.tick(1 / 60);
    P.frames++;
    const R = P.round;
    if (R && st === 'playing') {
      R.t += 1 / 60;
      // Level split: share of living bots on another level than the player (|dy| > 2 m).
      const py = c.plow.position.y;
      let n = 0, other = 0, best = null, bd = 1e9;
      for (const e of c.enemies.list) {
        if (!e.alive) continue;
        n++;
        const dy = Math.abs(e.position.y - py);
        if (dy > LEVEL_DY) other++;
        const d = Math.hypot(e.position.x - c.plow.position.x, e.position.z - c.plow.position.z);
        if (d < bd) { bd = d; best = e; }
      }
      if (n) {
        R.botFrames += n;
        R.otherBotFrames += other;
        R.tgtFrames++;
        if (Math.abs(best.position.y - py) > LEVEL_DY) R.tgtOther++;
      }
    }
    const now = g.state;
    if (now === 'wrecked') {
      // Death: count it and revive in place (same level), round continues.
      P.deaths++;
      if (R) R.deaths++;
      const p = c.plow;
      const x = p.position.x, z = p.position.z, y = p.position.y, heading = p.heading;
      p.reset({ x, z, heading });
      const t = c.terrain;
      if (t && t.active && p.surf && p.vert) {
        const s = t.surfaceAt(x, z, y + 1, p.surf);
        p.vert.surfaceY = s.y; p.vert.deck = s.deck; p.vert.y = s.y; p.position.y = s.y;
      }
      p.hp = p.maxHp;
      g.state = 'playing';
      c.ui.hideOverlays?.();
      return;
    }
    // Trace long rounds: player + living bots every 2 s past 45 s (where they are, which deck, what they're doing).
    if (now === 'playing' && R && R.t > 45 && (R.trace ??= []).length < 60 && P.frames % 120 === 0) {
      const p = c.plow, q = (v) => Math.round(v * 10) / 10;
      R.trace.push({
        t: q(R.t), p: [q(p.position.x), q(p.position.y), q(p.position.z), p.deck], hp: Math.round(p.hp), keys: Object.keys(window.__keys ?? {}).filter((k) => window.__keys[k]).join(''),
        bots: c.enemies.list.filter((e) => e.alive).slice(0, 4).map((e) => [e.type, q(e.position.x), q(e.position.y), q(e.position.z), e.deck, e.state, e.entering ? 'E' : '', e.isBoss ? 'B' : '', e.airborne ? 'A' : '']),
      });
    }
    if (now === 'playing' && R && R.t >= P.cap) {
      R.timeout = true;
      c.enemies.clear();
      c.waves.clear();
      g.roundCleared();
    }
    const after = g.state;
    if ((after === 'shop' || after === 'victory') && P.round) {
      P.rounds.push(P.round);
      P.round = null;
      if (after === 'victory') { P.done = true; return; }
      // The shop's continue: same as Game.roundCleared's showShop callback (no purchases).
      g.refreshStats();
      c.plow.hp = Math.min(c.plow.maxHp, c.plow.hp + c.stats.repairFraction * c.plow.maxHp);
      c.ui.hideOverlays?.();
      g.roundIndex++;
      g.beginCountdown();
    } else if (after === 'gameover') {
      P.errors.push('gameover state reached');
      P.done = true;
    }
  };
  window.__chunk = (n) => {
    const t0 = performance.now();
    for (let i = 0; i < n && !P.done; i++) window.__step();
    return { done: P.done, round: g.roundIndex, rounds: P.rounds.length, t: P.round ? +P.round.t.toFixed(1) : 0, alive: c.enemies.aliveCount(), ms: Math.round(performance.now() - t0) };
  };
  window.__result = () => {
    const sum = (k) => P.rounds.reduce((a, r) => a + r[k], 0);
    const dmg = {};
    for (const r of P.rounds) for (const [k, v] of Object.entries(r.dmg)) dmg[k] = (dmg[k] ?? 0) + v;
    const bot = sum('botFrames'), tgt = sum('tgtFrames');
    return {
      total: +sum('t').toFixed(2), hpLost: Math.round(sum('hpLost')), deaths: P.deaths,
      otherLevel: bot ? +(sum('otherBotFrames') / bot).toFixed(3) : 0,
      targetOtherLevel: tgt ? +(sum('tgtOther') / tgt).toFixed(3) : 0,
      stuck: +sum('stuck').toFixed(2), stuckFree: +sum('stuckFree').toFixed(2),
      bossFight: P.bossFight == null ? null : +P.bossFight.toFixed(2),
      dmg: Object.fromEntries(Object.entries(dmg).map(([k, v]) => [k, Math.round(v)])),
      rounds: P.rounds.map((r) => ({
        t: +r.t.toFixed(2), bossAt: r.bossAt, bossDeadAt: r.bossDeadAt, aliveAtBossDeath: r.aliveAtBossDeath, hpLost: Math.round(r.hpLost), deaths: r.deaths, timeout: r.timeout, ults: r.ults, fUses: r.fUses,
        otherLevel: r.botFrames ? +(r.otherBotFrames / r.botFrames).toFixed(3) : 0,
        stuck: +r.stuck.toFixed(2), stuckFree: +r.stuckFree.toFixed(2), unsticks: r.unsticks ?? 0, stalls: r.stalls ?? 0, detour: +((r.detourFrames ?? 0) / 60).toFixed(1),
        dmg: Object.fromEntries(Object.entries(r.dmg).map(([k, v]) => [k, Math.round(v)])),
        ...(r.trace ? { trace: r.trace } : {}),
      })),
      errors: P.errors,
    };
  };
  const s = c.stats;
  return {
    zone: c.zone.name, theme: c.zone.theme, nav: !!c.enemies.nav, levelsMatch,
    stats: { plow: s.plowKind, maxHp: Math.round(s.maxHp), damageTaken: +s.damageTaken.toFixed(3), damageMult: +s.damageMult.toFixed(2), maxSpeed: +s.maxSpeed.toFixed(1), gunDamage: s.gunDamage, gunRange: s.gunRange, laserDps: s.laserDps, missileDamage: s.missileDamage },
  };
}

/* ------------------------------------------------------------------ driver */
const port = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 600);
const server = await createServer({ root, server: { port, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const exe = process.env.PW_EXE || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);
const launch = () => chromium.launch({ ...(exe ? { executablePath: exe } : { channel: 'chrome' }), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let browser = await launch();

const done = flag('resume') ? loadRuns() : [];
const jobs = [];
for (let run = 0; run < RUNS; run++)
  for (const arena of ARENAS)
    for (const tier of TIERS)
      for (const plow of PLOWS) {
        const have = done.filter((r) => r.arena === arena && r.tier === tier && r.plow === plow).length;
        if (have > run) continue;
        jobs.push({ arena, tier, plow, run });
      }
console.log(`omega-probe: ${jobs.length} runs, par ${PAR}, cap ${CAP}s, out ${OUT}`);

async function runOne(job) {
  if (!browser.isConnected()) browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('GPU stall')) errors.push(`[console] ${m.text()}`); });
  const t0 = Date.now();
  try {
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
    const setup = await page.evaluate(pageSetup, { arena: job.arena, plow: job.plow, tier: job.tier, tiers: TIER_SRC, cap: CAP, hard: HARD });
    if (setup.levelsMatch !== true) console.log(`  WARN levels ${job.plow}/${job.tier}: ${setup.levelsMatch}`);
    let st;
    const maxChunks = Math.ceil((CAP * 6 * 60 + 2000) / 1200);
    for (let i = 0; i < maxChunks; i++) {
      st = await page.evaluate(() => window.__chunk(1200));
      if (st.done) break;
    }
    const res = await page.evaluate(() => window.__result());
    const rec = { arena: job.arena, tier: job.tier, plow: job.plow, run: job.run, zone: setup.zone, stats: setup.stats, levelsMatch: setup.levelsMatch, finished: !!st?.done, wall: Math.round((Date.now() - t0) / 1000), ...res, errors: [...res.errors, ...errors.slice(0, 10)] };
    appendFileSync(RUNS_FILE, JSON.stringify(rec) + '\n');
    console.log(`RUN a${job.arena + 1}${HARD ? 'H' : ''} ${job.tier} ${job.plow} #${job.run + 1}: total ${rec.total}s [${rec.rounds.map((r) => r.t + (r.timeout ? '!' : '')).join(' / ')}] boss ${rec.bossFight}s hp-${rec.hpLost} deaths ${rec.deaths} other ${pct(rec.otherLevel)} stuck ${rec.stuck}/${rec.stuckFree}s wall ${rec.wall}s${rec.errors.length ? ' ERR ' + rec.errors[0].slice(0, 120) : ''}`);
    return true;
  } finally {
    await ctx.close().catch(() => {});
  }
}

let next = 0;
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    for (let tries = 0; ; tries++) {
      try {
        await runOne(job);
        break;
      } catch (e) {
        console.log(`  RETRY a${job.arena + 1} ${job.tier} ${job.plow}: ${String(e.message).split('\n')[0]}`);
        if (tries >= 2) break;
        if (!browser.isConnected()) browser = await launch();
      }
    }
  }
}
await Promise.all(Array.from({ length: Math.max(1, PAR) }, worker));
await browser.close().catch(() => {});
await server.close();
report();
process.exit(0);
