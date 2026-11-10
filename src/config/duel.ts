import { FX, UPGRADES, UPGRADE_BY_ID, upgradeCost, type UpgradeId } from './upgrades';
import type { PlowKind } from './plows';
import { BIOME_ZONE, BRAWL_BIOMES, BRAWL_ZONE, brawlZone, zoneLook, type BiomeKey, type ZoneDef } from './zones';
import { DUEL_DOME_TERRAIN } from '../world/biomes/terrains';
import type { TerrainDef } from '../world/Terrain';
import { GEAR_BY_ID, GEAR_MAX_LEVEL, gearLevels, gearSpent } from './gear';

/* ------------------------------------------------------------------------------------------------
 * Online DUEL tuning: 1v1, best of 3 rounds in a shrunk Snowdome (the Brawl venue at 2/3 size).
 * Each player fights with their OWN garage (core upgrades + equipped gear). Before the match both get a short DUEL
 * GARAGE phase, and the weaker garage gets CATCH-UP coins, spent first on upgrades OR gear; what they buy is saved
 * to the garage once the match starts. Garage value counts gear at what the items actually cost.
 * ---------------------------------------------------------------------------------------------- */

/** The duel arena: THE SNOWDOME (Brawl's venue: stands, cover, deep drifts) shrunk to DUEL_ARENA_HALF (60 m, 2/3 of the
 *  180 m dome; the dressing scales with the arena, world/environment/layout.ts domeK), no bots, no coins. Built from an
 *  explicit field list, NOT a spread of BRAWL_ZONE, so nothing added to the Brawl venue leaks into Duel silently;
 *  tests/biomes.test.ts pins the key set. */
export const DUEL_ZONE: ZoneDef = {
  index: BRAWL_ZONE.index, id: 'duel', name: 'DUEL · The Snowdome', tagline: 'One on one.', bossName: '', rounds: [{ groups: [] }],
  enemyHpMult: 1, coinMult: 0, snowDepth: BRAWL_ZONE.snowDepth, snowRegenMult: BRAWL_ZONE.snowRegenMult, clearReward: 0,
  ...zoneLook(BRAWL_ZONE), theme: 'brawl',
  terrain: undefined,
};

/** Duel venues: the Brawl venues (the Snowdome plus its five biome variants, BRAWL_BIOMES) at Duel size, the ground
 *  terrain laid out for the smaller dome (DUEL_DOME_TERRAIN). Both peers pick the same one from the room code
 *  (duelZoneFor), so the choice needs no protocol message. The room code is effectively a random pick; a later host
 *  choice can ride in the host's hello (a venue key) with duelVenueFor kept as the default. */
export type DuelVenue = BiomeKey;
export const DUEL_VENUES: readonly DuelVenue[] = BRAWL_BIOMES;
const DUEL_TERRAIN: Partial<Record<DuelVenue, TerrainDef>> = DUEL_DOME_TERRAIN;
const duelZones = new Map<DuelVenue, ZoneDef>();

/** DUEL_ZONE dressed as a biome Snowdome (cached; the look of brawlZone(venue)). 'snowdome' = DUEL_ZONE itself. */
export function duelZone(venue: DuelVenue): ZoneDef {
  if (venue === 'snowdome') return DUEL_ZONE;
  let z = duelZones.get(venue);
  if (!z) {
    const src = brawlZone(venue);
    z = { ...DUEL_ZONE, ...zoneLook(src), name: `DUEL · ${BIOME_ZONE[venue].name}`, biome: src.biome, terrain: DUEL_TERRAIN[venue] };
    duelZones.set(venue, z);
  }
  return z;
}

/** Deterministic venue for a room code (FNV-1a over the upper-cased code): host and guest agree without a message. */
export function duelVenueFor(code: string): DuelVenue {
  let h = 0x811c9dc5;
  const c = code.trim().toUpperCase();
  for (let i = 0; i < c.length; i++) h = Math.imul(h ^ c.charCodeAt(i), 0x01000193) >>> 0;
  return DUEL_VENUES[h % DUEL_VENUES.length];
}

export const duelZoneFor = (code: string): ZoneDef => duelZone(duelVenueFor(code));

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
/** Per-vehicle Duel balance, keyed by PlowKind (missing = 1). Both are Duel-only (applied in duel/opponent.ts
 *  OpponentTarget.damage, before the hit caps): campaign / Survival / Brawl never see them (tests/balance.test.ts
 *  "Duel-only balance levers"), and they do not depend on the garage tier, so they scale the same fresh, mid and late.
 *  Tuned on the real browser matrix (scripts/duel-matrix.mjs, docs/balance.md "Duel balance at high").
 *  DUEL_KIND_DAMAGE scales every hit the vehicle DEALS to a human plow: VOLT-9's kit is tuned for crowds (its grounded
 *  arc is off against a lone human), BRUTUS's fists and saws out-trade everything up close, the Classic's slams / rams
 *  topped every tier of the matrix. ARSENAL stays below 1 because its minigun ('round' hits) already skips i-frames and
 *  ability diminishing returns: 0.85 is the most that keeps the minigun alone under a fifth of a same-tier Classic in
 *  2 s of held fire (tests/balance.test.ts), so the rest of its help comes from DUEL_KIND_TAKEN. */
export const DUEL_KIND_DAMAGE: Partial<Record<PlowKind, number>> = { volt: 1.8, brute: 0.62, arsenal: 0.85, classic: 0.92 };
/** DUEL_KIND_TAKEN scales every hit the vehicle TAKES from a human plow (an effective-HP lever: the HP bar, the hit caps
 *  and the ultimate meter sizes stay on the real max HP). VOLT-9 and ARSENAL carry ~75% of the others' HP at every
 *  tier (light, fast vehicles) and lost most even trades; ISOTOPE fell furthest once the others were evened out (its
 *  spray range and radiation want kiting the fight never gives it); BRUTUS (the most HP) still won most of its trades
 *  after its damage trim, so it takes a little more. */
export const DUEL_KIND_TAKEN: Partial<Record<PlowKind, number>> = { volt: 0.77, arsenal: 0.62, isotope: 0.9, brute: 1.15 };
/** ULTIMATES IN THE DUEL. Off-line the meter is sized in damage (combat/ultimates.ts ultCharge: a base that grows with
 *  the garage's ultPower and Overclock, ~20x from fresh to late), but Duel damage is scaled down and power-damped
 *  (above) and capped against HP that only grows ~3x, so a round used to fill only 5-15% of it: ultimates never
 *  fired. In the Duel the meter is instead sized in the OPPONENT's HP: it fills after the damage that counts toward
 *  it (every hit for VOLT-9 / BRUTUS / ARSENAL, fire damage for the Classic, the usual Critical Mass shares for
 *  ISOTOPE) adds up to DUEL_ULT_CHARGE x the opponent's max HP. That is tier-independent by construction (and
 *  independent of the Duel damage scales): in an even same-tier fight the first ultimate comes ~25-40 s into
 *  continuous fighting (`npm run duel2`, ult table). The meter carries over between the rounds of a match (empty at
 *  match start), so it is typically ready once per round. */
export const DUEL_ULT_CHARGE = 2.5;
/** Per-vehicle factor on DUEL_ULT_CHARGE (others 1), evening the fill out: ISOTOPE's Critical Mass counts only part of
 *  its damage (radiation shares), BRUTUS deals the most plow-vs-plow. Overclock (cooldownMult < 1: abilities more
 *  often, so more damage) grows the meter by 1 / sqrt(cooldownMult), as it grows the off-line one by 1 / cooldownMult.
 *  The Classic's factor is its DUEL_KIND_DAMAGE, so that Duel damage trim does not also delay FIRESTORM; the
 *  victim's DUEL_KIND_TAKEN is folded into the HP the meter is sized in (OpponentTarget.duelFoeMaxHp). */
export const DUEL_ULT_KIND_CHARGE: Partial<Record<string, number>> = { isotope: 0.65, brute: 1.25, classic: DUEL_KIND_DAMAGE.classic };
/** ...and an ultimate landing on a human is a big swing, never a one-shot: on top of the usual Duel path (scales,
 *  power damp, hit cap, i-frames, shields), ultimate damage (the blast and its aftermath: SUPERCELL strikes,
 *  EARTHQUAKE rings, SINGULARITY pull + detonation, FIRESTORM nova + burning ground, NUKE blast + its fallout pool) is
 *  soft-capped at DUEL_ULT_HP_CAP of the victim's max HP per ultimate (the cap's memory fades over
 *  DUEL_ULT_CAP_SECONDS). Measured share of a parked same-tier victim's HP: ~25-40%. */
export const DUEL_ULT_HP_CAP = 0.35;
export const DUEL_ULT_CAP_SECONDS = 10;
/** HP% within this of each other at time-out = a draw round (nobody scores). */
export const DUEL_DRAW_EPS = 0.005;
/** Both players use this snow regrowth (m/s) instead of their Snow Machine: the field is shared. */
export const DUEL_SNOW_REGEN = FX.snowRegen(0);
/** Spawn points: both on the centre line, 50 m apart across the fountain, facing each other (clear of the scaled cover
 *  and the drifts, on flat ground in every venue: tests/biomes.test.ts). */
export const DUEL_SPAWNS = [
  { x: 0, z: 25, heading: Math.PI },
  { x: 0, z: -25, heading: 0 },
] as const;

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

/** Equipped gear as sent over the wire: item id -> item level (any number of items, several per slot allowed). */
export type DuelGear = Record<string, number>;

/** Sanitise equipped gear received over the network: known ids only, levels 1..GEAR_MAX_LEVEL (each id at most
 *  once, so the list can never hold more than the whole catalog). */
export function cleanDuelGear(raw: unknown): DuelGear {
  const out: DuelGear = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!GEAR_BY_ID[id] || typeof v !== 'number' || !Number.isFinite(v) || v < 1) continue;
    out[id] = Math.min(GEAR_MAX_LEVEL, Math.floor(v));
  }
  return out;
}

/** Stat levels the equipped `gear` grants (same rules as the save's gearLevels). */
export function duelGearLevels(gear: DuelGear): Partial<Record<UpgradeId, number>> {
  return gearLevels({ owned: gear, equipped: Object.keys(gear) });
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
