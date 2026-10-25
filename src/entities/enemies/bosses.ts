import * as THREE from 'three';
import { ballRadius, ballVolume } from '../../core/types';
import type { EnemyType } from '../../config/enemies';
import { Bot, Vuln, type Host } from './Bot';
import { clamp, face, goTo } from './ai';
import { donaldProps, type WallLine } from './donaldProps';
import { ARENA } from '../../core/types';

/* Boss AI. Every big move has a readable wind-up (>= 0.6s): glowing parts, the bot backing up / revving,
 * and a ground decal (red chevron stripe for charges/dashes, a filling warning ring for AOE moves). */

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const STRIPE_RED = 0xff2a1a;

interface ChargeCfg {
  speed: number;
  maxT: number;
  dmg: number;
  knock: number;
}

function beginChargeWind(h: Host, e: Bot, wind: number): void {
  e.set('chargeWind', wind);
  e.aimH = Math.atan2(h.px - e.position.x, h.pz - e.position.z);
  h.sfx('charge', 0.85, e.radius > 2.8 ? 0.7 : 0.9, 0.15);
}

function chargeWind(h: Host, e: Bot, c: ChargeCfg): void {
  const p = e.prog;
  // track the plow for the first 65% of the wind-up, then the lane LOCKS (dodge window)
  if (p < 0.65) e.aimH = Math.atan2(h.px - e.position.x, h.pz - e.position.z);
  e.desHeading = e.aimH;
  e.turnRate = 4.5;
  e.desSpeed = -1.4;
  e.accel = 6;
  e.windup = p;
  e.glow = p;
  e.jitter = 0.03 + 0.05 * p;
  const fx = Math.sin(e.aimH);
  const fz = Math.cos(e.aimH);
  const sx = e.position.x + fx * e.radius * 0.7;
  const sz = e.position.z + fz * e.radius * 0.7;
  const len = h.wallDist(sx, sz, fx, fz, c.speed * c.maxT);
  const locked = p >= 0.65;
  const alpha = (0.3 + 0.4 * p) * (locked ? 0.75 + 0.25 * Math.sin(h.time * 30) : 0.85);
  h.stripe(e, sx, sz, fx, fz, len, e.radius * 2, STRIPE_RED, alpha);
  if (e.stateT <= 0) {
    h.clearTele(e);
    e.set('charge', c.maxT);
    e.startAtk(c.dmg, c.knock);
    e.speed = 5;
    e.windup = 0;
    e.jitter = 0;
  }
}

/** Returns 'wall' if the charge slammed a wall this frame, 'done' when it ran out, else null. */
function charge(h: Host, e: Bot, c: ChargeCfg): 'wall' | 'done' | null {
  e.desHeading = e.aimH;
  e.turnRate = 0.25;
  e.desSpeed = c.speed;
  e.accel = 40;
  e.glow = 1;
  // once it connects, the charge peters out quickly (no pinning the plow against a wall forever)
  if (e.atkHits > 0 && e.stateT > 0.35) e.stateT = 0.35;
  const snow = h.ctx.snow;
  if (snow && e.speed > 6) {
    // kick up a snow wake off the blade
    const fx = Math.sin(e.heading);
    const fz = Math.cos(e.heading);
    snow.plowLine(
      e.position.x + fx * e.radius + fz * e.radius * 0.9,
      e.position.z + fz * e.radius - fx * e.radius * 0.9,
      e.position.x + fx * e.radius - fz * e.radius * 0.9,
      e.position.z + fz * e.radius + fx * e.radius * 0.9,
      0.6,
      0.25,
    );
    _v.set(e.position.x + fx * e.radius, e.groundY + 0.4, e.position.z + fz * e.radius);
    h.ctx.fx.spray(_v, _v2.set(fx, 0.4, fz).normalize(), 1);
  }
  if (e.wallHit && e.speed > 5) {
    e.endAtk();
    e.glow = 0;
    return 'wall';
  }
  if (e.stateT <= 0) {
    e.endAtk();
    e.glow = 0;
    return 'done';
  }
  return null;
}

/** Big slam into an arena wall: STUNNED with stars and x1.5 damage taken. */
function wallSlam(h: Host, e: Bot, stunT: number): void {
  wallBump(h, e, 1);
  e.stun = stunT;
  e.stunMult = 1.5;
  h.label(e, 'STUNNED!', '#ffe14a', 1.1);
  h.sfx('stun', 0.9, 1, 0.1);
}

function wallBump(h: Host, e: Bot, k: number): void {
  const fx = h.ctx.fx;
  const wx = e.position.x - e.wallNx * e.radius;
  const wz = e.position.z - e.wallNz * e.radius;
  _v.set(wx, e.groundY + 1.2, wz);
  fx.burst(_v, { color: 0xffc04a, count: 26, speed: 11, size: 0.12, gravity: 22, life: 0.5 });
  fx.burst(_v, { color: 0xffffff, count: 22, speed: 7, size: 0.3, gravity: 14, life: 0.9 });
  fx.burst(_v, { color: 0x8a929c, count: 10, speed: 6, size: 0.22, gravity: 20, life: 0.8 });
  _v.y = e.groundY + 0.1;
  fx.ring(_v, 3 + e.radius, 0xffe0a0);
  fx.shake(0.5 + e.radius * 0.12 * k);
  h.sfx('wallHit', 1, 1 - e.radius * 0.05, 0.1);
  e.speed = 0;
  e.kvx = e.wallNx * 5;
  e.kvz = e.wallNz * 5;
}

/** Generic shove: wind-up (backs up, blade glows) then a short lunge with an attack window. */
function shove(h: Host, e: Bot, dmg: number, knock: number, lungeSpeed: number): void {
  if (e.state === 'shoveWind') {
    face(e, h.px, h.pz);
    e.turnRate = 2.2;
    e.desSpeed = -1.2;
    e.windup = e.prog;
    e.glow = e.prog;
    if (e.stateT <= 0) {
      e.set('shove', 0.4);
      e.startAtk(dmg, knock);
      e.speed = 3;
      e.windup = 0;
    }
  } else {
    e.desSpeed = lungeSpeed;
    e.accel = 40;
    e.turnRate = 0.6;
    if ((e.atkHits > 0 && e.stateT < 0.2) || e.stateT <= 0) {
      e.endAtk();
      e.set('recover', 0.8);
    }
  }
}

function recover(e: Bot, dt: number): boolean {
  e.desSpeed = 0;
  e.windup = 0;
  e.jitter = 0;
  e.glow = Math.max(0, e.glow - dt * 2);
  return e.stateT <= 0;
}

/* ------------------------------------------------------------------ BULLDOZA */

function bulldoza(h: Host, e: Bot, dt: number): void {
  const d = h.dist(e);
  if (!e.enraged && e.hpFrac <= 0.5) {
    e.enraged = true;
    h.bossPhase(e, 'ENRAGED!');
  }
  const spd = e.def.speed * (e.enraged ? 1.15 : 1);
  const C: ChargeCfg = { speed: 20, maxT: 2.5, dmg: e.def.ramDamage * 1.35, knock: 24 };
  switch (e.state) {
    case 'chargeWind':
      chargeWind(h, e, C);
      break;
    case 'charge': {
      const r = charge(h, e, C);
      if (r === 'wall') {
        if (e.chargesLeft > 1) {
          // enraged double charge: bounce off and immediately line up the second one
          e.chargesLeft--;
          wallBump(h, e, 0.6);
          beginChargeWind(h, e, 0.8);
        } else {
          wallSlam(h, e, 2.5);
          e.set('recover', 0.4);
        }
      } else if (r === 'done') {
        if (e.chargesLeft > 1) {
          e.chargesLeft--;
          beginChargeWind(h, e, 0.8);
        } else e.set('recover', e.atkHits > 0 ? 1.8 : 1.0); // gloats after landing a hit: punish window
      }
      break;
    }
    case 'shoveWind':
    case 'shove':
      shove(h, e, e.def.ramDamage, 16, 11);
      break;
    case 'recover':
      if (recover(e, dt)) {
        e.set('approach', 0);
        e.cd = (1.6 + Math.random() * 0.8) * (e.enraged ? 0.7 : 1);
      }
      break;
    default:
      goTo(e, h.px, h.pz, spd, 3);
      e.turnRate = 1.5;
      if (e.cd <= 0) {
        if (d < e.radius + h.pr + 1.6) {
          e.set('shoveWind', 0.6);
          h.sfx('charge', 0.4, 0.65, 0.2);
        } else if (d > 8) {
          e.chargesLeft = e.enraged ? 2 : 1;
          beginChargeWind(h, e, 1.0);
        }
      }
  }
}

/* ------------------------------------------------------------------ FROSTBYTE */

const MAX_FB_BALL = ballVolume(2.2);

function frostbyteImpact(h: Host, e: Bot): void {
  const ctx = h.ctx;
  const fx = Math.sin(e.heading);
  const fz = Math.cos(e.heading);
  const R = e.ballR;
  const bx = e.position.x + fx * (e.rig.front + R * 0.9);
  const bz = e.position.z + fz * (e.rig.front + R * 0.9);
  const dx = h.px - bx;
  const dz = h.pz - bz;
  const dd = Math.hypot(dx, dz);
  const toP = Math.atan2(h.px - e.position.x, h.pz - e.position.z);
  const ang = Math.abs(Math.atan2(Math.sin(toP - e.heading), Math.cos(toP - e.heading)));
  if (dd < R + h.pr + 2.2 && ang < 1.05) {
    h.hitPlow(e, Math.min(45, 18 * R * R), { knockback: 15 });
  }
  _v.set(bx, e.groundY + R, bz);
  ctx.fx.burst(_v, { color: 0xffffff, count: 40 + Math.round(R * 20), speed: 9, size: 0.35, gravity: 14, life: 1.0 });
  ctx.fx.burst(_v, { color: 0x9feaff, count: 16, speed: 6, size: 0.2, gravity: 10, life: 0.8 });
  _v.y = e.groundY + 0.1;
  ctx.fx.ring(_v, R * 2.5 + 1.5, 0xbff4ff);
  ctx.fx.shake(0.55);
  h.sfx('slam', 1, 0.85, 0.1);
  ctx.snow?.addSnow(bx, bz, R * 1.6, e.ballVol * 0.5);
  e.ballVol = 0;
  e.ballR = 0;
}

function frostbyte(h: Host, e: Bot, dt: number): void {
  const d = h.dist(e);
  if (!e.enraged && e.hpFrac <= 0.4) {
    e.enraged = true;
    h.bossPhase(e, 'OVERCLOCKED!');
    h.spawnAtGate('thief', 1);
    h.spawnAtGate('thief', 2);
  }
  const spd = e.def.speed * (e.enraged ? 1.3 : 1);
  switch (e.state) {
    case 'slamWind': {
      const p = e.prog;
      if (p < 0.7) e.aimH = Math.atan2(h.px - e.position.x, h.pz - e.position.z);
      e.desHeading = e.aimH;
      e.turnRate = 3.5;
      e.desSpeed = -2.6;
      e.windup = p;
      e.glow = p;
      const fx = Math.sin(e.aimH);
      const fz = Math.cos(e.aimH);
      const sx = e.position.x + fx * e.rig.front;
      const sz = e.position.z + fz * e.rig.front;
      h.stripe(e, sx, sz, fx, fz, h.wallDist(sx, sz, fx, fz, 7 + e.ballR * 2), e.ballR * 2 + 1.2, 0xff3355, 0.35 + 0.4 * p);
      if (e.stateT <= 0) {
        h.clearTele(e);
        e.set('slam', 0.5);
        e.speed = 4;
        e.windup = 0;
      }
      break;
    }
    case 'slam':
      e.desHeading = e.aimH;
      e.turnRate = 0.5;
      e.desSpeed = 15;
      e.accel = 50;
      if (e.stateT <= 0 || d < e.radius + e.ballR * 2 + h.pr * 0.8 || e.wallHit) {
        frostbyteImpact(h, e);
        e.set('recover', 0.8);
        e.cd = 2.5;
      }
      break;
    case 'ramWind':
      face(e, h.px, h.pz);
      e.turnRate = 4;
      e.desSpeed = -1.5;
      e.windup = e.prog;
      if (e.stateT <= 0) {
        e.set('ram', 0.6);
        e.startAtk(e.def.ramDamage, 10, false, 0, 0.4);
        e.speed = 4;
        e.windup = 0;
      }
      break;
    case 'ram':
      face(e, h.px, h.pz);
      e.turnRate = 2;
      e.desSpeed = 14;
      e.accel = 40;
      if (e.atkHits > 0 || e.stateT <= 0) {
        e.endAtk();
        e.set('recover', 0.6);
        e.cd2 = 4.5;
      }
      break;
    case 'recover':
      if (recover(e, dt)) {
        e.set('hunt', 0);
        e.cd = Math.max(e.cd, 0.8);
      }
      break;
    default: {
      if (e.cd <= 0 && e.ballR >= 1 && d < 7 + e.radius) {
        e.set('slamWind', 0.7);
        e.aimH = Math.atan2(h.px - e.position.x, h.pz - e.position.z);
        h.sfx('charge', 0.6, 1.25, 0.15);
      } else if (e.cd2 <= 0 && h.plowBall > 0.5 && d < 11) {
        e.set('ramWind', 0.6);
        h.sfx('charge', 0.45, 1.6, 0.15);
      } else {
        const wantBall = e.ballR < 1 || (e.ballR < 1.3 && d > 14);
        if (wantBall) {
          const snow = h.ctx.snow;
          if (e.retargetT <= 0 || Math.hypot(e.tx - e.position.x, e.tz - e.position.z) < 3) {
            e.retargetT = 3;
            let best = -1;
            for (let i = 0; i < 10; i++) {
              const x = -24 + Math.random() * 48;
              const z = -24 + Math.random() * 48;
              let s = snow ? snow.getDepth(x, z) : 0.5;
              if (Math.hypot(x - h.px, z - h.pz) < 6) s *= 0.3;
              s -= Math.hypot(x - e.position.x, z - e.position.z) * 0.004;
              if (s > best) {
                best = s;
                e.tx = x;
                e.tz = z;
              }
            }
          }
          goTo(e, e.tx, e.tz, spd, 2);
        } else {
          goTo(e, h.px, h.pz, spd, 3);
        }
      }
    }
  }
  // It plows its own snowball with its blade, just like the player.
  const snow = h.ctx.snow;
  if (snow && e.speed > 1.5 && e.state !== 'slam' && e.ballVol < MAX_FB_BALL) {
    const fx = Math.sin(e.heading);
    const fz = Math.cos(e.heading);
    const cx = e.position.x + fx * e.rig.front;
    const cz = e.position.z + fz * e.rig.front;
    const hw = e.radius * 0.9;
    const vol = snow.plowLine(cx + fz * hw, cz - fx * hw, cx - fz * hw, cz + fx * hw, Math.max(0.12, e.speed * dt * 1.1), 0.25);
    e.ballVol = Math.min(MAX_FB_BALL, e.ballVol + vol * 0.12);
  }
  e.ballR = e.ballVol > 0 ? ballRadius(e.ballVol) : 0;
}

/* ------------------------------------------------------------------ THE GRINDER */

function grinder(h: Host, e: Bot, dt: number): void {
  const d = h.dist(e);
  if (e.phase < 1 && e.hpFrac <= 0.6) {
    e.phase = 1;
    h.bossPhase(e, 'PHASE 2');
    h.spawnAtGate('scrapper', 1);
    h.spawnAtGate('scrapper', 2);
  }
  if (e.phase < 2 && e.hpFrac <= 0.3) {
    e.phase = 2;
    e.enraged = true;
    h.bossPhase(e, 'PHASE 3');
    h.spawnAtGate('scrapper', 1);
    h.spawnAtGate('scrapper', 2);
  }
  const spd = e.def.speed * (e.enraged ? 1.15 : 1);
  const R = 7;
  switch (e.state) {
    case 'spinWind': {
      const p = e.prog;
      e.desSpeed = 0;
      e.windup = p;
      e.glow = p;
      e.augerRate = 4 + 26 * p;
      e.jitter = 0.05 * p;
      h.ring(e, e.position.x, e.position.z, R, p, 0xff7a00, (0.35 + 0.45 * p) * (0.75 + 0.25 * Math.sin(h.time * 18)));
      if (e.sparkT <= 0) {
        e.sparkT = 0.08;
        h.sparks(e, 0xffa040, 4);
      }
      if (e.stateT <= 0) {
        e.set('spin', 2.2);
        e.cd3 = 0;
        e.windup = 0;
        e.jitter = 0;
        h.sfx('whirl', 0.9, 0.55, 0.1);
        h.sfx('shockwave', 0.5, 1.4, 0.1);
      }
      break;
    }
    case 'spin': {
      e.desSpeed = 0;
      e.spinRate = 10;
      e.augerRate = 30;
      e.glow = 1;
      h.ring(e, e.position.x, e.position.z, R, 1, 0xff5a00, 0.22 + 0.15 * Math.sin(h.time * 25));
      const inRange = d < R + h.pr * 0.5;
      const plow = h.ctx.plow;
      if (inRange && !plow.dead) {
        const k = 15 * dt;
        plow.push(-h.ux * k, -h.uz * k);
      }
      if (e.cd3 <= 0) {
        e.cd3 = 0.3;
        if (inRange) h.hitPlow(e, 9 * (e.enraged ? 1.15 : 1), { knockback: 0.5, unblockable: true });
        h.sparks(e, 0xffb040, 6);
      }
      h.ctx.snow?.collectDisc(e.position.x, e.position.z, 4.5, Math.min(1, dt * 0.6));
      if (e.stateT <= 0) {
        e.vuln = Vuln.Dizzy;
        e.vulnT = 2.2;
        e.vulnMult = 1.5;
        e.set('dizzy', 2.2);
        h.clearTele(e);
        h.label(e, 'DIZZY!', '#ffe14a', 1.1);
        h.sfx('stun', 0.8, 0.9, 0.1);
      }
      break;
    }
    case 'dizzy':
      e.desSpeed = 0;
      e.spinRate *= Math.exp(-2.5 * dt);
      e.augerRate = Math.max(1, e.augerRate * Math.exp(-2 * dt));
      e.glow = 0;
      if (e.sparkT <= 0) {
        e.sparkT = 0.18;
        h.sparks(e, 0xffd060, 3);
      }
      if (e.stateT <= 0) {
        e.set('approach', 0);
        e.cd = 1.4;
      }
      break;
    case 'dashWind': {
      const p = e.prog;
      if (p < 0.6) e.aimH = Math.atan2(h.px - e.position.x, h.pz - e.position.z);
      e.desHeading = e.aimH;
      e.turnRate = 3.5;
      e.desSpeed = -1;
      e.windup = p;
      e.augerRate = 6 + 20 * p;
      e.jitter = 0.04 * p;
      const fx = Math.sin(e.aimH);
      const fz = Math.cos(e.aimH);
      const sx = e.position.x + fx * e.radius * 0.7;
      const sz = e.position.z + fz * e.radius * 0.7;
      h.stripe(e, sx, sz, fx, fz, h.wallDist(sx, sz, fx, fz, 12 + e.radius), e.radius * 2, STRIPE_RED, 0.3 + 0.45 * p);
      if (e.stateT <= 0) {
        h.clearTele(e);
        e.set('dash', 0.75);
        e.startAtk(e.def.ramDamage * 1.4, 18);
        e.speed = 4;
        e.windup = 0;
        e.jitter = 0;
      }
      break;
    }
    case 'dash':
      e.desHeading = e.aimH;
      e.turnRate = 0.2;
      e.desSpeed = 16;
      e.accel = 50;
      e.augerRate = 30;
      if (e.wallHit && e.speed > 5) {
        e.endAtk();
        wallBump(h, e, 0.8);
        e.set('recover', 0.9);
      } else if (e.stateT <= 0) {
        e.endAtk();
        e.set('recover', 0.8);
      }
      break;
    case 'recover':
      if (recover(e, dt)) {
        e.set('approach', 0);
        e.cd = (1.2 + Math.random()) * (e.enraged ? 0.7 : 1);
      }
      break;
    default: {
      goTo(e, h.px, h.pz, spd, 3);
      e.turnRate = 1.1;
      e.augerRate = 6;
      // the auger eats the snow in front of it
      const snow = h.ctx.snow;
      if (snow && e.speed > 0.5) {
        const fx = Math.sin(e.heading);
        const fz = Math.cos(e.heading);
        snow.collectDisc(e.position.x + fx * (e.radius + 1.2), e.position.z + fz * (e.radius + 1.2), 1.8, Math.min(1, 1.2 * dt));
      }
      if (e.cd <= 0) {
        if (d < 8) {
          e.set('spinWind', 1.2);
          h.sfx('charge', 0.7, 0.55, 0.15);
        } else if (d < 24) {
          e.set('dashWind', 0.8);
          e.aimH = Math.atan2(h.px - e.position.x, h.pz - e.position.z);
          h.sfx('charge', 0.7, 0.85, 0.15);
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ SLUSH & SLEET */

function twinEnrage(h: Host, e: Bot, other: EnemyType): Bot | null {
  const twin = h.findBoss(other);
  if (twin) e.flags |= 1;
  else if (!e.enraged && e.flags & 1) {
    e.enraged = true;
    h.bossPhase(e, 'ENRAGED!');
  }
  return twin;
}

function slush(h: Host, e: Bot, dt: number): void {
  const d = h.dist(e);
  const twin = twinEnrage(h, e, 'sleet');
  const sm = e.enraged ? 1.4 : 1;
  const dm = e.enraged ? 1.3 : 1;
  const C: ChargeCfg = { speed: 18 * (e.enraged ? 1.15 : 1), maxT: 2.0, dmg: e.def.ramDamage * 1.25 * dm, knock: 20 };
  switch (e.state) {
    case 'chargeWind':
      chargeWind(h, e, C);
      break;
    case 'charge': {
      const r = charge(h, e, C);
      if (r === 'wall') {
        wallSlam(h, e, 1.5);
        e.set('recover', 0.4);
      } else if (r === 'done') {
        if (e.enraged && e.chargesLeft > 1) {
          e.chargesLeft--;
          beginChargeWind(h, e, 0.7);
        } else e.set('recover', 0.8);
      }
      break;
    }
    case 'recover':
      if (recover(e, dt)) {
        if (e.enraged) {
          // back-to-back charges
          e.chargesLeft = 2;
          beginChargeWind(h, e, 0.7);
        } else {
          e.set('lineup', 3.5);
          e.cd = 1.2;
        }
      }
      break;
    default: {
      // line up on the opposite side of the plow from SLEET
      let vx: number;
      let vz: number;
      if (twin) {
        vx = h.px - twin.position.x;
        vz = h.pz - twin.position.z;
      } else {
        vx = e.position.x - h.px;
        vz = e.position.z - h.pz;
      }
      const vl = Math.hypot(vx, vz) || 1;
      const tx = h.px + (vx / vl) * 12;
      const tz = h.pz + (vz / vl) * 12;
      goTo(e, tx, tz, e.def.speed * sm, 3);
      const ready = Math.hypot(tx - e.position.x, tz - e.position.z) < 4 || e.stateT <= 0 || d < 7;
      if (e.cd <= 0 && ready) {
        e.chargesLeft = e.enraged ? 2 : 1;
        beginChargeWind(h, e, 0.8);
      }
    }
  }
}

function sleet(h: Host, e: Bot, dt: number): void {
  const d = h.dist(e);
  const twin = twinEnrage(h, e, 'slush');
  const sm = e.enraged ? 1.4 : 1;
  const dm = e.enraged ? 1.3 : 1;
  const SR = 4.5;
  switch (e.state) {
    case 'shoveWind':
    case 'shove':
      shove(h, e, e.def.ramDamage * dm, 13, 10);
      break;
    case 'swipeWind': {
      const p = e.prog;
      face(e, h.px, h.pz);
      e.desSpeed = 0;
      e.windup = p;
      e.glow = p;
      e.jitter = 0.03 * p;
      h.ring(e, e.position.x, e.position.z, SR, p, 0x3aa8ff, (0.35 + 0.45 * p) * (0.75 + 0.25 * Math.sin(h.time * 22)));
      if (e.stateT <= 0) {
        e.set('swipe', 0.45);
        e.counter = 0;
        e.windup = 0;
        e.jitter = 0;
        h.sfx('whirl', 0.8, 0.8, 0.1);
      }
      break;
    }
    case 'swipe':
      e.desSpeed = 0;
      e.spinRate = 14;
      h.ring(e, e.position.x, e.position.z, SR, 1, 0x3aa8ff, 0.3 * (e.stateT / 0.45));
      if (e.counter === 0 && e.stateT < 0.3) {
        e.counter = 1;
        const fx = h.ctx.fx;
        _v.set(e.position.x, e.groundY + 0.1, e.position.z);
        fx.ring(_v, SR, 0x9fd8ff);
        fx.shake(0.35);
        if (d < SR + h.pr * 0.6) {
          // knock the plow sideways into SLUSH's charge lane
          let kx: number;
          let kz: number;
          if (twin) {
            kx = twin.position.x - h.px;
            kz = twin.position.z - h.pz;
          } else {
            const s = e.id % 2 ? 1 : -1;
            kx = h.uz * s;
            kz = -h.ux * s;
          }
          const kl = Math.hypot(kx, kz) || 1;
          h.hitPlow(e, e.def.ramDamage * dm, { knockback: 18, unblockable: true, fromX: h.px - kx / kl, fromZ: h.pz - kz / kl });
          h.sfx('shockwave', 0.5, 1.3, 0.1);
        }
      }
      if (e.stateT <= 0) {
        h.clearTele(e);
        e.set('recover', 0.6);
        e.cd3 = e.enraged ? 2.5 : 5;
      }
      break;
    case 'recover':
      if (recover(e, dt)) {
        e.set('pin', 0);
        e.cd = 1.0;
      }
      break;
    default: {
      // pin: hover ~4.5m from the plow on the side opposite SLUSH
      let vx: number;
      let vz: number;
      if (twin) {
        vx = h.px - twin.position.x;
        vz = h.pz - twin.position.z;
      } else {
        vx = e.position.x - h.px;
        vz = e.position.z - h.pz;
      }
      const vl = Math.hypot(vx, vz) || 1;
      const tx = h.px + (vx / vl) * SR;
      const tz = h.pz + (vz / vl) * SR;
      if (Math.hypot(tx - e.position.x, tz - e.position.z) < 1.5) {
        face(e, h.px, h.pz);
        e.desSpeed = 0;
      } else goTo(e, tx, tz, e.def.speed * sm, 2);
      if (e.cd3 <= 0 && d < SR + 0.7) {
        e.set('swipeWind', 0.9);
        h.sfx('charge', 0.5, 1.1, 0.15);
      } else if (e.cd <= 0 && d < e.radius + h.pr + 1.0) {
        e.set('shoveWind', 0.6);
        e.cd = 1.6;
      }
    }
  }
}

/* ------------------------------------------------------------------ MEGAPLOW Ω */

function omega(h: Host, e: Bot, dt: number): void {
  const d = h.dist(e);
  if (e.phase < 1 && e.hpFrac <= 0.66) {
    e.phase = 1;
    h.bossPhase(e, 'PHASE 2');
    h.spawnAtGate('scrapper', 0);
    h.spawnAtGate('scrapper', 1);
    h.spawnAtGate('scrapper', 2);
  }
  if (e.phase < 2 && e.hpFrac <= 0.33) {
    e.phase = 2;
    e.enraged = true;
    h.bossPhase(e, 'PHASE 3 — ENRAGED!');
    h.spawnAtGate('brute', 1);
    h.spawnAtGate('brute', 2);
  }
  const spd = e.def.speed * (e.enraged ? 1.35 : 1);
  const PR = 8;
  const C: ChargeCfg = { speed: 18, maxT: e.enraged ? 1.4 : 2.5, dmg: e.def.ramDamage * 1.4, knock: 24 };
  switch (e.state) {
    case 'chargeWind':
      chargeWind(h, e, C);
      break;
    case 'charge': {
      const r = charge(h, e, C);
      if (r === 'wall') {
        wallSlam(h, e, 2);
        if (e.enraged) e.flags |= 2;
        e.set('recover', 0.3);
      } else if (r === 'done') {
        if (e.enraged) {
          e.set('poundWind', 1.1);
          h.sfx('charge', 0.8, 0.5, 0.15);
        } else e.set('recover', 0.8);
      }
      break;
    }
    case 'shoveWind':
    case 'shove':
      shove(h, e, e.def.ramDamage, 16, 10);
      break;
    case 'poundWind': {
      const p = e.prog;
      e.desSpeed = 0;
      face(e, h.px, h.pz);
      e.turnRate = 1;
      e.rear = p;
      e.windup = p;
      e.glow = p;
      e.jitter = 0.03 * p;
      h.ring(e, e.position.x, e.position.z, PR, p, 0xff1744, (0.35 + 0.5 * p) * (0.75 + 0.25 * Math.sin(h.time * 20)));
      if (e.stateT <= 0) {
        e.set('pound', 0.2);
        e.windup = 0;
        e.jitter = 0;
      }
      break;
    }
    case 'pound':
      e.desSpeed = 0;
      e.rear = Math.max(0, e.stateT / 0.2);
      h.ring(e, e.position.x, e.position.z, PR, 1, 0xff1744, 0.8);
      if (e.stateT <= 0) {
        e.rear = 0;
        h.clearTele(e);
        const fx = h.ctx.fx;
        _v.set(e.position.x, e.groundY + 0.1, e.position.z);
        fx.ring(_v, PR, 0xff3355);
        fx.ring(_v, PR * 0.6, 0xffffff);
        _v.y += 0.6;
        fx.burst(_v, { color: 0xffffff, count: 60, speed: 12, size: 0.35, gravity: 14, life: 1.0 });
        fx.burst(_v, { color: 0xff5a3a, count: 20, speed: 9, size: 0.14, gravity: 18, life: 0.6 });
        fx.shake(1.1);
        h.sfx('shockwave', 1, 0.8, 0.1);
        if (d < PR + h.pr * 0.4) h.hitPlow(e, e.def.ramDamage * 1.2, { knockback: 18, unblockable: true });
        e.vuln = Vuln.Exposed;
        e.vulnT = 1.5;
        e.vulnMult = 1.5;
        e.set('exposed', 1.5);
        h.label(e, 'CORE EXPOSED!', '#ff6a7a', 1.1);
      }
      break;
    case 'exposed':
      e.desSpeed = 0;
      e.glow = 1;
      if (e.sparkT <= 0) {
        e.sparkT = 0.15;
        h.sparks(e, 0xff4060, 3);
      }
      if (e.stateT <= 0) e.set('recover', 0.4);
      break;
    case 'recover':
      if (recover(e, dt)) {
        if (e.flags & 2) {
          e.flags &= ~2;
          e.set('poundWind', 1.1);
          h.sfx('charge', 0.8, 0.5, 0.15);
        } else {
          e.set('approach', 0);
          e.cd = (1.0 + Math.random() * 0.8) * (e.enraged ? 0.6 : 1);
        }
      }
      break;
    default:
      goTo(e, h.px, h.pz, spd, 3);
      e.turnRate = 1.1 * (e.enraged ? 1.3 : 1);
      if (e.cd <= 0) {
        if (d < e.radius + h.pr + 1.4) {
          if (e.phase >= 1 && Math.random() < 0.45) {
            e.set('poundWind', 1.1);
            h.sfx('charge', 0.8, 0.5, 0.15);
          } else {
            e.set('shoveWind', 0.6);
            h.sfx('charge', 0.45, 0.6, 0.2);
          }
        } else if (d > 10) {
          beginChargeWind(h, e, 1.0);
          e.chargesLeft = 1;
        } else if (e.phase >= 1) {
          e.set('poundWind', 1.1);
          h.sfx('charge', 0.8, 0.5, 0.15);
        }
      }
  }
}

/* ------------------------------------------------------------------ THE DONALD */

/** Caricature taunts (GOLD PLATED phase, ~every 6s). Written for the game; not quotes. */
const DONALD_TAUNTS = [
  'TREMENDOUS PLOW!',
  'THE BEST SNOW, EVERYBODY SAYS SO',
  'SAD!',
  "YOU'RE FIRED!",
  'BIGLY!',
  'FAKE SNOW!',
  'NOBODY PLOWS BETTER. NOBODY.',
  'HUGE BLADE. THE HUGEST.',
  'WRONG!',
  'LOW ENERGY PLOW!',
  'MANY PLOWS ARE SAYING IT',
  'A VERY STABLE PLOW',
];
/** Where the boss parks for a RALLY: in front of the stage (north end). */
const RALLY_X = 0;
const RALLY_Z = -21;

interface DonaldState {
  wallCd: number;
  beamCd: number;
  rallyCd: number;
  tauntT: number;
  tauntI: number;
  plated: boolean;
  /** The first rally triggers early once the boss is below 75% HP. */
  rallied: boolean;
  rally: Bot[];
  glintT: number;
  podX: number;
  podZ: number;
  podPending: boolean;
}
const DSTATE = new WeakMap<Bot, DonaldState>();
function dstate(e: Bot): DonaldState {
  let s = DSTATE.get(e);
  if (!s) {
    s = { wallCd: 3.5, beamCd: 8, rallyCd: 20, tauntT: 2, tauntI: (Math.random() * 12) | 0, plated: false, rallied: false, rally: [], glintT: 0, podX: 0, podZ: 0, podPending: false };
    DSTATE.set(e, s);
  }
  return s;
}
/** THE DONALD's attack timers (headless probes force attacks through this; undefined before its first AI frame). */
export const donaldTimers = (e: Bot): Pick<DonaldState, 'wallCd' | 'beamCd' | 'rallyCd' | 'plated'> | undefined => DSTATE.get(e);

/** BUILD THE WALL: 1-2 lines in phase 1 (a corridor toward the boss, or a wall behind the plow), a U-box in phase 2. */
function donaldWalls(h: Host, e: Bot, s: DonaldState): void {
  let ux = h.px - e.position.x;
  let uz = h.pz - e.position.z;
  const ul = Math.hypot(ux, uz) || 1;
  ux /= ul;
  uz /= ul;
  const vx = uz;
  const vz = -ux;
  const lines: WallLine[] = [];
  // laid out around the plow (the arena walls stand in for any line that would fall outside)
  const m = 4;
  const cx = clamp(h.px, ARENA.minX + m, ARENA.maxX - m);
  const cz = clamp(h.pz, ARENA.minZ + m, ARENA.maxZ - m);
  // a wall parallel to boss -> plow, offset sideways by o (with the plow in the middle)
  const side = (o: number) => lines.push({ x: cx + vx * o - ux * 12, z: cz + vz * o - uz * 12, dx: ux, dz: uz, len: 22 });
  // a wall across, behind the plow (skipped when the plow already has an arena wall at its back)
  const back = () => {
    const bx = cx + ux * 5.5;
    const bz = cz + uz * 5.5;
    const mm = 1.5;
    if (bx < ARENA.minX + mm || bx > ARENA.maxX - mm || bz < ARENA.minZ + mm || bz > ARENA.maxZ - mm) return;
    lines.push({ x: bx - vx * 8.5, z: bz - vz * 8.5, dx: vx, dz: vz, len: 17 });
  };
  const n = s.plated ? 3 : Math.random() < 0.6 ? 2 : 1;
  if (n >= 2) {
    side(6.5);
    side(-6.5);
  }
  if (n !== 2) back();
  if (lines.length === 0) {
    side(6.5);
    side(-6.5);
  }
  const tele = s.plated ? 0.75 : 1.0;
  donaldProps.buildWalls(h, lines, tele, 9);
  e.set('wallWind', tele);
  s.wallCd = s.plated ? 8 : 13;
  h.label(e, 'BUILD THE WALL!', '#ffd24a', 1.25);
  h.sfx('charge', 0.7, 0.6, 0.15);
}

/** DEPORTATION: a tractor-beam ring just ahead of the plow (it fires itself after 1.2s; see donaldProps). */
function donaldBeam(h: Host, e: Bot, s: DonaldState): void {
  const plow = h.ctx.plow;
  const lead = clamp(plow.speed, -6, 12) * 0.35;
  const m = 4;
  const x = clamp(h.px + Math.sin(plow.heading) * lead, ARENA.minX + m, ARENA.maxX - m);
  const z = clamp(h.pz + Math.cos(plow.heading) * lead, ARENA.minZ + m, ARENA.maxZ - m);
  donaldProps.startBeam(h, x, z, s.plated ? 4.8 : 4.2, 1.2);
  e.set('beamWind', 1.2);
  s.beamCd = s.plated ? 7 : 9.5;
  h.label(e, 'DEPORTATION!', '#7fe3ff', 1.25);
}

/** RALLY: park, summon a ring of red-cap rally bots (buffed), raise the podium, take 60% less damage. */
function donaldRallyStart(h: Host, e: Bot, s: DonaldState): void {
  const ctx = h.ctx;
  const n = s.plated ? 6 : 4;
  // face down the red carpet (south) from the rally spot, else toward the arena centre
  const atSpot = Math.hypot(RALLY_X - e.position.x, RALLY_Z - e.position.z) < 4;
  const hd = atSpot ? 0 : Math.atan2(-e.position.x, -e.position.z);
  e.set('rally', 9);
  e.dmgTakenMult = 0.4;
  e.speed = 0;
  s.rally.length = 0;
  for (let i = 0; i < n; i++) {
    const a = hd + Math.PI / n + (i / n) * Math.PI * 2;
    const m = 2;
    const x = clamp(e.position.x + Math.sin(a) * 7, ARENA.minX + m, ARENA.maxX - m);
    const z = clamp(e.position.z + Math.cos(a) * 7, ARENA.minZ + m, ARENA.maxZ - m);
    const b = ctx.enemies.spawn('rallybot', x, z, { hpMult: ctx.zone.enemyHpMult, heading: a }) as Bot;
    b.spdMult = 1.3;
    b.dmgOutMult = 1.4;
    s.rally.push(b);
    _v.set(x, 1, z);
    for (const c of [0xc8102e, 0xffffff, 0x1f3b8c, 0xffd24a]) ctx.fx.burst(_v, { color: c, count: 8, speed: 7, size: 0.13, gravity: 9, life: 1.0 });
  }
  // the podium rises in front of the blade once the boss has turned to face the crowd (see 'rally')
  const f = e.rig.front + 1.9;
  s.podX = e.position.x + Math.sin(hd) * f;
  s.podZ = e.position.z + Math.cos(hd) * f;
  s.podPending = true;
  e.aimH = hd;
  h.label(e, 'WHAT A CROWD! RALLY!', '#ff4a5a', 1.3);
  h.sfx('roar', 0.9, 1.1, 0.2);
}

/** Ends the rally; `broken` = the player wrecked half the bots or the podium: the boss is stunned. */
function donaldRallyEnd(h: Host, e: Bot, s: DonaldState, broken: boolean): void {
  e.dmgTakenMult = 1;
  for (const b of s.rally) {
    b.spdMult = 1;
    b.dmgOutMult = 1;
  }
  s.rally.length = 0;
  s.podPending = false;
  donaldProps.dropPodium();
  s.rallyCd = s.plated ? 20 : 26;
  e.glow = 0;
  if (broken) {
    e.set('recover', 0.3);
    e.stun = 2.6;
    e.stunMult = 1.5;
    h.label(e, 'RALLY BROKEN!', '#ffe14a', 1.3);
    h.sfx('stun', 0.9, 0.9, 0.1);
  } else e.set('recover', 0.5);
}

/** Phase 2 at 50%: GOLD PLATED. Shinier gold hull, reflects 15% of damage, faster, more walls, taunts. */
function donaldPlate(h: Host, e: Bot, s: DonaldState): void {
  s.plated = true;
  e.enraged = true;
  e.reflect = 0.15;
  h.bossPhase(e, 'GOLD PLATED!');
  const gold = new THREE.Color(0xffd257);
  const rig = e.rig;
  for (let i = 0; i < rig.paint.length; i++) {
    rig.paintBase[i].lerp(gold, i === 0 ? 0.75 : 0.4);
    rig.paint[i].metalness = 0.4;
    rig.paint[i].roughness = 0.2;
  }
  s.wallCd = Math.min(s.wallCd, 1.5);
  s.tauntT = 1.5;
}

function donald(h: Host, e: Bot, dt: number): void {
  let s = DSTATE.get(e);
  if (!s) {
    s = dstate(e);
    // grand entrance: confetti cannons from the stage and both stands
    const fx = h.ctx.fx;
    const cols = [0xc8102e, 0xffffff, 0x1f3b8c, 0xffd24a];
    for (const [x, y, z] of [[-9, 6, -32], [9, 6, -32], [0, 9, -34], [-31, 5, -12], [31, 5, -12], [-31, 5, 12], [31, 5, 12]]) {
      for (const c of cols) fx.burst(_v.set(x, y, z), { color: c, count: 10, speed: 9, size: 0.14, gravity: 5, life: 1.8 });
    }
    h.label(e, 'THE DONALD HAS ARRIVED!', '#ffd24a', 1.3);
    h.sfx('roar', 0.8, 1.05, 0.2);
  }
  s.wallCd -= dt;
  s.beamCd -= dt;
  s.rallyCd -= dt;
  // a reset out of the rally state (plow died, etc.) must still drop the rally buffs
  if (e.state !== 'rally' && e.dmgTakenMult !== 1) donaldRallyEnd(h, e, s, false);
  const d = h.dist(e);
  if (!s.plated && e.hpFrac <= 0.5) donaldPlate(h, e, s);
  if (s.plated) {
    s.tauntT -= dt;
    if (s.tauntT <= 0) {
      s.tauntT = 6;
      h.label(e, DONALD_TAUNTS[s.tauntI++ % DONALD_TAUNTS.length], '#ffd24a', 1.05);
    }
    s.glintT -= dt;
    if (s.glintT <= 0) {
      s.glintT = 0.12;
      h.sparks(e, 0xfff2b0, 2);
    }
  }
  if (!s.rallied && e.hpFrac < 0.75) {
    s.rallied = true;
    s.rallyCd = Math.min(s.rallyCd, 0);
  }
  const spd = e.def.speed * (s.plated ? 1.25 : 1);
  const C: ChargeCfg = { speed: s.plated ? 19 : 17, maxT: 2.2, dmg: e.def.ramDamage * 1.3, knock: 22 };
  switch (e.state) {
    case 'chargeWind':
      chargeWind(h, e, C);
      break;
    case 'charge': {
      const r = charge(h, e, C);
      if (r === 'wall') {
        wallSlam(h, e, 2);
        e.set('recover', 0.4);
      } else if (r === 'done') e.set('recover', e.atkHits > 0 ? 1.5 : 0.9);
      break;
    }
    case 'shoveWind':
    case 'shove':
      shove(h, e, e.def.ramDamage, 16, 10);
      break;
    case 'wallWind':
      // stands and "builds": the gold stripes on the ground show where the walls will rise
      e.desSpeed = 0;
      face(e, h.px, h.pz);
      e.windup = e.prog * 0.6;
      e.glow = e.prog;
      if (e.stateT <= 0) {
        e.windup = 0;
        e.set('wallPause', s.plated ? 0.9 : 1.3);
      }
      break;
    case 'wallPause':
      // the walls are up: a beat to react (smash out!), then STEAMROLL down the corridor
      e.desSpeed = 0;
      face(e, h.px, h.pz);
      e.glow = Math.max(0, e.glow - dt);
      if (e.stateT <= 0) {
        e.chargesLeft = 1;
        beginChargeWind(h, e, 1.0);
      }
      break;
    case 'beamWind':
      e.desSpeed = 0;
      face(e, h.px, h.pz);
      e.windup = e.prog;
      e.glow = e.prog;
      e.jitter = 0.02 * e.prog;
      if (e.stateT <= 0) {
        e.windup = 0;
        e.jitter = 0;
        e.set('recover', 0.6);
      }
      break;
    case 'rallyGo':
      goTo(e, RALLY_X, RALLY_Z, spd * 1.6, 3);
      e.turnRate = 2.2;
      if (Math.hypot(RALLY_X - e.position.x, RALLY_Z - e.position.z) < 2.2 || e.stateT <= 0) donaldRallyStart(h, e, s);
      break;
    case 'rally': {
      e.desSpeed = 0;
      e.desHeading = e.aimH;
      e.turnRate = 3;
      e.glow = 0.4 + 0.3 * Math.sin(h.time * 6);
      if (s.podPending && (Math.abs(Math.atan2(Math.sin(e.heading - e.aimH), Math.cos(e.heading - e.aimH))) < 0.2 || e.prog > 0.12)) {
        s.podPending = false;
        e.heading = e.aimH;
        donaldProps.raisePodium(h, s.podX, s.podZ, e.aimH + Math.PI);
      }
      let alive = 0;
      for (const b of s.rally) if (b.alive) alive++;
      const wrecked = s.rally.length - alive;
      if (donaldProps.podiumBroken || wrecked >= Math.ceil(s.rally.length / 2)) {
        donaldProps.podiumBroken = false;
        donaldRallyEnd(h, e, s, true);
      } else if (e.stateT <= 0) {
        h.label(e, 'WHAT A RALLY. THE BEST.', '#ffd24a', 1.1);
        donaldRallyEnd(h, e, s, false);
      }
      break;
    }
    case 'recover':
      if (recover(e, dt)) {
        e.set('approach', 0);
        e.cd = (1.0 + Math.random() * 0.8) * (s.plated ? 0.7 : 1);
      }
      break;
    default:
      goTo(e, h.px, h.pz, spd, 3);
      e.turnRate = 1.3 * (s.plated ? 1.25 : 1);
      if (e.cd <= 0) {
        if (s.rallyCd <= 0) {
          e.set('rallyGo', 8);
          h.label(e, 'RALLY TIME!', '#ff4a5a', 1.1);
        } else if (s.wallCd <= 0 && !donaldProps.wallsUp) donaldWalls(h, e, s);
        else if (s.beamCd <= 0 && !donaldProps.beamActive) donaldBeam(h, e, s);
        else if (d < e.radius + h.pr + 1.6) {
          e.set('shoveWind', 0.6);
          h.sfx('charge', 0.45, 0.6, 0.2);
        } else if (d > 11) {
          e.chargesLeft = 1;
          beginChargeWind(h, e, 1.0);
        } else e.cd = 0.4;
      }
  }
}

export const BOSS_AI: Partial<Record<EnemyType, (h: Host, e: Bot, dt: number) => void>> = {
  bulldoza,
  frostbyte,
  grinder,
  slush,
  sleet,
  omega,
  donald,
};
