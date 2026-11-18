import type { EnemyHandle, GameContext } from '../core/types';
import { keyLabel, type Action } from '../core/input';
import { PLOWS } from '../config/plows';
import { F_INFO } from './Tutorial';

/* Just-in-time tips (onboarding): the quick first tutorial only teaches drive / plow / slam; everything else is taught
 * the first time it becomes useful in a real run, one short radio-style tip at a time:
 *   dash (a few seconds in), whirlwind (two or more bots close), the F special (first time it is charged with a bot
 *   near), the ball shield (first blocked hit), air slam (first time airborne), the Garage (first round cleared).
 * Each tip shows once per browser (localStorage, like the tutorial flag; RESET SAVE does not replay them); the full
 * tutorial marks them all seen. At most one tip every TIP_GAP seconds. Campaign / Survival only (not the tutorial,
 * Brawl or the Duel). */

const KEY = 'snowplow-showdown-tips';
const TIP_GAP = 14;
export type TipId = 'dash' | 'whirl' | 'special' | 'shield' | 'air' | 'garage';
const ALL: TipId[] = ['dash', 'whirl', 'special', 'shield', 'air', 'garage'];

function load(): Set<string> {
  try {
    const v = localStorage.getItem(KEY);
    return new Set(v ? (v === 'all' ? ALL : v.split(',')) : []);
  } catch {
    return new Set(ALL);
  }
}

export class FieldTips {
  private seen = load();
  private gap = 4;
  private runT = 0;
  private queued: TipId[] = [];
  private readonly near: EnemyHandle[] = [];
  private unsub: (() => void)[] = [];

  constructor(private readonly ctx: GameContext) {
    this.unsub.push(
      ctx.events.on('plowDamaged', ({ blocked }) => {
        if (blocked > 0) this.want('shield');
      }),
      ctx.events.on('plowLaunched', () => this.want('air')),
    );
  }

  /** Every tip done (the full tutorial covers them all). */
  static markAllSeen(): void {
    try {
      localStorage.setItem(KEY, 'all');
    } catch {
      /* private mode: tips just show again */
    }
  }

  get allSeen(): boolean {
    return ALL.every((t) => this.seen.has(t));
  }

  /** A new run started. */
  resetRun(): void {
    this.runT = 0;
    this.queued.length = 0;
  }

  /** Ask for a tip (shown when the gap allows, if not seen yet). */
  want(id: TipId): void {
    if (!this.seen.has(id) && !this.queued.includes(id)) this.queued.push(id);
  }

  /** Per simulated frame while a campaign / Survival fight runs. */
  update(dt: number): void {
    if (this.allSeen) return;
    const { ctx } = this;
    this.runT += dt;
    this.gap -= dt;
    const plow = ctx.plow;
    if (!plow || plow.dead) return;
    if (this.runT > 8 && Math.abs(plow.speed) > 4) this.want('dash');
    if (!this.seen.has('whirl') && ctx.enemies.query(plow.position.x, plow.position.z, 9, this.near).filter((e) => e.alive).length >= 2) this.want('whirl');
    const f = ctx.combat.flameReady;
    if (f >= 1 && !this.seen.has('special') && ctx.enemies.query(plow.position.x, plow.position.z, 16, this.near).length > 0) this.want('special');
    if (this.gap > 0 || this.queued.length === 0) return;
    const id = this.queued.shift()!;
    if (this.seen.has(id)) return;
    this.show(id);
  }

  private key(a: Action): string {
    return keyLabel(this.ctx.input.keysFor(a)[0] ?? '?');
  }

  private show(id: TipId): void {
    const { ctx } = this;
    let text = '';
    switch (id) {
      case 'dash':
        text = `TIP · ${this.key('dash')}: DASH. Ram a bot mid-dash for a Dash Strike.`;
        break;
      case 'whirl':
        text = `TIP · Crowded? ${this.key('whirl')}: WHIRLWIND pulls bots in and blasts them away.`;
        break;
      case 'special': {
        const def = PLOWS[ctx.stats.plowKind];
        const info = F_INFO[def.fAbility];
        text = `TIP · ${this.key('ability')}: ${info ? info.title.toUpperCase() : 'SPECIAL'} is ready. Use it!`;
        break;
      }
      case 'shield':
        text = 'TIP · Your snowball blocked that! Face hits head-on while you hold a ball.';
        break;
      case 'air':
        text = `TIP · Airborne! Press ${this.key('slam')} in the air to dive into an AIR SLAM.`;
        break;
      case 'garage':
        text = 'TIP · Spend your coins: every upgrade makes the next round easier.';
        break;
    }
    ctx.ui.toast(text, 'radio');
    this.seen.add(id);
    this.gap = TIP_GAP;
    try {
      localStorage.setItem(KEY, [...this.seen].join(','));
    } catch {
      /* ignore */
    }
  }

  dispose(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
  }
}
