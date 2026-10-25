import type { Progression } from '../core/Progression';

/* STUB (scaffold) — the daily builder replaces this file: one seeded Survival run per day + a modifier. */

export interface DailySpec {
  /** Local day key 'YYYY-MM-DD'. */
  key: string;
  /** RNG seed derived from the key. */
  seed: number;
  /** Modifier id for the day. */
  modifierId: string;
}

/** Today's daily run (local date). */
export function todaysDaily(now = new Date()): DailySpec {
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return { key, seed: 0, modifierId: 'none' };
}

/** Main-menu DAILY button label (HTML). */
export function dailyButtonLabel(p: Progression): string {
  void p;
  return '📅 DAILY';
}
