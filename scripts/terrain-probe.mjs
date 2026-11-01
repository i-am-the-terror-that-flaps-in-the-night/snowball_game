// Terrain physics probe: node scripts/terrain-probe.mjs [outDir] [--noshots]
// Boots Vite + headless Chromium (PW_EXE=/opt/pw-browsers/chromium in containers), starts a campaign run, swaps the
// dev test terrain (src/world/devTerrain.ts) into ctx.terrain and drives the plow / bots through it with tick()s and
// a scripted input, asserting with numbers:
//   - flat parity: a scripted drive on flat terrain == the same drive over the flat part of the (active) dev terrain,
//     and (when scripts/terrain-probe.flat.json exists) == the recorded pre-terrain trajectory
//   - ramp: airtime > 0.4 s, plowLaunched + plowLanded events, run airtime stat
//   - bowl: rolling in speeds you up vs flat, climbing out slows you; feet follow the ground
//   - lava: ~8 HP/s; ice: measurably less grip (slip angle, braking distance); conveyor push
//   - bots: follow height, avoid lava (6 seeded fights, a fleeing thief), drive out of it the near way, launch() + enemyLanded, last-bot hunt (2 thieves, whose own AI only creeps in,
//     close clearly faster than a control run with the hunt held off by a third, parked minion)
//   - The Omega Works (OMEGA_TERRAIN loaded only inside this probe, arena half-size 80): driving under the Assembly
//     Floor (ground level, camera below its underside), climbing ramp S onto the Floor, ramp NE onto the NE platform
//     and the tower ramp onto the Control Tower, the rotated ramps E / W onto the Floor, ramp N past the tower
//     columns, ramp SW (no crest hop on any ramp) while pillars / ramp flanks still block, a ceiling bonk, driving
//     off the Floor edge (plowLanded), a 0.3 m lip (no launch), coins on the Floor (and under it), coins rolling down
//     ramps E / W, a scorch decal and sparks staying on the Floor
// Screenshots (plow mid-air, plow in the bowl) go to outDir. Exit code 1 on a failed check.
// --record-flat writes the flat drive to scripts/terrain-probe.flat.json (do this on a known-good build only).
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) || '/tmp/terrain-probe';
const noShots = args.includes('--noshots');
const recordFlat = args.includes('--record-flat');
const FLAT_FILE = new URL('./terrain-probe.flat.json', import.meta.url);
mkdirSync(out, { recursive: true });

const port = 5200 + Math.floor(Math.random() * 500);
const server = await createServer({ server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  ...(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : { channel: 'chrome' }),
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('GPU stall')) errors.push(`[console] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};
/** Render the current sim state (UI hidden) and save it; `side` = also a side view of the plow from (dx, dy, dz). */
const shot = async (name, side) => {
  if (noShots) return;
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    for (const el of document.body.children) if (!el.contains(canvas)) el.style.visibility = 'hidden';
    const g = window.__game;
    g.renderer.render(g.ctx.scene, g.ctx.camera);
  });
  await page.screenshot({ path: `${out}/${name}.png` });
  if (side) {
    await page.evaluate((o) => {
      const g = window.__game;
      const cam = g.ctx.camera;
      const p = g.ctx.plow.position;
      const keep = cam.position.clone();
      const q = cam.quaternion.clone();
      cam.position.set(p.x + o[0], p.y + o[1], p.z + o[2]);
      cam.lookAt(p.x, p.y + 0.8, p.z);
      g.renderer.render(g.ctx.scene, cam);
      cam.position.copy(keep);
      cam.quaternion.copy(q);
    }, side);
    await page.screenshot({ path: `${out}/${name}-side.png` });
  }
};

try {
  await page.goto(`http://localhost:${port}/?debug`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 });
  // Campaign run, parked in an endless countdown (the plow drives, no waves spawn), scripted input, no hit-stop.
  await page.evaluate(async () => {
    const g = window.__game;
    const c = g.ctx;
    g.setLoop(false);
    g.startRun(0);
    c.ui.hideOverlays();
    g.beginCountdown();
    g.countdown = 1e9;
    g.impact.enabled = false;
    c.enemies.clear();
    c.waves.clear();
    window.__in = { t: 0, s: 0 };
    Object.defineProperty(c.input, 'throttle', { get: () => window.__in.t, configurable: true });
    Object.defineProperty(c.input, 'steer', { get: () => window.__in.s, configurable: true });
    try {
      window.__dev = await import('/src/world/devTerrain.ts');
    } catch {
      window.__dev = null; // a pre-terrain build (recording the flat baseline)
    }
    window.__ev = { launched: [], landed: [], enemyLanded: [], damaged: 0 };
    c.events.on('plowLaunched', (e) => window.__ev.launched.push(e));
    c.events.on('plowLanded', (e) => window.__ev.landed.push(e));
    c.events.on('enemyLanded', (e) => window.__ev.enemyLanded.push({ id: e.enemy.id, impact: e.impact }));
    c.events.on('plowDamaged', (e) => (window.__ev.damaged += e.amount));
    // Helpers -----------------------------------------------------------------------------------------------
    window.__load = (def) => { c.terrain.load(def ?? {}); c.snow.reset(c.zone); c.world.resetProps(false, false); };
    window.__place = (x, z, heading, speed = 0) => {
      c.plow.reset();
      c.plow.heading = heading;
      c.plow.position.x = x;
      c.plow.position.z = z;
      c.plow.speed = speed;
      c.plow.hp = c.plow.maxHp;
      c.cameraRig.snap();
      for (const k of Object.keys(window.__ev)) window.__ev[k] = Array.isArray(window.__ev[k]) ? [] : 0;
    };
    /** plan: [[seconds, throttle, steer], ...] -> per-tick [x, y, z, heading, speed] */
    window.__drive = (plan) => {
      const tr = [];
      for (const [sec, t, s] of plan) {
        window.__in.t = t;
        window.__in.s = s;
        for (let i = 0; i < Math.round(sec * 60); i++) {
          g.tick(1 / 60);
          const p = c.plow;
          tr.push([p.position.x, p.position.y, p.position.z, p.heading, p.speed]);
        }
      }
      window.__in.t = window.__in.s = 0;
      return tr;
    };
  });

  /* ---------------------------------------------------------------- flat parity */
  const PLAN = [[1.2, 1, 0], [0.6, 1, 1], [0.4, 1, -1], [0.5, -1, 0], [0.4, 0, 0.5], [0.6, 1, 0]];
  const flatRun = await page.evaluate((plan) => {
    window.__load({});
    window.__place(0, 18, Math.PI);
    return window.__drive(plan);
  }, PLAN);
  const devFlatRun = await page.evaluate((plan) => {
    if (!window.__dev) return { tr: [], active: false };
    window.__load(window.__dev.DEV_TERRAIN);
    window.__place(0, 18, Math.PI);
    return { tr: window.__drive(plan), active: window.__game.ctx.terrain.active };
  }, PLAN);
  let maxXZ = 0;
  let maxY = 0;
  flatRun.forEach((a, i) => {
    const b = devFlatRun.tr[i];
    if (!b) return;
    maxXZ = Math.max(maxXZ, Math.abs(a[0] - b[0]), Math.abs(a[2] - b[2]), Math.abs(a[3] - b[3]), Math.abs(a[4] - b[4]));
    maxY = Math.max(maxY, Math.abs(a[1] - b[1]));
  });
  check('flat parity: flat terrain vs flat ground of an active terrain', devFlatRun.active && maxXZ < 1e-9 && maxY < 1e-6, `max |dx,dz,heading,speed| ${maxXZ.toExponential(2)}, max |dy| ${maxY.toExponential(2)} over ${flatRun.length} ticks`);
  if (recordFlat) {
    writeFileSync(FLAT_FILE, JSON.stringify({ plan: PLAN, tr: flatRun.map((r) => r.map((v) => +v.toFixed(6))) }));
    console.log('recorded flat drive ->', FLAT_FILE.pathname);
  } else if (existsSync(FLAT_FILE)) {
    const base = JSON.parse(readFileSync(FLAT_FILE, 'utf8'));
    let d = 0;
    let dy = 0;
    base.tr.forEach((a, i) => {
      const b = flatRun[i];
      if (!b) return;
      d = Math.max(d, Math.abs(a[0] - b[0]), Math.abs(a[2] - b[2]), Math.abs(a[3] - b[3]), Math.abs(a[4] - b[4]));
      dy = Math.max(dy, Math.abs(a[1] - b[1]));
    });
    check('flat parity: vs recorded pre-terrain drive', d < 1e-4 && dy < 1e-4 && base.tr.length === flatRun.length, `max diff ${d.toExponential(2)} (y ${dy.toExponential(2)})`);
  }

  /* ---------------------------------------------------------------- ramp jump */
  const F = await page.evaluate(() => window.__dev.DEV_FEATURES);
  await page.evaluate((r) => { window.__load(window.__dev.DEV_TERRAIN); window.__place(r.x, r.toeZ + 6, Math.PI, 0); }, F.ramp);
  // Full throttle up the ramp; stop the clock mid-flight for the screenshot.
  const air = await page.evaluate(() => {
    const g = window.__game;
    const p = g.ctx.plow;
    window.__in.t = 1;
    let maxAir = 0;
    let lipSpeed = 0;
    let peakY = -1;
    for (let i = 0; i < 240; i++) {
      g.tick(1 / 60);
      if (!p.airborne) lipSpeed = p.speed;
      maxAir = Math.max(maxAir, p.airTime);
      peakY = Math.max(peakY, p.position.y);
      if (p.airborne && p.airTime > 0.2) break;
    }
    return { airborne: p.airborne, airTime: p.airTime, lipSpeed, peakY, surface: p.surfaceY, y: p.position.y };
  });
  await shot('01-plow-midair', [14, 1.5, 0]);
  const ramp = await page.evaluate(() => {
    const g = window.__game;
    const p = g.ctx.plow;
    window.__in.t = 1;
    let maxAir = p.airTime;
    for (let i = 0; i < 120 && p.airborne; i++) {
      g.tick(1 / 60);
      maxAir = Math.max(maxAir, p.airTime);
    }
    for (let i = 0; i < 30; i++) g.tick(1 / 60);
    window.__in.t = 0;
    return { maxAir, ev: window.__ev, runAirtime: g.run.airtime, airborne: p.airborne };
  });
  const landed = ramp.ev.landed[0];
  check('ramp: airborne mid-flight', air.airborne && air.y - air.surface > 0.5, `lip speed ${air.lipSpeed.toFixed(1)} m/s, ${(air.y - air.surface).toFixed(2)} m above the ground at t=${air.airTime.toFixed(2)} s`);
  check('ramp: airtime > 0.4 s', landed && landed.airTime > 0.4, `flight ${landed ? landed.airTime.toFixed(3) : '-'} s, impact ${landed ? landed.impact.toFixed(1) : '-'} m/s`);
  check('ramp: plowLaunched + plowLanded once each', ramp.ev.launched.length === 1 && ramp.ev.landed.length === 1, `launched ${ramp.ev.launched.length}, landed ${ramp.ev.landed.length}`);
  check('ramp: run airtime stat', ramp.runAirtime > 0.4 && Math.abs(ramp.runAirtime - (landed?.airTime ?? 0)) < 1e-6, `run.airtime ${ramp.runAirtime.toFixed(3)} s`);

  /* ---------------------------------------------------------------- bowl */
  const coast = (def) => page.evaluate(({ def, b }) => {
    window.__load(def ? window.__dev.DEV_TERRAIN : {});
    const g = window.__game;
    const p = g.ctx.plow;
    window.__place(b.x + b.r + 1.5, b.z, -Math.PI / 2, 7);
    window.__in.t = 0;
    let atCentre = null;
    let minY = 9;
    let exitSpeed = null;
    for (let i = 0; i < 360; i++) {
      g.tick(1 / 60);
      minY = Math.min(minY, p.position.y);
      if (atCentre === null && p.position.x <= b.x) atCentre = { speed: p.speed, y: p.position.y, ground: g.ctx.terrain.ground(p.position.x, p.position.z), t: i / 60 };
      if (atCentre && exitSpeed === null && p.position.x <= b.x - b.r * 0.6) exitSpeed = p.speed;
      if (p.speed <= 0.01) break;
    }
    return { atCentre, minY, exitSpeed, endX: p.position.x, endSpeed: p.speed };
  }, { def, b: F.bowl });
  const bowlRun = await coast(true);
  const flatCoast = await coast(false);
  check('bowl: coasting in rolls further and faster than on flat', bowlRun.atCentre && bowlRun.atCentre.speed > 3 && (!flatCoast.atCentre || bowlRun.atCentre.speed > flatCoast.atCentre.speed + 3),
    `coasting from 7 m/s: ${bowlRun.atCentre ? bowlRun.atCentre.speed.toFixed(2) : '-'} m/s at the bowl centre (${(F.bowl.r + 1.5).toFixed(1)} m) vs flat ${flatCoast.atCentre ? flatCoast.atCentre.speed.toFixed(2) + ' m/s' : 'stopped after ' + (F.bowl.x + F.bowl.r + 1.5 - flatCoast.endX).toFixed(1) + ' m'}`);
  check('bowl: feet follow the ground', bowlRun.atCentre && Math.abs(bowlRun.atCentre.y - bowlRun.atCentre.ground) < 0.4 && bowlRun.minY < F.bowl.h + 0.5, `y ${bowlRun.atCentre?.y.toFixed(2)} vs ground ${bowlRun.atCentre?.ground.toFixed(2)}, lowest ${bowlRun.minY.toFixed(2)}`);
  // Full throttle into the bowl beats the flat top speed (slope boost), then a screenshot down in it.
  const boost = await page.evaluate((b) => {
    window.__load(window.__dev.DEV_TERRAIN);
    const g = window.__game;
    const p = g.ctx.plow;
    window.__place(b.x + b.r + 1.5, b.z, -Math.PI / 2, g.ctx.stats.maxSpeed);
    window.__in.t = 1;
    let top = 0;
    let centre = 0;
    let exit = null;
    let shotState = null;
    for (let i = 0; i < 150; i++) {
      g.tick(1 / 60);
      top = Math.max(top, p.speed);
      if (!centre && p.position.x <= b.x) {
        centre = p.speed;
        shotState = { x: p.position.x, y: p.position.y, z: p.position.z, heading: p.heading, speed: p.speed };
      }
      if (centre && p.position.x <= b.x - b.r * 0.6) {
        exit = p.speed;
        break;
      }
    }
    window.__in.t = 0;
    return { top, centre, exit, max: g.ctx.stats.maxSpeed, shotState };
  }, F.bowl);
  check('bowl: full throttle into it beats the flat top speed', boost.centre > boost.max + 1, `${boost.centre.toFixed(2)} m/s at the centre (top ${boost.top.toFixed(2)}) vs flat cap ${boost.max.toFixed(2)}`);
  check('bowl: climbing out slows you', boost.exit !== null && boost.exit < boost.centre - 2, `centre ${boost.centre.toFixed(2)} -> 60% up the far side ${boost.exit?.toFixed(2)} m/s (full throttle)`);
  // Screenshot down in the bowl (re-place at the centre, let the camera settle).
  await page.evaluate((st) => {
    const g = window.__game;
    const p = g.ctx.plow;
    window.__place(st.x + 4, st.z, st.heading, 4);
    for (let i = 0; i < 30; i++) g.tick(1 / 60);
  }, boost.shotState);
  await shot('02-plow-in-bowl', [0, 7, 17]);

  /* ---------------------------------------------------------------- lava */
  const lava = await page.evaluate((l) => {
    window.__load(window.__dev.DEV_TERRAIN);
    const g = window.__game;
    const p = g.ctx.plow;
    window.__place((l.x1 + l.x2) / 2, l.z, 0, 0);
    const regen = g.ctx.stats.hpRegen;
    for (let i = 0; i < 6; i++) g.tick(1 / 60); // settle onto it
    const hp0 = p.hp;
    for (let i = 0; i < 120; i++) g.tick(1 / 60);
    return { rate: (hp0 - p.hp) / 2 + regen, regen, material: p.material, events: window.__ev.damaged };
  }, F.lava);
  check('lava: drains 8 HP/s', Math.abs(lava.rate - 8) < 0.3 && lava.material === 'lava', `${lava.rate.toFixed(2)} HP/s (regen ${lava.regen}), plowDamaged total ${lava.events.toFixed(1)}`);

  /* ---------------------------------------------------------------- ice */
  const turn = (x, z) => page.evaluate(({ x, z }) => {
    const g = window.__game;
    const p = g.ctx.plow;
    window.__place(x, z, Math.PI / 2, 8);
    window.__in.t = 1;
    window.__in.s = 1;
    let px = p.position.x;
    let pz = p.position.z;
    let slip = 0;
    for (let i = 0; i < 36; i++) {
      g.tick(1 / 60);
      const vx = (p.position.x - px) * 60;
      const vz = (p.position.z - pz) * 60;
      px = p.position.x;
      pz = p.position.z;
      const a = Math.atan2(vx, vz) - p.heading;
      slip = Math.max(slip, Math.abs(Math.atan2(Math.sin(a), Math.cos(a))));
    }
    // brake from 8 m/s
    window.__place(x, z, Math.PI / 2, 8);
    window.__in.s = 0;
    window.__in.t = -1;
    const x0 = p.position.x;
    let n = 0;
    while (p.speed > 0.05 && n++ < 300) g.tick(1 / 60);
    window.__in.t = 0;
    return { slipDeg: (slip * 180) / Math.PI, brake: p.position.x - x0, ice: p.onIce };
  }, { x, z });
  await page.evaluate(() => window.__load(window.__dev.DEV_TERRAIN));
  const onIce = await turn(F.ice.x - 4, F.ice.z);
  const onSnow = await turn(-4, 6);
  check('ice: drifts (slip angle while turning)', onIce.slipDeg > 10 && onSnow.slipDeg < 1, `slip ${onIce.slipDeg.toFixed(1)}° on ice vs ${onSnow.slipDeg.toFixed(2)}° on snow`);
  check('ice: long braking', onIce.brake > onSnow.brake * 2, `stopping distance ${onIce.brake.toFixed(2)} m on ice vs ${onSnow.brake.toFixed(2)} m on snow`);

  /* ---------------------------------------------------------------- conveyor */
  const conv = await page.evaluate((cv) => {
    const g = window.__game;
    const p = g.ctx.plow;
    window.__place((cv.minX + cv.maxX) / 2, cv.minZ + 2, 0, 0);
    const z0 = p.position.z;
    for (let i = 0; i < 60; i++) g.tick(1 / 60);
    return p.position.z - z0;
  }, F.conveyor);
  check('conveyor: carries the plow', Math.abs(conv - F.conveyor.speed) < 0.6, `${conv.toFixed(2)} m in 1 s (strip ${F.conveyor.speed} m/s)`);

  /* ---------------------------------------------------------------- bots */
  const bots = await page.evaluate(({ b, l }) => {
    const g = window.__game;
    const c = g.ctx;
    window.__load(window.__dev.DEV_TERRAIN);
    // Seeded Math.random for the bot sections (AI timers / attack rolls): every run plays the same fights.
    window.__seed = (n) => {
      if (!window.__rnd) window.__rnd = Math.random;
      let a = n >>> 0;
      Math.random = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    };
    window.__unseed = () => { if (window.__rnd) Math.random = window.__rnd; };
    /** Lava tick classifier for one bot: ticks of a stay that began while knocked (|kv| > 1.5) or just after a flight
     *  are 'knocked'; any other lava tick means its own steering took it in. */
    window.__lavaWatch = () => {
      const w = { steered: 0, knocked: 0, inLava: false, wasKnock: false, air: 0, log: [] };
      w.step = (e) => {
        w.air = e.airborne ? 15 : w.air - 1;
        const on = !e.airborne && c.terrain.materialAt(e.position.x, e.position.z) === 'lava';
        if (on && !w.inLava) w.wasKnock = Math.hypot(e.kvx, e.kvz) > 1.5 || w.air > 0;
        w.inLava = on;
        if (!on) return;
        if (w.wasKnock) w.knocked++;
        else {
          w.steered++;
          if (w.log.length < 6) w.log.push(`${e.type}/${e.state} v${e.speed.toFixed(1)} kv${Math.hypot(e.kvx, e.kvz).toFixed(1)} h${e.heading.toFixed(2)}/${e.desHeading.toFixed(2)} @${e.position.x.toFixed(1)},${e.position.z.toFixed(1)}`);
        }
      };
      return w;
    };
    window.__seed(1);
    // Player parked north of the lava river, a scrapper south of it: its orbit / attacks cross the river line.
    window.__place((l.x1 + l.x2) / 2, l.z - 5, 0, 0);
    c.plow.hp = 1e6;
    c.plow.maxHp = 1e6;
    c.enemies.clear();
    const s = c.enemies.spawn('scrapper', (l.x1 + l.x2) / 2 + 1, l.z + 5, { heading: Math.PI });
    const bowlBot = c.enemies.spawn('brute', b.x + 2, b.z, { heading: 0 });
    const watch = window.__lavaWatch();
    let crossed = false;
    let maxBowlErr = 0;
    let bowlMinY = 9;
    const hp0 = s.hp;
    for (let i = 0; i < 600; i++) {
      g.tick(1 / 60);
      if (!s.alive) break;
      watch.step(s);
      if (s.position.z < l.z - l.r) crossed = true;
      if (bowlBot.alive && !bowlBot.airborne) {
        const ground = c.terrain.ground(bowlBot.position.x, bowlBot.position.z);
        maxBowlErr = Math.max(maxBowlErr, Math.abs(bowlBot.position.y - ground) - 0.6);
        bowlMinY = Math.min(bowlMinY, bowlBot.position.y);
      }
    }
    // launch() + enemyLanded
    window.__ev.enemyLanded = [];
    c.enemies.launch(bowlBot, 9);
    const wasAir = bowlBot.airborne;
    let peak = bowlBot.position.y;
    for (let i = 0; i < 90; i++) {
      g.tick(1 / 60);
      peak = Math.max(peak, bowlBot.position.y);
    }
    window.__unseed();
    const res = { lavaTicks: watch.steered, knocked: watch.knocked, lavaLog: watch.log, bowlMinY, crossed, alive: s.alive, hpLost: hp0 - s.hp, bowlY: bowlBot.position.y, maxBowlErr, wasAir, peak, landed: window.__ev.enemyLanded.filter((e) => e.id === bowlBot.id).length };
    c.enemies.clear();
    return res;
  }, { b: F.bowl, l: F.lava });
  // More lava cases: the same scrapper fight with 5 more seeds; a thief fleeing over the river from right at its edge
  // (the Inferno Quarry case: it crept in and then drove straight across); bots knocked just inside the edge.
  const lava2 = await page.evaluate((l) => {
    const g = window.__game;
    const c = g.ctx;
    const mx = (l.x1 + l.x2) / 2;
    const out = { fight: [], flee: { steered: 0, knocked: 0, crossed: 0, runs: 0, log: [] }, exit: [] };
    for (let seed = 2; seed <= 6; seed++) {
      window.__seed(seed);
      window.__load(window.__dev.DEV_TERRAIN);
      window.__place(mx, l.z - 5, 0, 0);
      c.plow.hp = c.plow.maxHp = 1e6;
      c.enemies.clear();
      const s = c.enemies.spawn('scrapper', mx + 1 - (seed % 3), l.z + 5, { heading: Math.PI });
      const w = window.__lavaWatch();
      let crossed = false;
      for (let i = 0; i < 600 && s.alive; i++) {
        g.tick(1 / 60);
        w.step(s);
        if (s.position.z < l.z - l.r) crossed = true;
      }
      out.fight.push({ steered: w.steered, knocked: w.knocked, crossed, log: w.log });
    }
    // Thief with loot, 0.1-0.4 m from the south edge facing the river, the plow south of it: it flees north.
    for (let k = 0; k < 8; k++) {
      window.__seed(10 + k);
      window.__load(window.__dev.DEV_TERRAIN);
      window.__place(mx + (k % 3) - 1, l.z + 8, Math.PI, 0);
      c.plow.hp = c.plow.maxHp = 1e6;
      c.enemies.clear();
      const th = c.enemies.spawn('thief', mx - 3 + k, l.z + l.r + 0.1 + (k % 4) * 0.1, { heading: Math.PI + ((k % 5) - 2) * 0.3 });
      th.stole = true;
      th.carry = 5;
      const w = window.__lavaWatch();
      let crossed = false;
      for (let i = 0; i < 240 && th.alive; i++) {
        g.tick(1 / 60);
        w.step(th);
        if (th.position.z < l.z - l.r) crossed = true;
      }
      out.flee.runs++;
      out.flee.steered += w.steered;
      out.flee.knocked += w.knocked;
      if (crossed) out.flee.crossed++;
      out.flee.log.push(...w.log.slice(0, 2));
    }
    // Knocked in: 0.4 m inside the south edge facing into the river, the plow north of it (its AI pulls it across).
    for (const [type, h] of [['scrapper', Math.PI], ['thief', Math.PI * 0.6], ['brute', Math.PI], ['spinner', 0]]) {
      window.__seed(30);
      window.__load(window.__dev.DEV_TERRAIN);
      window.__place(mx, l.z - 6, 0, 0);
      c.plow.hp = c.plow.maxHp = 1e6;
      c.enemies.clear();
      const e = c.enemies.spawn(type, mx + 2, l.z + l.r - 0.4, { heading: h });
      let ticks = -1;
      let side = 'still in';
      for (let i = 0; i < 120; i++) {
        g.tick(1 / 60);
        if (c.terrain.materialAt(e.position.x, e.position.z) !== 'lava') {
          ticks = i + 1;
          side = e.position.z > l.z ? 'near' : 'far';
          break;
        }
      }
      out.exit.push({ type, ticks, side });
    }
    window.__unseed();
    c.enemies.clear();
    return out;
  }, F.lava);
  {
    const steered = bots.lavaTicks + lava2.fight.reduce((a, f) => a + f.steered, 0);
    const knocked = bots.knocked + lava2.fight.reduce((a, f) => a + f.knocked, 0);
    const got = (bots.crossed ? 1 : 0) + lava2.fight.filter((f) => f.crossed).length;
    const log = [...bots.lavaLog, ...lava2.fight.flatMap((f) => f.log)].slice(0, 6).join(' | ');
    check('bots: steer around lava', steered === 0 && got >= 1, `6 seeded 10 s scrapper fights across the river: ${steered} ticks steered onto lava (${knocked} after knockbacks), got round the river in ${got}/6 (alive ${bots.alive}) ${log}`);
    const f = lava2.flee;
    check('bots: a thief fleeing from the river edge goes round it', f.steered === 0, `${f.runs} runs from 0.1-0.4 m off the edge: ${f.steered} ticks steered onto lava (${f.knocked} knocked), got across ${f.crossed}/${f.runs} ${f.log.join(' | ')}`);
    const ex = lava2.exit;
    check('bots: knocked into lava, drive out the near side', ex.every((e) => e.side === 'near' && e.ticks > 0 && e.ticks <= 45), ex.map((e) => `${e.type} ${e.ticks} ticks (${e.side})`).join(', '));
  }
  check('bots: follow terrain height', bots.maxBowlErr < 0.05 && bots.bowlMinY < -1.5, `bowl bot lowest y ${bots.bowlMinY.toFixed(2)}, max |y - ground| beyond the snow sink ${Math.max(0, bots.maxBowlErr).toFixed(3)} m`);
  check('bots: launch() flies and lands (enemyLanded)', bots.wasAir && bots.landed === 1 && bots.peak > bots.bowlY + 1, `peak ${bots.peak.toFixed(2)} m, enemyLanded ${bots.landed}`);

  /* ---------------------------------------------------------------- last-bot hunt */
  // Two thieves 52 m away along a clear lane (z 26). With no ball to steal their own AI only creeps in (a slow 4.8 m
  // orbit); the hunt (nothing left to spawn, <= HUNT_LEFT minions) drives them straight at the player. Control: the
  // same two with a third minion parked (stunned) in a far corner, so the hunt stays off.
  const huntRun = (control) => page.evaluate((control) => {
    const g = window.__game;
    const c = g.ctx;
    c.enemies.clear();
    c.waves.clear();
    window.__load({});
    window.__place(-26, 26, 0, 0);
    c.plow.hp = c.plow.maxHp = 1e6;
    const a = c.enemies.spawn('thief', 26, 25, { heading: 0 });
    const b = c.enemies.spawn('thief', 26, 27, { heading: 0 });
    const parked = control ? c.enemies.spawn('scrapper', 30, -30, { heading: 0 }) : null;
    const dist = () => Math.min(Math.hypot(a.position.x + 26, a.position.z - 26), Math.hypot(b.position.x + 26, b.position.z - 26));
    const d0 = dist();
    let hunting = false;
    let t15 = null;
    for (let i = 0; i < 480; i++) {
      if (parked) {
        parked.stun = 99;
        parked.position.x = 30;
        parked.position.z = -30;
      }
      g.tick(1 / 60);
      if (c.enemies.hunting) hunting = true;
      if (t15 === null && dist() < 15) t15 = (i + 1) / 60;
    }
    const res = { d0, d1: dist(), hunting, t15 };
    c.enemies.clear();
    return res;
  }, control);
  const hunt = await huntRun(false);
  const huntCtl = await huntRun(true);
  check('bots: last-bot hunt drives the stragglers at the player (vs no hunt)',
    hunt.hunting && !huntCtl.hunting && hunt.d1 < 8 && huntCtl.d1 > hunt.d1 + 5 && hunt.t15 !== null && (huntCtl.t15 === null || huntCtl.t15 > hunt.t15 + 2),
    `thieves from ${hunt.d0.toFixed(1)} m: within 15 m after ${hunt.t15?.toFixed(2) ?? '-'} s, ${hunt.d1.toFixed(1)} m at 8 s (hunt on) vs ${huntCtl.t15?.toFixed(2) ?? 'never'} s, ${huntCtl.d1.toFixed(1)} m (control, hunt on: ${huntCtl.hunting})`);

  /* ---------------------------------------------------------------- The Omega Works (decks) */
  // Arena 6's terrain, loaded only here (the game does not wire it in yet): half-size 80, OMEGA_TERRAIN.
  await page.evaluate(async () => {
    const c = window.__game.ctx;
    window.__types = await import('/src/core/types.ts');
    window.__omega = await import('/src/world/omega/layout.ts');
    window.__half0 = window.__types.ARENA.maxX;
    window.__types.setArenaHalfSize(window.__omega.OMEGA_HALF);
    c.enemies.clear();
    c.pickups.clear();
    window.__load(window.__omega.OMEGA_TERRAIN);
    /** Place on the topmost surface at (x, z) (plow.reset(at) settles the feet there). */
    window.__placeAt = (x, z, heading, speed = 0) => {
      c.plow.reset({ x, z, heading });
      c.plow.speed = speed;
      c.plow.hp = c.plow.maxHp = 1e6;
      c.cameraRig.snap();
      for (const k of Object.keys(window.__ev)) window.__ev[k] = Array.isArray(window.__ev[k]) ? [] : 0;
    };
    /** Full throttle for up to `sec` s; per tick [x, y, z, deck, airborne, camY]; stops early when stop(p) is true. */
    window.__run = (sec, stop) => {
      const g = window.__game;
      const p = c.plow;
      const tr = [];
      window.__in.t = 1;
      window.__in.s = 0;
      for (let i = 0; i < Math.round(sec * 60); i++) {
        g.tick(1 / 60);
        tr.push([p.position.x, p.position.y, p.position.z, p.deck, p.airborne ? 1 : 0, c.camera.position.y]);
        if (stop && stop(p)) break;
      }
      window.__in.t = 0;
      return tr;
    };
  });
  const omegaOk = await page.evaluate(() => window.__game.ctx.terrain.decks.length > 20 && window.__types.ARENA.maxX === 80);
  check('omega: terrain loaded (probe only)', omegaOk, `decks ${await page.evaluate(() => window.__game.ctx.terrain.decks.length)}, arena half ${await page.evaluate(() => window.__types.ARENA.maxX)}`);

  // Under the Assembly Floor (underside 5.8): x = -8 runs between the pillars and clear of ramp S.
  const under = await page.evaluate(() => {
    window.__placeAt(-8, 32, Math.PI);
    const tr = window.__run(6, (p) => p.position.z < -12);
    const inside = tr.filter((r) => r[2] < 16 && r[2] > -16);
    const last = tr[tr.length - 1];
    return {
      n: inside.length,
      maxDeck: Math.max(...inside.map((r) => r[3])),
      maxY: Math.max(...inside.map((r) => r[1])),
      maxCam: Math.max(...inside.slice(-30).map((r) => r[5])),
      air: inside.some((r) => r[4]),
      z: last[2],
      ride: window.__game.ctx.plow.position.y - window.__game.ctx.plow.surfaceY,
    };
  });
  check('omega: drives under the Floor at ground level', under.n > 30 && under.maxDeck === -1 && under.maxY < 0.45 && !under.air,
    `${under.n} ticks under it: deck ${under.maxDeck}, feet <= ${under.maxY.toFixed(2)} m (ride ${under.ride.toFixed(2)}), reached z ${under.z.toFixed(1)}`);
  check('omega: camera stays below the Floor underside (5.8 m) in the undercroft', under.maxCam < 5.8, `camera y <= ${under.maxCam.toFixed(2)} m over the last 0.5 s under it`);

  // Ceiling bonk: thrown up under the Floor, the head (2.4 m) stops at the underside.
  const bonk = await page.evaluate(() => {
    const g = window.__game;
    const p = g.ctx.plow;
    const v = p.vert;
    v.airborne = true;
    v.vy = 16;
    v.airTime = 0.2;
    let peak = p.position.y;
    let minVy = 99;
    let ticks = 0;
    for (let i = 0; i < 90; i++) {
      g.tick(1 / 60);
      peak = Math.max(peak, p.position.y);
      if (v.airborne) minVy = Math.min(minVy, v.vy);
      ticks++;
      if (!p.airborne && i > 5) break;
    }
    return { peak, free: (16 * 16) / (2 * g.ctx.terrain.gravity), deck: p.deck, ticks, landed: window.__ev.landed.length };
  });
  check('omega: ceiling bonk under the Floor', bonk.peak + 2.4 <= 5.8 + 0.05 && bonk.peak < bonk.free - 1 && bonk.deck === -1,
    `head peak ${(bonk.peak + 2.4).toFixed(2)} m (underside 5.8; free flight would reach ${(bonk.free + 2.4).toFixed(1)} m), back on deck ${bonk.deck} after ${bonk.ticks} ticks`);

  // Ramps: S (z 44 ground -> z 18 Floor, grade 0.27) from (0, 54) heading pi; NE (z -14 ground -> z -40 platform).
  // `sgn` -1: the run ends when the coordinate rises past `until` (driving +x / +z) instead of dropping below it.
  // `launched` counts plowLaunched over the whole climb: a crest hop onto the deck fails the no-hop check.
  const climb = (x, z, heading, axis, until, deck, sgn = 1, sec = 8) => page.evaluate(({ x, z, heading, axis, until, deck, sgn, sec }) => {
    window.__placeAt(x, z, heading);
    const k = axis === 'z' ? 2 : 0;
    const tr = window.__run(sec, (p) => sgn * (axis === 'z' ? p.position.z : p.position.x) < sgn * until);
    const last = tr[tr.length - 1];
    const onRamp = tr.filter((r) => r[3] !== -1 && r[3] !== deck);
    // Longest stretch (s) the plow made less than 0.5 m of progress per 0.5 s (a snag on a pillar / lip).
    let stall = 0;
    for (let i = 30; i < tr.length; i++) if (Math.abs(tr[i][k] - tr[i - 30][k]) < 0.5) stall = Math.max(stall, 0.5);
    return {
      stall,
      landed: window.__ev.landed.length,
      air: tr.filter((r) => r[4]).length,
      reached: sgn * last[k] < sgn * until,
      y: last[1],
      deck: last[3],
      t: tr.length / 60,
      wantDeck: deck,
      launched: window.__ev.launched.length,
      rampTicks: onRamp.length,
      rampSpeed: onRamp.length ? Math.abs(onRamp[onRamp.length - 1][k] - onRamp[0][k]) / (onRamp.length / 60) : 0,
    };
  }, { x, z, heading, axis, until, deck, sgn, sec });
  const rampS = await climb(0, 54, Math.PI, 'z', 8, 1);
  check('omega: climbs ramp S onto the Assembly Floor', rampS.reached && rampS.deck === 1 && Math.abs(rampS.y - 7) < 0.4,
    `z < 8 after ${rampS.t.toFixed(2)} s: y ${rampS.y.toFixed(2)}, deck ${rampS.deck}; ${(rampS.rampTicks / 60).toFixed(2)} s on the ramp at ${rampS.rampSpeed.toFixed(1)} m/s; crest launches ${rampS.launched}`);
  const rampNE = await climb(52, -4, Math.PI, 'z', -44, 5);
  check('omega: climbs ramp NE onto the NE platform', rampNE.reached && rampNE.deck === 5 && Math.abs(rampNE.y - 7) < 0.4,
    `z < -44 after ${rampNE.t.toFixed(2)} s: y ${rampNE.y.toFixed(2)}, deck ${rampNE.deck}; ${(rampNE.rampTicks / 60).toFixed(2)} s on the ramp at ${rampNE.rampSpeed.toFixed(1)} m/s; crest launches ${rampNE.launched}`);
  // The steepest one: the Control Tower ramp (grade 0.43, Floor z 15 -> Tower z 1), from the Floor.
  const rampT = await climb(9, 17, Math.PI, 'z', -3, 3);
  check('omega: climbs the tower ramp (grade 0.43) onto the Control Tower', rampT.reached && rampT.deck === 3 && Math.abs(rampT.y - 13) < 0.4,
    `z < -3 after ${rampT.t.toFixed(2)} s: y ${rampT.y.toFixed(2)}, deck ${rampT.deck}; ${(rampT.rampTicks / 60).toFixed(2)} s on the ramp at ${rampT.rampSpeed.toFixed(1)} m/s; crest launches ${rampT.launched}`);
  // Rotated ramps: E (x 44 ground -> x 18 Floor, rot +pi/2, falling along +x) from (54, 0) heading -pi/2, W (x -44 ->
  // -18) from (-54, 0) heading pi/2: on the Floor at y ~7 before |x| < 10.
  const rampE = await climb(54, 0, -Math.PI / 2, 'x', 10, 1);
  check('omega: climbs ramp E (rotated) onto the Assembly Floor', rampE.reached && rampE.deck === 1 && Math.abs(rampE.y - 7) < 0.4,
    `x < 10 after ${rampE.t.toFixed(2)} s: y ${rampE.y.toFixed(2)}, deck ${rampE.deck}; ${(rampE.rampTicks / 60).toFixed(2)} s on the ramp at ${rampE.rampSpeed.toFixed(1)} m/s; launches ${rampE.launched}, landings ${rampE.landed}`);
  const rampW = await climb(-54, 0, Math.PI / 2, 'x', -10, 1, -1);
  check('omega: climbs ramp W (rotated) onto the Assembly Floor', rampW.reached && rampW.deck === 1 && Math.abs(rampW.y - 7) < 0.4,
    `x > -10 after ${rampW.t.toFixed(2)} s: y ${rampW.y.toFixed(2)}, deck ${rampW.deck}; ${(rampW.rampTicks / 60).toFixed(2)} s on the ramp at ${rampW.rampSpeed.toFixed(1)} m/s; launches ${rampW.launched}, landings ${rampW.landed}`);
  // Ramp N from the north (z -44 -> -18), then on across the Floor past the tower columns (20 at (-2, -14), 21 at
  // (6, -15)) without snagging on column 20's corner.
  const rampN = await climb(0, -54, 0, 'z', -6, 1, -1);
  check('omega: climbs ramp N and drives on past the tower columns (no snag)', rampN.reached && rampN.deck === 1 && Math.abs(rampN.y - 7) < 0.4 && rampN.stall === 0,
    `z > -6 after ${rampN.t.toFixed(2)} s: y ${rampN.y.toFixed(2)}, deck ${rampN.deck}; stalled ${rampN.stall ? 'yes' : 'no'}; launches ${rampN.launched}`);
  // Ramp SW (z 14 ground -> z 40 SW platform) from the south ring, heading +z.
  const rampSW = await climb(-52, 4, 0, 'z', 44, 6, -1);
  check('omega: climbs ramp SW onto the SW platform', rampSW.reached && rampSW.deck === 6 && Math.abs(rampSW.y - 7) < 0.4,
    `z > 44 after ${rampSW.t.toFixed(2)} s: y ${rampSW.y.toFixed(2)}, deck ${rampSW.deck}; ${(rampSW.rampTicks / 60).toFixed(2)} s on the ramp at ${rampSW.rampSpeed.toFixed(1)} m/s; launches ${rampSW.launched}`);
  const ramps = { S: rampS, N: rampN, E: rampE, W: rampW, NE: rampNE, SW: rampSW, tower: rampT };
  const hops = Object.entries(ramps).filter(([, r]) => r.launched || r.landed || r.air);
  check('omega: no crest hop climbing any ramp onto its deck', hops.length === 0,
    Object.entries(ramps).map(([n, r]) => `${n} ${r.launched}/${r.landed}/${r.air}`).join(', ') + ' (plowLaunched / plowLanded / airborne ticks)');
  // ...but not up a sheer side: a Floor pillar (5.8 m) from the ground, and ramp S's flank (well up it).
  const blocked = await page.evaluate(() => {
    const c = window.__game.ctx;
    window.__placeAt(-24, -12, Math.PI / 2); // facing +x at the pillar at (-12, -12) (west face x -12.8)
    window.__run(3);
    const a = { x: c.plow.position.x, deck: c.plow.deck, y: c.plow.position.y };
    window.__placeAt(-14, 34, Math.PI / 2); // facing +x into ramp S's west flank (x -5, top ~2.7 m there)
    window.__run(3);
    const b = { x: c.plow.position.x, deck: c.plow.deck, y: c.plow.position.y };
    return { a, b };
  });
  check('omega: pillars and ramp flanks still block the plow', blocked.a.deck === -1 && blocked.a.x < -12.8 - 1.6 && blocked.a.y < 0.5 && blocked.b.deck === -1 && blocked.b.x < -5 - 1.6 && blocked.b.y < 0.5,
    `pillar: stopped at x ${blocked.a.x.toFixed(2)} (face -12.8, body r 1.6, deck ${blocked.a.deck}, y ${blocked.a.y.toFixed(2)}); ramp S flank: stopped at x ${blocked.b.x.toFixed(2)} (flank -5, deck ${blocked.b.deck}, y ${blocked.b.y.toFixed(2)})`);

  // Off the Floor's west edge (x -18, 7 m drop): a real flight and a landing.
  const drop = await page.evaluate(() => {
    window.__placeAt(-6, -8, -Math.PI / 2);
    const y0 = window.__game.ctx.plow.position.y;
    const tr = window.__run(2.5, (p) => p.position.x < -26);
    const last = tr[tr.length - 1];
    return { y0, deck: last[3], y: last[1], landed: window.__ev.landed.map((e) => ({ impact: e.impact, air: e.airTime })), launched: window.__ev.launched.length };
  });
  const dl = drop.landed[0];
  check('omega: drives off the Floor edge and lands (plowLanded)', drop.y0 > 6.9 && drop.landed.length === 1 && dl.impact > 10 && drop.deck === -1,
    `from y ${drop.y0.toFixed(2)}: plowLaunched ${drop.launched}, plowLanded ${drop.landed.length} (impact ${dl ? dl.impact.toFixed(1) : '-'} m/s, ${dl ? dl.air.toFixed(2) : '-'} s), now deck ${drop.deck}`);

  // A 0.3 m lip (a deck added beside the Omega layout, in the south ring) crossed at speed: a step, not a jump.
  const lip = await page.evaluate(() => {
    const O = window.__omega.OMEGA_TERRAIN;
    window.__load({ ...O, decks: [...O.decks, { id: 99, x: 0, z: 68, hw: 3, hd: 3, rot: 0, top: 0.3, thickness: 0.3 }] });
    window.__placeAt(-12, 68, Math.PI / 2, 6);
    const tr = window.__run(2.2); // plowing the ring snow holds it to ~8.8 m/s: 2.2 s carries it well off the far side
    const on = tr.filter((r) => r[3] === 99);
    const res = {
      on: on.length,
      peak: Math.max(...tr.map((r) => r[1])),
      air: tr.filter((r) => r[4]).length,
      launched: window.__ev.launched.length,
      landed: window.__ev.landed.length,
      x: tr[tr.length - 1][0],
      ride: window.__game.ctx.plow.position.y - window.__game.ctx.plow.surfaceY,
    };
    window.__load(O);
    return res;
  });
  check('omega: 0.3 m lip crossed at speed is a step (no launch)', lip.on > 10 && lip.x > 4 && lip.launched === 0 && lip.landed === 0 && lip.peak <= 0.35 + 0.25,
    `${lip.on} ticks on the lip, crossed to x ${lip.x.toFixed(1)}: peak feet ${lip.peak.toFixed(2)} m (lip 0.3 + snow ride), ${lip.air} airborne ticks, plowLaunched ${lip.launched}, plowLanded ${lip.landed}`);

  // Coins dropped on the Floor stay on it; coins dropped in the undercroft rest on the ground under it.
  const coins = await page.evaluate(() => {
    const g = window.__game;
    const c = g.ctx;
    window.__placeAt(0, 66, Math.PI); // far away (no magnet pickup)
    c.pickups.clear();
    c.pickups.spawnCoins({ x: -8, y: 7.2, z: -6 }, 18);
    c.pickups.spawnCoins({ x: 8, y: 0.6, z: 6 }, 18);
    for (let i = 0; i < 180; i++) g.tick(1 / 60);
    const live = c.pickups.coins.filter((k) => k.active);
    const top = live.filter((k) => Math.hypot(k.pos.x + 8, k.pos.z + 6) < 8);
    const low = live.filter((k) => Math.hypot(k.pos.x - 8, k.pos.z - 6) < 8);
    const res = {
      n: live.length,
      top: top.length,
      topY: top.map((k) => k.pos.y),
      low: low.length,
      lowY: low.map((k) => k.pos.y),
      grounded: live.filter((k) => k.grounded).length,
    };
    c.pickups.clear();
    return res;
  });
  check('omega: coins dropped on the Floor stay on it (and under it on the ground)',
    coins.top === 6 && coins.topY.every((y) => y > 7 && y < 7.6) && coins.low === 6 && coins.lowY.every((y) => y < 1.5) && coins.grounded === coins.n,
    `${coins.top} coins on the Floor at y ${Math.min(...coins.topY).toFixed(2)}-${Math.max(...coins.topY).toFixed(2)}, ${coins.low} under it at y ${Math.min(...coins.lowY).toFixed(2)}-${Math.max(...coins.lowY).toFixed(2)}; ${coins.grounded}/${coins.n} resting after 3 s`);

  // Coins dropped low on ramps E / W roll DOWN the slope (E: toward +x, W: toward -x) to the ground, not up it.
  const roll = await page.evaluate(() => {
    const g = window.__game;
    const c = g.ctx;
    window.__placeAt(0, 66, Math.PI);
    c.pickups.clear();
    // Low on the ramps (top ~1.3 m here): rolling ~1.7 m/s, they reach the toe well before coins home in at 10 s.
    c.pickups.spawnCoins({ x: 39, y: 2.5, z: 0 }, 18);
    c.pickups.spawnCoins({ x: -39, y: 2.5, z: 0 }, 18);
    // Per coin (pool order is stable): [x, y, deck under it, pool index].
    const sample = () => {
      const live = [];
      c.pickups.coins.forEach((k, i) => { if (k.active) live.push([k.pos.x, k.pos.y, c.terrain.surfaceAt(k.pos.x, k.pos.z, k.pos.y - 0.32).deck, i]); });
      return { e: live.filter((k) => k[0] > 0), w: live.filter((k) => k[0] < 0) };
    };
    for (let i = 0; i < 60; i++) g.tick(1 / 60);
    const a = sample();
    for (let i = 0; i < 420; i++) g.tick(1 / 60);
    const b = sample();
    c.pickups.clear();
    return { a, b };
  });
  const cMinX = (l) => Math.min(...l.map((k) => k[0]));
  const cMaxX = (l) => Math.max(...l.map((k) => k[0]));
  const cMaxY = (l) => Math.max(...l.map((k) => k[1]));
  // Downhill shift of each coin from 1 s to 8 s (E: +x, W: -x); every coin must end on the ground (deck -1).
  const shift = (a, b, sgn) => b.map((k) => sgn * (k[0] - (a.find((q) => q[3] === k[3]) ?? k)[0]));
  const shE = shift(roll.a.e, roll.b.e, 1);
  const shW = shift(roll.a.w, roll.b.w, -1);
  const mean = (l) => l.reduce((x, y) => x + y, 0) / (l.length || 1);
  check('omega: coins on ramps E / W roll down to the ground (not up)',
    roll.b.e.length === 6 && roll.b.w.length === 6 && roll.b.e.every((k) => k[2] === -1) && roll.b.w.every((k) => k[2] === -1) &&
      Math.min(...shE, ...shW) > -0.2 && mean(shE) > 2 && mean(shW) > 2,
    `E: x ${cMinX(roll.a.e).toFixed(1)}..${cMaxX(roll.a.e).toFixed(1)} at 1 s -> ${cMinX(roll.b.e).toFixed(1)}..${cMaxX(roll.b.e).toFixed(1)} at 8 s (y <= ${cMaxY(roll.b.e).toFixed(2)}); ` +
    `W: x ${cMinX(roll.a.w).toFixed(1)}..${cMaxX(roll.a.w).toFixed(1)} -> ${cMinX(roll.b.w).toFixed(1)}..${cMaxX(roll.b.w).toFixed(1)} (y <= ${cMaxY(roll.b.w).toFixed(2)}); ramp toes at |x| 44; ` +
    `mean downhill shift E ${mean(shE).toFixed(1)} m / W ${mean(shW).toFixed(1)} m (least ${Math.min(...shE, ...shW).toFixed(2)}), on the ground ${roll.b.e.concat(roll.b.w).filter((k) => k[2] === -1).length}/12`);

  // A scorch decal and a shower of sparks on the Floor (7 m up) stay on it: the decal keeps its height, no spark falls
  // through to the undercroft.
  const fxFloor = await page.evaluate(() => {
    const g = window.__game;
    const c = g.ctx;
    window.__placeAt(0, 66, Math.PI);
    c.fx.clear();
    c.fx.scorch({ x: -8, y: 7.4, z: -6 }, 2);
    c.fx.sparks({ x: -8, y: 9, z: -6 }, { x: 0, y: -1, z: 0 }, { count: 40, speed: 6, spread: 0.3, life: 1.5 });
    const sb = c.fx.sparkBatch;
    const n0 = sb.n;
    let minPy = 99;
    let hit = 0;
    for (let i = 0; i < 60; i++) {
      g.tick(1 / 60);
      for (let j = 0; j < sb.n; j++) {
        if (Math.abs(sb.px[j]) > 17 || Math.abs(sb.pz[j]) > 17) continue; // over the Floor only
        minPy = Math.min(minPy, sb.py[j]);
        if (sb.py[j] < 7.1) hit++;
      }
    }
    const sc = c.fx.scorchBatch;
    const res = { scorchN: sc.n, scorchY: sc.n ? sc.y[0] : -1, n0, minPy, hit, left: sb.n };
    c.fx.clear();
    return res;
  });
  check('omega: a scorch and sparks on the Floor stay on it', fxFloor.scorchN === 1 && Math.abs(fxFloor.scorchY - 7.03) < 0.02 && fxFloor.minPy > 6.95 && fxFloor.hit > 0,
    `scorch y ${fxFloor.scorchY.toFixed(3)} after 1 s (Floor top 7); ${fxFloor.n0} sparks: lowest ${fxFloor.minPy.toFixed(2)} m over the Floor, ${fxFloor.hit} spark-ticks resting on it, ${fxFloor.left} left after 1 s`);

  await page.evaluate(() => {
    const c = window.__game.ctx;
    window.__types.setArenaHalfSize(window.__half0);
    window.__load({});
  });
} catch (e) {
  errors.push(`[probe] ${e.stack || e}`);
}

const failed = results.filter((r) => !r.ok);
console.log(errors.length ? `ERRORS (${errors.length}):\n` + errors.slice(0, 20).join('\n') : 'NO CONSOLE ERRORS');
console.log(`${results.length - failed.length}/${results.length} checks passed${noShots ? '' : `; screenshots in ${out}`}`);
await browser.close();
await server.close();
process.exit(failed.length || errors.length ? 1 : 0);
