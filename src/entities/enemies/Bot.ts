import * as THREE from 'three';
import type { EnemyHandle, GameContext } from '../../core/types';
import { ENEMIES, type EnemyDef, type EnemyType } from '../../config/enemies';
import type { Rig } from './models';
import type { Decal } from './decals';

/** Status kinds that make a bot take extra damage (and stop moving). */
export const Vuln = { None: 0, Overheat: 1, Dizzy: 2, Exposed: 3 } as const;
export type Vuln = (typeof Vuln)[keyof typeof Vuln];

export class Bot implements EnemyHandle {
  readonly id: number;
  readonly type: EnemyType;
  readonly def: EnemyDef;
  readonly position = new THREE.Vector3();
  readonly radius: number;
  readonly mass: number;
  hp: number;
  readonly maxHp: number;
  alive = true;
  readonly isBoss: boolean;
  readonly rig: Rig;

  // --- motion
  heading = 0;
  speed = 0;
  desHeading = 0;
  desSpeed = 0;
  turnRate = 3;
  accel = 12;
  baseTurn = 3;
  baseAccel = 12;
  /** Actual velocity last frame (m/s). */
  vx = 0;
  vz = 0;
  /** External knockback velocity (m/s), decays. */
  kvx = 0;
  kvz = 0;
  /** Set by the wall clamp this frame. */
  wallHit = false;
  wallNx = 0;
  wallNz = 0;
  entering = true;
  gate = -1;
  groundY = 0;

  // --- AI
  state = 'idle';
  stateT = 0;
  stateDur = 1;
  cd = 1;
  cd2 = 0;
  cd3 = 0;
  token = false;
  thiefToken = false;
  orbitA = 0;
  orbitDir = 1;
  orbitR = 6;
  tx = 0;
  tz = 0;
  retargetT = 0;
  aimH = 0;
  phase = 0;
  enraged = false;
  chargesLeft = 0;
  counter = 0;
  flags = 0;
  /** Seconds since the AI last saw the plow alive (taunt mode when plow dead). */
  taunt = 0;

  // --- attack window (contact damage only while active)
  atk = false;
  atkDmg = 0;
  atkKnock = 6;
  atkUnblock = false;
  atkRepeat = 0;
  atkHitCd = 0;
  atkHits = 0;
  atkSteal = 0;

  // --- status
  stun = 0;
  stunMult = 1.5;
  stagger = 0;
  vulnT = 0;
  vulnMult = 1;
  vuln: Vuln = Vuln.None;
  freeze = 0;
  flash = 0;
  ramCd = 0;
  blockFxT = 0;

  // --- type specific
  ballVol = 0;
  ballR = 0;
  ballRoll = 0;
  carry = 0;
  stole = false;

  // --- visuals
  windup = 0;
  glow = 0;
  spinVis = 0;
  spinRate = 0;
  sawRate = 2;
  augerRate = 3;
  rear = 0;
  jitter = 0;
  bob = Math.random() * Math.PI * 2;
  puffT = Math.random();
  sparkT = 0;
  hitT = 0;
  dStripe: Decal | null = null;
  dRing: Decal | null = null;
  dFill: Decal | null = null;

  constructor(id: number, type: EnemyType, hpMult: number, rig: Rig) {
    this.id = id;
    this.type = type;
    this.def = ENEMIES[type];
    this.radius = this.def.radius;
    this.mass = this.def.mass;
    this.maxHp = Math.max(1, Math.round(this.def.hp * hpMult));
    this.hp = this.maxHp;
    this.isBoss = this.def.isBoss;
    this.rig = rig;
    this.orbitDir = Math.random() < 0.5 ? -1 : 1;
  }

  get x(): number {
    return this.position.x;
  }
  get z(): number {
    return this.position.z;
  }
  get hpFrac(): number {
    return this.hp / this.maxHp;
  }
  /** True while the AI is frozen in place (wall stun, overheat, dizzy, exposed, stagger). */
  get disabled(): boolean {
    return this.stun > 0 || this.stagger > 0 || (this.vulnT > 0 && this.vuln !== Vuln.None);
  }

  set(state: string, t: number): void {
    this.state = state;
    this.stateT = t;
    this.stateDur = Math.max(1e-3, t);
  }
  /** 0..1 progress through the current timed state. */
  get prog(): number {
    return 1 - Math.max(0, this.stateT) / this.stateDur;
  }

  startAtk(dmg: number, knock: number, unblockable = false, repeat = 0, steal = 0): void {
    this.atk = true;
    this.atkDmg = dmg;
    this.atkKnock = knock;
    this.atkUnblock = unblockable;
    this.atkRepeat = repeat;
    this.atkHitCd = 0;
    this.atkHits = 0;
    this.atkSteal = steal;
  }
  endAtk(): void {
    this.atk = false;
    this.atkSteal = 0;
  }
}

/** Services the EnemyManager exposes to the per-type AI. */
export interface Host {
  readonly ctx: GameContext;
  /** Cached per frame. */
  readonly px: number;
  readonly pz: number;
  readonly pr: number;
  readonly plowBall: number;
  /** Seconds of game time. */
  readonly time: number;
  /** Distance from bot center to plow center + unit direction (bot -> plow), cached per bot per frame. */
  dist(e: Bot): number;
  readonly ux: number;
  readonly uz: number;
  tryToken(e: Bot): boolean;
  releaseToken(e: Bot): void;
  tryThiefToken(e: Bot): boolean;
  stripe(e: Bot, x: number, z: number, dx: number, dz: number, len: number, w: number, color: number, alpha: number): void;
  ring(e: Bot, x: number, z: number, r: number, fill: number, color: number, alpha: number): void;
  clearTele(e: Bot): void;
  spawnAtGate(type: EnemyType, gate: number): void;
  bossPhase(e: Bot, label: string): void;
  findBoss(type: EnemyType): Bot | null;
  hitPlow(e: Bot, dmg: number, opts?: { knockback?: number; unblockable?: boolean; fromX?: number; fromZ?: number }): number;
  sfx(name: Parameters<GameContext['audio']['play']>[0], volume?: number, pitch?: number, gap?: number): void;
  label(e: Bot, text: string, color: string, size?: number): void;
  sparks(e: Bot, color: number, count: number): void;
  fxAt(x: number, y: number, z: number, color: number, count: number, speed: number, size: number, gravity: number, life: number): void;
  /** Distance from (x, z) to the arena wall along (dx, dz), clamped to `max`. */
  wallDist(x: number, z: number, dx: number, dz: number, max: number): number;
}
