import { FX, UPGRADES, UPGRADE_BY_ID, upgradeCost, type UpgradeId } from './upgrades';
import { ZONES, type ZoneDef } from './zones';

/* ------------------------------------------------------------------------------------------------
 * Online DUEL tuning: 1v1, best of 3 rounds in a campaign-size arena.
 * Each player fights with their OWN garage. Before the match both get a short DUEL GARAGE phase, and the weaker
 * garage gets CATCH-UP coins to spend on duel-only (temporary) upgrade levels first.
 * ---------------------------------------------------------------------------------------------- */

/** The duel arena: Frostbite Yard's layout and size, no bots, no coins. */
export const DUEL_ZONE: ZoneDef = { ...ZONES[0], id: 'duel', name: 'DUEL · Frostbite Yard', tagline: 'One on one.', bossName: '', rounds: [{ groups: [] }], coinMult: 0, clearReward: 0 };

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
export const DUEL_GARAGE_SECONDS = 45;
export const DUEL_REMATCH_GARAGE_SECONDS = 30;
/** Every player-vs-player hit is scaled by this before the Brawl hit cap (brawlHit). Bot-tuned kits (Thunderclap
 *  storms, Inferno burn, saw / aura ticks) shred a single human target, so PvP runs at a fraction of PvE damage. */
export const DUEL_DAMAGE_SCALE = 0.6;
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

/** Catch-up: share of the garage-power gap paid to the weaker player, and the cap. */
export const CATCHUP_FRAC = 1.0;
export const CATCHUP_MAX = 50000;

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

/** What a garage could be worth if every coin were spent. */
export const duelPower = (spent: number, coins: number) => Math.max(0, spent) + Math.max(0, coins);

/** Catch-up coins for the player with `ownPower` against `oppPower`: the gap x CATCHUP_FRAC, capped; 0 for the
 *  stronger (or equal) side. */
export function catchUpBonus(ownPower: number, oppPower: number, frac = CATCHUP_FRAC, max = CATCHUP_MAX): number {
  const gap = (oppPower - ownPower) * frac;
  if (!(gap > 0)) return 0;
  return Math.min(max, Math.max(0, Math.round(gap)));
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
