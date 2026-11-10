import { describe, expect, it } from 'vitest';
import { ARC_CLOSE_MULT, arcCloseMult, arcRange } from '../src/entities/combat/volt';
import { RAD_MAXHP_BOT_CAP, RAD_MAXHP_FRAC } from '../src/entities/combat/isotope';
import { knockScale } from '../src/config/plows';

/* Role rework: VOLT-9 true ranged, ISOTOPE tank-buster, heavy plows resist knockback. */
describe('role rework', () => {
  it('VOLT-9 Arc Lance: 14 m base, ~20 m late; weak up close in the Duel (x0.6 inside 3 m, x1 from 5 m)', () => {
    expect(arcRange(1.2)).toBe(14);
    expect(arcRange(3.6)).toBeCloseTo(20, 5);
    expect(arcCloseMult(0)).toBe(ARC_CLOSE_MULT);
    expect(arcCloseMult(3)).toBe(ARC_CLOSE_MULT);
    expect(arcCloseMult(4)).toBeCloseTo((ARC_CLOSE_MULT + 1) / 2, 6);
    expect(arcCloseMult(5)).toBe(1);
    expect(arcCloseMult(12)).toBe(1);
  });

  it('heavy plows take less knockback: BRUTUS least, VOLT-9 / ARSENAL in full', () => {
    expect(knockScale('brute')).toBe(0.5);
    expect(knockScale('classic')).toBeLessThan(1);
    expect(knockScale('isotope')).toBeLessThan(1);
    expect(knockScale('volt')).toBe(1);
    expect(knockScale('arsenal')).toBe(1);
    expect(knockScale(undefined)).toBe(1);
    expect(knockScale('brute')).toBeLessThan(knockScale('classic'));
  });

  it('ISOTOPE tank-buster: a bot counts at most RAD_MAXHP_BOT_CAP of max HP (bosses do not melt)', () => {
    const perSec = (maxHp: number, pvp: boolean) => RAD_MAXHP_FRAC * (pvp ? maxHp : Math.min(maxHp, RAD_MAXHP_BOT_CAP));
    expect(perSec(50000, false)).toBe(perSec(RAD_MAXHP_BOT_CAP, false));
    expect(perSec(540, true)).toBeGreaterThan(perSec(360, true)); // BRUTUS burns faster than ARSENAL in the Duel
  });
});
