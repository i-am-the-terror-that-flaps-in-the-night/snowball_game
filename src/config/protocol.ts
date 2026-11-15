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
 * campaign boss n PROTOCOL-upgraded (HEADLINE_HP x its home-arena HP, HEADLINE_DMG x damage), and the bosses already
 * beaten come back as ECHOES (ECHO_HP x home HP, one or two signature moves, no phase 2 / summons: Bot.echo, bosses.ts),
 * walking in one after another (ECHO_FIRST + ECHO_GAP), with at most MAX_ACTIVE bosses fighting at once (the rest
 * circle on a leash: EnemyManager.leash). Base difficulty is Hard's (HARD.hpMult / dmgMult, scaled with the pilot's
 * power like hardZone).
 */

/** Zone index of PROTOCOL C (past the six campaign arenas; Game / Environment seed their rngs with it). */
export const PROTOCOL_INDEX = ZONES.length;
export const PROTOCOL_ID = 'protocol';
export const PROTOCOL_WAVES = 7;
/** Headline (PROTOCOL-upgraded) boss: x home-arena HP, x outgoing damage. */
export const HEADLINE_HP = 1.6;
export const HEADLINE_DMG = 1.25;
/** Echoes: x home-arena HP, x outgoing damage. */
export const ECHO_HP = 0.35;
export const ECHO_DMG = 0.85;
/** At most this many bosses attack at once; the others hold back on a leash. */
export const MAX_ACTIVE = 4;
/** Seconds into a wave the first echo walks in, and between echoes (a twin pair arrives together). */
export const ECHO_FIRST = 6;
export const ECHO_GAP = 6;
/** First clear pays this (Omega's normal clear pays 1600, its first Hard clear 4000); repeats pay 40%. */
export const PROTOCOL_CLEAR_REWARD = 6000;
export const PROTOCOL_REPEAT_FRAC = 0.4;

/** A boss "slot" of the rush: one bot, or the SLUSH & SLEET pair. */
type BossKey = 'frostbyte' | 'bulldoza' | 'grinder' | 'twins' | 'donald' | 'omega';
/** Campaign order: wave n's headline is ORDER[n - 1]. */
const ORDER: BossKey[] = ['frostbyte', 'bulldoza', 'grinder', 'twins', 'donald', 'omega'];
const KEY_TYPES: Record<BossKey, EnemyType[]> = {
  frostbyte: ['frostbyte'],
  bulldoza: ['bulldoza'],
  grinder: ['grinder'],
  twins: ['slush', 'sleet'],
  donald: ['donald'],
  omega: ['omega'],
};

/** The campaign arena whose boss round holds `type` (its HP multiplier is the boss's "home" HP). */
export function homeZone(type: EnemyType): ZoneDef | undefined {
  return ZONES.find((z) => z.rounds.some((r) => r.boss && r.groups.some((g) => g.type === type)));
}

/** Net HP multiplier of a Protocol boss (before the pilot-power scale): home x HEADLINE_HP or x ECHO_HP. */
export function protocolBossHp(type: EnemyType, echo: boolean): number {
  return (homeZone(type)?.enemyHpMult ?? 1) * (echo ? ECHO_HP : HEADLINE_HP);
}

function bossGroups(key: BossKey, delay: number, echo: boolean): SpawnGroup[] {
  // SpawnGroup.hpMult rides on top of zone.enemyHpMult (= Hard's, for the minions bosses summon): divide it back out.
  return KEY_TYPES[key].map((type, i) => ({
    type, count: 1, delay: delay + i * 0.6, interval: 1, hpMult: protocolBossHp(type, echo) / HARD.hpMult, echo, headline: !echo,
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
  // Wave 7: the final boss + every headline as an echo, in two staggered groups.
  // TODO(protocol stage 3): THE CHAIRMAN replaces this stand-in (THE DONALD at headline strength).
  const finale = bossGroups('donald', 1, false);
  ORDER.forEach((k, i) => finale.push(...bossGroups(k, i < 3 ? 8 + i * 2 : 32 + (i - 3) * 2.5, true)));
  rounds.push({ boss: true, groups: finale });
  return rounds;
}

/** Headline boss name of each wave (the boss intro card, the results screen). */
export function headlineName(wave: number): string {
  if (wave >= PROTOCOL_WAVES) return 'THE DONALD'; // TODO(protocol stage 3): 'THE CHAIRMAN'
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

/** Pilot-power scaled base (like hardZone): `k` = hardScale(power). */
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
