// Headless Brawl-mode probe: node scripts/brawl-probe.mjs [outDir] [--noshots] [--only=bots,kit,kitshots,flow,flowshots,restore,menus,hud]
// Boots Vite + headless Chrome, starts a Snowdome brawl, fast-forwards the sim with __game.tick() and reports numbers:
// arena/snow/rivals setup, bot-vs-bot kills, streaks, AI behaviour, dash/whirl damage, coins, respawn, match end,
// campaign restore, ms/tick. Each evaluate stays short (the sandbox may kill long-running Chrome calls).
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '/tmp/brawl-probe';
const SHOTS = !process.argv.includes('--noshots');
mkdirSync(out, { recursive: true });
const port = 5900 + Math.floor(Math.random() * 90);
const server = await createServer({ root: '/Users/sachingupta/Developer/3js_game', server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const errors = [];
let browser, page;
let T0 = 0;
const el = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';
const VERBOSE = process.argv.includes('--verbose');
async function open(small) {
  T0 = Date.now();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: small ? { width: 320, height: 200 } : { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack}`));
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('GPU stall')) errors.push(`[${m.type()}] ${m.text()}`); });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
}
async function close() { await browser?.close().catch(() => {}); browser = page = null; }
/** Each session runs in a fresh Chrome (the sandbox kills long-lived Chrome processes after ~30s). */
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
/** Numeric sessions render a tiny viewport (swiftshader is slow); `big` sessions take 1280x720 screenshots. */
async function session(name, fn, big = false) {
  if (ONLY.length && !ONLY.includes(name)) return;
  if (big && !SHOTS) return;
  try { await open(!big); await fn(); } catch (e) { errors.push(`[${name}] ${e.stack || e}`); } finally { await close(); }
}
const START = () => ev(() => { const g = window.__game; g.startBrawl('pro'); for (let i = 0; i < 260; i++) g.tick(1 / 60); return g.state; });
// Swiftshader renders ~1-3 fps, so CSS animations barely advance before a screenshot: fast-forward short ones.
const settleCss = () => ev(() => { for (const a of document.getAnimations()) { const t = a.effect?.getComputedTiming(); if (t && t.endTime !== Infinity && (a.currentTime ?? 0) < 900) a.currentTime = Math.min(t.endTime - 1, 900); } });
const shot = async (n) => { if (SHOTS) { await settleCss(); await page.waitForTimeout(200); await page.screenshot({ path: `${out}/${n}.png` }); if (VERBOSE) console.log(`  [${el()}] shot ${n}`); } };
const log = (k, v) => console.log(k.padEnd(14), JSON.stringify(v));
const ev = async (fn, arg) => { const r = await page.evaluate(fn, arg); if (VERBOSE) console.log(`  [${el()}] eval`); return r; };

const KEY = `const down = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
const up = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));`;
void KEY;

// ================================================================== session 1: setup, 60s of bots, perf, player exposure
await session('bots', async () => {
  log('setup', await ev(() => {
    const g = window.__game, c = g.ctx, b = c.brawl;
    g.startBrawl('pro');
    const P = (window.__probe = { kills: [], streaks: [], shutdowns: [], coins: 0, slam: 0, dash: 0, whirl: 0, ram: 0, heal: 0 });
    c.events.on('brawlKill', (e) => P.kills.push(e));
    c.events.on('brawlStreak', (e) => P.streaks.push(e.name + ':' + e.label));
    c.events.on('brawlShutdown', (e) => P.shutdowns.push(e));
    for (const k of ['startSlam', 'startDash', 'startWhirl']) {
      const orig = b[k].bind(b);
      b[k] = (r) => { P[k.slice(5).toLowerCase()]++; return orig(r); };
    }
    const origRam = b.tryRivalRam.bind(b);
    b.tryRivalRam = (a, v, nx, nz) => { const cd = a.ramCd; origRam(a, v, nx, nz); if (cd <= 0 && a.ramCd > 0) P.ram++; };
    const origCocoa = b.updateCocoa.bind(b);
    b.updateCocoa = (dt, f) => { const n = b.cocoas.length; origCocoa(dt, f); if (b.cocoas.length < n) P.heal += n - b.cocoas.length; };
    return {
      state: g.state, arenaHalf: b.hud().arenaHalf, snowSize: c.snow.size, snowCell: +c.snow.CELL.toFixed(2),
      rivals: b.rivals.length, names: b.rivals.map((r) => r.f.entry.name), obstacles: c.world.obstacles.length,
      board: b.hud().leaderboard.length, cocoas: b.cocoas.length,
    };
  }));
  log('countdown', await ev(() => { const g = window.__game; for (let i = 0; i < 260; i++) g.tick(1 / 60); return { state: g.state, active: g.ctx.brawl.active }; }));
  const sample = (protect) => ev(([secs, protect]) => {
    const g = window.__game, c = g.ctx, b = c.brawl, P = window.__probe;
    P.modes ??= {}; P.stuck ??= 0; P.wall ??= 0; P.onPlayer ??= 0; P.samples ??= 0; P.still ??= 0; P.prev ??= new Map(); P.nearP ??= [];
    let ms = 0, ticks = 0;
    for (let s = 0; s < secs; s++) {
      const t0 = performance.now();
      for (let i = 0; i < 60; i++) { if (protect) c.plow.spawnProt = 5; g.tick(1 / 60); }
      ms += performance.now() - t0; ticks += 60;
      let nearest = 999;
      for (const r of b.rivals) {
        if (!r.alive) continue;
        nearest = Math.min(nearest, Math.hypot(r.position.x - c.plow.position.x, r.position.z - c.plow.position.z));
        if (protect) {
          P.samples++;
          P.modes[r.mode] = (P.modes[r.mode] || 0) + 1;
          if (r.stuckT > 0) P.stuck++;
          if (Math.max(Math.abs(r.position.x), Math.abs(r.position.z)) > 84) P.wall++;
          const pv = P.prev.get(r.id);
          if (pv && Math.hypot(pv.x - r.position.x, pv.z - r.position.z) < 1 && r.slamT < 0 && r.whirlT < 0) P.still++;
          P.prev.set(r.id, { x: r.position.x, z: r.position.z });
        } else if (r.target && r.target.entry.isPlayer) P.onPlayer++;
      }
      if (!protect) P.nearP.push(Math.round(nearest));
    }
    return { msPerTick: +(ms / ticks).toFixed(3), state: g.state };
  }, [10, protect]);
  const perf = [];
  for (let k = 0; k < 6; k++) perf.push((await sample(true)).msPerTick);
  log('ms/tick', perf);
  log('60s bots', await ev(() => {
    const P = window.__probe, b = window.__game.ctx.brawl;
    const botKills = P.kills.filter((k) => !k.killerIsPlayer && !k.victimIsPlayer && k.killer);
    const methods = {};
    for (const k of P.kills) methods[k.method] = (methods[k.method] || 0) + 1;
    return {
      brawlKillEvents: P.kills.length, botVsBotKills: botKills.length, methods, streaks: P.streaks, shutdowns: P.shutdowns.length,
      moves: { slam: P.slam, dash: P.dash, whirl: P.whirl, ram: P.ram, cocoaTaken: P.heal },
      modes: P.modes, stuckSamples: P.stuck, nearWallSamples: P.wall, stillSamples: P.still, samples: P.samples,
      board: b.hud().leaderboard.map((e) => `${e.name}:${e.kills}/${e.deaths}${e.streak ? ' s' + e.streak : ''}`),
      timeLeft: Math.round(b.timeLeft),
    };
  }));
  await ev(() => { window.__game.ctx.plow.spawnProt = 0; });
  const d0 = await ev(() => ({ deaths: window.__game.ctx.brawl.player.entry.deaths, hp: window.__game.ctx.plow.hp }));
  await sample(false); await sample(false);
  log('exposed 20s', await ev((d0) => {
    const g = window.__game, c = g.ctx, b = c.brawl, P = window.__probe;
    return { playerDeaths: b.player.entry.deaths - d0.deaths, hpNow: Math.round(c.plow.hp), targetingPlayerSamples: P.onPlayer, nearestRivalPerSec: P.nearP };
  }, d0));
});

// ================================================================== session 2: dash / dash strike / whirl numbers + shots
await session('kit', async () => {
  await START();
  await ev(() => { const b = window.__game.ctx.brawl; b.active = false; for (const r of b.rivals) { r.position.set(-80, 0, 80 - (r.id % 10) * 3); r.speed = 0; r.kvx = r.kvz = 0; } });
  log('dash', await ev(() => {
    const g = window.__game, c = g.ctx, plow = c.plow;
    const down = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    const up = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
    const res = {};
    for (const [label, pre] of [['standstill', 0], ['fullSpeed', 1]]) {
      plow.reset({ x: -10, z: -70, heading: Math.PI / 2 });
      plow.spawnProt = 0;
      for (let i = 0; i < 10; i++) g.tick(1 / 60);
      if (pre) { down('KeyW'); for (let i = 0; i < 90; i++) g.tick(1 / 60); }
      const x0 = plow.position.x, z0 = plow.position.z, sp0 = plow.speed;
      down('ShiftLeft'); g.tick(1 / 60); up('ShiftLeft');
      let t = 1 / 60, peak = 0;
      while (plow.dashing && t < 2) { g.tick(1 / 60); t += 1 / 60; peak = Math.max(peak, plow.speed); }
      const dashEnd = Math.hypot(plow.position.x - x0, plow.position.z - z0);
      for (let i = 0; i < 18; i++) g.tick(1 / 60);
      const withEase = Math.hypot(plow.position.x - x0, plow.position.z - z0);
      if (pre) up('KeyW');
      res[label] = { startSpeed: +sp0.toFixed(1), peakSpeed: +peak.toFixed(1), dashSecs: +t.toFixed(2), distDash: +dashEnd.toFixed(1), distWithEase: +withEase.toFixed(1) };
    }
    return res;
  }));
  log('dashStrike', await ev(() => {
    const g = window.__game, c = g.ctx, b = c.brawl, plow = c.plow;
    const down = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    const up = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
    plow.reset({ x: -10, z: -70, heading: Math.PI / 2 });
    plow.spawnProt = 0;
    const r = b.rivals[0];
    b.placeRival(r, 0, -70, -Math.PI / 2); r.protectT = 0;
    for (let i = 0; i < 5; i++) g.tick(1 / 60);
    const hp0 = r.hp;
    down('ShiftLeft'); g.tick(1 / 60); up('ShiftLeft');
    for (let i = 0; i < 60; i++) g.tick(1 / 60);
    return { rivalHp: hp0, dmg: Math.round(hp0 - r.hp), knockedTo: [Math.round(r.position.x), Math.round(r.position.z)], stats: { ramDamage: c.stats.ramDamage, dashPower: c.stats.dashPower, maxSpeed: c.stats.maxSpeed } };
  }));
  log('whirl', await ev(() => {
    const g = window.__game, c = g.ctx, b = c.brawl, plow = c.plow;
    const down = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    const up = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
    plow.reset({ x: 0, z: -70, heading: Math.PI / 2 });
    plow.spawnProt = 0;
    const r = b.rivals[1], r2 = b.rivals[2];
    b.placeRival(r, 0, -66.5, Math.PI); r.protectT = 0;
    b.placeRival(r2, -3.8, -70, Math.PI); r2.protectT = 0;
    for (let i = 0; i < 5; i++) g.tick(1 / 60);
    const hp0 = r.hp, hp20 = r2.hp;
    const d0 = Math.hypot(r.position.x - plow.position.x, r.position.z - plow.position.z);
    down('KeyE'); g.tick(1 / 60); up('KeyE');
    let minD = 99;
    for (let i = 0; i < 70; i++) { g.tick(1 / 60); minD = Math.min(minD, Math.hypot(r.position.x - plow.position.x, r.position.z - plow.position.z)); }
    const d1 = Math.hypot(r.position.x - plow.position.x, r.position.z - plow.position.z);
    return { radius: c.stats.whirlRadius, dmg: Math.round(hp0 - r.hp), dmg2: Math.round(hp20 - r2.hp), distStart: +d0.toFixed(1), minDist: +minD.toFixed(1), distEnd: +d1.toFixed(1), cooldown: c.stats.whirlCooldown };
  }));
});

// ================================================================== session 2b: whirl + dash screenshots
await session('kitshots', async () => {
  await START();
  await ev(() => { const b = window.__game.ctx.brawl; b.active = false; for (const r of b.rivals) { r.position.set(-80, 0, 80 - (r.id % 10) * 3); r.speed = 0; r.kvx = r.kvz = 0; } });
  await ev(() => {
    const g = window.__game, c = g.ctx, b = c.brawl, plow = c.plow;
    plow.reset({ x: 0, z: -70, heading: Math.PI / 2 }); plow.spawnProt = 0;
    b.placeRival(b.rivals[1], 0, -66, Math.PI); b.rivals[1].protectT = 0;
    b.placeRival(b.rivals[2], -3.5, -71, Math.PI); b.rivals[2].protectT = 0;
    for (let i = 0; i < 40; i++) g.tick(1 / 60);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); g.tick(1 / 60); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
    for (let i = 0; i < 26; i++) g.tick(1 / 60);
    g.state = 'paused';
  });
  await shot('13-whirl');
  await ev(() => {
    const g = window.__game, c = g.ctx, b = c.brawl, plow = c.plow;
    g.state = 'brawl';
    for (let i = 0; i < 180; i++) g.tick(1 / 60);
    plow.reset({ x: -14, z: -70, heading: Math.PI / 2 }); plow.spawnProt = 0;
    b.placeRival(b.rivals[3], 2, -70, -Math.PI / 2); b.rivals[3].protectT = 0;
    for (let i = 0; i < 30; i++) g.tick(1 / 60);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' })); g.tick(1 / 60); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'ShiftLeft' }));
    for (let i = 0; i < 12; i++) g.tick(1 / 60);
    g.state = 'paused';
  });
  await shot('14-dash');
}, true);

// ================================================================== session 3: coins, respawn, match end, back to campaign
await session('flow', async () => {
  await START();
  log('playerKill', await ev(() => {
    const g = window.__game, c = g.ctx, b = c.brawl;
    const r = b.rivals[4];
    b.placeRival(r, 10, -70, 0); r.protectT = 0;
    const pe = b.player.entry;
    const coins0 = c.progression.coins;
    pe.streak = 0;
    const plain = c.enemies.damage(r, 9999, { source: 'slam' });
    const coinsPlain = c.progression.coins - coins0;
    b.placeRival(r, 10, -70, 0); r.protectT = 0;
    pe.streak = 4; r.f.entry.streak = 3;
    const c1 = c.progression.coins;
    const killed = c.enemies.damage(r, 9999, { source: 'slam' });
    return { plainKill: plain, coinsPlain, streakKill: killed, coinsStreak5Shutdown: c.progression.coins - c1, playerStreak: pe.streak, hudMult: b.hud().streakMult, expected: { plain: Math.round(20 * 1.6), streak5: Math.round(20 * 2 * 1.6) + Math.round(12 * 3 * 1.6) } };
  }));
  log('respawn', await ev(() => {
    const g = window.__game, c = g.ctx, b = c.brawl, plow = c.plow;
    plow.spawnProt = 0;
    const r = b.rivals[5];
    b.player.lastHitBy = r.f; b.player.lastHitAt = b.time;
    const d0 = b.player.entry.deaths;
    c.combat.hitPlow(99999, plow.position.x + 1, plow.position.z, { unblockable: true });
    g.tick(1 / 60);
    const down = { dead: plow.dead, respawnIn: +b.hud().respawnIn.toFixed(2), killedBy: b.hud().killedBy, killerName: r.f.entry.name, deaths: b.player.entry.deaths - d0, streakReset: b.player.entry.streak };
    let t = 0;
    while (plow.dead && t < 6) { g.tick(1 / 60); t += 1 / 60; }
    const prot = plow.invulnerable;
    let protT = 0;
    while (plow.invulnerable && protT < 5) { g.tick(1 / 60); protT += 1 / 60; }
    return { down, respawnAfter: +t.toFixed(2), alive: !plow.dead, hp: plow.hp, invulnerableOnSpawn: prot, protectSecs: +protT.toFixed(2), state: g.state };
  }));
  log('matchEnd', await ev(() => {
    const g = window.__game, c = g.ctx, b = c.brawl;
    for (let i = 0; i < 200; i++) g.tick(1 / 60);
    b.timeLeft = 0.5;
    for (let i = 0; i < 60; i++) g.tick(1 / 60);
    const res = b.result;
    return { state: g.state, over: b.over, placement: res?.placement, total: res?.total, kills: res?.kills, deaths: res?.deaths, coinsEarned: res?.coinsEarned, placementBonus: res?.placementBonus };
  }));
});

// ================================================================== session 3c: respawn overlay + results screenshots
await session('flowshots', async () => {
  await START();
  await ev(() => { const g = window.__game, c = g.ctx, b = c.brawl; for (let i = 0; i < 600; i++) { c.plow.spawnProt = 5; g.tick(1 / 60); } c.plow.spawnProt = 0; b.player.lastHitBy = b.rivals[6].f; b.player.lastHitAt = b.time; c.combat.hitPlow(99999, c.plow.position.x + 1, c.plow.position.z, { unblockable: true }); for (let i = 0; i < 50; i++) g.tick(1 / 60); });
  await shot('15-respawn-overlay');
  await ev(() => { const g = window.__game, b = g.ctx.brawl; for (let i = 0; i < 200; i++) g.tick(1 / 60); b.player.entry.kills = 6; b.player.entry.bestStreak = 4; b.timeLeft = 0.2; for (let i = 0; i < 30; i++) g.tick(1 / 60); });
  await shot('16-brawl-results');
}, true);

// ================================================================== session 3b: quit to menu restores the campaign arena
await session('restore', async () => {
  await START();
  await ev(() => { const g = window.__game, b = g.ctx.brawl; b.timeLeft = 0.2; for (let i = 0; i < 30; i++) g.tick(1 / 60); });
  log('toMenu', await ev(() => {
    const g = window.__game, c = g.ctx;
    g.toMenu();
    return { state: g.state, snowSize: c.snow.size, obstacles: c.world.obstacles.length, rivalsLeft: c.brawl.rivals.length, enemiesIsBrawl: c.enemies === c.brawl, zone: c.zone.name };
  }));
  log('campaign', await ev(() => {
    const g = window.__game, c = g.ctx;
    g.startRun(0);
    for (let i = 0; i < 260; i++) g.tick(1 / 60);
    const st = g.state;
    for (let i = 0; i < 300; i++) g.tick(1 / 60);
    return { stateAfterCountdown: st, hp: c.plow.hp, enemiesAlive: c.enemies.aliveCount(), remaining: c.waves.remaining, snowSize: c.snow.size, pos: c.plow.position.toArray().map((v) => +v.toFixed(1)) };
  }));
});

// ================================================================== session 4: menu, lobby, mid-fight HUD screenshots
await session('menus', async () => {
  await shot('01-menu');
  await ev(() => { const b = [...document.querySelectorAll('button')].find((x) => /BRAWL/.test(x.textContent)); b?.click(); });
  await shot('02-lobby');
}, true);
await session('hud', async () => {
  await START();
  await ev(() => {
    const g = window.__game, c = g.ctx, b = c.brawl;
    for (let i = 0; i < 1200; i++) { c.plow.spawnProt = 5; g.tick(1 / 60); }
  });
  await ev(() => {
    const g = window.__game, c = g.ctx, b = c.brawl, plow = c.plow;
    // put the player next to the busiest spot, facing it
    let best = null, bestN = -1;
    for (const r of b.rivals) { if (!r.alive) continue; let n = 0; for (const o of b.rivals) if (o.alive && Math.hypot(o.position.x - r.position.x, o.position.z - r.position.z) < 25) n++; if (n > bestN) { bestN = n; best = r; } }
    const a = Math.atan2(best.position.x, best.position.z);
    const px = best.position.x - Math.sin(a) * 14, pz = best.position.z - Math.cos(a) * 14;
    plow.reset({ x: px, z: pz, heading: Math.atan2(best.position.x - px, best.position.z - pz) });
    b.player.entry.streak = 3; b.player.entry.kills = 3;
    plow.heldVolume = 0.9;
    c.cameraRig.snap();
    for (let i = 0; i < 40; i++) g.tick(1 / 60);
  });
  await shot('12-brawl-hud');
}, true);
console.log(errors.length ? `ERRORS (${errors.length}):\n` + errors.slice(0, 20).join('\n') : 'NO CONSOLE ERRORS');
console.log(`screenshots in ${out}`);
await server.close();
process.exit(0);
