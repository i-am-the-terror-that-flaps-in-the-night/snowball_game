import * as THREE from 'three';

/* ARSENAL ability visuals that need more than the shared Fx batches: crisp ground rings that read on white snow
 * (a painted saturated band under an additive hot line), vertical shimmer walls (vertex-alpha cylinders, no textures:
 * the headless balance sim builds these too), inward pull streaks / tethers and expanding shockwaves with a flash. */

export const CYAN = 0x38e8ff;
/** Saturated cyan for normal-blended (painted) layers: additive cyan washes out to white over sunlit snow. */
const DEEP = 0x0aa8de;
const HOT = 0xd8ffff;

export const addMat = (color: number, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
export const paintMat = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false });

/** Unit cylinder along +Z (0..1): beams are scaled (width, width, length) and pointed with lookAt. */
export function beamGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, 0.5);
  return g;
}

/** Point a unit beam from `from` to `to` with half-width `w` (hidden when degenerate). */
function aimBeam(m: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, w: number): void {
  const len = from.distanceTo(to);
  if (!(len > 1e-3) || !(w > 1e-4)) {
    m.visible = false;
    return;
  }
  m.visible = true;
  m.position.copy(from);
  m.lookAt(to);
  m.scale.set(w, w, len);
}

/** Open unit cylinder (radius 1, y 0..1) whose vertex alpha fades out upward; `stripes` breaks it into vertical
 *  streaks (a shimmer once it turns). */
function wallGeometry(seg: number, stripes: boolean): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, seg, 3, true);
  g.translate(0, 0.5, 0);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const s = i % (seg + 1);
    const h = Math.abs(Math.sin(s * 12.9898 + 78.233) * 43758.5453) % 1;
    const a = (1 - y) ** 1.6 * (stripes ? 0.25 + 0.75 * h * h : 1);
    col.set([1, 1, 1, a], i * 4);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return g;
}

/** Flat disc (radius 1, in the XZ plane) whose vertex alpha rises toward the rim: the tint inside an event horizon. */
function rimFadeDisc(): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(0.02, 1, 96, 4);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    col.set([1, 1, 1, r ** 3], i * 4);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return g;
}

const vMat = (color: number, opacity: number, additive = false) =>
  new THREE.MeshBasicMaterial({
    color,
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

/** A flat ring in the XZ plane, inner radius `r0` of an outer 1 (scale it to size). */
function flatRing(r0: number, mat: THREE.Material, seg = 96): THREE.Mesh {
  const g = new THREE.RingGeometry(r0, 1, seg);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  (mat as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
  return m;
}

function hide(...o: THREE.Object3D[]): void {
  for (const x of o) x.visible = false;
}

/* ------------------------------------------------------------------ shockwaves */

interface Wave {
  root: THREE.Group;
  band: THREE.Mesh;
  hot: THREE.Mesh;
  wall: THREE.Mesh;
  flash: THREE.Mesh;
  flashTint: THREE.Mesh;
  t: number;
  dur: number;
  R: number;
  flashR: number;
  wallH: number;
}

/** Shockwave colours: the painted band, the additive hot line, the wall and the flash tint. */
export interface ShockPalette {
  band: number;
  hot: number;
  wall: number;
  tint: number;
}
/** ARSENAL's cyan (the default). */
const CYAN_SHOCK: ShockPalette = { band: DEEP, hot: HOT, wall: 0x2ad8ff, tint: 0x5fe6ff };

/** Expanding ground shockwaves: painted cyan band + hot line + a short vertical wall, and a flash ball at the source.
 *  `palette` re-tints them (the Classic's STREAK finisher). */
export class Shockwaves {
  private waves: Wave[] = [];
  reduceFlash = false;

  constructor(scene: THREE.Scene, n = 6, palette: ShockPalette = CYAN_SHOCK) {
    const wallGeo = wallGeometry(48, false);
    const sph = new THREE.SphereGeometry(1, 16, 12);
    for (let i = 0; i < n; i++) {
      const root = new THREE.Group();
      root.visible = false;
      const band = flatRing(0.8, paintMat(palette.band, 0.9));
      const hot = flatRing(0.94, addMat(palette.hot, 1));
      const wall = new THREE.Mesh(wallGeo, vMat(palette.wall, 0.7));
      const flash = new THREE.Mesh(sph, addMat(0xffffff, 1));
      const flashTint = new THREE.Mesh(sph, paintMat(palette.tint, 0.6));
      band.renderOrder = 2;
      hot.renderOrder = 3;
      wall.renderOrder = 3;
      flash.renderOrder = 4;
      flashTint.renderOrder = 3;
      root.add(band, hot, wall, flash, flashTint);
      for (const m of root.children) m.frustumCulled = false;
      scene.add(root);
      this.waves.push({ root, band, hot, wall, flash, flashTint, t: 0, dur: 0, R: 0, flashR: 0, wallH: 0 });
    }
  }

  /** A shockwave on the ground at (x, groundY, z) out to `R` m over `dur` s; a flash ball of `flashR` m at height
   *  `flashY` above the ground; a vertical wall `wallH` m tall (0 = none). */
  spawn(x: number, groundY: number, z: number, R: number, opts: { dur?: number; flashR?: number; flashY?: number; wallH?: number } = {}): void {
    let w = this.waves.find((v) => !v.root.visible);
    if (!w) w = this.waves.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    w.t = 0;
    w.dur = opts.dur ?? 0.55;
    w.R = R;
    w.flashR = opts.flashR ?? 0;
    w.wallH = opts.wallH ?? 0;
    w.root.position.set(x, groundY + 0.1, z);
    w.flash.position.y = w.flashTint.position.y = opts.flashY ?? 1;
    w.root.visible = true;
    this.update(0, w);
  }

  update(dt: number, only?: Wave): void {
    for (const w of only ? [only] : this.waves) {
      if (!w.root.visible) continue;
      w.t += dt;
      const k = w.t / w.dur;
      if (k >= 1) {
        w.root.visible = false;
        continue;
      }
      const e = 1 - (1 - k) ** 3;
      const r = Math.max(0.05, w.R * e);
      const fade = (1 - k) ** 1.4;
      w.band.scale.setScalar(r);
      w.hot.scale.setScalar(r);
      (w.band.material as THREE.MeshBasicMaterial).opacity = 0.9 * fade;
      (w.hot.material as THREE.MeshBasicMaterial).opacity = fade;
      w.wall.visible = w.wallH > 0;
      w.wall.scale.set(r, Math.max(0.01, w.wallH * (1 - 0.6 * k)), r);
      (w.wall.material as THREE.MeshBasicMaterial).opacity = 0.75 * fade;
      const fk = Math.min(1, w.t / (w.dur * 0.45));
      const fOn = w.flashR > 0 && fk < 1;
      w.flash.visible = w.flashTint.visible = fOn;
      if (fOn) {
        const fr = w.flashR * (0.35 + 0.65 * Math.sqrt(fk)) * (this.reduceFlash ? 0.6 : 1);
        w.flash.scale.setScalar(fr * 0.6);
        w.flashTint.scale.setScalar(fr);
        (w.flash.material as THREE.MeshBasicMaterial).opacity = (1 - fk) * (this.reduceFlash ? 0.5 : 1);
        (w.flashTint.material as THREE.MeshBasicMaterial).opacity = 0.55 * (1 - fk);
      }
    }
  }

  clear(): void {
    for (const w of this.waves) w.root.visible = false;
  }
}

/* ------------------------------------------------------------------ streaks */

interface Streak { m: THREE.Mesh; on: boolean; t: number; dur: number; from: THREE.Vector3 }
const _s = new THREE.Vector3();
const _e = new THREE.Vector3();

/** Thin bright lines rushing inward to a point (accelerating), stretching as they speed up. */
class Streaks {
  private list: Streak[] = [];
  readonly to = new THREE.Vector3();

  constructor(scene: THREE.Scene, n: number, geo: THREE.BufferGeometry) {
    const mats = [paintMat(0x12bdf0, 0.95), addMat(0xc8fbff, 0.95)];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, mats[i % 2]);
      m.visible = false;
      m.renderOrder = 3;
      m.frustumCulled = false;
      scene.add(m);
      this.list.push({ m, on: false, t: 0, dur: 0.5, from: new THREE.Vector3() });
    }
  }

  spawn(from: THREE.Vector3, dur: number): void {
    const s = this.list.find((v) => !v.on);
    if (!s) return;
    s.on = true;
    s.t = 0;
    s.dur = dur;
    s.from.copy(from);
  }

  update(dt: number, width = 0.06): void {
    for (const s of this.list) {
      if (!s.on) continue;
      s.t += dt;
      const k = s.t / s.dur;
      if (k >= 1) {
        s.on = false;
        s.m.visible = false;
        continue;
      }
      // Head accelerates in (k^2); the tail lags behind, so the streak lengthens as it speeds up.
      const head = k * k;
      const tail = Math.max(0, k - 0.22) ** 2;
      _e.lerpVectors(s.from, this.to, head);
      _s.lerpVectors(s.from, this.to, tail);
      aimBeam(s.m, _s, _e, width * (0.6 + 0.6 * k));
    }
  }

  clear(): void {
    for (const s of this.list) {
      s.on = false;
      s.m.visible = false;
    }
  }
}

/* ------------------------------------------------------------------ event horizon */

/** POLARITY BURST visuals: a crisp ground ring (painted band + hot line) with a faint tinted interior and a vertical
 *  shimmer wall, a glowing pull point with a spinning accretion ring, tethers from the caught bots and inward
 *  streaks. The kit drives it: set(...) every frame while it runs, hide() when it ends. */
export class Horizon {
  readonly root = new THREE.Group();
  private band: THREE.Mesh;
  private hot: THREE.Mesh;
  private fill: THREE.Mesh;
  private wall: THREE.Mesh;
  private wall2: THREE.Mesh;
  /** Pull point (world space, its own parent: it hovers above the ground). */
  readonly point = new THREE.Group();
  private core: THREE.Mesh;
  private glow: THREE.Mesh;
  private tint: THREE.Mesh;
  private accretion: THREE.Mesh[] = [];
  private tethers: THREE.Mesh[] = [];
  readonly streaks: Streaks;

  constructor(scene: THREE.Scene, beam: THREE.BufferGeometry) {
    this.band = flatRing(0.972, paintMat(DEEP, 0.95));
    this.hot = flatRing(0.988, addMat(HOT, 1));
    this.fill = new THREE.Mesh(rimFadeDisc(), vMat(0x0b9fd6, 0.3));
    this.wall = new THREE.Mesh(wallGeometry(72, true), vMat(0x22d0ff, 0.7));
    this.wall2 = new THREE.Mesh(wallGeometry(40, true), vMat(0xbff8ff, 0.5, true));
    this.band.renderOrder = 2;
    this.fill.renderOrder = 1;
    this.hot.renderOrder = 3;
    this.wall.renderOrder = 3;
    this.wall2.renderOrder = 3;
    this.root.add(this.fill, this.band, this.hot, this.wall, this.wall2);
    for (const m of this.root.children) m.frustumCulled = false;
    this.root.visible = false;
    scene.add(this.root);

    this.core = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    this.glow = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), addMat(CYAN, 0.6));
    this.tint = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), paintMat(0x16c6f2, 0.45));
    this.core.renderOrder = 4;
    this.glow.renderOrder = 4;
    this.tint.renderOrder = 3;
    this.point.add(this.tint, this.glow, this.core);
    for (let i = 0; i < 2; i++) {
      const a = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 4, 40), i ? addMat(HOT, 0.9) : paintMat(DEEP, 0.9));
      a.renderOrder = 4;
      this.accretion.push(a);
      this.point.add(a);
    }
    this.point.visible = false;
    scene.add(this.point);
    const tm = paintMat(0x14c4f2, 0.8);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(beam, tm);
      m.visible = false;
      m.renderOrder = 3;
      m.frustumCulled = false;
      scene.add(m);
      this.tethers.push(m);
    }
    this.streaks = new Streaks(scene, 40, beam);
  }

  /** One frame: horizon of radius `r` round (x, groundY, z), pull point at `P` sized `pk` (0..1), the shimmer `t`. */
  set(x: number, groundY: number, z: number, r: number, P: THREE.Vector3, pk: number, t: number, alpha: number): void {
    this.root.visible = true;
    this.root.position.set(x, groundY + 0.1, z);
    this.band.scale.setScalar(r);
    this.hot.scale.setScalar(r);
    this.fill.scale.setScalar(r);
    const flick = 0.85 + 0.15 * Math.sin(t * 37) * Math.sin(t * 11);
    (this.band.material as THREE.MeshBasicMaterial).opacity = 0.95 * alpha;
    (this.hot.material as THREE.MeshBasicMaterial).opacity = flick * alpha;
    (this.fill.material as THREE.MeshBasicMaterial).opacity = 0.3 * alpha;
    const h = 3.2 * alpha;
    this.wall.scale.set(r, Math.max(0.01, h), r);
    this.wall2.scale.set(r * 0.995, Math.max(0.01, h * 0.8), r * 0.995);
    this.wall.rotation.y = t * 0.9;
    this.wall2.rotation.y = -t * 1.4;
    (this.wall.material as THREE.MeshBasicMaterial).opacity = (0.7 + 0.25 * Math.sin(t * 23)) * alpha;
    (this.wall2.material as THREE.MeshBasicMaterial).opacity = (0.35 + 0.25 * Math.sin(t * 17 + 1)) * alpha;
    this.point.visible = pk > 0.01;
    this.point.position.copy(P);
    const c = pk * (1 + 0.08 * Math.sin(t * 40));
    this.core.scale.setScalar(0.32 * c);
    this.core.rotation.set(t * 5, t * 7, 0);
    this.glow.scale.setScalar(0.9 * c);
    this.tint.scale.setScalar(1.25 * c);
    for (let i = 0; i < 2; i++) {
      const a = this.accretion[i];
      a.scale.setScalar((1.1 + i * 0.35) * c);
      a.rotation.set(Math.PI / 2 + (i ? 0.5 : -0.35), 0, t * (i ? -6 : 8));
    }
    this.streaks.to.copy(P);
  }

  /** Tether `i` from `from` to the pull point (call tethersDone(n) after the last one). */
  tether(i: number, from: THREE.Vector3, w: number): void {
    if (i < this.tethers.length) aimBeam(this.tethers[i], from, this.point.position, w);
  }
  tethersDone(n: number): void {
    for (let i = n; i < this.tethers.length; i++) this.tethers[i].visible = false;
  }

  hide(): void {
    hide(this.root, this.point);
    this.tethersDone(0);
  }

  clear(): void {
    this.hide();
    this.streaks.clear();
  }
}

/* ------------------------------------------------------------------ forward arc wave (MAG REPULSOR) */

interface Arc { root: THREE.Group; band: THREE.Mesh; hot: THREE.Mesh; wall: THREE.Mesh; inner: THREE.Mesh; t: number; dur: number; R: number; wallH: number }

/** A wedge of a ground ring (`half` rad either side of +Z, inner radius r0 of an outer 1). */
function arcRing(r0: number, half: number, mat: THREE.Material): THREE.Mesh {
  const g = new THREE.RingGeometry(r0, 1, 32, 1, -Math.PI / 2 - half, half * 2);
  g.rotateX(-Math.PI / 2);
  return new THREE.Mesh(g, mat);
}

/** An open arc of wall (radius 1, y 0..1, `half` rad either side of +Z) whose alpha fades out upward, in streaks. */
function arcWall(half: number, seg: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, seg, 3, true, -half, half * 2);
  g.translate(0, 0.5, 0);
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const s = i % (seg + 1);
    const h = Math.abs(Math.sin(s * 12.9898 + 78.233) * 43758.5453) % 1;
    // Fades upward and toward both ends of the arc (no hard cut-off at the cone's edges).
    const edge = Math.sin((s / seg) * Math.PI);
    col.set([1, 1, 1, (1 - pos.getY(i)) ** 1.4 * (0.45 + 0.55 * h) * edge], i * 4);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return g;
}

/** MAG REPULSOR: a cyan magnetic wall sweeping out across a forward wedge (painted band + hot line on the ground,
 *  a streaked wall and a hot inner wall), built once per arc width bucket and pooled. */
export class ArcWaves {
  private arcs: Arc[] = [];

  /** `half`: the wedge's half-angle (rad) the geometry is built for; spawn() scales it to other widths. */
  constructor(scene: THREE.Scene, private half: number, n = 3) {
    const wallGeo = arcWall(half, 24);
    for (let i = 0; i < n; i++) {
      const root = new THREE.Group();
      root.visible = false;
      const band = arcRing(0.82, half, paintMat(DEEP, 0.9));
      const hot = arcRing(0.95, half, addMat(HOT, 1));
      const wall = new THREE.Mesh(wallGeo, vMat(0x2ad8ff, 0.8));
      const inner = new THREE.Mesh(wallGeo, vMat(0xc8fbff, 0.6, true));
      band.renderOrder = 2;
      hot.renderOrder = 3;
      wall.renderOrder = 3;
      inner.renderOrder = 4;
      for (const m of [band, hot]) (m.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
      root.add(band, hot, wall, inner);
      for (const m of root.children) m.frustumCulled = false;
      scene.add(root);
      this.arcs.push({ root, band, hot, wall, inner, t: 0, dur: 0, R: 0, wallH: 0 });
    }
  }

  /** A wave from (x, groundY, z) facing `heading`, out to `R` m over `dur` s, `half` rad either side, `wallH` m tall. */
  spawn(x: number, groundY: number, z: number, heading: number, R: number, half: number, dur: number, wallH: number): void {
    let w = this.arcs.find((v) => !v.root.visible);
    if (!w) w = this.arcs.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    w.t = 0;
    w.dur = dur;
    w.R = R;
    w.wallH = wallH;
    w.root.position.set(x, groundY + 0.1, z);
    w.root.rotation.set(0, heading, 0);
    // Wider / narrower than the built wedge: stretch it sideways (close enough for a few degrees either way).
    w.root.userData.sx = Math.tan(Math.min(1.2, half)) / Math.tan(Math.min(1.2, this.half));
    w.root.visible = true;
    this.update(0, w);
  }

  update(dt: number, only?: Arc): void {
    for (const w of only ? [only] : this.arcs) {
      if (!w.root.visible) continue;
      w.t += dt;
      const k = w.t / w.dur;
      if (k >= 1) {
        w.root.visible = false;
        continue;
      }
      const e = 1 - (1 - k) ** 2;
      const r = Math.max(0.05, w.R * e);
      const fade = (1 - k) ** 1.2;
      const sx = (w.root.userData.sx as number) || 1;
      w.band.scale.set(r * sx, r, r);
      w.hot.scale.set(r * sx, r, r);
      (w.band.material as THREE.MeshBasicMaterial).opacity = 0.9 * fade;
      (w.hot.material as THREE.MeshBasicMaterial).opacity = fade;
      const h = Math.max(0.01, w.wallH * (1 - 0.5 * k));
      w.wall.scale.set(r * sx, h, r);
      w.inner.scale.set(r * 0.97 * sx, h * 0.7, r * 0.97);
      (w.wall.material as THREE.MeshBasicMaterial).opacity = 0.8 * fade;
      (w.inner.material as THREE.MeshBasicMaterial).opacity = 0.6 * fade;
    }
  }

  clear(): void {
    for (const w of this.arcs) w.root.visible = false;
  }
}

/* ------------------------------------------------------------------ mag laser */

interface Bolt {
  /** Seconds since the shot (>= LASER_LIFE: free). */
  t: number;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Impact flash scale at the end point (0: the bolt ran out of reach into empty air: a small fizzle). */
  impact: number;
  /** The beam's hit half-width (m): the glow is drawn GLOW_W of it, the core CORE_W. */
  w: number;
  core: THREE.Mesh;
  glow: THREE.Mesh;
  edge: THREE.Mesh;
  muzzle: THREE.Mesh;
  hitTint: THREE.Mesh;
  hitCore: THREE.Mesh;
}

/** How long one pulse lives (s). */
const LASER_LIFE = 0.1;
/** The bolt is hitscan: it reaches the end point at once, then its TAIL races after it (TAIL_SPEED m/s, so a 10 m
 *  shot is gone in ~0.017 s plus the fade): it reads as one very fast fat slug zipping into the target. */
const TAIL_SPEED = 600;
/** Drawn radii as shares of the hit half-width: a fat cyan glow with a dark edge (reads on bright snow) round a
 *  white-hot core. */
const GLOW_W = 0.42;
const EDGE_W = 0.52;
const CORE_W = 0.2;
const _from = new THREE.Vector3();

/** MAG LASER: a small fixed pool of fat, standard-width hitscan bolts. Each shot is a white-hot core in a cyan glow
 *  with a dark-navy edge (normal-blended so it still reads on sunlit snow), drawn from the emitter straight to the
 *  locked target (auto-aim, ArsenalKit.fireBolt); its tail then races to the end point and the bolt fades. A
 *  muzzle flash at the emitter and an impact flash at the end. fire() takes the oldest free slot; update() animates.
 *  Nothing allocates per shot or per frame. */
export class LaserFx {
  private bolts: Bolt[] = [];

  constructor(scene: THREE.Scene, n: number, beam: THREE.BufferGeometry) {
    const ball = new THREE.SphereGeometry(1, 12, 8);
    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, order: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = order;
      scene.add(m);
      return m;
    };
    for (let i = 0; i < n; i++) {
      // Own materials per bolt: each fades on its own clock.
      this.bolts.push({
        t: LASER_LIFE,
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        impact: 0,
        w: 0,
        edge: mk(beam, paintMat(0x06243a, 0.75), 3),
        glow: mk(beam, paintMat(0x19dcff, 0.95), 4),
        core: mk(beam, addMat(0xf6ffff, 1), 5),
        muzzle: mk(ball, addMat(0xf6ffff, 1), 5),
        hitTint: mk(ball, paintMat(0x2ad8ff, 0.8), 4),
        hitCore: mk(ball, addMat(0xf6ffff, 1), 5),
      });
    }
  }

  /** One bolt from `from` to `to`; `impact` (0..1+) sizes the end flash; `w`: the beam's hit half-width (m). */
  fire(from: THREE.Vector3, to: THREE.Vector3, impact: number, w: number): void {
    let b = this.bolts[0];
    for (const x of this.bolts) {
      if (x.t >= LASER_LIFE) {
        b = x;
        break;
      }
      if (x.t > b.t) b = x;
    }
    b.t = 0;
    b.from.copy(from);
    b.to.copy(to);
    b.impact = impact;
    b.w = w;
    this.draw(b);
  }

  update(dt: number): void {
    for (const b of this.bolts) {
      if (b.t >= LASER_LIFE) continue;
      b.t += dt;
      if (b.t >= LASER_LIFE) hide(b.core, b.glow, b.edge, b.muzzle, b.hitTint, b.hitCore);
      else this.draw(b);
    }
  }

  private draw(b: Bolt): void {
    const k = b.t / LASER_LIFE;
    // The tail races after the head; keep at least a short slug at the end while it fades.
    const len = b.from.distanceTo(b.to);
    const slug = Math.min(len, 1.4);
    const tail = Math.min(len - slug, b.t * TAIL_SPEED);
    _from.lerpVectors(b.from, b.to, len > 1e-3 ? tail / len : 0);
    const thin = 1 - 0.55 * k;
    aimBeam(b.edge, _from, b.to, b.w * EDGE_W * thin);
    aimBeam(b.glow, _from, b.to, b.w * GLOW_W * thin);
    aimBeam(b.core, _from, b.to, b.w * CORE_W * thin);
    (b.edge.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - k);
    (b.glow.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - k * k);
    (b.core.material as THREE.MeshBasicMaterial).opacity = 1 - k * k;
    b.muzzle.visible = k < 0.4;
    b.muzzle.position.copy(b.from);
    b.muzzle.scale.setScalar(0.42 * (1 - k / 0.4) + 0.05);
    const r = 0.25 + 0.45 * b.impact;
    b.hitTint.visible = b.hitCore.visible = true;
    b.hitTint.position.copy(b.to);
    b.hitCore.position.copy(b.to);
    b.hitTint.scale.setScalar(r * (0.7 + 0.6 * k));
    b.hitCore.scale.setScalar(r * 0.55 * (1 - 0.5 * k));
    (b.hitTint.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
    (b.hitCore.material as THREE.MeshBasicMaterial).opacity = 1 - k;
  }

  /** Bolts on screen right now (tests / probes). */
  get live(): number {
    let n = 0;
    for (const b of this.bolts) if (b.t < LASER_LIFE) n++;
    return n;
  }

  clear(): void {
    for (const b of this.bolts) {
      b.t = LASER_LIFE;
      hide(b.core, b.glow, b.edge, b.muzzle, b.hitTint, b.hitCore);
    }
  }
}
