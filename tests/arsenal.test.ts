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

describe('ARSENAL: the snowball shop lines still pay off', () => {
  it('Mega Hopper adds shotgun reach, Whirlwind Turbine pellets, Snow Compactor repulsor width', async () => {
    const { tankGunRange, tankPellets, tankRepulseHalf } = await import('../src/entities/combat/arsenal');
    const base = computeStatsFor({}, 'arsenal');
    const up = computeStatsFor({ hopper: 5, whirl: 3, compactor: 5 }, 'arsenal');
    expect(tankGunRange(up)).toBeGreaterThan(tankGunRange(base) + 1);
    expect(tankGunRange(base)).toBeLessThan(12.5); // short range, like every plow
    expect(tankPellets(base)).toBe(8);
    expect(tankPellets(up)).toBeGreaterThan(tankPellets(base));
    expect(tankRepulseHalf(up)).toBeGreaterThan(tankRepulseHalf(base) + 0.05);
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
  const log: { t: number; e: EnemyHandle; n: number; kb: number; kx: number; kz: number }[] = [];
  const ctx = { scene: new THREE.Scene(), time: 0, fx: noop, ui: noop, impact: noop } as unknown as GameContext;
  const enemies = {
    bosses: [],
    query: (x: number, z: number, r: number, out: EnemyHandle[] = []) => {
      out.length = 0;
      for (const b of bots) if (b.alive && Math.hypot(b.position.x - x, b.position.z - z) <= r + b.radius) out.push(b);
      return out;
    },
    damage: (e: EnemyHandle, n: number, o?: { knockback?: THREE.Vector3 }) => {
      e.hp -= n;
      const k = o?.knockback;
      log.push({ t: ctx.time, e, n, kb: k ? Math.hypot(k.x, k.z) : 0, kx: k?.x ?? 0, kz: k?.z ?? 0 });
      return false;
    },
    pull: (e: EnemyHandle, vx: number, vz: number, dt: number) => {
      e.position.x += vx * dt;
      e.position.z += vz * dt;
    },
  };
  let f = false;
  const held = new Set<string>();
  const input = { throttle: 0, steer: 0, wasPressed: (k: string) => k === 'KeyF' && f, isDown: (k: string) => held.has(k) };
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
  return { c, stats, log, run, pressF, ctx, held };
}

const sum = (log: { e: EnemyHandle; n: number }[], e: EnemyHandle) => log.filter((h) => h.e === e).reduce((t, h) => t + h.n, 0);

describe('MAG SHOTGUN (SPACE)', () => {
  /** Hold SPACE for `s` seconds against `bots` (the emitter sits at (0, 1, 1.5), the hull faces +z). */
  const shoot = (bots: EnemyHandle[], s: number, levels: Record<string, number> = {}) => {
    const r = gravRig(bots, levels);
    r.held.add('Space');
    r.run(s);
    return r;
  };

  it('fires straight off the nose: hits a bot 6 m ahead, never one 35° off the nose, behind or beyond reach', () => {
    const ahead = bot(0, 7.5, 1e6);
    const off = bot(Math.sin(0.61) * 6, 1.5 + Math.cos(0.61) * 6, 1e6);
    const behind = bot(0, -5, 1e6);
    const far = bot(3, 14, 1e6);
    shoot([ahead, off, behind, far], 0.05);
    expect(ahead.hp).toBeLessThan(ahead.maxHp);
    expect(off.hp).toBe(off.maxHp);
    expect(behind.hp).toBe(behind.maxHp);
    const { c } = shoot([far], 0.05);
    expect(far.hp).toBe(far.maxHp);
    expect((c as unknown as { b: { plow: { turretAim: number } } }).b.plow.turretAim).toBe(0); // the turret stays locked forward
  });

  it('a blast every 1/gunRate s while held; all of one blast lands on a bot as one hit', () => {
    const e = bot(0, 5, 1e6);
    const { stats, log } = shoot([e], 3);
    const n = log.filter((h) => h.e === e).length;
    expect(n).toBeGreaterThanOrEqual(Math.floor(3 * stats.gunRate));
    expect(n).toBeLessThanOrEqual(Math.ceil(3 * stats.gunRate) + 1);
    expect(stats.gunRate).toBeGreaterThan(1.5);
    expect(stats.gunRate).toBeLessThan(2.8);
  });

  it('damage falls off with distance; point-blank blasts shove hard', () => {
    const near = bot(0, 4, 1e6);
    const { stats, log } = shoot([near], 0.05);
    const nearDmg = sum(log, near);
    // Point-blank: all 8 pellets at full damage (x the PvE bonus), and a real shove.
    expect(nearDmg).toBeCloseTo(8 * stats.gunDamage * stats.damageMult * 3, 3);
    expect(log[0].kb).toBeGreaterThan(5);
    expect(log[0].kz).toBeGreaterThan(0);
    const farBot = bot(0, 10, 1e6);
    const r2 = shoot([farBot], 0.05);
    const farDmg = sum(r2.log, farBot);
    expect(farDmg).toBeGreaterThan(0);
    expect(farDmg).toBeLessThan(nearDmg * 0.95); // the whole blast lands, but falls off with distance
    expect(r2.log[0].kb).toBeLessThan(2);
  });

  it('every small bot inside the cone takes the whole blast (no pellet luck): one blast kills a pack of 55-HP bots up close', () => {
    const pack = [bot(-1.2, 4, 55), bot(0, 5, 55), bot(1.2, 4, 55)];
    shoot(pack, 0.05, { armCannon: 14 });
    for (const b of pack) expect(b.hp).toBeLessThanOrEqual(0);
  });
});

describe('MAG REPULSOR (E)', () => {
  it('a forward wedge: hits a bot ahead hard, not one behind, beyond reach or well off the nose, and flings it away', () => {
    const ahead = bot(1.5, 6, 1e6);
    const behind = bot(0, -6, 1e6);
    const beyond = bot(0, 20, 1e6);
    const wide = bot(6, 3, 1e6); // ~60° off the nose
    const { c, stats, log, run } = gravRig([ahead, behind, beyond, wide]);
    expect(c.fireLaser()).toBe(true);
    expect(c.fireLaser()).toBe(false); // one wave at a time
    run(0.4);
    const hits = log.filter((h) => h.e === ahead);
    expect(hits.length).toBe(1);
    expect(hits[0].n).toBeCloseTo(stats.laserDps * 1.5 * stats.damageMult * 3, 3);
    expect(hits[0].kb).toBeGreaterThan(12);
    expect(hits[0].kz).toBeGreaterThan(0); // away from the vehicle
    for (const e of [behind, beyond, wide]) expect(e.hp).toBe(e.maxHp);
  });

  it('bosses are shoved much less; the far edge of the wedge hits a bit softer', () => {
    const boss = Object.assign(bot(0, 6, 1e6), { isBoss: true });
    const edge = bot(0, 12, 1e6);
    const { c, log, run } = gravRig([boss]);
    c.fireLaser();
    run(0.4);
    expect(log[0].kb).toBeLessThan(5);
    const r2 = gravRig([edge]);
    r2.c.fireLaser();
    r2.run(0.4);
    expect(r2.log.length).toBe(1);
    expect(r2.log[0].n).toBeLessThan(log[0].n);
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
