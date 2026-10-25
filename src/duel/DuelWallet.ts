import { UPGRADES, UPGRADE_BY_ID, upgradeCost, type UpgradeId } from '../config/upgrades';
import type { PlowKind } from '../config/plows';
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
}

/**
 * DUEL GARAGE wallet. Spends the catch-up `bonus` first, on TEMPORARY levels that exist only inside this object
 * (they never touch the save and vanish with it after the match), then the player's real coins through the
 * Progression as normal, permanent, saved purchases.
 *
 * Effective level = saved level + temporary levels. A bonus purchase costs the price of the next EFFECTIVE level;
 * once the bonus can't cover that, the card falls back to a normal purchase at the saved level's price.
 */
export class DuelWallet implements ShopWallet {
  private temp: Partial<Record<UpgradeId, number>> = {};
  private listeners = new Set<() => void>();
  /** Bonus coins handed out this garage phase / left to spend. */
  readonly bonusTotal: number;
  bonus: number;

  constructor(
    private p: Progression,
    bonus: number,
  ) {
    this.bonusTotal = this.bonus = Math.max(0, Math.floor(bonus));
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

  /** Saved + temporary levels: what this player fights with. */
  effectiveLevels(): Partial<Record<UpgradeId, number>> {
    const out: Partial<Record<UpgradeId, number>> = {};
    for (const def of UPGRADES) {
      const l = this.level(def.id);
      if (l > 0) out[def.id] = l;
    }
    return out;
  }

  /** Temporary levels bought with the bonus (for the UI / tests). */
  tempLevels(): Partial<Record<UpgradeId, number>> {
    return { ...this.temp };
  }
}
