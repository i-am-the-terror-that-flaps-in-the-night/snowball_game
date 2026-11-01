/**
 * Dev test terrain: one of every terrain feature in a 60 x 60 m campaign arena, for scripts/terrain-probe.mjs and
 * tests/terrainMotion.test.ts (never used by a real arena). Load it with `ctx.terrain.load(DEV_TERRAIN)` (the probe
 * does this through window.__game during a run, then `ctx.snow.reset(ctx.zone)` so the snow follows it).
 *
 * The plow spawns at (0, 18) facing -z. Features (DEV_FEATURES has the numbers the probe drives at):
 *   - RAMP   west (x -18): toe at z 14, rises 2.2 m toward -z over 8 m, 1.5 m drop-off at the lip (z 6).
 *   - CREST  north (z -22): a sharp ridge across x -8..8, 1.4 m high, 3 m half-width.
 *   - BOWL   east (14, 8): 9 m radius, 2.5 m deep.
 *   - LAVA   a capsule (6, -8) -> (16, -8), 1.6 m radius, on flat ground.
 *   - ICE    a 6 m sheet at (-18, -18), flat.
 *   - CONVEYOR a strip x 21..27, z -28..-14 pushing +z at 4 m/s.
 */
import type { TerrainDef } from './Terrain';

export const DEV_FEATURES = {
  ramp: { x: -18, toeZ: 14, lipZ: 6, h: 2.2, len: 8, w: 6, fall: 1.5 },
  crest: { z: -22, x1: -8, x2: 8, h: 1.4, w: 3 },
  bowl: { x: 14, z: 8, r: 9, h: -2.5 },
  lava: { x1: 6, x2: 16, z: -8, r: 1.6 },
  ice: { x: -18, z: -18, r: 6 },
  conveyor: { minX: 21, maxX: 27, minZ: -28, maxZ: -14, speed: 4 },
} as const;

const F = DEV_FEATURES;

export const DEV_TERRAIN: TerrainDef = {
  shapes: [
    { kind: 'ramp', x: F.ramp.x, z: F.ramp.toeZ, rot: Math.PI, len: F.ramp.len, w: F.ramp.w, h: F.ramp.h, fall: F.ramp.fall },
    { kind: 'ridge', x1: F.crest.x1, z1: F.crest.z, x2: F.crest.x2, z2: F.crest.z, w: F.crest.w, h: F.crest.h },
    { kind: 'dome', x: F.bowl.x, z: F.bowl.z, r: F.bowl.r, h: F.bowl.h },
  ],
  patches: [
    { material: 'lava', x: F.lava.x1, z: F.lava.z, x2: F.lava.x2, z2: F.lava.z, r: F.lava.r },
    { material: 'ice', x: F.ice.x, z: F.ice.z, r: F.ice.r },
  ],
  conveyors: [{ minX: F.conveyor.minX, maxX: F.conveyor.maxX, minZ: F.conveyor.minZ, maxZ: F.conveyor.maxZ, dx: 0, dz: 1, speed: F.conveyor.speed }],
};
