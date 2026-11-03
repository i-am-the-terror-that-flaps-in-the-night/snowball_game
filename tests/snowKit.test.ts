import { describe, expect, it } from 'vitest';
import { isVehicle } from '../src/config/plows';

/* ⚙ Settings → Main attacks: a vehicle switched to the snowball kit plays SPACE / E like the Classic. */
describe('snowball kit option', () => {
  it('only a non-Classic kind without snowKit uses its own SPACE / E', () => {
    expect(isVehicle({ plowKind: 'classic' })).toBe(false);
    expect(isVehicle({ plowKind: 'arsenal' })).toBe(true);
    expect(isVehicle({ plowKind: 'arsenal', snowKit: true })).toBe(false);
    expect(isVehicle({ plowKind: 'volt', snowKit: false })).toBe(true);
  });
});
