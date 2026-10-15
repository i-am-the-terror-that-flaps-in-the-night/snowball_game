import { UPGRADES, UPGRADE_BY_ID, upgradeCost, type UpgradeId } from '../config/upgrades';
import { ZONES } from '../config/zones';
import type { PlayerStats } from './types';

const SAVE_KEY = 'snowplow-showdown-save-v2';

export interface ZoneRecord {
  cleared: boolean;
  bestRound: number;
}

export interface SaveData {
  version: 1;
  coins: number;
  upgrades: Partial<Record<UpgradeId, number>>;
  /** Number of zones the player may enter (>= 1). */
  unlockedZones: number;
  zones: Record<string, ZoneRecord>;
  totalKills: number;
  totalCoinsEarned: number;
  muted: boolean;
  /** Brawl mode records. */
  brawlMatches: number;
  brawlWins: number;
  brawlBestStreak: number;
  brawlBestKills: number;
}

function freshSave(): SaveData {
  return { version: 1, coins: 0, upgrades: {}, unlockedZones: 1, zones: {}, totalKills: 0, totalCoinsEarned: 0, muted: false, brawlMatches: 0, brawlWins: 0, brawlBestStreak: 0, brawlBestKills: 0 };
}

/** Persistent meta-progression: coins, upgrade levels, unlocked zones. Saved to localStorage. */
export class Progression {
  data: SaveData;
  private listeners = new Set<() => void>();

  constructor() {
    this.data = this.load();
  }

  private load(): SaveData {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SaveData;
        if (parsed && parsed.version === 1) return { ...freshSave(), ...parsed };
      }
    } catch {
      /* corrupted save — start fresh */
    }
    return freshSave();
  }

  save(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable */
    }
  }

  /** Subscribe to coin / upgrade changes (UI refresh). Returns an unsubscribe fn. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    this.save();
    for (const fn of this.listeners) fn();
  }

  get coins(): number {
    return this.data.coins;
  }

  addCoins(n: number): void {
    if (n <= 0) return;
    this.data.coins += Math.round(n);
    this.data.totalCoinsEarned += Math.round(n);
    this.changed();
  }

  level(id: UpgradeId): number {
    return this.data.upgrades[id] ?? 0;
  }

  isMaxed(id: UpgradeId): boolean {
    return this.level(id) >= UPGRADE_BY_ID[id].maxLevel;
  }

  /** Cost of the next level, or Infinity if maxed. */
  cost(id: UpgradeId): number {
    if (this.isMaxed(id)) return Infinity;
    return upgradeCost(UPGRADE_BY_ID[id], this.level(id));
  }

  canBuy(id: UpgradeId): boolean {
    return !this.isMaxed(id) && this.data.coins >= this.cost(id);
  }

  buy(id: UpgradeId): boolean {
    if (!this.canBuy(id)) return false;
    this.data.coins -= this.cost(id);
    this.data.upgrades[id] = this.level(id) + 1;
    this.changed();
    return true;
  }

  isZoneUnlocked(index: number): boolean {
    return index < this.data.unlockedZones;
  }

  zoneRecord(id: string): ZoneRecord {
    return this.data.zones[id] ?? { cleared: false, bestRound: 0 };
  }

  /** Record a finished run. Returns whether this was the first clear of the zone. */
  recordRun(zoneIndex: number, roundsCleared: number, cleared: boolean, kills: number): boolean {
    const zone = ZONES[zoneIndex];
    const rec = this.zoneRecord(zone.id);
    const firstClear = cleared && !rec.cleared;
    this.data.zones[zone.id] = { cleared: rec.cleared || cleared, bestRound: Math.max(rec.bestRound, roundsCleared) };
    if (cleared) this.data.unlockedZones = Math.max(this.data.unlockedZones, Math.min(ZONES.length, zoneIndex + 2));
    this.data.totalKills += kills;
    this.changed();
    return firstClear;
  }

  /** Record a finished brawl (coins are awarded live by the BrawlManager, not here). */
  recordBrawl(placement: number, kills: number, bestStreak: number): void {
    this.data.brawlMatches++;
    if (placement === 1) this.data.brawlWins++;
    this.data.brawlBestStreak = Math.max(this.data.brawlBestStreak, bestStreak);
    this.data.brawlBestKills = Math.max(this.data.brawlBestKills, kills);
    this.data.totalKills += kills;
    this.changed();
  }

  setMuted(m: boolean): void {
    this.data.muted = m;
    this.save();
  }

  resetSave(): void {
    this.data = freshSave();
    this.changed();
  }

  computeStats(): PlayerStats {
    const L = (id: UpgradeId) => this.level(id);
    return {
      maxSpeed: 10 + 1.4 * L('engine'),
      accel: 14 + 3 * L('engine'),
      turnRate: 2.6 + 0.15 * L('engine'),
      bladeWidth: 2.6 + 0.4 * L('blade'),
      collectRate: 0.12 + 0.035 * L('compactor'),
      maxBallRadius: 1.2 + 0.3 * L('hopper'),
      damageMult: 1 + 0.25 * L('packedIce'),
      ramDamage: 14 + 5 * L('ramSpikes'),
      maxHp: 120 + 35 * L('armor'),
      damageTaken: 1 - 0.05 * L('plating'),
      repairFraction: 0.35 + 0.2 * L('repairKit'),
      hpRegen: 0.8 * L('repairKit'),
      dashCooldown: 2.4 - 0.4 * L('nitro'),
      dashPower: 16 + 3 * L('nitro'),
      whirlRadius: 4 + 0.7 * L('whirl'),
      whirlDamage: 10 + 4 * L('whirl'),
      whirlCooldown: 6 - L('whirl'),
      snowRegen: 0.006 * (1 + L('snowMachine')),
      magnetRadius: 4 + 3 * L('magnet'),
      shieldBlock: L('iceShield') > 0 ? 0.75 : 0.4,
      frostCore: L('frostCore') > 0,
      avalancheCore: L('avalancheCore') > 0,
    };
  }

  /** Debug helper (?debug in URL): lots of coins and every arena unlocked. */
  debugGrant(): void {
    this.data.coins += 100000;
    this.data.unlockedZones = ZONES.length;
    this.changed();
  }

  static get upgrades() {
    return UPGRADES;
  }
}
