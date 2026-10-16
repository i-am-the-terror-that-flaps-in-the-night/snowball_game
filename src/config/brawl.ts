import type { BrawlDifficulty } from '../core/types';

/** Snowdome Brawl — free-for-all: the player + BRAWL_BOTS rival plows, everyone hunting everyone. */
export const BRAWL_BOTS = 8;
export const BRAWL_TIME = 300;
export const BRAWL_KILL_TARGET = 20;
/** Seconds before a wrecked fighter (player or bot) respawns. */
export const BRAWL_RESPAWN = 3;
/** Seconds of spawn protection after (re)spawning. */
export const BRAWL_SPAWN_PROTECT = 2;
/** Brawl hit cap: one hit can take at most this fraction of the target's max hp (smooth taper — small hits
 *  are barely affected). Stops full-ball slams from one-shotting anyone, player or bot. */
export const BRAWL_HIT_CAP = 0.6;
export function brawlHit(raw: number, targetMaxHp: number, capFrac = BRAWL_HIT_CAP): number {
  const cap = capFrac * targetMaxHp;
  if (!(cap > 0) || !(raw > 0)) return 0;
  return cap * (1 - Math.exp(-raw / cap));
}

/** Coins for each kill before the streak multiplier and difficulty multiplier. */
export const BRAWL_KILL_COINS = 20;
/** Shutdown bounty: coins per streak count of the fighter you stopped (streak >= 3). */
export const BRAWL_SHUTDOWN_PER_STREAK = 12;
/** Placement bonus (index 0 = 1st place), before the difficulty multiplier. */
export const BRAWL_PLACEMENT_BONUS = [300, 160, 90, 40];

/** Streak tiers: reaching `at` kills without dying sets the coin multiplier and announces the label. */
export const STREAK_TIERS = [
  { at: 3, mult: 1.5, label: 'KILLING SPREE' },
  { at: 5, mult: 2, label: 'RAMPAGE' },
  { at: 8, mult: 3, label: 'UNSTOPPABLE' },
  { at: 12, mult: 4, label: 'PLOWNADO' },
] as const;

export function streakMult(streak: number): number {
  let m = 1;
  for (const t of STREAK_TIERS) if (streak >= t.at) m = t.mult;
  return m;
}

export interface BrawlDifficultyDef {
  id: BrawlDifficulty;
  name: string;
  blurb: string;
  /** Rival hp / damage multipliers. */
  hpMult: number;
  dmgMult: number;
  /** Rival reaction time (s) before reacting to threats / changing targets. */
  reaction: number;
  /** 0..1: how well rivals aim slams/dashes and dodge telegraphed attacks. */
  skill: number;
  /** Multiplier on all coins earned in the match. */
  coinMult: number;
  /** Each rival rolls its own garage: per upgrade, level = round(yourLevel * U(lo, hi)), at least `floor`.
   *  Stats then come from the same FX curves as yours (src/config/upgrades.ts), so bots scale like players. */
  botLevels: { regular: [number, number]; elite: [number, number]; floor: number; eliteFloor: number };
  /** Chance a rival also owns each one-time perk the PLAYER owns (Ice Shield, Avalanche Core). */
  perkChance: { regular: number; elite: number };
  /** Number of ELITE rivals (clan-tagged tryhards: tougher, smarter, farm weaker bots into big streaks). */
  elites: number;
  /** Target-score bonus for hunting the player (bigger = the lobby focuses you more). */
  playerFocus: number;
  /** Max rivals hunting the player at the same time. */
  maxHunters: number;
  /** Fraction of max hp a rival repairs on every kill (keeps streaks alive). */
  killHeal: number;
  /** Rival damage + speed bonus per streak tier reached ("on fire"). */
  streakBuff: number;
}

export const BRAWL_DIFFICULTIES: BrawlDifficultyDef[] = [
  { id: 'rookie', name: 'Rookie Lobby', blurb: 'Bots that just got their licence. Sloppy aim, slow reactions, budget garages.', hpMult: 0.8, dmgMult: 0.7, reaction: 0.6, skill: 0.3, coinMult: 1, botLevels: { regular: [0.1, 0.45], elite: [0.5, 0.75], floor: 0, eliteFloor: 0 }, perkChance: { regular: 0, elite: 0.3 }, elites: 1, playerFocus: 0.2, maxHunters: 1, killHeal: 0.2, streakBuff: 0.05 },
  { id: 'pro', name: 'Pro Lobby', blurb: 'Seasoned plowers with garages a bit behind yours. They dash, flank and steal kills.', hpMult: 1, dmgMult: 1, reaction: 0.35, skill: 0.65, coinMult: 1.6, botLevels: { regular: [0.4, 0.75], elite: [0.75, 0.95], floor: 0, eliteFloor: 1 }, perkChance: { regular: 0.25, elite: 0.65 }, elites: 2, playerFocus: 0.55, maxHunters: 2, killHeal: 0.3, streakBuff: 0.06 },
  { id: 'legend', name: 'Legend Lobby', blurb: 'Sweaty tryhards with garages as good as yours. They hunt the leader.', hpMult: 1.2, dmgMult: 1.35, reaction: 0.16, skill: 0.95, coinMult: 2.5, botLevels: { regular: [0.6, 0.9], elite: [0.9, 1.05], floor: 1, eliteFloor: 2 }, perkChance: { regular: 0.6, elite: 1 }, elites: 3, playerFocus: 1.2, maxHunters: 3, killHeal: 0.4, streakBuff: 0.08 },
];

/** Gamer-tag style rival names (pick BRAWL_BOTS at random per match). */
export const BRAWL_BOT_NAMES = [
  'xX_Plowmaster_Xx', 'SnowDaddy', 'BladeRunner', 'IceQueen', 'Sleetwood_Mac', 'FrostyTheFlamer',
  'DriftKing', 'BrrrZerker', 'Snowverkill', 'TundraTitan', 'SlushPuppy', 'AvalancheAndy',
  'ColdFusion', 'PlowYourMind', 'Hailstorm_99', 'SirPlowsALot', 'NoScopeSnow', 'GlacierGirl',
  'Chillionaire', 'ScrapeLord', 'Blizzardo', 'SnowBizness',
];

/** Distinct paint colors for rivals (CSS hex; also used for name tags / minimap / kill feed). */
export const BRAWL_COLORS = ['#e63946', '#2a9df4', '#2ecc71', '#b45cff', '#ffd60a', '#ff7eb6', '#00d1c1', '#8d99ae', '#ff8c00', '#7cfc00'];
export const PLAYER_BRAWL_COLOR = '#ff9b2f';

/** Clan tags worn by ELITE rivals. */
export const BRAWL_CLAN_TAGS = ['[ICE]', '[GOAT]', '[BRR]', '[PLOW]', '[SNOW]', '[TTV]'];

/** Rival personalities — weights for the AI. */
export const BRAWL_PERSONALITIES = [
  { id: 'brawler', aggression: 0.9, ballHunger: 0.5, dashLove: 0.7, whirlLove: 0.8, caution: 0.2 },
  { id: 'rammer', aggression: 1.0, ballHunger: 0.2, dashLove: 1.0, whirlLove: 0.4, caution: 0.1 },
  { id: 'slammer', aggression: 0.7, ballHunger: 1.0, dashLove: 0.4, whirlLove: 0.3, caution: 0.4 },
  { id: 'vulture', aggression: 0.6, ballHunger: 0.6, dashLove: 0.6, whirlLove: 0.5, caution: 0.6 },
] as const;

/** Taunts rivals occasionally pop in a speech bubble after a kill / on a streak. */
export const BRAWL_TAUNTS = ['gg ez', 'get plowed', 'snow mercy', 'too cold for you?', 'brrrt', 'L + ratio + snowed', 'sit', 'who taught u to drive', 'skill issue', 'ice to meet you', 'chill out', '❄️❄️❄️'];
