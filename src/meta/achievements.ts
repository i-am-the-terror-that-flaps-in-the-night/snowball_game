import type { GameContext } from '../core/types';
import type { Progression } from '../core/Progression';
import type { GameEvents } from '../core/events';
import { ACHIEVEMENTS, CLEAN_CLEAR_HP, LIFE, lifeBoss, lifeRunsMode, lifeRunsPlow, lifeWinsPlow, type AchievementDef } from '../config/achievements';
import { BRAWL_BOTS } from '../config/brawl';
import { bumpLifetime, maxLifetime } from './progress';

/* Achievements: event handlers bump lifetime counters in the save (mutated live, saved in batches by
 * p.commit() on unlock / run end), and every check re-evaluates ACHIEVEMENTS against the save. Rewards are
 * paid exactly once: an id is marked in SaveData.achievements before its coins are added. */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Make sure the save's lifetime / achievements maps are plain objects (an old or hand-edited localStorage
 *  save is only spread, not sanitized). */
export function ensureMetaMaps(p: Progression): void {
  if (!isObj(p.data.lifetime)) p.data.lifetime = {};
  if (!isObj(p.data.achievements)) p.data.achievements = {};
}

export function isUnlocked(p: Progression, id: string): boolean {
  const a = p.data.achievements;
  return isObj(a) && typeof a[id] === 'number' && (a[id] as number) > 0;
}

/** Progress value for an achievement (0 if its save fields are missing or malformed). */
export function achievementValue(p: Progression, def: AchievementDef): number {
  try {
    const v = def.value(p);
    return typeof v === 'number' && isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

/** Progress as a 0..1 fraction (1 once unlocked). */
export function achievementProgress(p: Progression, def: AchievementDef): number {
  if (isUnlocked(p, def.id)) return 1;
  return Math.max(0, Math.min(1, achievementValue(p, def) / def.goal));
}

/**
 * Unlock every achievement whose goal is met and pay its reward into the save (coins + totalCoinsEarned).
 * Does not save: the caller commits. Loops because rewards raise totalCoinsEarned (coin achievements).
 * Returns the newly unlocked achievements, in list order.
 */
export function unlockNew(p: Progression): AchievementDef[] {
  ensureMetaMaps(p);
  const got: AchievementDef[] = [];
  for (let pass = 0; pass < 4; pass++) {
    let any = false;
    for (const def of ACHIEVEMENTS) {
      if (isUnlocked(p, def.id) || achievementValue(p, def) < def.goal) continue;
      p.data.achievements![def.id] = 1;
      p.data.coins += def.reward;
      p.data.totalCoinsEarned += def.reward;
      bumpLifetime(p, LIFE.achievementCoins, def.reward);
      got.push(def);
      any = true;
    }
    if (!any) break;
  }
  return got;
}

/** Fold one finished run into the lifetime counters (pure save edit, no commit). */
export function recordRunLifetime(p: Progression, r: GameEvents['runFinished']): void {
  ensureMetaMaps(p);
  const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : 0);
  bumpLifetime(p, LIFE.runs);
  bumpLifetime(p, lifeRunsMode(r.mode));
  bumpLifetime(p, lifeRunsPlow(r.plow));
  bumpLifetime(p, LIFE.playTime, Math.max(0, Math.round(n(r.duration))));
  bumpLifetime(p, LIFE.damageTaken, Math.max(0, Math.round(n(r.damageTaken))));
  maxLifetime(p, LIFE.comboBest, n(r.bestCombo));
  maxLifetime(p, LIFE.ballBestCm, Math.round(n(r.biggestBall) * 100));
  if (r.mode === 'campaign' && r.won) {
    bumpLifetime(p, LIFE.campaignWins);
    bumpLifetime(p, lifeWinsPlow(r.plow));
    if (n(r.damageTaken) < CLEAN_CLEAR_HP) bumpLifetime(p, LIFE.cleanClears);
  }
  if (r.mode === 'brawl') {
    if (r.won && r.brawlDifficulty === 'legend') bumpLifetime(p, LIFE.brawlWinsLegend);
    if (n(r.placement) >= BRAWL_BOTS + 1) bumpLifetime(p, LIFE.brawlLast);
    maxLifetime(p, LIFE.brawlStreakBest, n(r.bestStreak));
  }
  if (r.mode === 'survival' && r.daily) {
    bumpLifetime(p, LIFE.dailyRuns);
    maxLifetime(p, LIFE.dailyBestWave, n(r.wave));
  }
}

/** Listens to game events, keeps lifetime counters and unlocks achievements. Constructed once by Game. */
export class Achievements {
  private ctx: GameContext;
  private checking = false;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    const { events } = ctx;
    const p = () => ctx.progression;

    events.on('enemyKilled', ({ source }) => {
      if (this.tutorial()) return;
      bumpLifetime(p(), LIFE.kills);
      bumpLifetime(p(), SOURCE_KEY[source ?? 'other'] ?? LIFE.killsOther);
      this.check();
    });
    events.on('slam', ({ hits }) => {
      if (this.tutorial()) return;
      bumpLifetime(p(), LIFE.slams);
      maxLifetime(p(), LIFE.slamHitsBest, hits);
      this.check();
    });
    events.on('strike', () => {
      if (this.tutorial()) return;
      bumpLifetime(p(), LIFE.strikes);
      this.check();
    });
    events.on('bossDefeated', ({ enemy }) => {
      if (this.tutorial()) return;
      bumpLifetime(p(), LIFE.bossKills);
      bumpLifetime(p(), lifeBoss(enemy.type));
      this.check();
    });
    events.on('brawlKill', ({ killerIsPlayer, method }) => {
      if (!killerIsPlayer) return;
      bumpLifetime(p(), LIFE.brawlKills);
      if (method === 'zap') bumpLifetime(p(), LIFE.brawlKillsZap);
      if (method === 'pound') bumpLifetime(p(), LIFE.brawlKillsPound);
      this.check();
    });
    events.on('brawlStreak', ({ isPlayer, count }) => {
      if (!isPlayer) return;
      maxLifetime(p(), LIFE.brawlStreakBest, count);
      this.check();
    });
    events.on('brawlShutdown', ({ killerIsPlayer }) => {
      if (!killerIsPlayer) return;
      bumpLifetime(p(), LIFE.brawlShutdowns);
      this.check();
    });
    events.on('runFinished', (r) => {
      recordRunLifetime(p(), r);
      // The results screen opens right after this event and clears toasts: announce once it's up.
      if (!this.check(700)) p().commit();
    });
    // Save-state achievements (arena clears, coins, upgrades, cosmetics, stars, imports...). commit() inside
    // check() notifies again; the `checking` guard (and nothing new to unlock) ends that loop.
    ctx.progression.onChange(() => this.check(300));
    // Retroactive unlocks for saves from before achievements existed.
    setTimeout(() => this.check(), 1200);
  }

  /** The Tutorial runs arena 1 with coinMult 0 (Game's TUTORIAL_ZONE): its fights don't count. */
  private tutorial(): boolean {
    return this.ctx.zone?.coinMult === 0;
  }

  /** Unlock whatever is due; commits and announces if anything unlocked. Returns whether anything did. */
  check(toastDelay = 0): boolean {
    if (this.checking) return false;
    this.checking = true;
    let got: AchievementDef[] = [];
    try {
      got = unlockNew(this.ctx.progression);
      if (got.length) this.ctx.progression.commit();
    } finally {
      this.checking = false;
    }
    if (got.length) this.announce(got, toastDelay);
    return got.length > 0;
  }

  private announce(got: AchievementDef[], delay: number): void {
    const { ui, audio } = this.ctx;
    const show = () => {
      if (got.length > 3) {
        const coins = got.reduce((s, a) => s + a.reward, 0);
        ui.toast(`🏆 ${got.length} achievements unlocked! +${coins.toLocaleString('en-US')} coins`, 'good');
      } else {
        for (const a of got) ui.toast(`🏆 ${a.name}  +${a.reward.toLocaleString('en-US')}`, 'good');
      }
      audio?.play('roundClear', { volume: 0.7 });
    };
    if (delay > 0) setTimeout(show, delay);
    else show();
  }
}

const SOURCE_KEY: Record<string, string> = {
  slam: LIFE.killsSlam,
  ram: LIFE.killsRam,
  whirl: LIFE.killsWhirl,
  other: LIFE.killsOther,
};
