import type { BiomeKey } from '../../config/zones';
import type { Theme } from './types';

/** Per-arena look: wall blocks, metal trim, banner/crowd accents, gate lights, stands, floodlights. */
export interface Style {
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

/** Steam / smoke puffs shrink to nothing within this many metres of the camera (they never fill the screen). */
export const PUFF_CAM_CLEAR = 3;

export const STYLES: Record<Theme | BiomeKey, Style> = {
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
export interface BrawlSkin {
  pillar: number;
  rough: number;
  glow: number;
  crystal: number;
  stone: number;
  water: number;
  /** Tint of the giant snowman statues (ash-man in the quarry, dust-man on Mars, a gold one at the rally). */
  statue: number;
}
export const ICE_SKIN: BrawlSkin = { pillar: 0xa8e4ff, rough: 0.15, glow: 0x15405a, crystal: 0x6ff3ff, stone: 0x8a93a6, water: 0xbfeaff, statue: 0xffffff };
export const BRAWL_SKIN: Partial<Record<BiomeKey, BrawlSkin>> = {
  snowdome: ICE_SKIN,
  glacier: ICE_SKIN,
  quarry: { pillar: 0x7a3826, rough: 0.8, glow: 0x3a0c02, crystal: 0xff6a1a, stone: 0x8a4430, water: 0xff7a2a, statue: 0xb08070 },
  mars: { pillar: 0xb8683e, rough: 0.9, glow: 0x000000, crystal: 0x7fd8ff, stone: 0xa86a4a, water: 0xd8b090, statue: 0xe0a07c },
  divide: { pillar: 0xffffff, rough: 0.3, glow: 0x101830, crystal: 0xd070ff, stone: 0x6a5a68, water: 0xbfeaff, statue: 0xffffff },
  plaza: { pillar: 0xe8b423, rough: 0.35, glow: 0x4a3000, crystal: 0xfff0b0, stone: 0xf3efe6, water: 0x8fd0ff, statue: 0xf2c94a },
};

/** The Thermal Divide's two wall palettes (x < 0 hot basalt, x > 0 cold ice). */
export const DIVIDE_HOT = [0x8a3826, 0x6c2a1e];
export const DIVIDE_COLD = [0xc6e8f8, 0xa2d2ee];

/** Per-biome sky extras and light tweaks (Environment.setZone). */
export interface BiomeSky {
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
export const BIOME_SKY: Partial<Record<BiomeKey, BiomeSky>> = {
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
export const CONFETTI = [0xff3d7f, 0x22d3ff, 0xffd23a, 0x7cff5a, 0xb45cff, 0xff8c00, 0xffffff];

export const FOLIAGE = [0x1f5a3c, 0x245f3a, 0x2d6b45, 0x1a4d35];
