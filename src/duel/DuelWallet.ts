import { SHOP_UPGRADES, UPGRADES, UPGRADE_BY_ID, upgradeCost, type UpgradeId } from '../config/upgrades';
import type { PlowKind } from '../config/plows';
import { GEAR, GEAR_BY_ID, GEAR_MAX_LEVEL, gearCost, gearLevels, type GearState } from '../config/gear';
import type { Progression } from '../core/Progression';

/** What the Garage UI buys through: the save (Progression) or the pre-duel DuelWallet. */
export interface ShopWallet {
  readonly coins: number;
  readonly plow: PlowKind;
  level(id: UpgradeId): number;
  isMaxed(id: UpgradeId): boolean;
  cost(id: UpgradeId): number;
  canBuy(id: UpgradeId): boolean;
  buy(id: UpgradeId): boolean;
  /** Gear (items): owned levels + what's equipped, as this wallet sees it. */
  readonly gear: GearState;
  itemLevel(id: string): number;
  itemCost(id: string): number;
  canBuyItem(id: string): boolean;
  buyItem(id: string): boolean;
  isEquipped(id: string): boolean;
  toggleEquip(id: string): boolean;
}

/**
 * DUEL GARAGE wallet. Spends the catch-up `bonus` first, on TEMPORARY levels that exist only inside this object
 * (they never touch the save and vanish with it after the match), then the player's real coins through the
 * Progression as normal, permanent, saved purchases.
 *
 * Effective level = saved level + temporary levels. A bonus purchase costs the price of the next EFFECTIVE level;
 * once the bonus can't cover that, the card falls back to a normal purchase at the saved level's price.
 *
 * Gear works the same way: the bonus buys temporary item levels (a new item or +1 level), and equipping in the duel
 * garage edits a working copy of the loadout. Both are folded into the save by commitTemp() when the match starts.
 */
export class DuelWallet implements ShopWallet {
  private temp: Partial<Record<UpgradeId, number>> = {};
  /** Temporary item levels bought with the bonus. */
  private tempGear: Record<string, number> = {};
  /** Working copy of the equipped loadout (committed with the temp levels). */
  private equipped: string[];
  private listeners = new Set<() => void>();
  /** Bonus coins handed out this garage phase / left to spend. */
  readonly bonusTotal: number;
  bonus: number;

  constructor(
    private p: Progression,
    bonus: number,
  ) {
    this.bonusTotal = this.bonus = Math.max(0, Math.floor(bonus));
    this.equipped = [...p.gear.equipped];
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  /** Real coins on hand (the bonus is separate: see `bonus`). */
  get coins(): number {
    return this.p.coins;
  }

  get plow(): PlowKind {
    return this.p.plow;
  }

  tempLevel(id: UpgradeId): number {
    return this.temp[id] ?? 0;
  }

  level(id: UpgradeId): number {
    return Math.min(UPGRADE_BY_ID[id].maxLevel, this.p.level(id) + this.tempLevel(id));
  }

  isMaxed(id: UpgradeId): boolean {
    return this.level(id) >= UPGRADE_BY_ID[id].maxLevel;
  }

  /** Price of the next effective level (what the bonus pays). */
  bonusCost(id: UpgradeId): number {
    return this.isMaxed(id) ? Infinity : upgradeCost(UPGRADE_BY_ID[id], this.level(id));
  }

  /** True if the next purchase of `id` would come out of the bonus. */
  paysWithBonus(id: UpgradeId): boolean {
    return !this.isMaxed(id) && this.bonus >= this.bonusCost(id);
  }

  /** Price shown on the card: the bonus price while the bonus covers it, else the normal (saved-level) price. */
  cost(id: UpgradeId): number {
    if (this.isMaxed(id)) return Infinity;
    return this.paysWithBonus(id) ? this.bonusCost(id) : this.p.cost(id);
  }

  canBuy(id: UpgradeId): boolean {
    if (this.isMaxed(id)) return false;
    return this.paysWithBonus(id) || this.p.canBuy(id);
  }

  buy(id: UpgradeId): boolean {
    if (this.isMaxed(id)) return false;
    if (this.paysWithBonus(id)) {
      this.bonus -= this.bonusCost(id);
      this.temp[id] = this.tempLevel(id) + 1;
      this.changed();
      return true;
    }
    if (!this.p.buy(id)) return false;
    this.changed();
    return true;
  }

  /** Saved + temporary levels + the working gear loadout: what this player fights with. */
  effectiveLevels(): Partial<Record<UpgradeId, number>> {
    const out: Partial<Record<UpgradeId, number>> = {};
    const fromGear = gearLevels(this.gear);
    for (const def of UPGRADES) {
      const l = Math.min(def.maxLevel, this.p.level(def.id) + (fromGear[def.id] ?? 0) + this.tempLevel(def.id));
      if (l > 0) out[def.id] = l;
    }
    return out;
  }

  /* ---------------------------------------------------------------- gear */

  get gear(): GearState {
    const owned: Record<string, number> = { ...this.p.gear.owned };
    for (const id of Object.keys(this.tempGear)) owned[id] = this.itemLevel(id);
    return { owned, equipped: [...this.equipped] };
  }

  tempItemLevel(id: string): number {
    return this.tempGear[id] ?? 0;
  }

  itemLevel(id: string): number {
    return Math.min(GEAR_MAX_LEVEL, this.p.itemLevel(id) + this.tempItemLevel(id));
  }

  /** Price of the next effective item level (what the bonus pays); Infinity at max / unknown id. */
  bonusItemCost(id: string): number {
    const def = GEAR_BY_ID[id];
    return def ? gearCost(def, this.itemLevel(id)) : Infinity;
  }

  /** True if the next purchase of item `id` would come out of the bonus. */
  paysItemWithBonus(id: string): boolean {
    const c = this.bonusItemCost(id);
    return c < Infinity && this.bonus >= c;
  }

  itemCost(id: string): number {
    if (this.itemLevel(id) >= GEAR_MAX_LEVEL || !GEAR_BY_ID[id]) return Infinity;
    return this.paysItemWithBonus(id) ? this.bonusItemCost(id) : this.p.itemCost(id);
  }

  canBuyItem(id: string): boolean {
    if (this.itemCost(id) === Infinity) return false;
    return this.paysItemWithBonus(id) || this.p.canBuyItem(id);
  }

  /** Buy (auto-equipped when new) or level up an item: bonus first, then real coins. */
  buyItem(id: string): boolean {
    if (!GEAR_BY_ID[id] || !this.canBuyItem(id)) return false;
    const fresh = !this.itemLevel(id);
    if (this.paysItemWithBonus(id)) {
      this.bonus -= this.bonusItemCost(id);
      this.tempGear[id] = this.tempItemLevel(id) + 1;
    } else if (!this.p.buyItem(id)) return false;
    if (fresh && !this.equipped.includes(id)) this.equipped.push(id);
    this.changed();
    return true;
  }

  isEquipped(id: string): boolean {
    return !!GEAR_BY_ID[id] && this.equipped.includes(id);
  }

  toggleEquip(id: string): boolean {
    if (!GEAR_BY_ID[id] || !this.itemLevel(id)) return false;
    const i = this.equipped.indexOf(id);
    if (i >= 0) this.equipped.splice(i, 1);
    else this.equipped.push(id);
    this.changed();
    return true;
  }

  /** Temporary item levels bought with the bonus (for the UI / tests). */
  tempItemLevels(): Record<string, number> {
    return { ...this.tempGear };
  }

  /** MATCH OPPONENT: raise every shared (non plow-specific) upgrade to the opponent's level, paid only from the
   *  catch-up bonus, cheapest next level first. Returns what that would buy and cost, and how many levels the
   *  bonus can't cover. Doesn't change anything. */
  matchPlan(target: Partial<Record<UpgradeId, number>>): { buys: UpgradeId[]; cost: number; missing: number } {
    const lvl = new Map<UpgradeId, number>();
    let want = 0;
    for (const def of UPGRADES) {
      if (def.plowOnly || def.itemOnly) continue;
      const goal = Math.min(def.maxLevel, target[def.id] ?? 0);
      const have = this.level(def.id);
      if (goal > have) {
        lvl.set(def.id, have);
        want += goal - have;
      }
    }
    const buys: UpgradeId[] = [];
    let budget = this.bonus;
    let cost = 0;
    for (;;) {
      let best: UpgradeId | null = null;
      let bestCost = Infinity;
      for (const [id, l] of lvl) {
        if (l >= Math.min(UPGRADE_BY_ID[id].maxLevel, target[id] ?? 0)) continue;
        const c = upgradeCost(UPGRADE_BY_ID[id], l);
        if (c < bestCost) {
          bestCost = c;
          best = id;
        }
      }
      if (!best || bestCost > budget) break;
      budget -= bestCost;
      cost += bestCost;
      buys.push(best);
      lvl.set(best, lvl.get(best)! + 1);
    }
    return { buys, cost, missing: want - buys.length };
  }

  /** Apply matchPlan: buys from the bonus only. Returns levels bought. */
  matchOpponent(target: Partial<Record<UpgradeId, number>>): number {
    const { buys } = this.matchPlan(target);
    for (const id of buys) {
      this.bonus -= this.bonusCost(id);
      this.temp[id] = this.tempLevel(id) + 1;
    }
    if (buys.length) this.changed();
    return buys.length;
  }

  /** AUTO-SPEND's next purchase: the cheapest step the bonus can pay for among the core upgrades, this plow's line,
   *  levelling an equipped gear item, or buying (and equipping) a gear item not owned yet. Only items that do
   *  something in a duel; owned items the player took off stay off. Null when the bonus can't afford anything. */
  private autoStep(): { kind: 'up'; id: UpgradeId; cost: number } | { kind: 'item'; id: string; cost: number } | null {
    let best: { kind: 'up'; id: UpgradeId; cost: number } | { kind: 'item'; id: string; cost: number } | null = null;
    for (const def of SHOP_UPGRADES) {
      if (def.plowOnly && def.plowOnly !== this.plow) continue;
      const cost = this.bonusCost(def.id);
      if (cost <= this.bonus && (!best || cost < best.cost)) best = { kind: 'up', id: def.id, cost };
    }
    for (const d of GEAR) {
      // Multi-equip: every useful item can be worn at once, so any of them is a candidate step.
      if (!duelUseful(d.id) || (this.itemLevel(d.id) > 0 && !this.equipped.includes(d.id))) continue;
      const id = d.id;
      const cost = this.bonusItemCost(id);
      if (cost <= this.bonus && (!best || cost < best.cost)) best = { kind: 'item', id, cost };
    }
    return best;
  }

  /** True while AUTO-SPEND would buy something. */
  canAutoSpend(target: Partial<Record<UpgradeId, number>> | null): boolean {
    return (!!target && this.matchPlan(target).buys.length > 0) || this.autoStep() !== null;
  }

  /**
   * AUTO-SPEND: spend the catch-up bonus in one go. First MATCH OPPONENT (raise the shared upgrades to the
   * opponent's levels), then keep buying the cheapest next step across core upgrades, this plow's line and gear
   * (level what's equipped, buy items not owned yet) until the bonus runs out, so the coins spread evenly instead of piling
   * into one stat. Bonus only: real coins are never touched. Returns how many purchases it made.
   */
  autoSpend(target: Partial<Record<UpgradeId, number>> | null): number {
    let n = target ? this.matchOpponent(target) : 0;
    for (let guard = 0; guard < 5000; guard++) {
      const step = this.autoStep();
      if (!step) break;
      this.bonus -= step.cost;
      if (step.kind === 'up') this.temp[step.id] = this.tempLevel(step.id) + 1;
      else {
        this.tempGear[step.id] = this.tempItemLevel(step.id) + 1;
        if (!this.equipped.includes(step.id)) this.equipped.push(step.id);
      }
      n++;
    }
    if (n) this.changed();
    return n;
  }

  /** Keep the duel garage's catch-up levels and gear loadout: fold them into the save (called when the match starts). */
  commitTemp(): void {
    let any = false;
    for (const [id, n] of Object.entries(this.temp) as [UpgradeId, number][]) {
      if (!n) continue;
      this.p.data.upgrades[id] = Math.min(UPGRADE_BY_ID[id].maxLevel, this.p.level(id) + n);
      any = true;
    }
    this.temp = {};
    const g = this.p.gear;
    for (const [id, n] of Object.entries(this.tempGear)) {
      if (!n) continue;
      g.owned[id] = Math.min(GEAR_MAX_LEVEL, (g.owned[id] ?? 0) + n);
      any = true;
    }
    this.tempGear = {};
    const eq = this.equipped;
    if (equipChanged(g.equipped, eq)) {
      g.equipped = [...eq];
      any = true;
    }
    if (any) this.p.commit();
  }

  /** Temporary levels bought with the bonus (for the UI / tests). */
  tempLevels(): Partial<Record<UpgradeId, number>> {
    return { ...this.temp };
  }
}

/** Stats a duel ignores: coin pickup range, and snow regrowth (both players share DUEL_SNOW_REGEN). */
const DUEL_IGNORED: ReadonlySet<UpgradeId> = new Set<UpgradeId>(['magnet', 'snowMachine']);

/** True if at least one of the item's stats does something in a duel (AUTO-SPEND only buys those). */
function duelUseful(id: string): boolean {
  const def = GEAR_BY_ID[id];
  return !!def && def.grants.some((g) => !DUEL_IGNORED.has(g.stat));
}

function equipChanged(a: readonly string[], b: readonly string[]): boolean {
  return a.length !== b.length || a.some((id, i) => id !== b[i]);
}
