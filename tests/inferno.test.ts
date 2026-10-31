import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Combat } from '../src/entities/Combat';
import { computeStatsFor } from '../src/core/Progression';
import type { EnemyHandle, GameContext } from '../src/core/types';
import type { PilotBinding } from '../src/entities/pilot';

/** Any property, any call: a no-op (fx, audio, ui, impact, snow). */
const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });

let nextId = 1;
function bot(x: number, z: number, hp = 1000): EnemyHandle {
  return { id: nextId++, position: new THREE.Vector3(x, 0, z), radius: 1, hp, maxHp: hp, alive: true } as unknown as EnemyHandle;
}

function rig(bots: EnemyHandle[], presses: string[] = []) {
  const stats = computeStatsFor({}, 'classic');
  const plow = {
    position: new THREE.Vector3(), heading: 0, hp: 100, maxHp: 100, dead: false,
    getForward: (o: THREE.Vector3) => o.set(0, 0, 1),
    getBladeTip: (o: THREE.Vector3) => o.set(0, 0, 2.5),
    feedSawFury: () => {},
  };
  const dealt: number[] = [];
  const enemies = {
    query: (x: number, z: number, r: number, out: EnemyHandle[] = []) => {
      out.length = 0;
      for (const b of bots) if (b.alive && Math.hypot(b.position.x - x, b.position.z - z) <= r + b.radius) out.push(b);
      return out;
    },
    damage: (e: EnemyHandle, amount: number) => {
      e.hp -= amount;
      dealt.push(amount);
      return false;
    },
  };
  const ctx = { scene: new THREE.Scene(), time: 0, fx: noop, ui: noop, impact: noop } as unknown as GameContext;
  const input = { throttle: 0, steer: 0, wasPressed: (c: string) => presses.includes(c) };
  const events = { emit: () => {} };
  const binding = { stats, plow, enemies, input, audio: noop, snow: noop, events, local: true, authoritative: true } as unknown as PilotBinding;
  return { c: new Combat(ctx, binding), stats, dealt, presses };
}

describe('Inferno', () => {
  it('ends in a fireball that hits bots in the far half of the cone', () => {
    const near = bot(0, 7.6); // ~cone end
    const far = bot(0, 30);
    const { c } = rig([near, far], ['KeyF']);
    c.update(1 / 60); // F: flames on
    (c as unknown as { b: { input: { wasPressed: () => boolean } } }).b.input.wasPressed = () => false;
    const hp0 = near.hp;
    for (let i = 0; i < 100; i++) c.update(1 / 60); // run past the 1.4s flame
    expect(near.hp).toBeLessThan(hp0);
    expect(far.hp).toBe(1000);
  });

  it('fire damage fills the FIRESTORM meter; a full meter + F fires a 360° nova and empties it', () => {
    const behind = bot(0, -8);
    const side = bot(9, 0);
    const out = bot(40, 0);
    const { c, stats } = rig([behind, side, out]);
    expect(c.critMass).toBe(0);
    (c as unknown as { feedFire(d: number): void }).feedFire(10_000);
    expect(c.critMass).toBe(1);
    (c as unknown as { b: { input: { wasPressed: (k: string) => boolean } } }).b.input.wasPressed = (k) => k === 'KeyF';
    c.update(1 / 60);
    expect(c.critMass).toBe(0);
    expect(behind.hp).toBeLessThan(1000);
    expect(side.hp).toBeLessThan(1000);
    expect(out.hp).toBe(1000);
    // Burning ground keeps doing damage after the blast.
    (c as unknown as { b: { input: { wasPressed: () => boolean } } }).b.input.wasPressed = () => false;
    const hpAfter = side.hp;
    for (let i = 0; i < 60; i++) c.update(1 / 60);
    expect(side.hp).toBeLessThan(hpAfter);
    expect(stats.plowKind).toBe('classic');
  });

  it('no FIRESTORM meter on other plows', () => {
    const { c } = rig([]);
    (c as unknown as { b: { stats: unknown } }).b.stats = computeStatsFor({}, 'volt');
    expect(c.critMass).toBe(-1);
  });
});

describe('FIRESTORM does not chain', () => {
  it('its blast, burning ground and the burns it lights never refill the meter', () => {
    const bots = [bot(0, -8), bot(9, 0), bot(-6, 3), bot(4, 7)];
    const { c } = rig(bots);
    (c as unknown as { feedFire(d: number): void }).feedFire(10_000);
    const inp = (c as unknown as { b: { input: { wasPressed: (k: string) => boolean } } }).b.input;
    inp.wasPressed = (k) => k === 'KeyF';
    c.update(1 / 60);
    inp.wasPressed = () => false;
    for (let i = 0; i < 60 * 9; i++) c.update(1 / 60);
    expect(c.critMass).toBe(0);
  });
});
