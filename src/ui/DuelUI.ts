import './duel.css';
import { PLOWS, type PlowKind } from '../config/plows';

/* DUEL overlays (DOM only, no game logic): the HOST / JOIN lobby, the DUEL GARAGE strip shown over the Garage
 * panel, the in-match HUD (both plows' HP, round score, timer, ping), round banners and the match result with
 * REMATCH / LEAVE. The duel mode drives it through callbacks; every `.ss-duel-*` class is stable for probes. */

export interface DuelSide {
  name: string;
  plow: PlowKind;
  /** 0..1 */
  hpFrac: number;
  /** Rounds won this match. */
  wins: number;
}

export type RematchState = 'none' | 'asked' | 'oppAsked';

/** Unambiguous room-code alphabet (no 0/O, 1/I/L). */
export const ROOM_CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LEN = 5;

/** Upper-case, drop anything outside the alphabet, clip to the code length. */
export function cleanRoomCode(raw: string): string {
  let out = '';
  for (const ch of raw.toUpperCase()) {
    if (ROOM_CODE_CHARS.includes(ch)) out += ch;
    if (out.length >= ROOM_CODE_LEN) break;
  }
  return out;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

const fmt = (n: number) => Math.floor(Math.max(0, n)).toLocaleString('en-US');
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mmss = (s: number) => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

interface HudSideEls {
  root: HTMLElement;
  name: HTMLElement;
  fill: HTMLElement;
  chip: HTMLElement;
  pips: HTMLElement[];
}

export class DuelUI {
  private parent: HTMLElement;
  // Lobby.
  private lobby: HTMLElement;
  private lobbyChoose: HTMLElement;
  private lobbyHosting: HTMLElement;
  private codeBig: HTMLElement;
  private codeInput: HTMLInputElement;
  private status: HTMLElement;
  private lobbyH: { onHost(): void; onJoin(code: string): void; onCancel(): void } | null = null;
  private _lobbyOpen = false;
  private hostCode = '';
  // Garage strip.
  private garage: HTMLElement;
  private gTimer: HTMLElement;
  private gPowers: HTMLElement;
  private gBonus: HTMLElement;
  private gReady: HTMLButtonElement;
  private gOpp: HTMLElement;
  private onReady: (() => void) | null = null;
  // HUD.
  private hud: HTMLElement;
  private hudMe!: HudSideEls;
  private hudOpp!: HudSideEls;
  private hudTimer: HTMLElement;
  private hudRound: HTMLElement;
  private hudPing: HTMLElement;
  private roundsToWin = 2;
  private last = { timer: '', round: -1, ping: '', me: '', opp: '' };
  // Banner + result.
  private bannerEl: HTMLElement;
  private bannerTitle: HTMLElement;
  private bannerSub: HTMLElement;
  private bannerTimer = 0;
  private result: HTMLElement;
  private resultPanel: HTMLElement;
  private rematchBtn: HTMLButtonElement | null = null;
  private rematchNote: HTMLElement | null = null;

  constructor(parent: HTMLElement) {
    this.parent = parent;

    // ---- Lobby
    this.lobby = el('div', 'ss-screen ss-center ss-dim ss-duel-lobby', undefined, parent);
    this.lobby.setAttribute('aria-hidden', 'true');
    const lp = el('div', 'ss-panel ss-glass ss-icicles ss-duel-panel', undefined, this.lobby);
    el('h2', 'ss-h2', '⚔ DUEL', lp);
    el('div', 'ss-sub', 'A quick 1v1 against a friend. Best of 3 rounds. Each of you brings your own garage, and the weaker garage gets catch-up coins.', lp);
    this.lobbyChoose = el('div', 'ss-duel-choose', undefined, lp);
    const hostCol = el('div', 'ss-duel-col', undefined, this.lobbyChoose);
    el('div', 'ss-h3', 'Host', hostCol);
    el('div', 'ss-duel-hint', 'Get a room code and send it to your friend.', hostCol);
    const hostBtn = el('button', 'ss-btn ss-primary ss-duel-host', '📡 HOST', hostCol);
    hostBtn.addEventListener('click', () => this.lobbyH?.onHost());
    const joinCol = el('div', 'ss-duel-col', undefined, this.lobbyChoose);
    el('div', 'ss-h3', 'Join', joinCol);
    el('div', 'ss-duel-hint', "Type your friend's 5-letter code.", joinCol);
    const row = el('div', 'ss-duel-joinrow', undefined, joinCol);
    this.codeInput = el('input', 'ss-duel-code', undefined, row);
    this.codeInput.maxLength = ROOM_CODE_LEN;
    this.codeInput.placeholder = 'ABCDE';
    this.codeInput.autocomplete = 'off';
    this.codeInput.spellcheck = false;
    this.codeInput.setAttribute('aria-label', 'Room code');
    this.codeInput.addEventListener('input', () => {
      const c = cleanRoomCode(this.codeInput.value);
      if (c !== this.codeInput.value) this.codeInput.value = c;
    });
    const joinBtn = el('button', 'ss-btn ss-ice ss-duel-join', 'JOIN ▶', row);
    joinBtn.addEventListener('click', () => this.submitJoin());

    this.lobbyHosting = el('div', 'ss-duel-hosting hidden', undefined, lp);
    el('div', 'ss-duel-hint', 'Your room code:', this.lobbyHosting);
    this.codeBig = el('div', 'ss-duel-code-big', '', this.lobbyHosting);
    const copy = el('button', 'ss-btn ss-ice ss-small ss-duel-copy', '📋 COPY', this.lobbyHosting);
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(this.hostCode).then(
        () => this.setStatus('Code copied. Send it to your friend!', 'ok'),
        () => this.setStatus('Copy failed: read the code out instead.', 'error'),
      );
    });
    el('div', 'ss-duel-wait', 'Waiting for opponent…', this.lobbyHosting);

    this.status = el('div', 'ss-duel-status', '', lp);
    const foot = el('div', 'ss-panel-foot', undefined, lp);
    const back = el('button', 'ss-btn ss-ice ss-duel-cancel', '◀ BACK', foot);
    back.addEventListener('click', () => this.lobbyH?.onCancel());

    // Capture phase, like the Paint Shop: the lobby owns Enter / Escape while open.
    window.addEventListener('keydown', (e) => this.onKey(e), true);

    // ---- Duel garage strip (sits over the Garage screen, top of the viewport)
    this.garage = el('div', 'ss-duel-garage hidden', undefined, parent);
    this.gTimer = el('div', 'ss-duel-gtimer', '', this.garage);
    const gMid = el('div', 'ss-duel-gmid', undefined, this.garage);
    el('div', 'ss-duel-gtitle', '⚔ DUEL GARAGE', gMid);
    this.gPowers = el('div', 'ss-duel-gpowers', '', gMid);
    this.gBonus = el('div', 'ss-duel-gbonus', '', gMid);
    const gRight = el('div', 'ss-duel-gright', undefined, this.garage);
    this.gReady = el('button', 'ss-btn ss-primary ss-duel-ready', 'READY ✓', gRight);
    this.gReady.addEventListener('click', () => this.onReady?.());
    this.gOpp = el('div', 'ss-duel-gopp', '', gRight);

    // ---- HUD
    this.hud = el('div', 'ss-duel-hud hidden', undefined, parent);
    this.hudMe = this.side('me');
    const mid = el('div', 'ss-duel-hmid', undefined, this.hud);
    this.hudRound = el('div', 'ss-duel-hround', '', mid);
    this.hudTimer = el('div', 'ss-duel-htimer', '', mid);
    this.hudPing = el('div', 'ss-duel-hping', '', mid);
    this.hudOpp = this.side('opp');

    // ---- Round banner
    this.bannerEl = el('div', 'ss-duel-banner hidden', undefined, parent);
    this.bannerTitle = el('div', 'ss-duel-btitle', '', this.bannerEl);
    this.bannerSub = el('div', 'ss-duel-bsub', '', this.bannerEl);

    // ---- Result
    this.result = el('div', 'ss-screen ss-center ss-dim ss-duel-result', undefined, parent);
    this.result.setAttribute('aria-hidden', 'true');
    this.resultPanel = el('div', 'ss-panel ss-glass ss-icicles ss-duel-panel', undefined, this.result);
  }

  private side(which: 'me' | 'opp'): HudSideEls {
    const root = el('div', `ss-duel-side ss-duel-${which}`, undefined, this.hud);
    const head = el('div', 'ss-duel-shead', undefined, root);
    const name = el('div', 'ss-duel-sname', '', head);
    const pipWrap = el('div', 'ss-duel-pips', undefined, head);
    const bar = el('div', 'ss-duel-bar', undefined, root);
    const chip = el('div', 'ss-duel-chip', undefined, bar);
    const fill = el('div', 'ss-duel-fill', undefined, bar);
    return { root, name, fill, chip, pips: [pipWrap] };
  }

  /* ------------------------------------------------------------------ lobby */

  get lobbyOpen(): boolean {
    return this._lobbyOpen;
  }

  openLobby(h: { onHost(): void; onJoin(code: string): void; onCancel(): void }): void {
    this.lobbyH = h;
    this._lobbyOpen = true;
    this.hostCode = '';
    this.lobbyChoose.classList.remove('hidden');
    this.lobbyHosting.classList.add('hidden');
    this.codeInput.value = '';
    this.setStatus('');
    this.lobby.classList.add('show');
    this.lobby.setAttribute('aria-hidden', 'false');
    setTimeout(() => this._lobbyOpen && this.lobby.querySelector<HTMLButtonElement>('.ss-duel-host')?.focus({ preventScroll: true }), 30);
  }

  showHosting(code: string): void {
    this.hostCode = code;
    this.codeBig.textContent = code;
    this.lobbyChoose.classList.add('hidden');
    this.lobbyHosting.classList.remove('hidden');
  }

  setStatus(text: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
    this.status.textContent = text;
    this.status.dataset.kind = kind;
  }

  closeLobby(): void {
    this._lobbyOpen = false;
    this.lobby.classList.remove('show');
    this.lobby.setAttribute('aria-hidden', 'true');
    const a = document.activeElement as HTMLElement | null;
    if (a && this.lobby.contains(a)) a.blur();
  }

  private submitJoin(): void {
    const code = cleanRoomCode(this.codeInput.value);
    if (code.length !== ROOM_CODE_LEN) {
      this.setStatus(`Room codes are ${ROOM_CODE_LEN} letters.`, 'error');
      this.codeInput.focus();
      return;
    }
    this.setStatus(`Connecting to ${code}…`);
    this.lobbyH?.onJoin(code);
  }

  private onKey(e: KeyboardEvent): void {
    if (!this._lobbyOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.lobbyH?.onCancel();
    } else if (e.key === 'Enter' && document.activeElement === this.codeInput) {
      e.preventDefault();
      e.stopPropagation();
      this.submitJoin();
    } else if (document.activeElement === this.codeInput) {
      // Typing a code must not drive the plow / menus underneath.
      e.stopPropagation();
    }
  }

  /* ------------------------------------------------------------------ duel garage strip */

  showGarageBanner(o: {
    secondsLeft: number; ownPower: number; oppPower: number; bonus: number; bonusLeft: number;
    readySelf: boolean; readyOpp: boolean; onReady(): void;
  }): void {
    this.onReady = o.onReady;
    this.gPowers.innerHTML = `Opponent garage <b>${fmt(o.oppPower)}</b> · Yours <b>${fmt(o.ownPower)}</b>`;
    this.garage.classList.toggle('has-bonus', o.bonus > 0);
    this.garage.dataset.bonus = String(o.bonus);
    this.garage.classList.remove('hidden');
    this.updateGarageBanner(o);
  }

  updateGarageBanner(o: { secondsLeft: number; bonusLeft: number; readySelf: boolean; readyOpp: boolean }): void {
    const total = Number(this.garage.dataset.bonus ?? 0);
    this.gTimer.textContent = String(Math.max(0, Math.ceil(o.secondsLeft)));
    this.gTimer.classList.toggle('low', o.secondsLeft <= 10);
    this.gBonus.innerHTML = total > 0
      ? `Catch-up <span class="ss-coin sm"></span><b>+${fmt(total)}</b> · <b>${fmt(o.bonusLeft)}</b> left <small>(this match only, spent first)</small>`
      : 'No catch-up: your garage is the stronger one. Spend your own coins if you like.';
    this.gReady.disabled = o.readySelf;
    this.gReady.textContent = o.readySelf ? 'READY ✓ waiting…' : 'READY ✓';
    this.gOpp.textContent = o.readyOpp ? 'Opponent is ready' : 'Opponent is shopping…';
    this.gOpp.classList.toggle('ready', o.readyOpp);
  }

  hideGarageBanner(): void {
    this.garage.classList.add('hidden');
    this.onReady = null;
  }

  /* ------------------------------------------------------------------ HUD */

  showHud(roundsToWin: number): void {
    this.roundsToWin = roundsToWin;
    for (const s of [this.hudMe, this.hudOpp]) {
      const wrap = s.pips[0];
      wrap.textContent = '';
      s.pips.length = 1;
      for (let i = 0; i < roundsToWin; i++) s.pips.push(el('span', 'ss-duel-pip', undefined, wrap));
    }
    this.last = { timer: '', round: -1, ping: '', me: '', opp: '' };
    this.hud.classList.remove('hidden');
  }

  updateHud(o: { me: DuelSide; opp: DuelSide; timeLeft: number; round: number; pingMs: number | null }): void {
    this.paintSide(this.hudMe, o.me, 'me');
    this.paintSide(this.hudOpp, o.opp, 'opp');
    const t = mmss(o.timeLeft);
    if (t !== this.last.timer) {
      this.last.timer = t;
      this.hudTimer.textContent = t;
      this.hudTimer.classList.toggle('low', o.timeLeft <= 10);
    }
    if (o.round !== this.last.round) {
      this.last.round = o.round;
      this.hudRound.textContent = `ROUND ${o.round}`;
    }
    const p = o.pingMs === null ? '' : `${Math.round(o.pingMs)} ms`;
    if (p !== this.last.ping) {
      this.last.ping = p;
      this.hudPing.textContent = p ? `📶 ${p}` : '';
      this.hudPing.classList.toggle('bad', (o.pingMs ?? 0) > 150);
    }
  }

  private paintSide(s: HudSideEls, d: DuelSide, which: 'me' | 'opp'): void {
    const hp = Math.round(clamp01(d.hpFrac) * 200) / 200;
    const key = `${d.name}|${d.plow}|${hp}|${d.wins}`;
    if (key === this.last[which]) return;
    this.last[which] = key;
    const def = PLOWS[d.plow];
    s.name.textContent = `${def?.icon ?? '🚜'} ${d.name}`;
    s.root.dataset.plow = d.plow;
    s.fill.style.transform = `scaleX(${hp})`;
    // The chip trails behind the fill (CSS transition) so chunks of damage read.
    s.chip.style.transform = `scaleX(${hp})`;
    s.root.classList.toggle('low', hp < 0.3);
    for (let i = 1; i < s.pips.length; i++) s.pips[i].classList.toggle('on', i <= d.wins);
  }

  hideHud(): void {
    this.hud.classList.add('hidden');
  }

  /* ------------------------------------------------------------------ banner + result */

  banner(title: string, sub = '', ms = 1600): void {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.bannerSub.classList.toggle('hidden', !sub);
    const b = this.bannerEl;
    b.classList.remove('hidden', 'go');
    void b.offsetWidth;
    b.classList.add('go');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => b.classList.add('hidden'), ms);
  }

  showResult(o: { won: boolean; myWins: number; oppWins: number; oppName: string; onRematch(): void; onLeave(): void }): void {
    const p = this.resultPanel;
    p.textContent = '';
    p.classList.toggle('win', o.won);
    p.classList.toggle('lose', !o.won);
    el('div', 'ss-result-emoji', o.won ? '🏆' : '💥', p);
    el('h2', 'ss-h2 ss-result-title', o.won ? 'YOU WIN THE DUEL!' : 'DUEL LOST', p);
    el('div', 'ss-sub', o.won ? `You beat ${o.oppName}. Bragging rights secured.` : `${o.oppName} took it. Run it back?`, p);
    const score = el('div', 'ss-duel-score', undefined, p);
    el('span', o.won ? 'win' : '', String(o.myWins), score);
    el('span', 'dash', '–', score);
    el('span', o.won ? '' : 'win', String(o.oppWins), score);
    this.rematchNote = el('div', 'ss-duel-rnote', '', p);
    const btns = el('div', 'ss-result-btns', undefined, p);
    this.rematchBtn = el('button', 'ss-btn ss-primary ss-big ss-duel-rematch', '↻ REMATCH', btns);
    this.rematchBtn.addEventListener('click', () => o.onRematch());
    const leave = el('button', 'ss-btn ss-ice ss-duel-leave', '🏠 LEAVE', btns);
    leave.addEventListener('click', () => o.onLeave());
    this.setRematch('none');
    this.result.classList.add('show');
    this.result.setAttribute('aria-hidden', 'false');
    setTimeout(() => this.rematchBtn?.focus({ preventScroll: true }), 30);
  }

  setRematch(state: RematchState): void {
    if (!this.rematchBtn || !this.rematchNote) return;
    this.rematchBtn.disabled = state === 'asked';
    this.rematchBtn.textContent = state === 'asked' ? '↻ WAITING…' : state === 'oppAsked' ? '↻ ACCEPT REMATCH' : '↻ REMATCH';
    this.rematchBtn.classList.toggle('pulse', state === 'oppAsked');
    this.rematchNote.textContent = state === 'asked' ? 'Waiting for your opponent to accept…' : state === 'oppAsked' ? 'Your opponent wants a rematch!' : '';
  }

  hideResult(): void {
    this.result.classList.remove('show');
    this.result.setAttribute('aria-hidden', 'true');
    this.rematchBtn = null;
    this.rematchNote = null;
  }

  hideAll(): void {
    this.closeLobby();
    this.hideGarageBanner();
    this.hideHud();
    this.hideResult();
    this.bannerEl.classList.add('hidden');
    clearTimeout(this.bannerTimer);
  }
}
