import * as THREE from 'three';
import { arcPts, rblock, roundProfile, shadeNormals } from './classicShapes';
import type { ProfilePt } from '../../render/kit/curves';

/* Shared CURVED SHAPES for the non-Classic plows (art pass, reshape; docs/art-pass.md), next to the Classic's own
 * classicShapes.ts (whose roundProfile / rblock / arcPts are re-exported here):
 *   - roundLoft: a body lofted through rounded-rectangle sections along z (each section its own half width, bottom /
 *     top heights and corner radii), so a hull can taper in plan, crown, tuck under and roll its nose at once;
 *   - sweep: sections for roundLoft sampled from a function of z (cosine spaced, so the ends get the detail);
 *   - archFender: a round wheel-arch band (side profile extruded across x) centred on its wheel;
 *   - dome / ring helpers on THREE.LatheGeometry with the same shading rules;
 *   - facet: one normal per face (the old flat-shaded look) for parts that stay angular next to curved ones on a
 *     material that no longer flat-shades.
 * Like classicShapes: NON-INDEXED position + normal + uv (zeroed), built at final size, cached by a unique key, never
 * transformed in place (clone first). Normals are baked (smooth across curves, hard past 35 degrees), so these parts
 * need materials with flatShading off. */

export { arcPts, rblock, roundProfile, shadeNormals };
export type { ProfilePt };

const CACHE = new Map<string, THREE.BufferGeometry>();

function cached(key: string, f: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = CACHE.get(key);
  if (!g) CACHE.set(key, (g = f()));
  return g;
}

/** One loft section at z: half width, bottom and top heights, bottom / top corner radii (clamped to fit). */
export interface RSec {
  z: number;
  hw: number;
  yb: number;
  yt: number;
  rb: number;
  rt: number;
}

/** Ring of a rounded-rectangle section (counter-clockwise seen from +z), `cs` steps per corner. */
function ring(s: RSec, cs: number): THREE.Vector3[] {
  const h = Math.max(1e-3, s.yt - s.yb);
  const rt = Math.max(0, Math.min(s.rt, s.hw - 1e-4, h - 1e-4));
  const rb = Math.max(0, Math.min(s.rb, s.hw - 1e-4, h - rt));
  const out: THREE.Vector3[] = [];
  const arc = (cx: number, cy: number, r: number, a0: number) => {
    for (let i = 0; i <= cs; i++) {
      const a = a0 + (i / cs) * (Math.PI / 2);
      out.push(new THREE.Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, s.z));
    }
  };
  arc(s.hw - rb, s.yb + rb, rb, -Math.PI / 2);
  arc(s.hw - rt, s.yt - rt, rt, 0);
  arc(-s.hw + rt, s.yt - rt, rt, Math.PI / 2);
  arc(-s.hw + rb, s.yb + rb, rb, Math.PI);
  return out;
}

/**
 * A body lofted through rounded-rectangle sections (z increasing), capped at both ends (a section with hw or height
 * near zero closes the end to a point). `cs` facets per corner (4 = 22.5 degree steps: shades smooth).
 */
export function roundLoft(key: string, secs: readonly RSec[], cs = 4): THREE.BufferGeometry {
  return cached(`loft|${key}|${cs}`, () => {
    const rings = secs.map((s) => ring(s, cs));
    const n = rings[0].length;
    const pos: number[] = [];
    const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
      // skip degenerate triangles (collapsed end rings)
      if (a.distanceToSquared(b) < 1e-12 || b.distanceToSquared(c) < 1e-12 || a.distanceToSquared(c) < 1e-12) return;
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    };
    for (let i = 0; i + 1 < rings.length; i++) {
      const r0 = rings[i];
      const r1 = rings[i + 1];
      for (let k = 0; k < n; k++) {
        const k1 = (k + 1) % n;
        tri(r0[k], r0[k1], r1[k1]);
        tri(r0[k], r1[k1], r1[k]);
      }
    }
    const cap = (r: THREE.Vector3[], front: boolean) => {
      const c = r.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / r.length);
      for (let k = 0; k < n; k++) {
        const k1 = (k + 1) % n;
        if (front) tri(c, r[k], r[k1]);
        else tri(c, r[k1], r[k]);
      }
    };
    cap(rings[0], false);
    cap(rings[rings.length - 1], true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return shadeNormals(g, false);
  });
}

/** An octagonal hull section (see arsenal's loft): heights keel / side foot / side top / roof, half widths keel /
 *  side / roof. */
export interface OctSec {
  z: number;
  y: readonly [number, number, number, number];
  w: readonly [number, number, number];
}

/**
 * The octagonal loft with its four chamfers turned into round shoulders: each corner a quadratic curve between the
 * same two points (control at the chamfer's outer corner), so the flat keel, flanks and roof (and everything mounted
 * on them) stay exactly where they were. `cs` steps per corner.
 */
export function octLoft(key: string, secs: readonly OctSec[], cs = 5): THREE.BufferGeometry {
  return cached(`oct|${key}|${cs}`, () => {
    const rings = secs.map(({ z, y: [y0, y1, y2, y3], w: [wb, ws, wt] }) => {
      const out: THREE.Vector3[] = [];
      const q = (ax: number, ay: number, cx: number, cy: number, bx: number, by: number) => {
        for (let i = 0; i <= cs; i++) {
          const t = i / cs;
          const u = 1 - t;
          out.push(new THREE.Vector3(u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by, z));
        }
      };
      q(wb, y0, ws, y0, ws, y1);
      q(ws, y2, ws, y3, wt, y3);
      q(-wt, y3, -ws, y3, -ws, y2);
      q(-ws, y1, -ws, y0, -wb, y0);
      return out;
    });
    const n = rings[0].length;
    const pos: number[] = [];
    const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i + 1 < rings.length; i++) {
      for (let k = 0; k < n; k++) {
        const k1 = (k + 1) % n;
        tri(rings[i][k], rings[i][k1], rings[i + 1][k1]);
        tri(rings[i][k], rings[i + 1][k1], rings[i + 1][k]);
      }
    }
    const cap = (r: THREE.Vector3[], front: boolean) => {
      const c = r.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / r.length);
      for (let k = 0; k < n; k++) {
        const k1 = (k + 1) % n;
        if (front) tri(c, r[k], r[k1]);
        else tri(c, r[k1], r[k]);
      }
    };
    cap(rings[0], false);
    cap(rings[rings.length - 1], true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return shadeNormals(g, false);
  });
}

/** `n + 1` loft sections from z0 to z1 (cosine spaced: denser at the ends), each from `f(z, u)` (u = 0..1). */
export function sweep(z0: number, z1: number, n: number, f: (z: number, u: number) => Omit<RSec, 'z'>): RSec[] {
  const out: RSec[] = [];
  for (let i = 0; i <= n; i++) {
    const u = (1 - Math.cos((i / n) * Math.PI)) / 2;
    const z = z0 + (z1 - z0) * u;
    out.push({ z, ...f(z, u) });
  }
  return out;
}

/** Quarter-ellipse round-off: 1 in the middle, falling to `min` over the last `len` toward an end at distance d. */
export function roundEnd(d: number, len: number, min = 0): number {
  if (d >= len) return 1;
  const t = 1 - Math.max(0, d) / len;
  return min + (1 - min) * Math.sqrt(Math.max(0, 1 - t * t));
}

/** Wheel-arch band: radii r0..r1 from angle a0 to a1 (degrees, 0 = forward, 90 = up) round (z = 0, y = cy), `width`
 *  across x, round side edges. */
export function archFender(key: string, cy: number, r0: number, r1: number, a0: number, a1: number, width: number, bevel = 0.035, n = 10): THREE.BufferGeometry {
  return roundProfile(`arch|${key}`, [...arcPts(0, cy, r1, a0, a1, n), ...arcPts(0, cy, r0, a1, a0, n)], width, bevel, 2);
}

/** Solid of revolution about +y from (radius, y) points, normals shaded smooth with hard creases (35 degrees). */
export function turned(key: string, pts: readonly (readonly [number, number])[], seg = 20): THREE.BufferGeometry {
  return cached(`turn|${key}|${seg}`, () => {
    const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg).toNonIndexed();
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    return shadeNormals(g, false);
  });
}

/** `turned` laid along z (its +y axis turned to +z). */
export function turnedZ(key: string, pts: readonly (readonly [number, number])[], seg = 20): THREE.BufferGeometry {
  return cached(`turnZ|${key}|${seg}`, () => turned(key, pts, seg).clone().rotateX(Math.PI / 2));
}

/** `turned` laid along x (its +y axis turned to +x). */
export function turnedX(key: string, pts: readonly (readonly [number, number])[], seg = 20): THREE.BufferGeometry {
  return cached(`turnX|${key}|${seg}`, () => turned(key, pts, seg).clone().rotateZ(-Math.PI / 2));
}

const FACETED = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
/** One normal per face (cached per source geometry). */
export function facet(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let f = FACETED.get(g);
  if (!f) {
    f = g.index ? g.toNonIndexed() : g.clone();
    f.computeVertexNormals();
    FACETED.set(g, f);
  }
  return f;
}

/**
 * For a material switched to smooth shading: give every mesh under `root` using one of `mats` face normals (the old
 * flat look), except geometries made by this file / classicShapes (marked curved). Call before mergeStatic.
 */
export function keepFaceted(root: THREE.Object3D, mats: readonly THREE.Material[], curved: ReadonlySet<THREE.BufferGeometry>): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || !mats.includes(m.material as THREE.Material)) return;
    if (curved.has(m.geometry)) return;
    m.geometry = facet(m.geometry);
  });
}

/** Stadium outline points [z, y]: straight runs between half circles of radius r centred at z = za / zb, y = cy. */
function stadiumPts(za: number, zb: number, cy: number, r: number, n: number): [number, number][] {
  return [...arcPts(zb, cy, r, -90, 90, n), ...arcPts(za, cy, r, 90, 270, n)];
}

/** Open track belt: a stadium loop (end wheel centres za / zb at height cy, outer radius r, `t` thick) extruded
 *  `width` across x, round side edges. */
export function beltLoop(key: string, za: number, zb: number, cy: number, r: number, t: number, width: number, bevel = 0.03, n = 10): THREE.BufferGeometry {
  return cached(`belt|${key}`, () => {
    const outer = stadiumPts(za, zb, cy, r, n);
    const inner = stadiumPts(za, zb, cy, r - t, n);
    const s = new THREE.Shape(outer.map(([z, y]) => new THREE.Vector2(z, y)));
    s.holes.push(new THREE.Path(inner.reverse().map(([z, y]) => new THREE.Vector2(z, y))));
    const bv = Math.min(bevel, width * 0.3, t * 0.3);
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, width - bv * 2), bevelEnabled: bv > 0, bevelThickness: bv, bevelSize: bv, bevelOffset: -bv, bevelSegments: 2, curveSegments: 1 });
    g.translate(0, 0, -(width - bv * 2) / 2);
    g.rotateY(-Math.PI / 2);
    const ng = g.index ? g.toNonIndexed() : g;
    ng.deleteAttribute('normal');
    ng.deleteAttribute('uv');
    return shadeNormals(ng);
  });
}

/** Planar uvs seen from the side (u = z, v = y, in metres) written into `g` (pass a clone of a cached shape): for
 *  textures that only need to run level, e.g. scanlines. */
export function sideUV(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getZ(i);
    uv[i * 2 + 1] = pos.getY(i);
  }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}
