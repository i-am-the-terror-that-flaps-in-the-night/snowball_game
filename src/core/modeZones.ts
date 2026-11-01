import { ZONES, type ZoneDef } from '../config/zones';

/**
 * Venues that are not campaign arenas but used to borrow one (docs/level-overhaul.md "Follow-ups", Track E):
 *   - TUTORIAL_ZONE: the Training Yard, an explicit FLAT zone (no biome, no terrain, no ice), never a spread of ZONES[0]
 *     (which would inherit the glacier's terrain and ice sheets). The Tutorial loads its own small ramp / bowl terrain
 *     for the slope, jump and air-slam lessons and restores flat afterwards.
 *   - pickMenuZone: the main-menu backdrop, a random campaign biome per launch (arenas 1-5, never The Omega Works).
 */

/** Campaign arenas the menu backdrop may use (indices 0..MENU_BACKDROPS-1; arena 6 is too heavy and spoils the finale). */
export const MENU_BACKDROPS = 5;

/** The Training Yard: the classic snowy-pines yard look, flat snow, pays no coins (kills / strikes give nothing). */
export const TUTORIAL_ZONE: ZoneDef = {
  index: 0, id: 'tutorial', name: 'Training Yard', tagline: 'Learn the ropes on flat, friendly snow.', bossName: '',
  rounds: [{ groups: [] }],
  enemyHpMult: 1, coinMult: 0, snowDepth: 0.5, snowRegenMult: 1, clearReward: 0,
  skyTop: 0x2f5d8a, skyBottom: 0xf3d7b6, fogColor: 0xd9c9b8, fogNear: 45, fogFar: 150,
  sunColor: 0xffc890, sunIntensity: 2.2, ambientColor: 0xc9b9ff, ambientIntensity: 0.8, snowTint: 0xfff6ee, snowfall: 0.35,
  terrain: undefined, biome: undefined, theme: 'pines',
};

/** Menu backdrop for a random number r in [0, 1): one of the first MENU_BACKDROPS campaign arenas. */
export function pickMenuZone(r: number, zones: readonly ZoneDef[] = ZONES): ZoneDef {
  const n = Math.max(1, Math.min(MENU_BACKDROPS, zones.length));
  const i = Math.min(n - 1, Math.max(0, Math.floor(r * n)));
  return zones[i];
}
