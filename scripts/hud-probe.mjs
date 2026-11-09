// HUD layout probe (campaign radar, boss bars, lost-bot arrows, Survival arena label, tutorial ramp / bowl beacon).
//   PW_EXE=/opt/pw-browsers/chromium node scripts/hud-probe.mjs [outDir] [--only=boss,omega,arrows,survival,tutorial] [--views=844x390,...]
// Prints JSON lines with element rectangles / overlaps and saves screenshots:
//   boss-<w>x<h>-<arena>.png   campaign boss round (radar + boss bars + a toast; every top HUD part vs every other)
//   omega-<w>x<h>.png, omega-boss-<w>x<h>.png   The Omega Works (ZONES[5]) round 1 and its boss round
//   surv<wave>-<w>x<h>.png     Survival boss wave 10 (one boss, wide "BOSS WAVE · BEST" box) and 20 (twins)
//   arrows-<w>x<h>.png         three bots behind the plow in about the same direction (arrows must not overlap), plus a
//                              sweep (24 single bots on a ring, 30 random triples, 24 headings in a twin boss round):
//                              arrows vs each other and vs the round box, coin box, radar, boss bars and bottom panels
//                              (where RadarHud reports `crowded`, i.e. no room clear of the bars too, as at 568 x 320
//                              with twin bars, arrows may run over the bars only)
//   tut-<case>-<w>x<h>.png     tutorial ramp / bowl lessons from awkward spots (beacon on screen, or the edge arrow),
//                              plus a sweep: the edge arrow never overlaps the step card, hint and arrow agree on the distance
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
const VIEWS = viewArg ? viewArg.split(',').map((v) => v.split('x').map(Number)) : [[1280, 720], [1024, 768], [420, 860], [667, 375], [568, 320]];
/** Narrowest readable boss bar (px): the name, phase tag and HP number on one row. */
const MIN_BAR_W = 230;

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

/** Rectangles of the HUD parts and their overlaps (px^2). Shared with the arrow sweep (installed as window.__hudRects). */
const installRects = (page) => page.evaluate(() => {
  const box = (e) => {
    if (!e || e.offsetParent === null) return null;
    const b = e.getBoundingClientRect();
    return b.width && b.height ? { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) } : null;
  };
  const union = (els) => {
    let u = null;
    for (const e of els) {
      const b = box(e);
      if (b) u = u ? { l: Math.min(u.l, b.l), t: Math.min(u.t, b.t), r: Math.max(u.r, b.r), b: Math.max(u.b, b.b) } : b;
    }
    return u;
  };
  window.__ov = (a, b) => (a && b ? Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t)) : 0);
  // toasts by their layout boxes (their life animation scales / slides them in: slow headless frames catch it mid-way)
  const toastBox = () => {
    const c = document.querySelector('.ss-toasts');
    if (!c) return null;
    const o = c.getBoundingClientRect();
    let u = null;
    for (const e of c.children) {
      const b = { l: Math.round(o.left + e.offsetLeft), t: Math.round(o.top + e.offsetTop), r: Math.round(o.left + e.offsetLeft + e.offsetWidth), b: Math.round(o.top + e.offsetTop + e.offsetHeight) };
      u = u ? { l: Math.min(u.l, b.l), t: Math.min(u.t, b.t), r: Math.max(u.r, b.r), b: Math.max(u.b, b.b) } : b;
    }
    return u;
  };
  window.__hudRects = () => {
    const q = (s) => box(document.querySelector(s));
    return {
      tl: q('.ss-hud-tl'), tr: q('.ss-hud-tr'), radar: q('.ss-radar.on'),
      bosses: union(document.querySelectorAll('.ss-bosses .ss-bossbar:not(.hidden):not(.down)')),
      bl: q('.ss-hud-bl'), bc: q('.ss-hud-bc .ss-bc-row'), br: q('.ss-hud-br'),
      toasts: toastBox(),
    };
  };
  window.__box = box;
});

const layout = (page) => page.evaluate(() => {
  // Headless frames are slow, so CSS transitions (toast top) and the bars' entry animation can still be mid-way:
  // jump them to their end so the rectangles are the resting layout.
  for (const a of document.getAnimations()) {
    if (a instanceof CSSTransition || a.animationName === 'ss-bb-in') try { a.finish(); } catch { /* infinite */ }
  }
  const R = window.__hudRects(), ov = window.__ov;
  const tlEl = document.querySelector('.ss-hud-tl');
  // a child running past the round box (nowrap text wider than the box)
  let tlSpill = 0;
  if (tlEl) for (const e of tlEl.querySelectorAll('*')) {
    const b = e.getBoundingClientRect();
    if (b.width) tlSpill = Math.max(tlSpill, Math.round(b.right - R.tl.r));
  }
  // boss name vs HP number on each bar
  let nameXhp = 0, barW = Infinity;
  for (const bar of document.querySelectorAll('.ss-bosses .ss-bossbar:not(.hidden):not(.down)')) {
    const n = window.__box(bar.querySelector('.ss-bb-name')), hp = window.__box(bar.querySelector('.ss-bb-hp'));
    if (n && hp) nameXhp = Math.max(nameXhp, n.r - hp.l);
    barW = Math.min(barW, Math.round(bar.getBoundingClientRect().width));
  }
  const bottom = [R.bl, R.bc, R.br];
  const pairs = {
    radarXbosses: ov(R.radar, R.bosses), tlXbosses: ov(R.tl, R.bosses), trXbosses: ov(R.tr, R.bosses), radarXtr: ov(R.radar, R.tr),
    tlXtr: ov(R.tl, R.tr), tlXradar: ov(R.tl, R.radar),
    bossesXbottom: bottom.reduce((a, b) => a + ov(R.bosses, b), 0),
    toastXbosses: ov(R.toasts, R.bosses), toastXtl: ov(R.toasts, R.tl), toastXtr: ov(R.toasts, R.tr), toastXradar: ov(R.toasts, R.radar),
    toastXbottom: bottom.reduce((a, b) => a + ov(R.toasts, b), 0),
  };
  return { ...R, ...pairs, tlSpill, nameXhp, barW: Number.isFinite(barW) ? barW : null };
});

/** Fail on every overlap / squeeze `layout` reports. */
function checkLayout(name, L) {
  for (const k of ['radarXbosses', 'tlXbosses', 'trXbosses', 'radarXtr', 'tlXtr', 'tlXradar', 'bossesXbottom', 'toastXbosses', 'toastXtl', 'toastXtr', 'toastXradar', 'toastXbottom']) {
    if (L[k] > 0) fails.push(`${name}: ${k} ${L[k]} px^2`);
  }
  if (L.tlSpill > 0) fails.push(`${name}: text runs ${L.tlSpill} px past the round box`);
  if (L.bosses && L.barW < MIN_BAR_W) fails.push(`${name}: boss bar only ${L.barW} px wide`);
  if (L.nameXhp > 0) fails.push(`${name}: boss name runs into the HP number (${L.nameXhp} px)`);
  if (!L.radar) fails.push(`${name}: radar not shown`);
  if (!L.toasts) fails.push(`${name}: test toast not shown`);
}

/** Fire a long test toast (the longest common kind: an achievement) and wait for it to settle. */
const toast = async (page) => {
  await page.evaluate(() => {
    document.querySelectorAll('.ss-toasts > *').forEach((t) => t.remove()); // only the test toast (others may be leaving)
    window.__game.ctx.ui.toast('🏆 TROPHY UNLOCKED: SNOW PROBLEM', 'good');
  });
  await page.waitForTimeout(450);
};

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
  if (want('boss') || want('omega') || want('survival')) {
    for (const [w, h] of VIEWS) {
      const page = await open(w, h);
      await installRects(page);
      const shots = [];
      if (want('boss')) for (const i of [0, 3]) shots.push([`boss-${w}x${h}-${i}`, i, -1]);
      if (want('omega')) shots.push([`omega-${w}x${h}`, 5, null], [`omega-boss-${w}x${h}`, 5, -1]);
      if (want('survival')) shots.push([`surv10-${w}x${h}`, 'surv', 10], [`surv20-${w}x${h}`, 'surv', 20]);
      for (const [name, zone, round] of shots) {
        let st;
        if (zone === 'surv') {
          st = await page.evaluate((wave) => {
            const g = window.__game;
            g.ctx.progression.data.unlockedZones = 6;
            g.startSurvival();
            g.ctx.enemies.clear(); g.ctx.waves.clear();
            g.survival.wave = wave - 1;
            g.beginCountdown();
            for (let k = 0; k < 900 && g.state !== 'playing'; k++) g.tick(1 / 60);
            for (let k = 0; k < 90; k++) g.tick(1 / 60);
            return g.state;
          }, round);
        } else {
          await page.evaluate((z) => window.__game.startRun(z), zone);
          st = await toPlaying(page, round);
        }
        await page.waitForTimeout(1000); // let the boss bars' entry animation finish
        await toast(page);
        const L = await layout(page);
        console.log(JSON.stringify({ shot: name, state: st, ...L }));
        checkLayout(name, L);
        await page.screenshot({ path: `${out}/${name}.png` });
        await page.evaluate(() => document.querySelectorAll('.ss-toasts > *').forEach((t) => t.remove()));
      }
      await page.close();
    }
  }

  if (want('arrows')) {
    // Arrow footprints (tip box + distance label) vs each other and vs the fixed HUD parts.
    const ARROW_EVAL = () => {
      for (const a of document.getAnimations()) {
        if (a instanceof CSSTransition || a.animationName === 'ss-bb-in') try { a.finish(); } catch { /* infinite */ }
      }
      const R = window.__hudRects(), ov = window.__ov;
      const as = [...document.querySelectorAll('.ss-lost-arrow.on')].map((a) => {
        const t = a.querySelector('.ss-lost-tip').getBoundingClientRect(), l = a.querySelector('.ss-lost-d').getBoundingClientRect();
        return { tip: { l: t.left, t: t.top, r: t.right, b: t.bottom }, label: { l: l.left, t: l.top, r: l.right, b: l.bottom } };
      });
      let pair = 0, hud = 0, worstPart = '', hudNoBars = 0;
      for (let i = 0; i < as.length; i++) {
        for (let j = 0; j < i; j++) for (const p of ['tip', 'label']) for (const q of ['tip', 'label']) pair = Math.max(pair, ov(as[i][p], as[j][q]));
        for (const k of ['tl', 'tr', 'radar', 'bosses', 'bl', 'bc', 'br']) for (const p of ['tip', 'label']) {
          const o = ov(as[i][p], R[k]);
          if (o > hud) { hud = Math.round(o); worstPart = k; }
          if (k !== 'bosses') hudNoBars = Math.max(hudNoBars, Math.round(o));
        }
      }
      return { n: as.length, pair: Math.round(pair), hud, worstPart, hudNoBars };
    };
    for (const [w, h] of [[1280, 720], [1024, 768], [420, 860], [667, 375], [568, 320]]) {
      const page = await open(w, h);
      await installRects(page);
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
      const res = await page.evaluate(ARROW_EVAL);
      console.log(JSON.stringify({ shot: `arrows-${w}x${h}`, ...res }));
      if (res.n < 2) fails.push(`arrows-${w}x${h}: expected 2-3 arrows, got ${res.n}`);
      if (res.pair > 0) fails.push(`arrows-${w}x${h}: arrows / labels overlap (${res.pair} px^2)`);
      if (res.hud > 0) fails.push(`arrows-${w}x${h}: an arrow overlaps the ${res.worstPart} (${res.hud} px^2)`);
      await page.screenshot({ path: `${out}/arrows-${w}x${h}.png` });

      // Sweep: 24 single bots on a ring, 30 seeded random triples (bots stand still: ticks only refresh the HUD).
      const sweep = await page.evaluate((evalSrc) => {
        const evalArrows = new Function(`return (${evalSrc})()`);
        const g = window.__game, c = g.ctx;
        let seed = 7;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        const cases = [];
        for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; cases.push([[Math.sin(a) * 22, Math.cos(a) * 22]]); }
        for (let k = 0; k < 30; k++) cases.push([0, 1, 2].map(() => { const a = rnd() * Math.PI * 2, d = 12 + rnd() * 14; return [Math.sin(a) * d, Math.cos(a) * d]; }));
        const bad = [];
        window.__runCase = (ci) => {
          c.enemies.clear();
          c.plow.reset({ x: 0, z: 0, heading: 0 });
          c.cameraRig.snap();
          for (const [x, z] of cases[ci]) c.enemies.spawn('scrapper', x, z, {});
          for (let k = 0; k < 4; k++) g.tick(1 / 60);
        };
        for (let ci = 0; ci < cases.length; ci++) {
          window.__runCase(ci);
          const r = evalArrows();
          if (r.pair > 0 || r.hud > 0) bad.push({ ci, ...r });
        }
        return { cases: cases.length, bad };
      }, ARROW_EVAL.toString());
      console.log(JSON.stringify({ shot: `arrow-sweep-${w}x${h}`, cases: sweep.cases, bad: sweep.bad.length, worst: sweep.bad.slice(0, 6) }));
      if (sweep.bad.length) fails.push(`arrow-sweep-${w}x${h}: ${sweep.bad.length}/${sweep.cases} cases overlap (e.g. ${JSON.stringify(sweep.bad[0])})`);
      for (const b of sweep.bad.slice(0, 2)) {
        await page.evaluate((ci) => window.__runCase(ci), b.ci);
        await page.waitForTimeout(150);
        await page.screenshot({ path: `${out}/arrow-sweep-bad-${w}x${h}-${b.ci}.png` });
      }

      // Twin boss round (bars on screen): the plow turns on the spot so the bosses fall off screen in every direction.
      const bossSweep = await page.evaluate(async (evalSrc) => {
        const evalArrows = new Function(`return (${evalSrc})()`);
        const g = window.__game, c = g.ctx;
        g.startRun(3);
        c.enemies.clear(); c.waves.clear();
        g.roundIndex = c.zone.rounds.length - 1;
        g.beginCountdown();
        for (let k = 0; k < 600 && g.state !== 'playing'; k++) g.tick(1 / 60);
        for (let k = 0; k < 60; k++) g.tick(1 / 60);
        Object.defineProperty(c.waves, 'remaining', { get: () => 3, configurable: true });
        const bad = [];
        let shown = 0, crowdedN = 0;
        await new Promise((r) => setTimeout(r, 700)); // bar entry animation
        for (let k = 0; k < 24; k++) {
          c.plow.reset({ x: 0, z: 0, heading: (k / 24) * Math.PI * 2 });
          c.cameraRig.snap();
          g.tick(1 / 60); g.tick(1 / 60);
          const r = evalArrows();
          shown += r.n;
          // no room clear of the bars too (568 x 320, twin bars): RadarHud lets arrows run over the bars, nothing else
          const crowded = c.ui.gameHud.radar.crowded;
          if (crowded) crowdedN++;
          if (r.pair > 0 || (r.hud > 0 && !(crowded && r.worstPart === 'bosses' && r.hudNoBars === 0))) bad.push({ k, crowded, ...r });
        }
        return { bad, shown, crowdedN };
      }, ARROW_EVAL.toString());
      console.log(JSON.stringify({ shot: `arrow-boss-sweep-${w}x${h}`, shown: bossSweep.shown, crowded: bossSweep.crowdedN, bad: bossSweep.bad.length, worst: bossSweep.bad.slice(0, 6) }));
      if (bossSweep.bad.length) fails.push(`arrow-boss-sweep-${w}x${h}: ${bossSweep.bad.length}/24 headings overlap (e.g. ${JSON.stringify(bossSweep.bad[0])})`);
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
    for (const [w, h] of [[1280, 720], [420, 860], [667, 375]]) {
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
      // Sweep: 5 x 5 plow spots x 8 headings x 2 lessons. The edge arrow (tip + label) must stay off the step card, and
      // the card hint and the arrow must give the same distance.
      await page.waitForTimeout(400); // card fully slid in
      const sw = await page.evaluate(() => {
        const g = window.__game, c = g.ctx, t = g.tutorial;
        const ov = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        const num = (s) => { const m = /(\d+) m/.exec(s); return m ? +m[1] : null; };
        let cases = 0, shown = 0, worst = 0;
        const bad = [], mismatch = [];
        for (const lesson of ['Slopes', 'Ramp jump']) {
          const i = t.steps.findIndex((s) => s.title === lesson);
          for (let gx = -2; gx <= 2; gx++) for (let gz = -2; gz <= 2; gz++) for (let hk = 0; hk < 8; hk++) {
            c.plow.reset({ x: gx * 11, z: gz * 11, heading: (hk / 8) * Math.PI * 2 });
            c.cameraRig.snap();
            t.pauseT = 0;
            t.goto(i);
            for (let k = 0; k < 4; k++) g.tick(1 / 60);
            cases++;
            const a = document.querySelector('.ss-tut-arrow.on');
            if (!a) continue;
            shown++;
            const card = document.querySelector('.ss-tut').getBoundingClientRect();
            const o = Math.max(ov(a.querySelector('.ss-lost-tip').getBoundingClientRect(), card), ov(a.querySelector('.ss-lost-d').getBoundingClientRect(), card));
            if (o > 0) { bad.push({ lesson, gx, gz, hk, o: Math.round(o) }); worst = Math.max(worst, o); }
            const hint = document.querySelector('.ss-tut-hint')?.textContent ?? '';
            const dh = num(hint), da = num(a.textContent);
            if (dh !== null && da !== null && Math.abs(dh - da) > 1) mismatch.push({ lesson, gx, gz, hk, hint, arrow: a.textContent });
          }
        }
        return { cases, shown, bad: bad.length, worst: Math.round(worst), examples: bad.slice(0, 4), mismatch: mismatch.length, mismatchEx: mismatch.slice(0, 3) };
      });
      console.log(JSON.stringify({ shot: `tut-sweep-${w}x${h}`, ...sw }));
      if (sw.bad) fails.push(`tut-sweep ${w}x${h}: arrow overlaps the step card in ${sw.bad}/${sw.shown} cases (worst ${sw.worst} px^2)`);
      if (sw.mismatch) fails.push(`tut-sweep ${w}x${h}: hint and arrow distances differ in ${sw.mismatch} cases (${JSON.stringify(sw.mismatchEx[0])})`);
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
