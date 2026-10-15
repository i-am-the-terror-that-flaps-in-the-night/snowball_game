import type { EnemyType } from './enemies';

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
  /** Decoration theme for Environment. */
  theme: 'meadow' | 'pines' | 'lake' | 'blizzard' | 'peak' | 'brawl';
}

const g = (type: EnemyType, count: number, delay = 0, interval = 2.5): SpawnGroup => ({ type, count, delay, interval });

export const ZONES: ZoneDef[] = [
  {
    index: 0, id: 'yard', name: 'Frostbite Yard', tagline: 'A snowy scrapyard ruled by a very big bulldozer.', bossName: 'BULLDOZA',
    rounds: [
      { groups: [g('scrapper', 3, 0, 2.5)] },
      { groups: [g('scrapper', 4, 0, 2), g('brute', 1, 5, 1)] },
      { boss: true, groups: [g('bulldoza', 1, 1, 1)] },
    ],
    enemyHpMult: 1, coinMult: 1, snowDepth: 0.5, snowRegenMult: 1, clearReward: 150,
    skyTop: 0x4f8fd6, skyBottom: 0xdcefff, fogColor: 0xd6e9fb, fogNear: 60, fogFar: 170,
    sunColor: 0xfff1d6, sunIntensity: 2.6, ambientColor: 0xbcd7ff, ambientIntensity: 0.9, snowTint: 0xffffff, snowfall: 0.25, theme: 'meadow',
  },
  {
    index: 1, id: 'junkyard', name: 'Pine Junkyard', tagline: 'Thieves in the trees. A rogue AI in the plow shed.', bossName: 'FROSTBYTE',
    rounds: [
      { groups: [g('scrapper', 4, 0, 1.8), g('thief', 2, 4, 3)] },
      { groups: [g('spinner', 2, 0, 4), g('scrapper', 3, 3, 2)] },
      { groups: [g('brute', 2, 0, 5), g('thief', 2, 3, 2), g('spinner', 1, 8, 1)] },
      { boss: true, groups: [g('frostbyte', 1, 1, 1)] },
    ],
    enemyHpMult: 1.2, coinMult: 1.2, snowDepth: 0.55, snowRegenMult: 1, clearReward: 300,
    skyTop: 0x2f5d8a, skyBottom: 0xf3d7b6, fogColor: 0xd9c9b8, fogNear: 45, fogFar: 150,
    sunColor: 0xffc890, sunIntensity: 2.2, ambientColor: 0xc9b9ff, ambientIntensity: 0.8, snowTint: 0xfff6ee, snowfall: 0.35, theme: 'pines',
  },
  {
    index: 2, id: 'foundry', name: 'Frozen Foundry', tagline: 'Ice-locked ironworks. Something huge is drilling below.', bossName: 'THE GRINDER',
    rounds: [
      { groups: [g('spinner', 3, 0, 3), g('scrapper', 4, 2, 1.5)] },
      { groups: [g('brute', 3, 0, 4), g('thief', 3, 4, 2)] },
      { groups: [g('spinner', 3, 0, 2.5), g('brute', 2, 3, 4), g('scrapper', 4, 6, 1.2)] },
      { boss: true, groups: [g('grinder', 1, 1, 1)] },
    ],
    enemyHpMult: 1.45, coinMult: 1.4, snowDepth: 0.45, snowRegenMult: 0.9, clearReward: 500,
    skyTop: 0x6aa6c9, skyBottom: 0xe9f6ff, fogColor: 0xcfe6f2, fogNear: 55, fogFar: 160,
    sunColor: 0xeaf6ff, sunIntensity: 2.4, ambientColor: 0xa9dcff, ambientIntensity: 1.0, snowTint: 0xeef9ff, snowfall: 0.15, theme: 'lake',
  },
  {
    index: 3, id: 'bowl', name: 'Blizzard Bowl', tagline: 'Whiteout arena. Two bosses. One plan: flank you.', bossName: 'SLUSH & SLEET',
    rounds: [
      { groups: [g('scrapper', 6, 0, 1), g('thief', 3, 3, 1.5)] },
      { groups: [g('spinner', 4, 0, 2), g('brute', 2, 4, 3)] },
      { groups: [g('brute', 3, 0, 3), g('spinner', 3, 3, 2), g('thief', 3, 6, 1.5)] },
      { boss: true, groups: [g('slush', 1, 1, 1), g('sleet', 1, 1.5, 1)] },
    ],
    enemyHpMult: 1.75, coinMult: 1.6, snowDepth: 0.7, snowRegenMult: 2.2, clearReward: 750,
    skyTop: 0x8a99a8, skyBottom: 0xdfe5ea, fogColor: 0xe2e8ee, fogNear: 28, fogFar: 95,
    sunColor: 0xdfe8ff, sunIntensity: 1.4, ambientColor: 0xd5dde8, ambientIntensity: 1.3, snowTint: 0xf4f7fa, snowfall: 1.0, theme: 'blizzard',
  },
  {
    index: 4, id: 'summit', name: 'Omega Summit', tagline: 'The factory at the top of the world. The final machine waits.', bossName: 'MEGAPLOW Ω',
    rounds: [
      { groups: [g('brute', 3, 0, 3), g('scrapper', 6, 2, 1)] },
      { groups: [g('spinner', 4, 0, 2), g('thief', 4, 2, 1.5), g('brute', 2, 6, 3)] },
      { groups: [g('scrapper', 8, 0, 0.8), g('spinner', 3, 3, 2), g('brute', 3, 6, 2.5)] },
      { boss: true, groups: [g('omega', 1, 1, 1)] },
    ],
    enemyHpMult: 2.1, coinMult: 1.8, snowDepth: 0.6, snowRegenMult: 1.3, clearReward: 1200,
    skyTop: 0x1b2347, skyBottom: 0xb46a8c, fogColor: 0x8a6f8f, fogNear: 40, fogFar: 140,
    sunColor: 0xffa7a0, sunIntensity: 1.9, ambientColor: 0x8f8fd8, ambientIntensity: 0.9, snowTint: 0xf6ecff, snowfall: 0.5, theme: 'peak',
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
