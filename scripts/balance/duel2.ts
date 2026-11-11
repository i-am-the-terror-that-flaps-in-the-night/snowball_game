/* Two-way Duel sim (`npm run duel2`): both plows fight back at once, through the real Duel damage path.
 *
 * Each side is a sim pilot (scripts/balance/sim.ts: fake plow + the real Combat + the full Rotation, ultimate used
 * when full) whose "enemy manager" is an OpponentTarget over the OTHER plow, exactly as in the online Duel. Every hit
 * therefore goes through the victim's real Combat.hitPlow: ball shield (the Classic's ball is tracked by its Rotation),
 * dash halving, whirl 30%, armour, Iron Hide (fed the plow's current speed), Battery Shield, Last Stand, Second Wind,
 * i-frames, the Duel scales / hit cap / ability burst damping. Nothing in the game is changed or re-tuned here.
 *
 * MOVEMENT MODEL ('move'). The fake plows do not drive, so positioning is modelled on one line (the axis between the
 * two Duel spawns, starting DUEL_SPAWNS apart = 50 m, walls at DUEL_ARENA_HALF = 60):
 *  - Preferred range: each plow wants the centre distance where its main weapon works best, read from the real kit
 *    numbers (preferredRange below): Classic = where its slam lands (TIP_Z + ball + 0.5), BRUTUS = its fist zone
 *    (FIST_REACH x fistSize + Piston Fists reach), VOLT-9 / ISOTOPE = REACH_MARGIN of arcRange / sprayRange (+ line
 *    reach), ARSENAL = REACH_MARGIN of the Mag Discs' reach (tankGunRange: the discs hit a target there both ways).
 *  - Closing: every tick each plow moves toward its preferred range at MANEUVER x its real maxSpeed (backing off,
 *    still facing the enemy, at REVERSE of that), holding within HOLD m of it. When both pull opposite ways the
 *    faster plow wins the tug and the fight settles near ITS preferred range. Plows cannot overlap (CONTACT), and a
 *    kiter backed into a wall stops there. Knockback (Combat.hitPlow's plow.push) shoves along the line and decays
 *    like Plow's pushVel; hit-stop freezes a plow's movement.
 *  - Dash (the plow's real dash: DASH_SECONDS of plow.dashing = the 50% hitPlow reduction, the first DASH_IFRAMES s
 *    of it invulnerable as Plow.invulnerable, recharged on the real dashCooldown via the Rotation): while it is ready and the enemy can reach it, a plow DODGES with a per-tick
 *    chance (DODGE_RATE /s): a sidestep dash that also throws both plows' aim off for its length. Otherwise a plow
 *    whose preferred range is within dash reach DASH STRIKES when the enemy is in dash reach (it dashes in and the
 *    real dash strike lands on contact).
 *  - Jukes: a per-tick chance (JUKE_RATE /s) that a plow slips out of the enemy's forward cone: the enemy's heading is
 *    off by JUKE_ANGLE (past every forward cone: disc homing, arc lock, flame, spray, fists, ball shield) until it turns
 *    back at its real turnRate. Radius attacks (whirl, auras, fields, pools, ultimates) still land.
 *  - Both pilots open fire after a seeded reaction delay (0..REACTION s) and who acts first alternates every tick from a
 *    seeded coin flip, so mirrors do not replay one fixed script.
 *  Everything random uses a seeded RNG (and Math.random, which some kits roll, is seeded per fight).
 *
 * STAND AND TRADE ('stand'): both parked facing each other at a fixed centre distance (3 m / 6 m), no movement, no
 * dodges or jukes (the reaction delay and first-mover coin flip still apply); dashes are spent as dash strikes whenever the enemy is in dash reach.
 *
 * Known gaps (honest limits): no terrain, snow or props; BRUTUS's Saw Charge and the slam lunge do not move the plow;
 * no strafing geometry beyond the juke; pilots never hold an ability back for a better moment. The Classic's ball (its
 * frontal shield) refills at sim.ts MELEE.SNOW_INTAKE even while it stands still, and the held ball does not slow it.
 * Ultimate meters start empty in every fight here (in a match they carry over from round to round), so the in-round
 * matrices see few ultimates; the per-tier ultimates table measures the fill in continuous fighting (renderUlts). */
import * as THREE from 'three';
import { DUEL_ARENA_HALF, ballRadius, type EnemyHandle, type EnemyManagerAPI } from '../../src/core/types';
import { DUEL_DRAW_EPS, DUEL_ROUND_SECONDS, DUEL_SPAWNS } from '../../src/config/duel';
import { DASH_IFRAMES, DASH_SECONDS, TIP_Z } from '../../src/entities/plow/constants';
import { arcRange } from '../../src/entities/combat/volt';
import { sprayRange } from '../../src/entities/combat/isotope';
import { tankGunRange } from '../../src/entities/combat/arsenal';
import { FIST_REACH, fistSize } from '../../src/entities/combat/brute';
import { OpponentTarget, PlowHandle } from '../../src/duel/opponent';
import type { Plow } from '../../src/entities/Plow';
import type { PlowKind } from '../../src/config/plows';
import type { PlayerStats } from '../../src/core/types';
import { DT, KINDS, MELEE, Rotation, TIERS, fakePlow, newCtx, pilot, statsFor, type FakePlow, type Pilot, type Tier } from './sim';

/** Share of a ranged weapon's full reach a pilot sits at (a margin so the target stays inside it). */
export const REACH_MARGIN = 0.75;
/** Share of maxSpeed while fighting (turning, aiming); backing off runs at REVERSE of that. */
export const MANEUVER = 0.6;
export const REVERSE = 0.5;
/** Hold position within this many m of the preferred range. */
export const HOLD = 0.75;
/** Dodge-dash hazard (per s) while the dash is ready and the enemy can reach this plow. */
export const DODGE_RATE = 0.35;
/** Juke hazard (per s) and how far off the enemy's aim is thrown (rad). */
export const JUKE_RATE = 0.2;
export const JUKE_ANGLE = 1.4;
/** Each pilot opens fire after a seeded reaction delay of up to this many s (both modes). */
export const REACTION = 0.4;
/** Fake plow hull radius (sim.ts fakePlow): hulls touch at twice that. */
const HULL = 1.6;
const CONTACT = 2 * HULL;
const START = Math.abs(DUEL_SPAWNS[0].z - DUEL_SPAWNS[1].z);
const WALL = DUEL_ARENA_HALF - 3;
/** Plow.pushVel decay rate (PlowMotion: pushVel *= exp(-5 dt)). */
const PUSH_DECAY = 5;
/** Fight cap (s): a real Duel round. At the time-out the higher HP% wins (a draw within DUEL_DRAW_EPS), as in the game. */
export const CAP = DUEL_ROUND_SECONDS;
/** Closing speed handed to a dash strike / ram (as sim.ts Rotation). */
const RAM_SPEED = 15;

/** Centre distance (m) a plow wants to fight at, from its real weapon reach (see the block comment). */
export function preferredRange(st: PlayerStats): number {
  const ball = st.maxBallRadius;
  switch (st.plowKind) {
    case 'classic':
      return TIP_Z + ball * MELEE.SLAM_BALL + 0.5;
    case 'brute':
      return HULL + (FIST_REACH * fistSize(st) + (st.fistReach || 0)) * 0.5;
    case 'volt':
      return arcRange(ball) * REACH_MARGIN;
    case 'isotope':
      return (sprayRange(ball) + (st.sprayReach || 0)) * REACH_MARGIN;
    case 'arsenal':
      return Math.max(CONTACT, tankGunRange(st) * REACH_MARGIN);
  }
}

/** Dash distance (m): the dash's launch speed (Plow.tryDash) over DASH_SECONDS. */
const dashSpeed = (st: PlayerStats) => st.maxSpeed * 0.5 + st.dashPower;
const dashReach = (st: PlayerStats) => dashSpeed(st) * DASH_SECONDS;

/** Small seeded RNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Mode = 'move' | 'stand';
export interface FightOpts {
  mode: Mode;
  /** 'stand': centre distance (m). */
  dist?: number;
  seed: number;
  /** Fight cap (s); at the time-out the higher HP% wins. */
  cap?: number;
  /** Keep fighting through wrecks (continuous fighting, as across the rounds of a match: the meters carry over):
   *  a wrecked plow is revived at full HP where it stands and the fight runs to `cap`. For ultimate fill times. */
  continuous?: boolean;
}
export interface FightResult {
  /** 0 / 1 = that side won (wreck, or more HP% at the time-out), -1 = draw (both wrecked on the same tick, or HP% level
   *  within DUEL_DRAW_EPS at the time-out). */
  winner: -1 | 0 | 1;
  /** The fight went the full round (CAP). */
  timeout?: boolean;
  t: number;
  /** HP left as a share of max HP, per side. */
  hp: [number, number];
  /** Times (s) each side's ultimate went off. */
  ults: [number[], number[]];
  /** 'continuous': wrecks per side. */
  wrecks: [number, number];
}

interface Side {
  kind: PlowKind;
  st: PlayerStats;
  plow: FakePlow;
  p: Pilot;
  rot: Rotation;
  handle: PlowHandle;
  pref: number;
  /** Position along the line, and +1 / -1: the direction of the enemy. */
  z: number;
  sgn: number;
  /** Knockback speed along the line (m/s, + = away from the enemy). */
  push: number;
  stopT: number;
  dashT: number;
  dashMode: 'strike' | 'dodge';
  struck: boolean;
  /** This plow's aim is thrown off for aimT s, to this side. */
  aimT: number;
  aimSign: number;
}

export function fight(ka: PlowKind, kb: PlowKind, tier: Tier, opts: FightOpts): FightResult {
  const move = opts.mode === 'move';
  const cap = opts.cap ?? CAP;
  const R = rng(opts.seed);
  // Kits that roll Math.random (storm strikes, paralysis, ...): seeded per fight.
  let ms = (opts.seed * 2654435761) >>> 0;
  const mathRandom = Math.random;
  Math.random = () => (ms = (ms * 1664525 + 1013904223) >>> 0) / 4294967296;
  try {
    const ctx = newCtx();
    const d0 = move ? START : (opts.dist ?? 3);
    const sides: Side[] = [];
    const targets: OpponentTarget[] = [];
    const kinds = [ka, kb];
    for (let i = 0; i < 2; i++) {
      const st = statsFor(kinds[i], tier);
      const z = i === 0 ? -d0 / 2 : d0 / 2;
      const plow = fakePlow(st, 0, z, i === 0 ? 0 : Math.PI);
      sides.push({ kind: kinds[i], st, plow, p: null as unknown as Pilot, rot: null as unknown as Rotation, handle: new PlowHandle(i + 1, plow as unknown as Plow), pref: preferredRange(st), z, sgn: i === 0 ? 1 : -1, push: 0, stopT: 0, dashT: 0, dashMode: 'strike', struck: false, aimT: 0, aimSign: 1 });
    }
    for (let i = 0; i < 2; i++) {
      const me = sides[i];
      const foe = sides[1 - i];
      const t = new OpponentTarget(foe.handle, () => foe.p.c, () => me.st, () => me.plow as unknown as Plow, () => foe.st);
      t.enabled = true;
      targets.push(t);
      me.p = pilot(ctx, me.st, me.plow, t as EnemyManagerAPI, true);
    }
    const dist = () => sides[1].z - sides[0].z;
    const ults: [number[], number[]] = [sides[0].p.ults, sides[1].p.ults];
    const wrecks: [number, number] = [0, 0];
    for (let i = 0; i < 2; i++) {
      const me = sides[i];
      const foe = sides[1 - i];
      const plow = me.plow;
      if (move) {
        plow.push = (_vx: number, vz: number) => {
          me.push += -vz * me.sgn;
        };
        plow.hitStop = (s: number) => {
          me.stopT = Math.max(me.stopT, s);
        };
      }
      plow.stealSnow = (f: number) => {
        me.rot.stealBall(f);
        return 0;
      };
      const startDash = (mode: 'strike' | 'dodge') => {
        me.dashT = DASH_SECONDS;
        me.dashMode = mode;
        me.struck = false;
        plow.dashing = true;
        // Plow.invulnerable: the first DASH_IFRAMES s of a dash take no damage at all (PlowBase).
        plow.invulnerable = true;
        if (mode === 'dodge') {
          // A sidestep: this plow drives sideways and the enemy's aim lags for the dash.
          const s = R() < 0.5 ? -1 : 1;
          me.aimT = Math.max(me.aimT, DASH_SECONDS);
          me.aimSign = s;
          foe.aimT = Math.max(foe.aimT, DASH_SECONDS);
          foe.aimSign = -s;
        }
      };
      me.rot = new Rotation(me.p, () => foe.handle, 'use', {
        clock: false,
        slamPoint: (r) => {
          // Where Plow's slam lands: r + 0.5 past the blade tip (PlowMotion), only thrown with the enemy in its zone.
          const h = plow.heading;
          const k = TIP_Z + r + 0.5;
          const x = plow.position.x + Math.sin(h) * k;
          const z = plow.position.z + Math.cos(h) * k;
          return Math.hypot(foe.plow.position.x - x, foe.plow.position.z - z) < r + HULL ? { x, z } : null;
        },
        dash: () => {
          if (me.dashT > 0 || me.stopT > 0) return false;
          const d = dist();
          const reach = dashReach(me.st);
          if (move && d < foe.pref + 3 && R() < DODGE_RATE * DT) {
            startDash('dodge');
            return true;
          }
          if (d - CONTACT <= reach && (!move || me.pref <= CONTACT + reach)) {
            startDash('strike');
            return true;
          }
          return false;
        },
      });
    }

    // Symmetry breakers (a mirror would otherwise replay identically and always favour one side).
    const first = R() < 0.5 ? 0 : 1;
    const react = [R() * REACTION, R() * REACTION];
    const n = Math.round(cap / DT);
    for (let tick = 0; tick < n; tick++) {
      // Aim (jukes / dodges throw it off) and the Classic's held ball (its shield).
      for (const s of sides) {
        s.plow.heading = (s.sgn > 0 ? 0 : Math.PI) + (s.aimT > 0 ? s.aimSign * JUKE_ANGLE : 0);
        s.plow.turretHeading = s.plow.heading;
        if (s.kind === 'classic') s.plow.heldBallRadius = ballRadius(s.rot.ball);
      }
      if (move) {
        for (let i = 0; i < 2; i++) {
          const foe = sides[1 - i];
          // Juke: slip out of the enemy's cone until it turns back.
          if (foe.aimT <= 0 && R() < JUKE_RATE * DT) {
            foe.aimT = JUKE_ANGLE / Math.max(0.1, foe.st.turnRate);
            foe.aimSign = R() < 0.5 ? -1 : 1;
          }
        }
        const d = dist();
        for (const s of sides) {
          let u = 0;
          if (s.stopT > 0) u = 0;
          else if (s.dashT > 0) u = s.dashMode === 'strike' ? dashSpeed(s.st) : 0;
          else {
            const want = d - s.pref;
            if (want > HOLD) u = Math.min(s.st.maxSpeed * MANEUVER, (want - HOLD * 0.5) / DT);
            else if (want < -HOLD) u = -Math.min(s.st.maxSpeed * MANEUVER * REVERSE, (-want - HOLD * 0.5) / DT);
          }
          s.plow.speed = Math.abs(u);
          s.z += s.sgn * (u - s.push) * DT;
          s.push *= Math.exp(-PUSH_DECAY * DT);
        }
        sides[0].z = Math.max(-WALL, sides[0].z);
        sides[1].z = Math.min(WALL, sides[1].z);
        if (dist() < CONTACT) {
          const mid = (sides[0].z + sides[1].z) / 2;
          sides[0].z = mid - CONTACT / 2;
          sides[1].z = mid + CONTACT / 2;
        }
        for (const s of sides) s.plow.position.z = s.z;
      }
      // Both pilots act on one clock; who goes first alternates every tick (from a seeded coin flip), and each pilot
      // opens fire after its own seeded reaction delay.
      (ctx as { time: number }).time += DT;
      const order = (tick + first) & 1 ? [1, 0] : [0, 1];
      for (const i of order) if (ctx.time >= react[i]) sides[i].rot.step(DT, ctx);
      for (const i of order) {
        const s = sides[i];
        s.p.c.update(DT);
        s.p.press.clear();
      }
      for (const t of targets) t.update(DT);
      // Dashes: a strike lands on contact; the dash (and its 50% damage cut) ends after DASH_SECONDS.
      for (let i = 0; i < 2; i++) {
        const s = sides[i];
        const foe = sides[1 - i];
        if (s.dashT > 0) {
          if (s.dashMode === 'strike' && !s.struck && dist() <= CONTACT + (move ? 0.25 : dashReach(s.st))) {
            s.struck = true;
            s.p.c.playerRam(foe.handle as EnemyHandle, RAM_SPEED);
          }
          s.dashT -= DT;
          s.plow.invulnerable = s.dashT > DASH_SECONDS - DASH_IFRAMES;
          if (s.dashT <= 0) s.plow.dashing = false;
        }
        if (s.aimT > 0) s.aimT -= DT;
        if (s.stopT > 0) s.stopT -= DT;
      }
      const a = sides[0].plow.dead;
      const b = sides[1].plow.dead;
      if ((a || b) && opts.continuous) {
        for (let i = 0; i < 2; i++) {
          const pl = sides[i].plow;
          if (!pl.dead) continue;
          wrecks[i]++;
          pl.dead = false;
          pl.hp = pl.maxHp;
        }
      } else if (a || b) return { winner: a && b ? -1 : a ? 1 : 0, t: (tick + 1) * DT, hp: [sides[0].plow.hp / sides[0].plow.maxHp, sides[1].plow.hp / sides[1].plow.maxHp], ults, wrecks };
    }
    // Time-out: the higher HP% wins the round, a draw within DUEL_DRAW_EPS (the Duel's rule).
    const hp: [number, number] = [sides[0].plow.hp / sides[0].plow.maxHp, sides[1].plow.hp / sides[1].plow.maxHp];
    return { winner: Math.abs(hp[0] - hp[1]) <= DUEL_DRAW_EPS ? -1 : hp[0] > hp[1] ? 0 : 1, t: cap, hp, timeout: true, ults, wrecks };
  } finally {
    Math.random = mathRandom;
  }
}

/** Share of a parked, same-tier `def` plow's max HP that `atk`'s ultimate alone takes off at centre distance `dist`
 *  (m), through the real Duel damage path: the ultimate and its aftermath over `window` s, minus the same window
 *  without it (passive auras). The attacker does nothing else; the victim does nothing at all. */
export function ultShare(atk: PlowKind, def: PlowKind, tier: Tier, dist: number, window = 10): number {
  const once = (fire: boolean) => {
    const ctx = newCtx();
    const sa = statsFor(atk, tier);
    const sd = statsFor(def, tier);
    const pa = fakePlow(sa, 0, 0, 0);
    const pd = fakePlow(sd, 0, dist, Math.PI);
    let cd: Pilot | null = null;
    const target = new OpponentTarget(new PlowHandle(2, pd as unknown as Plow), () => cd!.c, () => sa, () => pa as unknown as Plow, () => sd);
    target.enabled = true;
    const A = pilot(ctx, sa, pa, target as EnemyManagerAPI, true);
    cd = pilot(ctx, sd, pd, { query: (_x: number, _z: number, _r: number, o: EnemyHandle[] = []) => ((o.length = 0), o), damage: () => false }, true);
    for (let i = 0, n = Math.round(window / DT); i < n; i++) {
      (ctx as { time: number }).time += DT;
      A.press.clear();
      if (fire && i === 0) {
        (A.c as unknown as { critCharge: number }).critCharge = 1;
        A.press.add('KeyF');
      }
      A.c.update(DT);
      cd.c.update(DT);
      target.update(DT);
      if (pd.dead) break;
    }
    return { lost: (sd.maxHp - Math.max(0, pd.hp)) / sd.maxHp, fired: A.ults.length > 0 };
  };
  const a = once(true);
  if (!a.fired) return NaN;
  return a.lost - once(false).lost;
}

/** Aggregate of one kind vs another (row kind's view). */
export interface Cell {
  n: number;
  wins: number;
  losses: number;
  draws: number;
  winT: number;
  winHp: number;
}

export interface Variant {
  name: string;
  mode: Mode;
  dist?: number;
}
export const VARIANTS: Variant[] = [
  { name: 'Movement model (closing, dodges, jukes)', mode: 'move' },
  { name: 'Stand and trade, 3 m', mode: 'stand', dist: 3 },
  { name: 'Stand and trade, 6 m', mode: 'stand', dist: 6 },
];

const hash = (...xs: number[]) => xs.reduce((h, x) => Math.imul(h ^ (x + 0x9e3779b9), 0x85ebca6b) >>> 0, 0x12345);

/** N fights per unordered pair (and per mirror), sides alternating; returns cells[row][col] from the row's view. */
export function matrix(tier: Tier, v: Variant, N: number, seed: number, kinds: PlowKind[] = KINDS): Cell[][] {
  const empty = (): Cell => ({ n: 0, wins: 0, losses: 0, draws: 0, winT: 0, winHp: 0 });
  const cells = kinds.map(() => kinds.map(empty));
  const ti = TIERS.indexOf(tier);
  for (let i = 0; i < kinds.length; i++) {
    for (let j = i; j < kinds.length; j++) {
      for (let f = 0; f < N; f++) {
        const swap = f & 1;
        const [x, y] = swap ? [j, i] : [i, j];
        const r = fight(kinds[x], kinds[y], tier, { mode: v.mode, dist: v.dist, seed: hash(seed, ti, i, j, f, v.mode === 'move' ? 0 : (v.dist ?? 0)) });
        const note = (row: number, col: number, side: 0 | 1) => {
          const c = cells[row][col];
          c.n++;
          if (r.winner === -1) c.draws++;
          else if (r.winner === side) {
            c.wins++;
            c.winT += r.t;
            c.winHp += r.hp[side];
          } else c.losses++;
        };
        if (i === j) {
          // Mirror: count side 0's view (sides alternate per fight, so this is "the first-listed side").
          note(i, j, 0);
        } else {
          note(x, y, 0);
          note(y, x, 1);
        }
      }
    }
  }
  return cells;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const NAMES: Record<PlowKind, string> = { classic: 'Classic', volt: 'VOLT-9', brute: 'BRUTUS', isotope: 'ISOTOPE', arsenal: 'ARSENAL' };

export function renderVariant(tier: Tier, v: Variant, cells: Cell[][], kinds: PlowKind[] = KINDS): string {
  const out: string[] = [];
  out.push(`\n#### ${tier}: ${v.name}\n`);
  out.push('Win rate, row beats column (draws in brackets when any; diagonal = mirror, side A win rate):\n');
  out.push(`| | ${kinds.map((k) => NAMES[k]).join(' | ')} |`);
  out.push(`|---|${kinds.map(() => '---').join('|')}|`);
  for (let i = 0; i < kinds.length; i++) {
    const row = kinds.map((_, j) => {
      const c = cells[i][j];
      return `${pct(c.wins / c.n)}${c.draws ? ` (${c.draws}d)` : ''}`;
    });
    out.push(`| **${NAMES[kinds[i]]}** | ${row.join(' | ')} |`);
  }
  const rank = kinds
    .map((k, i) => {
      let n = 0;
      let w = 0;
      let d = 0;
      let wt = 0;
      let wh = 0;
      for (let j = 0; j < kinds.length; j++) {
        if (j === i) continue;
        const c = cells[i][j];
        n += c.n;
        w += c.wins;
        d += c.draws;
        wt += c.winT;
        wh += c.winHp;
      }
      return { k, score: (w + d * 0.5) / n, win: w / n, draw: d / n, t: w ? wt / w : NaN, hp: w ? wh / w : NaN };
    })
    .sort((a, b) => b.score - a.score);
  out.push('\nRanking vs the other four (score = win + half a draw):\n');
  out.push('| # | plow | score | win % | draw % | avg time to win (s) | avg HP left when winning |');
  out.push('|---|---|---|---|---|---|---|');
  rank.forEach((r, i) => out.push(`| ${i + 1} | ${NAMES[r.k]} | ${pct(r.score)} | ${pct(r.win)} | ${pct(r.draw)} | ${Number.isFinite(r.t) ? r.t.toFixed(1) : '-'} | ${Number.isFinite(r.hp) ? pct(r.hp) : '-'} |`));
  return out.join('\n');
}

/** Ultimates per tier: for each plow, continuous fights (`continuous`, meters carried through wrecks as across a
 *  match's rounds, ULT_CAP s) against every plow (mirror included): mean time of the first ultimate (over the fights
 *  where one fired) and ultimates per minute; plus the share of a parked same-tier victim's max HP one ultimate takes
 *  (ultShare at 4 m, mean over the five victims). */
export const ULT_CAP = 120;
export function renderUlts(tier: Tier, N: number, seed: number, kinds: PlowKind[] = KINDS): string {
  const out: string[] = [];
  out.push(`\n#### ${tier}: ultimates (${N} continuous ${ULT_CAP} s fights per opponent)\n`);
  out.push('| plow | first ultimate (s) | fired in | ultimates / min | ultimate on a parked victim (% max HP) |');
  out.push('|---|---|---|---|---|');
  const ti = TIERS.indexOf(tier);
  for (let i = 0; i < kinds.length; i++) {
    const firsts: number[] = [];
    let fights = 0;
    let ults = 0;
    for (let j = 0; j < kinds.length; j++)
      for (let f = 0; f < N; f++) {
        const r = fight(kinds[i], kinds[j], tier, { mode: 'move', seed: hash(seed, ti, i, j, f, 77), cap: ULT_CAP, continuous: true });
        fights++;
        ults += r.ults[0].length;
        if (r.ults[0].length) firsts.push(r.ults[0][0]);
      }
    const share = kinds.map((d) => ultShare(kinds[i], d, tier, 4)).filter(Number.isFinite);
    const first = firsts.length ? (firsts.reduce((a, b) => a + b, 0) / firsts.length).toFixed(1) : '-';
    const sh = share.length ? pct(share.reduce((a, b) => a + b, 0) / share.length) : '-';
    out.push(`| ${NAMES[kinds[i]]} | ${first} | ${firsts.length}/${fights} | ${((ults / fights) * 60 / ULT_CAP).toFixed(2)} | ${sh} |`);
  }
  return out.join('\n');
}

/** The whole report: every tier x variant. */
export function report(N = 40, seed = 1, tiers: Tier[] = TIERS, variants: Variant[] = VARIANTS, log?: (s: string) => void): string {
  const out: string[] = [];
  out.push('# Two-way Duel sim\n');
  out.push(`Both plows fight back through the real Duel damage path; ${N} fights per pair per tier per variant (sides alternate), seed ${seed}, fights capped at one Duel round, ${CAP} s (time-out: higher HP% wins, as in the game). Model: scripts/balance/duel2.ts.\n`);
  out.push('Preferred ranges (centre distance, m) the movement model steers to:\n');
  out.push(`| tier | ${KINDS.map((k) => NAMES[k]).join(' | ')} |`);
  out.push(`|---|${KINDS.map(() => '---').join('|')}|`);
  for (const t of tiers) out.push(`| ${t} | ${KINDS.map((k) => { const st = statsFor(k, t); return `${preferredRange(st).toFixed(1)} (spd ${st.maxSpeed.toFixed(1)})`; }).join(' | ')} |`);
  for (const t of tiers) {
    out.push(`\n### ${t}`);
    for (const v of variants) {
      const t0 = Date.now();
      out.push(renderVariant(t, v, matrix(t, v, N, seed)));
      log?.(`${t} / ${v.name}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    }
    out.push(renderUlts(t, Math.max(2, Math.round(N / 10)), seed));
  }
  return out.join('\n') + '\n';
}

/** Keeps THREE imported for the fake plows' vectors in type position (tree-shaken otherwise). */
export type _V = THREE.Vector3;
