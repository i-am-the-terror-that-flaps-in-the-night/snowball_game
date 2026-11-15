import type { GameContext } from '../core/types';
import type { Progression } from '../core/Progression';
import type { GameEvents, KillWeapon } from '../core/events';
import { ZONES, type ZoneDef } from '../config/zones';
import {
  CHALLENGES, HARD, PROTOCOL_CHALLENGES, PROTOCOL_STAR_REWARD, PROTOCOL_STAR_SWEEP_WAVE, STAR_REWARD_FRAC,
  type ChallengeDef, type ChallengeRun, type ProtocolChallengeDef, type ProtocolRun,
} from '../config/challenges';
import { PROTOCOL_ID, PROTOCOL_WAVES, waveBossCount } from '../config/protocol';
import { UPGRADES, type UpgradeId } from '../config/upgrades';
import type { PlowKind } from '../config/plows';

/* Campaign meta: five star challenges per arena (config/challenges.ts) and a Hard mode for every arena.
 *  - Stars live in save.challenges[zoneId] = [challenge ids]; each pays a one-time coin bonus.
 *  - Hard mode opens once the arena's normal clear is done; clears live in save.hardCleared[zoneId].
 *  - ChallengeTracker (constructed once by Game) tallies a few extras from events, judges every finished
 *    campaign run and keeps the verdict for the results screen (lastChallengeReport). */

export type { ChallengeDef, ChallengeRun, ProtocolChallengeDef, ProtocolRun } from '../config/challenges';
export { HARD } from '../config/challenges';

/* ------------------------------------------------------------------ hard mode */

const CORE_UPGRADES: UpgradeId[] = ['engine', 'armor', 'packedIce', 'hopper'];

/** Pilot power for Hard scaling: the mean effective level (Garage + gear) of the core four upgrades and the plow's
 *  own line. A mean, so plows with longer lines aren't punished. Fresh 0, mid-game ~3.5, late-game ~9. */
export function hardPower(level: (id: UpgradeId) => number, kind: PlowKind): number {
  const ids = [...CORE_UPGRADES, ...UPGRADES.filter((u) => u.plowOnly === kind).map((u) => u.id)];
  return ids.reduce((s, id) => s + level(id), 0) / ids.length;
}

/** Extra Hard multipliers for a pilot of `power` (1 / 1 up to HARD.scaleFrom). */
export function hardScale(power: number): { hp: number; dmg: number } {
  const over = Math.min(HARD.scaleLevels, Math.max(0, power - HARD.scaleFrom));
  return { hp: 1 + HARD.hpPerLevel * over, dmg: 1 + HARD.dmgPerLevel * over };
}

/** Hard-mode version of a campaign arena: tougher, more numerous bots (same boss), better pay. `power` (hardPower)
 *  scales the bots further for heavily upgraded pilots, so Hard stays hard late. */
export function hardZone(zone: ZoneDef, power = 0): ZoneDef {
  const k = hardScale(power);
  return {
    ...zone,
    name: `${zone.name} · HARD`,
    enemyHpMult: zone.enemyHpMult * HARD.hpMult * k.hp,
    enemyDmgMult: (zone.enemyDmgMult ?? 1) * HARD.dmgMult * k.dmg,
    coinMult: zone.coinMult * HARD.coinMult,
    rounds: zone.rounds.map((r) => ({
      ...r,
      groups: r.groups.map((g) => {
        if (r.boss) return { ...g };
        const count = Math.round(g.count * HARD.minionMult);
        // Same spawn window, packed tighter.
        return { ...g, count, interval: (g.interval * g.count) / count };
      }),
    })),
  };
}

/** Hard mode for an arena opens once its normal clear is done. */
export function hardUnlocked(p: Progression, zoneIndex: number): boolean {
  const z = ZONES[zoneIndex];
  return !!z && p.zoneRecord(z.id).cleared;
}

/** True once the arena's Hard mode has been beaten. */
export function hardCleared(p: Progression, zoneIndex: number): boolean {
  const z = ZONES[zoneIndex];
  return !!z && !!p.data.hardCleared?.[z.id];
}

/** Coins the next Hard clear of this arena pays (first clear vs repeat). */
export function hardReward(p: Progression, zoneIndex: number): number {
  const z = ZONES[zoneIndex];
  if (!z) return 0;
  return Math.round(z.clearReward * (hardCleared(p, zoneIndex) ? HARD.repeatClearMult : HARD.firstClearMult));
}

/** Record a Hard-mode clear; returns the coin reward for it (Game adds the coins). */
export function recordHardClear(p: Progression, zoneIndex: number): number {
  const z = ZONES[zoneIndex];
  if (!z) return 0;
  const reward = hardReward(p, zoneIndex);
  (p.data.hardCleared ??= {})[z.id] = true;
  p.commit();
  return reward;
}

/* ------------------------------------------------------------------ stars */

/** The arena's challenges (five each; empty for unknown indices). */
export function zoneChallenges(zoneIndex: number): ChallengeDef[] {
  const z = ZONES[zoneIndex];
  return (z && CHALLENGES[z.id]) || [];
}

/** Challenge ids already earned in this arena. */
export function earnedIds(p: Progression, zoneIndex: number): Set<string> {
  const z = ZONES[zoneIndex];
  return new Set(z ? p.data.challenges?.[z.id] ?? [] : []);
}

/** Stars earned in this arena (only ids that still exist count). */
export function zoneStars(p: Progression, zoneIndex: number): number {
  const got = earnedIds(p, zoneIndex);
  return zoneChallenges(zoneIndex).filter((c) => got.has(c.id)).length;
}

/** Every challenge star in the campaign. */
export function maxStars(): number {
  return ZONES.reduce((n, _, i) => n + zoneChallenges(i).length, 0);
}

/** Coins per newly earned star in this arena. */
export function starReward(zoneIndex: number): number {
  const z = ZONES[zoneIndex];
  return z ? Math.round(z.clearReward * STAR_REWARD_FRAC) : 0;
}

/** '★★☆' for `got` of `total` (zoneChallenges(i).length for an arena). */
export function starString(got: number, total = 3): string {
  return '★'.repeat(Math.min(got, total)) + '☆'.repeat(Math.max(0, total - got));
}

export interface ChallengeResult {
  def: ChallengeDef;
  /** Goal met on this run. */
  met: boolean;
  /** Star earned for the first time on this run. */
  isNew: boolean;
  /** Star owned (before or after this run). */
  owned: boolean;
}

export interface ChallengeReport {
  zoneIndex: number;
  hard: boolean;
  won: boolean;
  results: ChallengeResult[];
  newStars: number;
  /** Coins paid for the new stars. */
  bonus: number;
  /** Stars in this arena after the run. */
  stars: number;
}

/** Judge a finished campaign run: stars only on a win (normal or Hard). Pure: no save changes. */
export function evaluateRun(p: Progression, run: ChallengeRun): ChallengeReport | null {
  if (run.mode !== 'campaign' || run.zoneIndex === undefined) return null;
  const zi = run.zoneIndex;
  const got = earnedIds(p, zi);
  const results = zoneChallenges(zi).map((def) => {
    const met = run.won && def.test(run);
    return { def, met, isNew: met && !got.has(def.id), owned: met || got.has(def.id) };
  });
  const newStars = results.filter((r) => r.isNew).length;
  return {
    zoneIndex: zi,
    hard: !!run.hard,
    won: run.won,
    results,
    newStars,
    bonus: newStars * starReward(zi),
    stars: results.filter((r) => r.owned).length,
  };
}

/** Evaluate and bank a run: saves new stars and pays their bonus once. Returns the report. */
export function awardRun(p: Progression, run: ChallengeRun): ChallengeReport | null {
  const rep = evaluateRun(p, run);
  if (!rep || rep.newStars === 0) return rep;
  const z = ZONES[rep.zoneIndex];
  const list = ((p.data.challenges ??= {})[z.id] ??= []);
  for (const r of rep.results) if (r.isNew && !list.includes(r.def.id)) list.push(r.def.id);
  if (rep.bonus > 0) p.addCoins(rep.bonus); // saves + notifies
  else p.commit();
  return rep;
}

/* ------------------------------------------------------------------ tracker */

let lastReport: ChallengeReport | null = null;

/** Verdict of the most recent campaign run (null after a Survival / Brawl run). Read by the results screen. */
export function lastChallengeReport(): ChallengeReport | null {
  return lastReport;
}

/** Listens for runFinished and awards challenge stars. Constructed once by Game. */
export class ChallengeTracker {
  private bossStart = 0;
  private inBoss = false;
  private bossDamage = 0;
  private strikes = 0;
  private rushHits = 0;
  /** Signature-weapon kills this run (reset in place, never reallocated). */
  private weaponKills: Partial<Record<KillWeapon, number>> = {};

  constructor(private ctx: GameContext) {
    // PROTOCOL C's own five stars ride along (Game constructs only this tracker); campaign judging is unchanged.
    new ProtocolStarTracker(ctx);
    const ev = ctx.events;
    ev.on('roundStarted', ({ round, boss }) => {
      if (round === 1) this.reset();
      if (boss) {
        this.inBoss = true;
        this.bossStart = ctx.time;
      }
    });
    ev.on('plowDamaged', ({ amount }) => {
      if (this.inBoss) this.bossDamage += amount;
    });
    ev.on('strike', () => this.strikes++);
    ev.on('plowRush', ({ hits }) => (this.rushHits += hits));
    ev.on('enemyKilled', ({ weapon }) => {
      if (weapon) this.weaponKills[weapon] = (this.weaponKills[weapon] ?? 0) + 1;
    });
    ev.on('runFinished', (r) => this.onRunFinished(r));
  }

  private reset(): void {
    this.bossStart = 0;
    this.inBoss = false;
    this.bossDamage = 0;
    this.strikes = 0;
    this.rushHits = 0;
    for (const k in this.weaponKills) delete this.weaponKills[k as KillWeapon];
  }

  private onRunFinished(r: GameEvents['runFinished']): void {
    if (r.mode !== 'campaign') {
      lastReport = null;
      return;
    }
    const { ctx } = this;
    const run: ChallengeRun = {
      ...r,
      bossTime: this.inBoss ? Math.max(0, ctx.time - this.bossStart) : 0,
      bossDamage: this.bossDamage,
      strikes: this.strikes,
      rushHits: this.rushHits,
      weaponKills: { ...this.weaponKills },
    };
    lastReport = awardRun(ctx.progression, run);
    this.reset();
    const rep = lastReport;
    if (!rep || !rep.newStars) return;
    // The results screen clears in-game toasts as it opens, so announce the stars just after (one toast).
    const names = rep.results.filter((x) => x.isNew).map((x) => x.def.name);
    const text = `★ ${rep.newStars > 1 ? `${rep.newStars} new stars` : names[0]}! +${rep.bonus.toLocaleString('en-US')} coins`;
    setTimeout(() => ctx.ui.toast(text, 'good'), 700);
  }
}

/* ------------------------------------------------------------------ PROTOCOL C stars */

/** PROTOCOL C star ids earned (known ids only; save.protocol.stars). Never part of totalStars / maxStars. */
export function protocolStarIds(p: Progression): Set<string> {
  const ids = p.data.protocol?.stars;
  const known = new Set(PROTOCOL_CHALLENGES.map((c) => c.id));
  return new Set(Array.isArray(ids) ? ids.filter((id) => known.has(id)) : []);
}

export function protocolStars(p: Progression): number {
  return protocolStarIds(p).size;
}

export interface ProtocolStarResult {
  def: ProtocolChallengeDef;
  met: boolean;
  isNew: boolean;
  owned: boolean;
}

export interface ProtocolStarReport {
  won: boolean;
  results: ProtocolStarResult[];
  newStars: number;
  bonus: number;
  stars: number;
}

/** Judge a finished PROTOCOL C run: stars only on a clear. Pure: no save changes. */
export function evaluateProtocolRun(p: Progression, run: ProtocolRun): ProtocolStarReport {
  const got = protocolStarIds(p);
  const results = PROTOCOL_CHALLENGES.map((def) => {
    const met = run.won && def.test(run);
    return { def, met, isNew: met && !got.has(def.id), owned: met || got.has(def.id) };
  });
  const newStars = results.filter((r) => r.isNew).length;
  return { won: run.won, results, newStars, bonus: newStars * PROTOCOL_STAR_REWARD, stars: results.filter((r) => r.owned).length };
}

/** Evaluate and bank a PROTOCOL C run: saves new stars (save.protocol.stars) and pays their bonus once. */
export function awardProtocolRun(p: Progression, run: ProtocolRun): ProtocolStarReport {
  const rep = evaluateProtocolRun(p, run);
  if (!rep.newStars) return rep;
  const pr = (p.data.protocol ??= { cleared: false, clears: 0, bestTime: 0, bestWave: 0, cleanClear: false, checkpoint: null });
  const list = (pr.stars ??= []);
  for (const r of rep.results) if (r.isNew && !list.includes(r.def.id)) list.push(r.def.id);
  if (rep.bonus > 0) p.addCoins(rep.bonus);
  else p.commit();
  return rep;
}

let lastProtocol: ProtocolStarReport | null = null;

/** Verdict of the most recent PROTOCOL C run (null after any other run). Read by the PROTOCOL C results screen. */
export function lastProtocolReport(): ProtocolStarReport | null {
  return lastProtocol;
}

/** THE CHAIRMAN lands this long after he spawns (enemies/chairman.ts CH.REVEAL_T, his descent from the box). */
export const CHAIRMAN_LAND_DELAY = 2.8;

/**
 * Measures a PROTOCOL C run for its stars (constructed by ChallengeTracker): HP lost per whole wave, wave 6's echo
 * sweep, THE CHAIRMAN's time from landing, and the finale's first AVALANCHE ('avalancheHit'). Only listens while the
 * zone is PROTOCOL C; every other run is ignored (and clears the last verdict).
 */
export class ProtocolStarTracker {
  private wave = 0;
  private waveDmg = 0;
  private readonly waveDamage: number[] = new Array(PROTOCOL_WAVES).fill(NaN);
  private sweepStart = -1;
  private sweepKills = 0;
  private sweepEnd = -1;
  private chairLand = -1;
  private chairTime = Infinity;
  private avalanche: boolean | null = null;

  constructor(private ctx: GameContext) {
    const ev = ctx.events;
    ev.on('roundStarted', ({ round }) => {
      if (!this.active()) return;
      // A new run (fresh start, or a RETRY WAVE / RESUME from a checkpoint) never moves forward from the last wave.
      if (round <= this.wave) this.reset();
      else if (this.wave > 0) this.waveDamage[this.wave - 1] = this.waveDmg;
      this.wave = round;
      this.waveDmg = 0;
    });
    ev.on('plowDamaged', ({ amount }) => {
      if (this.active() && this.wave > 0) this.waveDmg += Math.max(0, amount);
    });
    ev.on('bossSpawned', ({ enemy }) => {
      if (!this.active()) return;
      if (enemy.echo && this.wave === PROTOCOL_STAR_SWEEP_WAVE && this.sweepStart < 0) this.sweepStart = ctx.time;
      if (enemy.type === 'chairman' && !enemy.echo) this.chairLand = ctx.time + CHAIRMAN_LAND_DELAY;
    });
    ev.on('bossDefeated', ({ enemy }) => {
      if (!this.active()) return;
      if (enemy.echo && this.wave === PROTOCOL_STAR_SWEEP_WAVE && this.sweepStart >= 0) {
        this.sweepKills++;
        if (this.sweepKills >= waveBossCount(PROTOCOL_STAR_SWEEP_WAVE).echoes && this.sweepEnd < 0) this.sweepEnd = ctx.time;
      }
      if (enemy.type === 'chairman' && !enemy.echo && this.chairLand >= 0) this.chairTime = Math.max(0, ctx.time - this.chairLand);
    });
    ev.on('avalancheHit', ({ fullSize, attempt }) => {
      if (this.active() && this.avalanche === null) this.avalanche = attempt <= 1 && fullSize;
    });
    ev.on('runFinished', (r) => this.onRunFinished(r));
  }

  private active(): boolean {
    return this.ctx.zone?.id === PROTOCOL_ID;
  }

  private reset(): void {
    this.wave = 0;
    this.waveDmg = 0;
    this.waveDamage.fill(NaN);
    this.sweepStart = this.sweepEnd = this.chairLand = -1;
    this.sweepKills = 0;
    this.chairTime = Infinity;
    this.avalanche = null;
  }

  /** The run so far as the stars see it (`won`: the last wave counts as played whole). */
  snapshot(r: GameEvents['runFinished']): ProtocolRun {
    const waveDamage = [...this.waveDamage];
    if (r.won && this.wave > 0) waveDamage[this.wave - 1] = this.waveDmg;
    return {
      ...r,
      waveDamage,
      echoSweep: this.sweepStart >= 0 && this.sweepEnd >= 0 ? this.sweepEnd - this.sweepStart : Infinity,
      chairmanTime: this.chairTime,
      avalancheFirstTry: r.avalancheFirstTry ?? this.avalanche ?? false,
    };
  }

  private onRunFinished(r: GameEvents['runFinished']): void {
    if (!r.protocol) {
      lastProtocol = null;
      return;
    }
    const run = this.snapshot(r);
    this.reset();
    lastProtocol = awardProtocolRun(this.ctx.progression, run);
    const rep = lastProtocol;
    if (!rep.newStars) return;
    const names = rep.results.filter((x) => x.isNew).map((x) => x.def.name);
    const text = `★ ${rep.newStars > 1 ? `${rep.newStars} PROTOCOL C stars` : names[0]}! +${rep.bonus.toLocaleString('en-US')} coins`;
    setTimeout(() => this.ctx.ui.toast(text, 'good'), 900);
  }
}
