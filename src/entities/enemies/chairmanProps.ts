import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { currentPreset, scaleCount } from '../../core/settings';
import type { Bot, Host } from './Bot';
import { DecalPool, type Decal } from './decals';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { waveHitPlow } from '../combat/shared';

/* THE CHAIRMAN's arena props (PROTOCOL C wave 7), owned by the EnemyManager (update / clear) and driven by his AI
 * (enemies/chairman.ts). Everything is pooled and built once (prewarm: hidden, so the warm-up compiles it):
 *  - BRIEFCASE CANNON: up to MAX_CASES briefcases in flight (two InstancedMeshes: leather + gold trim), each with a
 *    filling gold ring on its landing spot from the moment it is aimed. A landing bursts into paper and confetti; a
 *    plow inside takes the hit and a short daze.
 *  - QUARTERLY REPORTS: one paper storm (an InstancedMesh of STORM_PAPERS sheets with up-arrow charts, scaled by the
 *    quality preset's fxScale) swirling round a centre that drifts after the plow; inside it the plow is slowed, and
 *    while it blows the HUD minimap is scrambled (`scramble`).
 *  - HOSTILE TAKEOVER: the gold beam from the fingertip to an echo (a thin flickering telegraph, then a thick bright
 *    beam) and the ACQUIRED stamp riding over the acquired echo.
 * No per-frame allocation: scratch vectors, fixed pools. */

const MAX_CASES = 9;
/** Paper sheets in a full storm (HIGH / MEDIUM; LOW halves it). */
export const STORM_PAPERS = 150;
/** Storm sheets sit in a ring between STORM_IN x r and r of the centre, from 0.3 to STORM_TOP m up. */
const STORM_IN = 0.25;
const STORM_TOP = 6;
/** The storm centre drifts after the plow at this speed (m/s). */
const STORM_DRIFT = 2.2;
const GOLD = 0xffc233;
const CASE_RING = 0xff9a10;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

interface Case {
  active: boolean;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Seconds until launch (the ring fills meanwhile), then flight time. */
  wait: number;
  waitDur: number;
  t: number;
  dur: number;
  r: number;
  dmg: number;
  daze: number;
  spin: number;
  /** Seconds to the next paper sheet shed along the flight. */
  trail: number;
  owner: Bot | null;
  ring: Decal | null;
  fill: Decal | null;
}

interface Storm {
  x: number;
  z: number;
  r: number;
  /** Wind-up left (s; papers gather, the ring fills), then the storm's own time left. */
  wind: number;
  windDur: number;
  t: number;
  dur: number;
  slow: number;
}

let _paperTex: THREE.Texture | null = null;
/** A report sheet: white page, a title bar, a gold bar chart with a big red up arrow. */
function paperTexture(): THREE.Texture {
  if (_paperTex) return _paperTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 80;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbfaf4';
  g.fillRect(0, 0, 64, 80);
  g.fillStyle = '#1b2236';
  g.fillRect(6, 6, 52, 7);
  g.fillStyle = '#c9a227';
  for (let i = 0; i < 4; i++) g.fillRect(10 + i * 12, 64 - (i + 1) * 9, 8, (i + 1) * 9);
  g.strokeStyle = '#d0102a';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(8, 60);
  g.lineTo(50, 22);
  g.stroke();
  g.fillStyle = '#d0102a';
  g.beginPath();
  g.moveTo(56, 16);
  g.lineTo(42, 20);
  g.lineTo(52, 30);
  g.closePath();
  g.fill();
  g.fillStyle = '#9aa0aa';
  for (let i = 0; i < 3; i++) g.fillRect(8, 68 + i * 4, 48 - i * 10, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _paperTex = t;
  return t;
}

let _stampTex: THREE.Texture | null = null;
/** The ACQUIRED stamp: red ink in a rounded frame, a little rotated. */
function stampTexture(): THREE.Texture {
  if (_stampTex) return _stampTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.translate(128, 48);
  g.rotate(-0.12);
  g.strokeStyle = '#e8b423';
  g.lineWidth = 8;
  g.strokeRect(-116, -34, 232, 68);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '900 46px "Arial Black", Impact, sans-serif';
  g.fillStyle = '#ffd24a';
  g.fillText('ACQUIRED', 0, 3, 210);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _stampTex = t;
  return t;
}

class ChairmanProps {
  private ctx: GameContext | null = null;
  private builtFor: THREE.Scene | null = null;
  private decals: DecalPool | null = null;
  private caseBody: THREE.InstancedMesh | null = null;
  private caseTrim: THREE.InstancedMesh | null = null;
  private cases: Case[] = [];
  private papers: THREE.InstancedMesh | null = null;
  /** Per sheet: angle, radius share, height, spin phase, angular speed (fixed at build). */
  private paperA = new Float32Array(STORM_PAPERS * 5);
  private storm: Storm | null = null;
  private stormRing: Decal | null = null;
  private stormFill: Decal | null = null;
  private beamMesh: THREE.Mesh | null = null;
  private beamMat: THREE.MeshBasicMaterial | null = null;
  private beamT = 0;
  private beamDur = 1;
  private beamFire = false;
  private beamFrom = new THREE.Vector3();
  private beamTo: Bot | null = null;
  private stamp: THREE.Sprite | null = null;
  private stampOn: Bot | null = null;
  private time = 0;
  /** 0..1: how hard the HUD minimap is scrambled right now (the paper storm). */
  scramble = 0;

  private depth = (x: number, z: number): number => (this.ctx?.snow ? this.ctx.snow.getDepth(x, z) : 0);

  /** Build the meshes now (hidden) so the warm-up compiles them before the fight (render/warmup.ts). */
  prewarm(scene: THREE.Scene): void {
    this.build(scene);
  }

  private init(ctx: GameContext): void {
    if (this.ctx === ctx) return;
    this.ctx = ctx;
    this.build(ctx.scene);
  }

  private build(scene: THREE.Scene): void {
    if (this.builtFor === scene) return;
    this.builtFor = scene;
    this.cases.length = 0;
    this.storm = null;
    this.stormRing = this.stormFill = null;
    this.decals = new DecalPool(scene);
    const leather = new THREE.MeshStandardMaterial({ color: 0x7a4a26, roughness: 0.5, flatShading: true, emissive: 0x2a1406, emissiveIntensity: 1 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xf2c033, roughness: 0.3, metalness: 0.45, emissive: 0x3a2400, emissiveIntensity: 0.4, flatShading: true });
    this.caseBody = new THREE.InstancedMesh(new THREE.BoxGeometry(1.3, 0.95, 0.42), leather, MAX_CASES);
    // gold trim: the clasp band round the top and a handle
    const trimGeo = mergeGeometries([
      new THREE.BoxGeometry(1.36, 0.16, 0.46).translate(0, 0.38, 0),
      new THREE.BoxGeometry(0.5, 0.1, 0.12).translate(0, 0.62, 0),
      new THREE.BoxGeometry(0.08, 0.2, 0.12).translate(-0.22, 0.52, 0),
      new THREE.BoxGeometry(0.08, 0.2, 0.12).translate(0.22, 0.52, 0),
    ])!;
    this.caseTrim = new THREE.InstancedMesh(trimGeo, trim, MAX_CASES);
    for (const im of [this.caseBody, this.caseTrim]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = 0;
      im.castShadow = true;
      im.frustumCulled = false;
      im.visible = false;
      scene.add(im);
    }
    for (let i = 0; i < MAX_CASES; i++) {
      this.cases.push({ active: false, x0: 0, y0: 0, z0: 0, x1: 0, z1: 0, wait: 0, waitDur: 1, t: 0, dur: 1, r: 1, dmg: 0, daze: 0, spin: 0, trail: 0, owner: null, ring: null, fill: null });
    }
    const paperMat = new THREE.MeshStandardMaterial({ map: paperTexture(), roughness: 0.8, side: THREE.DoubleSide, emissive: 0x404040, emissiveIntensity: 0.6 });
    this.papers = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.62, 0.78), paperMat, STORM_PAPERS);
    this.papers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.papers.count = 0;
    this.papers.frustumCulled = false;
    this.papers.visible = false;
    scene.add(this.papers);
    // fixed per-sheet orbit parameters (deterministic: no gameplay RNG drawn)
    for (let i = 0; i < STORM_PAPERS; i++) {
      const o = i * 5;
      const h = (i * 0.618034) % 1;
      this.paperA[o] = i * 2.39996;
      this.paperA[o + 1] = STORM_IN + (1 - STORM_IN) * Math.sqrt((i * 0.7548777) % 1);
      this.paperA[o + 2] = 0.3 + (STORM_TOP - 0.3) * h;
      this.paperA[o + 3] = i * 1.7;
      this.paperA[o + 4] = 0.9 + ((i * 0.381966) % 1) * 1.1;
    }
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xffd257, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.beamMesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0), this.beamMat);
    this.beamMesh.frustumCulled = false;
    this.beamMesh.visible = false;
    this.beamMesh.renderOrder = 6;
    scene.add(this.beamMesh);
    this.stamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: stampTexture(), transparent: true, depthWrite: false, toneMapped: false }));
    this.stamp.scale.set(3.4, 1.3, 1);
    this.stamp.visible = false;
    this.stamp.renderOrder = 7;
    scene.add(this.stamp);
    const d = this.decals;
    for (const x of [d.ring(false), d.ring(true)]) d.release(x);
  }

  /* ------------------------------------------------------------------ API for the AI */

  /** Briefcases in the air or waiting on their ring. */
  get casesLive(): number {
    let n = 0;
    for (const c of this.cases) if (c.active) n++;
    return n;
  }
  get stormActive(): boolean {
    return !!this.storm;
  }
  /** The storm (wind-up or blowing): centre / radius, for tests and the HUD. */
  get stormInfo(): Readonly<Storm> | null {
    return this.storm;
  }

  /** Aim a briefcase from (x0, y0, z0) at (x1, z1): its ring fills for `wait` s, then it flies `dur` s and bursts
   *  (radius r, `dmg` raw damage x the owner's outgoing multipliers, `daze` s). False when the pool is full. */
  lob(h: Host, owner: Bot, x0: number, y0: number, z0: number, x1: number, z1: number, wait: number, dur: number, r: number, dmg: number, daze: number): boolean {
    this.init(h.ctx);
    const c = this.cases.find((k) => !k.active);
    if (!c) return false;
    c.active = true;
    c.x0 = x0;
    c.y0 = y0;
    c.z0 = z0;
    c.x1 = x1;
    c.z1 = z1;
    c.wait = c.waitDur = Math.max(0, wait);
    c.t = 0;
    c.dur = Math.max(0.2, dur);
    c.r = r;
    c.dmg = dmg;
    c.daze = daze;
    c.spin = 0;
    c.trail = 0;
    c.owner = owner;
    c.ring = this.decals!.ring(false);
    c.fill = this.decals!.ring(true);
    return true;
  }

  /** Re-aim the launch point of the cases still waiting (the cannon moved). */
  setMuzzle(x: number, y: number, z: number): void {
    for (const c of this.cases) {
      if (!c.active || c.wait <= 0) continue;
      c.x0 = x;
      c.y0 = y;
      c.z0 = z;
    }
  }

  /** QUARTERLY REPORTS at (x, z): `wind` s of gathering paper and a filling ring, then `dur` s of storm. */
  startStorm(h: Host, x: number, z: number, r: number, wind: number, dur: number, slow: number): void {
    this.init(h.ctx);
    this.storm = { x, z, r, wind, windDur: Math.max(1e-3, wind), t: dur, dur, slow };
    this.stormRing ??= this.decals!.ring(false);
    this.stormFill ??= this.decals!.ring(true);
  }

  /** The finger's gold beam from `from` (world) to `to`: a telegraph (fire false) or the shot itself. */
  beam(h: Host, from: THREE.Vector3, to: Bot, dur: number, fire: boolean): void {
    this.init(h.ctx);
    this.beamFrom.copy(from);
    this.beamTo = to;
    this.beamT = this.beamDur = Math.max(1e-3, dur);
    this.beamFire = fire;
  }
  /** Move the beam's start (the finger tracks its target). */
  beamOrigin(from: THREE.Vector3): void {
    this.beamFrom.copy(from);
  }

  /** Show the ACQUIRED stamp over `bot` (null = hide). */
  stampOver(bot: Bot | null): void {
    this.stampOn = bot;
  }

  /* ------------------------------------------------------------------ per frame */

  update(h: Host, dt: number): void {
    const ctx = h.ctx;
    if (this.ctx !== ctx) {
      if (!h.findBoss('chairman')) return;
      this.init(ctx);
    }
    this.time += dt;
    // the owner fell (or every Chairman is gone): the storm blows out, cases in the air still land (harmless rings stop)
    if (!h.findBoss('chairman')) {
      if (this.storm && this.storm.wind > 0) this.storm = null;
      this.beamTo = null;
      this.stampOn = null;
    }
    this.updateCases(h, dt);
    this.updateStorm(h, dt);
    this.updateBeam(dt);
    const st = this.stamp!;
    const sb = this.stampOn;
    if (sb && sb.alive) {
      st.visible = true;
      st.position.set(sb.position.x, sb.position.y + sb.rig.height + 1.6 + Math.sin(this.time * 3) * 0.12, sb.position.z);
      st.material.opacity = 0.85 + 0.15 * Math.sin(this.time * 9);
    } else st.visible = false;
    this.decals!.update(dt, this.depth);
  }

  clear(ctx: GameContext): void {
    this.scramble = 0;
    if (this.ctx !== ctx) return;
    for (const c of this.cases) this.drop(c);
    this.storm = null;
    this.stormRing = this.decals!.release(this.stormRing);
    this.stormFill = this.decals!.release(this.stormFill);
    this.decals!.clear();
    this.beamTo = null;
    this.beamMesh!.visible = false;
    this.stampOn = null;
    this.stamp!.visible = false;
    this.papers!.visible = false;
    this.papers!.count = 0;
    this.syncCases();
  }

  /* ------------------------------------------------------------------ internals */

  private drop(c: Case): void {
    c.active = false;
    c.owner = null;
    c.ring = this.decals!.release(c.ring);
    c.fill = this.decals!.release(c.fill);
  }

  private updateCases(h: Host, dt: number): void {
    const ctx = h.ctx;
    for (const c of this.cases) {
      if (!c.active) continue;
      const ring = c.ring!;
      const fill = c.fill!;
      ring.x = fill.x = c.x1;
      ring.z = fill.z = c.z1;
      ring.r0 = c.r - 0.35;
      ring.r1 = c.r;
      fill.r0 = 0;
      // the fill grows over the whole wait + flight: it reaches the edge as the case lands
      const total = c.waitDur + c.dur;
      const done = c.waitDur - Math.max(0, c.wait) + c.t;
      const p = Math.min(1, done / total);
      fill.r1 = c.r * p;
      ring.mat.color.setHex(CASE_RING);
      fill.mat.color.setHex(CASE_RING);
      ring.mat.opacity = 0.95 * (0.75 + 0.25 * Math.sin(this.time * 22));
      fill.mat.opacity = 0.3 + 0.3 * p;
      if (c.wait > 0) {
        c.wait -= dt;
        continue;
      }
      c.t += dt;
      c.spin += dt * 9;
      // loose pages flutter off it in flight
      if ((c.trail -= dt) <= 0) {
        c.trail = 0.09;
        caseAt(c, _v);
        ctx.fx.burst(_v, PAGE_TRAIL);
      }
      if (c.t >= c.dur) this.land(h, c, ctx);
    }
    this.syncCases();
  }

  private land(h: Host, c: Case, ctx: GameContext): void {
    const fx = ctx.fx;
    _v.set(c.x1, 0.9, c.z1);
    // paper + confetti burst
    fx.burst(_v, { color: 0xfbfaf4, count: 26, speed: 8, size: 0.26, gravity: 5, life: 1.5 });
    fx.burst(_v, { color: GOLD, count: 14, speed: 9, size: 0.12, gravity: 9, life: 0.9 });
    fx.burst(_v, { color: 0xc8102e, count: 8, speed: 8, size: 0.12, gravity: 9, life: 0.9 });
    fx.burst(_v, { color: 0x2a1a12, count: 6, speed: 6, size: 0.2, gravity: 16, life: 0.7 });
    _v.y = 0.1;
    fx.ring(_v, c.r, GOLD);
    fx.shake(0.3);
    h.sfx('thud', 0.8, 1.3, 0.05);
    const plow = ctx.plow;
    const owner = c.owner;
    if (owner && !plow.dead && Math.hypot(plow.position.x - c.x1, plow.position.z - c.z1) < c.r + plow.radius * 0.4 && plow.position.y < 2.5) {
      waveHitPlow(ctx, owner, c.dmg, { knockback: 7, unblockable: true, fromX: c.x1, fromZ: c.z1 });
      plow.daze?.(c.daze);
      _v.set(plow.position.x, plow.position.y + 3, plow.position.z);
      fx.floatText(_v, 'AUDITED!', '#ffd24a', 1.1);
    }
    this.drop(c);
  }

  private syncCases(): void {
    const body = this.caseBody;
    const trim = this.caseTrim;
    if (!body || !trim) return;
    let n = 0;
    for (const c of this.cases) {
      if (!c.active || c.wait > 0) continue;
      caseAt(c, _p);
      _q.setFromEuler(_e.set(c.spin, Math.atan2(c.x1 - c.x0, c.z1 - c.z0), c.spin * 0.3));
      _m.compose(_p, _q, _s.set(1.25, 1.25, 1.25));
      body.setMatrixAt(n, _m);
      trim.setMatrixAt(n, _m);
      n++;
    }
    for (const im of [body, trim]) {
      im.count = n;
      im.visible = n > 0;
      if (n > 0) im.instanceMatrix.needsUpdate = true;
    }
  }

  private updateStorm(h: Host, dt: number): void {
    const s = this.storm;
    const papers = this.papers!;
    if (!s) {
      this.scramble = Math.max(0, this.scramble - dt * 2);
      if (this.stormRing) this.stormRing = this.decals!.release(this.stormRing);
      if (this.stormFill) this.stormFill = this.decals!.release(this.stormFill);
      papers.visible = false;
      papers.count = 0;
      return;
    }
    const plow = h.ctx.plow;
    let dens: number;
    const ring = this.stormRing!;
    const fill = this.stormFill!;
    if (s.wind > 0) {
      s.wind -= dt;
      const p = 1 - Math.max(0, s.wind) / s.windDur;
      dens = 0.15 + 0.35 * p;
      ring.mat.opacity = 0.6 + 0.3 * Math.sin(this.time * 18);
      fill.r1 = s.r * p;
      fill.mat.opacity = 0.18 + 0.15 * p;
    } else {
      s.t -= dt;
      dens = Math.min(1, (s.dur - s.t) / 0.4) * Math.min(1, s.t / 0.6);
      // drift after the plow
      const dx = plow.position.x - s.x;
      const dz = plow.position.z - s.z;
      const dl = Math.hypot(dx, dz);
      if (dl > 0.5) {
        const step = Math.min(dl, STORM_DRIFT * dt);
        s.x += (dx / dl) * step;
        s.z += (dz / dl) * step;
      }
      ring.mat.opacity = 0.35;
      fill.r1 = s.r;
      fill.mat.opacity = 0.08;
      this.scramble = Math.min(1, this.scramble + dt * 4);
      if (!plow.dead && Math.hypot(plow.position.x - s.x, plow.position.z - s.z) < s.r) plow.slow?.(0.2, s.slow);
      if (s.t <= 0) {
        this.storm = null;
        return;
      }
    }
    ring.x = fill.x = s.x;
    ring.z = fill.z = s.z;
    ring.r0 = s.r - 0.3;
    ring.r1 = s.r;
    fill.r0 = 0;
    ring.mat.color.setHex(0xfbfaf4);
    fill.mat.color.setHex(0xffe08a);
    // the sheets: a swirling ring (LOW: half as many)
    const cap = scaleCount(STORM_PAPERS, currentPreset().fxScale);
    const n = Math.min(cap, Math.round(cap * dens));
    const t = this.time;
    const A = this.paperA;
    for (let i = 0; i < n; i++) {
      const o = i * 5;
      const a = A[o] + t * A[o + 4];
      const r = s.r * A[o + 1];
      const y = A[o + 2] + Math.sin(t * 1.3 + A[o + 3]) * 0.6;
      _p.set(s.x + Math.sin(a) * r, y, s.z + Math.cos(a) * r);
      _q.setFromAxisAngle(_up, a + A[o + 3]);
      _e.set(Math.sin(t * 3 + A[o + 3]) * 1.2, 0, Math.cos(t * 2.4 + A[o + 3]) * 0.9);
      _m.makeRotationFromEuler(_e);
      _q.multiply(_tmpQ.setFromRotationMatrix(_m));
      _m.compose(_p, _q, _s.set(1, 1, 1));
      papers.setMatrixAt(i, _m);
    }
    papers.count = n;
    papers.visible = n > 0;
    if (n > 0) papers.instanceMatrix.needsUpdate = true;
  }

  private updateBeam(dt: number): void {
    const mesh = this.beamMesh!;
    const mat = this.beamMat!;
    const to = this.beamTo;
    if (!to || !to.alive || this.beamT <= 0) {
      mesh.visible = false;
      this.beamTo = null;
      return;
    }
    this.beamT -= dt;
    const k = Math.max(0, this.beamT) / this.beamDur;
    _v.set(to.position.x, to.position.y + to.rig.height * 0.55, to.position.z).sub(this.beamFrom);
    const len = _v.length();
    if (len < 1e-3) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    mesh.position.copy(this.beamFrom);
    mesh.quaternion.setFromUnitVectors(_up, _v.multiplyScalar(1 / len));
    const w = this.beamFire ? 0.32 + 0.12 * Math.sin(this.time * 40) : 0.05;
    mesh.scale.set(w, len, w);
    mat.opacity = this.beamFire ? 0.95 * Math.min(1, k * 2.5) : 0.35 + 0.45 * (Math.sin(this.time * 30) > 0 ? 1 : 0) * (1 - k * 0.5);
  }

  /** Off-scene meshes for the warm-up set (render/warmup.ts): built hidden in the scene by prewarm(). */
  warmMeshes(): THREE.Object3D[] {
    return [this.caseBody, this.caseTrim, this.papers, this.beamMesh, this.stamp].filter((o): o is NonNullable<typeof o> => !!o);
  }
}

const _tmpQ = new THREE.Quaternion();
const PAGE_TRAIL = { color: 0xfbfaf4, count: 1, speed: 1.5, size: 0.2, gravity: 2, life: 0.9 };

/** A briefcase's position along its lob (a parabola over the straight line, higher for longer throws). */
function caseAt(c: Case, out: THREE.Vector3): THREE.Vector3 {
  const k = Math.min(1, c.t / c.dur);
  const arc = 4 * k * (1 - k) * (6 + Math.hypot(c.x1 - c.x0, c.z1 - c.z0) * 0.25);
  return out.set(c.x0 + (c.x1 - c.x0) * k, c.y0 + (0.6 - c.y0) * k + arc, c.z0 + (c.z1 - c.z0) * k);
}

export const chairmanProps = new ChairmanProps();
