import * as THREE from 'three';
import { withPrivateRandom } from './privateRandom';

/* Baked corner occlusion for static geometry (art pass, docs/art-pass.md "Corner shadow (AO)", the BAKED candidate).
 *
 * One value per vertex, computed once when a static batch is merged (mergeStatic.ts StaticBatch.flush with `ao`):
 *   1. every triangle of the batch is splatted into a coarse occupancy grid (bits, CELL m) over the arena;
 *   2. from each vertex, a few short rays (DIRS directions over the hemisphere around its normal, RANGE m) march
 *      through that grid and against the ground (a height function: terrain + snow); the blocked share is the
 *      occlusion.
 * The result goes into a vec2 attribute AO_ATTRIBUTE = (AO_TAG, darkness 0 = open .. 1 = fully enclosed). The shader
 * patch (palette.ts applyBakedAO) only applies it where x == AO_TAG: a mesh drawn with a patched material but without
 * the attribute reads WebGL's generic attribute value for that slot (0, or 1 if another program set one there), and
 * neither is the tag, so it is never darkened by accident.
 * Coarse by design: per vertex, so a big flat box face only gets a gradient between its corners; small parts near the
 * ground and inner corners read best. Cost: one pass over the triangles + DIRS * RANGE / CELL lookups per vertex. */

export const AO_ATTRIBUTE = 'aoDark';
/** The attribute's x (see the header). */
export const AO_TAG = 0.5;
/** Occupancy grid cell (m). */
export const AO_CELL = 0.5;
/** Ray length (m): how far a wall / the ground still shades a corner. */
export const AO_RANGE = 1.6;
/** Grid extent (m from the origin, horizontal) and vertical span; geometry outside only sees the ground. */
const HALF = 120;
const Y0 = -4;
const Y1 = 40;

/** Fixed hemisphere directions (z = up in the normal's frame), cosine-weighted, golden-angle spiral. */
const DIRS: readonly [number, number, number][] = (() => {
  const n = 10;
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const r = Math.sqrt(u);
    const a = i * 2.399963;
    out.push([r * Math.cos(a), r * Math.sin(a), Math.sqrt(1 - u)]);
  }
  return out;
})();

export interface AOBakeOptions {
  /** Ground height (terrain + resting snow) at (x, z); rays below it are blocked. */
  ground?: (x: number, z: number) => number;
}

class Grid {
  readonly nx = Math.ceil((2 * HALF) / AO_CELL);
  readonly ny = Math.ceil((Y1 - Y0) / AO_CELL);
  readonly nz = this.nx;
  readonly bits = new Uint32Array(Math.ceil((this.nx * this.ny * this.nz) / 32));

  private index(x: number, y: number, z: number): number {
    const ix = Math.floor((x + HALF) / AO_CELL);
    const iy = Math.floor((y - Y0) / AO_CELL);
    const iz = Math.floor((z + HALF) / AO_CELL);
    if (ix < 0 || iy < 0 || iz < 0 || ix >= this.nx || iy >= this.ny || iz >= this.nz) return -1;
    return (iy * this.nz + iz) * this.nx + ix;
  }

  set(x: number, y: number, z: number): void {
    const i = this.index(x, y, z);
    if (i >= 0) this.bits[i >>> 5] |= 1 << (i & 31);
  }

  has(x: number, y: number, z: number): boolean {
    const i = this.index(x, y, z);
    return i >= 0 && (this.bits[i >>> 5] & (1 << (i & 31))) !== 0;
  }
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

const _m = new THREE.Matrix4();

/** Mark every cell a triangle passes through (barycentric samples at under a cell's spacing); `matrix` places it. */
function splat(grid: Grid, g: THREE.BufferGeometry, matrix?: THREE.Matrix4): void {
  const pos = g.getAttribute('position');
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  const step = AO_CELL * 0.7;
  for (let t = 0; t + 2 < n; t += 3) {
    const i0 = idx ? idx.getX(t) : t;
    const i1 = idx ? idx.getX(t + 1) : t + 1;
    const i2 = idx ? idx.getX(t + 2) : t + 2;
    _a.fromBufferAttribute(pos, i0);
    _b.fromBufferAttribute(pos, i1);
    _c.fromBufferAttribute(pos, i2);
    if (matrix) {
      _a.applyMatrix4(matrix);
      _b.applyMatrix4(matrix);
      _c.applyMatrix4(matrix);
    }
    const l = Math.max(_a.distanceTo(_b), _b.distanceTo(_c), _c.distanceTo(_a));
    const k = Math.max(1, Math.ceil(l / step));
    for (let i = 0; i <= k; i++) {
      for (let j = 0; i + j <= k; j++) {
        const u = i / k;
        const v = j / k;
        const w = 1 - u - v;
        grid.set(_a.x * w + _b.x * u + _c.x * v, _a.y * w + _b.y * u + _c.y * v, _a.z * w + _b.z * u + _c.z * v);
      }
    }
  }
}

/** Per-vertex normals for occlusion: the geometry's own, else area-weighted face normals. */
function normalsOf(g: THREE.BufferGeometry): THREE.BufferAttribute {
  const own = g.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (own) return own;
  const c = g.clone();
  c.computeVertexNormals();
  const n = c.getAttribute('normal') as THREE.BufferAttribute;
  c.dispose();
  return n;
}

/** Occlusion (0..1) of one surface point (p, unit normal n) against the grid and the ground. */
class Occluder {
  private readonly t1 = new THREE.Vector3();
  private readonly t2 = new THREE.Vector3();
  private readonly d = new THREE.Vector3();
  private readonly steps = Math.ceil(AO_RANGE / AO_CELL);

  constructor(
    private readonly grid: Grid,
    private readonly ground: (x: number, z: number) => number,
  ) {}

  at(p: THREE.Vector3, n: THREE.Vector3): number {
    const { t1, t2, d, grid, ground, steps } = this;
    // tangent frame around the normal
    if (Math.abs(n.y) < 0.9) t1.set(0, 1, 0);
    else t1.set(1, 0, 0);
    t1.cross(n).normalize();
    t2.crossVectors(n, t1);
    // start off the surface by more than a cell's diagonal reach, so the point's own face never blocks
    const ox = p.x + n.x * AO_CELL * 1.75;
    const oy = p.y + n.y * AO_CELL * 1.75;
    const oz = p.z + n.z * AO_CELL * 1.75;
    let blocked = 0;
    for (const [a, b, c] of DIRS) {
      d.set(t1.x * a + t2.x * b + n.x * c, t1.y * a + t2.y * b + n.y * c, t1.z * a + t2.z * b + n.z * c);
      let hit = oy < ground(ox, oz) - 0.02;
      for (let s = 1; s <= steps && !hit; s++) {
        const r = (s / steps) * AO_RANGE;
        const x = ox + d.x * r;
        const y = oy + d.y * r;
        const z = oz + d.z * r;
        hit = grid.has(x, y, z) || y < ground(x, z) - 0.02;
      }
      if (hit) blocked++;
    }
    return blocked / DIRS.length;
  }
}

/** The last bake: wall time (ms) and values baked (vertices + instance vertices); for reports. */
export const bakeStats = { ms: 0, values: 0 };

/** Width of the instanced-occlusion texture (values are laid out row by row). */
export const AO_TEX_WIDTH = 1024;
/** Per-instance attribute of an instanced mesh with baked occlusion: (AO_TAG, first texel of its instance). */
export const AO_INSTANCE_ATTRIBUTE = 'aoInst';
/** The occlusion texture of the instanced meshes baked last (one per arena build; the previous one is disposed). */
export const bakedAOTexture: { value: THREE.DataTexture | null } = { value: null };

/** Bake corner occlusion for a static scene part, all in one space:
 *   - `geos`: merged static geometry, each gets the per-vertex AO_ATTRIBUTE;
 *   - `instanced`: static instanced meshes (instances placed by mesh.matrix x instance matrix), whose occlusion is
 *     per instance AND vertex: values go into one shared texture (bakedAOTexture, AO_TEX_WIDTH wide), each instance
 *     gets AO_INSTANCE_ATTRIBUTE pointing at its first value, and the shader reads value + gl_VertexID. A geometry
 *     shared by several meshes is baked for the first only.
 *  Occluders: `occluders` (default `geos`) + every instance + the ground. Returns the number of values baked. */
export function bakeOcclusion(
  geos: readonly THREE.BufferGeometry[],
  opts: AOBakeOptions = {},
  occluders: readonly THREE.BufferGeometry[] = geos,
  instanced: readonly THREE.InstancedMesh[] = [],
): number {
  const t0 = performance.now();
  const grid = new Grid();
  for (const g of occluders) splat(grid, g);
  for (const im of instanced) {
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, _m);
      _m.premultiply(im.matrix);
      splat(grid, im.geometry, _m);
    }
  }
  const occ = new Occluder(grid, opts.ground ?? (() => 0));
  const p = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  let total = 0;
  for (const g of geos) {
    const pos = g.getAttribute('position');
    const nor = normalsOf(g);
    const out = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      out[i * 2] = AO_TAG;
      p.fromBufferAttribute(pos, i);
      nrm.fromBufferAttribute(nor, i).normalize();
      if (nrm.lengthSq() > 0.5) out[i * 2 + 1] = occ.at(p, nrm);
    }
    g.setAttribute(AO_ATTRIBUTE, new THREE.BufferAttribute(out, 2));
    total += pos.count;
  }
  // instanced: one texture for all
  const seen = new Set<THREE.BufferGeometry>();
  const list = instanced.filter((im) => !seen.has(im.geometry) && (seen.add(im.geometry), true));
  let size = 0;
  for (const im of list) size += im.geometry.getAttribute('position').count * im.count;
  bakedAOTexture.value?.dispose();
  bakedAOTexture.value = null;
  if (size === 0) {
    bakeStats.ms = performance.now() - t0;
    bakeStats.values = total;
    return total;
  }
  const rows = Math.ceil(size / AO_TEX_WIDTH);
  const data = new Uint8Array(rows * AO_TEX_WIDTH);
  const nm = new THREE.Matrix3();
  let base = 0;
  for (const im of list) {
    const g = im.geometry;
    const pos = g.getAttribute('position');
    const nor = normalsOf(g);
    const V = pos.count;
    const attr = new Float32Array(im.count * 2);
    for (let k = 0; k < im.count; k++) {
      im.getMatrixAt(k, _m);
      _m.premultiply(im.matrix);
      nm.getNormalMatrix(_m);
      attr[k * 2] = AO_TAG;
      attr[k * 2 + 1] = base;
      for (let i = 0; i < V; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(_m);
        nrm.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
        data[base + i] = nrm.lengthSq() > 0.5 ? Math.round(occ.at(p, nrm) * 255) : 0;
      }
      base += V;
    }
    g.setAttribute(AO_INSTANCE_ATTRIBUTE, new THREE.InstancedBufferAttribute(attr, 2));
    total += V * im.count;
  }
  // (render-only object made mid arena build: off the gameplay RNG, see privateRandom.ts)
  const tex = withPrivateRandom(() => new THREE.DataTexture(data, AO_TEX_WIDTH, rows, THREE.RedFormat, THREE.UnsignedByteType));
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  bakedAOTexture.value = tex;
  bakeStats.ms = performance.now() - t0;
  bakeStats.values = total;
  return total;
}
