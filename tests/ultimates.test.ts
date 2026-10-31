import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Combat } from '../src/entities/Combat';
import { computeStatsFor } from '../src/core/Progression';
import type { EnemyHandle, GameContext } from '../src/core/types';
import type { PilotBinding } from '../src/entities/pilot';
import type { PlowKind } from '../src/config/plows';

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });
let nextId = 1;
const bot = (x: number, z: number, hp = 5000): EnemyHandle => ({ id: nextId++, position: new THREE.Vector3(x, 0, z), radius: 1, hp, maxHp: hp, alive: true }) as unknown as EnemyHandle;

function rig(kind: PlowKind, bots: EnemyHandle[]) {
  const stats = computeStatsFor({}, kind);
  const plow = {
    position: new THREE.Vector3(), heading: 0, hp: 100, maxHp: 100, dead: false, turretAim: 0, hop: 0,
    getForward: (o: THREE.Vector3) => o.set(0, 0, 1), getBladeTip: (o: THREE.Vector3) => o.set(0, 0, 2.5),
    feedSawFury: () => {}, damage: () => {}, mountWorld: (_k: string, _i: number, o: THREE.Vector3) => o.set(0, 1, 0), turretHeading: 0,
  };
  const enemies = {
    query: (x: number, z: number, r: number, out: EnemyHandle[] = []) => {
      out.length = 0;
      for (const b of bots) if (b.alive && Math.hypot(b.position.x - x, b.position.z - z) <= r + b.radius) out.push(b);
      return out;
    },
    damage: (e: EnemyHandle, amount: number) => {
      e.hp -= amount;
      return false;
    },
  };
  let f = false;
  const input = { throttle: 0, steer: 0, wasPressed: (c: string) => c === 'KeyF' && f };
  const ctx = { scene: new THREE.Scene(), time: 0, fx: noop, ui: noop, impact: noop } as unknown as GameContext;
  const binding = { stats, plow, enemies, input, audio: noop, snow: noop, events: { emit: () => {} }, local: true, authoritative: true } as unknown as PilotBinding;
  const c = new Combat(ctx, binding);
  const press = () => {
    f = true;
    c.update(1 / 60);
    f = false;
  };
  const run = (s: number) => {
    for (let i = 0; i < s * 60; i++) c.update(1 / 60);
  };
  return { c, press, run };
}

const fill = (c: Combat, n: number) => (c as unknown as { onPlayerHit(d: number, k: boolean): void }).onPlayerHit(n, false);

describe.each([
  ['volt', 'SUPERCELL', [bot(0, 15), bot(-10, -10)], [bot(40, 0)]],
  ['brute', 'EARTHQUAKE', [bot(0, 6), bot(0, -17)], [bot(30, 0)]],
  ['arsenal', 'ORBITAL STRIKE', [bot(0, 20), bot(30, 30)], [bot(80, 0)]],
] as const)('%s ultimate (%s)', (kind, _name, inRange, outOfRange) => {
  it('any damage fills the meter; full + F fires it, hits what is in range, and its own damage never refills it', () => {
    const all = [...inRange, ...outOfRange];
    const { c, press, run } = rig(kind as PlowKind, all);
    expect(c.critMass).toBe(0);
    fill(c, 300);
    expect(c.critMass).toBeGreaterThan(0);
    expect(c.critMass).toBeLessThan(1);
    fill(c, 5000);
    expect(c.critMass).toBe(1);
    press();
    expect(c.critMass).toBe(0);
    run(3);
    for (const b of inRange) expect(b.hp).toBeLessThan(5000);
    for (const b of outOfRange) expect(b.hp).toBe(5000);
    expect(c.critMass).toBe(0);
  });
});

describe('ultimate meters', () => {
  it('only the plow-specific damage source matters for Classic / ISOTOPE (fire / radiation), not raw hits', () => {
    for (const k of ['classic', 'isotope'] as const) {
      const { c } = rig(k, []);
      fill(c, 5000);
      expect(c.critMass).toBe(0);
    }
  });
});
