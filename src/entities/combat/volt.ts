import * as THREE from 'three';
import type { EnemyHandle, PlowAPI } from '../../core/types';
import { Kit, _p, _q } from './shared';
import { ultBlast, type UltScript } from './ultimates';

/** SUPERCELL (VOLT-9): SUPERCELL_WAVES waves of sky strikes on every bot within SUPERCELL_RADIUS, SUPERCELL_GAP s
 *  apart, each SUPERCELL_MULT x clap damage + a long shock. No Overload backlash. */
const SUPERCELL_RADIUS = 18;
const SUPERCELL_WAVES = 3;
const SUPERCELL_GAP = 0.5;
const SUPERCELL_MULT = 1.2;
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
export class VoltKit extends Kit implements UltScript {
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
    _q.set(plow.position.x, 3.2, plow.position.z);
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
  private supercellWave(i: number, x: number, z: number): void {
    const ctx = this.ctx;
    const st = this.b.stats;
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
    ultBlast(this.h, x, z, 0, SUPERCELL_RADIUS, st.clapDamage * SUPERCELL_MULT, { knock: 8, freeze: st.clapStun * 1.5, text: '⚡', color: '#bff0ff', bolt: true });
  }

  /** Battery Shield soaks damage before HP (hitPlow, after armour). Returns what gets through. */
  soak(dmg: number): number {
    const ctx = this.ctx;
    const plow = this.b.plow;
    if (this.shield > 0 && dmg > 0) {
      const soak = Math.min(this.shield, dmg);
      this.shield -= soak;
      dmg -= soak;
      _q.set(plow.position.x, 2.6, plow.position.z);
      ctx.fx.burst(_q, { color: 0x7fdcff, count: 10, speed: 5, size: 0.12, gravity: 4, life: 0.4 });
      if (soak >= 3) ctx.fx.floatText(_q, `🔋${Math.round(soak)}`, '#7fdcff', 0.75);
      if (this.shield <= 0) this.b.audio.play('zap', { pitch: 0.6 });
    }
    if (this.b.stats.shieldMax > 0) this.shieldDelay = 3;
    return dmg;
  }

  ultStart(x: number, z: number): number {
    this.ultStep = 0;
    _q.set(x, 0.12, z);
    this.ctx.fx.ring(_q, SUPERCELL_RADIUS, 0x2fb8ff);
    this.ctx.fx.ring(_q, SUPERCELL_RADIUS * 0.5, 0xbff0ff);
    this.b.audio.play('thunder', { pitch: 0.7 });
    return SUPERCELL_WAVES * SUPERCELL_GAP + 1;
  }

  ultTick(t: number, _dt: number, x: number, z: number): boolean {
    while (this.ultStep < SUPERCELL_WAVES && t >= this.ultStep * SUPERCELL_GAP) this.supercellWave(this.ultStep++, x, z);
    return this.ultStep >= SUPERCELL_WAVES;
  }

  clear(): void {
    this.clapCharge = 1;
    this.clapHeat = 0;
    this.lastClapAt = -999;
    this.stormT = 0;
    this.stormStrikes = 0;
    this.shield = this.b.stats.shieldMax;
    this.shieldDelay = 0;
  }
}
