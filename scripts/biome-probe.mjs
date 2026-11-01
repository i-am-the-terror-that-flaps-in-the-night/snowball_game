// Biome look check: renders every campaign biome (arenas 1-5) and the Brawl venues, plus an ambience smoke test.
//   node scripts/biome-probe.mjs [outDir] [--only=0,2] [--menu] [--game] [--sky] [--top] [--close] [--brawl] [--ramps] [--audio]
// With no mode flag it renders menu + game + sky + top + close for the selected arenas, then the six Brawl venues.
//   menu-<i>.png  menu camera on arena i (what the main-menu backdrop shows)
//   game-<i>.png  follow camera after the countdown, driving forward from the spawn
//   sky-<i>.png   low camera looking north over the jumbotron (aurora, smoke, split sky, sun disc)
//   top-<i>.png   straight down from 75 m (terrain, lava / ice decals, ramp decks)
//   close-<i>-<x>_<z>.png  low close-up of each lava / ice patch (crater edges, crust ring, decal draping)
//   brawl-<key>.png  a Brawl match in each venue (Snowdome classic + the five biomes)
//   brawl-<key>-close-<x>_<z>.png  close-ups of the first lava patches of the Brawl Divide / Quarry
//   ramp-<venue>-<i>-side.png / -back.png  (--ramps, Inferno Quarry + Brawl Quarry) each jump ramp from beside its lip
//     and from past its lava trench; ramp-<venue>-<i>-cam.png  the follow camera with the plow driving at the ramp
//     (venue: q = campaign, bq = Brawl). Prints how much of each crust ring is faded off the ramps.
// Frames are read back with canvas.toDataURL right after a synchronous render (the DOM UI is not in them), so it
// works on SwiftShader: PW_EXE=/opt/pw-browsers/chromium node scripts/biome-probe.mjs /tmp/biomes
// Exits 1 on any console error / page error.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) || '/tmp/biome-probe';
const flag = (k) => args.includes(`--${k}`);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean).map(Number);
const modes = ['menu', 'game', 'sky', 'top', 'close', 'brawl', 'ramps', 'audio'].filter(flag);
const all = modes.length === 0;
const want = (m) => all ? m !== 'audio' && m !== 'ramps' : modes.includes(m);
mkdirSync(out, { recursive: true });
const save = (path, url) => writeFileSync(path, Buffer.from(url.split(',')[1], 'base64'));

const port = 5200 + Math.floor(Math.random() * 500);
// no HMR / file watching: a save elsewhere in the tree must not reload the page mid-run
const server = await createServer({ server: { port, strictPort: true, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  ...(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : { channel: 'chrome' }),
  headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GPU stall')) errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));

/** Dress the menu scene as arena i (like the main-menu backdrop) and settle a few frames. */
const dress = (i) => page.evaluate(async (i) => {
  const { ZONES } = await import('/src/config/zones.ts');
  const g = window.__game, c = g.ctx;
  if (g.state !== 'menu') g.toMenu(); // a previous arena's game shot left a run going
  c.zone = ZONES[i]; c.world.setZone(ZONES[i]); c.snow.reset(ZONES[i]);
  for (let k = 0; k < 60; k++) g.tick(1 / 60);
}, i);
/** Render with the game camera, or a probe camera placed at `pos` looking at `at`. */
const grab = (pos, at) => page.evaluate(([pos, at]) => {
  const g = window.__game, c = g.ctx;
  let cam = c.camera;
  if (pos) {
    cam = c.camera.clone();
    cam.position.set(...pos);
    cam.lookAt(...at);
    cam.updateMatrixWorld();
  }
  g.renderer.render(c.scene, cam);
  return g.renderer.domElement.toDataURL('image/png');
}, [pos, at]);
/** Patches of the loaded terrain (lava first), for the close-ups. */
const patchList = (n) => page.evaluate((n) => {
  const ps = window.__game.ctx.terrain.patches.map((p) => ({ m: p.material, x: p.x2 === undefined ? p.x : (p.x + p.x2) / 2, z: p.z2 === undefined ? p.z : (p.z + p.z2) / 2 }));
  ps.sort((a, b) => (a.m === 'lava' ? 0 : 1) - (b.m === 'lava' ? 0 : 1));
  return ps.slice(0, n);
}, n);
const closeShots = async (prefix, n, back = 7, up = 3.5) => {
  for (const p of await patchList(n)) {
    save(`${out}/${prefix}-${+p.x.toFixed(1)}_${+p.z.toFixed(1)}.png`, await grab([p.x + 3, up, p.z + back], [p.x, 0, p.z]));
  }
};

try {
  await page.goto(`http://localhost:${port}/?debug`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 });
  await page.evaluate(() => window.__game.setLoop(false));
  const idx = only.length ? only : [0, 1, 2, 3, 4];
  for (const i of idx) {
    if (want('menu') || want('sky') || want('top') || want('close')) await dress(i);
    if (want('menu')) save(`${out}/menu-${i}.png`, await grab());
    if (want('sky')) save(`${out}/sky-${i}.png`, await grab([0, 12, 26], [0, 22, -60]));
    if (want('top')) save(`${out}/top-${i}.png`, await grab([0, 75, 0.01], [0, 0, 0]));
    if (want('close')) await closeShots(`close-${i}`, 4);
    if (want('game')) {
      const info = await page.evaluate((i) => {
        const g = window.__game, c = g.ctx;
        g.startRun(i);
        for (let k = 0; k < 280; k++) g.tick(1 / 60);
        c.input.down?.add?.('KeyW');
        for (let k = 0; k < 60; k++) g.tick(1 / 60);
        c.input.down?.delete?.('KeyW');
        return { zone: c.zone.name, state: g.state, pos: c.plow.position.toArray().map((v) => +v.toFixed(2)) };
      }, i);
      save(`${out}/game-${i}.png`, await grab());
      const r = await page.evaluate(() => window.__game.ctx.renderer.info.render);
      console.log(`arena ${i}: ${JSON.stringify(info)} calls=${r.calls} tris=${r.triangles}`);
    }
  }
  if (want('brawl')) {
    for (const key of ['snowdome', 'glacier', 'quarry', 'mars', 'divide', 'plaza']) {
      await page.evaluate(async (key) => {
        const { brawlZone } = await import('/src/config/zones.ts');
        const g = window.__game, c = g.ctx;
        g.startBrawl('pro');
        const z = brawlZone(key);
        if (c.zone !== z) { c.zone = z; c.world.setZone(z); c.snow.reset(z); c.world.resetProps(true, false); }
        for (let k = 0; k < 300; k++) g.tick(1 / 60);
      }, key);
      save(`${out}/brawl-${key}.png`, await grab());
      if (key === 'divide' || key === 'quarry') await closeShots(`brawl-${key}-close`, 3, 14, 9);
      const r = await page.evaluate(() => window.__game.ctx.renderer.info.render);
      console.log(`brawl ${key}: calls=${r.calls} tris=${r.triangles}`);
    }
  }
  if (want('ramps')) {
    // Jump ramps over lava (Inferno Quarry, Brawl Quarry): close-ups beside the lip and from past the trench, then the
    // follow camera with the plow driving at each ramp (Brawl: the match camera, rivals and all).
    const ramps = () => page.evaluate(() => window.__game.ctx.terrain.shapes.filter((s) => s.kind === 'ramp')
      .map((r) => ({ x: r.x, z: r.z, rot: r.rot, len: r.len, fall: r.fall ?? 1 })));
    const crust = () => page.evaluate(() => {
      const m = window.__game.ctx.scene.getObjectByName('GroundDecals')?.children.find((o) => o.geometry?.getAttribute('fade'));
      if (!m) return 'no crust mesh';
      const f = m.geometry.getAttribute('fade');
      let off = 0;
      for (let i = 0; i < f.count; i++) if (f.getX(i) < 1) off++;
      return `crust ${f.count} vertices, ${off} faded off ramps, ${m.geometry.getIndex().count / 3} triangles drawn`;
    });
    const shots = async (tag, list) => {
      for (const [i, r] of list.entries()) {
        const fx = Math.sin(r.rot), fz = Math.cos(r.rot), rx = Math.cos(r.rot), rz = -Math.sin(r.rot);
        const lx = r.x + fx * r.len, lz = r.z + fz * r.len;
        save(`${out}/ramp-${tag}-${i}-side.png`, await grab([lx + rx * 6 - fx * 1.5, 2.6, lz + rz * 6 - fz * 1.5], [lx + fx * 1.5, 0.6, lz + fz * 1.5]));
        save(`${out}/ramp-${tag}-${i}-back.png`, await grab([lx + fx * 10 + rx * 3, 3.2, lz + fz * 10 + rz * 3], [lx, 0.8, lz]));
      }
    };
    const drive = async (tag, list) => {
      for (const [i, r] of list.entries()) {
        await page.evaluate((r) => {
          const g = window.__game, c = g.ctx, p = c.plow;
          p.heading = r.rot;
          p.position.x = r.x - Math.sin(r.rot) * 9;
          p.position.z = r.z - Math.cos(r.rot) * 9;
          p.speed = 8;
          c.cameraRig?.snap?.();
          c.input.down?.add?.('KeyW');
          for (let k = 0; k < 24; k++) g.tick(1 / 60);
          c.input.down?.delete?.('KeyW');
        }, r);
        save(`${out}/ramp-${tag}-${i}-cam.png`, await grab());
      }
    };
    await dress(1);
    const q = await ramps();
    console.log(`ramps q: ${await crust()}`);
    await shots('q', q);
    await page.evaluate(() => {
      const g = window.__game;
      g.startRun(1);
      for (let k = 0; k < 280; k++) g.tick(1 / 60);
    });
    await drive('q', q);
    await page.evaluate(async () => {
      const { brawlZone } = await import('/src/config/zones.ts');
      const g = window.__game, c = g.ctx;
      g.startBrawl('pro');
      const z = brawlZone('quarry');
      if (c.zone !== z) { c.zone = z; c.world.setZone(z); c.snow.reset(z); c.world.resetProps(true, false); }
      for (let k = 0; k < 300; k++) g.tick(1 / 60);
    });
    const bq = await ramps();
    console.log(`ramps bq: ${await crust()}`);
    await shots('bq', bq.slice(0, 2));
    await drive('bq', bq.slice(0, 2));
  }
  if (want('audio')) {
    const r = await page.evaluate(async () => {
      const a = window.__game.ctx.audio;
      a.unlock();
      for (const k of ['wind', 'lava', 'dust', 'factory', 'crowd', 'none']) {
        a.setAmbience(k);
        await new Promise((res) => setTimeout(res, 120));
      }
      for (const s of ['jump', 'land', 'airSlam', 'lavaBurn']) a.play(s);
      return a.ac?.state ?? 'no context';
    });
    console.log(`audio: ambience kinds + new one-shots played (context ${r})`);
  }
} catch (e) {
  errors.push(`[biome-probe] ${e.stack || e}`);
}
console.log(errors.length ? `ERRORS (${errors.length}):\n` + errors.slice(0, 30).join('\n') : 'NO CONSOLE ERRORS');
console.log(`images in ${out}`);
await browser.close();
await server.close();
process.exit(errors.length ? 1 : 0);
