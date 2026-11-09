import * as THREE from 'three';
import type { EnemyHandle, PlowAPI } from '../../core/types';
import { Kit, type AbilityDesc, type VehicleKit, Reach, _p, _q, castOrigin, waveFloor, type CastOrigin } from './shared';
import { ultBlast, type UltScript } from './ultimates';

/** Knockback scratch for per-tick damage (Enemies.damage reads it immediately and never keeps it). */
const _kb = new THREE.Vector3();

/** TESLA ROVER: height of the coil tower's top orb above the plow's floor (arc origin; vehicles/volt.ts). */
const TOWER_Y = 3.15;
/** ARC LANCE (SPACE, hold): tick, damage per tick (x damage mult) on the locked bot, chain hops / share / reach,
 *  aim cone (cos of the half angle off the nose) and reach (+ Mega Hopper: ball radius above the 1.2 m base). */
const ARC_TICK = 0.15;
export const ARC_DAMAGE = 2.1;
// Design from the user: the ARC LANCE is the chain weapon — it chains a ton and can paralyse.
const ARC_HOPS = 6;
const ARC_CHAIN_FRAC = 0.5;
/** Each hop past the first keeps this share of the hop before it (a long chain thins out but still bites). */
const ARC_HOP_DECAY = 0.9;
const ARC_CHAIN_R = 8;
/** GROUNDED ARC: when the locked bot is a boss, or has nothing within ARC_CHAIN_R to chain to (a straggler), the arc
 *  grounds into it: ARC_SOLO x damage, facing only half its flat armour (the chain weapon was weakest on lone,
 *  armoured targets; bosses always have adds around them, so they ground regardless and the chain still runs on). */
export const ARC_SOLO = 1.75;
/** PARALYSIS: every arc hit (any hop) has PARA_CHANCE to lock the bot up for PARA_SECONDS (a stun); a paralysed bot
 *  can't be paralysed again for PARA_IMMUNE s after it wears off. */
const PARA_CHANCE = 0.07;
const PARA_SECONDS = 1.2;
const PARA_IMMUNE = 2.5;
const ARC_CONE = 0.5;
export const arcRange = (ballR: number) => 9 + 2.5 * Math.max(0, ballR - 1.2);
/** STATIC FIELD (E): a lingering electrified field that rides with the rover for STATIC_SECONDS, pulsing every
 *  STATIC_PULSE s: each pulse deals STATIC_DAMAGE (x damage mult) and stuns for STATIC_STUN to everything inside the
 *  radius (+ Tesla Field reach above its 4.5 m base). The first pulse is a bigger burst (STATIC_FIRST x). */
// Design from the user: Static Field stays a lingering, pulsing stun field; balance it through STATIC_DAMAGE / stun
// numbers, not by turning it back into a single ring.
export const STATIC_DAMAGE = 14;
/** STATIC FIELD leans only lightly on the coil (coilBoost to this power): an area stun, kept flat late. */
const STATIC_COIL_EXP = 0.2;
const STATIC_STUN = 0.7;
const STATIC_SECONDS = 2.5;
const STATIC_PULSE = 0.5;
const STATIC_FIRST = 1.6;
export const staticRadius = (fieldR: number) => 6.5 + Math.max(0, fieldR - 4.5);
/** Thunderclap upgrades overcharge the whole coil: ARC LANCE and STATIC FIELD grow with the clap's base damage. */
const coilBoost = (clapDamage: number) => Math.max(1, clapDamage / 36);
/** ARC LANCE leans harder on the coil than the field does: coilBoost to this power (balance: single-target DPS late). */
const ARC_COIL_EXP = 1.15;
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();

/** SUPERCELL (VOLT-9): SUPERCELL_WAVES waves of sky strikes on every bot within SUPERCELL_RADIUS, SUPERCELL_GAP s
 *  apart, each SUPERCELL_MULT x clap damage + a long shock. No Overload backlash. */
const SUPERCELL_RADIUS = 18;
const SUPERCELL_WAVES = 3;
const SUPERCELL_GAP = 0.5;
const SUPERCELL_MULT = 2.85;
/** SUPERCELL also leans a little on the coil (coilBoost to this power) so late ults keep pace with the others. */
const SUPERCELL_COIL_EXP = 0.12;
/** Thunderclap storm: duration, extra sky strikes (each = share of clap damage), field dps share. */
const STORM_SECONDS = 2.5;
const STORM_STRIKES = 6;
const STORM_STRIKE_FRAC = 0.4;
const STORM_FIELD_FRAC = 0.25;
/** Thunderclap backlash: a flat shock to the pilot, squared by Overload heat. Each clap adds 1 heat, which bleeds
 *  off at 1 per CLAP_HEAT_DECAY seconds, so a clap every ~3s costs CLAP_BACKLASH but chain-spamming (Overclock at
 *  0 cooldown) escalates fast: 6 → 15 → 29 → 47 → 69 → 96 at one clap per second. */
const CLAP_BACKLASH = 6;
const CLAP_HEAT_DECAY = 2.5;

/** VOLT-9: Thunderclap + storm + Overload, Tesla Field, Chain Lightning, Battery Shield and the SUPERCELL. */
export class VoltKit extends Kit implements UltScript, VehicleKit {

  /* ---- TESLA ROVER: SPACE ARC LANCE (hold) and E STATIC FIELD (VehicleKit, see ./shared.ts) ---- */
  readonly primaryDesc: AbilityDesc = { icon: '⚡', label: 'ARC', hint: 'hold for ARC LANCE' };
  readonly secondaryDesc: AbilityDesc = { icon: '💫', label: 'FIELD', hint: 'STATIC FIELD' };
  /** ARC LANCE: tick timer, the locked bot (kept while it stays in reach), and scratch for the chain hops. */
  private arcT = 0;
  private arcN = 0;
  private arcLock: EnemyHandle | null = null;
  private arcBuf: EnemyHandle[] = [];
  private arcHit = new Set<number>();
  /** PARALYSIS: bot id -> ctx.time it can be paralysed again. */
  private paraReady = new Map<number, number>();
  /** Is the lance firing this frame (HUD / tests). */
  arcOn = false;

  /** SPACE (hold): every ARC_TICK s an arc from the coil tower locks onto the nearest bot ahead (within ARC_CONE of
   *  the nose, ARC_RANGE + Mega Hopper reach) and chains on to ARC_HOPS (+ Chain Lightning arcs) more nearby. */
  primary(dt: number, held: boolean, _pressed: boolean): void {
    this.arcT -= dt;
    this.arcOn = held;
    if (this.b.plow) this.b.plow.voltArc = held && !this.b.plow.dead; // tower FX (vehicles/volt.ts)
    if (!held) {
      this.arcLock = null;
      return;
    }
    if (this.arcT > 0) return;
    // Overclock speeds the arc up like every other ability.
    const tick = (ARC_TICK * Math.max(0.4, this.b.stats.cooldownMult || 1)) / (this.b.stats.arcRate || 1);
    this.arcT += tick;
    if (this.arcT < 0) this.arcT = 0;
    const plow = this.b.plow;
    if (!plow || plow.dead) return;
    const ctx = this.ctx;
    const st = this.b.stats;
    const px = plow.position.x;
    const pz = plow.position.z;
    plow.getForward(_f);
    const range = arcRange(st.maxBallRadius);
    const top = (plow.surfaceY || 0) + TOWER_Y;
    _p.set(px - _f.x * 0.3, top, pz - _f.z * 0.3);
    // Lock: keep the last bot while it stays alive, in reach and in a slightly wider cone; else the nearest ahead.
    const near = this.collect(px, pz, range, Reach.Body);
    let tgt: EnemyHandle | null = null;
    let bd = Infinity;
    for (let i = 0; i < near.length; i++) {
      const e = near[i];
      if (!e.alive) continue;
      const dx = e.position.x - px;
      const dz = e.position.z - pz;
      const d = Math.hypot(dx, dz) || 1e-3;
      const cos = (dx * _f.x + dz * _f.z) / d;
      if (e === this.arcLock && cos > ARC_CONE - 0.25) {
        tgt = e;
        break;
      }
      if (cos > ARC_CONE && d < bd) {
        bd = d;
        tgt = e;
      }
    }
    this.clearTargets();
    this.arcLock = tgt;
    this.arcN++;
    if (!tgt) {
      // Nothing in reach: the arc fizzles into the snow ahead so the weapon still reads.
      const a = (Math.random() - 0.5) * 0.8;
      const r = range * (0.45 + Math.random() * 0.3);
      const fx = Math.sin(a) * _f.z + Math.cos(a) * _f.x;
      const fz = Math.cos(a) * _f.z - Math.sin(a) * _f.x;
      _q.set(px + fx * r, (plow.surfaceY || 0) + 0.1, pz + fz * r);
      this.lightning.bolt(_p, _q, { life: tick * 0.8, width: 0.16, jag: 0.9, color: 0x6fc8ff });
      ctx.fx.sparks(_q, null, { color: 0x9fe8ff, count: 4, speed: 5, size: 0.06, length: 0.04, gravity: 10, life: 0.25 });
      if (this.arcN % 3 === 0) this.b.audio.play('zap', { volume: 0.18, pitch: 1.6 + Math.random() * 0.3 });
      return;
    }
    const dmg = ARC_DAMAGE * st.damageMult * coilBoost(st.clapDamage) ** ARC_COIL_EXP * (st.arcBoost || 1);
    this.arcHit.clear();
    let src = tgt;
    let hit: EnemyHandle | null = tgt;
    const hops = ARC_HOPS + st.chainCount;
    const frac = ARC_CHAIN_FRAC + st.chainFrac * 0.5;
    // GROUNDED ARC: a boss, or nothing near the target to chain to (bots only: a Duel opponent is always alone).
    let solo = !this.b.pvp;
    const grounded = solo && tgt.isBoss;
    const around = this.b.enemies.query(tgt.position.x, tgt.position.z, ARC_CHAIN_R, this.arcBuf);
    for (let i = 0; i < around.length && solo && !grounded; i++) if (around[i].alive && around[i] !== tgt) solo = false;
    for (let hop = 0; hop <= hops && hit; hop++) {
      this.arcHit.add(hit.id);
      _q.set(hit.position.x, hit.position.y + hit.radius * 0.9, hit.position.z);
      if (hop === 0) {
        this.lightning.bolt(_p, _q, { life: tick * 1.1, width: solo ? 0.6 : 0.42, jag: 1.0, color: 0xbff0ff });
        this.lightning.bolt(_p, _q, { life: tick * 0.7, width: 0.18, jag: 1.6, color: 0x3fa8ff });
      } else {
        _r.set(src.position.x, src.position.y + src.radius * 0.9, src.position.z);
        this.lightning.bolt(_r, _q, { life: tick * 1.1, width: 0.26, jag: 0.8, color: 0x9fe8ff });
      }
      ctx.fx.burst(_q, { color: 0x9fe8ff, count: 4, speed: 5, size: 0.08, gravity: 8, life: 0.25 });
      const hp0 = hit.hp;
      // PARALYSIS roll (not on a bot still immune from its last one).
      let para = 0;
      if (Math.random() < PARA_CHANCE && ctx.time >= (this.paraReady.get(hit.id) ?? 0)) {
        para = PARA_SECONDS;
        this.paraReady.set(hit.id, ctx.time + PARA_SECONDS + PARA_IMMUNE);
        if (this.paraReady.size > 64) for (const [id, t] of this.paraReady) if (t < ctx.time) this.paraReady.delete(id);
      }
      const share = hop === 0 ? (solo ? ARC_SOLO : 1) : frac * ARC_HOP_DECAY ** (hop - 1);
      const killed = this.b.enemies.damage(hit, dmg * share * this.hitMult(hit), {
        source: 'other',
        fromX: px,
        fromZ: pz,
        stunSeconds: para || undefined,
        crackArmor: solo || undefined,
      });
      if (para && !killed) {
        ctx.fx.floatText(_q, 'PARALYZED', '#bff0ff', 0.85);
        ctx.fx.sparks(_q, null, { color: 0xdff6ff, count: 14, speed: 7, size: 0.07, length: 0.06, gravity: 4, life: 0.4 });
        this.lightning.bolt(_q, _r.set(_q.x, _q.y + 2.2, _q.z), { life: 0.3, width: 0.2, jag: 1.4, color: 0xdff6ff });
      }
      const dealt = Math.max(0, hp0 - Math.max(0, hit.hp));
      this.onPlayerHit(dealt, killed, hit, false, true);
      if (dealt > 0 && hop === 0 && this.arcN % 4 === 0) ctx.fx.floatText(_q, `⚡${Math.round(dealt * 4)}`, '#9fe8ff', 0.75);
      // Next hop: the nearest unhit bot within ARC_CHAIN_R of this one.
      src = hit;
      hit = null;
      if (hop === hops) break;
      const next = this.b.enemies.query(src.position.x, src.position.z, ARC_CHAIN_R, this.arcBuf);
      let nd = Infinity;
      for (let i = 0; i < next.length; i++) {
        const e = next[i];
        if (!e.alive || this.arcHit.has(e.id)) continue;
        const d = Math.hypot(e.position.x - src.position.x, e.position.z - src.position.z);
        if (d < nd) {
          nd = d;
          hit = e;
        }
      }
    }
    if (this.arcN % 2 === 0) this.b.audio.play('zap', { volume: 0.3, pitch: 1.25 + Math.random() * 0.25 });
  }

  /** E: STATIC FIELD — a shock ring bursts out of the coil tower: damage + a short stun on every bot within
   *  STATIC_RADIUS (+ Tesla Field reach), lightning to each. A puppet replays the visuals. */
  secondary(dt: number, _held: boolean, pressed: boolean): boolean {
    const plow = this.b.plow;
    let fired = false;
    if (pressed && plow && !plow.dead) {
      fired = true;
      this.staticT = STATIC_SECONDS;
      this.staticPulseT = 0;
      this.staticFirst = true;
      this.b.audio.play('zap', { pitch: 0.75 });
      this.b.audio.play('zap', { pitch: 1.3, volume: 0.6 });
      this.shake(0.3);
    }
    if (this.staticT > 0) {
      this.staticT -= dt;
      this.staticPulseT -= dt;
      if (!plow || plow.dead) this.staticT = 0;
      else if (this.staticPulseT <= 0) {
        this.staticPulseT += STATIC_PULSE;
        this.staticPulse(plow.position.x, plow.position.z, plow.surfaceY || 0, this.staticFirst);
        this.staticFirst = false;
      } else if (Math.random() < dt * 20) {
        // Crackle along the field's edge between pulses.
        const R = staticRadius(this.b.stats.fieldRadius);
        const a = Math.random() * Math.PI * 2;
        const floor = plow.surfaceY || 0;
        _p.set(plow.position.x, floor + TOWER_Y, plow.position.z);
        const bx = plow.position.x + Math.sin(a) * R;
        const bz = plow.position.z + Math.cos(a) * R;
        _q.set(bx, waveFloor(this.ctx.terrain, floor, bx, bz) + 0.15, bz);
        this.lightning.bolt(_p, _q, { life: 0.12, width: 0.14, jag: 1.0, color: 0x6fc8ff });
      }
    }
    if (plow) plow.voltField = this.staticT > 0 ? 1 : 0; // emitter rods out (vehicles/volt.ts)
    return fired;
  }

  /** Static Field: seconds left, next pulse timer, is the next pulse the opening burst. */
  staticT = 0;
  private staticPulseT = 0;
  private staticFirst = false;

  /** One Static Field pulse round the rover: ring + bolts to the edge, damage and a stun to every bot inside. */
  private staticPulse(px: number, pz: number, floor: number, first: boolean): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const R = staticRadius(st.fieldRadius);
    _q.set(px, floor + 0.12, pz);
    ctx.fx.ring(_q, R, 0x7fdcff);
    if (first) {
      ctx.fx.ring(_q, R * 0.55, 0xffffff);
      ctx.fx.sparks(_q, null, { color: 0x9fe8ff, count: 26, speed: 13, size: 0.07, length: 0.05, gravity: 8, life: 0.4 });
    }
    _p.set(px, floor + TOWER_Y, pz);
    for (let i = 0; i < (first ? 8 : 4); i++) {
      const a = (i / (first ? 8 : 4)) * Math.PI * 2 + Math.random() * 0.8;
      const bx = px + Math.sin(a) * R;
      const bz = pz + Math.cos(a) * R;
      _q.set(bx, waveFloor(ctx.terrain, floor, bx, bz) + 0.15, bz);
      this.lightning.bolt(_p, _q, { life: 0.2, width: 0.2, jag: 1.0, color: 0x6fc8ff });
    }
    if (!first) this.b.audio.play('zap', { pitch: 1.1 + Math.random() * 0.2, volume: 0.4 });
    const dmg = STATIC_DAMAGE * (first ? STATIC_FIRST : 1) * st.damageMult * coilBoost(st.clapDamage) ** STATIC_COIL_EXP;
    const hits = this.collect(px, pz, R, Reach.Body);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      _q.set(e.position.x, e.position.y + e.radius, e.position.z);
      this.lightning.bolt(_p, _q, { life: 0.24, width: 0.28, jag: 1.2, color: 0xbff0ff });
      ctx.fx.burst(_q, { color: 0xbff0ff, count: 6, speed: 6, size: 0.1, gravity: 8, life: 0.3 });
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, dmg * this.hitMult(e), { source: 'other', freezeSeconds: STATIC_STUN, fromX: px, fromZ: pz });
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      this.onPlayerHit(dealt, killed, e, true, true);
      if (dealt > 0) ctx.fx.floatText(_q, `💫${Math.round(dealt)}`, '#bff0ff', 0.8);
    }
    this.clearTargets();
  }

  /** Thunderclap recharge 0..1, stored Overload heat and when it was stored (heatNow bleeds it off since). */
  clapCharge = 1;
  clapHeat = 0;
  lastClapAt = -999;
  /** Battery Shield charge and its recharge delay. */
  shield = 0;
  private shieldDelay = 0;
  private fieldT = 0;
  private idleArcT = 0;
  private chainReadyAt = 0;
  private chainBuf: EnemyHandle[] = [];
  private chainHit = new Set<number>();
  /** Thunderclap storm: time left (snapshot field), centre, strikes left and timers. */
  stormT = 0;
  private stormX = 0;
  private stormZ = 0;
  /** The floor the Thunderclap was cast on: the electrified ground judges height from it (not the plow's live height). */
  private readonly stormFrom: CastOrigin = { y: 0, deck: -1 };
  private stormStrikes = 0;
  private stormStrikeT = 0;
  private stormTickT = 0;
  private ultStep = 0;

  /** Chain Lightning: a hit on `from` arcs to the nearest other bots (hop by hop). `heal` is inherited from the
   *  triggering hit (arcs off a Thunderclap don't feed Salvage Rig either). */
  chainLightning(from: EnemyHandle, dealt: number, heal = true): void {
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
  updateField(dt: number): void {
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
      const top = plow.surfaceY || 0;
      _p.set(plow.position.x, top + 1.6, plow.position.z);
      _q.set(plow.position.x + Math.sin(a) * r, top + 0.15, plow.position.z + Math.cos(a) * r);
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
      _p.set(plow.position.x, (plow.surfaceY || 0) + 1.8, plow.position.z);
      _q.set(e.position.x, e.position.y + e.radius * 0.8, e.position.z);
      this.lightning.bolt(_p, _q, { life: 0.14, width: 0.18 });
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, st.fieldDps * st.damageMult * TICK * this.hitMult(e), { source: 'other', fromX: e.position.x, fromZ: e.position.z });
      this.onPlayerHit(Math.max(0, hp0 - Math.max(0, e.hp)), killed, e, false, false);
    }
    if (any) this.b.audio.play('zap', { volume: 0.35, pitch: 1.4 });
  }

  /** Thunderclap (F on VOLT-9): lightning blast around the plow — damage, shock-slow and knockback. */
  updateClap(dt: number): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const plow = this.b.plow;
    if (st.clapDamage <= 0 || !plow) return;
    if (this.clapCharge < 1) this.clapCharge = Math.min(1, this.clapCharge + (st.clapCooldown > 0 ? dt / st.clapCooldown : 1));
    if (!this.b.input.wasPressed('KeyF') || plow.dead) return;
    if (this.h.crit >= 1 && this.h.ultIdle) return this.h.startUlt('volt', plow);
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
    // Sky strike onto the plow + ground rings, on the floor under the plow (0 on flat arenas).
    const top = castOrigin(plow, this.stormFrom).y;
    _p.set(px, top + 26, pz);
    _q.set(px, top + 1.2, pz);
    this.lightning.bolt(_p, _q, { life: 0.35, width: 0.7, jag: 2.2, color: 0x9fe8ff });
    _q.set(px, top + 0.1, pz);
    ctx.fx.ring(_q, R, 0x7fdcff);
    ctx.fx.ring(_q, R * 0.6, 0xffffff);
    ctx.fx.ring(_q, R * 1.15, 0x2fb8ff);
    ctx.fx.sparks(_q, null, { color: 0x9fe8ff, count: 40, speed: 16, size: 0.08, length: 0.05, gravity: 8, life: 0.5 });
    ctx.fx.burst(_q, { color: 0xffffff, count: 24, speed: 8, size: 0.3, gravity: 10, life: 0.6 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
      const bx = px + Math.sin(a) * R;
      const bz = pz + Math.cos(a) * R;
      _p.set(px, top + 1.8, pz);
      _q.set(bx, waveFloor(ctx.terrain, top, bx, bz) + 0.2, bz);
      this.lightning.bolt(_p, _q, { life: 0.25, width: 0.22, jag: 1.1 });
    }
    this.shake(0.8);
    this.impactHit('clap', _q.set(px, top + 1, pz));
    this.b.audio.play('thunder');
    this.smashProps(px, pz, R);
    const hits = this.collect(px, pz, R, Reach.Wave);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      let dx = e.position.x - px;
      let dz = e.position.z - pz;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d;
      dz /= d;
      _p.set(px, top + 2, pz);
      _q.set(e.position.x, e.position.y + e.radius, e.position.z);
      this.lightning.bolt(_p, _q, { life: 0.3, width: 0.35 });
      const hp0 = e.hp;
      const killed = this.b.enemies.damage(e, st.clapDamage * st.damageMult * this.hitMult(e), {
        source: 'other',
        knockback: _kb.set(dx * 14, 0, dz * 14),
        freezeSeconds: st.clapStun,
        fromX: px,
        fromZ: pz,
      });
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      this.onPlayerHit(dealt, killed, e, true, false);
      if (dealt > 0) ctx.fx.floatText(_q, `⚡${Math.round(dealt)}`, '#bff0ff', 1.15);
    }
    this.clearTargets();
    // The storm: a volley of extra sky strikes across the area, then an electrified field.
    this.stormX = px;
    this.stormZ = pz;
    this.stormT = STORM_SECONDS;
    this.stormStrikes = STORM_STRIKES;
    this.stormStrikeT = 0.12;
    this.stormTickT = 0.25;
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
    _q.set(plow.position.x, (plow.surfaceY || 0) + 3.2, plow.position.z);
    ctx.fx.floatText(_q, `-${Math.round(dmg)} ⚡OVERLOAD`, this.clapHeat > 1.5 ? '#ff7a5a' : '#ffd27a', 0.95);
  }

  /** Overload heat right now: the stored heat minus what has bled off since the last clap. */
  heatNow(): number {
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
  updateStorm(dt: number): void {
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
      const sy = waveFloor(ctx.terrain, this.stormFrom.y, sx, sz);
      _p.set(sx + (Math.random() - 0.5) * 4, sy + 24, sz + (Math.random() - 0.5) * 4);
      _q.set(sx, sy + 0.2, sz);
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
      const ax = this.stormX + Math.sin(a) * r;
      const az = this.stormZ + Math.cos(a) * r;
      const b = a + (Math.random() - 0.5) * 1.5;
      const bx = ax + Math.sin(b) * 3;
      const bz = az + Math.cos(b) * 3;
      _p.set(ax, waveFloor(ctx.terrain, this.stormFrom.y, ax, az) + 0.15, az);
      _q.set(bx, waveFloor(ctx.terrain, this.stormFrom.y, bx, bz) + 0.15, bz);
      this.lightning.bolt(_p, _q, { life: 0.12, width: 0.14, jag: 0.6, color: 0x3fa8ff });
    }
    this.stormTickT -= dt;
    if (this.stormTickT <= 0) {
      this.stormTickT = 0.5;
      const hits = this.b.enemies.query(this.stormX, this.stormZ, R, this.chainBuf);
      for (let i = 0; i < hits.length; i++) {
        const e = hits[i];
        // Electrified ground: only bots standing on the floor the clap was cast on.
        if (!e.alive || !this.reaches(e, Reach.Wave, this.stormFrom)) continue;
        const hp0 = e.hp;
        const killed = this.b.enemies.damage(e, dmgBase * STORM_FIELD_FRAC * 0.5 * this.hitMult(e), { source: 'other', freezeSeconds: 0.6, fromX: e.position.x, fromZ: e.position.z });
        this.onPlayerHit(Math.max(0, hp0 - Math.max(0, e.hp)), killed, e, false, false);
        _p.set(this.stormX, this.stormFrom.y + 0.3, this.stormZ);
        _q.set(e.position.x, e.position.y + e.radius * 0.6, e.position.z);
        this.lightning.bolt(_p, _q, { life: 0.12, width: 0.16, jag: 0.8, color: 0x3fa8ff });
      }
    }
  }

  /** Battery Shield recharge (3s after the last hit, 25% of capacity per second). */
  updateShield(dt: number): void {
    const max = this.b.stats.shieldMax;
    if (max <= 0) {
      this.shield = 0;
      return;
    }
    if (this.shield > max) this.shield = max;
    if (this.shieldDelay > 0) this.shieldDelay -= dt;
    else if (this.shield < max) this.shield = Math.min(max, this.shield + max * 0.25 * dt);
  }

  /** SUPERCELL wave: sky strikes on every bot in range (+ a few bare-ground strikes for show), ground rings. */
  private supercellWave(i: number, x: number, z: number, from: CastOrigin): void {
    const ctx = this.ctx;
    const st = this.b.stats;
    const top = from.y;
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * SUPERCELL_RADIUS;
      const qx = x + Math.sin(a) * rr;
      const qz = z + Math.cos(a) * rr;
      _q.set(qx, waveFloor(ctx.terrain, top, qx, qz) + 0.2, qz);
      _p.set(_q.x + (Math.random() - 0.5) * 4, 28, _q.z + (Math.random() - 0.5) * 4);
      this.lightning.bolt(_p, _q, { life: 0.3, width: 0.45, jag: 2.2, color: 0x9fe8ff });
      ctx.fx.sparks(_q, null, { color: 0x9fe8ff, count: 10, speed: 9, size: 0.07, length: 0.05, gravity: 8, life: 0.4 });
    }
    _q.set(x, top + 0.12, z);
    ctx.fx.ring(_q, SUPERCELL_RADIUS * (0.4 + 0.3 * i), 0xbff0ff);
    this.shake(0.7);
    this.impactHit('clap', _q.set(x, top + 1, z));
    this.b.audio.play('thunder', { pitch: 0.85 + 0.15 * i });
    ultBlast(this.h, x, z, 0, SUPERCELL_RADIUS, st.clapDamage * SUPERCELL_MULT * coilBoost(st.clapDamage) ** SUPERCELL_COIL_EXP, { knock: 8, freeze: st.clapStun * 1.5, text: '⚡', color: '#bff0ff', bolt: true });
  }

  /** Battery Shield soaks damage before HP (hitPlow, after armour). Returns what gets through. */
  soak(dmg: number): number {
    const ctx = this.ctx;
    const plow = this.b.plow;
    if (this.shield > 0 && dmg > 0) {
      const soak = Math.min(this.shield, dmg);
      this.shield -= soak;
      dmg -= soak;
      _q.set(plow.position.x, (plow.surfaceY || 0) + 2.6, plow.position.z);
      ctx.fx.burst(_q, { color: 0x7fdcff, count: 10, speed: 5, size: 0.12, gravity: 4, life: 0.4 });
      if (soak >= 3) ctx.fx.floatText(_q, `🔋${Math.round(soak)}`, '#7fdcff', 0.75);
      if (this.shield <= 0) this.b.audio.play('zap', { pitch: 0.6 });
    }
    if (this.b.stats.shieldMax > 0) this.shieldDelay = 3;
    return dmg;
  }

  ultStart(x: number, z: number, plow: PlowAPI): number {
    this.ultStep = 0;
    _q.set(x, (plow.surfaceY || 0) + 0.12, z);
    this.ctx.fx.ring(_q, SUPERCELL_RADIUS, 0x2fb8ff);
    this.ctx.fx.ring(_q, SUPERCELL_RADIUS * 0.5, 0xbff0ff);
    this.b.audio.play('thunder', { pitch: 0.7 });
    return SUPERCELL_WAVES * SUPERCELL_GAP + 1;
  }

  ultTick(t: number, _dt: number, x: number, z: number, from: CastOrigin): boolean {
    while (this.ultStep < SUPERCELL_WAVES && t >= this.ultStep * SUPERCELL_GAP) this.supercellWave(this.ultStep++, x, z, from);
    return this.ultStep >= SUPERCELL_WAVES;
  }

  clear(): void {
    this.staticT = 0;
    this.paraReady.clear();
    this.clapCharge = 1;
    this.clapHeat = 0;
    this.lastClapAt = -999;
    this.stormT = 0;
    this.stormStrikes = 0;
    this.shield = this.b.stats.shieldMax;
    this.shieldDelay = 0;
    this.arcLock = null;
    this.arcOn = false;
    this.arcT = 0;
  }
}
