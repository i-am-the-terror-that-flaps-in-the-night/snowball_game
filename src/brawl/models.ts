import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getSnowballGeometry, getSnowballMaterial } from '../entities/snowballMesh';
import type { PlowKind } from '../config/plows';
import { PLOW_WHEEL_POS, PLOW_WHEEL_R, buildBruteParts, buildVoltParts, cleatZ } from '../entities/plowModels';
import { makeShadowProxy, type ShadowProxy } from '../render/shadowProxy';
import { Palette, paletteEligible } from '../render/palette';
import { bakeGeometry, mergeBaked } from '../render/mergeStatic';

/* Procedural rival snowplow vehicles for Brawl mode. All face local +Z, ground at y = 0.
 * Static parts of each kind are merged per material ONCE (cached); instances share those geometries and
 * only own three materials (paint / blade / beacon) so each rival can be painted and flash.
 * VOLT-9 / BRUTUS rivals swap the vehicle body for the player's own starter-plow silhouette
 * (src/entities/plowModels.ts), scaled to the rival footprint and painted in the rival's color. */

export type RivalKind = 'pickup' | 'tractor' | 'monster' | 'dozer' | 'rally' | 'zamboni';
export const RIVAL_KINDS: RivalKind[] = ['pickup', 'tractor', 'monster', 'dozer', 'rally', 'zamboni'];

/** Front of the blade (local z). */
export const BLADE_Z = 1.75;
export const BLADE_W = 2.8;

type MatKey = 'paint' | 'blade' | 'dark' | 'steel' | 'black' | 'glass' | 'light' | 'tail' | 'white' | 'chrome';

const SHARED = new Map<string, THREE.MeshStandardMaterial>();
function shared(key: MatKey): THREE.MeshStandardMaterial {
  let m = SHARED.get(key);
  if (m) return m;
  const base = { roughness: 0.55, metalness: 0.1, flatShading: true };
  switch (key) {
    case 'dark': m = new THREE.MeshStandardMaterial({ ...base, color: 0x34383f, metalness: 0.3 }); break;
    case 'steel': m = new THREE.MeshStandardMaterial({ ...base, color: 0xa4adb8, roughness: 0.35, metalness: 0.5 }); break;
    case 'black': m = new THREE.MeshStandardMaterial({ ...base, color: 0x16171b, roughness: 0.9 }); break;
    case 'glass': m = new THREE.MeshStandardMaterial({ ...base, color: 0x1b2b40, roughness: 0.1, metalness: 0.3, emissive: 0x0e2244, emissiveIntensity: 0.6 }); break;
    case 'light': m = new THREE.MeshStandardMaterial({ ...base, color: 0xfff6d0, emissive: 0xfff0b0, emissiveIntensity: 2.2 }); break;
    case 'tail': m = new THREE.MeshStandardMaterial({ ...base, color: 0xff2020, emissive: 0xff1010, emissiveIntensity: 1.4 }); break;
    case 'white': m = new THREE.MeshStandardMaterial({ ...base, color: 0xf2f4f8 }); break;
    case 'chrome': m = new THREE.MeshStandardMaterial({ ...base, color: 0xe6ebf2, roughness: 0.15, metalness: 0.65 }); break;
    default: m = new THREE.MeshStandardMaterial({ ...base, color: 0xffffff });
  }
  SHARED.set(key, m);
  return m;
}

/* Static looks (every shared material, no per-rival state) collapse into palette materials (src/render/palette.ts):
 * one draw per shading mode instead of one per material. The instanced wheels get their own palette so no
 * material is drawn both instanced and plain (that would switch its program on every rival). */
const PALETTES = new Map<string, Palette>();
function palette(use: 'body' | 'wheel', flatShading: boolean): Palette {
  const key = `${use}|${flatShading}`;
  let p = PALETTES.get(key);
  if (!p) PALETTES.set(key, (p = new Palette({ flatShading })));
  return p;
}

/** Material.id (creation order; not in the typings). */
const matId = (m: THREE.Material) => (m as unknown as { id: number }).id;

/** Merge static parts (each with its own eligible material) into palette geometries, one per shading mode. */
function paletteParts(list: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial }[]): { geo: THREE.BufferGeometry; mat: THREE.Material }[] {
  const by = new Map<Palette, THREE.BufferGeometry[]>();
  // In material-id order: the order the separate draws had, so coincident depths resolve the same way.
  for (const { geo, mat } of [...list].sort((a, b) => matId(a.mat) - matId(b.mat))) {
    const pal = palette('body', mat.flatShading);
    let a = by.get(pal);
    if (!a) by.set(pal, (a = []));
    a.push(pal.apply(bakeGeometry(geo, _ident, ['position', 'normal']), mat));
    geo.dispose();
  }
  const out: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];
  for (const [pal, geos] of by) for (const geo of mergeBaked(geos, pal.material)) out.push({ geo, mat: pal.material });
  return out;
}

let instDepth: THREE.MeshDepthMaterial | null = null;
/** Depth material for instanced casters: the same as the renderer's default one, but kept apart so the shadow
 *  pass doesn't switch the default's program between instanced and plain casters on every rival. */
export function instancedDepthMaterial(): THREE.MeshDepthMaterial {
  if (!instDepth) instDepth = new THREE.MeshDepthMaterial();
  return instDepth;
}

/* ------------------------------------------------------------------ geometry helpers */

const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _ident = new THREE.Matrix4();

function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _m.compose(_p, _q, _s);
  g.applyMatrix4(_m);
  return g;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  place(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
const cyl = (rt: number, rb: number, h: number, seg: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  place(new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, rx, ry, rz);

interface WheelSpec {
  x: number;
  y: number;
  z: number;
  r: number;
  w: number;
}

interface KindTemplate {
  /** Merged per material; `mat` is set for palette parts (key unused there). */
  parts: { geo: THREE.BufferGeometry; key: MatKey; mat?: THREE.Material }[];
  wheels: WheelSpec[];
  /** Top of the vehicle (tags float above). */
  height: number;
  beacon: [number, number, number];
  /** Depth-only caster for every static body part (built with the first rig, cloned per rig). */
  shadow?: ShadowProxy[];
}

const TEMPLATES = new Map<RivalKind, KindTemplate>();
const WHEEL_GEOS = new Map<string, THREE.BufferGeometry>();

function wheelGeo(r: number, w: number): THREE.BufferGeometry {
  const key = `${r}_${w}`;
  let g = WHEEL_GEOS.get(key);
  if (g) return g;
  const tire = place(new THREE.CylinderGeometry(r, r, w, 14), 0, 0, 0, 0, 0, Math.PI / 2);
  const hubs: THREE.BufferGeometry[] = [];
  hubs.push(place(new THREE.CylinderGeometry(r * 0.5, r * 0.5, w + 0.04, 8), 0, 0, 0, 0, 0, Math.PI / 2));
  // Spokes so the spin reads.
  hubs.push(box(w + 0.06, r * 1.5, r * 0.18, 0, 0, 0));
  hubs.push(box(w + 0.06, r * 0.18, r * 1.5, 0, 0, 0));
  const hub = mergeGeometries(hubs)!;
  // Black tire + steel hub on the wheel palette: one draw.
  const pal = palette('wheel', true);
  g = mergeGeometries([pal.apply(tire, shared('black')), pal.apply(hub, shared('steel'))])!;
  tire.dispose();
  hub.dispose();
  for (const x of hubs) x.dispose();
  WHEEL_GEOS.set(key, g);
  return g;
}

function addBlade(parts: KindTemplate['parts'], armY: number, armZ: number): void {
  const z = BLADE_Z - 0.1;
  // Chunky, slightly curved blade (three tilted slabs).
  parts.push({ geo: box(BLADE_W, 0.42, 0.22, 0, 0.27, z + 0.02, -0.25), key: 'blade' });
  parts.push({ geo: box(BLADE_W, 0.38, 0.22, 0, 0.66, z - 0.03, 0.05), key: 'blade' });
  parts.push({ geo: box(BLADE_W, 0.28, 0.2, 0, 0.97, z - 0.12, 0.35), key: 'blade' });
  // Steel cutting edge + end caps.
  parts.push({ geo: box(BLADE_W + 0.04, 0.1, 0.26, 0, 0.06, z + 0.08), key: 'steel' });
  parts.push({ geo: box(0.1, 1.1, 0.4, BLADE_W / 2, 0.55, z - 0.02), key: 'dark' });
  parts.push({ geo: box(0.1, 1.1, 0.4, -BLADE_W / 2, 0.55, z - 0.02), key: 'dark' });
  // Hazard-ish black stripes on the face.
  parts.push({ geo: box(0.22, 0.6, 0.06, -0.8, 0.55, z + 0.12, -0.1), key: 'black' });
  parts.push({ geo: box(0.22, 0.6, 0.06, 0.8, 0.55, z + 0.12, -0.1), key: 'black' });
  // Push arms back to the chassis.
  const len = Math.max(0.3, z - 0.2 - armZ);
  parts.push({ geo: box(0.16, 0.16, len, 0.65, armY, armZ + len / 2), key: 'dark' });
  parts.push({ geo: box(0.16, 0.16, len, -0.65, armY, armZ + len / 2), key: 'dark' });
  parts.push({ geo: cyl(0.1, 0.1, 0.4, 6, 0.65, armY + 0.1, armZ + len * 0.6, 0.9), key: 'chrome' });
  parts.push({ geo: cyl(0.1, 0.1, 0.4, 6, -0.65, armY + 0.1, armZ + len * 0.6, 0.9), key: 'chrome' });
}

function lights(parts: KindTemplate['parts'], y: number, z: number, x: number, zr: number, yr = y): void {
  parts.push({ geo: box(0.32, 0.16, 0.06, x, y, z), key: 'light' });
  parts.push({ geo: box(0.32, 0.16, 0.06, -x, y, z), key: 'light' });
  parts.push({ geo: box(0.26, 0.12, 0.05, x, yr, zr), key: 'tail' });
  parts.push({ geo: box(0.26, 0.12, 0.05, -x, yr, zr), key: 'tail' });
}

function buildTemplate(kind: RivalKind): KindTemplate {
  const parts: KindTemplate['parts'] = [];
  const wheels: WheelSpec[] = [];
  let height = 2;
  let beacon: [number, number, number] = [0, 2, 0];
  const four = (x: number, y: number, zf: number, zr: number, r: number, w: number) => {
    wheels.push({ x, y, z: zf, r, w }, { x: -x, y, z: zf, r, w }, { x, y, z: zr, r, w }, { x: -x, y, z: zr, r, w });
  };
  switch (kind) {
    case 'pickup': {
      parts.push({ geo: box(1.6, 0.3, 3.0, 0, 0.5, -0.1), key: 'dark' });
      parts.push({ geo: box(1.85, 0.5, 1.0, 0, 0.9, 0.95), key: 'paint' }); // hood
      parts.push({ geo: box(1.85, 0.85, 1.15, 0, 1.15, 0.0), key: 'paint' }); // cab
      parts.push({ geo: box(1.88, 0.42, 0.95, 0, 1.3, 0.02), key: 'glass' });
      parts.push({ geo: box(1.7, 0.08, 1.05, 0, 1.6, 0.0), key: 'paint' }); // roof
      parts.push({ geo: box(0.14, 0.45, 1.3, 0.86, 0.92, -1.0), key: 'paint' });
      parts.push({ geo: box(0.14, 0.45, 1.3, -0.86, 0.92, -1.0), key: 'paint' });
      parts.push({ geo: box(1.85, 0.45, 0.12, 0, 0.92, -1.62), key: 'paint' });
      parts.push({ geo: box(1.6, 0.1, 1.3, 0, 0.72, -1.0), key: 'black' });
      parts.push({ geo: box(1.5, 0.3, 0.08, 0, 0.85, 1.47), key: 'chrome' }); // grille
      parts.push({ geo: box(1.6, 0.06, 0.06, 0, 1.66, -0.3), key: 'black' }); // light bar
      lights(parts, 0.95, 1.47, 0.68, -1.69);
      four(0.92, 0.42, 1.0, -1.05, 0.42, 0.34);
      addBlade(parts, 0.5, 1.2);
      height = 1.7;
      beacon = [0, 1.75, 0.1];
      break;
    }
    case 'tractor': {
      parts.push({ geo: box(0.9, 0.7, 1.7, 0, 0.95, 0.55), key: 'paint' }); // hood
      parts.push({ geo: box(0.92, 0.12, 1.72, 0, 1.33, 0.55), key: 'paint' });
      parts.push({ geo: box(0.8, 0.5, 0.06, 0, 0.9, 1.42), key: 'dark' }); // grille
      parts.push({ geo: box(1.2, 0.4, 1.5, 0, 0.7, -0.75), key: 'dark' }); // chassis
      parts.push({ geo: box(1.5, 0.12, 1.4, 0, 2.15, -0.7), key: 'paint' }); // roof
      for (const sx of [0.68, -0.68]) for (const sz of [-0.05, -1.35]) parts.push({ geo: box(0.08, 1.25, 0.08, sx, 1.5, sz), key: 'black' });
      parts.push({ geo: box(1.3, 0.9, 0.05, 0, 1.55, -0.07), key: 'glass' });
      parts.push({ geo: box(0.55, 0.15, 0.5, 0, 1.0, -0.8), key: 'black' }); // seat
      parts.push({ geo: box(0.55, 0.5, 0.12, 0, 1.25, -1.05), key: 'black' });
      parts.push({ geo: cyl(0.08, 0.1, 0.9, 8, 0.3, 1.75, 1.0), key: 'dark' }); // exhaust
      parts.push({ geo: cyl(0.11, 0.11, 0.12, 8, 0.3, 2.22, 1.0), key: 'chrome' });
      // Rear fenders.
      parts.push({ geo: box(0.5, 0.1, 1.3, 0.95, 1.6, -0.8), key: 'paint' });
      parts.push({ geo: box(0.5, 0.1, 1.3, -0.95, 1.6, -0.8), key: 'paint' });
      lights(parts, 1.15, 1.44, 0.3, -1.52, 1.2);
      wheels.push({ x: 0.98, y: 0.78, z: -0.8, r: 0.78, w: 0.46 }, { x: -0.98, y: 0.78, z: -0.8, r: 0.78, w: 0.46 });
      wheels.push({ x: 0.7, y: 0.42, z: 0.95, r: 0.42, w: 0.26 }, { x: -0.7, y: 0.42, z: 0.95, r: 0.42, w: 0.26 });
      addBlade(parts, 0.55, 1.0);
      height = 2.25;
      beacon = [0, 2.3, -0.7];
      break;
    }
    case 'monster': {
      parts.push({ geo: box(1.1, 0.3, 2.6, 0, 1.05, 0), key: 'dark' });
      parts.push({ geo: box(1.9, 0.6, 2.7, 0, 1.55, 0), key: 'paint' });
      parts.push({ geo: box(1.6, 0.65, 1.1, 0, 2.15, -0.2), key: 'paint' });
      parts.push({ geo: box(1.62, 0.36, 0.9, 0, 2.2, -0.18), key: 'glass' });
      parts.push({ geo: box(1.8, 0.1, 0.1, 0, 2.55, -0.75), key: 'chrome' }); // roll bar
      parts.push({ geo: box(0.1, 0.5, 0.1, 0.85, 2.3, -0.75), key: 'chrome' });
      parts.push({ geo: box(0.1, 0.5, 0.1, -0.85, 2.3, -0.75), key: 'chrome' });
      for (const s of [1, -1]) {
        parts.push({ geo: box(0.6, 0.1, 0.9, s * 1.05, 1.88, 1.0), key: 'black' });
        parts.push({ geo: box(0.6, 0.1, 0.9, s * 1.05, 1.88, -1.0), key: 'black' });
        parts.push({ geo: box(0.08, 0.9, 0.08, s * 0.5, 0.95, 1.0, 0, 0, s * 0.5), key: 'chrome' });
        parts.push({ geo: box(0.08, 0.9, 0.08, s * 0.5, 0.95, -1.0, 0, 0, s * 0.5), key: 'chrome' });
      }
      lights(parts, 1.6, 1.36, 0.6, -1.36);
      four(1.05, 0.75, 1.0, -1.0, 0.75, 0.6);
      addBlade(parts, 0.7, 1.0);
      height = 2.6;
      beacon = [0, 2.6, -0.2];
      break;
    }
    case 'dozer': {
      for (const s of [1, -1]) {
        parts.push({ geo: box(0.48, 0.62, 2.7, s * 0.86, 0.36, -0.15), key: 'black' });
        parts.push({ geo: cyl(0.31, 0.31, 0.48, 10, s * 0.86, 0.36, 1.2, 0, 0, Math.PI / 2), key: 'black' });
        parts.push({ geo: cyl(0.31, 0.31, 0.48, 10, s * 0.86, 0.36, -1.5, 0, 0, Math.PI / 2), key: 'black' });
        parts.push({ geo: box(0.5, 0.06, 2.6, s * 0.86, 0.7, -0.15), key: 'dark' });
      }
      parts.push({ geo: box(1.25, 0.65, 2.1, 0, 0.98, -0.25), key: 'paint' });
      parts.push({ geo: box(1.1, 0.85, 1.0, 0, 1.72, -0.55), key: 'paint' });
      parts.push({ geo: box(1.12, 0.45, 0.85, 0, 1.82, -0.52), key: 'glass' });
      parts.push({ geo: box(1.2, 0.08, 1.1, 0, 2.18, -0.55), key: 'paint' });
      parts.push({ geo: cyl(0.08, 0.08, 0.8, 8, 0.4, 1.6, 0.45), key: 'dark' });
      parts.push({ geo: box(1.0, 0.25, 0.06, 0, 1.05, 0.81), key: 'dark' });
      lights(parts, 1.18, 0.82, 0.42, -1.31);
      for (const s of [1, -1]) for (const z of [0.75, -0.15, -1.05]) wheels.push({ x: s * 1.12, y: 0.36, z, r: 0.26, w: 0.08 });
      addBlade(parts, 0.55, 0.7);
      height = 2.25;
      beacon = [0, 2.28, -0.55];
      break;
    }
    case 'rally': {
      parts.push({ geo: box(1.8, 0.42, 3.1, 0, 0.55, 0), key: 'paint' });
      parts.push({ geo: box(1.5, 0.45, 1.4, 0, 0.98, -0.25), key: 'paint' });
      parts.push({ geo: box(1.52, 0.32, 1.15, 0, 1.0, -0.22), key: 'glass' });
      parts.push({ geo: box(0.5, 0.12, 0.6, 0, 0.82, 0.9), key: 'black' }); // hood scoop
      parts.push({ geo: box(1.82, 0.08, 0.5, 0, 0.6, 0.0), key: 'white' }); // racing stripe
      parts.push({ geo: box(0.4, 0.44, 3.12, 0, 0.56, 0), key: 'white' });
      parts.push({ geo: box(0.08, 0.4, 0.08, 0.7, 1.0, -1.42), key: 'black' });
      parts.push({ geo: box(0.08, 0.4, 0.08, -0.7, 1.0, -1.42), key: 'black' });
      parts.push({ geo: box(1.9, 0.06, 0.42, 0, 1.22, -1.48), key: 'paint' });
      parts.push({ geo: box(1.2, 0.18, 0.06, 0, 0.62, 1.56), key: 'black' });
      lights(parts, 0.66, 1.56, 0.68, -1.56);
      four(0.94, 0.36, 1.05, -1.05, 0.36, 0.3);
      addBlade(parts, 0.42, 1.3);
      height = 1.4;
      beacon = [0, 1.28, -0.25];
      break;
    }
    case 'zamboni': {
      parts.push({ geo: box(1.9, 1.15, 2.6, 0, 0.95, -0.35), key: 'paint' });
      parts.push({ geo: box(1.92, 0.22, 2.62, 0, 1.05, -0.35), key: 'white' });
      parts.push({ geo: box(1.7, 0.3, 2.3, 0, 1.65, -0.5), key: 'paint' });
      parts.push({ geo: box(1.5, 0.5, 0.75, 0, 0.75, 1.15), key: 'dark' }); // driver nose
      parts.push({ geo: box(0.6, 0.15, 0.5, 0, 1.6, 0.85), key: 'black' }); // seat
      parts.push({ geo: box(0.6, 0.6, 0.1, 0, 1.85, 0.6), key: 'black' });
      parts.push({ geo: box(1.5, 0.75, 0.06, 0, 2.05, 1.25, -0.25), key: 'glass' });
      parts.push({ geo: box(0.08, 0.9, 0.08, 0.7, 1.95, 1.2), key: 'chrome' });
      parts.push({ geo: box(0.08, 0.9, 0.08, -0.7, 1.95, 1.2), key: 'chrome' });
      parts.push({ geo: box(1.6, 0.08, 0.9, 0, 2.42, 0.95), key: 'paint' });
      parts.push({ geo: cyl(0.12, 0.12, 1.7, 10, 0, 0.3, -1.72, 0, 0, Math.PI / 2), key: 'steel' }); // rear roller
      lights(parts, 1.0, 1.5, 0.55, -1.66);
      four(0.9, 0.34, 0.95, -1.15, 0.34, 0.26);
      addBlade(parts, 0.45, 1.4);
      height = 2.5;
      beacon = [0, 2.52, 0.95];
      break;
    }
  }
  // Merge per material.
  const byKey = new Map<MatKey, THREE.BufferGeometry[]>();
  for (const p of parts) {
    let a = byKey.get(p.key);
    if (!a) byKey.set(p.key, (a = []));
    a.push(p.geo);
  }
  const merged: KindTemplate['parts'] = [];
  const statics: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial }[] = [];
  for (const [key, list] of byKey) {
    const g = mergeGeometries(list)!;
    for (const x of list) x.dispose();
    if (key !== 'paint' && key !== 'blade' && paletteEligible(shared(key), { side: THREE.FrontSide, flatShading: shared(key).flatShading })) statics.push({ geo: g, mat: shared(key) });
    else {
      g.computeBoundingSphere();
      merged.push({ geo: g, key });
    }
  }
  for (const p of paletteParts(statics)) merged.push({ geo: p.geo, key: 'dark', mat: p.mat });
  return { parts: merged, wheels, height, beacon };
}

function template(kind: RivalKind): KindTemplate {
  let t = TEMPLATES.get(kind);
  if (!t) TEMPLATES.set(kind, (t = buildTemplate(kind)));
  return t;
}

/* ------------------------------------------------------------------ VOLT-9 / BRUTUS plow bodies */

/** Player-plow models are ~4.6 m long; rivals are ~3.4 m (blade front at BLADE_Z). */
const PM_SCALE = 0.75;
const PM_Z = -0.1;

type Slot = 'paint' | 'blade' | 'coil';
interface PlowTemplate {
  parts: { geo: THREE.BufferGeometry; slot: Slot | null; mat: THREE.Material; shadow: boolean }[];
  wheels: WheelSpec[];
  height: number;
  beacon: [number, number, number];
  /** Tesla coil tops (rival-local), VOLT-9 only. */
  coilTops: THREE.Vector3[];
  /** Track cleats (rival-local x / y; z animates), BRUTUS only. */
  cleats: { x: number; y: number; top: boolean; i: number }[];
  cleatSpan: number;
  cleatGeo: THREE.BufferGeometry | null;
  cleatMat: THREE.Material | null;
  shadow?: ShadowProxy[];
}
const PLOW_TEMPLATES = new Map<PlowKind, PlowTemplate>();

function buildPlowTemplate(kind: 'volt' | 'brute'): PlowTemplate {
  // Slot placeholders: swapped for the rival's own paint / coil materials per instance.
  const paintSlot = new THREE.MeshStandardMaterial();
  const coilSlot = new THREE.MeshStandardMaterial();
  const root = new THREE.Group();
  root.scale.setScalar(PM_SCALE);
  root.position.z = PM_Z;
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.35, 4.0), shared('dark'));
  chassis.position.set(0, 0.62, 0.05);
  root.add(chassis);
  const skip = new Set<THREE.Object3D>();
  const coilTopObjs: THREE.Object3D[] = [];
  const cleats: PlowTemplate['cleats'] = [];
  let cleatSpan = 0;
  let cleatGeo: THREE.BufferGeometry | null = null;
  let cleatMat: THREE.Material | null = null;
  let beacon: [number, number, number];
  if (kind === 'volt') {
    const v = buildVoltParts({ paint: paintSlot, coil: coilSlot });
    root.add(v.group);
    coilTopObjs.push(...v.coilTops);
    beacon = [0, (1.26 + 0.55) * PM_SCALE + 0.06, 0.25 * PM_SCALE + PM_Z];
  } else {
    const hub = new THREE.MeshStandardMaterial({ color: 0xffc21a, roughness: 0.4, metalness: 0.4 });
    const b = buildBruteParts({ paint: paintSlot, dark: shared('dark'), glass: shared('glass'), chrome: shared('chrome'), hub, head: shared('light') });
    root.add(b.group);
    for (const c of b.cleats) {
      skip.add(c.mesh);
      cleats.push({ x: c.mesh.position.x * PM_SCALE, y: c.mesh.position.y * PM_SCALE, top: c.top, i: c.i });
    }
    cleatSpan = b.cleatSpan;
    if (b.cleats.length) {
      cleatGeo = b.cleats[0].mesh.geometry.clone().scale(PM_SCALE, PM_SCALE, PM_SCALE);
      cleatMat = b.cleats[0].mesh.material as THREE.Material;
    }
    beacon = [0, (2.2 + 0.06) * PM_SCALE + 0.08, 0.75 * PM_SCALE + PM_Z];
  }
  root.updateMatrixWorld(true);
  // Merge every static mesh per material, baked into rival-local space.
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || skip.has(o)) return;
    const mat = o.material as THREE.Material;
    let a = byMat.get(mat);
    if (!a) byMat.set(mat, (a = []));
    a.push((o.geometry as THREE.BufferGeometry).clone().applyMatrix4(o.matrixWorld));
  });
  const parts: PlowTemplate['parts'] = [];
  let height = 1.5;
  for (const [mat, list] of byMat) {
    const g = mergeGeometries(list)!;
    for (const x of list) x.dispose();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    height = Math.max(height, g.boundingBox!.max.y);
    const slot: Slot | null = mat === paintSlot ? 'paint' : mat === coilSlot ? 'coil' : null;
    const shadow = !(mat instanceof THREE.MeshBasicMaterial) && !mat.transparent;
    parts.push({ geo: g, slot, mat, shadow });
  }
  // The rival blade (same dimensions as every other rival, so hitboxes / ball placement stay consistent).
  const blade: KindTemplate['parts'] = [];
  addBlade(blade, kind === 'volt' ? 0.5 : 0.6, kind === 'volt' ? 1.1 : 1.2);
  const bladeBy = new Map<MatKey, THREE.BufferGeometry[]>();
  for (const p of blade) {
    let a = bladeBy.get(p.key);
    if (!a) bladeBy.set(p.key, (a = []));
    a.push(p.geo);
  }
  for (const [key, list] of bladeBy) {
    const g = mergeGeometries(list)!;
    for (const x of list) x.dispose();
    g.computeBoundingSphere();
    parts.push({ geo: g, slot: key === 'blade' ? 'blade' : null, mat: shared(key), shadow: true });
  }
  // Every static look without a per-rival slot goes onto the palettes.
  const statics: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial }[] = [];
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.slot === null && p.shadow && paletteEligible(p.mat, { side: THREE.FrontSide, flatShading: (p.mat as THREE.MeshStandardMaterial).flatShading })) {
      statics.unshift({ geo: p.geo, mat: p.mat as THREE.MeshStandardMaterial });
      parts.splice(i, 1);
    }
  }
  for (const p of paletteParts(statics)) parts.push({ geo: p.geo, slot: null, mat: p.mat, shadow: true });
  const wheels: WheelSpec[] =
    kind === 'volt'
      ? PLOW_WHEEL_POS.map(([x, z]) => ({ x: x * PM_SCALE, y: PLOW_WHEEL_R * PM_SCALE, z: z * PM_SCALE + PM_Z, r: PLOW_WHEEL_R * PM_SCALE, w: 0.42 * PM_SCALE }))
      : [];
  const coilTops = coilTopObjs.map((o) => o.getWorldPosition(new THREE.Vector3()));
  return { parts, wheels, height, beacon, coilTops, cleats, cleatSpan, cleatGeo, cleatMat };
}

function plowTemplate(kind: 'volt' | 'brute'): PlowTemplate {
  let t = PLOW_TEMPLATES.get(kind);
  if (!t) PLOW_TEMPLATES.set(kind, (t = buildPlowTemplate(kind)));
  return t;
}

const _cm = new THREE.Matrix4();

let beaconGeo: THREE.BufferGeometry | null = null;
let tornadoGeo: THREE.BufferGeometry | null = null;
let tornadoMat: THREE.MeshBasicMaterial | null = null;
let glowGeo: THREE.BufferGeometry | null = null;

export interface RivalRig {
  root: THREE.Group;
  /** Holds the vehicle; rotated for whirl spins / tilts. */
  body: THREE.Group;
  /** Roll every wheel to `spin` (m travelled; each wheel turns spin / r about its axle). */
  setWheelSpin(spin: number): void;
  tornado: THREE.Mesh;
  /** Ground glow under the rival (slam wind-up / bounty). */
  glow: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  paint: THREE.MeshStandardMaterial;
  blade: THREE.MeshStandardMaterial;
  beacon: THREE.MeshStandardMaterial;
  height: number;
  /** Which starter-plow body this rig wears. */
  plow: PlowKind;
  /** VOLT-9 body: Tesla coil tops (arc endpoints) + the rig's own coil material (pulsed per rival). */
  coilTops: THREE.Object3D[];
  coilMat: THREE.MeshStandardMaterial | null;
  /** BRUTUS body: move the track cleats to `phase` (m travelled). No-op on other bodies. */
  setTrackPhase(phase: number): void;
  dispose(): void;
}

/** A rival vehicle. `plow` 'volt' / 'brute' wear the matching starter-plow silhouette instead of the `kind`
 *  vehicle body; every body keeps the rival's own paint color. */
export function createRivalRig(kind: RivalKind, color: string, plow: PlowKind = 'classic'): RivalRig {
  // Rivals never roll ISOTOPE (player-only plow).
  const pt = plow === 'classic' || plow === 'isotope' ? null : plowTemplate(plow);
  const t = pt ?? template(kind);
  const col = new THREE.Color(color);
  const paint = new THREE.MeshStandardMaterial({ color: col, roughness: 0.42, metalness: 0.2, flatShading: true });
  const bladeCol = col.clone().lerp(new THREE.Color(0xffffff), 0.12).multiplyScalar(0.85);
  const blade = new THREE.MeshStandardMaterial({ color: bladeCol, roughness: 0.35, metalness: 0.4, flatShading: true });
  const beacon = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2, roughness: 0.3 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const coilTops: THREE.Object3D[] = [];
  let coilMat: THREE.MeshStandardMaterial | null = null;
  let cleatMesh: THREE.InstancedMesh | null = null;
  const parts: THREE.Mesh[] = [];
  if (pt) {
    if (plow === 'volt') coilMat = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x2fb8ff, emissiveIntensity: 1.5, roughness: 0.3, metalness: 0.4 });
    for (const p of pt.parts) {
      const m = p.slot === 'paint' ? paint : p.slot === 'blade' ? blade : p.slot === 'coil' ? coilMat! : p.mat;
      const mesh = new THREE.Mesh(p.geo, m);
      mesh.castShadow = p.shadow;
      body.add(mesh);
      parts.push(mesh);
    }
    for (const v of pt.coilTops) {
      const o = new THREE.Object3D();
      o.position.copy(v);
      body.add(o);
      coilTops.push(o);
    }
    if (pt.cleatGeo && pt.cleatMat && pt.cleats.length) {
      cleatMesh = new THREE.InstancedMesh(pt.cleatGeo, pt.cleatMat, pt.cleats.length);
      cleatMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      cleatMesh.frustumCulled = false;
      body.add(cleatMesh);
    }
  } else {
    for (const p of (t as KindTemplate).parts) {
      const m = p.mat ?? (p.key === 'paint' ? paint : p.key === 'blade' ? blade : shared(p.key));
      const mesh = new THREE.Mesh(p.geo, m);
      mesh.castShadow = true;
      body.add(mesh);
      parts.push(mesh);
    }
  }
  // The body parts only move with the body, so their shadow is one depth draw (the per-material meshes stop
  // casting; the proxy geometry is shared by every rig of this template). Wheels and the ball cast themselves.
  if (!t.shadow) t.shadow = makeShadowProxy(parts, body);
  else for (const m of parts) m.castShadow = false;
  for (const sp of t.shadow) body.add(sp.clone());
  const setTrackPhase = (phase: number) => {
    if (!cleatMesh || !pt) return;
    for (let i = 0; i < pt.cleats.length; i++) {
      const c = pt.cleats[i];
      _cm.makeTranslation(c.x, c.y, cleatZ(c.i, c.top, phase / PM_SCALE, pt.cleatSpan) * PM_SCALE + PM_Z);
      cleatMesh.setMatrixAt(i, _cm);
    }
    cleatMesh.instanceMatrix.needsUpdate = true;
  };
  setTrackPhase(0);
  // Wheels: one InstancedMesh per wheel size, rolled by setWheelSpin.
  const wheelSets: { mesh: THREE.InstancedMesh; specs: WheelSpec[] }[] = [];
  for (const w of t.wheels) {
    let set = wheelSets.find((ws) => ws.specs[0].r === w.r && ws.specs[0].w === w.w);
    if (!set) wheelSets.push((set = { mesh: null!, specs: [] }));
    set.specs.push(w);
  }
  for (const ws of wheelSets) {
    ws.mesh = new THREE.InstancedMesh(wheelGeo(ws.specs[0].r, ws.specs[0].w), palette('wheel', true).material, ws.specs.length);
    ws.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    ws.mesh.castShadow = true;
    ws.mesh.customDepthMaterial = instancedDepthMaterial();
    body.add(ws.mesh);
  }
  const setWheelSpin = (spin: number) => {
    for (const ws of wheelSets) {
      for (let i = 0; i < ws.specs.length; i++) {
        const w = ws.specs[i];
        _e.set(spin / w.r, 0, 0);
        _q.setFromEuler(_e);
        _p.set(w.x, w.y, w.z);
        ws.mesh.setMatrixAt(i, _cm.compose(_p, _q, _s));
      }
      ws.mesh.instanceMatrix.needsUpdate = true;
    }
  };
  setWheelSpin(0);
  // Each wheel only turns about its own centre, so the instance bounds never change.
  for (const ws of wheelSets) ws.mesh.computeBoundingSphere();
  if (!beaconGeo) beaconGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.2, 10);
  const bm = new THREE.Mesh(beaconGeo, beacon);
  bm.position.set(t.beacon[0], t.beacon[1], t.beacon[2]);
  body.add(bm);

  if (!tornadoGeo) {
    tornadoGeo = new THREE.CylinderGeometry(4.2, 1.4, 3.4, 18, 3, true);
    tornadoGeo.translate(0, 1.7, 0);
    tornadoMat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, wireframe: true });
  }
  const tornado = new THREE.Mesh(tornadoGeo, tornadoMat!);
  tornado.visible = false;
  root.add(tornado);

  if (!glowGeo) {
    glowGeo = new THREE.CircleGeometry(2.4, 24);
    glowGeo.rotateX(-Math.PI / 2);
  }
  const glowMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.y = 0.06;
  glow.visible = false;
  root.add(glow);

  return {
    root,
    body,
    setWheelSpin,
    tornado,
    glow,
    glowMat,
    paint,
    blade,
    beacon,
    height: t.height,
    plow,
    coilTops,
    coilMat,
    setTrackPhase,
    dispose() {
      paint.dispose();
      blade.dispose();
      beacon.dispose();
      glowMat.dispose();
      coilMat?.dispose();
      cleatMesh?.dispose();
      for (const ws of wheelSets) ws.mesh.dispose();
    },
  };
}

/* ------------------------------------------------------------------ held snowballs */

let ballMat: THREE.MeshStandardMaterial | null = null;

/** Every rival's held snowball in one InstancedMesh (BrawlManager writes one root-space matrix per visible ball).
 *  Same look as the shared snowball, with its own material so the player's plain ball mesh never flips the
 *  shared material's program between instanced and plain. */
export function createRivalBalls(capacity: number): THREE.InstancedMesh {
  if (!ballMat) ballMat = getSnowballMaterial().clone();
  const balls = new THREE.InstancedMesh(getSnowballGeometry(), ballMat, capacity);
  balls.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  balls.castShadow = true;
  balls.customDepthMaterial = instancedDepthMaterial();
  balls.count = 0;
  balls.visible = false;
  return balls;
}

/* ------------------------------------------------------------------ debris + cocoa */

let debrisGeo: THREE.BufferGeometry | null = null;
export function getDebrisGeometry(): THREE.BufferGeometry {
  if (!debrisGeo) debrisGeo = new THREE.BoxGeometry(0.45, 0.3, 0.55);
  return debrisGeo;
}
let debrisDark: THREE.MeshStandardMaterial | null = null;
/** Dark-metal debris look (shared dark, as its own material: debris chunks are instanced). Shared — do not dispose. */
export function getDebrisDarkMaterial(): THREE.MeshStandardMaterial {
  if (!debrisDark) debrisDark = shared('dark').clone();
  return debrisDark;
}

let cocoaParts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] | null = null;
let cocoaHaloGeo: THREE.BufferGeometry | null = null;
let cocoaHaloMat: THREE.MeshBasicMaterial | null = null;
let cocoaShadow: ShadowProxy[] | null = null;

/** Glowing hot cocoa mug (heals). Shared geometry/materials. Returns { root, spin, halo }. */
export function createCocoa(): { root: THREE.Group; spin: THREE.Group; halo: THREE.Mesh } {
  if (!cocoaParts) {
    const mug = new THREE.MeshStandardMaterial({ color: 0xd8283a, roughness: 0.35, emissive: 0x801020, emissiveIntensity: 0.5 });
    const cocoa = new THREE.MeshStandardMaterial({ color: 0x5a3018, roughness: 0.6, emissive: 0x2a1006, emissiveIntensity: 0.4 });
    const cream = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, emissive: 0xffe8d0, emissiveIntensity: 0.35 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0xffffff, emissiveIntensity: 0.3 });
    const body = mergeGeometries([
      new THREE.CylinderGeometry(0.5, 0.44, 0.85, 16, 1, true).translate(0, 0.425, 0),
      new THREE.CylinderGeometry(0.44, 0.44, 0.05, 16).translate(0, 0.02, 0),
      new THREE.TorusGeometry(0.25, 0.08, 6, 12).translate(0.55, 0.45, 0),
    ])!;
    const band = new THREE.CylinderGeometry(0.505, 0.475, 0.12, 16, 1, true).translate(0, 0.55, 0);
    const top = new THREE.CylinderGeometry(0.46, 0.46, 0.04, 16).translate(0, 0.78, 0);
    const creamG = mergeGeometries([
      new THREE.SphereGeometry(0.3, 10, 6).scale(1, 0.55, 1).translate(0, 0.86, 0),
      new THREE.SphereGeometry(0.2, 8, 5).scale(1, 0.7, 1).translate(0.05, 1.0, 0),
      new THREE.ConeGeometry(0.09, 0.18, 6).translate(0.05, 1.18, 0),
    ])!;
    cocoaParts = [
      { geo: body, mat: mug },
      { geo: band, mat: stripe },
      { geo: top, mat: cocoa },
      { geo: creamG, mat: cream },
    ];
    cocoaHaloGeo = new THREE.RingGeometry(0.7, 1.4, 28);
    cocoaHaloGeo.rotateX(-Math.PI / 2);
    cocoaHaloMat = new THREE.MeshBasicMaterial({ color: 0xff9a40, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    // A flat ring: one pass draws exactly what the back + front passes would (no extra draw / program switch).
    cocoaHaloMat.forceSinglePass = true;
  }
  const root = new THREE.Group();
  const spin = new THREE.Group();
  root.add(spin);
  const parts: THREE.Mesh[] = [];
  for (const p of cocoaParts) {
    const m = new THREE.Mesh(p.geo, p.mat);
    m.castShadow = true;
    spin.add(m);
    parts.push(m);
  }
  // The mug parts cast as one depth-only proxy (geometry shared by every mug).
  if (!cocoaShadow) cocoaShadow = makeShadowProxy(parts, spin);
  else for (const m of parts) m.castShadow = false;
  for (const sp of cocoaShadow) spin.add(sp.clone());
  spin.scale.setScalar(1.3);
  const halo = new THREE.Mesh(cocoaHaloGeo!, cocoaHaloMat!);
  halo.position.y = 0.08;
  root.add(halo);
  return { root, spin, halo };
}
