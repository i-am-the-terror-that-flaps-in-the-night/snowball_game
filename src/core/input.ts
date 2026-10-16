const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export type Action = 'forward' | 'back' | 'left' | 'right' | 'slam' | 'dash' | 'whirl' | 'ability' | 'pause';

/** Rebindable gameplay actions, in settings-menu order. */
export const ACTIONS: { id: Action; label: string }[] = [
  { id: 'forward', label: 'Drive' },
  { id: 'back', label: 'Brake / reverse' },
  { id: 'left', label: 'Steer left' },
  { id: 'right', label: 'Steer right' },
  { id: 'slam', label: 'Slam snowball' },
  { id: 'dash', label: 'Dash strike' },
  { id: 'whirl', label: 'Whirlwind' },
  { id: 'ability', label: 'F ability (Inferno / Thunderclap / Pound)' },
  { id: 'pause', label: 'Pause' },
];

/** Default keys. Index 0 is the rebindable primary; the rest are fixed alternates (arrows, right shift, Esc). */
export const DEFAULT_KEYS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  slam: ['Space'],
  dash: ['ShiftLeft', 'ShiftRight'],
  whirl: ['KeyE'],
  ability: ['KeyF'],
  pause: ['KeyP', 'Escape'],
};

/** Keys that can never be bound (menu back / mute). */
export const RESERVED_KEYS = new Set(['Escape', 'KeyM']);

/** Legacy lookup: any default key code -> its action, so `wasPressed('KeyF')` follows the rebound key. */
const LEGACY = new Map<string, Action>();
for (const a of Object.keys(DEFAULT_KEYS) as Action[]) for (const c of DEFAULT_KEYS[a]) LEGACY.set(c, a);

/** Readable label for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const named: Record<string, string> = {
    Space: 'SPACE', ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'L-CTRL', ControlRight: 'R-CTRL',
    AltLeft: 'L-ALT', AltRight: 'R-ALT', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Escape: 'ESC', Enter: 'ENTER', Tab: 'TAB', Backspace: 'BKSP', CapsLock: 'CAPS',
  };
  return named[code] ?? code.replace(/^Numpad/, 'NUM ').toUpperCase();
}

/* ------------------------------------------------------------------ gamepad (standard mapping) */

const DEADZONE = 0.22;
/** Standard-mapping button index -> action. A slam, B/RB dash, X whirl, Y F-ability, Start pause, d-pad drive. */
const PAD_BUTTONS: [number, Action][] = [
  [0, 'slam'], [1, 'dash'], [5, 'dash'], [2, 'whirl'], [3, 'ability'], [9, 'pause'],
  [12, 'forward'], [13, 'back'], [14, 'left'], [15, 'right'],
];
/** Menu navigation: d-pad / stick -> arrow keys, A -> Enter, B -> Escape (synthetic key events). */
const MENU_NAV: [number, string][] = [[12, 'ArrowUp'], [13, 'ArrowDown'], [14, 'ArrowLeft'], [15, 'ArrowRight'], [0, 'Enter'], [1, 'Escape']];

function deadzone(v: number): number {
  const a = Math.abs(v);
  return a < DEADZONE ? 0 : (Math.sign(v) * (a - DEADZONE)) / (1 - DEADZONE);
}

/**
 * Keyboard + gamepad state. Uses KeyboardEvent.code values ('KeyW', 'Space', 'ShiftLeft', ...).
 * Gameplay should read actions (`actionDown('slam')`); the older `isDown/wasPressed(code)` calls still work
 * for default key codes and transparently follow the player's rebinds and the gamepad.
 */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private bindings: Record<Action, string[]> = { ...DEFAULT_KEYS };

  private padDown = new Set<Action>();
  private padPrev = new Set<Action>();
  private padPressed = new Set<Action>();
  private padX = 0;
  private padY = 0;
  private padTrig = 0;
  private navPrev = new Set<string>();
  /** True while a menu is up: the gamepad then emits arrow/Enter/Escape key events for UI navigation. */
  menuNav = true;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      if (PREVENT.has(e.code)) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.clear());
  }

  /** Apply rebound primary keys (missing entries = default). Fixed alternates stay unless taken by another action. */
  setBindings(primary: Partial<Record<Action, string>>): void {
    const taken = new Set(Object.values(primary).filter(Boolean) as string[]);
    const b = {} as Record<Action, string[]>;
    for (const a of Object.keys(DEFAULT_KEYS) as Action[]) {
      const [def, ...alts] = DEFAULT_KEYS[a];
      const p = primary[a] ?? (taken.has(def) ? undefined : def);
      b[a] = [...(p ? [p] : []), ...alts.filter((c) => c === 'Escape' || !taken.has(c))];
    }
    this.bindings = b;
  }

  /** Keys currently bound to an action (primary first). */
  keysFor(action: Action): string[] {
    return this.bindings[action];
  }

  /** Is `code` one of the keys bound to `action`? */
  matches(action: Action, code: string): boolean {
    return this.bindings[action].includes(code);
  }

  actionDown(a: Action): boolean {
    return this.padDown.has(a) || this.bindings[a].some((c) => this.down.has(c));
  }

  /** True only on the frame the action was triggered (key or pad button went down). */
  actionPressed(a: Action): boolean {
    return this.padPressed.has(a) || this.bindings[a].some((c) => this.pressed.has(c));
  }

  isDown(code: string): boolean {
    const a = LEGACY.get(code);
    return a ? this.actionDown(a) : this.down.has(code);
  }

  /** True only on the frame the key went down. */
  wasPressed(code: string): boolean {
    const a = LEGACY.get(code);
    return a ? this.actionPressed(a) : this.pressed.has(code);
  }

  /** +1 forward, -1 reverse. Analog with a gamepad (left stick Y, RT/LT). */
  get throttle(): number {
    let t = this.padTrig - this.padY;
    if (this.bindings.forward.some((c) => this.down.has(c)) || this.padDown.has('forward')) t += 1;
    if (this.bindings.back.some((c) => this.down.has(c)) || this.padDown.has('back')) t -= 1;
    return Math.max(-1, Math.min(1, t));
  }

  /** +1 = turn left, -1 = turn right. Use: heading += steer * turnRate * dt. */
  get steer(): number {
    let s = -this.padX;
    if (this.bindings.left.some((c) => this.down.has(c)) || this.padDown.has('left')) s += 1;
    if (this.bindings.right.some((c) => this.down.has(c)) || this.padDown.has('right')) s -= 1;
    return Math.max(-1, Math.min(1, s));
  }

  get launch(): boolean {
    return this.actionPressed('slam');
  }

  get turbo(): boolean {
    return this.actionDown('dash');
  }

  /** Gamepad Start (or any pad 'pause' press) this frame — keyboard pause is handled by the key listener. */
  get padPause(): boolean {
    return this.padPressed.has('pause');
  }

  /** Read connected gamepads. Call once at the start of every frame. */
  poll(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    this.padDown.clear();
    this.padX = this.padY = this.padTrig = 0;
    const nav = new Set<string>();
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const btn = (i: number) => !!gp.buttons[i]?.pressed;
      for (const [i, a] of PAD_BUTTONS) if (btn(i)) this.padDown.add(a);
      const x = deadzone(gp.axes[0] ?? 0);
      const y = deadzone(gp.axes[1] ?? 0);
      if (Math.abs(x) > Math.abs(this.padX)) this.padX = x;
      if (Math.abs(y) > Math.abs(this.padY)) this.padY = y;
      const trig = (gp.buttons[7]?.value ?? 0) - (gp.buttons[6]?.value ?? 0);
      if (Math.abs(trig) > Math.abs(this.padTrig)) this.padTrig = Math.abs(trig) < 0.08 ? 0 : trig;
      for (const [i, code] of MENU_NAV) if (btn(i)) nav.add(code);
      const rx = gp.axes[0] ?? 0;
      const ry = gp.axes[1] ?? 0;
      if (ry < -0.6) nav.add('ArrowUp');
      if (ry > 0.6) nav.add('ArrowDown');
      if (rx < -0.6) nav.add('ArrowLeft');
      if (rx > 0.6) nav.add('ArrowRight');
    }
    for (const a of this.padDown) if (!this.padPrev.has(a)) this.padPressed.add(a);
    this.padPrev = new Set(this.padDown);
    if (this.menuNav) {
      for (const code of nav) if (!this.navPrev.has(code)) this.synth(code);
    }
    this.navPrev = nav;
  }

  /** Emit a keydown+keyup pair so the DOM menus (which listen for keys) can be driven by the pad. */
  private synth(code: string): void {
    const key = code;
    window.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true, cancelable: true }));
  }

  /** Call once at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
    this.padPressed.clear();
  }

  clear(): void {
    this.down.clear();
    this.pressed.clear();
    this.padPressed.clear();
  }
}
