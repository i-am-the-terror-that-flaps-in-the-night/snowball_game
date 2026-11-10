import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARENA, BRAWL_ARENA_HALF, ENEMY_GATES, GATE_WIDTH } from '../../core/types';

/* ---------------------------------------------------------------- arena layout */

/** Gap between the ARENA edge and the inner face of the wall blocks (trim / banners live here). */
export const WALL_IN = 0.12;
export const WALL_T = 1.6;
/** Outer extent of the wall measured from the arena edge. */
export const WALL_C = WALL_IN + WALL_T;
export const WALL_H = 2.5;
/** The south wall is a bit lower: the follow camera lives behind it. */
export const SOUTH_H = 1.9;
export const GATE_HALF = GATE_WIDTH / 2;
export const PILLAR_W = 1.2;
export const STAND_N0 = WALL_C + 1.9;
export const ROWS = 6;
export const ROW_D = 1.25;
export const ROW_RISE = 0.62;
export const TOWER_OFF = 5.6;
export const TUNNEL_LEN = 10.5;
/* Snowdome (Brawl) stadium */
export const DOME_TOWER_OFF = 14;
export const DOME_TOWER_K = 2.3;
export const DOME_TOWER_H = 16.5 * DOME_TOWER_K;
export const DOME_N0 = WALL_C + 3.5;
export const DOME_ROWS = 12;
export const DOME_ROW_D = 1.8;
export const DOME_RISE = 1.15;
export const DOME_CROWD_CAP = 3000;
export const SPONSORS: [string, string, string][] = [
  ['FROSTCOLA', '#d7263d', '#ffffff'], ['PLOWTECH', '#1b98e0', '#ffffff'], ['BRRR ENERGY', '#111111', '#7cff5a'],
  ['SLUSH BANK', '#ffd23a', '#1a1a2e'], ['YETI TIRES', '#2b2d42', '#ff8c00'], ['ICEBOX+', '#22d3ff', '#0b1230'],
  ['CHILL.GG', '#b45cff', '#ffffff'], ['SNOWDOME', '#ff3d7f', '#ffffff'],
];
/** Omega Summit's core tower (north-west, clear of the jumbotron sightline). */
export const CORE_X = -34;
export const CORE_Z = -92;

/** Golden Tower Plaza: the rally stage spans |x| < STAGE_HALF behind the north wall (over the boss gate's tunnel),
 *  deck at STAGE_Y; the gold tower looms far to the north-east. */
export const STAGE_HALF = 13;
export const STAGE_Y = 4.75;
export const STAGE_Z0 = -32.3;
export const STAGE_Z1 = -41.4;
export const GOLD_TOWER_X = 38;
export const GOLD_TOWER_Z = -150;

export type SideKey = 'n' | 's' | 'w' | 'e';
export interface Side {
  key: SideKey;
  /** Yaw that turns local +Z toward the arena interior. */
  yaw: number;
  /** (s along the wall, n outward distance from the arena edge) -> world [x, z]. */
  map: (s: number, n: number) => [number, number];
  s0: number;
  s1: number;
  h: number;
}

/** Snowdome mode: no gates, uniform wall height. Set by buildDecor. */
export let brawlMode = false;
/** Snowdome scale: the current arena's half-size over the Brawl dome's (1 in Brawl; 2/3 in the Duel's shrunk dome,
 *  DUEL_ARENA_HALF 60). Snowdome dressing laid out for the 180 m dome (cover positions, tunnels, light aims) is placed
 *  at this scale; object sizes stay as they are. Set by setBrawlMode. */
export let domeK = 1;
/** Nominal Snowdome cover sites in the base quadrant (Environment.buildObstacles rotates them by 90° steps and jitters
 *  them by up to 2 m), for the 180 m dome: multiply by domeK. tests/biomes.test.ts keeps terrain off them. */
export const DOME_COVER = {
  pillars: [24, 16],
  container: [47, 10],
  rock: [38, 40],
  snowman: [12, 54],
  tires: [77, 36],
  corner: [62, 64],
} as const;
/** The only writer of `brawlMode` (an imported binding is read-only in other modules). */
/** Quality preset crowd subsample (pure, deterministic, no RNG): the indices of `n` crowd figures kept at `fraction`,
 *  spread evenly along the build order; null = keep all (fraction >= 1). */
export function crowdKeep(n: number, fraction: number): number[] | null {
  if (fraction >= 1) return null;
  const f = Math.max(0, fraction);
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (Math.floor((i + 1) * f) > Math.floor(i * f)) out.push(i);
  return out;
}

export function setBrawlMode(on: boolean): void {
  brawlMode = on;
  domeK = on ? ARENA.maxX / BRAWL_ARENA_HALF : 1;
}
export const BRAWL_WALL_H = 3.0;

// s0/s1/h are getters: ARENA is mutable (campaign ±30 / Brawl ±90).
export const SIDES: Side[] = [
  { key: 'n', yaw: 0, map: (s, n) => [s, ARENA.minZ - n], get s0() { return ARENA.minX - WALL_C; }, get s1() { return ARENA.maxX + WALL_C; }, get h() { return brawlMode ? BRAWL_WALL_H : WALL_H; } },
  { key: 's', yaw: Math.PI, map: (s, n) => [s, ARENA.maxZ + n], get s0() { return ARENA.minX - WALL_C; }, get s1() { return ARENA.maxX + WALL_C; }, get h() { return brawlMode ? BRAWL_WALL_H : SOUTH_H; } },
  { key: 'w', yaw: Math.PI / 2, map: (s, n) => [ARENA.minX - n, s], get s0() { return ARENA.minZ - WALL_IN; }, get s1() { return ARENA.maxZ + WALL_IN; }, get h() { return brawlMode ? BRAWL_WALL_H : WALL_H; } },
  { key: 'e', yaw: -Math.PI / 2, map: (s, n) => [ARENA.maxX + n, s], get s0() { return ARENA.minZ - WALL_IN; }, get s1() { return ARENA.maxZ + WALL_IN; }, get h() { return brawlMode ? BRAWL_WALL_H : WALL_H; } },
];

/** Which wall each gate sits in, and its coordinate along that wall (campaign arena only). */
export const GATE_SIDES = ENEMY_GATES.map((g) => {
  const key: SideKey = g.z < -30 ? 'n' : g.z > 30 ? 's' : g.x < -30 ? 'w' : 'e';
  return { key, s: key === 'n' || key === 's' ? g.x : g.z };
});

export function gapsFor(key: SideKey, half: number): [number, number][] {
  if (brawlMode) return [];
  return GATE_SIDES.filter((g) => g.key === key).map((g) => [g.s - half, g.s + half] as [number, number]);
}

export function subtract(a: number, b: number, gaps: [number, number][]): [number, number][] {
  let out: [number, number][] = [[a, b]];
  for (const [g0, g1] of gaps) {
    const next: [number, number][] = [];
    for (const [x0, x1] of out) {
      if (g1 <= x0 || g0 >= x1) next.push([x0, x1]);
      else {
        if (g0 > x0) next.push([x0, g0]);
        if (g1 < x1) next.push([g1, x1]);
      }
    }
    out = next;
  }
  return out.filter(([x0, x1]) => x1 - x0 > 0.5);
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Adds a constant vertex-color attribute (for merged multi-colored instanced models). */
export function colored(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
}
