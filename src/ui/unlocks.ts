import { ZONES } from '../config/zones';
import type { Progression } from '../core/Progression';

/* Gradual unlocks (onboarding): the Garage reveals its deeper systems as the player gets there, instead of all at
 * once on the first visit. Only the UI is gated (nothing is taken away from a save that already uses a system):
 *   - GEAR tab: after the first arena is cleared (or once any item is owned);
 *   - FOCUS cards: after the second arena is cleared (or once a Focus level is owned).
 * The duel garage always shows everything. Each reveal is announced once per browser (a "NEW" toast). */

const KEY = 'snowplow-showdown-unlocks';

export interface GarageUnlocks {
  gear: boolean;
  focus: boolean;
}

export function garageUnlocks(p: Progression): GarageUnlocks {
  const cleared = (i: number) => p.zoneRecord(ZONES[i].id).cleared || p.data.unlockedZones > i + 1;
  const ownsGear = Object.keys(p.data.gear?.owned ?? {}).length > 0;
  const ownsFocus = p.level('focusAbility') > 0 || p.level('focusWeapon') > 0;
  return { gear: cleared(0) || ownsGear, focus: cleared(1) || ownsFocus };
}

/** True the first time `what` is seen unlocked (then remembered). */
export function announceOnce(what: keyof GarageUnlocks): boolean {
  try {
    const seen = new Set((localStorage.getItem(KEY) ?? '').split(',').filter(Boolean));
    if (seen.has(what)) return false;
    seen.add(what);
    localStorage.setItem(KEY, [...seen].join(','));
    return true;
  } catch {
    return false;
  }
}

/** No upgrade bought yet (a brand-new garage): the first purchase gets a nudge. */
export function freshGarage(p: Progression): boolean {
  return Object.values(p.data.upgrades ?? {}).every((v) => !v);
}
