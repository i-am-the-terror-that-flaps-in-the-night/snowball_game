import { describe, expect, it } from 'vitest';
import { Terrain } from '../src/world/Terrain';
import { D, FLOOR_Y, OMEGA_HATCHES, OMEGA_SPAWN, OMEGA_TERRAIN, TOWER_Y } from '../src/world/omega/layout';
import { CAMP_SECONDS, CampWatch, HATCH_MAX, HATCH_MIN, deckLeap, pickHatches } from '../src/world/omega/zone';

const terrain = new Terrain(OMEGA_TERRAIN);

describe('Omega Works spawning', () => {
  it('spawns near the player but never on top of them', () => {
    const picks = pickHatches(OMEGA_SPAWN.x, 0, OMEGA_SPAWN.z, 6);
    expect(picks).toHaveLength(6);
    for (const i of picks) {
      const h = OMEGA_HATCHES[i];
      const d = Math.hypot(h.x - OMEGA_SPAWN.x, h.z - OMEGA_SPAWN.z);
      expect(d).toBeGreaterThanOrEqual(HATCH_MIN);
      expect(d).toBeLessThanOrEqual(HATCH_MAX + 1);
    }
  });

  it('rotates through hatches between waves', () => {
    const a = pickHatches(0, 0, 60, 1, 0)[0];
    const b = pickHatches(0, 0, 60, 1, 1)[0];
    expect(a).not.toBe(b);
  });

  it('counts deck height, so a hatch on the deck overhead is not "near"', () => {
    // Standing in the undercroft right under a Floor hatch: that hatch is ~7 m up and still >= HATCH_MIN 3D away only
    // if far enough; the ground hatches nearby are preferred.
    const picks = pickHatches(-6, 0, 6, 3);
    for (const i of picks) expect(Math.hypot(OMEGA_HATCHES[i].x + 6, OMEGA_HATCHES[i].z - 6)).toBeGreaterThan(0);
    expect(picks.every((i) => i !== OMEGA_HATCHES.findIndex((h) => h.x === -6 && h.z === 6))).toBe(true);
  });

  it('falls back to the nearest hatches when none are in range', () => {
    const picks = pickHatches(0, 40, 0, 2);
    expect(picks.length).toBe(2);
  });
});

describe('MEGAPLOW deck leap', () => {
  it('does nothing when the player is on the same level', () => {
    expect(deckLeap(terrain, 0, 0, 60, 10, 0, 60)).toBeNull();
  });

  it('leaps onto the Assembly Floor and lands on it, short of the player', () => {
    const plan = deckLeap(terrain, 0, 0, 38, 0, FLOOR_Y, 5);
    expect(plan).not.toBeNull();
    const p = plan!;
    expect(p.y).toBeCloseTo(FLOOR_Y, 1);
    expect(terrain.surfaceAt(p.x, p.z, FLOOR_Y).deck).toBe(D.floor);
    expect(Math.hypot(p.x - 0, p.z - 5)).toBeLessThanOrEqual(4.5);
  });

  it('flies a clean arc (never through a deck slab) and reaches the landing point', () => {
    const cases: [number, number, number, number, number, number][] = [
      [14, 0, 38, -6, FLOOR_Y, 8], // ground -> Floor (over the south edge, beside the ramp)
      [62, 0, -20, 56, FLOOR_Y, -50], // ground -> NE platform
      [0, FLOOR_Y, 12, 12, TOWER_Y, -8], // Floor -> Tower
    ];
    for (const [bx, by, bz, px, py, pz] of cases) {
      const p = deckLeap(terrain, bx, by, bz, px, py, pz);
      expect(p, `${bx},${bz} -> ${px},${pz}`).not.toBeNull();
      const g = terrain.gravity;
      const N = 60;
      for (let k = 1; k < N; k++) {
        const t = (p!.t * k) / N;
        const x = bx + p!.vx * t;
        const z = bz + p!.vz * t;
        const y = by + p!.vy * t - 0.5 * g * t * t;
        for (const d of terrain.decks) {
          if (!terrain.inDeck(d, x, z, 1)) continue;
          const top = terrain.deckTop(d, x, z);
          const inside = y < top - 0.3 && y > top - d.thickness + 0.3;
          expect(inside, `arc ${bx},${bz}->${px},${pz} inside deck ${d.id} at t=${t.toFixed(2)}`).toBe(false);
        }
      }
      const T = p!.t;
      expect(by + p!.vy * T - 0.5 * g * T * T).toBeCloseTo(p!.y, 1);
      expect(bx + p!.vx * T).toBeCloseTo(p!.x, 1);
    }
  });

  it('ignores players out of range', () => {
    expect(deckLeap(terrain, -70, 0, 70, 52, FLOOR_Y, -52)).toBeNull();
  });

  it('only triggers after the player camps above the boss', () => {
    const w = new CampWatch();
    let ready = false;
    for (let t = 0; t < CAMP_SECONDS - 0.5; t += 0.1) ready = w.update(0.1, 0, FLOOR_Y);
    expect(ready).toBe(false);
    for (let t = 0; t < 1; t += 0.1) ready = w.update(0.1, 0, FLOOR_Y);
    expect(ready).toBe(true);
    expect(w.update(0.1, 0, 0)).toBe(false);
  });
});
