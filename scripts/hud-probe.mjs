// HUD layout probe (campaign radar, boss bars, lost-bot arrows, Survival arena label, tutorial ramp / bowl beacon).
//   PW_EXE=/opt/pw-browsers/chromium node scripts/hud-probe.mjs [outDir] [--only=boss,omega,arrows,survival,tutorial] [--views=844x390,...]
// Prints JSON lines with element rectangles / overlaps and saves screenshots:
//   boss-<w>x<h>-<arena>.png   campaign boss round (radar + boss bars; reports radar / top-left box overlap with the bars)
//   omega-<w>x<h>.png, omega-boss-<w>x<h>.png   The Omega Works (ZONES[5]) round 1 and its boss round
//   arrows-<w>x<h>.png         three bots behind the plow in about the same direction (arrows must not overlap)
//   tut-<case>-<w>x<h>.png     tutorial ramp / bowl lessons from awkward spots (beacon on screen, or the edge arrow)
// Exits 1 on any console error / page error or a failed layout check.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) || '/tmp/hud-probe';
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const want = (k) => !only.length || only.includes(k);
mkdirSync(out, { recursive: true });

const port = 5200 + Math.floor(Math.random() * 500);
const server = await createServer({ server: { port, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  ...(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : { channel: 'chrome' }),
  headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
const fails = [];
const viewArg = (args.find((a) => a.startsWith('--views=')) || '').slice(8);
const VIEWS = viewArg ? viewArg.split(',').map((v) => v.split('x').map(Number)) : [[1280, 720], [760, 900], [420, 860]];

async function open(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GPU stall')) errors.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
  await page.goto(`http://localhost:${port}/?debug`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 });
  await page.evaluate(() => {
    const g = window.__game;
    g.ctx.progression.isZoneUnlocked = () => true;
    g.impact.enabled = false;
  });
  await page.waitForTimeout(1500); // the boot shows the main menu a moment after load
  return page;
}

/** Rectangles of the top HUD parts and their overlaps (px^2). */
const layout = (page) => page.evaluate(() => {
  const r = (s) => {
    const e = document.querySelector(s);
    if (!e || e.offsetParent === null) return null;
    const b = e.getBoundingClientRect();
    return b.width && b.height ? { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) } : null;
  };
  const ov = (a, b) => (a && b ? Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t)) : 0);
  const bossEls = [...document.querySelectorAll('.ss-bosses .ss-bossbar:not(.hidden)')];
  let bosses = null;
  for (const e of bossEls) {
    const b = e.getBoundingClientRect();
    bosses = bosses ? { l: Math.min(bosses.l, b.left), t: Math.min(bosses.t, b.top), r: Math.max(bosses.r, b.right), b: Math.max(bosses.b, b.bottom) } : { l: b.left, t: b.top, r: b.right, b: b.bottom };
  }
  if (bosses) for (const k in bosses) bosses[k] = Math.round(bosses[k]);
  const tl = r('.ss-hud-tl'), tr = r('.ss-hud-tr'), radar = r('.ss-radar.on');
  return { tl, tr, radar, bosses, radarXbosses: ov(radar, bosses), tlXbosses: ov(tl, bosses), trXbosses: ov(tr, bosses), radarXtr: ov(radar, tr) };
});

const toPlaying = (page, round) => page.evaluate((round) => {
  const g = window.__game;
  if (round !== null) {
    g.ctx.enemies.clear(); g.ctx.waves.clear();
    g.roundIndex = round < 0 ? g.ctx.zone.rounds.length + round : round;
    g.beginCountdown();
  }
  for (let k = 0; k < 600 && g.state !== 'playing'; k++) g.tick(1 / 60);
  for (let k = 0; k < 90; k++) g.tick(1 / 60);
  return g.state;
}, round);

try {
  if (want('boss') || want('omega')) {
    for (const [w, h] of VIEWS) {
      const page = await open(w, h);
      const shots = [];
      if (want('boss')) for (const i of [0, 3]) shots.push([`boss-${w}x${h}-${i}`, i, -1]);
      if (want('omega')) shots.push([`omega-${w}x${h}`, 5, null], [`omega-boss-${w}x${h}`, 5, -1]);
      for (const [name, zone, round] of shots) {
        await page.evaluate((z) => window.__game.startRun(z), zone);
        const st = await toPlaying(page, round);
        await page.waitForTimeout(1000); // let the boss bars' entry animation finish
        const L = await layout(page);
        console.log(JSON.stringify({ shot: name, state: st, ...L }));
        if (L.radarXbosses > 0) fails.push(`${name}: radar overlaps the boss bars (${L.radarXbosses} px^2)`);
        if (L.tlXbosses > 0) fails.push(`${name}: top-left box overlaps the boss bars (${L.tlXbosses} px^2)`);
        if (L.trXbosses > 0) fails.push(`${name}: coin box overlaps the boss bars (${L.trXbosses} px^2)`);
        if (!L.radar) fails.push(`${name}: radar not shown`);
        await page.screenshot({ path: `${out}/${name}.png` });
      }
      await page.close();
    }
  }

  if (want('arrows')) {
    for (const [w, h] of [[1280, 720], [420, 860]]) {
      const page = await open(w, h);
      await page.evaluate(() => window.__game.startRun(2));
      await toPlaying(page, null);
      await page.evaluate(() => {
        const g = window.__game, c = g.ctx;
        c.enemies.clear();
        Object.defineProperty(c.waves, 'remaining', { get: () => 3, configurable: true });
        c.plow.reset({ x: 0, z: 0, heading: 0 });
        c.cameraRig.snap();
        // three bots behind the plow, a few degrees apart (+ one to the side): arrows land on the same edge
        for (const [x, z] of [[1.0, -14], [0.2, -17], [-0.6, -12]]) c.enemies.spawn('scrapper', x, z, {});
        for (let k = 0; k < 6; k++) g.tick(1 / 60);
      });
      await page.waitForTimeout(500);
      const res = await page.evaluate(() => {
        const as = [...document.querySelectorAll('.ss-lost-arrow.on')].map((a) => {
          const tip = a.querySelector('.ss-lost-tip').getBoundingClientRect();
          const lab = a.querySelector('.ss-lost-d').getBoundingClientRect();
          return { tip: [tip.left, tip.top, tip.right, tip.bottom].map(Math.round), label: [lab.left, lab.top, lab.right, lab.bottom].map(Math.round), text: a.textContent };
        });
        const ov = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
        let worst = 0;
        for (let i = 0; i < as.length; i++) for (let j = 0; j < i; j++) {
          worst = Math.max(worst, ov(as[i].label, as[j].label), ov(as[i].tip, as[j].tip), ov(as[i].label, as[j].tip), ov(as[i].tip, as[j].label));
        }
        return { arrows: as, worstOverlap: worst };
      });
      console.log(JSON.stringify({ shot: `arrows-${w}x${h}`, ...res }));
      if (res.arrows.length < 2) fails.push(`arrows-${w}x${h}: expected 2-3 arrows, got ${res.arrows.length}`);
      if (res.worstOverlap > 0) fails.push(`arrows-${w}x${h}: arrows / labels overlap (${res.worstOverlap} px^2)`);
      await page.screenshot({ path: `${out}/arrows-${w}x${h}.png` });
      await page.close();
    }
  }

  if (want('survival')) {
    const page = await open(1280, 720);
    const res = await page.evaluate(async () => {
      const { BIOME_ZONE } = await import('/src/config/zones.ts').catch(() => ({}));
      const g = window.__game;
      g.startSurvival();
      const lbl = () => document.querySelector('.ss-hud-arena')?.textContent ?? '';
      const rows = [];
      for (let k = 0; k < 600 && g.state !== 'playing'; k++) g.tick(1 / 60);
      for (let wave = 1; wave <= 6; wave++) {
        // fast-forward: clear the wave, read the label in the pit stop, then continue into the next wave
        rows.push({ wave, state: g.state, playing: lbl() });
        g.ctx.enemies.clear(); g.ctx.waves.clear();
        g.survivalWaveCleared();
        rows.push({ wave, state: g.state, shop: lbl(), biome: g.survival.biome, nextBiome: g.survival.biomeFor(g.survival.wave + 1) });
        g.ctx.ui.hideOverlays();
        g.beginCountdown();
        for (let k = 0; k < 900 && g.state !== 'playing'; k++) g.tick(1 / 60);
      }
      return { rows, zoneNames: BIOME_ZONE ? Object.fromEntries(Object.entries(BIOME_ZONE).map(([k, z]) => [k, z.name])) : null };
    });
    console.log(JSON.stringify({ shot: 'survival', ...res }));
    for (const r of res.rows) {
      const here = res.zoneNames?.[r.biome];
      if (r.shop && here && r.shop.includes(here)) fails.push(`survival wave ${r.wave}: stale label in the pit stop: "${r.shop}"`);
    }
    await page.close();
  }

  if (want('tutorial')) {
    for (const [w, h] of [[1280, 720], [420, 860]]) {
      const page = await open(w, h);
      // plow spots: facing a wall near it, in a corner facing out, mid-field facing in
      const cases = [
        ['wall', 0, 24, 0], ['corner', 24, 24, Math.PI / 4], ['mid', -6, 4, 2.2], ['side', -25, 0, -Math.PI / 2],
      ];
      for (const [name, x, z, heading] of cases) {
        for (const lesson of ['Slopes', 'Ramp jump']) {
          const res = await page.evaluate(([x, z, heading, lesson]) => {
            const g = window.__game, c = g.ctx, t = g.tutorial;
            if (g.state !== 'tutorial') g.startTutorial();
            c.plow.reset({ x, z, heading });
            c.cameraRig.snap();
            const i = t.steps.findIndex((s) => s.title === lesson);
            t.pauseT = 0;
            t.goto(i);
            for (let k = 0; k < 20; k++) g.tick(1 / 60);
            const b = t.beacon;
            return { i, beacon: b && { x: +b.x.toFixed(1), z: +b.z.toFixed(1) }, bowl: { ...t.bowl }, ramp: { ...t.ramp }, plow: [+c.plow.position.x.toFixed(1), +c.plow.position.z.toFixed(1)] };
          }, [x, z, heading, lesson]);
          await page.waitForTimeout(350);
          const scr = await page.evaluate(() => {
            const g = window.__game, c = g.ctx, t = g.tutorial, b = t.beacon;
            if (!b) return null;
            const v = { x: b.x, y: c.terrain.ground(b.x, b.z) + 1, z: b.z };
            const cam = c.camera; cam.updateMatrixWorld();
            const p = new cam.position.constructor(v.x, v.y, v.z).project(cam);
            const W = innerWidth, H = innerHeight;
            const sx = (p.x + 1) / 2 * W, sy = (1 - p.y) / 2 * H;
            const card = document.querySelector('.ss-tut').getBoundingClientRect();
            const inView = p.z < 1 && sx >= 0 && sx <= W && sy >= 0 && sy <= H;
            const underCard = inView && sx >= card.left && sx <= card.right && sy >= card.top && sy <= card.bottom;
            const arrow = document.querySelector('.ss-tut-arrow.on');
            return { sx: Math.round(sx), sy: Math.round(sy), inView, underCard, arrow: !!arrow, arrowText: arrow?.textContent ?? '' };
          });
          const dBowl = Math.hypot(res.bowl.x - res.plow[0], res.bowl.z - res.plow[1]);
          console.log(JSON.stringify({ shot: `tut-${name}-${lesson}-${w}x${h}`, ...res, bowlDist: +dBowl.toFixed(1), screen: scr }));
          if (lesson === 'Slopes' && dBowl < 12) fails.push(`tut ${name} ${w}x${h}: bowl centre only ${dBowl.toFixed(1)} m from the plow`);
          if (scr && (!scr.inView || scr.underCard) && !scr.arrow) fails.push(`tut ${name} ${lesson} ${w}x${h}: beacon off screen / under the card and no arrow`);
          await page.screenshot({ path: `${out}/tut-${name}-${lesson.split(' ')[0].toLowerCase()}-${w}x${h}.png` });
        }
      }
      await page.close();
    }
  }
} catch (e) {
  errors.push(`[probe] ${e.stack || e}`);
}
await browser.close();
await server.close();
for (const f of fails) console.log(`FAIL ${f}`);
if (errors.length) console.log(`CONSOLE ERRORS:\n${errors.join('\n')}`);
else console.log('NO CONSOLE ERRORS');
console.log(`screenshots in ${out}`);
process.exit(errors.length || fails.length ? 1 : 0);
