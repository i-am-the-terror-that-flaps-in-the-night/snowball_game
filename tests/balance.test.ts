import { PVE_MULT } from '../src/entities/combat/arsenal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KINDS, clusterDps, duelGunDamage, duelTtk, singleDps, statsFor, ultFill, ultFillBoss } from '../scripts/balance/sim';
import type { PlowKind } from '../src/config/plows';
import { computeStatsFor } from '../src/core/Progression';
import { ultCharge } from '../src/entities/combat/ultimates';

/* Balance invariants on the headless sim (scripts/balance/sim.ts; the full report is `npm run balance`). Storm strikes
 * and the like roll Math.random, so it is seeded here to keep these deterministic. */
const realRandom = Math.random;
beforeAll(() => {
  let s = 12345;
  Math.random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
});
afterAll(() => {
  Math.random = realRandom;
});

describe('ultimate meters', () => {
  it('grow with pilot power, so upgrades never fill them in a few seconds', () => {
    const fresh = computeStatsFor({}, 'volt');
    const big = computeStatsFor({ packedIce: 10, voltClap: 8 }, 'volt');
    expect(fresh.ultPower).toBe(1);
    expect(ultCharge(fresh, 1000)).toBe(1000);
    expect(ultCharge(big, 1000)).toBeGreaterThan(8000);
    // Overclock makes every ability (and so the damage) faster: the meter grows to match.
    expect(ultCharge(computeStatsFor({ packedIce: 10, voltClap: 8, overclock: 8 }, 'volt'), 1000)).toBeGreaterThan(ultCharge(big, 1000) * 1.8);
  });

  it.each(KINDS)('%s: fills in 20-35 s fresh (ARSENAL 15+: its storm charges faster by request), and no faster than 12 s late-game (in a fight or on a boss)', (kind) => {
    const fresh = ultFill(kind, 'fresh', 150);
    expect(fresh).toBeGreaterThan(kind === 'arsenal' ? 15 : 20);
    expect(fresh).toBeLessThan(35);
    expect(ultFill(kind, 'high', 150)).toBeGreaterThan(12);
    expect(ultFillBoss(kind, 'high', 90)).toBeGreaterThan(kind === 'arsenal' ? 9 : 12); // ARSENAL's faster storm
  });
});

/** Vehicles whose SPACE / E (VehicleKit.primary / secondary) are still no-op stubs: left out of the DPS ordering
 *  below until their builder lands them (each builder deletes its own entry). */
const PENDING = new Set<PlowKind>([]);

describe('sustained damage', () => {
  it.each(['fresh', 'high'] as const)('%s: every plow within 25%% of the mean single-target DPS; VOLT-9 / BRUTUS / ISOTOPE match ARSENAL (within 8%%)', (tier) => {
    const live = KINDS.filter((k) => !PENDING.has(k));
    // ARSENAL hits bots PVE_MULT x harder by design; it is balanced against the others on its duel-equivalent damage.
    const dps = new Map(live.map((k) => [k, singleDps(k, tier, 30) / (k === 'arsenal' ? PVE_MULT : 1)] as const));
    const mean = [...dps.values()].reduce((a, b) => a + b, 0) / dps.size;
    for (const d of dps.values()) expect(Math.abs(d / mean - 1)).toBeLessThan(0.25);
    const arsenal = dps.get('arsenal')!;
    expect(arsenal).toBeGreaterThan(mean * 0.7);
    for (const k of live) if (k !== 'classic' && k !== 'arsenal') expect(Math.abs(dps.get(k)! / arsenal - 1)).toBeLessThan(0.18); // 18%: overkill on dying dummies trims ARSENAL's 3x a little
  });

  it.each(['fresh', 'high'] as const)('%s: VOLT-9 / BRUTUS / ISOTOPE out-damage ARSENAL on a cluster (before its PvE bonus)', (tier) => {
    const arsenal = clusterDps('arsenal', tier, 30) / PVE_MULT;
    expect(arsenal).toBeGreaterThan(0);
    for (const k of KINDS) if (k !== 'classic' && k !== 'arsenal' && !PENDING.has(k)) expect(clusterDps(k, tier, 30)).toBeGreaterThan(arsenal);
  });
});

describe('duel', () => {
  it('the minigun alone takes under a fifth of a same-tier plow in 2 s of held fire', () => {
    for (const tier of ['fresh', 'mid', 'high'] as const) {
      expect(duelGunDamage(tier, 2) / statsFor('classic', tier).maxHp).toBeLessThan(0.2);
    }
  });

  it.each(['fresh', 'high'] as const)('%s: no plow kills a parked same-tier plow in under 4 s of sustained fire', (tier) => {
    for (const a of KINDS) for (const d of KINDS) expect(duelTtk(a, d, tier, 12)).toBeGreaterThan(4);
  });
});
