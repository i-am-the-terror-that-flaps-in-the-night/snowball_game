import { describe, expect, it } from 'vitest';
import {
  ARROW_ABOVE, ARROW_BELOW, ARROW_CLEAR, ARROW_GAP_X, ARROW_GAP_Y, ARROW_HALF_W, ARROW_MAX_BOTS, arrowRect, clampEdge, edgeLimits, HEIGHT_BAND,
  MAP_FULL_HALF, MAP_WINDOW_HALF, edgePoint, fmtDist, heightClass, mapPoint, mapView, onScreen, spreadEdge, viewDir,
  type EdgeHit, type EdgeLimits, type EdgeRect, type MapPoint, type MapView, type ScreenDir,
} from '../src/ui/radarMath';
import { MENU_BACKDROPS, TUTORIAL_ZONE, pickMenuZone } from '../src/core/modeZones';
import { ZONES } from '../src/config/zones';
import { Terrain } from '../src/world/Terrain';

const view = (): MapView => ({ cx: 0, cz: 0, half: 1 });
const pt = (): MapPoint => ({ x: 0, y: 0, clamped: false });
const dir = (): ScreenDir => ({ x: 0, y: 0, behind: false });
const hit = (): EdgeHit => ({ x: 0, y: 0, angle: 0 });

describe('heightClass (radar blips: above hollow, below dimmed)', () => {
  it('is level within the band and above / below beyond it', () => {
    expect(heightClass(0, 0)).toBe(0);
    expect(heightClass(HEIGHT_BAND, 0)).toBe(0);
    expect(heightClass(-HEIGHT_BAND, 0)).toBe(0);
    expect(heightClass(HEIGHT_BAND + 0.01, 0)).toBe(1);
    expect(heightClass(-HEIGHT_BAND - 0.01, 0)).toBe(-1);
  });
  it('is relative to the player (deck above / pit below)', () => {
    expect(heightClass(8, 5.5)).toBe(1);
    expect(heightClass(5.5, 8)).toBe(-1);
    expect(heightClass(9, 8)).toBe(0);
    expect(heightClass(1, 0, 0.5)).toBe(1);
  });
});

describe('mapView (minimap window)', () => {
  it('shows a campaign arena whole, centred', () => {
    const v = mapView(30, 12, -20, view());
    expect(v).toEqual({ cx: 0, cz: 0, half: 30 });
    expect(mapView(MAP_FULL_HALF, 40, 40, view()).half).toBe(MAP_FULL_HALF);
  });
  it('follows the player on The Omega Works (160 m) and never shows past the walls', () => {
    const v = mapView(80, 10, -5, view());
    expect(v.half).toBe(MAP_WINDOW_HALF);
    expect(v.cx).toBe(10);
    expect(v.cz).toBe(-5);
    const edge = mapView(80, 79, -79, view());
    expect(edge.cx).toBe(80 - MAP_WINDOW_HALF);
    expect(edge.cz).toBe(-(80 - MAP_WINDOW_HALF));
    expect(edge.cx + edge.half).toBe(80);
  });
});

describe('mapPoint (world -> minimap pixels, north up)', () => {
  const v: MapView = { cx: 0, cz: 0, half: 30 };
  it('maps the arena square onto the padded map', () => {
    const p = mapPoint(0, 0, v, 156, 7, false, pt());
    expect(p.x).toBeCloseTo(78);
    expect(p.y).toBeCloseTo(78);
    const nw = mapPoint(-30, -30, v, 156, 7, false, pt());
    expect(nw.x).toBeCloseTo(7);
    expect(nw.y).toBeCloseTo(7);
    const se = mapPoint(30, 30, v, 156, 7, false, pt());
    expect(se.x).toBeCloseTo(149);
    expect(se.y).toBeCloseTo(149);
  });
  it('clamps off-window bots onto the rim, keeping their bearing', () => {
    const w: MapView = { cx: 20, cz: 0, half: 45 };
    const p = mapPoint(20 + 90, 45, w, 100, 0, true, pt());
    expect(p.clamped).toBe(true);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(75); // (45 / 90) of the way down from the centre
    const inside = mapPoint(20, 0, w, 100, 0, true, pt());
    expect(inside.clamped).toBe(false);
    expect(inside.x).toBeCloseTo(50);
  });
});

describe('viewDir + edgePoint (lost-bot arrows)', () => {
  const W = 1280;
  const H = 720;
  const rect: EdgeRect = { l: 44, t: 112, r: W - 44, b: H - 150 };

  it('a point straight ahead is on screen', () => {
    const d = viewDir(0, 0, -10, 1.5, 2.6, dir());
    expect(d.behind).toBe(false);
    expect(d.x).toBeCloseTo(0);
    expect(onScreen(d, W, H, rect)).toBe(true);
  });
  it('a point far to the right lands on the right edge, pointing right', () => {
    const d = viewDir(50, 0, -5, 1.5, 2.6, dir());
    expect(onScreen(d, W, H, rect)).toBe(false);
    const e = edgePoint(d.x, d.y, W, H, rect, hit());
    expect(e.x).toBeCloseTo(rect.r);
    expect(e.angle).toBeCloseTo(0);
  });
  it('a point above lands on the top edge, pointing up', () => {
    const e = edgePoint(0, 3, W, H, rect, hit());
    expect(e.y).toBeCloseTo(rect.t);
    expect(e.x).toBeCloseTo(W / 2);
    expect(e.angle).toBeCloseTo(-Math.PI / 2);
  });
  it('a point behind the camera keeps its side and goes to the bottom', () => {
    const d = viewDir(3, 0, 10, 1.5, 2.6, dir());
    expect(d.behind).toBe(true);
    expect(d.x).toBeGreaterThan(0); // still right of centre (a plain projection mirrors it to the left)
    expect(d.y).toBeLessThan(-1);
    expect(onScreen(d, W, H, rect)).toBe(false);
    const e = edgePoint(d.x, d.y, W, H, rect, hit());
    expect(e.y).toBeCloseTo(rect.b);
    expect(e.x).toBeGreaterThan(W / 2);
    expect(e.angle).toBeGreaterThan(0);
    expect(e.angle).toBeLessThan(Math.PI / 2);
  });
  it('the edge point always lies on the inset rectangle', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.37) {
      const e = edgePoint(Math.cos(a) * 4, Math.sin(a) * 4, W, H, rect, hit());
      const onX = Math.abs(e.x - rect.l) < 1e-6 || Math.abs(e.x - rect.r) < 1e-6;
      const onY = Math.abs(e.y - rect.t) < 1e-6 || Math.abs(e.y - rect.b) < 1e-6;
      expect(onX || onY).toBe(true);
      expect(e.x).toBeGreaterThanOrEqual(rect.l - 1e-6);
      expect(e.x).toBeLessThanOrEqual(rect.r + 1e-6);
      expect(e.y).toBeGreaterThanOrEqual(rect.t - 1e-6);
      expect(e.y).toBeLessThanOrEqual(rect.b + 1e-6);
    }
  });
  it('a zero direction points down instead of producing NaN', () => {
    const e = edgePoint(0, 0, W, H, rect, hit());
    expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
    expect(e.y).toBeCloseTo(rect.b);
  });
  it('formats whole metres and arrows cover up to three bots', () => {
    expect(fmtDist(12.4)).toBe('12 m');
    expect(fmtDist(-3)).toBe('0 m');
    expect(ARROW_MAX_BOTS).toBe(3);
  });
});

describe('spreadEdge (lost-bot arrows in about the same direction)', () => {
  const W = 1280;
  const H = 720;
  const rect: EdgeRect = { l: 44, t: 112, r: W - 44, b: H - 150 };
  const apart = (a: EdgeHit, b: EdgeHit) => Math.abs(a.x - b.x) >= ARROW_GAP_X - 1e-6 || Math.abs(a.y - b.y) >= ARROW_GAP_Y - 1e-6;
  const inRect = (a: EdgeHit) => a.x >= rect.l - 1e-6 && a.x <= rect.r + 1e-6 && a.y >= rect.t - 1e-6 && a.y <= rect.b + 1e-6;

  it('fans out three arrows stacked on the bottom edge along that edge (the Rust Basin case)', () => {
    const hs = [397.6, 395.5, 399].map((x) => ({ x, y: rect.b, angle: 1.6 }));
    spreadEdge(hs, 3, rect);
    for (let i = 0; i < 3; i++) {
      expect(hs[i].y).toBe(rect.b);
      expect(hs[i].angle).toBe(1.6);
      for (let j = 0; j < i; j++) expect(apart(hs[i], hs[j])).toBe(true);
    }
    expect(hs[0].x).toBe(397.6);
  });

  it('slides along a side edge vertically and flips at a corner', () => {
    const hs = [{ x: rect.r, y: rect.b - 5, angle: 0 }, { x: rect.r, y: rect.b - 2, angle: 0 }];
    spreadEdge(hs, 2, rect);
    expect(hs[1].x).toBe(rect.r);
    expect(apart(hs[0], hs[1])).toBe(true);
    expect(inRect(hs[1])).toBe(true);
    const ts = [{ x: rect.r - 3, y: rect.t, angle: 0 }, { x: rect.r - 1, y: rect.t, angle: 0 }];
    spreadEdge(ts, 2, rect);
    expect(apart(ts[0], ts[1])).toBe(true);
    expect(inRect(ts[1])).toBe(true);
  });

  it('leaves arrows that are already apart alone and never pushes one off the rectangle', () => {
    const hs = [{ x: 200, y: rect.b, angle: 0 }, { x: 600, y: rect.b, angle: 0 }, { x: rect.l, y: 300, angle: 0 }];
    const before = hs.map((h) => ({ ...h }));
    spreadEdge(hs, 3, rect);
    expect(hs).toEqual(before);
    for (let k = 0; k < 200; k++) {
      const a = (k / 200) * Math.PI * 2;
      const rs = [0, 0.05, -0.04].map((d) => edgePoint(Math.cos(a + d) * 3, Math.sin(a + d) * 3, W, H, rect, hit()));
      spreadEdge(rs, 3, rect);
      for (let i = 0; i < 3; i++) {
        expect(inRect(rs[i])).toBe(true);
        for (let j = 0; j < i; j++) expect(apart(rs[i], rs[j])).toBe(true);
      }
    }
  });
});

describe('edgeLimits + clampEdge + spreadEdge (arrows keep clear of the HUD boxes)', () => {
  const lim = (): EdgeLimits => ({ lt: 0, rt: 0, tl: 0, tr: 0, bl: 0, br: 0, ok: false });
  /** Arrow footprint (tip + label) around an edge point. */
  const foot = (h: EdgeHit): EdgeRect => ({ l: h.x - ARROW_HALF_W, t: h.y - ARROW_ABOVE, r: h.x + ARROW_HALF_W, b: h.y + ARROW_BELOW });
  const hits = (a: EdgeRect, b: EdgeRect) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
  const onOutline = (h: EdgeHit, r: EdgeRect) =>
    h.x >= r.l - 1e-6 && h.x <= r.r + 1e-6 && h.y >= r.t - 1e-6 && h.y <= r.b + 1e-6 &&
    (Math.abs(h.x - r.l) < 1e-6 || Math.abs(h.x - r.r) < 1e-6 || Math.abs(h.y - r.t) < 1e-6 || Math.abs(h.y - r.b) < 1e-6);
  /** Every direction, three bots about the same way: arrows on the outline, apart, and off every box. */
  const sweep = (W: number, H: number, rect: EdgeRect, L: EdgeLimits, boxes: EdgeRect[]) => {
    for (let k = 0; k < 120; k++) {
      const a = (k / 120) * Math.PI * 2;
      const rs = [0, 0.06, -0.05].map((d) => clampEdge(edgePoint(Math.cos(a + d) * 3, Math.sin(a + d) * 3, W, H, rect, hit()), rect, L));
      spreadEdge(rs, 3, rect, undefined, undefined, L);
      for (let i = 0; i < 3; i++) {
        expect(onOutline(rs[i], rect)).toBe(true);
        for (const b of boxes) expect(hits(foot(rs[i]), b)).toBe(false);
        for (let j = 0; j < i; j++) {
          expect(Math.abs(rs[i].x - rs[j].x) >= ARROW_GAP_X - 1e-6 || Math.abs(rs[i].y - rs[j].y) >= ARROW_GAP_Y - 1e-6).toBe(true);
        }
      }
    }
  };

  it('1280 x 720 campaign: the top edge runs between the round box and the coin box / radar', () => {
    const W = 1280, H = 720;
    const rect = arrowRect(W, H, { l: 0, t: 0, r: 0, b: 0 });
    const boxes: EdgeRect[] = [{ l: 18, t: 18, r: 318, b: 177 }, { l: 1096, t: 18, r: 1262, b: 76 }, { l: 1092, t: 82, r: 1262, b: 250 }];
    const L = edgeLimits(rect, W, boxes, boxes.length, lim());
    expect(L.ok).toBe(true);
    expect(L.tl).toBe(318 + ARROW_HALF_W + ARROW_CLEAR);
    expect(L.tr).toBe(1092 - ARROW_HALF_W - ARROW_CLEAR);
    expect(L.lt).toBe(177 + ARROW_ABOVE + ARROW_CLEAR);
    expect(L.rt).toBe(250 + ARROW_ABOVE + ARROW_CLEAR);
    sweep(W, H, rect, L, boxes);
  });

  it('boss bars across the middle push the top edge below them', () => {
    const W = 1024, H = 768;
    const rect = arrowRect(W, H, { l: 0, t: 0, r: 0, b: 0 });
    const boxes: EdgeRect[] = [{ l: 18, t: 18, r: 294, b: 119 }, { l: 840, t: 18, r: 1006, b: 76 }, { l: 836, t: 82, r: 1006, b: 250 }, { l: 332, t: 14, r: 822, b: 124 }];
    const L = edgeLimits(rect, W, boxes, boxes.length, lim());
    expect(rect.t).toBeGreaterThanOrEqual(124 + ARROW_ABOVE + ARROW_CLEAR);
    expect(L.ok).toBe(true);
    sweep(W, H, rect, L, boxes);
  });

  it('667 x 375: right-edge arrows go below the radar or round the corner, bottom ones stay above the panels', () => {
    const W = 667, H = 375;
    const rect = arrowRect(W, H, { l: 0, t: 0, r: 0, b: 0 });
    rect.b = 273 - ARROW_BELOW - ARROW_CLEAR; // plow panel top (measured by RadarHud)
    const boxes: EdgeRect[] = [{ l: 18, t: 18, r: 229, b: 87 }, { l: 527, t: 18, r: 649, b: 59 }, { l: 533, t: 62, r: 649, b: 176 }, { l: 18, t: 95, r: 525, b: 136 }];
    const L = edgeLimits(rect, W, boxes, boxes.length, lim());
    expect(L.ok).toBe(true);
    sweep(W, H, rect, L, boxes);
    // straight right (the old failure: arrows on the minimap)
    const e = clampEdge(edgePoint(1, 0.2, W, H, rect, hit()), rect, L);
    expect(hits(foot(e), boxes[2])).toBe(false);
  });

  it('reports no room when the boxes fill the strip above the bottom panels', () => {
    const rect: EdgeRect = { l: 44, t: 54, r: 524, b: 183 };
    const boxes: EdgeRect[] = [{ l: 18, t: 18, r: 237, b: 87 }, { l: 434, t: 62, r: 550, b: 176 }, { l: 18, t: 95, r: 426, b: 169 }];
    const L = edgeLimits(rect, 568, boxes, boxes.length, lim());
    expect(L.ok).toBe(false);
    const h = { x: 44, y: 120, angle: 1 };
    clampEdge(h, rect, L);
    expect(h).toEqual({ x: 44, y: 120, angle: 1 }); // left alone
  });

  it('spills round a corner when an edge stretch is too short for two arrows', () => {
    const rect: EdgeRect = { l: 44, t: 54, r: 524, b: 183 };
    const L: EdgeLimits = { lt: 118, rt: 207, tl: 240, tr: 381, bl: 44, br: 388, ok: true };
    const hs = [{ x: 44, y: 171, angle: 2.5 }, { x: 44, y: 163, angle: 2.6 }];
    spreadEdge(hs, 2, rect, undefined, undefined, L);
    expect(hs[0]).toEqual({ x: 44, y: 171, angle: 2.5 });
    expect(Math.abs(hs[1].x - hs[0].x) >= ARROW_GAP_X || Math.abs(hs[1].y - hs[0].y) >= ARROW_GAP_Y).toBe(true);
    expect(onOutline(hs[1], rect)).toBe(true);
    expect(hs[1].angle).toBe(2.6);
  });
});

describe('arrowRect (where edge arrows may sit)', () => {
  it('keeps bottom-edge arrows and their labels above the bottom HUD, inside the looser on-screen box', () => {
    for (const [w, h] of [[1280, 720], [420, 860], [844, 390]]) {
      const r = arrowRect(w, h, { l: 0, t: 0, r: 0, b: 0 });
      const v = arrowRect(w, h, { l: 0, t: 0, r: 0, b: 0 }, true);
      expect(r.b).toBeLessThan(v.b);
      expect(r.t).toBeLessThan(r.b);
      expect(r.l).toBe(v.l);
      expect(r.r).toBe(w - r.l);
    }
    // 1280 x 720: tip (17 px) + label (36 px below the edge point) clear of the ability row (top ~ 555 px)
    expect(arrowRect(1280, 720, { l: 0, t: 0, r: 0, b: 0 }).b + 36).toBeLessThan(555);
  });
});

describe('mode zones (Training Yard, menu backdrop)', () => {
  it('the Training Yard is flat, plain snow and pays nothing', () => {
    expect(TUTORIAL_ZONE.terrain).toBeUndefined();
    expect(TUTORIAL_ZONE.biome).toBeUndefined();
    expect(TUTORIAL_ZONE.coinMult).toBe(0);
    const t = new Terrain(TUTORIAL_ZONE.terrain ?? {});
    expect(t.active).toBe(false);
    expect(t.materialAt(-12, -12)).toBe('snow');
    expect(t.gravity).toBe(new Terrain().gravity);
  });
  it('the menu backdrop is always one of the campaign biomes 1-5, never The Omega Works', () => {
    const seen = new Set<string>();
    for (let r = 0; r < 1; r += 0.013) {
      const z = pickMenuZone(r);
      expect(z.index).toBeLessThan(MENU_BACKDROPS);
      expect(z.index).toBeLessThan(5);
      seen.add(z.id);
    }
    expect(seen.size).toBe(Math.min(MENU_BACKDROPS, ZONES.length));
    expect(pickMenuZone(0.999999).index).toBe(4);
    expect(pickMenuZone(1).index).toBe(4);
  });
});
