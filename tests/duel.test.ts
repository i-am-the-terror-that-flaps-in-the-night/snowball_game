import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INPUT_BYTES, NET_PLOW_LEN, NP, PressTracker, SNAP_BYTES, decodeInput, decodeSnap, decodeSnow, dequantDepth, encodeInput,
  encodeSnap, encodeSnow, fromJson, quantDepth, seqNewer, toJson, type InputFrame, type SnapHeader,
} from '../src/net/protocol';
import { CATCHUP_MAX, catchUp, catchUpBonus, cleanLevels, duelPower, garageSpent } from '../src/config/duel';
import { UPGRADES, UPGRADE_BY_ID, upgradeCost, type UpgradeId } from '../src/config/upgrades';
import { Progression, computeStatsFor } from '../src/core/Progression';
import { DuelWallet } from '../src/duel/DuelWallet';
import { ROOM_ALPHABET, makeRoomCode, normalizeRoomCode } from '../src/net/transport';
import { ROOM_CODE_CHARS, cleanRoomCode } from '../src/ui/DuelUI';
import { SnapBuffer } from '../src/duel/plumbing';

const SAVE_KEY = 'snowplow-showdown-save-v2';
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});
afterEach(() => vi.unstubAllGlobals());

/* ------------------------------------------------------------------ snapshots */

describe('snapshot encode / decode', () => {
  it('round-trips the header and both plows exactly (float32)', () => {
    const plows = new Float32Array(2 * NET_PLOW_LEN);
    for (let i = 0; i < plows.length; i++) plows[i] = Math.fround(Math.sin(i * 1.7) * 37 + i * 0.25);
    plows[NP.dead] = 1;
    plows[NET_PLOW_LEN + NP.hp] = 123.5;
    const h: SnapHeader = { phase: 3, seq: 65534, time: 1234.5625, timer: 87.25, round: 2, scoreA: 1, scoreB: 0, flags: 1, inputAck: 4321 };
    const buf = new DataView(new ArrayBuffer(SNAP_BYTES));
    encodeSnap(h, plows, buf);
    const h2 = {} as SnapHeader;
    const p2 = new Float32Array(2 * NET_PLOW_LEN);
    expect(decodeSnap(new DataView(buf.buffer.slice(0)), h2, p2)).toBe(true);
    expect(h2).toEqual(h);
    expect(Array.from(p2)).toEqual(Array.from(plows));
  });

  it('rejects short or foreign messages', () => {
    const h = {} as SnapHeader;
    const p = new Float32Array(2 * NET_PLOW_LEN);
    expect(decodeSnap(new DataView(new ArrayBuffer(10)), h, p)).toBe(false);
    const wrong = new DataView(new ArrayBuffer(SNAP_BYTES));
    wrong.setUint8(0, 9);
    expect(decodeSnap(wrong, h, p)).toBe(false);
  });

  it('snow patches round-trip within one quantisation step', () => {
    const W = 20;
    const depth = new Float32Array(W * W).map((_, i) => ((i * 7919) % 1000) / 600);
    const patches = [{ x0: 2, z0: 3, w: 5, h: 4 }, { x0: 10, z0: 0, w: 1, h: 20 }];
    const msg = encodeSnow(patches, true, (x, z) => quantDepth(depth[z * W + x]));
    const out = new Float32Array(W * W).fill(-1);
    const seen: number[] = [];
    const kf = decodeSnow(msg, (x, z, b) => (out[z * W + x] = dequantDepth(b)), (p) => seen.push(p.w * p.h));
    expect(kf).toBe(true);
    expect(seen).toEqual([20, 20]);
    for (const p of patches) {
      for (let z = p.z0; z < p.z0 + p.h; z++) for (let x = p.x0; x < p.x0 + p.w; x++) expect(Math.abs(out[z * W + x] - depth[z * W + x])).toBeLessThanOrEqual(2 / 255 / 2 + 1e-6);
    }
    expect(out[0]).toBe(-1); // untouched outside the patches
    expect(decodeSnow(msg.subarray(0, msg.length - 3), () => {}, () => {})).toBeNull();
  });

  it('control JSON keeps Infinity (PlayerStats.secondWindCd)', () => {
    const s = computeStatsFor({}, 'volt');
    expect(s.secondWindCd).toBe(Infinity);
    const back = fromJson<{ stats: typeof s }>(toJson({ stats: s }))!;
    expect(back.stats).toEqual(s);
    expect(fromJson('{oops')).toBeNull();
  });
});

/* ------------------------------------------------------------------ input */

describe('input sequencing', () => {
  const frame = (seq: number, presses: [number, number, number, number], throttle = 0, steer = 0): InputFrame => ({ seq, throttle, steer, presses });

  it('encodes into 9 bytes and back', () => {
    const v = new DataView(new ArrayBuffer(INPUT_BYTES));
    encodeInput(frame(70000, [1, 255, 256 + 3, 9], 1, -0.5), v);
    const f = frame(0, [0, 0, 0, 0]);
    expect(decodeInput(v, f)).toBe(true);
    expect(f.seq).toBe(70000 & 0xffff);
    expect(f.presses).toEqual([1, 255, 3, 9]);
    expect(f.throttle).toBe(1);
    expect(f.steer).toBeCloseTo(-0.5, 1);
  });

  it('never loses a press when packets drop, duplicate or arrive out of order', () => {
    // The guest pressed slam 5x and dash 3x across 40 packets; we only receive a shuffled, lossy subset.
    const sent: InputFrame[] = [];
    const c: [number, number, number, number] = [0, 0, 0, 0];
    for (let s = 1; s <= 40; s++) {
      if (s % 8 === 0) c[0]++;
      if (s === 3 || s === 4 || s === 30) c[1]++;
      sent.push(frame(s, [c[0], c[1], c[2], c[3]], s / 40));
    }
    const t = new PressTracker();
    // Drop every 3rd packet, deliver the rest in a scrambled order with a duplicate, but keep the LAST one.
    const recv = sent.filter((_, i) => i % 3 !== 1);
    for (let i = recv.length - 2; i > 0; i -= 2) [recv[i], recv[i - 1]] = [recv[i - 1], recv[i]];
    recv.splice(5, 0, recv[4]);
    for (const f of recv) t.receive(f);
    let slams = 0;
    let dashes = 0;
    for (let k = 0; k < 20; k++) {
      if (t.take(0)) slams++;
      if (t.take(1)) dashes++;
    }
    expect(slams).toBe(5);
    expect(dashes).toBe(3);
    // Axes follow the newest sequence only.
    expect(t.ackSeq).toBe(40);
    expect(t.throttle).toBeCloseTo(1);
  });

  it('hands out one press per frame and survives counter wrap-around', () => {
    const t = new PressTracker();
    t.receive(frame(1, [250, 0, 0, 0]));
    expect(t.pending[0]).toBe(0); // a jump of >127 presses between packets reads as a stale (late) packet
    const u = new PressTracker();
    let n = 0;
    let seq = 0;
    for (let k = 0; k < 600; k++) {
      n++;
      u.receive(frame(++seq & 0xffff, [n & 0xff, 0, 0, 0]));
    }
    let taken = 0;
    while (u.take(0)) taken++;
    expect(taken).toBe(600);
    expect(u.take(0)).toBe(false);
  });

  it('seqNewer wraps', () => {
    expect(seqNewer(2, 1)).toBe(true);
    expect(seqNewer(1, 2)).toBe(false);
    expect(seqNewer(0, 65535)).toBe(true);
    expect(seqNewer(65535, 0)).toBe(false);
  });
});

/* ------------------------------------------------------------------ catch-up */

describe('catch-up coins', () => {
  it('equal garages get nothing', () => {
    expect(catchUp(5000, 5000)).toEqual({ a: 0, b: 0 });
  });

  it('the weaker side gets the gap, the stronger side nothing (symmetric)', () => {
    expect(catchUp(1000, 4500)).toEqual({ a: 3500, b: 0 });
    expect(catchUp(4500, 1000)).toEqual({ a: 0, b: 3500 });
    for (const [x, y] of [[0, 1], [123, 4567], [9999, 10]]) {
      const ab = catchUp(x, y);
      const ba = catchUp(y, x);
      expect(ab.a).toBe(ba.b);
      expect(ab.b).toBe(ba.a);
    }
  });

  it('coins on hand count as power and shrink the bonus', () => {
    const spentA = garageSpent({ engine: 3 });
    const spentB = garageSpent({ engine: 6, armor: 5 });
    const none = catchUpBonus(duelPower(spentA, 0), duelPower(spentB, 0));
    const some = catchUpBonus(duelPower(spentA, 400), duelPower(spentB, 0));
    expect(none).toBe(spentB - spentA);
    expect(some).toBe(none - 400);
  });

  it('is capped for a fresh save against a monster garage', () => {
    const maxed = garageSpent(Object.fromEntries(UPGRADES.map((u) => [u.id, Math.min(u.maxLevel, 40)])));
    expect(maxed).toBeGreaterThan(CATCHUP_MAX);
    expect(catchUpBonus(0, maxed)).toBe(CATCHUP_MAX);
  });

  it('garageSpent sums the shop prices of every level', () => {
    expect(garageSpent({})).toBe(0);
    const d = UPGRADE_BY_ID.engine;
    expect(garageSpent({ engine: 3 })).toBe(upgradeCost(d, 0) + upgradeCost(d, 1) + upgradeCost(d, 2));
  });

  it('cleanLevels drops junk', () => {
    expect(cleanLevels({ engine: 2.7, nope: 3, armor: -1, overclock: 99, blade: 'x' })).toEqual({ engine: 2, overclock: 10 });
    expect(cleanLevels(null)).toEqual({});
  });
});

/* ------------------------------------------------------------------ duel garage */

describe('DuelWallet (duel garage)', () => {
  const freshProg = (coins: number, ups: Partial<Record<UpgradeId, number>> = {}) => {
    const p = new Progression();
    p.data.coins = coins;
    p.data.upgrades = { ...ups };
    p.save();
    return p;
  };

  it('bonus purchases are temporary: they never reach the save', () => {
    const p = freshProg(50, { engine: 2 });
    const before = store.get(SAVE_KEY);
    const w = new DuelWallet(p, 5000);
    expect(w.paysWithBonus('armor')).toBe(true);
    const cost = w.cost('armor');
    expect(w.buy('armor')).toBe(true);
    expect(w.buy('armor')).toBe(true);
    expect(w.buy('engine')).toBe(true);
    expect(w.bonus).toBe(5000 - cost - upgradeCost(UPGRADE_BY_ID.armor, 1) - upgradeCost(UPGRADE_BY_ID.engine, 2));
    expect(w.level('armor')).toBe(2);
    expect(w.level('engine')).toBe(3);
    expect(w.effectiveLevels()).toMatchObject({ armor: 2, engine: 3 });
    // The save is untouched: levels, coins and the stored JSON.
    expect(p.level('armor')).toBe(0);
    expect(p.level('engine')).toBe(2);
    expect(p.coins).toBe(50);
    expect(store.get(SAVE_KEY)).toBe(before);
    // A fresh Progression (next session) never sees them either.
    expect(new Progression().data.upgrades).toEqual({ engine: 2 });
  });

  it('falls back to real coins once the bonus runs dry (normal saved purchase)', () => {
    const p = freshProg(1000);
    const w = new DuelWallet(p, 10);
    expect(w.paysWithBonus('engine')).toBe(false);
    expect(w.cost('engine')).toBe(p.cost('engine'));
    expect(w.buy('engine')).toBe(true);
    expect(p.level('engine')).toBe(1);
    expect(p.coins).toBe(1000 - upgradeCost(UPGRADE_BY_ID.engine, 0));
    expect(JSON.parse(store.get(SAVE_KEY)!).upgrades.engine).toBe(1);
    expect(w.bonus).toBe(10);
  });

  it('effective levels feed the duel stats', () => {
    const p = freshProg(0);
    const w = new DuelWallet(p, 1e6);
    for (let i = 0; i < 5; i++) w.buy('armor');
    const s = computeStatsFor(w.effectiveLevels(), p.plow);
    expect(s.maxHp).toBeGreaterThan(computeStatsFor({}, p.plow).maxHp);
    expect(p.computeStats().maxHp).toBe(computeStatsFor({}, p.plow).maxHp);
  });

  it('respects one-time / capped upgrades', () => {
    const p = freshProg(0, { overclock: 9 });
    const w = new DuelWallet(p, 1e7);
    expect(w.buy('overclock')).toBe(true);
    expect(w.isMaxed('overclock')).toBe(true);
    expect(w.buy('overclock')).toBe(false);
    expect(w.buy('frostCore')).toBe(true);
    expect(w.buy('frostCore')).toBe(false);
  });
});

/* ------------------------------------------------------------------ room codes */

describe('room codes', () => {
  it('uses unambiguous letters only', () => {
    for (const bad of 'ILOSZBUV0125') expect(ROOM_ALPHABET.includes(bad)).toBe(false);
    for (let i = 0; i < 200; i++) expect(normalizeRoomCode(makeRoomCode())).not.toBeNull();
  });
  it('normalises typed codes', () => {
    expect(normalizeRoomCode(' ac-dEf ')).toBe('ACDEF');
    expect(normalizeRoomCode('ACDE')).toBeNull();
    expect(normalizeRoomCode('ACDEO')).toBeNull();
  });
  it('every generated code survives the lobby input filter unchanged (host and join agree)', () => {
    for (const ch of ROOM_ALPHABET) expect(ROOM_CODE_CHARS.includes(ch)).toBe(true);
    for (let i = 0; i < 200; i++) {
      const c = makeRoomCode();
      expect(cleanRoomCode(c.toLowerCase())).toBe(c);
    }
  });
});

/* ------------------------------------------------------------------ guest interpolation */

describe('SnapBuffer (opponent interpolation)', () => {
  it('lerps between bracketing snapshots, the short way round for headings, never blends discrete flags', () => {
    const b = new SnapBuffer();
    const a = new Float32Array(2 * NET_PLOW_LEN);
    const c = new Float32Array(2 * NET_PLOW_LEN);
    a[NP.heading] = Math.PI - 0.1;
    a[NP.whirlT] = -1;
    c[NP.x] = 10;
    c[NP.heading] = -Math.PI + 0.1;
    c[NP.dead] = 1;
    c[NP.whirlT] = 0.05;
    b.push(1, a);
    b.push(2, c);
    b.push(1.5, a); // late / reordered: ignored
    const out = new Float32Array(NET_PLOW_LEN);
    expect(b.sample(1.25, 0, out)).toBe(true);
    expect(out[NP.x]).toBeCloseTo(2.5);
    expect(Math.abs(Math.atan2(Math.sin(out[NP.heading] - Math.PI), Math.cos(out[NP.heading] - Math.PI)))).toBeLessThan(0.06);
    expect(out[NP.dead]).toBe(0);
    expect(out[NP.whirlT]).toBe(-1);
    b.sample(9, 0, out);
    expect(out[NP.x]).toBeCloseTo(10);
    expect(out[NP.dead]).toBe(1);
  });
});
