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
  // pvp: missile counts below are in duel damage (no PVE_MULT).
  const binding = { stats, plow, enemies, input: { throttle: 0, steer: 0, wasPressed: () => false }, local: true, authoritative: true, pvp: true } as unknown as PilotBinding;
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

});

/* ------------------------------------------------------------------ pulse laser turret */

type Guns = { gunTarget(x: number, y: number, z: number, h: number, r: number): EnemyHandle | null; updateGuns(dt: number): void };

describe('ARSENAL turret', () => {
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

describe('ARSENAL: the snowball shop lines still pay off', () => {
  it('Mega Hopper adds reach, Whirlwind Turbine traverse, Snow Compactor merge-pulse width', async () => {
    const { tankGunRange, tankSlewMult, tankBeamWidth } = await import('../src/entities/combat/arsenal');
    const base = computeStatsFor({}, 'arsenal');
    const up = computeStatsFor({ hopper: 5, whirl: 3, compactor: 5 }, 'arsenal');
    expect(tankGunRange(up)).toBeGreaterThan(tankGunRange(base) + 1);
    expect(tankSlewMult(up)).toBeGreaterThan(tankSlewMult(base) * 1.3);
    expect(tankBeamWidth(up)).toBeGreaterThan(tankBeamWidth(base) + 0.1);
  });
});

/* ------------------------------------------------------------------ grav weapons (E / F / ultimate) */

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });

/** Full Combat rig against bots that can be pulled (the manager moves them at the pull velocity) and logs damage. */
function gravRig(bots: EnemyHandle[], levels: Record<string, number> = {}) {
  const stats = computeStatsFor(levels, 'arsenal');
  const plow = {
    position: new THREE.Vector3(), heading: 0, hp: 100, maxHp: 100, dead: false, turretAim: 0, turretHeading: 0, hop: 0, surfaceY: 0,
    gunFiring: false, gunPitch: 0, gyroFlat: 0, gyroCharge: 0, feedSawFury: () => {}, damage: () => {},
    getForward: (o: THREE.Vector3) => o.set(0, 0, 1),
    mountWorld: (_k: string, _i: number, o: THREE.Vector3) => o.set(0, 1, 1.5),
  };
  const log: { t: number; e: EnemyHandle; n: number }[] = [];
  const ctx = { scene: new THREE.Scene(), time: 0, fx: noop, ui: noop, impact: noop } as unknown as GameContext;
  const enemies = {
    bosses: [],
    query: (x: number, z: number, r: number, out: EnemyHandle[] = []) => {
      out.length = 0;
      for (const b of bots) if (b.alive && Math.hypot(b.position.x - x, b.position.z - z) <= r + b.radius) out.push(b);
      return out;
    },
    damage: (e: EnemyHandle, n: number) => {
      e.hp -= n;
      log.push({ t: ctx.time, e, n });
      return false;
    },
    pull: (e: EnemyHandle, vx: number, vz: number, dt: number) => {
      e.position.x += vx * dt;
      e.position.z += vz * dt;
    },
  };
  let f = false;
  const input = { throttle: 0, steer: 0, wasPressed: (k: string) => k === 'KeyF' && f, isDown: () => false };
  const binding = { stats, plow, enemies, input, audio: noop, snow: noop, events: { emit: () => {} }, local: true, authoritative: true, pvp: false } as unknown as PilotBinding;
  const c = new Combat(ctx, binding);
  c.clear();
  const run = (s: number) => {
    for (let i = 0; i < Math.round(s * 60); i++) {
      (ctx as { time: number }).time += 1 / 60;
      c.update(1 / 60);
    }
  };
  const pressF = () => {
    f = true;
    run(1 / 60);
    f = false;
  };
  return { c, stats, log, run, pressF, ctx };
}

describe('GRAV LANCE (E)', () => {
  it('thin beams lock several bots ahead and pull them toward the point 5 m in front; bots behind are ignored', () => {
    const a = bot(-6, 12, 1e6);
    const b = bot(7, 14, 1e6);
    const behind = bot(0, -8, 1e6);
    const { c, run } = gravRig([a, b, behind]);
    const d0 = [a, b].map((e) => Math.hypot(e.position.x, e.position.z - 5));
    expect(c.fireLaser()).toBe(true);
    run(1.2);
    const d1 = [a, b].map((e) => Math.hypot(e.position.x, e.position.z - 5));
    expect(d1[0]).toBeLessThan(d0[0] - 3);
    expect(d1[1]).toBeLessThan(d0[1] - 3);
    expect(behind.position.z).toBe(-8);
    expect(behind.hp).toBe(behind.maxHp);
  });

  it('the merge pulse at the end does most of the damage; a lone bot takes the old beam\'s 1.5 s of damage', () => {
    const e = bot(0, 6, 1e6);
    const { c, stats, log, run } = gravRig([e]);
    c.fireLaser();
    run(1.6);
    const total = log.reduce((s, h) => s + h.n, 0);
    const merge = log.filter((h) => h.t >= 1.24).reduce((s, h) => s + h.n, 0);
    expect(merge / total).toBeGreaterThan(0.6);
    expect(total).toBeCloseTo(stats.laserDps * 1.5 * stats.damageMult * 3, 0);
  });
});

describe('POLARITY BURST (F)', () => {
  it('pulls every bot inside the event horizon toward a point ahead, then detonates on the clump', () => {
    const near = bot(8, 10, 1e6);
    const far = bot(0, 40, 1e6);
    const { c, stats, log, run, pressF } = gravRig([near, far]);
    expect(c.flameReady).toBe(1);
    const d0 = Math.hypot(near.position.x, near.position.z - 4);
    pressF();
    run(1.0);
    expect(Math.hypot(near.position.x, near.position.z - 4)).toBeLessThan(d0 - 4);
    expect(log.length).toBe(0); // no damage until the collapse
    run(0.5);
    expect(near.hp).toBeLessThan(near.maxHp - stats.missileDamage);
    expect(far.position.z).toBe(40);
    expect(far.hp).toBe(far.maxHp);
    expect(c.flameReady).toBeLessThan(1);
  });
});

describe('SINGULARITY (ultimate)', () => {
  it('opens on the densest cluster, drags every bot within 40 m toward it (not beyond), then explodes', () => {
    const cluster = [bot(10, 20, 1e6), bot(12, 21, 1e6), bot(9, 23, 1e6)];
    const stray = bot(-20, 25, 1e6); // ~31 m from the cluster: inside the pull
    const outside = bot(70, 25, 1e6); // ~59 m from the cluster: untouched
    const { c, log, run, pressF } = gravRig([...cluster, stray, outside]);
    (c as unknown as { onPlayerHit(d: number, k: boolean): void }).onPlayerHit(1e6, false);
    expect(c.critMass).toBe(1);
    pressF();
    expect(c.critMass).toBe(0);
    const sx = stray.position.x;
    run(2.9);
    expect(stray.position.x).toBeGreaterThan(sx + 8);
    expect(outside.position.x).toBe(70);
    const before = log.reduce((s, h) => s + h.n, 0);
    run(0.6);
    const blast = log.reduce((s, h) => s + h.n, 0) - before;
    expect(blast).toBeGreaterThan(before); // the collapse does far more than the pull ticks
    for (const e of [...cluster, stray]) expect(e.hp).toBeLessThan(e.maxHp);
    expect(outside.hp).toBe(outside.maxHp);
    expect(c.critMass).toBe(0); // its own damage never refills the meter
  });
});
