// Headless online-DUEL probe: node scripts/duel-probe.mjs [outDir] [--noshots] [--lag=ms] [--only=lobby,match,rematch]
// One browser context, two pages (HOST + GUEST) connected over the BroadcastChannel transport (?duel=local).
//   lobby    the real lobby DOM: host, read the code, a wrong code ("not found"), join; the DUEL GARAGE with catch-up
//            coins (the weaker guest buys temp levels; the host must see them in that player's stats; the save must
//            not); READY on both -> round 1.
//   match    autopilots on both sides fight a best of 3 (slam, dash, whirl, F); both sides must agree on HP and
//            score, rounds end, the score advances and the match ends on both screens.
//   rematch  results -> REMATCH (both must accept) -> fresh garage -> Classic vs ISOTOPE: a NUKE pressed on the
//            guest keyboard lands on the host, Inferno from the host keyboard; pause keeps the match running;
//            LEAVE ends it for both; single-player still works afterwards.
//   arsenal  ARSENAL vs ARSENAL: the guest HOLDING Space keeps its autocannon firing on the host (held keys travel in
//            the input packet), well off the nose; its turret follows the host's aim; the host's guns and laser show
//            on the guest's puppet; the guest's laser and missiles land on the host.
// Each session runs in a fresh Chrome (the sandbox kills long-lived headless Chrome). The duel clock is sim time, so
// both pages are fast-forwarded in lockstep (render loops paused except for screenshots).
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv.slice(2).find((a) => !a.startsWith('--')) || '/tmp/duel-probe';
const SHOTS = !process.argv.includes('--noshots');
const LAG = Number((process.argv.find((a) => a.startsWith('--lag=')) || '').slice(6)) || 0;
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
mkdirSync(out, { recursive: true });
const port = 6500 + Math.floor(Math.random() * 300);
const server = await createServer({ root: process.cwd(), server: { port, strictPort: true }, logLevel: 'error' });
await server.listen();
const errors = [];
const fails = [];
let T0 = Date.now();
const log = (k, v) => console.log(`[${((Date.now() - T0) / 1000).toFixed(0).padStart(3)}s] ${String(k).padEnd(15)}`, typeof v === 'string' ? v : JSON.stringify(v));
const check = (ok, what, detail) => {
  if (!ok) fails.push(`${what}${detail !== undefined ? ` :: ${JSON.stringify(detail)}` : ''}`);
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
};

let browser;
let context;
async function open(tag, query) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}\n${e.stack}`));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('GPU stall')) errors.push(`[${tag}] ${m.text()}`); });
  const q = query ?? `?duel=local${LAG ? `&lag=${LAG}&jitter=${Math.round(LAG / 3)}` : ''}`;
  await page.goto(`http://localhost:${port}/${q}`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.evaluate(() => window.__game.setLoop(false));
  return page;
}
async function session(name, fn, query, optIn = false) {
  if (ONLY.length ? !ONLY.includes(name) : optIn) return;
  console.log(`\n== ${name}`);
  T0 = Date.now();
  try {
    // PW_EXE: a Chromium binary to use instead of installed Chrome (e.g. /opt/pw-browsers/chromium).
    browser = await chromium.launch({ ...(process.env.PW_EXE ? { executablePath: process.env.PW_EXE } : { channel: 'chrome' }), headless: true, args: [process.env.PROBE_GPU === '0' ? '--use-angle=swiftshader' : '--use-angle=metal', '--enable-unsafe-swiftshader'] });
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const host = await open('host', query);
    const guest = await open('guest', query);
    await setupGarages(host, guest);
    await fn(host, guest);
  } catch (e) {
    errors.push(`[${name}] ${e.stack || e}`);
  } finally {
    await browser?.close().catch(() => {});
  }
}

const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.evaluate(() => window.__game.setLoop(true));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}.png` });
  await page.evaluate(() => window.__game.setLoop(false));
};
const st = (page) => page.evaluate(() => window.__game.duel.debugState());
/** Advance both sims `secs` in lockstep, in short alternating slices so messages flow between them. */
async function run(host, guest, secs, slice = 4) {
  const frames = Math.round(secs * 60);
  for (let f = 0; f < frames; f += slice) {
    await host.evaluate((n) => { for (let i = 0; i < n; i++) window.__game.tick(1 / 60); }, slice);
    await guest.evaluate((n) => { for (let i = 0; i < n; i++) window.__game.tick(1 / 60); }, slice);
    if (LAG) await host.waitForTimeout(2);
  }
}
async function until(host, guest, pred, maxSecs, step = 0.5) {
  for (let t = 0; t < maxSecs; t += step) {
    const [h, g] = await Promise.all([st(host), st(guest)]);
    if (pred(h, g)) return [h, g];
    await run(host, guest, step);
    // Let real-time transport delays (the lag option) catch up too.
    await host.waitForTimeout(LAG ? 60 : 5);
  }
  return Promise.all([st(host), st(guest)]);
}

/** Two different garages, in memory only (both pages share one localStorage). */
const EQUAL = process.env.DUEL_EQUAL === '1';
async function setupGarages(host, guest, hostPlow = process.env.DUEL_HOST_PLOW || 'volt', guestPlow = process.env.DUEL_GUEST_PLOW || 'brute') {
  await host.evaluate(([plow, equal]) => {
    const p = window.__game.ctx.progression;
    p.data.plow = plow;
    p.data.coins = equal ? 0 : 1500;
    p.data.upgrades = equal ? {} : { engine: 6, armor: 6, packedIce: 6, hopper: 5, compactor: 5, nitro: 4, whirl: 4, voltClap: 3, plating: 3, voltCell: 2, ramSpikes: 4 };
    Object.assign(window.__game.duel.cfg, { garageSeconds: 30, rematchGarageSeconds: 20, roundSeconds: 22, betweenRounds: 1.5 });
    window.__game.duel.playerName = 'HostHank';
  }, [hostPlow, EQUAL]);
  await guest.evaluate((plow) => {
    const p = window.__game.ctx.progression;
    p.data.plow = plow;
    p.data.coins = 0;
    p.data.upgrades = {};
    window.__game.duel.playerName = 'GuestGina';
  }, guestPlow);
}

/** Quick connect through the Game API (the lobby session covers the DOM path). */
async function connect(host, guest) {
  const code = await host.evaluate(async () => { window.__game.openDuelLobby(); return window.__game.hostDuel(); });
  await guest.evaluate(async (c) => { window.__game.openDuelLobby(); return window.__game.joinDuel(c); }, code);
  const [h, g] = await until(host, guest, (h, g) => h.phase === 'garage' && g.phase === 'garage', 6, 0.1);
  check(h.phase === 'garage' && g.phase === 'garage', 'connected: both in the duel garage', [h.phase, g.phase]);
  return code;
}
/** Guest buys some catch-up levels so the fight is closer, both READY, run to FIGHT. */
async function toFight(host, guest) {
  if (!EQUAL) await guest.evaluate(() => { const w = window.__game.duel.wallet; for (const id of ['armor', 'armor', 'armor', 'armor', 'packedIce', 'packedIce', 'packedIce', 'packedIce', 'packedIce', 'engine', 'engine', 'brutePound', 'brutePound', 'brutePound', 'hopper', 'hopper', 'hopper']) w?.buy(id); });
  await host.evaluate(() => window.__game.duel.setReady());
  await guest.evaluate(() => window.__game.duel.setReady());
  return until(host, guest, (h, g) => h.phase === 'fight' && g.phase === 'fight', 8, 0.25);
}
const autopilot = (host, guest, on) => Promise.all([host, guest].map((p) => p.evaluate((v) => (window.__game.duel.autopilot = v), on)));
/** Stop the sticks for a moment so both screens settle, then compare HP / score. */
async function syncCheck(host, guest, label) {
  await autopilot(host, guest, false);
  await run(host, guest, 1);
  // The guest shows the opponent ~100 ms behind; while lingering damage (storms, fallout pools, burns) still ticks,
  // HP moves inside that window, so allow a few settles.
  let a, b, ok = false;
  for (let k = 0; k < 6 && !ok; k++) {
    if (k) await run(host, guest, 0.5);
    [a, b] = await Promise.all([st(host), st(guest)]);
    const tol = (i) => Math.max(2, 0.03 * (a.maxHp[i] || 100));
    ok = Math.abs(a.hp[0] - b.hp[0]) <= tol(0) && Math.abs(a.hp[1] - b.hp[1]) <= tol(1) && a.score.join() === b.score.join();
  }
  log(`sync ${label}`, { host: { hp: a.hp, score: a.score, phase: a.phase }, guest: { hp: b.hp, score: b.score, phase: b.phase, rtt: b.rtt } });
  check(ok, `both sides agree on HP + score (${label})`, { host: [a.hp, a.score], guest: [b.hp, b.score] });
  await autopilot(host, guest, true);
  return [a, b];
}

// ================================================================== lobby + duel garage
await session('lobby', async (host, guest) => {
  await host.locator('.ss-duel-menu').click();
  await shot(host, '01-host-lobby');
  await host.locator('.ss-duel-host').click();
  await host.waitForSelector('.ss-duel-code-big:not(:empty)', { timeout: 5000 });
  const code = (await host.locator('.ss-duel-code-big').textContent()).trim();
  log('room code', code);
  check(/^[A-Z]{5}$/.test(code), 'room code is 5 unambiguous letters', code);
  await shot(host, '02-host-hosting');
  // A wrong code first: a clear "not found".
  await guest.locator('.ss-duel-menu').click();
  await guest.locator('input.ss-duel-code').fill(code === 'AAAAA' ? 'CCCCC' : 'AAAAA');
  await guest.locator('.ss-duel-join').click();
  await guest.waitForTimeout(1900);
  const nf = await guest.locator('.ss-duel-status').textContent();
  log('bad code', nf);
  check(/not found/i.test(nf), 'joining a missing room says "not found"', nf);
  await shot(guest, '03-guest-notfound');
  await guest.locator('input.ss-duel-code').fill(code.toLowerCase());
  await guest.locator('.ss-duel-join').click();
  let [h, g] = await until(host, guest, (h, g) => h.phase === 'garage' && g.phase === 'garage', 4, 0.2);
  log('garage', { host: { bonus: h.bonus, power: h.power }, guest: { bonus: g.bonus, power: g.power } });
  check(h.phase === 'garage' && g.phase === 'garage', 'both sides reach the DUEL GARAGE', [h.phase, g.phase]);
  check(h.bonus[0] === 0 && h.bonus[1] > 0 && h.bonus[1] === g.bonus[1], 'only the weaker guest gets catch-up coins (both agree)', h.bonus);
  check(h.bonus[1] === Math.min(50000, h.power[0] - h.power[1]), 'catch-up = the garage-power gap', { bonus: h.bonus, power: h.power });
  const sub = await guest.locator('.ss-shop-sub').textContent();
  log('garage line', sub);
  check(/Opponent garage: [\d,]+ · Yours: [\d,]+ · Catch-up: \+[\d,]+/.test(sub), 'garage shows "Opponent garage: X · Yours: Y · Catch-up: +Z"', sub);
  // Guest spends catch-up coins: a real click, then the rest through the same buttons.
  await guest.locator('.ss-tab-defense').click();
  await guest.locator('.ss-card[data-id="armor"] .ss-buy').click();
  await guest.evaluate(() => {
    const buy = (id, n) => { for (let i = 0; i < n; i++) document.querySelector(`.ss-card[data-id="${id}"] .ss-buy`).click(); };
    buy('armor', 5); buy('engine', 4); buy('packedIce', 6); buy('brutePound', 4);
  });
  const gw = await guest.evaluate(() => {
    const d = window.__game.duel, p = window.__game.ctx.progression;
    return { temp: d.wallet.tempLevels(), bonusLeft: d.wallet.bonus, saved: { ...p.data.upgrades }, coins: p.coins, giftButtons: document.querySelectorAll('.ss-buy.ss-bonus-buy').length };
  });
  log('guest wallet', gw);
  check(gw.temp.armor === 6 && gw.temp.engine === 4 && gw.temp.packedIce === 6 && gw.temp.brutePound === 4, 'guest bought armour / engine / packed ice / ground pound with catch-up coins', gw.temp);
  check(!gw.saved.armor && !gw.saved.engine && gw.coins === 0, 'temp levels never touch the guest save', gw.saved);
  await shot(guest, '04-guest-garage');
  await shot(host, '05-host-garage');
  const preMatchMaxHp = await guest.evaluate(() => window.__game.ctx.progression.computeStats().maxHp);
  await run(host, guest, 0.3);
  await guest.locator('.ss-duel-ready').click();
  await run(host, guest, 0.3);
  check((await st(host)).ready[1] === true, 'host sees the guest READY');
  await host.locator('.ss-duel-ready').click();
  [h, g] = await until(host, guest, (h, g) => h.phase === 'countdown' && g.phase === 'countdown', 6, 0.25);
  log('match stats', { host: h.stats, guest: g.stats });
  check(h.stats[1] && h.stats[1].maxHp > preMatchMaxHp * 1.5 && h.stats[1].plowKind === 'brute', 'host computes the guest stats WITH the catch-up levels', { hostSees: h.stats[1], preMatchMaxHp });
  const kept = await guest.evaluate(() => ({ ...window.__game.ctx.progression.data.upgrades }));
  check(kept.armor === 6 && kept.engine === 4 && kept.packedIce === 6 && kept.brutePound === 4, 'catch-up levels are saved to the guest garage once the match starts', kept);
  check(h.levels[1]?.armor === 6 && h.levels[1]?.brutePound === 4, 'host received the guest final effective levels', h.levels[1]);
  check(JSON.stringify(h.stats) === JSON.stringify(g.stats), 'both sides fight with identical stats');
  check(Math.abs(h.maxHp[1] - h.stats[1].maxHp) < 0.01 && Math.abs(g.maxHp[1] - h.stats[1].maxHp) < 0.01, 'guest plow max HP matches on both screens', [h.maxHp, g.maxHp]);
  await run(host, guest, 1);
  await shot(guest, '06-guest-countdown');
});

// ================================================================== best of 3
await session('match', async (host, guest) => {
  await connect(host, guest);
  let [h, g] = await toFight(host, guest);
  check(h.phase === 'fight' && g.phase === 'fight', 'countdown ends in FIGHT on both', [h.phase, g.phase]);
  // F abilities, player vs player: the guest's Ground Pound (guest keyboard), then the host's Thunderclap.
  const fTest = async (who, label, victim) => {
    await host.evaluate(() => { const me = window.__game.ctx.plow, op = window.__game.duel.opponent; me.position.set(0, 0, 3); me.heading = Math.PI; op.position.set(0, 0, -3); op.heading = 0; });
    await run(host, guest, 0.3);
    const before = await host.evaluate(() => ({ hp: [window.__game.ctx.plow.hp, window.__game.duel.opponent.hp], other: window.__game.duel.counters.bySource.map((b) => b[3]) }));
    const page = who === 0 ? host : guest;
    await page.keyboard.down('KeyF');
    await run(host, guest, 0.1, 2);
    await page.keyboard.up('KeyF');
    await run(host, guest, 0.9);
    const after = await host.evaluate(() => ({ hp: [window.__game.ctx.plow.hp, window.__game.duel.opponent.hp], other: window.__game.duel.counters.bySource.map((b) => b[3]), ab: window.__game.duel.counters.abilities }));
    log(label, { hpBefore: before.hp.map(Math.round), hpAfter: after.hp.map(Math.round), abilityHits: after.other, abilities: after.ab });
    check(after.other[who] > before.other[who] && after.hp[victim] < before.hp[victim], `${label} hits the other player`, { before, after });
  };
  await fTest(1, 'Ground Pound (guest F)', 0);
  await fTest(0, 'Thunderclap (host F)', 1);
  await autopilot(host, guest, true);
  await run(host, guest, 3);
  await shot(host, '07-host-fight');
  await shot(guest, '08-guest-fight');
  await syncCheck(host, guest, 'mid round 1');
  [h, g] = await until(host, guest, (h) => h.score[0] + h.score[1] >= 1, 30, 1);
  log('round 1 over', { round: h.round, score: h.score, phase: h.phase });
  check(h.score[0] + h.score[1] >= 1, 'a round ends and the score advances', h.score);
  await run(host, guest, 0.3);
  await shot(guest, '09-guest-round-end');
  [h, g] = await until(host, guest, (h, g) => h.phase === 'results' && g.phase === 'results', 110, 1);
  const c = await host.evaluate(() => window.__game.duel.counters);
  const gc = await guest.evaluate(() => window.__game.duel.counters);
  log('match', { score: h.score, guestScore: g.score, rounds: h.round });
  log('host counters', c);
  log('guest counters', { snapsRecv: gc.snapsRecv, snowMsgs: gc.snowMsgs, snowKB: Math.round(gc.snowBytes / 1024), eventsRecv: gc.eventsRecv, hits: gc.hits, inputsSentApprox: c.inputsRecv });
  check(h.phase === 'results' && g.phase === 'results', 'the match ends on both sides', [h.phase, g.phase]);
  check(Math.max(...h.score) >= 2 && h.score.join() === g.score.join(), 'best of 3: a side reached 2, scores agree', [h.score, g.score]);
  check(c.hits[0] > 0 && c.hits[1] > 0, 'both plows dealt damage to each other', c.hits);
  check(c.slams[0] + c.slams[1] > 0, 'slams were thrown', c.slams);
  check(c.abilities[0] > 0 && c.abilities[1] > 0, 'both used their F ability (Thunderclap / Ground Pound)', c.abilities);
  check(c.maxHitFrac <= 0.72, 'no single hit takes more than the Brawl cap of max HP', c.maxHitFrac);
  check(gc.eventsRecv > 0 && gc.snapsRecv > 50 && gc.snowMsgs > 10, 'guest received events, snapshots and snow patches', gc);
  await shot(host, '10-host-results');
  await shot(guest, '11-guest-results');
});

// ================================================================== rematch, NUKE, Inferno, pause, leave
await session('rematch', async (host, guest) => {
  await connect(host, guest);
  await toFight(host, guest);
  // Skip to the result: the host wrecks the guest twice (host authoritative), rounds tick over.
  for (let r = 0; r < 2; r++) {
    await until(host, guest, (h) => h.phase === 'fight', 6, 0.25);
    await host.evaluate(() => { const d = window.__game.duel; d.opponent.spawnProt = 0; d.opponent.damage(99999); });
    await run(host, guest, 3.6);
  }
  let [h, g] = await until(host, guest, (h, g) => h.phase === 'results' && g.phase === 'results', 6, 0.25);
  check(h.phase === 'results' && g.phase === 'results' && h.score.join() === '2,0' && g.score.join() === '2,0', 'two wrecks -> 2-0 result on both', [h.score, g.score]);
  await host.evaluate(() => { window.__game.ctx.progression.data.plow = 'classic'; });
  await guest.evaluate(() => { window.__game.ctx.progression.data.plow = 'isotope'; });
  await guest.locator('.ss-duel-rematch').click();
  await run(host, guest, 0.4);
  const note = await host.locator('.ss-duel-rnote').textContent();
  check(/wants a rematch/i.test(note), 'host is told the guest wants a rematch', note);
  check((await st(host)).phase === 'results', 'one side asking is not enough');
  await host.locator('.ss-duel-rematch').click();
  [h, g] = await until(host, guest, (h, g) => h.phase === 'garage' && g.phase === 'garage', 4, 0.2);
  check(h.phase === 'garage' && g.phase === 'garage', 'REMATCH (both accepted) opens a fresh duel garage', [h.phase, g.phase]);
  check(h.bonus[1] > 0 && g.score.join() === '0,0', 'catch-up recomputed for the rematch, score reset', { bonus: h.bonus, score: g.score });
  await host.evaluate(() => window.__game.duel.setReady());
  await guest.evaluate(() => window.__game.duel.setReady());
  [h, g] = await until(host, guest, (h, g) => h.phase === 'fight' && g.phase === 'fight', 8, 0.25);
  check(h.stats[0].plowKind === 'classic' && h.stats[1].plowKind === 'isotope' && h.round === 1, 'rematch round 1 with the new plows', h.stats.map((s) => s.plowKind));
  // Meltdown (guest F, Critical Mass empty) on the host.
  {
    await host.evaluate(() => { const me = window.__game.ctx.plow, op = window.__game.duel.opponent; me.position.set(0, 0, 3); op.position.set(0, 0, -3); window.__game.duel.opponentCombat.critCharge = 0; });
    await run(host, guest, 0.3);
    const b0 = await host.evaluate(() => ({ hp: window.__game.ctx.plow.hp, other: window.__game.duel.counters.bySource[1][3] }));
    await guest.keyboard.down('KeyF');
    await run(host, guest, 0.1, 2);
    await guest.keyboard.up('KeyF');
    await run(host, guest, 0.8);
    const b1 = await host.evaluate(() => ({ hp: window.__game.ctx.plow.hp, other: window.__game.duel.counters.bySource[1][3], melt: window.__game.duel.opponentCombat.meltCharge }));
    log('meltdown', { hp: [Math.round(b0.hp), Math.round(b1.hp)], hits: [b0.other, b1.other], meltCharge: +b1.melt.toFixed(2) });
    check(b1.other > b0.other && b1.hp < b0.hp && b1.melt < 1, 'Meltdown (guest F) hits the host', { b0, b1 });
    await run(host, guest, 1.5);
  }
  // Arm the guest's Critical Mass on the host (authoritative) so its next F is the NUKE; park the plows close.
  const hp0 = await host.evaluate(() => {
    const d = window.__game.duel, me = window.__game.ctx.plow, op = d.opponent;
    me.position.set(0, 0, 4); op.position.set(0, 0, -4);
    d.opponentCombat.critCharge = 1;
    return me.hp;
  });
  await run(host, guest, 0.5);
  await guest.keyboard.down('KeyF');
  await run(host, guest, 0.1, 2);
  await guest.keyboard.up('KeyF');
  await run(host, guest, 0.4);
  const nuke = await host.evaluate((hp0) => ({ nukes: window.__game.duel.counters.nukes, hostHpLost: Math.round(hp0 - window.__game.ctx.plow.hp), maxHp: window.__game.ctx.plow.maxHp }), hp0);
  log('nuke', nuke);
  check(nuke.nukes[1] >= 1, 'a NUKE pressed on the guest keyboard fires on the host', nuke);
  check(nuke.hostHpLost > 0 && nuke.hostHpLost < nuke.maxHp, 'the NUKE hurts the host without one-shotting', nuke);
  await shot(guest, '12-guest-nuke');
  await shot(host, '13-host-nuke');
  // Inferno from the host keyboard, aimed at the guest.
  await host.evaluate(() => { const me = window.__game.ctx.plow, op = window.__game.duel.opponent; me.position.set(0, 0, 4); me.heading = Math.PI; op.position.set(0, 0, -3); });
  const gHp0 = (await st(host)).hp[1];
  await host.keyboard.down('KeyF');
  await run(host, guest, 0.1, 2);
  await host.keyboard.up('KeyF');
  await run(host, guest, 0.5);
  await shot(guest, '14-guest-sees-inferno');
  await run(host, guest, 0.6);
  const fire = await st(host);
  const ab = await host.evaluate(() => window.__game.duel.counters);
  log('inferno', { abilities: ab.abilities, guestHp: [gHp0, fire.hp[1]] });
  check(ab.abilities[0] >= 1 && fire.hp[1] < gHp0, 'host Inferno (keyboard) burns the guest', { abilities: ab.abilities, hp: [gHp0, fire.hp[1]] });
  await syncCheck(host, guest, 'rematch');
  // Pause doesn't freeze an online duel; LEAVE ends it for both.
  const t0 = (await st(host)).timer;
  await guest.keyboard.press('Escape');
  await run(host, guest, 1);
  const paused = await Promise.all([st(host), guest.evaluate(() => ({ menu: window.__game.duel.menuOpen, state: window.__game.state }))]);
  check(paused[1].menu && paused[0].timer < t0 - 0.5, 'guest pause menu is up and the match clock keeps running', { t0, t1: paused[0].timer });
  await shot(guest, '15-guest-pause');
  await guest.locator('button:visible', { hasText: 'LEAVE DUEL' }).click();
  await run(host, guest, 0.5);
  const left = await Promise.all([
    host.evaluate(() => ({ state: window.__game.state, active: window.__game.duel.active, status: document.querySelector('.ss-duel-status')?.textContent })),
    guest.evaluate(() => ({ state: window.__game.state, active: window.__game.duel.active })),
  ]);
  log('leave', left);
  check(left[1].state === 'menu' && !left[1].active, 'guest is back at the menu');
  check(left[0].state === 'menu' && !left[0].active && /left/i.test(left[0].status || ''), 'host is told the opponent left', left[0]);
  await shot(host, '16-host-opponent-left');
  const sp = await host.evaluate(() => { const g = window.__game; g.ctx.ui.hideOverlays(); g.ui.duel.closeLobby(); g.startRun(0); for (let i = 0; i < 260; i++) g.tick(1 / 60); return { state: g.state, enemies: g.ctx.enemies.aliveCount(), opp: !!g.duel.opponent?.object.visible, statsKind: g.ctx.stats.plowKind }; });
  log('campaign after', sp);
  check(sp.state === 'playing' && !sp.opp && sp.statsKind === 'classic', 'campaign runs normally after a duel (second plow hidden, save stats back)', sp);
});

// ================================================================== ARSENAL: held fire over the wire
await session('arsenal', async (host, guest) => {
  for (const pg of [host, guest]) await pg.evaluate(() => { window.__game.ctx.progression.data.plow = 'arsenal'; });
  await connect(host, guest);
  await toFight(host, guest);
  const [h] = await until(host, guest, (h, g) => h.phase === 'fight' && g.phase === 'fight', 8, 0.25);
  check(h.stats[0].plowKind === 'arsenal' && h.stats[1].plowKind === 'arsenal', 'both drive ARSENAL', h.stats.map((s) => s.plowKind));
  // Guest at (8, -4) facing +z; host at (0, 4): 45° off the guest's nose (outside the old ±25° lock).
  const park = () => host.evaluate(() => {
    const me = window.__game.ctx.plow, op = window.__game.duel.opponent;
    me.position.set(0, 0, 4); me.heading = Math.PI; me.hp = me.maxHp;
    op.position.set(8, 0, -4); op.heading = 0; op.hp = op.maxHp;
  });
  const hostHits = () => host.evaluate(() => ({ other: window.__game.duel.counters.bySource[1][3], hp: window.__game.ctx.plow.hp }));
  await park();
  await run(host, guest, 0.5);
  let b0 = await hostHits();
  await guest.keyboard.down('Space');
  await run(host, guest, 1.0);
  const aim = await guest.evaluate(() => window.__game.ctx.plow.turretAim);
  await run(host, guest, 1.0);
  await guest.keyboard.up('Space');
  await run(host, guest, 0.3);
  let b1 = await hostHits();
  log('guest autocannon (held 2s)', { rounds: b1.other - b0.other, hostHp: [Math.round(b0.hp), Math.round(b1.hp)], guestTurret: +aim.toFixed(2) });
  check(b1.other - b0.other >= 10, 'guest holding SPACE keeps the autocannon firing on the host (not a 0.5 s burst)', { b0, b1 });
  check(Math.abs(aim + Math.PI / 4) < 0.35, "the guest's own turret follows the host's aim, 45° off the nose", aim);
  // A single tap is still a short burst.
  await park();
  await run(host, guest, 0.3);
  b0 = await hostHits();
  await guest.keyboard.press('Space');
  await run(host, guest, 1.5);
  b1 = await hostHits();
  check(b1.other - b0.other >= 1 && b1.other - b0.other <= 6, 'a tap fires a short burst', { b0, b1 });
  // Host fires: the guest's puppet shows the guns, then the laser.
  await park();
  await host.keyboard.down('Space');
  await run(host, guest, 0.6);
  const seen = await guest.evaluate(() => ({ fire: window.__game.duel.opponentCombat.netFire, turret: window.__game.duel.opponentCombat.netTurret }));
  await host.keyboard.up('Space');
  check((seen.fire & 1) === 1, "the guest sees the host's autocannon firing", seen);
  // Host laser with the guest ~20° off the host's nose: the beam bends, and the guest draws the same bend.
  await host.evaluate(() => { const op = window.__game.duel.opponent; op.position.set(-3, 0, -4); });
  await run(host, guest, 0.2);
  await host.keyboard.press('KeyE');
  await run(host, guest, 0.6);
  const laser = await guest.evaluate(() => ({ t: window.__game.duel.opponentCombat.laserT, off: window.__game.duel.opponentCombat.laserOff }));
  const hostOff = await host.evaluate(() => window.__game.ctx.combat.laserOff);
  check(laser.t > 0, "the guest sees the host's laser", laser);
  check(Math.abs(hostOff) > 0.1 && Math.abs(laser.off - hostOff) < 0.15, "the guest's view of the host laser bends like the host's", { hostOff, guest: laser.off });
  await shot(guest, '17-guest-sees-arsenal');
  await run(host, guest, 1.5);
  // Guest laser + missiles land on the host. Face the host straight on for the laser.
  await park();
  await host.evaluate(() => { const op = window.__game.duel.opponent; op.position.set(0, 0, -6); op.heading = 0; });
  await run(host, guest, 0.5);
  b0 = await hostHits();
  await guest.keyboard.press('KeyE');
  await run(host, guest, 1.2);
  b1 = await hostHits();
  check(b1.other > b0.other && b1.hp < b0.hp, 'guest laser (E) burns the host', { b0, b1 });
  await park();
  await run(host, guest, 0.3);
  b0 = await hostHits();
  await guest.keyboard.press('KeyF');
  await run(host, guest, 2.5);
  b1 = await hostHits();
  check(b1.other > b0.other && b1.hp < b0.hp, 'guest missiles (F) home in on the host', { b0, b1 });
  await syncCheck(host, guest, 'arsenal');
}, undefined, false);

// ================================================================== real time over a bad link
/** Wait in real time (pages run their own render loops) until `pred` holds. */
async function waitRT(host, guest, pred, maxSecs, step = 0.25) {
  for (let t = 0; t < maxSecs; t += step) {
    const [h, g] = await Promise.all([st(host), st(guest)]);
    if (pred(h, g)) return [h, g];
    await host.waitForTimeout(step * 1000);
  }
  return Promise.all([st(host), st(guest)]);
}
/** A short real-time fight with both render loops running, then the netcode numbers. */
async function realtimeFight(host, guest, label, secs) {
  for (const pg of [host, guest]) await pg.evaluate(() => window.__game.setLoop(true));
  let [h, g] = await waitRT(host, guest, (h, g) => h.phase === 'fight' && g.phase === 'fight', 8);
  check(h.phase === 'fight' && g.phase === 'fight', `${label}: FIGHT on both`, [h.phase, g.phase]);
  await autopilot(host, guest, true);
  await host.waitForTimeout(secs * 1000);
  await host.screenshot({ path: `${out}/${label}-host.png` }).catch(() => {});
  await guest.screenshot({ path: `${out}/${label}-guest.png` }).catch(() => {});
  await autopilot(host, guest, false);
  let ok = false;
  for (let k = 0; k < 8 && !ok; k++) {
    await host.waitForTimeout(400);
    [h, g] = await Promise.all([st(host), st(guest)]);
    ok = Math.abs(h.hp[0] - g.hp[0]) <= Math.max(2, 0.03 * h.maxHp[0]) && Math.abs(h.hp[1] - g.hp[1]) <= Math.max(2, 0.03 * h.maxHp[1]) && h.score.join() === g.score.join();
  }
  const c = await host.evaluate(() => window.__game.duel.counters);
  const gc = await guest.evaluate(() => window.__game.duel.counters);
  const net = {
    rttMs: g.rtt, snapsPerSec: +(gc.snapsRecv / Math.max(1, secs + 4)).toFixed(1), hits: c.hits, abilities: c.abilities,
    predErrAvgM: +(gc.predErrSum / Math.max(1, gc.predErrN)).toFixed(3), predErrMaxM: +gc.predErrMax.toFixed(2), predSnaps: gc.predSnaps,
    snowKBps: +((gc.snowBytes / 1024) / Math.max(1, secs + 4)).toFixed(1),
  };
  log(`${label} net`, net);
  log(`${label} sync`, { host: { hp: h.hp, score: h.score }, guest: { hp: g.hp, score: g.score } });
  check(ok, `${label}: both sides agree on HP + score`, { host: [h.hp, h.score], guest: [g.hp, g.score] });
  check(c.hits[0] + c.hits[1] > 0, `${label}: the plows hit each other`, c.hits);
  return net;
}

await session('realtime', async (host, guest) => {
  await host.evaluate(() => Object.assign(window.__game.duel.cfg, { countdown: 2 }));
  for (const pg of [host, guest]) await pg.evaluate(() => window.__game.setLoop(true));
  await connect(host, guest);
  await host.evaluate(() => window.__game.duel.setReady());
  await guest.evaluate(() => window.__game.duel.setReady());
  const net = await realtimeFight(host, guest, 'lag80', 7);
  check(net.predErrAvgM < 1.5, 'lag80: guest prediction stays close to the host (avg error < 1.5 m)', net);
}, '?duel=local&lag=80&jitter=30&loss=0.05');

// Opt-in (--only=peer): a real PeerJS connection through the public cloud server, two pages on this machine.
await session('peer', async (host, guest) => {
  await host.evaluate(() => Object.assign(window.__game.duel.cfg, { countdown: 2 }));
  for (const pg of [host, guest]) await pg.evaluate(() => window.__game.setLoop(true));
  const t0 = Date.now();
  const code = await host.evaluate(async () => { window.__game.openDuelLobby(); return window.__game.hostDuel(); });
  log('peer room', { code, ms: Date.now() - t0, status: await host.locator('.ss-duel-status').textContent() });
  check(!!code, 'PeerJS: host registered a room on the public server', code);
  if (!code) return;
  const t1 = Date.now();
  const joined = await guest.evaluate(async (c) => { window.__game.openDuelLobby(); return window.__game.joinDuel(c); }, code);
  log('peer join', { joined, ms: Date.now() - t1, status: await guest.locator('.ss-duel-status').textContent() });
  check(joined, 'PeerJS: guest connected over WebRTC', joined);
  if (!joined) return;
  const [h, g] = await waitRT(host, guest, (h, g) => h.phase === 'garage' && g.phase === 'garage', 6);
  check(h.phase === 'garage' && g.phase === 'garage', 'PeerJS: handshake reached the duel garage', [h.phase, g.phase]);
  await host.evaluate(() => window.__game.duel.setReady());
  await guest.evaluate(() => window.__game.duel.setReady());
  await realtimeFight(host, guest, 'peerjs', 5);
  // Not found over PeerJS.
  const bad = await guest.evaluate(async () => { const g = window.__game; g.toMenu(); g.openDuelLobby(); await g.joinDuel('QQQQQ'); return document.querySelector('.ss-duel-status').textContent; });
  log('peer bad code', bad);
  check(/not found/i.test(bad), 'PeerJS: a missing room says "not found"', bad);
}, '?', true);

if (errors.length) console.log(`\nERRORS:\n${errors.join('\n')}`);
else console.log('\nNO CONSOLE ERRORS');
console.log(fails.length ? `\n${fails.length} FAILED CHECK(S):\n  ${fails.join('\n  ')}` : '\nALL CHECKS PASSED');
if (SHOTS) console.log(`screenshots in ${out}`);
await server.close();
process.exit(errors.length || fails.length ? 1 : 0);
