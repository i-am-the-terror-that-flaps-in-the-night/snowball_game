import { describe, expect, it } from 'vitest';
import { CAP, fight, matrix, preferredRange } from '../scripts/balance/duel2';
import { KINDS, statsFor } from '../scripts/balance/sim';

describe('two-way duel sim', () => {
  it('a fight ends (someone is wrecked, or the round times out)', () => {
    const r = fight('brute', 'classic', 'fresh', { mode: 'stand', dist: 3, seed: 7 });
    expect([-1, 0, 1]).toContain(r.winner);
    expect(r.t).toBeGreaterThan(0);
    expect(r.t).toBeLessThanOrEqual(CAP);
    if (r.winner !== -1 && !r.timeout) expect(r.hp[1 - r.winner]).toBe(0);
  });

  it('is deterministic for a seed', () => {
    const a = fight('volt', 'isotope', 'fresh', { mode: 'move', seed: 3, cap: 20 });
    const b = fight('volt', 'isotope', 'fresh', { mode: 'move', seed: 3, cap: 20 });
    expect(a).toEqual(b);
  });

  it('a mirror is a coin flip over a small sample', () => {
    const c = matrix('fresh', { name: 'm', mode: 'move' }, 12, 5, ['classic'])[0][0];
    expect(c.n).toBe(12);
    expect(c.wins + c.losses + c.draws).toBe(12);
    const decided = c.wins + c.losses;
    if (decided >= 6) expect(Math.abs(c.wins / decided - 0.5)).toBeLessThanOrEqual(0.34);
  });

  it('preferred ranges are positive and inside the arena', () => {
    for (const k of KINDS) {
      const d = preferredRange(statsFor(k, 'mid'));
      expect(d).toBeGreaterThan(2);
      expect(d).toBeLessThan(20);
    }
  });
});
