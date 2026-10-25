import './style-shop.css';
import * as THREE from 'three';
import type { GameContext, SoundName } from '../core/types';
import { COSMETIC_SLOTS, cosmeticsInSlot, type CosmeticDef, type CosmeticSlot } from '../config/cosmetics';
import {
  buyCheck, buyCosmetic, cosmeticsState, equipCosmetic, equippedLook, isOwned, lockHint, lockLabel,
} from '../meta/cosmetics';
import { Plow } from '../entities/Plow';
import { FACTORY_PAINT, drawDecal } from '../entities/plowModels';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');
const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/** Restart a one-shot CSS animation class. */
function restart(e: HTMLElement, cls: string): void {
  e.classList.remove(cls);
  void e.offsetWidth;
  e.classList.add(cls);
}

const TABS: Record<CosmeticSlot, { label: string; icon: string; blurb: string }> = {
  paint: { label: 'Paint', icon: '🎨', blurb: 'Body colour for whichever plow you drive.' },
  decal: { label: 'Decal', icon: '💀', blurb: 'Stripes, flames and crests on the bodywork.' },
  trail: { label: 'Trail', icon: '💨', blurb: 'Particles off the back while you drive. Dash for a burst.' },
};

/** Showcase camera: direction from the plow (normalized in the constructor), plow size to frame (m), distance clamp. */
const SHOW_DIR = new THREE.Vector3(0.62, 0.42, 0.66);
const SHOW_FRAME_W = 8.5;
const SHOW_FRAME_H = 5;
const SHOW_MIN_D = 10;
const SHOW_MAX_D = 24;
/** Turntable spin while the shop is open (rad/s). */
const SPIN = 0.42;

interface Card {
  def: CosmeticDef;
  btn: HTMLButtonElement;
  swatch: HTMLElement;
  act: HTMLElement;
}

/**
 * Paint Shop overlay: buy and equip cosmetics (paint / decal / trail) for the player's plow. Docks beside the main
 * menu's 3D backdrop: while open the camera swings in on the parked plow, which turns on a turntable and wears
 * whatever card is focused or hovered (try before you buy). Owns the keyboard while open, like SettingsMenu.
 */
export class StyleShop {
  private ctx: GameContext;
  private parent: HTMLElement;
  private root: HTMLElement;
  private panel: HTMLElement;
  private coinVal!: HTMLElement;
  private tabBtns = new Map<CosmeticSlot, { btn: HTMLButtonElement; badge: HTMLElement }>();
  private grids = new Map<CosmeticSlot, HTMLElement>();
  private cards: Card[] = [];
  private note!: HTMLElement;
  private slot: CosmeticSlot = 'paint';
  private _open = false;
  private returnFocus: HTMLElement | null = null;
  /** Card under the mouse (previewed over the focused one). */
  private hover: Card | null = null;
  // Showcase camera / turntable.
  private blend = 0;
  private yaw = 0;
  private lastT = 0;
  private showCam = new THREE.PerspectiveCamera();
  private tmpV = new THREE.Vector3();

  constructor(ctx: GameContext, parent: HTMLElement) {
    this.ctx = ctx;
    this.parent = parent;
    SHOW_DIR.normalize();
    this.root = el('div', 'ss-screen ss-style', undefined, parent);
    this.root.setAttribute('aria-hidden', 'true');
    this.panel = el('div', 'ss-panel ss-glass ss-icicles ss-style-panel', undefined, this.root);
    this.build();
    ctx.progression.onChange(() => this._open && this.refresh());
    // Capture phase on window: runs before Input / Game / UI key handlers so the overlay owns the keyboard.
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    // Camera + turntable run right before each render, on top of the menu camera rig's pose.
    const scene = ctx.scene;
    const prev = scene.onBeforeRender.bind(scene);
    scene.onBeforeRender = (...args: Parameters<THREE.Scene['onBeforeRender']>) => {
      prev(...args);
      this.beforeRender();
    };
  }

  get isOpen(): boolean {
    return this._open;
  }

  open(): void {
    if (this._open) return;
    this._open = true;
    this.ctx.audio?.play('click');
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.parent.classList.add('ss-style-open');
    this.hover = null;
    this.note.textContent = '';
    this.setSlot(this.slot, false);
    this.root.classList.add('show');
    this.root.setAttribute('aria-hidden', 'false');
    this.lastT = performance.now();
    setTimeout(() => this._open && this.focusEquipped(), 30);
  }

  close(): void {
    if (!this._open) return;
    this._open = false;
    this.root.classList.remove('show');
    this.root.setAttribute('aria-hidden', 'true');
    this.parent.classList.remove('ss-style-open');
    this.plow?.clearPreview();
    this.ctx.input.clear();
    const f = this.returnFocus;
    if (f && document.contains(f)) f.focus({ preventScroll: true });
  }

  private get plow(): Plow | null {
    return this.ctx.plow instanceof Plow ? this.ctx.plow : null;
  }

  private sfx(name: SoundName): void {
    this.ctx.audio?.play(name);
  }

  /* ------------------------------------------------------------------ build */

  private build(): void {
    const p = this.panel;
    const head = el('div', 'ss-style-head', undefined, p);
    el('h2', 'ss-h2', 'PAINT SHOP', head);
    const pill = el('div', 'ss-coinpill ss-style-coins', undefined, head);
    el('span', 'ss-coin', undefined, pill);
    this.coinVal = el('span', 'ss-coin-val', '0', pill);
    el('div', 'ss-sub ss-style-sub', 'Pure style: no stats, all swagger.', p);

    const tabs = el('div', 'ss-tabs ss-style-tabs', undefined, p);
    tabs.setAttribute('role', 'tablist');
    el('span', 'ss-tab-key', 'Q', tabs).title = 'Previous tab (Q / LB)';
    for (const slot of COSMETIC_SLOTS) {
      const t = TABS[slot];
      const btn = el('button', `ss-tab ss-style-tab-${slot}`, undefined, tabs);
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      el('span', 'ss-tab-icon', t.icon, btn);
      el('span', 'ss-tab-label', t.label, btn);
      const badge = el('span', 'ss-tab-badge', '', btn);
      badge.title = 'Items you can buy';
      btn.addEventListener('click', () => {
        if (this.slot !== slot) this.sfx('click');
        this.setSlot(slot);
      });
      this.tabBtns.set(slot, { btn, badge });
    }
    el('span', 'ss-tab-key', 'E', tabs).title = 'Next tab (E / RB)';
    this.note = el('div', 'ss-style-note', '', p);

    const body = el('div', 'ss-style-body', undefined, p);
    for (const slot of COSMETIC_SLOTS) {
      const grid = el('div', 'ss-style-grid', undefined, body);
      grid.setAttribute('role', 'tabpanel');
      this.grids.set(slot, grid);
      for (const def of cosmeticsInSlot(slot)) this.cards.push(this.buildCard(def, grid));
    }

    const foot = el('div', 'ss-panel-foot ss-style-foot', undefined, p);
    const back = el('button', 'ss-btn ss-ice', '◀ BACK', foot);
    back.type = 'button';
    back.addEventListener('click', () => {
      this.sfx('click');
      this.close();
    });
    el('div', 'ss-foot-hint ss-style-hint', 'Hover or focus to preview · Q / E tabs · Esc back', foot);
  }

  private buildCard(def: CosmeticDef, parent: HTMLElement): Card {
    const btn = el('button', `ss-style-card ss-style-${def.slot}`, undefined, parent);
    btn.type = 'button';
    btn.dataset.id = def.id;
    const swatch = el('div', 'ss-style-swatch', undefined, btn);
    const info = el('div', 'ss-style-info', undefined, btn);
    el('div', 'ss-style-name', def.name, info);
    el('div', 'ss-style-blurb', def.blurb, info);
    const act = el('div', 'ss-style-act', '', info);
    const card: Card = { def, btn, swatch, act };
    if (def.slot === 'decal') this.drawDecalSwatch(card);
    else if (def.slot === 'trail') this.drawTrailSwatch(card);
    btn.addEventListener('click', () => this.onPick(card));
    btn.addEventListener('focus', () => this.showPreview(card));
    btn.addEventListener('mouseenter', () => {
      this.hover = card;
      this.showPreview(card);
    });
    btn.addEventListener('mouseleave', () => {
      if (this.hover === card) this.hover = null;
      const f = this.cards.find((c) => c.btn === document.activeElement && c.def.slot === this.slot);
      this.showPreview(f ?? null);
    });
    return card;
  }

  private drawDecalSwatch(card: Card): void {
    const d = card.def;
    if (d.slot !== 'decal') return;
    if (!d.style) {
      card.swatch.classList.add('ss-style-none');
      card.swatch.textContent = '∅';
      return;
    }
    const c = el('canvas', 'ss-style-canvas', undefined, card.swatch);
    const emblem = d.style === 'snowflake' || d.style === 'skull';
    c.width = emblem ? 88 : 128;
    c.height = emblem ? 88 : 80;
    const g = c.getContext('2d');
    if (!g) return;
    if (d.style === 'checker') {
      // A band of the tile across the middle.
      g.translate(0, c.height * 0.3);
      for (let x = 0; x < c.width; x += 64) {
        g.save();
        g.translate(x, 0);
        drawDecal(g, d.style, 64, c.height * 0.4);
        g.restore();
      }
    } else {
      drawDecal(g, d.style, c.width, c.height);
    }
  }

  private drawTrailSwatch(card: Card): void {
    const d = card.def;
    if (d.slot !== 'trail') return;
    if (!d.style) {
      card.swatch.classList.add('ss-style-none');
      card.swatch.textContent = '∅';
      return;
    }
    card.swatch.classList.add(`ss-style-trail-${d.style}`);
    // A row of puffs fading out behind a little plow.
    const n = 7;
    for (let i = 0; i < n; i++) {
      const dot = el('span', 'ss-style-puff', undefined, card.swatch);
      const col = d.style === 'rainbow' ? `hsl(${(i / n) * 300}, 90%, 60%)` : css(d.colors[i % d.colors.length]);
      dot.style.setProperty('--c', col);
      dot.style.setProperty('--i', String(i));
    }
    el('span', 'ss-style-mini', '🚜', card.swatch);
  }

  /* ------------------------------------------------------------------ state */

  private setSlot(slot: CosmeticSlot, focus = true): void {
    const changed = slot !== this.slot;
    this.slot = slot;
    for (const [s, t] of this.tabBtns) {
      t.btn.classList.toggle('on', s === slot);
      t.btn.setAttribute('aria-selected', s === slot ? 'true' : 'false');
    }
    for (const [s, g] of this.grids) g.classList.toggle('hidden', s !== slot);
    if (changed) {
      this.hover = null;
      this.plow?.clearPreview();
      this.note.textContent = '';
    }
    this.refresh();
    if (focus && changed && this._open) this.focusEquipped();
  }

  private cycle(dir: number): void {
    const i = COSMETIC_SLOTS.indexOf(this.slot);
    this.setSlot(COSMETIC_SLOTS[(i + dir + COSMETIC_SLOTS.length) % COSMETIC_SLOTS.length]);
    this.sfx('click');
  }

  private focusEquipped(): void {
    const eq = cosmeticsState(this.ctx.progression).equipped[this.slot];
    const card = this.cards.find((c) => c.def.id === eq) ?? this.cards.find((c) => c.def.slot === this.slot);
    card?.btn.focus({ preventScroll: true });
    card?.btn.scrollIntoView({ block: 'nearest' });
  }

  private refresh(): void {
    const p = this.ctx.progression;
    this.coinVal.textContent = fmt(p.coins);
    const eq = cosmeticsState(p).equipped;
    const look = equippedLook(p);
    const factory = FACTORY_PAINT[p.plow];
    const buyable = new Map<CosmeticSlot, number>();
    for (const c of this.cards) {
      const d = c.def;
      const owned = isOwned(p, d.id);
      const equipped = eq[d.slot] === d.id;
      const lock = owned ? null : lockLabel(p, d);
      const check = buyCheck(p, d.id);
      if (check === 'ok') buyable.set(d.slot, (buyable.get(d.slot) ?? 0) + 1);
      c.btn.classList.toggle('equipped', equipped);
      c.btn.classList.toggle('owned', owned && !equipped);
      c.btn.classList.toggle('locked', !!lock);
      c.btn.classList.toggle('poor', check === 'poor');
      c.btn.classList.toggle('afford', check === 'ok');
      c.act.innerHTML = equipped
        ? '✓ EQUIPPED'
        : owned
          ? 'EQUIP'
          : lock
            ? `🔒 ${lock}`
            : `<span class="ss-coin sm"></span>${fmt(d.price)}`;
      if (d.slot === 'paint') {
        // Paint chips show the colours on your current plow (stock = its factory colours).
        const body = css(d.body ?? factory.body);
        const trim = css(d.trim ?? factory.trim);
        c.swatch.style.setProperty('--body', body);
        c.swatch.style.setProperty('--trim', trim);
        c.swatch.classList.toggle('ss-style-metal', (d.metalness ?? 0) >= 0.25);
      } else if (d.slot === 'decal') {
        // Decals sit on your current paint.
        c.swatch.style.setProperty('--body', css(look.paint.body ?? factory.body));
      }
    }
    for (const [s, t] of this.tabBtns) {
      const n = buyable.get(s) ?? 0;
      t.badge.textContent = n ? String(n) : '';
    }
  }

  /** Try a card on the backdrop plow and explain its state in the note line (null = back to the equipped look). */
  private showPreview(card: Card | null): void {
    const c = this.hover ?? card;
    this.plow?.previewCosmetic(this.slot, c && c.def.slot === this.slot ? c.def.id : null);
    if (!c) return;
    const p = this.ctx.progression;
    const d = c.def;
    const check = buyCheck(p, d.id);
    const eq = cosmeticsState(p).equipped[d.slot] === d.id;
    this.note.classList.remove('bad', 'good');
    if (eq) this.note.textContent = `${d.name} is on your plow.`;
    else if (check === 'owned') this.note.textContent = `Previewing ${d.name}. Press to equip.`;
    else if (check === 'locked') {
      this.note.textContent = `🔒 ${lockHint(d)}`;
      this.note.classList.add('bad');
    } else if (check === 'poor') this.note.textContent = `Previewing ${d.name}. Need ${fmt(d.price - p.coins)} more coins.`;
    else this.note.textContent = `Previewing ${d.name}. Press to buy for ${fmt(d.price)}.`;
  }

  private onPick(card: Card): void {
    const p = this.ctx.progression;
    const d = card.def;
    const check = buyCheck(p, d.id);
    this.note.classList.remove('bad', 'good');
    if (check === 'owned') {
      if (cosmeticsState(p).equipped[d.slot] !== d.id) {
        equipCosmetic(p, d.id);
        this.sfx('click');
        restart(card.btn, 'bought');
        this.note.textContent = `${d.name} equipped.`;
        this.note.classList.add('good');
      } else {
        this.sfx('click');
      }
      return;
    }
    if (check === 'ok' && buyCosmetic(p, d.id)) {
      this.sfx('buy');
      restart(card.btn, 'bought');
      this.note.textContent = `${d.name} unlocked and equipped!`;
      this.note.classList.add('good');
      return;
    }
    this.sfx('error');
    restart(card.btn, 'shake');
    this.note.textContent = check === 'locked' ? `🔒 ${lockHint(d)}` : `Need ${fmt(d.price - p.coins)} more coins.`;
    this.note.classList.add('bad');
  }

  /* ------------------------------------------------------------------ backdrop camera + turntable */

  private beforeRender(): void {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - this.lastT) / 1000));
    this.lastT = now;
    const target = this._open ? 1 : 0;
    if (this.blend === 0 && target === 0) return;
    this.blend += (target - this.blend) * (1 - Math.exp(-(this._open ? 5 : 7) * dt));
    if (Math.abs(target - this.blend) < 0.002) this.blend = target;
    const plow = this.plow;
    if (!plow) return;
    // Turntable: spin while open; on close, unwind the short way back to the parked heading as the camera leaves.
    if (this._open) {
      this.yaw += dt * SPIN;
    } else {
      this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw)) * Math.min(1, this.blend * 1.2);
    }
    if (this.blend > 0) plow.showcase(this.yaw, dt, this._open);
    else {
      this.yaw = 0;
      plow.endShowcase();
    }
    const cam = this.ctx.camera as THREE.PerspectiveCamera;
    if (!cam.isPerspectiveCamera) return;
    this.showcasePose(cam, plow.position);
    // Blend the rig's menu pose (already on the camera) toward the showcase pose.
    const e = this.blend * this.blend * (3 - 2 * this.blend);
    cam.position.lerp(this.showCam.position, e);
    cam.quaternion.slerp(this.showCam.quaternion, e);
    cam.updateMatrixWorld();
  }

  /** Showcase camera pose: frame the plow inside the screen area the panel leaves free (right of it on wide screens,
   *  above it when the panel docks to the bottom). */
  private showcasePose(cam: THREE.PerspectiveCamera, at: THREE.Vector3): void {
    const W = window.innerWidth || 1;
    const H = window.innerHeight || 1;
    const r = this.panel.getBoundingClientRect();
    let fx0 = 0, fx1 = W, fy0 = 0, fy1 = H;
    if (r.width > 0 && r.width < W * 0.75) fx0 = Math.min(W * 0.8, r.right);
    else if (r.height > 0) fy1 = Math.max(H * 0.2, r.top);
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const tanH = tanV * cam.aspect;
    const fw = (fx1 - fx0) / W;
    const fh = (fy1 - fy0) / H;
    const d = THREE.MathUtils.clamp(Math.max(SHOW_FRAME_W / (2 * tanH * fw), SHOW_FRAME_H / (2 * tanV * fh)), SHOW_MIN_D, SHOW_MAX_D);
    const look = this.tmpV.set(at.x, at.y + 1.3, at.z);
    const sc = this.showCam;
    sc.position.copy(look).addScaledVector(SHOW_DIR, d);
    sc.lookAt(look);
    // Shift the plow off-centre into the free area: yaw / pitch the camera by the angle to that screen point.
    const cx = ((fx0 + fx1) / 2 / W) * 2 - 1;
    const cy = 1 - ((fy0 + fy1) / 2 / H) * 2;
    sc.rotateY(Math.atan(cx * tanH));
    sc.rotateX(-Math.atan(cy * tanV));
  }

  /* ------------------------------------------------------------------ keyboard */

  private onKey(e: KeyboardEvent): void {
    if (!this._open) return;
    e.stopImmediatePropagation();
    const code = e.code;
    if (code === 'Escape') {
      e.preventDefault();
      this.sfx('click');
      return this.close();
    }
    if (code === 'KeyQ' || code === 'KeyE' || code === 'PageUp' || code === 'PageDown') {
      e.preventDefault();
      if (!e.repeat) this.cycle(code === 'KeyQ' || code === 'PageUp' ? -1 : 1);
      return;
    }
    const a = document.activeElement as HTMLElement | null;
    if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
      e.preventDefault();
      if (e.repeat) return;
      if (a instanceof HTMLButtonElement && this.panel.contains(a)) a.click();
      else this.focusEquipped();
      return;
    }
    if (code === 'Tab') {
      e.preventDefault();
      return this.step(e.shiftKey ? -1 : 1);
    }
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const dir = dirs[code];
    if (!dir) return;
    e.preventDefault();
    this.move(dir[0], dir[1]);
  }

  private focusables(): HTMLButtonElement[] {
    return Array.from(this.panel.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.offsetParent !== null && !b.disabled);
  }

  private focus(b: HTMLButtonElement): void {
    b.focus();
    b.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  private step(dir: number): void {
    const items = this.focusables();
    if (!items.length) return;
    let i = items.indexOf(document.activeElement as HTMLButtonElement);
    i = i < 0 ? (dir > 0 ? 0 : items.length - 1) : (i + dir + items.length) % items.length;
    this.focus(items[i]);
  }

  /** Arrow / d-pad: jump to the nearest button in that direction (tabs, the card grid, BACK). */
  private move(dx: number, dy: number): void {
    const items = this.focusables();
    const cur = document.activeElement as HTMLButtonElement;
    if (!items.includes(cur)) return this.focusEquipped();
    const r = cur.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let best: HTMLButtonElement | null = null;
    let bestScore = Infinity;
    for (const b of items) {
      if (b === cur) continue;
      const q = b.getBoundingClientRect();
      const ox = q.left + q.width / 2 - cx;
      const oy = q.top + q.height / 2 - cy;
      const along = dx ? ox * dx : oy * dy;
      if (along <= 4) continue;
      const across = dx ? Math.abs(oy) : Math.abs(ox);
      // Same row / column first, then nearest.
      if (dx && across > Math.max(r.height, q.height) * 0.6) continue;
      const score = along + across * 3;
      if (score < bestScore) {
        bestScore = score;
        best = b;
      }
    }
    if (best) this.focus(best);
    else if (dx) this.step(dx); // end of a row: wrap to the next / previous button
  }
}
