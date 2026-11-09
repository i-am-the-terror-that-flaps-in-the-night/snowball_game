import * as THREE from 'three';
import { ballRadius, type EnemyHandle, type EnemyType } from '../core/types';
import { RIVAL_KINDS, createRivalRig, type RivalRig } from './models';
import { NameTag, SpeechBubble } from './tags';
import type { PlowKind } from '../config/plows';
import type { VoltRig } from './voltRival';
import type { BruteRig } from './bruteRival';
import type { GroundMaterial } from '../world/Terrain';
import { makeVert } from '../world/terrainMotion';
import { RIVAL_R, RIVAL_MASS, type Personality, type Mode, type Fighter, type RivalStats } from './shared';

/* Snowdome Brawl: the Rival, one AI rival plow (an EnemyHandle). */

let nextId = 5000;

export class Rival implements EnemyHandle {
  readonly id = nextId++;
  readonly type: EnemyType = 'rival';
  readonly radius = RIVAL_R;
  readonly mass = RIVAL_MASS;
  readonly isBoss = false;
  readonly rig: RivalRig;
  readonly tag: NameTag;
  readonly bubble = new SpeechBubble();
  readonly position: THREE.Vector3;
  hp: number;
  maxHp: number;
  alive = true;
  f!: Fighter;
  s!: RivalStats;
  readonly pers: Personality;

  heading = 0;
  speed = 0;
  desH = 0;
  desSpeed = 0;
  kvx = 0;
  kvz = 0;
  vx = 0;
  vz = 0;
  ballVol = 0;
  ballSpin = 0;
  /** Held ball as last animated: shown + its root-space matrix (drawn by BrawlManager.balls). */
  ballOn = false;
  readonly ballLocal = new THREE.Matrix4();
  wheelSpin = 0;
  lean = 0;
  // terrain (world/terrainMotion.ts)
  readonly vert = makeVert();
  /** Smoothed snow ride height (m). */
  sink = 0;
  mat: GroundMaterial = 'snow';
  gx = 0;
  gz = 0;
  ice = 0;
  ivx = 0;
  ivz = 0;
  burnT = 0;
  tiltP = 0;
  tiltR = 0;
  get airborne(): boolean {
    return this.vert.airborne;
  }
  get vy(): number {
    return this.vert.vy;
  }
  get deck(): number {
    return this.vert.deck;
  }

  // timers
  protectT = 0;
  respawnT = 0;
  frozenT = 0;
  flashT = 0;
  dashT = 0;
  dashCd = 1 + Math.random() * 2;
  whirlT = -1;
  whirlCd = 3 + Math.random() * 3;
  whirlTick = 0;
  slamT = -1;
  slamCd = 0;
  ramCd = 0;
  recoverT = 0;
  thinkT = 0;
  dodgeT = 0;
  dodgeH = 0;
  stuckT = 0;
  stuckCheckT = 1.2;
  stuckX = 0;
  stuckZ = 0;
  tauntCd = 0;
  /** VOLT-9 Thunderclap: telegraph timer (-1 = idle) and cooldown. */
  clapT = -1;
  clapCd = 2 + Math.random() * 3;
  volt: VoltRig | null = null;
  /** BRUTUS Ground Pound: telegraph/hop timer (-1 = idle) and cooldown. */
  poundT = -1;
  poundCd = 2 + Math.random() * 3;
  brute: BruteRig | null = null;
  /** Hard stun (Ground Pound): no driving, steering or attacks. */
  stunT = 0;

  // AI
  mode: Mode = 'gather';
  target: Fighter | null = null;
  goalX = 0;
  goalZ = 0;
  goalT = 0;

  constructor(kindIndex: number, name: string, color: string, pers: Personality, hp: number, plow: PlowKind = 'classic') {
    this.rig = createRivalRig(RIVAL_KINDS[kindIndex % RIVAL_KINDS.length], color, plow);
    this.position = this.rig.root.position;
    this.hp = hp;
    this.maxHp = hp;
    this.pers = pers;
    this.tag = new NameTag(name, color);
  }

  get ballR(): number {
    return ballRadius(this.ballVol);
  }
  get dashing(): boolean {
    return this.dashT > 0;
  }
  get whirling(): boolean {
    return this.whirlT >= 0;
  }
  get targetable(): boolean {
    return this.alive && this.protectT <= 0;
  }
}
