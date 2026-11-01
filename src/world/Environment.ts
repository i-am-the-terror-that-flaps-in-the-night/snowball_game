import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameContext, Obstacle, WorldAPI, ZoneDef } from '../core/types';
import { Props } from './Props';
import { StaticBatch } from '../render/mergeStatic';
import { makeShadowProxy } from '../render/shadowProxy';
import type { ShadowProxy } from '../render/shadowProxy';
import { ARENA, ENEMY_GATES, GATE_WIDTH } from '../core/types';
import { getBackdropTex, getBuntingTex, getCarpetTex, getSignAtlas, getUsFlagTex, RALLY_SIGNS, signPlane } from './rallyTextures';
import type { BiomeKey } from '../config/zones';
import { GLINTS, Weather, weatherLayers } from './biomes/Weather';
import { GroundDecals, getLavaMaterial, lavaTime, scorchMaterial } from './biomes/GroundDecals';
import { OmegaWorks } from './omega/OmegaWorks';
import { OmegaSet } from './omega/OmegaSet';

type Theme = ZoneDef['theme'];

interface Item {
  x: number;
  y: number;
  z: number;
  ry: number;
  sx: number;
  sy: number;
  sz: number;
  rx?: number;
  rz?: number;
  color?: number;
}

/** Per-arena look: wall blocks, metal trim, banner/crowd accents, gate lights, stands, floodlights. */
interface Style {
  block: number;
  blockAlt: number;
  trim: number;
  accents: number[];
  gate: number;
  stand: number;
  standAlt: number;
  tire: number;
  lamp: number;
  /** Spot light intensity (candela) of the two floodlight spots. */
  spot: number;
  glow: number;
  rock: number;
  mountain: number;
}

const STYLES: Record<Theme | BiomeKey, Style> = {
  // Frostbite Yard — snowy scrapyard
  meadow: {
    block: 0xa9c8e6, blockAlt: 0x8db3d8, trim: 0x59636f, accents: [0xffc21a, 0x2f7de1, 0xe8423a], gate: 0xffa21a,
    stand: 0x707b87, standAlt: 0x56606c, tire: 0x222429, lamp: 0xfff2d6, spot: 700, glow: 0.45, rock: 0x8a8f99, mountain: 0x7d93b8,
  },
  // Pine Junkyard — rusty, warm
  pines: {
    block: 0xd8c8b2, blockAlt: 0xc2ae94, trim: 0x7a4a2c, accents: [0xff7a2e, 0x2e9b5f, 0xffd23a], gate: 0xff6a1e,
    stand: 0x6b4e38, standAlt: 0x523b2b, tire: 0x25211e, lamp: 0xffdcaa, spot: 900, glow: 0.5, rock: 0x6e6a66, mountain: 0x4f6378,
  },
  // Frozen Foundry — ice-locked ironworks
  lake: {
    block: 0x8fd3f5, blockAlt: 0x6cbde8, trim: 0x3b4a58, accents: [0x6ff3ff, 0xff8a3d, 0xffffff], gate: 0x5fe8ff,
    stand: 0x52616f, standAlt: 0x3c4854, tire: 0x1f2328, lamp: 0xe8f7ff, spot: 700, glow: 0.45, rock: 0x7f93a3, mountain: 0x87a5bf,
  },
  // Blizzard Bowl — whiteout stadium
  blizzard: {
    block: 0xbccada, blockAlt: 0xa5b6c8, trim: 0x8a94a2, accents: [0xe8263a, 0x6f8cff, 0xffffff], gate: 0xff3a2a,
    stand: 0xbac3cd, standAlt: 0x9ca6b2, tire: 0x2a2d33, lamp: 0xffffff, spot: 1100, glow: 0.7, rock: 0x4a4f58, mountain: 0xb7c1cc,
  },
  // Omega Summit — the factory at the top of the world
  peak: {
    block: 0xab9cdc, blockAlt: 0x9282cc, trim: 0x2b2440, accents: [0xd24dff, 0x6ff3ff, 0xff7ad9], gate: 0xd24dff,
    stand: 0x3c3453, standAlt: 0x2b2541, tire: 0x1c1a22, lamp: 0xf2dcff, spot: 2000, glow: 0.8, rock: 0x4b4058, mountain: 0x3d3150,
  },
  // The Omega Works — neon factory at dusk (its decks and walls are built by world/omega/*; this styles the lights)
  omega: {
    block: 0x8c93a3, blockAlt: 0x5c6373, trim: 0x18e8ff, accents: [0xff2bd6, 0x18e8ff, 0xffd400], gate: 0xff2bd6,
    stand: 0x8c93a3, standAlt: 0x5c6373, tire: 0x2a2c33, lamp: 0xfff0dc, spot: 1200, glow: 0.7, rock: 0x8a84a0, mountain: 0x9c8cc4,
  },
  // Golden Tower Plaza — THE DONALD's rally: white + gold, red / white / blue, warm stage lights
  rally: {
    block: 0xf6f1e4, blockAlt: 0xe9dfc8, trim: 0xc9a227, accents: [0xc8102e, 0x1f3b8c, 0xffffff, 0xf2c033], gate: 0xffc233,
    stand: 0xf3efe6, standAlt: 0xc8102e, tire: 0x222429, lamp: 0xffd9a0, spot: 2600, glow: 0.85, rock: 0x8a7a66, mountain: 0x9c8d80,
  },
  // THE SNOWDOME — colossal free-for-all stadium
  brawl: {
    block: 0x3a4a78, blockAlt: 0x2f3d68, trim: 0x1d2236, accents: [0xff3d7f, 0x22d3ff, 0xffd23a, 0x7cff5a], gate: 0xff3d7f,
    stand: 0x39405a, standAlt: 0x2c3249, tire: 0x1c1d22, lamp: 0xfff3e0, spot: 14000, glow: 0.85, rock: 0x6c7280, mountain: 0x5b5f8a,
  },
  snowdome: {
    block: 0x3a4a78, blockAlt: 0x2f3d68, trim: 0x1d2236, accents: [0xff3d7f, 0x22d3ff, 0xffd23a, 0x7cff5a], gate: 0xff3d7f,
    stand: 0x39405a, standAlt: 0x2c3249, tire: 0x1c1d22, lamp: 0xfff3e0, spot: 14000, glow: 0.85, rock: 0x6c7280, mountain: 0x5b5f8a,
  },
  // Coldboot Glacier — frozen relay station: ice-blue blocks, cyan / violet aurora accents
  glacier: {
    block: 0xd2ebfa, blockAlt: 0xb0d8f2, trim: 0x34506c, accents: [0x5ff0ff, 0x9a7bff, 0x3df5b0, 0xffffff], gate: 0x5fe8ff,
    stand: 0x5a6e82, standAlt: 0x46596c, tire: 0x1f2328, lamp: 0xe0f4ff, spot: 900, glow: 0.55, rock: 0x6f8aa3, mountain: 0x9ab8d6,
  },
  // Inferno Quarry — red-orange volcanic rock, ember orange
  quarry: {
    block: 0x9a4a30, blockAlt: 0x7a3824, trim: 0x3a1a10, accents: [0xff6a1a, 0xffb02a, 0xff3a1a], gate: 0xff5a14,
    stand: 0x8a4430, standAlt: 0x6c3424, tire: 0x2a1812, lamp: 0xffa060, spot: 1400, glow: 0.7, rock: 0x7a3420, mountain: 0x8a3a24,
  },
  // Rust Basin — red dust, sandstone, mission white / blue
  mars: {
    block: 0xd09468, blockAlt: 0xb5774e, trim: 0x5a3a2a, accents: [0xff8a3d, 0xf0e8d8, 0x3a7fae], gate: 0xffa040,
    stand: 0x7a5a48, standAlt: 0x644838, tire: 0x2a2220, lamp: 0xfff0dc, spot: 700, glow: 0.45, rock: 0x9a4a2a, mountain: 0xb8683e,
  },
  // The Thermal Divide — hot west (red), cold east (blue); walls are split by side in buildWalls
  divide: {
    block: 0xb8a8b8, blockAlt: 0xa898a8, trim: 0x2e2834, accents: [0xff5a2a, 0x5fd8ff, 0xffffff], gate: 0xd070ff,
    stand: 0x5a4e60, standAlt: 0x463c4e, tire: 0x1f1d22, lamp: 0xfff0f0, spot: 1700, glow: 0.6, rock: 0x4a3a40, mountain: 0x7a6a88,
  },
  // Golden Tower Plaza (biome) = the rally look
  plaza: {
    block: 0xf6f1e4, blockAlt: 0xe9dfc8, trim: 0xc9a227, accents: [0xc8102e, 0x1f3b8c, 0xffffff, 0xf2c033], gate: 0xffc233,
    stand: 0xf3efe6, standAlt: 0xc8102e, tire: 0x222429, lamp: 0xffd9a0, spot: 2600, glow: 0.85, rock: 0x8a7a66, mountain: 0x6f9062,
  },
};

/** Snowdome cover reskin per Brawl biome venue: pillar colour / roughness / glow, crystal, fountain stone + water. */
interface BrawlSkin {
  pillar: number;
  rough: number;
  glow: number;
  crystal: number;
  stone: number;
  water: number;
  /** Tint of the giant snowman statues (ash-man in the quarry, dust-man on Mars, a gold one at the rally). */
  statue: number;
}
const ICE_SKIN: BrawlSkin = { pillar: 0xa8e4ff, rough: 0.15, glow: 0x15405a, crystal: 0x6ff3ff, stone: 0x8a93a6, water: 0xbfeaff, statue: 0xffffff };
const BRAWL_SKIN: Partial<Record<BiomeKey, BrawlSkin>> = {
  snowdome: ICE_SKIN,
  glacier: ICE_SKIN,
  quarry: { pillar: 0x7a3826, rough: 0.8, glow: 0x3a0c02, crystal: 0xff6a1a, stone: 0x8a4430, water: 0xff7a2a, statue: 0xb08070 },
  mars: { pillar: 0xb8683e, rough: 0.9, glow: 0x000000, crystal: 0x7fd8ff, stone: 0xa86a4a, water: 0xd8b090, statue: 0xe0a07c },
  divide: { pillar: 0xffffff, rough: 0.3, glow: 0x101830, crystal: 0xd070ff, stone: 0x6a5a68, water: 0xbfeaff, statue: 0xffffff },
  plaza: { pillar: 0xe8b423, rough: 0.35, glow: 0x4a3000, crystal: 0xfff0b0, stone: 0xf3efe6, water: 0x8fd0ff, statue: 0xf2c94a },
};

/** The Thermal Divide's two wall palettes (x < 0 hot basalt, x > 0 cold ice). */
const DIVIDE_HOT = [0x8a3826, 0x6c2a1e];
const DIVIDE_COLD = [0xc6e8f8, 0xa2d2ee];

/** Per-biome sky extras and light tweaks (Environment.setZone). */
interface BiomeSky {
  /** Hemisphere ground (bounce) colour. */
  bounce?: number;
  aurora?: number;
  stars?: number;
  smoke?: number;
  /** Pale sun disc in the sky (visual only): direction (toward the camera's usual view) and angular radius. */
  sun?: { dir: [number, number, number]; size: number; color: number };
  /** Split sky (The Thermal Divide): +x side gradient. */
  split?: { top: number; bottom: number; horizon: number };
  /** Floodlight spot colours (west, east) and whether they light their own half. */
  spots?: [number, number];
  splitSpots?: boolean;
}
const BIOME_SKY: Partial<Record<BiomeKey, BiomeSky>> = {
  glacier: { bounce: 0x9fd0ff, aurora: 1, stars: 0.8, spots: [0xbfe8ff, 0xbfe8ff] },
  quarry: { bounce: 0xff6a30, smoke: 0.45, spots: [0xff8a40, 0xffa860] },
  mars: { bounce: 0xd07850, sun: { dir: [-0.35, 0.3, -1], size: 0.024, color: 0xfff6ea } },
  divide: {
    bounce: 0xc8a0c0,
    split: { top: 0x0e2c5c, bottom: 0x9ad8ff, horizon: 0xcfe8f6 },
    spots: [0xff6a2a, 0x6fd8ff],
    splitSpots: true,
  },
  plaza: { bounce: 0xffe8c0, sun: { dir: [0.45, 0.55, -1], size: 0.05, color: 0xfff6d8 } },
};

/** Confetti palette for Snowdome flags / crowd. */
const CONFETTI = [0xff3d7f, 0x22d3ff, 0xffd23a, 0x7cff5a, 0xb45cff, 0xff8c00, 0xffffff];

const FOLIAGE = [0x1f5a3c, 0x245f3a, 0x2d6b45, 0x1a4d35];

/* ---------------------------------------------------------------- arena layout */

/** Gap between the ARENA edge and the inner face of the wall blocks (trim / banners live here). */
const WALL_IN = 0.12;
const WALL_T = 1.6;
/** Outer extent of the wall measured from the arena edge. */
const WALL_C = WALL_IN + WALL_T;
const WALL_H = 2.5;
/** The south wall is a bit lower: the follow camera lives behind it. */
const SOUTH_H = 1.9;
const GATE_HALF = GATE_WIDTH / 2;
const PILLAR_W = 1.2;
const STAND_N0 = WALL_C + 1.9;
const ROWS = 6;
const ROW_D = 1.25;
const ROW_RISE = 0.62;
const TOWER_OFF = 5.6;
const TUNNEL_LEN = 10.5;
/* Snowdome (Brawl) stadium */
const DOME_TOWER_OFF = 14;
const DOME_TOWER_K = 2.3;
const DOME_TOWER_H = 16.5 * DOME_TOWER_K;
const DOME_N0 = WALL_C + 3.5;
const DOME_ROWS = 12;
const DOME_ROW_D = 1.8;
const DOME_RISE = 1.15;
const DOME_CROWD_CAP = 3000;
const SPONSORS: [string, string, string][] = [
  ['FROSTCOLA', '#d7263d', '#ffffff'], ['PLOWTECH', '#1b98e0', '#ffffff'], ['BRRR ENERGY', '#111111', '#7cff5a'],
  ['SLUSH BANK', '#ffd23a', '#1a1a2e'], ['YETI TIRES', '#2b2d42', '#ff8c00'], ['ICEBOX+', '#22d3ff', '#0b1230'],
  ['CHILL.GG', '#b45cff', '#ffffff'], ['SNOWDOME', '#ff3d7f', '#ffffff'],
];
/** Omega Summit's core tower (north-west, clear of the jumbotron sightline). */
const CORE_X = -34;
const CORE_Z = -92;

/** Golden Tower Plaza: the rally stage spans |x| < STAGE_HALF behind the north wall (over the boss gate's tunnel),
 *  deck at STAGE_Y; the gold tower looms far to the north-east. */
const STAGE_HALF = 13;
const STAGE_Y = 4.75;
const STAGE_Z0 = -32.3;
const STAGE_Z1 = -41.4;
const GOLD_TOWER_X = 38;
const GOLD_TOWER_Z = -150;

type SideKey = 'n' | 's' | 'w' | 'e';
interface Side {
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
let brawlMode = false;
const BRAWL_WALL_H = 3.0;

// s0/s1/h are getters: ARENA is mutable (campaign ±30 / Brawl ±90).
const SIDES: Side[] = [
  { key: 'n', yaw: 0, map: (s, n) => [s, ARENA.minZ - n], get s0() { return ARENA.minX - WALL_C; }, get s1() { return ARENA.maxX + WALL_C; }, get h() { return brawlMode ? BRAWL_WALL_H : WALL_H; } },
  { key: 's', yaw: Math.PI, map: (s, n) => [s, ARENA.maxZ + n], get s0() { return ARENA.minX - WALL_C; }, get s1() { return ARENA.maxX + WALL_C; }, get h() { return brawlMode ? BRAWL_WALL_H : SOUTH_H; } },
  { key: 'w', yaw: Math.PI / 2, map: (s, n) => [ARENA.minX - n, s], get s0() { return ARENA.minZ - WALL_IN; }, get s1() { return ARENA.maxZ + WALL_IN; }, get h() { return brawlMode ? BRAWL_WALL_H : WALL_H; } },
  { key: 'e', yaw: -Math.PI / 2, map: (s, n) => [ARENA.maxX + n, s], get s0() { return ARENA.minZ - WALL_IN; }, get s1() { return ARENA.maxZ + WALL_IN; }, get h() { return brawlMode ? BRAWL_WALL_H : WALL_H; } },
];

/** Which wall each gate sits in, and its coordinate along that wall (campaign arena only). */
const GATE_SIDES = ENEMY_GATES.map((g) => {
  const key: SideKey = g.z < -30 ? 'n' : g.z > 30 ? 's' : g.x < -30 ? 'w' : 'e';
  return { key, s: key === 'n' || key === 's' ? g.x : g.z };
});

function gapsFor(key: SideKey, half: number): [number, number][] {
  if (brawlMode) return [];
  return GATE_SIDES.filter((g) => g.key === key).map((g) => [g.s - half, g.s + half] as [number, number]);
}

function subtract(a: number, b: number, gaps: [number, number][]): [number, number][] {
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

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Adds a constant vertex-color attribute (for merged multi-colored instanced models). */
function colored(geo: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
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

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  return g;
}

/* ---------------------------------------------------------------- canvas textures */

let glowTex: THREE.Texture | null = null;
let hazardTex: THREE.Texture | null = null;
let doorTex: THREE.Texture | null = null;
let bannerTex: THREE.Texture | null = null;
let chevronTex: THREE.Texture | null = null;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTex(c: HTMLCanvasElement, repeat = false): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

function radial(size: number, stops: [number, string][]): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  const h = size / 2;
  const grd = g.createRadialGradient(h, h, 0, h, h, h);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return c;
}

function getGlowTex(): THREE.Texture {
  return (glowTex ??= toTex(radial(128, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']])));
}

function drawHazard(g: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, period: number): void {
  g.save();
  g.beginPath();
  g.rect(x0, y0, w, h);
  g.clip();
  g.fillStyle = '#f2c230';
  g.fillRect(x0, y0, w, h);
  g.fillStyle = '#1b1b1f';
  for (let x = x0 - h - period; x < x0 + w + period; x += period) {
    g.beginPath();
    g.moveTo(x, y0 + h);
    g.lineTo(x + period / 2, y0 + h);
    g.lineTo(x + period / 2 + h, y0);
    g.lineTo(x + h, y0);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function getHazardTex(): THREE.Texture {
  if (hazardTex) return hazardTex;
  const [c, g] = canvas(128, 32);
  drawHazard(g, 0, 0, 128, 32, 32);
  hazardTex = toTex(c, true);
  hazardTex.repeat.set(5, 1);
  return hazardTex;
}

function getDoorTex(): THREE.Texture {
  if (doorTex) return doorTex;
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#ccd1d8';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 220; y += 27) {
    g.fillStyle = '#8b929c';
    g.fillRect(0, y, 256, 4);
    g.fillStyle = '#eceff3';
    g.fillRect(0, y + 4, 256, 2);
  }
  g.fillStyle = '#20252e';
  for (let i = 0; i < 4; i++) g.fillRect(18 + i * 60, 38, 44, 13);
  drawHazard(g, 0, 222, 256, 34, 34);
  doorTex = toTex(c);
  return doorTex;
}

function getBannerTex(): THREE.Texture {
  if (bannerTex) return bannerTex;
  const [c, g] = canvas(128, 192);
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(128, 0);
  g.lineTo(128, 192);
  g.lineTo(64, 150);
  g.lineTo(0, 192);
  g.closePath();
  g.fillStyle = '#ffffff';
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = '#a6abb3';
  g.stroke();
  g.fillStyle = '#3a3f48';
  g.fillRect(0, 0, 128, 16);
  // snowflake emblem
  g.save();
  g.translate(64, 80);
  g.strokeStyle = '#3a3f48';
  g.lineCap = 'round';
  g.lineWidth = 9;
  for (let k = 0; k < 6; k++) {
    g.rotate(Math.PI / 3);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -34);
    g.moveTo(0, -20);
    g.lineTo(-10, -30);
    g.moveTo(0, -20);
    g.lineTo(10, -30);
    g.stroke();
  }
  g.restore();
  bannerTex = toTex(c);
  return bannerTex;
}

function getChevronTex(): THREE.Texture {
  if (chevronTex) return chevronTex;
  const [c, g] = canvas(64, 64);
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = '#ffffff';
  g.lineWidth = 10;
  g.lineJoin = 'miter';
  g.beginPath();
  g.moveTo(8, 16);
  g.lineTo(32, 42);
  g.lineTo(56, 16);
  g.stroke();
  chevronTex = toTex(c, true);
  chevronTex.repeat.set(1, 3.5);
  return chevronTex;
}

const hexCss = (hex: number) => '#' + hex.toString(16).padStart(6, '0');

/** A w x h flag plane with a baked ripple; hoist edge at x = 0, hanging below y = 0.4 + h / 2 ... centred on y = 0.4. */
function wavyFlag(w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, 10, 1).translate(w / 2, 0.4, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    p.setZ(i, Math.sin(x * 4.2) * 0.09 * (x / w));
    p.setY(i, p.getY(i) - (x / w) * 0.08);
  }
  g.computeVertexNormals();
  return g;
}

/** A tapering 4-leg lattice mast `h` tall, `w` wide at the base (merged, origin at the foot). */
function latticeMast(h: number, w: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const half = (y: number) => (w / 2) * (1 - (0.65 * y) / h);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const b = new THREE.Vector3(sx * half(0), 0, sz * half(0));
    const t = new THREE.Vector3(sx * half(h), h, sz * half(h));
    const len = b.distanceTo(t);
    const g = new THREE.CylinderGeometry(0.09, 0.12, len, 4).translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), t.clone().sub(b).normalize()));
    parts.push(g.translate(b.x, b.y, b.z));
  }
  for (let y = 1.5; y < h; y += 2.4) {
    const k = half(y) * 2;
    parts.push(new THREE.BoxGeometry(k, 0.08, 0.08).translate(0, y, half(y)), new THREE.BoxGeometry(k, 0.08, 0.08).translate(0, y, -half(y)));
    parts.push(new THREE.BoxGeometry(0.08, 0.08, k).translate(half(y), y, 0), new THREE.BoxGeometry(0.08, 0.08, k).translate(-half(y), y, 0));
  }
  parts.push(new THREE.CylinderGeometry(0.06, 0.06, 4, 4).translate(0, h + 2, 0));
  return merge(parts);
}

/* ---------------------------------------------------------------- environment */

interface GateState {
  group: THREE.Group;
  /** Door instance matrix when fully closed; the roll-up scale.y is applied on top. */
  doorBase: THREE.Matrix4;
  doorScale: number;
  lightMat: THREE.MeshStandardMaterial;
  glowMat: THREE.SpriteMaterial;
  floorMat: THREE.MeshBasicMaterial;
  mouth: THREE.Vector3;
  open: number;
  openT: number;
  flashT: number;
  lastBurst: number;
  phase: number;
}

/** Materials shared by the three gates (created by the first one). */
interface GateMats {
  trim?: THREE.MeshStandardMaterial;
  hazard?: THREE.MeshStandardMaterial;
  door?: THREE.MeshStandardMaterial;
  tunnel?: THREE.MeshStandardMaterial;
  back?: THREE.MeshBasicMaterial;
}

interface Puff {
  x: number;
  y: number;
  z: number;
  r: number;
  rise?: number;
  drift?: number;
}

interface Pulse {
  mat: THREE.Material;
  base: number;
  speed: number;
  phase: number;
}


export class Environment implements WorldAPI {
  private ctx: GameContext;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private spots: THREE.SpotLight[] = [];
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private fog: THREE.Fog;
  private decor: THREE.Group | null = null;
  /** The Omega Works' decks / pistons / conveyors and its set dressing (only while that arena is loaded). */
  private omega: { works: OmegaWorks; set: OmegaSet } | null = null;
  private zone: ZoneDef;
  private style: Style = STYLES.meadow;
  /** Biome of the current zone (null = the classic theme look). */
  private biome: BiomeKey | null = null;
  private weather: Weather;
  /** Glacier: the hemisphere light shimmers between its base colour and aurora green / violet. */
  private auroraBase: THREE.Color | null = null;
  private auroraA = new THREE.Color(0x6dffc0);
  private auroraB = new THREE.Color(0xb48cff);
  private decals: GroundDecals | null = null;
  private time = 0;
  private rnd: () => number = Math.random;
  private obstacleList: Obstacle[] = [];
  private props: Props;
  /** Sun offset from its (player-following) target, and the light-space basis for texel snapping. */
  private sunOffset = new THREE.Vector3(45, 80, 55);
  private sunR = new THREE.Vector3();
  private sunU = new THREE.Vector3();
  private sunD = new THREE.Vector3();
  private shadowTexel = 80 / 2048;

  // ambient animation
  private pulses: Pulse[] = [];
  private gates: GateState[] = [];
  private doors: THREE.InstancedMesh | null = null;
  /** Static parts baked while a zone is built (flushed by finishDecor). */
  private batch: StaticBatch | null = null;
  private wallTires: { items: Item[]; mat: THREE.Material } | null = null;
  private crowd: { items: Item[]; phases: Float32Array[]; bodyMat: THREE.Material; eyeMat: THREE.Material } | null = null;
  /** Shadow-only copies of the baked casters (never in the scene; read once by finishDecor). */
  private casters = new THREE.Group();
  private tmpM = new THREE.Matrix4();
  private zoneTex: THREE.Texture[] = [];
  private ticker: THREE.Texture | null = null;
  private spinners: { obj: THREE.Object3D; speed: number }[] = [];
  /** Rising smoke / steam columns: `rise` m tall (default 16), drifting `drift` m downwind (default 9). */
  private puffs: { mesh: THREE.InstancedMesh; stacks: Puff[]; per: number } | null = null;
  private bobTime = { value: 0 };
  /** Crowd bob height (the rally crowd cheers harder). */
  private bobAmp = { value: 0.2 };
  /** Golden Tower Plaza's red carpet, re-draped over the snow every frame. */
  /** `nv` = vertex count. */
  private carpet: { mesh: THREE.Mesh; pos: THREE.BufferAttribute; nv: number } | null = null;
  private signMat: THREE.MeshStandardMaterial | null = null;
  private dummy = new THREE.Object3D();
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();


  /** Golden Tower Plaza dressing (the rally venue, or the Plaza biome anywhere: Survival, Duel, Brawl). */
  private get isRally(): boolean {
    return this.zone.theme === 'rally' || this.biome === 'plaza';
  }

  get obstacles(): readonly Obstacle[] {
    return this.obstacleList;
  }

  resetProps(on: boolean, coins: boolean): void {
    this.props.reset(this.obstacleList, on, 777 + this.zone.index * 131, this.zone.theme === 'brawl', coins);
  }

  blastProps(x: number, z: number, r: number): number {
    return this.props.blast(x, z, r);
  }

  blastPropRay(x: number, z: number, dx: number, dz: number, range: number): number {
    return this.props.blastRay(x, z, dx, dz, range);
  }

  breakObstacle(o: Obstacle, coins = true): boolean {
    return this.props.breakObstacle(o, coins);
  }

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.props = new Props(ctx);
    this.zone = ctx.zone;
    const scene = ctx.scene;

    this.fog = new THREE.Fog(0xffffff, 60, 170);
    scene.fog = this.fog;
    scene.background = new THREE.Color(0xffffff);

    this.hemi = new THREE.HemisphereLight(0xbcd7ff, 0xe8eef5, 0.9);
    scene.add(this.hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(45, 80, 55);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -40;
    sc.right = 40;
    sc.top = 40;
    sc.bottom = -40;
    sc.near = 20;
    sc.far = 200;
    sc.updateProjectionMatrix();
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    this.sunD.copy(this.sunOffset).normalize();
    this.sunR.crossVectors(new THREE.Vector3(0, 1, 0), this.sunD).normalize();
    this.sunU.crossVectors(this.sunD, this.sunR).normalize();
    this.shadowTexel = (sc.right - sc.left) / sun.shadow.mapSize.x;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;

    // Two shadow-free floodlight spots from the north corner towers (fixed light count -> no recompiles).
    for (const sx of [-1, 1]) {
      const c = ARENA.maxX + TOWER_OFF;
      const spot = new THREE.SpotLight(0xffffff, 0, 0, Math.PI / 4.2, 0.65, 2);
      spot.position.set(sx * c, 16.5, ARENA.minZ - TOWER_OFF);
      spot.target.position.set(-sx * 6, 0, 6);
      spot.castShadow = false;
      scene.add(spot);
      scene.add(spot.target);
      this.spots.push(spot);
    }

    this.weather = new Weather(scene);
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color() },
        bottom: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
        topB: { value: new THREE.Color() },
        bottomB: { value: new THREE.Color() },
        horizonB: { value: new THREE.Color() },
        uSplit: { value: 0 },
        uAurora: { value: 0 },
        uStars: { value: 0 },
        uSmoke: { value: 0 },
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color() },
        uSunSize: { value: 0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      // Gradient sky + per-biome extras: split halves (The Thermal Divide), aurora curtains and stars (glacier),
      // drifting smoke bands (quarry) and a small sun disc (Rust Basin, Plaza). Every extra is gated by a uniform.
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom; uniform vec3 horizon;
        uniform vec3 topB; uniform vec3 bottomB; uniform vec3 horizonB;
        uniform float uSplit; uniform float uAurora; uniform float uStars; uniform float uSmoke; uniform float uTime;
        uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunSize;
        varying vec3 vDir;
        float hsh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hsh(i), hsh(i + vec2(1, 0)), u.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), u.x), u.y);
        }
        vec3 grad(vec3 hz, vec3 bt, vec3 tp, float h) {
          vec3 c = mix(hz, bt, smoothstep(-0.02, 0.12, h));
          return mix(c, tp, smoothstep(0.08, 0.75, h));
        }
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 c = grad(horizon, bottom, top, h);
          if (uSplit > 0.0) c = mix(c, grad(horizonB, bottomB, topB, h), smoothstep(-0.22, 0.22, d.x) * uSplit);
          float az = atan(d.x, d.z);
          if (uStars > 0.0 && h > 0.12) {
            vec2 g = floor(vec2(az * 90.0, h * 140.0));
            float s = hsh(g);
            c += vec3(step(0.993, s) * uStars * smoothstep(0.12, 0.45, h) * (0.55 + 0.45 * sin(uTime * 2.0 + s * 60.0)));
          }
          if (uAurora > 0.0) {
            float band = smoothstep(0.1, 0.26, h) * (1.0 - smoothstep(0.42, 0.8, h));
            float wv = sin(az * 3.0 + sin(az * 7.0 + uTime * 0.21) * 0.9 + uTime * 0.07);
            float curtain = pow(0.5 + 0.5 * wv, 3.0);
            float rays = 0.55 + 0.45 * sin(az * 70.0 + uTime * 0.5 + sin(az * 11.0 + uTime * 0.1) * 4.0);
            vec3 ac = mix(vec3(0.1, 1.0, 0.5), vec3(0.55, 0.3, 1.0), smoothstep(0.22, 0.6, h));
            c += ac * band * curtain * rays * uAurora * 0.9;
          }
          if (uSmoke > 0.0) {
            vec2 sp = d.xz * (2.2 / (0.3 + max(h, 0.0))) + vec2(uTime * 0.03, 0.0);
            float n = vn(sp * 2.0) * 0.6 + vn(sp * 5.0 + 3.1) * 0.4;
            float k = smoothstep(0.35, 0.8, n) * smoothstep(-0.02, 0.15, h) * (1.0 - smoothstep(0.5, 0.95, h));
            c = mix(c, vec3(0.05, 0.015, 0.01), k * 0.55 * uSmoke);
            c += vec3(0.5, 0.12, 0.02) * (1.0 - smoothstep(0.0, 0.12, h)) * (1.0 - k) * 0.35 * uSmoke;
          }
          if (uSunSize > 0.0) {
            float a = dot(d, uSunDir);
            c += uSunColor * (smoothstep(cos(uSunSize), cos(uSunSize * 0.8), a) + pow(max(a, 0.0), 90.0) * 0.4);
          }
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    scene.add(this.sky);
  }

  /* ------------------------------------------------------------------ zone */

  setZone(zone: ZoneDef): void {
    this.zone = zone;
    this.ctx.terrain.load(zone.terrain ?? {});
    this.biome = zone.biome?.key ?? null;
    const base = (this.biome && STYLES[this.biome]) || STYLES[zone.theme] || STYLES.meadow;
    // Brawl biome venues keep the dome's huge floodlights
    this.style = zone.theme === 'brawl' ? { ...base, spot: STYLES.brawl.spot, glow: STYLES.brawl.glow } : base;
    const bs = (this.biome && BIOME_SKY[this.biome]) || {};
    const scene = this.ctx.scene;
    this.fog.color.setHex(zone.fogColor);
    this.fog.near = zone.fogNear;
    this.fog.far = zone.fogFar;
    (scene.background as THREE.Color).setHex(zone.fogColor);

    this.skyMat.uniforms.top.value.setHex(zone.skyTop);
    this.skyMat.uniforms.bottom.value.setHex(zone.skyBottom);
    this.skyMat.uniforms.horizon.value.setHex(zone.fogColor);
    const su = this.skyMat.uniforms;
    su.uSplit.value = bs.split ? 1 : 0;
    if (bs.split) {
      su.topB.value.setHex(bs.split.top);
      su.bottomB.value.setHex(bs.split.bottom);
      su.horizonB.value.setHex(bs.split.horizon);
    }
    su.uAurora.value = bs.aurora ?? 0;
    su.uStars.value = bs.stars ?? 0;
    su.uSmoke.value = bs.smoke ?? 0;
    su.uSunSize.value = bs.sun?.size ?? 0;
    if (bs.sun) {
      (su.uSunDir.value as THREE.Vector3).set(...bs.sun.dir).normalize();
      su.uSunColor.value.setHex(bs.sun.color);
    }

    this.hemi.color.setHex(zone.ambientColor);
    this.hemi.groundColor.setHex(zone.snowTint).lerp(new THREE.Color(zone.ambientColor), 0.3);
    if (bs.bounce !== undefined) this.hemi.groundColor.setHex(bs.bounce);
    this.auroraBase = bs.aurora ? new THREE.Color(zone.ambientColor) : null;
    this.hemi.intensity = zone.ambientIntensity;
    this.sun.color.setHex(zone.sunColor);
    this.sun.intensity = zone.sunIntensity;
    const brawl = zone.theme === 'brawl';
    // Brawl trades shadow sharpness for frame rate: half-resolution shadow map.
    const mapSize = brawl ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      const sc = this.sun.shadow.camera;
      this.shadowTexel = (sc.right - sc.left) / mapSize;
    }
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i];
      const sx = i === 0 ? -1 : 1;
      s.color.setHex(bs.spots ? bs.spots[i] : this.style.lamp);
      s.intensity = this.style.spot;
      if (brawl) {
        const c = ARENA.maxX + DOME_TOWER_OFF;
        s.position.set(sx * c, DOME_TOWER_H, ARENA.minZ - DOME_TOWER_OFF);
        s.target.position.set(-sx * 20, 0, 20);
        s.angle = Math.PI / 4.5;
      } else {
        const c = ARENA.maxX + TOWER_OFF;
        s.position.set(sx * c, 16.5, ARENA.minZ - TOWER_OFF);
        s.target.position.set(-sx * 6, 0, 6);
        s.angle = Math.PI / 4.2;
      }
      // The Thermal Divide: each tower floods its own half (hot west, cold east)
      if (bs.splitSpots) s.target.position.set(sx * (brawl ? 40 : 14), 0, brawl ? 10 : 4);
    }

    this.buildDecor(zone);
    this.buildWeather(zone);
    this.ctx.audio?.setAmbience(zone.biome?.ambience ?? (brawl || zone.theme === 'blizzard' ? 'wind' : 'none'));
  }

  openGate(index: number): void {
    const g = this.gates[index];
    if (!g) return;
    const wasClosed = g.open < 0.35;
    g.openT = 2.0;
    g.flashT = 1.3;
    if (wasClosed || this.time - g.lastBurst > 0.8) {
      g.lastBurst = this.time;
      const fx = this.ctx.fx;
      if (fx) {
        fx.burst(this.tmpV.copy(g.mouth), { color: 0xffffff, count: 30, speed: 6, size: 0.35, gravity: 9, life: 0.9 });
        this.tmpV2.copy(g.mouth);
        this.tmpV2.y += 3;
        fx.burst(this.tmpV2, { color: this.style.gate, count: 12, speed: 4, size: 0.16, gravity: 4, life: 0.6 });
      }
    }
  }

  private disposeDecor(): void {
    if (this.omega) {
      this.omega.works.dispose();
      this.omega.set.dispose();
      this.omega = null;
    }
    if (!this.decor) return;
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    this.decor.traverse((o) => {
      const m = o as THREE.Mesh;
      // Sprites share one module-level geometry inside three.js: never dispose it.
      if (m.geometry && !(o as THREE.Sprite).isSprite) geos.add(m.geometry);
      // Shadow proxies share global stand-in materials (render/shadowProxy.ts): only their geometry is ours.
      if ((o as ShadowProxy).isShadowProxy) return;
      if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach((x) => mats.add(x));
        else mats.add(m.material);
      }
      if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    });
    geos.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
    this.zoneTex.forEach((t) => t.dispose());
    this.zoneTex.length = 0;
    this.ctx.scene.remove(this.decor);
    this.decor = null;
    this.pulses.length = 0;
    this.gates.length = 0;
    this.doors = null;
    this.spinners.length = 0;
    this.puffs = null;
    this.ticker = null;
    this.carpet = null;
    this.signMat = null;
    this.decals?.dispose();
    this.decals = null;
  }

  /* ------------------------------------------------------------------ helpers */

  private add<T extends THREE.Object3D>(o: T): T {
    this.decor!.add(o);
    return o;
  }

  /** Placement matrix of an Item (shared by inst() and baked items). */
  private itemMatrix(it: Item): THREE.Matrix4 {
    const d = this.dummy;
    d.position.set(it.x, it.y, it.z);
    // 'YXZ': roll/pitch first, yaw last (so lying tires / pipes keep their tilt under any yaw)
    d.rotation.set(it.rx ?? 0, it.ry, it.rz ?? 0, 'YXZ');
    d.scale.set(it.sx, it.sy, it.sz);
    d.updateMatrix();
    return d.matrix;
  }

  /** Bake a static part (world-space matrix) into the zone batch. Casting parts go into the zone shadow proxy
   *  instead (finishDecor), so the batch only splits on material + receiveShadow. */
  private bake(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, mat: THREE.Material, cast = false, receive = false): void {
    this.batch!.add(geo, matrix, mat, { receiveShadow: receive });
    if (cast) {
      const m = new THREE.Mesh(geo, mat);
      m.matrixAutoUpdate = false;
      m.matrix.copy(matrix);
      m.castShadow = true;
      this.casters.add(m);
    }
  }

  /** Bake one copy of `geo` per item into the zone batch (static, few items, no per-item colour). */
  private bakeItems(geo: THREE.BufferGeometry, mat: THREE.Material, items: Item[], cast = false, receive = false): void {
    for (const it of items) this.bake(geo, this.itemMatrix(it), mat, cast, receive);
    geo.dispose();
  }

  private inst(geo: THREE.BufferGeometry, mat: THREE.Material, items: Item[], cast = false, receive = false): THREE.InstancedMesh | null {
    if (items.length === 0) {
      geo.dispose();
      return null;
    }
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    const col = new THREE.Color();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      im.setMatrixAt(i, this.itemMatrix(it));
      if (it.color !== undefined) im.setColorAt(i, col.setHex(it.color));
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = cast;
    im.receiveShadow = receive;
    im.computeBoundingSphere();
    this.add(im);
    return im;
  }

  private std(color: number, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, ...opts });
  }

  private emissive(color: number, intensity: number, pulse?: { speed: number; phase?: number }): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
    if (pulse) this.pulses.push({ mat: m, base: intensity, speed: pulse.speed, phase: pulse.phase ?? 0 });
    return m;
  }

  private glowSprite(color: number, opacity: number, scale: number, x: number, y: number, z: number, pulse?: number): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({
      map: getGlowTex(), color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(scale);
    s.position.set(x, y, z);
    if (pulse) this.pulses.push({ mat, base: opacity, speed: pulse, phase: this.rnd() * 6 });
    return this.add(s);
  }

  /** Makes a material bob its vertices up and down per instance (crowds), driven by the shared bobTime uniform. */
  private bobify<T extends THREE.Material>(mat: T): T {
    const u = this.bobTime;
    const amp = this.bobAmp;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uBobTime = u;
      shader.uniforms.uBobAmp = amp;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uBobTime;\nuniform float uBobAmp;\nattribute float aPhase;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\ntransformed.y += abs(sin(uBobTime * (3.2 + fract(aPhase) * 2.6) + aPhase)) * uBobAmp;',
        );
    };
    mat.customProgramCacheKey = () => 'crowd-bob';
    return mat;
  }

  /** Tiny blocky bot spectators that bob in their seats. Items face local +Z. Every call of a zone build adds to
   *  one crowd (body + eyes draw), emitted by flushCrowd; the bob phases are drawn here, in build order. */
  private addCrowd(items: Item[]): void {
    if (items.length === 0) return;
    const phase = new Float32Array(items.length);
    for (let i = 0; i < phase.length; i++) phase[i] = this.rnd() * 40;
    if (!this.crowd) {
      const bodyMat = this.bobify(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true }));
      const eyeMat = this.bobify(new THREE.MeshBasicMaterial({ color: this.style.accents[1], toneMapped: false }));
      this.crowd = { items: [], phases: [], bodyMat, eyeMat };
    }
    this.crowd.items.push(...items);
    this.crowd.phases.push(phase);
  }

  private flushCrowd(): void {
    const crowd = this.crowd;
    this.crowd = null;
    if (!crowd) return;
    const { items, bodyMat, eyeMat } = crowd;
    const white = 0xffffff;
    // rally caps / cheering arms: campaign venues only (the Snowdome's 3000-strong crowd stays cheap)
    const rally = this.isRally && !brawlMode;
    const body = merge([
      colored(new THREE.BoxGeometry(0.46, 0.4, 0.36).translate(0, 0.22, 0), white),
      colored(new THREE.BoxGeometry(0.4, 0.32, 0.34).translate(0, 0.6, 0), white),
      colored(new THREE.BoxGeometry(0.34, 0.13, 0.02).translate(0, 0.62, 0.175), 0x1a1f2b),
      ...(rally
        ? []
        : [colored(new THREE.BoxGeometry(0.04, 0.16, 0.04).translate(0, 0.84, 0), 0x50555e), colored(new THREE.BoxGeometry(0.1, 0.1, 0.1).translate(0, 0.95, 0), white)]),
      // rally crowd: both arms up, cheering
      colored(new THREE.BoxGeometry(0.09, 0.32, 0.09).rotateZ(rally ? 2.6 : 0.4).translate(0.31, rally ? 0.86 : 0.56, 0), white),
      colored(new THREE.BoxGeometry(0.09, 0.32, 0.09).rotateZ(rally ? -2.6 : -0.4).translate(-0.31, rally ? 0.86 : 0.56, 0), white),
    ]);
    const eyes = merge([
      new THREE.BoxGeometry(0.08, 0.06, 0.02).translate(0.08, 0.625, 0.19),
      new THREE.BoxGeometry(0.08, 0.06, 0.02).translate(-0.08, 0.625, 0.19),
    ]);
    const phase = new Float32Array(items.length);
    let o = 0;
    for (const p of crowd.phases) {
      phase.set(p, o);
      o += p.length;
    }
    const attr = new THREE.InstancedBufferAttribute(phase, 1);
    body.setAttribute('aPhase', attr);
    eyes.setAttribute('aPhase', attr);
    this.inst(body, bodyMat, items);
    this.inst(eyes, eyeMat, items.map((i) => ({ ...i, color: undefined })));
    if (rally) {
      // red rally caps (crown + brim) on most heads, a few white / navy
      const cap = merge([
        new THREE.CylinderGeometry(0.17, 0.215, 0.15, 10).translate(0, 0.83, -0.01),
        new THREE.BoxGeometry(0.36, 0.035, 0.2).translate(0, 0.77, 0.24),
      ]);
      cap.setAttribute('aPhase', attr);
      const capMat = this.bobify(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.65, flatShading: true }));
      const rnd = this.rnd;
      this.inst(cap, capMat, items.map((i) => {
        const r = rnd();
        return { ...i, color: r < 0.86 ? 0xc8102e : r < 0.95 ? 0xffffff : 0x1f3b8c };
      }));
    }
  }

  private crowdColor(): number {
    const pal = this.style.accents;
    const r = this.rnd();
    if (this.isRally) return r < 0.38 ? 0xc8102e : r < 0.7 ? 0xf4f4f0 : r < 0.92 ? 0x1f3b8c : 0xf2c033;
    if (r < 0.55) return pal[(this.rnd() * pal.length) | 0];
    const greys = [0x9aa4b0, 0x6a7380, 0xd8dde3, 0x3a4250];
    return greys[(this.rnd() * greys.length) | 0];
  }

  /* ------------------------------------------------------------------ build */

  private buildDecor(zone: ZoneDef): void {
    this.disposeDecor();
    const group = new THREE.Group();
    group.name = 'ArenaDecor';
    this.decor = group;
    this.ctx.scene.add(group);
    this.rnd = mulberry32(1234 + zone.index * 101);
    this.batch = new StaticBatch();
    const G = zone.snowDepth;
    const snowMat = this.std(zone.snowTint, { roughness: 0.85 });
    brawlMode = zone.theme === 'brawl';
    this.obstacleList = [];
    this.props.clear();

    if (zone.theme === 'omega') {
      // The Omega Works: its own walls, decks, hatches and skyline (no stands, gates or props).
      const works = new OmegaWorks(this.ctx.terrain);
      const set = new OmegaSet(this.ctx.terrain);
      this.omega = { works, set };
      this.ctx.scene.add(works.group, set.group);
      this.bobAmp.value = 0;
      this.buildMountains(zone);
      this.finishDecor();
      return;
    }

    if (brawlMode) {
      this.buildWalls(G, snowMat);
      this.buildSnowdome(zone, G);
      this.buildObstacles(G, snowMat);
      this.buildMountains(zone);
      this.buildGroundDecals();
      this.finishDecor();
      return;
    }

    const rally = this.isRally;
    this.bobAmp.value = rally ? 0.42 : 0.2;
    this.buildWalls(G, snowMat);
    this.buildGates(G, snowMat);
    this.buildStands(G, rally ? STAGE_HALF + 0.6 : 0);
    this.buildTowers();
    if (!rally) this.buildJumbotron(zone);
    this.buildSouthDressing(G);
    this.buildMountains(zone);
    this.buildDrifts(G, snowMat);

    const theme = zone.theme;
    const biome = this.biome;
    if (biome === 'glacier') this.buildGlacier(G);
    else if (biome === 'quarry') this.buildQuarry(G);
    else if (biome === 'mars') this.buildMars(G);
    else if (biome === 'divide') this.buildDivide(G);
    else if (biome === 'plaza') {
      this.buildRally(G);
      this.buildSummer();
    } else if (theme === 'meadow') this.buildYard(G);
    else if (theme === 'pines') this.buildJunkyard(G);
    else if (theme === 'lake') this.buildFoundry(G);
    else if (theme === 'blizzard') this.buildBowl(zone);
    else if (theme === 'rally') this.buildRally(G);
    else this.buildSummit(G, snowMat);
    this.buildGroundDecals();
    this.finishDecor();
  }

  /** Lava ribbons, ice sheets and ramp decks for the zone's ground terrain (none on flat arenas or deck arenas: The
   *  Omega Works draws its own structures). */
  private buildGroundDecals(): void {
    const t = this.ctx.terrain;
    if (t.decks.length || (!t.patches.length && !t.shapes.some((s) => s.kind === 'ramp') && this.biome !== 'divide')) return;
    const snow = this.ctx.snow;
    this.decals = new GroundDecals(t, this.biome, (x, z) => (snow ? snow.getDepth(x, z) : this.zone.snowDepth), ARENA.maxX);
    this.add(this.decals.group);
  }

  /** Emits the batched parts, then one depth-only shadow proxy for every static caster of the zone (the visible
   *  meshes stop casting but keep receiving), so the shadow pass draws the whole static scenery in one call. Gate
   *  doors (roll up) and spinners keep casting themselves. Finally freezes the local matrices of everything that
   *  never moves (only spinners rotate; doors and puffs animate instance matrices). */
  private finishDecor(): void {
    const decor = this.decor!;
    this.flushCrowd();
    this.batch!.flush(decor);
    this.batch = null;
    const keep: THREE.Object3D[] = this.spinners.map((s) => s.obj);
    if (this.doors) keep.push(this.doors);
    for (const p of makeShadowProxy([decor, this.casters], null, { keep })) decor.add(p);
    this.casters.clear();
    const moving = new Set(this.spinners.map((sp) => sp.obj));
    decor.traverse((o) => {
      if (moving.has(o)) return;
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
  }

  /** Scatter points outside the arena + stands. `huge` items (>18 m) stay clear of the menu orbit (r=50, y=24). */
  private scatter(count: number, minR: number, maxR: number, huge = false): { x: number; z: number }[] {
    const out: { x: number; z: number }[] = [];
    const rnd = this.rnd;
    let tries = 0;
    while (out.length < count && tries < count * 40) {
      tries++;
      const x = (rnd() * 2 - 1) * maxR;
      const z = (rnd() * 2 - 1) * maxR;
      const r = Math.hypot(x, z);
      if (r > maxR || r < minR) continue;
      if (Math.abs(x) < 47 && Math.abs(z) < 47) continue;
      if (Math.abs(x) < 16 && z < -38 && z > -64) continue; // jumbotron
      if (huge && r < 66) continue;
      out.push({ x, z });
    }
    return out;
  }

  /* ---------- walls ---------- */

  private buildWalls(G: number, snowMat: THREE.Material): void {
    const st = this.style;
    const rnd = this.rnd;
    const blocks: Item[] = [];
    const caps: Item[] = [];
    const bands: Item[] = [];
    const posts: Item[] = [];
    const lamps: Item[] = [];
    const banners: Item[] = [];
    const tires: Item[] = [];
    const blockCol = new THREE.Color();
    const cA = new THREE.Color(st.block);
    const cB = new THREE.Color(st.blockAlt);

    for (const side of SIDES) {
      const runs = subtract(side.s0, side.s1, gapsFor(side.key, GATE_HALF + PILLAR_W));
      const h = side.h;
      let bi = 0;
      for (const [a, b] of runs) {
        const len = b - a;
        const n = Math.max(1, Math.round(len / 2.9));
        const L = len / n;
        for (let k = 0; k < n; k++, bi++) {
          const sc = a + (k + 0.5) * L;
          const [x, z] = side.map(sc, WALL_IN + WALL_T / 2);
          const bh = h * (0.97 + rnd() * 0.06);
          if (this.biome === 'divide') {
            const pal = x < 0 || (Math.abs(x) < 1 && z < 0) ? DIVIDE_HOT : DIVIDE_COLD;
            cA.setHex(pal[0]);
            cB.setHex(pal[1]);
          }
          blockCol.copy(cA).lerp(cB, rnd());
          blocks.push({ x, y: 0, z, ry: side.yaw + (rnd() - 0.5) * 0.025, sx: L - 0.14, sy: bh, sz: WALL_T * (0.96 + rnd() * 0.05), color: blockCol.getHex() });
          caps.push({ x, y: bh - 0.06, z, ry: side.yaw, sx: (L - 0.14) * 0.5, sy: 0.2 + rnd() * 0.1, sz: WALL_T * 0.52 });
          const [bx, bz] = side.map(sc, WALL_IN - 0.035);
          bands.push({ x: bx, y: h - 0.62, z: bz, ry: side.yaw, sx: L - 0.1, sy: 1, sz: 1 });
          if (side.key !== 's' && bi % 2 === 1 && !this.isRally) {
            const [fx, fz] = side.map(sc, WALL_IN - 0.09);
            banners.push({ x: fx, y: h - 1.22, z: fz, ry: side.yaw, sx: 1, sy: 1, sz: 1, color: st.accents[(bi >> 1) % st.accents.length] });
          }
          if (rnd() < 0.3) {
            const [tx, tz] = side.map(sc + (rnd() - 0.5) * 1.2, WALL_C + 0.8);
            const nT = 2 + ((rnd() * 3) | 0);
            for (let j = 0; j < nT; j++) {
              tires.push({ x: tx + (rnd() - 0.5) * 0.08, y: G - 0.15 + j * 0.36, z: tz, ry: rnd() * 6, rx: Math.PI / 2, sx: 1, sy: 1, sz: 1 });
            }
          }
          if (k > 0) {
            const [px, pz] = side.map(a + k * L, WALL_IN + 0.22);
            posts.push({ x: px, y: 0, z: pz, ry: side.yaw, sx: 1, sy: h + 0.3, sz: 1 });
            lamps.push({ x: px, y: h + 0.3, z: pz, ry: side.yaw, sx: 1, sy: 1, sz: 1 });
          }
        }
      }
    }
    // corner pillars
    const corners: [number, number][] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) corners.push([sx * (ARENA.maxX + WALL_C / 2), sz * (ARENA.maxZ + WALL_C / 2)]);
    const cornerItems: Item[] = corners.map(([x, z]) => ({ x, y: 0, z, ry: 0, sx: WALL_C, sy: (brawlMode ? BRAWL_WALL_H : z > 0 ? SOUTH_H : WALL_H) + 0.7, sz: WALL_C }));

    const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.inst(unitBox(), this.std(0xffffff, { roughness: 0.55, metalness: 0.02 }), blocks, true, true);
    // block caps + corner caps: same hemisphere, material and flags -> one draw
    const cornerCaps = cornerItems.map((c) => ({ ...c, y: c.sy - 0.05, sx: WALL_C * 0.55, sy: 0.4, sz: WALL_C * 0.55 }));
    this.inst(new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), snowMat, [...caps, ...cornerCaps]);
    const hazardMat = this.isRally ? this.std(0xe8b423, { roughness: 0.35, metalness: 0.35, emissive: 0x4a3000, emissiveIntensity: 0.35 }) : this.std(0xffffff, { map: getHazardTex(), roughness: 0.6, flatShading: false });
    this.inst(new THREE.BoxGeometry(1, 0.38, 0.07).translate(0, 0.19, 0), hazardMat, bands);
    const trimMat = this.std(st.trim, { metalness: 0.55, roughness: 0.45 });
    this.inst(new THREE.BoxGeometry(0.36, 1, 0.4).translate(0, 0.5, 0), trimMat, posts, true);
    this.inst(unitBox(), this.std(st.trim, { metalness: 0.4, roughness: 0.5 }), cornerItems, true, true);
    this.inst(new THREE.BoxGeometry(0.26, 0.16, 0.26).translate(0, 0.08, 0), this.emissive(st.gate, 1.2, { speed: 2.6 }), lamps);
    const bannerMat = new THREE.MeshStandardMaterial({ map: getBannerTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75 });
    this.inst(new THREE.PlaneGeometry(1.0, 1.3), bannerMat, banners);
    // Campaign: the tire stacks behind the south wall share this draw (buildSouthDressing emits it).
    this.wallTires = { items: tires, mat: this.std(st.tire, { roughness: 0.95 }) };
    if (brawlMode) this.emitTires([]);
  }

  private emitTires(more: Item[]): void {
    const t = this.wallTires!;
    this.wallTires = null;
    this.inst(new THREE.TorusGeometry(0.42, 0.19, 7, 14), t.mat, [...t.items, ...more], true);
  }

  /* ---------- gates ---------- */

  /** The three enemy gates. Static parts are baked into the zone batch (one draw per material + flags for all
   *  gates; the materials are shared by the gates and created in the same order as before, so draw order stays the
   *  same), each gate keeps its own animated light / portal / ramp / glow materials, and the roll-up doors are one
   *  InstancedMesh. */
  private buildGates(G: number, snowMat: THREE.Material): void {
    const shared: GateMats = {};
    for (let i = 0; i < ENEMY_GATES.length; i++) this.buildGate(i, G, snowMat, shared);
    const doorGeo = new THREE.BoxGeometry(GATE_WIDTH - 0.05, 3.5, 0.18).translate(0, -1.75, 0);
    const doors = new THREE.InstancedMesh(doorGeo, shared.door!, this.gates.length);
    for (let i = 0; i < this.gates.length; i++) doors.setMatrixAt(i, this.gates[i].doorBase);
    doors.castShadow = true;
    doors.receiveShadow = true;
    // Bounds at full size (closed doors); opening only shrinks them.
    doors.computeBoundingSphere();
    this.doors = doors;
    this.add(doors);
  }

  private buildGate(index: number, G: number, snowMat: THREE.Material, shared: GateMats): void {
    const st = this.style;
    const gp = ENEMY_GATES[index];
    const ex = Math.min(ARENA.maxX, Math.max(ARENA.minX, gp.x));
    const ez = Math.min(ARENA.maxZ, Math.max(ARENA.minZ, gp.z));
    const grp = new THREE.Group();
    grp.position.set(ex, 0, ez);
    grp.rotation.y = gp.heading;
    this.add(grp);
    grp.updateMatrix();

    const zc = -(WALL_IN + WALL_T / 2);
    const px = GATE_HALF + PILLAR_W / 2;
    const trim = (shared.trim ??= this.std(st.trim, { metalness: 0.55, roughness: 0.45 }));
    const lightMat = new THREE.MeshStandardMaterial({ color: st.gate, emissive: st.gate, emissiveIntensity: 1, roughness: 0.3 });
    const hazard = (shared.hazard ??= this.std(0xffffff, { map: getHazardTex(), roughness: 0.6, flatShading: false }));
    const lights = new StaticBatch();
    const part = new THREE.Object3D();
    // A static part at (x, y, z) in gate space: lightMat parts go into this gate's light batch, everything else into
    // the zone batch (in world space; casting parts also receive).
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true, scale?: THREE.Vector3) => {
      part.position.set(x, y, z);
      if (scale) part.scale.copy(scale);
      else part.scale.set(1, 1, 1);
      part.updateMatrix();
      if (mat === lightMat) lights.add(geo, part.matrix, mat);
      else this.bake(geo, part.matrix.premultiply(grp.matrix), mat, cast, cast);
    };
    // Pillars and header share coplanar faces (z-fight): they stay real meshes so their depth is computed exactly
    // as before.
    const solid = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      grp.add(m);
    };

    // frame
    const pillarGeo = new THREE.BoxGeometry(PILLAR_W, 4.6, WALL_T);
    const plateGeo = new THREE.BoxGeometry(PILLAR_W * 0.8, 3.0, 0.06);
    for (const s of [-1, 1]) {
      solid(pillarGeo, trim, s * px, 2.3, zc);
      mesh(plateGeo, hazard, s * px, 2.0, -WALL_IN + 0.03, false);
      mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.3, 10), trim, s * px, 4.75, zc, false);
      mesh(new THREE.SphereGeometry(0.28, 12, 8), lightMat, s * px, 5.1, zc, false);
    }
    solid(new THREE.BoxGeometry(GATE_WIDTH + PILLAR_W * 2, 1.0, WALL_T), hazard, 0, 4.1, zc);
    mesh(new THREE.BoxGeometry(GATE_WIDTH - 0.4, 0.16, 0.08), lightMat, 0, 3.48, -WALL_IN + 0.04, false);

    // roll-up garage door (pivot at its top edge so scale.y rolls it up into the header): one instance per gate
    shared.door ??= new THREE.MeshStandardMaterial({ map: getDoorTex(), color: new THREE.Color(st.trim).lerp(new THREE.Color(0xffffff), 0.65), roughness: 0.5, metalness: 0.35 });
    part.position.set(0, 3.6, zc);
    part.scale.set(1, 1, 1);
    part.updateMatrix();
    const doorBase = part.matrix.clone().premultiply(grp.matrix);

    // spawn tunnel outside the wall
    const tunnelMat = (shared.tunnel ??= this.std(st.blockAlt, { roughness: 0.6 }));
    const tz = -(WALL_C + TUNNEL_LEN / 2);
    const capScale = new THREE.Vector3(0.6, 0.35, TUNNEL_LEN * 0.5);
    for (const s of [-1, 1]) {
      mesh(new THREE.BoxGeometry(0.9, 3.9, TUNNEL_LEN), tunnelMat, s * (GATE_HALF + 0.45), 1.95, tz);
      mesh(new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), snowMat, s * (GATE_HALF + 0.45), 3.85, tz, false, capScale);
      for (const y of [0.95, 3.3]) mesh(new THREE.BoxGeometry(0.06, 0.12, TUNNEL_LEN - 0.4), lightMat, s * (GATE_HALF - 0.02), y, tz, false);
    }
    mesh(new THREE.BoxGeometry(GATE_WIDTH + 1.8, 0.45, TUNNEL_LEN - 1.2), trim, 0, 4.12, tz - 0.6);
    mesh(new THREE.BoxGeometry(GATE_WIDTH + 1.4, 0.22, TUNNEL_LEN - 1.6), snowMat, 0, 4.42, tz - 0.6, false);
    const backZ = -(WALL_C + TUNNEL_LEN - 0.25);
    mesh(new THREE.PlaneGeometry(GATE_WIDTH, 3.9), (shared.back ??= new THREE.MeshBasicMaterial({ color: 0x05070f })), 0, 1.95, backZ, false);
    lights.flush(grp);
    const portalMat = new THREE.MeshBasicMaterial({
      map: getGlowTex(), color: st.gate, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.pulses.push({ mat: portalMat, base: 0.7, speed: 1.8, phase: index });
    const portal = new THREE.Mesh(new THREE.PlaneGeometry(GATE_WIDTH * 1.2, 4.6), portalMat);
    portal.position.set(0, 1.8, backZ + 0.08);
    grp.add(portal);
    // glowing chevron ramp pointing into the arena
    const floorMat = new THREE.MeshBasicMaterial({
      map: getChevronTex(), color: st.gate, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const ramp = new THREE.Mesh(new THREE.PlaneGeometry(GATE_WIDTH - 1.4, TUNNEL_LEN - 1).rotateX(-Math.PI / 2), floorMat);
    ramp.position.set(0, G + 0.1, -(WALL_C + (TUNNEL_LEN - 1) / 2 - 0.2));
    ramp.renderOrder = 2;
    grp.add(ramp);

    // beacon glows (sprites live in the gate group)
    const glowMat = new THREE.SpriteMaterial({
      map: getGlowTex(), color: st.gate, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    for (const s of [-1, 1]) {
      const sp = new THREE.Sprite(glowMat);
      sp.scale.setScalar(2.6);
      sp.position.set(s * px, 5.1, zc);
      grp.add(sp);
    }

    grp.updateMatrixWorld(true);
    const mouth = grp.localToWorld(new THREE.Vector3(0, G + 0.3, 0.8));
    this.gates.push({ group: grp, doorBase, doorScale: 1, lightMat, glowMat, floorMat, mouth, open: 0, openT: 0, flashT: 0, lastBurst: -10, phase: index * 1.7 });
  }

  /* ---------- spectator stands ---------- */

  /** `skipN` > 0 leaves |x| < skipN of the north side free (Golden Tower Plaza's stage). */
  private buildStands(G: number, skipN = 0): void {
    const rally = this.isRally;
    const signs: { x: number; y: number; z: number; ry: number; i: number }[] = [];
    const st = this.style;
    const rnd = this.rnd;
    const tiers: Item[] = [];
    const seats: Item[] = [];
    const backs: Item[] = [];
    const boards: Item[] = [];
    const poles: Item[] = [];
    const flags: Item[] = [];
    const crowd: Item[] = [];
    let section = 0;
    for (const side of SIDES) {
      if (side.key === 's') continue;
      const range = side.key === 'n' ? [ARENA.minX - 1, ARENA.maxX + 1] : [ARENA.minZ - 1, ARENA.maxZ + 1];
      const gaps = gapsFor(side.key, GATE_HALF + 2.2);
      if (side.key === 'n' && skipN > 0) gaps.push([-skipN, skipN]);
      const runs = subtract(range[0], range[1], gaps);
      for (const [a, b] of runs) {
        const len = b - a;
        const sc = (a + b) / 2;
        const accent = st.accents[section++ % st.accents.length];
        for (let k = 0; k < ROWS; k++) {
          const top = G + 0.25 + (k + 1) * ROW_RISE;
          const depth = (ROWS - k) * ROW_D;
          const [x, z] = side.map(sc, STAND_N0 + k * ROW_D + depth / 2);
          tiers.push({ x, y: 0, z, ry: side.yaw, sx: len, sy: top, sz: depth, color: k % 2 ? st.stand : st.standAlt });
          const [sx, sz] = side.map(sc, STAND_N0 + k * ROW_D + 0.3);
          seats.push({ x: sx, y: top, z: sz, ry: side.yaw, sx: len, sy: 1, sz: 1, color: accent });
          for (let s = a + 0.5; s < b - 0.4; s += 0.85) {
            if (rnd() > (rally ? 0.93 : 0.74)) continue;
            const [cx, cz] = side.map(s + (rnd() - 0.5) * 0.2, STAND_N0 + k * ROW_D + 0.72);
            const sc2 = 0.85 + rnd() * 0.25;
            crowd.push({ x: cx, y: top, z: cz, ry: side.yaw + (rnd() - 0.5) * 0.5, sx: sc2, sy: sc2, sz: sc2, color: this.crowdColor() });
            if (rally && k % 2 === 1 && rnd() < 0.2) signs.push({ x: cx, y: top + 1.25, z: cz, ry: side.yaw + (rnd() - 0.5) * 0.25, i: (rnd() * RALLY_SIGNS.length) | 0 });
          }
        }
        const topH = G + 0.25 + ROWS * ROW_RISE;
        const [bx, bz] = side.map(sc, STAND_N0 + ROWS * ROW_D + 0.15);
        backs.push({ x: bx, y: 0, z: bz, ry: side.yaw, sx: len, sy: topH + 1.3, sz: 0.3 });
        const [fx, fz] = side.map(sc, STAND_N0 - 0.1);
        boards.push({ x: fx, y: 0, z: fz, ry: side.yaw, sx: len, sy: G + 0.25 + ROW_RISE + 0.4, sz: 0.2, color: accent });
        for (let s = a + 1.5; s < b - 1; s += 6) {
          const [qx, qz] = side.map(s, STAND_N0 + ROWS * ROW_D + 0.15);
          poles.push({ x: qx, y: topH + 1.3, z: qz, ry: side.yaw, sx: 1, sy: 1, sz: 1 });
          flags.push({ x: qx, y: topH + 1.3 + 2.55, z: qz, ry: side.yaw + Math.PI / 2 + (rnd() - 0.5) * 0.4, sx: 1, sy: 1, sz: 1, color: st.accents[(rnd() * st.accents.length) | 0] });
        }
      }
    }
    const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.inst(unitBox(), this.std(0xffffff, { roughness: 0.85 }), tiers, true, true);
    this.inst(new THREE.BoxGeometry(1, 0.1, 0.42).translate(0, 0.05, 0), this.std(0xffffff, { roughness: 0.6 }), seats);
    this.inst(unitBox(), this.std(st.trim, { metalness: 0.4, roughness: 0.55 }), backs, true);
    this.inst(unitBox(), this.std(0xffffff, { roughness: 0.5, emissive: 0x222222 }), boards, false, true);
    this.inst(new THREE.CylinderGeometry(0.05, 0.05, 3, 6).translate(0, 1.5, 0), this.std(0xcfd5dc, { metalness: 0.6, roughness: 0.4 }), poles);
    if (rally) {
      // US-style flags on every pole
      this.inst(wavyFlag(1.6, 0.85).translate(0.05, 0.0, 0), this.std(0xffffff, { map: getUsFlagTex(), side: THREE.DoubleSide, roughness: 0.75, flatShading: false }), flags.map((f) => ({ ...f, color: undefined })));
      this.bakeSigns(signs, 1.25, 0.5, true);
    } else {
      const flagShape = new THREE.Shape();
      flagShape.moveTo(0, 0);
      flagShape.lineTo(1.3, -0.3);
      flagShape.lineTo(0, -0.7);
      flagShape.closePath();
      this.inst(new THREE.ShapeGeometry(flagShape).translate(0.05, 0.4, 0), this.std(0xffffff, { side: THREE.DoubleSide, roughness: 0.7 }), flags);
    }
    this.addCrowd(crowd);
  }

  /* ---------- floodlight towers ---------- */

  private buildTowers(off = TOWER_OFF, k = 1): void {
    const st = this.style;
    const c = ARENA.maxX + off;
    const items: Item[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const x = sx * c;
      const z = sz * (ARENA.maxZ + off);
      items.push({ x, y: 0, z, ry: Math.atan2(-x, -z), sx: k, sy: k, sz: k });
    }
    const H = 16;
    const parts: THREE.BufferGeometry[] = [];
    for (const lx of [-0.6, 0.6]) for (const lz of [-0.6, 0.6]) parts.push(new THREE.BoxGeometry(0.2, H, 0.2).translate(lx, H / 2, lz));
    for (let y = 2; y < H; y += 2.6) {
      parts.push(new THREE.BoxGeometry(1.4, 0.1, 0.1).translate(0, y, 0.6));
      parts.push(new THREE.BoxGeometry(1.4, 0.1, 0.1).translate(0, y, -0.6));
      parts.push(new THREE.BoxGeometry(0.1, 0.1, 1.4).translate(0.6, y, 0));
      parts.push(new THREE.BoxGeometry(0.1, 0.1, 1.4).translate(-0.6, y, 0));
    }
    const tilt = 0.5;
    parts.push(new THREE.BoxGeometry(5, 2.6, 0.5).rotateX(tilt).translate(0, H + 0.6, 0.5));
    parts.push(new THREE.BoxGeometry(5.4, 0.25, 1.2).translate(0, H - 0.9, 0.3));
    this.inst(merge(parts), this.std(st.trim, { metalness: 0.6, roughness: 0.4 }), items, true);
    const lamps: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) {
      lamps.push(new THREE.BoxGeometry(0.95, 0.85, 0.12).translate(-1.65 + i * 1.1, -0.5 + j * 1.0, 0.27).rotateX(tilt).translate(0, H + 0.6, 0.5));
    }
    this.inst(merge(lamps), new THREE.MeshBasicMaterial({ color: st.lamp, toneMapped: false }), items);
    // big lens glows in front of the lamp heads
    for (const it of items) {
      const fx = Math.sin(it.ry) * 1.2 * k;
      const fz = Math.cos(it.ry) * 1.2 * k;
      this.glowSprite(st.lamp, st.glow, 10 * k, it.x + fx, (H + 0.4) * k, it.z + fz);
    }
  }

  /* ---------- jumbotron ---------- */

  private buildJumbotron(zone: ZoneDef): void {
    const st = this.style;
    const grp = new THREE.Group();
    grp.position.set(0, 0, -54);
    this.add(grp);
    const trim = this.std(st.trim, { metalness: 0.55, roughness: 0.45 });
    // legs (casting) + frame baked into one draw
    const legGeo = new THREE.BoxGeometry(1, 10.4, 1).translate(0, 5.2, 0);
    for (const x of [-8, 8]) this.bake(legGeo, this.tmpM.makeTranslation(x, 0, -54), trim, true);
    this.bake(new THREE.BoxGeometry(21, 9.6, 1.2), this.tmpM.makeTranslation(0, 15, -54), trim);

    // main screen
    const [c, g] = canvas(1024, 340);
    const bg = g.createLinearGradient(0, 0, 0, 340);
    bg.addColorStop(0, '#0b1230');
    bg.addColorStop(1, '#1b0f36');
    g.fillStyle = bg;
    g.fillRect(0, 0, 1024, 340);
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 2;
    for (let x = 0; x < 1024; x += 32) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 340);
      g.stroke();
    }
    g.strokeStyle = hexCss(st.accents[0]);
    g.lineWidth = 10;
    g.strokeRect(10, 10, 1004, 320);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 104px "Arial Black", Impact, sans-serif';
    g.fillStyle = '#ffffff';
    g.fillText('SNOWPLOW', 512, 92);
    g.fillStyle = hexCss(st.accents[0]);
    g.fillText('SHOWDOWN', 512, 192);
    g.font = 'bold 44px Arial, sans-serif';
    g.fillStyle = hexCss(st.accents[1]);
    g.fillText(zone.name.toUpperCase(), 512, 280);
    const screenTex = toTex(c);
    this.zoneTex.push(screenTex);
    const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false });
    this.pulses.push({ mat: screenMat, base: 1, speed: 0, phase: 0 });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(19.6, 6.5), screenMat);
    screen.position.set(0, 15.9, 0.61);
    grp.add(screen);

    // scrolling ticker
    const [tc, tg] = canvas(1024, 64);
    tg.fillStyle = '#05070f';
    tg.fillRect(0, 0, 1024, 64);
    tg.font = 'bold 38px Arial, sans-serif';
    tg.textBaseline = 'middle';
    tg.fillStyle = hexCss(st.accents[0]);
    const msg = `  ★ ${zone.name.toUpperCase()}  ★  BOSS: ${zone.bossName}  ★  RAM · SLAM · SURVIVE  `;
    tg.fillText(msg, 0, 34);
    const tickTex = toTex(tc, true);
    tickTex.wrapT = THREE.ClampToEdgeWrapping;
    this.zoneTex.push(tickTex);
    this.ticker = tickTex;
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(19.6, 1.4), new THREE.MeshBasicMaterial({ map: tickTex, toneMapped: false }));
    tick.position.set(0, 11.5, 0.61);
    grp.add(tick);

    // marquee bulbs
    const bulbs: Item[] = [];
    for (let i = 0; i <= 20; i++) {
      bulbs.push({ x: -10 + i, y: 19.6, z: -54 + 0.62, ry: 0, sx: 1, sy: 1, sz: 1 });
      bulbs.push({ x: -10 + i, y: 10.4, z: -54 + 0.62, ry: 0, sx: 1, sy: 1, sz: 1 });
    }
    this.inst(new THREE.SphereGeometry(0.16, 8, 6), this.emissive(st.accents[0], 1.6, { speed: 5 }), bulbs);
  }

  /* ---------- low dressing behind the south wall (camera side) ---------- */

  private buildSouthDressing(G: number): void {
    const rnd = this.rnd;
    const st = this.style;
    const tires: Item[] = [];
    const barrels: Item[] = [];
    for (let i = 0; i < 9; i++) {
      const x = ARENA.minX - 4 + rnd() * (ARENA.maxX - ARENA.minX + 8);
      const z = ARENA.maxZ + WALL_C + 1.2 + rnd() * 6;
      const n = 1 + ((rnd() * 3) | 0);
      for (let j = 0; j < n; j++) tires.push({ x, y: G - 0.15 + j * 0.36, z, ry: rnd() * 6, rx: Math.PI / 2, sx: 1, sy: 1, sz: 1 });
    }
    for (let i = 0; i < 7; i++) {
      barrels.push({
        x: ARENA.minX + rnd() * (ARENA.maxX - ARENA.minX), y: G - 0.2, z: ARENA.maxZ + WALL_C + 1.5 + rnd() * 8, ry: rnd() * 6,
        sx: 1, sy: 1, sz: 1, color: st.accents[(rnd() * st.accents.length) | 0],
      });
    }
    this.emitTires(tires);
    this.inst(new THREE.CylinderGeometry(0.4, 0.4, 1.1, 12).translate(0, 0.55, 0), this.std(0xffffff, { roughness: 0.6, metalness: 0.3 }), barrels, true);
  }

  /* ---------- distant mountains & drifts ---------- */

  private buildMountains(zone: ZoneDef): void {
    const rnd = this.rnd;
    const theme = zone.theme;
    const biome = this.biome;
    const fogC = new THREE.Color(zone.fogColor);
    const skyB = new THREE.Color(zone.skyBottom);
    const haze = theme === 'blizzard' && !biome ? 0.82 : biome === 'quarry' ? 0.3 : 0.5;
    const mCol = new THREE.Color(this.style.mountain).lerp(fogC, haze);
    // snow caps; volcano craters glow in the quarry, the Divide caps by side, mesas get a lighter band
    const capHex = biome === 'quarry' ? 0xff5a14 : biome === 'mars' ? 0xd88a5a : biome === 'plaza' ? 0x86a86a : zone.snowTint;
    const cCol = new THREE.Color(capHex).lerp(skyB, biome === 'quarry' ? 0 : haze * 0.6);
    const hotM = new THREE.Color(0x6a2418).lerp(fogC, haze);
    const hotC = new THREE.Color(0xff5a14);
    const coldM = new THREE.Color(0x8fb8dc).lerp(fogC, haze);
    // one draw: white material, rock / snow-cap colour per instance
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, fog: false });
    const mesas = biome === 'mars';
    const mGeo = mesas ? new THREE.CylinderGeometry(0.7, 1, 1, 7, 1).translate(0, 0.5, 0) : new THREE.ConeGeometry(1, 1, 6, 1).translate(0, 0.5, 0);
    const mItems: Item[] = [];
    let cItems: Item[] = [];
    const n = 34;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd() * 0.12;
      const R = 230 + rnd() * 70;
      const tall = theme === 'peak' && !biome;
      const h = (tall ? 80 : mesas ? 22 : 45) + rnd() * (tall ? 90 : mesas ? 30 : 60);
      const r = (mesas ? 40 : 35) + rnd() * 40;
      const ry = rnd() * 6.28;
      const x = Math.sin(a) * R;
      const z = Math.cos(a) * R;
      const sz = r * (0.7 + rnd() * 0.5);
      mItems.push({ x, y: -2, z, ry, sx: r, sy: h, sz });
      const k = mesas ? 0.22 : biome === 'quarry' ? 0.16 : 0.36;
      if (mesas) cItems.push({ x, y: -2 + h * 0.62, z, ry, sx: r * 0.83, sy: h * 0.08, sz: sz * 0.83 });
      else cItems.push({ x, y: -2 + h * (1 - k) - 0.3, z, ry, sx: r * k * 1.04, sy: h * k * 1.01, sz: sz * k * 1.04 });
    }
    // lava-capped volcano tops (quarry, the Divide's hot half) glow: unlit, fog-free
    const glowing = (it: Item) => biome === 'quarry' || (biome === 'divide' && it.x < 0);
    const lavaCaps = cItems.filter(glowing);
    if (lavaCaps.length) {
      const lc = this.inst(mGeo.clone(), new THREE.MeshBasicMaterial({ color: 0xff5a14, fog: false, toneMapped: false }), lavaCaps);
      if (lc) lc.renderOrder = -5;
      cItems = cItems.filter((it) => !glowing(it));
    }
    const mm = this.inst(mGeo, mat, [...mItems, ...cItems]);
    if (mm) {
      for (let i = 0; i < mm.count; i++) {
        const cap = i >= mItems.length;
        const it = cap ? cItems[i - mItems.length] : mItems[i];
        if (biome === 'divide') mm.setColorAt(i, it.x < 0 ? (cap ? hotC : hotM) : cap ? cCol : coldM);
        else mm.setColorAt(i, cap ? cCol : mCol);
      }
      mm.instanceColor!.needsUpdate = true;
      mm.renderOrder = -5;
    }
  }

  /** Low mounds outside the walls: snow drifts, ash heaps (quarry), rust dunes (Rust Basin), hedges (Plaza); the
   *  Divide gets ash on its hot half and snow on its cold half. */
  private buildDrifts(G: number, snowMat: THREE.Material): void {
    const rnd = this.rnd;
    const biome = this.biome;
    const items: Item[] = this.scatter(this.zone.theme === 'blizzard' && !biome ? 60 : 36, 48, 115).map((p) => {
      const s = 1.5 + rnd() * 3;
      const dune = biome === 'mars';
      return { x: p.x, y: G - 0.1, z: p.z, ry: rnd() * 6.28, sx: s * (dune ? 2.6 : 1.6), sy: s * (dune ? 0.4 : 0.28), sz: s };
    });
    const geo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    if (biome === 'plaza') {
      this.inst(geo, this.std(0x4f9a43, { roughness: 0.85 }), items.map((i) => ({ ...i, sy: i.sy * 2.2 })), true, true);
    } else if (biome === 'mars') {
      this.inst(geo, this.std(0xc4744a, { roughness: 0.95 }), items, false, true);
    } else if (biome === 'divide') {
      for (const it of items) it.color = it.x < 0 ? 0x5e4a48 : 0xf3f6fa;
      this.inst(geo, this.std(0xffffff, { roughness: 0.85 }), items, false, true);
    } else this.inst(geo, snowMat, items, false, true);
  }

  /* ---------- theme: Frostbite Yard (snowy scrapyard) ---------- */

  private buildYard(G: number): void {
    const rnd = this.rnd;
    const junkCols = [0x8a4b2a, 0x5b6a7a, 0x9a3a2e, 0x3f5f8a, 0x7a7a72, 0xb08a3a, 0x4d5a3a];
    const junk: Item[] = [];
    const mounds: Item[] = [];
    const tires: Item[] = [];
    for (const p of this.scatter(18, 50, 115)) {
      const n = 8 + ((rnd() * 9) | 0);
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2;
        const d = rnd() * 3.5;
        const s = 0.8 + rnd() * 1.6;
        junk.push({
          x: p.x + Math.cos(a) * d, y: G - 0.3 + rnd() * (3.6 - d) * 0.7, z: p.z + Math.sin(a) * d, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.8,
          rz: (rnd() - 0.5) * 0.8, sx: s * (0.8 + rnd() * 0.8), sy: s * (0.5 + rnd() * 0.5), sz: s, color: junkCols[(rnd() * junkCols.length) | 0],
        });
      }
      mounds.push({ x: p.x, y: G - 0.4, z: p.z, ry: rnd() * 6, sx: 4.2 + rnd(), sy: 1.4 + rnd() * 0.8, sz: 4.2 + rnd() });
      for (let i = 0; i < 4; i++) tires.push({ x: p.x + (rnd() - 0.5) * 8, y: G + 0.05, z: p.z + (rnd() - 0.5) * 8, ry: 0, rx: Math.PI / 2 + (rnd() - 0.5) * 0.6, sx: 1, sy: 1, sz: 1 });
    }
    this.inst(new THREE.BoxGeometry(1, 1, 1), this.std(0xffffff, { roughness: 0.7, metalness: 0.3 }), junk);
    this.inst(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), this.std(this.zone.snowTint, { roughness: 0.85 }), mounds);
    this.inst(new THREE.TorusGeometry(0.42, 0.19, 7, 14), this.std(this.style.tire, { roughness: 0.95 }), tires);

    // shipping container stacks
    const cCols = [0xc0392b, 0x2f6fb0, 0xe0a030, 0x3c8d5a, 0x8e44ad];
    const cont: Item[] = [];
    const roofs: Item[] = [];
    const rows: [number, number, number][] = [[-74, -18, 0], [72, 8, 0], [-40, -84, Math.PI / 2], [46, -78, Math.PI / 2], [-80, 46, 0.3]];
    for (const [rx, rz, ry] of rows) {
      const n = 3 + ((rnd() * 3) | 0);
      for (let i = 0; i < n; i++) {
        const along = (i - n / 2) * 2.6;
        const hgt = 1 + ((rnd() * 3) | 0);
        for (let j = 0; j < hgt; j++) {
          const x = rx + Math.cos(ry) * along;
          const z = rz - Math.sin(ry) * along;
          cont.push({ x, y: j * 2.6, z, ry: ry + (rnd() - 0.5) * 0.06, sx: 1, sy: 1, sz: 1, color: cCols[(rnd() * cCols.length) | 0] });
          if (j === hgt - 1) roofs.push({ x, y: hgt * 2.6, z, ry, sx: 1, sy: 1, sz: 1 });
        }
      }
    }
    this.inst(new THREE.BoxGeometry(2.44, 2.6, 6.1).translate(0, 1.3, 0), this.std(0xffffff, { roughness: 0.6, metalness: 0.25 }), cont);
    this.inst(new THREE.BoxGeometry(2.5, 0.2, 6.2).translate(0, 0.1, 0), this.std(0xffffff, { roughness: 0.85 }), roofs);

    // a scrapyard crane, far north-west
    const yellow = this.std(0xf2b632, { metalness: 0.3, roughness: 0.5 });
    const crane = new THREE.Group();
    crane.position.set(-82, 0, -70);
    crane.rotation.y = 0.7;
    // tower + boom share `yellow`; cab, weight and cable differ only in colour -> one vertex-coloured draw
    const frame = new THREE.Mesh(merge([new THREE.BoxGeometry(1.6, 30, 1.6).translate(0, 15, 0), new THREE.BoxGeometry(28, 1.1, 1.1).translate(9, 30.5, 0)]), yellow);
    const dark = merge([
      colored(new THREE.BoxGeometry(2.6, 2.2, 2.4).translate(0, 28.6, 1.6), 0x30343c),
      colored(new THREE.BoxGeometry(3, 2.2, 2).translate(-5, 29.4, 0), 0x4a4f58),
      colored(new THREE.BoxGeometry(0.08, 14, 0.08).translate(19, 23.5, 0), 0x222222),
    ]);
    const parts = new THREE.Mesh(dark, this.std(0xffffff, { vertexColors: true }));
    const magnet = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.6, 14).translate(19, 16.3, 0), this.std(0x3a3f48, { metalness: 0.6 }));
    crane.add(frame, parts, magnet);
    this.add(crane);
  }

  /* ---------- theme: Pine Junkyard ---------- */

  private buildJunkyard(G: number): void {
    const rnd = this.rnd;
    // pines
    const pts = this.scatter(360, 48, 130);
    if (pts.length) {
      const seg = 7;
      const tiers = [
        { r: 1.7, h: 2.2, y: 2.0 },
        { r: 1.3, h: 1.9, y: 3.4 },
        { r: 0.9, h: 1.6, y: 4.6 },
      ];
      const fol: THREE.BufferGeometry[] = [];
      const caps: THREE.BufferGeometry[] = [];
      for (const t of tiers) {
        fol.push(new THREE.ConeGeometry(t.r, t.h, seg).translate(0, t.y, 0));
        const ch = t.h * 0.42;
        caps.push(new THREE.ConeGeometry(t.r * 0.48, ch, seg).translate(0, t.y + t.h / 2 - ch / 2 + 0.02, 0));
        caps.push(new THREE.CylinderGeometry(t.r * 0.75, t.r * 0.98, 0.18, seg).translate(0, t.y - t.h / 2 + 0.25, 0));
      }
      const items: Item[] = pts.map((p) => {
        const s = 0.8 + rnd() * 0.9 + (Math.hypot(p.x, p.z) > 80 ? 0.5 : 0);
        return { x: p.x, y: G - 0.2, z: p.z, ry: rnd() * Math.PI * 2, sx: s, sy: s * (0.9 + rnd() * 0.35), sz: s, color: FOLIAGE[(rnd() * FOLIAGE.length) | 0] };
      });
      const plain = items.map((i) => ({ ...i, color: undefined }));
      this.inst(merge(fol), this.std(0xffffff), items);
      this.inst(merge(caps), this.std(this.zone.snowTint, { roughness: 0.85 }), plain);
      this.inst(new THREE.CylinderGeometry(0.22, 0.3, 1.6, 6).translate(0, 0.8, 0), this.std(0x6b4428, { roughness: 0.9 }), plain);
    }

    // wrecked cars (vertex-colored body/glass/wheels, tinted per instance)
    const car = merge([
      colored(new THREE.BoxGeometry(1.9, 0.8, 4.2).translate(0, 0.62, 0), 0xffffff),
      colored(new THREE.BoxGeometry(1.7, 0.66, 2.2).translate(0, 1.33, -0.3), 0xffffff),
      colored(new THREE.BoxGeometry(1.74, 0.4, 2.24).translate(0, 1.36, -0.3), 0x2a3440),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => colored(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10).rotateZ(Math.PI / 2).translate(sx * 0.95, 0.38, sz * 1.35), 0x1e1e22))),
    ]);
    const rust = [0x8a4b2a, 0x6f7a3f, 0x3f5f8a, 0x9a3a2e, 0x7a6a5a, 0xb07a3a];
    const cars: Item[] = [];
    const roofSnow: Item[] = [];
    for (const p of this.scatter(36, 48, 100)) {
      const flip = rnd() < 0.15;
      const ry = rnd() * 6.28;
      cars.push({ x: p.x, y: flip ? G + 1.65 : G - 0.15, z: p.z, ry, rx: (rnd() - 0.5) * 0.2, rz: flip ? Math.PI : (rnd() - 0.5) * 0.25, sx: 1, sy: 1, sz: 1, color: rust[(rnd() * rust.length) | 0] });
      if (!flip) roofSnow.push({ x: p.x, y: G + 1.6, z: p.z, ry, sx: 1, sy: 1, sz: 1 });
      // stacked wreck
      if (rnd() < 0.25) cars.push({ x: p.x + (rnd() - 0.5), y: G + 1.55, z: p.z + (rnd() - 0.5), ry: ry + (rnd() - 0.5) * 0.8, rz: (rnd() - 0.5) * 0.2, sx: 1, sy: 1, sz: 1, color: rust[(rnd() * rust.length) | 0] });
    }
    this.inst(car, this.std(0xffffff, { vertexColors: true, roughness: 0.7, metalness: 0.2 }), cars);
    this.inst(new THREE.BoxGeometry(1.6, 0.16, 2.0).translate(0, 0.08, -0.3), this.std(this.zone.snowTint, { roughness: 0.85 }), roofSnow);

    // stumps & logs
    const wood = this.std(0x6b4428, { roughness: 0.9 });
    this.inst(
      new THREE.CylinderGeometry(0.35, 0.4, 1, 8),
      wood,
      this.scatter(20, 48, 90).map((p) => ({ x: p.x, y: G + 0.25, z: p.z, ry: rnd() * 6.28, rz: Math.PI / 2, sx: 1, sy: 1.5 + rnd() * 2, sz: 1 })),
    );

    // the plow shed where the rogue AI lives
    const shed = new THREE.Group();
    shed.position.set(-70, 0, 34);
    shed.rotation.y = Math.atan2(70, -34);
    const body = new THREE.Mesh(new THREE.BoxGeometry(16, 7, 11).translate(0, 3.5, 0), this.std(0x7a3a28, { roughness: 0.85 }));
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.6, 16.4, 3, 1, false, Math.PI / 2).rotateZ(Math.PI / 2), this.std(this.zone.snowTint, { roughness: 0.85 }));
    roof.scale.set(1, 0.5, 1);
    roof.position.y = 7 + 1.5;
    const door = new THREE.Mesh(new THREE.BoxGeometry(7, 5, 0.2).translate(0, 2.5, 5.55), new THREE.MeshStandardMaterial({ map: getDoorTex(), color: 0x9aa0a8, roughness: 0.6 }));
    const eye = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.7, 0.1).translate(0, 6, 5.56), this.emissive(0xff2a1a, 2.2, { speed: 1.4 }));
    body.castShadow = true;
    shed.add(body, roof, door, eye);
    this.add(shed);
  }

  /* ---------- theme: Frozen Foundry ---------- */

  private buildFoundry(G: number): void {
    const rnd = this.rnd;
    // ice-locked ground
    const ice = new THREE.Mesh(new THREE.RingGeometry(46, 118, 64, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9fd2ea, roughness: 0.12, metalness: 0.15 }));
    ice.position.y = G + 0.03;
    ice.receiveShadow = true;
    this.add(ice);

    // smokestacks
    const stacks: { x: number; y: number; z: number; r: number }[] = [];
    const sItems: Item[] = [];
    const bands: Item[] = [];
    const rims: Item[] = [];
    const spots: [number, number][] = [[-72, -62], [-30, -92], [34, -90], [80, -50], [-92, 6], [94, 22]];
    for (const [x, z] of spots) {
      const r = 2.2 + rnd() * 0.9;
      const h = 26 + rnd() * 12;
      sItems.push({ x, y: 0, z, ry: 0, sx: r, sy: h, sz: r });
      for (const f of [0.62, 0.8]) bands.push({ x, y: h * f, z, ry: 0, sx: r * 0.93, sy: 1.6, sz: r * 0.93 });
      rims.push({ x, y: h, z, ry: 0, rx: Math.PI / 2, sx: r * 0.86, sy: r * 0.86, sz: 1 });
      stacks.push({ x, y: h, z, r });
    }
    this.inst(new THREE.CylinderGeometry(0.85, 1, 1, 14).translate(0, 0.5, 0), this.std(0x5a4a44, { roughness: 0.9 }), sItems);
    this.inst(new THREE.CylinderGeometry(1, 1, 1, 14), this.std(0xe8f4fb, { roughness: 0.4 }), bands);
    this.inst(new THREE.TorusGeometry(1, 0.14, 6, 18), this.emissive(0xff7a2a, 2.2, { speed: 1.7 }), rims);
    // smoke / steam puffs (animated in update)
    const per = 7;
    const puffMat = new THREE.MeshLambertMaterial({ color: 0xe6edf2, transparent: true, opacity: 0.5, depthWrite: false });
    const puffMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), puffMat, stacks.length * per);
    puffMesh.frustumCulled = false;
    this.add(puffMesh);
    this.puffs = { mesh: puffMesh, stacks, per };

    // frozen furnaces: iron blocks with glowing mouths, sealed in ice
    const furn: [number, number][] = [[-60, 28], [62, -26], [-54, -60], [60, 48], [0, -78]];
    const iron = this.std(0x3a3436, { roughness: 0.7, metalness: 0.4 });
    const mouthMat = this.emissive(0xff6a1a, 2.4, { speed: 2.1 });
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xbfefff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.38, depthWrite: false });
    const icicles: Item[] = [];
    for (const [x, z] of furn) {
      if (Math.abs(x) < 16 && z < -38 && z > -64) continue;
      const f = new THREE.Group();
      f.position.set(x, 0, z);
      f.rotation.y = Math.atan2(-x, -z);
      const w = 8 + rnd() * 3;
      const h = 7 + rnd() * 3;
      // body + chimney (iron) and mouth are baked into the zone batch (one draw each for all furnaces)
      f.updateMatrix();
      this.bake(new THREE.BoxGeometry(w, h, w).translate(0, h / 2, 0), f.matrix, iron);
      this.bake(new THREE.CylinderGeometry(1, 1.2, 6, 10).translate(w * 0.25, h + 3, -w * 0.2), f.matrix, iron);
      this.bake(new THREE.BoxGeometry(w * 0.45, h * 0.35, 0.1).translate(0, h * 0.3, w / 2 + 0.06), f.matrix, mouthMat);
      const shell = new THREE.Mesh(new THREE.BoxGeometry(w + 1.2, h + 1.0, w + 1.2).translate(0, (h + 1) / 2, 0), shellMat);
      shell.renderOrder = 3;
      f.add(shell);
      this.add(f);
      this.glowSprite(0xff7a2a, 0.5, w * 0.9, x + Math.sin(f.rotation.y) * (w / 2 + 1.2), h * 0.3, z + Math.cos(f.rotation.y) * (w / 2 + 1.2), 2.1);
      for (let k = 0; k < 10; k++) {
        const t = rnd() * 2 - 1;
        const side = (rnd() * 4) | 0;
        const half = (w + 1.2) / 2;
        const lx = side < 2 ? t * half : (side === 2 ? -half : half);
        const lz = side < 2 ? (side === 0 ? -half : half) : t * half;
        const ry = f.rotation.y;
        icicles.push({
          x: x + Math.cos(ry) * lx + Math.sin(ry) * lz, y: h + 1, z: z - Math.sin(ry) * lx + Math.cos(ry) * lz,
          ry: 0, rx: Math.PI, sx: 0.25 + rnd() * 0.2, sy: 1 + rnd() * 1.6, sz: 0.25 + rnd() * 0.2,
        });
      }
    }
    this.inst(new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xd8f6ff, roughness: 0.15, transparent: true, opacity: 0.85 }), icicles);

    // frosted pipes on supports
    const pipes: Item[] = [];
    const supports: Item[] = [];
    const runs: [number, number, number, number][] = [[-60, 28, -92, 6], [62, -26, 80, -50], [-54, -60, -72, -62], [60, 48, 94, 22]];
    for (const [ax, az, bx, bz] of runs) {
      const len = Math.hypot(bx - ax, bz - az);
      const ry = Math.atan2(bx - ax, bz - az);
      pipes.push({ x: (ax + bx) / 2, y: 4.2, z: (az + bz) / 2, ry, rx: Math.PI / 2, sx: 1, sy: len, sz: 1 });
      for (let t = 0.15; t < 0.9; t += 0.25) supports.push({ x: ax + (bx - ax) * t, y: 0, z: az + (bz - az) * t, ry, sx: 1, sy: 1, sz: 1 });
    }
    this.inst(new THREE.CylinderGeometry(0.6, 0.6, 1, 10), this.std(0x9fb8c8, { roughness: 0.5, metalness: 0.5 }), pipes);
    this.bakeItems(new THREE.BoxGeometry(0.4, 4.2, 0.4).translate(0, 2.1, 0), iron, supports);

    // ice crystals
    const crystals: Item[] = [];
    for (const p of this.scatter(16, 48, 95)) {
      const n = 2 + ((rnd() * 4) | 0);
      for (let k = 0; k < n; k++) {
        const s = 0.4 + rnd() * 0.7;
        crystals.push({ x: p.x + (rnd() - 0.5) * 2, y: G + s, z: p.z + (rnd() - 0.5) * 2, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.7, rz: (rnd() - 0.5) * 0.7, sx: s, sy: s * (2 + rnd() * 1.5), sz: s });
      }
    }
    this.inst(new THREE.OctahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xbfefff, emissive: 0x6ff3ff, emissiveIntensity: 0.3, roughness: 0.1, flatShading: true, transparent: true, opacity: 0.85 }), crystals);
  }

  /* ---------- theme: Blizzard Bowl (whiteout stadium) ---------- */

  private buildBowl(zone: ZoneDef): void {
    const rnd = this.rnd;
    const steps = 12;
    const R0 = 58;
    const pts: THREE.Vector2[] = [new THREE.Vector2(R0 - 1, -1), new THREE.Vector2(R0 - 1, 3.2)];
    for (let i = 0; i < steps; i++) {
      const r = R0 + i * 2;
      const y = 3.2 + i * 1.5;
      pts.push(new THREE.Vector2(r, y), new THREE.Vector2(r, y + 1.5));
    }
    const rTop = R0 + steps * 2;
    const yTop = 3.2 + steps * 1.5;
    pts.push(new THREE.Vector2(rTop, yTop), new THREE.Vector2(rTop, yTop + 2.5), new THREE.Vector2(rTop + 2, yTop + 2.5), new THREE.Vector2(rTop + 2, -1));
    const fogC = new THREE.Color(zone.fogColor);
    const bowl = new THREE.Mesh(
      new THREE.LatheGeometry(pts, 72),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(0x6f7b8a).lerp(fogC, 0.1), roughness: 0.9, flatShading: true, side: THREE.DoubleSide }),
    );
    this.add(bowl);
    // distant crowd on the bowl tiers
    const crowd: Item[] = [];
    for (let i = 0; i < 1000; i++) {
      const tier = (rnd() * steps) | 0;
      const a = rnd() * Math.PI * 2;
      const r = R0 + tier * 2 + 0.6 + rnd() * 0.8;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const s = 1.1 + rnd() * 0.3;
      crowd.push({ x, y: 3.2 + (tier + 1) * 1.5, z, ry: Math.atan2(-x, -z), sx: s, sy: s, sz: s, color: this.crowdColor() });
    }
    this.addCrowd(crowd);
    // light masts on the rim
    const masts: Item[] = [];
    const heads: Item[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = Math.sin(a) * (rTop + 1);
      const z = Math.cos(a) * (rTop + 1);
      masts.push({ x, y: yTop + 2.5, z, ry: a, sx: 1, sy: 1, sz: 1 });
      heads.push({ x: x * 0.985, y: yTop + 12.5, z: z * 0.985, ry: Math.atan2(-x, -z), rx: 0.35, sx: 1, sy: 1, sz: 1 });
      this.glowSprite(0xffffff, 0.6, 12, x * 0.97, yTop + 12.5, z * 0.97);
    }
    this.inst(new THREE.BoxGeometry(0.6, 10, 0.6).translate(0, 5, 0), this.std(0x7a8490, { metalness: 0.5 }), masts);
    this.inst(new THREE.BoxGeometry(5, 2.4, 0.4), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), heads);
    // wind-swept snow fence posts
    const posts: Item[] = this.scatter(30, 48, 56).map((p) => ({ x: p.x, y: 0, z: p.z, ry: rnd() * 6, sx: 1, sy: 1, sz: 1 }));
    this.inst(new THREE.BoxGeometry(0.12, 1.8, 0.12).translate(0, 0.9, 0), this.emissive(0xff5a2a, 0.8, { speed: 4 }), posts);
  }

  /* ---------- biome: Coldboot Glacier (frozen relay station, aurora) ---------- */

  private buildGlacier(G: number): void {
    const rnd = this.rnd;
    // ice cliffs and bergs: big faceted chunks ringing the arena
    const iceCols = [0xe2f4ff, 0xc4e6fb, 0xa9d8f6, 0xd4eeff];
    const bergs: Item[] = this.scatter(30, 52, 125).map((p) => {
      const far = Math.hypot(p.x, p.z) > 80;
      const s = (far ? 5 : 2.2) + rnd() * (far ? 8 : 3);
      return { x: p.x, y: G - s * 0.25, z: p.z, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.5, rz: (rnd() - 0.5) * 0.5, sx: s * (1 + rnd() * 0.6), sy: s * (0.9 + rnd() * 1.1), sz: s, color: iceCols[(rnd() * iceCols.length) | 0] };
    });
    this.inst(new THREE.DodecahedronGeometry(1, 0), this.std(0xffffff, { roughness: 0.22, metalness: 0.05, emissive: 0x123a58, emissiveIntensity: 0.45 }), bergs, true);
    // glowing ice crystal clusters
    const crystals: Item[] = [];
    for (const p of this.scatter(22, 48, 100)) {
      const n = 2 + ((rnd() * 4) | 0);
      for (let k = 0; k < n; k++) {
        const s = 0.4 + rnd() * 0.8;
        crystals.push({ x: p.x + (rnd() - 0.5) * 2.2, y: G + s, z: p.z + (rnd() - 0.5) * 2.2, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.7, rz: (rnd() - 0.5) * 0.7, sx: s, sy: s * (2 + rnd() * 1.6), sz: s });
      }
    }
    this.inst(new THREE.OctahedronGeometry(1, 0), this.emissive(0x8ff6ff, 0.9, { speed: 1.3 }), crystals);

    // the relay station (north-west): a squat white block with blue bands, a roof dish and an ice crust
    const M = new THREE.Matrix4();
    const st = new THREE.Object3D();
    st.position.set(-72, 0, -40);
    st.rotation.y = Math.atan2(72, 40);
    st.updateMatrix();
    const at = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true) =>
      this.bake(geo, M.makeTranslation(x, y, z).premultiply(st.matrix), mat, cast, cast);
    const white = this.std(0xe6edf3, { roughness: 0.6 });
    const steel = this.std(0x3a4a5c, { metalness: 0.5, roughness: 0.45 });
    at(new THREE.BoxGeometry(18, 8, 11).translate(0, 4, 0), white, 0, 0, 0);
    at(new THREE.BoxGeometry(18.2, 0.8, 11.2), this.std(0x2f6fb0, { roughness: 0.5 }), 0, 6.2, 0, false);
    at(new THREE.BoxGeometry(8, 4, 7).translate(0, 2, 0), white, -4, 8, 0);
    at(new THREE.BoxGeometry(6, 4.5, 0.2).translate(0, 2.25, 0), steel, 3, 0, 5.6, false);
    const winMat = this.emissive(0x7fe8ff, 1.2, { speed: 0.8 });
    for (let i = 0; i < 4; i++) at(new THREE.BoxGeometry(1.6, 0.9, 0.1), winMat, -7 + i * 2.4, 4.6, 5.56, false);
    // roof dish: a shallow bowl tilted at the sky, on a mast
    at(new THREE.CylinderGeometry(0.35, 0.45, 3, 8).translate(0, 1.5, 0), steel, 5, 8, -1);
    const dish = new THREE.SphereGeometry(3.4, 18, 8, 0, Math.PI * 2, 0, 0.9).rotateX(Math.PI).rotateX(-0.7);
    at(dish, this.std(0xf2f6fa, { roughness: 0.4, side: THREE.DoubleSide }), 5, 13.2, -1);
    // ice crust over the station + icicles along the eaves
    const crust = new THREE.Mesh(new THREE.BoxGeometry(19.2, 9, 12.2).translate(0, 4.5, 0), new THREE.MeshStandardMaterial({ color: 0xbfefff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false }));
    crust.renderOrder = 3;
    crust.position.copy(st.position);
    crust.rotation.copy(st.rotation);
    this.add(crust);
    const icicles: Item[] = [];
    for (let i = 0; i < 26; i++) {
      const lx = -9 + rnd() * 18;
      const lz = rnd() < 0.5 ? 5.6 : -5.6;
      const v = new THREE.Vector3(lx, 8, lz).applyMatrix4(st.matrix);
      icicles.push({ x: v.x, y: 8, z: v.z, ry: 0, rx: Math.PI, sx: 0.22 + rnd() * 0.2, sy: 0.8 + rnd() * 1.8, sz: 0.22 + rnd() * 0.2 });
    }
    // antenna masts with blinking red beacons
    const masts: [number, number, number][] = [[-58, -66, 34], [84, -44, 28], [-88, 34, 24], [70, 70, 26]];
    const mastItems: Item[] = masts.map(([x, z, h]) => ({ x, y: 0, z, ry: rnd() * 6, sx: 1, sy: h / 30, sz: 1 }));
    this.inst(latticeMast(30, 1.6), this.std(0xd8dee6, { metalness: 0.5, roughness: 0.45 }), mastItems, true);
    const beacon = this.emissive(0xff2a2a, 2.4, { speed: 3.1 });
    this.inst(new THREE.SphereGeometry(0.5, 10, 8), beacon, masts.map(([x, z, h]) => ({ x, y: h + 0.4, z, ry: 0, sx: 1, sy: 1, sz: 1 })));
    for (const [x, z, h] of masts) this.glowSprite(0xff3a3a, 0.7, 5, x, h + 0.4, z, 3.1);

    // frozen server racks: rows of dark cabinets with LED panels, sealed in ice
    const racks: Item[] = [];
    const leds: Item[] = [];
    const shells: Item[] = [];
    const rows: [number, number, number][] = [[58, -66, 0.6], [-56, 66, 2.3], [88, 12, -1.4], [-90, -8, 1.6], [30, 86, 0.2]];
    for (const [cx, cz, ry] of rows) {
      const n = 4 + ((rnd() * 3) | 0);
      const c = Math.cos(ry);
      const s = Math.sin(ry);
      for (let i = 0; i < n; i++) {
        const along = (i - (n - 1) / 2) * 1.05;
        const x = cx + c * along;
        const z = cz - s * along;
        const tilt = (rnd() - 0.5) * 0.12;
        racks.push({ x, y: G - 0.3, z, ry, rz: tilt, sx: 1, sy: 1, sz: 1, color: rnd() < 0.2 ? 0x2a3a4a : 0x1a222c });
        for (let k = 0; k < 5; k++) leds.push({ x: x + s * 0.56, y: G + 0.15 + k * 0.42, z: z + c * 0.56, ry, sx: 1, sy: 1, sz: 1, color: rnd() < 0.7 ? 0x4dffb0 : 0x5fd8ff });
      }
      shells.push({ x: cx, y: G - 0.4, z: cz, ry, sx: n * 1.05 + 1.2, sy: 3.2, sz: 2.2 });
      for (let k = 0; k < 8; k++) icicles.push({ x: cx + c * (rnd() - 0.5) * n, y: G + 2.8, z: cz - s * (rnd() - 0.5) * n, ry: 0, rx: Math.PI, sx: 0.2, sy: 0.6 + rnd(), sz: 0.2 });
    }
    this.inst(new THREE.BoxGeometry(0.95, 2.4, 1.05).translate(0, 1.2, 0), this.std(0xffffff, { roughness: 0.5, metalness: 0.4 }), racks, true);
    this.inst(new THREE.BoxGeometry(0.7, 0.08, 0.04), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), leds);
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xc8f2ff, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false });
    const sh = this.inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), shellMat, shells);
    if (sh) sh.renderOrder = 3;
    this.inst(new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xd8f6ff, roughness: 0.15, transparent: true, opacity: 0.85 }), icicles);
    // two big ground dishes listening north
    for (const [x, z] of [[38, -84], [-34, -88]] as [number, number][]) {
      this.bake(new THREE.CylinderGeometry(0.8, 1.4, 6, 8).translate(0, 3, 0), M.makeTranslation(x, 0, z), steel, true);
      this.bake(new THREE.SphereGeometry(6, 20, 8, 0, Math.PI * 2, 0, 0.85).rotateX(Math.PI).rotateX(-0.9), M.makeTranslation(x, 8.5, z), this.std(0xf0f4f8, { roughness: 0.45, side: THREE.DoubleSide }), true);
    }
  }

  /* ---------- biome: Inferno Quarry (basalt terraces, lava falls, ash) ---------- */

  private buildQuarry(G: number): void {
    const rnd = this.rnd;
    const M = new THREE.Matrix4();
    // stepped quarry terraces ringing the arena: you fight at the bottom of the pit
    const R0 = 56;
    const STEP_R = 6.5;
    const STEP_H = 2.6;
    const STEPS = 7;
    const pts: THREE.Vector2[] = [new THREE.Vector2(R0, -1)];
    for (let i = 0; i < STEPS; i++) {
      const r = R0 + i * STEP_R;
      pts.push(new THREE.Vector2(r, (i + 1) * STEP_H), new THREE.Vector2(r + STEP_R - 0.6, (i + 1) * STEP_H));
    }
    pts.push(new THREE.Vector2(R0 + STEPS * STEP_R + 4, STEPS * STEP_H + 1), new THREE.Vector2(R0 + STEPS * STEP_R + 8, -1));
    const rock = this.std(0x2c2422, { roughness: 0.95 });
    const terr = new THREE.Mesh(new THREE.LatheGeometry(pts, 64), rock);
    terr.receiveShadow = true;
    this.add(terr);
    // glowing seams along every step edge (one merged draw)
    const seams: THREE.BufferGeometry[] = [];
    for (let i = 0; i < STEPS; i++) seams.push(new THREE.TorusGeometry(R0 + i * STEP_R + 0.05, 0.14, 4, 96).rotateX(Math.PI / 2).translate(0, (i + 1) * STEP_H - 0.25, 0));
    this.bake(merge(seams), M.identity(), this.emissive(0xff5a14, 1.8, { speed: 1.2 }));
    const stepY = (r: number) => (r < R0 ? 0 : Math.min(STEPS, Math.floor((r - R0) / STEP_R) + 1) * STEP_H);

    // lava falls pouring down the terraces into pools at the bottom
    const lava = getLavaMaterial();
    const fallAngles = [0.55, 1.9, 2.6, 4.1, 5.3];
    for (const a of fallAngles) {
      const sx = Math.sin(a);
      const sz = Math.cos(a);
      const w = 3 + rnd() * 2;
      const top = (STEPS - 1) * STEP_R;
      const g = new THREE.PlaneGeometry(w, Math.hypot(top, STEPS * STEP_H), 1, 8);
      const tilt = Math.atan2(top, STEPS * STEP_H);
      g.rotateX(-tilt);
      g.translate(0, (STEPS * STEP_H) / 2 + 0.3, -(R0 + top / 2 - 0.3));
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 12, uv.getX(i) * 2 - 1);
      g.rotateY(Math.atan2(-sx, -sz));
      this.bake(g, M.identity(), lava);
      const pool = new THREE.CircleGeometry(3.2 + rnd(), 18).rotateX(-Math.PI / 2);
      this.bake(pool, M.makeTranslation(sx * (R0 - 2.6), 0.08, sz * (R0 - 2.6)), lava);
      this.glowSprite(0xff6a1a, 0.55, 10, sx * (R0 - 2), 2, sz * (R0 - 2), 1.6);
    }

    // basalt column clusters on the ledges and around the pit floor
    const cols: Item[] = [];
    for (const p of this.scatter(26, 48, 100)) {
      const r = Math.hypot(p.x, p.z);
      const y0 = stepY(r);
      const n = 3 + ((rnd() * 5) | 0);
      for (let k = 0; k < n; k++) {
        const s = 0.6 + rnd() * 0.7;
        const h = 1.5 + rnd() * (r > 80 ? 9 : 5);
        cols.push({ x: p.x + (rnd() - 0.5) * 3, y: y0 - 0.3, z: p.z + (rnd() - 0.5) * 3, ry: rnd(), sx: s, sy: h, sz: s, color: rnd() < 0.5 ? 0x2a2523 : 0x37302d });
      }
    }
    this.inst(new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0), this.std(0xffffff, { roughness: 0.85 }), cols, true);
    // glowing cracks on the pit floor between the stands and the terraces
    const cracks: Item[] = this.scatter(26, 48, 55).map((p) => ({ x: p.x, y: 0.07, z: p.z, ry: rnd() * 6, sx: 0.25 + rnd() * 0.2, sy: 1, sz: 3 + rnd() * 5 }));
    this.inst(new THREE.BoxGeometry(1, 0.05, 1), this.emissive(0xff6a1a, 1.6, { speed: 2.2 }), cracks);

    // BULLDOZA's dig site: a rusty excavator + dump truck on a ledge (north-east)
    const yel = this.std(0xd18a1e, { roughness: 0.7, metalness: 0.3 });
    const dark = this.std(0x1e1a18, { roughness: 0.8 });
    const ex = new THREE.Object3D();
    ex.position.set(64, stepY(Math.hypot(64, -58)), -58);
    ex.rotation.y = 2.3;
    ex.updateMatrix();
    const xb = (geo: THREE.BufferGeometry, mat: THREE.Material) => this.bake(geo, ex.matrix, mat, true);
    xb(new THREE.BoxGeometry(5, 1.4, 7).translate(0, 0.7, 0), dark);
    xb(new THREE.BoxGeometry(4.2, 2.6, 4.6).translate(0, 2.7, -0.6), yel);
    xb(new THREE.BoxGeometry(2, 2, 2).translate(-1, 4.9, 0.6), yel);
    xb(new THREE.BoxGeometry(1, 1, 9).rotateX(-0.5).translate(1, 6, 5.2), yel);
    xb(new THREE.BoxGeometry(0.9, 0.9, 6).rotateX(0.7).translate(1, 6.4, 11), yel);
    xb(new THREE.BoxGeometry(2.4, 2, 1.6).translate(1, 3.4, 13), dark);
    const tr = new THREE.Object3D();
    tr.position.set(-70, stepY(Math.hypot(-70, -50)), -50);
    tr.rotation.y = -0.6;
    tr.updateMatrix();
    const tb = (geo: THREE.BufferGeometry, mat: THREE.Material) => this.bake(geo, tr.matrix, mat, true);
    tb(new THREE.BoxGeometry(5.5, 3.2, 8).translate(0, 3.6, -1), yel);
    tb(new THREE.BoxGeometry(4.6, 2.8, 3).translate(0, 3.2, 4.4), yel);
    for (const wx of [-2.6, 2.6]) for (const wz of [-3.5, 0, 4.4]) tb(new THREE.CylinderGeometry(1.1, 1.1, 0.9, 10).rotateZ(Math.PI / 2).translate(wx, 1.1, wz), dark);

    // smoke plumes off the rim and the lava pools
    const stacks: Puff[] = [];
    for (let i = 0; i < 6; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 62 + rnd() * 35;
      stacks.push({ x: Math.sin(a) * r, y: stepY(r), z: Math.cos(a) * r, r: 2.4 + rnd() * 1.5, rise: 22, drift: 12 });
    }
    for (const a of fallAngles.slice(0, 3)) stacks.push({ x: Math.sin(a) * (R0 - 2.6), y: 0, z: Math.cos(a) * (R0 - 2.6), r: 1.6, rise: 12, drift: 5 });
    this.addPuffs(stacks, 0x3a2e2c, 0.55);
  }

  /* ---------- biome: Rust Basin (mesas, dunes, the drill rig) ---------- */

  private buildMars(G: number): void {
    const rnd = this.rnd;
    const M = new THREE.Matrix4();
    // banded buttes: a wide base and a narrower cap, two rust tones
    const tones = [0xa8532e, 0xc06a3e, 0x8e4428, 0xb85f34];
    const bases: Item[] = [];
    const caps: Item[] = [];
    for (const p of this.scatter(18, 58, 125, true)) {
      const r = 5 + rnd() * 9;
      const h = 8 + rnd() * 18;
      const ry = rnd() * 6;
      bases.push({ x: p.x, y: 0, z: p.z, ry, sx: r, sy: h * 0.62, sz: r * (0.8 + rnd() * 0.4), color: tones[(rnd() * tones.length) | 0] });
      caps.push({ x: p.x, y: h * 0.62 - 0.1, z: p.z, ry, sx: r * 0.82, sy: h * 0.38, sz: r * 0.7, color: tones[(rnd() * tones.length) | 0] });
    }
    for (const p of this.scatter(12, 48, 75)) {
      const r = 1.6 + rnd() * 2.2;
      const h = 2 + rnd() * 4;
      bases.push({ x: p.x, y: G - 0.3, z: p.z, ry: rnd() * 6, sx: r, sy: h, sz: r * 0.9, color: tones[(rnd() * tones.length) | 0] });
    }
    const buttes = this.inst(new THREE.CylinderGeometry(0.88, 1, 1, 7).translate(0, 0.5, 0), this.std(0xffffff, { roughness: 0.95 }), [...bases, ...caps], true);
    if (buttes) buttes.renderOrder = 0;
    // scattered boulders
    const rocks: Item[] = this.scatter(70, 48, 110).map((p) => {
      const s = 0.5 + rnd() * 1.8;
      return { x: p.x, y: G - s * 0.2, z: p.z, ry: rnd() * 6, rx: rnd(), sx: s * (1 + rnd() * 0.5), sy: s * 0.7, sz: s, color: tones[(rnd() * tones.length) | 0] };
    });
    this.inst(new THREE.DodecahedronGeometry(1, 0), this.std(0xffffff, { roughness: 0.9 }), rocks, true);
    // crater rims out on the plain
    const rims: Item[] = this.scatter(8, 52, 105).map((p) => {
      const s = 4 + rnd() * 6;
      return { x: p.x, y: G - 0.25, z: p.z, ry: 0, rx: Math.PI / 2, sx: s, sy: s, sz: 1.2 };
    });
    this.inst(new THREE.TorusGeometry(1, 0.22, 5, 18), this.std(0xb4643a, { roughness: 0.95 }), rims, false, true);

    // THE GRINDER's drill rig (north-east): lattice derrick, spinning bit, dust plume
    const rx = 66;
    const rz = -66;
    this.inst(latticeMast(28, 3), this.std(0xd8d2c8, { metalness: 0.4, roughness: 0.5 }), [{ x: rx, y: 0, z: rz, ry: 0.4, sx: 1, sy: 1, sz: 1 }], true);
    this.bake(new THREE.BoxGeometry(9, 2, 9).translate(0, 1, 0), M.makeTranslation(rx, 0, rz), this.std(0x4a4f58, { metalness: 0.5 }), true);
    const drill = new THREE.Group();
    drill.position.set(rx, 2, rz);
    drill.rotation.x = -Math.PI / 2;
    const bitMat = this.std(0xff8a3d, { metalness: 0.6, roughness: 0.35, emissive: 0x401800, emissiveIntensity: 0.6 });
    const bit = new THREE.Mesh(merge([
      new THREE.CylinderGeometry(0.7, 0.7, 20, 8).rotateX(Math.PI / 2).translate(0, 0, 10),
      new THREE.ConeGeometry(2.2, 4, 6).rotateX(-Math.PI / 2).translate(0, 0, -1.5),
      new THREE.TorusGeometry(1.8, 0.35, 5, 12).translate(0, 0, 3),
      new THREE.TorusGeometry(1.4, 0.3, 5, 12).translate(0, 0, 6),
    ]), bitMat);
    bit.castShadow = true;
    drill.add(bit);
    this.add(drill);
    this.spinners.push({ obj: bit, speed: 2.4 });
    this.glowSprite(0xffa040, 0.8, 4, rx, 29, rz, 2.5);
    // habitat: white domes, a tube and solar arrays (south-west)
    const hx = -70;
    const hz = 50;
    const hab = this.std(0xeee8dc, { roughness: 0.55 });
    for (const [dx, dz, r] of [[0, 0, 6], [10, 4, 4], [-6, 9, 3.5]] as [number, number, number][]) {
      this.bake(new THREE.SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.makeTranslation(hx + dx, 0, hz + dz), hab, true);
      this.bake(new THREE.TorusGeometry(r * 0.98, 0.18, 4, 24).rotateX(Math.PI / 2), M.makeTranslation(hx + dx, r * 0.35, hz + dz), this.emissive(0x7fd8ff, 1.2, { speed: 0.7 }));
    }
    this.bake(new THREE.CylinderGeometry(1.1, 1.1, 10, 10).rotateZ(Math.PI / 2).rotateY(-0.38), M.makeTranslation(hx + 5, 1.1, hz + 2), hab, true);
    const panels: Item[] = [];
    for (let i = 0; i < 8; i++) panels.push({ x: hx + 16 + (i % 4) * 3.4, y: 1.6, z: hz - 8 + Math.floor(i / 4) * 4, ry: 0.3, rx: -0.6, sx: 1, sy: 1, sz: 1 });
    this.inst(new THREE.BoxGeometry(3, 0.12, 2.2), this.std(0x1f3d78, { metalness: 0.6, roughness: 0.3, emissive: 0x0a1838, emissiveIntensity: 0.5 }), panels);
    // dust plumes off the drill and the dunes
    const stacks: Puff[] = [{ x: rx, y: 0, z: rz, r: 2.2, rise: 10, drift: 18 }];
    for (let i = 0; i < 4; i++) {
      const a = rnd() * Math.PI * 2;
      stacks.push({ x: Math.sin(a) * 90, y: 0, z: Math.cos(a) * 90, r: 3.5, rise: 8, drift: 26 });
    }
    this.addPuffs(stacks, 0xd09068, 0.35);
  }

  /* ---------- biome: The Thermal Divide (hot west, frozen east) ---------- */

  private buildDivide(G: number): void {
    const rnd = this.rnd;
    const M = new THREE.Matrix4();
    const lava = getLavaMaterial();
    // scorched basalt over the hot half of the world outside the field (the field's own half is GroundDecals'):
    // one U-shaped flat mesh around the west half of the arena, fading out toward the x = 0 divide line
    const h = (this.ctx.snow?.size ?? 2 * ARENA.maxX) / 2;
    const O = 240;
    const u = new THREE.Shape([
      new THREE.Vector2(-O, -O), new THREE.Vector2(0, -O), new THREE.Vector2(0, -h), new THREE.Vector2(-h, -h),
      new THREE.Vector2(-h, h), new THREE.Vector2(0, h), new THREE.Vector2(0, O), new THREE.Vector2(-O, O),
    ]);
    const skirt = new THREE.Mesh(new THREE.ShapeGeometry(u).rotateX(-Math.PI / 2).translate(0, G + 0.03, 0), scorchMaterial(-1, 0.62));
    skirt.matrixAutoUpdate = false;
    skirt.renderOrder = 1;
    this.decor!.add(skirt);
    // spires: red rock on the hot side, ice on the cold side
    const spires: Item[] = [];
    for (const p of this.scatter(60, 50, 125)) {
      const far = Math.hypot(p.x, p.z) > 78;
      const r = 1.4 + rnd() * (far ? 4.5 : 2);
      const h = (far ? 12 : 4) + rnd() * (far ? 22 : 8);
      const hot = p.x < 0;
      spires.push({ x: p.x, y: G - 0.6, z: p.z, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.25, rz: (rnd() - 0.5) * 0.25, sx: r, sy: h, sz: r * (0.7 + rnd() * 0.5), color: hot ? (rnd() < 0.5 ? 0x6e2618 : 0x8a3420) : rnd() < 0.5 ? 0xcdeefc : 0xa6d6f2 });
    }
    this.inst(new THREE.ConeGeometry(1, 1, 5, 1).translate(0, 0.5, 0), this.std(0xffffff, { roughness: 0.6, metalness: 0.05 }), spires, true);
    // hot side: lava pools and geysers venting steam
    const stacks: Puff[] = [];
    for (const p of this.scatter(14, 50, 100).filter((q) => q.x < -8)) {
      const r = 1.5 + rnd() * 2.5;
      this.bake(new THREE.CircleGeometry(r, 16).rotateX(-Math.PI / 2), M.makeTranslation(p.x, G + 0.06, p.z), lava);
      this.glowSprite(0xff6a1a, 0.5, r * 3.5, p.x, G + 1, p.z, 1.8);
      stacks.push({ x: p.x, y: G, z: p.z, r: 1 + r * 0.4, rise: 10 + rnd() * 6, drift: 4 });
    }
    // the arena's own lava vents steam too
    for (const pt of this.ctx.terrain.patches) {
      if (pt.material !== 'lava') continue;
      stacks.push({ x: pt.x2 !== undefined ? (pt.x + pt.x2) / 2 : pt.x, y: this.ctx.terrain.ground(pt.x, pt.z) + G * 0.5, z: pt.z2 !== undefined ? (pt.z + pt.z2) / 2 : pt.z, r: 0.9, rise: 7, drift: 2.5 });
    }
    this.addPuffs(stacks, 0xf4ece8, 0.42);
    // cold side: frozen pines and crystal clusters
    const pines: Item[] = this.scatter(80, 50, 120).filter((p) => p.x > 8).map((p) => {
      const s = 0.9 + rnd() * 1.2;
      return { x: p.x, y: G - 0.2, z: p.z, ry: rnd() * 6, sx: s, sy: s * (1 + rnd() * 0.4), sz: s };
    });
    this.inst(merge([
      new THREE.ConeGeometry(1.7, 2.4, 7).translate(0, 2.1, 0),
      new THREE.ConeGeometry(1.3, 2.0, 7).translate(0, 3.5, 0),
      new THREE.ConeGeometry(0.9, 1.7, 7).translate(0, 4.7, 0),
      new THREE.CylinderGeometry(0.22, 0.3, 1.4, 6).translate(0, 0.7, 0),
    ]), this.std(0xe8f4fb, { roughness: 0.75 }), pines);
    const crystals: Item[] = [];
    for (const p of this.scatter(16, 48, 90).filter((q) => q.x > 8)) {
      for (let k = 0; k < 3; k++) {
        const s = 0.4 + rnd() * 0.7;
        crystals.push({ x: p.x + (rnd() - 0.5) * 2, y: G + s, z: p.z + (rnd() - 0.5) * 2, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.7, rz: (rnd() - 0.5) * 0.7, sx: s, sy: s * 2.6, sz: s });
      }
    }
    this.inst(new THREE.OctahedronGeometry(1, 0), this.emissive(0x8ff0ff, 0.9, { speed: 1.4 }), crystals);
    // the Divide monolith far to the north: one half glowing magma, the other glowing ice
    const mz = -100;
    const hot = this.emissive(0xff4a10, 1.6, { speed: 0.9 });
    const cold = this.emissive(0x4fd8ff, 1.6, { speed: 0.9, phase: 3 });
    hot.fog = cold.fog = false;
    this.bake(new THREE.BoxGeometry(5, 46, 6).translate(-2.5, 23, 0), M.makeTranslation(0, 0, mz), hot);
    this.bake(new THREE.BoxGeometry(5, 46, 6).translate(2.5, 23, 0), M.makeTranslation(0, 0, mz), cold);
    const capMat = this.std(0x1a1620, { roughness: 0.6, fog: false });
    this.bake(new THREE.BoxGeometry(12, 3, 9).translate(0, 1.5, 0), M.makeTranslation(0, 0, mz), capMat);
    this.bake(new THREE.ConeGeometry(4.6, 8, 4).rotateY(Math.PI / 4).translate(0, 50, 0), M.makeTranslation(0, 0, mz), capMat);
    this.glowSprite(0xff6a2a, 0.55, 26, -6, 30, mz, 1.1).material.fog = false;
    this.glowSprite(0x5fd8ff, 0.55, 26, 6, 30, mz, 1.3).material.fog = false;
  }

  /* ---------- biome: Golden Tower Plaza summer dressing ---------- */

  private buildSummer(): void {
    const rnd = this.rnd;
    // leafy trees around the plaza
    const trees: Item[] = this.scatter(70, 52, 120).filter((p) => !(p.z > 30 && Math.abs(p.x) < 60 && Math.hypot(p.x, p.z) > 80)).map((p) => {
      const s = 1 + rnd() * 1.1;
      return { x: p.x, y: 0, z: p.z, ry: rnd() * 6, sx: s, sy: s * (0.9 + rnd() * 0.3), sz: s, color: [0x3f8f3a, 0x4fa043, 0x357a32, 0x5aa84a][(rnd() * 4) | 0] };
    });
    this.inst(merge([
      colored(new THREE.CylinderGeometry(0.28, 0.38, 2.6, 6).translate(0, 1.3, 0).toNonIndexed(), 0x6b4428),
      colored(new THREE.IcosahedronGeometry(1.9, 0).translate(0, 3.9, 0), 0xffffff),
      colored(new THREE.IcosahedronGeometry(1.3, 0).translate(0.9, 4.9, 0.3), 0xffffff),
    ]), this.std(0xffffff, { vertexColors: true, roughness: 0.8 }), trees, true);
    // red / white / blue balloon bunches tied above the stands
    const balloons: Item[] = [];
    const strings: Item[] = [];
    for (const side of SIDES) {
      if (side.key === 's') continue;
      for (let k = 0; k < 6; k++) {
        const s = ARENA.minX + 4 + k * ((ARENA.maxX - ARENA.minX - 8) / 5);
        if (side.key === 'n' && Math.abs(s) < STAGE_HALF + 2) continue;
        const [x, z] = side.map(s, STAND_N0 + ROWS * ROW_D + 0.2);
        const top = this.zone.snowDepth + 0.25 + ROWS * ROW_RISE + 5.5;
        for (let b = 0; b < 5; b++) {
          const col = [0xc8102e, 0xffffff, 0x1f3b8c, 0xf2c033][(rnd() * 4) | 0];
          balloons.push({ x: x + (rnd() - 0.5) * 1.4, y: top + rnd() * 1.4, z: z + (rnd() - 0.5) * 1.4, ry: 0, sx: 0.55, sy: 0.68, sz: 0.55, color: col });
        }
        strings.push({ x, y: top - 3.6, z, ry: 0, sx: 1, sy: 1, sz: 1 });
      }
    }
    this.inst(new THREE.SphereGeometry(1, 10, 8), this.std(0xffffff, { roughness: 0.3, metalness: 0.1 }), balloons);
    this.inst(new THREE.CylinderGeometry(0.015, 0.015, 3.8, 3).translate(0, 1.9, 0), this.std(0xdddddd), strings);
  }

  /** Smoke / steam columns animated in update() (one instanced draw). */
  private addPuffs(stacks: Puff[], color: number, opacity: number): void {
    const per = 7;
    const puffMat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity, depthWrite: false });
    const puffMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), puffMat, stacks.length * per);
    puffMesh.frustumCulled = false;
    this.add(puffMesh);
    this.puffs = { mesh: puffMesh, stacks, per };
  }

  /* ---------- theme: Golden Tower Plaza (THE DONALD's rally) ---------- */

  /** One shared material for every crowd sign and wall banner (the slogan atlas). */
  private signMaterial(): THREE.MeshStandardMaterial {
    return (this.signMat ??= this.std(0xffffff, { map: getSignAtlas(), roughness: 0.7, side: THREE.DoubleSide, flatShading: false, emissive: 0xffffff, emissiveMap: getSignAtlas(), emissiveIntensity: 0.18 }));
  }

  /** Bake slogan planes (w x h) into the zone batch; `sticks` adds a handle under each (crowd signs). */
  private bakeSigns(signs: { x: number; y: number; z: number; ry: number; i: number }[], w: number, h: number, sticks: boolean): void {
    if (signs.length === 0) return;
    const mat = this.signMaterial();
    const geos = new Map<number, THREE.BufferGeometry>();
    const stick = new THREE.BoxGeometry(0.05, 0.75, 0.05).translate(0, -h / 2 - 0.3, -0.02);
    const stickMat = this.std(0xd8c9a8, { roughness: 0.8 });
    for (const sg of signs) {
      let g = geos.get(sg.i);
      if (!g) geos.set(sg.i, (g = signPlane(w, h, sg.i)));
      const m = this.itemMatrix({ x: sg.x, y: sg.y, z: sg.z, ry: sg.ry, rx: -0.12, sx: 1, sy: 1, sz: 1 });
      this.bake(g, m, mat);
      if (sticks) this.bake(stick, m, stickMat);
    }
    for (const g of geos.values()) g.dispose();
    stick.dispose();
  }

  private buildRally(G: number): void {
    const rnd = this.rnd;
    const st = this.style;
    const navy = this.std(0x1f3b8c, { roughness: 0.6 });
    const gold = this.std(0xe8b423, { roughness: 0.35, metalness: 0.35, emissive: 0x4a3000, emissiveIntensity: 0.35 });
    const white = this.std(0xf6f3ea, { roughness: 0.6 });
    const M = new THREE.Matrix4();
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material, cast = true) =>
      this.bake(new THREE.BoxGeometry(w, h, d), M.makeTranslation(x, y, z), mat, cast, cast);
    const W = STAGE_HALF * 2;
    const zMid = (STAGE_Z0 + STAGE_Z1) / 2;
    const depth = STAGE_Z0 - STAGE_Z1;

    // ---- THE STAGE (behind the north wall, over the boss gate's tunnel)
    const open = GATE_HALF + 0.9;
    for (const sx of [-1, 1]) box(STAGE_HALF - open, STAGE_Y, 0.4, sx * (open + (STAGE_HALF - open) / 2), STAGE_Y / 2, STAGE_Z0, navy);
    box(open * 2, 0.55, 0.4, 0, STAGE_Y - 0.28, STAGE_Z0, navy);
    box(W, 0.35, depth, 0, STAGE_Y - 0.175, zMid, white);
    box(W + 0.2, 0.2, 0.3, 0, STAGE_Y, STAGE_Z0 + 0.05, gold, false);
    // bunting along the stage front
    const bunting = this.std(0xffffff, { map: getBuntingTex(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75, flatShading: false });
    const swag = (len: number, h: number, per: number) => {
      const g = new THREE.PlaneGeometry(len, h).translate(0, -h / 2, 0);
      const uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * Math.max(1, Math.round(len / per)));
      return g;
    };
    this.bake(swag(W, 1.3, 2.9), M.makeTranslation(0, STAGE_Y - 0.12, STAGE_Z0 + 0.24), bunting);
    // red carpet up the stage to the podium
    const carpetMat = this.std(0xffffff, { map: getCarpetTex(), roughness: 0.9, flatShading: false });
    const deckCarpet = new THREE.PlaneGeometry(3, depth - 0.6).rotateX(-Math.PI / 2);
    const duv = deckCarpet.getAttribute('uv');
    for (let i = 0; i < duv.count; i++) duv.setY(i, duv.getY(i) * 3);
    this.bake(deckCarpet, M.makeTranslation(0, STAGE_Y + 0.012, zMid), carpetMat, false, true);
    // the podium: navy lectern, gold top + seal, red / white band, two microphones
    const pz = STAGE_Z0 - 2.2;
    box(1.7, 1.6, 0.9, 0, STAGE_Y + 0.8, pz, navy);
    box(1.95, 0.14, 1.1, 0, STAGE_Y + 1.66, pz - 0.03, gold);
    box(1.72, 0.2, 0.04, 0, STAGE_Y + 0.42, pz + 0.46, this.std(0xc8102e, { roughness: 0.6 }), false);
    box(1.72, 0.1, 0.045, 0, STAGE_Y + 0.58, pz + 0.46, white, false);
    this.bake(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 24).rotateX(Math.PI / 2), M.makeTranslation(0, STAGE_Y + 1.08, pz + 0.47), gold);
    for (const sx of [-1, 1]) {
      this.bake(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6).rotateX(0.5), M.makeTranslation(sx * 0.22, STAGE_Y + 1.98, pz + 0.18), this.std(0x15161a));
      this.bake(new THREE.SphereGeometry(0.08, 8, 6), M.makeTranslation(sx * 0.22, STAGE_Y + 2.3, pz + 0.34), this.std(0x15161a));
    }
    // backdrop: navy wall + the giant gold "THE DONALD" banner, gold posts at both ends
    const bw = W + 5;
    const bh = (bw * 820) / 2048;
    const by = STAGE_Y + 0.6 + bh / 2;
    box(bw + 1, bh + 1.2, 0.5, 0, by, STAGE_Z1 - 0.35, navy);
    const bdTex = getBackdropTex();
    const bdMat = new THREE.MeshStandardMaterial({ map: bdTex, emissive: 0xffffff, emissiveMap: bdTex, emissiveIntensity: 0.32, roughness: 0.6 });
    this.bake(new THREE.PlaneGeometry(bw, bh), M.makeTranslation(0, by, STAGE_Z1 - 0.08), bdMat);
    const postH = by + bh / 2 + 1.6;
    for (const sx of [-1, 1]) {
      box(1.1, postH, 1.1, sx * (bw / 2 + 1.0), postH / 2, STAGE_Z1 - 0.35, gold);
      this.bake(new THREE.SphereGeometry(0.75, 12, 8), M.makeTranslation(sx * (bw / 2 + 1.0), postH + 0.6, STAGE_Z1 - 0.35), gold);
    }

    // ---- flags: a row along the back of the stage, giant ones on the backdrop posts
    const flagMat = this.std(0xffffff, { map: getUsFlagTex(), side: THREE.DoubleSide, roughness: 0.75, flatShading: false });
    const flagItems: Item[] = [];
    const poleItems: Item[] = [];
    for (let i = 0; i < 9; i++) {
      const x = -STAGE_HALF + 1.2 + (i * (W - 2.4)) / 8;
      if (Math.abs(x) < 2.6) continue; // keep the podium sightline clear
      const z = STAGE_Z1 + 1.0;
      poleItems.push({ x, y: STAGE_Y, z, ry: 0, sx: 1, sy: 1.9, sz: 1 });
      flagItems.push({ x, y: STAGE_Y + 5.1, z, ry: (rnd() - 0.5) * 0.5, sx: 1.25, sy: 1.25, sz: 1.25 });
    }
    for (const sx of [-1, 1]) flagItems.push({ x: sx * (bw / 2 + 1.0), y: postH - 2.2, z: STAGE_Z1 + 0.4, ry: sx < 0 ? 0.1 : Math.PI - 0.1, sx: 3.2, sy: 3.2, sz: 3.2 });
    // flags lining the south (camera-side) dressing too
    for (let i = 0; i < 9; i++) {
      const x = ARENA.minX + 3 + i * ((ARENA.maxX - ARENA.minX - 6) / 8);
      const z = ARENA.maxZ + WALL_C + 0.8;
      poleItems.push({ x, y: G - 0.2, z, ry: 0, sx: 1, sy: 1.5, sz: 1 });
      flagItems.push({ x, y: G - 0.2 + 3.9, z, ry: Math.PI + (rnd() - 0.5) * 0.5, sx: 1.1, sy: 1.1, sz: 1.1 });
    }
    this.inst(wavyFlag(1.6, 0.85), flagMat, flagItems);
    this.inst(new THREE.CylinderGeometry(0.05, 0.05, 3, 6).translate(0, 1.5, 0), gold, poleItems);

    // ---- warm stage lights: gold truss towers with lamp heads, glows and soft light cones onto the podium
    const lamp = new THREE.MeshBasicMaterial({ color: st.lamp, toneMapped: false });
    const coneMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    for (const sx of [-1, 1]) {
      const tx = sx * (STAGE_HALF - 0.6);
      const tz = STAGE_Z0 - 0.7;
      const th = 8.5;
      for (const ox of [-0.3, 0.3]) for (const oz of [-0.3, 0.3]) box(0.12, th, 0.12, tx + ox, STAGE_Y + th / 2, tz + oz, gold, false);
      for (let y = 1; y < th; y += 1.4) box(0.7, 0.08, 0.7, tx, STAGE_Y + y, tz, gold, false);
      const hy = STAGE_Y + th + 0.3;
      box(1.0, 0.6, 0.6, tx, hy, tz, this.std(0x2a2a30, { metalness: 0.5 }));
      this.bake(new THREE.PlaneGeometry(0.8, 0.45), M.makeTranslation(tx, hy, tz + 0.31), lamp);
      this.glowSprite(st.lamp, 0.85, 4.5, tx, hy, tz + 0.6, 2.2);
      // light cone from the lamp to the podium
      const dx = 0 - tx;
      const dy = STAGE_Y + 1 - hy;
      const dz = pz - tz;
      const len = Math.hypot(dx, dy, dz);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.0, len, 20, 1, true).translate(0, -len / 2, 0), coneMat);
      cone.position.set(tx, hy, tz);
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(dx, dy, dz).normalize());
      cone.renderOrder = 6;
      this.add(cone);
    }
    this.pulses.push({ mat: coneMat, base: 0.1, speed: 1.7, phase: 0 });

    // ---- red / white / blue bunting along every wall, slogan banners on the inner faces
    for (const side of SIDES) {
      const runs = subtract(side.s0, side.s1, gapsFor(side.key, GATE_HALF + PILLAR_W));
      const h = side.key === 's' ? 0.45 : 0.6;
      for (const [a, b] of runs) {
        const len = b - a;
        if (len < 1.5) continue;
        const [x, z] = side.map((a + b) / 2, WALL_IN - 0.14);
        this.bake(swag(len, h, 2.6), this.itemMatrix({ x, y: side.h - 0.02, z, ry: side.yaw, sx: 1, sy: 1, sz: 1 }), bunting);
      }
    }
    const banners: { x: number; y: number; z: number; ry: number; i: number }[] = [];
    let bi = 0;
    for (const side of SIDES) {
      if (side.key === 's') continue;
      const spots = side.key === 'n' ? [-20, 20] : [-23, 6, 20];
      for (const sc of spots) {
        const [x, z] = side.map(sc, WALL_IN - 0.12);
        banners.push({ x, y: 1.32, z, ry: side.yaw, i: bi++ });
      }
    }
    this.bakeSigns(banners, 4.6, 1.15, false);

    // ---- the red carpet up the middle of the arena (draped over the snow every frame)
    this.buildCarpet();

    // ---- THE GOLD TOWER, far to the north-east, plus a cream skyline (fog-free so it looms on the horizon)
    const towerGold = this.std(new THREE.Color(0xd9a520).lerp(new THREE.Color(this.zone.fogColor), 0.15).getHex(), { roughness: 0.4, metalness: 0.2, emissive: 0x3a2400, emissiveIntensity: 0.6, fog: false });
    const tM = (x: number, y: number, z: number) => M.makeTranslation(GOLD_TOWER_X + x, y, GOLD_TOWER_Z + z);
    this.bake(new THREE.BoxGeometry(30, 12, 30).translate(0, 6, 0), tM(0, 0, 0), towerGold);
    this.bake(new THREE.BoxGeometry(18, 80, 18).translate(0, 40, 0), tM(0, 12, 0), towerGold);
    this.bake(new THREE.BoxGeometry(13, 18, 13).translate(0, 9, 0), tM(0, 92, 0), towerGold);
    this.bake(new THREE.BoxGeometry(8, 10, 8).translate(0, 5, 0), tM(0, 110, 0), towerGold);
    this.bake(new THREE.ConeGeometry(2.5, 16, 8).translate(0, 8, 0), tM(0, 120, 0), towerGold);
    const winMat = this.emissive(0xffe4a0, 1.3, { speed: 0.7 });
    winMat.fog = false;
    const bands: Item[] = [];
    for (let y = 16; y < 90; y += 4.2) bands.push({ x: GOLD_TOWER_X, y, z: GOLD_TOWER_Z, ry: 0, sx: 18.2, sy: 0.9, sz: 18.2 });
    for (let y = 95; y < 108; y += 4) bands.push({ x: GOLD_TOWER_X, y, z: GOLD_TOWER_Z, ry: 0, sx: 13.2, sy: 0.8, sz: 13.2 });
    this.inst(new THREE.BoxGeometry(1, 1, 1), winMat, bands);
    this.glowSprite(0xffd257, 0.9, 30, GOLD_TOWER_X, 128, GOLD_TOWER_Z, 1.2).material.fog = false;
    const cream = this.std(new THREE.Color(0xf1e6cf).lerp(new THREE.Color(this.zone.fogColor), 0.35).getHex(), { roughness: 0.7, fog: false });
    const blocks: Item[] = [];
    const goldBands: Item[] = [];
    for (const p of this.scatter(14, 80, 125, true)) {
      if (p.z > 30 && Math.abs(p.x) < 60) continue;
      if (Math.hypot(p.x - GOLD_TOWER_X, p.z - GOLD_TOWER_Z) < 30) continue;
      const w = 10 + rnd() * 12;
      const d = 10 + rnd() * 12;
      const h = 14 + rnd() * 30;
      const ry = Math.atan2(-p.x, -p.z);
      blocks.push({ x: p.x, y: 0, z: p.z, ry, sx: w, sy: h, sz: d });
      goldBands.push({ x: p.x, y: h - 1.2, z: p.z, ry, sx: w + 0.2, sy: 0.8, sz: d + 0.2 });
    }
    this.inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), cream, blocks);
    this.inst(new THREE.BoxGeometry(1, 1, 1), this.emissive(0xf2c033, 0.8), goldBands);
  }

  /** The arena's red carpet: a 3 m strip from the south wall to the boss gate, re-draped over the snow. */
  private buildCarpet(): void {
    // 3 columns x 121 rows (~0.5 m, the snow grid's scale) so plowed bumps don't poke through
    const nv = 121;
    const nu = 3;
    const pos = new THREE.BufferAttribute(new Float32Array(nv * nu * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    const uv = new Float32Array(nv * nu * 2);
    const nrm = new Float32Array(nv * nu * 3);
    const idx: number[] = [];
    const z0 = ARENA.maxZ - 0.3;
    const z1 = ARENA.minZ + 0.3;
    for (let v = 0; v < nv; v++) {
      const z = z0 + ((z1 - z0) * v) / (nv - 1);
      for (let u = 0; u < nu; u++) {
        const i = v * nu + u;
        pos.setXYZ(i, -1.5 + (3 * u) / (nu - 1), 0, z);
        uv[i * 2] = u / (nu - 1);
        uv[i * 2 + 1] = (z0 - z) / 3;
        nrm[i * 3 + 1] = 1;
      }
      if (v < nv - 1)
        for (let u = 0; u < nu - 1; u++) {
          const a = v * nu + u;
          idx.push(a, a + 1, a + nu, a + 1, a + nu + 1, a + nu);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', pos);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ map: getCarpetTex(), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    this.add(mesh);
    this.carpet = { mesh, pos, nv: nv * nu };
    this.drapeCarpet();
  }

  private drapeCarpet(): void {
    const c = this.carpet!;
    const snow = this.ctx.snow;
    const a = c.pos.array as Float32Array;
    for (let i = 0; i < c.nv; i++) {
      const x = a[i * 3];
      const z = a[i * 3 + 2];
      a[i * 3 + 1] = (snow ? snow.getDepth(x, z) : 0) + 0.06;
    }
    c.pos.needsUpdate = true;
  }

  /* ---------- theme: Omega Summit (factory at the top of the world) ---------- */

  private buildSummit(G: number, snowMat: THREE.Material): void {
    const rnd = this.rnd;
    const st = this.style;
    // jagged spires
    const spireGeo = new THREE.ConeGeometry(1, 1, 5, 1).translate(0, 0.5, 0);
    const spires: Item[] = this.scatter(55, 50, 125).map((p) => {
      const far = Math.hypot(p.x, p.z) > 76;
      const r = 1.5 + rnd() * (far ? 5 : 2.5);
      const h = (far ? 14 : 5) + rnd() * (far ? 26 : 9);
      return { x: p.x, y: G - 0.5, z: p.z, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.2, rz: (rnd() - 0.5) * 0.2, sx: r, sy: h, sz: r * (0.7 + rnd() * 0.5) };
    });
    this.inst(spireGeo, this.std(st.rock, { roughness: 0.9 }), spires);
    this.inst(spireGeo.clone(), snowMat, spires.map((s) => ({ ...s, y: s.y + s.sy * 0.7 - 0.05, sx: s.sx * 0.31, sy: s.sy * 0.305, sz: s.sz * 0.31 })));

    // factory blocks with glowing window bands
    const blocks: Item[] = [];
    const bands: Item[] = [];
    for (const p of this.scatter(12, 72, 115, true)) {
      if (p.z > 40 && Math.abs(p.x) < 50) continue;
      if (Math.hypot(p.x - CORE_X, p.z - CORE_Z) < 26) continue; // core tower
      const w = 10 + rnd() * 14;
      const d = 10 + rnd() * 12;
      const h = 10 + rnd() * 18;
      const ry = Math.atan2(-p.x, -p.z);
      blocks.push({ x: p.x, y: 0, z: p.z, ry, sx: w, sy: h, sz: d });
      for (let y = 4; y < h - 1; y += 4.5) bands.push({ x: p.x, y, z: p.z, ry, sx: w + 0.12, sy: 0.4, sz: d + 0.12 });
    }
    this.inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), this.std(0x2a2638, { metalness: 0.5, roughness: 0.6 }), blocks);
    this.inst(new THREE.BoxGeometry(1, 1, 1), this.emissive(st.accents[0], 1.4, { speed: 0.9 }), bands);

    // the ominous core tower, due north
    // (fog-free like the mountain ring, so it always looms as a hazy silhouette on the horizon)
    const core = new THREE.Group();
    core.position.set(CORE_X, 0, CORE_Z);
    const dark = this.std(new THREE.Color(0x1e1a2a).lerp(new THREE.Color(this.zone.fogColor), 0.3).getHex(), { metalness: 0.5, roughness: 0.6, fog: false });
    // base, shaft and crown share `dark`: one baked draw
    const coreM = new THREE.Matrix4().makeTranslation(CORE_X, 0, CORE_Z);
    this.bake(new THREE.BoxGeometry(22, 8, 22).translate(0, 4, 0), coreM, dark);
    this.bake(new THREE.CylinderGeometry(4, 7, 20, 8).translate(0, 18, 0), coreM, dark);
    const glowMat = this.emissive(st.accents[0], 2.6, { speed: 1.1 });
    glowMat.fog = false;
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 11, 16).translate(0, 33.5, 0), glowMat);
    this.bake(new THREE.ConeGeometry(5, 16, 8).translate(0, 47, 0), coreM, dark);
    core.add(glow);
    const ringMat = this.emissive(st.accents[1], 2.0, { speed: 1.6, phase: 1 });
    ringMat.fog = false;
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(6 + i * 2, 0.32, 6, 40), ringMat);
      ring.position.y = 33.5;
      ring.rotation.set(Math.PI / 2 + (i - 1) * 0.5, i * 0.7, 0);
      core.add(ring);
      this.spinners.push({ obj: ring, speed: (i % 2 ? -1 : 1) * (0.35 + i * 0.15) });
    }
    this.add(core);
    this.glowSprite(st.accents[0], 0.8, 28, CORE_X, 33.5, CORE_Z, 1.1).material.fog = false;
    this.glowSprite(st.accents[1], 0.9, 7, CORE_X, 55.5, CORE_Z, 3).material.fog = false;

    // glowing crystals
    for (let c = 0; c < st.accents.length; c++) {
      const items: Item[] = [];
      for (const p of this.scatter(10, 48, 90)) {
        const n = 2 + ((rnd() * 4) | 0);
        for (let k = 0; k < n; k++) {
          const s = 0.3 + rnd() * 0.5;
          items.push({ x: p.x + (rnd() - 0.5) * 1.6, y: G + s, z: p.z + (rnd() - 0.5) * 1.6, ry: rnd() * 6, rx: (rnd() - 0.5) * 0.7, rz: (rnd() - 0.5) * 0.7, sx: s, sy: s * (2.2 + rnd() * 1.5), sz: s });
        }
      }
      this.inst(new THREE.OctahedronGeometry(1, 0), this.emissive(st.accents[c], 1.2, { speed: 1.3 + c * 0.4, phase: c * 2 }), items);
    }
  }

  /* ------------------------------------------------------------------ THE SNOWDOME (Brawl) */

  private buildSnowdome(zone: ZoneDef, G: number): void {
    const st = this.style;
    const rnd = this.rnd;
    const tiers: Item[] = [];
    const seats: Item[] = [];
    const backs: Item[] = [];
    const poles: Item[] = [];
    const flags: Item[] = [];
    const crowd: Item[] = [];
    const corners: Item[] = [];
    const sponsorItems: Item[][] = SPONSORS.map(() => []);
    const backN = DOME_N0 + DOME_ROWS * DOME_ROW_D + 0.3;
    const topH = G + 0.25 + DOME_ROWS * DOME_RISE;

    // crowd density so the total stays under the instance cap
    const sideLen = ARENA.maxX - ARENA.minX + 2;
    const crowdStep = 1.5;
    const slots = 4 * DOME_ROWS * Math.floor(sideLen / crowdStep);
    const keep = Math.min(0.9, (DOME_CROWD_CAP * 0.97) / slots);
    let sponsorIdx = 0;
    for (let si = 0; si < SIDES.length; si++) {
      const side = SIDES[si];
      const len = sideLen;
      const accent = st.accents[si % st.accents.length];
      for (let k = 0; k < DOME_ROWS; k++) {
        const top = G + 0.25 + (k + 1) * DOME_RISE;
        const depth = (DOME_ROWS - k) * DOME_ROW_D;
        const [x, z] = side.map(0, DOME_N0 + k * DOME_ROW_D + depth / 2);
        tiers.push({ x, y: 0, z, ry: side.yaw, sx: len, sy: top, sz: depth, color: k % 2 ? st.stand : st.standAlt });
        const [sx, sz] = side.map(0, DOME_N0 + k * DOME_ROW_D + 0.35);
        seats.push({ x: sx, y: top, z: sz, ry: side.yaw, sx: len, sy: 1, sz: 1, color: k % 3 === 0 ? accent : st.trim });
        for (let s = -len / 2 + 0.8; s < len / 2 - 0.6; s += crowdStep) {
          if (rnd() > keep || crowd.length >= DOME_CROWD_CAP) continue;
          const [cx, cz] = side.map(s + (rnd() - 0.5) * 0.3, DOME_N0 + k * DOME_ROW_D + 0.95);
          const sc2 = 1.45 + rnd() * 0.35;
          const col = rnd() < 0.45 ? CONFETTI[(rnd() * CONFETTI.length) | 0] : this.crowdColor();
          crowd.push({ x: cx, y: top, z: cz, ry: side.yaw + (rnd() - 0.5) * 0.4, sx: sc2, sy: sc2, sz: sc2, color: col });
        }
      }
      const [bx, bz] = side.map(0, backN);
      backs.push({ x: bx, y: 0, z: bz, ry: side.yaw, sx: len + 2, sy: topH + 2.2, sz: 0.6 });
      // sponsor boards ribbon on top of the back wall (facing in), and flag poles between them
      for (let s = -len / 2 + 9; s < len / 2 - 6; s += 16) {
        if (Math.abs(s) < 22) continue; // jumbotron
        const [qx, qz] = side.map(s, backN - 0.35);
        sponsorItems[sponsorIdx++ % SPONSORS.length].push({ x: qx, y: topH + 2.2 + 1.6, z: qz, ry: side.yaw, sx: 1, sy: 1, sz: 1 });
        const [px, pz] = side.map(s + 8, backN);
        poles.push({ x: px, y: topH + 2.2, z: pz, ry: side.yaw, sx: 1.8, sy: 1.8, sz: 1.8 });
        flags.push({ x: px, y: topH + 2.2 + 5.2, z: pz, ry: side.yaw + Math.PI / 2 + (rnd() - 0.5) * 0.5, sx: 2, sy: 2, sz: 2, color: CONFETTI[(rnd() * CONFETTI.length) | 0] });
      }
    }
    // corner concourse blocks (floodlight towers rise through them)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const w = backN - WALL_C + 0.4;
      corners.push({ x: sx * (ARENA.maxX + WALL_C + w / 2), y: 0, z: sz * (ARENA.maxZ + WALL_C + w / 2), ry: 0, sx: w, sy: topH * 0.55, sz: w, color: st.trim });
    }

    const unitBox = () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.inst(unitBox(), this.std(0xffffff, { roughness: 0.85 }), tiers, true, true);
    this.inst(new THREE.BoxGeometry(1, 0.16, 0.5).translate(0, 0.08, 0), this.std(0xffffff, { roughness: 0.6 }), seats);
    this.inst(unitBox(), this.std(st.trim, { metalness: 0.4, roughness: 0.55 }), backs, true);
    this.inst(unitBox(), this.std(0xffffff, { metalness: 0.3, roughness: 0.6 }), corners, true, true);
    this.inst(new THREE.CylinderGeometry(0.05, 0.05, 3, 6).translate(0, 1.5, 0), this.std(0xcfd5dc, { metalness: 0.6, roughness: 0.4 }), poles);
    const flagShape = new THREE.Shape();
    flagShape.moveTo(0, 0);
    flagShape.lineTo(1.3, -0.3);
    flagShape.lineTo(0, -0.7);
    flagShape.closePath();
    this.inst(new THREE.ShapeGeometry(flagShape).translate(0.05, 0.4, 0), this.std(0xffffff, { side: THREE.DoubleSide, roughness: 0.7 }), flags);
    this.addCrowd(crowd);

    // sponsor boards: one atlas texture, per-sponsor UV-remapped geometry, all baked into one mesh
    const atlas = this.sponsorAtlas();
    const boardMat = new THREE.MeshBasicMaterial({ map: atlas, toneMapped: false });
    for (let i = 0; i < SPONSORS.length; i++) {
      const geo = new THREE.PlaneGeometry(14, 3.2);
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      const col = i % 2;
      const row = (i / 2) | 0;
      for (let j = 0; j < uv.count; j++) {
        uv.setXY(j, (col + uv.getX(j)) * 0.5, 1 - (row + 1 - uv.getY(j)) * 0.25);
      }
      this.bakeItems(geo, boardMat, sponsorItems[i]);
    }
    // board frames
    const frames: Item[] = [];
    for (const list of sponsorItems) for (const it of list) frames.push({ ...it, z: it.z, sx: 14.6, sy: 3.8, sz: 0.3 });
    this.inst(new THREE.BoxGeometry(1, 1, 1).translate(0, 0, -0.2), this.std(0x15182a, { metalness: 0.5 }), frames);

    this.buildTowers(DOME_TOWER_OFF, DOME_TOWER_K);
    this.buildDomeScreens(zone, topH, backN);
    this.buildDomeTunnels(G);
    this.buildDomeRig();
  }

  private sponsorAtlas(): THREE.Texture {
    const [c, g] = canvas(1024, 512);
    for (let i = 0; i < SPONSORS.length; i++) {
      const [name, bg, fg] = SPONSORS[i];
      const x = (i % 2) * 512;
      const y = ((i / 2) | 0) * 128;
      g.fillStyle = bg;
      g.fillRect(x, y, 512, 128);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      for (let k = 0; k < 6; k++) g.fillRect(x + k * 96 - 20, y, 40, 128);
      g.strokeStyle = fg;
      g.lineWidth = 6;
      g.strokeRect(x + 8, y + 8, 496, 112);
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = 'italic 900 70px "Arial Black", Impact, sans-serif';
      g.fillText(name, x + 256, y + 66, 470);
    }
    const t = toTex(c);
    this.zoneTex.push(t);
    return t;
  }

  /** Four giant jumbotrons above the stands (one per side), sharing one screen + one ticker texture. */
  private buildDomeScreens(zone: ZoneDef, topH: number, backN: number): void {
    const st = this.style;
    const [c, g] = canvas(1024, 400);
    const bg = g.createLinearGradient(0, 0, 0, 400);
    bg.addColorStop(0, '#0b1230');
    bg.addColorStop(1, '#2a0c3a');
    g.fillStyle = bg;
    g.fillRect(0, 0, 1024, 400);
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 2;
    for (let x = 0; x < 1024; x += 32) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 400);
      g.stroke();
    }
    g.strokeStyle = hexCss(st.accents[0]);
    g.lineWidth = 12;
    g.strokeRect(12, 12, 1000, 376);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 128px "Arial Black", Impact, sans-serif';
    g.fillStyle = '#ffffff';
    g.fillText('SNOWDOME', 512, 120, 960);
    g.fillStyle = hexCss(st.accents[0]);
    g.fillText('BRAWL', 512, 245, 960);
    g.font = 'bold 40px Arial, sans-serif';
    g.fillStyle = hexCss(st.accents[1]);
    g.fillText(`${zone.name.toUpperCase()}  ·  FREE-FOR-ALL  ·  9 PLOWS`, 512, 338, 960);
    const screenTex = toTex(c);
    this.zoneTex.push(screenTex);
    const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false });
    this.pulses.push({ mat: screenMat, base: 1, speed: 0, phase: 0 });

    const [tc, tg] = canvas(2048, 64);
    tg.fillStyle = '#05070f';
    tg.fillRect(0, 0, 2048, 64);
    tg.font = 'bold 38px Arial, sans-serif';
    tg.textBaseline = 'middle';
    const parts = ['★ SNOWDOME BRAWL', '★ EVERYONE HUNTS EVERYONE', '★ STREAKS PAY MORE', '★ SHUTDOWNS PAY BOUNTIES', '★ FIRST TO 20 WRECKS', '★ DASH · SLAM · WHIRL  '];
    let x = 10;
    for (let i = 0; i < parts.length; i++) {
      tg.fillStyle = hexCss(st.accents[i % st.accents.length]);
      tg.fillText(parts[i], x, 34);
      x += tg.measureText(parts[i]).width + 40;
    }
    const tickTex = toTex(tc, true);
    tickTex.wrapT = THREE.ClampToEdgeWrapping;
    this.zoneTex.push(tickTex);
    this.ticker = tickTex;
    const tickMat = new THREE.MeshBasicMaterial({ map: tickTex, toneMapped: false });

    const trim = this.std(st.trim, { metalness: 0.55, roughness: 0.45 });
    const glowFrame = this.emissive(st.accents[0], 1.4, { speed: 3 });
    const K = 1.6;
    const legGeo = new THREE.BoxGeometry(1.2, 14, 1.2).translate(0, 7, 0);
    const frameGeo = new THREE.BoxGeometry(23, 11, 1.4);
    const glowGeo = new THREE.BoxGeometry(23.8, 11.8, 0.6);
    const screenGeo = new THREE.PlaneGeometry(21.4, 8.4);
    const tickGeo = new THREE.PlaneGeometry(21.4, 1.5);
    // static and sharing four materials: baked into the zone batch (4 draws for all four screens)
    const grp = new THREE.Object3D();
    const part = new THREE.Matrix4();
    const bake = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) =>
      this.bake(geo, part.makeTranslation(x, y, z).premultiply(grp.matrix), mat);
    for (const side of SIDES) {
      const [px, pz] = side.map(0, backN + 1.5);
      grp.position.set(px, topH - 2, pz);
      grp.rotation.y = side.yaw;
      grp.scale.setScalar(K);
      grp.updateMatrix();
      for (const lx of [-8, 8]) bake(legGeo, trim, lx, 0, 0);
      bake(glowGeo, glowFrame, 0, 19, -0.3);
      bake(frameGeo, trim, 0, 19, 0);
      bake(screenGeo, screenMat, 0, 19.9, 0.71);
      bake(tickGeo, tickMat, 0, 14.6, 0.71);
    }
    for (const geo of [legGeo, frameGeo, glowGeo, screenGeo, tickGeo]) geo.dispose();
  }

  /** Decorative tunnel mouths in the stand fronts (no gameplay; Brawl has no gates). */
  private buildDomeTunnels(G: number): void {
    const st = this.style;
    const frames: Item[] = [];
    const holes: Item[] = [];
    const lights: Item[] = [];
    for (let i = 0; i < SIDES.length; i++) {
      const side = SIDES[i];
      const s = i % 2 ? -46 : 46;
      const [x, z] = side.map(s, DOME_N0 - 0.6);
      frames.push({ x, y: 0, z, ry: side.yaw, sx: 1, sy: 1, sz: 1 });
      const [hx, hz] = side.map(s, DOME_N0 - 1.82);
      holes.push({ x: hx, y: G, z: hz, ry: side.yaw, sx: 1, sy: 1, sz: 1 });
      const [lx, lz] = side.map(s, DOME_N0 - 1.86);
      lights.push({ x: lx, y: G + 5.6, z: lz, ry: side.yaw, sx: 1, sy: 1, sz: 1 });
    }
    const frameGeo = merge([
      new THREE.BoxGeometry(1.4, 7, 2.6).translate(-5.2, 3.5, 0),
      new THREE.BoxGeometry(1.4, 7, 2.6).translate(5.2, 3.5, 0),
      new THREE.BoxGeometry(11.8, 1.6, 2.6).translate(0, 7.3, 0),
    ]);
    this.inst(frameGeo, this.std(st.trim, { metalness: 0.5, roughness: 0.5 }), frames, true);
    this.inst(new THREE.PlaneGeometry(9, 6.4).translate(0, 3.2, 0), new THREE.MeshBasicMaterial({ color: 0x05070f }), holes);
    this.inst(new THREE.BoxGeometry(9.4, 0.3, 0.1), this.emissive(st.accents[1], 1.8, { speed: 2.4 }), lights);
    for (const h of holes) {
      const fx = Math.sin(h.ry) * 0.6;
      const fz = Math.cos(h.ry) * 0.6;
      this.glowSprite(st.accents[1], 0.35, 9, h.x + fx, G + 3, h.z + fz, 1.8);
    }
  }

  /** A light lighting rig ring + cables high above the arena. */
  private buildDomeRig(): void {
    const st = this.style;
    const R = 128;
    const Y = 58;
    const hubY = 70;
    const trussMat = this.std(0x3a3f55, { metalness: 0.6, roughness: 0.5 });
    // ring, hub and cables share trussMat: one baked draw
    this.bake(new THREE.TorusGeometry(R, 0.9, 5, 96).rotateX(Math.PI / 2), this.tmpM.makeTranslation(0, Y, 0), trussMat);
    this.bake(new THREE.CylinderGeometry(4, 5, 4, 12), this.tmpM.makeTranslation(0, hubY, 0), trussMat);
    const hubGlow = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.35, 6, 32).rotateX(Math.PI / 2), this.emissive(st.accents[0], 2, { speed: 1.2 }));
    hubGlow.position.y = hubY - 2;
    this.add(hubGlow);
    const cables: Item[] = [];
    const lamps: Item[] = [];
    const nC = 12;
    for (let i = 0; i < nC; i++) {
      const a = (i / nC) * Math.PI * 2 + Math.PI / nC;
      const ex = Math.cos(a) * R;
      const ez = Math.sin(a) * R;
      const dx = ex;
      const dy = Y - hubY;
      const dz = ez;
      const len = Math.hypot(dx, dy, dz);
      cables.push({ x: 0, y: hubY, z: 0, rx: Math.acos(dy / len), ry: Math.atan2(dx, dz), sx: 1, sy: len, sz: 1 });
    }
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      lamps.push({ x: Math.cos(a) * R, y: Y - 1.3, z: Math.sin(a) * R, ry: -a, sx: 1, sy: 1, sz: 1, color: CONFETTI[i % CONFETTI.length] });
    }
    this.bakeItems(new THREE.CylinderGeometry(0.25, 0.25, 1, 5).translate(0, 0.5, 0), trussMat, cables);
    this.inst(new THREE.BoxGeometry(1.6, 0.9, 1.6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), lamps);
  }

  /* ------------------------------------------------------------------ Brawl cover obstacles */

  private buildObstacles(G: number, snowMat: THREE.Material): void {
    const rnd = mulberry32(90210);
    const obs = this.obstacleList;
    const pillars: Item[] = [];
    const pillarCaps: Item[] = [];
    const crystals: Item[] = [];
    const containers: Item[] = [];
    const roofs: Item[] = [];
    const rocks: Item[] = [];
    const rockCaps: Item[] = [];
    const snowmen: Item[] = [];
    const tirePiles: Item[] = [];
    const contCols = [0xc0392b, 0x2f6fb0, 0xe0a030, 0x3c8d5a, 0x8e44ad, 0xd35400];
    const lim = ARENA.maxX - 8;
    const clampP = (v: number, r: number) => Math.max(-lim + r, Math.min(lim - r, v));
    const j = (amt: number) => (rnd() - 0.5) * 2 * amt;

    // centerpiece: frozen fountain
    obs.push({ x: 0, z: 0, r: 4 });

    const addContainer = (cx: number, cz: number, ang: number) => {
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      // local +Z of the box = (sin ang, cos ang) ... long axis along local Z
      const ax = s;
      const az = c;
      for (const o of [-2.2, 0, 2.2]) obs.push({ x: cx + ax * o, z: cz + az * o, r: 1.35 });
      const col = contCols[(rnd() * contCols.length) | 0];
      containers.push({ x: cx, y: 0, z: cz, ry: ang, sx: 1, sy: 1, sz: 1, color: col });
      if (rnd() < 0.55) {
        const ang2 = ang + j(0.12);
        containers.push({ x: cx + j(0.3), y: 2.8, z: cz + j(0.3), ry: ang2, sx: 1, sy: 1, sz: 1, color: contCols[(rnd() * contCols.length) | 0] });
        roofs.push({ x: cx, y: 5.6, z: cz, ry: ang2, sx: 1, sy: 1, sz: 1 });
      } else {
        roofs.push({ x: cx, y: 2.8, z: cz, ry: ang, sx: 1, sy: 1, sz: 1 });
      }
    };

    for (let q = 0; q < 4; q++) {
      const ca = Math.cos((q * Math.PI) / 2);
      const sa = Math.sin((q * Math.PI) / 2);
      // rotate a base-quadrant point by q * 90deg
      const P = (x: number, z: number): [number, number] => [x * ca - z * sa, x * sa + z * ca];
      const yaw0 = (q * Math.PI) / 2;

      // A) ice pillar cluster
      {
        const [cx, cz] = P(24 + j(2), 16 + j(2));
        const offs: [number, number][] = [[0, 0], [3.8, 1.2], [1.3, 3.7]];
        for (const [ox, oz] of offs) {
          const [rx, rz] = P(ox, oz);
          const r = 1.2 + rnd() * 0.8;
          const x = cx + rx;
          const z = cz + rz;
          const h = 4.5 + rnd() * 3;
          obs.push({ x, z, r });
          pillars.push({ x, y: 0, z, ry: rnd() * 6, sx: r, sy: h, sz: r });
          pillarCaps.push({ x, y: h - 0.05, z, ry: rnd() * 6, sx: r * 1.08, sy: 0.45, sz: r * 1.08 });
          crystals.push({ x, y: h + 0.6, z, ry: rnd() * 6, rx: j(0.2), rz: j(0.2), sx: r * 0.45, sy: r * 1.2, sz: r * 0.45 });
        }
      }
      // B) shipping container
      {
        const [cx, cz] = P(47 + j(2), 10 + j(2));
        addContainer(cx, cz, yaw0 + 0.35 + j(0.25));
      }
      // C) rock outcrop (main + satellite)
      {
        const [cx, cz] = P(38 + j(2), 40 + j(2));
        const r = 3 + rnd();
        obs.push({ x: cx, z: cz, r });
        rocks.push({ x: cx, y: r * 0.15, z: cz, ry: rnd() * 6, rx: j(0.3), sx: r * 1.05, sy: r * 0.95, sz: r * 1.05 });
        rockCaps.push({ x: cx, y: r * 0.15 + r * 0.6, z: cz, ry: rnd() * 6, sx: r * 0.75, sy: r * 0.35, sz: r * 0.75 });
        const a = rnd() * Math.PI * 2;
        const r2 = 1.6 + rnd() * 0.6;
        const sx = cx + Math.cos(a) * (r + r2 * 0.6);
        const sz = cz + Math.sin(a) * (r + r2 * 0.6);
        obs.push({ x: sx, z: sz, r: r2 });
        rocks.push({ x: sx, y: r2 * 0.1, z: sz, ry: rnd() * 6, rz: j(0.3), sx: r2 * 1.05, sy: r2 * 0.9, sz: r2 * 1.05 });
        rockCaps.push({ x: sx, y: r2 * 0.1 + r2 * 0.55, z: sz, ry: rnd() * 6, sx: r2 * 0.72, sy: r2 * 0.3, sz: r2 * 0.72 });
      }
      // D) giant snowman statue (faces the center)
      {
        const [x, z] = P(12 + j(2), 54 + j(2));
        obs.push({ x, z, r: 2.3 });
        snowmen.push({ x, y: 0, z, ry: Math.atan2(-x, -z) + j(0.3), sx: 1, sy: 1, sz: 1 });
      }
      // E) stacked tire pile
      {
        const [x, z] = P(clampP(77 + j(1.5), 2), 36 + j(2));
        obs.push({ x, z, r: 2 });
        tirePiles.push({ x, y: 0, z, ry: rnd() * 6, sx: 1, sy: 1, sz: 1 });
      }
      // F) corner container
      {
        const [cx, cz] = P(62 + j(2), 64 + j(2));
        addContainer(cx, cz, yaw0 + Math.PI / 4 + j(0.3));
      }
    }

    // --- meshes (the pillar cluster and crystals are reskinned per biome venue)
    const skin = BRAWL_SKIN[this.biome ?? 'snowdome'] ?? BRAWL_SKIN.snowdome!;
    if (this.biome === 'divide') for (const p of pillars) p.color = p.x < 0 ? 0x7a2c1e : 0xa8e4ff;
    const iceMat = this.std(this.biome === 'divide' ? 0xffffff : skin.pillar, { roughness: skin.rough, metalness: 0.1, emissive: skin.glow, emissiveIntensity: 0.6 });
    this.inst(new THREE.CylinderGeometry(0.9, 1, 1, 6).translate(0, 0.5, 0), iceMat, pillars, true, true);
    // pillar caps, container roofs and rock caps share snowMat + receive: baked into one draw
    this.bakeItems(new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), snowMat, pillarCaps, false, true);
    this.inst(new THREE.OctahedronGeometry(1, 0), this.emissive(skin.crystal, 1.4, { speed: 1.6 }), crystals);

    // containers: corrugated box + snow roof
    const ribs = this.ribTexture();
    const contGeo = new THREE.BoxGeometry(2.6, 2.8, 6.6).translate(0, 1.4, 0);
    this.inst(contGeo, this.std(0xffffff, { map: ribs, roughness: 0.6, metalness: 0.3, flatShading: false }), containers, true, true);
    this.bakeItems(new THREE.BoxGeometry(2.7, 0.32, 6.7).translate(0, 0.16, 0), snowMat, roofs, true, true);

    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    this.inst(rockGeo, this.std(this.style.rock, { roughness: 0.95 }), rocks, true, true);
    this.bakeItems(rockGeo.clone(), snowMat, rockCaps, false, true);

    // snowman statue (merged, vertex colored)
    const snowmanGeo = merge([
      colored(new THREE.SphereGeometry(2.3, 14, 10).translate(0, 1.9, 0), 0xf4f8ff),
      colored(new THREE.SphereGeometry(1.7, 14, 10).translate(0, 4.6, 0), 0xf4f8ff),
      colored(new THREE.SphereGeometry(1.2, 12, 9).translate(0, 6.75, 0), 0xf4f8ff),
      colored(new THREE.CylinderGeometry(1.5, 1.5, 0.18, 14).translate(0, 7.75, 0), 0x16161c),
      colored(new THREE.CylinderGeometry(0.95, 1.0, 1.5, 14).translate(0, 8.55, 0), 0x16161c),
      colored(new THREE.CylinderGeometry(1.02, 1.02, 0.3, 14).translate(0, 8.0, 0), 0xe63946),
      colored(new THREE.ConeGeometry(0.22, 1.4, 8).rotateX(Math.PI / 2).translate(0, 6.75, 1.75), 0xff7a1a),
      colored(new THREE.SphereGeometry(0.16, 6, 5).translate(0.42, 7.05, 1.05), 0x111111),
      colored(new THREE.SphereGeometry(0.16, 6, 5).translate(-0.42, 7.05, 1.05), 0x111111),
      colored(new THREE.SphereGeometry(0.18, 6, 5).translate(0, 5.0, 1.62), 0x111111),
      colored(new THREE.SphereGeometry(0.18, 6, 5).translate(0, 4.3, 1.66), 0x111111),
      colored(new THREE.TorusGeometry(1.25, 0.3, 6, 16).rotateX(Math.PI / 2).translate(0, 5.95, 0), 0x2a9df4),
      colored(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 5).rotateZ(1.0).translate(2.6, 5.4, 0), 0x5a3a22),
      colored(new THREE.CylinderGeometry(0.12, 0.12, 3.2, 5).rotateZ(-1.0).translate(-2.6, 5.4, 0), 0x5a3a22),
    ]);
    this.inst(snowmanGeo, this.std(skin.statue, { vertexColors: true, roughness: skin.statue === 0xf2c94a ? 0.35 : 0.75, metalness: skin.statue === 0xf2c94a ? 0.5 : 0 }), snowmen, true, true);

    // tire pile: stacks of lying tires + one leaning
    const tireParts: THREE.BufferGeometry[] = [];
    const tire = (x: number, y: number, z: number, rx: number, rz: number) =>
      tireParts.push(colored(new THREE.TorusGeometry(0.6, 0.27, 7, 14).rotateX(rx).rotateZ(rz).translate(x, y, z), 0x1d1e23));
    for (const [sx, sz, n] of [[-0.75, -0.5, 4], [0.85, -0.45, 3], [0, 0.85, 5]] as [number, number, number][]) {
      for (let k = 0; k < n; k++) tire(sx, 0.27 + k * 0.52, sz, Math.PI / 2, 0);
    }
    tire(0.1, 2.45, 0.2, Math.PI / 2 - 0.3, 0.2);
    tire(1.6, 0.7, 0.9, 0.2, 0);
    tireParts.push(colored(new THREE.SphereGeometry(1.2, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.4, 1).translate(0, 2.7, 0.7), 0xf4f8ff));
    this.inst(merge(tireParts), this.std(0xffffff, { vertexColors: true, roughness: 0.9 }), tirePiles, true, true);

    this.buildFountain(G);
  }

  private ribTexture(): THREE.Texture {
    const [c, g] = canvas(64, 64);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 64, 64);
    for (let x = 0; x < 64; x += 8) {
      g.fillStyle = '#b9bec7';
      g.fillRect(x, 0, 3, 64);
      g.fillStyle = '#e4e7ec';
      g.fillRect(x + 3, 0, 2, 64);
    }
    g.fillStyle = '#8a8f99';
    g.fillRect(0, 0, 64, 3);
    g.fillRect(0, 61, 64, 3);
    const t = toTex(c, true);
    t.repeat.set(3, 1);
    this.zoneTex.push(t);
    return t;
  }

  /** Frozen fountain / ice sculpture centerpiece (obstacle r = 4 at the origin). */
  private buildFountain(G: number): void {
    const st = this.style;
    const skin = BRAWL_SKIN[this.biome ?? 'snowdome'] ?? BRAWL_SKIN.snowdome!;
    const stone = skin.stone;
    const ice = skin.water;
    const parts: THREE.BufferGeometry[] = [
      colored(new THREE.CylinderGeometry(4, 4.15, 1.0, 24).translate(0, 0.5, 0), stone),
      colored(new THREE.TorusGeometry(3.75, 0.32, 6, 28).rotateX(Math.PI / 2).translate(0, 1.0, 0), 0xa8b1c4),
      colored(new THREE.CylinderGeometry(3.45, 3.45, 0.2, 24).translate(0, 0.95, 0), ice),
      colored(new THREE.CylinderGeometry(0.8, 1.1, 3.2, 10).translate(0, 2.5, 0), stone),
      colored(new THREE.CylinderGeometry(2.1, 1.0, 0.6, 16).translate(0, 4.2, 0), stone),
      colored(new THREE.CylinderGeometry(0.5, 0.7, 1.6, 8).translate(0, 5.2, 0), stone),
    ];
    // frozen water curtains dripping off the upper bowl
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const r = 1.85;
      parts.push(colored(new THREE.ConeGeometry(0.28, 2.6, 5).rotateX(Math.PI).translate(Math.cos(a) * r, 2.75, Math.sin(a) * r), ice));
    }
    const base = new THREE.Mesh(merge(parts), this.std(0xffffff, { vertexColors: true, roughness: 0.35, metalness: 0.15 }));
    base.position.y = G * 0.3;
    base.castShadow = true;
    base.receiveShadow = true;
    this.add(base);
    // spinning ice sculpture on top (crystal elongated along local Z; the holder turns Z up so rotation.z spins about world Y)
    const holder = new THREE.Group();
    holder.position.set(0, G * 0.3 + 8.2, 0);
    holder.rotation.x = -Math.PI / 2;
    const crystalMat = this.emissive(skin.crystal, 1.1, { speed: 1.4 });
    crystalMat.roughness = 0.1;
    crystalMat.metalness = 0.2;
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.2, 0).scale(1, 1, 2.2), crystalMat);
    crystal.castShadow = true;
    holder.add(crystal);
    // the three (non-casting) satellites: one merged child, so they spin with the crystal
    const sats = new StaticBatch();
    const satGeo = new THREE.OctahedronGeometry(0.45, 0).scale(1, 1, 1.8);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      sats.add(satGeo, this.tmpM.makeTranslation(Math.cos(a) * 1.9, Math.sin(a) * 1.9, -1.2), crystalMat);
    }
    sats.flush(crystal);
    satGeo.dispose();
    this.add(holder);
    this.spinners.push({ obj: crystal, speed: 0.6 });
    this.glowSprite(skin.crystal, 0.55, 12, 0, G * 0.3 + 8.2, 0, 1.4);
    // accent ring on the ground
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(5.2, 5.6, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: st.accents[1], transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    ring.position.y = G + 0.05;
    ring.renderOrder = 2;
    this.add(ring);
  }

  /* ------------------------------------------------------------------ weather */

  /** Biome weather (GPU particles, see biomes/Weather.ts); the classic looks get snow (a gale in the Blizzard Bowl). */
  private buildWeather(zone: ZoneDef): void {
    const b = zone.biome;
    if (b) {
      const layers = weatherLayers(b.particles, zone.snowfall);
      if (b.key === 'glacier') layers.push(GLINTS);
      this.weather.set(layers);
      return;
    }
    const blizzard = zone.theme === 'blizzard';
    const snow = weatherLayers('snow', zone.snowfall)[0];
    if (blizzard) Object.assign(snow, { wind: [16, 5], fall: 5, sway: 1.5, size: 0.18, opacity: 0.95 });
    this.weather.set([snow]);
  }

  /* ------------------------------------------------------------------ update */

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    const cam = this.ctx.camera.position;
    this.sky.position.copy(cam);
    this.skyMat.uniforms.uTime.value = t;
    if (this.auroraBase) {
      const k = 0.5 + 0.5 * Math.sin(t * 0.23);
      this.hemi.color.copy(this.auroraA).lerp(this.auroraB, k).lerp(this.auroraBase, 0.8 + 0.08 * Math.sin(t * 0.61));
    }
    this.bobTime.value = t;
    if (this.carpet) this.drapeCarpet();
    if (this.omega) {
      const p = this.ctx.plow?.position;
      this.omega.works.update(dt, p?.x ?? 0, p?.y ?? 0, p?.z ?? 0);
      this.omega.set.update(t);
    }

    // sun shadow camera follows the player (snapped to shadow-map texels to avoid shimmering)
    const plow = this.ctx.plow;
    if (plow) {
      const p = plow.position;
      const tx = this.sunR.x * p.x + this.sunR.z * p.z;
      const ty = this.sunU.x * p.x + this.sunU.z * p.z;
      const tw = this.sunD.x * p.x + this.sunD.z * p.z;
      const k = this.shadowTexel;
      const u = Math.round(tx / k) * k;
      const v = Math.round(ty / k) * k;
      const R = this.sunR;
      const U = this.sunU;
      const D = this.sunD;
      const target = this.sun.target.position;
      target.set(R.x * u + U.x * v + D.x * tw, R.y * u + U.y * v + D.y * tw, R.z * u + U.z * v + D.z * tw);
      this.sun.position.set(target.x + D.x * 100, target.y + D.y * 100, target.z + D.z * 100);
      this.sun.target.updateMatrixWorld();
    }

    for (let i = 0; i < this.pulses.length; i++) {
      const p = this.pulses[i];
      const k = p.speed === 0 ? 0.94 + 0.06 * Math.sin(t * 7.3) * Math.sin(t * 1.1) : 0.75 + 0.25 * Math.sin(t * p.speed + p.phase);
      const m = p.mat as THREE.MeshStandardMaterial;
      if (m.isMeshStandardMaterial) m.emissiveIntensity = p.base * k;
      else if (p.speed === 0) (p.mat as THREE.MeshBasicMaterial).color.setScalar(k);
      else p.mat.opacity = p.base * k;
    }

    // gates: roll the doors, flash the hazard lights
    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i];
      if (g.openT > 0) g.openT -= dt;
      if (g.flashT > 0) g.flashT -= dt;
      const target = g.openT > 0 ? 1 : 0;
      const rate = target > g.open ? 2.6 : 1.3;
      const diff = target - g.open;
      g.open += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
      const e = g.open * g.open * (3 - 2 * g.open);
      const doorScale = 1 - 0.94 * e;
      if (doorScale !== g.doorScale && this.doors) {
        g.doorScale = doorScale;
        this.doors.setMatrixAt(i, this.tmpM.makeScale(1, doorScale, 1).premultiply(g.doorBase));
        this.doors.instanceMatrix.needsUpdate = true;
      }
      const flashing = g.flashT > 0;
      const k = flashing ? (Math.sin(t * 26) > 0 ? 4.5 : 0.5) : 0.8 + 0.25 * Math.sin(t * 2.2 + g.phase);
      g.lightMat.emissiveIntensity = k;
      g.glowMat.opacity = Math.min(1, 0.18 + k * 0.17);
      g.floorMat.opacity = 0.35 + 0.35 * e + (flashing ? 0.15 : 0);
    }
    if (chevronTex) chevronTex.offset.y = (chevronTex.offset.y + dt * 0.9) % 1;
    if (this.ticker) this.ticker.offset.x = (this.ticker.offset.x + dt * 0.05) % 1;

    for (let i = 0; i < this.spinners.length; i++) this.spinners[i].obj.rotation.z += dt * this.spinners[i].speed;

    if (this.puffs) {
      const { mesh, stacks, per } = this.puffs;
      const d = this.dummy;
      d.rotation.set(0, 0, 0);
      let n = 0;
      for (let s = 0; s < stacks.length; s++) {
        const st = stacks[s];
        for (let j = 0; j < per; j++) {
          const f = (t * 0.12 + j / per + s * 0.37) % 1;
          const dr = st.drift ?? 9;
          d.position.set(st.x + f * dr + Math.sin(t * 0.5 + j) * 0.8, st.y + 1 + f * (st.rise ?? 16), st.z + f * dr * 0.33);
          d.scale.setScalar(st.r * (0.8 + f * 2.2) * (1 - f * f * 0.6));
          d.updateMatrix();
          mesh.setMatrixAt(n++, d.matrix);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    this.weather.update(t, this.ctx.camera, this.ctx.renderer);
    lavaTime.value = t;
    this.decals?.update(dt);
  }
}
