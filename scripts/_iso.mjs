import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({ root: process.cwd(), server: { port: 6397, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto('http://localhost:6397/?debug'); await page.waitForTimeout(1500);
await page.evaluate(() => { const g = window.__game; g.toMenu(); });
await page.locator('button:visible', { hasText: 'GARAGE' }).first().click();
await page.waitForTimeout(400);
await page.locator('.ss-plow-isotope').click();
await page.waitForTimeout(400);
for (const t of ['ISOTOPE']) { const b = page.locator('button:visible', { hasText: t }).last(); if (await b.count()) await b.click().catch(() => {}); }
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/iso-garage.png' });
const r = await page.evaluate(() => {
  const g = window.__game;
  g.startRun(1);
  for (let i = 0; i < 60 * 9; i++) g.tick(1 / 60);
  const st = g.ctx.stats;
  return { kind: st.plowKind, melt: st.meltDamage, f: g.ctx.combat.flameReady, alive: g.ctx.enemies.aliveCount(), state: g.state };
});
console.log(JSON.stringify(r));
await page.screenshot({ path: '/tmp/iso-run.png' });
const m = await page.evaluate(() => {
  const g = window.__game, en = g.ctx.enemies, p = g.ctx.plow.position;
  for (const e of en.query(p.x, p.z, 999).slice(0, 4)) { e.position.x = p.x + (Math.random() - 0.5) * 8; e.position.z = p.z + (Math.random() - 0.5) * 8; }
  const hp0 = en.query(p.x, p.z, 999).map((e) => Math.round(e.hp));
  g.ctx.input.keys?.add?.('KeyF');
  g.ctx.input.press?.('KeyF');
  return { hp0, inputKeys: Object.keys(g.ctx.input).slice(0, 20) };
});
console.log(JSON.stringify(m));
await page.keyboard.down('KeyF');
await page.evaluate(() => { const g = window.__game; for (let i = 0; i < 6; i++) g.tick(1 / 60); });
await page.keyboard.up('KeyF');
await page.evaluate(() => { const g = window.__game; for (let i = 0; i < 20; i++) g.tick(1 / 60); });
const after = await page.evaluate(() => { const g = window.__game, p = g.ctx.plow.position; return { f: g.ctx.combat.flameReady, hp: g.ctx.enemies.query(p.x, p.z, 999).map((e) => Math.round(e.hp)) }; });
console.log('after', JSON.stringify(after));
await page.screenshot({ path: '/tmp/iso-melt.png' });
console.log(errs.join('\n') || 'NO ERRORS');
await browser.close(); await server.close();
