import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Props } from '../src/world/Props';
import { PLOW_SPAWN, type GameContext, type Obstacle } from '../src/core/types';

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });

function rig() {
  const coins: number[] = [];
  const ctx = { scene: new THREE.Scene(), fx: noop, audio: noop, pickups: { spawnCoins: (_p: unknown, n: number) => coins.push(n) } } as unknown as GameContext;
  return { props: new Props(ctx), coins };
}

describe('destructible props', () => {
  it('places a deterministic layout, clear of the plow spawn and existing obstacles', () => {
    const { props } = rig();
    const fixed: Obstacle = { x: 10, z: -10, r: 3 };
    const obs: Obstacle[] = [fixed];
    props.reset(obs, true, 42, false, true);
    const mine = obs.filter((o) => o.breakable);
    expect(mine.length).toBeGreaterThan(8);
    expect(props.standing).toBe(mine.length);
    for (const o of mine) {
      expect(Math.hypot(o.x - PLOW_SPAWN.x, o.z - PLOW_SPAWN.z)).toBeGreaterThan(8);
      expect(Math.hypot(o.x - fixed.x, o.z - fixed.z)).toBeGreaterThan(fixed.r + o.r);
    }
    const again: Obstacle[] = [fixed];
    rig().props.reset(again, true, 42, false, true);
    expect(again.map((o) => [o.x, o.z])).toEqual(obs.map((o) => [o.x, o.z]));
  });

  it('a blast breaks what it overlaps: collider removed, coins dropped, nothing else touched', () => {
    const { props, coins } = rig();
    const obs: Obstacle[] = [];
    props.reset(obs, true, 7, false, true);
    const n0 = props.standing;
    const t = obs[0];
    expect(props.blast(t.x, t.z, 0.1)).toBeGreaterThanOrEqual(1);
    expect(obs.includes(t)).toBe(false);
    expect(props.standing).toBeLessThan(n0);
    expect(coins.length).toBe(n0 - props.standing);
    // Broken props stay broken (two states) until the next reset.
    expect(props.blast(t.x, t.z, 0.1)).toBe(0);
    props.reset(obs, true, 7, false, true);
    expect(props.standing).toBe(n0);
    expect(obs.filter((o) => o.breakable).length).toBe(n0);
  });

  it('rays stop at the first prop; rams break by collider; off = none', () => {
    const { props } = rig();
    const obs: Obstacle[] = [];
    props.reset(obs, true, 9, false, false);
    const t = obs[0];
    const d = props.blastRay(t.x - 20, t.z, 1, 0, 40);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(20);
    expect(props.blastRay(0, 0, 1, 0, 0.01)).toBe(-1);
    const u = obs.find((o) => o.breakable)!;
    expect(props.breakObstacle(u)).toBe(true);
    expect(props.breakObstacle(u)).toBe(false);
    expect(props.breakObstacle({ x: 0, z: 0, r: 1 })).toBe(false);
    props.reset(obs, false, 9, false, false);
    expect(obs.length).toBe(0);
    expect(props.standing).toBe(0);
  });
});

/* ------------------------------------------------------------------ bots vs props */

import { EnemyManager } from '../src/entities/Enemies';

describe('bots smashing props', () => {
  /** EnemyManager.pushOutObstacles on a bare manager (no scene needed) against a real Props layout. */
  function botRig() {
    const { props, coins } = rig();
    const obstacles: Obstacle[] = [];
    props.reset(obstacles, true, 11, false, true);
    const world = { obstacles, breakObstacle: (o: Obstacle, c?: boolean) => props.breakObstacle(o, c) };
    const mgr = Object.create(EnemyManager.prototype) as { ctx: unknown; pushOutObstacles(e: unknown): void };
    mgr.ctx = { world };
    const target = obstacles.find((o) => o.breakable)!;
    const bot = (o: Partial<{ kvx: number; kvz: number; atk: boolean; speed: number; isBoss: boolean }>) => ({
      position: new THREE.Vector3(target.x + 0.2, 0, target.z), radius: 1, kvx: 0, kvz: 0, atk: false, speed: 0, isBoss: false, ...o,
    });
    return { props, coins, obstacles, target, mgr, bot };
  }

  it('a boss mid-charge ploughs through a prop without dropping coins', () => {
    const { props, coins, obstacles, target, mgr, bot } = botRig();
    const n = props.standing;
    const b = bot({ atk: true, speed: 14, isBoss: true });
    mgr.pushOutObstacles(b);
    expect(props.standing).toBe(n - 1);
    expect(obstacles.includes(target)).toBe(false);
    expect(coins.length).toBe(0);
    // Not pushed out: it kept going.
    expect(b.position.x).toBeCloseTo(target.x + 0.2);
  });

  it('a bot knocked flying into a prop breaks it and drops coins', () => {
    const { props, coins, mgr, bot } = botRig();
    const n = props.standing;
    mgr.pushOutObstacles(bot({ kvx: 9 }));
    expect(props.standing).toBe(n - 1);
    expect(coins.length).toBe(1);
  });

  it('a bot walking into a prop is just pushed out', () => {
    const { props, coins, obstacles, target, mgr, bot } = botRig();
    const n = props.standing;
    const b = bot({ speed: 5, kvx: 2 });
    mgr.pushOutObstacles(b);
    expect(props.standing).toBe(n);
    expect(obstacles.includes(target)).toBe(true);
    expect(coins.length).toBe(0);
    expect(Math.hypot(b.position.x - target.x, b.position.z - target.z)).toBeCloseTo(target.r + 1);
  });
});

/* ------------------------------------------------------------------ props on terrain */

import { Terrain } from '../src/world/Terrain';
import { ZONES } from '../src/config/zones';

describe('props on biome terrain', () => {
  it('stand on the ground height, never touch lava, and keep every ramp run-up / landing clear', () => {
    for (const zone of ZONES.slice(0, 5)) {
      const terrain = new Terrain(zone.terrain);
      const ctx = { scene: new THREE.Scene(), fx: noop, audio: noop, terrain } as unknown as GameContext;
      const props = new Props(ctx);
      for (const seed of [1, 42, 777]) {
        const obs: Obstacle[] = [];
        props.reset(obs, true, seed, false, true);
        const mine = obs.filter((o) => o.breakable);
        expect(mine.length, zone.name).toBeGreaterThan(5);
        for (const o of mine) {
          for (let k = 0; k <= 8; k++) {
            const a = (k * Math.PI) / 4;
            const rr = k === 8 ? 0 : o.r;
            expect(terrain.materialAt(o.x + Math.cos(a) * rr, o.z + Math.sin(a) * rr), `${zone.name} prop on lava`).not.toBe('lava');
          }
          for (const s of terrain.shapes) {
            if (s.kind !== 'ramp') continue;
            const dx = o.x - s.x;
            const dz = o.z - s.z;
            const v = dx * Math.sin(s.rot) + dz * Math.cos(s.rot);
            const u = dx * Math.cos(s.rot) - dz * Math.sin(s.rot);
            const inLane = Math.abs(u) < s.w / 2 + o.r && v > -4 && v < s.len + (s.fall ?? 1) + 6;
            expect(inLane, `${zone.name} prop in a ramp lane`).toBe(false);
          }
        }
      }
    }
  });
});
