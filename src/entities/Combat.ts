import * as THREE from 'three';
import { FlameCone } from '../fx/FlameCone';
import { Lightning } from '../fx/Lightning';
import {
  SLAM_DAMAGE_K,
  ballVolume,
  type CombatAPI,
  type EnemyHandle,
  type GameContext,
  type ImpactKind,
  type ImpactOpts,
  type PlowAPI,
} from '../core/types';
import { COMBO_MAX, COMBO_WINDOW, LAST_STAND_HP } from '../config/upgrades';
import { ctxPilot, type PilotBinding } from './pilot';
import { NP } from '../net/protocol';

/** Seconds of damage i-frames after the plow is hit (overlapping hits only add their excess). */
const IFRAME_SECONDS = 0.15;
const SECOND_WIND_GUARD = 1.5;
/** Inferno (F): flame duration, cone half-angle (cos), seconds between ignite checks, burn length + tick. */
const FLAME_SECONDS = 1.4;
const FLAME_HALF = 0.7;
const FLAME_COS = Math.cos(FLAME_HALF);
/** Direct damage while standing in the cone, as a fraction of burn dps (on top of the burn). */
const FLAME_CONTACT = 1.0;
/** Burning bots take this much extra damage from every source the player deals. */
const BURN_VULN = 1.2;
const FLAME_IGNITE_EVERY = 0.12;
const BURN_SECONDS = 4;
const BURN_TICK = 0.5;
/** Inferno finisher: when the flames run out, the cone bursts in a fireball at its far half — radius (m), damage as a
 *  multiple of burn dps (x your damage mult), knockback (m/s). */
const FIREBALL_RADIUS = 4.5;
const FIREBALL_MULT = 1.6;
const FIREBALL_KNOCK = 12;
/** FIRESTORM (Classic Plow's ultimate): fire damage you deal fills the 🔥 meter (this much fills it); then F
 *  unleashes a 360° fire nova — FIRESTORM_MULT x burn dps across FIRESTORM_RADIUS (falling off to 50% at the rim),
 *  big knockback — and leaves the ground burning for FIRE_FIELD_SECONDS, igniting anything that walks in. */
const FIRESTORM_CHARGE = 700;
const FIRESTORM_RADIUS = 13;
const FIRESTORM_MULT = 3.5;
const FIRESTORM_KNOCK = 18;
const FIRE_FIELD_SECONDS = 4;
const FIRE_FIELD_RADIUS = 10;
const FIRE_FIELD_TICK = 0.3;
/** Fire-field contact damage per second, as a share of burn dps (on top of the burn it keeps lit). */
const FIRE_FIELD_DPS = 0.35;
/** Ultimates for VOLT-9 / BRUTUS / ARSENAL (ISOTOPE has the NUKE, the Classic the FIRESTORM): any damage you deal
 *  fills the meter (this much fills it). While an ultimate and its aftermath play out, nothing refills it. */
const ULT_CHARGE = { volt: 900, brute: 900, arsenal: 1000 } as const;
/** SUPERCELL (VOLT-9): SUPERCELL_WAVES waves of sky strikes on every bot within SUPERCELL_RADIUS, SUPERCELL_GAP s
 *  apart, each SUPERCELL_MULT x clap damage + a long shock. No Overload backlash. */
const SUPERCELL_RADIUS = 18;
const SUPERCELL_WAVES = 3;
const SUPERCELL_GAP = 0.5;
const SUPERCELL_MULT = 1.1;
/** EARTHQUAKE (BRUTUS): QUAKE_RINGS shockwaves rolling outward, each hitting the band it sweeps for QUAKE_MULT x
 *  pound damage + stun + knockback. */
const QUAKE_RINGS = [8, 13, 19] as const;
const QUAKE_GAP = 0.35;
const QUAKE_MULT = 1.0;
/** ORBITAL STRIKE (ARSENAL): marks up to ORBITAL_TARGETS top-priority bots within ORBITAL_RANGE, then after
 *  ORBITAL_DELAY a sky laser hits each — ORBITAL_MULT x missile damage in ORBITAL_RADIUS. */
const ORBITAL_TARGETS = 5;
const ORBITAL_RANGE = 50;
const ORBITAL_DELAY = 1;
const ORBITAL_MULT = 4;
const ORBITAL_RADIUS = 4.5;
/** Thunderclap storm: duration, extra sky strikes (each = share of clap damage), field dps share. */
const STORM_SECONDS = 2.5;
const STORM_STRIKES = 7;
const STORM_STRIKE_FRAC = 0.4;
const STORM_FIELD_FRAC = 0.25;
/** Thunderclap backlash: a flat shock to the pilot, squared by Overload heat. Each clap adds 1 heat, which bleeds
 *  off at 1 per CLAP_HEAT_DECAY seconds, so a clap every ~3s costs CLAP_BACKLASH but chain-spamming (Overclock at
 *  0 cooldown) escalates fast: 6 → 15 → 29 → 47 → 69 → 96 at one clap per second. */
const CLAP_BACKLASH = 6;
const CLAP_HEAT_DECAY = 2.5;
/** Ground Pound (F on BRUTUS): hop length (s) and peak height (m); damage falls off to this share at the rim. */
const POUND_HOP_SECONDS = 0.85;
const POUND_HOP_HEIGHT = 5;
const POUND_RIM_FRAC = 0.6;
/** The full leap telegraphs the slam, so it pays for it: untouchable while airborne, and the drop from height
 *  hits harder and wider. */
const POUND_LEAP_DMG = 1.3;
const POUND_LEAP_RADIUS = 1.2;
/** ISOTOPE: irradiated bots take this much extra damage from the player; radiation lasts RAD_SECONDS after the
 *  last dose. Fallout pools tick every POOL_TICK; Chain Reaction blasts reach CHAIN_RADIUS. */
const RAD_VULN = 1.15;
const RAD_SECONDS = 3;
const POOL_TICK = 0.3;
const MAX_POOLS = 4;
const CHAIN_RADIUS = 4;
/** NUKE (ISOTOPE): Critical Mass fills from radiation damage dealt (this much fills it); the next F arms a
 *  NUKE that goes off instantly — NUKE_DMG_MULT x Meltdown damage across NUKE_RADIUS, falling
 *  off to NUKE_RIM_FRAC at the edge, plus a giant fallout pool. */
const NUKE_CHARGE_DMG = 900;
const NUKE_RADIUS = 18;
const NUKE_DMG_MULT = 4;
const NUKE_RIM_FRAC = 0.35;
const NUKE_KNOCK = 26;
/** Momentum (BRUTUS) only counts closing speed up to this many m/s. */
const MOMENTUM_SPEED_CAP = 20;
/** Buzzsaw halos (BRUTUS): a full halo stretches the saw reach by this share. */
const SAW_HALO_REACH = 0.5;
/** Iron Hide (BRUTUS) is at full strength from this share of top speed; parked it keeps IRON_HIDE_IDLE of it. */
const IRON_HIDE_SPEED = 0.7;
const IRON_HIDE_IDLE = 0.4;
/** Minimum seconds between two rams on the same bot (safety net for per-frame contact calls). */
const RAM_REPEAT = 0.25;
/** cos(60°): attacker must be within ±60° of the plow's front for the ball to shield. */
const SHIELD_COS = 0.5;
/** Smallest held ball that still works as a shield. */
const SHIELD_MIN_R = 0.2;
/** m^3 of ball snow lost per point of damage blocked. */
const BLOCK_SNOW_PER_DMG = 0.04;
/** Dash strike: one strike per bot per dash. */
const DASH_STRIKE_REPEAT = 0.75;
const DASH_KNOCK = 22;
const DASH_HITSTOP = 0.06;
const WHIRL_PULL = 6;
const WHIRL_BLAST = 22;
/** The player's whirl hits harder than the base kit (Brawl rivals keep the base numbers). */
const WHIRL_PLAYER_BONUS = 1.35;

/** ARSENAL: autocannon lock-on half-angle (80° either side of the nose, as a cos) and the burst a single press fires
 *  when the input source can't report held keys. */
const GUN_LOCK_HALF = 1.4;
const GUN_LOCK_COS = Math.cos(GUN_LOCK_HALF);
const GUN_BURST = 0.5;
const GUN_KNOCK = 1.5;
const TRACERS = 12;
/** Laser beam: seconds it burns, hit width (m), damage tick. */
const LASER_SECONDS = 1.5;
const LASER_WIDTH = 0.9;
const LASER_TICK = 0.1;
/** Laser tracking: the beam bends up to LASER_TRACK rad off the nose toward the top target, at LASER_SLEW rad/s. */
const LASER_TRACK = 0.4;
const LASER_SLEW = 1.6;
/** Missiles: flight speed (m/s), turn rate (1/s), blast radius (m), splash share, fuse (s). */
const MISSILES_MAX = 12;
const MISSILE_SPEED = 26;
const MISSILE_TURN = 5;
const MISSILE_BLAST = 3.2;
const MISSILE_SPLASH = 0.6;
const MISSILE_FUSE = 3.5;
const MISSILE_RANGE = 45;
/** A missile whose target dies looks for a new one within this many metres of itself. */
const MISSILE_RETARGET = 25;
/** Threat: damage each bot dealt you, decaying with this time constant (s). A hit is credited to the nearest bot
 *  within THREAT_RADIUS of where it came from. */
const THREAT_TAU = 10;
const THREAT_RADIUS = 6;

const ULT_NAME = { volt: '⚡ SUPERCELL', brute: '🌍 EARTHQUAKE', arsenal: '🛰 ORBITAL STRIKE' } as const;

/** Share of camera shake / kick a duel opponent's attacks cause on this screen (no hit-stop at all). */
const REMOTE_SHAKE = 0.35;
const REMOTE_IMPACT: ImpactOpts = { stop: false, falloff: 0.5 };

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _tip = new THREE.Vector3();

/** Wrap an angle into (-PI, PI]. */
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** All melee damage math for the player and the bots lives here. */
export class Combat implements CombatAPI {
  private ctx: GameContext;
  /** Whose plow / stats / input / targets this Combat resolves (ctxPilot = the single-player singletons). */
  private b: PilotBinding;
  private iframe = 0;
  /** Second Wind: invulnerable window left, and when it can trigger again (ctx.time). */
  private guardT = 0;
  /** Inferno flame attack state + burning enemies. */
  private flameCharge = 1;
  private flameT = 0;
  private flameIgniteT = 0;
  /** Burning bots. `storm`: lit by the FIRESTORM (its burns don't refill the meter). */
  private burns = new Map<EnemyHandle, { t: number; tickT: number; storm: boolean }>();
  /** FIRESTORM burning ground: disc mesh, time left, centre, tick timer. */
  private fireField!: THREE.Mesh;
  private fireFieldMat!: THREE.MeshBasicMaterial;
  private fireFieldT = 0;
  private fireFieldX = 0;
  private fireFieldZ = 0;
  private fireFieldTickT = 0;
  /** Ultimate in progress (SUPERCELL / EARTHQUAKE / ORBITAL): elapsed time (-1 = none), centre, steps done, and
   *  how long the meter stays locked. */
  private ultT = -1;
  private ultKind: 'volt' | 'brute' | 'arsenal' = 'volt';
  private ultX = 0;
  private ultZ = 0;
  private ultStep = 0;
  private ultLock = 0;
  private ultMarks: { x: number; z: number; e: EnemyHandle | null }[] = [];
  private secondWindReadyAt = 0;
  /** Largest final damage already applied during the current i-frame window. */
  private iframeDmg = 0;
  private ramCd = new Map<number, number>();
  private queryOut: EnemyHandle[] = [];
  private shardBuf: EnemyHandle[] = [];
  /** Slam Combo (Classic Plow): stacks and when the last slam landed. */
  private comboStacks = 0;
  private lastSlamHitAt = -999;
  private targets: EnemyHandle[] = [];
  private lastFreezeSound = -10;
  private lastBlockSound = -10;
  private pruneT = 0;

  private flameCone: FlameCone;
  /** Lightning bolts (VOLT-9); the Plow also uses this for its coil arcs. */
  readonly lightning: Lightning;
  // VOLT-9 state.
  private clapCharge = 1;
  private clapHeat = 0;
  private lastClapAt = -999;
  private fieldT = 0;
  // BRUTUS state.
  private sawT = 0;
  private idleArcT = 0;
  private chainReadyAt = 0;
  private chainBuf: EnemyHandle[] = [];
  private chainHit = new Set<number>();
  private shield = 0;
  private shieldDelay = 0;
  private stormT = 0;
  private stormX = 0;
  private stormZ = 0;
  private stormStrikes = 0;
  private stormStrikeT = 0;
  private stormTickT = 0;
  // ISOTOPE state: Meltdown recharge, fallout pools (pooled glowing discs), irradiated bots, queued chain blasts.
  private meltCharge = 1;
  private pools: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; x: number; z: number; r: number; t: number; life: number; tickT: number }[] = [];
  private rads = new Map<EnemyHandle, number>();
  private radFxT = 0;
  private auraT = 0;
  private chainQueue: { x: number; z: number }[] = [];
  private critCharge = 0;
  /** Where the NUKE went off (detonate reads it). */
  private nukeX = 0;
  private nukeZ = 0;
  /** BRUTUS Ground Pound: recharge 0..1 and the hop timer (-1 = grounded). */
  private poundCharge = 1;
  private poundT = -1;
  // ARSENAL state: autocannon timer + burst window, tracer pool, laser beam, missile pool + recharge.
  private gunT = 0;
  private gunBurstT = 0;
  private gunSide = 0;
  private tracers: { mesh: THREE.Mesh; t: number }[] = [];
  private laserT = 0;
  private laserTickT = 0;
  private laserCore!: THREE.Mesh;
  private laserGlow!: THREE.Mesh;
  private missileCharge = 1;
  /** Is the autocannon firing this frame (snapshot bit). Laser beam yaw off the nose. */
  private gunsOn = false;
  private laserOff = 0;
  /** Recent damage each bot dealt this pilot (decays; ARSENAL targeting reads it). */
  private threat = new Map<EnemyHandle, number>();
  private threatBuf: EnemyHandle[] = [];
  /** Duel guest: weapon state from host snapshots. netFire < 0 = not a puppet (own input drives the guns);
   *  netTurret NaN = aim locally. */
  private netFire = -1;
  private netLaser = false;
  private netTurret = NaN;
  /** Duel guest: the host's laser bend (NaN = aim locally). */
  private netLaserOff = NaN;
  private missiles: { mesh: THREE.Group; pos: THREE.Vector3; vel: THREE.Vector3; target: EnemyHandle | null; t: number; live: boolean }[] = [];

  constructor(ctx: GameContext, binding?: PilotBinding) {
    this.ctx = ctx;
    this.b = binding ?? ctxPilot(ctx);
    this.flameCone = new FlameCone(ctx.scene);
    this.lightning = new Lightning(ctx.scene);
    const poolGeo = new THREE.CircleGeometry(1, 32);
    poolGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_POOLS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x5dff3a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(poolGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      ctx.scene.add(mesh);
      this.pools.push({ mesh, mat, x: 0, z: 0, r: 1, t: 0, life: 1, tickT: 0 });
    }
    this.buildArsenalFx(ctx.scene);
    this.fireFieldMat = new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.fireField = new THREE.Mesh(poolGeo, this.fireFieldMat);
    this.fireField.visible = false;
    this.fireField.renderOrder = 2;
    ctx.scene.add(this.fireField);
  }

  /** Re-bind to another pilot (the online Duel), or back to the single-player singletons (null). */
  bind(binding: PilotBinding | null): void {
    this.b = binding ?? ctxPilot(this.ctx);
    this.netFire = -1;
    this.netLaser = false;
    this.netTurret = NaN;
    this.netLaserOff = NaN;
    this.threat.clear();
  }

  /** Camera shake: full strength for the local pilot's own combat, a fraction for a duel opponent's. */
  private shake(intensity: number): void {
    this.ctx.fx.shake(this.b.local ? intensity : intensity * REMOTE_SHAKE);
  }

  /** Impact light / camera punch; a duel opponent's impacts never hit-stop this screen. */
  private impactHit(kind: ImpactKind, pos: THREE.Vector3, strength?: number, opts?: ImpactOpts): void {
    this.ctx.impact.hit(kind, pos, strength, this.b.local ? opts : REMOTE_IMPACT);
  }

  /* ------------------------------------------------------------------ duel netcode */

  /** Pack F-ability charge, Battery Shield, Critical Mass and Overload heat at `o` (NP layout, net/protocol.ts). */
  writeNet(out: Float32Array, o: number): void {
    out[o + NP.fReady] = this.flameReady;
    out[o + NP.shield] = this.shield;
    out[o + NP.crit] = this.critCharge;
    out[o + NP.heat] = this.heatNow();
    out[o + NP.flameT] = this.flameT;
    out[o + NP.poundT] = this.poundT;
    out[o + NP.stormT] = this.stormT;
    out[o + NP.fire] = (this.gunsOn ? 1 : 0) | (this.laserT > 0 ? 2 : 0);
    out[o + NP.turret] = this.b.plow ? this.b.plow.turretAim : 0;
    out[o + NP.laser] = this.laserOff;
  }

  /** Duel guest, the opponent's puppet: follow the host's autocannon / laser / turret (visuals only). */
  readPuppet(s: Float32Array, o: number): void {
    const bits = Math.round(s[o + NP.fire]);
    this.netFire = bits;
    this.netTurret = s[o + NP.turret];
    this.netLaserOff = s[o + NP.laser];
    const laser = (bits & 2) !== 0;
    if (laser && !this.netLaser && this.laserT <= 0) this.fireLaser();
    this.netLaser = laser;
  }

  /** Duel guest, own plow: adopt the host's meters. `keepF`: the pilot just pressed F locally (keep the prediction). */
  readNet(s: Float32Array, o: number, keepF: boolean): void {
    const f = s[o + NP.fReady];
    if (!keepF && f >= 0) {
      const kind = this.b.stats.plowKind;
      if (kind === 'volt') this.clapCharge = f;
      else if (kind === 'brute') {
        if (this.poundT < 0) this.poundCharge = f;
      } else if (kind === 'isotope') this.meltCharge = f;
      else if (kind === 'arsenal') this.missileCharge = f;
      else if (this.flameT <= 0) this.flameCharge = f;
    }
    this.shield = s[o + NP.shield];
    this.critCharge = s[o + NP.crit];
    this.clapHeat = s[o + NP.heat];
    this.lastClapAt = this.ctx.time;
    // The guest hits nothing locally, so its turret follows the host's aim.
    this.netTurret = s[o + NP.turret];
    this.netLaserOff = s[o + NP.laser];
  }

  /** Duel guest, the opponent's puppet: re-arm the F ability so the replayed press fires it (visuals only — this
   *  Combat's targets are empty). `nuke`: ISOTOPE's Critical Mass was full, so it is the NUKE. */
  armForReplay(nuke: boolean): void {
    this.clapCharge = this.poundCharge = this.meltCharge = this.flameCharge = this.missileCharge = 1;
    this.flameT = 0;
    if (this.poundT >= 0) this.b.plow.hop = 0;
    this.poundT = -1;
    this.critCharge = nuke ? 1 : 0;
    this.clapHeat = 0;
  }

  /** ISOTOPE Critical Mass, or the Classic Plow's FIRESTORM meter (same slot: both mean "the next F is the ultimate"). */
  get critMass(): number {
    const st = this.b.stats;
    if (st.meltDamage > 0) return this.critCharge;
    if (st.plowKind === 'classic') return st.flameDps > 0 ? this.critCharge : -1;
    if (st.plowKind === 'volt') return st.clapDamage > 0 ? this.critCharge : -1;
    if (st.plowKind === 'brute') return st.poundDamage > 0 ? this.critCharge : -1;
    if (st.plowKind === 'arsenal') return st.missileDamage > 0 ? this.critCharge : -1;
    return -1;
  }

  get shieldFrac(): number {
    const max = this.b.stats.shieldMax;
    return max > 0 ? this.shield / max : -1;
  }

  /* ------------------------------------------------------------------ VOLT-9 */

  /** Chain Lightning: a hit on `from` arcs to the nearest other bots (hop by hop). `heal` is inherited from the
   *  triggering hit (arcs off a Thunderclap don't feed Salvage Rig either). */
  private chainLightning(from: EnemyHandle, dealt: number, heal = true): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    if (ctx.time < this.chainReadyAt) return;
    this.chainReadyAt = ctx.time + 0.2;
    this.chainHit.clear();
    this.chainHit.add(from.id);
    let src = from;
    const dmg = Math.max(6 * st.damageMult, dealt * st.chainFrac);
    for (let hop = 0; hop < st.chainCount; hop++) {
      const near = this.b.enemies.query(src.position.x, src.position.z, 9, this.chainBuf);
      let best: EnemyHandle | null = null;
      let bd = Infinity;
      for (const e of near) {
        if (!e.alive || this.chainHit.has(e.id)) continue;
        const d = Math.hypot(e.position.x - src.position.x, e.position.z - src.position.z);
        if (d < bd) {
          bd = d;
          best = e;
        }
      }
      if (!best) break;
      this.chainHit.add(best.id);
      _p.set(src.position.x, src.position.y + src.radius + 0.6, src.position.z);
      _q.set(best.position.x, best.position.y + best.radius + 0.6, best.position.z);
      this.lightning.bolt(_p, _q, { life: 0.22, width: 0.3 });
      const hp0 = best.hp;
      const killed = this.b.enemies.damage(best, dmg * this.hitMult(best), { source: 'other', freezeSeconds: 0.4, fromX: best.position.x, fromZ: best.position.z });
      const d2 = Math.max(0, hp0 - Math.max(0, best.hp));
      this.onPlayerHit(d2, killed, best, false, heal);
      if (d2 > 0) ctx.fx.floatText(_q, `⚡${Math.round(d2)}`, '#7fdcff', 0.8);
      ctx.fx.burst(_q, { color: 0x9fe8ff, count: 8, speed: 6, size: 0.08, gravity: 10, life: 0.3 });
      src = best;
    }
    if (this.chainHit.size > 1) this.b.audio.play('zap', { pitch: 1.1 });
  }

  /** Tesla Field: passive shock aura around the plow. */
  private updateField(dt: number): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const plow = this.b.plow;
    if (st.fieldDps <= 0 || !plow || plow.dead) return;
    const R = st.fieldRadius;
    // Idle crackle so the field reads even with nobody in it.
    this.idleArcT -= dt;
    if (this.idleArcT <= 0) {
      this.idleArcT = 0.12 + Math.random() * 0.2;
      const a = Math.random() * Math.PI * 2;
      const r = R * (0.5 + Math.random() * 0.5);
      _p.set(plow.position.x, 1.6, plow.position.z);
      _q.set(plow.position.x + Math.sin(a) * r, 0.15, plow.position.z + Math.cos(a) * r);
      this.lightning.bolt(_p, _q, { life: 0.1, width: 0.12, jag: 0.5, color: 0x3fa8ff });
    }
    this.fieldT -= dt;
    if (this.fieldT > 0) return;
    const TICK = 0.4;
    this.fieldT = TICK;
    const hits = this.b.enemies.query(plow.position.x, plow.position.z, R, this.chainBuf);
    let any = false;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      any = true;
      _p.set(plow.position.x, 1.8, plow.position.z);
      _q.set(e.position.x, e.position.y + e.radius * 0.8, e.position.z);
      this.lightning.bolt(_p, _q, { life: 0.14, width: 0.18 });
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, st.fieldDps * st.damageMult * TICK * this.hitMult(e), { source: 'other', fromX: e.position.x, fromZ: e.position.z });
      this.onPlayerHit(Math.max(0, hp0 - Math.max(0, e.hp)), killed, e, false, false);
    }
    if (any) this.b.audio.play('zap', { volume: 0.35, pitch: 1.4 });
  }

  /** Buzzsaws (BRUTUS): the saws on the blade ends grind every bot in the front arc (BRUTUS's Tesla Field). */
  private updateSaws(dt: number): void {
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
    const hits = this.b.enemies.query(plow.position.x, plow.position.z, R, this.chainBuf);
    let any = false;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
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

  /** Thunderclap (F on VOLT-9): lightning blast around the plow — damage, shock-slow and knockback. */
  private updateClap(dt: number): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const plow = this.b.plow;
    if (st.clapDamage <= 0 || !plow) return;
    if (this.clapCharge < 1) this.clapCharge = Math.min(1, this.clapCharge + (st.clapCooldown > 0 ? dt / st.clapCooldown : 1));
    if (!this.b.input.wasPressed('KeyF') || plow.dead) return;
    if (this.critCharge >= 1 && this.ultT < 0) return this.startUlt('volt', plow);
    if (this.clapCharge < 1) {
      this.b.audio.play('error');
      return;
    }
    this.clapCharge = 0;
    this.b.events.emit('ability', { nuke: false });
    this.clapBacklash(plow);
    const R = st.clapRadius;
    const px = plow.position.x;
    const pz = plow.position.z;
    // Sky strike onto the plow + ground rings.
    _p.set(px, 26, pz);
    _q.set(px, 1.2, pz);
    this.lightning.bolt(_p, _q, { life: 0.35, width: 0.7, jag: 2.2, color: 0x9fe8ff });
    _q.set(px, 0.1, pz);
    ctx.fx.ring(_q, R, 0x7fdcff);
    ctx.fx.ring(_q, R * 0.6, 0xffffff);
    ctx.fx.ring(_q, R * 1.15, 0x2fb8ff);
    ctx.fx.sparks(_q, null, { color: 0x9fe8ff, count: 40, speed: 16, size: 0.08, length: 0.05, gravity: 8, life: 0.5 });
    ctx.fx.burst(_q, { color: 0xffffff, count: 24, speed: 8, size: 0.3, gravity: 10, life: 0.6 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
      _p.set(px, 1.8, pz);
      _q.set(px + Math.sin(a) * R, 0.2, pz + Math.cos(a) * R);
      this.lightning.bolt(_p, _q, { life: 0.25, width: 0.22, jag: 1.1 });
    }
    this.shake(0.8);
    this.impactHit('clap', _q.set(px, 1, pz));
    this.b.audio.play('thunder');
    this.smashProps(px, pz, R);
    const hits = this.collect(px, pz, R);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      let dx = e.position.x - px;
      let dz = e.position.z - pz;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d;
      dz /= d;
      _p.set(px, 2, pz);
      _q.set(e.position.x, e.position.y + e.radius, e.position.z);
      this.lightning.bolt(_p, _q, { life: 0.3, width: 0.35 });
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, st.clapDamage * st.damageMult * this.hitMult(e), {
        source: 'other',
        knockback: new THREE.Vector3(dx * 14, 0, dz * 14),
        freezeSeconds: st.clapStun,
        fromX: px,
        fromZ: pz,
      });
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      this.onPlayerHit(dealt, killed, e, true, false);
      if (dealt > 0) ctx.fx.floatText(_q, `⚡${Math.round(dealt)}`, '#bff0ff', 1.15);
    }
    this.targets.length = 0;
    // The storm: a volley of extra sky strikes across the area, then an electrified field.
    this.stormX = px;
    this.stormZ = pz;
    this.stormT = STORM_SECONDS;
    this.stormStrikes = STORM_STRIKES;
    this.stormStrikeT = 0.12;
    this.stormTickT = 0.25;
  }

  /** Ground Pound (F on BRUTUS): the plow hops, then slams down — a snow shockwave that damages, stuns and hurls
   *  every bot in the ring outward. */
  private updatePound(dt: number): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const plow = this.b.plow;
    // Plow keeps its body pose private; the hop height goes through a narrow duck-typed view.
    const hopper = plow as unknown as { hop: number } | undefined;
    if (st.poundDamage <= 0 || !plow || plow.dead) {
      if (this.poundT >= 0 && hopper) hopper.hop = 0;
      this.poundT = -1;
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
    if (this.critCharge >= 1 && this.ultT < 0) return this.startUlt('brute', plow);
    if (this.poundCharge < 1) {
      this.b.audio.play('error');
      return;
    }
    this.poundCharge = 0;
    this.poundT = 0;
    this.b.events.emit('ability', { nuke: false });
    _q.set(plow.position.x, 0.1, plow.position.z);
    ctx.fx.burst(_q, { color: 0xffffff, count: 14, speed: 4, size: 0.2, gravity: 10, life: 0.4 });
    this.b.audio.play('dash', { volume: 0.5, pitch: 0.6 });
  }

  private poundImpact(plow: PlowAPI): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const R = st.poundRadius * POUND_LEAP_RADIUS;
    const px = plow.position.x;
    const pz = plow.position.z;
    // Snow shockwave: stacked rings, a central blast and snow sprays thrown out along the rim.
    _q.set(px, 0.1, pz);
    ctx.fx.ring(_q, R * 0.45, 0xffffff);
    ctx.fx.ring(_q, R, 0xdff2ff);
    ctx.fx.ring(_q, R * 1.12, 0xffc21a);
    ctx.fx.burst(_q, { color: 0xffffff, count: 46, speed: 15, size: 0.26, gravity: 18, life: 0.7 });
    ctx.fx.burst(_q, { color: 0xbfe6ff, count: 24, speed: 9, size: 0.14, gravity: 12, life: 0.55 });
    ctx.fx.burst(_q, { color: 0x6b7280, count: 12, speed: 6, size: 0.18, gravity: 22, life: 0.5 });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
      const rr = R * (0.55 + Math.random() * 0.4);
      _q.set(px + Math.sin(a) * rr, 0.3, pz + Math.cos(a) * rr);
      ctx.fx.burst(_q, { color: 0xffffff, count: 6, speed: 6, size: 0.24, gravity: 16, life: 0.55 });
    }
    this.shake(0.9);
    this.impactHit('pound', _q.set(px, 0.5, pz));
    this.b.audio.play('thud');
    this.smashProps(px, pz, R);
    const hits = this.collect(px, pz, R);
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
      const killed = this.b.enemies.damage(e, st.poundDamage * POUND_LEAP_DMG * st.damageMult * fall * this.hitMult(e), {
        source: 'other',
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
    this.targets.length = 0;
  }

  /** The clap shocks its own pilot: flat damage squared by Overload heat, bypassing the Battery Shield, i-frames
   *  and Second Wind. Can't kill on its own (stops at 1 HP) but leaves spammers fragile. */
  private clapBacklash(plow: PlowAPI): void {
    const ctx = this.ctx;
    this.clapHeat = this.heatNow();
    this.lastClapAt = ctx.time;
    const dmg = Math.min(plow.hp - 1, CLAP_BACKLASH * (1 + this.clapHeat) ** 2);
    this.clapHeat += 1;
    if (dmg <= 0) return;
    plow.damage(dmg);
    _q.set(plow.position.x, 3.2, plow.position.z);
    ctx.fx.floatText(_q, `-${Math.round(dmg)} ⚡OVERLOAD`, this.clapHeat > 1.5 ? '#ff7a5a' : '#ffd27a', 0.95);
  }

  /** Overload heat right now: the stored heat minus what has bled off since the last clap. */
  private heatNow(): number {
    return Math.max(0, this.clapHeat - (this.ctx.time - this.lastClapAt) / CLAP_HEAT_DECAY);
  }

  get overloadHeat(): number {
    return this.b.stats.plowKind === 'volt' && this.b.stats.clapDamage > 0 ? this.heatNow() : -1;
  }

  get overloadCost(): number {
    if (this.overloadHeat < 0) return 0;
    const plow = this.b.plow;
    return Math.max(0, Math.min(plow.hp - 1, CLAP_BACKLASH * (1 + this.heatNow()) ** 2));
  }

  /** After a Thunderclap: sky strikes rain down over the radius, and the ground stays electrified. */
  private updateStorm(dt: number): void {
    if (this.stormT <= 0) return;
    const ctx = this.ctx;
    const st = this.b.stats;
    this.stormT -= dt;
    const R = st.clapRadius;
    const dmgBase = st.clapDamage * st.damageMult;
    // Sky strikes: each one hammers a 3.5m circle. Prefer landing on bots inside the storm.
    this.stormStrikeT -= dt;
    if (this.stormStrikes > 0 && this.stormStrikeT <= 0) {
      this.stormStrikes--;
      this.stormStrikeT = 0.14;
      const near = this.b.enemies.query(this.stormX, this.stormZ, R, this.chainBuf);
      let sx: number;
      let sz: number;
      if (near.length && Math.random() < 0.75) {
        const t = near[Math.floor(Math.random() * near.length)];
        sx = t.position.x + (Math.random() - 0.5) * 1.5;
        sz = t.position.z + (Math.random() - 0.5) * 1.5;
      } else {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * R;
        sx = this.stormX + Math.sin(a) * r;
        sz = this.stormZ + Math.cos(a) * r;
      }
      _p.set(sx + (Math.random() - 0.5) * 4, 24, sz + (Math.random() - 0.5) * 4);
      _q.set(sx, 0.2, sz);
      this.lightning.bolt(_p, _q, { life: 0.3, width: 0.55, jag: 1.8, color: 0x9fe8ff });
      ctx.fx.ring(_q, 3.5, 0x7fdcff);
      ctx.fx.burst(_q, { color: 0xbff0ff, count: 18, speed: 9, size: 0.1, gravity: 10, life: 0.4 });
      this.b.audio.play('zap', { pitch: 0.7 + Math.random() * 0.3 });
      const hits = this.b.enemies.query(sx, sz, 3.5, this.chainBuf);
      for (let i = 0; i < hits.length; i++) {
        const e = hits[i];
        if (!e.alive) continue;
        const hp0 = e.hp;
        const killed = this.b.enemies.damage(e, dmgBase * STORM_STRIKE_FRAC * this.hitMult(e), { source: 'other', freezeSeconds: 0.6, fromX: sx, fromZ: sz });
        const d = Math.max(0, hp0 - Math.max(0, e.hp));
        this.onPlayerHit(d, killed, e, false, false);
        _q.set(e.position.x, e.position.y + e.radius + 1, e.position.z);
        if (d > 0) ctx.fx.floatText(_q, `⚡${Math.round(d)}`, '#bff0ff', 0.95);
      }
    }
    // Electrified ground: arcs crawl across it and zap everything inside.
    if (Math.random() < dt * 20) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * R;
      _p.set(this.stormX + Math.sin(a) * r, 0.15, this.stormZ + Math.cos(a) * r);
      const b = a + (Math.random() - 0.5) * 1.5;
      _q.set(_p.x + Math.sin(b) * 3, 0.15, _p.z + Math.cos(b) * 3);
      this.lightning.bolt(_p, _q, { life: 0.12, width: 0.14, jag: 0.6, color: 0x3fa8ff });
    }
    this.stormTickT -= dt;
    if (this.stormTickT <= 0) {
      this.stormTickT = 0.5;
      const hits = this.b.enemies.query(this.stormX, this.stormZ, R, this.chainBuf);
      for (let i = 0; i < hits.length; i++) {
        const e = hits[i];
        if (!e.alive) continue;
        const hp0 = e.hp;
        const killed = this.b.enemies.damage(e, dmgBase * STORM_FIELD_FRAC * 0.5 * this.hitMult(e), { source: 'other', freezeSeconds: 0.6, fromX: e.position.x, fromZ: e.position.z });
        this.onPlayerHit(Math.max(0, hp0 - Math.max(0, e.hp)), killed, e, false, false);
        _p.set(this.stormX, 0.3, this.stormZ);
        _q.set(e.position.x, e.position.y + e.radius * 0.6, e.position.z);
        this.lightning.bolt(_p, _q, { life: 0.12, width: 0.16, jag: 0.8, color: 0x3fa8ff });
      }
    }
  }

  /** Battery Shield recharge (3s after the last hit, 25% of capacity per second). */
  private updateShield(dt: number): void {
    const max = this.b.stats.shieldMax;
    if (max <= 0) {
      this.shield = 0;
      return;
    }
    if (this.shield > max) this.shield = max;
    if (this.shieldDelay > 0) this.shieldDelay -= dt;
    else if (this.shield < max) this.shield = Math.min(max, this.shield + max * 0.25 * dt);
  }

  /** Multiplier on the player's hits against `e`: burning bots take BURN_VULN x, and Last Stand adds its bonus. */
  private hitMult(e: EnemyHandle): number {
    return (this.burns.has(e) ? BURN_VULN : 1) * (this.rads.has(e) ? RAD_VULN : 1) * this.lastStandMult();
  }

  /** Last Stand (pilot perk): 1 + bonus while the plow is under LAST_STAND_HP, else 1. */
  private lastStandMult(): number {
    const plow = this.b.plow;
    const bonus = this.b.stats.lastStand;
    return bonus > 0 && plow.hp < plow.maxHp * LAST_STAND_HP ? 1 + bonus : 1;
  }

  /* ------------------------------------------------------------------ bots -> plow */

  hitPlow(amount: number, fromX: number, fromZ: number, opts?: { knockback?: number; unblockable?: boolean; direct?: 'round' | 'beam'; attacker?: EnemyHandle }): number {
    const ctx = this.ctx;
    const plow = this.b.plow;
    const stats = this.b.stats;
    // Mid Ground Pound leap: out of reach until the slam lands.
    if (!plow || plow.dead || amount <= 0 || plow.invulnerable || this.guardT > 0 || this.poundT >= 0) return 0;

    // Direction plow -> attacker.
    let dx = fromX - plow.position.x;
    let dz = fromZ - plow.position.z;
    let d = Math.hypot(dx, dz);
    plow.getForward(_fwd);
    if (d < 1e-4) {
      dx = _fwd.x;
      dz = _fwd.z;
      d = 1;
    }
    dx /= d;
    dz /= d;

    // 1) Ball shield on frontal hits.
    let dmg = amount;
    let blocked = 0;
    const r = plow.heldBallRadius;
    if (!opts?.unblockable && r >= SHIELD_MIN_R && dx * _fwd.x + dz * _fwd.z >= SHIELD_COS) {
      blocked = dmg * stats.shieldBlock;
      dmg -= blocked;
      const vol = ballVolume(r);
      if (vol > 0) plow.stealSnow(Math.min(1, (blocked * BLOCK_SNOW_PER_DMG) / vol));
    }
    // 2) Dash halves damage, whirling takes 30% less. 3) Plating, Iron Hide (scaled by speed), Last Stand.
    if (plow.dashing) dmg *= 0.5;
    if (plow.whirling) dmg *= 0.7;
    dmg *= stats.damageTaken;
    if (stats.ironHide < 1) {
      const roll = THREE.MathUtils.clamp(Math.abs(plow.speed) / (stats.maxSpeed * IRON_HIDE_SPEED), 0, 1);
      dmg *= 1 - (1 - stats.ironHide) * (IRON_HIDE_IDLE + (1 - IRON_HIDE_IDLE) * roll);
    }
    const lastStandBefore = this.lastStandMult() > 1;
    if (lastStandBefore) dmg *= 1 - stats.lastStand * 0.5;
    // Battery Shield (VOLT-9) soaks damage before HP.
    if (this.shield > 0 && dmg > 0) {
      const soak = Math.min(this.shield, dmg);
      this.shield -= soak;
      dmg -= soak;
      _q.set(plow.position.x, 2.6, plow.position.z);
      ctx.fx.burst(_q, { color: 0x7fdcff, count: 10, speed: 5, size: 0.12, gravity: 4, life: 0.4 });
      if (soak >= 3) ctx.fx.floatText(_q, `🔋${Math.round(soak)}`, '#7fdcff', 0.75);
      if (this.shield <= 0) this.b.audio.play('zap', { pitch: 0.6 });
    }
    if (stats.shieldMax > 0) this.shieldDelay = 3;

    // i-frames: overlapping hits only deal what exceeds the biggest hit of the window. Direct weapon fire (ARSENAL
    // rounds / laser ticks) neither opens a window nor is eaten by one.
    let final = dmg;
    if (opts?.direct) {
      /* full damage */
    } else if (this.iframe > 0) {
      final = Math.max(0, dmg - this.iframeDmg);
      this.iframeDmg = Math.max(this.iframeDmg, dmg);
    } else {
      this.iframe = IFRAME_SECONDS;
      this.iframeDmg = dmg;
    }

    // Second Wind (pilot perk): a lethal hit leaves 1 HP and a short invulnerable window instead.
    if (final >= plow.hp && plow.hp > 1 && Number.isFinite(stats.secondWindCd) && ctx.time >= this.secondWindReadyAt) {
      final = Math.max(0, plow.hp - 1);
      this.secondWindReadyAt = ctx.time + stats.secondWindCd;
      this.guardT = SECOND_WIND_GUARD;
      _q.set(plow.position.x, 3.4, plow.position.z);
      ctx.fx.floatText(_q, 'SECOND WIND!', '#9fe6ff', 1.3);
      _q.set(plow.position.x, 0.1, plow.position.z);
      ctx.fx.ring(_q, 6, 0x9fe6ff);
      this.shake(0.5);
      this.b.audio.play('respawn');
    }
    if (final > 0) {
      plow.damage(final);
      plow.feedSawFury(0, final);
      if (!lastStandBefore && !plow.dead && this.lastStandMult() > 1) {
        _q.set(plow.position.x, 3.8, plow.position.z);
        ctx.fx.floatText(_q, 'LAST STAND!', '#ff6a3a', 1.2);
        _q.set(plow.position.x, 0.1, plow.position.z);
        ctx.fx.ring(_q, 5, 0xff6a3a);
      }
    }

    // Knockback away from the attacker (shield absorbs some of it).
    const kb = (opts?.knockback ?? 6) * (blocked > 0 ? 0.75 : 1);
    plow.push(-dx * kb, -dz * kb);

    // Feedback.
    const fx = ctx.fx;
    const audio = this.b.audio;
    _p.set(plow.position.x + dx * 1.5, 1.1, plow.position.z + dz * 1.5);
    if (blocked > 0) {
      plow.getBladeTip(_tip);
      const br = Math.max(r, 0.3);
      _q.set(_tip.x + _fwd.x * br, br + (this.b.snow ? this.b.snow.getDepth(_tip.x, _tip.z) : 0), _tip.z + _fwd.z * br);
      fx.burst(_q, { color: 0xffffff, count: 10 + Math.round(blocked * 0.6), speed: 5, size: 0.22, gravity: 16, life: 0.6 });
      fx.burst(_q, { color: 0xbfe6ff, count: 6, speed: 3, size: 0.14, gravity: 8, life: 0.5 });
      if (ctx.time - this.lastBlockSound > 0.08) {
        this.lastBlockSound = ctx.time;
        audio.play('block', { volume: Math.min(1, 0.5 + blocked * 0.03) });
      }
      _q.y += 1.2;
      fx.floatText(_q, 'BLOCK', '#9fe6ff', 0.75);
    }
    if (final > 0) {
      if (blocked <= 0) {
        fx.burst(_p, { color: 0xffa23a, count: 10 + Math.round(Math.min(20, final)), speed: 8, size: 0.09, gravity: 22, life: 0.4 });
        fx.burst(_p, { color: 0x8c96a4, count: 5 + Math.round(Math.min(8, final * 0.3)), speed: 4.5, size: 0.17, gravity: 20, life: 0.7 });
      }
      this.shake(THREE.MathUtils.clamp(0.15 + final * 0.016, 0.15, 0.6));
      if (this.b.local) ctx.impact.playerHit(final, fromX, fromZ);
      audio.play('plowHit', { volume: Math.min(1, (blocked > 0 ? 0.35 : 0.55) + final * 0.02), pitch: THREE.MathUtils.clamp(1.15 - final * 0.01, 0.75, 1.15) });
      _q.set(plow.position.x, 2.8, plow.position.z);
      fx.floatText(_q, `-${Math.round(final)}`, '#ff5a4a', 0.8 + Math.min(0.6, final * 0.015));
    } else if (blocked > 0) {
      this.shake(0.12);
    }

    if (final > 0) {
      const a = opts?.attacker;
      if (a) this.threat.set(a, (this.threat.get(a) ?? 0) + final);
      else this.noteThreat(fromX, fromZ, final);
    }
    this.b.events.emit('plowDamaged', { amount: final, blocked });
    return final;
  }

  /** Credit `dmg` to the bot nearest to where a hit came from, for callers that don't name the attacker (ARSENAL
   *  picks its targets by this). */
  private noteThreat(fromX: number, fromZ: number, dmg: number): void {
    const enemies = this.b.enemies;
    if (!enemies) return;
    const q = enemies.query(fromX, fromZ, THREAT_RADIUS, this.threatBuf);
    let best: EnemyHandle | null = null;
    let bestD = Infinity;
    for (let i = 0; i < q.length; i++) {
      const e = q[i];
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - fromX, e.position.z - fromZ) - e.radius;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (best) this.threat.set(best, (this.threat.get(best) ?? 0) + dmg);
  }

  private updateThreat(dt: number): void {
    if (this.threat.size === 0) return;
    const k = Math.exp(-dt / THREAT_TAU);
    for (const [e, v] of this.threat) {
      const nv = v * k;
      if (!e.alive || nv < 0.5) this.threat.delete(e);
      else this.threat.set(e, nv);
    }
  }

  /** Recent damage `e` dealt this pilot. */
  threatOf(e: EnemyHandle): number {
    return this.threat.get(e) ?? 0;
  }

  /** ARSENAL target priority: bots that have been hurting you first, then wounded ones, then close ones. */
  private targetScore(e: EnemyHandle, x: number, z: number): number {
    const d = Math.hypot(e.position.x - x, e.position.z - z);
    return 3 * this.threatOf(e) + 10 * (1 - Math.max(0, e.hp) / Math.max(1, e.maxHp)) + 20 / (1 + d / 10);
  }

  /* ------------------------------------------------------------------ plow -> bots */

  playerRam(enemy: EnemyHandle, closingSpeed: number): number {
    const ctx = this.ctx;
    const plow = this.b.plow;
    const stats = this.b.stats;
    if (!plow || plow.dead || !enemy.alive) return 0;
    const until = this.ramCd.get(enemy.id);
    if (until !== undefined && until > ctx.time) return 0;
    const dashing = plow.dashing;
    if (dashing) return this.dashStrike(enemy);
    this.ramCd.set(enemy.id, ctx.time + RAM_REPEAT);

    const r = plow.heldBallRadius;
    const dmg =
      (stats.ramDamage * THREE.MathUtils.clamp(closingSpeed / 10, 0.3, 1.8) + (r > 0 ? 6 * r * r * stats.damageMult : 0)) *
      (1 + stats.momentum * THREE.MathUtils.clamp(closingSpeed, 0, MOMENTUM_SPEED_CAP));

    // Knockback along the ram: blend of plow forward and plow->enemy.
    plow.getForward(_fwd);
    let dx = enemy.position.x - plow.position.x;
    let dz = enemy.position.z - plow.position.z;
    const d = Math.hypot(dx, dz) || 1;
    dx = dx / d + _fwd.x;
    dz = dz / d + _fwd.z;
    const n = Math.hypot(dx, dz) || 1;
    const k = 4 + Math.max(0, closingSpeed) * 0.9;
    const knock = new THREE.Vector3((dx / n) * k, 0, (dz / n) * k);

    const hp0 = enemy.hp;
    const killed = this.b.enemies.damage(enemy, dmg * this.hitMult(enemy), {
      source: 'ram',
      knockback: knock,
      fromX: plow.position.x,
      fromZ: plow.position.z,
      ballRadius: r,
    });
    // Show what actually landed (after armor / Brawl's hit cap), not the raw number.
    const dealt = Math.max(0, hp0 - Math.max(0, enemy.hp));
    this.onPlayerHit(dealt, killed, enemy);

    // Ball sheds snow on impact.
    if (r > 0) plow.stealSnow(0.1);

    // Feedback at the contact point.
    const fx = ctx.fx;
    _p.set(
      (plow.position.x + _fwd.x * 2.4 + enemy.position.x) * 0.5,
      0.9,
      (plow.position.z + _fwd.z * 2.4 + enemy.position.z) * 0.5,
    );
    fx.sparks(_p, _fwd, { color: 0xffc04a, count: 10 + Math.round(Math.min(18, closingSpeed)), speed: 8 + closingSpeed * 0.35, spread: 0.85, gravity: 22, life: 0.35 });
    fx.burst(_p, { color: 0x9aa4b0, count: 4, speed: 4, size: 0.16, gravity: 20, life: 0.6 });
    if (r > 0) fx.burst(_p, { color: 0xffffff, count: 6, speed: 3.5, size: 0.18, gravity: 14, life: 0.6 });
    this.shake(Math.min(0.4, 0.1 + closingSpeed * 0.015));
    this.b.audio.play('ram', { volume: Math.min(1, 0.45 + closingSpeed * 0.04) });
    _q.set(enemy.position.x, enemy.position.y + enemy.radius + 1, enemy.position.z);
    if (dealt > 0) fx.floatText(_q, `${Math.round(dealt)}`, killed ? '#fff3a0' : '#ffffff', 0.8 + Math.min(0.5, dealt * 0.01));
    return dmg;
  }

  /** DASH STRIKE: the dashing plow hits a bot like a truck. The dash keeps going (80% speed). */
  private dashStrike(enemy: EnemyHandle): number {
    const ctx = this.ctx;
    const plow = this.b.plow;
    const stats = this.b.stats;
    // Long cooldown: one strike per bot per dash.
    this.ramCd.set(enemy.id, ctx.time + DASH_STRIKE_REPEAT);
    const r = plow.heldBallRadius;
    const dmg =
      (25 + stats.ramDamage * 1.8 + (r > 0 ? 6 * r * r * stats.damageMult : 0)) *
      (1 + stats.momentum * Math.min(Math.abs(plow.speed), MOMENTUM_SPEED_CAP));

    plow.getForward(_fwd);
    let dx = enemy.position.x - plow.position.x;
    let dz = enemy.position.z - plow.position.z;
    const d = Math.hypot(dx, dz) || 1;
    dx = dx / d + _fwd.x * 1.5;
    dz = dz / d + _fwd.z * 1.5;
    const n = Math.hypot(dx, dz) || 1;
    const knock = new THREE.Vector3((dx / n) * DASH_KNOCK, 0, (dz / n) * DASH_KNOCK);

    const hp0 = enemy.hp;
    const killed = this.b.enemies.damage(enemy, dmg * this.hitMult(enemy), {
      source: 'ram',
      knockback: knock,
      fromX: plow.position.x,
      fromZ: plow.position.z,
      ballRadius: r,
    });
    const dealt = Math.max(0, hp0 - Math.max(0, enemy.hp));
    this.onPlayerHit(dealt, killed, enemy);
    if (r > 0) plow.stealSnow(0.1);

    // Hit-stop (plow + camera) and keep the dash going through the target.
    (plow as unknown as { dashImpact?: (stop: number) => void }).dashImpact?.(DASH_HITSTOP);
    if (this.b.local) (ctx.cameraRig as unknown as { hitStop?: (s: number) => void }).hitStop?.(DASH_HITSTOP);

    const fx = ctx.fx;
    _p.set(
      (plow.position.x + _fwd.x * 2.4 + enemy.position.x) * 0.5,
      1.0,
      (plow.position.z + _fwd.z * 2.4 + enemy.position.z) * 0.5,
    );
    fx.sparks(_p, _fwd, { color: 0xffa02a, count: 40, speed: 18, spread: 0.7, size: 0.09, length: 0.04, gravity: 20, life: 0.5 });
    fx.sparks(_p, null, { color: 0xfff0a0, count: 14, speed: 10, size: 0.07, gravity: 26, life: 0.3 });
    fx.burst(_p, { color: 0xffffff, count: 26, speed: 7, size: 0.28, gravity: 12, life: 0.8 });
    fx.burst(_p, { color: 0x9aa4b0, count: 8, speed: 5, size: 0.2, gravity: 18, life: 0.7 });
    _q.set(_p.x, 0.05, _p.z);
    fx.ring(_q, 3.2, 0xff9a2a);
    this.shake(0.5);
    this.b.audio.play('dashStrike');
    _q.set(enemy.position.x, enemy.position.y + enemy.radius + 1.4, enemy.position.z);
    fx.floatText(_q, dealt > 0 ? `DASH! ${Math.round(dealt)}` : 'DASH!', killed ? '#fff3a0' : '#ff9a2a', 1.35);
    return dmg;
  }

  /** SPACE slam impact centered at (x, z) with a ball of radius `r` (volume `volume` m^3, already consumed
   *  by the plow). Damages every bot in the zone, shatters the ball. Returns the number of bots hit. */
  slamAt(x: number, z: number, r: number, volume: number): number {
    const ctx = this.ctx;
    const stats = this.b.stats;
    const plow = this.b.plow;
    const fx = ctx.fx;
    const avalanche = stats.avalancheCore;
    const zone = (r * 1.3 + stats.bladeWidth * 0.35) * (avalanche ? 1.5 : 1);
    // Slam Combo (Classic Plow): stacks from slams that landed recently.
    if (ctx.time - this.lastSlamHitAt > COMBO_WINDOW) this.comboStacks = 0;
    const combo = stats.comboStep > 0 ? this.comboStacks : 0;
    const dmg = SLAM_DAMAGE_K * r * r * stats.damageMult * (1 + stats.comboStep * combo);
    const knockMag = (10 + 6 * r) * (avalanche ? 1.6 : 1);
    const freeze = stats.frostCore ? 3 : 0;

    plow.getForward(_fwd);
    this.smashProps(x, z, zone);
    const hits = this.collect(x, z, zone);
    let count = 0;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      let dx = e.position.x - plow.position.x;
      let dz = e.position.z - plow.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-3) {
        dx = _fwd.x;
        dz = _fwd.z;
      } else {
        dx /= d;
        dz /= d;
      }
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, dmg * this.hitMult(e), {
        source: 'slam',
        knockback: new THREE.Vector3(dx * knockMag, 0, dz * knockMag),
        freezeSeconds: freeze,
        fromX: plow.position.x,
        fromZ: plow.position.z,
        ballRadius: r,
      });
      count++;
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      this.onPlayerHit(dealt, killed, e);
      _q.set(e.position.x, e.position.y + e.radius + 1.2, e.position.z);
      if (dealt > 0) fx.floatText(_q, `${Math.round(dealt)}`, freeze ? '#9fe6ff' : killed ? '#fff3a0' : '#ffffff', 1 + Math.min(1, r * 0.4));
      _q.set(e.position.x, 1, e.position.z);
      fx.burst(_q, { color: freeze ? 0xbfeaff : 0xffffff, count: 8, speed: 5, size: 0.2, gravity: 16, life: 0.6 });
    }
    if (stats.shardFrac > 0) this.shatter(x, z, zone, dmg, hits);
    this.targets.length = 0;
    if (count > 0 && stats.comboStep > 0) {
      this.lastSlamHitAt = ctx.time;
      this.comboStacks = Math.min(COMBO_MAX, this.comboStacks + 1);
      if (combo > 0) {
        _q.set(x, 3.2 + r, z);
        fx.floatText(_q, `COMBO x${combo + 1}`, '#ffb340', 0.9 + 0.15 * combo);
      }
    }

    // Shatter the ball.
    const ground = this.b.snow ? this.b.snow.getDepth(x, z) : 0;
    _p.set(x, ground + r * 0.8, z);
    fx.burst(_p, { color: 0xffffff, count: Math.round(16 + r * 22), speed: 5.5 + r * 3.5, size: 0.17 + r * 0.13, gravity: 14, life: 1.1 });
    fx.burst(_p, { color: 0xcfe6ff, count: Math.round(10 + r * 12), speed: 3 + r * 2, size: 0.12 + r * 0.1, gravity: 7, life: 1.3 });
    if (freeze) fx.burst(_p, { color: 0x7fd4ff, count: Math.round(12 + r * 10), speed: 6 + r * 2, size: 0.14, gravity: 4, life: 0.9 });
    if (avalanche) fx.burst(_p, { color: 0xeaf4ff, count: Math.round(16 + r * 16), speed: 9 + r * 3, size: 0.3, gravity: 10, life: 1.0 });
    fx.powder(_p, { size: 0.8 + r * 0.5 + (avalanche ? 0.6 : 0), color: freeze ? 0xc4e4ff : 0xd6e3f3 });
    this.b.snow?.addSnow(x, z, Math.max(1.2, r * 1.6), volume * 0.4);
    _p.y = ground;
    fx.ring(_p, zone, freeze ? 0x9fe6ff : 0xffffff);
    if (avalanche) fx.ring(_p, zone * 1.25, 0xcfe0ff);
    this.shake(0.25 + 0.25 * r);
    this.impactHit('slam', _p, r, { stop: count > 0 });
    // Paint Shop horn: layered over a softer snow whumpf.
    const horn = this.b.plow.hornSound;
    const slamVol = Math.min(1, 0.7 + 0.2 * r);
    this.b.audio.play('slam', { pitch: THREE.MathUtils.clamp(1.3 - 0.35 * r, 0.5, 1.3), volume: horn ? slamVol * 0.5 : slamVol });
    if (horn) this.b.audio.play(horn, { volume: slamVol });
    if (freeze && ctx.time - this.lastFreezeSound > 0.3) {
      this.lastFreezeSound = ctx.time;
      this.b.audio.play('freeze', { volume: 0.8 });
    }

    const position = new THREE.Vector3(x, ground, z);
    this.b.events.emit('slam', { hits: count, radius: r, position });
    if (count >= 3) {
      this.b.events.emit('strike', { count, position: position.clone() });
      this.b.audio.play('strike');
    }
    return count;
  }

  /** Shatter Slam (Classic Plow): the ball bursts into shards that hit every bot outside the slam zone (`slammed`)
   *  but within stats.shardReach of it, for stats.shardFrac of the slam damage. */
  private shatter(x: number, z: number, zone: number, dmg: number, slammed: EnemyHandle[]): void {
    const ctx = this.ctx;
    const stats = this.b.stats;
    const fx = ctx.fx;
    const R = zone + stats.shardReach;
    const hits = this.b.enemies.query(x, z, R, this.shardBuf).slice();
    for (const e of hits) {
      if (!e.alive || slammed.includes(e)) continue;
      const dx = e.position.x - x;
      const dz = e.position.z - z;
      const d = Math.hypot(dx, dz) || 1;
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, dmg * stats.shardFrac * this.hitMult(e), {
        source: 'other',
        knockback: new THREE.Vector3((dx / d) * 8, 0, (dz / d) * 8),
        fromX: x,
        fromZ: z,
      });
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      this.onPlayerHit(dealt, killed, e);
      _q.set(e.position.x, e.position.y + e.radius + 1, e.position.z);
      if (dealt > 0) fx.floatText(_q, `🧨${Math.round(dealt)}`, '#bfe6ff', 0.8);
      _q.y = 1;
      fx.burst(_q, { color: 0xcfeeff, count: 6, speed: 6, size: 0.14, gravity: 14, life: 0.5 });
    }
    const ground = this.b.snow ? this.b.snow.getDepth(x, z) : 0;
    _p.set(x, ground + 0.6, z);
    fx.burst(_p, { color: 0xcfeeff, count: 18, speed: 9 + stats.shardReach, size: 0.12, gravity: 10, life: 0.6 });
    _p.y = ground;
    fx.ring(_p, R, 0xa8dcff);
  }

  /** One damage tick of the E whirl centered on (x, z). Every bot within `radius` is hit once per tick.
   *  Ticks 0..2 pull bots inward (with a swirl), the last tick (`final`) blasts them outward.
   *  Distinct bots hit are added to `hitIds`. Returns the number of bots hit this tick. */
  whirlTick(x: number, z: number, radius: number, ballR: number, tick: number, final: boolean, hitIds: Set<number>): number {
    const ctx = this.ctx;
    const stats = this.b.stats;
    const fx = ctx.fx;
    const dmg = (stats.whirlDamage + (ballR >= 0.2 ? 3 * ballR * ballR * stats.damageMult : 0)) * WHIRL_PLAYER_BONUS;
    if (final) this.smashProps(x, z, radius);
    const hits = this.collect(x, z, radius);
    let count = 0;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      hitIds.add(e.id);
      let dx = e.position.x - x;
      let dz = e.position.z - z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d;
      dz /= d;
      let kx: number;
      let kz: number;
      if (final) {
        kx = dx * WHIRL_BLAST;
        kz = dz * WHIRL_BLAST;
      } else {
        // Pull inward (less when already hugging the plow) + tangential swirl.
        const pull = WHIRL_PULL * THREE.MathUtils.clamp((d - 2.2) / 2, 0, 1);
        kx = -dx * pull + dz * 3.5;
        kz = -dz * pull - dx * 3.5;
      }
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, dmg * this.hitMult(e), {
        source: 'whirl',
        knockback: new THREE.Vector3(kx, 0, kz),
        fromX: x,
        fromZ: z,
        ballRadius: ballR,
      });
      count++;
      _q.set(e.position.x - dx * e.radius, 1, e.position.z - dz * e.radius);
      fx.burst(_q, { color: final ? 0xbfeaff : 0xffc04a, count: final ? 16 : 9, speed: final ? 11 : 7, size: 0.08, gravity: 22, life: 0.35 });
      fx.burst(_q, { color: 0xffffff, count: 6, speed: 4, size: 0.2, gravity: 12, life: 0.5 });
      _q.set(e.position.x, e.position.y + e.radius + 1, e.position.z);
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      this.onPlayerHit(dealt, killed, e);
      if (dealt > 0) fx.floatText(_q, `${Math.round(dealt)}`, killed ? '#fff3a0' : final ? '#9fe6ff' : '#d8f2ff', final ? 1.05 : 0.85);
    }
    this.targets.length = 0;

    this.b.audio.play('whirlTick', { pitch: 0.9 + tick * 0.12, volume: final ? 1 : 0.7 });
    _p.set(x, this.b.snow ? this.b.snow.getDepth(x, z) : 0, z);
    if (final) {
      fx.ring(_p, radius * 1.15, 0xbfeaff);
      fx.ring(_p, radius * 0.7, 0xffffff);
      this.shake(0.35 + 0.04 * Math.min(4, count));
      if (count > 0) this.b.audio.play('ram', { volume: 0.8, pitch: 0.8 });
    } else {
      this.shake(0.1 + 0.04 * Math.min(3, count));
    }
    return count;
  }

  /** Snapshot of living enemies overlapping a circle (copied: damage() may mutate manager lists). */
  /** Break destructible props in a circle (player attacks; a duel guest's predicted attacks never do). */
  private smashProps(x: number, z: number, r: number): void {
    if (this.b.authoritative) this.ctx.world?.blastProps(x, z, r);
  }

  private collect(x: number, z: number, radius: number): EnemyHandle[] {
    const enemies = this.b.enemies;
    const out = this.targets;
    out.length = 0;
    if (!enemies) return out;
    const q = enemies.query(x, z, radius, this.queryOut);
    for (let i = 0; i < q.length; i++) out.push(q[i]);
    return out;
  }

  /** Pilot perks that trigger on the player's own hits: Salvage Rig lifesteal and Adrenaline refunds.
   *  `heal` = false for VOLT-9 area damage (Thunderclap blast + storm, Tesla field ticks) so the storm can't
   *  out-heal its own Overload backlash. */
  private onPlayerHit(dealt: number, killed: boolean, target?: EnemyHandle, canChain = true, heal = true): void {
    const plow = this.b.plow;
    const st = this.b.stats;
    if (plow.dead) return;
    if (dealt > 0) plow.feedSawFury(dealt, 0);
    if (dealt > 0) this.feedUlt(dealt);
    if (canChain && target && dealt > 0 && st.chainCount > 0) this.chainLightning(target, dealt, heal);
    if (heal && st.lifesteal > 0 && dealt > 0) plow.hp = Math.min(plow.maxHp, plow.hp + dealt * st.lifesteal);
    if (killed && target && st.chainBlast > 0 && this.rads.has(target)) this.chainQueue.push({ x: target.position.x, z: target.position.z });
    if (killed && st.killRecharge > 0) {
      // Plow keeps its cooldown charges private; refund them through a narrow duck-typed view.
      const p = plow as unknown as { dashCharge: number; whirlCharge: number };
      p.dashCharge = Math.min(1, p.dashCharge + st.killRecharge);
      p.whirlCharge = Math.min(1, p.whirlCharge + st.killRecharge);
    }
  }

  get flameReady(): number {
    const st = this.b.stats;
    if (st.plowKind === 'volt') return st.clapDamage > 0 ? this.clapCharge : -1;
    if (st.plowKind === 'brute') return st.poundDamage > 0 ? (this.poundT >= 0 ? 0 : this.poundCharge) : -1;
    if (st.plowKind === 'isotope') return st.meltDamage > 0 ? this.meltCharge : -1;
    if (st.plowKind === 'arsenal') return st.missileDamage > 0 ? this.missileCharge : -1;
    return st.flameDps > 0 ? this.flameCharge : -1;
  }

  /** Inferno (F, pilot perk): a 1s cone of fire from the blade that ignites bots and melts snow. */
  private updateFlame(dt: number): void {
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
      if (this.critCharge >= 1) this.firestorm(plow);
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
      _p.set(_tip.x + _fwd.x * k * range + _fwd.z * side, 0.7 + Math.random() * 1.1, _tip.z + _fwd.z * k * range - _fwd.x * side);
      fx.burst(_p, { color: Math.random() < 0.6 ? 0xff5a10 : 0xffd040, count: 3, speed: 3, size: 0.3 + k * 0.3, gravity: -7, life: 0.4 });
    }
    _p.set(_tip.x + _fwd.x * range * 0.3, 1, _tip.z + _fwd.z * range * 0.3);
    fx.burst(_p, { color: 0xfff2b0, count: 2, speed: 9, size: 0.06, gravity: 8, life: 0.45 });
    if (Math.random() < 0.45) {
      _p.set(_tip.x + _fwd.x * range * 0.9, 2.2, _tip.z + _fwd.z * range * 0.9);
      fx.burst(_p, { color: 0x2c2628, count: 2, speed: 1.5, size: 0.7, gravity: -3, life: 1.1 });
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
    const hits = this.collect(_tip.x + _fwd.x * range * 0.5, _tip.z + _fwd.z * range * 0.5, range * 0.5 + 1);
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
        knockback: new THREE.Vector3((dx / nd) * 3, 0, (dz / nd) * 3),
        fromX: e.position.x,
        fromZ: e.position.z,
      });
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      this.feedFire(dealt);
      this.onPlayerHit(dealt, killed, e, false);
    }
    this.targets.length = 0;
  }

  /** Fire damage fills the Classic Plow's FIRESTORM meter (shares ISOTOPE's Critical Mass slot + net field). */
  private feedFire(dealt: number): void {
    if (dealt <= 0 || this.b.stats.plowKind !== 'classic') return;
    const was = this.critCharge;
    this.critCharge = Math.min(1, this.critCharge + dealt / FIRESTORM_CHARGE);
    if (was < 1 && this.critCharge >= 1 && this.b.local) {
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
    const hits = this.collect(x, z, R);
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
        knockback: new THREE.Vector3((dx / nd) * knock, 0, (dz / nd) * knock),
        fromX: x,
        fromZ: z,
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
    this.targets.length = 0;
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
    _q.set(x, 1.2, z);
    ctx.fx.burst(_q, { color: 0xff6a10, count: 36, speed: 12, size: 0.42, gravity: -3, life: 0.6 });
    ctx.fx.burst(_q, { color: 0xffe070, count: 18, speed: 7, size: 0.3, gravity: -6, life: 0.5 });
    ctx.fx.burst(_q, { color: 0x2c2628, count: 10, speed: 3, size: 0.9, gravity: -2.5, life: 1.2 });
    _q.set(x, 0.15, z);
    ctx.fx.ring(_q, FIREBALL_RADIUS, 0xff8a20);
    ctx.fx.ring(_q, FIREBALL_RADIUS * 0.55, 0xffe070);
    this.shake(0.45);
    this.impactHit('meltdown', _q.set(x, 1, z), 0.7);
    this.b.audio.play('explosion', { volume: 0.7, pitch: 0.85 });
    this.b.snow?.melt(x, z, FIREBALL_RADIUS * 0.8, 1);
    this.fireBlast(x, z, FIREBALL_RADIUS, st.flameDps * FIREBALL_MULT, FIREBALL_KNOCK, 0.6, '💥', true);
  }

  /** FIRESTORM: meter full + F — a 360° fire nova around the plow, then burning ground. */
  private firestorm(plow: PlowAPI): void {
    const st = this.b.stats;
    const ctx = this.ctx;
    this.critCharge = 0;
    this.b.events.emit('ability', { nuke: true });
    const x = plow.position.x;
    const z = plow.position.z;
    ctx.ui.toast(this.b.local ? '🔥 FIRESTORM!' : '🔥 INCOMING FIRESTORM!', 'big');
    _q.set(x, 0.15, z);
    for (const [r, c] of [[0.35, 0xfff0a0], [0.65, 0xffb040], [1, 0xff5a10], [1.12, 0x8a1a00]] as const) ctx.fx.ring(_q, FIRESTORM_RADIUS * r, c);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      for (const k of [0.35, 0.7, 1]) {
        _q.set(x + Math.sin(a) * FIRESTORM_RADIUS * k, 0.8, z + Math.cos(a) * FIRESTORM_RADIUS * k);
        ctx.fx.burst(_q, { color: Math.random() < 0.6 ? 0xff5a10 : 0xffd040, count: 4, speed: 5, size: 0.45, gravity: -6, life: 0.7 });
      }
    }
    _q.set(x, 2.5, z);
    ctx.fx.burst(_q, { color: 0xffe070, count: 60, speed: 16, size: 0.35, gravity: -2, life: 0.8 });
    ctx.fx.burst(_q, { color: 0x2c2628, count: 24, speed: 5, size: 1.2, gravity: -2.5, life: 1.6 });
    this.shake(1);
    this.impactHit('nuke', _q.set(x, 1, z));
    this.b.audio.play('explosion', { volume: 1, pitch: 0.6 });
    this.b.audio.play('roar', { volume: 0.7, pitch: 1.3 });
    this.b.snow?.melt(x, z, FIRE_FIELD_RADIUS, 1);
    this.fireBlast(x, z, FIRESTORM_RADIUS, st.flameDps * FIRESTORM_MULT, FIRESTORM_KNOCK, 0.5, '🔥', false);
    this.fireFieldT = FIRE_FIELD_SECONDS;
    this.fireFieldX = x;
    this.fireFieldZ = z;
    this.fireFieldTickT = 0;
    this.fireField.position.set(x, 0.07, z);
    this.fireField.scale.setScalar(FIRE_FIELD_RADIUS);
    this.fireField.visible = true;
  }

  /** FIRESTORM burning ground: flickers, keeps everything inside alight, small contact damage. */
  private updateFireField(dt: number): void {
    if (this.fireFieldT <= 0) return;
    this.fireFieldT -= dt;
    if (this.fireFieldT <= 0) {
      this.fireField.visible = false;
      return;
    }
    const ctx = this.ctx;
    const fade = Math.min(1, this.fireFieldT / 0.8, (FIRE_FIELD_SECONDS - this.fireFieldT) / 0.2 + 0.3);
    this.fireFieldMat.opacity = (0.3 + 0.1 * Math.sin(ctx.time * 11) + 0.05 * Math.random()) * fade;
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * FIRE_FIELD_RADIUS;
      _q.set(this.fireFieldX + Math.sin(a) * rr, 0.4, this.fireFieldZ + Math.cos(a) * rr);
      ctx.fx.burst(_q, { color: Math.random() < 0.6 ? 0xff5a10 : 0xffd040, count: 2, speed: 2, size: 0.35, gravity: -7, life: 0.5 });
    }
    this.fireFieldTickT -= dt;
    if (this.fireFieldTickT > 0) return;
    this.fireFieldTickT = FIRE_FIELD_TICK;
    const st = this.b.stats;
    const hits = this.collect(this.fireFieldX, this.fireFieldZ, FIRE_FIELD_RADIUS);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      this.ignite(e, true);
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, st.flameDps * FIRE_FIELD_DPS * FIRE_FIELD_TICK * st.damageMult * this.hitMult(e), { source: 'other', fromX: e.position.x, fromZ: e.position.z });
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      this.onPlayerHit(dealt, killed, e, false);
    }
    this.targets.length = 0;
  }

  /** Burn damage over time from Inferno, credited to the player (lifesteal / adrenaline apply). */
  private updateBurns(dt: number): void {
    if (this.burns.size === 0) return;
    const ctx = this.ctx;
    const dps = this.b.stats.flameDps;
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
        ctx.fx.burst(_p, { color: 0x2c2628, count: 1, speed: 1, size: 0.6, gravity: -2.5, life: 1 });
      }
      if (b.tickT <= 0) {
        b.tickT = BURN_TICK;
        const hp0 = e.hp;
        const killed = this.b.enemies.damage(e, dps * this.b.stats.damageMult * BURN_TICK * BURN_VULN * this.lastStandMult(), { source: 'other', fromX: e.position.x, fromZ: e.position.z });
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

  /* ------------------------------------------------------------------ ultimates (VOLT-9 / BRUTUS / ARSENAL) */

  /** Damage you deal fills the VOLT-9 / BRUTUS / ARSENAL ultimate meter (Critical Mass slot + net field). */
  private feedUlt(dealt: number): void {
    const kind = this.b.stats.plowKind;
    if (kind !== 'volt' && kind !== 'brute' && kind !== 'arsenal') return;
    if (this.ultLock > 0 || this.ultT >= 0) return;
    const was = this.critCharge;
    this.critCharge = Math.min(1, this.critCharge + dealt / ULT_CHARGE[kind]);
    if (was < 1 && this.critCharge >= 1 && this.b.local) {
      this.ctx.ui.toast(`${ULT_NAME[kind]} READY · F`, 'info');
      this.b.audio.play('charge', { pitch: 0.7, volume: 0.6 });
    }
  }

  private startUlt(kind: 'volt' | 'brute' | 'arsenal', plow: PlowAPI): void {
    const ctx = this.ctx;
    this.critCharge = 0;
    this.b.events.emit('ability', { nuke: true });
    this.ultKind = kind;
    this.ultT = 0;
    this.ultStep = 0;
    this.ultX = plow.position.x;
    this.ultZ = plow.position.z;
    ctx.ui.toast(this.b.local ? `${ULT_NAME[kind]}!` : `INCOMING ${ULT_NAME[kind]}!`, 'big');
    _q.set(this.ultX, 0.12, this.ultZ);
    if (kind === 'volt') {
      ctx.fx.ring(_q, SUPERCELL_RADIUS, 0x2fb8ff);
      ctx.fx.ring(_q, SUPERCELL_RADIUS * 0.5, 0xbff0ff);
      this.b.audio.play('thunder', { pitch: 0.7 });
      this.ultLock = SUPERCELL_WAVES * SUPERCELL_GAP + 1;
    } else if (kind === 'brute') {
      ctx.fx.burst(_q, { color: 0x6b5a48, count: 30, speed: 6, size: 0.4, gravity: 14, life: 0.8 });
      this.b.audio.play('roar', { pitch: 0.6, volume: 0.8 });
      this.ultLock = QUAKE_RINGS.length * QUAKE_GAP + 1;
    } else {
      // Paint the targets: the top threats in range by targetScore, one mark each.
      this.ultMarks.length = 0;
      const ranked = this.collect(this.ultX, this.ultZ, ORBITAL_RANGE)
        .filter((e) => e.alive)
        .map((e) => ({ e, score: this.targetScore(e, this.ultX, this.ultZ) }))
        .sort((p, q) => q.score - p.score);
      this.targets.length = 0;
      for (const { e } of ranked.slice(0, ORBITAL_TARGETS)) this.ultMarks.push({ x: e.position.x, z: e.position.z, e });
      // Nothing to hit: strike straight ahead.
      if (!this.ultMarks.length) {
        plow.getForward(_fwd);
        this.ultMarks.push({ x: this.ultX + _fwd.x * 12, z: this.ultZ + _fwd.z * 12, e: null });
      }
      this.b.audio.play('charge', { pitch: 1.3, volume: 0.8 });
      this.ultLock = ORBITAL_DELAY + 1;
    }
  }

  private updateUlt(dt: number): void {
    if (this.ultLock > 0) this.ultLock -= dt;
    if (this.ultT < 0) return;
    this.ultT += dt;
    if (this.ultKind === 'volt') {
      while (this.ultStep < SUPERCELL_WAVES && this.ultT >= this.ultStep * SUPERCELL_GAP) this.supercellWave(this.ultStep++);
      if (this.ultStep >= SUPERCELL_WAVES) this.ultT = -1;
    } else if (this.ultKind === 'brute') {
      while (this.ultStep < QUAKE_RINGS.length && this.ultT >= this.ultStep * QUAKE_GAP) this.quakeRing(this.ultStep++);
      if (this.ultStep >= QUAKE_RINGS.length) this.ultT = -1;
    } else {
      // Reticles follow their targets and tighten until the strike lands.
      const k = Math.min(1, this.ultT / ORBITAL_DELAY);
      for (const m of this.ultMarks) {
        if (m.e?.alive) {
          m.x = m.e.position.x;
          m.z = m.e.position.z;
        }
        if (Math.random() < dt * 14) {
          _q.set(m.x, 0.12, m.z);
          this.ctx.fx.ring(_q, ORBITAL_RADIUS * (1.6 - k), 0xff3030);
        }
      }
      if (this.ultT >= ORBITAL_DELAY) {
        for (const m of this.ultMarks) this.orbitalStrike(m.x, m.z);
        this.ultMarks.length = 0;
        this.ultT = -1;
      }
    }
  }

  /** Hit every bot whose centre is between `inner` and `R` of (x, z). Returns how many. */
  private ultBlast(x: number, z: number, inner: number, R: number, dmg: number, o: { knock: number; stun?: number; freeze?: number; text: string; color: string; bolt?: boolean }): number {
    this.smashProps(x, z, R);
    const hits = this.collect(x, z, R);
    let n = 0;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      const dx = e.position.x - x;
      const dz = e.position.z - z;
      const d = Math.hypot(dx, dz);
      if (d + e.radius < inner) continue;
      const nd = d || 1;
      if (o.bolt) {
        _p.set(e.position.x + (Math.random() - 0.5) * 3, 28, e.position.z + (Math.random() - 0.5) * 3);
        _q.set(e.position.x, e.position.y + e.radius, e.position.z);
        this.lightning.bolt(_p, _q, { life: 0.35, width: 0.6, jag: 2, color: 0xbff0ff });
      }
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, dmg * this.b.stats.damageMult * this.hitMult(e), {
        source: 'other',
        knockback: new THREE.Vector3((dx / nd) * o.knock, 0, (dz / nd) * o.knock),
        stunSeconds: o.stun,
        freezeSeconds: o.freeze,
        fromX: x,
        fromZ: z,
      });
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      this.onPlayerHit(dealt, killed, e, false, false);
      if (dealt > 0) {
        _tip.set(e.position.x, e.position.y + e.radius + 1.3, e.position.z);
        this.ctx.fx.floatText(_tip, `${o.text}${Math.round(dealt)}`, o.color, 1.2);
      }
      n++;
    }
    this.targets.length = 0;
    return n;
  }

  /** SUPERCELL wave: sky strikes on every bot in range (+ a few bare-ground strikes for show), ground rings. */
  private supercellWave(i: number): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const x = this.ultX;
    const z = this.ultZ;
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * SUPERCELL_RADIUS;
      _q.set(x + Math.sin(a) * rr, 0.2, z + Math.cos(a) * rr);
      _p.set(_q.x + (Math.random() - 0.5) * 4, 28, _q.z + (Math.random() - 0.5) * 4);
      this.lightning.bolt(_p, _q, { life: 0.3, width: 0.45, jag: 2.2, color: 0x9fe8ff });
      ctx.fx.sparks(_q, null, { color: 0x9fe8ff, count: 10, speed: 9, size: 0.07, length: 0.05, gravity: 8, life: 0.4 });
    }
    _q.set(x, 0.12, z);
    ctx.fx.ring(_q, SUPERCELL_RADIUS * (0.4 + 0.3 * i), 0xbff0ff);
    this.shake(0.7);
    this.impactHit('clap', _q.set(x, 1, z));
    this.b.audio.play('thunder', { pitch: 0.85 + 0.15 * i });
    this.ultBlast(x, z, 0, SUPERCELL_RADIUS, st.clapDamage * SUPERCELL_MULT, { knock: 8, freeze: st.clapStun * 1.5, text: '⚡', color: '#bff0ff', bolt: true });
  }

  /** EARTHQUAKE ring i: a shockwave sweeping from the last ring's radius out to this one, cracking the ground. */
  private quakeRing(i: number): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const x = this.ultX;
    const z = this.ultZ;
    const R = QUAKE_RINGS[i];
    const inner = i > 0 ? QUAKE_RINGS[i - 1] - 1 : 0;
    _q.set(x, 0.12, z);
    ctx.fx.ring(_q, R, 0xffc21a);
    ctx.fx.ring(_q, R * 0.92, 0xffffff);
    const n = Math.round(R * 2);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.2;
      _q.set(x + Math.sin(a) * R, 0.3, z + Math.cos(a) * R);
      ctx.fx.burst(_q, { color: Math.random() < 0.5 ? 0xffffff : 0x6b5a48, count: 4, speed: 7, size: 0.3, gravity: 18, life: 0.6 });
    }
    this.b.snow?.melt(x, z, R, 0.15);
    this.shake(1 - i * 0.15);
    this.impactHit('pound', _q.set(x, 0.5, z), 1 - i * 0.2);
    this.b.audio.play('thud', { pitch: 0.75 - i * 0.1 });
    this.ultBlast(x, z, inner, R, st.poundDamage * QUAKE_MULT, { knock: st.poundKnock * 1.2, stun: st.poundStun, text: '🌍', color: '#ffd23a' });
  }

  /** ORBITAL STRIKE: a sky laser column onto (x, z). */
  private orbitalStrike(x: number, z: number): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    for (let k = 0; k < 3; k++) {
      _p.set(x + (Math.random() - 0.5) * 0.6, 40, z + (Math.random() - 0.5) * 0.6);
      _q.set(x, 0.1, z);
      this.lightning.bolt(_p, _q, { life: 0.45, width: 1.4 - k * 0.4, jag: 0.15, color: k === 0 ? 0xff2020 : 0xffe0e0 });
    }
    _q.set(x, 0.12, z);
    ctx.fx.ring(_q, ORBITAL_RADIUS, 0xff3030);
    ctx.fx.ring(_q, ORBITAL_RADIUS * 1.3, 0xffb0a0);
    _q.set(x, 1, z);
    ctx.fx.burst(_q, { color: 0xff4020, count: 30, speed: 12, size: 0.35, gravity: -2, life: 0.6 });
    ctx.fx.burst(_q, { color: 0x2c2628, count: 10, speed: 3, size: 1, gravity: -2.5, life: 1.2 });
    this.b.snow?.melt(x, z, ORBITAL_RADIUS * 0.8, 1);
    this.shake(0.6);
    this.impactHit('nuke', _q, 0.6);
    this.b.audio.play('explosion', { volume: 0.8, pitch: 1.1 });
    this.ultBlast(x, z, 0, ORBITAL_RADIUS, st.missileDamage * ORBITAL_MULT, { knock: 14, text: '🛰', color: '#ff8a7a' });
  }

  /* ------------------------------------------------------------------ ARSENAL */

  private buildArsenalFx(scene: THREE.Scene): void {
    const trGeo = new THREE.BoxGeometry(0.07, 0.07, 1);
    trGeo.translate(0, 0, 0.5);
    const trMat = new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < TRACERS; i++) {
      const mesh = new THREE.Mesh(trGeo, trMat);
      mesh.visible = false;
      scene.add(mesh);
      this.tracers.push({ mesh, t: 0 });
    }
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    beamGeo.rotateX(Math.PI / 2);
    beamGeo.translate(0, 0, 0.5);
    this.laserCore = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xfff0f0, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.laserGlow = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    for (const m of [this.laserCore, this.laserGlow]) {
      m.visible = false;
      m.renderOrder = 3;
      scene.add(m);
    }
    const bodyGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.7, 8);
    bodyGeo.rotateX(Math.PI / 2);
    const noseGeo = new THREE.ConeGeometry(0.09, 0.22, 8);
    noseGeo.rotateX(Math.PI / 2);
    noseGeo.translate(0, 0, 0.46);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.4, metalness: 0.3 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0xd8262a, roughness: 0.4 });
    const fireMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const fireGeo = new THREE.ConeGeometry(0.08, 0.5, 8);
    fireGeo.rotateX(-Math.PI / 2);
    fireGeo.translate(0, 0, -0.6);
    for (let i = 0; i < MISSILES_MAX; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bodyGeo, bodyMat), new THREE.Mesh(noseGeo, noseMat), new THREE.Mesh(fireGeo, fireMat));
      g.visible = false;
      scene.add(g);
      this.missiles.push({ mesh: g, pos: new THREE.Vector3(), vel: new THREE.Vector3(), target: null, t: 0, live: false });
    }
  }

  /** One weapon hit from ARSENAL (player credit). `direct`: rapid single-target fire (rounds, laser ticks), see
   *  DamageOpts.direct. Returns damage dealt. */
  private weaponHit(e: EnemyHandle, amount: number, fromX: number, fromZ: number, knock: number, direct?: 'round' | 'beam'): number {
    if (!e.alive) return 0;
    const dx = e.position.x - fromX;
    const dz = e.position.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    const hp0 = e.hp;
    const killed = this.b.enemies.damage(e, amount * this.b.stats.damageMult * this.hitMult(e), {
      source: 'other',
      knockback: new THREE.Vector3((dx / d) * knock, 0, (dz / d) * knock),
      fromX,
      fromZ,
      direct,
    });
    const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
    this.onPlayerHit(dealt, killed, e);
    return dealt;
  }

  /** Autocannon (SPACE, held): twin auto-aiming cannons on a turret that locks up to 80° either side of the nose,
   *  alternating muzzles. A duel puppet fires when the host's snapshot says so. */
  private updateGuns(dt: number): void {
    for (const tr of this.tracers) {
      if (tr.t <= 0) continue;
      tr.t -= dt;
      if (tr.t <= 0) tr.mesh.visible = false;
    }
    const st = this.b.stats;
    const plow = this.b.plow;
    this.gunsOn = false;
    if (plow) plow.gunFiring = false;
    if (st.gunDamage <= 0 || !plow) return;
    if (this.gunT > 0) this.gunT -= dt;
    if (plow.dead) return;
    const input = this.b.input;
    let firing: boolean;
    if (this.netFire >= 0) firing = (this.netFire & 1) !== 0;
    else {
      if (input.wasPressed('Space')) this.gunBurstT = GUN_BURST;
      else if (this.gunBurstT > 0) this.gunBurstT -= dt;
      firing = this.gunBurstT > 0 || !!input.isDown?.('Space');
    }
    this.gunsOn = firing;
    plow.gunFiring = firing;
    const px = plow.position.x;
    const pz = plow.position.z;
    const target = this.gunTarget(px, pz, plow.heading, st.gunRange);
    // Turret tracks the target (or settles forward); a duel guest copies the host's aim.
    if (!Number.isNaN(this.netTurret)) plow.turretAim = this.netTurret;
    else if (target) plow.turretAim = wrapAngle(Math.atan2(target.position.x - px, target.position.z - pz) - plow.heading);
    else plow.turretAim = 0;
    if (!firing || this.gunT > 0) return;
    this.gunT += 1 / Math.max(0.5, st.gunRate);
    if (this.gunT < 0) this.gunT = 0;
    const side = (this.gunSide = 1 - this.gunSide);
    plow.mountWorld('muzzle', side, _p);
    let ex: number;
    let ez: number;
    let ey = _p.y;
    if (target) {
      ex = target.position.x;
      ez = target.position.z;
      ey = target.position.y + Math.min(1.2, target.radius * 0.6);
      this.weaponHit(target, st.gunDamage, px, pz, GUN_KNOCK, 'round');
      _q.set(ex, ey, ez);
      this.ctx.fx.burst(_q, { color: 0xffd060, count: 4, speed: 6, size: 0.12, gravity: 10, life: 0.25 });
    } else {
      const h = plow.turretHeading;
      const hx = Math.sin(h);
      const hz = Math.cos(h);
      const t = this.b.authoritative ? (this.ctx.world?.blastPropRay(_p.x, _p.z, hx, hz, st.gunRange) ?? -1) : -1;
      const reach = t >= 0 ? t : st.gunRange;
      ex = _p.x + hx * reach;
      ez = _p.z + hz * reach;
    }
    const tr = this.tracers.find((t) => t.t <= 0) ?? this.tracers[0];
    tr.t = 0.06;
    tr.mesh.visible = true;
    tr.mesh.position.copy(_p);
    _q.set(ex, ey, ez);
    tr.mesh.lookAt(_q);
    tr.mesh.scale.set(1, 1, Math.max(0.5, _p.distanceTo(_q)));
    this.ctx.fx.burst(_p, { color: 0xffe08a, count: 3, speed: 4, size: 0.18, gravity: 0, life: 0.08 });
    this.b.audio.play('hit', { volume: 0.22, pitch: 1.7 + Math.random() * 0.2 });
    if (this.b.local) this.ctx.fx.shake(0.04);
  }

  /** Autocannon target: inside the lock cone and range, favouring bots near the nose and close by, then threats. */
  private gunTarget(x: number, z: number, heading: number, range: number): EnemyHandle | null {
    const hits = this.collect(x, z, range);
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    let best: EnemyHandle | null = null;
    let bestCost = Infinity;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      const dx = e.position.x - x;
      const dz = e.position.z - z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.radius) continue;
      const cos = d > e.radius ? (dx * fx + dz * fz) / d : 1;
      if (cos < GUN_LOCK_COS) continue;
      // Off-nose bots cost up to 2x their distance; a bot that has been hurting you gets pulled forward.
      const cost = d * (1.5 - 0.5 * cos) - 0.1 * this.threatOf(e);
      if (cost < bestCost) {
        bestCost = cost;
        best = e;
      }
    }
    this.targets.length = 0;
    return best;
  }

  /** ARSENAL laser (E; the Plow pays the whirl charge). False if the laser can't fire. */
  fireLaser(): boolean {
    const st = this.b.stats;
    if (st.laserDps <= 0 || this.laserT > 0) return false;
    this.laserT = LASER_SECONDS;
    this.laserTickT = 0;
    this.laserOff = 0;
    this.b.audio.play('zap', { pitch: 0.45, volume: 0.9 });
    this.b.audio.play('charge', { pitch: 1.6, volume: 0.5 });
    return true;
  }

  /** Where the laser wants to point, as a yaw off the nose: the top-priority bot within reach and LASER_TRACK (plus a
   *  little slack so a bot just outside still pulls the beam to the edge), or straight ahead. */
  private laserAim(x: number, z: number, heading: number, range: number): number {
    const hits = this.collect(x, z, range);
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      const dx = e.position.x - x;
      const dz = e.position.z - z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.radius || d < 0.5) continue;
      const off = wrapAngle(Math.atan2(dx, dz) - heading);
      if (Math.abs(off) > LASER_TRACK + 0.25) continue;
      const score = this.targetScore(e, x, z);
      if (score > bestScore) {
        bestScore = score;
        best = THREE.MathUtils.clamp(off, -LASER_TRACK, LASER_TRACK);
      }
    }
    this.targets.length = 0;
    return best;
  }

  private updateLaser(dt: number): void {
    const plow = this.b.plow;
    if (this.laserT <= 0) return;
    this.laserT -= dt;
    if (this.laserT <= 0 || !plow || plow.dead) {
      this.laserT = 0;
      this.laserCore.visible = this.laserGlow.visible = false;
      return;
    }
    const st = this.b.stats;
    const R = st.laserRange;
    plow.mountWorld('laser', 0, _p);
    // The beam bends toward its target, but only so far and so fast: steering still does most of the aiming.
    // A duel guest hits nothing locally: it follows the host's bend instead of aiming.
    const want = Number.isNaN(this.netLaserOff) ? this.laserAim(_p.x, _p.z, plow.heading, R) : this.netLaserOff;
    const step = LASER_SLEW * dt;
    this.laserOff += THREE.MathUtils.clamp(want - this.laserOff, -step, step);
    const h = plow.heading + this.laserOff;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    _q.set(_p.x + fx * R, _p.y, _p.z + fz * R);
    const flick = 0.85 + Math.random() * 0.3;
    const fade = Math.min(1, this.laserT / 0.2, (LASER_SECONDS - this.laserT) / 0.08 + 0.2);
    for (const [m, w] of [[this.laserCore, 0.09], [this.laserGlow, 0.32]] as const) {
      m.visible = true;
      m.position.copy(_p);
      m.lookAt(_q);
      m.scale.set(w * flick * fade, w * flick * fade, R);
    }
    // Sparks + scorched snow along the beam.
    const k = Math.random();
    _tip.set(_p.x + fx * R * k, 0.5, _p.z + fz * R * k);
    this.ctx.fx.burst(_tip, { color: Math.random() < 0.5 ? 0xff4030 : 0xffd0c0, count: 2, speed: 4, size: 0.16, gravity: -3, life: 0.3 });
    this.b.snow.melt(_p.x + fx * R * 0.5, _p.z + fz * R * 0.5, 1.2, 0.6 * dt);
    this.b.snow.melt(_p.x + fx * R * k, _p.z + fz * R * k, 1.2, 1.2 * dt);
    if (this.b.local) this.ctx.fx.shake(0.05);
    this.laserTickT -= dt;
    if (this.laserTickT > 0) return;
    this.laserTickT = LASER_TICK;
    if (this.b.authoritative) this.ctx.world?.blastPropRay(_p.x, _p.z, fx, fz, R);
    const hits = this.collect(_p.x + fx * R * 0.5, _p.z + fz * R * 0.5, R * 0.5 + 2);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      const dx = e.position.x - _p.x;
      const dz = e.position.z - _p.z;
      const along = dx * fx + dz * fz;
      if (along < -e.radius || along > R + e.radius) continue;
      if (Math.abs(dx * fz - dz * fx) > LASER_WIDTH + e.radius) continue;
      const dealt = this.weaponHit(e, st.laserDps * LASER_TICK, _p.x, _p.z, 2, 'beam');
      if (dealt > 0 && Math.random() < 0.35) {
        _tip.set(e.position.x, e.position.y + e.radius + 1, e.position.z);
        this.ctx.fx.floatText(_tip, `${Math.round(dealt)}`, '#ff6a5a', 0.7);
      }
    }
    this.targets.length = 0;
  }

  /** Damage one missile does to `e` (direct hit), for working out how many it takes. */
  private missileHitOn(e: EnemyHandle): number {
    return Math.max(1, this.b.stats.missileDamage * this.b.stats.damageMult * this.hitMult(e));
  }

  /** Live missiles already flying at `e`. */
  private inFlight(e: EnemyHandle): number {
    let n = 0;
    for (const m of this.missiles) if (m.live && m.target === e) n++;
    return n;
  }

  /**
   * Target list for a salvo of `n` missiles. Bots are ranked by targetScore (damage they've dealt you first), and
   * each gets as many missiles as its HP needs, minus the ones already flying at it; leftovers go round the ranked
   * list again (overkill on the biggest threats). Several missiles can share a target.
   */
  planSalvo(n: number, x: number, z: number): (EnemyHandle | null)[] {
    const hits = this.collect(x, z, MISSILE_RANGE);
    const ranked: { e: EnemyHandle; score: number; need: number }[] = [];
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive || Math.hypot(e.position.x - x, e.position.z - z) > MISSILE_RANGE + e.radius) continue;
      const per = this.missileHitOn(e);
      const need = Math.max(0, Math.ceil(Math.max(0, e.hp) / per) - this.inFlight(e));
      ranked.push({ e, score: this.targetScore(e, x, z), need });
    }
    this.targets.length = 0;
    ranked.sort((a, b) => b.score - a.score);
    const out: (EnemyHandle | null)[] = [];
    for (const r of ranked) {
      for (let k = 0; k < r.need && out.length < n; k++) out.push(r.e);
      if (out.length >= n) break;
    }
    for (let i = 0; out.length < n && ranked.length; i++) out.push(ranked[i % ranked.length].e);
    while (out.length < n) out.push(null);
    return out;
  }

  /** Swarm Missiles (F on ARSENAL): a salvo from the pods, spread over targets by planSalvo. */
  private updateMissiles(dt: number): void {
    const st = this.b.stats;
    const plow = this.b.plow;
    this.flyMissiles(dt);
    if (st.missileDamage <= 0 || !plow || plow.dead) return;
    if (this.missileCharge < 1) this.missileCharge = Math.min(1, this.missileCharge + (st.missileCooldown > 0 ? dt / st.missileCooldown : 1));
    if (!this.b.input.wasPressed('KeyF')) return;
    if (this.critCharge >= 1 && this.ultT < 0) return this.startUlt('arsenal', plow);
    if (this.missileCharge < 1) {
      this.b.audio.play('error');
      return;
    }
    this.missileCharge = 0;
    this.b.events.emit('ability', { nuke: false });
    this.b.audio.play('burst', { pitch: 1.4, volume: 0.8 });
    this.b.audio.play('dash', { pitch: 1.6, volume: 0.6 });
    const px = plow.position.x;
    const pz = plow.position.z;
    const plan = this.planSalvo(Math.min(MISSILES_MAX, st.missileCount), px, pz);
    for (let i = 0; i < plan.length; i++) {
      const m = this.missiles.find((x) => !x.live);
      if (!m) break;
      plow.mountWorld('pod', i * 5 + (i >> 1), m.pos);
      const side = m.pos.x - px;
      const sideZ = m.pos.z - pz;
      const sl = Math.hypot(side, sideZ) || 1;
      m.vel.set((side / sl) * 6 + Math.sin(plow.heading) * 6, 11 + Math.random() * 3, (sideZ / sl) * 6 + Math.cos(plow.heading) * 6);
      m.target = plan[i];
      m.t = 0;
      m.live = true;
      m.mesh.visible = true;
      m.mesh.position.copy(m.pos);
      this.ctx.fx.burst(m.pos, { color: 0xd8dde2, count: 4, speed: 3, size: 0.4, gravity: -1, life: 0.6 });
    }
  }

  /** A missile lost its target: the best-scoring bot near it that still needs missiles, else the best near it. */
  private retarget(m: (typeof this.missiles)[number]): EnemyHandle | null {
    const hits = this.collect(m.pos.x, m.pos.z, MISSILE_RETARGET);
    let best: EnemyHandle | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      const covered = this.inFlight(e) * this.missileHitOn(e) >= e.hp;
      const score = this.targetScore(e, m.pos.x, m.pos.z) - (covered ? 1000 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    this.targets.length = 0;
    return best;
  }

  private flyMissiles(dt: number): void {
    for (const m of this.missiles) {
      if (!m.live) continue;
      m.t += dt;
      if (m.target && !m.target.alive) m.target = this.retarget(m);
      const tgt = m.target;
      if (m.t > 0.25) {
        if (tgt) {
          _q.set(tgt.position.x, tgt.position.y + Math.min(1, tgt.radius * 0.5), tgt.position.z).sub(m.pos).normalize().multiplyScalar(MISSILE_SPEED);
        } else {
          // Nothing to chase: keep going and nose down.
          _q.copy(m.vel).setY(0).normalize().multiplyScalar(MISSILE_SPEED);
          _q.y = -8;
        }
        m.vel.lerp(_q, Math.min(1, MISSILE_TURN * dt * (0.4 + m.t)));
      } else m.vel.y -= 10 * dt;
      m.pos.addScaledVector(m.vel, dt);
      _p.copy(m.pos).add(m.vel);
      m.mesh.position.copy(m.pos);
      m.mesh.lookAt(_p);
      if (Math.random() < dt * 40) this.ctx.fx.burst(m.pos, { color: Math.random() < 0.3 ? 0xffa040 : 0xc8ccd2, count: 1, speed: 0.6, size: 0.35, gravity: -1.5, life: 0.5 });
      const hitTarget = tgt && Math.hypot(tgt.position.x - m.pos.x, tgt.position.z - m.pos.z) < tgt.radius + 0.4 && m.pos.y < tgt.position.y + tgt.radius * 2 + 1;
      if (hitTarget || m.pos.y <= 0.15 || m.t > MISSILE_FUSE) this.explodeMissile(m, tgt);
    }
  }

  private explodeMissile(m: (typeof this.missiles)[number], direct: EnemyHandle | null): void {
    m.live = false;
    m.mesh.visible = false;
    const st = this.b.stats;
    const x = m.pos.x;
    const z = m.pos.z;
    _q.set(x, Math.max(0.5, m.pos.y), z);
    this.ctx.fx.burst(_q, { color: 0xff8a20, count: 18, speed: 9, size: 0.35, gravity: -2, life: 0.5 });
    this.ctx.fx.burst(_q, { color: 0x3a3634, count: 6, speed: 2, size: 0.8, gravity: -2, life: 1 });
    this.ctx.fx.ring(_q.set(x, 0.15, z), MISSILE_BLAST, 0xffb040);
    this.b.audio.play('explosion', { volume: 0.45, pitch: 1.2 + Math.random() * 0.2 });
    this.shake(0.18);
    this.b.snow.melt(x, z, MISSILE_BLAST * 0.6, 0.6);
    this.smashProps(x, z, MISSILE_BLAST);
    const hits = this.collect(x, z, MISSILE_BLAST);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      const full = e === direct;
      const dealt = this.weaponHit(e, st.missileDamage * (full ? 1 : MISSILE_SPLASH), x, z, full ? 9 : 6);
      if (dealt > 0) {
        _tip.set(e.position.x, e.position.y + e.radius + 1.2, e.position.z);
        this.ctx.fx.floatText(_tip, `🚀${Math.round(dealt)}`, '#ffb060', 0.9);
      }
    }
    this.targets.length = 0;
  }

  /* ------------------------------------------------------------------ ISOTOPE */

  /** Dose a bot: (re)start its radiation timer. */
  private irradiate(e: EnemyHandle): void {
    if (e.alive) this.rads.set(e, RAD_SECONDS);
  }

  /** Radiation damage to one bot (player credit, irradiates it). */
  private radHit(e: EnemyHandle, amount: number, heal = false): void {
    if (!e.alive) return;
    this.irradiate(e);
    const hp0 = e.hp;
    const killed = this.b.enemies.damage(e, amount * this.b.stats.damageMult * this.hitMult(e), { source: 'other', fromX: e.position.x, fromZ: e.position.z });
    const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
    this.critCharge = Math.min(1, this.critCharge + dealt / NUKE_CHARGE_DMG);
    this.onPlayerHit(dealt, killed, e, false, heal);
  }

  /** Meltdown (F on ISOTOPE): a toxic blast around the plow that leaves a fallout pool behind. */
  private updateMeltdown(dt: number): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const plow = this.b.plow;
    if (st.meltDamage <= 0 || !plow || plow.dead) return;
    if (this.meltCharge < 1) this.meltCharge = Math.min(1, this.meltCharge + (st.meltCooldown > 0 ? dt / st.meltCooldown : 1));
    if (!this.b.input.wasPressed('KeyF')) return;
    if (this.critCharge >= 1) return this.armNuke(plow);
    if (this.meltCharge < 1) {
      this.b.audio.play('error');
      return;
    }
    this.meltCharge = 0;
    this.b.events.emit('ability', { nuke: false });
    const px = plow.position.x;
    const pz = plow.position.z;
    const R = st.meltRadius;
    _q.set(px, 0.15, pz);
    ctx.fx.ring(_q, R * 0.5, 0xb8ff6a);
    ctx.fx.ring(_q, R, 0x5dff3a);
    ctx.fx.ring(_q, R * 1.1, 0x1f8a10);
    ctx.fx.burst(_q, { color: 0x7dff4a, count: 50, speed: 13, size: 0.3, gravity: -2, life: 0.8 });
    ctx.fx.burst(_q, { color: 0xeaff6a, count: 24, speed: 7, size: 0.2, gravity: -6, life: 0.9 });
    _q.set(px, 2.2, pz);
    ctx.fx.burst(_q, { color: 0x3dff1a, count: 30, speed: 4, size: 0.5, gravity: -5, life: 1.2 });
    this.shake(0.7);
    this.impactHit('meltdown', _q.set(px, 1, pz));
    this.b.audio.play('thud', { pitch: 0.7 });
    this.b.audio.play('zap', { volume: 0.6, pitch: 0.5 });
    this.smashProps(px, pz, R);
    const hits = this.collect(px, pz, R);
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
    this.targets.length = 0;
    // Fallout pool: reuse a free disc, else the oldest.
    let pl = this.pools.find((x) => x.t <= 0);
    if (!pl) pl = this.pools.reduce((a, b) => (a.t < b.t ? a : b));
    pl.x = px;
    pl.z = pz;
    pl.r = st.poolRadius;
    pl.life = pl.t = st.poolSeconds;
    pl.tickT = 0;
    // The blast melts the snow, so the pool sits on bare ground.
    this.b.snow.melt(px, pz, pl.r, 1);
    pl.mesh.position.set(px, 0.06, pz);
    pl.mesh.scale.setScalar(pl.r);
    pl.mesh.visible = true;
  }

  /** Critical Mass full + F: the NUKE goes off right where the plow stands. */
  private armNuke(plow: PlowAPI): void {
    this.critCharge = 0;
    this.b.events.emit('ability', { nuke: true });
    this.nukeX = plow.position.x;
    this.nukeZ = plow.position.z;
    this.ctx.ui.toast(this.b.local ? '☢ NUKE!' : '☢ INCOMING NUKE!', 'big');
    this.detonate();
  }

  private detonate(): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const px = this.nukeX;
    const pz = this.nukeZ;
    const R = NUKE_RADIUS;
    this.smashProps(px, pz, R);
    // Flash, shockwave rings, a rising stem and a mushroom cap.
    _q.set(px, 0.2, pz);
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
      _q.set(px, 0.8 + i * 1.1, pz);
      const hot = i < 3;
      ctx.fx.smoke(_q, { count: 5, color: hot ? 0xffa43a : i < 5 ? 0xb8b088 : 0x8f8f78, additive: hot ? 0.3 : 0, size: 1.3 + i * 0.1, grow: 2, life: 2.6 + i * 0.12, speed: 0.8, up: 5 - i * 0.5, rise: 1, drag: 0.9, spread: 0.9, opacity: hot ? 0.8 : 0.72 });
    }
    _q.set(px, 9.5, pz);
    ctx.fx.smoke(_q, { count: 30, color: 0xa8a48a, size: 2.2, grow: 2.3, life: 3.4, speed: 6, up: 1.8, rise: 0.5, drag: 0.8, spread: 2.2, opacity: 0.8, radial: true });
    ctx.fx.smoke(_q, { count: 14, color: 0xffc860, additive: 0.35, size: 2, grow: 2, life: 1.6, speed: 3, up: 1, rise: 0.6, drag: 1, spread: 1.5, opacity: 0.75 });
    ctx.fx.smoke(_q, { count: 10, color: 0x7dff4a, additive: 0.3, size: 1.6, grow: 2.2, life: 2.2, speed: 7, up: 0.6, rise: 0.2, drag: 1, spread: 2, opacity: 0.5, radial: true });
    this.shake(1.8);
    this.impactHit('nuke', _q.set(px, 2, pz));
    this.b.audio.play('explosion');
    this.b.audio.play('thud', { pitch: 0.45 });
    this.b.audio.play('boss', { volume: 0.6, pitch: 0.6 });
    this.b.snow.melt(px, pz, R * 0.6, 1);
    const hits = this.collect(px, pz, R);
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
    this.targets.length = 0;
    // A huge fallout pool that lingers.
    let pl = this.pools.find((x) => x.t <= 0);
    if (!pl) pl = this.pools.reduce((a, b) => (a.t < b.t ? a : b));
    pl.x = px;
    pl.z = pz;
    pl.r = R * 0.55;
    pl.life = pl.t = st.poolSeconds * 2;
    pl.tickT = 0;
    pl.mesh.position.set(px, 0.06, pz);
    pl.mesh.scale.setScalar(pl.r);
    pl.mesh.visible = true;
  }

  /** Fallout pools: glow, bubble and dose every bot standing in them. */
  private updatePools(dt: number): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    for (const pl of this.pools) {
      if (pl.t <= 0) continue;
      pl.t -= dt;
      if (pl.t <= 0) {
        pl.mesh.visible = false;
        continue;
      }
      const fade = Math.min(1, pl.t / 0.8, (pl.life - pl.t) / 0.25 + 0.2);
      pl.mat.opacity = (0.32 + 0.08 * Math.sin(ctx.time * 6 + pl.x)) * fade;
      pl.tickT -= dt;
      if (pl.tickT > 0) continue;
      pl.tickT = POOL_TICK;
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * pl.r;
      _q.set(pl.x + Math.sin(a) * rr, 0.3, pl.z + Math.cos(a) * rr);
      ctx.fx.burst(_q, { color: 0x7dff4a, count: 2, speed: 1, size: 0.22, gravity: -3, life: 0.7 });
      if (st.poolDps <= 0 || st.meltDamage <= 0) continue;
      const hits = this.b.enemies.query(pl.x, pl.z, pl.r, this.chainBuf);
      for (let i = 0; i < hits.length; i++) this.radHit(hits[i], st.poolDps * POOL_TICK);
    }
  }

  /** Rad Aura (ISOTOPE): passive radiation that doses every bot near the plow. */
  private updateAura(dt: number): void {
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
      _q.set(plow.position.x + Math.sin(a) * rr, 0.4, plow.position.z + Math.cos(a) * rr);
      ctx.fx.burst(_q, { color: 0x5dff3a, count: 1, speed: 0.6, size: 0.18, gravity: -2.5, life: 0.6 });
    }
    const hits = this.b.enemies.query(plow.position.x, plow.position.z, R, this.chainBuf);
    for (let i = 0; i < hits.length; i++) this.radHit(hits[i], st.auraDps * TICK);
  }

  /** Radiation timers + the green glow over irradiated bots; Chain Reaction blasts from irradiated wrecks. */
  private updateRads(dt: number): void {
    const ctx = this.ctx;
    this.radFxT -= dt;
    const glow = this.radFxT <= 0;
    if (glow) this.radFxT = 0.25;
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
      _q.set(c.x, 0.6, c.z);
      ctx.fx.ring(_q, CHAIN_RADIUS, 0x7dff4a);
      ctx.fx.burst(_q, { color: 0x9dff5a, count: 22, speed: 9, size: 0.26, gravity: 2, life: 0.55 });
      this.b.audio.play('thud', { volume: 0.5, pitch: 1.3 });
      if (st.chainBlast <= 0) continue;
      const hits = this.b.enemies.query(c.x, c.z, CHAIN_RADIUS, this.chainBuf);
      for (let i = 0; i < hits.length; i++) this.radHit(hits[i], st.chainBlast);
    }
  }

  clear(betweenRounds = false): void {
    this.flameCone.hide();
    this.lightning.clear();
    this.clapCharge = 1;
    this.clapHeat = 0;
    this.lastClapAt = -999;
    this.stormT = 0;
    this.stormStrikes = 0;
    this.poundCharge = 1;
    if (this.poundT >= 0 && this.b.plow) this.b.plow.hop = 0;
    this.poundT = -1;
    this.shield = this.b.stats.shieldMax;
    this.shieldDelay = 0;
    this.flameT = 0;
    this.flameCharge = 1;
    this.burns.clear();
    this.fireFieldT = 0;
    this.fireField.visible = false;
    this.ultT = -1;
    this.ultLock = 0;
    this.ultMarks.length = 0;
    this.meltCharge = 1;
    this.missileCharge = 1;
    this.gunT = this.gunBurstT = 0;
    this.gunsOn = false;
    this.laserT = 0;
    this.laserOff = 0;
    this.netLaser = false;
    this.threat.clear();
    this.laserCore.visible = this.laserGlow.visible = false;
    for (const tr of this.tracers) tr.mesh.visible = false;
    for (const m of this.missiles) {
      m.live = false;
      m.mesh.visible = false;
    }
    if (!betweenRounds) this.critCharge = 0;
    this.rads.clear();
    this.chainQueue.length = 0;
    for (const pl of this.pools) {
      pl.t = 0;
      pl.mesh.visible = false;
    }
    this.guardT = 0;
    this.secondWindReadyAt = 0;
    this.iframe = 0;
    this.iframeDmg = 0;
    this.ramCd.clear();
    this.targets.length = 0;
  }

  update(dt: number): void {
    if (this.guardT > 0) this.guardT = Math.max(0, this.guardT - dt);
    this.updateFlame(dt);
    this.updateBurns(dt);
    this.updateFireField(dt);
    this.updateUlt(dt);
    this.updateClap(dt);
    this.updatePound(dt);
    this.updateStorm(dt);
    this.updateField(dt);
    this.updateSaws(dt);
    this.updateMeltdown(dt);
    this.updateThreat(dt);
    this.updateGuns(dt);
    this.updateLaser(dt);
    this.updateMissiles(dt);
    this.updatePools(dt);
    this.updateAura(dt);
    this.updateRads(dt);
    this.updateShield(dt);
    this.lightning.update(dt);
    if (this.iframe > 0) {
      this.iframe -= dt;
      if (this.iframe <= 0) {
        this.iframe = 0;
        this.iframeDmg = 0;
      }
    }
    this.pruneT -= dt;
    if (this.pruneT <= 0 && this.ramCd.size > 0) {
      this.pruneT = 2;
      const now = this.ctx.time;
      for (const [id, t] of this.ramCd) if (t <= now) this.ramCd.delete(id);
    }
  }
}
