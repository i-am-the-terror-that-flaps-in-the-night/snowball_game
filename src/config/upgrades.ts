export type UpgradeId =
  | 'engine'
  | 'blade'
  | 'compactor'
  | 'hopper'
  | 'packedIce'
  | 'ramSpikes'
  | 'armor'
  | 'plating'
  | 'repairKit'
  | 'nitro'
  | 'whirl'
  | 'snowMachine'
  | 'magnet'
  | 'frostCore'
  | 'avalancheCore'
  | 'iceShield'
  // Pilot perks — player-only: Brawl rivals never roll these.
  | 'salvage'
  | 'secondWind'
  | 'wreckingBall'
  | 'adrenaline'
  | 'inferno'
  | 'vitality'
  | 'overclock';

export type UpgradeCategory = 'plow' | 'ball' | 'defense' | 'pilot' | 'special';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  icon: string;
  category: UpgradeCategory;
  description: string;
  /** Levels at full strength (shown as pips). ENDLESS upgrades keep going past this with tapering or
   *  steady gains; one-time specials stop here. */
  pips: number;
  /** Hard cap: Infinity for endless upgrades, 1 for specials. */
  maxLevel: number;
  baseCost: number;
  /** Cost multiplier per level up to `pips`; past it every level costs ENDLESS_COST_GROWTH times more. */
  costGrowth: number;
  /** Short human-readable value at a given level, e.g. "12.2 m/s". */
  valueLabel: (level: number) => string;
  /** Player-only: Brawl rivals never copy this upgrade into their rolled garages. */
  playerOnly?: boolean;
}

/** Cost multiplier per level beyond an upgrade's pips. */
export const ENDLESS_COST_GROWTH = 1.22;

/* ------------------------------------------------------------------ endless scaling curves */

/** Linear up to `knee`, then eases toward knee + span: diminishing returns with a ceiling (physical stats
 *  like speed, sizes and cooldowns, so endless levels never break the game's physics). */
export const soft = (L: number, knee: number, span = knee) => (L <= knee ? L : knee + span * (1 - Math.exp(-(L - knee) / span)));
/** Linear up to `knee`, then keeps growing at `rate` per level forever (damage, hp, regen). */
export const grow = (L: number, knee: number, rate = 0.6) => (L <= knee ? L : knee + (L - knee) * rate);

/** Every upgrade's effect by level — the single source for Progression.computeStats and the shop labels.
 *  Levels up to each upgrade's pips match the original (pre-endless) formulas exactly. */
export const FX = {
  maxSpeed: (L: number) => 10 + 1.4 * soft(L, 5),
  accel: (L: number) => 14 + 3 * soft(L, 5),
  turnRate: (L: number) => 2.6 + 0.15 * soft(L, 5),
  bladeWidth: (L: number) => 2.6 + 0.4 * soft(L, 5),
  ramDamage: (L: number) => 14 + 5 * grow(L, 5),
  dashCooldown: (L: number) => (L <= 3 ? 2.4 - 0.4 * L : 0.5 + 0.7 * Math.exp(-(L - 3) / 5)),
  dashPower: (L: number) => 16 + 3 * soft(L, 3, 2),
  whirlRadius: (L: number) => 4 + 0.7 * soft(L, 3),
  whirlDamage: (L: number) => 10 + 4 * grow(L, 3),
  whirlCooldown: (L: number) => (L <= 3 ? 6 - L : 2 + Math.exp(-(L - 3) / 5)),
  collectRate: (L: number) => 0.12 + 0.035 * soft(L, 5),
  maxBallRadius: (L: number) => 1.2 + 0.3 * soft(L, 5, 4),
  damageMult: (L: number) => 1 + 0.25 * grow(L, 5),
  maxHp: (L: number) => 120 + 35 * grow(L, 5),
  damageTaken: (L: number) => 1 - 0.05 * soft(L, 5),
  repairFraction: (L: number) => Math.min(1, 0.35 + 0.2 * soft(L, 3)),
  hpRegen: (L: number) => 0.8 * grow(L, 3),
  snowRegen: (L: number) => 0.006 * (1 + soft(L, 3)),
  magnetRadius: (L: number) => 4 + 3 * soft(L, 3),
  // ---- Pilot perks (player-only)
  /** Fraction of damage you deal that repairs your plow. */
  lifesteal: (L: number) => 0.03 * soft(L, 5),
  /** Seconds between Second Wind saves (Infinity = not owned). */
  secondWindCd: (L: number) => (L <= 0 ? Infinity : 30 + 60 * Math.exp(-(L - 1) / 4)),
  /** Extra Brawl hit cap on YOUR hits (fraction of the target's max hp). */
  hitCapBonus: (L: number) => 0.06 * soft(L, 5, 5 / 3),
  /** Fraction of the dash + whirl recharge refunded when you wreck something. */
  killRecharge: (L: number) => Math.min(1, 0.2 * soft(L, 4, 2)),
  /** Inferno (F): flame cone reach (m), burn damage per second, recharge (s). Level 0 = not owned. */
  flameRange: (L: number) => 7.5 + 0.6 * soft(L, 5),
  flameDps: (L: number) => (L <= 0 ? 0 : 32 + 14 * grow(L - 1, 4)),
  flameCooldown: (L: number) => (L <= 0 ? Infinity : 4 + 4 * Math.exp(-(L - 1) / 4)),
  /** Vitality: flat bonus HP on top of Armor Plating (rivals never get it). */
  bonusHp: (L: number) => 40 * grow(L, 5),
  /** Overclock: multiplier on every ability cooldown (slam, dash, whirl, fire). 10 levels: 1 -> 0. */
  cooldownMult: (L: number) => Math.max(0, 1 - L / 10),
};

const owned = (l: number) => (l ? 'Installed' : 'Locked');
const f1 = (n: number) => n.toFixed(1);
const ENDLESS = Infinity;

export const UPGRADES: UpgradeDef[] = [
  { id: 'engine', name: 'V8 Engine', icon: '⚙️', category: 'plow', description: 'Top speed, acceleration and steering.', pips: 5, maxLevel: ENDLESS, baseCost: 40, costGrowth: 1.7, valueLabel: (l) => `${f1(FX.maxSpeed(l))} m/s` },
  { id: 'blade', name: 'Wide Blade', icon: '🔪', category: 'plow', description: 'A wider blade scoops more snow and hits a wider area.', pips: 5, maxLevel: ENDLESS, baseCost: 45, costGrowth: 1.7, valueLabel: (l) => `${f1(FX.bladeWidth(l))} m wide` },
  { id: 'ramSpikes', name: 'Ram Spikes', icon: '🦔', category: 'plow', description: 'Ramming bots at speed hurts them more.', pips: 5, maxLevel: ENDLESS, baseCost: 50, costGrowth: 1.75, valueLabel: (l) => `${Math.round(FX.ramDamage(l))} ram dmg` },
  { id: 'nitro', name: 'Nitro Dash', icon: '🔥', category: 'plow', description: 'SHIFT dash recharges faster and goes farther.', pips: 3, maxLevel: ENDLESS, baseCost: 70, costGrowth: 1.9, valueLabel: (l) => `${FX.dashCooldown(l).toFixed(2)}s recharge, +${f1(FX.dashPower(l))} m/s` },
  { id: 'whirl', name: 'Whirlwind Turbine', icon: '🌀', category: 'plow', description: 'Bigger, harder-hitting E spin that recharges faster.', pips: 3, maxLevel: ENDLESS, baseCost: 80, costGrowth: 1.9, valueLabel: (l) => `${f1(FX.whirlRadius(l))} m, ${Math.round(FX.whirlDamage(l))}x4 dmg, ${f1(FX.whirlCooldown(l))}s` },
  { id: 'compactor', name: 'Snow Compactor', icon: '🧊', category: 'ball', description: 'Packs more plowed snow into your snowball.', pips: 5, maxLevel: ENDLESS, baseCost: 50, costGrowth: 1.75, valueLabel: (l) => `${Math.round(FX.collectRate(l) * 100)}% packing` },
  { id: 'hopper', name: 'Mega Hopper', icon: '⚪', category: 'ball', description: 'Raises the maximum snowball size.', pips: 5, maxLevel: ENDLESS, baseCost: 60, costGrowth: 1.8, valueLabel: (l) => `max ${FX.maxBallRadius(l).toFixed(2)} m radius` },
  { id: 'packedIce', name: 'Packed Ice', icon: '💎', category: 'ball', description: 'Snowball slams hit much harder.', pips: 5, maxLevel: ENDLESS, baseCost: 70, costGrowth: 1.8, valueLabel: (l) => `x${FX.damageMult(l).toFixed(2)} slam damage` },
  { id: 'armor', name: 'Armor Plating', icon: '🛡️', category: 'defense', description: 'More plow hit points.', pips: 5, maxLevel: ENDLESS, baseCost: 40, costGrowth: 1.65, valueLabel: (l) => `${Math.round(FX.maxHp(l))} HP` },
  { id: 'plating', name: 'Reinforced Frame', icon: '🔩', category: 'defense', description: 'Take less damage from every hit.', pips: 5, maxLevel: ENDLESS, baseCost: 60, costGrowth: 1.8, valueLabel: (l) => `-${f1((1 - FX.damageTaken(l)) * 100)}% damage taken` },
  { id: 'repairKit', name: 'Repair Kit', icon: '🧰', category: 'defense', description: 'Repairs more between rounds and slowly regenerates HP.', pips: 3, maxLevel: ENDLESS, baseCost: 60, costGrowth: 1.9, valueLabel: (l) => `${Math.round(FX.repairFraction(l) * 100)}% repair, ${f1(FX.hpRegen(l))} HP/s` },
  { id: 'snowMachine', name: 'Snow Machine', icon: '🌨️', category: 'defense', description: 'Snow falls back onto plowed ground faster.', pips: 3, maxLevel: ENDLESS, baseCost: 80, costGrowth: 1.9, valueLabel: (l) => `x${f1(1 + soft(l, 3))} snowfall` },
  { id: 'magnet', name: 'Bolt Magnet', icon: '🧲', category: 'defense', description: 'Grab dropped coins from farther away.', pips: 3, maxLevel: ENDLESS, baseCost: 35, costGrowth: 1.8, valueLabel: (l) => `${f1(FX.magnetRadius(l))} m reach` },
  { id: 'salvage', name: 'Salvage Rig', icon: '🔧', category: 'pilot', playerOnly: true, description: 'Every hit you land repairs your plow by a share of the damage.', pips: 5, maxLevel: ENDLESS, baseCost: 90, costGrowth: 1.8, valueLabel: (l) => `${f1(FX.lifesteal(l) * 100)}% lifesteal` },
  { id: 'secondWind', name: 'Second Wind', icon: '💨', category: 'pilot', playerOnly: true, description: 'A lethal hit leaves you at 1 HP with 1.5s of invulnerability instead. Recharges.', pips: 5, maxLevel: ENDLESS, baseCost: 150, costGrowth: 1.8, valueLabel: (l) => (l ? `every ${Math.round(FX.secondWindCd(l))}s` : 'Locked') },
  { id: 'wreckingBall', name: 'Wrecking Ball', icon: '🏗️', category: 'pilot', playerOnly: true, description: 'Your hits punch through the Brawl hit cap (bots stay capped at 60%).', pips: 5, maxLevel: ENDLESS, baseCost: 120, costGrowth: 1.8, valueLabel: (l) => `${Math.round((0.6 + FX.hitCapBonus(l)) * 100)}% max hit` },
  { id: 'adrenaline', name: 'Adrenaline', icon: '⚡', category: 'pilot', playerOnly: true, description: 'Wrecking a bot instantly refunds part of your dash and whirl recharge.', pips: 4, maxLevel: ENDLESS, baseCost: 80, costGrowth: 1.8, valueLabel: (l) => `${Math.round(FX.killRecharge(l) * 100)}% refund on kill` },
  { id: 'inferno', name: 'Inferno Exhaust', icon: '🔥', category: 'pilot', playerOnly: true, description: 'Press F to roar a cone of fire from your blade: scorches everything in it, sets bots ablaze for 4s (burning bots take +20% damage from everything) and melts snow.', pips: 5, maxLevel: ENDLESS, baseCost: 160, costGrowth: 1.8, valueLabel: (l) => (l ? `${Math.round(FX.flameDps(l))} burn/s, ${f1(FX.flameRange(l))} m, ${f1(FX.flameCooldown(l))}s` : 'Locked') },
  { id: 'vitality', name: 'Vitality Core', icon: '❤️', category: 'pilot', playerOnly: true, description: 'Bonus hit points on top of Armor Plating.', pips: 5, maxLevel: ENDLESS, baseCost: 70, costGrowth: 1.75, valueLabel: (l) => `+${Math.round(FX.bonusHp(l))} HP` },
  { id: 'overclock', name: 'Overclock', icon: '⏱️', category: 'pilot', playerOnly: true, description: 'Cuts EVERY ability cooldown (slam, dash, whirl, fire) by 10% per level. Level 10: no cooldowns at all.', pips: 10, maxLevel: 10, baseCost: 150, costGrowth: 1.6, valueLabel: (l) => (l >= 10 ? 'NO COOLDOWNS' : `-${l * 10}% cooldowns`) },
  { id: 'iceShield', name: 'Ice Shield', icon: '🧱', category: 'special', description: 'Your held snowball blocks 75% of frontal damage (instead of 40%).', pips: 1, maxLevel: 1, baseCost: 240, costGrowth: 1, valueLabel: owned },
  { id: 'frostCore', name: 'Frost Core', icon: '❄️', category: 'special', description: 'Slams freeze bots, slowing them for 3s.', pips: 1, maxLevel: 1, baseCost: 300, costGrowth: 1, valueLabel: owned },
  { id: 'avalancheCore', name: 'Avalanche Core', icon: '🌋', category: 'special', description: 'Slams hit a 50% wider area and knock bots flying.', pips: 1, maxLevel: 1, baseCost: 400, costGrowth: 1, valueLabel: owned },
];

export const UPGRADE_BY_ID: Record<UpgradeId, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u])) as Record<UpgradeId, UpgradeDef>;

export function upgradeCost(def: UpgradeDef, currentLevel: number): number {
  const full = Math.min(currentLevel, def.pips);
  const extra = Math.max(0, currentLevel - def.pips);
  return Math.round(def.baseCost * Math.pow(def.costGrowth, full) * Math.pow(ENDLESS_COST_GROWTH, extra));
}
