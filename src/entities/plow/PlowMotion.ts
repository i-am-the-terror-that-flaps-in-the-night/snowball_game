import { PlowVisuals } from './PlowVisuals';
import * as THREE from 'three';
import { ARENA, ballVolume } from '../../core/types';
import { cooldown } from '../../config/upgrades';
import { STEP_UP, type Deck } from '../../world/Terrain';
import { LAVA_DPS, V_LANDED, V_LAUNCHED, bonkCeiling, stepVertical } from '../../world/terrainMotion';
import {
  TIP_Z, PROP_SMASH_SPEED, REAR_Z, SLAM_COOLDOWN, DASH_SECONDS, WHIRL_SECONDS, WHIRL_TICKS, WHIRL_TURNS,
  PLOW_HEIGHT, ICE_LINGER, LAVA_SFX_GAP, LAVA_EVENT_GAP,
} from './constants';
import { _fwd, _a, _c, _dir } from './scratch';
import { deckById } from './assets';

/* Layer 3 of the Plow class (see PlowBase.ts): slam / dash / whirl, terrain step and hazards, arena / obstacle /
 * deck collisions, death and the wreck. */

export abstract class PlowMotion extends PlowVisuals {
  abstract damage(amount: number): void;

  /* ------------------------------------------------------------------ abilities */

  protected slamImpact(): void {
    const ctx = this.ctx;
    this.slamHit = true;
    this.slamCd = cooldown(SLAM_COOLDOWN, this.b.stats.cooldownMult);
    const r = this.heldBallRadius;
    if (r < 0.2) {
      // Ball got stolen / chipped away mid-windup.
      this.b.audio.play('error');
      return;
    }
    // Snow Reserve (Classic Plow) keeps part of the ball on the blade; the slam still hits with the full radius.
    const volume = this.heldVolume * (1 - this.b.stats.reserveFrac);
    this.heldVolume -= volume;
    if (this.heldBallRadius < 0.2) {
      this.heldVolume = 0;
      this.ballR = 0;
      this.ball.visible = false;
      this.glow.visible = false;
      this.ballWasVisible = false;
    }
    this.getBladeTip(_c);
    this.getForward(_fwd);
    const cx = _c.x + _fwd.x * (r + 0.5);
    const cz = _c.z + _fwd.z * (r + 0.5);
    this.kick = 1;
    this.b.combat.slamAt(cx, cz, r, volume);
  }

  protected tryDash(): void {
    const ctx = this.ctx;
    if (this.dashCharge < 1 || this.dashT > 0) {
      if (this.dashT <= 0) this.b.audio.play('error', { volume: 0.4 });
      return;
    }
    const stats = this.b.stats;
    this.dashCharge = 0;
    this.dashT = DASH_SECONDS;
    this.dashEase = 0;
    // Works from a standstill: launch off at least half top speed + the dash burst.
    this.dashSpeed = Math.max(this.speed, stats.maxSpeed * 0.5) + stats.dashPower;
    this.speed = this.dashSpeed;
    this.pushVel.multiplyScalar(0.3);
    this.ghostT = 0;
    this.streakT = 0;
    this.kick = Math.max(this.kick, 0.8);
    this.dashFx();
  }

  /** Dash launch feedback: sound, rear blast, exhaust flare (also replayed for a duel opponent's puppet). */
  protected dashFx(): void {
    const ctx = this.ctx;
    this.b.audio.play('dash');
    if (this.look.horn.sound) this.b.audio.play(this.look.horn.sound, { volume: 0.4, pitch: 1.25 });
    // Rear blast: snow kicked back + exhaust flare.
    this.getForward(_fwd);
    _c.set(this.position.x - _fwd.x * REAR_Z, this.vert.surfaceY + 0.5, this.position.z - _fwd.z * REAR_Z);
    ctx.fx.burst(_c, { color: 0xffffff, count: 30, speed: 8, size: 0.26, gravity: 14, life: 0.7 });
    _dir.set(-_fwd.x * 6, 0.6, -_fwd.z * 6);
    ctx.fx.smoke(_c, { count: 12, color: 0xe2ecf8, size: 0.5, grow: 3.4, life: 1.1, speed: 3, up: 1.2, rise: -0.8, drag: 2.2, spread: 0.8, opacity: 0.6, dir: _dir });
    _c.y = this.vert.surfaceY + 0.05;
    ctx.fx.ring(_c, 2.6, 0xffb060);
    this.exhaustWorld(_c);
    ctx.fx.burst(_c, { color: 0xff9a2a, count: 16, speed: 4, size: 0.24, gravity: -4, life: 0.4 });
    this.shake(0.22);
  }

  /** Dash safety net: anything the blade plows into while dashing gets a DASH STRIKE (Combat dedupes per bot). */
  protected dashHits(): void {
    const ctx = this.ctx;
    const enemies = this.b.enemies;
    if (!enemies || this.speed < 3) return;
    const tx = this.position.x + _fwd.x * (TIP_Z - 0.4);
    const tz = this.position.z + _fwd.z * (TIP_Z - 0.4);
    const q = enemies.query(tx, tz, this.bladeWidth / 2 + 0.4, this.queryOut);
    const list = this.dashTargets;
    list.length = 0;
    for (let i = 0; i < q.length; i++) list.push(q[i]);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.alive) continue;
      this.b.combat.playerRam(e, this.speed);
      if (this.hitStopT > 0) break; // one strike per frame; the rest connect after the hit-stop
    }
    list.length = 0;
  }

  protected tryWhirl(): void {
    const ctx = this.ctx;
    if (this.whirlT >= 0) return;
    if (this.whirlCharge < 1) {
      this.b.audio.play('error', { volume: 0.4 });
      return;
    }
    this.whirlCharge = 0;
    this.whirlT = 0;
    this.whirlTick = 0;
    this.whirlHits.clear();
    // Cancel a pending slam (the whirl takes over the blade).
    this.slamPhase = 0;
    this.whirlFx();
  }

  /** Whirl start feedback (also replayed for a duel opponent's puppet). */
  protected whirlFx(): void {
    const ctx = this.ctx;
    this.b.audio.play('whirl');
    const R = this.whirlRadius();
    this.tornadoR = R;
    _c.set(this.position.x, this.vert.surfaceY + 0.05, this.position.z);
    ctx.fx.ring(_c, R, 0xbfeaff);
    this.shake(0.15);
  }

  private whirlRadius(): number {
    return this.b.stats.whirlRadius + this.bladeWidth / 2 + this.heldBallRadius;
  }

  protected updateWhirl(dt: number): void {
    const ctx = this.ctx;
    const stats = this.b.stats;
    this.whirlT += dt;
    const tau = Math.min(1, this.whirlT / WHIRL_SECONDS);
    // Eased: whips up fast, slows at the end.
    const e = tau < 0.5 ? 2 * tau * tau : 1 - 2 * (1 - tau) * (1 - tau);
    this.spinAngle = e * Math.PI * 2 * WHIRL_TURNS;
    const R = this.whirlRadius();
    this.tornadoR += (R - this.tornadoR) * Math.min(1, dt * 8);
    const px = this.position.x;
    const pz = this.position.z;

    // Damage ticks.
    while (this.whirlTick < WHIRL_TICKS.length && this.whirlT >= WHIRL_TICKS[this.whirlTick]) {
      const tick = this.whirlTick++;
      const final = tick === WHIRL_TICKS.length - 1;
      this.b.combat.whirlTick(px, pz, R, this.heldBallRadius, tick, final, this.whirlHits);
      this.ringPulse = final ? 1.6 : 1;
      // Suck snow into the held ball.
      const vol = this.b.snow.collectDisc(px, pz, R * 0.7, 0.35) * stats.collectRate;
      if (vol > 0 && this.b.authoritative) {
        const cap = ballVolume(stats.maxBallRadius);
        this.heldVolume = Math.min(cap, this.heldVolume + vol);
      }
    }

    // Spiral snow flung outward around the funnel.
    const base = this.heading + this.spinAngle * 1.3;
    for (let k = 0; k < 3; k++) {
      const a = base + (k * Math.PI * 2) / 3;
      const s = Math.sin(a);
      const c = Math.cos(a);
      const rr = R * (0.45 + 0.4 * Math.random());
      _c.set(px + s * rr, this.vert.surfaceY + 0.3 + Math.random() * 1.6, pz + c * rr);
      _dir.set(c + s * 0.6, 0.5, -s + c * 0.6).normalize();
      ctx.fx.spray(_c, _dir, 0.9);
    }
    // Snow off the spinning blade tip.
    const vh = this.heading + this.spinAngle;
    const s = Math.sin(vh);
    const c = Math.cos(vh);
    _c.set(px + s * TIP_Z, this.vert.surfaceY + 0.3, pz + c * TIP_Z);
    _dir.set(c, 0.6, -s).normalize();
    ctx.fx.spray(_c, _dir, 1);

    if (tau >= 1) {
      this.whirlT = -1;
      this.spinAngle = 0;
      const count = this.whirlHits.size;
      this.whirlHits.clear();
      if (count >= 3) {
        this.b.events.emit('strike', { count, position: new THREE.Vector3(px, 0, pz) });
        this.b.audio.play('strike');
      }
    }
  }

  /* ------------------------------------------------------------------ terrain */

  /**
   * Vertical motion + surface hazards after the horizontal move (world/terrainMotion.ts). Flat arenas with no patches
   * reduce to "feet at the ride height", exactly the pre-terrain behaviour.
   */
  protected terrainStep(dt: number): void {
    const ctx = this.ctx;
    const t = ctx.terrain;
    const v = this.vert;
    const p = this.position;
    const code = stepVertical(t, v, p.x, p.z, this.ride, dt, this.surf);
    if (bonkCeiling(t, v, p.x, p.z, PLOW_HEIGHT)) {
      this.kick = Math.max(this.kick, 0.5);
      this.jitter = Math.max(this.jitter, 0.12);
      this.b.audio.play('wallHit', { volume: 0.6, pitch: 0.8 });
    }
    p.y = v.y;
    if (code === V_LAUNCHED) {
      this.b.events.emit('plowLaunched', { x: p.x, z: p.z, speed: Math.hypot(this.velX, this.velZ) });
      this.b.audio.play('jump', { volume: 0.8 });
    } else if (code === V_LANDED) this.landed(v.impact, v.lastAir);

    // Ice: low grip (blends out over ICE_LINGER after leaving it). Air keeps whatever it had.
    const mat = this.surf.material;
    if (!v.airborne) {
      if (mat === 'ice') this.ice = 1;
      else if (this.ice > 0) this.ice = Math.max(0, this.ice - dt / ICE_LINGER);
    }
    // Lava: burn while touching it (host / single player applies the damage; the glow shows everywhere).
    const onLava = !v.airborne && mat === 'lava';
    this.burn = onLava ? Math.min(1, this.burn + dt * 4) : Math.max(0, this.burn - dt * 1.5);
    if (onLava) {
      if (this.b.authoritative && !this.invulnerable) {
        const dmg = Math.min(this.hp, LAVA_DPS * dt);
        this.hp -= dmg;
        this.lavaAcc += dmg;
        this.lavaEventT -= dt;
        if (this.lavaEventT <= 0 || this.hp <= 0) {
          this.lavaEventT = LAVA_EVENT_GAP;
          this.b.events.emit('plowDamaged', { amount: this.lavaAcc, blocked: 0 });
          this.lavaAcc = 0;
        }
        if (this.hp <= 0) this.damage(1);
      }
      this.lavaSfxT -= dt;
      if (this.lavaSfxT <= 0) {
        this.lavaSfxT = LAVA_SFX_GAP;
        this.b.audio.play('lavaBurn', { volume: 0.7 });
        _c.set(p.x + (Math.random() - 0.5) * 2, v.surfaceY + 0.4, p.z + (Math.random() - 0.5) * 2);
        ctx.fx.burst(_c, { color: 0xff6a1a, count: 6, speed: 3, size: 0.14, gravity: -4, life: 0.5 });
        ctx.fx.burst(_c, { color: 0x2a2a2e, count: 2, speed: 1, size: 0.45, gravity: -3, life: 0.9 });
      }
    } else {
      this.lavaSfxT = 0;
      if (this.lavaAcc > 0 && this.b.authoritative) {
        this.b.events.emit('plowDamaged', { amount: this.lavaAcc, blocked: 0 });
        this.lavaAcc = 0;
      }
      this.lavaEventT = 0;
    }
  }

  /** Touchdown after a real flight: puff, thump, sound, a little speed lost on a hard landing. */
  private landed(impact: number, airTime: number): void {
    const p = this.position;
    this.b.events.emit('plowLanded', { x: p.x, y: p.y, z: p.z, impact, airTime });
    this.speed *= 1 - 0.18 * Math.min(1, impact / 18);
    if (this.b.local) this.ctx.cameraRig.thump(impact);
    this.landFx(impact, this.vert.surfaceY);
  }

  /** What a landing at `impact` m/s looks and sounds like (own landings and the Duel puppet's replayed ones): land
   *  sound, hull squash, screen shake (a fraction for the opponent), snow puff and, on a hard landing, a ring, on the
   *  surface at height `ground`. */
  protected landFx(impact: number, ground: number): void {
    const ctx = this.ctx;
    const p = this.position;
    const k = Math.min(1, impact / 18);
    this.b.audio.play('land', { volume: 0.4 + 0.6 * k, pitch: 1.1 - 0.3 * k });
    this.squash = Math.max(this.squash, 0.35 + 0.65 * k);
    this.shake(0.08 + 0.35 * k);
    _c.set(p.x, ground + 0.2, p.z);
    ctx.fx.burst(_c, { color: 0xffffff, count: 10 + Math.round(20 * k), speed: 3 + 5 * k, size: 0.28, gravity: 12, life: 0.7 });
    if (k > 0.3) {
      _c.y = ground + 0.06;
      ctx.fx.ring(_c, 2.5 + 3 * k, 0xe8f4ff);
    }
  }

  /** Deck sides (The Omega Works): body and blade circles are pushed out of any deck they cannot step onto. */
  protected collideDecks(vf: number, dt: number): void {
    const t = this.ctx.terrain;
    const p = this.position;
    const bladeOff = TIP_Z - 0.55;
    const bladeR = Math.max(0.9, this.bladeWidth * 0.38);
    for (let k = 0; k < 2; k++) {
      const off = k === 0 ? 0 : bladeOff;
      const cr = k === 0 ? this.radius : bladeR;
      const cx = p.x + _fwd.x * off;
      const cz = p.z + _fwd.z * off;
      let d = t.wallAt(cx, cz, this.vert.y, PLOW_HEIGHT, cr);
      if (d && k === 1) {
        // The blade reaches ~2 m ahead, so going up a ramp it already sits higher than the body's feet: tested from
        // the feet, any grade steeper than STEP_UP / 2 m (and the deck at the top of the ramp) would be a wall.
        // Re-test the blade from its own height: the surface under the body continued uphill to the blade (and, on a
        // ramp deck, that ramp itself extended to the blade, whatever its rotation), or, for a ramp the body is lined
        // up with (driving onto it from its toe), that ramp's height at the blade, skipping that ramp. Sheer sides,
        // pillars and ramp flanks still block it; so does any other deck in the way.
        const v = this.vert;
        const ride = v.y - v.surfaceY;
        let yb = v.y;
        if (!v.airborne) {
          const up = (this.surf.gx * _fwd.x + this.surf.gz * _fwd.z) * off;
          if (up > 0) yb += up;
          const body = v.deck >= 0 ? deckById(t.decks, v.deck) : null;
          if (body && body.rise) yb = Math.max(yb, t.deckTop(body, cx, cz) + ride);
        }
        let skip: Deck | null = null;
        if (this.rampAhead(d)) {
          skip = d;
          yb = Math.max(yb, t.deckTop(d, cx, cz) + ride);
        }
        if (skip || yb > v.y) {
          d = t.wallAt(cx, cz, yb, PLOW_HEIGHT, cr, skip);
          if (d && !skip && this.rampAhead(d)) {
            // The first hit was something else; the ramp we are lined up with turned up behind it.
            skip = d;
            yb = Math.max(yb, t.deckTop(d, cx, cz) + ride);
            d = t.wallAt(cx, cz, yb, PLOW_HEIGHT, cr, skip);
          }
        }
      }
      if (!d) continue;
      t.pushOut(d, cx, cz, cr, this.wallOut);
      let nx = this.wallOut.x - cx;
      let nz = this.wallOut.z - cz;
      const pen = Math.hypot(nx, nz);
      if (pen < 1e-5) continue;
      nx /= pen;
      nz /= pen;
      this.contact(nx, nz, pen, vf, dt);
    }
  }

  /**
   * Is deck d a ramp the plow is driving onto or up (rather than a ramp side beside it)? True when d slopes, the body's
   * centre is inside the ramp's strip (across its width) and the ramp's surface extended back to the body is at most a
   * step above the feet.
   */
  private rampAhead(d: Deck): boolean {
    if (!d.rise) return false;
    const p = this.position;
    const lx = (p.x - d.x) * Math.cos(d.rot) - (p.z - d.z) * Math.sin(d.rot);
    if (Math.abs(lx) > d.hw) return false;
    return this.ctx.terrain.deckTop(d, p.x, p.z) <= this.vert.y + STEP_UP;
  }

  /* ------------------------------------------------------------------ arena */

  protected clampToArena(vf: number, dt: number): void {
    const p = this.position;
    const r = this.radius;
    const tx = p.x + _fwd.x * TIP_Z;
    const tz = p.z + _fwd.z * TIP_Z;
    const rx = p.x - _fwd.x * REAR_Z;
    const rz = p.z - _fwd.z * REAR_Z;
    const m = 0.35;
    const loX = Math.max(ARENA.minX + r - p.x, ARENA.minX + m - tx, ARENA.minX + m - rx, 0);
    const hiX = Math.min(ARENA.maxX - r - p.x, ARENA.maxX - m - tx, ARENA.maxX - m - rx, 0);
    const loZ = Math.max(ARENA.minZ + r - p.z, ARENA.minZ + m - tz, ARENA.minZ + m - rz, 0);
    const hiZ = Math.min(ARENA.maxZ - r - p.z, ARENA.maxZ - m - tz, ARENA.maxZ - m - rz, 0);
    const cx = loX > 0 ? loX : hiX;
    const cz = loZ > 0 ? loZ : hiZ;
    if (cx !== 0) this.contact(Math.sign(cx), 0, Math.abs(cx), vf, dt);
    if (cz !== 0) this.contact(0, Math.sign(cz), Math.abs(cz), vf, dt);
  }

  /** Circle obstacles (Brawl pillars / containers / rocks) vs the body circle and the blade circle. */
  protected collideObstacles(vf: number, dt: number): void {
    const world = this.ctx.world;
    const obs = world ? world.obstacles : null;
    if (!obs || obs.length === 0) return;
    const b = this.b;
    const bladeR = Math.max(0.9, this.bladeWidth * 0.38);
    const bladeOff = TIP_Z - 0.55;
    // Rams at speed and dashes smash straight through destructible props (they stop nothing).
    const smashes = b.authoritative && (this.dashT > 0 || Math.abs(vf) > PROP_SMASH_SPEED);
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      const p = this.position;
      // Cheap reject.
      const ddx = p.x - o.x;
      const ddz = p.z - o.z;
      const reach = o.r + 4.5;
      if (ddx * ddx + ddz * ddz > reach * reach) continue;
      if (o.breakable && smashes && ddx * ddx + ddz * ddz < (o.r + this.radius + 1.5) ** 2 && world!.breakObstacle(o)) {
        this.kick = Math.max(this.kick, 0.3);
        i--;
        continue;
      }
      for (let k = 0; k < 3; k++) {
        const off = k === 0 ? 0 : k === 1 ? bladeOff : -1.3;
        const cr = k === 0 ? this.radius : k === 1 ? bladeR : 1.1;
        const cx = p.x + _fwd.x * off;
        const cz = p.z + _fwd.z * off;
        let nx = cx - o.x;
        let nz = cz - o.z;
        const min = o.r + cr;
        const d2 = nx * nx + nz * nz;
        if (d2 >= min * min) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-4) {
          nx = -_fwd.x;
          nz = -_fwd.z;
          d = 1;
        } else {
          nx /= d;
          nz /= d;
        }
        this.contact(nx, nz, min - Math.sqrt(d2), vf, dt);
      }
    }
  }

  /** Resolve an overlap of `pen` m against a solid surface with outward unit normal (nx, nz). */
  private contact(nx: number, nz: number, pen: number, vf: number, dt: number): void {
    const ctx = this.ctx;
    this.position.x += nx * pen;
    this.position.z += nz * pen;
    // Ice / air velocity (normal ground recomputes it from the heading every frame anyway).
    const vIn = this.velX * nx + this.velZ * nz;
    if (vIn < 0) {
      this.velX -= vIn * nx * 1.3;
      this.velZ -= vIn * nz * 1.3;
    }
    const vx = _fwd.x * vf + this.pushVel.x;
    const vz = _fwd.z * vf + this.pushVel.z;
    const into = -(vx * nx + vz * nz);
    if (into <= 0) return;
    const fwdInto = -(_fwd.x * nx + _fwd.z * nz) * Math.sign(this.speed || 1);
    // Kill the push component into the surface and bounce off it.
    const pIn = this.pushVel.x * nx + this.pushVel.z * nz;
    if (pIn < 0) {
      this.pushVel.x -= pIn * nx;
      this.pushVel.z -= pIn * nz;
    }
    const dashing = this.dashT > 0;
    if (dashing && fwdInto > 0.45 && into > 4) {
      // Dash straight into a wall: heavy thud, dash over.
      this.dashT = 0;
      this.dashEase = 0;
      this.speed *= 0.2;
      const bounce = Math.min(10, into * 0.3 + 2);
      this.pushVel.x += nx * bounce;
      this.pushVel.z += nz * bounce;
      this.wallCd = 0.4;
      this.kick = 1;
      this.jitter = 0.2;
      this.b.audio.play('wallHit', { volume: 1, pitch: 0.75 });
      this.shake(0.6);
      _c.set(this.position.x - nx * (this.radius + 0.6), this.vert.surfaceY + 1, this.position.z - nz * (this.radius + 0.6));
      ctx.fx.burst(_c, { color: 0xffffff, count: 34, speed: 7, size: 0.26, gravity: 14, life: 0.8 });
      ctx.fx.burst(_c, { color: 0xffc04a, count: 18, speed: 10, size: 0.08, gravity: 22, life: 0.35 });
      ctx.fx.burst(_c, { color: 0x8c96a4, count: 8, speed: 5, size: 0.2, gravity: 18, life: 0.6 });
      return;
    }
    if (into > 2) {
      const bounce = into * 0.35 + 1;
      this.pushVel.x += nx * bounce;
      this.pushVel.z += nz * bounce;
      if (fwdInto > 0.2 && !dashing) this.speed *= 1 - 0.6 * Math.min(1, fwdInto);
    } else if (fwdInto > 0.2 && !dashing) {
      this.speed *= Math.exp(-6 * fwdInto * dt);
    }
    if (into > 5 && this.wallCd <= 0) {
      this.wallCd = 0.3;
      this.b.audio.play('wallHit', { volume: Math.min(1, 0.4 + into * 0.04) });
      this.shake(Math.min(0.45, 0.12 + (into - 5) * 0.03));
      _c.set(this.position.x - nx * (this.radius + 0.4), this.vert.surfaceY + 1, this.position.z - nz * (this.radius + 0.4));
      ctx.fx.burst(_c, { color: 0xffffff, count: 10 + Math.round(into), speed: 4, size: 0.2, gravity: 14, life: 0.6 });
      ctx.fx.burst(_c, { color: 0xffc04a, count: 6, speed: 6, size: 0.07, gravity: 22, life: 0.3 });
    }
  }

  /* ------------------------------------------------------------------ death */

  protected die(): void {
    const ctx = this.ctx;
    this._dead = true;
    this.hp = 0;
    this.wreckT = 0;
    this.slamPhase = 0;
    this.dashT = 0;
    this.dashEase = 0;
    this.hitStopT = 0;
    this.spawnProt = 0;
    this.body.visible = true;
    this.whirlT = -1;
    this.whirlHits.clear();
    this.spinAngle = 0;
    this.spin.rotation.y = 0;
    this.b.audio.setPlowing(0);
    this.plowSmooth = 0;

    // Drop the held ball as loose snow.
    if (this.heldVolume > 0) {
      const r = this.heldBallRadius;
      this.ballCenter(_c, r, this.heading, 0);
      if (this.vert.deck < 0) this.b.snow.addSnow(_c.x, _c.z, Math.max(1, r * 1.5), this.heldVolume); // decks carry no snow
      ctx.fx.burst(_c, { color: 0xffffff, count: 16, speed: 3, size: 0.3, gravity: 10, life: 0.9 });
      this.heldVolume = 0;
    }
    this.ball.visible = false;
    this.glow.visible = false;
    this.ballR = 0;

    // Explosion.
    this.wreckGround = this.vert.surfaceY;
    _c.set(this.position.x, this.vert.surfaceY + 1.4, this.position.z);
    ctx.fx.burst(_c, { color: 0xff7a1a, count: 46, speed: 10, size: 0.3, gravity: 6, life: 0.7 });
    ctx.fx.burst(_c, { color: 0xffd23a, count: 24, speed: 13, size: 0.1, gravity: 22, life: 0.5 });
    ctx.fx.burst(_c, { color: 0x26262b, count: 30, speed: 4, size: 0.6, gravity: -3, life: 1.8 });
    ctx.fx.burst(_c, { color: 0x8c96a4, count: 14, speed: 8, size: 0.2, gravity: 22, life: 1.0 });
    ctx.fx.fireball(_c, 1.3);
    _c.y = this.vert.surfaceY;
    ctx.fx.ring(_c, 5, 0xff7a1a);
    ctx.fx.scorch(_c, 3);

    // Wheels 0 and 3 fly off: their stand-ins take over the pose and the instances go away.
    this.wheelDebris.forEach((w, k) => {
      const i = k ? 3 : 0;
      w.rotation.set(this.wheelSpin[i], i < 2 ? this.wheelSteer[i] : 0, 0);
      w.visible = this.kind !== 'brute' && this.kind !== 'arsenal';
    });
    this.wheelsOff = true;
    this.writeWheels();
    // Pop parts off as debris.
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    for (const d of this.debris) {
      if (d.popped) continue;
      d.popped = true;
      ctx.scene.attach(d.obj);
      // Fling outward from the truck center (blade goes forward).
      _a.copy(d.obj.position).sub(this.position);
      _a.y = 0;
      if (_a.lengthSq() < 0.01) _a.set(s, 0, c);
      _a.normalize();
      const out = d.obj === this.bladeGroup ? 4 : 3 + Math.random() * 4;
      d.vel.set(_a.x * out + (Math.random() - 0.5) * 2, 6 + Math.random() * 5, _a.z * out + (Math.random() - 0.5) * 2);
      d.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14);
    }
    this.beaconLight.intensity = 0;
    this.beaconMat.emissiveIntensity = 0;
    this.headMat.emissiveIntensity = 0;
    this.flame.visible = true;
    this.jitter = 0.2;

    this.b.events.emit('plowDestroyed', {});
  }

  protected updateWreck(dt: number): void {
    const ctx = this.ctx;
    this.wreckT += dt;

    // Slide to a halt.
    this.speed *= Math.exp(-4 * dt);
    this.getForward(_fwd);
    this.position.x += _fwd.x * this.speed * dt + this.pushVel.x * dt;
    this.position.z += _fwd.z * this.speed * dt + this.pushVel.z * dt;
    this.pushVel.multiplyScalar(Math.exp(-5 * dt));
    this.position.x = THREE.MathUtils.clamp(this.position.x, ARENA.minX + this.radius, ARENA.maxX - this.radius);
    this.position.z = THREE.MathUtils.clamp(this.position.z, ARENA.minZ + this.radius, ARENA.maxZ - this.radius);
    // A wreck still falls / follows the ground (flat arenas: it stays put, as always).
    const tv = this.vert;
    if (tv.airborne || this.ctx.terrain.active) {
      stepVertical(this.ctx.terrain, tv, this.position.x, this.position.z, this.ride, dt, this.surf);
      this.position.y = tv.y;
    }
    this.object.rotation.set(this.tiltP, this.heading, this.tiltR);

    // Slump onto the missing wheels + jitter.
    const k = Math.min(1, dt * 6);
    this.roll += (0.14 - this.roll) * k;
    this.pitch += (0.09 - this.pitch) * k;
    this.jitter = Math.max(0, this.jitter - dt);
    const j = this.jitter;
    this.body.rotation.set(this.pitch, 0, this.roll + (Math.random() - 0.5) * j * 0.15);
    this.body.position.set((Math.random() - 0.5) * j * 0.3, -0.12 * Math.min(1, this.wreckT * 4), (Math.random() - 0.5) * j * 0.3);

    // Char the paint, dim emissive flash.
    const ch = Math.min(1, this.wreckT * 2.5) * 0.8;
    this.paintMat.color.lerpColors(this.paintBase, this.charColor, ch);
    this.bedMat.color.lerpColors(this.bedBase, this.charColor, ch * 0.85);
    this.decalMat.color.setScalar(1 - ch * 0.85);
    this.decalMat.emissiveIntensity = 0.3 * (1 - ch);
    this.bladeSkinMat.color.setScalar(1 - ch * 0.75);
    this.flash = Math.max(0, this.flash - dt * 3);
    this.paintMat.emissiveIntensity = this.flash * 1.4 + 0.25 * (0.5 + 0.5 * Math.sin(this.time * 23));
    this.bedMat.emissiveIntensity = this.flash * 1.4;
    this.bladeSkinMat.emissiveIntensity = this.flash * 1.4;

    // Fire from the stack and smoke from the engine.
    this.flame.scale.set(2.2, 1.6 + Math.random() * 1.6, 2.2);
    this.flameMat.color.setHSL(0.03 + Math.random() * 0.06, 1, 0.5);
    this.puffT -= dt;
    if (this.puffT <= 0) {
      this.puffT = 0.05;
      this.engineWorld(_c);
      ctx.fx.burst(_c, { color: 0x1d1d22, count: 3, speed: 1.4, size: 0.55, gravity: -3, life: 1.6 });
      ctx.fx.burst(_c, { color: 0xff6a1a, count: 2, speed: 1.6, size: 0.25, gravity: -5, life: 0.4 });
      _c.set(this.position.x + (Math.random() - 0.5) * 1.6, this.vert.surfaceY + 1.4, this.position.z + (Math.random() - 0.5) * 1.6);
      ctx.fx.burst(_c, { color: 0x3a3a40, count: 2, speed: 0.8, size: 0.7, gravity: -2, life: 1.8 });
    }

    // Debris physics.
    for (const d of this.debris) {
      if (!d.popped) continue;
      const o = d.obj;
      d.vel.y -= 22 * dt;
      o.position.addScaledVector(d.vel, dt);
      o.rotation.x += d.spin.x * dt;
      o.rotation.y += d.spin.y * dt;
      o.rotation.z += d.spin.z * dt;
      if (o.position.y < d.rest + this.wreckGround) {
        o.position.y = d.rest + this.wreckGround;
        if (d.vel.y < 0) d.vel.y *= -0.3;
        d.vel.x *= 0.6;
        d.vel.z *= 0.6;
        d.spin.multiplyScalar(0.6);
      }
    }
  }
}
