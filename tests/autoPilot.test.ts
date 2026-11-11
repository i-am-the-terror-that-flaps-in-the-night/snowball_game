import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AutoPilot, autoHoldRange } from '../src/duel/plumbing';
import { computeStatsFor } from '../src/core/Progression';
import type { PlowKind } from '../src/config/plows';
import type { Plow } from '../src/entities/Plow';

/* The Duel AutoPilot (probes / duel-matrix) plays each kit's role: Classic tap-slams close and rushes from range, VOLT-9
 * kites at the Arc Lance's reach, ARSENAL holds mid range inside its laser reach. */

type Fake = {
  dead: boolean; position: THREE.Vector3; heading: number; heldBallRadius: number; dashReady: number; whirlReady: number;
  rushCharge: number; rushPreview: number; rushing: boolean; pilot: { stats: ReturnType<typeof computeStatsFor> };
};
const fake = (kind: PlowKind, z: number): Fake => ({
  dead: false, position: new THREE.Vector3(0, 0, z), heading: 0, heldBallRadius: 0, dashReady: 1, whirlReady: 0,
  rushCharge: -1, rushPreview: 0, rushing: false, pilot: { stats: computeStatsFor({}, kind) },
});
function setup(kind: PlowKind, gap: number) {
  const me = fake(kind, 0);
  const op = fake('brute', gap);
  const ap = new AutoPilot(() => me as unknown as Plow, () => op as unknown as Plow);
  return { me, op, ap };
}

describe('Duel AutoPilot', () => {
  it('Classic: taps the ball slam up close with a ball (no hold); no ball, no tap', () => {
    const { me, ap } = setup('classic', 4.5);
    ap.think(1 / 60);
    expect(ap.wasPressed('Space')).toBe(false);
    me.heldBallRadius = 1;
    ap.think(1 / 60);
    expect(ap.wasPressed('Space')).toBe(true);
    expect(ap.isDown('Space')).toBe(false);
  });

  it('Classic: holds a rush at range and lets go once the telegraph matches the gap', () => {
    const { me, ap } = setup('classic', 12);
    ap.think(1 / 60);
    expect(ap.isDown('Space')).toBe(true);
    me.rushCharge = 0.3;
    me.rushPreview = 7;
    ap.think(1 / 60);
    expect(ap.isDown('Space')).toBe(true);
    me.rushPreview = 9.6;
    ap.think(1 / 60);
    expect(ap.isDown('Space')).toBe(false);
  });

  it("Classic: no rush without the meter for one that reaches; dashes only past the rush's reach", () => {
    const low = setup('classic', 16);
    low.me.dashReady = 0.3;
    low.ap.think(1 / 60);
    expect(low.ap.isDown('Space')).toBe(false);
    const far = setup('classic', 24);
    far.ap.think(1 / 60);
    expect(far.ap.isDown('Space')).toBe(false);
    expect(far.ap.wasPressed('ShiftLeft')).toBe(true);
  });

  it('VOLT-9: backs off with the lance up when close, holds in the 0.7-0.9 x reach band, closes from beyond', () => {
    const R = autoHoldRange(computeStatsFor({}, 'volt'));
    const at = (gap: number) => {
      const { ap } = setup('volt', gap);
      ap.think(1 / 60);
      return ap;
    };
    const close = at(4);
    expect(close.throttle).toBe(-1);
    expect(close.isDown('Space')).toBe(true);
    expect(at(R * 0.6).throttle).toBeLessThan(0);
    expect(at(R * 0.8).throttle).toBe(0);
    expect(at(R * 0.8).isDown('Space')).toBe(true);
    expect(at(R * 1.2).throttle).toBe(1);
    expect(at(R * 1.2).isDown('Space')).toBe(false);
  });

  it('ARSENAL: holds the laser inside its reach and stops closing at mid range', () => {
    const R = autoHoldRange(computeStatsFor({}, 'arsenal'));
    const { ap } = setup('arsenal', R * 0.5);
    ap.think(1 / 60);
    expect(ap.isDown('Space')).toBe(true);
    expect(ap.throttle).toBeLessThan(0.5);
    const far = setup('arsenal', R * 0.9);
    far.ap.think(1 / 60);
    expect(far.ap.isDown('Space')).toBe(true);
    expect(far.ap.throttle).toBe(1);
  });

  it('BRUTUS and ISOTOPE still drive straight in', () => {
    for (const k of ['brute', 'isotope'] as const) {
      const { ap } = setup(k, 5);
      ap.think(1 / 60);
      expect(ap.throttle).toBe(1);
    }
  });
});
