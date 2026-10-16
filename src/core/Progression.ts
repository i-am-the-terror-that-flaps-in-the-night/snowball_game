import { FX, UPGRADES, UPGRADE_BY_ID, cooldown, upgradeCost, type UpgradeId } from '../config/upgrades';
import { ZONES } from '../config/zones';
import type { PlayerStats } from './types';
import { PLOWS, type PlowKind } from '../config/plows';

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
  /** Selected starter plow. */
  plow: PlowKind;
  /** Survival mode: highest wave reached (optional — older saves lack it). */
  survivalBestWave?: number;
}

function freshSave(): SaveData {
  return { version: 1, coins: 0, upgrades: {}, unlockedZones: 1, zones: {}, totalKills: 0, totalCoinsEarned: 0, muted: false, brawlMatches: 0, brawlWins: 0, brawlBestStreak: 0, brawlBestKills: 0, plow: 'classic' };
}

const EXPORT_PREFIX = 'SPS1:';

/** Validate an imported save: every field type-checked and clamped; unknown keys dropped. Null if unusable. */
function sanitizeSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (p.version !== 1) return null;
  const num = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) =>
    typeof v === 'number' && isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : min;
  if (typeof p.coins !== 'number' || !isFinite(p.coins) || p.coins < 0) return null;
  const out = freshSave();
  out.coins = num(p.coins);
  if (p.upgrades && typeof p.upgrades === 'object') {
    for (const [id, lv] of Object.entries(p.upgrades as Record<string, unknown>)) {
      const def = UPGRADE_BY_ID[id as UpgradeId];
      if (def && typeof lv === 'number') out.upgrades[id as UpgradeId] = num(lv, 0, def.maxLevel);
    }
  }
  out.unlockedZones = num(p.unlockedZones, 1, ZONES.length);
  if (p.zones && typeof p.zones === 'object') {
    for (const z of ZONES) {
      const r = (p.zones as Record<string, unknown>)[z.id] as Partial<ZoneRecord> | undefined;
      if (r && typeof r === 'object') out.zones[z.id] = { cleared: r.cleared === true, bestRound: num(r.bestRound, 0, 999) };
    }
  }
  out.totalKills = num(p.totalKills);
  out.totalCoinsEarned = num(p.totalCoinsEarned);
  out.muted = p.muted === true;
  out.brawlMatches = num(p.brawlMatches);
  out.brawlWins = Math.min(out.brawlMatches, num(p.brawlWins));
  out.brawlBestStreak = num(p.brawlBestStreak);
  out.brawlBestKills = num(p.brawlBestKills);
  out.plow = typeof p.plow === 'string' && PLOWS[p.plow as PlowKind] ? (p.plow as PlowKind) : 'classic';
  if (p.survivalBestWave !== undefined) out.survivalBestWave = num(p.survivalBestWave, 0, 9999);
  return out;
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

  /** Spend coins on a one-off purchase (e.g. Survival's Full Repair). False if unaffordable. */
  spend(n: number): boolean {
    n = Math.round(n);
    if (n <= 0 || this.data.coins < n) return false;
    this.data.coins -= n;
    this.changed();
    return true;
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

  get plow(): PlowKind {
    return PLOWS[this.data.plow] ? this.data.plow : 'classic';
  }

  setPlow(kind: PlowKind): void {
    if (this.data.plow === kind) return;
    this.data.plow = kind;
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

  /** Portable save code: "SPS1:" + base64(JSON). */
  exportSave(): string {
    const bytes = new TextEncoder().encode(JSON.stringify(this.data));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return EXPORT_PREFIX + btoa(bin);
  }

  /** Load a save code (or raw JSON). Validates and sanitizes; on failure the current save is untouched. */
  importSave(text: string): { ok: true } | { ok: false; error: string } {
    let parsed: unknown;
    try {
      let s = text.trim();
      if (!s) return { ok: false, error: 'Paste a save code first.' };
      if (!s.startsWith('{')) {
        if (s.startsWith(EXPORT_PREFIX)) s = s.slice(EXPORT_PREFIX.length);
        const bin = atob(s.replace(/\s+/g, ''));
        s = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
      }
      parsed = JSON.parse(s);
    } catch {
      return { ok: false, error: "That doesn't look like a Snowplow Showdown save code." };
    }
    const data = sanitizeSave(parsed);
    if (!data) return { ok: false, error: 'Save code is damaged or from an unknown version.' };
    this.data = data;
    this.changed();
    return { ok: true };
  }

  computeStats(): PlayerStats {
    const plow = PLOWS[this.plow];
    // Plow-exclusive upgrades only count while driving that plow.
    const L = (id: UpgradeId) => {
      const only = UPGRADE_BY_ID[id].plowOnly;
      return only && only !== plow.id ? 0 : this.level(id);
    };
    const cd = FX.cooldownMult(L('overclock'));
    const fire = plow.fAbility === 'fire';
    return {
      plowKind: plow.id,
      chainCount: FX.chainCount(L('voltChain')),
      chainFrac: FX.chainFrac(L('voltChain')),
      fieldRadius: FX.fieldRadius(L('voltField')),
      fieldDps: FX.fieldDps(L('voltField')),
      clapRadius: FX.clapRadius(L('voltClap')),
      clapDamage: plow.id === 'volt' ? FX.clapDamage(L('voltClap')) : 0,
      clapStun: FX.clapStun(L('voltClap')),
      clapCooldown: cooldown(FX.clapCooldown(L('voltClap')), cd),
      shieldMax: FX.shieldMax(L('voltCell')),
      poundRadius: FX.poundRadius(L('brutePound')),
      poundDamage: plow.id === 'brute' ? FX.poundDamage(L('brutePound')) : 0,
      poundStun: FX.poundStun(L('brutePound')),
      poundKnock: FX.poundKnock(L('brutePound')),
      poundCooldown: cooldown(FX.poundCooldown(L('brutePound')), cd),
      momentum: FX.momentum(L('bruteMomentum')),
      maxSpeed: FX.maxSpeed(L('engine')) * plow.speedMult,
      accel: FX.accel(L('engine')) * plow.accelMult,
      turnRate: FX.turnRate(L('engine')),
      bladeWidth: FX.bladeWidth(L('blade')),
      collectRate: FX.collectRate(L('compactor')),
      maxBallRadius: FX.maxBallRadius(L('hopper')),
      damageMult: FX.damageMult(L('packedIce')) * plow.slamMult,
      ramDamage: FX.ramDamage(L('ramSpikes')),
      maxHp: (FX.maxHp(L('armor')) + FX.bonusHp(L('vitality'))) * plow.hpMult,
      damageTaken: FX.damageTaken(L('plating')) * FX.ironHide(L('bruteHide')),
      repairFraction: FX.repairFraction(L('repairKit')),
      hpRegen: FX.hpRegen(L('repairKit')),
      dashCooldown: cooldown(FX.dashCooldown(L('nitro')), cd),
      dashPower: FX.dashPower(L('nitro')) * plow.dashPowerMult,
      whirlRadius: FX.whirlRadius(L('whirl')),
      whirlDamage: FX.whirlDamage(L('whirl')),
      whirlCooldown: cooldown(FX.whirlCooldown(L('whirl')), cd),
      snowRegen: FX.snowRegen(L('snowMachine')),
      magnetRadius: FX.magnetRadius(L('magnet')),
      shieldBlock: L('iceShield') > 0 ? 0.75 : 0.4,
      lifesteal: FX.lifesteal(L('salvage')),
      secondWindCd: FX.secondWindCd(L('secondWind')),
      hitCapBonus: FX.hitCapBonus(L('wreckingBall')),
      killRecharge: FX.killRecharge(L('adrenaline')),
      flameRange: FX.flameRange(L('inferno')),
      flameDps: fire ? FX.flameDps(L('inferno')) : 0,
      // Inferno is free on the Classic Plow (level 0 = base fire); the upgrade only strengthens it.
      flameCooldown: cooldown(FX.flameCooldown(L('inferno')), cd),
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
