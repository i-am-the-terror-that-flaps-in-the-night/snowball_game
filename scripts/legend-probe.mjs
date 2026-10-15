// Legend balance probe: node scripts/legend-probe.mjs [difficulty=legend] [maxed=1]
// A fully-upgraded player driven by a simple aggressive autopilot plays a full simulated brawl.
// Reports player K/D, bot streaks, and how much of the lobby hunts the player.
import { createServer } from 'vite';
import { chromium } from 'playwright';

const diff = process.argv[2] || 'legend';
const maxed = (process.argv[3] ?? '1') === '1';
const port = 6100 + Math.floor(Math.random() * 90);
const server = await createServer({ root: '/Users/sachingupta/Developer/3js_game', server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
await page.waitForTimeout(1000);

const setup = await page.evaluate(([diff, maxed]) => {
  const g = window.__game, c = g.ctx, pr = c.progression;
  if (maxed) for (const u of pr.constructor.upgrades) pr.data.upgrades[u.id] = u.maxLevel;
  g.startBrawl(diff);
  for (let i = 0; i < 300; i++) g.tick(1 / 60);
  const P = (window.__P = { streakEvents: [], hunterSamples: [], dmgTaken: 0 });
  c.events.on('brawlStreak', (e) => P.streakEvents.push(`${e.name}:${e.count}`));
  c.events.on('plowDamaged', (e) => (P.dmgTaken += e.amount));
  P.eliteDeaths = {};
  c.events.on('brawlKill', (e) => {
    if (!e.victim.startsWith('[')) return;
    const k = e.killerIsPlayer ? 'player' : !e.killer ? 'none' : e.killer.startsWith('[') ? 'elite' : 'bot';
    const key = k + ':' + e.method;
    P.eliteDeaths[key] = (P.eliteDeaths[key] || 0) + 1;
  });
  const keys = {};
  const set = (code, on) => { if (!!keys[code] === on) return; keys[code] = on; window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code })); };
  const tap = (code) => { set(code, false); set(code, true); };
  window.__ap = () => {
    const p = c.plow, b = c.brawl;
    for (const k of ['Space', 'ShiftLeft', 'KeyE']) if (keys[k]) set(k, false);
    if (p.dead) { for (const k of ['KeyW', 'KeyA', 'KeyD']) set(k, false); return; }
    let best = null, bd = 1e9, near = 0;
    for (const r of b.rivals) {
      if (!r.alive) continue;
      const d = Math.hypot(r.position.x - p.position.x, r.position.z - p.position.z);
      if (d < 7) near++;
      if (d < bd) { bd = d; best = r; }
    }
    if (!best) { set('KeyW', false); return; }
    const want = Math.atan2(best.position.x - p.position.x, best.position.z - p.position.z);
    const diffA = Math.atan2(Math.sin(want - p.heading), Math.cos(want - p.heading));
    set('KeyW', true);
    set('KeyA', diffA > 0.08);
    set('KeyD', diffA < -0.08);
    if (p.heldBallRadius >= 0.5 && bd < 5.5 && Math.abs(diffA) < 0.45) tap('Space');
    else if (p.dashReady >= 1 && bd > 6 && bd < 14 && Math.abs(diffA) < 0.15) tap('ShiftLeft');
    else if (p.whirlReady >= 1 && near >= 1 && bd < 5) tap('KeyE');
  };
  const s = c.stats, r0 = c.brawl.rivals;
  return {
    player: { hp: s.maxHp, dmgMult: s.damageMult, ram: s.ramDamage, speed: +s.maxSpeed.toFixed(1), ball: +s.maxBallRadius.toFixed(2) },
    rivals: r0.map((r) => ({ name: r.f.entry.name, hp: r.maxHp, dmg: +r.s.dmgMult.toFixed(2), spd: +r.s.maxSpeed.toFixed(1), ball: +r.s.maxBall.toFixed(2), elite: r.s.elite })),
    state: g.state,
  };
}, [diff, maxed]);
console.log('PLAYER', JSON.stringify(setup.player));
for (const r of setup.rivals) console.log('RIVAL ', JSON.stringify(r));

let res;
for (let chunk = 0; chunk < 12; chunk++) {
  res = await page.evaluate(() => {
    const g = window.__game, c = g.ctx, b = c.brawl, P = window.__P;
    for (let i = 0; i < 1500 && !b.over; i++) {
      window.__ap();
      g.tick(1 / 60);
      if (i % 60 === 0) {
        let h = 0;
        for (const r of b.rivals) if (r.alive && r.mode === 'fight' && r.target && r.target.entry.isPlayer) h++;
        P.hunterSamples.push(h);
      }
    }
    const lb = b.hud().leaderboard;
    return { over: b.over, time: +b.hud().timeLeft.toFixed(0), board: lb.map((e) => `${e.name} ${e.kills}/${e.deaths} best${e.bestStreak}`) };
  });
  if (res.over) break;
}
const fin = await page.evaluate(() => {
  const P = window.__P, b = window.__game.ctx.brawl;
  const hs = P.hunterSamples;
  return {
    result: b.result && { placement: b.result.placement, kills: b.result.kills, deaths: b.result.deaths, best: b.result.bestStreak, coins: b.result.coinsEarned },
    avgHunters: +(hs.reduce((a, x) => a + x, 0) / Math.max(1, hs.length)).toFixed(2),
    maxHunters: Math.max(...hs),
    botStreakEvents: P.streakEvents.filter((s) => !s.startsWith('YOU')),
    dmgTaken: Math.round(P.dmgTaken),
    eliteDeaths: P.eliteDeaths,
  };
});
console.log('TIME LEFT', res.time, 'OVER', res.over);
for (const l of res.board) console.log('  ', l);
console.log('FINAL', JSON.stringify(fin));
console.log(errors.length ? 'ERRORS ' + errors.join('\n') : 'NO ERRORS');
await browser.close();
await server.close();
process.exit(0);
