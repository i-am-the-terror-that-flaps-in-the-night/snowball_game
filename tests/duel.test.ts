import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INPUT_BYTES, NET_PLOW_LEN, NP, NP_DISCRETE, PROTOCOL_VERSION, PressTracker, SNAP_BYTES, decodeInput, decodeSnap, decodeSnow, dequantDepth, encodeInput,
  encodeSnap, encodeSnow, fromJson, quantDepth, seqNewer, toJson, type InputFrame, type SnapHeader,
} from '../src/net/protocol';
import { CATCHUP_MAX, DUEL_ZONE, catchUp, catchUpBonus, cleanDuelGear, cleanLevels, duelBonus, duelPower, duelSpent, garageSpent, sharedMatchCost } from '../src/config/duel';
import { GEAR, GEAR_BY_ID, GEAR_MAX_LEVEL, gearCost, gearLevels, gearSpent } from '../src/config/gear';
import { ZONES } from '../src/config/zones';
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

/* DUEL_ZONE is built from an explicit field list so biome / terrain / hazard data added to arena 1 never leaks into
 * Duel. Adding a field to this list is a deliberate choice (e.g. when Duel gets its biome pool). */
describe('duel arena', () => {
  it('pins its own fields and inherits nothing else from arena 1', () => {
    expect(Object.keys(DUEL_ZONE).sort()).toEqual([
      'ambientColor', 'ambientIntensity', 'bossName', 'clearReward', 'coinMult', 'enemyHpMult', 'fogColor', 'fogFar', 'fogNear',
      'id', 'index', 'name', 'rounds', 'skyBottom', 'skyTop', 'snowDepth', 'snowRegenMult', 'snowTint', 'snowfall',
      'sunColor', 'sunIntensity', 'tagline', 'terrain', 'theme',
    ]);
    expect(DUEL_ZONE.terrain).toBeUndefined();
    expect('biome' in DUEL_ZONE).toBe(false);
    expect(DUEL_ZONE.index).toBe(ZONES[0].index);
    expect(DUEL_ZONE.rounds.every((r) => r.groups.length === 0)).toBe(true);
    expect(DUEL_ZONE.coinMult).toBe(0);
  });
});

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

  it('encodes into INPUT_BYTES and back', () => {
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

  it('covers the full gap, uncapped, for a fresh save against a monster garage', () => {
    const maxed = garageSpent(Object.fromEntries(UPGRADES.map((u) => [u.id, Math.min(u.maxLevel, 40)])));
    expect(CATCHUP_MAX).toBe(Infinity);
    expect(catchUpBonus(0, maxed)).toBe(Math.round(maxed));
  });

  it('never pays the stronger (or equal) side anything', () => {
    for (const [a, b] of [[1000, 400], [5e6, 0], [777, 777]]) {
      expect(catchUpBonus(a, b)).toBe(0);
      const both = catchUp(a, b);
      expect(Math.min(both.a, both.b)).toBe(0);
    }
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

  it('MATCH OPPONENT copies shared upgrades from the bonus only, skipping plow-specific lines', () => {
    const p = freshProg(0, { engine: 1 });
    const before = store.get(SAVE_KEY);
    const w = new DuelWallet(p, 1e7);
    const target: Partial<Record<UpgradeId, number>> = { engine: 4, armor: 3, brutePound: 5, voltChain: 2 };
    const plan = w.matchPlan(target);
    expect(plan.missing).toBe(0);
    expect(w.matchOpponent(target)).toBe(plan.buys.length);
    expect(w.level('engine')).toBe(4);
    expect(w.level('armor')).toBe(3);
    expect(w.level('brutePound')).toBe(0);
    expect(w.level('voltChain')).toBe(0);
    expect(w.bonus).toBe(1e7 - plan.cost);
    expect(store.get(SAVE_KEY)).toBe(before);
    // Already matched: nothing left to buy.
    expect(w.matchPlan(target).buys).toHaveLength(0);
  });

  it('MATCH OPPONENT with too little bonus buys the cheapest levels and reports the shortfall', () => {
    const p = freshProg(5000);
    const target: Partial<Record<UpgradeId, number>> = { engine: 6, armor: 6 };
    const one = upgradeCost(UPGRADE_BY_ID.engine, 0);
    const w = new DuelWallet(p, one);
    const plan = w.matchPlan(target);
    expect(plan.cost).toBeLessThanOrEqual(one);
    expect(plan.missing).toBeGreaterThan(0);
    w.matchOpponent(target);
    expect(p.coins).toBe(5000); // never touches real coins
  });

  it('duelBonus: the weaker side gets the opponent\'s full value (spend incl. plow lines + coins) minus its own spend', () => {
    const strong = { levels: { engine: 5, brutePound: 4 }, coins: 3000, spent: 0 };
    strong.spent = garageSpent(strong.levels);
    const weak = { levels: { engine: 1 }, coins: 800, spent: 0 };
    weak.spent = garageSpent(weak.levels);
    const r = duelBonus(weak, strong);
    expect(r.b).toBe(0);
    expect(r.a).toBe(strong.spent + strong.coins - weak.spent); // own unspent coins don't reduce it
    expect(r.a).toBeGreaterThanOrEqual(sharedMatchCost(weak.levels, strong.levels));
    expect(duelBonus(strong, weak)).toEqual({ a: 0, b: r.a });
    expect(duelBonus(weak, weak)).toEqual({ a: 0, b: 0 });
  });

  it('duelBonus always covers MATCH OPPONENT, even when the weaker side over-invested elsewhere', () => {
    const a = { levels: { armor: 12 }, coins: 0, spent: 0 };
    a.spent = garageSpent(a.levels);
    const b = { levels: { engine: 8 }, coins: 0, spent: 0 };
    b.spent = garageSpent(b.levels);
    const weakIsA = duelPower(a.spent, 0) < duelPower(b.spent, 0);
    const r = duelBonus(a, b);
    const weak = weakIsA ? a : b;
    const opp = weakIsA ? b : a;
    expect(weakIsA ? r.a : r.b).toBeGreaterThanOrEqual(sharedMatchCost(weak.levels, opp.levels));
  });

  it('commitTemp keeps catch-up levels in the save', () => {
    const p = freshProg(0, { engine: 1 });
    const w = new DuelWallet(p, 1e6);
    w.buy('engine');
    w.buy('armor');
    expect(p.level('engine')).toBe(1);
    w.commitTemp();
    expect(p.level('engine')).toBe(2);
    expect(p.level('armor')).toBe(1);
    expect(w.level('engine')).toBe(2); // not double-counted
    expect(JSON.parse(store.get(SAVE_KEY)!).upgrades.armor).toBe(1);
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

describe('height sync (terrain: feet height, vertical speed, airborne)', () => {
  it('is part of protocol v4: three floats at the end of each 35-float plow block', () => {
    expect(PROTOCOL_VERSION).toBe(4);
    expect(NET_PLOW_LEN).toBe(35);
    expect([NP.y, NP.vy, NP.air]).toEqual([32, 33, 34]);
    const idx = Object.values(NP);
    expect(new Set(idx).size).toBe(idx.length);
    expect(Math.max(...idx)).toBe(NET_PLOW_LEN - 1);
    // y / vy blend; the airborne flag is discrete.
    expect(NP_DISCRETE).toContain(NP.air);
    expect(NP_DISCRETE).not.toContain(NP.y);
    expect(NP_DISCRETE).not.toContain(NP.vy);
  });

  it('round-trips both plows\' height fields through a snapshot', () => {
    const plows = new Float32Array(2 * NET_PLOW_LEN);
    plows[NP.y] = 7.25;
    plows[NP.vy] = -11.5;
    plows[NP.air] = 1;
    plows[NET_PLOW_LEN + NP.y] = 0.125;
    plows[NET_PLOW_LEN + NP.vy] = 3.75;
    plows[NET_PLOW_LEN + NP.air] = 0;
    const h: SnapHeader = { phase: 1, seq: 7, time: 3, timer: 60, round: 0, scoreA: 0, scoreB: 0, flags: 0, inputAck: 0 };
    const buf = new DataView(new ArrayBuffer(SNAP_BYTES));
    encodeSnap(h, plows, buf);
    const p2 = new Float32Array(2 * NET_PLOW_LEN);
    expect(decodeSnap(buf, {} as SnapHeader, p2)).toBe(true);
    expect([p2[NP.y], p2[NP.vy], p2[NP.air]]).toEqual([7.25, -11.5, 1]);
    expect([p2[NET_PLOW_LEN + NP.y], p2[NET_PLOW_LEN + NP.vy], p2[NET_PLOW_LEN + NP.air]]).toEqual([0.125, 3.75, 0]);
  });

  it('interpolation lerps y / vy and never blends the airborne flag (it switches at the newer snapshot)', () => {
    const b = new SnapBuffer();
    const a = new Float32Array(2 * NET_PLOW_LEN);
    const c = new Float32Array(2 * NET_PLOW_LEN);
    // Guest block (which = 1): leaving a ramp lip between the two snapshots.
    a[NET_PLOW_LEN + NP.y] = 1;
    a[NET_PLOW_LEN + NP.vy] = 2;
    a[NET_PLOW_LEN + NP.air] = 0;
    c[NET_PLOW_LEN + NP.y] = 3;
    c[NET_PLOW_LEN + NP.vy] = -6;
    c[NET_PLOW_LEN + NP.air] = 1;
    b.push(10, a);
    b.push(10.1, c);
    const out = new Float32Array(NET_PLOW_LEN);
    expect(b.sample(10.025, 1, out)).toBe(true);
    expect(out[NP.y]).toBeCloseTo(1.5, 5);
    expect(out[NP.vy]).toBeCloseTo(0, 5);
    expect(out[NP.air]).toBe(0);
    b.sample(10.075, 1, out);
    expect(out[NP.y]).toBeCloseTo(2.5, 5);
    expect(out[NP.vy]).toBeCloseTo(-4, 5);
    expect(out[NP.air]).toBe(0);
    b.sample(10.1, 1, out);
    expect([out[NP.y], out[NP.vy], out[NP.air]]).toEqual([3, -6, 1]);
    // The host block is untouched by the guest's values.
    b.sample(10.05, 0, out);
    expect([out[NP.y], out[NP.vy], out[NP.air]]).toEqual([0, 0, 0]);
  });
});

/* ------------------------------------------------------------------ duel gear */

describe('duel garage gear', () => {
  const freshProg = (coins: number) => {
    const p = new Progression();
    p.data.coins = coins;
    p.data.upgrades = {};
    p.save();
    return p;
  };
  const common = GEAR.find((d) => d.rarity === 'common')!;

  it('duelSpent values equipped gear at its real price, not at the stat curves', () => {
    const gear = { [common.id]: 3 };
    const levels = { ...(gearLevels({ owned: gear, equipped: { [common.slot]: common.id } }) as Record<string, number>), engine: 2 };
    expect(duelSpent(levels, gear)).toBe(garageSpent({ engine: 2 }) + gearSpent(common, 3));
    expect(duelSpent({ engine: 2 }, {})).toBe(garageSpent({ engine: 2 }));
  });

  it('duelSpent ignores claimed gear that does not match the levels', () => {
    const fake = { [common.id]: 10 };
    // Claims a ★10 item but fights with none of its stats: valued on the levels alone.
    expect(duelSpent({ engine: 2 }, fake)).toBe(garageSpent({ engine: 2 }));
    const grants = gearLevels({ owned: { [common.id]: 1 }, equipped: { [common.slot]: common.id } }) as Record<string, number>;
    // Fights with ★1 stats but claims ★10: also rejected.
    expect(duelSpent({ ...grants }, fake)).toBe(garageSpent(grants));
  });

  it('cleanDuelGear drops unknown ids, bad levels and second items in a slot', () => {
    const sameSlot = GEAR.filter((d) => d.slot === common.slot);
    const raw: Record<string, unknown> = { nope: 3, [sameSlot[0].id]: 99, [sameSlot[1].id]: 2, bad: 'x' };
    const g = cleanDuelGear(raw);
    expect(Object.keys(g)).toEqual([sameSlot[0].id]);
    expect(g[sameSlot[0].id]).toBe(GEAR_MAX_LEVEL);
    expect(cleanDuelGear(null)).toEqual({});
  });

  it('the bonus buys temporary gear that counts in effective levels and is committed at match start', () => {
    const p = freshProg(0);
    const before = store.get(SAVE_KEY);
    const w = new DuelWallet(p, 1e6);
    expect(w.paysItemWithBonus(common.id)).toBe(true);
    expect(w.itemCost(common.id)).toBe(gearCost(common, 0));
    expect(w.buyItem(common.id)).toBe(true);
    expect(w.buyItem(common.id)).toBe(true);
    expect(w.itemLevel(common.id)).toBe(2);
    expect(w.isEquipped(common.id)).toBe(true);
    const grants = gearLevels({ owned: { [common.id]: 2 }, equipped: { [common.slot]: common.id } });
    expect(w.effectiveLevels()).toMatchObject(grants);
    expect(w.bonus).toBe(1e6 - gearCost(common, 0) - gearCost(common, 1));
    // Nothing reaches the save until the match starts...
    expect(p.itemLevel(common.id)).toBe(0);
    expect(store.get(SAVE_KEY)).toBe(before);
    // ...then it's yours, equipped.
    w.commitTemp();
    expect(p.itemLevel(common.id)).toBe(2);
    expect(p.isEquipped(common.id)).toBe(true);
    expect(new Progression().itemLevel(common.id)).toBe(2);
  });

  it('falls back to real coins for gear once the bonus is short, and equip toggles work on bonus items', () => {
    const p = freshProg(common.cost);
    const w = new DuelWallet(p, 0);
    expect(w.paysItemWithBonus(common.id)).toBe(false);
    expect(w.buyItem(common.id)).toBe(true);
    expect(p.itemLevel(common.id)).toBe(1);
    expect(p.coins).toBe(0);
    expect(w.toggleEquip(common.id)).toBe(true);
    expect(w.isEquipped(common.id)).toBe(false);
    expect(w.effectiveLevels()).toEqual({});
    expect(w.canBuyItem(GEAR_BY_ID[common.id].id)).toBe(false);
  });

  it('stops at the max item level', () => {
    const p = freshProg(0);
    const w = new DuelWallet(p, 1e9);
    for (let i = 0; i < GEAR_MAX_LEVEL + 3; i++) w.buyItem(common.id);
    expect(w.itemLevel(common.id)).toBe(GEAR_MAX_LEVEL);
    expect(w.itemCost(common.id)).toBe(Infinity);
    expect(w.canBuyItem(common.id)).toBe(false);
  });
});

/* ------------------------------------------------------------------ ICE / TURN */

import { buildIce } from '../src/net/transport';

describe('ICE servers', () => {
  it('STUN only by default', () => {
    const { config, turn } = buildIce({});
    expect(turn).toBe(false);
    expect(config.iceServers!.length).toBeGreaterThan(0);
    expect(JSON.stringify(config.iceServers)).not.toContain('turn:');
  });

  it('adds a TURN relay from the env, keeping only turn:/turns: URLs', () => {
    const { config, turn } = buildIce({ VITE_TURN_URLS: ' turn:r.example.com:80 , turns:r.example.com:443?transport=tcp, http://nope ', VITE_TURN_USERNAME: 'u', VITE_TURN_CREDENTIAL: 'p' });
    expect(turn).toBe(true);
    const relay = config.iceServers!.find((s) => s.username === 'u')!;
    expect(relay.urls).toEqual(['turn:r.example.com:80', 'turns:r.example.com:443?transport=tcp']);
    expect(relay.credential).toBe('p');
  });
});

/* ------------------------------------------------------------------ AUTO-SPEND */

describe('DuelWallet AUTO-SPEND', () => {
  const fresh = (coins = 0) => {
    const p = new Progression();
    p.data.coins = coins;
    p.data.upgrades = {};
    p.data.gear = { owned: {}, equipped: {} };
    p.save();
    return p;
  };

  it('matches the opponent first, then spends the rest on a spread of upgrades and gear, bonus only', () => {
    const p = fresh(777);
    const before = store.get(SAVE_KEY);
    const w = new DuelWallet(p, 20000);
    const target: Partial<Record<UpgradeId, number>> = { engine: 3, armor: 2 };
    expect(w.canAutoSpend(target)).toBe(true);
    const n = w.autoSpend(target);
    expect(n).toBeGreaterThan(5);
    expect(w.level('engine')).toBeGreaterThanOrEqual(3);
    expect(w.level('armor')).toBeGreaterThanOrEqual(2);
    // It spread: several core stats and at least one gear item, and every slot it filled is equipped.
    const coreBought = ['engine', 'armor', 'packedIce', 'hopper'].filter((id) => w.level(id as UpgradeId) > 0);
    expect(coreBought.length).toBeGreaterThanOrEqual(3);
    const items = w.tempItemLevels();
    expect(Object.keys(items).length).toBeGreaterThan(0);
    for (const id of Object.keys(items)) expect(w.isEquipped(id)).toBe(true);
    // Never on stats a duel ignores (coin magnet, snow regrowth).
    expect(items.luckyMagnet).toBeUndefined();
    expect(items.snowGlobe).toBeUndefined();
    // Whatever is left can't buy anything, real coins and the save are untouched.
    expect(w.canAutoSpend(target)).toBe(false);
    expect(w.autoSpend(target)).toBe(0);
    expect(p.coins).toBe(777);
    expect(store.get(SAVE_KEY)).toBe(before);
  });

  it('only buys the plow line of the plow being driven, and never with no bonus', () => {
    const p = fresh();
    p.data.plow = 'brute';
    const w = new DuelWallet(p, 50000);
    w.autoSpend(null);
    expect(w.level('voltChain')).toBe(0);
    expect(w.level('isoMeltdown')).toBe(0);
    expect(w.level('brutePound') + w.level('bruteHide')).toBeGreaterThan(0);
    const none = new DuelWallet(fresh(), 0);
    expect(none.canAutoSpend({ engine: 5 })).toBe(false);
    expect(none.autoSpend({ engine: 5 })).toBe(0);
  });
});
