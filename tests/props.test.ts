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
