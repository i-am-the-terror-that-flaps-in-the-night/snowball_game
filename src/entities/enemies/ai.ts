import { ARENA } from '../../core/types';
import type { EnemyType } from '../../config/enemies';
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
  rival: [3, 14], // Brawl-only; never spawned by the campaign manager
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
  rival: 'approach',
};

export function initAI(e: Bot): void {
  const [t, a] = TUNE[e.type];
  e.baseTurn = e.turnRate = t;
  e.baseAccel = e.accel = a;
  e.set(DEFAULT_STATE[e.type], e.type === 'spinner' ? 3 : 0);
  e.cd = e.isBoss ? 1.5 : 0.6 + Math.random() * 1.2;
  e.orbitR = e.type === 'scrapper' ? 5.4 + (e.id % 3) * 0.8 : 6;
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

export const MINION_AI: Partial<Record<EnemyType, (h: Host, e: Bot, dt: number) => void>> = {
  scrapper,
  brute,
  spinner,
  thief,
};
