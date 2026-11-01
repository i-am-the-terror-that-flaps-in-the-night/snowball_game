import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SnowField, lavaFringeFor } from '../src/world/SnowField';
import { Terrain } from '../src/world/Terrain';
import { DEV_FEATURES, DEV_TERRAIN } from '../src/world/devTerrain';
import { ZONES } from '../src/config/zones';
import type { GameContext } from '../src/core/types';

function field(terrain: Terrain) {
  const zone = { ...ZONES[0], terrain: undefined };
  const ctx = { scene: new THREE.Scene(), zone, terrain, stats: { snowRegen: 0 } } as unknown as GameContext;
  const snow = new SnowField(ctx);
  return { snow, ctx, zone };
}

/** Height of the snow mesh vertex nearest to (x, z). */
function meshY(snow: SnowField, x: number, z: number): number {
  const mesh = (snow as unknown as { mesh: THREE.Mesh }).mesh;
  const pos = mesh.geometry.getAttribute('position');
  let best = Infinity;
  let y = 0;
  for (let i = 0; i < pos.count; i++) {
    const d = (pos.getX(i) - x) ** 2 + (pos.getZ(i) - z) ** 2;
    if (d < best) {
      best = d;
      y = pos.getY(i);
    }
  }
  return y;
}

describe('snow on terrain', () => {
  it('flat terrain: the snow top is just the depth (unchanged behaviour)', () => {
    const { snow } = field(new Terrain());
    expect(snow.topAt(3, 4)).toBe(snow.getDepth(3, 4));
    expect(meshY(snow, 3, 4)).toBeCloseTo(snow.getDepth(3, 4), 4);
  });

  it('the mesh follows the ground; depth stays "snow above the ground"', () => {
    const t = new Terrain(DEV_TERRAIN);
    const { snow } = field(t);
    const b = DEV_FEATURES.bowl;
    const d = snow.getDepth(b.x, b.z);
    expect(d).toBeGreaterThan(0.2);
    expect(snow.topAt(b.x, b.z)).toBeCloseTo(t.ground(b.x, b.z) + d, 5);
    expect(meshY(snow, b.x, b.z)).toBeCloseTo(t.ground(b.x, b.z) + d, 2);
  });

  it('no snow on lava, thin snow on ice', () => {
    const t = new Terrain(DEV_TERRAIN);
    const { snow, zone } = field(t);
    const l = DEV_FEATURES.lava;
    expect(snow.getDepth((l.x1 + l.x2) / 2, l.z)).toBe(0);
    expect(snow.getDepth(DEV_FEATURES.ice.x, DEV_FEATURES.ice.z)).toBeLessThan(zone.snowDepth * 0.5);
    // snow shoved onto lava melts away
    snow.addSnow((l.x1 + l.x2) / 2, l.z, 1, 2);
    expect(snow.getDepth((l.x1 + l.x2) / 2, l.z)).toBeGreaterThan(0);
    for (let i = 0; i < 40; i++) snow.update(0.25);
    expect(snow.getDepth((l.x1 + l.x2) / 2, l.z)).toBe(0);
  });

  it('snow thins smoothly toward lava (a melt fringe, no one-cell snow wall), fresh and mid-run alike', () => {
    const vent = { material: 'lava' as const, x: 3.2, z: -4.1, r: 2 };
    const check = (snow: SnowField, full: number) => {
      const F = lavaFringeFor(0.5);
      let prev = 0;
      // walk out of the vent along a few directions: depth rises monotonically from 0 to full over the fringe
      for (const a of [0, 0.7, 1.9, 3.3]) {
        prev = 0;
        for (let d = vent.r; d <= vent.r + F + 0.6; d += 0.1) {
          const v = snow.getDepth(vent.x + Math.cos(a) * d, vent.z + Math.sin(a) * d);
          expect(v).toBeGreaterThanOrEqual(prev - 0.02);
          prev = v;
        }
        // just outside the edge there is next to no snow (it used to be the full depth one cell out)
        expect(snow.getDepth(vent.x + Math.cos(a) * (vent.r + 0.25), vent.z + Math.sin(a) * (vent.r + 0.25))).toBeLessThan(full * 0.15);
        expect(snow.getDepth(vent.x + Math.cos(a) * (vent.r + F + 0.6), vent.z + Math.sin(a) * (vent.r + F + 0.6))).toBeGreaterThan(full * 0.6);
      }
      // the steepest step between neighbouring samples 0.25 m apart stays well under a full snow depth
      let worst = 0;
      for (let x = vent.x - 5; x <= vent.x + 5; x += 0.25)
        for (let z = vent.z - 5; z <= vent.z + 5; z += 0.25) worst = Math.max(worst, Math.abs(snow.getDepth(x + 0.25, z) - snow.getDepth(x, z)));
      expect(worst).toBeLessThan(full * 0.4);
    };
    const fresh = field(new Terrain({ patches: [vent] }));
    check(fresh.snow, fresh.zone.snowDepth);
    const t = new Terrain();
    const late = field(t);
    t.load({ patches: [vent] });
    late.snow.update(1 / 60);
    check(late.snow, late.zone.snowDepth);
  });

  it('a terrain swapped in mid-run is picked up on the next update', () => {
    const t = new Terrain();
    const { snow } = field(t);
    const b = DEV_FEATURES.bowl;
    expect(meshY(snow, b.x, b.z)).toBeGreaterThan(0);
    t.load(DEV_TERRAIN);
    snow.update(1 / 60);
    expect(meshY(snow, b.x, b.z)).toBeLessThan(-1.5);
  });
});
