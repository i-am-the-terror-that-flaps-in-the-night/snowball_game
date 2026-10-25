import type { PlowKind } from './plows';

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
  | 'lastStand'
  | 'overclock'
  // Classic Plow line (only active while driving the Classic Plow; player-only).
  | 'inferno'
  | 'classicShatter'
  | 'classicReserve'
  | 'classicCombo'
  // VOLT-9 plow line (only active while driving VOLT-9; player-only).
  | 'voltChain'
  | 'voltField'
  | 'voltClap'
  | 'voltCell'
  // BRUTUS plow line (only active while driving BRUTUS; player-only).
  | 'brutePound'
  | 'bruteHide'
  | 'bruteMomentum'
  | 'bruteSaws';

export type UpgradeCategory = 'plow' | 'ball' | 'defense' | 'utility' | 'pilot' | 'classic' | 'volt' | 'brute' | 'special';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  icon: string;
  category: UpgradeCategory;
  /** One line on the shop card. */
  description: string;
  /** Longer mechanics text, shown as the card's tooltip. */
  details?: string;
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
  /** Only takes effect while driving this starter plow (see config/plows.ts). */
  plowOnly?: PlowKind;
}

/** Cost multiplier per level beyond an upgrade's pips. */
export const ENDLESS_COST_GROWTH = 1.1;
/** Every upgrade's listed costGrowth is softened by this much (1.7 -> ~1.39 per level), so repeat levels stay
 *  affordable for every upgrade and plow line. */
export const COST_GROWTH_SOFTEN = 0.55;

/** Hard floor on every player ability recharge (slam, dash, whirl, F ability) after Overclock: nothing is ever
 *  free to spam. */
export const MIN_COOLDOWN = 0.35;
/** Last Stand kicks in below this fraction of max hp. */
export const LAST_STAND_HP = 0.35;
/** Slam Combo (Classic Plow): a landed slam within this many seconds of the last one adds a stack, up to COMBO_MAX. */
export const COMBO_WINDOW = 4;
export const COMBO_MAX = 3;

/** Applies an Overclock multiplier to a base cooldown, never going below MIN_COOLDOWN. */
export const cooldown = (base: number, mult: number) => Math.max(MIN_COOLDOWN, base * mult);

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
  /** Inferno (F on the Classic Plow, free at level 0): flame cone reach (m), burn damage per second, recharge (s). */
  flameRange: (L: number) => 8.5 + 0.8 * soft(L, 5),
  flameDps: (L: number) => 45 + 26 * grow(L, 5),
  flameCooldown: (L: number) => 2.5 + 3.5 * Math.exp(-L / 4),
  /** Last Stand: below LAST_STAND_HP of max hp, you deal this much more damage and take half of it less. */
  lastStand: (L: number) => (L <= 0 ? 0 : 0.1 + 0.04 * soft(L, 5)),
  /** Overclock: multiplier on every ability cooldown (slam, dash, whirl, F ability). 10 levels, -6% each: 1 -> 0.4. */
  cooldownMult: (L: number) => 1 - 0.06 * Math.min(10, Math.max(0, L)),
  // ---- Classic Plow line (level 0 = not owned)
  /** Shatter Slam: bots up to shardReach m beyond the slam zone take shardFrac of the slam's damage. */
  shardFrac: (L: number) => (L <= 0 ? 0 : 0.3 + 0.06 * soft(L, 5)),
  shardReach: (L: number) => (L <= 0 ? 0 : 3 + 0.6 * soft(L, 5)),
  /** Snow Reserve: share of the ball's snow you keep after a slam (capped at 60%). */
  reserveFrac: (L: number) => (L <= 0 ? 0 : Math.min(0.6, 0.15 + 0.05 * soft(L, 5, 4))),
  /** Slam Combo: extra slam damage per combo stack (slams that land within COMBO_WINDOW of the last one). */
  comboStep: (L: number) => (L <= 0 ? 0 : 0.12 + 0.03 * grow(L, 5)),
  // ---- VOLT-9 line (level 0 = not owned)
  /** Chain Lightning: extra bots each of your hits arcs to, and the share of the hit they take. */
  chainCount: (L: number) => (L <= 0 ? 0 : Math.min(6, 1 + Math.floor(soft(L, 5, 4) / 2))),
  chainFrac: (L: number) => (L <= 0 ? 0 : 0.3 + 0.05 * soft(L, 5)),
  /** Tesla Field: passive shock aura radius and damage per second. */
  fieldRadius: (L: number) => (L <= 0 ? 0 : 4.5 + 0.5 * soft(L, 5)),
  fieldDps: (L: number) => (L <= 0 ? 0 : 10 + 6 * grow(L - 1, 4)),
  /** Thunderclap (F on VOLT-9, free at level 0): storm radius, damage (x your damage mult), shock seconds, recharge. */
  clapRadius: (L: number) => 10 + 0.8 * soft(L, 5),
  clapDamage: (L: number) => 70 + 30 * grow(L, 5),
  clapStun: (L: number) => 1.8 + 0.2 * soft(L, 5),
  clapCooldown: (L: number) => 3 + 3 * Math.exp(-L / 4),
  /** Battery Shield: absorbs this much damage, recharging after 3s out of combat. */
  shieldMax: (L: number) => (L <= 0 ? 0 : 35 + 25 * grow(L - 1, 4)),
  // ---- BRUTUS line
  /** Ground Pound (F on BRUTUS, free at level 0): ring radius, damage (x your damage mult), stun s, outward
   *  knockback m/s, recharge. */
  poundRadius: (L: number) => 9.5 + 0.7 * soft(L, 5),
  poundDamage: (L: number) => 160 + 55 * grow(L, 5),
  poundStun: (L: number) => 1.2 + 0.15 * soft(L, 5),
  poundKnock: (L: number) => 12 + 1.5 * soft(L, 5),
  poundCooldown: (L: number) => 3 + 2.5 * Math.exp(-L / 4),
  /** Iron Hide: multiplier on damage taken at speed (stacks with Plating); Combat scales it down when slow. */
  ironHide: (L: number) => 1 - 0.06 * soft(L, 5, 3),
  /** Momentum: extra ram damage per m/s of closing speed, as a fraction (0.04 = +40% at 10 m/s). */
  momentum: (L: number) => (L <= 0 ? 0 : 0.03 + 0.015 * soft(L - 1, 4)),
  /** Buzzsaws: spinning saws on the blade ends grind every bot in the front arc — reach (m) and damage per second
   *  (x your damage mult). BRUTUS's answer to the Tesla Field: hits harder, but only in front and to the sides. */
  sawRadius: (L: number) => (L <= 0 ? 0 : 4.6 + 0.5 * soft(L, 5)),
  sawDps: (L: number) => (L <= 0 ? 0 : 40 + 20 * grow(L - 1, 4)),
};

const owned = (l: number) => (l ? 'Installed' : 'Locked');
const f1 = (n: number) => n.toFixed(1);
const ENDLESS = Infinity;

export const UPGRADES: UpgradeDef[] = [
  { id: 'engine', name: 'V8 Engine', icon: '⚙️', category: 'plow', description: 'Top speed, acceleration and steering.', pips: 5, maxLevel: ENDLESS, baseCost: 40, costGrowth: 1.7, valueLabel: (l) => `${f1(FX.maxSpeed(l))} m/s` },
  { id: 'blade', name: 'Wide Blade', icon: '🔪', category: 'plow', description: 'A wider blade scoops more snow and hits a wider area.', pips: 5, maxLevel: ENDLESS, baseCost: 45, costGrowth: 1.7, valueLabel: (l) => `${f1(FX.bladeWidth(l))} m wide` },
  { id: 'ramSpikes', name: 'Ram Spikes', icon: '🦔', category: 'plow', description: 'Ramming bots at speed hurts them more.', pips: 5, maxLevel: ENDLESS, baseCost: 50, costGrowth: 1.75, valueLabel: (l) => `${Math.round(FX.ramDamage(l))} ram dmg` },
  { id: 'nitro', name: 'Nitro Dash', icon: '🚀', category: 'plow', description: 'SHIFT dash recharges faster and goes farther.', pips: 3, maxLevel: ENDLESS, baseCost: 70, costGrowth: 1.9, valueLabel: (l) => `${FX.dashCooldown(l).toFixed(2)}s recharge, +${f1(FX.dashPower(l))} m/s` },
  { id: 'whirl', name: 'Whirlwind Turbine', icon: '🌀', category: 'plow', description: 'Bigger, harder-hitting E spin that recharges faster.', pips: 3, maxLevel: ENDLESS, baseCost: 80, costGrowth: 1.9, valueLabel: (l) => `${f1(FX.whirlRadius(l))} m, ${Math.round(FX.whirlDamage(l))}x4 dmg, ${f1(FX.whirlCooldown(l))}s` },
  { id: 'compactor', name: 'Snow Compactor', icon: '🧊', category: 'ball', description: 'Packs more plowed snow into your snowball.', pips: 5, maxLevel: ENDLESS, baseCost: 50, costGrowth: 1.75, valueLabel: (l) => `${Math.round(FX.collectRate(l) * 100)}% packing` },
  { id: 'hopper', name: 'Mega Hopper', icon: '🪣', category: 'ball', description: 'Raises the maximum snowball size.', pips: 5, maxLevel: ENDLESS, baseCost: 60, costGrowth: 1.8, valueLabel: (l) => `max ${FX.maxBallRadius(l).toFixed(2)} m radius` },
  { id: 'packedIce', name: 'Packed Ice', icon: '💎', category: 'ball', description: 'Snowball slams hit much harder.', pips: 5, maxLevel: ENDLESS, baseCost: 70, costGrowth: 1.8, valueLabel: (l) => `x${FX.damageMult(l).toFixed(2)} slam damage` },
  { id: 'armor', name: 'Armor Plating', icon: '🛡️', category: 'defense', description: 'More plow hit points.', pips: 5, maxLevel: ENDLESS, baseCost: 40, costGrowth: 1.65, valueLabel: (l) => `${Math.round(FX.maxHp(l))} HP` },
  { id: 'plating', name: 'Reinforced Frame', icon: '🔩', category: 'defense', description: 'Take less damage from every hit.', pips: 5, maxLevel: ENDLESS, baseCost: 60, costGrowth: 1.8, valueLabel: (l) => `-${f1((1 - FX.damageTaken(l)) * 100)}% damage taken` },
  { id: 'repairKit', name: 'Repair Kit', icon: '🧰', category: 'defense', description: 'Repairs more between rounds and slowly regenerates HP.', pips: 3, maxLevel: ENDLESS, baseCost: 60, costGrowth: 1.9, valueLabel: (l) => `${Math.round(FX.repairFraction(l) * 100)}% repair, ${f1(FX.hpRegen(l))} HP/s` },
  { id: 'snowMachine', name: 'Snow Machine', icon: '🌨️', category: 'utility', description: 'Snow falls back onto plowed ground faster.', pips: 3, maxLevel: ENDLESS, baseCost: 80, costGrowth: 1.9, valueLabel: (l) => `x${f1(1 + soft(l, 3))} snowfall` },
  { id: 'magnet', name: 'Bolt Magnet', icon: '🧲', category: 'utility', description: 'Grab dropped coins from farther away.', pips: 3, maxLevel: ENDLESS, baseCost: 35, costGrowth: 1.8, valueLabel: (l) => `${f1(FX.magnetRadius(l))} m reach` },
  { id: 'salvage', name: 'Salvage Rig', icon: '🔧', category: 'pilot', playerOnly: true, description: 'Every hit you land repairs your plow by a share of the damage.', pips: 5, maxLevel: ENDLESS, baseCost: 90, costGrowth: 1.8, valueLabel: (l) => `${f1(FX.lifesteal(l) * 100)}% lifesteal` },
  { id: 'secondWind', name: 'Second Wind', icon: '💨', category: 'pilot', playerOnly: true, description: 'A lethal hit leaves you at 1 HP with 1.5s of invulnerability instead. Recharges.', pips: 5, maxLevel: ENDLESS, baseCost: 150, costGrowth: 1.8, valueLabel: (l) => (l ? `every ${Math.round(FX.secondWindCd(l))}s` : 'Locked') },
  { id: 'wreckingBall', name: 'Wrecking Ball', icon: '🏗️', category: 'pilot', playerOnly: true, description: 'BRAWL ONLY: your hits punch through the Brawl hit cap (bots stay capped at 60%).', details: 'Does nothing in Campaign, Survival or the Tutorial: only Snowdome Brawl caps how much one hit can take.', pips: 5, maxLevel: ENDLESS, baseCost: 120, costGrowth: 1.8, valueLabel: (l) => `${Math.round((0.6 + FX.hitCapBonus(l)) * 100)}% max hit (Brawl)` },
  { id: 'adrenaline', name: 'Adrenaline', icon: '💉', category: 'pilot', playerOnly: true, description: 'Wrecking a bot instantly refunds part of your dash and whirl recharge.', pips: 4, maxLevel: ENDLESS, baseCost: 80, costGrowth: 1.8, valueLabel: (l) => `${Math.round(FX.killRecharge(l) * 100)}% refund on kill` },
  { id: 'lastStand', name: 'Last Stand', icon: '❤️‍🔥', category: 'pilot', playerOnly: true, description: `Below ${LAST_STAND_HP * 100}% HP you hit harder and take less damage.`, details: `While your plow is under ${LAST_STAND_HP * 100}% HP you deal the bonus damage and take half that much less damage.`, pips: 5, maxLevel: ENDLESS, baseCost: 90, costGrowth: 1.75, valueLabel: (l) => (l ? `+${Math.round(FX.lastStand(l) * 100)}% dmg, -${Math.round(FX.lastStand(l) * 50)}% taken` : 'Locked') },
  { id: 'overclock', name: 'Overclock', icon: '⏱️', category: 'pilot', playerOnly: true, description: 'Cuts every ability cooldown (slam, dash, whirl and your F ability) by 6% per level, up to -60%.', details: 'Applies to Inferno, Thunderclap and Ground Pound alike. Nothing ever recharges faster than 0.35s.', pips: 10, maxLevel: 10, baseCost: 150, costGrowth: 1.6, valueLabel: (l) => (l ? `-${Math.round((1 - FX.cooldownMult(l)) * 100)}% cooldowns` : 'No cut') },
  { id: 'inferno', name: 'Inferno Exhaust', icon: '🔥', category: 'classic', playerOnly: true, plowOnly: 'classic', description: 'F: a cone of fire that sets bots ablaze. Hotter, longer and faster to recharge.', details: 'Free on the Classic Plow. Burning lasts 4s and burning bots take +20% damage from everything you do. The fire also melts snow.', pips: 5, maxLevel: ENDLESS, baseCost: 160, costGrowth: 1.8, valueLabel: (l) => `${Math.round(FX.flameDps(l))} burn/s, ${f1(FX.flameRange(l))} m, ${f1(FX.flameCooldown(l))}s` },
  { id: 'classicShatter', name: 'Shatter Slam', icon: '🧨', category: 'classic', playerOnly: true, plowOnly: 'classic', description: 'Slams burst into ice shards that hit bots around the impact.', details: 'Bots outside the slam zone but within shard reach take a share of the slam\'s damage. Bigger balls throw harder shards.', pips: 5, maxLevel: ENDLESS, baseCost: 120, costGrowth: 1.8, valueLabel: (l) => (l ? `${Math.round(FX.shardFrac(l) * 100)}% dmg, +${f1(FX.shardReach(l))} m` : 'Locked') },
  { id: 'classicReserve', name: 'Snow Reserve', icon: '☃️', category: 'classic', playerOnly: true, plowOnly: 'classic', description: 'Keep part of your snowball after every slam.', details: 'The slam still hits with your full ball; you just keep some snow packed on the blade for the next one (and as a shield).', pips: 5, maxLevel: ENDLESS, baseCost: 100, costGrowth: 1.8, valueLabel: (l) => (l ? `keep ${Math.round(FX.reserveFrac(l) * 100)}%` : 'Locked') },
  { id: 'classicCombo', name: 'Slam Combo', icon: '🥊', category: 'classic', playerOnly: true, plowOnly: 'classic', description: `Back-to-back slams hit harder, stacking up to ${COMBO_MAX} times.`, details: `Each slam that lands within ${COMBO_WINDOW}s of your last landed slam adds a stack. Pairs well with Snow Reserve.`, pips: 5, maxLevel: ENDLESS, baseCost: 110, costGrowth: 1.8, valueLabel: (l) => (l ? `+${Math.round(FX.comboStep(l) * 100)}% per stack` : 'Locked') },
  { id: 'voltChain', name: 'Chain Lightning', icon: '⛓️', category: 'volt', playerOnly: true, plowOnly: 'volt', description: 'Your slams, rams, dashes, whirls and claps arc lightning to nearby bots.', pips: 5, maxLevel: ENDLESS, baseCost: 100, costGrowth: 1.8, valueLabel: (l) => (l ? `${FX.chainCount(l)} arcs × ${Math.round(FX.chainFrac(l) * 100)}%` : 'Locked') },
  { id: 'voltField', name: 'Tesla Field', icon: '🌩️', category: 'volt', playerOnly: true, plowOnly: 'volt', description: 'A crackling shock aura that constantly zaps every bot near you.', pips: 5, maxLevel: ENDLESS, baseCost: 110, costGrowth: 1.8, valueLabel: (l) => (l ? `${Math.round(FX.fieldDps(l))} dps, ${f1(FX.fieldRadius(l))} m` : 'Locked') },
  { id: 'voltClap', name: 'Thunderclap', icon: '⛈️', category: 'volt', playerOnly: true, plowOnly: 'volt', description: 'F: a lightning storm around you. Each clap shocks you a little; chaining claps shocks you hard.', details: 'Free on VOLT-9. A huge blast, extra sky strikes and an electrified field. The meter over the F icon shows the next clap\'s self-shock. Upgrades make it bigger and harder-hitting.', pips: 5, maxLevel: ENDLESS, baseCost: 150, costGrowth: 1.8, valueLabel: (l) => `${Math.round(FX.clapDamage(l))} dmg, ${f1(FX.clapRadius(l))} m, ${f1(FX.clapCooldown(l))}s` },
  { id: 'voltCell', name: 'Battery Shield', icon: '🔋', category: 'volt', playerOnly: true, plowOnly: 'volt', description: 'An energy shield soaks up damage before your HP, recharging after 3s without taking hits.', pips: 5, maxLevel: ENDLESS, baseCost: 90, costGrowth: 1.75, valueLabel: (l) => (l ? `${Math.round(FX.shieldMax(l))} shield` : 'Locked') },
  { id: 'brutePound', name: 'Ground Pound', icon: '💥', category: 'brute', playerOnly: true, plowOnly: 'brute', description: 'F: hop and slam down, a shockwave that damages, stuns and hurls back bots around you.', details: 'Free on BRUTUS. Upgrades make it wider, harder-hitting and faster to recharge.', pips: 5, maxLevel: ENDLESS, baseCost: 140, costGrowth: 1.8, valueLabel: (l) => `${Math.round(FX.poundDamage(l))} dmg, ${f1(FX.poundRadius(l))} m, ${f1(FX.poundCooldown(l))}s` },
  { id: 'bruteHide', name: 'Iron Hide', icon: '🪖', category: 'brute', playerOnly: true, plowOnly: 'brute', description: 'Take less damage the faster you are going.', details: 'Full effect from 70% of top speed (dashing counts); parked, you keep 40% of it. Stacks with Reinforced Frame.', pips: 5, maxLevel: ENDLESS, baseCost: 100, costGrowth: 1.8, valueLabel: (l) => (l ? `-${Math.round((1 - FX.ironHide(l)) * 100)}% damage at speed` : 'Locked') },
  { id: 'bruteMomentum', name: 'Momentum', icon: '☄️', category: 'brute', playerOnly: true, plowOnly: 'brute', description: 'Rams and dash strikes hit harder the faster you are going.', pips: 5, maxLevel: ENDLESS, baseCost: 110, costGrowth: 1.8, valueLabel: (l) => (l ? `+${Math.round(FX.momentum(l) * 1000)}% ram dmg at 10 m/s` : 'Locked') },
  { id: 'bruteSaws', name: 'Buzzsaws', icon: '🪚', category: 'brute', playerOnly: true, plowOnly: 'brute', description: 'Spinning saws on your blade ends shred bots in front of you and to the sides.', details: 'Speed and fury (damage you deal and take) spin them up, growing glowing halos that stretch their reach.', pips: 5, maxLevel: ENDLESS, baseCost: 110, costGrowth: 1.8, valueLabel: (l) => (l ? `${Math.round(FX.sawDps(l))} dps, ${f1(FX.sawRadius(l))} m` : 'Locked') },
  { id: 'iceShield', name: 'Ice Shield', icon: '🧱', category: 'special', description: 'Your held snowball blocks 75% of frontal damage (instead of 40%).', pips: 1, maxLevel: 1, baseCost: 240, costGrowth: 1, valueLabel: owned },
  { id: 'frostCore', name: 'Frost Core', icon: '❄️', category: 'special', description: 'Slams freeze bots, slowing them for 3s.', pips: 1, maxLevel: 1, baseCost: 300, costGrowth: 1, valueLabel: owned },
  { id: 'avalancheCore', name: 'Avalanche Core', icon: '🌋', category: 'special', description: 'Slams hit a 50% wider area and knock bots flying.', pips: 1, maxLevel: 1, baseCost: 400, costGrowth: 1, valueLabel: owned },
];

export const UPGRADE_BY_ID: Record<UpgradeId, UpgradeDef> = Object.fromEntries(UPGRADES.map((u) => [u.id, u])) as Record<UpgradeId, UpgradeDef>;

export function upgradeCost(def: UpgradeDef, currentLevel: number): number {
  const full = Math.min(currentLevel, def.pips);
  const extra = Math.max(0, currentLevel - def.pips);
  const growth = 1 + (def.costGrowth - 1) * COST_GROWTH_SOFTEN;
  return Math.round(def.baseCost * Math.pow(growth, full) * Math.pow(ENDLESS_COST_GROWTH, extra));
}
