import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GEAR, GEAR_SLOTS, REMOVED_GEAR, gearSpent, type GearDef } from '../src/config/gear';
import { ITEM_STATS, UPGRADE_BY_ID } from '../src/config/upgrades';
import { Progression } from '../src/core/Progression';

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

/** An item's headline stat: its first grant. */
const headline = (d: GearDef) => d.grants[0].stat;

describe('gear identities', () => {
  it('every gear stat is some item\'s headline, and no two items share a headline', () => {
    // Headline = the first grant, plus any extra pilot passive (Phoenix Plating's Last Stand).
    const heads = GEAR.flatMap((d) => [headline(d), ...d.grants.slice(1).filter((g) => UPGRADE_BY_ID[g.stat].playerOnly).map((g) => g.stat)]);
    for (const id of ITEM_STATS) expect(GEAR.some((d) => d.grants.some((g) => g.stat === id)), id).toBe(true);
    expect(new Set(heads).size).toBe(heads.length);
    for (const id of ITEM_STATS) expect(heads.includes(id), `${id} is nobody's headline`).toBe(true);
  });

  it('one-time and pilot passives come from exactly one item', () => {
    const passives = ITEM_STATS.filter((id) => UPGRADE_BY_ID[id].maxLevel === 1 || UPGRADE_BY_ID[id].playerOnly);
    for (const id of passives) expect(GEAR.filter((d) => d.grants.some((g) => g.stat === id)).length, id).toBe(1);
  });

  it('within a slot no two items grant the same stat', () => {
    for (const slot of GEAR_SLOTS) {
      const stats = GEAR.filter((d) => d.slot === slot.id).flatMap((d) => d.grants.map((g) => g.stat));
      expect(new Set(stats).size, slot.id).toBe(stats.length);
    }
  });

  it('every slot has at least 2 items including a cheap common one, and leveling always adds something', () => {
    for (const slot of GEAR_SLOTS) {
      const items = GEAR.filter((d) => d.slot === slot.id);
      expect(items.length, slot.id).toBeGreaterThanOrEqual(2);
      expect(items.some((d) => d.rarity === 'common'), slot.id).toBe(true);
    }
    for (const d of GEAR) expect(d.grants.some((g) => g.per > 0), `${d.id} has nothing to level`).toBe(true);
    expect(GEAR.length).toBeLessThanOrEqual(16);
  });

  it('refunds a removed item from an old save and keeps the items that stayed', () => {
    store.set(SAVE_KEY, JSON.stringify({
      version: 1, coins: 0, upgrades: {}, unlockedZones: 1, zones: {}, totalKills: 0, totalCoinsEarned: 0, muted: false,
      gear: { owned: { adrenalineShot: 4, jetTurbine: 2 }, equipped: { charm: 'adrenalineShot', booster: 'jetTurbine' } },
    }));
    const p = new Progression();
    expect(p.coins).toBe(gearSpent(REMOVED_GEAR.adrenalineShot as GearDef, 4));
    expect(p.gear.owned).toEqual({ jetTurbine: 2 });
    expect(p.gear.equipped).toEqual({ booster: 'jetTurbine' });
  });
});
