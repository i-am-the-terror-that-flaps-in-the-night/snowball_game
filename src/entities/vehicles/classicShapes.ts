import * as THREE from 'three';
import type { ProfilePt } from '../../render/kit/curves';
import { WHEEL_R } from '../plow/constants';

/* CLASSIC body shapes (art pass, reshape; docs/art-pass.md): the cab, hood, scoop, spreader body and wheel-arch
 * flares as side-profile extrusions with quadratic curves (render/kit/curves.ts profileSolid style), but with round
 * side edges: four bevel facets (22.5 degree steps, so they shade smooth) and flat sides that stay flat (the large
 * extrusion caps keep their own normal instead of averaging with the bevel, which would streak the glossy paint).
 * NON-INDEXED position + normal + uv (zeroed), built at final size in body space, cached, never transformed in place.
 * Materials must not be flat-shaded (the normals are baked). */

const CACHE = new Map<string, THREE.BufferGeometry>();
const COS_CREASE = Math.cos((35 * Math.PI) / 180);

function cached(key: string, f: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = CACHE.get(key);
  if (!g) CACHE.set(key, (g = f()));
  return g;
}

function profileShape(pts: readonly ProfilePt[]): THREE.Shape {
  const s = new THREE.Shape();
  pts.forEach((pt, i) => {
    if (Array.isArray(pt)) {
      if (i === 0) s.moveTo(pt[0], pt[1]);
      else s.lineTo(pt[0], pt[1]);
    } else {
      const { p, q } = pt as { p: readonly [number, number]; q: readonly [number, number] };
      if (i === 0) s.moveTo(p[0], p[1]);
      else s.quadraticCurveTo(q[0], q[1], p[0], p[1]);
    }
  });
  s.closePath();
  return s;
}

/**
 * Normals for a non-indexed solid: faces whose normal is (almost) along +-x (the extrusion caps: the flat flanks of
 * the body) keep that normal; every other face averages, area-weighted, with the non-cap faces sharing each vertex
 * within 35 degrees (round edges and curves smooth, real corners hard). Adds zeroed uvs.
 */
export function shadeNormals(g: THREE.BufferGeometry, capRule = true): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const n = pos.count;
  const tris = n / 3;
  const fn = new Float32Array(tris * 3);
  const area = new Float32Array(tris);
  const cap = new Uint8Array(tris);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < tris; t++) {
    a.fromBufferAttribute(pos, t * 3);
    b.fromBufferAttribute(pos, t * 3 + 1);
    c.fromBufferAttribute(pos, t * 3 + 2);
    b.sub(a);
    c.sub(a);
    b.cross(c);
    const l = b.length();
    area[t] = l / 2;
    if (l > 0) b.multiplyScalar(1 / l);
    fn[t * 3] = b.x;
    fn[t * 3 + 1] = b.y;
    fn[t * 3 + 2] = b.z;
    cap[t] = capRule && Math.abs(b.x) > 0.9995 ? 1 : 0;
  }
  const key = (i: number) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const at = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let l = at.get(k);
    if (!l) at.set(k, (l = []));
    l.push(Math.floor(i / 3));
  }
  const nor = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = Math.floor(i / 3);
    let x = fn[t * 3];
    let y = fn[t * 3 + 1];
    let z = fn[t * 3 + 2];
    if (!cap[t]) {
      x = y = z = 0;
      for (const f of at.get(key(i))!) {
        if (cap[f]) continue;
        const d = fn[f * 3] * fn[t * 3] + fn[f * 3 + 1] * fn[t * 3 + 1] + fn[f * 3 + 2] * fn[t * 3 + 2];
        if (d < COS_CREASE) continue;
        x += fn[f * 3] * area[f];
        y += fn[f * 3 + 1] * area[f];
        z += fn[f * 3 + 2] * area[f];
      }
      const l = Math.hypot(x, y, z) || 1;
      x /= l;
      y /= l;
      z /= l;
    }
    nor[i * 3] = x;
    nor[i * 3 + 1] = y;
    nor[i * 3 + 2] = z;
  }
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

/** A solid from a side profile (z forward, y up), `width` across (x, centred), side edges rounded by `bevel` in
 *  `seg` facets. */
export function roundProfile(key: string, pts: readonly ProfilePt[], width: number, bevel: number, seg = 4, curveSeg = 10): THREE.BufferGeometry {
  return cached(`rp|${key}|${width}|${bevel}|${seg}`, () => {
    const bv = Math.min(bevel, width * 0.3);
    const g = new THREE.ExtrudeGeometry(profileShape(pts), {
      depth: Math.max(0.001, width - bv * 2), bevelEnabled: bv > 0, bevelThickness: bv, bevelSize: bv, bevelOffset: -bv, bevelSegments: seg, curveSegments: curveSeg,
    });
    g.translate(0, 0, -(width - bv * 2) / 2);
    g.rotateY(-Math.PI / 2);
    const ng = g.index ? g.toNonIndexed() : g;
    ng.deleteAttribute('normal');
    ng.deleteAttribute('uv');
    return shadeNormals(ng);
  });
}

/** Arc points [z, y] around (cz, cy), radius r, from angle a0 to a1 (degrees, 0 = forward, 90 = up), n steps. */
export function arcPts(cz: number, cy: number, r: number, a0: number, a1: number, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([cz + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return out;
}

/* ---------------------------------------------------------------------------------------- the Classic's panels */

/** Front wheel centre (body z) and the cab's wheel-arch cut radius. */
const FRONT_Z = 1.45;
const CAB_ARCH_R = 0.62;

/** Raked windscreen line: cowl (bottom) and header (top) points [z, y]. */
const SCREEN_A = [1.08, 1.64] as const;
const SCREEN_B = [0.8, 2.12] as const;

/** Cab shell (paint): rounded roof and pillars, raked screen, a wheel-arch cut at the front lower corner. */
export const CAB = (): THREE.BufferGeometry =>
  roundProfile('classicCab', [
    [-0.2, 0.8],
    ...arcPts(FRONT_Z, WHEEL_R, CAB_ARCH_R, 149, 124, 4),
    [1.13, 1.55], { p: SCREEN_A, q: [1.13, 1.63] }, SCREEN_B, { p: [0.56, 2.29], q: [0.7, 2.29] }, [-0.04, 2.29], { p: [-0.2, 2.12], q: [-0.2, 2.29] },
  ], 1.96, 0.09, 3, 6);

/** Windscreen glass: a thin panel proud of the shell along the rake, narrower than the cab (painted A pillars). */
export const SCREEN = (): THREE.BufferGeometry => {
  const ux = SCREEN_B[0] - SCREEN_A[0];
  const uy = SCREEN_B[1] - SCREEN_A[1];
  const l = Math.hypot(ux, uy);
  const u = [ux / l, uy / l];
  const nn = [u[1], -u[0]]; // outward (forward + up)
  const p = (s: number, o: number): [number, number] => [SCREEN_A[0] + u[0] * s + nn[0] * o, SCREEN_A[1] + u[1] * s + nn[1] * o];
  return roundProfile('classicScreen', [p(0.05, 0.002), p(l - 0.03, 0.002), p(l - 0.03, 0.02), p(0.05, 0.02)], 1.72, 0.01, 2);
};

/** Door window (one slab through the cab, its faces just proud of both flanks). */
export const SIDE_GLASS = (): THREE.BufferGeometry[] => [
  roundProfile('classicDoorGlass', [
    [0.06, 1.69], [0.86, 1.69], { p: [0.92, 1.75], q: [0.92, 1.69] }, [0.72, 2.05], { p: [0.65, 2.1], q: [0.7, 2.1] }, [0.06, 2.1],
    { p: [0.0, 2.04], q: [0.0, 2.1] }, [0.0, 1.75], { p: [0.06, 1.69], q: [0.0, 1.69] },
  ], 1.976, 0.006, 1, 4),
];

/** Sun visor over the windscreen (black): a thin curved peak off the roof's front edge. */
export const VISOR = (): THREE.BufferGeometry =>
  roundProfile('classicVisor', [
    [0.5, 2.3], [0.7, 2.29], { p: [0.93, 2.19], q: [0.86, 2.26] }, [0.91, 2.165], { p: [0.69, 2.26], q: [0.83, 2.235] }, [0.5, 2.27],
  ], 1.86, 0.025, 2, 5);

/** Hood (paint): long, slightly crowned toward the cab, rolled nose over a flat grille face, big round side edges. */
export const HOOD = (): THREE.BufferGeometry =>
  roundProfile('classicHood', [
    [1.08, 0.8], [2.04, 0.8], { p: [2.14, 0.9], q: [2.14, 0.8] }, [2.14, 1.36], { p: [1.99, 1.49], q: [2.14, 1.49] }, [1.08, 1.535],
  ], 1.56, 0.14, 3, 6);
/** Hood top height at body z (the straight run between the nose roll and the cab). */
export const hoodTopY = (z: number): number => 1.535 - ((z - 1.08) / 0.91) * 0.045;

/** Raised intake scoop (black) on the hood's front half, its mouth facing forward. */
export const SCOOP = (): THREE.BufferGeometry =>
  roundProfile('classicScoop', [
    [1.74, 1.47], [2.0, 1.47], [2.0, 1.6], { p: [1.96, 1.635], q: [2.0, 1.635] }, { p: [1.74, 1.49], q: [1.84, 1.63] },
  ], 0.66, 0.03, 2, 6);

/** Spreader body upper box (paint): rolled top edges, a bulged tailgate. */
const TAIL_1 = [[-1.92, 2.04], [-2.06, 2.02], [-2.05, 1.72]] as const;
const TAIL_2 = [[-2.05, 1.72], [-2.04, 1.42], [-1.98, 1.3]] as const;
export const BED = (): THREE.BufferGeometry =>
  roundProfile('classicBed', [
    [-0.5, 1.3], [-0.5, 1.99], { p: [-0.55, 2.04], q: [-0.5, 2.04] }, TAIL_1[0], { p: TAIL_1[2], q: TAIL_1[1] }, { p: TAIL_2[2], q: TAIL_2[1] },
  ], 1.94, 0.07, 3, 6);

/** Tailgate surface z at height y (1.3..2.04), for the lamps / gauge / decals set on it. */
export function tailZ(y: number): number {
  const c = y >= TAIL_2[0][1] ? TAIL_1 : TAIL_2;
  const q = (t: number, i: 0 | 1) => (1 - t) * (1 - t) * c[0][i] + 2 * t * (1 - t) * c[1][i] + t * t * c[2][i];
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 30; k++) {
    const m = (lo + hi) / 2;
    if (q(m, 1) > y) lo = m;
    else hi = m;
  }
  return q((lo + hi) / 2, 0);
}

/** Wheel-arch flare (trim): a round band over a tyre, centred on the wheel (z = 0 here). */
export const FLARE = (): THREE.BufferGeometry =>
  roundProfile('classicFlare', [
    ...arcPts(0, WHEEL_R, 0.645, 15, 165, 9),
    ...arcPts(0, WHEEL_R, 0.555, 165, 15, 9),
  ], 0.46, 0.035, 2);

/** Fuel tank (chrome): a lathed drum with rounded ends, along z. */
let tank: THREE.BufferGeometry | null = null;
export const TANK = (): THREE.BufferGeometry => {
  if (!tank) {
    const pts = ([[0, -0.36], [0.13, -0.36], [0.165, -0.345], [0.18, -0.31], [0.18, 0.31], [0.165, 0.345], [0.13, 0.36], [0, 0.36]] as const).map(([r, y]) => new THREE.Vector2(r, y));
    const g = new THREE.LatheGeometry(pts, 16).toNonIndexed();
    g.rotateX(Math.PI / 2);
    g.deleteAttribute('normal');
    tank = shadeNormals(g, false);
  }
  return tank;
};

/** Blade top lip: a rolled, forward-curling rail in profile (blade-group space), `width` long on x. */
export const bladeLip = (width: number): THREE.BufferGeometry =>
  roundProfile('classicLip', [
    [0.15, 1.355], [0.3, 1.355], { p: [0.335, 1.415], q: [0.345, 1.355] }, { p: [0.24, 1.465], q: [0.325, 1.465] }, [0.18, 1.465],
    { p: [0.15, 1.42], q: [0.15, 1.465] },
  ], width, 0, 1, 8);

/** Rounded box w x h x d (radius r on every edge) centred on the origin: a lighter roundBlock (3-step corners, 2
 *  bevel facets) for the Classic's lamp bars, bumper and grille surround. */
export function rblock(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const z = d / 2;
  const y = h / 2;
  return roundProfile(`rblock|${h}|${d}|${rr}`, [
    [-z + rr, -y], [z - rr, -y], { p: [z, -y + rr], q: [z, -y] }, [z, y - rr], { p: [z - rr, y], q: [z, y] }, [-z + rr, y],
    { p: [-z, y - rr], q: [-z, y] }, [-z, -y + rr], { p: [-z + rr, -y], q: [-z, -y] },
  ], w, rr, 2, 3);
}
