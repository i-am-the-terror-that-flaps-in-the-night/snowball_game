import * as THREE from 'three';
import { isVehicle } from '../../config/plows';
import { SLAM_DAMAGE_K } from '../../core/types';
import { GRAVITY } from '../../world/Terrain';
import { MIN_AIR } from '../../world/terrainMotion';
import { Kit, Reach, _fwd, _p, _q, type CombatHost } from './shared';
import type { BruteKit } from './brute';

/** Knockback scratch: damage() copies it synchronously and never keeps it. Never written from Combat.hitPlow (the
 *  Duel victim path), so it stays valid across the nested victim hit. */
const _kb = new THREE.Vector3();

/* ------------------------------------------------------------------ landing attacks (level overhaul, 3D combat)
 * STOMP: touching down at speed next to / on a bot on your level hurts it, scaled by the touchdown speed.
 * AIR SLAM: SPACE while airborne (every plow but ARSENAL, whose SPACE is the Mag Shotgun; ball or not) dives at
 *   AIR_SLAM_DIVE m/s; the landing sends a shockwave whose radius and damage grow with the touchdown speed and the
 *   drop height. A held ball adds the ground slam's
 *   ball damage on top (and is used up). BRUTUS's Ground Pound pressed in the air dives the same way and lands as a
 *   bigger crater; both stack in one flight. The ground slam is unchanged when grounded. */

/** Touchdown speed (m/s) from which a landing stomps. A 2 m drop is ~9.8 m/s at normal gravity. */
export const STOMP_MIN_IMPACT = 6;
/** Stomp damage = (impact - STOMP_ZERO) * STOMP_K, capped at STOMP_MAX, x stats.damageMult. */
export const STOMP_ZERO = 2;
export const STOMP_K = 3.2;
export const STOMP_MAX = 70;
/** Stomp reach beyond the two bodies touching (m) and the small shove it gives. */
const STOMP_REACH = 0.6;
const STOMP_KNOCK = 7;

/** Dive speed (m/s, down) of the air slam / air pound. */
export const AIR_SLAM_DIVE = 28;
/** Height above the surface (m) needed to start an air slam; lower, SPACE is left to the normal ground slam. */
export const AIR_SLAM_MIN_HEIGHT = 0.5;
/** Air slam shockwave: radius = BASE + K_IMPACT * impact + K_FALL * fall (capped at R_MAX) + ball * K_BALL. */
const AIR_R_BASE = 3;
const AIR_R_IMPACT = 0.1;
const AIR_R_FALL = 0.3;
const AIR_R_MAX = 8;
const AIR_R_BALL = 0.8;
/** Air slam damage = (BASE + K_IMPACT * impact + K_FALL * fall) * damageMult + SLAM_DAMAGE_K * ball^2 * damageMult;
 *  impact counts up to AIR_IMPACT_CAP m/s and fall up to AIR_FALL_CAP m. Rim takes AIR_RIM of the centre damage. */
const AIR_D_BASE = 14;
const AIR_D_IMPACT = 1;
const AIR_D_FALL = 3;
const AIR_IMPACT_CAP = 40;
const AIR_FALL_CAP = 6;
const AIR_RIM = 0.6;
/** BRUTUS air pound (Ground Pound pressed while airborne): radius x AIR_POUND_RADIUS, damage x (AIR_POUND_DMG +
 *  impact / AIR_POUND_PER, at most + AIR_POUND_EXTRA) on top of the normal leap pound. */
export const AIR_POUND_RADIUS = 1.3;
const AIR_POUND_DMG = 1.2;
const AIR_POUND_PER = 70;
const AIR_POUND_EXTRA = 0.4;

/** Stomp damage for a touchdown at `impact` m/s (0 below STOMP_MIN_IMPACT). */
export function stompDamage(impact: number, damageMult = 1): number {
  if (!(impact >= STOMP_MIN_IMPACT)) return 0;
  return Math.min(STOMP_MAX, (impact - STOMP_ZERO) * STOMP_K) * damageMult;
}

/** Air slam shockwave radius (m) for a touchdown at `impact` m/s after dropping `fall` m, with a held ball `ballR`. */
export function airSlamRadius(impact: number, fall: number, ballR = 0): number {
  const i = Math.min(AIR_IMPACT_CAP, Math.max(0, impact));
  const f = Math.min(AIR_FALL_CAP, Math.max(0, fall));
  return Math.min(AIR_R_MAX, AIR_R_BASE + AIR_R_IMPACT * i + AIR_R_FALL * f) + Math.max(0, ballR) * AIR_R_BALL;
}

/** Air slam centre damage (before armor) for the same inputs. */
export function airSlamDamage(impact: number, fall: number, ballR = 0, damageMult = 1): number {
  const i = Math.min(AIR_IMPACT_CAP, Math.max(0, impact));
  const f = Math.min(AIR_FALL_CAP, Math.max(0, fall));
  const r = ballR >= 0.2 ? ballR : 0;
  return (AIR_D_BASE + AIR_D_IMPACT * i + AIR_D_FALL * f + SLAM_DAMAGE_K * r * r) * damageMult;
}

/** Ground Pound damage multiplier when it lands from an air pound at `impact` m/s. */
export function airPoundMult(impact: number): number {
  return AIR_POUND_DMG + Math.min(AIR_POUND_EXTRA, Math.max(0, impact) / AIR_POUND_PER);
}

/** Plow slam state, read through a narrow duck-typed view (the plow keeps it private; same pattern as the Adrenaline
 *  refund in Combat). Plow.update already leaves SPACE to the air slam while airborne AIR_SLAM_MIN_HEIGHT or more
 *  over the surface (no ground slam, no 'error' buzz without a ball); this only covers the frame the plow crosses that
 *  height between its input read and its vertical step. */
interface SlamState {
  slamPhase?: number;
  slamT?: number;
  slamHit?: boolean;
  /** Classic Plow SPACE hold (seconds since the press, -1 = none): a hold begun on the dive press is dropped too. */
  spaceT?: number;
}
/** A ground slam younger than this (s, still in its wind-up and before its impact) is replaced by the air slam. */
const SLAM_JUST_STARTED = 0.05;

/** Stomps, the air slam and the air-pound landing for the bound plow (polls the plow, so it works for any pilot). */
export class AirKit extends Kit {
  /** An air slam dive is on its way down. */
  slamPending = false;
  /** Tracking the current flight: was airborne last frame, its last vertical speed / flight time and peak height. */
  private wasAir = false;
  private lastVy = 0;
  private lastAirT = 0;
  private peakY = -Infinity;

  constructor(
    h: CombatHost,
    private readonly brute: BruteKit,
  ) {
    super(h);
  }

  update(dt: number): void {
    const plow = this.b.plow;
    if (!plow || plow.dead) {
      this.reset();
      return;
    }
    const air = plow.airborne === true;
    if (air) {
      if (!this.wasAir) this.peakY = plow.position.y;
      this.wasAir = true;
      this.lastVy = plow.vy;
      this.lastAirT = plow.airTime;
      if (plow.position.y > this.peakY) this.peakY = plow.position.y;
      this.tryAirSlam();
      return;
    }
    if (this.wasAir) {
      // Touchdown this frame: the plow's last airborne vy plus one frame of gravity is the impact speed.
      const g = this.ctx.terrain?.gravity ?? GRAVITY;
      const impact = Math.max(0, -this.lastVy + g * dt);
      const fall = Math.max(0, this.peakY - plow.position.y);
      const flight = this.lastAirT + dt;
      this.wasAir = false;
      this.peakY = -Infinity;
      this.landed(impact, fall, flight);
    }
  }

  /** SPACE while airborne and clear of the surface: dive. */
  private tryAirSlam(): void {
    const plow = this.b.plow;
    if (this.slamPending || plow.position.y - plow.surfaceY < AIR_SLAM_MIN_HEIGHT) return;
    // Only the Classic air-slams: every other vehicle's SPACE is its kit's primary ability (VehicleKit.primary).
    if (isVehicle(this.b.stats)) return;
    if (!this.b.input.wasPressed('Space')) return;
    // Only if the plow started a ground slam on this very press (it was just under the height at its input read):
    // cancel that one. A slam begun before lift-off plays out untouched.
    const s = plow as unknown as SlamState;
    if (s.slamPhase === 1 && !s.slamHit && typeof s.slamT === 'number' && s.slamT <= SLAM_JUST_STARTED) s.slamPhase = 0;
    if (typeof s.spaceT === 'number' && s.spaceT >= 0 && s.spaceT <= SLAM_JUST_STARTED) s.spaceT = -1;
    this.slamPending = true;
    plow.dive(AIR_SLAM_DIVE);
    this.b.audio.play('airSlam');
    _q.set(plow.position.x, plow.position.y + 0.8, plow.position.z);
    this.ctx.fx.burst(_q, { color: 0xffffff, count: 14, speed: 4, size: 0.22, gravity: -6, life: 0.35 });
  }

  private landed(impact: number, fall: number, flight: number): void {
    const plow = this.b.plow;
    const pound = this.brute.takeAirPound();
    if (pound) this.brute.poundImpact(plow, AIR_POUND_RADIUS, airPoundMult(impact), 'airSlam');
    if (this.slamPending) {
      this.slamPending = false;
      this.airSlamImpact(impact, fall);
    } else if (!pound && flight >= MIN_AIR) this.stomp(impact);
  }

  /** STOMP: every bot on your level touching the plow at touchdown takes stompDamage(impact). */
  stomp(impact: number): number {
    const dmg0 = stompDamage(impact, this.b.stats.damageMult);
    if (dmg0 <= 0) return 0;
    const ctx = this.ctx;
    const plow = this.b.plow;
    const px = plow.position.x;
    const pz = plow.position.z;
    const hits = this.collect(px, pz, plow.radius + STOMP_REACH, Reach.Body);
    let n = 0;
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
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, dmg0 * this.hitMult(e), {
        source: 'stomp',
        knockback: _kb.set(dx * STOMP_KNOCK, 0, dz * STOMP_KNOCK),
        fromX: px,
        fromZ: pz,
      });
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      this.onPlayerHit(dealt, killed, e);
      _q.set(e.position.x, e.position.y + e.radius + 1.3, e.position.z);
      ctx.fx.floatText(_q, dealt > 0 ? `STOMP! ${Math.round(dealt)}` : 'STOMP!', killed ? '#fff3a0' : '#ffb340', 1.1);
      _q.set(e.position.x, e.position.y + 0.6, e.position.z);
      ctx.fx.burst(_q, { color: 0xffc04a, count: 14, speed: 7, size: 0.09, gravity: 20, life: 0.4 });
      n++;
    }
    this.clearTargets();
    if (n > 0) {
      this.shake(0.3);
      this.b.audio.play('ram', { volume: 0.9, pitch: 0.75 });
    }
    return n;
  }

  /** The air slam landing: a ground shockwave on the plow's level, scaled by touchdown speed and drop. */
  airSlamImpact(impact: number, fall: number): number {
    const ctx = this.ctx;
    const st = this.b.stats;
    const plow = this.b.plow;
    const fx = ctx.fx;
    // A held ball joins in (used up, like the ground slam; Snow Reserve keeps its share on the blade).
    let r = plow.heldBallRadius;
    if (r < 0.2) r = 0;
    const volume = r > 0 ? plow.stealSnow(1 - st.reserveFrac) : 0;
    const R = airSlamRadius(impact, fall, r);
    const dmg = airSlamDamage(impact, fall, r, st.damageMult);
    const knockMag = 12 + 0.3 * Math.min(AIR_IMPACT_CAP, impact) + 4 * r;
    const freeze = st.frostCore && r > 0 ? 3 : 0;
    const x = plow.position.x;
    const z = plow.position.z;
    this.smashProps(x, z, R);
    const hits = this.collect(x, z, R, Reach.Wave);
    let count = 0;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      let dx = e.position.x - x;
      let dz = e.position.z - z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-3) {
        plow.getForward(_fwd);
        dx = _fwd.x;
        dz = _fwd.z;
      } else {
        dx /= d;
        dz /= d;
      }
      const fallK = 1 - (1 - AIR_RIM) * Math.min(1, d / R);
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, dmg * fallK * this.hitMult(e), {
        source: 'airSlam',
        knockback: _kb.set(dx * knockMag * fallK, 0, dz * knockMag * fallK),
        freezeSeconds: freeze,
        fromX: x,
        fromZ: z,
        ballRadius: r,
      });
      count++;
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      this.onPlayerHit(dealt, killed, e);
      _q.set(e.position.x, e.position.y + e.radius + 1.3, e.position.z);
      if (dealt > 0) fx.floatText(_q, `💥${Math.round(dealt)}`, killed ? '#fff3a0' : '#ffd23a', 1.2);
    }
    this.clearTargets();

    // Crater: stacked rings on the snow, a white blast, snow (and the ball) thrown out.
    // fx.ring sits itself on the snow; bursts start at the surface under the plow.
    const top = plow.surfaceY || 0;
    _p.set(x, top, z);
    fx.ring(_p, R * 0.5, 0xffffff);
    fx.ring(_p, R, 0xdff2ff);
    fx.ring(_p, R * 1.1, freeze ? 0x9fe6ff : 0xffb340);
    _p.y = top + 0.4;
    fx.burst(_p, { color: 0xffffff, count: Math.round(36 + R * 6), speed: 10 + R, size: 0.3, gravity: 16, life: 0.9 });
    fx.burst(_p, { color: 0xbfe6ff, count: 20, speed: 7, size: 0.16, gravity: 10, life: 0.7 });
    fx.powder(_p, { size: 1 + R * 0.15, color: 0xd6e3f3 });
    if (volume > 0) this.b.snow?.addSnow(x, z, Math.max(1.2, r * 1.6), volume * 0.4);
    this.b.snow?.melt(x, z, R * 0.4, 0.3);
    this.shake(0.5 + Math.min(0.6, impact * 0.015));
    this.impactHit('slam', _p, Math.max(1, R * 0.4), { stop: count > 0 });
    this.b.audio.play('thud', { pitch: 0.8 });
    this.b.audio.play('slam', { pitch: 0.6, volume: 0.8 });
    const position = new THREE.Vector3(x, top, z);
    // 'slam' radius is a ball radius to listeners (zone ~ r * 1.3 + 2.2): report one that covers the crater.
    this.b.events.emit('slam', { hits: count, radius: Math.max(r, (R - 2.2) / 1.3), position });
    if (count >= 3) {
      this.b.events.emit('strike', { count, position: position.clone() });
      this.b.audio.play('strike');
    }
    return count;
  }

  private reset(): void {
    this.slamPending = false;
    this.wasAir = false;
    this.peakY = -Infinity;
  }

  clear(): void {
    this.reset();
  }
}

