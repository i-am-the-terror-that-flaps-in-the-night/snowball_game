import './ui.css';
import './brawl.css';
import type { BrawlDifficulty, BrawlEntry, BrawlResult, GameContext, HudBoss, HudState, RunSummary, SoundName, UIAPI, UIHandlers } from '../core/types';
import { MIN_BALL_RADIUS } from '../core/types';
import { UPGRADES, type UpgradeCategory, type UpgradeDef } from '../config/upgrades';
import { ZONES, type ZoneDef } from '../config/zones';
import { ENEMIES, type EnemyDef, type EnemyType } from '../config/enemies';
import {
  BRAWL_BOTS, BRAWL_DIFFICULTIES, BRAWL_KILL_COINS, BRAWL_KILL_TARGET, BRAWL_PLACEMENT_BONUS, BRAWL_RESPAWN,
  BRAWL_SHUTDOWN_PER_STREAK, BRAWL_TIME, STREAK_TIERS,
} from '../config/brawl';
import { BrawlHudView, fmtMult } from './BrawlHud';

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

const CATEGORIES: { id: UpgradeCategory; label: string; icon: string }[] = [
  { id: 'plow', label: 'Plow', icon: '🚜' },
  { id: 'ball', label: 'Snowball', icon: '⚪' },
  { id: 'defense', label: 'Defense', icon: '🛡️' },
  { id: 'special', label: 'Specials', icon: '✨' },
];

const ENEMY_ICON: Record<EnemyType, string> = {
  scrapper: '🤖', brute: '🚧', spinner: '🪚', thief: '🦝',
  bulldoza: '🚜', frostbyte: '👾', grinder: '🔩', slush: '🔴', sleet: '🔵', omega: '💀', rival: '🚜',
};

const ENEMY_TIP: Partial<Record<EnemyType, string>> = {
  scrapper: 'FAST', brute: 'FRONT ARMOR', spinner: 'OVERHEATS', thief: 'STEALS SNOW',
};

const CONTROLS: [string[], string][] = [
  [['W', '↑'], 'Accelerate'],
  [['S', '↓'], 'Brake / reverse'],
  [['A', 'D'], 'Steer'],
  [['SPACE'], 'SLAM snowball'],
  [['SHIFT'], 'DASH STRIKE (long burst)'],
  [['E'], 'Whirlwind tornado'],
  [['ESC', 'P'], 'Pause'],
  [['M'], 'Mute sound'],
];

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

interface CardRefs {
  def: UpgradeDef;
  root: HTMLElement;
  pips: HTMLElement[];
  cur: HTMLElement;
  next: HTMLElement;
  arrow: HTMLElement;
  buy: HTMLButtonElement;
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
  private resetBtn!: HTMLButtonElement;
  private resetArmed = 0;

  // zones
  private zoneGrid!: HTMLElement;

  // garage / shop
  private shopTitle!: HTMLElement;
  private shopSub!: HTMLElement;
  private shopCoins!: HTMLElement;
  private shopPreview!: HTMLElement;
  private shopBack!: HTMLButtonElement;
  private shopStart!: HTMLButtonElement;
  private shopHint!: HTMLElement;
  private cards: CardRefs[] = [];
  private shopContinue: (() => void) | null = null;
  private garageBack: 'menu' | 'quit' = 'menu';

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
    gauge: HTMLElement; ring: SVGCircleElement; radius: HTMLElement; tier: HTMLElement;
    slam: HTMLElement; shield: HTMLElement; blocked: HTMLElement;
    dash: HTMLElement; whirl: HTMLElement;
    snowFill: HTMLElement; snowTxt: HTMLElement;
    count: HTMLElement; hint: HTMLElement;
  };
  private last = {
    zone: '', round: -1, total: -1, bossRound: false, enemies: -1,
    coins: -1, plowHp: -1, plowMax: -1, plowF: -1, low: false, mid: false,
    ballR: -1, ballFrac: -1, tier: -1, ready: false, full: false, held: false,
    dash: -1, whirl: -2, combo: 0, comboTier: -1, snow: -1, count: -1, bossCount: -1, brawl: -1,
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
    for (const [keys, label] of CONTROLS) {
      const row = el('div', 'ss-ctrl-row', undefined, list);
      const k = el('div', 'ss-keys', undefined, row);
      keys.forEach((key, i) => {
        if (i) el('span', 'ss-key-sep', '/', k);
        el('kbd', 'ss-kbd', key, k);
      });
      el('span', 'ss-ctrl-label', label, row);
    }
    return list;
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
      (bm > 0 ? `  ·  🥇 Brawl wins ${fmt(bw)}/${fmt(bm)}` : '');
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
      } else if (name === 'garage' && !this.shopContinue) {
        e.preventDefault();
        this.shopBack.click();
      }
      return;
    }
    const isActivate = code === 'Enter' || code === 'NumpadEnter' || code === 'Space';
    if (isActivate) {
      e.preventDefault();
      if (e.repeat || performance.now() - this.shownAt < 450) return;
      if (name === 'garage' && this.shopContinue && code !== 'Space') {
        this.shopStart.click();
        return;
      }
      const a = document.activeElement;
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
    this.btn('🔧 GARAGE', 'ss-ice', () => this.openGarage('menu'), btns);
    this.btn('❓ HOW TO PLAY', 'ss-ice', () => this.show('howto'), btns);
    const row = el('div', 'ss-menu-row', undefined, btns);
    const mute = this.btn('', 'ss-ice ss-small', () => {
      this.handlers.onToggleMute();
      this.refreshMute();
    }, row);
    this.muteBtns.push(mute);
    this.resetBtn = this.btn('🗑 RESET SAVE', 'ss-ice ss-small ss-danger', () => this.onResetClick(), row);

    this.menuStats = el('div', 'ss-menu-stats', '', panel);
    el('div', 'ss-credits', 'PvE arena brawler · Three.js · procedural everything', panel);
    this.refreshMute();
  }

  private onResetClick(): void {
    const now = performance.now();
    if (now - this.resetArmed < 3000) {
      this.resetArmed = 0;
      this.resetBtn.innerHTML = '🗑 RESET SAVE';
      this.resetBtn.classList.remove('armed');
      this.handlers.onResetSave();
      this.refreshProgress();
      this.toast('Save data reset. Fresh snow!', 'info');
      return;
    }
    this.resetArmed = now;
    this.resetBtn.innerHTML = '⚠ CLICK AGAIN TO CONFIRM';
    this.resetBtn.classList.add('armed');
    setTimeout(() => {
      if (performance.now() - this.resetArmed >= 2900) {
        this.resetBtn.innerHTML = '🗑 RESET SAVE';
        this.resetBtn.classList.remove('armed');
      }
    }, 3050);
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
    el('h2', 'ss-h2', 'CHOOSE YOUR ARENA', panel);
    this.zoneGrid = el('div', 'ss-zone-grid', undefined, panel);
    const foot = el('div', 'ss-panel-foot', undefined, panel);
    this.btn('◀ BACK', 'ss-ice', () => this.showMainMenu(), foot);
  }

  private renderZones(): void {
    const p = this.ctx.progression;
    this.zoneGrid.textContent = '';
    let firstPlayable: HTMLButtonElement | null = null;
    ZONES.forEach((z, i) => {
      const unlocked = p.isZoneUnlocked(i);
      const rec = p.zoneRecord(z.id);
      const total = z.rounds.length;
      const card = el('button', `ss-zone ${unlocked ? '' : 'locked'} ${rec.cleared ? 'cleared' : ''}`, undefined, this.zoneGrid);
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
      if (rec.cleared) el('div', 'ss-zone-badge', '✓ CLEARED', bottom);
      el('div', 'ss-zone-stat', `⚔ ${total} rounds (${total - 1} + boss)`, bottom);
      const best = Math.min(rec.bestRound, total);
      el('div', 'ss-zone-stat', best > 0 ? `🏁 Best: round ${best}/${total}` : '🏁 Best: —', bottom);
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
      if (unlocked && !rec.cleared && !firstPlayable) firstPlayable = card;
      if (unlocked && i === p.data.unlockedZones - 1) firstPlayable = card;
    });
    const fp = firstPlayable as HTMLButtonElement | null;
    this.zoneGrid.querySelectorAll('[data-primary]').forEach((n) => delete (n as HTMLElement).dataset.primary);
    if (fp) fp.dataset.primary = '1';
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

    const body = el('div', 'ss-shop-body', undefined, panel);
    for (const cat of CATEGORIES) {
      const sec = el('section', `ss-cat ss-cat-${cat.id}`, undefined, body);
      const h = el('h3', 'ss-cat-title', undefined, sec);
      el('span', 'ss-cat-icon', cat.icon, h);
      el('span', '', cat.label, h);
      const grid = el('div', 'ss-card-grid', undefined, sec);
      for (const def of UPGRADES.filter((u) => u.category === cat.id)) this.cards.push(this.buildCard(def, grid));
    }

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

  private buildCard(def: UpgradeDef, parent: HTMLElement): CardRefs {
    const root = el('div', 'ss-card', undefined, parent);
    root.dataset.id = def.id;
    el('div', 'ss-card-icon', def.icon, root);
    const info = el('div', 'ss-card-info', undefined, root);
    el('div', 'ss-card-name', def.name, info);
    el('div', 'ss-card-desc', def.description, info);
    const pipsEl = el('div', 'ss-pips', undefined, info);
    const pips: HTMLElement[] = [];
    for (let i = 0; i < def.maxLevel; i++) pips.push(el('span', 'ss-pip', undefined, pipsEl));
    const val = el('div', 'ss-card-val', undefined, info);
    const cur = el('span', 'ss-val-cur', '', val);
    const arrow = el('span', 'ss-val-arrow', '→', val);
    const next = el('span', 'ss-val-next', '', val);
    const buy = el('button', 'ss-btn ss-buy', '', root);
    buy.type = 'button';
    buy.addEventListener('click', () => this.onBuy(def, root));
    return { def, root, pips, cur, next, arrow, buy };
  }

  private onBuy(def: UpgradeDef, card: HTMLElement): void {
    const p = this.ctx.progression;
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
    const p = this.ctx.progression;
    for (const c of this.cards) {
      const lvl = p.level(c.def.id);
      const maxed = p.isMaxed(c.def.id);
      const afford = p.canBuy(c.def.id);
      c.pips.forEach((pip, i) => pip.classList.toggle('on', i < lvl));
      c.cur.textContent = c.def.valueLabel(lvl);
      c.next.textContent = maxed ? '' : c.def.valueLabel(lvl + 1);
      c.arrow.style.display = maxed ? 'none' : '';
      c.root.classList.toggle('maxed', maxed);
      c.root.classList.toggle('poor', !maxed && !afford);
      c.root.classList.toggle('afford', afford);
      c.buy.innerHTML = maxed ? (c.def.maxLevel === 1 ? '✓ OWNED' : '★ MAXED') : `<span class="ss-coin sm"></span>${fmt(p.cost(c.def.id))}`;
      c.buy.setAttribute('aria-disabled', afford ? 'false' : 'true');
    }
  }

  private openGarage(back: 'menu' | 'quit'): void {
    this.garageBack = back;
    this.shopContinue = null;
    this.shopTitle.textContent = 'GARAGE';
    this.shopSub.textContent = 'Spend your coins on permanent upgrades.';
    this.shopPreview.classList.add('hidden');
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
    el('div', 'ss-sub', 'The bots are politely idling their engines.', panel);
    const btns = el('div', 'ss-stack', undefined, panel);
    this.btn('▶ RESUME', 'ss-primary ss-big', () => this.handlers.onResume(), btns).dataset.primary = '1';
    const mute = this.btn('', 'ss-ice', () => {
      this.handlers.onToggleMute();
      this.refreshMute();
    }, btns);
    this.muteBtns.push(mute);
    this.btn('⏏ QUIT TO MENU', 'ss-ice ss-danger', () => this.handlers.onQuitToMenu(), btns);
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
    el('div', 'ss-result-emoji', win ? '🏆' : '💥', p);
    el('h2', 'ss-h2 ss-result-title', win ? `${sum.bossName} DESTROYED!` : 'WRECKED!', p);
    el(
      'div',
      'ss-sub',
      win
        ? `${sum.zoneName} cleared! The arena is yours.`
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
    stat('🏁', win ? 'Rounds cleared' : 'Rounds survived', `${sum.roundsCleared}/${sum.totalRounds}`, 100);
    stat('🤖', 'Bots scrapped', fmt(sum.kills), 180);
    stat('🔥', 'Best combo', sum.bestCombo >= 2 ? `x${sum.bestCombo}` : '—', 260);
    stat('⚪', 'Biggest ball', `${sum.biggestBall.toFixed(2)} m`, 340);
    stat('🪙', 'Coins earned', `+${fmt(sum.coinsEarned)}`, 420);

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
        this.btn('NEXT ARENA ▶', 'ss-primary ss-big', () => this.handlers.onStartZone(nextIdx), btns).dataset.primary = '1';
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
    H.slam = el('div', 'ss-slam-hint', undefined, bc);
    H.slam.innerHTML = '<kbd class="ss-kbd">SPACE</kbd> SLAM!';

    // bottom-right: snow remaining
    const br = el('div', 'ss-hud-br ss-glass-dark', undefined, hud);
    el('span', 'ss-snow-label', '❄ SNOW', br);
    const sb = el('div', 'ss-snow-bar', undefined, br);
    H.snowFill = el('div', 'ss-snow-fill', undefined, sb);
    H.snowTxt = el('span', 'ss-snow-txt', '', br);

    H.count = el('div', 'ss-count hidden', '', hud);
    H.hint = el('div', 'ss-hint hidden', 'W/S drive  ·  A/D steer  ·  plow snow to grow a ball  ·  SPACE slam  ·  SHIFT dash strike  ·  E whirlwind  ·  ESC pause', hud);
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
    this.shopTitle.textContent = 'UPGRADE SHOP';
    const cleared = Math.max(1, nextRound - 1);
    this.shopSub.textContent = `${this.ctx.zone?.name ?? ''}: round ${cleared} cleared! Gear up before the next fight.`;
    this.renderRoundPreview(nextRound, totalRounds);
    this.shopBack.classList.add('hidden');
    this.shopStart.classList.remove('hidden');
    this.shopHint.classList.remove('hidden');
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

  showPause(): void {
    this.refreshMute();
    this.show('pause');
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
    if (s.round !== L.round || s.totalRounds !== L.total || s.bossRound !== L.bossRound) {
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
