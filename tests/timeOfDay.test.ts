import { describe, expect, it } from 'vitest';
import { resolveNight } from '../src/core/timeOfDay';
import { NIGHT, nightLook, nightZone } from '../src/world/environment/night';
import { BRAWL_ZONE, ZONES, brawlZone } from '../src/config/zones';
import { TUTORIAL_ZONE } from '../src/core/modeZones';

describe('time of day', () => {
  it('DAY never, NIGHT always, AUTO alternates (first arena at night, launch menu by day)', () => {
    for (let n = 0; n < 6; n++) {
      expect(resolveNight('day', n)).toBe(false);
      expect(resolveNight('night', n)).toBe(true);
    }
    expect([0, 1, 2, 3, 4].map((n) => resolveNight('auto', n))).toEqual([false, true, false, true, false]);
  });

  it('every venue has its own night look', () => {
    expect(nightLook(ZONES[0])).toBe(NIGHT.glacier);
    expect(nightLook(ZONES[1])).toBe(NIGHT.quarry);
    expect(nightLook(ZONES[2])).toBe(NIGHT.mars);
    expect(nightLook(ZONES[3])).toBe(NIGHT.divide);
    expect(nightLook(ZONES[4])).toBe(NIGHT.plaza);
    expect(nightLook(ZONES[5])).toBe(NIGHT.omega);
    expect(nightLook(BRAWL_ZONE)).toBe(NIGHT.brawl);
    expect(nightLook(brawlZone('snowdome'))).toBe(NIGHT.brawl);
    expect(nightLook(brawlZone('quarry'))).toBe(NIGHT.quarry);
    expect(nightLook(TUTORIAL_ZONE)).toBe(NIGHT.default);
  });

  it('night only swaps light / sky / fog colours: gameplay and layout fields are untouched', () => {
    const look = new Set(['skyTop', 'skyBottom', 'fogColor', 'sunColor', 'sunIntensity', 'ambientColor', 'ambientIntensity']);
    for (const z of [...ZONES, BRAWL_ZONE]) {
      const n = nightZone(z);
      for (const k of Object.keys(z) as (keyof typeof z)[]) if (!look.has(k)) expect(n[k]).toBe(z[k]);
      // dim but never pitch black
      expect(n.ambientIntensity).toBeGreaterThan(0.3);
      expect(n.sunIntensity).toBeLessThan(z.sunIntensity);
    }
  });
});

describe('PROTOCOL C is always night', () => {
  it('forceNight overrides a DAY setting for the current arena', async () => {
    const tod = await import('../src/core/timeOfDay');
    const { settings } = await import('../src/core/settings');
    const prev = settings.timeOfDay;
    settings.timeOfDay = 'day';
    tod.commitTimeOfDay();
    expect(tod.isNight()).toBe(false);
    tod.forceNight();
    expect(tod.isNight()).toBe(true);
    settings.timeOfDay = prev;
  });
});
