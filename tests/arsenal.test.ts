import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Combat } from '../src/entities/Combat';
import { PVE_MULT } from '../src/entities/combat/arsenal';
import { computeStatsFor } from '../src/core/Progression';
import { HELD_BIT, INPUT_BYTES, PressTracker, decodeInput, encodeInput, type InputFrame } from '../src/net/protocol';
import { NetInput } from '../src/duel/plumbing';
import type { EnemyHandle, GameContext } from '../src/core/types';
import type { PilotBinding } from '../src/entities/pilot';
import type { Plow } from '../src/entities/Plow';
import { NO_TARGETS, OpponentTarget, PlowHandle } from '../src/duel/opponent';
import { fakePlow, newCtx, pilot, statsFor } from '../scripts/balance/sim';
import { knockScale } from '../src/config/plows';
import { FX, grow, soft } from '../src/config/upgrades';

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
  it('Mega Hopper adds laser reach, Whirlwind Turbine a wider beam, Snow Compactor repulsor width', async () => {
    const { tankGunRange, tankBeamRadius, tankRepulseHalf } = await import('../src/entities/combat/arsenal');
    const base = computeStatsFor({}, 'arsenal');
    const up = computeStatsFor({ hopper: 5, whirl: 3, compactor: 5 }, 'arsenal');
    expect(tankGunRange(up)).toBeGreaterThan(tankGunRange(base) + 1);
    expect(tankGunRange(base)).toBeLessThan(12.5); // short range, like every plow
    expect(tankBeamRadius(base)).toBeCloseTo(0.8, 5); // a ~1.6 m wide beam
    expect(tankBeamRadius(up)).toBeGreaterThan(tankBeamRadius(base));
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
  return { c, stats, log, run, pressF, ctx, held, plow };
}

const sum = (log: { e: EnemyHandle; n: number }[], e: EnemyHandle) => log.filter((h) => h.e === e).reduce((t, h) => t + h.n, 0);

describe('MAG LASER (SPACE)', () => {
  type BoltView = { t: number; from: THREE.Vector3; to: THREE.Vector3 };
  const kit = (c: Combat) => (c as unknown as { arsenal: { boltsFired: number; laserFx: { live: number; bolts: BoltView[] } } }).arsenal;
  /** Hold SPACE for `s` seconds against `bots` (the emitter sits at (0, 1, 1.5), the hull faces +z). */
  const shoot = (bots: EnemyHandle[], s: number, levels: Record<string, number> = {}) => {
    const r = gravRig(bots, levels);
    r.held.add('Space');
    r.run(s);
    return r;
  };
  /** One bolt: SPACE held for a single frame, then released. */
  const oneBolt = (bots: EnemyHandle[], setup?: (r: ReturnType<typeof gravRig>) => void) => {
    const r = gravRig(bots);
    setup?.(r);
    r.held.add('Space');
    r.run(1 / 60);
    r.held.delete('Space');
    r.run(0.5);
    expect(kit(r.c).boltsFired).toBe(1);
    return r;
  };

  it('rapid fire while held: ~12 bolts a second at level 0, each a short-lived fat beam', () => {
    const r = shoot([], 3);
    const k = kit(r.c);
    expect(r.stats.gunRate).toBeCloseTo(12, 5);
    expect(k.boltsFired).toBeGreaterThanOrEqual(Math.floor(3 * r.stats.gunRate));
    expect(k.boltsFired).toBeLessThanOrEqual(Math.ceil(3 * r.stats.gunRate) + 1);
    expect(k.laserFx.live).toBeGreaterThanOrEqual(1);
    expect(k.laserFx.live).toBeLessThanOrEqual(2); // each bolt is gone in under 0.1 s
    r.held.delete('Space');
    r.run(0.2);
    expect(k.laserFx.live).toBe(0);
  });

  it('the same DPS as the Mag Discs it replaced (10 discs/s, two hits each) at every level', () => {
    for (let L = 0; L <= 20; L++) {
      const disc = (4.3 + 1.4 * grow(L, 5, 0.5)) * 0.4 * 2 * (10 + 0.6 * soft(L, 5));
      expect(FX.gunDamage(L) * FX.gunRate(L)).toBeGreaterThan(disc * 0.98);
      expect(FX.gunDamage(L) * FX.gunRate(L)).toBeLessThan(disc * 1.02);
    }
  });

  it('hitscan dead straight off the nose: one hit per bolt for gunDamage, tugging the bot toward ARSENAL', () => {
    const e = bot(0, 6, 1e6);
    const { stats, log, c } = oneBolt([e]);
    const hits = log.filter((h) => h.e === e);
    expect(hits.length).toBe(1);
    expect(hits[0].n).toBeCloseTo(stats.gunDamage * stats.damageMult * PVE_MULT, 3);
    expect(hits[0].kz).toBeLessThan(0); // a pull, no outward nudge
    expect(hits[0].kb).toBeCloseTo(3.5 * (10 / 12), 3); // the disc tug split over 12 bolts a second
    const b = kit(c).laserFx.bolts.find((x) => x.to.z > 0)!;
    expect(Math.abs(b.to.x - b.from.x)).toBeLessThan(1e-6);
  });

  it('pierces every bot on its line within the beam width and reach; nothing behind, past the reach, wide or high', () => {
    const a = bot(0, 4.5, 1e6);
    const b = bot(0, 8, 1e6);
    const edge = bot(1.6, 6, 1e6); // body inside the ~1.6 m beam
    const wide = bot(3.6, 6, 1e6); // outside the beam even where it has widened (~1.7 m half-width there)
    const behind = bot(0, -5, 1e6);
    const far = bot(0, 16, 1e6);
    const high = bot(0, 7, 1e6);
    high.position.y = 4;
    const { log } = oneBolt([a, b, edge, wide, behind, far, high]);
    for (const e of [a, b, edge]) expect(log.filter((h) => h.e === e).length).toBe(1);
    for (const e of [wide, behind, far, high]) expect(e.hp).toBe(e.maxHp);
  });

  it('the beam widens with distance: 2.4 m off the line is missed near the nose but hit far out', () => {
    const nearSide = bot(2.4, 3, 1e6);
    const farSide = bot(2.4, 9.5, 1e6);
    const { log } = oneBolt([nearSide, farSide]);
    expect(log.filter((h) => h.e === nearSide).length).toBe(0);
    expect(log.filter((h) => h.e === farSide).length).toBe(1);
  });

  it('follows the hull heading (no homing): a bot off the nose is never hit', () => {
    const side = bot(6, 0, 1e6);
    const ahead = bot(0, 6, 1e6);
    const r = gravRig([side, ahead]);
    r.plow.heading = Math.PI / 2; // facing +x
    r.held.add('Space');
    r.run(0.5);
    expect(side.hp).toBeLessThan(side.maxHp);
    expect(ahead.hp).toBe(ahead.maxHp);
  });

  it('a prop on the line breaks and stops the bolt', () => {
    const near = bot(0, 4, 1e6);
    const past = bot(0, 8, 1e6);
    let rays = 0;
    oneBolt([near, past], (r) => {
      (r.ctx as unknown as { world: unknown }).world = { blastPropRay: () => (rays++, 3.5) };
    });
    expect(rays).toBe(1);
    expect(near.hp).toBeLessThan(near.maxHp);
    expect(past.hp).toBe(past.maxHp);
  });

  it('the tug is small on a boss', () => {
    const boss = Object.assign(bot(0, 6, 1e6), { isBoss: true });
    const { log } = oneBolt([boss]);
    expect(log.length).toBe(1);
    expect(log[0].kz).toBeLessThan(0);
    expect(log[0].kb).toBeLessThan(1);
  });

  it('a duel guest hits nothing locally but its bolt still stops on the other plow (what the host sees)', () => {
    const stats = computeStatsFor({}, 'arsenal');
    const plow = {
      position: new THREE.Vector3(), heading: 0, hp: 100, maxHp: 100, dead: false, turretAim: 0, turretHeading: 0, hop: 0, surfaceY: 0,
      gunFiring: false, gunPitch: 0, gyroFlat: 0, gyroCharge: 0, eCharge: 1, feedSawFury: () => {}, damage: () => {}, spendE: () => {},
      getForward: (o: THREE.Vector3) => o.set(0, 0, 1),
      mountWorld: (_k: string, _i: number, o: THREE.Vector3) => o.set(0, 1, 1.5),
    };
    const foe = { position: new THREE.Vector3(0.5, 0, 8), dead: false };
    const ctx = { scene: new THREE.Scene(), time: 0, fx: noop, ui: noop, impact: noop } as unknown as GameContext;
    const held = new Set<string>(['Space']);
    const input = { throttle: 0, steer: 0, wasPressed: () => false, isDown: (k: string) => held.has(k) };
    const binding = { stats, plow, enemies: NO_TARGETS, input, audio: noop, snow: noop, events: { emit: () => {} }, local: true, authoritative: false, pvp: true, foe } as unknown as PilotBinding;
    const c = new Combat(ctx, binding);
    c.clear();
    c.update(1 / 60);
    held.clear();
    expect(kit(c).boltsFired).toBe(1);
    const b = kit(c).laserFx.bolts.find((x) => x.t < 0.05)!;
    expect(b.to.z).toBeGreaterThan(5);
    expect(b.to.z).toBeLessThan(8);
  });
});

describe('MAG LASER in the Duel: the tug is resisted by heavier vehicles', () => {
  it('BRUTUS is pulled least, VOLT-9 most', () => {
    const pull = (def: 'brute' | 'volt') => {
      const ctx = newCtx();
      const sa = statsFor('arsenal', 'fresh');
      const sd = statsFor(def, 'fresh');
      const pa = fakePlow(sa, 0, 0, 0);
      const pd = fakePlow(sd, 0, 6, Math.PI);
      pd.hp = 1e6;
      let pz = 0;
      pd.push = (_vx: number, vz: number) => {
        pz += vz;
      };
      let cd: ReturnType<typeof pilot> | null = null;
      const target = new OpponentTarget(new PlowHandle(2, pd as unknown as Plow), () => cd!.c, () => sa, () => pa as unknown as Plow, () => sd);
      target.enabled = true;
      // A laser hit, as the kit sends it: a negative knock (toward ARSENAL).
      cd = pilot(ctx, sd, pd, { query: (_x: number, _z: number, _r: number, o: EnemyHandle[] = []) => ((o.length = 0), o), damage: () => false }, true);
      target.damage(target.handle, 5, { knockback: new THREE.Vector3(0, 0, -2.5), fromX: 0, fromZ: 8, direct: 'round' });
      return pz;
    };
    const brute = pull('brute');
    const volt = pull('volt');
    expect(volt).toBeLessThan(0); // toward ARSENAL (it sits at z = 0)
    expect(brute).toBeLessThan(0);
    expect(Math.abs(brute)).toBeLessThan(Math.abs(volt) * 0.6);
    // One heaviness rule for every push (knockScale), not a tug-only table.
    expect(brute / volt).toBeCloseTo(knockScale('brute') / knockScale('volt'), 2);
  });
});

describe('SCRAP MAGNET: strip scrap', () => {
  const scrap = (c: Combat) => (c as unknown as { arsenal: { scrapCount: number } }).arsenal.scrapCount;

  it('laser hits on a tough bot shed shards into the ring with no kill (every 20% of its max HP)', () => {
    const tank = bot(0, 5, 300);
    const r = gravRig([tank], { armMagnet: 3 });
    r.held.add('Space');
    r.run(2.5);
    expect(tank.hp).toBeGreaterThan(0);
    expect(scrap(r.c)).toBeGreaterThan(0);
  });

  it('the ring and field alone feed it only at a quarter rate (no shard off a 300-HP bot in 6 s)', () => {
    const tank = bot(0, -4, 300);
    const r = gravRig([tank], { armMagnet: 3 });
    r.run(6);
    expect(tank.hp).toBeLessThan(300);
    expect(scrap(r.c)).toBe(0);
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
    expect(hits[0].n).toBeCloseTo(stats.laserDps * 1.5 * stats.damageMult * PVE_MULT, 3);
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
