import * as THREE from 'three';
import { SLAM_DAMAGE_K, type EnemyHandle } from '../../core/types';
import { COMBO_MAX, COMBO_WINDOW } from '../../config/upgrades';
import { Kit, _fwd, _p, _q } from './shared';

/** Momentum (BRUTUS) only counts closing speed up to this many m/s. */
const MOMENTUM_SPEED_CAP = 20;
/** Minimum seconds between two rams on the same bot (safety net for per-frame contact calls). */
const RAM_REPEAT = 0.25;
/** Dash strike: one strike per bot per dash. */
const DASH_STRIKE_REPEAT = 0.75;
const DASH_KNOCK = 22;
const DASH_HITSTOP = 0.06;
const WHIRL_PULL = 6;
const WHIRL_BLAST = 22;
/** The player's whirl hits harder than the base kit (Brawl rivals keep the base numbers). */
const WHIRL_PLAYER_BONUS = 1.35;

/** Every plow's base kit: rams + DASH STRIKE, the SPACE slam (Slam Combo, Shatter Slam) and the E whirl. */
export class MeleeKit extends Kit {
  private ramCd = new Map<number, number>();
  private pruneT = 0;
  private shardBuf: EnemyHandle[] = [];
  /** Slam Combo (Classic Plow): stacks and when the last slam landed. */
  private comboStacks = 0;
  private lastSlamHitAt = -999;
  private lastFreezeSound = -10;

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
    this.clearTargets();
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
    this.clearTargets();

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

  /** Drop expired ram cooldowns now and then. */
  prune(dt: number): void {
    this.pruneT -= dt;
    if (this.pruneT <= 0 && this.ramCd.size > 0) {
      this.pruneT = 2;
      const now = this.ctx.time;
      for (const [id, t] of this.ramCd) if (t <= now) this.ramCd.delete(id);
    }
  }

  clear(): void {
    this.ramCd.clear();
  }
}
