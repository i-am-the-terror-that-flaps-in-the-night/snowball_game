import { ARENA } from '../../core/types';
import {
  GUNNER_AIM, GUNNER_BOLT_RANGE, GUNNER_COOLDOWN, GUNNER_COOLDOWN_RAND, GUNNER_PANIC, GUNNER_RANGE_MAX, GUNNER_RANGE_MIN,
  type EnemyType,
} from '../../config/enemies';
import { GUNNER_MUZZLE_Y } from './models';
import { Bot, Vuln, type Host } from './Bot';

/* Minion AI + shared steering helpers. Each AI function runs once per frame per bot (unless the bot is
 * wall-stunned / staggered) and only sets desired heading/speed + state; the manager integrates motion,
 * resolves contact damage (attack windows) and renders. */

const PI = Math.PI;
const TAU = PI * 2;

export const wrap = (a: number): number => {
  while (a > PI) a -= TAU;
  while (a < -PI) a += TAU;
  return a;
};
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export function face(e: Bot, x: number, z: number): void {
  const dx = x - e.position.x;
  const dz = z - e.position.z;
  if (dx * dx + dz * dz > 1e-4) e.desHeading = Math.atan2(dx, dz);
}

/** Steer toward (x, z) at `speed`, easing off within `slowR` of the target. */
export function goTo(e: Bot, x: number, z: number, speed: number, slowR = 2): void {
  const m = e.radius + 0.6;
  x = clamp(x, ARENA.minX + m, ARENA.maxX - m);
  z = clamp(z, ARENA.minZ + m, ARENA.maxZ - m);
  const dx = x - e.position.x;
  const dz = z - e.position.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > 0.05) e.desHeading = Math.atan2(dx, dz);
  // vehicles slow down for sharp turns
  const turn = Math.abs(wrap(e.desHeading - e.heading));
  const turnK = turn > 1.6 ? 0.35 : turn > 0.8 ? 0.7 : 1;
  e.desSpeed = speed * clamp(d / slowR, 0, 1) * turnK;
}

/** Angle of the bot around the plow (heading convention). */
export const aroundAngle = (h: Host, e: Bot): number => Math.atan2(e.position.x - h.px, e.position.z - h.pz);

/** Circle/strafe the plow at radius R. */
export function orbit(h: Host, e: Bot, R: number, speed: number, dt: number): void {
  e.orbitA = wrap(e.orbitA + e.orbitDir * ((speed * 0.55) / R) * dt);
  let tx = h.px + Math.sin(e.orbitA) * R;
  let tz = h.pz + Math.cos(e.orbitA) * R;
  const m = e.radius + 1.2;
  const cx = clamp(tx, ARENA.minX + m, ARENA.maxX - m);
  const cz = clamp(tz, ARENA.minZ + m, ARENA.maxZ - m);
  if ((Math.abs(cx - tx) > 2 || Math.abs(cz - tz) > 2) && e.retargetT <= 0) {
    e.orbitDir = -e.orbitDir;
    e.retargetT = 2.5;
  }
  tx = cx;
  tz = cz;
  goTo(e, tx, tz, speed, 2.5);
}

export const facingErr = (h: Host, e: Bot): number => Math.abs(wrap(Math.atan2(h.ux, h.uz) - e.heading));

/* ------------------------------------------------------------------ setup */

const TUNE: Record<EnemyType, [turn: number, accel: number]> = {
  scrapper: [4.5, 16],
  brute: [1.2, 8],
  spinner: [3.2, 12],
  thief: [6.5, 24],
  bulldoza: [1.5, 9],
  frostbyte: [2.3, 12],
  grinder: [1.1, 7],
  slush: [2.4, 13],
  sleet: [2.6, 13],
  omega: [1.1, 8],
  rallybot: [4.5, 16],
  donald: [1.3, 9],
  rival: [3, 14], // Brawl-only; never spawned by the campaign manager
  gunner: [4, 14],
  // Slower to turn than the Brute Dozer: a plow running rings round it stays off its shield.
  bulwark: [1.0, 7],
  slushpile: [3, 11],
  slushling: [5, 18],
};

const DEFAULT_STATE: Record<EnemyType, string> = {
  scrapper: 'circle',
  brute: 'advance',
  spinner: 'approach',
  thief: 'stalk',
  bulldoza: 'approach',
  frostbyte: 'hunt',
  grinder: 'approach',
  slush: 'lineup',
  sleet: 'pin',
  omega: 'approach',
  rallybot: 'circle',
  donald: 'approach',
  rival: 'approach',
  gunner: 'kite',
  bulwark: 'guard',
  slushpile: 'circle',
  slushling: 'circle',
};

export function initAI(e: Bot): void {
  const [t, a] = TUNE[e.type];
  e.baseTurn = e.turnRate = t;
  e.baseAccel = e.accel = a;
  e.set(DEFAULT_STATE[e.type], e.type === 'spinner' ? 3 : 0);
  e.cd = e.isBoss ? 1.5 : 0.6 + Math.random() * 1.2;
  e.orbitR =
    e.type === 'scrapper' || e.type === 'rallybot' || e.type === 'slushling'
      ? 5.4 + (e.id % 3) * 0.8
      : e.type === 'gunner'
        ? GUNNER_RANGE_MIN + 0.5 + (e.id % 3) * ((GUNNER_RANGE_MAX - GUNNER_RANGE_MIN - 1) / 2)
        : e.type === 'slushpile'
          ? 4.6
          : 6;
}

/** Cancel whatever the bot was doing (stagger / plow died): drop attack, telegraphs, tokens. */
export function resetAI(h: Host, e: Bot): void {
  e.endAtk();
  h.clearTele(e);
  h.releaseToken(e);
  e.windup = 0;
  e.glow = 0;
  e.jitter = 0;
  e.rear = 0;
  if (e.isBoss) {
    if (e.state !== 'approach' && e.state !== 'hunt' && e.state !== 'lineup' && e.state !== 'pin') e.set('recover', 0.5);
  } else {
    e.set(DEFAULT_STATE[e.type], e.type === 'spinner' ? 2 : 0);
    if (e.vuln !== Vuln.None) {
      e.vuln = Vuln.None;
      e.vulnT = 0;
    }
    e.cd = Math.max(e.cd, 1.2 + Math.random());
  }
}

/* ------------------------------------------------------------------ minions */

function scrapper(h: Host, e: Bot, dt: number): void {
  const d = h.dist(e);
  switch (e.state) {
    case 'windup':
      face(e, h.px, h.pz);
      e.turnRate = 7;
      e.desSpeed = -2.4;
      e.windup = e.prog;
      if (e.stateT <= 0) {
        e.set('ram', 0.95);
        e.startAtk(e.def.ramDamage, 9);
        e.speed = Math.max(e.speed, 4);
        e.windup = 0;
      }
      break;
    case 'ram':
      face(e, h.px, h.pz);
      e.turnRate = 1.6;
      e.desSpeed = 14;
      e.accel = 45;
      if (e.atkHits > 0 || e.stateT <= 0) {
        e.endAtk();
        e.set('retreat', 1.1);
      }
      break;
    case 'retreat':
      goTo(e, e.position.x - h.ux * 8, e.position.z - h.uz * 8, e.def.speed, 1);
      if (e.stateT <= 0) {
        h.releaseToken(e);
        e.cd = 2.2 + Math.random() * 2;
        e.orbitA = aroundAngle(h, e);
        e.set('circle', 0);
      }
      break;
    default:
      orbit(h, e, e.orbitR, e.def.speed, dt);
      if (e.cd <= 0 && d < 12 && h.tryToken(e)) {
        e.set('windup', 0.4);
        h.sfx('charge', 0.16, 1.8, 0.12);
      }
  }
}

function brute(h: Host, e: Bot): void {
  const d = h.dist(e);
  const reach = e.radius + h.pr + 0.9;
  switch (e.state) {
    case 'press':
      face(e, h.px, h.pz);
      e.desSpeed = e.def.speed * 1.1;
      if (d < reach && facingErr(h, e) < 0.45) {
        e.set('shoveWind', 0.7);
        h.sfx('charge', 0.35, 0.75, 0.2);
      } else if (e.stateT <= 0) {
        h.releaseToken(e);
        e.cd = 1.5;
        e.set('advance', 0);
      }
      break;
    case 'shoveWind':
      face(e, h.px, h.pz);
      e.desSpeed = -1.0;
      e.windup = e.prog;
      e.glow = e.prog;
      if (e.stateT <= 0) {
        e.set('shove', 0.35);
        e.startAtk(e.def.ramDamage, 16);
        e.speed = 2;
      }
      break;
    case 'shove':
      e.desSpeed = 10;
      e.accel = 45;
      e.turnRate = 0.5;
      e.windup = 0;
      if (e.atkHits > 0 || e.stateT <= 0) {
        e.endAtk();
        e.set('recover', 0.8);
      }
      break;
    case 'recover':
      e.desSpeed = 0;
      e.glow = Math.max(0, e.glow - 0.05);
      if (e.stateT <= 0) {
        h.releaseToken(e);
        e.cd = 2.5 + Math.random() * 1.2;
        e.set('advance', 0);
      }
      break;
    default: {
      // slowly turn to face the plow and push in; hold at ~5.5m without an attack token
      face(e, h.px, h.pz);
      const hold = 5.6;
      e.desSpeed = d > hold + 0.5 ? e.def.speed : d < hold - 0.8 ? -1.2 : 0;
      if (facingErr(h, e) > 1.2) e.desSpeed *= 0.3;
      if (e.cd <= 0 && d < 14 && h.tryToken(e)) e.set('press', 3.5);
    }
  }
}

function spinner(h: Host, e: Bot, dt: number): void {
  switch (e.state) {
    case 'spinup':
      e.desSpeed = 0;
      e.windup = e.prog;
      e.sawRate = 5 + 30 * e.prog;
      e.spinRate = 14 * e.prog;
      e.glow = e.prog * 0.6;
      if (e.sparkT <= 0) {
        e.sparkT = 0.07;
        h.sparks(e, 0xffb040, 3);
      }
      if (e.stateT <= 0) {
        e.set('spin', 2.5);
        e.startAtk(e.def.ramDamage, 11, true, 0.35);
        h.sfx('whirl', 0.4, 1.35, 0.1);
        e.windup = 0;
      }
      break;
    case 'spin':
      face(e, h.px, h.pz);
      e.turnRate = 7;
      e.desSpeed = 6;
      e.accel = 20;
      e.spinRate = 16;
      e.sawRate = 34;
      e.glow = 0.6;
      if (e.sparkT <= 0) {
        e.sparkT = 0.12;
        h.sparks(e, 0xffc060, 2);
      }
      if (e.stateT <= 0) {
        e.endAtk();
        h.releaseToken(e);
        e.vuln = Vuln.Overheat;
        e.vulnT = 2;
        e.vulnMult = 1.6;
        e.set('overheat', 2);
        h.label(e, 'OVERHEATED!', '#ff7a3a', 0.8);
        h.sfx('stun', 0.35, 1.4, 0.1);
      }
      break;
    case 'overheat':
      e.desSpeed = 0;
      e.spinRate *= Math.exp(-3 * dt);
      e.sawRate = Math.max(1, e.sawRate * Math.exp(-2 * dt));
      e.glow = 0;
      if (e.stateT <= 0) {
        e.cd = 0;
        e.set('approach', 3);
      }
      break;
    default:
      orbit(h, e, 5.5, e.def.speed, dt);
      e.sawRate = 4;
      e.glow = Math.max(0, e.glow - dt);
      if (e.stateT <= 0) {
        if (h.dist(e) < 12 && h.tryToken(e)) {
          e.set('spinup', 0.6);
          h.sfx('charge', 0.3, 1.5, 0.15);
        } else e.stateT = 0.4;
      }
  }
}

const FLEE_PTS: number[] = [];
{
  const m = 3.5;
  const xs = [ARENA.minX + m, 0, ARENA.maxX - m];
  const zs = [ARENA.minZ + m, 0, ARENA.maxZ - m];
  for (const x of xs) for (const z of zs) if (x !== 0 || z !== 0) FLEE_PTS.push(x, z);
}

function thief(h: Host, e: Bot, dt: number): void {
  const d = h.dist(e);
  if (e.stole && e.carry > 0.05 && e.state !== 'flee') {
    e.endAtk();
    h.releaseToken(e);
    e.set('flee', 0);
    e.retargetT = 0;
  }
  switch (e.state) {
    case 'flee': {
      // run to the far side of the arena, re-plan as the plow chases
      if (e.retargetT <= 0) {
        e.retargetT = 0.6;
        let best = -1e9;
        for (let i = 0; i < FLEE_PTS.length; i += 2) {
          const fx = FLEE_PTS[i];
          const fz = FLEE_PTS[i + 1];
          const s = Math.hypot(fx - h.px, fz - h.pz) - 0.45 * Math.hypot(fx - e.position.x, fz - e.position.z);
          if (s > best) {
            best = s;
            e.tx = fx;
            e.tz = fz;
          }
        }
      }
      goTo(e, e.tx, e.tz, e.def.speed * (d < 10 ? 1.05 : 0.8), 2);
      break;
    }
    case 'dartWind':
      face(e, h.px, h.pz);
      e.turnRate = 9;
      e.desSpeed = -1;
      e.windup = e.prog;
      if (e.stateT <= 0) {
        e.set('dart', 1.4);
        e.startAtk(e.def.ramDamage, 3, false, 0, 0.5);
        e.windup = 0;
      }
      break;
    case 'dart':
      face(e, h.px, h.pz);
      e.turnRate = 6;
      e.desSpeed = 13;
      e.accel = 40;
      if (e.atkHits > 0 || e.stateT <= 0 || h.plowBall < 0.3) {
        e.endAtk();
        h.releaseToken(e);
        e.cd = 2.5 + Math.random();
        if (!(e.stole && e.carry > 0.05)) e.set('stalk', 0);
      }
      break;
    default:
      if (h.plowBall > 0.3) {
        orbit(h, e, 7, e.def.speed * 0.8, dt);
        if (e.cd <= 0 && d < 15 && h.tryThiefToken(e)) {
          e.set('dartWind', 0.35);
          h.sfx('steal', 0.18, 1.7, 0.2);
        }
      } else {
        // no ball to steal: vacuum the ground snow around the plow to deny ammo
        orbit(h, e, 4.8, e.def.speed * 0.55, dt);
        const snow = h.ctx.snow;
        if (snow) {
          const nx = e.position.x + Math.sin(e.heading) * 1.1;
          const nz = e.position.z + Math.cos(e.heading) * 1.1;
          const vol = snow.collectDisc(nx, nz, 1.3, Math.min(1, 1.8 * dt));
          e.carry = Math.min(8, e.carry + vol * 0.6);
          if (vol > 0.002 && e.sparkT <= 0) {
            e.sparkT = 0.22;
            h.fxAt(nx, 0.5, nz, 0xffffff, 3, 1.5, 0.14, -2, 0.35);
          }
        }
      }
  }
}

/** Flurry Gunner: strafes the plow at its standoff ring (orbitR, GUNNER_RANGE_MIN..MAX), backs away when the plow closes
 *  inside GUNNER_PANIC (it can't shoot then), and between shots AIMS (GUNNER_AIM: stops, barrel glow, a ground stripe
 *  along the line) and fires one slow snowball bolt at where the plow is (Host.shoot; no lead, so moving dodges it). */
function gunner(h: Host, e: Bot, dt: number): void {
  const d = h.dist(e);
  switch (e.state) {
    case 'aim': {
      face(e, h.px, h.pz);
      e.turnRate = 5;
      e.desSpeed = 0;
      e.windup = e.prog;
      e.glow = e.prog;
      const fx = Math.sin(e.heading);
      const fz = Math.cos(e.heading);
      const x0 = e.position.x + fx * e.rig.front;
      const z0 = e.position.z + fz * e.rig.front;
      h.stripe(e, x0, z0, fx, fz, Math.min(d, GUNNER_BOLT_RANGE), 0.8, 0x7fe6ff, 0.15 + 0.4 * e.prog);
      if (d < GUNNER_PANIC) {
        // the plow got in close: abort and run
        h.clearTele(e);
        h.releaseToken(e);
        e.windup = 0;
        e.cd = 0.8;
        e.set('kite', 0);
      } else if (e.stateT <= 0) {
        h.clearTele(e);
        h.shoot(e, x0, e.groundY + GUNNER_MUZZLE_Y, z0, h.ux, h.uz);
        h.sfx('burst', 0.4, 1.7, 0.08);
        h.fxAt(x0, e.groundY + GUNNER_MUZZLE_Y, z0, 0xdff8ff, 8, 4, 0.12, 4, 0.3);
        // recoil kick
        e.kvx -= fx * 3;
        e.kvz -= fz * 3;
        e.windup = 0;
        h.releaseToken(e);
        e.cd = GUNNER_COOLDOWN + Math.random() * GUNNER_COOLDOWN_RAND;
        e.set('recoil', 0.35);
      }
      break;
    }
    case 'recoil':
      e.desSpeed = -1.5;
      e.glow = Math.max(0, e.glow - dt * 4);
      if (e.stateT <= 0) e.set('kite', 0);
      break;
    default:
      e.glow = Math.max(0, e.glow - dt * 4);
      if (d < GUNNER_PANIC) {
        // turn tail and drive straight away (slower than a plow: chase it down)
        goTo(e, e.position.x - h.ux * 8, e.position.z - h.uz * 8, e.def.speed * 0.85, 1);
        e.orbitA = aroundAngle(h, e);
      } else {
        // strafe the standoff ring; now and then switch direction so it doesn't circle like clockwork
        if (e.cd2 <= 0) {
          e.cd2 = 2.5 + Math.random() * 3;
          if (Math.random() < 0.45) e.orbitDir = -e.orbitDir;
        }
        orbit(h, e, e.orbitR, e.def.speed, dt);
        if (e.cd <= 0 && d < GUNNER_RANGE_MAX + 4 && h.tryVolley(e)) {
          e.set('aim', GUNNER_AIM);
          h.sfx('charge', 0.2, 2.2, 0.15);
        }
      }
  }
}

/** Bulwark: keeps its plow-shield on the plow (slow turn, TUNE) and grinds forward; in reach and facing the plow it
 *  SHIELD BASHES (0.75 s wind-up, the shield's edge glows) for ramDamage and a big shove. Its BLOCK flash (Enemies.damage
 *  sets glow = 1) fades here. */
function bulwark(h: Host, e: Bot, dt: number): void {
  const d = h.dist(e);
  const reach = e.radius + h.pr + 1.1;
  if (e.state !== 'bashWind') e.glow = Math.max(0, e.glow - dt * 3);
  switch (e.state) {
    case 'bashWind':
      face(e, h.px, h.pz);
      e.turnRate = 1.6;
      e.desSpeed = -0.8;
      e.windup = e.prog;
      e.glow = Math.max(e.glow, e.prog);
      if (e.stateT <= 0) {
        e.set('bash', 0.4);
        e.startAtk(e.def.ramDamage, 20);
        e.speed = 3;
        e.windup = 0;
      }
      break;
    case 'bash':
      e.desSpeed = 11;
      e.accel = 40;
      e.turnRate = 0.4;
      if (e.atkHits > 0 || e.stateT <= 0) {
        e.endAtk();
        e.set('recover', 0.9);
      }
      break;
    case 'recover':
      e.desSpeed = 0;
      if (e.stateT <= 0) {
        h.releaseToken(e);
        e.cd = 2.2 + Math.random() * 1.2;
        e.set('guard', 0);
      }
      break;
    default: {
      face(e, h.px, h.pz);
      e.desSpeed = d > reach + 0.4 ? e.def.speed : d < reach - 0.6 ? -0.8 : 0;
      // turning in place: a plow on its flank gets a moment before the shield comes round
      if (facingErr(h, e) > 0.9) e.desSpeed *= 0.25;
      if (e.cd <= 0 && d < reach + 0.8 && facingErr(h, e) < 0.4 && h.tryToken(e)) {
        e.set('bashWind', 0.75);
        h.sfx('charge', 0.3, 0.65, 0.2);
      }
    }
  }
}

/** Slushpile: circles in close and does a short belly-flop ram (0.5 s wind-up), then backs off. The split on death is
 *  the manager's (Enemies.kill). */
function slushpile(h: Host, e: Bot, dt: number): void {
  const d = h.dist(e);
  switch (e.state) {
    case 'windup':
      face(e, h.px, h.pz);
      e.turnRate = 5;
      e.desSpeed = -1.2;
      e.windup = e.prog;
      if (e.stateT <= 0) {
        e.set('ram', 0.7);
        e.startAtk(e.def.ramDamage, 8);
        e.speed = Math.max(e.speed, 3);
        e.windup = 0;
      }
      break;
    case 'ram':
      face(e, h.px, h.pz);
      e.turnRate = 1.4;
      e.desSpeed = 10;
      e.accel = 30;
      if (e.atkHits > 0 || e.stateT <= 0) {
        e.endAtk();
        e.set('retreat', 0.8);
      }
      break;
    case 'retreat':
      goTo(e, e.position.x - h.ux * 6, e.position.z - h.uz * 6, e.def.speed, 1);
      if (e.stateT <= 0) {
        h.releaseToken(e);
        e.cd = 2.5 + Math.random() * 1.5;
        e.orbitA = aroundAngle(h, e);
        e.set('circle', 0);
      }
      break;
    default:
      orbit(h, e, e.orbitR, e.def.speed, dt);
      if (e.cd <= 0 && d < 9 && h.tryToken(e)) {
        e.set('windup', 0.5);
        h.sfx('charge', 0.2, 1.1, 0.15);
      }
  }
}

export const MINION_AI: Partial<Record<EnemyType, (h: Host, e: Bot, dt: number) => void>> = {
  scrapper,
  brute,
  spinner,
  thief,
  rallybot: scrapper,
  gunner,
  bulwark,
  slushpile,
  slushling: scrapper,
};
