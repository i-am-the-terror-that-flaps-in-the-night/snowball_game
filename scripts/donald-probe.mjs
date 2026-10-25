// Headless THE DONALD probe: node scripts/donald-probe.mjs [outDir]
// Golden Tower Plaza (arena 6): screenshots the arena / stage / crowd / flags, the zone select, the boss up close,
// and drives the boss round through every attack (BUILD THE WALL + a dash / slam smash, DEPORTATION, RALLY + its
// break, GOLD PLATED + reflect + taunts) via window.__game. Fails on console errors.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv.slice(2).find((a) => !a.startsWith('--')) || '/tmp/donald-probe';
mkdirSync(out, { recursive: true });
const port = 6400 + Math.floor(Math.random() * 100);
const server = await createServer({ root: process.cwd(), server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [process.env.PROBE_GPU === '0' ? '--use-angle=swiftshader' : '--use-angle=metal', '--enable-unsafe-swiftshader'] });
const errors = [];
const log = (...a) => console.log(...a);
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${port}/?debug`, { waitUntil: 'load' });
await page.waitForTimeout(1500);

// Helpers inside the page: freeze the real animation loop, tick, frame the camera, render.
await page.evaluate(async () => {
  const g = window.__game;
  g.renderer.setAnimationLoop(null);
  const { donaldTimers } = await import('/src/entities/enemies/bosses.ts');
  window.__p = {
    /** Reset the duel (boss north, plow south, both still) and make `kind` the boss's next move. */
    force(kind) {
      const b = g.ctx.enemies.bosses[0];
      b.stun = 0;
      if (!donaldTimers(b)) g.tick(1 / 60);
      const t = donaldTimers(b);
      if (!t) throw new Error('donaldTimers: no state (module instance mismatch?)');
      t.wallCd = kind === 'wall' ? 0 : 99;
      t.beamCd = kind === 'beam' ? 0 : 99;
      t.rallyCd = kind === 'rally' ? 0 : 99;
      t.rallied = true;
      b.position.set(0, 0, -10);
      b.heading = 0;
      b.stun = 0;
      b.set('approach', 0);
      b.cd = 0;
      const pl = g.ctx.plow;
      pl.position.set(0, 0, 10);
      pl.heading = Math.PI;
      pl.speed = 0;
    },
    tick(s) { for (let i = 0; i < Math.round(s * 60); i++) g.tick(1 / 60); },
    until(fn, max = 30) { for (let i = 0; i < max * 60; i++) { if (fn()) return true; g.tick(1 / 60); } return false; },
    cam(px, py, pz, tx, ty, tz, fov = 50) {
      const cam = g.ctx.camera;
      cam.position.set(px, py, pz);
      cam.fov = fov;
      cam.updateProjectionMatrix();
      cam.lookAt(tx, ty, tz);
      cam.updateMatrixWorld();
    },
    render() { g.renderer.render(g.ctx.scene, g.ctx.camera); },
    boss() { return g.ctx.enemies.bosses[0]; },
    ui(on) { document.getElementById('ui').style.visibility = on ? '' : 'hidden'; },
    tank() { g.ctx.stats.maxHp = 1e5; g.ctx.plow.applyStats(g.ctx.stats); g.ctx.plow.hp = 1e5; },
  };
});
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); log('  shot', name); };
const ev = (fn, arg) => page.evaluate(fn, arg);

// ---- zone select
await ev(() => window.__game.toMenu());
await page.waitForTimeout(300);
{
  const b = page.locator('button:visible', { hasText: 'FIGHT' }).first();
  if (await b.count()) { await b.click(); await page.waitForTimeout(500); await shot('01-zone-select'); }
  await page.keyboard.press('Escape');
}

// ---- the arena: chase cam, stage, crowd, flags, gold tower
await ev(() => { const g = window.__game; g.startRun(5); window.__p.tick(1); window.__p.render(); });
await shot('02-arena-chase');
await ev(() => window.__p.ui(false));
await ev(() => { window.__p.cam(0, 9, 8, 0, 6, -36, 55); window.__p.render(); });
await shot('03-stage');
await ev(() => { window.__p.cam(14, 6, -8, 36, 4, -2, 50); window.__p.render(); });
await shot('04-crowd-east');
await ev(() => { window.__p.cam(-6, 3, 26, 6, 3, 31.5, 60); window.__p.render(); });
await shot('05-south-flags');
await ev(() => { window.__p.cam(0, 22, 40, 0, 12, -60, 60); window.__p.render(); });
await shot('06-arena-wide');

// ---- boss round
const intro = await ev(() => {
  const g = window.__game;
  g.roundIndex = g.ctx.zone.rounds.length - 1;
  g.beginCountdown();
  const p = window.__p;
  p.tank();
  p.until(() => !!p.boss(), 10);
  p.until(() => p.boss() && !p.boss().entering, 10);
  const b = p.boss();
  return { name: b?.def.name, hp: b?.maxHp, state: b?.state };
});
log('  boss:', JSON.stringify(intro));

// close-ups of the model
await ev(() => {
  const p = window.__p;
  const g = window.__game;
  const b = p.boss();
  // park everything for the portrait
  b.position.set(0, 0, -8);
  b.heading = 0;
  b.desHeading = 0;
  b.stun = 3;
  g.ctx.plow.position.set(0, 0, 18);
  p.tick(0.1);
  const x = b.position.x, z = b.position.z;
  p.cam(x + 2.5, 5.2, z + 10.5, x, 3.8, z, 40);
  p.render();
});
await shot('07-boss-face');
await ev(() => { const p = window.__p; const b = p.boss(); p.cam(b.position.x + 9, 6.5, b.position.z + 8, b.position.x, 2.8, b.position.z, 45); p.render(); });
await shot('08-boss-three-quarter');
await ev(() => { const p = window.__p; const b = p.boss(); p.cam(b.position.x, 6.8, b.position.z + 4.2, b.position.x, 5.2, b.position.z, 45); p.render(); });
await shot('09-boss-cap');
await ev(() => { const p = window.__p; const b = p.boss(); p.cam(b.position.x - 4, 4, b.position.z + 16, b.position.x, 3, b.position.z, 50); p.render(); });
await shot('10-boss-from-plow');

// helper: chase-ish camera behind the plow looking at the boss
const viewFight = async (name) => {
  await ev(() => {
    const p = window.__p;
    const g = window.__game;
    const pl = g.ctx.plow.position;
    const b = p.boss();
    const tx = b ? b.position.x : 0, tz = b ? b.position.z : -10;
    const dx = tx - pl.x, dz = tz - pl.z, d = Math.hypot(dx, dz) || 1;
    p.cam(pl.x - (dx / d) * 14, 14, pl.z - (dz / d) * 14, (pl.x + tx) / 2, 0, (pl.z + tz) / 2, 55);
    p.render();
  });
  await shot(name);
};

// ---- BUILD THE WALL
const wall = await ev(() => {
  const p = window.__p;
  const g = window.__game;
  const b = p.boss();
  p.force('wall');
  const ok = p.until(() => b.state === 'wallWind', 5);
  p.tick(0.5);
  return { ok, state: b.state };
});
log('  wall wind:', JSON.stringify(wall));
await viewFight('11-wall-telegraph');
const wall2 = await ev(() => {
  const p = window.__p;
  const g = window.__game;
  const b = p.boss();
  p.until(() => b.state === 'wallPause', 3);
  p.tick(0.4);
  return { state: b.state, obstacles: g.ctx.world.obstacles.length };
});
log('  walls up:', JSON.stringify(wall2));
await viewFight('12-wall-line');
// dash into a wall segment -> it should smash a gap
const smash = await ev(() => {
  const p = window.__p;
  const g = window.__game;
  const c = g.ctx;
  const obs = c.world.obstacles;
  if (!obs.length) return { skipped: true };
  const pl = c.plow.position;
  let best = obs[0];
  for (const o of obs) if (Math.hypot(o.x - pl.x, o.z - pl.z) < Math.hypot(best.x - pl.x, best.z - pl.z)) best = o;
  const before = obs.length;
  // stand 5 m from the segment facing it, then dash
  const dx = pl.x - best.x, dz = pl.z - best.z, d = Math.hypot(dx, dz) || 1;
  pl.x = best.x + (dx / d) * 5;
  pl.z = best.z + (dz / d) * 5;
  c.plow.heading = Math.atan2(-dx, -dz);
  c.input.pressed.add('ShiftLeft');
  p.tick(1 / 60);
  c.input.pressed.clear();
  p.tick(0.6);
  return { before, after: c.world.obstacles.length };
});
log('  dash smash:', JSON.stringify(smash));
await viewFight('13-wall-smashed');
const slam = await ev(() => {
  const g = window.__game;
  const c = g.ctx;
  const obs = c.world.obstacles;
  if (!obs.length) return { skipped: true };
  const before = obs.length;
  const o = obs[obs.length - 1];
  c.events.emit('slam', { hits: 0, radius: 1.2, position: new c.plow.position.constructor(o.x, 0, o.z) });
  window.__p.tick(0.2);
  return { before, after: c.world.obstacles.length };
});
log('  slam smash:', JSON.stringify(slam));

// ---- DEPORTATION
const beam = await ev(() => {
  const p = window.__p;
  const g = window.__game;
  const c = g.ctx;
  const b = p.boss();
  p.until(() => c.world.obstacles.length === 0, 15);
  p.force('beam');
  const ok = p.until(() => b.state === 'beamWind', 5);
  p.tick(0.6);
  return { ok, state: b.state };
});
log('  beam wind:', JSON.stringify(beam));
await viewFight('14-deport-telegraph');
const deport = await ev(() => {
  const p = window.__p;
  const g = window.__game;
  const c = g.ctx;
  const b = p.boss();
  c.plow.heldVolume = 4;
  const ball0 = c.plow.heldBallRadius;
  const from = { x: c.plow.position.x, z: c.plow.position.z };
  // a minion standing in the beam too
  const m = c.enemies.spawn('scrapper', from.x + 1.5, from.z, { hpMult: 1 });
  const mFrom = { x: m.position.x, z: m.position.z };
  p.tick(1.4);
  const to = { x: c.plow.position.x, z: c.plow.position.z };
  return { state: b.state, ball0: +ball0.toFixed(2), ball1: +c.plow.heldBallRadius.toFixed(2), from, to, moved: +Math.hypot(to.x - from.x, to.z - from.z).toFixed(1), minionMoved: +Math.hypot(m.position.x - mFrom.x, m.position.z - mFrom.z).toFixed(1) };
});
log('  deport:', JSON.stringify(deport));
await ev(() => { const p = window.__p; p.tick(0.1); });
await viewFight('15-deport-landed');

// ---- RALLY: knock it to 74% HP -> it drives to the podium spot and summons the crowd
const rally = await ev(() => {
  const p = window.__p;
  const g = window.__game;
  const c = g.ctx;
  const b = p.boss();
  b.hp = b.maxHp * 0.74;
  p.force('rally');
  c.plow.position.set(8, 0, 10);
  const ok = p.until(() => b.state === 'rally', 12);
  p.tick(1.5);
  return { ok, state: b.state, dmgTakenMult: b.dmgTakenMult, bots: c.enemies.aliveCount() - 1, pos: [+b.position.x.toFixed(1), +b.position.z.toFixed(1)] };
});
log('  rally:', JSON.stringify(rally));
await ev(() => { const p = window.__p; const b = p.boss(); p.cam(b.position.x + 6, 11, b.position.z + 20, b.position.x, 2, b.position.z + 2, 55); p.render(); });
await shot('16-rally');
const rallyBreak = await ev(() => {
  const p = window.__p;
  const g = window.__game;
  const c = g.ctx;
  const b = p.boss();
  const hp0 = b.hp;
  c.enemies.damage(b, 100, { source: 'ram' });
  const reduced = +(hp0 - b.hp).toFixed(1);
  const bots = c.enemies.query(b.position.x, b.position.z, 20).filter((e) => !e.isBoss && e.type === 'rallybot');
  const fast = bots[0]?.spdMult;
  for (let i = 0; i < Math.ceil(bots.length / 2); i++) c.enemies.damage(bots[i], 1e9);
  p.tick(0.1);
  return { dmgFor100: reduced, minionSpdMult: fast, state: b.state, stun: +b.stun.toFixed(2), dmgTakenMult: b.dmgTakenMult };
});
log('  rally break:', JSON.stringify(rallyBreak));
await ev(() => { const p = window.__p; const b = p.boss(); p.cam(b.position.x + 6, 11, b.position.z + 20, b.position.x, 2, b.position.z + 2, 55); p.render(); });
await shot('17-rally-broken');

// ---- GOLD PLATED
const plated = await ev(() => {
  const p = window.__p;
  const g = window.__game;
  const c = g.ctx;
  const b = p.boss();
  b.stun = 0;
  b.hp = b.maxHp * 0.52;
  c.enemies.damage(b, 200, { source: 'ram' });
  p.tick(0.1);
  const hpPlow0 = c.plow.hp;
  c.enemies.damage(b, 100, { source: 'ram' });
  p.tick(0.6);
  return { reflect: b.reflect, enraged: b.enraged, plowLost: +(hpPlow0 - c.plow.hp).toFixed(1), paint: b.rig.paintBase.map((x) => x.getHexString()) };
});
log('  gold plated:', JSON.stringify(plated));
await ev(() => { const p = window.__p; p.tick(2.2); const b = p.boss(); p.cam(b.position.x + 7, 7, b.position.z + 9, b.position.x, 3.2, b.position.z, 45); p.render(); });
await shot('18-gold-plated');
// phase 2 walls come faster: watch for a 3-line build
const p2 = await ev(() => {
  const p = window.__p;
  const g = window.__game;
  const b = p.boss();
  p.force('wall');
  const ok = p.until(() => b.state === 'wallPause', 8);
  p.tick(0.3);
  return { ok, obstacles: g.ctx.world.obstacles.length };
});
log('  phase-2 walls:', JSON.stringify(p2));
await viewFight('19-phase2-walls');
// run the fight a while with the plow parked, then kill the boss: walls must collapse
const end = await ev(() => {
  const p = window.__p;
  const g = window.__game;
  const c = g.ctx;
  const states = new Set();
  for (let i = 0; i < 25 * 60; i++) { const b = p.boss(); if (!b) break; states.add(b.state); g.tick(1 / 60); }
  const b = p.boss();
  if (b) c.enemies.damage(b, 1e9);
  p.tick(1.5);
  return { states: [...states], obstacles: c.world.obstacles.length, state: g.state };
});
log('  end:', JSON.stringify(end));

log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS');
await browser.close();
await server.close();
process.exit(errors.length ? 1 : 0);
