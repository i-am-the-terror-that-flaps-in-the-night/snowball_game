import type { GameContext, ZoneDef } from '../core/types';
import type { Progression } from '../core/Progression';
import type { RoundDef, SpawnGroup } from '../config/zones';
import { ZONES } from '../config/zones';
import { ENEMIES, type EnemyType } from '../config/enemies';

/* SURVIVAL: endless post-campaign mode in one arena. Each wave is generated into a one-round ZoneDef
 * (zone.rounds[0]) so the regular WaveDirector / EnemyManager run it unchanged; per-wave scaling is
 * written onto that zone (enemyHpMult for bot hp incl. summons, coinMult for kill coins, enemyDmgMult
 * for bot hits on the plow). Every BOSS_EVERY-th wave is a boss wave cycling through the campaign bosses.
 * Game owns the flow (countdown -> playing -> cleared -> breather countdown ...). */

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

/** Spawn-budget cost + first wave each minion type may appear in. */
const MINIONS: { type: EnemyType; cost: number; from: number }[] = [
  { type: 'scrapper', cost: 1, from: 1 },
  { type: 'thief', cost: 1.4, from: 2 },
  { type: 'spinner', cost: 2, from: 3 },
  { type: 'brute', cost: 3, from: 4 },
];

/** Boss cycle (one entry per boss wave); twins come as a pair. */
const BOSS_CYCLE: { types: EnemyType[]; name: string }[] = [
  { types: ['bulldoza'], name: 'BULLDOZA' },
  { types: ['frostbyte'], name: 'FROSTBYTE' },
  { types: ['grinder'], name: 'THE GRINDER' },
  { types: ['slush', 'sleet'], name: 'SLUSH & SLEET' },
  { types: ['omega'], name: 'MEGAPLOW Ω' },
];

/** Enemy hp multiplier for wave w (1-based): linear early, gently exponential late. */
export const waveHpMult = (w: number) => (1 + 0.1 * (w - 1)) * Math.pow(1.02, w - 1);
/** Enemy hit damage multiplier for wave w. */
export const waveDmgMult = (w: number) => 1 + 0.05 * (w - 1);
/** Kill-coin multiplier for wave w. */
export const waveCoinMult = (w: number) => 1 + 0.06 * (w - 1);
/** Bonus coins for clearing wave w (boss waves pay triple). */
export const waveClearBonus = (w: number) => Math.round((10 + 6 * w) * (w % BOSS_EVERY === 0 ? 3 : 1));

/** Unlocked after beating arena 1 (also true in ?debug, which unlocks every arena). */
export function survivalUnlocked(p: Progression): boolean {
  return p.data.unlockedZones > 1 || p.zoneRecord(ZONES[0].id).cleared;
}

export function survivalBest(p: Progression): number {
  return p.data.survivalBestWave ?? 0;
}

export class SurvivalManager {
  private ctx: GameContext;
  /** The survival arena: Frozen Foundry scenery, rounds/multipliers rewritten every wave. */
  readonly zone: ZoneDef;
  /** Current wave, 1-based (0 before the first wave). */
  wave = 0;
  /** Waves fully cleared this run. */
  cleared = 0;
  /** Best wave at the start of this run (for "NEW BEST" checks). */
  private prevBest = 0;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    const base = ZONES[2];
    this.zone = {
      ...base,
      id: 'survival',
      name: `Survival · ${base.name}`,
      tagline: 'Endless waves. Bosses every 5. How long can you last?',
      bossName: '',
      rounds: [{ groups: [] }],
      clearReward: 0,
      enemyHpMult: 1,
      coinMult: 1,
      enemyDmgMult: 1,
    };
  }

  /** Fresh run. */
  reset(): void {
    this.wave = 0;
    this.cleared = 0;
    this.prevBest = survivalBest(this.ctx.progression);
  }

  get isBossWave(): boolean {
    return this.wave > 0 && this.wave % BOSS_EVERY === 0;
  }

  /** Boss lineup of the current wave (empty on minion waves). */
  get boss(): { types: EnemyType[]; name: string } | null {
    if (!this.isBossWave) return null;
    return BOSS_CYCLE[(this.wave / BOSS_EVERY - 1) % BOSS_CYCLE.length];
  }

  /** Advance to the next wave: generate its round and apply scaling. Returns the breather length. */
  nextWave(): number {
    const w = ++this.wave;
    const z = this.zone;
    z.enemyHpMult = waveHpMult(w);
    z.enemyDmgMult = waveDmgMult(w);
    z.coinMult = waveCoinMult(w);
    const round: RoundDef = this.isBossWave ? this.bossRound(w) : this.minionRound(w);
    z.rounds[0] = round;
    z.bossName = this.boss?.name ?? '';
    if (w === 1) return FIRST_WAVE_SECONDS;
    return this.isBossWave ? BOSS_BREATHER_SECONDS : BREATHER_SECONDS;
  }

  /** Wave cleared: pay the bonus, patch the plow up a bit. Returns the bonus. */
  waveCleared(): number {
    const { ctx } = this;
    this.cleared = this.wave;
    const bonus = waveClearBonus(this.wave);
    ctx.progression.addCoins(bonus);
    const plow = ctx.plow;
    plow.hp = Math.min(plow.maxHp, plow.hp + ctx.stats.repairFraction * WAVE_REPAIR * plow.maxHp);
    return bonus;
  }

  /** Run over: persist the best wave + kills. Returns true on a new record. */
  finish(kills: number): boolean {
    const p = this.ctx.progression;
    const newBest = this.wave > this.prevBest;
    if (newBest) p.data.survivalBestWave = this.wave;
    p.data.totalKills += kills;
    p.save();
    return newBest;
  }

  get best(): number {
    return Math.max(this.prevBest, this.wave);
  }

  hud(): { wave: number; best: number } {
    return { wave: this.wave, best: this.best };
  }

  /* ------------------------------------------------------------------ wave generation */

  /** Budget-based mix of the unlocked minion types; faster spawn pacing as waves climb. */
  private minionRound(w: number): RoundDef {
    let budget = 3 + w * 2.2;
    const pool = MINIONS.filter((m) => w >= m.from);
    const counts = new Map<EnemyType, number>();
    let n = 0;
    // Always lead with a couple of scrappers so every wave opens with something to hit.
    const lead = Math.min(2 + Math.floor(w / 4), 5);
    counts.set('scrapper', lead);
    budget -= lead;
    n += lead;
    while (budget >= 1 && n < MAX_WAVE_BOTS) {
      const m = pool[Math.floor(Math.random() * pool.length)];
      if (m.cost > budget) {
        budget -= 0.5; // can't afford it: burn a bit so the loop always ends
        continue;
      }
      counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
      budget -= m.cost;
      n++;
    }
    const pace = Math.max(0.55, 2.4 - w * 0.08);
    const groups: SpawnGroup[] = [];
    let delay = 0;
    for (const [type, count] of counts) {
      const interval = pace * (ENEMIES[type].radius > 1.2 ? 1.6 : 1);
      groups.push({ type, count, delay, interval });
      delay += Math.min(8, count * interval * 0.5) + 1;
    }
    return { groups };
  }

  /** The cycle's boss(es); from the second lap on, escort minions join after a short delay. */
  private bossRound(w: number): RoundDef {
    const b = this.boss!;
    const groups: SpawnGroup[] = b.types.map((type, i) => ({ type, count: 1, delay: 1 + i * 0.5, interval: 1 }));
    const lap = Math.floor((w / BOSS_EVERY - 1) / BOSS_CYCLE.length);
    if (lap > 0) {
      groups.push({ type: 'scrapper', count: 2 + lap * 2, delay: 6, interval: 1.5 });
      if (lap > 1) groups.push({ type: 'spinner', count: lap, delay: 12, interval: 3 });
    }
    return { boss: true, groups };
  }
}
