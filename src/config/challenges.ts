import type { GameEvents } from '../core/events';
import type { PlowKind } from './plows';

/* Campaign challenges: three per arena, one star each (meta/challenges.ts awards them). Every challenge is
 * judged on a WON campaign run (normal or Hard) from the runFinished payload plus a few extras the
 * ChallengeTracker tallies from events. Thresholds were tuned against a headless autopilot (it clears fast
 * but plays sloppy defense), so speed goals sit a bit above its times and damage goals well above its hits.
 * Ids only need to be unique within their arena (saved as save.challenges[zoneId]). */

/** What a challenge gets to look at: the runFinished payload + tracker extras. */
type RunFinished = GameEvents['runFinished'];
export interface ChallengeRun extends RunFinished {
  /** Seconds from the boss round's FIGHT! to the end of the run (0 if the boss round never started). */
  bossTime: number;
  /** HP lost during the boss round. */
  bossDamage: number;
  /** STRIKE!s landed (one slam / whirl hitting 3+ bots). */
  strikes: number;
}

export interface ChallengeDef {
  id: string;
  icon: string;
  /** Punchy title shown on the results screen and in tooltips. */
  name: string;
  /** Short goal, fits a zone card line (e.g. "Clear in under 1:30"). */
  goal: string;
  test(r: ChallengeRun): boolean;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const PLOW_NAME: Record<PlowKind, string> = { classic: 'Classic Plow', volt: 'VOLT-9', brute: 'BRUTUS', isotope: 'ISOTOPE', arsenal: 'ARSENAL' };

/* ---- challenge builders (one per flavour; arenas pick and tune them) */

const speed = (sec: number, name = 'Speed Demon'): ChallengeDef => ({
  id: 'speed', icon: '⏱', name, goal: `Clear in under ${mmss(sec)}`, test: (r) => r.duration < sec,
});
const untouchable = (hp: number, name = 'Untouchable'): ChallengeDef => ({
  id: 'hp', icon: '🛡', name, goal: `Lose under ${hp} HP`, test: (r) => r.damageTaken < hp,
});
const slamKills = (n: number, name = 'Slam Dunk'): ChallengeDef => ({
  id: 'slam', icon: '💥', name, goal: `${n} slam kills`, test: (r) => r.killsBy.slam >= n,
});
const ramKills = (n: number, name = 'Battering Ram'): ChallengeDef => ({
  id: 'ram', icon: '🐏', name, goal: `${n} ram / dash kills`, test: (r) => r.killsBy.ram >= n,
});
const whirlKills = (n: number, name = 'Eye of the Storm'): ChallengeDef => ({
  id: 'whirl', icon: '🌪', name, goal: `${n} whirlwind kills`, test: (r) => r.killsBy.whirl >= n,
});
const ball = (m: number, name = 'Snowball Titan'): ChallengeDef => ({
  id: 'ball', icon: '⚪', name, goal: `Grow a ${m.toFixed(1)} m snowball`, test: (r) => r.biggestBall >= m,
});
const combo = (n: number, name = 'Combo King'): ChallengeDef => ({
  id: 'combo', icon: '🔥', name, goal: `Hit a x${n} combo`, test: (r) => r.bestCombo >= n,
});
const strikes = (n: number, name = 'Strike Force'): ChallengeDef => ({
  id: 'strike', icon: '🎳', name, goal: `Land ${n} STRIKE!s`, test: (r) => r.strikes >= n,
});
const bossBlitz = (sec: number, name = 'Boss Blitz'): ChallengeDef => ({
  id: 'blitz', icon: '💨', name, goal: `Beat the boss in ${sec}s`, test: (r) => r.bossTime > 0 && r.bossTime < sec,
});
const bossClean = (hp: number, name = 'Not a Scratch'): ChallengeDef => ({
  id: 'bossHp', icon: '🎯', name, goal: `Take < ${hp} HP from boss`, test: (r) => r.bossDamage < hp,
});
/** Clear with one plow, plus an optional twist. */
const withPlow = (kind: PlowKind, name: string, extra?: { goal: string; test: (r: ChallengeRun) => boolean }): ChallengeDef => ({
  id: `plow-${kind}`,
  icon: kind === 'volt' ? '⚡' : kind === 'brute' ? '🦏' : '🚜',
  name,
  goal: extra ? `${PLOW_NAME[kind]}: ${extra.goal}` : `Clear with ${PLOW_NAME[kind]}`,
  test: (r) => r.plow === kind && (!extra || extra.test(r)),
});

/** Zone id -> its three challenges (card / results order). */
export const CHALLENGES: Record<string, ChallengeDef[]> = {
  // Frostbite Yard: learn the basics: slam, max out a ball, keep moving.
  yard: [slamKills(3), ball(1.2, 'Big Ball Energy'), speed(60, 'Quick Plow')],
  // Pine Junkyard: thieves and spinners; chain hits, dodge, rush the rogue AI.
  junkyard: [combo(30), untouchable(90, 'Thief-Proof'), bossBlitz(30, 'Ctrl+Alt+Delete')],
  // Frozen Foundry: brutes everywhere. Hit hard, hit many, survive it on the fragile electric plow.
  foundry: [
    ramKills(10),
    strikes(2),
    withPlow('volt', 'Live Wire', { goal: 'lose < 100 HP', test: (r) => r.damageTaken < 100 }),
  ],
  // Blizzard Bowl: two bosses in a whiteout. Big balls, spin, and do it fast.
  bowl: [ball(1.8, 'Glacier Maker'), whirlKills(4), speed(105, 'Whiteout Sprint')],
  // Omega Summit: the finale. Tank it with BRUTUS, dodge the machine, bury the rest in snow.
  summit: [
    withPlow('brute', 'Rhino Rampage', { goal: '12 ram kills', test: (r) => r.killsBy.ram >= 12 }),
    bossClean(60, 'Omega Dodger'),
    slamKills(10, 'Avalanche Artist'),
  ],
  // Golden Tower Plaza: break up the rally crowds, dodge the walls and the beam, keep the combo going bigly.
  plaza: [strikes(3, 'Crowd Control'), bossClean(80, 'Fake Damage'), combo(40, 'Tremendous Combo')],
};

/** Hard mode tuning (meta/challenges.ts hardZone / recordHardClear). */
export const HARD = {
  hpMult: 1.8,
  dmgMult: 1.5,
  coinMult: 1.75,
  /** Extra minions per spawn group (boss groups unchanged). */
  minionMult: 1.35,
  firstClearMult: 2.5,
  repeatClearMult: 0.6,
};

/** Coins per newly earned star, as a fraction of the arena's first-clear reward. */
export const STAR_REWARD_FRAC = 0.5;
