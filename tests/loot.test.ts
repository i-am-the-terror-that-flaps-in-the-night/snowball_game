import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GEAR, GEAR_MAX_LEVEL, type Rarity } from '../src/config/gear';
import {
  LOOT_RULES, MAXED_LOOT_COIN_FRAC, SURVIVAL_LOOT_MAX, brawlLootSource, pickItem, resolveDrop, rollRarity, survivalLootChance, type LootSource,
} from '../src/config/loot';
import { Progression } from '../src/core/Progression';

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

/** Deterministic RNG that replays `xs` (then repeats the last value). */
const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[Math.min(i++, xs.length - 1)];
};

describe('loot tables', () => {
  it('every source has positive weights on at least one stocked rarity and a sane chance', () => {
    for (const [src, rule] of Object.entries(LOOT_RULES)) {
      const total = Object.values(rule.weights).reduce((a, b) => a + b, 0);
      expect(total, src).toBeGreaterThan(0);
      expect(rule.chance, src).toBeGreaterThan(0);
      expect(rule.chance, src).toBeLessThanOrEqual(1);
    }
  });

  it('first clears, Hard clears and Brawl wins are guaranteed; Hard odds beat a repeat clear', () => {
    for (const s of ['bossFirst', 'hard', 'brawl1'] as LootSource[]) expect(LOOT_RULES[s].chance).toBe(1);
    const legendShare = (s: LootSource) => {
      const w = LOOT_RULES[s].weights;
      return (w.epic + w.legendary) / Object.values(w).reduce((a, b) => a + b, 0);
    };
    expect(legendShare('hard')).toBeGreaterThan(legendShare('boss'));
  });

  it('survival chance grows with the wave and caps; brawl placement maps to sources', () => {
    expect(survivalLootChance(5)).toBe(LOOT_RULES.survivalBoss.chance);
    expect(survivalLootChance(20)).toBeGreaterThan(survivalLootChance(10));
    expect(survivalLootChance(999)).toBe(SURVIVAL_LOOT_MAX);
    expect(brawlLootSource(1)).toBe('brawl1');
    expect(brawlLootSource(3)).toBe('brawl3');
    expect(brawlLootSource(4)).toBeNull();
  });

  it('rollRarity follows the weights; pickItem stays in the rarity', () => {
    const w: Record<Rarity, number> = { common: 1, rare: 1, epic: 1, legendary: 1 };
    expect(rollRarity(w, () => 0)).toBe('common');
    expect(rollRarity(w, () => 0.999)).toBe('legendary');
    expect(rollRarity({ common: 0, rare: 0, epic: 5, legendary: 0 }, () => 0.5)).toBe('epic');
    for (const r of ['common', 'rare', 'epic', 'legendary'] as Rarity[]) {
      for (const x of [0, 0.5, 0.999]) expect(pickItem(r, () => x).rarity).toBe(r);
    }
  });

  it('resolveDrop: new item, +1 level, or coins at max', () => {
    const d = GEAR[0];
    expect(resolveDrop('boss', d, 0)).toMatchObject({ outcome: 'new', level: 1, coins: 0 });
    expect(resolveDrop('boss', d, 4)).toMatchObject({ outcome: 'level', level: 5 });
    expect(resolveDrop('boss', d, GEAR_MAX_LEVEL)).toMatchObject({ outcome: 'coins', level: GEAR_MAX_LEVEL, coins: Math.round(d.cost * MAXED_LOOT_COIN_FRAC) });
  });
});

describe('Progression.rollLoot', () => {
  it('a miss gives nothing; a hit grants the item, equips it into an empty slot and saves', () => {
    const p = new Progression();
    expect(p.rollLoot('boss', seq(0.99))).toBeNull();
    const drop = p.rollLoot('bossFirst', seq(0, 0, 0))!;
    expect(drop.outcome).toBe('new');
    const def = GEAR.find((d) => d.id === drop.item)!;
    expect(def.rarity).toBe('common');
    expect(p.itemLevel(def.id)).toBe(1);
    expect(p.isEquipped(def.id)).toBe(true);
    expect(new Progression().itemLevel(def.id)).toBe(1);
  });

  it('levels up an owned item without touching a different equipped item, and pays coins at max', () => {
    const p = new Progression();
    const first = p.rollLoot('bossFirst', seq(0, 0, 0))!;
    const other = GEAR.find((d) => d.slot === GEAR.find((x) => x.id === first.item)!.slot && d.id !== first.item)!;
    p.data.gear!.owned[other.id] = 1;
    p.data.gear!.equipped[other.slot] = other.id;
    const again = p.rollLoot('bossFirst', seq(0, 0, 0))!;
    expect(again).toMatchObject({ item: first.item, outcome: 'level', level: 2 });
    expect(p.isEquipped(other.id)).toBe(true);
    p.data.gear!.owned[first.item] = GEAR_MAX_LEVEL;
    const coins = p.coins;
    const maxed = p.rollLoot('bossFirst', seq(0, 0, 0))!;
    expect(maxed.outcome).toBe('coins');
    expect(p.coins).toBe(coins + maxed.coins);
    expect(p.itemLevel(first.item)).toBe(GEAR_MAX_LEVEL);
  });

  it('the chance override is respected', () => {
    const p = new Progression();
    expect(p.rollLoot('survivalBoss', seq(0.5), 0.4)).toBeNull();
    expect(p.rollLoot('survivalBoss', seq(0.5, 0, 0), 0.6)).not.toBeNull();
  });
});
