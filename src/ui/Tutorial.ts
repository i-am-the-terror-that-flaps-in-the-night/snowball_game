import './tutorial.css';
import type { EnemyHandle, GameContext } from '../core/types';
import type { Progression } from '../core/Progression';
import { CAMPAIGN_ARENA_HALF } from '../core/types';
import { keyLabel, type Action } from '../core/input';
import { PLOWS, type PlowDef } from '../config/plows';

/** localStorage flag: set once the tutorial is finished or skipped (kept out of the save so RESET SAVE doesn't replay it). */
const DONE_KEY = 'snowplow-showdown-tutorial-done';
/** Pause on the green "done" card before the next step. */
const STEP_PAUSE = 1.1;
/** Metres driven + seconds spent steering to clear the drive step. */
const DRIVE_DIST = 28;
const STEER_TIME = 1.2;
/** Ball size for the plow step, as a fraction of the current max ball radius. */
const BALL_FRAC = 0.7;
/** Frontal blocks needed for the shield step. */
const BLOCKS_NEEDED = 2;
/** The plow can't drop below this hp fraction in the tutorial (dummies still bite, but nobody gets wrecked). */
const HP_FLOOR = 0.4;
/** Dummy bots get extra hp so they survive a few lessons. */
const DUMMY_HP = 3;
/** Gamepad prompt per action (standard mapping, see PAD_BUTTONS in src/core/input.ts). */
const PAD_LABEL: Partial<Record<Action, string>> = {
  forward: 'L-STICK', back: 'L-STICK', left: 'L-STICK', right: 'L-STICK',
  slam: 'A', dash: 'B', whirl: 'X', ability: 'Y', pause: 'START',
};

/** F-ability lesson text per plow (PlowDef.fAbility). */
const F_INFO: Partial<Record<PlowDef['fAbility'], { title: string; text: string }>> = {
  fire: { title: 'Inferno', text: 'Breathe a cone of fire from the blade: it ignites bots and melts snow. Point it at the bot!' },
  zap: {
    title: 'Thunderclap',
    text: 'Call down a lightning blast around your plow: damage, shock-slow and knockback. Each clap shocks you a little — spam it and the backlash escalates fast.',
  },
  meltdown: { title: 'Meltdown', text: 'Vent the reactor: a toxic blast around ISOTOPE that leaves a glowing fallout pool. Irradiated bots glow green and take extra damage from you. Fill the ☢ bar with radiation damage to unlock a NUKE.' },
  missiles: { title: 'Swarm Missiles', text: 'Launch a salvo of homing missiles from the pods: each one hunts down its own bot and explodes.' },
  pound: { title: 'Ground Pound', text: 'Slam BRUTUS into the ground: a shockwave that hammers and shoves every bot around you.' },
};

interface Step {
  title: string;
  /** Action groups, e.g. [['forward', 'back'], ['left', 'right']] renders "W / S   A / D" (follows rebinds). */
  keys: Action[][];
  text: string;
  enter?(): void;
  /** 0..1; the step completes at 1. */
  progress(dt: number): number;
  /** Live nudge under the text ('' = none). */
  hint?(): string;
}

/** Guided first-time onboarding in arena 1: one card per mechanic, each cleared by doing it. */
export class Tutorial {
  private ctx: GameContext;
  private onExit: (next: 'menu' | 'arena') => void;
  private steps: Step[] = [];
  private index = -1;
  private pauseT = 0;
  private running = false;
  private finished = false;
  private unsub: (() => void)[] = [];
  private dummies: EnemyHandle[] = [];
  // per-step counters
  private dist = 0;
  private steerT = 0;
  private slammed = false;
  private blocks = 0;
  private fUsed = false;
  private lastF = -1;

  private card: HTMLElement;
  private stepEl: HTMLElement;
  private titleEl: HTMLElement;
  private keysEl: HTMLElement;
  private textEl: HTMLElement;
  private hintEl: HTMLElement;
  private barEl: HTMLElement;
  private fillEl: HTMLElement;
  private btnsEl: HTMLElement;

  /** Auto-run on a fresh save, unless it was done before or a test harness / ?debug is driving the game. */
  static shouldAutoStart(progression: Progression): boolean {
    if (Tutorial.done) return false;
    if (navigator.webdriver || new URLSearchParams(location.search).has('debug')) return false;
    const d = progression.data;
    return d.totalKills === 0 && d.totalCoinsEarned === 0 && (d.brawlMatches ?? 0) === 0;
  }

  static get done(): boolean {
    try {
      return localStorage.getItem(DONE_KEY) === '1';
    } catch {
      return false;
    }
  }

  private static markDone(): void {
    try {
      localStorage.setItem(DONE_KEY, '1');
    } catch {
      /* private mode — it'll just offer itself again */
    }
  }

  constructor(ctx: GameContext, uiRoot: HTMLElement, onExit: (next: 'menu' | 'arena') => void) {
    this.ctx = ctx;
    this.onExit = onExit;
    const root = uiRoot.querySelector<HTMLElement>('.ss-root') ?? uiRoot;
    const div = (cls: string, parent: HTMLElement, tag: keyof HTMLElementTagNameMap = 'div') => {
      const e = document.createElement(tag);
      e.className = cls;
      parent.appendChild(e);
      return e;
    };
    this.card = div('ss-tut ss-glass-dark', root);
    const head = div('ss-tut-head', this.card);
    this.stepEl = div('ss-tut-step', head);
    const skip = div('ss-tut-skip', head, 'button') as HTMLButtonElement;
    skip.type = 'button';
    skip.textContent = 'SKIP (Esc) ✕';
    this.noFocus(skip);
    skip.addEventListener('click', () => this.skip());
    this.titleEl = div('ss-tut-title', this.card);
    this.keysEl = div('ss-tut-keys', this.card);
    this.textEl = div('ss-tut-text', this.card);
    this.hintEl = div('ss-tut-hint', this.card);
    this.barEl = div('ss-tut-bar', this.card);
    this.fillEl = div('ss-tut-fill', this.barEl);
    this.btnsEl = div('ss-tut-btns hidden', this.card);
    const arena = div('ss-btn ss-primary', this.btnsEl, 'button') as HTMLButtonElement;
    arena.type = 'button';
    arena.innerHTML = '⚔ ARENA 1 <small>(Enter)</small>';
    this.noFocus(arena);
    arena.addEventListener('click', () => this.exit('arena'));
    const menu = div('ss-btn ss-ice', this.btnsEl, 'button') as HTMLButtonElement;
    menu.type = 'button';
    menu.textContent = 'MENU';
    this.noFocus(menu);
    menu.addEventListener('click', () => this.exit('menu'));
  }

  get active(): boolean {
    return this.running;
  }

  /** Begin from step 1. The caller has already reset arena 1 and put the plow at its spawn. */
  start(): void {
    const { ctx } = this;
    this.stop();
    this.running = true;
    this.finished = false;
    this.steps = this.buildSteps();
    this.unsub.push(
      ctx.events.on('slam', ({ hits }) => {
        if (hits > 0) this.slammed = true;
      }),
      ctx.events.on('plowDamaged', ({ blocked }) => {
        if (blocked > 0) this.blocks++;
      }),
    );
    this.card.classList.add('show');
    this.goto(0);
  }

  /** Tear down (no flag change): leaving via the pause menu, etc. Safe to call when not running. */
  stop(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
    this.running = false;
    this.dummies = [];
    this.card.classList.remove('show', 'done');
  }

  /** Esc / SKIP: mark done and go back to the menu. */
  skip(): void {
    if (!this.running) return;
    this.exit('menu');
  }

  private exit(next: 'menu' | 'arena'): void {
    if (!this.running) return;
    Tutorial.markDone();
    this.ctx.audio.play('click');
    this.stop();
    this.onExit(next);
  }

  /** Called by Game every simulated frame while the tutorial runs (after the plow / bots / combat updates). */
  update(dt: number): void {
    if (!this.running) return;
    const { ctx } = this;
    const plow = ctx.plow;
    if (plow.dead) {
      // Shouldn't happen with the hp floor, but never end a lesson on a game-over screen.
      plow.reset({ x: plow.position.x, z: plow.position.z, heading: plow.heading });
      ctx.ui.toast('Back on your treads!', 'info');
    } else if (plow.hp < plow.maxHp * HP_FLOOR) {
      plow.hp = plow.maxHp * HP_FLOOR;
    }
    if (this.finished) {
      if (ctx.input.wasPressed('Enter') || ctx.input.wasPressed('NumpadEnter')) this.exit('arena');
      return;
    }
    const step = this.steps[this.index];
    if (this.pauseT > 0) {
      this.pauseT -= dt;
      if (this.pauseT <= 0) this.goto(this.index + 1);
      return;
    }
    const p = Math.max(0, Math.min(1, step.progress(dt)));
    this.fillEl.style.width = `${(p * 100).toFixed(1)}%`;
    this.hintEl.textContent = step.hint?.() ?? '';
    if (p >= 1) {
      this.card.classList.add('done');
      this.titleEl.textContent = `✓ ${step.title}`;
      this.hintEl.textContent = 'Nice!';
      ctx.audio.play('coin', { pitch: 1.3 });
      this.pauseT = STEP_PAUSE;
    }
  }

  /* ------------------------------------------------------------------ steps */

  private goto(i: number): void {
    this.index = i;
    this.card.classList.remove('done');
    if (i >= this.steps.length) return this.finish();
    const step = this.steps[i];
    this.stepEl.textContent = `Training ${i + 1} / ${this.steps.length}`;
    this.render(step.title, step.keys, step.text);
    this.fillEl.style.width = '0%';
    this.barEl.classList.remove('hidden');
    this.btnsEl.classList.add('hidden');
    step.enter?.();
  }

  private finish(): void {
    const { ctx } = this;
    this.finished = true;
    this.card.classList.add('done');
    this.stepEl.textContent = 'Training complete';
    this.render("You're ready!", [], 'Snow is ammo, the ball is your shield, and bots are scrap. Arena 1 is waiting — upgrades live in the Garage.');
    this.hintEl.textContent = '';
    this.barEl.classList.add('hidden');
    this.btnsEl.classList.remove('hidden');
    ctx.audio.play('roundClear');
    ctx.ui.toast("YOU'RE READY!", 'big');
    Tutorial.markDone();
  }

  private render(title: string, keys: Action[][], text: string): void {
    this.titleEl.textContent = title;
    this.textEl.textContent = text;
    this.keysEl.replaceChildren();
    keys.forEach((group, gi) => {
      if (gi) this.keysEl.append(document.createTextNode(' '));
      group.forEach((k, ki) => {
        if (ki) {
          const sep = document.createElement('span');
          sep.className = 'ss-key-sep';
          sep.textContent = '/';
          this.keysEl.append(sep);
        }
        const kbd = document.createElement('kbd');
        kbd.className = 'ss-kbd';
        kbd.textContent = keyLabel(this.ctx.input.keysFor(k)[0] ?? '?');
        this.keysEl.append(kbd);
      });
    });
    // Gamepad connected: also show the pad button (src/core/input.ts mapping).
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if ([...pads].some((p) => p?.connected)) {
      const btns = [...new Set(keys.flat().map((a) => PAD_LABEL[a]))].filter(Boolean);
      if (btns.length) {
        const pad = document.createElement('span');
        pad.className = 'ss-key-sep';
        pad.textContent = ` · 🎮 ${btns.join(' / ')}`;
        this.keysEl.append(pad);
      }
    }
    this.keysEl.classList.toggle('hidden', keys.length === 0);
  }

  private buildSteps(): Step[] {
    const { ctx } = this;
    const plow = ctx.plow;
    const ballTarget = () => ctx.stats.maxBallRadius * BALL_FRAC;
    const needBall = () => (plow.heldBallRadius <= 0 ? 'No ball! Drive through deep snow to plow one up.' : '');
    const steps: Step[] = [
      {
        title: 'Drive & steer',
        keys: [['forward', 'back'], ['left', 'right']],
        text: 'Drive and reverse, steer left and right (arrow keys and a gamepad work too). Take a lap around the yard.',
        enter: () => {
          this.dist = 0;
          this.steerT = 0;
        },
        progress: (dt) => {
          this.dist += Math.abs(plow.speed) * dt;
          if (ctx.input.steer !== 0 && Math.abs(plow.speed) > 1) this.steerT += dt;
          return 0.5 * Math.min(1, this.dist / DRIVE_DIST) + 0.5 * Math.min(1, this.steerT / STEER_TIME);
        },
      },
      {
        title: 'Plow a snowball',
        keys: [['forward']],
        text: 'Drive through deep snow — your blade packs it into a snowball. Bigger ball = harder hits. Grow it!',
        progress: () => plow.heldBallRadius / ballTarget(),
        hint: () => `Ball ${plow.heldBallRadius.toFixed(2)} m / ${ballTarget().toFixed(2)} m`,
      },
      {
        title: 'Slam a bot',
        keys: [['slam']],
        text: 'A training bot rolled in. Face it and slam your snowball into it.',
        enter: () => {
          this.slammed = false;
          this.ensureDummies(1);
        },
        progress: () => {
          this.ensureDummies(1);
          return this.slammed ? 1 : 0;
        },
        hint: needBall,
      },
      {
        title: 'Dash',
        keys: [['dash']],
        text: 'Launch a long dash. Hit a bot mid-dash for a devastating Dash Strike.',
        progress: () => (plow.dashing ? 1 : 0),
      },
      {
        title: 'Whirlwind',
        keys: [['whirl']],
        text: 'Whirlwind spins your plow: it pulls bots in, blasts them away and sucks up nearby snow.',
        progress: () => (plow.whirling ? 1 : 0),
      },
      this.fStep(),
      {
        title: 'Ball = shield',
        keys: [['forward'], ['left', 'right']],
        text: `Holding a ball? Hits from the front are partly blocked (${Math.round(ctx.stats.shieldBlock * 100)}%), costing some snow instead. Face the incoming bots and take ${BLOCKS_NEEDED} hits on the ball.`,
        enter: () => {
          this.blocks = 0;
          this.ensureDummies(2);
        },
        progress: () => {
          this.ensureDummies(2);
          return this.blocks / BLOCKS_NEEDED;
        },
        hint: () => needBall() || `Blocked ${this.blocks} / ${BLOCKS_NEEDED}`,
      },
    ];
    return steps;
  }

  /** F-ability lesson: text follows the starter plow's fAbility (src/config/plows.ts). */
  private fStep(): Step {
    const { ctx } = this;
    const def = PLOWS[ctx.stats.plowKind];
    const info = F_INFO[def.fAbility] ?? { title: 'Special ability', text: `Fire ${def.name}'s special ability.` };
    const enter = () => {
      this.fUsed = false;
      this.lastF = ctx.combat.flameReady;
    };
    if (ctx.combat.flameReady < 0) {
      return {
        title: `${info.title} (locked)`,
        keys: [['ability']],
        text: `${info.text} Unlock it in the Garage. Press the key to continue.`,
        enter,
        progress: () => (ctx.input.wasPressed('KeyF') ? 1 : 0),
      };
    }
    return {
      title: info.title,
      keys: [['ability']],
      text: info.text,
      enter,
      progress: () => {
        // The charge drops from full to empty the moment the ability fires.
        const r = ctx.combat.flameReady;
        if (this.lastF >= 0.99 && r < 0.5) this.fUsed = true;
        this.lastF = r;
        return this.fUsed ? 1 : 0;
      },
      hint: () => (ctx.combat.flameReady < 1 && !this.fUsed ? 'Recharging…' : ''),
    };
  }

  /** Keep `n` training bots alive, spawning replacements ahead of the plow. */
  private ensureDummies(n: number): void {
    const { ctx } = this;
    this.dummies = this.dummies.filter((d) => d.alive);
    const lim = CAMPAIGN_ARENA_HALF - 5;
    while (this.dummies.length < n) {
      const k = this.dummies.length;
      const a = ctx.plow.heading + (k - (n - 1) / 2) * 0.6;
      const d = 13 + k * 2;
      const x = Math.max(-lim, Math.min(lim, ctx.plow.position.x + Math.sin(a) * d));
      const z = Math.max(-lim, Math.min(lim, ctx.plow.position.z + Math.cos(a) * d));
      this.dummies.push(ctx.enemies.spawn('scrapper', x, z, { hpMult: DUMMY_HP, heading: a + Math.PI }));
    }
  }

  /** Card buttons must never hold keyboard focus (Space is the slam key). */
  private noFocus(b: HTMLButtonElement): void {
    b.tabIndex = -1;
    b.addEventListener('mousedown', (e) => e.preventDefault());
  }
}
