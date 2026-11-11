import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Combat } from '../src/entities/Combat';
import { Plow } from '../src/entities/Plow';
import { computeStatsFor } from '../src/core/Progression';
import type { DamageOpts, EnemyHandle, GameContext } from '../src/core/types';
import type { PilotBinding } from '../src/entities/pilot';
import { Terrain } from '../src/world/Terrain';
import { NP, NET_PLOW_LEN } from '../src/net/protocol';
import { PLOWS } from '../src/config/plows';
import { FX } from '../src/config/upgrades';
import type { PlowKind } from '../src/config/plows';
import { INPUT_BUFFER } from '../src/entities/plow/constants';
import { ballVolume } from '../src/core/types';
import { RUSH_CHARGE_SLOW,
  CHUNK_MAX, MOMENTUM_SECONDS, RUSH_CHARGE_BASE, RUSH_CHARGE_MIN, RUSH_COST_MIN, RUSH_MAX, RUSH_MIN, RUSH_MIN_SLAM_R, TAP_WINDOW,
  addChunks, cashIn, rushAffordable, rushCharge, rushCost, rushDistance, rushPlan,
} from '../src/entities/combat/classicRush';

/* The Classic Plow's SPACE kit: the tap BALL SLAM packs SNOW CHUNKS, PLOW RUSH (hold) runs on the dash meter and ends
 * in the ball slam that cashes the chunks in. */

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });

let nextId = 1;
function bot(x: number, z: number, hp = 10000): EnemyHandle {
  return { id: nextId++, position: new THREE.Vector3(x, 0, z), radius: 1, hp, maxHp: hp, alive: true, airborne: false, vy: 0, deck: -1 } as unknown as EnemyHandle;
}

/** A Combat bound to a scripted Classic plow at the origin facing +Z (blade tip at z = 2.5). */
function rig(bots: EnemyHandle[], levels: Record<string, number> = {}, kind: PlowKind = 'classic') {
  const stats = computeStatsFor(levels, kind);
  const plow = {
    position: new THREE.Vector3(), heading: 0, hp: 100, maxHp: 100, dead: false, radius: 1.6, heldBallRadius: 0,
    airborne: false, vy: 0, airTime: 0, surfaceY: 0, deck: -1, hop: 0, dashing: false, rushing: false, speed: 0,
    getForward: (o: THREE.Vector3) => o.set(0, 0, 1),
    getBladeTip: (o: THREE.Vector3) => o.set(0, 0, 2.5),
    feedSawFury: () => {},
    stealSnow: () => 0,
    push: () => {},
    damage() {},
  };
  const hits: { e: EnemyHandle; amount: number; source?: string }[] = [];
  const enemies = {
    query: (x: number, z: number, r: number, out: EnemyHandle[] = []) => {
      out.length = 0;
      for (const b of bots) if (b.alive && Math.hypot(b.position.x - x, b.position.z - z) <= r + b.radius) out.push(b);
      return out;
    },
    damage: (e: EnemyHandle, amount: number, o?: DamageOpts) => {
      hits.push({ e, amount, source: o?.source });
      return false;
    },
  };
  const slams: { zoneMult?: number; radius: number }[] = [];
  const events = { emit: (type: string, p: { zoneMult?: number; radius: number }) => type === 'slam' && slams.push(p) };
  const ctx = { scene: new THREE.Scene(), time: 0, fx: noop, ui: noop, impact: noop, terrain: new Terrain() } as unknown as GameContext;
  const snow = new Proxy({}, { get: (_t, k) => (k === 'getDepth' ? () => 0 : noop) });
  const binding = { stats, plow, enemies, input: { throttle: 0, steer: 0, wasPressed: () => false }, audio: noop, snow, events, local: true, authoritative: true } as unknown as PilotBinding;
  const c = new Combat(ctx, binding);
  return { c, hits, plow, stats, slams };
}

describe('Classic SPACE kit: numbers', () => {
  it('rush distance runs 1.5 m at the smallest charge to a hard 20 m cap', () => {
    expect(rushDistance(0)).toBe(RUSH_MIN);
    expect(RUSH_MIN).toBe(1.5);
    expect(rushDistance(1)).toBe(RUSH_MAX);
    expect(RUSH_MAX).toBe(20);
    expect(rushDistance(5)).toBe(20);
    expect(rushDistance(-1)).toBe(1.5);
    expect(rushDistance(0.5)).toBeCloseTo(10.75);
    // The tap window doesn't count toward the charge; a long hold never passes full.
    expect(rushCharge(TAP_WINDOW, 1)).toBe(0);
    expect(rushCharge(TAP_WINDOW + 0.5, 1)).toBeCloseTo(0.5);
    expect(rushCharge(60, 1)).toBe(1);
  });

  it('upgrades shorten the charge time, never the 20 m cap, at every tier', () => {
    const fresh = computeStatsFor({}, 'classic');
    expect(fresh.rushChargeTime).toBeCloseTo(RUSH_CHARGE_BASE);
    let prev = Infinity;
    for (const L of [0, 3, 5, 10, 20, 60, 500]) {
      const st = computeStatsFor({ engine: L, nitro: L, hopper: L, packedIce: L, overclock: Math.min(10, L) }, 'classic');
      const t = st.rushChargeTime!;
      expect(t).toBeLessThanOrEqual(prev);
      expect(t).toBeGreaterThanOrEqual(RUSH_CHARGE_MIN);
      prev = t;
      // Full meter: the smallest charge is 1.5 m, a full one exactly 20 m, however long it is held.
      expect(rushPlan(rushCharge(TAP_WINDOW, t), 1).dist).toBe(1.5);
      expect(rushPlan(rushCharge(TAP_WINDOW + t, t), 1).dist).toBe(20);
      expect(rushPlan(rushCharge(30, t), 1).dist).toBe(20);
    }
    expect(prev).toBeLessThan(RUSH_CHARGE_BASE);
  });

  it('the rush and the dash share one meter: cost = max(0.25, distance / 20)', () => {
    expect(rushCost(1.5)).toBe(RUSH_COST_MIN);
    expect(RUSH_COST_MIN).toBe(0.25);
    expect(rushCost(5)).toBe(0.25);
    expect(rushCost(10)).toBeCloseTo(0.5);
    expect(rushCost(20)).toBe(1);
    expect(rushCost(400)).toBe(1);
    // Below the minimum cost there is no rush at all; above it the meter caps the distance.
    expect(rushAffordable(0.2)).toBe(0);
    expect(rushPlan(1, 0.2)).toEqual({ dist: 0, cost: 0 });
    expect(rushAffordable(0.25)).toBeCloseTo(5);
    const half = rushPlan(1, 0.5);
    expect(half.dist).toBeCloseTo(10);
    expect(half.cost).toBeCloseTo(0.5);
    const short = rushPlan(0, 1);
    expect(short.dist).toBe(1.5);
    expect(short.cost).toBe(0.25);
    const full = rushPlan(1, 1);
    expect(full).toEqual({ dist: 20, cost: 1 });
  });

  it('chunks cap at 10; the cash-in is +5% radius and +4% damage per chunk', () => {
    expect(addChunks(0, 1)).toBe(1);
    expect(addChunks(8, 5)).toBe(CHUNK_MAX);
    expect(CHUNK_MAX).toBe(10);
    expect(addChunks(3, 0)).toBe(3);
    expect(cashIn(0)).toEqual({ radius: 1, damage: 1 });
    expect(cashIn(5).radius).toBeCloseTo(1.25);
    expect(cashIn(5).damage).toBeCloseTo(1.2);
    expect(cashIn(10).radius).toBeCloseTo(1.5);
    expect(cashIn(10).damage).toBeCloseTo(1.4);
    expect(cashIn(99)).toEqual(cashIn(10));
  });

  it('Classic HP and Inferno reach follow the rework (+15% HP, 10 m base flame)', () => {
    expect(PLOWS.classic.hpMult).toBe(1.15);
    expect(FX.flameRange(0)).toBe(10);
    expect(FX.flameRange(5)).toBeCloseTo(14);
  });
});

describe('Tap BALL SLAM packs SNOW CHUNKS (Combat.tapSlam)', () => {
  // A 1.5 m ball slammed at (0, 5): zone 1.5 x 1.3 + 2.6 x 0.35 = 2.86 m.
  it('every bot the slam hits packs one chunk; a miss packs none', () => {
    const { c, hits } = rig([bot(0, 5), bot(1, 4), bot(-1, 4), bot(0, 12)]);
    expect(c.chunks).toBe(0);
    expect(c.tapSlam(0, 5, 1.5, 0)).toBe(3);
    expect(hits.length).toBe(3);
    expect(c.chunks).toBe(3);
    expect(c.tapSlam(0, 30, 1.5, 0)).toBe(0);
    expect(c.chunks).toBe(3);
  });

  it('chunks stop at 10 however many slams land', () => {
    const { c } = rig([bot(0, 5), bot(-1, 4), bot(1, 4)]);
    for (let i = 0; i < 4; i++) c.tapSlam(0, 5, 1.5, 0);
    expect(c.chunks).toBe(10);
  });

  it('is the plain ball slam: held chunks do not boost it (only the rush slam cashes them in)', () => {
    const plain = rig([bot(0, 5)]);
    plain.c.slamAt(0, 5, 1.5, 0);
    const loaded = rig([bot(0, 5), bot(-1, 4), bot(1, 4)]);
    for (let i = 0; i < 4; i++) loaded.c.tapSlam(0, 5, 1.5, 0);
    loaded.hits.length = 0;
    loaded.c.tapSlam(0, 5, 1.5, 0);
    expect(loaded.hits[0].amount).toBeCloseTo(plain.hits[0].amount);
    expect(loaded.slams.every((e) => e.zoneMult === undefined)).toBe(true);
    expect(loaded.c.chunks).toBe(10);
  });

  it('a vehicle on the snowball kit slams without chunks', () => {
    const { c } = rig([bot(0, 5), bot(1, 4)], {}, 'brute');
    expect(c.tapSlam(0, 5, 1.5, 0)).toBe(2);
    expect(c.chunks).toBe(-1);
  });
});

describe('PLOW RUSH slam cash-in (Combat.rushSlam)', () => {
  it('spends every chunk: zone x(1 + 0.05 n), damage x(1 + 0.04 n), then the chunks reset', () => {
    // Fresh blade 2.6 m: a 0.6 m slam's zone is 0.78 + 0.91 = 1.69 m, x1.5 with 10 chunks = 2.535 m.
    const centre = bot(0, 10);
    const edge = bot(3, 10);
    const plain = rig([centre, edge]);
    plain.c.rushSlam(0, 10, RUSH_MIN_SLAM_R, 0);
    expect(plain.hits.map((h) => h.e)).toEqual([centre]);
    expect(plain.slams[0].zoneMult).toBeUndefined();

    const slamBots = [bot(0, 5), bot(-1, 4), bot(1, 4)];
    const loaded = rig([...slamBots, centre, edge]);
    for (let i = 0; i < 4; i++) loaded.c.tapSlam(0, 5, 1.5, 0);
    expect(loaded.c.chunks).toBe(10);
    loaded.hits.length = 0;
    loaded.slams.length = 0;
    loaded.c.rushSlam(0, 10, RUSH_MIN_SLAM_R, 0);
    const got = loaded.hits.filter((h) => h.e === centre || h.e === edge);
    expect(got.map((h) => h.e)).toEqual([centre, edge]);
    expect(got[0].amount / plain.hits[0].amount).toBeCloseTo(1.4);
    expect(loaded.slams[0].zoneMult).toBeCloseTo(1.5);
    expect(loaded.c.chunks).toBe(0);
  });

  it('chunks ride the Duel snapshot (the guest HUD / predicted cash-in read the host count)', () => {
    const host = rig([bot(0, 5), bot(1, 4)]);
    host.c.tapSlam(0, 5, 1.5, 0);
    const buf = new Float32Array(NET_PLOW_LEN);
    host.c.writeNet(buf, 0);
    expect(buf[NP.chunks]).toBe(2);
    const guest = rig([]);
    guest.c.readNet(buf, 0, false);
    expect(guest.c.chunks).toBe(2);
    expect(guest.c.chunkRadiusMult).toBeCloseTo(1.1);
  });
});

/** A Plow with only the SPACE-kit state (no model: the constructor is skipped), driven through updateClassicSpace. */
function spacePlow(dashCharge = 1) {
  const stats = computeStatsFor({}, 'classic');
  const keys = { pressed: false, down: false };
  const audio: string[] = [];
  const p = Object.create(Plow.prototype) as Record<string, unknown>;
  Object.assign(p, {
    b: {
      stats,
      input: { throttle: 0, steer: 0, wasPressed: (k: string) => k === 'Space' && keys.pressed, isDown: (k: string) => k === 'Space' && keys.down },
      audio: { play: (n: string) => audio.push(n) },
    },
    spaceT: -1, rushNoMeter: false, slamBuffer: 0, slamPhase: 0, rushChargeK: -1, rushDist: 0, rushLeft: 0,
    rushT: 0, rushStall: 0, rushStop: false, momentumT: 0, whirlT: -1, dashT: 0, dashCharge, speed: 0, kick: 0,
    pushVel: new THREE.Vector3(), rushLaunchFx: () => {},
  });
  const step = (dt = 1 / 60) => {
    (p.updateClassicSpace as (dt: number, high: boolean) => void).call(p, dt, false);
    keys.pressed = false;
  };
  const hold = (seconds: number) => {
    keys.pressed = true;
    keys.down = true;
    for (let t = 0; t < seconds - 1e-9; t += 1 / 60) step();
  };
  const release = () => {
    keys.down = false;
    step();
  };
  const slams = () => ((p.slamBuffer as number) > 0 ? 1 : 0);
  return { p, step, hold, release, slams, audio };
}

describe('Classic SPACE input (Plow.updateClassicSpace)', () => {
  it('a tap is the ball slam (the slam buffer, as on the original plow); no rush, no meter spent', () => {
    const { p, hold, release, slams } = spacePlow();
    hold(0.1);
    expect(slams()).toBe(0);
    release();
    expect(slams()).toBe(1);
    expect(p.slamBuffer).toBe(INPUT_BUFFER);
    expect(p.rushLeft).toBe(0);
    expect(p.dashCharge).toBe(1);
  });

  it('a hold charges (telegraph distance) and the release rushes, spending the shared meter by distance', () => {
    const { p, hold, release, slams } = spacePlow();
    hold(TAP_WINDOW + 0.5);
    expect(p.rushChargeK as number).toBeGreaterThan(0.4);
    const dist = p.rushDist as number;
    expect(dist).toBeGreaterThan(9);
    release();
    expect(slams()).toBe(0);
    expect(p.rushLeft).toBeCloseTo(dist);
    expect(p.dashCharge as number).toBeCloseTo(1 - dist / 20);
    expect(p.rushChargeK).toBe(-1);
  });

  it('the first bot or opponent the rushing blade meets ends the rush (slam there); no contact keeps it going', () => {
    const { p, hold, release } = spacePlow();
    hold(5);
    release();
    // dashHits: nothing in front -> keeps rushing.
    const q: { alive: boolean }[] = [];
    Object.assign(p, {
      position: new THREE.Vector3(), speed: 28, bladeWidth: 2.6, queryOut: [], dashTargets: [],
      b: { ...(p.b as object), enemies: { query: () => q } },
    });
    const dashHits = (p.dashHits as () => void).bind(p);
    dashHits();
    expect(p.rushStop).toBe(false);
    q.push({ alive: false });
    dashHits();
    expect(p.rushStop).toBe(false);
    q.push({ alive: true });
    dashHits();
    expect(p.rushStop).toBe(true);
    // A body contact through Combat.playerRam does the same.
    p.rushStop = false;
    (p.rushContact as () => void).call(p);
    expect(p.rushStop).toBe(true);
  });

  it('charging does not slow the plow (full top speed while the line is up)', () => {
    expect(RUSH_CHARGE_SLOW).toBe(1);
  });

  it('a full hold rushes exactly 20 m and empties the meter', () => {
    const { p, hold, release } = spacePlow();
    hold(5);
    expect(p.rushChargeK).toBe(1);
    release();
    expect(p.rushLeft).toBe(20);
    expect(p.dashCharge).toBe(0);
  });

  it('the rush is capped by what the meter can pay for', () => {
    const { p, hold, release } = spacePlow(0.5);
    hold(5);
    expect(p.rushDist as number).toBeCloseTo(10);
    release();
    expect(p.rushLeft as number).toBeCloseTo(10);
    expect(p.dashCharge as number).toBeCloseTo(0);
  });

  it('with the meter under the minimum cost, the hold buzzes once and the release slams instead', () => {
    const { p, hold, release, slams, audio } = spacePlow(0.2);
    hold(1);
    expect(p.rushChargeK).toBe(-1);
    expect(audio.filter((n) => n === 'error').length).toBe(1);
    release();
    expect(p.rushLeft).toBe(0);
    expect(slams()).toBe(1);
    expect(p.dashCharge).toBe(0.2);
  });

  it('a dash or a whirl during the hold drops the charge', () => {
    const { p, hold, release, slams } = spacePlow();
    hold(0.6);
    p.dashT = 0.4;
    hold(0.05);
    expect(p.rushChargeK).toBe(-1);
    p.dashT = 0;
    release();
    expect(p.rushLeft).toBe(0);
    expect(slams()).toBe(0);
  });
});

/** A Plow with only the slam-impact state (no model), for PlowMotion.slamImpact. */
function impactPlow(kind: PlowKind, tapHits: number) {
  const calls: string[] = [];
  const p = Object.create(Plow.prototype) as Record<string, unknown>;
  Object.assign(p, {
    kind,
    b: {
      stats: computeStatsFor({}, kind),
      audio: { play: () => {} },
      combat: {
        tapSlam: () => (calls.push('tap'), tapHits),
        slamAt: () => (calls.push('slam'), tapHits),
      },
    },
    heldVolume: ballVolume(1.2), ballR: 1.2, ball: { visible: true }, glow: { visible: true }, ballWasVisible: true,
    slamHit: false, slamCd: 0, kick: 0, momentumT: 0,
    getBladeTip: (o: THREE.Vector3) => o.set(0, 0, 2.5),
    getForward: (o: THREE.Vector3) => o.set(0, 0, 1),
  });
  const impact = () => (p.slamImpact as () => void).call(p);
  return { p, calls, impact };
}

describe('Classic tap slam impact (PlowMotion.slamImpact)', () => {
  it('goes through Combat.tapSlam (chunks) and a landed slam starts MOMENTUM; the ball is spent', () => {
    const { p, calls, impact } = impactPlow('classic', 2);
    impact();
    expect(calls).toEqual(['tap']);
    expect(p.momentumT).toBe(MOMENTUM_SECONDS);
    expect(p.heldVolume as number).toBeLessThan(ballVolume(1.2) * 0.01);
    expect(p.slamCd as number).toBeGreaterThan(0);
  });

  it('a slam that hits nothing gives no MOMENTUM', () => {
    const { p, impact } = impactPlow('classic', 0);
    impact();
    expect(p.momentumT).toBe(0);
  });

  it('other plows on the snowball kit keep the plain slam (no chunks, no MOMENTUM)', () => {
    const { p, calls, impact } = impactPlow('brute', 3);
    impact();
    expect(calls).toEqual(['slam']);
    expect(p.momentumT).toBe(0);
  });
});
