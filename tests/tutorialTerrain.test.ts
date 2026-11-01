import { describe, expect, it } from 'vitest';
import { Tutorial } from '../src/ui/Tutorial';
import { CAMPAIGN_ARENA_HALF } from '../src/core/types';
import { Terrain } from '../src/world/Terrain';
import type { GameContext } from '../src/core/types';

/** Ramp lesson layout: run-up, ramp (10 m), drop-off and a landing strip must fit inside the 60 m yard. */
const RAMP_PATH = 7 + 10 + 1.8 + 8;

describe('Tutorial terrain lessons', () => {
  it('lays the ramp so the whole jump fits inside the walls', () => {
    const lim = CAMPAIGN_ARENA_HALF;
    for (let x = -27; x <= 27; x += 1.5) {
      for (let z = -27; z <= 27; z += 1.5) {
        for (const heading of [0, 1.3, Math.PI, -2]) {
          const L = Tutorial.rampLayout(x, z, heading);
          // toe 7 m from the plow
          expect(Math.hypot(L.x - x, L.z - z)).toBeCloseTo(7);
          const ex = x + Math.sin(L.rot) * RAMP_PATH;
          const ez = z + Math.cos(L.rot) * RAMP_PATH;
          expect(Math.abs(ex)).toBeLessThan(lim);
          expect(Math.abs(ez)).toBeLessThan(lim);
          // the plow itself is not standing on the new ramp
          const t = new Terrain({ shapes: [{ kind: 'ramp', x: L.x, z: L.z, rot: L.rot, len: 10, w: 7, h: 2.8, fall: 1.8 }] });
          expect(t.ground(x, z)).toBe(0);
          // and the lip is where the ground drops away
          const lx = L.x + Math.sin(L.rot) * 10;
          const lz = L.z + Math.cos(L.rot) * 10;
          expect(t.ground(lx, lz)).toBeCloseTo(2.8);
        }
      }
    }
  });

  it('near the centre the ramp is laid straight ahead', () => {
    const L = Tutorial.rampLayout(1, 1.5, 0.5);
    expect(L.rot).toBe(0.5);
  });

  /** Absolute angle (rad) between the ramp and the plow's heading. */
  const off = (rot: number, heading: number) => Math.abs(Math.atan2(Math.sin(rot - heading), Math.cos(rot - heading)));

  it('lays the ramp in front of the plow whenever the walls allow (not behind the camera)', () => {
    // straight ahead with room: exactly along the heading
    expect(Tutorial.rampLayout(0, -20, 0).rot).toBe(0);
    expect(Tutorial.rampLayout(-15, 5, Math.PI / 2).rot).toBe(Math.PI / 2);
    // facing a nearby wall: turned the least it takes, never laid behind (the checker's "Ramp: 14 m" case)
    let front = 0;
    let n = 0;
    for (let x = -24; x <= 24; x += 4) {
      for (let z = -24; z <= 24; z += 4) {
        for (let h = -Math.PI; h < Math.PI; h += Math.PI / 8) {
          const L = Tutorial.rampLayout(x, z, h);
          n++;
          if (off(L.rot, h) <= 1.2 + 1e-9) front++;
        }
      }
    }
    expect(front / n).toBeGreaterThan(0.8);
    const wall = Tutorial.rampLayout(0, 24, 0);
    expect(off(wall.rot, 0)).toBeGreaterThan(Math.PI / 2); // no room ahead at all: turned toward the centre
    const angled = Tutorial.rampLayout(10, 10, 0.3);
    expect(off(angled.rot, 0.3)).toBeLessThanOrEqual(1.2 + 1e-9);
  });

  it('opens the bowl in front of the plow, inside the walls and never under the plow', () => {
    const lim = CAMPAIGN_ARENA_HALF - 10 - 1;
    for (let x = -28; x <= 28; x += 2) {
      for (let z = -28; z <= 28; z += 2) {
        for (let h = -Math.PI; h < Math.PI; h += Math.PI / 6) {
          const B = Tutorial.bowlLayout(x, z, h);
          expect(Math.abs(B.x)).toBeLessThanOrEqual(lim + 1e-9);
          expect(Math.abs(B.z)).toBeLessThanOrEqual(lim + 1e-9);
          expect(Math.hypot(B.x - x, B.z - z)).toBeGreaterThanOrEqual(12 - 1e-9);
        }
      }
    }
    const B = Tutorial.bowlLayout(0, -10, 0);
    expect(B.x).toBeCloseTo(0);
    expect(B.z).toBeCloseTo(3);
  });

  it('runs the terrain lessons only when the plow exposes the airborne / dive contract', () => {
    const terrain = new Terrain();
    const ok = { terrain, plow: { airborne: false, vy: 0, dive: () => {} } } as unknown as GameContext;
    const old = { terrain, plow: {} } as unknown as GameContext;
    expect(Tutorial.terrainReady(ok)).toBe(true);
    expect(Tutorial.terrainReady(old)).toBe(false);
  });
});
