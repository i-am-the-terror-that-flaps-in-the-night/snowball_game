import { PlowMotion } from './plow/PlowMotion';
import * as THREE from 'three';
import {
  MIN_BALL_RADIUS,
  PLOW_SPAWN,
  ballVolume,
  type PlowAPI,
  type SoundName,
} from '../core/types';
import { ctxPilot, type PilotBinding } from './pilot';
import { NP } from '../net/protocol';
import { AIR_SLAM_MIN_HEIGHT } from './combat/air';
import {
  AIR_STEER, ICE_ACCEL, ICE_BRAKE, ICE_DRAG, ICE_GRIP, slopeAccel,
} from '../world/terrainMotion';
import {
  BLADE_Z, SAW_FURY_DEALT, SAW_FURY_TAKEN, SLAM_WINDUP, SLAM_LUNGE, SLAM_IMPACT_AT, SLAM_LUNGE_SPEED, DASH_SECONDS,
  DASH_EASE, DASH_STEER, DASH_STRIKE_KEEP, WHIRL_SPEED, WHIRL_STEER, SPAWN_PROTECT, INPUT_BUFFER, TRAIL_MIN_SPEED,
  SLOPE_BOOST_DECAY,
} from './plow/constants';
import { _fwd, _right, _a, _b, _dir } from './plow/scratch';

/* The player / pilot plow. The class is layered over ./plow/ (PlowBase -> PlowVisuals -> PlowMotion -> Plow; see
 * plow/PlowBase.ts); this top layer holds the public API, the duel netcode, reset and the per-frame update. */

/* Constant FX options for per-frame / per-hit paths (hoisted so they are not rebuilt per call; never mutated). */
const DASH_WAKE_BURST = { color: 0xffffff, count: 3, speed: 6, size: 0.26, gravity: 14, life: 0.6 };
const DASH_WAKE_SMOKE = { count: 1, color: 0xe2ecf8, size: 0.45, grow: 3.4, life: 0.8, speed: 2.5, up: 1.5, rise: -1, drag: 2.4, spread: 0.3, opacity: 0.5 };

export class Plow extends PlowMotion implements PlowAPI {
  /* ------------------------------------------------------------------ API */

  get dead(): boolean {
    return this._dead;
  }
  get dashReady(): number {
    return this.dashCharge;
  }
  get whirlReady(): number {
    return this.whirlCharge;
  }
  get dashing(): boolean {
    return this.dashT > 0;
  }
  get whirling(): boolean {
    return this.whirlT >= 0;
  }
  get sawHalo(): number {
    return this._sawHalo;
  }
  feedSawFury(dealt: number, taken: number): void {
    if (this.kind !== 'brute' || this.b.stats.sawDps <= 0 || this._dead) return;
    this.sawFury = Math.min(1, this.sawFury + dealt / SAW_FURY_DEALT + taken / SAW_FURY_TAKEN);
  }
  get airborne(): boolean {
    return this.vert.airborne;
  }
  get vy(): number {
    return this.vert.vy;
  }
  get airTime(): number {
    return this.vert.airborne ? this.vert.airTime : 0;
  }
  get deck(): number {
    return this.vert.deck;
  }
  get surfaceY(): number {
    return this.vert.surfaceY;
  }
  /** 0..1 how much the plow is on ice right now (HUD / probes). */
  get onIce(): number {
    return this.ice;
  }
  /** Material under the plow (last terrain step). */
  get material(): string {
    return this.surf.material;
  }
  /** Air slam: dive at `speed` m/s (only while airborne). */
  dive(speed: number): void {
    if (!this.vert.airborne || this._dead) return;
    this.vert.vy = -Math.abs(speed);
  }

  /** Re-bind this plow to another pilot (the online Duel), or back to the single-player singletons (null). */
  bind(binding: PilotBinding | null): void {
    this.b = binding ?? ctxPilot(this.ctx);
    this.applyStats(this.b.stats);
    this.syncLook(true);
  }

  get pilot(): PilotBinding {
    return this.b;
  }

  /** The Paint Shop horn on this plow (slam sound layer), if any. */
  get hornSound(): SoundName | null {
    return this.look.horn.sound;
  }

  /** Show / hide the whole plow and its world-space parts (the duel's second plow sits out single-player modes). */
  setInWorld(on: boolean): void {
    this.object.visible = on;
    if (!on) {
      this.ball.visible = false;
      this.glow.visible = false;
      this.tornado.visible = false;
      this.whirlRing.visible = false;
      this.ballWasVisible = false;
      for (const g of this.ghosts) {
        g.active = false;
        g.group.visible = false;
      }
      for (const st of this.streaks) st.active = false;
      this.updateStreaks(0);
      for (const d of this.debris) if (d.popped) d.obj.visible = false;
    } else {
      for (const d of this.debris) d.obj.visible = true;
    }
    this.streakMesh.visible = on;
  }

  /* ------------------------------------------------------------------ duel netcode */

  /** Pack the network-visible state into `out` at offset `o` (layout: NET_PLOW in net/protocol.ts). */
  writeNet(out: Float32Array, o: number): void {
    out[o + NP.x] = this.position.x;
    out[o + NP.z] = this.position.z;
    out[o + NP.heading] = this.heading;
    out[o + NP.speed] = this.speed;
    out[o + NP.hp] = this.hp;
    out[o + NP.maxHp] = this.maxHp;
    out[o + NP.ball] = this.heldVolume;
    out[o + NP.dashCharge] = this.dashCharge;
    out[o + NP.whirlCharge] = this.whirlCharge;
    out[o + NP.dashT] = this.dashT;
    out[o + NP.dashEase] = this.dashEase;
    out[o + NP.whirlT] = this.whirlT;
    out[o + NP.slamPhase] = this.slamPhase;
    out[o + NP.slamT] = this.slamT;
    out[o + NP.hop] = this.hop;
    out[o + NP.spawnProt] = this.spawnProt;
    out[o + NP.dead] = this._dead ? 1 : 0;
    out[o + NP.pushX] = this.pushVel.x;
    out[o + NP.pushZ] = this.pushVel.z;
    out[o + NP.throttle] = this._dead ? 0 : this.b.input.throttle;
    out[o + NP.steer] = this._dead ? 0 : this.b.input.steer;
    out[o + NP.sawFury] = this.sawFury;
    out[o + NP.y] = this.position.y;
    out[o + NP.vy] = this.vert.vy;
    out[o + NP.air] = this.vert.airborne ? 1 : 0;
  }

  /**
   * Duel guest, own plow: pull the locally predicted plow toward the host's view of it. `tx/tz/th` is the host pose
   * (already extrapolated by the caller), `k` the blend fraction this frame (1 = snap). Health, death and the ball
   * follow the host; charges follow it unless the pilot just used that ability locally (`keep*`), so a stale
   * snapshot never re-arms a dash the host has not seen yet.
   */
  netCorrect(s: Float32Array, o: number, tx: number, tz: number, th: number, k: number, keepBall: boolean, keepDash: boolean, keepWhirl: boolean): void {
    const dead = s[o + NP.dead] > 0.5;
    if (!this._dead) {
      this.position.x += (tx - this.position.x) * k;
      this.position.z += (tz - this.position.z) * k;
      let dh = th - this.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.heading += dh * k;
    }
    this.maxHp = s[o + NP.maxHp];
    const hp = s[o + NP.hp];
    if (dead && !this._dead) this.damage(this.hp + 1);
    else if (!this._dead) {
      if (hp < this.hp - 0.01) this.damage(this.hp - hp);
      else this.hp = hp;
    }
    if (this._dead) return;
    if (!keepBall) this.heldVolume = s[o + NP.ball];
    if (!keepDash) this.dashCharge = s[o + NP.dashCharge];
    if (!keepWhirl) this.whirlCharge = s[o + NP.whirlCharge];
    this.spawnProt = s[o + NP.spawnProt];
    this.sawFury = s[o + NP.sawFury];
  }

  /** Duel guest: shove the predicted plow right away when the host reports a knockback on it. */
  netPush(vx: number, vz: number): void {
    this.push(vx, vz);
  }

  /**
   * Duel guest, opponent plow: no simulation at all. Pose, health, ball and ability timers come from the
   * (interpolated) snapshot in `s` at `o`; this only animates them and replays the launch effects (dash blast,
   * whirl tornado + its ticks, wreck explosion) when they start.
   */
  updatePuppet(dt: number, s: Float32Array, o: number): void {
    const stats = this.b.stats;
    this.time += dt;
    if (stats.bladeWidth !== this.bladeWidth) this.setBladeWidth(stats.bladeWidth);
    if (stats.maxHp !== this.maxHp) this.applyStats(stats);
    this.gearVis.update(this.time);
    const dead = s[o + NP.dead] > 0.5;
    const prevHeading = this.heading;
    this.position.x = s[o + NP.x];
    this.position.z = s[o + NP.z];
    this.heading = s[o + NP.heading];
    // Height / flight from the host (updateVisuals places the hull with it). Launches and landings replay locally like
    // the host's own: jump sound; land sound, squash, snow puff and (hard landings) ring, at the touchdown speed (the
    // last airborne vy). No events (Combat's AirKit polls the puppet for stomps / air slams on the host's side only).
    const wasAir = this.puppetAir;
    const lastVy = this.puppetVy;
    this.puppetY = s[o + NP.y];
    this.puppetVy = s[o + NP.vy];
    this.puppetAir = s[o + NP.air] > 0.5;
    if (!dead && !this._dead) {
      if (!wasAir && this.puppetAir) this.b.audio.play('jump', { volume: 0.8 });
      else if (wasAir && !this.puppetAir) {
        const t = this.ctx.terrain;
        const ground = t.active ? t.heightAt(this.position.x, this.position.z, this.puppetY) : 0;
        this.landFx(Math.max(0, -lastVy), ground);
      }
    }
    this.speed = s[o + NP.speed];
    this.maxHp = s[o + NP.maxHp];
    if (dead && !this._dead) {
      this.hp = 0;
      this.die();
    } else if (!dead && this._dead) {
      this.reset({ x: this.position.x, z: this.position.z, heading: this.heading });
    }
    this.updateGhosts(dt);
    this.updateStreaks(dt);
    this.updateTornado(dt);
    if (this._dead) {
      this.updateWreck(dt);
      return;
    }
    const hp = s[o + NP.hp];
    if (hp < this.hp - 0.5) {
      this.flash = 1;
      this.jitter = Math.min(0.2, 0.08 + (this.hp - hp) * 0.004);
    }
    this.hp = hp;
    this.heldVolume = s[o + NP.ball];
    this.dashCharge = s[o + NP.dashCharge];
    this.whirlCharge = s[o + NP.whirlCharge];
    this.spawnProt = s[o + NP.spawnProt];
    if (this.spawnProt > 0) this.body.visible = Math.floor(this.spawnProt * 14) % 2 === 0;
    else this.body.visible = true;
    this.sawFury = s[o + NP.sawFury];
    this.hop = s[o + NP.hop];
    this.slamPhase = s[o + NP.slamPhase] as 0 | 1 | 2;
    this.slamT = s[o + NP.slamT];
    this.lungeVel = 0;
    // Dash: replay the launch once, then follow the host's timers (flame, ghosts and streaks key off them).
    const dT = s[o + NP.dashT];
    if (dT > 0 && this.dashT <= 0 && dT > DASH_SECONDS - 0.3) {
      this.ghostT = 0;
      this.streakT = 0;
      this.kick = Math.max(this.kick, 0.8);
      this.dashFx();
    }
    this.dashT = dT;
    this.dashEase = s[o + NP.dashEase];
    // Whirl: run the local tornado up to the host's whirl clock (ticks replay their sprays and sounds; the puppet's
    // Combat has nothing to hit).
    const wT = s[o + NP.whirlT];
    if (wT >= 0) {
      // Only a fresh whirl starts one (the local tornado can finish a frame before the host's clock does).
      if (this.whirlT < 0 && wT < 0.4) {
        this.whirlT = 0;
        this.whirlTick = 0;
        this.whirlHits.clear();
        this.whirlFx();
      }
      if (this.whirlT >= 0 && wT > this.whirlT) this.updateWhirl(wT - this.whirlT);
    } else if (this.whirlT >= 0) {
      this.whirlT = -1;
      this.spinAngle = 0;
    }
    let dh = this.heading - prevHeading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const turn = dt > 0 ? dh / dt : 0;
    const throttle = s[o + NP.throttle];
    this.updateVisuals(dt, turn, throttle);
    if (this.dashT > 0 || Math.abs(this.speed) > TRAIL_MIN_SPEED) this.emitTrail(dt, this.dashT > 0);
  }

  /** Freeze the plow for `seconds` (impact hit-stop). */
  hitStop(seconds: number): void {
    this.hitStopT = Math.max(this.hitStopT, seconds);
  }

  /** Called by Combat on a DASH STRIKE: hit-stop, then keep dashing at reduced speed. */
  dashImpact(stop: number): void {
    this.hitStop(stop);
    if (this.dashT > 0) {
      this.dashSpeed *= DASH_STRIKE_KEEP;
      this.speed = this.dashSpeed;
    }
    this.kick = 1;
    this.jitter = Math.max(this.jitter, 0.15);
  }

  /** ARSENAL mounts in world space: the pulse emitter tip ('muzzle', i wraps), the Grav Lance nose lens ('laser') or
   *  the gyro core at the rear ('gyro'). */
  mountWorld(kind: 'muzzle' | 'laser' | 'gyro', i: number, out: THREE.Vector3): THREE.Vector3 {
    const o = kind === 'laser' ? this.laserMount : kind === 'muzzle' ? this.muzzles[i % this.muzzles.length] : this.gyroMount;
    this.body.updateWorldMatrix(true, true);
    return o.getWorldPosition(out);
  }

  /** World heading the ARSENAL turret is pointing (hull heading + turret yaw). */
  get turretHeading(): number {
    return this.heading + this.turretYaw;
  }

  damage(amount: number): void {
    if (this._dead || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    this.flash = 1;
    this.jitter = Math.min(0.2, 0.08 + amount * 0.004);
    if (this.hp <= 0) this.die();
  }

  stealSnow(fraction: number): number {
    const f = THREE.MathUtils.clamp(fraction, 0, 1);
    const v = this.heldVolume * f;
    this.heldVolume -= v;
    if (this.heldVolume < 1e-4) this.heldVolume = 0;
    return v;
  }

  push(vx: number, vz: number): void {
    if (this._dead) return;
    this.pushVel.x += vx;
    this.pushVel.z += vz;
  }

  reset(at?: { x: number; z: number; heading: number }): void {
    const sp = at ?? PLOW_SPAWN;
    this.position.set(sp.x, 0, sp.z);
    this.heading = sp.heading;
    // Terrain: start on the topmost surface at the spawn point (flat arenas: 0, as always).
    const t = this.ctx.terrain;
    const v = this.vert;
    v.surfaceY = t && t.active ? t.surfaceAt(sp.x, sp.z, Infinity, this.surf).y : 0;
    v.deck = t && t.active ? this.surf.deck : -1;
    v.y = v.surfaceY;
    v.vy = 0;
    v.airborne = false;
    v.airTime = 0;
    this.position.y = v.y;
    this.ride = 0;
    this.slopeBoost = 0;
    this.velX = this.velZ = 0;
    this.ice = 0;
    this.burn = 0;
    this.lavaAcc = 0;
    this.lavaEventT = 0;
    this.lavaSfxT = 0;
    this.tiltP = this.tiltR = 0;
    this.squash = 0;
    this.spawnProt = at ? SPAWN_PROTECT : 0;
    this.dashEase = 0;
    this.dashSpeed = 0;
    this.hitStopT = 0;
    this.whirlTick = 0;
    this.sawFury = 0;
    this._sawHalo = 0;
    this.tornadoA = 0;
    this.ringPulse = 0;
    this.tornado.visible = false;
    this.whirlRing.visible = false;
    for (const st of this.streaks) st.active = false;
    this.streakT = 0;
    this.object.rotation.set(0, this.heading, 0);
    this.speed = 0;
    this.lastSpeed = 0;
    this.pushVel.set(0, 0, 0);
    this.hp = this.maxHp;
    this._dead = false;
    this.heldVolume = 0;
    this.ballR = 0;
    this.slamPhase = 0;
    this.slamT = 0;
    this.slamCd = 0;
    this.slamHit = false;
    this.slamBuffer = 0;
    this.lungeVel = 0;
    this.dashCharge = 1;
    this.dashT = 0;
    this.whirlCharge = 1;
    this.whirlT = -1;
    this.whirlHits.clear();
    this.spinAngle = 0;
    this.wallCd = 0;
    this.flash = 0;
    this.jitter = 0;
    this.kick = 0;
    this.slamPose = 0;
    this.roll = 0;
    this.pitch = 0;
    this.wreckT = 0;
    this.ball.visible = false;
    this.ballWasVisible = false;
    this.glow.visible = false;
    this.flame.visible = false;
    this.spin.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.visible = true;
    this.paintMat.color.copy(this.paintBase);
    this.bedMat.color.copy(this.bedBase);
    this.decalMat.color.setRGB(1, 1, 1);
    this.bladeSkinMat.color.setRGB(1, 1, 1);
    this.bladeSkinMat.emissiveIntensity = 0;
    this.paintMat.emissiveIntensity = 0;
    this.bedMat.emissiveIntensity = 0;
    this.headMat.emissiveIntensity = 1.6;
    this.beaconMat.emissiveIntensity = 1;
    for (const d of this.debris) {
      if (d.popped) {
        d.parent.add(d.obj);
        d.popped = false;
      }
      d.obj.position.copy(d.pos);
      d.obj.quaternion.copy(d.quat);
      d.obj.scale.set(1, 1, 1);
    }
    // (Wheels 0 and 3 are debris parts: their pose resets with the rest.)
    this.wheelSpin[0] = this.wheelSpin[3] = 0;
    this.wheelSteer[0] = 0;
    this.wheelsOff = false;
    for (const w of this.wheelDebris) w.visible = false;
    this.writeWheels();
    this.applyBladeScale();
    this.hop = 0;
    this.spin.position.y = 0;
    for (const g of this.ghosts) {
      g.active = false;
      g.group.visible = false;
    }
    this.updateStreaks(0);
  }

  /** E charge 0..1 (the whirl on the Classic, the kit's E ability on the other vehicles). */
  get eCharge(): number {
    return this.whirlCharge;
  }

  /** Combat spends the E charge when a vehicle kit's secondary ability goes off. */
  spendE(): void {
    this.whirlCharge = 0;
  }

  /* ------------------------------------------------------------------ update */

  update(dt: number): void {
    const ctx = this.ctx;
    const b = this.b;
    const stats = b.stats;
    this.time += dt;
    this.puppetY = null;
    if (stats.bladeWidth !== this.bladeWidth) this.setBladeWidth(stats.bladeWidth);
    if (stats.maxHp !== this.maxHp) this.applyStats(stats);
    this.updateGhosts(dt);
    this.updateStreaks(dt);
    this.updateTornado(dt);

    if (this._dead) {
      this.updateWreck(dt);
      return;
    }

    // Spawn protection: blink.
    if (this.spawnProt > 0) {
      this.spawnProt = Math.max(0, this.spawnProt - dt);
      this.body.visible = this.spawnProt <= 0 || Math.floor(this.spawnProt * 14) % 2 === 0;
    }

    // Impact hit-stop: hold everything still for a few frames.
    if (this.hitStopT > 0) {
      this.hitStopT -= dt;
      if (b.input.wasPressed('Space')) this.slamBuffer = INPUT_BUFFER;
      this.jitter = Math.max(this.jitter, 0.1);
      return;
    }

    const input = b.input;
    const snow = b.snow;
    const maxBallR = stats.maxBallRadius;

    // ---- regen + timers
    if (stats.hpRegen > 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + stats.hpRegen * dt);
    if (this.slamCd > 0) this.slamCd -= dt;
    if (this.slamBuffer > 0 && this.whirlT < 0) this.slamBuffer -= dt;
    if (this.wallCd > 0) this.wallCd -= dt;
    if (this.dashT > 0) {
      this.dashT = Math.max(0, this.dashT - dt);
      if (this.dashT <= 0) this.dashEase = DASH_EASE;
    } else {
      if (this.dashEase > 0) this.dashEase = Math.max(0, this.dashEase - dt);
      if (this.dashCharge < 1) this.dashCharge = Math.min(1, this.dashCharge + (stats.dashCooldown > 0 ? dt / stats.dashCooldown : 1));
    }
    // E charge: the whirl's on the Classic; on the other vehicles the kit's E ability (Combat spends it, the kit's
    // ability descriptor sets the recharge).
    const eCd = this.vehicle ? b.combat.secondaryCooldown : stats.whirlCooldown;
    if (this.whirlT < 0 && this.whirlCharge < 1) this.whirlCharge = Math.min(1, this.whirlCharge + (eCd > 0 ? dt / eCd : 1));

    const throttle = input.throttle;
    const steer = input.steer;

    // ---- abilities
    if (input.wasPressed('Space')) this.slamBuffer = INPUT_BUFFER;
    // Only the Classic plows snow, holds a ball and slams / whirls: every other vehicle's SPACE / E belong to its
    // combat kit (Combat.updateVehicle routes them to VehicleKit.primary / secondary).
    const armed = this.vehicle;
    // Airborne and clear of the surface, SPACE is the air slam (Combat's AirKit dives, ball or not): no ground slam,
    // and no 'error' buzz for a missing ball.
    if (armed || (this.vert.airborne && this.vert.y - this.vert.surfaceY >= AIR_SLAM_MIN_HEIGHT)) this.slamBuffer = 0;
    if (this.slamBuffer > 0 && this.slamPhase === 0 && this.slamCd <= 0 && this.whirlT < 0) {
      this.slamBuffer = 0;
      if (this.heldBallRadius >= MIN_BALL_RADIUS) {
        this.slamPhase = 1;
        this.slamT = 0;
        this.slamHit = false;
      } else {
        b.audio.play('error');
      }
    }
    if (input.wasPressed('ShiftLeft') || input.wasPressed('ShiftRight')) this.tryDash();
    if (!armed && input.wasPressed('KeyE')) this.tryWhirl();

    // ---- slam state machine
    this.lungeVel = 0;
    if (this.slamPhase === 1) {
      this.slamT += dt;
      this.speed *= Math.exp(-4 * dt);
      if (this.slamT >= SLAM_WINDUP) {
        this.slamPhase = 2;
        this.slamT = 0;
      }
    } else if (this.slamPhase === 2) {
      this.slamT += dt;
      const tau = Math.min(1, this.slamT / SLAM_LUNGE);
      this.lungeVel = SLAM_LUNGE_SPEED * (1 - tau * tau);
      if (!this.slamHit && this.slamT >= SLAM_IMPACT_AT) this.slamImpact();
      if (this.slamT >= SLAM_LUNGE) this.slamPhase = 0;
    }

    // ---- longitudinal
    const heldR = this.heldBallRadius;
    const maxF = stats.maxSpeed * (1 - 0.2 * Math.min(1, heldR / maxBallR)) * (this.whirlT >= 0 ? WHIRL_SPEED : 1);
    const accel = stats.accel;
    const maxRev = stats.maxSpeed * 0.45;
    // Terrain: no traction in the air (speed carries), less on ice (spinning wheels, long braking, long coasting).
    const air = this.vert.airborne;
    const iceK = this.ice;
    const accK = 1 - (1 - ICE_ACCEL) * iceK;
    const brakeK = 1 - (1 - ICE_BRAKE) * iceK;
    const dragK = 1 - (1 - ICE_DRAG) * iceK;
    if (this.dashT > 0) {
      // Committed lunge: full burst speed, no cap.
      this.speed = this.dashSpeed;
    } else if (air) {
      this.speed *= Math.exp(-0.15 * dt);
    } else if (throttle > 0) {
      if (this.speed < 0) this.speed += accel * 2.2 * brakeK * dt;
      else if (this.speed < maxF) this.speed = Math.min(maxF, this.speed + accel * accK * dt * (1 - 0.35 * (this.speed / maxF)));
    } else if (throttle < 0) {
      if (this.speed > 0) this.speed -= accel * 2.2 * brakeK * dt;
      else if (this.speed > -maxRev) this.speed = Math.max(-maxRev, this.speed - accel * 0.7 * accK * dt);
    } else {
      const drag = (3 + Math.abs(this.speed) * 0.35) * dragK * dt;
      this.speed = Math.abs(this.speed) <= drag ? 0 : this.speed - Math.sign(this.speed) * drag;
    }
    // Slopes: gravity along the slope (faster into dips, slower climbing out). Speed gained downhill past the cap is
    // kept as slopeBoost (it bleeds off slowly) instead of being settled away like a dash.
    if (!air && this.ctx.terrain.active && this.dashT <= 0) {
      this.getForward(_fwd);
      const sa = slopeAccel(this.ctx.terrain, this.surf, _fwd.x, _fwd.z);
      if (sa !== 0) {
        this.speed += sa * dt;
        if (sa > 0 && this.speed > maxF) this.slopeBoost = Math.max(this.slopeBoost, this.speed - maxF);
      }
    }
    if (this.slopeBoost > 0) {
      this.slopeBoost = Math.max(0, Math.min(this.slopeBoost - SLOPE_BOOST_DECAY * dt, this.speed - maxF));
    }
    // Over cap (dash ended / ball got heavier / whirl): settle back — fast ease right after a dash.
    if (!this.dashing && this.speed > maxF + this.slopeBoost && !air) {
      const cap = maxF + this.slopeBoost;
      const rate = this.dashEase > 0 ? Math.max(14, (this.speed - cap) / Math.max(0.06, this.dashEase)) : 14;
      this.speed = Math.max(cap, this.speed - rate * dt);
    }

    // ---- steering
    const absS = Math.abs(this.speed);
    const f = 0.35 + 0.65 * Math.min(1, absS / 4);
    const reversing = this.speed < -0.2 || (absS <= 0.2 && throttle < 0);
    const turn = steer * stats.turnRate * f * (reversing ? -1 : 1) * (this.dashing ? DASH_STEER : this.whirlT >= 0 ? WHIRL_STEER : 1) * (air ? AIR_STEER : 1);
    this.heading += turn * dt;

    // ---- integrate
    this.getForward(_fwd);
    const vf = this.speed + this.lungeVel;
    // Grip: on normal ground the velocity IS forward * speed (as always); on ice it swings toward it slowly (drifts);
    // in the air it keeps its course while the hull turns.
    const wantX = _fwd.x * vf;
    const wantZ = _fwd.z * vf;
    if (air) {
      // keep velX / velZ
    } else if (iceK > 0) {
      const grip = ICE_GRIP + (1 - iceK) * 30;
      const k = 1 - Math.exp(-grip * dt);
      this.velX += (wantX - this.velX) * k;
      this.velZ += (wantZ - this.velZ) * k;
    } else {
      this.velX = wantX;
      this.velZ = wantZ;
    }
    this.position.x += this.velX * dt + this.pushVel.x * dt;
    this.position.z += this.velZ * dt + this.pushVel.z * dt;
    this.pushVel.multiplyScalar(Math.exp(-6.5 * dt));
    // Conveyor strips carry anything standing on them.
    const terr = this.ctx.terrain;
    if (!air && terr.conveyors.length) {
      terr.conveyorAt(this.position.x, this.position.z, this.vert.deck, this.conv);
      this.position.x += this.conv.x * dt;
      this.position.z += this.conv.z * dt;
    }
    this.clampToArena(vf, dt);
    this.collideObstacles(vf, dt);
    if (terr.decks.length) this.collideDecks(vf, dt);
    if (this.dashT > 0) this.dashHits();
    this.terrainStep(dt);

    // ---- plowing
    let plowIntensity = 0;
    _right.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
    // Snow lies on the ground layer only: no plowing (or spilling) on a deck, whatever snow is under it.
    if (this.whirlT < 0 && vf > 0.5 && !armed && !this.vert.airborne && this.vert.deck < 0) {
      const dashing = this.dashT > 0;
      const bx = this.position.x + _fwd.x * BLADE_Z;
      const bz = this.position.z + _fwd.z * BLADE_Z;
      // Dashing carves a wider, cleaner wake.
      const hw = (this.bladeWidth / 2) * (dashing ? 1.2 : 1);
      _a.set(bx - _right.x * hw, 0, bz - _right.z * hw);
      _b.set(bx + _right.x * hw, 0, bz + _right.z * hw);
      const removed = snow.plowLine(_a.x, _a.z, _b.x, _b.z, vf * dt + 0.35, dashing ? 1 : 0.9);
      // Duel guest: the blade still kicks up spray, but only the host's snapshot fills the ball.
      if (removed > 0 && b.authoritative) {
        const cap = ballVolume(maxBallR);
        const add = removed * stats.collectRate;
        const room = Math.max(0, cap - this.heldVolume);
        if (add > room) {
          this.heldVolume = cap;
          const excess = add - room;
          // Spill sideways off the blade ends.
          snow.addSnow(_a.x - _right.x * 0.7, _a.z - _right.z * 0.7, 0.9, excess * 0.5);
          snow.addSnow(_b.x + _right.x * 0.7, _b.z + _right.z * 0.7, 0.9, excess * 0.5);
        } else {
          this.heldVolume += add;
        }
        plowIntensity = Math.min(1, removed / dt / 8);
        if (dashing && removed > 0.005) {
          // Thick wake: snow blasted off both blade ends.
          _a.y = this.vert.surfaceY + 0.6;
          _b.y = this.vert.surfaceY + 0.6;
          ctx.fx.burst(_a, DASH_WAKE_BURST);
          ctx.fx.burst(_b, DASH_WAKE_BURST);
          if (Math.random() < dt * 30) {
            ctx.fx.smoke(_a, DASH_WAKE_SMOKE);
            ctx.fx.smoke(_b, DASH_WAKE_SMOKE);
          }
        }
        if (plowIntensity > 0.02) {
          _a.y = this.vert.surfaceY + snow.getDepth(_a.x, _a.z) + 0.3;
          _b.y = this.vert.surfaceY + snow.getDepth(_b.x, _b.z) + 0.3;
          _dir.set(-_right.x + _fwd.x * 0.5, 0.9, -_right.z + _fwd.z * 0.5).normalize();
          ctx.fx.spray(_a, _dir, plowIntensity);
          _dir.set(_right.x + _fwd.x * 0.5, 0.9, _right.z + _fwd.z * 0.5).normalize();
          ctx.fx.spray(_b, _dir, plowIntensity);
        }
      }
    }
    this.plowSmooth += (plowIntensity - this.plowSmooth) * Math.min(1, dt * 10);
    b.audio.setPlowing(this.plowSmooth < 0.02 ? 0 : this.plowSmooth);

    // ---- whirl
    if (this.whirlT >= 0) this.updateWhirl(dt);

    // ---- visuals
    this.updateVisuals(dt, turn, throttle);
    if (this.dashT > 0 || Math.abs(this.speed) > TRAIL_MIN_SPEED) this.emitTrail(dt, this.dashT > 0);
  }

}
