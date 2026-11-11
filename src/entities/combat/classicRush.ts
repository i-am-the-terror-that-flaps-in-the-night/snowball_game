/* The Classic Plow's SPACE kit (pure numbers, no scene): a TAP is a BLADE SWIPE that packs SNOW CHUNKS, a HOLD charges
 * a PLOW RUSH that ends in the ball slam and cashes the chunks in. Plow.update runs the input / motion state machine
 * (plow/classicSpace.ts), ClassicKit (combat/classic.ts) the hits. Vehicles switched to the snowball kit keep the old
 * tap slam. See docs/plows.md "Classic Plow". */

/** SPACE released within this many seconds of the press = a tap (BLADE SWIPE); held past it = charging a rush. */
export const SWIPE_TAP = 0.2;
/** Swipe reach (m, from the blade tip) and cone half-angle (rad): a ~100° sweep in front of the blade. */
export const SWIPE_RANGE = 3.5;
export const SWIPE_HALF = (50 * Math.PI) / 180;
/** Seconds between two swipes. */
export const SWIPE_COOLDOWN = 0.35;
/** Swipe damage before stats.damageMult (Packed Ice and the Classic's iceGrowth, like the slam). */
export const SWIPE_DAMAGE = 16;
/** Swipe knockback (m/s): a nudge, so the target stays in swipe range. */
export const SWIPE_KNOCK = 3.5;
/** Seconds the swipe's arc takes to sweep across (visual; the hit lands at once). */
export const SWIPE_FX_SECONDS = 0.16;

/** SNOW CHUNKS: every bot / opponent a swipe hits packs one onto the blade, up to CHUNK_MAX. */
export const CHUNK_MAX = 10;
/** Chunks cashed in by a rush slam: zone radius x (1 + CHUNK_RADIUS n), damage x (1 + CHUNK_DAMAGE n). */
export const CHUNK_RADIUS = 0.05;
export const CHUNK_DAMAGE = 0.04;
/** A cash-in of at least this many chunks gets the big float text. */
export const CHUNK_BIG = 5;

/** MOMENTUM: a landed swipe gives +MOMENTUM_BOOST top speed for MOMENTUM_SECONDS (refreshes, doesn't stack). */
export const MOMENTUM_BOOST = 0.2;
export const MOMENTUM_SECONDS = 1;

/** PLOW RUSH distance (m): RUSH_MIN at the smallest charge, RUSH_MAX (a hard cap at every upgrade level) at full. */
export const RUSH_MIN = 1.5;
export const RUSH_MAX = 20;
/** Seconds of hold (past the tap window) for a full charge on a fresh plow; Engine / Nitro / Mega Hopper shorten it
 *  (rushChargeTime), never below RUSH_CHARGE_MIN. They never raise the cap. */
export const RUSH_CHARGE_BASE = 1;
export const RUSH_CHARGE_MIN = 0.55;
/** Top speed while charging, as a share of the normal one (1: by request, charging doesn't slow the plow). */
export const RUSH_CHARGE_SLOW = 1;
/** Rush speed (m/s): 20 m takes ~0.7 s. Straight line, no steering. */
export const RUSH_SPEED = 28;
/** Shared dash meter: a rush costs max(RUSH_COST_MIN, distance / RUSH_MAX) of a full charge. */
export const RUSH_COST_MIN = 0.25;
/** The end slam with no ball (or a crumb under 0.2 m) uses this radius. */
export const RUSH_MIN_SLAM_R = 0.6;

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);

/** Rush distance (m) at charge 0..1. */
export const rushDistance = (charge: number) => RUSH_MIN + (RUSH_MAX - RUSH_MIN) * clamp01(charge);

/** Share of a full dash meter a rush of `dist` m costs. */
export const rushCost = (dist: number) => Math.max(RUSH_COST_MIN, Math.min(RUSH_MAX, dist) / RUSH_MAX);

/** Longest rush (m) the meter `meter` (0..1) pays for, or 0 when it can't pay even the minimum cost. */
export const rushAffordable = (meter: number) => (meter + 1e-9 < RUSH_COST_MIN ? 0 : Math.min(RUSH_MAX, RUSH_MAX * meter));

/** The rush a release launches: charge 0..1 against meter 0..1. dist 0 = can't rush (meter too low). */
export function rushPlan(charge: number, meter: number): { dist: number; cost: number } {
  const cap = rushAffordable(meter);
  if (cap <= 0) return { dist: 0, cost: 0 };
  const dist = Math.min(rushDistance(charge), cap);
  return { dist, cost: Math.min(meter, rushCost(dist)) };
}

/** Seconds of hold for a full charge from the upgrade levels (Engine, Nitro Dash, Mega Hopper). */
export function rushChargeTime(engine: number, nitro: number, hopper: number, soft: (L: number, knee: number, span?: number) => number): number {
  const k = 1 + 0.03 * soft(Math.max(0, engine), 5) + 0.05 * soft(Math.max(0, nitro), 3) + 0.03 * soft(Math.max(0, hopper), 5, 4);
  return Math.max(RUSH_CHARGE_MIN, RUSH_CHARGE_BASE / k);
}

/** Charge 0..1 after holding `held` s (the tap window doesn't count) with a full charge taking `chargeTime` s. */
export const rushCharge = (held: number, chargeTime: number) => clamp01((held - SWIPE_TAP) / Math.max(0.05, chargeTime));

/** Chunks after a swipe that hit `hits` targets. */
export const addChunks = (n: number, hits: number) => Math.max(0, Math.min(CHUNK_MAX, n + Math.max(0, Math.floor(hits))));

/** Cash-in multipliers for `n` chunks (clamped to 0..CHUNK_MAX). */
export function cashIn(n: number): { radius: number; damage: number } {
  const c = Math.max(0, Math.min(CHUNK_MAX, Math.floor(n)));
  return { radius: 1 + CHUNK_RADIUS * c, damage: 1 + CHUNK_DAMAGE * c };
}
