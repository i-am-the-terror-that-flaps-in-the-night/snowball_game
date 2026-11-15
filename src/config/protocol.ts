import type { EnemyType } from './enemies';
import { ZONES, type RoundDef, type SpawnGroup, type ZoneDef } from './zones';
import { HARD } from './challenges';
import { STAGE_FROM_WAVE, protocolTerrain, splitWave } from '../world/protocol/layout';

/**
 * PROTOCOL C: the secret seventh arena (docs/modes.md "Protocol C"; plan: build stage 1 of 5). Not an entry in ZONES:
 * that would auto-unlock on the Omega clear, move the finale (results.ts / Story.ts read the last ZONES id) and change
 * clear_all / hard_all / the campaign star total. Unlocked once every ZONES arena is cleared on normal AND Hard
 * (meta/protocol.ts).
 *
 * A seven-wave boss rush on one stadium floor that "restructures" between waves (world/protocol/layout.ts): wave n is
 * campaign boss n PROTOCOL-upgraded (protocolBossHp: at least its Hard-campaign HP +15%; HEADLINE_DMG x damage;
 * faster cooldowns), and the bosses already beaten come back as ECHOES (ECHO_HP x home HP, one or two signature moves, no phase 2 / summons: Bot.echo, bosses.ts),
 * walking in one after another (ECHO_FIRST + ECHO_GAP), with at most MAX_ACTIVE bosses fighting at once (the rest
 * circle on a leash: EnemyManager.leash). Base difficulty is Hard's (HARD.hpMult / dmgMult), scaled by the coins the
 * pilot has spent on upgrades + gear (spendScale).
 */

/** Zone index of PROTOCOL C (past the six campaign arenas; Game / Environment seed their rngs with it). */
export const PROTOCOL_INDEX = ZONES.length;
export const PROTOCOL_ID = 'protocol';
export const PROTOCOL_WAVES = 7;
/** THE WHITEOUT finale's checkpoint "wave" (internal wave 8: wave 7's round with THE CHAIRMAN already down; a death in
 *  the finale retries the finale, not wave 7). The run still has seven rounds. */
export const PROTOCOL_FINALE = 8;

/** Results / zone select label of a checkpoint wave: 'WAVE n' or 'FINALE'. */
export function protocolWaveLabel(wave: number): string {
  return wave >= PROTOCOL_FINALE ? 'FINALE' : `WAVE ${wave}`;
}
/** Headline (PROTOCOL-upgraded) boss: HP = home-arena HP x max(HEADLINE_HP, HARD.hpMult x HEADLINE_HARD), i.e. at
 *  least its Hard-campaign strength plus 15% (x1.6 home alone was only ~0.89x Hard); x outgoing damage; its cooldowns
 *  between moves run HEADLINE_CD x as fast (wind-ups / telegraphs keep their length: EnemyManager.step). */
export const HEADLINE_HP = 1.6;
export const HEADLINE_HARD = 1.15;
export const HEADLINE_DMG = 1.25;
export const HEADLINE_CD = 1.3;
/** Echoes: x home-arena HP, x outgoing damage. */
export const ECHO_HP = 0.35;
export const ECHO_DMG = 0.85;
/** THE CHAIRMAN (wave 7's final boss, no home arena): his HP multiplier is MEGAPLOW Ω's PROTOCOL headline's x this
 *  (with his bigger base HP: ~1.4x the Ω headline, the run's toughest boss); he lands at CHAIRMAN_SPAWN, under his box. */
export const CHAIRMAN_HP_K = 1.1;
export const CHAIRMAN_SPAWN = { x: 0, z: -19, heading: 0 } as const;
/** Wave 7's countdown: long enough for the boardroom box to light up and the camera to find it (the reveal). */
export const REVEAL_COUNTDOWN = 6;
/** At most this many bosses attack at once; the others hold back on a leash. */
export const MAX_ACTIVE = 4;
/** Seconds into a wave the first echo walks in, and between echoes (a twin pair arrives together). */
export const ECHO_FIRST = 6;
export const ECHO_GAP = 6;
/** First clear pays this (Omega's normal clear pays 1600, its first Hard clear 4000); repeats pay 40%. */
export const PROTOCOL_CLEAR_REWARD = 6000;
export const PROTOCOL_REPEAT_FRAC = 0.4;

/** A boss "slot" of the rush: one bot, or the SLUSH & SLEET pair. */
type BossKey = 'frostbyte' | 'bulldoza' | 'grinder' | 'twins' | 'donald' | 'omega' | 'chairman';
/** Campaign order: wave n's headline is ORDER[n - 1]. */
const ORDER: BossKey[] = ['frostbyte', 'bulldoza', 'grinder', 'twins', 'donald', 'omega'];
const KEY_TYPES: Record<BossKey, EnemyType[]> = {
  frostbyte: ['frostbyte'],
  bulldoza: ['bulldoza'],
  grinder: ['grinder'],
  twins: ['slush', 'sleet'],
  donald: ['donald'],
  omega: ['omega'],
  chairman: ['chairman'],
};

/** The campaign arena whose boss round holds `type` (its HP multiplier is the boss's "home" HP). */
export function homeZone(type: EnemyType): ZoneDef | undefined {
  return ZONES.find((z) => z.rounds.some((r) => r.boss && r.groups.some((g) => g.type === type)));
}

/** Net HP multiplier of a Protocol boss (before the pilot-power scale): home x ECHO_HP for an echo; for the headline
 *  the larger of home x HEADLINE_HP and its Hard-campaign HP (home x HARD.hpMult) x HEADLINE_HARD. */
export function protocolBossHp(type: EnemyType, echo: boolean): number {
  if (type === 'chairman') return protocolBossHp('omega', false) * CHAIRMAN_HP_K;
  const home = homeZone(type)?.enemyHpMult ?? 1;
  return echo ? home * ECHO_HP : home * Math.max(HEADLINE_HP, HARD.hpMult * HEADLINE_HARD);
}

function bossGroups(key: BossKey, delay: number, echo: boolean): SpawnGroup[] {
  // SpawnGroup.hpMult rides on top of zone.enemyHpMult (= Hard's, for the minions bosses summon): divide it back out.
  return KEY_TYPES[key].map((type, i) => ({
    type, count: 1, delay: delay + i * 0.6, interval: 1, hpMult: protocolBossHp(type, echo) / HARD.hpMult, echo, headline: !echo,
    ...(type === 'chairman' ? { at: CHAIRMAN_SPAWN } : {}),
  }));
}

/** Wave composition (index 0 = wave 1): the headline at 1 s, then the echoes one by one (two groups in wave 7). */
export function protocolRounds(): RoundDef[] {
  const rounds: RoundDef[] = [];
  for (let w = 1; w <= ORDER.length; w++) {
    const groups = bossGroups(ORDER[w - 1], 1, false);
    ORDER.slice(0, w - 1).forEach((k, i) => groups.push(...bossGroups(k, ECHO_FIRST + i * ECHO_GAP, true)));
    rounds.push({ boss: true, groups });
  }
  // Wave 7: THE CHAIRMAN (straight away: his descent from the box opens the fight) + every headline as an echo, in two
  // staggered groups.
  const finale = bossGroups('chairman', 0, false);
  ORDER.forEach((k, i) => finale.push(...bossGroups(k, i < 3 ? 8 + i * 2 : 32 + (i - 3) * 2.5, true)));
  rounds.push({ boss: true, groups: finale });
  return rounds;
}

/** Headline boss name of each wave (the boss intro card, the results screen). */
export function headlineName(wave: number): string {
  if (wave >= PROTOCOL_WAVES) return 'THE CHAIRMAN';
  const key = ORDER[Math.max(0, wave - 1)];
  return key === 'twins' ? 'SLUSH & SLEET' : key === 'frostbyte' ? 'FROSTBYTE' : key === 'bulldoza' ? 'BULLDOZA' : key === 'grinder' ? 'THE GRINDER' : key === 'donald' ? 'THE DONALD' : 'MEGAPLOW Ω';
}

const ROUNDS = protocolRounds();

/** The arena (wave 1 floor). Look: corporate gold on ice, a glass boardroom box hanging over the north stand. */
export const PROTOCOL_ZONE: ZoneDef = {
  index: PROTOCOL_INDEX, id: PROTOCOL_ID, name: 'PROTOCOL C', tagline: 'TODO.', bossName: 'FROSTBYTE',
  rounds: ROUNDS,
  enemyHpMult: HARD.hpMult, enemyDmgMult: HARD.dmgMult, coinMult: HARD.coinMult,
  snowDepth: 0.5, snowRegenMult: 1.3, clearReward: PROTOCOL_CLEAR_REWARD,
  skyTop: 0x173a66, skyBottom: 0xf3d892, fogColor: 0xe6dcc4, fogNear: 55, fogFar: 170,
  sunColor: 0xffe2a8, sunIntensity: 2.4, ambientColor: 0xfff0d8, ambientIntensity: 0.9, snowTint: 0xf2f7ff, snowfall: 0.25,
  terrain: protocolTerrain(1), theme: 'protocol', maxActiveBosses: MAX_ACTIVE,
};

/** Scaled base: `k` = spendScale(protocolSpent) (coins spent on upgrades + gear). */
export function protocolZone(k: { hp: number; dmg: number } = { hp: 1, dmg: 1 }): ZoneDef {
  return { ...PROTOCOL_ZONE, enemyHpMult: HARD.hpMult * k.hp, enemyDmgMult: HARD.dmgMult * k.dmg };
}

/** The arena as wave `wave` (1-based) sees it: that wave's floor, stage and headline name. */
export function protocolWaveZone(base: ZoneDef, wave: number): ZoneDef {
  const w = Math.max(1, Math.min(PROTOCOL_WAVES, Math.round(wave) || 1));
  return { ...base, terrain: protocolTerrain(w), bossName: headlineName(w), stage: w >= STAGE_FROM_WAVE, split: splitWave(w) };
}

/** Bosses (bots) in a wave, and how many of them are echoes. */
export function waveBossCount(wave: number): { total: number; echoes: number } {
  const r = ROUNDS[wave - 1];
  if (!r) return { total: 0, echoes: 0 };
  let total = 0;
  let echoes = 0;
  for (const g of r.groups) {
    total += g.count;
    if (g.echo) echoes += g.count;
  }
  return { total, echoes };
}

/** Enemy scaling in PROTOCOL C follows the coins the pilot has put into getting stronger (upgrades + gear; cosmetics
 *  and plows don't count): at SPEND_REF coins (about what a pilot has spent by the unlock: every arena cleared on
 *  normal and Hard) bots are at the plain Hard-based numbers; HP grows with the square root of the spend ratio and
 *  damage more gently. Floored (a thrifty pilot's run stays a real final test), no cap: it keeps up however far a
 *  pilot upgrades. */
export const SPEND_REF = 30000;
export const SPEND_HP_EXP = 0.5;
export const SPEND_DMG_EXP = 0.3;
export const SPEND_HP_RANGE: readonly [number, number] = [0.8, Infinity];
export const SPEND_DMG_RANGE: readonly [number, number] = [0.85, Infinity];

/** HP / damage multipliers for a pilot who has spent `spent` coins on upgrades and gear. */
export function spendScale(spent: number): { hp: number; dmg: number } {
  const r = Math.max(0, spent) / SPEND_REF;
  const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));
  return { hp: clamp(r ** SPEND_HP_EXP, SPEND_HP_RANGE), dmg: clamp(r ** SPEND_DMG_EXP, SPEND_DMG_RANGE) };
}
