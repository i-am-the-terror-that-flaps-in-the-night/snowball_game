import * as THREE from 'three';
import type { EnemyHandle } from '../../core/types';
import { settings } from '../../core/settings';
import { SingularityFx } from '../../fx/singularity';
import { MAG_LASER_MAX_RATE } from '../../config/upgrades';
import { ArcWaves, Horizon, LaserFx, Shockwaves, addMat, beamGeometry, paintMat } from './arsenalFx';
import { Kit, type AbilityDesc, type VehicleKit, _fwd, _p, _q, _tip, type CombatHost } from './shared';
import type { UltScript } from './ultimates';

/* Constant FX options for per-frame / per-hit paths (hoisted so they are not rebuilt per call; never mutated). */
const UPDATE_SCRAP_BURST = { color: 0x8fb4c6, count: 1, speed: 0.5, size: 0.12, gravity: -1, life: 0.6 };
const UPDATE_SCRAP_BURST_2 = { color: 0xd8f4ff, count: 3, speed: 4, size: 0.1, gravity: 6, life: 0.2 };
/** Laser impact: a chunky cyan / white spark spray and a flash burst; a blocked bolt's scorch on a prop / the ground. */
const LASER_HIT_SPARKS = { count: 9, color: 0x38e8ff, speed: 11, spread: 0.9, size: 0.08, life: 0.22, gravity: 6 };
const LASER_HIT_BURST = { color: 0xeaffff, count: 5, speed: 5, size: 0.2, gravity: 0, life: 0.14 };
const LASER_BLOCK_SPARKS = { count: 5, color: 0x38e8ff, speed: 7, spread: 0.8, size: 0.06, life: 0.2, gravity: 6 };
const TICK_BURST_SPARKS = { count: 3, color: 0xbff8ff, speed: 14, spread: 0.2, size: 0.05, life: 0.4, gravity: 0, length: 0.08 };

/** Knockback scratch: damage() copies it synchronously and never keeps it. Never written from Combat.hitPlow (the
 *  Duel victim path), so it stays valid across the nested victim hit. */
const _kb = new THREE.Vector3();
const _r = new THREE.Vector3();

/* ARSENAL: a magnetic vehicle (two huge front wheels, a hovering gyro core at the back). Like every plow, it fights
 * up close and aims by steering: both main weapons fire straight off the nose.
 *   SPACE  MAG LASER     held: a rapid fire of fat laser bolts dead straight off the nose emitter, ~12 a second;
 *                        each is hitscan out to the reach, pierces every target on its line (once each) and tugs
 *                        it toward ARSENAL.
 *   E      MAG REPULSOR  a magnetic wave sweeps out across a forward wedge (REP_HALF x 2, laserRange m): one big hit
 *                        on every bot it reaches, flinging it away (bosses barely).
 *   F      POLARITY BURST the gyro folds into a disc, an event horizon expands to BURST_R m, every bot inside is pulled
 *                        to a singularity point ahead for ~1 s, then it detonates (damage, outward knockback).
 *   ULT    SINGULARITY   a black hole opens at the densest cluster within SING_SEEK m, drags every bot within SING_R
 *                        m into it for SING_PULL_T s (small ticks), collapses and explodes.
 *   passive SCRAP MAGNET wreck scrap orbits the vehicle as blades. */

/** Every ARSENAL weapon hits bots this many times harder outside the Duel (the vehicle's duel balance is unchanged). */
export const PVE_MULT = 1.5;
/** SCRAP MAGNET (passive): field tick (s); wrecks within SCRAP_PULL m shed a shard that flies in over SCRAP_FLY s and
 *  orbits SCRAP_ORBIT m out (SCRAP_SPIN rad/s) for SCRAP_LIFE s; a shard hits bots within SCRAP_HIT_R m of it, each
 *  bot at most every SCRAP_HIT_CD s. SCRAP_POOL = the most shards any level holds (FX.scrapMax cap). */
const SCRAP_TICK = 0.5;
export const SCRAP_PULL = 12;
const SCRAP_FLY = 0.55;
export const SCRAP_ORBIT = 3.5;
const SCRAP_SPIN = 2.6;
export const SCRAP_LIFE = 15;
const SCRAP_HIT_R = 0.7;
const SCRAP_HIT_CD = 0.4;
const SCRAP_POOL = 12;
/** STRIP SCRAP: the ring doesn't depend on wrecking cannon fodder. Every SHED_FRAC of a target's max HP that ARSENAL's
 *  weapons tear off (laser, repulsor, burst, singularity) rips a shard off it; bosses shed every SHED_FRAC_BOSS (a boss
 *  fight keeps the ring full). The ring's own shard hits and the field count at SHED_SELF (partial self-feeding: a ring
 *  grinding a boss slowly tops itself up, but it still needs you firing to stay full). Wrecks still shed one. */
const SHED_FRAC = 0.2;
const SHED_FRAC_BOSS = 0.06;
const SHED_SELF = 0.25;
interface Shard { mesh: THREE.Mesh; state: 0 | 1 | 2; t: number; from: THREE.Vector3; slot: number; hitAt: Map<EnemyHandle, number> }

const DEG = Math.PI / 180;
/** MAG LASER (SPACE, held): a rapid fire of FAT laser bolts dead straight off the nose, one every laserInterval s
 *  (1 / gunRate, ~12 a second; Overclock shortens it a little). Each bolt is HITSCAN along the hull's heading (no
 *  homing, no spread) out to the reach (tankGunRange), LASER_W m wide either side (tankBeamRadius, Whirlwind Turbine
 *  widens it); it stops at a prop (which breaks) or the ground, and PIERCES every target on its line in that reach
 *  and inside the height band (LASER_DY round the body), each once per bolt, for gunDamage (a direct 'round' hit)
 *  and a TUG toward ARSENAL (LASER_TUG m/s divided by the bot's mass, bosses LASER_TUG_BOSS x; in the Duel
 *  LASER_DUEL_TUG, scaled by the victim plow's heaviness, knockScale(kind), in Combat.hitPlow).
 *  Sized from the Mag Discs it replaced (10 a second, each hitting a target twice and tugging it once): per bolt the
 *  damage is 2 x the old disc hit x RATE_SPLIT (gunDamage, config/upgrades.ts) and the tug the old disc tug x
 *  RATE_SPLIT (10 / 12), so DPS and pull per second stay the same. */
const RATE_SPLIT = 10 / 12;
const LASER_OVERCLOCK = 0.25;
const LASER_W = 0.8;
const LASER_W_MAX = 1.2;
/** The beam WIDENS with distance (by request: "fat laser pulses ... or a beam that widens", easy to aim): its hit
 *  half-width grows LASER_WIDEN m per metre of reach on top of tankBeamRadius (~0.8 m at the nose, ~2.8 m at 10 m). */
export const LASER_WIDEN = 0.2;
const WHIRL_LASER_W = 0.1;
const LASER_TUG = 3.5 * RATE_SPLIT;
const LASER_TUG_BOSS = 0.2;
const LASER_DUEL_TUG = 3 * RATE_SPLIT;
/** The beam leaves the emitter (high on the turret) and dips to LASER_HIT_Y m over ARSENAL's own footing at the full
 *  reach: it hits targets whose body (+ LASER_DY m slack) spans that height, i.e. on ARSENAL's level (not on a deck
 *  above or a floor below). */
const LASER_HIT_Y = 1;
const LASER_DY = 0.6;
/** Ground check step (m) along the beam. */
const LASER_STEP = 0.5;
/** Bolts on screen at once at most (LASER_LIFE x the fastest rate, with slack). */
const LASER_POOL = 6;
/** Minimum seconds between laser-hit sounds / shakes. */
const LASER_SFX_GAP = 0.09;
/** Nose flash decay (1/s). */
const FLASH_DECAY = 14;
/** A press without held-key reporting keeps the trigger down this long (a few bolts). */
const GUN_BURST = 0.2;
/* The snowball / spin shop lines, re-purposed on ARSENAL so every bought level still does something:
 * Mega Hopper stretches the laser's reach (HOPPER_RANGE m per m of max ball radius over the base 1.2 m),
 * Whirlwind Turbine makes the beam wider (WHIRL_LASER_W m per m of spin radius over 4, LASER_W_MAX at most),
 * Snow Compactor widens the Mag Repulsor's wedge (COMPACT_ARC rad per unit of pack rate over the base 0.12). */
const HOPPER_RANGE = 1.5;
const COMPACT_ARC = 0.6;
/** Mag Laser reach (m) with Mega Hopper. */
export const tankGunRange = (st: { gunRange: number; maxBallRadius: number }): number => st.gunRange + HOPPER_RANGE * Math.max(0, st.maxBallRadius - 1.2);
/** Mag Laser hit half-width (m, added to the target's radius) with Whirlwind Turbine. */
export const tankBeamRadius = (st: { whirlRadius: number }): number => Math.min(LASER_W_MAX, LASER_W + WHIRL_LASER_W * Math.max(0, st.whirlRadius - 4));
/** Mag Repulsor wedge half-angle (rad) with Snow Compactor. */
export const tankRepulseHalf = (st: { collectRate: number }): number => Math.min(REP_HALF_MAX, REP_HALF + COMPACT_ARC * Math.max(0, st.collectRate - 0.12));
/** Seconds between two bolts: 1 / gunRate, x cooldownMult^LASER_OVERCLOCK (Overclock speeds the rate up a little:
 *  -48% cooldowns = 18% more bolts, as the discs had), never faster than MAG_LASER_MAX_RATE a second (the discs' fixed
 *  pool held their late-garage rate to about that: the cap keeps the laser's late single-target DPS where theirs was). */
export const laserInterval = (st: { gunRate: number; cooldownMult: number }): number =>
  1 / Math.min(MAG_LASER_MAX_RATE, Math.max(0.3, st.gunRate) / Math.max(0.4, st.cooldownMult || 1) ** LASER_OVERCLOCK);

/** MAG REPULSOR: a wave sweeps from the nose across ±REP_HALF (REP_HALF_MAX with Snow Compactor) out to laserRange m
 *  over REP_SECONDS; each bot is hit once as the front reaches it: laserDps x REP_DMG_SECONDS (x your damage mult),
 *  falling to REP_FAR of that at full reach (from half reach on), and flung away at REP_KNOCK m/s (bosses REP_BOSS x;
 *  a human in the Duel REP_DUEL_KNOCK, for REP_PVP of the damage). Only bots within REP_DY m of the emitter's height. */
const REP_HALF = 30 * DEG;
const REP_HALF_MAX = 45 * DEG;
const REP_SECONDS = 0.3;
const REP_DMG_SECONDS = 1.5;
const REP_FAR = 0.7;
const REP_KNOCK = 16;
const REP_BOSS = 0.25;
const REP_DUEL_KNOCK = 9;
/** Duel: the wave lands as one big hit (no tick-by-tick diminishing returns like the old lance's), so it hits a
 *  human for this share of its listed damage. */
const REP_PVP = 0.6;
const REP_DY = 3;

/** POLARITY BURST: event horizon BURST_R m round a singularity point BURST_POINT m ahead (fixed where it was cast);
 *  the ring opens over BURST_OPEN s, pulls (BURST_PULL m/s, bosses BURST_BOSS x) until BURST_DET, then detonates
 *  over BURST_DET_R m: missileCount x missileDamage per bot, / (bots caught)^BURST_SPREAD, knockback BURST_KNOCK. */
const BURST_R = 16;
const BURST_POINT = 4;
const BURST_OPEN = 0.3;
const BURST_DET = 1.3;
const BURST_END = 1.75;
const BURST_PULL = 11;
const BURST_BOSS = 0.3;
const BURST_DET_R = 7;
const BURST_KNOCK = 12;
const BURST_SPREAD = 0.7;

/** SINGULARITY (ultimate): opens at the densest bot cluster within SING_SEEK m (bots within SING_CLUSTER m of each
 *  other count together), else SING_AHEAD m ahead. Drags every bot within SING_R m toward it for SING_PULL_T s
 *  (speed accelerating from SING_V0 to SING_V1 m/s, bosses SING_BOSS x), a small tick every SING_TICK s
 *  (SING_TICK_DMG x missile damage); then collapses for SING_COLLAPSE s and explodes: SING_POOL x missile damage per
 *  bot / (bots hit)^SING_SPREAD, full within SING_CORE m, falling to half at SING_R. Over at SING_END s. */
const SING_SEEK = 40;
const SING_CLUSTER = 8;
const SING_AHEAD = 12;
const SING_R = 40;
const SING_PULL_T = 3;
const SING_V0 = 4;
const SING_V1 = 15;
const SING_BOSS = 0.3;
const SING_TICK = 0.25;
const SING_TICK_DMG = 0.25;
const SING_COLLAPSE = 0.2;
const SING_POOL = 46;
const SING_SPREAD = 0.85;
const SING_CORE = 12;
const SING_KNOCK = 18;
const SING_END = 3.6;
/** Visual radius handed to SingularityFx.open (m). */
const SING_VIS_R = 2.6;

const CYAN = 0x38e8ff;
const _a = new THREE.Vector3();

const glowMat = addMat;
/** Normal-blended tint: additive cyan washes out to white over sunlit snow, so the outer glows are painted on. */
const tintMat = paintMat;

/** ARSENAL: Mag Laser, Mag Repulsor, Polarity Burst, the SINGULARITY and the Scrap Magnet (plus the duel guest's view). */
export class ArsenalKit extends Kit implements UltScript, VehicleKit {
  readonly primaryDesc: AbilityDesc = { icon: '🔷', label: 'LASER', hint: 'hold for MAG LASER' };
  readonly secondaryDesc: AbilityDesc = { icon: '🧲', label: 'REPULSE', hint: 'MAG REPULSOR' };
  /** SPACE state handed in by Combat (primary) for updateGuns this frame. */
  private trigHeld = false;
  private trigPressed = false;
  /** Bolt timer, burst window, bolts fired so far (tests / probes). */
  private gunT = 0;
  private gunBurstT = 0;
  boltsFired = 0;
  /** The bolt visuals (a fixed pool, nothing allocated per shot); the nose flash. */
  private laserFx!: LaserFx;
  private flashCore!: THREE.Mesh;
  private flashTint!: THREE.Mesh;
  private flashK = 0;
  /** Per-bolt scratch: targets one bolt crossed (reused). */
  private laserHits: EnemyHandle[] = [];
  /** When the last laser-hit sound / shake played (12 bolts a second land on a target). */
  private lastLaserSfx = -1;
  /** Mag Repulsor time left (s; 0 = idle), where it was cast from, its heading / reach / half-angle, bots already hit. */
  laserT = 0;
  private repAt = new THREE.Vector3();
  private repHeading = 0;
  private repR = 0;
  private repHalf = REP_HALF;
  private repHit = new Set<EnemyHandle>();
  private arcs!: ArcWaves;
  /** Gyro flare at the emitter while the wave runs. */
  private lens!: THREE.Mesh;
  /** Expanding shockwaves (repulsor flash, burst detonation). */
  private shock!: Shockwaves;
  /** Polarity Burst recharge 0..1 (the F slot; the name is the old missile line's, net field NP.fReady). */
  missileCharge = 1;
  /** Polarity Burst: elapsed (-1 idle), singularity point, caught bots, meshes. */
  private burstT = -1;
  private burstAt = new THREE.Vector3();
  private burstY = 0;
  private horizon!: Horizon;
  private streakT = 0;
  private burstStreakT = 0;
  /** Singularity: centre and FX (built by prewarm() at game load or on first use, only with a camera: headless sims
   *  have none). */
  private singAt = new THREE.Vector3();
  private singY = 0;
  private singFx: SingularityFx | null = null;
  private singTickT = 0;
  private singCollapsed = false;
  private singBlown = false;
  /** Is the Mag Laser trigger down this frame (snapshot bit). The repulsor always fires straight ahead (net field NP.laser). */
  gunsOn = false;
  laserOff = 0;
  /** Duel guest: last host snapshot fire bits (diagnostics only; Combat routes them through primary / secondary),
   *  -1 = not a puppet. netTurret: the host's turret yaw (always 0 now: the emitter is fixed; slot kept). */
  netFire = -1;
  netTurret = NaN;

  constructor(h: CombatHost) {
    super(h);
    this.buildArsenalFx(h.ctx.scene);
    const geo = new THREE.TetrahedronGeometry(0.32);
    const mat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.85, roughness: 0.35, emissive: 0x0e3a4a });
    for (let i = 0; i < SCRAP_POOL; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.scale.set(1, 0.6, 1.6);
      h.ctx.scene.add(mesh);
      this.shards.push({ mesh, state: 0, t: 0, from: new THREE.Vector3(), slot: i, hitAt: new Map() });
    }
  }

  /* ---- SCRAP MAGNET (passive) ---- */
  private shards: Shard[] = [];
  private scrapT = 0;
  private scrapFxT = 0;
  private scrapSpin = 0;
  /** STRIP SCRAP: weapon damage dealt to each target since its last shed shard. */
  private shedDmg = new Map<EnemyHandle, number>();
  /** Shards flying in or orbiting (HUD / tests). */
  get scrapCount(): number {
    let n = 0;
    for (const s of this.shards) if (s.state) n++;
    return n;
  }

  /** A bot the player wrecked: if it was within SCRAP_PULL m, its scrap flies in to join the orbit ring (the oldest
   *  shard makes room when the ring is full). */
  scrapFrom(e: EnemyHandle): void {
    this.shedDmg.delete(e);
    this.addShard(e);
  }

  /** STRIP SCRAP: count weapon damage on `e`; every SHED_FRAC (bosses SHED_FRAC_BOSS) of its max HP sheds a shard. */
  private shedScrap(e: EnemyHandle, dealt: number): void {
    if (dealt <= 0 || this.b.stats.scrapMax <= 0 || this.puppet) return;
    if (!e.alive) {
      this.shedDmg.delete(e);
      return;
    }
    const step = Math.max(1, (e.isBoss ? SHED_FRAC_BOSS : SHED_FRAC) * (e.maxHp || 1));
    let acc = (this.shedDmg.get(e) ?? 0) + dealt;
    // At most two per hit (a huge blast on a small bot is a wreck, not a scrap fountain).
    for (let n = 0; acc >= step && n < 2; n++) {
      acc -= step;
      this.addShard(e);
    }
    this.shedDmg.set(e, Math.min(acc, step));
    if (this.shedDmg.size > 96) for (const [k] of this.shedDmg) if (!k.alive) this.shedDmg.delete(k);
  }

  /** One shard torn off `e` flies in to the ring if `e` is within SCRAP_PULL m (the oldest makes room when full). */
  private addShard(e: EnemyHandle): void {
    const st = this.b.stats;
    const plow = this.b.plow;
    if (st.scrapMax <= 0 || !plow || plow.dead) return;
    if (Math.hypot(e.position.x - plow.position.x, e.position.z - plow.position.z) > SCRAP_PULL) return;
    let free: Shard | null = null;
    let live = 0;
    let oldest: Shard | null = null;
    for (const s of this.shards) {
      if (s.slot >= st.scrapMax) continue;
      if (!s.state) free ??= s;
      else {
        live++;
        if (!oldest || s.t > oldest.t) oldest = s;
      }
    }
    const s = free ?? (live >= st.scrapMax ? oldest : null);
    if (!s) return;
    s.state = 1;
    s.t = 0;
    s.hitAt.clear();
    s.from.set(e.position.x, e.position.y + 0.6, e.position.z);
    s.mesh.position.copy(s.from);
    s.mesh.visible = true;
    this.ctx.fx.burst(s.from, { color: 0xb8c2cc, count: 6, speed: 4, size: 0.16, gravity: 6, life: 0.4 });
  }

  /** The field's slow damage, the shards' flight and orbit, their hits and decay. */
  updateScrap(dt: number): void {
    const st = this.b.stats;
    const plow = this.b.plow;
    const on = st.scrapMax > 0 && !!plow && !plow.dead;
    if (!on) {
      for (const s of this.shards) if (s.state) this.dropShard(s);
      return;
    }
    const ctx = this.ctx;
    const px = plow.position.x;
    const pz = plow.position.z;
    const y0 = (plow.surfaceY || 0) + 1.5;
    const R = st.scrapRadius;
    // Field cue: filings drifting in from the rim.
    if ((this.scrapFxT -= dt) <= 0) {
      this.scrapFxT = 0.18;
      const a = Math.random() * Math.PI * 2;
      _q.set(px + Math.sin(a) * R, y0 - 0.6, pz + Math.cos(a) * R);
      ctx.fx.burst(_q, UPDATE_SCRAP_BURST);
    }
    if ((this.scrapT -= dt) <= 0) {
      this.scrapT = SCRAP_TICK;
      if (!this.puppet) {
        const hits = this.collect(px, pz, R);
        for (let i = 0; i < hits.length; i++) this.weaponHit(hits[i], st.scrapDps * SCRAP_TICK, px, pz, 0, undefined, SHED_SELF);
      }
    }
    this.scrapSpin += dt * SCRAP_SPIN;
    const max = Math.max(1, st.scrapMax);
    for (const s of this.shards) {
      if (!s.state) continue;
      s.t += dt;
      if (s.t >= SCRAP_LIFE || s.slot >= st.scrapMax) {
        this.dropShard(s);
        continue;
      }
      const a = this.scrapSpin + (s.slot / max) * Math.PI * 2;
      const ox = px + Math.sin(a) * SCRAP_ORBIT;
      const oz = pz + Math.cos(a) * SCRAP_ORBIT;
      const oy = y0 + Math.sin(this.scrapSpin * 1.7 + s.slot) * 0.25;
      if (s.state === 1) {
        const k = Math.min(1, s.t / SCRAP_FLY);
        const e = k * k * (3 - 2 * k);
        s.mesh.position.set(s.from.x + (ox - s.from.x) * e, s.from.y + (oy - s.from.y) * e + Math.sin(k * Math.PI) * 1.5, s.from.z + (oz - s.from.z) * e);
        if (k >= 1) s.state = 2;
      } else s.mesh.position.set(ox, oy, oz);
      s.mesh.rotation.set(s.t * 7, a, s.t * 4);
      // Fading out: the last 2 s it shrinks away.
      const life = Math.min(1, (SCRAP_LIFE - s.t) / 2);
      s.mesh.scale.set(life, 0.6 * life, 1.6 * life);
      if (s.state !== 2 || this.puppet) continue;
      const hits = this.collect(s.mesh.position.x, s.mesh.position.z, SCRAP_HIT_R);
      for (let i = 0; i < hits.length; i++) {
        const en = hits[i];
        if (!en.alive || ctx.time - (s.hitAt.get(en) ?? -1e9) < SCRAP_HIT_CD) continue;
        s.hitAt.set(en, ctx.time);
        if (this.weaponHit(en, st.scrapHit, px, pz, 2, undefined, SHED_SELF) > 0) ctx.fx.burst(s.mesh.position, UPDATE_SCRAP_BURST_2);
      }
    }
  }

  private dropShard(s: Shard): void {
    s.state = 0;
    s.t = 0;
    s.mesh.visible = false;
    s.hitAt.clear();
  }

  /** Back to driving its own guns (a re-bind). */
  resetNet(): void {
    this.netFire = -1;
    this.netTurret = NaN;
  }

  /** SPACE (VehicleKit): the Mag Laser; updateGuns (run right after by Combat) reads the trigger. */
  primary(_dt: number, held: boolean, pressed: boolean): void {
    this.trigHeld = held;
    this.trigPressed = pressed;
    this.ultArmed = this.h.crit >= 1;
  }
  /** The meter was full at the start of this frame (Combat calls primary() first every frame): an F press only becomes
   *  the SINGULARITY when the HUD already showed it, not when this frame's own hits topped the meter up. */
  private ultArmed = false;

  /** E (VehicleKit): the Mag Repulsor; spends the E charge when it fires. */
  secondary(_dt: number, _held: boolean, pressed: boolean): boolean {
    return pressed && this.fireLaser();
  }

  /** Puppet bits: bit 0 = Mag Laser trigger down, bit 1 = Mag Repulsor running. */
  netBits(): number {
    return (this.gunsOn ? 1 : 0) | (this.laserT > 0 ? 2 : 0);
  }

  private buildArsenalFx(scene: THREE.Scene): void {
    const beam = beamGeometry();
    const mk = (mat: THREE.Material, order = 3, geo: THREE.BufferGeometry = beam) => {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.renderOrder = order;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    const ball = new THREE.SphereGeometry(1, 14, 10);
    // Mag Laser: a fixed pool of bolt visuals and the nose flash.
    this.laserFx = new LaserFx(scene, LASER_POOL, beam);
    this.flashCore = mk(glowMat(0xe8ffff, 1), 4, ball);
    this.flashTint = mk(tintMat(0x22ccff, 0.55), 3, ball);
    // Mag Repulsor: the forward wave, a gyro flare at the emitter; shared shockwaves (flash rings).
    this.arcs = new ArcWaves(scene, REP_HALF);
    this.lens = mk(glowMat(0xd8ffff, 0.9), 4, ball);
    // Polarity Burst: event horizon, pull point, tethers, streaks.
    this.horizon = new Horizon(scene, beam);
    this.shock = new Shockwaves(scene);
    this.shock.reduceFlash = settings.reduceFlash;
  }

  /** One weapon hit from ARSENAL (player credit). `direct`: rapid single-target fire (laser bolts), see
   *  DamageOpts.direct. `knock` > 0 pushes away from (fromX, fromZ), < 0 pulls toward it (bots divide it by their mass;
   *  a plow scales it by its heaviness, knockScale in Combat.hitPlow, like every push). Returns damage dealt. */
  private weaponHit(e: EnemyHandle, amount: number, fromX: number, fromZ: number, knock: number, direct?: 'round' | 'beam', shed = 1, ult = false): number {
    if (!e.alive) return 0;
    const dx = e.position.x - fromX;
    const dz = e.position.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    const hp0 = e.hp;
    const killed = this.b.enemies.damage(e, amount * this.b.stats.damageMult * this.pveMult * this.hitMult(e), {
      source: 'other',
      knockback: _kb.set((dx / d) * knock, 0, (dz / d) * knock),
      fromX: knock < 0 ? e.position.x + (dx / d) * 2 : fromX,
      fromZ: knock < 0 ? e.position.z + (dz / d) * 2 : fromZ,
      direct,
      pierce: true,
      ult: ult || undefined,
    });
    const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
    this.onPlayerHit(dealt, killed, e);
    if (shed > 0 && !killed) this.shedScrap(e, dealt * shed);
    return dealt;
  }

  /** PVE_MULT against bots, 1 in the Duel. */
  private get pveMult(): number {
    return this.b.pvp ? 1 : PVE_MULT;
  }

  /** Can this pilot's targets be dragged around (bots: yes; a human in the Duel: no)? */
  private get canPull(): boolean {
    return !!this.b.enemies.pull && !this.b.pvp;
  }

  /** Drag `e` toward (x, z) at up to `speed` m/s (slower when close, so it settles instead of overshooting). */
  private pullBot(e: EnemyHandle, x: number, z: number, speed: number, dt: number): void {
    const pull = this.b.enemies.pull;
    if (!pull || this.b.pvp || !e.alive) return;
    const dx = x - e.position.x;
    const dz = z - e.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const v = speed * Math.min(1, d / 3);
    pull.call(this.b.enemies, e, (dx / d) * v, (dz / d) * v, dt);
  }

  /* ------------------------------------------------------------------ SPACE: Mag Laser */

  /** Mag Laser (SPACE, held): one fat hitscan bolt every laserInterval s while the trigger is down. A duel puppet
   *  fires when the host's snapshot says the trigger is down (its targets are empty: visuals only). */
  updateGuns(dt: number): void {
    const held = this.trigHeld;
    const pressed = this.trigPressed;
    this.trigHeld = this.trigPressed = false;
    const st = this.b.stats;
    const plow = this.b.plow;
    this.gunsOn = false;
    this.laserFx.update(dt);
    if (plow) {
      plow.gunFiring = false;
      plow.turretAim = 0;
      plow.gunPitch = 0;
    }
    if (st.gunDamage <= 0 || !plow || plow.dead) {
      this.gunT = this.gunBurstT = 0;
      this.drawFlash(dt);
      return;
    }
    if (this.gunT > 0) this.gunT -= dt;
    // A press without held-key reporting fires a few bolts; a puppet follows the host's held bit only.
    if (pressed && !this.puppet) this.gunBurstT = GUN_BURST;
    else if (this.gunBurstT > 0) this.gunBurstT -= dt;
    const firing = held || this.gunBurstT > 0;
    this.gunsOn = firing;
    plow.gunFiring = firing;
    if (firing && this.gunT <= 0) {
      this.gunT += laserInterval(st);
      if (this.gunT < 0) this.gunT = 0;
      this.fireBolt();
    }
    this.drawFlash(dt);
  }

  /** One bolt: straight along the heading from the nose emitter to the reach, cut short by a prop (it breaks) or the
   *  ground; every target on the line within the beam's width and height band is hit once. */
  private fireBolt(): void {
    const plow = this.b.plow;
    const ctx = this.ctx;
    const st = this.b.stats;
    const fx = Math.sin(plow.heading);
    const fz = Math.cos(plow.heading);
    plow.mountWorld('muzzle', 0, _a);
    const S = _a.set(_a.x + fx * 0.35, _a.y, _a.z + fz * 0.35);
    const reach = tankGunRange(st);
    const hitY = plow.position.y + LASER_HIT_Y;
    let end = reach;
    let blocked = false;
    const props = this.b.authoritative ? ctx.world : null;
    if (props) {
      const t = props.blastPropRay(S.x, S.z, fx, fz, reach);
      if (t >= 0) {
        end = t;
        blocked = true;
      }
    }
    const ter = ctx.terrain;
    if (ter?.active) {
      for (let d = LASER_STEP; d <= end; d += LASER_STEP) {
        const y = S.y + (hitY - S.y) * (d / reach);
        if (ter.heightAt(S.x + fx * d, S.z + fz * d, y) > y - 0.25) {
          end = Math.max(0.3, d - LASER_STEP * 0.5);
          blocked = true;
          break;
        }
      }
    }
    this.boltsFired++;
    // Hits: every live target whose body the beam crosses (host / solo only; a duel guest's view hits nothing).
    let struck = 0;
    if (!this.puppet) {
      const rad = tankBeamRadius(st);
      const hits = this.collect(S.x + fx * end * 0.5, S.z + fz * end * 0.5, end * 0.5 + rad + 0.5);
      const out = this.laserHits;
      out.length = 0;
      for (let i = 0; i < hits.length; i++) {
        const e = hits[i];
        if (!e.alive) continue;
        const ex = e.position.x - S.x;
        const ez = e.position.z - S.z;
        const u = ex * fx + ez * fz;
        if (u < -e.radius * 0.5 || u > end + e.radius) continue;
        if (Math.abs(ex * fz - ez * fx) > e.radius + rad + LASER_WIDEN * Math.max(0, u)) continue;
        if (hitY < e.position.y - LASER_DY || hitY > e.position.y + Math.min(2.4, e.radius * 1.2) + LASER_DY) continue;
        out.push(e);
      }
      this.clearTargets();
      for (let i = 0; i < out.length; i++) if (this.laserStrike(out[i], fx, fz)) struck++;
      out.length = 0;
    }
    // A duel guest (its own laser or the replayed opponent's): the bolt visibly stops on the other plow if it is on
    // the line (the host decides the hit).
    let impact = blocked ? 1 : struck ? 0.8 : 0;
    const foe = this.b.authoritative ? null : this.b.foe;
    if (foe && !foe.dead) {
      const u = (foe.position.x - S.x) * fx + (foe.position.z - S.z) * fz;
      const off = Math.abs((foe.position.x - S.x) * fz - (foe.position.z - S.z) * fx);
      if (u > 0 && u < end + 1.6 && off < 1.6 + tankBeamRadius(st) + LASER_WIDEN * u) {
        end = Math.max(0.3, u - 1);
        impact = 1;
      }
    }
    _tip.set(S.x + fx * end, S.y + (hitY - S.y) * (end / reach), S.z + fz * end);
    // Drawn as a widening pulse: its far radius matches the hit width at the end point (a touch inside it).
    this.laserFx.fire(S, _tip, impact, (tankBeamRadius(st) + LASER_WIDEN * end) * 0.85);
    this.flashK = 1;
    if (blocked) {
      _fwd.set(-fx, 0.5, -fz).normalize();
      ctx.fx.sparks(_tip, _fwd, LASER_BLOCK_SPARKS);
    }
    // A rapid zap per bolt (quiet, pitch-jittered so 12 a second doesn't clip or drone).
    this.b.audio.play('zap', { volume: 0.09, pitch: 2.1 + Math.random() * 0.35 });
  }

  /** One bolt hit: gunDamage (a direct 'round' hit) and a tug toward ARSENAL. True if it dealt damage. */
  private laserStrike(e: EnemyHandle, fx: number, fz: number): boolean {
    const plow = this.b.plow;
    const knock = -(this.b.pvp ? LASER_DUEL_TUG : LASER_TUG * (e.isBoss ? LASER_TUG_BOSS : 1));
    const dealt = this.weaponHit(e, this.b.stats.gunDamage, plow.position.x, plow.position.z, knock, 'round');
    this.chest(e, _r);
    _fwd.set(-fx, 0.35, -fz).normalize();
    const f = this.ctx.fx;
    f.sparks(_r, _fwd, LASER_HIT_SPARKS);
    f.burst(_r, LASER_HIT_BURST);
    const now = this.ctx.time;
    if (dealt > 0 && now - this.lastLaserSfx >= LASER_SFX_GAP) {
      this.lastLaserSfx = now;
      this.b.audio.play('zap', { volume: 0.26, pitch: 1.3 + Math.random() * 0.2 });
      this.b.audio.play('block', { volume: 0.12, pitch: 1.1 + Math.random() * 0.2 });
      if (this.b.local) this.shake(0.04);
    }
    return dealt > 0;
  }

  /** A bot's chest point (aim / beam end). */
  private chest(e: EnemyHandle, out: THREE.Vector3): THREE.Vector3 {
    return out.set(e.position.x, e.position.y + Math.min(1.2, e.radius * 0.6), e.position.z);
  }

  /** The flash at the nose as each bolt leaves. */
  private drawFlash(dt: number): void {
    this.flashK = Math.max(0, this.flashK - dt * FLASH_DECAY);
    const plow = this.b.plow;
    const on = this.flashK > 0.02 && !!plow;
    this.flashCore.visible = this.flashTint.visible = on;
    if (!on) return;
    plow.mountWorld('muzzle', 0, _a);
    _a.x += Math.sin(plow.heading) * 0.35;
    _a.z += Math.cos(plow.heading) * 0.35;
    const k = this.flashK;
    this.flashCore.position.copy(_a);
    this.flashTint.position.copy(_a);
    this.flashCore.scale.setScalar(0.22 * k + 0.04);
    this.flashTint.scale.setScalar(0.5 * k + 0.08);
    (this.flashTint.material as THREE.MeshBasicMaterial).opacity = 0.55 * k;
  }

  /** Can a weapon at (x, y, z) see the bot (terrain / decks in the way)? Always true on flat arenas. */
  private canSee(x: number, y: number, z: number, e: EnemyHandle): boolean {
    const ter = this.ctx.terrain;
    if (!ter?.active) return true;
    return ter.lineOfSight(x, y, z, e.position.x, e.position.y + Math.min(1.2, e.radius * 0.6), e.position.z);
  }

  /* ------------------------------------------------------------------ E: Mag Repulsor */

  /** Mag Repulsor (E; the Plow pays the E charge). False if it can't fire. */
  fireLaser(): boolean {
    const st = this.b.stats;
    const plow = this.b.plow;
    if (st.laserDps <= 0 || this.laserT > 0 || !plow || plow.dead) return false;
    this.laserT = REP_SECONDS;
    this.laserOff = 0;
    this.repHit.clear();
    this.repHeading = plow.heading;
    this.repR = st.laserRange;
    this.repHalf = tankRepulseHalf(st);
    plow.mountWorld('laser', 0, this.repAt);
    const ctx = this.ctx;
    const A = this.repAt;
    const gy = Number.isFinite(plow.surfaceY) ? plow.surfaceY : plow.position.y;
    const ground = this.snowTop(A.x, A.z, 2, gy);
    // The wave: a tall magnetic wall sweeping the wedge, a quick flash ring at the nose.
    this.arcs.spawn(A.x, ground, A.z, this.repHeading, this.repR, this.repHalf, REP_SECONDS * 1.25, 2.4);
    this.shock.spawn(A.x, ground, A.z, 2.2, { dur: 0.25, flashR: 1.5, flashY: A.y - ground });
    ctx.fx.burst(A, { color: 0xffffff, count: 10, speed: 9, size: 0.14, gravity: 0, life: 0.18 });
    // Field lines: bright streaks flung out across the wedge.
    for (let i = 0; i < 12; i++) {
      const a = this.repHeading + ((i + Math.random()) / 12 - 0.5) * 2 * this.repHalf;
      _fwd.set(Math.sin(a), 0.05 + Math.random() * 0.15, Math.cos(a)).normalize();
      ctx.fx.sparks(A, _fwd, { count: 1, color: i % 2 ? CYAN : 0xd8ffff, speed: 26 + Math.random() * 10, spread: 0.05, size: 0.07, life: 0.32, gravity: 0, length: 0.16 });
    }
    if (this.b.authoritative) {
      const props = ctx.world;
      if (props) for (let i = -1; i <= 1; i++) props.blastPropRay(A.x, A.z, Math.sin(this.repHeading + i * this.repHalf * 0.6), Math.cos(this.repHeading + i * this.repHalf * 0.6), this.repR);
    }
    plow.gyroCharge = 1;
    this.b.snow.melt(A.x + Math.sin(this.repHeading) * 3, A.z + Math.cos(this.repHeading) * 3, 2, 0.3);
    this.b.audio.play('shockwave', { pitch: 1.5, volume: 0.75 });
    this.b.audio.play('zap', { pitch: 0.45, volume: 0.8 });
    this.shake(0.2);
    if (this.b.local) this.impactHit('slam', A, 0.5, { stop: false });
    return true;
  }

  /** The wave front runs out over REP_SECONDS; every bot in the wedge it reaches takes one hit and is flung away. */
  updateLaser(dt: number): void {
    const plow = this.b.plow;
    if (this.laserT <= 0) return;
    this.laserT -= dt;
    const k = Math.min(1, 1 - this.laserT / REP_SECONDS);
    const lens = this.lens;
    if (plow && !plow.dead) {
      plow.mountWorld('laser', 0, _p);
      lens.visible = true;
      lens.position.copy(_p);
      lens.scale.setScalar(0.7 * (1 - k) + 0.1);
      plow.gyroCharge = Math.max(this.h.ultIdle ? 0 : plow.gyroCharge, 1 - k);
    }
    if (!this.puppet) {
      const front = this.repR * (1 - (1 - k) ** 2);
      this.repulseHits(front);
    }
    if (this.laserT <= 0) this.endRepulse();
  }

  /** Hit every bot in the wedge whose near edge the front (`front` m out) has reached, once per cast. */
  private repulseHits(front: number): void {
    const st = this.b.stats;
    const A = this.repAt;
    const R = this.repR;
    const fx = Math.sin(this.repHeading);
    const fz = Math.cos(this.repHeading);
    const hits = this.collect(A.x, A.z, front + 0.5);
    const dmg0 = st.laserDps * REP_DMG_SECONDS;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive || this.repHit.has(e)) continue;
      const dx = e.position.x - A.x;
      const dz = e.position.z - A.z;
      const d = Math.hypot(dx, dz);
      if (d - e.radius > front || d > R + e.radius) continue;
      if (d > e.radius && Math.acos(THREE.MathUtils.clamp((dx * fx + dz * fz) / d, -1, 1)) - Math.asin(Math.min(1, e.radius / d)) > this.repHalf) continue;
      if (Math.abs(e.position.y + Math.min(1.2, e.radius * 0.6) - A.y) > REP_DY + e.radius) continue;
      if (!this.canSee(A.x, A.y, A.z, e)) continue;
      this.repHit.add(e);
      const far = 1 - (1 - REP_FAR) * THREE.MathUtils.clamp((d - R * 0.5) / (R * 0.5), 0, 1);
      const knock = this.b.pvp ? REP_DUEL_KNOCK : REP_KNOCK * (e.isBoss ? REP_BOSS : 1);
      const dealt = this.weaponHit(e, dmg0 * far * (this.b.pvp ? REP_PVP : 1), A.x, A.z, knock);
      this.chest(e, _tip);
      _fwd.set(dx / (d || 1), 0.3, dz / (d || 1)).normalize();
      this.ctx.fx.sparks(_tip, _fwd, { count: 8, color: CYAN, speed: 12, spread: 0.6, size: 0.06, life: 0.25, gravity: 4 });
      if (dealt > 0) {
        _tip.y += e.radius + 0.6;
        this.ctx.fx.floatText(_tip, `${Math.round(dealt)}`, '#7ff0ff', 0.9);
      }
    }
    this.clearTargets();
  }

  private endRepulse(): void {
    this.laserT = 0;
    this.lens.visible = false;
    this.repHit.clear();
    if (this.b.plow && this.h.ultIdle) this.b.plow.gyroCharge = 0;
  }

  /* ------------------------------------------------------------------ F: Polarity Burst */

  /** Highest snow top round (x, z) out to `r` m (centre + 8 rim samples), at least `y`: flat ground FX sit on it so
   *  the snow never swallows them. */
  private snowTop(x: number, z: number, r: number, y: number): number {
    const snow = this.ctx.snow;
    if (!snow) return y;
    let top = y;
    for (let i = 0; i < 9; i++) {
      const a = (i / 8) * Math.PI * 2;
      const rr = i === 8 ? 0 : r * 0.9;
      const h = snow.topAt(x + Math.sin(a) * rr, z + Math.cos(a) * rr);
      if (Number.isFinite(h) && h > top) top = h;
    }
    return top;
  }

  /** Polarity Burst (F on ARSENAL), or the SINGULARITY when the meter is full. Runs the burst once it's out. */
  updateBurst(dt: number): void {
    const st = this.b.stats;
    const plow = this.b.plow;
    this.tickBurst(dt);
    this.tickSingFx(dt);
    this.shock.update(dt);
    this.horizon.streaks.update(dt);
    if (st.missileDamage <= 0 || !plow || plow.dead) return;
    if (this.missileCharge < 1) this.missileCharge = Math.min(1, this.missileCharge + (st.missileCooldown > 0 ? dt / st.missileCooldown : 1));
    if (!this.b.input.wasPressed('KeyF')) return;
    if (this.ultArmed && this.h.crit >= 1 && this.h.ultIdle) return this.h.startUlt('arsenal', plow);
    if (this.missileCharge < 1) {
      this.b.audio.play('error');
      return;
    }
    this.missileCharge = 0;
    this.b.events.emit('ability', { nuke: false });
    this.startBurst();
  }

  private startBurst(): void {
    const plow = this.b.plow;
    this.burstT = 0;
    this.burstStreakT = 0;
    this.burstAt.set(plow.position.x + Math.sin(plow.heading) * BURST_POINT, 0, plow.position.z + Math.cos(plow.heading) * BURST_POINT);
    this.burstY = Number.isFinite(plow.surfaceY) ? plow.surfaceY : 0;
    this.burstAt.y = this.burstY + 1.3;
    this.b.audio.play('charge', { pitch: 0.6, volume: 0.8 });
    this.b.audio.play('burst', { pitch: 0.7, volume: 0.6 });
    this.shake(0.12);
  }

  private tickBurst(dt: number): void {
    if (this.burstT < 0) return;
    const plow = this.b.plow;
    const t0 = this.burstT;
    this.burstT += dt;
    const t = this.burstT;
    const S = this.burstAt;
    if (plow) plow.gyroFlat = t < BURST_DET + 0.15 ? 1 : 0;
    // Event horizon: snaps open, holds with a shimmer while pulling, shrinks into the point before the detonation.
    const open = THREE.MathUtils.smoothstep(t, 0, BURST_OPEN);
    const shut = THREE.MathUtils.smoothstep(t, BURST_DET - 0.25, BURST_DET);
    const r = Math.max(0.3, BURST_R * open * (1 - 0.92 * shut));
    const vis = t < BURST_DET;
    const hz = this.horizon;
    if (vis) hz.set(S.x, this.snowTop(S.x, S.z, r, this.burstY), S.z, r, S, 0.5 + 0.5 * open + 0.6 * shut, t, Math.min(1, 0.3 + open) * (1 - 0.5 * shut));
    else hz.hide();
    // Pull every bot inside the horizon toward the point: tethers to the point, streaks rushing in.
    let nt = 0;
    if (t >= BURST_OPEN * 0.5 && t < BURST_DET) {
      const hits = this.collect(S.x, S.z, r);
      const streak = (this.streakT -= dt) <= 0;
      if (streak) this.streakT = 0.05;
      for (let i = 0; i < hits.length; i++) {
        const e = hits[i];
        if (!e.alive) continue;
        this.pullBot(e, S.x, S.z, BURST_PULL * (e.isBoss ? BURST_BOSS : 1), dt);
        this.chest(e, _tip);
        hz.tether(nt++, _tip, 0.05 * (0.8 + 0.4 * Math.random()));
        if (streak) {
          _fwd.subVectors(S, _tip).normalize();
          this.ctx.fx.sparks(_tip, _fwd, { count: 2, color: CYAN, speed: 12, spread: 0.15, size: 0.06, life: 0.25, gravity: 0, length: 0.1 });
        }
      }
      this.clearTargets();
      // Streaks of light (and snow) rushing in from the rim.
      this.burstStreakT -= dt;
      while (this.burstStreakT <= 0) {
        this.burstStreakT += 0.022;
        const a = Math.random() * Math.PI * 2;
        const rr = r * (0.75 + 0.25 * Math.random());
        _tip.set(S.x + Math.sin(a) * rr, this.burstY + 0.2 + Math.random() * 1.8, S.z + Math.cos(a) * rr);
        hz.streaks.spawn(_tip, 0.35 + 0.25 * Math.random());
      }
      if (streak) {
        const a = Math.random() * Math.PI * 2;
        _tip.set(S.x + Math.sin(a) * r, this.burstY + 0.3, S.z + Math.cos(a) * r);
        _fwd.set(S.x - _tip.x + Math.cos(a) * r * 0.4, 0.3, S.z - _tip.z - Math.sin(a) * r * 0.4).normalize();
        this.ctx.fx.sparks(_tip, _fwd, TICK_BURST_SPARKS);
      }
    }
    hz.tethersDone(nt);
    if (t0 < BURST_DET && t >= BURST_DET) this.detonateBurst();
    if (t >= BURST_END) {
      this.burstT = -1;
      if (plow) plow.gyroFlat = 0;
    }
  }

  /** The burst collapses: cyan shockwave, damage to everything in the clump (thinner the more it catches), knockback. */
  private detonateBurst(): void {
    const st = this.b.stats;
    const S = this.burstAt;
    const fx = this.ctx.fx;
    fx.burst(S, { color: 0xffffff, count: 16, speed: 14, size: 0.2, gravity: 0, life: 0.25 });
    fx.burst(S, { color: CYAN, count: 26, speed: 11, size: 0.35, gravity: -1, life: 0.6 });
    fx.sparks(S, null, { count: 30, color: CYAN, speed: 22, size: 0.07, life: 0.35, gravity: 4 });
    // The shockwave: a fast hot ring with a tall wall and a big flash, a slower wide ring behind it.
    this.horizon.hide();
    this.horizon.streaks.clear();
    const gy = this.snowTop(S.x, S.z, BURST_DET_R, this.burstY);
    this.shock.spawn(S.x, gy, S.z, BURST_DET_R * 1.7, { dur: 0.6, flashR: 2.6, flashY: S.y - gy, wallH: 3 });
    this.shock.spawn(S.x, gy, S.z, BURST_DET_R * 1.05, { dur: 0.4 });
    _tip.set(S.x, this.burstY + 0.15, S.z);
    fx.ring(_tip, BURST_DET_R * 2.2, CYAN);
    this.b.audio.play('explosion', { pitch: 0.75, volume: 0.65 });
    this.b.audio.play('zap', { pitch: 0.4, volume: 0.8 });
    this.shake(0.35);
    if (this.b.local) this.impactHit('slam', S, 0.9);
    this.b.snow.melt(S.x, S.z, BURST_DET_R * 0.6, 0.6);
    this.smashProps(S.x, S.z, BURST_DET_R);
    if (this.puppet) return;
    const hits = this.collect(S.x, S.z, BURST_DET_R);
    let n = 0;
    for (let i = 0; i < hits.length; i++) if (hits[i].alive && Math.abs(hits[i].position.y - this.burstY) < BURST_DET_R) n++;
    const per = (Math.max(1, st.missileCount) * st.missileDamage) / Math.max(1, n) ** BURST_SPREAD;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive || Math.abs(e.position.y - this.burstY) >= BURST_DET_R) continue;
      const dealt = this.weaponHit(e, per, S.x, S.z, BURST_KNOCK);
      if (dealt > 0) {
        _tip.set(e.position.x, e.position.y + e.radius + 1.2, e.position.z);
        fx.floatText(_tip, `🌀${Math.round(dealt)}`, '#7ff0ff', 1);
      }
    }
    this.clearTargets();
  }

  /* ------------------------------------------------------------------ ULT: SINGULARITY */

  /** Where the black hole opens: the centre of the densest bot cluster within SING_SEEK m, else SING_AHEAD m ahead. */
  singularityCentre(x: number, z: number, heading: number, out: THREE.Vector3): THREE.Vector3 {
    const hits = this.collect(x, z, SING_SEEK);
    let best = -1;
    let bestN = 0;
    for (let i = 0; i < hits.length; i++) {
      const a = hits[i];
      if (!a.alive || Math.hypot(a.position.x - x, a.position.z - z) > SING_SEEK) continue;
      let n = 0;
      for (let j = 0; j < hits.length; j++) {
        const b = hits[j];
        if (b.alive && Math.hypot(b.position.x - a.position.x, b.position.z - a.position.z) <= SING_CLUSTER) n += b.isBoss ? 2 : 1;
      }
      if (n > bestN) {
        bestN = n;
        best = i;
      }
    }
    if (best < 0) out.set(x + Math.sin(heading) * SING_AHEAD, 0, z + Math.cos(heading) * SING_AHEAD);
    else {
      const a = hits[best];
      let sx = 0;
      let sz = 0;
      let c = 0;
      for (let j = 0; j < hits.length; j++) {
        const b = hits[j];
        if (!b.alive || Math.hypot(b.position.x - a.position.x, b.position.z - a.position.z) > SING_CLUSTER) continue;
        sx += b.position.x;
        sz += b.position.z;
        c++;
      }
      out.set(sx / c, 0, sz / c);
    }
    this.clearTargets();
    return out;
  }

  /** Build the SINGULARITY FX now (hidden) instead of at the first ult, so a warm-up can compile it (render/warmup.ts).
   *  Only with a camera: headless sims have none. */
  prewarm(): void {
    if (this.ctx.camera) this.singFx ??= new SingularityFx(this.ctx.scene, { reduceFlash: settings.reduceFlash });
  }

  /** SINGULARITY: a black hole opens over the fight. */
  ultStart(x: number, z: number): number {
    const plow = this.b.plow;
    const heading = plow ? plow.heading : 0;
    this.singularityCentre(x, z, heading, this.singAt);
    const ter = this.ctx.terrain;
    this.singY = ter?.active ? ter.heightAt(this.singAt.x, this.singAt.z, plow ? plow.position.y + 2 : 0) : 0;
    this.singAt.y = this.singY + 4.5;
    this.singTickT = SING_TICK;
    this.singCollapsed = this.singBlown = false;
    if (this.ctx.camera) {
      this.prewarm();
      this.singFx!.reduceFlash = settings.reduceFlash;
      this.singFx!.open(this.singAt, SING_VIS_R);
    }
    if (plow) plow.gyroCharge = 1;
    this.b.audio.play('charge', { pitch: 0.35, volume: 1 });
    this.b.audio.play('thunder', { pitch: 0.45, volume: 0.7 });
    this.shake(0.3);
    // The meter can't refill while the black hole is open anyway (Ultimates.feed), so only a short lock after.
    return 1;
  }

  /** Pull, tick, collapse, explode; over at SING_END. */
  ultTick(t: number, dt: number): boolean {
    const C = this.singAt;
    if (t < SING_PULL_T) {
      const k = t / SING_PULL_T;
      const v = SING_V0 + (SING_V1 - SING_V0) * k * k;
      const hits = this.collect(C.x, C.z, SING_R);
      const tick = (this.singTickT -= dt) <= 0;
      if (tick) this.singTickT += SING_TICK;
      const streak = Math.random() < 0.5;
      for (let i = 0; i < hits.length; i++) {
        const e = hits[i];
        if (!e.alive) continue;
        if (Math.hypot(e.position.x - C.x, e.position.z - C.z) > SING_R + e.radius) continue;
        this.pullBot(e, C.x, C.z, v * (e.isBoss ? SING_BOSS : 1), dt);
        if (streak && Math.random() < 0.3) {
          this.chest(e, _tip);
          _fwd.subVectors(C, _tip).normalize();
          this.ctx.fx.sparks(_tip, _fwd, { count: 1, color: 0x9a7bff, speed: 10 + 10 * k, spread: 0.1, size: 0.06, life: 0.3, gravity: 0, length: 0.12 });
        }
      }
      if (tick && !this.puppet) {
        const tug = this.canPull ? 0 : -2;
        const dmg = this.b.stats.missileDamage * SING_TICK_DMG;
        for (let i = 0; i < hits.length; i++) {
          const e = hits[i];
          if (e.alive && Math.hypot(e.position.x - C.x, e.position.z - C.z) <= SING_R + e.radius) this.weaponHit(e, dmg, C.x, C.z, tug, undefined, 1, true);
        }
      }
      this.clearTargets();
      // Rumble that builds as it pulls.
      if (this.b.local) this.ctx.fx.shake(0.04 + 0.08 * k);
      if (tick && Math.random() < 0.5) this.b.audio.play('thunder', { pitch: 0.3 + 0.2 * k, volume: 0.25 + 0.2 * k });
      return false;
    }
    if (!this.singCollapsed) {
      this.singCollapsed = true;
      this.singFx?.collapse();
      this.b.audio.play('charge', { pitch: 0.25, volume: 0.8 });
    }
    if (t >= SING_PULL_T + SING_COLLAPSE && !this.singBlown) {
      this.singBlown = true;
      this.explodeSingularity();
    }
    if (t >= SING_END) {
      const plow = this.b.plow;
      if (plow) plow.gyroCharge = 0;
      return true;
    }
    return false;
  }

  /** The collapse: everything in reach takes the blast (full near the core, half at the rim), flung outward. */
  private explodeSingularity(): void {
    const C = this.singAt;
    const fx = this.ctx.fx;
    fx.burst(C, { color: 0xffffff, count: 30, speed: 20, size: 0.3, gravity: 0, life: 0.35 });
    fx.burst(C, { color: CYAN, count: 40, speed: 16, size: 0.45, gravity: -1, life: 0.8 });
    fx.sparks(C, null, { count: 60, color: CYAN, speed: 30, size: 0.09, life: 0.5, gravity: 6 });
    _tip.set(C.x, this.singY + 0.2, C.z);
    fx.ring(_tip, SING_CORE * 1.6, CYAN);
    fx.ring(_tip, SING_CORE, 0xffffff);
    this.b.audio.play('explosion', { pitch: 0.5, volume: 1 });
    this.b.audio.play('thunder', { pitch: 0.6, volume: 0.9 });
    this.shake(0.9);
    if (this.b.local) this.impactHit('nuke', C, 1);
    this.b.snow.melt(C.x, C.z, SING_CORE * 0.7, 0.8);
    this.smashProps(C.x, C.z, SING_CORE);
    if (this.puppet) return;
    const hits = this.collect(C.x, C.z, SING_R);
    let n = 0;
    for (let i = 0; i < hits.length; i++) if (hits[i].alive && Math.hypot(hits[i].position.x - C.x, hits[i].position.z - C.z) <= SING_R + hits[i].radius) n++;
    const per = (SING_POOL * this.b.stats.missileDamage) / Math.max(1, n) ** SING_SPREAD;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - C.x, e.position.z - C.z);
      if (d > SING_R + e.radius) continue;
      const k = 1 - 0.5 * THREE.MathUtils.clamp((d - SING_CORE) / (SING_R - SING_CORE), 0, 1);
      const dealt = this.weaponHit(e, per * k, C.x, C.z, SING_KNOCK, undefined, 1, true);
      if (dealt > 0) {
        _tip.set(e.position.x, e.position.y + e.radius + 1.3, e.position.z);
        fx.floatText(_tip, `🌀${Math.round(dealt)}`, '#b9a4ff', 1.2);
      }
    }
    this.clearTargets();
  }

  /** The black hole's visuals run every frame (the flash outlives the ultimate's timeline). */
  private tickSingFx(dt: number): void {
    const cam = this.ctx.camera;
    if (this.singFx && cam) this.singFx.update(dt, cam);
  }

  clear(): void {
    this.missileCharge = 1;
    for (const s of this.shards) this.dropShard(s);
    this.shedDmg.clear();
    this.scrapT = 0;
    this.laserFx.clear();
    this.gunT = this.gunBurstT = 0;
    this.gunsOn = false;
    this.flashK = 0;
    this.flashCore.visible = this.flashTint.visible = false;
    this.arcs.clear();
    this.endRepulse();
    this.laserOff = 0;
    this.trigHeld = this.trigPressed = false;
    this.burstT = -1;
    this.horizon.clear();
    this.shock.clear();
    const plow = this.b.plow;
    if (plow) plow.gyroFlat = plow.gyroCharge = 0;
  }
}
