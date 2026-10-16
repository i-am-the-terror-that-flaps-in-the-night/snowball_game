import { describe, expect, it } from 'vitest';
import { FX, MIN_COOLDOWN, UPGRADES, UPGRADE_BY_ID, cooldown, grow, soft, upgradeCost } from '../src/config/upgrades';
import { PLOWS } from '../src/config/plows';

describe('upgradeCost', () => {
  it('starts at baseCost and grows strictly with level (including endless levels)', () => {
    for (const def of UPGRADES) {
      expect(upgradeCost(def, 0)).toBe(def.baseCost);
      const top = Number.isFinite(def.maxLevel) ? def.maxLevel : 60;
      let prev = upgradeCost(def, 0);
      for (let l = 1; l < top; l++) {
        const c = upgradeCost(def, l);
        expect(Number.isFinite(c)).toBe(true);
        // Specials (costGrowth 1) have a single level, so every multi-level upgrade must get pricier.
        expect(c, `${def.id} L${l}`).toBeGreaterThan(prev);
        prev = c;
      }
    }
  });

  it('keeps growing past the pips at a gentle endless rate', () => {
    const engine = UPGRADE_BY_ID.engine;
    const atPips = upgradeCost(engine, engine.pips);
    expect(upgradeCost(engine, engine.pips + 1) / atPips).toBeCloseTo(1.1, 1);
    expect(upgradeCost(engine, 100)).toBeGreaterThan(upgradeCost(engine, 50));
  });

  it('returns whole coins', () => {
    for (const def of UPGRADES) for (let l = 0; l < 12; l++) expect(Number.isInteger(upgradeCost(def, l))).toBe(true);
  });
});

describe('upgrade definitions', () => {
  it('have unique ids and valid plowOnly targets', () => {
    expect(new Set(UPGRADES.map((u) => u.id)).size).toBe(UPGRADES.length);
    for (const u of UPGRADES) if (u.plowOnly) expect(PLOWS[u.plowOnly]).toBeDefined();
  });

  it('plow-line and pilot upgrades are player-only', () => {
    for (const u of UPGRADES) if (u.category === 'pilot' || u.category === 'volt' || u.category === 'brute' || u.plowOnly) expect(u.playerOnly, u.id).toBe(true);
  });

  it('value labels render for every level without NaN', () => {
    for (const u of UPGRADES) for (const l of [0, 1, u.pips, u.pips + 5, 50]) expect(u.valueLabel(Math.min(l, u.maxLevel))).not.toMatch(/NaN|undefined/);
  });
});

describe('scaling curves', () => {
  it('soft is linear to the knee then approaches knee + span', () => {
    expect(soft(3, 5)).toBe(3);
    expect(soft(5, 5)).toBe(5);
    expect(soft(6, 5)).toBeGreaterThan(5);
    expect(soft(1000, 5)).toBeLessThanOrEqual(10);
    expect(soft(1000, 5, 2)).toBeCloseTo(7, 5);
  });

  it('grow is linear to the knee then keeps growing at rate', () => {
    expect(grow(4, 5)).toBe(4);
    expect(grow(15, 5)).toBeCloseTo(11);
    expect(grow(15, 5, 1)).toBe(15);
  });
});

describe('FX curves', () => {
  it('Overclock never goes below -60% and cooldown() never below MIN_COOLDOWN', () => {
    expect(FX.cooldownMult(0)).toBe(1);
    expect(FX.cooldownMult(10)).toBeCloseTo(0.4);
    for (const l of [10, 11, 50, 1e6]) expect(FX.cooldownMult(l)).toBeCloseTo(0.4);
    expect(FX.cooldownMult(-3)).toBe(1);
    for (let l = 0; l <= 200; l++) {
      const m = FX.cooldownMult(l);
      expect(m).toBeGreaterThanOrEqual(0.4 - 1e-9);
      for (const base of [0.1, 0.5, FX.dashCooldown(l), FX.whirlCooldown(l), FX.flameCooldown(l), FX.clapCooldown(l), FX.poundCooldown(l)]) {
        expect(cooldown(base, m)).toBeGreaterThanOrEqual(MIN_COOLDOWN);
      }
    }
    expect(cooldown(10, 0.5)).toBe(5);
    expect(cooldown(0.5, 0.4)).toBe(MIN_COOLDOWN);
  });

  it('ability cooldowns shrink with level but stay bounded', () => {
    for (const f of [FX.dashCooldown, FX.whirlCooldown, FX.flameCooldown, FX.clapCooldown, FX.poundCooldown]) {
      let prev = f(0);
      for (let l = 1; l <= 100; l++) {
        const v = f(l);
        expect(v).toBeLessThanOrEqual(prev + 1e-12);
        expect(v).toBeGreaterThan(0);
        prev = v;
      }
    }
    expect(FX.clapCooldown(1000)).toBeGreaterThanOrEqual(3);
    expect(FX.poundCooldown(1000)).toBeGreaterThanOrEqual(4);
  });

  it('Thunderclap values', () => {
    expect(FX.clapDamage(0)).toBe(70);
    expect(FX.clapDamage(5)).toBe(220);
    expect(FX.clapRadius(0)).toBe(10);
    expect(FX.clapRadius(5)).toBeCloseTo(14);
    expect(FX.clapStun(0)).toBeCloseTo(1.8);
    expect(FX.clapCooldown(0)).toBe(6);
    expect(FX.clapRadius(1000)).toBeLessThanOrEqual(10 + 0.8 * 10 + 1e-9);
  });

  it('Ground Pound values', () => {
    expect(FX.poundDamage(0)).toBe(85);
    expect(FX.poundDamage(5)).toBe(210);
    expect(FX.poundRadius(0)).toBe(8);
    expect(FX.poundStun(0)).toBeCloseTo(0.8);
    expect(FX.poundKnock(0)).toBe(20);
    expect(FX.poundCooldown(0)).toBe(6);
  });

  it('level 0 of owned-only Volt/Brute upgrades is inert', () => {
    expect(FX.chainCount(0)).toBe(0);
    expect(FX.chainFrac(0)).toBe(0);
    expect(FX.fieldRadius(0)).toBe(0);
    expect(FX.fieldDps(0)).toBe(0);
    expect(FX.shieldMax(0)).toBe(0);
    expect(FX.momentum(0)).toBe(0);
    expect(FX.ironHide(0)).toBe(1);
    expect(FX.secondWindCd(0)).toBe(Infinity);
  });

  it('capped curves respect their ceilings at huge levels', () => {
    expect(FX.chainCount(1e4)).toBeLessThanOrEqual(6);
    expect(FX.repairFraction(1e4)).toBeLessThanOrEqual(1);
    expect(FX.killRecharge(1e4)).toBeLessThanOrEqual(1);
    expect(FX.damageTaken(1e4)).toBeGreaterThan(0);
    expect(FX.ironHide(1e4)).toBeGreaterThan(0);
    // Iron Hide tops out around -36% so BRUTUS (x1.35 HP, stacking with Reinforced Frame) can't run away on effective HP.
    expect(FX.ironHide(1e4)).toBeGreaterThanOrEqual(1 - 0.045 * 8 - 1e-9);
    expect(FX.secondWindCd(1e4)).toBeGreaterThanOrEqual(30);
  });
});
