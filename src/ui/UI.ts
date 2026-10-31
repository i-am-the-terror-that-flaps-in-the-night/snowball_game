import './ui.css';
import './brawl.css';
import './challenges.css';
import type { BrawlDifficulty, BrawlEntry, BrawlResult, GameContext, HudBoss, HudState, RunSummary, SoundName, SurvivalShopOpts, UIAPI, UIHandlers } from '../core/types';
import { MIN_BALL_RADIUS } from '../core/types';
import { SHOP_UPGRADES, type UpgradeCategory, type UpgradeDef } from '../config/upgrades';
import { GEAR, GEAR_MAX_LEVEL, GEAR_SLOTS, RARITY_COLOR, grantLabel, type GearDef, type GearSlot } from '../config/gear';
import { PLOWS, type PlowKind } from '../config/plows';
import { ZONES, type ZoneDef } from '../config/zones';
import { ENEMIES, type EnemyDef, type EnemyType } from '../config/enemies';
import {
  BRAWL_BOTS, BRAWL_DIFFICULTIES, BRAWL_KILL_COINS, BRAWL_KILL_TARGET, BRAWL_PLACEMENT_BONUS, BRAWL_RESPAWN,
  BRAWL_SHUTDOWN_PER_STREAK, BRAWL_TIME, STREAK_TIERS,
} from '../config/brawl';
import { BrawlHudView, fmtMult } from './BrawlHud';
import { SettingsMenu } from './Settings';
import { ACTIONS, keyLabel, type Action } from '../core/input';
import { survivalBest, survivalUnlocked } from '../survival/SurvivalManager';
import { StyleShop } from './StyleShop';
import { Trophies } from './Trophies';
import { activeDaily, dailyButtonLabel } from '../meta/daily';
import { renderDailyResult, renderDailyShopTag } from './DailyResult';
import {
  HARD, earnedIds, hardCleared, hardReward, hardUnlocked, lastChallengeReport, maxStars, starReward, zoneChallenges, zoneStars,
} from '../meta/challenges';
import { achievementCount, totalStars } from '../meta/progress';
import { ACHIEVEMENTS } from '../config/achievements';
import { DuelUI } from './DuelUI';
import type { DuelWallet, ShopWallet } from '../duel/DuelWallet';

type ScreenName = 'menu' | 'zones' | 'garage' | 'howto' | 'pause' | 'result' | 'lobby' | 'bresult';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/** Restart a one-shot CSS animation class. */
function restart(e: HTMLElement, cls: string, ...others: string[]): void {
  e.classList.remove(cls, ...others);
  void e.offsetWidth;
  e.classList.add(cls);
}

type ShopTabId = 'core' | 'gear' | 'line';

/** Garage tabs, each listing one or more upgrade categories. 'line' only shows the driven plow's own line
 *  (category id === PlowKind), and takes that plow's name and icon. */
const SHOP_TABS: { id: ShopTabId; label: string; icon: string; blurb: string; groups: { cat: UpgradeCategory; title?: string }[] }[] = [
  { id: 'core', label: 'Core', icon: '⚙️', blurb: 'The four core upgrades: speed, slam power, ball size and HP. They never max out.', groups: [{ cat: 'plow' }, { cat: 'ball' }, { cat: 'defense' }] },
  { id: 'gear', label: 'Gear', icon: '🎒', blurb: 'Buy items, level them up to 10 and equip one per slot. Gear works on every plow.', groups: [] },
  { id: 'line', label: 'Plow', icon: '🚜', blurb: '', groups: [{ cat: 'classic' }, { cat: 'volt' }, { cat: 'brute' }, { cat: 'isotope' }, { cat: 'arsenal' }] },
];

const ENEMY_ICON: Record<EnemyType, string> = {
  scrapper: '🤖', brute: '🚧', spinner: '🪚', thief: '🦝',
  bulldoza: '🚜', frostbyte: '👾', grinder: '🔩', slush: '🔴', sleet: '🔵', omega: '💀', rival: '🚜', rallybot: '🧢', donald: '🍊',
};

const ENEMY_TIP: Partial<Record<EnemyType, string>> = {
  scrapper: 'FAST', brute: 'FRONT ARMOR', spinner: 'OVERHEATS', thief: 'STEALS SNOW', rallybot: 'RALLY BUFF',
};

/** Controls cheat-sheet. Action rows show the player's current (rebindable) keys; other rows are literal labels. */
const CONTROLS: [string[], string][] = [
  [['forward'], 'Accelerate'],
  [['back'], 'Brake / reverse'],
  [['left', 'right'], 'Steer'],
  [['slam'], 'SLAM snowball'],
  [['dash'], 'DASH STRIKE (long burst)'],
  [['whirl'], 'Whirlwind tornado'],
  [['ability'], 'Inferno (Classic) / Thunderclap (VOLT-9) / Ground Pound (BRUTUS)'],
  [['pause'], 'Pause'],
  [['M'], 'Mute sound'],
];
const ACTION_IDS = new Set<string>(ACTIONS.map((a) => a.id));
const PAD_LINE = '🎮 Gamepad: left stick drive · A slam · B/RB dash · X whirl · Y F-ability · START pause';

function tierName(r: number): string {
  if (r < 0.6) return 'Snowball';
  if (r < 1.0) return 'Boulder';
  if (r < 1.6) return 'Avalanche';
  if (r < 2.4) return 'Glacier';
  return 'SNOWPOCALYPSE';
}
function tierIndex(r: number): number {
  return r < 0.6 ? 0 : r < 1.0 ? 1 : r < 1.6 ? 2 : r < 2.4 ? 3 : 4;
}

function ordinal(n: number): string {
  const v = n % 100;
  const suf = v >= 11 && v <= 13 ? 'TH' : ['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH';
  return `${n}${suf}`;
}
function fmtTime(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const DEF_BY_NAME = new Map<string, EnemyDef>(Object.values(ENEMIES).map((d) => [d.name, d] as [string, EnemyDef]));

/** True for saturated, mid-lightness colors that read well as a health bar. */
function vivid(n: number): boolean {
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d === 0) return false;
  const l = (mx + mn) / 2;
  const s = d / (1 - Math.abs(2 * l - 1));
  return s > 0.45 && l > 0.28 && l < 0.75;
}
function bossColor(def?: EnemyDef): string {
  if (def) {
    if (vivid(def.color)) return hex(def.color);
    if (vivid(def.accent)) return hex(def.accent);
  }
  return '#ff2f4c';
}
function zoneBossDef(z: ZoneDef): EnemyDef | undefined {
  for (const r of z.rounds) if (r.boss) for (const g of r.groups) if (ENEMIES[g.type].isBoss) return ENEMIES[g.type];
  return undefined;
}

/** Challenge stars as HTML: `got` gold (the last `fresh` of them pop in), the rest of `total` empty. */
function starsHtml(got: number, fresh = 0, total = 3): string {
  let h = '';
  for (let i = 0; i < total; i++) h += `<i class="ss-star ${i < got ? (i >= got - fresh ? 'on fresh' : 'on') : 'off'}">★</i>`;
  return h;
}

interface CardRefs {
  def: UpgradeDef;
  tab: ShopTabId;
  root: HTMLElement;
  pips: HTMLElement[];
  /** "LV n" badge for endless upgrades past their pips. */
  lvl: HTMLElement;
  cur: HTMLElement;
  next: HTMLElement;
  arrow: HTMLElement;
  buy: HTMLButtonElement;
}

interface GearCardRefs {
  def: GearDef;
  root: HTMLElement;
  lvl: HTMLElement;
  grants: HTMLElement;
  buy: HTMLButtonElement;
  equip: HTMLButtonElement;
}

interface BossSlot {
  /** '' = free. */
  key: string;
  root: HTMLElement;
  inner: HTMLElement;
  badge: HTMLElement;
  name: HTMLElement;
  title: HTMLElement;
  phase: HTMLElement;
  hp: HTMLElement;
  fill: HTMLElement;
  chip: HTMLElement;
  frac: number;
  hpVal: number;
  /** performance.now() when destroyed (bar lingers), 0 otherwise. */
  down: number;
  mark: boolean;
}

const GAUGE_R = 46;
const GAUGE_C = 2 * Math.PI * GAUGE_R;
const INTRO_MS = 2600;

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
  /** Paint shop (cosmetics) and Trophies (achievements + stats) overlays. */
  private styleShop!: StyleShop;
  private trophies!: Trophies;

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
  private cards: CardRefs[] = [];
  /** Garage tabs: open tab, tab buttons, their panes and the plow-line sections (one per plow). */
  private shopTab: ShopTabId = 'core';
  private gearCards: GearCardRefs[] = [];
  private gearSlotLabels = new Map<GearSlot, HTMLElement>();
  private tabBtns = new Map<ShopTabId, { btn: HTMLButtonElement; icon: HTMLElement; label: HTMLElement; badge: HTMLElement }>();
  private tabPanes = new Map<ShopTabId, HTMLElement>();
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
  private bh!: BrawlHudView;

  // hud
  private hud!: HTMLElement;
  private hudVisible = false;
  private bossSlots: BossSlot[] = [];
  private h = {} as {
    zone: HTMLElement; round: HTMLElement; enemies: HTMLElement; pips: HTMLElement;
    bosses: HTMLElement;
    coins: HTMLElement; coinBox: HTMLElement;
    combo: HTMLElement; comboN: HTMLElement;
    hpBox: HTMLElement; hpNum: HTMLElement; hpFill: HTMLElement; hpChip: HTMLElement;
    batt: HTMLElement; battFill: HTMLElement; crit: HTMLElement; critFill: HTMLElement;
    gauge: HTMLElement; ring: SVGCircleElement; radius: HTMLElement; tier: HTMLElement;
    slam: HTMLElement; shield: HTMLElement; blocked: HTMLElement;
    dash: HTMLElement; whirl: HTMLElement; flame: HTMLElement;
    heat: HTMLElement; heatFill: HTMLElement; heatTxt: HTMLElement;
    snowFill: HTMLElement; snowTxt: HTMLElement;
    count: HTMLElement; hint: HTMLElement;
  };
  private last = {
    zone: '', round: -1, total: -1, bossRound: false, enemies: -1,
    coins: -1, plowHp: -1, plowMax: -1, plowF: -1, low: false, mid: false,
    ballR: -1, ballFrac: -1, tier: -1, ready: false, full: false, held: false,
    dash: -1, whirl: -2, flame: -2, fKind: '', crit: -2, batt: -2, heat: -2, heatCost: -1, combo: 0, comboTier: -1, snow: -1, count: -1, bossCount: -1, brawl: -1, hideRound: false,
  };
  private hintTimer = 0;

  // fx
  private vignette!: HTMLElement;
  private toastBox!: HTMLElement;
  private bigBox!: HTMLElement;
  private intro!: HTMLElement;
  private introName!: HTMLElement;
  private introTitle!: HTMLElement;
  private introTimer = 0;

  constructor(ctx: GameContext, root: HTMLElement, handlers: UIHandlers) {
    this.ctx = ctx;
    this.handlers = handlers;
    this.rootEl = el('div', 'ss-root', undefined, root);

    this.vignette = el('div', 'ss-vignette', undefined, this.rootEl);
    this.buildHud();
    this.buildIntro();
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
    this.refreshKeys();
    this.toastBox = el('div', 'ss-toasts', undefined, this.rootEl);
    this.bigBox = el('div', 'ss-bigtoasts', undefined, this.rootEl);

    ctx.progression.onChange(() => this.refreshProgress());
    ctx.events.on('plowDamaged', ({ amount, blocked }) => this.pulse(amount, blocked));
    ctx.events.on('bossPhase', ({ name, label }) => this.onBossPhase(name, label));

    window.addEventListener('keydown', (e) => this.onKey(e));
    this.refreshProgress();
  }

  /* ================================================================== helpers */

  private sfx(name: SoundName): void {
    this.ctx.audio?.play(name);
  }

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
      this.endIntro();
    }
    const target = this.screens[name].querySelector<HTMLButtonElement>('[data-primary]:not(.hidden)');
    const a = document.activeElement as HTMLElement | null;
    if (a && a.blur) a.blur();
    if (target) setTimeout(() => this.current === name && target.focus({ preventScroll: true }), 30);
  }

  private controlsList(parent: HTMLElement): HTMLElement {
    const list = el('div', 'ss-controls', undefined, parent);
    this.controlLists.push(list);
    this.fillControls(list);
    return list;
  }

  /** Labels for a controls row: an action's bound keys (primary + fixed alternates), or the literal labels. */
  private rowKeys(keys: string[]): string[] {
    if (!keys.every((k) => ACTION_IDS.has(k))) return keys;
    if (keys.length > 1) return keys.map((a) => keyLabel(this.ctx.input.keysFor(a as Action)[0] ?? '?'));
    return this.ctx.input.keysFor(keys[0] as Action).map(keyLabel);
  }

  private fillControls(list: HTMLElement): void {
    list.replaceChildren();
    for (const [keys, label] of CONTROLS) {
      const row = el('div', 'ss-ctrl-row', undefined, list);
      const k = el('div', 'ss-keys', undefined, row);
      this.rowKeys(keys).forEach((key, i) => {
        if (i) el('span', 'ss-key-sep', '/', k);
        el('kbd', 'ss-kbd', key, k);
      });
      el('span', 'ss-ctrl-label', label, row);
    }
    el('div', 'ss-ctrl-pad', PAD_LINE, list);
  }

  /** Re-read key bindings into every on-screen key prompt (controls lists, HUD ability keys, first-run hint). */
  refreshKeys(): void {
    for (const list of this.controlLists) this.fillControls(list);
    if (!this.h.hint) return;
    const k = (a: Action) => keyLabel(this.ctx.input.keysFor(a)[0] ?? '?');
    const setKey = (ab: HTMLElement, a: Action) => {
      const kbd = ab.querySelector('.ss-ab-key');
      if (kbd) kbd.textContent = k(a);
    };
    setKey(this.h.dash, 'dash');
    setKey(this.h.whirl, 'whirl');
    setKey(this.h.flame, 'ability');
    this.h.hint.textContent = PLOWS[this.ctx.stats.plowKind]?.noBall
      ? `${k('forward')}/${k('back')} drive  ·  ${k('left')}/${k('right')} steer  ·  hold ${k('slam')} autocannon  ·  ` +
        `${k('dash')} dash strike  ·  ${k('whirl')} laser  ·  ${k('ability')} missiles  ·  ESC pause`
      : `${k('forward')}/${k('back')} drive  ·  ${k('left')}/${k('right')} steer  ·  plow snow to grow a ball  ·  ${k('slam')} slam  ·  ` +
        `${k('dash')} dash strike  ·  ${k('whirl')} whirlwind  ·  ${k('ability')} F-ability  ·  ESC pause`;
  }

  private coinPill(parent: HTMLElement, cls = ''): HTMLElement {
    const pill = el('div', `ss-coinpill ${cls}`, undefined, parent);
    el('span', 'ss-coin', undefined, pill);
    return el('span', 'ss-coin-val', '0', pill);
  }

  private refreshMute(): void {
    const muted = !!this.ctx.audio?.muted;
    for (const b of this.muteBtns) {
      b.innerHTML = muted ? '🔇 SOUND: OFF' : '🔊 SOUND: ON';
      b.classList.toggle('off', muted);
    }
  }

  private refreshProgress(): void {
    const p = this.ctx.progression;
    const c = fmt(p.coins);
    this.menuCoins.textContent = c;
    this.shopCoins.textContent = c;
    const cleared = ZONES.filter((z) => p.zoneRecord(z.id).cleared).length;
    const bw = p.data.brawlWins ?? 0;
    const bm = p.data.brawlMatches ?? 0;
    this.menuStats.textContent =
      `🏆 Arenas cleared ${cleared}/${ZONES.length}  ·  🤖 ${fmt(p.data.totalKills)} bots scrapped` +
      (bm > 0 ? `  ·  🥇 Brawl wins ${fmt(bw)}/${fmt(bm)}` : '') +
      `  ·  🏅\u00a0${achievementCount(p)}/${ACHIEVEMENTS.length}`;
    const sb = survivalBest(p);
    this.survivalBtn.innerHTML = survivalUnlocked(p)
      ? `♾ SURVIVAL${sb > 0 ? ` <small>best wave ${sb}</small>` : ''}`
      : '🔒 SURVIVAL <small>beat arena 1</small>';
    this.dailyBtn.innerHTML = survivalUnlocked(p) ? dailyButtonLabel(p) : '🔒 DAILY';
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
    if (name === 'garage' && (code === 'KeyQ' || code === 'KeyE' || code === 'PageUp' || code === 'PageDown')) {
      e.preventDefault();
      this.cycleShopTab(code === 'KeyQ' || code === 'PageUp' ? -1 : 1);
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
        scr.querySelector<HTMLButtonElement>('[data-primary]:not(.hidden)')?.click();
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
    i = i < 0 ? (dir > 0 ? 0 : btns.length - 1) : (i + dir + btns.length) % btns.length;
    const next = btns[i];
    next.focus();
    next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /* ================================================================== main menu */

  private buildMenu(): void {
    const s = this.screen('menu', 'ss-menu');
    const panel = el('div', 'ss-menu-panel ss-glass ss-icicles', undefined, s);
    const title = el('h1', 'ss-title', undefined, panel);
    el('span', 'ss-title-a', 'SNOWPLOW', title);
    el('span', 'ss-title-b', 'SHOWDOWN', title);
    el('p', 'ss-tagline', 'Plow it. Pack it. Slam it.', panel);
    this.menuCoins = this.coinPill(panel, 'ss-menu-coins');

    const btns = el('div', 'ss-menu-btns', undefined, panel);
    this.btn('⚔ FIGHT', 'ss-primary ss-big', () => this.showZoneSelect(), btns).dataset.primary = '1';
    this.btn('🔥 BRAWL <span class="ss-new">NEW</span>', 'ss-hot ss-big', () => this.showBrawlLobby(), btns);
    const modes = el('div', 'ss-menu-row', undefined, btns);
    this.survivalBtn = this.btn('', 'ss-ice', () => {
      if (survivalUnlocked(this.ctx.progression)) this.handlers.onStartSurvival?.();
      else this.toast(`Beat ${ZONES[0].name} to unlock Survival`, 'bad');
    }, modes);
    this.dailyBtn = this.btn('', 'ss-ice', () => {
      if (survivalUnlocked(this.ctx.progression)) this.handlers.onStartDaily?.();
      else this.toast(`Beat ${ZONES[0].name} to unlock the Daily run`, 'bad');
    }, modes);
    const shops = el('div', 'ss-menu-row', undefined, btns);
    this.btn('🔧 GARAGE', 'ss-ice', () => this.openGarage('menu'), shops);
    this.btn('🎨 PAINT SHOP', 'ss-ice', () => this.styleShop.open(), shops, null);
    const info = el('div', 'ss-menu-row', undefined, btns);
    this.btn('🏆 TROPHIES', 'ss-ice', () => this.trophies.open(), info, null);
    this.btn('❓ HOW TO PLAY', 'ss-ice', () => this.show('howto'), info);
    const misc = el('div', 'ss-menu-row', undefined, btns);
    this.btn('⚙ SETTINGS', 'ss-ice', () => this.settings.open(), misc, null);
    this.btn('🎓 TUTORIAL', 'ss-ice', () => this.handlers.onStartTutorial?.(), misc);
    const row = el('div', 'ss-menu-row', undefined, btns);
    this.btn('🤺 DUEL <small>online 1v1</small>', 'ss-hot ss-duel-menu', () => this.handlers.onOpenDuel?.(), row);
    const mute = this.btn('', 'ss-ice ss-small', () => {
      this.handlers.onToggleMute();
      this.refreshMute();
    }, row);
    this.muteBtns.push(mute);
    // Save reset / export / import live in ⚙ SETTINGS → Save data.

    this.menuStats = el('div', 'ss-menu-stats', '', panel);
    el('div', 'ss-credits', 'PvE arena brawler · Three.js · procedural everything', panel);
    this.refreshMute();
  }

  /* ================================================================== how to play */

  private buildHowTo(): void {
    const s = this.screen('howto', 'ss-center ss-dim');
    const panel = el('div', 'ss-panel ss-glass ss-howto ss-icicles', undefined, s);
    el('h2', 'ss-h2', 'HOW TO PLAY', panel);
    const cols = el('div', 'ss-howto-cols', undefined, panel);
    const left = el('div', 'ss-howto-col', undefined, cols);
    el('h3', 'ss-h3', 'Controls', left);
    this.controlsList(left);
    const right = el('div', 'ss-howto-col', undefined, cols);
    el('h3', 'ss-h3', 'The Brawl', right);
    const steps: [string, string, string][] = [
      ['🚜', 'Plow it', 'Drive through deep snow. Your blade packs it into a snowball that grows on the front of your plow.'],
      ['🛡️', 'Pack it', 'A held ball is your shield too. It blocks part of every hit that comes at your front, so face the danger.'],
      ['💥', 'SLAM it', 'Get up close and press SPACE to smash the ball into bots. Bigger balls hit WAY harder. A Glacier flattens what a Snowball only tickles.'],
      ['⚡', 'DASH STRIKE', 'SHIFT launches a long, blistering burst that smashes straight through bots like a truck. Use it to finish, to escape, or to dodge boss charges.'],
      ['🌀', 'Whirlwind', 'E spins up a snow tornado (always available): it pulls nearby bots in, shreds them with repeated hits, blasts them out and sucks up snow into your ball.'],
      ['🏎️', 'Ram', 'Ramming bots at speed hurts them too. Faster closing speed = bigger hit.'],
      ['⚠️', 'Read the boss', 'Bosses telegraph big attacks with red stripes and rings. Dodge, then punish them while they are stunned or dizzy.'],
      ['🪙', 'Upgrade', 'Scrapped bots drop coins. Spend them between rounds and in the Garage. You keep your coins even if you get wrecked.'],
    ];
    const list = el('div', 'ss-steps', undefined, right);
    for (const [icon, t, d] of steps) {
      const row = el('div', 'ss-step', undefined, list);
      el('div', 'ss-step-icon', icon, row);
      const tx = el('div', 'ss-step-text', undefined, row);
      el('b', '', t, tx);
      el('span', '', d, tx);
    }
    el('h3', 'ss-h3 ss-howto-brawl-h', '🔥 Snowdome Brawl', right);
    const bl = el('div', 'ss-step ss-howto-brawl', undefined, right);
    el('div', 'ss-step-icon', '🏟️', bl);
    const bt = el('div', 'ss-step-text', undefined, bl);
    el('b', '', 'Free-for-all in a huge arena', bt);
    el(
      'span',
      '',
      `You + ${BRAWL_BOTS} rival plows, everyone hunting everyone. ${fmtTime(BRAWL_TIME)} or first to ${BRAWL_KILL_TARGET} kills. ` +
        `Wrecked plows respawn in ${BRAWL_RESPAWN}s. Kill streaks multiply your coins (up to ${fmtMult(STREAK_TIERS[STREAK_TIERS.length - 1].mult)}), ` +
        'ending a rival\'s streak pays a shutdown bounty, and top placements earn a bonus.',
      bt,
    );
    const foot = el('div', 'ss-panel-foot', undefined, panel);
    this.btn('◀ BACK', 'ss-primary', () => this.showMainMenu(), foot).dataset.primary = '1';
  }

  /* ================================================================== arena select */

  private buildZones(): void {
    const s = this.screen('zones', 'ss-center ss-dim');
    const panel = el('div', 'ss-panel ss-glass ss-zones ss-icicles', undefined, s);
    const head = el('div', 'ss-zones-head', undefined, panel);
    el('h2', 'ss-h2', 'CHOOSE YOUR ARENA', head);
    this.zoneStarTotal = el('div', 'ss-star-total', '', head);
    this.zoneStarTotal.title = 'Challenge stars: 3 per arena. Each new star pays coins.';
    this.zoneGrid = el('div', 'ss-zone-grid', undefined, panel);
    const foot = el('div', 'ss-panel-foot', undefined, panel);
    this.btn('◀ BACK', 'ss-ice', () => this.showMainMenu(), foot);
  }

  private renderZones(): void {
    const p = this.ctx.progression;
    this.zoneGrid.textContent = '';
    this.zoneStarTotal.innerHTML = `<span class="ss-star-ico">★</span> ${totalStars(p)}<small>/${maxStars()}</small>`;
    let firstPlayable: HTMLButtonElement | null = null;
    ZONES.forEach((z, i) => {
      const unlocked = p.isZoneUnlocked(i);
      const rec = p.zoneRecord(z.id);
      const total = z.rounds.length;
      // Slot = arena card + its Hard-mode strip (a separate button: buttons can't nest).
      const slot = el('div', 'ss-zone-slot', undefined, this.zoneGrid);
      const card = el('button', `ss-zone ${unlocked ? '' : 'locked'} ${rec.cleared ? 'cleared' : ''}`, undefined, slot);
      card.type = 'button';
      card.style.setProperty('--sky-top', hex(z.skyTop));
      card.style.setProperty('--sky-bottom', hex(z.skyBottom));
      const bdef = zoneBossDef(z);
      card.style.setProperty('--bc', bossColor(bdef));
      el('div', 'ss-zone-num', String(i + 1), card);
      const top = el('div', 'ss-zone-top', undefined, card);
      el('div', 'ss-zone-name', z.name, top);
      el('div', 'ss-zone-tag', z.tagline, top);

      const boss = el('div', 'ss-zone-boss', undefined, card);
      el('div', 'ss-zone-boss-badge', '💀', boss);
      const bt = el('div', 'ss-zone-boss-text', undefined, boss);
      el('small', '', bossCount(z) > 1 ? 'BOSSES' : 'BOSS', bt);
      el('b', '', z.bossName, bt);

      const bottom = el('div', 'ss-zone-bottom', undefined, card);
      if (rec.cleared) {
        const badges = el('div', 'ss-zone-badges', undefined, bottom);
        el('div', 'ss-zone-badge', '✓ CLEARED', badges);
        if (hardCleared(p, i)) el('div', 'ss-zone-skull', '💀 HARD', badges).title = 'Hard mode beaten';
      }
      this.zoneChallengeList(i, bottom);
      const best = Math.min(rec.bestRound, total);
      el('div', 'ss-zone-stat', `⚔ ${total - 1} + boss  ·  🏁 ${best > 0 ? `best ${best}/${total}` : 'best —'}`, bottom);
      el('div', 'ss-zone-stat ss-zone-reward', `🪙 ${fmt(rec.cleared ? Math.round(z.clearReward * 0.4) : z.clearReward)} clear reward`, bottom);
      if (!unlocked) {
        const lock = el('div', 'ss-zone-lock', undefined, card);
        el('div', 'ss-lock-icon', '🔒', lock);
        const prev = ZONES[i - 1];
        el('div', 'ss-lock-text', prev ? `Defeat ${prev.bossName} in ${prev.name} to unlock` : 'Locked', lock);
      }
      card.addEventListener('click', () => {
        if (!unlocked) {
          this.sfx('error');
          restart(card, 'shake');
          return;
        }
        this.sfx('click');
        this.handlers.onStartZone(i);
      });
      this.zoneHardStrip(i, slot);
      if (unlocked && !rec.cleared && !firstPlayable) firstPlayable = card;
      if (unlocked && i === p.data.unlockedZones - 1) firstPlayable = card;
    });
    const fp = firstPlayable as HTMLButtonElement | null;
    this.zoneGrid.querySelectorAll('[data-primary]').forEach((n) => delete (n as HTMLElement).dataset.primary);
    if (fp) fp.dataset.primary = '1';
  }

  /** Zone card: ★★☆ and the arena's three challenge goals, earned ones ticked (full name + goal on hover). */
  private zoneChallengeList(zoneIndex: number, parent: HTMLElement): void {
    const p = this.ctx.progression;
    const got = earnedIds(p, zoneIndex);
    const n = zoneStars(p, zoneIndex);
    const box = el('div', `ss-zone-chals ${n >= 3 ? 'all' : ''}`, undefined, parent);
    const head = el('div', 'ss-zone-chal-head', undefined, box);
    el('span', 'ss-zone-stars', undefined, head).innerHTML = starsHtml(n);
    el('small', '', `+${fmt(starReward(zoneIndex))} 🪙 / star`, head);
    for (const c of zoneChallenges(zoneIndex)) {
      const done = got.has(c.id);
      const row = el('div', `ss-zone-chal ${done ? 'done' : ''}`, undefined, box);
      el('span', 'ss-zone-chal-mark', done ? '✓' : c.icon, row);
      el('span', 'ss-zone-chal-goal', c.goal, row);
      row.title = `${c.name}: ${c.goal}${done ? ' ✓' : ''}`;
    }
  }

  /** Under each card: the HARD button once the arena is cleared (💀 ✓ once beaten), a locked hint before that. */
  private zoneHardStrip(zoneIndex: number, slot: HTMLElement): void {
    const p = this.ctx.progression;
    const tip =
      `Hard mode: bots ×${HARD.hpMult} HP, ×${HARD.dmgMult} damage, +${Math.round((HARD.minionMult - 1) * 100)}% minions. ` +
      `×${HARD.coinMult} coins. Stars count here too.`;
    if (!hardUnlocked(p, zoneIndex)) {
      const s = el('div', 'ss-zone-hard locked', undefined, slot);
      s.innerHTML = '🔒 <b>HARD</b> <small>clear to unlock</small>';
      s.title = tip;
      return;
    }
    const beaten = hardCleared(p, zoneIndex);
    const b = this.btn(
      `💀 <b>HARD</b> <small>${beaten ? '✓ · ' : ''}🪙 ${fmt(hardReward(p, zoneIndex))}</small>`,
      `ss-zone-hard ${beaten ? 'beaten' : ''}`,
      () => this.handlers.onStartZone(zoneIndex, true),
      slot,
    );
    b.title = tip;
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
    for (const t of SHOP_TABS) {
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
    for (const t of SHOP_TABS) {
      const pane = el('div', `ss-tab-pane ss-pane-${t.id}`, undefined, this.shopBody);
      pane.setAttribute('role', 'tabpanel');
      this.tabPanes.set(t.id, pane);
      for (const g of t.groups) {
        const sec = el('section', `ss-cat ss-cat-${g.cat}`, undefined, pane);
        if (g.title) el('h3', 'ss-cat-title', g.title, sec);
        const grid = el('div', 'ss-card-grid', undefined, sec);
        for (const def of SHOP_UPGRADES.filter((u) => u.category === g.cat)) this.cards.push(this.buildCard(def, t.id, grid));
        if (t.id === 'line') this.lineSections.set(g.cat, sec);
      }
      if (t.id === 'gear') this.buildGear(pane);
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
  private setShopTab(id: ShopTabId): void {
    const changed = id !== this.shopTab;
    this.shopTab = id;
    for (const [tid, t] of this.tabBtns) {
      t.btn.classList.toggle('on', tid === id);
      t.btn.setAttribute('aria-selected', tid === id ? 'true' : 'false');
    }
    for (const [tid, pane] of this.tabPanes) pane.classList.toggle('hidden', tid !== id);
    if (changed) this.shopBody.scrollTop = 0;
    this.refreshTabs();
  }

  /** Who the Garage buys through: the save, or the duel garage's wallet. */
  private get shop(): ShopWallet {
    return this.duelWallet ?? this.ctx.progression;
  }

  /** Tab labels, affordable-upgrade badges and the info line under the tabs. */
  private refreshTabs(): void {
    const p = this.shop;
    const plow = PLOWS[p.plow];
    const line = this.tabBtns.get('line');
    if (line) {
      line.icon.textContent = plow.icon;
      line.label.textContent = plow.name;
      line.btn.title = `${plow.name} upgrades`;
      line.btn.dataset.plow = plow.id;
    }
    for (const [cat, sec] of this.lineSections) sec.classList.toggle('hidden', cat !== plow.id);
    const affordable = new Map<ShopTabId, number>();
    for (const c of this.cards) {
      if (c.tab === 'line' && c.def.category !== plow.id) continue;
      if (!p.isMaxed(c.def.id) && p.canBuy(c.def.id)) affordable.set(c.tab, (affordable.get(c.tab) ?? 0) + 1);
    }
    // Gear is always bought with your own coins (never duel catch-up coins).
    const prog = this.ctx.progression;
    for (const g of this.gearCards) if (prog.itemCost(g.def.id) < Infinity && prog.canBuyItem(g.def.id)) affordable.set('gear', (affordable.get('gear') ?? 0) + 1);
    for (const [tid, t] of this.tabBtns) {
      const n = affordable.get(tid) ?? 0;
      t.badge.textContent = n ? String(n) : '';
    }
    const tab = SHOP_TABS.find((t) => t.id === this.shopTab)!;
    this.tabTraits.textContent = '';
    if (tab.id === 'line') {
      this.tabBlurb.textContent = `${plow.name} only: these upgrades work while you drive it.`;
      for (const t of plow.traits) el('li', '', t, this.tabTraits);
    } else {
      this.tabBlurb.textContent = tab.blurb;
    }
  }

  /** Q / E (gamepad LB / RB): previous / next Garage tab. */
  private cycleShopTab(dir: number): void {
    const i = SHOP_TABS.findIndex((t) => t.id === this.shopTab);
    this.setShopTab(SHOP_TABS[(i + dir + SHOP_TABS.length) % SHOP_TABS.length].id);
    this.sfx('click');
  }

  private buildCard(def: UpgradeDef, tab: ShopTabId, parent: HTMLElement): CardRefs {
    const root = el('div', 'ss-card', undefined, parent);
    root.dataset.id = def.id;
    if (def.details) root.title = def.details;
    el('div', 'ss-card-icon', def.icon, root);
    const info = el('div', 'ss-card-info', undefined, root);
    el('div', 'ss-card-name', def.name, info);
    el('div', 'ss-card-desc', def.description, info);
    const pipsEl = el('div', 'ss-pips', undefined, info);
    const pips: HTMLElement[] = [];
    for (let i = 0; i < def.pips; i++) pips.push(el('span', 'ss-pip', undefined, pipsEl));
    // Endless upgrades: a "LV n" badge past the pips.
    const lvl = el('span', 'ss-lvl', '', pipsEl);
    const val = el('div', 'ss-card-val', undefined, info);
    const cur = el('span', 'ss-val-cur', '', val);
    const arrow = el('span', 'ss-val-arrow', '→', val);
    const next = el('span', 'ss-val-next', '', val);
    const buy = el('button', 'ss-btn ss-buy', '', root);
    buy.type = 'button';
    buy.addEventListener('click', () => this.onBuy(def, root));
    return { def, tab, root, pips, lvl, cur, next, arrow, buy };
  }

  /** Gear tab: one section per slot, each with its items. */
  private buildGear(pane: HTMLElement): void {
    for (const slot of GEAR_SLOTS) {
      const sec = el('section', `ss-cat ss-gear-slot ss-gear-${slot.id}`, undefined, pane);
      const h = el('h3', 'ss-cat-title', `${slot.icon} ${slot.name}`, sec);
      this.gearSlotLabels.set(slot.id, el('span', 'ss-gear-eq', '', h));
      const grid = el('div', 'ss-card-grid', undefined, sec);
      for (const def of GEAR.filter((d) => d.slot === slot.id)) this.gearCards.push(this.buildGearCard(def, grid));
    }
  }

  private buildGearCard(def: GearDef, parent: HTMLElement): GearCardRefs {
    const root = el('div', `ss-card ss-gear-card ss-rarity-${def.rarity}`, undefined, parent);
    root.style.setProperty('--acc', RARITY_COLOR[def.rarity]);
    root.dataset.id = def.id;
    el('div', 'ss-card-icon', def.icon, root);
    const info = el('div', 'ss-card-info', undefined, root);
    const name = el('div', 'ss-card-name', def.name, info);
    el('span', 'ss-gear-rarity', def.rarity.toUpperCase(), name);
    el('div', 'ss-card-desc', def.description, info);
    const lvl = el('div', 'ss-gear-lvl', '', info);
    const grants = el('div', 'ss-card-val', '', info);
    const btns = el('div', 'ss-gear-btns', undefined, root);
    const buy = el('button', 'ss-btn ss-buy', '', btns) as HTMLButtonElement;
    buy.type = 'button';
    buy.addEventListener('click', () => {
      const p = this.ctx.progression;
      if (!p.buyItem(def.id)) {
        this.sfx('error');
        restart(root, 'shake');
        return;
      }
      this.sfx('buy');
      restart(root, 'bought');
    });
    const equip = el('button', 'ss-btn ss-ice ss-gear-equip', '', btns) as HTMLButtonElement;
    equip.type = 'button';
    equip.addEventListener('click', () => {
      if (this.ctx.progression.toggleEquip(def.id)) this.sfx('click');
    });
    return { def, root, lvl, grants, buy, equip };
  }

  private refreshGear(): void {
    const p = this.ctx.progression;
    for (const slot of GEAR_SLOTS) {
      const id = p.gear.equipped[slot.id];
      const def = id ? GEAR.find((d) => d.id === id) : undefined;
      this.gearSlotLabels.get(slot.id)!.textContent = def ? ` · equipped: ${def.icon} ${def.name}` : ' · empty slot';
    }
    for (const c of this.gearCards) {
      const lvl = p.itemLevel(c.def.id);
      const cost = p.itemCost(c.def.id);
      const maxed = cost === Infinity;
      const afford = !maxed && p.canBuyItem(c.def.id);
      const on = p.isEquipped(c.def.id);
      c.lvl.innerHTML = lvl ? `${'★'.repeat(lvl)}<span class="ss-gear-off">${'★'.repeat(GEAR_MAX_LEVEL - lvl)}</span> LV ${lvl}` : 'Not owned';
      const now = grantLabel(c.def, lvl || 1);
      const next = lvl && !maxed ? grantLabel(c.def, lvl + 1) : '';
      c.grants.textContent = next && next !== now ? `${now}  →  ${next}` : now;
      c.root.classList.toggle('owned', lvl > 0);
      c.root.classList.toggle('equipped', on);
      c.root.classList.toggle('maxed', maxed);
      c.root.classList.toggle('poor', !maxed && !afford);
      c.root.classList.toggle('afford', afford);
      c.buy.innerHTML = maxed ? '★ MAXED' : `${lvl ? '⬆ ' : ''}<span class="ss-coin sm"></span>${fmt(cost)}`;
      c.buy.title = lvl ? 'Level up' : 'Buy';
      c.buy.setAttribute('aria-disabled', afford ? 'false' : 'true');
      c.equip.classList.toggle('hidden', !lvl);
      c.equip.textContent = on ? '✓ EQUIPPED' : 'EQUIP';
    }
  }

  private onBuy(def: UpgradeDef, card: HTMLElement): void {
    const p = this.shop;
    if (p.isMaxed(def.id) || !p.canBuy(def.id)) {
      this.sfx('error');
      restart(card, 'shake');
      return;
    }
    if (p.buy(def.id)) {
      this.sfx('buy');
      restart(card, 'bought');
    }
  }

  private refreshCards(): void {
    const p = this.shop;
    const dw = this.duelWallet;
    if (dw) this.shopCoins.textContent = fmt(dw.coins);
    this.refreshRepair();
    this.refreshGear();
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
      c.buy.title = bonus ? 'Paid with catch-up coins: this level is for this duel only.' : '';
      c.buy.setAttribute('aria-disabled', afford ? 'false' : 'true');
    }
    this.refreshTabs();
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
    this.shopSub.textContent = 'Core upgrades never max out. Gear: buy items, level them up and equip one per slot.';
    this.shopPreview.classList.add('hidden');
    this.plowPick.classList.remove('hidden');
    this.shopBack.classList.remove('hidden');
    this.shopStart.classList.add('hidden');
    this.shopHint.classList.add('hidden');
    delete this.shopStart.dataset.primary;
    this.shopBack.dataset.primary = '1';
    this.refreshCards();
    this.show('garage');
  }

  private renderRoundPreview(nextRound: number, totalRounds: number): void {
    const w = this.shopPreview;
    const zone = this.ctx.zone;
    const round = zone?.rounds[nextRound - 1];
    const isBoss = !!round?.boss;
    w.textContent = '';
    w.classList.remove('hidden');
    w.classList.toggle('boss', isBoss);
    const t = el('div', 'ss-rp-title', undefined, w);
    t.innerHTML = `Round <b>${nextRound}</b> of ${totalRounds} next`;

    const counts = new Map<EnemyType, number>();
    if (round) for (const g of round.groups) counts.set(g.type, (counts.get(g.type) ?? 0) + g.count);

    if (isBoss) {
      let first: EnemyDef | undefined;
      for (const type of counts.keys()) if (ENEMIES[type].isBoss) { first = ENEMIES[type]; break; }
      const bp = el('div', 'ss-boss-preview', undefined, w);
      bp.style.setProperty('--bc', bossColor(first));
      el('div', 'ss-bp-badge', '💀', bp);
      const tx = el('div', 'ss-bp-text', undefined, bp);
      el('small', '', 'BOSS', tx);
      el('b', '', zone.bossName, tx);
      if (first?.title) el('span', 'ss-bp-title', first.title, tx);
    }

    const chips = el('div', 'ss-chips', undefined, w);
    for (const [type, n] of counts) {
      const def = ENEMIES[type];
      if (isBoss && def.isBoss && bossCount(zone) <= 1) continue;
      const chip = el('div', `ss-chip ${def.isBoss ? 'boss' : ''}`, undefined, chips);
      chip.style.setProperty('--chip', hex(def.isBoss ? def.accent : def.color));
      el('span', 'ss-chip-icon', ENEMY_ICON[type] ?? '🤖', chip);
      el('span', 'ss-chip-name', def.name, chip);
      el('span', 'ss-chip-count', `×${n}`, chip);
      if (def.isBoss) el('span', 'ss-chip-tag', 'BOSS', chip);
      else if (ENEMY_TIP[type]) el('span', 'ss-chip-tag tip', ENEMY_TIP[type]!, chip);
    }
    if (!chips.childElementCount) chips.remove();
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
    const p = this.resultPanel;
    p.textContent = '';
    p.classList.toggle('win', win);
    p.classList.toggle('lose', !win);
    el('div', 'ss-result-emoji', win ? '🏆' : sum.survival?.endedEarly ? '🏁' : '💥', p);
    el('h2', 'ss-h2 ss-result-title', win ? `${sum.bossName} DESTROYED!` : sum.survival?.endedEarly ? 'RUN BANKED!' : 'WRECKED!', p);
    el(
      'div',
      'ss-sub',
      win
        ? `${sum.zoneName} cleared! The arena is yours.`
        : sum.survival && sum.daily
          ? `${sum.survival.endedEarly ? 'Banked' : 'Scrapped on'} wave ${sum.survival.wave}. Same lineup all day, so retry and push your best!`
          : sum.survival
          ? `${sum.survival.endedEarly ? 'Banked' : 'Scrapped on'} wave ${sum.survival.wave}. ${sum.survival.newBest ? '🌟 NEW BEST!' : `Best: wave ${sum.survival.best}.`} Coins are kept, so upgrade and go again!`
          : `Your plow got scrapped in ${sum.zoneName}. Coins are kept, so upgrade and get back in there!`,
      p,
    );

    const grid = el('div', 'ss-stats', undefined, p);
    const stat = (icon: string, label: string, value: string, delay: number) => {
      const s = el('div', 'ss-stat', undefined, grid);
      s.style.animationDelay = `${delay}ms`;
      el('div', 'ss-stat-icon', icon, s);
      el('div', 'ss-stat-val', value, s);
      el('div', 'ss-stat-label', label, s);
    };
    if (sum.survival) stat('🌊', 'Waves cleared', `${sum.roundsCleared}`, 100);
    else stat('🏁', win ? 'Rounds cleared' : 'Rounds survived', `${sum.roundsCleared}/${sum.totalRounds}`, 100);
    stat('🤖', 'Bots scrapped', fmt(sum.kills), 180);
    stat('🔥', 'Best combo', sum.bestCombo >= 2 ? `x${sum.bestCombo}` : '—', 260);
    stat('⚪', 'Biggest ball', `${sum.biggestBall.toFixed(2)} m`, 340);
    stat('🪙', 'Coins earned', `+${fmt(sum.coinsEarned)}`, 420);
    if (!sum.survival) this.renderCampaignChallenges(p, sum);

    // ---- Daily Survival: date, modifier, wave vs today's best, last 7 days (ui/DailyResult.ts).
    const daily = sum.survival && sum.daily ? activeDaily() : null;
    if (daily && sum.survival) renderDailyResult(p, this.ctx.progression, daily, sum.survival.wave, sum.survival.newBest);
    // ---- end Daily

    if (win && sum.clearReward > 0) {
      const r = el('div', 'ss-reward', undefined, p);
      el('span', 'ss-coin', undefined, r);
      el('span', '', `+${fmt(sum.clearReward)} ${sum.firstClear ? 'first-clear reward!' : 'clear reward'}`, r);
    }
    if (win && sum.unlockedZoneName) {
      const u = el('div', 'ss-unlock', undefined, p);
      el('span', '', '🔓 New arena unlocked: ', u);
      el('b', '', sum.unlockedZoneName, u);
    }

    const btns = el('div', 'ss-result-btns', undefined, p);
    if (win) {
      const nextIdx = (this.ctx.zone?.index ?? 0) + 1;
      if (nextIdx < ZONES.length && this.ctx.progression.isZoneUnlocked(nextIdx)) {
        // A Hard win carries on in Hard if the next arena has Hard open (it needs a normal clear first).
        const hard = !!sum.hard && hardUnlocked(this.ctx.progression, nextIdx);
        this.btn(hard ? 'NEXT ARENA · 💀 HARD ▶' : 'NEXT ARENA ▶', 'ss-primary ss-big', () => this.handlers.onStartZone(nextIdx, hard), btns).dataset.primary = '1';
      } else if (nextIdx >= ZONES.length) {
        btns.before(el('div', 'ss-unlock', '🌟 Every arena conquered. You are the Snowplow Champion!'));
      }
    } else {
      this.btn('↻ RETRY', 'ss-primary ss-big', () => this.handlers.onRetry(), btns).dataset.primary = '1';
    }
    const g = this.btn('🔧 GARAGE', 'ss-ice', () => this.openGarage('quit'), btns);
    const m = this.btn('🏠 MAIN MENU', 'ss-ice', () => this.handlers.onQuitToMenu(), btns);
    if (!btns.querySelector('[data-primary]')) (win ? m : g).dataset.primary = '1';
  }

  /** Campaign results: HARD badge under the emoji, then the arena's three challenges (✓ met this run,
   *  NEW for first-time stars, ★ already owned) and the star coin bonus. */
  private renderCampaignChallenges(p: HTMLElement, sum: RunSummary): void {
    if (sum.hard) p.querySelector('.ss-result-emoji')?.after(el('div', 'ss-hard-badge', '💀 HARD MODE'));
    const rep = lastChallengeReport();
    if (!rep) return;
    const box = el('div', `ss-chal-result ${rep.newStars ? 'has-new' : ''}`, undefined, p);
    const head = el('div', 'ss-chal-result-head', undefined, box);
    el('span', 'ss-chal-result-stars', undefined, head).innerHTML = starsHtml(rep.stars, rep.results.filter((r) => r.isNew).length);
    el('span', 'ss-chal-result-title', 'CHALLENGES', head);
    if (rep.bonus > 0) el('span', 'ss-chal-result-bonus', `+${fmt(rep.bonus)} 🪙 star bonus`, head);
    else if (!rep.won) el('span', 'ss-chal-result-hint', 'Clear the arena to earn stars', head);
    rep.results.forEach((r, i) => {
      const row = el('div', `ss-chal-row ${r.met ? 'met' : ''} ${r.isNew ? 'new' : ''} ${r.owned ? 'owned' : ''}`, undefined, box);
      row.style.animationDelay = `${520 + i * 110}ms`;
      el('span', 'ss-chal-row-mark', r.met ? '✓' : r.owned ? '★' : r.def.icon, row);
      const tx = el('span', 'ss-chal-row-text', undefined, row);
      el('b', '', r.def.name, tx);
      el('small', '', r.def.goal, tx);
      if (r.isNew) el('span', 'ss-chal-row-new', 'NEW ★', row);
      else if (r.owned) el('span', 'ss-chal-row-owned', '★', row);
    });
  }

  /* ================================================================== brawl lobby */

  private buildLobby(): void {
    const s = this.screen('lobby', 'ss-center ss-dim ss-lobby-screen');
    this.lobbyPanel = el('div', 'ss-panel ss-glass ss-lobby ss-icicles', undefined, s);
  }

  private renderLobby(): void {
    const p = this.lobbyPanel;
    const d = this.ctx.progression.data;
    p.textContent = '';
    const head = el('div', 'ss-lobby-head', undefined, p);
    el('div', 'ss-lobby-kicker', '🔥 NEW MODE 🔥', head);
    el('h2', 'ss-h2 ss-lobby-title', 'SNOWDOME BRAWL', head);
    el('div', 'ss-sub ss-lobby-sub', `Free-for-all · ${BRAWL_BOTS + 1} plows · everyone hunts everyone`, head);

    const body = el('div', 'ss-lobby-body', undefined, p);
    const left = el('div', 'ss-lobby-col', undefined, body);

    // rules
    const rules = el('div', 'ss-lobby-box', undefined, left);
    el('h3', 'ss-h3', '📜 Rules', rules);
    const ul = el('ul', 'ss-rules', undefined, rules);
    const li = (icon: string, html: string) => {
      const r = el('li', '', undefined, ul);
      el('span', 'ss-rule-i', icon, r);
      el('span', 'ss-rule-t', undefined, r).innerHTML = html;
    };
    li('⏱', `<b>${fmtTime(BRAWL_TIME)}</b> match, or first to <b>${BRAWL_KILL_TARGET} kills</b> wins`);
    li('♻️', `Wrecked? Respawn in <b>${BRAWL_RESPAWN}s</b> — no lives, just keep brawling`);
    li('🪙', `Every kill pays <b>${BRAWL_KILL_COINS} coins</b> × streak × lobby bonus`);
    li('🎯', `<b>Shutdown bounty:</b> end a 3+ streak for <b>${BRAWL_SHUTDOWN_PER_STREAK}</b> coins per kill in it (gold ring on the minimap)`);

    // streak tiers
    const tiers = el('div', 'ss-lobby-box ss-tiers-box', undefined, left);
    el('h3', 'ss-h3', '🔥 Kill streaks', tiers);
    const tbl = el('div', 'ss-tiers', undefined, tiers);
    STREAK_TIERS.forEach((t, i) => {
      const row = el('div', `ss-tier t${i + 1}`, undefined, tbl);
      el('span', 'ss-tier-fl', '🔥'.repeat(i + 1), row);
      el('span', 'ss-tier-l', t.label, row);
      el('span', 'ss-tier-at', `${t.at} kills`, row);
      el('span', 'ss-tier-m', `${fmtMult(t.mult)} coins`, row);
    });
    el('div', 'ss-tier-note', 'Streaks reset when you get wrecked.', tiers);

    // placement
    const pl = el('div', 'ss-lobby-box', undefined, left);
    el('h3', 'ss-h3', '🏅 Placement bonus', pl);
    const pr = el('div', 'ss-place-row', undefined, pl);
    const medals = ['🥇', '🥈', '🥉', '🎖️'];
    BRAWL_PLACEMENT_BONUS.forEach((v, i) => {
      const c = el('div', `ss-place p${i + 1}`, undefined, pr);
      el('span', 'ss-place-m', medals[i] ?? '🎖️', c);
      el('b', '', ordinal(i + 1), c);
      el('span', 'ss-place-v', `+${fmt(v)}`, c);
    });

    // right: difficulty + records
    const right = el('div', 'ss-lobby-col', undefined, body);
    el('h3', 'ss-h3', '🎮 Choose your lobby', right);
    const cards = el('div', 'ss-diffs', undefined, right);
    const prefer: BrawlDifficulty = (d.brawlMatches ?? 0) === 0 ? 'rookie' : 'pro';
    for (const def of BRAWL_DIFFICULTIES) {
      const c = el('button', `ss-diff ss-diff-${def.id}`, undefined, cards);
      c.type = 'button';
      const top = el('div', 'ss-diff-top', undefined, c);
      el('span', 'ss-diff-name', def.name, top);
      el('span', 'ss-diff-mult', `${fmtMult(def.coinMult)} COINS`, top);
      el('div', 'ss-diff-blurb', def.blurb, c);
      const st = el('div', 'ss-diff-stats', undefined, c);
      el('span', '', `❤ ${Math.round(def.hpMult * 100)}% hp`, st);
      el('span', '', `💥 ${Math.round(def.dmgMult * 100)}% dmg`, st);
      el('span', '', `🎯 ${Math.round(def.skill * 100)}% skill`, st);
      el('div', 'ss-diff-go', 'BRAWL ▶', c);
      if (def.id === prefer) c.dataset.primary = '1';
      c.addEventListener('click', () => {
        this.sfx('click');
        this.handlers.onStartBrawl(def.id);
      });
    }

    const rec = el('div', 'ss-lobby-box ss-records', undefined, right);
    el('h3', 'ss-h3', '📈 Your records', rec);
    const grid = el('div', 'ss-rec-grid', undefined, rec);
    const r = (icon: string, label: string, v: string) => {
      const c = el('div', 'ss-rec', undefined, grid);
      el('div', 'ss-rec-i', icon, c);
      el('div', 'ss-rec-v', v, c);
      el('div', 'ss-rec-l', label, c);
    };
    r('🥇', 'Wins', fmt(d.brawlWins ?? 0));
    r('🏟️', 'Matches', fmt(d.brawlMatches ?? 0));
    r('🔥', 'Best streak', fmt(d.brawlBestStreak ?? 0));
    r('💀', 'Most kills', fmt(d.brawlBestKills ?? 0));

    const foot = el('div', 'ss-panel-foot', undefined, p);
    this.btn('◀ BACK', 'ss-ice', () => this.showMainMenu(), foot);
    el('div', 'ss-foot-hint', 'Tip: upgrades from the Garage carry into the Brawl', foot);
  }

  /* ================================================================== brawl results */

  private buildBrawlResult(): void {
    const s = (this.bresultScreen = this.screen('bresult', 'ss-center ss-dim ss-bresult-screen'));
    this.bresultPanel = el('div', 'ss-panel ss-glass ss-bresult ss-icicles', undefined, s);
  }

  private renderBrawlResult(r: BrawlResult): void {
    const scr = this.bresultScreen;
    scr.querySelector('.ss-confetti')?.remove();
    const p = this.bresultPanel;
    p.textContent = '';
    const place = Math.max(1, r.placement);
    const tier = place <= 3 ? place : 0;
    p.dataset.place = String(tier);
    if (place === 1) {
      const conf = el('div', 'ss-confetti', undefined);
      scr.insertBefore(conf, p);
      const cols = ['#ffc531', '#ff8a1f', '#fff3b0', '#ff5d14', '#7fe0ff', '#ffffff'];
      for (let i = 0; i < 70; i++) {
        const c = el('i', '', undefined, conf);
        c.style.left = `${Math.random() * 100}%`;
        c.style.background = cols[i % cols.length];
        c.style.animationDelay = `${(Math.random() * 1.6).toFixed(2)}s`;
        c.style.animationDuration = `${(2.4 + Math.random() * 1.8).toFixed(2)}s`;
        c.style.setProperty('--rx', `${Math.round(Math.random() * 720 - 360)}deg`);
        c.style.setProperty('--dx', `${Math.round(Math.random() * 160 - 80)}px`);
      }
    }
    const diff = BRAWL_DIFFICULTIES.find((x) => x.id === r.difficulty);
    el('div', 'ss-bres-kicker', `SNOWDOME BRAWL · ${diff?.name ?? r.difficulty}`, p);
    const big = el('div', 'ss-bres-place', undefined, p);
    if (place === 1) big.textContent = '1ST!';
    else {
      big.append(ordinal(place));
      el('small', '', ` of ${r.total}`, big);
    }
    el(
      'div',
      'ss-sub',
      place === 1 ? 'Champion of the Snowdome. Nobody plows like you.' : place <= 3 ? 'On the podium! So close to the crown.' : 'Shake off the snow and run it back.',
      p,
    );

    const grid = el('div', 'ss-stats ss-bres-stats', undefined, p);
    const stat = (icon: string, label: string, value: string, delay: number) => {
      const s = el('div', 'ss-stat', undefined, grid);
      s.style.animationDelay = `${delay}ms`;
      el('div', 'ss-stat-icon', icon, s);
      el('div', 'ss-stat-val', value, s);
      el('div', 'ss-stat-label', label, s);
    };
    stat('💀', 'Kills', fmt(r.kills), 120);
    stat('🪦', 'Deaths', fmt(r.deaths), 200);
    stat('🔥', 'Best streak', r.bestStreak > 0 ? String(r.bestStreak) : '—', 280);
    stat('🪙', 'Coins earned', `+${fmt(r.coinsEarned)}`, 360);

    const coins = el('div', 'ss-bres-coins', undefined, p);
    const line = (label: string, v: number, cls = '') => {
      const row = el('div', `ss-bres-line ${cls}`, undefined, coins);
      el('span', '', label, row);
      const b = el('b', '', undefined, row);
      el('span', 'ss-coin sm', undefined, b);
      b.append(`+${fmt(v)}`);
    };
    line('Match earnings (kills · streaks · shutdowns)', Math.max(0, r.coinsEarned - r.placementBonus));
    if (r.placementBonus > 0) line(`${ordinal(place)} place bonus`, r.placementBonus, 'bonus');
    line('Total', r.coinsEarned, 'total');

    // final leaderboard
    const tbl = el('div', 'ss-bres-board', undefined, p);
    const head = el('div', 'ss-bres-row head', undefined, tbl);
    for (const t of ['#', '', 'PLOWER', 'KILLS', 'DEATHS', 'BEST 🔥']) el('span', '', t, head);
    r.leaderboard.forEach((e: BrawlEntry, i) => {
      const row = el('div', `ss-bres-row${e.isPlayer ? ' me' : ''}${i === 0 ? ' first' : ''}`, undefined, tbl);
      row.style.animationDelay = `${300 + i * 50}ms`;
      el('span', 'ss-bres-r', i === 0 ? '👑' : String(i + 1), row);
      el('span', 'ss-bh-dot', undefined, row).style.background = e.color;
      const n = el('span', 'ss-bres-n', e.name, row);
      // Rival paint darkened toward ink so yellow/pink names stay readable on the light results panel.
      if (!e.isPlayer) n.style.color = `color-mix(in srgb, ${e.color} 62%, #10203a)`;
      el('span', 'ss-bres-k', String(e.kills), row);
      el('span', '', String(e.deaths), row);
      el('span', '', e.bestStreak > 0 ? String(e.bestStreak) : '—', row);
    });

    const btns = el('div', 'ss-result-btns', undefined, p);
    this.btn('↻ REMATCH', 'ss-primary ss-big', () => this.handlers.onStartBrawl(r.difficulty), btns).dataset.primary = '1';
    this.btn('🔧 GARAGE', 'ss-ice', () => this.openGarage('quit'), btns);
    this.btn('🏠 MENU', 'ss-ice', () => this.handlers.onQuitToMenu(), btns);
  }

  /* ================================================================== boss intro */

  private buildIntro(): void {
    const w = (this.intro = el('div', 'ss-bossintro', undefined, this.rootEl));
    w.setAttribute('aria-live', 'polite');
    el('div', 'ss-bi-flash', undefined, w);
    el('div', 'ss-bi-slash a', undefined, w);
    el('div', 'ss-bi-slash b', undefined, w);
    const band = el('div', 'ss-bi-band', undefined, w);
    el('div', 'ss-bi-stripes top', undefined, band);
    el('div', 'ss-bi-kicker', '⚠  BOSS ROUND  ⚠', band);
    this.introName = el('div', 'ss-bi-name', '', band);
    this.introTitle = el('div', 'ss-bi-title', '', band);
    el('div', 'ss-bi-stripes bottom', undefined, band);
  }

  private endIntro(): void {
    clearTimeout(this.introTimer);
    this.intro?.classList.remove('go');
    this.hud?.classList.remove('intro');
  }

  private onBossPhase(name: string, label: string): void {
    for (const s of this.bossSlots) {
      if (!s.key || (s.key !== name && !s.key.startsWith(`${name}#`))) continue;
      s.phase.textContent = label;
      s.phase.classList.remove('hidden');
      restart(s.inner, 'bighit', 'hit');
    }
  }

  /* ================================================================== HUD */

  private buildHud(): void {
    const hud = (this.hud = el('div', 'ss-hud', undefined, this.rootEl));
    const H = this.h;
    el('div', 'ss-lowvig', undefined, hud);

    // top-left: arena + round
    const tl = el('div', 'ss-hud-tl ss-glass-dark', undefined, hud);
    H.zone = el('div', 'ss-hud-zone', '', tl);
    const rr = el('div', 'ss-hud-roundrow', undefined, tl);
    H.round = el('div', 'ss-hud-round', '', rr);
    H.enemies = el('div', 'ss-hud-enemies', '', rr);
    H.pips = el('div', 'ss-round-pips', undefined, tl);

    // top-center: boss bars (1–2)
    H.bosses = el('div', 'ss-bosses', undefined, hud);
    for (let i = 0; i < 2; i++) this.bossSlots.push(this.buildBossSlot(H.bosses));

    // top-right: coins
    H.coinBox = el('div', 'ss-hud-tr ss-glass-dark', undefined, hud);
    el('span', 'ss-coin', undefined, H.coinBox);
    H.coins = el('span', 'ss-hud-coins', '0', H.coinBox);

    // right: combo
    H.combo = el('div', 'ss-combo', undefined, hud);
    H.comboN = el('div', 'ss-combo-n', '', H.combo);
    el('div', 'ss-combo-l', 'COMBO', H.combo);

    // bottom-left: plow hp
    const bl = (H.hpBox = el('div', 'ss-hud-bl ss-glass-dark', undefined, hud));
    const hh = el('div', 'ss-hp-head', undefined, bl);
    el('div', 'ss-hp-label', '🚜 PLOW', hh);
    H.hpNum = el('div', 'ss-hp-num', '', hh);
    const hb = el('div', 'ss-hp-bar', undefined, bl);
    H.hpChip = el('div', 'ss-hp-chip', undefined, hb);
    H.hpFill = el('div', 'ss-hp-fill', undefined, hb);
    el('div', 'ss-segs', undefined, hb);
    H.batt = el('div', 'ss-batt hidden', undefined, bl);
    el('span', 'ss-batt-label', '🔋', H.batt);
    const bb = el('div', 'ss-batt-bar', undefined, H.batt);
    H.battFill = el('div', 'ss-batt-fill', undefined, bb);
    H.crit = el('div', 'ss-batt ss-crit hidden', undefined, bl);
    el('span', 'ss-batt-label', '☢', H.crit);
    const cb = el('div', 'ss-batt-bar', undefined, H.crit);
    H.critFill = el('div', 'ss-batt-fill', undefined, cb);
    el('span', 'ss-crit-tag', 'NUKE READY · F', H.crit);

    // bottom-center: abilities + snowball gauge
    const bc = el('div', 'ss-hud-bc', undefined, hud);
    H.blocked = el('div', 'ss-blocked', 'BLOCKED!', bc);
    H.shield = el('div', 'ss-shield', '🛡 SHIELD UP', bc);
    const row = el('div', 'ss-bc-row', undefined, bc);
    H.dash = this.buildAbility(row, '💨', 'DASH', 'SHIFT', 'dash');
    H.gauge = el('div', 'ss-gauge', undefined, row);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 110 110');
    svg.classList.add('ss-gauge-svg');
    const track = document.createElementNS(NS, 'circle');
    track.setAttribute('cx', '55');
    track.setAttribute('cy', '55');
    track.setAttribute('r', String(GAUGE_R));
    track.setAttribute('class', 'ss-gauge-track');
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('cx', '55');
    ring.setAttribute('cy', '55');
    ring.setAttribute('r', String(GAUGE_R));
    ring.setAttribute('class', 'ss-gauge-ring');
    ring.setAttribute('stroke-dasharray', `${GAUGE_C} ${GAUGE_C}`);
    ring.setAttribute('stroke-dashoffset', String(GAUGE_C));
    ring.setAttribute('transform', 'rotate(-90 55 55)');
    svg.appendChild(track);
    svg.appendChild(ring);
    H.gauge.appendChild(svg);
    H.ring = ring;
    const inner = el('div', 'ss-gauge-inner', undefined, H.gauge);
    H.radius = el('div', 'ss-gauge-r', '0.00m', inner);
    H.tier = el('div', 'ss-gauge-tier', 'Snowball', inner);
    H.whirl = this.buildAbility(row, '🌀', 'WHIRL', 'E', 'whirl');
    H.flame = this.buildAbility(row, '🔥', 'FIRE', 'F', 'flame');
    H.flame.style.display = 'none';
    // Thunderclap Overload meter (VOLT-9 only): heat bar + the next clap's self-damage, perched on the F icon.
    H.heat = el('div', 'ss-heat hidden', undefined, H.flame);
    const heatBar = el('div', 'ss-heat-bar', undefined, H.heat);
    H.heatFill = el('div', 'ss-heat-fill', undefined, heatBar);
    H.heatTxt = el('div', 'ss-heat-txt', '', H.heat);
    H.slam =el('div', 'ss-slam-hint', undefined, bc);
    H.slam.innerHTML = '<kbd class="ss-kbd">SPACE</kbd> SLAM!';

    // bottom-right: snow remaining
    const br = el('div', 'ss-hud-br ss-glass-dark', undefined, hud);
    el('span', 'ss-snow-label', '❄ SNOW', br);
    const sb = el('div', 'ss-snow-bar', undefined, br);
    H.snowFill = el('div', 'ss-snow-fill', undefined, sb);
    H.snowTxt = el('span', 'ss-snow-txt', '', br);

    H.count = el('div', 'ss-count hidden', '', hud);
    H.hint = el('div', 'ss-hint hidden', 'W/S drive  ·  A/D steer  ·  plow snow to grow a ball  ·  SPACE slam  ·  SHIFT dash strike  ·  E whirlwind  ·  F fire / thunderclap  ·  ESC pause', hud);
    this.bh = new BrawlHudView(this.ctx, hud, bc);
  }

  private buildBossSlot(parent: HTMLElement): BossSlot {
    const root = el('div', 'ss-bossbar hidden', undefined, parent);
    const inner = el('div', 'ss-bb-inner', undefined, root);
    const head = el('div', 'ss-bb-head', undefined, inner);
    const badge = el('div', 'ss-bb-badge', '💀', head);
    const name = el('div', 'ss-bb-name', '', head);
    const title = el('div', 'ss-bb-title', '', head);
    const phase = el('div', 'ss-bb-phase hidden', '', head);
    const hp = el('div', 'ss-bb-hp', '', head);
    const track = el('div', 'ss-bb-track', undefined, inner);
    const chip = el('div', 'ss-bb-chip', undefined, track);
    const fill = el('div', 'ss-bb-fill', undefined, track);
    el('div', 'ss-bb-segs', undefined, track);
    return { key: '', root, inner, badge, name, title, phase, hp, fill, chip, frac: -1, hpVal: -1, down: 0, mark: false };
  }

  private buildAbility(parent: HTMLElement, icon: string, name: string, key: string, cls: string): HTMLElement {
    const a = el('div', `ss-ab ss-ab-${cls}`, undefined, parent);
    el('div', 'ss-ab-ring', undefined, a);
    const core = el('div', 'ss-ab-core', undefined, a);
    el('div', 'ss-ab-icon', icon, core);
    el('div', 'ss-ab-name', name, core);
    el('kbd', 'ss-kbd ss-ab-key', key, a);
    return a;
  }

  private setAbility(a: HTMLElement, v: number, prev: number): void {
    a.style.setProperty('--p', String(v));
    const ready = v >= 0.999;
    const was = prev >= 0.999;
    if (ready !== was || prev < 0) {
      a.classList.toggle('ready', ready);
      a.classList.toggle('cooling', !ready);
      if (ready && prev >= 0) restart(a, 'pop');
    }
  }

  private renderPips(round: number, total: number): void {
    const box = this.h.pips;
    if (box.childElementCount !== total) {
      box.textContent = '';
      for (let i = 0; i < total; i++) {
        const boss = !!this.ctx.zone?.rounds[i]?.boss;
        el('span', `ss-rpip${boss ? ' boss' : ''}`, boss ? '☠' : '', box);
      }
    }
    const kids = box.children;
    for (let i = 0; i < kids.length; i++) {
      kids[i].classList.toggle('done', i < round - 1);
      kids[i].classList.toggle('cur', i === round - 1);
    }
  }

  private assignSlot(slot: BossSlot, key: string, b: HudBoss): void {
    slot.key = key;
    slot.down = 0;
    slot.frac = -1;
    slot.hpVal = -1;
    const def = DEF_BY_NAME.get(b.name);
    slot.root.style.setProperty('--bc', bossColor(def));
    slot.badge.textContent = def ? ENEMY_ICON[def.type] ?? '💀' : '💀';
    slot.name.textContent = b.name;
    slot.title.textContent = b.title;
    slot.phase.classList.add('hidden');
    slot.root.classList.remove('hidden', 'down', 'low');
  }

  private updateBosses(list: HudBoss[]): void {
    const slots = this.bossSlots;
    for (const s of slots) s.mark = false;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      let dup = 0;
      for (let j = 0; j < i; j++) if (list[j].name === b.name) dup++;
      const key = dup ? `${b.name}#${dup}` : b.name;
      let slot: BossSlot | null = null;
      for (const s of slots) if (s.key === key) slot = s;
      if (!slot) for (const s of slots) if (!slot && !s.key) slot = s;
      if (!slot) for (const s of slots) if (!slot && s.down) slot = s;
      if (!slot) continue;
      if (slot.key !== key || slot.down) this.assignSlot(slot, key, b);
      slot.mark = true;
      this.setSlotHp(slot, b.hp, b.maxHp);
    }
    let visible = 0;
    const now = performance.now();
    for (const s of slots) {
      if (!s.key) continue;
      if (!s.mark) {
        if (!s.down) {
          s.down = now;
          s.frac = 0;
          s.fill.style.transform = 'scaleX(0)';
          s.chip.style.transform = 'scaleX(0)';
          s.hp.textContent = 'DESTROYED';
          s.phase.classList.add('hidden');
          s.root.classList.add('down');
          restart(s.inner, 'bighit', 'hit');
        } else if (now - s.down > 1600) {
          this.freeSlot(s);
          continue;
        }
      }
      visible++;
    }
    if (visible !== this.last.bossCount) {
      this.last.bossCount = visible;
      this.h.bosses.classList.toggle('twin', visible >= 2);
      this.rootEl.classList.toggle('has-boss', visible === 1);
      this.rootEl.classList.toggle('has-twin', visible >= 2);
    }
  }

  private freeSlot(s: BossSlot): void {
    s.key = '';
    s.down = 0;
    s.frac = -1;
    s.hpVal = -1;
    s.root.classList.add('hidden');
    s.root.classList.remove('down', 'low');
  }

  private setSlotHp(slot: BossSlot, hp: number, maxHp: number): void {
    const q = Math.round(clamp01(hp / Math.max(1, maxHp)) * 500) / 500;
    if (q !== slot.frac) {
      const prev = slot.frac;
      slot.frac = q;
      const tf = `scaleX(${q})`;
      slot.fill.style.transform = tf;
      slot.chip.style.transform = tf;
      if (prev >= 0) {
        const drop = prev - q;
        if (drop >= 0.06) restart(slot.inner, 'bighit', 'hit');
        else if (drop >= 0.02) restart(slot.inner, 'hit', 'bighit');
      }
      slot.root.classList.toggle('low', q < 0.25);
    }
    const v = Math.ceil(Math.max(0, hp));
    if (v !== slot.hpVal) {
      slot.hpVal = v;
      slot.hp.textContent = fmt(v);
    }
  }

  private pulse(amount: number, blocked: number): void {
    if (!this.hudVisible) return;
    const max = this.last.plowMax > 0 ? this.last.plowMax : 120;
    const isBlock = blocked > 0;
    const frac = (isBlock ? blocked : amount) / max;
    const v = this.vignette;
    v.style.setProperty('--vi', Math.min(1, 0.35 + frac * 4).toFixed(2));
    v.classList.remove('heavy', 'blocked', 'go');
    void v.offsetWidth;
    v.classList.add('go');
    if (isBlock) {
      v.classList.add('blocked');
      restart(this.h.blocked, 'go');
    } else if (frac >= 0.1) {
      v.classList.add('heavy');
      restart(this.h.hpBox, 'hit');
    }
  }

  private resetHudFx(): void {
    this.vignette.classList.remove('go', 'heavy', 'blocked');
    this.h.count.classList.add('hidden');
    this.last.count = -1;
    this.h.combo.classList.remove('on');
    this.last.combo = 0;
    for (const s of this.bossSlots) this.freeSlot(s);
    this.last.bossCount = -1;
    this.rootEl.classList.remove('has-boss', 'has-twin');
    this.h.bosses.classList.remove('twin');
    this.endIntro();
    this.bh.setActive(false);
    this.bh.reset();
    this.last.brawl = -1;
    this.hud.classList.remove('brawl');
    this.rootEl.classList.remove('in-brawl');
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
    this.renderRoundPreview(nextRound, totalRounds);
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
      (info.bonus > 0 ? 'Catch-up coins are spent first and the upgrades are yours to keep; then your own coins buy upgrades as usual.' : 'Your own coins buy permanent upgrades as usual.');
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
    this.hud.classList.toggle('duel', on);
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
    if (visible === this.hudVisible) return;
    this.hudVisible = visible;
    this.hud.classList.toggle('show', visible);
    if (!visible) {
      this.resetHudFx();
      clearTimeout(this.hintTimer);
      this.h.hint.classList.add('hidden');
    } else {
      this.refreshKeys();
      const d = this.ctx.progression.data;
      const firstRun = d.totalKills < 15 && !Object.values(d.zones).some((z) => z.bestRound > 0);
      this.h.hint.classList.toggle('hidden', !firstRun);
      clearTimeout(this.hintTimer);
      if (firstRun) this.hintTimer = window.setTimeout(() => this.h.hint.classList.add('hidden'), 45000);
    }
  }

  bossIntro(name: string, title: string): void {
    const w = this.intro;
    this.introName.textContent = name;
    this.introTitle.textContent = title;
    this.introTitle.classList.toggle('hidden', !title);
    w.classList.remove('go');
    void w.offsetWidth;
    w.classList.add('go');
    this.hud.classList.add('intro');
    clearTimeout(this.introTimer);
    this.introTimer = window.setTimeout(() => this.endIntro(), INTRO_MS + 60);
  }

  updateHud(s: HudState): void {
    if (!this.hudVisible) return;
    const H = this.h;
    const L = this.last;

    const brawl = s.brawl ? 1 : 0;
    if (brawl !== L.brawl) {
      L.brawl = brawl;
      this.hud.classList.toggle('brawl', !!brawl);
      this.rootEl.classList.toggle('in-brawl', !!brawl);
      this.bh.setActive(!!brawl);
    }
    if (s.brawl) this.bh.update(s.brawl);

    if (s.zoneName !== L.zone) {
      L.zone = s.zoneName;
      H.zone.textContent = s.zoneName;
    }
    const hideRound = !!s.hideRound;
    if (hideRound !== L.hideRound) {
      L.hideRound = hideRound;
      H.round.classList.toggle('hidden', hideRound);
      H.pips.classList.toggle('hidden', hideRound);
    }
    const sv = s.survival;
    if (sv) {
      // Survival: "Wave N · Best M" instead of round pips (encoded into L.round / L.total).
      if (sv.wave !== L.round || -sv.best !== L.total || s.bossRound !== L.bossRound) {
        L.round = sv.wave;
        L.total = -sv.best;
        L.bossRound = s.bossRound;
        H.round.textContent = `${s.bossRound ? '☠ BOSS ' : ''}Wave ${sv.wave} · Best ${sv.best}`;
        H.round.classList.toggle('boss', s.bossRound);
        this.renderPips(0, 0);
      }
    } else if (s.round !== L.round || s.totalRounds !== L.total || s.bossRound !== L.bossRound) {
      L.round = s.round;
      L.total = s.totalRounds;
      L.bossRound = s.bossRound;
      H.round.textContent = s.bossRound ? '☠ BOSS ROUND' : `Round ${s.round}/${s.totalRounds}`;
      H.round.classList.toggle('boss', s.bossRound);
      this.renderPips(s.round, s.totalRounds);
    }
    const en = Math.max(0, Math.round(s.enemiesRemaining));
    if (en !== L.enemies) {
      L.enemies = en;
      H.enemies.textContent = en > 0 ? `${en} bot${en === 1 ? '' : 's'} left` : 'Get ready…';
    }

    // bosses
    if (!brawl && (s.bosses.length || L.bossCount > 0)) this.updateBosses(s.bosses);

    // coins
    const coins = Math.floor(s.coins);
    if (coins !== L.coins) {
      if (L.coins >= 0 && coins > L.coins) restart(H.coinBox, 'bump');
      L.coins = coins;
      H.coins.textContent = fmt(coins);
    }

    // plow hp
    const php = Math.ceil(Math.max(0, s.plowHp));
    if (php !== L.plowHp || s.plowMaxHp !== L.plowMax) {
      L.plowHp = php;
      L.plowMax = s.plowMaxHp;
      const f = Math.round(clamp01(s.plowHp / Math.max(1, s.plowMaxHp)) * 400) / 400;
      if (f !== L.plowF) {
        L.plowF = f;
        const tf = `scaleX(${f})`;
        H.hpFill.style.transform = tf;
        H.hpChip.style.transform = tf;
      }
      H.hpNum.innerHTML = `${php}<small> / ${Math.round(s.plowMaxHp)}</small>`;
      const low = f < 0.3;
      const mid = !low && f < 0.6;
      if (low !== L.low) {
        L.low = low;
        H.hpBox.classList.toggle('low', low);
        this.hud.classList.toggle('lowhp', low);
      }
      if (mid !== L.mid) {
        L.mid = mid;
        H.hpBox.classList.toggle('mid', mid);
      }
    }

    // snowball gauge
    const r = Math.round(s.ballRadius * 100) / 100;
    if (r !== L.ballR) {
      L.ballR = r;
      H.radius.textContent = `${r.toFixed(2)}m`;
      const t = tierIndex(r);
      if (t !== L.tier) {
        if (L.tier >= 0 && t > L.tier) restart(H.gauge, 'tierup');
        L.tier = t;
        H.tier.textContent = tierName(r);
        H.gauge.dataset.tier = String(t);
      }
      const ready = s.ballRadius >= MIN_BALL_RADIUS;
      if (ready !== L.ready) {
        L.ready = ready;
        H.gauge.classList.toggle('ready', ready);
        H.slam.classList.toggle('show', ready);
      }
      const held = s.ballRadius > 0.02;
      if (held !== L.held) {
        L.held = held;
        H.shield.classList.toggle('on', held);
      }
    }
    const frac = Math.round(clamp01(s.ballRadius / Math.max(0.01, s.ballMaxRadius)) * 200) / 200;
    if (frac !== L.ballFrac) {
      L.ballFrac = frac;
      H.ring.setAttribute('stroke-dashoffset', String(GAUGE_C * (1 - frac)));
      const full = frac >= 0.99;
      if (full !== L.full) {
        L.full = full;
        H.gauge.classList.toggle('full', full);
      }
    }

    // abilities
    const d = Math.round(clamp01(s.dashReady) * 50) / 50;
    if (d !== L.dash) {
      this.setAbility(H.dash, d, L.dash);
      L.dash = d;
    }
    // Whirlwind is always available now; a negative value (legacy "not owned") reads as ready.
    const w = s.whirlReady < 0 ? 1 : Math.round(clamp01(s.whirlReady) * 50) / 50;
    if (w !== L.whirl) {
      this.setAbility(H.whirl, w, L.whirl);
      L.whirl = w;
    }
    // F icon follows the plow: Inferno fire (Classic), Thunderclap (VOLT-9) or Ground Pound (BRUTUS).
    if (s.fAbility !== L.fKind) {
      L.fKind = s.fAbility;
      L.crit = -2; // re-apply the NUKE label below
      const zap = s.fAbility === 'zap';
      const pound = s.fAbility === 'pound';
      const melt = s.fAbility === 'meltdown';
      const rockets = s.fAbility === 'missiles';
      H.flame.querySelector('.ss-ab-icon')!.textContent = zap ? '⚡' : pound ? '💥' : melt ? '☢️' : rockets ? '🚀' : '🔥';
      H.flame.querySelector('.ss-ab-name')!.textContent = zap ? 'CLAP' : pound ? 'POUND' : melt ? 'MELT' : rockets ? 'MISSILES' : 'FIRE';
      // ARSENAL: E is the laser, and there is no ball to slam.
      H.whirl.querySelector('.ss-ab-icon')!.textContent = rockets ? '🔴' : '🌀';
      H.whirl.querySelector('.ss-ab-name')!.textContent = rockets ? 'LASER' : 'WHIRL';
      H.gauge.classList.toggle('hidden', rockets);
      // The ultimate meter: ISOTOPE's ☢ Critical Mass, or the Classic Plow's 🔥 FIRESTORM.
      const fireUlt = s.fAbility === 'fire';
      H.crit.classList.toggle('ss-crit-fire', fireUlt);
      H.crit.querySelector('.ss-batt-label')!.textContent = fireUlt ? '🔥' : '☢';
      H.crit.querySelector('.ss-crit-tag')!.textContent = fireUlt ? 'FIRESTORM READY · F' : 'NUKE READY · F';
      this.refreshKeys();
      H.flame.classList.toggle('ss-ab-melt', melt);
      H.flame.classList.toggle('ss-ab-zap', zap);
      H.flame.classList.toggle('ss-ab-pound', pound);
    }
    // ISOTOPE Critical Mass: full = the next F is a NUKE (the F icon says so too).
    const cm = s.critMass === undefined || s.critMass < 0 ? -1 : Math.round(clamp01(s.critMass) * 100) / 100;
    if (cm !== L.crit) {
      H.crit.classList.toggle('hidden', cm < 0);
      if (cm >= 0) H.critFill.style.transform = `scaleX(${cm})`;
      const full = cm >= 1;
      H.crit.classList.toggle('full', full);
      if (s.fAbility === 'meltdown') {
        H.flame.querySelector('.ss-ab-icon')!.textContent = '☢️';
        H.flame.querySelector('.ss-ab-name')!.textContent = full ? 'NUKE' : 'MELT';
        H.flame.classList.toggle('ss-ab-nuke', full);
      } else if (s.fAbility === 'fire') {
        H.flame.querySelector('.ss-ab-icon')!.textContent = full ? '🌋' : '🔥';
        H.flame.querySelector('.ss-ab-name')!.textContent = full ? 'STORM' : 'FIRE';
        H.flame.classList.toggle('ss-ab-nuke', full);
      }
      L.crit = cm;
    }
    // Battery Shield (VOLT-9).
    const bt = s.shield < 0 ? -1 : Math.round(clamp01(s.shield) * 100) / 100;
    if (bt !== L.batt) {
      H.batt.classList.toggle('hidden', bt < 0);
      if (bt >= 0) H.battFill.style.transform = `scaleX(${bt})`;
      H.batt.classList.toggle('empty', bt === 0);
      L.batt = bt;
    }
    // F ability: hidden while it does nothing (e.g. Thunderclap before it is bought); Inferno and Pound are free.
    const f = s.flameReady < 0 ? -1 : Math.round(clamp01(s.flameReady) * 50) / 50;
    if (f !== L.flame) {
      H.flame.style.display = f < 0 ? 'none' : '';
      if (f >= 0) this.setAbility(H.flame, f, L.flame);
      L.flame = f;
    }
    // Thunderclap Overload: heat meter (full at 3 heat ~ a clap per second) + predicted self-damage.
    const ht = s.overload === undefined || s.overload < 0 ? -1 : Math.round(Math.min(1, s.overload / 3) * 50) / 50;
    const hc = ht < 0 ? -1 : Math.round(s.overloadCost ?? 0);
    if (ht !== L.heat || hc !== L.heatCost) {
      H.heat.classList.toggle('hidden', ht < 0);
      if (ht >= 0) {
        H.heatFill.style.transform = `scaleX(${ht})`;
        H.heatTxt.textContent = `-${hc} HP`;
        H.heat.dataset.t = ht >= 0.6 ? '2' : ht >= 0.25 ? '1' : '0';
      }
      L.heat = ht;
      L.heatCost = hc;
    }

    // combo
    const c = s.combo >= 2 ? Math.floor(s.combo) : 0;
    if (c !== L.combo) {
      if (c >= 2) {
        H.comboN.textContent = `x${c}`;
        const tier = c >= 20 ? 3 : c >= 10 ? 2 : c >= 5 ? 1 : 0;
        if (tier !== L.comboTier) {
          L.comboTier = tier;
          H.combo.dataset.t = String(tier);
        }
        H.combo.classList.add('on');
        if (c > L.combo) restart(H.comboN, 'pop');
      } else {
        H.combo.classList.remove('on');
      }
      L.combo = c;
    }

    // snow remaining
    const sf = Math.round(clamp01(s.snowFraction) * 100);
    if (sf !== L.snow) {
      L.snow = sf;
      H.snowFill.style.transform = `scaleX(${sf / 100})`;
      H.snowTxt.textContent = `${sf}%`;
      H.snowFill.classList.toggle('low', sf < 25);
    }

    // countdown
    const cn = s.countdown > 0 ? Math.ceil(s.countdown) : 0;
    if (cn !== L.count) {
      if ((cn > 0) !== (L.count > 0)) H.count.classList.toggle('hidden', cn <= 0);
      L.count = cn;
      if (cn > 0) {
        H.count.textContent = String(cn);
        restart(H.count, 'pop');
      }
    }
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' | 'big' = 'info'): void {
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

function bossCount(z: ZoneDef): number {
  let n = 0;
  for (const r of z.rounds) if (r.boss) for (const g of r.groups) if (ENEMIES[g.type].isBoss) n += g.count;
  return n;
}
