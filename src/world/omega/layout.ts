/**
 * THE OMEGA WORKS (arena 6) layout: a 160 x 160 m factory.
 *
 *   - A ring of ground-level snow (the only place you can grow a ball) with half-pipe banks along the walls,
 *     kicker ramps, conveyor strips and four pistons that rise and fall.
 *   - The ASSEMBLY FLOOR: a 36 x 36 m steel deck 7 m up on pillars. You can drive underneath it (the UNDERCROFT,
 *     snowy, shadowy) or climb one of four ramps onto it.
 *   - The CONTROL TOWER: a second deck 13 m up, standing on the Assembly Floor, reached by a steep ramp. Its east end
 *     overhangs the ground ring.
 *   - Two long BRIDGES run from the Assembly Floor's corners to the NE / SW PLATFORMS (7 m up, each with a ramp back
 *     down). The bridges pass over the ring, so you drive under them too.
 *
 * Everything here is data for world/Terrain.ts (decks / shapes / conveyors) plus the bot routing graph
 * (world/omega/nav.ts) and spawn points. Coordinates: +x east, +z south. Deck rot 0 = local z along world z.
 */
import type { Conveyor, Deck, TerrainDef, TerrainShape } from '../Terrain';
import type { NavDef } from './nav';

export const OMEGA_HALF = 80;

/** Deck heights. */
export const FLOOR_Y = 7;
export const TOWER_Y = 13;
const FLOOR_T = 1.2; // Assembly Floor / platform thickness (underside 5.8: plows and bosses fit underneath)
const BRIDGE_T = 1;

/** Deck ids (stable: nav + visuals key off them). */
export const D = {
  floor: 1,
  tower: 3,
  platNE: 5,
  platSW: 6,
  bridgeNE: 7,
  bridgeSW: 8,
  rampS: 40,
  rampN: 41,
  rampE: 42,
  rampW: 43,
  rampTower: 44,
  rampNE: 45,
  rampSW: 46,
  piston0: 60,
} as const;

const decks: Deck[] = [];
const deck = (d: Deck): Deck => (decks.push(d), d);

// ---- Assembly Floor + its pillars (3 x 3 grid, the middle one a fat reactor column)
deck({ id: D.floor, x: 0, z: 0, hw: 18, hd: 18, rot: 0, top: FLOOR_Y, thickness: FLOOR_T });
{
  let id = 10;
  for (const px of [-12, 0, 12]) {
    for (const pz of [-12, 0, 12]) {
      const fat = px === 0 && pz === 0;
      const top = FLOOR_Y - FLOOR_T;
      deck({ id: id++, x: px, z: pz, hw: fat ? 2.6 : 0.8, hd: fat ? 2.6 : 0.8, rot: 0, top, thickness: top });
    }
  }
}

// ---- Control Tower (east end overhangs the ring by 4 m) + its two support columns on the Floor
deck({ id: D.tower, x: 9, z: -8, hw: 13, hd: 9, rot: 0, top: TOWER_Y, thickness: 1 });
deck({ id: 20, x: -2, z: -14, hw: 0.8, hd: 0.8, rot: 0, top: TOWER_Y - 1, thickness: TOWER_Y - 1 - FLOOR_Y });
deck({ id: 21, x: 6, z: -15, hw: 0.8, hd: 0.8, rot: 0, top: TOWER_Y - 1, thickness: TOWER_Y - 1 - FLOOR_Y });

// ---- Outer platforms + pillars
for (const [id, cx, cz] of [
  [D.platNE, 52, -52],
  [D.platSW, -52, 52],
] as const) {
  deck({ id, x: cx, z: cz, hw: 12, hd: 12, rot: 0, top: FLOOR_Y, thickness: FLOOR_T });
  let pid = id * 10 + 100;
  for (const ox of [-7, 7]) for (const oz of [-7, 7]) {
    const top = FLOOR_Y - FLOOR_T;
    deck({ id: pid++, x: cx + ox, z: cz + oz, hw: 0.8, hd: 0.8, rot: 0, top, thickness: top });
  }
}

// ---- Bridges (diagonal, Floor corner -> platform corner) + a mid pillar each
const DIAG = (3 * Math.PI) / 4; // local +z points toward (+x, -z)
deck({ id: D.bridgeNE, x: 29, z: -29, hw: 3.5, hd: 17.5, rot: DIAG, top: FLOOR_Y, thickness: BRIDGE_T });
deck({ id: D.bridgeSW, x: -29, z: 29, hw: 3.5, hd: 17.5, rot: DIAG, top: FLOOR_Y, thickness: BRIDGE_T });
deck({ id: 170, x: 29, z: -29, hw: 0.8, hd: 0.8, rot: DIAG, top: FLOOR_Y - BRIDGE_T, thickness: FLOOR_Y - BRIDGE_T });
deck({ id: 171, x: -29, z: 29, hw: 0.8, hd: 0.8, rot: DIAG, top: FLOOR_Y - BRIDGE_T, thickness: FLOOR_Y - BRIDGE_T });

// ---- Ramps: solid wedges (thickness = full height so their sides are walls). `rise` runs along local z.
// South: z 44 (ground) -> z 18 (Floor). North: z -44 -> -18. East: x 44 -> 18. West: x -44 -> -18.
deck({ id: D.rampS, x: 0, z: 31, hw: 5, hd: 13, rot: 0, top: FLOOR_Y, rise: -FLOOR_Y, thickness: FLOOR_Y });
deck({ id: D.rampN, x: 0, z: -31, hw: 5, hd: 13, rot: 0, top: 0, rise: FLOOR_Y, thickness: FLOOR_Y });
deck({ id: D.rampE, x: 31, z: 0, hw: 5, hd: 13, rot: Math.PI / 2, top: FLOOR_Y, rise: -FLOOR_Y, thickness: FLOOR_Y });
deck({ id: D.rampW, x: -31, z: 0, hw: 5, hd: 13, rot: Math.PI / 2, top: 0, rise: FLOOR_Y, thickness: FLOOR_Y });
// Tower ramp: on the Floor, z 15 (Floor) -> z 1 (Tower edge).
deck({ id: D.rampTower, x: 9, z: 8, hw: 4, hd: 7, rot: 0, top: TOWER_Y, rise: FLOOR_Y - TOWER_Y, thickness: TOWER_Y - FLOOR_Y });
// Platform ramps: NE runs south (z -40 platform -> z -14 ground), SW runs north (z 40 -> z 14).
deck({ id: D.rampNE, x: 52, z: -27, hw: 4.5, hd: 13, rot: 0, top: FLOOR_Y, rise: -FLOOR_Y, thickness: FLOOR_Y });
deck({ id: D.rampSW, x: -52, z: 27, hw: 4.5, hd: 13, rot: 0, top: 0, rise: FLOOR_Y, thickness: FLOOR_Y });

// ---- Pistons in the ring: flush with the ground, rising 5 m on staggered cycles.
export const PISTONS: { x: number; z: number }[] = [
  { x: 62, z: 16 },
  { x: -62, z: -16 },
  { x: 16, z: -64 },
  { x: -16, z: 64 },
];
PISTONS.forEach((p, i) =>
  deck({ id: D.piston0 + i, x: p.x, z: p.z, hw: 3, hd: 3, rot: 0, top: 0, thickness: 6, piston: { amp: 5, period: 7, phase: i * 0.25 } }),
);

// ---- Ground shapes: half-pipe banks along the walls, a couple of drop pits, kicker ramps in the ring.
const B = OMEGA_HALF;
const shapes: TerrainShape[] = [
  { kind: 'ridge', x1: -B, z1: -B, x2: B, z2: -B, w: 10, h: 5 },
  { kind: 'ridge', x1: -B, z1: B, x2: B, z2: B, w: 10, h: 5 },
  { kind: 'ridge', x1: -B, z1: -B, x2: -B, z2: B, w: 10, h: 5 },
  { kind: 'ridge', x1: B, z1: -B, x2: B, z2: B, w: 10, h: 5 },
  { kind: 'dome', x: -52, z: -52, r: 11, h: -3.5, rim: 0.6 },
  { kind: 'dome', x: 52, z: 52, r: 11, h: -3.5, rim: 0.6 },
  // kickers (launch you across the ring)
  { kind: 'ramp', x: -30, z: 56, rot: Math.PI / 2, len: 7, w: 6, h: 1.8, fall: 1.2 },
  { kind: 'ramp', x: 30, z: -56, rot: -Math.PI / 2, len: 7, w: 6, h: 1.8, fall: 1.2 },
  { kind: 'ramp', x: 56, z: 30, rot: Math.PI, len: 7, w: 6, h: 1.8, fall: 1.2 },
  { kind: 'ramp', x: -56, z: -30, rot: 0, len: 7, w: 6, h: 1.8, fall: 1.2 },
];

// ---- Conveyors: two on the Floor (fling you off its W / S edges), two loops in the ring.
const conveyors: Conveyor[] = [
  { minX: -17, maxX: -6, minZ: 10, maxZ: 15, dx: -1, dz: 0, speed: 4, deck: D.floor },
  { minX: 14, maxX: 17.5, minZ: 4, maxZ: 16, dx: 0, dz: 1, speed: 4, deck: D.floor },
  { minX: -30, maxX: 30, minZ: 60, maxZ: 64, dx: 1, dz: 0, speed: 5 },
  { minX: -30, maxX: 30, minZ: -64, maxZ: -60, dx: -1, dz: 0, speed: 5 },
];

export const OMEGA_TERRAIN: TerrainDef = {
  shapes,
  decks,
  conveyors,
  baseMaterial: 'snow',
};

/** Player spawn: the south ring, facing the Assembly Floor (heading π = facing -z, like PLOW_SPAWN). */
export const OMEGA_SPAWN = { x: 0, z: 62, heading: Math.PI } as const;

/**
 * Floor hatches bots rise out of (instead of only the far wall gates). Spawning picks hatches within ~35 m of the
 * player, so a 160 m arena never means a long drive to the next fight. `deck` = the surface the hatch sits on.
 */
export const OMEGA_HATCHES: { x: number; z: number; deck: number }[] = [
  // ground ring (about every 20 m, so there are always a few 9-35 m from the player)
  { x: 0, z: 70, deck: -1 }, { x: 36, z: 66, deck: -1 }, { x: -36, z: 66, deck: -1 },
  { x: 18, z: 52, deck: -1 }, { x: -18, z: 52, deck: -1 }, { x: 22, z: 72, deck: -1 }, { x: -22, z: 72, deck: -1 },
  { x: 0, z: -70, deck: -1 }, { x: 36, z: -66, deck: -1 }, { x: -36, z: -66, deck: -1 },
  { x: 18, z: -52, deck: -1 }, { x: -18, z: -52, deck: -1 },
  { x: 70, z: 0, deck: -1 }, { x: 66, z: 36, deck: -1 }, { x: 66, z: -36, deck: -1 }, { x: 54, z: 18, deck: -1 },
  { x: -70, z: 0, deck: -1 }, { x: -66, z: 36, deck: -1 }, { x: -66, z: -36, deck: -1 }, { x: -54, z: -18, deck: -1 },
  { x: 36, z: 36, deck: -1 }, { x: -36, z: -36, deck: -1 }, { x: 36, z: 52, deck: -1 }, { x: -36, z: -52, deck: -1 },
  // undercroft
  { x: -6, z: 6, deck: -1 }, { x: 6, z: -6, deck: -1 },
  // Assembly Floor, platforms, tower
  { x: -10, z: -4, deck: D.floor }, { x: -2, z: 8, deck: D.floor }, { x: -12, z: 4, deck: D.floor },
  { x: 52, z: -52, deck: D.platNE }, { x: -52, z: 52, deck: D.platSW },
  { x: 14, z: -10, deck: D.tower },
];

/** Wall gates (bosses arrive through the north one). Mirrors ENEMY_GATES' layout, pushed out to this arena's walls. */
export const OMEGA_GATES = [
  { x: 0, z: -(B + 4), heading: 0 },
  { x: -(B + 4), z: -8, heading: Math.PI / 2 },
  { x: B + 4, z: -8, heading: -Math.PI / 2 },
] as const;

/**
 * Bot routing graph. Regions: -1 ground, D.floor, each bridge, D.tower, D.platNE, D.platSW. Ramps are their
 * own transit regions (see nav.ts). Ramp-bottom nodes sit 1.5 m off each toe (inside NODE_REACHED, so arriving there
 * and stepping onto the ramp never flip-flops); edges are directed (drops are one-way).
 */
export const OMEGA_NAV: NavDef = {
  regionOfDeck: {
    [D.floor]: D.floor,
    [D.bridgeNE]: D.bridgeNE,
    [D.bridgeSW]: D.bridgeSW,
    [D.tower]: D.tower,
    [D.platNE]: D.platNE,
    [D.platSW]: D.platSW,
  },
  nodes: {
    // core ramps: bottom (ground) / top (Floor)
    sBot: { x: 0, z: 45.5, region: -1 }, sTop: { x: 0, z: 15, region: D.floor },
    nBot: { x: 0, z: -45.5, region: -1 }, nTop: { x: 3, z: -15, region: D.floor },
    eBot: { x: 45.5, z: 0, region: -1 }, eTop: { x: 15, z: 0, region: D.floor },
    wBot: { x: -45.5, z: 0, region: -1 }, wTop: { x: -15, z: 0, region: D.floor },
    // tower ramp
    tBot: { x: 9, z: 16, region: D.floor }, tTop: { x: 9, z: -2, region: D.tower },
    // bridges: Floor corner -> bridge middle -> platform corner
    neCorner: { x: 14, z: -14, region: D.floor }, neMid: { x: 29, z: -29, region: D.bridgeNE }, neEnd: { x: 44, z: -44, region: D.platNE },
    swCorner: { x: -14, z: 14, region: D.floor }, swMid: { x: -29, z: 29, region: D.bridgeSW }, swEnd: { x: -44, z: 44, region: D.platSW },
    // platform ramps
    neTop: { x: 52, z: -42, region: D.platNE }, neBot: { x: 52, z: -12.5, region: -1 },
    swTop: { x: -52, z: 42, region: D.platSW }, swBot: { x: -52, z: 12.5, region: -1 },
    // drop-off points (Floor edge -> ground, tower overhang -> ground, platform edges -> ground)
    dropFloorS: { x: 12, z: 17, region: D.floor }, landFloorS: { x: 12, z: 22, region: -1 },
    dropFloorN: { x: -12, z: -17, region: D.floor }, landFloorN: { x: -12, z: -22, region: -1 },
    dropTower: { x: 21, z: -8, region: D.tower }, landTower: { x: 25, z: -8, region: -1 },
    dropNE: { x: 63, z: -52, region: D.platNE }, landNE: { x: 68, z: -52, region: -1 },
    dropSW: { x: -63, z: 52, region: D.platSW }, landSW: { x: -68, z: 52, region: -1 },
  },
  ramps: [
    { deck: D.rampS, bottom: 'sBot', top: 'sTop' },
    { deck: D.rampN, bottom: 'nBot', top: 'nTop' },
    { deck: D.rampE, bottom: 'eBot', top: 'eTop' },
    { deck: D.rampW, bottom: 'wBot', top: 'wTop' },
    { deck: D.rampTower, bottom: 'tBot', top: 'tTop' },
    { deck: D.rampNE, bottom: 'neBot', top: 'neTop' },
    { deck: D.rampSW, bottom: 'swBot', top: 'swTop' },
  ],
  edges: [
    // bridges (both ways)
    ['neCorner', 'neMid'], ['neMid', 'neCorner'], ['neMid', 'neEnd'], ['neEnd', 'neMid'],
    ['swCorner', 'swMid'], ['swMid', 'swCorner'], ['swMid', 'swEnd'], ['swEnd', 'swMid'],
    // drops (one way)
    ['dropFloorS', 'landFloorS'], ['dropFloorN', 'landFloorN'], ['dropTower', 'landTower'],
    ['dropNE', 'landNE'], ['dropSW', 'landSW'],
  ],
};
