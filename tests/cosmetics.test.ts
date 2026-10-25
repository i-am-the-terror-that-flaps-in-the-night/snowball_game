import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Progression } from '../src/core/Progression';
import { COSMETICS, COSMETIC_BY_ID, COSMETIC_SLOTS, DEFAULT_COSMETICS, cosmeticsInSlot } from '../src/config/cosmetics';
import {
  buyCheck, buyCosmetic, cosmeticsState, equipCosmetic, equippedLook, isOwned, lockLabel, sanitizeCosmetics, unmetReqs,
} from '../src/meta/cosmetics';

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

function prog(coins: number): Progression {
  const p = new Progression();
  p.data.coins = coins;
  return p;
}

/** Grant `stars` campaign challenge stars and `ach` achievements. */
function grant(p: Progression, stars: number, ach: number): void {
  p.data.challenges = { z: Array.from({ length: stars }, (_, i) => `c${i}`) };
  p.data.achievements = Object.fromEntries(Array.from({ length: ach }, (_, i) => [`a${i}`, 1]));
}

const firstPaid = (slot: 'paint' | 'decal' | 'trail', gated = false) =>
  cosmeticsInSlot(slot).find((c) => c.price > 0 && !!c.req === gated)!;

describe('cosmetics catalog', () => {
  it('ids are unique', () => {
    expect(new Set(COSMETICS.map((c) => c.id)).size).toBe(COSMETICS.length);
    expect(COSMETIC_BY_ID.size).toBe(COSMETICS.length);
  });

  it('every slot has a free default plus paid items in the 250..6000 range', () => {
    for (const slot of COSMETIC_SLOTS) {
      const def = COSMETIC_BY_ID.get(DEFAULT_COSMETICS[slot])!;
      expect(def.slot).toBe(slot);
      expect(def.price).toBe(0);
      const paid = cosmeticsInSlot(slot).filter((c) => c.price > 0);
      expect(paid.length).toBeGreaterThanOrEqual(5);
      for (const c of paid) {
        expect(c.price).toBeGreaterThanOrEqual(250);
        expect(c.price).toBeLessThanOrEqual(6000);
      }
    }
  });

  it('gates stay reachable (15 stars exist, ~30 achievements)', () => {
    for (const c of COSMETICS) {
      expect(c.req?.stars ?? 0).toBeLessThanOrEqual(15);
      expect(c.req?.achievements ?? 0).toBeLessThanOrEqual(30);
    }
    expect(COSMETICS.some((c) => c.req?.stars)).toBe(true);
    expect(COSMETICS.some((c) => c.req?.achievements)).toBe(true);
  });
});

describe('buying and equipping', () => {
  it('a fresh save owns and wears only the free defaults', () => {
    const p = prog(0);
    expect(cosmeticsState(p).equipped).toEqual(DEFAULT_COSMETICS);
    for (const c of COSMETICS) expect(isOwned(p, c.id)).toBe(c.price === 0);
    const look = equippedLook(p);
    expect(look.paint.body).toBeNull();
    expect(look.decal.style).toBeNull();
    expect(look.trail.style).toBeNull();
  });

  it('buy deducts the price, adds the item, equips it and saves', () => {
    const item = firstPaid('paint');
    const p = prog(item.price + 10);
    const seen = vi.fn();
    p.onChange(seen);
    expect(buyCosmetic(p, item.id)).toBe(true);
    expect(p.coins).toBe(10);
    expect(isOwned(p, item.id)).toBe(true);
    expect(cosmeticsState(p).equipped.paint).toBe(item.id);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(new Progression().data.cosmetics?.owned).toContain(item.id); // persisted
    // Owned items can't be bought twice.
    expect(buyCheck(p, item.id)).toBe('owned');
    expect(buyCosmetic(p, item.id)).toBe(false);
    expect(p.coins).toBe(10);
  });

  it('buy fails when poor', () => {
    const item = firstPaid('trail');
    const p = prog(item.price - 1);
    expect(buyCheck(p, item.id)).toBe('poor');
    expect(buyCosmetic(p, item.id)).toBe(false);
    expect(p.coins).toBe(item.price - 1);
    expect(isOwned(p, item.id)).toBe(false);
  });

  it('buy fails while locked, even with coins, and works once the gate is met', () => {
    const item = firstPaid('paint', true);
    const p = prog(100000);
    expect(unmetReqs(p, item).length).toBeGreaterThan(0);
    expect(lockLabel(p, item)).toMatch(/0\//);
    expect(buyCheck(p, item.id)).toBe('locked');
    expect(buyCosmetic(p, item.id)).toBe(false);
    expect(p.coins).toBe(100000);
    grant(p, 15, 30);
    expect(lockLabel(p, item)).toBeNull();
    expect(buyCosmetic(p, item.id)).toBe(true);
    expect(p.coins).toBe(100000 - item.price);
  });

  it('every gated item is locked until its own requirement', () => {
    for (const c of COSMETICS.filter((x) => x.req)) {
      const p = prog(100000);
      grant(p, (c.req!.stars ?? 0) - (c.req!.stars ? 1 : 0), (c.req!.achievements ?? 0) - (c.req!.achievements ? 1 : 0));
      expect(buyCheck(p, c.id)).toBe('locked');
      grant(p, c.req!.stars ?? 0, c.req!.achievements ?? 0);
      expect(buyCheck(p, c.id)).toBe('ok');
    }
  });

  it('equip requires ownership; defaults are always equippable', () => {
    const item = firstPaid('decal');
    const p = prog(100000);
    expect(equipCosmetic(p, item.id)).toBe(false);
    expect(cosmeticsState(p).equipped.decal).toBe(DEFAULT_COSMETICS.decal);
    expect(buyCosmetic(p, item.id)).toBe(true);
    expect(equipCosmetic(p, DEFAULT_COSMETICS.decal)).toBe(true);
    expect(cosmeticsState(p).equipped.decal).toBe(DEFAULT_COSMETICS.decal);
    expect(equipCosmetic(p, item.id)).toBe(true);
    expect(cosmeticsState(p).equipped.decal).toBe(item.id);
    expect(equipCosmetic(p, 'nope')).toBe(false);
  });

  it('slots are independent', () => {
    const p = prog(100000);
    const paint = firstPaid('paint');
    const trail = firstPaid('trail');
    buyCosmetic(p, paint.id);
    buyCosmetic(p, trail.id);
    expect(cosmeticsState(p).equipped).toEqual({ paint: paint.id, decal: DEFAULT_COSMETICS.decal, trail: trail.id });
  });
});

describe('sanitizing saves', () => {
  it('garbage falls back to defaults', () => {
    for (const raw of [undefined, null, 42, 'x', [], { owned: 'x', equipped: 7 }, { owned: [1, null, {}], equipped: [] }]) {
      expect(sanitizeCosmetics(raw)).toEqual({ owned: [], equipped: { ...DEFAULT_COSMETICS } });
    }
  });

  it('drops unknown ids, duplicates, free defaults and unowned / wrong-slot equips', () => {
    const paint = firstPaid('paint');
    const decal = firstPaid('decal');
    const trail = firstPaid('trail');
    const s = sanitizeCosmetics({
      owned: [paint.id, paint.id, 'ghost_item', DEFAULT_COSMETICS.paint, decal.id],
      equipped: { paint: paint.id, decal: trail.id, trail: trail.id, extra: paint.id },
    });
    expect(s.owned).toEqual([paint.id, decal.id]);
    // decal slot held a trail id; trail isn't owned -> both fall back.
    expect(s.equipped).toEqual({ paint: paint.id, decal: DEFAULT_COSMETICS.decal, trail: DEFAULT_COSMETICS.trail });
  });

  it('a tampered import never equips unowned items or breaks the save', () => {
    const p = prog(0);
    const gold = COSMETICS.find((c) => c.slot === 'paint' && c.req)!;
    const res = p.importSave(JSON.stringify({ ...p.data, cosmetics: { owned: ['x'.repeat(100), 'zzz'], equipped: { paint: gold.id, decal: 5 } } }));
    expect(res.ok).toBe(true);
    expect(cosmeticsState(p).equipped).toEqual(DEFAULT_COSMETICS);
    expect(equippedLook(p).paint.id).toBe(DEFAULT_COSMETICS.paint);
  });

  it('a clean import round-trips the collection', () => {
    const p = prog(100000);
    const decal = firstPaid('decal');
    buyCosmetic(p, decal.id);
    const code = p.exportSave();
    const q = prog(0);
    expect(q.importSave(code).ok).toBe(true);
    expect(isOwned(q, decal.id)).toBe(true);
    expect(cosmeticsState(q).equipped.decal).toBe(decal.id);
  });
});
