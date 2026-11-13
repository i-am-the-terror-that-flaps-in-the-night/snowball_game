import './fonts.css';
import './ui.css';
import './brawl.css';
import './challenges.css';
import type { BrawlResult, GameContext, HudState, RunSummary, SoundName, SurvivalShopOpts, UIAPI, UIHandlers } from '../core/types';
import { SHOP_UPGRADES, type UpgradeCategory } from '../config/upgrades';
import type { GearSlot } from '../config/gear';
import { PLOWS, type PlowKind } from '../config/plows';
import { ZONES } from '../config/zones';
import { SettingsMenu } from './Settings';
import { survivalBest, survivalUnlocked } from '../survival/SurvivalManager';
import { StyleShop } from './StyleShop';
import { Trophies } from './Trophies';
import { Story } from './Story';
import { activeDaily, dailySubLabel } from '../meta/daily';
import { ICONS, type IconName } from './icons';
import { renderDailyShopTag } from './DailyResult';
import { renderLoot } from './LootReveal';
import { maxStars } from '../meta/challenges';
import { achievementCount, totalStars } from '../meta/progress';
import { ACHIEVEMENTS } from '../config/achievements';
import { DuelUI } from './DuelUI';
import type { DuelWallet, ShopWallet } from '../duel/DuelWallet';
import { hubPick, type ArrowCode, type HubNavKind } from './hubNav';
import { el, fmt, restart, type BtnFn } from './uiKit';
import { fillControls } from './controls';
import { GameHud } from './GameHud';
import * as howTo from './screens/howTo';
import * as zones from './screens/zones';
import * as garage from './screens/garage';
import * as results from './screens/results';
import * as brawl from './screens/brawl';

// Keyboard / gamepad grid navigation lives in hubNav.ts; re-exported so importers of UI keep working.
export { spatialPick, hubPick, type ArrowCode, type HubNavKind } from './hubNav';

/** Main-menu hub categories. A new menu destination is one `tile()` call in buildMenu, inside its category. */
const HUB_CATS = [
  ['play', 'Play'],
  ['build', 'Build'],
  ['record', 'Record'],
  ['system', 'System'],
] as const;
type HubCat = (typeof HUB_CATS)[number][0];

type ScreenName = 'menu' | 'zones' | 'garage' | 'howto' | 'pause' | 'result' | 'lobby' | 'bresult';

export class UI implements UIAPI {
  private ctx: GameContext;
  private handlers: UIHandlers;
  private rootEl: HTMLElement;
  private screens = {} as Record<ScreenName, HTMLElement>;
  private current: ScreenName | null = null;
  private shownAt = 0;

  // menu
  private menuCoins!: HTMLElement;
  private menuStats!: HTMLElement;
  private muteBtns: HTMLButtonElement[] = [];
  private settings!: SettingsMenu;
  private controlLists: HTMLElement[] = [];
  private survivalBtn!: HTMLButtonElement;
  private dailyBtn!: HTMLButtonElement;
  private hubCat: HubCat = 'play';
  private hubTabs = new Map<HubCat, HTMLButtonElement>();
  private hubPanes = new Map<HubCat, HTMLElement>();
  private hubMute!: HTMLButtonElement;
  private hubBoard = new Map<string, HTMLElement>();
  /** Paint shop (cosmetics) and Trophies (achievements + stats) overlays. */
  private styleShop!: StyleShop;
  private trophies!: Trophies;
  /** Story overlay (campaign chapters, boss profiles, plow bios). */
  private story!: Story;

  // zones
  private zoneGrid!: HTMLElement;
  private zoneStarTotal!: HTMLElement;

  // garage / shop
  private shopTitle!: HTMLElement;
  private shopSub!: HTMLElement;
  private shopCoins!: HTMLElement;
  private shopPreview!: HTMLElement;
  /** Starter-plow picker (Garage only). */
  private plowPick!: HTMLElement;
  private plowCards = new Map<PlowKind, HTMLElement>();
  private shopBack!: HTMLButtonElement;
  private shopStart!: HTMLButtonElement;
  private shopHint!: HTMLElement;
  private cards: garage.CardRefs[] = [];
  /** Garage tabs: open tab, tab buttons, their panes and the plow-line sections (one per plow). */
  private shopTab: garage.ShopTabId = 'core';
  private gearCards: garage.GearCardRefs[] = [];
  private gearSlotLabels = new Map<GearSlot, HTMLElement>();
  private tabBtns = new Map<garage.ShopTabId, garage.ShopTabRefs>();
  private tabPanes = new Map<garage.ShopTabId, HTMLElement>();
  private lineSections = new Map<UpgradeCategory, HTMLElement>();
  private shopBody!: HTMLElement;
  private tabBlurb!: HTMLElement;
  private tabTraits!: HTMLElement;
  private shopContinue: (() => void) | null = null;
  /** Open Survival between-wave shop (null otherwise); drives the Full Repair button. */
  private survivalShop: SurvivalShopOpts | null = null;
  private repairBtn: HTMLButtonElement | null = null;
  private garageBack: 'menu' | 'quit' = 'menu';
  /** Pre-duel DUEL GARAGE: the wallet that pays (bonus first, then real coins); null = the save. */
  private duelWallet: DuelWallet | null = null;
  private duelWalletOff: (() => void) | null = null;
  /** Online duel overlays (lobby, garage strip, HUD, banners, result). */
  readonly duel: DuelUI;
  private pauseSub!: HTMLElement;
  private pauseQuit!: HTMLButtonElement;

  // result
  private resultPanel!: HTMLElement;

  // brawl
  private lobbyPanel!: HTMLElement;
  private bresultScreen!: HTMLElement;
  private bresultPanel!: HTMLElement;
  /** Campaign / Survival minimap + lost-bot arrows (the HUD's; kept here too for scripts/hud-probe.mjs). */

  // hud + fx
  private gameHud!: GameHud;
  private toastBox!: HTMLElement;
  private bigBox!: HTMLElement;

  constructor(ctx: GameContext, root: HTMLElement, handlers: UIHandlers) {
    this.ctx = ctx;
    this.handlers = handlers;
    this.rootEl = el('div', 'ss-root', undefined, root);

    this.gameHud = new GameHud(ctx, this.rootEl, () => this.toastBox, () => this.refreshKeys());
    this.buildMenu();
    this.buildHowTo();
    this.buildZones();
    this.buildShop();
    this.buildPause();
    this.buildResult();
    this.buildLobby();
    this.buildBrawlResult();
    this.settings = new SettingsMenu(ctx, this.rootEl, {
      onResetSave: () => this.handlers.onResetSave(),
      onSaveChanged: () => this.refreshMute(),
      onClose: () => this.refreshKeys(),
    });
    this.duel = new DuelUI(this.rootEl);
    this.styleShop = new StyleShop(ctx, this.rootEl);
    this.trophies = new Trophies(ctx, this.rootEl);
    this.story = new Story(ctx, this.rootEl);
    this.refreshKeys();
    this.toastBox = el('div', 'ss-toasts', undefined, this.rootEl);
    this.bigBox = el('div', 'ss-bigtoasts', undefined, this.rootEl);

    ctx.progression.onChange(() => this.refreshProgress());
    ctx.events.on('plowDamaged', ({ amount, blocked }) => this.gameHud.pulse(amount, blocked));
    ctx.events.on('bossPhase', ({ name, label }) => this.gameHud.onBossPhase(name, label));

    window.addEventListener('keydown', (e) => this.onKey(e));
    this.refreshProgress();
  }

  /* ================================================================== helpers */

  private sfx(name: SoundName): void {
    this.ctx.audio?.play(name);
  }

  /** `btn` for the screen builders in screens/. */
  private readonly btnFn: BtnFn = (label, cls, onClick, parent, sound) => this.btn(label, cls, onClick, parent, sound);

  private btn(label: string, cls: string, onClick: () => void, parent?: HTMLElement, sound: SoundName | null = 'click'): HTMLButtonElement {
    const b = el('button', `ss-btn ${cls}`, undefined, parent);
    b.type = 'button';
    b.innerHTML = label;
    b.addEventListener('click', () => {
      if (sound) this.sfx(sound);
      onClick();
    });
    return b;
  }

  private screen(name: ScreenName, cls: string): HTMLElement {
    const s = el('div', `ss-screen ${cls}`, undefined, this.rootEl);
    this.screens[name] = s;
    return s;
  }

  private show(name: ScreenName): void {
    for (const k in this.screens) {
      const s = this.screens[k as ScreenName];
      s.classList.toggle('show', k === name);
      s.setAttribute('aria-hidden', k === name ? 'false' : 'true');
    }
    this.current = name;
    this.shownAt = performance.now();
    if (name === 'result' || name === 'bresult') {
      // Stale in-game toasts / intro would sit on top of the end screens.
      this.bigBox?.replaceChildren();
      this.toastBox?.replaceChildren();
      this.gameHud.endIntro();
    }
    const a = document.activeElement as HTMLElement | null;
    if (a && a.blur) a.blur();
    setTimeout(() => {
      if (this.current !== name) return;
      const target = this.visiblePrimary(this.screens[name]);
      if (!target) return;
      target.focus({ preventScroll: true });
      // Every screen opens at its top (How to Play's primary is BACK at the very bottom, the Brawl lobby's sits under
      // the rules). The end screens and the arena list then bring their primary into view: a victory with loot can
      // push NEXT below the fold, and the arena to play next can be the sixth card on a phone.
      this.resetScroll(this.screens[name]);
      if (name === 'result' || name === 'bresult' || name === 'zones') target.scrollIntoView({ block: 'nearest' });
    }, 30);
  }

  /** Scroll a screen and every scrollable panel inside it back to the top. */
  private resetScroll(scr: HTMLElement): void {
    scr.scrollTop = 0;
    scr.querySelectorAll<HTMLElement>('*').forEach((n) => {
      if (n.scrollTop) n.scrollTop = 0;
    });
  }

  /** The screen's first `[data-primary]` button that is actually shown (not inside a hidden hub pane / section). */
  private visiblePrimary(scr: HTMLElement): HTMLButtonElement | undefined {
    return Array.from(scr.querySelectorAll<HTMLButtonElement>('[data-primary]')).find(
      (b) => !b.disabled && !b.closest('.hidden') && b.offsetParent !== null,
    );
  }

  private controlsList(parent: HTMLElement): HTMLElement {
    const list = el('div', 'ss-controls', undefined, parent);
    this.controlLists.push(list);
    fillControls(this.ctx.input, list);
    return list;
  }

  /** Re-read key bindings into every on-screen key prompt (controls lists, HUD ability keys, first-run hint). */
  refreshKeys(): void {
    for (const list of this.controlLists) fillControls(this.ctx.input, list);
    this.gameHud.refreshKeyLabels();
  }

  private coinPill(parent: HTMLElement, cls = ''): HTMLElement {
    const pill = el('div', `ss-coinpill ${cls}`, undefined, parent);
    el('span', 'ss-coin', undefined, pill);
    return el('span', 'ss-coin-val', '0', pill);
  }

  private refreshMute(): void {
    const muted = !!this.ctx.audio?.muted;
    for (const b of this.muteBtns) {
      if (b.classList.contains('ss-tile')) {
        this.setTile(b, muted ? 'Off · press M' : 'On · press M');
        b.querySelector('.ss-tile-ico')!.innerHTML = muted ? ICONS.soundOff : ICONS.soundOn;
        b.classList.toggle('off', muted);
        continue;
      }
      b.innerHTML = muted ? '🔇 SOUND: OFF' : '🔊 SOUND: ON';
      b.classList.toggle('off', muted);
    }
    this.hubMute.innerHTML = muted ? ICONS.soundOff : ICONS.soundOn;
    this.hubMute.classList.toggle('off', muted);
    this.hubMute.title = this.hubMute.ariaLabel = muted ? 'Sound: off' : 'Sound: on';
  }

  private refreshProgress(): void {
    const p = this.ctx.progression;
    const c = fmt(p.coins);
    this.menuCoins.textContent = c;
    this.shopCoins.textContent = c;
    const cleared = ZONES.filter((z) => p.zoneRecord(z.id).cleared).length;
    const bw = p.data.brawlWins ?? 0;
    const bm = p.data.brawlMatches ?? 0;
    const stars = totalStars(p);
    const ach = achievementCount(p);
    this.menuStats.innerHTML =
      `<span>Arenas <b>${cleared}/${ZONES.length}</b></span><span>Bots scrapped <b>${fmt(p.data.totalKills)}</b></span>` +
      (bm > 0 ? `<span>Brawl wins <b>${fmt(bw)}/${fmt(bm)}</b></span>` : '') +
      `<span>Trophies <b>${ach}/${ACHIEVEMENTS.length}</b></span>`;
    const sb = survivalBest(p);
    const unlocked = survivalUnlocked(p);
    this.setTile(this.survivalBtn, unlocked ? (sb > 0 ? `Best wave ${sb}` : 'Endless waves') : `Locked · beat ${ZONES[0].name}`, !unlocked);
    this.setTile(this.dailyBtn, unlocked ? dailySubLabel(p) : `Locked · beat ${ZONES[0].name}`, !unlocked);
    const board = this.hubBoard;
    const set = (k: string, v: string) => { const e = board.get(k); if (e) e.innerHTML = v; };
    set('arenas', `${cleared}<small>/${ZONES.length}</small>`);
    set('stars', `${stars}<small>/${maxStars()}</small>`);
    set('kills', fmt(p.data.totalKills));
    set('brawl', bm > 0 ? `${fmt(bw)}<small>/${fmt(bm)}</small>` : '—');
    set('survival', sb > 0 ? `${sb}` : '—');
    set('trophies', `${ach}<small>/${ACHIEVEMENTS.length}</small>`);
    this.refreshCards();
    if (this.current === 'zones') this.renderZones();
  }

  /* ================================================================== keyboard */

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'KeyM') setTimeout(() => this.refreshMute(), 0);
    const name = this.current;
    if (!name) return;
    const scr = this.screens[name];
    const code = e.code;
    if (code === 'Escape') {
      if (name === 'zones' || name === 'howto' || name === 'lobby') {
        e.preventDefault();
        this.sfx('click');
        this.showMainMenu();
      } else if (name === 'garage' && !this.shopContinue && !this.duelWallet) {
        e.preventDefault();
        this.shopBack.click();
      }
      return;
    }
    if ((name === 'menu' || name === 'garage') && (code === 'KeyQ' || code === 'KeyE' || code === 'PageUp' || code === 'PageDown')) {
      e.preventDefault();
      // Holding the key would spin through every tab on auto-repeat (the pad's shoulder buttons are edge-triggered).
      if (e.repeat) return;
      const dir = code === 'KeyQ' || code === 'PageUp' ? -1 : 1;
      if (name === 'menu') this.cycleHubCat(dir);
      else this.cycleShopTab(dir);
      return;
    }
    const isActivate = code === 'Enter' || code === 'NumpadEnter' || code === 'Space';
    if (isActivate) {
      e.preventDefault();
      if (e.repeat || performance.now() - this.shownAt < 450) return;
      const a = document.activeElement;
      if (name === 'garage' && this.shopContinue && code !== 'Space') {
        // Enter fights, unless a card / repair button was picked with arrows / d-pad (gamepad A buys it).
        const picked = a instanceof HTMLButtonElement && scr.contains(a) && a.matches(':focus-visible');
        (picked ? a : this.shopStart).click();
        return;
      }
      if (a instanceof HTMLButtonElement && scr.contains(a)) {
        a.click();
      } else if (code !== 'Space') {
        this.visiblePrimary(scr)?.click();
      }
      return;
    }
    const nav: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, Tab: e.shiftKey ? -1 : 1 };
    const dir = nav[code];
    if (!dir) return;
    e.preventDefault();
    const btns = Array.from(scr.querySelectorAll<HTMLButtonElement>('button')).filter((b) => b.offsetParent !== null && !b.disabled);
    if (!btns.length) return;
    let i = btns.indexOf(document.activeElement as HTMLButtonElement);
    if (i >= 0 && name === 'menu' && code !== 'Tab') {
      // The hub is a 2D grid (tab rail, tiles, utility strip): arrows / d-pad move to the nearest button in that
      // direction and stop at the edges (wrapping in DOM order would teleport across the grid). Tab stays linear,
      // and so do the list-like screens and the no-focus case below.
      const from = btns[i];
      const kinds = btns.map((b): HubNavKind => (b.classList.contains('ss-hub-cat') ? 'cat' : b.closest('.ss-hub-util') ? 'util' : 'pane'));
      const j = hubPick(btns.map((b) => b.getBoundingClientRect()), kinds, i, code as ArrowCode);
      if (j < 0) return;
      i = j;
      const fromTab = from.classList.contains('ss-hub-cat');
      if (btns[i].classList.contains('ss-hub-cat')) {
        if (fromTab) {
          // Along the tab rail, the focused tab is the shown one.
          btns[i].click();
        } else {
          // Climbing out of a pane lands on that pane's own tab, not whichever tab happens to be above.
          const on = this.hubTabs.get(this.hubCat);
          if (on && btns.includes(on)) i = btns.indexOf(on);
        }
      }
    } else {
      i = i < 0 ? (dir > 0 ? 0 : btns.length - 1) : (i + dir + btns.length) % btns.length;
    }
    const next = btns[i];
    next.focus();
    next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ================================================================== main menu */

  private buildMenu(): void {
    const s = this.screen('menu', 'ss-menu');
    const hub = el('div', 'ss-hub', undefined, s);
    const title = el('h1', 'ss-title', undefined, hub);
    el('span', 'ss-title-a', 'Snowplow', title);
    el('span', 'ss-title-b', 'Showdown', title);
    el('div', 'ss-hub-tape', 'Plow it · Pack it · Slam it', hub);

    const util = el('div', 'ss-hub-util', undefined, s);
    this.menuCoins = this.coinPill(util, 'ss-menu-coins');
    this.hubMute = this.iconBtn('soundOn', 'Sound', () => {
      this.handlers.onToggleMute();
      this.refreshMute();
    }, util);
    this.iconBtn('settings', 'Settings', () => this.settings.open(), util, null);

    const nav = el('div', 'ss-hub-nav', undefined, hub);
    nav.setAttribute('role', 'tablist');
    const body = el('div', 'ss-hub-body', undefined, hub);
    HUB_CATS.forEach(([id, label], i) => {
      const t = el('button', 'ss-hub-cat', undefined, nav);
      t.type = 'button';
      t.dataset.cat = id;
      t.setAttribute('role', 'tab');
      t.innerHTML = `<span class="ss-hub-cat-n">0${i + 1}</span>${label}`;
      t.addEventListener('click', () => {
        if (this.hubCat !== id) this.sfx('click');
        this.setHubCat(id);
      });
      this.hubTabs.set(id, t);
      const pane = el('div', 'ss-hub-pane', undefined, body);
      pane.setAttribute('role', 'tabpanel');
      this.hubPanes.set(id, pane);
    });
    el('div', 'ss-hub-key', undefined, nav).innerHTML = '<kbd>Q</kbd><kbd>E</kbd>';

    const locked = () => !survivalUnlocked(this.ctx.progression);
    const lockMsg = (what: string) => this.toast(`Beat ${ZONES[0].name} to unlock ${what}`, 'bad');
    // PLAY
    this.tile('play', 'fight', 'Fight', 'Six arenas · bosses · stars', () => this.showZoneSelect(), 'hero').dataset.primary = '1';
    this.tile('play', 'brawl', 'Brawl', 'Free-for-all vs rival plows', () => this.showBrawlLobby(), 'hot', 'New');
    this.survivalBtn = this.tile('play', 'survival', 'Survival', '', () =>
      locked() ? lockMsg('Survival') : this.handlers.onStartSurvival?.());
    this.dailyBtn = this.tile('play', 'daily', 'Daily', '', () =>
      locked() ? lockMsg('the Daily run') : this.handlers.onStartDaily?.());
    this.tile('play', 'duel', 'Duel', 'Online 1v1 with a friend', () => this.handlers.onOpenDuel?.(), 'hot ss-duel-menu');
    this.tile('play', 'tutorial', 'Tutorial', 'Learn the controls', () => this.handlers.onStartTutorial?.());
    // BUILD
    this.tile('build', 'garage', 'Garage', 'Plows · upgrades · gear', () => this.openGarage('menu'), 'hero').dataset.primary = '1';
    this.tile('build', 'paint', 'Paint Shop', 'Colours · decals · trails', () => this.styleShop.open(), 'tall', undefined, null);
    // RECORD
    this.tile('record', 'trophy', 'Trophies', 'Achievements', () => this.trophies.open(), 'tall', undefined, null).dataset.primary = '1';
    this.tile('record', 'story', 'Story', 'Chapters · bosses · plows', () => this.story.open(), 'tall', undefined, null);
    const board = el('div', 'ss-board', undefined, this.hubPanes.get('record'));
    el('div', 'ss-board-h', 'SERVICE RECORD', board);
    for (const [k, label] of [
      ['arenas', 'Arenas cleared'], ['stars', 'Challenge stars'], ['kills', 'Bots scrapped'],
      ['brawl', 'Brawl wins'], ['survival', 'Best survival wave'], ['trophies', 'Trophies'],
    ] as const) {
      const row = el('div', 'ss-board-row', undefined, board);
      el('span', 'ss-board-k', label, row);
      this.hubBoard.set(k, el('span', 'ss-board-v', '—', row));
    }
    // SYSTEM
    this.tile('system', 'settings', 'Settings', 'Video · audio · controls · saves', () => this.settings.open(), 'wide', undefined, null).dataset.primary = '1';
    this.tile('system', 'help', 'How to Play', 'Controls and the basics', () => this.show('howto'));
    const mute = this.tile('system', 'soundOn', 'Sound', '', () => {
      this.handlers.onToggleMute();
      this.refreshMute();
    });
    mute.classList.add('ss-hub-mute');
    this.muteBtns.push(mute);
    // Save reset / export / import live in ⚙ SETTINGS → Save data.

    this.menuStats = el('div', 'ss-menu-stats', '', hub);
    this.setHubCat(this.hubCat);
    this.refreshMute();
  }

  /** One hub tile. `cls` adds hero / hot / tall / wide; `tag` is a corner badge (e.g. NEW). */
  private tile(cat: HubCat, icon: IconName, name: string, sub: string, onClick: () => void, cls = '', tag?: string, sound: SoundName | null = 'click'): HTMLButtonElement {
    const pane = this.hubPanes.get(cat)!;
    const b = el('button', `ss-tile ${cls}`, undefined, pane);
    b.type = 'button';
    b.dataset.tile = icon; // stable hook for the headless probes
    el('span', 'ss-tile-ico', undefined, b).innerHTML = ICONS[icon];
    el('span', 'ss-tile-name', name, b);
    el('span', 'ss-tile-sub', sub, b);
    el('span', 'ss-tile-n', String(pane.querySelectorAll('.ss-tile').length).padStart(2, '0'), b);
    if (tag) el('span', 'ss-tile-tag', tag, b);
    b.addEventListener('click', () => {
      if (sound) this.sfx(sound);
      onClick();
    });
    return b;
  }

  private setTile(b: HTMLButtonElement, sub: string, locked = false): void {
    const s = b.querySelector('.ss-tile-sub');
    if (s) s.textContent = sub;
    b.classList.toggle('locked', locked);
  }

  private iconBtn(icon: IconName, label: string, onClick: () => void, parent: HTMLElement, sound: SoundName | null = 'click'): HTMLButtonElement {
    const b = el('button', 'ss-icon-btn', undefined, parent);
    b.type = 'button';
    b.innerHTML = ICONS[icon];
    b.title = b.ariaLabel = label;
    b.addEventListener('click', () => {
      if (sound) this.sfx(sound);
      onClick();
    });
    return b;
  }

  private setHubCat(cat: HubCat): void {
    this.hubCat = cat;
    for (const [id, t] of this.hubTabs) {
      t.classList.toggle('on', id === cat);
      t.setAttribute('aria-selected', String(id === cat));
    }
    for (const [id, p] of this.hubPanes) p.classList.toggle('hidden', id !== cat);
  }

  private cycleHubCat(dir: number): void {
    const i = HUB_CATS.findIndex(([id]) => id === this.hubCat);
    this.setHubCat(HUB_CATS[(i + dir + HUB_CATS.length) % HUB_CATS.length][0]);
    this.sfx('click');
    // The focused tile just went hidden with its pane: move focus to the new pane's main tile.
    if (this.current === 'menu') this.visiblePrimary(this.hubPanes.get(this.hubCat)!)?.focus({ preventScroll: true });
  }

  /* ================================================================== how to play */

  private buildHowTo(): void {
    howTo.buildHowTo({ controlsList: (p) => this.controlsList(p), btn: this.btnFn, showMainMenu: () => this.showMainMenu() }, this.screen('howto', 'ss-center ss-dim'));
  }

  /* ================================================================== arena select */

  private buildZones(): void {
    const s = this.screen('zones', 'ss-center ss-dim');
    const panel = el('div', 'ss-panel ss-glass ss-zones ss-icicles', undefined, s);
    const head = el('div', 'ss-zones-head', undefined, panel);
    el('h2', 'ss-h2', 'CHOOSE YOUR ARENA', head);
    this.zoneStarTotal = el('div', 'ss-star-total', '', head);
    this.zoneStarTotal.title = `Challenge stars: ${maxStars() / ZONES.length} per arena. Each new star pays coins.`;
    this.zoneGrid = el('div', 'ss-zone-grid', undefined, panel);
    const foot = el('div', 'ss-panel-foot', undefined, panel);
    this.btn('◀ BACK', 'ss-ice', () => this.showMainMenu(), foot);
  }

  private renderZones(): void {
    zones.renderZones({
      ctx: this.ctx, handlers: this.handlers, zoneGrid: this.zoneGrid, zoneStarTotal: this.zoneStarTotal, sfx: (n) => this.sfx(n), btn: this.btnFn,
    });
  }

  /* ================================================================== garage / shop */

  private buildShop(): void {
    const s = this.screen('garage', 'ss-center ss-dim');
    const panel = el('div', 'ss-panel ss-glass ss-shop ss-icicles', undefined, s);
    const head = el('div', 'ss-shop-head', undefined, panel);
    const titles = el('div', 'ss-shop-titles', undefined, head);
    this.shopTitle = el('h2', 'ss-h2', 'GARAGE', titles);
    this.shopSub = el('div', 'ss-shop-sub', '', titles);
    this.shopCoins = this.coinPill(head, 'ss-shop-coins');
    this.shopPreview = el('div', 'ss-round-preview', undefined, panel);
    this.plowPick = el('div', 'ss-plow-pick', undefined, panel);
    for (const def of Object.values(PLOWS)) {
      const card = el('button', `ss-plow-card ss-plow-${def.id}`, undefined, this.plowPick) as HTMLButtonElement;
      card.type = 'button';
      el('div', 'ss-plow-icon', def.icon, card);
      const info = el('div', 'ss-plow-info', undefined, card);
      el('div', 'ss-plow-name', def.name, info);
      el('div', 'ss-plow-tag', def.tagline, info);
      card.title = def.traits.join(' · ');
      el('span', '', ' DRIVING', el('div', 'ss-plow-sel', '✓', card));
      card.addEventListener('click', () => {
        this.ctx.progression.setPlow(def.id);
        this.ctx.stats = this.ctx.progression.computeStats();
        this.ctx.plow.applyStats(this.ctx.stats);
        this.sfx(def.id === 'classic' ? 'click' : 'buy');
        // Show what the new plow brings: its traits and its own upgrade line.
        this.setShopTab('line');
      });
      this.plowCards.set(def.id, card);
    }

    const tabs = el('div', 'ss-tabs', undefined, panel);
    tabs.setAttribute('role', 'tablist');
    el('span', 'ss-tab-key', 'Q', tabs).title = 'Previous tab (Q / LB)';
    for (const t of garage.SHOP_TABS) {
      const btn = el('button', `ss-tab ss-tab-${t.id}`, undefined, tabs);
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      const icon = el('span', 'ss-tab-icon', t.icon, btn);
      const label = el('span', 'ss-tab-label', t.label, btn);
      const badge = el('span', 'ss-tab-badge', '', btn);
      btn.title = t.label;
      badge.title = 'Upgrades you can afford';
      btn.addEventListener('click', () => {
        if (this.shopTab !== t.id) this.sfx('click');
        this.setShopTab(t.id);
      });
      this.tabBtns.set(t.id, { btn, icon, label, badge });
    }
    el('span', 'ss-tab-key', 'E', tabs).title = 'Next tab (E / RB)';
    const info = el('div', 'ss-tab-info', undefined, panel);
    this.tabBlurb = el('div', 'ss-tab-blurb', '', info);
    this.tabTraits = el('ul', 'ss-tab-traits', undefined, info);

    this.shopBody = el('div', 'ss-shop-body', undefined, panel);
    for (const t of garage.SHOP_TABS) {
      const pane = el('div', `ss-tab-pane ss-pane-${t.id}`, undefined, this.shopBody);
      pane.setAttribute('role', 'tabpanel');
      this.tabPanes.set(t.id, pane);
      for (const g of t.groups) {
        const sec = el('section', `ss-cat ss-cat-${g.cat}`, undefined, pane);
        if (g.title) el('h3', 'ss-cat-title', g.title, sec);
        const grid = el('div', 'ss-card-grid', undefined, sec);
        for (const def of SHOP_UPGRADES.filter((u) => u.category === g.cat)) this.cards.push(garage.buildCard(this.garageDeps(), def, t.id, grid));
        if (t.id === 'line') this.lineSections.set(g.cat, sec);
      }
      if (t.id === 'gear') garage.buildGear(this.garageDeps(), pane);
    }
    this.setShopTab(this.shopTab);

    const foot = el('div', 'ss-panel-foot ss-shop-foot', undefined, panel);
    this.shopBack = this.btn('◀ BACK', 'ss-ice', () => {
      if (this.garageBack === 'quit') this.handlers.onQuitToMenu();
      else this.showMainMenu();
    }, foot);
    this.shopHint = el('div', 'ss-foot-hint', 'Press ENTER to fight', foot);
    this.shopStart = this.btn('⚔ FIGHT ▶', 'ss-primary ss-big ss-fight', () => {
      const fn = this.shopContinue;
      this.shopContinue = null;
      if (fn) fn();
    }, foot);
  }

  /** Open a Garage tab (also refreshes the tab bar, badges and the plow-line view). */
  private setShopTab(id: garage.ShopTabId): void {
    const changed = id !== this.shopTab;
    this.shopTab = id;
    for (const [tid, t] of this.tabBtns) {
      t.btn.classList.toggle('on', tid === id);
      t.btn.setAttribute('aria-selected', tid === id ? 'true' : 'false');
    }
    for (const [tid, pane] of this.tabPanes) pane.classList.toggle('hidden', tid !== id);
    if (changed) this.shopBody.scrollTop = 0;
    garage.refreshTabs(this.garageDeps());
  }

  /** Who the Garage buys through: the save, or the duel garage's wallet. */
  private get shop(): ShopWallet {
    return this.duelWallet ?? this.ctx.progression;
  }

  /** What the Garage helpers (screens/garage.ts) read: this UI's garage refs, with `shop` read at call time. */
  private garageDeps(): garage.GarageDeps {
    return {
      ctx: this.ctx, shop: () => this.shop, duelWallet: this.duelWallet, sfx: (n) => this.sfx(n),
      cards: this.cards, gearCards: this.gearCards, gearSlotLabels: this.gearSlotLabels, tabBtns: this.tabBtns,
      lineSections: this.lineSections, shopTab: this.shopTab, tabBlurb: this.tabBlurb, tabTraits: this.tabTraits,
      plowPick: this.plowPick, shopPreview: this.shopPreview,
    };
  }

  /** Q / E (gamepad LB / RB): previous / next Garage tab. */
  private cycleShopTab(dir: number): void {
    const i = garage.SHOP_TABS.findIndex((t) => t.id === this.shopTab);
    this.setShopTab(garage.SHOP_TABS[(i + dir + garage.SHOP_TABS.length) % garage.SHOP_TABS.length].id);
    this.sfx('click');
    // Like the hub: if a tab had focus, focus follows the newly selected tab.
    const a = document.activeElement;
    if (a instanceof HTMLElement && a.classList.contains('ss-tab')) {
      this.screens.garage.querySelector<HTMLButtonElement>('.ss-tab.on')?.focus({ preventScroll: true });
    }
  }

  private refreshCards(): void {
    const p = this.shop;
    const dw = this.duelWallet;
    if (dw) this.shopCoins.textContent = fmt(dw.coins);
    this.refreshRepair();
    garage.refreshGear(this.garageDeps());
    const plow = p.plow;
    for (const [id, card] of this.plowCards) card.classList.toggle('on', id === plow);
    for (const c of this.cards) {
      const lvl = p.level(c.def.id);
      const maxed = p.isMaxed(c.def.id);
      const afford = p.canBuy(c.def.id);
      c.pips.forEach((pip, i) => pip.classList.toggle('on', i < lvl));
      const endless = c.def.maxLevel === Infinity;
      c.lvl.textContent = endless && lvl > c.def.pips ? `LV ${lvl}` : endless && lvl === c.def.pips ? '∞' : '';
      c.lvl.classList.toggle('beyond', endless && lvl > c.def.pips);
      c.cur.textContent = c.def.valueLabel(lvl);
      c.next.textContent = maxed ? '' : c.def.valueLabel(lvl + 1);
      c.arrow.style.display = maxed ? 'none' : '';
      c.root.classList.toggle('maxed', maxed);
      // Plow-exclusive upgrades are dimmed (still buyable) while driving the other plow.
      c.root.classList.toggle('inactive', !!c.def.plowOnly && c.def.plowOnly !== plow);
      c.root.classList.toggle('poor', !maxed && !afford);
      c.root.classList.toggle('afford', afford);
      // Duel garage: catch-up coins pay first (gift icon), then your own coins.
      const bonus = !!dw && !maxed && dw.paysWithBonus(c.def.id);
      c.buy.classList.toggle('ss-bonus-buy', bonus);
      c.buy.innerHTML = maxed ? (c.def.maxLevel === 1 ? '✓ OWNED' : '★ MAXED') : `${bonus ? '🎁' : '<span class="ss-coin sm"></span>'}${fmt(p.cost(c.def.id))}`;
      c.buy.title = bonus ? 'Paid with catch-up coins: yours to keep once the duel starts.' : '';
      c.buy.setAttribute('aria-disabled', afford ? 'false' : 'true');
    }
    garage.refreshTabs(this.garageDeps());
  }

  private refreshRepair(): void {
    const b = this.repairBtn;
    const o = this.survivalShop;
    if (!b || !o) return;
    const need = o.canRepair();
    const afford = this.ctx.progression.coins >= o.repairCost;
    b.disabled = !need;
    b.classList.toggle('poor', need && !afford);
    b.innerHTML = need
      ? `🔧 FULL REPAIR <span class="ss-coin sm"></span>${fmt(o.repairCost)}`
      : '🔧 PLOW AT FULL HP';
  }

  private renderSurvivalPreview(o: SurvivalShopOpts): void {
    const w = this.shopPreview;
    const next = o.cleared + 1;
    w.textContent = '';
    w.classList.remove('hidden');
    w.classList.toggle('boss', !!o.nextBoss);
    const t = el('div', 'ss-rp-title', undefined, w);
    t.innerHTML = `Wave <b>${next}</b> next${o.nextBoss ? ` · ☠ BOSS: ${o.nextBoss}` : o.nextSpecial ? ` · ${o.nextSpecial.icon} ${o.nextSpecial.name}` : ''}`;
    if (o.nextSpecial && !o.nextBoss) el('div', 'ss-sv-special', o.nextSpecial.blurb, w);
    const daily = activeDaily();
    if (daily) renderDailyShopTag(w, daily);
    if (o.loot) renderLoot(w, [o.loot]);
    const row = el('div', 'ss-sv-shoprow', undefined, w);
    this.repairBtn = this.btn('', 'ss-ice ss-sv-repair', () => {
      const ok = o.onRepair();
      this.sfx(ok ? 'buy' : 'error');
      if (!ok && this.repairBtn) restart(this.repairBtn, 'shake');
      this.refreshRepair();
    }, row, null);
    el('span', 'ss-foot-hint', 'Upgrades apply to your plow right now. The next wave waits for you.', row);
    this.btn(`🏁 END RUN · bank wave ${o.cleared}`, 'ss-ice ss-sv-end', () => o.onEndRun(), row, null);
  }

  private openGarage(back: 'menu' | 'quit'): void {
    this.garageBack = back;
    this.shopContinue = null;
    this.survivalShop = null;
    this.repairBtn = null;
    this.shopStart.innerHTML = '⚔ FIGHT ▶';
    this.shopHint.textContent = 'Press ENTER to fight';
    this.shopTitle.textContent = 'GARAGE';
    this.shopSub.textContent = 'Core upgrades never max out. Gear: buy items, level them up and equip as many as you like.';
    this.shopPreview.classList.add('hidden');
    this.plowPick.classList.remove('hidden');
    this.shopBack.classList.remove('hidden');
    this.shopStart.classList.add('hidden');
    this.shopHint.classList.add('hidden');
    delete this.shopStart.dataset.primary;
    this.shopBack.dataset.primary = '1';
    this.refreshCards();
    this.show('garage');
    // Phone width: the plow picker is one swipeable row; bring the plow being driven into it (after show() has reset
    // the scroll). Only the row scrolls sideways, so the panel itself stays at its top.
    setTimeout(() => garage.scrollPlowIntoView(this.garageDeps()), 40);
  }

  /* ================================================================== pause */

  private buildPause(): void {
    const s = this.screen('pause', 'ss-center ss-dim');
    const panel = el('div', 'ss-panel ss-glass ss-pause ss-icicles', undefined, s);
    el('h2', 'ss-h2', 'PAUSED', panel);
    this.pauseSub = el('div', 'ss-sub', 'The bots are politely idling their engines.', panel);
    const btns = el('div', 'ss-stack', undefined, panel);
    this.btn('▶ RESUME', 'ss-primary ss-big', () => this.handlers.onResume(), btns).dataset.primary = '1';
    const mute = this.btn('', 'ss-ice', () => {
      this.handlers.onToggleMute();
      this.refreshMute();
    }, btns);
    this.muteBtns.push(mute);
    this.btn('⚙ SETTINGS', 'ss-ice', () => this.settings.open(), btns, null);
    this.pauseQuit = this.btn('⏏ QUIT TO MENU', 'ss-ice ss-danger', () => this.handlers.onQuitToMenu(), btns);
    this.controlsList(panel).classList.add('compact');
    this.refreshMute();
  }

  /* ================================================================== result */

  private buildResult(): void {
    const s = this.screen('result', 'ss-center ss-dim');
    this.resultPanel = el('div', 'ss-panel ss-glass ss-result ss-icicles', undefined, s);
  }

  private renderResult(sum: RunSummary, win: boolean): void {
    results.renderResult({
      ctx: this.ctx, handlers: this.handlers, resultPanel: this.resultPanel, btn: this.btnFn, story: this.story,
      openGarage: (back) => this.openGarage(back),
    }, sum, win);
  }

  /* ================================================================== brawl lobby */

  private buildLobby(): void {
    const s = this.screen('lobby', 'ss-center ss-dim ss-lobby-screen');
    this.lobbyPanel = el('div', 'ss-panel ss-glass ss-lobby ss-icicles', undefined, s);
  }

  private renderLobby(): void {
    brawl.renderLobby({
      ctx: this.ctx, handlers: this.handlers, lobbyPanel: this.lobbyPanel, sfx: (n) => this.sfx(n), btn: this.btnFn,
      showMainMenu: () => this.showMainMenu(),
    });
  }

  /* ================================================================== brawl results */

  private buildBrawlResult(): void {
    const s = (this.bresultScreen = this.screen('bresult', 'ss-center ss-dim ss-bresult-screen'));
    this.bresultPanel = el('div', 'ss-panel ss-glass ss-bresult ss-icicles', undefined, s);
  }

  private renderBrawlResult(r: BrawlResult): void {
    brawl.renderBrawlResult({
      handlers: this.handlers, bresultScreen: this.bresultScreen, bresultPanel: this.bresultPanel, btn: this.btnFn,
      openGarage: (back) => this.openGarage(back),
    }, r);
  }

  /* ================================================================== UIAPI */

  get overlayOpen(): boolean {
    return this.current !== null;
  }

  showMainMenu(): void {
    this.shopContinue = null;
    this.survivalShop = null;
    this.repairBtn = null;
    this.refreshProgress();
    this.refreshMute();
    this.show('menu');
  }

  showZoneSelect(): void {
    this.renderZones();
    this.show('zones');
  }

  showGarage(): void {
    this.openGarage('menu');
  }

  showShop(nextRound: number, totalRounds: number, onContinue: () => void): void {
    this.shopContinue = onContinue;
    this.survivalShop = null;
    this.repairBtn = null;
    this.shopStart.innerHTML = '⚔ FIGHT ▶';
    this.shopHint.textContent = 'Press ENTER to fight';
    this.shopTitle.textContent = 'UPGRADE SHOP';
    const cleared = Math.max(1, nextRound - 1);
    this.shopSub.textContent = `${this.ctx.zone?.name ?? ''}: round ${cleared} cleared! Gear up before the next fight.`;
    garage.renderRoundPreview(this.garageDeps(), nextRound, totalRounds);
    this.plowPick.classList.add('hidden');
    this.shopBack.classList.add('hidden');
    this.shopStart.classList.remove('hidden');
    this.shopHint.classList.remove('hidden');
    delete this.shopBack.dataset.primary;
    this.shopStart.dataset.primary = '1';
    this.refreshCards();
    this.show('garage');
  }

  showSurvivalShop(o: SurvivalShopOpts): void {
    this.shopContinue = () => {
      this.survivalShop = null;
      this.repairBtn = null;
      o.onContinue();
    };
    this.survivalShop = o;
    this.shopTitle.textContent = 'PIT STOP';
    this.shopSub.textContent = `Wave ${o.cleared} cleared! Spend your coins before the next wave.`;
    this.renderSurvivalPreview(o);
    this.plowPick.classList.add('hidden');
    this.shopBack.classList.add('hidden');
    this.shopStart.classList.remove('hidden');
    this.shopStart.innerHTML = 'NEXT WAVE ▶';
    this.shopHint.classList.remove('hidden');
    this.shopHint.textContent = 'Press ENTER for the next wave';
    delete this.shopBack.dataset.primary;
    this.shopStart.dataset.primary = '1';
    this.refreshCards();
    this.show('garage');
  }

  showBrawlLobby(): void {
    this.shopContinue = null;
    this.renderLobby();
    this.show('lobby');
  }

  showBrawlResults(result: BrawlResult): void {
    this.renderBrawlResult(result);
    this.show('bresult');
  }

  showPause(duel = false): void {
    this.refreshMute();
    // Online duel: the match keeps running behind the menu.
    this.pauseSub.textContent = duel ? 'Online duel: the match is still running! Your plow is idling.' : 'The bots are politely idling their engines.';
    this.pauseQuit.innerHTML = duel ? '⏏ LEAVE DUEL' : '⏏ QUIT TO MENU';
    this.show('pause');
  }

  /** Pre-match DUEL GARAGE: the normal Garage, buying through `wallet` (catch-up coins first). DuelUI's strip on top
   *  has the timer, the garage numbers and READY, so the Garage's own BACK / FIGHT footer is hidden. */
  showDuelGarage(wallet: DuelWallet, info: { ownPower: number; oppPower: number; bonus: number }): void {
    this.duelWalletOff?.();
    this.duelWallet = wallet;
    this.duelWalletOff = wallet.onChange(() => this.refreshCards());
    this.shopContinue = null;
    this.survivalShop = null;
    this.repairBtn = null;
    this.shopTitle.textContent = 'DUEL GARAGE';
    this.shopSub.textContent =
      `Opponent garage: ${fmt(info.oppPower)} · Yours: ${fmt(info.ownPower)} · Catch-up: +${fmt(info.bonus)}. ` +
      (info.bonus > 0 ? 'Catch-up coins (🎁) pay first for upgrades or gear, and what they buy is yours to keep; then your own coins pay as usual.' : 'Your own coins buy permanent upgrades and gear as usual.');
    this.shopPreview.classList.add('hidden');
    this.plowPick.classList.add('hidden');
    this.shopBack.classList.add('hidden');
    this.shopStart.classList.add('hidden');
    this.shopHint.classList.add('hidden');
    delete this.shopStart.dataset.primary;
    delete this.shopBack.dataset.primary;
    this.screens.garage.classList.add('ss-duel-garage-screen');
    this.refreshCards();
    this.show('garage');
  }

  hideDuelGarage(): void {
    if (!this.duelWallet) return;
    this.screens.garage.classList.remove('ss-duel-garage-screen');
    this.duelWalletOff?.();
    this.duelWalletOff = null;
    this.duelWallet = null;
    if (this.current === 'garage') this.hideOverlays();
    this.refreshProgress();
  }

  /** Duel HUD mode: the campaign arena / coin / snow panels make way for DuelUI's top bar. */
  setDuelHud(on: boolean): void {
    this.gameHud.setDuelHud(on);
  }

  showGameOver(summary: RunSummary): void {
    this.renderResult(summary, false);
    this.show('result');
  }

  showVictory(summary: RunSummary): void {
    this.renderResult(summary, true);
    this.show('result');
  }

  hideOverlays(): void {
    for (const k in this.screens) {
      const s = this.screens[k as ScreenName];
      s.classList.remove('show');
      s.setAttribute('aria-hidden', 'true');
    }
    this.current = null;
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== document.body && a.blur) a.blur();
  }

  setHudVisible(visible: boolean): void {
    this.gameHud.setHudVisible(visible);
  }

  bossIntro(name: string, title: string): void {
    this.gameHud.bossIntro(name, title);
  }

  updateHud(s: HudState): void {
    this.gameHud.updateHud(s);
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' | 'big' | 'radio' = 'info'): void {
    if (kind === 'big') {
      const box = this.bigBox;
      for (const c of Array.from(box.children)) c.classList.add('old');
      while (box.children.length >= 2) box.firstElementChild!.remove();
      const t = el('div', 'ss-bigtoast', text, box);
      t.addEventListener('animationend', (e) => {
        if (e.target === t && e.animationName === 'ss-big-life') t.remove();
      });
      return;
    }
    const box = this.toastBox;
    const live = box.querySelectorAll('.ss-toast:not(.out)');
    if (live.length >= 4) this.killToast(live[0] as HTMLElement);
    const t = el('div', `ss-toast ${kind}`, text, box);
    t.addEventListener('animationend', (e) => {
      if (e.target === t && e.animationName === 'ss-toast-life') t.remove();
    });
  }

  private killToast(t: HTMLElement): void {
    t.classList.add('out');
    setTimeout(() => t.remove(), 260);
  }
}
