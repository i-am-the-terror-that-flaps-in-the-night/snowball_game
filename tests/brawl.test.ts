import { describe, expect, it } from 'vitest';
import { BRAWL_HIT_CAP, brawlHit, streakMult } from '../src/config/brawl';

describe('brawlHit', () => {
  it('never exceeds the cap fraction of max hp', () => {
    for (const hp of [50, 120, 400]) {
      for (const raw of [1, 10, 100, 1000, 1e6]) {
        expect(brawlHit(raw, hp)).toBeLessThanOrEqual(BRAWL_HIT_CAP * hp);
        expect(brawlHit(raw, hp, 0.8)).toBeLessThanOrEqual(0.8 * hp);
      }
    }
  });

  it('barely changes small hits and is monotonic', () => {
    expect(brawlHit(1, 200)).toBeCloseTo(1, 1);
    let prev = 0;
    for (let raw = 1; raw < 1000; raw += 7) {
      const v = brawlHit(raw, 150);
      expect(v).toBeGreaterThan(prev);
      expect(v).toBeLessThanOrEqual(raw);
      prev = v;
    }
  });

  it('is safe for zero damage or zero max hp', () => {
    expect(brawlHit(0, 100)).toBe(0);
    expect(brawlHit(0, 0)).toBe(0);
    expect(brawlHit(50, 0)).toBe(0);
  });
});

describe('streakMult', () => {
  it('steps through the streak tiers', () => {
    expect(streakMult(0)).toBe(1);
    expect(streakMult(3)).toBe(1.5);
    expect(streakMult(5)).toBe(2);
    expect(streakMult(8)).toBe(3);
    expect(streakMult(99)).toBe(4);
  });
});
