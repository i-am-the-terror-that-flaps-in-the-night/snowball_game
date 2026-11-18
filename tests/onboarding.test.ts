import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Progression } from '../src/core/Progression';
import { ZONES } from '../src/config/zones';
import { DAY_MOODS, NEUTRAL_GRADE, moodKey } from '../src/config/arenaLooks';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
});

describe('gradual Garage unlocks', () => {
  it('hides Gear until arena 1 is cleared and Focus until arena 2, unless already owned', async () => {
    const { garageUnlocks, freshGarage, announceOnce } = await import('../src/ui/unlocks');
    const p = new Progression();
    expect(garageUnlocks(p)).toEqual({ gear: false, focus: false });
    expect(freshGarage(p)).toBe(true);
    p.data.zones[ZONES[0].id] = { cleared: true, bestRound: 3 };
    expect(garageUnlocks(p)).toEqual({ gear: true, focus: false });
    p.data.zones[ZONES[1].id] = { cleared: true, bestRound: 4 };
    expect(garageUnlocks(p).focus).toBe(true);
    const q = new Progression();
    q.data.upgrades.focusWeapon = 1;
    expect(garageUnlocks(q).focus).toBe(true);
    expect(freshGarage(q)).toBe(false);
    expect(announceOnce('gear')).toBe(true);
    expect(announceOnce('gear')).toBe(false);
  });
});

describe('arena moods', () => {
  it('every day mood has a low sun, a positive grade and haze inside the fog range', () => {
    for (const [k, m] of Object.entries(DAY_MOODS)) {
      expect(m.sunElev, k).toBeGreaterThan(10);
      expect(m.sunElev, k).toBeLessThan(35);
      expect(m.fogNear, k).toBeLessThan(m.fogFar);
      expect(m.grade.contrast, k).toBeGreaterThanOrEqual(1);
      expect(m.grade.vignette, k).toBeLessThan(0.5);
    }
    expect(moodKey('glacier', 'lake')).toBe('glacier');
    expect(moodKey(null, 'omega')).toBe('omega');
    expect(NEUTRAL_GRADE.contrast).toBe(1);
  });
});
