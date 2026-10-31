import { UPGRADE_BY_ID, type UpgradeId } from './upgrades';

/** Gear: items you buy once, level up, and equip one per slot (Prodigy-style). Each item grants levels of the
 *  stats that left the Garage (ITEM_STATS in config/upgrades.ts); those levels then go through the same FX curves
 *  as everything else, so Combat / Brawl / Duel see ordinary upgrade levels. */
export type GearSlot = 'blade' | 'chassis' | 'booster' | 'core' | 'charm';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface GearGrant {
  stat: UpgradeId;
  /** Levels granted at item level 1. */
  base: number;
  /** Extra levels per item level after the first (fractions round down). */
  per: number;
}

export interface GearDef {
  id: string;
  name: string;
  icon: string;
  slot: GearSlot;
  rarity: Rarity;
  description: string;
  /** Price to buy (item level 1). */
  cost: number;
  grants: GearGrant[];
}

export const GEAR_SLOTS: { id: GearSlot; name: string; icon: string }[] = [
  { id: 'blade', name: 'Blade', icon: '🔪' },
  { id: 'chassis', name: 'Chassis', icon: '🛡️' },
  { id: 'booster', name: 'Booster', icon: '🚀' },
  { id: 'core', name: 'Core', icon: '💠' },
  { id: 'charm', name: 'Charm', icon: '🍀' },
];

export const RARITY_COLOR: Record<Rarity, string> = { common: '#8fa3b8', rare: '#3fa7f0', epic: '#b05cf0', legendary: '#ffb020' };

/** Items level 1 -> GEAR_MAX_LEVEL. */
export const GEAR_MAX_LEVEL = 10;
/** Cost of the next item level = cost x GEAR_LEVEL_COST x GEAR_LEVEL_GROWTH^(level - 1). */
export const GEAR_LEVEL_COST = 0.6;
export const GEAR_LEVEL_GROWTH = 1.35;

const g = (stat: UpgradeId, base: number, per: number): GearGrant => ({ stat, base, per });

export const GEAR: GearDef[] = [
  // Every gear stat comes from exactly ONE item (its headline). Items whose headline is a one-time core (Frost,
  // Avalanche, Ice Shield) get one small levelling secondary that no other item in their slot touches.
  // ---- Blade
  { id: 'steelWedge', name: 'Steel Wedge', icon: '🔪', slot: 'blade', rarity: 'common', cost: 60, description: 'A wider blade: slams hit a bigger area.', grants: [g('blade', 1, 0.6)] },
  { id: 'spikedShare', name: 'Spiked Plowshare', icon: '🦔', slot: 'blade', rarity: 'rare', cost: 300, description: 'Bristling with spikes: rams and dash strikes hurt a lot more.', grants: [g('ramSpikes', 2, 0.8)] },
  { id: 'frostEdge', name: 'Frostbite Edge', icon: '❄️', slot: 'blade', rarity: 'epic', cost: 1000, description: 'Slams freeze bots for 3s. Also a stronger whirlwind.', grants: [g('frostCore', 1, 0), g('whirl', 1, 0.3)] },
  { id: 'avalancheBlade', name: 'Avalanche Blade', icon: '🌋', slot: 'blade', rarity: 'legendary', cost: 1600, description: 'Slams hit 50% wider and send bots flying. Also, snow piles back faster.', grants: [g('avalancheCore', 1, 0), g('snowMachine', 1, 0.3)] },
  // ---- Chassis
  { id: 'rivetedFrame', name: 'Riveted Frame', icon: '🔩', slot: 'chassis', rarity: 'common', cost: 60, description: 'Take less damage from every hit.', grants: [g('plating', 1, 0.6)] },
  { id: 'scrapRecycler', name: 'Scrap Recycler', icon: '🔧', slot: 'chassis', rarity: 'rare', cost: 380, description: 'Part of the damage you deal repairs your plow.', grants: [g('salvage', 1, 0.7)] },
  { id: 'glacierShell', name: 'Glacier Shell', icon: '🧱', slot: 'chassis', rarity: 'epic', cost: 850, description: 'Your snowball blocks 75% of frontal damage. Also packs snow into it faster.', grants: [g('iceShield', 1, 0), g('compactor', 1, 0.3)] },
  { id: 'phoenixPlating', name: 'Phoenix Plating', icon: '❤️‍🔥', slot: 'chassis', rarity: 'legendary', cost: 1600, description: 'Survive a lethal hit (Second Wind) and hit harder below 35% HP (Last Stand).', grants: [g('secondWind', 1, 0.6), g('lastStand', 1, 0.5)] },
  // ---- Booster
  { id: 'nitroTank', name: 'Nitro Tank', icon: '🚀', slot: 'booster', rarity: 'common', cost: 80, description: 'Dash recharges faster and goes farther.', grants: [g('nitro', 1, 0.5)] },
  { id: 'turbineFan', name: 'Turbine Fan', icon: '🌀', slot: 'booster', rarity: 'common', cost: 90, description: 'Bigger, harder-hitting whirlwind that recharges faster.', grants: [g('whirl', 1, 0.5)] },
  { id: 'jetTurbine', name: 'Jet Turbine', icon: '✈️', slot: 'booster', rarity: 'rare', cost: 550, description: 'Every kill refunds part of your dash + whirlwind recharge.', grants: [g('adrenaline', 1, 0.5)] },
  // ---- Core
  { id: 'packCompactor', name: 'Pack Compactor', icon: '🧊', slot: 'core', rarity: 'common', cost: 70, description: 'Packs plowed snow into your ball faster.', grants: [g('compactor', 1, 0.6)] },
  { id: 'overclockChip', name: 'Overclock Chip', icon: '⏱️', slot: 'core', rarity: 'legendary', cost: 1500, description: 'Cuts every ability cooldown, up to -60% at max level.', grants: [g('overclock', 1, 1)] },
  // ---- Charm
  { id: 'luckyMagnet', name: 'Lucky Magnet', icon: '🧲', slot: 'charm', rarity: 'common', cost: 50, description: 'Grab dropped coins from farther away.', grants: [g('magnet', 1, 0.6)] },
  { id: 'snowGlobe', name: 'Snow Globe', icon: '🌨️', slot: 'charm', rarity: 'common', cost: 70, description: 'Snow falls back onto plowed ground faster.', grants: [g('snowMachine', 1, 0.6)] },
  { id: 'repairDrone', name: 'Repair Drone', icon: '🧰', slot: 'charm', rarity: 'rare', cost: 340, description: 'Regenerates HP over time and repairs more between rounds.', grants: [g('repairKit', 1, 0.6)] },
];

export const GEAR_BY_ID: Record<string, GearDef> = Object.fromEntries(GEAR.map((d) => [d.id, d]));

/** Items that were cut, with their base price, so old saves get back what they spent on them (see gearSpent). */
export const REMOVED_GEAR: Record<string, Pick<GearDef, 'cost'>> = {
  wreckerCore: { cost: 500 },
  // Its Adrenaline moved to the Jet Turbine and its Last Stand to the Phoenix Plating.
  adrenalineShot: { cost: 380 },
};

/** Items whose price dropped in the one-item-per-stat reshape, with their old base price. Owners get the difference
 *  for the levels they hold back once (Progression, GEAR_PRICE_REV). */
export const REPRICED_GEAR: Record<string, number> = {
  spikedShare: 320,
  avalancheBlade: 1800,
  scrapRecycler: 420,
  glacierShell: 900,
  jetTurbine: 1200,
};
/** Bump when REPRICED_GEAR gains a new round of price cuts. */
export const GEAR_PRICE_REV = 1;

/** Levels of `grant.stat` an item at `level` gives (0 if not owned), capped by the stat's own max. */
export function grantLevels(grant: GearGrant, level: number): number {
  if (level <= 0) return 0;
  return Math.min(UPGRADE_BY_ID[grant.stat].maxLevel, Math.floor(grant.base + grant.per * (level - 1)));
}

/** Price of the next level of an item at `level` (0 = buying it), Infinity at max. */
export function gearCost(def: GearDef, level: number): number {
  if (level >= GEAR_MAX_LEVEL) return Infinity;
  if (level <= 0) return def.cost;
  return Math.round(def.cost * GEAR_LEVEL_COST * Math.pow(GEAR_LEVEL_GROWTH, level - 1));
}

/** Total coins put into an item at `level`. */
export function gearSpent(def: GearDef, level: number): number {
  let t = 0;
  for (let l = 0; l < Math.min(level, GEAR_MAX_LEVEL); l++) t += gearCost(def, l);
  return t;
}

export interface GearState {
  /** item id -> level (>= 1 once bought). */
  owned: Record<string, number>;
  equipped: Partial<Record<GearSlot, string>>;
}

/** Stat levels from the equipped gear. */
export function gearLevels(state: GearState | undefined): Partial<Record<UpgradeId, number>> {
  const out: Partial<Record<UpgradeId, number>> = {};
  if (!state) return out;
  for (const slot of GEAR_SLOTS) {
    const id = state.equipped[slot.id];
    const def = id ? GEAR_BY_ID[id] : undefined;
    if (!def || def.slot !== slot.id) continue;
    const lvl = state.owned[def.id] ?? 0;
    for (const gr of def.grants) {
      const n = grantLevels(gr, lvl);
      if (n > 0) out[gr.stat] = Math.min(UPGRADE_BY_ID[gr.stat].maxLevel, (out[gr.stat] ?? 0) + n);
    }
  }
  return out;
}

/** Short "+2 Wide Blade · +1 Ram Spikes" list for a card. */
export function grantLabel(def: GearDef, level: number): string {
  return def.grants
    .map((gr) => {
      const n = grantLevels(gr, Math.max(1, level));
      const u = UPGRADE_BY_ID[gr.stat];
      return u.maxLevel === 1 ? (n ? u.name : '') : n ? `+${n} ${u.name}` : '';
    })
    .filter(Boolean)
    .join(' · ');
}
