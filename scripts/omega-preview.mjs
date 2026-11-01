// Arena 6 preview: renders The Omega Works structures from a few fixed cameras (no gameplay).
// PW_EXE=/opt/pw-browsers/chromium node scripts/omega-preview.mjs <outdir>
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const out = process.argv[2]; mkdirSync(out, { recursive: true });
const port = 6100 + Math.floor(Math.random() * 300);
const server = await createServer({ server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PW_EXE || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/?debug`); await page.waitForTimeout(2000);
await page.evaluate(async () => {
  const { OMEGA_TERRAIN } = await import('/src/world/omega/layout.ts');
  const { OmegaWorks } = await import('/src/world/omega/OmegaWorks.ts');
  const g = window.__game; const c = g.ctx;
  g.startRun(5);
  for (let k = 0; k < 30; k++) g.tick(1 / 60);
  c.terrain.load(OMEGA_TERRAIN);
  const w = new OmegaWorks(c.terrain); c.scene.add(w.group); window.__works = w;
  c.ui.setHudVisible(false);
});
const cams = [
  ['overview', [95, 70, 95], [0, 4, 0]],
  ['floor', [-30, 22, 38], [6, 8, -4]],
  ['undercroft', [10, 2.2, 30], [0, 3, 0]],
  ['bridge', [60, 16, -10], [30, 7, -30]],
];
for (const [name, pos, look] of cams) {
  await page.evaluate(({ pos, look }) => {
    const c = window.__game.ctx; const cam = c.camera;
    c.cameraRig.update = () => {}; if (c.cameraRig.cinematic) c.cameraRig.cinematic = () => {};
    cam.position.set(...pos); cam.lookAt(...look); cam.far = 600; cam.updateProjectionMatrix();
    window.__works.update(1 / 60, pos[0], pos[1] - 2, pos[2]);
    c.renderer.render(c.scene, cam);
  }, { pos, look });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}.png` });
}
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 10).join('\n') : 'no errors');
await browser.close(); await server.close();
