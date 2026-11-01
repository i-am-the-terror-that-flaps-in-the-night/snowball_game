// Headless Brawl-mode probe: node scripts/brawl-probe.mjs [outDir] [--noshots] [--only=bots,kit,kitshots,lava,flow,flowshots,restore,menus,hud] [--lava-runs=N --lava-secs=S --lava-seed=B --lava-trace]
// Boots Vite + headless Chrome, starts a Snowdome brawl, fast-forwards the sim with __game.tick() and reports numbers:
// arena/snow/rivals setup, bot-vs-bot kills, streaks, AI behaviour, dash/whirl damage, coins, respawn, match end,
// campaign restore, ms/tick. Each evaluate stays short (the sandbox may kill long-running Chrome calls).
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv.slice(2).find((a) => !a.startsWith('--')) || '/tmp/brawl-probe';
const SHOTS = !process.argv.includes('--noshots');
mkdirSync(out, { recursive: true });
const port = 5900 + Math.floor(Math.random() * 90);
const server = await createServer({ root: process.cwd(), server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const errors = [];
let browser, page;
let T0 = 0;
const el = () => ((Date.now() - T0) / 1000).toFixed(1) + 's';
const VERBOSE = process.argv.includes('--verbose');
async function open(small) {
  T0 = Date.now();
  browser = await chromium.launch({ ...(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : { channel: 'chrome' }), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
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

// ================================================================== session 2c: rivals vs lava on the Quarry dome
// --lava-runs=N (default 2) unseeded Quarry Brawl matches of --lava-secs=S (default 120) each. Every match plays on its
// own Math.random seed (printed; --lava-seed=B replays seeds B, B+1, ...). Each lava entry is put down to its cause:
// knockback (|kv| > 1.5 in the last 0.5 s, side-hops included), a flight (airborne in the last 20 ticks), a dash (during
// one or within 1.5 s after) or plain steering. Dash and steering entries are the AI's own fault and fail the probe.
// Also: the longest standstill next to lava (no stun / wind-up), which must stay short.
await session('lava', async () => {
  const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.slice(k.length + 3)) : d; };
  const RUNS = arg('lava-runs', 2), SECS = arg('lava-secs', 120);
  const base = arg('lava-seed', Math.floor(Math.random() * 1e9));
  const tot = { entries: 0, own: 0, knock: 0, flight: 0, dash: 0, steer: 0, ownTicks: 0, maxStall: 0, dashes: 0, rt: 0 };
  const logs = [];
  for (let run = 0; run < RUNS; run++) {
    const seed = base + run;
    const zone = await ev(([seed, trace]) => {
      const g = window.__game, c = g.ctx, b = c.brawl;
      window.__rnd ??= Math.random;
      let a = seed >>> 0, first = true;
      const prng = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      // first draw = the venue (pickBrawlZone: 0.4 -> quarry), then the seeded stream
      Math.random = () => (first ? ((first = false), 0.4) : prng());
      g.startBrawl('pro');
      for (let i = 0; i < 260; i++) g.tick(1 / 60);
      const L = (window.__lv = { entries: [], ticks: { knock: 0, flight: 0, dash: 0, steer: 0 }, maxStall: 0, stallLog: '', dashes: 0, rt: 0, per: new Map(), kt: b.hud().killTarget, trace, stallTrace: [] });
      if (!b.__lvWrapped) {
        b.__lvWrapped = true;
        const orig = b.startDash.bind(b);
        b.startDash = (r) => { window.__lv.dashes++; return orig(r); };
      }
      void L;
      return { zone: c.zone.name, state: g.state, lava: b.lava.list.length };
    }, [seed, process.argv.includes('--lava-trace')]);
    if (!/Quarry/.test(zone.zone) || zone.state !== 'brawl') throw new Error(`lava: expected a live Quarry brawl, got ${JSON.stringify(zone)}`);
    for (let t = 0; t < SECS; t += 20) {
      await ev((secs) => {
        const g = window.__game, c = g.ctx, b = c.brawl, L = window.__lv;
        for (let i = 0; i < secs * 60; i++) {
          c.plow.hp = c.plow.maxHp = 1e6;
          b.timeLeft = Math.max(b.timeLeft, 30);
          // keep the match live for the whole sample (no kill-target finish)
          for (const f of b.fighters) if (f.entry.kills > L.kt - 4) f.entry.kills = L.kt - 4;
          g.tick(1 / 60);
          for (const r of b.rivals) {
            if (!r.alive) { L.per.delete(r.id); continue; }
            L.rt++;
            let p = L.per.get(r.id);
            if (!p) L.per.set(r.id, (p = { air: 0, knock: 0, post: 999, wasDash: false, inLava: false, cause: '', stall: 0, dashV: 0 }));
            const air = r.vert.airborne;
            p.air = air ? 20 : p.air - 1;
            const kv = Math.hypot(r.kvx, r.kvz);
            p.knock = kv > 1.5 ? 30 : p.knock - 1;
            if (r.dashing) { if (!p.wasDash) p.dashV = r.speed; p.post = 0; } else p.post++;
            p.wasDash = r.dashing;
            const on = !air && c.terrain.materialAt(r.position.x, r.position.z) === 'lava';
            if (on && !p.inLava) {
              p.cause = p.knock > 0 ? 'knock' : p.air > 0 ? 'flight' : p.post < 90 ? 'dash' : 'steer';
              if (L.entries.length < 400) L.entries.push({ cause: p.cause, d: `${p.cause} #${r.id} t${b.time.toFixed(1)} v${r.speed.toFixed(1)} kv${kv.toFixed(1)} h${r.heading.toFixed(2)}/${r.desH.toFixed(2)} @${r.position.x.toFixed(1)},${r.position.z.toFixed(1)} post${p.post} dashV${p.dashV.toFixed(1)}` });
            }
            p.inLava = on;
            if (on) L.ticks[p.cause]++;
            const ld = b.lava.dist(r.position.x, r.position.z);
            // parked: next to lava, (almost) still, not stunned / winding up / airborne / being pushed
            const busy = r.stunT > 0 || r.slamT >= 0 || r.whirlT >= 0 || r.poundT >= 0 || r.clapT >= 0 || air || kv > 0.5 || !b.active;
            if (ld > 0 && ld < 2.5 && Math.abs(r.speed) < 0.5 && !busy) {
              p.stall++;
              if (L.trace && p.stall % 10 === 1 && (p.tr ??= []).length < 30) p.tr.push(`${p.stall}: h${r.heading.toFixed(2)}/${r.desH.toFixed(2)} v${r.speed.toFixed(1)}/${r.desSpeed.toFixed(1)} ld${ld.toFixed(2)} @${r.position.x.toFixed(1)},${r.position.z.toFixed(1)} ${r.mode} dodge${r.dodgeT.toFixed(2)} stuck${r.stuckT.toFixed(2)}`);
              if (p.stall > L.maxStall) { L.maxStall = p.stall; L.stallLog = `#${r.id} t${b.time.toFixed(1)} @${r.position.x.toFixed(1)},${r.position.z.toFixed(1)} ld${ld.toFixed(2)} h${r.heading.toFixed(2)}/${r.desH.toFixed(2)}`; if (L.trace) L.stallTrace = p.tr.slice(); }
            } else { p.stall = 0; if (p.tr) p.tr.length = 0; }
          }
        }
      }, Math.min(20, SECS - t));
    }
    const res = await ev(() => {
      const L = window.__lv, g = window.__game;
      const n = (k) => L.entries.filter((e) => e.cause === k).length;
      return { state: g.state, entries: L.entries.length, knock: n('knock'), flight: n('flight'), dash: n('dash'), steer: n('steer'), ticks: L.ticks, maxStall: L.maxStall, stallLog: L.stallLog, dashes: L.dashes, rt: L.rt, stallTrace: L.stallTrace, own: L.entries.filter((e) => e.cause === 'dash' || e.cause === 'steer').map((e) => e.d).slice(0, 6) };
    });
    log(`lava run ${run + 1}`, { seed, secs: SECS, entries: res.entries, knock: res.knock, flight: res.flight, dash: res.dash, steer: res.steer, ticks: res.ticks, maxStallTicks: res.maxStall, stall: res.stallLog, dashes: res.dashes, rivalTicks: res.rt, state: res.state });
    for (const d of res.own) logs.push(`seed ${seed}: ${d}`);
    for (const t of res.stallTrace) console.log('   stall', t);
    tot.entries += res.entries; tot.knock += res.knock; tot.flight += res.flight; tot.dash += res.dash; tot.steer += res.steer;
    tot.own += res.dash + res.steer; tot.ownTicks += res.ticks.dash + res.ticks.steer; tot.maxStall = Math.max(tot.maxStall, res.maxStall); tot.dashes += res.dashes; tot.rt += res.rt;
  }
  log('lava total', { runs: RUNS, secs: SECS, seeds: `${base}..${base + RUNS - 1}`, ...tot });
  for (const l of logs) console.log('   own entry:', l);
  if (tot.own > 0) errors.push(`[lava] ${tot.own} rival lava entries not caused by knockback or a flight (${tot.dash} after dashes, ${tot.steer} steered) over ${RUNS} x ${SECS} s; replay with --lava-seed=${base}`);
  if (tot.maxStall > 150) errors.push(`[lava] a rival stood still next to lava for ${tot.maxStall} ticks; replay with --lava-seed=${base}`);
  // Dash at a river: the Quarry trenches are short enough to steer round, so this swaps in a flat rock floor with one
  // long lava river (100 m x 5 m). A rival 20 m from its edge, heading at it (straight or up to 0.5 rad off) at top
  // speed, dashes (startDash directly, so only the in-dash check guards it) with its AI held on that course; again with
  // a slam's +8 m/s on top. 4 spots x 4 angles x 2 sides x 2 = 64 runs; none may touch the lava. (Runs last: the
  // terrain is not put back.)
  const dashRes = await ev(() => {
    const g = window.__game, c = g.ctx, b = c.brawl;
    const RW = 2.5;
    if (g.state !== 'brawl') { g.startBrawl('pro'); for (let i = 0; i < 260; i++) g.tick(1 / 60); }
    c.terrain.load({ patches: [{ material: 'lava', x: -50, z: 0, x2: 50, z2: 0, r: RW }], baseMaterial: 'rock' });
    c.world.obstacles.length = 0;
    const lava = b.lava, half = b.hud().arenaHalf;
    const T = b.rivals.find((r) => r.alive);
    const steer = b.steer, think = b.think;
    let H = 0;
    b.steer = function (r, dt) { if (r === T) { r.desH = H; r.desSpeed = 30; return; } return steer.call(this, r, dt); };
    b.think = function (r) { if (r !== T) return think.call(this, r); };
    const res = { trials: 0, touched: 0, minEdge: 99, peak: 0, aborted: 0, log: [] };
    for (const boost of [0, 8]) for (const side of [1, -1]) for (const x of [-30, -10, 10, 30]) for (const off of [0, 0.25, -0.25, 0.5]) {
      for (const o of b.rivals) if (o !== T && o.alive) { o.position.set(-half + 4, 0, -half + 4); o.stunT = 99; o.speed = 0; o.kvx = o.kvz = 0; }
      c.plow.reset({ x: half - 6, z: half - 6, heading: 0 });
      c.plow.spawnProt = 99;
      H = (side > 0 ? 0 : Math.PI) + off;
      b.placeRival(T, x, -side * (RW + 20), H);
      T.protectT = 99; T.stunT = 0; T.kvx = T.kvz = 0; T.slamT = -1; T.whirlT = -1; T.hp = T.maxHp;
      T.speed = b.topSpeed(T);
      b.startDash(T);
      T.speed += boost;
      let touched = false, minEdge = 99, peak = T.speed, dashTicks = 0;
      for (let i = 0; i < 180; i++) {
        g.tick(1 / 60);
        if (T.dashing) dashTicks++;
        peak = Math.max(peak, T.speed);
        minEdge = Math.min(minEdge, lava.dist(T.position.x, T.position.z));
        if (c.terrain.materialAt(T.position.x, T.position.z) === 'lava') touched = true;
      }
      res.trials++;
      if (dashTicks < 29) res.aborted++;
      res.peak = Math.max(res.peak, +peak.toFixed(1));
      res.minEdge = Math.min(res.minEdge, +minEdge.toFixed(2));
      if (touched && res.log.length < 6) res.log.push(`boost${boost} side${side} x${x} off${off}: minEdge ${minEdge.toFixed(2)} peak ${peak.toFixed(1)}`);
      if (touched) res.touched++;
    }
    delete b.steer; delete b.think;
    return res;
  });
  log('lava dash', dashRes);
  if (dashRes.touched > 0 || dashRes.trials < 64) errors.push(`[lava] dash at a river: ${dashRes.touched}/${dashRes.trials} dashes from 20 m touched lava`);
});

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
  // The BRAWL tile lives in the hub's PLAY pane (the default tab). A missed click must fail the probe.
  const lobby = await ev(() => {
    const b = document.querySelector('.ss-tile[data-tile="brawl"]');
    if (!b || b.offsetParent === null) return 'no visible BRAWL tile';
    b.click();
    const cur = window.__game.ctx.ui.current;
    return cur === 'lobby' ? 'ok' : `clicked BRAWL, but the screen is ${cur}`;
  });
  if (lobby !== 'ok') throw new Error(`menus: ${lobby}`);
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
// Warnings are listed above but only real errors (console errors, page errors, failed steps) fail the probe.
process.exit(errors.some((e) => !e.startsWith('[warning]')) ? 1 : 0);
