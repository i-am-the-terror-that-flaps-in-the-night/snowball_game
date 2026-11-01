import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Progression } from '../src/core/Progression';
import type { GameContext } from '../src/core/types';
import { BIOME_EVERY, SPECIAL_WAVES, SURVIVAL_BASE, SURVIVAL_BIOMES, SurvivalManager, waveHpMult } from '../src/survival/SurvivalManager';
import { BIOME_ZONE, ZONES } from '../src/config/zones';
import { PLOW_SPAWN } from '../src/core/types';
import { dailyFor } from '../src/meta/daily';

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

describe('biome rotation', () => {
  /** Plow stand-in whose reset() behaves like Plow.reset(): spawn, full hp, grounded, still, no burn. */
  function mockPlow() {
    const plow = {
      hp: 50, maxHp: 100, heading: 0, speed: 6, airborne: true, vy: -3, burning: true,
      position: { x: 7, y: -1.24, z: -3 },
      reset: vi.fn((at?: { x: number; z: number; heading: number }) => {
        const sp = at ?? PLOW_SPAWN;
        Object.assign(plow, { hp: plow.maxHp, heading: sp.heading, speed: 0, airborne: false, vy: 0, burning: false });
        Object.assign(plow.position, { x: sp.x, y: 0, z: sp.z });
      }),
    };
    return plow;
  }

  function rig() {
    const p = new Progression();
    const ctx = {
      progression: p, plow: mockPlow(), stats: p.computeStats(), zone: null as unknown,
      world: { setZone: vi.fn() }, snow: { reset: vi.fn() }, ui: { toast: vi.fn() },
    };
    const sv = new SurvivalManager(ctx as unknown as GameContext);
    ctx.zone = sv.zone;
    sv.reset(null);
    return { ctx, sv };
  }

  it('builds on a neutral base, never on a campaign arena', () => {
    expect(SURVIVAL_BASE.terrain).toBeUndefined();
    expect('biome' in SURVIVAL_BASE).toBe(false);
    for (const z of ZONES) expect(SURVIVAL_BASE).not.toBe(z);
  });

  it('changes biome every 5 waves in campaign order, ground terrain only', () => {
    const { sv } = rig();
    expect(BIOME_EVERY).toBe(5);
    const seq = Array.from({ length: 30 }, (_, i) => sv.biomeFor(i + 1));
    expect(seq.slice(0, 5).every((b) => b === 'glacier')).toBe(true);
    expect(seq[5]).toBe('quarry');
    expect(seq[10]).toBe('mars');
    expect(seq[15]).toBe('divide');
    expect(seq[20]).toBe('plaza');
    expect(seq[25]).toBe('glacier');
    for (const b of SURVIVAL_BIOMES) expect(BIOME_ZONE[b].terrain?.decks ?? []).toHaveLength(0);
  });

  it('re-dresses the world when a boss block is cleared and parks the plow on the spawn', () => {
    const { ctx, sv } = rig();
    ctx.world.setZone.mockClear();
    for (let w = 1; w <= 4; w++) {
      sv.nextWave();
      sv.waveCleared();
    }
    expect(ctx.world.setZone).not.toHaveBeenCalled();
    expect(sv.boss).toBeNull();
    sv.nextWave();
    expect(sv.boss?.name).toBe('FROSTBYTE'); // the glacier's own boss closes its block
    sv.waveCleared();
    expect(sv.biome).toBe('quarry');
    expect(sv.zone.biome?.key).toBe('quarry');
    expect(sv.zone.terrain).toBe(BIOME_ZONE.quarry.terrain);
    expect(sv.zone.skyTop).toBe(BIOME_ZONE.quarry.skyTop);
    expect(sv.zone.name).toBe(`Survival · ${BIOME_ZONE.quarry.name}`);
    expect(ctx.world.setZone).toHaveBeenCalledWith(sv.zone);
    expect(ctx.snow.reset).toHaveBeenCalledWith(sv.zone);
    expect([ctx.plow.position.x, ctx.plow.position.z]).toEqual([PLOW_SPAWN.x, PLOW_SPAWN.z]);
  });

  it('re-seats the plow with its own reset on the new arena, keeping only the run hp', () => {
    const { ctx, sv } = rig();
    for (let w = 1; w <= 4; w++) {
      sv.nextWave();
      sv.waveCleared();
    }
    expect(ctx.plow.reset).not.toHaveBeenCalled();
    sv.nextWave();
    ctx.plow.hp = 37; // after the block: waveCleared's patch-up applies on top, then the switch must keep it
    sv.waveCleared();
    const hp = ctx.plow.hp;
    expect(hp).toBeGreaterThan(37);
    expect(hp).toBeLessThan(ctx.plow.maxHp);
    // reset() with no spawn point: PLOW_SPAWN, no spawn protection; after the world / snow carry the new terrain,
    // so Plow.reset() snaps the height to the new surface and clears airborne / velocity / burn
    expect(ctx.plow.reset).toHaveBeenCalledTimes(1);
    expect(ctx.plow.reset).toHaveBeenCalledWith();
    const resetAt = ctx.plow.reset.mock.invocationCallOrder[0];
    expect(resetAt).toBeGreaterThan(ctx.world.setZone.mock.invocationCallOrder.at(-1)!);
    expect(resetAt).toBeGreaterThan(ctx.snow.reset.mock.invocationCallOrder.at(-1)!);
    expect(ctx.plow).toMatchObject({ hp, airborne: false, vy: 0, speed: 0, burning: false, heading: PLOW_SPAWN.heading });
    expect(ctx.plow.position).toEqual({ x: PLOW_SPAWN.x, y: 0, z: PLOW_SPAWN.z });
  });

  it('seeds the Daily start biome and keeps the modifier on top of every biome', () => {
    const { ctx, sv } = rig();
    const spec = { ...dailyFor('2026-10-25'), modifierId: 'whiteout' as const };
    sv.reset(spec);
    expect(sv.biome).toBe(SURVIVAL_BIOMES[spec.seed % SURVIVAL_BIOMES.length]);
    const fog = sv.zone.fogFar;
    for (let w = 1; w <= 5; w++) {
      sv.nextWave();
      sv.waveCleared();
    }
    expect(sv.biome).toBe(SURVIVAL_BIOMES[(spec.seed + 1) % SURVIVAL_BIOMES.length]);
    expect(sv.zone.fogFar).toBe(fog); // whiteout survives the biome change
    expect(sv.zone.name).toBe('DAILY · Whiteout');
    expect(ctx.world.setZone).toHaveBeenCalled();
  });
});
