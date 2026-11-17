import * as THREE from 'three';
import type { EnemyHandle, PlowAPI } from '../../core/types';
import { Focus, Kit, Reach, _p, _q, castOrigin, waveFloor, type AbilityDesc, type CastOrigin, type CombatHost, type VehicleKit } from './shared';
import { ultBlast, type UltScript } from './ultimates';
import { Shockwaves, type ShockPalette } from './arsenalFx';
import { Chains, GhostTrail, HauntMarks, HuntDome, PhantomMeshes, ScytheArcs } from './revenantFx';
import { REV_BRIGHT, REV_CORE, REV_DEEP, REV_EDGE } from '../vehicles/revenant';

/* REVENANT: the possessed hearse. SOULS (0-10, the Reliquary) come from wrecks and from bots it PHASES through; they
 * pay for SOUL GRASP and, banked, empower THE WILD HUNT.
 *   - HAUNT (passive): a bot phased through is Haunted for hauntSeconds: chained to the hearse, it takes +hauntVuln
 *     damage from it (Combat.hitMult), and wrecked while Haunted it drops a soul and rises as a PHANTOM that charges
 *     the nearest bot and bursts in ghostfire (kills chain through a pack);
 *   - SPACE (hold) REAP: scythe sweeps alternating sides, REAP_RATE a second across a REAP_ARC arc out to reapReach;
 *     every BIG_EVERY-th is the big Reap (wider, x2, Haunted bots hit twice);
 *   - E PHASE: PHASE_SECONDS spectral (Plow.phased: +30% speed, untouchable, no pulls / knockback, through bots and
 *     props); every bot passed through is Haunted (+1 soul, PHASE_SOULS a Phase at most); on exit MANIFEST, a
 *     ghostfire shockwave that grows with the souls taken in the Phase;
 *   - F SOUL GRASP (GRASP_COST souls): chains from the Reliquary yank every Haunted bot within graspRange and stun it
 *     (none Haunted: they seize the nearest GRASP_SEIZE and Haunt them). Duel: a DUEL_GRASP_HOLD s hold;
 *   - ultimate THE WILD HUNT (F with the meter full, combat/ultimates.ts): three tolls, the arena darkens; for
 *     HUNT_SECONDS the hearse rides phased at the head of HUNT_RIDERS phantom hearses (+1 per banked soul) that follow
 *     its exact path and trample everything on it, then converge and ERUPT (bigger per soul spent; souls consumed). */

/** PHASE: top speed multiplier (Plow), seconds, souls a Phase can take, extra contact reach (m). */
export const PHASE_SPEED = 1.3;
export const PHASE_SECONDS = 1.2;
export const PHASE_SOULS = 3;
const PHASE_TOUCH = 0.5;
/** MANIFEST: +damage share and +radius (m) per soul taken in the Phase; outward knock. */
export const MANIFEST_SOUL = 0.25;
export const MANIFEST_SOUL_R = 0.8;
const MANIFEST_KNOCK = 9;
export const SOULS_MAX = 10;
export const GRASP_COST = 3;
/** SOUL GRASP recharge (s, Overclock in): wreck-fed souls in a crowd would otherwise chain-cast it. */
export const GRASP_CD = 1.5;
/** Bots the chains seize when none in reach is Haunted. */
const GRASP_SEIZE = 3;
/** Yank: seconds of pull, top pull speed (m/s), where it stops (m from the hearse's centre). */
const GRASP_YANK = 0.4;
const GRASP_PULL = 42;
const GRASP_STOP = 3.6;
/** Duel: SOUL GRASP holds the other pilot this long (DamageOpts.hold), and souls come from damage dealt instead of
 *  wrecks: one per DUEL_SOUL_FRAC of the foe's max HP. */
export const DUEL_GRASP_HOLD = 0.6;
/** Duel: REAP sweeps hit the other pilot this hard (the scythe is a blade hit: no area diminishing returns, and the
 *  foe it Haunts takes +25% on top, so at full strength it won nearly every high-tier trade in scripts/balance/duel2). */
export const DUEL_REAP = 0.8;
export const DUEL_SOUL_FRAC = 0.1;
/** REAP: sweeps a second (Overclock speeds it up), half arc (rad), every BIG_EVERY-th is a big Reap (BIG_WIDTH x the
 *  reach and arc, BIG_MULT x damage, Haunted bots hit twice); knockback (m/s). */
export const REAP_RATE = 2.5;
export const REAP_HALF = (70 * Math.PI) / 180;
export const BIG_EVERY = 3;
const BIG_WIDTH = 1.2;
export const BIG_MULT = 2;
const REAP_KNOCK = 3;
/** Scythe origin: ahead of the hearse's centre (the blade), and its height above the floor. */
const REAP_FWD = 1.2;
const REAP_Y = 1.0;
/** PHANTOMS: pool, rise / fade seconds, dash speed (m/s) and longest dash (s), seek and burst radius (m). */
const MAX_PHANTOMS = 4;
const PH_RISE = 0.35;
const PH_DASH_SPEED = 22;
const PH_DASH_MAX = 0.8;
const PH_FADE = 0.5;
const PH_SEEK = 14;
export const PH_BURST_R = 3.5;
/** THE WILD HUNT: ride seconds, base riders (+1 per banked soul, up to MAX_RIDERS), seconds between riders on the
 *  path, trample reach (m) and per-rider per-bot cooldown (s), trample damage (x graspDamage), finale converge time,
 *  finale damage (x graspDamage: base + per soul spent) and reach (m), beacon toll gap. */
export const HUNT_SECONDS = 7;
export const HUNT_RIDERS = 8;
const MAX_RIDERS = HUNT_RIDERS + SOULS_MAX;
const RIDER_GAP = 0.42;
const RIDER_R = 2.3;
const RIDER_CD = 0.5;
export const HUNT_TRAMPLE = 1.6;
const FINALE_IN = 0.45;
export const FINALE_BASE = 4;
export const FINALE_SOUL = 0.5;
const FINALE_R = 10;
const TOLL_GAP = 0.4;
/** Riders stacked within ORBIT_IN of the hearse (it is parked) circle it instead, the ring widening from ORBIT_R by
 *  ORBIT_GROW m a second (riders on three lanes ORBIT_LANE apart). */
const ORBIT_IN = 3.2;
const ORBIT_R = 3.6;
const ORBIT_GROW = 1.1;
const ORBIT_LANE = 1.6;
/** Path history: samples a second, capacity. */
const PATH_HZ = 30;
const PATH_N = 256;
/** Reliquary in model space (vehicles/revenant.ts RELIC_POS): chain anchor. */
const RELIC_Y = 2.95;
const RELIC_Z = -1.45;

/* Constant FX options for per-frame / per-hit paths (hoisted so they are not rebuilt per call; never mutated). */
const WISP_SMOKE = { count: 1, color: REV_CORE, size: 0.45, grow: 2.2, life: 0.7, speed: 0.6, up: 1.2, rise: 0.8, drag: 1.5, spread: 0.5, opacity: 0.6 };
const WISP_DARK = { count: 1, color: REV_DEEP, size: 0.5, grow: 2, life: 0.8, speed: 0.4, up: 0.6, rise: 0.4, drag: 1.5, spread: 0.6, opacity: 0.45 };
const SOUL_BURST = { color: REV_BRIGHT, count: 10, speed: 4, size: 0.16, gravity: -4, life: 0.6 };
const SOUL_BURST_DARK = { color: REV_DEEP, count: 6, speed: 3, size: 0.2, gravity: -2, life: 0.7 };
const REAP_SPARKS = { color: REV_BRIGHT, count: 6, speed: 7, spread: 0.6, size: 0.08, length: 0.05, gravity: 6, life: 0.3 };
const REAP_HIT = { color: REV_CORE, count: 5, speed: 4, size: 0.14, gravity: 4, life: 0.4 };
const PH_TRAIL = { count: 1, color: 0xcfb0ff, size: 0.4, grow: 2, life: 0.5, speed: 0.3, up: 0.4, rise: 0.4, drag: 2, spread: 0.3, opacity: 0.55 };
const PH_BURST = { color: REV_BRIGHT, count: 26, speed: 9, size: 0.22, gravity: 2, life: 0.55 };
const PH_BURST_DARK = { count: 8, color: REV_DEEP, size: 0.8, grow: 2.4, life: 0.8, speed: 5, up: 1, rise: 0.6, drag: 2, spread: 0.6, opacity: 0.7, radial: true };
/** Rider wake: violet-white ghostfire puffs (glowing, not smoke) + a few bright streaking embers. */
const RIDER_TRAIL = { count: 1, color: 0xc89cff, size: 0.55, grow: 2.2, life: 0.7, speed: 0.4, up: 0.8, rise: 0.8, drag: 1.5, spread: 0.8, opacity: 0.55, additive: 0.5 };
const RIDER_EMBERS = { color: REV_BRIGHT, count: 2, speed: 3, spread: 1, size: 0.07, length: 0.06, gravity: -3, life: 0.5 };
/** Hunt ground mist: a pale violet haze (light, so the riders stay the darkest-edged, brightest thing on screen). */
const HUNT_FOG = { count: 3, color: 0x7a4ab0, size: 2.4, grow: 1.8, life: 2, speed: 1.2, up: 0, rise: 0.05, drag: 0.6, spread: 6, opacity: 0.22, additive: 0.25, radial: true };
const TRAMPLE_HIT = { color: REV_BRIGHT, count: 8, speed: 6, size: 0.16, gravity: 6, life: 0.4 };
const PHASE_PUFF = { count: 10, color: REV_CORE, size: 0.7, grow: 2.4, life: 0.7, speed: 3, up: 1.5, rise: 0.6, drag: 2, spread: 0.9, opacity: 0.6 };
const GRASP_BURST = { color: REV_BRIGHT, count: 30, speed: 7, size: 0.2, gravity: -2, life: 0.6 };
const GRASP_SMOKE = { count: 10, color: REV_DEEP, size: 0.8, grow: 2, life: 0.8, speed: 4, up: 1, rise: 0.4, drag: 2, spread: 0.4, opacity: 0.7 };
const PH_RISE_SMOKE = { count: 6, color: 0xcfb0ff, size: 0.6, grow: 2, life: 0.6, speed: 1.5, up: 2.5, rise: 1, drag: 2, spread: 0.5, opacity: 0.6 };
const FINALE_SMOKE = { count: 30, color: 0x8a50d0, size: 1.4, grow: 2.4, life: 1.1, speed: 14, up: 2, rise: 0.6, drag: 2.2, spread: 1, opacity: 0.7, additive: 0.45, radial: true };
/** Finale: a column of violet ghostfire bursting up from the hearse. */
const FINALE_PILLAR = { count: 24, color: 0xc89cff, size: 1.3, grow: 2.2, life: 1.1, speed: 2.5, up: 15, rise: 3, drag: 1.2, spread: 1.4, opacity: 0.85, additive: 0.5 };
const FINALE_BURST = { color: REV_BRIGHT, count: 90, speed: 20, size: 0.32, gravity: 1, life: 0.9 };
/** ...a second, wider and slower ghostfire cloud, and the white-violet core flash. */
const FINALE_SMOKE_2 = { count: 24, color: 0xc890ff, size: 2, grow: 2.6, life: 1.5, speed: 9, up: 3, rise: 1, drag: 1.6, spread: 2, opacity: 0.6, additive: 0.7, radial: true };
const FINALE_CORE = { count: 2, color: 0xe8d0ff, size: 4, grow: 1.6, life: 0.4, speed: 0, up: 0, rise: 0, drag: 0, spread: 0.6, opacity: 0.75, additive: 0.8 };
const FINALE_WHITE = { color: 0xffffff, count: 20, speed: 9, size: 0.25, gravity: -2, life: 0.6 };
/** Share of MANIFEST and PHANTOM burst damage that fills THE WILD HUNT's meter (area bursts chain through a pack:
 *  at full share the meter filled in a few seconds of a crowded fight but took a minute on a boss). */
export const BURST_ULT_SHARE = 0.34;
/** ...and a REAP sweep's damage past its nearest target. */
export const REAP_ULT_SPLASH = 0.3;
/** Innate lifesteal: every PHANTOM hit (REAP, MANIFEST, SOUL GRASP, SHADE bursts; not THE WILD HUNT's own damage)
 *  repairs the plow by this share of the damage dealt (the Duel: REV_LIFESTEAL_DUEL), on top of the Salvage Rig perk. */
export const REV_LIFESTEAL = 0.06;
export const REV_LIFESTEAL_DUEL = 0.03;
const GHOST_PALETTE: ShockPalette = { band: REV_CORE, hot: REV_BRIGHT, wall: REV_DEEP, tint: 0xc890ff };

const _kb = new THREE.Vector3();
const _f = new THREE.Vector3();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();

interface Phantom {
  on: boolean;
  t: number;
  /** 0 rise, 1 dash, 2 fade. */
  stage: number;
  x: number;
  y: number;
  z: number;
  r: number;
  target: EnemyHandle | null;
  dashT: number;
}

interface Grasped {
  e: EnemyHandle;
  t: number;
}

export class RevenantKit extends Kit implements VehicleKit, UltScript {
  readonly primaryDesc: AbilityDesc = { icon: '🌙', label: 'REAP', hint: 'hold to REAP' };
  readonly secondaryDesc: AbilityDesc = { icon: '👻', label: 'PHASE', hint: 'PHASE through them', cooldown: () => this.b.stats.phaseCooldown || 6 };

  /** Souls in the Reliquary (0..SOULS_MAX). */
  souls = 0;
  /** Haunted bots -> seconds of Haunt left. */
  readonly haunts = new Map<EnemyHandle, number>();
  /** PHASE seconds left (0 = solid), souls taken in this Phase, bots already passed through in it. */
  phaseT = 0;
  private phaseSouls = 0;
  private readonly touched = new Set<number>();
  /** REAP: next-sweep timer, sweeps so far (every BIG_EVERY-th is big), last sweep's side and its glow 0..1 (rig). */
  private reapT = 0;
  reapN = 0;
  /** +1 / -1: which way the last Reap swung (the hearse's blade whips that way). */
  reapSide = 1;
  reapGlow = 0;
  /** Duel: damage dealt toward the next soul. */
  private duelAcc = 0;
  /** WILD HUNT: elapsed (-1 = none), riders, souls banked at the start, beacon tolls rung, finale done. */
  huntT = -1;
  private riders = 0;
  private huntSouls = 0;
  tolls = 0;
  private finaleDone = false;
  private readonly riderHit: Map<number, number>[] = [];
  private readonly riderPos: { x: number; z: number; h: number; ok: boolean }[] = [];
  private readonly huntFrom: CastOrigin = { y: 0, deck: -1 };
  /** Path history ring (x, z, heading) at PATH_HZ; `pathAcc` time toward the next sample. */
  private readonly path = new Float32Array(PATH_N * 3);
  private pathHead = 0;
  private pathCount = 0;
  private pathAcc = 0;
  private readonly phantoms: Phantom[] = [];
  private readonly grasped: Grasped[] = [];
  private readonly buf: EnemyHandle[] = [];
  private readonly near: EnemyHandle[] = [];
  private clock = 0;
  private fogT = 0;
  // Visuals (lazily built on first use so non-REVENANT pilots never pay for them).
  private fx: { arcs: ScytheArcs; chains: Chains; marks: HauntMarks; ph: PhantomMeshes; trail: GhostTrail; dome: HuntDome; shock: Shockwaves } | null = null;

  constructor(h: CombatHost) {
    super(h);
    for (let i = 0; i < MAX_PHANTOMS; i++) this.phantoms.push({ on: false, t: 0, stage: 0, x: 0, y: 0, z: 0, r: 1, target: null, dashT: 0 });
    for (let i = 0; i < MAX_RIDERS; i++) {
      this.riderHit.push(new Map());
      this.riderPos.push({ x: 0, z: 0, h: 0, ok: false });
    }
  }

  private get vis() {
    if (!this.fx) {
      const scene = this.ctx.scene;
      this.fx = {
        arcs: new ScytheArcs(scene),
        chains: new Chains(scene),
        marks: new HauntMarks(scene),
        ph: new PhantomMeshes(scene, MAX_PHANTOMS),
        trail: Object.assign(new GhostTrail(scene, MAX_RIDERS), { camera: this.ctx.camera ?? null }),
        dome: new HuntDome(scene),
        shock: new Shockwaves(scene, 3, GHOST_PALETTE),
      };
    }
    return this.fx;
  }

  /** Build the effects now (hidden) so the load-time warm-up compiles them (render/warmup.ts). */
  prewarm(): void {
    void this.vis;
  }

  private get live(): boolean {
    return this.b.stats.plowKind === 'revenant';
  }

  /** Extra damage multiplier on a Haunted bot (1 when not Haunted). */
  vuln(e: EnemyHandle): number {
    return this.haunts.has(e) ? 1 + (this.b.stats.hauntVuln || 0.25) : 1;
  }

  /** Haunt a bot (restarts its timer). */
  haunt(e: EnemyHandle): void {
    if (e.alive) this.haunts.set(e, this.b.stats.hauntSeconds || 6);
  }

  /** Add souls (capped) with a wisp from `from` (optional) to the Reliquary. */
  addSouls(n: number, from?: THREE.Vector3): void {
    if (n <= 0) return;
    const was = this.souls;
    this.souls = Math.min(SOULS_MAX, this.souls + n);
    if (this.souls === was) return;
    const ctx = this.ctx;
    if (from) {
      ctx.fx.burst(from, SOUL_BURST);
      ctx.fx.burst(from, SOUL_BURST_DARK);
    }
    this.relicWorld(_q);
    ctx.fx.burst(_q, SOUL_BURST);
    if (this.b.local && this.souls >= GRASP_COST && was < GRASP_COST) this.b.audio.play('charge', { pitch: 1.4, volume: 0.35 });
  }

  /** Where the Reliquary floats right now (world). */
  private relicWorld(out: THREE.Vector3): THREE.Vector3 {
    const plow = this.b.plow;
    const s = Math.sin(plow.heading);
    const c = Math.cos(plow.heading);
    return out.set(plow.position.x + s * RELIC_Z, (plow.surfaceY || 0) + RELIC_Y, plow.position.z + c * RELIC_Z);
  }

  /* ------------------------------------------------------------------ SPACE: REAP */

  primary(dt: number, held: boolean, _pressed: boolean): void {
    this.reapT -= dt;
    this.reapGlow = Math.max(0, this.reapGlow - dt * 4);
    if (!held || this.reapT > 0) {
      if (!held && this.reapT < 0) this.reapT = 0;
      return;
    }
    const st = this.b.stats;
    this.reapT = Math.max(0, this.reapT + 1 / (REAP_RATE / Math.max(0.5, st.cooldownMult || 1)));
    const plow = this.b.plow;
    if (!plow || plow.dead) return;
    this.reapN++;
    this.reapSide = -this.reapSide;
    const big = this.reapN % BIG_EVERY === 0;
    this.reap(plow, big);
  }

  /** One scythe sweep from the blade: every bot in the arc ahead (Body reach). */
  private reap(plow: PlowAPI, big: boolean): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    plow.getForward(_f);
    const ox = plow.position.x + _f.x * REAP_FWD;
    const oz = plow.position.z + _f.z * REAP_FWD;
    const floor = plow.surfaceY || 0;
    const reach = (st.reapReach || 7) * (big ? BIG_WIDTH : 1);
    const half = Math.min(Math.PI * 0.95, REAP_HALF * (big ? BIG_WIDTH : 1));
    const cosHalf = Math.cos(half);
    this.reapGlow = big ? 1 : 0.6;
    this.vis.arcs.spawn(ox, floor + REAP_Y, oz, plow.heading, reach, this.reapSide, big);
    this.b.audio.play(big ? 'slam' : 'whirlTick', { volume: big ? 0.45 : 0.3, pitch: big ? 0.7 : 0.9 + Math.random() * 0.15 });
    if (big) {
      this.shake(0.25);
      _q.set(ox + _f.x * reach * 0.5, floor + 0.2, oz + _f.z * reach * 0.5);
      ctx.fx.ring(_q, reach * 0.6, REV_CORE);
    }
    this.smashProps(ox + _f.x * reach * 0.5, oz + _f.z * reach * 0.5, reach * 0.6);
    if (st.reapDamage <= 0) return;
    const dmg = st.reapDamage * (big ? BIG_MULT : 1) * (this.b.pvp ? DUEL_REAP : 1);
    const hits = this.collect(ox, oz, reach, Reach.Body);
    // In the arc (inside the hull's own reach always counts); the nearest fills the Hunt's meter in full, the rest at
    // REAP_ULT_SPLASH.
    let n = 0;
    let near = -1;
    let nd = Infinity;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      const dx = e.position.x - ox;
      const dz = e.position.z - oz;
      const d = Math.hypot(dx, dz);
      if (d > e.radius + 1.2 && (dx * _f.x + dz * _f.z) / (d || 1) < cosHalf) continue;
      if (d < nd) {
        nd = d;
        near = n;
      }
      hits[n++] = e;
    }
    for (let i = 0; i < n; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      this.h.ultFeedShare = i === near ? 1 : REAP_ULT_SPLASH;
      // (Duel: one hit; a second big Reap on a Haunted pilot two-shot the lighter plows.)
      const twice = big && !this.b.pvp && this.haunts.has(e) ? 2 : 1;
      for (let k = 0; k < twice && e.alive; k++) this.hit(e, dmg, ox, oz, REAP_KNOCK * (big ? 1.6 : 1), { blade: big || !this.b.pvp, kind: Focus.Primary });
      _p.set(e.position.x, e.position.y + e.radius, e.position.z);
      ctx.fx.burst(_p, REAP_HIT);
      ctx.fx.sparks(_p, null, REAP_SPARKS);
    }
    this.h.ultFeedShare = 1;
    this.clearTargets();
  }

  /** One hit on a bot (x damage mult x the host's hit mult, Haunt included), knocked away from (fx, fz). `kind`: the
   *  hit's FOCUS kind (an `ult` hit is always Ult). */
  private hit(e: EnemyHandle, dmg: number, fx: number, fz: number, knock: number, opts?: { stun?: number; hold?: number; ult?: boolean; area?: boolean; blade?: boolean; kind?: Focus }): number {
    const dx = e.position.x - fx;
    const dz = e.position.z - fz;
    const d = Math.hypot(dx, dz) || 1;
    const hp0 = e.hp;
    const killed = this.b.enemies.damage(e, dmg * this.b.stats.damageMult * this.focus(opts?.ult ? Focus.Ult : opts?.kind ?? Focus.Neutral) * this.hitMult(e), {
      // The scythe is a blade hit (melee, like BRUTUS's fists: no Duel area-ability diminishing returns).
      source: opts?.blade ? 'ram' : 'other',
      crackArmor: opts?.blade || undefined,
      knockback: knock > 0 ? _kb.set((dx / d) * knock, 0, (dz / d) * knock) : undefined,
      stunSeconds: opts?.stun,
      hold: opts?.hold,
      ult: opts?.ult,
      weapon: opts?.ult ? 'wildHunt' : undefined,
      area: opts?.area,
      fromX: fx,
      fromZ: fz,
    });
    const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
    const plow = this.b.plow;
    if (dealt > 0 && !opts?.ult && plow && !plow.dead) plow.hp = Math.min(plow.maxHp, plow.hp + dealt * (this.b.pvp ? REV_LIFESTEAL_DUEL : REV_LIFESTEAL));
    this.onPlayerHit(dealt, killed, e, true, !opts?.ult);
    return dealt;
  }

  /* ------------------------------------------------------------------ E: PHASE */

  secondary(dt: number, _held: boolean, pressed: boolean): boolean {
    const plow = this.b.plow;
    let fired = false;
    if (pressed && plow && !plow.dead && this.phaseT <= 0 && this.huntT < 0) {
      fired = true;
      this.phaseT = PHASE_SECONDS;
      this.phaseSouls = 0;
      this.touched.clear();
      _q.set(plow.position.x, (plow.surfaceY || 0) + 1.2, plow.position.z);
      this.ctx.fx.smoke(_q, PHASE_PUFF);
      this.ctx.fx.burst(_q, SOUL_BURST);
      this.b.audio.play('dash', { volume: 0.5, pitch: 0.6 });
      this.b.audio.play('freeze', { volume: 0.35, pitch: 0.7 });
    }
    if (this.phaseT > 0) {
      this.phaseT -= dt;
      if (plow && !plow.dead) {
        // Ghostfire wisps trail the spectral hull.
        if (Math.random() < dt * 30) {
          plow.getForward(_f);
          _q.set(plow.position.x - _f.x * 2.2 + (Math.random() - 0.5) * 1.6, (plow.surfaceY || 0) + 0.6 + Math.random() * 1.4, plow.position.z - _f.z * 2.2 + (Math.random() - 0.5) * 1.6);
          this.ctx.fx.smoke(_q, Math.random() < 0.6 ? WISP_SMOKE : WISP_DARK);
        }
        const hits = this.b.enemies.query(plow.position.x, plow.position.z, plow.radius + PHASE_TOUCH, this.near);
        for (let i = 0; i < hits.length; i++) if (this.reaches(hits[i], Reach.Body)) this.phaseTouch(hits[i]);
      }
      if (this.phaseT <= 0) {
        this.phaseT = 0;
        if (plow && !plow.dead) this.manifest(plow);
      }
    }
    return fired;
  }

  /** PHASE passes through `e`: Haunt it, +1 soul (PHASE_SOULS a Phase; bots only: the Duel's souls come from damage). */
  phaseTouch(e: EnemyHandle): void {
    if (this.phaseT <= 0 || !e.alive || this.touched.has(e.id)) return;
    this.touched.add(e.id);
    this.haunt(e);
    _p.set(e.position.x, e.position.y + e.radius, e.position.z);
    this.ctx.fx.burst(_p, SOUL_BURST);
    this.b.audio.play('steal', { volume: 0.35, pitch: 0.6 + this.phaseSouls * 0.12 });
    if (this.phaseSouls < PHASE_SOULS && !this.b.pvp) {
      this.phaseSouls++;
      this.addSouls(1, _p);
    }
  }

  /** MANIFEST: the Phase ends in a ghostfire shockwave, bigger with the souls taken in it. */
  private manifest(plow: PlowAPI): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const n = this.phaseSouls;
    const R = (st.manifestRadius || 5) + MANIFEST_SOUL_R * n;
    const px = plow.position.x;
    const pz = plow.position.z;
    const floor = plow.surfaceY || 0;
    this.vis.shock.spawn(px, floor, pz, R, { dur: 0.5, flashR: 1.6 + n * 0.4, flashY: 1.2, wallH: 1.6 + n * 0.3 });
    _q.set(px, floor + 0.15, pz);
    ctx.fx.ring(_q, R, REV_DEEP);
    ctx.fx.smoke(_q, { count: 12 + n * 4, color: REV_DEEP, size: 0.9, grow: 2.2, life: 0.8, speed: 8 + n, up: 1, rise: 0.5, drag: 2.5, spread: 0.6, opacity: 0.7, radial: true });
    ctx.fx.burst(_q, { color: REV_BRIGHT, count: 20 + n * 8, speed: 10 + n * 2, size: 0.2, gravity: 2, life: 0.6 });
    this.shake(0.35 + n * 0.12);
    this.b.audio.play('shockwave', { volume: 0.5 + n * 0.1, pitch: 0.75 });
    this.smashProps(px, pz, R * 0.6);
    const whirl = Math.sqrt(Math.max(1, (st.whirlDamage || 10) / 10));
    const dmg = (st.manifestDamage || 0) * (1 + MANIFEST_SOUL * n) * whirl;
    if (dmg <= 0 || st.reapDamage <= 0) return;
    const hits = this.collect(px, pz, R, Reach.Wave);
    this.h.ultFeedShare = BURST_ULT_SHARE;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      const dealt = this.hit(e, dmg, px, pz, MANIFEST_KNOCK, { area: true, kind: Focus.Ability });
      if (dealt > 0) {
        _p.set(e.position.x, e.position.y + e.radius + 1.1, e.position.z);
        ctx.fx.floatText(_p, `👻${Math.round(dealt)}`, '#d8a8ff', 1);
      }
    }
    this.h.ultFeedShare = 1;
    this.clearTargets();
  }

  /* ------------------------------------------------------------------ F: SOUL GRASP / ultimate */

  /** F: the Wild Hunt with the meter full, else SOUL GRASP (GRASP_COST souls). */
  updateGrasp(dt: number): void {
    if (this.graspCd > 0) this.graspCd = Math.max(0, this.graspCd - dt);
    const st = this.b.stats;
    const plow = this.b.plow;
    if (!this.live || st.reapDamage <= 0 || !plow) return;
    if (!this.b.input.wasPressed('KeyF') || plow.dead) return;
    if (this.h.crit >= 1 && this.h.ultIdle) return this.h.startUlt('revenant', plow);
    if (this.souls < GRASP_COST || this.huntT >= 0 || this.graspCd > 0) {
      this.b.audio.play('error');
      return;
    }
    this.grasp(plow);
  }

  /** F ready 0..1: souls toward GRASP_COST (full at GRASP_COST and off its short recharge), -1 off REVENANT. */
  get graspReady(): number {
    if (!this.live || this.b.stats.reapDamage <= 0) return -1;
    const souls = this.souls >= GRASP_COST ? 1 : Math.min(0.99, this.souls / GRASP_COST);
    return this.graspCd > 0 ? Math.min(souls, 0.99 * (1 - this.graspCd / GRASP_CD)) : souls;
  }
  private graspCd = 0;

  private grasp(plow: PlowAPI): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const R = st.graspRange || 20;
    const px = plow.position.x;
    const pz = plow.position.z;
    // Every Haunted bot in reach; none: the chains seize the nearest few and Haunt them.
    const cand = this.b.enemies.query(px, pz, R, this.buf);
    let n = 0;
    for (let i = 0; i < cand.length; i++) if (cand[i].alive && this.haunts.has(cand[i])) cand[n++] = cand[i];
    if (n === 0) {
      // Seize: nearest GRASP_SEIZE (selection by distance, in place).
      const all = this.b.enemies.query(px, pz, R, this.buf);
      for (let k = 0; k < all.length && k < GRASP_SEIZE; k++) {
        let best = k;
        let bd = Infinity;
        for (let j = k; j < all.length; j++) {
          const d = Math.hypot(all[j].position.x - px, all[j].position.z - pz);
          if (all[j].alive && d < bd) {
            bd = d;
            best = j;
          }
        }
        const tmp = all[k];
        all[k] = all[best];
        all[best] = tmp;
      }
      n = Math.min(GRASP_SEIZE, all.length);
      for (let i = 0; i < n; i++) this.haunt(all[i]);
    }
    if (n === 0) {
      this.b.audio.play('error');
      return;
    }
    this.souls -= GRASP_COST;
    this.b.events.emit('ability', { nuke: false });
    this.relicWorld(_q);
    ctx.fx.burst(_q, GRASP_BURST);
    ctx.fx.smoke(_q, GRASP_SMOKE);
    this.b.audio.play('stun', { volume: 0.6, pitch: 0.6 });
    this.b.audio.play('steal', { volume: 0.5, pitch: 0.5 });
    this.shake(0.4);
    const pvp = !!this.b.pvp;
    // Overclock x Ability Focus (shorter), never under 0.4 x the base.
    this.graspCd = GRASP_CD * Math.max(0.4, (st.cooldownMult || 1) * (st.abilityCdMult || 1));
    this.h.ultFeedShare = BURST_ULT_SHARE;
    for (let i = 0; i < n; i++) {
      const e = this.buf[i];
      if (!e.alive) continue;
      this.grasped.push({ e, t: GRASP_YANK });
      this.hit(e, st.graspDamage, px, pz, 0, { stun: st.graspStun || 1, hold: pvp ? DUEL_GRASP_HOLD : undefined, kind: Focus.Ability });
      _p.set(e.position.x, e.position.y + e.radius + 1.2, e.position.z);
      ctx.fx.floatText(_p, '⛓ SEIZED', '#e0a8ff', 0.9);
    }
    this.h.ultFeedShare = 1;
    if (this.grasped.length > 16) this.grasped.splice(0, this.grasped.length - 16);
  }

  /** WILD HUNT start (Ultimates): three tolls, darkening; riders from the banked souls. Returns the meter lock. */
  ultStart(_x: number, _z: number, plow: PlowAPI): number {
    this.huntT = 0;
    this.huntSouls = this.souls;
    this.riders = Math.min(MAX_RIDERS, HUNT_RIDERS + this.souls);
    this.finaleDone = false;
    this.tolls = 0;
    this.phaseT = 0;
    castOrigin(plow, this.huntFrom);
    for (const m of this.riderHit) m.clear();
    for (const r of this.riderPos) r.ok = false;
    this.b.audio.play('boss', { volume: 0.7, pitch: 0.55 });
    return HUNT_SECONDS + FINALE_IN + 1;
  }

  ultTick(t: number, _dt: number, _x: number, _z: number, _from: CastOrigin): boolean {
    // The Hunt itself runs in update() (it follows the hearse, not the cast point).
    return t >= HUNT_SECONDS + FINALE_IN + 0.1 || this.huntT < 0;
  }

  /* ------------------------------------------------------------------ hit hooks (Combat.onPlayerHit) */

  /** Combat.onPlayerHit: souls from wrecks (bots) or from damage dealt (Duel); a Haunted wreck drops a soul and rises
   *  as a phantom. */
  onHit(dealt: number, killed: boolean, target: EnemyHandle | undefined): void {
    if (!this.live || !target) return;
    if (this.b.pvp) {
      if (dealt <= 0) return;
      this.duelAcc += dealt;
      const step = Math.max(1, target.maxHp * DUEL_SOUL_FRAC);
      let n = 0;
      while (this.duelAcc >= step) {
        this.duelAcc -= step;
        n++;
      }
      if (n) this.addSouls(n);
      return;
    }
    if (!killed) return;
    const haunted = this.haunts.has(target);
    _from.set(target.position.x, target.position.y + target.radius, target.position.z);
    this.addSouls((target.isBoss || target.type === 'rival' ? 2 : 1) + (haunted ? 1 : 0), _from);
    if (haunted) {
      this.haunts.delete(target);
      this.risePhantom(target);
    }
  }

  private risePhantom(e: EnemyHandle): void {
    const p = this.phantoms.find((x) => !x.on);
    if (!p) return;
    p.on = true;
    p.t = 0;
    p.stage = 0;
    p.x = e.position.x;
    p.y = e.position.y;
    p.z = e.position.z;
    p.r = Math.max(0.8, Math.min(2.2, e.radius));
    p.target = null;
    p.dashT = 0;
    _p.set(p.x, p.y + 1, p.z);
    this.ctx.fx.smoke(_p, PH_RISE_SMOKE);
    this.b.audio.play('freeze', { volume: 0.3, pitch: 1.3 });
  }

  /* ------------------------------------------------------------------ per frame */

  /** Haunt timers + tethers, phantoms, Grasp yanks, the Wild Hunt, the hearse's phase flag. Every frame. */
  update(dt: number): void {
    this.clock += dt;
    const plow = this.b.plow;
    const live = this.live && !!plow;
    if (!live) {
      if (this.fx && (this.haunts.size || this.huntT >= 0)) this.clear();
      return;
    }
    this.recordPath(plow, dt);
    for (const [e, t] of this.haunts) {
      const left = t - dt;
      if (left <= 0 || !e.alive) this.haunts.delete(e);
      else this.haunts.set(e, left);
    }
    this.updateGrasped(dt);
    this.updatePhantoms(dt);
    if (this.huntT >= 0) this.updateHunt(dt, plow);
    plow.phased = !plow.dead && (this.phaseT > 0 || this.huntT >= 0);
    this.draw(plow, dt);
  }

  private recordPath(plow: PlowAPI, dt: number): void {
    this.pathAcc += dt;
    if (this.pathAcc < 1 / PATH_HZ && this.pathCount > 0) return;
    this.pathAcc = Math.min(this.pathAcc - 1 / PATH_HZ, 1 / PATH_HZ);
    if (this.pathAcc < 0) this.pathAcc = 0;
    this.pathHead = (this.pathHead + 1) % PATH_N;
    const o = this.pathHead * 3;
    this.path[o] = plow.position.x;
    this.path[o + 1] = plow.position.z;
    this.path[o + 2] = plow.heading;
    this.pathCount = Math.min(PATH_N, this.pathCount + 1);
  }

  /** Where the hearse was `delay` s ago (clamped to the oldest sample). False if no history. */
  private pathAt(delay: number, out: { x: number; z: number; h: number }): boolean {
    if (this.pathCount === 0) return false;
    const back = Math.min(this.pathCount - 1, Math.max(0, delay * PATH_HZ));
    const i0 = Math.floor(back);
    const f = back - i0;
    const a = ((this.pathHead - i0) % PATH_N + PATH_N) % PATH_N;
    const b = ((this.pathHead - Math.min(this.pathCount - 1, i0 + 1)) % PATH_N + PATH_N) % PATH_N;
    out.x = this.path[a * 3] * (1 - f) + this.path[b * 3] * f;
    out.z = this.path[a * 3 + 1] * (1 - f) + this.path[b * 3 + 1] * f;
    const ha = this.path[a * 3 + 2];
    const hb = this.path[b * 3 + 2];
    out.h = ha + Math.atan2(Math.sin(hb - ha), Math.cos(hb - ha)) * f;
    return true;
  }

  private updateGrasped(dt: number): void {
    const plow = this.b.plow;
    for (let i = this.grasped.length - 1; i >= 0; i--) {
      const g = this.grasped[i];
      g.t -= dt;
      const e = g.e;
      if (g.t <= -0.25 || !e.alive || plow.dead) {
        this.grasped.splice(i, 1);
        continue;
      }
      if (g.t <= 0) continue;
      const dx = plow.position.x - e.position.x;
      const dz = plow.position.z - e.position.z;
      const d = Math.hypot(dx, dz);
      if (d <= GRASP_STOP + e.radius) continue;
      const v = Math.min(GRASP_PULL, (d - GRASP_STOP) / Math.max(0.12, g.t));
      if (this.b.pvp) this.b.enemies.tow?.(e, dx / d, dz / d, 0.9, dt);
      else this.b.enemies.pull?.(e, (dx / d) * v, (dz / d) * v, dt);
    }
  }

  private updatePhantoms(dt: number): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    for (const p of this.phantoms) {
      if (!p.on) continue;
      p.t += dt;
      if (p.stage === 0) {
        p.y += dt * 1.5;
        if (p.t >= PH_RISE) {
          p.stage = 1;
          p.t = 0;
          p.target = this.nearestBot(p.x, p.z, PH_SEEK);
        }
      } else if (p.stage === 1) {
        const tg = p.target;
        p.dashT += dt;
        let arrived = !tg || !tg.alive;
        if (tg && tg.alive) {
          const dx = tg.position.x - p.x;
          const dz = tg.position.z - p.z;
          const d = Math.hypot(dx, dz);
          const step = PH_DASH_SPEED * dt;
          if (d <= step + tg.radius * 0.6) arrived = true;
          else {
            p.x += (dx / d) * step;
            p.z += (dz / d) * step;
            p.y += (tg.position.y - p.y) * Math.min(1, dt * 6);
          }
        }
        if (Math.random() < dt * 25) {
          _p.set(p.x, p.y + 1.4, p.z);
          ctx.fx.smoke(_p, PH_TRAIL);
        }
        if (arrived || p.dashT >= PH_DASH_MAX) {
          this.phantomBurst(p, st.phantomDamage || 0);
          p.stage = 2;
          p.t = 0;
        }
      } else if (p.t >= PH_FADE) {
        p.on = false;
      }
    }
  }

  private phantomBurst(p: Phantom, dmg: number): void {
    const ctx = this.ctx;
    _p.set(p.x, p.y + 1, p.z);
    ctx.fx.burst(_p, PH_BURST);
    ctx.fx.smoke(_p, PH_BURST_DARK);
    _q.set(p.x, p.y + 0.12, p.z);
    ctx.fx.ring(_q, PH_BURST_R, REV_CORE);
    this.b.audio.play('burst', { volume: 0.45, pitch: 0.7 });
    if (dmg <= 0) return;
    const hits = this.b.enemies.query(p.x, p.z, PH_BURST_R, this.near);
    // Copy out (damage may change the manager's lists).
    const n = hits.length;
    for (let i = 0; i < n && i < 12; i++) this.buf[i] = hits[i];
    this.h.ultFeedShare = BURST_ULT_SHARE;
    for (let i = 0; i < n && i < 12; i++) {
      const e = this.buf[i];
      if (!e.alive) continue;
      this.hit(e, dmg, p.x, p.z, 6, { area: true, kind: Focus.Primary });
    }
    this.h.ultFeedShare = 1;
  }

  private nearestBot(x: number, z: number, r: number): EnemyHandle | null {
    const q = this.b.enemies.query(x, z, r, this.near);
    let best: EnemyHandle | null = null;
    let bd = Infinity;
    for (let i = 0; i < q.length; i++) {
      const e = q[i];
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - x, e.position.z - z);
      if (d < bd && d > 0.3) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private readonly at = { x: 0, z: 0, h: 0 };

  private updateHunt(dt: number, plow: PlowAPI): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    this.huntT += dt;
    const t = this.huntT;
    // Three tolls of the beacon to open.
    while (this.tolls < 3 && t >= this.tolls * TOLL_GAP) {
      this.tolls++;
      this.b.audio.play('thud', { volume: 0.7, pitch: 0.42 + this.tolls * 0.04 });
      _q.set(plow.position.x, (plow.surfaceY || 0) + 0.2, plow.position.z);
      ctx.fx.ring(_q, 6 + this.tolls * 3, REV_CORE);
      this.shake(0.3);
    }
    const end = HUNT_SECONDS;
    const k = Math.min(1, t / 0.6) * (t > end + FINALE_IN ? Math.max(0, 1 - (t - end - FINALE_IN) / 0.5) : 1);
    this.vis.dome.set(k, plow.position.x, plow.position.z);
    this.fogT -= dt;
    if (this.fogT <= 0 && t < end) {
      this.fogT = 0.25;
      _q.set(plow.position.x, (plow.surfaceY || 0) + 0.3, plow.position.z);
      ctx.fx.smoke(_q, HUNT_FOG);
    }
    const px = plow.position.x;
    const pz = plow.position.z;
    const floor = plow.surfaceY || 0;
    const trample = (st.graspDamage || 34) * HUNT_TRAMPLE;
    // The riders are the sample points of ONE ghost trail flowing back along the hearse's path (point 0: its tail).
    const trail = this.vis.trail;
    const hh = plow.heading;
    trail.point(0, px - Math.sin(hh) * 2.2, floor, pz - Math.cos(hh) * 2.2, Math.min(1, t / 0.3));
    let pts = 1;
    let lift = 0;
    for (let i = 0; i < this.riders; i++) {
      const rp = this.riderPos[i];
      const delay = (i + 1) * RIDER_GAP;
      const appear = Math.min(1, Math.max(0, (t - 0.2 - i * 0.05) / 0.4));
      if (t < end) {
        if (!this.pathAt(delay, this.at)) continue;
        let tx = this.at.x;
        let tz = this.at.z;
        let th = this.at.h;
        // Parked (riders stacking on the hearse): the herd circles it instead.
        const dd = Math.hypot(tx - px, tz - pz);
        if (dd < ORBIT_IN) {
          const a = this.clock * 1.9 + (i / Math.max(1, this.riders)) * Math.PI * 2;
          const w = 1 - dd / ORBIT_IN;
          const or = ORBIT_R + ORBIT_GROW * t + (i % 3) * ORBIT_LANE;
          tx = tx * (1 - w) + (px + Math.sin(a) * or) * w;
          tz = tz * (1 - w) + (pz + Math.cos(a) * or) * w;
          th = th * (1 - w) + (a + Math.PI / 2) * w;
        }
        // A weave across the path so the column reads as a stampede.
        const weave = Math.sin(this.clock * 3 + i * 1.7) * 0.7;
        tx += Math.cos(th) * weave;
        tz -= Math.sin(th) * weave;
        if (!rp.ok) {
          rp.x = tx;
          rp.z = tz;
          rp.h = th;
          rp.ok = true;
        } else {
          const kk = Math.min(1, dt * 10);
          rp.x += (tx - rp.x) * kk;
          rp.z += (tz - rp.z) * kk;
          rp.h += Math.atan2(Math.sin(th - rp.h), Math.cos(th - rp.h)) * kk;
        }
        if (appear > 0.5) this.trample(i, rp.x, rp.z, trample);
        // Each rider runs on the ground under it (hills, the hearse's deck level), not at the hearse's height.
        const fy = waveFloor(ctx.terrain, floor, rp.x, rp.z);
        if (appear > 0.3 && Math.random() < dt * 9) {
          _p.set(rp.x - Math.sin(rp.h) * 2.6, fy + 0.9, rp.z - Math.cos(rp.h) * 2.6);
          ctx.fx.smoke(_p, RIDER_TRAIL);
          if (Math.random() < 0.5) ctx.fx.sparks(_p, null, RIDER_EMBERS);
        }
        if (pts === i + 1) trail.point(pts++, rp.x, fy, rp.z, appear);
      } else if (rp.ok) {
        // Finale: the trail coils round the hearse, tightening and rising, then erupts.
        const c = Math.min(1, (t - end) / FINALE_IN);
        const dx = rp.x - px;
        const dz = rp.z - pz;
        const sw = c * c * (2.2 + i * 0.12);
        const rr = Math.min(Math.hypot(dx, dz), 4 + i * 1.6) * (1 - c * c * 0.85);
        const a = Math.atan2(dx, dz) + sw;
        const x = px + Math.sin(a) * rr;
        const z = pz + Math.cos(a) * rr;
        if (pts === i + 1) trail.point(pts++, x, waveFloor(ctx.terrain, floor, x, z), z, 1);
        lift = c * 2.5;
      }
    }
    if (!this.finaleDone) trail.build(pts, k, lift);
    if (!this.finaleDone && t >= end + FINALE_IN) {
      this.finaleDone = true;
      trail.burst(px, floor, pz);
      this.finale(plow);
    }
    if (t >= end + FINALE_IN + 0.6) {
      this.huntT = -1;
      this.vis.dome.release();
    }
  }

  /** Rider `i` at (x, z) tramples every bot it reaches (each bot at most every RIDER_CD s per rider). */
  private trample(i: number, x: number, z: number, dmg: number): void {
    const hits = this.b.enemies.query(x, z, RIDER_R, this.near);
    if (!hits.length) return;
    const n = Math.min(12, hits.length);
    for (let k = 0; k < n; k++) this.buf[k] = hits[k];
    const seen = this.riderHit[i];
    const now = this.clock;
    for (let k = 0; k < n; k++) {
      const e = this.buf[k];
      if (!e.alive || !this.reaches(e, Reach.Body)) continue;
      if (now - (seen.get(e.id) ?? -9) < RIDER_CD) continue;
      seen.set(e.id, now);
      this.hit(e, dmg, x, z, 7, { ult: true });
      _p.set(e.position.x, e.position.y + e.radius, e.position.z);
      this.ctx.fx.burst(_p, TRAMPLE_HIT);
    }
  }

  private finale(plow: PlowAPI): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const souls = this.huntSouls;
    const R = FINALE_R + souls * 0.3;
    const px = plow.position.x;
    const pz = plow.position.z;
    const floor = plow.surfaceY || 0;
    // The spent trail's eruption (visuals larger than the blast's reach R, which is unchanged): a double shockwave,
    // rings racing out, a ghostfire column and a white-violet core flash.
    this.vis.shock.spawn(px, floor, pz, R * 1.3, { dur: 0.85, flashR: 3.2 + souls * 0.2, flashY: 2.2, wallH: 4.5 + souls * 0.3 });
    this.vis.shock.spawn(px, floor, pz, R * 0.75, { dur: 0.55, flashR: 2.5 + souls * 0.2, flashY: 1.2, wallH: 2.5 + souls * 0.15 });
    _q.set(px, floor + 0.2, pz);
    ctx.fx.ring(_q, R, REV_CORE);
    ctx.fx.ring(_q, R * 1.12, REV_EDGE);
    ctx.fx.ring(_q, R * 1.35, REV_BRIGHT);
    ctx.fx.ring(_q, R * 0.5, 0xffffff);
    ctx.fx.smoke(_q, FINALE_SMOKE);
    ctx.fx.smoke(_q, FINALE_SMOKE_2);
    ctx.fx.smoke(_q, FINALE_PILLAR);
    ctx.fx.smoke(_q, FINALE_CORE);
    ctx.fx.burst(_q, FINALE_BURST);
    ctx.fx.burst(_q, FINALE_WHITE);
    this.shake(1.5);
    this.impactHit('hunt', _q.set(px, floor + 1.5, pz), 0.75);
    this.b.audio.play('explosion', { volume: 0.8, pitch: 0.8 });
    this.b.audio.play('roar', { volume: 0.5, pitch: 0.5 });
    const dmg = (st.graspDamage || 34) * (FINALE_BASE + FINALE_SOUL * souls);
    ultBlast(this.h, px, pz, 0, R, dmg, { knock: 16, text: '⚰️', color: '#e0a8ff', reach: Reach.Wave, from: this.huntFrom, weapon: 'wildHunt' });
    // Banked souls are spent (souls taken during the Hunt stay).
    this.souls = Math.max(0, this.souls - souls);
  }

  /** Immediate-mode visuals: Haunt tethers + marks, Grasp chains, phantoms, scythe arcs. */
  private draw(plow: PlowAPI, dt: number): void {
    if (!this.fx && this.haunts.size === 0 && this.grasped.length === 0) return;
    const v = this.vis;
    v.arcs.update(dt);
    v.shock.update(dt);
    v.trail.update(dt);
    v.chains.begin();
    v.marks.begin();
    this.relicWorld(_from);
    for (const [e, t] of this.haunts) {
      if (!e.alive) continue;
      _to.set(e.position.x, e.position.y + e.radius * 1.1, e.position.z);
      if (Math.hypot(_to.x - plow.position.x, _to.z - plow.position.z) < 34) v.chains.add(_from, _to, this.clock, 0.45, 0.8);
      v.marks.add(e.position, e.radius, t / (this.b.stats.hauntSeconds || 6), this.clock);
    }
    for (const g of this.grasped) {
      if (!g.e.alive) continue;
      _to.set(g.e.position.x, g.e.position.y + g.e.radius, g.e.position.z);
      v.chains.add(_from, _to, this.clock * 2, 0.2, 1.5);
    }
    v.chains.end();
    v.marks.end();
    for (let i = 0; i < this.phantoms.length; i++) {
      const p = this.phantoms[i];
      const root = v.ph.roots[i];
      root.visible = p.on;
      if (!p.on) continue;
      const a = p.stage === 0 ? p.t / PH_RISE : p.stage === 1 ? 1 : 1 - p.t / PH_FADE;
      root.position.set(p.x, p.y + 0.1 * Math.sin(this.clock * 8 + i), p.z);
      root.scale.setScalar(p.r * (p.stage === 2 ? 1 + p.t * 1.5 : 1));
      const tg = p.target;
      if (tg && tg.alive) root.rotation.y = Math.atan2(tg.position.x - p.x, tg.position.z - p.z);
      v.ph.fills[i].opacity = 0.65 * Math.max(0, a);
    }
  }

  /** Combat.clear / bind: everything off. */
  clear(): void {
    const plow = this.b.plow;
    if (plow && plow.phased) plow.phased = false;
    this.souls = 0;
    this.haunts.clear();
    this.phaseT = 0;
    this.phaseSouls = 0;
    this.touched.clear();
    this.reapT = 0;
    this.reapN = 0;
    this.reapGlow = 0;
    this.duelAcc = 0;
    this.graspCd = 0;
    this.huntT = -1;
    this.tolls = 0;
    this.grasped.length = 0;
    for (const p of this.phantoms) p.on = false;
    for (const m of this.riderHit) m.clear();
    this.pathCount = 0;
    if (this.fx) {
      const v = this.fx;
      v.arcs.clear();
      v.chains.clear();
      v.marks.clear();
      v.ph.clear();
      v.trail.clear();
      v.dome.release();
      v.shock.clear();
    }
  }

  /** Between Duel rounds the Reliquary keeps its souls (like the ultimate meter): clear without emptying it. */
  clearKeepSouls(): void {
    const s = this.souls;
    this.clear();
    this.souls = s;
  }
}
