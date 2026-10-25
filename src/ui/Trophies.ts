import './trophies.css';
import type { GameContext } from '../core/types';
import type { Progression } from '../core/Progression';
import { PLOWS } from '../config/plows';
import { ZONES } from '../config/zones';
import {
  ACHIEVEMENTS, ACHIEVEMENT_CATEGORIES, LIFE, arenasCleared, brawlBestStreak, dailyBestWave, hardClears, killsBySource,
  life, lifeRunsMode, lifeRunsPlow, lifeWinsPlow, stars, survivalBestWave, type AchievementDef,
} from '../config/achievements';
import { achievementProgress, achievementValue, isUnlocked } from '../meta/achievements';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');

/** 3725 s -> "1h 02m", 75 s -> "1m 15s". */
export function fmtPlayTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

type TabId = 'ach' | 'stats';
const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'ach', label: 'Achievements', icon: '🏆' },
  { id: 'stats', label: 'Stats', icon: '📊' },
];

interface Stat {
  icon: string;
  label: string;
  value: string;
  /** Small second line under the label. */
  sub?: string;
}

/** Lifetime stats page, grouped into sections. */
function statSections(p: Progression): { title: string; stats: Stat[] }[] {
  const k = killsBySource(p);
  const ball = life(p, LIFE.ballBestCm);
  const combo = life(p, LIFE.comboBest);
  return [
    {
      title: '🤖 Bots scrapped',
      stats: [
        { icon: '🤖', label: 'Total', value: fmt(k.total) },
        { icon: '⚪', label: 'By slam', value: fmt(k.slam) },
        { icon: '🐏', label: 'By ram', value: fmt(k.ram) },
        { icon: '🌀', label: 'By whirlwind', value: fmt(k.whirl) },
        { icon: '💥', label: 'Other', value: fmt(k.other) },
      ],
    },
    {
      title: '💥 Combat',
      stats: [
        { icon: '❄️', label: 'Slams', value: fmt(life(p, LIFE.slams)) },
        { icon: '🎳', label: 'Most hit by a slam', value: fmt(life(p, LIFE.slamHitsBest)) },
        { icon: '⚡', label: 'STRIKEs', value: fmt(life(p, LIFE.strikes)) },
        { icon: '🏔️', label: 'Biggest ball', value: ball > 0 ? `${(ball / 100).toFixed(2)} m` : '—' },
        { icon: '🔥', label: 'Best combo', value: combo >= 2 ? `x${fmt(combo)}` : '—' },
        { icon: '💀', label: 'Bosses scrapped', value: fmt(life(p, LIFE.bossKills)) },
      ],
    },
    {
      title: '⏱️ Career',
      stats: [
        { icon: '⏱️', label: 'Play time', value: fmtPlayTime(life(p, LIFE.playTime)) },
        { icon: '🎮', label: 'Runs & matches', value: fmt(life(p, LIFE.runs)) },
        { icon: '🪙', label: 'Coins earned', value: fmt(p.data.totalCoinsEarned || 0) },
        { icon: '🏆', label: 'Trophy coins', value: fmt(life(p, LIFE.achievementCoins)) },
        { icon: '🩹', label: 'Damage taken', value: fmt(life(p, LIFE.damageTaken)) },
      ],
    },
    {
      title: '🏔️ Campaign',
      stats: [
        { icon: '🏁', label: 'Arenas cleared', value: `${arenasCleared(p)}/${ZONES.length}` },
        { icon: '⭐', label: 'Challenge stars', value: fmt(stars(p)) },
        { icon: '🌶️', label: 'Hard clears', value: `${hardClears(p)}/${ZONES.length}` },
        { icon: '🎉', label: 'Arena wins', value: fmt(life(p, LIFE.campaignWins)) },
        { icon: '✨', label: 'Clean clears', value: fmt(life(p, LIFE.cleanClears)) },
      ],
    },
    {
      title: '🔥 Brawl',
      stats: [
        { icon: '🎮', label: 'Matches', value: fmt(p.data.brawlMatches || 0) },
        { icon: '🥇', label: 'Wins', value: fmt(p.data.brawlWins || 0) },
        { icon: '📈', label: 'Best streak', value: fmt(brawlBestStreak(p)) },
        { icon: '🎯', label: 'Best kills', value: fmt(p.data.brawlBestKills || 0) },
        { icon: '💢', label: 'Rivals scrapped', value: fmt(life(p, LIFE.brawlKills)) },
        { icon: '🛑', label: 'Shutdowns', value: fmt(life(p, LIFE.brawlShutdowns)) },
      ],
    },
    {
      title: '♾ Survival',
      stats: [
        { icon: '🌊', label: 'Best wave', value: fmt(survivalBestWave(p)) },
        { icon: '🎮', label: 'Survival runs', value: fmt(life(p, lifeRunsMode('survival'))) },
        { icon: '📅', label: 'Daily runs', value: fmt(life(p, LIFE.dailyRuns)) },
        { icon: '🗞️', label: 'Best daily wave', value: fmt(dailyBestWave(p)) },
      ],
    },
    {
      title: '🚜 Plows',
      stats: Object.values(PLOWS).map((def) => ({
        icon: def.icon,
        label: `${def.name} runs`,
        value: fmt(life(p, lifeRunsPlow(def.id))),
        sub: `${fmt(life(p, lifeWinsPlow(def.id)))} arena clears`,
      })),
    },
  ];
}

/**
 * Trophies overlay (main menu): achievements grid by category + lifetime stats page. Owns the keyboard while
 * open (capture phase, like SettingsMenu): arrows / d-pad move focus spatially, Q / E (LB / RB) switch tabs,
 * Enter / A activates, Escape / B closes.
 */
export class Trophies {
  private ctx: GameContext;
  private root: HTMLElement;
  private panel: HTMLElement;
  private body!: HTMLElement;
  private panes = new Map<TabId, HTMLElement>();
  private tabBtns = new Map<TabId, HTMLButtonElement>();
  private countEl!: HTMLElement;
  private barEl!: HTMLElement;
  private coinsEl!: HTMLElement;
  private achBadge!: HTMLElement;
  private tab: TabId = 'ach';
  private shown = false;
  private returnFocus: HTMLElement | null = null;

  constructor(ctx: GameContext, parent: HTMLElement) {
    this.ctx = ctx;
    this.root = el('div', 'ss-screen ss-center ss-dim ss-trophies', undefined, parent);
    this.root.setAttribute('aria-hidden', 'true');
    this.panel = el('div', 'ss-panel ss-glass ss-icicles ss-tro-panel', undefined, this.root);
    this.build();
    // Capture phase on window: runs before Input / Game / UI key handlers so the overlay owns the keyboard.
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    ctx.progression.onChange(() => this.shown && this.render());
  }

  get isOpen(): boolean {
    return this.shown;
  }

  open(): void {
    if (this.shown) return;
    this.shown = true;
    this.returnFocus = document.activeElement as HTMLElement | null;
    // Save live lifetime counters; Achievements re-checks on the change notification.
    this.ctx.progression.commit();
    this.render();
    this.setTab(this.tab, false);
    this.body.scrollTop = 0;
    this.root.classList.add('show');
    this.root.setAttribute('aria-hidden', 'false');
    setTimeout(() => this.shown && this.tabBtns.get(this.tab)?.focus({ preventScroll: true }), 30);
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

  private build(): void {
    const p = this.panel;
    el('h2', 'ss-h2', 'TROPHIES', p);
    const sum = el('div', 'ss-tro-summary', undefined, p);
    this.countEl = el('div', 'ss-tro-count', '', sum);
    const bar = el('div', 'ss-tro-bar', undefined, sum);
    this.barEl = el('i', '', undefined, bar);
    this.coinsEl = el('div', 'ss-tro-coins', '', sum);

    const tabs = el('div', 'ss-tabs ss-tro-tabs', undefined, p);
    tabs.setAttribute('role', 'tablist');
    el('span', 'ss-tab-key', 'Q', tabs).title = 'Previous tab (Q / LB)';
    for (const t of TABS) {
      const b = el('button', `ss-tab ss-tro-tab-${t.id}`, undefined, tabs);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.nav = `tab-${t.id}`;
      el('span', 'ss-tab-icon', t.icon, b);
      el('span', 'ss-tab-label', t.label, b);
      if (t.id === 'ach') this.achBadge = el('span', 'ss-tab-badge ss-tro-badge', '', b);
      b.addEventListener('click', () => {
        if (this.tab !== t.id) this.ctx.audio?.play('click');
        this.setTab(t.id);
      });
      this.tabBtns.set(t.id, b);
    }
    el('span', 'ss-tab-key', 'E', tabs).title = 'Next tab (E / RB)';

    this.body = el('div', 'ss-tro-body', undefined, p);
    for (const t of TABS) {
      const pane = el('div', `ss-tab-pane ss-tro-pane-${t.id}`, undefined, this.body);
      pane.setAttribute('role', 'tabpanel');
      this.panes.set(t.id, pane);
    }

    const foot = el('div', 'ss-panel-foot ss-tro-foot', undefined, p);
    el('div', 'ss-foot-hint', 'Q / E switch tabs · Esc closes', foot);
    const done = this.btn('✔ DONE', 'ss-primary', () => this.close(), foot);
    done.dataset.primary = '1';
    done.dataset.nav = 'done';
  }

  private setTab(id: TabId, sound = false): void {
    if (sound && id !== this.tab) this.ctx.audio?.play('click');
    const changed = id !== this.tab;
    this.tab = id;
    for (const [tid, b] of this.tabBtns) {
      b.classList.toggle('on', tid === id);
      b.setAttribute('aria-selected', tid === id ? 'true' : 'false');
    }
    for (const [tid, pane] of this.panes) pane.classList.toggle('hidden', tid !== id);
    if (changed) this.body.scrollTop = 0;
  }

  /** Rebuild the header and both panes from the save (keeps keyboard focus on the same item). */
  private render(): void {
    const p = this.ctx.progression;
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.nav;
    const done = ACHIEVEMENTS.filter((a) => isUnlocked(p, a.id)).length;
    const total = ACHIEVEMENTS.length;
    this.countEl.innerHTML = `<b>${done}</b> / ${total} <span>UNLOCKED</span>`;
    this.barEl.style.width = `${(done / total) * 100}%`;
    this.coinsEl.textContent = `🪙 ${fmt(life(p, LIFE.achievementCoins))} earned from trophies`;
    this.achBadge.textContent = `${done}/${total}`;

    const ach = this.panes.get('ach')!;
    ach.replaceChildren();
    for (const cat of ACHIEVEMENT_CATEGORIES) {
      const list = ACHIEVEMENTS.filter((a) => a.category === cat.id);
      if (!list.length) continue;
      const sec = el('section', `ss-cat ss-tro-cat ss-tro-cat-${cat.id}`, undefined, ach);
      const title = el('h3', 'ss-cat-title', `${cat.icon} ${cat.label}`, sec);
      el('span', 'ss-tro-cat-count', `${list.filter((a) => isUnlocked(p, a.id)).length}/${list.length}`, title);
      const grid = el('div', 'ss-tro-grid', undefined, sec);
      for (const a of list) this.card(a, grid);
    }

    const stats = this.panes.get('stats')!;
    stats.replaceChildren();
    for (const s of statSections(p)) {
      const sec = el('section', 'ss-tro-sec', undefined, stats);
      sec.tabIndex = -1;
      sec.dataset.nav = `stats-${s.title}`;
      el('h3', 'ss-cat-title', s.title, sec);
      const grid = el('div', 'ss-tro-stats', undefined, sec);
      for (const st of s.stats) {
        const tile = el('div', 'ss-tro-stat', undefined, grid);
        el('div', 'ss-tro-stat-icon', st.icon, tile);
        el('div', 'ss-tro-stat-val', st.value, tile);
        el('div', 'ss-tro-stat-label', st.label, tile);
        if (st.sub) el('div', 'ss-tro-stat-sub', st.sub, tile);
      }
    }

    if (focusKey && this.shown) {
      const f = this.panel.querySelector<HTMLElement>(`[data-nav="${CSS.escape(focusKey)}"]`);
      f?.focus({ preventScroll: true });
    }
  }

  private card(a: AchievementDef, parent: HTMLElement): void {
    const p = this.ctx.progression;
    const got = isUnlocked(p, a.id);
    const hidden = !!a.secret && !got;
    const c = el('div', `ss-tro-card${got ? ' got' : ''}${hidden ? ' secret' : ''}`, undefined, parent);
    c.tabIndex = -1;
    c.dataset.nav = `ach-${a.id}`;
    el('div', 'ss-tro-icon', hidden ? '❔' : a.icon, c);
    const info = el('div', 'ss-tro-info', undefined, c);
    el('div', 'ss-tro-name', hidden ? '???' : a.name, info);
    el('div', 'ss-tro-desc', hidden ? 'Secret achievement. Keep plowing.' : a.desc, info);
    if (!got && !hidden && a.goal > 1) {
      const v = Math.min(a.goal, achievementValue(p, a));
      const f = a.fmt ?? fmt;
      const prog = el('div', 'ss-tro-prog', undefined, info);
      const bar = el('div', 'ss-tro-pbar', undefined, prog);
      el('i', '', undefined, bar).style.width = `${achievementProgress(p, a) * 100}%`;
      el('span', 'ss-tro-pval', `${f(v)} / ${f(a.goal)}`, prog);
    }
    el('div', 'ss-tro-reward', got ? '✔' : `+${fmt(a.reward)}`, c).title = got ? 'Unlocked' : `${fmt(a.reward)} coin reward`;
    c.setAttribute('aria-label', `${hidden ? 'Secret achievement' : a.name}${got ? ', unlocked' : ', locked'}`);
  }

  /* ------------------------------------------------------------------ keyboard */

  private cycleTab(dir: number): void {
    const i = TABS.findIndex((t) => t.id === this.tab);
    const next = TABS[(i + dir + TABS.length) % TABS.length].id;
    this.setTab(next, true);
    this.tabBtns.get(next)?.focus({ preventScroll: true });
  }

  private navItems(): HTMLElement[] {
    return Array.from(this.panel.querySelectorAll<HTMLElement>('[data-nav]')).filter((x) => x.offsetParent !== null);
  }

  /** Focus the nearest item in direction (dx, dy); falls back to list order when nothing lies that way. */
  private moveFocus(dx: number, dy: number, linear: number): void {
    const items = this.navItems();
    if (!items.length) return;
    const a = document.activeElement as HTMLElement | null;
    const cur = a ? items.indexOf(a) : -1;
    if (cur < 0) return this.focusItem(items[0]);
    let best: HTMLElement | null = null;
    if (dx || dy) {
      const r = items[cur].getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let bestScore = Infinity;
      for (const it of items) {
        if (it === items[cur]) continue;
        const q = it.getBoundingClientRect();
        // Distance along the move axis from our edge to theirs; skip anything not ahead of us.
        const along = dx > 0 ? q.left - r.right : dx < 0 ? r.left - q.right : dy > 0 ? q.top - r.bottom : r.top - q.bottom;
        if (along < -4) continue;
        const qx = q.left + q.width / 2;
        const qy = q.top + q.height / 2;
        const across = dx ? Math.abs(qy - cy) : Math.abs(qx - cx);
        // Same row / column first: sideways offset weighs much more than distance.
        const score = Math.max(0, along) + across * (dx ? 4 : 1.5);
        if (score < bestScore) {
          bestScore = score;
          best = it;
        }
      }
    }
    this.focusItem(best ?? items[(cur + linear + items.length) % items.length]);
  }

  private focusItem(x: HTMLElement): void {
    x.focus({ preventScroll: true });
    x.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
    // On the tab bar, left / right switch tabs.
    if ((code === 'ArrowLeft' || code === 'ArrowRight') && a?.getAttribute('role') === 'tab' && this.panel.contains(a)) {
      e.preventDefault();
      return this.cycleTab(code === 'ArrowLeft' ? -1 : 1);
    }
    const dirs: Record<string, [number, number, number]> = {
      ArrowDown: [0, 1, 1], ArrowUp: [0, -1, -1], ArrowRight: [1, 0, 1], ArrowLeft: [-1, 0, -1],
      Tab: [0, 0, e.shiftKey ? -1 : 1],
    };
    const d = dirs[code];
    if (!d) return;
    e.preventDefault();
    this.moveFocus(d[0], d[1], d[2]);
  }
}
