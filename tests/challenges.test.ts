import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Progression } from '../src/core/Progression';
import { ZONES } from '../src/config/zones';
import { CHALLENGES, HARD, type ChallengeRun } from '../src/config/challenges';
import {
  ChallengeTracker, awardRun, evaluateRun, hardCleared, hardPower, hardReward, hardScale, hardUnlocked, hardZone, lastChallengeReport, maxStars,
  recordHardClear, starReward, starString, zoneChallenges, zoneStars,
} from '../src/meta/challenges';
import { EventBus, type GameEvents } from '../src/core/events';
import type { EnemyHandle, GameContext } from '../src/core/types';
import { totalStars } from '../src/meta/progress';

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});
afterEach(() => vi.unstubAllGlobals());

/** A won campaign run in `zoneIndex` that meets nothing special unless overridden. */
function run(zoneIndex: number, over: Partial<ChallengeRun> = {}): ChallengeRun {
  return {
    mode: 'campaign', plow: 'classic', won: true, kills: 10, killsBy: { slam: 0, ram: 0, whirl: 0, other: 10 },
    coins: 100, bestCombo: 2, biggestBall: 0.3, duration: 9999, damageTaken: 9999, zoneIndex, roundsCleared: 4, hard: false,
    bossTime: 9999, bossDamage: 9999, strikes: 0,
    ...over,
  };
}

const ids = (rep: ReturnType<typeof evaluateRun>) => rep!.results.filter((r) => r.met).map((r) => r.def.id);

describe('challenge definitions', () => {
  it('every arena has exactly five challenges with unique ids', () => {
    for (const z of ZONES) {
      const list = CHALLENGES[z.id];
      expect(list, z.id).toHaveLength(5);
      expect(new Set(list.map((c) => c.id)).size).toBe(5);
      for (const c of list) expect(c.goal.length, `${z.id}/${c.id}`).toBeLessThanOrEqual(22);
    }
    expect(maxStars()).toBe(ZONES.length * 5);
    expect(ZONES.length).toBe(6);
  });

  it('every plow signature mechanic has a star somewhere in the campaign', () => {
    const all = ZONES.flatMap((z) => CHALLENGES[z.id].map((c) => c.id));
    for (const id of ['rush', 'arc', 'laser', 'polarity', 'sing', 'soak', 'burn', 'plow-volt', 'plow-brute']) expect(all, id).toContain(id);
    // Signature goals that are not obvious explain themselves (zone card hover, results screen).
    for (const z of ZONES) for (const c of CHALLENGES[z.id]) if (['rush', 'arc', 'laser', 'polarity', 'sing', 'soak', 'burn'].includes(c.id)) expect(c.tip, c.id).toBeTruthy();
  });

  it('a plain win meets nothing; each crafted payload meets its own challenge', () => {
    expect(ids(evaluateRun(new Progression(), run(0)))).toEqual([]);
    const p = new Progression();
    expect(ids(evaluateRun(p, run(0, { killsBy: { slam: 3, ram: 0, whirl: 0, other: 0 } })))).toEqual(['slam']);
    expect(ids(evaluateRun(p, run(0, { biggestBall: 1.2 })))).toEqual(['ball']);
    expect(ids(evaluateRun(p, run(0, { duration: 59 })))).toEqual(['speed']);
    expect(ids(evaluateRun(p, run(0, { duration: 60 })))).toEqual([]);
    expect(ids(evaluateRun(p, run(1, { killsBy: { slam: 0, ram: 0, whirl: 0, other: 0, stomp: 0, airSlam: 0, lava: 3 } })))).toEqual(['lava']);
    // Any finishing blow on a bot standing in lava counts.
    expect(ids(evaluateRun(p, run(1, { lavaKills: 3 })))).toEqual(['lava']);
    expect(ids(evaluateRun(p, run(1, { lavaKills: 2 })))).toEqual([]);
    expect(ids(evaluateRun(p, run(1, { bestCombo: 99 })))).toEqual([]);
    expect(ids(evaluateRun(p, run(1, { damageTaken: 10 })))).toEqual(['hp']);
    expect(ids(evaluateRun(p, run(1, { bossTime: 14.9 })))).toEqual(['blitz']);
    expect(ids(evaluateRun(p, run(1, { bossTime: 15 })))).toEqual([]);
    expect(ids(evaluateRun(p, run(1, { bossTime: 0 })))).toEqual([]); // boss round never started
    expect(ids(evaluateRun(p, run(2, { airtime: 1.0 })))).toEqual(['air']);
    expect(ids(evaluateRun(p, run(2, { airtime: 0.99 })))).toEqual([]);
    expect(ids(evaluateRun(p, run(2, { killsBy: { slam: 0, ram: 0, whirl: 0, other: 0, stomp: 0, airSlam: 1, lava: 0 } })))).toEqual(['airSlam']);
    expect(ids(evaluateRun(p, run(2, { killsBy: { slam: 0, ram: 0, whirl: 0, other: 0, stomp: 1, airSlam: 0, lava: 0 } })))).toEqual(['airSlam']);
    expect(ids(evaluateRun(p, run(2, { killsBy: { slam: 0, ram: 10, whirl: 0, other: 0 } })))).toEqual([]);
    expect(ids(evaluateRun(p, run(2, { plow: 'volt' })))).toEqual([]);
    expect(ids(evaluateRun(p, run(2, { plow: 'volt', damageTaken: 99 })))).toEqual(['plow-volt']);
    expect(ids(evaluateRun(p, run(3, { killsBy: { slam: 0, ram: 0, whirl: 4, other: 0 } })))).toEqual(['whirl']);
    expect(ids(evaluateRun(p, run(3, { duration: 89 })))).toEqual(['speed']);
    expect(ids(evaluateRun(p, run(3, { duration: 90 })))).toEqual([]);
    // Golden Tower Plaza (slot 5 after the level-overhaul swap).
    expect(ids(evaluateRun(p, run(4, { strikes: 3 })))).toEqual(['strike']);
    expect(ids(evaluateRun(p, run(4, { bossDamage: 79 })))).toEqual(['bossHp']);
    expect(ids(evaluateRun(p, run(4, { bestCombo: 40 })))).toEqual(['combo']);
    // The Omega Works (slot 6). BRUTUS twist: the plow alone is not enough.
    // (The default payload loses 9999 HP: BRUTUS tanking that much earns Crash Test Dummy on its own.)
    expect(ids(evaluateRun(p, run(5, { plow: 'brute', damageTaken: 399 })))).toEqual([]);
    expect(ids(evaluateRun(p, run(5, { plow: 'brute', damageTaken: 399, killsBy: { slam: 0, ram: 12, whirl: 0, other: 0 } })))).toEqual(['plow-brute']);
    expect(ids(evaluateRun(p, run(5, { bossDamage: 0 })))).toEqual(['bossHp']);
    expect(ids(evaluateRun(p, run(5, { killsBy: { slam: 10, ram: 0, whirl: 0, other: 0 } })))).toEqual(['slam']);
  });

  it('the signature and second-wave goals: each crafted payload meets only its own', () => {
    const p = new Progression();
    const w = (weaponKills: ChallengeRun['weaponKills']) => ({ weaponKills });
    // Coldboot Glacier: Classic PLOW RUSH hits, a cool boss fight.
    expect(ids(evaluateRun(p, run(0, { rushHits: 8 })))).toEqual(['rush']);
    expect(ids(evaluateRun(p, run(0, { rushHits: 7 })))).toEqual([]);
    expect(ids(evaluateRun(p, run(0, { bossDamage: 39 })))).toEqual(['bossHp']);
    expect(ids(evaluateRun(p, run(0, { bossDamage: 40 })))).toEqual([]);
    // Inferno Quarry: ISOTOPE burn kills (only the radBurn tally counts), ram kills.
    expect(ids(evaluateRun(p, run(1, w({ radBurn: 10 }))))).toEqual(['burn']);
    expect(ids(evaluateRun(p, run(1, w({ radBurn: 9, arcLance: 50 }))))).toEqual([]);
    expect(ids(evaluateRun(p, run(1, { killsBy: { slam: 0, ram: 8, whirl: 0, other: 0 } })))).toEqual(['ram']);
    // Rust Basin: SINGULARITY kills, a quick GRINDER fight.
    expect(ids(evaluateRun(p, run(2, w({ singularity: 3 }))))).toEqual(['sing']);
    expect(ids(evaluateRun(p, run(2, w({ singularity: 2, polarity: 9 }))))).toEqual([]);
    expect(ids(evaluateRun(p, run(2, { bossTime: 29.9 })))).toEqual(['blitz']);
    expect(ids(evaluateRun(p, run(2, { bossTime: 30 })))).toEqual([]);
    // The Thermal Divide: Arc Lance and Polarity Burst kills.
    expect(ids(evaluateRun(p, run(3, w({ arcLance: 15 }))))).toEqual(['arc']);
    expect(ids(evaluateRun(p, run(3, w({ arcLance: 14 }))))).toEqual([]);
    expect(ids(evaluateRun(p, run(3, w({ polarity: 4 }))))).toEqual(['polarity']);
    expect(ids(evaluateRun(p, run(3, w({ polarity: 3, magLaser: 99 }))))).toEqual([]);
    // Golden Tower Plaza: Mag Laser kills, a 1:15 clear.
    expect(ids(evaluateRun(p, run(4, w({ magLaser: 25 }))))).toEqual(['laser']);
    expect(ids(evaluateRun(p, run(4, w({ magLaser: 24 }))))).toEqual([]);
    expect(ids(evaluateRun(p, run(4, { duration: 74 })))).toEqual(['speed']);
    expect(ids(evaluateRun(p, run(4, { duration: 75 })))).toEqual([]);
    // The Omega Works: BRUTUS tanks 400 HP (only BRUTUS), or any plow keeps it under 150.
    expect(ids(evaluateRun(p, run(5, { plow: 'brute', damageTaken: 400 })))).toEqual(['soak']);
    expect(ids(evaluateRun(p, run(5, { plow: 'isotope', damageTaken: 400 })))).toEqual([]);
    expect(ids(evaluateRun(p, run(5, { damageTaken: 149 })))).toEqual(['hp']);
    expect(ids(evaluateRun(p, run(5, { damageTaken: 150 })))).toEqual([]);
    // Missing extras (an old payload) meet nothing.
    expect(ids(evaluateRun(p, run(3, { weaponKills: undefined, rushHits: undefined })))).toEqual([]);
  });

  it('losses, other modes and missing arenas earn nothing', () => {
    const p = new Progression();
    const perfect = { duration: 1, damageTaken: 0, biggestBall: 9, killsBy: { slam: 99, ram: 99, whirl: 99, other: 0 } };
    const lost = evaluateRun(p, run(0, { ...perfect, won: false }))!;
    expect(lost.results.every((r) => !r.met && !r.isNew)).toBe(true);
    expect(lost.bonus).toBe(0);
    expect(evaluateRun(p, run(0, { ...perfect, mode: 'survival' }))).toBeNull();
    expect(evaluateRun(p, run(0, { zoneIndex: undefined }))).toBeNull();
  });

  it('hard runs count for the same stars', () => {
    expect(ids(evaluateRun(new Progression(), run(0, { hard: true, biggestBall: 2 })))).toEqual(['ball']);
  });
});

describe('star awards', () => {
  it('stars persist once and pay once', () => {
    const p = new Progression();
    const coins0 = p.coins;
    const first = awardRun(p, run(0, { biggestBall: 2, duration: 30 }))!;
    expect(first.newStars).toBe(2);
    expect(first.bonus).toBe(2 * starReward(0));
    expect(p.coins).toBe(coins0 + 2 * starReward(0));
    expect(p.data.challenges?.yard?.sort()).toEqual(['ball', 'speed']);
    expect(zoneStars(p, 0)).toBe(2);

    // Same goals again: no new stars, no coins; the owned flag still shows.
    const again = awardRun(p, run(0, { biggestBall: 2, duration: 30 }))!;
    expect(again.newStars).toBe(0);
    expect(again.bonus).toBe(0);
    expect(again.results.filter((r) => r.owned)).toHaveLength(2);
    expect(p.coins).toBe(coins0 + 2 * starReward(0));

    // The third one tops the arena up to 3 stars.
    const third = awardRun(p, run(0, { killsBy: { slam: 5, ram: 0, whirl: 0, other: 0 } }))!;
    expect(third.newStars).toBe(1);
    expect(third.stars).toBe(3);
    expect(totalStars(p)).toBe(3);
  });

  it('stars survive a save reload', () => {
    const p = new Progression();
    awardRun(p, run(2, { plow: 'volt', damageTaken: 50, airtime: 1.3 }));
    const q = new Progression();
    expect(zoneStars(q, 2)).toBe(2);
    expect(awardRun(q, run(2, { plow: 'volt', damageTaken: 50, airtime: 1.3 }))!.bonus).toBe(0);
  });

  it('star bonus scales with the arena', () => {
    for (let i = 1; i < ZONES.length; i++) expect(starReward(i)).toBeGreaterThan(starReward(i - 1));
    expect(starString(2)).toBe('★★☆');
    expect(starString(0)).toBe('☆☆☆');
    expect(zoneChallenges(99)).toEqual([]);
  });
});

describe('hard mode', () => {
  it('Hard scales with the pilot past mid-game: no change up to power 4, tougher late, capped', () => {
    expect(hardScale(0)).toEqual({ hp: 1, dmg: 1 });
    expect(hardScale(3.5)).toEqual({ hp: 1, dmg: 1 }); // a mid-game garage plays Hard as tuned
    const late = hardScale(9); // a late-game garage
    expect(late.hp).toBeCloseTo(1.75);
    expect(late.dmg).toBeCloseTo(1.4);
    expect(hardScale(100)).toEqual(hardScale(HARD.scaleFrom + HARD.scaleLevels)); // endless levels stop at the cap
    const z = ZONES[0];
    expect(hardZone(z, 9).enemyHpMult).toBeCloseTo(z.enemyHpMult * HARD.hpMult * late.hp);
    expect(hardZone(z, 9).enemyDmgMult).toBeCloseTo(HARD.dmgMult * late.dmg);
    // Power is a mean over the core four + the plow's own line, so a longer line doesn't count for more.
    expect(hardPower(() => 6, 'brute')).toBeCloseTo(6);
    expect(hardPower(() => 6, 'classic')).toBeCloseTo(6);
    expect(hardPower((id) => (id === 'engine' ? 8 : 0), 'classic')).toBeCloseTo(1);
  });

  it('hardZone: tougher, richer, more minions, same boss', () => {
    for (const z of ZONES) {
      const h = hardZone(z);
      expect(h.name).toBe(`${z.name} · HARD`);
      expect(h.id).toBe(z.id);
      expect(h.index).toBe(z.index);
      expect(h.enemyHpMult).toBeCloseTo(z.enemyHpMult * HARD.hpMult);
      expect(h.enemyDmgMult).toBeCloseTo(HARD.dmgMult);
      expect(h.coinMult).toBeCloseTo(z.coinMult * HARD.coinMult);
      expect(h.rounds).toHaveLength(z.rounds.length);
      const count = (zz: typeof z, boss: boolean) =>
        zz.rounds.filter((r) => !!r.boss === boss).reduce((n, r) => n + r.groups.reduce((m, g) => m + g.count, 0), 0);
      const extra = count(h, false) / count(z, false);
      expect(extra).toBeGreaterThanOrEqual(1.25);
      expect(extra).toBeLessThanOrEqual(1.45);
      const bossTypes = (zz: typeof z) => zz.rounds.filter((r) => r.boss).flatMap((r) => r.groups.map((g) => `${g.type}x${g.count}`));
      expect(bossTypes(h)).toEqual(bossTypes(z));
    }
    // The original arena is untouched.
    expect(ZONES[0].name).toBe('Coldboot Glacier');
    expect(ZONES[0].rounds[0].groups[0].count).toBe(3);
  });

  it('hard opens after the normal clear', () => {
    const p = new Progression();
    expect(hardUnlocked(p, 0)).toBe(false);
    p.recordRun(0, ZONES[0].rounds.length, true, 10);
    expect(hardUnlocked(p, 0)).toBe(true);
    expect(hardUnlocked(p, 1)).toBe(false);
    expect(hardUnlocked(p, 99)).toBe(false);
  });

  it('recordHardClear: first clear pays big, repeats pay less, and it persists', () => {
    const p = new Progression();
    const z = ZONES[1];
    expect(hardReward(p, 1)).toBe(Math.round(z.clearReward * HARD.firstClearMult));
    expect(recordHardClear(p, 1)).toBe(Math.round(z.clearReward * HARD.firstClearMult));
    expect(hardCleared(p, 1)).toBe(true);
    expect(p.data.hardCleared?.[z.id]).toBe(true);
    expect(recordHardClear(p, 1)).toBe(Math.round(z.clearReward * HARD.repeatClearMult));
    expect(new Progression().data.hardCleared?.[z.id]).toBe(true);
    expect(hardCleared(p, 0)).toBe(false);
  });
});

/* ------------------------------------------------------------------ tracker */

describe('ChallengeTracker: event tallies feed the stars', () => {
  const botHandle = { isBoss: false } as unknown as EnemyHandle;
  function tracker() {
    const events = new EventBus();
    const ctx = { events, time: 0, progression: new Progression(), ui: { toast: () => {} } } as unknown as GameContext;
    new ChallengeTracker(ctx);
    const finish = (zoneIndex: number, over: Partial<GameEvents['runFinished']> = {}) =>
      events.emit('runFinished', {
        mode: 'campaign', plow: 'classic', won: true, kills: 0, killsBy: { slam: 0, ram: 0, whirl: 0, other: 0, stomp: 0, airSlam: 0, lava: 0 },
        coins: 0, bestCombo: 0, biggestBall: 0, duration: 9999, damageTaken: 9999, zoneIndex, roundsCleared: 4, hard: false, ...over,
      });
    const kill = (weapon?: GameEvents['enemyKilled']['weapon']) => events.emit('enemyKilled', { enemy: botHandle, coins: 0, source: 'other', weapon });
    return { events, ctx, finish, kill };
  }

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('PLOW RUSH hits add up across rushes and earn Rush Hour', () => {
    const t = tracker();
    t.events.emit('roundStarted', { round: 1, total: 4, boss: false });
    for (const hits of [3, 0, 4, 1]) t.events.emit('plowRush', { hits });
    // A real win goes through the boss round; a scrappy one (50 HP lost there) misses Cold Shoulder.
    t.events.emit('roundStarted', { round: 4, total: 4, boss: true });
    t.events.emit('plowDamaged', { amount: 50, blocked: 0 });
    t.finish(0);
    const rep = lastChallengeReport()!;
    expect(rep.results.filter((r) => r.met).map((r) => r.def.id)).toEqual(['rush']);
    expect(rep.newStars).toBe(1);
  });

  it('kills are tallied per signature weapon; untagged kills count for none', () => {
    const t = tracker();
    t.events.emit('roundStarted', { round: 1, total: 4, boss: false });
    for (let i = 0; i < 15; i++) t.kill('arcLance');
    for (let i = 0; i < 3; i++) t.kill('polarity');
    for (let i = 0; i < 20; i++) t.kill();
    t.finish(3, { plow: 'volt' });
    expect(lastChallengeReport()!.results.filter((r) => r.met).map((r) => r.def.id)).toEqual(['arc']);
    // One more Polarity Burst kill next run: the tallies reset on a new run, so 1 is not enough.
    t.events.emit('roundStarted', { round: 1, total: 4, boss: false });
    t.kill('polarity');
    t.finish(3, { plow: 'arsenal' });
    expect(lastChallengeReport()!.results.filter((r) => r.met).map((r) => r.def.id)).toEqual([]);
  });

  it('ARSENAL / ISOTOPE tallies earn their arenas’ stars and save them', () => {
    const t = tracker();
    t.events.emit('roundStarted', { round: 1, total: 4, boss: false });
    for (let i = 0; i < 3; i++) t.kill('singularity');
    t.finish(2, { plow: 'arsenal' });
    expect(lastChallengeReport()!.results.find((r) => r.def.id === 'sing')!.isNew).toBe(true);
    t.events.emit('roundStarted', { round: 1, total: 4, boss: false });
    for (let i = 0; i < 10; i++) t.kill('radBurn');
    t.finish(1, { plow: 'isotope' });
    expect(lastChallengeReport()!.results.find((r) => r.def.id === 'burn')!.isNew).toBe(true);
    t.events.emit('roundStarted', { round: 1, total: 4, boss: false });
    for (let i = 0; i < 25; i++) t.kill('magLaser');
    t.finish(4, { plow: 'arsenal' });
    expect(lastChallengeReport()!.results.find((r) => r.def.id === 'laser')!.isNew).toBe(true);
    const p = (t.ctx as unknown as { progression: Progression }).progression;
    expect(p.data.challenges?.foundry).toContain('sing');
    expect(p.data.challenges?.junkyard).toContain('burn');
    expect(p.data.challenges?.plaza).toContain('laser');
  });

  it('a lost run banks nothing; a non-campaign run clears the report', () => {
    const t = tracker();
    t.events.emit('roundStarted', { round: 1, total: 4, boss: false });
    for (let i = 0; i < 99; i++) t.kill('magLaser');
    t.finish(4, { won: false });
    expect(lastChallengeReport()!.newStars).toBe(0);
    t.finish(4, { mode: 'survival', zoneIndex: undefined });
    expect(lastChallengeReport()).toBeNull();
  });
});
