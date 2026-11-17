import * as THREE from 'three';
import { ARENA, type EnemyHandle } from '../../core/types';
import { Bot, type Host } from './Bot';
import { clamp, face, goTo } from './ai';
import { donaldProps, type WallLine } from './donaldProps';
import { chairmanProps } from './chairmanProps';
import { CHAIRMAN_FINGER, CHAIRMAN_MUZZLE, CHAIRMAN_PART, CHAIRMAN_ROOM_Y, chairmanButton, chairmanMonitor } from './models';
import { waveHitPlow } from '../combat/shared';
import { CHAIRMAN_LAST, CHAIRMAN_TAUNTS } from '../../config/lore';

/* THE CHAIRMAN (PROTOCOL C wave 7): THE DONALD revealed, in his walking golden tower (models.ts chairman). Every move
 * is telegraphed (>= 1 s, a ground marker or a beam, the cannon lid / the finger winding up):
 *  - BRIEFCASE CANNON: two shots per move; each aims briefcases at rings on the floor (the plow and its lead; phase 2
 *    a volley of three), the rings fill until the case lands: a paper burst, damage and a short daze.
 *  - QUARTERLY REPORTS: a paper storm (chairmanProps) that scrambles the HUD minimap and slows the plow inside it.
 *  - HOSTILE TAKEOVER: the golden finger beams an echo: ACQUIRED (gold armour TAKE_ARMOR x damage taken, TAKE_SPEED x
 *    speed) until the player knocks TAKE_BREAK of its max HP off it, or TAKE_T s pass.
 *  - RESTRUCTURING: rows of gold partition walls across the arena (DonaldProps walls, smashable like THE DONALD's).
 *  - DEPORTATION (a wider beam) and RALLY (the boardroom becomes a podium: rally bots, 60% less damage until half the
 *    bots or the podium are wrecked).
 *  - Phase 2 at PHASE2 HP: GOLDEN PARACHUTE (the canopy pops from the roof): GOLD PLATED windows (PLATE_ON s after a
 *    warning, every PLATE_OFF s) reflect CHUTE_REFLECT of the damage taken (capped, donaldProps), CHUTE_SPEED x speed, faster cooldowns, briefcases in volleys of three.
 * Scripted (Bot.scripted: no damage, its AI runs whatever the plow does): the REVEAL descent from the boardroom box onto
 * the floor, and the DEFEAT (the tower sags, the treads seize, he slams PROTOCOL C; then the wreck). Ultimates hurt him
 * like any boss. */

export const CH = {
  /** Descent from the boardroom box to the floor (s); the landing shockwave radius / damage (x ramDamage). */
  REVEAL_T: 2.8,
  LAND_R: 7,
  LAND_DMG: 0.6,
  /** Briefcases: wind-up before the first shot (rings already showing), flight, gap between the two shots, ring
   *  radius, damage (x ramDamage), daze (s), cooldown. */
  CASE_WIND: 1.0,
  CASE_FLIGHT: 1.1,
  CASE_GAP: 1.0,
  CASE_SHOTS: 2,
  CASE_R: 3.0,
  CASE_DMG: 0.7,
  CASE_DAZE: 0.7,
  CASE_CD: 6,
  /** QUARTERLY REPORTS: wind-up, storm time, radius, the plow's top speed inside (x), cooldown. */
  REPORT_WIND: 1.3,
  REPORT_T: 5.5,
  REPORT_R: 10,
  REPORT_SLOW: 0.55,
  REPORT_CD: 22,
  /** HOSTILE TAKEOVER: wind-up (the thin beam), the shot, buff time, the share of max HP that breaks it, armour (x
   *  damage taken), speed (x), cooldown. */
  TAKE_WIND: 1.3,
  TAKE_FIRE: 0.45,
  TAKE_T: 12,
  TAKE_BREAK: 0.3,
  TAKE_ARMOR: 0.5,
  TAKE_SPEED: 1.35,
  TAKE_CD: 18,
  /** RESTRUCTURING: wall telegraph, wall life, cooldown. */
  WALL_TELE: 1.3,
  WALL_LIFE: 10,
  WALL_CD: 24,
  /** DEPORTATION: telegraph, ring radius (phase 2: x1.15), cooldown. */
  BEAM_WIND: 1.2,
  BEAM_R: 5.2,
  BEAM_CD: 13,
  /** RALLY: length, bots (phase 2: +2), cooldown; the first rally comes once he is under RALLY_AT HP. */
  RALLY_T: 9,
  RALLY_N: 6,
  RALLY_CD: 32,
  RALLY_AT: 0.75,
  /** Most rally bots on the floor at once (a rally tops them up to this; it still summons at least two). */
  RALLY_MAX: 10,
  /** Phase 2. */
  PHASE2: 0.5,
  CHUTE_REFLECT: 0.15,
  /** GOLD PLATED windows in phase 2: he reflects only while plated (PLATE_ON s, after a PLATE_WARN s warning), then
   *  PLATE_OFF s open. Stop hitting him while he glows and nothing comes back. */
  PLATE_ON: 2.5,
  PLATE_OFF: 5,
  PLATE_WARN: 0.8,
  CHUTE_SPEED: 1.25,
  /** Cooldowns run x this in phase 2 (shorter). */
  CHUTE_CD: 0.7,
  /** Defeat: total length (s) and when he slams the button. */
  DEFEAT_T: 3.8,
  DEFEAT_PRESS: 2.3,
} as const;

/** Where the Chairman lands (in front of the north stand, under his box). */
export const CHAIRMAN_LAND = { x: 0, z: -19 } as const;
/** The boardroom box in the stand (ProtocolScenery BOARDROOM): the descent starts there. */
const BOX = { x: 0, y: 15.5, z: -40 } as const;

export type ChairmanMove = 'rally' | 'takeover' | 'restructure' | 'reports' | 'beam' | 'cases' | 'shove' | null;

export interface ChairmanState {
  caseCd: number;
  reportCd: number;
  takeCd: number;
  wallCd: number;
  beamCd: number;
  rallyCd: number;
  rallied: boolean;
  chute: boolean;
  chuteK: number;
  /** Phase 2 GOLD PLATED cycle: time left in the current step, and the step (0 open, 1 warning, 2 plated). */
  plateT: number;
  plate: 0 | 1 | 2;
  shots: number;
  tauntT: number;
  tauntI: number;
  rally: Bot[];
  podPending: boolean;
  podX: number;
  podZ: number;
  /** HOSTILE TAKEOVER: the echo being beamed (wind-up) / held, its HP when acquired, time left. */
  target: Bot | null;
  acquired: Bot | null;
  acqHp: number;
  /** Scripted sequences: time into the reveal / defeat; whether he has slammed the button. */
  seqT: number;
  pressed: boolean;
  landed: boolean;
  /** The last move started (pickMove interleaves the cannon between the big moves). */
  last: ChairmanMove;
}

const STATE = new WeakMap<Bot, ChairmanState>();
export function chairmanState(e: Bot): ChairmanState {
  let s = STATE.get(e);
  if (!s) {
    s = {
      caseCd: 2.5, reportCd: 9, takeCd: 7, wallCd: 14, beamCd: 11, rallyCd: 26, rallied: false, chute: false, chuteK: 0, plateT: 0, plate: 0, shots: 0,
      tauntT: 6, tauntI: 0, rally: [], podPending: false, podX: 0, podZ: 0, target: null, acquired: null, acqHp: 0, seqT: 0, pressed: false, landed: false, last: null,
    };
    STATE.set(e, s);
  }
  return s;
}

/** The next move (between moves, cooldown up): RALLY first; right after one of the big moves a ready BRIEFCASE CANNON;
 *  else the big move that has been ready longest (HOSTILE TAKEOVER, RESTRUCTURING, QUARTERLY REPORTS, DEPORTATION; a tie
 *  goes in that order), so none of them starves the others; else the BRIEFCASE CANNON; else a shove up close. Pure
 *  (tests). */
export function pickMove(s: ChairmanState, o: { hpFrac: number; dist: number; reach: number; echo: boolean; wallsUp: boolean; storm: boolean; beam: boolean }): ChairmanMove {
  if (s.rallyCd <= 0 && (s.rallied || o.hpFrac < CH.RALLY_AT)) return 'rally';
  if (s.caseCd <= 0 && s.last !== null && s.last !== 'cases' && s.last !== 'shove') return 'cases';
  let best: ChairmanMove = null;
  let bc = 0;
  if (s.takeCd <= 0 && o.echo && !s.acquired) {
    best = 'takeover';
    bc = s.takeCd;
  }
  if (s.wallCd <= 0 && !o.wallsUp && (!best || s.wallCd < bc)) {
    best = 'restructure';
    bc = s.wallCd;
  }
  if (s.reportCd <= 0 && !o.storm && (!best || s.reportCd < bc)) {
    best = 'reports';
    bc = s.reportCd;
  }
  if (s.beamCd <= 0 && !o.beam && (!best || s.beamCd < bc)) best = 'beam';
  if (best) return best;
  if (s.caseCd <= 0) return 'cases';
  if (o.dist < o.reach) return 'shove';
  return null;
}

/** HOSTILE TAKEOVER buff on / off (gold armour + speed; Bot.guardMult / spdMult / acquired). */
export function acquire(b: Bot): void {
  b.guardMult = CH.TAKE_ARMOR;
  b.spdMult = CH.TAKE_SPEED;
  b.acquired = CH.TAKE_T;
}
export function release(b: Bot): void {
  b.guardMult = 1;
  b.spdMult = 1;
  b.acquired = 0;
}

/* ------------------------------------------------------------------ parts */

interface Parts {
  body: THREE.Object3D;
  cannon: THREE.Object3D | null;
  lid: THREE.Object3D | null;
  finger: THREE.Object3D | null;
  chute: THREE.Object3D | null;
  arm: THREE.Object3D | null;
  button: THREE.Object3D | null;
}
const PARTS = new WeakMap<Bot, Parts>();
function parts(e: Bot): Parts {
  let p = PARTS.get(e);
  if (!p) {
    const r = e.rig.root;
    p = {
      body: e.rig.body,
      cannon: r.getObjectByName(CHAIRMAN_PART.cannon) ?? null,
      lid: r.getObjectByName(CHAIRMAN_PART.lid) ?? null,
      finger: r.getObjectByName(CHAIRMAN_PART.finger) ?? null,
      chute: r.getObjectByName(CHAIRMAN_PART.chute) ?? null,
      arm: r.getObjectByName(CHAIRMAN_PART.arm) ?? null,
      button: r.getObjectByName(CHAIRMAN_PART.button) ?? null,
    };
    PARTS.set(e, p);
  }
  return p;
}

const _w = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q: EnemyHandle[] = [];

/** A body-frame anchor (local x, y, z; +Z forward) of bot `e` in world space (ignores the arm poses). */
function anchor(e: Bot, l: readonly [number, number, number], out: THREE.Vector3): THREE.Vector3 {
  const c = Math.cos(e.heading);
  const s = Math.sin(e.heading);
  return out.set(e.position.x + l[0] * c + l[2] * s, e.groundY + l[1], e.position.z - l[0] * s + l[2] * c);
}

/** The echo HOSTILE TAKEOVER would pick: the nearest fighting echo (not held on the leash, not already acquired). */
function takeoverTarget(h: Host, e: Bot): Bot | null {
  let best: Bot | null = null;
  let bd = Infinity;
  for (const b of h.ctx.enemies.bosses) {
    const o = b as Bot;
    if (!o.alive || !o.echo || o.held || o.acquired > 0 || o.entering) continue;
    const d = Math.hypot(o.position.x - e.position.x, o.position.z - e.position.z);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

const m = 4;
const inArenaX = (x: number) => clamp(x, ARENA.minX + m, ARENA.maxX - m);
const inArenaZ = (z: number) => clamp(z, ARENA.minZ + m, ARENA.maxZ - m);

/* ------------------------------------------------------------------ moves */

function casesStart(h: Host, e: Bot, s: ChairmanState): void {
  s.shots = CH.CASE_SHOTS;
  s.caseCd = CH.CASE_CD * (s.chute ? CH.CHUTE_CD : 1);
  aimVolley(h, e, s, CH.CASE_WIND);
  e.set('caseWind', CH.CASE_WIND);
  h.label(e, s.chute ? 'BRIEFCASE VOLLEY!' : 'BRIEFCASE CANNON!', '#ffd24a', 1.15);
  h.sfx('charge', 0.7, 0.8, 0.15);
}

/** Aim one shot: briefcases at the plow and its lead (phase 2: + a third to the side). Their rings show at once and
 *  fill until they land (`wait` s on the ring before launch + the flight). */
function aimVolley(h: Host, e: Bot, s: ChairmanState, wait: number): void {
  const plow = h.ctx.plow;
  anchor(e, CHAIRMAN_MUZZLE, _w);
  const lead = clamp(plow.speed, -6, 12) * 0.6;
  const fx = Math.sin(plow.heading);
  const fz = Math.cos(plow.heading);
  const dmg = e.def.ramDamage * CH.CASE_DMG;
  const pts: [number, number][] = [[h.px, h.pz], [h.px + fx * (lead + 4.5), h.pz + fz * (lead + 4.5)]];
  if (s.chute) pts.push([h.px + fz * 5.5, h.pz - fx * 5.5]);
  for (const [x, z] of pts) chairmanProps.lob(h, e, _w.x, _w.y, _w.z, inArenaX(x), inArenaZ(z), wait, CH.CASE_FLIGHT, CH.CASE_R, dmg, CH.CASE_DAZE);
}

function reportsStart(h: Host, e: Bot, s: ChairmanState): void {
  s.reportCd = CH.REPORT_CD * (s.chute ? CH.CHUTE_CD : 1);
  chairmanProps.startStorm(h, inArenaX(h.px), inArenaZ(h.pz), CH.REPORT_R, CH.REPORT_WIND, CH.REPORT_T, CH.REPORT_SLOW);
  e.set('reportWind', CH.REPORT_WIND);
  h.label(e, 'QUARTERLY REPORTS!', '#fff6d0', 1.2);
  h.sfx('whirl', 0.6, 0.8, 0.15);
}

function takeoverStart(h: Host, e: Bot, s: ChairmanState, t: Bot): void {
  s.takeCd = CH.TAKE_CD * (s.chute ? CH.CHUTE_CD : 1);
  s.target = t;
  anchor(e, CHAIRMAN_FINGER, _w);
  chairmanProps.beam(h, _w, t, CH.TAKE_WIND, false);
  e.set('takeWind', CH.TAKE_WIND);
  h.label(e, 'HOSTILE TAKEOVER!', '#ffd24a', 1.25);
  h.sfx('charge', 0.7, 1.4, 0.1);
}

function takeoverFire(h: Host, e: Bot, s: ChairmanState): void {
  const t = s.target;
  s.target = null;
  if (!t || !t.alive || t.acquired > 0) {
    e.set('recover', 0.4);
    return;
  }
  anchor(e, CHAIRMAN_FINGER, _w);
  chairmanProps.beam(h, _w, t, CH.TAKE_FIRE, true);
  if (s.acquired) release(s.acquired);
  acquire(t);
  s.acquired = t;
  s.acqHp = t.hp;
  chairmanProps.stampOver(t);
  _v.set(t.position.x, t.groundY + 0.1, t.position.z);
  h.ctx.fx.ring(_v, t.radius * 2.6, 0xffc233);
  _v.y = t.groundY + t.rig.height * 0.6;
  h.ctx.fx.burst(_v, { color: 0xffd257, count: 30, speed: 8, size: 0.14, gravity: 6, life: 0.9 });
  h.label(t, 'ACQUIRED!', '#ffd24a', 1.3);
  h.sfx('shockwave', 0.7, 1.5, 0.1);
  e.set('recover', CH.TAKE_FIRE + 0.3);
}

/** Per frame while an echo is acquired: sparks; the buff breaks on TAKE_BREAK of its max HP lost, or times out. */
function takeoverTick(h: Host, s: ChairmanState, dt: number): void {
  const b = s.acquired;
  if (!b) return;
  if (!b.alive) {
    s.acquired = null;
    chairmanProps.stampOver(null);
    return;
  }
  b.acquired -= dt;
  if (s.acqHp - b.hp >= b.maxHp * CH.TAKE_BREAK) {
    release(b);
    s.acquired = null;
    chairmanProps.stampOver(null);
    b.stun = Math.max(b.stun, 1.5);
    b.stunMult = 1.5;
    h.label(b, 'DEAL BROKEN!', '#ffe14a', 1.2);
    h.sfx('stun', 0.8, 1.1, 0.1);
    return;
  }
  if (b.acquired <= 0) {
    release(b);
    s.acquired = null;
    chairmanProps.stampOver(null);
    return;
  }
  if (b.sparkT <= 0) {
    b.sparkT = 0.18;
    h.sparks(b, 0xffd257, 2);
  }
}

function restructureStart(h: Host, e: Bot, s: ChairmanState): void {
  s.wallCd = CH.WALL_CD * (s.chute ? CH.CHUTE_CD : 1);
  // three rows of partitions across the arena around the plow, each with a gap (alternating sides): a cubicle maze
  const alongX = Math.abs(h.pz - e.position.z) >= Math.abs(h.px - e.position.x);
  const c = alongX ? clamp(h.pz, ARENA.minZ + 10, ARENA.maxZ - 10) : clamp(h.px, ARENA.minX + 10, ARENA.maxX - 10);
  const L = ARENA.maxX - 2;
  const GAP = 7;
  const lines: WallLine[] = [];
  for (let k = -1; k <= 1; k++) {
    const o = c + k * 8;
    const gc = (k === 0 ? -1 : 1) * 9 * (s.chute ? -1 : 1);
    const segs: [number, number][] = [[-L, gc - GAP / 2], [gc + GAP / 2, L]];
    for (const [a, b] of segs) {
      if (b - a < 2) continue;
      lines.push(alongX ? { x: a, z: o, dx: 1, dz: 0, len: b - a } : { x: o, z: a, dx: 0, dz: 1, len: b - a });
    }
  }
  donaldProps.claim(e);
  donaldProps.buildWalls(h, lines, CH.WALL_TELE, CH.WALL_LIFE, true);
  e.set('wallWind', CH.WALL_TELE);
  h.label(e, 'RESTRUCTURING!', '#ffd24a', 1.25);
  h.sfx('charge', 0.7, 0.6, 0.15);
}

function beamStart(h: Host, e: Bot, s: ChairmanState): void {
  s.beamCd = CH.BEAM_CD * (s.chute ? CH.CHUTE_CD : 1);
  const plow = h.ctx.plow;
  const lead = clamp(plow.speed, -6, 12) * 0.35;
  const x = inArenaX(h.px + Math.sin(plow.heading) * lead);
  const z = inArenaZ(h.pz + Math.cos(plow.heading) * lead);
  donaldProps.claim(e);
  donaldProps.startBeam(h, x, z, CH.BEAM_R * (s.chute ? 1.15 : 1), CH.BEAM_WIND);
  e.set('beamWind', CH.BEAM_WIND);
  h.label(e, 'DEPORTATION!', '#7fe3ff', 1.25);
}

function rallyStart(h: Host, e: Bot, s: ChairmanState): void {
  const ctx = h.ctx;
  s.rallied = true;
  s.rallyCd = CH.RALLY_CD * (s.chute ? CH.CHUTE_CD : 1);
  // never more than RALLY_MAX red caps on the floor (the ones left over from the last rally count)
  let left = 0;
  for (const b of ctx.enemies.query(0, 0, ARENA.maxX * 1.5, _q)) if (b.type === 'rallybot' && b.alive) left++;
  const n = Math.max(2, Math.min(CH.RALLY_N + (s.chute ? 2 : 0), CH.RALLY_MAX - left));
  e.set('rally', CH.RALLY_T);
  e.dmgTakenMult = 0.4;
  e.speed = 0;
  s.rally.length = 0;
  const hd = e.heading;
  for (let i = 0; i < n; i++) {
    const a = hd + Math.PI / n + (i / n) * Math.PI * 2;
    const x = clamp(e.position.x + Math.sin(a) * 8, ARENA.minX + 2, ARENA.maxX - 2);
    const z = clamp(e.position.z + Math.cos(a) * 8, ARENA.minZ + 2, ARENA.maxZ - 2);
    const b = ctx.enemies.spawn('rallybot', x, z, { hpMult: ctx.zone.enemyHpMult, heading: a }) as Bot;
    b.spdMult = 1.3;
    b.dmgOutMult = 1.4;
    b.summoned = true;
    s.rally.push(b);
    _v.set(x, 1, z);
    for (const c of [0xc8102e, 0xffffff, 0x1f3b8c, 0xffd24a]) ctx.fx.burst(_v, { color: c, count: 8, speed: 7, size: 0.13, gravity: 9, life: 1.0 });
  }
  const f = e.rig.front + 2.2;
  s.podX = e.position.x + Math.sin(hd) * f;
  s.podZ = e.position.z + Math.cos(hd) * f;
  s.podPending = true;
  h.label(e, 'BOARD MEETING! RALLY!', '#ff4a5a', 1.3);
  h.sfx('roar', 0.9, 1.0, 0.2);
}

function rallyEnd(h: Host, e: Bot, s: ChairmanState, broken: boolean): void {
  e.dmgTakenMult = 1;
  for (const b of s.rally) {
    b.spdMult = 1;
    b.dmgOutMult = 1;
  }
  s.rally.length = 0;
  s.podPending = false;
  donaldProps.dropPodium();
  e.glow = 0;
  if (broken) {
    e.set('recover', 0.3);
    e.stun = 2.6;
    e.stunMult = 1.5;
    h.label(e, 'MEETING ADJOURNED!', '#ffe14a', 1.3);
    h.sfx('stun', 0.9, 0.9, 0.1);
  } else e.set('recover', 0.5);
}

/** Phase 2 GOLD PLATED cycle: open (no reflect) -> warning (sparks, label) -> plated (reflects CHUTE_REFLECT). */
function plateTick(h: Host, e: Bot, s: ChairmanState, dt: number): void {
  s.plateT -= dt;
  if (s.plate === 2 && e.sparkT <= 0) {
    e.sparkT = 0.06;
    h.sparks(e, 0xffd24a, 4);
  }
  if (s.plateT > 0) return;
  if (s.plate === 0) {
    s.plate = 1;
    s.plateT = CH.PLATE_WARN;
    h.label(e, 'GOLD PLATING...', '#ffd24a', 0.9);
  } else if (s.plate === 1) {
    s.plate = 2;
    s.plateT = CH.PLATE_ON;
    e.reflect = CH.CHUTE_REFLECT;
    h.label(e, 'GOLD PLATED! HOLD FIRE!', '#ffd24a', 1.2);
    anchor(e, [0, CHAIRMAN_ROOM_Y, 0], _v);
    h.ctx.fx.burst(_v, { color: 0xffd257, count: 30, speed: 9, size: 0.14, gravity: 4, life: 0.8 });
  } else {
    s.plate = 0;
    s.plateT = CH.PLATE_OFF;
    e.reflect = 0;
    e.reflectPool = 0;
  }
}

function chuteOpen(h: Host, e: Bot, s: ChairmanState): void {
  s.chute = true;
  s.chuteK = 0;
  e.enraged = true;
  // reflection comes in GOLD PLATED windows (plateTick), starting with a short open spell after the pop
  e.reflect = 0;
  s.plate = 0;
  s.plateT = 3;
  h.bossPhase(e, 'GOLDEN PARACHUTE!');
  s.caseCd = Math.min(s.caseCd, 1.5);
  const c = parts(e).chute;
  if (c) c.visible = true;
  anchor(e, [0, CHAIRMAN_ROOM_Y + 3.5, -0.5], _v);
  h.ctx.fx.burst(_v, { color: 0xffd257, count: 40, speed: 10, size: 0.16, gravity: 5, life: 1.2 });
}

/* ------------------------------------------------------------------ scripted: reveal + defeat */

/** First frame on the floor (Waves spawned him under his box): the box detaches, the descent starts. */
function revealStart(h: Host, e: Bot, s: ChairmanState): void {
  e.scripted = true;
  s.seqT = 0;
  s.landed = false;
  e.set('reveal', CH.REVEAL_T);
  h.ctx.world?.boardroom?.('gone');
  const fx = h.ctx.fx;
  _v.set(BOX.x, BOX.y, BOX.z);
  for (const c of [0xffd257, 0xffffff, 0xc8102e, 0x1f3b8c]) fx.burst(_v, { color: c, count: 22, speed: 10, size: 0.18, gravity: 6, life: 1.6 });
  fx.shake(0.6);
  h.sfx('roar', 0.9, 0.9, 0.2);
  h.ctx.cameraRig?.cinematic(e.position.x, e.position.z - 4, CH.REVEAL_T + 1.4, 3);
}

function reveal(h: Host, e: Bot, s: ChairmanState, dt: number): void {
  s.seqT += dt;
  const u = Math.min(1, s.seqT / CH.REVEAL_T);
  // an arc from the box down to the floor: falls in, treads first
  const k = u * u * (3 - 2 * u);
  const fall = u * u;
  e.hoverX = (BOX.x - e.position.x) * (1 - k);
  e.hoverZ = (BOX.z - e.position.z) * (1 - k);
  e.hoverY = Math.max(0, (BOX.y - CHAIRMAN_ROOM_Y - 1.2) * (1 - fall));
  e.desSpeed = 0;
  e.speed = 0;
  e.glow = 0.5 + 0.5 * Math.sin(h.time * 10);
  h.ring(e, e.position.x, e.position.z, CH.LAND_R, u, 0xffb21a, 0.35 + 0.45 * u);
  if (u >= 1 && !s.landed) {
    s.landed = true;
    e.hoverX = e.hoverY = e.hoverZ = 0;
    h.clearTele(e);
    const fx = h.ctx.fx;
    _v.set(e.position.x, e.groundY + 0.1, e.position.z);
    fx.ring(_v, CH.LAND_R, 0xffc233);
    fx.ring(_v, CH.LAND_R * 0.6, 0xffffff);
    _v.y += 0.8;
    fx.burst(_v, { color: 0xffffff, count: 60, speed: 12, size: 0.32, gravity: 12, life: 1.0 });
    fx.burst(_v, { color: 0xffd257, count: 30, speed: 10, size: 0.14, gravity: 10, life: 0.8 });
    fx.shake(1.3);
    h.sfx('thud', 1, 0.5, 0.1);
    h.sfx('shockwave', 1, 0.7, 0.1);
    h.ctx.impact?.slowMo(0.7);
    if (h.dist(e) < CH.LAND_R + h.pr * 0.4) waveHitPlow(h.ctx, e, e.def.ramDamage * CH.LAND_DMG, { knockback: 16, unblockable: true });
    h.ctx.ui?.bossIntro(e.def.name, e.def.title);
    h.label(e, 'THE CHAIRMAN WILL SEE YOU NOW.', '#ffd24a', 1.3);
    e.scripted = false;
    e.set('recover', 0.6);
    e.cd = 1.2;
  }
}

/** HP hit zero (Enemies.damage): start the defeat instead of the wreck. False when it is already playing. */
export function chairmanDown(h: Host, e: Bot): boolean {
  if (e.state === 'defeat') return false;
  const s = chairmanState(e);
  if (e.state === 'rally') rallyEnd(h, e, s, false);
  if (s.acquired) {
    release(s.acquired);
    s.acquired = null;
  }
  chairmanProps.stampOver(null);
  e.endAtk();
  h.clearTele(e);
  e.scripted = true;
  e.reflect = 0;
  e.reflectPool = 0;
  e.windup = 0;
  e.glow = 0;
  e.jitter = 0;
  e.stun = 0;
  s.seqT = 0;
  s.pressed = false;
  e.set('defeat', CH.DEFEAT_T);
  // the echoes stop where they stand: the deal is off
  for (const b of h.ctx.enemies.bosses) {
    const o = b as Bot;
    if (o !== e && o.alive && o.echo) {
      o.stun = Math.max(o.stun, CH.DEFEAT_T + 2);
      o.stunMult = 1;
    }
  }
  h.label(e, CHAIRMAN_LAST, '#ff5d5d', 1.3);
  h.sfx('roar', 1, 0.6, 0.2);
  return true;
}

function defeat(h: Host, e: Bot, s: ChairmanState, dt: number): void {
  s.seqT += dt;
  const t = s.seqT;
  const p = parts(e);
  e.desSpeed = 0;
  e.speed *= Math.exp(-6 * dt);
  // the tower sags and lists, the treads seize (sparks off the pods)
  const sag = Math.min(1, t / 0.9);
  e.hoverY = -0.45 * sag;
  p.body.rotation.z = 0.11 * sag;
  e.jitter = t < 0.9 ? 0.04 : 0.01;
  if (e.sparkT <= 0) {
    e.sparkT = 0.12;
    h.sparks(e, 0xffb040, 3);
  }
  // the arm comes up ... and slams PROTOCOL C
  if (p.arm) {
    const up = clamp((t - 1.2) / 0.6, 0, 1);
    const down = clamp((t - CH.DEFEAT_PRESS) / 0.12, 0, 1);
    p.arm.rotation.x = -1.1 * up * (1 - down) + 0.3 * down;
  }
  if (!s.pressed && t >= CH.DEFEAT_PRESS) {
    s.pressed = true;
    if (p.button) p.button.position.y -= 0.05;
    chairmanButton().emissiveIntensity = 6;
    const fx = h.ctx.fx;
    anchor(e, [0.65, CHAIRMAN_ROOM_Y + 1.4, 0.75], _v);
    fx.burst(_v, { color: 0xff2020, count: 30, speed: 7, size: 0.14, gravity: 4, life: 0.8 });
    fx.floatText(_v.setY(_v.y + 2.6), 'PROTOCOL C', '#ff3030', 1.6);
    _v.set(e.position.x, e.groundY + 0.1, e.position.z);
    fx.ring(_v, 14, 0xff2020);
    fx.ring(_v, 9, 0xffffff);
    fx.shake(1.0);
    h.sfx('shockwave', 1, 0.5, 0.1);
    h.sfx('error', 1, 0.6, 0.1);
  }
  if (t >= CH.DEFEAT_T) {
    e.scripted = false;
    e.hoverY = 0;
    h.wreck(e);
  }
}

/* ------------------------------------------------------------------ the AI */

export function chairman(h: Host, e: Bot, dt: number): void {
  const s = chairmanState(e);
  const p = parts(e);
  const first = !STARTED.has(e);
  if (first) {
    STARTED.add(e);
    // a reset left over from the last Chairman (the shared button / monitor materials)
    chairmanButton().emissiveIntensity = 0.6;
    if (e.headline) revealStart(h, e, s);
  }
  // the ankle monitor blinks (twice a second, a short red flash)
  chairmanMonitor().emissiveIntensity = (h.time * 2) % 1 < 0.18 ? 4 : 0.3;
  if (e.state === 'reveal') return reveal(h, e, s, dt);
  if (e.state === 'defeat') return defeat(h, e, s, dt);

  const cdk = s.chute ? 1 / CH.CHUTE_CD : 1;
  s.caseCd -= dt * cdk;
  s.reportCd -= dt * cdk;
  s.takeCd -= dt * cdk;
  s.wallCd -= dt * cdk;
  s.beamCd -= dt * cdk;
  s.rallyCd -= dt * cdk;
  takeoverTick(h, s, dt);
  if (e.state !== 'rally' && e.dmgTakenMult !== 1) rallyEnd(h, e, s, false);
  if (!s.chute && e.hpFrac <= CH.PHASE2) chuteOpen(h, e, s);
  if (s.chute) plateTick(h, e, s, dt);
  if (s.chute && p.chute) {
    // the canopy pops (overshoot) then breathes
    s.chuteK = Math.min(1, s.chuteK + dt * 2.5);
    const k = s.chuteK;
    const pop = k < 1 ? 1 + Math.sin(k * Math.PI) * 0.25 : 1 + Math.sin(h.time * 2.2) * 0.03;
    p.chute.scale.set(pop * k, k, pop * k);
    if (e.sparkT <= 0) {
      e.sparkT = 0.15;
      h.sparks(e, 0xfff2b0, 2);
    }
  }
  s.tauntT -= dt;
  if (s.tauntT <= 0) {
    s.tauntT = s.chute ? 7 : 10;
    h.label(e, CHAIRMAN_TAUNTS[s.tauntI++ % CHAIRMAN_TAUNTS.length], '#ffd24a', 1.0);
  }

  // arm poses: relax toward rest unless a move drives them below
  let lidOpen = 0;
  let cannonPitch = 0;
  let fingerYaw = 0;
  let fingerPitch = 0;
  const spd = e.def.speed * (s.chute ? CH.CHUTE_SPEED : 1);
  const d = h.dist(e);
  switch (e.state) {
    case 'caseWind':
    case 'caseFire': {
      face(e, h.px, h.pz);
      e.desSpeed = 0;
      e.turnRate = 1.6;
      e.windup = e.state === 'caseWind' ? e.prog : 0;
      e.glow = 0.4 + 0.6 * e.prog;
      cannonPitch = -0.45 * Math.min(1, e.prog * 2);
      lidOpen = e.state === 'caseFire' ? 1.25 : e.prog > 0.8 ? 1.25 * (e.prog - 0.8) * 5 : 0;
      anchor(e, CHAIRMAN_MUZZLE, _w);
      chairmanProps.setMuzzle(_w.x, _w.y, _w.z);
      if (e.stateT <= 0) {
        // this volley launches now (its cases leave their rings); the next one is aimed to fly after the gap
        s.shots--;
        h.sfx('thud', 0.8, 1.6, 0.05);
        h.fxAt(_w.x, _w.y, _w.z, 0xfbfaf4, 10, 5, 0.2, 4, 0.8);
        if (s.shots > 0) {
          aimVolley(h, e, s, CH.CASE_GAP);
          e.set('caseFire', CH.CASE_GAP);
        } else e.set('recover', 0.7);
      }
      break;
    }
    case 'reportWind':
      e.desSpeed = 0;
      face(e, h.px, h.pz);
      e.windup = e.prog;
      e.glow = e.prog;
      lidOpen = 1.25 * e.prog;
      cannonPitch = -0.9 * e.prog;
      if (e.sparkT <= 0) {
        e.sparkT = 0.08;
        anchor(e, CHAIRMAN_MUZZLE, _w);
        h.fxAt(_w.x, _w.y + 0.5, _w.z, 0xfbfaf4, 3, 4, 0.22, -1, 1.2);
      }
      if (e.stateT <= 0) {
        e.windup = 0;
        e.set('recover', 0.6);
      }
      break;
    case 'takeWind': {
      e.desSpeed = 0;
      const t = s.target;
      if (!t || !t.alive) {
        s.target = null;
        e.set('recover', 0.4);
        break;
      }
      face(e, t.position.x, t.position.z);
      e.turnRate = 2;
      e.windup = e.prog;
      e.glow = e.prog;
      const a = Math.atan2(t.position.x - e.position.x, t.position.z - e.position.z) - e.heading;
      fingerYaw = clamp(Math.atan2(Math.sin(a), Math.cos(a)), -1.1, 1.1);
      fingerPitch = -0.15;
      anchor(e, CHAIRMAN_FINGER, _w);
      chairmanProps.beamOrigin(_w);
      if (e.stateT <= 0) {
        e.windup = 0;
        takeoverFire(h, e, s);
      }
      break;
    }
    case 'wallWind':
      e.desSpeed = 0;
      face(e, h.px, h.pz);
      e.windup = e.prog * 0.6;
      e.glow = e.prog;
      fingerYaw = Math.sin(h.time * 6) * 0.6;
      if (e.stateT <= 0) {
        e.windup = 0;
        e.set('recover', 0.8);
        s.caseCd = Math.min(s.caseCd, 1.2);
      }
      break;
    case 'beamWind':
      e.desSpeed = 0;
      face(e, h.px, h.pz);
      e.windup = e.prog;
      e.glow = e.prog;
      fingerPitch = -0.35 * e.prog;
      if (e.stateT <= 0) {
        e.windup = 0;
        e.set('recover', 0.6);
      }
      break;
    case 'rally': {
      e.desSpeed = 0;
      e.turnRate = 0.5;
      e.glow = 0.4 + 0.3 * Math.sin(h.time * 6);
      if (s.podPending) {
        s.podPending = false;
        donaldProps.claim(e);
        donaldProps.raisePodium(h, s.podX, s.podZ, e.heading + Math.PI);
      }
      let alive = 0;
      for (const b of s.rally) if (b.alive) alive++;
      const wrecked = s.rally.length - alive;
      if (donaldProps.podiumBroken || wrecked >= Math.ceil(s.rally.length / 2)) {
        donaldProps.podiumBroken = false;
        rallyEnd(h, e, s, true);
      } else if (e.stateT <= 0) rallyEnd(h, e, s, false);
      break;
    }
    case 'shoveWind':
      face(e, h.px, h.pz);
      e.turnRate = 2;
      e.desSpeed = -1;
      e.windup = e.prog;
      e.glow = e.prog;
      if (e.stateT <= 0) {
        e.set('shove', 0.45);
        e.startAtk(e.def.ramDamage, 18);
        e.speed = 3;
        e.windup = 0;
      }
      break;
    case 'shove':
      e.desSpeed = 11;
      e.accel = 40;
      e.turnRate = 0.5;
      if ((e.atkHits > 0 && e.stateT < 0.2) || e.stateT <= 0) {
        e.endAtk();
        e.set('recover', 0.8);
      }
      break;
    case 'recover':
      e.desSpeed = 0;
      e.windup = 0;
      e.glow = Math.max(0, e.glow - dt * 2);
      if (e.stateT <= 0) {
        e.set('approach', 0);
        e.cd = (0.9 + Math.random() * 0.6) * (s.chute ? 0.7 : 1);
      }
      break;
    default: {
      goTo(e, h.px, h.pz, spd, 4);
      e.turnRate = 1.1 * (s.chute ? 1.25 : 1);
      if (e.cd > 0) break;
      const t = takeoverTarget(h, e);
      const mv = pickMove(s, { hpFrac: e.hpFrac, dist: d, reach: e.radius + h.pr + 1.8, echo: !!t, wallsUp: donaldProps.wallsUp, storm: chairmanProps.stormActive, beam: donaldProps.beamActive });
      if (mv) s.last = mv;
      if (mv === 'rally') rallyStart(h, e, s);
      else if (mv === 'takeover') takeoverStart(h, e, s, t!);
      else if (mv === 'restructure') restructureStart(h, e, s);
      else if (mv === 'reports') reportsStart(h, e, s);
      else if (mv === 'beam') beamStart(h, e, s);
      else if (mv === 'cases') casesStart(h, e, s);
      else if (mv === 'shove') {
        e.set('shoveWind', 0.7);
        h.sfx('charge', 0.5, 0.55, 0.2);
      } else e.cd = 0.4;
    }
  }
  // arm poses (eased)
  const ease = 1 - Math.exp(-10 * dt);
  if (p.lid) p.lid.rotation.z += (lidOpen - p.lid.rotation.z) * ease;
  if (p.cannon) p.cannon.rotation.x += (cannonPitch - p.cannon.rotation.x) * ease;
  if (p.finger) {
    p.finger.rotation.y += (fingerYaw - p.finger.rotation.y) * ease;
    p.finger.rotation.x += (fingerPitch - p.finger.rotation.x) * ease;
  }
}

const STARTED = new WeakSet<Bot>();
