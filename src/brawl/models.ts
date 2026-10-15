import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getSnowballGeometry, getSnowballMaterial } from '../entities/snowballMesh';

/* Procedural rival snowplow vehicles for Brawl mode. All face local +Z, ground at y = 0.
 * Static parts of each kind are merged per material ONCE (cached); instances share those geometries and
 * only own three materials (paint / blade / beacon) so each rival can be painted and flash. */

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

/* ------------------------------------------------------------------ geometry helpers */

const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

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
  parts: { geo: THREE.BufferGeometry; key: MatKey }[];
  wheels: WheelSpec[];
  /** Top of the vehicle (tags float above). */
  height: number;
  beacon: [number, number, number];
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
  g = mergeGeometries([tire, hub], true)!;
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
  for (const [key, list] of byKey) {
    const g = mergeGeometries(list)!;
    g.computeBoundingSphere();
    merged.push({ geo: g, key });
    for (const x of list) x.dispose();
  }
  return { parts: merged, wheels, height, beacon };
}

function template(kind: RivalKind): KindTemplate {
  let t = TEMPLATES.get(kind);
  if (!t) TEMPLATES.set(kind, (t = buildTemplate(kind)));
  return t;
}

let beaconGeo: THREE.BufferGeometry | null = null;
let tornadoGeo: THREE.BufferGeometry | null = null;
let tornadoMat: THREE.MeshBasicMaterial | null = null;
let glowGeo: THREE.BufferGeometry | null = null;

export interface RivalRig {
  root: THREE.Group;
  /** Holds the vehicle; rotated for whirl spins / tilts. */
  body: THREE.Group;
  wheels: THREE.Mesh[];
  wheelR: number[];
  ball: THREE.Mesh;
  tornado: THREE.Mesh;
  /** Ground glow under the rival (slam wind-up / bounty). */
  glow: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  paint: THREE.MeshStandardMaterial;
  blade: THREE.MeshStandardMaterial;
  beacon: THREE.MeshStandardMaterial;
  height: number;
  dispose(): void;
}

export function createRivalRig(kind: RivalKind, color: string): RivalRig {
  const t = template(kind);
  const col = new THREE.Color(color);
  const paint = new THREE.MeshStandardMaterial({ color: col, roughness: 0.42, metalness: 0.2, flatShading: true });
  const bladeCol = col.clone().lerp(new THREE.Color(0xffffff), 0.12).multiplyScalar(0.85);
  const blade = new THREE.MeshStandardMaterial({ color: bladeCol, roughness: 0.35, metalness: 0.4, flatShading: true });
  const beacon = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2, roughness: 0.3 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  for (const p of t.parts) {
    const m = p.key === 'paint' ? paint : p.key === 'blade' ? blade : shared(p.key);
    const mesh = new THREE.Mesh(p.geo, m);
    mesh.castShadow = true;
    body.add(mesh);
  }
  const wheels: THREE.Mesh[] = [];
  const wheelR: number[] = [];
  const wheelMats = [shared('black'), shared('steel')];
  for (const w of t.wheels) {
    const mesh = new THREE.Mesh(wheelGeo(w.r, w.w), wheelMats);
    mesh.position.set(w.x, w.y, w.z);
    mesh.castShadow = true;
    body.add(mesh);
    wheels.push(mesh);
    wheelR.push(w.r);
  }
  if (!beaconGeo) beaconGeo = new THREE.CylinderGeometry(0.13, 0.16, 0.2, 10);
  const bm = new THREE.Mesh(beaconGeo, beacon);
  bm.position.set(t.beacon[0], t.beacon[1], t.beacon[2]);
  body.add(bm);

  const ball = new THREE.Mesh(getSnowballGeometry(), getSnowballMaterial());
  ball.castShadow = true;
  ball.visible = false;
  root.add(ball);

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
    wheels,
    wheelR,
    ball,
    tornado,
    glow,
    glowMat,
    paint,
    blade,
    beacon,
    height: t.height,
    dispose() {
      paint.dispose();
      blade.dispose();
      beacon.dispose();
      glowMat.dispose();
    },
  };
}

/* ------------------------------------------------------------------ debris + cocoa */

let debrisGeo: THREE.BufferGeometry | null = null;
export function getDebrisGeometry(): THREE.BufferGeometry {
  if (!debrisGeo) debrisGeo = new THREE.BoxGeometry(0.45, 0.3, 0.55);
  return debrisGeo;
}
export function getDarkMaterial(): THREE.MeshStandardMaterial {
  return shared('dark');
}

let cocoaParts: { geo: THREE.BufferGeometry; mat: THREE.Material }[] | null = null;
let cocoaHaloGeo: THREE.BufferGeometry | null = null;
let cocoaHaloMat: THREE.MeshBasicMaterial | null = null;

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
  }
  const root = new THREE.Group();
  const spin = new THREE.Group();
  root.add(spin);
  for (const p of cocoaParts) {
    const m = new THREE.Mesh(p.geo, p.mat);
    m.castShadow = true;
    spin.add(m);
  }
  spin.scale.setScalar(1.3);
  const halo = new THREE.Mesh(cocoaHaloGeo!, cocoaHaloMat!);
  halo.position.y = 0.08;
  root.add(halo);
  return { root, spin, halo };
}
