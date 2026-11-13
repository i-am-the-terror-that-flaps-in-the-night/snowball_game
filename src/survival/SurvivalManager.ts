import type { GameContext, ZoneDef } from '../core/types';
import type { Progression } from '../core/Progression';
import type { BiomeKey, RoundDef, SpawnGroup } from '../config/zones';
import { BIOME_ZONE, ZONES, zoneLook } from '../config/zones';
import { ENEMIES, type EnemyType } from '../config/enemies';
import type { PlayerStats } from '../core/types';
import { PLOWS, type PlowKind } from '../config/plows';
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
 * survivalBestWave. Every reset rebuilds the zone from the base arena, so nothing leaks between runs.
 *
 * BIOMES: the arena is a neutral base zone (SURVIVAL_BASE) dressed as one campaign biome per BIOME_EVERY waves
 * (look, particles, ground terrain; never decks). Survival starts on the glacier; the Daily starts where its seed says.
 * The switch happens when a boss block is cleared (waveCleared), during the pit stop: the world is re-dressed, the
 * snow refilled and the plow moved back to the spawn.
 *
 * WAVE MODIFIERS: from MODIFIER_FROM, every MODIFIER_EVERY-th wave that isn't a boss or milestone wave rolls one
 * announced twist from WAVE_MODIFIERS (Blizzard, Overdrive, Gold Rush, Armored, Horde, Frenzy). They stack on a special
 * wave unless the pair would double up (notWith). The pick is a pure function of the wave and a per-run offset (from
 * the seed on the Daily), so the pit stop can preview it and the Daily stays the same for everyone.
 *
 * MILESTONES: every MILESTONE_EVERY-th wave a scaled-down campaign boss (MINI_BOSSES) joins the lineup as a mini-boss
 * (only while the lineup has fewer than 2 bosses: the HUD has two boss bars). Clearing it pays milestoneCoins, a
 * MILESTONE_HEAL repair and (Game) a guaranteed 'survivalMilestone' gear roll, with a longer breather after.
 *
 * PLOW RECORDS: finish() also keeps the best wave per plow (save.survivalBestByPlow; normal runs only). */

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
/** Hard ceiling on a Horde wave's raised bot cap (a Daily Swarm under a Horde would otherwise reach 68). */
const HORDE_MAX_BOTS = 2 * MAX_WAVE_BOTS;

/** The minion pool of normal (and Blitz) waves: spawn-budget cost + first wave each type may appear in. A new bot type
 *  joins Survival with one line here (cost ~ how many scrappers it is worth). Specials and boss escorts keep their own
 *  themed lineups. */
export const SURVIVAL_MINIONS: readonly { type: EnemyType; cost: number; from: number }[] = [
  { type: 'scrapper', cost: 1, from: 1 },
  { type: 'thief', cost: 1.4, from: 2 },
  { type: 'spinner', cost: 2, from: 3 },
  { type: 'brute', cost: 3, from: 4 },
];

/** Boss cycle (one entry per boss wave); twins come as a pair. Ordered like the campaign, so the first laps meet
 *  each boss in its own biome (FROSTBYTE on the glacier at wave 5, BULLDOZA in the quarry at 10, ...). */
const BOSS_CYCLE: { types: EnemyType[]; name: string }[] = [
  { types: ['frostbyte'], name: 'FROSTBYTE' },
  { types: ['bulldoza'], name: 'BULLDOZA' },
  { types: ['grinder'], name: 'THE GRINDER' },
  { types: ['slush', 'sleet'], name: 'SLUSH & SLEET' },
  { types: ['donald'], name: 'THE DONALD' },
  { types: ['omega'], name: 'MEGAPLOW Ω' },
];

/** Waves per biome. */
export const BIOME_EVERY = 5;
/** Biome rotation (campaign order). */
export const SURVIVAL_BIOMES: readonly Exclude<BiomeKey, 'snowdome'>[] = ['glacier', 'quarry', 'mars', 'divide', 'plaza'];

/** The neutral Survival / Daily arena: an explicit field list (never a spread of a campaign arena, so no biome, terrain or
 *  gravity leaks in by accident); the biome rotation dresses it. `index` keeps the old Survival prop / snow seed. */
export const SURVIVAL_BASE: ZoneDef = {
  index: 2, id: 'survival', name: 'Survival', tagline: 'Endless waves. Bosses every 5. How long can you last?', bossName: '',
  rounds: [{ groups: [] }], enemyHpMult: 1, enemyDmgMult: 1, enemySpeedMult: 1, coinMult: 1, snowDepth: 0.5, snowRegenMult: 1, clearReward: 0,
  skyTop: 0x4f8fd6, skyBottom: 0xdcefff, fogColor: 0xd6e9fb, fogNear: 55, fogFar: 165,
  sunColor: 0xfff1d6, sunIntensity: 2.5, ambientColor: 0xbcd7ff, ambientIntensity: 0.9, snowTint: 0xffffff, snowfall: 0.3,
  terrain: undefined, theme: 'lake',
};

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

/** A wave modifier: one announced twist on a whole wave (banner at the countdown, HUD tag while it lasts). */
export interface WaveModifier {
  id: 'blizzard' | 'overdrive' | 'goldRush' | 'armored' | 'horde' | 'frenzy';
  name: string;
  icon: string;
  blurb: string;
  /** First wave it may roll on. */
  from: number;
  /** Multipliers on the wave's bot hp, bot hit damage, coins (kill coins and the wave bonus) and bot drive speed. */
  hp: number;
  dmg: number;
  coins: number;
  speed: number;
  /** Multiplier on the minion spawn budget and the bot cap (Horde). */
  budget: number;
  /** Multiplier on every spawn delay and interval (Frenzy < 1: the wave pours in). */
  pace: number;
  /** Whiteout gale over the arena (WorldAPI.setStorm). */
  storm?: boolean;
  /** Special waves it never rides on (it would double up or cancel out). */
  notWith?: readonly SpecialWave['id'][];
}

const MOD_DEFAULTS = { hp: 1, dmg: 1, coins: 1, speed: 1, budget: 1, pace: 1 } as const;

/** The wave modifier table (rotated by waveModifierFor). Coins pay for the extra trouble. */
export const WAVE_MODIFIERS: readonly WaveModifier[] = [
  { ...MOD_DEFAULTS, id: 'blizzard', name: 'BLIZZARD', icon: '🌨️', blurb: 'Whiteout! You can barely see, but the bots slog through it too.', from: 7, speed: 0.85, coins: 1.2, storm: true },
  { ...MOD_DEFAULTS, id: 'overdrive', name: 'OVERDRIVE', icon: '⏩', blurb: 'Bots run 25% faster.', from: 7, speed: 1.25, coins: 1.25 },
  { ...MOD_DEFAULTS, id: 'goldRush', name: 'GOLD RUSH', icon: '💰', blurb: 'Double coins for every kill and the wave bonus.', from: 7, coins: 2 },
  { ...MOD_DEFAULTS, id: 'armored', name: 'ARMORED', icon: '🔩', blurb: 'Armor-plated bots: +50% HP.', from: 10, hp: 1.5, coins: 1.35 },
  { ...MOD_DEFAULTS, id: 'horde', name: 'HORDE', icon: '🐜', blurb: 'Twice the bots at half the HP.', from: 13, budget: 2, hp: 0.5, coins: 0.65, notWith: ['swarm', 'elite'] },
  { ...MOD_DEFAULTS, id: 'frenzy', name: 'FRENZY', icon: '😡', blurb: 'They pour in twice as fast and hit 20% harder.', from: 13, pace: 0.5, dmg: 1.2, coins: 1.3, notWith: ['blitz'] },
];

/** First wave a modifier may roll on, then every MODIFIER_EVERY-th wave (boss and milestone waves skip theirs). */
export const MODIFIER_FROM = 7;
export const MODIFIER_EVERY = 3;
/** Every Nth wave is a milestone: mini-boss, reward, repair. */
export const MILESTONE_EVERY = 10;
/** Mini-bosses a milestone draws from (single-chassis campaign bosses, rotated per milestone). */
export const MINI_BOSSES: readonly EnemyType[] = ['frostbyte', 'bulldoza', 'grinder'];
/** Mini-boss hp as a share of a full boss at that wave (zone.enemyHpMult applies on top). */
export const MINIBOSS_HP = 0.45;
/** The mini-boss rolls in this long after the wave starts (the main lineup gets the stage first). */
const MINIBOSS_DELAY = 8;
/** Share of max HP repaired after a milestone (on top of the per-wave patch-up). */
export const MILESTONE_HEAL = 0.4;
/** Breather into the wave after a milestone. */
export const MILESTONE_BREATHER_SECONDS = 8;

export const isMilestone = (w: number) => w > 0 && w % MILESTONE_EVERY === 0;
/** Milestone coins for clearing wave w (before the Daily bonus). */
export const milestoneCoins = (w: number) => Math.round(150 + 15 * w);

/** Whether wave w rolls a modifier: MODIFIER_FROM, then every MODIFIER_EVERY-th wave, never a boss or milestone wave. */
export function isModifierWave(w: number, bossEvery = BOSS_EVERY): boolean {
  return w >= MODIFIER_FROM && (w - MODIFIER_FROM) % MODIFIER_EVERY === 0 && w % bossEvery !== 0 && !isMilestone(w);
}

/** The modifier of wave w (null if none): the eligible table entries rotated by the run's `offset`, one step per
 *  modifier slot. Pure, so the pit stop previews exactly what nextWave plays and the Daily is the same for everyone. */
export function waveModifierFor(w: number, offset: number, bossEvery = BOSS_EVERY, special: SpecialWave['id'] | null = null): WaveModifier | null {
  if (!isModifierWave(w, bossEvery)) return null;
  const pool = WAVE_MODIFIERS.filter((m) => w >= m.from && !(special && m.notWith?.includes(special)));
  if (!pool.length) return null;
  const slot = Math.floor((w - MODIFIER_FROM) / MODIFIER_EVERY);
  return pool[(slot + offset) % pool.length];
}

/** The mini-boss joining milestone wave w beside `lineup` (the wave's own bosses), or null: none off a milestone, and
 *  none when the lineup already has 2 bosses (twins). Never a copy of a boss already in the lineup. */
export function miniBossFor(w: number, lineup: readonly EnemyType[]): EnemyType | null {
  if (!isMilestone(w) || lineup.length >= 2) return null;
  const pool = MINI_BOSSES.filter((t) => !lineup.includes(t));
  return pool.length ? pool[(w / MILESTONE_EVERY - 1) % pool.length] : null;
}

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

/** Best normal-Survival wave reached with this plow (0 = never). */
export function survivalBestFor(p: Progression, plow: PlowKind): number {
  return p.data.survivalBestByPlow?.[plow] ?? 0;
}

/** Record a normal-Survival wave for a plow; true on a new record for that plow. Does not commit. */
export function recordSurvivalPlow(p: Progression, plow: PlowKind, wave: number): boolean {
  if (!PLOWS[plow] || wave <= survivalBestFor(p, plow)) return false;
  (p.data.survivalBestByPlow ??= {})[plow] = wave;
  return true;
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
const VISUAL_KEYS = ['biome', 'terrain', 'fogNear', 'fogFar', 'fogColor', 'skyTop', 'skyBottom', 'sunIntensity', 'snowfall'] as const;

export class SurvivalManager {
  private ctx: GameContext;
  /** The survival arena (SURVIVAL_BASE dressed by the current biome), rounds/multipliers rewritten every wave. */
  readonly zone: ZoneDef;
  /** Biome currently dressing the arena. */
  biome: Exclude<BiomeKey, 'snowdome'> = SURVIVAL_BIOMES[0];
  /** Rotation start (0 = glacier on a normal run; seeded on the Daily). */
  private biomeOffset = 0;
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
  /** Rotates which wave modifier comes when (rolled per run; from the seed on the Daily, so no rng draw). */
  private modOffset = 0;
  /** Wave modifier of the current wave (null: none, or the wave is cleared). */
  modifier: WaveModifier | null = null;
  /** Mini-boss of the current wave (milestones only). */
  miniBoss: EnemyType | null = null;
  /** Reward of the milestone just cleared (set by waveCleared, null otherwise). */
  milestone: { wave: number; coins: number; healed: number } | null = null;
  /** The run's plow record after finish() (normal runs): best wave with the selected plow and whether this run set it. */
  plowRecord: { plow: PlowKind; best: number; newBest: boolean } | null = null;
  /** Blizzard gale currently pushed to the world. */
  private stormOn = false;
  /** HUD tag of the live wave: its modifier, else the milestone marker ('' at the pit stop and on plain waves).
   *  Built once per wave (nextWave), not per frame. */
  tag = '';
  /** Pristine survival arena; every reset copies it back onto `zone` before applying a modifier. */
  private readonly base: ZoneDef;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.base = { ...SURVIVAL_BASE, rounds: [{ groups: [] }] };
    this.zone = { ...this.base, rounds: [{ groups: [] }] };
    this.dress(SURVIVAL_BIOMES[0]);
  }

  /** Biome of wave w (1-based) for this run. */
  biomeFor(w: number): Exclude<BiomeKey, 'snowdome'> {
    const block = Math.floor((Math.max(1, w) - 1) / BIOME_EVERY);
    return SURVIVAL_BIOMES[(this.biomeOffset + block) % SURVIVAL_BIOMES.length];
  }

  /** Write a biome's look + ground terrain onto the zone, then the Daily modifier's overrides on top. */
  private dress(key: Exclude<BiomeKey, 'snowdome'>): void {
    const src = BIOME_ZONE[key];
    this.biome = key;
    Object.assign(this.zone, zoneLook(src), { biome: src.biome, terrain: src.terrain }, this.fx.zone);
    const mod = this.daily ? dailyModifier(this.daily) : null;
    this.zone.name = mod ? `DAILY · ${mod.name}` : `Survival · ${src.name}`;
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
    // Not from this.rng: the Daily's wave lineups stay what they were before modifiers existed.
    this.modOffset = daily ? (daily.seed >>> 4) % WAVE_MODIFIERS.length : Math.floor(Math.random() * WAVE_MODIFIERS.length);
    this.modifier = null;
    this.miniBoss = null;
    this.milestone = null;
    this.plowRecord = null;
    this.tag = '';
    const mod = daily ? dailyModifier(daily) : null;
    this.fx = modEffect(mod?.id ?? null, this.base);
    this.prevBest = daily ? dailyBest(ctx.progression, daily.key) : survivalBest(ctx.progression);

    // Rebuild the zone from the base arena, dress it as the run's first biome, then layer the modifier on top.
    const z = this.zone;
    const before = VISUAL_KEYS.map((k) => z[k]);
    this.biomeOffset = daily ? daily.seed % SURVIVAL_BIOMES.length : 0;
    Object.assign(z, this.base, { rounds: [{ groups: [] }] }, this.fx.zone);
    this.dress(this.biomeFor(1));
    if (mod) z.tagline = mod.desc;
    // Game's setMode only re-dresses the world on a mode change (with the previous run's values), so a
    // biome / fog / sky / snowfall change has to be pushed here.
    if (ctx.zone === z && VISUAL_KEYS.some((k, i) => z[k] !== before[i])) ctx.world?.setZone(z);
    this.setStorm(false); // the last run may have ended in a Blizzard wave
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
    return this.bossFor(this.wave);
  }

  /** Boss lineup of wave w (null off the boss cadence). */
  bossFor(w: number): { types: EnemyType[]; name: string } | null {
    const every = this.bossEvery;
    if (w <= 0 || w % every !== 0) return null;
    return BOSS_CYCLE[(w / every - 1) % BOSS_CYCLE.length];
  }

  /** Mini-boss joining wave w (milestones without a twin lineup; the pit stop's preview, nextWave plays the same). */
  miniBossAt(w: number): EnemyType | null {
    return miniBossFor(w, this.bossFor(w)?.types ?? []);
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

  /** Wave modifier wave w rolls (the pit stop's preview; nextWave plays the same). */
  modifierFor(w: number): WaveModifier | null {
    return waveModifierFor(w, this.modOffset, this.bossEvery, this.specialFor(w)?.id ?? null);
  }

  /** Bosses in the current wave's lineup: the cycle's boss(es) plus the milestone mini-boss (for the intro card). */
  get lineupBosses(): EnemyType[] {
    const types = this.boss ? [...this.boss.types] : [];
    if (this.miniBoss) types.push(this.miniBoss);
    return types;
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
    const mod = (this.modifier = this.modifierFor(w));
    this.milestone = null;
    z.enemyHpMult = waveHpMult(w) * this.fx.hp * (sp?.hp ?? 1) * (mod?.hp ?? 1);
    z.enemyDmgMult = waveDmgMult(w) * this.fx.dmg * (mod?.dmg ?? 1);
    z.enemySpeedMult = mod?.speed ?? 1;
    z.coinMult = waveCoinMult(w) * this.coinBonus * (sp?.coins ?? 1) * (mod?.coins ?? 1);
    const round: RoundDef = this.isBossWave ? this.bossRound(w) : sp ? this.specialRound(w, sp) : this.minionRound(w);
    if (mod && mod.pace !== 1) {
      for (const g of round.groups) {
        g.delay *= mod.pace;
        g.interval *= mod.pace;
      }
    }
    // Milestone: a scaled-down boss rolls in a few seconds after the main lineup (the round becomes a boss round).
    const mini = (this.miniBoss = this.miniBossAt(w));
    if (mini) {
      round.groups.push({ type: mini, count: 1, delay: MINIBOSS_DELAY, interval: 1, hpMult: MINIBOSS_HP });
      round.boss = true;
    }
    z.rounds[0] = round;
    z.bossName = this.boss?.name ?? (mini ? ENEMIES[mini].name : '');
    this.setStorm(!!mod?.storm);
    this.tag = mod ? `${mod.icon} ${mod.name}` : isMilestone(w) ? '🏆 MILESTONE' : '';
    if (w === 1) return FIRST_WAVE_SECONDS;
    if (isMilestone(w - 1)) return MILESTONE_BREATHER_SECONDS;
    return this.isBossWave ? BOSS_BREATHER_SECONDS : BREATHER_SECONDS;
  }

  /** Wave cleared: pay the bonus (times the wave modifier's coins), patch the plow up a bit; a milestone also pays
   *  milestoneCoins and repairs MILESTONE_HEAL (see `milestone`). Returns the wave bonus. */
  waveCleared(): number {
    const { ctx } = this;
    const w = (this.cleared = this.wave);
    const bonus = Math.round(waveClearBonus(w, this.bossEvery) * this.coinBonus * (this.modifier?.coins ?? 1));
    ctx.progression.addCoins(bonus);
    const plow = ctx.plow;
    const hp0 = plow.hp;
    plow.hp = Math.min(plow.maxHp, plow.hp + ctx.stats.repairFraction * WAVE_REPAIR * plow.maxHp);
    if (isMilestone(w)) {
      const coins = Math.round(milestoneCoins(w) * this.coinBonus);
      ctx.progression.addCoins(coins);
      plow.hp = Math.min(plow.maxHp, plow.hp + MILESTONE_HEAL * plow.maxHp);
      this.milestone = { wave: w, coins, healed: Math.max(0, plow.hp - hp0) };
    }
    this.modifier = null;
    this.miniBoss = null;
    this.tag = '';
    this.setStorm(false);
    const next = this.biomeFor(this.wave + 1);
    if (next !== this.biome) this.switchBiome(next);
    return bonus;
  }

  /** Push the Blizzard gale on / off (only while this arena is the one on screen). */
  private setStorm(on: boolean): void {
    if (on === this.stormOn) return;
    this.stormOn = on;
    if (this.ctx.zone === this.zone) this.ctx.world?.setStorm?.(on);
  }

  /** Mid-run biome change (between blocks): re-dress the world, refill the snow, park the plow on the spawn. */
  private switchBiome(key: Exclude<BiomeKey, 'snowdome'>): void {
    const { ctx } = this;
    this.dress(key);
    if (ctx.zone !== this.zone) return;
    ctx.world?.setZone(this.zone);
    ctx.snow?.reset(this.zone);
    // Re-seat the plow on the new arena's spawn with the plow's own reset: height snapped to the new surface, not
    // airborne, no velocity, no lava burn (so the first tick of the next countdown fires no landing / burn). Only the
    // run's hp carries over (the held ball is dropped with the old arena's snow).
    const plow = ctx.plow;
    if (plow?.position) {
      const hp = plow.hp;
      plow.reset();
      plow.hp = Math.min(plow.maxHp, hp);
    }
    ctx.ui?.toast(`New arena: ${BIOME_ZONE[key].name}`, 'info');
  }

  /** Run over: persist the best wave (that day's Daily best on a Daily run, else the Survival best; never
   *  both) + kills. Returns true on a new record for that best. */
  finish(kills: number): boolean {
    const p = this.ctx.progression;
    let newBest: boolean;
    this.plowRecord = null;
    if (this.daily) newBest = recordDaily(p, this.daily.key, this.wave);
    else {
      newBest = this.wave > this.prevBest;
      if (newBest) p.data.survivalBestWave = this.wave;
      const plow = p.data.plow;
      const plowNew = recordSurvivalPlow(p, plow, this.wave);
      this.plowRecord = { plow, best: survivalBestFor(p, plow), newBest: plowNew };
    }
    this.setStorm(false);
    p.data.totalKills += kills;
    p.commit();
    return newBest;
  }

  /** Lineup name of wave w if it's a boss wave (for the between-wave shop's preview), else null. */
  bossNameFor(w: number): string | null {
    return this.bossFor(w)?.name ?? null;
  }

  get best(): number {
    return Math.max(this.prevBest, this.wave);
  }

  hud(): { wave: number; best: number; tag: string } {
    return { wave: this.wave, best: this.best, tag: this.tag };
  }

  /* ------------------------------------------------------------------ wave generation */

  /** Minion spawn budget multiplier: the Daily modifier's times the wave modifier's (Horde). */
  private get budgetK(): number {
    return this.fx.budget * (this.modifier?.budget ?? 1);
  }

  /** Bot cap of the wave (Horde raises it with its budget, up to HORDE_MAX_BOTS). */
  private get botCap(): number {
    const k = this.modifier?.budget ?? 1;
    return k > 1 ? Math.min(HORDE_MAX_BOTS, Math.round(this.fx.maxBots * k)) : this.fx.maxBots;
  }

  /** Budget-based mix of the unlocked minion types; faster spawn pacing as waves climb. */
  private minionRound(w: number): RoundDef {
    const fx = this.fx;
    const k = this.budgetK;
    let budget = (3 + w * 2.2) * k;
    // Weighted pool: each unlocked type once, plus the modifier's extra weight (Thief Night stacks thieves).
    const pool: (typeof SURVIVAL_MINIONS)[number][] = [];
    for (const m of SURVIVAL_MINIONS) {
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
    const cap = this.botCap;
    while (budget >= 1 && n < cap) {
      const m = pool[Math.floor(this.rng() * pool.length)];
      if (m.cost > budget) {
        budget -= 0.5; // can't afford it: burn a bit so the loop always ends
        continue;
      }
      counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
      budget -= m.cost;
      n++;
    }
    const pace = Math.max(0.55, 2.4 - w * 0.08) / Math.sqrt(k);
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
    const k = this.budgetK;
    const budget = (3 + w * 2.2) * k;
    const cap = this.botCap;
    const pace = Math.max(0.55, 2.4 - w * 0.08) / Math.sqrt(k);
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
