import { describe, expect, it } from 'vitest';
import { ULT_CAM_KILLS, ULT_CAM_WINDOW, ULT_CAM_WINDOW_HUNT, UltKillCam, ultCamLabel, ultCamWindow } from '../src/fx/ultCam';
import { HUNT_SECONDS } from '../src/entities/combat/revenant';

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

  it("keeps THE WILD HUNT's window open through its finale", () => {
    expect(ultCamWindow('classic')).toBe(ULT_CAM_WINDOW);
    expect(ultCamWindow('revenant')).toBe(ULT_CAM_WINDOW_HUNT);
    // The finale erupts a little after the ride ends (HUNT_SECONDS + FINALE_IN ~ 7.45 s).
    expect(ULT_CAM_WINDOW_HUNT).toBeGreaterThan(HUNT_SECONDS + 0.6);
    const c = new UltKillCam();
    c.onUlt(ultCamWindow('revenant'));
    c.update(7.5);
    c.onKill(0, 0);
    c.onKill(1, 0);
    expect(c.onKill(2, 0)).not.toBeNull();
  });
});
