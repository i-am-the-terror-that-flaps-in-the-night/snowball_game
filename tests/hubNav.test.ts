import { describe, expect, it } from 'vitest';
import { hubPick, spatialPick, type HubNavKind } from '../src/ui/UI';

/** Rect helper: x, y, width, height. */
const R = (x: number, y: number, w: number, h: number) => ({ left: x, top: y, right: x + w, bottom: y + h });

// Hub PLAY layout: tab rail on top, FIGHT hero (2x2) + 4 tiles in a 3-column grid, icons top-right.
const rects = [
  R(0, 0, 100, 40), // 0 PLAY tab
  R(100, 0, 100, 40), // 1 BUILD tab
  R(200, 0, 100, 40), // 2 RECORD tab
  R(0, 50, 410, 210), // 3 FIGHT (hero, spans 2 cols x 2 rows)
  R(420, 50, 200, 100), // 4 BRAWL
  R(420, 160, 200, 100), // 5 SURVIVAL
  R(0, 270, 200, 100), // 6 DAILY
  R(210, 270, 200, 100), // 7 DUEL
  R(420, 270, 200, 100), // 8 TUTORIAL
  R(600, -60, 40, 40), // 9 settings icon (top-right)
];

describe('hub spatial navigation', () => {
  it('moves right from the hero to the tile beside it', () => {
    expect(spatialPick(rects, 3, 'ArrowRight')).toBe(4);
  });
  it('moves down a column, not to the next tile in DOM order', () => {
    expect(spatialPick(rects, 4, 'ArrowDown')).toBe(5);
    expect(spatialPick(rects, 5, 'ArrowDown')).toBe(8);
    expect(spatialPick(rects, 3, 'ArrowDown')).toBe(6);
  });
  it('moves left back into the hero from the right column', () => {
    expect(spatialPick(rects, 5, 'ArrowLeft')).toBe(3);
    expect(spatialPick(rects, 8, 'ArrowLeft')).toBe(7);
  });
  it('moves up from the grid into the tab rail', () => {
    expect([0, 1, 2]).toContain(spatialPick(rects, 3, 'ArrowUp'));
    expect(spatialPick(rects, 6, 'ArrowUp')).toBe(3);
  });
  it('walks along the tab rail', () => {
    expect(spatialPick(rects, 0, 'ArrowRight')).toBe(1);
    expect(spatialPick(rects, 2, 'ArrowLeft')).toBe(1);
  });
  it('returns -1 when nothing lies that way', () => {
    expect(spatialPick(rects, 0, 'ArrowLeft')).toBe(-1);
    expect(spatialPick(rects, 7, 'ArrowDown')).toBe(-1);
    expect(spatialPick(rects, 99, 'ArrowDown')).toBe(-1);
  });
  it('ignores buttons far off to the side (narrow hub: full-width hero, icons in the top corner)', () => {
    const narrow = [R(16, 300, 388, 190), R(310, 18, 46, 46), R(16, 500, 190, 90), R(214, 500, 190, 90)];
    expect(spatialPick(narrow, 0, 'ArrowRight')).toBe(-1);
    expect(spatialPick(narrow, 0, 'ArrowUp')).toBe(1);
    expect(spatialPick(narrow, 2, 'ArrowRight')).toBe(3);
  });
});

describe('hub tab rail', () => {
  // Desktop: 4 tabs on the left of the top row, coins / sound / settings strip in the top-right corner above the
  // pane, a pane tile under the last tab (the diagonal jump the plain spatial pick used to take).
  const wide = [
    R(0, 100, 120, 40), // 0 PLAY
    R(120, 100, 120, 40), // 1 BUILD
    R(240, 100, 120, 40), // 2 RECORD
    R(360, 100, 120, 40), // 3 SYSTEM
    R(500, 150, 300, 120), // 4 pane tile (How to Play), down-right of SYSTEM
    R(0, 150, 480, 240), // 5 pane hero
    R(1000, 16, 120, 44), // 6 coins
    R(1130, 16, 44, 44), // 7 sound
    R(1180, 16, 44, 44), // 8 settings
  ];
  const kinds: HubNavKind[] = ['cat', 'cat', 'cat', 'cat', 'pane', 'pane', 'util', 'util', 'util'];

  it('walks the rail with Left / Right', () => {
    expect(hubPick(wide, kinds, 1, 'ArrowRight')).toBe(2);
    expect(hubPick(wide, kinds, 2, 'ArrowLeft')).toBe(1);
    expect(hubPick(wide, kinds, 0, 'ArrowLeft')).toBe(-1);
  });
  it('Right off the last tab lands on the utility strip, not in the pane', () => {
    expect(spatialPick(wide, 3, 'ArrowRight')).toBe(4); // the old diagonal drop
    expect(kinds[hubPick(wide, kinds, 3, 'ArrowRight')]).toBe('util');
    expect(hubPick(wide, kinds, 3, 'ArrowRight')).toBe(6);
  });
  it('Up from any tab reaches the utility strip', () => {
    expect(spatialPick(wide, 0, 'ArrowUp')).toBe(-1);
    expect(kinds[hubPick(wide, kinds, 0, 'ArrowUp')]).toBe('util');
    expect(kinds[hubPick(wide, kinds, 3, 'ArrowUp')]).toBe('util');
  });
  it('Down from a tab still enters the pane; moves from the pane and the strip are plain spatial moves', () => {
    expect(hubPick(wide, kinds, 0, 'ArrowDown')).toBe(5);
    expect(hubPick(wide, kinds, 4, 'ArrowLeft')).toBe(spatialPick(wide, 4, 'ArrowLeft'));
    expect(hubPick(wide, kinds, 7, 'ArrowRight')).toBe(8);
  });
});
