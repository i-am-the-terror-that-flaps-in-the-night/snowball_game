import * as THREE from 'three';
import { SLAM_DAMAGE_K } from '../core/types';
import { BRAWL_KILL_COINS, BRAWL_KILL_TARGET, BRAWL_RESPAWN, BRAWL_SHUTDOWN_PER_STREAK, BRAWL_TAUNTS, BRAWL_HIT_CAP, BRAWL_PLAYER_HIT_CAP, brawlHit, STREAK_TIERS, streakMult } from '../config/brawl';
import { BLADE_Z, getDebrisDarkMaterial, getDebrisGeometry, instancedDepthMaterial } from './models';
import { VOLT_CLAP_CD, VOLT_CLAP_DMG, VOLT_CLAP_KB, VOLT_CLAP_R, VOLT_CLAP_STUN } from './voltRival';
import { POUND_CD, POUND_DMG, POUND_KB, POUND_R, POUND_RIM_FRAC, POUND_STUN, POUND_STUN_PLAYER } from './bruteRival';
import { RIVAL_R, SLAM_WIND, SLAM_CD, DASH_T, SHIELD_COS, KILL_CREDIT_WINDOW, clamp, pick, type Method, type Fighter, type Debris } from './shared';
import type { Rival } from './rival';
import { BrawlVisuals } from './BrawlVisuals';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/* Snowdome Brawl: rival moves (dash, whirl, slam, Thunderclap, Ground Pound), damage, kill credit, wrecks, respawns. */

export abstract class BrawlCombat extends BrawlVisuals {
  /* ================================================================== moves */

  /** Metres a dash started now covers, plus the braking glide after it (a dash ignores lava braking until it ends). */
  protected dashReach(r: Rival): number {
    const v = Math.max(r.speed, 0) + r.s.dashPower;
    return RIVAL_R + v * DASH_T + (v * v) / (2 * r.s.accel * 1.4);
  }

  protected startDash(r: Rival): void {
    r.dashT = DASH_T;
    r.dashCd = r.s.dashCd;
    r.speed = Math.max(r.speed, 0) + r.s.dashPower;
    this.sfx('dash', r.position.x, r.position.z, 0.8);
  }

  protected startWhirl(r: Rival): void {
    r.whirlT = 0;
    r.whirlTick = 0;
    r.whirlCd = r.s.whirlCd;
    this.sfx('whirl', r.position.x, r.position.z, 0.8);
  }

  protected startSlam(r: Rival): void {
    r.slamT = 0;
    r.slamCd = SLAM_CD;
  }

  protected startClap(r: Rival): void {
    r.clapT = 0;
    r.clapCd = VOLT_CLAP_CD * (0.9 + Math.random() * 0.2);
    if (r.volt) r.volt.crackleT = 0;
    this.sfx('zap', r.position.x, r.position.z, 0.8, 0.7);
  }

  /** Bot Thunderclap: lightning blast around a VOLT-9 rival — damage (brawl-capped), shock-slow and knockback to
   *  every other fighter in range; the player is hit through combat.hitPlow so Battery Shield / i-frames apply. */
  protected voltClap(r: Rival): void {
    const ctx = this.ctx;
    const px = r.position.x;
    const pz = r.position.z;
    const R = VOLT_CLAP_R;
    const dmg = VOLT_CLAP_DMG * this.dmgMult(r);
    const seen = this.near(px, pz, 90);
    if (seen) {
      _v.set(px, 24, pz);
      _v2.set(px, 1.2, pz);
      this.lightning.bolt(_v, _v2, { life: 0.35, width: 0.6, jag: 2, color: 0x9fe8ff });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
        _v.set(px, 1.6, pz);
        _v2.set(px + Math.sin(a) * R, 0.2, pz + Math.cos(a) * R);
        this.lightning.bolt(_v, _v2, { life: 0.25, width: 0.2, jag: 1 });
      }
      _v.set(px, 0.1, pz);
      ctx.fx.ring(_v, R, 0x7fdcff);
      ctx.fx.ring(_v, R * 0.6, 0xffffff);
      ctx.fx.burst(_v, { color: 0x9fe8ff, count: 30, speed: 12, size: 0.1, gravity: 8, life: 0.5 });
      const k = this.hear(px, pz);
      if (k > 0.1) ctx.fx.shake(0.15 + 0.45 * k);
      ctx.impact.hit('clap', _v.set(px, 1, pz), 0.8, { stop: false, falloff: k * 0.6 });
    }
    this.sfx('thunder', px, pz, 1);
    for (const f of this.fighters) {
      if (f.rival === r || !this.isTargetable(f)) continue;
      const tx = this.fx(f);
      const tz = this.fz(f);
      const tR = f.rival ? RIVAL_R : ctx.plow.radius;
      const d = Math.hypot(tx - px, tz - pz);
      if (d > R + tR * 0.5) continue;
      const nx = (tx - px) / (d || 1);
      const nz = (tz - pz) / (d || 1);
      if (seen) {
        _v.set(px, 2, pz);
        _v2.set(tx, 1.2, tz);
        this.lightning.bolt(_v, _v2, { life: 0.3, width: 0.32 });
      }
      if (f.rival) f.rival.frozenT = Math.max(f.rival.frozenT, VOLT_CLAP_STUN);
      this.hitFighter(f, r.f, dmg, 'zap', nx * VOLT_CLAP_KB, nz * VOLT_CLAP_KB, VOLT_CLAP_KB, true, px, pz);
    }
  }

  protected startPound(r: Rival): void {
    r.poundT = 0;
    r.poundCd = POUND_CD * (0.9 + Math.random() * 0.2);
    this.sfx('charge', r.position.x, r.position.z, 0.7, 0.6);
  }

  /** Bot Ground Pound: the BRUTUS lands its hop — a snow shockwave that damages every other fighter in the ring
   *  (falling off to POUND_RIM_FRAC at the rim, brawl-capped), hurls them outward and briefly stuns them. The
   *  player is hit through combat.hitPlow (shield can't block it; i-frames / spawn protection apply). */
  protected groundPound(r: Rival): void {
    const ctx = this.ctx;
    const px = r.position.x;
    const pz = r.position.z;
    const R = POUND_R;
    const base = POUND_DMG * this.dmgMult(r);
    if (this.near(px, pz, 90)) {
      _v.set(px, 0.1, pz);
      ctx.fx.ring(_v, R * 0.45, 0xffffff);
      ctx.fx.ring(_v, R, 0xdff2ff);
      ctx.fx.ring(_v, R * 1.1, 0xffc21a);
      ctx.fx.burst(_v, { color: 0xffffff, count: 34, speed: 13, size: 0.24, gravity: 18, life: 0.7 });
      ctx.fx.burst(_v, { color: 0x6b7280, count: 10, speed: 6, size: 0.18, gravity: 22, life: 0.5 });
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + Math.random() * 0.3;
        const rr = R * (0.55 + Math.random() * 0.4);
        _v.set(px + Math.sin(a) * rr, 0.3, pz + Math.cos(a) * rr);
        ctx.fx.burst(_v, { color: 0xffffff, count: 5, speed: 6, size: 0.22, gravity: 16, life: 0.5 });
      }
      const k = this.hear(px, pz);
      if (k > 0.1) ctx.fx.shake(0.2 + 0.5 * k);
      ctx.impact.hit('pound', _v.set(px, 0.5, pz), 0.8, { stop: false, falloff: k * 0.6 });
    }
    this.sfx('thud', px, pz, 1);
    for (const f of this.fighters) {
      if (f.rival === r || !this.isTargetable(f)) continue;
      const tx = this.fx(f);
      const tz = this.fz(f);
      const tR = f.rival ? RIVAL_R : ctx.plow.radius;
      const d = Math.hypot(tx - px, tz - pz);
      if (d > R + tR * 0.5) continue;
      let nx = Math.sin(r.heading);
      let nz = Math.cos(r.heading);
      if (d > 1e-3) {
        nx = (tx - px) / d;
        nz = (tz - pz) / d;
      }
      const fall = 1 - (1 - POUND_RIM_FRAC) * Math.min(1, d / R);
      const kb = POUND_KB * (0.75 + 0.25 * fall);
      if (f.rival) {
        this.stunRival(f.rival, POUND_STUN);
        this.hitFighter(f, r.f, base * fall, 'pound', nx * kb, nz * kb, kb, true, px, pz);
      } else {
        const hp0 = ctx.plow.hp;
        this.hitFighter(f, r.f, base * fall, 'pound', nx * kb, nz * kb, kb, true, px, pz);
        if (ctx.plow.hp < hp0 && !ctx.plow.dead) {
          (ctx.plow as unknown as { hitStop?: (s: number) => void }).hitStop?.(POUND_STUN_PLAYER);
          _v.set(tx, 3.2, tz);
          ctx.fx.floatText(_v, 'STUNNED', '#ffd23a', 0.7);
        }
      }
    }
    // Shockwave throws the snow around a bit.
    ctx.snow.addSnow(px, pz, R * 0.4, 0.05);
  }

  /** Hard-stun a rival: it stops, can't steer or attack, and any wind-up (slam / clap / pound) is interrupted. */
  protected stunRival(r: Rival, seconds: number): void {
    if (!r.targetable || seconds <= 0) return;
    r.stunT = Math.max(r.stunT, seconds);
    r.dashT = 0;
    if (r.slamT >= 0 && r.slamT < SLAM_WIND) r.slamT = -1;
    r.clapT = -1;
    if (r.poundT >= 0) {
      r.poundT = -1;
      r.rig.body.position.y = 0;
    }
  }

  protected slamImpact(r: Rival): void {
    const ctx = this.ctx;
    const br = r.ballR;
    if (br < 0.2) return;
    const fx = Math.sin(r.heading);
    const fz = Math.cos(r.heading);
    const cx = r.position.x + fx * (BLADE_Z + br + 0.5);
    const cz = r.position.z + fz * (BLADE_Z + br + 0.5);
    const zone = (br * 1.3 + 1.0) * (r.s.avalanche ? 1.5 : 1);
    const dmg = SLAM_DAMAGE_K * br * br * this.dmgMult(r);
    for (const f of this.fighters) {
      if (f.rival === r || !this.isTargetable(f)) continue;
      const tx = this.fx(f);
      const tz = this.fz(f);
      const tR = f.rival ? RIVAL_R : ctx.plow.radius;
      const d = Math.hypot(tx - cx, tz - cz);
      if (d > zone + tR) continue;
      const nx = (tx - r.position.x) / (Math.hypot(tx - r.position.x, tz - r.position.z) || 1);
      const nz = (tz - r.position.z) / (Math.hypot(tx - r.position.x, tz - r.position.z) || 1);
      const kb = (10 + 6 * br) * (r.s.avalanche ? 1.6 : 1);
      this.hitFighter(f, r.f, dmg, 'slam', nx * kb, nz * kb, kb, false, r.position.x, r.position.z);
    }
    // Ball shatters.
    const vol = r.ballVol;
    r.ballVol = 0;
    ctx.snow.addSnow(cx, cz, br * 1.6, vol * 0.4);
    r.speed += 8;
    if (this.near(cx, cz)) {
      _v.set(cx, br, cz);
      ctx.fx.burst(_v, { color: 0xffffff, count: Math.round(14 + br * 16), speed: 7 + br * 3, size: 0.25 + br * 0.08, gravity: 16, life: 0.9 });
      _v.y = 0.1;
      ctx.fx.ring(_v, zone + 0.6, 0xffffff);
      const k = this.hear(cx, cz);
      if (k > 0.2) ctx.fx.shake(0.12 + 0.3 * br * k);
      ctx.impact.hit('slam', _v, br * 0.8, { stop: false, falloff: k * 0.5 });
    }
    this.sfx('slam', cx, cz, 0.9, clamp(1.2 - br * 0.25, 0.7, 1.2));
  }

  protected whirlTick(r: Rival, final: boolean): void {
    const ctx = this.ctx;
    const R = r.s.whirlR + r.ballR;
    const dmg = r.s.whirlDmg * this.dmgMult(r);
    for (const f of this.fighters) {
      if (f.rival === r || !this.isTargetable(f)) continue;
      const tx = this.fx(f);
      const tz = this.fz(f);
      const dx = tx - r.position.x;
      const dz = tz - r.position.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d > R + (f.rival ? RIVAL_R : ctx.plow.radius) * 0.5) continue;
      const kb = final ? 18 : -5;
      this.hitFighter(f, r.f, dmg, 'whirl', (dx / d) * kb, (dz / d) * kb, kb, true, r.position.x, r.position.z);
    }
    // Sucks up snow into the ball.
    const got = ctx.snow.collectDisc(r.position.x, r.position.z, R * 0.7, 0.35);
    r.ballVol = Math.min(r.s.maxBallVol, r.ballVol + got * r.s.collect);
    if (this.near(r.position.x, r.position.z, 60)) {
      _v.set(r.position.x, 0.1, r.position.z);
      if (final) ctx.fx.ring(_v, R * 1.1, 0xbfeaff);
      _v.y = 1.2;
      ctx.fx.burst(_v, { color: 0xffffff, count: final ? 18 : 8, speed: final ? 12 : 7, size: 0.18, gravity: 6, life: 0.6 });
    }
    this.sfx('whirlTick', r.position.x, r.position.z, final ? 0.9 : 0.6, 0.9 + r.whirlTick * 0.12);
  }

  /* ================================================================== damage */

  /** A rival attacker hits fighter `victim` (player or rival). */
  protected hitFighter(victim: Fighter, attacker: Fighter, dmg: number, method: Method, kx: number, kz: number, kb: number, unblockable: boolean, fromX: number, fromZ: number): void {
    if (this._over) return;
    if (victim.rival) {
      this.hurtRival(victim.rival, dmg, attacker, method, kx, kz, unblockable, fromX, fromZ);
      return;
    }
    const final = this.ctx.combat.hitPlow(brawlHit(dmg, this.ctx.plow.maxHp), fromX, fromZ, { knockback: kb, unblockable });
    if (final > 0) {
      victim.lastHitBy = attacker;
      victim.lastHitAt = this.time;
      victim.lastHitMethod = method;
    }
  }

  /** Damage a rival. Applies spawn protection, ball shield, dash/whirl reductions. Returns true on kill. */
  protected hurtRival(r: Rival, amount: number, attacker: Fighter | null, method: Method, kx: number, kz: number, unblockable: boolean, fromX: number, fromZ: number): boolean {
    if (!r.targetable || this._over || amount <= 0) return false;
    // Brawl hit cap: nothing one-shots from full hp.
    // The player's own hits cap a bit higher than everyone else's.
    const capFrac = attacker === this.player ? BRAWL_PLAYER_HIT_CAP : BRAWL_HIT_CAP;
    let dmg = brawlHit(amount, r.maxHp, capFrac) * r.s.damageTaken;
    // Ball shield on frontal hits.
    const br = r.ballR;
    if (!unblockable && br >= 0.2) {
      const dx = fromX - r.position.x;
      const dz = fromZ - r.position.z;
      const d = Math.hypot(dx, dz) || 1;
      if ((dx / d) * Math.sin(r.heading) + (dz / d) * Math.cos(r.heading) >= SHIELD_COS) {
        const blocked = dmg * r.s.shieldBlock;
        dmg -= blocked;
        r.ballVol = Math.max(0, r.ballVol - blocked * 0.04);
      }
    }
    if (r.dashing) dmg *= 0.5;
    if (r.whirling) dmg *= 0.7;
    // "On fire": every streak tier also hardens the rival a little.
    dmg *= 1 - 0.1 * this.tierOf(r.f.entry.streak);
    // Elites out-class ordinary bots: their hits dent them less (the player hits elites at full strength).
    if (r.s.elite && attacker?.rival && !attacker.rival.s.elite) dmg *= 0.7;
    r.hp -= dmg;
    r.flashT = 0.12;
    r.kvx += kx / r.mass;
    r.kvz += kz / r.mass;
    if (attacker) {
      r.f.lastHitBy = attacker;
      r.f.lastHitAt = this.time;
      r.f.lastHitMethod = method;
    }
    // Damage numbers for bot-vs-bot hits (Combat already shows the player's).
    if (attacker && !attacker.entry.isPlayer && this.near(r.position.x, r.position.z, 45)) {
      _v.set(r.position.x, r.rig.height + 1.2, r.position.z);
      this.ctx.fx.floatText(_v, `${Math.round(dmg)}`, '#e8eef6', 0.6);
    }
    if (r.hp <= 0) {
      r.hp = 0;
      this.onDeath(r.f, attacker, method);
      return true;
    }
    return false;
  }

  protected onDeath(victim: Fighter, killer: Fighter | null, method: Method): void {
    const ctx = this.ctx;
    if (killer === victim) killer = null;
    const v = victim.entry;
    v.deaths++;
    v.alive = false;
    const victimStreak = v.streak;
    v.streak = 0;

    let coins = 0;
    let mult = 1;
    if (killer) {
      const k = killer.entry;
      k.kills++;
      k.streak++;
      k.bestStreak = Math.max(k.bestStreak, k.streak);
      mult = streakMult(k.streak);
      let shutdownBonus = 0;
      if (k.isPlayer) {
        coins = Math.round(BRAWL_KILL_COINS * mult * this.diff.coinMult);
        if (victimStreak >= 3) {
          shutdownBonus = Math.round(BRAWL_SHUTDOWN_PER_STREAK * victimStreak * this.diff.coinMult);
          coins += shutdownBonus;
        }
      }
      const tier = STREAK_TIERS.find((t) => t.at === k.streak);
      if (tier) {
        ctx.events.emit('brawlStreak', { name: k.name, color: k.color, count: k.streak, label: tier.label, mult: tier.mult, isPlayer: k.isPlayer });
        if (k.isPlayer) ctx.audio.play('streak');
      }
      if (victimStreak >= 3) {
        ctx.events.emit('brawlShutdown', { killer: k.name, victim: v.name, streak: victimStreak, bonus: shutdownBonus, killerIsPlayer: k.isPlayer });
        if (k.isPlayer) ctx.audio.play('shutdown');
      }
      if (coins > 0) this.award(coins, mult);
      // Rivals repair from the wreck they made — keeps streaks alive.
      if (killer.rival && killer.rival.alive) {
        const kr = killer.rival;
        const heal = kr.maxHp * this.diff.killHeal;
        kr.hp = Math.min(kr.maxHp, kr.hp + heal);
        if (this.near(kr.position.x, kr.position.z, 50)) {
          _v.set(kr.position.x, kr.rig.height + 2.2, kr.position.z);
          this.ctx.fx.floatText(_v, `+${Math.round(heal)}`, '#5dff8a', 0.7);
        }
      }
      if (killer.rival && killer.rival.tauntCd <= 0 && Math.random() < 0.4) {
        killer.rival.bubble.show(pick(BRAWL_TAUNTS));
        killer.rival.tauntCd = 8;
      }
    }
    ctx.events.emit('brawlKill', {
      killer: killer ? killer.entry.name : '',
      killerColor: killer ? killer.entry.color : '#ffffff',
      victim: v.name,
      victimColor: v.color,
      method: killer ? method : method === 'other' ? 'wall' : method,
      killerIsPlayer: !!killer?.entry.isPlayer,
      victimIsPlayer: v.isPlayer,
    });

    if (victim.rival) {
      const r = victim.rival;
      if (killer?.entry.isPlayer) ctx.events.emit('enemyKilled', { enemy: r, coins });
      this.wreckRival(r);
    } else {
      this.killedBy = killer ? killer.entry.name : '';
    }
    if (killer && killer.entry.kills >= BRAWL_KILL_TARGET) this.endMatch();
  }

  protected award(coins: number, mult: number): void {
    const ctx = this.ctx;
    ctx.progression.addCoins(coins);
    ctx.events.emit('coinCollected', { amount: coins });
    this.coinsEarned += coins;
    _v.set(ctx.plow.position.x, 3.6, ctx.plow.position.z);
    ctx.fx.floatText(_v, mult > 1 ? `+${coins}  x${mult} STREAK` : `+${coins}`, '#ffd84a', 1.1);
    ctx.audio.play('coin', { pitch: 1 + Math.min(0.5, mult * 0.08) });
  }

  protected wreckRival(r: Rival): void {
    const ctx = this.ctx;
    r.alive = false;
    r.respawnT = BRAWL_RESPAWN;
    r.rig.root.visible = false;
    r.tag.sprite.visible = false;
    r.bubble.hide();
    this.syncBalls();
    if (r.ballVol > 0) ctx.snow.addSnow(r.position.x, r.position.z, 2.5, r.ballVol * 0.5);
    r.ballVol = 0;
    const x = r.position.x;
    const z = r.position.z;
    const gy = r.vert.surfaceY;
    if (this.near(x, z, 90)) {
      _v.set(x, gy + 1.2, z);
      ctx.fx.burst(_v, { color: 0xff8a2a, count: 26, speed: 12, size: 0.14, gravity: 18, life: 0.6 });
      ctx.fx.burst(_v, { color: 0x30343a, count: 16, speed: 5, size: 0.5, gravity: -2, life: 1.4 });
      ctx.fx.burst(_v, { color: 0xffffff, count: 18, speed: 8, size: 0.3, gravity: 14, life: 1 });
      ctx.fx.fireball(_v, 1.2);
      _v.y = gy + 0.1;
      ctx.fx.ring(_v, 5, 0xffb060);
      ctx.fx.scorch(_v, 2.6);
      ctx.fx.smolder(_v, { scale: 1.1, seconds: 2.5 });
      const k = this.hear(x, z);
      if (k > 0.1) ctx.fx.shake(0.15 + 0.5 * k);
      ctx.impact.hit('wreck', _v.set(x, gy + 1.2, z), 1, { stop: false, falloff: k });
      // Debris chunks in the rival's paint (frozen as it was at the kill) + dark metal: one batch per material.
      const paintMat = r.rig.paint.clone();
      const batches: Debris[] = [paintMat, getDebrisDarkMaterial()].map((mat, k) => {
        const mesh = new THREE.InstancedMesh(getDebrisGeometry(), mat, 4 - k);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = true;
        mesh.customDepthMaterial = instancedDepthMaterial();
        this.group.add(mesh);
        return { mesh, mat: k === 0 ? paintMat : null, chunks: [] };
      });
      for (let i = 0; i < 7; i++) {
        const pos = new THREE.Vector3(x + (Math.random() - 0.5) * 1.5, gy + 1 + Math.random(), z + (Math.random() - 0.5) * 1.5);
        const a = Math.random() * Math.PI * 2;
        const s = 4 + Math.random() * 6;
        batches[i % 2].chunks.push({ pos, rot: new THREE.Euler(), scale: 1, vx: Math.sin(a) * s, vy: 6 + Math.random() * 6, vz: Math.cos(a) * s, rx: (Math.random() - 0.5) * 14, rz: (Math.random() - 0.5) * 14, life: 2.4 + Math.random() });
      }
      for (const b of batches) this.writeDebris(b);
      this.debris.push(...batches);
    }
    this.sfx('explosion', x, z, 0.9);
  }

  protected respawnRival(r: Rival): void {
    const p = this.bestSpawn();
    this.placeRival(r, p.x, p.z, Math.atan2(-p.x, -p.z));
    r.f.lastHitBy = null;
    this.sfx('respawn', p.x, p.z, 0.7);
  }

  protected updatePlayerLife(dt: number): void {
    const ctx = this.ctx;
    const plow = ctx.plow;
    if (!this.player) return;
    if (plow.dead && !this.playerDown) {
      this.playerDown = true;
      this.playerRespawnT = BRAWL_RESPAWN;
      const f = this.player;
      const killer = f.lastHitBy && this.time - f.lastHitAt < KILL_CREDIT_WINDOW ? f.lastHitBy : null;
      this.onDeath(f, killer, f.lastHitMethod);
    }
    if (this.playerDown && !this._over) {
      this.playerRespawnT -= dt;
      if (this.playerRespawnT <= 0) {
        const p = this.bestSpawn();
        plow.reset({ x: p.x, z: p.z, heading: Math.atan2(-p.x, -p.z) });
        ctx.cameraRig.snap();
        ctx.audio.play('respawn');
        this.playerDown = false;
        this.player.entry.alive = true;
        this.player.lastHitBy = null;
        this.killedBy = '';
      }
    }
  }
}
