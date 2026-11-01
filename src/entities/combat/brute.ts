import * as THREE from 'three';
import type { EnemyHandle, PlayerStats, PlowAPI } from '../../core/types';
import type { KillSource } from '../../core/events';
import { Kit, Reach, _fwd, _q, waveFloor, type CastOrigin } from './shared';
import { ultBlast, type UltScript } from './ultimates';

/** EARTHQUAKE (BRUTUS): QUAKE_RINGS shockwaves rolling outward, each hitting the band it sweeps for QUAKE_MULT x
 *  pound damage + stun + knockback. */
const QUAKE_RINGS = [8, 13, 19] as const;
const QUAKE_GAP = 0.35;
const QUAKE_MULT = 1.0;
/** Ground Pound (F on BRUTUS): hop length (s) and peak height (m); damage falls off to this share at the rim. */
const POUND_HOP_SECONDS = 0.85;
const POUND_HOP_HEIGHT = 5;
const POUND_RIM_FRAC = 0.6;
/** The full leap telegraphs the slam, so it pays for it: untouchable while airborne, and the drop from height
 *  hits harder and wider. */
const POUND_LEAP_DMG = 1.3;
const POUND_LEAP_RADIUS = 1.2;
/** Dive speed (m/s) of a Ground Pound pressed while airborne (same as the air slam's). */
const AIR_POUND_DIVE = 28;
/** Buzzsaw halos (BRUTUS): a full halo stretches the saw reach by this share. */
const SAW_HALO_REACH = 0.5;
/** Iron Hide (BRUTUS) is at full strength from this share of top speed; parked it keeps IRON_HIDE_IDLE of it. */
const IRON_HIDE_SPEED = 0.7;
const IRON_HIDE_IDLE = 0.4;

/** Iron Hide (BRUTUS): armour that scales with speed. Returns `dmg` after it. */
export function ironHide(dmg: number, stats: PlayerStats, speed: number): number {
  if (stats.ironHide < 1) {
    const roll = THREE.MathUtils.clamp(Math.abs(speed) / (stats.maxSpeed * IRON_HIDE_SPEED), 0, 1);
    dmg *= 1 - (1 - stats.ironHide) * (IRON_HIDE_IDLE + (1 - IRON_HIDE_IDLE) * roll);
  }
  return dmg;
}

/** BRUTUS: Ground Pound, Buzzsaws and the EARTHQUAKE. */
export class BruteKit extends Kit implements UltScript {
  /** Ground Pound recharge 0..1 and the hop timer (-1 = grounded). */
  poundCharge = 1;
  poundT = -1;
  private sawT = 0;
  private buf: EnemyHandle[] = [];
  /** Ground Pound pressed while airborne: the plow dives and the pound lands as a bigger crater (combat/air.ts). */
  private airPound = false;
  private ultStep = 0;

  /** Buzzsaws (BRUTUS): the saws on the blade ends grind every bot in the front arc (BRUTUS's Tesla Field). */
  updateSaws(dt: number): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const plow = this.b.plow;
    if (st.sawDps <= 0 || !plow || plow.dead) return;
    this.sawT -= dt;
    if (this.sawT > 0) return;
    const TICK = 0.25;
    this.sawT = TICK;
    plow.getForward(_fwd);
    const R = st.sawRadius * (1 + SAW_HALO_REACH * plow.sawHalo);
    const hits = this.b.enemies.query(plow.position.x, plow.position.z, R, this.buf);
    let any = false;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive || !this.reaches(e, Reach.Body)) continue;
      const dx = e.position.x - plow.position.x;
      const dz = e.position.z - plow.position.z;
      const d = Math.hypot(dx, dz) || 1;
      // Front and sides only (about 105 degrees either way of the nose): nothing behind the cab.
      if ((dx * _fwd.x + dz * _fwd.z) / d < -0.25) continue;
      any = true;
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, st.sawDps * st.damageMult * TICK * this.hitMult(e), {
        source: 'other',
        knockback: new THREE.Vector3((dx / d) * 2.5, 0, (dz / d) * 2.5),
        fromX: e.position.x,
        fromZ: e.position.z,
      });
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      this.onPlayerHit(dealt, killed, e, false, false);
      _q.set(e.position.x - (dx / d) * e.radius, e.position.y + 0.5, e.position.z - (dz / d) * e.radius);
      ctx.fx.burst(_q, { color: Math.random() < 0.5 ? 0xffd040 : 0xfff2b0, count: 10, speed: 9, size: 0.07, gravity: 14, life: 0.35 });
      if (dealt > 0) {
        _q.y = e.position.y + e.radius + 1;
        ctx.fx.floatText(_q, `🪚${Math.round(dealt)}`, '#ffd040', 0.75);
      }
    }
    if (any) this.b.audio.play('whirlTick', { volume: 0.35, pitch: 1.8 });
  }

  /** Ground Pound (F on BRUTUS): the plow hops, then slams down — a snow shockwave that damages, stuns and hurls
   *  every bot in the ring outward. */
  updatePound(dt: number): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const plow = this.b.plow;
    // Plow keeps its body pose private; the hop height goes through a narrow duck-typed view.
    const hopper = plow as unknown as { hop: number } | undefined;
    if (st.poundDamage <= 0 || !plow || plow.dead) {
      if (this.poundT >= 0 && hopper) hopper.hop = 0;
      this.poundT = -1;
      this.airPound = false;
      return;
    }
    if (this.poundT >= 0) {
      this.poundT += dt;
      // A full leap: launch, hang at the top, then a hard accelerating slam back down.
      const u = Math.min(1, this.poundT / POUND_HOP_SECONDS);
      const rise = 0.6;
      hopper!.hop = POUND_HOP_HEIGHT * (u < rise ? 1 - (1 - u / rise) ** 2 : 1 - ((u - rise) / (1 - rise)) ** 2.6);
      if (u >= 1) {
        hopper!.hop = 0;
        this.poundT = -1;
        this.poundImpact(plow);
      }
      return;
    }
    if (this.poundCharge < 1) this.poundCharge = Math.min(1, this.poundCharge + (st.poundCooldown > 0 ? dt / st.poundCooldown : 1));
    if (!this.b.input.wasPressed('KeyF')) return;
    if (this.h.crit >= 1 && this.h.ultIdle) return this.h.startUlt('brute', plow);
    if (this.poundCharge < 1 || this.airPound) {
      this.b.audio.play('error');
      return;
    }
    this.poundCharge = 0;
    this.b.events.emit('ability', { nuke: false });
    if (plow.airborne) {
      // Already flying (ramp / crest): no hop, dive straight down; the landing is a bigger crater (AirKit).
      this.airPound = true;
      plow.dive(AIR_POUND_DIVE);
      this.b.audio.play('airSlam', { pitch: 0.8 });
      return;
    }
    this.poundT = 0;
    _q.set(plow.position.x, (plow.surfaceY || 0) + 0.1, plow.position.z);
    ctx.fx.burst(_q, { color: 0xffffff, count: 14, speed: 4, size: 0.2, gravity: 10, life: 0.4 });
    this.b.audio.play('dash', { volume: 0.5, pitch: 0.6 });
  }

  /** An air pound is waiting for touchdown: take it (AirKit calls this on landing). */
  takeAirPound(): boolean {
    const p = this.airPound;
    this.airPound = false;
    return p;
  }

  /** The pound shockwave around the plow. `rMult` / `dMult` scale radius / damage on top of the leap bonus (the air
   *  pound's crater); `source` credits the kills. */
  poundImpact(plow: PlowAPI, rMult = 1, dMult = 1, source: KillSource = 'other'): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const R = st.poundRadius * POUND_LEAP_RADIUS * rMult;
    const px = plow.position.x;
    const pz = plow.position.z;
    // Snow shockwave: stacked rings, a central blast and snow sprays thrown out along the rim.
    // fx.ring sits itself on the snow; bursts start at the surface under the plow (0 on flat arenas).
    const top = plow.surfaceY || 0;
    _q.set(px, top + 0.1, pz);
    ctx.fx.ring(_q, R * 0.45, 0xffffff);
    ctx.fx.ring(_q, R, 0xdff2ff);
    ctx.fx.ring(_q, R * 1.12, 0xffc21a);
    ctx.fx.burst(_q, { color: 0xffffff, count: 46, speed: 15, size: 0.26, gravity: 18, life: 0.7 });
    ctx.fx.burst(_q, { color: 0xbfe6ff, count: 24, speed: 9, size: 0.14, gravity: 12, life: 0.55 });
    ctx.fx.burst(_q, { color: 0x6b7280, count: 12, speed: 6, size: 0.18, gravity: 22, life: 0.5 });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
      const rr = R * (0.55 + Math.random() * 0.4);
      _q.set(px + Math.sin(a) * rr, top + 0.3, pz + Math.cos(a) * rr);
      ctx.fx.burst(_q, { color: 0xffffff, count: 6, speed: 6, size: 0.24, gravity: 16, life: 0.55 });
    }
    this.shake(rMult > 1 ? 1.2 : 0.9);
    this.impactHit('pound', _q.set(px, top + 0.5, pz), rMult);
    this.b.audio.play('thud');
    this.smashProps(px, pz, R);
    const hits = this.collect(px, pz, R, Reach.Wave);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      let dx = e.position.x - px;
      let dz = e.position.z - pz;
      const d = Math.hypot(dx, dz);
      if (d < 1e-3) {
        plow.getForward(_fwd);
        dx = _fwd.x;
        dz = _fwd.z;
      } else {
        dx /= d;
        dz /= d;
      }
      const fall = 1 - (1 - POUND_RIM_FRAC) * Math.min(1, d / R);
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, st.poundDamage * POUND_LEAP_DMG * dMult * st.damageMult * fall * this.hitMult(e), {
        source,
        knockback: new THREE.Vector3(dx * st.poundKnock * fall, 0, dz * st.poundKnock * fall),
        stunSeconds: st.poundStun,
        fromX: px,
        fromZ: pz,
      });
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      this.onPlayerHit(dealt, killed, e);
      _q.set(e.position.x, e.position.y + e.radius + 1.2, e.position.z);
      if (dealt > 0) ctx.fx.floatText(_q, `💥${Math.round(dealt)}`, killed ? '#fff3a0' : '#ffd23a', 1.15);
    }
    this.clearTargets();
  }

  /** EARTHQUAKE ring i: a shockwave sweeping from the last ring's radius out to this one, cracking the ground. Rings
   *  roll out over a second from a fixed centre: they judge height from the floor it was cast on (`from`), not from
   *  where the plow is now (driving off a ramp after casting does not lift the quake off the ground). */
  private quakeRing(i: number, x: number, z: number, from: CastOrigin): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const R = QUAKE_RINGS[i];
    const inner = i > 0 ? QUAKE_RINGS[i - 1] - 1 : 0;
    const top = from.y;
    _q.set(x, top + 0.12, z);
    ctx.fx.ring(_q, R, 0xffc21a);
    ctx.fx.ring(_q, R * 0.92, 0xffffff);
    const n = Math.round(R * 2);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.2;
      const qx = x + Math.sin(a) * R;
      const qz = z + Math.cos(a) * R;
      _q.set(qx, waveFloor(ctx.terrain, top, qx, qz) + 0.3, qz);
      ctx.fx.burst(_q, { color: Math.random() < 0.5 ? 0xffffff : 0x6b5a48, count: 4, speed: 7, size: 0.3, gravity: 18, life: 0.6 });
    }
    this.b.snow?.melt(x, z, R, 0.15);
    this.shake(1 - i * 0.15);
    this.impactHit('pound', _q.set(x, top + 0.5, z), 1 - i * 0.2);
    this.b.audio.play('thud', { pitch: 0.75 - i * 0.1 });
    ultBlast(this.h, x, z, inner, R, st.poundDamage * QUAKE_MULT, { knock: st.poundKnock * 1.2, stun: st.poundStun, text: '🌍', color: '#ffd23a', reach: Reach.Wave, from });
  }

  ultStart(x: number, z: number, plow: PlowAPI): number {
    this.ultStep = 0;
    _q.set(x, (plow.surfaceY || 0) + 0.12, z);
    this.ctx.fx.burst(_q, { color: 0x6b5a48, count: 30, speed: 6, size: 0.4, gravity: 14, life: 0.8 });
    this.b.audio.play('roar', { pitch: 0.6, volume: 0.8 });
    return QUAKE_RINGS.length * QUAKE_GAP + 1;
  }

  ultTick(t: number, _dt: number, x: number, z: number, from: CastOrigin): boolean {
    while (this.ultStep < QUAKE_RINGS.length && t >= this.ultStep * QUAKE_GAP) this.quakeRing(this.ultStep++, x, z, from);
    return this.ultStep >= QUAKE_RINGS.length;
  }

  /** Re-arm the pound and drop out of any leap. */
  clear(): void {
    this.poundCharge = 1;
    if (this.poundT >= 0 && this.b.plow) this.b.plow.hop = 0;
    this.poundT = -1;
    this.airPound = false;
  }
}
