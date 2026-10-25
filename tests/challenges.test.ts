import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Progression } from '../src/core/Progression';
import { ZONES } from '../src/config/zones';
import { CHALLENGES, HARD, type ChallengeRun } from '../src/config/challenges';
import {
  awardRun, evaluateRun, hardCleared, hardReward, hardUnlocked, hardZone, maxStars, recordHardClear, starReward, starString,
  zoneChallenges, zoneStars,
} from '../src/meta/challenges';
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
  it('every arena has exactly three challenges with unique ids', () => {
    for (const z of ZONES) {
      const list = CHALLENGES[z.id];
      expect(list, z.id).toHaveLength(3);
      expect(new Set(list.map((c) => c.id)).size).toBe(3);
      for (const c of list) expect(c.goal.length, `${z.id}/${c.id}`).toBeLessThanOrEqual(22);
    }
    expect(maxStars()).toBe(15);
  });

  it('a plain win meets nothing; each crafted payload meets its own challenge', () => {
    expect(ids(evaluateRun(new Progression(), run(0)))).toEqual([]);
    const p = new Progression();
    expect(ids(evaluateRun(p, run(0, { killsBy: { slam: 3, ram: 0, whirl: 0, other: 0 } })))).toEqual(['slam']);
    expect(ids(evaluateRun(p, run(0, { biggestBall: 1.2 })))).toEqual(['ball']);
    expect(ids(evaluateRun(p, run(0, { duration: 59 })))).toEqual(['speed']);
    expect(ids(evaluateRun(p, run(0, { duration: 60 })))).toEqual([]);
    expect(ids(evaluateRun(p, run(1, { bestCombo: 30 })))).toEqual(['combo']);
    expect(ids(evaluateRun(p, run(1, { damageTaken: 10 })))).toEqual(['hp']);
    expect(ids(evaluateRun(p, run(1, { bossTime: 20 })))).toEqual(['blitz']);
    expect(ids(evaluateRun(p, run(1, { bossTime: 0 })))).toEqual([]); // boss round never started
    expect(ids(evaluateRun(p, run(2, { strikes: 2 })))).toEqual(['strike']);
    expect(ids(evaluateRun(p, run(2, { plow: 'volt' })))).toEqual([]);
    expect(ids(evaluateRun(p, run(2, { plow: 'volt', damageTaken: 99 })))).toEqual(['plow-volt']);
    expect(ids(evaluateRun(p, run(3, { killsBy: { slam: 0, ram: 0, whirl: 4, other: 0 } })))).toEqual(['whirl']);
    // BRUTUS twist: the plow alone is not enough.
    expect(ids(evaluateRun(p, run(4, { plow: 'brute' })))).toEqual([]);
    expect(ids(evaluateRun(p, run(4, { plow: 'brute', killsBy: { slam: 0, ram: 12, whirl: 0, other: 0 } })))).toEqual(['plow-brute']);
    expect(ids(evaluateRun(p, run(4, { bossDamage: 0 })))).toEqual(['bossHp']);
    expect(ids(evaluateRun(p, run(4, { killsBy: { slam: 10, ram: 0, whirl: 0, other: 0 } })))).toEqual(['slam']);
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
    awardRun(p, run(2, { plow: 'volt', damageTaken: 50, strikes: 5 }));
    const q = new Progression();
    expect(zoneStars(q, 2)).toBe(2);
    expect(awardRun(q, run(2, { plow: 'volt', damageTaken: 50, strikes: 5 }))!.bonus).toBe(0);
  });

  it('star bonus scales with the arena', () => {
    for (let i = 1; i < ZONES.length; i++) expect(starReward(i)).toBeGreaterThan(starReward(i - 1));
    expect(starString(2)).toBe('★★☆');
    expect(starString(0)).toBe('☆☆☆');
    expect(zoneChallenges(99)).toEqual([]);
  });
});

describe('hard mode', () => {
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
    expect(ZONES[0].name).toBe('Frostbite Yard');
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
