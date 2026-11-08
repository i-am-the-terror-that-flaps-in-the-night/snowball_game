/** Keyboard / gamepad focus moves for the grid menus (the main-menu hub and its tab rail). */

export type ArrowCode = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';
type NavRect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;

/**
 * 2D focus move for grid menus: index of the rect nearest to `rects[from]` in the arrow's direction, or -1 when
 * nothing lies that way. Candidates must sit past the current rect's centre along the axis and inside a cone around
 * it; distance weighs the cross axis double so a tile straight below beats a closer one off to the side.
 */
export function spatialPick(rects: readonly NavRect[], from: number, code: ArrowCode): number {
  const c = rects[from];
  if (!c) return -1;
  const cx = (c.left + c.right) / 2;
  const cy = (c.top + c.bottom) / 2;
  const horiz = code === 'ArrowLeft' || code === 'ArrowRight';
  const sign = code === 'ArrowRight' || code === 'ArrowDown' ? 1 : -1;
  let best = -1;
  let bestD = Infinity;
  rects.forEach((r, i) => {
    if (i === from) return;
    const rx = (r.left + r.right) / 2;
    const ry = (r.top + r.bottom) / 2;
    // Edge-based gap along the axis (0 when the rects overlap there), so big tiles aren't penalised.
    const gap = horiz
      ? sign > 0 ? r.left - c.right : c.left - r.right
      : sign > 0 ? r.top - c.bottom : c.top - r.bottom;
    const ahead = horiz ? (rx - cx) * sign : (ry - cy) * sign;
    if (ahead <= 1) return;
    // Cross-axis offset: 0 when the rects overlap on the cross axis.
    const cross = horiz
      ? Math.max(0, r.top - c.bottom, c.top - r.bottom)
      : Math.max(0, r.left - c.right, c.left - r.right);
    // Stay inside a ~60° cone: a button far off to the side isn't "to the right", even if its centre is.
    if (cross > 2 * Math.max(0, gap) + 8) return;
    const crossC = horiz ? Math.abs(ry - cy) : Math.abs(rx - cx);
    const d = Math.max(0, gap) + 2 * cross + 0.01 * crossC;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

export type HubNavKind = 'cat' | 'util' | 'pane';

/**
 * Hub arrow move. Like spatialPick, except that the tab rail stays a rail: Left / Right from a tab only reach the
 * other tabs and the utility strip (coins / sound / settings), so Right off the last tab lands on the strip instead of
 * dropping diagonally into the pane. Up from a tab goes to the strip; when the cone finds nothing (the strip sits off to
 * the side at desktop width), the nearest strip button is taken. Returns -1 when nothing lies that way.
 */
export function hubPick(rects: readonly NavRect[], kinds: readonly HubNavKind[], from: number, code: ArrowCode): number {
  if (kinds[from] !== 'cat' || code === 'ArrowDown') return spatialPick(rects, from, code);
  const idx = rects.map((_, i) => i).filter((i) => i === from || kinds[i] === 'cat' || kinds[i] === 'util');
  const sub = idx.map((i) => rects[i]);
  const j = spatialPick(sub, idx.indexOf(from), code);
  if (j >= 0) return idx[j];
  if (code === 'ArrowLeft') return -1;
  // Right off the end of the rail, or Up: the nearest utility button that lies that way.
  const c = rects[from];
  const cx = (c.left + c.right) / 2;
  const cy = (c.top + c.bottom) / 2;
  let best = -1;
  let bestD = Infinity;
  rects.forEach((r, i) => {
    if (kinds[i] !== 'util') return;
    const rx = (r.left + r.right) / 2;
    const ry = (r.top + r.bottom) / 2;
    if (code === 'ArrowRight' && rx <= cx) return;
    const d = Math.hypot(rx - cx, ry - cy);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}
