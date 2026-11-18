import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { profileSolid, type ProfilePt } from '../../render/kit/curves';
import { roundProfile } from '../vehicles/classicShapes';

/* Curved shapes for the REGULAR bot models (art pass, reshape; docs/art-pass.md), next to render/kit/curves.ts:
 *   - latheArc: a partial solid of revolution (a closed (r, y) cross-section swept through an arc) with end caps:
 *     wrap-around visors and bands on domes;
 *   - fuselage: a solid of revolution lying along +z (scale it per axis for an oval section): hover-craft bodies;
 *   - arcShell: a ring sector (inner / outer radius, an angle span about +z) extruded upward with rounded edges:
 *     curved shields;
 *   - horseshoe: the Magnet Tower's U magnet (an elliptic arch with two legs) as one rounded solid;
 *   - trackGuard: a thin hoop over the top run and round ends of a stadium track belt;
 *   - archFender: an arched mudguard over a wheel (side profile), cached per size;
 *   - moldAt: a point + tilt on render/kit/curves.ts moldboard()'s concave face, to seat strips and rivets on it.
 * Like curves.ts: NON-INDEXED geometry with position + normal + uv (zeroed), built at final size, cached and shared
 * (never transformed in place); creased normals, so the materials must not be flat-shaded. */

const CACHE = new Map<string, THREE.BufferGeometry>();
const CREASE = (35 * Math.PI) / 180;

function cached(key: string, f: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = CACHE.get(key);
  if (!g) CACHE.set(key, (g = f()));
  return g;
}

function finish(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let ng = g.index ? g.toNonIndexed() : g;
  if (ng.getAttribute('normal')) ng.deleteAttribute('normal');
  if (ng.getAttribute('uv')) ng.deleteAttribute('uv');
  ng = toCreasedNormals(ng, CREASE);
  ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.getAttribute('position').count * 2), 2));
  return ng;
}

/** Signed area of a closed (r, y) polygon (> 0: counter-clockwise). */
function area2(pts: readonly (readonly [number, number])[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/**
 * A closed (r, y) cross-section swept about +y from angle `phi0` through `span` (radians; 0 = +z, increasing toward
 * +x, the THREE.LatheGeometry convention), `seg` steps, both ends capped. Any winding.
 */
export function latheArc(key: string, section: readonly (readonly [number, number])[], phi0: number, span: number, seg = 16): THREE.BufferGeometry {
  return cached(`la|${key}|${phi0}|${span}|${seg}`, () => {
    // counter-clockwise in (r, y) sweeps to outward-facing walls
    const sec = area2(section) < 0 ? [...section].reverse() : [...section];
    const n = sec.length;
    const pos: number[] = [];
    const at = (k: number, i: number): [number, number, number] => {
      const a = phi0 + (span * k) / seg;
      const [r, y] = sec[i % n];
      return [Math.sin(a) * r, y, Math.cos(a) * r];
    };
    for (let k = 0; k < seg; k++)
      for (let i = 0; i < n; i++) {
        const a = at(k, i);
        const b = at(k, i + 1);
        const c = at(k + 1, i + 1);
        const d = at(k + 1, i);
        pos.push(...a, ...d, ...c, ...a, ...c, ...b);
      }
    // end caps: the cross-section triangulated, wound to face away from the sweep
    const tris = THREE.ShapeUtils.triangulateShape(sec.map(([r, y]) => new THREE.Vector2(r, y)), []);
    for (const [k, out] of [[0, -1], [seg, 1]] as const) {
      const a = phi0 + (span * k) / seg;
      // the sweep direction at this end (d/dphi of (sin, cos))
      const tx = Math.cos(a) * out;
      const tz = -Math.sin(a) * out;
      for (const t of tris) {
        const p = t.map((i) => at(k, i));
        const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
        const vx = p[2][0] - p[0][0], vy = p[2][1] - p[0][1], vz = p[2][2] - p[0][2];
        const nx = uy * vz - uz * vy;
        const nz = ux * vy - uy * vx;
        if (nx * tx + nz * tz >= 0) pos.push(...p[0], ...p[1], ...p[2]);
        else pos.push(...p[0], ...p[2], ...p[1]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    return finish(g);
  });
}

/** A solid of revolution along +z: (r, z) points from the tail (smallest z) to the nose, `seg` sides. Its section is
 *  round (radius r); scale x / y when adding it for an oval one. */
export function fuselage(key: string, pts: readonly (readonly [number, number])[], seg = 20): THREE.BufferGeometry {
  return cached(`fu|${key}|${seg}`, () => {
    const g = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), seg);
    // lathe axis +y -> +z (its seam, local +z, ends up underneath)
    g.rotateX(PI / 2);
    return finish(g);
  });
}
const PI = Math.PI;

/**
 * Ring sector between radii `r0` < `r1` over angles -span/2..+span/2 about +z (0 = straight ahead, the arc's middle
 * at z = r), `h` tall (y centred on 0), every edge rounded by `bevel`. A curved shield / rim around the origin.
 */
export function arcShell(r0: number, r1: number, span: number, h: number, bevel = 0.04, seg = 24, bevelSeg = 2): THREE.BufferGeometry {
  return cached(`as|${r0}|${r1}|${span}|${h}|${bevel}|${seg}|${bevelSeg}`, () => {
    const s = new THREE.Shape();
    // shape (x, y) = model (x, -z) once the extrusion (shape z) is turned to point up
    for (let i = 0; i <= seg; i++) {
      const a = -span / 2 + (span * i) / seg;
      const x = Math.sin(a) * r1;
      const y = -Math.cos(a) * r1;
      if (i === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    }
    for (let i = seg; i >= 0; i--) {
      const a = -span / 2 + (span * i) / seg;
      s.lineTo(Math.sin(a) * r0, -Math.cos(a) * r0);
    }
    s.closePath();
    const b = Math.min(bevel, (r1 - r0) * 0.45, h * 0.3);
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, h - b * 2), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: bevelSeg, curveSegments: 1 });
    g.rotateX(-PI / 2);
    g.translate(0, -(h - b * 2) / 2, 0);
    return finish(g);
  });
}

/**
 * The U magnet: an elliptic arch (mid radius `r`, half-thickness `t`, the arch squashed to `ky` of its width) on two
 * straight legs reaching `legs` below the arch's centre, `depth` thick front to back (z), rounded edges. The arch's
 * centre is the origin; the arch spans x in [-(r + t), r + t].
 */
export function horseshoe(r: number, t: number, ky: number, legs: number, depth: number, bevel = 0.07, n = 14): THREE.BufferGeometry {
  return cached(`hs|${r}|${t}|${ky}|${legs}|${depth}|${bevel}|${n}`, () => {
    const ro = r + t;
    const ri = r - t;
    const pts: ProfilePt[] = [[-ro, -legs], [-ro, 0]];
    for (let i = 1; i < n; i++) {
      const a = PI - (PI * i) / n;
      pts.push([Math.cos(a) * ro, Math.sin(a) * ro * ky]);
    }
    pts.push([ro, 0], [ro, -legs], [ri, -legs], [ri, 0]);
    for (let i = 1; i < n; i++) {
      const a = (PI * i) / n;
      pts.push([Math.cos(a) * ri, Math.sin(a) * ri * ky]);
    }
    pts.push([-ri, 0], [-ri, -legs]);
    // roundProfile works in (z, y) and extrudes across x: turn it so the profile's z runs along x
    const g = roundProfile(`horseshoe|${r}|${t}|${ky}|${legs}|${n}`, pts, depth, bevel, 3, 1).clone();
    g.rotateY(PI / 2);
    return g;
  });
}

/** A thin hoop over a stadium belt (see curves.ts stadiumBelt(len, h)): `gap` above the belt, `t` thick, `w` wide,
 *  following the top run and the round ends down to the axle height. */
export function trackGuard(len: number, h: number, w: number, gap = 0.05, t = 0.05): THREE.BufferGeometry {
  const r = h / 2;
  const L = Math.max(0, len / 2 - r);
  const pts: ProfilePt[] = [];
  const n = 4;
  for (let i = 0; i <= n; i++) {
    const a = PI - (PI / 2) * (i / n);
    pts.push([-L + Math.cos(a) * (r + gap + t), r + Math.sin(a) * (r + gap + t)]);
  }
  for (let i = 0; i <= n; i++) {
    const a = PI / 2 - (PI / 2) * (i / n);
    pts.push([L + Math.cos(a) * (r + gap + t), r + Math.sin(a) * (r + gap + t)]);
  }
  for (let i = n; i >= 0; i--) {
    const a = PI / 2 - (PI / 2) * (i / n);
    pts.push([L + Math.cos(a) * (r + gap), r + Math.sin(a) * (r + gap)]);
  }
  for (let i = n; i >= 0; i--) {
    const a = PI - (PI / 2) * (i / n);
    pts.push([-L + Math.cos(a) * (r + gap), r + Math.sin(a) * (r + gap)]);
  }
  return profileSolid(`trackGuard|${len}|${h}|${gap}|${t}`, pts, w, 0, 1);
}

/** Arched mudguard (side profile) over a wheel of radius `r` whose axle is at y = `cy`, z = 0: `gap` clear of the
 *  tyre, `t` thick, reaching down to `foot` (y) at both ends, `w` wide (x). */
export function archFender(r: number, cy: number, w: number, foot: number, gap = 0.06, t = 0.06): THREE.BufferGeometry {
  const ri = r + gap;
  const ro = ri + t;
  const pts: ProfilePt[] = [];
  const a0 = Math.asin(Math.max(-1, Math.min(1, (foot - cy) / ro)));
  const b0 = Math.asin(Math.max(-1, Math.min(1, (foot - cy) / ri)));
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const a = PI - a0 - ((PI - 2 * a0) * i) / n;
    pts.push([Math.cos(a) * ro, cy + Math.sin(a) * ro]);
  }
  for (let i = 0; i <= n; i++) {
    const a = b0 + ((PI - 2 * b0) * i) / n;
    pts.push([Math.cos(a) * ri, cy + Math.sin(a) * ri]);
  }
  return profileSolid(`archFender|${r}|${cy}|${foot}|${gap}|${t}`, pts, w, 0, 1);
}

/** Long track fender over a stadium belt (len, top at y = `top`): a flat top with rolled-down ends, `t` thick. */
export function trackFender(key: string, len: number, top: number, t: number, w: number, drop = 0.2): THREE.BufferGeometry {
  const e = len / 2;
  return roundProfile(`trackFender|${key}`, [
    [-e - 0.04, top - drop], { p: [-e + 0.24, top + t], q: [-e - 0.02, top + t] }, [e - 0.24, top + t], { p: [e + 0.04, top - drop], q: [e + 0.02, top + t] },
    [e - 0.03, top - drop], { p: [e - 0.26, top], q: [e - 0.04, top] }, [-e + 0.26, top], { p: [-e + 0.03, top - drop], q: [-e + 0.04, top] },
  ], w, Math.min(0.05, w * 0.2), 3, 4);
}

/**
 * A point on moldboard(width, height, curl, t)'s concave front face at parameter s (0 = bottom edge, 1 = top lip):
 * [z, y, tilt] in the blade's own frame (bottom edge at the origin), tilt = the rotation about x that stands a part's
 * local +y along the face (its local +z then faces out of the blade).
 */
export function moldAt(height: number, curl: number, s: number): [number, number, number] {
  const qz = -curl * 0.6;
  const qy = height * 0.75;
  const z = 2 * s * (1 - s) * qz + s * s * curl;
  const y = 2 * s * (1 - s) * qy + s * s * height;
  const dz = 2 * (1 - s) * qz + 2 * s * (curl - qz);
  const dy = 2 * (1 - s) * qy + 2 * s * (height - qy);
  return [z, y, Math.atan2(dz, dy)];
}

/** Debris chunks (Enemies' shatter, instanced and scaled per chunk), unit size, centred: a bent body panel, a rounded
 *  block, a bevelled drum. */
export function debrisShape(i: number): THREE.BufferGeometry {
  const k = i % 3;
  if (k === 0)
    return profileSolid('debrisPanel', [[-0.5, -0.16], { p: [0.5, -0.16], q: [0, 0.14] }, [0.5, 0.06], { p: [-0.5, 0.06], q: [0, 0.36] }], 1, 0.08, 5);
  if (k === 1) return roundBlockUnit();
  return cached('debrisDrum', () => finish(new THREE.LatheGeometry([[0, -0.5], [0.85, -0.5], [1, -0.36], [1, 0.36], [0.85, 0.5], [0, 0.5]].map(([r, y]) => new THREE.Vector2(r, y)), 10)));
}
function roundBlockUnit(): THREE.BufferGeometry {
  return cached('debrisBlock', () => {
    const r = 0.18;
    const h = 0.5;
    return profileSolid('debrisBlockProfile', [
      [-h + r, -h], [h - r, -h], { p: [h, -h + r], q: [h, -h] }, [h, h - r], { p: [h - r, h], q: [h, h] }, [-h + r, h],
      { p: [-h, h - r], q: [-h, h] }, [-h, -h + r], { p: [-h + r, -h], q: [-h, -h] },
    ], 1, r, 3);
  });
}
