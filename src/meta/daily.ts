import type { Progression } from '../core/Progression';

/* DAILY SURVIVAL: one seeded Survival run per local day. The day key ('YYYY-MM-DD') hashes to a seed for
 * the wave generator (SurvivalManager), and the day's modifier comes from a seeded rotation (every modifier
 * once per 8 days, never the same twice in a row), so everyone playing on the same date gets the same
 * modifier and the same wave lineup. The best wave per day lives in
 * save.dailyBest (pruned to the last DAILY_KEEP days) and never touches the normal Survival best. */

export interface DailySpec {
  /** Local day key 'YYYY-MM-DD'. */
  key: string;
  /** RNG seed derived from the key. */
  seed: number;
  /** Modifier id for the day. */
  modifierId: string;
}

export type DailyModifierId =
  | 'deepSnow' | 'glassCannon' | 'overclocked' | 'swarm' | 'thiefNight' | 'bossRush' | 'whiteout' | 'heavyHitters';

export interface DailyModifier {
  id: DailyModifierId;
  name: string;
  icon: string;
  /** One-line rule text (menus, toasts, results). */
  desc: string;
}

/** The day's twist. SurvivalManager applies them (zone tweaks, wave mix, adjustStats). */
export const DAILY_MODIFIERS: readonly DailyModifier[] = [
  { id: 'deepSnow', name: 'Deep Snow', icon: '❄️', desc: 'Twice the snow, and it grows back fast.' },
  { id: 'glassCannon', name: 'Glass Cannon', icon: '💥', desc: '+50% damage dealt. -40% max HP.' },
  { id: 'overclocked', name: 'Overclocked', icon: '⏱️', desc: 'Every cooldown is 30% shorter.' },
  { id: 'swarm', name: 'Swarm', icon: '🐝', desc: 'Way more bots. Way less armor.' },
  { id: 'thiefNight', name: 'Thief Night', icon: '🦝', desc: 'Snow thieves everywhere. Guard your ball.' },
  { id: 'bossRush', name: 'Boss Rush', icon: '☠', desc: 'A boss every 3rd wave instead of every 5th.' },
  { id: 'whiteout', name: 'Whiteout', icon: '🌫️', desc: 'Thick fog and a heavy blizzard.' },
  { id: 'heavyHitters', name: 'Heavy Hitters', icon: '🥊', desc: 'Bots hit 40% harder and pay 50% more.' },
];

/** Daily runs pay a little extra on kills and wave bonuses. */
export const DAILY_COIN_MULT = 1.25;
/** Days of dailyBest history kept in the save. */
export const DAILY_KEEP = 30;

/** Local-date day key 'YYYY-MM-DD'. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 32-bit FNV-1a string hash (stable across platforms). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: tiny seeded PRNG returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Whole days since 1970-01-01 for a day key (calendar arithmetic, no time zone drift). */
function dayNumber(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** Seeded shuffle of the modifier indices for one block of DAILY_MODIFIERS.length days. */
function blockOrder(block: number): number[] {
  const rng = mulberry32(hashString(`snowplow-daily-block:${block}`));
  const order = DAILY_MODIFIERS.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** Modifier for a day: every modifier once per block of days (in a seeded order), never twice in a row. */
function modifierIndex(day: number): number {
  const n = DAILY_MODIFIERS.length;
  const block = Math.floor(day / n);
  const order = blockOrder(block);
  // Only slots 0/1 are ever swapped, so the previous block's last slot is stable.
  if (order[0] === blockOrder(block - 1)[n - 1]) [order[0], order[1]] = [order[1], order[0]];
  return order[day - block * n];
}

/** The Daily for a given day key. */
export function dailyFor(key: string): DailySpec {
  const seed = hashString(`snowplow-daily:${key}`);
  return { key, seed, modifierId: DAILY_MODIFIERS[modifierIndex(dayNumber(key))].id };
}

/** Today's daily run (local date). */
export function todaysDaily(now = new Date()): DailySpec {
  return dailyFor(dayKey(now));
}

/** Modifier of a spec (falls back to the first one for unknown ids). */
export function dailyModifier(spec: DailySpec): DailyModifier {
  return DAILY_MODIFIERS.find((m) => m.id === spec.modifierId) ?? DAILY_MODIFIERS[0];
}

/** Best wave on that day (0 = not played). */
export function dailyBest(p: Progression, key: string): number {
  return p.data.dailyBest?.[key] ?? 0;
}

/** Record a Daily result. Returns true on a new best for that day. Prunes history to the newest DAILY_KEEP
 *  days. Edits p.data only; the caller saves. */
export function recordDaily(p: Progression, key: string, wave: number): boolean {
  const map = (p.data.dailyBest ??= {});
  const newBest = wave > (map[key] ?? 0);
  if (newBest) map[key] = wave;
  const keys = Object.keys(map).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - DAILY_KEEP))) delete map[k];
  return newBest;
}

/** The last `n` days ending at `key` (oldest first) with their best wave (0 = not played). */
export function dailyHistory(p: Progression, key: string, n = 7): { key: string; best: number }[] {
  const [y, m, d] = key.split('-').map(Number);
  const out: { key: string; best: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = dayKey(new Date(y, m - 1, d - i));
    out.push({ key: k, best: dailyBest(p, k) });
  }
  return out;
}

/** 'Sun 25 Oct' style label for a day key. */
export function dayLabel(key: string, withWeekday = true): string {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const mon = date.toLocaleString('en', { month: 'short' });
  const wd = date.toLocaleString('en', { weekday: 'short' });
  return withWeekday ? `${wd} ${d} ${mon}` : `${d} ${mon}`;
}

/* The Daily currently being played (set by SurvivalManager.reset, null on normal Survival runs) so the pit
 * stop and results screen can show the day's rules without threading it through the shared UI contracts. */
let active: DailySpec | null = null;

export function setActiveDaily(spec: DailySpec | null): void {
  active = spec;
}

export function activeDaily(): DailySpec | null {
  return active;
}

/** Main-menu DAILY button label (HTML). */
export function dailyButtonLabel(p: Progression): string {
  const spec = todaysDaily();
  const mod = dailyModifier(spec);
  const best = dailyBest(p, spec.key);
  return `📅 DAILY <small class="ss-daily-sub">${mod.name}${best > 0 ? ` · best ${best}` : ''}</small>`;
}
