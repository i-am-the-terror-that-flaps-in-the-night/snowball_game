import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { WaveDirector } from '../src/entities/Waves';
import { ZONES } from '../src/config/zones';
import { HATCH_MAX, HATCH_MIN } from '../src/world/omega/zone';
import { OMEGA_SPAWN } from '../src/world/omega/layout';
import type { GameContext } from '../src/core/types';

/** The Omega Works: waves rise out of floor hatches near the player, never through the far-off wall gates. */
function rig(px: number, pz: number, py = 0) {
  const spawns: { type: string; x: number; z: number; y?: number }[] = [];
  const ctx = {
    zone: ZONES[5],
    plow: { position: new THREE.Vector3(px, py, pz) },
    enemies: {
      spawn: (type: string, x: number, z: number, o?: { y?: number }) => (spawns.push({ type, x, z, y: o?.y }), {}),
      aliveCount: () => 0,
    },
  } as unknown as GameContext;
  return { w: new WaveDirector(ctx), spawns };
}

describe('Omega Works hatch spawning', () => {
  it('every minion of a round spawns 9-35 m from the player, spread over several hatches', () => {
    const { w, spawns } = rig(OMEGA_SPAWN.x, OMEGA_SPAWN.z);
    w.start(ZONES[5], 0);
    for (let i = 0; i < 60 * 30; i++) w.update(1 / 60);
    expect(spawns.length).toBeGreaterThan(5);
    for (const s of spawns) {
      const d = Math.hypot(s.x - OMEGA_SPAWN.x, s.z - OMEGA_SPAWN.z);
      expect(d).toBeGreaterThanOrEqual(HATCH_MIN - 1);
      expect(d).toBeLessThanOrEqual(HATCH_MAX + 1);
    }
    const spots = new Set(spawns.map((s) => `${Math.round(s.x / 3)},${Math.round(s.z / 3)}`));
    expect(spots.size).toBeGreaterThan(2);
  });

  it('the boss rises from an open-ground hatch, not under the Assembly Floor', () => {
    const { w, spawns } = rig(0, -40);
    w.start(ZONES[5], 3);
    for (let i = 0; i < 60 * 5; i++) w.update(1 / 60);
    const boss = spawns.find((s) => s.type === 'omega')!;
    expect(boss).toBeTruthy();
    expect(boss.y).toBeLessThan(1);
    expect(Math.abs(boss.x) < 18 && Math.abs(boss.z) < 18).toBe(false);
  });

  it('a player up on the Assembly Floor gets bots from the Floor hatches', () => {
    const { w, spawns } = rig(-4, 2, 7);
    w.start(ZONES[5], 0);
    for (let i = 0; i < 60 * 30; i++) w.update(1 / 60);
    expect(spawns.some((s) => (s.y ?? 0) > 6)).toBe(true);
  });
});
