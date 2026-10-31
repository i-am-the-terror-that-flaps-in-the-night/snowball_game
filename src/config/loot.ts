import { GEAR, GEAR_MAX_LEVEL, RARITY_COLOR, type GearDef, type Rarity } from './gear';

/* ------------------------------------------------------------------------------------------------
 * Gear loot: bosses, Hard clears, Survival boss waves and Brawl placements can drop gear. A drop rolls a rarity
 * from its source's weights, then an item of that rarity. New item -> owned at level 1; owned -> +1 item level;
 * already ★10 -> coins instead. Works on GEAR generically (by rarity), never on specific ids.
 * ---------------------------------------------------------------------------------------------- */

export type LootSource = 'bossFirst' | 'boss' | 'hard' | 'survivalBoss' | 'brawl1' | 'brawl2' | 'brawl3';

export interface LootRule {
  /** Chance (0..1) that this source drops anything. */
  chance: number;
  /** Relative rarity weights. */
  weights: Record<Rarity, number>;
  /** Shown on the reveal card. */
  label: string;
}

export const LOOT_RULES: Record<LootSource, LootRule> = {
  bossFirst: { chance: 1, weights: { common: 50, rare: 35, epic: 12, legendary: 3 }, label: 'First clear' },
  boss: { chance: 0.35, weights: { common: 60, rare: 30, epic: 8, legendary: 2 }, label: 'Boss drop' },
  hard: { chance: 1, weights: { common: 20, rare: 40, epic: 28, legendary: 12 }, label: 'Hard clear' },
  survivalBoss: { chance: 0.3, weights: { common: 45, rare: 35, epic: 15, legendary: 5 }, label: 'Boss wave' },
  brawl1: { chance: 1, weights: { common: 35, rare: 40, epic: 18, legendary: 7 }, label: '1st place' },
  brawl2: { chance: 0.4, weights: { common: 55, rare: 32, epic: 10, legendary: 3 }, label: '2nd place' },
  brawl3: { chance: 0.2, weights: { common: 55, rare: 32, epic: 10, legendary: 3 }, label: '3rd place' },
};

/** Survival boss waves: the chance grows by this per wave past wave 5, up to the cap. */
export const SURVIVAL_LOOT_PER_WAVE = 0.02;
export const SURVIVAL_LOOT_MAX = 0.75;

/** A ★10 item that drops again pays this share of its base price in coins. */
export const MAXED_LOOT_COIN_FRAC = 0.5;

export function survivalLootChance(wave: number): number {
  return Math.min(SURVIVAL_LOOT_MAX, LOOT_RULES.survivalBoss.chance + SURVIVAL_LOOT_PER_WAVE * Math.max(0, wave - 5));
}

/** Brawl placement -> loot source (null = nothing for 4th and below). */
export function brawlLootSource(placement: number): LootSource | null {
  return placement === 1 ? 'brawl1' : placement === 2 ? 'brawl2' : placement === 3 ? 'brawl3' : null;
}

export type Rng = () => number;

/** Weighted rarity pick. Rarities with no items in GEAR are skipped. */
export function rollRarity(weights: Record<Rarity, number>, rnd: Rng): Rarity {
  const avail = (Object.keys(weights) as Rarity[]).filter((r) => weights[r] > 0 && GEAR.some((d) => d.rarity === r));
  const total = avail.reduce((s, r) => s + weights[r], 0);
  let x = rnd() * total;
  for (const r of avail) {
    x -= weights[r];
    if (x < 0) return r;
  }
  return avail[avail.length - 1] ?? 'common';
}

/** Uniform item of `rarity` (any item if the rarity is empty). */
export function pickItem(rarity: Rarity, rnd: Rng): GearDef {
  const pool = GEAR.filter((d) => d.rarity === rarity);
  const list = pool.length ? pool : GEAR;
  return list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
}

export interface LootDrop {
  source: LootSource;
  item: string;
  /** new = first copy, level = +1 item level, coins = was already ★10. */
  outcome: 'new' | 'level' | 'coins';
  /** Item level after the drop (unchanged for `coins`). */
  level: number;
  coins: number;
}

/** What a drop of `def` does to an item at `owned` level (0 = not owned). */
export function resolveDrop(source: LootSource, def: GearDef, owned: number): LootDrop {
  if (owned <= 0) return { source, item: def.id, outcome: 'new', level: 1, coins: 0 };
  if (owned < GEAR_MAX_LEVEL) return { source, item: def.id, outcome: 'level', level: owned + 1, coins: 0 };
  return { source, item: def.id, outcome: 'coins', level: owned, coins: Math.round(def.cost * MAXED_LOOT_COIN_FRAC) };
}

export const rarityColor = (r: Rarity) => RARITY_COLOR[r];
