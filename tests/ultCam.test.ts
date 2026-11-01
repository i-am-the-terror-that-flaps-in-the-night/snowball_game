import { describe, expect, it } from 'vitest';
import { ULT_CAM_KILLS, ULT_CAM_WINDOW, UltKillCam, ultCamLabel } from '../src/fx/ultCam';

describe('ultimate kill-cam trigger', () => {
  it('fires once, on the 3rd kill inside the window, framed on the kills', () => {
    const c = new UltKillCam();
    c.onUlt();
    expect(c.onKill(0, 0)).toBeNull();
    expect(c.onKill(3, 0)).toBeNull();
    const shot = c.onKill(0, 6);
    expect(shot).toEqual({ x: 1, z: 2, y: 0, kills: ULT_CAM_KILLS });
    // Later kills from the same ultimate don't fire again.
    expect(c.onKill(1, 1)).toBeNull();
    expect(c.kills).toBe(4);
  });

  it('frames the shot at the kills\' mean height (terrain arenas)', () => {
    const c = new UltKillCam();
    c.onUlt();
    c.onKill(0, 0, 3);
    c.onKill(3, 0, 6);
    expect(c.onKill(0, 6, 0)?.y).toBeCloseTo(3, 6);
  });

  it('2 kills do nothing, and kills without an ultimate never count', () => {
    const c = new UltKillCam();
    for (let i = 0; i < 5; i++) expect(c.onKill(i, i)).toBeNull();
    c.onUlt();
    c.onKill(0, 0);
    c.onKill(1, 1);
    c.update(ULT_CAM_WINDOW + 0.01);
    expect(c.onKill(2, 2)).toBeNull();
    expect(c.kills).toBe(0);
  });

  it('a new ultimate starts a fresh count, reset() closes the window', () => {
    const c = new UltKillCam();
    c.onUlt();
    c.onKill(0, 0);
    c.onKill(0, 0);
    c.onUlt();
    expect(c.onKill(0, 0)).toBeNull();
    c.onKill(0, 0);
    expect(c.onKill(0, 0)).not.toBeNull();
    c.onUlt();
    c.reset();
    for (let i = 0; i < 4; i++) expect(c.onKill(0, 0)).toBeNull();
  });

  it('labels scale with the wipe', () => {
    expect(ultCamLabel(3)).toContain('x3');
    expect(ultCamLabel(6)).toContain('WIPE');
    expect(ultCamLabel(9)).toContain('ANNIHILATION');
  });
});
