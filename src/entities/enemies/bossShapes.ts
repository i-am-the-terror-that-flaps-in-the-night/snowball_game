import * as THREE from 'three';
import { arcPts, rblock, roundProfile, shadeNormals } from '../vehicles/classicShapes';

/* BOSS body shapes (art pass, reshape; docs/art-pass.md): the boss hulls, cabs, heads, fenders, blade bands and the
 * GRINDER's auger flight as curved solids (render/kit/curves.ts language, the Classic's roundProfile for the big
 * smooth panels: flat flanks, round side edges). Every geometry is NON-INDEXED position + normal + uv, built at final
 * size in the part's own space, cached and never transformed in place (Part.add clones it). Profiles are [z, y]
 * (z forward, y up), extruded across x and centred on x = 0. Materials must not be flat-shaded. */

const CACHE = new Map<string, THREE.BufferGeometry>();
function cached(key: string, f: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = CACHE.get(key);
  if (!g) CACHE.set(key, (g = f()));
  return g;
}

/* ------------------------------------------------------------------ generic pieces */

/** A point on a kit moldboard's front (concave) face, t = 0 bottom .. 1 top curl: its [z, y] and the tilt (rad,
 *  rotation about x) that turns +y into the face's outward normal (for bolts / studs set on the face). */
export function bladeAt(h: number, c: number, t: number): { z: number; y: number; a: number } {
  const qz = -c * 0.6;
  const qy = h * 0.75;
  const u = 1 - t;
  const z = 2 * u * t * qz + t * t * c;
  const y = 2 * u * t * qy + t * t * h;
  const dz = 2 * u * qz + 2 * t * (c - qz);
  const dy = 2 * u * qy + 2 * t * (h - qy);
  return { z, y, a: Math.atan2(dy, -dz) };
}

/**
 * A thin band laid on a kit moldboard's (render/kit/curves.ts moldboard(width, h, c, *)) front face from t0 to t1,
 * `off` proud of it, `width` across: hazard stripes / trim that follow the curve. Real uvs (u across 0..1, v along
 * 0..1: scale them with Part.add's uv), plus a short top and bottom lip so it never shows a gap edge-on.
 */
export function bladeBand(width: number, h: number, c: number, t0: number, t1: number, off = 0.012, n = 8): THREE.BufferGeometry {
  return cached(`band|${width}|${h}|${c}|${t0}|${t1}|${off}|${n}`, () => {
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const x0 = -width / 2;
    const x1 = width / 2;
    const row = (t: number) => {
      const p = bladeAt(h, c, t);
      const ny = Math.cos(p.a);
      const nz = Math.sin(p.a);
      return { z: p.z + nz * off, y: p.y + ny * off, ny, nz, bz: p.z, by: p.y };
    };
    const quad = (a: number[], b: number[], cc: number[], d: number[], na: number[], nb: number[], ua: number[], ub: number[]) => {
      // a, b on the lower row (x0, x1), cc, d on the upper row (x1, x0)
      for (const [p, nn, uu] of [[a, na, ua], [b, na, [ub[0], ua[1]]], [cc, nb, ub], [a, na, ua], [cc, nb, ub], [d, nb, [ua[0], ub[1]]]] as const) {
        pos.push(p[0], p[1], p[2]);
        nor.push(nn[0], nn[1], nn[2]);
        uv.push(uu[0], uu[1]);
      }
    };
    for (let i = 0; i < n; i++) {
      const r0 = row(t0 + ((t1 - t0) * i) / n);
      const r1 = row(t0 + ((t1 - t0) * (i + 1)) / n);
      quad([x0, r0.y, r0.z], [x1, r0.y, r0.z], [x1, r1.y, r1.z], [x0, r1.y, r1.z], [0, r0.ny, r0.nz], [0, r1.ny, r1.nz], [0, i / n], [1, (i + 1) / n]);
    }
    // lips: bottom faces down-ish (-tangent), top faces up-ish (+tangent)
    const lip = (t: number, sgn: number) => {
      const r = row(t);
      const nn = [0, r.nz * sgn, -r.ny * sgn];
      const lo = [r.bz, r.by];
      const hi = [r.z, r.y];
      const v = t === t0 ? 0 : 1;
      if (sgn < 0) quad([x0, lo[1], lo[0]], [x1, lo[1], lo[0]], [x1, hi[1], hi[0]], [x0, hi[1], hi[0]], nn, nn, [0, v], [1, v]);
      else quad([x0, hi[1], hi[0]], [x1, hi[1], hi[0]], [x1, lo[1], lo[0]], [x0, lo[1], lo[0]], nn, nn, [0, v], [1, v]);
    };
    lip(t0, -1);
    lip(t1, 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return g;
  });
}

/** A thin plate laid along the segment A -> B ([z, y]), from `o0` to `o1` out along its right-hand normal (for a
 *  segment running up and back: forward / up), `width` across: raked windscreens, visors, panels. */
export function slab(key: string, A: readonly [number, number], B: readonly [number, number], o0: number, o1: number, width: number, bevel = 0.02): THREE.BufferGeometry {
  const dz = B[0] - A[0];
  const dy = B[1] - A[1];
  const l = Math.hypot(dz, dy);
  const nz = dy / l;
  const ny = -dz / l;
  const p = (pt: readonly [number, number], o: number): [number, number] => [pt[0] + nz * o, pt[1] + ny * o];
  return roundProfile(`slab|${key}`, [p(A, o0), p(B, o0), p(B, o1), p(A, o1)], width, bevel, 2, 2);
}

/** A round band (fender / arch) over a wheel or drum at [cz, cy]: radii r0 (inside) .. r1, from angle a0 to a1
 *  (degrees, 0 = forward, 90 = up), `width` across. */
export function arch(key: string, cz: number, cy: number, r0: number, r1: number, a0: number, a1: number, width: number, bevel = 0.04, n = 10): THREE.BufferGeometry {
  return roundProfile(`arch|${key}`, [...arcPts(cz, cy, r1, a0, a1, n), ...arcPts(cz, cy, r0, a1, a0, n)], width, bevel, 2);
}

/** A curved track fender over a belt `len` long whose top is at y = top: a flat top run with ends rolling down by
 *  `drop`, `t` thick, `width` across, centred on z = 0. */
export function trackFender(key: string, len: number, top: number, drop: number, t: number, width: number, curveSeg = 4): THREE.BufferGeometry {
  const L = len / 2;
  const r = drop;
  return roundProfile(`tfend|${key}`, [
    [-L - 0.05, top - drop], { p: [-L + r * 0.6, top + t], q: [-L - 0.05, top + t] }, [L - r * 0.6, top + t], { p: [L + 0.05, top - drop], q: [L + 0.05, top + t] },
    [L - t * 0.9, top - drop], { p: [L - r * 0.6, top], q: [L - t * 0.9, top] }, [-L + r * 0.6, top], { p: [-L + t * 0.9, top - drop], q: [-L + t * 0.9, top] },
  ], width, Math.min(0.05, t * 0.4), 2, curveSeg);
}

/** A sector of a (tapered) cylinder, outward facing, with real uvs (u across left to right seen from the front,
 *  v up): a curved panel wrapped on a crown / drum. Centred on +z, `arc` radians wide, r0 bottom .. r1 top, h tall
 *  (base at y = 0). */
export function wrapPanel(r0: number, r1: number, h: number, arc: number, seg = 10): THREE.BufferGeometry {
  return cached(`wrap|${r0}|${r1}|${h}|${arc}|${seg}`, () => {
    const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1, true, -arc / 2, arc).toNonIndexed();
    g.translate(0, h / 2, 0);
    return g;
  });
}

/* ------------------------------------------------------------------ the GRINDER's auger */

/**
 * One continuous helical flight (the auger screw) around +z: `turns` turns from z0 to z1, its outer edge from rOut0
 * down to rOut1, the inner edge on the cone (rIn0 .. rIn1), `th` thick along z. Front, back and rim strips, each smooth.
 */
export function helixFlight(z0: number, z1: number, rIn0: number, rIn1: number, rOut0: number, rOut1: number, turns: number, th: number, n = 96): THREE.BufferGeometry {
  return cached(`helix|${z0}|${z1}|${rIn0}|${rIn1}|${rOut0}|${rOut1}|${turns}|${th}|${n}`, () => {
    const strip = (f: (i: number, side: 0 | 1) => THREE.Vector3, flip: boolean): THREE.BufferGeometry => {
      const pos: number[] = [];
      for (let i = 0; i <= n; i++) for (const s of [0, 1] as const) {
        const v = f(i, s);
        pos.push(v.x, v.y, v.z);
      }
      const idx: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        if (flip) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const ng = g.toNonIndexed();
      ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.getAttribute('position').count * 2), 2));
      return ng;
    };
    const at = (i: number, r: 'in' | 'out', dz: number) => {
      const k = i / n;
      const a = k * turns * Math.PI * 2;
      const rad = r === 'in' ? rIn0 + (rIn1 - rIn0) * k : rOut0 + (rOut1 - rOut0) * k;
      const t = th * (1 - k * 0.5);
      return new THREE.Vector3(Math.cos(a) * rad, Math.sin(a) * rad, z0 + (z1 - z0) * k + dz * t);
    };
    const front = strip((i, s) => at(i, s ? 'out' : 'in', 0.5), false);
    const back = strip((i, s) => at(i, s ? 'out' : 'in', -0.5), true);
    const rim = strip((i, s) => at(i, 'out', s ? 0.5 : -0.5), true);
    const merged = mergeNonIndexed([front, back, rim]);
    return merged;
  });
}

function mergeNonIndexed(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const size = list[0].getAttribute(name).itemSize;
    const total = list.reduce((s, g) => s + g.getAttribute(name).count, 0);
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of list) {
      const a = g.getAttribute(name).array as Float32Array;
      arr.set(a, o);
      o += a.length;
    }
    out.setAttribute(name, new THREE.Float32BufferAttribute(arr, size));
  }
  return out;
}

/** A solid of revolution around +y from a CLOSED (r, y) outline (a ring / flange / collar), smooth with hard
 *  corners (35 degrees), `seg` sides. */
export function ring(key: string, pts: readonly (readonly [number, number])[], seg = 24): THREE.BufferGeometry {
  return cached(`ring|${key}|${seg}`, () => {
    const p = pts.map(([r, y]) => new THREE.Vector2(r, y));
    p.push(p[0].clone());
    const g = new THREE.LatheGeometry(p, seg).toNonIndexed();
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    return shadeNormals(g, false);
  });
}

export const rp = roundProfile;
export { rblock };

/** `l` (a point in a part's own frame) placed at `c` with the part turned `th` about +y (Euler y): for parts set
 *  on angled blade wings. */
export function rotYAt(c: readonly [number, number, number], th: number, l: readonly [number, number, number]): [number, number, number] {
  const s = Math.sin(th);
  const k = Math.cos(th);
  return [c[0] + l[0] * k + l[2] * s, c[1] + l[1], c[2] - l[0] * s + l[2] * k];
}

/** The front half of a unit disc slab (radius 1, 1 tall, centred; flat back edge on z = 0): a cap brim once scaled. */
export function halfDisc(seg = 16): THREE.BufferGeometry {
  return cached(`halfDisc|${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg, 1, false, -Math.PI / 2, Math.PI).toNonIndexed());
}
