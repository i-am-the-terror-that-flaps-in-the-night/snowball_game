import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Progression } from '../src/core/Progression';
import { EventBus, type GameEvents } from '../src/core/events';
import type { EnemyHandle, GameContext } from '../src/core/types';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, LIFE, OMEGA_WORKS, killsBySource, life, lifeBoss, lifeWinsPlow } from '../src/config/achievements';
import { Achievements, achievementProgress, achievementValue, isUnlocked, recordRunLifetime, unlockNew } from '../src/meta/achievements';
import { ZONES } from '../src/config/zones';
import { fmtPlayTime } from '../src/ui/Trophies';

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function run(extra: Partial<GameEvents['runFinished']> = {}): GameEvents['runFinished'] {
  return {
    mode: 'campaign', plow: 'classic', won: false, kills: 0, killsBy: { slam: 0, ram: 0, whirl: 0, other: 0 },
    coins: 0, bestCombo: 0, biggestBall: 0, duration: 60, damageTaken: 100, ...extra,
  };
}

function fakeCtx(p = new Progression()) {
  const toast = vi.fn();
  const play = vi.fn();
  const ctx = {
    events: new EventBus(),
    progression: p,
    zone: { ...ZONES[0] },
    ui: { toast },
    audio: { play },
  } as unknown as GameContext;
  const ach = new Achievements(ctx);
  return { ctx, ach, toast, play, p };
}

const bot = (type = 'scrapper', isBoss = false) => ({ id: 1, type, isBoss }) as unknown as EnemyHandle;

describe('achievement list', () => {
  it('has unique ids, sane goals and rewards', () => {
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    expect(ids.size).toBe(ACHIEVEMENTS.length);
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(30);
    for (const a of ACHIEVEMENTS) {
      expect(a.goal).toBeGreaterThan(0);
      expect(a.reward).toBeGreaterThanOrEqual(25);
      expect(a.reward).toBeLessThanOrEqual(500);
      expect(a.name.length).toBeGreaterThan(0);
    }
  });

  it('a fresh save unlocks nothing and every value is 0', () => {
    const p = new Progression();
    for (const a of ACHIEVEMENTS) expect(achievementValue(p, a)).toBe(0);
    expect(unlockNew(p)).toEqual([]);
  });
});

describe('unlock evaluation', () => {
  it('unlocks from crafted counters and pays the reward once', () => {
    const p = new Progression();
    p.data.lifetime = { [LIFE.killsSlam]: 100, [LIFE.slamHitsBest]: 5 };
    const got = unlockNew(p).map((a) => a.id);
    expect(got).toEqual(expect.arrayContaining(['slam_kills_100', 'slam_5']));
    expect(got).not.toContain('slam_kills_1000');
    const reward = ACHIEVEMENT_BY_ID.slam_kills_100.reward + ACHIEVEMENT_BY_ID.slam_5.reward;
    expect(p.data.coins).toBe(reward);
    expect(p.data.totalCoinsEarned).toBe(reward);
    expect(life(p, LIFE.achievementCoins)).toBe(reward);
    // Second pass: nothing new, no extra coins.
    expect(unlockNew(p)).toEqual([]);
    expect(p.data.coins).toBe(reward);
  });

  it('reads save-state achievements (arenas, Brawl, Survival, coins, upgrades, cosmetics)', () => {
    const p = new Progression();
    for (const z of ZONES) p.data.zones[z.id] = { cleared: true, bestRound: z.rounds.length };
    p.data.brawlWins = 1;
    p.data.brawlBestStreak = 8;
    p.data.survivalBestWave = 25;
    p.data.totalCoinsEarned = 10_000;
    p.data.upgrades = { maxSpeed: 20, hopper: 5 } as never;
    p.data.cosmetics = { owned: ['a', 'b', 'c', 'd', 'e'], equipped: {} };
    p.data.hardCleared = { yard: true };
    p.data.challenges = { yard: ['a', 'b', 'c'], junkyard: ['a', 'b'] };
    const got = new Set(unlockNew(p).map((a) => a.id));
    for (const id of ['clear_first', 'clear_all', 'brawl_win', 'streak_8', 'wave_10', 'wave_25', 'coins_10k', 'upgrades_25', 'cosmetics_5', 'hard_one', 'stars_5']) {
      expect(got.has(id), id).toBe(true);
    }
    for (const id of ['streak_12', 'wave_50', 'hard_all', 'stars_15', 'upgrades_100']) expect(got.has(id), id).toBe(false);
  });

  it('reward coins can chain into coin achievements', () => {
    const p = new Progression();
    p.data.totalCoinsEarned = 9_990;
    p.data.lifetime = { [LIFE.killsSlam]: 100 };
    const got = unlockNew(p).map((a) => a.id);
    expect(got).toEqual(expect.arrayContaining(['slam_kills_100', 'coins_10k']));
  });

  it('progress fraction and boss twins need both bosses', () => {
    const p = new Progression();
    p.data.lifetime = { [LIFE.killsSlam]: 412, [lifeBoss('slush')]: 2 };
    expect(achievementProgress(p, ACHIEVEMENT_BY_ID.slam_kills_1000)).toBeCloseTo(0.412);
    expect(achievementValue(p, ACHIEVEMENT_BY_ID.boss_twins)).toBe(0);
    p.data.lifetime[lifeBoss('sleet')] = 1;
    expect(achievementValue(p, ACHIEVEMENT_BY_ID.boss_twins)).toBe(1);
  });
});

describe('runFinished -> lifetime counters', () => {
  it('records plow wins, clean clears, Legend wins, last place and Daily runs', () => {
    const p = new Progression();
    recordRunLifetime(p, run({ won: true, plow: 'volt', damageTaken: 10, bestCombo: 27, biggestBall: 1.523, duration: 90.4 }));
    expect(life(p, lifeWinsPlow('volt'))).toBe(1);
    expect(life(p, LIFE.cleanClears)).toBe(1);
    expect(life(p, LIFE.comboBest)).toBe(27);
    expect(life(p, LIFE.ballBestCm)).toBe(152);
    expect(life(p, LIFE.playTime)).toBe(90);
    recordRunLifetime(p, run({ mode: 'brawl', won: true, brawlDifficulty: 'legend', placement: 1, bestStreak: 6 }));
    recordRunLifetime(p, run({ mode: 'brawl', won: false, brawlDifficulty: 'rookie', placement: 9 }));
    expect(life(p, LIFE.brawlWinsLegend)).toBe(1);
    expect(life(p, LIFE.brawlLast)).toBe(1);
    expect(life(p, LIFE.brawlStreakBest)).toBe(6);
    recordRunLifetime(p, run({ mode: 'survival', daily: true, wave: 16 }));
    expect(life(p, LIFE.dailyRuns)).toBe(1);
    expect(life(p, LIFE.runs)).toBe(4);
    const got = new Set(unlockNew(p).map((a) => a.id));
    for (const id of ['win_volt', 'clean_clear', 'combo_25', 'ball_150', 'brawl_legend', 'brawl_last', 'daily_1', 'daily_wave_15']) expect(got.has(id), id).toBe(true);
    expect(got.has('win_classic')).toBe(false);
  });
});

describe('Achievements (event wiring)', () => {
  it('counts kills by source, slams, strikes and bosses; toasts on unlock', () => {
    const { ctx, toast, p } = fakeCtx();
    const pos = new THREE.Vector3();
    for (let i = 0; i < 3; i++) ctx.events.emit('enemyKilled', { enemy: bot(), coins: 5, source: 'slam' });
    ctx.events.emit('enemyKilled', { enemy: bot(), coins: 5, source: 'ram' });
    ctx.events.emit('enemyKilled', { enemy: bot(), coins: 5 });
    ctx.events.emit('slam', { hits: 5, radius: 3, position: pos });
    ctx.events.emit('strike', { count: 5, position: pos });
    ctx.events.emit('bossDefeated', { enemy: bot('bulldoza', true), name: 'BULLDOZA' });
    expect(life(p, LIFE.killsSlam)).toBe(3);
    expect(life(p, LIFE.killsRam)).toBe(1);
    expect(life(p, LIFE.killsOther)).toBe(1);
    expect(life(p, LIFE.kills)).toBe(5);
    expect(life(p, LIFE.strikes)).toBe(1);
    expect(isUnlocked(p, 'slam_5')).toBe(true);
    expect(isUnlocked(p, 'boss_bulldoza')).toBe(true);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Bowling Night'), 'good');
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Dozer Down'), 'good');
    // Saved to localStorage on unlock.
    expect(store.get('snowplow-showdown-save-v2')).toContain('slam_5');
  });

  it('biome trophies: kills in lava (any blow), air-slam and stomp kills get their own counters, airtime from the run', () => {
    const { ctx, p } = fakeCtx();
    for (let i = 0; i < 20; i++) ctx.events.emit('enemyKilled', { enemy: bot(), coins: 5, source: 'lava', inLava: true });
    // Knocked into lava and finished by a slam: a slam kill AND a kill in lava.
    for (let i = 0; i < 5; i++) ctx.events.emit('enemyKilled', { enemy: bot(), coins: 5, source: 'slam', inLava: true });
    for (let i = 0; i < 10; i++) ctx.events.emit('enemyKilled', { enemy: bot(), coins: 5, source: 'airSlam' });
    ctx.events.emit('enemyKilled', { enemy: bot(), coins: 5, source: 'stomp' });
    expect(life(p, LIFE.killsLava)).toBe(25);
    expect(life(p, LIFE.killsSlam)).toBe(5);
    expect(life(p, LIFE.killsAirSlam)).toBe(10);
    expect(life(p, LIFE.killsStomp)).toBe(1);
    expect(life(p, LIFE.killsOther)).toBe(20); // the lava's own burn kills
    expect(killsBySource(p)).toMatchObject({ slam: 5, other: 31, total: 36 });
    expect(isUnlocked(p, 'lava_kills_25')).toBe(true);
    expect(isUnlocked(p, 'air_slam_kills_10')).toBe(true);
    ctx.events.emit('runFinished', run({ airtime: 0.8 }));
    expect(isUnlocked(p, 'airtime_1')).toBe(false);
    ctx.events.emit('runFinished', run({ airtime: 1.04 }));
    expect(life(p, LIFE.airtimeBestCs)).toBe(104);
    expect(isUnlocked(p, 'airtime_1')).toBe(true);
  });

  it('ignores Tutorial fights (coinMult 0)', () => {
    const { ctx, toast, p } = fakeCtx();
    ctx.zone = { ...ZONES[0], coinMult: 0 };
    ctx.events.emit('enemyKilled', { enemy: bot(), coins: 0, source: 'slam' });
    ctx.events.emit('slam', { hits: 7, radius: 3, position: new THREE.Vector3() });
    ctx.events.emit('bossDefeated', { enemy: bot('bulldoza', true), name: 'BULLDOZA' });
    expect(life(p, LIFE.kills)).toBe(0);
    expect(life(p, LIFE.slamHitsBest)).toBe(0);
    expect(isUnlocked(p, 'slam_5')).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });

  it('Brawl: only the player\'s kills, streaks and shutdowns count', () => {
    const { ctx, p } = fakeCtx();
    const kill = (killerIsPlayer: boolean, method: GameEvents['brawlKill']['method']) =>
      ctx.events.emit('brawlKill', { killer: 'a', killerColor: '#fff', victim: 'b', victimColor: '#000', method, killerIsPlayer, victimIsPlayer: false });
    kill(true, 'zap');
    kill(true, 'pound');
    kill(false, 'zap');
    ctx.events.emit('brawlStreak', { name: 'x', color: '#fff', count: 12, label: 'PLOWNADO', mult: 4, isPlayer: false });
    ctx.events.emit('brawlStreak', { name: 'me', color: '#fff', count: 8, label: 'UNSTOPPABLE', mult: 3, isPlayer: true });
    ctx.events.emit('brawlShutdown', { killer: 'me', victim: 'x', streak: 5, bonus: 60, killerIsPlayer: true });
    ctx.events.emit('brawlShutdown', { killer: 'x', victim: 'me', streak: 5, bonus: 60, killerIsPlayer: false });
    expect(life(p, LIFE.brawlKills)).toBe(2);
    expect(life(p, LIFE.brawlKillsZap)).toBe(1);
    expect(life(p, LIFE.brawlKillsPound)).toBe(1);
    expect(life(p, LIFE.brawlStreakBest)).toBe(8);
    expect(life(p, LIFE.brawlShutdowns)).toBe(1);
    expect(isUnlocked(p, 'streak_8')).toBe(true);
    expect(isUnlocked(p, 'streak_12')).toBe(false);
  });

  it('runFinished saves, unlocks once and delays the toast past the results screen', () => {
    const { ctx, toast, p } = fakeCtx();
    ctx.events.emit('runFinished', run({ won: true, plow: 'brute', damageTaken: 200 }));
    expect(isUnlocked(p, 'win_brute')).toBe(true);
    expect(toast).not.toHaveBeenCalled();
    vi.advanceTimersByTime(800);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Rhino Charge'), 'good');
    const coins = p.data.coins;
    toast.mockClear();
    ctx.events.emit('runFinished', run({ won: true, plow: 'brute', damageTaken: 200 }));
    vi.advanceTimersByTime(800);
    expect(toast).not.toHaveBeenCalled();
    expect(p.data.coins).toBe(coins);
    expect(life(p, lifeWinsPlow('brute'))).toBe(2);
    expect(JSON.parse(store.get('snowplow-showdown-save-v2')!).lifetime[lifeWinsPlow('brute')]).toBe(2);
  });

  it('save changes (p.onChange) unlock save-state achievements without looping', () => {
    const { p, toast } = fakeCtx();
    const listener = vi.fn();
    p.onChange(listener);
    p.addCoins(10_000);
    expect(isUnlocked(p, 'coins_10k')).toBe(true);
    // addCoins notify + one commit from the unlock.
    expect(listener).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(500);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(p.data.coins).toBe(10_000 + ACHIEVEMENT_BY_ID.coins_10k.reward);
  });

  it('many retroactive unlocks collapse into one toast', () => {
    const p = new Progression();
    for (const z of ZONES) p.data.zones[z.id] = { cleared: true, bestRound: 1 };
    p.data.totalCoinsEarned = 200_000;
    p.data.survivalBestWave = 60;
    const { toast } = fakeCtx(p);
    vi.advanceTimersByTime(1500);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatch(/achievements unlocked/);
  });
});

describe('recent-work trophies', () => {
  const OMEGA_I = ZONES.indexOf(OMEGA_WORKS);
  const omegaRun = (extra: Partial<GameEvents['runFinished']> = {}) =>
    run({ won: true, plow: 'volt', zoneIndex: OMEGA_I, hard: true, bossDamage: 0, damageTaken: 180, ...extra });

  it('Grounded: a boss finished by the Arc Lance, nothing else', () => {
    const { ctx, p } = fakeCtx();
    // Near misses: a boss scrapped by something else, a plain bot by the lance, a Brawl rival (Brawl never tags a weapon).
    ctx.events.emit('enemyKilled', { enemy: bot('omega', true), coins: 5, source: 'slam' });
    ctx.events.emit('enemyKilled', { enemy: bot('omega', true), coins: 5, source: 'other' });
    ctx.events.emit('enemyKilled', { enemy: bot('grunt'), coins: 5, source: 'other', weapon: 'arcLance' });
    ctx.events.emit('enemyKilled', { enemy: bot('rival'), coins: 5 });
    expect(life(p, LIFE.lanceBossKills)).toBe(0);
    expect(isUnlocked(p, 'lance_boss')).toBe(false);
    ctx.events.emit('enemyKilled', { enemy: bot('frostbyte', true), coins: 5, source: 'other', weapon: 'arcLance' });
    expect(life(p, LIFE.lanceBossKills)).toBe(1);
    expect(isUnlocked(p, 'lance_boss')).toBe(true);
  });

  it('Grounded: Tutorial kills do not count', () => {
    const { ctx, p } = fakeCtx();
    ctx.zone = { ...ZONES[0], coinMult: 0 };
    ctx.events.emit('enemyKilled', { enemy: bot('frostbyte', true), coins: 0, source: 'other', weapon: 'arcLance' });
    expect(life(p, LIFE.lanceBossKills)).toBe(0);
  });

  it('Exciting Opportunity: every arena on Hard, with progress; five of six is not enough', () => {
    const p = new Progression();
    const def = ACHIEVEMENT_BY_ID.protocol_b;
    expect(def.goal).toBe(ZONES.length);
    p.data.hardCleared = Object.fromEntries(ZONES.slice(0, -1).map((z) => [z.id, true]));
    expect(achievementValue(p, def)).toBe(ZONES.length - 1);
    expect(achievementProgress(p, def)).toBeCloseTo((ZONES.length - 1) / ZONES.length);
    expect(unlockNew(p).map((a) => a.id)).not.toContain('protocol_b');
    // An old save that already cleared everything on Hard gets it on the next check.
    p.data.hardCleared[ZONES[ZONES.length - 1].id] = true;
    expect(unlockNew(p).map((a) => a.id)).toContain('protocol_b');
  });

  it('Q4: Total Defeat: Hard Omega Works with a spotless boss round only', () => {
    const p = new Progression();
    // Near misses: 1 HP lost to the boss, normal mode, another Hard arena, a loss, no boss round recorded.
    recordRunLifetime(p, omegaRun({ bossDamage: 1 }));
    recordRunLifetime(p, omegaRun({ bossDamage: 0.2 }));
    recordRunLifetime(p, omegaRun({ hard: false }));
    recordRunLifetime(p, omegaRun({ zoneIndex: OMEGA_I - 1 }));
    recordRunLifetime(p, omegaRun({ won: false }));
    recordRunLifetime(p, omegaRun({ bossDamage: undefined }));
    recordRunLifetime(p, omegaRun({ mode: 'survival' }));
    expect(life(p, LIFE.omegaHardFlawless)).toBe(0);
    expect(unlockNew(p).map((a) => a.id)).not.toContain('omega_flawless');
    // Damage taken before the boss round doesn't matter.
    recordRunLifetime(p, omegaRun({ damageTaken: 240, bossDamage: 0 }));
    expect(life(p, LIFE.omegaHardFlawless)).toBe(1);
    expect(unlockNew(p).map((a) => a.id)).toContain('omega_flawless');
  });

  it('Q4: Total Defeat unlocks from the runFinished event', () => {
    const { ctx, p } = fakeCtx();
    ctx.events.emit('runFinished', omegaRun());
    expect(isUnlocked(p, 'omega_flawless')).toBe(true);
  });

  it('old saves without the new counters read 0', () => {
    const p = new Progression();
    p.data.lifetime = { [LIFE.kills]: 40 };
    expect(achievementValue(p, ACHIEVEMENT_BY_ID.lance_boss)).toBe(0);
    expect(achievementValue(p, ACHIEVEMENT_BY_ID.omega_flawless)).toBe(0);
  });
});

describe('malformed saves', () => {
  it('missing / junk meta fields never throw and read as 0', () => {
    const p = new Progression();
    const d = p.data as unknown as Record<string, unknown>;
    d.lifetime = 'garbage';
    d.achievements = [1, 2];
    d.cosmetics = { owned: 'nope' };
    d.challenges = { yard: 5 };
    d.hardCleared = null;
    d.dailyBest = { x: 'y' };
    d.upgrades = null;
    d.zones = 7;
    for (const a of ACHIEVEMENTS) expect(Number.isFinite(achievementValue(p, a))).toBe(true);
    expect(() => unlockNew(p)).not.toThrow();
    expect(() => recordRunLifetime(p, run({ duration: NaN, damageTaken: Infinity, biggestBall: undefined as never }))).not.toThrow();
    expect(life(p, LIFE.runs)).toBe(1);
    expect(() => killsBySource(p)).not.toThrow();
  });

  it('imported saves keep unlocks (sanitized) and do not pay twice', () => {
    const p = new Progression();
    p.data.lifetime = { [LIFE.slamHitsBest]: 6 };
    unlockNew(p);
    const coins = p.data.coins;
    const code = p.exportSave();
    const q = new Progression();
    expect(q.importSave(code).ok).toBe(true);
    expect(isUnlocked(q, 'slam_5')).toBe(true);
    expect(unlockNew(q)).toEqual([]);
    expect(q.data.coins).toBe(coins);
  });

  it('kill breakdown puts unattributed (legacy) kills under other', () => {
    const p = new Progression();
    p.data.totalKills = 500;
    p.data.lifetime = { [LIFE.killsSlam]: 100, [LIFE.killsRam]: 50 };
    expect(killsBySource(p)).toEqual({ slam: 100, ram: 50, whirl: 0, other: 350, total: 500 });
  });
});

describe('fmtPlayTime', () => {
  it('formats seconds', () => {
    expect(fmtPlayTime(75)).toBe('1m 15s');
    expect(fmtPlayTime(3725)).toBe('1h 02m');
    expect(fmtPlayTime(-5)).toBe('0m 00s');
  });
});
