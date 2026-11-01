/**
 * The Omega Works set dressing: everything around the playfield that isn't a deck.
 *
 *   - Perimeter factory walls at the 160 m edge: light steel panels, a cyan neon strip along the top and a hazard band
 *     at the base, with the three gate openings (OMEGA_GATES) left clear.
 *   - Corner light towers with magenta beacons, and a ring of smokestacks / factory blocks on the skyline with
 *     ember-glowing tops (outside the walls, fog-faded).
 *   - Floor hatches (OMEGA_HATCHES): round hazard-ringed plates with a glowing core, where bots rise out.
 *   - A giant Ω sign over the north wall.
 *
 * Static parts are merged per material (a handful of draw calls); the beacons and hatch cores pulse in update().
 * Usage: `const set = new OmegaSet(terrain); scene.add(set.group); set.update(t)`; `set.dispose()` on leave.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Terrain } from '../Terrain';
import { OMEGA_GATES, OMEGA_HALF, OMEGA_HATCHES } from './layout';

const WALL_H = 9;
const WALL_T = 1.4;
const GATE_W = 9;
const NEON_CYAN = 0x18e8ff;
const NEON_MAGENTA = 0xff2bd6;
const EMBER = 0xff6a1a;

/** Merge geometries placed with matrices, then dispose the sources. */
function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

export class OmegaSet {
  readonly group = new THREE.Group();
  private readonly owned: { dispose(): void }[] = [];
  private readonly pulse: THREE.MeshBasicMaterial[] = [];
  private readonly hatchMat: THREE.MeshBasicMaterial;

  constructor(terrain: Terrain) {
    this.group.name = 'omega-set';
    const B = OMEGA_HALF;
    const steel = this.own(new THREE.MeshStandardMaterial({ color: 0x8c93a3, metalness: 0.3, roughness: 0.55 }));
    const rib = this.own(new THREE.MeshStandardMaterial({ color: 0x5c6373, metalness: 0.35, roughness: 0.45 }));
    const neon = this.own(new THREE.MeshBasicMaterial({ color: NEON_CYAN, toneMapped: false }));
    const hazard = this.own(new THREE.MeshBasicMaterial({ color: 0xffd400, toneMapped: false }));
    const beacon = this.own(new THREE.MeshBasicMaterial({ color: NEON_MAGENTA, toneMapped: false, transparent: true }));
    const ember = this.own(new THREE.MeshBasicMaterial({ color: EMBER, toneMapped: false, transparent: true }));
    this.hatchMat = this.own(new THREE.MeshBasicMaterial({ color: NEON_MAGENTA, toneMapped: false, transparent: true }));
    this.pulse.push(beacon, ember);

    // ---- perimeter walls, split around the gates
    const wallParts: THREE.BufferGeometry[] = [];
    const ribParts: THREE.BufferGeometry[] = [];
    const neonParts: THREE.BufferGeometry[] = [];
    const hazParts: THREE.BufferGeometry[] = [];
    const sides = [
      { axis: 'x' as const, fixed: -(B + WALL_T / 2), ry: 0 }, // north (z = -B)
      { axis: 'x' as const, fixed: B + WALL_T / 2, ry: 0 }, // south
      { axis: 'z' as const, fixed: -(B + WALL_T / 2), ry: Math.PI / 2 }, // west (x = -B)
      { axis: 'z' as const, fixed: B + WALL_T / 2, ry: Math.PI / 2 }, // east
    ];
    for (const side of sides) {
      // gate openings on this side (centre along the side's axis)
      const gaps = OMEGA_GATES.filter((g) =>
        side.axis === 'x' ? Math.sign(g.z) === Math.sign(side.fixed) && Math.abs(g.z) > B : Math.sign(g.x) === Math.sign(side.fixed) && Math.abs(g.x) > B,
      ).map((g) => (side.axis === 'x' ? g.x : g.z));
      const cuts = [-B - WALL_T, ...gaps.flatMap((c) => [c - GATE_W / 2, c + GATE_W / 2]), B + WALL_T];
      for (let i = 0; i < cuts.length; i += 2) {
        const a = cuts[i];
        const b = cuts[i + 1];
        const len = b - a;
        if (len <= 0.1) continue;
        const mid = (a + b) / 2;
        const [x, z] = side.axis === 'x' ? [mid, side.fixed] : [side.fixed, mid];
        const base = terrain.ground(x * 0.97, z * 0.97); // half-pipe bank height at the wall
        wallParts.push(box(len, WALL_H, WALL_T, x, base + WALL_H / 2, z, side.ry));
        neonParts.push(box(len, 0.22, WALL_T + 0.1, x, base + WALL_H - 0.35, z, side.ry));
        hazParts.push(box(len, 0.6, WALL_T + 0.08, x, base + 0.7, z, side.ry));
        // vertical ribs every 8 m
        for (let s = a + 4; s < b - 1; s += 8) {
          const [rx, rz] = side.axis === 'x' ? [s, side.fixed] : [side.fixed, s];
          ribParts.push(box(0.7, WALL_H + 0.6, WALL_T + 0.5, rx, base + (WALL_H + 0.6) / 2, rz, side.ry));
        }
      }
    }
    this.mesh(merged(wallParts), steel, true);
    this.mesh(merged(ribParts), rib, true);
    this.mesh(merged(neonParts), neon);
    this.mesh(merged(hazParts), hazard);

    // ---- corner light towers with beacons
    const towerParts: THREE.BufferGeometry[] = [];
    const beaconParts: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = sx * (B + 6);
        const z = sz * (B + 6);
        towerParts.push(box(2.2, 26, 2.2, x, 13, z));
        towerParts.push(box(6, 1.2, 6, x, 26, z));
        beaconParts.push(box(1.6, 1.6, 1.6, x, 27.6, z));
      }
    }
    this.mesh(merged(towerParts), rib, true);
    this.mesh(merged(beaconParts), beacon);

    // ---- skyline: smokestacks + factory blocks outside the walls (deterministic layout)
    const stackParts: THREE.BufferGeometry[] = [];
    const blockParts: THREE.BufferGeometry[] = [];
    const emberParts: THREE.BufferGeometry[] = [];
    let seed = 1337;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2 + rnd() * 0.12;
      const r = B + 30 + rnd() * 45;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      if (i % 2 === 0) {
        const h = 30 + rnd() * 40;
        const rad = 2 + rnd() * 2.5;
        const g = new THREE.CylinderGeometry(rad * 0.8, rad, h, 10);
        g.translate(x, h / 2, z);
        stackParts.push(g);
        const e = new THREE.CylinderGeometry(rad * 0.82, rad * 0.82, 1.2, 10);
        e.translate(x, h - 0.4, z);
        emberParts.push(e);
      } else {
        const w = 14 + rnd() * 20;
        const h = 12 + rnd() * 18;
        blockParts.push(box(w, h, 10 + rnd() * 14, x, h / 2, z, a));
      }
    }
    this.mesh(merged(stackParts), steel);
    this.mesh(merged(blockParts), rib);
    this.mesh(merged(emberParts), ember);

    // ---- hatches
    const ringGeo = new THREE.RingGeometry(1.25, 1.75, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const coreGeo = new THREE.CircleGeometry(1.15, 24);
    coreGeo.rotateX(-Math.PI / 2);
    const rings: THREE.BufferGeometry[] = [];
    const cores: THREE.BufferGeometry[] = [];
    for (const h of OMEGA_HATCHES) {
      const y = terrain.surfaceAt(h.x, h.z, h.deck < 0 ? 0 : Infinity).y + 0.07;
      rings.push(ringGeo.clone().translate(h.x, y, h.z));
      cores.push(coreGeo.clone().translate(h.x, y + 0.01, h.z));
    }
    ringGeo.dispose();
    coreGeo.dispose();
    this.mesh(merged(rings), hazard).renderOrder = 1;
    this.mesh(merged(cores), this.hatchMat).renderOrder = 1;

    // ---- the Ω sign over the north wall
    this.group.add(this.omegaSign(0, WALL_H + 9, -(B + 2)));
  }

  /** A big neon Ω built from a torus arc + two feet, magenta with a cyan frame. */
  private omegaSign(x: number, y: number, z: number): THREE.Object3D {
    const g = new THREE.Group();
    const mag = this.own(new THREE.MeshBasicMaterial({ color: NEON_MAGENTA, toneMapped: false }));
    const arc = this.own(new THREE.TorusGeometry(5, 0.55, 8, 40, Math.PI * 1.55));
    const arcM = new THREE.Mesh(arc, mag);
    arcM.rotation.z = -Math.PI * 0.275; // leaves the gap centred at the bottom
    g.add(arcM);
    const foot = this.own(new THREE.BoxGeometry(3.2, 0.9, 0.9));
    for (const sx of [-1, 1]) {
      const f = new THREE.Mesh(foot, mag);
      f.position.set(sx * 4.6, -4.4, 0);
      g.add(f);
    }
    const frame = this.own(new THREE.EdgesGeometry(new THREE.BoxGeometry(16, 13, 0.5)));
    g.add(new THREE.LineSegments(frame, new THREE.LineBasicMaterial({ color: NEON_CYAN, toneMapped: false })));
    const back = this.own(new THREE.BoxGeometry(16, 13, 0.4));
    const backM = new THREE.Mesh(back, this.own(new THREE.MeshStandardMaterial({ color: 0x2c3140, metalness: 0.3, roughness: 0.5 })));
    backM.position.z = -0.5;
    g.add(backM);
    g.position.set(x, y, z);
    return g;
  }

  private own<T extends { dispose(): void }>(o: T): T {
    this.owned.push(o);
    return o;
  }

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, shadow = false): THREE.Mesh {
    this.owned.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow;
    m.receiveShadow = shadow;
    this.group.add(m);
    return m;
  }

  /** Beacons and stack embers pulse; hatch cores breathe. */
  update(t: number): void {
    const p = 0.55 + 0.45 * Math.sin(t * 3.1);
    this.pulse[0].opacity = 0.35 + 0.65 * p;
    this.pulse[1].opacity = 0.6 + 0.4 * Math.sin(t * 1.7 + 1);
    this.hatchMat.opacity = 0.45 + 0.35 * Math.sin(t * 2.2);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const l = o as THREE.LineSegments;
      if (l.isLineSegments) (l.material as THREE.Material).dispose();
    });
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
  }
}
