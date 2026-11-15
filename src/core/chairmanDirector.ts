import * as THREE from 'three';
import type { EnemyHandle, GameContext } from './types';
import { BOARDROOM } from '../world/environment/ProtocolScenery';
import { PROTOCOL_WAVES } from '../config/protocol';
import { CH } from '../entities/enemies/chairman';
import {
  BEAT_MAX_CHARS, CHAIRMAN_ACQUIRE, CHAIRMAN_INTRO, CHAIRMAN_KILL, CHAIRMAN_KILL_ANY, CHAIRMAN_KNOCKOFF, CHAIRMAN_LOW_HP, CHAIRMAN_REVEAL,
} from '../config/lore';

/**
 * THE CHAIRMAN's side of PROTOCOL C outside his own AI (docs/modes.md "Protocol C"; plan stage 3):
 *  - COMMENTARY (waves 1-6, and the reveal): radio-style toasts from the boardroom box over the north stand (the
 *    'chairman' toast: a distorted PA line). Wave intros, "acquiring" each echo as it walks in, reacting to boss
 *    kills and to the player's low HP (once a wave), the wave 5 knock-off line. Rate-limited: at least COMMENT_GAP s
 *    between lines; a line arriving inside the gap waits in a one-line queue (a newer one replaces it; the wave intro
 *    and the reveal lines always go out). Never more than one line in COMMENT_GAP s apart from those.
 *  - THE REVEAL (wave 7's countdown, REVEAL_COUNTDOWN s): the box lights up (silhouette -> THE DONALD, lit, ankle
 *    monitor on), two lines, and the camera eases onto a shot looking up at the box from the north end of the arena
 *    (camera(): blended over the follow camera after CameraRig.update, so the rig itself is untouched). The fight
 *    then opens with his descent (enemies/chairman.ts): a shot that follows the tower down from the box (dropCamera),
 *    eased back to the follow camera once he lands.
 *  - THE DEFEAT HOOK: onChairmanDefeated (his wreck after the PROTOCOL C button): everything left (echoes, rally bots)
 *    powers down, the rest of the wave queue is dropped, so wave 7 ends and the run's victory follows. TODO(stage 4): startWhiteout() here.
 * Pure timing logic + ctx calls (ui toasts, world.boardroom, the camera); no per-frame allocation.
 */

/** Minimum seconds between two commentary lines. */
export const COMMENT_GAP = 7;
/** Below this HP fraction the player's plow is "low" (one line a wave). */
export const LOW_HP_FRAC = 0.3;
/** Reveal timeline (s into wave 7's countdown): lights ramp from REVEAL_LIGHT over REVEAL_RAMP; the camera shot eases
 *  in from REVEAL_CAM over REVEAL_CAM_IN (and back out over REVEAL_CAM_OUT once the fight starts); the reveal line at
 *  REVEAL_LINE. */
export const REVEAL_LIGHT = 0.6;
export const REVEAL_RAMP = 1.6;
export const REVEAL_CAM = 0.2;
export const REVEAL_CAM_IN = 1.2;
export const REVEAL_CAM_OUT = 0.6;
export const REVEAL_LINE = 2.4;
/** The reveal shot: a slow dolly from SHOT_A to SHOT_B, looking up at the box's face. */
const SHOT_A = new THREE.Vector3(7, 15.5, -17);
const SHOT_B = new THREE.Vector3(3.5, 15.8, -23.5);
const SHOT_LOOK = new THREE.Vector3(BOARDROOM.x + 4, BOARDROOM.y - 2.2, BOARDROOM.z);
/** The descent shot (wave 7, his drop from the box): from SHOT_B down to DROP_CAM, framing the tower as it falls
 *  (looking at its rig + DROP_LOOK_Y), then eased back to play over DROP_OUT s once he lands. */
const DROP_CAM = new THREE.Vector3(10, 7.5, -2);
const DROP_LOOK_Y = 4.5;
export const DROP_OUT = 0.9;
const _pose = new THREE.PerspectiveCamera();
const _look = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();

/** The toast prefix: a phone line from the box. */
export const CHAIRMAN_PREFIX = '📞 THE CHAIRMAN: ';

export class ChairmanDirector {
  private active = false;
  private wave = 0;
  /** Seconds until the next line may go out, and the waiting line. */
  private gapT = 0;
  private queued: string | null = null;
  private lowSaid = false;
  private killI = 0;
  private lowI = 0;
  /** Wave 7 countdown: seconds into the reveal (-1 = not revealing). */
  private revealT = -1;
  private revealLine = false;
  /** The reveal shot's blend weight (0..1) and, after the fight starts, its ease-out timer. */
  private camW = 0;
  private camOut = 0;
  /** The descent shot: on while he drops (dropOn), then its ease-out timer; its last pose (held while it eases). */
  private dropOn = false;
  private dropOut = 0;
  private readonly dropPos = new THREE.Vector3();
  private readonly dropQ = new THREE.Quaternion();
  /** Lines said (tests / probes read the log; capped). */
  readonly log: string[] = [];
  private readonly sweep: EnemyHandle[] = [];
  /** The whiteout hook ran (THE CHAIRMAN fell this run). */
  chairmanDown = false;

  constructor(private readonly ctx: GameContext) {
    const ev = ctx.events;
    ev.on('bossSpawned', ({ enemy }) => this.onBossSpawned(enemy));
    ev.on('bossDefeated', ({ enemy }) => this.onBossDefeated(enemy));
    ev.on('plowDamaged', () => this.onPlowDamaged());
  }

  /** A PROTOCOL C wave's countdown starts (Game.beginCountdown): its intro line; wave 7 also starts the reveal. */
  begin(wave: number): void {
    this.active = true;
    this.wave = wave;
    this.lowSaid = false;
    this.queued = null;
    this.gapT = 0;
    this.chairmanDown = false;
    this.revealT = wave >= PROTOCOL_WAVES ? 0 : -1;
    this.revealLine = false;
    this.camW = 0;
    this.camOut = 0;
    this.dropOn = false;
    this.dropOut = 0;
    this.ctx.world.boardroom?.('shadow');
    const intro = CHAIRMAN_INTRO[wave];
    if (intro) this.say(intro, true);
  }

  /** Leaving PROTOCOL C (any arena start / the menu): silent until the next begin(). */
  end(): void {
    this.active = false;
    this.revealT = -1;
    this.queued = null;
    this.camW = 0;
    this.camOut = 0;
    this.dropOn = false;
    this.dropOut = 0;
  }

  get revealing(): boolean {
    return this.revealT >= 0;
  }

  /** Real-time tick while a PROTOCOL C run is on screen. */
  update(dt: number): void {
    if (!this.active) return;
    this.gapT -= dt;
    if (this.gapT <= 0 && this.queued) {
      const q = this.queued;
      this.queued = null;
      this.say(q, true);
    }
    if (this.revealT >= 0) this.updateReveal(dt);
  }

  /** The fight began (Game.startRound): the reveal hands over to his descent; the box stays lit until it detaches. */
  fight(): void {
    if (this.revealT >= 0) {
      this.ctx.world.boardroom?.('lit', 1);
      this.camOut = REVEAL_CAM_OUT;
    }
    this.revealT = -1;
  }

  /** After CameraRig.update (Game.tick): blend the reveal shot over the follow camera. */
  camera(dt: number): void {
    if (this.dropCamera(dt)) return;
    let w = 0;
    let u = 1;
    if (this.revealT >= REVEAL_CAM) {
      const k = Math.min(1, (this.revealT - REVEAL_CAM) / REVEAL_CAM_IN);
      w = k * k * (3 - 2 * k);
      u = Math.min(1, (this.revealT - REVEAL_CAM) / 5.5);
    } else if (this.camOut > 0) {
      this.camOut = Math.max(0, this.camOut - dt);
      const k = this.camOut / REVEAL_CAM_OUT;
      w = this.camW > 0 ? k * k * (3 - 2 * k) : 0;
    }
    if (this.revealT >= 0) this.camW = w;
    if (w <= 0) return;
    const cam = this.ctx.camera;
    _p.copy(SHOT_A).lerp(SHOT_B, u * u * (3 - 2 * u));
    _pose.position.copy(_p);
    _pose.lookAt(SHOT_LOOK);
    _q.copy(cam.quaternion).slerp(_pose.quaternion, w);
    cam.position.lerp(_p, w);
    cam.quaternion.copy(_q);
    cam.updateMatrixWorld();
  }

  /** The descent shot (the fight has begun, THE CHAIRMAN is dropping from the box): true while it owns the camera.
   *  It picks up from the reveal shot's end pose, so the hand-over is seamless. */
  private dropCamera(dt: number): boolean {
    if (!this.active || this.revealT >= 0 || this.wave < PROTOCOL_WAVES) return false;
    let rig: THREE.Object3D | null = null;
    let u = 0;
    for (const b of this.ctx.enemies.bosses) {
      const c = b as EnemyHandle & { state?: string; stateT?: number; rig?: { root: THREE.Object3D } };
      if (c.type !== 'chairman' || !c.alive || c.state !== 'reveal' || !c.rig) continue;
      rig = c.rig.root;
      u = 1 - Math.max(0, Math.min(1, (c.stateT ?? 0) / CH.REVEAL_T));
    }
    const cam = this.ctx.camera;
    if (rig) {
      this.dropOn = true;
      this.camOut = 0;
      const k = u * u * (3 - 2 * u);
      this.dropPos.copy(SHOT_B).lerp(DROP_CAM, k);
      _pose.position.copy(this.dropPos);
      _look.copy(rig.position);
      _look.y += DROP_LOOK_Y;
      // from the box's face down onto the tower (the first frames still look at the box)
      _look.lerp(SHOT_LOOK, Math.max(0, 1 - u * 4));
      _pose.lookAt(_look);
      this.dropQ.copy(_pose.quaternion);
      cam.position.copy(this.dropPos);
      cam.quaternion.copy(this.dropQ);
      cam.updateMatrixWorld();
      return true;
    }
    if (this.dropOn) {
      this.dropOn = false;
      this.dropOut = DROP_OUT;
    }
    if (this.dropOut <= 0) return false;
    this.dropOut = Math.max(0, this.dropOut - dt);
    const k = this.dropOut / DROP_OUT;
    const w = k * k * (3 - 2 * k);
    cam.position.lerp(this.dropPos, w);
    cam.quaternion.slerp(this.dropQ, w);
    cam.updateMatrixWorld();
    return true;
  }

  private updateReveal(dt: number): void {
    this.revealT += dt;
    const t = this.revealT;
    const k = Math.max(0, Math.min(1, (t - REVEAL_LIGHT) / REVEAL_RAMP));
    this.ctx.world.boardroom?.(k > 0 ? 'lit' : 'shadow', k);
    if (!this.revealLine && t >= REVEAL_LINE) {
      this.revealLine = true;
      this.say(CHAIRMAN_REVEAL, true);
    }
  }

  /** Say `line` now if the gap allows (or `force`), else queue it (one waiting line; a newer one replaces it). */
  private say(line: string, force = false): void {
    if (!this.active) return;
    if (!force && this.gapT > 0) {
      this.queued = line;
      return;
    }
    this.gapT = COMMENT_GAP;
    this.ctx.ui.toast(CHAIRMAN_PREFIX + line.slice(0, BEAT_MAX_CHARS), 'chairman');
    if (this.log.length < 64) this.log.push(line);
  }

  private onBossSpawned(e: EnemyHandle): void {
    if (!this.active || this.wave >= PROTOCOL_WAVES) return;
    if (e.echo) {
      const l = CHAIRMAN_ACQUIRE[e.type];
      if (l) this.say(l);
    } else if (e.headline && e.type === 'donald') this.say(CHAIRMAN_KNOCKOFF);
  }

  private onBossDefeated(e: EnemyHandle): void {
    if (!this.active) return;
    if (e.type === 'chairman') {
      this.onChairmanDefeated();
      return;
    }
    if (this.wave >= PROTOCOL_WAVES) return;
    const l = CHAIRMAN_KILL[e.type] ?? CHAIRMAN_KILL_ANY[this.killI++ % CHAIRMAN_KILL_ANY.length];
    this.say(l);
  }

  private onPlowDamaged(): void {
    if (!this.active || this.lowSaid || this.wave >= PROTOCOL_WAVES) return;
    const p = this.ctx.plow;
    if (p.dead || p.hp > p.maxHp * LOW_HP_FRAC) return;
    this.lowSaid = true;
    this.say(CHAIRMAN_LOW_HP[this.lowI++ % CHAIRMAN_LOW_HP.length]);
  }

  /**
   * THE CHAIRMAN's wreck (after he slammed PROTOCOL C): stage 4's hook. For now everything left on the floor powers down
   * (echoes, rally bots) and the rest of the wave 7 queue is dropped, so the wave (and the run) ends in victory.
   */
  onChairmanDefeated(): void {
    this.chairmanDown = true;
    const ctx = this.ctx;
    ctx.waves.cancel?.();
    // everything still on the floor powers down with him (the echoes, and any rally bots / minions they brought):
    // otherwise a leftover red cap would hold the wave, and the run's victory, open
    const bosses = ctx.enemies.bosses;
    for (let i = bosses.length - 1; i >= 0; i--) {
      const b = bosses[i];
      if (b.alive && b.echo) ctx.enemies.dismiss?.(b); // (a downed twin husk too: query() skips husks)
    }
    const all = ctx.enemies.query(0, 0, 1e4, this.sweep);
    for (let i = all.length - 1; i >= 0; i--) {
      const b = all[i];
      if (b.alive && b.type !== 'chairman') ctx.enemies.dismiss?.(b);
    }
    this.sweep.length = 0;
    // TODO(stage 4): startWhiteout() — the roof tears off and THE WHITEOUT rises instead of the victory.
  }
}
