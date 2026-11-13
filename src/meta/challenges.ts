import type { GameContext } from '../core/types';
import type { Progression } from '../core/Progression';
import type { GameEvents, KillWeapon } from '../core/events';
import { ZONES, type ZoneDef } from '../config/zones';
import { CHALLENGES, HARD, STAR_REWARD_FRAC, type ChallengeDef, type ChallengeRun } from '../config/challenges';
import { UPGRADES, type UpgradeId } from '../config/upgrades';
import type { PlowKind } from '../config/plows';

/* Campaign meta: five star challenges per arena (config/challenges.ts) and a Hard mode for every arena.
 *  - Stars live in save.challenges[zoneId] = [challenge ids]; each pays a one-time coin bonus.
 *  - Hard mode opens once the arena's normal clear is done; clears live in save.hardCleared[zoneId].
 *  - ChallengeTracker (constructed once by Game) tallies a few extras from events, judges every finished
 *    campaign run and keeps the verdict for the results screen (lastChallengeReport). */

export type { ChallengeDef, ChallengeRun } from '../config/challenges';
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
