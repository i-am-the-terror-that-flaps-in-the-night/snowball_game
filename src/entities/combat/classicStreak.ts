/* The Classic Plow's signature passive, STREAK (pure numbers + a small state machine, no scene): every slam or PLOW
 * RUSH slam that hits a bot the previous one didn't adds a stack (max STREAK_MAX); re-hitting the same bots holds the
 * streak but adds nothing; STREAK_WINDOW s without a new-target hit drops every stack. Each stack: +STREAK_DAMAGE slam
 * damage, +STREAK_SPEED top speed and STREAK_REFUND of the dash / rush meter back. At STREAK_MAX the plow is ON STREAK:
 * its next slam is the SHOCKWAVE FINISHER (FINISHER_* below), then the stacks reset. Off in the online Duel. ClassicKit
 * (combat/classic.ts) owns one and plays the effects; the Plow reads the stacks for top speed and its afterimages /
 * hull glow (plow/streakFx.ts). See docs/plows.md "Classic Plow". */

/** Stacks at most (the last one makes the plow ON STREAK). */
export const STREAK_MAX = 4;
/** Seconds after the last new-target hit before every stack drops. */
export const STREAK_WINDOW = 3.5;
/** Per stack: slam damage, top speed, share of the dash / rush meter refunded when the stack is gained. */
export const STREAK_DAMAGE = 0.18;
export const STREAK_SPEED = 0.08;
export const STREAK_REFUND = 0.15;
/** SHOCKWAVE FINISHER (the slam after ON STREAK): zone radius x, damage x (on top of the stacks), knockback x, and a
 *  forced hit-stop (s) on everything it hits (fx/impact.ts 'finisher'). */
export const FINISHER_RADIUS = 2;
export const FINISHER_DAMAGE = 1.6;
export const FINISHER_KNOCK = 1.8;
export const FINISHER_HITSTOP = 0.08;
/** The finisher hits at least as if the held ball were FINISHER_MIN_BALL of the max ball radius, and never under
 *  FINISHER_MIN_R m (a ball-less rush slam's 0.6 m would waste it); the snow actually spent is unchanged. */
export const FINISHER_MIN_BALL = 0.5;
export const FINISHER_MIN_R = 0.9;

/** Ball radius a slam of radius `r` hits with (the finisher's floor, see FINISHER_MIN_BALL). */
export const finisherBall = (r: number, maxBallRadius: number, finisher: boolean) =>
  finisher ? Math.max(r, FINISHER_MIN_R, FINISHER_MIN_BALL * maxBallRadius) : r;
/** Ids of the previous slam's targets kept for the "different target" test (a slam hitting more only counts these). */
const REMEMBER = 16;

/** Stack colours (1..4: white, cyan, gold, hot red-orange) and their deep shades (outlines, readable on white snow). */
export const STREAK_COLORS = [0xffffff, 0x2ee6ff, 0xffc21a, 0xff4a12] as const;
export const STREAK_DEEP = [0x3d5f8f, 0x0a7fc0, 0xb86e00, 0xa01500] as const;
export const STREAK_CSS = ['#ffffff', '#2ee6ff', '#ffc21a', '#ff4a12'] as const;

/** Colour of `stacks` (1..STREAK_MAX; 0 reads as the first). */
export const streakColor = (stacks: number) => STREAK_COLORS[Math.max(0, Math.min(STREAK_MAX, stacks) - 1)];
export const streakDeep = (stacks: number) => STREAK_DEEP[Math.max(0, Math.min(STREAK_MAX, stacks) - 1)];

/** Slam damage multiplier for `stacks` (the finisher adds FINISHER_DAMAGE on top). */
export const streakDamage = (stacks: number, finisher = false) => (1 + STREAK_DAMAGE * Math.max(0, Math.min(STREAK_MAX, stacks))) * (finisher ? FINISHER_DAMAGE : 1);

/** Top-speed multiplier for `stacks`. */
export const streakSpeed = (stacks: number) => 1 + STREAK_SPEED * Math.max(0, Math.min(STREAK_MAX, stacks));

/** What one landed slam did to the streak: None (hit nothing), Hold (only bots the previous slam already hit: the
 *  window keeps running), Stack (a new target: +1 stack, window restarts), Refresh (a new target while already ON
 *  STREAK and this slam was not the finisher: window restarts), Finish (the SHOCKWAVE FINISHER landed: stacks reset). */
export const StreakHit = { None: 0, Hold: 1, Stack: 2, Refresh: 3, Finish: 4 } as const;
export type StreakHit = (typeof StreakHit)[keyof typeof StreakHit];

export class StreakState {
  /** 0..STREAK_MAX. */
  stacks = 0;
  /** Seconds since the last new-target hit (only counts while stacks > 0). */
  t = 0;
  private prev = new Float64Array(REMEMBER);
  private prevN = 0;

  /** ON STREAK: the next slam is the SHOCKWAVE FINISHER. */
  get onStreak(): boolean {
    return this.stacks >= STREAK_MAX;
  }

  /** Share of the window left (1 = just stacked, 0 = about to drop; 0 with no stacks). */
  get left(): number {
    return this.stacks > 0 ? Math.max(0, 1 - this.t / STREAK_WINDOW) : 0;
  }

  /** Advance the window. Returns the stacks dropped this step (0 = none). */
  update(dt: number): number {
    if (this.stacks <= 0) return 0;
    this.t += dt;
    if (this.t < STREAK_WINDOW) return 0;
    const n = this.stacks;
    this.stacks = 0;
    this.t = 0;
    return n;
  }

  /** A slam landed on the first `n` of `hits` (bots / the Duel opponent, by id). `finisher`: it was fired ON STREAK.
   *  A finisher that hits nothing changes nothing (the streak is kept for the next slam). */
  land(hits: ArrayLike<{ readonly id: number }>, n: number, finisher: boolean): StreakHit {
    if (n <= 0) return StreakHit.None;
    let fresh = false;
    for (let i = 0; i < n && !fresh; i++) {
      let seen = false;
      for (let j = 0; j < this.prevN; j++) {
        if (this.prev[j] === hits[i].id) {
          seen = true;
          break;
        }
      }
      if (!seen) fresh = true;
    }
    this.prevN = Math.min(REMEMBER, n);
    for (let i = 0; i < this.prevN; i++) this.prev[i] = hits[i].id;
    if (finisher) {
      this.stacks = 0;
      this.t = 0;
      return StreakHit.Finish;
    }
    if (!fresh) return StreakHit.Hold;
    this.t = 0;
    if (this.stacks >= STREAK_MAX) return StreakHit.Refresh;
    this.stacks++;
    return StreakHit.Stack;
  }

  clear(): void {
    this.stacks = 0;
    this.t = 0;
    this.prevN = 0;
  }
}
