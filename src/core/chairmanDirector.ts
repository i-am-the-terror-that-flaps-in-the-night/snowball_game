import type { EnemyHandle, GameContext } from './types';
import { BOARDROOM } from '../world/environment/ProtocolScenery';
import { PROTOCOL_WAVES } from '../config/protocol';
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
 *    monitor on), the camera swings up to it, two lines. The fight then opens with his descent (enemies/chairman.ts).
 *  - THE DEFEAT HOOK: onChairmanDefeated (his wreck after the PROTOCOL C button): the echoes power down, the rest of
 *    the wave queue is dropped, so wave 7 ends and the run's victory follows. TODO(stage 4): startWhiteout() here.
 * Pure timing logic + ctx calls (ui toasts, world.boardroom, cameraRig); no per-frame allocation.
 */

/** Minimum seconds between two commentary lines. */
export const COMMENT_GAP = 7;
/** Below this HP fraction the player's plow is "low" (one line a wave). */
export const LOW_HP_FRAC = 0.3;
/** Reveal timeline (s into wave 7's countdown): lights ramp from REVEAL_LIGHT over REVEAL_RAMP; the camera finds the
 *  box at REVEAL_CAM for REVEAL_CAM_T; the reveal line at REVEAL_LINE. */
export const REVEAL_LIGHT = 0.6;
export const REVEAL_RAMP = 1.6;
export const REVEAL_CAM = 0.2;
export const REVEAL_CAM_T = 5.4;
export const REVEAL_LINE = 2.4;

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
  private revealCam = false;
  /** Lines said (tests / probes read the log; capped). */
  readonly log: string[] = [];
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
    this.revealCam = false;
    this.ctx.world.boardroom?.('shadow');
    const intro = CHAIRMAN_INTRO[wave];
    if (intro) this.say(intro, true);
  }

  /** Leaving PROTOCOL C (any arena start / the menu): silent until the next begin(). */
  end(): void {
    this.active = false;
    this.revealT = -1;
    this.queued = null;
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
    if (this.revealT >= 0) this.ctx.world.boardroom?.('lit', 1);
    this.revealT = -1;
  }

  private updateReveal(dt: number): void {
    this.revealT += dt;
    const t = this.revealT;
    const k = Math.max(0, Math.min(1, (t - REVEAL_LIGHT) / REVEAL_RAMP));
    this.ctx.world.boardroom?.(k > 0 ? 'lit' : 'shadow', k);
    if (!this.revealCam && t >= REVEAL_CAM) {
      this.revealCam = true;
      // the kill-cam orbit framed on the box (it looks at y + 0.5, from 12 m above and 17 m out)
      this.ctx.cameraRig.cinematic(BOARDROOM.x, BOARDROOM.z, REVEAL_CAM_T, BOARDROOM.y - 0.5);
    }
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
   * THE CHAIRMAN's wreck (after he slammed PROTOCOL C): stage 4's hook. For now the echoes power down and the rest of
   * the wave 7 queue is dropped, so the wave (and the run) ends in victory.
   */
  onChairmanDefeated(): void {
    this.chairmanDown = true;
    const ctx = this.ctx;
    ctx.waves.cancel?.();
    const bosses = ctx.enemies.bosses;
    for (let i = bosses.length - 1; i >= 0; i--) {
      const b = bosses[i];
      if (b.alive && b.echo) ctx.enemies.dismiss?.(b);
    }
    // TODO(stage 4): startWhiteout() — the roof tears off and THE WHITEOUT rises instead of the victory.
  }
}
