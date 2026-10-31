import type { Progression } from '../core/Progression';
import { totalStars } from '../meta/progress';
import { ZONES } from './zones';
import { BRAWL_BOTS } from './brawl';
import { ENEMIES, type EnemyType } from './enemies';
import type { PlowKind } from './plows';

/* Achievement definitions. Every achievement is "value(save) >= goal": event handlers in meta/achievements.ts
 * only bump lifetime counters (SaveData.lifetime, keys in LIFE below), and unlocks are re-evaluated straight
 * from the save, so retroactive unlocks (old saves, imports) and other features' fields just work. */

export type AchievementCategory = 'campaign' | 'combat' | 'bosses' | 'brawl' | 'survival' | 'plows' | 'collection';

export const ACHIEVEMENT_CATEGORIES: { id: AchievementCategory; label: string; icon: string }[] = [
  { id: 'campaign', label: 'Campaign', icon: '🏔️' },
  { id: 'combat', label: 'Combat', icon: '💥' },
  { id: 'bosses', label: 'Bosses', icon: '💀' },
  { id: 'brawl', label: 'Brawl', icon: '🔥' },
  { id: 'survival', label: 'Survival', icon: '♾' },
  { id: 'plows', label: 'Plows', icon: '🚜' },
  { id: 'collection', label: 'Garage & loot', icon: '🪙' },
];

/** Lifetime counter keys (SaveData.lifetime). Per-plow / per-boss keys are built with the helpers below. */
export const LIFE = {
  kills: 'kills',
  killsSlam: 'killsSlam',
  killsRam: 'killsRam',
  killsWhirl: 'killsWhirl',
  killsOther: 'killsOther',
  slams: 'slams',
  /** Most bots hit by one slam. */
  slamHitsBest: 'slamHitsBest',
  strikes: 'strikes',
  comboBest: 'comboBest',
  /** Biggest snowball, in centimetres (counters are whole numbers). */
  ballBestCm: 'ballBestCm',
  bossKills: 'bossKills',
  damageTaken: 'damageTaken',
  /** Seconds played (sum of runFinished durations). */
  playTime: 'playTime',
  runs: 'runs',
  campaignWins: 'campaignWins',
  /** Arena clears losing under CLEAN_CLEAR_HP. */
  cleanClears: 'cleanClears',
  brawlKills: 'brawlKills',
  brawlKillsZap: 'brawlKillsZap',
  brawlKillsPound: 'brawlKillsPound',
  brawlShutdowns: 'brawlShutdowns',
  brawlStreakBest: 'brawlStreakBest',
  brawlWinsLegend: 'brawlWinsLegend',
  brawlLast: 'brawlLast',
  dailyRuns: 'dailyRuns',
  dailyBestWave: 'dailyBestWave',
  /** Coins paid out by achievement rewards. */
  achievementCoins: 'achievementCoins',
} as const;

export const lifeRunsMode = (mode: 'campaign' | 'survival' | 'brawl') => `runs_${mode}`;
export const lifeRunsPlow = (plow: PlowKind) => `runsPlow_${plow}`;
export const lifeWinsPlow = (plow: PlowKind) => `winsPlow_${plow}`;
export const lifeBoss = (type: string) => `boss_${type}`;

/** "Not a Scratch": clear an arena losing less HP than this. */
export const CLEAN_CLEAR_HP = 50;

export interface AchievementDef {
  id: string;
  name: string;
  /** What to do (shown while locked too, unless secret). */
  desc: string;
  icon: string;
  category: AchievementCategory;
  /** Unlocks when value >= goal. Goals > 1 show a progress bar while locked. */
  goal: number;
  /** Coins paid on unlock (25 - 500 by difficulty). */
  reward: number;
  /** Current progress, read from the save (must tolerate missing / malformed fields). */
  value: (p: Progression) => number;
  /** Progress label formatter (default: thousands-separated integers). */
  fmt?: (v: number) => string;
  /** Hidden ("???") until unlocked. */
  secret?: boolean;
}

/* ------------------------------------------------------------------ save readers (defensive) */

const fin = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : 0);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A lifetime counter (0 if missing / malformed). */
export function life(p: Progression, key: string): number {
  const l = p.data.lifetime;
  return isObj(l) ? fin(l[key]) : 0;
}

export function arenasCleared(p: Progression): number {
  const zones = p.data.zones;
  if (!isObj(zones)) return 0;
  return ZONES.filter((z) => isObj(zones[z.id]) && (zones[z.id] as { cleared?: unknown }).cleared === true).length;
}

export function hardClears(p: Progression): number {
  const h = p.data.hardCleared;
  return isObj(h) ? ZONES.filter((z) => h[z.id] === true).length : 0;
}

export function stars(p: Progression): number {
  try {
    return fin(totalStars(p));
  } catch {
    return 0;
  }
}

/** Upgrade levels bought, summed over every upgrade. */
export function upgradeLevels(p: Progression): number {
  const u = p.data.upgrades;
  const g = p.data.gear?.owned;
  const sum = (o: unknown) => (isObj(o) ? Object.values(o).reduce<number>((s, v) => s + Math.max(0, fin(v)), 0) : 0);
  return sum(u) + sum(g);
}

export function cosmeticsOwned(p: Progression): number {
  const c = p.data.cosmetics;
  return isObj(c) && Array.isArray(c.owned) ? c.owned.length : 0;
}

/** Bots scrapped by finishing blow. Older saves only know the total, so unattributed kills count as 'other'. */
export function killsBySource(p: Progression): { slam: number; ram: number; whirl: number; other: number; total: number } {
  const slam = life(p, LIFE.killsSlam);
  const ram = life(p, LIFE.killsRam);
  const whirl = life(p, LIFE.killsWhirl);
  const total = Math.max(fin(p.data.totalKills), life(p, LIFE.kills));
  const other = Math.max(life(p, LIFE.killsOther), total - slam - ram - whirl);
  return { slam, ram, whirl, other, total: Math.max(total, slam + ram + whirl + other) };
}

export const brawlBestStreak = (p: Progression) => Math.max(fin(p.data.brawlBestStreak), life(p, LIFE.brawlStreakBest));
export const survivalBestWave = (p: Progression) => fin(p.data.survivalBestWave);

/** Best Daily wave: our counter, or the Daily feature's own per-day bests. */
export function dailyBestWave(p: Progression): number {
  const d = p.data.dailyBest;
  const days = isObj(d) ? Object.values(d).map(fin) : [];
  return Math.max(life(p, LIFE.dailyBestWave), ...days, 0);
}

const metres = (cm: number) => `${(cm / 100).toFixed(2)} m`;

/* ------------------------------------------------------------------ the list */

const bossName = (type: EnemyType) => ENEMIES[type].name;

const BOSS_ACH: [type: EnemyType, id: string, name: string, icon: string, reward: number][] = [
  ['bulldoza', 'boss_bulldoza', 'Dozer Down', '🚜', 50],
  ['frostbyte', 'boss_frostbyte', 'Ctrl+Alt+Defeat', '👾', 75],
  ['grinder', 'boss_grinder', 'Grind to a Halt', '🔩', 100],
];

export const ACHIEVEMENTS: AchievementDef[] = [
  // ---- Campaign
  { id: 'clear_first', name: 'Yard Work', desc: `Clear ${ZONES[0].name}.`, icon: '🏗️', category: 'campaign', goal: 1, reward: 50, value: (p) => arenasCleared(p) },
  { id: 'clear_all', name: 'Top of the World', desc: `Clear all ${ZONES.length} campaign arenas.`, icon: '🏔️', category: 'campaign', goal: ZONES.length, reward: 300, value: arenasCleared },
  { id: 'clean_clear', name: 'Not a Scratch', desc: `Clear an arena losing under ${CLEAN_CLEAR_HP} HP.`, icon: '✨', category: 'campaign', goal: 1, reward: 200, value: (p) => life(p, LIFE.cleanClears) },
  { id: 'hard_one', name: 'Hard Mode? Hard Yes.', desc: 'Clear any arena on Hard.', icon: '🌶️', category: 'campaign', goal: 1, reward: 150, value: hardClears },
  { id: 'hard_all', name: 'Glutton for Punishment', desc: `Clear all ${ZONES.length} arenas on Hard.`, icon: '☠️', category: 'campaign', goal: ZONES.length, reward: 500, value: hardClears },
  { id: 'stars_5', name: 'Gold Star Plower', desc: 'Earn 5 challenge stars.', icon: '⭐', category: 'campaign', goal: 5, reward: 100, value: stars },
  { id: 'stars_15', name: 'Constellation', desc: 'Earn 15 challenge stars.', icon: '🌟', category: 'campaign', goal: 15, reward: 250, value: stars },

  // ---- Combat
  { id: 'slam_5', name: 'Bowling Night', desc: 'Hit 5 bots with one slam.', icon: '🎳', category: 'combat', goal: 5, reward: 100, value: (p) => life(p, LIFE.slamHitsBest) },
  { id: 'slam_kills_100', name: 'Snow Way Out', desc: 'Scrap 100 bots with slams.', icon: '❄️', category: 'combat', goal: 100, reward: 75, value: (p) => life(p, LIFE.killsSlam) },
  { id: 'slam_kills_1000', name: "Slam Dunkin'", desc: 'Scrap 1,000 bots with slams.', icon: '🏀', category: 'combat', goal: 1000, reward: 300, value: (p) => life(p, LIFE.killsSlam) },
  { id: 'ram_kills_100', name: 'Road Rage', desc: 'Scrap 100 bots by ramming them.', icon: '🐏', category: 'combat', goal: 100, reward: 100, value: (p) => life(p, LIFE.killsRam) },
  { id: 'whirl_kills_100', name: 'Spin Cycle', desc: 'Scrap 100 bots with the whirlwind.', icon: '🌀', category: 'combat', goal: 100, reward: 100, value: (p) => life(p, LIFE.killsWhirl) },
  { id: 'strikes_25', name: 'Strike Zone', desc: 'Land 25 STRIKEs (3+ bots in one slam or whirl).', icon: '⚡', category: 'combat', goal: 25, reward: 100, value: (p) => life(p, LIFE.strikes) },
  { id: 'ball_150', name: 'Snow Globe', desc: 'Pack a 1.50 m snowball.', icon: '⚪', category: 'combat', goal: 150, reward: 50, value: (p) => life(p, LIFE.ballBestCm), fmt: metres },
  { id: 'ball_250', name: 'Avalanche Pending', desc: 'Pack a 2.50 m snowball.', icon: '🏔️', category: 'combat', goal: 250, reward: 250, value: (p) => life(p, LIFE.ballBestCm), fmt: metres },
  { id: 'combo_25', name: 'Combo Breaker', desc: 'Hit a x25 combo.', icon: '🔥', category: 'combat', goal: 25, reward: 100, value: (p) => life(p, LIFE.comboBest), fmt: (v) => `x${v}` },
  { id: 'combo_50', name: 'C-C-C-Combo!', desc: 'Hit a x50 combo.', icon: '🎆', category: 'combat', goal: 50, reward: 250, value: (p) => life(p, LIFE.comboBest), fmt: (v) => `x${v}` },

  // ---- Bosses (Survival bosses count too)
  ...BOSS_ACH.map(([type, id, name, icon, reward]): AchievementDef => ({
    id, name, icon, reward, desc: `Scrap ${bossName(type)}.`, category: 'bosses', goal: 1, value: (p) => life(p, lifeBoss(type)),
  })),
  { id: 'boss_twins', name: 'Sibling Rivalry', desc: 'Scrap both SLUSH and SLEET.', icon: '☯️', category: 'bosses', goal: 1, reward: 150, value: (p) => Math.min(life(p, lifeBoss('slush')), life(p, lifeBoss('sleet'))) },
  { id: 'boss_donald', name: "You're Fired!", desc: `Scrap ${bossName('donald')} at Golden Tower Plaza.`, icon: '🍊', category: 'bosses', goal: 1, reward: 300, value: (p) => life(p, lifeBoss('donald')) },
  { id: 'hard_donald', name: 'Hard Deal', desc: `Clear ${ZONES[5].name} on Hard.`, icon: '🏛️', category: 'campaign', goal: 1, reward: 400, value: (p) => (p.data.hardCleared?.[ZONES[5].id] === true ? 1 : 0) },
  { id: 'boss_omega', name: 'Ω-mega Ouch', desc: `Scrap ${bossName('omega')}, the final machine.`, icon: '💀', category: 'bosses', goal: 1, reward: 250, value: (p) => life(p, lifeBoss('omega')) },
  { id: 'boss_25', name: 'Boss Rush', desc: 'Scrap 25 bosses.', icon: '👑', category: 'bosses', goal: 25, reward: 300, value: (p) => life(p, LIFE.bossKills) },

  // ---- Brawl
  { id: 'brawl_win', name: 'Last Plow Standing', desc: 'Win a Brawl.', icon: '🥇', category: 'brawl', goal: 1, reward: 100, value: (p) => fin(p.data.brawlWins) },
  { id: 'brawl_legend', name: 'Legendary', desc: 'Win a Legend lobby Brawl.', icon: '🏆', category: 'brawl', goal: 1, reward: 500, value: (p) => life(p, LIFE.brawlWinsLegend) },
  { id: 'streak_8', name: 'Unstoppable', desc: 'Hit an 8-kill streak in Brawl.', icon: '📈', category: 'brawl', goal: 8, reward: 150, value: brawlBestStreak },
  { id: 'streak_12', name: 'Plownado', desc: 'Hit a 12-kill streak in Brawl.', icon: '🌪️', category: 'brawl', goal: 12, reward: 300, value: brawlBestStreak },
  { id: 'shutdowns_10', name: 'Buzzkill', desc: 'Shut down 10 kill streaks.', icon: '🛑', category: 'brawl', goal: 10, reward: 150, value: (p) => life(p, LIFE.brawlShutdowns) },
  { id: 'brawl_kills_100', name: 'Get Plowed', desc: 'Scrap 100 rivals in Brawl.', icon: '💢', category: 'brawl', goal: 100, reward: 150, value: (p) => life(p, LIFE.brawlKills) },
  { id: 'brawl_last', name: 'Participation Trophy', desc: `Finish dead last (#${BRAWL_BOTS + 1}) in a Brawl.`, icon: '🥄', category: 'brawl', goal: 1, reward: 25, value: (p) => life(p, LIFE.brawlLast), secret: true },

  // ---- Survival
  { id: 'wave_10', name: 'Snow Day', desc: 'Reach wave 10 in Survival.', icon: '🌨️', category: 'survival', goal: 10, reward: 75, value: survivalBestWave },
  { id: 'wave_25', name: 'Polar Vortex', desc: 'Reach wave 25 in Survival.', icon: '🧊', category: 'survival', goal: 25, reward: 250, value: survivalBestWave },
  { id: 'wave_50', name: 'Ice Age', desc: 'Reach wave 50 in Survival.', icon: '🦣', category: 'survival', goal: 50, reward: 500, value: survivalBestWave },
  { id: 'daily_1', name: 'Morning Shift', desc: 'Finish a Daily run.', icon: '📅', category: 'survival', goal: 1, reward: 50, value: (p) => life(p, LIFE.dailyRuns) },
  { id: 'daily_7', name: 'Daily Grind', desc: 'Finish 7 Daily runs.', icon: '☕', category: 'survival', goal: 7, reward: 200, value: (p) => life(p, LIFE.dailyRuns) },
  { id: 'daily_wave_15', name: 'Paper Route', desc: 'Reach wave 15 in a Daily run.', icon: '🗞️', category: 'survival', goal: 15, reward: 200, value: dailyBestWave },

  // ---- Plows
  { id: 'win_classic', name: 'Old Faithful', desc: 'Clear an arena with the Classic Plow.', icon: '🚜', category: 'plows', goal: 1, reward: 50, value: (p) => life(p, lifeWinsPlow('classic')) },
  { id: 'win_volt', name: "It's Electric", desc: 'Clear an arena with VOLT-9.', icon: '⚡', category: 'plows', goal: 1, reward: 75, value: (p) => life(p, lifeWinsPlow('volt')) },
  { id: 'win_brute', name: 'Rhino Charge', desc: 'Clear an arena with BRUTUS.', icon: '🦏', category: 'plows', goal: 1, reward: 75, value: (p) => life(p, lifeWinsPlow('brute')) },
  { id: 'win_isotope', name: 'Critical Mass', desc: 'Clear an arena with ISOTOPE.', icon: '☢️', category: 'plows', goal: 1, reward: 75, value: (p) => life(p, lifeWinsPlow('isotope')) },
  { id: 'zap_10', name: 'Shocking Behavior', desc: 'Scrap 10 Brawl rivals with lightning.', icon: '🌩️', category: 'plows', goal: 10, reward: 100, value: (p) => life(p, LIFE.brawlKillsZap) },
  { id: 'pound_10', name: 'Ground Control', desc: 'Scrap 10 Brawl rivals with Ground Pound.', icon: '🔨', category: 'plows', goal: 10, reward: 100, value: (p) => life(p, LIFE.brawlKillsPound) },

  // ---- Garage & loot
  { id: 'coins_10k', name: 'Loose Change', desc: 'Earn 10,000 coins.', icon: '💰', category: 'collection', goal: 10_000, reward: 100, value: (p) => fin(p.data.totalCoinsEarned) },
  { id: 'coins_100k', name: 'Plow Baron', desc: 'Earn 100,000 coins.', icon: '🎩', category: 'collection', goal: 100_000, reward: 400, value: (p) => fin(p.data.totalCoinsEarned) },
  { id: 'upgrades_25', name: 'Tinkerer', desc: 'Buy 25 upgrade levels.', icon: '🔧', category: 'collection', goal: 25, reward: 75, value: upgradeLevels },
  { id: 'upgrades_100', name: 'Grease Monkey', desc: 'Buy 100 upgrade levels.', icon: '🐒', category: 'collection', goal: 100, reward: 250, value: upgradeLevels },
  { id: 'cosmetics_5', name: 'Fresh Paint', desc: 'Own 5 Paint Shop items.', icon: '🎨', category: 'collection', goal: 5, reward: 100, value: cosmeticsOwned },
];

export const ACHIEVEMENT_BY_ID: Record<string, AchievementDef> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
