import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { COSMETIC_BY_ID } from '../src/config/cosmetics';
import {
  GhostFx, MAX_GHOST, MAX_SOULS, SOUL_DART_MAX, SOUL_RISE, SOUL_RISE_H, flameHalfWidth, soulPose,
} from '../src/fx/ghostFx';

describe('Ghostfire / Soul Harvest catalog entries', () => {
  it('Ghostfire is a 1800-coin, 15-star trail', () => {
    const d = COSMETIC_BY_ID.get('trail_ghostfire')!;
    expect(d.slot).toBe('trail');
    expect(d.price).toBe(1800);
    expect(d.req).toEqual({ stars: 15 });
    if (d.slot === 'trail') {
      expect(d.style).toBe('ghostfire');
      expect(d.colors).toContain(0xb04dff);
    }
  });

  it('Soul Harvest is a 2000-coin, 15-achievement kill effect', () => {
    const d = COSMETIC_BY_ID.get('kill_soul')!;
    expect(d.slot).toBe('kill');
    expect(d.price).toBe(2000);
    expect(d.req).toEqual({ achievements: 15 });
    if (d.slot === 'kill') {
      expect(d.style).toBe('soul');
      expect(d.icon).toBe('👻');
    }
  });
});

describe('ghost shapes', () => {
  it('flame teardrop: round 0.5 bottom, tapering to a point at the tip', () => {
    expect(flameHalfWidth(-0.4)).toBeCloseTo(0.5);
    expect(flameHalfWidth(-0.9)).toBeCloseTo(0, 5);
    expect(flameHalfWidth(1)).toBeCloseTo(0, 5);
    expect(flameHalfWidth(0.3)).toBeLessThan(flameHalfWidth(-0.2));
  });

  it('soul spiral climbs and widens over the rise', () => {
    const a = soulPose(0, 0, new THREE.Vector3());
    const b = soulPose(SOUL_RISE, 0, new THREE.Vector3());
    expect(b.y - a.y).toBeCloseTo(SOUL_RISE_H, 5);
    expect(Math.hypot(b.x, b.z)).toBeGreaterThan(Math.hypot(a.x, a.z));
    // Past the rise it holds the top (no runaway climb).
    expect(soulPose(SOUL_RISE * 3, 0, new THREE.Vector3()).y).toBeCloseTo(b.y, 5);
  });
});

describe('GhostFx pools', () => {
  it('a parked puff is smoke only; moving lays a track; dash thickens the smoke and adds a streak', () => {
    // High rolls: no optional embers / lightning / wisps / chain links, so only the fixed sprites count.
    const r = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const count = (moved: number, dash: boolean) => {
      const g = new GhostFx(null);
      g.trail(0, 0.9, 0, 0, 0, moved, dash);
      return g.n;
    };
    expect(count(0, false)).toBe(2); // two smoke puffs
    expect(count(0.5, false)).toBe(3); // + track mark
    expect(count(0.5, true)).toBe(5); // three smoke puffs + track + dash streak
    r.mockRestore();
  });

  it('low rolls add the ember flame, lightning inside the smoke and a wisp', () => {
    const r = vi.spyOn(Math, 'random').mockReturnValue(0.01);
    const g = new GhostFx(null);
    g.trail(0, 0.9, 0, 0, 0, 0, false);
    expect(g.n).toBe(5); // ember + two smoke puffs + lightning + wisp
    r.mockRestore();
  });

  it('never grows past its cap', () => {
    const g = new GhostFx(null);
    for (let i = 0; i < MAX_GHOST * 2; i++) g.trail(0, 0.9, 0, 0, 0, 0.5, true);
    expect(g.n).toBe(MAX_GHOST);
    for (let i = 0; i < MAX_SOULS * 3; i++) g.soul(new THREE.Vector3(), null);
    expect(g.stats.souls).toBe(MAX_SOULS);
  });

  it('a soul spirals up, then darts home to its (moving) target and lands', () => {
    const g = new GhostFx(null);
    const target = new THREE.Vector3(12, 0, -5);
    g.soul(new THREE.Vector3(0, 0, 0), target);
    let t = 0;
    while (g.stats.souls > 0 && t < SOUL_RISE + SOUL_DART_MAX + 1) {
      g.update(1 / 60);
      target.x += 0.05; // the plow keeps driving
      t += 1 / 60;
    }
    expect(g.stats.souls).toBe(0);
    expect(t).toBeGreaterThan(SOUL_RISE);
    expect(t).toBeLessThan(SOUL_RISE + SOUL_DART_MAX);
  });

  it('a soul with no target just fades after the rise; clear() empties everything', () => {
    const g = new GhostFx(null);
    g.soul(new THREE.Vector3(), null);
    for (let i = 0; i < Math.ceil((SOUL_RISE + 0.1) * 60); i++) g.update(1 / 60);
    expect(g.stats.souls).toBe(0);
    g.trail(0, 1, 0, 0, 0, 1, true);
    g.soul(new THREE.Vector3(), null);
    g.clear();
    expect(g.stats).toEqual({ sprites: 0, souls: 0 });
    expect(g.mesh.visible).toBe(false);
  });
});
