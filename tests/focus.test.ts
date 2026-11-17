import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Progression, computeStatsFor } from '../src/core/Progression';
import { FX, MIN_COOLDOWN, PHASE_MIN_COOLDOWN, UPGRADE_BY_ID, UPGRADES, upgradeCost, type UpgradeId } from '../src/config/upgrades';
import { Combat } from '../src/entities/Combat';
import { DuelWallet } from '../src/duel/DuelWallet';
import { Focus, focusMult } from '../src/entities/combat/shared';
import { ultMeter } from '../src/entities/combat/ultimates';
import type { EnemyHandle, GameContext } from '../src/core/types';
import type { PilotBinding } from '../src/entities/pilot';
import type { PlowKind } from '../src/config/plows';

/* FOCUS: Ability Focus (E / F) vs Weapon Focus (SPACE, passives, ultimate). Mutually exclusive, endless, player-only,
 * respec in the Garage refunds every coin. */

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

const spent = (id: UpgradeId, n: number) => {
  let t = 0;
  for (let l = 0; l < n; l++) t += upgradeCost(UPGRADE_BY_ID[id], l);
  return t;
};

describe('Focus: shop rules', () => {
  it('both focus upgrades are endless, player-only and point at each other', () => {
    const a = UPGRADE_BY_ID.focusAbility;
    const w = UPGRADE_BY_ID.focusWeapon;
    expect(a.maxLevel).toBe(Infinity);
    expect(w.maxLevel).toBe(Infinity);
    expect(a.playerOnly && w.playerOnly).toBe(true);
    expect(a.exclusiveWith).toBe('focusWeapon');
    expect(w.exclusiveWith).toBe('focusAbility');
    expect(a.plowOnly).toBeUndefined();
    // Card text mentions the exclusivity and the respec.
    for (const d of [a, w]) {
      expect(d.details).toMatch(/RESPEC/);
      expect(d.details).toMatch(/locks/);
    }
  });

  it('buying one blocks the other (Progression)', () => {
    const p = new Progression();
    p.data.coins = 1e7;
    expect(p.canBuy('focusAbility')).toBe(true);
    expect(p.canBuy('focusWeapon')).toBe(true);
    expect(p.buy('focusAbility')).toBe(true);
    expect(p.focusLock('focusWeapon')).toBe('focusAbility');
    expect(p.canBuy('focusWeapon')).toBe(false);
    expect(p.buy('focusWeapon')).toBe(false);
    expect(p.level('focusWeapon')).toBe(0);
    // The chosen one keeps levelling.
    expect(p.buy('focusAbility')).toBe(true);
    expect(p.level('focusAbility')).toBe(2);
  });

  it('respec refunds exactly every coin spent and unlocks the other focus', () => {
    const p = new Progression();
    p.data.coins = 1e7;
    for (let i = 0; i < 7; i++) expect(p.buy('focusWeapon')).toBe(true);
    const after = p.coins;
    expect(p.respecRefund('focusWeapon')).toBe(spent('focusWeapon', 7));
    expect(p.respec('focusWeapon')).toBe(true);
    expect(p.coins).toBe(after + spent('focusWeapon', 7));
    expect(p.coins).toBe(1e7);
    expect(p.level('focusWeapon')).toBe(0);
    expect(p.canBuy('focusAbility')).toBe(true);
    // Nothing to respec / not a focus upgrade.
    expect(p.respec('focusWeapon')).toBe(false);
    p.data.upgrades.engine = 3;
    expect(p.respec('engine')).toBe(false);
    expect(p.level('engine')).toBe(3);
  });

  it('old saves without the ids load at level 0 (and a stored save keeps its levels)', () => {
    store.set('snowplow-showdown-save-v2', JSON.stringify({ version: 1, coins: 50, upgrades: { engine: 2 }, unlockedZones: 1, zones: {}, totalKills: 0, totalCoinsEarned: 0, muted: false, brawlMatches: 0, brawlWins: 0, brawlBestStreak: 0, brawlBestKills: 0, plow: 'classic' }));
    const p = new Progression();
    expect(p.level('focusAbility')).toBe(0);
    expect(p.level('focusWeapon')).toBe(0);
    expect(p.computeStats().abilityDmgMult).toBe(1);
    expect(p.importSave(JSON.stringify({ ...p.data, upgrades: { focusAbility: 4 } })).ok).toBe(true);
    expect(p.level('focusAbility')).toBe(4);
  });

  it('the duel garage respects exclusivity on saved + catch-up levels, and AUTO-SPEND never picks a focus', () => {
    const p = new Progression();
    p.data.coins = 0;
    const w = new DuelWallet(p, 1e6);
    // Focus never comes out of the catch-up bonus (a RESPEC would refund it as real coins)...
    expect(w.paysWithBonus('focusWeapon')).toBe(false);
    expect(w.buy('focusWeapon')).toBe(false);
    // ...only out of the pilot's own coins.
    p.data.coins = 1e6;
    expect(w.buy('focusWeapon')).toBe(true);
    expect(w.focusLock('focusAbility')).toBe('focusWeapon');
    expect(w.canBuy('focusAbility')).toBe(false);
    expect(w.buy('focusAbility')).toBe(false);
    const w2 = new DuelWallet(p, 1e6);
    w2.autoSpend({ focusAbility: 5 });
    expect(w2.level('focusAbility')).toBe(0);
    expect(w2.level('focusWeapon')).toBe(1); // the level bought above with own coins (saved)
  });
});

describe('Focus: stats', () => {
  it('level 0 changes nothing', () => {
    for (const kind of ['classic', 'volt', 'brute', 'isotope', 'arsenal', 'revenant'] as PlowKind[]) {
      const s = computeStatsFor({}, kind);
      expect(s.abilityDmgMult).toBe(1);
      expect(s.primaryDmgMult).toBe(1);
      expect(s.ultDmgMult).toBe(1);
      expect(s.abilityCdMult).toBe(1);
      expect(s.ultChargeMult).toBe(1);
    }
  });

  it('Ability Focus at 1 / 5: E/F damage and recharge up, the rest unchanged', () => {
    const base = computeStatsFor({}, 'volt');
    const s1 = computeStatsFor({ focusAbility: 1 }, 'volt');
    const s5 = computeStatsFor({ focusAbility: 5 }, 'volt');
    expect(s1.abilityDmgMult).toBeCloseTo(1.07, 6);
    expect(s5.abilityDmgMult).toBeCloseTo(1.35, 6);
    expect(s1.abilityCdMult).toBeCloseTo(0.96, 6);
    expect(s5.abilityCdMult).toBeCloseTo(0.8, 6);
    for (const s of [s1, s5]) {
      expect(s.primaryDmgMult).toBe(1);
      expect(s.ultDmgMult).toBe(1);
      expect(s.ultChargeMult).toBe(1);
    }
    expect(s5.clapCooldown).toBeCloseTo(base.clapCooldown * 0.8, 6);
    expect(s5.whirlCooldown).toBeCloseTo(base.whirlCooldown * 0.8, 6);
    // Untouched: damageMult (no double dip), the dash and the slam's Overclock.
    expect(s5.damageMult).toBe(base.damageMult);
    expect(s5.dashCooldown).toBe(base.dashCooldown);
    expect(s5.cooldownMult).toBe(base.cooldownMult);
    // Tapers past 5, toward +70% / -40%.
    const s50 = computeStatsFor({ focusAbility: 50 }, 'volt');
    expect(s50.abilityDmgMult).toBeLessThanOrEqual(1.7);
    expect(s50.abilityDmgMult - s5.abilityDmgMult).toBeLessThan(0.35);
    expect(s50.abilityCdMult).toBeGreaterThanOrEqual(0.6);
  });

  it('Weapon Focus at 1 / 5: SPACE, passive and ultimate damage and ultimate charge up; E/F unchanged', () => {
    const base = computeStatsFor({}, 'brute');
    const s1 = computeStatsFor({ focusWeapon: 1 }, 'brute');
    const s5 = computeStatsFor({ focusWeapon: 5 }, 'brute');
    expect(s1.primaryDmgMult).toBeCloseTo(1.07, 6);
    expect(s5.primaryDmgMult).toBeCloseTo(1.35, 6);
    expect(s5.ultDmgMult).toBeCloseTo(1.35, 6);
    expect(s1.ultChargeMult).toBeCloseTo(1.04, 6);
    expect(s5.ultChargeMult).toBeCloseTo(1.2, 6);
    for (const s of [s1, s5]) {
      expect(s.abilityDmgMult).toBe(1);
      expect(s.abilityCdMult).toBe(1);
    }
    expect(s5.poundCooldown).toBeCloseTo(base.poundCooldown, 6);
    // A smaller meter = faster charge.
    const b = (stats: typeof base) => ({ stats, enemies: {} as never });
    expect(ultMeter(b(s5), 1000)).toBeCloseTo(ultMeter(b(base), 1000) / 1.2, 6);
  });

  it('cooldown floors still hold; a garage holding both (tampered) gets neither', () => {
    const s = computeStatsFor({ focusAbility: 99, overclock: 10, whirl: 99, revPhase: 99, nitro: 99 }, 'revenant');
    expect(s.whirlCooldown).toBeGreaterThanOrEqual(MIN_COOLDOWN);
    expect(s.phaseCooldown).toBe(PHASE_MIN_COOLDOWN);
    const both = computeStatsFor({ focusAbility: 5, focusWeapon: 5 }, 'classic');
    expect([both.abilityDmgMult, both.primaryDmgMult, both.abilityCdMult, both.ultChargeMult]).toEqual([1, 1, 1, 1]);
    expect(FX.focusDmg(0)).toBe(1);
  });

  it('focusMult picks the right multiplier per hit kind (neutral hits never change)', () => {
    const s = computeStatsFor({ focusWeapon: 5 }, 'classic');
    expect(focusMult(s, Focus.Primary)).toBeCloseTo(1.35, 6);
    expect(focusMult(s, Focus.Ult)).toBeCloseTo(1.35, 6);
    expect(focusMult(s, Focus.Ability)).toBe(1);
    expect(focusMult(s, Focus.Neutral)).toBe(1);
  });

  it('Brawl rivals never copy Focus (player-only)', () => {
    const shared = UPGRADES.filter((u) => u.maxLevel === Infinity && !u.playerOnly).map((u) => u.id);
    expect(shared).not.toContain('focusAbility');
    expect(shared).not.toContain('focusWeapon');
  });
});

/* ------------------------------------------------------------------ kits: E/F vs SPACE in the right direction */

const noop: unknown = new Proxy(() => noop, { get: () => noop, apply: () => noop });
type Bot = EnemyHandle & { hp: number; dealt: number };
let nextId = 1;
const bot = (x: number, z: number): Bot =>
  ({ id: nextId++, position: new THREE.Vector3(x, 0, z), radius: 1, hp: 1e7, maxHp: 1e7, alive: true, dealt: 0, type: 'grunt', mass: 1, isBoss: false }) as unknown as Bot;

function rig(kind: PlowKind, bots: Bot[], levels: Partial<Record<UpgradeId, number>> = {}) {
  const press = new Set<string>();
  const held = new Set<string>();
  const plow = {
    position: new THREE.Vector3(), heading: 0, hp: 100, maxHp: 100, dead: false, turretAim: 0, turretHeading: 0, whirlCharge: 1, surfaceY: 0, radius: 1.6,
    phased: false,
    get eCharge() {
      return plow.whirlCharge;
    },
    spendE() {
      plow.whirlCharge = 0;
    },
    damage() {},
    feedSawFury() {},
    push() {},
    stealSnow: () => 0,
    hitStop() {},
    mountWorld: (_k: string, _i: number, o: THREE.Vector3) => o.set(0, 1, 0),
    getForward: (o: THREE.Vector3) => o.set(Math.sin(plow.heading), 0, Math.cos(plow.heading)),
  };
  const enemies = {
    bosses: [],
    query: (x: number, z: number, r: number, o: EnemyHandle[] = []) => {
      o.length = 0;
      for (const b of bots) if (b.alive && Math.hypot(b.position.x - x, b.position.z - z) <= r + b.radius) o.push(b);
      return o;
    },
    damage: (e: EnemyHandle, n: number) => {
      const b = e as Bot;
      b.dealt += n;
      b.hp -= n;
      return false;
    },
    pull() {},
    tow() {},
  };
  const binding = {
    stats: computeStatsFor(levels, kind), plow, enemies, snow: noop, events: noop, local: false, authoritative: true, look: null,
    input: { throttle: 0, steer: 0, wasPressed: (k: string) => press.has(k), isDown: (k: string) => held.has(k) },
    audio: noop,
  } as unknown as PilotBinding;
  const ctx = { scene: new THREE.Scene(), time: 0, fx: noop, ui: noop, impact: noop, cameraRig: noop, terrain: undefined } as unknown as GameContext;
  const c = new Combat(ctx, binding);
  c.clear();
  const run = (s: number) => {
    for (let i = 0; i < Math.round(s * 60); i++) {
      (ctx as { time: number }).time += 1 / 60;
      c.update(1 / 60);
      press.clear();
    }
  };
  return { c, press, held, run };
}

/** Damage a lone bot takes from `act` with the given garage. */
function dealt(kind: PlowKind, levels: Partial<Record<UpgradeId, number>>, at: [number, number], act: (r: ReturnType<typeof rig>) => void): number {
  const b = bot(at[0], at[1]);
  const r = rig(kind, [b], levels);
  act(r);
  return b.dealt;
}

const holdSpace = (s: number) => (r: ReturnType<typeof rig>) => {
  r.held.add('Space');
  r.run(s);
};
const tap = (key: string, s: number) => (r: ReturnType<typeof rig>) => {
  r.press.add(key);
  r.run(s);
};

describe('Focus: kits', () => {
  it('PHANTOM: Ability Focus raises MANIFEST (E) and leaves REAP (SPACE) alone; Weapon Focus the other way round', () => {
    const reap = (lv: Partial<Record<UpgradeId, number>>) => dealt('revenant', lv, [0, 4], holdSpace(1));
    const manifest = (lv: Partial<Record<UpgradeId, number>>) => dealt('revenant', lv, [0, 0.5], tap('KeyE', 2));
    const r0 = reap({});
    const m0 = manifest({});
    expect(r0).toBeGreaterThan(0);
    expect(m0).toBeGreaterThan(0);
    expect(reap({ focusAbility: 5 }) / r0).toBeCloseTo(1, 3);
    expect(manifest({ focusAbility: 5 }) / m0).toBeCloseTo(1.35, 3);
    expect(reap({ focusWeapon: 5 }) / r0).toBeCloseTo(1.35, 3);
    expect(manifest({ focusWeapon: 5 }) / m0).toBeCloseTo(1, 3);
  });

  it('VOLT-9: Ability Focus raises STATIC FIELD (E) and leaves the ARC LANCE (SPACE) alone; Weapon Focus the other way round', () => {
    const arc = (lv: Partial<Record<UpgradeId, number>>) => dealt('volt', lv, [0, 5], holdSpace(1));
    const field = (lv: Partial<Record<UpgradeId, number>>) => dealt('volt', lv, [0, 2.5], tap('KeyE', 1.5));
    const a0 = arc({});
    const f0 = field({});
    expect(a0).toBeGreaterThan(0);
    expect(f0).toBeGreaterThan(0);
    expect(arc({ focusAbility: 3 }) / a0).toBeCloseTo(1, 3);
    expect(field({ focusAbility: 3 }) / f0).toBeCloseTo(1.21, 3);
    expect(arc({ focusWeapon: 3 }) / a0).toBeCloseTo(1.21, 3);
    expect(field({ focusWeapon: 3 }) / f0).toBeCloseTo(1, 3);
  });
});
