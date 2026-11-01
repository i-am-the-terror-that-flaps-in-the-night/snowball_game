/**
 * Ground terrain for the biome arenas (docs/level-overhaul.md "Arenas"). Pure data: shapes + material patches +
 * gravity, read by Terrain.load via ZoneDef.terrain. Ground layer only (no decks: those are The Omega Works').
 *
 * Campaign arenas are 60 x 60 m (CAMPAIGN_ARENA_HALF 30). Layout rules (tests/biomes.test.ts checks them):
 *  - the plow spawn (PLOW_SPAWN, 0 / 18), the Duel spawns (0 / +-15) and the first metres of every gate lane stay flat
 *    and patch-free;
 *  - lava covers at most ~15% of the floor;
 *  - the centre stays readable for the boss fights (at most a shallow bowl / pit);
 *  - (every arena, Brawl too) no lava on a ramp's run-up or face, and 6 m of lava-free run-out past every landing off
 *    it, side drops and angled launches included.
 *
 * Brawl variants are for the 180 x 180 m Snowdome (BRAWL_ARENA_HALF 90): features sit in the open pockets between the
 * fixed cover obstacles (Environment.buildObstacles) and clear of the Brawl spawn rings (r ~69 and ~34).
 *
 * Ramps: rot is the heading the ramp RISES toward (0 = +z); (x, z) is its toe. A lip launches you.
 */
import type { MaterialPatch, TerrainDef, TerrainShape } from '../Terrain';

const PI = Math.PI;

/** Heading from (x1, z1) toward (x2, z2) in the Terrain ramp convention (0 = +z). */
const heading = (x1: number, z1: number, x2: number, z2: number) => Math.atan2(x2 - x1, z2 - z1);

/** A ramp whose lip sits `gap` metres before (cx, cz) coming from direction `rot` (the lip faces the point). */
function rampTo(cx: number, cz: number, rot: number, gap: number, len: number, w: number, h: number, fall = 1.2): TerrainShape {
  const lx = cx - Math.sin(rot) * gap;
  const lz = cz - Math.cos(rot) * gap;
  return { kind: 'ramp', x: lx - Math.sin(rot) * len, z: lz - Math.cos(rot) * len, rot, len, w, h, fall };
}

/* ------------------------------------------------------------------ campaign arenas (60 m) */

/** 1. Coldboot Glacier: gentle. A shallow ice bowl in the middle, two low ice ramps flanking the spawn, ice sheets. */
export const GLACIER_TERRAIN: TerrainDef = {
  shapes: [
    { kind: 'dome', x: 0, z: -3, r: 12, h: -1.3 },
    { kind: 'ramp', x: -17, z: 9, rot: PI, len: 6, w: 4.5, h: 1.1, fall: 1.1 },
    { kind: 'ramp', x: 17, z: 9, rot: PI, len: 6, w: 4.5, h: 1.1, fall: 1.1 },
  ],
  patches: [
    { material: 'ice', x: 0, z: -3, r: 5.5 },
    { material: 'ice', x: -19, z: -20, r: 4 },
    { material: 'ice', x: 20, z: -21, r: 3.5 },
    // the ramps themselves are glazed
    { material: 'ice', x: -17, z: 8, x2: -17, z2: 3.6, r: 1.9 },
    { material: 'ice', x: 17, z: 8, x2: 17, z2: 3.6, r: 1.9 },
  ],
};

/** A ramp's lava trench: a short capsule centred on (cx, cz) across heading `rot`, `half` m to each side of the lane.
 *  Short on purpose: a long river running on past the ramp's sides leaves no run-out for a plow that drops off a side
 *  edge, or launches at an angle, and lands in front of it (tests/biomes.test.ts "ramp lanes" checks every landing). */
function trench(cx: number, cz: number, rot: number, half: number, r: number): MaterialPatch {
  const px = Math.cos(rot);
  const pz = -Math.sin(rot);
  return { material: 'lava', x: cx - px * half, z: cz - pz * half, x2: cx + px * half, z2: cz + pz * half, r };
}

/** Inferno Quarry jumps (Brawl Quarry too): a ramp launching over a lava trench, its lip `gap` m before the trench's
 *  axis. The trench starts 1.1 m past the foot of the ramp's fall: at least a snow cell (1 m in Brawl), so no snow
 *  triangle spans from the fall to the lava and pokes up through the pool. */
const QUARRY_JUMP = { gap: 3.5, len: 5.5, w: 6.5, h: 1.6, half: 2.2, r: 1.2 };
const QUARRY_JUMPS: [number, number, number][] = [
  [-19.5, 10, heading(0, 0, -0.33, 1)],
  [19.5, 10, heading(0, 0, 0.33, 1)],
];

/** 2. Inferno Quarry: moderate. The quarry pit in the middle, berms by the spawn, two long lava rivers in the north
 *  corners and two jump ramps over lava trenches in the south. */
export const QUARRY_TERRAIN: TerrainDef = {
  shapes: [
    { kind: 'dome', x: 0, z: -1, r: 8.5, h: -2.4, rim: 0.6 },
    { kind: 'ridge', x1: -25, z1: 22, x2: -12, z2: 25, w: 3.2, h: 1.1 },
    { kind: 'ridge', x1: 12, z1: 25, x2: 25, z2: 22, w: 3.2, h: 1.1 },
    ...QUARRY_JUMPS.map(([x, z, rot]) => {
      const { gap, len, w, h } = QUARRY_JUMP;
      return rampTo(x, z, rot, gap, len, w, h);
    }),
  ],
  patches: [
    { material: 'lava', x: -27, z: -16.5, x2: -16.5, z2: -27, r: 1.8 },
    { material: 'lava', x: 27, z: -16.5, x2: 16.5, z2: -27, r: 1.8 },
    ...QUARRY_JUMPS.map(([x, z, rot]) => trench(x, z, rot, QUARRY_JUMP.half, QUARRY_JUMP.r)),
  ],
  baseMaterial: 'rock',
};

/** 3. Rust Basin: big. Overlapping rimmed craters, wind dunes, a drivable mesa and a steep one with a launch ramp.
 *  Low gravity (x0.6) makes every crest a long hop. */
export const MARS_TERRAIN: TerrainDef = {
  shapes: [
    // two pairs of overlapping rimmed craters (south-west, north-east)
    { kind: 'dome', x: -13, z: 7, r: 6.5, h: -2.2, rim: 1.1 },
    { kind: 'dome', x: -20, z: 14, r: 4, h: -1.5, rim: 0.8 },
    { kind: 'dome', x: 12, z: -17, r: 6, h: -2, rim: 1 },
    { kind: 'dome', x: 18, z: -24, r: 4, h: -1.4, rim: 0.7 },
    // wind dunes
    { kind: 'ridge', x1: 15, z1: 26, x2: 26, z2: 15, w: 4, h: 1.3 },
    { kind: 'ridge', x1: -26, z1: 22, x2: -15, z2: 25, w: 3.2, h: 1.2 },
    // gentle-sided mesa (drive up it) and a steep one you jump onto
    { kind: 'mesa', x: -21, z: -21, r: 3.5, h: 2.0, slope: 7 },
    { kind: 'mesa', x: 21, z: 5, r: 3, h: 2.4, slope: 2.4 },
    rampTo(21, 5, heading(8, 8, 21, 5), 3 + 2.4 + 2, 6, 4, 1.6),
  ],
  gravityMult: 0.6,
  baseMaterial: 'rock',
};

/** 4. The Thermal Divide: light. A shallow dip down the middle, a small ramp on each side; lava vents on the hot
 *  (west, -x) half, ice on the cold (east, +x) half. */
export const DIVIDE_TERRAIN: TerrainDef = {
  shapes: [
    { kind: 'ridge', x1: 0, z1: -8, x2: 0, z2: 4, w: 6, h: -0.9 },
    { kind: 'ramp', x: -16, z: 8, rot: PI, len: 5, w: 4, h: 0.9 },
    { kind: 'ramp', x: 16, z: 8, rot: PI, len: 5, w: 4, h: 0.9 },
  ],
  patches: [
    { material: 'lava', x: -20, z: -18, r: 2.3 },
    { material: 'lava', x: -11, z: -24, r: 1.8 },
    { material: 'lava', x: -23, z: 4, r: 2 },
    { material: 'lava', x: -9, z: 22, x2: -13, z2: 26, r: 1.5 },
    { material: 'ice', x: 17, z: -19, r: 4.5 },
    { material: 'ice', x: 22, z: 3, r: 3.5 },
    { material: 'ice', x: 10, z: 23, r: 3 },
  ],
};

/* ------------------------------------------------------------------ Brawl variants (180 m) */

/** Open pockets of the Snowdome floor, base quadrant (rotated by 90° steps): A = between a container, a rock outcrop
 *  and the outer spawn ring (feature radius <= 8); B = the inner ring around the fountain (feature radius <= 7). */
const rot90 = (q: number, x: number, z: number): [number, number] => {
  const c = Math.round(Math.cos((q * PI) / 2));
  const s = Math.round(Math.sin((q * PI) / 2));
  return [x * c - z * s, x * s + z * c];
};
const SITE_A: [number, number] = [50, 25];
const SITE_B: [number, number] = [0, 15];
/** Tangential heading at a point (counter-clockwise around the centre). */
const tangent = (x: number, z: number) => heading(0, 0, -z, x);

function quads<T>(fn: (q: number, a: [number, number], b: [number, number]) => T[]): T[] {
  const out: T[] = [];
  for (let q = 0; q < 4; q++) out.push(...fn(q, rot90(q, ...SITE_A), rot90(q, ...SITE_B)));
  return out;
}

export const BRAWL_GLACIER_TERRAIN: TerrainDef = {
  shapes: quads<TerrainShape>((_q, [ax, az], [bx, bz]) => {
    const r = tangent(ax, az);
    return [
      { kind: 'ramp', x: ax - Math.sin(r) * 4, z: az - Math.cos(r) * 4, rot: r, len: 7, w: 5, h: 1.4, fall: 1.2 },
      { kind: 'dome', x: bx, z: bz, r: 6.5, h: -1.2 },
    ];
  }),
  patches: quads<MaterialPatch>((_q, [ax, az], [bx, bz]) => {
    const r = tangent(ax, az);
    return [
      { material: 'ice', x: bx, z: bz, r: 3.6 },
      { material: 'ice', x: ax - Math.sin(r) * 3, z: az - Math.cos(r) * 3, x2: ax + Math.sin(r) * 2.4, z2: az + Math.cos(r) * 2.4, r: 2.1 },
    ];
  }),
};

/** Brawl Quarry river (base quadrant): 10 m long, centred at (16, 42), running along x (searched clear of both spawn rings, the cover and every ramp lane in all four rotated copies). */
const QUARRY_RIVER: [[number, number], [number, number]] = [[11, 42], [21, 42]];

/** Brawl Quarry: at each A site a ramp along the tangent launches over a lava trench (the campaign's QUARRY_JUMP). */
export const BRAWL_QUARRY_TERRAIN: TerrainDef = {
  shapes: quads<TerrainShape>((_q, [ax, az], [bx, bz]) => {
    const { gap, len, w, h } = QUARRY_JUMP;
    return [rampTo(ax, az, tangent(ax, az), gap, len, w, h), { kind: 'dome', x: bx, z: bz, r: 6.5, h: -1.8, rim: 0.5 }];
  }),
  patches: quads<MaterialPatch>((q, [ax, az]) => {
    // Plus a 10 m river in the open pocket between the fountain ring and the outcrop (searched clear of the spawn
    // ring, cover, ramp lanes and pit rims), so the venue keeps its lava look now the jump trenches are short.
    const [x1, z1] = rot90(q, ...QUARRY_RIVER[0]);
    const [x2, z2] = rot90(q, ...QUARRY_RIVER[1]);
    return [trench(ax, az, tangent(ax, az), QUARRY_JUMP.half, QUARRY_JUMP.r), { material: 'lava', x: x1, z: z1, x2, z2, r: 1.8 }];
  }),
  baseMaterial: 'rock',
};

export const BRAWL_MARS_TERRAIN: TerrainDef = {
  shapes: quads<TerrainShape>((_q, [ax, az], [bx, bz]) => [
    { kind: 'dome', x: ax, z: az, r: 6, h: -2, rim: 1.1 },
    { kind: 'mesa', x: bx, z: bz, r: 2.6, h: 1.8, slope: 4 },
  ]),
  gravityMult: 0.6,
  baseMaterial: 'rock',
};

/** Brawl Divide: the ramp at each A site runs along the tangent, toe 3 m before the site, 6 m long, 4.5 m wide. */
const DIVIDE_RAMP = { back: 3, len: 6, w: 4.5, h: 1.2 };
const DIVIDE_VENT_R = 2.4;
/** The hot-side vent sits beside the ramp, toward the centre: clear of the ramp's run-up lane and face (and of the
 *  snow's melt fringe around it), never in front of it. */
const DIVIDE_VENT_SIDE = DIVIDE_RAMP.w / 2 + DIVIDE_VENT_R + 2.8;

export const BRAWL_DIVIDE_TERRAIN: TerrainDef = {
  shapes: [
    { kind: 'ridge', x1: 0, z1: 13, x2: 0, z2: 36, w: 6, h: -0.9 },
    { kind: 'ridge', x1: 0, z1: -13, x2: 0, z2: -36, w: 6, h: -0.9 },
    ...quads<TerrainShape>((_q, [ax, az]) => {
      const r = tangent(ax, az);
      const { back, len, w, h } = DIVIDE_RAMP;
      return [{ kind: 'ramp', x: ax - Math.sin(r) * back, z: az - Math.cos(r) * back, rot: r, len, w, h }];
    }),
  ],
  patches: quads<MaterialPatch>((_q, [ax, az], [bx]) => {
    // B sites on the x axis only (the z-axis ones sit in the central dip)
    const out: MaterialPatch[] = [];
    if (ax < 0) {
      const d = Math.hypot(ax, az); // the ramp runs along the tangent, so "beside it" is radial
      out.push({ material: 'lava', x: ax - (ax / d) * DIVIDE_VENT_SIDE, z: az - (az / d) * DIVIDE_VENT_SIDE, r: DIVIDE_VENT_R });
    } else out.push({ material: 'ice', x: ax, z: az, r: 5 });
    if (bx < -1) out.push({ material: 'lava', x: bx, z: 0, r: 2.2 });
    else if (bx > 1) out.push({ material: 'ice', x: bx, z: 0, r: 4.5 });
    return out;
  }),
};
