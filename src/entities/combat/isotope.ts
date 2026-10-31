import * as THREE from 'three';
import type { EnemyHandle, PlowAPI } from '../../core/types';
import { Kit, _q, type CombatHost } from './shared';

/** ISOTOPE: irradiated bots take this much extra damage from the player; radiation lasts RAD_SECONDS after the
 *  last dose. Fallout pools tick every POOL_TICK; Chain Reaction blasts reach CHAIN_RADIUS. */
export const RAD_VULN = 1.15;
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

/** ISOTOPE: Meltdown + fallout pools, Rad Aura, radiation, Chain Reaction and the NUKE. */
export class IsotopeKit extends Kit {
  /** Meltdown recharge 0..1. */
  meltCharge = 1;
  /** Fallout pools (pooled glowing discs). */
  private pools: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; x: number; z: number; r: number; t: number; life: number; tickT: number }[] = [];
  /** Irradiated bots -> seconds of radiation left. */
  readonly rads = new Map<EnemyHandle, number>();
  /** Chain Reaction blasts queued by irradiated wrecks. */
  readonly chainQueue: { x: number; z: number }[] = [];
  private radFxT = 0;
  private auraT = 0;
  private buf: EnemyHandle[] = [];
  /** Where the NUKE went off (detonate reads it). */
  private nukeX = 0;
  private nukeZ = 0;

  constructor(h: CombatHost, disc: THREE.BufferGeometry) {
    super(h);
    for (let i = 0; i < MAX_POOLS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x5dff3a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(disc, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      h.ctx.scene.add(mesh);
      this.pools.push({ mesh, mat, x: 0, z: 0, r: 1, t: 0, life: 1, tickT: 0 });
    }
  }

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
    this.h.crit = Math.min(1, this.h.crit + dealt / NUKE_CHARGE_DMG);
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
    this.clearTargets();
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
    this.h.crit = 0;
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
    this.clearTargets();
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
  updatePools(dt: number): void {
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
      const hits = this.b.enemies.query(pl.x, pl.z, pl.r, this.buf);
      for (let i = 0; i < hits.length; i++) this.radHit(hits[i], st.poolDps * POOL_TICK);
    }
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
      _q.set(plow.position.x + Math.sin(a) * rr, 0.4, plow.position.z + Math.cos(a) * rr);
      ctx.fx.burst(_q, { color: 0x5dff3a, count: 1, speed: 0.6, size: 0.18, gravity: -2.5, life: 0.6 });
    }
    const hits = this.b.enemies.query(plow.position.x, plow.position.z, R, this.buf);
    for (let i = 0; i < hits.length; i++) this.radHit(hits[i], st.auraDps * TICK);
  }

  /** Radiation timers + the green glow over irradiated bots; Chain Reaction blasts from irradiated wrecks. */
  updateRads(dt: number): void {
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
      const hits = this.b.enemies.query(c.x, c.z, CHAIN_RADIUS, this.buf);
      for (let i = 0; i < hits.length; i++) this.radHit(hits[i], st.chainBlast);
    }
  }

  clear(): void {
    this.meltCharge = 1;
    this.rads.clear();
    this.chainQueue.length = 0;
    for (const pl of this.pools) {
      pl.t = 0;
      pl.mesh.visible = false;
    }
  }
}
