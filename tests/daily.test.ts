import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Progression } from '../src/core/Progression';
import type { GameContext } from '../src/core/types';
import { MIN_COOLDOWN } from '../src/config/upgrades';
import { ZONES } from '../src/config/zones';
import {
  DAILY_COIN_MULT, DAILY_KEEP, DAILY_MODIFIERS, activeDaily, dailyBest, dailyButtonLabel, dailyFor, dailyHistory,
  dayKey, mulberry32, recordDaily, todaysDaily, type DailyModifierId, type DailySpec,
} from '../src/meta/daily';
import { BOSS_EVERY, GLASS_DMG, GLASS_HP, SurvivalManager, waveClearBonus, waveCoinMult } from '../src/survival/SurvivalManager';

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

/** Just enough GameContext for SurvivalManager (ctx.zone is pointed at the survival zone like Game.setMode does). */
function fakeCtx(p = new Progression()) {
  const ctx = {
    progression: p,
    plow: { hp: 50, maxHp: 100 },
    stats: p.computeStats(),
    zone: null as unknown,
    world: { setZone: vi.fn() },
    ui: { toast: vi.fn() },
  };
  return ctx;
}

function manager(p = new Progression()) {
  const ctx = fakeCtx(p);
  const sv = new SurvivalManager(ctx as unknown as GameContext);
  ctx.zone = sv.zone;
  return { ctx, sv };
}

/** A spec for `key` with its modifier forced (seed stays the key's). */
const specWith = (id: DailyModifierId, key = '2026-10-25'): DailySpec => ({ ...dailyFor(key), modifierId: id });

/** The wave lineup (types + counts per wave) of the first n waves. */
function lineup(sv: SurvivalManager, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    sv.nextWave();
    out.push(sv.zone.rounds[0].groups.map((g) => `${g.type}x${g.count}`).join(','));
  }
  return out;
}

describe('daily spec', () => {
  it('uses the local date as the key', () => {
    expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(todaysDaily(new Date(2026, 9, 25, 0, 1)).key).toBe('2026-10-25');
  });

  it('same date -> same spec, whatever the time of day', () => {
    const a = todaysDaily(new Date(2026, 9, 25, 0, 0, 1));
    const b = todaysDaily(new Date(2026, 9, 25, 23, 59, 59));
    expect(a).toEqual(b);
    expect(DAILY_MODIFIERS.some((m) => m.id === a.modifierId)).toBe(true);
  });

  it('different dates -> different seeds and a spread of modifiers', () => {
    const specs = Array.from({ length: 60 }, (_, i) => todaysDaily(new Date(2026, 0, 1 + i)));
    expect(new Set(specs.map((s) => s.seed)).size).toBe(60);
    const mods = specs.map((s) => s.modifierId);
    expect(new Set(mods).size).toBe(DAILY_MODIFIERS.length);
    for (let i = 1; i < mods.length; i++) expect(mods[i]).not.toBe(mods[i - 1]);
    // Every modifier comes round within any 15-day window.
    for (let i = 0; i + 15 <= mods.length; i++) expect(new Set(mods.slice(i, i + 15)).size).toBe(DAILY_MODIFIERS.length);
  });

  it('every modifier has a name and a one-line description', () => {
    expect(DAILY_MODIFIERS.length).toBe(8);
    for (const m of DAILY_MODIFIERS) {
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.desc.length).toBeGreaterThan(0);
      expect(m.desc.length).toBeLessThan(60);
    }
  });

  it('mulberry32 is deterministic and in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('seeded waves', () => {
  it('the same day always produces the same wave lineup', () => {
    const spec = specWith('heavyHitters');
    const a = manager().sv;
    a.reset(spec);
    const b = manager().sv;
    b.reset(spec);
    const la = lineup(a, 12);
    expect(lineup(b, 12)).toEqual(la);
    // A retry on the same manager replays it too.
    a.reset(spec);
    expect(lineup(a, 12)).toEqual(la);
  });

  it('different days produce different lineups', () => {
    const a = manager().sv;
    a.reset(specWith('heavyHitters', '2026-10-25'));
    const b = manager().sv;
    b.reset(specWith('heavyHitters', '2026-10-26'));
    expect(lineup(a, 12)).not.toEqual(lineup(b, 12));
  });

  it('normal Survival draws from Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    const { sv } = manager();
    sv.reset(null);
    lineup(sv, 3);
    expect(spy).toHaveBeenCalled();
    spy.mockClear();
    sv.reset(specWith('heavyHitters'));
    lineup(sv, 3);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('modifiers', () => {
  it('deep snow and whiteout change the arena, and a normal run restores it', () => {
    const { ctx, sv } = manager();
    const base = ZONES[2];
    sv.reset(specWith('deepSnow'));
    expect(sv.zone.snowDepth).toBeGreaterThan(base.snowDepth);
    expect(sv.zone.snowRegenMult).toBeGreaterThan(base.snowRegenMult);
    expect(sv.zone.name).toBe('DAILY · Deep Snow');
    sv.reset(specWith('whiteout'));
    expect(sv.zone.snowDepth).toBe(base.snowDepth);
    expect(sv.zone.fogFar).toBeLessThan(base.fogFar);
    expect(sv.zone.snowfall).toBe(1);
    expect(ctx.world.setZone).toHaveBeenCalledWith(sv.zone);
    ctx.world.setZone.mockClear();
    sv.reset(null);
    expect(sv.zone.fogNear).toBe(base.fogNear);
    expect(sv.zone.fogFar).toBe(base.fogFar);
    expect(sv.zone.snowfall).toBe(base.snowfall);
    expect(sv.zone.snowDepth).toBe(base.snowDepth);
    expect(sv.zone.name).toBe(`Survival · ${base.name}`);
    expect(ctx.world.setZone).toHaveBeenCalledTimes(1); // fog back to normal -> re-dressed
    ctx.world.setZone.mockClear();
    sv.reset(null);
    expect(ctx.world.setZone).not.toHaveBeenCalled(); // nothing visual changed
    expect(activeDaily()).toBeNull();
  });

  it('glass cannon and overclocked touch the player; normal runs leave stats alone', () => {
    const p = new Progression();
    p.data.upgrades = { overclock: 10 };
    const { sv } = manager(p);
    const clean = p.computeStats();

    sv.reset(specWith('glassCannon'));
    const g = p.computeStats();
    sv.adjustStats(g);
    expect(g.maxHp).toBeCloseTo(clean.maxHp * GLASS_HP);
    expect(g.damageMult).toBeCloseTo(clean.damageMult * GLASS_DMG);
    expect(g.ramDamage).toBeCloseTo(clean.ramDamage * GLASS_DMG);

    sv.reset(specWith('overclocked'));
    const o = p.computeStats();
    sv.adjustStats(o);
    expect(o.dashCooldown).toBeLessThan(clean.dashCooldown);
    expect(o.cooldownMult).toBeLessThan(clean.cooldownMult);
    for (const k of ['dashCooldown', 'whirlCooldown', 'flameCooldown', 'clapCooldown', 'poundCooldown'] as const) {
      expect(o[k]).toBeGreaterThanOrEqual(MIN_COOLDOWN);
    }

    sv.reset(null);
    const n = p.computeStats();
    sv.adjustStats(n);
    expect(n).toEqual(clean);
  });

  it('boss rush brings bosses every 3rd wave; normal runs every 5th', () => {
    const { sv } = manager();
    sv.reset(specWith('bossRush'));
    const bosses = Array.from({ length: 9 }, () => (sv.nextWave(), sv.isBossWave));
    expect(bosses.map((b, i) => (b ? i + 1 : 0)).filter(Boolean)).toEqual([3, 6, 9]);
    expect(sv.bossNameFor(3)).toBe('BULLDOZA');
    sv.reset(null);
    const normal = Array.from({ length: 10 }, () => (sv.nextWave(), sv.isBossWave));
    expect(normal.map((b, i) => (b ? i + 1 : 0)).filter(Boolean)).toEqual([BOSS_EVERY, 2 * BOSS_EVERY]);
  });

  it('thief night is thief-heavy from wave 1; swarm is bigger and softer', () => {
    const count = (sv: SurvivalManager, type: string, waves: number) => {
      let n = 0;
      for (let i = 0; i < waves; i++) {
        sv.nextWave();
        for (const g of sv.zone.rounds[0].groups) if (g.type === type) n += g.count;
      }
      return n;
    };
    const { sv } = manager();
    sv.reset(specWith('thiefNight'));
    sv.nextWave();
    expect(sv.zone.rounds[0].groups.some((g) => g.type === 'thief')).toBe(true);
    sv.reset(specWith('thiefNight'));
    const thieves = count(sv, 'thief', 8);
    sv.reset(specWith('heavyHitters'));
    expect(thieves).toBeGreaterThan(count(sv, 'thief', 8) * 1.5);

    const bots = (spec: DailySpec) => {
      sv.reset(spec);
      let n = 0;
      for (let i = 0; i < 4; i++) {
        sv.nextWave();
        n += sv.zone.rounds[0].groups.reduce((s, g) => s + g.count, 0);
      }
      return { n, hp: sv.zone.enemyHpMult };
    };
    const swarm = bots(specWith('swarm'));
    const plain = bots(specWith('heavyHitters'));
    expect(swarm.n).toBeGreaterThan(plain.n);
    expect(swarm.hp).toBeLessThan(plain.hp);
  });

  it('heavy hitters hit harder and pay more; the Daily pays a modest bonus; normal runs are unscaled', () => {
    const { sv } = manager();
    sv.reset(specWith('heavyHitters'));
    sv.nextWave();
    const hh = { dmg: sv.zone.enemyDmgMult!, coin: sv.zone.coinMult };
    sv.reset(specWith('deepSnow'));
    sv.nextWave();
    expect(sv.zone.coinMult).toBeCloseTo(waveCoinMult(1) * DAILY_COIN_MULT);
    expect(hh.dmg).toBeGreaterThan(sv.zone.enemyDmgMult!);
    expect(hh.coin).toBeGreaterThan(sv.zone.coinMult);
    sv.reset(null);
    sv.nextWave();
    expect(sv.zone.coinMult).toBeCloseTo(waveCoinMult(1));
    expect(sv.zone.enemyDmgMult).toBeCloseTo(1);
    expect(sv.zone.enemyHpMult).toBeCloseTo(1);
  });

  it('wave clear bonus follows the boss cadence and the Daily multiplier', () => {
    const p = new Progression();
    const { sv } = manager(p);
    sv.reset(specWith('bossRush'));
    for (let i = 0; i < 3; i++) sv.nextWave();
    const before = p.coins;
    const bonus = sv.waveCleared();
    expect(bonus).toBe(Math.round(waveClearBonus(3, 3) * DAILY_COIN_MULT));
    expect(p.coins - before).toBe(bonus);
  });
});

describe('daily best', () => {
  it('records the best per day and reports newBest against that day', () => {
    const p = new Progression();
    expect(recordDaily(p, '2026-10-25', 5)).toBe(true);
    expect(recordDaily(p, '2026-10-25', 3)).toBe(false);
    expect(recordDaily(p, '2026-10-25', 5)).toBe(false);
    expect(recordDaily(p, '2026-10-25', 6)).toBe(true);
    expect(recordDaily(p, '2026-10-26', 1)).toBe(true);
    expect(dailyBest(p, '2026-10-25')).toBe(6);
    expect(dailyBest(p, '2026-10-26')).toBe(1);
  });

  it(`prunes history to the newest ${DAILY_KEEP} days`, () => {
    const p = new Progression();
    for (let i = 0; i < 45; i++) recordDaily(p, dayKey(new Date(2026, 0, 1 + i)), i + 1);
    const keys = Object.keys(p.data.dailyBest!).sort();
    expect(keys.length).toBe(DAILY_KEEP);
    expect(keys[keys.length - 1]).toBe(dayKey(new Date(2026, 0, 45)));
    expect(keys[0]).toBe(dayKey(new Date(2026, 0, 16)));
  });

  it('a Daily run updates dailyBest only; a normal run updates survivalBestWave only', () => {
    const p = new Progression();
    p.data.survivalBestWave = 10;
    const { sv } = manager(p);
    const spec = specWith('swarm');
    sv.reset(spec);
    for (let i = 0; i < 4; i++) sv.nextWave();
    expect(sv.best).toBe(4);
    expect(sv.finish(7)).toBe(true); // first Daily of the day: new best vs that day's 0, not vs Survival's 10
    expect(p.data.survivalBestWave).toBe(10);
    expect(dailyBest(p, spec.key)).toBe(4);
    expect(p.data.totalKills).toBe(7);

    sv.reset(spec);
    expect(sv.best).toBe(4);
    for (let i = 0; i < 3; i++) sv.nextWave();
    expect(sv.finish(0)).toBe(false);
    expect(dailyBest(p, spec.key)).toBe(4);

    sv.reset(null);
    for (let i = 0; i < 6; i++) sv.nextWave();
    expect(sv.finish(0)).toBe(false); // 6 < Survival best 10, even though it beats today's Daily
    expect(dailyBest(p, spec.key)).toBe(4);
    for (let i = 0; i < 5; i++) sv.nextWave();
    expect(sv.finish(0)).toBe(true);
    expect(p.data.survivalBestWave).toBe(11);
    expect(dailyBest(p, spec.key)).toBe(4);
  });

  it('daily bests persist in the save', () => {
    const p = new Progression();
    recordDaily(p, '2026-10-25', 9);
    p.commit();
    const q = new Progression();
    expect(dailyBest(q, '2026-10-25')).toBe(9);
  });

  it('history lists the last 7 days oldest first, across month ends', () => {
    const p = new Progression();
    recordDaily(p, '2026-10-30', 2);
    recordDaily(p, '2026-11-02', 8);
    const h = dailyHistory(p, '2026-11-02', 7);
    expect(h.map((d) => d.key)).toEqual(['2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(h.map((d) => d.best)).toEqual([0, 0, 0, 2, 0, 0, 8]);
  });

  it('menu label shows the modifier and today’s best', () => {
    const p = new Progression();
    const spec = todaysDaily();
    const name = DAILY_MODIFIERS.find((m) => m.id === spec.modifierId)!.name;
    expect(dailyButtonLabel(p)).toContain(name);
    expect(dailyButtonLabel(p)).not.toContain('best');
    recordDaily(p, spec.key, 7);
    expect(dailyButtonLabel(p)).toContain(`${name} · best 7`);
  });
});
