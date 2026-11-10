// Duel round-robin: REAL online Duels in the browser between two autopiloted players (both fight back and move).
//   node scripts/duel-matrix.mjs [--plows classic,volt,brute,isotope,arsenal] [--tiers fresh,mid,high] [--rounds 6]
//                                [--mirrors] [--par 2] [--round-secs 90] [--out DIR] [--resume] [--report-only]
// Every unordered pair of distinct plows (plus X vs X with --mirrors) per tier plays --rounds individual rounds over
// the real duel flow (connect over the BroadcastChannel transport ?duel=local, DUEL GARAGE, READY, best-of-3
// matches, REMATCH for more). Half the rounds have plow A on the host, half on the guest (side bias cancels; the
// guest drives through the netcode). Both sides get the SAME tier: garage levels + gear exactly as
// scripts/balance/sim.ts levelsFor (LINE / TIER_DEF / the core four are read out of sim.ts, as omega-probe does).
// Catch-up coins are zeroed: each side is handed unspent coins so both garages are worth the same (coins never
// change stats), so duelBonus pays nobody. The game's AutoPilot (src/duel/plumbing.ts) drives both plows.
// Rounds are de-correlated by re-rolling each AutoPilot's wander / F-timer phase every round (the sim is deterministic).
// The duel clock is sim time: both pages are ticked in lockstep from here (4-frame slices, render loops off).
// Countdown / between-round / garage timings are shortened; the round timer stays at DUEL_ROUND_SECONDS (90 s)
// unless --round-secs says otherwise. A fresh Chrome per pairing (the sandbox kills long-lived headless Chrome);
// each side-orientation gets a fresh browser context (new room code -> its own venue).
// Output: DIR/runs.jsonl (one line per round; --resume appends and skips what's there, otherwise it starts over)
// and DIR/summary.md (printed at the end). Default DIR: <tmpdir>/duel-matrix.
// Chromium: PW_EXE (default /opt/pw-browsers/chromium if it exists, else the 'chrome' channel).
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);
const ALL_PLOWS = ['classic', 'volt', 'brute', 'isotope', 'arsenal'];
const PLOWS = opt('plows', ALL_PLOWS.join(',')).split(',');
const TIERS = opt('tiers', 'fresh,mid,high').split(',');
const ROUNDS = Number(opt('rounds', '6'));
const PAR = Number(opt('par', '2'));
const ROUND_SECS = Number(opt('round-secs', '90'));
const MIRRORS = flag('mirrors');
const SLICE = 4;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = opt('out', resolve(tmpdir(), 'duel-matrix'));
mkdirSync(OUT, { recursive: true });
const RUNS_FILE = `${OUT}/runs.jsonl`;

/* ------------------------------------------------------------------ tiers, read out of scripts/balance/sim.ts */
function readTierDefs() {
  const src = readFileSync(resolve(root, 'scripts/balance/sim.ts'), 'utf8');
  const grab = (re, what) => {
    const m = src.match(re);
    if (!m) throw new Error(`duel-matrix: could not find ${what} in scripts/balance/sim.ts`);
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
const r1 = (x) => (Number.isFinite(x) ? (Math.round(x * 10) / 10).toFixed(1) : '-');
const pct = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '-');
function loadRuns() {
  if (!existsSync(RUNS_FILE)) return [];
  return readFileSync(RUNS_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
/** Score of plow `p` in round `r` (1 win, 0.5 draw, 0 loss); null if `p` didn't play it. */
const scoreOf = (r, p) => (r.host !== p && r.guest !== p ? null : r.winner === null ? 0.5 : r.winner === p ? 1 : 0);
function report() {
  const runs = loadRuns().filter((r) => TIERS.includes(r.tier) && PLOWS.includes(r.host) && PLOWS.includes(r.guest));
  const lines = ['# Duel matrix (real online duels, both sides autopiloted)', ''];
  const tiers = TIERS.filter((t) => runs.some((r) => r.tier === t));
  const plows = PLOWS.filter((p) => runs.some((r) => r.host === p || r.guest === p));
  for (const tier of tiers) {
    const rs = runs.filter((r) => r.tier === tier);
    const duels = rs.filter((r) => r.host !== r.guest);
    lines.push(`## ${tier}`, '');
    // (a) win-rate matrix: row beats column (draws count half).
    lines.push('Win rate, row vs column (draws = half a win; n rounds in brackets):', '');
    lines.push(`| | ${plows.join(' | ')} |`, `|---|${plows.map(() => '---').join('|')}|`);
    for (const a of plows) {
      const cells = plows.map((b) => {
        const m = rs.filter((r) => (r.host === a && r.guest === b) || (r.host === b && r.guest === a));
        if (!m.length) return '-';
        if (a === b) {
          const hw = m.filter((r) => r.winnerSide === 'host').length + 0.5 * m.filter((r) => !r.winnerSide).length;
          return `mirror: host ${pct(hw / m.length)} (${m.length})`;
        }
        return `${pct(mean(m.map((r) => scoreOf(r, a))))} (${m.length})`;
      });
      lines.push(`| **${a}** | ${cells.join(' | ')} |`);
    }
    lines.push('');
    // (b) overall ranking (mirrors excluded).
    const rank = plows.map((p) => {
      const mine = duels.filter((r) => r.host === p || r.guest === p);
      const wins = mine.filter((r) => r.winner === p);
      return {
        p, n: mine.length, wr: mean(mine.map((r) => scoreOf(r, p))),
        w: wins.length, l: mine.filter((r) => r.winner && r.winner !== p).length, d: mine.filter((r) => r.winner === null).length,
        wt: mean(wins.map((r) => r.ttk ?? r.secs)), hp: mean(wins.map((r) => r.winnerHpFrac)),
        to: mine.filter((r) => r.timeout).length,
        dmg: mean(mine.map((r) => (r.host === p ? r.dmg?.host : r.dmg?.guest) ?? NaN)),
        taken: mean(mine.map((r) => (r.host === p ? r.dmg?.guest : r.dmg?.host) ?? NaN)),
      };
    }).filter((x) => x.n).sort((x, y) => y.wr - x.wr);
    lines.push('Overall (mirrors excluded):', '');
    lines.push('| # | plow | win rate | W-L-D | avg time to wreck when winning (s) | avg HP left when winning | dmg dealt / taken per round | time-outs |');
    lines.push('|---|---|---|---|---|---|---|---|');
    rank.forEach((x, i) => lines.push(`| ${i + 1} | ${x.p} | ${pct(x.wr)} | ${x.w}-${x.l}-${x.d} | ${r1(x.wt)} | ${pct(x.hp)} | ${Math.round(x.dmg)} / ${Math.round(x.taken)} | ${x.to}/${x.n} |`));
    lines.push('');
    // (c) what each plow actually did per round (audit: does every kit fire its F / ultimate, land hits, from what).
    const acted = duels.filter((r) => r.act);
    if (acted.length) {
      lines.push('Per round, as attacker (all rounds incl. mirrors; F = F abilities fired, ult = ultimates fired; hits by source slam / ram / whirl / other):', '');
      lines.push('| plow | as host: F / ult / slams / hits | as guest: F / ult / slams / hits | hits by source |', '|---|---|---|---|');
      for (const p of plows) {
        const fmt = (side) => {
          const a = rs.filter((r) => r.act && r[side] === p).map((r) => r.act[side]);
          if (!a.length) return { s: '-', src: null };
          const m = (k) => r1(mean(a.map((x) => x[k])));
          return { s: `${m('abil')} / ${m('nukes')} / ${m('slams')} / ${m('hits')} (${a.length})`, src: a.map((x) => x.src) };
        };
        const H = fmt('host'), G = fmt('guest');
        const all = [...(H.src ?? []), ...(G.src ?? [])];
        const src = all.length ? [0, 1, 2, 3].map((j) => r1(mean(all.map((x) => x[j])))).join(' / ') : '-';
        lines.push(`| ${p} | ${H.s} | ${G.s} | ${src} |`);
      }
      lines.push('');
    }
    const hostW =duels.filter((r) => r.winnerSide === 'host').length, guestW = duels.filter((r) => r.winnerSide === 'guest').length;
    const to = rs.filter((r) => r.timeout).length;
    const pairs = new Set(duels.map((r) => [r.host, r.guest].sort().join('|'))).size;
    lines.push(`Sample: ${rs.length} rounds (${duels.length} non-mirror over ${pairs} pairings, ~${duels.length ? Math.round(duels.length / Math.max(1, pairs)) : 0} per pairing). Time-outs: ${to}. Side bias: host won ${hostW}, guest won ${guestW} (sides are swapped half the time, so this cancels in the matrix). Venues: ${[...new Set(rs.map((r) => r.venue))].join(', ')}.`);
    const n = duels.length ? Math.round(duels.length / Math.max(1, pairs)) : 0;
    if (n) lines.push(`With ${n} rounds per pairing a cell's 95% interval is about ±${Math.round(98 / Math.sqrt(n))} points; an overall rate (${rank[0]?.n ?? 0} rounds) about ±${Math.round(98 / Math.sqrt(rank[0]?.n || 1))}.`);
    lines.push('');
  }
  const errs = runs.filter((r) => r.errors?.length);
  // Independence check: an exact repeat (same plows, sides, time to wreck and damage both ways) is a replayed round.
  const seen = new Set();
  const dup = runs.filter((r) => { const k = JSON.stringify([r.tier, r.host, r.guest, r.ttk, r.secs, r.dmg]); if (seen.has(k)) return true; seen.add(k); return false; }).length;
  lines.push(`Repeated rounds (identical to an earlier one): ${dup} of ${runs.length}${dup ? ' - WARNING: those are replays, not independent samples' : ''}.`, '');
  if (errs.length) lines.push(`Rounds with page errors: ${errs.length} (first: ${errs[0].errors[0].slice(0, 160)})`, '');
  lines.push('Autopilot: src/duel/plumbing.ts AutoPilot on both sides. It wanders to gather snow while its ball is small and the foe is out of reach (9 m, or its held primary\'s reach if longer), otherwise steers straight at the foe; slams (SPACE) when facing within 6.5 m, holds SPACE within its held primary\'s real reach (autoHoldRange: Arc Lance / Rad Sprayer / Mag Shotgun / Wrecking Fist; 9 m for the Classic), dashes when facing at 6-15 m, whirls (E) within 5.5 m (ARSENAL: Mag Repulsor when facing within 90% of its wave\'s reach), presses its ability (F) every 2.5 s within 9 m. It never kites, retreats, dodges or keeps range on purpose and never saves or times its ability, so plows built for range or burst timing are under-played and brawlers flattered.');
  writeFileSync(`${OUT}/summary.md`, lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}
if (flag('report-only')) {
  report();
  process.exit(0);
}

/* ------------------------------------------------------------------ page-side code */
/** In the page: garage for (plow, tier) in memory (no saves: both pages share one localStorage), shortened duel cfg.
 *  Returns the garage value (what duelBonus compares) and a levels cross-check against sim.ts. */
async function pageGarage({ plow, tier, tiers, name, roundSecs }) {
  const g = window.__game, pr = g.ctx.progression;
  g.setLoop(false);
  pr.save = () => {};
  const t = tiers.TIER_DEF[tier];
  const ups = {};
  for (const id of tiers.CORE) if (t.core) ups[id] = t.core;
  for (const id of tiers.LINE[plow]) if (t.line) ups[id] = t.line;
  pr.data.upgrades = ups;
  pr.data.gear = { owned: { ...t.gear }, equipped: Object.keys(t.gear) };
  pr.data.plow = plow;
  pr.data.coins = 0;
  const duel = await import('/src/config/duel.ts');
  const levels = duel.cleanLevels(pr.effectiveLevels());
  const eq = {};
  for (const id of pr.gear.equipped) if (pr.itemLevel(id) > 0) eq[id] = pr.itemLevel(id);
  const spent = duel.duelSpent(levels, duel.cleanDuelGear(eq));
  let levelsMatch = null;
  try {
    const sim = await import('/scripts/balance/sim.ts');
    const want = sim.levelsFor(plow, tier);
    const keys = new Set([...Object.keys(want), ...Object.keys(levels)]);
    levelsMatch = [...keys].every((k) => (want[k] ?? 0) === (levels[k] ?? 0));
  } catch (e) {
    levelsMatch = `sim.ts import failed: ${e.message}`;
  }
  Object.assign(g.duel.cfg, { garageSeconds: 20, rematchGarageSeconds: 20, countdown: 1.2, betweenRounds: 0.5, roundSeconds: roundSecs });
  g.duel.playerName = name;
  g.duel.autopilot = true;
  return { spent, levelsMatch };
}

/** One lockstep slice on a page; the host also reports what the driver needs to follow the round flow. */
function pageSlice(n) {
  const g = window.__game;
  for (let i = 0; i < n; i++) g.tick(1 / 60);
  const d = g.duel;
  // The duel sim is deterministic (gameplay never rolls dice; Math.random only feeds effects), so two AutoPilots
  // replay the very same round from the same start: a re-run leg, a mirror's second leg or a retry repeats rounds
  // exactly and "n rounds" would not be n samples. Each round (entering the countdown) re-rolls this side's AutoPilot
  // phase: its wander clock (sin(t * 0.7), period ~9 s) and its F timer (every 2.5 s). Pilot-side only; the
  // game rules, stats and spawns are untouched.
  if (d.phase === 'countdown' && window.__dmPrev !== 'countdown') {
    const a = d.auto;
    if (!a || typeof a.t !== 'number' || typeof a.fT !== 'number') throw new Error('duel-matrix: AutoPilot fields t / fT not found');
    a.t = Math.random() * ((2 * Math.PI) / 0.7);
    a.fT = Math.random() * 2.5;
  }
  window.__dmPrev = d.phase;
  if (d.role !== 'host') return { phase: d.phase };
  const me = g.ctx.plow, op = d.opponent;
  return {
    phase: d.phase, round: d.round, score: [...d.score], nRounds: d.counters.rounds.length, last: d.counters.rounds.at(-1) ?? null,
    hp: [me.hp, op?.hp ?? 0], maxHp: [me.maxHp, op?.maxHp ?? 1], dead: [!!me.dead, !!op?.dead], dmg: [...d.counters.damage], hits: [...d.counters.hits],
    slams: [...d.counters.slams], abil: [...d.counters.abilities], nukes: [...d.counters.nukes], src: d.counters.bySource.map((x) => [...x]),
    ready: [...d.ready], bonus: [...d.bonus], venue: g.ctx.zone?.name,
  };
}

/* ------------------------------------------------------------------ driver */
const port = Number(process.env.PORT) || 7400 + Math.floor(Math.random() * 500);
// node_modules may sit above the repo root (a separate checkout): let Vite serve it (the HUD fonts) without a 403.
const nodeModules = resolve(dirname(createRequire(import.meta.url).resolve('vite/package.json')), '..');
const server = await createServer({ root, server: { port, strictPort: true, hmr: false, watch: null, fs: { allow: [root, nodeModules] } }, logLevel: 'error' });
await server.listen();
const exe = process.env.PW_EXE || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : null);
const launch = () => chromium.launch({ ...(exe ? { executablePath: exe } : { channel: 'chrome' }), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

// Without --resume a run starts a fresh runs.jsonl (the old one is kept as runs.prev.jsonl).
if (!flag('resume') && existsSync(RUNS_FILE)) renameSync(RUNS_FILE, `${OUT}/runs.prev.jsonl`);
const done = flag('resume') ? loadRuns() : [];
const half = (i) => (i === 0 ? Math.ceil(ROUNDS / 2) : Math.floor(ROUNDS / 2));
const jobs = [];
for (const tier of TIERS)
  for (let i = 0; i < PLOWS.length; i++)
    for (let j = i + (MIRRORS ? 0 : 1); j < PLOWS.length; j++) {
      const a = PLOWS[i], b = PLOWS[j];
      // Orientation 0: a hosts; 1: b hosts. A mirror's orientations are the same plows, so count them together.
      const legs = [];
      for (const o of [0, 1]) {
        const [h, g] = o === 0 ? [a, b] : [b, a];
        const have = a === b ? Math.max(0, done.filter((r) => r.tier === tier && r.host === a && r.guest === a).length - (o === 1 ? half(0) : 0)) : done.filter((r) => r.tier === tier && r.host === h && r.guest === g).length;
        const need = half(o) - have;
        if (need > 0) legs.push({ host: h, guest: g, need });
      }
      if (legs.length) jobs.push({ tier, a, b, legs });
    }
const totalRounds = jobs.reduce((s, j) => s + j.legs.reduce((t, l) => t + l.need, 0), 0);
console.log(`duel-matrix: ${jobs.length} pairings, ${totalRounds} rounds to play, par ${PAR}, round timer ${ROUND_SECS}s, out ${OUT}`);

/** Play one side-orientation: connect two fresh pages, then fight until `need` rounds are recorded. */
async function playLeg(browser, tier, leg, onRound) {
  const ctx = await browser.newContext({ viewport: { width: 480, height: 270 } });
  const errors = [];
  try {
    const open = async (tag) => {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('GPU stall')) errors.push(`[${tag}] ${m.text()}`); });
      await page.goto(`http://localhost:${port}/?duel=local`, { waitUntil: 'load', timeout: 120000 });
      await page.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
      return page;
    };
    const host = await open('host');
    const guest = await open('guest');
    const ga = await host.evaluate(pageGarage, { plow: leg.host, tier, tiers: TIER_SRC, name: 'HOST', roundSecs: ROUND_SECS });
    const gb = await guest.evaluate(pageGarage, { plow: leg.guest, tier, tiers: TIER_SRC, name: 'GUEST', roundSecs: ROUND_SECS });
    for (const [p, s] of [[leg.host, ga], [leg.guest, gb]]) if (s.levelsMatch !== true) console.log(`  WARN levels ${p}/${tier}: ${s.levelsMatch}`);
    // Zero catch-up: top both garages up to the same value with unspent coins.
    const target = Math.max(ga.spent, gb.spent);
    await host.evaluate((c) => (window.__game.ctx.progression.data.coins = c), target - ga.spent);
    await guest.evaluate((c) => (window.__game.ctx.progression.data.coins = c), target - gb.spent);
    const code = await host.evaluate(async () => { window.__game.openDuelLobby(); return window.__game.hostDuel(); });
    if (!code) throw new Error('hostDuel failed');
    const joined = await guest.evaluate(async (c) => { window.__game.openDuelLobby(); return window.__game.joinDuel(c); }, code);
    if (!joined) throw new Error('joinDuel failed');

    let fightStart = 0, wreckAt = null, base = null, simT = 0, lastProgress = 0, nRounds = 0, readied = '', asked = false, h;
    const t0 = Date.now();
    // onRound decrements leg.need (so a retry only plays what's still missing).
    while (leg.need > 0) {
      h = await host.evaluate(pageSlice, SLICE);
      const g = await guest.evaluate(pageSlice, SLICE);
      simT += SLICE / 60;
      if (h.phase === 'garage' && g.phase === 'garage') {
        const key = `${nRounds}`;
        if (readied !== key) {
          if (h.bonus[0] || h.bonus[1]) errors.push(`catch-up not zero: ${h.bonus}`);
          await guest.evaluate(() => window.__game.duel.setReady());
          await host.evaluate(() => window.__game.duel.setReady());
          readied = key;
          asked = false;
        }
      } else if (h.phase === 'results' && g.phase === 'results' && !asked) {
        await guest.evaluate(() => window.__game.duel.askRematch());
        await host.evaluate(() => window.__game.duel.askRematch());
        asked = true;
        readied = '';
      }
      if (h.phase === 'fight') {
        if (fightStart === 0) { fightStart = simT; wreckAt = null; }
        if (wreckAt === null && (h.dead[0] || h.dead[1])) wreckAt = simT - fightStart;
      }
      if (h.nRounds > nRounds) {
        nRounds = h.nRounds;
        const L = h.last;
        // Per-round deltas of the host's cumulative counters (index 0 host, 1 guest; by attacker). The baseline is the
        // previous round's end (counters only reset on connect), so nothing landing in the fight's first slice is lost.
        const b0 = base ?? { dmg: [0, 0], hits: [0, 0], slams: [0, 0], abil: [0, 0], nukes: [0, 0], src: [[0, 0, 0, 0], [0, 0, 0, 0]] };
        const dlt = (k, i) => Math.round(h[k][i] - b0[k][i]);
        const side = (i) => ({ dmg: dlt('dmg', i), hits: dlt('hits', i), slams: dlt('slams', i), abil: dlt('abil', i), nukes: dlt('nukes', i), src: h.src[i].map((v, j) => v - b0.src[i][j]) });
        base = { dmg: h.dmg, hits: h.hits, slams: h.slams, abil: h.abil, nukes: h.nukes, src: h.src };
        const sh = side(0), sg = side(1);
        const winSide = L.winner === 0 ? 'host' : L.winner === 1 ? 'guest' : null;
        const wi = L.winner;
        const rec = {
          tier, host: leg.host, guest: leg.guest, round: h.round, reason: L.reason,
          winnerSide: winSide, winner: winSide ? leg[winSide] : null,
          secs: L.secs, ttk: wreckAt === null ? null : Math.round(wreckAt * 10) / 10,
          timeout: L.reason === 'time' || (L.reason === 'draw' && wreckAt === null),
          winnerHpFrac: wi >= 0 ? Math.max(0, Math.round((h.hp[wi] / h.maxHp[wi]) * 1000) / 1000) : null,
          hpFrac: [0, 1].map((i) => Math.max(0, Math.round((h.hp[i] / h.maxHp[i]) * 1000) / 1000)), maxHp: h.maxHp.map(Math.round),
          dmg: { host: sh.dmg, guest: sg.dmg },
          // F presses that fired (abil; nukes = ISOTOPE NUKE), slams, hits landed and hits by source [slam, ram, whirl, other].
          act: { host: { hits: sh.hits, slams: sh.slams, abil: sh.abil, nukes: sh.nukes, src: sh.src }, guest: { hits: sg.hits, slams: sg.slams, abil: sg.abil, nukes: sg.nukes, src: sg.src } },
          venue: h.venue, code, wall: Math.round((Date.now() - t0) / 1000), errors: errors.splice(0, 5),
        };
        fightStart = 0;
        lastProgress = simT;
        onRound(rec);
      }
      // A stuck flow (no round recorded for a long while of sim time) aborts the leg; the retry starts fresh.
      if (simT - lastProgress > ROUND_SECS + 90) throw new Error(`no progress: host ${h.phase} guest ${g.phase} after ${Math.round(simT)}s sim`);
    }
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function runJob(job) {
  const browser = await launch();
  try {
    for (const leg of job.legs) {
      await playLeg(browser, job.tier, leg, (rec) => {
        appendFileSync(RUNS_FILE, JSON.stringify(rec) + '\n');
        leg.need--;
        console.log(`ROUND ${job.tier} ${rec.host}(H) v ${rec.guest}(G) r${rec.round}: ${rec.winner ? `${rec.winner} wins` : 'DRAW'} (${rec.reason}${rec.timeout ? ', TIME-OUT' : ''}) ttk ${rec.ttk ?? '-'}s hp ${rec.winnerHpFrac ?? '-'} dmg H${rec.dmg.host}/G${rec.dmg.guest} wall ${rec.wall}s${rec.errors.length ? ' ERR ' + rec.errors[0].slice(0, 120) : ''}`);
      });
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

let next = 0;
const T0 = Date.now();
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++];
    for (let tries = 0; ; tries++) {
      try {
        await runJob(job);
        break;
      } catch (e) {
        console.log(`  RETRY ${job.tier} ${job.a} v ${job.b}: ${String(e.message).split('\n')[0]}`);
        job.legs = job.legs.filter((l) => l.need > 0);
        if (tries >= 2 || !job.legs.length) break;
      }
    }
    console.log(`  pairing ${job.tier} ${job.a} v ${job.b} done (${Math.round((Date.now() - T0) / 1000)}s elapsed)`);
  }
}
await Promise.all(Array.from({ length: Math.max(1, PAR) }, worker));
await server.close();
console.log('');
report();
process.exit(0);
