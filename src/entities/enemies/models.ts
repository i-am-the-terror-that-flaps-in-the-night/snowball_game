import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ENEMIES, type EnemyType } from '../../config/enemies';
import { makeShadowProxy } from '../../render/shadowProxy';

/* Procedural toy-robot bot models. Every model faces local +Z, ground at y = 0.
 * Each type is built ONCE as a template (static parts merged per material, animated parts in their own
 * groups tagged with userData.role). Instances clone the template (shared geometry + materials) and only
 * clone the per-instance materials (paint / eye / glow / ball) so they can flash, tint and glow. */

type V3 = readonly [number, number, number];
const ONE: V3 = [1, 1, 1];
const ZERO: V3 = [0, 0, 0];
const PI = Math.PI;

export type InstRole = 'paint' | 'eye' | 'glow' | 'ball';

/* ------------------------------------------------------------------ materials */

const MATS = new Map<string, THREE.MeshStandardMaterial>();
function mat(key: string, color: number, o: THREE.MeshStandardMaterialParameters = {}, inst?: InstRole): THREE.MeshStandardMaterial {
  let m = MATS.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, flatShading: true, ...o });
    if (inst) m.userData.inst = inst;
    MATS.set(key, m);
  }
  return m;
}

let _hazardTex: THREE.Texture | null = null;
function hazardTexture(): THREE.Texture {
  if (_hazardTex) return _hazardTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffc400';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#16161a';
  for (let i = -2; i < 4; i++) {
    const x = i * 32;
    g.beginPath();
    g.moveTo(x, 64);
    g.lineTo(x + 16, 64);
    g.lineTo(x + 16 + 64, 0);
    g.lineTo(x + 64, 0);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _hazardTex = t;
  return t;
}

export const M = {
  rubber: () => mat('rubber', 0x1f2024, { roughness: 0.95 }),
  cleat: () => mat('cleat', 0x2c2e34, { roughness: 0.9 }),
  dark: () => mat('dark', 0x3a3e46, { roughness: 0.6, metalness: 0.25 }),
  steel: () => mat('steel', 0x9aa4b0, { roughness: 0.38, metalness: 0.45 }),
  chrome: () => mat('chrome', 0xe2e8ef, { roughness: 0.16, metalness: 0.6 }),
  black: () => mat('black', 0x131418, { roughness: 0.5 }),
  glass: () => mat('glass', 0x1c2c42, { roughness: 0.08, metalness: 0.3, emissive: 0x0d2240, emissiveIntensity: 0.7 }),
  bone: () => mat('bone', 0xf4ead2, { roughness: 0.45 }),
  white: () => mat('white', 0xf3f5f8, { roughness: 0.45 }),
  hazard: () => mat('hazard', 0xffffff, { map: hazardTexture(), roughness: 0.55, flatShading: false }),
  hazLight: () => mat('hazLight', 0xffa31a, { emissive: 0xff8a00, emissiveIntensity: 1.8 }),
  tankGlass: () => mat('tankGlass', 0xaeeeff, { transparent: true, opacity: 0.32, roughness: 0.05, depthWrite: false }),
  ice: () => mat('ice', 0xa8e2ff, { transparent: true, opacity: 0.55, roughness: 0.1, metalness: 0.1, emissive: 0x2a7ac0, emissiveIntensity: 0.35, depthWrite: false }),
  star: () => mat('star', 0xffe14a, { emissive: 0xffc400, emissiveIntensity: 1.6 }),
  rustDark: () => mat('rustDark', 0x5a2a16, { roughness: 0.8, metalness: 0.2 }),
};
const paint = (t: EnemyType) => mat('paint_' + t, ENEMIES[t].color, { roughness: 0.48, metalness: 0.15 }, 'paint');
const accent = (t: EnemyType) => mat('accent_' + t, ENEMIES[t].accent, { roughness: 0.48, metalness: 0.2 }, 'paint');
const eyeMat = (t: EnemyType, c: number, i = 2.2) => mat('eye_' + t, c, { emissive: c, emissiveIntensity: i, roughness: 0.3 }, 'eye');
const glowMat = (t: EnemyType, c: number, i = 0.25) => mat('glow_' + t, c, { emissive: c, emissiveIntensity: i, roughness: 0.4 }, 'glow');
const ballMat = () => mat('ball', 0xf6faff, { roughness: 0.85, emissive: 0x40e0ff, emissiveIntensity: 0.05 }, 'ball');

/** Shared material for debris chunks of a type (non-instanced). */
export function debrisMaterials(t: EnemyType): THREE.Material[] {
  return [paint(t), paint(t), accent(t), M.dark(), M.steel(), M.rubber()];
}

/* ------------------------------------------------------------------ geometry */

const GEOS = new Map<string, THREE.BufferGeometry>();
function geo(key: string, f: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = GEOS.get(key);
  if (!g) {
    g = f();
    if (g.index) g = g.toNonIndexed();
    GEOS.set(key, g);
  }
  return g;
}
export const G = {
  box: () => geo('box', () => new THREE.BoxGeometry(1, 1, 1)),
  cyl: (n = 12) => geo('cyl' + n, () => new THREE.CylinderGeometry(1, 1, 1, n)),
  taper: (top: number, n = 12) => geo('taper' + top + '_' + n, () => new THREE.CylinderGeometry(top, 1, 1, n)),
  sph: (d = 1) => geo('ico' + d, () => new THREE.IcosahedronGeometry(1, d)),
  hemi: () => geo('hemi', () => new THREE.SphereGeometry(1, 14, 7, 0, PI * 2, 0, PI / 2)),
  cone: (n = 8) => geo('cone' + n, () => new THREE.ConeGeometry(1, 1, n)),
  torus: () => geo('torus', () => new THREE.TorusGeometry(1, 0.18, 6, 18)),
  oct: () => geo('oct', () => new THREE.OctahedronGeometry(1, 0)),
  /** Box whose top-front edge is pulled back: a sloped wedge nose (front = +Z). */
  wedge: (k = 0.45) =>
    geo('wedge' + k, () => {
      const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 0 && p.getZ(i) > 0) p.setZ(i, 0.5 - k * 2);
      g.computeVertexNormals();
      return g;
    }),
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Collects static parts per material and merges them into one mesh per material on flush(). */
class Part {
  private lists = new Map<THREE.Material, THREE.BufferGeometry[]>();
  constructor(public group: THREE.Object3D) {}
  add(g: THREE.BufferGeometry, m: THREE.Material, p: V3, s: V3 = ONE, r: V3 = ZERO, uv?: readonly [number, number]): this {
    _e.set(r[0], r[1], r[2]);
    _q.setFromEuler(_e);
    _m.compose(_p.set(p[0], p[1], p[2]), _q, _s.set(s[0], s[1], s[2]));
    const c = g.clone();
    c.applyMatrix4(_m);
    if (uv) {
      const a = c.getAttribute('uv');
      for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * uv[0], a.getY(i) * uv[1]);
    }
    let l = this.lists.get(m);
    if (!l) this.lists.set(m, (l = []));
    l.push(c);
    return this;
  }
  flush(shadow = true): void {
    for (const [m, l] of this.lists) {
      const merged = l.length === 1 ? l[0] : mergeGeometries(l, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = shadow;
      this.group.add(mesh);
    }
    this.lists.clear();
  }
}

function sub(parent: THREE.Object3D, role: string, p: V3, data?: Record<string, number>): { g: THREE.Group; b: Part } {
  const g = new THREE.Group();
  g.position.set(p[0], p[1], p[2]);
  g.userData.role = role;
  if (data) Object.assign(g.userData, data);
  parent.add(g);
  return { g, b: new Part(g) };
}

/** Collects a template's wheels; flush() emits one InstancedMesh per wheel part (tire, hub, cross bars) for every
 *  wheel size / material set, so a bot draws its 4-12 wheels in 3 calls. The parts of a set share one instance
 *  matrix buffer: rest position (plus an exact half-turn about Y for left wheels, so their hub faces out without
 *  mirroring) and the axle spin written by rollWheels(). */
class Wheels {
  private sets = new Map<string, { r: number; w: number; hub: THREE.Material; tire: THREE.Material; spots: number[] }>();
  add(x: number, y: number, z: number, r: number, w: number, hub: THREE.Material, tire = M.rubber()): void {
    const key = `${r}|${w}|${hub.uuid}|${tire.uuid}`;
    let s = this.sets.get(key);
    if (!s) this.sets.set(key, (s = { r, w, hub, tire, spots: [] }));
    s.spots.push(x, y, z, x >= 0 ? 1 : -1);
  }
  flush(root: THREE.Object3D): void {
    for (const { r, w, hub, tire, spots } of this.sets.values()) {
      // one right-hand (+X) wheel at its axle origin, merged per material like any static Part
      const proto = new THREE.Group();
      const b = new Part(proto);
      b.add(G.cyl(14), tire, [0, 0, 0], [r, w, r], [0, 0, PI / 2]);
      b.add(G.cyl(10), hub, [w * 0.5, 0, 0], [r * 0.58, 0.05, r * 0.58], [0, 0, PI / 2]);
      b.add(G.box(), M.black(), [w * 0.5 + 0.03, 0, 0], [0.05, r * 1.15, r * 0.2]);
      b.add(G.box(), M.black(), [w * 0.5 + 0.03, 0, 0], [0.05, r * 0.2, r * 1.15]);
      b.flush();
      const n = spots.length / 4;
      const set = new THREE.Group();
      set.userData.role = 'wheels';
      set.userData.r = r;
      set.userData.spots = spots;
      const matrix = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16);
      matrix.setUsage(THREE.DynamicDrawUsage);
      writeWheels(matrix, spots, 0);
      // spinning about the axle keeps every point within `reach` of its wheel's origin, so the sphere never changes
      let reach = 0;
      for (const c of proto.children) {
        const g = (c as THREE.Mesh).geometry;
        g.computeBoundingSphere();
        reach = Math.max(reach, g.boundingSphere!.center.length() + g.boundingSphere!.radius);
      }
      const box = new THREE.Box3();
      for (let i = 0; i < n; i++) box.expandByPoint(_p.set(spots[i * 4], spots[i * 4 + 1], spots[i * 4 + 2]));
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      sphere.radius += reach;
      // the three parts cast through one depth-only proxy that spins with them (same instance buffer)
      const proxies = makeShadowProxy(proto, proto);
      for (const src of [...(proto.children as THREE.Mesh[]), ...proxies]) {
        const im = new THREE.InstancedMesh(src.geometry, src.material, n);
        im.name = src.name;
        im.instanceMatrix = matrix;
        im.castShadow = src.castShadow;
        im.boundingSphere = sphere.clone();
        set.add(im);
      }
      root.add(set);
    }
    this.sets.clear();
  }
}

/** Instance matrices of a wheel set spun to `angle` (the same compose as a wheel group with rotation.x = angle). */
function writeWheels(attr: THREE.InstancedBufferAttribute, spots: readonly number[], angle: number): void {
  _q.setFromEuler(_e.set(angle, 0, 0));
  const a = attr.array as Float32Array;
  for (let i = 0, n = spots.length / 4; i < n; i++) {
    _m.compose(_p.set(spots[i * 4], spots[i * 4 + 1], spots[i * 4 + 2]), _q, _s.set(1, 1, 1));
    if (spots[i * 4 + 3] < 0) {
      // half-turn about Y: negate the X and Z basis columns
      const e = _m.elements;
      e[0] = -e[0];
      e[1] = -e[1];
      e[2] = -e[2];
      e[8] = -e[8];
      e[9] = -e[9];
      e[10] = -e[10];
    }
    _m.toArray(a, i * 16);
  }
  attr.needsUpdate = true;
}

/** Two tank treads (static belts + cleats) with rolling road wheels on their outer faces. */
function treads(base: Part, wheels: Wheels, x: number, len: number, h: number, w: number, nWheels: number, hub: THREE.Material): void {
  for (const sx of [-1, 1]) {
    base.add(G.box(), M.rubber(), [sx * x, h / 2, 0], [w, h, len]);
    base.add(G.cyl(10), M.rubber(), [sx * x, h / 2, len / 2], [h / 2, w, h / 2], [0, 0, PI / 2]);
    base.add(G.cyl(10), M.rubber(), [sx * x, h / 2, -len / 2], [h / 2, w, h / 2], [0, 0, PI / 2]);
    const n = Math.max(3, Math.round(len / 0.34));
    for (let i = 0; i < n; i++) base.add(G.box(), M.cleat(), [sx * x, h + 0.03, -len / 2 + ((i + 0.5) * len) / n], [w * 1.04, 0.07, (len / n) * 0.45]);
    const wr = h * 0.34;
    for (let j = 0; j < nWheels; j++) {
      const z = -len / 2 + h * 0.3 + ((len - h * 0.6) * (j + 0.5)) / nWheels;
      wheels.add(sx * (x + w / 2 + 0.05), h * 0.48, z, wr, 0.1, hub, M.steel());
    }
  }
}

function stack(b: Part, stacks: number[], x: number, y0: number, z: number, r: number, h: number, body: THREE.Material, cap: THREE.Material): void {
  b.add(G.cyl(10), body, [x, y0 + h / 2, z], [r, h, r]);
  b.add(G.cyl(10), cap, [x, y0 + h + 0.06, z], [r * 1.3, 0.14, r * 1.3]);
  b.add(G.cyl(10), M.black(), [x, y0 + h + 0.135, z], [r * 0.8, 0.02, r * 0.8]);
  stacks.push(x, y0 + h + 0.2, z);
}

/* ------------------------------------------------------------------ templates */

interface Tpl {
  root: THREE.Group;
  height: number;
  stacks: number[];
  /** Local Z of the blade front (where Frostbyte's ball sits / thief nozzle). */
  front: number;
}

function scrapper(): Tpl {
  const t: EnemyType = 'scrapper';
  const root = new THREE.Group();
  const base = new Part(root);
  const stacks: number[] = [];
  const wheels = new Wheels();
  treads(base, wheels, 0.56, 1.45, 0.42, 0.34, 3, accent(t));
  wheels.flush(root);
  const { b } = sub(root, 'body', [0, 0, 0]);
  b.add(G.wedge(0.42), paint(t), [0, 0.66, -0.05], [0.86, 0.5, 1.35]);
  b.add(G.box(), M.dark(), [0, 0.42, -0.05], [0.8, 0.12, 1.3]);
  // red ram nose with steel spikes
  b.add(G.wedge(0.5), accent(t), [0, 0.42, 0.72], [0.98, 0.26, 0.34]);
  for (const x of [-0.28, 0, 0.28]) b.add(G.cone(6), M.chrome(), [x, 0.43, 0.98], [0.07, 0.26, 0.07], [PI / 2, 0, 0]);
  // hazard cheeks
  for (const sx of [-1, 1]) b.add(G.box(), M.hazard(), [sx * 0.44, 0.66, -0.2], [0.03, 0.24, 0.7], ZERO, [2, 0.6]);
  // single eye turret
  b.add(G.cyl(10), paint(t), [0, 0.97, -0.22], [0.3, 0.22, 0.3]);
  b.add(G.cyl(12), M.black(), [0, 0.98, 0.04], [0.19, 0.12, 0.19], [PI / 2, 0, 0]);
  b.add(G.sph(1), eyeMat(t, 0xff3b30), [0, 0.98, 0.1], [0.13, 0.13, 0.08]);
  b.add(G.box(), M.black(), [0, 1.12, 0.02], [0.36, 0.06, 0.12], [0.25, 0, 0]);
  // antenna + exhaust
  b.add(G.cyl(6), M.black(), [0.26, 1.2, -0.5], [0.02, 0.5, 0.02]);
  b.add(G.sph(0), eyeMat(t, 0xff3b30), [0.26, 1.46, -0.5], [0.05, 0.05, 0.05]);
  stack(b, stacks, -0.24, 0.85, -0.55, 0.06, 0.24, M.steel(), M.dark());
  b.flush();
  base.flush();
  return { root, height: 1.4, stacks, front: 0.95 };
}

function brute(): Tpl {
  const t: EnemyType = 'brute';
  const root = new THREE.Group();
  const base = new Part(root);
  const stacks: number[] = [];
  const wheels = new Wheels();
  treads(base, wheels, 0.98, 2.4, 0.72, 0.52, 4, accent(t));
  wheels.flush(root);
  const { b } = sub(root, 'body', [0, 0, 0]);
  b.add(G.box(), paint(t), [0, 1.05, -0.25], [1.5, 0.75, 1.9]);
  b.add(G.wedge(0.3), paint(t), [0, 1.52, 0.25], [1.36, 0.36, 0.95]);
  b.add(G.box(), M.dark(), [0, 0.7, -0.25], [1.4, 0.14, 2.0]);
  // cab with yellow slit eyes
  b.add(G.box(), paint(t), [0, 1.95, -0.75], [1.2, 0.85, 0.95]);
  b.add(G.box(), M.black(), [0, 2.42, -0.75], [1.3, 0.1, 1.05]);
  b.add(G.box(), M.glass(), [0, 2.0, -0.27], [1.0, 0.42, 0.04]);
  for (const sx of [-1, 1]) b.add(G.box(), eyeMat(t, 0xffc400), [sx * 0.27, 1.98, -0.24], [0.3, 0.1, 0.04], [0, 0, sx * -0.18]);
  b.add(G.box(), M.black(), [0, 2.18, -0.24], [1.05, 0.09, 0.08]);
  for (const sx of [-1, 1]) b.add(G.box(), M.hazard(), [sx * 0.76, 1.05, -0.25], [0.03, 0.34, 1.7], ZERO, [4, 0.7]);
  // the big FRONT PLATE
  b.add(G.box(), M.steel(), [0, 0.95, 1.45], [2.8, 1.25, 0.2], [-0.14, 0, 0]);
  for (const sx of [-1, 1]) b.add(G.box(), M.steel(), [sx * 1.5, 0.95, 1.3], [0.4, 1.25, 0.18], [-0.14, sx * -0.55, 0]);
  b.add(G.box(), M.dark(), [0, 1.62, 1.35], [3.0, 0.16, 0.34]);
  b.add(G.box(), M.hazard(), [0, 1.18, 1.57], [2.5, 0.32, 0.03], [-0.14, 0, 0], [5, 0.65]);
  b.add(G.box(), glowMat(t, 0xffc400, 0.15), [0, 0.36, 1.56], [2.85, 0.13, 0.2]);
  for (const x of [-0.9, 0, 0.9]) b.add(G.sph(0), M.chrome(), [x, 0.8, 1.56], [0.08, 0.08, 0.05]);
  // push arms + pistons
  for (const sx of [-1, 1]) {
    b.add(G.box(), M.black(), [sx * 0.62, 0.85, 0.85], [0.16, 0.16, 1.1]);
    b.add(G.cyl(8), M.chrome(), [sx * 0.42, 1.25, 0.95], [0.06, 0.9, 0.06], [PI / 2 - 0.5, 0, 0]);
  }
  stack(b, stacks, 0.5, 2.1, -1.0, 0.09, 0.7, M.chrome(), M.dark());
  b.flush();
  base.flush();
  return { root, height: 2.6, stacks, front: 1.6 };
}

function spinner(): Tpl {
  const t: EnemyType = 'spinner';
  const root = new THREE.Group();
  const stacks: number[] = [];
  const { g: body, b } = sub(root, 'body', [0, 0, 0]);
  b.add(G.cyl(16), M.dark(), [0, 0.26, 0], [0.92, 0.32, 0.92]);
  b.add(G.cyl(16), M.black(), [0, 0.08, 0], [0.7, 0.12, 0.7]);
  b.add(G.hemi(), paint(t), [0, 0.62, 0], [0.84, 0.72, 0.84]);
  b.add(G.cyl(18), M.black(), [0, 0.66, 0], [0.87, 0.08, 0.87]);
  b.add(G.box(), M.black(), [0, 1.0, 0.56], [0.72, 0.24, 0.24], [-0.6, 0, 0]);
  for (const sx of [-1, 1]) b.add(G.sph(1), eyeMat(t, 0xff8a00), [sx * 0.17, 1.03, 0.64], [0.09, 0.09, 0.06]);
  b.add(G.cyl(8), M.steel(), [0, 1.42, 0], [0.12, 0.12, 0.12]);
  b.add(G.sph(1), glowMat(t, 0xff3b1a, 0.2), [0, 1.52, 0], [0.16, 0.16, 0.16]);
  for (const sx of [-1, 1]) b.add(G.box(), M.hazard(), [sx * 0.6, 0.86, -0.3], [0.04, 0.16, 0.5], [0, sx * 0.5, 0], [1.5, 0.5]);
  b.flush();
  // two counter-rotating saw rings
  const saw = (y: number, r: number, dir: number) => {
    const { b: s } = sub(body, 'spinY', [0, y, 0], { dir });
    s.add(G.cyl(20), accent(t), [0, 0, 0], [r, 0.07, r]);
    s.add(G.cyl(12), M.dark(), [0, 0.02, 0], [r * 0.6, 0.08, r * 0.6]);
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI * 2;
      s.add(G.wedge(0.5), M.chrome(), [Math.sin(a) * (r + 0.06), 0, Math.cos(a) * (r + 0.06)], [0.06, 0.07, 0.24], [0, a + PI / 2, 0]);
    }
    for (let i = 0; i < 3; i++) s.add(G.box(), M.black(), [0, 0.045, 0], [r * 1.5, 0.02, 0.07], [0, (i / 3) * PI, 0]);
    s.flush();
  };
  saw(0.48, 1.1, 1);
  saw(0.82, 0.78, -1);
  return { root, height: 1.75, stacks, front: 1.1 };
}

function thief(): Tpl {
  const t: EnemyType = 'thief';
  const root = new THREE.Group();
  const stacks: number[] = [];
  const { g: body, b } = sub(root, 'body', [0, 0, 0]);
  b.add(G.sph(1), paint(t), [0, 0.62, -0.05], [0.58, 0.36, 0.72]);
  b.add(G.cyl(14), M.dark(), [0, 0.38, -0.05], [0.56, 0.12, 0.62]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.add(G.cyl(10), M.black(), [sx * 0.42, 0.28, sz * 0.36], [0.2, 0.08, 0.2]);
    b.add(G.cyl(10), glowMat(t, 0x40e0ff, 1.2), [sx * 0.42, 0.23, sz * 0.36], [0.15, 0.03, 0.15]);
  }
  // bandit mask + eyes
  b.add(G.box(), M.black(), [0, 0.74, 0.42], [0.78, 0.18, 0.32], [-0.3, 0, 0]);
  for (const sx of [-1, 1]) b.add(G.box(), eyeMat(t, 0x40e0ff, 2.6), [sx * 0.17, 0.76, 0.6], [0.16, 0.07, 0.04], [-0.3, 0, sx * 0.25]);
  // vacuum nozzle
  b.add(G.cyl(10), M.steel(), [0, 0.46, 0.78], [0.11, 0.45, 0.11], [PI / 2, 0, 0]);
  b.add(G.taper(0.45, 10), M.dark(), [0, 0.46, 1.05], [0.24, 0.22, 0.24], [-PI / 2, 0, 0]);
  b.add(G.cyl(10), glowMat(t, 0x40e0ff, 1.2), [0, 0.46, 1.16], [0.2, 0.02, 0.2], [PI / 2, 0, 0]);
  // fins
  for (const sx of [-1, 1]) b.add(G.wedge(0.4), accent(t), [sx * 0.5, 0.8, -0.45], [0.05, 0.32, 0.45], [0, 0, sx * -0.4]);
  // snow tank (glass) on the back
  b.add(G.sph(2), M.tankGlass(), [0, 0.98, -0.42], [0.34, 0.34, 0.34]);
  b.add(G.cyl(12), M.dark(), [0, 0.72, -0.42], [0.26, 0.08, 0.26]);
  b.flush();
  const { b: tank } = sub(body, 'tank', [0, 0.95, -0.42]);
  tank.add(G.sph(2), ballMat(), [0, 0, 0], [1, 1, 1]);
  tank.flush(false);
  return { root, height: 1.35, stacks, front: 1.15 };
}

function bulldoza(): Tpl {
  const t: EnemyType = 'bulldoza';
  const root = new THREE.Group();
  const base = new Part(root);
  const stacks: number[] = [];
  const wheels = new Wheels();
  treads(base, wheels, 1.6, 3.7, 1.05, 0.85, 5, M.hazLight());
  wheels.flush(root);
  const { b } = sub(root, 'body', [0, 0, 0]);
  const P = paint(t);
  b.add(G.box(), P, [0, 1.55, -0.35], [2.4, 1.2, 3.1]);
  b.add(G.box(), M.black(), [0, 1.02, -0.35], [2.3, 0.16, 3.2]);
  b.add(G.wedge(0.32), P, [0, 2.38, 0.45], [2.2, 0.52, 1.55]);
  for (const sx of [-1, 1]) b.add(G.box(), M.hazard(), [sx * 1.21, 1.6, -0.35], [0.03, 0.55, 2.8], ZERO, [6, 1]);
  // cab
  b.add(G.box(), P, [0, 3.0, -1.05], [1.9, 1.3, 1.5]);
  b.add(G.box(), M.black(), [0, 3.72, -1.05], [2.1, 0.14, 1.7]);
  b.add(G.box(), M.glass(), [0, 3.1, -0.29], [1.6, 0.6, 0.04]);
  for (const sx of [-1, 1]) b.add(G.box(), M.glass(), [sx * 0.96, 3.1, -1.05], [0.04, 0.6, 1.1]);
  b.add(G.cyl(10), M.hazLight(), [0, 3.88, -1.05], [0.18, 0.18, 0.18]);
  // angry headlights + brows
  for (const sx of [-1, 1]) {
    b.add(G.cyl(12), M.black(), [sx * 0.72, 2.12, 1.24], [0.27, 0.12, 0.27], [PI / 2, 0, 0]);
    b.add(G.cyl(12), eyeMat(t, 0xff2a1a), [sx * 0.72, 2.12, 1.3], [0.2, 0.06, 0.2], [PI / 2, 0, 0]);
    b.add(G.box(), M.black(), [sx * 0.72, 2.42, 1.26], [0.62, 0.13, 0.16], [0, 0, sx * 0.35]);
  }
  // grille
  b.add(G.box(), M.black(), [0, 1.55, 1.22], [1.3, 0.8, 0.06]);
  for (let i = 0; i < 5; i++) b.add(G.box(), M.chrome(), [-0.5 + i * 0.25, 1.55, 1.26], [0.06, 0.7, 0.04]);
  // BLADE: curved hazard dozer blade with horns
  b.add(G.box(), M.steel(), [0, 1.2, 2.35], [2.9, 1.95, 0.26], [-0.12, 0, 0]);
  for (const sx of [-1, 1]) b.add(G.box(), M.steel(), [sx * 1.95, 1.2, 2.08], [1.15, 1.95, 0.26], [-0.12, sx * -0.45, 0]);
  b.add(G.box(), M.hazard(), [0, 2.0, 2.45], [2.9, 0.42, 0.03], [-0.12, 0, 0], [6, 0.8]);
  for (const sx of [-1, 1]) b.add(G.box(), M.hazard(), [sx * 1.95, 2.0, 2.2], [1.1, 0.42, 0.03], [-0.12, sx * -0.45, 0], [2.3, 0.8]);
  b.add(G.box(), M.black(), [0, 2.24, 2.28], [4.6, 0.14, 0.4]);
  b.add(G.box(), glowMat(t, 0xff3b1a, 0.12), [0, 0.3, 2.47], [2.9, 0.12, 0.22]);
  for (const sx of [-1, 1]) b.add(G.box(), glowMat(t, 0xff3b1a, 0.12), [sx * 1.95, 0.3, 2.2], [1.1, 0.12, 0.22], [0, sx * -0.45, 0]);
  for (const sx of [-1, 1]) {
    b.add(G.cone(8), M.bone(), [sx * 2.35, 2.75, 2.0], [0.3, 1.2, 0.3], [0.35, 0, sx * -0.5]);
    b.add(G.cyl(8), M.black(), [sx * 2.15, 2.3, 2.05], [0.34, 0.2, 0.34]);
  }
  for (const sx of [-1, 1]) {
    b.add(G.box(), M.black(), [sx * 1.0, 1.15, 1.45], [0.26, 0.26, 1.6]);
    b.add(G.cyl(8), M.chrome(), [sx * 0.7, 1.75, 1.45], [0.08, 1.3, 0.08], [PI / 2 - 0.55, 0, 0]);
  }
  // smokestacks
  for (const sx of [-1, 1]) stack(b, stacks, sx * 0.62, 3.2, -1.95, 0.17, 1.35, M.chrome(), M.black());
  b.flush();
  base.flush();
  return { root, height: 4.9, stacks, front: 2.5 };
}

function frostbyte(): Tpl {
  const t: EnemyType = 'frostbyte';
  const root = new THREE.Group();
  const stacks: number[] = [];
  const P = paint(t);
  const wheels = new Wheels();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheels.add(sx * 1.15, 0.56, sz * 1.0 - 0.2, 0.56, 0.46, accent(t));
  wheels.flush(root);
  const { b } = sub(root, 'body', [0, 0, 0]);
  b.add(G.box(), P, [0, 1.05, -0.2], [1.75, 0.7, 3.0]);
  b.add(G.box(), M.dark(), [0, 0.7, -0.2], [1.6, 0.16, 2.9]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(G.box(), P, [sx * 1.15, 1.2, sz * 1.0 - 0.2], [0.58, 0.14, 1.25]);
  // cab with the visor-face
  b.add(G.box(), P, [0, 2.0, -0.55], [1.7, 1.35, 1.55]);
  b.add(G.box(), M.black(), [0, 2.72, -0.55], [1.85, 0.1, 1.7]);
  b.add(G.box(), M.black(), [0, 2.08, 0.24], [1.55, 0.9, 0.06]);
  for (const sx of [-1, 1]) b.add(G.box(), eyeMat(t, 0x40e0ff, 2.8), [sx * 0.38, 2.2, 0.28], [0.46, 0.15, 0.04], [0, 0, sx * 0.22]);
  b.add(G.box(), eyeMat(t, 0x40e0ff, 2.8), [0, 1.86, 0.28], [0.75, 0.06, 0.04]);
  for (const x of [-0.25, 0, 0.25]) b.add(G.box(), eyeMat(t, 0x40e0ff, 2.8), [x, 1.8, 0.28], [0.05, 0.1, 0.04]);
  b.add(G.box(), accent(t), [0, 2.56, 0.24], [1.6, 0.06, 0.08]);
  b.add(G.box(), glowMat(t, 0x40e0ff, 0.9), [0, 2.82, -0.55], [1.2, 0.12, 0.25]);
  // glowing blade
  b.add(G.box(), M.steel(), [0, 0.95, 1.62], [3.5, 1.2, 0.22], [-0.2, 0, 0]);
  for (const sx of [-1, 1]) b.add(G.box(), M.steel(), [sx * 1.85, 0.95, 1.45], [0.3, 1.2, 0.22], [-0.2, sx * -0.6, 0]);
  b.add(G.box(), glowMat(t, 0x40e0ff, 0.9), [0, 0.32, 1.76], [3.5, 0.1, 0.2]);
  b.add(G.box(), glowMat(t, 0x40e0ff, 0.9), [0, 1.58, 1.52], [3.6, 0.08, 0.3]);
  b.add(G.box(), P, [0, 1.25, 1.75], [1.0, 0.3, 0.04], [-0.2, 0, 0]);
  for (const sx of [-1, 1]) b.add(G.box(), M.black(), [sx * 0.55, 0.95, 1.0], [0.16, 0.16, 0.9]);
  // antenna + dish
  b.add(G.cyl(6), M.black(), [-0.6, 3.1, -1.0], [0.025, 0.7, 0.025]);
  b.add(G.sph(0), eyeMat(t, 0x40e0ff, 2.8), [-0.6, 3.47, -1.0], [0.07, 0.07, 0.07]);
  b.add(G.hemi(), M.steel(), [0.5, 2.85, -1.0], [0.3, 0.12, 0.3], [-0.6, 0, 0]);
  for (const sx of [-1, 1]) stack(b, stacks, sx * 0.62, 1.4, -1.55, 0.09, 0.9, M.chrome(), M.black());
  b.flush();
  // its own snowball (repositioned/scaled every frame)
  const { b: ball } = sub(root, 'ball', [0, 0, 2.2]);
  ball.add(G.sph(2), ballMat(), [0, 0, 0], [1, 1, 1]);
  ball.add(G.sph(0), mat('ballChunk', 0xe4edf7, { roughness: 0.9 }), [0.6, 0.55, 0.2], [0.35, 0.3, 0.32]);
  ball.add(G.sph(0), mat('ballChunk', 0xe4edf7, { roughness: 0.9 }), [-0.5, -0.4, 0.55], [0.3, 0.3, 0.28]);
  ball.flush();
  return { root, height: 3.2, stacks, front: 1.75 };
}

function grinder(): Tpl {
  const t: EnemyType = 'grinder';
  const root = new THREE.Group();
  const base = new Part(root);
  const stacks: number[] = [];
  const wheels = new Wheels();
  treads(base, wheels, 1.85, 4.2, 1.35, 1.0, 5, accent(t));
  wheels.flush(root);
  const { g: body, b } = sub(root, 'body', [0, 0, 0]);
  const P = paint(t);
  b.add(G.box(), P, [0, 2.0, -0.55], [2.7, 1.6, 3.4]);
  b.add(G.box(), M.rustDark(), [0, 1.3, -0.55], [2.5, 0.2, 3.5]);
  b.add(G.box(), P, [0, 3.1, -1.0], [2.1, 0.75, 2.1]);
  b.add(G.box(), M.rustDark(), [0, 3.52, -1.0], [2.25, 0.1, 2.25]);
  // furnace vents
  for (const sx of [-1, 1]) {
    b.add(G.box(), glowMat(t, 0xff6a00, 0.8), [sx * 1.36, 2.0, -0.55], [0.03, 0.9, 2.4]);
    for (let i = 0; i < 6; i++) b.add(G.box(), M.dark(), [sx * 1.39, 2.0, -1.55 + i * 0.4], [0.05, 0.95, 0.12]);
  }
  // rivets
  for (let i = 0; i < 7; i++) for (const sx of [-1, 1]) b.add(G.sph(0), M.steel(), [sx * 1.36, 2.7, -2.0 + i * 0.5], [0.07, 0.07, 0.07]);
  // face
  b.add(G.box(), M.black(), [0, 2.65, 1.2], [2.0, 0.85, 0.1]);
  for (const sx of [-1, 1]) b.add(G.box(), eyeMat(t, 0xff7a00, 2.6), [sx * 0.5, 2.72, 1.26], [0.6, 0.15, 0.05], [0, 0, sx * 0.28]);
  for (let i = 0; i < 5; i++) b.add(G.box(), M.steel(), [-0.6 + i * 0.3, 2.38, 1.26], [0.12, 0.14, 0.04]);
  b.add(G.box(), M.hazard(), [0, 3.15, 0.07], [2.0, 0.3, 0.03], ZERO, [4, 0.6]);
  // auger housing
  b.add(G.cyl(12), M.dark(), [0, 1.5, 1.35], [1.25, 0.5, 1.25], [PI / 2, 0, 0]);
  b.add(G.torus(), M.steel(), [0, 1.5, 1.6], [1.25, 1.25, 1.3]);
  for (let i = 0; i < 3; i++) stack(b, stacks, -0.75 + i * 0.75, 3.5, -1.75 - (i === 1 ? 0.15 : 0), i === 1 ? 0.22 : 0.18, i === 1 ? 1.2 : 0.9, M.rustDark(), M.black());
  b.flush();
  // THE AUGER (spins around local Z)
  const { b: a } = sub(body, 'spinZ', [0, 1.5, 1.6]);
  a.add(G.cone(10), M.steel(), [0, 0, 1.45], [1.1, 2.9, 1.1], [PI / 2, 0, 0]);
  const n = 14;
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const rad = 1.3 * (1 - k) + 0.18;
    const ang = k * PI * 5;
    a.add(G.box(), accent(t), [Math.cos(ang) * rad * 0.62, Math.sin(ang) * rad * 0.62, 0.1 + k * 2.6], [rad * 0.85, 0.12, 0.34], [0, 0, ang]);
  }
  a.add(G.cone(8), glowMat(t, 0xff6a00, 0.8), [0, 0, 3.05], [0.18, 0.4, 0.18], [PI / 2, 0, 0]);
  a.flush();
  return { root, height: 5.0, stacks, front: 4.6 };
}

function twin(t: 'slush' | 'sleet'): Tpl {
  const root = new THREE.Group();
  const stacks: number[] = [];
  const P = paint(t);
  const A = accent(t);
  const eyeC = t === 'slush' ? 0xfff09a : 0xbff4ff;
  const glowC = t === 'slush' ? 0xff3030 : 0x40a8ff;
  const wheels = new Wheels();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheels.add(sx * 1.3, 0.64, sz * 0.95, 0.64, 0.5, A);
  wheels.flush(root);
  const { b } = sub(root, 'body', [0, 0, 0]);
  b.add(G.wedge(0.36), P, [0, 1.05, 0.05], [2.0, 0.85, 3.1]);
  b.add(G.box(), M.dark(), [0, 0.62, 0], [1.9, 0.16, 3.0]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(G.box(), P, [sx * 1.3, 1.36, sz * 0.95], [0.62, 0.13, 1.4]);
  b.add(G.box(), P, [0, 1.75, -0.75], [1.35, 0.7, 1.2]);
  b.add(G.box(), M.black(), [0, 1.8, -0.13], [1.2, 0.36, 0.05]);
  for (const sx of [-1, 1]) b.add(G.box(), eyeMat(t, eyeC, 2.6), [sx * 0.3, 1.82, -0.1], [0.36, 0.13, 0.04], [0, 0, sx * (t === 'slush' ? 0.3 : -0.12)]);
  // racing stripes
  for (const sx of [-1, 1]) b.add(G.box(), A, [sx * 0.3, 2.11, -0.75], [0.18, 0.02, 1.2]);
  for (const sx of [-1, 1]) b.add(G.box(), A, [sx * 1.01, 1.0, -0.2], [0.02, 0.22, 2.2]);
  // spoiler
  b.add(G.box(), A, [0, 2.3, -1.45], [2.1, 0.08, 0.5]);
  for (const sx of [-1, 1]) b.add(G.box(), M.black(), [sx * 0.7, 2.05, -1.4], [0.08, 0.45, 0.2]);
  b.add(G.box(), glowMat(t, glowC, 0.3), [0, 1.0, -1.57], [1.6, 0.16, 0.04]);
  if (t === 'slush') {
    // charger: twin chrome ram horns + glowing ram bar
    for (const sx of [-1, 1]) {
      b.add(G.cone(8), M.chrome(), [sx * 0.55, 0.85, 2.0], [0.26, 1.1, 0.26], [PI / 2, 0, 0]);
      b.add(G.cyl(8), M.black(), [sx * 0.55, 0.85, 1.42], [0.3, 0.12, 0.3], [PI / 2, 0, 0]);
    }
    b.add(G.box(), glowMat(t, glowC, 0.3), [0, 0.55, 1.58], [2.1, 0.18, 0.2]);
    b.add(G.box(), M.hazard(), [0, 0.82, 1.6], [1.0, 0.2, 0.03], ZERO, [2, 0.4]);
  } else {
    // pinner: big side swipe paddles + front shield
    for (const sx of [-1, 1]) {
      b.add(G.box(), M.steel(), [sx * 1.85, 1.0, 0.1], [0.16, 1.05, 2.4]);
      b.add(G.box(), glowMat(t, glowC, 0.3), [sx * 1.95, 0.5, 0.1], [0.06, 0.12, 2.3]);
      b.add(G.box(), M.black(), [sx * 1.6, 1.15, 0.1], [0.4, 0.14, 0.2]);
      b.add(G.box(), M.hazard(), [sx * 1.94, 1.25, 0.1], [0.03, 0.3, 2.0], ZERO, [4, 0.6]);
    }
    b.add(G.box(), M.steel(), [0, 0.8, 1.62], [2.0, 0.7, 0.16], [-0.3, 0, 0]);
    b.add(G.box(), glowMat(t, glowC, 0.3), [0, 0.45, 1.72], [2.0, 0.1, 0.16]);
  }
  for (const sx of [-1, 1]) stack(b, stacks, sx * 0.45, 1.3, -1.62, 0.1, 0.35, M.chrome(), M.black());
  b.flush();
  return { root, height: 2.8, stacks, front: 1.7 };
}

function omega(): Tpl {
  const t: EnemyType = 'omega';
  const root = new THREE.Group();
  const base = new Part(root);
  const stacks: number[] = [];
  const wheels = new Wheels();
  treads(base, wheels, 2.35, 5.4, 1.6, 1.2, 6, M.hazLight());
  wheels.flush(root);
  for (const sx of [-1, 1]) base.add(G.box(), M.chrome(), [sx * 2.35, 1.7, 0], [1.3, 0.12, 5.2]);
  const { g: body } = sub(root, 'body', [0, 0, 0]);
  // lift pivot at the rear so the whole hull can rear up for the ground pound
  const LZ = -2.3;
  const LY = 1.6;
  const { b } = sub(body, 'lift', [0, LY, LZ]);
  const o = (x: number, y: number, z: number): V3 => [x, y - LY, z - LZ];
  const P = paint(t);
  b.add(G.box(), P, o(0, 2.4, -0.4), [3.5, 1.7, 4.4]);
  b.add(G.box(), M.black(), o(0, 1.6, -0.4), [3.4, 0.2, 4.5]);
  for (const sx of [-1, 1]) {
    b.add(G.box(), M.chrome(), o(sx * 1.77, 2.5, -0.4), [0.05, 0.22, 4.4]);
    b.add(G.box(), M.hazard(), o(sx * 1.77, 2.0, -0.4), [0.03, 0.4, 3.8], ZERO, [8, 0.8]);
  }
  b.add(G.box(), P, o(0, 3.55, -1.0), [2.8, 0.75, 2.9]);
  b.add(G.box(), M.chrome(), o(0, 3.95, -1.0), [2.9, 0.08, 3.0]);
  // core cage
  b.add(G.cyl(12), M.dark(), o(0, 4.05, -0.6), [0.95, 0.2, 0.95]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    b.add(G.cyl(6), M.chrome(), o(Math.sin(a) * 0.85, 4.75, -0.6 + Math.cos(a) * 0.85), [0.06, 1.3, 0.06]);
  }
  b.add(G.cyl(12), M.chrome(), o(0, 5.42, -0.6), [0.95, 0.1, 0.95]);
  b.add(G.sph(1), glowMat(t, 0xff1744, 1.2), o(0, 4.72, -0.6), [0.68, 0.68, 0.68]);
  // visor
  b.add(G.box(), M.black(), o(0, 3.0, 1.82), [2.7, 0.75, 0.12]);
  b.add(G.box(), eyeMat(t, 0xff1744, 3), o(0, 3.05, 1.89), [2.2, 0.17, 0.05]);
  for (const sx of [-1, 1]) b.add(G.box(), eyeMat(t, 0xff1744, 3), o(sx * 0.95, 3.25, 1.89), [0.55, 0.12, 0.05], [0, 0, sx * 0.35]);
  // hazard beacons
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(G.cyl(8), M.hazLight(), o(sx * 1.55, 3.4, -0.4 + sz * 1.9), [0.16, 0.24, 0.16]);
  // TRIPLE BLADE: center + two swept wings, chrome with red edges, spikes between
  b.add(G.box(), M.chrome(), o(0, 1.7, 2.75), [2.6, 2.6, 0.3], [-0.15, 0, 0]);
  for (const sx of [-1, 1]) b.add(G.box(), M.chrome(), o(sx * 2.25, 1.7, 2.15), [2.1, 2.6, 0.3], [-0.15, sx * -0.62, 0]);
  const edge = mat('omegaEdge', 0xff1744, { emissive: 0xff1744, emissiveIntensity: 1.1 });
  b.add(G.box(), edge, o(0, 0.45, 2.92), [2.6, 0.14, 0.26]);
  for (const sx of [-1, 1]) b.add(G.box(), edge, o(sx * 2.25, 0.45, 2.32), [2.1, 0.14, 0.26], [0, sx * -0.62, 0]);
  b.add(G.box(), M.hazard(), o(0, 2.75, 2.88), [2.5, 0.38, 0.03], [-0.15, 0, 0], [6, 0.8]);
  for (const sx of [-1, 1]) b.add(G.box(), M.hazard(), o(sx * 2.25, 2.75, 2.28), [2.0, 0.38, 0.03], [-0.15, sx * -0.62, 0], [4.5, 0.8]);
  for (const sx of [-1, 1]) {
    b.add(G.cone(8), M.chrome(), o(sx * 1.3, 1.5, 3.25), [0.3, 1.3, 0.3], [PI / 2, 0, 0]);
    b.add(G.cone(8), M.black(), o(sx * 3.2, 3.1, 1.6), [0.28, 1.1, 0.28], [0, 0, sx * -0.6]);
  }
  b.add(G.box(), M.black(), o(0, 3.05, 2.55), [5.6, 0.16, 0.45]);
  for (const sx of [-1, 1]) {
    b.add(G.box(), M.black(), o(sx * 1.2, 1.7, 1.9), [0.32, 0.32, 1.6]);
    b.add(G.cyl(8), M.chrome(), o(sx * 0.6, 2.6, 1.9), [0.1, 1.6, 0.1], [PI / 2 - 0.6, 0, 0]);
  }
  // 4 smokestacks with red tips
  const tip = mat('omegaTip', 0xff1744, { emissive: 0xff1744, emissiveIntensity: 0.6 });
  for (const sx of [-1, 1]) {
    b.add(G.cyl(10), M.chrome(), o(sx * 0.95, 4.8, -2.15), [0.22, 2.2, 0.22]);
    b.add(G.cyl(10), tip, o(sx * 0.95, 5.95, -2.15), [0.28, 0.14, 0.28]);
    b.add(G.cyl(10), M.chrome(), o(sx * 1.55, 4.45, -2.35), [0.17, 1.5, 0.17]);
    b.add(G.cyl(10), tip, o(sx * 1.55, 5.25, -2.35), [0.22, 0.12, 0.22]);
    stacks.push(sx * 0.95, 6.1, -2.15, sx * 1.55, 5.4, -2.35);
  }
  b.flush();
  base.flush();
  return { root, height: 6.2, stacks, front: 3.0 };
}

const BUILDERS: Record<EnemyType, () => Tpl> = {
  scrapper,
  brute,
  spinner,
  thief,
  bulldoza,
  frostbyte,
  grinder,
  slush: () => twin('slush'),
  sleet: () => twin('sleet'),
  omega,
  rival: scrapper, // Brawl rivals use their own models (src/brawl); placeholder for exhaustiveness
};
/** One depth-only shadow proxy per rigid group of the template (root base, body, lift, saw rings, auger, ball):
 *  the per-material meshes stop casting and the group's shadow is a single draw. Clones share the proxy
 *  geometry; wheel sets already carry their own instanced proxy. */
function proxyShadows(o: THREE.Object3D): void {
  const casters = o.children.filter((c) => (c as THREE.Mesh).isMesh && !(c as THREE.InstancedMesh).isInstancedMesh && c.castShadow);
  const groups = o.children.filter((c) => !(c as THREE.Mesh).isMesh && c.userData.role !== 'wheels');
  if (casters.length > 1) for (const p of makeShadowProxy(casters, o)) o.add(p);
  for (const g of groups) proxyShadows(g);
}

const TEMPLATES = new Map<EnemyType, Tpl>();
function template(t: EnemyType): Tpl {
  let tpl = TEMPLATES.get(t);
  if (!tpl) {
    tpl = BUILDERS[t]();
    proxyShadows(tpl.root);
    TEMPLATES.set(t, tpl);
  }
  return tpl;
}

/* ------------------------------------------------------------------ instances */

export interface Rig {
  root: THREE.Group;
  body: THREE.Object3D;
  lift: THREE.Object3D | null;
  wheels: WheelSet[];
  spinY: THREE.Object3D[];
  spinZ: THREE.Object3D[];
  paint: THREE.MeshStandardMaterial[];
  paintBase: THREE.Color[];
  eye: THREE.MeshStandardMaterial | null;
  eyeBase: number;
  glow: THREE.MeshStandardMaterial | null;
  glowBase: number;
  glowColor: THREE.Color;
  ball: THREE.Object3D | null;
  ballMat: THREE.MeshStandardMaterial | null;
  tank: THREE.Object3D | null;
  stacks: number[];
  height: number;
  front: number;
  crust: THREE.Mesh;
  stars: THREE.Group;
  /** Minions show a billboard HP bar (drawn by HpBars) at barPos while barShow. */
  bar: boolean;
  barShow: boolean;
  barPos: THREE.Vector3;
  barFill: number;
  owned: THREE.Material[];
  /** Cloned InstancedMeshes (their instance buffers are per rig). */
  instanced: THREE.InstancedMesh[];
}

/** One instanced wheel set of a rig: every part shares `matrix`, all wheels spin by the same `angle`. */
export interface WheelSet {
  matrix: THREE.InstancedBufferAttribute;
  spots: number[];
  r: number;
  angle: number;
}

const BAR_W = 1.3;
const _fgLocal = new THREE.Matrix4();
const _barM = new THREE.Matrix4();

/** Every minion HP bar in two InstancedMeshes (background + fill), billboarded per bar. The fill keeps its opaque
 *  pass at renderOrder 11 and the translucent background renderOrder 10, exactly like the old per-bot meshes. */
export class HpBars {
  private bg!: THREE.InstancedMesh;
  private fg!: THREE.InstancedMesh;
  private readonly geoBg = new THREE.PlaneGeometry(BAR_W + 0.08, 0.2);
  private readonly geoFg = new THREE.PlaneGeometry(1, 0.13).translate(0.5, 0, 0);
  private readonly matBg = new THREE.MeshBasicMaterial({ color: 0x14161c, transparent: true, opacity: 0.8, depthWrite: false });
  private readonly matFg = new THREE.MeshBasicMaterial({ color: 0xff4a3a, depthWrite: false, toneMapped: false });
  private n = 0;

  constructor(private readonly parent: THREE.Object3D) {
    this.alloc(32);
  }

  private alloc(cap: number): void {
    const make = (g: THREE.BufferGeometry, m: THREE.Material, order: number) => {
      const im = new THREE.InstancedMesh(g, m, cap);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.renderOrder = order;
      im.frustumCulled = false;
      im.count = 0;
      im.visible = false;
      this.parent.add(im);
      return im;
    };
    const old = this.bg ? [this.bg, this.fg] : [];
    this.bg = make(this.geoBg, this.matBg, 10);
    this.fg = make(this.geoFg, this.matFg, 11);
    for (let i = 0; i < old.length; i++) {
      (i === 0 ? this.bg : this.fg).instanceMatrix.array.set(old[i].instanceMatrix.array);
      old[i].removeFromParent();
      old[i].dispose();
    }
  }

  /** Start a new frame of bars. */
  begin(): void {
    this.n = 0;
  }

  /** One bar centred at `p`, facing `q` (the camera), filled to `fill` (0..1). */
  add(p: THREE.Vector3, q: THREE.Quaternion, fill: number): void {
    const cap = this.bg.instanceMatrix.count;
    if (this.n >= cap) this.alloc(cap * 2);
    _barM.compose(p, q, _s.set(1, 1, 1));
    _barM.toArray(this.bg.instanceMatrix.array, this.n * 16);
    _fgLocal.compose(_p.set(-BAR_W / 2, 0, 0.01), _q.identity(), _s.set(Math.max(0.001, BAR_W * fill), 1, 1));
    _barM.multiply(_fgLocal).toArray(this.fg.instanceMatrix.array, this.n * 16);
    this.n++;
  }

  /** Upload this frame's bars. */
  end(): void {
    for (const im of [this.bg, this.fg]) {
      im.count = this.n;
      im.visible = this.n > 0;
      if (this.n > 0) im.instanceMatrix.needsUpdate = true;
    }
  }
}

const STAR_GEOS = new Map<EnemyType, THREE.BufferGeometry>();
function starGeometry(type: EnemyType): THREE.BufferGeometry {
  let g = STAR_GEOS.get(type);
  if (!g) {
    const def = ENEMIES[type];
    const n = def.isBoss ? 6 : 4;
    const sr = Math.max(0.5, def.radius * 0.6);
    const ss = def.isBoss ? 0.26 : 0.15;
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      _m.compose(_p.set(Math.sin(a) * sr, Math.sin(a * 2) * 0.12, Math.cos(a) * sr), _q.identity(), _s.set(ss, ss * 1.3, ss * 0.5));
      parts.push(G.oct().clone().applyMatrix4(_m));
    }
    g = mergeGeometries(parts, false)!;
    STAR_GEOS.set(type, g);
  }
  return g;
}

export function createRig(type: EnemyType): Rig {
  const tpl = template(type);
  const def = ENEMIES[type];
  const root = tpl.root.clone(true);
  const rig: Rig = {
    root,
    body: root,
    lift: null,
    wheels: [],
    spinY: [],
    spinZ: [],
    paint: [],
    paintBase: [],
    eye: null,
    eyeBase: 2,
    glow: null,
    glowBase: 0.3,
    glowColor: new THREE.Color(),
    ball: null,
    ballMat: null,
    tank: null,
    stacks: tpl.stacks,
    height: tpl.height,
    front: tpl.front,
    crust: null as unknown as THREE.Mesh,
    stars: null as unknown as THREE.Group,
    bar: !def.isBoss,
    barShow: false,
    barPos: new THREE.Vector3(),
    barFill: 1,
    owned: [],
    instanced: [],
  };
  const map = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if ((o as THREE.InstancedMesh).isInstancedMesh) rig.instanced.push(o as THREE.InstancedMesh);
    if (mesh.isMesh) {
      const m = mesh.material as THREE.MeshStandardMaterial;
      const role = m.userData.inst as InstRole | undefined;
      if (role) {
        let c = map.get(m);
        if (!c) {
          c = m.clone();
          map.set(m, c);
          rig.owned.push(c);
          if (role === 'paint') {
            rig.paint.push(c);
            rig.paintBase.push(c.color.clone());
          } else if (role === 'eye') {
            rig.eye = c;
            rig.eyeBase = c.emissiveIntensity;
          } else if (role === 'glow') {
            rig.glow = c;
            rig.glowBase = c.emissiveIntensity;
            rig.glowColor.copy(c.emissive);
          } else if (role === 'ball') rig.ballMat = c;
        }
        mesh.material = c;
      }
    }
    switch (o.userData.role) {
      case 'body':
        rig.body = o;
        break;
      case 'lift':
        rig.lift = o;
        break;
      case 'wheels': {
        // clone() gave every part its own copy of the instance buffer: share one again
        const parts = o.children as THREE.InstancedMesh[];
        for (const im of parts) im.instanceMatrix = parts[0].instanceMatrix;
        rig.wheels.push({ matrix: parts[0].instanceMatrix, spots: o.userData.spots as number[], r: o.userData.r as number, angle: 0 });
        break;
      }
      case 'spinY':
        rig.spinY.push(o);
        break;
      case 'spinZ':
        rig.spinZ.push(o);
        break;
      case 'ball':
        rig.ball = o;
        o.visible = false;
        break;
      case 'tank':
        rig.tank = o;
        break;
    }
  });

  // Ice crust (visible while frozen).
  const crust = new THREE.Mesh(G.sph(1), M.ice());
  crust.scale.set(def.radius * 1.05, tpl.height * 0.5, def.radius * 1.12);
  crust.position.y = tpl.height * 0.38;
  crust.visible = false;
  root.add(crust);
  rig.crust = crust;

  // Dizzy stars (visible while stunned / dizzy): one merged ring per type.
  const stars = new THREE.Group();
  stars.add(new THREE.Mesh(starGeometry(type), M.star()));
  stars.position.y = tpl.height + 0.35;
  stars.visible = false;
  root.add(stars);
  rig.stars = stars;
  return rig;
}

/** Spin every wheel of the rig about its axle by `roll` metres of travel. */
export function rollWheels(rig: Rig, roll: number): void {
  if (roll === 0) return;
  for (const w of rig.wheels) {
    w.angle += roll / w.r;
    writeWheels(w.matrix, w.spots, w.angle);
  }
}

export function disposeRig(rig: Rig): void {
  for (const m of rig.owned) m.dispose();
  rig.owned.length = 0;
  for (const im of rig.instanced) im.dispose();
  rig.instanced.length = 0;
}

/** Shared geometry for debris chunks. */
export function debrisGeometry(i: number): THREE.BufferGeometry {
  return i % 3 === 0 ? G.wedge(0.4) : i % 3 === 1 ? G.box() : G.cyl(8);
}
