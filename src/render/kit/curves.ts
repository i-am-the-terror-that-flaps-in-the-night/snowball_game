import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/* Detail kit: CURVED SHAPES (art pass, reshape; docs/art-pass.md). Real silhouettes instead of stacked boxes:
 *   - profileSolid: a side profile (z = forward, y = up) with straight and curved segments, extruded across the width
 *     with a rounded bevel: car bodies, hoods, cabs, fenders, noses;
 *   - stadiumBelt: a track belt with round ends (two half-discs joined by straight runs), extruded across its width;
 *   - roundBlock: a rounded box (radius r) at its final size;
 *   - lathe: a solid of revolution (domes, turrets, barrels, drums) from (radius, y) points;
 *   - moldboard: a curved plough blade (a thick arc profile) extruded across its width.
 * Like shapes.ts: NON-INDEXED geometry with position + normal + uv, built at final size, cached; normals are creased
 * (smooth across curves, hard at real corners), so these parts need materials with flatShading OFF. */

const CACHE = new Map<string, THREE.BufferGeometry>();
const CREASE = (35 * Math.PI) / 180;

function finish(g: THREE.BufferGeometry, crease = CREASE): THREE.BufferGeometry {
  let ng = g.index ? g.toNonIndexed() : g;
  ng = toCreasedNormals(ng, crease);
  if (!ng.getAttribute('uv')) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.getAttribute('position').count * 2), 2));
  return ng;
}

function cached(key: string, f: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = CACHE.get(key);
  if (!g) CACHE.set(key, (g = f()));
  return g;
}

/** One profile point: [z, y]; with `q`, a quadratic curve from the previous point to [z, y] through control q. */
export type ProfilePt = readonly [number, number] | { p: readonly [number, number]; q: readonly [number, number] };

function profileShape(pts: readonly ProfilePt[]): THREE.Shape {
  const s = new THREE.Shape();
  pts.forEach((pt, i) => {
    const isQ = !Array.isArray(pt);
    const p = isQ ? (pt as { p: readonly [number, number] }).p : (pt as readonly [number, number]);
    if (i === 0) s.moveTo(p[0], p[1]);
    else if (isQ) {
      const q = (pt as { q: readonly [number, number] }).q;
      s.quadraticCurveTo(q[0], q[1], p[0], p[1]);
    } else s.lineTo(p[0], p[1]);
  });
  s.closePath();
  return s;
}

/**
 * A solid from a side profile (shape x = forward z, shape y = up), `width` across (x, centred), the side edges rounded
 * by `bevel` (m). Profile points in metres, any winding.
 */
export function profileSolid(key: string, pts: readonly ProfilePt[], width: number, bevel = 0.06, curveSeg = 10): THREE.BufferGeometry {
  return cached(`prof|${key}|${width}|${bevel}`, () => {
    const b = Math.min(bevel, width * 0.3);
    const g = new THREE.ExtrudeGeometry(profileShape(pts), {
      depth: Math.max(0.001, width - b * 2), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: 2, curveSegments: curveSeg,
    });
    g.translate(0, 0, -(width - b * 2) / 2);
    // shape (x, y) + extrude z  ->  model (z, y) + x: a pure rotation (the extrusion is centred, so no mirror needed)
    g.rotateY(-Math.PI / 2);
    const ng = g.toNonIndexed();
    ng.deleteAttribute('normal');
    ng.deleteAttribute('uv');
    return finish(ng);
  });
}

/** Track belt: total length `len` (z), height h (round ends of radius h / 2), width w (x), rounded side edges, centred
 *  on z = 0 with its bottom at y = 0. */
export function stadiumBelt(len: number, h: number, w: number): THREE.BufferGeometry {
  const r = h / 2;
  const L = Math.max(0, len / 2 - r);
  return profileSolid(`belt|${len}|${h}`, [
    [-L, 0], [L, 0], { p: [L + r, r], q: [L + r, 0] }, { p: [L, h], q: [L + r, h] }, [-L, h],
    { p: [-L - r, r], q: [-L - r, h] }, { p: [-L, 0], q: [-L - r, 0] },
  ], w, Math.min(0.05, w * 0.15), 6);
}

/** Rounded box w x h x d (radius r) centred on the origin. */
export function roundBlock(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  return cached(`rb|${w}|${h}|${d}|${r}`, () => {
    const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
    const pts: ProfilePt[] = [
      [-d / 2 + rr, -h / 2], [d / 2 - rr, -h / 2], { p: [d / 2, -h / 2 + rr], q: [d / 2, -h / 2] }, [d / 2, h / 2 - rr],
      { p: [d / 2 - rr, h / 2], q: [d / 2, h / 2] }, [-d / 2 + rr, h / 2], { p: [-d / 2, h / 2 - rr], q: [-d / 2, h / 2] },
      [-d / 2, -h / 2 + rr], { p: [-d / 2 + rr, -h / 2], q: [-d / 2, -h / 2] },
    ];
    return profileSolid(`rbp|${w}|${h}|${d}|${r}`, pts, w, rr, 6);
  });
}

/** Solid of revolution around +y from (radius, y) points (bottom to top), `seg` sides. */
export function lathe(key: string, pts: readonly (readonly [number, number])[], seg = 20): THREE.BufferGeometry {
  return cached(`lathe|${key}|${seg}`, () => finish(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg)));
}

/** Curved plough blade: `width` across, `height` tall, curling forward by `curl` (m) at the top, `t` thick. The
 *  concave face points +z; the bottom edge sits at y = 0, z = 0. */
export function moldboard(width: number, height: number, curl: number, t: number): THREE.BufferGeometry {
  return profileSolid(`mold|${height}|${curl}|${t}`, [
    [0, 0], { p: [curl, height], q: [-curl * 0.6, height * 0.75] }, [curl - t, height + t * 0.2],
    { p: [-t, 0], q: [-curl * 0.6 - t, height * 0.72] },
  ], width, Math.min(0.03, t * 0.4), 12);
}
