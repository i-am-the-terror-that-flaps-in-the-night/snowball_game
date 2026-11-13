import type { GameEvents, KillWeapon } from '../core/events';
import type { PlowKind } from './plows';

/* Campaign challenges: five per arena, one star each (meta/challenges.ts awards them). Every challenge is
 * judged on a WON campaign run (normal or Hard) from the runFinished payload plus a few extras the
 * ChallengeTracker tallies from events. Thresholds were tuned against a headless autopilot (it clears fast
 * but plays sloppy defense), so speed goals sit a bit above its times and damage goals well above its hits.
 * Ids only need to be unique within their arena (saved as save.challenges[zoneId]).
 * Each arena has three originals plus two signature goals (docs/modes.md): one per plow mechanic (Classic Plow Rush,
 * VOLT-9 Arc Lance, ARSENAL Mag Laser / Polarity Burst / Singularity, BRUTUS tanking, ISOTOPE burn) and a boss / no-damage /
 * speed / zone goal. Signature goals have no plow check: only that plow's weapon can score them. */

/** What a challenge gets to look at: the runFinished payload + tracker extras. */
type RunFinished = GameEvents['runFinished'];
export interface ChallengeRun extends RunFinished {
  /** Seconds from the boss round's FIGHT! to the end of the run (0 if the boss round never started). */
  bossTime: number;
  /** HP lost during the boss round. */
  bossDamage: number;
  /** STRIKE!s landed (one slam / whirl hitting 3+ bots). */
  strikes: number;
  /** Bots hit by the Classic Plow's PLOW RUSH end slams (sum over every rush; 'plowRush' events). */
  rushHits?: number;
  /** Player kills by signature weapon ('enemyKilled' weapon, core/events.ts KillWeapon). */
  weaponKills?: Partial<Record<KillWeapon, number>>;
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
/* Plow signature challenges (one per signature mechanic, spread over the arenas). */
/** Bots hit by the Classic's PLOW RUSH end slams (a full rush into a pack hits 3-6). */
const rushHits = (n: number, name = 'Rush Hour'): ChallengeDef => ({
  id: 'rush', icon: '🚜', name, goal: `${n} Plow Rush hits`,
  tip: 'Classic Plow: hold SPACE to charge a PLOW RUSH, release to charge into a pack. Every bot its end slam hits counts. Tap slams first to pack SNOW CHUNKS for a wider rush slam.',
  test: (r) => (r.rushHits ?? 0) >= n,
});
/** Kills finished by one signature weapon. */
const weaponKills = (weapon: KillWeapon, id: string, icon: string, n: number, name: string, what: string, tip: string): ChallengeDef => ({
  id, icon, name, goal: `${n} ${what} kills`, tip, test: (r) => (r.weaponKills?.[weapon] ?? 0) >= n,
});
/** BRUTUS soaks the hits: lose at least `hp` HP over the run and still win (repairs between rounds help). */
const tank = (hp: number, name = 'Crash Test Dummy'): ChallengeDef => ({
  id: 'soak', icon: '🦏', name, goal: `BRUTUS: tank ${hp} HP`,
  tip: 'Win with BRUTUS after soaking up this much damage over the run. Wade into the crowd, take the hits, keep swinging (round repairs top you up).',
  test: (r) => r.plow === 'brute' && r.damageTaken >= hp,
});
const ramKills = (n: number, name = 'Demolition Derby'): ChallengeDef => ({
  id: 'ram', icon: '🐏', name, goal: `${n} ram kills`,
  tip: 'Finish bots by driving into them at speed (dash for a harder hit). Softened-up bots go down to a ram.',
  test: (r) => r.killsBy.ram >= n,
});

/** Clear with one plow, plus an optional twist. */
const withPlow = (kind: PlowKind, name: string, extra?: { goal: string; test: (r: ChallengeRun) => boolean }): ChallengeDef => ({
  id: `plow-${kind}`,
  icon: kind === 'volt' ? '⚡' : kind === 'brute' ? '🦏' : '🚜',
  name,
  goal: extra ? `${PLOW_NAME[kind]}: ${extra.goal}` : `Clear with ${PLOW_NAME[kind]}`,
  test: (r) => r.plow === kind && (!extra || extra.test(r)),
});

/** Zone id -> its five challenges (card / results order). Keyed by save id, so a challenge follows its arena's id
 *  (docs/level-overhaul.md "Swaps and saves"): ids never change, only titles get rethemed. */
export const CHALLENGES: Record<string, ChallengeDef[]> = {
  // Coldboot Glacier (arena 1, FROSTBYTE): learn the basics: slam, max out a ball, keep moving. 'speed' re-checked on
  // the terrain build (scripts/omega-probe.mjs, fresh garage): every plow clears in 0:24-0:48, so 1:00 holds.
  // Signature: the Classic's PLOW RUSH (a fresh rush into a 3-bot pack is 3 hits) and a cool boss fight.
  yard: [
    slamKills(3),
    ball(1.2, 'Big Ball Energy'),
    speed(60, 'Quick Plow'),
    rushHits(8, 'Rush Hour'),
    bossClean(40, 'Cold Shoulder'),
  ],
  // Inferno Quarry (arena 2, BULLDOZA): thieves and lava. Knock bots into the lava, dodge, scrap the Yard Boss fast.
  // 'lava' replaced the x30 combo (Golden Tower Plaza keeps a combo star); any kill on a bot standing in lava counts
  // (bots steer out of lava fast, so the burn alone rarely finishes one). 'blitz' retuned 30 s -> 15 s: the probe's
  // fresh-garage boss fights run 3-16 s (mid garage 2-3 s), so 30 s was a free star.
  // Signature: ISOTOPE's radiation burn (any burn tick that finishes a bot, TANK-BUSTER included) and scrapyard rams.
  // 'burn' asks 5 of the ~17 bots: on the headless sim's 6-bot pack (scripts/balance/sim.ts rotation) burn ticks
  // finish ~30% of a fresh ISOTOPE's kills but ~1% at mid (the spray overkills), so it wants spray-and-let-it-cook.
  junkyard: [
    lavaKills(3, 'Hot Tub'),
    untouchable(90, 'Thief-Proof'),
    bossBlitz(15, 'Eviction Notice'),
    weaponKills('radBurn', 'burn', '☢️', 5, 'Tank-Buster', 'rad burn',
      'ISOTOPE: soak a bot with the Rad Sprayer, then move on and let the RAD DOSE and TANK-BUSTER burn finish it. Only kills by the burn tick count.'),
    ramKills(8, 'Demolition Derby'),
  ],
  // Rust Basin (arena 3, THE GRINDER): low gravity. Catch big air off the ramp, dive on the pack, survive it on the
  // fragile electric plow. Its ramp gives ~1.4 s of flight (4.5 m up, >1.3 s high enough to air-slam) at a fresh plow's
  // 10 m/s top speed, straight off the lip (8 m/s: ~0.75 s), so 'air' asks 1.0 s. 'airSlam' (air slam or stomp kill)
  // and 'air' replaced 10 ram kills and 2 STRIKE!s (The Omega Works / the Plaza keep ram and STRIKE! stars).
  foundry: [
    airKills(1, 'Meteor Strike'),
    airtime(1.0, 'Moonshot'),
    withPlow('volt', 'Live Wire', { goal: 'lose < 100 HP', test: (r) => r.damageTaken < 100 }),
    // Signature: ARSENAL's SINGULARITY (one black hole on a pack does it) and a quick GRINDER fight.
    weaponKills('singularity', 'sing', '🌀', 3, 'Event Horizon', 'Singularity',
      'ARSENAL: fill the SINGULARITY meter with weapon damage, then drop the black hole on a crowd. Kills while it pulls or as it collapses count.'),
    bossBlitz(30, 'Drill Sergeant'),
  ],
  // The Thermal Divide (arena 4, SLUSH & SLEET): a hot twin and a cold twin. Big balls, spin, and do it fast. 'speed'
  // retuned 1:45 -> 1:30: fresh-garage clears run 0:53-1:42, mid 0:38-0:47. (Its two small ramps only lift you 0.5 m+
  // for ~0.2-0.4 s, too short for an air-slam goal, so the air challenges live in Rust Basin.)
  // Signature: VOLT-9's Arc Lance (chains through packs) and ARSENAL's Polarity Burst (F; it pulls a pack in first).
  // Of ~28 bots: the sim's pack gives the lance ~21% (fresh) to ~46% (mid) of VOLT-9's kills, the burst ~17-21% of
  // ARSENAL's, so 10 and 4.
  bowl: [
    ball(1.8, 'Cold Front'),
    whirlKills(4),
    speed(90, 'Divide & Conquer'),
    weaponKills('arcLance', 'arc', '⚡', 10, 'Lightning Rod', 'Arc Lance',
      'VOLT-9: hold SPACE to fire the Arc Lance from range. Chains jump through up to 7 bots; every kill the lightning finishes counts.'),
    weaponKills('polarity', 'polarity', '🧲', 4, 'Polar Opposites', 'Polarity Burst',
      'ARSENAL: press F for a Polarity Burst. It drags a pack together, then blows it apart; kills from the blast count.'),
  ],
  // Golden Tower Plaza (arena 5, THE DONALD): break up the rally crowds, dodge the walls and the beam, keep the combo
  // going bigly.
  // Signature: ARSENAL's Mag Laser through the rally crowds (~44 bots; the laser finishes ~36-39% of ARSENAL's kills on
  // the sim's pack, so 15). 'speed': mid-garage clears run 0:50-1:04 (docs/balance.md).
  plaza: [
    strikes(3, 'Crowd Control'),
    bossClean(80, 'Fake Damage'),
    combo(40, 'Tremendous Combo'),
    weaponKills('magLaser', 'laser', '🔷', 15, 'Laser Light Show', 'Mag Laser',
      'ARSENAL: hold SPACE and steer the Mag Laser down a line of bots. Its bolts pierce, so a lined-up crowd melts fast.'),
    speed(75, 'Rally Sprint'),
  ],
  // The Omega Works (arena 6, MEGAPLOW Ω): the finale. Tank it with BRUTUS, dodge the machine, bury the rest in snow.
  // No time-based goals here on purpose: the 160 m multi-level factory makes clear times swing with routing.
  summit: [
    withPlow('brute', 'Rhino Rampage', { goal: '12 ram kills', test: (r) => r.killsBy.ram >= 12 }),
    bossClean(60, 'Omega Dodger'),
    slamKills(10, 'Avalanche Artist'),
    // Signature: BRUTUS soaks the factory vs. a clean run (any plow). Mid-garage bot sweeps lose ~90-180 HP on a normal
    // run here and ~390-730 on Hard (docs/balance.md), so 400 asks BRUTUS to wade in (or take on Hard) and 150 sits
    // near the sloppy-defense autopilot's losses.
    tank(400, 'Crash Test Dummy'),
    untouchable(150, 'Quality Control'),
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
  /** Hard scales with the pilot's upgrades past mid-game (meta/challenges.ts hardPower / hardScale): above power
   *  `scaleFrom` (the mean effective level of the core four + the plow's own line; mid-game is ~3.5, late-game ~9),
   *  each level adds `hpPerLevel` bot HP and `dmgPerLevel` bot damage on top of hpMult / dmgMult, up to `scaleLevels`
   *  levels (x2.5 HP, x1.8 damage at the cap). */
  scaleFrom: 4,
  scaleLevels: 10,
  hpPerLevel: 0.15,
  dmgPerLevel: 0.08,
};

/** Coins per newly earned star, as a fraction of the arena's first-clear reward. */
export const STAR_REWARD_FRAC = 0.5;
