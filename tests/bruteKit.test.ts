import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Combat } from '../src/entities/Combat';
import { computeStatsFor } from '../src/core/Progression';
import type { EnemyHandle, GameContext } from '../src/core/types';
import type { PilotBinding } from '../src/entities/pilot';
import { fistDamage } from '../src/entities/combat/brute';

/* BRUTUS / WRECKING MECH: SPACE Wrecking Fist (3-punch combo) and E Saw Charge (combat/brute.ts). */

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });
const DT = 1 / 60;

function rig(botZ = 4) {
  const press = new Set<string>();
  const held = new Set<string>();
  const pushes: [number, number][] = [];
  const bot = { id: 1, position: new THREE.Vector3(0, 0, botZ), radius: 1, hp: 1e6, maxHp: 1e6, alive: true, type: 'grunt', mass: 1, isBoss: false };
  const hits: { amount: number; stun?: number; knock: number }[] = [];
  const poses: number[][] = [];
  const plow = {
    position: new THREE.Vector3(), heading: 0, hp: 100, maxHp: 100, dead: false, radius: 1.6, speed: 0, surfaceY: 0, whirlCharge: 1,
    turretAim: 0, heldBallRadius: 0, sawHalo: 0, dashing: false, whirling: false, invulnerable: false,
    get eCharge() {
      return plow.whirlCharge;
    },
    spendE() {
      plow.whirlCharge = 0;
    },
    push: (x: number, z: number) => void pushes.push([x, z]),
    getForward: (o: THREE.Vector3) => o.set(0, 0, 1),
    mountWorld: (_k: string, _i: number, o: THREE.Vector3) => o.set(0, 1, 0),
    feedSawFury: () => {},
    bruteRig: { pose: (_dt: number, l: number, r: number, saw: number) => void poses.push([l, r, saw]) },
  };
  const enemies = {
    query: (x: number, z: number, r: number, o: EnemyHandle[] = []) => {
      o.length = 0;
      if (bot.alive && Math.hypot(bot.position.x - x, bot.position.z - z) <= r + bot.radius) o.push(bot as unknown as EnemyHandle);
      return o;
    },
    damage: (_e: EnemyHandle, amount: number, opts?: { stunSeconds?: number; knockback?: THREE.Vector3 }) => {
      hits.push({ amount, stun: opts?.stunSeconds, knock: opts?.knockback ? opts.knockback.length() : 0 });
      bot.hp -= amount;
      return false;
    },
    bosses: [],
  };
  const stats = computeStatsFor({}, 'brute');
  const binding = {
    stats, plow, enemies, snow: noop, events: noop, local: false, authoritative: true, look: null,
    input: { throttle: 0, steer: 0, wasPressed: (k: string) => press.has(k), isDown: (k: string) => held.has(k) },
    audio: { play: () => {}, setPlowing: () => {} },
  } as unknown as PilotBinding;
  const ctx = { scene: new THREE.Scene(), time: 0, fx: noop, ui: noop, impact: noop, cameraRig: noop } as unknown as GameContext;
  const c = new Combat(ctx, binding);
  c.clear();
  const run = (s: number) => {
    for (let i = 0, n = Math.round(s / DT); i < n; i++) {
      (ctx as { time: number }).time += DT;
      c.update(DT);
      press.clear();
    }
  };
  return { c, plow, press, held, hits, pushes, poses, stats, run };
}

describe('BRUTUS Wrecking Fist (SPACE)', () => {
  it('holding SPACE throws jab, jab, finisher (harder, stuns, big knockback), and loops with no recovery', () => {
    const r = rig();
    r.held.add('Space');
    r.press.add('Space');
    r.run(0.7);
    expect(r.hits.length).toBe(3);
    const jab = fistDamage(r.stats) * r.stats.damageMult;
    expect(r.hits[0].amount).toBeCloseTo(jab, 3);
    expect(r.hits[1].amount).toBeCloseTo(jab, 3);
    expect(r.hits[2].amount).toBeGreaterThan(jab * 2);
    expect(r.hits[2].stun).toBeGreaterThan(0);
    expect(r.hits[2].knock).toBeGreaterThan(r.hits[0].knock * 2.5);
    // Every jab that lands square staggers (a short stun); the finisher stuns longer.
    expect(r.hits[0].stun).toBeGreaterThan(0);
    expect(r.hits[2].stun).toBeGreaterThan(r.hits[0].stun);
    // No cooldown: the ring stays full and the next combo starts straight away.
    expect(r.c.abilityHud!.primaryReady).toBe(1);
    r.run(0.3);
    expect(r.hits.length).toBe(4);
    expect(r.hits[3].amount).toBeCloseTo(jab, 3);
    // Arms animated: the left fist went out on the first jab.
    expect(Math.max(...r.poses.map((p) => p[0]))).toBeGreaterThan(0.9);
  });

  it('misses bots out of reach and behind', () => {
    const r = rig(-4);
    r.held.add('Space');
    r.run(1.5);
    expect(r.hits.length).toBe(0);
  });
});

describe('BRUTUS Saw Charge (E)', () => {
  it('spends the E charge, pushes the mech forward and shreds what is in front for the charge', () => {
    const r = rig(3);
    r.press.add('KeyE');
    r.run(0.8);
    expect(r.plow.whirlCharge).toBe(0);
    expect(r.pushes.length).toBeGreaterThan(10);
    expect(r.pushes[0][1]).toBeGreaterThan(10);
    expect(r.hits.length).toBeGreaterThanOrEqual(5);
    expect(r.hits.length).toBeLessThanOrEqual(7);
    expect(Math.max(...r.poses.map((p) => p[2]))).toBeGreaterThan(0.9);
    expect(r.c.abilityHud!.secondary.label).toBe('SAWS');
  });

  it('duel puppet: replays the charge from the snapshot bit without moving the plow or hitting', () => {
    const r = rig(3);
    const s = new Float32Array(64);
    (r.c as unknown as { readPuppet(s: Float32Array, o: number): void }).readPuppet(s, 0);
    const host = rig(3);
    host.press.add('KeyE');
    host.run(DT);
    const bits = (host.c.vehicle!.netBits?.() ?? (host.c as unknown as { vehicleBits(): number }).vehicleBits());
    expect(bits & 2).toBe(2);
    (r.c as unknown as { netBits: number }).netBits = bits;
    r.run(0.3);
    expect(r.pushes.length).toBe(0);
    expect(r.hits.length).toBe(0);
    expect(Math.max(...r.poses.map((p) => p[2]))).toBeGreaterThan(0.5);
  });
});
