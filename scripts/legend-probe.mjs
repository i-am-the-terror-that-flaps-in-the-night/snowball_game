// Legend balance probe: node scripts/legend-probe.mjs [difficulty=legend] [level=5] [plow=classic|volt|brute] [runs=1]
// A player with every endless upgrade at `level` (+ specials when level > 0) driven by a simple aggressive autopilot
// plays full simulated brawls. Every endless upgrade includes the chosen plow's own line (Inferno for Classic, the
// 'volt' category for VOLT-9, the 'brute' category for BRUTUS); other plows' lines are inert while not driving them.
// The autopilot uses F the way each plow wants: Inferno when a bot is in the cone, Thunderclap when bots are in the
// storm radius and Overload heat is low, Ground Pound when bots are inside the inner part of the ring.
// Reports placement, K/D, damage dealt/taken, average life length, F-ability share of damage, bot streaks.
// Port: PORT env (default 5180 + random) so parallel probes don't clash.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const diff = process.argv[2] || 'legend';
const level = Number(process.argv[3] ?? '5');
const plowKind = process.argv[4] || 'classic';
const runs = Number(process.argv[5] ?? '1');
// NOF=1: autopilot never uses F (to measure what the F ability is worth).
const noF = !!process.env.NOF;
const port = Number(process.env.PORT) || 5180 + Math.floor(Math.random() * 400);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const server = await createServer({ root, server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const errors = [];

const all = [];
// Fresh browser per run (headless Chrome occasionally dies when several probes run in parallel; retry those).
for (let run = 0, tries = 0; run < runs; ) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
  const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const setup = await page.evaluate(([diff, level, plowKind, noF]) => {
    const g = window.__game, c = g.ctx, pr = c.progression;
    window.__noF = noF;
    for (const u of pr.constructor.upgrades) pr.data.upgrades[u.id] = u.maxLevel === Infinity ? level : level > 0 ? 1 : 0;
    pr.setPlow(plowKind);
    g.startBrawl(diff);
    for (let i = 0; i < 300; i++) g.tick(1 / 60);
    const P = (window.__P = { streakEvents: [], hunterSamples: [], dmgTaken: 0, dmgDealt: 0, dmgF: 0, aliveFrames: 0, frames: 0, fUses: 0 });
    c.events.on('brawlStreak', (e) => P.streakEvents.push(`${e.name}:${e.count}`));
    c.events.on('plowDamaged', (e) => (P.dmgTaken += e.amount));
    // Damage dealt by the player; F-ability damage is tagged by wrapping the Combat methods that deal it.
    window.__inF = 0;
    c.events.on('enemyHit', (e) => { P.dmgDealt += e.damage; if (window.__inF) P.dmgF += e.damage; });
    const proto = Object.getPrototypeOf(c.combat);
    for (const m of ['updateFlame', 'updateBurns', 'updateClap', 'updateStorm', 'poundImpact']) {
      const orig = proto[m];
      if (!orig || orig.__wrapped) continue;
      proto[m] = function (...a) { window.__inF++; try { return orig.apply(this, a); } finally { window.__inF--; } };
      proto[m].__wrapped = true;
    }
    const keys = {};
    const set = (code, on) => { if (!!keys[code] === on) return; keys[code] = on; window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code })); };
    const tap = (code) => { set(code, false); set(code, true); };
    window.__ap = () => {
      const p = c.plow, b = c.brawl, s = c.stats, cb = c.combat;
      for (const k of ['Space', 'ShiftLeft', 'KeyE', 'KeyF']) if (keys[k]) set(k, false);
      if (p.dead) { for (const k of ['KeyW', 'KeyA', 'KeyD']) set(k, false); return; }
      let best = null, bd = 1e9, near = 0, inF = 0;
      const fR = s.plowKind === 'volt' ? s.clapRadius * 0.8 : s.plowKind === 'brute' ? s.poundRadius * 0.7 : s.flameRange * 0.9;
      for (const r of b.rivals) {
        if (!r.alive) continue;
        const d = Math.hypot(r.position.x - p.position.x, r.position.z - p.position.z);
        if (d < 7) near++;
        if (d < fR) inF++;
        if (d < bd) { bd = d; best = r; }
      }
      if (!best) { set('KeyW', false); return; }
      const want = Math.atan2(best.position.x - p.position.x, best.position.z - p.position.z);
      const diffA = Math.atan2(Math.sin(want - p.heading), Math.cos(want - p.heading));
      set('KeyW', true);
      set('KeyA', diffA > 0.08);
      set('KeyD', diffA < -0.08);
      let useF = false;
      if (cb.flameReady >= 1 && !window.__noF) {
        if (s.plowKind === 'classic') useF = bd < fR && Math.abs(diffA) < 0.5;
        else if (s.plowKind === 'volt') useF = inF >= 1 && cb.overloadHeat < 0.6 && p.hp > p.maxHp * 0.25;
        else useF = inF >= 1;
      }
      if (useF) { tap('KeyF'); P.fUses++; }
      else if (p.heldBallRadius >= 0.5 && bd < 5.5 && Math.abs(diffA) < 0.45) tap('Space');
      else if (p.dashReady >= 1 && bd > 6 && bd < 14 && Math.abs(diffA) < 0.15) tap('ShiftLeft');
      else if (p.whirlReady >= 1 && near >= 1 && bd < 5) tap('KeyE');
    };
    const s = c.stats;
    return {
      player: { plow: s.plowKind, hp: Math.round(s.maxHp), taken: +s.damageTaken.toFixed(3), effHp: Math.round(s.maxHp / s.damageTaken), dmgMult: +s.damageMult.toFixed(2), ram: Math.round(s.ramDamage), speed: +s.maxSpeed.toFixed(1), momentum: s.momentum, shield: s.shieldMax },
      rivals: c.brawl.rivals.map((r) => ({ name: r.f.entry.name, hp: Math.round(r.maxHp), dmg: +r.s.dmgMult.toFixed(2), elite: r.s.elite })),
    };
  }, [diff, level, plowKind, noF]);
  if (run === 0) {
    console.log('PLAYER', JSON.stringify(setup.player));
    console.log('RIVALS', setup.rivals.map((r) => `${r.name}(${r.hp}${r.elite ? '*' : ''})`).join(' '));
  }
  let res;
  for (let chunk = 0; chunk < 14; chunk++) {
    res = await page.evaluate(() => {
      const g = window.__game, c = g.ctx, b = c.brawl, P = window.__P;
      for (let i = 0; i < 1500 && !b.over; i++) {
        window.__ap();
        g.tick(1 / 60);
        P.frames++;
        if (!c.plow.dead) P.aliveFrames++;
        if (i % 60 === 0) {
          let h = 0;
          for (const r of b.rivals) if (r.alive && r.mode === 'fight' && r.target && r.target.entry.isPlayer) h++;
          P.hunterSamples.push(h);
        }
      }
      return { over: b.over };
    });
    if (res.over) break;
  }
  const fin = await page.evaluate(() => {
    const P = window.__P, b = window.__game.ctx.brawl;
    const hs = P.hunterSamples;
    const r = b.result;
    const deaths = r ? r.deaths : 0;
    return {
      placement: r?.placement, kills: r?.kills, deaths, best: r?.bestStreak,
      time: +(P.frames / 60).toFixed(0), dealt: Math.round(P.dmgDealt), fShare: +(P.dmgF / Math.max(1, P.dmgDealt)).toFixed(2), fUses: P.fUses,
      taken: Math.round(P.dmgTaken),
      avgLife: +(P.aliveFrames / 60 / (deaths + 1)).toFixed(1),
      avgHunters: +(hs.reduce((a, x) => a + x, 0) / Math.max(1, hs.length)).toFixed(2),
      botStreaks: P.streakEvents.filter((s) => !s.startsWith('YOU')).length,
      over: b.over,
    };
  });
  all.push(fin);
  console.log(`RUN ${run + 1}`, JSON.stringify(fin));
  run++;
  } catch (err) {
    if (++tries > 2 * runs) throw err;
    console.log('RETRY', String(err.message).split('\n')[0]);
  } finally {
    await browser.close().catch(() => {});
  }
}
const avg = (k) => +(all.reduce((a, x) => a + (x[k] ?? 0), 0) / all.length).toFixed(2);
console.log(`AVG ${plowKind} L${level} x${runs}`, JSON.stringify({ placement: avg('placement'), time: avg('time'), kills: avg('kills'), deaths: avg('deaths'), dealt: Math.round(avg('dealt')), taken: Math.round(avg('taken')), avgLife: avg('avgLife'), fShare: avg('fShare') }));
console.log(errors.length ? 'ERRORS ' + errors.join('\n') : 'NO ERRORS');
await server.close();
process.exit(0);
