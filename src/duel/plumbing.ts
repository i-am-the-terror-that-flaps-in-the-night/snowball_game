import type { GameEvents } from '../core/events';
import type { AudioAPI, EnemyHandle, EnemyManagerAPI, GameContext, PlayerStats, SnowFieldAPI, SoundName, ZoneDef } from '../core/types';
import type { CosmeticSlot } from '../config/cosmetics';
import type { Plow } from '../entities/Plow';
import type { Combat } from '../entities/Combat';
import type { EventSink, InputSource, PilotAudio, PilotBinding } from '../entities/pilot';
import { HELD_BIT, NET_PLOW_LEN, NP, NP_ANGLE, NP_DISCRETE, PRESS_ACTIONS, PRESS_CODES, type PressAction, PressTracker } from '../net/protocol';
import type { SnowField } from '../world/SnowField';
import { arcRange } from '../entities/combat/volt';
import { sprayRange } from '../entities/combat/isotope';
import { tankGunRange } from '../entities/combat/arsenal';
import { FIST_REACH, fistSize } from '../entities/combat/brute';
import { RUSH_MAX, SWIPE_RANGE, rushCost } from '../entities/combat/classicRush';

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
  /** Equipped gear ids to show on this plow (an opponent's), or null for the save's. */
  gear: string[] | null = null;
  /** The other pilot's plow (PilotBinding.foe: a guest's visual-only homing). */
  foe: Plow | null = null;
  readonly pvp = true;
  /** Duel guest: the other plow, for visuals only (PilotBinding.visualFoe). */
  visualFoe: EnemyHandle | null = null;

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
  /** Held keys travel as a bitmask in every input packet (ARSENAL's Mag Discs cycle while SPACE is held). */
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

/** Hull half-length (m) the AutoPilot adds to a fist's reach past the hull (as scripts/balance/duel2.ts HULL). */
const AUTO_HULL = 1.6;
/** AutoPilot VOLT-9: centre distance (m) inside which it reverses flat out. */
const AUTO_KITE = 6;
/** AutoPilot ARSENAL: share of the disc reach it closes to, then holds (its mid-range role; duel2.ts uses 0.75). */
const AUTO_MID = 0.7;
/** Centre distance (m) within which the AutoPilot holds SPACE: the plow's real held-primary reach from its kit (VOLT-9
 *  Arc Lance, ISOTOPE Rad Sprayer, ARSENAL Mag Discs, all with Mega Hopper; BRUTUS Wrecking Fist), and the old 9 m
 *  for the Classic (its SPACE is AutoPilot.classicSpace's swipe / rush, which doesn't use this). Before, every plow held at 9 m, so the three ranged primaries
 *  (12-17 m late) never fired at their reach. AutoPilot only: probes / testing, not gameplay. */
export function autoHoldRange(st: PlayerStats): number {
  switch (st.plowKind) {
    case 'volt':
      return arcRange(st.maxBallRadius);
    case 'isotope':
      return sprayRange(st.maxBallRadius) + (st.sprayReach || 0);
    case 'arsenal':
      return tankGunRange(st);
    case 'brute':
      return AUTO_HULL + FIST_REACH * fistSize(st) + (st.fistReach || 0);
    default:
      return 9;
  }
}

/** A dumb but aggressive autopilot (probes, idle testing): drive at the opponent, slam / dash / whirl / F, and hold
 *  SPACE when facing within the held primary's real reach (autoHoldRange: Arc Lance, Wrecking Fist, Rad Sprayer, Mag
 *  Discs; snowball plows ignore the hold). ARSENAL fires its Mag Repulsor (E) when facing within its wave's reach.
 *  Each kit plays its role: the Classic swipes up close and rushes in from range, VOLT-9 kites at the Arc Lance's
 *  reach, ARSENAL holds mid range, BRUTUS and ISOTOPE drive in. */
export class AutoPilot implements InputSource {
  throttle = 0;
  steer = 0;
  private pressed = new Set<string>();
  private holdSpace = false;
  /** Classic: SPACE held to charge a PLOW RUSH. */
  private rushHold = false;
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
      this.holdSpace = false;
      this.rushHold = false;
      return;
    }
    const st = me.pilot.stats;
    const reach = autoHoldRange(st);
    const dx = op.position.x - me.position.x;
    const dz = op.position.z - me.position.z;
    const d = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz);
    let err = want - me.heading;
    err = Math.atan2(Math.sin(err), Math.cos(err));
    // Gather snow while the ball is small and the opponent is out of reach; otherwise go for them.
    const hunting = me.heldBallRadius > 0.75 || d < Math.max(9, reach);
    if (!hunting) {
      const wander = Math.sin(this.t * 0.7) * 1.1;
      err = Math.atan2(Math.sin(err + wander), Math.cos(err + wander));
    }
    this.steer = Math.max(-1, Math.min(1, err * 2.2));
    this.throttle = Math.abs(err) > 2.2 ? -0.4 : 1;
    const facing = Math.abs(err) < 0.35;
    if (st.plowKind === 'classic') this.classicSpace(me, d, err, facing);
    else {
      if (facing && d < 6.5 && me.heldBallRadius > 0.5) this.pressed.add('Space');
      this.holdSpace = Math.abs(err) < 0.6 && d < reach;
      // Ranged kits keep their range instead of ramming in (each kit's role): VOLT-9 kites at 0.7-0.9 x the Arc
      // Lance's reach (backing off with the lance up, AUTO_KITE), ARSENAL stops closing at AUTO_MID x disc reach.
      // Forward dashes only to close a gap the kit wants closed.
      if (st.plowKind === 'volt' && hunting) this.kite(err, d, reach);
      else if (st.plowKind === 'arsenal' && hunting && d < reach * AUTO_MID && Math.abs(err) < 0.6) this.throttle = 0.15;
      const dashFrom = st.plowKind === 'volt' ? reach * 0.95 : st.plowKind === 'arsenal' ? reach * AUTO_MID + 2 : 6;
      if (facing && d > dashFrom && d < dashFrom + 9 && me.dashReady >= 1) this.pressed.add('ShiftLeft');
    }
    const arsenal = st.plowKind === 'arsenal';
    if (d < (arsenal ? st.laserRange * 0.9 : 5.5) && (!arsenal || facing) && me.whirlReady >= 1) this.pressed.add('KeyE');
    this.fT -= dt;
    if (this.fT <= 0 && d < 9) {
      this.fT = 2.5;
      this.pressed.add('KeyF');
    }
  }
  /** VOLT-9: hold 0.7-0.9 x the Arc Lance's reach. Too close, reverse away (VOLT-9 reverses at 0.8 x top speed while
   *  the lance fires), still steering the nose at the opponent (steering is mirrored in reverse); full reverse inside
   *  AUTO_KITE m, where the lance's close-range penalty bites. In the band, creep to stay facing. */
  private kite(err: number, d: number, reach: number): void {
    if (d < reach * 0.7) {
      this.throttle = d < AUTO_KITE ? -1 : -0.6;
      this.steer = Math.max(-1, Math.min(1, -err * 2.2));
    } else if (d < reach * 0.9) this.throttle = Math.abs(err) > 0.35 ? 0.25 : 0;
  }
  /** The Classic Plow's SPACE: tap BLADE SWIPEs when the opponent is inside the swipe (SWIPE_RANGE past both hulls);
   *  lined up at ~6-21 m with meter for a rush that reaches them (rushCost), hold to charge a PLOW RUSH and let go
   *  once the telegraph reaches them (2.5 m short of their centre: the blade touches them there, and the first contact
   *  ends the rush in the slam) or the charge is full. Charging no longer slows the plow, so it keeps closing. Its dash
   *  shares that meter, so it only dashes when the opponent is past rush reach. */
  private classicSpace(me: Plow, d: number, err: number, facing: boolean): void {
    const swipeD = SWIPE_RANGE + 2 * AUTO_HULL;
    if (this.rushHold) {
      const k = me.rushCharge;
      if (Math.abs(err) > 0.6 || d < swipeD || (k >= 0 && (me.rushPreview >= d - 2.5 || k >= 1))) this.rushHold = false;
    } else if (!me.rushing) {
      if (facing && d > swipeD + 0.5 && d < RUSH_MAX + 1 && me.dashReady >= rushCost(d - 2.5)) {
        this.rushHold = true;
        this.pressed.add('Space');
      } else if (Math.abs(err) < 0.7 && d < swipeD) this.pressed.add('Space');
      else if (facing && d > RUSH_MAX + 1 && d < 28 && me.dashReady >= 1) this.pressed.add('ShiftLeft');
    }
    this.holdSpace = this.rushHold;
  }
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }
  isDown(code: string): boolean {
    return code === 'Space' && this.holdSpace;
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

/** Events for the local pilot: the HUD damage pulse and the plow's flights (plowLaunched / plowLanded, so the run's
 *  airtime tally sees Duel jumps too) go to the game bus, slams / F presses to the duel. The opponent's sink has no
 *  bus (its flights replay as effects only, Plow.updatePuppet). Duel ends without a runFinished, so its flights still
 *  never reach the lifetime airtime record. */
export class PilotEvents implements EventSink {
  constructor(
    private bus: () => GameContext['events'] | null,
    private onSlam: (e: GameEvents['slam']) => void,
    private onAbility: (e: GameEvents['ability']) => void,
  ) {}
  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    if (type === 'plowDamaged' || type === 'plowLaunched' || type === 'plowLanded') this.bus()?.emit(type, payload);
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
  topAt(x: number, z: number): number {
    return this.f.topAt(x, z);
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
