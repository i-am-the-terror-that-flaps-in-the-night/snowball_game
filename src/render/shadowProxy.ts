import * as THREE from 'three';
import { relativeMatrix } from './mergeStatic';

/* Shadow-only casters. In the shadow pass every caster is drawn with the renderer's own depth material, so the
 * per-material split of a model only costs draws there. A proxy is one position-only merged geometry of several
 * casters: the visible meshes stop casting (castShadow = false) and the proxy draws their depth in one call.
 *
 * WebGL (r186) routing: WebGLRenderer.render() builds the main render list (projectObject skips objects whose
 * material.visible is false) BEFORE it calls shadowMap.render(), and WebGLShadowMap.renderObject() also skips
 * material.visible === false. All proxies therefore share a few stand-in materials (one per depth side) that stay
 * invisible, and installShadowProxies() wraps renderer.shadowMap.render so they are visible only for the shadow
 * pass. The stand-in itself is never compiled: the shadow pass swaps in its MeshDepthMaterial (which reads only
 * `position`; normalBias is applied by the receivers), copying side / shadowSide / visible from the stand-in.
 * Frustum culling still works per pass (the shadow pass tests the light's frustum). The shadow pass tests object
 * layers against the MAIN camera, which is why layers can't do this routing in WebGL.
 *
 * WebGPU (not implemented yet): ShadowNode renders with shadow.camera.layers when those have non-default bits,
 * so there a proxy goes on a dedicated layer (e.g. 1) with a visible material, the sun's shadow.camera enables
 * that layer, and the main camera doesn't; no renderer wrapper is needed.
 *
 * Never proxy casters whose depth depends on their material: alphaTest with map / alphaMap, displacementMap,
 * clipping planes, alphaToCoverage, wireframe, custom depth materials, morph targets or skinning (canProxy). */

export interface ShadowPassRenderer {
  shadowMap: { render: (...args: never[]) => void };
}

const MATS = new Map<string, THREE.MeshBasicMaterial>();
let inShadowPass = false;

/** The shared stand-in material for casters with this side / shadowSide (visible only during the shadow pass). */
export function shadowProxyMaterial(side: THREE.Side = THREE.FrontSide, shadowSide: THREE.Side | null = null): THREE.MeshBasicMaterial {
  const key = `${side}|${shadowSide}`;
  let m = MATS.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ side, colorWrite: false, depthWrite: false });
    m.shadowSide = shadowSide;
    m.name = 'shadowProxy';
    m.visible = inShadowPass;
    MATS.set(key, m);
  }
  return m;
}

/** Flip every proxy stand-in material (exported for tests; installShadowProxies does this around the pass). */
export function setShadowPass(on: boolean): void {
  inShadowPass = on;
  for (const m of MATS.values()) m.visible = on;
}

const WRAPPED = new WeakSet<object>();

/** Wrap renderer.shadowMap.render once so proxy materials are visible only inside the shadow pass. */
export function installShadowProxies(renderer: ShadowPassRenderer): void {
  const sm = renderer.shadowMap;
  if (WRAPPED.has(sm)) return;
  WRAPPED.add(sm);
  const render = sm.render;
  sm.render = function (this: unknown, ...args: never[]) {
    setShadowPass(true);
    try {
      render.apply(this, args);
    } finally {
      setShadowPass(false);
    }
  } as typeof sm.render;
}

/** A depth-only caster: invisible in the main pass, never raycast. clone() shares geometry and stand-in. */
export class ShadowProxy extends THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  readonly isShadowProxy = true;

  constructor(geometry?: THREE.BufferGeometry, material: THREE.MeshBasicMaterial = shadowProxyMaterial()) {
    super(geometry, material);
    this.name = 'shadowProxy';
    this.castShadow = true;
    this.receiveShadow = false;
  }

  override raycast(): void {}
}

/** Is the shadow of this mesh fully described by its geometry + side (so a proxy can draw it)? */
export function canProxy(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || (m as unknown as THREE.BatchedMesh).isBatchedMesh || m instanceof ShadowProxy) return false;
  if (m.customDepthMaterial || m.customDistanceMaterial || Array.isArray(m.material)) return false;
  if (Object.keys(m.geometry.morphAttributes).length > 0 || !m.geometry.getAttribute('position')) return false;
  const mat = m.material as THREE.MeshStandardMaterial;
  if ((mat.alphaTest > 0 && (mat.map || mat.alphaMap)) || mat.alphaToCoverage || mat.wireframe) return false;
  if ((mat.displacementMap && mat.displacementScale !== 0) || (mat.clippingPlanes && mat.clippingPlanes.length)) return false;
  return m.geometry.drawRange.start === 0 && m.geometry.drawRange.count === Infinity;
}

const _rel = new THREE.Matrix4();
const _inst = new THREE.Matrix4();

/** Append `g`'s triangles, transformed by `m`, to the position / index arrays (winding flipped when m mirrors). */
function appendPositions(g: THREE.BufferGeometry, m: THREE.Matrix4, pos: number[], idx: number[]): void {
  const p = g.getAttribute('position');
  const base = pos.length / 3;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m);
    pos.push(v.x, v.y, v.z);
  }
  const flip = m.determinant() < 0;
  const n = g.index ? g.index.count : p.count;
  for (let i = 0; i + 2 < n; i += 3) {
    const a = g.index ? g.index.getX(i) : i;
    const b = g.index ? g.index.getX(i + 1) : i + 1;
    const c = g.index ? g.index.getX(i + 2) : i + 2;
    if (flip) idx.push(base + a, base + c, base + b);
    else idx.push(base + a, base + b, base + c);
  }
}

function proxyGeometry(pos: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

export interface ShadowProxyOptions {
  /** Subtrees to leave alone (they keep casting themselves), e.g. parts that animate on their own. */
  keep?: Iterable<THREE.Object3D>;
  /** Set castShadow = false on every source that went into a proxy (default true). */
  disableSources?: boolean;
  /** Also take casters under hidden objects (e.g. a plow kind group that is hidden at build time). */
  includeHidden?: boolean;
}

/** Build shadow proxies, in `root` space, for a raw geometry (one proxy, FrontSide unless `side` is given via a
 *  mesh) or for every visible caster (castShadow, canProxy) in the given objects' subtrees. InstancedMesh casters
 *  are expanded per instance. Returns one proxy per depth side (usually one); the caller adds them under `root`
 *  (proxies are ordinary children, so hiding / moving / disposing the root covers them). Empty array when there
 *  was nothing to proxy. */
export function makeShadowProxy(
  source: THREE.BufferGeometry | THREE.Object3D | Iterable<THREE.Object3D>,
  root: THREE.Object3D | null = null,
  opts: ShadowProxyOptions = {},
): ShadowProxy[] {
  if ((source as THREE.BufferGeometry).isBufferGeometry) {
    const pos: number[] = [];
    const idx: number[] = [];
    appendPositions(source as THREE.BufferGeometry, _rel.identity(), pos, idx);
    return [new ShadowProxy(proxyGeometry(pos, idx))];
  }
  const keep = new Set(opts.keep ?? []);
  const sides = new Map<string, { mat: THREE.MeshBasicMaterial; pos: number[]; idx: number[] }>();
  const used: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D) => {
    if ((!o.visible && !opts.includeHidden) || keep.has(o)) return;
    if (o.castShadow && canProxy(o) && (o.material as THREE.Material).visible) {
      const mat = o.material as THREE.Material;
      const sm = shadowProxyMaterial(mat.side, mat.shadowSide);
      let s = sides.get(sm.uuid);
      if (!s) sides.set(sm.uuid, (s = { mat: sm, pos: [], idx: [] }));
      relativeMatrix(o, root, _rel);
      const im = o as THREE.InstancedMesh;
      if (im.isInstancedMesh) {
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, _inst);
          appendPositions(o.geometry, _inst.premultiply(_rel), s.pos, s.idx);
        }
      } else appendPositions(o.geometry, _rel, s.pos, s.idx);
      used.push(o);
    }
    for (const c of o.children) visit(c);
  };
  const list = (source as THREE.Object3D).isObject3D ? [source as THREE.Object3D] : [...(source as Iterable<THREE.Object3D>)];
  for (const o of list) visit(o);
  if (opts.disableSources !== false) for (const m of used) m.castShadow = false;
  return [...sides.values()].map((s) => new ShadowProxy(proxyGeometry(s.pos, s.idx), s.mat));
}
