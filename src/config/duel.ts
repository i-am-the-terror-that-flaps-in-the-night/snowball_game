import { FX, UPGRADES, UPGRADE_BY_ID, upgradeCost, type UpgradeId } from './upgrades';
import { ZONES, type ZoneDef } from './zones';
import { GEAR_BY_ID, GEAR_MAX_LEVEL, gearLevels, gearSpent, type GearSlot } from './gear';

/* ------------------------------------------------------------------------------------------------
 * Online DUEL tuning: 1v1, best of 3 rounds in a campaign-size arena.
 * Each player fights with their OWN garage (core upgrades + equipped gear). Before the match both get a short DUEL
 * GARAGE phase, and the weaker garage gets CATCH-UP coins, spent first on upgrades OR gear; what they buy is saved
 * to the garage once the match starts. Garage value counts gear at what the items actually cost.
 * ---------------------------------------------------------------------------------------------- */

/** The duel arena: arena 1's slot (prop seed via `index`, snow) with the classic Frostbite Yard look, no bots, no coins.
 *  Built from an explicit field list, NOT a spread of ZONES[0]: arena 1 became Coldboot Glacier in the level overhaul,
 *  and anything the biome / terrain passes add to it (biome, terrain, hazard patches, gravity) must not leak into Duel
 *  silently. Duel keeps its old flat venue until it gets its own biome pool (docs/level-overhaul.md "Other modes");
 *  tests/duel.test.ts pins the key set. */
export const DUEL_ZONE: ZoneDef = {
  index: ZONES[0].index, id: 'duel', name: 'DUEL · Frostbite Yard', tagline: 'One on one.', bossName: '', rounds: [{ groups: [] }],
  enemyHpMult: ZONES[0].enemyHpMult, coinMult: 0, snowDepth: ZONES[0].snowDepth, snowRegenMult: ZONES[0].snowRegenMult, clearReward: 0,
  skyTop: 0x4f8fd6, skyBottom: 0xdcefff, fogColor: 0xd6e9fb, fogNear: 60, fogFar: 170,
  sunColor: 0xfff1d6, sunIntensity: 2.6, ambientColor: 0xbcd7ff, ambientIntensity: 0.9, snowTint: 0xffffff, snowfall: 0.25, theme: 'meadow',
  terrain: undefined,
};

/** Rounds needed to win the match (best of 3). */
export const DUEL_ROUNDS_TO_WIN = 2;
/** Hard stop if rounds keep ending in draws. */
export const DUEL_MAX_ROUNDS = 5;
/** Round length (s); at 0 the higher HP% wins the round. */
export const DUEL_ROUND_SECONDS = 90;
/** Pre-round countdown (s): the ROUND banner, then 3-2-1. */
export const DUEL_COUNTDOWN = 4;
/** Wreck animation before the round result. */
export const DUEL_ROUND_END_DELAY = 1.8;
/** Seconds on the round-result card before the next round. */
export const DUEL_BETWEEN_ROUNDS = 3;
/** Pre-match DUEL GARAGE (s): first match / every rematch. */
export const DUEL_GARAGE_SECONDS = 90;
export const DUEL_REMATCH_GARAGE_SECONDS = 60;
/** Every player-vs-player hit is scaled by this before the Brawl hit cap (brawlHit). Bot-tuned kits (Thunderclap
 *  storms, Inferno burn, saw / aura ticks) shred a single human target, so PvP runs at a fraction of PvE damage. */
export const DUEL_DAMAGE_SCALE = 0.45;
/** ARSENAL minigun rounds skip the i-frames and the ability diminishing returns (they land faster than either), so
 *  they take this extra scale against a human plow on top of DUEL_DAMAGE_SCALE. */
export const DUEL_ROUND_SCALE = 0.7;
/** Upgrades multiply damage far faster than HP (a late garage hits ~20x harder on ~3x the HP), so PvP damage is
 *  also divided by the attacker's ultPower (PlayerStats) ^ DUEL_POWER_DAMP: late-game duels last nearly as long as
 *  fresh ones. */
export const DUEL_POWER_DAMP = 0.4;
/** HP% within this of each other at time-out = a draw round (nobody scores). */
export const DUEL_DRAW_EPS = 0.005;
/** Both players use this snow regrowth (m/s) instead of their Snow Machine: the field is shared. */
export const DUEL_SNOW_REGEN = FX.snowRegen(0);
/** Spawn points: both on the centre line, facing each other. */
export const DUEL_SPAWNS = [
  { x: 0, z: 15, heading: Math.PI },
  { x: 0, z: -15, heading: 0 },
] as const;
/** Coins a duel pays: none. Duels are for bragging rights (and the catch-up keeps them fair, not grindy). */
export const DUEL_COIN_REWARD = 0;

/** Sanity cap on any one upgrade level that comes over the wire. */
export const MAX_NET_LEVEL = 999;

/** Catch-up: share of the garage-power gap paid to the weaker player. No cap: the full gap is covered. The
 *  stronger (or equal) side never gets catch-up coins. */
export const CATCHUP_FRAC = 1.0;
export const CATCHUP_MAX = Infinity;

/** Total coins spent on a set of upgrade levels (the sum of every level's price, from the shop cost curves).
 *  Computed from the levels themselves, not from purchase history. */
export function garageSpent(levels: Partial<Record<UpgradeId, number>>): number {
  let total = 0;
  for (const def of UPGRADES) {
    const raw = levels[def.id] ?? 0;
    const n = Number.isFinite(raw) ? Math.max(0, Math.min(def.maxLevel, MAX_NET_LEVEL, Math.floor(raw))) : 0;
    for (let l = 0; l < n; l++) total += upgradeCost(def, l);
  }
  return total;
}

/** Equipped gear as sent over the wire: item id -> item level (one item per slot). */
export type DuelGear = Record<string, number>;

/** Sanitise equipped gear received over the network: known ids only, levels 1..GEAR_MAX_LEVEL, one per slot. */
export function cleanDuelGear(raw: unknown): DuelGear {
  const out: DuelGear = {};
  if (!raw || typeof raw !== 'object') return out;
  const slots = new Set<GearSlot>();
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const def = GEAR_BY_ID[id];
    if (!def || slots.has(def.slot) || typeof v !== 'number' || !Number.isFinite(v) || v < 1) continue;
    slots.add(def.slot);
    out[id] = Math.min(GEAR_MAX_LEVEL, Math.floor(v));
  }
  return out;
}

/** Stat levels the equipped `gear` grants (same rules as the save's gearLevels). */
export function duelGearLevels(gear: DuelGear): Partial<Record<UpgradeId, number>> {
  const equipped: Partial<Record<GearSlot, string>> = {};
  for (const id of Object.keys(gear)) {
    const def = GEAR_BY_ID[id];
    if (def) equipped[def.slot] = id;
  }
  return gearLevels({ owned: gear, equipped });
}

/** Garage value for the catch-up: core levels at the upgrade cost curves, plus the equipped items at what they
 *  cost to buy and level. `levels` are EFFECTIVE levels (gear grants included); the grants are taken back out
 *  first so gear isn't counted twice. */
export function duelSpent(levels: Partial<Record<UpgradeId, number>>, gear: DuelGear): number {
  const grants = duelGearLevels(gear);
  // Item-only stats come from gear alone, so they must match what the claimed gear grants exactly. If they don't
  // (a stale or tampered profile), ignore the gear and value the levels the pilot actually fights with.
  for (const def of UPGRADES) {
    if (def.itemOnly && (levels[def.id] ?? 0) !== (grants[def.id] ?? 0)) return garageSpent(levels);
  }
  const core: Partial<Record<UpgradeId, number>> = {};
  for (const [id, n] of Object.entries(levels) as [UpgradeId, number][]) {
    const l = n - (grants[id] ?? 0);
    if (l > 0) core[id] = l;
  }
  let total = garageSpent(core);
  for (const [id, lvl] of Object.entries(gear)) {
    const def = GEAR_BY_ID[id];
    if (def) total += gearSpent(def, lvl);
  }
  return total;
}

/** What a garage could be worth if every coin were spent. */
export const duelPower = (spent: number, coins: number) => Math.max(0, spent) + Math.max(0, coins);

/** Catch-up coins for the player with `ownPower` against `oppPower`: the gap x CATCHUP_FRAC (uncapped by default);
 *  always 0 for the stronger (or equal) side. */
export function catchUpBonus(ownPower: number, oppPower: number, frac = CATCHUP_FRAC, max = CATCHUP_MAX): number {
  const gap = (oppPower - ownPower) * frac;
  if (!(gap > 0)) return 0;
  return Math.min(max, Math.max(0, Math.round(gap)));
}

/** Coins to raise every shared (non plow-specific) upgrade in `own` up to the level in `opp`. */
export function sharedMatchCost(own: Partial<Record<UpgradeId, number>>, opp: Partial<Record<UpgradeId, number>>): number {
  let total = 0;
  for (const def of UPGRADES) {
    if (def.plowOnly || def.itemOnly) continue;
    const goal = Math.min(def.maxLevel, MAX_NET_LEVEL, Math.floor(opp[def.id] ?? 0));
    for (let l = Math.max(0, Math.floor(own[def.id] ?? 0)); l < goal; l++) total += upgradeCost(def, l);
  }
  return total;
}

interface DuelSideInfo {
  levels: Partial<Record<UpgradeId, number>>;
  /** Coins spent on the garage (every upgrade, plow-specific included). */
  spent: number;
  coins: number;
}

/** Duel catch-up for two garages. Only the weaker side (lower spent + coins) gets any, and it gets enough to
 *  match the opponent's FULL garage value (all their spending, plow lines included, plus their coins on hand)
 *  on top of what it has already spent: oppSpent + oppCoins − ownSpent (its own unspent coins are its own and
 *  don't reduce it). Never less than the cost of matching the opponent's shared upgrades, so AUTO-SPEND's first step is always fully covered. */
export function duelBonus(a: DuelSideInfo, b: DuelSideInfo): { a: number; b: number } {
  const pa = duelPower(a.spent, a.coins);
  const pb = duelPower(b.spent, b.coins);
  const forWeak = (own: DuelSideInfo, opp: DuelSideInfo) =>
    Math.min(CATCHUP_MAX, Math.max(0, Math.round((duelPower(opp.spent, opp.coins) - Math.max(0, own.spent)) * CATCHUP_FRAC), sharedMatchCost(own.levels, opp.levels)));
  if (pa < pb) return { a: forWeak(a, b), b: 0 };
  if (pb < pa) return { a: 0, b: forWeak(b, a) };
  return { a: 0, b: 0 };
}

/** Both sides' catch-up coins at once (only the weaker side gets any). */
export function catchUp(powerA: number, powerB: number): { a: number; b: number } {
  return { a: catchUpBonus(powerA, powerB), b: catchUpBonus(powerB, powerA) };
}

/** Sanitise upgrade levels received over the network (unknown ids dropped, levels clamped). */
export function cleanLevels(raw: unknown): Partial<Record<UpgradeId, number>> {
  const out: Partial<Record<UpgradeId, number>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const def = UPGRADE_BY_ID[id as UpgradeId];
    if (!def || typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
    out[def.id] = Math.min(def.maxLevel, MAX_NET_LEVEL, Math.floor(v));
  }
  return out;
}
