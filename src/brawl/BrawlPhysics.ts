import * as THREE from 'three';
import { ARENA, PLOW_MASS } from '../core/types';
import { BLADE_W, BLADE_Z } from './models';
import { VOLT_CLAP_WIND } from './voltRival';
import { POUND_WIND } from './bruteRival';
import { AIR_STEER, ICE_ACCEL, ICE_GRIP, LAVA_CLEAR, LAVA_DPS, LAVA_OUT, SLOPE_PULL, lavaAhead, steerLava } from '../world/terrainMotion';
import { RIVAL_PROP_SMASH_SPEED, RIVAL_R, SLAM_WIND, WHIRL_T, WHIRL_TICKS, KILL_CREDIT_WINDOW, RIVAL_HEIGHT, wrap, clamp, type Fighter } from './shared';
import type { Rival } from './rival';
import { BrawlCombat } from './BrawlCombat';

/* Constant FX options for per-frame / per-hit paths (hoisted so they are not rebuilt per call; never mutated). */
const BURN_EMBER_BURST = { color: 0xff6a1a, count: 4, speed: 2.5, size: 0.12, gravity: -4, life: 0.45 };

const _conv = { x: 0, z: 0 };
const _lavaOut = { h: 0, v: 0 };
const _wall = { x: 0, z: 0 };
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/* Snowdome Brawl: rival timers, driving + terrain physics, vehicle contacts and rams. */

export abstract class BrawlPhysics extends BrawlCombat {
  /* ================================================================== physics */

  protected tickTimers(r: Rival, dt: number): void {
    r.protectT = Math.max(0, r.protectT - dt);
    if (r.s.hpRegen > 0 && r.hp < r.maxHp) r.hp = Math.min(r.maxHp, r.hp + r.s.hpRegen * dt);
    r.frozenT = Math.max(0, r.frozenT - dt);
    r.stunT = Math.max(0, r.stunT - dt);
    r.flashT = Math.max(0, r.flashT - dt);
    r.ramCd = Math.max(0, r.ramCd - dt);
    r.slamCd = Math.max(0, r.slamCd - dt);
    r.tauntCd = Math.max(0, r.tauntCd - dt);
    if (r.dashT > 0) r.dashT = Math.max(0, r.dashT - dt);
    else r.dashCd = Math.max(0, r.dashCd - dt);
    if (r.whirlT < 0) r.whirlCd = Math.max(0, r.whirlCd - dt);
    if (r.bubble.t > 0) {
      r.bubble.t -= dt;
      if (r.bubble.t <= 0) r.bubble.hide();
    }
    // Slam wind-up -> impact.
    if (r.slamT >= 0) {
      const prev = r.slamT;
      r.slamT += dt;
      if (prev < SLAM_WIND && r.slamT >= SLAM_WIND) this.slamImpact(r);
      if (r.slamT > SLAM_WIND + 0.25) r.slamT = -1;
    }
    // Whirl ticks.
    if (r.whirlT >= 0) {
      r.whirlT += dt;
      while (r.whirlTick < WHIRL_TICKS.length && r.whirlT >= WHIRL_TICKS[r.whirlTick]) {
        this.whirlTick(r, r.whirlTick === WHIRL_TICKS.length - 1);
        r.whirlTick++;
      }
      if (r.whirlT >= WHIRL_T) r.whirlT = -1;
    }
    // VOLT-9 Thunderclap: telegraph -> blast (only once the match is live).
    if (r.s.volt) {
      if (r.clapT >= 0) {
        r.clapT += dt;
        if (r.clapT >= VOLT_CLAP_WIND) {
          r.clapT = -1;
          if (this.active && !this._over) this.voltClap(r);
        }
      } else r.clapCd = Math.max(0, r.clapCd - dt);
    }
    // BRUTUS Ground Pound: crouch telegraph -> hop -> slam (only once the match is live).
    if (r.s.brute) {
      if (r.poundT >= 0) {
        r.poundT += dt;
        if (r.poundT >= POUND_WIND) {
          r.poundT = -1;
          r.rig.body.position.y = 0;
          if (this.active && !this._over) this.groundPound(r);
        }
      } else r.poundCd = Math.max(0, r.poundCd - dt);
    }
    // Stuck detection.
    r.stuckCheckT -= dt;
    if (r.stuckCheckT <= 0) {
      r.stuckCheckT = 1.2;
      const moved = Math.hypot(r.position.x - r.stuckX, r.position.z - r.stuckZ);
      if (moved < 1.2 && r.desSpeed > 3 && r.slamT < 0 && r.whirlT < 0 && r.stunT <= 0 && this.active) r.stuckT = 0.8;
      r.stuckX = r.position.x;
      r.stuckZ = r.position.z;
    }
  }

  protected drive(r: Rival, dt: number): void {
    const ctx = this.ctx;
    const terr = ctx.terrain;
    const air = r.vert.airborne;
    const frozen = r.frozenT > 0 ? 0.5 : 1;
    const stunned = r.stunT > 0;
    if (stunned) r.desSpeed = 0;
    // Lava: burn while touching it (kill credit to whoever last hit them), and steer around it unless knocked in.
    if (r.mat === 'lava' && !air && r.targetable) {
      r.hp -= LAVA_DPS * dt * r.s.damageTaken;
      r.burnT -= dt;
      if (r.burnT <= 0) {
        r.burnT = 0.35;
        r.flashT = 0.06;
        if (this.near(r.position.x, r.position.z, 40)) {
          _v.set(r.position.x, r.position.y + 0.4, r.position.z);
          ctx.fx.burst(_v, BURN_EMBER_BURST);
        }
      }
      if (r.hp <= 0) {
        r.hp = 0;
        const f = r.f;
        const killer = f.lastHitBy && this.time - f.lastHitAt < KILL_CREDIT_WINDOW ? f.lastHitBy : null;
        this.onDeath(f, killer, 'other');
        return;
      }
    }
    // Steer around lava (stop while turning away); knocked in, drive out by the shortest way (nearest edge).
    let lavaTurn = 1;
    let lavaStop = false;
    if (this.lava.sync(terr) && !air && r.kvx * r.kvx + r.kvz * r.kvz < 16) {
      const look = RIVAL_R + 1.5 + Math.abs(r.speed) * 0.35;
      let brake = r.s.accel * 1.4 * (r.ice > 0 ? 1 - (1 - ICE_ACCEL) * r.ice : 1);
      // (a downhill pull eats into the braking: count it, so the stop check looks far enough)
      if (terr.active && (r.gx !== 0 || r.gz !== 0)) {
        const pull = (terr.gravity * SLOPE_PULL * -(r.gx * Math.sin(r.heading) + r.gz * Math.cos(r.heading))) / Math.sqrt(1 + r.gx * r.gx + r.gz * r.gz);
        if (pull > 0) brake = Math.max(brake * 0.4, brake - pull);
      }
      // A dash ignores the lava braking below: end it as soon as lava comes inside its stopping distance (+ margin),
      // so the glide that follows brakes in time (the dash also turns slowly and drifts off the line checked at start).
      if (r.dashing && lavaAhead(this.lava, r.position.x, r.position.z, r.heading, r.speed, RIVAL_R + 1.5 + (r.speed * r.speed) / (2 * brake), RIVAL_R * 0.6, ARENA.maxX - RIVAL_R)) r.dashT = 0;
      const k = steerLava(this.lava, r.position.x, r.position.z, r.heading, r.speed, r.desH, r.desSpeed, look, RIVAL_R * 0.8, r.id & 1 ? 1 : -1, this.topSpeed(r) * 0.6, brake, ARENA.maxX - RIVAL_R, _lavaOut);
      r.desH = wrap(_lavaOut.h);
      // (stopping short of lava brakes properly even when gliding over the cap after a dash: see below)
      lavaStop = k !== LAVA_OUT && _lavaOut.v === 0 && r.desSpeed > 0;
      if (!r.dashing && !stunned) r.desSpeed = _lavaOut.v;
      // driving out, or stopped short of lava while turning away: full turn rate even from a standstill (the slow-speed
      // turn penalty would keep it burning / parked at the edge for seconds)
      if (k !== LAVA_CLEAR && !r.dashing) lavaTurn = 1 / (0.45 + 0.55 * Math.min(1, Math.abs(r.speed) / 4));
    }
    const diff = wrap(r.desH - r.heading);
    const turnRate = stunned ? 0 : r.s.turn * (r.dashing ? 0.4 : 1) * frozen * (0.45 + 0.55 * Math.min(1, Math.abs(r.speed) / 4)) * (air ? AIR_STEER : 1) * lavaTurn;
    const turn = clamp(diff, -turnRate * dt, turnRate * dt);
    r.heading = wrap(r.heading + turn);
    r.lean += (clamp(turn / Math.max(dt, 1e-4) * 0.04, -0.12, 0.12) - r.lean) * Math.min(1, dt * 6);

    const fx = Math.sin(r.heading);
    const fz = Math.cos(r.heading);
    const cap = this.topSpeed(r) * frozen * (1 - 0.2 * (r.ballR / r.s.maxBall)) * (r.whirling ? 0.75 : 1);
    if (!r.dashing && !air) {
      const target = clamp(r.desSpeed, -cap * 0.45, cap);
      const iceK = r.ice > 0 ? 1 - (1 - ICE_ACCEL) * r.ice : 1;
      // Slopes: gravity along the slope; downhill speed past the cap bleeds off gently instead of being clamped.
      let sa = 0;
      if (terr.active && (r.gx !== 0 || r.gz !== 0)) sa = (-terr.gravity * SLOPE_PULL * (r.gx * fx + r.gz * fz)) / Math.sqrt(1 + r.gx * r.gx + r.gz * r.gz);
      if (r.speed > cap && !lavaStop) r.speed = Math.max(cap, r.speed - (sa > 0 ? 2 : 14) * dt);
      else r.speed += clamp(target - r.speed, -(stunned ? 30 : r.s.accel * 1.4) * iceK * dt, r.s.accel * iceK * dt);
      if (sa !== 0) r.speed += sa * dt;
    }

    const decay = Math.exp(-(4 - 3 * r.ice) * dt);
    r.kvx *= decay;
    r.kvz *= decay;
    if (air) {
      // keep the heading velocity it took off with
    } else if (r.ice > 0) {
      const k = 1 - Math.exp(-(ICE_GRIP + (1 - r.ice) * 30) * dt);
      r.ivx += (fx * r.speed - r.ivx) * k;
      r.ivz += (fz * r.speed - r.ivz) * k;
    } else {
      r.ivx = fx * r.speed;
      r.ivz = fz * r.speed;
    }
    r.vx = r.ivx + r.kvx;
    r.vz = r.ivz + r.kvz;
    r.position.x += r.vx * dt;
    r.position.z += r.vz * dt;
    if (!air && terr.conveyors.length) {
      terr.conveyorAt(r.position.x, r.position.z, r.vert.deck, _conv);
      r.position.x += _conv.x * dt;
      r.position.z += _conv.z * dt;
    }

    // Walls.
    const lim = RIVAL_R;
    let wall = false;
    if (r.position.x < ARENA.minX + lim) { r.position.x = ARENA.minX + lim; r.kvx = Math.abs(r.kvx) * 0.4; wall = true; }
    if (r.position.x > ARENA.maxX - lim) { r.position.x = ARENA.maxX - lim; r.kvx = -Math.abs(r.kvx) * 0.4; wall = true; }
    if (r.position.z < ARENA.minZ + lim) { r.position.z = ARENA.minZ + lim; r.kvz = Math.abs(r.kvz) * 0.4; wall = true; }
    if (r.position.z > ARENA.maxZ - lim) { r.position.z = ARENA.maxZ - lim; r.kvz = -Math.abs(r.kvz) * 0.4; wall = true; }
    // Obstacles. A rival dashing, flying from a knockback or just going fast smashes destructible props instead.
    const obs = ctx.world.obstacles;
    const smash = r.dashing || Math.abs(r.speed) > RIVAL_PROP_SMASH_SPEED || r.kvx * r.kvx + r.kvz * r.kvz > RIVAL_PROP_SMASH_SPEED ** 2;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      const dx = r.position.x - o.x;
      const dz = r.position.z - o.z;
      const d = Math.hypot(dx, dz);
      const need = o.r + RIVAL_R;
      // breakObstacle splices it out of `obs`: step back so the next one isn't skipped.
      if (d < need && o.breakable && smash && ctx.world.breakObstacle(o, false)) {
        i--;
        continue;
      }
      if (d < need && d > 1e-4) {
        r.position.x = o.x + (dx / d) * need;
        r.position.z = o.z + (dz / d) * need;
        wall = true;
      }
    }
    if (wall && Math.abs(r.speed) > 6) {
      if (r.dashing) {
        r.dashT = 0;
        this.sfx('wallHit', r.position.x, r.position.z, 0.8);
      }
      r.speed *= 0.4;
    }

    // Deck sides (only arenas with decks).
    if (terr.decks.length) {
      const d = terr.wallAt(r.position.x, r.position.z, r.vert.y, RIVAL_HEIGHT, RIVAL_R);
      if (d) {
        terr.pushOut(d, r.position.x, r.position.z, RIVAL_R, _wall);
        r.position.x = _wall.x;
        r.position.z = _wall.z;
        wall = true;
      }
    }
    if (wall && Math.abs(r.speed) > 6 && r.ice > 0) r.ivx = r.ivz = 0;

    // Plow snow into the ball (not in the air, not on a deck: snow lies on the ground only).
    if (r.speed > 0.5 && r.whirlT < 0 && !air && r.vert.deck < 0) {
      const rx = fz;
      const rz = -fx;
      const bx = r.position.x + fx * BLADE_Z;
      const bz = r.position.z + fz * BLADE_Z;
      const hw = BLADE_W / 2;
      const removed = ctx.snow.plowLine(bx - rx * hw, bz - rz * hw, bx + rx * hw, bz + rz * hw, r.speed * dt + 0.35, 0.85);
      if (removed > 0) {
        r.ballVol = Math.min(r.s.maxBallVol, r.ballVol + removed * r.s.collect);
        if (removed > 0.02 && this.near(bx, bz, 40)) {
          _v.set(bx, 0.4, bz);
          _v2.set(fx, 0.5, fz).normalize();
          ctx.fx.spray(_v, _v2, Math.min(1, removed * 2) * 0.6);
        }
      }
    }
  }

  /** Vehicle-vehicle separation, rams and dash strikes (player included). */
  protected resolveContacts(fighting: boolean): void {
    const ctx = this.ctx;
    const plow = ctx.plow;
    const n = this.rivals.length;
    // Rival vs rival.
    for (let i = 0; i < n; i++) {
      const a = this.rivals[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.rivals[j];
        if (!b.alive) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const d = Math.hypot(dx, dz);
        const minD = a.radius + b.radius;
        if (d >= minD || d < 1e-4) continue;
        const nx = dx / d;
        const nz = dz / d;
        const push = (minD - d) * 0.5;
        a.position.x -= nx * push;
        a.position.z -= nz * push;
        b.position.x += nx * push;
        b.position.z += nz * push;
        if (!fighting) continue;
        // n points a -> b; tryRivalRam wants the unit vector from the victim to the attacker.
        this.tryRivalRam(a, b.f, -nx, -nz);
        this.tryRivalRam(b, a.f, nx, nz);
      }
    }
    // Rivals vs player.
    if (plow.dead) return;
    plow.getForward(_fwd);
    for (const r of this.rivals) {
      if (!r.alive) continue;
      const dx = r.position.x - plow.position.x;
      const dz = r.position.z - plow.position.z;
      const d = Math.hypot(dx, dz);
      const minD = r.radius + plow.radius;
      if (d >= minD || d < 1e-4) continue;
      const nx = dx / d;
      const nz = dz / d;
      const total = r.mass + PLOW_MASS;
      const overlap = minD - d;
      r.position.x += nx * overlap * (PLOW_MASS / total);
      r.position.z += nz * overlap * (PLOW_MASS / total);
      plow.position.x -= nx * overlap * (r.mass / total);
      plow.position.z -= nz * overlap * (r.mass / total);
      if (!fighting) continue;
      // Player rams the rival.
      const dot = _fwd.x * nx + _fwd.z * nz;
      if (dot > 0.55 && plow.speed > 3 && r.ramCd <= 0 && r.targetable) {
        const closing = plow.speed * dot - (r.vx * nx + r.vz * nz);
        ctx.combat.playerRam(r, Math.max(closing, plow.speed * 0.6));
        r.ramCd = 0.35;
        if (!plow.dashing) plow.speed *= 0.6;
      }
      // Rival rams the player (n points player -> rival = victim -> attacker).
      this.tryRivalRam(r, this.player, nx, nz);
    }
  }

  /** Rival `a` rams fighter `victim` if its front faces them at speed. n = unit vector from victim to a. */
  protected tryRivalRam(a: Rival, victim: Fighter, nx: number, nz: number): void {
    if (a.ramCd > 0 || a.speed < 4 || !this.isTargetable(victim)) return;
    const fx = Math.sin(a.heading);
    const fz = Math.cos(a.heading);
    // a -> victim direction is -n.
    const dot = -(fx * nx + fz * nz);
    if (dot < 0.55) return;
    const br = a.ballR;
    const ballBonus = br > 0.2 ? 6 * br * br : 0;
    const dashing = a.dashing;
    const dmg = (dashing ? 25 + a.s.ramBase * 1.8 : a.s.ramBase * clamp(a.speed / 10, 0.3, 1.8)) * this.dmgMult(a) + ballBonus;
    const kb = dashing ? 22 : 4 + a.speed * 0.9;
    a.ramCd = 0.35;
    this.hitFighter(victim, a.f, dmg, dashing ? 'dash' : 'ram', -nx * kb, -nz * kb, kb, false, a.position.x, a.position.z);
    if (br > 0.2) a.ballVol *= 0.9;
    if (!dashing) {
      a.speed *= 0.5;
      a.recoverT = 0.35 + Math.random() * 0.3;
    }
    const x = this.fx(victim);
    const z = this.fz(victim);
    if (this.near(x, z, 60)) {
      _v.set((a.position.x + x) / 2, 1, (a.position.z + z) / 2);
      this.ctx.fx.burst(_v, { color: 0xffc04a, count: dashing ? 22 : 10, speed: dashing ? 12 : 7, size: 0.09, gravity: 22, life: 0.4 });
    }
    if (!victim.entry.isPlayer) this.sfx(dashing ? 'dashStrike' : 'ram', a.position.x, a.position.z, 0.7);
  }
}
