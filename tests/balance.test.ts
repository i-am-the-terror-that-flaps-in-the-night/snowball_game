import { PVE_MULT } from '../src/entities/combat/arsenal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KINDS, clusterDps, duelGunDamage, duelTtk, fakePlow, newCtx, pilot, singleDps, statsFor, ultFill, ultFillBoss } from '../scripts/balance/sim';
import type { PlowKind } from '../src/config/plows';
import { computeStatsFor } from '../src/core/Progression';
import { ultCharge, ultMeter } from '../src/entities/combat/ultimates';
import { fight, ultShare } from '../scripts/balance/duel2';
import { DUEL_KIND_DAMAGE, DUEL_KIND_TAKEN, DUEL_ULT_CHARGE } from '../src/config/duel';
import type { EnemyManagerAPI } from '../src/core/types';

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

  it.each(KINDS)('%s: fills in 20-35 s fresh (ARSENAL 15+, VOLT-9 19+: both by request), and no faster than 12 s late-game (in a fight or on a boss)', (kind) => {
    const fresh = ultFill(kind, 'fresh', 150);
    // VOLT-9 19+: its Arc Lance buff (2.1 -> 2.7 per tick, by request) also fills SUPERCELL faster (19.4 s fresh).
    expect(fresh).toBeGreaterThan(kind === 'arsenal' ? 15 : kind === 'volt' ? 19 : 20);
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
    // VOLT-9 is measured with a bot near the dummy (grounded false): alone, its GROUNDED ARC (1.75x on a bot with
    // nothing to chain to) is always on, which inflated its number well past what it does in real runs.
    const dps = new Map(live.map((k) => [k, singleDps(k, tier, 30, k !== 'volt') / (k === 'arsenal' ? PVE_MULT : 1)] as const));
    const mean = [...dps.values()].reduce((a, b) => a + b, 0) / dps.size;
    for (const d of dps.values()) expect(Math.abs(d / mean - 1)).toBeLessThan(0.25);
    const arsenal = dps.get('arsenal')!;
    expect(arsenal).toBeGreaterThan(mean * 0.7);
    // BRUTUS's Wrecking Fist was buffed by request (no recovery, faster punches): at least ARSENAL, at most +45%.
    expect(dps.get('brute')! / arsenal).toBeGreaterThan(0.95);
    expect(dps.get('brute')! / arsenal).toBeLessThan(1.45);
    // 18%: overkill on dying dummies trims ARSENAL's PvE bonus a little. VOLT-9 is measured ungrounded (above), so it
    // gets the same 18% (it had 25% while the lone dummy granted it the GROUNDED ARC).
    for (const k of live) if (k !== 'classic' && k !== 'arsenal' && k !== 'brute') expect(Math.abs(dps.get(k)! / arsenal - 1)).toBeLessThan(0.18);
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
  }, 60_000);
  it.each(['fresh', 'mid', 'high'] as const)('%s: an ultimate on a parked same-tier plow is a big swing, never a one-shot (<= 45% of max HP)', (tier) => {
    for (const a of KINDS) {
      const shares = KINDS.map((d) => ultShare(a, d, tier, 4)).filter(Number.isFinite);
      expect(shares.length).toBeGreaterThan(0);
      for (const sh of shares) expect(sh).toBeLessThanOrEqual(0.45);
      // ...and still a real swing against a plow without a Battery Shield to soak it
      expect(ultShare(a, 'classic', tier, 4)).toBeGreaterThan(0.15);
    }
  }, 60_000);

  it.each(['fresh', 'high'] as const)('%s: in continuous same-tier fighting every plow fills its meter, first ultimate within 20-60 s', (tier) => {
    for (const k of KINDS) {
      const firsts: number[] = [];
      for (const o of KINDS) {
        const r = fight(k, o, tier, { mode: 'move', seed: 101 + KINDS.indexOf(o), cap: 90, continuous: true });
        if (r.ults[0].length) firsts.push(r.ults[0][0]);
      }
      expect(firsts.length, k).toBeGreaterThanOrEqual(4);
      const mean = firsts.reduce((x, y) => x + y, 0) / firsts.length;
      expect(mean, k).toBeGreaterThan(20);
      expect(mean, k).toBeLessThan(60);
    }
  }, 120_000);
});

describe('duel ultimate meter', () => {
  it('is sized in the opponent\'s HP in the Duel (tier-independent), in damage off-line', () => {
    const st = computeStatsFor({ packedIce: 10, voltClap: 8 }, 'volt');
    const foe = { duelFoeMaxHp: 400 } as unknown as EnemyManagerAPI;
    expect(ultMeter({ stats: st, enemies: foe }, 2700)).toBe(ultCharge(st, 2700));
    expect(ultMeter({ stats: st, enemies: foe, pvp: true }, 2700)).toBeCloseTo(DUEL_ULT_CHARGE * 400);
    expect(ultMeter({ stats: computeStatsFor({}, 'volt'), enemies: foe, pvp: true }, 2700)).toBeCloseTo(DUEL_ULT_CHARGE * 400);
    // a guest's Combat hits nothing (NO_TARGETS): it never charges, and falls back to the off-line size
    expect(ultMeter({ stats: st, enemies: {} as EnemyManagerAPI, pvp: true }, 2700)).toBe(ultCharge(st, 2700));
  });

  it('carries over between rounds (Combat.clear(true), DuelManager.parkPlows) and empties at match start', () => {
    const st = statsFor('volt', 'mid');
    const p = pilot(newCtx(), st, fakePlow(st), {}, true);
    const c = p.c as unknown as { critCharge: number };
    c.critCharge = 0.7;
    p.c.clear(true);
    expect(c.critCharge).toBe(0.7);
    p.c.clear();
    expect(c.critCharge).toBe(0);
  });
});

describe('Duel-only balance levers', () => {
  it('DUEL_KIND_DAMAGE / DUEL_KIND_TAKEN change Duel damage but no PvE stat, DPS or meter (campaign / Survival / Brawl)', () => {
    const pve = () =>
      KINDS.map((k) => {
        // Reseed per plow: the numbers must not depend on how many rolls the other measurements used.
        let s = 777;
        Math.random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
        const st = statsFor(k, 'high');
        return [st.maxHp, st.damageMult, st.maxSpeed, singleDps(k, 'high', 10), clusterDps(k, 'high', 10), ultFill(k, 'fresh', 60)];
      });
    const saved = [{ ...DUEL_KIND_DAMAGE }, { ...DUEL_KIND_TAKEN }];
    const before = pve();
    const duelBefore = duelTtk('classic', 'brute', 'high', 60);
    try {
      for (const k of KINDS) {
        DUEL_KIND_DAMAGE[k] = 3;
        DUEL_KIND_TAKEN[k] = 0.2;
      }
      expect(pve()).toEqual(before);
      // ...while the Duel sees them (3 x 0.2: every plow-vs-plow hit at 60%).
      expect(duelTtk('classic', 'brute', 'high', 60)).toBeGreaterThan(duelBefore * 1.2);
    } finally {
      for (const k of KINDS) {
        delete DUEL_KIND_DAMAGE[k];
        delete DUEL_KIND_TAKEN[k];
      }
      Object.assign(DUEL_KIND_DAMAGE, saved[0]);
      Object.assign(DUEL_KIND_TAKEN, saved[1]);
    }
  });
});
