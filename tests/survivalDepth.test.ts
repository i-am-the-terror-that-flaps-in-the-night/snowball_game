import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Progression } from '../src/core/Progression';
import type { GameContext } from '../src/core/types';
import {
  MILESTONE_BREATHER_SECONDS, MILESTONE_EVERY, MILESTONE_HEAL, MINIBOSS_HP, MINI_BOSSES, MODIFIER_FROM, SURVIVAL_MINIONS,
  SurvivalManager, WAVE_MODIFIERS, isMilestone, isModifierWave, milestoneCoins, miniBossFor, recordSurvivalPlow,
  survivalBestFor, waveClearBonus, waveCoinMult, waveModifierFor, type WaveModifier,
} from '../src/survival/SurvivalManager';
import { ENEMIES } from '../src/config/enemies';
import { LOOT_RULES } from '../src/config/loot';
import { dailyFor } from '../src/meta/daily';

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

function rig(p = new Progression()) {
  const ctx = {
    progression: p, plow: { hp: 50, maxHp: 100 }, stats: p.computeStats(), zone: null as unknown,
    world: { setZone: vi.fn(), setStorm: vi.fn() }, ui: { toast: vi.fn() },
  };
  const sv = new SurvivalManager(ctx as unknown as GameContext);
  ctx.zone = sv.zone;
  sv.reset(null);
  return { ctx, sv, p };
}

/** Play waves 1..n (clearing each but the last). */
function playTo(sv: SurvivalManager, n: number) {
  for (let w = 1; w <= n; w++) {
    sv.nextWave();
    if (w < n) sv.waveCleared();
  }
}

/** Fresh run(s) until wave w rolls modifier `id` (the run offset is random on a normal run). */
function forceModifier(sv: SurvivalManager, w: number, id: WaveModifier['id']) {
  sv.reset(null);
  for (let i = 0; i < 300 && sv.modifierFor(w)?.id !== id; i++) sv.reset(null);
  expect(sv.modifierFor(w)?.id).toBe(id);
}

const bots = (sv: SurvivalManager) => sv.zone.rounds[0].groups.reduce((n, g) => n + g.count, 0);

describe('wave modifier schedule (pure)', () => {
  it(`starts at wave ${MODIFIER_FROM}, then every 3rd wave, skipping boss and milestone waves`, () => {
    const waves = (every: number) => Array.from({ length: 40 }, (_, i) => i + 1).filter((w) => isModifierWave(w, every));
    expect(waves(5)).toEqual([7, 13, 16, 19, 22, 28, 31, 34, 37]);
    // Boss Rush (a boss every 3rd wave) keeps its modifiers; only milestones skip
    expect(waves(3)).toEqual([7, 13, 16, 19, 22, 25, 28, 31, 34, 37]);
  });

  it('is deterministic, honours `from` and never pairs a modifier with a special it excludes', () => {
    for (let off = 0; off < WAVE_MODIFIERS.length; off++) {
      for (let w = 1; w <= 60; w++) {
        const m = waveModifierFor(w, off);
        expect(m).toBe(waveModifierFor(w, off));
        if (!isModifierWave(w)) expect(m).toBeNull();
        if (m) expect(w).toBeGreaterThanOrEqual(m.from);
      }
    }
    expect(waveModifierFor(13, 0, 5, 'swarm')?.id).not.toBe('horde');
    for (let off = 0; off < 12; off++) {
      expect(waveModifierFor(16, off, 5, 'blitz')?.id).not.toBe('frenzy');
      expect(['horde']).not.toContain(waveModifierFor(16, off, 5, 'elite')?.id);
    }
  });

  it('rotates through the whole table and never repeats back to back once every modifier is unlocked', () => {
    const seen = new Set<string>();
    let prev = '';
    for (let w = 13; w <= 100; w++) {
      const m = waveModifierFor(w, 2);
      if (!m) continue;
      seen.add(m.id);
      expect(m.id).not.toBe(prev);
      prev = m.id;
    }
    expect(seen.size).toBe(WAVE_MODIFIERS.length);
  });

  it('has 6 distinct modifiers, each paying for its trouble', () => {
    expect(new Set(WAVE_MODIFIERS.map((m) => m.id)).size).toBe(6);
    for (const m of WAVE_MODIFIERS) {
      if (m.id !== 'horde') expect(m.coins, m.id).toBeGreaterThan(1);
      expect(m.from).toBeGreaterThanOrEqual(MODIFIER_FROM);
    }
  });
});

describe('wave modifiers in a run', () => {
  it('the pit-stop preview matches what the wave then plays, and the HUD tags it while it lasts', () => {
    const { sv } = rig();
    for (let w = 1; w <= 30; w++) {
      const preview = sv.modifierFor(w);
      sv.nextWave();
      expect(sv.modifier).toBe(preview);
      if (preview) expect(sv.hud().tag).toBe(`${preview.icon} ${preview.name}`);
      sv.waveCleared();
      expect(sv.modifier).toBeNull();
      expect(sv.hud().tag).toBe('');
    }
  });

  it('Overdrive speeds bots up for its wave only; Gold Rush doubles kill coins and the wave bonus', () => {
    const { sv, p } = rig();
    forceModifier(sv, 7, 'overdrive');
    playTo(sv, 7);
    expect(sv.zone.enemySpeedMult).toBeCloseTo(1.25);
    sv.waveCleared();
    sv.nextWave();
    expect(sv.zone.enemySpeedMult).toBe(1);

    forceModifier(sv, 7, 'goldRush');
    playTo(sv, 7);
    expect(sv.zone.coinMult).toBeCloseTo(waveCoinMult(7) * 2);
    const before = p.coins;
    const bonus = sv.waveCleared();
    expect(bonus).toBe(Math.round(waveClearBonus(7) * 2));
    expect(p.coins - before).toBe(bonus);
  });

  it('Horde doubles the bot count at half hp; Frenzy halves the spawn pacing', () => {
    const { sv } = rig();
    // Wave 19: a modifier wave with no special. Each run replays the same minion picks (a normal run's rng is
    // Math.random); reset draws the special offset, then the modifier offset, which picks `id`.
    const run = (id: WaveModifier['id']) => {
      const off = [0, 1, 2, 3, 4, 5].find((o) => waveModifierFor(19, o)?.id === id)!;
      const spy = vi.spyOn(Math, 'random').mockReturnValue(0.42).mockReturnValueOnce(0.42).mockReturnValueOnce((off + 0.5) / 6);
      sv.reset(null);
      expect(sv.modifierFor(19)?.id).toBe(id);
      playTo(sv, 19);
      spy.mockRestore();
      return { n: bots(sv), hp: sv.zone.enemyHpMult, intervals: sv.zone.rounds[0].groups.map((g) => g.interval) };
    };
    const plain = run('goldRush'); // no lineup or hp change
    const horde = run('horde');
    const frenzy = run('frenzy');
    expect(horde.n).toBeGreaterThan(plain.n * 1.5);
    expect(horde.hp).toBeCloseTo(plain.hp * 0.5);
    expect(frenzy.n).toBe(plain.n);
    expect(frenzy.intervals).toHaveLength(plain.intervals.length);
    frenzy.intervals.forEach((t, i) => expect(t).toBeCloseTo(plain.intervals[i] * 0.5));
  });

  it('Horde caps its raised bot count at 48, even over a Daily Swarm', () => {
    const { sv } = rig();
    sv.reset({ ...dailyFor('2026-11-13'), modifierId: 'swarm' });
    let hordes = 0;
    for (let w = 1; w <= 60; w++) {
      sv.nextWave();
      if (sv.modifier?.id === 'horde') {
        hordes++;
        // (a Thief Raid's 2 lead scrappers ride on top of its capped thieves, as on any wave)
        expect(bots(sv)).toBeLessThanOrEqual(48 + 2);
      }
      sv.waveCleared();
    }
    expect(hordes).toBeGreaterThan(0);
  });

  it('Blizzard pushes the whiteout gale for its wave and lifts it on the clear and on a new run', () => {
    const { ctx, sv } = rig();
    forceModifier(sv, 7, 'blizzard');
    ctx.world.setStorm.mockClear();
    playTo(sv, 7);
    expect(ctx.world.setStorm).toHaveBeenLastCalledWith(true);
    expect(sv.zone.enemySpeedMult).toBeLessThan(1);
    sv.waveCleared();
    expect(ctx.world.setStorm).toHaveBeenLastCalledWith(false);
    // wrecked mid-Blizzard, then a retry: the new run starts clear
    forceModifier(sv, 7, 'blizzard');
    playTo(sv, 7);
    expect(ctx.world.setStorm).toHaveBeenLastCalledWith(true);
    sv.reset(null);
    expect(ctx.world.setStorm).toHaveBeenLastCalledWith(false);
  });

  it('the Daily rolls the same modifiers for everyone without touching its seeded lineups', () => {
    const spec = { ...dailyFor('2026-11-13'), modifierId: 'heavyHitters' as const };
    const a = rig().sv;
    const b = rig().sv;
    a.reset(spec);
    b.reset(spec);
    for (let w = 1; w <= 40; w++) expect(a.modifierFor(w)).toBe(b.modifierFor(w));
    const spy = vi.spyOn(Math, 'random');
    a.reset(spec);
    playTo(a, 8);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('milestones', () => {
  it('every 10th wave; the mini-boss rotates, never doubles a lineup boss, and skips twin lineups', () => {
    expect([9, 10, 11, 20, 30].map(isMilestone)).toEqual([false, true, false, true, true]);
    expect(miniBossFor(9, [])).toBeNull();
    expect(miniBossFor(10, ['bulldoza'])).toBe('frostbyte');
    expect(miniBossFor(20, ['slush', 'sleet'])).toBeNull();
    for (let w = MILESTONE_EVERY; w <= 200; w += MILESTONE_EVERY) {
      for (const lineup of [[], ['frostbyte'], ['bulldoza'], ['grinder'], ['omega']] as const) {
        const m = miniBossFor(w, lineup);
        expect(m).not.toBeNull();
        expect(lineup as readonly string[]).not.toContain(m);
        expect(MINI_BOSSES).toContain(m);
        expect(ENEMIES[m!].isBoss).toBe(true);
      }
    }
    expect(new Set([10, 20, 30].map((w) => miniBossFor(w, [])))).toEqual(new Set(MINI_BOSSES));
  });

  it('wave 10 brings a scaled mini-boss in after the cycle boss', () => {
    const { sv } = rig();
    playTo(sv, 10);
    expect(sv.boss?.name).toBe('BULLDOZA');
    expect(sv.miniBoss).toBe('frostbyte');
    expect(sv.lineupBosses).toEqual(['bulldoza', 'frostbyte']);
    const round = sv.zone.rounds[0];
    expect(round.boss).toBe(true);
    const mini = round.groups.find((g) => g.type === 'frostbyte')!;
    expect(mini).toMatchObject({ count: 1, hpMult: MINIBOSS_HP });
    expect(mini.delay).toBeGreaterThan(round.groups[0].delay);
    expect(sv.hud().tag).toBe('🏆 MILESTONE');
  });

  it('clearing a milestone pays its coins on top of the wave bonus, repairs the plow, and buys a longer breather', () => {
    const { ctx, sv, p } = rig();
    playTo(sv, 10);
    ctx.plow.hp = 10;
    const before = p.coins;
    const bonus = sv.waveCleared();
    expect(sv.milestone).toMatchObject({ wave: 10, coins: milestoneCoins(10) });
    expect(p.coins - before).toBe(bonus + milestoneCoins(10));
    expect(ctx.plow.hp).toBeGreaterThanOrEqual(10 + MILESTONE_HEAL * ctx.plow.maxHp);
    expect(sv.milestone!.healed).toBeCloseTo(ctx.plow.hp - 10);
    expect(sv.nextWave()).toBe(MILESTONE_BREATHER_SECONDS);
    expect(sv.milestone).toBeNull();
    expect(sv.miniBoss).toBeNull();
  });

  it('on Boss Rush a milestone off the boss cadence still gets its mini-boss as a boss round', () => {
    const { sv } = rig();
    sv.reset({ ...dailyFor('2026-11-13'), modifierId: 'bossRush' });
    playTo(sv, 10);
    expect(sv.isBossWave).toBe(false);
    expect(sv.miniBoss).not.toBeNull();
    expect(sv.zone.rounds[0].boss).toBe(true);
    expect(sv.zone.bossName).toBe(ENEMIES[sv.miniBoss!].name);
  });

  it('the pit stop previews the mini-boss the milestone then plays (none on a twin lineup)', () => {
    for (const spec of [null, { ...dailyFor('2026-11-13'), modifierId: 'bossRush' as const }]) {
      const { sv } = rig();
      sv.reset(spec);
      for (let w = 1; w <= 60; w++) {
        const preview = sv.miniBossAt(w);
        sv.nextWave();
        expect(sv.miniBoss).toBe(preview);
        sv.waveCleared();
      }
    }
    const { sv } = rig();
    expect(sv.bossFor(20)?.types).toEqual(['slush', 'sleet']);
    expect(sv.miniBossAt(20)).toBeNull();
    expect(sv.miniBossAt(10)).toBe('frostbyte');
  });

  it('milestone loot always drops', () => {
    expect(LOOT_RULES.survivalMilestone.chance).toBe(1);
  });
});

describe('per-plow best wave', () => {
  it('normal runs record the selected plow; the Daily does not', () => {
    const { sv, p } = rig();
    p.data.plow = 'volt';
    playTo(sv, 4);
    sv.finish(0);
    expect(survivalBestFor(p, 'volt')).toBe(4);
    expect(survivalBestFor(p, 'classic')).toBe(0);
    expect(sv.plowRecord).toEqual({ plow: 'volt', best: 4, newBest: true });
    sv.reset(null);
    playTo(sv, 2);
    sv.finish(0);
    expect(sv.plowRecord).toEqual({ plow: 'volt', best: 4, newBest: false });
    sv.reset(dailyFor('2026-11-13'));
    playTo(sv, 9);
    sv.finish(0);
    expect(survivalBestFor(p, 'volt')).toBe(4);
    expect(sv.plowRecord).toBeNull();
  });

  it('survives a save round trip; unknown plows and junk are dropped', () => {
    const a = new Progression();
    recordSurvivalPlow(a, 'brute', 17);
    expect(recordSurvivalPlow(a, 'brute', 12)).toBe(false);
    const b = new Progression();
    const raw = { ...a.data, survivalBestByPlow: { ...a.data.survivalBestByPlow, hovercraft: 99, volt: 'x' } };
    expect(b.importSave(JSON.stringify(raw)).ok).toBe(true);
    expect(b.data.survivalBestByPlow).toEqual({ brute: 17 });
  });
});

describe('spawn table hook', () => {
  it('every SURVIVAL_MINIONS entry shows up in normal waves', () => {
    const { sv } = rig();
    const seen = new Set<string>();
    for (let w = 1; w <= 30; w++) {
      sv.nextWave();
      if (!sv.isBossWave && !sv.special) for (const g of sv.zone.rounds[0].groups) seen.add(g.type);
      sv.waveCleared();
    }
    for (const m of SURVIVAL_MINIONS) expect(seen).toContain(m.type);
  });
});

describe('spawn group hp multiplier', () => {
  it('WaveDirector scales a group with hpMult on top of the zone multiplier', async () => {
    const { WaveDirector } = await import('../src/entities/Waves');
    const spawn = vi.fn();
    const zone = {
      theme: 'lake', enemyHpMult: 2,
      rounds: [{ boss: true, groups: [
        { type: 'bulldoza', count: 1, delay: 0, interval: 1 },
        { type: 'frostbyte', count: 1, delay: 1, interval: 1, hpMult: MINIBOSS_HP },
      ] }],
    };
    const ctx = { zone, enemies: { spawn, aliveCount: () => 0 } };
    const wd = new WaveDirector(ctx as unknown as GameContext);
    wd.start(zone as unknown as GameContext['zone'], 0);
    wd.update(5);
    const hp = Object.fromEntries(spawn.mock.calls.map((c) => [c[0], c[3].hpMult]));
    expect(hp.bulldoza).toBe(2);
    expect(hp.frostbyte).toBeCloseTo(2 * MINIBOSS_HP);
  });
});
