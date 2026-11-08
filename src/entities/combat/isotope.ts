import * as THREE from 'three';
import type { EnemyHandle, PlowAPI } from '../../core/types';
import { Kit, type AbilityDesc, type VehicleKit, Reach, WAVE_BAND, _p, _q, castOrigin, waveFloor, type CastOrigin, type CombatHost } from './shared';
import { GroundDisc } from './groundDisc';
import { ultCharge } from './ultimates';

/** ISOTOPE: irradiated bots take this much extra damage from the player; radiation lasts RAD_SECONDS after the
 *  last dose. Fallout pools tick every POOL_TICK; Chain Reaction blasts reach CHAIN_RADIUS. */
// Design floor from the user (stronger irradiation): balance ISOTOPE through damage numbers, not by lowering RAD_VULN
// below 1.3 or removing the radiation burn / the trail's grip.
export const RAD_VULN = 1.3;
const RAD_SECONDS = 3;
/** Radiation burns too: every RAD_TICK s an irradiated bot takes RAD_DPS x RAD_TICK (x damage mult x reactorBoost). */
const RAD_TICK = 0.5;
export const RAD_DPS = 5.5;
const POOL_TICK = 0.3;
const MAX_POOLS = 4;
const CHAIN_RADIUS = 4;
/** NUKE (ISOTOPE): Critical Mass fills from radiation damage dealt (this much on a fresh plow, see ultCharge); the
 *  next F arms a NUKE that goes off instantly — NUKE_DMG_MULT x Meltdown damage across NUKE_RADIUS, falling off to
 *  NUKE_RIM_FRAC at the edge, plus a giant fallout pool. */
const NUKE_CHARGE_DMG = 1800;
const NUKE_RADIUS = 18;
const NUKE_DMG_MULT = 2.6;
const NUKE_RIM_FRAC = 0.35;
const NUKE_KNOCK = 26;

/** RAD SPRAYER (SPACE, hold): tick, damage per tick on the nearest bot in the cone (x damage mult x reactorBoost),
 *  share for the others in the cone, cone half angle (cos), reach (+ Mega Hopper: ball radius above the 1.2 m base),
 *  nozzle position on the hauler's nose (vehicles/isotope.ts), and the share of its damage that fills Critical Mass. */
const SPRAY_TICK = 0.12;
export const SPRAY_DAMAGE = 1.6;
const SPRAY_SPLASH = 0.55;
const SPRAY_COS = Math.cos(0.75);
/** Avalanche Core on the hauler: a 50% wider spray cone. */
const SPRAY_COS_WIDE = Math.cos(1.05);
/** RAD SPRAYER leans on Meltdown's reactor overheat to this power (its own Rad Sprayer line does the rest). */
const SPRAY_REACTOR_EXP = 0.8;
export const sprayRange = (ballR: number) => 8.5 + 2 * Math.max(0, ballR - 1.2);
const NOZZLE_Y = 1.25;
const NOZZLE_Z = 2.3;
const SPRAY_CRIT = 0.5;
/** FALLOUT TRAIL (E): seconds of trail, a puddle every TRAIL_DROP s (TRAIL_N pooled), each PUDDLE_LIFE s; damage tick
 *  and dps (Half-Life pool dps share), radius (Half-Life pool radius share). */
const TRAIL_SECONDS = 4;
const TRAIL_DROP = 0.3;
const TRAIL_N = 12;
const PUDDLE_LIFE = 3.5;
const TRAIL_TICK = 0.3;
/** Whirlwind Turbine levels (whirlDamage above its base 10) make the coolant hotter; Snow Compactor (collectRate
 *  above its base 0.12) makes it thicker, so puddles linger longer (up to 2x); Frost Core: the sludge holds bots. */
export const trailDps = (poolDps: number, whirlDamage = 10) => (22 + poolDps * 0.6) * Math.max(1, whirlDamage / 10);
export const puddleLife = (collectRate: number) => PUDDLE_LIFE * Math.min(2, Math.max(1, collectRate / 0.12));
const SLUDGE_HOLD = 0.6;
/** Every puddle grips: a bot dosed in one is held this long (Frost Core: SLUDGE_HOLD). */
const SLUDGE_GRIP = 0.3;
export const trailRadius = (poolR: number) => 1.6 + poolR * 0.12;
/** Meltdown upgrades overheat the whole reactor: RAD SPRAYER and FALLOUT TRAIL grow with Meltdown's base damage,
 *  slowly at first and steeply late (the early levels already pay off through Meltdown and its pools). */
export const reactorBoost = (meltDamage: number) => 1 + 1.0 * Math.max(0, meltDamage / 125 - 1) ** 2.5;
const _f = new THREE.Vector3();
const _d = new THREE.Vector3();

/** ISOTOPE: Meltdown + fallout pools, Rad Aura, radiation, Chain Reaction and the NUKE. */
export class IsotopeKit extends Kit implements VehicleKit {

  /* ---- REACTOR HAULER: SPACE RAD SPRAYER (hold) and E FALLOUT TRAIL (VehicleKit, see ./shared.ts) ---- */
  readonly primaryDesc: AbilityDesc = { icon: '☣️', label: 'SPRAY', hint: 'hold for RAD SPRAYER' };
  readonly secondaryDesc: AbilityDesc = { icon: '🟢', label: 'TRAIL', hint: 'FALLOUT TRAIL' };
  /** RAD SPRAYER: tick timer / count; is it spraying this frame (HUD / tests). */
  private sprayT = 0;
  private sprayN = 0;
  sprayOn = false;
  /** FALLOUT TRAIL: seconds of trail left, next drop timer, damage tick timer, bots dosed this tick. */
  trailT = 0;
  private dropT = 0;
  private trailTickT = 0;
  private trailDosed = new Set<number>();
  private puddles: { disc: GroundDisc; mat: THREE.MeshBasicMaterial; x: number; z: number; r: number; t: number; life: number; from: CastOrigin }[] = [];

  /** SPACE (hold): every SPRAY_TICK s the nozzle on the hauler's nose hoses a glowing cone (SPRAY_COS half angle,
   *  sprayRange + Mega Hopper) that doses every bot in it: radiation damage, irradiated. The nearest takes full
   *  damage, the rest SPRAY_SPLASH of it. Meltdown upgrades overheat the reactor (reactorBoost). */
  primary(dt: number, held: boolean, _pressed: boolean): void {
    this.sprayT -= dt;
    this.sprayOn = held;
    if (!held || this.sprayT > 0) return;
    const st = this.b.stats;
    const tick = SPRAY_TICK * Math.max(0.4, st.cooldownMult || 1);
    this.sprayT = Math.max(0, this.sprayT + tick);
    const plow = this.b.plow;
    if (!plow || plow.dead) return;
    const ctx = this.ctx;
    const px = plow.position.x;
    const pz = plow.position.z;
    plow.getForward(_f);
    const floor = plow.surfaceY || 0;
    const range = sprayRange(st.maxBallRadius) + (st.sprayReach || 0);
    this.sprayN++;
    // Nozzle jet: green streaks + a glowing mist down the cone.
    _p.set(px + _f.x * NOZZLE_Z, floor + NOZZLE_Y, pz + _f.z * NOZZLE_Z);
    _d.set(_f.x, -0.08, _f.z);
    ctx.fx.sparks(_p, _d, { color: 0x7dff4a, count: 7, speed: range * 2.4, spread: 0.32, size: 0.12, length: 0.06, gravity: 3, life: 0.36 });
    {
      _d.set(_f.x * range * 1.6, 0.6, _f.z * range * 1.6);
      ctx.fx.smoke(_p, { count: 2, color: 0x5dff3a, additive: 0.6, size: 0.7, grow: 3.4, life: 0.45, speed: 1.2, up: 0, rise: 0.4, drag: 2.2, spread: 0.2, opacity: 0.55, dir: _d });
    }
    if (this.sprayN % 3 === 0) this.b.audio.play('whirlTick', { volume: 0.22, pitch: 0.55 + Math.random() * 0.1 });
    const cone = st.avalancheCore ? SPRAY_COS_WIDE : SPRAY_COS;
    const hits = this.collect(px, pz, range + 1, Reach.Body);
    let near: EnemyHandle | null = null;
    let nd = Infinity;
    let n = 0;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      const dx = e.position.x - px;
      const dz = e.position.z - pz;
      const d = Math.hypot(dx, dz) || 1e-3;
      if (d - e.radius > range || (dx * _f.x + dz * _f.z) / d < cone) continue;
      hits[n++] = e;
      if (d < nd) {
        nd = d;
        near = e;
      }
    }
    if (near) {
      const dmg = SPRAY_DAMAGE * reactorBoost(st.meltDamage) ** SPRAY_REACTOR_EXP * (st.sprayBoost || 1);
      for (let i = 0; i < n; i++) {
        const e = hits[i];
        const hp0 = e.hp;
        this.radHit(e, dmg * (e === near ? 1 : SPRAY_SPLASH), true, SPRAY_CRIT);
        if (this.sprayN % 2 === 0) {
          _q.set(e.position.x, e.position.y + e.radius * 0.8, e.position.z);
          ctx.fx.burst(_q, { color: 0x9dff5a, count: 3, speed: 3, size: 0.1, gravity: -2, life: 0.4 });
          const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
          if (e === near && dealt > 0 && this.sprayN % 6 === 0) ctx.fx.floatText(_q, `☣${Math.round(dealt * 3)}`, '#9dff5a', 0.75);
        }
      }
    }
    this.clearTargets();
  }

  /** E: FALLOUT TRAIL — for TRAIL_SECONDS the reactor dumps coolant: a toxic puddle every TRAIL_DROP s behind the
   *  hauler (Half-Life: wider, hotter) that doses bots driving through. Ticks the puddles every frame. */
  secondary(dt: number, _held: boolean, pressed: boolean): boolean {
    let fired = false;
    const plow = this.b.plow;
    if (pressed && plow && !plow.dead) {
      fired = true;
      this.trailT = TRAIL_SECONDS;
      this.dropT = 0;
      _q.set(plow.position.x, (plow.surfaceY || 0) + 1.2, plow.position.z);
      this.ctx.fx.smoke(_q, { count: 8, color: 0x7dff4a, additive: 0.5, size: 0.6, grow: 2.5, life: 0.7, speed: 3, up: 2, rise: 0.6, drag: 2, spread: 0.6, opacity: 0.6 });
      this.b.audio.play('burst', { volume: 0.5, pitch: 0.6 });
      this.b.audio.play('steal', { volume: 0.4, pitch: 0.7 });
    }
    if (this.trailT > 0) {
      this.trailT -= dt;
      this.dropT -= dt;
      if (plow && !plow.dead && this.dropT <= 0) {
        this.dropT += TRAIL_DROP;
        plow.getForward(_f);
        const x = plow.position.x - _f.x * 1.9;
        const z = plow.position.z - _f.z * 1.9;
        this.layPuddle(x, z, trailRadius(this.b.stats.poolRadius), castOrigin(plow, this.trailFrom));
        _q.set(x, (plow.surfaceY || 0) + 0.5, z);
        this.ctx.fx.burst(_q, { color: 0x7dff4a, count: 3, speed: 1.5, size: 0.2, gravity: -2, life: 0.5 });
      }
    }
    this.updatePuddles(dt);
    return fired;
  }

  private readonly trailFrom: CastOrigin = { y: 0, deck: -1 };

  private layPuddle(x: number, z: number, r: number, from: CastOrigin): void {
    let pd = this.puddles.find((p) => p.t <= 0);
    if (!pd) pd = this.puddles.reduce((a, b) => (a.t < b.t ? a : b));
    pd.x = x;
    pd.z = z;
    pd.r = r;
    pd.t = pd.life = puddleLife(this.b.stats.collectRate);
    pd.from.y = from.y;
    pd.from.deck = from.deck;
    pd.disc.place(this.ctx.terrain, x, z, r, from.y, from.deck, 0.05, this.b.snow);
  }

  /** Puddles: fade, bubble, and every TRAIL_TICK dose each bot standing in one (once per tick, overlaps don't stack). */
  private updatePuddles(dt: number): void {
    const ctx = this.ctx;
    this.trailTickT -= dt;
    const tick = this.trailTickT <= 0;
    if (tick) {
      this.trailTickT += TRAIL_TICK;
      if (this.trailTickT < 0) this.trailTickT = 0;
      this.trailDosed.clear();
    }
    const st = this.b.stats;
    const dmg = trailDps(st.poolDps, st.whirlDamage) * reactorBoost(st.meltDamage) * TRAIL_TICK;
    for (let k = 0; k < this.puddles.length; k++) {
      const pd = this.puddles[k];
      if (pd.t <= 0) continue;
      pd.t -= dt;
      if (pd.t <= 0) {
        pd.disc.hide();
        continue;
      }
      pd.mat.opacity = (0.62 + 0.12 * Math.sin(ctx.time * 7 + pd.x)) * Math.min(1, pd.t / 0.6, (pd.life - pd.t) / 0.15 + 0.3);
      if (!tick) continue;
      if (Math.random() < 0.4) {
        _q.set(pd.x + (Math.random() - 0.5) * pd.r, pd.from.y + 0.25, pd.z + (Math.random() - 0.5) * pd.r);
        ctx.fx.burst(_q, { color: 0x7dff4a, count: 1, speed: 0.8, size: 0.18, gravity: -3, life: 0.6 });
      }
      const hits = this.b.enemies.query(pd.x, pd.z, pd.r, this.buf);
      for (let i = 0; i < hits.length; i++) {
        const e = hits[i];
        if (!e.alive || this.trailDosed.has(e.id) || !this.reaches(e, Reach.Wave, pd.from)) continue;
        this.trailDosed.add(e.id);
        this.radHit(e, dmg, false, SPRAY_CRIT, st.frostCore ? SLUDGE_HOLD : SLUDGE_GRIP);
      }
    }
  }

  /** Meltdown recharge 0..1. */
  meltCharge = 1;
  /** Fallout pools (pooled glowing discs draped over the floor). `from`: the floor the pool was cast on; the pool only
   *  doses bots standing on that floor (not one flying over it or on a deck above), whatever the plow does since. */
  private pools: { disc: GroundDisc; mat: THREE.MeshBasicMaterial; x: number; z: number; r: number; t: number; life: number; tickT: number; from: CastOrigin }[] = [];
  /** Irradiated bots -> seconds of radiation left. */
  readonly rads = new Map<EnemyHandle, number>();
  /** Radiation burn tick timer. */
  private radBurnT = 0;
  /** Chain Reaction blasts queued by irradiated wrecks. */
  readonly chainQueue: { x: number; y: number; z: number }[] = [];
  private radFxT = 0;
  private auraT = 0;
  private buf: EnemyHandle[] = [];
  /** When each bot last took a pool tick (ctx.time). */
  private poolHitAt = new Map<EnemyHandle, number>();
  /** Where the NUKE went off, and the floor it went off on (detonate reads them). */
  private nukeX = 0;
  private nukeZ = 0;
  private readonly nukeFrom: CastOrigin = { y: 0, deck: -1 };
  private readonly meltFrom: CastOrigin = { y: 0, deck: -1 };

  constructor(h: CombatHost) {
    super(h);
    for (let i = 0; i < MAX_POOLS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x5dff3a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      this.pools.push({ disc: new GroundDisc(h.ctx.scene, mat), mat, x: 0, z: 0, r: 1, t: 0, life: 1, tickT: 0, from: { y: 0, deck: -1 } });
    }
    for (let i = 0; i < TRAIL_N; i++) {
      // Normal blending (an additive glow vanishes on white snow): an opaque-ish toxic green sludge.
      const mat = new THREE.MeshBasicMaterial({ color: 0x46d414, transparent: true, opacity: 0, depthWrite: false });
      this.puddles.push({ disc: new GroundDisc(h.ctx.scene, mat), mat, x: 0, z: 0, r: 1, t: 0, life: 1, from: { y: 0, deck: -1 } });
    }
  }

  /** Lay a fallout pool (a free disc, else the oldest) of radius r on the cast floor `from` at (x, z). */
  private layPool(x: number, z: number, r: number, life: number, from: CastOrigin): void {
    let pl = this.pools.find((p) => p.t <= 0);
    if (!pl) pl = this.pools.reduce((a, b) => (a.t < b.t ? a : b));
    pl.x = x;
    pl.z = z;
    pl.r = r;
    pl.life = pl.t = life;
    pl.tickT = 0;
    pl.from.y = from.y;
    pl.from.deck = from.deck;
    // After the cast's melt: the pool lies on the snow left at its rim.
    pl.disc.place(this.ctx.terrain, x, z, r, from.y, from.deck, 0.06, this.b.snow);
  }

  /** Dose a bot: (re)start its radiation timer. */
  private irradiate(e: EnemyHandle): void {
    if (e.alive) this.rads.set(e, RAD_SECONDS);
  }

  /** Radiation damage to one bot (player credit, irradiates it). */
  private radHit(e: EnemyHandle, amount: number, heal = false, critFrac = 1, freezeSeconds = 0): void {
    if (!e.alive) return;
    this.irradiate(e);
    const hp0 = e.hp;
    const killed = this.b.enemies.damage(e, amount * this.b.stats.damageMult * this.hitMult(e), { source: 'other', fromX: e.position.x, fromZ: e.position.z, freezeSeconds: freezeSeconds || undefined });
    const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
    this.h.crit = Math.min(1, this.h.crit + (dealt * critFrac) / ultCharge(this.b.stats, NUKE_CHARGE_DMG));
    this.onPlayerHit(dealt, killed, e, false, heal);
  }

  /** Meltdown (F on ISOTOPE): a toxic blast around the plow that leaves a fallout pool behind. */
  updateMeltdown(dt: number): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const plow = this.b.plow;
    if (st.meltDamage <= 0 || !plow || plow.dead) return;
    if (this.meltCharge < 1) this.meltCharge = Math.min(1, this.meltCharge + (st.meltCooldown > 0 ? dt / st.meltCooldown : 1));
    if (!this.b.input.wasPressed('KeyF')) return;
    if (this.h.crit >= 1) return this.armNuke(plow);
    if (this.meltCharge < 1) {
      this.b.audio.play('error');
      return;
    }
    this.meltCharge = 0;
    this.b.events.emit('ability', { nuke: false });
    const px = plow.position.x;
    const pz = plow.position.z;
    const R = st.meltRadius;
    // Fx start on the floor under the plow (0 on flat arenas).
    const from = castOrigin(plow, this.meltFrom);
    const top = from.y;
    _q.set(px, top + 0.15, pz);
    ctx.fx.ring(_q, R * 0.5, 0xb8ff6a);
    ctx.fx.ring(_q, R, 0x5dff3a);
    ctx.fx.ring(_q, R * 1.1, 0x1f8a10);
    ctx.fx.burst(_q, { color: 0x7dff4a, count: 50, speed: 13, size: 0.3, gravity: -2, life: 0.8 });
    ctx.fx.burst(_q, { color: 0xeaff6a, count: 24, speed: 7, size: 0.2, gravity: -6, life: 0.9 });
    _q.set(px, top + 2.2, pz);
    ctx.fx.burst(_q, { color: 0x3dff1a, count: 30, speed: 4, size: 0.5, gravity: -5, life: 1.2 });
    this.shake(0.7);
    this.impactHit('meltdown', _q.set(px, top + 1, pz));
    this.b.audio.play('thud', { pitch: 0.7 });
    this.b.audio.play('zap', { volume: 0.6, pitch: 0.5 });
    this.smashProps(px, pz, R);
    const hits = this.collect(px, pz, R, Reach.Wave);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - px, e.position.z - pz);
      const fall = 1 - 0.4 * Math.min(1, d / R);
      const hp0 = e.hp;
      this.radHit(e, st.meltDamage * fall, true);
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      _q.set(e.position.x, e.position.y + e.radius + 1.2, e.position.z);
      if (dealt > 0) ctx.fx.floatText(_q, `☢${Math.round(dealt)}`, '#9dff5a', 1.1);
    }
    this.clearTargets();
    // Fallout pool. The blast melts the snow, so the pool sits on bare ground.
    this.b.snow.melt(px, pz, st.poolRadius, 1);
    this.layPool(px, pz, st.poolRadius, st.poolSeconds, from);
  }

  /** Critical Mass full + F: the NUKE goes off right where the plow stands. */
  private armNuke(plow: PlowAPI): void {
    this.h.crit = 0;
    this.b.events.emit('ability', { nuke: true });
    this.nukeX = plow.position.x;
    this.nukeZ = plow.position.z;
    castOrigin(plow, this.nukeFrom);
    this.ctx.ui.toast(this.b.local ? '☢ NUKE!' : '☢ INCOMING NUKE!', 'big');
    this.detonate();
  }

  private detonate(): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const px = this.nukeX;
    const pz = this.nukeZ;
    const R = NUKE_RADIUS;
    const top = this.nukeFrom.y;
    this.smashProps(px, pz, R);
    // Flash, shockwave rings, a rising stem and a mushroom cap, all from the floor it went off on.
    _q.set(px, top + 0.2, pz);
    ctx.fx.ring(_q, R * 0.3, 0xffffff);
    ctx.fx.ring(_q, R * 0.65, 0xfff3a0);
    ctx.fx.ring(_q, R, 0x7dff4a);
    ctx.fx.ring(_q, R * 1.15, 0xff8a1a);
    ctx.fx.burst(_q, { color: 0xffffff, count: 60, speed: 26, size: 0.4, gravity: 4, life: 0.6 });
    ctx.fx.smoke(_q, { count: 30, color: 0xffa030, additive: 0.3, size: 1.4, grow: 2.5, life: 0.9, speed: 16, up: 2, rise: 1, drag: 2.5, spread: 1.5, opacity: 0.95, radial: true });
    ctx.fx.smoke(_q, { count: 2, color: 0xffffff, additive: 1, size: 9, grow: 1.6, life: 0.35, speed: 0, up: 0, rise: 0, spread: 0, opacity: 1 });
    ctx.fx.smoke(_q, { count: 28, color: 0xd9d6c2, size: 1.6, grow: 2.6, life: 2.4, speed: 17, up: 1, rise: 0.4, drag: 1.6, spread: 2, opacity: 0.75, radial: true });
    ctx.fx.scorch(_q, R * 0.4, 1);
    for (let i = 0; i < 8; i++) {
      _q.set(px, top + 0.8 + i * 1.1, pz);
      const hot = i < 3;
      ctx.fx.smoke(_q, { count: 5, color: hot ? 0xffa43a : i < 5 ? 0xb8b088 : 0x8f8f78, additive: hot ? 0.3 : 0, size: 1.3 + i * 0.1, grow: 2, life: 2.6 + i * 0.12, speed: 0.8, up: 5 - i * 0.5, rise: 1, drag: 0.9, spread: 0.9, opacity: hot ? 0.8 : 0.72 });
    }
    _q.set(px, top + 9.5, pz);
    ctx.fx.smoke(_q, { count: 30, color: 0xa8a48a, size: 2.2, grow: 2.3, life: 3.4, speed: 6, up: 1.8, rise: 0.5, drag: 0.8, spread: 2.2, opacity: 0.8, radial: true });
    ctx.fx.smoke(_q, { count: 14, color: 0xffc860, additive: 0.35, size: 2, grow: 2, life: 1.6, speed: 3, up: 1, rise: 0.6, drag: 1, spread: 1.5, opacity: 0.75 });
    ctx.fx.smoke(_q, { count: 10, color: 0x7dff4a, additive: 0.3, size: 1.6, grow: 2.2, life: 2.2, speed: 7, up: 0.6, rise: 0.2, drag: 1, spread: 2, opacity: 0.5, radial: true });
    this.shake(1.8);
    this.impactHit('nuke', _q.set(px, top + 2, pz));
    this.b.audio.play('explosion');
    this.b.audio.play('thud', { pitch: 0.45 });
    this.b.audio.play('boss', { volume: 0.6, pitch: 0.6 });
    this.b.snow.melt(px, pz, R * 0.6, 1);
    // The NUKE's blast reaches higher than a ground wave (BLAST_BAND).
    const hits = this.collect(px, pz, R, Reach.Blast);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      let dx = e.position.x - px;
      let dz = e.position.z - pz;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d;
      dz /= d;
      const fall = 1 - (1 - NUKE_RIM_FRAC) * Math.min(1, d / R);
      this.irradiate(e);
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, st.meltDamage * NUKE_DMG_MULT * fall * st.damageMult * this.hitMult(e), {
        source: 'other',
        knockback: new THREE.Vector3(dx * NUKE_KNOCK * fall, 0, dz * NUKE_KNOCK * fall),
        fromX: px,
        fromZ: pz,
      });
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      this.onPlayerHit(dealt, killed, e, false);
      _q.set(e.position.x, e.position.y + e.radius + 1.4, e.position.z);
      if (dealt > 0) ctx.fx.floatText(_q, `☢${Math.round(dealt)}`, '#eaff6a', 1.4);
    }
    this.clearTargets();
    // A huge fallout pool that lingers.
    this.layPool(px, pz, R * 0.55, st.poolSeconds * 1.5, this.nukeFrom);
  }

  /** Fallout pools: glow, bubble and dose every bot standing in them. */
  updatePools(dt: number): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    let active = false;
    for (const pl of this.pools) {
      if (pl.t <= 0) continue;
      active = true;
      pl.t -= dt;
      if (pl.t <= 0) {
        pl.disc.hide();
        continue;
      }
      const fade = Math.min(1, pl.t / 0.8, (pl.life - pl.t) / 0.25 + 0.2);
      pl.mat.opacity = (0.32 + 0.08 * Math.sin(ctx.time * 6 + pl.x)) * fade;
      pl.tickT -= dt;
      if (pl.tickT > 0) continue;
      pl.tickT = POOL_TICK;
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * pl.r;
      const bx = pl.x + Math.sin(a) * rr;
      const bz = pl.z + Math.cos(a) * rr;
      const by = waveFloor(ctx.terrain, pl.from.y, bx, bz);
      // No bubbles past a deck edge (floor far below the cast level), where the pool doesn't reach.
      if (Math.abs(by - pl.from.y) <= 2 * WAVE_BAND) {
        _q.set(bx, by + 0.3, bz);
        ctx.fx.burst(_q, { color: 0x7dff4a, count: 2, speed: 1, size: 0.22, gravity: -3, life: 0.7 });
      }
      if (st.poolDps <= 0 || st.meltDamage <= 0) continue;
      const hits = this.b.enemies.query(pl.x, pl.z, pl.r, this.buf);
      for (let i = 0; i < hits.length; i++) {
        // Overlapping pools don't stack: one dose per bot per tick.
        const e = hits[i];
        // Ground pool: only bots standing on the floor it was cast on (height judged from that floor, not the plow).
        if (!this.reaches(e, Reach.Wave, pl.from)) continue;
        if (ctx.time - (this.poolHitAt.get(e) ?? -1) < POOL_TICK * 0.9) continue;
        this.poolHitAt.set(e, ctx.time);
        this.radHit(e, st.poolDps * POOL_TICK);
      }
    }
    if (!active && this.poolHitAt.size) this.poolHitAt.clear();
  }

  /** Rad Aura (ISOTOPE): passive radiation that doses every bot near the plow. */
  updateAura(dt: number): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const plow = this.b.plow;
    if (st.auraDps <= 0 || !plow || plow.dead) return;
    this.auraT -= dt;
    if (this.auraT > 0) return;
    const TICK = 0.4;
    this.auraT = TICK;
    const R = st.auraRadius;
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = R * (0.4 + Math.random() * 0.6);
      _q.set(plow.position.x + Math.sin(a) * rr, (plow.surfaceY || 0) + 0.4, plow.position.z + Math.cos(a) * rr);
      ctx.fx.burst(_q, { color: 0x5dff3a, count: 1, speed: 0.6, size: 0.18, gravity: -2.5, life: 0.6 });
    }
    const hits = this.b.enemies.query(plow.position.x, plow.position.z, R, this.buf);
    for (let i = 0; i < hits.length; i++) if (this.reaches(hits[i], Reach.Body)) this.radHit(hits[i], st.auraDps * TICK);
  }

  /** Radiation timers + the green glow over irradiated bots; Chain Reaction blasts from irradiated wrecks. */
  updateRads(dt: number): void {
    const ctx = this.ctx;
    this.radFxT -= dt;
    const glow = this.radFxT <= 0;
    if (glow) this.radFxT = 0.25;
    // Radiation burn: every RAD_TICK s each irradiated bot takes RAD_DPS (player credit, fills Critical Mass like
    // every radiation hit, no lifesteal).
    this.radBurnT -= dt;
    const burn = this.radBurnT <= 0 && this.rads.size > 0;
    if (this.radBurnT <= 0) this.radBurnT += RAD_TICK;
    if (burn) {
      const st = this.b.stats;
      const amt = RAD_DPS * RAD_TICK * reactorBoost(st.meltDamage);
      for (const [e] of this.rads) {
        if (!e.alive) continue;
        const hp0 = e.hp;
        const killed = this.b.enemies.damage(e, amt * st.damageMult * this.hitMult(e), { source: 'other', fromX: e.position.x, fromZ: e.position.z, direct: 'beam' });
        const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
        this.onPlayerHit(dealt, killed, e, false, false);
        if (dealt > 0) this.h.crit = Math.min(1, this.h.crit + (dealt * SPRAY_CRIT) / ultCharge(st, NUKE_CHARGE_DMG));
      }
    }
    for (const [e, t] of this.rads) {
      const left = t - dt;
      if (left <= 0 || !e.alive) {
        this.rads.delete(e);
        continue;
      }
      this.rads.set(e, left);
      if (glow) {
        _q.set(e.position.x + (Math.random() - 0.5) * e.radius, e.position.y + e.radius * 1.3, e.position.z + (Math.random() - 0.5) * e.radius);
        ctx.fx.burst(_q, { color: 0x7dff4a, count: 1, speed: 0.8, size: 0.16, gravity: -3, life: 0.5 });
      }
    }
    const st = this.b.stats;
    const queued = this.chainQueue.splice(0, this.chainQueue.length);
    for (const c of queued) {
      _q.set(c.x, c.y + 0.6, c.z);
      ctx.fx.ring(_q, CHAIN_RADIUS, 0x7dff4a);
      ctx.fx.burst(_q, { color: 0x9dff5a, count: 22, speed: 9, size: 0.26, gravity: 2, life: 0.55 });
      this.b.audio.play('thud', { volume: 0.5, pitch: 1.3 });
      if (st.chainBlast <= 0) continue;
      const hits = this.b.enemies.query(c.x, c.z, CHAIN_RADIUS, this.buf);
      for (let i = 0; i < hits.length; i++) this.radHit(hits[i], st.chainBlast);
    }
  }

  clear(): void {
    this.meltCharge = 1;
    this.rads.clear();
    this.chainQueue.length = 0;
    this.poolHitAt.clear();
    for (const pl of this.pools) {
      pl.t = 0;
      pl.disc.hide();
    }
    this.trailT = 0;
    this.sprayOn = false;
    this.trailDosed.clear();
    for (const pd of this.puddles) {
      pd.t = 0;
      pd.disc.hide();
    }
  }
}
