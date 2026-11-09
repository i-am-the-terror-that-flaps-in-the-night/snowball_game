import './tutorial.css';
import * as THREE from 'three';
import type { EnemyHandle, GameContext } from '../core/types';
import type { Progression } from '../core/Progression';
import { CAMPAIGN_ARENA_HALF } from '../core/types';
import { keyLabel, type Action } from '../core/input';
import { PLOWS, type PlowDef } from '../config/plows';
import type { TerrainDef, TerrainShape } from '../world/Terrain';
import {
  ARROW_ABOVE, ARROW_HALF_W, arrowRect, edgePoint, fmtDist, onScreen, viewDir, type EdgeHit, type EdgeRect, type ScreenDir,
} from './radarMath';

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
/* Terrain lessons (slopes, ramp jump, air slam). The yard itself is flat (core/modeZones TUTORIAL_ZONE); these steps load a
 * gentle bowl and one ramp through ctx.terrain.load, laid out around wherever the plow is, and restore flat after. */
/** The bowl: radius / depth (m), centred this far ahead of the plow (clamped inside the walls). */
const BOWL_R = 10;
const BOWL_DEPTH = 2.2;
const BOWL_AHEAD = 13;
/** Lesson 1 clears after reaching this fraction of the bowl's depth, then climbing back to near flat ground. */
const BOWL_BOTTOM = 0.6;
const BOWL_OUT = 0.25;
/** The ramp: run-up from the plow to the toe, length, width, lip height and drop-off (m). */
const RAMP_RUNUP = 7;
const RAMP_LEN = 10;
const RAMP_W = 7;
const RAMP_H = 2.8;
const RAMP_FALL = 1.8;
/** Run-up + ramp + drop-off + a landing strip (m): the straight line the jump needs, from the plow. */
const RAMP_PATH = RAMP_RUNUP + RAMP_LEN + RAMP_FALL + 8;
/** Headings tried for the bowl / ramp, as offsets (rad) from where the plow faces, before falling back to the arena
 *  centre: the feature lands in front of the camera whenever the walls allow. */
const LAY_OFFSETS = [0, 0.3, 0.6, 0.9, 1.2];
/** A flight shorter than this (s) does not count as a jump. */
const JUMP_AIR = 0.3;
/** Seconds between the floating "BOWL" / "RAMP" markers over the lesson's feature. */
const BEACON_EVERY = 1.3;
/** Gap (px) between the beacon's edge arrow (tip and label) and the step card. */
const CARD_CLEAR = 12;
/** A frame-to-frame drop in vertical speed this big (m/s) can only be the air-slam dive (gravity adds < 1.5). */
const DIVE_DV = 8;

/** Gamepad prompt per action (standard mapping, see PAD_BUTTONS in src/core/input.ts). */
const PAD_LABEL: Partial<Record<Action, string>> = {
  forward: 'L-STICK', back: 'L-STICK', left: 'L-STICK', right: 'L-STICK',
  slam: 'A', dash: 'B', whirl: 'X', ability: 'Y', pause: 'START',
};

/** F-ability lesson text per plow (PlowDef.fAbility). */
const F_INFO: Partial<Record<PlowDef['fAbility'], { title: string; text: string }>> = {
  fire: { title: 'Inferno', text: 'Breathe a cone of fire from the blade: it ignites bots, melts snow and ends in a fireball. Point it at the bot! Fire damage fills the 🔥 bar: when it is full, F unleashes a FIRESTORM.' },
  zap: {
    title: 'Thunderclap',
    text: 'Call down a lightning blast around your plow: damage, shock-slow and knockback. Each clap shocks you a little — spam it and the backlash escalates fast.',
  },
  meltdown: { title: 'Meltdown', text: 'Vent the reactor: a toxic blast around ISOTOPE that leaves a glowing fallout pool. Irradiated bots glow green and take extra damage from you. Fill the ☢ bar with radiation damage to unlock a NUKE.' },
  missiles: { title: 'Polarity Burst', text: 'Fold the gyro into a disc: an event horizon drags every bot within 16 m into one point in front of you, then it detonates.' },
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
  /** Terrain lessons: the shapes loaded into ctx.terrain (null = flat), bowl / ramp layout, flight tracking. */
  private shapes: TerrainShape[] | null = null;
  private bowl = { x: 0, z: 0 };
  private ramp = { x: 0, z: 0, rot: 0 };
  private bottomed = false;
  private climbed = false;
  private launched = false;
  private jumped = false;
  private dived = false;
  private airSlammed = false;
  private prevVy = 0;
  /** Floating marker over the current lesson's feature (null = none). */
  private beacon: { x: number; z: number; label: string; name: string } | null = null;
  private beaconT = 0;
  private beaconPos = new THREE.Vector3();
  /** Edge arrow toward the beacon while it is off screen or under the card (the radar is off in the Tutorial). */
  private arrow: HTMLElement;
  private arrowTip: HTMLElement;
  private arrowLabel: HTMLElement;
  private arrowOn = false;
  private arrowText = '';
  private arrowBox: EdgeRect = { l: 0, t: 0, r: 0, b: 0 };
  private arrowVis: EdgeRect = { l: 0, t: 0, r: 0, b: 0 };
  private arrowW = 0;
  private arrowH = 0;

  private card: HTMLElement;
  private stepEl: HTMLElement;
  private titleEl: HTMLElement;
  private keysEl: HTMLElement;
  private textEl: HTMLElement;
  private hintEl: HTMLElement;
  private barEl: HTMLElement;
  private fillEl: HTMLElement;
  /** Last width written to fillEl (the per-frame write is skipped while it is unchanged). */
  private fillW = '';
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
    // Beacon arrow: the campaign radar's lost-bot arrow look (ui.css .ss-lost*), in gold.
    const lost = div('ss-lost ss-tut-lost', root);
    this.arrow = div('ss-lost-arrow boss ss-tut-arrow', lost);
    this.arrowTip = div('ss-lost-tip', this.arrow);
    this.arrowLabel = div('ss-lost-d', this.arrow);
    window.addEventListener('resize', () => {
      if (this.beacon) this.measureArrow();
    });
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
      ctx.events.on('plowLaunched', () => {
        this.launched = true;
        this.dived = false;
      }),
      ctx.events.on('plowLanded', ({ airTime }) => {
        if (this.launched && airTime >= JUMP_AIR) this.jumped = true;
        if (this.dived) this.airSlammed = true;
        this.launched = false;
        this.dived = false;
      }),
    );
    this.card.classList.add('show');
    this.goto(0);
  }

  /** Tear down (no flag change): leaving via the pause menu, etc. Safe to call when not running. */
  stop(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
    this.flatten();
    this.running = false;
    this.dummies = [];
    this.card.classList.remove('show', 'done');
    this.showArrow(false);
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
    // Air-slam detection: the dive sets vy straight to -speed, a jump far bigger than one frame of gravity.
    if (this.shapes && plow.airborne) {
      if (plow.vy - this.prevVy < -DIVE_DV) this.dived = true;
      this.prevVy = plow.vy;
    } else this.prevVy = 0;
    if (this.beacon && this.shapes && this.pauseT <= 0) {
      this.beaconT -= dt;
      const b = this.beacon;
      this.beaconPos.set(b.x, ctx.terrain.ground(b.x, b.z) + 2.2, b.z);
      if (this.beaconT <= 0) {
        this.beaconT = BEACON_EVERY;
        ctx.fx.floatText(this.beaconPos, b.label, '#ffd400', 1.3);
      }
      this.placeArrow(b.name);
    } else this.showArrow(false);
    const step = this.steps[this.index];
    if (this.pauseT > 0) {
      this.pauseT -= dt;
      if (this.pauseT <= 0) this.goto(this.index + 1);
      return;
    }
    const p = Math.max(0, Math.min(1, step.progress(dt)));
    const w = `${(p * 100).toFixed(1)}%`;
    if (w !== this.fillW) {
      this.fillW = w;
      this.fillEl.style.width = w;
    }
    const hint = step.hint?.() ?? '';
    if (hint !== this.hintEl.textContent) this.hintEl.textContent = hint;
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
    this.beacon = null;
    this.card.classList.remove('done');
    if (i >= this.steps.length) return this.finish();
    const step = this.steps[i];
    this.stepEl.textContent = `Training ${i + 1} / ${this.steps.length}`;
    this.render(step.title, step.keys, step.text);
    this.fillEl.style.width = '0%';
    this.fillW = '0%';
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
    this.flatten();
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
    if (Tutorial.terrainReady(ctx)) steps.push(...this.terrainSteps());
    return steps;
  }

  /** The slope / jump / air-slam lessons need the terrain movement contract (PlowAPI airborne / vy / dive). */
  static terrainReady(ctx: GameContext): boolean {
    const p = ctx.plow as Partial<GameContext['plow']> | undefined;
    return !!ctx.terrain && !!p && typeof p.airborne === 'boolean' && typeof p.vy === 'number' && typeof p.dive === 'function';
  }

  private terrainSteps(): Step[] {
    const { ctx } = this;
    const plow = ctx.plow;
    const dist = (x: number, z: number) => Math.round(Math.hypot(x - plow.position.x, z - plow.position.z));
    // to the ramp's marker (the beacon the edge arrow points at), so the hint and the arrow read the same distance
    const rampDist = () => (this.beacon ? dist(this.beacon.x, this.beacon.z) : dist(this.ramp.x, this.ramp.z));
    return [
      {
        title: 'Slopes',
        keys: [['forward'], ['left', 'right']],
        text: 'A bowl just opened up ahead. Roll down into it (gravity speeds you up), then climb back out (it slows you down).',
        enter: () => {
          this.bottomed = false;
          this.climbed = false;
          this.layBowl();
        },
        progress: () => {
          const depth = -plow.surfaceY;
          if (depth >= BOWL_DEPTH * BOWL_BOTTOM) this.bottomed = true;
          if (this.bottomed && depth <= BOWL_DEPTH * BOWL_OUT && !plow.airborne) this.climbed = true;
          return (this.bottomed ? 0.5 : Math.min(0.45, (0.5 * Math.max(0, depth)) / (BOWL_DEPTH * BOWL_BOTTOM))) + (this.climbed ? 0.5 : 0);
        },
        hint: () => (this.bottomed ? 'Now drive back up and out!' : `Bowl centre: ${dist(this.bowl.x, this.bowl.z)} m`),
      },
      {
        title: 'Ramp jump',
        keys: [['forward']],
        text: 'A ramp is waiting. Hit it at full speed and fly off the lip. There is no jump button: speed does it. In the air you steer less, but you keep your ball.',
        enter: () => {
          this.jumped = false;
          this.launched = false;
          this.layRamp();
        },
        progress: () => (this.jumped ? 1 : plow.airborne ? 0.5 : 0),
        hint: () => (plow.airborne ? 'Airborne!' : `Ramp: ${rampDist()} m · line up and floor it`),
      },
      {
        title: 'Air slam',
        keys: [['slam']],
        text: 'Jump off the ramp again and press slam while in the air: you dive straight down and land with a big shockwave. Land it on bots for extra damage.',
        enter: () => {
          this.airSlammed = false;
          this.dived = false;
          this.rampBeacon();
        },
        progress: () => (this.airSlammed ? 1 : this.dived ? 0.6 : plow.airborne ? 0.3 : 0),
        hint: () => (plow.airborne ? (this.dived ? 'Diving!' : 'NOW: slam!') : `Ramp: ${rampDist()} m`),
      },
    ];
  }

  /** Lesson 1: a gentle bowl ahead of the plow, kept inside the walls. */
  private layBowl(): void {
    const plow = this.ctx.plow;
    const B = Tutorial.bowlLayout(plow.position.x, plow.position.z, plow.heading);
    this.bowl.x = B.x;
    this.bowl.z = B.z;
    this.loadShapes([{ kind: 'dome', x: this.bowl.x, z: this.bowl.z, r: BOWL_R, h: -BOWL_DEPTH }]);
    this.setBeacon(this.bowl.x, this.bowl.z, '▼ BOWL', 'BOWL');
  }

  /** Bowl centre for a plow at (x, z) facing `heading`: BOWL_AHEAD in front (or as close to in front as fits inside the
   *  walls), else toward the arena centre, clamped. Always at least BOWL_R + 2 m from the plow, so it never opens under it. */
  static bowlLayout(x: number, z: number, heading: number, half = CAMPAIGN_ARENA_HALF): { x: number; z: number } {
    const lim = half - BOWL_R - 1;
    const rot = Tutorial.layHeading(x, z, heading, (s, c) => Math.abs(x + s * BOWL_AHEAD) <= lim && Math.abs(z + c * BOWL_AHEAD) <= lim);
    const clamp = (v: number) => Math.max(-lim, Math.min(lim, v));
    let bx = clamp(x + Math.sin(rot) * BOWL_AHEAD);
    let bz = clamp(z + Math.cos(rot) * BOWL_AHEAD);
    // pressed into a corner: slide on toward the centre until the plow is clear of the rim
    const min = BOWL_R + 2;
    for (let k = 0; k < 8 && Math.hypot(bx - x, bz - z) < min; k++) {
      bx = clamp(bx - Math.sign(bx) * 2);
      bz = clamp(bz - Math.sign(bz) * 2);
    }
    return { x: bx, z: bz };
  }

  /**
   * The heading a lesson feature is laid along: the plow's own heading, or the nearest offset from it (LAY_OFFSETS,
   * turning toward the arena centre first) for which `fits(sin, cos)` holds; else straight at the centre (straight
   * ahead when already there).
   */
  private static layHeading(x: number, z: number, heading: number, fits: (s: number, c: number) => boolean): number {
    const toC = Math.atan2(-x, -z);
    let d = toC - heading;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const first = d >= 0 ? 1 : -1;
    for (const off of LAY_OFFSETS) {
      for (const sg of off === 0 ? [1] : [first, -first]) {
        const rot = heading + sg * off;
        if (fits(Math.sin(rot), Math.cos(rot))) return rot;
      }
    }
    return Math.hypot(x, z) > 2.5 ? toC : heading;
  }

  private setBeacon(x: number, z: number, label: string, name: string): void {
    this.beacon = { x, z, label, name };
    this.beaconT = 0;
    this.measureArrow();
  }

  /** Cache the viewport and the arrow rectangle: clear of the HUD edges and of the step card (right-side panel on
   *  desktop, pinned to the top on phones). The whole arrow stays off the card: the 34 px tip box centred on the edge
   *  point and the distance label (up to ~76 px wide) centred under it. The card is measured by its layout box, which
   *  tutorial.css keeps free of its slide-in transform, so a card still sliding in measures where it comes to rest.
   *  One layout read per lesson / resize, none per frame. */
  private measureArrow(): void {
    const w = (this.arrowW = window.innerWidth);
    const h = (this.arrowH = window.innerHeight);
    const R = arrowRect(w, h, this.arrowBox);
    const V = arrowRect(w, h, this.arrowVis, true);
    const card = this.card;
    if (card.offsetWidth > 0) {
      const p = card.offsetParent?.getBoundingClientRect();
      const left = (p?.left ?? 0) + card.offsetLeft;
      const bottom = (p?.top ?? 0) + card.offsetTop + card.offsetHeight;
      // Side panel (desktop, landscape phones: right-anchored or sitting low) - keep the arrow left of it however narrow
      // the strip is; else the card is pinned to the top (portrait) and the arrow keeps below it.
      const top = (p?.top ?? 0) + card.offsetTop;
      if (left > w * 0.35 || top > h * 0.4) R.r = V.r = Math.max(R.l + 40, Math.min(R.r, left - CARD_CLEAR - ARROW_HALF_W));
      else R.t = V.t = Math.min(R.b - 40, Math.max(R.t, bottom + CARD_CLEAR + ARROW_ABOVE));
    }
  }

  /** Point the edge arrow at the beacon (beaconPos) when it is off screen or behind the card; hide it otherwise. */
  private placeArrow(name: string): void {
    const cam = this.ctx.camera as THREE.PerspectiveCamera;
    if (!this.arrowW) this.measureArrow();
    const pe = cam.projectionMatrix.elements;
    _tv.copy(this.beaconPos).applyMatrix4(cam.matrixWorldInverse);
    viewDir(_tv.x, _tv.y, _tv.z, pe[0], pe[5], _tdir);
    if (onScreen(_tdir, this.arrowW, this.arrowH, this.arrowVis)) return this.showArrow(false);
    edgePoint(_tdir.x, _tdir.y, this.arrowW, this.arrowH, this.arrowBox, _thit);
    this.arrow.style.transform = `translate(${_thit.x.toFixed(1)}px, ${_thit.y.toFixed(1)}px)`;
    this.arrowTip.style.transform = `rotate(${_thit.angle.toFixed(3)}rad)`;
    const p = this.ctx.plow.position;
    const text = `${name} ${fmtDist(Math.hypot(this.beaconPos.x - p.x, this.beaconPos.z - p.z))}`;
    if (text !== this.arrowText) {
      this.arrowText = text;
      this.arrowLabel.textContent = text;
    }
    this.showArrow(true);
  }

  private showArrow(on: boolean): void {
    if (on === this.arrowOn) return;
    this.arrowOn = on;
    this.arrow.classList.toggle('on', on);
  }

  /**
   * Lessons 2-3: one ramp a short run-up from the plow, laid along the plow's heading (or as close to it as the walls
   * allow) so it is in front of the camera; toward the arena centre when nothing near the heading fits. The bowl stays
   * when it is clear of the ramp's path.
   */
  private layRamp(): void {
    const plow = this.ctx.plow;
    const p = plow.position;
    const L = Tutorial.rampLayout(p.x, p.z, plow.heading);
    this.ramp.x = L.x;
    this.ramp.z = L.z;
    this.ramp.rot = L.rot;
    const ramp: TerrainShape = { kind: 'ramp', x: L.x, z: L.z, rot: L.rot, len: RAMP_LEN, w: RAMP_W, h: RAMP_H, fall: RAMP_FALL };
    const shapes: TerrainShape[] = [ramp];
    // keep the bowl unless it sits on the run-up / ramp / landing strip
    const ex = L.x + Math.sin(L.rot) * (RAMP_LEN + 12);
    const ez = L.z + Math.cos(L.rot) * (RAMP_LEN + 12);
    if (segDist(this.bowl.x, this.bowl.z, p.x, p.z, ex, ez) > BOWL_R + RAMP_W / 2 + 1) {
      shapes.push({ kind: 'dome', x: this.bowl.x, z: this.bowl.z, r: BOWL_R, h: -BOWL_DEPTH });
    }
    this.loadShapes(shapes);
    this.rampBeacon();
  }

  /** Marker over the middle of the ramp. */
  private rampBeacon(): void {
    const r = this.ramp;
    this.setBeacon(r.x + Math.sin(r.rot) * RAMP_LEN * 0.6, r.z + Math.cos(r.rot) * RAMP_LEN * 0.6, '▲ RAMP', 'RAMP');
  }

  /** Where the ramp's toe goes for a plow at (x, z) facing `heading`: RAMP_RUNUP ahead along the heading (or the nearest
   *  heading whose ramp corners and landing fit inside the walls), else toward the arena centre. */
  static rampLayout(x: number, z: number, heading: number, half = CAMPAIGN_ARENA_HALF): { x: number; z: number; rot: number } {
    const lip = RAMP_RUNUP + RAMP_LEN;
    const limLip = half - RAMP_W / 2 - 0.5;
    const limEnd = half - 2;
    const rot = Tutorial.layHeading(x, z, heading, (s, c) =>
      Math.abs(x + s * lip) <= limLip && Math.abs(z + c * lip) <= limLip && Math.abs(x + s * RAMP_PATH) <= limEnd && Math.abs(z + c * RAMP_PATH) <= limEnd);
    return { x: x + Math.sin(rot) * RAMP_RUNUP, z: z + Math.cos(rot) * RAMP_RUNUP, rot };
  }

  private loadShapes(shapes: TerrainShape[]): void {
    this.shapes = shapes;
    const def: TerrainDef = { shapes };
    this.ctx.terrain.load(def); // SnowField follows on its next update (it watches ctx.terrain.shapes)
  }

  /** Back to the flat yard (after the terrain lessons, on finish, skip or leaving). */
  private flatten(): void {
    this.beacon = null;
    this.showArrow(false);
    if (!this.shapes) return;
    this.shapes = null;
    this.ctx.terrain.clear();
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

const _tv = new THREE.Vector3();
const _tdir: ScreenDir = { x: 0, y: 0, behind: false };
const _thit: EdgeHit = { x: 0, y: 0, angle: 0 };

function segDist(x: number, z: number, x1: number, z1: number, x2: number, z2: number): number {
  const vx = x2 - x1;
  const vz = z2 - z1;
  const l2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((x - x1) * vx + (z - z1) * vz) / l2));
  return Math.hypot(x - (x1 + vx * t), z - (z1 + vz * t));
}
