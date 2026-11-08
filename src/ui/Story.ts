import './story.css';
import type { GameContext } from '../core/types';
import { PLOWS, type PlowKind } from '../config/plows';
import { ZONES } from '../config/zones';
import { ENEMIES, type EnemyType } from '../config/enemies';
import { life, lifeBoss } from '../config/achievements';
import { BOSS_LORE, BOSS_ORDER, CHAPTERS, EPILOGUE, HARD_CHAPTERS, HARD_EPILOGUE, HARD_PROLOGUE, PLOW_LORE, PROLOGUE, WORLD_NAME } from '../config/lore';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

type TabId = 'story' | 'hard' | 'bosses' | 'plows';
const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'story', label: 'Campaign', icon: '📜' },
  { id: 'hard', label: 'Hard Mode', icon: '☠️' },
  { id: 'bosses', label: 'Bosses', icon: '💀' },
  { id: 'plows', label: 'Plows', icon: '🚜' },
];

const PLOW_ICON: Record<PlowKind, string> = { classic: '🚜', volt: '⚡', brute: '🦏', isotope: '☢️', arsenal: '🧲' };

/**
 * Story overlay (main menu, and "Read the story" on the results screen): the campaign told chapter by chapter, boss
 * profiles and plow bios (config/lore.ts). Spoiler-safe: a chapter's opening shows once its arena is open, its ending
 * once the arena is cleared, the epilogue after the final arena; a boss profile shows once its arena is open and its
 * fate once it has been beaten. Keyboard like Trophies: arrows scroll, Q / E switch tabs, Escape closes.
 */
export class Story {
  private ctx: GameContext;
  private root: HTMLElement;
  private panel: HTMLElement;
  private body!: HTMLElement;
  private panes = new Map<TabId, HTMLElement>();
  private tabBtns = new Map<TabId, HTMLButtonElement>();
  private tab: TabId = 'story';
  private shown = false;
  private returnFocus: HTMLElement | null = null;

  constructor(ctx: GameContext, parent: HTMLElement) {
    this.ctx = ctx;
    this.root = el('div', 'ss-screen ss-center ss-dim ss-trophies ss-story', undefined, parent);
    this.root.setAttribute('aria-hidden', 'true');
    this.panel = el('div', 'ss-panel ss-glass ss-icicles ss-tro-panel', undefined, this.root);
    this.build();
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  get isOpen(): boolean {
    return this.shown;
  }

  /** Open on a tab; `chapter` (an arena save id) scrolls the Campaign (or, with tab 'hard', the Hard Mode) tab to it. */
  open(tab: TabId = this.tab, chapter?: string): void {
    this.returnFocus = this.shown ? this.returnFocus : (document.activeElement as HTMLElement | null);
    this.shown = true;
    this.render();
    this.setTab(chapter && tab !== 'hard' ? 'story' : tab);
    this.body.scrollTop = 0;
    this.root.classList.add('show');
    this.root.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      if (!this.shown) return;
      const target = chapter ? this.panel.querySelector<HTMLElement>(`[data-nav="${tab === 'hard' ? 'hard' : 'ch'}-${chapter}"]`) : null;
      if (target) {
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: 'start' });
      } else this.tabBtns.get(this.tab)?.focus({ preventScroll: true });
    }, 30);
  }

  close(): void {
    if (!this.shown) return;
    this.shown = false;
    this.root.classList.remove('show');
    this.root.setAttribute('aria-hidden', 'true');
    this.ctx.input.clear();
    const f = this.returnFocus;
    if (f && document.contains(f)) f.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ build */

  private build(): void {
    const p = this.panel;
    el('h2', 'ss-h2', 'STORY', p);
    el('div', 'ss-sub ss-story-sub', `The tale of ${WORLD_NAME} and its plows. New chapters unlock as you clear arenas.`, p);
    const tabs = el('div', 'ss-tabs ss-tro-tabs', undefined, p);
    tabs.setAttribute('role', 'tablist');
    el('span', 'ss-tab-key', 'Q', tabs).title = 'Previous tab (Q / LB)';
    for (const t of TABS) {
      const b = el('button', 'ss-tab', undefined, tabs);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.nav = `tab-${t.id}`;
      el('span', 'ss-tab-icon', t.icon, b);
      el('span', 'ss-tab-label', t.label, b);
      b.addEventListener('click', () => {
        if (this.tab !== t.id) this.ctx.audio?.play('click');
        this.setTab(t.id);
      });
      this.tabBtns.set(t.id, b);
    }
    el('span', 'ss-tab-key', 'E', tabs).title = 'Next tab (E / RB)';
    this.body = el('div', 'ss-tro-body ss-story-body', undefined, p);
    for (const t of TABS) {
      const pane = el('div', `ss-tab-pane ss-story-pane-${t.id}`, undefined, this.body);
      pane.setAttribute('role', 'tabpanel');
      this.panes.set(t.id, pane);
    }
    const foot = el('div', 'ss-panel-foot ss-tro-foot', undefined, p);
    el('div', 'ss-foot-hint', 'Q / E switch tabs · Esc closes', foot);
    const done = el('button', 'ss-btn ss-primary', undefined, foot);
    done.type = 'button';
    done.textContent = '✔ DONE';
    done.dataset.primary = '1';
    done.dataset.nav = 'done';
    done.addEventListener('click', () => {
      this.ctx.audio?.play('click');
      this.close();
    });
  }

  private setTab(id: TabId): void {
    const changed = id !== this.tab;
    this.tab = id;
    for (const [tid, b] of this.tabBtns) {
      b.classList.toggle('on', tid === id);
      b.setAttribute('aria-selected', tid === id ? 'true' : 'false');
    }
    for (const [tid, pane] of this.panes) pane.classList.toggle('hidden', tid !== id);
    if (changed) this.body.scrollTop = 0;
  }

  /** A readable card (focusable for keyboard scrolling). */
  private card(parent: HTMLElement, nav: string, cls: string, icon: string, title: string, kicker?: string): HTMLElement {
    const c = el('div', `ss-story-card ${cls}`, undefined, parent);
    c.tabIndex = -1;
    c.dataset.nav = nav;
    const head = el('div', 'ss-story-head', undefined, c);
    el('div', 'ss-story-icon', icon, head);
    const t = el('div', 'ss-story-titles', undefined, head);
    if (kicker) el('div', 'ss-story-kicker', kicker, t);
    el('div', 'ss-story-title', title, t);
    return c;
  }

  private para(parent: HTMLElement, text: string, cls = ''): void {
    el('p', `ss-story-text ${cls}`, text, parent);
  }

  private render(): void {
    const prog = this.ctx.progression;
    const cleared = (id: string) => prog.zoneRecord(id).cleared;
    const zoneIdx = (id: string) => ZONES.findIndex((z) => z.id === id);
    const open = (id: string) => prog.isZoneUnlocked(zoneIdx(id));

    // ---- Campaign: prologue, one chapter per arena, epilogue.
    const sp = this.panes.get('story')!;
    sp.textContent = '';
    const pro = this.card(sp, 'ch-prologue', 'open', '❄️', 'Prologue', WORLD_NAME);
    this.para(pro, PROLOGUE);
    ZONES.forEach((z, i) => {
      const ch = CHAPTERS[z.id];
      if (!ch) return;
      const isOpen = open(z.id);
      const done = cleared(z.id);
      const c = this.card(sp, `ch-${z.id}`, `${isOpen ? 'open' : 'locked'} ${done ? 'done' : ''}`, isOpen ? String(i + 1) : '🔒', isOpen ? z.name : '???', `Chapter ${i + 1}`);
      if (!isOpen) return this.para(c, 'Clear the previous arena to unlock this chapter.', 'dim');
      this.para(c, ch.intro);
      if (done) {
        el('div', 'ss-story-rule', 'AFTER THE BATTLE', c);
        this.para(c, ch.outro);
      } else this.para(c, `Beat ${z.bossName} to find out what happens next.`, 'dim');
    });
    const last = ZONES[ZONES.length - 1];
    const fin = cleared(last.id);
    const epi = this.card(sp, 'ch-epilogue', fin ? 'open done' : 'locked', fin ? '🌨️' : '🔒', fin ? 'Snow Day' : '???', 'Epilogue');
    this.para(epi, fin ? EPILOGUE : `Beat ${last.bossName} to read the ending.`, fin ? '' : 'dim');

    // ---- Hard mode: PROTOCOL B (after MEGAPLOW Ω is beaten; a chapter's ending once its arena's Hard mode is beaten).
    const hp = this.panes.get('hard')!;
    hp.textContent = '';
    hp.classList.add('ss-story-pane-story');
    const hardDone = (id: string) => prog.data.hardCleared?.[id] === true;
    if (!fin) {
      const c = this.card(hp, 'hard-locked', 'locked', '🔒', '???', 'Hard Mode');
      this.para(c, `Beat ${last.bossName} to unlock the Hard-mode story. (Each arena's Hard mode opens once you clear it.)`, 'dim');
    } else {
      const hpro = this.card(hp, 'hard-prologue', 'open', '⏳', 'Protocol B', 'Hard Mode');
      this.para(hpro, HARD_PROLOGUE);
      ZONES.forEach((z) => {
        const ch = HARD_CHAPTERS[z.id];
        if (!ch) return;
        const done = hardDone(z.id);
        const c = this.card(hp, `hard-${z.id}`, `open ${done ? 'done' : ''}`, done ? '✔' : '☠️', `${z.name}`, 'Hard Mode cache');
        this.para(c, ch.intro);
        if (done) {
          el('div', 'ss-story-rule', 'CACHE DESTROYED', c);
          this.para(c, ch.outro);
        } else this.para(c, `Beat ${z.name} on Hard to destroy this cache.`, 'dim');
      });
      const all = ZONES.every((z) => hardDone(z.id));
      const he = this.card(hp, 'hard-epilogue', all ? 'open done' : 'locked', all ? '🌋' : '🔒', all ? 'Nothing After' : '???', 'Hard Mode epilogue');
      this.para(he, all ? HARD_EPILOGUE : 'Destroy all six caches (every arena on Hard) to read the ending.', all ? '' : 'dim');
    }

    // ---- Bosses.
    const bp = this.panes.get('bosses')!;
    bp.textContent = '';
    const grid = el('div', 'ss-story-grid', undefined, bp);
    for (const { type, zone } of BOSS_ORDER) {
      const lore = BOSS_LORE[type];
      const def = ENEMIES[type as EnemyType];
      if (!lore || !def) continue;
      const isOpen = open(zone);
      const beaten = cleared(zone) || life(prog, lifeBoss(type)) > 0;
      const c = this.card(grid, `boss-${type}`, `${isOpen ? 'open' : 'locked'} ${beaten ? 'done' : ''}`, isOpen ? '💀' : '🔒', isOpen ? def.name : '???', isOpen ? def.title : 'Unknown machine');
      if (!isOpen) {
        this.para(c, 'Reach its arena to learn more.', 'dim');
        continue;
      }
      this.para(c, lore.bio);
      if (beaten) {
        el('div', 'ss-story-rule', 'WHERE IT IS NOW', c);
        this.para(c, lore.fate);
        if (lore.hardFate && prog.data.hardCleared?.[zone] === true) {
          el('div', 'ss-story-rule', 'AFTER PROTOCOL B', c);
          this.para(c, lore.hardFate);
        }
      } else this.para(c, 'Beat it to find out what happens to it.', 'dim');
    }

    // ---- Plows (no spoilers: always readable).
    const pp = this.panes.get('plows')!;
    pp.textContent = '';
    const pg = el('div', 'ss-story-grid', undefined, pp);
    for (const kind of Object.keys(PLOW_LORE) as PlowKind[]) {
      const def = PLOWS[kind];
      if (!def) continue;
      const c = this.card(pg, `plow-${kind}`, 'open', PLOW_ICON[kind], def.name, 'Road Crew plow');
      this.para(c, PLOW_LORE[kind]);
    }
  }

  /* ------------------------------------------------------------------ keyboard */

  private cycleTab(dir: number): void {
    const i = TABS.findIndex((t) => t.id === this.tab);
    const next = TABS[(i + dir + TABS.length) % TABS.length].id;
    this.ctx.audio?.play('click');
    this.setTab(next);
    this.tabBtns.get(next)?.focus({ preventScroll: true });
  }

  private navItems(): HTMLElement[] {
    return Array.from(this.panel.querySelectorAll<HTMLElement>('[data-nav]')).filter((x) => x.offsetParent !== null);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.shown) return;
    e.stopImmediatePropagation();
    const code = e.code;
    if (code === 'Escape') {
      e.preventDefault();
      return this.close();
    }
    if (code === 'KeyQ' || code === 'PageUp' || code === 'KeyE' || code === 'PageDown') {
      e.preventDefault();
      if (!e.repeat) this.cycleTab(code === 'KeyQ' || code === 'PageUp' ? -1 : 1);
      return;
    }
    const a = document.activeElement as HTMLElement | null;
    if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
      e.preventDefault();
      if (!e.repeat && a instanceof HTMLButtonElement && this.panel.contains(a)) a.click();
      return;
    }
    if ((code === 'ArrowLeft' || code === 'ArrowRight') && a?.getAttribute('role') === 'tab' && this.panel.contains(a)) {
      e.preventDefault();
      return this.cycleTab(code === 'ArrowLeft' ? -1 : 1);
    }
    const step: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, Tab: e.shiftKey ? -1 : 1 };
    const d = step[code];
    if (!d) return;
    e.preventDefault();
    const items = this.navItems();
    if (!items.length) return;
    const cur = a ? items.indexOf(a) : -1;
    const next = items[cur < 0 ? 0 : (cur + d + items.length) % items.length];
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}
