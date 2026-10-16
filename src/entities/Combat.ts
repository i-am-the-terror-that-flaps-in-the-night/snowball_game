import * as THREE from 'three';
import { FlameCone } from '../fx/FlameCone';
import { Lightning } from '../fx/Lightning';
import {
  SLAM_DAMAGE_K,
  ballVolume,
  type CombatAPI,
  type EnemyHandle,
  type GameContext,
} from '../core/types';

/** Seconds of damage i-frames after the plow is hit (overlapping hits only add their excess). */
const IFRAME_SECONDS = 0.15;
const SECOND_WIND_GUARD = 1.5;
/** Inferno (F): flame duration, cone half-angle (cos), seconds between ignite checks, burn length + tick. */
const FLAME_SECONDS = 1.4;
const FLAME_HALF = 0.7;
const FLAME_COS = Math.cos(FLAME_HALF);
/** Direct damage while standing in the cone, as a fraction of burn dps (on top of the burn). */
const FLAME_CONTACT = 0.8;
/** Burning bots take this much extra damage from every source the player deals. */
const BURN_VULN = 1.2;
const FLAME_IGNITE_EVERY = 0.12;
const BURN_SECONDS = 4;
const BURN_TICK = 0.5;
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

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _tip = new THREE.Vector3();

/** All melee damage math for the player and the bots lives here. */
export class Combat implements CombatAPI {
  private ctx: GameContext;
  private iframe = 0;
  /** Second Wind: invulnerable window left, and when it can trigger again (ctx.time). */
  private guardT = 0;
  /** Inferno flame attack state + burning enemies. */
  private flameCharge = 1;
  private flameT = 0;
  private flameIgniteT = 0;
  private burns = new Map<EnemyHandle, { t: number; tickT: number }>();
  private secondWindReadyAt = 0;
  /** Largest final damage already applied during the current i-frame window. */
  private iframeDmg = 0;
  private ramCd = new Map<number, number>();
  private queryOut: EnemyHandle[] = [];
  private targets: EnemyHandle[] = [];
  private lastFreezeSound = -10;
  private lastBlockSound = -10;
  private pruneT = 0;

  private flameCone: FlameCone;
  /** Lightning bolts (VOLT-9); the Plow also uses this for its coil arcs. */
  readonly lightning: Lightning;
  // VOLT-9 state.
  private clapCharge = 1;
  private fieldT = 0;
  private idleArcT = 0;
  private chainReadyAt = 0;
  private chainBuf: EnemyHandle[] = [];
  private chainHit = new Set<number>();
  private shield = 0;
  private shieldDelay = 0;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.flameCone = new FlameCone(ctx.scene);
    this.lightning = new Lightning(ctx.scene);
  }

  get shieldFrac(): number {
    const max = this.ctx.stats.shieldMax;
    return max > 0 ? this.shield / max : -1;
  }

  /* ------------------------------------------------------------------ VOLT-9 */

  /** Chain Lightning: a hit on `from` arcs to the nearest other bots (hop by hop). */
  private chainLightning(from: EnemyHandle, dealt: number): void {
    const ctx = this.ctx;
    const st = ctx.stats;
    if (ctx.time < this.chainReadyAt) return;
    this.chainReadyAt = ctx.time + 0.2;
    this.chainHit.clear();
    this.chainHit.add(from.id);
    let src = from;
    const dmg = Math.max(4, dealt * st.chainFrac);
    for (let hop = 0; hop < st.chainCount; hop++) {
      const near = ctx.enemies.query(src.position.x, src.position.z, 9, this.chainBuf);
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
      const killed = ctx.enemies.damage(best, dmg * this.burnMult(best), { source: 'other', freezeSeconds: 0.4, fromX: best.position.x, fromZ: best.position.z });
      const d2 = Math.max(0, hp0 - Math.max(0, best.hp));
      this.onPlayerHit(d2, killed, best, false);
      if (d2 > 0) ctx.fx.floatText(_q, `⚡${Math.round(d2)}`, '#7fdcff', 0.8);
      ctx.fx.burst(_q, { color: 0x9fe8ff, count: 8, speed: 6, size: 0.08, gravity: 10, life: 0.3 });
      src = best;
    }
    if (this.chainHit.size > 1) ctx.audio.play('zap', { pitch: 1.1 });
  }

  /** Tesla Field: passive shock aura around the plow. */
  private updateField(dt: number): void {
    const ctx = this.ctx;
    const st = ctx.stats;
    const plow = ctx.plow;
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
    const hits = ctx.enemies.query(plow.position.x, plow.position.z, R, this.chainBuf);
    let any = false;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      if (!e.alive) continue;
      any = true;
      _p.set(plow.position.x, 1.8, plow.position.z);
      _q.set(e.position.x, e.position.y + e.radius * 0.8, e.position.z);
      this.lightning.bolt(_p, _q, { life: 0.14, width: 0.18 });
      const hp0 = e.hp;
      const killed = ctx.enemies.damage(e, st.fieldDps * TICK * this.burnMult(e), { source: 'other', fromX: e.position.x, fromZ: e.position.z });
      this.onPlayerHit(Math.max(0, hp0 - Math.max(0, e.hp)), killed, e, false);
    }
    if (any) ctx.audio.play('zap', { volume: 0.35, pitch: 1.4 });
  }

  /** Thunderclap (F on VOLT-9): lightning blast around the plow — damage, shock-slow and knockback. */
  private updateClap(dt: number): void {
    const ctx = this.ctx;
    const st = ctx.stats;
    const plow = ctx.plow;
    if (st.clapDamage <= 0 || !plow) return;
    if (this.clapCharge < 1) this.clapCharge = Math.min(1, this.clapCharge + (st.clapCooldown > 0 ? dt / st.clapCooldown : 1));
    if (!ctx.input.wasPressed('KeyF') || plow.dead) return;
    if (this.clapCharge < 1) {
      ctx.audio.play('error');
      return;
    }
    this.clapCharge = 0;
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
    ctx.fx.burst(_q, { color: 0x9fe8ff, count: 40, speed: 14, size: 0.1, gravity: 8, life: 0.5 });
    ctx.fx.burst(_q, { color: 0xffffff, count: 24, speed: 8, size: 0.3, gravity: 10, life: 0.6 });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.random() * 0.4;
      _p.set(px, 1.8, pz);
      _q.set(px + Math.sin(a) * R, 0.2, pz + Math.cos(a) * R);
      this.lightning.bolt(_p, _q, { life: 0.25, width: 0.22, jag: 1.1 });
    }
    ctx.fx.shake(0.55);
    ctx.audio.play('thunder');
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
      const killed = ctx.enemies.damage(e, st.clapDamage * this.burnMult(e), {
        source: 'other',
        knockback: new THREE.Vector3(dx * 14, 0, dz * 14),
        freezeSeconds: st.clapStun,
        fromX: px,
        fromZ: pz,
      });
      const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
      this.onPlayerHit(dealt, killed, e);
      if (dealt > 0) ctx.fx.floatText(_q, `⚡${Math.round(dealt)}`, '#bff0ff', 1.15);
    }
    this.targets.length = 0;
  }

  /** Battery Shield recharge (3s after the last hit, 25% of capacity per second). */
  private updateShield(dt: number): void {
    const max = this.ctx.stats.shieldMax;
    if (max <= 0) {
      this.shield = 0;
      return;
    }
    if (this.shield > max) this.shield = max;
    if (this.shieldDelay > 0) this.shieldDelay -= dt;
    else if (this.shield < max) this.shield = Math.min(max, this.shield + max * 0.25 * dt);
  }

  /** Burning bots take BURN_VULN x damage from the player's hits. */
  private burnMult(e: EnemyHandle): number {
    return this.burns.has(e) ? BURN_VULN : 1;
  }

  /* ------------------------------------------------------------------ bots -> plow */

  hitPlow(amount: number, fromX: number, fromZ: number, opts?: { knockback?: number; unblockable?: boolean }): number {
    const ctx = this.ctx;
    const plow = ctx.plow;
    const stats = ctx.stats;
    if (!plow || plow.dead || amount <= 0 || plow.invulnerable || this.guardT > 0) return 0;

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
    // 2) Dash halves damage, whirling takes 30% less. 3) Plating.
    if (plow.dashing) dmg *= 0.5;
    if (plow.whirling) dmg *= 0.7;
    dmg *= stats.damageTaken;
    // Battery Shield (VOLT-9) soaks damage before HP.
    if (this.shield > 0 && dmg > 0) {
      const soak = Math.min(this.shield, dmg);
      this.shield -= soak;
      dmg -= soak;
      _q.set(plow.position.x, 2.6, plow.position.z);
      ctx.fx.burst(_q, { color: 0x7fdcff, count: 10, speed: 5, size: 0.12, gravity: 4, life: 0.4 });
      if (soak >= 3) ctx.fx.floatText(_q, `🔋${Math.round(soak)}`, '#7fdcff', 0.75);
      if (this.shield <= 0) ctx.audio.play('zap', { pitch: 0.6 });
    }
    if (stats.shieldMax > 0) this.shieldDelay = 3;

    // i-frames: overlapping hits only deal what exceeds the biggest hit of the window.
    let final = dmg;
    if (this.iframe > 0) {
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
      ctx.fx.shake(0.5);
      ctx.audio.play('respawn');
    }
    if (final > 0) plow.damage(final);

    // Knockback away from the attacker (shield absorbs some of it).
    const kb = (opts?.knockback ?? 6) * (blocked > 0 ? 0.75 : 1);
    plow.push(-dx * kb, -dz * kb);

    // Feedback.
    const fx = ctx.fx;
    const audio = ctx.audio;
    _p.set(plow.position.x + dx * 1.5, 1.1, plow.position.z + dz * 1.5);
    if (blocked > 0) {
      plow.getBladeTip(_tip);
      const br = Math.max(r, 0.3);
      _q.set(_tip.x + _fwd.x * br, br + (ctx.snow ? ctx.snow.getDepth(_tip.x, _tip.z) : 0), _tip.z + _fwd.z * br);
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
      fx.shake(THREE.MathUtils.clamp(0.15 + final * 0.016, 0.15, 0.6));
      audio.play('plowHit', { volume: Math.min(1, (blocked > 0 ? 0.35 : 0.55) + final * 0.02), pitch: THREE.MathUtils.clamp(1.15 - final * 0.01, 0.75, 1.15) });
      _q.set(plow.position.x, 2.8, plow.position.z);
      fx.floatText(_q, `-${Math.round(final)}`, '#ff5a4a', 0.8 + Math.min(0.6, final * 0.015));
    } else if (blocked > 0) {
      fx.shake(0.12);
    }

    ctx.events.emit('plowDamaged', { amount: final, blocked });
    return final;
  }

  /* ------------------------------------------------------------------ plow -> bots */

  playerRam(enemy: EnemyHandle, closingSpeed: number): number {
    const ctx = this.ctx;
    const plow = ctx.plow;
    const stats = ctx.stats;
    if (!plow || plow.dead || !enemy.alive) return 0;
    const until = this.ramCd.get(enemy.id);
    if (until !== undefined && until > ctx.time) return 0;
    const dashing = plow.dashing;
    if (dashing) return this.dashStrike(enemy);
    this.ramCd.set(enemy.id, ctx.time + RAM_REPEAT);

    const r = plow.heldBallRadius;
    const dmg = stats.ramDamage * THREE.MathUtils.clamp(closingSpeed / 10, 0.3, 1.8) + (r > 0 ? 6 * r * r * stats.damageMult : 0);

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
    const killed = ctx.enemies.damage(enemy, dmg * this.burnMult(enemy), {
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
    fx.burst(_p, { color: 0xffc04a, count: 10 + Math.round(Math.min(18, closingSpeed)), speed: 7 + closingSpeed * 0.3, size: 0.08, gravity: 22, life: 0.35 });
    fx.burst(_p, { color: 0x9aa4b0, count: 4, speed: 4, size: 0.16, gravity: 20, life: 0.6 });
    if (r > 0) fx.burst(_p, { color: 0xffffff, count: 6, speed: 3.5, size: 0.18, gravity: 14, life: 0.6 });
    fx.shake(Math.min(0.4, 0.1 + closingSpeed * 0.015));
    ctx.audio.play('ram', { volume: Math.min(1, 0.45 + closingSpeed * 0.04) });
    _q.set(enemy.position.x, enemy.position.y + enemy.radius + 1, enemy.position.z);
    if (dealt > 0) fx.floatText(_q, `${Math.round(dealt)}`, killed ? '#fff3a0' : '#ffffff', 0.8 + Math.min(0.5, dealt * 0.01));
    return dmg;
  }

  /** DASH STRIKE: the dashing plow hits a bot like a truck. The dash keeps going (80% speed). */
  private dashStrike(enemy: EnemyHandle): number {
    const ctx = this.ctx;
    const plow = ctx.plow;
    const stats = ctx.stats;
    // Long cooldown: one strike per bot per dash.
    this.ramCd.set(enemy.id, ctx.time + DASH_STRIKE_REPEAT);
    const r = plow.heldBallRadius;
    const dmg = 25 + stats.ramDamage * 1.8 + (r > 0 ? 6 * r * r * stats.damageMult : 0);

    plow.getForward(_fwd);
    let dx = enemy.position.x - plow.position.x;
    let dz = enemy.position.z - plow.position.z;
    const d = Math.hypot(dx, dz) || 1;
    dx = dx / d + _fwd.x * 1.5;
    dz = dz / d + _fwd.z * 1.5;
    const n = Math.hypot(dx, dz) || 1;
    const knock = new THREE.Vector3((dx / n) * DASH_KNOCK, 0, (dz / n) * DASH_KNOCK);

    const hp0 = enemy.hp;
    const killed = ctx.enemies.damage(enemy, dmg * this.burnMult(enemy), {
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
    (ctx.cameraRig as unknown as { hitStop?: (s: number) => void }).hitStop?.(DASH_HITSTOP);

    const fx = ctx.fx;
    _p.set(
      (plow.position.x + _fwd.x * 2.4 + enemy.position.x) * 0.5,
      1.0,
      (plow.position.z + _fwd.z * 2.4 + enemy.position.z) * 0.5,
    );
    fx.burst(_p, { color: 0xffa02a, count: 34, speed: 15, size: 0.1, gravity: 20, life: 0.45 });
    fx.burst(_p, { color: 0xfff0a0, count: 14, speed: 10, size: 0.07, gravity: 26, life: 0.3 });
    fx.burst(_p, { color: 0xffffff, count: 26, speed: 7, size: 0.28, gravity: 12, life: 0.8 });
    fx.burst(_p, { color: 0x9aa4b0, count: 8, speed: 5, size: 0.2, gravity: 18, life: 0.7 });
    _q.set(_p.x, 0.05, _p.z);
    fx.ring(_q, 3.2, 0xff9a2a);
    fx.shake(0.5);
    ctx.audio.play('dashStrike');
    _q.set(enemy.position.x, enemy.position.y + enemy.radius + 1.4, enemy.position.z);
    fx.floatText(_q, dealt > 0 ? `DASH! ${Math.round(dealt)}` : 'DASH!', killed ? '#fff3a0' : '#ff9a2a', 1.35);
    return dmg;
  }

  /** SPACE slam impact centered at (x, z) with a ball of radius `r` (volume `volume` m^3, already consumed
   *  by the plow). Damages every bot in the zone, shatters the ball. Returns the number of bots hit. */
  slamAt(x: number, z: number, r: number, volume: number): number {
    const ctx = this.ctx;
    const stats = ctx.stats;
    const plow = ctx.plow;
    const fx = ctx.fx;
    const avalanche = stats.avalancheCore;
    const zone = (r * 1.3 + stats.bladeWidth * 0.35) * (avalanche ? 1.5 : 1);
    const dmg = SLAM_DAMAGE_K * r * r * stats.damageMult;
    const knockMag = (10 + 6 * r) * (avalanche ? 1.6 : 1);
    const freeze = stats.frostCore ? 3 : 0;

    plow.getForward(_fwd);
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
      const killed = ctx.enemies.damage(e, dmg * this.burnMult(e), {
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
    this.targets.length = 0;

    // Shatter the ball.
    const ground = ctx.snow ? ctx.snow.getDepth(x, z) : 0;
    _p.set(x, ground + r * 0.8, z);
    fx.burst(_p, { color: 0xffffff, count: Math.round(24 + r * 34), speed: 5 + r * 3.5, size: 0.24 + r * 0.2, gravity: 14, life: 1.1 });
    fx.burst(_p, { color: 0xcfe6ff, count: Math.round(10 + r * 12), speed: 3 + r * 2, size: 0.12 + r * 0.1, gravity: 7, life: 1.3 });
    if (freeze) fx.burst(_p, { color: 0x7fd4ff, count: Math.round(12 + r * 10), speed: 6 + r * 2, size: 0.14, gravity: 4, life: 0.9 });
    if (avalanche) fx.burst(_p, { color: 0xeaf4ff, count: Math.round(16 + r * 16), speed: 9 + r * 3, size: 0.3, gravity: 10, life: 1.0 });
    ctx.snow?.addSnow(x, z, Math.max(1.2, r * 1.6), volume * 0.4);
    _p.y = ground;
    fx.ring(_p, zone, freeze ? 0x9fe6ff : 0xffffff);
    if (avalanche) fx.ring(_p, zone * 1.25, 0xcfe0ff);
    fx.shake(0.25 + 0.25 * r);
    ctx.audio.play('slam', { pitch: THREE.MathUtils.clamp(1.3 - 0.35 * r, 0.5, 1.3), volume: Math.min(1, 0.7 + 0.2 * r) });
    if (freeze && ctx.time - this.lastFreezeSound > 0.3) {
      this.lastFreezeSound = ctx.time;
      ctx.audio.play('freeze', { volume: 0.8 });
    }

    const position = new THREE.Vector3(x, ground, z);
    ctx.events.emit('slam', { hits: count, radius: r, position });
    if (count >= 3) {
      ctx.events.emit('strike', { count, position: position.clone() });
      ctx.audio.play('strike');
    }
    return count;
  }

  /** One damage tick of the E whirl centered on (x, z). Every bot within `radius` is hit once per tick.
   *  Ticks 0..2 pull bots inward (with a swirl), the last tick (`final`) blasts them outward.
   *  Distinct bots hit are added to `hitIds`. Returns the number of bots hit this tick. */
  whirlTick(x: number, z: number, radius: number, ballR: number, tick: number, final: boolean, hitIds: Set<number>): number {
    const ctx = this.ctx;
    const stats = ctx.stats;
    const fx = ctx.fx;
    const dmg = (stats.whirlDamage + (ballR >= 0.2 ? 3 * ballR * ballR * stats.damageMult : 0)) * WHIRL_PLAYER_BONUS;
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
      const killed = ctx.enemies.damage(e, dmg * this.burnMult(e), {
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

    ctx.audio.play('whirlTick', { pitch: 0.9 + tick * 0.12, volume: final ? 1 : 0.7 });
    _p.set(x, ctx.snow ? ctx.snow.getDepth(x, z) : 0, z);
    if (final) {
      fx.ring(_p, radius * 1.15, 0xbfeaff);
      fx.ring(_p, radius * 0.7, 0xffffff);
      fx.shake(0.35 + 0.04 * Math.min(4, count));
      if (count > 0) ctx.audio.play('ram', { volume: 0.8, pitch: 0.8 });
    } else {
      fx.shake(0.1 + 0.04 * Math.min(3, count));
    }
    return count;
  }

  /** Snapshot of living enemies overlapping a circle (copied: damage() may mutate manager lists). */
  private collect(x: number, z: number, radius: number): EnemyHandle[] {
    const enemies = this.ctx.enemies;
    const out = this.targets;
    out.length = 0;
    if (!enemies) return out;
    const q = enemies.query(x, z, radius, this.queryOut);
    for (let i = 0; i < q.length; i++) out.push(q[i]);
    return out;
  }

  /** Pilot perks that trigger on the player's own hits: Salvage Rig lifesteal and Adrenaline refunds. */
  private onPlayerHit(dealt: number, killed: boolean, target?: EnemyHandle, canChain = true): void {
    const plow = this.ctx.plow;
    const st = this.ctx.stats;
    if (plow.dead) return;
    if (canChain && target && dealt > 0 && st.chainCount > 0) this.chainLightning(target, dealt);
    if (st.lifesteal > 0 && dealt > 0) plow.hp = Math.min(plow.maxHp, plow.hp + dealt * st.lifesteal);
    if (killed && st.killRecharge > 0) {
      // Plow keeps its cooldown charges private; refund them through a narrow duck-typed view.
      const p = plow as unknown as { dashCharge: number; whirlCharge: number };
      p.dashCharge = Math.min(1, p.dashCharge + st.killRecharge);
      p.whirlCharge = Math.min(1, p.whirlCharge + st.killRecharge);
    }
  }

  get flameReady(): number {
    const st = this.ctx.stats;
    if (st.plowKind === 'volt') return st.clapDamage > 0 ? this.clapCharge : -1;
    return st.flameDps > 0 ? this.flameCharge : -1;
  }

  /** Inferno (F, pilot perk): a 1s cone of fire from the blade that ignites bots and melts snow. */
  private updateFlame(dt: number): void {
    const ctx = this.ctx;
    const st = ctx.stats;
    const plow = ctx.plow;
    if (st.plowKind === 'volt' || st.flameDps <= 0 || !plow) {
      if (this.flameT > 0 || st.plowKind === 'volt') this.flameCone.hide();
      this.flameT = 0;
      return;
    }
    if (this.flameT <= 0 && this.flameCharge < 1) this.flameCharge = Math.min(1, this.flameCharge + (st.flameCooldown > 0 ? dt / st.flameCooldown : 1));
    if (ctx.input.wasPressed('KeyF') && !plow.dead) {
      if (this.flameCharge >= 1 && this.flameT <= 0) {
        this.flameCharge = 0;
        this.flameT = FLAME_SECONDS;
        this.flameIgniteT = 0;
        ctx.audio.play('dash', { pitch: 0.55, volume: 0.9 });
        ctx.audio.play('burst', { pitch: 0.6 });
      } else if (this.flameT <= 0) ctx.audio.play('error');
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
    if (Math.random() < dt * 10) fx.shake(0.06);
    if (ctx.snow) {
      ctx.snow.melt(_tip.x + _fwd.x * range * 0.35, _tip.z + _fwd.z * range * 0.35, range * 0.3, 0.8 * dt);
      ctx.snow.melt(_tip.x + _fwd.x * range * 0.75, _tip.z + _fwd.z * range * 0.75, range * 0.4, 0.8 * dt);
    }
    // Ignite everything inside the cone.
    this.flameIgniteT -= dt;
    if (this.flameIgniteT > 0) return;
    this.flameIgniteT = FLAME_IGNITE_EVERY;
    const hits = this.collect(_tip.x + _fwd.x * range * 0.5, _tip.z + _fwd.z * range * 0.5, range * 0.5 + 1);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      const dx = e.position.x - _tip.x;
      const dz = e.position.z - _tip.z;
      const d = Math.hypot(dx, dz);
      if (d > range + e.radius || (d > e.radius && (dx * _fwd.x + dz * _fwd.z) / d < FLAME_COS)) continue;
      const b = this.burns.get(e);
      if (b) b.t = BURN_SECONDS;
      else this.burns.set(e, { t: BURN_SECONDS, tickT: 0.1 });
      // Scorch: direct damage + a shove away from the blade while caught in the cone.
      const nd = d || 1;
      const hp0 = e.hp;
      const killed = ctx.enemies.damage(e, st.flameDps * FLAME_CONTACT * FLAME_IGNITE_EVERY * BURN_VULN, {
        source: 'other',
        knockback: new THREE.Vector3((dx / nd) * 3, 0, (dz / nd) * 3),
        fromX: e.position.x,
        fromZ: e.position.z,
      });
      this.onPlayerHit(Math.max(0, hp0 - Math.max(0, e.hp)), killed, e, false);
    }
    this.targets.length = 0;
  }

  /** Burn damage over time from Inferno, credited to the player (lifesteal / adrenaline apply). */
  private updateBurns(dt: number): void {
    if (this.burns.size === 0) return;
    const ctx = this.ctx;
    const dps = ctx.stats.flameDps;
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
        const killed = ctx.enemies.damage(e, dps * BURN_TICK * BURN_VULN, { source: 'other', fromX: e.position.x, fromZ: e.position.z });
        const dealt = Math.max(0, hp0 - Math.max(0, e.hp));
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
    this.flameCone.hide();
    this.lightning.clear();
    this.clapCharge = 1;
    this.shield = this.ctx.stats.shieldMax;
    this.shieldDelay = 0;
    this.flameT = 0;
    this.flameCharge = 1;
    this.burns.clear();
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
    this.updateClap(dt);
    this.updateField(dt);
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
