import type { GameEvents } from '../core/events';
import type { AudioAPI, EnemyManagerAPI, GameContext, PlayerStats, SnowFieldAPI, SoundName, ZoneDef } from '../core/types';
import type { CosmeticSlot } from '../config/cosmetics';
import type { Plow } from '../entities/Plow';
import type { Combat } from '../entities/Combat';
import type { EventSink, InputSource, PilotAudio, PilotBinding } from '../entities/pilot';
import { HELD_BIT, NET_PLOW_LEN, NP, NP_ANGLE, NP_DISCRETE, PRESS_ACTIONS, PRESS_CODES, type PressAction, PressTracker } from '../net/protocol';
import type { SnowField } from '../world/SnowField';

/** Code -> press-action index (0 slam, 1 dash, 2 whirl, 3 ability). */
const CODE_ACTION = new Map<string, number>();
PRESS_ACTIONS.forEach((a, i) => PRESS_CODES[a].forEach((c) => CODE_ACTION.set(c, i)));

/** A pilot binding with swappable parts (stats change per match, input sources per phase). */
export class DuelPilot implements PilotBinding {
  input: InputSource;
  stats: PlayerStats;
  plow!: Plow;
  combat!: Combat;
  enemies: EnemyManagerAPI;
  snow: SnowFieldAPI;
  audio: PilotAudio;
  events: EventSink;
  look: Partial<Record<CosmeticSlot, string>> | null = null;

  constructor(
    readonly local: boolean,
    readonly authoritative: boolean,
    o: { input: InputSource; stats: PlayerStats; enemies: EnemyManagerAPI; snow: SnowFieldAPI; audio: PilotAudio; events: EventSink },
  ) {
    this.input = o.input;
    this.stats = o.stats;
    this.enemies = o.enemies;
    this.snow = o.snow;
    this.audio = o.audio;
    this.events = o.events;
  }
}

/** The local keyboard / pad, silenced while `gate()` is false (countdown, pause menu, round over). */
export class GatedInput implements InputSource {
  constructor(
    private src: () => InputSource,
    private gate: () => boolean,
  ) {}
  get throttle(): number {
    return this.gate() ? this.src().throttle : 0;
  }
  get steer(): number {
    return this.gate() ? this.src().steer : 0;
  }
  wasPressed(code: string): boolean {
    return this.gate() && this.src().wasPressed(code);
  }
  isDown(code: string): boolean {
    const s = this.src();
    return this.gate() && !!s.isDown?.(code);
  }
}

/** Host side: the guest's input, from the PressTracker. Call beginFrame() once per sim frame. */
export class NetInput implements InputSource {
  readonly tracker = new PressTracker();
  private now = [false, false, false, false];
  enabled = false;

  beginFrame(): void {
    for (let i = 0; i < 4; i++) this.now[i] = this.tracker.take(i) && this.enabled;
  }
  endFrame(): void {
    this.now.fill(false);
  }
  get throttle(): number {
    return this.enabled ? this.tracker.throttle : 0;
  }
  get steer(): number {
    return this.enabled ? this.tracker.steer : 0;
  }
  wasPressed(code: string): boolean {
    const i = CODE_ACTION.get(code);
    return i !== undefined && this.now[i];
  }
  /** Held keys travel as a bitmask in every input packet (ARSENAL's autocannon fires while SPACE is held). */
  isDown(code: string): boolean {
    const i = CODE_ACTION.get(code);
    return i !== undefined && this.enabled && (this.tracker.held & HELD_BIT(i)) !== 0;
  }
}

/** Guest side, opponent puppet: axes from the snapshot, F presses replayed from the host's ability events. */
export class PuppetInput implements InputSource {
  throttle = 0;
  steer = 0;
  pressF = false;
  wasPressed(code: string): boolean {
    return code === 'KeyF' && this.pressF;
  }
}

/** A dumb but aggressive autopilot (probes, idle testing): drive at the opponent, slam / dash / whirl / F. */
export class AutoPilot implements InputSource {
  throttle = 0;
  steer = 0;
  private pressed = new Set<string>();
  private t = 0;
  private fT = 1.5;
  constructor(private me: () => Plow, private opp: () => Plow) {}

  /** Decide this frame's input. */
  think(dt: number): void {
    this.pressed.clear();
    this.t += dt;
    const me = this.me();
    const op = this.opp();
    if (me.dead) {
      this.throttle = this.steer = 0;
      return;
    }
    const dx = op.position.x - me.position.x;
    const dz = op.position.z - me.position.z;
    const d = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz);
    let err = want - me.heading;
    err = Math.atan2(Math.sin(err), Math.cos(err));
    // Gather snow while the ball is small and the opponent is far; otherwise go for them.
    const hunting = me.heldBallRadius > 0.75 || d < 9;
    if (!hunting) {
      const wander = Math.sin(this.t * 0.7) * 1.1;
      err = Math.atan2(Math.sin(err + wander), Math.cos(err + wander));
    }
    this.steer = Math.max(-1, Math.min(1, err * 2.2));
    this.throttle = Math.abs(err) > 2.2 ? -0.4 : 1;
    const facing = Math.abs(err) < 0.35;
    if (facing && d < 6.5 && me.heldBallRadius > 0.5) this.pressed.add('Space');
    if (facing && d > 6 && d < 15 && me.dashReady >= 1) this.pressed.add('ShiftLeft');
    if (d < 5.5 && me.whirlReady >= 1) this.pressed.add('KeyE');
    this.fT -= dt;
    if (this.fT <= 0 && d < 9) {
      this.fT = 2.5;
      this.pressed.add('KeyF');
    }
  }
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }
}

/** Opponent's sounds: a touch quieter, and never their "can't do that" buzzes. */
export class RemoteAudio implements PilotAudio {
  constructor(private audio: () => AudioAPI) {}
  play(name: SoundName, opts?: { volume?: number; pitch?: number }): void {
    if (name === 'error') return;
    this.audio().play(name, { volume: (opts?.volume ?? 1) * 0.75, pitch: opts?.pitch });
  }
  setPlowing(): void {
    /* the continuous plow crunch is the local pilot's */
  }
}

/** Events for the local pilot: the HUD damage pulse goes to the game bus, slams / F presses to the duel. */
export class PilotEvents implements EventSink {
  constructor(
    private bus: () => GameContext['events'] | null,
    private onSlam: (e: GameEvents['slam']) => void,
    private onAbility: (e: GameEvents['ability']) => void,
  ) {}
  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    if (type === 'plowDamaged') this.bus()?.emit('plowDamaged', payload as GameEvents['plowDamaged']);
    else if (type === 'slam') this.onSlam(payload as GameEvents['slam']);
    else if (type === 'ability') this.onAbility(payload as GameEvents['ability']);
  }
}

/** Duel guest: the host owns the snow. Reads pass through; edits do nothing (measureLine keeps the spray). */
export class ReadOnlySnow implements SnowFieldAPI {
  constructor(private f: SnowField) {}
  get size(): number {
    return this.f.size;
  }
  getDepth(x: number, z: number): number {
    return this.f.getDepth(x, z);
  }
  plowLine(x1: number, z1: number, x2: number, z2: number, thickness: number, fraction: number): number {
    return this.f.measureLine(x1, z1, x2, z2, thickness, fraction);
  }
  collectDisc(): number {
    return 0;
  }
  addSnow(): void {}
  melt(): void {}
  totalSnowFraction(): number {
    return this.f.totalSnowFraction();
  }
  reset(zone: ZoneDef): void {
    void zone;
  }
  update(): void {}
}

/** Guest: ring buffer of host snapshots (both plow blocks) for ~100 ms-behind interpolation. */
export class SnapBuffer {
  private readonly cap = 48;
  private times = new Float64Array(this.cap);
  private data = new Float32Array(this.cap * 2 * NET_PLOW_LEN);
  private n = 0;
  private head = 0;

  clear(): void {
    this.n = 0;
    this.head = 0;
  }

  get size(): number {
    return this.n;
  }

  push(time: number, plows: Float32Array): void {
    if (this.n > 0) {
      const last = this.times[(this.head - 1 + this.cap) % this.cap];
      if (time <= last) return; // reordered / duplicate
    }
    const i = this.head;
    this.times[i] = time;
    this.data.set(plows.subarray(0, 2 * NET_PLOW_LEN), i * 2 * NET_PLOW_LEN);
    this.head = (i + 1) % this.cap;
    if (this.n < this.cap) this.n++;
  }

  newestTime(): number {
    return this.n ? this.times[(this.head - 1 + this.cap) % this.cap] : -Infinity;
  }

  /** Interpolate plow block `which` (0 host, 1 guest) at host time `t` into `out`. False if empty. */
  sample(t: number, which: number, out: Float32Array): boolean {
    if (!this.n) return false;
    const L = NET_PLOW_LEN;
    const first = this.head - this.n + this.cap;
    let a = first % this.cap;
    let b = a;
    for (let k = 0; k < this.n; k++) {
      const i = (first + k) % this.cap;
      if (this.times[i] <= t) a = i;
      if (this.times[i] >= t) {
        b = i;
        break;
      }
      b = i;
    }
    const ta = this.times[a];
    const tb = this.times[b];
    const u = tb > ta ? Math.max(0, Math.min(1, (t - ta) / (tb - ta))) : 1;
    const oa = a * 2 * L + which * L;
    const ob = b * 2 * L + which * L;
    const d = this.data;
    for (let f = 0; f < L; f++) {
      const va = d[oa + f];
      const vb = d[ob + f];
      if (f === NP_ANGLE) {
        let dh = vb - va;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        out[f] = va + dh * u;
      } else if (NP_DISCRETE.includes(f)) out[f] = u < 1 ? va : vb;
      else out[f] = va + (vb - va) * u;
    }
    // Ability timers that jump at a start (dash 0 -> 0.5, whirl -1 -> 0): take the newer value instead of blending.
    if (d[oa + NP.whirlT] < 0 || d[ob + NP.whirlT] < 0) out[NP.whirlT] = u < 0.5 ? d[oa + NP.whirlT] : d[ob + NP.whirlT];
    if (d[oa + NP.dashT] <= 0 !== d[ob + NP.dashT] <= 0) out[NP.dashT] = u < 0.5 ? d[oa + NP.dashT] : d[ob + NP.dashT];
    return true;
  }
}

/** Guest: predicted poses by input sequence, to compare with the host's pose for the same acknowledged input. */
export class PoseHistory {
  private readonly cap = 256;
  private seqs = new Int32Array(this.cap).fill(-1);
  private xs = new Float32Array(this.cap);
  private zs = new Float32Array(this.cap);
  private hs = new Float32Array(this.cap);

  record(seq: number, x: number, z: number, h: number): void {
    const i = seq % this.cap;
    this.seqs[i] = seq;
    this.xs[i] = x;
    this.zs[i] = z;
    this.hs[i] = h;
  }

  /** Pose recorded for `seq`, or null if it fell out of the buffer. */
  get(seq: number, out: { x: number; z: number; h: number }): boolean {
    const i = seq % this.cap;
    if (this.seqs[i] !== seq) return false;
    out.x = this.xs[i];
    out.z = this.zs[i];
    out.h = this.hs[i];
    return true;
  }

  /** A correction was applied to the live pose: apply it to every stored pose too (so it isn't counted twice). */
  shift(dx: number, dz: number, dh: number): void {
    for (let i = 0; i < this.cap; i++) {
      if (this.seqs[i] < 0) continue;
      this.xs[i] += dx;
      this.zs[i] += dz;
      this.hs[i] += dh;
    }
  }

  clear(): void {
    this.seqs.fill(-1);
  }
}

export type { PressAction };
