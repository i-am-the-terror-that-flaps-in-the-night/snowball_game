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

/* ------------------------------------------------------------------ BATTLE TANK pulse-laser nerf */

type Guns = { gunTarget(x: number, y: number, z: number, h: number, r: number): EnemyHandle | null; updateGuns(dt: number): void };

describe('BATTLE TANK turret', () => {
  it('auto-aims only within a 240° arc round the hull nose: a bot squarely behind is safe', () => {
    const behind = bot(0, -6, 100);
    const flank = bot(-6, -3, 100); // ~117° off the nose: still inside
    const { c } = rig([behind]);
    const guns = c.vehicle as unknown as Guns;
    expect(guns.gunTarget(0, 1.4, 0, 0, 26)).toBeNull();
    const { c: c2 } = rig([behind, flank]);
    expect((c2.vehicle as unknown as Guns).gunTarget(0, 1.4, 0, 0, 26)).toBe(flank);
  });

  it('the turret swings at a limited rate and never past the arc edge', () => {
    const { c } = rig([bot(-6, -3.2, 100)]);
    const plow = (c as unknown as { b: { plow: { turretAim: number; turretHeading: number; gunFiring: boolean; gunPitch: number } } }).b.plow;
    Object.assign(plow, { turretHeading: 0, gunFiring: false, gunPitch: 0 });
    const guns = c.vehicle as unknown as Guns;
    guns.updateGuns(0.1);
    expect(Math.abs(plow.turretAim)).toBeGreaterThan(0.2);
    expect(Math.abs(plow.turretAim)).toBeLessThan(0.4);
    for (let i = 0; i < 30; i++) guns.updateGuns(0.1);
    expect(Math.abs(plow.turretAim)).toBeLessThanOrEqual((120 * Math.PI) / 180 + 1e-9);
  });
});

describe('BATTLE TANK: the snowball shop lines still pay off', () => {
  it('Mega Hopper adds reach, Whirlwind Turbine traverse, Snow Compactor beam width', async () => {
    const { tankGunRange, tankSlewMult, tankBeamWidth } = await import('../src/entities/combat/arsenal');
    const base = computeStatsFor({}, 'arsenal');
    const up = computeStatsFor({ hopper: 5, whirl: 3, compactor: 5 }, 'arsenal');
    expect(tankGunRange(up)).toBeGreaterThan(tankGunRange(base) + 1);
    expect(tankSlewMult(up)).toBeGreaterThan(tankSlewMult(base) * 1.3);
    expect(tankBeamWidth(up)).toBeGreaterThan(tankBeamWidth(base) + 0.1);
  });
});
