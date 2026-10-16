import { FX, UPGRADES, UPGRADE_BY_ID, upgradeCost, type UpgradeId } from '../config/upgrades';
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
    const cd = FX.cooldownMult(L('overclock'));
    return {
      maxSpeed: FX.maxSpeed(L('engine')),
      accel: FX.accel(L('engine')),
      turnRate: FX.turnRate(L('engine')),
      bladeWidth: FX.bladeWidth(L('blade')),
      collectRate: FX.collectRate(L('compactor')),
      maxBallRadius: FX.maxBallRadius(L('hopper')),
      damageMult: FX.damageMult(L('packedIce')),
      ramDamage: FX.ramDamage(L('ramSpikes')),
      maxHp: FX.maxHp(L('armor')) + FX.bonusHp(L('vitality')),
      damageTaken: FX.damageTaken(L('plating')),
      repairFraction: FX.repairFraction(L('repairKit')),
      hpRegen: FX.hpRegen(L('repairKit')),
      dashCooldown: FX.dashCooldown(L('nitro')) * cd,
      dashPower: FX.dashPower(L('nitro')),
      whirlRadius: FX.whirlRadius(L('whirl')),
      whirlDamage: FX.whirlDamage(L('whirl')),
      whirlCooldown: FX.whirlCooldown(L('whirl')) * cd,
      snowRegen: FX.snowRegen(L('snowMachine')),
      magnetRadius: FX.magnetRadius(L('magnet')),
      shieldBlock: L('iceShield') > 0 ? 0.75 : 0.4,
      lifesteal: FX.lifesteal(L('salvage')),
      secondWindCd: FX.secondWindCd(L('secondWind')),
      hitCapBonus: FX.hitCapBonus(L('wreckingBall')),
      killRecharge: FX.killRecharge(L('adrenaline')),
      flameRange: FX.flameRange(L('inferno')),
      flameDps: FX.flameDps(L('inferno')),
      flameCooldown: FX.flameCooldown(L('inferno')) * cd,
      cooldownMult: cd,
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
