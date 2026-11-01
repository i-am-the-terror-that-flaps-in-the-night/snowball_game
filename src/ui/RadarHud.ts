import * as THREE from 'three';
import type { GameContext, RadarState } from '../core/types';
import { MinimapCanvas } from './Minimap';
import {
  ARROW_MAX_BOTS, arrowRect, edgePoint, fmtDist, heightClass, mapView, onScreen, spreadEdge, viewDir,
  type EdgeHit, type EdgeRect, type MapView, type ScreenDir,
} from './radarMath';

/* Campaign / Survival "lost-bot help" (docs/level-overhaul.md): a north-up minimap in the top-right corner (the Brawl
 * minimap look; bots red, bosses gold diamonds, bots more than 2 m above you hollow, below you dimmed) and, when 3 or
 * fewer bots are left, arrows on the screen edge pointing at the off-screen ones with their distance.
 *
 * Cheap by construction: the map redraws at ~12 Hz on a cached background (MinimapCanvas); the arrows are at most three
 * absolutely positioned elements moved with transforms, and the viewport size is cached (no layout reads per frame). */

/** CSS size of the radar (px); ui.css shrinks it on small screens via the box's scale. */
const RADAR_PX = 156;
const RADAR_PAD = 7;
/** Grid step on the radar (m). */
const RADAR_GRID = 10;
/** Map redraw interval (ms). */
const RADAR_INTERVAL = 80;

const BOT = '#ff3d4a';
const BOSS = '#ffd400';

interface Arrow {
  root: HTMLElement;
  tip: HTMLElement;
  label: HTMLElement;
  shown: boolean;
  text: string;
  boss: boolean;
}


const _v = new THREE.Vector3();
const _dir: ScreenDir = { x: 0, y: 0, behind: false };
/** Edge hits of this frame's visible arrows (pooled) and which blip each belongs to. */
const _hits: EdgeHit[] = Array.from({ length: ARROW_MAX_BOTS }, () => ({ x: 0, y: 0, angle: 0 }));
const _hitBlip: number[] = new Array<number>(ARROW_MAX_BOTS).fill(0);

export class RadarHud {
  private ctx: GameContext;
  private box: HTMLElement;
  private map: MinimapCanvas;
  private view: MapView = { cx: 0, cz: 0, half: 30 };
  private mapAt = 0;
  private on = false;
  private arrowsOn = false;
  private arrows: Arrow[] = [];
  private w = 0;
  private h = 0;
  private rect: EdgeRect = { l: 0, t: 0, r: 0, b: 0 };
  private vis: EdgeRect = { l: 0, t: 0, r: 0, b: 0 };
  private hudEl: HTMLElement;

  constructor(ctx: GameContext, hud: HTMLElement) {
    this.ctx = ctx;
    this.hudEl = hud;
    this.box = document.createElement('div');
    this.box.className = 'ss-radar ss-glass-dark';
    hud.appendChild(this.box);
    this.map = new MinimapCanvas(this.box, 'ss-radar-canvas', RADAR_PX, RADAR_PAD, RADAR_GRID);
    const n = document.createElement('div');
    n.className = 'ss-radar-n';
    n.textContent = 'N';
    this.box.appendChild(n);
    const lost = document.createElement('div');
    lost.className = 'ss-lost';
    hud.appendChild(lost);
    for (let i = 0; i < ARROW_MAX_BOTS; i++) {
      const root = document.createElement('div');
      root.className = 'ss-lost-arrow';
      const tip = document.createElement('div');
      tip.className = 'ss-lost-tip';
      const label = document.createElement('div');
      label.className = 'ss-lost-d';
      root.append(tip, label);
      lost.appendChild(root);
      this.arrows.push({ root, tip, label, shown: false, text: '', boss: false });
    }
    window.addEventListener('resize', () => this.measure());
  }

  /** Cache the HUD size and the arrow rectangle (clear of the top bars and the bottom ability row). */
  private measure(): void {
    this.w = this.hudEl.clientWidth || window.innerWidth;
    this.h = this.hudEl.clientHeight || window.innerHeight;
    arrowRect(this.w, this.h, this.rect);
    arrowRect(this.w, this.h, this.vis, true);
  }

  /** Per HUD update. `r` null = hide everything (Brawl, Duel, Tutorial, menus). */
  update(r: RadarState | null | undefined): void {
    const on = !!r;
    if (on !== this.on) {
      this.on = on;
      this.box.classList.toggle('on', on);
      // ui.css keeps the boss bars clear of the radar on narrow screens (.ss-hud.radar-on)
      this.hudEl.classList.toggle('radar-on', on);
      this.map.invalidate();
      this.mapAt = 0;
      if (on) this.measure();
    }
    if (!r) {
      this.setArrows(false);
      return;
    }
    const now = performance.now();
    if (now - this.mapAt >= RADAR_INTERVAL) {
      this.mapAt = now;
      this.drawMap(r, now);
    }
    this.setArrows(r.arrows);
    if (r.arrows) this.placeArrows(r);
  }

  private drawMap(r: RadarState, now: number): void {
    const m = this.map;
    const v = mapView(r.half, r.me.x, r.me.z, this.view);
    const g = m.begin(v, r.half, r.obstacles, this.ctx.terrain ?? null);
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
    for (let i = 0; i < r.count; i++) {
      const b = r.blips[i];
      const p = m.at(b.x, b.z, true);
      const hc = heightClass(b.y, r.me.y);
      const k = p.clamped ? 0.75 : 1;
      g.globalAlpha = p.clamped ? 0.75 : hc < 0 ? 0.6 : 1;
      if (b.boss) {
        const s = 6.5 * k;
        g.beginPath();
        g.moveTo(p.x, p.y - s);
        g.lineTo(p.x + s, p.y);
        g.lineTo(p.x, p.y + s);
        g.lineTo(p.x - s, p.y);
        g.closePath();
        if (hc > 0) {
          g.strokeStyle = BOSS;
          g.lineWidth = 2.2;
          g.stroke();
        } else {
          g.fillStyle = BOSS;
          g.strokeStyle = 'rgba(40, 0, 6, 0.9)';
          g.lineWidth = 1.6;
          g.fill();
          g.stroke();
        }
        if (!p.clamped) {
          g.globalAlpha = 0.25 + 0.5 * pulse;
          g.strokeStyle = BOSS;
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(p.x, p.y, 9 + pulse * 2.5, 0, Math.PI * 2);
          g.stroke();
        }
      } else {
        const rad = (hc < 0 ? 3.2 : 3.9) * k;
        g.beginPath();
        g.arc(p.x, p.y, rad, 0, Math.PI * 2);
        if (hc > 0) {
          g.strokeStyle = BOT;
          g.lineWidth = 2;
          g.stroke();
        } else {
          g.fillStyle = BOT;
          g.strokeStyle = 'rgba(0, 10, 25, 0.85)';
          g.lineWidth = 1.4;
          g.fill();
          g.stroke();
        }
      }
    }
    g.globalAlpha = 1;
    m.player(r.me.x, r.me.z, r.me.heading);
  }

  private setArrows(on: boolean): void {
    if (on === this.arrowsOn) return;
    this.arrowsOn = on;
    if (!on) for (const a of this.arrows) this.show(a, false);
  }

  private show(a: Arrow, on: boolean): void {
    if (a.shown === on) return;
    a.shown = on;
    a.root.classList.toggle('on', on);
  }

  /** Project each remaining bot; off-screen ones get an edge arrow with the distance (▲ / ▼ = above / below you).
   *  Arrows that land on the same stretch of edge are fanned out (radarMath.spreadEdge) so their labels stay readable. */
  private placeArrows(r: RadarState): void {
    const cam = this.ctx.camera as THREE.PerspectiveCamera;
    if (!this.w) this.measure();
    const pe = cam.projectionMatrix.elements;
    let n = 0;
    for (let i = 0; i < r.count && n < this.arrows.length; i++) {
      const b = r.blips[i];
      _v.set(b.x, b.y + 1, b.z).applyMatrix4(cam.matrixWorldInverse);
      viewDir(_v.x, _v.y, _v.z, pe[0], pe[5], _dir);
      if (onScreen(_dir, this.w, this.h, this.vis)) continue;
      edgePoint(_dir.x, _dir.y, this.w, this.h, this.rect, _hits[n]);
      _hitBlip[n] = i;
      n++;
    }
    spreadEdge(_hits, n, this.rect);
    for (let k = 0; k < this.arrows.length; k++) {
      const a = this.arrows[k];
      if (k >= n) {
        this.show(a, false);
        continue;
      }
      const hit = _hits[k];
      const b = r.blips[_hitBlip[k]];
      a.root.style.transform = `translate(${hit.x.toFixed(1)}px, ${hit.y.toFixed(1)}px)`;
      a.tip.style.transform = `rotate(${hit.angle.toFixed(3)}rad)`;
      const hc = heightClass(b.y, r.me.y);
      const text = `${hc > 0 ? '▲ ' : hc < 0 ? '▼ ' : ''}${fmtDist(Math.hypot(b.x - r.me.x, b.z - r.me.z))}`;
      if (text !== a.text) {
        a.text = text;
        a.label.textContent = text;
      }
      if (b.boss !== a.boss) {
        a.boss = b.boss;
        a.root.classList.toggle('boss', b.boss);
      }
      this.show(a, true);
    }
  }
}
