// PROTOCOL C probe (stage-5 balance pass): an autopilot plays the seven-wave rush and THE WHITEOUT finale headless.
//   node scripts/protocol-probe.mjs [--waves 1-8] [--plows classic,arsenal] [--tiers mid,unlock,high] [--runs 1]
//                                   [--par 2] [--cap 400] [--out DIR] [--report-only]
//                                   [--focus none|ability:5|weapon:5|main:5]  (Garage FOCUS level; several: comma list)
//   Plows: classic, volt, brute, isotope, arsenal, revenant (PHANTOM). --focus main:N picks the Focus matching the
//   plow's main damage (MAIN_FOCUS below); each focus setting is its own run.
// Built on scripts/omega-probe.mjs (same autopilot, garage tiers read out of scripts/balance/sim.ts, deaths revived in
// place and counted). It starts PROTOCOL C at the first wave of --waves (__game.startProtocol; 8 = the finale) and
// plays on to the last (the shop is skipped, no purchases). In THE WHITEOUT the autopilot goes for the Storm Hearts,
// the eye only when it is open (ranged) or staggered, and in THE AVALANCHE drives round the ball and pushes it on a
// loop through deep snow until it is full size, then into the eye. Logs per wave: time, HP lost, deaths, and for the
// finale the phase times, staggers, ball bursts, plus the star measures (echo sweep, CHAIRMAN time from landing).
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
const [W0, W1] = opt('waves', '1-8').split('-').map(Number).concat([NaN]).slice(0, 2).map((v, i, a) => (Number.isFinite(v) ? v : a[0]));
const PLOWS = opt('plows', 'classic,arsenal').split(',');
const TIERS = opt('tiers', 'mid,unlock,high').split(',');
const RUNS = Number(opt('runs', '1'));
const PAR = Number(opt('par', '2'));
const CAP = Number(opt('cap', '400'));
/** The Focus upgrade matching each plow's main damage source (from the no-Focus probe's damage split: SPACE / passive /
 *  ultimate -> Weapon Focus, E / F -> Ability Focus). */
const MAIN_FOCUS = { classic: 'ability', volt: 'weapon', brute: 'weapon', isotope: 'weapon', arsenal: 'weapon', revenant: 'weapon' };
const FOCI = opt('focus', 'none').split(',');
/** 'none' | 'ability:5' | 'weapon:5' | 'main:5' -> { id: upgrade id or null, level, label } for a plow. */
const focusFor = (spec, plow) => {
  if (!spec || spec === 'none') return { id: null, level: 0, label: '-' };
  const [kind0, lv] = spec.split(':');
  const kind = kind0 === 'main' ? MAIN_FOCUS[plow] : kind0;
  const level = Number(lv ?? 5);
  return { id: kind === 'ability' ? 'focusAbility' : 'focusWeapon', level, label: `${kind} ${level}` };
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = opt('out', resolve(root, 'protocol-probe-out'));
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
function report() {
  const runs = loadRuns();
  const lines = ['| tier | plow | focus | spent | k.hp | max HP | waves: s (HP lost, deaths) | total s | echo sweep s | CHAIRMAN s | finale: hearts / staggers / avalanche s (bursts) | finale HP lost, deaths |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of runs) {
    const w = r.rounds.map((x) => `w${x.wave} ${x.t}${x.timeout ? '!' : ''} (${x.hpLost}, ${x.deaths})`).join(' · ');
    const f = r.finale;
    const fin = f ? `${f.hearts ?? '-'} / ${f.staggers ?? '-'} / ${f.avalanche ?? '-'} (${f.bursts ?? '-'})${f.won ? '' : ' unfinished'}` : '-';
    lines.push(`| ${r.tier} | ${r.plow} | ${r.focus ?? '-'} | ${r.spent} | ${r.k?.toFixed?.(2)} | ${r.stats?.maxHp} | ${w} | ${r.total} | ${r1(r.echoSweep)} | ${r1(r.chairman)} | ${fin} | ${f ? `${f.hpLost}, ${f.deaths}` : '-'} |`);
  }
  writeFileSync(`${OUT}/summary.md`, lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}
if (flag('report-only')) {
  report();
  process.exit(0);
}

/* ------------------------------------------------------------------ page-side code */
// Runs in the page: set the garage for (plow, tier), start the arena, wire the counters and the autopilot.
async function pageSetup({ w0, w1, plow, tier, tiers, cap, focus }) {
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
  if (focus?.id) ups[focus.id] = focus.level;
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
    const want = { ...sim.levelsFor(plow, tier), ...(focus?.id ? { [focus.id]: focus.level } : {}) };
    const have = pr.effectiveLevels();
    const keys = new Set([...Object.keys(want), ...Object.keys(have)].filter((k) => (want[k] ?? 0) || (have[k] ?? 0)));
    levelsMatch = [...keys].every((k) => (want[k] ?? 0) === (have[k] ?? 0));
  } catch (e) {
    levelsMatch = `sim.ts import failed: ${e.message}`;
  }
  // The shop between waves: continue straight away (no purchases), as the player pressing CONTINUE.
  c.ui.showShop = (_n, _t, cb) => { window.__shopCb = cb; };
  const { protocolSpent } = await import('/src/meta/protocol.ts');
  const { spendScale } = await import('/src/config/protocol.ts');
  const spent = protocolSpent(pr);
  const k = spendScale(spent).hp;
  g.startProtocol(w0);
  if (!g.protocol) throw new Error(`startProtocol(${w0}) did not start`);
  const W = g.whiteout;
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
    // PHANTOM's REAP: a 140-degree sweep out to reapReach from 1.2 m ahead of the hull (combat/revenant.ts REAP_FWD).
    if (plow === 'revenant') return (s.reapReach || 7) + 1.2;
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
  wrap(cb.revenant, 'updateGrasp', 'F');
  wrap(cb.revenant, 'secondary', 'E');
  wrap(cb.revenant, 'update', 'passive');
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
  const P = (window.__P = { rounds: [], round: null, deaths: 0, done: false, cap, frames: 0, errors: [], echo6: [-1, -1, 0], chair: [-1, -1], fin: null });
  const newRound = (wave) => ({ wave, t: 0, hpLost: 0, deaths: 0, dmg: {}, botFrames: 0, otherBotFrames: 0, tgtFrames: 0, tgtOther: 0, stuck: 0, stuckFree: 0, timeout: false, ults: 0, fUses: 0 });
  const LAND = 2.8; // meta/challenges.ts CHAIRMAN_LAND_DELAY
  c.events.on('plowDamaged', (e) => { if (P.round) P.round.hpLost += e.amount; });
  c.events.on('bossSpawned', ({ enemy }) => {
    if (enemy.echo && !enemy.snow && g.roundIndex === 5 && P.echo6[0] < 0) P.echo6[0] = c.time;
    if (enemy.type === 'chairman' && !enemy.echo) P.chair[0] = c.time + LAND;
  });
  c.events.on('bossDefeated', ({ enemy }) => {
    if (enemy.echo && !enemy.snow && g.roundIndex === 5 && P.echo6[0] >= 0 && ++P.echo6[2] >= 5 && P.echo6[1] < 0) P.echo6[1] = c.time;
    if (enemy.type === 'chairman' && !enemy.echo && P.chair[0] >= 0) P.chair[1] = c.time;
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
  // THE AVALANCHE: loop the ball round the arena through deep snow until it is full size, then into the eye (a human
  // lines it up a little better; the stage-4 review's driver).
  const WP = [{ x: 0, z: 12 }, { x: -12, z: 8 }, { x: -12, z: -10 }, { x: 0, z: -14 }, { x: 12, z: -10 }, { x: 12, z: 8 }];
  let wp = 0;
  const steer = (tx, tz, thr) => {
    const p = c.plow;
    const d = Math.atan2(Math.sin(Math.atan2(tx - p.position.x, tz - p.position.z) - p.heading), Math.cos(Math.atan2(tx - p.position.x, tz - p.position.z) - p.heading));
    set('Space', false); set('KeyS', false);
    set('KeyW', thr >= 0.5);
    set('KeyA', d > 0.08); set('KeyD', d < -0.08);
  };
  const avalanche = () => {
    const bl = W.ball, p = c.plow.position;
    if (!bl.active) { steer(0, 6, 0.4); return; }
    let goal = bl.full ? { x: 0, z: -29.6 } : WP[wp];
    if (!bl.full && Math.hypot(goal.x - bl.x, goal.z - bl.z) < 4) { wp = (wp + 1) % WP.length; goal = WP[wp]; }
    let dx = goal.x - bl.x, dz = goal.z - bl.z;
    const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const along = (p.x - bl.x) * dx + (p.z - bl.z) * dz;
    const off = Math.abs((p.x - bl.x) * dz - (p.z - bl.z) * dx);
    if (along < -bl.r * 0.5 && off < bl.r * 0.7) steer(bl.x + dx * 3, bl.z + dz * 3, 1);
    else {
      const side = (p.x - bl.x) * dz - (p.z - bl.z) * dx;
      if (along > -bl.r && Math.hypot(p.x - bl.x, p.z - bl.z) < bl.r + 4) steer(bl.x + dz * Math.sign(side || 1) * (bl.r + 4), bl.z - dx * Math.sign(side || 1) * (bl.r + 4), 0.8);
      else steer(bl.x - dx * (bl.r + 2.8), bl.z - dz * (bl.r + 2.8), 0.85);
    }
  };
  const ap = () => {
    const p = c.plow, s = c.stats, en = c.enemies, nav = en.nav;
    for (const k of ['ShiftLeft', 'KeyE', 'KeyF']) if (keys[k]) set(k, false);
    // Classic: SPACE stays down only while charging a PLOW RUSH (AP.rush).
    if (!isArs && !KIT_REACH && keys.Space && !AP.rush) set('Space', false);
    if (p.dead) { AP.rush = false; for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space']) set(k, false); return; }
    if (W.phase === 'takeover' || W.phase === 'ending' || W.phase === 'over') { for (const k of ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space']) set(k, false); return; }
    if (W.phase === 'avalanche') { avalanche(); return; }
    const px = p.position.x, py = p.position.y, pz = p.position.z;
    const dReach = isArs ? laserReach() : 0;
    const fx = Math.sin(p.heading), fz = Math.cos(p.heading), halfW = isArs ? laserHalfW() : 0;
    let best = null, bScore = 1e9, bd = 1e9, near = 0, inF = 0, anyIn = 0, gunIn = 0, laserIn = 0, bossNear = 0;
    const fR = plow === 'volt' ? s.clapRadius * 0.8 : plow === 'brute' ? s.poundRadius * 0.7 : plow === 'isotope' ? s.meltRadius * 0.7 : plow === 'arsenal' ? 14 : plow === 'revenant' ? (s.graspRange || 20) * 0.7 : s.flameRange * 0.9;
    const ranged = plow === 'arsenal' || plow === 'volt' || plow === 'isotope';
    for (const e of en.list) {
      if (!e.alive) continue;
      // THE WHITEOUT's eye: a target only when it can be hurt (staggered; open = ranged chip).
      if (e === W.eye && !(W.eyeMode === 'stagger' || (W.eyeMode === 'open' && ranged))) continue;
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
    // PHANTOM: PHASE straight through the target ahead (Haunts it, souls for SOUL GRASP; MANIFEST bursts after).
    if (plow === 'revenant') {
      if (p.whirlReady >= 1 && sameT && !routed && bd < 9 && Math.abs(bdiff) < 0.35) tap('KeyE');
      else if (p.dashReady >= 1 && !routed && sameT && bd > 9 && bd < 16 && Math.abs(diffA) < 0.15) tap('ShiftLeft');
      return;
    }
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
      // THE WHITEOUT closes wave 7's record and opens the finale's (wave 8).
      if (W.active && P.round && P.round.wave !== 8) { P.rounds.push(P.round); P.round = null; }
      if (!P.round) { P.round = newRound(W.active || g.protocolFinale ? 8 : g.roundIndex + 1); if (P.round.wave === 8) P.fin = { ph: {}, staggers: 0, last: '' }; }
      ap();
    }
    g.tick(1 / 60);
    P.frames++;
    const R = P.round;
    if (P.fin && W.active) {
      const f = P.fin;
      f.ph[W.phase] = (f.ph[W.phase] ?? 0) + 1 / 60;
      if (W.phase === 'stagger' && f.last !== 'stagger') f.staggers++;
      f.last = W.phase;
      f.bursts = W.ball.bursts;
    }
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
    if (now === 'playing' && R && R.wave === 8 && R.t >= P.cap * 2) {
      R.timeout = true;
      P.rounds.push(R);
      P.round = null;
      P.done = true;
      return;
    }
    if (now === 'playing' && R && R.wave < 8 && !W.active && R.t >= P.cap) {
      R.timeout = true;
      c.enemies.clear();
      c.waves.clear();
      g.roundCleared();
    }
    const after = g.state;
    if ((after === 'shop' || after === 'victory') && P.round) {
      P.rounds.push(P.round);
      P.round = null;
      if (after === 'victory' || g.roundIndex + 1 >= w1) { P.done = true; return; }
      const cb = window.__shopCb;
      window.__shopCb = null;
      cb?.();
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
      spent, k,
      echoSweep: P.echo6[1] >= 0 ? +(P.echo6[1] - P.echo6[0]).toFixed(1) : null,
      chairman: P.chair[1] >= 0 ? +(P.chair[1] - P.chair[0]).toFixed(1) : null,
      finale: P.fin ? {
        won: g.state === 'victory', bursts: P.fin.bursts ?? 0, staggers: P.fin.staggers,
        ph: Object.fromEntries(Object.entries(P.fin.ph).map(([k, v]) => [k, +v.toFixed(1)])),
        hearts: +((P.fin.ph.hearts ?? 0) + (P.fin.ph.lean ?? 0) + (P.fin.ph.recover ?? 0)).toFixed(1),
        staggerT: +(P.fin.ph.stagger ?? 0).toFixed(1), avalanche: +(P.fin.ph.avalanche ?? 0).toFixed(1),
        hpLost: Math.round(P.rounds.find((r) => r.wave === 8)?.hpLost ?? 0), deaths: P.rounds.find((r) => r.wave === 8)?.deaths ?? 0,
        broken: W.broken, cycle: W.cycle, eye: W.eye ? [Math.round(W.eye.hp), Math.round(W.eye.maxHp)] : null,
      } : null,
      dmg: Object.fromEntries(Object.entries(dmg).map(([k, v]) => [k, Math.round(v)])),
      rounds: P.rounds.map((r) => ({
        wave: r.wave, t: +r.t.toFixed(1), hpLost: Math.round(r.hpLost), deaths: r.deaths, timeout: r.timeout, ults: r.ults, fUses: r.fUses,
        otherLevel: r.botFrames ? +(r.otherBotFrames / r.botFrames).toFixed(3) : 0,
        stuck: +r.stuck.toFixed(2), stuckFree: +r.stuckFree.toFixed(2), unsticks: r.unsticks ?? 0, stalls: r.stalls ?? 0, detour: +((r.detourFrames ?? 0) / 60).toFixed(1),
        dmg: Object.fromEntries(Object.entries(r.dmg).map(([k, v]) => [k, Math.round(v)])),
      })),
      errors: P.errors,
    };
  };
  const s = c.stats;
  return {
    zone: c.zone.name, levelsMatch, spent, k,
    stats: { plow: s.plowKind, maxHp: Math.round(s.maxHp), damageTaken: +s.damageTaken.toFixed(3), damageMult: +s.damageMult.toFixed(2), maxSpeed: +s.maxSpeed.toFixed(1), gunDamage: s.gunDamage, gunRange: s.gunRange, laserDps: s.laserDps, missileDamage: s.missileDamage },
  };
}

/* ------------------------------------------------------------------ driver */
const port = Number(process.env.PORT) || 5300 + Math.floor(Math.random() * 600);
// fs.allow: a git worktree reads node_modules through a symlink into the main checkout.
const server = await createServer({ root, configFile: false, server: { port, strictPort: true, hmr: false, watch: null, fs: { allow: [resolve(root, '..', '..', '..'), root] } }, logLevel: 'error' });
await server.listen();
const exe = process.env.PW_EXE || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);
const launch = () => chromium.launch({ ...(exe ? { executablePath: exe } : { channel: 'chrome' }), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let browser = await launch();

const done = flag('resume') ? loadRuns() : [];
const jobs = [];
for (let run = 0; run < RUNS; run++)
  for (const tier of TIERS)
    for (const plow of PLOWS) {
      for (const spec of FOCI) {
        const focus = focusFor(spec, plow);
        const have = done.filter((r) => r.tier === tier && r.plow === plow && r.w0 === W0 && (r.focus ?? '-') === focus.label).length;
        if (have > run) continue;
        jobs.push({ tier, plow, run, focus });
      }
    }
console.log(`protocol-probe: waves ${W0}-${W1}, ${jobs.length} runs, par ${PAR}, cap ${CAP}s, out ${OUT}`);

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
    const setup = await page.evaluate(pageSetup, { w0: W0, w1: W1, plow: job.plow, tier: job.tier, tiers: TIER_SRC, cap: CAP, focus: job.focus });
    if (setup.levelsMatch !== true) console.log(`  WARN levels ${job.plow}/${job.tier}: ${setup.levelsMatch}`);
    let st;
    const maxChunks = Math.ceil((CAP * 10 * 60 + 4000) / 1200);
    for (let i = 0; i < maxChunks; i++) {
      st = await page.evaluate(() => window.__chunk(1200));
      if (st.done) break;
    }
    const res = await page.evaluate(() => window.__result());
    const rec = { w0: W0, w1: W1, tier: job.tier, plow: job.plow, focus: job.focus.label, run: job.run, zone: setup.zone, stats: setup.stats, levelsMatch: setup.levelsMatch, finished: !!st?.done, wall: Math.round((Date.now() - t0) / 1000), ...res, errors: [...res.errors, ...errors.slice(0, 10)] };
    appendFileSync(RUNS_FILE, JSON.stringify(rec) + '\n');
    const fin = rec.finale ? ` finale ${rec.finale.won ? 'WON' : 'unfinished'} hearts ${rec.finale.hearts}s staggers ${rec.finale.staggers} (${rec.finale.staggerT}s) avalanche ${rec.finale.avalanche}s bursts ${rec.finale.bursts}` : '';
    console.log(`RUN w${W0}-${W1} ${job.tier} ${job.plow} [focus ${job.focus.label}] #${job.run + 1} (spent ${rec.spent}, k ${rec.k.toFixed(2)}, ${rec.stats.maxHp} HP): total ${rec.total}s [${rec.rounds.map((r) => `w${r.wave} ${r.t}${r.timeout ? '!' : ''}/-${r.hpLost}${r.deaths ? '/x' + r.deaths : ''}`).join(' ')}] sweep ${rec.echoSweep} chair ${rec.chairman}${fin} wall ${rec.wall}s${rec.errors.length ? ' ERR ' + rec.errors[0].slice(0, 120) : ''}`);
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
        console.log(`  RETRY ${job.tier} ${job.plow}: ${String(e.message).split('\n')[0]}`);
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
