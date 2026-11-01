import { describe, expect, it } from 'vitest';
import { STEP_UP, Terrain, makeSurface } from '../src/world/Terrain';

describe('Terrain', () => {
  it('is flat and inactive by default', () => {
    const t = new Terrain();
    expect(t.active).toBe(false);
    const s = t.surfaceAt(3, -4);
    expect(s.y).toBe(0);
    expect(s.ny).toBe(1);
    expect(s.deck).toBe(-1);
    expect(t.ceilingAt(0, 0, 0)).toBe(Infinity);
  });

  it('ramps rise to the lip and drop off past it', () => {
    const t = new Terrain({ shapes: [{ kind: 'ramp', x: 0, z: 0, rot: 0, len: 8, w: 6, h: 2 }] });
    expect(t.ground(0, -1)).toBe(0);
    expect(t.ground(0, 4)).toBeCloseTo(1, 5);
    expect(t.ground(0, 8)).toBeCloseTo(2, 5);
    expect(t.ground(0, 10)).toBe(0);
    expect(t.ground(10, 4)).toBe(0); // beside the ramp
    const s = t.surfaceAt(0, 4);
    expect(s.gz).toBeGreaterThan(0.2); // climbs along +z
  });

  it('bowls are depressions with a downhill gradient toward the middle', () => {
    const t = new Terrain({ shapes: [{ kind: 'dome', x: 0, z: 0, r: 10, h: -3 }] });
    expect(t.ground(0, 0)).toBeCloseTo(-3, 5);
    const s = t.surfaceAt(5, 0);
    expect(s.gx).toBeGreaterThan(0); // ground rises going +x, so gravity pulls -x (inward)
  });

  it('reports patch materials', () => {
    const t = new Terrain({ patches: [{ material: 'lava', x: 0, z: 0, r: 2, x2: 10, z2: 0 }, { material: 'ice', x: 0, z: 20, r: 5 }] });
    expect(t.materialAt(5, 1)).toBe('lava');
    expect(t.materialAt(0, 18)).toBe('ice');
    expect(t.materialAt(0, 10)).toBe('snow');
  });

  describe('decks', () => {
    const bridge = { id: 1, x: 0, z: 0, hw: 4, hd: 10, rot: 0, top: 5, thickness: 0.6 };
    const block = { id: 2, x: 20, z: 0, hw: 3, hd: 3, rot: 0, top: 2, thickness: 2 };
    const ramp = { id: 3, x: 0, z: -15, hw: 3, hd: 5, rot: 0, top: 0, rise: 5, thickness: 0.4 };
    const t = new Terrain({ decks: [bridge, block, ramp] });

    it('keeps you on a bridge when on it and under it when below', () => {
      expect(t.surfaceAt(0, 0, 5).y).toBe(5);
      expect(t.surfaceAt(0, 0, 5).deck).toBe(1);
      expect(t.surfaceAt(0, 0, 0).y).toBe(0);
      expect(t.surfaceAt(0, 0, 0).deck).toBe(-1);
      expect(t.surfaceAt(0, 0).y).toBe(5); // topmost by default
    });

    it('bridges are ceilings below, blocks are walls', () => {
      expect(t.ceilingAt(0, 0, 0)).toBeCloseTo(4.4, 5);
      expect(t.wallAt(0, 0, 0, 1.8, 1)).toBeNull(); // drive under the bridge
      expect(t.wallAt(20, 0, 0, 1.8, 1)?.id).toBe(2); // the block is solid
      expect(t.wallAt(20, 0, 2, 1.8, 1)).toBeNull(); // standing on top of it
      const out = { x: 0, z: 0 };
      t.pushOut(block, 18, 0.5, 1, out);
      expect(out.x).toBeCloseTo(16, 5);
    });

    it('sloped decks are ramps you can climb within STEP_UP', () => {
      const s = makeSurface();
      let y = 0;
      for (let z = -20; z <= -10; z += 0.25) y = t.surfaceAt(0, z, y, s).y;
      expect(y).toBeCloseTo(5, 5);
      expect(5 / 10).toBeLessThan(STEP_UP / 0.25); // per-step climb fits STEP_UP
    });

    it('pistons move over time', () => {
      const p = new Terrain({ decks: [{ id: 9, x: 0, z: 0, hw: 2, hd: 2, rot: 0, top: 1, thickness: 1, piston: { amp: 3, period: 4, phase: 0 } }] });
      expect(p.surfaceAt(0, 0).y).toBeCloseTo(1, 5);
      p.update(2);
      expect(p.surfaceAt(0, 0).y).toBeCloseTo(4, 5);
    });

    it('raycasts hit decks and ground', () => {
      const hit = t.raycast(0, 1, -30, 0, 0, 1, 100);
      expect(hit?.what).toBe(3); // the ramp deck's bounding box
      const down = t.raycast(30, 5, 30, 0, -1, 0, 20);
      expect(down?.y).toBeCloseTo(0, 1);
      expect(t.lineOfSight(30, 1, 30, 30, 1, 40)).toBe(true);
    });
  });
});
