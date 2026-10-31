import { FX, ITEM_STATS, UPGRADES, UPGRADE_BY_ID, cooldown, upgradeCost, type UpgradeId } from '../config/upgrades';
import { GEAR_BY_ID, GEAR_MAX_LEVEL, gearCost, gearLevels, type GearSlot, type GearState } from '../config/gear';
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
  // ---- Meta progression (all optional: older saves lack them). Owned by src/meta/*.
  /** Cosmetics (config/cosmetics.ts): owned item ids and the equipped item id per slot. */
  cosmetics?: { owned: string[]; equipped: Record<string, string> };
  /** Campaign challenges (meta/challenges.ts): zone id -> completed challenge ids (1 star each). */
  challenges?: Record<string, string[]>;
  /** Hard-mode campaign clears: zone id -> true. */
  hardCleared?: Record<string, boolean>;
  /** Achievements (meta/achievements.ts): id -> 1 once unlocked. */
  achievements?: Record<string, number>;
  /** Lifetime counters for achievements and the stats page (meta/achievements.ts), e.g. slams, bossKills. */
  lifetime?: Record<string, number>;
  /** Daily Survival (meta/daily.ts): day key 'YYYY-MM-DD' -> best wave that day. */
  dailyBest?: Record<string, number>;
  /** Gear (config/gear.ts): owned item levels and the equipped item per slot. */
  gear?: GearState;
}

function freshSave(): SaveData {
  return { version: 1, coins: 0, upgrades: {}, unlockedZones: 1, zones: {}, totalKills: 0, totalCoinsEarned: 0, muted: false, brawlMatches: 0, brawlWins: 0, brawlBestStreak: 0, brawlBestKills: 0, plow: 'classic' };
}

const EXPORT_PREFIX = 'SPS1:';

/** Upgrade ids that were replaced: old saves carry their levels over to the new upgrade. */
const RENAMED_UPGRADES: Record<string, UpgradeId> = { vitality: 'lastStand' };

function migrateUpgrades<T>(ups: Record<string, T>): Record<string, T> {
  const out = { ...ups };
  for (const [from, to] of Object.entries(RENAMED_UPGRADES)) {
    if (!(from in out)) continue;
    if (!(to in out)) out[to] = out[from];
    delete out[from];
  }
  return out;
}

/** Stats that became gear (ITEM_STATS): old saves get every coin they spent on them back, once. */
function refundItemStats(d: SaveData): void {
  for (const id of ITEM_STATS) {
    const n = d.upgrades[id] ?? 0;
    for (let l = 0; l < Math.min(n, 999); l++) d.coins += upgradeCost(UPGRADE_BY_ID[id], l);
    delete d.upgrades[id];
  }
}

function cleanGear(raw: unknown): GearState {
  const out: GearState = { owned: {}, equipped: {} };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (r.owned && typeof r.owned === 'object') {
    for (const [id, lv] of Object.entries(r.owned as Record<string, unknown>)) {
      if (GEAR_BY_ID[id] && typeof lv === 'number' && Number.isFinite(lv) && lv >= 1) out.owned[id] = Math.min(GEAR_MAX_LEVEL, Math.floor(lv));
    }
  }
  if (r.equipped && typeof r.equipped === 'object') {
    for (const [slot, id] of Object.entries(r.equipped as Record<string, unknown>)) {
      if (typeof id === 'string' && out.owned[id] && GEAR_BY_ID[id].slot === slot) out.equipped[slot as GearSlot] = id;
    }
  }
  return out;
}

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
    for (const [id, lv] of Object.entries(migrateUpgrades(p.upgrades as Record<string, unknown>))) {
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
  // Meta progression: only well-formed entries survive.
  const strList = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length <= 64))] : []);
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const numMap = (v: unknown, max = Number.MAX_SAFE_INTEGER) => {
    const m: Record<string, number> = {};
    if (isObj(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'number' && isFinite(x)) m[k] = num(x, 0, max);
    return m;
  };
  if (isObj(p.cosmetics)) {
    const equipped: Record<string, string> = {};
    if (isObj(p.cosmetics.equipped)) for (const [k, x] of Object.entries(p.cosmetics.equipped)) if (typeof x === 'string') equipped[k] = x;
    out.cosmetics = { owned: strList(p.cosmetics.owned), equipped };
  }
  if (isObj(p.challenges)) {
    out.challenges = {};
    for (const [k, x] of Object.entries(p.challenges)) out.challenges[k] = strList(x);
  }
  if (isObj(p.hardCleared)) {
    out.hardCleared = {};
    for (const [k, x] of Object.entries(p.hardCleared)) if (x === true) out.hardCleared[k] = true;
  }
  if (p.achievements !== undefined) out.achievements = numMap(p.achievements, 1);
  if (p.lifetime !== undefined) out.lifetime = numMap(p.lifetime);
  if (p.dailyBest !== undefined) out.dailyBest = numMap(p.dailyBest, 9999);
  if (p.gear !== undefined) out.gear = cleanGear(p.gear);
  refundItemStats(out);
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
        if (parsed && parsed.version === 1) {
          const d: SaveData = { ...freshSave(), ...parsed, upgrades: migrateUpgrades(parsed.upgrades ?? {}) };
          if (d.gear) d.gear = cleanGear(d.gear);
          refundItemStats(d);
          return d;
        }
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

  /** Save + notify listeners after a meta module (src/meta/*) edits `data` directly. */
  commit(): void {
    this.changed();
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

  /* ---------------------------------------------------------------- gear */

  get gear(): GearState {
    return (this.data.gear ??= { owned: {}, equipped: {} });
  }

  /** Item level (0 = not owned). */
  itemLevel(id: string): number {
    return this.data.gear?.owned[id] ?? 0;
  }

  /** Price to buy (level 0) or level up an item; Infinity at max. */
  itemCost(id: string): number {
    const def = GEAR_BY_ID[id];
    return def ? gearCost(def, this.itemLevel(id)) : Infinity;
  }

  canBuyItem(id: string): boolean {
    return this.data.coins >= this.itemCost(id);
  }

  /** Buy an item (auto-equipped if its slot is empty) or raise its level. */
  buyItem(id: string): boolean {
    const def = GEAR_BY_ID[id];
    if (!def || !this.canBuyItem(id)) return false;
    this.data.coins -= this.itemCost(id);
    const g = this.gear;
    g.owned[id] = this.itemLevel(id) + 1;
    if (!g.equipped[def.slot]) g.equipped[def.slot] = id;
    this.changed();
    return true;
  }

  isEquipped(id: string): boolean {
    const def = GEAR_BY_ID[id];
    return !!def && this.data.gear?.equipped[def.slot] === id;
  }

  /** Equip an owned item in its slot, or take it off if it's already equipped. */
  toggleEquip(id: string): boolean {
    const def = GEAR_BY_ID[id];
    if (!def || !this.itemLevel(id)) return false;
    const g = this.gear;
    if (g.equipped[def.slot] === id) delete g.equipped[def.slot];
    else g.equipped[def.slot] = id;
    this.changed();
    return true;
  }

  /** Garage levels + equipped gear: what the plow actually fights with. */
  effectiveLevels(): Partial<Record<UpgradeId, number>> {
    const out: Partial<Record<UpgradeId, number>> = { ...this.data.upgrades };
    for (const [id, n] of Object.entries(gearLevels(this.data.gear)) as [UpgradeId, number][]) {
      out[id] = Math.min(UPGRADE_BY_ID[id].maxLevel, (out[id] ?? 0) + n);
    }
    return out;
  }

  /** Effective level of one stat (Garage + gear). */
  statLevel(id: UpgradeId): number {
    return this.effectiveLevels()[id] ?? 0;
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
    return computeStatsFor(this.effectiveLevels(), this.plow);
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

/** Stats for a garage given as upgrade levels + the driven plow. Pure: the save's computeStats and the Duel host
 *  (which computes BOTH players' stats from the levels they bring) share it. */
export function computeStatsFor(levels: Partial<Record<UpgradeId, number>>, plowKind: PlowKind): PlayerStats {
  const plow = PLOWS[plowKind] ?? PLOWS.classic;
  // Plow-exclusive upgrades only count while driving that plow.
  const L = (id: UpgradeId) => {
    const only = UPGRADE_BY_ID[id].plowOnly;
    if (only && only !== plow.id) return 0;
    const v = levels[id] ?? 0;
    return Number.isFinite(v) ? Math.max(0, Math.min(UPGRADE_BY_ID[id].maxLevel, Math.floor(v))) : 0;
  };
  const cd = FX.cooldownMult(L('overclock'));
  const fire = plow.fAbility === 'fire';
  const arsenal = plow.id === 'arsenal';
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
    shieldMax: arsenal ? FX.barrier(L('armBarrier')) : FX.shieldMax(L('voltCell')),
    gunDamage: arsenal ? FX.gunDamage(L('armCannon')) : 0,
    gunRate: FX.gunRate(L('armCannon')),
    gunRange: FX.gunRange(L('armCannon')),
    laserDps: arsenal ? FX.laserDps(L('armLaser')) : 0,
    laserRange: FX.laserRange(L('armLaser')),
    missileCount: FX.missileCount(L('armMissiles')),
    missileDamage: arsenal ? FX.missileDamage(L('armMissiles')) : 0,
    missileCooldown: cooldown(FX.missileCooldown(L('armMissiles')), cd),
    poundRadius: FX.poundRadius(L('brutePound')),
    poundDamage: plow.id === 'brute' ? FX.poundDamage(L('brutePound')) : 0,
    poundStun: FX.poundStun(L('brutePound')),
    poundKnock: FX.poundKnock(L('brutePound')),
    poundCooldown: cooldown(FX.poundCooldown(L('brutePound')), cd),
    momentum: FX.momentum(L('bruteMomentum')),
    sawRadius: FX.sawRadius(L('bruteSaws')),
    sawDps: plow.id === 'brute' ? FX.sawDps(L('bruteSaws')) : 0,
    meltRadius: FX.meltRadius(L('isoMeltdown')),
    meltDamage: plow.id === 'isotope' ? FX.meltDamage(L('isoMeltdown')) : 0,
    meltCooldown: cooldown(FX.meltCooldown(L('isoMeltdown')), cd),
    poolRadius: FX.poolRadius(L('isoHalfLife')),
    poolDps: FX.poolDps(L('isoHalfLife')),
    poolSeconds: FX.poolSeconds(L('isoHalfLife')),
    auraRadius: FX.auraRadius(L('isoAura')),
    auraDps: plow.id === 'isotope' ? FX.auraDps(L('isoAura')) : 0,
    chainBlast: plow.id === 'isotope' ? FX.chainBlast(L('isoChain')) : 0,
    maxSpeed: FX.maxSpeed(L('engine')) * plow.speedMult,
    accel: FX.accel(L('engine')) * plow.accelMult,
    turnRate: FX.turnRate(L('engine')),
    bladeWidth: FX.bladeWidth(L('blade')),
    collectRate: FX.collectRate(L('compactor')),
    maxBallRadius: FX.maxBallRadius(L('hopper')),
    damageMult: FX.damageMult(L('packedIce')) * plow.slamMult,
    ramDamage: FX.ramDamage(L('ramSpikes')),
    maxHp: FX.maxHp(L('armor')) * plow.hpMult,
    damageTaken: FX.damageTaken(L('plating')),
    ironHide: FX.ironHide(L('bruteHide')),
    repairFraction: FX.repairFraction(L('repairKit')),
    hpRegen: FX.hpRegen(L('repairKit')),
    dashCooldown: cooldown(FX.dashCooldown(L('nitro')), cd),
    dashPower: FX.dashPower(L('nitro')) * plow.dashPowerMult,
    whirlRadius: FX.whirlRadius(L('whirl')),
    whirlDamage: FX.whirlDamage(L('whirl')),
    // ARSENAL's E is the laser: its recharge rides on the whirl charge.
    whirlCooldown: cooldown(arsenal ? FX.laserCooldown(L('armLaser')) : FX.whirlCooldown(L('whirl')), cd),
    snowRegen: FX.snowRegen(L('snowMachine')),
    magnetRadius: FX.magnetRadius(L('magnet')),
    shieldBlock: L('iceShield') > 0 ? 0.75 : 0.4,
    lifesteal: FX.lifesteal(L('salvage')),
    secondWindCd: FX.secondWindCd(L('secondWind')),
    hitCapBonus: FX.hitCapBonus(L('wreckingBall')),
    killRecharge: FX.killRecharge(L('adrenaline')),
    lastStand: FX.lastStand(L('lastStand')),
    shardFrac: FX.shardFrac(L('classicShatter')),
    shardReach: FX.shardReach(L('classicShatter')),
    reserveFrac: FX.reserveFrac(L('classicReserve')),
    comboStep: FX.comboStep(L('classicCombo')),
    flameRange: FX.flameRange(L('inferno')),
    flameDps: fire ? FX.flameDps(L('inferno')) : 0,
    // Inferno is free on the Classic Plow (level 0 = base fire); the upgrade only strengthens it.
    flameCooldown: cooldown(FX.flameCooldown(L('inferno')), cd),
    cooldownMult: cd,
    frostCore: L('frostCore') > 0,
    avalancheCore: L('avalancheCore') > 0,
  };
}
