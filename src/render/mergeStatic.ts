import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/* Static-geometry baking: collapse meshes that never move relative to a root into one mesh per draw state.
 * A bucket is keyed by everything the renderer sorts / switches on per object: material, castShadow,
 * receiveShadow, renderOrder, layers, frustumCulled and custom depth materials. Transforms are baked relative to
 * the root (winding flipped when the matrix mirrors), attribute sets are normalised so mergeGeometries accepts
 * them, and source geometries are cloned, never disposed (they are often shared between meshes / templates).
 * Only merged BufferGeometry + the original materials come out, so this carries over to WebGPURenderer.
 *
 * What changes on screen: nothing, as long as the merged parts are opaque. Things to keep in mind:
 * - draw order inside a bucket becomes merge order, so exactly coplanar overlaps (z-fights) may resolve the other
 *   way; transparent meshes are skipped unless `transparent: true` (merging them changes blend order);
 * - normals are normalised per vertex after baking, which only differs from the GPU path under non-uniform scale;
 * - one bounding sphere per bucket, so the parts are no longer frustum-culled individually. */

/** Per-object draw state that must match for two meshes to share a draw. */
export interface DrawFlags {
  castShadow: boolean;
  receiveShadow: boolean;
  renderOrder: number;
  /** Layers bitmask. */
  layers: number;
  frustumCulled: boolean;
  customDepthMaterial?: THREE.Material;
  customDistanceMaterial?: THREE.Material;
}

const DEFAULT_FLAGS: DrawFlags = { castShadow: false, receiveShadow: false, renderOrder: 0, layers: 1, frustumCulled: true };

export function drawFlags(o: THREE.Object3D): DrawFlags {
  return {
    castShadow: o.castShadow,
    receiveShadow: o.receiveShadow,
    renderOrder: o.renderOrder,
    layers: o.layers.mask,
    frustumCulled: o.frustumCulled,
    customDepthMaterial: o.customDepthMaterial,
    customDistanceMaterial: o.customDistanceMaterial,
  };
}

function bucketKey(material: THREE.Material, f: DrawFlags): string {
  return `${material.uuid}|${+f.castShadow}${+f.receiveShadow}|${f.renderOrder}|${f.layers}|${+f.frustumCulled}|${f.customDepthMaterial?.uuid ?? ''}|${f.customDistanceMaterial?.uuid ?? ''}`;
}

const _m = new THREE.Matrix4();

/** Transform of `o` in `root` space, composed from local matrices (does not need fresh matrixWorld). `root` may be
 *  null (world space) and must be an ancestor of `o` otherwise. */
export function relativeMatrix(o: THREE.Object3D, root: THREE.Object3D | null, out = new THREE.Matrix4()): THREE.Matrix4 {
  out.identity();
  for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) {
    if (p.matrixAutoUpdate) p.updateMatrix();
    out.premultiply(p.matrix);
    if (!p.parent && root) throw new Error('relativeMatrix: root is not an ancestor');
  }
  return out;
}

/** Reverse the winding of every triangle of an indexed geometry (in place). */
export function flipWinding(g: THREE.BufferGeometry): void {
  const index = g.index;
  if (!index) throw new Error('flipWinding: geometry must be indexed');
  const a = index.array;
  for (let i = 0; i + 2 < a.length; i += 3) {
    const t = a[i + 1];
    a[i + 1] = a[i + 2];
    a[i + 2] = t;
  }
  index.needsUpdate = true;
}

function plainAttribute(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  // InterleavedBufferAttribute.clone() without a data cache de-interleaves.
  return a.clone() as THREE.BufferAttribute;
}

/** Copy of `src` with `matrix` baked in: own attribute arrays, always indexed (sequential index when the source
 *  has none), no groups, winding flipped when the matrix mirrors (det < 0) so front faces stay front faces. */
export function bakeGeometry(src: THREE.BufferGeometry, matrix: THREE.Matrix4, attributes?: readonly string[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const name of attributes ?? Object.keys(src.attributes)) {
    const a = src.getAttribute(name);
    if (a) g.setAttribute(name, plainAttribute(a));
  }
  const n = src.getAttribute('position').count;
  if (src.index) g.setIndex(src.index.clone());
  else {
    const idx = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  g.applyMatrix4(matrix);
  if (matrix.determinant() < 0) flipWinding(g);
  return g;
}

/** Does `material` read vertex attribute `name`? Conservative: unknown attributes count as used by custom shaders. */
function attributeUsed(material: THREE.Material, name: string): boolean {
  if (name === 'position') return true;
  const custom = (material as THREE.ShaderMaterial).isShaderMaterial || material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile;
  if (custom) return true;
  const textured = Object.values(material).some((v) => (v as THREE.Texture | null)?.isTexture);
  if (name === 'normal') return !(material as THREE.MeshBasicMaterial).isMeshBasicMaterial || textured;
  if (name === 'color') return !!material.vertexColors;
  if (name.startsWith('uv') || name === 'tangent') return textured;
  return true;
}

function attrSignature(a: THREE.BufferAttribute): string {
  return `${a.array.constructor.name}/${a.itemSize}/${+a.normalized}/${a.gpuType}`;
}

function toFloat32(a: THREE.BufferAttribute): THREE.BufferAttribute {
  const out = new Float32Array(a.count * a.itemSize);
  for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
  return new THREE.BufferAttribute(out, a.itemSize);
}

/** Merge baked (indexed, own-array) geometries that share one material. Parts are normalised first: an attribute
 *  only some parts have is dropped when the material never reads it, otherwise the parts are split into compatible
 *  sets; mismatched array types are widened to Float32. Returns one geometry per compatible set (bounds computed)
 *  and disposes the inputs. */
export function mergeBaked(parts: THREE.BufferGeometry[], material: THREE.Material): THREE.BufferGeometry[] {
  if (parts.length === 0) return [];
  const names = new Set<string>();
  for (const p of parts) for (const k of Object.keys(p.attributes)) names.add(k);
  for (const name of names) {
    const have = parts.filter((p) => p.getAttribute(name));
    if (have.length !== parts.length && !attributeUsed(material, name)) for (const p of have) p.deleteAttribute(name);
    else if (new Set(have.map((p) => attrSignature(p.getAttribute(name) as THREE.BufferAttribute))).size > 1) {
      for (const p of have) p.setAttribute(name, toFloat32(p.getAttribute(name) as THREE.BufferAttribute));
    }
  }
  const sets = new Map<string, THREE.BufferGeometry[]>();
  for (const p of parts) {
    const sig = Object.keys(p.attributes).sort().map((k) => `${k}:${attrSignature(p.getAttribute(k) as THREE.BufferAttribute)}`).join(',');
    let s = sets.get(sig);
    if (!s) sets.set(sig, (s = []));
    s.push(p);
  }
  const out: THREE.BufferGeometry[] = [];
  for (const s of sets.values()) {
    const g = s.length === 1 ? s[0] : mergeGeometries(s);
    if (!g) throw new Error('mergeBaked: mergeGeometries failed');
    if (g !== s[0]) for (const p of s) p.dispose();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    out.push(g);
  }
  return out;
}

function makeMesh(geometry: THREE.BufferGeometry, material: THREE.Material, f: DrawFlags, name: string): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.name = name;
  m.castShadow = f.castShadow;
  m.receiveShadow = f.receiveShadow;
  m.renderOrder = f.renderOrder;
  m.layers.mask = f.layers;
  m.frustumCulled = f.frustumCulled;
  if (f.customDepthMaterial) m.customDepthMaterial = f.customDepthMaterial;
  if (f.customDistanceMaterial) m.customDistanceMaterial = f.customDistanceMaterial;
  return m;
}

/** Builder-side batch: push geometry + matrix + material + flags while building, flush() to one mesh per bucket. */
export class StaticBatch {
  private buckets = new Map<string, { material: THREE.Material; flags: DrawFlags; parts: THREE.BufferGeometry[] }>();

  /** Bake `geometry` (cloned; the caller keeps ownership) with `matrix` into the bucket of `material` + `flags`. */
  add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, material: THREE.Material, flags: Partial<DrawFlags> = {}): void {
    const f = { ...DEFAULT_FLAGS, ...flags };
    const key = bucketKey(material, f);
    let b = this.buckets.get(key);
    if (!b) this.buckets.set(key, (b = { material, flags: f, parts: [] }));
    b.parts.push(bakeGeometry(geometry, matrix));
  }

  /** Add a built mesh with its transform relative to `root` (null = world) and its own draw flags. */
  addMesh(mesh: THREE.Mesh, root: THREE.Object3D | null, flags: Partial<DrawFlags> = {}): void {
    if (Array.isArray(mesh.material)) throw new Error('StaticBatch.addMesh: multi-material meshes are not supported');
    this.add(mesh.geometry, relativeMatrix(mesh, root, _m), mesh.material, { ...drawFlags(mesh), ...flags });
  }

  get size(): number {
    let n = 0;
    for (const b of this.buckets.values()) n += b.parts.length;
    return n;
  }

  /** One mesh per bucket (more only if a bucket holds incompatible attribute sets), added to `parent` if given. */
  flush(parent?: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const b of this.buckets.values()) {
      for (const g of mergeBaked(b.parts, b.material)) {
        const m = makeMesh(g, b.material, b.flags, `batch:${b.material.name || b.material.type}`);
        out.push(m);
        parent?.add(m);
      }
    }
    this.buckets.clear();
    return out;
  }
}

export interface MergeOptions {
  /** Objects whose whole subtree is left untouched (animated parts, pop-off debris, things toggled on their own). */
  keep?: Iterable<THREE.Object3D> | ((o: THREE.Object3D) => boolean);
  /** Also merge transparent meshes (changes their blend order; off by default). */
  transparent?: boolean;
}

export interface MergeResult {
  /** New merged meshes, added to the root. */
  meshes: THREE.Mesh[];
  /** Source meshes that were merged and removed from their parents (their geometries are untouched). */
  sources: THREE.Mesh[];
}

/** Can this mesh be baked into a static merge at all (independent of keep-sets)? */
export function canMerge(o: THREE.Object3D, transparent = false): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as unknown as THREE.BatchedMesh).isBatchedMesh) return false;
  if (Array.isArray(m.material) || (!transparent && m.material.transparent)) return false;
  const g = m.geometry;
  if (!g.getAttribute('position') || Object.keys(g.morphAttributes).length > 0) return false;
  if (g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return false;
  return m.onBeforeRender === THREE.Object3D.prototype.onBeforeRender && m.onAfterRender === THREE.Object3D.prototype.onAfterRender;
}

/** Bake every mergeable, visible mesh under `root` (except `keep` subtrees) into one mesh per draw-state bucket,
 *  in root-local space, and add those to `root`. A bucket with a single mesh is left as it is, and so is any mesh
 *  that has children (it acts as a group; its children can still merge). The caller picks a root that only
 *  moves / hides as a whole: merging across groups that are toggled or animated separately breaks those toggles. */
export function mergeStatic(root: THREE.Object3D, opts: MergeOptions = {}): MergeResult {
  const keepFn = typeof opts.keep === 'function' ? opts.keep : null;
  const keepSet = opts.keep && typeof opts.keep !== 'function' ? new Set(opts.keep) : null;
  const kept = (o: THREE.Object3D) => (keepFn ? keepFn(o) : !!keepSet?.has(o));
  const buckets = new Map<string, { material: THREE.Material; flags: DrawFlags; meshes: THREE.Mesh[] }>();
  const walk = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if (!c.visible || kept(c)) continue;
      if (c.children.length === 0 && canMerge(c, opts.transparent)) {
        const f = drawFlags(c);
        const key = bucketKey(c.material as THREE.Material, f);
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { material: c.material as THREE.Material, flags: f, meshes: [] }));
        b.meshes.push(c);
      }
      walk(c);
    }
  };
  walk(root);
  // Bake everything before touching the hierarchy.
  const baked = [...buckets.values()]
    .filter((b) => b.meshes.length > 1)
    .map((b) => ({ b, parts: b.meshes.map((m) => bakeGeometry(m.geometry, relativeMatrix(m, root, _m))) }));
  const res: MergeResult = { meshes: [], sources: [] };
  for (const { b, parts } of baked) {
    for (const g of mergeBaked(parts, b.material)) {
      const m = makeMesh(g, b.material, b.flags, `merged:${b.material.name || b.material.type}`);
      root.add(m);
      res.meshes.push(m);
    }
    for (const m of b.meshes) {
      m.removeFromParent();
      res.sources.push(m);
    }
  }
  return res;
}
