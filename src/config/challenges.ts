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
  /** How to pull it off, for goals that aren't obvious (zone card hover, results screen when missed). */
  tip?: string;
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
/* Biome challenges (docs/level-overhaul.md "Challenges and trophies"). */
/** Kills on bots standing in lava: knock them in and finish them any way you like, or let the lava burn them out. */
const lavaKills = (n: number, name = 'Hot Tub'): ChallengeDef => ({
  id: 'lava', icon: '🌋', name, goal: `${n} kills in lava`,
  tip: 'Shove or blast bots into the lava, then finish them off (or let it burn them). Any kill counts while they stand in it.',
  test: (r) => Math.max(r.lavaKills ?? 0, r.killsBy.lava ?? 0) >= n,
});
/** Longest single flight. The best ramp in the campaign (Rust Basin, low gravity) gives ~1.5 s at full speed. */
const airtime = (sec: number, name = 'Moonshot'): ChallengeDef => ({
  id: 'air', icon: '🛸', name, goal: `${sec.toFixed(1)} s of airtime`,
  tip: 'Your longest single jump. Hit the big ramps at full speed (dash onto them) and fly off the top.',
  test: (r) => (r.airtime ?? 0) >= sec,
});
/** Kills from the air: an air slam (the Classic's slam while airborne, BRUTUS's airborne Ground Pound) or a stomp
 *  (landing on a bot; any plow). */
const airKills = (n: number, name = 'Meteor Strike'): ChallengeDef => ({
  id: 'airSlam', icon: '☄️', name, goal: n === 1 ? 'Air-slam or stomp kill' : `${n} air-slam/stomp kills`,
  tip: 'Launch off a ramp, then slam (Classic) or Ground Pound (BRUTUS) before you land, or land right on top of a bot with any plow. Softened-up bots die easier.',
  test: (r) => (r.killsBy.airSlam ?? 0) + (r.killsBy.stomp ?? 0) >= n,
});
const bossBlitz = (sec: number, name = 'Boss Blitz'): ChallengeDef => ({
  id: 'blitz', icon: '💨', name, goal: `Beat the boss in ${sec}s`,
  tip: 'The timer starts when the boss arrives. Save your F ability and its meter for it.',
  test: (r) => r.bossTime > 0 && r.bossTime < sec,
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

/** Zone id -> its three challenges (card / results order). Keyed by save id, so a challenge follows its arena's id
 *  (docs/level-overhaul.md "Swaps and saves"): ids never change, only titles get rethemed. */
export const CHALLENGES: Record<string, ChallengeDef[]> = {
  // Coldboot Glacier (arena 1, FROSTBYTE): learn the basics: slam, max out a ball, keep moving. 'speed' re-checked on
  // the terrain build (scripts/omega-probe.mjs, fresh garage): every plow clears in 0:24-0:48, so 1:00 holds.
  yard: [slamKills(3), ball(1.2, 'Big Ball Energy'), speed(60, 'Quick Plow')],
  // Inferno Quarry (arena 2, BULLDOZA): thieves and lava. Knock bots into the lava, dodge, scrap the Yard Boss fast.
  // 'lava' replaced the x30 combo (Golden Tower Plaza keeps a combo star); any kill on a bot standing in lava counts
  // (bots steer out of lava fast, so the burn alone rarely finishes one). 'blitz' retuned 30 s -> 15 s: the probe's
  // fresh-garage boss fights run 3-16 s (mid garage 2-3 s), so 30 s was a free star.
  junkyard: [lavaKills(3, 'Hot Tub'), untouchable(90, 'Thief-Proof'), bossBlitz(15, 'Eviction Notice')],
  // Rust Basin (arena 3, THE GRINDER): low gravity. Catch big air off the ramp, dive on the pack, survive it on the
  // fragile electric plow. Its ramp gives ~1.4 s of flight (4.5 m up, >1.3 s high enough to air-slam) at a fresh plow's
  // 10 m/s top speed, straight off the lip (8 m/s: ~0.75 s), so 'air' asks 1.0 s. 'airSlam' (air slam or stomp kill)
  // and 'air' replaced 10 ram kills and 2 STRIKE!s (The Omega Works / the Plaza keep ram and STRIKE! stars).
  foundry: [
    airKills(1, 'Meteor Strike'),
    airtime(1.0, 'Moonshot'),
    withPlow('volt', 'Live Wire', { goal: 'lose < 100 HP', test: (r) => r.damageTaken < 100 }),
  ],
  // The Thermal Divide (arena 4, SLUSH & SLEET): a hot twin and a cold twin. Big balls, spin, and do it fast. 'speed'
  // retuned 1:45 -> 1:30: fresh-garage clears run 0:53-1:42, mid 0:38-0:47. (Its two small ramps only lift you 0.5 m+
  // for ~0.2-0.4 s, too short for an air-slam goal, so the air challenges live in Rust Basin.)
  bowl: [ball(1.8, 'Cold Front'), whirlKills(4), speed(90, 'Divide & Conquer')],
  // Golden Tower Plaza (arena 5, THE DONALD): break up the rally crowds, dodge the walls and the beam, keep the combo
  // going bigly.
  plaza: [strikes(3, 'Crowd Control'), bossClean(80, 'Fake Damage'), combo(40, 'Tremendous Combo')],
  // The Omega Works (arena 6, MEGAPLOW Ω): the finale. Tank it with BRUTUS, dodge the machine, bury the rest in snow.
  // No time-based goals here on purpose: the 160 m multi-level factory makes clear times swing with routing.
  summit: [
    withPlow('brute', 'Rhino Rampage', { goal: '12 ram kills', test: (r) => r.killsBy.ram >= 12 }),
    bossClean(60, 'Omega Dodger'),
    slamKills(10, 'Avalanche Artist'),
  ],
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
