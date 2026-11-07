import * as THREE from 'three';
import type { EnemyHandle, PlayerStats, PlowAPI } from '../../core/types';
import type { KillSource } from '../../core/events';
import { Kit, type AbilityDesc, type VehicleKit, Reach, _fwd, _q, waveFloor, type CastOrigin } from './shared';
import { ultBlast, type UltScript } from './ultimates';

/** EARTHQUAKE (BRUTUS): QUAKE_RINGS shockwaves rolling outward, each hitting the band it sweeps for QUAKE_MULT x
 *  pound damage + stun + knockback. */
const QUAKE_RINGS = [8, 13, 19] as const;
const QUAKE_GAP = 0.35;
const QUAKE_MULT = 1.07;
/** EARTHQUAKE leans a little harder on Ground Pound upgrades: x (poundDamage / QUAKE_BASE)^QUAKE_EXP (late ults keep pace). */
const QUAKE_BASE = 185;
const QUAKE_EXP = 0.2;
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
/* ---- WRECKING FIST (SPACE): seconds between punches, combo drop, finisher recovery, arm animation length. */
const FIST_GAP = 0.26;
const FIST_DROP = 0.9;
const FIST_RECOVER = 0;
const FIST_ANIM = 0.3;
/** Fist reach (m past the hull) and damage per jab (x fistSize, x Momentum line); the finisher hits FIST_FINISH x. */
const FIST_REACH = 3;
const FIST_BASE = 4.8;
const FIST_FINISH = 2.2;
/** Bots beside the one the fist lands on take this share. */
const FIST_SPLASH = 0.35;
const FIST_KNOCK = 5;
const FIST_FINISH_KNOCK = 24;
const FIST_FINISH_STUN = 0.5;
/* ---- SAW CHARGE (E): length (s), push speed (m/s), damage tick, sideways fling (m/s), reach and damage per second. */
const CHARGE_T = 0.6;
const CHARGE_SPEED = 17;
const CHARGE_TICK = 0.1;
const CHARGE_FLING = 9;
const SAW_REACH = 3.2;
const SAW_BASE_DPS = 40;
/** Share of the Buzzsaws line's dps (stats.sawDps) the charge adds. */
const SAW_LINE = 0.5;
const NO_STOP = { stop: false } as const;

/** Mega Hopper on BRUTUS: heavier fists (bigger reach and damage), from the ball-size stat. */
function fistSize(st: PlayerStats): number {
  return Math.max(1, st.maxBallRadius / 1.2);
}
/** One jab's raw damage: base x Mega Hopper x Momentum line (the parked share of its at-speed bonus). */
export function fistDamage(st: PlayerStats): number {
  return FIST_BASE * fistSize(st) * (1 + 120 * st.momentum * st.momentum);
}
/** Saw Charge reach (Buzzsaws line widens it) and damage per second (Whirlwind Turbine and Buzzsaws scale it). */
export function sawReach(st: PlayerStats): number {
  return Math.max(SAW_REACH, st.sawRadius * 0.8);
}
export function sawDps(st: PlayerStats): number {
  return (SAW_BASE_DPS * (st.whirlDamage / 10) + SAW_LINE * st.sawDps);
}
/** Punch animation: a fast snap out, a slower pull back (t = s since thrown, -1 idle). */
function armCurve(t: number): number {
  if (t < 0) return 0;
  const u = t / FIST_ANIM;
  return u < 0.3 ? u / 0.3 : Math.max(0, 1 - (u - 0.3) / 0.7) ** 2;
}
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
export class BruteKit extends Kit implements UltScript, VehicleKit {

  /* ---- WRECKING MECH: SPACE WRECKING FIST, E SAW CHARGE (VehicleKit, see ./shared.ts) ---- */
  readonly primaryDesc: AbilityDesc = {
    icon: '👊',
    label: 'FIST',
    hint: 'hold for WRECKING FIST',
    ready: () => 1, // no recovery: the combo loops for as long as SPACE is held
  };
  readonly secondaryDesc: AbilityDesc = { icon: '🪚', label: 'SAWS', hint: 'SAW CHARGE' };
  /** Wrecking Fist: next punch in the combo (0, 1, 2 = the finisher), time to the next punch, combo drop timer,
   *  finisher recovery, and each arm's punch animation clock (s since thrown; -1 = idle). */
  private fistStep = 0;
  private fistT = 0;
  private fistIdle = 0;
  private fistRecover = 0;
  private armT = [-1, -1];
  /** Saw Charge time left (s), its damage tick clock and the saw heat 0..1 (spin + halo, eases off after). */
  chargeT = 0;
  private chargeTick = 0;
  private sawHeat = 0;
  private twist = 0;

  /** SPACE (held): punch, punch, FINISHER; the combo drops after FIST_DROP s without a punch. */
  primary(dt: number, held: boolean, pressed: boolean): void {
    const plow = this.b.plow;
    this.fistT = Math.max(0, this.fistT - dt);
    if (this.fistRecover > 0) this.fistRecover = Math.max(0, this.fistRecover - dt);
    if ((this.fistIdle += dt) > FIST_DROP) this.fistStep = 0;
    for (let i = 0; i < 2; i++) if (this.armT[i] >= 0 && (this.armT[i] += dt) > FIST_ANIM) this.armT[i] = -1;
    if (plow && !plow.dead && (held || pressed) && this.fistT <= 0 && this.fistRecover <= 0 && this.chargeT <= 0) this.punch(plow);
    this.pose(dt, plow);
  }

  /** E: SAW CHARGE — a short forward charge, both saws screaming, shredding everything it drives through. */
  secondary(dt: number, _held: boolean, pressed: boolean): boolean {
    const plow = this.b.plow;
    if (!plow || plow.dead) {
      this.chargeT = 0;
      return false;
    }
    let fired = false;
    if (pressed && this.chargeT <= 0) {
      fired = true;
      this.chargeT = CHARGE_T;
      this.chargeTick = 0;
      this.fistStep = 0;
      plow.getForward(_fwd);
      if (!this.puppet) plow.push(_fwd.x * CHARGE_SPEED, _fwd.z * CHARGE_SPEED);
      this.b.audio.play('dash', { pitch: 0.55, volume: 0.8 });
      this.b.audio.play('whirl', { pitch: 1.6, volume: 0.6 });
      this.shake(0.25);
    }
    if (this.chargeT > 0) {
      this.chargeT -= dt;
      plow.getForward(_fwd);
      // Hold the charge speed against the push decay (Plow: pushVel *= exp(-6.5 dt)).
      if (!this.puppet && this.chargeT > 0) {
        const k = CHARGE_SPEED * (1 - Math.exp(-6.5 * dt));
        plow.push(_fwd.x * k, _fwd.z * k);
      }
      this.chargeTick -= dt;
      if (this.chargeTick <= 0) {
        this.chargeTick += CHARGE_TICK;
        this.sawTick(plow);
      }
    }
    return fired;
  }

  /** One punch of the combo: the bot straight ahead takes the full hit, the rest of the fist's arc a share. */
  private punch(plow: PlowAPI): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const step = this.fistStep;
    const fin = step === 2;
    this.fistStep = fin ? 0 : step + 1;
    this.fistIdle = 0;
    this.fistT = FIST_GAP;
    if (fin && FIST_RECOVER > 0) this.fistRecover = FIST_RECOVER;
    if (fin) this.armT[0] = this.armT[1] = 0;
    else this.armT[step] = 0;
    plow.getForward(_fwd);
    const reach = FIST_REACH * fistSize(st);
    const cx = plow.position.x + _fwd.x * (plow.radius + reach * 0.5);
    const cz = plow.position.z + _fwd.z * (plow.radius + reach * 0.5);
    const R = reach * (fin ? 0.8 : 0.6);
    const dmg = fistDamage(st) * (fin ? FIST_FINISH : 1);
    const hits = this.collect(cx, cz, R, Reach.Body);
    // Primary: the bot nearest the fist line.
    let best: EnemyHandle | null = null;
    let bestD = Infinity;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - cx, e.position.z - cz);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    let landed = false;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive || this.puppet) continue;
      const share = e === best ? 1 : FIST_SPLASH;
      const knock = fin ? FIST_FINISH_KNOCK : FIST_KNOCK;
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, dmg * share * st.damageMult * this.hitMult(e), {
        source: 'ram',
        knockback: new THREE.Vector3(_fwd.x * knock * share, 0, _fwd.z * knock * share),
        stunSeconds: fin ? FIST_FINISH_STUN : undefined,
        fromX: plow.position.x,
        fromZ: plow.position.z,
      });
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      this.onPlayerHit(dealt, killed, e);
      landed = true;
      if (dealt > 0) {
        _q.set(e.position.x, e.position.y + e.radius + 1, e.position.z);
        ctx.fx.floatText(_q, `👊${Math.round(dealt)}`, fin ? '#ffd23a' : '#ffffff', fin ? 1.1 : 0.8);
      }
    }
    this.clearTargets();
    // Fist FX at the knuckles: a puff on every jab, a shock ring + snow blast on the finisher.
    _q.set(cx, (plow.surfaceY || 0) + 1, cz);
    if (fin) {
      ctx.fx.burst(_q, { color: 0xffffff, count: 26, speed: 11, size: 0.2, gravity: 16, life: 0.5 });
      ctx.fx.burst(_q, { color: 0xffc21a, count: 12, speed: 8, size: 0.1, gravity: 10, life: 0.35 });
      _q.y = (plow.surfaceY || 0) + 0.1;
      ctx.fx.ring(_q, R, 0xffc21a);
      this.shake(0.45);
      this.impactHit('pound', _q, landed ? 0.6 : 0.3, landed ? undefined : NO_STOP);
      this.b.audio.play('slam', { pitch: 0.75 });
      if (landed) this.b.audio.play('thud', { pitch: 1.2, volume: 0.7 });
    } else {
      ctx.fx.burst(_q, { color: landed ? 0xfff2b0 : 0xffffff, count: landed ? 12 : 5, speed: 6, size: 0.12, gravity: 12, life: 0.3 });
      if (landed) this.shake(0.12);
      this.b.audio.play(landed ? 'ram' : 'dash', { pitch: landed ? 1.1 + step * 0.15 : 1.8, volume: landed ? 0.6 : 0.25 });
    }
  }

  /** Saw Charge damage tick: every bot around the front of the hull is shredded and flung aside. */
  private sawTick(plow: PlowAPI): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    plow.getForward(_fwd);
    const R = sawReach(st);
    const cx = plow.position.x + _fwd.x * (plow.radius * 0.8);
    const cz = plow.position.z + _fwd.z * (plow.radius * 0.8);
    const dmg = sawDps(st) * CHARGE_TICK;
    const hits = this.collect(cx, cz, R, Reach.Body);
    let any = false;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive || this.puppet) continue;
      const dx = e.position.x - plow.position.x;
      const dz = e.position.z - plow.position.z;
      // Flung off to whichever side of the nose it is on.
      const side = dx * _fwd.z - dz * _fwd.x >= 0 ? 1 : -1;
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, dmg * st.damageMult * this.hitMult(e), {
        source: 'other',
        knockback: new THREE.Vector3(_fwd.z * side * CHARGE_FLING + _fwd.x * 3, 0, -_fwd.x * side * CHARGE_FLING + _fwd.z * 3),
        fromX: plow.position.x,
        fromZ: plow.position.z,
      });
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      this.onPlayerHit(dealt, killed, e, false);
      any = true;
      _q.set(e.position.x, e.position.y + 0.6, e.position.z);
      ctx.fx.burst(_q, { color: Math.random() < 0.5 ? 0xffd040 : 0xfff2b0, count: 8, speed: 9, size: 0.07, gravity: 14, life: 0.3 });
      if (dealt > 0) {
        _q.y = e.position.y + e.radius + 1;
        ctx.fx.floatText(_q, `🪚${Math.round(dealt)}`, '#ffd040', 0.75);
      }
    }
    this.clearTargets();
    // Sparks + snow thrown off both saws while charging.
    for (const sx of [-1, 1]) {
      _q.set(plow.position.x + _fwd.x * 1.5 + _fwd.z * sx * 1.45, (plow.surfaceY || 0) + 1, plow.position.z + _fwd.z * 1.5 - _fwd.x * sx * 1.45);
      ctx.fx.burst(_q, { color: 0xffffff, count: 4, speed: 6, size: 0.14, gravity: 12, life: 0.35 });
      ctx.fx.burst(_q, { color: 0xffb030, count: 3, speed: 8, size: 0.05, gravity: 10, life: 0.25 });
    }
    this.b.audio.play('whirlTick', { volume: any ? 0.5 : 0.3, pitch: 1.8 });
  }

  /** Drive the mech's arms / saws (Plow.bruteRig; absent on scripted plows). */
  private pose(dt: number, plow: PlowAPI | undefined): void {
    const rig = (plow as unknown as { bruteRig?: { pose(dt: number, l: number, r: number, saw: number, twist: number): void } | null } | undefined)?.bruteRig;
    const target = this.chargeT > 0 ? 1 : 0;
    this.sawHeat += (target - this.sawHeat) * Math.min(1, dt * (target ? 10 : 2.5));
    if (!rig) return;
    const l = armCurve(this.armT[0]);
    const r = armCurve(this.armT[1]);
    const tw = (r - l) * 0.35;
    this.twist += (tw - this.twist) * Math.min(1, dt * 18);
    rig.pose(dt, l, r, this.sawHeat, this.twist);
  }

  /** Ground Pound recharge 0..1 and the hop timer (-1 = grounded). */
  poundCharge = 1;
  poundT = -1;
  /** Ground Pound pressed while airborne: the plow dives and the pound lands as a bigger crater (combat/air.ts). */
  private airPound = false;
  private ultStep = 0;

  /** Passive Buzzsaws are gone (the saws only cut during SAW CHARGE, E); kept for Combat's update order. */
  updateSaws(_dt: number): void {}

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
    ultBlast(this.h, x, z, inner, R, st.poundDamage * QUAKE_MULT * Math.max(1, st.poundDamage / QUAKE_BASE) ** QUAKE_EXP, { knock: st.poundKnock * 1.2, stun: st.poundStun, text: '🌍', color: '#ffd23a', reach: Reach.Wave, from });
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
