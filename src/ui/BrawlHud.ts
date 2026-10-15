import type { BrawlHud, GameContext, Obstacle } from '../core/types';
import type { GameEvents } from '../core/events';
import { STREAK_TIERS } from '../config/brawl';

/* Brawl-mode HUD layer: match timer, live leaderboard, kill feed, streak meter, announcements,
 * minimap and respawn overlay. Owned by UI; lives inside the HUD element so it fades with it. */

const METHOD_ICON: Record<GameEvents['brawlKill']['method'], string> = {
  slam: '⚪', ram: '🚜', dash: '⚡', whirl: '🌀', wall: '💥', other: '☠',
};
const ROW_H = 25;
const MAP_PX = 190;
const MAP_PAD = 9;
const MAP_INTERVAL = 66;
const FEED_MAX = 5;

function mk<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
function replay(e: HTMLElement, cls: string): void {
  e.classList.remove(cls);
  void e.offsetWidth;
  e.classList.add(cls);
}
/** Rival paint lifted toward white so names stay readable on the dark glass panels (kill feed, leaderboard). */
export function lightName(color: string): string {
  return `color-mix(in srgb, ${color} 62%, #fff)`;
}
export function fmtMult(m: number): string {
  return `x${Number.isInteger(m) ? m : m.toFixed(1)}`;
}
export function streakTier(streak: number): number {
  let t = 0;
  for (let i = 0; i < STREAK_TIERS.length; i++) if (streak >= STREAK_TIERS[i].at) t = i + 1;
  return t;
}
function streakPhrase(label: string): string {
  if (label === 'UNSTOPPABLE') return 'is UNSTOPPABLE';
  if (label === 'PLOWNADO') return 'has become a PLOWNADO';
  return `is on a ${label}`;
}

interface Row {
  root: HTMLElement;
  rank: HTMLElement;
  k: HTMLElement;
  d: HTMLElement;
  s: HTMLElement;
  pos: number;
  kills: number;
  deaths: number;
  streak: number;
  alive: boolean;
}

export class BrawlHudView {
  private ctx: GameContext;
  private active = false;
  private colors = new Map<string, string>();

  private timerBox: HTMLElement;
  private timeEl: HTMLElement;
  private goalEl: HTMLElement;
  private rankEl: HTMLElement;
  private feed: HTMLElement;
  private board: HTMLElement;
  private rowsBox: HTMLElement;
  private rows = new Map<string, Row>();
  private streakEl: HTMLElement;
  private streakN: HTMLElement;
  private streakM: HTMLElement;
  private banners: HTMLElement;
  private announce: HTMLElement;
  private annMain: HTMLElement;
  private annSub: HTMLElement;
  private respawn: HTMLElement;
  private respBy: HTMLElement;
  private respT: HTMLElement;
  private mapBox: HTMLElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement;
  private bgKey: { obs: readonly Obstacle[] | null; half: number; dpr: number; n: number } = { obs: null, half: 0, dpr: 0, n: -1 };
  private mapAt = 0;

  private last = { secs: -1, target: -1, rank: -1, total: -1, streak: -1, mult: -1, resp: -1, by: '' };

  constructor(ctx: GameContext, hud: HTMLElement, bottomCenter: HTMLElement) {
    this.ctx = ctx;
    const root = mk('div', 'ss-bh', undefined, hud);

    // respawn overlay (under everything else)
    this.respawn = mk('div', 'ss-bh-respawn hidden', undefined, root);
    const rc = mk('div', 'ss-bh-resp-card', undefined, this.respawn);
    mk('div', 'ss-bh-resp-title', 'WRECKED', rc);
    this.respBy = mk('div', 'ss-bh-resp-by', '', rc);
    this.respT = mk('div', 'ss-bh-resp-t', '', rc);

    // timer
    this.timerBox = mk('div', 'ss-bh-timer', undefined, root);
    this.timeEl = mk('div', 'ss-bh-time', '5:00', this.timerBox);
    const sub = mk('div', 'ss-bh-timer-sub', undefined, this.timerBox);
    this.goalEl = mk('span', 'ss-bh-goal', '', sub);
    this.rankEl = mk('span', 'ss-bh-rank', '', sub);

    // kill feed
    this.feed = mk('div', 'ss-bh-feed', undefined, root);

    // leaderboard
    this.board = mk('div', 'ss-bh-board ss-glass-dark', undefined, root);
    const head = mk('div', 'ss-bh-row ss-bh-head', undefined, this.board);
    mk('span', 'ss-bh-r', '#', head);
    mk('span', 'ss-bh-dot none', undefined, head);
    mk('span', 'ss-bh-n', 'PLOWER', head);
    mk('span', 'ss-bh-k', 'K', head);
    mk('span', 'ss-bh-d', 'D', head);
    mk('span', 'ss-bh-s', '🔥', head);
    this.rowsBox = mk('div', 'ss-bh-rows', undefined, this.board);

    // streak meter (above the ability row)
    this.streakEl = mk('div', 'ss-bh-streak', undefined, bottomCenter);
    bottomCenter.insertBefore(this.streakEl, bottomCenter.firstChild);
    mk('span', 'ss-bh-streak-f', '🔥', this.streakEl);
    this.streakN = mk('span', 'ss-bh-streak-n', '', this.streakEl);
    mk('span', 'ss-bh-streak-sep', '·', this.streakEl);
    this.streakM = mk('span', 'ss-bh-streak-m', '', this.streakEl);

    // announcements
    this.banners = mk('div', 'ss-bh-banners', undefined, root);
    this.announce = mk('div', 'ss-bh-announce', undefined, root);
    this.annMain = mk('div', 'ss-bh-ann-main', '', this.announce);
    this.annSub = mk('div', 'ss-bh-ann-sub', '', this.announce);
    this.announce.addEventListener('animationend', (e) => {
      if (e.target === this.announce) this.announce.classList.remove('go');
    });

    // minimap
    this.mapBox = mk('div', 'ss-bh-map ss-glass-dark', undefined, root);
    this.canvas = mk('canvas', 'ss-bh-canvas', undefined, this.mapBox);
    this.g = this.canvas.getContext('2d')!;
    this.bg = document.createElement('canvas');
    mk('div', 'ss-bh-map-n', 'N', this.mapBox);

    ctx.events.on('brawlKill', (e) => this.onKill(e));
    ctx.events.on('brawlStreak', (e) => this.onStreak(e));
    ctx.events.on('brawlShutdown', (e) => this.onShutdown(e));
  }

  /* ------------------------------------------------------------------ lifecycle */

  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    this.reset();
  }

  reset(): void {
    this.feed.replaceChildren();
    this.banners.replaceChildren();
    this.rowsBox.replaceChildren();
    this.rows.clear();
    this.announce.classList.remove('go');
    this.respawn.classList.add('hidden');
    this.streakEl.classList.remove('on');
    this.timerBox.classList.remove('hurry');
    const L = this.last;
    L.secs = L.target = L.rank = L.total = L.streak = L.mult = L.resp = -1;
    L.by = '';
    this.bgKey.obs = null;
    this.mapAt = 0;
  }

  /* ------------------------------------------------------------------ per frame */

  update(b: BrawlHud): void {
    const L = this.last;

    // timer
    const secs = Math.max(0, Math.ceil(b.timeLeft));
    if (secs !== L.secs) {
      L.secs = secs;
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      this.timeEl.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
      const hurry = secs <= 30 && secs > 0;
      this.timerBox.classList.toggle('hurry', hurry);
      if (hurry && secs <= 10) replay(this.timeEl, 'tick');
    }
    if (b.killTarget !== L.target) {
      L.target = b.killTarget;
      this.goalEl.textContent = `FIRST TO ${b.killTarget} KILLS`;
    }
    const total = b.leaderboard.length;
    if (b.playerRank !== L.rank || total !== L.total) {
      const better = L.rank > 0 && b.playerRank < L.rank;
      L.rank = b.playerRank;
      L.total = total;
      this.rankEl.textContent = `#${b.playerRank} / ${total}`;
      this.rankEl.classList.toggle('lead', b.playerRank === 1);
      if (better) replay(this.rankEl, 'up');
    }

    this.updateBoard(b);

    // streak meter
    const st = b.playerStreak;
    if (st !== L.streak || b.streakMult !== L.mult) {
      const grew = st > L.streak && L.streak >= 0;
      L.streak = st;
      L.mult = b.streakMult;
      this.streakEl.classList.toggle('on', st > 0);
      if (st > 0) {
        this.streakN.textContent = `${st} STREAK`;
        this.streakM.textContent = `${fmtMult(b.streakMult)} COINS`;
        this.streakEl.dataset.t = String(streakTier(st));
        if (grew) replay(this.streakEl, 'pop');
      }
    }

    // respawn overlay
    const r = b.respawnIn > 0 ? Math.ceil(b.respawnIn * 10) / 10 : 0;
    if (r !== L.resp) {
      if ((r > 0) !== (L.resp > 0)) this.respawn.classList.toggle('hidden', r <= 0);
      L.resp = r;
      if (r > 0) this.respT.textContent = `Respawning in ${r.toFixed(1)}`;
    }
    if (b.killedBy !== L.by) {
      L.by = b.killedBy;
      this.respBy.replaceChildren();
      if (b.killedBy) {
        mk('span', '', 'by ', this.respBy);
        const n = mk('b', '', b.killedBy, this.respBy);
        n.style.color = lightName(this.colors.get(b.killedBy) ?? '#fff');
      } else {
        this.respBy.textContent = 'Your plow got scrapped';
      }
    }

    // minimap (throttled)
    const now = performance.now();
    if (now - this.mapAt >= MAP_INTERVAL) {
      this.mapAt = now;
      this.drawMap(b, now);
    }
  }

  private updateBoard(b: BrawlHud): void {
    const list = b.leaderboard;
    let rebuild = list.length !== this.rows.size;
    if (!rebuild) for (let i = 0; i < list.length; i++) if (!this.rows.has(list[i].name)) { rebuild = true; break; }
    if (rebuild) {
      this.rowsBox.replaceChildren();
      this.rows.clear();
      this.rowsBox.style.height = `${list.length * ROW_H}px`;
      for (const e of list) {
        const root = mk('div', `ss-bh-row${e.isPlayer ? ' me' : ''}`, undefined, this.rowsBox);
        const rank = mk('span', 'ss-bh-r', '', root);
        const dot = mk('span', 'ss-bh-dot', undefined, root);
        dot.style.background = e.color;
        const n = mk('span', 'ss-bh-n', e.name, root);
        if (!e.isPlayer) n.style.color = lightName(e.color);
        const k = mk('span', 'ss-bh-k', '', root);
        const d = mk('span', 'ss-bh-d', '', root);
        const s = mk('span', 'ss-bh-s', '', root);
        this.rows.set(e.name, { root, rank, k, d, s, pos: -1, kills: -1, deaths: -1, streak: -1, alive: true });
        this.colors.set(e.name, e.color);
      }
    }
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const row = this.rows.get(e.name)!;
      if (row.pos !== i) {
        const climbed = row.pos >= 0 && i < row.pos;
        row.pos = i;
        row.root.style.transform = `translateY(${i * ROW_H}px)`;
        row.rank.textContent = String(i + 1);
        row.root.classList.toggle('first', i === 0);
        if (climbed) replay(row.root, 'climb');
      }
      if (e.kills !== row.kills) {
        row.kills = e.kills;
        row.k.textContent = String(e.kills);
      }
      if (e.deaths !== row.deaths) {
        row.deaths = e.deaths;
        row.d.textContent = String(e.deaths);
      }
      if (e.streak !== row.streak) {
        row.streak = e.streak;
        row.s.textContent = e.streak >= 2 ? `🔥${e.streak}` : '';
        row.s.dataset.t = String(streakTier(e.streak));
      }
      if (e.alive !== row.alive) {
        row.alive = e.alive;
        row.root.classList.toggle('dead', !e.alive);
      }
    }
  }

  /* ------------------------------------------------------------------ minimap */

  private drawMap(b: BrawlHud, now: number): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(MAP_PX * dpr);
    const cv = this.canvas;
    if (cv.width !== px) {
      cv.width = px;
      cv.height = px;
      this.bg.width = px;
      this.bg.height = px;
      this.bgKey.obs = null;
    }
    const half = Math.max(1, b.arenaHalf);
    const k = this.bgKey;
    if (k.obs !== b.obstacles || k.half !== half || k.dpr !== dpr || k.n !== b.obstacles.length) {
      k.obs = b.obstacles;
      k.half = half;
      k.dpr = dpr;
      k.n = b.obstacles.length;
      this.drawMapBg(b.obstacles, half, dpr);
    }
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, px, px);
    g.drawImage(this.bg, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sc = (MAP_PX - MAP_PAD * 2) / (2 * half);
    const ox = MAP_PAD + half * sc;

    // pickups
    g.strokeStyle = '#4dff8a';
    g.lineWidth = 2;
    g.beginPath();
    for (const p of b.pickups) {
      const x = ox + p.x * sc;
      const y = ox + p.z * sc;
      g.moveTo(x - 3.5, y);
      g.lineTo(x + 3.5, y);
      g.moveTo(x, y - 3.5);
      g.lineTo(x, y + 3.5);
    }
    g.stroke();

    // rivals
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.008);
    for (const bl of b.blips) {
      const x = ox + bl.x * sc;
      const y = ox + bl.z * sc;
      if (bl.bounty) {
        g.globalAlpha = 0.35 + 0.65 * pulse;
        g.strokeStyle = '#ffc531';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, 7 + pulse * 2.5, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }
      g.fillStyle = bl.color;
      g.strokeStyle = 'rgba(0,10,25,0.85)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(x, y, 4.2, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }

    // player arrow
    const mx = ox + b.me.x * sc;
    const my = ox + b.me.z * sc;
    g.save();
    g.translate(mx, my);
    g.rotate(Math.PI - b.me.heading);
    g.fillStyle = '#ff9b2f';
    g.strokeStyle = '#fff';
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(0, -8);
    g.lineTo(5.5, 6);
    g.lineTo(0, 3);
    g.lineTo(-5.5, 6);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  private drawMapBg(obs: readonly Obstacle[], half: number, dpr: number): void {
    const g = this.bg.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.bg.width, this.bg.height);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sc = (MAP_PX - MAP_PAD * 2) / (2 * half);
    const ox = MAP_PAD + half * sc;
    const w = 2 * half * sc;
    g.fillStyle = 'rgba(225, 242, 255, 0.16)';
    g.fillRect(MAP_PAD, MAP_PAD, w, w);
    // grid every 30m
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = 1;
    g.beginPath();
    for (let v = -half + 30; v < half; v += 30) {
      const p = ox + v * sc;
      g.moveTo(p, MAP_PAD);
      g.lineTo(p, MAP_PAD + w);
      g.moveTo(MAP_PAD, p);
      g.lineTo(MAP_PAD + w, p);
    }
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2;
    g.strokeRect(MAP_PAD, MAP_PAD, w, w);
    g.fillStyle = 'rgba(150, 168, 190, 0.9)';
    g.strokeStyle = 'rgba(40, 55, 75, 0.9)';
    g.lineWidth = 1;
    for (const o of obs) {
      g.beginPath();
      g.arc(ox + o.x * sc, ox + o.z * sc, Math.max(1.5, o.r * sc), 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }

  /* ------------------------------------------------------------------ events */

  private nameEl(name: string, color: string, parent: HTMLElement, me: boolean): void {
    const n = mk('b', `ss-bh-name${me ? ' me' : ''}`, name, parent);
    n.style.color = lightName(color);
  }

  private onKill(e: GameEvents['brawlKill']): void {
    if (!this.active) return;
    this.colors.set(e.victim, e.victimColor);
    if (e.killer) this.colors.set(e.killer, e.killerColor);
    const me = e.killerIsPlayer || e.victimIsPlayer;
    const row = mk('div', `ss-kf${me ? ' me' : ''}${e.victimIsPlayer ? ' died' : ''}`, undefined, this.feed);
    if (e.killer) {
      this.nameEl(e.killer, e.killerColor, row, e.killerIsPlayer);
      mk('span', 'ss-kf-icon', METHOD_ICON[e.method] ?? '☠', row);
      this.nameEl(e.victim, e.victimColor, row, e.victimIsPlayer);
    } else {
      mk('span', 'ss-kf-icon', METHOD_ICON[e.method] ?? '☠', row);
      this.nameEl(e.victim, e.victimColor, row, e.victimIsPlayer);
      mk('span', 'ss-kf-txt', 'got wrecked', row);
    }
    row.addEventListener('animationend', (ev) => {
      if (ev.target === row && ev.animationName === 'ss-kf-life') row.remove();
    });
    while (this.feed.childElementCount > FEED_MAX) this.feed.firstElementChild!.remove();
  }

  private onStreak(e: GameEvents['brawlStreak']): void {
    if (!this.active) return;
    this.colors.set(e.name, e.color);
    if (e.isPlayer) {
      this.bigAnnounce(`${e.label}!`, `${e.count} KILL STREAK · ${fmtMult(e.mult)} COINS`, `t${streakTier(e.count)}`);
    } else {
      const b = this.banner();
      this.nameEl(e.name, e.color, b, false);
      mk('span', '', ` ${streakPhrase(e.label)} `, b);
      mk('span', 'ss-bh-banner-n', `🔥${e.count}`, b);
    }
  }

  private onShutdown(e: GameEvents['brawlShutdown']): void {
    if (!this.active) return;
    if (e.killerIsPlayer) {
      this.bigAnnounce(`SHUTDOWN! +${e.bonus}`, `Ended ${e.victim}'s ${e.streak}-kill streak`, 'shut');
    } else {
      const b = this.banner('shut');
      this.nameEl(e.killer, this.colors.get(e.killer) ?? '#fff', b, false);
      mk('span', '', ' shut down ', b);
      this.nameEl(e.victim, this.colors.get(e.victim) ?? '#fff', b, false);
      mk('span', 'ss-bh-banner-n', `(${e.streak} streak)`, b);
    }
  }

  private banner(cls = ''): HTMLElement {
    const box = this.banners;
    while (box.childElementCount >= 3) box.firstElementChild!.remove();
    const b = mk('div', `ss-bh-banner ${cls}`, undefined, box);
    b.addEventListener('animationend', (ev) => {
      if (ev.target === b && ev.animationName === 'ss-bh-banner-life') b.remove();
    });
    return b;
  }

  private bigAnnounce(main: string, sub: string, cls: string): void {
    const a = this.announce;
    this.annMain.textContent = main;
    this.annSub.textContent = sub;
    a.className = `ss-bh-announce ${cls}`;
    void a.offsetWidth;
    a.classList.add('go');
  }
}
