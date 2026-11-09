import * as THREE from 'three';
import { ARENA } from '../core/types';
import { BLADE_Z } from './models';
import { VOLT_CLAP_R, VOLT_CLAP_WIND } from './voltRival';
import { POUND_R, POUND_WIND } from './bruteRival';
import { lavaAhead } from '../world/terrainMotion';
import { RIVAL_R, SLAM_MIN_R, SLAM_WIND, wrap, clamp, type Fighter } from './shared';
import type { Rival } from './rival';
import { BrawlPhysics } from './BrawlPhysics';

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/* Snowdome Brawl: rival AI (gather / fight / heal / flee decisions, steering, attack triggers). */

export abstract class BrawlAI extends BrawlPhysics {
  /* ================================================================== AI */

  protected think(r: Rival): void {
    const skill = r.s.skill;
    const pers = r.pers;
    const hp = r.hp / r.maxHp;

    // Get clear of a crackling VOLT-9 about to Thunderclap / a BRUTUS winding up a Ground Pound.
    if (r.dodgeT <= 0 && skill > 0.5 && Math.random() < skill) {
      for (const o of this.rivals) {
        if (o === r || !o.alive || (o.clapT < 0 && o.poundT < 0)) continue;
        const dx = r.position.x - o.position.x;
        const dz = r.position.z - o.position.z;
        const clap = o.clapT >= 0;
        if (Math.hypot(dx, dz) > (clap ? VOLT_CLAP_R : POUND_R) + RIVAL_R + 1) continue;
        r.dodgeT = clap ? VOLT_CLAP_WIND : POUND_WIND;
        r.dodgeH = Math.atan2(dx, dz);
        return;
      }
    }

    // Dodge incoming dash-strikes / slams aimed at us.
    if (r.dodgeT <= 0 && Math.random() < skill * 0.9) {
      for (const f of this.fighters) {
        if (f.rival === r || !this.isAlive(f)) continue;
        // Dashes / slam wind-ups always read as threats; smart rivals (elites, Legend) also respect anyone
        // lining up a big held ball on them.
        const smart = r.s.elite || skill >= 0.9;
        const bigBall = smart && (f.rival ? f.rival.ballR >= 0.8 && f.rival.slamCd <= 0 : this.ctx.plow.heldBallRadius >= 0.8);
        const threat = f.rival ? f.rival.dashing || f.rival.slamT >= 0 || bigBall : this.ctx.plow.dashing || bigBall;
        if (!threat) continue;
        if (bigBall && Math.hypot(r.position.x - this.fx(f), r.position.z - this.fz(f)) > 8) continue;
        const dx = r.position.x - this.fx(f);
        const dz = r.position.z - this.fz(f);
        const d = Math.hypot(dx, dz);
        if (d > 14) continue;
        const h = f.rival ? f.rival.heading : this.ctx.plow.heading;
        const aim = Math.abs(wrap(Math.atan2(dx, dz) - h));
        if (aim < 0.45) {
          r.dodgeT = 0.55;
          const side = wrap(Math.atan2(dx, dz) - r.heading) > 0 ? 1 : -1;
          r.dodgeH = Math.atan2(dx, dz) + side * Math.PI * 0.5;
          if (
            r.dashCd <= 0 && skill > 0.6 && Math.random() < pers.dashLove &&
            // (never hop into lava: the 15 m/s push slides 15 / decay m before it dies out)
            !(this.lava.list.length && lavaAhead(this.lava, r.position.x, r.position.z, r.dodgeH, 1, RIVAL_R + 1 + 15 / (4 - 3 * r.ice), RIVAL_R * 0.6, ARENA.maxX - RIVAL_R))
          ) {
            // Side-hop out of the lane (no heading snap): a burst of lateral velocity on the dash cooldown.
            r.kvx += Math.sin(r.dodgeH) * 15;
            r.kvz += Math.cos(r.dodgeH) * 15;
            r.dashCd = r.s.dashCd * 0.6;
            this.sfx('dash', r.position.x, r.position.z, 0.6, 1.2);
            if (this.near(r.position.x, r.position.z, 60)) {
              _v.set(r.position.x, 0.5, r.position.z);
              this.ctx.fx.burst(_v, { color: 0xffffff, count: 14, speed: 6, size: 0.24, gravity: 14, life: 0.6 });
            }
          }
          return;
        }
      }
    }

    // Heal / flee when hurt. Bots on a streak protect it: they bail out earlier.
    const streaking = r.f.entry.streak >= 3;
    if (hp < 0.35 * (0.6 + pers.caution) + (streaking ? 0.18 : 0) + (r.s.elite ? 0.08 : 0) && this.cocoas.length) {
      r.mode = 'heal';
      return;
    }
    if (hp < 0.2 + (streaking ? 0.1 : 0) && (pers.caution > 0.3 || streaking)) {
      r.mode = 'flee';
      return;
    }

    // Pick a target.
    let best: Fighter | null = null;
    let bestS = -Infinity;
    let maxKills = 0;
    for (const f of this.fighters) if (!f.entry.isPlayer) maxKills = Math.max(maxKills, f.entry.kills);
    // Cap how many rivals hunt the player at once (the lobby focuses you, but doesn't all pile on).
    let hunters = 0;
    for (const o of this.rivals) if (o !== r && o.alive && o.target === this.player) hunters++;
    // A player on a 5+ streak draws one extra hunter (bounty).
    const playerOpen = hunters < this.diff.maxHunters + (this.player.entry.streak >= 5 ? 1 : 0);
    const pe = this.player.entry;
    const playerLeads = pe.kills > 0 && pe.kills >= maxKills;
    for (const f of this.fighters) {
      if (f.rival === r || !this.isTargetable(f)) continue;
      if (f === this.player && !playerOpen) continue;
      const d = Math.hypot(this.fx(f) - r.position.x, this.fz(f) - r.position.z);
      let s = 60 / (d + 8);
      s += (1 - this.hpFrac(f)) * (pers.id === 'vulture' || r.s.elite ? 2 : 0.9) * pers.aggression;
      if (r.f.lastHitBy === f && this.time - r.f.lastHitAt < 6) s += 1.2;
      if (f === r.target) s += 0.4; // commitment
      if (f === this.player) {
        // Bounty hunting: the lobby goes after the player, harder when they lead or are on a streak.
        s += this.diff.playerFocus;
        if (playerLeads) s += 0.3 * this.diff.playerFocus;
        s += 0.2 * this.tierOf(pe.streak) * this.diff.playerFocus;
      } else {
        // Elites farm weaker bots; ordinary bots only mildly chase other bots' bounties.
        if (r.s.elite && f.rival && !f.rival.s.elite) s += 0.35;
        // Elites mostly leave each other alone (they farm bots and hunt the player) unless it's revenge.
        else if (r.s.elite && f.rival?.s.elite && r.f.lastHitBy !== f) s -= 0.35;
        // Ordinary bots steer clear of elites (more so when streaking) unless it's revenge — shutting elites
        // down is the player's job (and pays the shutdown bounty).
        else if (!r.s.elite && f.rival?.s.elite && r.f.lastHitBy !== f) s -= f.entry.streak >= 3 ? 0.9 : 0.45;
        else if (f.entry.streak >= 3) s += 0.2;
      }
      if (s > bestS) {
        bestS = s;
        best = f;
      }
    }
    r.target = best;
    const tDist = best ? Math.hypot(this.fx(best) - r.position.x, this.fz(best) - r.position.z) : Infinity;

    // Gather snow if the ball is small and nobody is in our face.
    const wantBall = 0.35 + 0.6 * pers.ballHunger;
    const engageRange = 16 - 6 * pers.aggression + (best === this.player ? 10 * this.diff.playerFocus : 0) + (r.s.elite ? 6 : 0);
    if (r.ballR < wantBall && tDist > engageRange) {
      r.mode = 'gather';
      return;
    }
    r.mode = best ? 'fight' : 'gather';
  }

  /** Per-frame steering toward the current goal + attack triggers. */
  protected steer(r: Rival, dt: number): void {
    const ctx = this.ctx;
    if (r.slamT >= 0) {
      r.desSpeed = r.slamT < SLAM_WIND ? 2 : this.topSpeed(r);
      return;
    }
    if (r.stunT > 0) {
      r.desSpeed = 0;
      r.desH = r.heading;
      return;
    }
    if (r.clapT >= 0) {
      // Charging a Thunderclap: brake and crackle.
      r.desSpeed = 1.5;
      return;
    }
    if (r.poundT >= 0) {
      // Winding up a Ground Pound: plant and hop.
      r.desSpeed = 0;
      r.desH = r.heading;
      return;
    }
    if (r.stuckT > 0) {
      r.stuckT -= dt;
      r.desSpeed = -6;
      r.desH = r.heading + 1.2;
      return;
    }
    if (r.recoverT > 0) {
      r.recoverT -= dt;
      r.desSpeed = -5;
      r.desH = r.heading;
      return;
    }
    if (r.dodgeT > 0) {
      r.dodgeT -= dt;
      this.headTo(r, r.position.x + Math.sin(r.dodgeH) * 10, r.position.z + Math.cos(r.dodgeH) * 10, this.topSpeed(r));
      return;
    }

    let gx = r.position.x;
    let gz = r.position.z;
    let spd = this.topSpeed(r);
    switch (r.mode) {
      case 'gather': {
        r.goalT -= dt;
        if (r.goalT <= 0 || Math.hypot(r.goalX - r.position.x, r.goalZ - r.position.z) < 4) this.pickSnowGoal(r);
        gx = r.goalX;
        gz = r.goalZ;
        spd = this.topSpeed(r) * 0.85;
        break;
      }
      case 'heal': {
        let bd = Infinity;
        for (const c of this.cocoas) {
          const d = Math.hypot(c.x - r.position.x, c.z - r.position.z);
          if (d < bd) {
            bd = d;
            gx = c.x;
            gz = c.z;
          }
        }
        if (bd === Infinity) r.mode = 'fight';
        break;
      }
      case 'flee': {
        const t = r.f.lastHitBy;
        if (t && this.isAlive(t)) {
          gx = r.position.x + (r.position.x - this.fx(t));
          gz = r.position.z + (r.position.z - this.fz(t));
        }
        break;
      }
      case 'fight': {
        const t = r.target;
        if (!t || !this.isTargetable(t)) {
          r.mode = 'gather';
          break;
        }
        const tx = this.fx(t);
        const tz = this.fz(t);
        // Lead the target by its velocity (better aim with skill).
        let tvx = 0;
        let tvz = 0;
        if (t.rival) {
          tvx = t.rival.vx;
          tvz = t.rival.vz;
        } else {
          ctx.plow.getForward(_fwd);
          tvx = _fwd.x * ctx.plow.speed;
          tvz = _fwd.z * ctx.plow.speed;
        }
        const d = Math.hypot(tx - r.position.x, tz - r.position.z);
        const lead = (d / 20) * r.s.skill;
        gx = tx + tvx * lead;
        gz = tz + tvz * lead;
        const ang = Math.abs(wrap(Math.atan2(gx - r.position.x, gz - r.position.z) - r.heading));
        const br = r.ballR;
        const tR = t.rival ? RIVAL_R : ctx.plow.radius;
        // THUNDERCLAP (VOLT-9) when anyone is well inside the blast radius.
        if (r.s.volt && r.clapCd <= 0 && r.slamT < 0 && r.whirlT < 0 && !r.dashing && this.countEnemiesNear(r, VOLT_CLAP_R * 0.75) >= 1) {
          this.startClap(r);
          break;
        }
        // GROUND POUND (BRUTUS) when anyone is well inside the ring.
        if (r.s.brute && r.poundCd <= 0 && r.slamT < 0 && r.whirlT < 0 && !r.dashing && this.countEnemiesNear(r, POUND_R * 0.7) >= 1) {
          this.startPound(r);
          break;
        }
        // SLAM when close and lined up with a decent ball.
        if (br >= SLAM_MIN_R && r.slamCd <= 0 && r.whirlT < 0 && d < BLADE_Z + br * 2 + tR + 1.2 && ang < 0.5) {
          this.startSlam(r);
          break;
        }
        // WHIRL when swarmed.
        if (r.whirlCd <= 0 && r.slamT < 0) {
          const near = this.countEnemiesNear(r, r.s.whirlR + br);
          if (near >= 2 || (near >= 1 && Math.random() < r.pers.whirlLove * dt * 1.5)) {
            this.startWhirl(r);
            break;
          }
        }
        // DASH STRIKE when aligned at mid range.
        const tol = 0.1 + 0.3 * (1 - r.s.skill);
        // (never a dash towards lava: the course must stay clear for the dash and the braking glide after it)
        if (
          r.dashCd <= 0 && d > 5 && d < 15 && ang < tol && Math.random() < r.pers.dashLove * dt * 4 &&
          !(this.lava.list.length && lavaAhead(this.lava, r.position.x, r.position.z, r.heading, 1, this.dashReach(r), RIVAL_R * 0.6, ARENA.maxX - RIVAL_R))
        ) {
          this.startDash(r);
          break;
        }
        // Otherwise drive in to ram — ease off when holding a slam-worthy ball to line it up.
        spd = br >= SLAM_MIN_R && d < 9 ? 6.5 : this.topSpeed(r);
        break;
      }
    }
    this.headTo(r, gx, gz, spd);
  }

  /** Set desired heading toward (gx, gz) with obstacle/wall avoidance. */
  protected headTo(r: Rival, gx: number, gz: number, spd: number): void {
    let dx = gx - r.position.x;
    let dz = gz - r.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    dx /= dist;
    dz /= dist;
    // Obstacles ahead: steer around.
    let ax = 0;
    let az = 0;
    for (const o of this.ctx.world.obstacles) {
      const ox = o.x - r.position.x;
      const oz = o.z - r.position.z;
      const along = ox * dx + oz * dz;
      if (along < 0 || along > 14 || along > dist) continue;
      const lat = ox * dz - oz * dx; // signed lateral offset
      const need = o.r + RIVAL_R + 1.2;
      if (Math.abs(lat) < need) {
        const push = (need - Math.abs(lat)) / need * (1 - along / 16);
        const side = lat >= 0 ? -1 : 1;
        ax += dz * side * push * 2.2;
        az += -dx * side * push * 2.2;
      }
    }
    // Walls.
    const m = 7;
    const p = r.position;
    if (p.x > ARENA.maxX - m) ax -= (p.x - (ARENA.maxX - m)) / m;
    if (p.x < ARENA.minX + m) ax += (ARENA.minX + m - p.x) / m;
    if (p.z > ARENA.maxZ - m) az -= (p.z - (ARENA.maxZ - m)) / m;
    if (p.z < ARENA.minZ + m) az += (ARENA.minZ + m - p.z) / m;
    dx += ax;
    dz += az;
    r.desH = Math.atan2(dx, dz);
    const turnNeed = Math.abs(wrap(r.desH - r.heading));
    r.desSpeed = turnNeed > 1.6 ? spd * 0.4 : spd;
  }

  protected pickSnowGoal(r: Rival): void {
    const snow = this.ctx.snow;
    let bx = r.position.x;
    let bz = r.position.z;
    let bd = -1;
    const lim = ARENA.maxX - 8;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const rad = 8 + Math.random() * 30;
      const x = clamp(r.position.x + Math.sin(a) * rad, -lim, lim);
      const z = clamp(r.position.z + Math.cos(a) * rad, -lim, lim);
      const d = snow.getDepth(x, z) - rad * 0.004;
      if (d > bd) {
        bd = d;
        bx = x;
        bz = z;
      }
    }
    r.goalX = bx;
    r.goalZ = bz;
    r.goalT = 2.5 + Math.random() * 2;
  }

  protected countEnemiesNear(r: Rival, rad: number): number {
    let n = 0;
    for (const f of this.fighters) {
      if (f.rival === r || !this.isTargetable(f)) continue;
      if (Math.hypot(this.fx(f) - r.position.x, this.fz(f) - r.position.z) < rad) n++;
    }
    return n;
  }
}
