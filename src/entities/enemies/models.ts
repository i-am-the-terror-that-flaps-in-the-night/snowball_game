import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ENEMIES, type EnemyType } from '../../config/enemies';
import { makeShadowProxy } from '../../render/shadowProxy';
import { boltHead, chamferBox, chamferWedge } from '../../render/kit/shapes';
import { lathe, moldboard, profileSolid, roundBlock, stadiumBelt } from '../../render/kit/curves';
import { applyWear, copyWear, type WearProfile } from '../../render/kit/wear';
import { arch, bladeAt, bladeBand, halfDisc, helixFlight, rblock, ring, rotYAt, rp, slab, trackFender, wrapPanel } from './bossShapes';

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
/** debrisWarmMaterials(): build fresh copies instead of the cached shared materials. */
let uncached = false;
function mat(key: string, color: number, o: THREE.MeshStandardMaterialParameters = {}, inst?: InstRole): THREE.MeshStandardMaterial {
  let m = uncached ? undefined : MATS.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, flatShading: false, ...o });
    if (inst) m.userData.inst = inst;
    const w = wearFor(key, m, inst);
    if (w) applyWear(m, w);
    if (uncached) return m;
    MATS.set(key, m);
  }
  return m;
}

/** Wear profile per material kind (render/kit/wear.ts); none for lit-up / see-through parts (eyes, glows, glass,
 *  the snowball). */
function wearFor(key: string, m: THREE.MeshStandardMaterial, inst?: InstRole): WearProfile | null {
  if (inst === 'eye' || inst === 'glow' || inst === 'ball' || m.transparent || m.emissiveIntensity > 1) return null;
  if (key.startsWith('paint_') || key.startsWith('accent_')) return { grime: 0.55, mottle: 0.1, scuff: 0.45 };
  if (key === 'steel' || key === 'dark' || key === 'cleat' || key === 'rustDark') return { grime: 0.45, mottle: 0.12, scuff: 0.3 };
  if (key === 'rubber' || key === 'black') return { grime: 0.35, mottle: 0.08, scuff: 0 };
  if (key === 'chrome' || key === 'gold') return { grime: 0.25, mottle: 0.05, scuff: 0 };
  if (key === 'glass' || key === 'star' || key === 'hazLight') return null;
  return { grime: 0.4, mottle: 0.08, scuff: 0.2 };
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

let _magaTex: THREE.Texture | null = null;
/** Red cap front panel with white block letters (THE DONALD + its rally bots). */
export function magaTexture(): THREE.Texture {
  if (_magaTex) return _magaTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 112;
  const g = c.getContext('2d')!;
  g.fillStyle = '#c8102e';
  g.fillRect(0, 0, 256, 112);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 86px "Arial Black", Impact, sans-serif';
  g.lineJoin = 'round';
  g.lineWidth = 10;
  g.strokeStyle = '#7a0716';
  g.strokeText('MAGA', 128, 60, 238);
  g.fillStyle = '#ffffff';
  g.fillText('MAGA', 128, 60, 238);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _magaTex = t;
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
  gold: () => mat('gold', 0xf0b928, { roughness: 0.32, metalness: 0.3, emissive: 0x4a3000, emissiveIntensity: 0.35 }),
  capRed: () => mat('capRed', 0xc8102e, { roughness: 0.7 }),
  // A touch of self-lit glow from the same texture so the white letters stay white (not cream) in shade.
  maga: () => mat('maga', 0xffffff, { map: magaTexture(), emissiveMap: magaTexture(), emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.7, flatShading: false }),
  flagBlue: () => mat('flagBlue', 0x1f3b8c, { roughness: 0.7 }),
};
const paint = (t: EnemyType) => mat('paint_' + t, ENEMIES[t].color, { roughness: 0.48, metalness: 0.15 }, 'paint');
const accent = (t: EnemyType) => mat('accent_' + t, ENEMIES[t].accent, { roughness: 0.48, metalness: 0.2 }, 'paint');
const eyeMat = (t: EnemyType, c: number, i = 2.2) => mat('eye_' + t, c, { emissive: c, emissiveIntensity: i, roughness: 0.3 }, 'eye');
const glowMat = (t: EnemyType, c: number, i = 0.25) => mat('glow_' + t, c, { emissive: c, emissiveIntensity: i, roughness: 0.4 }, 'glow');
const ballMat = () => mat('ball', 0xf6faff, { roughness: 0.85, emissive: 0x40e0ff, emissiveIntensity: 0.05 }, 'ball');

/** Shared material for debris chunks of a type (non-instanced). A PROTOCOL C echo (a gold hologram) shatters into
 *  gold chunks (M.gold: the same program as paint, so nothing new to compile). */
export function debrisMaterials(t: EnemyType, echo = false): THREE.Material[] {
  if (echo) return [M.gold(), M.gold(), M.gold(), M.gold(), M.steel(), M.dark()];
  return [paint(t), paint(t), accent(t), M.dark(), M.steel(), M.rubber()];
}

/** Warm-up stand-ins (render/warmup.ts): one fresh, uncached copy of each debris material kind (paint, accent, dark,
 *  steel, rubber), same settings and so the same shader programs, without creating the real shared materials early
 *  (a material's id orders the opaque draws). */
export function debrisWarmMaterials(): THREE.Material[] {
  uncached = true;
  try {
    return [paint('scrapper'), accent('scrapper'), M.dark(), M.steel(), M.rubber()];
  } finally {
    uncached = false;
  }
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
  /** Three-quarter torus (THE CHAIRMAN's C monogram), open toward +X before rotation. */
  arc: () => geo('arc', () => new THREE.TorusGeometry(1, 0.24, 6, 18, PI * 1.5)),
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

/* Detail kit (render/kit/shapes.ts, docs/art-pass.md): bevelled parts built at their final size (added at scale 1,
 * so the chamfer never stretches with the part) and merged into the model's existing draws like any other part.
 * BEVEL is the default chamfer (m); small parts get less (chamferHull caps it at a third of the shortest edge). */
const BEVEL = 0.045;
/** Chamfer strength (the approved 'strong' look of the art pass's stage-0 sample). */
const KIT_K = 1.9;
/** Chamfered box: `s` is its size (m). */
function kb(b: Part, m: THREE.Material, p: V3, s: V3, r: V3 = ZERO, c = BEVEL): Part {
  // thin strips / tiny parts: a plain box (a bevel would not read and costs 44 triangles instead of 12)
  if (Math.min(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2])) < KIT_MIN) return b.add(G.box(), m, p, s, r);
  return b.add(chamferBox(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2]), Math.min(c * KIT_K, autoBevel(s))), m, p, ONE, r);
}
/** Parts thinner than this (m) stay plain boxes. */
const KIT_MIN = 0.1;
/** Most chamfer for a part of size `s` (the approved 'strong' look): ~12% of its shortest side, 2 to 12 cm. */
function autoBevel(s: V3): number {
  return Math.max(0.02, Math.min(0.12, 0.12 * Math.min(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2]))));
}
/** Chamfered wedge (the G.wedge(k) shape at size `s`). */
function kw(b: Part, m: THREE.Material, p: V3, s: V3, k: number, r: V3 = ZERO, c = BEVEL): Part {
  if (Math.min(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2])) < KIT_MIN) return b.add(G.wedge(k), m, p, s, r);
  return b.add(chamferWedge(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2]), k, Math.min(c * KIT_K, autoBevel(s))), m, p, ONE, r);
}
/** A row of `n` hex bolt heads from `a` to `b`, heads along local axis `axis` (+y default; rotate with r). Fine
 *  detail: bosses only (close-ups). */
function bolts(b: Part, m: THREE.Material, a: V3, z: V3, n: number, r: V3 = ZERO, size = 0.04): void {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    b.add(boltHead(size, size * 0.7), m, [a[0] + (z[0] - a[0]) * t, a[1] + (z[1] - a[1]) * t, a[2] + (z[2] - a[2]) * t], ONE, r);
  }
}
/** Vent: `n` dark slats across a w x h patch on a face. Medium detail. */
function vent(b: Part, m: THREE.Material, p: V3, w: number, h: number, n: number, r: V3 = ZERO): void {
  for (let i = 0; i < n; i++) {
    const y = -h / 2 + ((i + 0.5) * h) / n;
    _e.set(r[0], r[1], r[2]);
    _p.set(0, y, 0).applyEuler(_e);
    b.add(G.box(), m, [p[0] + _p.x, p[1] + _p.y, p[2] + _p.z], [w, (h / n) * 0.42, 0.03], r);
  }
}

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
    kb(base, M.rubber(), [sx * x, h / 2, 0], [w, h, len], ZERO, Math.min(0.06, h * 0.12));
    // track guard: a thin bevelled rail along the top outer edge of the belt (cleat material: no extra draw)
    kb(base, M.cleat(), [sx * (x + w * 0.42), h + 0.05, 0], [w * 0.22, 0.07, len * 0.96], ZERO, 0.02);
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

/** RESHAPE: two track units with ROUND ends (stadium belts), a raised guard rail and rolling road wheels. */
function roundTreads(base: Part, wheels: Wheels, x: number, len: number, h: number, w: number, nWheels: number, hub: THREE.Material): void {
  for (const sx of [-1, 1]) {
    base.add(stadiumBelt(len, h, w), M.rubber(), [sx * x, 0, 0]);
    // cleats along the top run only (the round ends stay clean)
    const n = Math.max(3, Math.round((len - h) / 0.2));
    for (let i = 0; i < n; i++) base.add(G.box(), M.cleat(), [sx * x, h + 0.02, -(len - h) / 2 + ((i + 0.5) * (len - h)) / n], [w * 1.02, 0.05, ((len - h) / n) * 0.5]);
    const wr = h * 0.34;
    for (let j = 0; j < nWheels; j++) {
      const z = -len / 2 + h * 0.5 + ((len - h) * (j + 0.5)) / nWheels;
      wheels.add(sx * (x + w / 2 + 0.04), h * 0.48, z, wr, 0.1, hub, M.steel());
    }
    // drive sprocket + idler hubs at the round ends
    for (const z of [-(len - h) / 2, (len - h) / 2]) b2(base, sx * (x + w / 2 + 0.02), h / 2, z, h * 0.3);
  }
}
function b2(base: Part, x: number, y: number, z: number, r: number): void {
  base.add(G.cyl(12), M.cleat(), [x, y, z], [r, 0.06, r], [0, 0, PI / 2]);
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

function scrapper(t: EnemyType = 'scrapper'): Tpl {
  const root = new THREE.Group();
  const base = new Part(root);
  const stacks: number[] = [];
  const wheels = new Wheels();
  roundTreads(base, wheels, 0.56, 1.5, 0.44, 0.34, 3, accent(t));
  wheels.flush(root);
  const { b } = sub(root, 'body', [0, 0, 0]);
  const P = paint(t);
  const A = accent(t);
  // RESHAPE: one rounded shell (side profile: a rounded tail, a domed back deck, a long curved slope to the nose)
  b.add(profileSolid('scrapperShell', [
    [-0.66, 0.4], [0.5, 0.4], { p: [0.62, 0.58], q: [0.66, 0.42] }, { p: [-0.05, 0.92], q: [0.35, 0.92] },
    [-0.42, 0.92], { p: [-0.66, 0.66], q: [-0.66, 0.92] },
  ], 0.86, 0.13), P, [0, 0, -0.05]);
  // dark under-belly skirt between the tracks
  b.add(roundBlock(0.78, 0.12, 1.3, 0.05), M.dark(), [0, 0.38, -0.05]);
  // the ram: a curved red scoop, three chrome spikes through it
  b.add(moldboard(1.02, 0.34, 0.14, 0.07), A, [0, 0.26, 0.7]);
  for (const x of [-0.28, 0, 0.28]) b.add(G.cone(8), M.chrome(), [x, 0.4, 0.98], [0.07, 0.28, 0.07], [PI / 2, 0, 0]);
  // curved track fenders (accent), hydraulic rams body -> scoop
  for (const sx of [-1, 1]) {
    b.add(profileSolid('scrapperFender', [
      [-0.74, 0.5], { p: [-0.5, 0.64], q: [-0.7, 0.64] }, [0.45, 0.64], { p: [0.74, 0.46], q: [0.7, 0.64] }, [0.7, 0.44],
      { p: [0.42, 0.58], q: [0.66, 0.58] }, [-0.48, 0.58], { p: [-0.7, 0.46], q: [-0.66, 0.58] },
    ], 0.36, 0.04), A, [sx * 0.56, 0, 0]);
    b.add(G.cyl(8), M.dark(), [sx * 0.3, 0.5, 0.45], [0.05, 0.3, 0.05], [PI / 2 + 0.15, 0, 0]);
    b.add(G.cyl(8), M.chrome(), [sx * 0.3, 0.47, 0.62], [0.03, 0.2, 0.03], [PI / 2 + 0.15, 0, 0]);
    b.add(roundBlock(0.16, 0.05, 0.03, 0.012), eyeMat(t, t === 'slushling' ? 0x3fd1a8 : 0xff3b30), [sx * 0.28, 0.64, -0.72]);
  }
  // hazard cheeks on the shell flanks
  for (const sx of [-1, 1]) b.add(G.box(), M.hazard(), [sx * 0.436, 0.62, -0.25], [0.02, 0.18, 0.5], ZERO, [1.6, 0.5]);
  vent(b, M.black(), [0, 0.925, -0.3], 0.4, 0.14, 3, [-PI / 2, 0, 0]);
  if (t === 'rallybot') for (const sx of [-1, 1]) kb(b, M.gold(), [sx * 0.432, 0.74, -0.3], [0.02, 0.05, 0.62]);
  // domed eye turret on a steel ring (lathe), the eye in a hooded socket
  b.add(lathe('scrapperTurretRing', [[0.36, 0], [0.36, 0.04], [0.3, 0.06]], 20), M.steel(), [0, 0.9, -0.22]);
  b.add(lathe('scrapperTurret', [[0.3, 0], [0.3, 0.08], [0.27, 0.2], [0.17, 0.3], [0, 0.33]], 20), P, [0, 0.92, -0.22]);
  b.add(G.cyl(14), M.black(), [0, 1.0, 0.03], [0.19, 0.14, 0.19], [PI / 2, 0, 0]);
  const eye = t === 'slushling' ? 0x3fd1a8 : 0xff3b30;
  b.add(G.sph(2), eyeMat(t, eye), [0, 1.0, 0.1], [0.13, 0.13, 0.08]);
  if (t === 'rallybot') {
    // red rally cap on the eye turret (MAGA front panel + brim)
    b.add(G.taper(0.82, 12), M.capRed(), [0, 1.27, -0.25], [0.36, 0.26, 0.36]);
    b.add(G.box(), M.maga(), [0, 1.29, 0.1], [0.5, 0.22, 0.03], [-0.3, 0, 0]);
    kb(b, M.capRed(), [0, 1.15, 0.22], [0.52, 0.04, 0.34], [0.1, 0, 0]);
    // a little flag on the antenna
    b.add(G.cyl(6), M.black(), [0.26, 1.2, -0.5], [0.02, 0.6, 0.02]);
    kb(b, M.white(), [0.38, 1.42, -0.5], [0.24, 0.16, 0.01]);
    kb(b, M.capRed(), [0.38, 1.47, -0.5], [0.24, 0.04, 0.015]);
    kb(b, M.capRed(), [0.38, 1.39, -0.5], [0.24, 0.04, 0.015]);
    kb(b, M.flagBlue(), [0.31, 1.46, -0.5], [0.1, 0.08, 0.02]);
  } else {
    // a brow over the eye, antenna with a beacon
    b.add(profileSolid('scrapperBrow', [[-0.05, 0], [0.12, 0], { p: [0.16, 0.06], q: [0.16, 0] }, [-0.05, 0.06]], 0.36, 0.02), M.black(), [0, 1.12, -0.02]);
    b.add(G.cyl(6), M.black(), [0.26, 1.2, -0.5], [0.02, 0.5, 0.02]);
    b.add(G.sph(1), eyeMat(t, eye), [0.26, 1.46, -0.5], [0.05, 0.05, 0.05]);
  }
  // exhaust
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
  kb(b, paint(t), [0, 1.05, -0.25], [1.5, 0.75, 1.9], ZERO, 0.06);
  kw(b, paint(t), [0, 1.52, 0.25], [1.36, 0.36, 0.95], 0.3, ZERO, 0.05);
  kb(b, M.dark(), [0, 0.7, -0.25], [1.4, 0.14, 2.0], ZERO, 0.035);
  // cab with yellow slit eyes
  kb(b, paint(t), [0, 1.95, -0.75], [1.2, 0.85, 0.95], ZERO, 0.06);
  kb(b, M.black(), [0, 2.42, -0.75], [1.3, 0.1, 1.05], ZERO, 0.03);
  // seams, body-side vents, cab roof light bar (chrome lenses), tail lights
  for (const sx of [-1, 1]) {
    kb(b, M.black(), [sx * 0.752, 1.05, 0.2], [0.012, 0.6, 0.02]);
    kb(b, M.black(), [sx * 0.602, 1.95, -0.4], [0.012, 0.6, 0.018]);
    vent(b, M.black(), [sx * 0.755, 1.18, -0.75], 0.5, 0.3, 4, [0, sx * PI / 2, 0]);
    kb(b, eyeMat(t, 0xffc400), [sx * 0.55, 1.0, -1.205], [0.24, 0.08, 0.02]);
  }
  kb(b, M.black(), [0, 2.53, -0.5], [0.8, 0.1, 0.16], ZERO, 0.025);
  // BOLD PASS: layered side armour (two plates a side, a gap between), a twin exhaust with a heat shield, a roof
  // cage, cab mirrors, and teeth along the bottom of the front plate
  for (const sx of [-1, 1]) {
    kb(b, paint(t), [sx * 0.8, 1.12, 0.3], [0.07, 0.5, 0.75], [0, 0, sx * 0.06], 0.025);
    kb(b, paint(t), [sx * 0.8, 1.12, -0.62], [0.07, 0.5, 0.95], [0, 0, sx * 0.06], 0.025);
    b.add(G.cyl(6), M.black(), [sx * 0.5, 2.62, -0.75], [0.025, 0.36, 0.025]);
    kb(b, M.black(), [sx * 0.72, 2.05, -0.3], [0.05, 0.16, 0.1], ZERO, 0.012);
    kb(b, M.chrome(), [sx * 0.78, 2.05, -0.28], [0.02, 0.14, 0.09], ZERO, 0.006);
  }
  kb(b, M.black(), [0, 2.8, -0.75], [1.04, 0.025, 0.025]);
  kb(b, M.black(), [0, 2.8, -0.45], [1.04, 0.025, 0.025]);
  kb(b, M.black(), [0, 2.8, -1.05], [1.04, 0.025, 0.025]);
  stack(b, stacks, -0.5, 2.1, -1.0, 0.09, 0.7, M.chrome(), M.dark());
  kb(b, M.steel(), [-0.5, 2.5, -0.87], [0.22, 0.42, 0.03], ZERO, 0.01);
  for (let i = 0; i < 7; i++) kw(b, M.steel(), [-1.2 + i * 0.4, 0.27, 1.62], [0.16, 0.16, 0.14], 0.5, [-0.14, 0, 0]);
  for (const x of [-0.27, -0.09, 0.09, 0.27]) b.add(G.cyl(8), M.chrome(), [x, 2.53, -0.41], [0.05, 0.02, 0.05], [PI / 2, 0, 0]);
  kb(b, M.glass(), [0, 2.0, -0.27], [1.0, 0.42, 0.04]);
  for (const sx of [-1, 1]) kb(b, eyeMat(t, 0xffc400), [sx * 0.27, 1.98, -0.24], [0.3, 0.1, 0.04], [0, 0, sx * -0.18]);
  kb(b, M.black(), [0, 2.18, -0.24], [1.05, 0.09, 0.08]);
  for (const sx of [-1, 1]) b.add(G.box(), M.hazard(), [sx * 0.76, 1.05, -0.25], [0.03, 0.34, 1.7], ZERO, [4, 0.7]);
  // the big FRONT PLATE
  kb(b, M.steel(), [0, 0.95, 1.45], [2.8, 1.25, 0.2], [-0.14, 0, 0], 0.05);
  for (const sx of [-1, 1]) kb(b, M.steel(), [sx * 1.5, 0.95, 1.3], [0.4, 1.25, 0.18], [-0.14, sx * -0.55, 0], 0.04);
  kb(b, M.dark(), [0, 1.62, 1.35], [3.0, 0.16, 0.34], ZERO, 0.04);
  // vertical stiffener ribs on the plate's face
  for (const x of [-0.95, 0.95]) kb(b, M.dark(), [x, 0.98, 1.56], [0.12, 1.05, 0.06], [-0.14, 0, 0], 0.02);
  b.add(G.box(), M.hazard(), [0, 1.18, 1.57], [2.5, 0.32, 0.03], [-0.14, 0, 0], [5, 0.65]);
  kb(b, glowMat(t, 0xffc400, 0.15), [0, 0.36, 1.56], [2.85, 0.13, 0.2]);
  for (const x of [-0.9, 0, 0.9]) b.add(G.sph(0), M.chrome(), [x, 0.8, 1.56], [0.08, 0.08, 0.05]);
  // push arms + pistons
  for (const sx of [-1, 1]) {
    kb(b, M.black(), [sx * 0.62, 0.85, 0.85], [0.16, 0.16, 1.1]);
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
  kb(b, M.black(), [0, 1.0, 0.56], [0.72, 0.24, 0.24], [-0.6, 0, 0]);
  for (const sx of [-1, 1]) b.add(G.sph(1), eyeMat(t, 0xff8a00), [sx * 0.17, 1.03, 0.64], [0.09, 0.09, 0.06]);
  b.add(G.cyl(8), M.steel(), [0, 1.42, 0], [0.12, 0.12, 0.12]);
  b.add(G.sph(1), glowMat(t, 0xff3b1a, 0.2), [0, 1.52, 0], [0.16, 0.16, 0.16]);
  // BOLD PASS: armour skirt plates round the base, a vented crown on the dome, rivets on the band
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * PI * 2 + PI / 8;
    kb(b, M.dark(), [Math.sin(a) * 0.86, 0.3, Math.cos(a) * 0.86], [0.5, 0.22, 0.1], [0, a, 0]);
    b.add(G.sph(0), M.steel(), [Math.sin(a) * 0.885, 0.66, Math.cos(a) * 0.885], [0.04, 0.04, 0.04]);
  }
  for (let i = 0; i < 3; i++) b.add(G.box(), M.black(), [0, 1.27 - i * 0.06, -0.2 - i * 0.1], [0.4, 0.03, 0.06]);
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
      kw(s, M.chrome(), [Math.sin(a) * (r + 0.06), 0, Math.cos(a) * (r + 0.06)], [0.06, 0.07, 0.24], 0.5, [0, a + PI / 2, 0]);
    }
    for (let i = 0; i < 3; i++) kb(s, M.black(), [0, 0.045, 0], [r * 1.5, 0.02, 0.07], [0, (i / 3) * PI, 0]);
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
  kb(b, M.black(), [0, 0.74, 0.42], [0.78, 0.18, 0.32], [-0.3, 0, 0]);
  for (const sx of [-1, 1]) kb(b, eyeMat(t, 0x40e0ff, 2.6), [sx * 0.17, 0.76, 0.6], [0.16, 0.07, 0.04], [-0.3, 0, sx * 0.25]);
  // vacuum nozzle
  b.add(G.cyl(10), M.steel(), [0, 0.46, 0.78], [0.11, 0.45, 0.11], [PI / 2, 0, 0]);
  b.add(G.taper(0.45, 10), M.dark(), [0, 0.46, 1.05], [0.24, 0.22, 0.24], [-PI / 2, 0, 0]);
  b.add(G.cyl(10), glowMat(t, 0x40e0ff, 1.2), [0, 0.46, 1.16], [0.2, 0.02, 0.2], [PI / 2, 0, 0]);
  // fins
  for (const sx of [-1, 1]) kw(b, accent(t), [sx * 0.5, 0.8, -0.45], [0.05, 0.32, 0.45], 0.4, [0, 0, sx * -0.4]);
  // snow tank (glass) on the back
  // BOLD PASS: a dorsal spine, side air scoops, a stubby whip antenna
  kb(b, accent(t), [0, 0.98, 0.05], [0.08, 0.12, 0.5], [0.15, 0, 0]);
  for (const sx of [-1, 1]) kb(b, M.dark(), [sx * 0.52, 0.56, 0.15], [0.12, 0.14, 0.34], [0, sx * 0.2, 0]);
  b.add(G.cyl(6), M.black(), [-0.2, 1.05, -0.65], [0.015, 0.4, 0.015]);
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
  bossTreads(base, wheels, 1.6, 3.7, 1.05, 0.85, 5, M.hazLight());
  wheels.flush(root);
  const { b } = sub(root, 'body', [0, 0, 0]);
  const P = paint(t);
  // RESHAPE: a rounded tub hull (round tail, round nose corners), the engine hood rolling into the nose, a cab with a
  // raked screen and a rounded roof
  b.add(rp('bdzHull', [
    [-1.7, 0.95], [1.0, 0.95], { p: [1.24, 1.18], q: [1.24, 0.95] }, [1.24, 1.98], { p: [1.08, 2.16], q: [1.24, 2.16] },
    [-1.45, 2.16], { p: [-1.95, 1.7], q: [-1.95, 2.16] }, [-1.95, 1.22], { p: [-1.7, 0.95], q: [-1.95, 0.95] },
  ], 2.4, 0.17, 3), P, ZERO);
  kb(b, M.black(), [0, 1.0, -0.36], [2.3, 0.16, 3.0]);
  b.add(rp('bdzHood', [
    [-0.45, 2.0], [1.28, 2.0], [1.28, 2.44], { p: [0.98, 2.7], q: [1.28, 2.7] }, [-0.45, 2.76],
  ], 2.2, 0.2, 3), P, ZERO);
  for (const sx of [-1, 1]) b.add(G.box(), M.hazard(), [sx * 1.205, 1.58, -0.38], [0.03, 0.55, 2.7], ZERO, [6, 1]);
  // cab
  b.add(rp('bdzCab', [
    [-1.8, 2.1], [-0.28, 2.1], [-0.28, 2.78], [-0.44, 3.46], { p: [-0.68, 3.66], q: [-0.48, 3.66] }, [-1.5, 3.66],
    { p: [-1.8, 3.36], q: [-1.8, 3.66] },
  ], 1.9, 0.15, 3), P, ZERO);
  b.add(rblock(2.02, 0.12, 1.66, 0.05), M.black(), [0, 3.68, -1.1]);
  b.add(slab('bdzScreen', [-0.29, 2.84], [-0.43, 3.42], 0.004, 0.03, 1.56, 0.015), M.glass(), ZERO);
  for (const sx of [-1, 1]) kb(b, M.glass(), [sx * 0.955, 3.1, -1.05], [0.04, 0.6, 1.1]);
  b.add(G.cyl(12), M.hazLight(), [0, 3.84, -1.05], [0.18, 0.18, 0.18]);
  // angry headlights + brows on the hood nose
  for (const sx of [-1, 1]) {
    b.add(G.cyl(16), M.black(), [sx * 0.72, 2.22, 1.29], [0.25, 0.1, 0.25], [PI / 2, 0, 0]);
    b.add(G.cyl(16), eyeMat(t, 0xff2a1a), [sx * 0.72, 2.22, 1.34], [0.19, 0.04, 0.19], [PI / 2, 0, 0]);
    kb(b, M.black(), [sx * 0.72, 2.52, 1.24], [0.62, 0.12, 0.16], [0.5, 0, sx * 0.35]);
  }
  // grille
  b.add(rblock(1.36, 0.82, 0.08, 0.035), M.black(), [0, 1.55, 1.24]);
  for (let i = 0; i < 5; i++) kb(b, M.chrome(), [-0.5 + i * 0.25, 1.55, 1.29], [0.07, 0.7, 0.05]);
  // BLADE: a curved moldboard with forward-swept wings, hazard bands that follow the curve, a rolled top pipe, glowing
  // cutting edges, bone horns
  const BH = 1.95;
  const BC = 0.36;
  const BT = 0.24;
  const BY = 0.22;
  const BZ = 2.14;
  b.add(moldboard(2.9, BH, BC, BT), M.steel(), [0, BY, BZ]);
  b.add(bladeBand(2.9, BH, BC, 0.6, 0.8), M.hazard(), [0, BY, BZ], ONE, ZERO, [6, 0.8]);
  b.add(G.cyl(14), M.black(), [0, BY + BH + 0.04, BZ + BC - BT * 0.5], [0.11, 2.9, 0.11], [0, 0, PI / 2]);
  kb(b, glowMat(t, 0xff3b1a, 0.12), [0, BY + 0.06, BZ - 0.07], [2.9, 0.12, 0.22]);
  const bolt = bladeAt(BH, BC, 0.12);
  bolts(b, M.chrome(), [-1.3, BY + bolt.y, BZ + bolt.z + 0.01], [1.3, BY + bolt.y, BZ + bolt.z + 0.01], 10, [bolt.a, 0, 0], 0.05);
  for (const sx of [-1, 1]) {
    const th = sx * -0.45;
    const c: V3 = [sx * 1.94, BY, 2.29];
    b.add(moldboard(1.15, BH, BC, BT), M.steel(), c, ONE, [0, th, 0]);
    b.add(bladeBand(1.15, BH, BC, 0.6, 0.8), M.hazard(), c, ONE, [0, th, 0], [2.3, 0.8]);
    b.add(G.cyl(14), M.black(), rotYAt(c, th, [0, BH + 0.04, BC - BT * 0.5]), [0.11, 1.15, 0.11], [0, th, PI / 2]);
    kb(b, glowMat(t, 0xff3b1a, 0.12), rotYAt(c, th, [0, 0.06, -0.07]), [1.1, 0.12, 0.22], [0, th, 0]);
    b.add(G.cone(12), M.bone(), [sx * 2.35, 2.75, 2.0], [0.3, 1.2, 0.3], [0.35, 0, sx * -0.5]);
    b.add(lathe('bdzHornBase', [[0.36, 0], [0.36, 0.12], [0.3, 0.2], [0.2, 0.22]], 14), M.black(), [sx * 2.15, 2.18, 2.05], ONE, [0, 0, sx * -0.5]);
  }
  // push arms + rams
  for (const sx of [-1, 1]) {
    kb(b, M.black(), [sx * 1.0, 1.15, 1.28], [0.26, 0.26, 1.24]);
    b.add(G.cyl(10), M.chrome(), [sx * 0.7, 1.75, 1.45], [0.08, 1.3, 0.08], [PI / 2 - 0.55, 0, 0]);
  }
  // cab vents, a roof rack
  for (const sx of [-1, 1]) vent(b, M.black(), [sx * 0.96, 3.0, -1.55], 0.6, 0.5, 5, [0, sx * PI / 2, 0]);
  for (const x of [-0.8, 0.8]) kb(b, M.black(), [x, 3.8, -1.05], [0.1, 0.1, 1.5]);
  kb(b, M.black(), [0, 3.8, -0.4], [1.7, 0.1, 0.1]);
  // smokestacks on the cab's back
  for (const sx of [-1, 1]) {
    stack(b, stacks, sx * 0.62, 3.2, -1.95, 0.17, 1.35, M.chrome(), M.black());
    kb(b, M.black(), [sx * 0.62, 3.4, -1.84], [0.3, 0.16, 0.2]);
  }
  b.flush();
  base.flush();
  return { root, height: 4.9, stacks, front: 2.5 };
}

function frostbyte(): Tpl {
  const t: EnemyType = 'frostbyte';
  const root = new THREE.Group();
  const stacks: number[] = [];
  const P = paint(t);
  const A = accent(t);
  const EYE = eyeMat(t, 0x40e0ff, 2.8);
  const GLOW = glowMat(t, 0x40e0ff, 0.9);
  const wheels = new Wheels();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheels.add(sx * 1.15, 0.56, sz * 1.0 - 0.2, 0.56, 0.46, A);
  wheels.flush(root);
  const { b } = sub(root, 'body', [0, 0, 0]);
  // RESHAPE: a rounded hull (side profile: a curved tail, a flat deck, a sloped hood to a rounded nose)
  b.add(profileSolid('frostHull', [
    [-1.62, 0.72], [1.2, 0.72], { p: [1.32, 0.92], q: [1.34, 0.72] }, { p: [0.55, 1.42], q: [1.1, 1.42] }, [-1.35, 1.42],
    { p: [-1.62, 1.1], q: [-1.62, 1.42] },
  ], 1.78, 0.2), P, [0, 0, -0.2]);
  b.add(roundBlock(1.6, 0.16, 2.9, 0.06), M.dark(), [0, 0.66, -0.2]);
  // arched fenders over the four wheels
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.add(profileSolid('frostFender', [
      [-0.72, 0.95], { p: [0, 1.32], q: [-0.66, 1.32] }, { p: [0.72, 0.95], q: [0.66, 1.32] }, [0.62, 0.95],
      { p: [0, 1.22], q: [0.56, 1.22] }, { p: [-0.62, 0.95], q: [-0.56, 1.22] },
    ], 0.62, 0.06), P, [sx * 1.15, 0, sz * 1.0 - 0.2]);
    bolts(b, M.steel(), [sx * 1.15 - 0.22, 1.27, sz * 1.0 - 0.2 - 0.2], [sx * 1.15 - 0.22, 1.27, sz * 1.0 - 0.2 + 0.2], 3);
  }
  // cab: an upright visor face, a rounded roof sweeping back
  b.add(profileSolid('frostCab', [
    [-1.3, 1.36], [0.28, 1.36], [0.28, 2.42], { p: [-0.05, 2.74], q: [0.28, 2.74] }, [-0.95, 2.74],
    { p: [-1.3, 2.38], q: [-1.3, 2.74] },
  ], 1.72, 0.18), P, [0, 0, 0]);
  b.add(roundBlock(1.52, 0.86, 0.06, 0.08), M.black(), [0, 2.06, 0.27]);
  for (const sx of [-1, 1]) kb(b, EYE, [sx * 0.38, 2.2, 0.31], [0.46, 0.15, 0.04], [0, 0, sx * 0.22]);
  kb(b, EYE, [0, 1.86, 0.31], [0.75, 0.06, 0.04]);
  for (const x of [-0.25, 0, 0.25]) kb(b, EYE, [x, 1.8, 0.31], [0.05, 0.1, 0.04]);
  kb(b, A, [0, 2.54, 0.25], [1.5, 0.06, 0.08]);
  kb(b, GLOW, [0, 2.8, -0.55], [1.2, 0.1, 0.25]);
  // roof light rack (chrome lenses)
  kb(b, M.black(), [0, 2.82, 0.0], [1.4, 0.07, 0.16], ZERO, 0.025);
  for (const x of [-0.5, -0.17, 0.17, 0.5]) {
    b.add(roundBlock(0.2, 0.14, 0.12, 0.04), M.black(), [x, 2.92, 0.04]);
    b.add(G.cyl(12), M.chrome(), [x, 2.92, 0.105], [0.06, 0.02, 0.06], [PI / 2, 0, 0]);
  }
  // deck vents, side grilles, tail lights, cab grab rails
  vent(b, M.black(), [0, 1.43, -1.15], 1.0, 0.45, 5, [-PI / 2, 0, 0]);
  for (const sx of [-1, 1]) {
    vent(b, M.black(), [sx * 0.89, 1.08, -1.2], 0.5, 0.3, 4, [0, sx * PI / 2, 0]);
    b.add(roundBlock(0.3, 0.1, 0.03, 0.02), EYE, [sx * 0.62, 1.05, -1.83]);
    kb(b, M.chrome(), [sx * 0.9, 2.15, -0.5], [0.045, 0.045, 0.9], ZERO, 0.012);
    for (const z of [-0.85, -0.15]) b.add(G.box(), M.dark(), [sx * 0.87, 2.15, z], [0.06, 0.04, 0.04]);
    b.add(G.box(), A, [sx * 0.875, 1.75, -0.5], [0.02, 0.07, 1.4]);
  }
  // the BLADE: a curved moldboard with angled wings, glowing ice edges, hydraulic rams
  b.add(moldboard(3.5, 1.25, 0.38, 0.18), M.steel(), [0, 0.34, 1.62]);
  for (const sx of [-1, 1]) b.add(moldboard(0.62, 1.25, 0.38, 0.18), M.steel(), [sx * 2.02, 0.34, 1.47], ONE, [0, sx * -0.5, 0]);
  kb(b, GLOW, [0, 0.38, 1.64], [3.5, 0.1, 0.2]);
  kb(b, GLOW, [0, 1.6, 2.0], [3.6, 0.08, 0.24]);
  // push frame behind the blade: two beams and hydraulic rams (all end at the blade's back face)
  for (const sx of [-1, 1]) {
    kb(b, M.black(), [sx * 0.55, 0.9, 0.98], [0.16, 0.16, 0.7]);
    b.add(G.cyl(8), M.dark(), [sx * 0.95, 1.18, 0.9], [0.08, 0.5, 0.08], [PI / 2 - 0.3, 0, 0]);
    b.add(G.cyl(8), M.chrome(), [sx * 0.95, 1.07, 1.25], [0.05, 0.35, 0.05], [PI / 2 - 0.3, 0, 0]);
  }
  // antenna + dish, exhaust stacks
  b.add(G.cyl(6), M.black(), [-0.6, 3.1, -1.0], [0.025, 0.7, 0.025]);
  b.add(G.sph(1), EYE, [-0.6, 3.47, -1.0], [0.07, 0.07, 0.07]);
  b.add(lathe('frostDish', [[0.02, 0], [0.3, 0.1], [0.32, 0.13]], 16), M.steel(), [0.5, 2.78, -1.0], ONE, [-0.6, 0, 0]);
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

/** RESHAPE (bosses): two big track units with ROUND ends (stadium belts), cleats over the top run and around the
 *  ends, a recessed roller frame on the outer face (cleat material) carrying the rolling road wheels, sprocket and
 *  idler discs at the ends. Only rubber + `cleat` in `base` (no extra draws). */
function bossTreads(base: Part, wheels: Wheels, x: number, len: number, h: number, w: number, nWheels: number, hub: THREE.Material, cleat: THREE.Material = M.cleat()): void {
  const run = len - h;
  const r = h / 2;
  for (const sx of [-1, 1]) {
    base.add(stadiumBelt(len, h, w), M.rubber(), [sx * x, 0, 0]);
    const n = Math.max(4, Math.round(run / 0.3));
    const cl = (run / n) * 0.48;
    for (let i = 0; i < n; i++) base.add(G.box(), cleat, [sx * x, h + 0.02, -run / 2 + ((i + 0.5) * run) / n], [w * 1.03, 0.07, cl]);
    // around the round ends (the tops of the arcs: the bottom never shows)
    for (const e of [-1, 1]) for (const deg of [30, 60, 90, 120]) {
      const a = (deg * PI) / 180;
      base.add(G.box(), cleat, [sx * x, r + Math.cos(a) * (r + 0.02), e * (run / 2 + Math.sin(a) * (r + 0.02))], [w * 1.03, 0.07, cl], [e * a, 0, 0]);
    }
    // roller frame (a low stadium plate on the outer face), sprocket + idler discs with a hub boss
    base.add(stadiumBelt(run + h * 0.55, h * 0.5, 0.08), cleat, [sx * (x + w / 2 + 0.02), h * 0.22, 0]);
    for (const z of [-run / 2, run / 2]) {
      base.add(G.cyl(12), cleat, [sx * (x + w / 2 + 0.03), r, z], [r * 0.72, 0.1, r * 0.72], [0, 0, PI / 2]);
      base.add(G.cyl(10), M.rubber(), [sx * (x + w / 2 + 0.09), r, z], [r * 0.3, 0.08, r * 0.3], [0, 0, PI / 2]);
    }
    for (let j = 0; j < nWheels; j++) {
      const z = -run / 2 + r * 0.9 + ((run - r * 1.8) * j) / Math.max(1, nWheels - 1);
      wheels.add(sx * (x + w / 2 + 0.1), h * 0.3, z, h * 0.26, 0.12, hub, M.steel());
    }
  }
}


function grinder(): Tpl {
  const t: EnemyType = 'grinder';
  const root = new THREE.Group();
  const base = new Part(root);
  const stacks: number[] = [];
  const wheels = new Wheels();
  bossTreads(base, wheels, 1.85, 4.2, 1.35, 1.0, 5, accent(t));
  wheels.flush(root);
  const { g: body, b } = sub(root, 'body', [0, 0, 0]);
  const P = paint(t);
  // RESHAPE: a rounded furnace hull rising into a hooded head over the drill, a round-roofed boiler house behind it
  b.add(rp('grHull', [
    [-2.0, 1.2], [0.95, 1.2], { p: [1.2, 1.45], q: [1.2, 1.2] }, [1.2, 3.02], { p: [0.88, 3.34], q: [1.2, 3.34] }, [0.32, 3.34],
    { p: [-0.02, 2.86], q: [0.08, 3.34] }, [-1.9, 2.86], { p: [-2.3, 2.42], q: [-2.3, 2.86] }, [-2.3, 1.5], { p: [-2.0, 1.2], q: [-2.3, 1.2] },
  ], 2.7, 0.22, 3), P, ZERO);
  kb(b, M.rustDark(), [0, 1.3, -0.55], [2.5, 0.2, 3.5]);
  b.add(rp('grHouse', [
    [-2.05, 2.7], [0.02, 2.7], [0.02, 3.18], { p: [-0.32, 3.5], q: [0.02, 3.5] }, [-1.85, 3.5], { p: [-2.05, 3.3], q: [-2.05, 3.5] },
  ], 2.1, 0.2, 3), P, ZERO);
  kb(b, M.rustDark(), [0, 2.88, -1.0], [2.24, 0.12, 2.2]);
  // furnace vents
  for (const sx of [-1, 1]) {
    kb(b, glowMat(t, 0xff6a00, 0.8), [sx * 1.36, 2.0, -0.55], [0.03, 0.9, 2.4]);
    for (let i = 0; i < 6; i++) kb(b, M.dark(), [sx * 1.39, 2.0, -1.55 + i * 0.4], [0.05, 0.95, 0.12]);
  }
  // rivets
  for (let i = 0; i < 7; i++) for (const sx of [-1, 1]) b.add(G.sph(0), M.steel(), [sx * 1.36, 2.6, -2.0 + i * 0.45], [0.07, 0.07, 0.07]);
  // face
  b.add(rblock(2.0, 0.76, 0.1, 0.04), M.black(), [0, 2.68, 1.22]);
  for (const sx of [-1, 1]) kb(b, eyeMat(t, 0xff7a00, 2.6), [sx * 0.5, 2.8, 1.28], [0.6, 0.15, 0.05], [0, 0, sx * 0.28]);
  for (let i = 0; i < 5; i++) kb(b, M.steel(), [-0.6 + i * 0.3, 2.47, 1.28], [0.12, 0.14, 0.04]);
  b.add(G.box(), M.hazard(), [0, 3.355, 0.6], [1.9, 0.02, 0.5], ZERO, [4, 1]);
  // auger housing: a flared bell mouth (dark) with a steel lip and a bolt ring, a dark barrel behind it
  b.add(G.cyl(16), M.dark(), [0, 1.5, 1.25], [1.08, 0.4, 1.08], [PI / 2, 0, 0]);
  b.add(ring('grCowl', [[1.02, 0], [1.24, 0], [1.3, 0.22], [1.44, 0.48], [1.44, 0.6], [1.3, 0.6], [1.15, 0.38], [1.02, 0.3]], 28), M.dark(), [0, 1.5, 1.1], ONE, [PI / 2, 0, 0]);
  b.add(ring('grLip', [[1.3, 0], [1.5, 0], [1.5, 0.1], [1.3, 0.1]], 28), M.steel(), [0, 1.5, 1.7], ONE, [PI / 2, 0, 0]);
  // BOLD PASS: riveted rust patch plates on the body, boiler-house side vents, a bolt ring on the drill housing
  for (const sx of [-1, 1]) {
    kb(b, M.rustDark(), [sx * 1.37, 1.55, 0.6], [0.06, 0.4, 0.8]);
    vent(b, M.black(), [sx * 1.06, 3.12, -1.0], 1.2, 0.36, 4, [0, sx * PI / 2, 0]);
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * PI * 2;
    b.add(G.sph(0), M.steel(), [Math.cos(a) * 1.4, 1.5 + Math.sin(a) * 1.4, 1.82], [0.07, 0.07, 0.05]);
  }
  for (let i = 0; i < 3; i++) stack(b, stacks, -0.75 + i * 0.75, 3.5, -1.75 - (i === 1 ? 0.15 : 0), i === 1 ? 0.22 : 0.18, i === 1 ? 1.2 : 0.9, M.rustDark(), M.black());
  b.flush();
  // THE AUGER (spins around local Z): a steel cone wound with one continuous orange flight, teeth on its edge
  const { b: a } = sub(body, 'spinZ', [0, 1.5, 1.6]);
  a.add(lathe('grAuger', [[0.86, 0], [1.08, 0.08], [1.1, 0.16], [0.08, 2.8], [0, 2.95]], 16), M.steel(), [0, 0, 0], ONE, [PI / 2, 0, 0]);
  const FL = { z0: 0.12, z1: 2.72, i0: 1.0, i1: 0.04, o0: 1.62, o1: 0.4, turns: 2.5 };
  a.add(helixFlight(FL.z0, FL.z1, FL.i0, FL.i1, FL.o0, FL.o1, FL.turns, 0.17), accent(t), [0, 0, 0]);
  for (let i = 0; i < 9; i++) {
    const k = (i + 0.5) / 9;
    const ang = k * FL.turns * PI * 2;
    const r = FL.o0 + (FL.o1 - FL.o0) * k;
    a.add(G.cone(6), accent(t), [Math.cos(ang) * (r + 0.1), Math.sin(ang) * (r + 0.1), FL.z0 + (FL.z1 - FL.z0) * k], [0.1, 0.3, 0.1], [0, 0, ang - PI / 2]);
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
  // RESHAPE: a low racing tub (rounded nose, a long hood sweeping up to the cockpit, a round tail), a bubble cockpit,
  // arched fenders over the four wheels, an airfoil spoiler
  b.add(rp('twHull', [
    [-1.42, 0.6], [1.4, 0.6], { p: [1.64, 0.82], q: [1.64, 0.6] }, [1.64, 0.94], { p: [1.36, 1.13], q: [1.62, 1.1] }, [0.3, 1.4],
    { p: [-0.12, 1.47], q: [0.04, 1.47] }, [-1.26, 1.47], { p: [-1.6, 1.18], q: [-1.6, 1.47] }, [-1.6, 0.86], { p: [-1.42, 0.6], q: [-1.6, 0.6] },
  ], 2.0, 0.2, 3, 5), P, ZERO);
  kb(b, M.dark(), [0, 0.62, 0], [1.9, 0.16, 3.0]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.add(arch('twFender', 0, 0.64, 0.7, 0.8, 8, 172, 0.62, 0.045, 6), P, [sx * 1.3, 0, sz * 0.95]);
  }
  b.add(rp('twCockpit', [
    [-1.36, 1.4], [-0.14, 1.4], [-0.12, 1.86], { p: [-0.36, 2.12], q: [-0.12, 2.12] }, [-1.04, 2.12], { p: [-1.36, 1.82], q: [-1.36, 2.12] },
  ], 1.36, 0.22, 3, 5), P, ZERO);
  b.add(rblock(1.18, 0.38, 0.06, 0.03), M.black(), [0, 1.78, -0.11]);
  for (const sx of [-1, 1]) kb(b, eyeMat(t, eyeC, 2.6), [sx * 0.3, 1.8, -0.07], [0.36, 0.13, 0.04], [0, 0, sx * (t === 'slush' ? 0.3 : -0.12)]);
  // racing stripes over the cockpit roof and down the hood, a stripe along each flank
  for (const sx of [-1, 1]) {
    kb(b, A, [sx * 0.3, 2.125, -0.7], [0.18, 0.02, 0.8]);
    b.add(slab('twStripe', [1.36, 1.13], [0.3, 1.4], 0.003, 0.016, 0.18, 0.004), A, [sx * 0.3, 0, 0]);
    kb(b, A, [sx * 1.005, 1.0, -0.2], [0.02, 0.2, 2.0]);
  }
  // airfoil spoiler on two struts, end plates
  b.add(rp('twWing', [[-1.74, 2.25], { p: [-1.18, 2.35], q: [-1.42, 2.4] }, [-1.18, 2.31], { p: [-1.74, 2.2], q: [-1.44, 2.3] }], 2.1, 0.03, 2, 5), A, ZERO);
  for (const sx of [-1, 1]) {
    kb(b, M.black(), [sx * 0.7, 2.0, -1.42], [0.08, 0.5, 0.2]);
    kb(b, A, [sx * 1.07, 2.28, -1.47], [0.04, 0.32, 0.62], [-0.08, 0, 0]);
  }
  kb(b, glowMat(t, glowC, 0.3), [0, 1.0, -1.6], [1.5, 0.16, 0.04]);
  if (t === 'slush') {
    // charger: twin chrome ram horns in black collars + glowing ram bar
    for (const sx of [-1, 1]) {
      b.add(lathe('twHorn', [[0.26, 0], [0.25, 0.3], [0.19, 0.65], [0.1, 0.95], [0.0, 1.12]], 12), M.chrome(), [sx * 0.55, 0.85, 1.45], ONE, [PI / 2, 0, 0]);
      b.add(ring('twCollar', [[0.2, -0.09], [0.31, -0.09], [0.33, 0], [0.31, 0.09], [0.2, 0.09]], 14), M.black(), [sx * 0.55, 0.85, 1.48], ONE, [PI / 2, 0, 0]);
    }
    kb(b, glowMat(t, glowC, 0.3), [0, 0.55, 1.58], [2.1, 0.18, 0.2]);
    b.add(G.box(), M.hazard(), [0, 0.87, 1.645], [1.0, 0.14, 0.02], ZERO, [2, 0.3]);
  } else {
    // pinner: big rounded side swipe paddles + a curved front shield
    for (const sx of [-1, 1]) {
      b.add(rp('twPaddle', [
        [-0.75, 0.48], [0.9, 0.48], { p: [1.3, 0.88], q: [1.3, 0.48] }, [1.3, 1.12], { p: [0.9, 1.52], q: [1.3, 1.52] }, [-0.75, 1.52],
        { p: [-1.1, 1.17], q: [-1.1, 1.52] }, [-1.1, 0.83], { p: [-0.75, 0.48], q: [-1.1, 0.48] },
      ], 0.16, 0.05, 2, 3), M.steel(), [sx * 1.85, 0, 0]);
      kb(b, glowMat(t, glowC, 0.3), [sx * 1.93, 0.52, 0.1], [0.06, 0.1, 1.6]);
      kb(b, M.black(), [sx * 1.6, 1.15, 0.1], [0.4, 0.14, 0.2]);
      b.add(G.box(), M.hazard(), [sx * 1.935, 1.25, 0.1], [0.03, 0.28, 1.7], ZERO, [3.4, 0.6]);
    }
    b.add(moldboard(2.0, 0.72, 0.16, 0.14), M.steel(), [0, 0.42, 1.5]);
    kb(b, glowMat(t, glowC, 0.3), [0, 0.47, 1.47], [2.0, 0.1, 0.16]);
  }
  // cockpit side vents, a roof light rack
  for (const sx of [-1, 1]) vent(b, M.black(), [sx * 0.685, 1.76, -0.75], 0.8, 0.28, 3, [0, sx * PI / 2, 0]);
  kb(b, M.black(), [0, 2.16, -0.5], [1.1, 0.08, 0.14]);
  for (const x of [-0.35, 0, 0.35]) b.add(G.cyl(10), M.chrome(), [x, 2.16, -0.42], [0.07, 0.02, 0.07], [PI / 2, 0, 0]);
  for (const sx of [-1, 1]) stack(b, stacks, sx * 0.45, 1.3, -1.64, 0.1, 0.35, M.chrome(), M.black());
  b.flush();
  return { root, height: 2.8, stacks, front: 1.7 };
}

function omega(): Tpl {
  const t: EnemyType = 'omega';
  const root = new THREE.Group();
  const base = new Part(root);
  const stacks: number[] = [];
  const wheels = new Wheels();
  bossTreads(base, wheels, 2.35, 5.4, 1.6, 1.2, 6, M.hazLight());
  wheels.flush(root);
  // curved chrome track fenders (the old chrome rails)
  for (const sx of [-1, 1]) base.add(trackFender('omFender', 5.3, 1.66, 0.55, 0.12, 1.34), M.chrome(), [sx * 2.35, 0, 0]);
  const { g: body } = sub(root, 'body', [0, 0, 0]);
  // lift pivot at the rear so the whole hull can rear up for the ground pound
  const LZ = -2.3;
  const LY = 1.6;
  const { b } = sub(body, 'lift', [0, LY, LZ]);
  const o = (x: number, y: number, z: number): V3 => [x, y - LY, z - LZ];
  const O = o(0, 0, 0);
  const P = paint(t);
  // RESHAPE: an armoured hull with a rolled brow and tail, a cab whose front sweeps back in one curve
  b.add(rp('omHull', [
    [-2.3, 1.55], [1.55, 1.55], { p: [1.86, 1.86], q: [1.86, 1.55] }, [1.86, 2.92], { p: [1.48, 3.3], q: [1.86, 3.3] }, [-2.18, 3.3],
    { p: [-2.62, 2.86], q: [-2.62, 3.3] }, [-2.62, 1.86], { p: [-2.3, 1.55], q: [-2.62, 1.55] },
  ], 3.5, 0.28, 3, 6), P, O);
  kb(b, M.black(), o(0, 1.6, -0.4), [3.4, 0.2, 4.5]);
  for (const sx of [-1, 1]) {
    kb(b, M.chrome(), o(sx * 1.765, 2.55, -0.4), [0.05, 0.2, 4.2]);
    b.add(G.box(), M.hazard(), o(sx * 1.765, 2.06, -0.4), [0.03, 0.4, 3.8], ZERO, [8, 0.8]);
  }
  b.add(rp('omCab', [
    [-2.45, 3.2], [0.5, 3.2], { p: [0.12, 3.95], q: [0.46, 3.92] }, [-2.12, 3.95], { p: [-2.45, 3.62], q: [-2.45, 3.95] },
  ], 2.8, 0.26, 3, 6), P, O);
  b.add(rblock(2.4, 0.08, 2.2, 0.03), M.chrome(), o(0, 3.98, -1.05));
  // core cage: a stepped dark pedestal, chrome bars, a domed chrome cap, the glowing core
  b.add(lathe('omCoreBase', [[1.0, 0], [1.0, 0.12], [0.92, 0.2], [0.78, 0.24], [0.7, 0.24]], 20), M.dark(), o(0, 3.96, -0.6));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    b.add(G.cyl(8), M.chrome(), o(Math.sin(a) * 0.85, 4.8, -0.6 + Math.cos(a) * 0.85), [0.06, 1.2, 0.06]);
  }
  b.add(lathe('omCoreCap', [[0.98, 0], [0.98, 0.07], [0.82, 0.16], [0.45, 0.24], [0.16, 0.27], [0, 0.27]], 20), M.chrome(), o(0, 5.38, -0.6));
  b.add(G.sph(2), glowMat(t, 0xff1744, 1.2), o(0, 4.72, -0.6), [0.68, 0.68, 0.68]);
  // visor
  b.add(rblock(2.7, 0.72, 0.12, 0.05), M.black(), o(0, 2.84, 1.88));
  kb(b, eyeMat(t, 0xff1744, 3), o(0, 2.86, 1.95), [2.2, 0.17, 0.05]);
  for (const sx of [-1, 1]) kb(b, eyeMat(t, 0xff1744, 3), o(sx * 0.95, 3.06, 1.95), [0.55, 0.12, 0.05], [0, 0, sx * 0.35]);
  // hazard beacons
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(G.cyl(12), M.hazLight(), o(sx * 1.45, 3.4, -0.4 + sz * 1.7), [0.16, 0.24, 0.16]);
  // TRIPLE BLADE: a curved centre moldboard + two forward-swept wings, chrome with red cutting edges, hazard bands that
  // follow the curve, rolled black top pipes, chrome spikes
  const BH = 2.6;
  const BC = 0.5;
  const BT = 0.3;
  const BY = 0.4;
  const BZ = 2.48;
  const edge = mat('omegaEdge', 0xff1744, { emissive: 0xff1744, emissiveIntensity: 1.1 });
  b.add(moldboard(2.6, BH, BC, BT), M.chrome(), o(0, BY, BZ));
  b.add(bladeBand(2.6, BH, BC, 0.62, 0.8), M.hazard(), o(0, BY, BZ), ONE, ZERO, [6, 0.8]);
  b.add(G.cyl(14), M.black(), o(0, BY + BH + 0.05, BZ + BC - BT * 0.5), [0.13, 2.6, 0.13], [0, 0, PI / 2]);
  kb(b, edge, o(0, BY + 0.07, BZ - 0.09), [2.6, 0.14, 0.26]);
  const bolt = bladeAt(BH, BC, 0.12);
  bolts(b, M.chrome(), o(-1.1, BY + bolt.y, BZ + bolt.z + 0.01), o(1.1, BY + bolt.y, BZ + bolt.z + 0.01), 9, [bolt.a, 0, 0], 0.06);
  const spike = bladeAt(BH, BC, 0.3);
  for (const sx of [-1, 1]) {
    const th = sx * -0.62;
    const c = o(sx * 2.2, BY, 2.62);
    b.add(moldboard(2.1, BH, BC, BT), M.chrome(), c, ONE, [0, th, 0]);
    b.add(bladeBand(2.1, BH, BC, 0.62, 0.8), M.hazard(), c, ONE, [0, th, 0], [4.5, 0.8]);
    b.add(G.cyl(14), M.black(), rotYAt(c, th, [0, BH + 0.05, BC - BT * 0.5]), [0.13, 2.1, 0.13], [0, th, PI / 2]);
    kb(b, edge, rotYAt(c, th, [0, 0.07, -0.09]), [2.0, 0.14, 0.26], [0, th, 0]);
    b.add(G.cone(12), M.chrome(), o(sx * 1.3, BY + spike.y, BZ + spike.z + 0.62), [0.3, 1.3, 0.3], [PI / 2, 0, 0]);
    b.add(G.cone(10), M.black(), rotYAt(c, th, [sx * 1.15, BH + 0.25, 0.3]), [0.28, 1.1, 0.28], [0, 0, sx * -0.6]);
    // hinge drum where the wing meets the centre blade
    b.add(lathe('omHinge', [[0, 0], [0.2, 0], [0.24, 0.06], [0.24, 1.7], [0.2, 1.76], [0, 1.76]], 14), M.black(), o(sx * 1.36, BY + 0.05, BZ - 0.22));
  }
  for (const sx of [-1, 1]) {
    kb(b, M.black(), o(sx * 1.2, 1.7, 1.75), [0.32, 0.32, 1.3]);
    b.add(G.cyl(10), M.chrome(), o(sx * 0.6, 2.6, 1.9), [0.1, 1.6, 0.1], [PI / 2 - 0.6, 0, 0]);
  }
  // cab side vents
  for (const sx of [-1, 1]) vent(b, M.black(), o(sx * 1.405, 3.56, -1.0), 1.6, 0.3, 4, [0, sx * PI / 2, 0]);
  // 4 smokestacks with red tips
  const tip = mat('omegaTip', 0xff1744, { emissive: 0xff1744, emissiveIntensity: 0.6 });
  for (const sx of [-1, 1]) {
    b.add(G.cyl(12), M.chrome(), o(sx * 0.95, 4.8, -2.15), [0.22, 2.2, 0.22]);
    b.add(lathe('omTipA', [[0.22, 0], [0.3, 0.06], [0.3, 0.14], [0.24, 0.16]], 12), tip, o(sx * 0.95, 5.88, -2.15));
    b.add(G.cyl(12), M.chrome(), o(sx * 1.55, 4.45, -2.35), [0.17, 1.5, 0.17]);
    b.add(lathe('omTipB', [[0.17, 0], [0.23, 0.05], [0.23, 0.12], [0.18, 0.14]], 12), tip, o(sx * 1.55, 5.18, -2.35));
    stacks.push(sx * 0.95, 6.1, -2.15, sx * 1.55, 5.4, -2.35);
  }
  b.flush();
  base.flush();
  return { root, height: 6.2, stacks, front: 3.0 };
}

/** THE DONALD: a huge gold-and-white caricature plow. The cab is a big orange face block with a swoopy blond
 *  hair sweep, small squinting eyes and a pursed mouth under a red MAGA cap; a long red tie runs down the hood
 *  to a gold blade. A stylised toy, not a likeness. */
function donald(): Tpl {
  const t: EnemyType = 'donald';
  const root = new THREE.Group();
  const base = new Part(root);
  const stacks: number[] = [];
  const wheels = new Wheels();
  const GOLD = M.gold();
  bossTreads(base, wheels, 2.1, 5.0, 1.35, 1.05, 6, GOLD);
  wheels.flush(root);
  for (const sx of [-1, 1]) base.add(trackFender('dnFender', 4.9, 1.4, 0.5, 0.12, 1.24), GOLD, [sx * 2.1, 0, 0]);
  const { b } = sub(root, 'body', [0, 0, 0]);
  const P = paint(t);
  const A = accent(t);
  // RESHAPE: a white limousine tub (rolled nose and tail, round side edges), gold trim lines and stars on the flanks
  b.add(rp('dnHull', [
    [-2.45, 1.45], [2.05, 1.45], { p: [2.32, 1.72], q: [2.32, 1.45] }, [2.32, 2.6], { p: [1.98, 2.95], q: [2.32, 2.95] }, [-2.36, 2.95],
    { p: [-2.72, 2.6], q: [-2.72, 2.95] }, [-2.72, 1.72], { p: [-2.45, 1.45], q: [-2.72, 1.45] },
  ], 3.4, 0.26, 3, 6), P, ZERO);
  kb(b, M.dark(), [0, 1.44, -0.2], [3.3, 0.16, 5.1]);
  for (const sx of [-1, 1]) {
    kb(b, A, [sx * 1.71, 2.56, -0.2], [0.05, 0.14, 4.8]);
    kb(b, A, [sx * 1.71, 1.82, -0.2], [0.05, 0.1, 4.8]);
    // gold stars on the flanks
    for (const z of [-1.4, 0, 1.4]) b.add(G.oct(), A, [sx * 1.73, 2.19, z], [0.04, 0.22, 0.22], [PI / 4, 0, 0]);
  }
  // gold grille + headlights (they flash during wind-ups)
  b.add(rblock(2.0, 0.9, 0.06, 0.03), GOLD, [0, 2.2, 2.34]);
  for (let i = 0; i < 7; i++) kb(b, M.dark(), [-0.75 + i * 0.25, 2.2, 2.38], [0.07, 0.8, 0.03]);
  for (const sx of [-1, 1]) {
    b.add(lathe('dnLampRing', [[0.18, 0], [0.28, 0], [0.3, 0.06], [0.24, 0.12], [0.18, 0.1]], 16), GOLD, [sx * 1.3, 2.38, 2.3], ONE, [PI / 2, 0, 0]);
    b.add(G.cyl(16), eyeMat(t, 0xfff2c0, 2.0), [sx * 1.3, 2.38, 2.37], [0.2, 0.04, 0.2], [PI / 2, 0, 0]);
  }

  // ---- THE HEAD (the cab is the face): a rounded head with jowls, the cap a domed crown with a curved brim
  const SKIN = mat('donaldSkin', 0xf08a2a, { roughness: 0.6 });
  const PALE = mat('donaldPale', 0xf9d3a2, { roughness: 0.6 });
  const HAIR = mat('donaldHair', 0xf6d55c, { roughness: 0.45, metalness: 0.15 });
  const LIPS = mat('donaldLips', 0xd8605a, { roughness: 0.5 });
  const HZ = -0.35; // head centre z
  const FZ = HZ + 1.0; // face plane
  b.add(rp('dnHead', [
    [-1.0, 2.95], [0.3, 2.95], { p: [0.66, 3.2], q: [0.62, 2.95] }, { p: [0.68, 3.72], q: [0.75, 3.45] }, [0.66, 4.55],
    { p: [0.28, 4.98], q: [0.64, 4.98] }, [-0.92, 4.98], { p: [-1.38, 4.5], q: [-1.38, 4.98] }, [-1.38, 3.4], { p: [-1.0, 2.95], q: [-1.38, 2.95] },
  ], 2.5, 0.34, 3, 6), SKIN, ZERO);
  // rounded chin
  b.add(G.sph(1), SKIN, [0, 3.2, FZ - 0.3], [1.0, 0.36, 0.38]);
  // ears
  for (const sx of [-1, 1]) b.add(G.sph(1), SKIN, [sx * 1.27, 4.0, HZ + 0.1], [0.16, 0.36, 0.26]);
  // pale goggle patches + small squinting eyes
  for (const sx of [-1, 1]) {
    b.add(rblock(0.78, 0.44, 0.04, 0.018), PALE, [sx * 0.5, 4.28, FZ + 0.015]);
    kb(b, M.white(), [sx * 0.5, 4.26, FZ + 0.04], [0.46, 0.17, 0.04]);
    kb(b, M.black(), [sx * 0.45, 4.25, FZ + 0.07], [0.16, 0.15, 0.03]);
    // heavy squint lid
    kb(b, SKIN, [sx * 0.5, 4.39, FZ + 0.06], [0.54, 0.1, 0.05], [0, 0, sx * 0.12]);
    // brows
    kb(b, HAIR, [sx * 0.5, 4.58, FZ + 0.06], [0.6, 0.11, 0.1], [0, 0, sx * 0.14]);
  }
  // nose (a rounded bulb in profile)
  b.add(rp('dnNose', [[0, 0.24], [0.1, 0.1], { p: [0.27, -0.12], q: [0.31, 0.02] }, { p: [0.1, -0.22], q: [0.22, -0.22] }, [0, -0.2]], 0.36, 0.1, 2, 5), SKIN, [0, 3.95, FZ - 0.02]);
  // pursed mouth
  b.add(G.sph(1), LIPS, [0, 3.48, FZ + 0.1], [0.3, 0.17, 0.12]);
  b.add(G.sph(1), mat('donaldMouth', 0x5a1a1a, { roughness: 0.6 }), [0, 3.48, FZ + 0.2], [0.1, 0.06, 0.04]);
  // HAIR: swept-back sides + the big blond swoop across the forehead
  for (const sx of [-1, 1]) b.add(G.sph(1), HAIR, [sx * 1.18, 4.7, HZ - 0.15], [0.3, 0.42, 1.0], [0.2, 0, 0]);
  b.add(G.sph(1), HAIR, [0, 4.72, HZ - 1.0], [1.25, 0.45, 0.3]);
  b.add(G.sph(2), HAIR, [0.15, 4.86, FZ + 0.0], [1.5, 0.28, 0.48], [0, 0.12, -0.12]);
  b.add(G.sph(1), HAIR, [-0.95, 4.76, FZ + 0.08], [0.5, 0.22, 0.3], [0.2, 0.4, -0.35]);
  b.add(G.cone(8), HAIR, [-1.35, 4.62, FZ + 0.06], [0.16, 0.42, 0.16], [0, 0, 1.9]);
  // RED CAP: a domed crown, the MAGA panel wrapped on its front (real uvs), a curved brim, the top button
  const RED = M.capRed();
  const CAP: V3 = [1.3, 0.78, 1.18];
  const CY = 4.93;
  b.add(lathe('dnCrown', [[1, 0], [0.86, 0.72], [0.66, 0.9], [0.36, 0.99], [0, 1.0]], 20), RED, [0, CY, HZ + 0.05], CAP);
  b.add(wrapPanel(1.005, 0.885, 0.66, 1.5, 12), M.maga(), [0, CY + 0.03 * CAP[1], HZ + 0.05], CAP);
  b.add(halfDisc(18), RED, [0, 4.97, HZ + 0.05], [1.08, 0.07, 1.86], [0.06, 0, 0]);
  b.add(G.sph(1), RED, [0, CY + 0.79, HZ + 0.05], [0.12, 0.08, 0.12]);
  // shirt collar + the LONG RED TIE running down the hood and over the rolled nose
  for (const sx of [-1, 1]) kb(b, M.white(), [sx * 0.34, 3.0, FZ + 0.1], [0.42, 0.12, 0.3], [0, sx * 0.5, sx * -0.25]);
  const TIE = mat('donaldTie', 0xd0102a, { roughness: 0.5 });
  kb(b, TIE, [0, 3.02, FZ + 0.16], [0.36, 0.3, 0.2]);
  kb(b, TIE, [0, 2.98, 1.34], [0.48, 0.06, 1.3]);
  b.add(arch('dnTieRoll', 1.98, 2.61, 0.34, 0.39, 92, -4, 0.56, 0.01, 6), TIE, ZERO);
  kb(b, TIE, [0, 2.42, 2.36], [0.6, 0.38, 0.05]);
  kb(b, TIE, [0, 2.2, 2.36], [0.32, 0.32, 0.05], [0, 0, PI / 4]);
  // suit shoulders in gold behind the head
  b.add(rblock(2.7, 0.34, 1.4, 0.14), A, [0, 3.1, HZ - 0.4]);

  // GOLD BLADE: a curved moldboard with swept wings, rolled dark top pipes, glowing cutting edges, chrome bolts
  const BH = 2.3;
  const BC = 0.4;
  const BT = 0.28;
  const BY = 0.1;
  const BZ = 2.7;
  const GL = glowMat(t, 0xffc24a, 0.25);
  b.add(moldboard(3.4, BH, BC, BT), GOLD, [0, BY, BZ]);
  b.add(G.cyl(14), M.dark(), [0, BY + BH + 0.05, BZ + BC - BT * 0.5], [0.12, 3.4, 0.12], [0, 0, PI / 2]);
  kb(b, GL, [0, BY + 0.18, BZ - 0.08], [3.4, 0.12, 0.2]);
  const bt = bladeAt(BH, BC, 0.58);
  for (const x of [-1.2, -0.4, 0.4, 1.2]) b.add(G.sph(0), M.chrome(), [x, BY + bt.y, BZ + bt.z + 0.01], [0.09, 0.09, 0.06]);
  for (const sx of [-1, 1]) {
    const th = sx * -0.45;
    const c: V3 = [sx * 2.44, BY, 2.72];
    b.add(moldboard(1.7, BH, BC, BT), GOLD, c, ONE, [0, th, 0]);
    b.add(G.cyl(14), M.dark(), rotYAt(c, th, [0, BH + 0.05, BC - BT * 0.5]), [0.12, 1.7, 0.12], [0, th, PI / 2]);
    kb(b, GL, rotYAt(c, th, [0, 0.18, -0.08]), [1.6, 0.12, 0.2], [0, th, 0]);
  }
  for (const sx of [-1, 1]) {
    kb(b, M.dark(), [sx * 1.1, 1.5, 2.1], [0.3, 0.3, 0.9]);
    b.add(G.cyl(10), M.chrome(), [sx * 0.6, 2.1, 2.3], [0.09, 1.1, 0.09], [PI / 2 - 0.6, 0, 0]);
  }
  // gold smokestacks + a flag on the back
  for (const sx of [-1, 1]) stack(b, stacks, sx * 1.15, 2.95, -2.35, 0.2, 1.4, GOLD, M.black());
  b.add(G.cyl(6), M.chrome(), [0, 4.1, -2.5], [0.04, 2.3, 0.04]);
  kb(b, M.capRed(), [0.45, 4.98, -2.5], [0.9, 0.5, 0.02]);
  kb(b, M.white(), [0.45, 4.98, -2.5], [0.9, 0.18, 0.03]);
  kb(b, M.flagBlue(), [0.22, 5.08, -2.5], [0.44, 0.3, 0.04]);
  b.flush();
  base.flush();
  return { root, height: 5.9, stacks, front: 3.1 };
}

let _towerTex: THREE.Texture | null = null;
/** THE CHAIRMAN's tread skirts: TOWER in gold block letters on black, a gold rule above and below. */
function towerTexture(): THREE.Texture {
  if (_towerTex) return _towerTex;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#121216';
  g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#e8b423';
  g.fillRect(0, 6, 512, 6);
  g.fillRect(0, 84, 512, 6);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 64px "Arial Black", Impact, sans-serif';
  g.fillStyle = '#f2c94c';
  g.fillText('TOWER', 256, 50, 480);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _towerTex = t;
  return t;
}

let _winTex: THREE.Texture | null = null;
/** Mirrored gold curtain wall: a 4 x 2 window grid per tile (dark gold mullions); some panes are lit (the emissive
 *  map: they glow at night), the rest dark, so the lit panes read floor by floor. */
function windowTexture(): THREE.Texture {
  if (_winTex) return _winTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#5a3d08';
  g.fillRect(0, 0, 256, 128);
  const lit = [1, 1, 0, 1, 0, 1, 1, 1];
  for (let r = 0; r < 2; r++)
    for (let i = 0; i < 4; i++) {
      const x = i * 64 + 7;
      const y = r * 64 + 8;
      const on = lit[r * 4 + i];
      const grad = g.createLinearGradient(x, y, x + 50, y + 48);
      grad.addColorStop(0, on ? '#fff3c4' : '#3a2a0a');
      grad.addColorStop(1, on ? '#ffc94a' : '#141008');
      g.fillStyle = grad;
      g.fillRect(x, y, 50, 48);
    }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _winTex = t;
  return t;
}

let _buttonTex: THREE.Texture | null = null;
/** The plaque in front of THE CHAIRMAN's big red button. */
function buttonTexture(): THREE.Texture {
  if (_buttonTex) return _buttonTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2c94c';
  g.fillRect(0, 0, 256, 64);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 38px "Arial Black", Impact, sans-serif';
  g.fillStyle = '#7a0716';
  g.fillText('PROTOCOL C', 128, 34, 240);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _buttonTex = t;
  return t;
}

/** Named animated parts of THE CHAIRMAN's rig (enemies/chairman.ts looks them up by name on the clone). */
export const CHAIRMAN_PART = {
  cannon: 'cmCannon',
  lid: 'cmLid',
  finger: 'cmFinger',
  chute: 'cmChute',
  arm: 'cmArm',
  button: 'cmButton',
} as const;
/** THE CHAIRMAN's local anchors (m, body frame, +Z forward): the briefcase cannon's mouth, the fingertip, the
 *  boardroom floor; the ankle monitor's material key (it blinks). */
export const CHAIRMAN_MUZZLE: V3 = [3.0, 7.2, 1.5];
export const CHAIRMAN_FINGER: V3 = [-2.55, 6.7, 2.7];
export const CHAIRMAN_ROOM_Y = 7.0;
export const CHAIRMAN_MONITOR = 'cmMonitor';
/** The shared ankle-monitor light material (one Chairman per fight: chairman.ts blinks it). */
export const chairmanMonitor = (): THREE.MeshStandardMaterial => mat(CHAIRMAN_MONITOR, 0xff2020, { emissive: 0xff1010, emissiveIntensity: 2.5 });
/** The red dome of the PROTOCOL C button (shared; it lights up when he slams it). */
export const chairmanButton = (): THREE.MeshStandardMaterial => mat('cmButtonRed', 0xff1a1a, { emissive: 0xff0000, emissiveIntensity: 0.6 });

/** THE CHAIRMAN (PROTOCOL C wave 7): THE DONALD's walking golden skyscraper. Two black-and-gold tread pods (TOWER on
 *  the skirts, gold-tinted cleats), a stepped tower of mirrored gold glass (window grid, lit panes glow at night) with
 *  a gold C monogram and folded red-carpet ramps, and on top the boardroom from the stand: through the glass THE
 *  DONALD at a long table in a big gold chair (ankle monitor blinking, the PROTOCOL C button on the table), a flag on
 *  the roof. Crane arms: right a giant BRIEFCASE CANNON (the lid snaps open to fire), left a golden POINTING FINGER.
 *  Phase 2 pops a gold parachute from the roof. A stylised toy, not a likeness. */
function chairman(): Tpl {
  const t: EnemyType = 'chairman';
  const root = new THREE.Group();
  const base = new Part(root);
  const stacks: number[] = [];
  const wheels = new Wheels();
  const GOLD = M.gold();
  const P = paint(t);
  const A = accent(t);
  const goldCleat = mat('cmCleat', 0x8a6a1c, { roughness: 0.6, metalness: 0.3 });
  const skirt = mat('cmSkirt', 0xffffff, { map: towerTexture(), roughness: 0.45, flatShading: false });
  // ---- tread pods (RESHAPE: round-ended belts) with gold-tinted cleats, gold road-wheel hubs, TOWER skirts
  const PX = 1.95;
  const PL = 5.6;
  const PH = 1.5;
  const PW = 1.25;
  bossTreads(base, wheels, PX, PL, PH, PW, 6, GOLD, goldCleat);
  for (const sx of [-1, 1]) {
    // skirt over the upper belt: TOWER on black, a gold edge, a rolled black-gold guard on top
    base.add(G.box(), skirt, [sx * (PX + PW / 2 + 0.2), PH * 0.95, 0], [0.06, 0.6, PL * 0.8]);
    base.add(trackFender('cmGuard', PL * 0.92, PH + 0.12, 0.42, 0.14, PW + 0.42), A, [sx * PX, 0, 0]);
    kb(base, GOLD, [sx * (PX + PW / 2 + 0.22), PH + 0.2, 0], [0.04, 0.12, PL * 0.84]);
  }
  wheels.flush(root);
  // chassis deck between the pods + two gold exhaust vents at the back
  base.add(rblock(2.7, 0.5, 5.0, 0.18), A, [0, 1.7, 0]);
  for (const sx of [-1, 1]) stack(base, stacks, sx * 0.9, 1.95, -2.2, 0.22, 0.7, GOLD, M.black());

  const { g: body, b } = sub(root, 'body', [0, 0, 0]);
  // ---- storeys 1-2: mirrored gold glass, round gold columns at the corners, rounded floor bands
  const WIN = mat('cmWindow', 0xffffff, { map: windowTexture(), emissiveMap: windowTexture(), emissive: 0xffd98a, emissiveIntensity: 0.85, roughness: 0.18, metalness: 0.35, flatShading: false });
  const storey = (w: number, d: number, y0: number, h: number) => {
    b.add(G.box(), WIN, [0, y0 + h / 2, 0], [w, h, d], ZERO, [2, 2]);
    kb(b, A, [0, y0 + 0.06, 0], [w + 0.12, 0.12, d + 0.12]);
    b.add(rblock(w + 0.2, 0.16, d + 0.2, 0.06), P, [0, y0 + h - 0.07, 0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(G.cyl(12), P, [(sx * w) / 2, y0 + h / 2, (sz * d) / 2], [0.13, h, 0.13]);
  };
  storey(3.5, 4.4, 1.95, 2.6);
  storey(3.0, 3.7, 4.55, 2.45);
  // folded red-carpet ramps on the storey-1 flanks, gold rails and stanchions with ball tops
  const CARPET = mat('cmCarpet', 0xb3122a, { roughness: 0.8 });
  for (const sx of [-1, 1]) {
    kb(b, CARPET, [sx * 1.83, 3.15, 0.2], [0.12, 2.0, 3.2], [0, 0, sx * 0.06]);
    b.add(G.cyl(10), GOLD, [sx * 1.92, 4.18, 0.2], [0.05, 3.3, 0.05], [PI / 2, 0, 0]);
    for (const z of [-1.3, 1.7]) {
      b.add(G.cyl(8), GOLD, [sx * 1.95, 3.2, z], [0.06, 1.9, 0.06]);
      b.add(G.sph(1), GOLD, [sx * 1.95, 4.2, z], [0.1, 0.1, 0.1]);
    }
  }
  // the gold C monogram on a rounded black plaque in a gold frame, storey 2 front
  b.add(rblock(1.7, 1.7, 0.05, 0.22), GOLD, [0, 5.75, 1.88]);
  b.add(rblock(1.5, 1.5, 0.04, 0.16), A, [0, 5.75, 1.92]);
  const glow = glowMat(t, 0xffd257, 0.6);
  b.add(G.arc(), glow, [0, 5.75, 1.96], [0.55, 0.55, 0.55], [0, 0, PI * 0.25]);
  // headlights at the deck front (they strobe during wind-ups)
  for (const sx of [-1, 1]) b.add(rblock(0.6, 0.22, 0.06, 0.03), eyeMat(t, 0xfff2c0, 2.0), [sx * 1.0, 1.75, 2.53]);
  kb(b, GOLD, [0, 1.75, 2.52], [0.9, 0.3, 0.05]);

  // ---- the top floor: THE BOARDROOM (y 7.0 .. 9.3), glass, wider than the floor below
  const RY0 = CHAIRMAN_ROOM_Y;
  const RH = 2.3;
  const RW = 3.8;
  const RD = 3.4;
  b.add(rblock(RW + 0.3, 0.2, RD + 0.3, 0.07), A, [0, RY0 + 0.1, 0]);
  // a rounded cornice roof with a stepped gold-black crown
  b.add(rp('cmRoof', [
    [-(RD + 0.4) / 2, RY0 + RH], [(RD + 0.4) / 2, RY0 + RH], { p: [(RD + 0.4) / 2 + 0.06, RY0 + RH + 0.16], q: [(RD + 0.4) / 2 + 0.08, RY0 + RH] },
    { p: [(RD + 0.4) / 2 - 0.08, RY0 + RH + 0.3], q: [(RD + 0.4) / 2 + 0.04, RY0 + RH + 0.3] }, [-(RD + 0.4) / 2 + 0.08, RY0 + RH + 0.3],
    { p: [-(RD + 0.4) / 2 - 0.06, RY0 + RH + 0.16], q: [-(RD + 0.4) / 2 - 0.04, RY0 + RH + 0.3] }, { p: [-(RD + 0.4) / 2, RY0 + RH], q: [-(RD + 0.4) / 2 - 0.08, RY0 + RH] },
  ], RW + 0.4, 0.12, 2, 4), P, ZERO);
  b.add(rblock(RW - 0.4, 0.14, RD - 0.4, 0.06), A, [0, RY0 + RH + 0.36, 0]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(G.cyl(12), P, [(sx * RW) / 2, RY0 + RH / 2, (sz * RD) / 2], [0.1, RH, 0.1]);
  for (const px of [-RW / 4, RW / 4]) b.add(G.cyl(8), P, [px, RY0 + RH / 2, RD / 2], [0.045, RH, 0.045]);
  // warm back wall (lit from inside), the long table, the big gold chair
  kb(b, mat('cmWarm', 0xffd890, { emissive: 0xffc870, emissiveIntensity: 0.7 }), [0, RY0 + RH / 2, -RD / 2 + 0.1], [RW - 0.2, RH - 0.2, 0.1]);
  const WOOD = mat('cmWood', 0x3a2416, { roughness: 0.5 });
  b.add(rblock(RW - 0.5, 0.12, 1.1, 0.05), WOOD, [0, RY0 + 0.95, 0.75]);
  for (const sx of [-1, 1]) kb(b, WOOD, [sx * 1.3, RY0 + 0.55, 0.75], [0.25, 0.8, 0.9]);
  kb(b, GOLD, [0, RY0 + 1.0, 1.3], [RW - 0.5, 0.05, 0.03]);
  // the throne: an arched gold back, a cushioned seat, rolled arms
  b.add(rp('cmChairBack', [[-0.65, 0], [0.65, 0], [0.65, 1.5], { p: [0, 2.1], q: [0.65, 2.1] }, { p: [-0.65, 1.5], q: [-0.65, 2.1] }], 0.3, 0.08, 2, 6), GOLD, [0, RY0 + 0.2, -0.95], ONE, [0, PI / 2, 0]);
  b.add(rblock(1.2, 0.18, 0.9, 0.07), GOLD, [0, RY0 + 0.55, -0.55]);
  for (const sx of [-1, 1]) b.add(rblock(0.14, 0.5, 0.9, 0.06), GOLD, [sx * 0.62, RY0 + 0.8, -0.5]);
  // ---- THE DONALD at the table (the DONALD model's head / hair language, small; lit from the room so he reads at night)
  const SKIN = mat('cmSkin', 0xf08a2a, { roughness: 0.6, emissive: 0x6a2a00, emissiveIntensity: 0.7 });
  const HAIR = mat('cmHair', 0xf6d55c, { roughness: 0.45, metalness: 0.15, emissive: 0x7a6010, emissiveIntensity: 0.7 });
  const TIE = mat('donaldTie', 0xd0102a, { roughness: 0.5 });
  const SUIT = mat('cmSuit', 0x1b2236, { roughness: 0.6 });
  const DY = RY0 + 0.6; // seat height
  b.add(rblock(0.95, 0.85, 0.55, 0.16), SUIT, [0, DY + 0.55, -0.35]);
  kb(b, M.white(), [0, DY + 0.78, -0.07], [0.32, 0.4, 0.04]);
  kb(b, TIE, [0, DY + 0.62, -0.04], [0.13, 0.62, 0.04]);
  kb(b, TIE, [0, DY + 0.28, -0.04], [0.2, 0.14, 0.04], [0, 0, PI / 4]);
  b.add(rblock(0.62, 0.6, 0.56, 0.16), SKIN, [0, DY + 1.25, -0.3]);
  b.add(G.sph(1), SKIN, [0, DY + 1.0, -0.05], [0.26, 0.11, 0.12]);
  for (const sx of [-1, 1]) {
    kb(b, M.white(), [sx * 0.14, DY + 1.32, -0.01], [0.15, 0.07, 0.02]);
    kb(b, M.black(), [sx * 0.13, DY + 1.32, 0.0], [0.06, 0.06, 0.02]);
    kb(b, HAIR, [sx * 0.15, DY + 1.41, -0.01], [0.17, 0.04, 0.03], [0, 0, sx * 0.14]);
    b.add(G.sph(1), HAIR, [sx * 0.31, DY + 1.42, -0.35], [0.08, 0.16, 0.26]);
  }
  b.add(G.sph(1), HAIR, [0, DY + 1.56, -0.45], [0.38, 0.16, 0.34]);
  b.add(G.sph(1), HAIR, [0.05, DY + 1.6, -0.06], [0.46, 0.13, 0.2], [0, 0.12, -0.14]);
  b.add(G.sph(1), HAIR, [-0.3, DY + 1.55, -0.02], [0.18, 0.09, 0.13], [0.2, 0.4, -0.35]);
  b.add(G.cone(8), HAIR, [-0.45, DY + 1.5, 0.0], [0.06, 0.18, 0.06], [0, 0, 1.9]);
  // left arm on the table, legs under it, the ankle monitor (a black band and a red light that blinks)
  b.add(G.cyl(10), SUIT, [-0.42, DY + 0.45, 0.15], [0.11, 0.75, 0.11], [PI / 2, 0, 0]);
  b.add(G.sph(1), SKIN, [-0.42, DY + 0.45, 0.55], [0.11, 0.1, 0.11]);
  for (const sx of [-1, 1]) {
    kb(b, SUIT, [sx * 0.22, DY + 0.05, 0.05], [0.26, 0.22, 0.7]);
    b.add(G.cyl(10), SUIT, [sx * 0.22, DY - 0.28, 0.38], [0.11, 0.6, 0.11]);
    kb(b, M.black(), [sx * 0.22, DY - 0.56, 0.48], [0.24, 0.1, 0.4]);
  }
  b.add(G.cyl(12), M.black(), [0.22, DY - 0.42, 0.38], [0.135, 0.1, 0.135]);
  kb(b, chairmanMonitor(), [0.22, DY - 0.42, 0.53], [0.09, 0.07, 0.03]);
  // the PROTOCOL C button on the table: gold base, a plaque, the red dome (its own group below)
  b.add(lathe('cmButtonBase', [[0.2, 0], [0.2, 0.05], [0.16, 0.08], [0.15, 0.08]], 14), GOLD, [0.65, RY0 + 1.01, 0.75]);
  b.add(G.box(), mat('cmPlaque', 0xffffff, { map: buttonTexture(), roughness: 0.5, flatShading: false }), [0.65, RY0 + 1.03, 1.08], [0.5, 0.05, 0.13]);
  // glass shell (mirrored gold tint, translucent)
  kb(b, mat('cmGlass', 0xffe2a0, { transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.4, depthWrite: false }), [0, RY0 + RH / 2 + 0.05, 0], [RW, RH - 0.1, RD]);
  // roof: a flag (red / white / blue) and the parachute pack
  b.add(G.cyl(6), M.chrome(), [1.4, RY0 + RH + 1.2, -1.2], [0.04, 2.0, 0.04]);
  kb(b, M.capRed(), [1.85, RY0 + RH + 1.9, -1.2], [0.9, 0.5, 0.02]);
  kb(b, M.white(), [1.85, RY0 + RH + 1.9, -1.2], [0.9, 0.18, 0.03]);
  kb(b, M.flagBlue(), [1.62, RY0 + RH + 2.0, -1.2], [0.44, 0.3, 0.04]);
  b.add(rblock(1.6, 0.5, 1.2, 0.16), GOLD, [-0.4, RY0 + RH + 0.65, -0.5]);
  kb(b, A, [-0.4, RY0 + RH + 0.92, -0.5], [1.4, 0.06, 1.0]);
  for (const sx of [-1, 1]) kb(b, A, [-0.4 + sx * 0.45, RY0 + RH + 0.65, -0.5], [0.12, 0.52, 1.22]);
  // crane-arm shoulders on storey 2: a gold-ringed drum
  for (const sx of [-1, 1]) {
    b.add(lathe('cmShoulder', [[0.42, -0.25], [0.46, -0.18], [0.46, 0.18], [0.42, 0.25], [0.2, 0.27]], 18), A, [sx * 1.62, 6.1, 0.2], ONE, [0, 0, sx * -PI / 2]);
    b.add(ring('cmShoulderRing', [[0.18, -0.06], [0.32, -0.06], [0.34, 0], [0.32, 0.06], [0.18, 0.06]], 16), GOLD, [sx * 1.9, 6.1, 0.2], ONE, [0, 0, PI / 2]);
  }
  b.flush();

  // right: the BRIEFCASE CANNON (pivots at the shoulder; the lid hinges along the case's top edge)
  const { g: cg, b: cb } = sub(body, '', [2.0, 6.1, 0.2]);
  cg.name = CHAIRMAN_PART.cannon;
  cb.add(G.cyl(12), P, [0.45, 0.45, 0.4], [0.17, 1.6, 0.17], [PI / 2 - 0.5, 0, 0]);
  cb.add(G.sph(1), A, [0.45, 0.85, 0.95], [0.3, 0.3, 0.3]);
  const LEATHER = mat('cmLeather', 0x2a1a12, { roughness: 0.55 });
  cb.add(rblock(0.62, 1.05, 1.5, 0.09), LEATHER, [0.95, 1.1, 1.3]);
  for (const sz of [-1, 1]) cb.add(rblock(0.66, 1.09, 0.05, 0.02), GOLD, [0.95, 1.12, 1.3 + sz * 0.76]);
  cb.add(arch('cmHandle', 0, 0, 0.11, 0.17, 0, 180, 0.12, 0.02, 6), GOLD, [0.95, 1.62, 1.3]);
  kb(cb, glow, [1.27, 1.1, 1.3], [0.02, 0.7, 1.1]);
  cb.flush();
  const { g: lg, b: lb } = sub(cg, '', [1.28, 1.62, 1.3]);
  lg.name = CHAIRMAN_PART.lid;
  lb.add(rblock(0.08, 1.06, 1.52, 0.03), LEATHER, [0.02, -0.52, 0]);
  for (const sz of [-1, 1]) lb.add(rblock(0.08, 0.18, 0.18, 0.03), GOLD, [0.08, -0.12, sz * 0.5]);
  lb.flush();
  // left: the golden POINTING FINGER (a rounded fist, a capsule finger, a thumb, curled knuckles)
  const { g: fg, b: fb } = sub(body, '', [-2.0, 6.1, 0.2]);
  fg.name = CHAIRMAN_PART.finger;
  fb.add(G.cyl(12), P, [-0.4, 0.3, 0.55], [0.16, 1.4, 0.16], [PI / 2 - 0.3, 0, 0]);
  fb.add(rblock(0.62, 0.62, 0.72, 0.2), GOLD, [-0.55, 0.55, 1.35]);
  fb.add(lathe('cmFingerTip', [[0, 0], [0.08, 0.01], [0.105, 0.06], [0.105, 0.8], [0.08, 0.89], [0, 0.92]], 12), GOLD, [-0.55, 0.62, 1.6], ONE, [PI / 2, 0, 0]);
  fb.add(lathe('cmThumb', [[0, 0], [0.08, 0.01], [0.095, 0.06], [0.095, 0.32], [0.06, 0.4], [0, 0.42]], 10), GOLD, [-0.72, 0.45, 1.37], ONE, [PI / 2, 0, 0.5]);
  for (const sy of [0.4, 0.62]) fb.add(G.cyl(12), GOLD, [-0.48, sy - 0.08, 1.72], [0.09, 0.5, 0.09], [0, 0, PI / 2]);
  fb.add(G.sph(1), glow, [-0.55, 0.62, 2.52], [0.12, 0.12, 0.12]);
  fb.flush();
  // THE DONALD's right forearm (raised; it slams the button on the defeat)
  const { g: ag, b: ab } = sub(body, '', [0.42, RY0 + 1.12, -0.25]);
  ag.name = CHAIRMAN_PART.arm;
  ab.add(G.cyl(10), SUIT, [0, 0.25, 0.3], [0.1, 0.7, 0.1], [PI / 2 - 0.6, 0, 0]);
  ab.add(G.sph(1), SKIN, [0, 0.47, 0.62], [0.12, 0.12, 0.12]);
  ab.flush();
  // the red dome of the button (its own group: it presses down)
  const { g: bg, b: bb } = sub(body, '', [0.65, RY0 + 1.09, 0.75]);
  bg.name = CHAIRMAN_PART.button;
  bb.add(G.hemi(), chairmanButton(), [0, 0, 0], [0.15, 0.12, 0.15]);
  bb.flush();
  // phase 2: the GOLDEN PARACHUTE (hidden): a canopy over the roof, its lines and a cape down the back
  const { g: pg, b: pb } = sub(body, '', [-0.4, RY0 + RH + 0.9, -0.5]);
  pg.name = CHAIRMAN_PART.chute;
  pg.visible = false;
  const SILK = mat('cmSilk', 0xffcf3a, { roughness: 0.35, metalness: 0.25, emissive: 0x5a3a00, emissiveIntensity: 0.4 });
  pb.add(G.hemi(), SILK, [0, 2.4, -0.8], [2.9, 1.4, 2.3], [-0.25, 0, 0]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    const x = Math.sin(a) * 2.2;
    const z = Math.cos(a) * 1.7;
    pb.add(G.cyl(4), M.white(), [x / 2, 1.2, -0.8 + z / 2], [0.02, 2.5, 0.02], [z * 0.32, 0, -x * 0.32]);
  }
  kb(pb, SILK, [0, -1.6, -2.2], [2.8, 3.4, 0.08], [0.18, 0, 0]);
  pb.flush();
  base.flush();
  return { root, height: 10.6, stacks, front: 2.7 };
}

/** Flurry Gunner: a spindly four-wheeled snow cannon (tall mast turret, long barrel, cyan muzzle glow, a hopper of
 *  snowballs on its back). The muzzle sits GUNNER_MUZZLE_Y up, `front` m ahead of the centre. */
export const GUNNER_MUZZLE_Y = 1.55;
function gunner(): Tpl {
  const t: EnemyType = 'gunner';
  const root = new THREE.Group();
  const base = new Part(root);
  const stacks: number[] = [];
  const wheels = new Wheels();
  kb(base, M.dark(), [0, 0.4, -0.05], [0.86, 0.16, 1.4]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) wheels.add(sx * 0.56, 0.3, sz * 0.5, 0.3, 0.18, accent(t));
  wheels.flush(root);
  const { b } = sub(root, 'body', [0, 0, 0]);
  kw(b, paint(t), [0, 0.7, -0.05], [0.8, 0.4, 1.25], 0.35);
  for (const sx of [-1, 1]) b.add(G.box(), M.hazard(), [sx * 0.41, 0.7, -0.2], [0.03, 0.18, 0.7], ZERO, [2, 0.5]);
  // tall mast + turret block
  b.add(G.cyl(8), M.steel(), [0, 1.12, -0.15], [0.11, 0.6, 0.11]);
  kb(b, paint(t), [0, GUNNER_MUZZLE_Y, -0.12], [0.58, 0.42, 0.72]);
  kb(b, M.black(), [0, GUNNER_MUZZLE_Y + 0.23, -0.12], [0.62, 0.06, 0.76]);
  // the long barrel (breech collar, cooling rings) and its glowing muzzle
  b.add(G.cyl(10), M.dark(), [0, GUNNER_MUZZLE_Y, 0.66], [0.12, 1.1, 0.12], [PI / 2, 0, 0]);
  b.add(G.cyl(10), M.black(), [0, GUNNER_MUZZLE_Y, 0.28], [0.18, 0.2, 0.18], [PI / 2, 0, 0]);
  for (const z of [0.55, 0.8]) b.add(G.cyl(10), M.steel(), [0, GUNNER_MUZZLE_Y, z], [0.15, 0.06, 0.15], [PI / 2, 0, 0]);
  b.add(G.cyl(12), glowMat(t, 0x7fe6ff, 0.35), [0, GUNNER_MUZZLE_Y, 1.2], [0.18, 0.12, 0.18], [PI / 2, 0, 0]);
  // side scope = the eye
  b.add(G.cyl(8), M.black(), [0.36, GUNNER_MUZZLE_Y + 0.12, 0.06], [0.08, 0.32, 0.08], [PI / 2, 0, 0]);
  b.add(G.sph(1), eyeMat(t, 0x7fe6ff, 2.6), [0.36, GUNNER_MUZZLE_Y + 0.12, 0.23], [0.07, 0.07, 0.04]);
  // snowball hopper on the back
  b.add(G.taper(1.3, 10), M.steel(), [0, 1.05, -0.58], [0.24, 0.34, 0.24]);
  for (const [x, y, z] of [[0, 1.3, -0.58], [0.12, 1.42, -0.5], [-0.1, 1.44, -0.66]] as const) b.add(G.sph(1), M.white(), [x, y, z], [0.13, 0.13, 0.13]);
  // antenna
  b.add(G.cyl(6), M.black(), [-0.25, 2.0, -0.35], [0.02, 0.5, 0.02]);
  b.add(G.sph(0), accent(t), [-0.25, 2.26, -0.35], [0.05, 0.05, 0.05]);
  // BOLD PASS: wheel fenders, a side ammo drum feeding the gun, angled gun shields, an elevation ram
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) kb(b, M.dark(), [sx * 0.56, 0.64, sz * 0.5], [0.24, 0.07, 0.5]);
  b.add(G.cyl(12), M.dark(), [-0.38, GUNNER_MUZZLE_Y - 0.05, -0.15], [0.17, 0.2, 0.17], [0, 0, PI / 2]);
  b.add(G.cyl(12), M.steel(), [-0.49, GUNNER_MUZZLE_Y - 0.05, -0.15], [0.12, 0.03, 0.12], [0, 0, PI / 2]);
  for (const sx of [-1, 1]) kb(b, paint(t), [sx * 0.24, GUNNER_MUZZLE_Y + 0.02, 0.35], [0.06, 0.34, 0.3], [0, sx * 0.25, 0]);
  b.add(G.cyl(8), M.steel(), [0, 1.0, 0.2], [0.035, 0.42, 0.035], [0.7, 0, 0]);
  stack(b, stacks, 0.24, 0.85, -0.55, 0.05, 0.22, M.steel(), M.dark());
  b.flush();
  base.flush();
  return { root, height: 2.0, stacks, front: 1.26 };
}

/** Bulwark: a squat tread-tank behind a huge curved plow-shield (five steel panels on an arc, an accent rim that
 *  flashes, a cyan edge strip = the glow, which flares on every BLOCK) with an orange rear vent (its weak spot). */
function bulwark(): Tpl {
  const t: EnemyType = 'bulwark';
  const root = new THREE.Group();
  const base = new Part(root);
  const stacks: number[] = [];
  const wheels = new Wheels();
  treads(base, wheels, 0.92, 2.1, 0.64, 0.48, 4, accent(t));
  wheels.flush(root);
  const { b } = sub(root, 'body', [0, 0, 0]);
  kb(b, paint(t), [0, 0.98, -0.4], [1.42, 0.66, 1.6]);
  kb(b, M.dark(), [0, 0.64, -0.4], [1.34, 0.12, 1.7]);
  // squat cab with a visor slit
  kb(b, paint(t), [0, 1.56, -0.62], [0.96, 0.52, 0.86]);
  kb(b, M.black(), [0, 1.85, -0.62], [1.04, 0.08, 0.94]);
  kb(b, M.black(), [0, 1.6, -0.18], [0.8, 0.14, 0.04]);
  kb(b, eyeMat(t, 0x6fd8ff), [0, 1.6, -0.16], [0.58, 0.06, 0.03]);
  // rear vent: the weak spot (BULWARK_REAR_MULT)
  kb(b, M.black(), [0, 1.0, -1.21], [0.92, 0.5, 0.05]);
  for (let i = 0; i < 3; i++) kb(b, M.hazLight(), [0, 0.86 + i * 0.14, -1.24], [0.76, 0.05, 0.03]);
  // THE SHIELD: five tall panels on an arc, leaning back a touch
  const R = 1.9;
  const cz = -0.28;
  for (let k = -2; k <= 2; k++) {
    const a = k * 0.3;
    const x = Math.sin(a) * R;
    const z = cz + Math.cos(a) * R;
    kb(b, M.steel(), [x, 1.12, z], [0.62, 2.0, 0.16], [-0.08, a, 0]);
    kb(b, accent(t), [x, 2.16, z - 0.08], [0.64, 0.12, 0.22], [-0.08, a, 0]);
    kb(b, glowMat(t, 0x6fd8ff, 0.3), [x, 0.16, z + 0.02], [0.64, 0.08, 0.2], [-0.08, a, 0]);
    for (const y of [0.55, 1.7]) b.add(G.sph(0), M.chrome(), [x * 1.04, y, z + 0.1], [0.05, 0.05, 0.04]);
  }
  b.add(G.box(), M.hazard(), [0, 1.2, cz + R + 0.1], [0.56, 0.5, 0.03], [-0.08, 0, 0], [1.2, 1.2]);
  // arms bracing the shield
  for (const sx of [-1, 1]) kb(b, M.black(), [sx * 0.5, 1.0, 0.85], [0.14, 0.14, 1.0]);
  // BOLD PASS: layered side armour, tread skirts, a roof hatch with a grab handle, shield back struts with bolts
  for (const sx of [-1, 1]) {
    kb(b, paint(t), [sx * 0.75, 1.02, -0.05], [0.07, 0.48, 0.7], [0, 0, sx * 0.08]);
    kb(b, paint(t), [sx * 0.75, 1.02, -0.8], [0.07, 0.48, 0.7], [0, 0, sx * 0.08]);
    kb(b, accent(t), [sx * 1.2, 0.72, -0.1], [0.08, 0.2, 1.8], [0, 0, sx * 0.1]);
    kb(b, M.dark(), [sx * 0.62, 1.55, 0.95], [0.12, 0.12, 0.9], [0.35, 0, 0]);
  }
  kb(b, M.dark(), [0, 1.9, -0.75], [0.5, 0.06, 0.45]);
  b.add(G.box(), M.chrome(), [0, 1.96, -0.75], [0.3, 0.03, 0.04]);
  stack(b, stacks, -0.45, 1.3, -1.0, 0.08, 0.5, M.chrome(), M.dark());
  b.flush();
  base.flush();
  return { root, height: 2.35, stacks, front: 1.72 };
}

/** Slushpile: a treaded hopper heaped with lumpy grey slush (paint, so the whole heap flashes), beady teal eyes
 *  peeking out of the front of the heap and a stubby scoop. */
function slushpile(): Tpl {
  const t: EnemyType = 'slushpile';
  const root = new THREE.Group();
  const base = new Part(root);
  const stacks: number[] = [];
  const wheels = new Wheels();
  treads(base, wheels, 0.74, 1.8, 0.5, 0.38, 3, accent(t));
  wheels.flush(root);
  const { b } = sub(root, 'body', [0, 0, 0]);
  kb(b, M.dark(), [0, 0.6, 0], [1.24, 0.22, 1.7]);
  b.add(G.taper(1.4, 10), M.steel(), [0, 0.92, 0], [0.72, 0.46, 0.8]);
  kw(b, M.steel(), [0, 0.42, 0.98], [1.26, 0.28, 0.34], 0.5);
  const lumps: readonly (readonly [number, number, number, number])[] = [
    [0, 1.38, 0, 0.82], [0.48, 1.26, 0.3, 0.5], [-0.44, 1.3, -0.24, 0.55], [0.08, 1.8, -0.12, 0.52],
    [-0.32, 1.22, 0.46, 0.42], [0.36, 1.3, -0.5, 0.45], [-0.1, 2.12, 0.05, 0.3],
  ];
  for (const [x, y, z, r] of lumps) b.add(G.sph(1), paint(t), [x, y, z], [r, r * 0.8, r]);
  // teal meltwater streaks (accent)
  for (const [x, y, z] of [[0.6, 1.0, 0.1], [-0.55, 1.05, 0.3], [0.2, 0.98, -0.62]] as const) b.add(G.sph(0), accent(t), [x, y, z], [0.14, 0.2, 0.14]);
  // BOLD PASS: hopper rim and ribs, tread armour, headlamp housings either side of the scoop
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * PI * 2;
    kb(b, M.dark(), [Math.sin(a) * 0.9, 1.14, Math.cos(a) * 0.98], [0.42, 0.1, 0.12], [0, a, 0]);
    if (k % 2 === 0) kb(b, M.steel(), [Math.sin(a) * 0.9, 0.9, Math.cos(a) * 0.98], [0.1, 0.4, 0.1], [0, a, 0]);
  }
  for (const sx of [-1, 1]) {
    kb(b, accent(t), [sx * 0.98, 0.58, 0], [0.08, 0.2, 1.6], [0, 0, sx * 0.1]);
    kb(b, M.dark(), [sx * 0.5, 0.66, 0.9], [0.18, 0.14, 0.12]);
  }
  for (const sx of [-1, 1]) b.add(G.sph(1), eyeMat(t, 0x3fd1a8, 2.6), [sx * 0.22, 1.4, 0.76], [0.1, 0.1, 0.06]);
  b.flush();
  base.flush();
  return { root, height: 2.3, stacks, front: 1.1 };
}

/** Mirror Plow: a low chrome rival plow (mirror-finish panels over a dark chassis, a raked windshield, a broad chrome
 *  blade with a magenta edge) under a floating RECORDING HALO (the glow: a ring + four fins, recoloured by the move it
 *  copies, Enemies.render). The halo floats MIRROR_HALO_Y up. */
export const MIRROR_HALO_Y = 2.75;
function mirror(): Tpl {
  const t: EnemyType = 'mirror';
  const root = new THREE.Group();
  const base = new Part(root);
  const stacks: number[] = [];
  const wheels = new Wheels();
  kb(base, M.black(), [0, 0.42, 0], [1.6, 0.22, 2.7]);
  for (const sx of [-1, 1]) for (const sz of [-0.85, 0.85]) wheels.add(sx * 0.95, 0.42, sz, 0.42, 0.3, M.chrome());
  wheels.flush(root);
  const { b } = sub(root, 'body', [0, 0, 0]);
  const CHROME = mat('paint_mirror', ENEMIES[t].color, { roughness: 0.12, metalness: 0.75 }, 'paint');
  // chassis + sculpted hood: chrome panels with dark seams
  kw(b, CHROME, [0, 0.85, 0.25], [1.7, 0.52, 2.2], 0.32);
  kb(b, M.dark(), [0, 0.6, -0.2], [1.74, 0.1, 2.9]);
  for (const sx of [-1, 1]) {
    kb(b, CHROME, [sx * 0.86, 0.82, -0.25], [0.12, 0.34, 2.3]);
    kb(b, accent(t), [sx * 0.93, 0.76, 0.1], [0.04, 0.05, 1.7]);
  }
  // cab with a raked dark windshield and a mirrored roof
  kb(b, CHROME, [0, 1.38, -0.55], [1.3, 0.62, 1.1]);
  kb(b, M.glass(), [0, 1.4, 0.03], [1.2, 0.5, 0.08], [-0.5, 0, 0]);
  kb(b, M.glass(), [0, 1.42, -0.55], [1.34, 0.36, 0.9]);
  kb(b, CHROME, [0, 1.74, -0.6], [1.36, 0.1, 1.16]);
  // visor eye strip behind the windshield
  kb(b, eyeMat(t, 0xff3bd0, 2.4), [0, 1.48, -0.02], [0.9, 0.06, 0.05], [-0.5, 0, 0]);
  // broad chrome blade with a magenta edge + side wings
  kb(b, M.chrome(), [0, 0.62, 1.5], [2.3, 0.8, 0.14], [-0.15, 0, 0]);
  for (const sx of [-1, 1]) kb(b, M.chrome(), [sx * 1.32, 0.62, 1.32], [0.6, 0.8, 0.14], [-0.15, sx * -0.5, 0]);
  kb(b, accent(t), [0, 0.24, 1.56], [2.3, 0.07, 0.16]);
  kb(b, M.black(), [0, 1.04, 1.44], [2.36, 0.07, 0.2]);
  for (const sx of [-1, 1]) b.add(G.cyl(8), M.dark(), [sx * 0.55, 0.78, 1.0], [0.08, 0.7, 0.08], [PI / 2 - 0.35, 0, 0]);
  // twin exhausts + rear spoiler
  for (const sx of [-1, 1]) stack(b, stacks, sx * 0.52, 0.9, -1.25, 0.08, 0.32, M.chrome(), M.dark());
  kb(b, CHROME, [0, 1.3, -1.35], [1.5, 0.06, 0.34]);
  for (const sx of [-1, 1]) kb(b, M.dark(), [sx * 0.55, 1.12, -1.35], [0.06, 0.34, 0.2]);
  // RECORDING HALO (glow): a ring with four fins, on a thin mast
  b.add(G.cyl(6), M.dark(), [0, 2.05, -0.6], [0.04, 0.62, 0.04]);
  const HALO = glowMat(t, 0xff3bd0, 0.6);
  b.add(G.torus(), HALO, [0, MIRROR_HALO_Y, -0.6], [0.62, 0.62, 0.62], [PI / 2, 0, 0]);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * PI * 2;
    kb(b, HALO, [Math.sin(a) * 0.62, MIRROR_HALO_Y, -0.6 + Math.cos(a) * 0.62], [0.08, 0.26, 0.08]);
  }
  b.flush();
  base.flush();
  return { root, height: 3.1, stacks, front: 1.6 };
}

/** Magnet Tower: a tracked base under a tall mast carrying a red horseshoe magnet (silver pole tips = the glow, which
 *  crackles while it pulls and flares red-hot overheated), a copper coil drum (spinY) and three fold-down anchor legs
 *  (the lift: Enemies.render lowers them with `rear`). */
export const MAGNET_TOP_Y = 3.3;
function magnet(): Tpl {
  const t: EnemyType = 'magnet';
  const root = new THREE.Group();
  const base = new Part(root);
  const stacks: number[] = [];
  const wheels = new Wheels();
  treads(base, wheels, 0.8, 1.9, 0.5, 0.42, 3, M.dark());
  wheels.flush(root);
  const { b, g } = sub(root, 'body', [0, 0, 0]);
  kb(b, M.dark(), [0, 0.68, 0], [1.5, 0.3, 1.7]);
  b.add(G.box(), M.hazard(), [0, 0.84, 0.86], [1.3, 0.12, 0.03], ZERO, [3, 0.4]);
  // mast + collar
  b.add(G.cyl(10), M.steel(), [0, 1.6, 0], [0.22, 1.6, 0.22]);
  b.add(G.cyl(12), M.black(), [0, 1.0, 0], [0.42, 0.24, 0.42]);
  b.add(G.cyl(12), paint(t), [0, 2.35, 0], [0.34, 0.18, 0.34]);
  // horseshoe: two red arms + a curved crown of boxes, silver pole tips (glow) facing forward-up
  const R = 0.62;
  for (let k = 0; k <= 6; k++) {
    const a = PI * (k / 6);
    kb(b, paint(t), [Math.cos(a) * R, MAGNET_TOP_Y + Math.sin(a) * R * 0.9, 0], [0.34, 0.34, 0.4], [0, 0, a]);
  }
  for (const sx of [-1, 1]) {
    kb(b, paint(t), [sx * R, MAGNET_TOP_Y - 0.4, 0], [0.34, 0.7, 0.4]);
    kb(b, glowMat(t, 0xcfd8ff, 0.5), [sx * R, MAGNET_TOP_Y - 0.86, 0], [0.36, 0.24, 0.42]);
    kb(b, M.black(), [sx * R, MAGNET_TOP_Y - 0.72, 0], [0.38, 0.04, 0.44]);
  }
  // eye: a sensor in the crown
  // BOLD PASS: mast bracing struts, a power cable up the mast, base side armour with vents
  for (const sx of [-1, 1]) {
    kb(b, M.steel(), [sx * 0.32, 1.25, 0], [0.1, 0.8, 0.1], [0, 0, sx * -0.35]);
    kb(b, M.dark(), [sx * 0.78, 0.7, 0], [0.08, 0.3, 1.5], [0, 0, sx * 0.1]);
    vent(b, M.black(), [sx * 0.83, 0.72, 0], 0.8, 0.2, 3, [0, sx * PI / 2, 0]);
  }
  b.add(G.cyl(6), M.black(), [0.16, 1.6, 0.14], [0.03, 1.5, 0.03]);
  b.add(G.sph(1), eyeMat(t, 0xffe14a, 2.4), [0, MAGNET_TOP_Y + R * 0.9, 0.2], [0.11, 0.11, 0.08]);
  // copper coil drum on the mast (spins while pulling)
  const coil = sub(g, 'spinY', [0, 1.9, 0]);
  coil.b.add(G.cyl(14), mat('copper', 0xc8742e, { roughness: 0.35, metalness: 0.6 }), [0, 0, 0], [0.4, 0.42, 0.4]);
  for (let k = 0; k < 3; k++) coil.b.add(G.torus(), M.black(), [0, -0.14 + k * 0.14, 0], [0.42, 0.42, 0.42], [PI / 2, 0, 0]);
  kb(coil.b, accent(t), [0.42, 0, 0], [0.06, 0.4, 0.12]);
  coil.b.flush();
  // three anchor legs on the lift (fold down when anchored)
  const lift = sub(root, 'lift', [0, 0.9, 0]);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * PI * 2 + PI / 3;
    const x = Math.sin(a) * 0.7;
    const z = Math.cos(a) * 0.7;
    kb(lift.b, M.steel(), [x * 1.3, -0.3, z * 1.3], [0.14, 0.9, 0.14], [Math.cos(a) * 0.6, 0, -Math.sin(a) * 0.6]);
    lift.b.add(G.cyl(8), M.black(), [x * 1.75, -0.78, z * 1.75], [0.2, 0.08, 0.2]);
  }
  lift.b.flush();
  stack(b, stacks, -0.5, 0.84, -0.6, 0.07, 0.3, M.steel(), M.dark());
  b.flush();
  base.flush();
  return { root, height: 4.1, stacks, front: 0.95 };
}

/** Tether Twin: a compact indigo hover-buggy with a gold tether pylon on its roof (the glow: the pylon's orb, where the
 *  tether beam attaches, TWIN_PYLON_Y up) and gold fins. */
export const TWIN_PYLON_Y = 1.85;
function twinlink(): Tpl {
  const t: EnemyType = 'twinlink';
  const root = new THREE.Group();
  const base = new Part(root);
  const stacks: number[] = [];
  const wheels = new Wheels();
  kb(base, M.black(), [0, 0.36, 0], [1.1, 0.16, 1.7]);
  for (const sx of [-1, 1]) for (const sz of [-0.55, 0.55]) wheels.add(sx * 0.66, 0.34, sz, 0.34, 0.24, accent(t));
  wheels.flush(root);
  const { b } = sub(root, 'body', [0, 0, 0]);
  kw(b, paint(t), [0, 0.72, 0.1], [1.14, 0.5, 1.5], 0.4);
  kb(b, paint(t), [0, 1.08, -0.35], [0.86, 0.36, 0.7]);
  kb(b, M.black(), [0, 1.27, -0.35], [0.9, 0.05, 0.74]);
  // twin eyes
  for (const sx of [-1, 1]) b.add(G.sph(1), eyeMat(t, 0xffd23a, 2.6), [sx * 0.22, 1.1, 0.02], [0.09, 0.09, 0.05]);
  // ram prow + gold fins
  kb(b, M.steel(), [0, 0.5, 0.92], [1.1, 0.34, 0.12], [-0.2, 0, 0]);
  for (const sx of [-1, 1]) kb(b, accent(t), [sx * 0.6, 0.98, -0.5], [0.05, 0.36, 0.6], [0, 0, sx * 0.3]);
  // tether pylon: mast, collar and the glowing orb
  b.add(G.cyl(8), M.dark(), [0, 1.5, -0.4], [0.06, 0.5, 0.06]);
  b.add(G.cyl(10), accent(t), [0, 1.62, -0.4], [0.14, 0.06, 0.14]);
  b.add(G.sph(1), glowMat(t, 0xffd23a, 0.9), [0, TWIN_PYLON_Y, -0.4], [0.2, 0.2, 0.2]);
  // BOLD PASS: wheel fenders, side cooling fins, a nose bumper rail
  for (const sx of [-1, 1]) {
    for (const sz of [-0.55, 0.55]) kb(b, M.dark(), [sx * 0.66, 0.74, sz], [0.3, 0.07, 0.56]);
    for (let i = 0; i < 3; i++) b.add(G.box(), M.black(), [sx * 0.45, 1.08, -0.15 - i * 0.14], [0.05, 0.28, 0.05]);
  }
  kb(b, M.dark(), [0, 0.32, 1.02], [1.2, 0.12, 0.12]);
  stack(b, stacks, 0.3, 0.9, -0.8, 0.05, 0.2, M.steel(), M.dark());
  b.flush();
  base.flush();
  return { root, height: 2.1, stacks, front: 1.0 };
}

/** THE WHITEOUT's STORM HEART (PROTOCOL C finale): a tall jagged ice crystal (self-lit, cold blue) turning slowly over a
 *  cracked dark-ice plinth ringed with shards (the paint: it flashes on hits), two glowing halo bands (the glow: the
 *  director pulses it with the beam to the giant). The beam leaves its tip at STORMHEART_TIP_Y. */
export const STORMHEART_TIP_Y = 4.1;
function stormheart(): Tpl {
  const t: EnemyType = 'stormheart';
  const root = new THREE.Group();
  const base = new Part(root);
  const plinth = mat('paint_stormheart', 0x41587a, { roughness: 0.4, metalness: 0.15 }, 'paint');
  const shard = mat('stormheartShard', 0x9fd4f2, { roughness: 0.2, metalness: 0.1, emissive: 0x2a6aa8, emissiveIntensity: 0.6 });
  base.add(G.cyl(7), plinth, [0, 0.22, 0], [1.25, 0.44, 1.25]);
  base.add(G.taper(0.7, 7), plinth, [0, 0.62, 0], [0.95, 0.4, 0.95], [0, 0.3, 0]);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * PI * 2 + 0.4;
    const r = 1.05 + (i % 3) * 0.12;
    base.add(G.oct(), shard, [Math.sin(a) * r, 0.42, Math.cos(a) * r], [0.2, 0.5 + (i % 2) * 0.25, 0.2], [Math.cos(a) * 0.5, a, -Math.sin(a) * 0.5]);
  }
  base.flush();
  const { b } = sub(root, 'spinY', [0, 0, 0], { dir: 1 });
  const ice = mat('stormheartIce', 0xd8f4ff, { roughness: 0.12, metalness: 0.05, emissive: 0x4aa8ff, emissiveIntensity: 0.85 });
  b.add(G.oct(), ice, [0, 2.45, 0], [0.62, 1.65, 0.62]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2;
    b.add(G.oct(), ice, [Math.sin(a) * 0.5, 1.75, Math.cos(a) * 0.5], [0.26, 0.85, 0.26], [Math.cos(a) * 0.45, 0, -Math.sin(a) * 0.45]);
  }
  const halo = glowMat(t, 0x7fdcff, 1.4);
  b.add(G.torus(), halo, [0, 2.2, 0], [0.95, 0.95, 0.95], [PI / 2 - 0.25, 0, 0]);
  b.add(G.torus(), halo, [0, 2.9, 0], [0.7, 0.7, 0.7], [PI / 2 + 0.3, 0, 0.2]);
  b.flush();
  return { root, height: 3.9, stacks: [], front: 1.2 };
}

/** THE WHITEOUT's EYE as a bot: no mesh of its own (the giant draws the eye: world/protocol/WhiteoutGiant.ts). */
function whiteoutEye(): Tpl {
  return { root: new THREE.Group(), height: 4.5, stacks: [], front: 3.4 };
}

/** Slushlings are scrappers shrunk to this scale (their radius is ~0.65 of a scrapper's). */
const SLUSHLING_SCALE = 0.64;
function slushling(): Tpl {
  const tpl = scrapper('slushling');
  tpl.root.scale.setScalar(SLUSHLING_SCALE);
  for (let i = 0; i < tpl.stacks.length; i++) tpl.stacks[i] *= SLUSHLING_SCALE;
  return { root: tpl.root, height: tpl.height * SLUSHLING_SCALE, stacks: tpl.stacks, front: tpl.front * SLUSHLING_SCALE };
}

const BUILDERS: Record<EnemyType, () => Tpl> = {
  scrapper: () => scrapper(),
  brute,
  spinner,
  thief,
  rallybot: () => scrapper('rallybot'),
  donald,
  chairman,
  stormheart,
  whiteout: whiteoutEye,
  bulldoza,
  frostbyte,
  grinder,
  slush: () => twin('slush'),
  sleet: () => twin('sleet'),
  omega,
  gunner,
  bulwark,
  slushpile,
  slushling,
  mirror,
  magnet,
  twinlink,
  rival: () => scrapper(), // Brawl rivals use their own models (src/brawl); placeholder for exhaustiveness
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
          copyWear(m, c);
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
