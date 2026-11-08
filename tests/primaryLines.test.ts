import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Combat } from '../src/entities/Combat';
import { computeStatsFor } from '../src/core/Progression';
import { FX, type UpgradeId } from '../src/config/upgrades';
import type { PlowKind } from '../src/config/plows';
import type { EnemyHandle, GameContext } from '../src/core/types';
import type { PilotBinding } from '../src/entities/pilot';
import { SCRAP_LIFE, SCRAP_ORBIT, type ArsenalKit } from '../src/entities/combat/arsenal';

/* The primary-weapon lines (Arc Lance, Piston Fists, Rad Sprayer) and the damaging passive (Spiked Hull): level 0 is the base weapon / off, every level adds damage. */

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });
type Bot = EnemyHandle & { hp: number; dealt: number };

function rig(kind: PlowKind, levels: Partial<Record<UpgradeId, number>>, botAt: [number, number][], hp = 1e9) {
  const held = new Set<string>();
  const bots = botAt.map(
    ([x, z], i) => ({ id: i + 1, position: new THREE.Vector3(x, 0, z), radius: 1, hp, maxHp: hp, alive: true, dealt: 0, type: 'grunt', mass: 1, isBoss: false }) as unknown as Bot,
  );
  const plow = {
    position: new THREE.Vector3(), heading: 0, hp: 100, maxHp: 100, dead: false, radius: 1.6, speed: 0, turretAim: 0, turretHeading: 0, whirlCharge: 1, surfaceY: 0,
    heldBallRadius: 0, sawHalo: 0, hop: 0, dashing: false, whirling: false, invulnerable: false,
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
    getBladeTip: (o: THREE.Vector3) => o.set(0, 0, 2.5),
  };
  const enemies = {
    bosses: [],
    query: (x: number, z: number, r: number, o: EnemyHandle[] = []) => {
      o.length = 0;
      for (const b of bots) if (b.alive && Math.hypot(b.position.x - x, b.position.z - z) <= r + b.radius) o.push(b);
      return o;
    },
    damage: (e: EnemyHandle, n: number) => {
      const b = e as Bot;
      b.dealt += n;
      b.hp -= n;
      if (b.hp > 0) return false;
      (b as { alive: boolean }).alive = false;
      return true;
    },
  };
  const binding = {
    stats: computeStatsFor(levels, kind), plow, enemies, snow: noop, events: noop, local: false, authoritative: true, look: null, pvp: true,
    input: { throttle: 0, steer: 0, wasPressed: () => false, isDown: (k: string) => held.has(k) },
    audio: noop,
  } as unknown as PilotBinding;
  const ctx = { scene: new THREE.Scene(), time: 0, fx: noop, ui: noop, impact: noop, cameraRig: noop, terrain: undefined } as unknown as GameContext;
  const c = new Combat(ctx, binding);
  c.clear();
  const run = (s: number) => {
    for (let i = 0; i < Math.round(s * 60); i++) {
      (ctx as { time: number }).time += 1 / 60;
      c.update(1 / 60);
    }
  };
  return { bots, held, run, c, plow };
}

/** Damage a single bot `z` m ahead takes from 3 s of held SPACE with the given line level. */
function primaryDamage(kind: PlowKind, id: UpgradeId, level: number, z = 4): number {
  const r = rig(kind, { [id]: level }, [[0, z]]);
  r.held.add('Space');
  r.run(3);
  return r.bots[0].dealt;
}

describe('primary-weapon lines', () => {
  it.each([
    ['volt', 'voltArc'],
    ['brute', 'bruteFist'],
    ['isotope', 'isoSpray'],
  ] as const)('%s %s: level 0 is the base weapon, and damage rises with every level', (kind, id) => {
    const d = [0, 1, 3, 8].map((l) => primaryDamage(kind, id, l));
    expect(d[0]).toBeGreaterThan(0);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1]);
    expect(d[3] / d[0]).toBeGreaterThan(1.3);
  });

  it('level 0 leaves the weapons exactly as they were', () => {
    const s = computeStatsFor({}, 'volt');
    expect([s.arcBoost, s.arcRate, s.fistBoost, s.fistReach, s.sprayBoost, s.sprayReach]).toEqual([1, 1, 1, 0, 1, 0]);
  });

  it('Piston Fists reach further; the Rad Sprayer reaches bots the base spray cannot', () => {
    expect(computeStatsFor({ bruteFist: 8 }, 'brute').fistReach).toBeGreaterThan(computeStatsFor({ bruteFist: 1 }, 'brute').fistReach);
    expect(primaryDamage('isotope', 'isoSpray', 0, 11.5)).toBe(0);
    expect(primaryDamage('isotope', 'isoSpray', 8, 11.5)).toBeGreaterThan(0);
  });

  it('lines only count on their own vehicle', () => {
    expect(computeStatsFor({ voltArc: 5 }, 'brute').arcBoost).toBe(1);
    expect(computeStatsFor({ bruteSpikes: 5 }, 'volt').spikeDps).toBe(0);
  });
});

describe('damaging passives', () => {
  it.each([
    ['brute', 'bruteSpikes', 2.5, 9],
  ] as const)('%s %s: off at level 0; hits a nearby bot but not a far one; harder with levels', (kind, id, nearZ, farZ) => {
    const off = rig(kind, {}, [[0, -nearZ]]);
    off.run(2);
    expect(off.bots[0].dealt).toBe(0);
    const lv = (l: number) => {
      const r = rig(kind, { [id]: l }, [
        [0, -nearZ],
        [farZ, 0],
      ]);
      r.run(2);
      return r.bots;
    };
    const [near1, far1] = lv(1);
    expect(near1.dealt).toBeGreaterThan(0);
    expect(far1.dealt).toBe(0);
    expect(lv(6)[0].dealt).toBeGreaterThan(near1.dealt * 1.5);
  });

  it('the Spiked Hull curve starts at 0 and grows', () => {
    expect(FX.spikeDps(0)).toBe(0);
    expect(FX.spikeDps(10)).toBeGreaterThan(FX.spikeDps(1));
  });
});

describe('ARSENAL Scrap Magnet', () => {
  const kit = (r: ReturnType<typeof rig>) => (r.c as unknown as { arsenal: ArsenalKit }).arsenal;

  it('off at level 0; the field slowly hurts a bot inside it but not one outside', () => {
    const off = rig('arsenal', {}, [[0, -5]]);
    off.run(2);
    expect(off.bots[0].dealt).toBe(0);
    const r = rig('arsenal', { armMagnet: 1 }, [
      [0, -5],
      [14, 0],
    ]);
    r.run(2);
    expect(r.bots[0].dealt).toBeGreaterThan(0);
    expect(r.bots[0].dealt).toBeLessThan(40); // a trickle: ~1/4 of Rad Aura before the PvE bonus
    expect(r.bots[1].dealt).toBe(0);
  });

  it('a nearby wreck adds a shard, a far one does not; shards hit bots they pass and expire', () => {
    // A 1-hp bot 5 m away dies to the first field tick: its scrap joins the ring.
    const r = rig('arsenal', { armMagnet: 3 }, [[0, -5]], 1);
    r.run(1);
    expect(r.bots[0].alive).toBe(false);
    expect(kit(r).scrapCount).toBe(1);
    const far = { position: new THREE.Vector3(30, 0, 0), alive: false } as unknown as EnemyHandle;
    kit(r).scrapFrom(far);
    expect(kit(r).scrapCount).toBe(1);
    // A tough bot parked on the orbit ring takes shard hits on top of the field.
    const ringBot = { id: 9, position: new THREE.Vector3(SCRAP_ORBIT, 0, 0), radius: 1, hp: 1e9, maxHp: 1e9, alive: true, dealt: 0, type: 'grunt', mass: 1, isBoss: false };
    r.bots.push(ringBot as unknown as (typeof r.bots)[number]);
    r.run(3);
    const withShard = ringBot.dealt;
    const fieldOnly = rig('arsenal', { armMagnet: 3 }, [[SCRAP_ORBIT, 0]]);
    fieldOnly.run(3);
    expect(withShard).toBeGreaterThan(fieldOnly.bots[0].dealt * 1.5);
    r.bots.pop();
    r.run(SCRAP_LIFE);
    expect(kit(r).scrapCount).toBe(0);
  });

  it('the ring holds at most scrapMax shards', () => {
    const r = rig('arsenal', { armMagnet: 1 }, []);
    const max = computeStatsFor({ armMagnet: 1 }, 'arsenal').scrapMax;
    for (let i = 0; i < max + 4; i++) kit(r).scrapFrom({ position: new THREE.Vector3(2, 0, 2) } as unknown as EnemyHandle);
    expect(kit(r).scrapCount).toBe(max);
    expect(FX.scrapMax(1)).toBe(5);
    expect(FX.scrapMax(100)).toBeLessThanOrEqual(12);
  });
});
