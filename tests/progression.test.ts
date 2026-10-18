import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Progression } from '../src/core/Progression';
import { FX, MIN_COOLDOWN, UPGRADES, type UpgradeId } from '../src/config/upgrades';
import { PLOWS, type PlowKind } from '../src/config/plows';
import { ZONES } from '../src/config/zones';

const SAVE_KEY = 'snowplow-showdown-save-v2';
let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});
afterEach(() => vi.unstubAllGlobals());

function progWith(upgrades: Partial<Record<UpgradeId, number>>, plow: PlowKind): Progression {
  const p = new Progression();
  p.data.upgrades = { ...upgrades };
  p.data.plow = plow;
  return p;
}

const allAt = (lv: number) => Object.fromEntries(UPGRADES.map((u) => [u.id, Math.min(lv, u.maxLevel)])) as Partial<Record<UpgradeId, number>>;

describe('computeStats', () => {
  it('base stats for each plow apply the plow multipliers', () => {
    for (const kind of Object.keys(PLOWS) as PlowKind[]) {
      const def = PLOWS[kind];
      const s = progWith({}, kind).computeStats();
      expect(s.plowKind).toBe(kind);
      expect(s.maxHp).toBeCloseTo(FX.maxHp(0) * def.hpMult);
      expect(s.maxSpeed).toBeCloseTo(FX.maxSpeed(0) * def.speedMult);
      expect(s.accel).toBeCloseTo(FX.accel(0) * def.accelMult);
      expect(s.dashPower).toBeCloseTo(FX.dashPower(0) * def.dashPowerMult);
      expect(s.damageMult).toBeCloseTo(FX.damageMult(0) * def.slamMult);
      expect(s.cooldownMult).toBe(1);
      for (const v of Object.values(s)) if (typeof v === 'number') expect(Number.isNaN(v)).toBe(false);
    }
  });

  it('each plow only gets its own free F ability', () => {
    const c = progWith({}, 'classic').computeStats();
    const v = progWith({}, 'volt').computeStats();
    const b = progWith({}, 'brute').computeStats();
    expect(c.flameDps).toBeGreaterThan(0);
    expect(c.clapDamage).toBe(0);
    expect(c.poundDamage).toBe(0);
    expect(v.flameDps).toBe(0);
    expect(v.clapDamage).toBe(FX.clapDamage(0));
    expect(v.poundDamage).toBe(0);
    expect(b.flameDps).toBe(0);
    expect(b.clapDamage).toBe(0);
    expect(b.poundDamage).toBe(FX.poundDamage(0));
  });

  it('plowOnly upgrades only count while driving their plow', () => {
    const ups = allAt(5);
    const c = progWith(ups, 'classic').computeStats();
    const v = progWith(ups, 'volt').computeStats();
    const b = progWith(ups, 'brute').computeStats();

    // Classic: Inferno counts, Volt/Brute lines are inert.
    expect(c.flameDps).toBe(FX.flameDps(5));
    expect(c.chainCount).toBe(0);
    expect(c.fieldDps).toBe(0);
    expect(c.shieldMax).toBe(0);
    expect(c.momentum).toBe(0);
    expect(c.damageTaken).toBeCloseTo(FX.damageTaken(5));

    // VOLT-9: Volt line counts, Inferno/Brute don't.
    expect(v.chainCount).toBe(FX.chainCount(5));
    expect(v.fieldDps).toBe(FX.fieldDps(5));
    expect(v.shieldMax).toBe(FX.shieldMax(5));
    expect(v.clapDamage).toBe(FX.clapDamage(5));
    expect(v.flameRange).toBe(FX.flameRange(0));
    expect(v.momentum).toBe(0);
    expect(v.damageTaken).toBeCloseTo(FX.damageTaken(5));

    // BRUTUS: Brute line counts, Volt doesn't.
    expect(b.poundDamage).toBe(FX.poundDamage(5));
    expect(b.poundRadius).toBe(FX.poundRadius(5));
    expect(b.momentum).toBe(FX.momentum(5));
    expect(b.damageTaken).toBeCloseTo(FX.damageTaken(5) * FX.ironHide(5));
    expect(b.chainCount).toBe(0);
    expect(b.shieldMax).toBe(0);
    expect(b.clapRadius).toBe(FX.clapRadius(0));
  });

  it('shared and pilot upgrades apply on every plow', () => {
    for (const kind of Object.keys(PLOWS) as PlowKind[]) {
      const s = progWith({ armor: 3, vitality: 2, salvage: 4, wreckingBall: 2, secondWind: 1, overclock: 5 }, kind).computeStats();
      expect(s.maxHp).toBeCloseTo((FX.maxHp(3) + FX.bonusHp(2)) * PLOWS[kind].hpMult);
      expect(s.lifesteal).toBe(FX.lifesteal(4));
      expect(s.hitCapBonus).toBe(FX.hitCapBonus(2));
      expect(s.secondWindCd).toBe(FX.secondWindCd(1));
      expect(s.cooldownMult).toBeCloseTo(0.7);
    }
  });

  it('cooldowns never drop below MIN_COOLDOWN even at absurd levels', () => {
    for (const kind of Object.keys(PLOWS) as PlowKind[]) {
      const s = progWith({ ...allAt(500), overclock: 10 }, kind).computeStats();
      for (const cd of [s.dashCooldown, s.whirlCooldown, s.flameCooldown, s.clapCooldown, s.poundCooldown]) expect(cd).toBeGreaterThanOrEqual(MIN_COOLDOWN);
      expect(s.cooldownMult).toBeCloseTo(0.4);
    }
  });

  it('specials toggle their flags', () => {
    const off = progWith({}, 'classic').computeStats();
    const on = progWith({ iceShield: 1, frostCore: 1, avalancheCore: 1 }, 'classic').computeStats();
    expect(off.shieldBlock).toBe(0.4);
    expect(on.shieldBlock).toBe(0.75);
    expect(off.frostCore || off.avalancheCore).toBe(false);
    expect(on.frostCore && on.avalancheCore).toBe(true);
  });
});

describe('shop', () => {
  it('buy spends coins, levels up, and persists', () => {
    const p = new Progression();
    p.data.coins = 1000;
    const cost = p.cost('engine');
    expect(p.buy('engine')).toBe(true);
    expect(p.level('engine')).toBe(1);
    expect(p.coins).toBe(1000 - cost);
    expect(JSON.parse(store.get(SAVE_KEY)!).upgrades.engine).toBe(1);
  });

  it('cannot buy past maxLevel or without coins', () => {
    const p = new Progression();
    p.data.coins = 1e9;
    p.data.upgrades.overclock = 10;
    expect(p.isMaxed('overclock')).toBe(true);
    expect(p.cost('overclock')).toBe(Infinity);
    expect(p.buy('overclock')).toBe(false);
    p.data.coins = 0;
    expect(p.buy('engine')).toBe(false);
  });
});

describe('save export / import', () => {
  function sample(): Progression {
    const p = new Progression();
    p.data.coins = 1234;
    p.data.upgrades = { engine: 7, overclock: 4, voltChain: 2, brutePound: 3 };
    p.data.unlockedZones = 3;
    p.data.zones = { [ZONES[0].id]: { cleared: true, bestRound: 4 } };
    p.data.totalKills = 99;
    p.data.totalCoinsEarned = 5000;
    p.data.brawlMatches = 6;
    p.data.brawlWins = 2;
    p.data.brawlBestStreak = 9;
    p.data.brawlBestKills = 14;
    p.data.plow = 'volt';
    p.data.survivalBestWave = 12;
    return p;
  }

  it('round-trips through the SPS1 code', () => {
    const a = sample();
    const code = a.exportSave();
    expect(code.startsWith('SPS1:')).toBe(true);
    const b = new Progression();
    expect(b.importSave(code)).toEqual({ ok: true });
    expect(b.data).toEqual(a.data);
  });

  it('accepts raw JSON and codes with whitespace', () => {
    const a = sample();
    const b = new Progression();
    expect(b.importSave(JSON.stringify(a.data)).ok).toBe(true);
    expect(b.data).toEqual(a.data);
    const code = a.exportSave();
    const spaced = 'SPS1:' + code.slice(5).replace(/(.{20})/g, '$1\n');
    const c = new Progression();
    expect(c.importSave('  ' + spaced + '  ').ok).toBe(true);
    expect(c.data).toEqual(a.data);
  });

  it('rejects garbage and leaves the current save untouched', () => {
    const p = sample();
    const before = structuredClone(p.data);
    for (const bad of ['', 'hello world', 'SPS1:!!!!', '{"version":2,"coins":5}', '{"version":1,"coins":-5}', '[]']) {
      expect(p.importSave(bad).ok).toBe(false);
    }
    expect(p.data).toEqual(before);
  });

  it('sanitizes imported values', () => {
    const p = new Progression();
    const raw = {
      version: 1,
      coins: 50.7,
      upgrades: { engine: 3.9, overclock: 99, bogus: 4, blade: 'x' },
      unlockedZones: 999,
      zones: { nope: { cleared: true, bestRound: 3 } },
      brawlMatches: 2,
      brawlWins: 10,
      plow: 'tank',
      muted: 'yes',
      survivalBestWave: -4,
      hacked: true,
    };
    expect(p.importSave(JSON.stringify(raw)).ok).toBe(true);
    expect(p.data.coins).toBe(50);
    expect(p.data.upgrades).toEqual({ engine: 3, overclock: 10 });
    expect(p.data.unlockedZones).toBe(ZONES.length);
    expect(p.data.zones).toEqual({});
    expect(p.data.brawlWins).toBe(2);
    expect(p.data.plow).toBe('classic');
    expect(p.data.muted).toBe(false);
    expect(p.data.survivalBestWave ?? 0).toBe(0);
    expect('hacked' in p.data).toBe(false);
  });

  it('imports an older save that predates plows, brawl and survival', () => {
    const old = { version: 1, coins: 300, upgrades: { engine: 2 }, unlockedZones: 2, zones: {}, totalKills: 10, totalCoinsEarned: 400, muted: true };
    const p = new Progression();
    expect(p.importSave(JSON.stringify(old)).ok).toBe(true);
    expect(p.plow).toBe('classic');
    expect(p.data.brawlMatches).toBe(0);
    expect(p.data.muted).toBe(true);
    expect(() => p.computeStats()).not.toThrow();
  });

  it('loads an older localStorage save with missing fields filled from defaults', () => {
    store.set(SAVE_KEY, JSON.stringify({ version: 1, coins: 77, upgrades: { armor: 1 }, unlockedZones: 1, zones: {}, totalKills: 0, totalCoinsEarned: 77, muted: false }));
    const p = new Progression();
    expect(p.coins).toBe(77);
    expect(p.level('armor')).toBe(1);
    expect(p.plow).toBe('classic');
    expect(p.data.brawlBestKills).toBe(0);
    expect(p.computeStats().maxHp).toBeCloseTo(FX.maxHp(1) * PLOWS.classic.hpMult);
  });

  it('falls back to a fresh save on corrupted storage', () => {
    store.set(SAVE_KEY, '{not json');
    const p = new Progression();
    expect(p.coins).toBe(0);
    expect(p.data.unlockedZones).toBe(1);
  });
});
