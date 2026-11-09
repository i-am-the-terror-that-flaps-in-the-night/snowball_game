import type { Obstacle } from '../core/types';
import type { Terrain } from '../world/Terrain';
import { mapPoint, type MapPoint, type MapView } from './radarMath';

/**
 * Shared minimap canvas (Brawl HUD + the campaign / Survival radar): a cached background (arena square, grid, walls,
 * obstacles and, when given, the terrain's ramps / bowls / lava / ice / decks) blitted under per-frame marks.
 *
 * The background is drawn once for the WHOLE arena at the current map scale and only redrawn when the arena, its
 * obstacles / terrain, the scale or the pixel ratio change. Big arenas show a window of it (see radarMath.mapView), so
 * scrolling the window is a single drawImage with a source rectangle, never a redraw.
 */
export class MinimapCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  /** CSS size of the (square) map, px. */
  readonly size: number;
  readonly pad: number;
  private bg: HTMLCanvasElement;
  private key = { obs: null as readonly Obstacle[] | null, n: -1, shapes: null as unknown, patches: null as unknown, decks: null as unknown, half: 0, sc: 0, dpr: 0 };
  private view: MapView = { cx: 0, cz: 0, half: 1 };
  private pt: MapPoint = { x: 0, y: 0, clamped: false };

  constructor(parent: HTMLElement, cls: string, size: number, pad: number, private gridStep: number) {
    this.size = size;
    this.pad = pad;
    this.canvas = document.createElement('canvas');
    this.canvas.className = cls;
    parent.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    this.bg = document.createElement('canvas');
  }

  /** Forget the cached background (new match / arena). */
  invalidate(): void {
    this.key.obs = null;
    this.key.half = 0;
  }

  /**
   * Start a frame: size the backing store, (re)draw the background if needed, blit the visible window and leave the
   * context in CSS-pixel space for the marks. `arenaHalf` = half-size of the whole arena; `view` = the square shown.
   */
  begin(view: MapView, arenaHalf: number, obstacles: readonly Obstacle[], terrain: Terrain | null): CanvasRenderingContext2D {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(this.size * dpr);
    const cv = this.canvas;
    if (cv.width !== px) {
      cv.width = px;
      cv.height = px;
    }
    const v = this.view;
    v.cx = view.cx;
    v.cz = view.cz;
    v.half = view.half;
    const A = Math.max(1, arenaHalf);
    const sc = (this.size - this.pad * 2) / (2 * v.half);
    const k = this.key;
    const t = terrain && (terrain.shapes.length || terrain.patches.length || terrain.decks.length) ? terrain : null;
    if (
      k.obs !== obstacles || k.n !== obstacles.length || k.half !== A || k.sc !== sc || k.dpr !== dpr
      || k.shapes !== (t?.shapes ?? null) || k.patches !== (t?.patches ?? null) || k.decks !== (t?.decks ?? null)
    ) {
      k.obs = obstacles;
      k.n = obstacles.length;
      k.half = A;
      k.sc = sc;
      k.dpr = dpr;
      k.shapes = t?.shapes ?? null;
      k.patches = t?.patches ?? null;
      k.decks = t?.decks ?? null;
      this.drawBg(A, sc, dpr, obstacles, t);
    }
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, px, px);
    // bg pixel of world x = pad + (x + A) * sc; map pixel = pad + (x - cx + half) * sc
    const ox = (A + v.cx - v.half) * sc * dpr;
    const oz = (A + v.cz - v.half) * sc * dpr;
    g.drawImage(this.bg, ox, oz, px, px, 0, 0, px, px);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return g;
  }

  /** World (x, z) -> map CSS pixels for the current frame (shared result object: copy before the next call). */
  at(x: number, z: number, clamp = false): MapPoint {
    return mapPoint(x, z, this.view, this.size, this.pad, clamp, this.pt);
  }

  /** Map scale of the current frame (CSS px per metre). */
  get scale(): number {
    return (this.size - this.pad * 2) / (2 * this.view.half);
  }

  /** The player: an orange arrow with a white rim, pointing along `heading` (0 = +z = down on the map). */
  player(x: number, z: number, heading: number): void {
    const p = this.at(x, z, true);
    const g = this.g;
    g.save();
    g.translate(p.x, p.y);
    g.rotate(Math.PI - heading);
    g.fillStyle = '#ff9b2f';
    g.strokeStyle = '#fff';
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(5.5, 6);
    g.lineTo(0, 3);
    g.lineTo(-5.5, 6);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  private drawBg(A: number, sc: number, dpr: number, obs: readonly Obstacle[], t: Terrain | null): void {
    const pad = this.pad;
    const side = 2 * A * sc + 2 * pad;
    const bpx = Math.ceil(side * dpr);
    const bg = this.bg;
    bg.width = bpx;
    bg.height = bpx;
    const g = bg.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, side, side);
    const X = (x: number) => pad + (x + A) * sc;
    const w = 2 * A * sc;
    g.fillStyle = 'rgba(225, 242, 255, 0.16)';
    g.fillRect(pad, pad, w, w);
    if (t) this.drawTerrain(g, t, X, sc);
    // grid
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    g.beginPath();
    for (let v = -A + this.gridStep; v < A - 1e-6; v += this.gridStep) {
      const p = X(v);
      g.moveTo(p, pad);
      g.lineTo(p, pad + w);
      g.moveTo(pad, p);
      g.lineTo(pad + w, p);
    }
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2;
    g.strokeRect(pad, pad, w, w);
    g.fillStyle = 'rgba(150, 168, 190, 0.9)';
    g.strokeStyle = 'rgba(40, 55, 75, 0.9)';
    g.lineWidth = 1;
    for (const o of obs) {
      g.beginPath();
      g.arc(X(o.x), X(o.z), Math.max(1.5, o.r * sc), 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }

  /** Terrain under the grid: bowls / domes / mesas as soft rings, ramps as wedges (arrow toward the lip), lava and ice
   *  patches, decks as slabs (lighter = higher). */
  private drawTerrain(g: CanvasRenderingContext2D, t: Terrain, X: (v: number) => number, sc: number): void {
    for (const s of t.shapes) {
      if (s.kind === 'dome' || s.kind === 'mesa') {
        g.beginPath();
        g.arc(X(s.x), X(s.z), Math.max(2, s.r * sc), 0, Math.PI * 2);
        g.fillStyle = s.h < 0 ? 'rgba(0, 20, 45, 0.28)' : 'rgba(255, 255, 255, 0.1)';
        g.fill();
        g.strokeStyle = s.h < 0 ? 'rgba(140, 190, 255, 0.35)' : 'rgba(255, 255, 255, 0.28)';
        g.lineWidth = 1;
        g.stroke();
      } else if (s.kind === 'ridge') {
        g.strokeStyle = s.h < 0 ? 'rgba(0, 20, 45, 0.3)' : 'rgba(255, 255, 255, 0.14)';
        g.lineCap = 'round';
        g.lineWidth = Math.max(2, s.w * sc);
        g.beginPath();
        g.moveTo(X(s.x1), X(s.z1));
        g.lineTo(X(s.x2), X(s.z2));
        g.stroke();
        g.lineCap = 'butt';
      } else if (s.kind === 'ramp') {
        // local frame: v along the ramp (toe -> lip) = (sin rot, cos rot), u across = (cos rot, -sin rot)
        const sv = Math.sin(s.rot);
        const cv = Math.cos(s.rot);
        const hw = s.w / 2;
        const P = (u: number, v: number): [number, number] => [X(s.x + u * cv + v * sv), X(s.z - u * sv + v * cv)];
        const a = P(-hw, 0);
        const b = P(hw, 0);
        const c = P(hw, s.len);
        const d = P(-hw, s.len);
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
        g.lineTo(c[0], c[1]);
        g.lineTo(d[0], d[1]);
        g.closePath();
        g.fillStyle = 'rgba(255, 212, 0, 0.32)';
        g.fill();
        g.strokeStyle = 'rgba(255, 212, 0, 0.9)';
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(d[0], d[1]);
        g.lineTo(c[0], c[1]); // the lip
        g.stroke();
      }
    }
    for (const p of t.patches) {
      if (p.material !== 'lava' && p.material !== 'ice') continue;
      g.fillStyle = p.material === 'lava' ? 'rgba(255, 90, 0, 0.6)' : 'rgba(170, 225, 255, 0.35)';
      g.strokeStyle = g.fillStyle;
      if (p.x2 !== undefined && p.z2 !== undefined) {
        g.lineCap = 'round';
        g.lineWidth = Math.max(2, p.r * 2 * sc);
        g.beginPath();
        g.moveTo(X(p.x), X(p.z));
        g.lineTo(X(p.x2), X(p.z2));
        g.stroke();
        g.lineCap = 'butt';
      } else {
        g.beginPath();
        g.arc(X(p.x), X(p.z), Math.max(1.5, p.r * sc), 0, Math.PI * 2);
        g.fill();
      }
    }
    if (t.decks.length) {
      let hi = 1;
      for (const d of t.decks) hi = Math.max(hi, d.top + Math.max(0, d.rise ?? 0));
      for (const d of t.decks) {
        const k = Math.max(0, Math.min(1, (d.top + Math.max(0, d.rise ?? 0) / 2) / hi));
        const c = Math.cos(d.rot);
        const s = Math.sin(d.rot);
        // world = centre + lx * (c, -s) + lz * (s, c)  (inverse of Terrain.inDeck's rotation)
        const P = (lx: number, lz: number): [number, number] => [X(d.x + lx * c + lz * s), X(d.z - lx * s + lz * c)];
        const a = P(-d.hw, -d.hd);
        const b = P(d.hw, -d.hd);
        const e = P(d.hw, d.hd);
        const f = P(-d.hw, d.hd);
        g.beginPath();
        g.moveTo(a[0], a[1]);
        g.lineTo(b[0], b[1]);
        g.lineTo(e[0], e[1]);
        g.lineTo(f[0], f[1]);
        g.closePath();
        g.fillStyle = `rgba(${Math.round(90 + 110 * k)}, ${Math.round(100 + 110 * k)}, ${Math.round(130 + 110 * k)}, ${0.45 + 0.35 * k})`;
        g.fill();
        g.strokeStyle = 'rgba(10, 14, 24, 0.8)';
        g.lineWidth = 1;
        g.stroke();
      }
    }
  }
}
