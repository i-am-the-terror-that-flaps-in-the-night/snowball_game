/**
 * PROTOCOL C's arena floor (docs/modes.md "Protocol C"): the standard 60 x 60 m campaign footprint (the boss AIs assume
 * it: FROSTBYTE's +-24 m snow search, THE DONALD's rally spot at (0, -21)), "restructured" between waves. Every feature
 * has one fixed place, so any wave can stack any of them without overlaps; protocolTerrain(wave) picks the wave's set.
 *
 *   RINK    a glazed ice rink in the middle (every wave: the "gold on ice" look)
 *   RING    a broken lava ring at r = 21 with gaps at the three gates, the spawn side and the rally spot (north)
 *   BROKEN  two rimmed craters south of the centre and two low launch ramps north of it (they land on the rink)
 *   HALVES  hot west (three lava vents + the Thermal Divide's scorch decal), cold east (three ice sheets)
 *   DECKS   two low steel decks (1.2 m) east and west, a ramp at each end (MEGAPLOW's deck leap reads any terrain.decks)
 *   (the rally stage of waves 5+ is venue decor behind the north wall, like the Plaza's: ZoneDef.stage)
 *
 * Waves: 1 rink · 2 + ring · 3 + broken ground · 4 rink + hot/cold halves · 5 + stage · 6 + decks · 7 everything.
 * Layout rules (tests/protocol.test.ts): the plow spawn and the first metres of every gate lane stay flat and patch-free,
 * lava covers well under 15% of the floor, the rally spot is never lava, no lava touches a deck or a ramp's lane.
 */
import type { Deck, MaterialPatch, TerrainDef, TerrainShape } from '../Terrain';
import type { NavDef } from '../omega/nav';

const PI = Math.PI;

interface Feature {
  shapes?: TerrainShape[];
  patches?: MaterialPatch[];
  decks?: Deck[];
}

/** Lava ring radius / half-width and its gaps (heading in the Terrain convention: (sin a, cos a) * R; 0 = +z). */
export const RING_R = 21;
const RING_W = 1.3;
/** Gap centres and half-widths (rad): spawn side (south), the two side gates, the north gate + rally spot. */
const GATE_SIDE = Math.atan2(34, -8);
const RING_GAPS: [number, number][] = [
  [0, 0.45],
  [GATE_SIDE, 0.36],
  [-GATE_SIDE, 0.36],
  [PI, 0.5],
];

/** Angle into [0, 2π). */
function norm(a: number): number {
  const t = a % (2 * PI);
  return t < 0 ? t + 2 * PI : t;
}

/** The ring's arcs between the gaps, as short capsules (chords of at most ~0.3 rad). */
function ringPatches(): MaterialPatch[] {
  const gaps = RING_GAPS.map(([c, h]) => ({ a: norm(c - h), b: norm(c + h) })).sort((p, q) => p.a - q.a);
  const out: MaterialPatch[] = [];
  for (let i = 0; i < gaps.length; i++) {
    const from = gaps[i].b;
    let to = gaps[(i + 1) % gaps.length].a;
    if (to <= from) to += 2 * PI;
    const n = Math.max(1, Math.ceil((to - from) / 0.3));
    for (let k = 0; k < n; k++) {
      const a0 = from + ((to - from) * k) / n;
      const a1 = from + ((to - from) * (k + 1)) / n;
      out.push({ material: 'lava', x: Math.sin(a0) * RING_R, z: Math.cos(a0) * RING_R, x2: Math.sin(a1) * RING_R, z2: Math.cos(a1) * RING_R, r: RING_W });
    }
  }
  return out;
}

/** Deck geometry (DECKS): the slab and its two ramps per side. */
export const DECK_X = 13;
const DECK_HW = 2.5;
const DECK_Z = -2;
const DECK_HD = 4;
export const DECK_TOP = 1.2;
const RAMP_HD = 1.75;
const RAMP_TOE = 0.15;

/** Deck ids (DECKS): per side (west then east) the slab, its north ramp (toe at the -z end) and its south ramp. */
export const DECK_IDS = { west: { slab: 900, rampN: 901, rampS: 902 }, east: { slab: 903, rampN: 904, rampS: 905 } } as const;

function deckSet(): Deck[] {
  const out: Deck[] = [];
  let id = DECK_IDS.west.slab;
  for (const sx of [-1, 1]) {
    const x = sx * DECK_X;
    out.push({ id: id++, x, z: DECK_Z, hw: DECK_HW, hd: DECK_HD, rot: 0, top: DECK_TOP, thickness: DECK_TOP, material: 'steel' });
    // north ramp rises toward +z (onto the slab), the south one toward -z
    const ramp = { hw: DECK_HW, hd: RAMP_HD, top: RAMP_TOE, rise: DECK_TOP - RAMP_TOE, thickness: DECK_TOP + 0.2, material: 'steel' as const };
    out.push({ id: id++, x, z: DECK_Z - DECK_HD - RAMP_HD, rot: 0, ...ramp });
    out.push({ id: id++, x, z: DECK_Z + DECK_HD + RAMP_HD, rot: PI, ...ramp });
  }
  return out;
}

/** BROKEN's launch ramps: toe at z = -15, rising toward +z (south), lip at z = -10, landing on the rink. */
export const BROKEN_RAMPS: readonly { x: number; z: number }[] = [
  { x: -3.5, z: -15 },
  { x: 3.5, z: -15 },
];

export const FEATURES = {
  RINK: { patches: [{ material: 'ice', x: 0, z: -2, r: 8.5 }] },
  RING: { patches: ringPatches() },
  BROKEN: {
    shapes: [
      { kind: 'dome', x: -8, z: 12, r: 3.5, h: -1.2, rim: 0.5 },
      { kind: 'dome', x: 8, z: 12, r: 3.5, h: -1.2, rim: 0.5 },
      ...BROKEN_RAMPS.map((r): TerrainShape => ({ kind: 'ramp', x: r.x, z: r.z, rot: 0, len: 5, w: 3, h: 1.1, fall: 1.1 })),
    ],
  },
  HALVES: {
    patches: [
      // cold east: ice sheets (listed first: lava wins where patches overlap)
      { material: 'ice', x: 11, z: -13, r: 2.2 },
      { material: 'ice', x: 14, z: 10, r: 2.2 },
      { material: 'ice', x: 21, z: 14, r: 2.4 },
      // hot west: lava vents
      { material: 'lava', x: -18, z: -18.5, r: 1.5 }, // clear of the west deck's north ramp approach (bots route there)
      { material: 'lava', x: -7, z: 7.5, r: 1.2 },
      { material: 'lava', x: -21, z: 14, r: 1.2 },
    ],
  },
  DECKS: { decks: deckSet() },
} satisfies Record<string, Feature>;

export type FeatureKey = keyof typeof FEATURES;

/** Features of each wave (index 0 = wave 1). */
export const WAVE_FEATURES: readonly (readonly FeatureKey[])[] = [
  ['RINK'],
  ['RINK', 'RING'],
  ['RINK', 'RING', 'BROKEN'],
  ['RINK', 'HALVES'],
  ['RINK', 'HALVES'],
  ['RINK', 'HALVES', 'DECKS'],
  ['RINK', 'RING', 'BROKEN', 'HALVES', 'DECKS'],
];

/** First wave (1-based) whose venue shows the rally stage behind the north wall. */
export const STAGE_FROM_WAVE = 5;

/** Wave (1-based) floors with the hot / cold split (scorch decal on the west half). */
export function splitWave(wave: number): boolean {
  return (WAVE_FEATURES[wave - 1] ?? []).includes('HALVES');
}

/** Wave (1-based) floors with the gold decks (bots route up their ramps: PROTOCOL_NAV). */
export function deckWave(wave: number): boolean {
  return (WAVE_FEATURES[wave - 1] ?? []).includes('DECKS');
}

/**
 * Bot routing for the deck waves (world/omega/nav.ts NavGraph, like OMEGA_NAV): regions = the ground (-1) and each
 * slab; each ramp a transit region. Ramp-bottom nodes sit 1.5 m off the toe on the ramp's axis, ramp-top nodes just
 * onto the slab; slabs drop off their long sides (one-way edges), so a bot up top never has to queue for a ramp to get
 * back down. Set on ctx.enemies.nav for deckWave() waves (Game.protocolNav): bosses on a neutral move route up after a
 * plow parked on a deck instead of grinding against its side (EnemyManager.step).
 */
function deckNav(): NavDef {
  const nodes: NavDef['nodes'] = {};
  const ramps: NavDef['ramps'] = [];
  const edges: NavDef['edges'] = [];
  const regionOfDeck: NavDef['regionOfDeck'] = {};
  const toeN = DECK_Z - DECK_HD - 2 * RAMP_HD;
  const toeS = DECK_Z + DECK_HD + 2 * RAMP_HD;
  for (const [side, sx] of [['west', -1], ['east', 1]] as const) {
    const ids = DECK_IDS[side];
    const x = sx * DECK_X;
    const k = side[0];
    regionOfDeck[ids.slab] = ids.slab;
    nodes[`${k}NBot`] = { x, z: toeN - 1.5, region: -1 };
    nodes[`${k}NTop`] = { x, z: DECK_Z - DECK_HD + 1, region: ids.slab };
    nodes[`${k}SBot`] = { x, z: toeS + 1.5, region: -1 };
    nodes[`${k}STop`] = { x, z: DECK_Z + DECK_HD - 1, region: ids.slab };
    ramps.push({ deck: ids.rampN, bottom: `${k}NBot`, top: `${k}NTop` }, { deck: ids.rampS, bottom: `${k}SBot`, top: `${k}STop` });
    // drops off both long sides
    for (const [d, dx] of [['In', -sx], ['Out', sx]] as const) {
      nodes[`${k}Drop${d}`] = { x: x + dx * (DECK_HW - 0.8), z: DECK_Z, region: ids.slab };
      nodes[`${k}Land${d}`] = { x: x + dx * (DECK_HW + 2.5), z: DECK_Z, region: -1 };
      edges.push([`${k}Drop${d}`, `${k}Land${d}`]);
    }
  }
  return { regionOfDeck, nodes, ramps, edges };
}
export const PROTOCOL_NAV: NavDef = deckNav();

const cache = new Map<number, TerrainDef>();

/** The floor of wave `wave` (1-based; clamped). Same object per wave (SnowField / Minimap key on the arrays). */
export function protocolTerrain(wave: number): TerrainDef {
  const w = Math.max(1, Math.min(WAVE_FEATURES.length, Math.round(wave) || 1));
  let def = cache.get(w);
  if (!def) {
    const feats: Feature[] = WAVE_FEATURES[w - 1].map((k) => FEATURES[k]);
    const patches = feats.flatMap((f) => f.patches ?? []);
    def = {
      shapes: feats.flatMap((f) => f.shapes ?? []),
      // ice first, lava last: Terrain.materialAt lets the later patch win where two overlap
      patches: [...patches.filter((p) => p.material !== 'lava'), ...patches.filter((p) => p.material === 'lava')],
      decks: feats.flatMap((f) => f.decks ?? []),
    };
    cache.set(w, def);
  }
  return def;
}
