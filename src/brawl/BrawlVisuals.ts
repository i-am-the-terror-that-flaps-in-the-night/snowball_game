import * as THREE from 'three';
import { ARENA } from '../core/types';
import { BLADE_Z, createCocoa, createRivalBalls } from './models';
import { VOLT_CLAP_R, VOLT_CLAP_WIND } from './voltRival';
import { POUND_CROUCH, POUND_HOP, POUND_HOP_H, POUND_R } from './bruteRival';
import { makeSurface } from '../world/Terrain';
import { V_LANDED, bonkCeiling, stepVertical } from '../world/terrainMotion';
import { RIVAL_R, SLAM_WIND, WHIRL_T, COCOA_MAX, COCOA_EVERY, COCOA_HEAL, RIVAL_HEIGHT, RIVAL_ICE_LINGER, _cam, clamp, type Fighter, type Debris } from './shared';
import type { Rival } from './rival';
import { BrawlBase } from './BrawlBase';

const _surf = makeSurface();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

/* Snowdome Brawl: cocoa pickups, wreck debris batches, rival animation and the instanced held balls. */

export abstract class BrawlVisuals extends BrawlBase {
  /* ================================================================== cocoa */

  protected spawnCocoa(): void {
    if (this.cocoas.length >= COCOA_MAX) return;
    const lim = ARENA.maxX - 10;
    const p = this.freeSpot((Math.random() * 2 - 1) * lim, (Math.random() * 2 - 1) * lim, 3);
    const c = createCocoa();
    c.root.position.set(p.x, 0, p.z);
    this.group.add(c.root);
    this.cocoas.push({ root: c.root, spin: c.spin, halo: c.halo, x: p.x, z: p.z, t: Math.random() * 6 });
  }

  protected updateCocoa(dt: number, fighting: boolean): void {
    const ctx = this.ctx;
    if (fighting) {
      this.cocoaT += dt;
      if (this.cocoaT >= COCOA_EVERY) {
        this.cocoaT = 0;
        this.spawnCocoa();
      }
    }
    for (let i = this.cocoas.length - 1; i >= 0; i--) {
      const c = this.cocoas[i];
      c.t += dt;
      c.spin.rotation.y += dt * 1.8;
      c.spin.position.y = 0.6 + Math.sin(c.t * 2.4) * 0.18 + ctx.snow.getDepth(c.x, c.z) + (ctx.terrain.active ? ctx.terrain.ground(c.x, c.z) : 0);
      c.halo.scale.setScalar(1 + Math.sin(c.t * 3) * 0.12);
      if (!fighting) continue;
      let taker: Fighter | null = null;
      if (!ctx.plow.dead && Math.hypot(ctx.plow.position.x - c.x, ctx.plow.position.z - c.z) < ctx.plow.radius + 1) taker = this.player;
      if (!taker) {
        for (const r of this.rivals) {
          if (r.alive && Math.hypot(r.position.x - c.x, r.position.z - c.z) < RIVAL_R + 1) {
            taker = r.f;
            break;
          }
        }
      }
      if (!taker) continue;
      if (taker.rival) {
        taker.rival.hp = Math.min(taker.rival.maxHp, taker.rival.hp + COCOA_HEAL);
        if (taker.rival.mode === 'heal') taker.rival.mode = 'fight';
      } else {
        ctx.plow.hp = Math.min(ctx.plow.maxHp, ctx.plow.hp + COCOA_HEAL);
      }
      _v.set(c.x, 3, c.z);
      if (this.near(c.x, c.z, 60)) ctx.fx.floatText(_v, `+${COCOA_HEAL}`, '#5dff8a', 1);
      this.sfx('heal', c.x, c.z, 0.9);
      this.group.remove(c.root);
      this.cocoas.splice(i, 1);
    }
  }

  protected updateDebris(dt: number): void {
    const terr = this.ctx.terrain;
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const b = this.debris[i];
      for (let j = b.chunks.length - 1; j >= 0; j--) {
        const d = b.chunks[j];
        d.life -= dt;
        d.vy -= 22 * dt;
        d.pos.x += d.vx * dt;
        d.pos.y += d.vy * dt;
        d.pos.z += d.vz * dt;
        const floor = terr.active ? 0.15 + terr.ground(d.pos.x, d.pos.z) : 0.15;
        if (d.pos.y < floor) {
          d.pos.y = floor;
          d.vy = Math.abs(d.vy) * 0.3;
          d.vx *= 0.6;
          d.vz *= 0.6;
          d.rx *= 0.6;
          d.rz *= 0.6;
        }
        d.rot.x += d.rx * dt;
        d.rot.z += d.rz * dt;
        if (d.life < 0.5) d.scale = Math.max(0.01, d.life / 0.5);
        if (d.life <= 0) b.chunks.splice(j, 1);
      }
      if (b.chunks.length) this.writeDebris(b);
      else {
        this.disposeDebris(b);
        this.debris.splice(i, 1);
      }
    }
  }

  /** Upload a debris batch's live chunks (same transform maths as a plain mesh's position / rotation / scale). */
  protected writeDebris(b: Debris): void {
    for (let j = 0; j < b.chunks.length; j++) {
      const d = b.chunks[j];
      b.mesh.setMatrixAt(j, _m.compose(d.pos, _q.setFromEuler(d.rot), _v.setScalar(d.scale)));
    }
    b.mesh.count = b.chunks.length;
    b.mesh.instanceMatrix.needsUpdate = true;
    b.mesh.computeBoundingSphere();
  }

  protected disposeDebris(b: Debris): void {
    this.group.remove(b.mesh);
    b.mesh.dispose();
    b.mat?.dispose();
  }

  /* ================================================================== visuals */

  protected animate(r: Rival, dt: number): void {
    const rig = r.rig;
    const tagVisible = r.alive && this.started;
    r.tag.sprite.visible = tagVisible;
    if (!r.alive) {
      r.bubble.sprite.visible = false;
      return;
    }
    const depth = r.vert.deck < 0 ? this.ctx.snow.getDepth(r.position.x, r.position.z) : 0;
    r.sink += (Math.min(0.25, depth * 0.3) - r.sink) * Math.min(1, dt * 6);
    this.vertical(r, dt);
    rig.root.rotation.set(r.tiltP, r.heading, r.tiltR);
    // Whirl spin of the body + tornado.
    if (r.whirlT >= 0) {
      const k = r.whirlT / WHIRL_T;
      rig.body.rotation.y = (1 - (1 - k) * (1 - k)) * Math.PI * 4;
      rig.tornado.visible = true;
      rig.tornado.rotation.y += dt * 14;
      const s = (r.s.whirlR + r.ballR) / 4.2;
      rig.tornado.scale.set(s, 0.8 + Math.sin(k * Math.PI) * 0.4, s);
    } else {
      rig.body.rotation.y = 0;
      rig.tornado.visible = false;
    }
    rig.body.rotation.z = r.lean;
    // Slam wind-up: rear back, then lunge.
    const slamK = r.slamT >= 0 ? (r.slamT < SLAM_WIND ? -0.12 * (r.slamT / SLAM_WIND) : 0.1) : 0;
    rig.body.rotation.x += (slamK - rig.body.rotation.x) * Math.min(1, dt * 18);
    // Wheels.
    r.wheelSpin += r.speed * dt;
    rig.setWheelSpin(r.wheelSpin);
    // Held ball (in front of the blade, root space; drawn by syncBalls).
    const br = r.ballR;
    r.ballOn = br > 0.15;
    if (r.ballOn) {
      r.ballSpin += (r.speed * dt) / Math.max(0.2, br);
      _e.set(r.ballSpin, 0, 0);
      // Root space: the ball sits on the snow under the blade (the root rides at surface + sink).
      _v.set(0, br - (r.vert.airborne ? 0 : r.sink) + 0.02, BLADE_Z + br);
      r.ballLocal.compose(_v, _q.setFromEuler(_e), _v2.setScalar(br));
    }
    // Glow: slam wind-up / bounty.
    const bounty = r.f.entry.streak >= 5;
    const winding = r.slamT >= 0 && r.slamT < SLAM_WIND;
    rig.glow.visible = winding || bounty || r.dashing;
    rig.glowMat.opacity = winding ? 0.5 + 0.4 * (r.slamT / SLAM_WIND) : r.dashing ? 0.45 : 0.25 + 0.15 * Math.sin(this.time * 6);
    // Flash / frozen / protection blink.
    const paint = rig.paint;
    if (r.flashT > 0) {
      paint.emissive.setRGB(1, 1, 1);
      paint.emissiveIntensity = 0.8;
    } else if (r.stunT > 0) {
      paint.emissive.setRGB(1, 0.85, 0.2);
      paint.emissiveIntensity = 0.35 + 0.3 * Math.max(0, Math.sin(this.time * 18));
    } else if (r.frozenT > 0) {
      paint.emissive.setRGB(0.3, 0.6, 1);
      paint.emissiveIntensity = 0.6;
    } else {
      paint.emissiveIntensity = 0;
    }
    rig.root.visible = r.protectT <= 0 || Math.sin(this.time * 30) > -0.3;
    rig.beacon.emissiveIntensity = 1.5 + Math.sin(this.time * 8 + r.id) * 1;
    if (r.volt) this.animateVolt(r, dt);
    if (r.brute) this.animateBrute(r, dt);
    // Tag + bubble.
    const top = rig.height + 0.9;
    r.tag.set(r.hp / r.maxHp, r.f.entry.streak, r.protectT > 0);
    r.tag.place(r.position.x, r.position.y + top, r.position.z, _cam);
    if (r.bubble.t > 0) r.bubble.place(r.position.x, r.position.y + top + 2.4, r.position.z, _cam);
  }

  /** Vertical motion, the surface under the rival (slope / ice / lava for next frame) and its hull tilt. */
  protected vertical(r: Rival, dt: number): void {
    const terr = this.ctx.terrain;
    const v = r.vert;
    const p = r.position;
    const code = stepVertical(terr, v, p.x, p.z, r.sink, dt, _surf);
    bonkCeiling(terr, v, p.x, p.z, RIVAL_HEIGHT);
    p.y = v.y;
    r.gx = _surf.gx;
    r.gz = _surf.gz;
    if (!v.airborne) {
      r.mat = _surf.material;
      if (_surf.material === 'ice') r.ice = 1;
      else if (r.ice > 0) r.ice = Math.max(0, r.ice - dt / RIVAL_ICE_LINGER);
    }
    if (code === V_LANDED) {
      this.ctx.events.emit('enemyLanded', { enemy: r, impact: v.impact });
      if (this.near(p.x, p.z, 45)) {
        const k = Math.min(1, v.impact / 18);
        _v.set(p.x, v.surfaceY + 0.2, p.z);
        this.ctx.fx.burst(_v, { color: 0xffffff, count: 6 + Math.round(12 * k), speed: 3 + 4 * k, size: 0.24, gravity: 12, life: 0.6 });
        this.sfx('land', p.x, p.z, 0.3 + 0.5 * k);
      }
    }
    // Hull tilt: to the surface on the ground, nose along the flight path in the air.
    let wp = 0;
    let wr = 0;
    if (v.airborne) wp = clamp(-Math.atan2(v.vy, Math.max(4, Math.abs(r.speed))) * 0.6, -0.45, 0.45);
    else if (terr.active) {
      const sh = Math.sin(r.heading);
      const ch = Math.cos(r.heading);
      wp = -Math.atan(r.gx * sh + r.gz * ch);
      wr = Math.atan(r.gx * ch - r.gz * sh);
    }
    if (wp !== 0 || wr !== 0 || r.tiltP !== 0 || r.tiltR !== 0) {
      const k = Math.min(1, dt * (v.airborne ? 4 : 12));
      r.tiltP += (wp - r.tiltP) * k;
      r.tiltR += (wr - r.tiltR) * k;
      if (Math.abs(r.tiltP) < 1e-5 && wp === 0) r.tiltP = 0;
      if (Math.abs(r.tiltR) < 1e-5 && wr === 0) r.tiltR = 0;
    }
  }

  /** Pack the held balls of every shown rival into the instanced ball mesh. Runs after animate, and again when a
   *  wreck hides a rival later in the frame (combat damage), so it always matches the rivals' visibility. */
  protected syncBalls(): void {
    if (!this.balls || this.balls.instanceMatrix.count < this.rivals.length) {
      if (this.balls) {
        this.group.remove(this.balls);
        this.balls.dispose();
      }
      this.balls = createRivalBalls(Math.max(8, this.rivals.length));
      this.group.add(this.balls);
    }
    const balls = this.balls;
    let n = 0;
    for (const r of this.rivals) {
      if (!r.alive || !r.ballOn || !r.rig.root.visible) continue;
      r.rig.root.updateMatrix();
      balls.setMatrixAt(n++, _m.multiplyMatrices(r.rig.root.matrix, r.ballLocal));
    }
    balls.count = n;
    balls.visible = n > 0;
    if (n > 0) {
      balls.instanceMatrix.needsUpdate = true;
      balls.computeBoundingSphere();
    }
  }

  /** VOLT-9 rival: pulsing coils, idle arcs between them, and the Thunderclap telegraph (growing ground ring +
   *  crackle bolts from the coils to the ground). */
  protected animateVolt(r: Rival, dt: number): void {
    const v = r.volt!;
    const charging = r.clapT >= 0;
    const k = charging ? r.clapT / VOLT_CLAP_WIND : 0;
    v.coilMat.emissiveIntensity = charging ? 2 + 3 * k : 1.2 + 0.8 * Math.sin(this.time * 14 + r.id) * Math.sin(this.time * 5.3);
    v.telegraph.visible = charging;
    if (charging) {
      v.telegraph.scale.setScalar(VOLT_CLAP_R * (0.35 + 0.65 * k));
      v.telegraphMat.opacity = (0.35 + 0.45 * k) * (0.75 + 0.25 * Math.sin(this.time * 40));
    }
    if (!this.near(r.position.x, r.position.z, 70) || !r.rig.root.visible || v.coilTops.length < 2) return;
    v.arcT -= dt;
    v.crackleT -= dt;
    const arc = v.arcT <= 0;
    const crackle = charging && v.crackleT <= 0;
    if (!arc && !crackle) return;
    r.rig.root.updateMatrixWorld();
    const a = v.coilTops[0].getWorldPosition(_v);
    const b = v.coilTops[1].getWorldPosition(_v2);
    if (arc) {
      v.arcT = charging ? 0.05 : 0.25 + Math.random() * 0.6;
      this.lightning.bolt(a, b, { life: 0.1, width: 0.1, jag: 0.35, color: 0x3fa8ff });
    }
    if (crackle) {
      v.crackleT = 0.06;
      const from = Math.random() < 0.5 ? a : b;
      const ang = Math.random() * Math.PI * 2;
      const rad = VOLT_CLAP_R * (0.3 + 0.6 * k) * (0.5 + 0.5 * Math.random());
      _fwd.set(r.position.x + Math.sin(ang) * rad, 0.15, r.position.z + Math.cos(ang) * rad);
      this.lightning.bolt(from, _fwd, { life: 0.12, width: 0.14, jag: 0.7, color: 0x9fe8ff });
    }
  }

  /** BRUTUS rival: crawling track cleats, and the Ground Pound telegraph — a crouch while an amber ring sweeps
   *  out to the full radius over a faint danger disc, then the hop (ring at full size, flashing) and the slam. */
  protected animateBrute(r: Rival, dt: number): void {
    const b = r.brute!;
    const rig = r.rig;
    const near = this.near(r.position.x, r.position.z, 80);
    if (near) {
      b.trackPhase += r.speed * dt;
      rig.setTrackPhase(b.trackPhase);
    }
    const t = r.poundT;
    const charging = t >= 0;
    b.telegraph.visible = charging;
    b.fill.visible = charging;
    if (!charging) {
      rig.body.position.y = 0;
      return;
    }
    if (t < POUND_CROUCH) {
      const k = t / POUND_CROUCH;
      rig.body.position.y = -0.18 * Math.sin(k * Math.PI * 0.5);
      b.telegraph.scale.setScalar(POUND_R * (0.3 + 0.7 * k));
      b.telegraphMat.opacity = 0.4 + 0.4 * k;
      b.fillMat.opacity = 0.08 + 0.1 * k;
    } else {
      const u = Math.min(1, (t - POUND_CROUCH) / POUND_HOP);
      rig.body.position.y = POUND_HOP_H * (u < 0.55 ? Math.sin((u / 0.55) * Math.PI * 0.5) : Math.cos(((u - 0.55) / 0.45) * Math.PI * 0.5));
      b.telegraph.scale.setScalar(POUND_R);
      b.telegraphMat.opacity = 0.75 + 0.25 * Math.sin(this.time * 40);
      b.fillMat.opacity = 0.2 + 0.08 * Math.sin(this.time * 40);
    }
  }
}
