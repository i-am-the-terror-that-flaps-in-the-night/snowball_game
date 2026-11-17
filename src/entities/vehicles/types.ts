import * as THREE from 'three';
import { boltHead, chamferBox, chamferTaper, chamferWedge } from '../../render/kit/shapes';

/* Per-vehicle body builders (one file per non-Classic vehicle). The Plow owns the shared materials (paint / trim are
 * repainted by the Paint Shop, coil / core glow are animated) and hands them in; each builder returns the finished
 * body group (static parts already merged with mergeStatic and given a shadow proxy) plus the named parts the Plow
 * animates. The Plow adds the group under its body, shows it only for its kind, and keeps the shared wheels (hidden
 * per kind in Plow.setKind) and dash flame. Model space: facing +Z, ground at y = 0, chassis top ~0.8 m. */

export interface VehicleMats {
  /** Body paint (Paint Shop colour). */
  paint: THREE.MeshStandardMaterial;
  /** Secondary paint (Paint Shop trim colour). */
  trim: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  /** VOLT-9 coil glow (emissive pulse animated by the Plow). */
  coil: THREE.MeshStandardMaterial;
  /** Wheel hub / idler paint. */
  hub: THREE.MeshStandardMaterial;
  /** Headlight glow. */
  head: THREE.MeshStandardMaterial;
}

export interface VehicleBuildIn {
  mats: VehicleMats;
  /** The shared chassis slab geometry (1.7 x 0.35 x 4.0); add a copy at (0, 0.62, 0.05) or replace it. */
  chassis: THREE.BufferGeometry;
}

/** What a vehicle builder returns: the body group and its animatable parts. */
export interface VehicleBuild<P> {
  group: THREE.Group;
  parts: P;
}

/** Add a mesh at (x, y, z) under `parent` (shadow-casting by default, like Plow's own helper). */
export function addMesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  parent.add(m);
  return m;
}

/* ---- Art-pass detail kit on the vehicles (render/kit/shapes.ts, docs/art-pass.md). The plows are close-up models, so
 * they get the STRONG chamfer (1.9x the bots' 0.045 m default) and fine detail (bolts) where the garage and the chase
 * camera see it. Kit shapes are built at their final size, cached and shared: never transform one in place (clone it
 * first). They merge into a body's existing per-material draws like any other part. */

/** Chamfer strength on the vehicles ('strong'). */
export const PLOW_KIT_K = 1.9;
/** Default chamfer (m) before PLOW_KIT_K; chamferHull caps it at a third of the part's shortest edge. */
export const PLOW_BEVEL = 0.045;

/** Chamfered box w x h x d (centred). */
export const kitBox = (w: number, h: number, d: number, c = PLOW_BEVEL): THREE.BufferGeometry => chamferBox(w, h, d, c * PLOW_KIT_K);
/** Chamfered wedge (front = +z, top-front edge pulled back by k of the depth). */
export const kitWedge = (w: number, h: number, d: number, k: number, c = PLOW_BEVEL): THREE.BufferGeometry => chamferWedge(w, h, d, k, c * PLOW_KIT_K);
/** Chamfered tapered block (top kt of the bottom). */
export const kitTaper = (w: number, h: number, d: number, kt: number, c = PLOW_BEVEL): THREE.BufferGeometry => chamferTaper(w, h, d, kt, c * PLOW_KIT_K);

type V3 = readonly [number, number, number];
const _e = new THREE.Euler();

/** A row of `n` hex bolt heads from `a` to `b` under `parent`, heads along local +y turned by Euler `r` (fine detail:
 *  plates and blades the camera gets close to). `shadow` must match the material's other parts in that merge (the
 *  draw-state buckets of mergeStatic), or the bolts would add a draw. */
export function boltRow(parent: THREE.Object3D, mat: THREE.Material, a: V3, b: V3, n: number, r: V3 = [0, 0, 0], size = 0.034, shadow = false): void {
  const g = boltHead(size, size * 0.7);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const m = addMesh(g, mat, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, parent, shadow);
    m.rotation.copy(_e.set(r[0], r[1], r[2]));
  }
}
