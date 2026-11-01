import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Combat } from '../src/entities/Combat';
import { computeStatsFor } from '../src/core/Progression';
import type { EnemyHandle, GameContext } from '../src/core/types';
import type { PilotBinding } from '../src/entities/pilot';
import { arcRange, staticRadius } from '../src/entities/combat/volt';

/* VOLT-9 TESLA ROVER: ARC LANCE (SPACE, hold) and STATIC FIELD (E) through Combat's vehicle routing. */

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });
type Bot = EnemyHandle & { hp: number; dealt: number; frozen: number };
let nextId = 1;
const bot = (x: number, z: number): Bot =>
  ({ id: nextId++, position: new THREE.Vector3(x, 0, z), radius: 1, hp: 1e6, maxHp: 1e6, alive: true, dealt: 0, frozen: 0, type: 'grunt', mass: 1, isBoss: false }) as unknown as Bot;

function rig(bots: Bot[]) {
  const press = new Set<string>();
  const held = new Set<string>();
  const plow = {
    position: new THREE.Vector3(), heading: 0, hp: 100, maxHp: 100, dead: false, turretAim: 0, turretHeading: 0, whirlCharge: 1, surfaceY: 0,
    get eCharge() {
      return plow.whirlCharge;
    },
    spendE() {
      plow.whirlCharge = 0;
    },
    damage() {},
    feedSawFury() {},
    push() {},
    stealSnow: () => 0,
    hitStop() {},
    mountWorld: (_k: string, _i: number, o: THREE.Vector3) => o.set(0, 1, 0),
    getForward: (o: THREE.Vector3) => o.set(0, 0, 1),
  };
  const enemies = {
    bosses: [],
    query: (x: number, z: number, r: number, o: EnemyHandle[] = []) => {
      o.length = 0;
      for (const b of bots) if (b.alive && Math.hypot(b.position.x - x, b.position.z - z) <= r + b.radius) o.push(b);
      return o;
    },
    damage: (e: EnemyHandle, n: number, opts?: { freezeSeconds?: number }) => {
      const b = e as Bot;
      b.dealt += n;
      b.hp -= n;
      b.frozen = Math.max(b.frozen, opts?.freezeSeconds ?? 0);
      return false;
    },
  };
  const binding = {
    stats: computeStatsFor({}, 'volt'), plow, enemies, snow: noop, events: noop, local: false, authoritative: true, look: null,
    input: { throttle: 0, steer: 0, wasPressed: (k: string) => press.has(k), isDown: (k: string) => held.has(k) },
    audio: noop,
  } as unknown as PilotBinding;
  const ctx = { scene: new THREE.Scene(), time: 0, fx: noop, ui: noop, impact: noop, cameraRig: noop, terrain: undefined } as unknown as GameContext;
  const c = new Combat(ctx, binding);
  c.clear();
  const run = (s: number) => {
    for (let i = 0; i < Math.round(s * 60); i++) {
      (ctx as { time: number }).time += 1 / 60;
      c.update(1 / 60);
      press.clear();
    }
  };
  return { c, plow, press, held, run };
}

describe('VOLT-9 Tesla Rover', () => {
  it('ARC LANCE hits the nearest bot ahead and chains to 2 more, never a bot behind', () => {
    const front = bot(0, 5);
    const c1 = bot(3, 7);
    const c2 = bot(-3, 8);
    const c3 = bot(0, 13); // 4th in line: beyond the 2 base hops
    const behind = bot(0, -4);
    const r = rig([front, c1, c2, c3, behind]);
    r.held.add('Space');
    r.run(1);
    expect(front.dealt).toBeGreaterThan(0);
    expect(c1.dealt).toBeGreaterThan(0);
    expect(c2.dealt).toBeGreaterThan(0);
    expect(c1.dealt).toBeLessThan(front.dealt);
    expect(c3.dealt).toBe(0);
    expect(behind.dealt).toBe(0);
    r.held.clear();
    const before = front.dealt;
    r.run(0.5);
    expect(front.dealt).toBe(before);
  });

  it('ARC LANCE reach grows with Mega Hopper', () => {
    expect(arcRange(1.2)).toBe(9);
    expect(arcRange(2.4)).toBeGreaterThan(arcRange(1.2));
    const far = bot(0, 9.5);
    const r = rig([far]);
    r.held.add('Space');
    r.run(0.5);
    expect(far.dealt).toBeGreaterThan(0);
  });

  it('STATIC FIELD stuns every bot in the ring (any direction) and spends the E charge', () => {
    const a = bot(4, 0);
    const b = bot(0, -4);
    const out = bot(0, staticRadius(0) + 3);
    const r = rig([a, b, out]);
    r.press.add('KeyE');
    r.run(1 / 60);
    expect(a.frozen).toBeGreaterThan(0.5);
    expect(b.frozen).toBeGreaterThan(0.5);
    expect(a.dealt).toBeGreaterThan(0);
    expect(out.dealt).toBe(0);
    expect(r.plow.whirlCharge).toBe(0);
    expect(r.c.abilityHud!.secondary.label).toBe('FIELD');
  });

  it('STATIC FIELD lingers: it keeps pulsing for 2.5 s, then stops', () => {
    const a = bot(4, 0);
    const r = rig([a]);
    r.press.add('KeyE');
    r.run(1 / 60);
    const first = a.dealt;
    r.run(1.2); // two more pulses
    expect(a.dealt).toBeGreaterThan(first * 1.5);
    r.run(1.5);
    const done = a.dealt;
    r.run(1);
    expect(a.dealt).toBe(done); // the field is over
  });
});
