import type { Progression } from '../core/Progression';

/* Cross-feature progress totals, read straight from the save. Cosmetics use them as unlock gates; the
 * achievements / stats page shows them. */

/** Campaign challenge stars earned across every arena (1 per completed challenge). */
export function totalStars(p: Progression): number {
  let n = 0;
  for (const ids of Object.values(p.data.challenges ?? {})) n += ids.length;
  return n;
}

/** Achievements unlocked. */
export function achievementCount(p: Progression): number {
  return Object.values(p.data.achievements ?? {}).filter((v) => v > 0).length;
}

/** Add `n` to a lifetime counter (no save; callers batch and call p.commit()). */
export function bumpLifetime(p: Progression, key: string, n = 1): number {
  const life = (p.data.lifetime ??= {});
  life[key] = (life[key] ?? 0) + n;
  return life[key];
}

/** Raise a lifetime "best" counter to at least `v` (no save). */
export function maxLifetime(p: Progression, key: string, v: number): number {
  const life = (p.data.lifetime ??= {});
  life[key] = Math.max(life[key] ?? 0, Math.floor(v));
  return life[key];
}
