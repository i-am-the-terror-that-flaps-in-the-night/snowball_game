// Deterministic render measurement + pixel-diff gate.
//   node scripts/render-probe.mjs baseline [dir]   render every scene, write <scene>.png + metrics.json/.txt into dir
//   node scripts/render-probe.mjs compare  [dir]   re-render, diff against dir, write report + diff images, exit 1 on failure
//   dir defaults to /tmp/render-baseline. Options: --scenes=a,b (subset), --out=<dir> (compare output, default
//   /tmp/render-compare/<cwd basename>), --force (baseline: overwrite an existing baseline), --runs=N (compare: render
//   each scene N times and report the best timing; images must match on every run), --profile (print the top
//   self-time functions of each scene's measurement loop from the V8 CPU profiler).
//   Env: PROBE_GPU=0 -> SwiftShader instead of the Metal GPU, PROBE_DPR (default 2), PROBE_DEBUG=1 (raw timing samples
//   in metrics.json), PORT -> Vite port.
//
// Vite serves process.cwd(), so run it from the worktree you want to measure. Headless Chrome at 1920x1080 @ DPR 2
// (canvas 3840x2160), shadows on (fresh save = HIGH quality), ?debug save (all arenas unlocked).
//
// Determinism (everything is done in the probe; the game is unchanged):
// - An init script replaces Math.random with a seeded mulberry32, performance.now / Date.now / new Date() with a
//   virtual clock that never advances, and requestAnimationFrame with a queue that is never flushed, so the game's
//   animation loop never runs on wall-clock time (we also call renderer.setAnimationLoop(null)).
// - Each scene gets a fresh browser context (clean localStorage) and page load. Its whole setup (reseed, start the
//   mode, scripted input, N x __game.tick(1/60)) runs inside ONE synchronous page.evaluate, so no timer
//   (music scheduler, toasts, achievement checks) can consume Math.random or change state mid-setup.
// - Input is scripted by writing the Input key sets directly (no DOM key events, so the AudioContext stays locked).
// - The frame is then frozen: only renderer.render() runs. The image is read back with canvas.toDataURL in the same
//   task as the render (WebGL canvas only; the DOM UI layer is hidden too).
// Measured noise floor (Apple M4, ANGLE Metal, baseline + compare of unchanged code): bit-identical images (max delta
// 0) in every scene, identical fingerprints, draw calls and triangles. Timings are not deterministic: render CPU
// moves by roughly +-0.3 ms between runs on a shared machine. Never compare a GPU baseline with a PROBE_GPU=0 run
// (different rasteriser); PROBE_DPR=1 is for diagnostics only (images then don't match a DPR 2 baseline).
//
// Tolerance (compare fails when any is true):
// - more than 0.01% of the pixels (829 of 8.3M) have a channel delta > 8;
// - the image size differs, the scene threw, or a page error / console error happened;
// - the scene's gameplay fingerprint differs (state, player pose/HP/ball, every enemy's position/HP, Math.random call
//   count): an optimisation must not change simulation or RNG order, so this is structural, not visual.
// Deltas > 2 are reported but do not fail on their own (merged geometry is baked on the CPU, so a few edge pixels
// can move by a rasterisation step: a small merge test moved 4 of 1.2M pixels by 1 on Metal). Draw calls /
// triangles / CPU time are reported before -> after, not gated.
//
// Metrics per scene: main-pass and shadow-pass draw calls (render the frozen frame with shadowMap.autoUpdate=false
// vs true and diff renderer.info.render.calls), triangles, programs, geometries/textures, object counts, and render
// CPU time = median (cpuMs) and interquartile mean (cpuIqmMs) of 60 renderer.render() calls of the frozen frame, each
// followed by a GPU sync (1-pixel readPixels; gl.finish() may return early in Chrome) outside the timed part (its median
// is syncMs), the median of 30 main-pass-only renders (cpuMainMs), and throughputMs = wall time per frame of 60
// back-to-back renders (GPU process + GPU back-pressure included; 'frame' in the tables). One extra render counts
// WebGL calls by name (glCalls, useProgram, uniformCalls, bindTexture, bindVAO, bufferUploads). The page is
// cross-origin isolated so performance.now() has 5 us resolution. Timing is noisy when other probes share the
// machine: use --runs=3.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = (k, d) => {
  const a = args.find((x) => x === `--${k}` || x.startsWith(`--${k}=`));
  return a === undefined ? d : a.includes('=') ? a.slice(a.indexOf('=') + 1) : true;
};
const cmd = pos[0] || 'baseline';
if (cmd !== 'baseline' && cmd !== 'compare') {
  console.log('usage: node scripts/render-probe.mjs baseline|compare [dir] [--scenes=a,b] [--out=dir] [--force] [--runs=N]');
  process.exit(2);
}
const dir = pos[1] || '/tmp/render-baseline';
const outDir = cmd === 'baseline' ? dir : opt('out', join('/tmp/render-compare', basename(process.cwd())));
const runs = Math.max(1, Number(opt('runs', '1')) || 1);
const gpu = process.env.PROBE_GPU !== '0';
const TOL_DELTA = 8;
const TOL_FRAC = 0.0001;

/* ------------------------------------------------------------------ page side (runs before the game loads) */

function probeInit() {
  const realNow = performance.now.bind(performance);
  // Virtual clock: frozen unless the probe advances it (nothing in a scene needs it to move).
  let vt = 1000;
  const EPOCH = Date.UTC(2026, 0, 15, 12, 0, 0);
  const RealDate = Date;
  performance.now = () => vt;
  window.Date = new Proxy(RealDate, {
    construct: (T, a) => (a.length ? new T(...a) : new T(EPOCH + vt)),
    apply: () => new RealDate(EPOCH + vt).toString(),
    get: (T, p) => (p === 'now' ? () => EPOCH + vt : Reflect.get(T, p)),
  });
  // rAF never fires: the game's setAnimationLoop never runs a frame.
  let rafId = 0;
  const rafQ = new Map();
  window.requestAnimationFrame = (cb) => (rafQ.set(++rafId, cb), rafId);
  window.cancelAnimationFrame = (id) => void rafQ.delete(id);
  // Seeded Math.random (mulberry32), reseeded at the start of every scene.
  // three.js draws every uuid (Object3D / Material / BufferGeometry / Texture) from Math.random. Those calls get their
  // own stream and are not counted, so building fewer (merged) objects doesn't shift the gameplay RNG.
  let s = 0x2f6b1d3a;
  let su = 0x51ed270b;
  let calls = 0;
  const mb32 = (x) => {
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = () => {
    const lim = Error.stackTraceLimit;
    Error.stackTraceLimit = 2;
    const stack = new Error().stack;
    Error.stackTraceLimit = lim;
    if (stack.includes('generateUUID')) return mb32((su = (su + 0x6d2b79f5) | 0));
    calls++;
    return mb32((s = (s + 0x6d2b79f5) | 0));
  };

  const r3 = (v) => Math.round(v * 1000) / 1000;
  const g = () => window.__game;
  const c = () => window.__game.ctx;
  const run = (n, each) => {
    for (let i = 0; i < n; i++) {
      if (each) each(i);
      g().tick(1 / 60);
    }
  };
  const countdownFrames = () => Math.ceil(g().countdown * 60) + 1;

  /** Simple aggressive autopilot over the Input key sets (same idea as legend-probe.mjs). */
  const pilot = (o = {}) => {
    const inp = c().input;
    const hold = (code, on) => (on ? inp.down.add(code) : inp.down.delete(code));
    const tap = (code) => (inp.down.add(code), inp.pressed.add(code));
    return (i) => {
      const ctx = c(), p = ctx.plow;
      for (const k of ['Space', 'ShiftLeft', 'KeyE', 'KeyF']) inp.down.delete(k);
      if (p.dead) return ['KeyW', 'KeyA', 'KeyD'].forEach((k) => hold(k, false));
      let best = null, bd = 1e9, near = 0;
      for (const e of ctx.enemies.query(p.position.x, p.position.z, 400)) {
        const d = Math.hypot(e.position.x - p.position.x, e.position.z - p.position.z);
        if (d < 7) near++;
        if (d < bd) (bd = d), (best = e);
      }
      hold('KeyW', true);
      if (!best || bd > (o.chase ?? 60)) {
        // Wander in a wide circle, plowing snow.
        hold('KeyA', i % 240 < 50);
        hold('KeyD', false);
        return;
      }
      const want = Math.atan2(best.position.x - p.position.x, best.position.z - p.position.z);
      const da = Math.atan2(Math.sin(want - p.heading), Math.cos(want - p.heading));
      hold('KeyA', da > 0.08);
      hold('KeyD', da < -0.08);
      if (o.ability && i % 30 === 0 && near >= 1 && ctx.combat.flameReady >= 1) tap('KeyF');
      else if (p.heldBallRadius >= 0.5 && bd < 5.5 && Math.abs(da) < 0.45) tap('Space');
      else if (o.dash !== false && p.dashReady >= 1 && bd > 6 && bd < 14 && Math.abs(da) < 0.15) tap('ShiftLeft');
      else if (o.whirl && p.whirlReady >= 1 && near >= 2) tap('KeyE');
    };
  };
  const release = () => {
    const inp = c().input;
    for (const k of ['KeyW', 'KeyA', 'KeyD', 'Space', 'ShiftLeft', 'KeyE', 'KeyF']) inp.down.delete(k);
  };
  /** World position `fwd` m ahead of the player and `side` m to its right. */
  const ahead = (fwd, side) => {
    const p = c().plow, h = p.heading;
    return { x: p.position.x + Math.sin(h) * fwd - Math.cos(h) * side, z: p.position.z + Math.cos(h) * fwd + Math.sin(h) * side };
  };
  const setLoadout = (plow, upgrades = {}, cosmetics = null) => {
    const pr = c().progression;
    pr.setPlow(plow);
    Object.assign(pr.data.upgrades, upgrades);
    if (cosmetics) pr.data.cosmetics = cosmetics;
    pr.commit();
  };
  const startCampaign = (zone, round) => {
    g().startRun(zone);
    if (round > 0) {
      g().roundIndex = round;
      g().beginCountdown();
    }
  };

  const SCENES = {
    menu: () => run(90),
    'a1-r2': () => {
      startCampaign(0, 1);
      run(countdownFrames() + 300, pilot());
    },
    'survival-w3': () => {
      g().startSurvival();
      g().survival.wave = 2;
      g().beginCountdown();
      run(countdownFrames() + 360, pilot({ whirl: true }));
    },
    'a5-r3-classic': () => {
      startCampaign(4, 2);
      run(countdownFrames() + 420, pilot({ ability: true }));
    },
    'a5-r3-brute': () => {
      setLoadout('brute', { bruteSaws: 3 }, {
        owned: ['paint_red', 'decal_flames', 'trail_fire'],
        equipped: { paint: 'paint_red', decal: 'decal_flames', trail: 'trail_fire' },
      });
      startCampaign(4, 2);
      run(countdownFrames() + 420, pilot({ ability: true }));
    },
    'brute-look': () => {
      // Same BRUTUS loadout, no fight: driving a slow arc during the countdown (saws, decal, paint, trail in view).
      setLoadout('brute', { bruteSaws: 3 }, {
        owned: ['paint_red', 'decal_flames', 'trail_fire'],
        equipped: { paint: 'paint_red', decal: 'decal_flames', trail: 'trail_fire' },
      });
      startCampaign(4, 0);
      const inp = c().input;
      run(150, (i) => (inp.down.add('KeyW'), i > 40 && i < 70 ? inp.down.add('KeyA') : inp.down.delete('KeyA')));
    },
    'a2-volt': () => {
      setLoadout('volt');
      startCampaign(1, 1);
      run(countdownFrames() + 360, pilot({ ability: true }));
    },
    'brawl-legend': () => {
      g().startBrawl('legend');
      run(countdownFrames() + 180, pilot({ whirl: true, chase: 200 }));
    },
    'bestiary': () => {
      // Every bot type and boss in the Bowl, lined up in front of the camera.
      startCampaign(3, 0);
      run(60);
      const minions = ['scrapper', 'brute', 'spinner', 'thief'];
      const bosses = ['bulldoza', 'frostbyte', 'grinder', 'slush', 'sleet', 'omega'];
      minions.forEach((t, i) => { const q = ahead(8, -6 + i * 4); c().enemies.spawn(t, q.x, q.z, { heading: c().plow.heading + Math.PI }); });
      bosses.forEach((t, i) => { const q = ahead(19, -15 + i * 6); c().enemies.spawn(t, q.x, q.z, { heading: c().plow.heading + Math.PI }); });
      run(24);
    },
    'bot-wreck': () => {
      // Summit: a few bots right in front, one killed (debris mid-air), one mid hit-flash.
      startCampaign(4, 0);
      run(60);
      const bots = ['scrapper', 'brute', 'scrapper', 'spinner', 'brute'].map((t, i) => {
        const q = ahead(7 + (i % 2) * 3, -6 + i * 3);
        return c().enemies.spawn(t, q.x, q.z, { heading: c().plow.heading + Math.PI });
      });
      run(10);
      c().enemies.damage(bots[1], 1e9);
      c().enemies.damage(bots[3], 1e9);
      run(14);
      c().enemies.damage(bots[0], 1);
      run(2);
    },
    'player-wreck': () => {
      startCampaign(1, 0);
      run(countdownFrames() + 120, pilot());
      release();
      c().plow.damage(1e9);
      run(30);
    },
    'brawl-rival-wreck': () => {
      g().startBrawl('pro');
      run(countdownFrames() + 90, pilot({ chase: 200 }));
      release();
      const p = c().plow;
      const list = [...c().enemies.query(p.position.x, p.position.z, 500)]
        .sort((a, b) => Math.hypot(a.position.x - p.position.x, a.position.z - p.position.z) - Math.hypot(b.position.x - p.position.x, b.position.z - p.position.z));
      const [victim, other] = list;
      if (victim) {
        const q = ahead(9, 1.5);
        victim.position.x = q.x;
        victim.position.z = q.z;
      }
      if (other) {
        const q = ahead(12, -4);
        other.position.x = q.x;
        other.position.z = q.z;
      }
      run(2);
      if (victim) c().enemies.damage(victim, 1e9);
      run(14);
      if (other) c().enemies.damage(other, 1);
      run(2);
    },
  };

  /** Everything gameplay-relevant at the freeze point (structural gate). */
  const fingerprint = () => {
    const ctx = c(), p = ctx.plow;
    const enemies = [...ctx.enemies.query(0, 0, 1e4)].map((e) => [e.type, r3(e.position.x), r3(e.position.z), r3(e.hp ?? 0)]);
    return {
      state: g().state,
      time: r3(ctx.time),
      plow: [r3(p.position.x), r3(p.position.z), r3(p.heading), r3(p.hp), r3(p.heldBallRadius), p.dead],
      alive: ctx.enemies.aliveCount(),
      enemies: JSON.stringify(enemies),
      randomCalls: calls,
    };
  };

  window.__probe = {
    realNow,
    scenes: Object.keys(SCENES),
    gpu() {
      const gl = g().renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    },
    setup(name) {
      const game = g();
      game.renderer.setAnimationLoop(null);
      document.getElementById('ui').style.display = 'none';
      s = 0x2f6b1d3a;
      su = 0x51ed270b;
      calls = 0;
      SCENES[name]();
      return fingerprint();
    },
    measure(debug) {
      const game = g(), ctx = game.ctx, r = game.renderer, sm = r.shadowMap, gl = r.getContext(), info = r.info;
      const render = () => r.render(ctx.scene, ctx.camera);
      for (let i = 0; i < 4; i++) render();
      gl.finish();
      const snap = () => ({ calls: info.render.calls, tris: info.render.triangles, points: info.render.points, lines: info.render.lines });
      sm.autoUpdate = false;
      sm.needsUpdate = false;
      render();
      const main = snap();
      sm.autoUpdate = true;
      render();
      const total = snap();
      const sorted = (a) => a.slice().sort((x, y) => x - y);
      const med = (a) => sorted(a)[a.length >> 1];
      const iqm = (a) => { const q = sorted(a).slice(a.length >> 2, a.length - (a.length >> 2)); return q.reduce((x, y) => x + y, 0) / q.length; };
      // readPixels of one pixel is a real GPU sync (gl.finish() can return early in Chrome); it is not timed.
      const px = new Uint8Array(4);
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const cpu = [], fin = [], cpuMain = [];
      sync();
      for (let i = 0; i < 60; i++) {
        const t0 = realNow();
        render();
        const t1 = realNow();
        sync();
        fin.push(realNow() - t1);
        cpu.push(t1 - t0);
      }
      sm.autoUpdate = false;
      for (let i = 0; i < 30; i++) {
        const t0 = realNow();
        render();
        cpuMain.push(realNow() - t0);
        sync();
      }
      sm.autoUpdate = true;
      // Throughput: 60 back-to-back renders (no sync in between, so GPU back-pressure counts), wall time per frame.
      sync();
      const tp0 = realNow();
      for (let i = 0; i < 60; i++) render();
      sync();
      const throughput = (realNow() - tp0) / 60;
      // One instrumented render: count WebGL calls by name (program / state switches are what cost CPU per draw).
      const glCount = {};
      const proto = Object.getPrototypeOf(gl);
      const wrapped = [];
      for (const k of Object.getOwnPropertyNames(proto)) {
        const d = Object.getOwnPropertyDescriptor(proto, k);
        if (typeof d.value !== 'function' || k === 'constructor') continue;
        wrapped.push(k);
        gl[k] = function (...a) {
          glCount[k] = (glCount[k] || 0) + 1;
          return d.value.apply(this, a);
        };
      }
      render();
      for (const k of wrapped) delete gl[k];
      const sum = (re) => Object.entries(glCount).reduce((t, [k, v]) => (re.test(k) ? t + v : t), 0);
      const gls = {
        glCalls: sum(/./), useProgram: glCount.useProgram || 0, uniformCalls: sum(/^uniform/),
        bindTexture: glCount.bindTexture || 0, bindVAO: glCount.bindVertexArray || 0, bufferUploads: sum(/^buffer(Sub)?Data$/),
      };
      const objs = { objects: 0, meshes: 0, instanced: 0, sprites: 0, points: 0, casters: 0 };
      ctx.scene.traverseVisible((o) => {
        objs.objects++;
        if (o.isInstancedMesh) objs.instanced++;
        else if (o.isMesh) objs.meshes++;
        else if (o.isSprite) objs.sprites++;
        else if (o.isPoints) objs.points++;
        if (o.castShadow && (o.isMesh || o.isInstancedMesh)) objs.casters++;
      });
      const f2 = (v) => Math.round(v * 1000) / 1000;
      return {
        mainCalls: main.calls, shadowCalls: total.calls - main.calls, totalCalls: total.calls,
        mainTris: main.tris, shadowTris: total.tris - main.tris, points: main.points, lines: main.lines,
        programs: info.programs.length, geometries: info.memory.geometries, textures: info.memory.textures,
        cpuMs: f2(med(cpu)), cpuIqmMs: f2(iqm(cpu)), cpuMainMs: f2(med(cpuMain)), syncMs: f2(med(fin)), throughputMs: f2(throughput), isolated: crossOriginIsolated,
        ...gls,
        ...objs,
        ...(debug ? { samples: { cpu: cpu.map(f2), cpuMain: cpuMain.map(f2), sync: fin.map(f2) } } : {}),
      };
    },
    /** Render the frozen frame and read the canvas back in the same task (PNG data URL, kept for compare()). */
    shot() {
      const game = g();
      game.renderer.render(game.ctx.scene, game.ctx.camera);
      this.last = game.renderer.domElement.toDataURL('image/png');
      return this.last;
    },
    /** Diff the last shot against the baseline PNG at `url`. Returns stats + a diff PNG (base64) when anything moved. */
    async compare(url, tolDelta) {
      const decode = async (blob) => {
        const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
        const oc = new OffscreenCanvas(bmp.width, bmp.height);
        const cx = oc.getContext('2d', { willReadFrequently: true });
        cx.drawImage(bmp, 0, 0);
        return cx.getImageData(0, 0, bmp.width, bmp.height);
      };
      const a = await decode(await (await fetch(url)).blob());
      const b = await decode(await (await fetch(this.last)).blob());
      if (a.width !== b.width || a.height !== b.height) return { sizeMismatch: `${a.width}x${a.height} -> ${b.width}x${b.height}` };
      const A = a.data, B = b.data, n = a.width * a.height;
      const out = new ImageData(a.width, a.height);
      const O = out.data;
      let max = 0, over2 = 0, over8 = 0, over0 = 0;
      for (let i = 0; i < A.length; i += 4) {
        const d = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
        if (d > max) max = d;
        if (d > 0) over0++;
        if (d > 2) over2++;
        if (d > tolDelta) over8++;
        // Dimmed baseline; changed pixels in yellow (<= tolerance) or red (> tolerance), brightness by delta.
        const grey = (A[i] * 0.3 + A[i + 1] * 0.59 + A[i + 2] * 0.11) * 0.25;
        if (d === 0) O[i] = O[i + 1] = O[i + 2] = grey;
        else if (d <= tolDelta) (O[i] = 255), (O[i + 1] = 140 + d * 14), (O[i + 2] = 0);
        else (O[i] = 255), (O[i + 1] = 0), (O[i + 2] = Math.min(255, d * 2));
        O[i + 3] = 255;
      }
      let png = null;
      if (over0 > 0) {
        const oc = new OffscreenCanvas(a.width, a.height);
        oc.getContext('2d').putImageData(out, 0, 0);
        const buf = new Uint8Array(await (await oc.convertToBlob({ type: 'image/png' })).arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        png = btoa(bin);
      }
      return { pixels: n, max, over0, over2, over8, png };
    },
  };
}

/* ------------------------------------------------------------------ node side */

const sha = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim() + (execSync('git status --porcelain --untracked-files=no', { encoding: 'utf8' }).trim() ? '+dirty' : '');
  } catch {
    return '?';
  }
})();

let base = null;
if (cmd === 'compare') {
  const mf = join(dir, 'metrics.json');
  if (!existsSync(mf)) {
    console.error(`no baseline at ${mf}; run: node scripts/render-probe.mjs baseline ${dir}`);
    process.exit(2);
  }
  base = JSON.parse(readFileSync(mf, 'utf8'));
} else if (existsSync(join(dir, 'metrics.json')) && !opt('force', false)) {
  console.error(`${dir} already holds a baseline; pass --force to overwrite it (or pick another dir)`);
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const port = Number(process.env.PORT) || 5700 + Math.floor(Math.random() * 1500);
// Cross-origin isolation gives performance.now() 5 us resolution instead of 100 us (the page loads nothing external).
const isolation = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };
const server = await createServer({ root: process.cwd(), server: { port, strictPort: true, headers: isolation }, logLevel: 'error' });
await server.listen();
const gpuArgs = gpu ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: gpuArgs });

const sceneFilter = opt('scenes', '') ? String(opt('scenes')).split(',') : null;
const results = [];
let rendererName = '';
let failed = false;
let allScenes = null;

const SKIP = /^(\(idle\)|\(program\)|readPixels|getProgramInfoLog|getShaderInfoLog|shaderSource|compileShader|linkProgram) /;
function printProfile(name, prof) {
  const self = new Map();
  const dt = new Map();
  for (let i = 0; i < prof.samples.length; i++) dt.set(prof.samples[i], (dt.get(prof.samples[i]) || 0) + (prof.timeDeltas[i] || 0));
  let total = 0;
  for (const n of prof.nodes) {
    const t = (dt.get(n.id) || 0) / 1000;
    if (!t) continue;
    const f = n.callFrame;
    const key = `${f.functionName || '(anon)'} ${f.url ? basename(f.url.split('?')[0]) + ':' + (f.lineNumber + 1) : ''}`;
    self.set(key, (self.get(key) || 0) + t);
    if (!SKIP.test(key)) total += t;
  }
  const top = [...self].filter(([k]) => !SKIP.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 30);
  console.log(`\n--- CPU profile ${name}: ${total.toFixed(0)} ms of JS (measure loop: 4 warm-up + 60 full + 30 main-only + 60 back-to-back renders; GPU syncs, idle and shader compiles left out)`);
  for (const [k, t] of top) console.log(`${t.toFixed(1).padStart(8)} ms  ${((100 * t) / total).toFixed(1).padStart(5)}%  ${k}`);
}

async function runScene(name) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: Number(process.env.PROBE_DPR) || 2 });
  await context.addInitScript(probeInit);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('GPU stall')) errors.push(`[console] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  if (cmd === 'compare') {
    await page.route('**/__probe_baseline/*', (route) => {
      const f = join(dir, basename(new URL(route.request().url()).pathname));
      return existsSync(f) ? route.fulfill({ path: f, contentType: 'image/png' }) : route.fulfill({ status: 404 });
    });
  }
  try {
    await page.goto(`http://localhost:${port}/?debug`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__game && window.__probe, null, { polling: 100, timeout: 60000 });
    if (!rendererName) rendererName = await page.evaluate(() => window.__probe.gpu());
    if (!allScenes) allScenes = await page.evaluate(() => window.__probe.scenes);
    const fingerprint = await page.evaluate((n) => window.__probe.setup(n), name);
    // --profile: sample the measurement loop with the V8 CPU profiler and print the top self-time functions.
    const cdp = opt('profile', false) ? await context.newCDPSession(page) : null;
    if (cdp) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 50 });
      await cdp.send('Profiler.start');
    }
    const metrics = await page.evaluate((d) => window.__probe.measure(d), !!process.env.PROBE_DEBUG);
    if (cdp) printProfile(name, (await cdp.send('Profiler.stop')).profile);
    const dataUrl = await page.evaluate(() => window.__probe.shot());
    const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
    let diff = null;
    if (cmd === 'compare') diff = await page.evaluate(([u, t]) => window.__probe.compare(u, t), [`/__probe_baseline/${name}.png`, TOL_DELTA]);
    return { name, fingerprint, metrics, png, diff, errors };
  } catch (e) {
    errors.push(`[probe] ${e.message.split('\n')[0]}`);
    return { name, errors };
  } finally {
    await context.close();
  }
}

// Probe the scene list once (a scene name typo should fail loudly, not silently skip).
{
  const r = await runScene('menu');
  const names = (allScenes || ['menu']).filter((n) => !sceneFilter || sceneFilter.includes(n));
  const unknown = (sceneFilter || []).filter((n) => !(allScenes || []).includes(n));
  if (unknown.length) {
    console.error(`unknown scene(s): ${unknown.join(', ')} (have: ${(allScenes || []).join(', ')})`);
    failed = true;
  }
  console.log(`renderer: ${rendererName}  |  git ${sha}  |  ${gpu ? 'GPU' : 'SwiftShader'}  |  ${cmd} ${dir}`);
  for (const name of names) {
    let best = null;
    for (let k = 0; k < (cmd === 'compare' ? runs : 1); k++) {
      const res = name === 'menu' && k === 0 ? r : await runScene(name);
      if (!best) best = res;
      else {
        if (res.metrics && best.metrics && res.metrics.cpuMs < best.metrics.cpuMs) best.metrics = { ...best.metrics, cpuMs: res.metrics.cpuMs, cpuIqmMs: res.metrics.cpuIqmMs, cpuMainMs: res.metrics.cpuMainMs, syncMs: res.metrics.syncMs, throughputMs: res.metrics.throughputMs };
        // Every run must pass the image gate; keep the worst diff.
        if (res.diff && (!best.diff || (res.diff.over8 ?? Infinity) > (best.diff.over8 ?? -1))) best.diff = res.diff;
        if (res.errors.length) best.errors.push(...res.errors);
      }
    }
    results.push(best);
    process.stdout.write(`  ${name}: ${best.metrics ? `${best.metrics.mainCalls}+${best.metrics.shadowCalls} calls, ${best.metrics.cpuMs} ms` : 'FAILED'}${best.errors.length ? ` (${best.errors.length} errors)` : ''}\n`);
  }
}

await browser.close();
await server.close();

const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const fmtMetrics = (rows) => {
  const head = `${pad('scene', 20)}${lpad('main', 6)}${lpad('shadow', 8)}${lpad('total', 7)}${lpad('mainTris', 10)}${lpad('shTris', 9)}${lpad('cpu ms', 8)}${lpad('iqm', 8)}${lpad('mainMs', 8)}${lpad('sync', 7)}${lpad('frame', 7)}${lpad('prog', 6)}${lpad('geo', 6)}${lpad('tex', 5)}${lpad('objs', 6)}${lpad('useProg', 8)}${lpad('glCalls', 8)}`;
  return [head, ...rows.map(({ name, metrics: m }) => m
    ? `${pad(name, 20)}${lpad(m.mainCalls, 6)}${lpad(m.shadowCalls, 8)}${lpad(m.totalCalls, 7)}${lpad(m.mainTris, 10)}${lpad(m.shadowTris, 9)}${lpad(m.cpuMs.toFixed(2), 8)}${lpad(m.cpuIqmMs.toFixed(2), 8)}${lpad(m.cpuMainMs.toFixed(2), 8)}${lpad(m.syncMs.toFixed(1), 7)}${lpad(m.throughputMs.toFixed(1), 7)}${lpad(m.programs, 6)}${lpad(m.geometries, 6)}${lpad(m.textures, 5)}${lpad(m.objects, 6)}${lpad(m.useProgram, 8)}${lpad(m.glCalls, 8)}`
    : `${pad(name, 20)}  FAILED`)].join('\n');
};

if (cmd === 'baseline') {
  const scenes = {};
  for (const r of results) {
    if (r.png) writeFileSync(join(dir, `${r.name}.png`), r.png);
    scenes[r.name] = { fingerprint: r.fingerprint, metrics: r.metrics, errors: r.errors };
    if (!r.metrics || r.errors.length) failed = true;
  }
  const meta = { created: new Date().toISOString(), git: sha, cwd: process.cwd(), renderer: rendererName, gpu, viewport: '1920x1080@2', scenes };
  writeFileSync(join(dir, 'metrics.json'), JSON.stringify(meta, null, 1));
  const txt = `render-probe baseline  git ${sha}  ${rendererName}\n${fmtMetrics(results)}\n`;
  writeFileSync(join(dir, 'metrics.txt'), txt);
  console.log('\n' + txt);
  for (const r of results) if (r.errors.length) console.log(`${r.name} ERRORS:\n  ${r.errors.slice(0, 10).join('\n  ')}`);
  console.log(`baseline written to ${dir}`);
} else {
  const report = { created: new Date().toISOString(), git: sha, baselineGit: base.git, renderer: rendererName, baselineRenderer: base.renderer, tolerance: { delta: TOL_DELTA, frac: TOL_FRAC }, scenes: {} };
  const lines = [];
  if (base.renderer !== rendererName) lines.push(`WARNING: renderer differs from the baseline's (${base.renderer})`);
  lines.push(`${pad('scene', 20)}${lpad('maxΔ', 6)}${lpad('>2', 9)}${lpad('>8', 8)}${lpad('%>8', 9)}  ${pad('verdict', 8)}${pad('main', 12)}${pad('shadow', 12)}${pad('tris', 18)}cpu ms`);
  for (const r of results) {
    const b = base.scenes[r.name];
    const why = [];
    if (!b) why.push('not in baseline');
    if (r.errors.length) why.push(`${r.errors.length} errors`);
    if (!r.diff) why.push('no image');
    else if (r.diff.sizeMismatch) why.push(`size ${r.diff.sizeMismatch}`);
    else if (r.diff.over8 / r.diff.pixels > TOL_FRAC) why.push(`${r.diff.over8} px > ${TOL_DELTA}`);
    const fpDiff = [];
    if (b && r.fingerprint) for (const k of Object.keys(b.fingerprint)) if (JSON.stringify(b.fingerprint[k]) !== JSON.stringify(r.fingerprint[k])) fpDiff.push(k);
    if (fpDiff.length) why.push(`fingerprint: ${fpDiff.join(',')}`);
    const pass = why.length === 0;
    if (!pass) failed = true;
    if (r.diff?.png) writeFileSync(join(outDir, `${r.name}-diff.png`), Buffer.from(r.diff.png, 'base64'));
    if (r.png) writeFileSync(join(outDir, `${r.name}.png`), r.png);
    const m = r.metrics, bm = b?.metrics;
    const arrow = (k) => (bm && m ? `${bm[k]}->${m[k]}` : '?');
    const d = r.diff && !r.diff.sizeMismatch ? r.diff : null;
    lines.push(`${pad(r.name, 20)}${lpad(d ? d.max : '-', 6)}${lpad(d ? d.over2 : '-', 9)}${lpad(d ? d.over8 : '-', 8)}${lpad(d ? ((100 * d.over8) / d.pixels).toFixed(4) : '-', 9)}  ${pad(pass ? 'PASS' : 'FAIL', 8)}${pad(arrow('mainCalls'), 12)}${pad(arrow('shadowCalls'), 12)}${pad(arrow('mainTris'), 18)}${arrow('cpuMs')}${pass ? '' : `   <- ${why.join('; ')}`}`);
    report.scenes[r.name] = { pass, why, diff: d && { max: d.max, over0: d.over0, over2: d.over2, over8: d.over8, pixels: d.pixels }, before: bm, after: m, fingerprintDiff: fpDiff, errors: r.errors };
    if (fpDiff.length) for (const k of fpDiff) lines.push(`    ${k}: ${JSON.stringify(b.fingerprint[k]).slice(0, 160)}  ->  ${JSON.stringify(r.fingerprint[k]).slice(0, 160)}`);
    for (const e of r.errors.slice(0, 5)) lines.push(`    ${e}`);
  }
  const txt = `render-probe compare  git ${sha} vs baseline git ${base.git}  ${rendererName}\n${lines.join('\n')}\n\n${fmtMetrics(results)}\n\n${failed ? 'FAIL' : 'PASS'} (tolerance: <= ${TOL_FRAC * 100}% of pixels with delta > ${TOL_DELTA}, identical fingerprints, no errors)\n`;
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 1));
  writeFileSync(join(outDir, 'report.txt'), txt);
  console.log('\n' + txt + `report + images in ${outDir}`);
}
process.exit(failed ? 1 : 0);
