import './settings.css';
import type { GameContext } from '../core/types';
import { ACTIONS, DEFAULT_KEYS, RESERVED_KEYS, keyLabel, type Action } from '../core/input';
import { applyAudio, applyBindings, applyQuality, saveSettings, settings, settingsUi, type Quality } from '../core/settings';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

export interface SettingsHooks {
  /** Wipe progress (Game refreshes stats). */
  onResetSave(): void;
  /** Save was replaced (reset / import) — refresh anything showing save state (mute buttons, coins). */
  onSaveChanged(): void;
  /** Overlay closed — key bindings may have changed, so on-screen key prompts should re-read them. */
  onClose?(): void;
}

const PAD_HELP = 'Left stick / d-pad drive & steer · RT/LT throttle · A slam · B / RB dash · X whirlwind · Y F-ability (Inferno / Thunderclap / Ground Pound) · START pause · menus: d-pad + A, B = back';

/**
 * Settings overlay (volume, screen shake, graphics quality + bloom, key rebinding, save export/import/reset).
 * Lives on top of whatever screen opened it (main menu or pause) and owns the keyboard while open.
 */
export class SettingsMenu {
  private ctx: GameContext;
  private hooks: SettingsHooks;
  private root: HTMLElement;
  private panel: HTMLElement;
  private keyBtns = new Map<Action, HTMLButtonElement>();
  private qualityBtns = new Map<Quality, HTMLButtonElement>();
  private bloomBtns = new Map<boolean, HTMLButtonElement>();
  private sliders: { input: HTMLInputElement; val: HTMLElement; get: () => number }[] = [];
  private padStatus!: HTMLElement;
  private keyMsg!: HTMLElement;
  private saveMsg!: HTMLElement;
  private saveBox!: HTMLTextAreaElement;
  private resetBtn!: HTMLButtonElement;
  private resetArmed = 0;
  private rebinding: Action | null = null;
  private returnFocus: HTMLElement | null = null;
  private padTimer: number | null = null;

  constructor(ctx: GameContext, parent: HTMLElement, hooks: SettingsHooks) {
    this.ctx = ctx;
    this.hooks = hooks;
    this.root = el('div', 'ss-screen ss-center ss-dim ss-settings', undefined, parent);
    this.root.setAttribute('aria-hidden', 'true');
    this.panel = el('div', 'ss-panel ss-glass ss-set-panel ss-icicles', undefined, this.root);
    this.build();
    // Capture phase on window: runs before Input / Game / UI key handlers so the overlay owns the keyboard.
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  get isOpen(): boolean {
    return settingsUi.open;
  }

  open(): void {
    if (settingsUi.open) return;
    settingsUi.open = true;
    this.returnFocus = document.activeElement as HTMLElement | null;
    this.refresh();
    this.saveMsg.textContent = '';
    this.keyMsg.textContent = '';
    this.root.classList.add('show');
    this.root.setAttribute('aria-hidden', 'false');
    this.panel.scrollTop = 0;
    setTimeout(() => this.panel.querySelector<HTMLElement>('[data-primary]')?.focus({ preventScroll: true }), 30);
    this.updatePad();
    this.padTimer = window.setInterval(() => this.updatePad(), 500);
  }

  close(): void {
    if (!settingsUi.open) return;
    settingsUi.open = false;
    this.cancelRebind();
    this.root.classList.remove('show');
    this.root.setAttribute('aria-hidden', 'true');
    if (this.padTimer !== null) window.clearInterval(this.padTimer);
    this.padTimer = null;
    this.ctx.input.clear();
    const f = this.returnFocus;
    if (f && document.contains(f)) f.focus({ preventScroll: true });
    this.hooks.onClose?.();
  }

  /* ------------------------------------------------------------------ build */

  private btn(label: string, cls: string, onClick: () => void, parent: HTMLElement): HTMLButtonElement {
    const b = el('button', `ss-btn ${cls}`, undefined, parent);
    b.type = 'button';
    b.innerHTML = label;
    b.addEventListener('click', () => {
      this.ctx.audio?.play('click');
      onClick();
    });
    return b;
  }

  private section(title: string): HTMLElement {
    const sec = el('section', 'ss-set-sec', undefined, this.panel);
    el('h3', 'ss-h3', title, sec);
    return sec;
  }

  private slider(parent: HTMLElement, label: string, get: () => number, set: (v: number) => void): void {
    const row = el('label', 'ss-set-row', undefined, parent);
    el('span', 'ss-set-label', label, row);
    const input = el('input', 'ss-set-range', undefined, row);
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.step = '5';
    const val = el('span', 'ss-set-val', '', row);
    input.addEventListener('input', () => {
      set(Number(input.value) / 100);
      val.textContent = `${input.value}%`;
      saveSettings();
    });
    this.sliders.push({ input, val, get });
  }

  private build(): void {
    const p = this.panel;
    el('h2', 'ss-h2', 'SETTINGS', p);
    el('div', 'ss-sub', 'Saved on this device, separately from your progress.', p);

    const snd = this.section('🔊 Sound');
    const audio = () => applyAudio(this.ctx);
    this.slider(snd, 'Master', () => settings.master, (v) => ((settings.master = v), audio()));
    this.slider(snd, 'Music', () => settings.music, (v) => ((settings.music = v), audio()));
    this.slider(snd, 'Effects', () => settings.sfx, (v) => ((settings.sfx = v), audio()));

    const vid = this.section('🎥 Camera & graphics');
    this.slider(vid, 'Screen shake', () => settings.shake, (v) => (settings.shake = v));
    const qRow = el('div', 'ss-set-row', undefined, vid);
    el('span', 'ss-set-label', 'Quality', qRow);
    const seg = el('div', 'ss-set-seg', undefined, qRow);
    for (const [q, label] of [['low', 'LOW · fast'], ['high', 'HIGH · shadows']] as [Quality, string][]) {
      this.qualityBtns.set(q, this.btn(label, 'ss-ice ss-small', () => {
        settings.quality = q;
        applyQuality(this.ctx);
        saveSettings();
        this.refresh();
      }, seg));
    }
    const bRow = el('div', 'ss-set-row', undefined, vid);
    el('span', 'ss-set-label', 'Bloom', bRow);
    const bSeg = el('div', 'ss-set-seg', undefined, bRow);
    for (const [on, label] of [[false, 'OFF'], [true, 'ON · HIGH only']] as [boolean, string][]) {
      this.bloomBtns.set(on, this.btn(label, 'ss-ice ss-small', () => {
        settings.bloom = on;
        applyQuality(this.ctx);
        saveSettings();
        this.refresh();
      }, bSeg));
    }

    const ctl = this.section('🎮 Controls');
    el('div', 'ss-set-note', 'Click a key, then press the new one. Arrow keys, right Shift and Esc keep working as alternates.', ctl);
    const grid = el('div', 'ss-set-keys', undefined, ctl);
    for (const a of ACTIONS) {
      const row = el('div', 'ss-set-keyrow', undefined, grid);
      el('span', 'ss-set-label', a.label, row);
      const b = this.btn('', 'ss-ice ss-small ss-set-key', () => this.startRebind(a.id), row);
      this.keyBtns.set(a.id, b);
    }
    const kRow = el('div', 'ss-set-actions', undefined, ctl);
    this.btn('↺ DEFAULT KEYS', 'ss-ice ss-small', () => {
      settings.keys = {};
      applyBindings(this.ctx);
      saveSettings();
      this.keyMsg.textContent = 'Keys reset to defaults.';
      this.refresh();
    }, kRow);
    this.keyMsg = el('span', 'ss-set-msg', '', kRow);
    this.padStatus = el('div', 'ss-set-pad', '', ctl);
    el('div', 'ss-set-note', PAD_HELP, ctl);

    const sav = this.section('💾 Save data');
    const sRow = el('div', 'ss-set-actions', undefined, sav);
    this.btn('📤 EXPORT', 'ss-ice ss-small', () => this.exportSave(), sRow);
    this.btn('📥 IMPORT', 'ss-ice ss-small', () => this.importSave(), sRow);
    this.resetBtn = this.btn('🗑 RESET PROGRESS', 'ss-ice ss-small ss-danger', () => this.onReset(), sRow);
    this.saveBox = el('textarea', 'ss-set-code', undefined, sav);
    this.saveBox.rows = 3;
    this.saveBox.spellcheck = false;
    this.saveBox.placeholder = 'Export puts your save code here (and on the clipboard). To import, paste a code here and press IMPORT.';
    this.saveMsg = el('div', 'ss-set-msg', '', sav);

    const foot = el('div', 'ss-panel-foot', undefined, p);
    this.btn('✔ DONE', 'ss-primary', () => this.close(), foot).dataset.primary = '1';
  }

  private refresh(): void {
    for (const s of this.sliders) {
      const v = Math.round(s.get() * 100);
      s.input.value = String(v);
      s.val.textContent = `${v}%`;
    }
    for (const [q, b] of this.qualityBtns) b.classList.toggle('ss-set-on', settings.quality === q);
    for (const [on, b] of this.bloomBtns) b.classList.toggle('ss-set-on', settings.bloom === on);
    for (const a of ACTIONS) {
      const b = this.keyBtns.get(a.id)!;
      const keys = this.ctx.input.keysFor(a.id);
      b.textContent = keys.length ? keys.map(keyLabel).join(' / ') : '—';
      b.classList.toggle('ss-set-custom', !!settings.keys[a.id]);
      b.classList.remove('ss-set-listen');
    }
  }

  private updatePad(): void {
    const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter((g) => g && g.connected) : [];
    this.padStatus.textContent = pads.length
      ? `🎮 Gamepad connected: ${pads[0]!.id.replace(/\s*\(.*$/, '')}`
      : '🎮 No gamepad detected. Plug one in and press any button.';
    this.padStatus.classList.toggle('on', pads.length > 0);
  }

  /* ------------------------------------------------------------------ key rebinding */

  private startRebind(a: Action): void {
    this.cancelRebind();
    this.rebinding = a;
    const b = this.keyBtns.get(a)!;
    b.textContent = 'PRESS A KEY…';
    b.classList.add('ss-set-listen');
    this.keyMsg.textContent = 'Esc cancels.';
  }

  private cancelRebind(): void {
    if (!this.rebinding) return;
    this.rebinding = null;
    this.refresh();
  }

  private bind(a: Action, code: string): void {
    const primaryOf = (x: Action) => settings.keys[x] ?? DEFAULT_KEYS[x][0];
    const old = primaryOf(a);
    // Swap with whichever action held this key, so no action is ever left unbound.
    for (const o of ACTIONS) {
      if (o.id !== a && primaryOf(o.id) === code) {
        settings.keys[o.id] = old;
        this.keyMsg.textContent = `Swapped: ${o.label} is now ${keyLabel(old)}.`;
      }
    }
    settings.keys[a] = code;
    // Drop overrides that equal the default to keep the stored map minimal.
    for (const o of ACTIONS) if (settings.keys[o.id] === DEFAULT_KEYS[o.id][0]) delete settings.keys[o.id];
    applyBindings(this.ctx);
    saveSettings();
    this.rebinding = null;
    this.refresh();
    this.keyBtns.get(a)!.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ save data */

  private exportSave(): void {
    const code = this.ctx.progression.exportSave();
    this.saveBox.value = code;
    this.saveBox.select();
    const done = (ok: boolean) => (this.saveMsg.textContent = ok ? '✔ Save code copied to clipboard.' : 'Save code is in the box: copy it somewhere safe.');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code).then(() => done(true), () => done(false));
    else done(false);
  }

  private importSave(): void {
    const res = this.ctx.progression.importSave(this.saveBox.value);
    if (!res.ok) {
      this.saveMsg.textContent = `✖ ${res.error}`;
      this.ctx.audio?.play('error');
      return;
    }
    this.afterSaveReplaced();
    this.saveMsg.textContent = `✔ Save loaded: ${Math.floor(this.ctx.progression.coins).toLocaleString('en-US')} coins.`;
    this.ctx.audio?.play('buy');
  }

  private onReset(): void {
    const now = performance.now();
    if (now - this.resetArmed < 3000) {
      this.resetArmed = 0;
      this.resetBtn.innerHTML = '🗑 RESET PROGRESS';
      this.resetBtn.classList.remove('armed');
      this.hooks.onResetSave();
      this.afterSaveReplaced();
      this.saveMsg.textContent = 'Progress wiped. Fresh plow, fresh snow.';
      return;
    }
    this.resetArmed = now;
    this.resetBtn.innerHTML = '⚠ CLICK AGAIN TO WIPE';
    this.resetBtn.classList.add('armed');
    this.saveMsg.textContent = 'This deletes coins, upgrades and unlocked arenas. Export first if unsure.';
    setTimeout(() => {
      if (this.resetArmed === now) {
        this.resetArmed = 0;
        this.resetBtn.innerHTML = '🗑 RESET PROGRESS';
        this.resetBtn.classList.remove('armed');
      }
    }, 3000);
  }

  private afterSaveReplaced(): void {
    const { ctx } = this;
    ctx.stats = ctx.progression.computeStats();
    ctx.plow.applyStats(ctx.stats);
    ctx.audio.muted = ctx.progression.data.muted;
    this.hooks.onSaveChanged();
  }

  /* ------------------------------------------------------------------ keyboard */

  private onKey(e: KeyboardEvent): void {
    if (!settingsUi.open) return;
    e.stopImmediatePropagation();
    const code = e.code;
    if (this.rebinding) {
      e.preventDefault();
      if (code === 'Escape') return this.cancelRebind();
      if (!code || RESERVED_KEYS.has(code)) {
        this.keyMsg.textContent = `${keyLabel(code || '?')} is reserved.`;
        return;
      }
      return this.bind(this.rebinding, code);
    }
    if (code === 'Escape') {
      e.preventDefault();
      return this.close();
    }
    const a = document.activeElement as HTMLElement | null;
    if (a instanceof HTMLTextAreaElement) return; // typing / pasting a save code
    if (a instanceof HTMLInputElement && a.type === 'range' && (code === 'ArrowLeft' || code === 'ArrowRight')) {
      e.preventDefault();
      a.value = String(Math.min(100, Math.max(0, Number(a.value) + (code === 'ArrowRight' ? 5 : -5))));
      a.dispatchEvent(new Event('input'));
      return;
    }
    if (code === 'Enter' || code === 'NumpadEnter') {
      if (a instanceof HTMLButtonElement && this.panel.contains(a)) {
        e.preventDefault();
        if (!e.repeat) a.click();
      }
      return;
    }
    const nav: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, Tab: e.shiftKey ? -1 : 1 };
    const dir = nav[code];
    if (!dir) return;
    e.preventDefault();
    const items = Array.from(this.panel.querySelectorAll<HTMLElement>('button, input, textarea')).filter((x) => x.offsetParent !== null);
    if (!items.length) return;
    let i = items.indexOf(a as HTMLElement);
    i = i < 0 ? (dir > 0 ? 0 : items.length - 1) : (i + dir + items.length) % items.length;
    items[i].focus();
    items[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}
