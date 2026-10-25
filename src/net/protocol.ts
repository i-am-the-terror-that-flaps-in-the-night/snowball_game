/* ------------------------------------------------------------------------------------------------
 * DUEL wire protocol. Binary for the hot paths (guest input ~60 Hz, host snapshots ~30 Hz, snow patches), JSON
 * strings for everything else (handshake, garage, round flow, hit / slam / ability events, pings).
 *
 *   INPUT    guest -> host   9 bytes  [1][seq u16][throttle i8][steer i8][slam u8][dash u8][whirl u8][ability u8]
 *            The four press fields are wrapping (mod 256) CUMULATIVE press counters: a lost or reordered packet never
 *            loses a press, because the next one still carries the total. The host turns counter deltas into presses.
 *   SNAP     host -> guest   [2][phase u8][seq u16][time f32][timer f32][round u8][scoreA u8][scoreB u8][flags u8]
 *            [inputAck u16][pad u16] then 2 x NET_PLOW_LEN f32 (host plow, then guest plow).
 *   SNOW     host -> guest   [3][flags u8][count u16] then per patch [x0 u16][z0 u16][w u16][h u16][w*h depth bytes]
 *            Depth is quantised to a byte over 0..SNOW_Q_MAX metres. flags & 1 = full-field keyframe.
 * ---------------------------------------------------------------------------------------------- */

export const PROTOCOL_VERSION = 1;

export const MSG_INPUT = 1;
export const MSG_SNAP = 2;
export const MSG_SNOW = 3;

/** Float layout of one plow in a snapshot (Plow.writeNet fills 0..sawFury, Combat.writeNet the rest). */
export const NP = {
  x: 0,
  z: 1,
  heading: 2,
  speed: 3,
  hp: 4,
  maxHp: 5,
  /** Held snowball VOLUME (m^3). */
  ball: 6,
  dashCharge: 7,
  whirlCharge: 8,
  dashT: 9,
  dashEase: 10,
  whirlT: 11,
  slamPhase: 12,
  slamT: 13,
  hop: 14,
  spawnProt: 15,
  dead: 16,
  pushX: 17,
  pushZ: 18,
  throttle: 19,
  steer: 20,
  sawFury: 21,
  // Combat
  fReady: 22,
  shield: 23,
  crit: 24,
  heat: 25,
  flameT: 26,
  poundT: 27,
  stormT: 28,
} as const;
export const NET_PLOW_LEN = 29;

/** Fields that are angles (interpolated the short way round) / discrete (taken from the newer snapshot). */
export const NP_ANGLE = NP.heading;
export const NP_DISCRETE: readonly number[] = [NP.dead, NP.slamPhase];

/* ------------------------------------------------------------------ input */

/** The four edge-triggered actions, in packet order. */
export const PRESS_ACTIONS = ['slam', 'dash', 'whirl', 'ability'] as const;
export type PressAction = (typeof PRESS_ACTIONS)[number];
/** Default key code each action answers to through InputSource.wasPressed. */
export const PRESS_CODES: Record<PressAction, readonly string[]> = {
  slam: ['Space'],
  dash: ['ShiftLeft', 'ShiftRight'],
  whirl: ['KeyE'],
  ability: ['KeyF'],
};

export interface InputFrame {
  seq: number;
  throttle: number;
  steer: number;
  /** Cumulative press counters (mod 256), PRESS_ACTIONS order. */
  presses: [number, number, number, number];
}

export const INPUT_BYTES = 9;

export function encodeInput(f: InputFrame, out: DataView): void {
  out.setUint8(0, MSG_INPUT);
  out.setUint16(1, f.seq & 0xffff, true);
  out.setInt8(3, Math.round(Math.max(-1, Math.min(1, f.throttle)) * 127));
  out.setInt8(4, Math.round(Math.max(-1, Math.min(1, f.steer)) * 127));
  for (let i = 0; i < 4; i++) out.setUint8(5 + i, f.presses[i] & 0xff);
}

export function decodeInput(v: DataView, out: InputFrame): boolean {
  if (v.byteLength < INPUT_BYTES || v.getUint8(0) !== MSG_INPUT) return false;
  out.seq = v.getUint16(1, true);
  out.throttle = v.getInt8(3) / 127;
  out.steer = v.getInt8(4) / 127;
  for (let i = 0; i < 4; i++) out.presses[i] = v.getUint8(5 + i);
  return true;
}

/** True if 16-bit sequence `a` is newer than `b` (wrapping). */
export function seqNewer(a: number, b: number): boolean {
  const d = (a - b) & 0xffff;
  return d !== 0 && d < 0x8000;
}

/**
 * Host side of the guest's input: turns the cumulative press counters of whatever packets arrive (lost, late or
 * duplicated) into exactly one press per real key press, handed out one per sim frame.
 */
export class PressTracker {
  /** Last counters seen (both ends start every session at 0). */
  private last: number[] = [0, 0, 0, 0];
  /** Presses not yet consumed by the sim. */
  readonly pending = [0, 0, 0, 0];
  private lastSeq = -1;
  throttle = 0;
  steer = 0;

  /** Feed one received packet. Older (reordered) packets still contribute presses but never rewind the axes. */
  receive(f: InputFrame): void {
    const fresh = this.lastSeq < 0 || seqNewer(f.seq, this.lastSeq);
    for (let i = 0; i < 4; i++) {
      const c = f.presses[i] & 0xff;
      const d = (c - this.last[i]) & 0xff;
      // A delta in the upper half is an old packet arriving late: its presses were already counted.
      if (d > 0 && d < 128) {
        this.pending[i] += d;
        this.last[i] = c;
      }
    }
    if (fresh) {
      this.lastSeq = f.seq;
      this.throttle = f.throttle;
      this.steer = f.steer;
    }
  }

  get ackSeq(): number {
    return this.lastSeq < 0 ? 0 : this.lastSeq;
  }

  /** Take at most one pending press of action index `i` (call once per sim frame). */
  take(i: number): boolean {
    if (this.pending[i] <= 0) return false;
    this.pending[i]--;
    return true;
  }

  reset(): void {
    this.last.fill(0);
    this.pending.fill(0);
    this.lastSeq = -1;
    this.throttle = this.steer = 0;
  }
}

/* ------------------------------------------------------------------ snapshots */

export const SNAP_HEADER = 20;
export const SNAP_BYTES = SNAP_HEADER + 2 * NET_PLOW_LEN * 4;

export interface SnapHeader {
  phase: number;
  seq: number;
  time: number;
  timer: number;
  round: number;
  scoreA: number;
  scoreB: number;
  flags: number;
  inputAck: number;
}

/** Encode a snapshot: header + `plows` (2 * NET_PLOW_LEN floats) into `out` (SNAP_BYTES long). */
export function encodeSnap(h: SnapHeader, plows: Float32Array, out: DataView): void {
  out.setUint8(0, MSG_SNAP);
  out.setUint8(1, h.phase);
  out.setUint16(2, h.seq & 0xffff, true);
  out.setFloat32(4, h.time, true);
  out.setFloat32(8, h.timer, true);
  out.setUint8(12, h.round);
  out.setUint8(13, h.scoreA);
  out.setUint8(14, h.scoreB);
  out.setUint8(15, h.flags);
  out.setUint16(16, h.inputAck & 0xffff, true);
  out.setUint16(18, 0, true);
  const n = 2 * NET_PLOW_LEN;
  for (let i = 0; i < n; i++) out.setFloat32(SNAP_HEADER + i * 4, plows[i], true);
}

export function decodeSnap(v: DataView, h: SnapHeader, plows: Float32Array): boolean {
  if (v.byteLength < SNAP_BYTES || v.getUint8(0) !== MSG_SNAP) return false;
  h.phase = v.getUint8(1);
  h.seq = v.getUint16(2, true);
  h.time = v.getFloat32(4, true);
  h.timer = v.getFloat32(8, true);
  h.round = v.getUint8(12);
  h.scoreA = v.getUint8(13);
  h.scoreB = v.getUint8(14);
  h.flags = v.getUint8(15);
  h.inputAck = v.getUint16(16, true);
  const n = 2 * NET_PLOW_LEN;
  for (let i = 0; i < n; i++) plows[i] = v.getFloat32(SNAP_HEADER + i * 4, true);
  return true;
}

/* ------------------------------------------------------------------ snow patches */

/** Snow depth (m) that maps to byte 255. Campaign snow never banks higher than ~1.3 m. */
export const SNOW_Q_MAX = 2;
export const quantDepth = (d: number) => Math.max(0, Math.min(255, Math.round((d / SNOW_Q_MAX) * 255)));
export const dequantDepth = (b: number) => (b / 255) * SNOW_Q_MAX;

/** A rectangle of vertex depths (vertex indices, w x h starting at x0, z0). */
export interface SnowPatch {
  x0: number;
  z0: number;
  w: number;
  h: number;
}

export function snowMessageBytes(patches: readonly SnowPatch[]): number {
  let n = 4;
  for (const p of patches) n += 8 + p.w * p.h;
  return n;
}

/** Encode patches whose bytes `read(patchIndex, x, z)` returns into a fresh buffer. */
export function encodeSnow(patches: readonly SnowPatch[], keyframe: boolean, read: (x: number, z: number) => number, out?: Uint8Array): Uint8Array {
  const bytes = snowMessageBytes(patches);
  const buf = out && out.byteLength >= bytes ? out.subarray(0, bytes) : new Uint8Array(bytes);
  const v = new DataView(buf.buffer, buf.byteOffset, bytes);
  v.setUint8(0, MSG_SNOW);
  v.setUint8(1, keyframe ? 1 : 0);
  v.setUint16(2, patches.length, true);
  let o = 4;
  for (const p of patches) {
    v.setUint16(o, p.x0, true);
    v.setUint16(o + 2, p.z0, true);
    v.setUint16(o + 4, p.w, true);
    v.setUint16(o + 6, p.h, true);
    o += 8;
    for (let z = 0; z < p.h; z++) for (let x = 0; x < p.w; x++) buf[o++] = read(p.x0 + x, p.z0 + z);
  }
  return buf;
}

/** Walk the patches of a SNOW message: `write(x, z, byte)` per vertex. Returns the keyframe flag (null if bad). */
export function decodeSnow(data: Uint8Array, write: (x: number, z: number, b: number) => void, onPatch?: (p: SnowPatch) => void): boolean | null {
  if (data.byteLength < 4 || data[0] !== MSG_SNOW) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const keyframe = (v.getUint8(1) & 1) === 1;
  const count = v.getUint16(2, true);
  let o = 4;
  for (let k = 0; k < count; k++) {
    if (o + 8 > data.byteLength) return null;
    const x0 = v.getUint16(o, true);
    const z0 = v.getUint16(o + 2, true);
    const w = v.getUint16(o + 4, true);
    const h = v.getUint16(o + 6, true);
    o += 8;
    if (o + w * h > data.byteLength) return null;
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) write(x0 + x, z0 + z, data[o++]);
    onPatch?.({ x0, z0, w, h });
  }
  return keyframe;
}

/* ------------------------------------------------------------------ JSON control messages */

/** PlayerStats contain Infinity (Second Wind not owned): JSON can't, so it travels as a string. */
export function toJson(msg: unknown): string {
  return JSON.stringify(msg, (_k, v) => (v === Infinity ? '∞' : v === -Infinity ? '-∞' : v));
}

export function fromJson<T = Record<string, unknown>>(s: string): T | null {
  try {
    return JSON.parse(s, (_k, v) => (v === '∞' ? Infinity : v === '-∞' ? -Infinity : v)) as T;
  } catch {
    return null;
  }
}
