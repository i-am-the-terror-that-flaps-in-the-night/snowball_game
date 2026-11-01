import * as THREE from 'three';
import { ARENA } from '../core/types';
import type { CameraRigAPI, GameContext } from '../core/types';
import { settings, shakeScale } from '../core/settings';
import type { RayHit } from '../world/Terrain';

/* Close-quarters follow: high and a bit back so the bots around the plow stay in view. */
const BACK = 12;
const UP = 10;
/** Brawl-size arenas: higher / further for situational awareness. */
const BIG_BACK = 14;
const BIG_UP = 12;
/** Extra pull-back (m) at full dash. */
const DASH_PULL = 3;
const AHEAD = 4;
const BASE_FOV = 60;
/** How far outside the walls the camera may drift (walls are ~2.5m tall at the ARENA edges). Kept tiny: the stands
 *  and venue sets start right behind the walls, and a camera out there sits inside them (a black screen). */
const WALL_SLACK = 0.5;
/** A camera that wanted to be outside the walls is held inside and lifted this much per metre it was pulled in. */
const WALL_LIFT = 0.9;
const MENU_RADIUS = 45;
const MENU_HEIGHT = 26;
const DASH_FOV_KICK = 12;
const DASH_FOV_SECONDS = 0.7;
const MAX_TRAUMA = 2;
/** Impact kick: critically damped spring (rad/s) — peaks ~1/KICK_W s after the hit, then settles. */
const KICK_W = 16;
/** Kick offset cap (m) and the share of it that also lifts the camera. */
const KICK_MAX = 1.6;
const KICK_LIFT = 0.25;
/** Impact FOV punch: seconds and cap (degrees). */
const PUNCH_SECONDS = 0.32;
const PUNCH_MAX = 10;
/** Ultimate kill-cam: orbit radius / height (m) around the shot, and how far it swings (rad). */
const CINE_RADIUS = 17;
const CINE_HEIGHT = 12;
const CINE_SWING = 0.7;
/** Share of the shot spent easing in / out of the follow camera. */
const CINE_IN = 0.25;
const CINE_OUT = 0.35;
/** Landing thump: metres of camera dip per m/s of touchdown speed, and its cap. */
const THUMP_PER = 0.035;
const THUMP_MAX = 0.9;
/** Terrain: follow-height smoothing (1/s) on the ground / in the air (the camera does not ride every bump of a jump). */
const HEIGHT_K = 8;
const HEIGHT_K_AIR = 2.5;
/** Occlusion: keep this far (m) in front of whatever blocks the view; pull-in / let-out rates (1/s). */
const OCCLUDE_PAD = 0.8;
const OCCLUDE_IN = 10;
const OCCLUDE_OUT = 2;
/** Focus height above the plow's feet the occlusion ray starts from. */
const FOCUS_UP = 1.4;

const _cine = new THREE.Vector3();
const _hit: RayHit = { t: 0, x: 0, y: 0, z: 0, what: 'ground' };

function damp(k: number, dt: number): number {
  return 1 - Math.exp(-k * dt);
}

function angleLerp(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Cheap smooth 1D value noise from summed sines. */
function noise(t: number, seed: number): number {
  return (
    Math.sin(t * 1.0 + seed) * 0.5 +
    Math.sin(t * 2.31 + seed * 1.7) * 0.3 +
    Math.sin(t * 5.13 + seed * 3.1) * 0.2
  );
}

export class CameraRig implements CameraRigAPI {
  private ctx: GameContext;
  private mode: 'follow' | 'menu' = 'menu';
  private pos = new THREE.Vector3(0, MENU_HEIGHT, MENU_RADIUS);
  private look = new THREE.Vector3();
  private heading = Math.PI;
  private fov = BASE_FOV;
  private trauma = 0;
  private t = 0;
  private orbit = 0;
  private needSnap = true;
  private tmpPos = new THREE.Vector3();
  private tmpLook = new THREE.Vector3();
  private kickT = 0;
  private kickDur = DASH_FOV_SECONDS;
  private kickAmt = 0;
  private wasDashing = false;
  private dashBlend = 0;
  private stopT = 0;
  private lastKick = 0;
  /** Impact kick spring: offset (m) + velocity, world space. */
  private kickOff = new THREE.Vector3();
  private kickVel = new THREE.Vector3();
  private punchT = 0;
  private punchAmt = 0;
  private tmpAim = new THREE.Vector3();
  /** Kill-cam: seconds left / total, focus point and the starting orbit angle. */
  private cineT = 0;
  private cineDur = 1;
  private cineX = 0;
  private cineZ = 0;
  private cineY = 0;
  private cineA = 0;
  /** Smoothed follow height (terrain arenas; flat arenas follow position.y directly, as always). */
  private followY = 0;
  private followInit = false;
  /** Occlusion pull-in: 0 = full distance, 1 = all the way to the focus (smoothed). */
  private occl = 0;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  setMode(mode: 'follow' | 'menu'): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'follow') {
      const plow = this.ctx.plow;
      if (plow) this.heading = plow.heading;
    }
    this.kickT = 0;
    this.cineT = 0;
    this.kickOff.set(0, 0, 0);
    this.kickVel.set(0, 0, 0);
    this.punchT = 0;
  }

  snap(): void {
    const plow = this.ctx.plow;
    if (plow) this.heading = plow.heading;
    this.computeTarget(0);
    this.pos.copy(this.tmpPos);
    this.look.copy(this.tmpLook);
    this.needSnap = false;
    this.apply();
  }

  addShake(intensity: number): void {
    // Scaled by the settings-menu "Screen shake" slider (0 = off) and "Reduce screen shake".
    this.trauma = Math.min(MAX_TRAUMA, this.trauma + intensity * shakeScale());
  }

  thump(impact: number): void {
    const a = Math.min(THUMP_MAX, Math.max(0, impact) * THUMP_PER) * shakeScale();
    if (a <= 0.001) return;
    // Same critically damped spring as the kick, pushed straight down.
    this.kickVel.y -= a * KICK_W * Math.E;
  }

  kick(dx: number, dz: number, amount: number): void {
    const a = amount * shakeScale();
    if (a <= 0.001) return;
    // Impulse that makes the critically damped spring peak at ~`a` metres.
    const v = a * KICK_W * Math.E;
    this.kickVel.x += dx * v;
    this.kickVel.z += dz * v;
    this.kickVel.y += a * KICK_LIFT * KICK_W * Math.E;
  }

  punchFov(degrees: number): void {
    const d = THREE.MathUtils.clamp(degrees * shakeScale(), -PUNCH_MAX, PUNCH_MAX);
    if (Math.abs(d) < 0.05) return;
    // A bigger punch overrides a smaller one still playing.
    const cur = this.punchT > 0 ? this.punchAmt * (this.punchT / PUNCH_SECONDS) : 0;
    if (Math.abs(d) < Math.abs(cur)) return;
    this.punchAmt = d;
    this.punchT = PUNCH_SECONDS;
  }

  /** Ultimate kill-cam: swing out to frame (x, z) for `seconds` (real time), then ease back to the follow. */
  cinematic(x: number, z: number, seconds: number, y?: number): void {
    if (this.mode !== 'follow' || seconds <= 0) return;
    this.cineX = x;
    this.cineZ = z;
    const t = this.ctx.terrain;
    this.cineY = y ?? (t && t.active ? t.surfaceAt(x, z).y : 0);
    this.cineDur = this.cineT = seconds;
    // Start from roughly where the camera already is, so the swing reads as a move, not a cut.
    this.cineA = Math.atan2(this.pos.x - x, this.pos.z - z);
  }

  /** Freeze the follow (not the shake) for `seconds` — impact hit-stop. */
  hitStop(seconds: number): void {
    this.stopT = Math.max(this.stopT, seconds);
  }

  /** Short FOV punch (degrees) that eases out over `seconds`. Dash triggers this automatically. */
  kickFov(amount: number, seconds = DASH_FOV_SECONDS): void {
    this.kickAmt = amount;
    this.kickDur = seconds;
    this.kickT = seconds;
  }

  private computeTarget(dt: number): void {
    const plow = this.ctx.plow;
    if (this.mode === 'menu' || !plow) {
      this.orbit += dt * 0.06;
      this.tmpPos.set(Math.sin(this.orbit) * MENU_RADIUS, MENU_HEIGHT, Math.cos(this.orbit) * MENU_RADIUS);
      this.tmpLook.set(0, 0, 0);
      return;
    }
    this.heading = dt > 0 ? angleLerp(this.heading, plow.heading, damp(3, dt)) : plow.heading;
    const sx = Math.sin(this.heading);
    const cz = Math.cos(this.heading);
    const p = plow.position;
    const max = this.ctx.stats.maxSpeed || 1;
    const big = ARENA.maxX > 50;
    const back = (big ? BIG_BACK : BACK) + 1.5 * Math.min(1.3, Math.max(0, plow.speed) / max) + DASH_PULL * this.dashBlend;
    const up = (big ? BIG_UP : UP) + 0.8 * this.dashBlend;
    let x = p.x - sx * back;
    let z = p.z - cz * back;
    // Keep the camera near the arena; when it is out past a wall, lift it so the wall never blocks the view.
    const lx = ARENA.minX - WALL_SLACK;
    const hx = ARENA.maxX + WALL_SLACK;
    const lz = ARENA.minZ - WALL_SLACK;
    const hz = ARENA.maxZ + WALL_SLACK;
    const outX = Math.max(0, lx - x, x - hx);
    const outZ = Math.max(0, lz - z, z - hz);
    x = THREE.MathUtils.clamp(x, lx, hx);
    z = THREE.MathUtils.clamp(z, lz, hz);
    const lift = Math.max(outX, outZ) * WALL_LIFT;
    // Height: flat arenas follow the plow's feet exactly as before; terrain arenas smooth it (a jump does not yank the
    // camera, a slope is followed quickly).
    const terr = this.ctx.terrain;
    let py = p.y;
    if (terr && (terr.active || plow.airborne)) {
      const want = plow.airborne ? (plow.surfaceY + p.y) * 0.5 : p.y;
      if (!this.followInit || dt <= 0) this.followY = want;
      else this.followY += (want - this.followY) * damp(plow.airborne ? HEIGHT_K_AIR : HEIGHT_K, dt);
      this.followInit = true;
      py = this.followY;
    } else this.followInit = false;
    this.tmpPos.set(x, py + up + lift, z);
    this.tmpLook.set(p.x + sx * AHEAD, py + 0.5, p.z + cz * AHEAD);
    if (this.cineT > 0) this.blendCinematic();
    if (terr && terr.active) this.occlude(dt, p.x, p.y + FOCUS_UP, p.z);
  }

  /**
   * Terrain / decks between the focus and the camera: pull the camera in along that line (fast) until it sees the
   * focus, let it back out slowly once clear. During the kill-cam the focus is the shot.
   */
  private occlude(dt: number, fx: number, fy: number, fz: number): void {
    if (this.cineT > 0) {
      const u = 1 - this.cineT / this.cineDur;
      const w = u < CINE_IN ? u / CINE_IN : u > 1 - CINE_OUT ? (1 - u) / CINE_OUT : 1;
      const k = w * w * (3 - 2 * w);
      fx += (this.cineX - fx) * k;
      fy += (this.cineY + FOCUS_UP - fy) * k;
      fz += (this.cineZ - fz) * k;
    }
    const tp = this.tmpPos;
    let dx = tp.x - fx;
    let dy = tp.y - fy;
    let dz = tp.z - fz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-3) return;
    dx /= len;
    dy /= len;
    dz /= len;
    const hit = this.ctx.terrain.raycast(fx, fy, fz, dx, dy, dz, len, _hit);
    const want = hit ? THREE.MathUtils.clamp(1 - (hit.t - OCCLUDE_PAD) / len, 0, 0.92) : 0;
    if (dt <= 0) this.occl = want;
    else this.occl += (want - this.occl) * damp(want > this.occl ? OCCLUDE_IN : OCCLUDE_OUT, dt);
    if (this.occl < 1e-4) return;
    const keep = 1 - this.occl;
    tp.set(fx + dx * len * keep, fy + dy * len * keep, fz + dz * len * keep);
  }

  /** Pull the follow target toward the kill-cam orbit (weight eases in, holds, eases out). */
  private blendCinematic(): void {
    const u = 1 - this.cineT / this.cineDur; // 0 -> 1
    const w = u < CINE_IN ? u / CINE_IN : u > 1 - CINE_OUT ? (1 - u) / CINE_OUT : 1;
    const k = w * w * (3 - 2 * w);
    const a = this.cineA + CINE_SWING * u;
    const cx = THREE.MathUtils.clamp(this.cineX + Math.sin(a) * CINE_RADIUS, ARENA.minX - WALL_SLACK, ARENA.maxX + WALL_SLACK);
    const cz = THREE.MathUtils.clamp(this.cineZ + Math.cos(a) * CINE_RADIUS, ARENA.minZ - WALL_SLACK, ARENA.maxZ + WALL_SLACK);
    this.tmpPos.lerp(_cine.set(cx, this.cineY + CINE_HEIGHT, cz), k);
    this.tmpLook.lerp(_cine.set(this.cineX, this.cineY + 0.5, this.cineZ), k);
  }

  update(dt: number): void {
    this.t += dt;
    if (this.cineT > 0) this.cineT = Math.max(0, this.cineT - dt);
    this.updateKick(dt);
    const plowD = this.ctx.plow;
    const dashingNow = this.mode === 'follow' && !!plowD && plowD.dashing;
    this.dashBlend += ((dashingNow ? 1 : 0) - this.dashBlend) * damp(dashingNow ? 10 : 2.5, dt);
    if (this.stopT > 0) {
      // Hit-stop: hold the frame, keep shaking.
      this.stopT = Math.max(0, this.stopT - dt);
      this.trauma = Math.max(0, this.trauma - 1.7 * dt);
      this.apply(this.lastKick);
      return;
    }
    this.computeTarget(dt);
    if (this.needSnap) {
      this.pos.copy(this.tmpPos);
      this.look.copy(this.tmpLook);
      this.needSnap = false;
    } else {
      // Dash: the camera lags a little behind the lunge.
      const kp = this.mode === 'menu' ? 1.2 : 6 - 2.8 * this.dashBlend;
      const kl = this.mode === 'menu' ? 1.5 : 8;
      this.pos.lerp(this.tmpPos, damp(kp, dt));
      this.look.lerp(this.tmpLook, damp(kl, dt));
    }

    // FOV: gentle speed widening + dash punch.
    let targetFov = BASE_FOV;
    const plow = this.ctx.plow;
    if (this.mode === 'follow' && plow) {
      const max = this.ctx.stats.maxSpeed || 1;
      targetFov = BASE_FOV + 5 * Math.min(1, Math.abs(plow.speed) / max);
      const dashing = plow.dashing;
      if (dashing && !this.wasDashing) this.kickFov(DASH_FOV_KICK);
      this.wasDashing = dashing;
    } else {
      this.wasDashing = false;
    }
    this.fov += (targetFov - this.fov) * damp(3, dt);
    let kick = 0;
    if (this.kickT > 0) {
      this.kickT = Math.max(0, this.kickT - dt);
      const u = 1 - this.kickT / this.kickDur; // 0 -> 1
      // Fast attack (first 20%), smooth ease-out.
      kick = this.kickAmt * (u < 0.2 ? u / 0.2 : 1 - ((u - 0.2) / 0.8) ** 2);
    }

    this.trauma = Math.max(0, this.trauma - 1.7 * dt);
    this.lastKick = kick;
    this.apply(kick);
  }

  private updateKick(dt: number): void {
    // Critically damped spring back to 0: x'' = -w^2 x - 2w x'.
    const w = KICK_W;
    const h = Math.min(dt, 1 / 30);
    const o = this.kickOff;
    const v = this.kickVel;
    v.x += (-w * w * o.x - 2 * w * v.x) * h;
    v.y += (-w * w * o.y - 2 * w * v.y) * h;
    v.z += (-w * w * o.z - 2 * w * v.z) * h;
    o.addScaledVector(v, h);
    if (o.lengthSq() > KICK_MAX * KICK_MAX) o.setLength(KICK_MAX);
    if (o.lengthSq() < 1e-8 && v.lengthSq() < 1e-6) {
      o.set(0, 0, 0);
      v.set(0, 0, 0);
    }
    if (this.punchT > 0) this.punchT = Math.max(0, this.punchT - dt);
  }

  private apply(fovKick = 0): void {
    const cam = this.ctx.camera;
    cam.position.copy(this.pos);
    if (this.mode === 'follow') {
      cam.position.add(this.kickOff);
      // The aim follows part of the shove, so the frame itself jolts (not just the parallax).
      cam.lookAt(this.tmpAim.copy(this.look).addScaledVector(this.kickOff, 0.4));
    } else cam.lookAt(this.look);
    const s = Math.pow(Math.min(this.trauma, MAX_TRAUMA), 1.5);
    if (s > 0.0005) {
      const tt = this.t * 24;
      // Offset in camera-local space so it doesn't depend on heading.
      cam.translateX(noise(tt, 1.3) * s * 0.85);
      cam.translateY(noise(tt, 7.7) * s * 0.65);
      cam.rotateZ(noise(tt, 4.2) * s * 0.05);
      cam.rotateX(noise(tt, 9.1) * s * 0.025);
    }
    let punch = 0;
    if (this.punchT > 0) {
      const u = 1 - this.punchT / PUNCH_SECONDS; // 0 -> 1
      // Snap in over the first 12%, ease back out.
      punch = this.punchAmt * (u < 0.12 ? u / 0.12 : (1 - (u - 0.12) / 0.88) ** 2);
    }
    const fov = this.fov + fovKick + punch;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }
}
