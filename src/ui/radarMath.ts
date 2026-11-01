/**
 * Pure maths for the campaign minimap and the lost-bot arrows (no DOM, no Three.js, so it unit-tests cheaply).
 *
 *   - heightClass: is a bot on your level, above you (hollow blip) or below you (solid, dimmed blip)?
 *   - mapView:     which square of the arena the minimap shows. Whole arena up to MAP_FULL_HALF; bigger arenas
 *                  (The Omega Works, 160 m) get a player-centred window clamped to the walls.
 *   - mapPoint:    world (x, z) -> minimap pixels, optionally clamped to the map square (off-window bots sit on the rim).
 *   - viewDir:     camera-space point -> a screen direction, also for points behind the camera.
 *   - edgePoint:   where along an inset screen rectangle an arrow toward a screen direction sits, and its angle.
 *   - edgeLimits:  cut the stretches of edge that run along HUD boxes (round box, coin box, radar, boss bars) out of
 *                  the arrow rectangle; clampEdge moves an arrow that landed in a cut-out to the nearest usable spot.
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
export const ARROW_GAP_Y = 66;

/** Footprint of one edge arrow around its edge point (px): the 34 px tip box centred on it (up to 25 px each way once
 *  rotated) and the distance label under it (up to ~76 px wide, from 18 px to ~36 px below the point). */
export const ARROW_HALF_W = 40;
export const ARROW_ABOVE = 25;
export const ARROW_BELOW = 38;
/** Room (px) kept between an arrow's footprint and a HUD box. */
export const ARROW_CLEAR = 6;

/** The usable stretches of the arrow rectangle's edges once the HUD boxes along the top are cut out: the left / right
 *  edges run from y = lt / rt down to rect.b, the top / bottom edges from x = tl / bl to x = tr / br. A stretch is
 *  empty when its start is past its end (lt > rect.b, tl > tr, ...). `ok` = at least one stretch is usable. */
export interface EdgeLimits {
  lt: number;
  rt: number;
  tl: number;
  tr: number;
  bl: number;
  br: number;
  ok: boolean;
}

/** Does box `o` reach into the footprint row of arrows sitting on y? */
const reachesRow = (o: EdgeRect, y: number) => o.b > y - ARROW_ABOVE - ARROW_CLEAR && o.t < y + ARROW_BELOW + ARROW_CLEAR;

/** The stretch [lo, hi] of the row y left free by the boxes reaching into it: boxes left of the middle push lo right,
 *  boxes right of it push hi left. Returns false when a box across the middle blocks the row. */
function rowStretch(rect: EdgeRect, mid: number, boxes: readonly EdgeRect[], n: number, y: number, out: { lo: number; hi: number }): boolean {
  out.lo = rect.l;
  out.hi = rect.r;
  for (let i = 0; i < n; i++) {
    const o = boxes[i];
    if (!reachesRow(o, y)) continue;
    if (o.l < mid + ARROW_HALF_W && o.r > mid - ARROW_HALF_W) return false;
    if (o.r <= mid) out.lo = Math.max(out.lo, o.r + ARROW_HALF_W + ARROW_CLEAR);
    else out.hi = Math.min(out.hi, o.l - ARROW_HALF_W - ARROW_CLEAR);
  }
  return true;
}

const _row = { lo: 0, hi: 0 };

/**
 * Fit the arrow rectangle around the first `n` HUD boxes hanging from the top of the screen (screen px). The top edge
 * moves below any box across the middle (boss bars), and below the side boxes too when they leave it no stretch; boxes
 * in the left / right part of a row shorten that row; a side edge starts below the boxes over its column. May lower
 * `rect.t`; writes the stretches into `out`. Called once per layout change (allocates nothing).
 */
export function edgeLimits(rect: EdgeRect, w: number, boxes: readonly EdgeRect[], n: number, out: EdgeLimits): EdgeLimits {
  const mid = w / 2;
  for (let pass = 0; pass < 8; pass++) {
    if (rowStretch(rect, mid, boxes, n, rect.t, _row) && _row.lo <= _row.hi) break;
    let low = rect.t;
    for (let i = 0; i < n; i++) if (reachesRow(boxes[i], rect.t)) low = Math.max(low, boxes[i].b + ARROW_ABOVE + ARROW_CLEAR);
    if (low <= rect.t) break;
    rect.t = low;
  }
  const topOk = rect.t <= rect.b && rowStretch(rect, mid, boxes, n, rect.t, _row);
  out.tl = topOk ? _row.lo : rect.r + 1;
  out.tr = topOk ? _row.hi : rect.l - 1;
  const botOk = rowStretch(rect, mid, boxes, n, rect.b, _row);
  out.bl = botOk ? _row.lo : rect.r + 1;
  out.br = botOk ? _row.hi : rect.l - 1;
  out.lt = rect.t;
  out.rt = rect.t;
  for (let i = 0; i < n; i++) {
    const o = boxes[i];
    const below = o.b + ARROW_ABOVE + ARROW_CLEAR;
    if (o.l < rect.l + ARROW_HALF_W + ARROW_CLEAR && o.r > rect.l - ARROW_HALF_W - ARROW_CLEAR) out.lt = Math.max(out.lt, below);
    if (o.l < rect.r + ARROW_HALF_W + ARROW_CLEAR && o.r > rect.r - ARROW_HALF_W - ARROW_CLEAR) out.rt = Math.max(out.rt, below);
  }
  out.ok = out.tl <= out.tr || out.bl <= out.br || out.lt <= rect.b || out.rt <= rect.b;
  return out;
}

/**
 * Move an edge hit that landed outside the usable stretches (edgeLimits) to the nearest usable spot, walking along the
 * rectangle's outline (so it may go round a corner onto the next edge). The angle is kept: the arrow still points at
 * its bot. Leaves the hit alone when nothing is usable. No allocation (runs per arrow per frame).
 */
export function clampEdge(hit: EdgeHit, rect: EdgeRect, lim: EdgeLimits): EdgeHit {
  if (!lim.ok) return hit;
  const W = Math.max(0, rect.r - rect.l);
  const H = Math.max(0, rect.b - rect.t);
  const P = 2 * (W + H);
  const p = perimeterOf(hit.x, hit.y, rect, W, H);
  _near.at = p;
  _near.d = Infinity;
  nearestOn(lim.tl - rect.l, lim.tr - rect.l, p, P);
  if (lim.rt <= rect.b) nearestOn(W + (lim.rt - rect.t), W + H, p, P);
  nearestOn(W + H + (rect.r - lim.br), W + H + (rect.r - lim.bl), p, P);
  if (lim.lt <= rect.b) nearestOn(2 * W + H, 2 * W + H + (rect.b - lim.lt), p, P);
  if (_near.d <= 1e-6) return hit;
  pointAt(_near.at, rect, W, H);
  hit.x = _pt.x;
  hit.y = _pt.y;
  return hit;
}

/** Scratch for clampEdge: the nearest usable perimeter coordinate so far and its distance. */
const _near = { at: 0, d: Infinity };

/** Distance between perimeter coordinates x and p on a loop of length P (either way round). */
function loopDist(x: number, p: number, P: number): number {
  const d = Math.abs(x - p);
  return Math.min(d, P - d);
}

/** Offer the stretch [a, b] of the outline to clampEdge: its point nearest to p (p itself, or an end). */
function nearestOn(a: number, b: number, p: number, P: number): void {
  if (a > b) return;
  if (p >= a && p <= b) {
    _near.at = p;
    _near.d = 0;
    return;
  }
  const da = loopDist(a, p, P);
  const db = loopDist(b, p, P);
  const c = da <= db ? a : b;
  const d = Math.min(da, db);
  if (d < _near.d) {
    _near.at = c;
    _near.d = d;
  }
}

/**
 * Fan out the first `n` edge hits so no two sit within (gapX, gapY) of each other. Each later arrow keeps its spot if it
 * is clear; otherwise it moves along its own edge (vertically on a side edge, horizontally on the top / bottom) to the
 * nearest clear spot next to one of the earlier arrows, inside the rectangle (and inside `lim`'s stretches when given).
 * When its edge has no such spot (a short stretch), it walks round the outline to the nearest clear usable spot, round
 * a corner if need be. Angles are kept (each still points at its bot). With 3 arrows that is a handful of comparisons
 * per frame and no allocation.
 */
export function spreadEdge(hits: EdgeHit[], n: number, rect: EdgeRect, gapX = ARROW_GAP_X, gapY = ARROW_GAP_Y, lim?: EdgeLimits): void {
  for (let i = 1; i < n; i++) {
    const a = hits[i];
    if (clearOf(hits, i, a.x, a.y, gapX, gapY)) continue;
    const side = Math.min(a.x - rect.l, rect.r - a.x) < Math.min(a.y - rect.t, rect.b - a.y);
    const top = !side && a.y - rect.t <= rect.b - a.y;
    // usable stretch of this edge (cut-outs from edgeLimits)
    const lo = !lim ? (side ? rect.t : rect.l) : side ? (a.x < (rect.l + rect.r) / 2 ? lim.lt : lim.rt) : top ? lim.tl : lim.bl;
    const hi = !lim ? (side ? rect.b : rect.r) : side ? rect.b : top ? lim.tr : lim.br;
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
    if (bestD < Infinity) {
      if (side) a.y = best;
      else a.x = best;
    } else walkClear(hits, i, rect, gapX, gapY, lim);
  }
}

/** Outline step (px) of the fallback walk in spreadEdge. */
const WALK_STEP = 2;
const _pt = { x: 0, y: 0 };

/** Perimeter coordinate of an edge point, clockwise from the top-left corner (top, right, bottom, left edge). */
function perimeterOf(x: number, y: number, rect: EdgeRect, W: number, H: number): number {
  const dl = Math.abs(x - rect.l), dr = Math.abs(rect.r - x), dt = Math.abs(y - rect.t), db = Math.abs(rect.b - y);
  const m = Math.min(dl, dr, dt, db);
  return m === dt ? x - rect.l : m === dr ? W + (y - rect.t) : m === db ? W + H + (rect.r - x) : 2 * W + H + (rect.b - y);
}

/** The edge point at perimeter coordinate q (0 <= q < P) into _pt; false when it lies outside lim's stretches. */
function pointAt(q: number, rect: EdgeRect, W: number, H: number, lim?: EdgeLimits): boolean {
  if (q <= W) {
    _pt.x = rect.l + q;
    _pt.y = rect.t;
    return !lim || (_pt.x >= lim.tl && _pt.x <= lim.tr);
  }
  if (q <= W + H) {
    _pt.x = rect.r;
    _pt.y = rect.t + (q - W);
    return !lim || _pt.y >= lim.rt;
  }
  if (q <= 2 * W + H) {
    _pt.x = rect.r - (q - W - H);
    _pt.y = rect.b;
    return !lim || (_pt.x >= lim.bl && _pt.x <= lim.br);
  }
  _pt.x = rect.l;
  _pt.y = rect.b - (q - 2 * W - H);
  return !lim || _pt.y >= lim.lt;
}

/** spreadEdge's fallback: move hits[i] to the nearest usable spot along the outline that is clear of hits[0..i). */
function walkClear(hits: EdgeHit[], i: number, rect: EdgeRect, gapX: number, gapY: number, lim?: EdgeLimits): void {
  const a = hits[i];
  const W = Math.max(0, rect.r - rect.l);
  const H = Math.max(0, rect.b - rect.t);
  const P = 2 * (W + H);
  if (P <= 0) return;
  const p = perimeterOf(a.x, a.y, rect, W, H);
  for (let d = WALK_STEP; d <= P / 2; d += WALK_STEP) {
    for (let sg = -1; sg <= 1; sg += 2) {
      const q = (((p + sg * d) % P) + P) % P;
      if (!pointAt(q, rect, W, H, lim) || !clearOf(hits, i, _pt.x, _pt.y, gapX, gapY)) continue;
      a.x = _pt.x;
      a.y = _pt.y;
      return;
    }
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
