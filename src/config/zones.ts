import type { EnemyType } from './enemies';
import type { TerrainDef } from '../world/Terrain';
import type { AmbienceKind } from '../core/types';
import {
  BRAWL_DIVIDE_TERRAIN, BRAWL_GLACIER_TERRAIN, BRAWL_MARS_TERRAIN, BRAWL_QUARRY_TERRAIN,
  DIVIDE_TERRAIN, GLACIER_TERRAIN, MARS_TERRAIN, QUARRY_TERRAIN,
} from '../world/biomes/terrains';
import { OMEGA_LOOK } from '../world/omega/zone';

export interface SpawnGroup {
  type: EnemyType;
  count: number;
  /** Seconds after round start before the first spawn of this group. */
  delay: number;
  /** Seconds between spawns within the group. */
  interval: number;
}

export interface RoundDef {
  groups: SpawnGroup[];
  /** Boss round: shows the boss intro card and the HUD boss bars. Always the last round of an arena. */
  boss?: boolean;
}

/** Biome look keys (Environment dresses the arena by this; docs/level-overhaul.md "Biomes"). */
export type BiomeKey = 'glacier' | 'quarry' | 'mars' | 'divide' | 'plaza' | 'snowdome';
/** Weather particles: snow; ash fall + rising embers; wind-blown dust; steam (hot half) + snow (cold half); confetti. */
export type BiomeParticles = 'snow' | 'ash' | 'dust' | 'steam' | 'confetti';

/** Per-arena biome: what the world looks and sounds like beyond the sky / fog / light fields of ZoneDef. */
export interface BiomeDef {
  key: BiomeKey;
  /** Weather particle preset (density = ZoneDef.snowfall). */
  particles: BiomeParticles;
  /** Tint of the plowable layer (fresh snow). The zone's snowTint carries the same colour. */
  snowColor: number;
  /** Bare ground under plowed-away snow and outside the field. */
  groundColor: number;
  /** Background ambience loop (AudioAPI.setAmbience). */
  ambience: AmbienceKind;
}

/** An arena: a few rounds of bot minions, ending in a boss round. Beating the boss unlocks the next arena. */
export interface ZoneDef {
  index: number;
  id: string;
  name: string;
  tagline: string;
  /** Display name of this arena's boss (for menus). */
  bossName: string;
  rounds: RoundDef[];
  enemyHpMult: number;
  /** Multiplier on bot hits against the plow (Survival scales it per wave; default 1). */
  enemyDmgMult?: number;
  coinMult: number;
  /** Initial snow depth (m) on the field. */
  snowDepth: number;
  /** Multiplier on snow regeneration. */
  snowRegenMult: number;
  /** Coins for first clear (repeat clears pay 40%). */
  clearReward: number;
  // --- visuals ---
  skyTop: number;
  skyBottom: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  sunColor: number;
  sunIntensity: number;
  ambientColor: number;
  ambientIntensity: number;
  snowTint: number;
  /** Falling snow particle density, 0..1. */
  snowfall: number;
  /** Ground shapes, material patches and (The Omega Works) decks. Omitted = flat snow. */
  terrain?: TerrainDef;
  /** Biome look (props, particles, ground tint, ambience). Omitted = the classic look of `theme`. */
  biome?: BiomeDef;
  /** Venue structure ('rally' = the Plaza stage, 'brawl' = the Snowdome, no gates, 'omega' = The Omega Works' own
   *  factory build with floor hatches instead of gates) and the decoration fallback when there is no biome. */
  theme: 'meadow' | 'pines' | 'lake' | 'blizzard' | 'peak' | 'rally' | 'brawl' | 'omega';
  /** Half-size (m) of the playable square. Omitted = CAMPAIGN_ARENA_HALF (The Omega Works is 160 m across). */
  arenaHalf?: number;
  /** Where the plow starts. Omitted = PLOW_SPAWN. */
  spawn?: { readonly x: number; readonly z: number; readonly heading: number };
}

const g = (type: EnemyType, count: number, delay = 0, interval = 2.5): SpawnGroup => ({ type, count, delay, interval });

/* Biomes of the campaign arenas 1-5 (arena 6, The Omega Works, has its own build). */
export const BIOMES: Record<Exclude<BiomeKey, 'snowdome'>, BiomeDef> = {
  glacier: { key: 'glacier', particles: 'snow', snowColor: 0xeef7ff, groundColor: 0x5f86a8, ambience: 'wind' },
  quarry: { key: 'quarry', particles: 'ash', snowColor: 0xd8683c, groundColor: 0x8c2a14, ambience: 'lava' },
  mars: { key: 'mars', particles: 'dust', snowColor: 0xdc9670, groundColor: 0x7e3218, ambience: 'dust' },
  divide: { key: 'divide', particles: 'steam', snowColor: 0xf3f0f5, groundColor: 0x5a4c58, ambience: 'wind' },
  plaza: { key: 'plaza', particles: 'confetti', snowColor: 0xfff9ee, groundColor: 0x8a6a4a, ambience: 'crowd' },
};

/* Campaign order (docs/level-overhaul.md "Arenas"). Save ids, rounds, challenges and difficulty multipliers belong to
 * the SLOT, except the Plaza and the Works, whose rallybot rounds / Donald challenges / ids moved with them (5 <-> 6
 * swap). Arenas 1-5 are dressed by their biome (snowTint = biome.snowColor); `theme` only picks the venue structure
 * and SnowField's bare-ground fallback colour. Regular-bot ramp: arena 1 is scrappers + a brute; Flurry Gunners join
 * from arena 2 round 2, a Slushpile from arena 2 round 3, Bulwarks from arena 3, and later arenas mix all three in. */
export const ZONES: ZoneDef[] = [
  {
    index: 0, id: 'yard', name: 'Coldboot Glacier', tagline: 'A rogue AI froze the relay station solid.', bossName: 'FROSTBYTE',
    rounds: [
      { groups: [g('scrapper', 3, 0, 2.5)] },
      { groups: [g('scrapper', 4, 0, 2), g('brute', 1, 5, 1)] },
      { boss: true, groups: [g('frostbyte', 1, 1, 1)] },
    ],
    enemyHpMult: 1, coinMult: 1, snowDepth: 0.5, snowRegenMult: 1, clearReward: 150,
    skyTop: 0x06142e, skyBottom: 0x4f88bc, fogColor: 0xa9c8e6, fogNear: 50, fogFar: 160,
    sunColor: 0xd6ebff, sunIntensity: 2.3, ambientColor: 0xa6ccff, ambientIntensity: 1.0, snowTint: BIOMES.glacier.snowColor, snowfall: 0.4,
    biome: BIOMES.glacier, terrain: GLACIER_TERRAIN, theme: 'lake',
  },
  {
    index: 1, id: 'junkyard', name: 'Inferno Quarry', tagline: 'The Yard Boss moved somewhere hotter.', bossName: 'BULLDOZA',
    rounds: [
      { groups: [g('scrapper', 4, 0, 1.8), g('thief', 2, 4, 3)] },
      { groups: [g('spinner', 2, 0, 4), g('scrapper', 3, 3, 2), g('gunner', 2, 7, 4)] },
      { groups: [g('brute', 2, 0, 5), g('thief', 2, 3, 2), g('spinner', 1, 8, 1), g('slushpile', 1, 11, 1)] },
      { boss: true, groups: [g('bulldoza', 1, 1, 1)] },
    ],
    enemyHpMult: 1.2, coinMult: 1.2, snowDepth: 0.55, snowRegenMult: 1, clearReward: 300,
    skyTop: 0x8a3a5a, skyBottom: 0xff7a3a, fogColor: 0xe0703f, fogNear: 50, fogFar: 160,
    sunColor: 0xffc49a, sunIntensity: 2.4, ambientColor: 0xffa47a, ambientIntensity: 1.0, snowTint: BIOMES.quarry.snowColor, snowfall: 0.6,
    biome: BIOMES.quarry, terrain: QUARRY_TERRAIN, theme: 'pines',
  },
  {
    index: 2, id: 'foundry', name: 'Rust Basin', tagline: 'Something huge is drilling under the red dust.', bossName: 'THE GRINDER',
    rounds: [
      { groups: [g('spinner', 3, 0, 3), g('scrapper', 4, 2, 1.5), g('gunner', 2, 6, 3)] },
      { groups: [g('brute', 2, 0, 4), g('bulwark', 1, 3, 1), g('thief', 3, 4, 2), g('slushpile', 1, 9, 1)] },
      { groups: [g('spinner', 3, 0, 2.5), g('brute', 2, 3, 4), g('scrapper', 4, 6, 1.2), g('slushpile', 2, 9, 4), g('gunner', 2, 12, 3)] },
      { boss: true, groups: [g('grinder', 1, 1, 1)] },
    ],
    enemyHpMult: 1.45, coinMult: 1.4, snowDepth: 0.45, snowRegenMult: 0.9, clearReward: 500,
    skyTop: 0xa4643c, skyBottom: 0xf1c18f, fogColor: 0xdba47c, fogNear: 45, fogFar: 150,
    sunColor: 0xfff3e4, sunIntensity: 2.4, ambientColor: 0xffc49e, ambientIntensity: 0.9, snowTint: BIOMES.mars.snowColor, snowfall: 0.5,
    biome: BIOMES.mars, terrain: MARS_TERRAIN, theme: 'meadow',
  },
  {
    index: 3, id: 'bowl', name: 'The Thermal Divide', tagline: 'Twins. One runs hot, one runs cold.', bossName: 'SLUSH & SLEET',
    rounds: [
      { groups: [g('scrapper', 6, 0, 1), g('thief', 3, 3, 1.5), g('gunner', 3, 6, 2.5)] },
      { groups: [g('spinner', 4, 0, 2), g('bulwark', 2, 4, 3), g('slushpile', 2, 8, 3)] },
      { groups: [g('brute', 2, 0, 3), g('bulwark', 1, 2, 1), g('spinner', 3, 3, 2), g('thief', 3, 6, 1.5), g('gunner', 2, 9, 3)] },
      { boss: true, groups: [g('slush', 1, 1, 1), g('sleet', 1, 1.5, 1)] },
    ],
    enemyHpMult: 1.75, coinMult: 1.6, snowDepth: 0.7, snowRegenMult: 2.2, clearReward: 750,
    skyTop: 0x5a1a12, skyBottom: 0xf09a7a, fogColor: 0xc8a4b0, fogNear: 45, fogFar: 150,
    sunColor: 0xfff0ea, sunIntensity: 2.0, ambientColor: 0xd8c8e8, ambientIntensity: 0.95, snowTint: BIOMES.divide.snowColor, snowfall: 0.45,
    biome: BIOMES.divide, terrain: DIVIDE_TERRAIN, theme: 'blizzard',
  },
  {
    index: 4, id: 'plaza', name: 'Golden Tower Plaza', tagline: 'A very big rally. The biggest. Everybody says so.', bossName: 'THE DONALD',
    rounds: [
      { groups: [g('rallybot', 7, 0, 0.8), g('brute', 2, 2, 3), g('thief', 3, 5, 1.5), g('gunner', 2, 8, 3)] },
      { groups: [g('spinner', 4, 0, 1.8), g('rallybot', 6, 2, 0.9), g('brute', 2, 6, 2.5), g('bulwark', 1, 7, 1), g('slushpile', 2, 10, 3)] },
      { groups: [g('brute', 2, 0, 2.5), g('bulwark', 2, 1, 3), g('spinner', 3, 3, 1.8), g('thief', 3, 5, 1.2), g('rallybot', 7, 7, 0.7), g('gunner', 3, 10, 2)] },
      { boss: true, groups: [g('donald', 1, 1, 1)] },
    ],
    enemyHpMult: 2.1, coinMult: 1.8, snowDepth: 0.6, snowRegenMult: 1.3, clearReward: 1200,
    skyTop: 0x2a78e0, skyBottom: 0xcfeaff, fogColor: 0xf3e4c6, fogNear: 60, fogFar: 180,
    sunColor: 0xfff1cf, sunIntensity: 2.7, ambientColor: 0xfff0dc, ambientIntensity: 1.0, snowTint: BIOMES.plaza.snowColor, snowfall: 0.4,
    biome: BIOMES.plaza, theme: 'rally',
  },
  {
    index: 5, id: 'summit', name: 'The Omega Works', tagline: 'The final machine builds itself.', bossName: 'MEGAPLOW Ω',
    rounds: [
      { groups: [g('brute', 3, 0, 3), g('scrapper', 6, 2, 1), g('gunner', 3, 5, 2.5)] },
      { groups: [g('spinner', 4, 0, 2), g('thief', 4, 2, 1.5), g('bulwark', 2, 6, 3), g('slushpile', 2, 9, 3)] },
      { groups: [g('scrapper', 8, 0, 0.8), g('spinner', 3, 3, 2), g('brute', 2, 6, 2.5), g('bulwark', 2, 7, 3), g('gunner', 3, 9, 2), g('slushpile', 2, 12, 3)] },
      { boss: true, groups: [g('omega', 1, 1, 1)] },
    ],
    enemyHpMult: 2.4, coinMult: 2.0, snowDepth: 0.6, snowRegenMult: 1.4, clearReward: 1600,
    // Night-time neon factory, 160 m across, decks / ramps / bridges (src/world/omega/*).
    ...OMEGA_LOOK,
    theme: 'omega',
  },
];

/** Brawl mode venue: THE SNOWDOME — a huge free-for-all arena (ARENA ±BRAWL_ARENA_HALF) with cover obstacles
 *  and deep snow drifts. Not part of the campaign ZONES list; rounds are unused. */
export const BRAWL_ZONE: ZoneDef = {
  index: -1, id: 'snowdome', name: 'The Snowdome', tagline: 'Nine plows. One arena. Everyone hunts everyone.', bossName: '',
  rounds: [],
  enemyHpMult: 1, coinMult: 1, snowDepth: 0.55, snowRegenMult: 2.5, clearReward: 0,
  skyTop: 0x22346b, skyBottom: 0xf0b48a, fogColor: 0xd8c4c8, fogNear: 70, fogFar: 230,
  sunColor: 0xffd2a0, sunIntensity: 2.3, ambientColor: 0xb8c4ff, ambientIntensity: 0.95, snowTint: 0xffffff, snowfall: 0.3, theme: 'brawl',
};

/* ------------------------------------------------------------------ biome pools (Brawl / Duel / Survival / Daily) */

/** Look fields copied from a campaign arena into a mode's venue. */
const LOOK_KEYS = [
  'skyTop', 'skyBottom', 'fogColor', 'fogNear', 'fogFar', 'sunColor', 'sunIntensity', 'ambientColor', 'ambientIntensity',
  'snowTint', 'snowfall',
] as const;
export type ZoneLook = Pick<ZoneDef, (typeof LOOK_KEYS)[number]>;

export function zoneLook(z: ZoneDef): ZoneLook {
  const out = {} as Record<string, number>;
  for (const k of LOOK_KEYS) out[k] = z[k];
  return out as unknown as ZoneLook;
}

/** Campaign arena of each biome. */
export const BIOME_ZONE: Record<Exclude<BiomeKey, 'snowdome'>, ZoneDef> = {
  glacier: ZONES[0], quarry: ZONES[1], mars: ZONES[2], divide: ZONES[3], plaza: ZONES[4],
};

/** Brawl venues: the classic Snowdome plus the five campaign biomes (ground terrain only, scaled to the 180 m dome). */
export const BRAWL_BIOMES: readonly BiomeKey[] = ['snowdome', 'glacier', 'quarry', 'mars', 'divide', 'plaza'];
const BRAWL_TERRAIN: Partial<Record<BiomeKey, TerrainDef>> = {
  glacier: BRAWL_GLACIER_TERRAIN, quarry: BRAWL_QUARRY_TERRAIN, mars: BRAWL_MARS_TERRAIN, divide: BRAWL_DIVIDE_TERRAIN,
};
const brawlZones = new Map<BiomeKey, ZoneDef>();

/** The Snowdome dressed as `key` (cached: same object every call). 'snowdome' = the classic BRAWL_ZONE. */
export function brawlZone(key: BiomeKey): ZoneDef {
  if (key === 'snowdome') return BRAWL_ZONE;
  let z = brawlZones.get(key);
  if (!z) {
    const src = BIOME_ZONE[key];
    const look = zoneLook(src);
    z = {
      ...BRAWL_ZONE,
      ...look,
      // the dome is 3x the campaign arena: push the haze out so the far stands still read
      fogNear: Math.max(look.fogNear * 1.5, 70),
      fogFar: Math.max(look.fogFar * 1.45, 210),
      name: `Snowdome · ${src.name}`,
      biome: src.biome,
      terrain: BRAWL_TERRAIN[key],
    };
    brawlZones.set(key, z);
  }
  return z;
}

/** Brawl venue for a random draw r in [0, 1). */
export function pickBrawlZone(r: number): ZoneDef {
  return brawlZone(BRAWL_BIOMES[Math.min(BRAWL_BIOMES.length - 1, Math.floor(r * BRAWL_BIOMES.length))]);
}
