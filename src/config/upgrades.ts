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
  | 'snowMachine'
  | 'magnet'
  | 'whirl'
  | 'frostCore'
  | 'avalancheCore'
  | 'iceShield';

export type UpgradeCategory = 'plow' | 'ball' | 'defense' | 'special';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  icon: string;
  category: UpgradeCategory;
  description: string;
  maxLevel: number;
  baseCost: number;
  costGrowth: number;
  /** Short human-readable value at a given level, e.g. "12.2 m/s". */
  valueLabel: (level: number) => string;
}

const owned = (l: number) => (l ? 'Installed' : 'Locked');

export const UPGRADES: UpgradeDef[] = [
  { id: 'engine', name: 'V8 Engine', icon: '⚙️', category: 'plow', description: 'Top speed, acceleration and steering.', maxLevel: 5, baseCost: 40, costGrowth: 1.7, valueLabel: (l) => `${(10 + 1.4 * l).toFixed(1)} m/s` },
  { id: 'blade', name: 'Wide Blade', icon: '🔪', category: 'plow', description: 'A wider blade scoops more snow and hits a wider area.', maxLevel: 5, baseCost: 45, costGrowth: 1.7, valueLabel: (l) => `${(2.6 + 0.4 * l).toFixed(1)} m wide` },
  { id: 'ramSpikes', name: 'Ram Spikes', icon: '🦔', category: 'plow', description: 'Ramming bots at speed hurts them more.', maxLevel: 5, baseCost: 50, costGrowth: 1.75, valueLabel: (l) => `${14 + 5 * l} ram dmg` },
  { id: 'nitro', name: 'Nitro Dash', icon: '🔥', category: 'plow', description: 'SHIFT dash recharges faster and goes farther.', maxLevel: 3, baseCost: 70, costGrowth: 1.9, valueLabel: (l) => `${(2.4 - 0.4 * l).toFixed(1)}s recharge, +${16 + 3 * l} m/s` },
  { id: 'whirl', name: 'Whirlwind Turbine', icon: '🌀', category: 'plow', description: 'Bigger, harder-hitting E spin that recharges faster.', maxLevel: 3, baseCost: 80, costGrowth: 1.9, valueLabel: (l) => `${(4 + 0.7 * l).toFixed(1)} m, ${10 + 4 * l}x4 dmg, ${6 - l}s` },
  { id: 'compactor', name: 'Snow Compactor', icon: '🧊', category: 'ball', description: 'Packs more plowed snow into your snowball.', maxLevel: 5, baseCost: 50, costGrowth: 1.75, valueLabel: (l) => `${Math.round((0.12 + 0.035 * l) * 100)}% packing` },
  { id: 'hopper', name: 'Mega Hopper', icon: '⚪', category: 'ball', description: 'Raises the maximum snowball size.', maxLevel: 5, baseCost: 60, costGrowth: 1.8, valueLabel: (l) => `max ${(1.2 + 0.3 * l).toFixed(1)} m radius` },
  { id: 'packedIce', name: 'Packed Ice', icon: '💎', category: 'ball', description: 'Snowball slams hit much harder.', maxLevel: 5, baseCost: 70, costGrowth: 1.8, valueLabel: (l) => `x${(1 + 0.25 * l).toFixed(2)} slam damage` },
  { id: 'armor', name: 'Armor Plating', icon: '🛡️', category: 'defense', description: 'More plow hit points.', maxLevel: 5, baseCost: 40, costGrowth: 1.65, valueLabel: (l) => `${120 + 35 * l} HP` },
  { id: 'plating', name: 'Reinforced Frame', icon: '🔩', category: 'defense', description: 'Take less damage from every hit.', maxLevel: 5, baseCost: 60, costGrowth: 1.8, valueLabel: (l) => `-${5 * l}% damage taken` },
  { id: 'repairKit', name: 'Repair Kit', icon: '🧰', category: 'defense', description: 'Repairs more between rounds and slowly regenerates HP.', maxLevel: 3, baseCost: 60, costGrowth: 1.9, valueLabel: (l) => `${Math.round((0.35 + 0.2 * l) * 100)}% repair, ${(0.8 * l).toFixed(1)} HP/s` },
  { id: 'snowMachine', name: 'Snow Machine', icon: '🌨️', category: 'defense', description: 'Snow falls back onto plowed ground faster.', maxLevel: 3, baseCost: 80, costGrowth: 1.9, valueLabel: (l) => `x${1 + l} snowfall` },
  { id: 'magnet', name: 'Bolt Magnet', icon: '🧲', category: 'defense', description: 'Grab dropped coins from farther away.', maxLevel: 3, baseCost: 35, costGrowth: 1.8, valueLabel: (l) => `${4 + 3 * l} m reach` },
  { id: 'iceShield', name: 'Ice Shield', icon: '🧱', category: 'special', description: 'Your held snowball blocks 75% of frontal damage (instead of 40%).', maxLevel: 1, baseCost: 240, costGrowth: 1, valueLabel: owned },
  { id: 'frostCore', name: 'Frost Core', icon: '❄️', category: 'special', description: 'Slams freeze bots, slowing them for 3s.', maxLevel: 1, baseCost: 300, costGrowth: 1, valueLabel: owned },
  { id: 'avalancheCore', name: 'Avalanche Core', icon: '🌋', category: 'special', description: 'Slams hit a 50% wider area and knock bots flying.', maxLevel: 1, baseCost: 400, costGrowth: 1, valueLabel: owned },
];

export const UPGRADE_BY_ID: Record<UpgradeId, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u])) as Record<UpgradeId, UpgradeDef>;

export function upgradeCost(def: UpgradeDef, currentLevel: number): number {
  return Math.round(def.baseCost * Math.pow(def.costGrowth, currentLevel));
}
