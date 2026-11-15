/**
 * The Omega Works (arena 6): zone look, enemy spawning from floor hatches, and MEGAPLOW's deck leap.
 *
 * Pure data + pure functions (no Three.js), so they unit-test cheaply and slot into the game wherever the arena is
 * wired up (zones.ts merges OMEGA_LOOK into ZONES[5]; Enemies picks hatches with pickHatches; the boss AI asks
 * deckLeap whether / how to jump onto the deck the player is camping on).
 */
import { GRAVITY, STEP_UP, type Terrain } from '../Terrain';
import { OMEGA_HALF, OMEGA_HATCHES, OMEGA_SPAWN, OMEGA_TERRAIN } from './layout';

/** Visual + size fields for ZONES[5]. A neon factory at late dusk: deep blue sky fading to a magenta horizon, violet
 *  haze, a low sun and cool grey-lilac snow, dim enough that the neon deck edges, circuits and guide lines glow. */
export const OMEGA_LOOK = {
  arenaHalf: OMEGA_HALF,
  spawn: OMEGA_SPAWN,
  terrain: OMEGA_TERRAIN,
  skyTop: 0x161f56,
  skyBottom: 0xe06aa6,
  fogColor: 0x4a3e7c,
  fogNear: 80,
  fogFar: 260,
  sunColor: 0xffd8c0,
  sunIntensity: 1.6,
  ambientColor: 0xb0a8f0,
  ambientIntensity: 0.7,
  snowTint: 0xb4b8d4,
  snowfall: 0.15,
} as const;

/* ------------------------------------------------------------------ spawning */

/** Bots rise out of hatches between these distances (m) from the player, so fights stay close in a 160 m arena. */
export const HATCH_MIN = 9;
export const HATCH_MAX = 35;

/**
 * Pick `n` hatch indices for a spawn wave near the player at (px, py, pz). Hatches inside [HATCH_MIN, HATCH_MAX]
 * (3D distance, so a hatch on a deck right above you counts as far) are used nearest-first, cycling if n exceeds
 * them; if none qualify, the nearest hatches beyond HATCH_MIN are used. `offset` rotates the choice so consecutive
 * waves don't all come out of the same hatch. Never returns a hatch closer than HATCH_MIN (no spawning on top of you).
 */
export function pickHatches(px: number, py: number, pz: number, n: number, offset = 0, hatches = OMEGA_HATCHES, levelY = hatchY): number[] {
  const scored = hatches
    .map((h, i) => ({ i, d: Math.hypot(h.x - px, levelY(h.deck) - py, h.z - pz) }))
    .filter((h) => h.d >= HATCH_MIN)
    .sort((a, b) => a.d - b.d);
  if (!scored.length || n <= 0) return [];
  const near = scored.filter((h) => h.d <= HATCH_MAX);
  const pool = near.length ? near : scored.slice(0, Math.min(3, scored.length));
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(pool[(k + offset) % pool.length].i);
  return out;
}

/** Height of the surface a hatch sits on (ground 0, decks by id). */
function hatchY(deck: number): number {
  if (deck < 0) return 0;
  const d = OMEGA_TERRAIN.decks!.find((x) => x.id === deck);
  return d ? d.top : 0;
}

/* ------------------------------------------------------------------ MEGAPLOW deck leap */

/** Seconds the player must stay up on a deck the boss can't reach before MEGAPLOW leaps after them. */
export const CAMP_SECONDS = 4;
/** Extra apex height (m) above the higher of start / landing, so the arc clears deck lips. */
const LEAP_APEX = 3.5;
/** The boss lands this far short of the player (m) along the jump, not on their head. */
const LEAP_SHORT = 4;
/** Longest leap (m, horizontal). */
export const LEAP_RANGE = 40;

export interface LeapPlan {
  /** Launch velocity. */
  vx: number;
  vy: number;
  vz: number;
  /** Landing point and the flight time. */
  x: number;
  y: number;
  z: number;
  t: number;
}

/**
 * Should a grounded boss at (bx, by, bz) leap onto the player's deck, and how? Returns a launch plan when the player
 * stands on something more than a step above the boss within LEAP_RANGE (and the landing spot is on that surface),
 * else null. The arc peaks LEAP_APEX above the higher end and lands LEAP_SHORT short of the player.
 */
export function deckLeap(terrain: Terrain, bx: number, by: number, bz: number, px: number, py: number, pz: number): LeapPlan | null {
  if (py - by <= STEP_UP + 1) return null; // same level (or below): just drive
  let dx = px - bx;
  let dz = pz - bz;
  const dist = Math.hypot(dx, dz);
  if (dist > LEAP_RANGE || dist < 1) return null;
  dx /= dist;
  dz /= dist;
  // Land a little short of the player, but stay on their surface (step back toward them until we are).
  let land = Math.max(0, dist - LEAP_SHORT);
  let lx = bx + dx * land;
  let lz = bz + dz * land;
  let ly = terrain.surfaceAt(lx, lz, py).y;
  for (let k = 0; k < 8 && Math.abs(ly - py) > STEP_UP; k++) {
    land = Math.min(dist, land + LEAP_SHORT / 8);
    lx = bx + dx * land;
    lz = bz + dz * land;
    ly = terrain.surfaceAt(lx, lz, py).y;
  }
  if (Math.abs(ly - py) > STEP_UP) return null;
  const g = terrain.gravity || GRAVITY;
  const apex = Math.max(by, ly) + LEAP_APEX;
  const up = apex - by;
  const down = apex - ly;
  const vy = Math.sqrt(2 * g * up);
  const t = vy / g + Math.sqrt((2 * down) / g);
  const h = Math.hypot(lx - bx, lz - bz);
  return { vx: (dx * h) / t, vy, vz: (dz * h) / t, x: lx, y: ly, z: lz, t };
}

/**
 * Tracks how long the player has been camping above the boss. Feed it every frame; `ready` turns true once the
 * player has stayed more than a step above the boss for CAMP_SECONDS (and resets as soon as they come down).
 */
export class CampWatch {
  t = 0;
  update(dt: number, bossY: number, playerY: number): boolean {
    if (playerY - bossY > STEP_UP + 1) this.t += dt;
    else this.t = 0;
    return this.t >= CAMP_SECONDS;
  }
  reset(): void {
    this.t = 0;
  }
}
