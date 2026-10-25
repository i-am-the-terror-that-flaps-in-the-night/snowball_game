import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Progression } from '../src/core/Progression';
import type { GameContext } from '../src/core/types';
import { SPECIAL_WAVES, SurvivalManager, waveHpMult } from '../src/survival/SurvivalManager';

let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});
afterEach(() => vi.unstubAllGlobals());

function manager() {
  const p = new Progression();
  const ctx = { progression: p, plow: { hp: 50, maxHp: 100 }, stats: p.computeStats(), zone: null as unknown, world: { setZone: vi.fn() }, ui: { toast: vi.fn() } };
  const sv = new SurvivalManager(ctx as unknown as GameContext);
  ctx.zone = sv.zone;
  sv.reset(null);
  return sv;
}

describe('special waves', () => {
  it('land on waves 3, 6, 8, 11, 13 ... and never on a boss wave', () => {
    const sv = manager();
    const specials: number[] = [];
    for (let w = 1; w <= 20; w++) {
      const sp = sv.specialFor(w);
      if (sp) specials.push(w);
      if (w % 5 === 0) expect(sp).toBeNull();
      if (sp) expect(w).toBeGreaterThanOrEqual(sp.from);
    }
    expect(specials).toEqual([3, 6, 8, 11, 13, 16, 18]);
  });

  it('the pit-stop preview matches the wave that is then played', () => {
    const sv = manager();
    for (let w = 1; w <= 15; w++) {
      const preview = sv.specialFor(w);
      sv.nextWave();
      expect(sv.special).toBe(preview);
    }
  });

  it('each special builds its own lineup and tuning', () => {
    for (const def of SPECIAL_WAVES) {
      const sv = manager();
      // Force this special onto wave 13 (its pool covers every special by then).
      let w = 0;
      for (let tries = 0; tries < 50 && sv.specialFor(13) !== def; tries++) sv.reset(null);
      expect(sv.specialFor(13)).toBe(def);
      while (w < 13) { sv.nextWave(); w++; }
      const types = new Set(sv.zone.rounds[0].groups.map((g) => g.type));
      const count = sv.zone.rounds[0].groups.reduce((n, g) => n + g.count, 0);
      expect(sv.zone.enemyHpMult).toBeCloseTo(waveHpMult(13) * def.hp);
      if (def.id === 'swarm') expect([...types]).toEqual(['scrapper']);
      if (def.id === 'swarm') expect(count).toBeGreaterThan(24);
      if (def.id === 'sawStorm') expect([...types]).toEqual(['spinner']);
      if (def.id === 'heavyMetal') expect([...types]).toEqual(['brute']);
      if (def.id === 'thiefRaid') expect(types.has('thief')).toBe(true);
      if (def.id === 'blitz') for (const g of sv.zone.rounds[0].groups) expect(g.interval).toBeLessThan(0.2);
      if (def.id === 'elite') expect(count).toBeLessThan(12);
    }
  });
});
