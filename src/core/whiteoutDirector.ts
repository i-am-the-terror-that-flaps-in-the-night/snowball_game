import * as THREE from 'three';
import type { EnemyHandle, GameContext } from './types';
import { ARENA } from './types';
import type { Bot } from '../entities/enemies/Bot';
import { snowHologram } from '../entities/enemies/hologram';
import { STORMHEART_TIP_Y } from '../entities/enemies/models';
import { whiteoutProps } from '../entities/enemies/whiteoutProps';
import { whiteoutGiant } from '../world/protocol/WhiteoutGiant';
import { whiteoutEnding } from '../world/protocol/WhiteoutEnding';
import { GiantSnowball } from '../entities/GiantSnowball';
import { BOARDROOM } from '../world/environment/ProtocolScenery';
import { HARD } from '../config/challenges';
import { homeZone, protocolBossHp } from '../config/protocol';
import {
  AV, END, END_AT, HEART_SPOTS, COPY_TYPES, EYE_DOWN, EYE_HIGH, WO, angerFrom, byAnger, copyCap, eyeDamageMult, heartsForCycle, pickAttack, pickHeartSpots, shardCount,
  type EyeState, type WhiteoutAttack,
} from '../config/whiteout';

/**
 * THE WHITEOUT (PROTOCOL C finale; config/whiteout.ts has the agreed rules and every number). Started by THE CHAIRMAN's
 * wreck (core/chairmanDirector.ts onChairmanDefeated -> start()) or a FINALE checkpoint retry (Game.startProtocol(8)).
 * Wave 7 stays one round: while this runs (`holding`) Game does not clear the round, so there is no victory until THE
 * IMPLOSION has played out ('over': the round's, and the run's, existing PROTOCOL C victory follows).
 *
 * Phases:
 *  - 'takeover' (scripted, ~7.6 s): the boardroom's roof tears off into the storm, the sky goes black (world.whiteoutSky +
 *    the gale), the echoes freeze into snow statues and shatter, the giant rises behind the north stand (a camera shot
 *    looks up at it), its eye opens with a roar: the boss card, the EYE bot (its boss bar), the FINALE checkpoint.
 *  - 'hearts': STORM HEARTS (3 / 4 / 5 a cycle) beam to the giant; every Heart broken makes it ANGRIER (anger feeds every
 *    attack). The attacks: shard rain / vortex arm / glare one at a time, gusts and snow copies on their own timers.
 *    The eye opens now and then (chip).
 *  - 'lean' -> 'stagger' -> 'recover': the last Heart down: the giant leans over the stand, its eye crashes onto the
 *    stand front (STAGGER_T s wide open: full + bonus damage), then it rises again and the next cycle's Hearts form.
 *  - At WO.AVALANCHE_AT of the eye's HP (any phase): 'avalanche' (startAvalanche): the storm dumps deep snow
 *    (SnowField.dump), the eye comes down onto the stand front for good (sealed to everything but the ball), a GIANT
 *    SNOWBALL forms (entities/GiantSnowball.ts): any plow pushes it, it grows rolling through snow; gusts and shard rain
 *    keep coming (a shard chips the ball). Into the eye at full size -> 'ending'; too small -> it bursts, a new one forms.
 *  - 'ending' (THE IMPLOSION, config/whiteout.ts END): the eye cracks, the whole storm is sucked into it, it implodes,
 *    a shockwave of snow buries the stands to the brim, silence, then the crowd's phone lights pop back on one by one
 *    with cheering (it stays night) -> 'over'.
 * Gameplay timers run on the sim clock (update(dt)); the camera on real time. No per-frame allocation.
 */
export type WhiteoutPhase = 'off' | 'takeover' | 'hearts' | 'lean' | 'stagger' | 'recover' | 'avalanche' | 'ending' | 'over';

/** Look-up tilt of the follow camera while the giant is up (rad): a little always, more while it faces the giant (the
 *  follow camera pitches ~28 deg down: untilted, the giant would sit under the HUD's top edge). */
const CAM_TILT = 0.04;
const CAM_TILT_NORTH = 0.15;
/** The rise shot: a slow dolly from SHOT_A to SHOT_B, looking up at the giant. */
const SHOT_A = new THREE.Vector3(9, 1.8, -4);
const SHOT_B = new THREE.Vector3(4, 2.6, -14);
const SHOT_LOOK = new THREE.Vector3(0, 18, -56);
const SHOT_IN = 1.0;
const SHOT_OUT = 1.1;
/** Where snow copies form (well inside the walls, away from the plow). */
const COPY_SPOTS: readonly { x: number; z: number }[] = [
  { x: 0, z: -22 }, { x: -20, z: -18 }, { x: 20, z: -18 }, { x: -22, z: 12 }, { x: 22, z: 12 }, { x: 0, z: 22 },
];

const _pose = new THREE.PerspectiveCamera();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _tilt = new THREE.Quaternion();
const _x = new THREE.Vector3(1, 0, 0);
const _v = new THREE.Vector3();
const _l = new THREE.Vector3();
const _spot = { x: 0, z: 0 };
const _dist = [0, 0, 0, 0];
/** THE IMPLOSION's camera keyframes (s from its start, camera position, look-at point). */
const key = (t: number, x: number, y: number, z: number, lx: number, ly: number, lz: number) => ({ t, pos: new THREE.Vector3(x, y, z), look: new THREE.Vector3(lx, ly, lz) });
const END_KEYS = [
  key(0, 8, 4.5, -6, 0, 6, -32),
  key(END_AT.suck, 5, 5, -12, 0, 6.5, -32),
  key(END_AT.suck + 1.2, 0, 7, 6, 0, 13, -40),
  key(END_AT.implode - 0.1, 0, 15, 17, 0, 4, -30),
  key(END_AT.implode + 0.9, 0, 18, 23, 0, 2, -22),
  key(END_AT.silence, 0, 17, 24, 0, 2, -20),
  // (close over the north drift: from mid-arena the phone lights on the drift tops read as a thin band)
  key(END_AT.lights, -10, 9, -21, 6, 6.2, -38),
  key(END_AT.done + 4, 10, 9.5, -20, -6, 6.2, -38),
]

function smooth(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

export class WhiteoutDirector {
  phase: WhiteoutPhase = 'off';
  /** Seconds into the current phase. */
  t = 0;
  /** Heart cycle (0-based) and the Hearts broken so far (the escalation). */
  cycle = 0;
  broken = 0;
  readonly hearts: Bot[] = [];
  /** Per Heart: its break was handled. */
  private gone: boolean[] = [];
  eye: Bot | null = null;
  private statues: Bot[] = [];
  private shattered = 0;
  private roared = false;
  /** Main attack: seconds to the next, the last one; a pending second vortex lane. */
  private attackT = 0;
  private last: WhiteoutAttack | null = null;
  private secondT = -1;
  private gustT = 0;
  private copyT = 0;
  /** Eye between staggers: open now, seconds left in this open / closed stint. */
  private eyeOpen = false;
  private eyeT = 0;
  private eyeState: EyeState = 'sealed';
  /** Camera: the rise shot's weight and the look-up tilt's. */
  private shotW = 0;
  private tiltW = 0;
  private northK = 0;
  private readonly copies: Bot[] = [];
  private readonly spots: { x: number; z: number }[] = [];
  /** Lines and events (tests / probes; capped). */
  readonly log: string[] = [];
  /** FINALE checkpoint hook (Game: take the wave-8 checkpoint when the eye opens). */
  onCheckpoint: (() => void) | null = null;
  /** THE AVALANCHE's giant snowball. */
  readonly ball: GiantSnowball;
  private readonly hud = { frac: 0, full: false, forming: true, bursts: 0 };
  /** THE AVALANCHE: snow dumped so far (m); next shard volley / gust (s); the eye has landed. */
  private dumped = 0;
  private avShardT = 0;
  private avGustT = 0;
  private landed = false;
  private volleys = 0;
  /** The giant's lean when THE AVALANCHE began (the eye comes down from there). */
  private lean0 = 0;
  /** THE IMPLOSION: beats done (bit flags), snow laid by the shockwave so far (m), the camera's shot weight. */
  private beats = 0;
  private waveSnow = 0;
  private endW = 0;
  private crackT = 0;

  private readonly spawnAt = (out: { x: number; z: number }): void => this.ballSpot(out);

  constructor(private readonly ctx: GameContext) {
    this.ball = new GiantSnowball(ctx);
    this.ball.onHit = (full) => this.ballHit(full);
    ctx.events.on('enemyHit', ({ enemy }) => {
      if (enemy === this.eye && this.phase !== 'off') whiteoutGiant.flash(this.eyeState === 'stagger' ? 1 : 0.6);
    });
  }

  get active(): boolean {
    return this.phase !== 'off';
  }
  /** The round must not clear (Game.tick): the fight (THE AVALANCHE and THE IMPLOSION included) is not over. */
  get holding(): boolean {
    return this.phase !== 'off' && this.phase !== 'over';
  }
  /** THE AVALANCHE's ball for the HUD meter (null outside it): 0..1 of the way to full size, full, bursts so far. */
  get ballHud(): { frac: number; full: boolean; forming: boolean; bursts: number } | null {
    if (this.phase !== 'avalanche' || this.t < AV.BALL_AT) return null;
    const b = this.ball;
    const h = this.hud;
    h.frac = b.active ? b.frac : 0;
    h.full = b.active && b.full;
    h.forming = !b.active || b.forming > 0;
    h.bursts = b.bursts;
    return h;
  }
  /** Escalation 0..1. */
  get anger(): number {
    return angerFrom(this.broken);
  }
  /** The EYE's damage state right now. */
  get eyeMode(): EyeState {
    return this.eyeState;
  }

  /** THE WHITEOUT begins: `statues` = the echoes still standing (frozen into snow, then shattered); `retry` = a FINALE
   *  checkpoint retry (no Chairman wreck to clear up). */
  start(statues: readonly EnemyHandle[] = [], retry = false): void {
    const ctx = this.ctx;
    this.end();
    this.phase = 'takeover';
    this.t = 0;
    this.cycle = 0;
    this.broken = 0;
    this.roared = false;
    this.shattered = 0;
    this.statues.length = 0;
    for (const s of statues) {
      const b = s as Bot;
      if (!b.alive) continue;
      this.statues.push(b);
      // frozen solid: a fixed snow statue (no AI, off the leash, solid), no damage, white under an ice crust
      b.fixed = true;
      b.held = false;
      b.freeze = 99;
      b.dmgTakenMult = 0;
      b.windup = b.glow = b.jitter = 0;
      b.endAtk?.();
      (ctx.enemies as { clearTele?(e: Bot): void }).clearTele?.(b);
      if (b.holo) snowHologram(b.holo);
    }
    whiteoutProps.prewarm(ctx.scene);
    whiteoutProps.clear();
    whiteoutGiant.prewarm(ctx.scene);
    whiteoutGiant.show(true);
    whiteoutGiant.rise = 0;
    this.ball.prewarm(ctx.scene);
    whiteoutEnding.prewarm(ctx.scene);
    ctx.world.boardroom?.('gone');
    if (!retry) this.roofTears();
    ctx.audio?.play('thunder', { volume: 1 });
    ctx.fx.shake(0.9);
    this.note(retry ? 'start:retry' : 'start');
  }

  /** Leaving (any arena start / the menu): everything off. */
  end(): void {
    if (this.phase === 'off') return;
    this.phase = 'off';
    whiteoutProps.clear();
    whiteoutProps.onShardLand = null;
    whiteoutGiant.show(false);
    whiteoutEnding.show(false);
    this.ball.end();
    if (this.ctx.plow) this.ctx.plow.cinematic = false;
    this.ctx.world.whiteoutSky?.(0);
    this.ctx.world.whiteoutBury?.(0);
    this.hearts.length = 0;
    this.copies.length = 0;
    this.statues.length = 0;
    this.eye = null;
    this.shotW = this.tiltW = this.endW = 0;
    this.secondT = -1;
  }

  /** Sim tick (Game.tick, while playing / wrecked). */
  update(dt: number): void {
    if (this.phase === 'off') return;
    const ctx = this.ctx;
    this.t += dt;
    switch (this.phase) {
      case 'takeover':
        this.takeover();
        break;
      case 'hearts':
        this.heartsPhase(dt);
        break;
      case 'lean': {
        const k = Math.min(1, this.t / WO.LEAN_T);
        whiteoutGiant.lean = k;
        this.placeEye(k);
        if (this.t >= WO.LEAN_T) this.crash();
        break;
      }
      case 'stagger':
        whiteoutGiant.lean = 1;
        whiteoutGiant.pupil = 1;
        if (this.t >= WO.STAGGER_T) this.recover();
        break;
      case 'recover': {
        const k = 1 - Math.min(1, this.t / WO.RECOVER_T);
        whiteoutGiant.lean = k;
        this.placeEye(k);
        if (this.t >= WO.RECOVER_T) this.nextCycle();
        break;
      }
      case 'avalanche':
        this.avalanche(dt);
        break;
      case 'ending':
        this.ending(dt);
        break;
      case 'over':
        break;
    }
    if (this.phase === 'hearts' || this.phase === 'lean' || this.phase === 'stagger' || this.phase === 'recover') this.checkAvalanche();
    if (this.phase === 'ending' || this.phase === 'over') {
      whiteoutGiant.glare = 0;
    } else {
      whiteoutGiant.anger = this.phase === 'stagger' ? 0.15 : Math.max(whiteoutGiant.anger - dt * 0.5, this.phase === 'avalanche' ? 0.85 : this.anger);
      whiteoutProps.update(ctx, dt);
      whiteoutGiant.glare = Math.max(0, whiteoutProps.glaring);
      this.applyEye();
    }
    whiteoutGiant.update(dt, ctx.camera, ctx.renderer?.domElement?.height ?? 900);
  }

  /** After CameraRig.update (Game.tick): the rise shot over the follow camera, then a gentle look-up while it stands. */
  camera(dt: number): void {
    if (this.phase === 'off') return;
    const cam = this.ctx.camera;
    // THE IMPLOSION's visuals run on real time (they keep twinkling behind the results screen)
    whiteoutEnding.update(dt, cam, this.ctx.renderer?.domElement?.height ?? 900);
    if (this.phase === 'ending' || this.phase === 'over') {
      this.endingShot(dt);
      return;
    }
    const inShot = this.phase === 'takeover' && this.t >= WO.RISE_AT - 0.3 && this.t < WO.HEARTS_AT - SHOT_OUT * 0.5;
    this.shotW = inShot ? Math.min(1, this.shotW + dt / SHOT_IN) : Math.max(0, this.shotW - dt / SHOT_OUT);
    const tiltOn = this.phase !== 'avalanche' && whiteoutGiant.rise > 0.6;
    this.tiltW = tiltOn ? Math.min(1, this.tiltW + dt / 1.5) : Math.max(0, this.tiltW - dt / 1.5);
    // facing the giant (north) more tilt: the eye and shoulders come into frame below the HUD
    _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const north = Math.max(0, -_v.z / Math.max(1e-3, Math.hypot(_v.x, _v.z)));
    this.northK += (north - this.northK) * Math.min(1, dt * 3);
    if (this.tiltW > 0) {
      _tilt.setFromAxisAngle(_x, (CAM_TILT + CAM_TILT_NORTH * this.northK) * this.tiltW * (1 - this.shotW));
      cam.quaternion.multiply(_tilt);
    }
    if (this.shotW > 0) {
      const w = this.shotW * this.shotW * (3 - 2 * this.shotW);
      const u = Math.max(0, Math.min(1, (this.t - WO.RISE_AT + 0.3) / (WO.HEARTS_AT - WO.RISE_AT)));
      _p.copy(SHOT_A).lerp(SHOT_B, u * u * (3 - 2 * u));
      _pose.position.copy(_p);
      _pose.lookAt(SHOT_LOOK);
      _q.copy(cam.quaternion).slerp(_pose.quaternion, w);
      cam.position.lerp(_p, w);
      cam.quaternion.copy(_q);
    }
    cam.updateMatrixWorld();
  }

  /**
   * THE AVALANCHE (at WO.AVALANCHE_AT of the eye's HP): the Hearts and copies power down, the storm dumps deep snow
   * (SnowField.dump over AV.DUMP_T s), the eye comes down onto the north stand front for good (sealed: only the ball
   * can finish it) and a GIANT SNOWBALL forms. Gusts and shard volleys keep coming (they push / chip the ball).
   */
  startAvalanche(): void {
    if (this.phase === 'avalanche' || this.phase === 'off' || this.phase === 'ending' || this.phase === 'over') return;
    const ctx = this.ctx;
    this.phase = 'avalanche';
    this.t = 0;
    this.dumped = 0;
    this.landed = false;
    this.volleys = 0;
    // (from wherever the eye is: THE AVALANCHE usually starts in a STAGGER, the eye already on the stand front)
    this.lean0 = Math.max(0, Math.min(1, whiteoutGiant.lean));
    this.landed = this.lean0 >= 0.999;
    this.avShardT = AV.BALL_AT + 3;
    this.avGustT = AV.BALL_AT + 5;
    whiteoutProps.calm();
    whiteoutGiant.clearBeams();
    whiteoutGiant.open = 1;
    whiteoutGiant.lightning(1);
    const mgr = ctx.enemies;
    for (const b of [...this.hearts, ...this.copies]) if (b.alive) mgr.dismiss?.(b, 0xdff4ff);
    this.hearts.length = 0;
    this.copies.length = 0;
    const eye = this.eye;
    if (eye?.alive) {
      eye.immuneLabel = 'ONLY THE AVALANCHE!';
      eye.hpFloor = eye.maxHp * WO.AVALANCHE_AT;
    }
    this.ball.prewarm(ctx.scene);
    this.ball.begin();
    this.ball.target = { x: EYE_DOWN.x, z: EYE_DOWN.z, r: eye?.radius ?? 3.4 };
    whiteoutProps.onShardLand = (x, z) => this.ball.chip(x, z);
    ctx.fx.shake(1.2);
    ctx.audio?.play('roar', { volume: 1, pitch: 0.55 });
    ctx.audio?.play('thunder', { volume: 1 });
    ctx.ui.bossIntro('THE AVALANCHE', 'ROLL A GIANT SNOWBALL INTO THE EYE');
    this.note('avalanche');
  }

  private avalanche(dt: number): void {
    const ctx = this.ctx;
    const t = this.t;
    // the storm dumps its snow
    const want = AV.DUMP * Math.min(1, t / AV.DUMP_T);
    if (want - this.dumped >= 0.05 || (want >= AV.DUMP && this.dumped < AV.DUMP)) {
      ctx.snow.dump?.(want - this.dumped);
      this.dumped = want;
      ctx.world.whiteoutBury?.(want / AV.DUMP);
    }
    if (t < AV.DUMP_T && Math.random() < dt * 14) {
      // heavy clumps thumping down across the arena
      const lim = ARENA.maxX - 3;
      _v.set((Math.random() * 2 - 1) * lim, 0, (Math.random() * 2 - 1) * lim);
      _v.y = ctx.snow.topAt?.(_v.x, _v.z) ?? 0.5;
      ctx.fx.powder(_v, { size: 1.2 + Math.random(), color: 0xf2f8ff });
    }
    // the eye comes down onto the stand front, and stays
    const k = this.lean0 + (1 - this.lean0) * Math.min(1, t / AV.DESCEND_T);
    whiteoutGiant.lean = k;
    whiteoutGiant.pupil = k;
    whiteoutGiant.open = 1;
    this.placeEye(k);
    if (!this.landed && k >= 1) {
      this.landed = true;
      whiteoutGiant.eyePos(_v);
      _v.y = 0.6;
      ctx.fx.powder(_v, { size: 4, color: 0xeaf6ff });
      ctx.fx.ring(_v, 12, 0x9fe0ff);
      ctx.fx.burst(_v, CRASH_BURST);
      ctx.fx.shake(1.3);
      ctx.audio?.play('explosion', { volume: 1, pitch: 0.55 });
    }
    // the ball
    if (t >= AV.BALL_AT && !this.ball.active && this.ball.respawnT < 0 && this.ball.bursts === 0 && this.ball.rolled === 0) {
      this.ballSpot(_spot);
      this.ball.spawn(_spot.x, _spot.z);
      ctx.ui.toast('PUSH THE SNOWBALL! IT GROWS IN THE SNOW', 'big');
    }
    // gusts shove it; the storm keeps raining shards on it
    const g = whiteoutProps.gustInfo;
    if (g && g.wait <= 0 && g.t > 0) {
      const a = g.frac * (ctx.stats?.maxSpeed ?? 12) * AV.GUST;
      this.ball.wind.x = g.dx * a;
      this.ball.wind.z = g.dz * a;
    } else this.ball.wind.x = this.ball.wind.z = 0;
    this.ball.update(dt, this.spawnAt);
    if (this.phase !== 'avalanche') return;
    this.avGustT -= dt;
    if (this.avGustT <= 0 && !whiteoutProps.gustInfo) {
      this.gust(0.5);
      this.avGustT = WO.GUST_TELE + WO.GUST_T + AV.GUST_GAP;
    }
    this.avShardT -= dt;
    if (this.avShardT <= 0) {
      this.avShardT = AV.SHARD_GAP;
      this.avalancheShards();
    }
  }

  /** A shard volley in THE AVALANCHE: one ring on the ball's path, the rest round the plow. */
  private avalancheShards(): void {
    const ctx = this.ctx;
    const eye = this.eye;
    if (!eye) return;
    const b = this.ball;
    const tele = WO.SHARD_TELE[0];
    const lim = ARENA.maxX - 2.5;
    let n = 0;
    // every other volley: one on the ball's path once it has some size to lose (a fresh ball is left alone)
    this.volleys++;
    if (b.active && b.r > AV.START_R + 0.4 && this.volleys % 2 === 0) {
      const x = Math.max(-lim, Math.min(lim, b.x + b.vx * tele * 0.8));
      const z = Math.max(-lim, Math.min(lim, b.z + b.vz * tele * 0.8));
      if (whiteoutProps.shard(ctx, eye, x, z, tele, WO.SHARD_DMG)) n++;
    }
    const p = ctx.plow.position;
    for (let i = 0; n < AV.SHARDS && i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 9;
      const x = Math.max(-lim, Math.min(lim, p.x + Math.sin(a) * r));
      const z = Math.max(-lim, Math.min(lim, p.z + Math.cos(a) * r));
      if (b.active && Math.hypot(x - b.x, z - b.z) < b.r + WO.SHARD_R + 1) continue;
      if (whiteoutProps.shard(ctx, eye, x, z, tele + n * WO.SHARD_STEP, WO.SHARD_DMG)) n++;
    }
  }

  /** Where a ball forms: a Heart spot (off the lava and the decks) clear of the plow but close, ahead of it (in view),
   *  away from the eye. */
  private ballSpot(out: { x: number; z: number }): void {
    const plow = this.ctx.plow;
    const p = plow.position;
    const fx = Math.sin(plow.heading);
    const fz = Math.cos(plow.heading);
    let best = HEART_SPOTS[0];
    let bs = Infinity;
    for (const s of HEART_SPOTS) {
      const dx = s.x - p.x;
      const dz = s.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 6 || s.z < -12) continue;
      const ahead = (dx * fx + dz * fz) / d;
      const score = Math.abs(d - 10) + (1 - ahead) * 8;
      if (score < bs) {
        bs = score;
        best = s;
      }
    }
    out.x = best.x;
    out.z = best.z;
  }

  /** The ball reached the eye: full size = THE IMPLOSION; too small = it bursts (GiantSnowball does that). */
  private ballHit(full: boolean): void {
    const ctx = this.ctx;
    if (this.phase !== 'avalanche') return;
    if (!full) {
      whiteoutGiant.flash(0.5);
      ctx.audio?.play('roar', { volume: 0.8, pitch: 0.75 });
      _v.set(EYE_DOWN.x, 6, EYE_DOWN.z + 2);
      ctx.fx.floatText(_v, 'NOT BIG ENOUGH! ROLL IT BIGGER', '#9fe0ff', 1.15);
      this.note('ball:small');
      return;
    }
    this.beginEnding();
  }

  /* ------------------------------------------------------------------ THE IMPLOSION */

  private beginEnding(): void {
    const ctx = this.ctx;
    this.phase = 'ending';
    this.t = 0;
    this.beats = 0;
    this.waveSnow = 0;
    this.crackT = 0;
    whiteoutProps.clear();
    whiteoutProps.onShardLand = null;
    // the ball slams into the eye and is swallowed by it
    const b = this.ball;
    _v.set(b.x, b.y, b.z);
    ctx.fx.powder(_v, { size: 5, color: 0xf2f8ff });
    ctx.fx.burst(_v, SWALLOW_PUFF);
    b.hide();
    whiteoutGiant.flash(1);
    whiteoutGiant.lightning(1);
    whiteoutGiant.pupil = 1;
    whiteoutGiant.lean = 1;
    whiteoutGiant.eyePos(whiteoutEnding.point);
    whiteoutEnding.prewarm(ctx.scene);
    whiteoutEnding.show(true);
    whiteoutEnding.lightSpan = END.LIGHTS_T;
    whiteoutGiant.eyePos(whiteoutEnding.point);
    const eye = this.eye;
    if (eye?.alive) ctx.enemies.dismiss?.(eye, 0xdff4ff);
    this.eye = null;
    ctx.plow.cinematic = true;
    ctx.ui.setHudVisible?.(false);
    ctx.impact.hit('bossKill', _v, 1.4);
    ctx.fx.shake(1.6);
    ctx.audio?.play('explosion', { volume: 1, pitch: 0.5 });
    ctx.audio?.play('roar', { volume: 1, pitch: 0.4 });
    this.note('ending');
  }

  private ending(dt: number): void {
    const ctx = this.ctx;
    const t = this.t;
    const A = END_AT;
    // 1. the eye cracks: white light through the cracks, the giant convulses
    whiteoutGiant.crack = Math.min(1, t / END.CRACK_T);
    whiteoutGiant.pupil = 1;
    whiteoutGiant.open = 1;
    if (t < A.implode) {
      this.crackT -= dt;
      if (this.crackT <= 0) {
        this.crackT = t < A.suck ? 0.28 + Math.random() * 0.2 : 0.18;
        ctx.audio?.play('clash', { volume: 0.7, pitch: 1.6 + Math.random() * 0.6 });
        whiteoutGiant.lightning(0.9);
        whiteoutGiant.flash(0.35);
        ctx.fx.shake(0.25 + 0.4 * Math.min(1, t / A.implode));
      }
    }
    // 2. the whole storm is sucked into it (wind reversing: everything streams into one point)
    if (t >= A.suck && !(this.beats & 1)) {
      this.beats |= 1;
      ctx.world.whiteoutSky?.(1, false);
      ctx.audio?.play('whirl', { volume: 1, pitch: 0.4 });
      ctx.audio?.play('charge', { volume: 0.9, pitch: 0.45 });
      this.note('suck');
    }
    if (t >= A.suck && t < A.implode) {
      const k = Math.min(1, (t - A.suck) / END.SUCK_T);
      whiteoutGiant.collapse = k;
      whiteoutEnding.suck = k;
      whiteoutEnding.coreSize = 1.5 + 9 * k;
      whiteoutEnding.coreGlow = Math.min(1, k * 1.6);
      if (k >= 1) {
        // the held breath: the point shrinks to a pinprick
        const h = Math.min(1, (t - A.suck - END.SUCK_T) / END.HOLD_T);
        whiteoutEnding.coreSize = 10.5 * (1 - h) + 1.2 * h;
        whiteoutGiant.collapse = 1;
      }
      if (Math.random() < dt * (2 + k * 6)) ctx.audio?.play('whirl', { volume: 0.6 + k * 0.4, pitch: 0.4 + k * 0.6 });
    }
    // 3. IMPLOSION: a flash, the giant is gone, the shockwave of snow blasts out over everything
    if (t >= A.implode && !(this.beats & 2)) {
      this.beats |= 2;
      whiteoutGiant.show(false);
      whiteoutEnding.suck = 2;
      _v.copy(whiteoutEnding.point);
      ctx.impact.hit('nuke', _v, 1.2, { stop: false });
      ctx.fx.shake(2);
      ctx.fx.powder(_v.setY(0.6), { size: 6, color: 0xffffff });
      ctx.audio?.play('explosion', { volume: 1, pitch: 0.35 });
      ctx.audio?.play('thunder', { volume: 1 });
      ctx.audio?.play('shockwave', { volume: 1, pitch: 0.5 });
      ctx.audio?.setAmbience?.('none');
      this.note('implode');
    }
    if (t >= A.implode) {
      const u = (t - A.implode) / END.WAVE_T;
      // the flash: huge, then gone
      const f = Math.max(0, 1 - (t - A.implode) / 0.7);
      whiteoutEnding.coreSize = 24 + 90 * (1 - f);
      whiteoutEnding.coreGlow = f * f;
      const w = Math.min(1, u);
      const we = 1 - (1 - w) * (1 - w);
      whiteoutEnding.waveR = 2 + 82 * we;
      whiteoutEnding.waveH = 12 - 6 * we;
      whiteoutEnding.waveA = u < 1 ? Math.min(1, u * 8) * (1 - Math.max(0, (u - 0.6) / 0.4)) : 0;
      // the stands are buried as the wave reaches each one (the north stand at once, the south last)
      const r = whiteoutEnding.waveR;
      const P = whiteoutEnding.point;
      const dist = _dist;
      dist[0] = Math.max(0, P.z - ARENA.minZ);
      dist[1] = ARENA.maxZ - P.z;
      dist[2] = P.x - ARENA.minX;
      dist[3] = ARENA.maxX - P.x;
      for (let i = 0; i < 4; i++) {
        const k = Math.max(0, Math.min(1, (r - dist[i]) / 9));
        const was = whiteoutEnding.buried(i);
        if (k > was) {
          whiteoutEnding.bury(i, k);
          if (was === 0) {
            ctx.audio?.play('burst', { volume: 1, pitch: 0.45 + i * 0.05 });
            ctx.fx.shake(0.8);
          }
          if (Math.random() < dt * 30) this.standPuff(i);
        }
      }
      // ... and the arena under a fresh layer; the storm sky clears to the night
      const lay = END.WAVE_SNOW * w;
      if (lay - this.waveSnow >= 0.07 || (w >= 1 && this.waveSnow < END.WAVE_SNOW)) {
        ctx.snow.dump?.(lay - this.waveSnow);
        this.waveSnow = lay;
      }
      ctx.world.whiteoutSky?.(Math.max(0, 1 - Math.min(1, (t - A.implode) / (END.WAVE_T + END.SILENCE_T * 0.6))), false);
    }
    // 4. silence (the ambience stopped at the implosion): the words land in it; 5. the phone lights, one by one, and the
    // cheering
    if (t >= A.silence + 0.2 && !(this.beats & 32)) {
      this.beats |= 32;
      ctx.ui.toast('THE STORM IS BROKEN', 'big');
    }
    if (t >= A.lights) {
      const k = (t - A.lights) / END.LIGHTS_T;
      whiteoutEnding.lights = Math.min(1.05, k);
      if (!(this.beats & 4)) {
        this.beats |= 4;
        ctx.audio?.play('cheer', { volume: 0.35, pitch: 1 });
        this.note('lights');
      }
      if (k >= 0.35 && !(this.beats & 8)) {
        this.beats |= 8;
        ctx.audio?.play('cheer', { volume: 1, pitch: 1 });
        ctx.audio?.setAmbience?.('crowd');
      }
      if (k >= 0.75 && !(this.beats & 16)) {
        this.beats |= 16;
        ctx.audio?.play('cheer', { volume: 1, pitch: 1.1 });
      }
    }
    if (t >= A.done) {
      this.phase = 'over';
      whiteoutEnding.lights = 1.05;
      ctx.plow.cinematic = false;
      this.note('over');
    }
  }

  /** Powder thrown up along side `i`'s stand as the snow wave buries it. */
  private standPuff(i: number): void {
    const s = (Math.random() * 2 - 1) * (ARENA.maxX + 4);
    const n = 3 + Math.random() * 8;
    if (i === 0) _v.set(s, 5, ARENA.minZ - n);
    else if (i === 1) _v.set(s, 5, ARENA.maxZ + n);
    else if (i === 2) _v.set(ARENA.minX - n, 5, s);
    else _v.set(ARENA.maxX + n, 5, s);
    this.ctx.fx.powder(_v, { size: 2.5 + Math.random() * 1.5, color: 0xf4f9ff });
  }

  /** The ending's camera (keyframes END_KEYS, eased between): close on the cracking eye, pulled back as the storm pours
   *  into it, up and back for the shockwave, then a slow wide drift over the buried stadium while the lights come on.
   *  Blended in over the follow camera. */
  private endingShot(dt: number): void {
    const cam = this.ctx.camera;
    this.endW = Math.min(1, this.endW + dt / 0.7);
    const t = this.t;
    const K = END_KEYS;
    let i = 0;
    while (i < K.length - 2 && t >= K[i + 1].t) i++;
    const a = K[i];
    const b = K[i + 1];
    const u = smooth((t - a.t) / Math.max(1e-3, b.t - a.t));
    _p.copy(a.pos).lerp(b.pos, u);
    _l.copy(a.look).lerp(b.look, u);
    _pose.position.copy(_p);
    _pose.lookAt(_l);
    const w = this.endW * this.endW * (3 - 2 * this.endW);
    _q.copy(cam.quaternion).slerp(_pose.quaternion, w);
    cam.position.lerp(_p, w);
    cam.quaternion.copy(_q);
    cam.updateMatrixWorld();
  }


  /* ------------------------------------------------------------------ phases */

  private takeover(): void {
    const ctx = this.ctx;
    const t = this.t;
    ctx.world.whiteoutSky?.(Math.min(1, t / WO.SKY_T));
    // the statues shatter one after another
    while (this.shattered < this.statues.length && t >= WO.STATUE_T + this.shattered * WO.STATUE_GAP) {
      const b = this.statues[this.shattered++];
      if (!b.alive) continue;
      _v.set(b.position.x, b.groundY + b.rig.height * 0.5, b.position.z);
      ctx.fx.powder(_v, { size: 1.6 + b.radius * 0.3, color: 0xeaf6ff });
      ctx.fx.burst(_v, STATUE_BURST);
      ctx.enemies.dismiss?.(b, 0xeaf6ff);
      ctx.audio?.play('clash', { volume: 0.8, pitch: 0.75 + this.shattered * 0.04 });
    }
    // the giant rises (rumbling, lightning in its body)
    const r = Math.max(0, Math.min(1, (t - WO.RISE_AT) / WO.RISE_T));
    whiteoutGiant.rise = r;
    if (r > 0 && r < 1 && Math.random() < 0.05) {
      whiteoutGiant.lightning(0.8);
      ctx.fx.shake(0.25);
    }
    if (!this.roared && t >= WO.ROAR_AT) {
      this.roared = true;
      whiteoutGiant.open = 1;
      whiteoutGiant.lightning(1);
      ctx.fx.shake(1.1);
      ctx.audio?.play('roar', { volume: 1, pitch: 0.5 });
      ctx.audio?.play('thunder', { volume: 1 });
      ctx.ui.bossIntro('THE WHITEOUT', 'PROTOCOL C · FINALE · BREAK THE STORM HEARTS');
      this.spawnEye();
      this.onCheckpoint?.();
      this.note('roar');
    }
    if (t >= WO.HEARTS_AT) {
      for (const b of this.statues) if (b.alive) this.ctx.enemies.dismiss?.(b, 0xeaf6ff);
      this.statues.length = 0;
      this.beginHearts();
    }
  }

  private beginHearts(): void {
    this.phase = 'hearts';
    this.t = 0;
    this.spawnHearts(heartsForCycle(this.cycle));
    this.attackT = WO.FIRST_ATTACK;
    this.last = null;
    this.secondT = -1;
    if (this.cycle === 0) {
      this.gustT = WO.FIRST_GUST;
      this.copyT = WO.FIRST_COPY;
    }
    this.eyeOpen = false;
    this.eyeT = WO.EYE_CLOSED_T * 0.6;
    this.note(`hearts:${this.hearts.length}`);
  }

  private heartsPhase(dt: number): void {
    const ctx = this.ctx;
    // Hearts: beams, pulse, the breaks
    let alive = 0;
    for (let i = 0; i < this.hearts.length; i++) {
      const h = this.hearts[i];
      if (h.alive) {
        alive++;
        h.glow = 0.4 + 0.4 * Math.sin(this.t * 4 + i * 1.7);
        whiteoutGiant.setBeam(i, h.position.x, h.groundY + STORMHEART_TIP_Y, h.position.z, 1);
      } else if (!this.gone[i]) {
        this.gone[i] = true;
        whiteoutGiant.setBeam(i, 0, 0, 0, 0);
        this.heartBroken(h);
      }
    }
    if (alive === 0) {
      this.beginLean();
      return;
    }
    // the eye opens now and then
    this.eyeT -= dt;
    if (this.eyeT <= 0) {
      this.eyeOpen = !this.eyeOpen;
      this.eyeT = this.eyeOpen ? WO.EYE_OPEN_T : WO.EYE_CLOSED_T;
      if (this.eyeOpen) ctx.fx.floatText(_v.set(EYE_HIGH.x, 7, ARENA.minZ - 1), 'THE EYE IS OPEN', '#9fe0ff', 1.1);
    }
    const a = this.anger;
    // main attacks, one at a time
    this.attackT -= dt;
    if (this.attackT <= 0) {
      const next = pickAttack(this.last, Math.random(), true);
      const dur = this.attack(next, a);
      this.last = next;
      this.attackT = dur + byAnger(WO.GAP, a);
    }
    if (this.secondT >= 0 && (this.secondT -= dt) < 0) this.sweep(a, 1);
    // gusts
    this.gustT -= dt;
    if (this.gustT <= 0 && !whiteoutProps.gustInfo) {
      this.gust(a);
      this.gustT = WO.GUST_TELE + WO.GUST_T + byAnger(WO.GUST_GAP, a);
    }
    // snow copies
    this.copyT -= dt;
    if (this.copyT <= 0) {
      this.copyT = byAnger(WO.COPY_GAP, a);
      let n = 0;
      for (const c of this.copies) if (c.alive) n++;
      if (n < copyCap(a)) this.spawnCopy();
    }
  }

  private heartBroken(h: Bot): void {
    const ctx = this.ctx;
    this.broken++;
    whiteoutGiant.lightning(1);
    ctx.fx.shake(0.6);
    ctx.audio?.play('roar', { volume: 0.9, pitch: 0.6 + this.anger * 0.15 });
    // the giant reels: a share of the eye's HP
    const eye = this.eye;
    if (eye?.alive) {
      eye.hp = Math.max(eye.hpFloor, eye.hp - eye.maxHp * WO.HEART_CHIP);
      eye.flash = 0.3;
    }
    _v.set(h.position.x, h.groundY + 5, h.position.z);
    const left = this.hearts.filter((b) => b.alive).length;
    ctx.fx.floatText(_v, left > 0 ? `HEART BROKEN · ${left} LEFT · IT GETS ANGRIER` : 'LAST HEART! IT STAGGERS!', left > 0 ? '#9fe0ff' : '#ffffff', 1.15);
    this.note(`broken:${this.broken}`);
  }

  private beginLean(): void {
    const ctx = this.ctx;
    this.phase = 'lean';
    this.t = 0;
    whiteoutProps.calm();
    this.secondT = -1;
    whiteoutGiant.clearBeams();
    whiteoutGiant.open = 1;
    // the storm's focus breaks: the snow copies collapse
    for (const c of this.copies) if (c.alive) (ctx.enemies as { wreck?(e: Bot): void }).wreck?.(c);
    this.copies.length = 0;
    ctx.audio?.play('roar', { volume: 1, pitch: 0.45 });
    this.note('lean');
  }

  private crash(): void {
    const ctx = this.ctx;
    this.phase = 'stagger';
    this.t = 0;
    whiteoutGiant.lean = 1;
    this.placeEye(1);
    whiteoutGiant.eyePos(_v);
    _v.y = 0.4;
    ctx.fx.powder(_v, { size: 4, color: 0xeaf6ff });
    ctx.fx.ring(_v, 12, 0x9fe0ff);
    ctx.fx.burst(_v, CRASH_BURST);
    ctx.fx.shake(1.5);
    ctx.impact.hit('pound', _v, 1, { stop: false });
    ctx.audio?.play('explosion', { volume: 1, pitch: 0.6 });
    ctx.ui.toast('STAGGERED! HIT THE EYE!', 'big');
    this.note('stagger');
  }

  private recover(): void {
    this.phase = 'recover';
    this.t = 0;
    whiteoutGiant.pupil = 0;
    this.ctx.audio?.play('roar', { volume: 0.9, pitch: 0.55 });
    this.note('recover');
  }

  private nextCycle(): void {
    this.cycle++;
    whiteoutGiant.lean = 0;
    this.placeEye(0);
    this.beginHearts();
  }

  private checkAvalanche(): void {
    const eye = this.eye;
    if (eye && eye.alive && eye.hp <= eye.hpFloor + 1e-3) this.startAvalanche();
  }

  /* ------------------------------------------------------------------ the eye */

  private spawnEye(): void {
    const ctx = this.ctx;
    const hpMult = ((ctx.zone.enemyHpMult ?? 1) * protocolBossHp('chairman', false) * WO.EYE_HP_K) / HARD.hpMult;
    const e = ctx.enemies.spawn('whiteout', EYE_HIGH.x, EYE_HIGH.z, { hpMult, noGate: true, heading: 0 }) as Bot;
    e.fixed = true;
    e.entering = false;
    e.immuneLabel = 'SEALED';
    e.hpFloor = e.maxHp * WO.AVALANCHE_AT;
    this.eye = e;
    this.eyeState = 'sealed';
    this.applyEye();
  }

  /** The eye bot between its high spot and the stand front (k 0..1). */
  private placeEye(k: number): void {
    const e = this.eye;
    if (!e) return;
    const u = k * k * (3 - 2 * k);
    e.position.x = EYE_HIGH.x + (EYE_DOWN.x - EYE_HIGH.x) * u;
    e.position.z = EYE_HIGH.z + (EYE_DOWN.z - EYE_HIGH.z) * u;
  }

  /** Eye state -> the bot's damage rules and the giant's lids. */
  private applyEye(): void {
    const glare = whiteoutProps.glareInfo !== null;
    let s: EyeState = 'sealed';
    if (this.phase === 'stagger') s = 'stagger';
    else if (this.phase === 'hearts' && (this.eyeOpen || glare)) s = 'open';
    this.eyeState = s;
    if (this.phase !== 'takeover') whiteoutGiant.open = s === 'sealed' && this.phase !== 'avalanche' ? 0 : 1;
    const e = this.eye;
    if (!e || !e.alive) return;
    e.scripted = s === 'sealed';
    e.dmgTakenMult = eyeDamageMult(s) || 1;
  }

  /* ------------------------------------------------------------------ attacks */

  /** Start a main attack; returns how long it occupies the giant (s). */
  private attack(a: WhiteoutAttack, anger: number): number {
    switch (a) {
      case 'shards':
        return this.shards(anger);
      case 'sweep': {
        const d = this.sweep(anger, 0);
        if (anger >= WO.DOUBLE_AT) this.secondT = WO.SWEEP_SECOND;
        return d + (anger >= WO.DOUBLE_AT ? WO.SWEEP_SECOND : 0);
      }
      case 'glare':
        return this.glare(anger);
    }
  }

  private shards(anger: number): number {
    const ctx = this.ctx;
    const eye = this.eye;
    if (!eye) return 1;
    const plow = ctx.plow;
    const n = shardCount(anger);
    const tele = byAnger(WO.SHARD_TELE, anger);
    const lim = ARENA.maxX - 2.5;
    const spots = this.spots;
    spots.length = 0;
    const tryAdd = (x: number, z: number): boolean => {
      x = Math.max(-lim, Math.min(lim, x));
      z = Math.max(-lim, Math.min(lim, z));
      for (const s of spots) if (Math.hypot(s.x - x, s.z - z) < WO.SHARD_SPACING) return false;
      spots.push({ x, z });
      return true;
    };
    tryAdd(plow.position.x, plow.position.z);
    // the plow's lead: where it will be when the shards land
    const sp = plow.speed;
    tryAdd(plow.position.x + Math.sin(plow.heading) * sp * tele, plow.position.z + Math.cos(plow.heading) * sp * tele);
    for (let tries = 0; spots.length < n && tries < n * 8; tries++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * WO.SHARD_SPREAD;
      tryAdd(plow.position.x + Math.sin(ang) * r, plow.position.z + Math.cos(ang) * r);
    }
    for (let i = 0; i < spots.length; i++) whiteoutProps.shard(ctx, eye, spots[i].x, spots[i].z, tele + i * WO.SHARD_STEP, WO.SHARD_DMG);
    this.note('shards');
    return tele + spots.length * WO.SHARD_STEP;
  }

  /** A vortex lane through (near) the plow, from the north side; arm 0 / 1 (the second lane). */
  private sweep(_anger: number, which: number): number {
    const ctx = this.ctx;
    const eye = this.eye;
    if (!eye) return 1;
    const plow = ctx.plow;
    const ang = (Math.random() - 0.5) * 1.3;
    const dx = Math.sin(ang);
    const dz = Math.cos(ang);
    const lim = ARENA.maxX - 1;
    const px = Math.max(-lim + 2, Math.min(lim - 2, plow.position.x + (Math.random() - 0.5) * 3));
    const pz = Math.max(-lim + 2, Math.min(lim - 2, plow.position.z));
    const back = wallT(px, pz, -dx, -dz, lim);
    const fwd = wallT(px, pz, dx, dz, lim);
    const x0 = px - dx * back;
    const z0 = pz - dz * back;
    const arm = which === 1 ? (x0 < 0 ? 1 : 0) : x0 < 0 ? 0 : 1;
    whiteoutProps.sweep(ctx, eye, arm, x0, z0, dx, dz, back + fwd, WO.SWEEP_TELE, WO.SWEEP_T, WO.SWEEP_DMG, WO.SWEEP_KNOCK);
    this.note('sweep');
    return WO.SWEEP_TELE + WO.SWEEP_T;
  }

  private glare(anger: number): number {
    const ctx = this.ctx;
    const eye = this.eye;
    if (!eye) return 1;
    const plow = ctx.plow;
    // the spot starts between the plow and the eye, ~9 m from the plow
    let dx = EYE_HIGH.x - plow.position.x;
    let dz = EYE_HIGH.z - plow.position.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl;
    dz /= dl;
    const lim = ARENA.maxX - 2;
    const sx = Math.max(-lim, Math.min(lim, plow.position.x + dx * 9));
    const sz = Math.max(-lim, Math.min(lim, plow.position.z + dz * 9));
    whiteoutProps.startGlare(ctx, eye, sx, sz, WO.GLARE_CHARGE, WO.GLARE_T, byAnger(WO.GLARE_SPEED, anger));
    ctx.audio?.play('charge', { volume: 0.8, pitch: 0.7 });
    this.note('glare');
    return WO.GLARE_CHARGE + WO.GLARE_T;
  }

  private gust(anger: number): void {
    const ang = Math.random() * Math.PI * 2;
    whiteoutProps.startGust(this.ctx, Math.sin(ang), Math.cos(ang), WO.GUST_TELE, WO.GUST_T, byAnger(WO.GUST_FRAC, anger));
    this.ctx.audio?.play('whirl', { volume: 0.7, pitch: 0.5 });
    this.note('gust');
  }

  private spawnCopy(): void {
    const ctx = this.ctx;
    const plow = ctx.plow;
    let best = COPY_SPOTS[0];
    let bd = -1;
    const r0 = Math.floor(Math.random() * COPY_SPOTS.length);
    for (let i = 0; i < COPY_SPOTS.length; i++) {
      const s = COPY_SPOTS[(r0 + i) % COPY_SPOTS.length];
      const d = Math.hypot(s.x - plow.position.x, s.z - plow.position.z);
      if (d >= 12) {
        best = s;
        break;
      }
      if (d > bd) {
        bd = d;
        best = s;
      }
    }
    const type = COPY_TYPES[Math.floor(Math.random() * COPY_TYPES.length)];
    const home = homeZone(type)?.enemyHpMult ?? 1;
    const hpMult = (ctx.zone.enemyHpMult ?? 1) * home * WO.COPY_HP;
    const e = ctx.enemies.spawn(type, best.x, best.z, { hpMult, noGate: true, echo: true, snow: true, heading: Math.atan2(plow.position.x - best.x, plow.position.z - best.z) }) as Bot;
    e.entering = false;
    e.dmgOutMult = WO.COPY_DMG;
    this.copies.push(e);
    _v.set(best.x, 0.3, best.z);
    ctx.fx.powder(_v, { size: 2, color: 0xeaf6ff });
    ctx.fx.ring(_v, 4, 0xdff4ff);
    _v.y = 5;
    ctx.fx.floatText(_v, 'SNOW COPY', '#dff4ff', 1);
    for (let i = this.copies.length - 1; i >= 0; i--) if (!this.copies[i].alive) this.copies.splice(i, 1);
    this.note(`copy:${type}`);
  }

  /* ------------------------------------------------------------------ helpers */

  private spawnHearts(n: number): void {
    const ctx = this.ctx;
    this.hearts.length = 0;
    whiteoutGiant.clearBeams();
    const spots = pickHeartSpots(n, ctx.plow.position.x, ctx.plow.position.z, Math.random(), WO.HEART_CLEAR, this.spots);
    for (const s of spots) {
      const h = ctx.enemies.spawn('stormheart', s.x, s.z, { hpMult: ctx.zone.enemyHpMult ?? 1, noGate: true, heading: 0 }) as Bot;
      h.fixed = true;
      h.entering = false;
      this.gone[this.hearts.length] = false;
      this.hearts.push(h);
      _v.set(s.x, 0.4, s.z);
      ctx.fx.powder(_v, { size: 1.6, color: 0xdff4ff });
      ctx.fx.ring(_v, 3.5, 0x7fdcff);
    }
    whiteoutGiant.lightning(1);
    ctx.audio?.play('freeze', { volume: 0.9, pitch: 0.7 });
  }

  /** The boardroom's roof tears off: gold and glass flung up into the storm. */
  private roofTears(): void {
    const fx = this.ctx.fx;
    _v.set(BOARDROOM.x, BOARDROOM.y, BOARDROOM.z);
    fx.burst(_v, ROOF_GOLD);
    fx.burst(_v, ROOF_GLASS);
    fx.burst(_v, ROOF_PAPER);
  }

  private note(s: string): void {
    if (this.log.length < 200) this.log.push(s);
  }
}

/** Distance from (x, z) along unit (dx, dz) to the square ±lim (>= 0). */
function wallT(x: number, z: number, dx: number, dz: number, lim: number): number {
  let t = 1e3;
  if (dx > 1e-4) t = Math.min(t, (lim - x) / dx);
  else if (dx < -1e-4) t = Math.min(t, (-lim - x) / dx);
  if (dz > 1e-4) t = Math.min(t, (lim - z) / dz);
  else if (dz < -1e-4) t = Math.min(t, (-lim - z) / dz);
  return Math.max(0, t);
}

const STATUE_BURST = { color: 0xffffff, count: 34, speed: 8, size: 0.32, gravity: 12, life: 1.1 };
const SWALLOW_PUFF = { color: 0xeaf6ff, count: 40, speed: 9, size: 0.6, gravity: -2, life: 1.6 };
const CRASH_BURST = { color: 0xdff4ff, count: 60, speed: 14, size: 0.35, gravity: 10, life: 1.4 };
const ROOF_GOLD = { color: 0xffc233, count: 40, speed: 16, size: 0.3, gravity: -6, life: 2.2 };
const ROOF_GLASS = { color: 0xbfe8ff, count: 40, speed: 14, size: 0.18, gravity: -4, life: 2 };
const ROOF_PAPER = { color: 0xfbfaf4, count: 30, speed: 10, size: 0.26, gravity: -3, life: 2.4 };
