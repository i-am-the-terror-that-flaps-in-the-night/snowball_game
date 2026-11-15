import type { Progression } from '../core/Progression';
import {
  COSMETICS, COSMETIC_BY_ID, COSMETIC_SLOTS, DEFAULT_COSMETICS,
  type BladeDef, type CosmeticDef, type CosmeticSlot, type DecalDef, type HornDef, type KillDef, type PaintDef, type TrailDef,
} from '../config/cosmetics';
import { achievementCount, totalStars } from './progress';

/* Paint Shop rules: ownership, unlock gates, buying and equipping. Pure logic over the save
 * (p.data.cosmetics); the Paint Shop overlay (ui/StyleShop.ts) and the plow (entities/Plow.ts) read it. */

export interface CosmeticsState {
  /** Bought item ids (known catalog ids only; free defaults are implied, not stored). */
  owned: string[];
  equipped: Record<CosmeticSlot, string>;
}

/** Clean up a stored cosmetics blob: unknown / garbage ids are dropped, each slot falls back to its free default,
 *  and an equipped item must be owned (and belong to that slot). Never throws. */
export function sanitizeCosmetics(raw: unknown): CosmeticsState {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const owned = Array.isArray(obj.owned)
    ? [...new Set(obj.owned.filter((id): id is string => typeof id === 'string' && COSMETIC_BY_ID.has(id) && COSMETIC_BY_ID.get(id)!.price > 0))]
    : [];
  const eq = obj.equipped && typeof obj.equipped === 'object' ? (obj.equipped as Record<string, unknown>) : {};
  const equipped = { ...DEFAULT_COSMETICS };
  for (const slot of COSMETIC_SLOTS) {
    const id = eq[slot];
    const def = typeof id === 'string' ? COSMETIC_BY_ID.get(id) : undefined;
    if (def && def.slot === slot && (def.price <= 0 || owned.includes(def.id))) equipped[slot] = def.id;
  }
  return { owned, equipped };
}

/** The save's cosmetics, sanitized (read-only view; use the mutators below to change it). */
export function cosmeticsState(p: Progression): CosmeticsState {
  return sanitizeCosmetics(p.data.cosmetics);
}

export function isOwned(p: Progression, id: string): boolean {
  const def = COSMETIC_BY_ID.get(id);
  if (!def) return false;
  return def.price <= 0 || cosmeticsState(p).owned.includes(id);
}

export function isEquipped(p: Progression, id: string): boolean {
  const def = COSMETIC_BY_ID.get(id);
  return !!def && cosmeticsState(p).equipped[def.slot] === id;
}

export type ReqKind = 'stars' | 'achievements' | 'protocol';

/** PROTOCOL C cleared at least once (save.protocol.cleared; read directly so this module stays free of meta/protocol). */
export function protocolClearedSave(p: Progression): boolean {
  const pr = p.data.protocol as { cleared?: unknown } | undefined;
  return !!pr && typeof pr === 'object' && pr.cleared === true;
}

/** The PROTOCOL C exclusives (req.protocol), in catalog order. */
export const PROTOCOL_COSMETICS: readonly CosmeticDef[] = COSMETICS.filter((c) => c.req?.protocol);

/** Unmet unlock gates (stars / achievements / a PROTOCOL C clear), with progress. Empty when the item is unlocked. */
export function unmetReqs(p: Progression, def: CosmeticDef): { kind: ReqKind; need: number; have: number }[] {
  const out: { kind: ReqKind; need: number; have: number }[] = [];
  const r = def.req;
  if (r?.stars) {
    const have = totalStars(p);
    if (have < r.stars) out.push({ kind: 'stars', need: r.stars, have });
  }
  if (r?.achievements) {
    const have = achievementCount(p);
    if (have < r.achievements) out.push({ kind: 'achievements', need: r.achievements, have });
  }
  if (r?.protocol && !protocolClearedSave(p)) out.push({ kind: 'protocol', need: 1, have: 0 });
  return out;
}

/** Short lock label for a shop card, e.g. "★ 2/6 stars" / "Beat PROTOCOL C", or null when unlocked. */
export function lockLabel(p: Progression, def: CosmeticDef): string | null {
  const miss = unmetReqs(p, def);
  if (!miss.length) return null;
  return miss.map((m) => (m.kind === 'stars' ? `★ ${m.have}/${m.need} stars` : m.kind === 'protocol' ? 'Beat PROTOCOL C' : `🏆 ${m.have}/${m.need} achievements`)).join(' · ');
}

/** Full sentence for the "why can't I buy this" message. */
export function lockHint(def: CosmeticDef): string {
  if (def.req?.protocol) return `${def.name} is a PROTOCOL C exclusive: beat PROTOCOL C to unlock it. It is not for sale.`;
  const parts: string[] = [];
  if (def.req?.stars) parts.push(`${def.req.stars} campaign stars`);
  if (def.req?.achievements) parts.push(`${def.req.achievements} achievements`);
  return parts.length ? `Unlock ${def.name} with ${parts.join(' and ')}.` : '';
}

/** A PROTOCOL C exclusive is never paid for: once unlocked it is claimed free (normally granted outright on the clear). */
export function cosmeticCost(def: CosmeticDef): number {
  return def.req?.protocol ? 0 : def.price;
}

export type BuyCheck = 'ok' | 'unknown' | 'owned' | 'locked' | 'poor';

export function buyCheck(p: Progression, id: string): BuyCheck {
  const def = COSMETIC_BY_ID.get(id);
  if (!def) return 'unknown';
  if (isOwned(p, id)) return 'owned';
  if (unmetReqs(p, def).length) return 'locked';
  if (p.coins < cosmeticCost(def)) return 'poor';
  return 'ok';
}

/** Write a state back to the save and notify listeners (plow repaint, menus). */
function store(p: Progression, s: CosmeticsState): void {
  p.data.cosmetics = { owned: [...s.owned], equipped: { ...s.equipped } };
  p.commit();
}

/** Buy an item: deducts coins, adds it to the collection and equips it. False if unknown / owned / locked / poor. */
export function buyCosmetic(p: Progression, id: string): boolean {
  if (buyCheck(p, id) !== 'ok') return false;
  const def = COSMETIC_BY_ID.get(id)!;
  const s = cosmeticsState(p);
  p.data.coins -= cosmeticCost(def);
  s.owned.push(id);
  s.equipped[def.slot] = id;
  store(p, s);
  return true;
}

/** Grant every PROTOCOL C exclusive the save does not own yet, once PROTOCOL C has been cleared (nothing before that).
 *  Idempotent; saves when it grants anything. Returns the newly granted items (the first clear's reward list). */
export function grantProtocolCosmetics(p: Progression): CosmeticDef[] {
  if (!protocolClearedSave(p)) return [];
  const s = cosmeticsState(p);
  const got = PROTOCOL_COSMETICS.filter((d) => !s.owned.includes(d.id));
  if (!got.length) return got;
  for (const d of got) s.owned.push(d.id);
  store(p, s);
  return got;
}

/** Equip an owned item into its slot. False if unknown or not owned. */
export function equipCosmetic(p: Progression, id: string): boolean {
  const def = COSMETIC_BY_ID.get(id);
  if (!def || !isOwned(p, id)) return false;
  const s = cosmeticsState(p);
  if (s.equipped[def.slot] === id) return true;
  s.equipped[def.slot] = id;
  store(p, s);
  return true;
}

/** The equipped look, resolved to catalog entries. */
export interface EquippedLook {
  paint: PaintDef;
  decal: DecalDef;
  trail: TrailDef;
  blade: BladeDef;
  horn: HornDef;
  kill: KillDef;
}

/** Missing slots (older saves / partial previews) resolve to their free defaults. */
export function resolveLook(equipped: Partial<Record<CosmeticSlot, string>>): EquippedLook {
  const get = <T extends CosmeticDef>(slot: CosmeticSlot) => {
    const id = equipped[slot];
    const def = id ? COSMETIC_BY_ID.get(id) : undefined;
    return (def && def.slot === slot ? def : COSMETIC_BY_ID.get(DEFAULT_COSMETICS[slot])!) as T;
  };
  return {
    paint: get<PaintDef>('paint'), decal: get<DecalDef>('decal'), trail: get<TrailDef>('trail'),
    blade: get<BladeDef>('blade'), horn: get<HornDef>('horn'), kill: get<KillDef>('kill'),
  };
}

export function equippedLook(p: Progression): EquippedLook {
  return resolveLook(cosmeticsState(p).equipped);
}
