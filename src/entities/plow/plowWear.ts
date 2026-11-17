import * as THREE from 'three';
import { applyWear, type WearFrame, type WearProfile } from '../../render/kit/wear';

/* The art pass's WEAR layer (render/kit/wear.ts) on the player's vehicles: gentler than the bots' (the player's own
 * car is kept up), grime measured by height in the plow BODY's space (so a turret, an arm or the blade high up is not
 * grimed like a wheel arch; the noise sticks to each part), no extra draws or materials. Installed once per Plow after
 * every vehicle body is built (so it never touches how they merged), on the shared materials and each vehicle's own
 * non-glowing opaque ones. Paint Shop paints retune the painted materials' strengths (uniforms: no recompile); mirror
 * finishes stay almost clean. */

/** Height (m, body space) the grime fades out at: a vehicle's lower body, not just the wheel line. */
const GRIME_H = 1.1;
/** The player's car: paint, trim and accent (hubs). */
export const PLOW_PAINT_WEAR: Readonly<WearProfile> = { grime: 0.35, mottle: 0.06, scuff: 0.25, grimeH: GRIME_H };
/** Ice Chrome / Champion Gold: a mirror shows no scuffs and only a breath of road film. */
export const PLOW_MIRROR_WEAR: Readonly<WearProfile> = { grime: 0.1, mottle: 0.015, scuff: 0, grimeH: GRIME_H };
/** As the bots' table (enemies/models.ts wearFor): bare steel / dark frame, rubber, chrome. */
const STEEL: WearProfile = { grime: 0.45, mottle: 0.12, scuff: 0.3, grimeH: GRIME_H };
const RUBBER: WearProfile = { grime: 0.35, mottle: 0.08, scuff: 0, grimeH: GRIME_H };
const CHROME: WearProfile = { grime: 0.25, mottle: 0.05, scuff: 0, grimeH: GRIME_H };
const OTHER: WearProfile = { grime: 0.4, mottle: 0.08, scuff: 0.2, grimeH: GRIME_H };

/** Profile for a vehicle's own material, or null (lit-up, see-through, cut-out, or marked `userData.noWear`). */
export function plowWearFor(m: THREE.Material): WearProfile | null {
  const s = m as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial || s.transparent || s.alphaTest > 0 || s.userData.noWear) return null;
  // Anything that glows (lamps, LEDs, coils, tinted glass with an inner glow) stays clean.
  if (s.emissiveIntensity > 0 && s.emissive.getHex() !== 0) return null;
  if (s.metalness >= 0.7 && s.roughness <= 0.3) return CHROME;
  if (s.roughness >= 0.85) return RUBBER;
  if (s.metalness >= 0.2 || s.color.getHSL({ h: 0, s: 0, l: 0 }).l < 0.12) return STEEL;
  return OTHER;
}

export interface PlowWear {
  /** Retune the painted materials for the equipped paint (mirror finishes: scuff 0). */
  setPaint(mirror: boolean): void;
  /** Materials carrying the patch (tests / probes). */
  readonly materials: readonly THREE.MeshStandardMaterial[];
}

/**
 * Patch the materials under `roots` (skipping `skip` subtrees and materials) plus the `painted` ones, with grime read
 * in `body` space. `fixed` pins a profile (or null = none) for specific shared materials.
 */
export function installPlowWear(opts: {
  body: THREE.Object3D;
  roots: readonly THREE.Object3D[];
  painted: readonly THREE.MeshStandardMaterial[];
  fixed?: ReadonlyMap<THREE.Material, WearProfile | null>;
  skip?: readonly THREE.Object3D[];
}): PlowWear {
  const { body, painted } = opts;
  const frame: WearFrame = { value: new THREE.Matrix4() };
  let last = -1;
  // body world -> body local, refreshed once per rendered frame by whichever worn material draws first (no allocation)
  const refresh = (r: THREE.WebGLRenderer) => {
    const f = r.info.render.frame;
    if (f === last) return;
    last = f;
    frame.value.copy(body.matrixWorld).invert();
  };
  const done = new Set<THREE.Material>();
  const list: THREE.MeshStandardMaterial[] = [];
  const patch = (m: THREE.MeshStandardMaterial, p: WearProfile) => {
    applyWear(m, p, frame);
    const prev = m.onBeforeRender;
    const own = prev === THREE.Material.prototype.onBeforeRender;
    m.onBeforeRender = own ? refresh : (renderer, scene, camera, geometry, object, group) => {
      refresh(renderer);
      prev.call(m, renderer, scene, camera, geometry, object, group);
    };
    m.needsUpdate = true;
    list.push(m);
  };
  for (const m of painted) {
    done.add(m);
    patch(m, { ...PLOW_PAINT_WEAR });
  }
  const skip = new Set(opts.skip ?? []);
  // Program budget (docs/art-pass.md: a few new shader programs per scene): each draw state a worn material renders
  // in (instanced, double-sided, flat, env-mapped...) is one more program, so the instanced wheels / cleats and the
  // double-sided blade sheet stay unworn; the bodies' plain and env-mapped variants carry the look.
  const instanced = new Set<THREE.Material>();
  for (const r of opts.roots) {
    r.traverse((o) => {
      if ((o as THREE.InstancedMesh).isInstancedMesh) for (const m of [(o as THREE.Mesh).material].flat()) instanced.add(m);
    });
  }
  const visit = (o: THREE.Object3D) => {
    if (skip.has(o)) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (done.has(m)) continue;
        done.add(m);
        if (instanced.has(m) || m.side === THREE.DoubleSide) continue;
        const p = opts.fixed?.has(m) ? opts.fixed.get(m) : plowWearFor(m);
        if (p && !m.userData.kitWear) patch(m as THREE.MeshStandardMaterial, { ...p });
      }
    }
    for (const c of o.children) visit(c);
  };
  for (const r of opts.roots) visit(r);
  return {
    materials: list,
    setPaint(mirror) {
      const p = mirror ? PLOW_MIRROR_WEAR : PLOW_PAINT_WEAR;
      for (const m of painted) (m.userData.kitWear.kwWear.value as THREE.Vector4).set(p.grime, p.mottle, p.scuff, p.grimeH ?? GRIME_H);
    },
  };
}
