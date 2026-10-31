import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Combat } from '../src/entities/Combat';
import { computeStatsFor } from '../src/core/Progression';
import { HELD_BIT, INPUT_BYTES, PressTracker, decodeInput, encodeInput, type InputFrame } from '../src/net/protocol';
import { NetInput } from '../src/duel/plumbing';
import type { EnemyHandle, GameContext } from '../src/core/types';
import type { PilotBinding } from '../src/entities/pilot';

/* ------------------------------------------------------------------ duel: held keys */

describe('duel held keys', () => {
  it('the input packet carries a held-action bitmask', () => {
    const v = new DataView(new ArrayBuffer(INPUT_BYTES));
    encodeInput({ seq: 5, throttle: 0, steer: 0, presses: [0, 0, 0, 0], held: HELD_BIT(0) | HELD_BIT(3) }, v);
    const f: InputFrame = { seq: 0, throttle: 0, steer: 0, presses: [0, 0, 0, 0] };
    expect(decodeInput(v, f)).toBe(true);
    expect(f.held).toBe(0b1001);
  });

  it('NetInput.isDown follows the newest packet and only while enabled', () => {
    const n = new NetInput();
    const frame = (seq: number, held: number): InputFrame => ({ seq, throttle: 0, steer: 0, presses: [0, 0, 0, 0], held });
    n.tracker.receive(frame(1, HELD_BIT(0)));
    expect(n.isDown('Space')).toBe(false); // not enabled yet
    n.enabled = true;
    expect(n.isDown('Space')).toBe(true);
    expect(n.isDown('KeyE')).toBe(false);
    // A late, older packet never rewinds the held state.
    n.tracker.receive(frame(3, 0));
    n.tracker.receive(frame(2, HELD_BIT(0)));
    expect(n.isDown('Space')).toBe(false);
    n.tracker.reset();
    expect(n.tracker.held).toBe(0);
  });

  it('PressTracker keeps presses and held state separate', () => {
    const t = new PressTracker();
    t.receive({ seq: 1, throttle: 0, steer: 0, presses: [1, 0, 0, 0], held: HELD_BIT(0) });
    expect(t.take(0)).toBe(true);
    expect(t.take(0)).toBe(false);
    expect(t.held & HELD_BIT(0)).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ targeting */

let nextId = 1;
function bot(x: number, z: number, hp: number, maxHp = hp): EnemyHandle {
  return { id: nextId++, position: new THREE.Vector3(x, 0, z), radius: 1, hp, maxHp, alive: true } as unknown as EnemyHandle;
}

function rig(bots: EnemyHandle[]) {
  const stats = computeStatsFor({}, 'arsenal');
  const plow = { position: new THREE.Vector3(), heading: 0, hp: 100, maxHp: 100, dead: false, turretAim: 0 };
  const enemies = {
    query: (x: number, z: number, r: number, out: EnemyHandle[]) => {
      out.length = 0;
      for (const b of bots) if (b.alive && Math.hypot(b.position.x - x, b.position.z - z) <= r + b.radius) out.push(b);
      return out;
    },
  };
  const scene = new THREE.Scene();
  const ctx = { scene, time: 0 } as unknown as GameContext;
  const binding = { stats, plow, enemies, input: { throttle: 0, steer: 0, wasPressed: () => false }, local: true, authoritative: true } as unknown as PilotBinding;
  const c = new Combat(ctx, binding);
  return { c, stats };
}

const noteThreat = (c: Combat, x: number, z: number, dmg: number) => (c as unknown as { noteThreat(x: number, z: number, d: number): void }).noteThreat(x, z, dmg);

describe('ARSENAL targeting', () => {
  it('credits damage to the bot nearest to where the hit came from', () => {
    const a = bot(5, 0, 100);
    const b = bot(5, 4, 100);
    const { c } = rig([a, b]);
    noteThreat(c, 5.2, 0.1, 20);
    expect(c.threatOf(a)).toBe(20);
    expect(c.threatOf(b)).toBe(0);
    noteThreat(c, 30, 30, 50); // nobody there
    expect(c.threatOf(a) + c.threatOf(b)).toBe(20);
  });

  it('a salvo goes to the biggest threat first, with as many missiles as its HP needs', () => {
    const { c, stats } = rig([]);
    const per = stats.missileDamage * stats.damageMult;
    const near = bot(0, 6, per * 0.5); // closest, never hurt us
    const threat = bot(0, 30, per * 2.5); // far, but it has been hitting us: needs 3 missiles
    const other = bot(10, 10, per * 10);
    const { c: c2 } = rig([near, threat, other]);
    noteThreat(c2, 0, 30, 25);
    const plan = c2.planSalvo(4, 0, 0);
    expect(plan.slice(0, 3)).toEqual([threat, threat, threat]);
    expect(plan[3]).not.toBe(threat);
    expect(plan.filter((e) => e === near).length).toBeLessThanOrEqual(1);
    void c;
  });

  it('spreads over every bot that needs missiles, then piles the leftovers onto the top threats', () => {
    const { stats } = rig([]);
    const per = stats.missileDamage * stats.damageMult;
    const bots = [bot(0, 5, per * 0.9), bot(3, 5, per * 0.9)];
    const { c } = rig(bots);
    noteThreat(c, 3, 5, 10);
    const plan = c.planSalvo(6, 0, 0);
    expect(new Set(plan.slice(0, 2))).toEqual(new Set(bots));
    expect(plan[0]).toBe(bots[1]);
    expect(plan.every((e) => e !== null)).toBe(true);
    expect(plan.filter((e) => e === bots[1]).length).toBeGreaterThanOrEqual(plan.filter((e) => e === bots[0]).length);
  });

  it('with nothing in range every missile flies free', () => {
    const { c } = rig([bot(200, 200, 50)]);
    expect(c.planSalvo(4, 0, 0)).toEqual([null, null, null, null]);
  });
});
