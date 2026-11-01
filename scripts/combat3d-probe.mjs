// 3D combat probe: node scripts/combat3d-probe.mjs [outDir] [--noshots]
// Boots Vite + headless Chromium (PW_EXE=/opt/pw-browsers/chromium in containers) and checks Track D's combat on
// terrain with tick()-driven runs and numbers (exit code 1 on a failed check):
//   - air slam: off the dev-terrain ramp, SPACE mid-air dives (no ball held: no 'error' buzz); the landing shockwave
//     kills two scrappers (enemyKilled source 'airSlam')
//   - stomp: the same jump without SPACE, a bot beside the landing spot takes stomp damage (source 'stomp')
//   - dodge: BULLDOZA's phase-2 leap lands a shockwave on a parked plow (damage), and a plow that hops just before
//     the landing takes none
//   - BULLDOZA on Inferno Quarry (arena 2, sloped pit): the leap telegraph ring drapes over the slope, the boss flies
//     and lands at the ring; screenshots of the telegraph and the landing
//   - Quarry ramp: a real jump off the east lava ramp at top speed (height above the floor over the flight vs the leap
//     band LEAP_WAVE_BAND), then BULLDOZA's leap lands on the plow while it flies off that ramp: no shockwave damage
//   - Duel puppet (the opponent's plow on the guest): a replayed launch plays the jump sound, a replayed landing the land
//     sound, snow puff and ring on the ground under it
//   - persistent attacks on the Quarry pit slope: the FIRESTORM burning ground and a NUKE fallout pool drape over the
//     slope and the snow the melt left (raycasts vs the rendered SnowField: not hidden under it), and the burning ground
//     keeps hurting a ground bot while the plow is airborne
//   - The Omega Works (arena 5): FIRESTORM cast 2 m inside the Assembly Floor's edge stops at the edge (no sheet
//     floating past it), burns a bot on the deck and not one on the ground past the edge; screenshots
//   - THE DONALD's GOLD PLATED reflect hits a plow flying above his body band, and credits the boss's threat
// Screenshots go to outDir.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) || '/tmp/combat3d-probe';
const noShots = args.includes('--noshots');
mkdirSync(out, { recursive: true });

const port = 5200 + Math.floor(Math.random() * 500);
// No HMR / file watching: other edits in the tree must not reload the page mid-probe.
const server = await createServer({ server: { port, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
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
/** Render the current sim state (UI hidden); `cam` = [x, y, z, lookX, lookY, lookZ] for a fixed view. */
const shot = async (name, cam) => {
  if (noShots) return;
  await page.evaluate((cam) => {
    const canvas = document.querySelector('canvas');
    for (const el of document.body.children) if (!el.contains(canvas)) el.style.visibility = 'hidden';
    const g = window.__game;
    const c = g.ctx.camera;
    const keep = c.position.clone();
    const q = c.quaternion.clone();
    if (cam) {
      c.position.set(cam[0], cam[1], cam[2]);
      c.lookAt(cam[3], cam[4], cam[5]);
    }
    g.renderer.render(g.ctx.scene, c);
    c.position.copy(keep);
    c.quaternion.copy(q);
  }, cam);
  await page.screenshot({ path: `${out}/${name}.png` });
};

try {
  await page.goto(`http://localhost:${port}/?debug`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 });
  await page.evaluate(async () => {
    const g = window.__game;
    const c = g.ctx;
    g.setLoop(false);
    window.__dev = await import('/src/world/devTerrain.ts');
    window.__in = { t: 0, s: 0, press: new Set() };
    window.__ev = { killed: [], damaged: 0 };
    c.events.on('enemyKilled', (e) => window.__ev.killed.push({ type: e.enemy.type, source: e.source ?? null }));
    c.events.on('plowDamaged', (e) => (window.__ev.damaged += e.amount));
    /** Campaign arena `zi`, parked in an endless countdown (no waves), scripted input, no hit-stop. */
    window.__arena = (zi) => {
      g.startRun(zi);
      c.ui.hideOverlays();
      g.beginCountdown();
      g.countdown = 1e9;
      g.impact.enabled = false;
      c.enemies.clear();
      c.waves.clear();
      const inp = c.input;
      Object.defineProperty(inp, 'throttle', { get: () => window.__in.t, configurable: true });
      Object.defineProperty(inp, 'steer', { get: () => window.__in.s, configurable: true });
      if (!inp.__wrapped) {
        const orig = inp.wasPressed.bind(inp);
        inp.wasPressed = (k) => window.__in.press.has(k) || orig(k);
        inp.__wrapped = true;
      }
    };
    const THREE = await import('/node_modules/three/build/three.module.js');
    /** Raycast straight down on a grid over a GroundDisc mesh vs the rendered SnowField: samples where the snow
     *  surface sits above the disc (the disc is hidden under it). */
    window.__cover = (disc) => {
      const snowMesh = c.snow.mesh;
      snowMesh.updateMatrixWorld(true);
      disc.updateMatrixWorld(true);
      disc.geometry.computeBoundingSphere();
      const R = disc.geometry.boundingSphere.radius;
      const rc = new THREE.Raycaster();
      const down = new THREE.Vector3(0, -1, 0);
      const o = new THREE.Vector3();
      let n = 0;
      let hidden = 0;
      let worst = 0;
      for (let gx = -1; gx <= 1; gx += 0.08)
        for (let gz = -1; gz <= 1; gz += 0.08) {
          if (gx * gx + gz * gz > 0.9) continue;
          o.set(disc.position.x + gx * R, 80, disc.position.z + gz * R);
          rc.set(o, down);
          const hd = rc.intersectObject(disc, false)[0];
          if (!hd) continue;
          const hs = rc.intersectObject(snowMesh, false)[0];
          n++;
          if (hs && hs.point.y > hd.point.y + 0.002) {
            hidden++;
            worst = Math.max(worst, hs.point.y - hd.point.y);
          }
        }
      return { n, hidden, worst };
    };
    window.__load = (def) => { c.terrain.load(def ?? {}); c.snow.reset(c.zone); c.world.resetProps(false, false); };
    window.__place = (x, z, heading) => {
      c.plow.reset();
      c.plow.heading = heading;
      c.plow.position.x = x;
      c.plow.position.z = z;
      c.plow.speed = 0;
      c.plow.hp = c.plow.maxHp;
      c.plow.spawnProt = 0;
      c.cameraRig.snap();
      window.__ev.killed = [];
      window.__ev.damaged = 0;
    };
    /** A parked (stunned) bot at (x, z). */
    window.__bot = (type, x, z) => {
      const e = c.enemies.spawn(type, x, z);
      e.stun = 99;
      return e;
    };
    /** Drive full throttle up the dev ramp; `onAir(plow)` is called every airborne tick; runs until landed + 20. */
    window.__jump = (onAir) => {
      const p = c.plow;
      window.__in.t = 1;
      let wasAir = false;
      let land = null;
      let peak = 0;
      for (let i = 0; i < 400; i++) {
        window.__in.press.clear();
        if (p.airborne) onAir?.(p);
        g.tick(1 / 60);
        if (p.airborne) {
          wasAir = true;
          peak = Math.max(peak, p.position.y - p.surfaceY);
        } else if (wasAir && !land) land = { x: p.position.x, z: p.position.z, i };
        if (land && i > land.i + 20) break;
      }
      window.__in.t = 0;
      window.__in.press.clear();
      return { land, peak };
    };
  });

  /* ---------------------------------------------------------------- dry run: where does the ramp jump land? */
  const F = await page.evaluate(() => window.__dev.DEV_FEATURES);
  const dry = await page.evaluate((r) => {
    window.__arena(0);
    window.__load(window.__dev.DEV_TERRAIN);
    window.__place(r.x, r.toeZ + 6, Math.PI);
    return window.__jump();
  }, F.ramp);
  check('ramp jump lands', !!dry.land, `landing at (${dry.land?.x.toFixed(1)}, ${dry.land?.z.toFixed(1)}), peak ${dry.peak.toFixed(2)} m above the ground`);

  /* ---------------------------------------------------------------- air slam */
  const slam = await page.evaluate((r) => {
    window.__place(r.x, r.toeZ + 6, Math.PI);
    // Two scrappers either side of the flight path, a few metres past the lip (outside contact range of the plow).
    const a = window.__bot('scrapper', r.x - 3.4, r.lipZ - 3);
    const b = window.__bot('scrapper', r.x + 3.4, r.lipZ - 3);
    let dived = null;
    const res = window.__jump((p) => {
      if (!dived && p.airTime > 0.08 && p.position.y - p.surfaceY > 0.6) {
        window.__in.press.add('Space');
        dived = { y: +(p.position.y - p.surfaceY).toFixed(2) };
      }
    });
    return { ...res, dived, alive: [a.alive, b.alive], killed: window.__ev.killed, vy: window.__game.ctx.plow.vy };
  }, F.ramp);
  const slamKills = slam.killed.filter((k) => k.source === 'airSlam').length;
  check('air slam: SPACE mid-air dives and the landing kills both scrappers', !!slam.dived && slamKills === 2, `dive at ${slam.dived?.y} m, landed (${slam.land?.x.toFixed(1)}, ${slam.land?.z.toFixed(1)}), kills ${JSON.stringify(slam.killed)}`);
  await page.evaluate(() => window.__game.ctx.enemies.clear());
  // The same dive with no ball on the blade (the approach plows one up: drop it once airborne).
  const bare = await page.evaluate((r) => {
    window.__place(r.x, r.toeZ + 6, Math.PI);
    const c = window.__game.ctx;
    const sounds = [];
    const play = c.audio.play;
    c.audio.play = function (name, o) {
      sounds.push(name);
      return play.call(this, name, o);
    };
    let dived = null;
    let ball = -1;
    const res = window.__jump((p) => {
      if (!dived && p.airTime > 0.08 && p.position.y - p.surfaceY > 0.6) {
        p.heldVolume = 0;
        ball = p.heldBallRadius;
        window.__in.press.add('Space');
        dived = { y: +(p.position.y - p.surfaceY).toFixed(2) };
      }
    });
    c.audio.play = play;
    return { dived, ball, sounds, landed: !!res.land };
  }, F.ramp);
  check('air slam without a ball: dives with the airSlam sound, no error buzz', !!bare.dived && bare.ball === 0 && bare.sounds.includes('airSlam') && !bare.sounds.includes('error'),
    `dive at ${bare.dived?.y} m, ball ${bare.ball}, sounds ${JSON.stringify([...new Set(bare.sounds)])}`);
  await page.evaluate(() => window.__game.ctx.enemies.clear());

  /* ---------------------------------------------------------------- stomp */
  const stomp = await page.evaluate(([r, land]) => {
    window.__place(r.x, r.toeZ + 6, Math.PI);
    const e = window.__bot('brute', land.x + 3.1, land.z); // beside the landing spot (bodies 3.1 m apart: no contact push)
    const hp0 = e.hp;
    const hits = [];
    const c = window.__game.ctx;
    const orig = c.enemies.damage.bind(c.enemies);
    c.enemies.damage = (t, amt, o) => {
      hits.push({ amt: +amt.toFixed(1), source: o?.source ?? null });
      return orig(t, amt, o);
    };
    const res = window.__jump();
    c.enemies.damage = orig;
    return { ...res, dealt: +(hp0 - e.hp).toFixed(1), hits };
  }, [F.ramp, dry.land]);
  check('stomp: landing beside a bot hurts it (source stomp)', stomp.dealt > 0 && stomp.hits.some((h) => h.source === 'stomp'), `dealt ${stomp.dealt}, hits ${JSON.stringify(stomp.hits)}`);
  await page.evaluate(() => window.__game.ctx.enemies.clear());

  /* ---------------------------------------------------------------- dodge BULLDOZA's leap shockwave */
  const leapRun = (hop) =>
    page.evaluate((hop) => {
      const g = window.__game;
      const c = g.ctx;
      window.__load({}); // flat: the landing spot is exactly where the plow sits
      window.__place(0, 10, Math.PI);
      c.enemies.clear();
      const boss = c.enemies.spawn('bulldoza', 0, -8);
      boss.enraged = true;
      boss.cd = 0;
      let landedAt = -1;
      let hopped = false;
      let sawWind = false;
      for (let i = 0; i < 600; i++) {
        g.tick(1 / 60);
        if (boss.state === 'leapWind') sawWind = true;
        if (boss.state === 'leap' && boss.airborne && boss.vy < -1 && !hopped && hop) {
          // A ramp jump in miniature (~2 m, like the dev ramp): thrown up ~0.45 s before BULLDOZA touches down.
          c.plow.vert.airborne = true;
          c.plow.vert.vy = 10;
          hopped = true;
        }
        if (landedAt < 0 && sawWind && boss.state === 'recover') landedAt = i;
        if (landedAt >= 0 && i > landedAt + 5) break;
      }
      const d = Math.hypot(boss.position.x - c.plow.position.x, boss.position.z - c.plow.position.z);
      const res = { sawWind, landed: landedAt >= 0, hopped, damaged: +window.__ev.damaged.toFixed(1), dist: +d.toFixed(1) };
      c.enemies.clear();
      return res;
    }, hop);
  const grounded = await leapRun(false);
  const hopped = await leapRun(true);
  check('BULLDOZA leap: lands its shockwave on a parked plow', grounded.sawWind && grounded.landed && grounded.damaged > 0, JSON.stringify(grounded));
  check('BULLDOZA leap: a plow in the air dodges the shockwave', hopped.hopped && hopped.landed && hopped.damaged === 0, JSON.stringify(hopped));

  /* ---------------------------------------------------------------- BULLDOZA on Inferno Quarry (sloped pit) */
  const quarry = await page.evaluate(() => {
    const g = window.__game;
    const c = g.ctx;
    window.__arena(1);
    // Plow on the inner slope of the quarry pit, BULLDOZA out west on the flat (a flight line clear of props).
    window.__place(4.5, 0, -Math.PI / 2);
    const boss = c.enemies.spawn('bulldoza', -14, 2);
    boss.enraged = true;
    boss.cd = 0;
    for (let i = 0; i < 300 && !(boss.state === 'leapWind' && boss.prog > 0.75); i++) g.tick(1 / 60);
    const ring = boss.dFill;
    const t = c.terrain;
    // Ring decal heights across the slope vs the surface (snow top) under them.
    let maxErr = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    if (ring) {
      const pos = ring.mesh.geometry.attributes.position.array;
      for (let i = 0; i < pos.length; i += 3) {
        const top = t.ground(pos[i], pos[i + 2]) + c.snow.getDepth(pos[i], pos[i + 2]);
        maxErr = Math.max(maxErr, Math.abs(pos[i + 1] - top - 0.08));
        minY = Math.min(minY, pos[i + 1]);
        maxY = Math.max(maxY, pos[i + 1]);
      }
    }
    return {
      state: boss.state, ring: !!ring, tx: ring?.x, tz: ring?.z, maxErr, spread: maxY - minY,
      boss: boss.position.toArray().map((v) => +v.toFixed(2)), plow: c.plow.position.toArray().map((v) => +v.toFixed(2)),
    };
  });
  check('quarry: leap telegraph ring drapes over the pit slope', quarry.ring && quarry.maxErr < 0.05 && quarry.spread > 0.8, `ring at (${quarry.tx?.toFixed(1)}, ${quarry.tz?.toFixed(1)}), heights span ${quarry.spread.toFixed(2)} m, max off-surface ${quarry.maxErr.toFixed(3)} m`);
  await shot('quarry-leap-telegraph', [quarry.plow[0] + 13, quarry.plow[1] + 11, quarry.plow[2] + 13, quarry.tx, quarry.plow[1] - 1, quarry.tz]);
  const flight = await page.evaluate(() => {
    const g = window.__game;
    const c = g.ctx;
    const boss = c.enemies.bosses[0];
    // The spot is locked: the player drives out of the ring (else the bodies' contact push shoves the landing aside).
    c.plow.position.z += 10;
    let peak = 0;
    let mid = null;
    const ring = { x: boss.dFill?.x, z: boss.dFill?.z };
    for (let i = 0; i < 200 && boss.state !== 'recover'; i++) {
      g.tick(1 / 60);
      if (boss.airborne) peak = Math.max(peak, boss.position.y - boss.vert.surfaceY);
      if (!mid && boss.airborne && boss.vy < 1) mid = boss.position.toArray();
    }
    return { state: boss.state, peak, miss: Math.hypot(boss.position.x - ring.x, boss.position.z - ring.z), y: boss.position.y, ground: c.terrain.ground(boss.position.x, boss.position.z), mid };
  });
  check('quarry: BULLDOZA flies and lands on the telegraphed spot', flight.state === 'recover' && flight.peak > 2 && flight.miss < 1.5, `peak ${flight.peak.toFixed(1)} m, landed ${flight.miss.toFixed(2)} m from the ring centre, feet ${flight.y.toFixed(2)} on ground ${flight.ground.toFixed(2)}`);
  await page.evaluate(() => { for (let i = 0; i < 4; i++) window.__game.tick(1 / 60); });
  await shot('quarry-leap-landing', [quarry.plow[0] + 13, quarry.plow[1] + 11, quarry.plow[2] + 13, quarry.tx, quarry.plow[1] - 1, quarry.tz]);

  /* ---------------------------------------------------------------- Quarry ramp: a real jump vs the leap band */
  const bands = await page.evaluate(async () => {
    const b = await import('/src/entities/enemies/bosses.ts');
    return { leap: b.LEAP_WAVE_BAND, boss: b.BOSS_WAVE_BAND, wind: b.LEAP_WIND, lock: b.LEAP_LOCK, flight: b.LEAP_FLIGHT };
  });
  const ramp = await page.evaluate((bands) => {
    const g = window.__game;
    const c = g.ctx;
    window.__arena(1);
    c.enemies.clear();
    c.world.resetProps(false, false);
    // The east lava ramp (rises toward rot; (x, z) is its toe).
    const r = c.terrain.shapes.filter((s) => s.kind === 'ramp').sort((a, b) => b.x - a.x)[0];
    const dx = Math.sin(r.rot);
    const dz = Math.cos(r.rot);
    const start = { x: r.x - dx * 3, z: r.z - dz * 3 };
    /** Drive the ramp from 3 m before its toe at top speed; per tick: airborne + feet height above the floor. */
    window.__rampRun = (onTick) => {
      c.snow.reset(c.zone);
      window.__place(start.x, start.z, r.rot);
      c.plow.speed = c.stats.maxSpeed;
      window.__in.t = 1;
      const prof = [];
      let landed = -1;
      for (let i = 0; i < 240; i++) {
        onTick?.(i);
        g.tick(1 / 60);
        const p = c.plow;
        prof.push({ air: p.airborne, h: p.position.y - p.surfaceY, x: p.position.x, z: p.position.z });
        if (landed < 0 && i > 0 && prof[i - 1].air && !p.airborne) landed = i;
        if (landed >= 0 && i > landed + 3) break;
      }
      window.__in.t = 0;
      return prof;
    };
    const prof = window.__rampRun();
    const air = prof.filter((p) => p.air);
    let k = -1;
    prof.forEach((p, i) => { if (p.air && (k < 0 || p.h > prof[k].h)) k = i; });
    const above = (b) => air.filter((p) => p.h > b).length / 60;
    return {
      ramp: r, start, flight: air.length / 60, peak: k >= 0 ? prof[k].h : 0, kPeak: k, peakPos: k >= 0 ? { x: prof[k].x, z: prof[k].z } : null,
      aboveLeap: above(bands.leap), aboveBoss: above(bands.boss), firstAir: prof.findIndex((p) => p.air),
    };
  }, bands);
  check('quarry ramp: a real top-speed jump clears the leap band for a real window (BOSS_WAVE_BAND would give almost none)', ramp.flight > 0.3 && ramp.aboveLeap >= 0.15 && ramp.aboveLeap > 2 * ramp.aboveBoss,
    `ramp h ${ramp.ramp.h} m, flight ${ramp.flight.toFixed(2)} s, peak ${ramp.peak.toFixed(2)} m over the floor (tick ${ramp.kPeak}); above LEAP_WAVE_BAND ${bands.leap} m for ${ramp.aboveLeap.toFixed(2)} s, above BOSS_WAVE_BAND ${bands.boss} m for ${ramp.aboveBoss.toFixed(2)} s`);

  const dodge = await page.evaluate(([ramp, bands]) => {
    const g = window.__game;
    const c = g.ctx;
    c.snow.reset(c.zone);
    // Park on the spot where the jump peaks so the leap ring locks there, then drive the real ramp so the plow is at
    // that spot, flying, when BULLDOZA lands.
    // Lock the ring 5 m past the jump's peak along the jump: the plow at its peak is inside the 6 m shockwave but clear
    // of BULLDOZA's body (contact at 4 m), so the check measures the dodge, not a body collision mid-air.
    const jx = Math.sin(ramp.ramp.rot);
    const jz = Math.cos(ramp.ramp.rot);
    window.__place(ramp.peakPos.x + jx * 5, ramp.peakPos.z + jz * 5, ramp.ramp.rot);
    c.plow.hp = c.plow.maxHp = 1e6;
    // Off to the side of the jump (across the ramp heading), so BULLDOZA's wind-up and descent never sit in the
    // run-up lane and block the plow before it takes off.
    const sx = Math.cos(ramp.ramp.rot);
    const sz = -Math.sin(ramp.ramp.rot);
    const boss = c.enemies.spawn('bulldoza', ramp.peakPos.x + sx * 14, ramp.peakPos.z + sz * 14);
    boss.enraged = true;
    boss.cd = 0;
    const hits = [];
    const hp = c.combat.hitPlow.bind(c.combat);
    c.combat.hitPlow = (amt, fx, fz, o) => {
      const d = hp(amt, fx, fz, o);
      hits.push({ amt: +amt.toFixed(1), dealt: +d.toFixed(1), kb: o?.knockback ?? null, attacker: !!o?.attacker });
      return d;
    };
    let started = -1;
    let land = null;
    for (let i = 0; i < 900; i++) {
      const left = boss.state === 'leapWind' && boss.prog >= bands.lock ? Math.round((boss.stateT + bands.flight) * 60) : Infinity;
      if (started < 0 && left <= ramp.kPeak + 1) {
        started = i;
        window.__place(ramp.start.x, ramp.start.z, ramp.ramp.rot);
        c.plow.hp = c.plow.maxHp = 1e6;
        c.plow.speed = c.stats.maxSpeed;
        window.__in.t = 1;
      }
      const was = boss.state;
      g.tick(1 / 60);
      if (!land && was === 'leap' && boss.state === 'recover') {
        const p = c.plow;
        land = { i, air: p.airborne, h: +(p.position.y - p.surfaceY).toFixed(2), d: +Math.hypot(p.position.x - boss.position.x, p.position.z - boss.position.z).toFixed(2), tick: started >= 0 ? i - started : null };
      }
      if (land && i > land.i + 3) break;
    }
    window.__in.t = 0;
    c.combat.hitPlow = hp;
    c.enemies.clear();
    return { started, land, hits };
  }, [ramp, bands]);
  const leapHits = dodge.hits.filter((h) => h.kb === 20);
  check('BULLDOZA leap: a plow flying off the Quarry ramp dodges the landing shockwave', dodge.land?.air === true && dodge.land.h > bands.leap && dodge.land.d < 6 && leapHits.length === 0,
    `landing ${JSON.stringify(dodge.land)}, leap hits ${JSON.stringify(leapHits)}, all hits ${JSON.stringify(dodge.hits)}`);

  /* ---------------------------------------------------------------- persistent attacks on the pit slope */
  const storm = await page.evaluate(() => {
    const g = window.__game;
    const c = g.ctx;
    window.__arena(1);
    c.enemies.clear();
    c.world.resetProps(false, false);
    window.__place(4.5, 0, -Math.PI / 2);
    for (let i = 0; i < 10; i++) g.tick(1 / 60);
    const st = c.stats;
    const kind = st.plowKind;
    st.plowKind = 'classic';
    if (st.flameDps <= 0) st.flameDps = 30;
    c.combat.critCharge = 1;
    window.__in.press.add('KeyF');
    g.tick(1 / 60);
    window.__in.press.clear();
    const cast = { x: c.plow.position.x, z: c.plow.position.z, surf: c.plow.surfaceY };
    const disc = c.combat.classic.fireField.mesh;
    const pos = disc.geometry.attributes.position.array;
    let maxErr = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const x = disc.position.x + pos[i];
      const z = disc.position.z + pos[i + 2];
      maxErr = Math.max(maxErr, Math.abs(pos[i + 1] - 0.07 - c.terrain.ground(x, z) - c.snow.getDepth(x, z)));
      lo = Math.min(lo, pos[i + 1]);
      hi = Math.max(hi, pos[i + 1]);
    }
    g.tick(1 / 60); // let the snow mesh pick up the melt
    const cover = window.__cover(disc);
    // A ground bot walks into the burning ground; the plow is thrown up off the slope.
    const e = c.enemies.spawn('scrapper', cast.x - 5, cast.z + 2);
    e.stun = 99;
    const hp0 = e.hp;
    c.plow.vert.airborne = true;
    c.plow.vert.vy = 9;
    let airT = 0;
    for (let i = 0; i < 40; i++) {
      g.tick(1 / 60);
      if (c.plow.airborne) airT++;
    }
    const res = { visible: disc.visible, maxErr, spread: hi - lo, centre: pos[1], cast, dealt: +(hp0 - e.hp).toFixed(1), botY: +e.position.y.toFixed(2), airT, cover };
    st.plowKind = kind;
    return res;
  });
  check('FIRESTORM burning ground drapes over the pit slope', storm.visible && storm.maxErr < 0.01 && storm.spread > 1,
    `disc heights span ${storm.spread.toFixed(2)} m, max off-ground ${storm.maxErr.toFixed(3)} m, centre at ${storm.centre.toFixed(2)} (cast floor ${storm.cast.surf.toFixed(2)})`);
  check('FIRESTORM burning ground lies on the leftover snow, not under it (raycast vs the rendered SnowField)', storm.cover.n > 100 && storm.cover.hidden / storm.cover.n < 0.05,
    `${storm.cover.hidden} of ${storm.cover.n} samples hidden under snow (worst ${storm.cover.worst.toFixed(3)} m)`);
  check('FIRESTORM burning ground keeps burning a ground bot while the plow is airborne', storm.airT >= 20 && storm.dealt > 0,
    `plow airborne ${storm.airT} ticks, scrapper (feet ${storm.botY}) took ${storm.dealt}`);
  await shot('quarry-firestorm-field', [storm.cast.x + 12, storm.cast.surf + 10, storm.cast.z + 12, storm.cast.x, storm.cast.surf - 1, storm.cast.z]);

  const nuke = await page.evaluate(() => {
    const g = window.__game;
    const c = g.ctx;
    c.combat.clear();
    c.enemies.clear();
    window.__place(3, -6, 0);
    for (let i = 0; i < 10; i++) g.tick(1 / 60);
    const st = c.stats;
    const saved = { kind: st.plowKind, melt: st.meltDamage, dps: st.poolDps, r: st.poolRadius, s: st.poolSeconds };
    Object.assign(st, { plowKind: 'isotope', meltDamage: Math.max(40, st.meltDamage), poolDps: Math.max(10, st.poolDps), poolSeconds: Math.max(5, st.poolSeconds) });
    c.combat.critCharge = 1;
    window.__in.press.add('KeyF');
    g.tick(1 / 60);
    window.__in.press.clear();
    const pl = c.combat.isotope.pools.find((p) => p.t > 0);
    const m = pl.disc.mesh;
    const pos = m.geometry.attributes.position.array;
    let maxErr = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const x = m.position.x + pos[i];
      const z = m.position.z + pos[i + 2];
      maxErr = Math.max(maxErr, Math.abs(pos[i + 1] - 0.06 - c.terrain.ground(x, z) - c.snow.getDepth(x, z)));
      lo = Math.min(lo, pos[i + 1]);
      hi = Math.max(hi, pos[i + 1]);
    }
    for (let i = 0; i < 20; i++) g.tick(1 / 60);
    const cover = window.__cover(m);
    Object.assign(st, { plowKind: saved.kind, meltDamage: saved.melt, poolDps: saved.dps, poolRadius: saved.r, poolSeconds: saved.s });
    return { r: pl.r, maxErr, spread: hi - lo, x: pl.x, z: pl.z, y: pl.from.y, cover };
  });
  check('NUKE fallout pool drapes over the pit slope', nuke.maxErr < 0.01 && nuke.spread > 1,
    `pool r ${nuke.r.toFixed(1)} m, heights span ${nuke.spread.toFixed(2)} m, max off-ground ${nuke.maxErr.toFixed(3)} m`);
  check('NUKE fallout pool lies on the leftover snow, not under it', nuke.cover.n > 100 && nuke.cover.hidden / nuke.cover.n < 0.05,
    `${nuke.cover.hidden} of ${nuke.cover.n} samples hidden under snow (worst ${nuke.cover.worst.toFixed(3)} m)`);
  await shot('quarry-nuke-pool', [nuke.x + 14, nuke.y + 12, nuke.z - 14, nuke.x, nuke.y - 1, nuke.z]);

  /* ---------------------------------------------------------------- Omega Works deck edge: FIRESTORM stops at the edge */
  const edge = await page.evaluate(() => {
    const g = window.__game;
    const c = g.ctx;
    c.combat.clear();
    window.__arena(5);
    c.enemies.clear();
    window.__place(16, 10, Math.PI / 2); // Assembly Floor (deck 1, top 7, hw 18): 2 m inside its east edge
    c.plow.position.y = 7.3;
    for (let i = 0; i < 20; i++) g.tick(1 / 60);
    const st = c.stats;
    const kind = st.plowKind;
    st.plowKind = 'classic';
    if (st.flameDps <= 0) st.flameDps = 30;
    const onDeck = c.enemies.spawn('scrapper', 13, 13, { y: 7 });
    onDeck.stun = 99;
    const below = window.__bot('scrapper', 23, 13); // on the ground 5 m past the edge
    for (let i = 0; i < 5; i++) g.tick(1 / 60);
    const hp = [onDeck.hp, below.hp];
    c.combat.critCharge = 1;
    window.__in.press.add('KeyF');
    g.tick(1 / 60);
    window.__in.press.clear();
    const from = { y: c.plow.surfaceY, deck: c.plow.deck };
    const disc = c.combat.classic.fireField.mesh;
    const pos = disc.geometry.attributes.position.array;
    const t = c.terrain;
    let offLevel = 0;
    let maxX = -Infinity;
    let floating = 0;
    for (let i = 0; i < pos.length; i += 3) {
      const x = disc.position.x + pos[i];
      const z = disc.position.z + pos[i + 2];
      const y = t.heightAt(x, z, from.y);
      if (t.heightDeck !== 1 && Math.abs(y - from.y) > 1.2) offLevel++;
      if (pos[i + 1] - y > 0.2) floating++;
      maxX = Math.max(maxX, x);
    }
    for (let i = 0; i < 60; i++) g.tick(1 / 60);
    const res = { from, offLevel, floating, n: pos.length / 3, maxX, dDeck: +(hp[0] - onDeck.hp).toFixed(1), dBelow: +(hp[1] - below.hp).toFixed(1), deckY: +onDeck.position.y.toFixed(2), belowY: +below.position.y.toFixed(2) };
    st.plowKind = kind;
    return res;
  });
  check('Omega deck edge: the FIRESTORM field stops at the deck edge (no sheet floating past it)', edge.from.deck === 1 && edge.offLevel === 0 && edge.floating === 0 && edge.maxX < 18.1,
    `cast on deck ${edge.from.deck} at y ${edge.from.y.toFixed(2)}: ${edge.offLevel} of ${edge.n} vertices off the level, ${edge.floating} floating, max x ${edge.maxX.toFixed(2)} (edge 18)`);
  check('Omega deck edge: the fire burns the bot on the deck, not the one on the ground past the edge', edge.dDeck > 0 && edge.dBelow === 0,
    `deck bot (feet ${edge.deckY}) took ${edge.dDeck}, ground bot (feet ${edge.belowY}) took ${edge.dBelow}`);
  await shot('omega-edge-firestorm', [32, 14, 22, 16, 5, 10]);
  await shot('omega-edge-firestorm2', [26, 3, 10, 16, 6, 10]);

  /* ---------------------------------------------------------------- THE DONALD's GOLD PLATED reflect at any height */
  const reflect = await page.evaluate(() => {
    const g = window.__game;
    const c = g.ctx;
    c.combat.clear();
    window.__arena(0);
    c.enemies.clear();
    window.__place(0, 6, 0);
    for (let i = 0; i < 5; i++) g.tick(1 / 60);
    const boss = window.__bot('donald', 0, -2);
    for (let i = 0; i < 5; i++) g.tick(1 / 60);
    const minion = window.__bot('scrapper', 2, 6);
    c.plow.vert.airborne = true;
    c.plow.vert.vy = 16;
    let h = 0;
    for (let i = 0; i < 120 && h < 4; i++) {
      g.tick(1 / 60);
      h = c.plow.position.y - boss.position.y;
    }
    const hp0 = c.plow.hp;
    window.__ev.damaged = 0;
    boss.reflectPool = 12;
    g.tick(1 / 60);
    return { h: +h.toFixed(2), air: c.plow.airborne, dealt: +window.__ev.damaged.toFixed(1), hpLost: +(hp0 - c.plow.hp).toFixed(1), pool: boss.reflectPool,
      threatBoss: +c.combat.threatOf(boss).toFixed(1), threatMinion: +c.combat.threatOf(minion).toFixed(1), band: 2.2 + Math.max(0, boss.radius - 1.2) * 0.5 };
  });
  check('DONALD GOLD PLATED: the reflect reaches a plow in the air above the body band, credited to the boss', reflect.air && reflect.h > reflect.band && reflect.dealt > 0 && reflect.threatBoss > 0 && reflect.threatMinion === 0,
    `plow ${reflect.h} m above the boss (body band ${reflect.band.toFixed(2)}), reflect dealt ${reflect.dealt}, threat boss ${reflect.threatBoss} / minion ${reflect.threatMinion}`);

  /* ---------------------------------------------------------------- Duel puppet: replayed launch / landing */
  const puppet = await page.evaluate(async () => {
    const { NP } = await import('/src/net/protocol.ts');
    const g = window.__game;
    const c = g.ctx;
    c.combat.clear();
    window.__place(3, -6, 0);
    for (let i = 0; i < 5; i++) g.tick(1 / 60);
    const s = new Float32Array(256);
    c.plow.writeNet(s, 0);
    const sounds = [];
    const fxs = [];
    const play = c.audio.play;
    const burst = c.fx.burst;
    const ring = c.fx.ring;
    c.audio.play = function (n, o) { sounds.push(n); return play.call(this, n, o); };
    c.fx.burst = function (pos, o) { fxs.push({ k: 'burst', y: +pos.y.toFixed(2) }); return burst.call(this, pos, o); };
    c.fx.ring = function (pos, r, col) { fxs.push({ k: 'ring', y: +pos.y.toFixed(2) }); return ring.call(this, pos, r, col); };
    const ground = c.terrain.ground(s[NP.x], s[NP.z]);
    // The host's plow: grounded, then in the air (2 m up), then touching down at 12 m/s.
    c.plow.updatePuppet(1 / 60, s, 0);
    s[NP.air] = 1; s[NP.y] = ground + 2; s[NP.vy] = 4;
    c.plow.updatePuppet(1 / 60, s, 0);
    const launch = sounds.slice();
    s[NP.vy] = -12;
    c.plow.updatePuppet(1 / 60, s, 0);
    s[NP.air] = 0; s[NP.y] = ground; s[NP.vy] = 0;
    sounds.length = 0;
    fxs.length = 0;
    c.plow.updatePuppet(1 / 60, s, 0);
    c.audio.play = play;
    c.fx.burst = burst;
    c.fx.ring = ring;
    const res = { launch, land: sounds.slice(), fx: fxs.slice(), ground: +ground.toFixed(2) };
    window.__place(3, -6, 0); // back to a normal (simulated) plow
    g.tick(1 / 60);
    return res;
  });
  check('Duel puppet: a replayed flight plays the jump sound, and the landing its land sound, puff and ring on the ground',
    puppet.launch.includes('jump') && puppet.land.includes('land') && puppet.fx.some((f) => f.k === 'burst' && Math.abs(f.y - puppet.ground - 0.2) < 0.05) && puppet.fx.some((f) => f.k === 'ring'),
    `launch ${JSON.stringify(puppet.launch)}, landing ${JSON.stringify(puppet.land)}, fx ${JSON.stringify(puppet.fx)}, ground ${puppet.ground}`);
} catch (e) {
  errors.push(`[probe] ${e.stack || e}`);
}
for (const e of errors) console.log(e);
const failed = results.filter((r) => !r.ok).length + errors.length;
console.log(failed ? `${failed} FAILED` : `ALL ${results.length} CHECKS PASSED`);
if (!noShots) console.log(`screenshots in ${out}`);
await browser.close();
await server.close();
process.exit(failed ? 1 : 0);
