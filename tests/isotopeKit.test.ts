import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Combat } from '../src/entities/Combat';
import { computeStatsFor } from '../src/core/Progression';
import type { EnemyHandle, GameContext } from '../src/core/types';
import type { PilotBinding } from '../src/entities/pilot';
import { sprayRange, reactorBoost, type IsotopeKit } from '../src/entities/combat/isotope';

/* ISOTOPE REACTOR HAULER: RAD SPRAYER (SPACE, hold) and FALLOUT TRAIL (E) through Combat's vehicle routing. */

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });
type Bot = EnemyHandle & { hp: number; dealt: number; frozen: number };
let nextId = 1;
const bot = (x: number, z: number): Bot =>
  ({ id: nextId++, position: new THREE.Vector3(x, 0, z), radius: 1, hp: 1e6, maxHp: 1e6, alive: true, dealt: 0, frozen: 0, type: 'grunt', mass: 1, isBoss: false }) as unknown as Bot;

function rig(bots: Bot[], levels: Record<string, number> = {}) {
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
    stats: computeStatsFor(levels, 'isotope'), plow, enemies, snow: noop, events: noop, local: false, authoritative: true, look: null,
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
  return { c, plow, press, held, run, ctx, binding };
}

const iso = (c: Combat) => (c as unknown as { isotope: IsotopeKit }).isotope;

describe('ISOTOPE Reactor Hauler', () => {
  it('RAD SPRAYER doses every bot in the cone ahead (nearest hardest), irradiates them, never a bot behind or out of reach', () => {
    const near = bot(0, 3);
    const side = bot(1.5, 5);
    const far = bot(0, sprayRange(1.2) + 3);
    const behind = bot(0, -3);
    const wide = bot(5, 0.5);
    const r = rig([near, side, far, behind, wide]);
    r.held.add('Space');
    r.run(1);
    expect(near.dealt).toBeGreaterThan(0);
    expect(side.dealt).toBeGreaterThan(0);
    expect(side.dealt).toBeLessThan(near.dealt);
    expect(far.dealt).toBe(0);
    expect(behind.dealt).toBe(0);
    expect(wide.dealt).toBe(0);
    expect(iso(r.c).rads.has(near)).toBe(true);
    // Radiation fills Critical Mass.
    expect((r.c as unknown as { critCharge: number }).critCharge).toBeGreaterThan(0);
    r.held.clear();
    // Off the trigger: no more spray, but the RAD DOSE that soaked in keeps burning for a long time (well past the
    // old 3 s), keeping the bot irradiated, then runs out.
    const before = near.dealt;
    r.run(1);
    expect(near.dealt).toBeGreaterThan(before);
    r.run(5);
    const mid = near.dealt;
    r.run(1);
    expect(near.dealt).toBeGreaterThan(mid);
    expect(iso(r.c).rads.has(near)).toBe(true);
    r.run(30);
    const settled = near.dealt;
    r.run(1);
    expect(near.dealt).toBe(settled);
    expect(iso(r.c).rads.has(near)).toBe(false);
  });

  it('RAD SPRAYER reach grows with Mega Hopper, damage with Meltdown upgrades', () => {
    expect(sprayRange(2.4)).toBeGreaterThan(sprayRange(1.2));
    expect(reactorBoost(125)).toBe(1);
    expect(reactorBoost(300)).toBeGreaterThan(reactorBoost(200));
  });

  it('FALLOUT TRAIL spends the E charge and lays gripping puddles behind that hurt bots driving through, for 4 s', () => {
    const onPath = bot(0, 4);
    const offPath = bot(6, 4);
    const r = rig([onPath, offPath]);
    r.press.add('KeyE');
    // Drive forward at 4 m/s for 4 s: the trail passes over onPath.
    for (let i = 0; i < 240; i++) {
      r.plow.position.z += 4 / 60;
      r.run(1 / 60);
    }
    expect(r.plow.whirlCharge).toBe(0);
    expect(r.c.abilityHud!.secondary.label).toBe('TRAIL');
    expect(onPath.dealt).toBeGreaterThan(0);
    expect(onPath.frozen).toBeGreaterThan(0); // the sludge grips
    expect(offPath.dealt).toBe(0);
    r.run(0.1);
    expect(iso(r.c).trailT).toBeLessThanOrEqual(0);
  });

  it('RAD DOSE burn repairs the plow through lifesteal (dose share only, never the base burn, never while dead)', () => {
    const dosed = bot(0, 3);
    const r = rig([dosed], { salvage: 3 });
    const ls = r.binding.stats.lifesteal;
    expect(ls).toBeGreaterThan(0);
    iso(r.c).addDose(dosed, 200);
    r.plow.hp = 50;
    r.run(1);
    expect(dosed.dealt).toBeGreaterThan(0);
    expect(r.plow.hp).toBeGreaterThan(50);
    // Heals for the dose slice only: strictly less than lifesteal on the whole tick.
    expect(r.plow.hp - 50).toBeLessThan(dosed.dealt * ls);

    // Irradiated but no dose: base burn only, no heal.
    const bare = bot(0, 3);
    const r2 = rig([bare], { salvage: 3 });
    (iso(r2.c) as unknown as { rads: Map<EnemyHandle, number> }).rads.set(bare, 3);
    r2.plow.hp = 50;
    r2.run(1);
    expect(bare.dealt).toBeGreaterThan(0);
    expect(r2.plow.hp).toBe(50);

    // Dead plow: the dose keeps burning but repairs nothing.
    const late = bot(0, 3);
    const r3 = rig([late], { salvage: 3 });
    iso(r3.c).addDose(late, 200);
    r3.plow.hp = 50;
    r3.plow.dead = true;
    r3.run(1);
    expect(r3.plow.hp).toBe(50);
  });
});
