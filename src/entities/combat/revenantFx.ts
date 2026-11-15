import * as THREE from 'three';
import { REV_BONE, REV_BRIGHT, REV_CORE, REV_DEEP, REV_EDGE, revenantHullGeometry } from '../vehicles/revenant';
import { addMat, paintMat } from './arsenalFx';

/* REVENANT ability visuals (pooled; nothing allocated per frame). Every effect is a solid, normal-blended violet layer
 * with a dark edge (it has to read on sunlit snow AND at night), with an additive bright line only on top:
 *   - ScytheArcs: the REAP sweep, a crescent ribbon that wipes across the 140 deg arc (big Reap: wider, taller);
 *   - Chains: wavy ghost chains (instanced links, drawn immediate-mode each frame): Haunt tethers and SOUL GRASP;
 *   - HauntMarks: the pale overlay shell + floating skull wisp over a Haunted bot (immediate mode);
 *   - PhantomMeshes: the hooded ghost a Haunted wreck rises as;
 *   - RiderMeshes: THE WILD HUNT's phantom hearses (the REVENANT hull silhouette, translucent with a dark outline);
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

/** Ring sector (radius 1, flat in XZ, centred on +Z) whose vertex alpha rises along the sweep: the scythe's wake.
 *  `inner`: inner radius share. */
function sweepGeometry(inner: number, arc: number): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(inner, 1, 40, 1, Math.PI / 2 - arc / 2, arc);
  g.rotateX(-Math.PI / 2);
  // RingGeometry runs counter-clockwise from +X; after the rotation the angle is measured in XZ. Alpha rises toward the
  // leading edge (the end of the sweep), fading the trail.
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const ang = Math.atan2(-pos.getZ(i), pos.getX(i)); // the angle RingGeometry built it at
    const u = (ang - (Math.PI / 2 - arc / 2)) / arc; // 0 = start of the sector, 1 = end
    col.set([1, 1, 1, Math.max(0, Math.min(1, u)) ** 1.4], i * 4);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  // rotateX(-PI/2) left the sector centred on -Z (behind the plow); turn it to face +Z, the plow's forward. A pure
  // rotation, so the sweep direction and the alpha ramp are unchanged.
  g.rotateY(Math.PI);
  return g;
}

const vMat = (color: number, opacity: number, additive = false) =>
  new THREE.MeshBasicMaterial({ color, vertexColors: true, transparent: true, opacity, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });

/* ------------------------------------------------------------------ REAP: scythe arcs */

interface Arc { root: THREE.Group; mats: THREE.MeshBasicMaterial[]; t: number; dur: number; big: boolean; side: number; peak: number[] }

/** REAP sweeps: a crescent ribbon (dark edge, violet body, bright cutting line) that wipes across the arc ahead. */
export class ScytheArcs {
  private arcs: Arc[] = [];
  /** Sweep half angle (rad) the geometry is built for (the big Reap scales it up a little). */
  static readonly ARC = (140 * Math.PI) / 180;

  constructor(scene: THREE.Scene, n = 4) {
    const edgeGeo = sweepGeometry(0.62, ScytheArcs.ARC);
    const bodyGeo = sweepGeometry(0.7, ScytheArcs.ARC);
    const lineGeo = sweepGeometry(0.93, ScytheArcs.ARC);
    for (let i = 0; i < n; i++) {
      const root = new THREE.Group();
      const mats = [vMat(REV_EDGE, 0.75), vMat(REV_CORE, 0.85), vMat(REV_BRIGHT, 1, true)];
      const edge = new THREE.Mesh(edgeGeo, mats[0]);
      edge.scale.setScalar(1.04);
      const body = new THREE.Mesh(bodyGeo, mats[1]);
      body.position.y = 0.04;
      const line = new THREE.Mesh(lineGeo, mats[2]);
      line.position.y = 0.08;
      edge.renderOrder = 2;
      body.renderOrder = 3;
      line.renderOrder = 4;
      root.add(edge, body, line);
      root.visible = false;
      for (const c of root.children) c.frustumCulled = false;
      scene.add(root);
      this.arcs.push({ root, mats, t: 0, dur: 0.22, big: false, side: 1, peak: [0.75, 0.85, 1] });
    }
  }

  /** A sweep centred on `heading` at (x, y, z), out to `range` m, `side` +1 = sweeping right to left, -1 = left to
   *  right (mirrored), `big` = the third-swing Reap. */
  spawn(x: number, y: number, z: number, heading: number, range: number, side: number, big: boolean): void {
    let a = this.arcs.find((v) => !v.root.visible);
    if (!a) a = this.arcs.reduce((p, q) => (p.t / p.dur > q.t / q.dur ? p : q));
    a.t = 0;
    a.dur = big ? 0.32 : 0.22;
    a.big = big;
    a.side = side;
    a.root.position.set(x, y, z);
    a.root.rotation.set(0, heading, 0);
    a.root.scale.set(range * side * (big ? 1.06 : 1), big ? 1.6 : 1, range * (big ? 1.06 : 1));
    a.root.visible = true;
    this.update(0, a);
  }

  update(dt: number, only?: Arc): void {
    for (const a of only ? [only] : this.arcs) {
      if (!a.root.visible) continue;
      a.t += dt;
      const k = a.t / a.dur;
      if (k >= 1) {
        a.root.visible = false;
        continue;
      }
      // Wipe in fast, then fade; a slight extra turn sells the follow-through.
      const fade = k < 0.35 ? 1 : (1 - (k - 0.35) / 0.65) ** 1.5;
      for (let i = 0; i < a.mats.length; i++) a.mats[i].opacity = a.peak[i] * fade * (a.big ? 1 : 0.9);
      a.root.children[0].rotation.y = a.root.children[1].rotation.y = a.root.children[2].rotation.y = -0.25 * k;
    }
  }

  clear(): void {
    for (const a of this.arcs) a.root.visible = false;
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

/* ------------------------------------------------------------------ Wild Hunt riders */

/** Phantom hearses: the REVENANT hull silhouette in translucent violet over a dark outline shell (BackSide, scaled),
 *  with a bright additive skin on top. */
const CAM_FADE_IN = 5;
const CAM_FADE_OUT = 12;

export class RiderMeshes {
  readonly roots: THREE.Group[] = [];
  private fills: THREE.MeshBasicMaterial[] = [];
  private rims: THREE.MeshBasicMaterial[] = [];

  constructor(scene: THREE.Scene, n: number) {
    const hull = revenantHullGeometry();
    for (let i = 0; i < n; i++) {
      const fill = paintMat(REV_CORE, 0.3);
      fill.side = THREE.DoubleSide;
      const rim = new THREE.MeshBasicMaterial({ color: REV_EDGE, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.BackSide });
      const skin = addMat(REV_BRIGHT, 0.1);
      const root = new THREE.Group();
      const r = new THREE.Mesh(hull, rim);
      r.scale.setScalar(1.06);
      r.position.y = -0.04;
      const f = new THREE.Mesh(hull, fill);
      const s = new THREE.Mesh(hull, skin);
      s.scale.setScalar(1.01);
      r.renderOrder = 2;
      f.renderOrder = 3;
      s.renderOrder = 4;
      root.add(r, f, s);
      // Bone-white slit eyes for headlights.
      for (const sx of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.07, 0.07), new THREE.MeshBasicMaterial({ color: REV_BONE }));
        eye.position.set(sx * 0.55, 0.98, 2.7);
        eye.rotation.y = sx * -0.28;
        root.add(eye);
      }
      root.visible = false;
      root.traverse((o) => (o.frustumCulled = false));
      scene.add(root);
      this.roots.push(root);
      this.fills.push(fill);
      this.rims.push(rim);
    }
  }

  /** Riders follow the hearse's exact path, which is where the chase camera rides: one closer than CAM_FADE_IN m to
   *  `camera` (when given) fades out completely, fully drawn again from CAM_FADE_OUT m, so none fills the screen. */
  camera: THREE.Camera | null = null;

  /** Pose rider i (feet at (x, y, z), heading), `alpha` 0..1 fade. */
  set(i: number, x: number, y: number, z: number, heading: number, alpha: number, bob: number): void {
    const r = this.roots[i];
    const cam = this.camera;
    if (cam) {
      const d = Math.hypot(cam.position.x - x, cam.position.y - y - 1, cam.position.z - z);
      alpha *= Math.min(1, Math.max(0, (d - CAM_FADE_IN) / (CAM_FADE_OUT - CAM_FADE_IN)));
    }
    r.visible = alpha > 0.01;
    if (!r.visible) return;
    r.position.set(x, y + 0.15 + bob, z);
    r.rotation.set(-0.04, heading, 0);
    this.fills[i].opacity = 0.3 * alpha;
    this.rims[i].opacity = 0.85 * alpha;
  }

  hide(i: number): void {
    this.roots[i].visible = false;
  }

  clear(): void {
    for (const r of this.roots) r.visible = false;
  }
}

/* ------------------------------------------------------------------ Hunt dome */

/** The darkening while THE WILD HUNT rides: a huge back-faced sphere drawn first among the transparents with no depth
 *  test (it tints the whole opaque scene; the riders and effects draw over it), plus the scene fog pulled in and
 *  tinted. Restores the fog on release. */
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
    this.mat.opacity = 0.42 * k;
    if (fog && (fog as THREE.Fog).isFog) {
      if (!this.saved) this.saved = { color: fog.color.clone(), near: fog.near, far: fog.far };
      fog.color.copy(this.saved.color).lerp(this.purple, 0.7 * k);
      fog.near = this.saved.near * (1 - 0.6 * k);
      fog.far = this.saved.far * (1 - 0.45 * k);
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
