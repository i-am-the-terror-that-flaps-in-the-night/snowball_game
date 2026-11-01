import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GroundDecals, crustFade, crustRing } from '../src/world/biomes/GroundDecals';
import { Terrain } from '../src/world/Terrain';
import type { MaterialPatch, TerrainDef, TerrainShape } from '../src/world/Terrain';
import { lavaFringeFor, snowCellFor } from '../src/world/SnowField';
import { ZONES, brawlZone } from '../src/config/zones';

/* Ground decals over lava (src/world/biomes/GroundDecals.ts): flat pools on the bare ground, a crust ring over the
 * snow's melt fringe kept off ramps, normals from the ground only, and the Divide's scorch film on the snow grid. No
 * ice and no ramp decks here (those build canvas textures: ramps are built with the 'mars' biome, which has none). */

const VENT: MaterialPatch = { material: 'lava', x: -12, z: 6, r: 2 };
const RIVER: MaterialPatch = { material: 'lava', x: -20, z: -10, x2: -8, z2: -14, r: 1.6 };
const DEF: TerrainDef = { shapes: [{ kind: 'dome', x: -12, z: 0, r: 14, h: -1.2 }], patches: [VENT, RIVER] };

const meshes = (d: GroundDecals) => d.group.children as THREE.Mesh[];
const byShader = (d: GroundDecals, word: string) =>
  meshes(d).find((m) => (m.material as THREE.ShaderMaterial).fragmentShader?.includes(word))!;
const ys = (m: THREE.Mesh) => Array.from({ length: m.geometry.getAttribute('position').count }, (_, i) => m.geometry.getAttribute('position').getY(i));

describe('ground decals over lava', () => {
  it('lava pools lie flat on the bare ground, whatever the snow reports', () => {
    const t = new Terrain(DEF);
    let depth = 0.7; // e.g. the previous arena's snow still in the field when the world is dressed
    const d = new GroundDecals(t, 'divide', () => depth, 30);
    const lava = byShader(d, 'crack');
    const pos = lava.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo(t.ground(pos.getX(i), pos.getZ(i)) + 0.05, 5);
    depth = 0.2;
    d.update(1);
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i)).toBeCloseTo(t.ground(pos.getX(i), pos.getZ(i)) + 0.05, 5);
    d.dispose();
  });

  it('every lava patch gets a crust ring from under the pool edge out past the melt fringe, riding on the snow', () => {
    const ring = crustRing(VENT, VENT.r - 0.2, VENT.r + 1.8, 0.5);
    let lo = Infinity;
    let hi = 0;
    for (let i = 0; i < ring.xz.length; i += 2) {
      const r = Math.hypot(ring.xz[i] - VENT.x, ring.xz[i + 1] - VENT.z);
      lo = Math.min(lo, r);
      hi = Math.max(hi, r);
    }
    expect(lo).toBeCloseTo(VENT.r - 0.2, 5);
    expect(hi).toBeCloseTo(VENT.r + 1.8, 5);
    // capsule: every vertex is between the two offset curves of the capsule outline
    const cap = crustRing(RIVER, RIVER.r - 0.2, RIVER.r + 1.8, 0.5);
    const seg = (x: number, z: number) => {
      const vx = RIVER.x2! - RIVER.x;
      const vz = RIVER.z2! - RIVER.z;
      const k = Math.max(0, Math.min(1, ((x - RIVER.x) * vx + (z - RIVER.z) * vz) / (vx * vx + vz * vz)));
      return Math.hypot(x - RIVER.x - vx * k, z - RIVER.z - vz * k);
    };
    for (let i = 0; i < cap.xz.length; i += 2) {
      const r = seg(cap.xz[i], cap.xz[i + 1]);
      expect(r).toBeGreaterThan(RIVER.r - 0.2 - 1e-6);
      expect(r).toBeLessThan(RIVER.r + 1.8 + 1e-6);
    }

    const t = new Terrain(DEF);
    const depth = 0.6;
    const d = new GroundDecals(t, 'quarry', () => depth, 30);
    const crust = byShader(d, 'rim');
    expect(crust).toBeDefined();
    expect((crust.material as THREE.Material).transparent).toBe(true);
    const pos = crust.geometry.getAttribute('position');
    let outer = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const dv = Math.hypot(x - VENT.x, z - VENT.z);
      if (dv < VENT.r + 3) outer = Math.max(outer, dv); // the vent's own ring
      // on the snow (+ a few cm), never below the ground
      expect(pos.getY(i)).toBeGreaterThanOrEqual(t.ground(x, z) + depth);
      expect(pos.getY(i)).toBeLessThan(t.ground(x, z) + depth + 0.25);
    }
    expect(outer).toBeGreaterThanOrEqual(VENT.r + lavaFringeFor(0.5));
    d.dispose();
  });

  it('normals come from the ground alone and do not change when the snow does', () => {
    const t = new Terrain(DEF);
    let k = 0;
    // a lumpy "previous arena" field, then a different one
    const d = new GroundDecals(t, 'divide', (x, z) => 0.4 + 0.3 * Math.sin(x * 3 + k) * Math.cos(z * 2), 30);
    const before = meshes(d).map((m) => Array.from(m.geometry.getAttribute('normal').array as Float32Array));
    k = 1.7;
    d.update(1);
    meshes(d).forEach((m, i) => expect(Array.from(m.geometry.getAttribute('normal').array as Float32Array)).toEqual(before[i]));
    // the bowl's slope shows in the normals (they are not all straight up)
    const lava = byShader(d, 'crack');
    const n = lava.geometry.getAttribute('normal');
    let tilted = 0;
    for (let i = 0; i < n.count; i++) if (n.getY(i) < 0.995) tilted++;
    expect(tilted).toBeGreaterThan(0);
    d.dispose();
  });

  it("the Divide's scorch film sits on the snow grid's own vertices", () => {
    for (const half of [30, 90]) {
      const cell = half === 30 ? 0.5 : 1;
      const d = new GroundDecals(new Terrain(DEF), 'divide', () => 0.5, half);
      const scorch = byShader(d, 'uSide');
      const pos = scorch.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i += 97) {
        expect(Math.abs(pos.getX(i) / cell - Math.round(pos.getX(i) / cell))).toBeLessThan(1e-4);
        expect(Math.abs(pos.getZ(i) / cell - Math.round(pos.getZ(i) / cell))).toBeLessThan(1e-4);
      }
      expect(pos.count).toBe((half / cell + 1) * ((2 * half) / cell + 1));
      // a hair above the snow, below the lava pools' lift
      expect(Math.max(...ys(scorch).slice(0, 50).map((y, i) => y - 0.5 - new Terrain(DEF).ground(pos.getX(i), pos.getZ(i))))).toBeLessThan(0.05);
      d.dispose();
    }
  });

  type Ramp = Extract<TerrainShape, { kind: 'ramp' }>;
  /** Is (x, z) on a ramp: its face, lip and fall (toe -> lip + fall), across its full width? */
  const onRamp = (r: Ramp, x: number, z: number) => {
    const dx = x - r.x;
    const dz = z - r.z;
    const v = dx * Math.sin(r.rot) + dz * Math.cos(r.rot);
    const u = dx * Math.cos(r.rot) - dz * Math.sin(r.rot);
    return v >= 0 && v <= r.len + (r.fall ?? 1) - 0.1 && Math.abs(u) <= r.w / 2;
  };

  it('the crust ring never drapes a ramp: Inferno Quarry and Brawl Quarry jumps', () => {
    for (const [name, def, half] of [['Inferno Quarry', ZONES[1].terrain!, 30], ['Brawl Quarry', brawlZone('quarry').terrain!, 90]] as const) {
      const t = new Terrain(def);
      const ramps = def.shapes!.filter((s): s is Ramp => s.kind === 'ramp');
      const grow = lavaFringeFor(snowCellFor(2 * half + 8)) + 0.4;
      let near = 0;
      for (const p of def.patches!.filter((q) => q.material === 'lava')) {
        const ring = crustRing(p, p.r - 0.2, p.r + grow, 0.5);
        let shown = 0;
        for (let i = 0; i < ring.xz.length; i += 2) {
          const x = ring.xz[i];
          const z = ring.xz[i + 1];
          const f = crustFade(t, ramps, x, z);
          if (f > 0) {
            // no visible crust vertex on a ramp, nor over ground raised above the lava's own level (the fall)
            for (const r of ramps) expect(onRamp(r, x, z), `${name}: crust at ${x.toFixed(2)},${z.toFixed(2)} on a ramp`).toBe(false);
            expect(t.ground(x, z), `${name}: crust at ${x.toFixed(2)},${z.toFixed(2)}`).toBeLessThan(0.3);
          }
          if (f >= 1) shown++;
          if (ramps.some((r) => onRamp(r, x, z))) near++;
        }
        // the rest of the ring stays: most of it is untouched
        expect(shown / (ring.xz.length / 2), name).toBeGreaterThan(0.6);
      }
      expect(near, `${name}: the rings do reach the ramps (the case this guards)`).toBeGreaterThan(0);
    }
  });

  it('crust vertices on a ramp are faded, without the hull lift, and no drawn triangle touches one', () => {
    const ramp: Ramp = { kind: 'ramp', x: 0, z: 0, rot: 0, len: 5.5, w: 5, h: 1.6, fall: 1.2 };
    const lava: MaterialPatch = { material: 'lava', x: -2, z: 8.3, x2: 2, z2: 8.3, r: 1.3 };
    const t = new Terrain({ shapes: [ramp], patches: [lava] });
    const d = new GroundDecals(t, 'mars', () => 0.4, 30);
    const crust = byShader(d, 'rim');
    const pos = crust.geometry.getAttribute('position');
    const fade = crust.geometry.getAttribute('fade');
    expect(fade.count).toBe(pos.count);
    let faded = 0;
    let lit = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      expect(fade.getX(i)).toBeCloseTo(crustFade(t, [ramp], x, z), 4);
      if (onRamp(ramp, x, z)) {
        expect(fade.getX(i)).toBe(0);
        // plain ground + snow + lift: never hoisted by the hull samples
        expect(pos.getY(i)).toBeLessThan(t.ground(x, z) + 0.4 + 0.1);
        faded++;
      } else if (fade.getX(i) >= 1) lit++;
    }
    expect(faded).toBeGreaterThan(0);
    expect(lit).toBeGreaterThan(faded);
    const idx = crust.geometry.getIndex()!;
    for (let k = 0; k < idx.count; k += 3) {
      const m = Math.min(fade.getX(idx.getX(k)), fade.getX(idx.getX(k + 1)), fade.getX(idx.getX(k + 2)));
      expect(m).toBeGreaterThan(0);
    }
    // a vent with no ramp nearby keeps its whole ring (every vertex fully opaque)
    const flat = new GroundDecals(new Terrain(DEF), 'divide', () => 0.5, 30);
    const f2 = byShader(flat, 'rim').geometry.getAttribute('fade');
    for (let i = 0; i < f2.count; i++) expect(f2.getX(i)).toBe(1);
    d.dispose();
    flat.dispose();
  });
});
