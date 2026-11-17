import * as THREE from 'three';
import type { EnemyHandle, GameContext } from '../../core/types';
import { ENEMIES, type EnemyDef, type EnemyType } from '../../config/enemies';
import type { Rig } from './models';
import type { Decal } from './decals';
import { makeVert } from '../../world/terrainMotion';
import type { GroundMaterial } from '../../world/Terrain';

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
  /** Feet height actually drawn (= position.y): terrain surface + snow sink while grounded, the flight height in the
   *  air. Telegraphs / fx use it. */
  groundY = 0;

  // --- terrain (world/terrainMotion.ts): vertical state, snow sink, the surface under the bot last frame
  readonly vert = makeVert();
  /** Smoothed sink into the snow (m, the old groundY). */
  sink = 0;
  /** Last frame's sink change (terrainMotion.followRide caps the next one from it). */
  sinkStep = 0;
  mat: GroundMaterial = 'snow';
  gx = 0;
  gz = 0;
  /** 0..1 on ice (blends out after leaving it) and the drifting heading velocity it lags behind. */
  ice = 0;
  ivx = 0;
  ivz = 0;
  /** Lava: seconds until the next burn flash / sizzle. */
  burnT = 0;
  get airborne(): boolean {
    return this.vert.airborne;
  }
  get vy(): number {
    return this.vert.vy;
  }
  get deck(): number {
    return this.vert.deck;
  }

  // --- AI
  state = 'idle';
  stateT = 0;
  stateDur = 1;
  cd = 1;
  cd2 = 0;
  cd3 = 0;
  token = false;
  thiefToken = false;
  /** Gunner holds an aim slot (Host.tryVolley). */
  volley = false;
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
  /** Multiplier on damage taken (THE DONALD's RALLY: 0.4). */
  dmgTakenMult = 1;
  /** Fraction of damage taken that is reflected at the plow (GOLD PLATED); queued in reflectPool. */
  reflect = 0;
  reflectPool = 0;
  /** Buffs (RALLY minions): multipliers on outgoing hit damage and desired speed. */
  dmgOutMult = 1;
  spdMult = 1;
  /** THE CHAIRMAN's HOSTILE TAKEOVER on an echo: a separate multiplier on damage taken (gold armour), so the echo's
   *  own moves (THE DONALD's rally reset of dmgTakenMult) never clear it; `acquired` = seconds the buff has left. */
  guardMult = 1;
  acquired = 0;
  /** Ultimates deal it no damage (THE CHAIRMAN). */
  ultImmune = false;
  /** In a scripted sequence (THE CHAIRMAN's descent / defeat): its AI runs every frame (plow dead or not), takes no
   *  damage, no contact hits. */
  scripted = false;
  /** Refused damage while scripted shows this label (THE WHITEOUT's sealed eye: 'SEALED'); null = silent. */
  immuneLabel: string | null = null;
  /** HP never drops below this (0 = no floor): THE WHITEOUT's eye waits at its AVALANCHE share (the giant snowball finishes it). */
  hpFloor = 0;
  /** A fixed target (THE WHITEOUT's Storm Hearts and eye): no AI, never moves, pushed by nothing, off the boss leash;
   *  the plow bumps off it. Whoever owns it (core/whiteoutDirector.ts) moves it by hand. */
  fixed = false;
  /** PROTOCOL C finale: a SNOW COPY of a boss (an echo in a white hologram; bursts into powder, no boss toast). */
  snow = false;
  /** Visual offset of the rig from its (collision) position, world metres (the Chairman's descent from the box). */
  hoverX = 0;
  hoverY = 0;
  hoverZ = 0;

  // --- type specific
  ballVol = 0;
  ballR = 0;
  ballRoll = 0;
  carry = 0;
  stole = false;
  /** Summoned by a boss (phase adds): powers down when the last boss of the fight dies. */
  summoned = false;
  /** PROTOCOL C: an ECHO of a beaten boss (low HP, one or two signature moves, no phase 2 / summons; bosses.ts) or the
   *  wave's PROTOCOL-upgraded headline boss. */
  echo = false;
  headline = false;
  /** An echo's hologram material (hologram.ts; owned by the rig, disposed with it). */
  holo: THREE.ShaderMaterial | null = null;
  /** This frame a level route (EnemyManager.routeBoss) steers it, not its own AI. */
  routed = false;
  /** Boss leash (ZoneDef.maxActiveBosses): held back, circling at a distance instead of attacking; seconds in the
   *  current held / active stint. */
  held = false;
  leashT = 0;
  /** Mirror Plow: the move it is copying (MirrorMove) and the time of the last player cue it took. */
  mimic = 0;
  cueSeen = -1;
  /** Magnet Tower: legs down (pinned, pulling / fencing). */
  anchored = false;
  /** Tether Twins: the paired twin; this one is a downed HUSK (wrecked, waiting for a revive); the revive channel (s);
   *  game time it went down. */
  partner: Bot | null = null;
  husk = false;
  channel = 0;
  downAt = -1;

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

  /** HUD / toast name: ECHO <NAME> for echoes. */
  get displayName(): string {
    return this.snow ? `SNOW ${this.def.name}` : this.echo ? `ECHO ${this.def.name}` : this.def.name;
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
  /** Ranged aim slot (at most GUNNER_MAX_AIMING gunners aim at once); releaseToken frees it too. */
  tryVolley(e: Bot): boolean;
  /** Fire a gunner snowball bolt from (x, y, z) along the unit direction (dx, dz) (Enemies.ts bolt pool). */
  shoot(e: Bot, x: number, y: number, z: number, dx: number, dz: number): void;
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
  /** The player's last copyable move (MirrorMove, 0 = none yet) and the game time it was used (Mirror Plow). */
  readonly cueMove: number;
  readonly cueT: number;
  /** Drag the plow toward (dirX, dirZ) at `frac` of its own top speed this frame (Plow.tow; heavy plows resist). */
  towPlow(dirX: number, dirZ: number, frac: number, dt: number): void;
  /** Wreck `e` now (a scripted end: THE CHAIRMAN's defeat sequence), with the usual kill events. */
  wreck(e: Bot): void;
  /** Revive a downed twin husk at `hpFrac` of its max HP. */
  revive(e: Bot, hpFrac: number): void;
}

/** Mirror Plow moves (Bot.mimic / Host.cueMove). */
export const MirrorMove = { None: 0, Dash: 1, Ring: 2, Beam: 3, Cone: 4 } as const;
