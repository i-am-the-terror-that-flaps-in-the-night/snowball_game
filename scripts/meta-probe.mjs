// Headless meta-progression probe: node scripts/meta-probe.mjs [outDir]
// Drives the Paint Shop, Trophies, zone select (stars + Hard), a Hard-mode clear, a Daily run and their results
// screens through window.__game, screenshotting each step and failing on console errors.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv.slice(2).find((a) => !a.startsWith('--')) || '/tmp/meta-probe';
mkdirSync(out, { recursive: true });
const root = process.cwd();
const port = 6200 + Math.floor(Math.random() * 100);
const server = await createServer({ root, server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: [process.env.PROBE_GPU === '0' ? '--use-angle=swiftshader' : '--use-angle=metal', '--enable-unsafe-swiftshader'] });
const errors = [];
const log = (...a) => console.log(...a);

async function session(w, h, tag) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`); });
  await page.goto(`http://localhost:${port}/?debug`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const shot = async (name, wait = 350) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${tag}-${name}.png` }); };
  const clickText = async (text) => {
    const b = page.locator('button:visible', { hasText: text }).first();
    if (!(await b.count())) { log(`  [${tag}] no visible button "${text}"`); return false; }
    await b.click();
    return true;
  };
  // Skip the auto tutorial, land on the main menu.
  await page.evaluate(() => { const g = window.__game; g.toMenu(); });
  await shot('menu');

  if (await clickText('PAINT SHOP')) {
    await shot('paint');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await shot('paint-bought');
    await page.keyboard.press('Escape');
  }
  if (await clickText('TROPHIES')) {
    await shot('trophies');
    const stats = page.locator('button:visible', { hasText: /STATS/i }).first();
    if (await stats.count()) { await stats.click(); await shot('trophies-stats'); }
    await page.keyboard.press('Escape');
  }

  // Campaign: mark arena 1 cleared so Hard opens, then look at zone select.
  await page.evaluate(() => { const p = window.__game.ctx.progression; p.data.zones.yard = { cleared: true, bestRound: 3 }; p.commit(); });
  if (await clickText('FIGHT')) await shot('zones');
  await page.keyboard.press('Escape');

  // Hard clear of arena 1 (jump straight to victory) -> results screen with challenges.
  const hard = await page.evaluate(() => {
    const g = window.__game;
    g.startRun(0, true);
    const name = g.ctx.zone.name;
    for (let i = 0; i < 60; i++) g.tick(1 / 60);
    g.run.kills = 9; g.run.killsBy.slam = 7; g.run.killsBy.ram = 2; g.run.biggestBall = 1.6; g.run.bestCombo = 12;
    g.victory();
    return { name, state: g.state, hardCleared: g.ctx.progression.data.hardCleared, stars: g.ctx.progression.data.challenges };
  });
  log(`  [${tag}] hard run:`, JSON.stringify(hard));
  await shot('hard-victory', 2500);

  // Daily run: start, tick a few waves' worth, then wreck -> game over.
  const daily = await page.evaluate(() => {
    const g = window.__game;
    g.startSurvival(true);
    for (let i = 0; i < 60 * 5; i++) g.tick(1 / 60);
    const hud = g.ctx.zone.name;
    g.ctx.plow.damage(1e6);
    for (let i = 0; i < 60 * 3; i++) g.tick(1 / 60);
    return { zone: hud, state: g.state, dailyBest: g.ctx.progression.data.dailyBest, spec: g.survival.daily };
  });
  log(`  [${tag}] daily run:`, JSON.stringify(daily));
  await shot('daily-over', 2500);

  const meta = await page.evaluate(() => {
    const d = window.__game.ctx.progression.data;
    return { achievements: Object.keys(d.achievements ?? {}).length, lifetime: d.lifetime, cosmetics: d.cosmetics };
  });
  log(`  [${tag}] save meta:`, JSON.stringify(meta));
  await page.close();
}

for (const [w, h, tag] of [[1280, 800, 'wide'], [700, 800, 'narrow']]) {
  try {
    await session(w, h, tag);
  } catch (e) {
    // A crashed page (e.g. swiftshader running out of memory) shouldn't hide the other session's results.
    errors.push(`[${tag}] probe aborted: ${String(e.message).split('\n')[0]}`);
  }
}
log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO CONSOLE ERRORS');
log(`screenshots in ${out}`);
await browser.close();
await server.close();
process.exit(errors.length ? 1 : 0);
