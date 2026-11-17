import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';

/* Detail kit: shapes (art pass, docs/art-pass.md). Every builder returns a NON-INDEXED BufferGeometry with position,
 * normal and uv (uv zeroed), the same attribute set as the bot models' G.box() & co., so kit parts merge into a model's
 * existing per-material draws (Part.flush / mergeGeometries) instead of adding draws. Shapes are built at their final
 * size (a chamfer must not stretch with the part), cached by size, and never disposed (shared by every template). */

const CACHE = new Map<string, THREE.BufferGeometry>();
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function finish(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.computeVertexNormals();
  if (!ng.getAttribute('uv')) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.getAttribute('position').count * 2), 2));
  return ng;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

/**
 * A six-sided block given by its 8 corners (index bits: 1 = +x, 2 = +y, 4 = +z, the BoxGeometry layout) with every
 * edge chamfered by `c` (m). Each corner becomes three points, pulled `c` along two of its three edges, and the
 * convex hull of the 24 points is the bevelled block: flat faces, a narrow chamfer strip on each edge that catches the
 * light, a small triangle at each corner. Corners must describe a convex shape (box, wedge, tapered block).
 */
export function chamferHull(corners: readonly THREE.Vector3[], c: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 8; i++) {
    const v = corners[i];
    const d1 = _a.subVectors(corners[i ^ 1], v);
    const d2 = _b.subVectors(corners[i ^ 2], v);
    const d3 = _c.subVectors(corners[i ^ 4], v);
    // never pull past a third of the shortest edge (degenerate / tiny parts)
    const k = Math.min(c, d1.length() / 3, d2.length() / 3, d3.length() / 3);
    d1.setLength(k);
    d2.setLength(k);
    d3.setLength(k);
    pts.push(v.clone().add(d2).add(d3), v.clone().add(d1).add(d3), v.clone().add(d1).add(d2));
  }
  return finish(new ConvexGeometry(pts));
}

/** Chamfered box w x h x d centred on the origin. */
export function chamferBox(w: number, h: number, d: number, c = 0.05): THREE.BufferGeometry {
  const key = `cb|${r3(w)}|${r3(h)}|${r3(d)}|${r3(c)}`;
  let g = CACHE.get(key);
  if (!g) {
    const corners: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) corners.push(new THREE.Vector3(i & 1 ? w / 2 : -w / 2, i & 2 ? h / 2 : -h / 2, i & 4 ? d / 2 : -d / 2));
    g = chamferHull(corners, c);
    CACHE.set(key, g);
  }
  return g;
}

/**
 * Chamfered wedge w x h x d centred on the origin, front = +z: the top-front edge pulled back by `k` of the depth
 * (the bot models' G.wedge(k) at its final size), so noses and hoods get the same bevel as the boxes.
 */
export function chamferWedge(w: number, h: number, d: number, k = 0.45, c = 0.05): THREE.BufferGeometry {
  const key = `cw|${r3(w)}|${r3(h)}|${r3(d)}|${r3(k)}|${r3(c)}`;
  let g = CACHE.get(key);
  if (!g) {
    const corners: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) {
      const top = !!(i & 2);
      const front = !!(i & 4);
      const z = front ? (top ? d * (0.5 - k * 2) : d / 2) : -d / 2;
      corners.push(new THREE.Vector3(i & 1 ? w / 2 : -w / 2, top ? h / 2 : -h / 2, z));
    }
    g = chamferHull(corners, c);
    CACHE.set(key, g);
  }
  return g;
}

/** Tapered block (a frustum with a rectangular section): bottom w x d, top (w*kt) x (d*kt), chamfered. */
export function chamferTaper(w: number, h: number, d: number, kt: number, c = 0.05): THREE.BufferGeometry {
  const key = `ct|${r3(w)}|${r3(h)}|${r3(d)}|${r3(kt)}|${r3(c)}`;
  let g = CACHE.get(key);
  if (!g) {
    const corners: THREE.Vector3[] = [];
    for (let i = 0; i < 8; i++) {
      const s = i & 2 ? kt : 1;
      corners.push(new THREE.Vector3((i & 1 ? w / 2 : -w / 2) * s, i & 2 ? h / 2 : -h / 2, (i & 4 ? d / 2 : -d / 2) * s));
    }
    g = chamferHull(corners, c);
    CACHE.set(key, g);
  }
  return g;
}

/** Hex bolt head (radius r, height h, axis +y). Fine detail: close-up models only (bosses, the player's plow). */
export function boltHead(r = 0.035, h = 0.025): THREE.BufferGeometry {
  const key = `bolt|${r3(r)}|${r3(h)}`;
  let g = CACHE.get(key);
  if (!g) {
    g = finish(new THREE.CylinderGeometry(r, r, h, 6));
    CACHE.set(key, g);
  }
  return g;
}

/** Triangle count of a kit geometry (budget checks in tests). */
export function triCount(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}
