const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

/** Keyboard state. Uses KeyboardEvent.code values ('KeyW', 'Space', 'ShiftLeft', ...). */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      if (PREVENT.has(e.code)) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    target.addEventListener('blur', () => this.clear());
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True only on the frame the key went down. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** +1 forward (W / ArrowUp), -1 reverse (S / ArrowDown). */
  get throttle(): number {
    let t = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) t += 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) t -= 1;
    return t;
  }

  /** +1 = turn left (A / ArrowLeft), -1 = turn right (D / ArrowRight). Use: heading += steer * turnRate * dt. */
  get steer(): number {
    let s = 0;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) s += 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) s -= 1;
    return s;
  }

  get launch(): boolean {
    return this.wasPressed('Space');
  }

  get turbo(): boolean {
    return this.isDown('ShiftLeft') || this.isDown('ShiftRight');
  }

  /** Call once at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
  }

  clear(): void {
    this.down.clear();
    this.pressed.clear();
  }
}
