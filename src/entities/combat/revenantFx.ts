import * as THREE from 'three';
import { REV_BRIGHT, REV_CORE, REV_DEEP, REV_EDGE } from '../vehicles/revenant';
import { currentPreset } from '../../core/settings';

/* REVENANT ability visuals (pooled; nothing allocated per frame). Every effect is a solid, normal-blended violet layer
 * with a dark edge (it has to read on sunlit snow AND at night), with an additive bright line only on top:
 *   - ClawMarks: the REAP, parallel spectral claw gouges torn across the 140 deg arc (big Reap: two crossing sets);
 *   - Chains: wavy ghost chains (instanced links, drawn immediate-mode each frame): Haunt tethers and SOUL GRASP;
 *   - HauntMarks: the pale overlay shell + floating skull wisp over a Haunted bot (immediate mode);
 *   - PhantomMeshes: the hooded ghost a Haunted wreck rises as;
 *   - GhostTrail: THE WILD HUNT's spectral trail (one long glowing ribbon through the rider points, skull wisps
 *     drifting in it; it coils into the hearse and bursts with the finale);
 *   - HuntDome: the arena tint while the Hunt rides. */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
/** Quarter turn about the chain axis (alternate links). */
const _qTurn = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0));

const vMat = (color: number, opacity: number, additive = false) =>
  new THREE.MeshBasicMaterial({ color, vertexColors: true, transparent: true, opacity, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });

/* ------------------------------------------------------------------ REAP: claw marks */

/** Gouges per claw mark: radius share, width share of the reach, and the share of the sweep each runs over (the
 *  talons bite in and lift out a little apart). */
const GOUGES = [
  { r: 0.985, w: 0.03, a: 0.04, b: 0.93 },
  { r: 0.895, w: 0.036, a: 0.0, b: 1.0 },
  { r: 0.805, w: 0.033, a: 0.02, b: 0.97 },
  { r: 0.72, w: 0.026, a: 0.08, b: 0.9 },
];
const MARK_SEG = 44;
/** Claw-mark timing (s): the gouges tear across the arc (with the claw's strike), hold, then fade. */
const MARK_IN0 = 0.045;
const MARK_IN1 = 0.19;
const MARK_HOLD = 0.27;

/** Parallel claw gouges (radius 1, flat in XZ, centred on +Z, the 140 deg arc) torn from +X across to -X: vertices
 *  are ordered along the sweep so a draw range reveals them as the claw rakes. `wide`: width multiplier (the dark
 *  edge is wide, the hot core thin). Vertex alpha fades each gouge in and out at its ends. */
function gougeGeometry(wide: number, arc: number): THREE.BufferGeometry {
  const ng = GOUGES.length;
  const nv = (MARK_SEG + 1) * ng * 2;
  const pos = new Float32Array(nv * 3);
  const col = new Float32Array(nv * 4);
  for (let j = 0; j <= MARK_SEG; j++) {
    const u = j / MARK_SEG;
    const phi = arc / 2 - u * arc;
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    for (let i = 0; i < ng; i++) {
      const G = GOUGES[i];
      const v = (u - G.a) / (G.b - G.a);
      const env = v <= 0 || v >= 1 ? 0 : Math.sin(Math.PI * v);
      // a gouge: thin where the talon bites in, deepest just past the middle, tearing out thin
      const w = G.w * wide * env ** 0.6 * (0.85 + 0.3 * v) * 0.5;
      const r = G.r + 0.008 * Math.sin(u * 9 + i * 2.3);
      const q = ((j * ng + i) * 2) | 0;
      pos.set([sp * (r + w), 0, cp * (r + w), sp * (r - w), 0, cp * (r - w)], q * 3);
      const a = Math.min(1, env * 1.8);
      col.set([1, 1, 1, a, 1, 1, 1, a], q * 4);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < MARK_SEG; j++)
    for (let i = 0; i < ng; i++) {
      const a = (j * ng + i) * 2;
      const b = ((j + 1) * ng + i) * 2;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.setIndex(idx);
  return g;
}

interface Mark { root: THREE.Group; geos: THREE.BufferGeometry[]; mats: THREE.MeshBasicMaterial[]; t: number; dur: number; big: boolean }

/** REAP claw marks: four parallel spectral gouges (dark edge, violet body, hot additive core) torn across the arc
 *  ahead, in the direction the wraith claw rakes; they show the Reap's reach and arc. A big Reap tears two crossing
 *  sets, one from each side. */
export class ClawMarks {
  private marks: Mark[] = [];
  /** The arc (rad) the geometry spans (combat/revenant.ts REAP_HALF x 2). */
  static readonly ARC = (140 * Math.PI) / 180;
  private static readonly PEAK = [0.72, 0.9, 1];

  constructor(scene: THREE.Scene, n = 6) {
    for (let k = 0; k < n; k++) {
      const root = new THREE.Group();
      const geos = [gougeGeometry(2.3, ClawMarks.ARC), gougeGeometry(1, ClawMarks.ARC), gougeGeometry(0.32, ClawMarks.ARC)];
      const mats = [vMat(REV_EDGE, 0.72), vMat(REV_CORE, 0.9), vMat(REV_BRIGHT, 1, true)];
      for (let l = 0; l < 3; l++) {
        const m = new THREE.Mesh(geos[l], mats[l]);
        m.position.y = l * 0.03;
        m.renderOrder = 2 + l;
        m.frustumCulled = false;
        root.add(m);
      }
      root.visible = false;
      scene.add(root);
      this.marks.push({ root, geos, mats, t: 0, dur: 0.5, big: false });
    }
  }

  private take(): Mark {
    let a = this.marks.find((v) => !v.root.visible);
    if (!a) a = this.marks.reduce((p, q) => (p.t / p.dur > q.t / q.dur ? p : q));
    return a;
  }

  private start(m: Mark, x: number, y: number, z: number, heading: number, range: number, side: number, big: boolean): void {
    m.t = 0;
    m.dur = big ? 0.55 : 0.46;
    m.big = big;
    m.root.position.set(x, y, z);
    m.root.rotation.set(0, heading, 0);
    m.root.scale.set(range * side, 1, range);
    m.root.visible = true;
    this.step(m, 0);
  }

  /** Claw marks centred on `heading` at (x, y, z), out to `range` m, torn from the `side` (+1 = the plow's left, +X)
   *  across to the other; `big` = the third-sweep Reap (both claws: a second set from the other side). */
  spawn(x: number, y: number, z: number, heading: number, range: number, side: number, big: boolean): void {
    this.start(this.take(), x, y, z, heading, range, side, big);
    if (big) this.start(this.take(), x, y + 0.08, z, heading, range * 0.955, -side, big);
  }

  private step(m: Mark, dt: number): void {
    m.t += dt;
    const k = m.t / m.dur;
    if (k >= 1) {
      m.root.visible = false;
      return;
    }
    // Tear across with the claw's strike (fast in, easing out), hold, then fade.
    const x = Math.max(0, Math.min(1, (m.t - MARK_IN0) / (MARK_IN1 - MARK_IN0)));
    const rev = 1 - (1 - x) ** 2.4;
    const segs = Math.ceil(rev * MARK_SEG);
    const count = segs * GOUGES.length * 6;
    for (const g of m.geos) g.setDrawRange(0, count);
    const fade = m.t < MARK_HOLD ? 1 : (1 - (m.t - MARK_HOLD) / (m.dur - MARK_HOLD)) ** 1.3;
    for (let i = 0; i < m.mats.length; i++) m.mats[i].opacity = ClawMarks.PEAK[i] * fade * (m.big ? 1 : 0.92);
  }

  update(dt: number): void {
    for (const m of this.marks) if (m.root.visible) this.step(m, dt);
  }

  clear(): void {
    for (const m of this.marks) m.root.visible = false;
  }
}

/* ------------------------------------------------------------------ chains */

/** Wavy ghost chains: instanced links (a dark outer link round a violet core), drawn immediate-mode: begin(), add()
 *  every chain this frame, end(). */
export class Chains {
  private core: THREE.InstancedMesh;
  private edge: THREE.InstancedMesh;
  private n = 0;
  private readonly max: number;

  constructor(scene: THREE.Scene, max = 220) {
    this.max = max;
    const link = new THREE.TorusGeometry(0.16, 0.05, 4, 8);
    const coreMat = new THREE.MeshBasicMaterial({ color: REV_CORE, toneMapped: false, transparent: true, opacity: 0.95, depthWrite: false });
    const edgeMat = new THREE.MeshBasicMaterial({ color: REV_EDGE, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.BackSide });
    this.core = new THREE.InstancedMesh(link, coreMat, max);
    this.edge = new THREE.InstancedMesh(link, edgeMat, max);
    this.edge.instanceMatrix = this.core.instanceMatrix;
    for (const m of [this.core, this.edge]) {
      m.count = 0;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
    this.edge.renderOrder = 2;
    this.core.renderOrder = 3;
  }

  begin(): void {
    this.n = 0;
  }

  /** One chain from `from` to `to`: links every ~0.42 m on a sine wave of amplitude `wave` (phase `t`), link scale
   *  `thick`. Links past the pool are dropped. */
  add(from: THREE.Vector3, to: THREE.Vector3, t: number, wave = 0.35, thick = 1): void {
    _a.subVectors(to, from);
    const len = _a.length();
    if (len < 0.3) return;
    _a.divideScalar(len);
    // A side axis for the wave (horizontal, across the chain), then up for a second, slower wobble.
    _b.crossVectors(_a, _up);
    if (_b.lengthSq() < 1e-4) _b.set(1, 0, 0);
    _b.normalize();
    const links = Math.min(40, Math.ceil(len / 0.42));
    for (let i = 0; i <= links && this.n < this.max; i++) {
      const u = i / links;
      const env = Math.sin(u * Math.PI);
      const w = Math.sin(u * 9 - t * 7) * wave * env;
      const h = Math.sin(u * 5 - t * 4.3) * wave * 0.6 * env;
      _p.copy(from).addScaledVector(_a, len * u).addScaledVector(_b, w);
      _p.y += h;
      // Alternate links turn 90 deg about the chain, like real chain.
      _q.setFromUnitVectors(_up, _a);
      if (i & 1) _q.multiply(_qTurn);
      _s.setScalar(thick);
      _m.compose(_p, _q, _s);
      this.core.setMatrixAt(this.n++, _m);
    }
  }

  end(): void {
    this.core.count = this.edge.count = this.n;
    if (this.n) this.core.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.n = 0;
    this.end();
  }
}

/* ------------------------------------------------------------------ haunt marks */

let skullTex: THREE.CanvasTexture | null | undefined;
/** A small skull wisp (white-violet with dark sockets, a fading flame tail; canvas, cached; null headless). */
function skull(): THREE.CanvasTexture | null {
  if (skullTex !== undefined) return skullTex;
  if (typeof document === 'undefined') return (skullTex = null);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  // flame tail
  const grd = g.createLinearGradient(0, 64, 0, 18);
  grd.addColorStop(0, 'rgba(176,77,255,0)');
  grd.addColorStop(1, 'rgba(176,77,255,0.85)');
  g.fillStyle = grd;
  g.beginPath();
  g.moveTo(18, 34);
  g.quadraticCurveTo(32, 70, 46, 34);
  g.fill();
  // dark rim, bone skull
  g.fillStyle = '#1a0630';
  g.beginPath();
  g.arc(32, 26, 17, 0, Math.PI * 2);
  g.fill();
  g.fillRect(22, 30, 20, 14);
  g.fillStyle = '#f2e8ff';
  g.beginPath();
  g.arc(32, 26, 14, 0, Math.PI * 2);
  g.fill();
  g.fillRect(24, 32, 16, 10);
  g.fillStyle = '#1a0630';
  for (const ex of [26, 38]) {
    g.beginPath();
    g.arc(ex, 26, 4.2, 0, Math.PI * 2);
    g.fill();
  }
  g.beginPath();
  g.moveTo(32, 30);
  g.lineTo(29.5, 35);
  g.lineTo(34.5, 35);
  g.fill();
  for (const tx of [27, 31, 35]) g.fillRect(tx, 38, 2, 4);
  skullTex = new THREE.CanvasTexture(c);
  skullTex.colorSpace = THREE.SRGBColorSpace;
  return skullTex;
}

/** Pale Haunt overlay (a translucent violet shell with a dark back-face rim) + a skull wisp bobbing over the bot. */
export class HauntMarks {
  private shells: THREE.Mesh[] = [];
  private rims: THREE.Mesh[] = [];
  private skulls: THREE.Sprite[] = [];
  private n = 0;

  constructor(scene: THREE.Scene, max = 12) {
    const sph = new THREE.SphereGeometry(1, 16, 10);
    const shellMat = new THREE.MeshBasicMaterial({ color: 0xd9c4ff, transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false });
    const rimMat = new THREE.MeshBasicMaterial({ color: REV_DEEP, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.BackSide });
    const tex = skull();
    const skullMat = new THREE.SpriteMaterial({ map: tex, color: tex ? 0xffffff : REV_BRIGHT, transparent: true, depthWrite: false, toneMapped: false });
    for (let i = 0; i < max; i++) {
      const s = new THREE.Mesh(sph, shellMat);
      const r = new THREE.Mesh(sph, rimMat);
      const k = new THREE.Sprite(skullMat);
      s.renderOrder = 3;
      r.renderOrder = 2;
      k.renderOrder = 5;
      for (const o of [s, r, k]) {
        o.visible = false;
        o.frustumCulled = false;
        scene.add(o);
      }
      this.shells.push(s);
      this.rims.push(r);
      this.skulls.push(k);
    }
  }

  begin(): void {
    this.n = 0;
  }

  /** Mark one Haunted bot (feet at `pos`, collision radius `r`); `left` 0..1 of its Haunt still to run, `t` clock. */
  add(pos: THREE.Vector3, r: number, left: number, t: number): void {
    if (this.n >= this.shells.length) return;
    const i = this.n++;
    const s = this.shells[i];
    const rim = this.rims[i];
    const k = this.skulls[i];
    const pulse = 1 + 0.05 * Math.sin(t * 6 + i);
    s.visible = rim.visible = k.visible = true;
    s.position.set(pos.x, pos.y + r * 0.9, pos.z);
    s.scale.set(r * 1.25 * pulse, r * 1.05 * pulse, r * 1.25 * pulse);
    rim.position.copy(s.position);
    rim.scale.copy(s.scale).multiplyScalar(1.08);
    const sz = 0.9 + r * 0.25;
    k.position.set(pos.x, pos.y + r * 2 + 0.9 + 0.18 * Math.sin(t * 3 + i * 1.3), pos.z);
    k.scale.set(sz, sz, 1);
    (k.material as THREE.SpriteMaterial).opacity = 1;
    // Fade the overlay out as the Haunt runs down (shared materials: keep the last bot's alpha, close enough).
    (s.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.16 * Math.min(1, left * 2);
  }

  end(): void {
    for (let i = this.n; i < this.shells.length; i++) {
      if (!this.shells[i].visible) break;
      this.shells[i].visible = this.rims[i].visible = this.skulls[i].visible = false;
    }
  }

  clear(): void {
    this.n = 0;
    for (let i = 0; i < this.shells.length; i++) this.shells[i].visible = this.rims[i].visible = this.skulls[i].visible = false;
  }
}

/* ------------------------------------------------------------------ phantoms */

/** A hooded ghost (head + flowing body + hollow eyes), translucent violet over a dark rim. */
export class PhantomMeshes {
  readonly roots: THREE.Group[] = [];
  readonly fills: THREE.MeshBasicMaterial[] = [];

  constructor(scene: THREE.Scene, n = 4) {
    const head = new THREE.SphereGeometry(0.55, 14, 10);
    const body = new THREE.ConeGeometry(0.7, 1.7, 14, 1, true);
    body.translate(0, -0.55, 0);
    body.rotateX(Math.PI);
    body.translate(0, -0.6, 0);
    const eye = new THREE.SphereGeometry(0.11, 6, 4);
    const rimMat = new THREE.MeshBasicMaterial({ color: REV_EDGE, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.BackSide });
    const eyeMat = new THREE.MeshBasicMaterial({ color: REV_EDGE });
    for (let i = 0; i < n; i++) {
      const fill = new THREE.MeshBasicMaterial({ color: 0xcfb0ff, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      const root = new THREE.Group();
      const h = new THREE.Mesh(head, fill);
      const b = new THREE.Mesh(body, fill);
      const hr = new THREE.Mesh(head, rimMat);
      hr.scale.setScalar(1.1);
      const br = new THREE.Mesh(body, rimMat);
      br.scale.setScalar(1.08);
      const g = new THREE.Group();
      g.position.y = 1.6;
      g.add(hr, br, h, b);
      for (const sx of [-1, 1]) {
        const e = new THREE.Mesh(eye, eyeMat);
        e.position.set(sx * 0.2, 0.06, 0.48);
        g.add(e);
      }
      root.add(g);
      root.visible = false;
      root.traverse((o) => {
        o.frustumCulled = false;
        if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).renderOrder = 3;
      });
      scene.add(root);
      this.roots.push(root);
      this.fills.push(fill);
    }
  }

  clear(): void {
    for (const r of this.roots) r.visible = false;
  }
}

/* ------------------------------------------------------------------ Wild Hunt ghost trail */

/** THE WILD HUNT's spectral trail: ONE long glowing ribbon flowing back along the hearse's path through every rider
 *  point (the trample sample points, so it grows with the souls banked), made of two crossed soft-edged sheets (a
 *  standing one and a flat one: it reads from the chase camera above AND from the kill-cam beside it), violet at the
 *  edges and white-hot down the middle, drawn twice (a normal-blended body that reads on sunlit snow, an additive glow
 *  over it). Skull wisps drift back through it, flickering; at the end it coils into the hearse and the skulls burst
 *  out with the eruption. Camera-near fade: within CAM_FADE_IN m of the camera the trail fades out (fully drawn from
 *  CAM_FADE_OUT m). Pooled: buffers sized once for the longest trail; nothing allocated per frame. */
const CAM_FADE_IN = 2.5;
const CAM_FADE_OUT = 6.5;
/** Ribbon columns per rider gap (LOW quality: TRAIL_SUB_LOW). */
const TRAIL_SUB = 5;
const TRAIL_SUB_LOW = 3;
/** Sheet half-width (flat) and half-height (standing), m; centre height over the ground (m). */
const TRAIL_W = 2.1;
const TRAIL_H = 1.25;
const TRAIL_Y = 1.35;
/** Peak opacities: body, additive glow, skull wisps. */
const TRAIL_BODY = 0.72;
const TRAIL_GLOW = 0.3;
const TRAIL_SKULL = 0.95;
/** Skull wisps drift back along the trail at this share of its length a second; the burst flies this long (s). */
const SKULL_DRIFT = 0.07;
const BURST_SEC = 1;
/** Edge / middle colours of the sheets (linear RGB 0..1). */
const EDGE_RGB = [0.36, 0.1, 0.78];
const MID_RGB = [0.82, 0.62, 1];

interface Skull {
  s: THREE.Sprite;
  mat: THREE.SpriteMaterial;
  seed: number;
  vx: number;
  vy: number;
  vz: number;
}

export class GhostTrail {
  /** The viewer (the trail fades out near it); null: no fade. */
  camera: THREE.Camera | null = null;
  private readonly maxPts: number;
  private readonly cols: number;
  /** Control points (x, y, z, alpha): 0 = the hearse's tail, i + 1 = rider i. */
  private readonly pts: Float32Array;
  /** Column scratch: centre (x, y, z) and alpha. */
  private readonly cx: Float32Array;
  private readonly cy: Float32Array;
  private readonly cz: Float32Array;
  private readonly ca: Float32Array;
  private readonly pos: THREE.BufferAttribute;
  private readonly col: THREE.BufferAttribute;
  private readonly geo = new THREE.BufferGeometry();
  private readonly body: THREE.Mesh;
  private readonly glow: THREE.Mesh;
  private readonly bodyMat: THREE.MeshBasicMaterial;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly skulls: Skull[] = [];
  private clock = 0;
  /** Burst: seconds since the eruption (-1 = none) and its centre. */
  private burstT = -1;

  constructor(scene: THREE.Scene, riders: number) {
    this.maxPts = riders + 1;
    this.cols = (this.maxPts - 1) * TRAIL_SUB + 1;
    this.pts = new Float32Array(this.maxPts * 4);
    this.cx = new Float32Array(this.cols);
    this.cy = new Float32Array(this.cols);
    this.cz = new Float32Array(this.cols);
    this.ca = new Float32Array(this.cols);
    // Six vertices a column: the standing sheet (bottom, middle, top) and the flat one (left, middle, right).
    this.pos = new THREE.BufferAttribute(new Float32Array(this.cols * 6 * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(this.cols * 6 * 4), 4);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.col.setUsage(THREE.DynamicDrawUsage);
    const idx: number[] = [];
    for (let j = 0; j < this.cols - 1; j++) {
      for (const s of [0, 3]) {
        for (let r = 0; r < 2; r++) {
          const a = j * 6 + s + r;
          const b = a + 6;
          idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    this.geo.setAttribute('position', this.pos);
    this.geo.setAttribute('color', this.col);
    this.geo.setIndex(idx);
    this.geo.setDrawRange(0, 0);
    this.bodyMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: TRAIL_BODY, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0xd8b8ff, vertexColors: true, transparent: true, opacity: TRAIL_GLOW, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.body = new THREE.Mesh(this.geo, this.bodyMat);
    this.glow = new THREE.Mesh(this.geo, this.glowMat);
    this.body.renderOrder = 3;
    this.glow.renderOrder = 4;
    this.body.frustumCulled = this.glow.frustumCulled = false;
    this.body.visible = this.glow.visible = false;
    scene.add(this.body, this.glow);
    const map = skull();
    for (let i = 0; i < riders; i++) {
      const mat = new THREE.SpriteMaterial({ map, color: 0xf0e0ff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      const s = new THREE.Sprite(mat);
      s.renderOrder = 6;
      s.frustumCulled = false;
      s.visible = false;
      scene.add(s);
      this.skulls.push({ s, mat, seed: (i * 0.618034) % 1, vx: 0, vy: 0, vz: 0 });
    }
  }

  /** Control point i (0 = the hearse's tail, i = rider i - 1) at (x, y = ground, z) with fade `alpha` 0..1. */
  point(i: number, x: number, y: number, z: number, alpha: number): void {
    const o = i * 4;
    this.pts[o] = x;
    this.pts[o + 1] = y;
    this.pts[o + 2] = z;
    this.pts[o + 3] = alpha;
  }

  /** Build the trail through points 0..n-1 (n >= 2), at overall strength k 0..1 and `lift` m extra height (the coil
   *  rising into the eruption). */
  build(n: number, k: number, lift = 0): void {
    n = Math.min(n, this.maxPts);
    if (n < 2 || k <= 0.001) {
      this.body.visible = this.glow.visible = false;
      for (const sk of this.skulls) sk.s.visible = false;
      return;
    }
    const low = currentPreset().fxScale < 1;
    const sub = low ? TRAIL_SUB_LOW : TRAIL_SUB;
    const cols = (n - 1) * sub + 1;
    const P = this.pts;
    // Catmull-Rom through the control points.
    for (let j = 0; j < cols; j++) {
      const seg = Math.min(n - 2, Math.floor(j / sub));
      const f = j / sub - seg;
      const i0 = Math.max(0, seg - 1) * 4;
      const i1 = seg * 4;
      const i2 = (seg + 1) * 4;
      const i3 = Math.min(n - 1, seg + 2) * 4;
      const f2 = f * f;
      const f3 = f2 * f;
      const w0 = -0.5 * f3 + f2 - 0.5 * f;
      const w1 = 1.5 * f3 - 2.5 * f2 + 1;
      const w2 = -1.5 * f3 + 2 * f2 + 0.5 * f;
      const w3 = 0.5 * f3 - 0.5 * f2;
      this.cx[j] = P[i0] * w0 + P[i1] * w1 + P[i2] * w2 + P[i3] * w3;
      this.cy[j] = P[i1 + 1] + (P[i2 + 1] - P[i1 + 1]) * f;
      this.cz[j] = P[i0 + 2] * w0 + P[i1 + 2] * w1 + P[i2 + 2] * w2 + P[i3 + 2] * w3;
      this.ca[j] = P[i1 + 3] + (P[i2 + 3] - P[i1 + 3]) * f;
    }
    const pos = this.pos.array as Float32Array;
    const col = this.col.array as Float32Array;
    const cam = this.camera;
    const t = this.clock;
    const thick = 1 + 0.025 * (n - 1);
    for (let j = 0; j < cols; j++) {
      const u = j / (cols - 1);
      const jp = Math.max(0, j - 1);
      const jn = Math.min(cols - 1, j + 1);
      let tx = this.cx[jn] - this.cx[jp];
      let tz = this.cz[jn] - this.cz[jp];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      // Taper: a slim neck off the hearse's tail, full in the body, wisping out to nothing at the end.
      const neck = 0.35 + 0.65 * Math.min(1, u * 9);
      const tail = (1 - u) ** 0.55;
      const flow = 1 + 0.28 * Math.sin(t * 5.2 - u * 22) * Math.sin(t * 2.1 - u * 9 + 1);
      const w = TRAIL_W * thick * neck * (0.25 + 0.75 * tail) * flow;
      const hh = TRAIL_H * thick * neck * (0.3 + 0.7 * tail) * (2 - flow);
      const x = this.cx[j] + tz * Math.sin(t * 3.1 - u * 15) * 0.35;
      const z = this.cz[j] - tx * Math.sin(t * 3.1 - u * 15) * 0.35;
      const y = this.cy[j] + TRAIL_Y + lift * (0.4 + 0.6 * u) + 0.32 * Math.sin(t * 3.7 - u * 17);
      let a = this.ca[j] * k * tail ** 0.6 * Math.min(1, u * 14 + 0.25);
      if (cam) {
        const d = Math.hypot(cam.position.x - x, cam.position.y - y, cam.position.z - z);
        a *= Math.min(1, Math.max(0, (d - CAM_FADE_IN) / (CAM_FADE_OUT - CAM_FADE_IN)));
      }
      // A flicker running down the trail.
      a *= 0.82 + 0.18 * Math.sin(t * 19 - u * 40);
      const o = j * 18;
      pos[o] = x; pos[o + 1] = y - hh; pos[o + 2] = z;
      pos[o + 3] = x; pos[o + 4] = y; pos[o + 5] = z;
      pos[o + 6] = x; pos[o + 7] = y + hh; pos[o + 8] = z;
      pos[o + 9] = x + tz * w; pos[o + 10] = y - 0.15; pos[o + 11] = z - tx * w;
      pos[o + 12] = x; pos[o + 13] = y; pos[o + 14] = z;
      pos[o + 15] = x - tz * w; pos[o + 16] = y - 0.15; pos[o + 17] = z + tx * w;
      const c = j * 24;
      // Middle brighter toward the head (white-hot), violet down the tail.
      const hot = 1 - 0.45 * u;
      for (let v = 0; v < 6; v++) {
        const mid = v === 1 || v === 4;
        const q = c + v * 4;
        if (mid) {
          col[q] = EDGE_RGB[0] + (MID_RGB[0] - EDGE_RGB[0]) * hot;
          col[q + 1] = EDGE_RGB[1] + (MID_RGB[1] - EDGE_RGB[1]) * hot;
          col[q + 2] = EDGE_RGB[2] + (MID_RGB[2] - EDGE_RGB[2]) * hot;
          col[q + 3] = a;
        } else {
          col[q] = EDGE_RGB[0];
          col[q + 1] = EDGE_RGB[1];
          col[q + 2] = EDGE_RGB[2];
          col[q + 3] = 0;
        }
      }
      this.ca[j] = a;
    }
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
    this.pos.clearUpdateRanges();
    this.col.clearUpdateRanges();
    this.pos.addUpdateRange(0, cols * 18);
    this.col.addUpdateRange(0, cols * 24);
    this.geo.setDrawRange(0, (cols - 1) * 24);
    this.body.visible = this.glow.visible = true;
    // Skull wisps: one a rider (LOW: every other), drifting back through the trail, flickering.
    const nSk = Math.min(this.skulls.length, n - 1);
    for (let i = 0; i < this.skulls.length; i++) {
      const sk = this.skulls[i];
      if (i >= nSk || (low && i % 2)) {
        sk.s.visible = false;
        continue;
      }
      const u = (sk.seed + t * SKULL_DRIFT) % 1;
      const fj = u * (cols - 1);
      const j = Math.floor(fj);
      const jn = Math.min(cols - 1, j + 1);
      const f = fj - j;
      const a = (this.ca[j] + (this.ca[jn] - this.ca[j]) * f) * Math.sin(Math.PI * u);
      const fl = Math.max(0, Math.sin(t * 11 + i * 2.3) * 0.5 + 0.5) ** 0.6 * (0.7 + 0.3 * Math.sin(t * 29 + i));
      const op = TRAIL_SKULL * a * fl;
      sk.s.visible = op > 0.02;
      if (!sk.s.visible) continue;
      const ph = t * 2.3 + i * 1.9;
      sk.s.position.set(
        this.cx[j] + (this.cx[jn] - this.cx[j]) * f + Math.sin(ph) * 0.8,
        this.cy[j] + TRAIL_Y + lift * 0.6 + 0.25 + Math.sin(ph * 1.3) * 0.45,
        this.cz[j] + (this.cz[jn] - this.cz[j]) * f + Math.cos(ph) * 0.8,
      );
      const sc = (1.5 + 0.7 * ((i * 0.37) % 1)) * (0.85 + 0.15 * fl);
      sk.s.scale.set(sc, sc, 1);
      sk.mat.opacity = op;
    }
  }

  /** The eruption at (x, y, z): the ribbon is spent and every skull wisp bursts outward from the hearse. */
  burst(x: number, y: number, z: number): void {
    this.body.visible = this.glow.visible = false;
    this.burstT = 0;
    const low = currentPreset().fxScale < 1;
    for (let i = 0; i < this.skulls.length; i++) {
      const sk = this.skulls[i];
      if (low && i % 2) {
        sk.s.visible = false;
        continue;
      }
      const a = (i / this.skulls.length) * Math.PI * 2 + Math.random() * 0.3;
      const sp = 9 + Math.random() * 7;
      sk.vx = Math.sin(a) * sp;
      sk.vz = Math.cos(a) * sp;
      sk.vy = 5 + Math.random() * 6;
      sk.s.position.set(x + Math.sin(a) * 1.2, y + 1.6 + Math.random(), z + Math.cos(a) * 1.2);
      sk.s.visible = true;
    }
  }

  /** Advance the flow clock and any burst (once a frame). */
  update(dt: number): void {
    this.clock += dt;
    if (this.burstT < 0) return;
    this.burstT += dt;
    const u = this.burstT / BURST_SEC;
    if (u >= 1) {
      this.burstT = -1;
      for (const sk of this.skulls) sk.s.visible = false;
      return;
    }
    const drag = Math.exp(-dt * 2.2);
    for (let i = 0; i < this.skulls.length; i++) {
      const sk = this.skulls[i];
      if (!sk.s.visible) continue;
      sk.vx *= drag;
      sk.vz *= drag;
      sk.vy = sk.vy * drag + dt * 2;
      sk.s.position.x += sk.vx * dt;
      sk.s.position.y += sk.vy * dt;
      sk.s.position.z += sk.vz * dt;
      const sc = 1.6 + 1.6 * u;
      sk.s.scale.set(sc, sc, 1);
      sk.mat.opacity = TRAIL_SKULL * (1 - u) ** 1.3 * (0.75 + 0.25 * Math.sin(this.clock * 31 + i));
    }
  }

  clear(): void {
    this.burstT = -1;
    this.body.visible = this.glow.visible = false;
    this.geo.setDrawRange(0, 0);
    for (const sk of this.skulls) sk.s.visible = false;
  }
}

/* ------------------------------------------------------------------ Hunt dome */

/** The darkening while THE WILD HUNT rides: a huge back-faced sphere drawn first among the transparents with no depth
 *  test (it tints the whole opaque scene; the riders and effects draw over it), plus the scene fog pulled in and
 *  tinted. Restores the fog on release. */
/** Peak darkening of the Hunt dome. */
const DOME_DARK = 0.28;

export class HuntDome {
  private mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private saved: { color: THREE.Color; near: number; far: number } | null = null;
  private readonly purple = new THREE.Color(0x2a1240);

  constructor(private scene: THREE.Scene) {
    this.mat = new THREE.MeshBasicMaterial({ color: REV_EDGE, transparent: true, opacity: 0, depthWrite: false, depthTest: false, side: THREE.BackSide, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 16, 10), this.mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** k 0..1 strength around (x, z). */
  set(k: number, x: number, z: number): void {
    const fog = this.scene.fog as THREE.Fog | null;
    if (k <= 0.001) {
      this.release();
      return;
    }
    this.mesh.visible = true;
    this.mesh.position.set(x, 0, z);
    // Light enough that the riders (bright violet) still pop against the darkened arena.
    this.mat.opacity = DOME_DARK * k;
    if (fog && (fog as THREE.Fog).isFog) {
      if (!this.saved) this.saved = { color: fog.color.clone(), near: fog.near, far: fog.far };
      fog.color.copy(this.saved.color).lerp(this.purple, 0.55 * k);
      fog.near = this.saved.near * (1 - 0.45 * k);
      fog.far = this.saved.far * (1 - 0.3 * k);
    }
  }

  release(): void {
    this.mesh.visible = false;
    this.mat.opacity = 0;
    const fog = this.scene.fog as THREE.Fog | null;
    if (this.saved && fog && (fog as THREE.Fog).isFog) {
      fog.color.copy(this.saved.color);
      fog.near = this.saved.near;
      fog.far = this.saved.far;
    }
    this.saved = null;
  }
}
