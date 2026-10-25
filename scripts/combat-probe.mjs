import { createServer } from 'vite';
import { chromium } from 'playwright';
const port = 5800 + Math.floor(Math.random() * 100);
const server = await createServer({ root: process.cwd(), server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const g = window.__game, c = g.ctx, out = {};
  const tick = (s) => { for (let i = 0; i < s * 60; i++) g.tick(1 / 60); };
  g.startRun(0);
  // 1) Plow straight for 3s to build a ball (simulate holding W)
  const down = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
  const up = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  down('KeyW'); tick(2.5); up('KeyW'); tick(0.6);
  out.ballAfterPlow = +c.plow.heldBallRadius.toFixed(2);
  // 2) Put a scrapper right in front and slam
  g.state = 'playing';
  const f = c.plow.getForward(new c.plow.position.constructor());
  const p = c.plow.position;
  const e = c.enemies.spawn('scrapper', p.x + f.x * 3.2, p.z + f.z * 3.2, { hpMult: 1 });
  tick(0.05);
  e.position.set(p.x + f.x * 3.2, 0, p.z + f.z * 3.2);
  const hp0 = e.hp;
  down('Space'); tick(0.02); up('Space'); tick(0.5);
  out.slam = { hpBefore: hp0, hpAfter: Math.round(e.hp), alive: e.alive, ballAfter: +c.plow.heldBallRadius.toFixed(2) };
  // 3) Ram test: scrapper ahead, drive into it
  c.enemies.clear();
  const e2 = c.enemies.spawn('brute', p.x + f.x * 6, p.z + f.z * 6, { hpMult: 1 });
  const hpB = e2.hp;
  down('KeyW'); tick(1.2); up('KeyW');
  out.ram = { bruteHpBefore: hpB, after: Math.round(e2.hp) };
  // 4) Boss fight: spawn bulldoza, idle 12s, record plow hp + boss state
  c.enemies.clear(); c.plow.reset(); g.state = 'playing';
  const boss = c.enemies.spawn('bulldoza', 0, -15, { hpMult: 1 });
  const hpP0 = c.plow.hp;
  tick(12);
  out.boss = { plowHpBefore: hpP0, plowHpAfter: Math.round(c.plow.hp), bossHp: Math.round(boss.hp), bosses: c.enemies.bosses.length, dead: c.plow.dead };
  // 5) Whirl/dash readiness fields
  out.dashReady = c.plow.dashReady;
  return out;
});
console.log(JSON.stringify(r, null, 1));
await page.evaluate(() => { const g = window.__game; g.ctx.plow.reset(); g.ctx.enemies.clear(); g.ctx.enemies.spawn('bulldoza', 0, 5, {}); g.ctx.enemies.spawn('scrapper', -5, 10, {}); g.ctx.enemies.spawn('spinner', 5, 10, {}); for (let i = 0; i < 90; i++) g.tick(1/60); });
await page.waitForTimeout(400);
await page.screenshot({ path: '/tmp/showdown/05-brawl.png' });
console.log(errors.length ? 'ERRORS: ' + errors.join('\n') : 'NO ERRORS');
await browser.close(); await server.close(); process.exit(0);
