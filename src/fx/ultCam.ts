/**
 * Ultimate kill-cam trigger. An ultimate (the critCharge-slot F: FIRESTORM, SUPERCELL, EARTHQUAKE, ISOTOPE NUKE,
 * ORBITAL STRIKE; Combat emits `ability {nuke: true}`) opens a window; the 3rd player kill inside it fires the
 * cinematic ONCE for that ultimate, framed on the kills' centroid. Pure logic (no scene access) so it unit-tests.
 */

/** Seconds after an ultimate starts during which kills count toward it (the longest ultimates, FIRESTORM's fire
 *  field and the NUKE's radiation, run ~4 s; a little slack for the last burn tick). */
export const ULT_CAM_WINDOW = 4.5;
/** Kills inside the window that trigger the kill-cam. */
export const ULT_CAM_KILLS = 3;
/** Real-time length of the slow-mo + camera move. */
export const ULT_CAM_SECONDS = 1.1;
/** Real seconds after the trigger before the banner shows, so it counts the rest of the same blast's kills. */
export const ULT_CAM_TOAST_DELAY = 0.4;

/** "x3 ULTIMATE"-style banner text for `kills`. */
export function ultCamLabel(kills: number): string {
  if (kills >= 8) return `☠ x${kills} ANNIHILATION`;
  if (kills >= 5) return `💥 x${kills} ULTIMATE WIPE`;
  return `💥 x${kills} ULTIMATE`;
}

export interface UltCamShot {
  x: number;
  z: number;
  kills: number;
}

export class UltKillCam {
  /** Seconds left in the current ultimate's window (0 = none open). */
  private t = 0;
  private fired = false;
  private n = 0;
  private sx = 0;
  private sz = 0;

  /** The player's ultimate just went off. A new ultimate opens a fresh window. */
  onUlt(): void {
    this.t = ULT_CAM_WINDOW;
    this.fired = false;
    this.n = this.sx = this.sz = 0;
  }

  /** A player kill at (x, z). Returns the shot to play when this is the kill that triggers the cam, else null. */
  onKill(x: number, z: number): UltCamShot | null {
    if (this.t <= 0) return null;
    this.n++;
    this.sx += x;
    this.sz += z;
    if (this.fired || this.n < ULT_CAM_KILLS) return null;
    this.fired = true;
    return { x: this.sx / this.n, z: this.sz / this.n, kills: this.n };
  }

  /** Kills so far in the open window (0 when closed); for a running tally after the cam fires. */
  get kills(): number {
    return this.t > 0 ? this.n : 0;
  }

  update(dt: number): void {
    if (this.t > 0) this.t = Math.max(0, this.t - dt);
  }

  reset(): void {
    this.t = 0;
    this.fired = false;
    this.n = this.sx = this.sz = 0;
  }
}
