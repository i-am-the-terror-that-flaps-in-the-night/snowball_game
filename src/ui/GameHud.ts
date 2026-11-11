/** In-game HUD: arena / round box, boss bars, coins, plow HP, snowball gauge, abilities, damage vignette and the boss intro. */
import type { GameContext, HudBoss, HudState } from '../core/types';
import { isVehicle } from '../config/plows';
import { keyLabel, type Action } from '../core/input';
import { BrawlHudView } from './BrawlHud';
import { RadarHud } from './RadarHud';
import { el, restart } from './uiKit';
import {
  INTRO_MS, assignSlot, buildHudDom, freeSlot, hudLast, renderPips, setSlotHp, updateHudPanels, type BossSlot, type HudRefs,
} from './hudParts';

/** Toasts: default top (px) and gap under the lowest top HUD box their column crosses. */
const TOAST_TOP = 96;
const TOAST_GAP = 12;

export class GameHud {
  private ctx: GameContext;
  private rootEl: HTMLElement;
  /** UI's toast column (created after the HUD) and its full key-prompt refresh (controls lists + HUD). */
  private getToastBox: () => HTMLElement;
  private refreshKeys: () => void;

  private bh!: BrawlHudView;
  /** Campaign / Survival minimap + lost-bot arrows. */
  radar!: RadarHud;

  // hud
  private hud!: HTMLElement;
  private hudVisible = false;
  /** Top HUD boxes the toasts start under (round box, boss bars, coin box, radar) and whether their sizes changed. */
  private topBoxes: HTMLElement[] = [];
  private topDirty = true;
  private radarShown = false;
  private bossSlots: BossSlot[] = [];
  private h = {} as HudRefs;
  private last = hudLast();
  private hintTimer = 0;

  // fx
  private vignette!: HTMLElement;
  private intro!: HTMLElement;
  private introName!: HTMLElement;
  private introTitle!: HTMLElement;
  private introTimer = 0;

  constructor(ctx: GameContext, rootEl: HTMLElement, getToastBox: () => HTMLElement, refreshKeys: () => void) {
    this.ctx = ctx;
    this.rootEl = rootEl;
    this.getToastBox = getToastBox;
    this.refreshKeys = refreshKeys;
    this.vignette = el('div', 'ss-vignette', undefined, this.rootEl);
    this.buildHud();
    this.buildIntro();
  }

  private get toastBox(): HTMLElement {
    return this.getToastBox();
  }

  /** The HUD half of UI.refreshKeys: ability key labels and the first-run hint. */
  refreshKeyLabels(): void {
    if (!this.h.hint) return;
    const k = (a: Action) => keyLabel(this.ctx.input.keysFor(a)[0] ?? '?');
    const setKey = (ab: HTMLElement, a: Action) => {
      const kbd = ab.querySelector('.ss-ab-key');
      if (kbd) kbd.textContent = k(a);
    };
    setKey(this.h.dash, 'dash');
    setKey(this.h.whirl, 'whirl');
    setKey(this.h.flame, 'ability');
    setKey(this.h.primary, 'slam');
    const ab = isVehicle(this.ctx.stats) ? this.ctx.combat?.abilityHud : null;
    this.h.hint.textContent = ab
      ? `${k('forward')}/${k('back')} drive  ·  ${k('left')}/${k('right')} steer  ·  ${k('slam')} ${ab.primary.hint ?? ab.primary.label}  ·  ` +
        `${k('dash')} dash strike  ·  ${k('whirl')} ${ab.secondary.hint ?? ab.secondary.label}  ·  ${k('ability')} F-ability  ·  ESC pause`
      : `${k('forward')}/${k('back')} drive  ·  ${k('left')}/${k('right')} steer  ·  plow snow to grow a ball  ·  ` +
        `${k('slam')} ${this.ctx.stats.plowKind === 'classic' ? 'tap: slam, hold: plow rush' : 'slam'}  ·  ` +
        `${k('dash')} dash strike  ·  ${k('whirl')} whirlwind  ·  ${k('ability')} F-ability  ·  ESC pause`;
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

  endIntro(): void {
    clearTimeout(this.introTimer);
    this.intro?.classList.remove('go');
    this.hud?.classList.remove('intro');
  }

  onBossPhase(name: string, label: string): void {
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
    const { tl, bc } = buildHudDom(hud, H, this.bossSlots);
    this.bh = new BrawlHudView(this.ctx, hud, bc);
    this.radar = new RadarHud(this.ctx, hud);
    this.topBoxes = [tl, H.bosses, H.coinBox, hud.querySelector<HTMLElement>('.ss-radar')!];
    window.addEventListener('resize', () => (this.topDirty = true));
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
      if (slot.key !== key || slot.down) assignSlot(slot, key, b);
      slot.mark = true;
      setSlotHp(slot, b.hp, b.maxHp);
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
          freeSlot(s);
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
      this.topDirty = true;
    }
  }

  /**
   * Place what depends on the top HUD's real size (only when it changed: text, boss count, radar, resize; never per
   * frame). --hud-tl-b = bottom of the round box (narrow screens stack the boss bars under it, ui.css); --hud-toast-y =
   * toast top, under every top box the centred toast column crosses, so a toast never lands on the boss bars, the round
   * box or the radar however they are laid out.
   */
  private layoutTop(): void {
    this.topDirty = false;
    const root = this.rootEl;
    const tl = this.topBoxes[0];
    root.style.setProperty('--hud-tl-b', `${tl.offsetTop + tl.offsetHeight}px`);
    const o = root.getBoundingClientRect();
    const col = this.toastBox.getBoundingClientRect(); // the toasts' column (ui.css sizes it; longer toasts wrap)
    const cl = col.left;
    const cr = col.right;
    let y = TOAST_TOP - TOAST_GAP;
    for (const e of this.topBoxes) {
      if (e.offsetParent === null) continue;
      const b = e.getBoundingClientRect();
      if (b.height >= 1 && b.left < cr && b.right > cl) y = Math.max(y, b.bottom - o.top);
    }
    root.style.setProperty('--hud-toast-y', `${Math.round(y + TOAST_GAP)}px`);
    this.radar.relayout(); // the lost-bot arrows keep clear of the same boxes
  }

  pulse(amount: number, blocked: number): void {
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
    for (const s of this.bossSlots) freeSlot(s);
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

  /** Duel HUD mode: the campaign arena / coin / snow panels make way for DuelUI's top bar. */
  setDuelHud(on: boolean): void {
    this.hud.classList.toggle('duel', on);
  }

  setHudVisible(visible: boolean): void {
    if (visible === this.hudVisible) return;
    this.hudVisible = visible;
    this.hud.classList.toggle('show', visible);
    this.topDirty = true;
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
    if (!!s.radar !== this.radarShown) {
      this.radarShown = !!s.radar;
      this.topDirty = true;
    }

    if (s.zoneName !== L.zone) {
      L.zone = s.zoneName;
      H.zone.textContent = s.zoneName;
      this.topDirty = true;
    }
    const hideRound = !!s.hideRound;
    if (hideRound !== L.hideRound) {
      L.hideRound = hideRound;
      this.topDirty = true;
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
        H.round.textContent = `${s.bossRound ? '☠ BOSS ' : ''}Wave ${sv.wave}`;
        H.round.classList.toggle('boss', s.bossRound);
        H.best.textContent = `Best ${sv.best}`;
        H.best.classList.remove('hidden');
        renderPips({ h: this.h, ctx: this.ctx }, 0, 0);
        this.topDirty = true;
      }
    } else if (s.round !== L.round || s.totalRounds !== L.total || s.bossRound !== L.bossRound) {
      L.round = s.round;
      L.total = s.totalRounds;
      L.bossRound = s.bossRound;
      H.round.textContent = s.bossRound ? '☠ BOSS ROUND' : `Round ${s.round}/${s.totalRounds}`;
      H.round.classList.toggle('boss', s.bossRound);
      H.best.classList.add('hidden');
      renderPips({ h: this.h, ctx: this.ctx }, s.round, s.totalRounds);
      this.topDirty = true;
    }
    // Survival / Daily biome rotation: count down to the next arena over the last two waves of a block.
    const arena = sv && sv.arenaIn !== undefined && sv.arenaIn <= 2 && sv.nextArena
      ? sv.arenaIn === 1 ? `Last wave here · next: ${sv.nextArena}` : `New arena in ${sv.arenaIn} waves: ${sv.nextArena}`
      : '';
    if (arena !== L.arena) {
      L.arena = arena;
      H.arena.textContent = arena;
      H.arena.classList.toggle('hidden', !arena);
      H.arena.classList.toggle('last', sv?.arenaIn === 1);
      this.topDirty = true;
    }
    const en = Math.max(0, Math.round(s.enemiesRemaining));
    if (en !== L.enemies) {
      L.enemies = en;
      H.enemies.textContent = en > 0 ? `${en} bot${en === 1 ? '' : 's'} left` : 'Get ready…';
      this.topDirty = true; // "9 bots" -> "10 bots" can wrap the round row
    }

    // bosses
    if (!brawl && (s.bosses.length || L.bossCount > 0)) this.updateBosses(s.bosses);
    if (this.topDirty) this.layoutTop();
    // After the layout: off-screen arrows are placed with this frame's boss bars / round box, not last frame's.
    this.radar.update(s.radar);

    updateHudPanels({ h: H, last: L, hud: this.hud, refreshKeys: () => this.refreshKeys() }, s);
  }
}
