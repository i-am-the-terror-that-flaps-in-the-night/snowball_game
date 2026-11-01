import * as THREE from 'three';

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
