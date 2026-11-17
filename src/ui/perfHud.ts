import type * as THREE from 'three';
import { FrameWindow, qualityLabel, settings } from '../core/settings';

/* Debug performance readout (art pass, docs/art-pass.md "Real-device check"): a small overlay with the frame rate
 * (median frame time of a rolling window, core/settings.ts FrameWindow: the measure AUTO quality decides on), its
 * 95th percentile, and from renderer.info for the whole frame (scene + shadow map + post passes): draw calls,
 * triangles, and the shader programs alive. On with Settings › Performance readout or the ?debug URL flag.
 *
 * Cost when off: one boolean test per frame. When on: renderer.info is switched to manual reset only around the frame's
 * own render (Game.frame), so every other renderer.render() (probes, warm-ups) counts as before; the text is rebuilt
 * twice a second; nothing is allocated per frame. */

const UPDATE_MS = 500;

export class PerfHud {
  private el: HTMLDivElement | null = null;
  private readonly win = new FrameWindow(120);
  private readonly st = { median: 0, high: 0 };
  private next = 0;
  private calls = 0;
  private tris = 0;
  private readonly debug: boolean;

  constructor(
    private readonly root: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    this.debug = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
  }

  /** The readout is wanted this frame. */
  get on(): boolean {
    return settings.perfHud || this.debug;
  }

  /** Before the frame's render: count the whole frame (several render() calls with bloom) from zero. */
  begin(): void {
    const info = this.renderer.info;
    info.autoReset = false;
    info.reset();
  }

  /** After it: `ms` = this frame's interval, `rendered` = false when the warm-up gate held the render back. */
  end(ms: number, now: number, rendered: boolean): void {
    const info = this.renderer.info;
    info.autoReset = true;
    this.win.push(ms);
    if (rendered) {
      this.calls = info.render.calls;
      this.tris = info.render.triangles;
    }
    if (now < this.next) return;
    this.next = now + UPDATE_MS;
    const el = (this.el ??= this.build());
    el.style.display = '';
    const s = this.win.stats(this.st);
    const fps = s.median > 0 ? Math.round(1000 / s.median) : 0;
    el.textContent =
      `${fps} FPS  ${s.median.toFixed(1)} ms (p95 ${s.high.toFixed(1)})  ${qualityLabel()}\n` +
      `draws ${this.calls}  tris ${(this.tris / 1000).toFixed(0)}k  programs ${info.programs?.length ?? 0}`;
  }

  /** Readout switched off: hide it and start a fresh window next time. */
  hide(): void {
    if (this.el && this.el.style.display !== 'none') {
      this.el.style.display = 'none';
      this.win.reset();
      this.next = 0;
    }
  }

  private build(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'perf-hud';
    Object.assign(el.style, {
      position: 'fixed', left: '8px', bottom: '8px', zIndex: '9999', pointerEvents: 'none', whiteSpace: 'pre',
      font: '600 11px/1.35 ui-monospace, Menlo, Consolas, monospace', color: '#e8f4ff', background: 'rgba(8, 14, 24, 0.72)',
      padding: '4px 7px', borderRadius: '4px', letterSpacing: '0.02em',
    });
    this.root.appendChild(el);
    return el;
  }
}
