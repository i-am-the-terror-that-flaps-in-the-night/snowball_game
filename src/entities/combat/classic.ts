import * as THREE from 'three';
import { FlameCone } from '../../fx/FlameCone';
import type { EnemyHandle, PlayerStats, PlowAPI } from '../../core/types';
import { FX } from '../../config/upgrades';
import { settings } from '../../core/settings';
import { Kit, Reach, WAVE_BAND, _fwd, _p, _q, _tip, castOrigin, floorTop, waveFloor, type CastOrigin, type CombatHost } from './shared';
import { GroundDisc } from './groundDisc';
import { ultMeter } from './ultimates';
import { CHUNK_BIG, CHUNK_MAX, addChunks, cashIn } from './classicRush';
import { Shockwaves } from './arsenalFx';
import { FINISHER_KNOCK, FINISHER_RADIUS, STREAK_COLORS, STREAK_CSS, STREAK_DEEP, STREAK_MAX, STREAK_REFUND, StreakHit, StreakState, streakDamage } from './classicStreak';

/* Constant FX options for per-frame / per-hit paths (hoisted so they are not rebuilt per call; never mutated). */
const UPDATE_FLAME_BURST = { color: 0xfff2b0, count: 2, speed: 9, size: 0.06, gravity: 8, life: 0.45 };
const UPDATE_FLAME_BURST_2 = { color: 0x2c2628, count: 2, speed: 1.5, size: 0.7, gravity: -3, life: 1.1 };
const UPDATE_BURNS_BURST = { color: 0x2c2628, count: 1, speed: 1, size: 0.6, gravity: -2.5, life: 1 };
/** STREAK: a new stack's pop at the target (sparks + chunks per stack colour), ON STREAK's blade embers / smoke, the
 *  fizzle when it drops, and the SHOCKWAVE FINISHER's ice shards, chunks, embers and powder. */
const STREAK_POP_SPARKS = STREAK_COLORS.map((color) => ({ color, count: 22, speed: 12, spread: 1, size: 0.1, length: 0.04, gravity: 16, life: 0.45 }));
const STREAK_POP_BURST = STREAK_COLORS.map((color) => ({ color, count: 12, speed: 6, size: 0.24, gravity: 14, life: 0.6 }));
const STREAK_EMBER = { color: 0xff5a10, count: 2, speed: 2.5, size: 0.28, gravity: -7, life: 0.45 };
const STREAK_EMBER_2 = { color: 0xffd040, count: 2, speed: 5, size: 0.08, gravity: -9, life: 0.35 };
const STREAK_TRAIL = { color: 0xff7a20, count: 2, speed: 7, spread: 0.35, size: 0.09, length: 0.05, gravity: 4, life: 0.4 };
const STREAK_SMOKE = { color: 0x2c2628, count: 1, speed: 0.8, size: 0.5, gravity: -3, life: 0.8 };
const FIZZLE_SMOKE = { count: 10, color: 0x8a9099, size: 0.55, grow: 2.6, life: 0.75, speed: 2.6, up: 1.3, rise: 0.5, drag: 2.6, spread: 1.1, opacity: 0.75 };
const FIZZLE_BURST = { color: 0x5f646c, count: 14, speed: 4, size: 0.15, gravity: 10, life: 0.5 };
const FINISH_SHARDS = { color: 0x8fdcff, count: 70, speed: 22, spread: 1, size: 0.13, length: 0.05, gravity: 16, life: 0.75 };
const FINISH_CHUNKS = { color: 0xe6f6ff, count: 34, speed: 15, size: 0.38, gravity: 20, life: 1.05 };
const FINISH_CHUNKS_2 = { color: 0x5cc4ff, count: 26, speed: 11, size: 0.26, gravity: 16, life: 0.95 };
const FINISH_EMBERS = { color: 0xff5a10, count: 40, speed: 13, size: 0.3, gravity: -5, life: 0.65 };
const FINISH_RIM = { color: 0xbfeaff, count: 4, speed: 7, size: 0.3, gravity: 18, life: 0.75 };
const FINISH_POWDER = { size: 2.6, color: 0xd6e3f3 };
/** The finisher's ground waves rise at most this far (m) above the slam point's floor onto the snow round it. */
const FINISH_LIFT = 1.2;
/** The finisher's ground shockwaves: hot red-orange band, gold hot line. */
const FINISH_PALETTE = { band: 0xe0300a, hot: 0xffd27a, wall: 0xff6a1a, tint: 0xff8a2a };
/** ON STREAK: seconds between blade embers and (on average) between the crackling arcs round the hull. */
const STREAK_EMBER_EVERY = 0.03;
const STREAK_ARC_EVERY = 0.07;
const STREAK_ARC = { life: 0.1, width: 0.18, jag: 0.5, color: 0xff7a20 };
const STREAK_ARC_2 = { life: 0.1, width: 0.14, jag: 0.5, color: 0xffd040 };
/** slamMods results (reused: read right away, never kept). */
const NO_MODS = { damage: 1, zone: 1, knock: 1 };
const STREAK_MODS = { damage: 1, zone: 1, knock: 1 };

/** Knockback scratch for per-tick damage (Enemies.damage reads it immediately and never keeps it). */
const _kb = new THREE.Vector3();
/** ON STREAK spark direction (back off the blade). */
const _back = new THREE.Vector3();

/** Inferno (F): flame duration, cone half-angle (cos), seconds between ignite checks, burn length + tick. */
const FLAME_SECONDS = 1.4;
const FLAME_HALF = 0.7;
const FLAME_COS = Math.cos(FLAME_HALF);
/** Direct damage while standing in the cone, as a fraction of burn dps (on top of the burn). */
const FLAME_CONTACT = 1.0;
/** Burning bots take this much extra damage from every source the player deals. */
export const BURN_VULN = 1.2;
const FLAME_IGNITE_EVERY = 0.12;
const BURN_SECONDS = 4;
const BURN_TICK = 0.5;
/** Inferno finisher: when the flames run out, the cone bursts in a fireball at its far half — radius (m), damage as a
 *  multiple of burn dps (x your damage mult), knockback (m/s). */
const FIREBALL_RADIUS = 4.5;
const FIREBALL_MULT = 1.6;
const FIREBALL_KNOCK = 12;
/** FIRESTORM (Classic Plow's ultimate): fire damage you deal fills the 🔥 meter (this much on a fresh plow, see
 *  ultCharge); then F unleashes a 360° fire nova — FIRESTORM_MULT x storm dps across FIRESTORM_RADIUS (falling off
 *  to 50% at the rim), big knockback — and leaves the ground burning for FIRE_FIELD_SECONDS, igniting anything that
 *  walks in. Storm dps grows with the pilot's ultimate power (stormDps), like the other ultimates, rather than
 *  with Inferno's steeper burn curve. */
const FIRESTORM_CHARGE = 870;
const FIRESTORM_RADIUS = 13;
const FIRESTORM_MULT = 3;
const FIRESTORM_KNOCK = 18;
const FIRE_FIELD_SECONDS = 3;
const FIRE_FIELD_RADIUS = 10;
const FIRE_FIELD_TICK = 0.3;
/** Fire-field contact damage per second, as a share of storm dps (on top of the burn it keeps lit). */
const FIRE_FIELD_DPS = 0.35;


/** FIRESTORM damage per second before the damage multiplier: fresh burn dps x the Inferno part of ultPower. */
const stormDps = (st: PlayerStats) => FX.flameDps(0) * Math.max(1, (st.ultPower || 1) / (st.damageMult || 1));

/** Classic Plow: Inferno flame cone + fireball finisher, burns, and the FIRESTORM with its burning ground. */
export class ClassicKit extends Kit {
  /** Inferno recharge, flame time left (snapshot field) and the ignite timer. */
  flameCharge = 1;
  flameT = 0;
  private flameIgniteT = 0;
  /** Burning bots. `storm`: lit by the FIRESTORM (burns at storm dps and doesn't refill the meter). */
  readonly burns = new Map<EnemyHandle, { t: number; tickT: number; storm: boolean }>();
  /** FIRESTORM burning ground: disc mesh (draped over the floor), time left, centre, cast floor, tick timer. */
  private fireField!: GroundDisc;
  private fireFieldMat!: THREE.MeshBasicMaterial;
  private fireFieldT = 0;
  private fireFieldX = 0;
  private fireFieldZ = 0;
  /** The floor the FIRESTORM was cast on: the burning ground judges height from it (not from the plow's live height). */
  private readonly fireFrom: CastOrigin = { y: 0, deck: -1 };
  private fireFieldTickT = 0;
  readonly flameCone: FlameCone;
  /** SNOW CHUNKS packed by tap BALL SLAM hits (0..CHUNK_MAX); a PLOW RUSH slam spends them all. */
  chunks = 0;
  /** STREAK (combat/classicStreak.ts): stacks, window, the previous slam's targets. */
  readonly streak = new StreakState();
  /** The SHOCKWAVE FINISHER's ground waves (built with the fire field). */
  private shock!: Shockwaves;
  private emberT = 0;
  private arcT = 0;

  constructor(h: CombatHost) {
    super(h);
    this.flameCone = new FlameCone(h.ctx.scene);
  }

  /** The FIRESTORM ground disc (built after the other combat meshes, keeping the scene order). */
  buildField(): void {
    this.fireFieldMat = new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.fireField = new GroundDisc(this.ctx.scene, this.fireFieldMat);
    this.shock = new Shockwaves(this.ctx.scene, 3, FINISH_PALETTE);
  }

  /* ------------------------------------------------------------------ STREAK */

  /** STREAK is the Classic's (not a vehicle on the snowball kit), and off in the online Duel (its balance is kept). */
  get streakLive(): boolean {
    return this.b.stats.plowKind === 'classic' && !this.b.pvp;
  }

  /** The next slam is the SHOCKWAVE FINISHER (ON STREAK). */
  get finisherArmed(): boolean {
    return this.streakLive && this.streak.onStreak;
  }

  /** Slam multipliers from the streak for a slam about to go off (damage, zone, knockback; read right away). */
  slamMods(finisher: boolean): { readonly damage: number; readonly zone: number; readonly knock: number } {
    if (!this.streakLive) return NO_MODS;
    STREAK_MODS.damage = streakDamage(this.streak.stacks, finisher);
    STREAK_MODS.zone = finisher ? FINISHER_RADIUS : 1;
    STREAK_MODS.knock = finisher ? FINISHER_KNOCK : 1;
    return STREAK_MODS;
  }

  /** A slam (tap or rush end) landed on the first `n` of `hits` at (x, z) with zone radius `zone`: stack the streak
   *  (meter refund, ring pop + STREAK xN at the new target) or, `finisher`, play the SHOCKWAVE FINISHER. */
  landStreak(hits: readonly EnemyHandle[], n: number, x: number, z: number, zone: number, finisher: boolean): void {
    if (!this.streakLive) return;
    const res = this.streak.land(hits, n, finisher);
    if (res === StreakHit.Finish) this.finisherFx(x, z, zone);
    else if (res === StreakHit.Stack) this.stackFx(hits, n);
  }

  /** A new stack: refund part of the dash / rush meter, then a ring pop at a target and a STREAK xN pop. */
  private stackFx(hits: readonly EnemyHandle[], n: number): void {
    const plow = this.b.plow;
    const ctx = this.ctx;
    const k = this.streak.stacks;
    // The Plow keeps its dash meter private: refund it through a narrow duck-typed view (the sim's plow has none).
    const p = plow as unknown as { dashCharge?: number };
    if (typeof p.dashCharge === 'number') p.dashCharge = Math.min(1, p.dashCharge + STREAK_REFUND);
    // The pop goes on the first target still standing (else the first one hit).
    let e = hits[0];
    for (let i = 0; i < n; i++) {
      if (hits[i].alive) {
        e = hits[i];
        break;
      }
    }
    const c = STREAK_COLORS[k - 1];
    const ground = floorTop(ctx.terrain, this.b.snow, plow.position.y, e.position.x, e.position.z);
    _q.set(e.position.x, ground, e.position.z);
    ctx.fx.ring(_q, 1.6 + 0.5 * k, STREAK_DEEP[k - 1]);
    ctx.fx.ring(_q, 2.4 + 0.7 * k, c);
    _q.y = ground + 1.2;
    ctx.fx.sparks(_q, null, STREAK_POP_SPARKS[k - 1]);
    ctx.fx.burst(_q, STREAK_POP_BURST[k - 1]);
    const on = k >= STREAK_MAX;
    // The count is the pilot's own read-out (a Brawl rival's ring pop shows, its text doesn't).
    if (this.b.local) {
      _q.set(e.position.x, e.position.y + e.radius + 2.4, e.position.z);
      ctx.fx.floatText(_q, on ? `STREAK x${k} · ON STREAK!` : `STREAK x${k}`, STREAK_CSS[k - 1], 1.15 + 0.15 * k);
    }
    this.b.audio.play('charge', { volume: 0.45 + 0.1 * k, pitch: 1.2 + 0.25 * k });
    if (on) {
      this.b.audio.play('burst', { volume: 0.7, pitch: 1.4 });
      this.shake(0.25);
    }
  }

  /** The SHOCKWAVE FINISHER at (x, z): a huge hot ground wave + flash, ice shards and chunks flung out, a big punch. */
  private finisherFx(x: number, z: number, zone: number): void {
    const ctx = this.ctx;
    const plow = this.b.plow;
    const fx = ctx.fx;
    // The flat waves sit on the highest snow round the zone (the slam point is often a plowed trough or a dip: at its
    // own height the banks round it swallowed most of the wave), at most FINISH_LIFT m up.
    const floor = floorTop(ctx.terrain, this.b.snow, plow.position.y, x, z);
    let ground = floor;
    const snow = ctx.snow;
    if (snow) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const h = snow.topAt(x + Math.sin(a) * zone * 0.9, z + Math.cos(a) * zone * 0.9);
        if (Number.isFinite(h) && h > ground) ground = Math.min(floor + FINISH_LIFT, h);
      }
    }
    this.shock.reduceFlash = settings.reduceFlash;
    this.shock.spawn(x, ground, z, zone * 1.75, { dur: 0.9, flashR: 4.2, flashY: 1.3, wallH: 3.6 });
    this.shock.spawn(x, ground, z, zone, { dur: 0.5, wallH: 2 });
    _q.set(x, ground, z);
    fx.ring(_q, zone, 0xff4a12);
    fx.ring(_q, zone * 1.18, 0xffc21a);
    fx.ring(_q, zone * 0.55, 0xffffff);
    _q.y = ground + 1;
    fx.sparks(_q, null, FINISH_SHARDS);
    fx.burst(_q, FINISH_CHUNKS);
    fx.burst(_q, FINISH_CHUNKS_2);
    fx.burst(_q, FINISH_EMBERS);
    _q.y = ground;
    fx.powder(_q, FINISH_POWDER);
    // Ice kicked up all round the rim.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      _q.set(x + Math.sin(a) * zone, ground + 0.4, z + Math.cos(a) * zone);
      fx.burst(_q, FINISH_RIM);
    }
    _q.set(x, ground + 1, z);
    this.impactHit('finisher', _q, 1.4);
    this.shake(1.1);
    this.b.audio.play('explosion', { volume: 0.85, pitch: 1.15 });
    this.b.audio.play('strike', { volume: 0.9 });
    this.b.audio.play('freeze', { volume: 0.7, pitch: 0.7 });
    _q.set(x, ground + 5, z);
    fx.floatText(_q, 'SHOCKWAVE!', '#ff4a12', 2.1);
  }

  /** STREAK every frame: the window (a grey fizzle when the stacks drop), ON STREAK's blade embers + crackling arcs
   *  round the hull, the finisher's waves. */
  updateStreak(dt: number): void {
    this.shock.update(dt);
    const plow = this.b.plow;
    if (!this.streakLive || !plow || plow.dead) {
      this.streak.clear();
      return;
    }
    if (this.streak.update(dt) > 0) this.fizzle(plow);
    if (!this.streak.onStreak || this.puppet) return;
    const ctx = this.ctx;
    plow.getForward(_fwd);
    plow.getBladeTip(_tip);
    const w = (this.b.stats.bladeWidth || 2.6) * 0.5;
    this.emberT -= dt;
    while (this.emberT <= 0) {
      this.emberT += STREAK_EMBER_EVERY;
      // Half off the blade, half licking up the flanks (the blade hides behind the cab from the chase camera).
      const blade = Math.random() < 0.5;
      const side = blade ? (Math.random() * 2 - 1) * w : (Math.random() < 0.5 ? -1.25 : 1.25);
      const back = blade ? 0 : 1.5 + Math.random() * 3.5;
      _p.set(_tip.x + _fwd.z * side - _fwd.x * back, _tip.y + 0.3 + Math.random() * 1.3, _tip.z - _fwd.x * side - _fwd.z * back);
      ctx.fx.burst(_p, Math.random() < 0.6 ? STREAK_EMBER : STREAK_EMBER_2);
      // Hot sparks streaming back off the blade (a flame trail behind the charge).
      ctx.fx.sparks(_p, _back.set(-_fwd.x, 0.25, -_fwd.z), STREAK_TRAIL);
      if (Math.random() < 0.12) ctx.fx.burst(_p, STREAK_SMOKE);
    }
    this.arcT -= dt;
    if (this.arcT <= 0) {
      this.arcT = STREAK_ARC_EVERY * (0.6 + Math.random() * 0.8);
      const a = Math.random() * Math.PI * 2;
      const b = a + 0.6 + Math.random() * 1.2;
      const y0 = plow.position.y;
      _p.set(plow.position.x + Math.sin(a) * 2.3, y0 + 0.4 + Math.random() * 1.8, plow.position.z + Math.cos(a) * 2.3);
      _q.set(plow.position.x + Math.sin(b) * 2.3, y0 + 0.4 + Math.random() * 1.8, plow.position.z + Math.cos(b) * 2.3);
      this.lightning.bolt(_p, _q, Math.random() < 0.5 ? STREAK_ARC : STREAK_ARC_2);
    }
  }

  /** The streak ran out: a quick grey puff off the hull and a small 'streak lost'. */
  private fizzle(plow: PlowAPI): void {
    const ctx = this.ctx;
    _p.set(plow.position.x, plow.position.y + 1.6, plow.position.z);
    ctx.fx.smoke(_p, FIZZLE_SMOKE);
    ctx.fx.burst(_p, FIZZLE_BURST);
    if (this.b.local) {
      _p.y += 2;
      ctx.fx.floatText(_p, 'streak lost', '#9aa0a8', 0.8);
    }
    this.b.audio.play('error', { volume: 0.25, pitch: 0.7 });
  }

  /** Inferno (F, pilot perk): a 1s cone of fire from the blade that ignites bots and melts snow. */
  updateFlame(dt: number): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const plow = this.b.plow;
    if (st.plowKind !== 'classic' || st.flameDps <= 0 || !plow) {
      if (this.flameT > 0 || st.plowKind !== 'classic') this.flameCone.hide();
      this.flameT = 0;
      return;
    }
    if (this.flameT <= 0 && this.flameCharge < 1) this.flameCharge = Math.min(1, this.flameCharge + (st.flameCooldown > 0 ? dt / st.flameCooldown : 1));
    if (this.b.input.wasPressed('KeyF') && !plow.dead) {
      if (this.h.crit >= 1) this.firestorm(plow);
      else if (this.flameCharge >= 1 && this.flameT <= 0) {
        this.flameCharge = 0;
        this.flameT = FLAME_SECONDS;
        this.b.events.emit('ability', { nuke: false });
        this.flameIgniteT = 0;
        this.b.audio.play('dash', { pitch: 0.55, volume: 0.9 });
        this.b.audio.play('burst', { pitch: 0.6 });
      } else if (this.flameT <= 0) this.b.audio.play('error');
    }
    const range = st.flameRange;
    plow.getForward(_fwd);
    plow.getBladeTip(_tip);
    const flaming = this.flameT > 0 && !plow.dead;
    this.flameCone.update(dt, flaming, _tip, plow.heading, range, FLAME_HALF);
    if (this.flameT <= 0) return;
    this.flameT -= dt;
    if (plow.dead) {
      this.flameT = 0;
      return;
    }
    if (this.flameT <= 0) this.fireball(plow);
    const fx = ctx.fx;
    // Embers, sparks and smoke on top of the shader cone, plus melted snow underneath.
    for (let i = 0; i < 4; i++) {
      const k = 0.25 + Math.random() * 0.85;
      const side = (Math.random() - 0.5) * 2 * k * range * Math.tan(FLAME_HALF) * 0.8;
      _p.set(_tip.x + _fwd.x * k * range + _fwd.z * side, _tip.y + 0.7 + Math.random() * 1.1, _tip.z + _fwd.z * k * range - _fwd.x * side);
      fx.burst(_p, { color: Math.random() < 0.6 ? 0xff5a10 : 0xffd040, count: 3, speed: 3, size: 0.3 + k * 0.3, gravity: -7, life: 0.4 });
    }
    _p.set(_tip.x + _fwd.x * range * 0.3, _tip.y + 1, _tip.z + _fwd.z * range * 0.3);
    fx.burst(_p, UPDATE_FLAME_BURST);
    if (Math.random() < 0.45) {
      _p.set(_tip.x + _fwd.x * range * 0.9, _tip.y + 2.2, _tip.z + _fwd.z * range * 0.9);
      fx.burst(_p, UPDATE_FLAME_BURST_2);
    }
    if (Math.random() < dt * 10) this.shake(0.06);
    if (this.b.snow) {
      this.b.snow.melt(_tip.x + _fwd.x * range * 0.35, _tip.z + _fwd.z * range * 0.35, range * 0.3, 0.8 * dt);
      this.b.snow.melt(_tip.x + _fwd.x * range * 0.75, _tip.z + _fwd.z * range * 0.75, range * 0.4, 0.8 * dt);
    }
    // Ignite everything inside the cone.
    this.flameIgniteT -= dt;
    if (this.flameIgniteT > 0) return;
    this.flameIgniteT = FLAME_IGNITE_EVERY;
    this.smashProps(_tip.x + _fwd.x * range * 0.55, _tip.z + _fwd.z * range * 0.55, range * 0.35);
    const hits = this.collect(_tip.x + _fwd.x * range * 0.5, _tip.z + _fwd.z * range * 0.5, range * 0.5 + 1, Reach.Body);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      const dx = e.position.x - _tip.x;
      const dz = e.position.z - _tip.z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.radius || (d > e.radius && (dx * _fwd.x + dz * _fwd.z) / d < FLAME_COS)) continue;
      this.ignite(e, false);
      // Scorch: direct damage + a shove away from the blade while caught in the cone.
      const nd = d || 1;
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, st.flameDps * st.damageMult * FLAME_CONTACT * FLAME_IGNITE_EVERY * BURN_VULN * this.lastStandMult(), {
        source: 'other',
        knockback: _kb.set((dx / nd) * 3, 0, (dz / nd) * 3),
        fromX: e.position.x,
        fromZ: e.position.z,
      });
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      this.feedFire(dealt);
      this.onPlayerHit(dealt, killed, e, false);
    }
    this.clearTargets();
  }

  /** SNOW CHUNKS from a Classic tap BALL SLAM that hit `hits` bots / opponents: one each, up to CHUNK_MAX (float
   *  text over the plow). Returns the chunks now held. */
  packChunks(hits: number): number {
    const plow = this.b.plow;
    if (hits <= 0 || !plow) return this.chunks;
    const was = this.chunks;
    this.chunks = addChunks(this.chunks, hits);
    if (this.chunks !== was && this.b.local) {
      _q.set(plow.position.x, plow.position.y + 3.4, plow.position.z);
      this.ctx.fx.floatText(_q, this.chunks >= CHUNK_MAX ? '❄ 10 · FULL' : `❄ ${this.chunks}`, '#bfeaff', this.chunks >= CHUNK_MAX ? 1 : 0.75);
    }
    return this.chunks;
  }

  /** PLOW RUSH cash-in: the multipliers for the chunks held (then they reset to 0). Big float text from CHUNK_BIG. */
  takeChunks(x: number, z: number): { radius: number; damage: number; n: number } {
    const n = this.chunks;
    this.chunks = 0;
    const m = cashIn(n);
    if (n >= CHUNK_BIG) {
      const plow = this.b.plow;
      _q.set(x, (plow?.surfaceY || 0) + 4, z);
      this.ctx.fx.floatText(_q, `❄×${n} AVALANCHE!`, n >= CHUNK_MAX ? '#ffffff' : '#bfeaff', 1.2 + 0.05 * n);
      this.b.audio.play('freeze', { volume: 0.7, pitch: 0.8 });
    }
    return { radius: m.radius, damage: m.damage, n };
  }

  /** Fire damage fills the Classic Plow's FIRESTORM meter (shares ISOTOPE's Critical Mass slot + net field). */
  feedFire(dealt: number): void {
    if (dealt <= 0 || this.b.stats.plowKind !== 'classic') return;
    const was = this.h.crit;
    this.h.crit = Math.min(1, this.h.crit + dealt / ultMeter(this.b, FIRESTORM_CHARGE));
    if (was < 1 && this.h.crit >= 1 && this.b.local) {
      this.ctx.ui.toast('🔥 FIRESTORM READY · F', 'info');
      this.b.audio.play('charge', { pitch: 0.7, volume: 0.6 });
    }
  }

  /** Ignite `e` (or refresh its burn). */
  private ignite(e: EnemyHandle, storm: boolean): void {
    if (!e.alive) return;
    const b = this.burns.get(e);
    if (b) {
      b.t = BURN_SECONDS;
      b.storm = storm;
    } else this.burns.set(e, { t: BURN_SECONDS, tickT: 0.1, storm });
  }

  /** One fire blast: damage with falloff, knockback out from (x, z), ignite. `feed`: counts toward the FIRESTORM
   *  meter (the FIRESTORM's own blast doesn't, so it can't chain). Returns the bots hit. */
  private fireBlast(x: number, z: number, R: number, dmg: number, knock: number, rim: number, text: string, feed: boolean): number {
    this.smashProps(x, z, R);
    const hits = this.collect(x, z, R, Reach.Wave);
    let n = 0;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      const dx = e.position.x - x;
      const dz = e.position.z - z;
      const d = Math.hypot(dx, dz);
      const nd = d || 1;
      const fall = 1 - (1 - rim) * Math.min(1, d / R);
      this.ignite(e, !feed);
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, dmg * fall * this.b.stats.damageMult * this.hitMult(e), {
        source: 'other',
        knockback: _kb.set((dx / nd) * knock, 0, (dz / nd) * knock),
        fromX: x,
        fromZ: z,
        ult: !feed,
        area: true,
      });
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      if (feed) this.feedFire(dealt);
      this.onPlayerHit(dealt, killed, e, false);
      if (dealt > 0) {
        _tip.set(e.position.x, e.position.y + e.radius + 1.3, e.position.z);
        this.ctx.fx.floatText(_tip, `${text}${Math.round(dealt)}`, '#ffb040', 1.1);
      }
      n++;
    }
    this.clearTargets();
    return n;
  }

  /** Inferno finisher: the cone's far half bursts in a fireball as the flames run out. */
  private fireball(plow: PlowAPI): void {
    const st = this.b.stats;
    const ctx = this.ctx;
    plow.getForward(_fwd);
    plow.getBladeTip(_tip);
    const k = st.flameRange * 0.6;
    const x = _tip.x + _fwd.x * k;
    const z = _tip.z + _fwd.z * k;
    // Bursts start on the floor under the fireball (the plow's level; 0 on flat arenas).
    const top = waveFloor(ctx.terrain, plow.position.y, x, z);
    _q.set(x, top + 1.2, z);
    ctx.fx.burst(_q, { color: 0xff6a10, count: 36, speed: 12, size: 0.42, gravity: -3, life: 0.6 });
    ctx.fx.burst(_q, { color: 0xffe070, count: 18, speed: 7, size: 0.3, gravity: -6, life: 0.5 });
    ctx.fx.burst(_q, { color: 0x2c2628, count: 10, speed: 3, size: 0.9, gravity: -2.5, life: 1.2 });
    _q.set(x, top + 0.15, z);
    ctx.fx.ring(_q, FIREBALL_RADIUS, 0xff8a20);
    ctx.fx.ring(_q, FIREBALL_RADIUS * 0.55, 0xffe070);
    this.shake(0.45);
    this.impactHit('meltdown', _q.set(x, top + 1, z), 0.7);
    this.b.audio.play('explosion', { volume: 0.7, pitch: 0.85 });
    this.b.snow?.melt(x, z, FIREBALL_RADIUS * 0.8, 1);
    this.fireBlast(x, z, FIREBALL_RADIUS, st.flameDps * FIREBALL_MULT, FIREBALL_KNOCK, 0.6, '💥', true);
  }

  /** FIRESTORM: meter full + F — a 360° fire nova around the plow, then burning ground. */
  private firestorm(plow: PlowAPI): void {
    const st = this.b.stats;
    const ctx = this.ctx;
    this.h.crit = 0;
    this.b.events.emit('ability', { nuke: true });
    const x = plow.position.x;
    const z = plow.position.z;
    ctx.ui.toast(this.b.local ? '🔥 FIRESTORM!' : '🔥 INCOMING FIRESTORM!', 'big');
    // Everything starts on the floor the storm is cast on (the surface under the plow; 0 on flat arenas).
    const from = castOrigin(plow, this.fireFrom);
    const top = from.y;
    _q.set(x, top + 0.15, z);
    for (const [r, c] of [[0.35, 0xfff0a0], [0.65, 0xffb040], [1, 0xff5a10], [1.12, 0x8a1a00]] as const) ctx.fx.ring(_q, FIRESTORM_RADIUS * r, c);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      for (const k of [0.35, 0.7, 1]) {
        _q.set(x + Math.sin(a) * FIRESTORM_RADIUS * k, top + 0.8, z + Math.cos(a) * FIRESTORM_RADIUS * k);
        ctx.fx.burst(_q, { color: Math.random() < 0.6 ? 0xff5a10 : 0xffd040, count: 4, speed: 5, size: 0.45, gravity: -6, life: 0.7 });
      }
    }
    _q.set(x, top + 2.5, z);
    ctx.fx.burst(_q, { color: 0xffe070, count: 60, speed: 16, size: 0.35, gravity: -2, life: 0.8 });
    ctx.fx.burst(_q, { color: 0x2c2628, count: 24, speed: 5, size: 1.2, gravity: -2.5, life: 1.6 });
    this.shake(1);
    this.impactHit('nuke', _q.set(x, top + 1, z));
    this.b.audio.play('explosion', { volume: 1, pitch: 0.6 });
    this.b.audio.play('roar', { volume: 0.7, pitch: 1.3 });
    this.b.snow?.melt(x, z, FIRE_FIELD_RADIUS, 1);
    this.fireBlast(x, z, FIRESTORM_RADIUS, stormDps(st) * FIRESTORM_MULT, FIRESTORM_KNOCK, 0.5, '🔥', false);
    this.fireFieldT = FIRE_FIELD_SECONDS;
    this.fireFieldX = x;
    this.fireFieldZ = z;
    this.fireFieldTickT = 0;
    this.fireField.place(ctx.terrain, x, z, FIRE_FIELD_RADIUS, from.y, from.deck, 0.07, this.b.snow);
  }

  /** FIRESTORM burning ground: flickers, keeps everything inside alight, small contact damage. */
  updateFireField(dt: number): void {
    if (this.fireFieldT <= 0) return;
    this.fireFieldT -= dt;
    if (this.fireFieldT <= 0) {
      this.fireField.hide();
      return;
    }
    const ctx = this.ctx;
    const fade = Math.min(1, this.fireFieldT / 0.8, (FIRE_FIELD_SECONDS - this.fireFieldT) / 0.2 + 0.3);
    this.fireFieldMat.opacity = (0.3 + 0.1 * Math.sin(ctx.time * 11) + 0.05 * Math.random()) * fade;
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * FIRE_FIELD_RADIUS;
      const ex = this.fireFieldX + Math.sin(a) * rr;
      const ez = this.fireFieldZ + Math.cos(a) * rr;
      const ey = waveFloor(ctx.terrain, this.fireFrom.y, ex, ez);
      // Past a deck edge (floor far below the cast level) the field doesn't burn: no embers there either.
      if (Math.abs(ey - this.fireFrom.y) > 2 * WAVE_BAND) continue;
      _q.set(ex, ey + 0.4, ez);
      ctx.fx.burst(_q, { color: Math.random() < 0.6 ? 0xff5a10 : 0xffd040, count: 2, speed: 2, size: 0.35, gravity: -7, life: 0.5 });
    }
    this.fireFieldTickT -= dt;
    if (this.fireFieldTickT > 0) return;
    this.fireFieldTickT = FIRE_FIELD_TICK;
    const st = this.b.stats;
    // Height rule from the cast floor: the ground keeps burning whatever the plow does (flies off a ramp...).
    const hits = this.collect(this.fireFieldX, this.fireFieldZ, FIRE_FIELD_RADIUS, Reach.Wave, this.fireFrom);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      this.ignite(e, true);
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, stormDps(st) * FIRE_FIELD_DPS * FIRE_FIELD_TICK * st.damageMult * this.hitMult(e), { source: 'other', fromX: e.position.x, fromZ: e.position.z, ult: true });
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      this.onPlayerHit(dealt, killed, e, false);
    }
    this.clearTargets();
  }

  /** Burn damage over time from Inferno, credited to the player (lifesteal / adrenaline apply). */
  updateBurns(dt: number): void {
    if (this.burns.size === 0) return;
    const ctx = this.ctx;
    const st = this.b.stats;
    const dps = st.flameDps;
    const storm = stormDps(st);
    for (const [e, b] of this.burns) {
      if (!e.alive || dps <= 0) {
        this.burns.delete(e);
        continue;
      }
      b.t -= dt;
      b.tickT -= dt;
      // Burning bots are wrapped in flames + trailing smoke.
      if (Math.random() < dt * 30) {
        _p.set(e.position.x + (Math.random() - 0.5) * e.radius * 1.4, e.position.y + 0.6 + Math.random() * e.radius * 1.2, e.position.z + (Math.random() - 0.5) * e.radius * 1.4);
        ctx.fx.burst(_p, { color: Math.random() < 0.55 ? 0xff5a10 : 0xffd040, count: 3, speed: 2, size: 0.32, gravity: -7, life: 0.45 });
      }
      if (Math.random() < dt * 6) {
        _p.set(e.position.x, e.position.y + e.radius + 1.2, e.position.z);
        ctx.fx.burst(_p, UPDATE_BURNS_BURST);
      }
      if (b.tickT <= 0) {
        b.tickT = BURN_TICK;
        const hp0 = e.hp;
        const killed = this.b.enemies.damage(e, (b.storm ? storm : dps) * st.damageMult * BURN_TICK * BURN_VULN * this.lastStandMult(), { source: 'other', fromX: e.position.x, fromZ: e.position.z, ult: b.storm });
        const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
        if (!b.storm) this.feedFire(dealt);
        this.onPlayerHit(dealt, killed, e, false);
        if (dealt > 0) {
          _q.set(e.position.x, e.position.y + e.radius + 1, e.position.z);
          ctx.fx.floatText(_q, `🔥${Math.round(dealt)}`, '#ff8a3a', 0.8);
        }
      }
      if (b.t <= 0 || !e.alive) this.burns.delete(e);
    }
  }

  clear(): void {
    this.chunks = 0;
    this.streak.clear();
    this.shock.clear();
    this.flameCone.hide();
    this.flameT = 0;
    this.flameCharge = 1;
    this.burns.clear();
    this.fireFieldT = 0;
    this.fireField.hide();
  }
}
