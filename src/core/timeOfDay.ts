import { settings, type TimeOfDay } from './settings';

/**
 * Time of day (Settings › Time of day). Purely cosmetic and local: each client lights its own arena (fine in the
 * online Duel), nothing in the simulation reads it. Decided once per arena start (Game.arenaStart ->
 * commitTimeOfDay), so a mid-run re-dress (a Survival biome switch) keeps the run's look; the menu backdrop at launch
 * uses the setting as is (AUTO starts with a day menu).
 *
 * AUTO alternates by arena start: the 1st, 3rd, 5th... arena of a session at NIGHT, the others by DAY.
 */

/** Pure: is arena start number `n` (1 = the first of the session; 0 = the launch menu) a night one? */
export function resolveNight(t: TimeOfDay, n: number): boolean {
  return t === 'night' || (t === 'auto' && n % 2 === 1);
}

let starts = 0;
let night: boolean | null = null;

/** Arena start: count it and decide day / night for this arena. */
export function commitTimeOfDay(): void {
  starts++;
  night = resolveNight(settings.timeOfDay, starts);
}

/** Night for the arena being built now. */
export function isNight(): boolean {
  return night ?? resolveNight(settings.timeOfDay, 0);
}
