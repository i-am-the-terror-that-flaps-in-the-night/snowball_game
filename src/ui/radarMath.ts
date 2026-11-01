/**
 * Pure maths for the campaign minimap and the lost-bot arrows (no DOM, no Three.js, so it unit-tests cheaply).
 *
 *   - heightClass: is a bot on your level, above you (hollow blip) or below you (solid, dimmed blip)?
 *   - mapView:     which square of the arena the minimap shows. Whole arena up to MAP_FULL_HALF; bigger arenas
 *                  (The Omega Works, 160 m) get a player-centred window clamped to the walls.
 *   - mapPoint:    world (x, z) -> minimap pixels, optionally clamped to the map square (off-window bots sit on the rim).
 *   - viewDir:     camera-space point -> a screen direction, also for points behind the camera.
 *   - edgePoint:   where along an inset screen rectangle an arrow toward a screen direction sits, and its angle.
 *   - spreadEdge:  slide arrows that landed on top of each other apart along the edge so every label stays readable.
 */

/** Height difference (m) beyond which a bot counts as above / below you. */
export const HEIGHT_BAND = 2;
/** Arenas up to this half-size (m) fit the minimap whole (campaign 30, Brawl 90 has its own map). */
export const MAP_FULL_HALF = 50;
/** Half-size (m) of the player-centred window on bigger arenas. */
export const MAP_WINDOW_HALF = 45;
/** Lost-bot arrows show while this many bots (or fewer) are left in the round / wave. */
export const ARROW_MAX_BOTS = 3;

/** -1 = below you, 0 = your level, 1 = above you. */
export type HeightClass = -1 | 0 | 1;

export function heightClass(botY: number, meY: number, band = HEIGHT_BAND): HeightClass {
  const dy = botY - meY;
  return dy > band ? 1 : dy < -band ? -1 : 0;
}

export interface MapView {
  /** World point at the map's centre. */
  cx: number;
  cz: number;
  /** Half the side (m) of the square shown. */
  half: number;
}

/** The square of the arena the map shows: the whole arena when it is small enough, else a window around the player
 *  clamped so it never shows past the walls. Writes into `out`. */
export function mapView(arenaHalf: number, px: number, pz: number, out: MapView, fullHalf = MAP_FULL_HALF, windowHalf = MAP_WINDOW_HALF): MapView {
  const a = Math.max(1, arenaHalf);
  if (a <= fullHalf || windowHalf >= a) {
    out.cx = 0;
    out.cz = 0;
    out.half = a;
    return out;
  }
  const lim = a - windowHalf;
  out.cx = Math.max(-lim, Math.min(lim, px));
  out.cz = Math.max(-lim, Math.min(lim, pz));
  out.half = windowHalf;
  return out;
}

export interface MapPoint {
  x: number;
  y: number;
  /** True when the point lay outside the view and was pulled onto its edge. */
  clamped: boolean;
}

/** World (x, z) -> pixels on a `size` px map with `pad` px of border (north up: -z at the top). */
export function mapPoint(x: number, z: number, v: MapView, size: number, pad: number, clamp: boolean, out: MapPoint): MapPoint {
  const sc = (size - pad * 2) / (2 * v.half);
  let u = (x - v.cx) / v.half;
  let w = (z - v.cz) / v.half;
  out.clamped = false;
  if (clamp && (Math.abs(u) > 1 || Math.abs(w) > 1)) {
    const m = Math.max(Math.abs(u), Math.abs(w));
    u /= m;
    w /= m;
    out.clamped = true;
  }
  out.x = pad + (u + 1) * v.half * sc;
  out.y = pad + (w + 1) * v.half * sc;
  return out;
}

export interface ScreenDir {
  /** Normalised device coordinates (-1..1 on screen; +y up). Behind the camera they are folded to the bottom. */
  x: number;
  y: number;
  behind: boolean;
}

/**
 * Camera-space point (vx, vy, vz; the camera looks down -z) -> NDC-like screen direction for a perspective camera with
 * projection scales p00 / p11 (projectionMatrix.elements[0] / [5]). Points behind the camera keep their left / right
 * side and are pushed below the bottom edge (turn around), instead of the mirrored result a plain projection gives.
 */
export function viewDir(vx: number, vy: number, vz: number, p00: number, p11: number, out: ScreenDir): ScreenDir {
  const depth = -vz;
  const d = Math.max(1e-3, Math.abs(depth));
  out.x = (p00 * vx) / d;
  out.y = (p11 * vy) / d;
  out.behind = depth <= 1e-3;
  if (out.behind) out.y = -(1.5 + Math.abs(out.y));
  return out;
}

/** An inset rectangle in screen pixels (left / top / right / bottom edges), y down. */
export interface EdgeRect {
  l: number;
  t: number;
  r: number;
  b: number;
}

/**
 * The rectangle edge arrows live on for a w x h HUD: clear of the side margins, the top HUD row and the bottom HUD
 * (plow / ability / snow panels, with room for the label under a bottom-edge arrow). `visible` = the looser rectangle
 * a target must be inside to count as on screen (down to the top of the bottom panels). Writes into `out`.
 */
export function arrowRect(w: number, h: number, out: EdgeRect, visible = false): EdgeRect {
  const side = Math.min(44, w * 0.08);
  out.l = side;
  out.r = w - side;
  out.t = Math.min(112, h * 0.17);
  out.b = h - (visible ? Math.min(160, h * 0.21) : Math.min(212, h * 0.29));
  return out;
}

export interface EdgeHit {
  x: number;
  y: number;
  /** Pointing angle in radians, screen space (0 = right, +PI/2 = down). */
  angle: number;
}

/**
 * Where an arrow pointing from the screen centre (w/2, h/2) toward NDC direction (nx, ny) meets the inset rectangle.
 * The centre is clamped into the rectangle first (asymmetric HUD margins). A zero direction points down.
 */
export function edgePoint(nx: number, ny: number, w: number, h: number, rect: EdgeRect, out: EdgeHit): EdgeHit {
  let dx = nx * (w / 2);
  let dy = -ny * (h / 2);
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) dy = 1;
  const cx = Math.max(rect.l, Math.min(rect.r, w / 2));
  const cy = Math.max(rect.t, Math.min(rect.b, h / 2));
  let s = Infinity;
  if (dx > 1e-9) s = Math.min(s, (rect.r - cx) / dx);
  else if (dx < -1e-9) s = Math.min(s, (rect.l - cx) / dx);
  if (dy > 1e-9) s = Math.min(s, (rect.b - cy) / dy);
  else if (dy < -1e-9) s = Math.min(s, (rect.t - cy) / dy);
  if (!Number.isFinite(s) || s < 0) s = 0;
  out.x = cx + dx * s;
  out.y = cy + dy * s;
  out.angle = Math.atan2(dy, dx);
  return out;
}

/** Minimum spacing (px) between two edge arrows: along a top / bottom edge (label width, "▲ 140 m") and along a side
 *  edge (tip + label height). Arrows closer than this on both axes are slid apart. */
export const ARROW_GAP_X = 70;
export const ARROW_GAP_Y = 58;

/**
 * Fan out the first `n` edge hits so no two sit within (gapX, gapY) of each other. Each later arrow keeps its spot if it
 * is clear; otherwise it moves along its own edge (vertically on a side edge, horizontally on the top / bottom) to the
 * nearest clear spot next to one of the earlier arrows, inside the rectangle. Angles are kept (each still points at its
 * bot). With 3 arrows that is a handful of comparisons per frame and no allocation.
 */
export function spreadEdge(hits: EdgeHit[], n: number, rect: EdgeRect, gapX = ARROW_GAP_X, gapY = ARROW_GAP_Y): void {
  for (let i = 1; i < n; i++) {
    const a = hits[i];
    if (clearOf(hits, i, a.x, a.y, gapX, gapY)) continue;
    const side = Math.min(a.x - rect.l, rect.r - a.x) < Math.min(a.y - rect.t, rect.b - a.y);
    const lo = side ? rect.t : rect.l;
    const hi = side ? rect.b : rect.r;
    const gap = side ? gapY : gapX;
    const at = side ? a.y : a.x;
    let best = at;
    let bestD = Infinity;
    for (let j = 0; j < i; j++) {
      const b = side ? hits[j].y : hits[j].x;
      for (let sg = -1; sg <= 1; sg += 2) {
        const c = b + sg * gap;
        if (c < lo - 1e-6 || c > hi + 1e-6) continue;
        const d = Math.abs(c - at);
        if (d >= bestD) continue;
        if (!clearOf(hits, i, side ? a.x : c, side ? c : a.y, gapX, gapY)) continue;
        best = c;
        bestD = d;
      }
    }
    if (side) a.y = best;
    else a.x = best;
  }
}

/** Is (x, y) at least (gapX or gapY) away from each of hits[0..i)? */
function clearOf(hits: EdgeHit[], i: number, x: number, y: number, gapX: number, gapY: number): boolean {
  for (let j = 0; j < i; j++) {
    if (Math.abs(x - hits[j].x) < gapX - 1e-6 && Math.abs(y - hits[j].y) < gapY - 1e-6) return false;
  }
  return true;
}

/** Is an NDC point comfortably on screen (inside the inset rectangle and in front of the camera)? */
export function onScreen(d: ScreenDir, w: number, h: number, rect: EdgeRect): boolean {
  if (d.behind) return false;
  const sx = (d.x + 1) * 0.5 * w;
  const sy = (1 - d.y) * 0.5 * h;
  return sx >= rect.l && sx <= rect.r && sy >= rect.t && sy <= rect.b;
}

/** "12 m" / "140 m" (whole metres). */
export function fmtDist(m: number): string {
  return `${Math.max(0, Math.round(m))} m`;
}
