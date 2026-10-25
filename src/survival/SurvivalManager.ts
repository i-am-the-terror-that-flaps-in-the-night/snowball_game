import type { GameContext, ZoneDef } from '../core/types';
import type { Progression } from '../core/Progression';
import type { RoundDef, SpawnGroup } from '../config/zones';
import { ZONES } from '../config/zones';
import { ENEMIES, type EnemyType } from '../config/enemies';
import type { PlayerStats } from '../core/types';
import { cooldown } from '../config/upgrades';
import {
  DAILY_COIN_MULT, dailyBest, dailyModifier, mulberry32, recordDaily, setActiveDaily,
  type DailyModifierId, type DailySpec,
} from '../meta/daily';

/* SURVIVAL: endless post-campaign mode in one arena. Each wave is generated into a one-round ZoneDef
 * (zone.rounds[0]) so the regular WaveDirector / EnemyManager run it unchanged; per-wave scaling is
 * written onto that zone (enemyHpMult for bot hp incl. summons, coinMult for kill coins, enemyDmgMult
 * for bot hits on the plow). Every BOSS_EVERY-th wave is a boss wave cycling through the campaign bosses.
 * Game owns the flow (countdown -> playing -> cleared -> breather countdown ...).
 *
 * DAILY: reset(spec) turns the run into the day's Daily (meta/daily.ts): wave generation draws from a
 * seeded rng instead of Math.random (same day = same lineup), the day's modifier tweaks the zone, the wave
 * mix or the player's stats (adjustStats), and the best wave goes to save.dailyBest instead of
 * survivalBestWave. Every reset rebuilds the zone from the base arena, so nothing leaks between runs. */

/** Every Nth wave is a boss wave. */
export const BOSS_EVERY = 5;
/** Breather between waves (seconds; the last 3 tick down with the countdown beeps). */
export const BREATHER_SECONDS = 5;
const FIRST_WAVE_SECONDS = 3;
const BOSS_BREATHER_SECONDS = 6;
/** Fraction of the Repair Kit's between-round repair applied after each wave. */
const WAVE_REPAIR = 0.5;
/** Max bots in one generated wave (spawn pacing keeps the arena readable). */
const MAX_WAVE_BOTS = 24;

/** Spawn-budget cost + first wave each minion type may appear in. */
const MINIONS: { type: EnemyType; cost: number; from: number }[] = [
  { type: 'scrapper', cost: 1, from: 1 },
  { type: 'thief', cost: 1.4, from: 2 },
  { type: 'spinner', cost: 2, from: 3 },
  { type: 'brute', cost: 3, from: 4 },
];

/** Boss cycle (one entry per boss wave); twins come as a pair. */
const BOSS_CYCLE: { types: EnemyType[]; name: string }[] = [
  { types: ['bulldoza'], name: 'BULLDOZA' },
  { types: ['frostbyte'], name: 'FROSTBYTE' },
  { types: ['grinder'], name: 'THE GRINDER' },
  { types: ['slush', 'sleet'], name: 'SLUSH & SLEET' },
  { types: ['omega'], name: 'MEGAPLOW Ω' },
];

/** Named special waves: one roughly every other wave between bosses (see specialFor), each with its own
 *  lineup and tuning so the run doesn't feel like the same mix scaled up. */
export interface SpecialWave {
  id: 'swarm' | 'thiefRaid' | 'sawStorm' | 'heavyMetal' | 'elite' | 'blitz';
  name: string;
  icon: string;
  blurb: string;
  /** First wave it may show up on. */
  from: number;
  /** Multipliers on the wave's bot hp and coins. */
  hp: number;
  coins: number;
}

export const SPECIAL_WAVES: readonly SpecialWave[] = [
  { id: 'swarm', name: 'SWARM', icon: '🐝', blurb: 'A flood of flimsy scrappers. Whirlwind them!', from: 3, hp: 0.45, coins: 0.8 },
  { id: 'thiefRaid', name: 'THIEF RAID', icon: '🦝', blurb: 'Snow thieves everywhere. Guard your ball.', from: 3, hp: 0.9, coins: 1.2 },
  { id: 'blitz', name: 'BLITZ', icon: '⚡', blurb: 'The whole wave drops in at once.', from: 4, hp: 0.85, coins: 1.25 },
  { id: 'sawStorm', name: 'SAW STORM', icon: '🪚', blurb: 'Buzzsaws only. Keep moving.', from: 6, hp: 0.9, coins: 1.3 },
  { id: 'heavyMetal', name: 'HEAVY METAL', icon: '🛡️', blurb: 'Brute dozers, and nothing else.', from: 7, hp: 1, coins: 1.4 },
  { id: 'elite', name: 'ELITE SQUAD', icon: '💀', blurb: 'A few tough bots. Double coins.', from: 8, hp: 2.2, coins: 2 },
];

/** Enemy hp multiplier for wave w (1-based): linear early, gently exponential late. */
export const waveHpMult = (w: number) => (1 + 0.1 * (w - 1)) * Math.pow(1.02, w - 1);
/** Enemy hit damage multiplier for wave w. */
export const waveDmgMult = (w: number) => 1 + 0.05 * (w - 1);
/** Kill-coin multiplier for wave w. */
export const waveCoinMult = (w: number) => 1 + 0.06 * (w - 1);
/** Bonus coins for clearing wave w (boss waves pay triple). */
export const waveClearBonus = (w: number, bossEvery = BOSS_EVERY) => Math.round((10 + 6 * w) * (w % bossEvery === 0 ? 3 : 1));

/** Coins for the between-wave shop's one-off Full Repair after clearing wave w. */
export const fullRepairCost = (w: number) => Math.round(30 + 12 * w);

/** Unlocked after beating arena 1 (also true in ?debug, which unlocks every arena). */
export function survivalUnlocked(p: Progression): boolean {
  return p.data.unlockedZones > 1 || p.zoneRecord(ZONES[0].id).cleared;
}

export function survivalBest(p: Progression): number {
  return p.data.survivalBestWave ?? 0;
}

/** What a Daily modifier does to the run's bots and arena (NEUTRAL = normal Survival). */
interface ModEffect {
  /** Multipliers on the per-wave bot hp / bot damage / kill + wave coins. */
  hp: number;
  dmg: number;
  coins: number;
  /** Minion spawn budget multiplier and bot cap per wave. */
  budget: number;
  maxBots: number;
  bossEvery: number;
  /** Extra pool weight per minion type, and minion types allowed from wave 1. */
  weights: Partial<Record<EnemyType, number>>;
  early: EnemyType[];
  /** Zone overrides (snow, fog, sky). */
  zone: Partial<ZoneDef>;
}

const NEUTRAL: ModEffect = { hp: 1, dmg: 1, coins: 1, budget: 1, maxBots: MAX_WAVE_BOTS, bossEvery: BOSS_EVERY, weights: {}, early: [], zone: {} };

/** Bot / arena side of each Daily modifier (the player side lives in adjustStats). */
function modEffect(id: DailyModifierId | null, base: ZoneDef): ModEffect {
  switch (id) {
    case 'deepSnow':
      return { ...NEUTRAL, zone: { snowDepth: base.snowDepth * 1.9, snowRegenMult: base.snowRegenMult * 2.5, snowfall: 0.5 } };
    case 'swarm':
      return { ...NEUTRAL, hp: 0.6, coins: 0.7, budget: 1.8, maxBots: 34 };
    case 'thiefNight':
      return { ...NEUTRAL, weights: { thief: 4 }, early: ['thief'] };
    case 'bossRush':
      return { ...NEUTRAL, bossEvery: 3 };
    case 'whiteout':
      return {
        ...NEUTRAL,
        zone: { fogNear: 14, fogFar: 62, snowfall: 1, fogColor: 0xe4ecf2, skyTop: 0x9fb0bd, skyBottom: 0xe8eef2, sunIntensity: base.sunIntensity * 0.7 },
      };
    case 'heavyHitters':
      return { ...NEUTRAL, dmg: 1.4, coins: 1.5 };
    default:
      return NEUTRAL;
  }
}

/** Glass Cannon: player damage x1.5, max HP x0.6. Overclocked: cooldowns x0.7 (still floored at MIN_COOLDOWN). */
export const GLASS_DMG = 1.5;
export const GLASS_HP = 0.6;
export const OVERCLOCK_CD = 0.7;

/** Zone fields Environment.setZone reads; a change needs a world re-dress. */
const VISUAL_KEYS = ['fogNear', 'fogFar', 'fogColor', 'skyTop', 'skyBottom', 'sunIntensity', 'snowfall'] as const;

export class SurvivalManager {
  private ctx: GameContext;
  /** The survival arena: Frozen Foundry scenery, rounds/multipliers rewritten every wave. */
  readonly zone: ZoneDef;
  /** Current wave, 1-based (0 before the first wave). */
  wave = 0;
  /** Waves fully cleared this run. */
  cleared = 0;
  /** Today's Daily spec while this run is the Daily (seeded waves + modifier), else null. */
  daily: DailySpec | null = null;
  /** Best wave at the start of this run (for "NEW BEST" checks): that day's Daily best on a Daily run. */
  private prevBest = 0;
  /** Wave-generation rng: seeded on the Daily, Math.random otherwise. */
  private rng: () => number = Math.random;
  /** Rotates which special wave comes when (rolled per run; seeded on the Daily). */
  private specialOffset = 0;
  private fx: ModEffect = NEUTRAL;
  /** Pristine survival arena; every reset copies it back onto `zone` before applying a modifier. */
  private readonly base: ZoneDef;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    const base = ZONES[2];
    this.base = {
      ...base,
      id: 'survival',
      name: `Survival · ${base.name}`,
      tagline: 'Endless waves. Bosses every 5. How long can you last?',
      bossName: '',
      rounds: [{ groups: [] }],
      clearReward: 0,
      enemyHpMult: 1,
      coinMult: 1,
      enemyDmgMult: 1,
    };
    this.zone = { ...this.base, rounds: [{ groups: [] }] };
  }

  /** Daily modifiers that touch the player (Glass Cannon, Overclocked). Called by Game after every computeStats. */
  adjustStats(stats: PlayerStats): void {
    const id = this.daily?.modifierId;
    if (id === 'glassCannon') {
      stats.maxHp *= GLASS_HP;
      stats.damageMult *= GLASS_DMG;
      stats.ramDamage *= GLASS_DMG;
      stats.whirlDamage *= GLASS_DMG;
      stats.flameDps *= GLASS_DMG;
      stats.clapDamage *= GLASS_DMG;
      stats.poundDamage *= GLASS_DMG;
      stats.fieldDps *= GLASS_DMG;
      stats.sawDps *= GLASS_DMG;
    } else if (id === 'overclocked') {
      // The listed cooldowns already include Overclock; the slam cooldown reads cooldownMult in Plow.
      stats.dashCooldown = cooldown(stats.dashCooldown, OVERCLOCK_CD);
      stats.whirlCooldown = cooldown(stats.whirlCooldown, OVERCLOCK_CD);
      stats.flameCooldown = cooldown(stats.flameCooldown, OVERCLOCK_CD);
      stats.clapCooldown = cooldown(stats.clapCooldown, OVERCLOCK_CD);
      stats.poundCooldown = cooldown(stats.poundCooldown, OVERCLOCK_CD);
      stats.cooldownMult *= OVERCLOCK_CD;
    }
  }

  /** Fresh run; `daily` makes it that day's Daily. */
  reset(daily: DailySpec | null = null): void {
    const { ctx } = this;
    this.daily = daily;
    setActiveDaily(daily);
    this.wave = 0;
    this.cleared = 0;
    this.rng = daily ? mulberry32(daily.seed) : Math.random;
    this.specialOffset = Math.floor(this.rng() * SPECIAL_WAVES.length);
    const mod = daily ? dailyModifier(daily) : null;
    this.fx = modEffect(mod?.id ?? null, this.base);
    this.prevBest = daily ? dailyBest(ctx.progression, daily.key) : survivalBest(ctx.progression);

    // Rebuild the zone from the base arena, then layer the modifier on top.
    const z = this.zone;
    const before = VISUAL_KEYS.map((k) => z[k]);
    Object.assign(z, this.base, { rounds: [{ groups: [] }] }, this.fx.zone);
    if (mod) {
      z.name = `DAILY · ${mod.name}`;
      z.tagline = mod.desc;
    }
    // Game's setMode only re-dresses the world on a mode change (with the previous run's values), so a
    // fog / sky / snowfall change has to be pushed here.
    if (ctx.zone === z && VISUAL_KEYS.some((k, i) => z[k] !== before[i])) ctx.world?.setZone(z);
    if (mod) ctx.ui?.toast(`${mod.icon} ${mod.name}: ${mod.desc}`, 'info');
  }

  /** Big start-of-run toast: 'SURVIVAL', or 'DAILY · DEEP SNOW'. */
  get title(): string {
    return this.daily ? `DAILY · ${dailyModifier(this.daily).name.toUpperCase()}` : 'SURVIVAL';
  }

  /** Waves per boss (Boss Rush shortens it). */
  get bossEvery(): number {
    return this.fx.bossEvery;
  }

  get isBossWave(): boolean {
    return this.wave > 0 && this.wave % this.bossEvery === 0;
  }

  /** Boss lineup of the current wave (empty on minion waves). */
  get boss(): { types: EnemyType[]; name: string } | null {
    if (!this.isBossWave) return null;
    return BOSS_CYCLE[(this.wave / this.bossEvery - 1) % BOSS_CYCLE.length];
  }

  /** Special wave w is, if any: waves 3, 6, 8, 11, 13, ... (2 per 5-wave boss cycle, never a boss wave). */
  specialFor(w: number): SpecialWave | null {
    if (w < 3 || w % this.bossEvery === 0) return null;
    const k = w % 5;
    if (k !== 3 && !(k === 1 && w > 5)) return null;
    const pool = SPECIAL_WAVES.filter((sw) => w >= sw.from);
    const slot = Math.floor(w / 5) * 2 + (k === 3 ? 1 : 0);
    return pool[(slot + this.specialOffset) % pool.length];
  }

  /** Special wave being played right now (null on normal and boss waves). */
  get special(): SpecialWave | null {
    return this.specialFor(this.wave);
  }

  /** Coin multiplier on top of the wave scaling: the Daily bonus times the modifier's. */
  get coinBonus(): number {
    return this.daily ? DAILY_COIN_MULT * this.fx.coins : 1;
  }

  /** Advance to the next wave: generate its round and apply scaling. Returns the breather length. */
  nextWave(): number {
    const w = ++this.wave;
    const z = this.zone;
    const sp = this.special;
    z.enemyHpMult = waveHpMult(w) * this.fx.hp * (sp?.hp ?? 1);
    z.enemyDmgMult = waveDmgMult(w) * this.fx.dmg;
    z.coinMult = waveCoinMult(w) * this.coinBonus * (sp?.coins ?? 1);
    const round: RoundDef = this.isBossWave ? this.bossRound(w) : sp ? this.specialRound(w, sp) : this.minionRound(w);
    z.rounds[0] = round;
    z.bossName = this.boss?.name ?? '';
    if (w === 1) return FIRST_WAVE_SECONDS;
    return this.isBossWave ? BOSS_BREATHER_SECONDS : BREATHER_SECONDS;
  }

  /** Wave cleared: pay the bonus, patch the plow up a bit. Returns the bonus. */
  waveCleared(): number {
    const { ctx } = this;
    this.cleared = this.wave;
    const bonus = Math.round(waveClearBonus(this.wave, this.bossEvery) * this.coinBonus);
    ctx.progression.addCoins(bonus);
    const plow = ctx.plow;
    plow.hp = Math.min(plow.maxHp, plow.hp + ctx.stats.repairFraction * WAVE_REPAIR * plow.maxHp);
    return bonus;
  }

  /** Run over: persist the best wave (that day's Daily best on a Daily run, else the Survival best; never
   *  both) + kills. Returns true on a new record for that best. */
  finish(kills: number): boolean {
    const p = this.ctx.progression;
    let newBest: boolean;
    if (this.daily) newBest = recordDaily(p, this.daily.key, this.wave);
    else {
      newBest = this.wave > this.prevBest;
      if (newBest) p.data.survivalBestWave = this.wave;
    }
    p.data.totalKills += kills;
    p.commit();
    return newBest;
  }

  /** Lineup name of wave w if it's a boss wave (for the between-wave shop's preview), else null. */
  bossNameFor(w: number): string | null {
    const every = this.bossEvery;
    if (w <= 0 || w % every !== 0) return null;
    return BOSS_CYCLE[(w / every - 1) % BOSS_CYCLE.length].name;
  }

  get best(): number {
    return Math.max(this.prevBest, this.wave);
  }

  hud(): { wave: number; best: number } {
    return { wave: this.wave, best: this.best };
  }

  /* ------------------------------------------------------------------ wave generation */

  /** Budget-based mix of the unlocked minion types; faster spawn pacing as waves climb. */
  private minionRound(w: number): RoundDef {
    const fx = this.fx;
    let budget = (3 + w * 2.2) * fx.budget;
    // Weighted pool: each unlocked type once, plus the modifier's extra weight (Thief Night stacks thieves).
    const pool: typeof MINIONS = [];
    for (const m of MINIONS) {
      if (w < m.from && !fx.early.includes(m.type)) continue;
      for (let i = 0; i <= (fx.weights[m.type] ?? 0); i++) pool.push(m);
    }
    const counts = new Map<EnemyType, number>();
    let n = 0;
    // Always lead with a couple of scrappers so every wave opens with something to hit.
    const lead = Math.min(2 + Math.floor(w / 4), 5);
    counts.set('scrapper', lead);
    budget -= lead;
    n += lead;
    while (budget >= 1 && n < fx.maxBots) {
      const m = pool[Math.floor(this.rng() * pool.length)];
      if (m.cost > budget) {
        budget -= 0.5; // can't afford it: burn a bit so the loop always ends
        continue;
      }
      counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
      budget -= m.cost;
      n++;
    }
    const pace = Math.max(0.55, 2.4 - w * 0.08) / Math.sqrt(fx.budget);
    const groups: SpawnGroup[] = [];
    let delay = 0;
    for (const [type, count] of counts) {
      const interval = pace * (ENEMIES[type].radius > 1.2 ? 1.6 : 1);
      groups.push({ type, count, delay, interval });
      delay += Math.min(8, count * interval * 0.5) + 1;
    }
    return { groups };
  }

  /** Lineup for a special wave (budget scales with w like normal waves). */
  private specialRound(w: number, sp: SpecialWave): RoundDef {
    const fx = this.fx;
    const budget = (3 + w * 2.2) * fx.budget;
    const cap = fx.maxBots;
    const pace = Math.max(0.55, 2.4 - w * 0.08) / Math.sqrt(fx.budget);
    const n = (cost: number, mult = 1) => Math.max(2, Math.min(cap, Math.round((budget / cost) * mult)));
    switch (sp.id) {
      case 'swarm':
        return { groups: [{ type: 'scrapper', count: Math.max(8, Math.min(cap + 10, Math.round(budget * 2.2))), delay: 0.5, interval: pace * 0.3 }] };
      case 'thiefRaid':
        return { groups: [
          { type: 'thief', count: n(1.4, 0.85), delay: 0.5, interval: pace * 0.6 },
          { type: 'scrapper', count: 2, delay: 0, interval: 1 },
        ] };
      case 'sawStorm':
        return { groups: [{ type: 'spinner', count: n(2, 0.9), delay: 0.5, interval: pace * 0.8 }] };
      case 'heavyMetal':
        return { groups: [{ type: 'brute', count: n(3, 0.85), delay: 0.5, interval: pace * 1.4 }] };
      case 'elite': {
        const k = Math.max(3, Math.round(n(1.8) * 0.4));
        return { groups: [
          { type: 'brute', count: Math.ceil(k / 3), delay: 0.5, interval: 2 },
          { type: 'spinner', count: Math.ceil(k / 3), delay: 1.5, interval: 2 },
          { type: 'scrapper', count: Math.ceil(k / 3), delay: 2.5, interval: 1.5 },
        ] };
      }
      case 'blitz': {
        const r = this.minionRound(w);
        for (const g of r.groups) {
          g.delay = 0.3;
          g.interval = 0.12;
        }
        return r;
      }
    }
  }

  /** The cycle's boss(es); from the second lap on, escort minions join after a short delay. */
  private bossRound(w: number): RoundDef {
    const b = this.boss!;
    const groups: SpawnGroup[] = b.types.map((type, i) => ({ type, count: 1, delay: 1 + i * 0.5, interval: 1 }));
    const lap = Math.floor((w / this.bossEvery - 1) / BOSS_CYCLE.length);
    if (lap > 0) {
      groups.push({ type: 'scrapper', count: 2 + lap * 2, delay: 6, interval: 1.5 });
      if (lap > 1) groups.push({ type: 'spinner', count: lap, delay: 12, interval: 3 });
    }
    return { boss: true, groups };
  }
}
