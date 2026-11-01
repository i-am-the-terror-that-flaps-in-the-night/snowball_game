// Arena 6 preview: renders The Omega Works (decks, set dressing, terrain-shaped ground) in a bare Three.js scene from
// a few fixed cameras. Standalone: it does not boot the game, so it works while gameplay code is mid-change.
// PW_EXE=/opt/pw-browsers/chromium node scripts/omega-preview.mjs <outdir>
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '/tmp/omega-preview';
mkdirSync(out, { recursive: true });
const port = 6100 + Math.floor(Math.random() * 300);
const server = await createServer({ server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PW_EXE || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/scripts/preview/omega.html`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
const cams = [
  ['overview', [110, 85, 110], [0, 0, 0]],
  ['wall', [0, 18, 40], [0, 14, -84]],
  ['floor', [-30, 22, 38], [6, 8, -4]],
  ['undercroft', [10, 2.2, 30], [0, 3, 0], [10, 0.2, 30]],
  ['bridge', [60, 16, -10], [30, 7, -30]],
];
for (const [name, pos, look, focus] of cams) {
  await page.evaluate(({ pos, look, focus }) => window.__shot(pos, look, focus), { pos, look, focus });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/${name}.png` });
}
console.log(errors.length ? 'ERRORS:\n' + errors.slice(0, 10).join('\n') : 'no errors');
console.log(`screenshots in ${out}`);
await browser.close();
await server.close();
