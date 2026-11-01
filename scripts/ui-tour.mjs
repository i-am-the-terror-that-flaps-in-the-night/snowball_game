// UI screenshot tour: node scripts/ui-tour.mjs [outDir] [--w=1280 --h=720]
// Boots Vite, opens every menu screen and saves a screenshot of each. Reports console errors.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) || '/tmp/snowplow-ui';
const opt = (k, d) => Number(args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
mkdirSync(out, { recursive: true });
const port = 5200 + Math.floor(Math.random() * 500);
const server = await createServer({ server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PW_EXE || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: opt('w', 1280), height: opt('h', 720) } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('GPU stall')) errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
const shot = async (n) => { await page.waitForTimeout(700); await page.screenshot({ path: `${out}/${n}.png` }); };
const ui = (fn) => page.evaluate(fn);
try {
  await page.goto(`http://localhost:${port}/?debug`, { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  // Software rendering is slow; kill transitions so each shot shows the settled state.
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation-duration:0s!important}' });
  await ui(() => { const p = window.__game.ctx.progression; p.data.coins = 12345; });
  await ui(() => window.__game.ctx.ui.showMainMenu());
  await shot('01-menu');
  for (const tab of await page.$$eval('.ss-hub-cat', (b) => b.map((x) => x.dataset.cat))) {
    await page.click(`.ss-hub-cat[data-cat="${tab}"]`);
    await shot(`01-menu-${tab}`);
  }
  await ui(() => window.__game.ctx.ui.showZoneSelect()); await shot('02-zones');
  await ui(() => window.__game.ctx.ui.showGarage()); await shot('03-garage');
  await ui(() => window.__game.ctx.ui.showBrawlLobby()); await shot('04-brawl-lobby');
  await ui(() => { const u = window.__game.ctx.ui; u.showMainMenu(); u.show('howto'); }); await shot('05-howto');
  await ui(() => { const u = window.__game.ctx.ui; u.showMainMenu(); u.settings.open(); }); await shot('06-settings');
  await page.keyboard.press('Escape');
  await ui(() => { const u = window.__game.ctx.ui; u.showMainMenu(); u.trophies.open(); }); await shot('07-trophies');
  await page.keyboard.press('Escape');
  await ui(() => { const u = window.__game.ctx.ui; u.showMainMenu(); u.styleShop.open(); }); await shot('08-paint');
  await page.keyboard.press('Escape');
  await ui(() => { window.__game.ctx.ui.showMainMenu(); window.__game.startRun(0); for (let k = 0; k < 240; k++) window.__game.tick(1 / 60); });
  await shot('09-hud');
  await ui(() => window.__game.ctx.ui.showPause()); await shot('10-pause');
} catch (e) {
  errors.push(`[tour] ${e.stack || e}`);
}
console.log(errors.length ? `ERRORS (${errors.length}):\n` + errors.slice(0, 30).join('\n') : 'NO CONSOLE ERRORS');
console.log(`screenshots in ${out}`);
await browser.close();
await server.close();
