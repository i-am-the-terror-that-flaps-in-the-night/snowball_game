import * as THREE from 'three';
import { densePuffTexture, softPuffTexture } from './particles';

/* VOLT-9 SUPERCELL storm: a huge layered cloud mass (soft billboards, normal blend so they read on sunlit snow and
 * against the night sky): a low dark deck over the whole strike area with only a small eye over the caster, and a
 * towering outer wall of bigger, darker banks stacked up to the horizon. Every puff has an additive glow billboard
 * that flashes when a strike leaves it (or lightning flickers inside it), and a storm dome darkens the arena to a
 * stormy blue and blinks with sheet lightning on every strike. The chase camera sits ~10 m up looking down ~30 deg,
 * so the deck hangs low (~6.5 m) and the wall stands well out: together they fill the top of the frame; puffs near
 * the camera fade out (never fill the screen). Pooled: built once, posed and faded by update(); nothing allocated
 * per frame. */

/** Deck puffs: count, height above the cast floor, ring inner / outer radius (x storm radius). */
const DECK = 56;
const CLOUD_Y = 6;
const RING_IN = 0.28;
const RING_OUT = 1.35;
/** Outer wall banks: count, height range (m above the floor), ring inner / outer radius (x storm radius). */
const WALL = 30;
const WALL_Y0 = 6.5;
const WALL_Y1 = 12;
const WALL_IN = 1.05;
const WALL_OUT = 2.1;
/** All puffs (LOW quality: every other one). */
const PUFFS = DECK + WALL;
/** Fade in / out seconds. */
const FADE_IN = 0.35;
const FADE_OUT = 0.7;
/** Peak opacities: cloud body, a puff's flash glow, the storm dome's darkening and its lightning blink. */
const BODY = 1;
const GLOW = 1;
const DOME_DARK = 0.38;
const DOME_FLASH = 0.22;
/** Flash decay (1/s): puffs, the dome blink. */
const FLASH_DECAY = 8;
const DOME_DECAY = 11;
/** A puff fades out within NEAR_IN m of the camera (beyond its own size), fully drawn from NEAR_OUT m. */
const NEAR_IN = 1;
const NEAR_OUT = 6;

interface Puff {
  body: THREE.Sprite;
  bodyMat: THREE.SpriteMaterial;
  glow: THREE.Sprite;
  glowMat: THREE.SpriteMaterial;
  /** Offset from the centre (x storm radius), size (x storm radius), height above the floor (m), flash 0..1,
   *  height / width of the billboard. */
  ox: number;
  oz: number;
  size: number;
  dy: number;
  flash: number;
  squash: number;
}

export class StormCloud {
  private readonly group = new THREE.Group();
  private readonly puffs: Puff[] = [];
  private readonly dome: THREE.Mesh;
  private readonly domeMat: THREE.MeshBasicMaterial;
  private readonly blink: THREE.Mesh;
  private readonly blinkMat: THREE.MeshBasicMaterial;
  private t = -1;
  private dur = 0;
  private radius = 18;
  private step = 1;
  private spin = 0;
  private domeFlash = 0;
  /** Centre and floor of the storm. */
  private x = 0;
  private y = 0;
  private z = 0;
  /** The viewer (puffs near it fade out); null: no fade. */
  camera: THREE.Camera | null = null;

  constructor(scene: THREE.Scene) {
    const map = softPuffTexture();
    const dense = densePuffTexture();
    const dark = new THREE.Color(0x1e2a48);
    const lite = new THREE.Color(0x4a5e88);
    const deep = new THREE.Color(0x141d34);
    for (let i = 0; i < PUFFS; i++) {
      // Jittered angle and radius across each ring, so it reads as a churning cloud mass, not a wheel. Deck puffs come
      // first (indices interleave the two layers' halves, so LOW's every-other-one keeps both).
      const wall = i >= DECK;
      const n = wall ? WALL : DECK;
      const j = wall ? i - DECK : i;
      const a = (j / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const r = wall ? WALL_IN + Math.random() * (WALL_OUT - WALL_IN) : RING_IN + Math.sqrt(Math.random()) * (RING_OUT - RING_IN);
      const col = wall ? deep.clone().lerp(dark, Math.random()) : dark.clone().lerp(lite, Math.random() * 0.8);
      // No fog: the arena's haze would tint a far cloud bank to the ground colour (it must stay a dark storm blue).
      const bodyMat = new THREE.SpriteMaterial({ alphaMap: dense, color: col, transparent: true, opacity: 0, depthWrite: false, fog: false });
      const glowMat = new THREE.SpriteMaterial({ alphaMap: map, color: 0xb8e6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
      bodyMat.rotation = glowMat.rotation = Math.random() * Math.PI * 2;
      const body = new THREE.Sprite(bodyMat);
      const glow = new THREE.Sprite(glowMat);
      body.renderOrder = 7;
      glow.renderOrder = 8;
      body.frustumCulled = glow.frustumCulled = false;
      this.group.add(body, glow);
      this.puffs.push({
        body,
        bodyMat,
        glow,
        glowMat,
        ox: Math.sin(a) * r,
        oz: Math.cos(a) * r,
        size: wall ? 0.75 + Math.random() * 0.4 : 0.5 + Math.random() * 0.3,
        dy: wall ? WALL_Y0 + Math.random() * (WALL_Y1 - WALL_Y0) : CLOUD_Y + (Math.random() - 0.5) * 1.8,
        flash: 0,
        squash: wall ? 0.75 : 0.5,
      });
    }
    // Storm dome: drawn first among the transparents with no depth test, so it tints the whole opaque scene (like the
    // Wild Hunt's, combat/revenantFx.ts HuntDome); the blink is the same sphere, additive.
    const sphere = new THREE.SphereGeometry(400, 16, 10);
    this.domeMat = new THREE.MeshBasicMaterial({ color: 0x0a1a3a, transparent: true, opacity: 0, depthWrite: false, depthTest: false, side: THREE.BackSide, toneMapped: false });
    this.blinkMat = new THREE.MeshBasicMaterial({ color: 0x8ec8ff, transparent: true, opacity: 0, depthWrite: false, depthTest: false, side: THREE.BackSide, toneMapped: false, blending: THREE.AdditiveBlending });
    this.dome = new THREE.Mesh(sphere, this.domeMat);
    this.blink = new THREE.Mesh(sphere, this.blinkMat);
    this.dome.renderOrder = -9;
    this.blink.renderOrder = -8;
    this.dome.frustumCulled = this.blink.frustumCulled = false;
    this.group.add(this.dome, this.blink);
    this.group.visible = false;
    scene.add(this.group);
  }

  get active(): boolean {
    return this.t >= 0;
  }

  /** Open a storm over (x, floorY, z), `radius` m, lasting `seconds`; `scale` (fxScale): LOW draws half the puffs. */
  start(x: number, floorY: number, z: number, radius: number, seconds: number, scale = 1): void {
    this.x = x;
    this.y = floorY;
    this.z = z;
    this.radius = radius;
    this.dur = seconds;
    this.t = 0;
    this.step = scale < 1 ? 2 : 1;
    this.domeFlash = 0;
    for (const p of this.puffs) p.flash = 0;
    this.group.visible = true;
    this.update(0);
  }

  /** A strike from the deck down onto (x, z): its start under the cloud into `out` (near-vertical, a little
   *  jitter); lights the nearest drawn puff and blinks the dome. */
  strikeAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    let best: Puff | null = null;
    let bd = Infinity;
    for (let i = 0; i < DECK; i += this.step) {
      const p = this.puffs[i];
      const d = (p.body.position.x - x) ** 2 + (p.body.position.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (best) best.flash = 1;
    // Lightning flickers on inside the cloud elsewhere too.
    const o = this.puffs[Math.floor(Math.random() * (PUFFS / this.step)) * this.step];
    o.flash = Math.max(o.flash, 0.5 + 0.5 * Math.random());
    this.domeFlash = Math.max(this.domeFlash, 0.5 + 0.5 * Math.random());
    return out.set(x + (Math.random() - 0.5) * 5, this.y + CLOUD_Y - 0.5 + (Math.random() - 0.5) * 1.5, z + (Math.random() - 0.5) * 5);
  }

  /** In-cloud lightning: two lit puffs' centres (in the deck, near each other) into `a` / `b` for a cloud-to-cloud
   *  arc; both flash. */
  innerArc(a: THREE.Vector3, b: THREE.Vector3): void {
    const n = Math.floor(DECK / this.step);
    const i = Math.floor(Math.random() * n) * this.step;
    const k = (i + this.step * (1 + Math.floor(Math.random() * 3))) % (n * this.step);
    const p = this.puffs[i];
    const q = this.puffs[k];
    p.flash = q.flash = 1;
    this.domeFlash = Math.max(this.domeFlash, 0.4);
    a.copy(p.body.position);
    a.y -= 0.6;
    b.copy(q.body.position);
    b.y -= 0.6;
  }

  /** Sheet lightning through the whole deck (a damage wave). */
  sheet(): void {
    for (let i = 0; i < PUFFS; i += this.step) if (Math.random() < 0.6) this.puffs[i].flash = Math.max(this.puffs[i].flash, 0.6 + Math.random() * 0.4);
    this.domeFlash = 1;
  }

  update(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    if (this.t >= this.dur) {
      this.clear();
      return;
    }
    const fin = Math.min(1, this.t / FADE_IN);
    const fout = Math.min(1, (this.dur - this.t) / FADE_OUT);
    const k = Math.min(fin, fout);
    this.dome.position.set(this.x, this.y, this.z);
    this.blink.position.copy(this.dome.position);
    this.domeMat.opacity = DOME_DARK * k;
    this.blinkMat.opacity = DOME_FLASH * this.domeFlash * k * (0.7 + 0.3 * Math.random());
    this.blink.visible = this.domeFlash > 0.01;
    this.domeFlash = Math.max(0, this.domeFlash - dt * DOME_DECAY);
    this.spin += dt * 0.3;
    // Rolls in from wider and higher as it forms.
    const grow = 1.25 - 0.25 * (1 - (1 - fin) ** 2);
    const R = this.radius;
    const cs = Math.cos(this.spin);
    const sn = Math.sin(this.spin);
    const cam = this.camera;
    for (let i = 0; i < PUFFS; i++) {
      const p = this.puffs[i];
      const on = i % this.step === 0;
      p.body.visible = on;
      p.glow.visible = on && p.flash > 0.01;
      if (!on) continue;
      const ox = (p.ox * cs - p.oz * sn) * R * grow;
      const oz = (p.ox * sn + p.oz * cs) * R * grow;
      const s = p.size * R * (1 + 0.05 * Math.sin(this.t * 1.7 + i));
      p.body.position.set(this.x + ox, this.y + p.dy + (grow - 1) * 8, this.z + oz);
      p.body.scale.set(s, s * p.squash, 1);
      let near = 1;
      if (cam) {
        const d = cam.position.distanceTo(p.body.position) - s * 0.5;
        near = Math.min(1, Math.max(0, (d - NEAR_IN) / (NEAR_OUT - NEAR_IN)));
      }
      p.body.visible = near > 0.01;
      p.bodyMat.opacity = BODY * k * near;
      p.glow.position.copy(p.body.position);
      p.glow.scale.set(s * 0.85, s * p.squash * 0.85, 1);
      p.glowMat.opacity = GLOW * p.flash * k * near;
      p.flash = Math.max(0, p.flash - dt * FLASH_DECAY * (0.6 + 0.4 * Math.random()));
    }
  }

  clear(): void {
    this.t = -1;
    this.group.visible = false;
    this.domeFlash = 0;
    for (const p of this.puffs) p.flash = 0;
  }
}
