import * as THREE from 'three';
import type { EnemyHandle } from '../../core/types';
import { settings } from '../../core/settings';
import { SingularityFx } from '../../fx/singularity';
import { Kit, type AbilityDesc, type VehicleKit, _fwd, _p, _q, _tip, wrapAngle, type CombatHost } from './shared';
import type { UltScript } from './ultimates';

/* ARSENAL: a magnetic / laser vehicle (two huge front wheels, a hovering gyro core at the back).
 *   SPACE  PULSE LASER   held: an auto-aiming continuous cyan beam (240° arc round the nose, turret traverse), damage
 *                        in ticks (gunRate per second), each tick a visible pulse.
 *   E      GRAV LANCE    1.5 s: SPLIT (thin beams lock onto up to lanceBeams bots ahead), PULL (they tug their bots
 *                        to a point ahead, small ticks), MERGE (one thick pulse straight ahead: most of the damage).
 *   F      POLARITY BURST the gyro folds into a disc, an event horizon expands to BURST_R m, every bot inside is pulled
 *                        to a singularity point ahead for ~1 s, then it detonates (damage, outward knockback).
 *   ULT    SINGULARITY   a black hole opens at the densest cluster within SING_SEEK m, drags every bot within SING_R
 *                        m into it for SING_PULL_T s (small ticks), collapses and explodes.
 *   passive SCRAP MAGNET wreck scrap orbits the vehicle as blades. */

/** Every ARSENAL weapon hits bots this many times harder outside the Duel (the vehicle's duel balance is unchanged). */
export const PVE_MULT = 3;
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
interface Shard { mesh: THREE.Mesh; state: 0 | 1 | 2; t: number; from: THREE.Vector3; slot: number; hitAt: Map<EnemyHandle, number> }

/** PULSE LASER: the turret only auto-aims within GUN_ARC rad either side of the hull's nose (a 240° arc: bots squarely
 *  behind are safe) and swings at most TURRET_SLEW rad/s. It holds fire until the emitter is within GUN_ON_TARGET rad
 *  of the target. GUN_BURST: what a single press fires when the input source can't report held keys. */
const GUN_ARC = 120 * (Math.PI / 180);
const GUN_ARC_COS = Math.cos(GUN_ARC);
const TURRET_SLEW = 3.2;
const GUN_ON_TARGET = 0.35;
/* The snowball / spin shop lines, re-purposed on ARSENAL so every bought level still does something:
 * Mega Hopper stretches the pulse laser's reach (HOPPER_RANGE m per m of max ball radius over the base 1.2 m),
 * Whirlwind Turbine speeds the turret traverse (WHIRL_SLEW per m of spin radius over 4 m),
 * Snow Compactor widens the Grav Lance's merge pulse (COMPACT_WIDTH m per unit of pack rate over the base 0.12). */
const HOPPER_RANGE = 5;
const WHIRL_SLEW = 0.35;
const COMPACT_WIDTH = 3;
/** Pulse-laser reach (m) with Mega Hopper. */
export const tankGunRange = (st: { gunRange: number; maxBallRadius: number }): number => st.gunRange + HOPPER_RANGE * Math.max(0, st.maxBallRadius - 1.2);
/** Turret slew multiplier with Whirlwind Turbine. */
export const tankSlewMult = (st: { whirlRadius: number }): number => 1 + WHIRL_SLEW * Math.max(0, st.whirlRadius - 4);
/** Grav Lance merge-pulse half-width (m) with Snow Compactor. */
export const tankBeamWidth = (st: { collectRate: number }): number => LANCE_WIDTH + COMPACT_WIDTH * Math.max(0, st.collectRate - 0.12);
const GUN_BURST = 0.5;
const GUN_KNOCK = 1.5;
/** Pulse beam: seconds it takes to fade after the trigger is released; how fast a tick's brightening decays (1/s). */
const BEAM_FADE = 0.12;
const BEAM_PULSE_DECAY = 12;
/** Emitter elevation limits (rad) and how fast it tilts. Targets outside the band are skipped. Line of sight through
 *  terrain / decks is required when terrain exists. */
const GUN_PITCH_MIN = -35 * (Math.PI / 180);
const GUN_PITCH_MAX = 45 * (Math.PI / 180);
const GUN_PITCH_SLEW = 2.5;
/** Emitter height above the plow's feet used for aim maths. */
const GUN_HEIGHT = 1.4;

/** GRAV LANCE timeline (s from the press): thin beams reach out until LANCE_SPLIT, pull ticks every LANCE_PULL_TICK
 *  from LANCE_SPLIT (LANCE_PULL_TICKS of them), the beams converge until LANCE_MERGE, then the merge pulse ticks
 *  every LANCE_MERGE_TICK (LANCE_MERGE_TICKS of them) until LANCE_SECONDS. A lone bot takes LANCE_SECONDS x laserDps
 *  in all (the old beam's single-target damage); LANCE_PULL_SHARE of it comes from its thin beam. */
const LANCE_SECONDS = 1.5;
const LANCE_SPLIT = 0.3;
const LANCE_PULL_TICK = 0.1;
const LANCE_PULL_TICKS = 9;
const LANCE_MERGE = 1.25;
const LANCE_MERGE_TICK = 0.05;
const LANCE_MERGE_TICKS = 5;
const LANCE_PULL_SHARE = 0.25;
/** Thin beams lock bots within LANCE_ARC rad of the nose; they tug them toward a point LANCE_POINT m ahead at up to
 *  LANCE_PULL m/s (bosses LANCE_BOSS x). Merge pulse half-width base (m). Max thin beams (FX.lanceBeams cap). */
const LANCE_ARC = 70 * (Math.PI / 180);
const LANCE_POINT = 5;
const LANCE_PULL = 8;
const LANCE_BOSS = 0.25;
const LANCE_WIDTH = 0.9;
const LANCE_MAX = 8;
/** Duel: no pull on a human; the thin-beam ticks only nudge them toward the point (knockback m/s). */
const LANCE_DUEL_TUG = 2;

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
const _hit = { t: 0, x: 0, y: 0, z: 0, what: 'ground' as 'ground' | number };

/** Unit cylinder along +Z (0..1): beams are scaled (width, width, length) and pointed with lookAt. */
function beamGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, 0.5);
  return g;
}
const glowMat = (color: number, opacity: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
/** Normal-blended tint: additive cyan washes out to white over sunlit snow, so the outer glows are painted on. */
const tintMat = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false });

/** Point a unit beam from `from` to `to` with half-width `w` (hidden when degenerate). */
function aimBeam(m: THREE.Mesh, from: THREE.Vector3, to: THREE.Vector3, w: number): void {
  const len = from.distanceTo(to);
  if (!(len > 1e-3)) {
    m.visible = false;
    return;
  }
  m.visible = true;
  m.position.copy(from);
  m.lookAt(to);
  m.scale.set(w, w, len);
}

/** ARSENAL: pulse laser, Grav Lance, Polarity Burst, the SINGULARITY and the Scrap Magnet (plus the duel guest's view). */
export class ArsenalKit extends Kit implements UltScript, VehicleKit {
  readonly primaryDesc: AbilityDesc = { icon: '🔷', label: 'PULSE', hint: 'hold for PULSE LASER' };
  readonly secondaryDesc: AbilityDesc = { icon: '🧲', label: 'LANCE', hint: 'GRAV LANCE' };
  /** SPACE state handed in by Combat (primary) for updateGuns this frame. */
  private trigHeld = false;
  private trigPressed = false;
  /** Pulse-laser tick timer + burst window. */
  private gunT = 0;
  private gunBurstT = 0;
  /** Pulse beam: core / glow / impact glow, its brightness (0..1, fades in / out), the tick flash (0..1), where it
   *  lands (the target's chest while it lives, else the last end point). */
  private beamCore!: THREE.Mesh;
  private beamGlow!: THREE.Mesh;
  private beamHit!: THREE.Mesh;
  private beamA = 0;
  private beamPulse = 0;
  private beamTgt: EnemyHandle | null = null;
  private beamEnd = new THREE.Vector3();
  private beamHasEnd = false;
  /** Grav Lance time left (s; 0 = idle) and ticks done. */
  laserT = 0;
  private pullTicks = 0;
  private mergeTicks = 0;
  /** Thin beams: locked bots (null = free beam, fanned out ahead), their meshes and free-beam fan angles. */
  private lanceTgt: (EnemyHandle | null)[] = [];
  private lanceBeams: THREE.Mesh[] = [];
  private lanceN = 0;
  private mergeCore!: THREE.Mesh;
  private mergeGlow!: THREE.Mesh;
  /** Polarity Burst recharge 0..1 (the F slot; the name is the old missile line's, net field NP.fReady). */
  missileCharge = 1;
  /** Polarity Burst: elapsed (-1 idle), singularity point, caught bots, meshes. */
  private burstT = -1;
  private burstAt = new THREE.Vector3();
  private burstY = 0;
  private horizon!: THREE.Mesh;
  private horizonIn!: THREE.Mesh;
  private burstCore!: THREE.Mesh;
  private burstGlow!: THREE.Mesh;
  private streakT = 0;
  /** Singularity: centre and FX (built on first use, only with a camera: headless sims have none). */
  private singAt = new THREE.Vector3();
  private singY = 0;
  private singFx: SingularityFx | null = null;
  private singTickT = 0;
  private singCollapsed = false;
  private singBlown = false;
  /** Is the pulse laser firing this frame (snapshot bit). The lance always fires straight ahead (net field NP.laser). */
  gunsOn = false;
  laserOff = 0;
  /** The emitter's elevation (rad, + up; the Plow tilts it). */
  gunPitch = 0;
  /** Commanded turret yaw off the hull nose (rad, within ±GUN_ARC), slewed at TURRET_SLEW; the Plow eases to it. */
  private turretCmd = 0;
  /** Duel guest: last host snapshot fire bits (diagnostics only; Combat routes them through primary / secondary),
   *  -1 = not a puppet. netTurret NaN = aim locally. */
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
  /** Shards flying in or orbiting (HUD / tests). */
  get scrapCount(): number {
    let n = 0;
    for (const s of this.shards) if (s.state) n++;
    return n;
  }

  /** A bot the player wrecked: if it was within SCRAP_PULL m, its scrap flies in to join the orbit ring (the oldest
   *  shard makes room when the ring is full). */
  scrapFrom(e: EnemyHandle): void {
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
    const y0 = (plow.surfaceY || 0) + 1.2;
    const R = st.scrapRadius;
    // Field cue: filings drifting in from the rim.
    if ((this.scrapFxT -= dt) <= 0) {
      this.scrapFxT = 0.18;
      const a = Math.random() * Math.PI * 2;
      _q.set(px + Math.sin(a) * R, y0 - 0.6, pz + Math.cos(a) * R);
      ctx.fx.burst(_q, { color: 0x8fb4c6, count: 1, speed: 0.5, size: 0.12, gravity: -1, life: 0.6 });
    }
    if ((this.scrapT -= dt) <= 0) {
      this.scrapT = SCRAP_TICK;
      if (!this.puppet) {
        const hits = this.collect(px, pz, R);
        for (let i = 0; i < hits.length; i++) this.weaponHit(hits[i], st.scrapDps * SCRAP_TICK, px, pz, 0);
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
        if (this.weaponHit(en, st.scrapHit, px, pz, 2) > 0) ctx.fx.burst(s.mesh.position, { color: 0xd8f4ff, count: 3, speed: 4, size: 0.1, gravity: 6, life: 0.2 });
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

  /** SPACE (VehicleKit): the pulse laser; updateGuns (run right after by Combat) reads the trigger. */
  primary(_dt: number, held: boolean, pressed: boolean): void {
    this.trigHeld = held;
    this.trigPressed = pressed;
    this.ultArmed = this.h.crit >= 1;
  }
  /** The meter was full at the start of this frame (Combat calls primary() first every frame): an F press only becomes
   *  the SINGULARITY when the HUD already showed it, not when this frame's own hits topped the meter up. */
  private ultArmed = false;

  /** E (VehicleKit): the Grav Lance; spends the E charge when it fires. */
  secondary(_dt: number, _held: boolean, pressed: boolean): boolean {
    return pressed && this.fireLaser();
  }

  /** Puppet bits: bit 0 = pulse laser firing, bit 1 = Grav Lance running. */
  netBits(): number {
    return (this.gunsOn ? 1 : 0) | (this.laserT > 0 ? 2 : 0);
  }

  private buildArsenalFx(scene: THREE.Scene): void {
    const beam = beamGeometry();
    const mk = (mat: THREE.Material, order = 3) => {
      const m = new THREE.Mesh(beam, mat);
      m.visible = false;
      m.renderOrder = order;
      m.frustumCulled = false;
      scene.add(m);
      return m;
    };
    // Pulse laser: a white-cyan core inside a wider cyan glow, plus a soft glow ball where it lands.
    this.beamCore = mk(glowMat(0xe8fdff, 0.95));
    this.beamGlow = mk(tintMat(0x14c8f5, 0.45), 2);
    this.beamHit = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), glowMat(CYAN, 0.7));
    this.beamHit.visible = false;
    this.beamHit.renderOrder = 3;
    scene.add(this.beamHit);
    // Grav Lance: LANCE_MAX thin beams and the thick merge pulse (core + glow).
    const thin = tintMat(0x22d4ff, 0.7);
    for (let i = 0; i < LANCE_MAX; i++) this.lanceBeams.push(mk(thin));
    this.mergeCore = mk(glowMat(0xffffff, 1));
    this.mergeGlow = mk(tintMat(0x14c8f5, 0.6), 2);
    // Polarity Burst: the expanding event-horizon ring (+ a fainter inner ring) and the singularity point.
    const ringMat = glowMat(CYAN, 0.8);
    ringMat.side = THREE.DoubleSide;
    this.horizon = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 72), ringMat);
    this.horizonIn = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 72), glowMat(0x1a8cb0, 0.25));
    (this.horizonIn.material as THREE.Material).side = THREE.DoubleSide;
    for (const r of [this.horizon, this.horizonIn]) {
      r.rotation.x = -Math.PI / 2;
      r.visible = false;
      r.renderOrder = 2;
      scene.add(r);
    }
    this.burstCore = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    this.burstGlow = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), glowMat(CYAN, 0.5));
    for (const m of [this.burstCore, this.burstGlow]) {
      m.visible = false;
      m.renderOrder = 3;
      scene.add(m);
    }
  }

  /** One weapon hit from ARSENAL (player credit). `direct`: rapid single-target fire (pulse ticks, lance ticks), see
   *  DamageOpts.direct. `knock` > 0 pushes away from (fromX, fromZ), < 0 pulls toward it. Returns damage dealt. */
  private weaponHit(e: EnemyHandle, amount: number, fromX: number, fromZ: number, knock: number, direct?: 'round' | 'beam'): number {
    if (!e.alive) return 0;
    const dx = e.position.x - fromX;
    const dz = e.position.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    const hp0 = e.hp;
    const killed = this.b.enemies.damage(e, amount * this.b.stats.damageMult * this.pveMult * this.hitMult(e), {
      source: 'other',
      knockback: new THREE.Vector3((dx / d) * knock, 0, (dz / d) * knock),
      fromX: knock < 0 ? e.position.x + (dx / d) * 2 : fromX,
      fromZ: knock < 0 ? e.position.z + (dz / d) * 2 : fromZ,
      direct,
    });
    const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
    this.onPlayerHit(dealt, killed, e);
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

  /* ------------------------------------------------------------------ SPACE: pulse laser */

  /** Pulse laser (SPACE, held): an auto-aiming beam that tracks bots within a 240° arc round the nose and deals its
   *  damage in gunRate ticks a second. A duel puppet fires when the host's snapshot says so. */
  updateGuns(dt: number): void {
    const held = this.trigHeld;
    const pressed = this.trigPressed;
    this.trigHeld = this.trigPressed = false;
    const st = this.b.stats;
    const plow = this.b.plow;
    this.gunsOn = false;
    if (plow) plow.gunFiring = false;
    if (st.gunDamage <= 0 || !plow) return this.drawBeam(dt);
    if (this.gunT > 0) this.gunT -= dt;
    if (plow.dead) return this.drawBeam(dt);
    // A press without held-key reporting fires a short burst; a puppet follows the host's held bit only.
    if (pressed && !this.puppet) this.gunBurstT = GUN_BURST;
    else if (this.gunBurstT > 0) this.gunBurstT -= dt;
    const firing = held || this.gunBurstT > 0;
    this.gunsOn = firing;
    plow.gunFiring = firing;
    const px = plow.position.x;
    const pz = plow.position.z;
    const py = plow.position.y + GUN_HEIGHT;
    const range = tankGunRange(st);
    const target = this.gunTarget(px, py, pz, plow.heading, range);
    // Turret swings (at TURRET_SLEW, never past the arc's edge) toward the target or settles forward; a duel guest
    // copies the host's aim.
    const targetYaw = target ? Math.atan2(target.position.x - px, target.position.z - pz) : 0;
    if (!Number.isNaN(this.netTurret)) plow.turretAim = this.turretCmd = this.netTurret;
    else {
      const want = target ? THREE.MathUtils.clamp(wrapAngle(targetYaw - plow.heading), -GUN_ARC, GUN_ARC) : 0;
      const ts = TURRET_SLEW * tankSlewMult(st) * dt;
      this.turretCmd += THREE.MathUtils.clamp(want - this.turretCmd, -ts, ts);
      plow.turretAim = this.turretCmd;
    }
    // The emitter tilts toward the target's chest (limited band, limited speed).
    const wantPitch = target ? this.pitchTo(px, py, pz, target) || 0 : 0;
    const pstep = GUN_PITCH_SLEW * dt;
    this.gunPitch += THREE.MathUtils.clamp(wantPitch - this.gunPitch, -pstep, pstep);
    plow.gunPitch = this.gunPitch;
    if (!firing || this.gunT > 0) return this.drawBeam(dt);
    // Wait for the turret to come round (and the emitter to lift) before the beam locks on.
    if (target && Math.abs(wrapAngle(targetYaw - plow.turretHeading)) > GUN_ON_TARGET) return this.drawBeam(dt);
    if (target && Math.abs(wantPitch - this.gunPitch) > GUN_ON_TARGET) return this.drawBeam(dt);
    this.gunT += 1 / Math.max(0.5, st.gunRate);
    if (this.gunT < 0) this.gunT = 0;
    plow.mountWorld('muzzle', 0, _p);
    if (target) {
      this.weaponHit(target, st.gunDamage, px, pz, GUN_KNOCK, 'round');
      this.beamTgt = target.alive ? target : null;
      this.chest(target, this.beamEnd);
      _fwd.subVectors(_p, this.beamEnd).normalize();
      this.ctx.fx.sparks(this.beamEnd, _fwd, { count: 3, color: CYAN, speed: 8, spread: 0.7, size: 0.05, life: 0.14, gravity: 6 });
    } else {
      this.beamTgt = null;
      const h = plow.turretHeading;
      const cp = Math.cos(this.gunPitch);
      const hx = Math.sin(h);
      const hz = Math.cos(h);
      const t = this.b.authoritative ? (this.ctx.world?.blastPropRay(_p.x, _p.z, hx, hz, range) ?? -1) : -1;
      let reach = t >= 0 ? t : range;
      // The beam stops at the first ramp, deck or hill in the way.
      const ter = this.ctx.terrain;
      if (ter?.active) {
        const hit = ter.raycast(_p.x, _p.y, _p.z, hx * cp, Math.sin(this.gunPitch), hz * cp, reach, _hit);
        if (hit) reach = hit.t;
      }
      this.beamEnd.set(_p.x + hx * cp * reach, _p.y + Math.sin(this.gunPitch) * reach, _p.z + hz * cp * reach);
    }
    this.beamHasEnd = true;
    this.beamPulse = 1;
    this.b.audio.play('pulse', { volume: 0.14, pitch: 0.8 + Math.random() * 0.1 });
    if (this.b.local) this.ctx.fx.shake(0.015);
    this.drawBeam(dt);
  }

  /** A bot's chest point (aim / beam end). */
  private chest(e: EnemyHandle, out: THREE.Vector3): THREE.Vector3 {
    return out.set(e.position.x, e.position.y + Math.min(1.2, e.radius * 0.6), e.position.z);
  }

  /** The continuous pulse beam from the emitter to its target (or last end point), brightening on every tick. */
  private drawBeam(dt: number): void {
    const on = this.gunsOn && this.beamHasEnd;
    this.beamA = on ? Math.min(1, this.beamA + dt * 25) : Math.max(0, this.beamA - dt / BEAM_FADE);
    this.beamPulse = Math.max(0, this.beamPulse - dt * BEAM_PULSE_DECAY);
    const plow = this.b.plow;
    if (this.beamA <= 0 || !plow) {
      this.beamCore.visible = this.beamGlow.visible = this.beamHit.visible = false;
      if (!on) this.beamHasEnd = false;
      return;
    }
    plow.mountWorld('muzzle', 0, _a);
    if (this.beamTgt?.alive) this.chest(this.beamTgt, this.beamEnd);
    const p = this.beamPulse;
    const flick = 0.85 + Math.random() * 0.3;
    const a = this.beamA;
    aimBeam(this.beamCore, _a, this.beamEnd, (0.03 + 0.04 * p) * flick * a);
    aimBeam(this.beamGlow, _a, this.beamEnd, (0.1 + 0.12 * p) * flick * a);
    (this.beamGlow.material as THREE.MeshBasicMaterial).opacity = (0.3 + 0.45 * p) * a;
    (this.beamCore.material as THREE.MeshBasicMaterial).opacity = (0.75 + 0.25 * p) * a;
    const hit = this.beamHit;
    hit.visible = !!this.beamTgt?.alive || p > 0.2;
    hit.position.copy(this.beamEnd);
    hit.scale.setScalar((0.2 + 0.35 * p) * flick * a);
  }

  /**
   * Elevation (rad) from an emitter at (x, y, z) to the best point on a bot's body within [min, max]: its chest when
   * that is in the band, else the nearest reachable part of it. NaN when no part of the bot is inside the band.
   */
  private pitchTo(x: number, y: number, z: number, e: EnemyHandle, min = GUN_PITCH_MIN, max = GUN_PITCH_MAX): number {
    const d = Math.max(0.5, Math.hypot(e.position.x - x, e.position.z - z) - e.radius * 0.5);
    const lo = Math.atan2(e.position.y - y, d);
    const hi = Math.atan2(e.position.y + Math.min(2.4, e.radius * 1.2) - y, d);
    if (hi < min || lo > max) return NaN;
    const chest = Math.atan2(e.position.y + Math.min(1.2, e.radius * 0.6) - y, d);
    return Math.min(Math.min(hi, max), Math.max(Math.max(lo, min), chest));
  }

  /** Can a weapon at (x, y, z) see the bot (terrain / decks in the way)? Always true on flat arenas. */
  private canSee(x: number, y: number, z: number, e: EnemyHandle): boolean {
    const ter = this.ctx.terrain;
    if (!ter?.active) return true;
    return ter.lineOfSight(x, y, z, e.position.x, e.position.y + Math.min(1.2, e.radius * 0.6), e.position.z);
  }

  /** Pulse-laser target: any bot in range within the 240° arc round the nose, within the emitter's elevation band and
   *  in sight, favouring bots near the nose and close by, then threats. */
  private gunTarget(x: number, y: number, z: number, heading: number, range: number): EnemyHandle | null {
    const hits = this.collect(x, z, range);
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    let best: EnemyHandle | null = null;
    let bestCost = Infinity;
    for (let pass = 0; pass < 3; pass++) {
      best = null;
      bestCost = Infinity;
      for (let i = 0; i < hits.length; i++) {
        const e = hits[i];
        if (!e.alive) continue;
        const dx = e.position.x - x;
        const dz = e.position.z - z;
        const d = Math.hypot(dx, dz);
        if (d > range + e.radius) continue;
        if (Number.isNaN(this.pitchTo(x, y, z, e))) continue;
        const cos = d > e.radius ? (dx * fx + dz * fz) / d : 1;
        // Outside the 240° arc (squarely behind the hull): the turret can't reach it.
        if (cos < GUN_ARC_COS) continue;
        // Off-nose bots cost up to 2x their distance; a bot that has been hurting you gets pulled forward.
        const cost = d * (1.5 - 0.5 * cos) - 0.1 * this.h.threat.of(e);
        if (cost < bestCost) {
          bestCost = cost;
          best = e;
        }
      }
      // Line of sight only for the winner (one raycast); a hidden winner drops out and the next best gets a look.
      if (!best || this.canSee(x, y, z, best)) break;
      const k = hits.indexOf(best);
      hits.splice(k, 1);
      best = null;
    }
    this.clearTargets();
    return best;
  }

  /* ------------------------------------------------------------------ E: Grav Lance */

  /** Grav Lance (E; the Plow pays the E charge). False if it can't fire. */
  fireLaser(): boolean {
    const st = this.b.stats;
    const plow = this.b.plow;
    if (st.laserDps <= 0 || this.laserT > 0 || !plow) return false;
    this.laserT = LANCE_SECONDS;
    this.pullTicks = this.mergeTicks = 0;
    this.laserOff = 0;
    this.lanceN = Math.max(1, Math.min(LANCE_MAX, st.lanceBeams || 4));
    plow.mountWorld('laser', 0, _p);
    this.lockLance(_p.x, _p.y, _p.z, plow.heading, st.laserRange);
    this.b.audio.play('zap', { pitch: 0.55, volume: 0.7 });
    this.b.audio.play('charge', { pitch: 1.4, volume: 0.45 });
    return true;
  }

  /** Lock up to lanceN different bots within reach and LANCE_ARC of the nose, in sight, by threat score. */
  private lockLance(x: number, y: number, z: number, heading: number, range: number): void {
    const hits = this.collect(x, z, range);
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    const cosArc = Math.cos(LANCE_ARC);
    const ranked: { e: EnemyHandle; s: number }[] = [];
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      const dx = e.position.x - x;
      const dz = e.position.z - z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.radius) continue;
      if (d > e.radius && (dx * fx + dz * fz) / d < cosArc) continue;
      ranked.push({ e, s: this.h.threat.score(e, x, z) });
    }
    this.clearTargets();
    ranked.sort((a, b) => b.s - a.s);
    this.lanceTgt.length = 0;
    for (const r of ranked) {
      if (this.lanceTgt.length >= this.lanceN) break;
      if (this.canSee(x, y, z, r.e)) this.lanceTgt.push(r.e);
    }
  }

  /** The lance's pull point: LANCE_POINT m ahead of the nose, on the ground. */
  private lancePoint(out: THREE.Vector3): THREE.Vector3 {
    const plow = this.b.plow;
    return out.set(plow.position.x + Math.sin(plow.heading) * LANCE_POINT, plow.position.y + 1, plow.position.z + Math.cos(plow.heading) * LANCE_POINT);
  }

  updateLaser(dt: number): void {
    const plow = this.b.plow;
    if (this.laserT <= 0) return;
    this.laserT -= dt;
    if (!plow || plow.dead) return this.endLance();
    const st = this.b.stats;
    const el = LANCE_SECONDS - this.laserT;
    plow.gyroCharge = Math.min(1, el / 0.3);
    plow.mountWorld('laser', 0, _p);
    const P = this.lancePoint(_q);
    const total = st.laserDps * LANCE_SECONDS;
    const merging = el >= LANCE_MERGE;
    // Thin beams: out to their bots (a free beam fans out ahead), converging on the pull point before the merge.
    const reach = Math.min(1, el / LANCE_SPLIT);
    const conv = THREE.MathUtils.smoothstep(el, 1.15, LANCE_MERGE);
    const n = Math.max(this.lanceN, 1);
    for (let i = 0; i < LANCE_MAX; i++) {
      const m = this.lanceBeams[i];
      if (merging || i >= n) {
        m.visible = false;
        continue;
      }
      const e = this.lanceTgt[i];
      if (i < this.lanceTgt.length && (!e || !e.alive)) {
        m.visible = false;
        continue;
      }
      if (e) this.chest(e, _tip);
      else {
        // Free beam (nothing locked, or a duel puppet): fanned across the front arc.
        const a = plow.heading + ((i + 0.5) / n - 0.5) * LANCE_ARC * 1.4;
        _tip.set(_p.x + Math.sin(a) * 12, _p.y + 0.3 * Math.sin(el * 9 + i), _p.z + Math.cos(a) * 12);
      }
      _tip.lerp(P, conv);
      _a.copy(_p).lerp(_tip, reach);
      aimBeam(m, _p, _a, (0.06 + 0.025 * Math.sin(el * 40 + i * 2)) * (1 + conv));
    }
    (this.lanceBeams[0].material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.3 * Math.random();
    // PULL: drag each locked bot toward the point (bots only; bosses barely), small ticks.
    if (el >= LANCE_SPLIT && el < LANCE_MERGE) {
      for (const e of this.lanceTgt) if (e?.alive) this.pullBot(e, P.x, P.z, LANCE_PULL * (e.isBoss ? LANCE_BOSS : 1), dt);
      if ((this.streakT -= dt) <= 0) {
        this.streakT = 0.06;
        for (const e of this.lanceTgt) {
          if (!e?.alive) continue;
          this.chest(e, _tip);
          _fwd.subVectors(P, _tip).normalize();
          this.ctx.fx.sparks(_tip, _fwd, { count: 1, color: CYAN, speed: 9, spread: 0.2, size: 0.05, life: 0.25, gravity: 0, length: 0.08 });
        }
      }
    }
    while (this.pullTicks < LANCE_PULL_TICKS && el >= LANCE_SPLIT + this.pullTicks * LANCE_PULL_TICK) {
      this.pullTicks++;
      if (this.puppet) continue;
      const tug = this.canPull ? 0 : -LANCE_DUEL_TUG;
      for (const e of this.lanceTgt) if (e?.alive) this.weaponHit(e, (total * LANCE_PULL_SHARE) / LANCE_PULL_TICKS, P.x, P.z, tug, 'beam');
    }
    // MERGE: one thick, very bright pulse straight ahead through the clump.
    if (merging) {
      const fx = Math.sin(plow.heading);
      const fz = Math.cos(plow.heading);
      let L = st.laserRange;
      const ter = this.ctx.terrain;
      if (ter?.active) {
        const hit = ter.raycast(_p.x, _p.y, _p.z, fx, 0, fz, L, _hit);
        if (hit) L = Math.max(0.5, hit.t);
      }
      _a.set(_p.x + fx * L, _p.y, _p.z + fz * L);
      const k = THREE.MathUtils.clamp((LANCE_SECONDS - el) / (LANCE_SECONDS - LANCE_MERGE), 0, 1);
      const w = tankBeamWidth(st) / LANCE_WIDTH;
      const flick = 0.9 + Math.random() * 0.2;
      aimBeam(this.mergeCore, _p, _a, 0.22 * w * flick * (0.4 + 0.6 * k));
      aimBeam(this.mergeGlow, _p, _a, 0.75 * w * flick * (0.5 + 0.5 * k));
      (this.mergeGlow.material as THREE.MeshBasicMaterial).opacity = 0.65 * k + 0.1;
      if (this.mergeTicks === 0) this.mergeFlash(_p, P, L);
      while (this.mergeTicks < LANCE_MERGE_TICKS && el >= LANCE_MERGE + this.mergeTicks * LANCE_MERGE_TICK) {
        this.mergeTicks++;
        if (this.b.authoritative && this.mergeTicks === 1) this.ctx.world?.blastPropRay(_p.x, _p.z, fx, fz, L);
        if (!this.puppet) this.mergeHit(_p, fx, fz, L, (total * (1 - LANCE_PULL_SHARE)) / LANCE_MERGE_TICKS);
      }
    }
    if (this.laserT <= 0) this.endLance();
  }

  /** Merge pulse start: flash at the lens, a shockwave ring through the clump, a kick. */
  private mergeFlash(from: THREE.Vector3, P: THREE.Vector3, L: number): void {
    const fx = this.ctx.fx;
    fx.burst(from, { color: 0xffffff, count: 10, speed: 7, size: 0.14, gravity: 0, life: 0.2 });
    fx.ring(_tip.set(P.x, (this.b.plow.surfaceY || 0) + 0.15, P.z), 5, CYAN);
    fx.sparks(P, null, { count: 18, color: CYAN, speed: 14, size: 0.06, life: 0.3, gravity: 2 });
    this.b.snow.melt(P.x, P.z, 2, 0.5);
    this.b.audio.play('zap', { pitch: 0.35, volume: 1 });
    this.b.audio.play('shockwave', { pitch: 1.3, volume: 0.6 });
    this.shake(0.22);
    if (this.b.local) this.impactHit('slam', P, 0.6, { stop: false });
    void L;
  }

  /** One merge-pulse tick on every bot whose chest is within the pulse's half-width of the beam line. */
  private mergeHit(from: THREE.Vector3, fx: number, fz: number, L: number, dmg: number): void {
    const w = tankBeamWidth(this.b.stats) + 0.3;
    const hits = this.collect(from.x + fx * L * 0.5, from.z + fz * L * 0.5, L * 0.5 + 2);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      const dx = e.position.x - from.x;
      const dy = e.position.y + Math.min(1.2, e.radius * 0.6) - from.y;
      const dz = e.position.z - from.z;
      const along = dx * fx + dz * fz;
      if (along < -e.radius || along > L + e.radius) continue;
      if (Math.hypot(dx - fx * along, dz - fz * along) > w + e.radius || Math.abs(dy) > 2.5 + e.radius) continue;
      const dealt = this.weaponHit(e, dmg, from.x, from.z, 4, 'beam');
      if (dealt > 0 && this.mergeTicks === 1) {
        _tip.set(e.position.x, e.position.y + e.radius + 1, e.position.z);
        this.ctx.fx.floatText(_tip, `${Math.round(dealt)}`, '#7ff0ff', 0.8);
      }
    }
    this.clearTargets();
  }

  private endLance(): void {
    this.laserT = 0;
    for (const m of this.lanceBeams) m.visible = false;
    this.mergeCore.visible = this.mergeGlow.visible = false;
    this.lanceTgt.length = 0;
    if (this.b.plow && this.h.ultIdle) this.b.plow.gyroCharge = 0;
  }

  /* ------------------------------------------------------------------ F: Polarity Burst */

  /** Polarity Burst (F on ARSENAL), or the SINGULARITY when the meter is full. Runs the burst once it's out. */
  updateBurst(dt: number): void {
    const st = this.b.stats;
    const plow = this.b.plow;
    this.tickBurst(dt);
    this.tickSingFx(dt);
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
    for (const m of [this.horizon, this.horizonIn]) {
      m.visible = vis;
      m.position.set(S.x, this.burstY + 0.12, S.z);
      m.scale.setScalar(r);
    }
    (this.horizon.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.35 * Math.sin(t * 30) * Math.sin(t * 7) + 0.2 * shut;
    (this.horizonIn.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.2 * shut;
    this.horizon.rotation.z = t * 2;
    const coreK = vis ? 0.2 + 0.25 * open + 0.35 * shut + 0.05 * Math.sin(t * 40) : 0;
    this.burstCore.visible = this.burstGlow.visible = vis;
    this.burstCore.position.copy(S);
    this.burstGlow.position.copy(S);
    this.burstCore.scale.setScalar(coreK);
    this.burstGlow.scale.setScalar(coreK * 4);
    this.burstCore.rotation.set(t * 5, t * 7, 0);
    (this.burstGlow.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.3 * shut;
    // Pull every bot inside the horizon toward the point, with streaks.
    if (t >= BURST_OPEN * 0.5 && t < BURST_DET) {
      const hits = this.collect(S.x, S.z, r);
      const streak = (this.streakT -= dt) <= 0;
      if (streak) this.streakT = 0.05;
      for (let i = 0; i < hits.length; i++) {
        const e = hits[i];
        if (!e.alive) continue;
        this.pullBot(e, S.x, S.z, BURST_PULL * (e.isBoss ? BURST_BOSS : 1), dt);
        if (streak) {
          this.chest(e, _tip);
          _fwd.subVectors(S, _tip).normalize();
          this.ctx.fx.sparks(_tip, _fwd, { count: 2, color: CYAN, speed: 12, spread: 0.15, size: 0.06, life: 0.25, gravity: 0, length: 0.1 });
        }
      }
      this.clearTargets();
      if (streak) {
        // Snow and filings spiralling in from the rim.
        const a = Math.random() * Math.PI * 2;
        _tip.set(S.x + Math.sin(a) * r, this.burstY + 0.3, S.z + Math.cos(a) * r);
        _fwd.set(S.x - _tip.x + Math.cos(a) * r * 0.4, 0.3, S.z - _tip.z - Math.sin(a) * r * 0.4).normalize();
        this.ctx.fx.sparks(_tip, _fwd, { count: 3, color: 0xbff8ff, speed: 14, spread: 0.2, size: 0.05, life: 0.4, gravity: 0, length: 0.08 });
      }
    }
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
    _tip.set(S.x, this.burstY + 0.15, S.z);
    fx.ring(_tip, BURST_DET_R * 1.6, CYAN);
    fx.ring(_tip, BURST_DET_R * 0.9, 0xbff8ff);
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
      this.singFx ??= new SingularityFx(this.ctx.scene, { reduceFlash: settings.reduceFlash });
      this.singFx.open(this.singAt, SING_VIS_R);
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
          if (e.alive && Math.hypot(e.position.x - C.x, e.position.z - C.z) <= SING_R + e.radius) this.weaponHit(e, dmg, C.x, C.z, tug);
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
      const dealt = this.weaponHit(e, per * k, C.x, C.z, SING_KNOCK);
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
    this.scrapT = 0;
    this.gunT = this.gunBurstT = 0;
    this.gunsOn = false;
    this.beamA = this.beamPulse = 0;
    this.beamTgt = null;
    this.beamHasEnd = false;
    this.beamCore.visible = this.beamGlow.visible = this.beamHit.visible = false;
    this.endLance();
    this.laserOff = 0;
    this.gunPitch = 0;
    this.trigHeld = this.trigPressed = false;
    this.burstT = -1;
    for (const m of [this.horizon, this.horizonIn, this.burstCore, this.burstGlow]) m.visible = false;
    const plow = this.b.plow;
    if (plow) plow.gyroFlat = plow.gyroCharge = 0;
  }
}
