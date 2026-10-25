// Headless playtest: node scripts/smoke.mjs [outDir]
// Boots the Vite dev server, opens the game in headless Chrome, plows a ball, fights round 1, reports errors.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv.slice(2).find((a) => !a.startsWith('--')) || '/tmp/snowplow-shots';
mkdirSync(out, { recursive: true });
const port = 5200 + Math.floor(Math.random() * 500);
const server = await createServer({ server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GPU stall')) errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const probe = () => page.evaluate(() => { const g = window.__game, c = g.ctx; return { state: g.state, ball: +c.plow.heldBallRadius.toFixed(2), hp: Math.round(c.plow.hp), pos: c.plow.position.toArray().map((v) => +v.toFixed(1)), alive: c.enemies.aliveCount(), remaining: c.waves.remaining, bosses: c.enemies.bosses.length, snow: +c.snow.totalSnowFraction().toFixed(3) }; });
try {
  await page.goto(`http://localhost:${port}/?debug`, { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await shot('01-menu');
  await page.evaluate(() => window.__game.startRun(0));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await shot('02-plowing');
  console.log('after plowing:', JSON.stringify(await probe()));
  await page.keyboard.up('KeyW');
  // Fast-forward the simulation while holding W and slamming periodically.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.down('KeyW');
    await page.evaluate(() => { for (let k = 0; k < 30; k++) window.__game.tick(1 / 60); });
    if (i % 3 === 2) await page.keyboard.press('Space');
    await page.keyboard.up('KeyW');
  }
  await page.waitForTimeout(300);
  await shot('03-fight');
  console.log('round 1 fight:', JSON.stringify(await probe()));
  // Jump straight to the boss round of arena 0.
  await page.evaluate(() => { const g = window.__game; g.ctx.enemies.clear(); g.ctx.waves.clear(); g.roundIndex = g.ctx.zone.rounds.length - 1; g.beginCountdown(); for (let k = 0; k < 300; k++) g.tick(1 / 60); });
  await page.waitForTimeout(500);
  await shot('04-boss');
  console.log('boss round:', JSON.stringify(await probe()));
} catch (e) {
  errors.push(`[smoke] ${e.stack || e}`);
}
console.log(errors.length ? `ERRORS (${errors.length}):\n` + errors.slice(0, 30).join('\n') : 'NO CONSOLE ERRORS');
console.log(`screenshots in ${out}`);
await browser.close();
await server.close();
process.exit(0);
