import * as THREE from 'three';
import type { GameContext, PlayerStats } from '../core/types';
import type { GameEvents } from '../core/events';
import { computeStatsFor } from '../core/Progression';
import { PLOWS, type PlowKind } from '../config/plows';
import type { CosmeticSlot } from '../config/cosmetics';
import type { UpgradeId } from '../config/upgrades';
import {
  DUEL_BETWEEN_ROUNDS, DUEL_COUNTDOWN, DUEL_DRAW_EPS, DUEL_GARAGE_SECONDS, DUEL_MAX_ROUNDS, DUEL_REMATCH_GARAGE_SECONDS,
  DUEL_ROUND_END_DELAY, DUEL_ROUND_SECONDS, DUEL_ROUNDS_TO_WIN, DUEL_SNOW_REGEN, DUEL_SPAWNS, catchUp, cleanLevels,
  duelPower, garageSpent,
} from '../config/duel';
import { Plow } from '../entities/Plow';
import { Combat } from '../entities/Combat';
import { cosmeticsState } from '../meta/cosmetics';
import type { SnowField } from '../world/SnowField';
import type { Transport } from '../net/transport';
import {
  INPUT_BYTES, MSG_SNAP, MSG_SNOW, NET_PLOW_LEN, NP, PROTOCOL_VERSION, SNAP_BYTES, decodeInput, decodeSnap, decodeSnow,
  encodeInput, encodeSnap, encodeSnow, fromJson, toJson, type InputFrame, type SnapHeader, type SnowPatch,
} from '../net/protocol';
import { DuelWallet } from './DuelWallet';
import { NO_TARGETS, OpponentTarget, PlowHandle, type DuelHit } from './opponent';
import {
  AutoPilot, DuelPilot, GatedInput, NetInput, PilotEvents, PoseHistory, PuppetInput, ReadOnlySnow, RemoteAudio, SnapBuffer,
} from './plumbing';
import type { InputSource } from '../entities/pilot';

export type DuelRole = 'host' | 'guest';
export type DuelPhase = 'lobby' | 'garage' | 'countdown' | 'fight' | 'roundEnd' | 'results';
const PHASES: DuelPhase[] = ['lobby', 'garage', 'countdown', 'fight', 'roundEnd', 'results'];

/** What each player brings (sent in the handshake, refreshed for every rematch). */
export interface DuelProfile {
  name: string;
  plow: PlowKind;
  look: Partial<Record<CosmeticSlot, string>>;
  /** Saved upgrade levels (the garage), coins on hand, and what those levels cost (from the cost curves). */
  levels: Partial<Record<UpgradeId, number>>;
  coins: number;
  spent: number;
}

/** Game-side hooks the duel drives (screens, garage, leaving). */
export interface DuelHooks {
  /** Back to the main menu; `message` explains why (opponent left, link lost). */
  exit(message?: string): void;
  openGarage(wallet: DuelWallet, info: { ownPower: number; oppPower: number; bonus: number }): void;
  closeGarage(): void;
  /** The lead's Duel UI (banner, HUD, results). */
  ui: DuelUIApi;
}

/** The subset of src/ui/DuelUI.ts the manager uses. */
export interface DuelUIApi {
  showGarageBanner(o: { secondsLeft: number; ownPower: number; oppPower: number; bonus: number; bonusLeft: number; readySelf: boolean; readyOpp: boolean; onReady(): void }): void;
  updateGarageBanner(o: { secondsLeft: number; bonusLeft: number; readySelf: boolean; readyOpp: boolean }): void;
  hideGarageBanner(): void;
  showHud(roundsToWin: number): void;
  updateHud(o: { me: DuelSideView; opp: DuelSideView; timeLeft: number; round: number; pingMs: number | null }): void;
  hideHud(): void;
  banner(title: string, sub?: string, ms?: number): void;
  showResult(o: { won: boolean; myWins: number; oppWins: number; oppName: string; onRematch(): void; onLeave(): void }): void;
  setRematch(state: 'none' | 'asked' | 'oppAsked'): void;
  hideResult(): void;
  hideAll(): void;
}
export interface DuelSideView {
  name: string;
  plow: PlowKind;
  hpFrac: number;
  wins: number;
}

const SNAP_HZ = 30;
const INPUT_HZ = 60;
/** Guest renders the opponent this far behind the newest snapshot. */
const INTERP_DELAY = 0.1;
/** Prediction error (m) beyond which the guest snaps instead of easing. */
const SNAP_DIST = 3.5;
/** Rate (1/s) the guest eases its predicted plow onto the host's. */
const CORRECT_RATE = 9;
const PING_EVERY = 1;
const DROP_AFTER = 6;
/** Snow rows re-sent per snapshot (heals regrowth / any drift; full sweep in ~2.3 s). */
const ROLL_ROWS = 2;
const NAME_KEY = 'snowplow-duel-name';
/** Seconds the ROUND n banner shows before the countdown digits. */
const BANNER_SECONDS = 1.1;

const SRC_CODE: Record<string, number> = { slam: 0, ram: 1, whirl: 2, other: 3 };
/** Key code per press counter (PRESS_ACTIONS order; ShiftRight also counts as dash). */
const PRESS_KEYS = ['Space', 'ShiftLeft', 'KeyE', 'KeyF'];

const _v = new THREE.Vector3();

export function duelName(): string {
  try {
    let n = localStorage.getItem(NAME_KEY);
    if (!n) {
      n = `Plower-${Math.floor(1000 + Math.random() * 9000)}`;
      localStorage.setItem(NAME_KEY, n);
    }
    return n.slice(0, 16);
  } catch {
    return 'Plower';
  }
}

const nowSec = () => performance.now() / 1000;

function freshCounters() {
  return {
    hits: [0, 0], damage: [0, 0], bySource: [[0, 0, 0, 0], [0, 0, 0, 0]], slams: [0, 0], abilities: [0, 0], nukes: [0, 0],
    maxHitFrac: 0, snapsSent: 0, snapsRecv: 0, snowMsgs: 0, snowBytes: 0, inputsRecv: 0, eventsRecv: 0,
    /** Host: how each round ended and how long the fight took (s). */
    rounds: [] as { winner: number; reason: string; secs: number }[],
    /** Guest prediction: error (m) between the host's pose and ours for the same acknowledged input. */
    predErrSum: 0, predErrN: 0, predErrMax: 0, predSnaps: 0,
  };
}

type Ctl = Record<string, unknown> & { t: string };

/**
 * Online 1v1 DUEL. The HOST runs the real simulation of both plows (its own from the local input, the guest's from
 * network input) and streams ~30 Hz snapshots, hit / slam / ability events and snow patches. The GUEST predicts its
 * own plow from local input and eases it onto the host's view, interpolates the opponent ~100 ms behind, replays
 * the opponent's effects, and renders the host's snow. Index 0 is always the host's plow, 1 the guest's.
 */
export class DuelManager {
  private ctx: GameContext;
  private hooks: DuelHooks;
  role: DuelRole = 'host';
  phase: DuelPhase = 'lobby';
  active = false;
  /** Pause menu open: local input is ignored but the match keeps running. */
  menuOpen = false;
  /** Display name override (else a stored "Plower-1234"). */
  playerName: string | null = null;
  /** Probe / testing: let an autopilot drive this side. */
  autopilot = false;
  round = 0;
  /** Round wins: [host, guest]. */
  score: [number, number] = [0, 0];
  /** Phase clock: garage seconds left / countdown / round time left / between rounds. */
  timer = 0;
  rtt = 0;
  private transport: Transport | null = null;
  private roomCode = '';
  profiles: [DuelProfile | null, DuelProfile | null] = [null, null];
  stats: [PlayerStats | null, PlayerStats | null] = [null, null];
  /** Final effective levels per side (host fills both). */
  levels: [Partial<Record<UpgradeId, number>> | null, Partial<Record<UpgradeId, number>> | null] = [null, null];
  bonus: [number, number] = [0, 0];
  power: [number, number] = [0, 0];
  ready: [boolean, boolean] = [false, false];
  rematch: [boolean, boolean] = [false, false];
  wallet: DuelWallet | null = null;
  /** Match timings (host-authoritative; probes shorten them). */
  cfg = {
    garageSeconds: DUEL_GARAGE_SECONDS,
    rematchGarageSeconds: DUEL_REMATCH_GARAGE_SECONDS,
    countdown: DUEL_COUNTDOWN,
    roundSeconds: DUEL_ROUND_SECONDS,
    betweenRounds: DUEL_BETWEEN_ROUNDS,
  };
  /** Telemetry for probes / debugging. hits / slams / abilities are by ATTACKER index (0 host, 1 guest). */
  counters = freshCounters();
  private garageClosing = -1;
  private endDelay = -1;
  private lastWinner = -1;
  /** Reused every frame (no per-frame allocations for the HUD / garage strip). */
  private hudView = {
    me: { name: '', plow: 'classic' as PlowKind, hpFrac: 1, wins: 0 },
    opp: { name: '', plow: 'classic' as PlowKind, hpFrac: 1, wins: 0 },
    timeLeft: 0,
    round: 1,
    pingMs: null as number | null,
  };
  private bannerView = { secondsLeft: 0, bonusLeft: 0, readySelf: false, readyOpp: false };
  private timerAtEnd = 0;
  private lastCount = -1;
  private helloT = 0;

  // ---- the opponent's plow + combat (built on first use, hidden outside duels)
  private oppPlow: Plow | null = null;
  private oppCombat: Combat | null = null;
  private mePilot!: DuelPilot;
  private oppPilot!: DuelPilot;
  private myInput: GatedInput;
  private auto: AutoPilot;
  private netInput = new NetInput();
  private puppetInput = new PuppetInput();
  private targetOpp: OpponentTarget | null = null;
  private targetMe: OpponentTarget | null = null;
  private roSnow: ReadOnlySnow | null = null;

  // ---- net state
  private snapAcc = 0;
  private snapSeq = 0;
  private inputAcc = 0;
  private inputSeq = 0;
  private presses: [number, number, number, number] = [0, 0, 0, 0];
  private epoch = 0;
  /** Duel clock: SIM seconds since connecting. Snapshot stamps, interpolation and prediction windows run on it (in
   *  live play it tracks real time); heartbeats and ping stay on real time. */
  private clock = 0;
  private lastHeard = 0;
  private pingT = 0;
  private snapView = new DataView(new ArrayBuffer(SNAP_BYTES));
  private inputView = new DataView(new ArrayBuffer(INPUT_BYTES));
  private plowBuf = new Float32Array(2 * NET_PLOW_LEN);
  private hdr: SnapHeader = { phase: 0, seq: 0, time: 0, timer: 0, round: 0, scoreA: 0, scoreB: 0, flags: 0, inputAck: 0 };
  private inFrame: InputFrame = { seq: 0, throttle: 0, steer: 0, presses: [0, 0, 0, 0] };
  private events: (number | string)[][] = [];
  private patches: SnowPatch[] = [];
  private rollRow = 0;
  private snowScratch = new Uint8Array(0);
  // guest
  private buffer = new SnapBuffer();
  private offset = 0;
  private offsetSet = false;
  private puppetState = new Float32Array(NET_PLOW_LEN);
  private history = new PoseHistory();
  private histPose = { x: 0, z: 0, h: 0 };
  private corr = { x: 0, z: 0, h: 0 };
  private lastLocal = [-99, -99, -99, -99];
  private haveSnap = false;
  /** Guest: ignore snapshots from before the current round's reset (they may still be in flight). */
  private minSnapTime = -Infinity;
  private lastSnap = new Float32Array(2 * NET_PLOW_LEN);
  private snowWrite = (x: number, z: number, b: number) => (this.ctx.snow as SnowField).writeQuant(x, z, b);
  private snowPatch = (p: SnowPatch) => (this.ctx.snow as SnowField).patchDone(p);

  constructor(ctx: GameContext, hooks: DuelHooks) {
    this.ctx = ctx;
    this.hooks = hooks;
    this.myInput = new GatedInput(() => (this.autopilot ? this.auto : ctx.input), () => this.phase === 'fight' && (!this.menuOpen || this.autopilot));
    this.auto = new AutoPilot(() => ctx.plow as Plow, () => this.oppPlow ?? (ctx.plow as Plow));
  }

  get meIdx(): number {
    return this.role === 'host' ? 0 : 1;
  }
  get oppIdx(): number {
    return 1 - this.meIdx;
  }
  get opponent(): Plow | null {
    return this.oppPlow;
  }
  get opponentCombat(): Combat | null {
    return this.oppCombat;
  }
  get code(): string {
    return this.roomCode;
  }
  /** Seconds left in the countdown (0 otherwise), for the big HUD digits. */
  get countdown(): number {
    // The ROUND banner has the screen for its first BANNER_SECONDS; the 3-2-1 digits follow.
    return this.phase === 'countdown' && this.timer <= this.cfg.countdown - BANNER_SECONDS ? Math.max(0, this.timer) : 0;
  }

  /* ================================================================== lifecycle */

  private build(): void {
    const ctx = this.ctx;
    const base = ctx.progression.computeStats();
    this.roSnow = new ReadOnlySnow(ctx.snow as SnowField);
    const localEvents = new PilotEvents(() => ctx.events, (e) => this.onSlam(this.meIdx, e), (e) => this.onAbility(this.meIdx, e));
    const oppEvents = new PilotEvents(() => null, (e) => this.onSlam(this.oppIdx, e), (e) => this.onAbility(this.oppIdx, e));
    this.mePilot = new DuelPilot(true, true, { input: this.myInput, stats: base, enemies: NO_TARGETS, snow: ctx.snow, audio: ctx.audio, events: localEvents });
    this.oppPilot = new DuelPilot(false, true, { input: this.netInput, stats: base, enemies: NO_TARGETS, snow: ctx.snow, audio: new RemoteAudio(() => ctx.audio), events: oppEvents });
    this.oppPilot.plow = this.oppPlow = new Plow(ctx, this.oppPilot);
    this.oppPilot.combat = this.oppCombat = new Combat(ctx, this.oppPilot);
    this.oppPlow.setInWorld(false);
  }

  /** Connected: start the handshake. Game has already switched to the duel arena. */
  begin(t: Transport, role: DuelRole, code: string): void {
    const ctx = this.ctx;
    if (!this.oppPlow) this.build();
    this.active = true;
    this.role = role;
    this.roomCode = code;
    this.transport = t;
    this.phase = 'lobby';
    this.menuOpen = false;
    this.score = [0, 0];
    this.round = 0;
    this.profiles = [null, null];
    this.stats = [null, null];
    this.levels = [null, null];
    this.ready = [false, false];
    this.rematch = [false, false];
    this.inputSeq = this.snapSeq = 0;
    this.presses = [0, 0, 0, 0];
    this.netInput.tracker.reset();
    this.events.length = 0;
    this.buffer.clear();
    this.history.clear();
    this.haveSnap = false;
    this.offsetSet = false;
    this.minSnapTime = -Infinity;
    this.rtt = 0;
    this.epoch = nowSec();
    this.clock = 0;
    this.lastHeard = nowSec();
    this.pingT = 0;
    this.endDelay = -1;
    this.garageClosing = -1;
    this.counters = freshCounters();
    const host = role === 'host';
    const me = this.mePilot;
    const opp = this.oppPilot;
    const oppPlow = this.oppPlow!;
    const oppCombat = this.oppCombat!;
    me.plow = ctx.plow as Plow;
    me.combat = ctx.combat as Combat;
    // Host: each side's attacks hit the other's plow. Guest: nothing is hit locally (the host decides).
    if (host) {
      this.targetOpp = new OpponentTarget(new PlowHandle(2, oppPlow), () => oppCombat, () => me.stats, () => me.plow);
      this.targetMe = new OpponentTarget(new PlowHandle(1, me.plow), () => me.combat, () => opp.stats, () => oppPlow);
      this.targetOpp.onHit = (h) => this.onHit(1, h, me.plow.dashing);
      this.targetMe.onHit = (h) => this.onHit(0, h, oppPlow.dashing);
      me.enemies = this.targetOpp;
      opp.enemies = this.targetMe;
      me.snow = opp.snow = ctx.snow;
      opp.input = this.netInput;
    } else {
      this.targetOpp = this.targetMe = null;
      me.enemies = opp.enemies = NO_TARGETS;
      me.snow = opp.snow = this.roSnow!;
      opp.input = this.puppetInput;
    }
    (me as { authoritative: boolean }).authoritative = host;
    (opp as { authoritative: boolean }).authoritative = host;
    ctx.enemies = me.enemies;
    const snow = ctx.snow as SnowField;
    snow.netTrack = host;
    snow.regenRate = host ? DUEL_SNOW_REGEN : 0;
    me.plow.bind(me);
    me.combat.bind(me);
    oppPlow.bind(opp);
    oppCombat.bind(opp);
    oppPlow.setInWorld(true);
    this.parkPlows();
    t.onMessage = (d) => this.onMessage(d);
    t.onClose = () => this.lost();
    // Hello now, and again every 0.5 s until welcomed (see update): the first one can race the host's handlers.
    this.helloT = 0.5;
    if (!host) this.sendCtl({ t: 'hello', v: PROTOCOL_VERSION, profile: this.myProfile() });
  }

  /** Leave the duel (tells the opponent). Safe to call twice. */
  end(): void {
    if (!this.active) return;
    this.sendCtl({ t: 'leave' });
    this.shutdown();
  }

  private shutdown(): void {
    const ctx = this.ctx;
    this.active = false;
    const t = this.transport;
    this.transport = null;
    if (t) {
      t.onMessage = null;
      t.onClose = null;
      // Let the 'leave' flush first.
      setTimeout(() => t.close(), 150);
    }
    this.hooks.closeGarage();
    this.hooks.ui.hideAll();
    this.wallet = null;
    const snow = ctx.snow as SnowField;
    snow.netTrack = false;
    snow.regenRate = null;
    (ctx.plow as Plow).bind(null);
    (ctx.combat as Combat).bind(null);
    this.oppCombat?.clear();
    this.oppPlow?.setInWorld(false);
    this.phase = 'lobby';
    this.menuOpen = false;
  }

  private lost(): void {
    if (!this.active) return;
    const msg = this.phase === 'results' ? 'Your opponent left the duel.' : 'Connection to your opponent was lost.';
    this.shutdown();
    this.hooks.exit(msg);
  }

  private myProfile(): DuelProfile {
    const p = this.ctx.progression;
    const levels = cleanLevels(p.data.upgrades);
    return { name: this.playerName ?? duelName(), plow: p.plow, look: { ...cosmeticsState(p).equipped }, levels, coins: p.coins, spent: garageSpent(levels) };
  }

  private cleanProfile(raw: unknown): DuelProfile | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const plow = typeof r.plow === 'string' && PLOWS[r.plow as PlowKind] ? (r.plow as PlowKind) : 'classic';
    const levels = cleanLevels(r.levels);
    const look: Partial<Record<CosmeticSlot, string>> = {};
    if (r.look && typeof r.look === 'object') for (const [k, v] of Object.entries(r.look as Record<string, unknown>)) if (typeof v === 'string' && v.length < 48) look[k as CosmeticSlot] = v;
    const coins = typeof r.coins === 'number' && Number.isFinite(r.coins) ? Math.max(0, Math.floor(r.coins)) : 0;
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 16) : 'Opponent';
    // `spent` is recomputed from the levels, never trusted.
    return { name, plow, look, levels, coins, spent: garageSpent(levels) };
  }

  /** Both plows at their spawns facing each other, nothing armed. */
  private parkPlows(): void {
    const me = this.ctx.plow as Plow;
    const opp = this.oppPlow!;
    const a = DUEL_SPAWNS[this.meIdx];
    const b = DUEL_SPAWNS[this.oppIdx];
    me.reset(a);
    opp.reset(b);
    (this.ctx.combat as Combat).clear();
    this.oppCombat!.clear();
    for (const t of [this.targetOpp, this.targetMe]) {
      if (!t) continue;
      t.enabled = false;
      t.reset();
    }
    this.history.clear();
    this.corr.x = this.corr.z = this.corr.h = 0;
  }

  /* ================================================================== messaging */

  private sendCtl(msg: Ctl): void {
    this.transport?.send(toJson(msg), true);
  }

  private onMessage(d: string | ArrayBuffer): void {
    if (!this.active) return;
    this.lastHeard = nowSec();
    if (typeof d === 'string') {
      const m = fromJson<Ctl>(d);
      if (m && typeof m.t === 'string') this.onControl(m);
      return;
    }
    const v = new DataView(d);
    if (v.byteLength < 1) return;
    const type = v.getUint8(0);
    if (this.role === 'host') {
      if (decodeInput(v, this.inFrame)) {
        this.netInput.tracker.receive(this.inFrame);
        this.counters.inputsRecv++;
      }
    } else if (type === MSG_SNAP) {
      if (decodeSnap(v, this.hdr, this.plowBuf)) {
        this.counters.snapsRecv++;
        this.onSnapshot();
      }
    } else if (type === MSG_SNOW) {
      decodeSnow(new Uint8Array(d), this.snowWrite, this.snowPatch);
      this.counters.snowMsgs++;
      this.counters.snowBytes += d.byteLength;
    }
  }

  private onControl(m: Ctl): void {
    const host = this.role === 'host';
    switch (m.t) {
      case 'ping':
        this.sendCtl({ t: 'pong', c: m.c });
        return;
      case 'pong': {
        const sample = performance.now() - Number(m.c);
        if (sample >= 0 && sample < 10000) this.rtt = this.rtt ? this.rtt * 0.8 + sample * 0.2 : sample;
        return;
      }
      case 'leave':
        this.shutdown();
        this.hooks.exit('Your opponent left the duel.');
        return;
      case 'reject':
        this.shutdown();
        this.hooks.exit(String(m.reason ?? 'The host refused the connection.'));
        return;
    }
    if (host) this.hostControl(m);
    else this.guestControl(m);
  }

  /* ================================================================== host */

  private hostControl(m: Ctl): void {
    switch (m.t) {
      case 'hello': {
        // The guest repeats its hello until welcomed (the first can race the host's data handlers): once is enough.
        if (this.phase !== 'lobby' || this.profiles[1]) return;
        if (m.v !== PROTOCOL_VERSION) {
          this.sendCtl({ t: 'reject', reason: 'Version mismatch: both players need to refresh to the same game version.' });
          return;
        }
        const prof = this.cleanProfile(m.profile);
        if (!prof) return;
        this.profiles[1] = prof;
        this.profiles[0] = this.myProfile();
        this.sendCtl({ t: 'welcome', v: PROTOCOL_VERSION, profile: this.profiles[0] });
        this.hostStartGarage(this.cfg.garageSeconds);
        return;
      }
      case 'loadout': {
        this.levels[1] = cleanLevels(m.levels);
        if (m.final === true && this.garageClosing >= 0) this.hostStartMatch();
        return;
      }
      case 'ready':
        this.ready[1] = m.ready === true;
        this.refreshBanner();
        return;
      case 'rematch': {
        const prof = this.cleanProfile(m.profile);
        if (prof) this.profiles[1] = prof;
        this.rematch[1] = true;
        this.hooks.ui.setRematch(this.rematch[0] ? 'asked' : 'oppAsked');
        this.maybeRematch();
        return;
      }
    }
  }

  private hostStartGarage(seconds: number): void {
    const [a, b] = this.profiles;
    if (!a || !b) return;
    this.power = [duelPower(a.spent, a.coins), duelPower(b.spent, b.coins)];
    const cu = catchUp(this.power[0], this.power[1]);
    this.bonus = [cu.a, cu.b];
    this.levels = [null, b.levels];
    this.sendCtl({ t: 'garage', seconds, bonus: this.bonus, power: this.power, names: [a.name, b.name] });
    this.enterGarage(seconds);
  }

  private hostEndGarage(): void {
    if (this.garageClosing >= 0) return;
    this.garageClosing = 3;
    this.levels[0] = this.wallet ? this.wallet.effectiveLevels() : this.profiles[0]!.levels;
    this.closeGarageUi();
    this.sendCtl({ t: 'garageEnd' });
  }

  private hostStartMatch(): void {
    if (this.garageClosing < 0) return;
    this.garageClosing = -1;
    const [a, b] = this.profiles;
    if (!a || !b) return;
    const la = this.levels[0] ?? a.levels;
    const lb = this.levels[1] ?? b.levels;
    // The host computes BOTH players' stats from the levels they bring: one source of truth.
    this.stats = [computeStatsFor(la, a.plow), computeStatsFor(lb, b.plow)];
    this.sendCtl({ t: 'match', stats: this.stats, names: [a.name, b.name], plows: [a.plow, b.plow], looks: [a.look, b.look] });
    this.applyMatch();
    this.hostStartRound(1);
  }

  private hostStartRound(n: number): void {
    this.round = n;
    this.phase = 'countdown';
    this.timer = this.cfg.countdown;
    this.endDelay = -1;
    this.resetArena();
    this.sendCtl({ t: 'round', n, score: this.score, ht: this.clock });
    this.sendSnowKeyframe();
    this.sendSnapshot(true);
  }

  private hostRoundOver(winner: number, reason: 'wreck' | 'time' | 'draw'): void {
    this.timerAtEnd = this.timer;
    this.phase = 'roundEnd';
    this.timer = this.cfg.betweenRounds;
    if (winner >= 0) this.score[winner]++;
    this.lastWinner = winner;
    this.counters.rounds.push({ winner, reason, secs: Math.round((this.cfg.roundSeconds - this.timerAtEnd) * 10) / 10 });
    if (this.targetOpp) this.targetOpp.enabled = false;
    if (this.targetMe) this.targetMe.enabled = false;
    this.sendCtl({ t: 'roundEnd', winner, reason, score: this.score });
    this.showRoundResult(winner, reason);
  }

  private hostUpdateFlow(dt: number): void {
    switch (this.phase) {
      case 'garage':
        if (this.garageClosing >= 0) {
          this.garageClosing -= dt;
          // The guest's final loadout never came: go with the last one it sent.
          if (this.garageClosing <= 0) {
            this.garageClosing = 0;
            this.hostStartMatch();
          }
          return;
        }
        this.timer -= dt;
        this.refreshBanner();
        if (this.timer <= 0 || (this.ready[0] && this.ready[1])) this.hostEndGarage();
        return;
      case 'countdown':
        this.timer -= dt;
        if (this.timer <= 0) {
          this.phase = 'fight';
          this.timer = this.cfg.roundSeconds;
          this.targetOpp!.enabled = this.targetMe!.enabled = true;
          this.sendCtl({ t: 'fight', secs: this.cfg.roundSeconds });
          this.onFight();
        }
        return;
      case 'fight': {
        this.timer = Math.max(0, this.timer - dt);
        const a = this.ctx.plow as Plow;
        const b = this.oppPlow!;
        if (a.dead || b.dead) {
          if (this.endDelay < 0) this.endDelay = DUEL_ROUND_END_DELAY;
          this.endDelay -= dt;
          if (this.endDelay <= 0) {
            const w = a.dead && b.dead ? -1 : a.dead ? 1 : 0;
            this.hostRoundOver(w, w < 0 ? 'draw' : 'wreck');
          }
        } else if (this.timer <= 0) {
          const fa = a.hp / Math.max(1, a.maxHp);
          const fb = b.hp / Math.max(1, b.maxHp);
          const w = Math.abs(fa - fb) < DUEL_DRAW_EPS ? -1 : fa > fb ? 0 : 1;
          this.hostRoundOver(w, w < 0 ? 'draw' : 'time');
        }
        return;
      }
      case 'roundEnd':
        this.timer -= dt;
        if (this.timer <= 0) {
          const done = this.score[0] >= DUEL_ROUNDS_TO_WIN || this.score[1] >= DUEL_ROUNDS_TO_WIN || this.round >= DUEL_MAX_ROUNDS;
          if (done) {
            this.sendCtl({ t: 'results', score: this.score });
            this.showResults();
          } else this.hostStartRound(this.round + 1);
        }
        return;
    }
  }

  private maybeRematch(): void {
    if (this.role !== 'host' || !this.rematch[0] || !this.rematch[1] || this.phase !== 'results') return;
    this.profiles[0] = this.myProfile();
    this.score = [0, 0];
    this.round = 0;
    this.hooks.ui.hideResult();
    this.hostStartGarage(this.cfg.rematchGarageSeconds);
  }

  /** Host: plow vs plow — separation, rams and dash strikes (dash strikes through the blade also come from Plow). */
  private resolveContacts(fighting: boolean): void {
    const a = this.ctx.plow as Plow;
    const b = this.oppPlow!;
    if (a.dead && b.dead) return;
    const dx = b.position.x - a.position.x;
    const dz = b.position.z - a.position.z;
    const d = Math.hypot(dx, dz);
    const minD = a.radius + b.radius;
    if (d >= minD || d < 1e-4) return;
    const nx = dx / d;
    const nz = dz / d;
    const push = (minD - d) * 0.5;
    if (!a.dead) {
      a.position.x -= nx * push;
      a.position.z -= nz * push;
    }
    if (!b.dead) {
      b.position.x += nx * push;
      b.position.z += nz * push;
    }
    if (!fighting) return;
    this.tryRam(a, this.mePilot.combat, this.targetOpp!, b, nx, nz);
    this.tryRam(b, this.oppCombat!, this.targetMe!, a, -nx, -nz);
  }

  /** `att` rams `vic` if it faces it at speed. (nx, nz): unit vector att -> vic. */
  private tryRam(att: Plow, combat: Combat, target: OpponentTarget, vic: Plow, nx: number, nz: number): void {
    if (att.dead || vic.dead) return;
    att.getForward(_v);
    const dot = _v.x * nx + _v.z * nz;
    if (dot <= 0.55 || att.speed <= 3) return;
    vic.getForward(_v);
    const closing = att.speed * dot - vic.speed * (_v.x * nx + _v.z * nz);
    const dealt = combat.playerRam(target.handle, Math.max(closing, att.speed * 0.6));
    if (dealt > 0 && !att.dashing) att.speed *= 0.6;
  }

  private onHit(victim: number, h: DuelHit, attackerDashing: boolean): void {
    if (this.role !== 'host') return;
    const c = this.counters;
    const att = 1 - victim;
    const vp = victim === 0 ? (this.ctx.plow as Plow) : this.oppPlow!;
    c.hits[att]++;
    c.damage[att] += h.final;
    c.bySource[att][SRC_CODE[h.source] ?? 3]++;
    c.maxHitFrac = Math.max(c.maxHitFrac, h.final / Math.max(1, vp.maxHp));
    const r = (v: number) => Math.round(v * 100) / 100;
    this.events.push(['h', victim, r(h.final), r(h.kx), r(h.kz), r(h.stop), r(h.fromX), r(h.fromZ), SRC_CODE[h.source] ?? 3, attackerDashing ? 1 : 0]);
  }

  private onSlam(p: number, e: GameEvents['slam']): void {
    if (this.role !== 'host' || !this.active) return;
    this.counters.slams[p]++;
    const r = (v: number) => Math.round(v * 100) / 100;
    this.events.push(['s', p, r(e.position.x), r(e.position.z), r(e.radius)]);
  }

  private onAbility(p: number, e: GameEvents['ability']): void {
    if (!this.active) return;
    this.counters.abilities[p]++;
    if (e.nuke) this.counters.nukes[p]++;
    if (this.role === 'host') this.events.push(['f', p, e.nuke ? 1 : 0]);
    else if (p === this.meIdx) this.lastLocal[3] = this.clock;
  }

  private sendSnapshot(keyframe = false): void {
    const t = this.transport;
    if (!t) return;
    const buf = this.plowBuf;
    const L = NET_PLOW_LEN;
    const a = this.ctx.plow as Plow;
    a.writeNet(buf, 0);
    (this.ctx.combat as Combat).writeNet(buf, 0);
    this.oppPlow!.writeNet(buf, L);
    this.oppCombat!.writeNet(buf, L);
    const h = this.hdr;
    h.phase = PHASES.indexOf(this.phase);
    h.seq = this.snapSeq = (this.snapSeq + 1) & 0xffff;
    h.time = this.clock;
    h.timer = this.timer;
    h.round = this.round;
    h.scoreA = this.score[0];
    h.scoreB = this.score[1];
    h.flags = keyframe ? 1 : 0;
    h.inputAck = this.netInput.tracker.ackSeq;
    encodeSnap(h, buf, this.snapView);
    t.send(this.snapView.buffer as ArrayBuffer, false);
    this.counters.snapsSent++;
  }

  private flushEvents(): void {
    if (!this.events.length) return;
    this.sendCtl({ t: 'ev', e: this.events });
    this.events = [];
  }

  private readQ = (x: number, z: number) => (this.ctx.snow as SnowField).readQuant(x, z);

  private sendSnowPatches(): void {
    const snow = this.ctx.snow as SnowField;
    const n = snow.takeNetPatches(this.patches);
    const V = snow.verts;
    // Rolling refresh: a couple of full rows each time.
    let roll = this.patches[n];
    if (!roll) this.patches[n] = roll = { x0: 0, z0: 0, w: 0, h: 0 };
    roll.x0 = 0;
    roll.w = V;
    roll.z0 = this.rollRow;
    roll.h = Math.min(ROLL_ROWS, V - this.rollRow);
    this.rollRow = (this.rollRow + ROLL_ROWS) % V;
    this.patches.length = n + 1;
    this.sendSnow(this.patches, false);
  }

  private sendSnowKeyframe(): void {
    const V = (this.ctx.snow as SnowField).verts;
    this.sendSnow([{ x0: 0, z0: 0, w: V, h: V }], true);
  }

  private sendSnow(patches: SnowPatch[], keyframe: boolean): void {
    let bytes = 4;
    for (const p of patches) bytes += 8 + p.w * p.h;
    if (this.snowScratch.byteLength < bytes) this.snowScratch = new Uint8Array(bytes * 2);
    const msg = encodeSnow(patches, keyframe, this.readQ, this.snowScratch);
    this.counters.snowMsgs++;
    this.counters.snowBytes += msg.byteLength;
    // Right-sized copy: a transport may clone the whole backing buffer.
    this.transport?.send(msg.slice().buffer as ArrayBuffer, true);
  }

  /* ================================================================== guest */

  private guestControl(m: Ctl): void {
    switch (m.t) {
      case 'welcome': {
        const prof = this.cleanProfile(m.profile);
        if (prof) this.profiles[0] = prof;
        this.profiles[1] = this.myProfile();
        return;
      }
      case 'garage': {
        const b = m.bonus as number[] | undefined;
        const p = m.power as number[] | undefined;
        this.bonus = [Number(b?.[0]) || 0, Number(b?.[1]) || 0];
        this.power = [Number(p?.[0]) || 0, Number(p?.[1]) || 0];
        this.score = [0, 0];
        this.round = 0;
        this.hooks.ui.hideResult();
        this.enterGarage(Number(m.seconds) || DUEL_GARAGE_SECONDS);
        return;
      }
      case 'ready':
        this.ready[0] = m.ready === true;
        this.refreshBanner();
        return;
      case 'garageEnd':
        this.sendCtl({ t: 'loadout', levels: this.wallet ? this.wallet.effectiveLevels() : this.profiles[1]?.levels ?? {}, final: true });
        this.closeGarageUi();
        return;
      case 'match': {
        const st = m.stats as PlayerStats[] | undefined;
        if (!st || st.length !== 2) return;
        this.stats = [st[0], st[1]];
        const names = m.names as string[] | undefined;
        const looks = m.looks as Partial<Record<CosmeticSlot, string>>[] | undefined;
        if (this.profiles[0] && names) this.profiles[0].name = String(names[0]).slice(0, 16);
        if (this.profiles[0] && looks?.[0]) this.profiles[0].look = looks[0];
        this.applyMatch();
        return;
      }
      case 'round':
        this.minSnapTime = Number(m.ht) || 0;
        this.round = Number(m.n) || 1;
        this.score = this.scoreOf(m.score);
        this.phase = 'countdown';
        this.timer = DUEL_COUNTDOWN;
        this.resetArena();
        return;
      case 'fight':
        if (this.phase === 'countdown') {
          this.phase = 'fight';
          this.timer = Number(m.secs) || DUEL_ROUND_SECONDS;
          this.onFight();
        }
        return;
      case 'roundEnd': {
        this.score = this.scoreOf(m.score);
        this.timerAtEnd = this.phase === 'fight' ? Math.max(0, this.timer) : 0;
        this.phase = 'roundEnd';
        this.timer = DUEL_BETWEEN_ROUNDS;
        const w = Number(m.winner);
        this.lastWinner = w;
        this.showRoundResult(w, String(m.reason) as 'wreck' | 'time' | 'draw');
        return;
      }
      case 'results':
        this.score = this.scoreOf(m.score);
        this.showResults();
        return;
      case 'rematch':
        this.rematch[0] = true;
        this.hooks.ui.setRematch(this.rematch[1] ? 'asked' : 'oppAsked');
        return;
      case 'ev':
        if (Array.isArray(m.e)) for (const e of m.e as unknown[][]) {
          this.counters.eventsRecv++;
          this.guestEvent(e);
        }
        return;
    }
  }

  private scoreOf(s: unknown): [number, number] {
    const a = Array.isArray(s) ? s : [];
    return [Number(a[0]) || 0, Number(a[1]) || 0];
  }

  private guestEvent(e: unknown[]): void {
    const ctx = this.ctx;
    const me = this.meIdx;
    const kind = e[0];
    const p = Number(e[1]);
    if (kind === 'h') {
      const [final, kx, kz, stop, fx, fz, src, dash] = e.slice(2).map(Number);
      this.counters.hits[1 - p]++;
      this.counters.damage[1 - p] += final;
      const victim = p === me ? (ctx.plow as Plow) : this.oppPlow!;
      _v.set(victim.position.x, 2.8, victim.position.z);
      if (p === me) {
        victim.netPush(kx, kz);
        if (stop > 0) victim.hitStop(stop);
        if (final > 0) {
          ctx.fx.floatText(_v, `-${Math.round(final)}`, '#ff5a4a', 0.8 + Math.min(0.6, final * 0.015));
          ctx.fx.shake(THREE.MathUtils.clamp(0.15 + final * 0.016, 0.15, 0.6));
          ctx.impact.playerHit(final, fx, fz);
          ctx.audio.play('plowHit', { volume: Math.min(1, 0.55 + final * 0.02) });
          ctx.events.emit('plowDamaged', { amount: final, blocked: 0 });
        }
      } else if (final > 0) {
        ctx.fx.floatText(_v, src === 1 && dash ? `DASH! ${Math.round(final)}` : `${Math.round(final)}`, src === 1 && dash ? '#ff9a2a' : '#ffffff', 1 + Math.min(1, final * 0.01));
      }
      if (src === 1) {
        _v.set((victim.position.x + fx) / 2, 1, (victim.position.z + fz) / 2);
        ctx.fx.burst(_v, { color: 0xffc04a, count: dash ? 30 : 12, speed: dash ? 14 : 8, size: 0.09, gravity: 22, life: 0.4 });
        ctx.audio.play(dash ? 'dashStrike' : 'ram', { volume: 0.8 });
      }
    } else if (kind === 's') {
      this.counters.slams[p]++;
      if (p !== me) this.oppCombat!.slamAt(Number(e[2]), Number(e[3]), Number(e[4]), 0);
    } else if (kind === 'f') {
      this.counters.abilities[p]++;
      if (Number(e[2]) === 1) this.counters.nukes[p]++;
      if (p !== me) {
        this.oppCombat!.armForReplay(Number(e[2]) === 1);
        this.puppetInput.pressF = true;
      }
    }
  }

  private onSnapshot(): void {
    const h = this.hdr;
    if (h.time < this.minSnapTime) return;
    const now = this.clock;
    // Host clock estimate: track the freshest arrivals quickly, the slow ones slowly.
    const sample = h.time - now;
    if (!this.offsetSet) {
      this.offset = sample;
      this.offsetSet = true;
    } else this.offset += (sample - this.offset) * (sample > this.offset ? 0.3 : 0.02);
    this.buffer.push(h.time, this.plowBuf);
    this.lastSnap.set(this.plowBuf);
    this.haveSnap = true;
    const ph = PHASES[h.phase] ?? this.phase;
    // Phase changes arrive reliably as control messages; the snapshot only fills in the clock.
    if (ph === this.phase) this.timer = h.timer;
    this.score = [h.scoreA, h.scoreB];
    this.reconcile(h.inputAck);
  }

  /** Compare the host's pose of our plow (for input `ack`) with what we predicted then; ease out the error. */
  private reconcile(ack: number): void {
    const plow = this.ctx.plow as Plow;
    const s = this.lastSnap;
    const o = NET_PLOW_LEN * this.meIdx;
    const now = this.clock;
    const win = this.rtt / 1000 + 0.3;
    const keepBall = now - this.lastLocal[0] < win;
    const keepDash = now - this.lastLocal[1] < win;
    const keepWhirl = now - this.lastLocal[2] < win;
    const keepF = now - this.lastLocal[3] < win;
    plow.netCorrect(s, o, 0, 0, 0, 0, keepBall, keepDash, keepWhirl);
    (this.ctx.combat as Combat).readNet(s, o, keepF);
    if (plow.dead || this.phase !== 'fight') {
      // Outside the fight the host's pose is simply the truth.
      if (!plow.dead) plow.netCorrect(s, o, s[o + NP.x], s[o + NP.z], s[o + NP.heading], 1, keepBall, keepDash, keepWhirl);
      this.corr.x = this.corr.z = this.corr.h = 0;
      return;
    }
    const hp = this.histPose;
    let ex: number;
    let ez: number;
    let eh: number;
    if (this.history.get(ack, hp)) {
      ex = s[o + NP.x] - hp.x;
      ez = s[o + NP.z] - hp.z;
      eh = s[o + NP.heading] - hp.h;
    } else {
      ex = s[o + NP.x] - plow.position.x;
      ez = s[o + NP.z] - plow.position.z;
      eh = s[o + NP.heading] - plow.heading;
      if (Math.hypot(ex, ez) < SNAP_DIST * 2) return;
    }
    eh = Math.atan2(Math.sin(eh), Math.cos(eh));
    const err = Math.hypot(ex, ez);
    this.counters.predErrSum += err;
    this.counters.predErrN++;
    this.counters.predErrMax = Math.max(this.counters.predErrMax, err);
    if (err > SNAP_DIST) {
      this.counters.predSnaps++;
      plow.netCorrect(s, o, plow.position.x + ex, plow.position.z + ez, plow.heading + eh, 1, keepBall, keepDash, keepWhirl);
      this.history.shift(ex, ez, eh);
      this.corr.x = this.corr.z = this.corr.h = 0;
    } else {
      this.corr.x = ex;
      this.corr.z = ez;
      this.corr.h = eh;
    }
  }

  private sendInput(dt: number): void {
    const t = this.transport;
    if (!t) return;
    this.inputAcc += dt;
    if (this.inputAcc < 1 / INPUT_HZ - 1e-4 && this.inputSeq > 0) return;
    this.inputAcc = 0;
    const f = this.inFrame;
    f.seq = this.inputSeq = (this.inputSeq + 1) & 0xffff;
    f.throttle = this.myInput.throttle;
    f.steer = this.myInput.steer;
    for (let i = 0; i < 4; i++) f.presses[i] = this.presses[i] & 0xff;
    encodeInput(f, this.inputView);
    t.send(this.inputView.buffer as ArrayBuffer, false);
  }

  /** Count local presses (cumulative counters travel in every input packet). */
  private countPresses(src: InputSource): void {
    const now = this.clock;
    for (let i = 0; i < 4; i++) {
      if (src.wasPressed(PRESS_KEYS[i]) || (i === 1 && src.wasPressed('ShiftRight'))) {
        this.presses[i] = (this.presses[i] + 1) & 0xff;
        this.lastLocal[i] = now;
      }
    }
  }

  /* ================================================================== shared flow */

  private enterGarage(seconds: number): void {
    this.phase = 'garage';
    this.timer = seconds;
    this.ready = [false, false];
    this.rematch = [false, false];
    this.garageClosing = -1;
    this.parkPlows();
    this.ctx.cameraRig.setMode('menu');
    this.hooks.ui.hideHud();
    const me = this.meIdx;
    const wallet = (this.wallet = new DuelWallet(this.ctx.progression, this.bonus[me]));
    wallet.onChange(() => {
      if (this.role === 'guest' && this.phase === 'garage') this.sendCtl({ t: 'loadout', levels: wallet.effectiveLevels(), final: false });
      this.refreshBanner();
    });
    // Show the opponent's own plow + paint behind the garage (their match stats come with 'match').
    const op = this.profiles[this.oppIdx];
    if (op) {
      this.oppPilot.stats = computeStatsFor(op.levels, op.plow);
      this.oppPilot.look = op.look;
      this.oppPlow!.bind(this.oppPilot);
      this.oppCombat!.bind(this.oppPilot);
    }
    const info = { ownPower: this.power[me], oppPower: this.power[this.oppIdx], bonus: this.bonus[me] };
    this.hooks.openGarage(wallet, info);
    this.hooks.ui.showGarageBanner({
      secondsLeft: Math.ceil(seconds), ...info, bonusLeft: wallet.bonus, readySelf: false, readyOpp: false,
      onReady: () => this.setReady(),
    });
  }

  /** Local READY in the duel garage. */
  setReady(): void {
    if (this.phase !== 'garage' || this.ready[this.meIdx]) return;
    this.ready[this.meIdx] = true;
    this.sendCtl({ t: 'ready', ready: true });
    this.refreshBanner();
  }

  private refreshBanner(): void {
    if (this.phase !== 'garage' || !this.wallet) return;
    const b = this.bannerView;
    b.secondsLeft = Math.max(0, Math.ceil(this.timer));
    b.bonusLeft = this.wallet.bonus;
    b.readySelf = this.ready[this.meIdx];
    b.readyOpp = this.ready[this.oppIdx];
    this.hooks.ui.updateGarageBanner(b);
  }

  private closeGarageUi(): void {
    this.hooks.closeGarage();
    this.hooks.ui.hideGarageBanner();
  }

  /** Stats are fixed for the match (both sides got them from the host). */
  private applyMatch(): void {
    const ctx = this.ctx;
    const me = this.meIdx;
    const op = this.oppIdx;
    this.closeGarageUi();
    this.wallet = null;
    this.mePilot.stats = this.stats[me]!;
    this.oppPilot.stats = this.stats[op]!;
    this.oppPilot.look = this.profiles[op]?.look ?? null;
    ctx.stats = this.stats[me]!;
    (ctx.plow as Plow).bind(this.mePilot);
    (ctx.combat as Combat).bind(this.mePilot);
    this.oppPlow!.bind(this.oppPilot);
    this.oppCombat!.bind(this.oppPilot);
    this.score = [0, 0];
    this.hooks.ui.showHud(DUEL_ROUNDS_TO_WIN);
  }

  private resetArena(): void {
    const ctx = this.ctx;
    ctx.snow.reset(ctx.zone);
    ctx.fx.clear();
    ctx.impact.clear();
    this.parkPlows();
    this.buffer.clear();
    this.haveSnap = false;
    ctx.cameraRig.setMode('follow');
    ctx.cameraRig.snap();
    ctx.input.clear();
    this.hooks.ui.banner(`ROUND ${this.round}`, this.round === 1 ? `First to ${DUEL_ROUNDS_TO_WIN}` : `${this.score[this.meIdx]} – ${this.score[this.oppIdx]}`, BANNER_SECONDS * 1000);
    this.lastCount = -1;
  }

  private onFight(): void {
    this.ctx.audio.play('roundStart');
    this.hooks.ui.banner('FIGHT!', undefined, 900);
  }

  private showRoundResult(winner: number, reason: 'wreck' | 'time' | 'draw'): void {
    const mine = winner === this.meIdx;
    const opp = (this.profiles[this.oppIdx]?.name ?? 'THEM').toUpperCase();
    const sub = reason === 'time' ? 'Time! Higher HP wins' : reason === 'wreck' ? (mine ? 'Wrecked them!' : 'You got wrecked') : 'Time! Nobody scores';
    this.hooks.ui.banner(winner < 0 ? 'DRAW' : mine ? 'ROUND TO YOU' : `ROUND TO ${opp}`, sub, 2400);
    this.ctx.audio.play(winner < 0 ? 'roundClear' : mine ? 'roundClear' : 'gameOver', { volume: 0.7 });
  }

  private showResults(): void {
    this.phase = 'results';
    this.rematch = [false, false];
    const me = this.meIdx;
    const op = this.oppIdx;
    const won = this.score[me] > this.score[op];
    this.ctx.audio.play(won ? 'victory' : 'gameOver');
    this.hooks.ui.showResult({
      won, myWins: this.score[me], oppWins: this.score[op], oppName: this.profiles[op]?.name ?? 'Opponent',
      onRematch: () => this.askRematch(),
      onLeave: () => {
        this.end();
        this.hooks.exit();
      },
    });
    this.hooks.ui.setRematch('none');
  }

  askRematch(): void {
    if (this.phase !== 'results' || this.rematch[this.meIdx]) return;
    this.rematch[this.meIdx] = true;
    this.hooks.ui.setRematch(this.rematch[this.oppIdx] ? 'asked' : 'asked');
    this.sendCtl({ t: 'rematch', profile: this.myProfile() });
    this.maybeRematch();
  }

  /* ================================================================== tick */

  update(dt: number): void {
    if (!this.active) return;
    this.clock += dt;
    const now = nowSec();
    // Heartbeat + drop detection.
    this.pingT -= dt;
    if (this.pingT <= 0) {
      this.pingT = PING_EVERY;
      this.sendCtl({ t: 'ping', c: performance.now() });
    }
    if (now - this.lastHeard > DROP_AFTER) {
      this.lost();
      return;
    }
    if (this.role === 'guest' && this.phase === 'lobby' && !this.profiles[0]) {
      this.helloT -= dt;
      if (this.helloT <= 0) {
        this.helloT = 0.5;
        this.sendCtl({ t: 'hello', v: PROTOCOL_VERSION, profile: this.myProfile() });
      }
    }
    if (this.autopilot && this.phase === 'fight') this.auto.think(dt);
    if (this.role === 'host') this.hostTick(dt);
    else {
      if (this.phase === 'garage') {
        this.timer = Math.max(0, this.timer - dt);
        this.refreshBanner();
      }
      this.guestTick(dt);
    }
    if (!this.active) return;
    // Countdown beeps with the 3-2-1 digits.
    const cd = this.countdown;
    if (cd > 0) {
      const n = Math.ceil(cd);
      if (n !== this.lastCount && n <= 3) this.ctx.audio.play('countdown');
      this.lastCount = n;
    }
    this.updateHud();
  }

  private hostTick(dt: number): void {
    const ctx = this.ctx;
    const fight = this.phase === 'fight';
    this.netInput.enabled = fight;
    this.netInput.beginFrame();
    (ctx.plow as Plow).update(dt);
    this.oppPlow!.update(dt);
    this.resolveContacts(fight);
    this.targetOpp!.update(dt);
    this.targetMe!.update(dt);
    ctx.snow.update(dt);
    (ctx.combat as Combat).update(dt);
    this.oppCombat!.update(dt);
    this.netInput.endFrame();
    this.hostUpdateFlow(dt);
    if (!this.active) return;
    this.snapAcc += dt;
    if (this.snapAcc >= 1 / SNAP_HZ) {
      this.snapAcc %= 1 / SNAP_HZ;
      this.sendSnapshot();
      this.flushEvents();
      if (this.phase !== 'garage' && this.phase !== 'lobby') this.sendSnowPatches();
    }
  }

  private guestTick(dt: number): void {
    const ctx = this.ctx;
    const plow = ctx.plow as Plow;
    const opp = this.oppPlow!;
    // Our own plow: count presses, send input, predict.
    this.countPresses(this.myInput);
    this.sendInput(dt);
    if (this.phase === 'countdown') this.timer = Math.max(0, this.timer - dt);
    else if (this.phase === 'fight' || this.phase === 'roundEnd') this.timer = Math.max(0, this.timer - dt);
    plow.update(dt);
    this.history.record(this.inputSeq, plow.position.x, plow.position.z, plow.heading);
    // Ease out the last prediction error (and keep the history consistent with it).
    const c = this.corr;
    if (c.x || c.z || c.h) {
      const k = 1 - Math.exp(-CORRECT_RATE * dt);
      const dx = c.x * k;
      const dz = c.z * k;
      const dh = c.h * k;
      if (!plow.dead) {
        plow.position.x += dx;
        plow.position.z += dz;
        plow.heading += dh;
      }
      this.history.shift(dx, dz, dh);
      c.x -= dx;
      c.z -= dz;
      c.h -= dh;
      if (Math.abs(c.x) + Math.abs(c.z) + Math.abs(c.h) < 1e-3) c.x = c.z = c.h = 0;
    }
    // The opponent: interpolated ~100 ms behind the newest snapshot.
    const st = this.puppetState;
    const renderT = this.clock + this.offset - INTERP_DELAY;
    if (this.buffer.sample(Math.min(renderT, this.buffer.newestTime()), this.oppIdx, st)) {
      this.puppetInput.throttle = st[NP.throttle];
      this.puppetInput.steer = st[NP.steer];
      opp.updatePuppet(dt, st, 0);
    }
    // Keep our predicted plow out of the opponent's body (the host resolves the real contact).
    if (!plow.dead && !opp.dead) {
      const dx = plow.position.x - opp.position.x;
      const dz = plow.position.z - opp.position.z;
      const d = Math.hypot(dx, dz);
      const minD = plow.radius + opp.radius;
      if (d < minD && d > 1e-4) {
        const push = (minD - d) * 0.5;
        plow.position.x += (dx / d) * push;
        plow.position.z += (dz / d) * push;
      }
    }
    ctx.snow.update(dt);
    (ctx.combat as Combat).update(dt);
    this.oppCombat!.update(dt);
    this.puppetInput.pressF = false;
  }

  private updateHud(): void {
    if (this.phase === 'lobby' || this.phase === 'garage') return;
    const me = this.ctx.plow as Plow;
    const op = this.oppPlow!;
    const v = this.hudView;
    this.fillSide(v.me, me, this.meIdx);
    this.fillSide(v.opp, op, this.oppIdx);
    v.timeLeft = this.phase === 'fight' ? Math.max(0, this.timer) : this.phase === 'roundEnd' || this.phase === 'results' ? this.timerAtEnd : this.cfg.roundSeconds;
    v.round = Math.max(1, this.round);
    v.pingMs = this.role === 'guest' ? Math.round(this.rtt) : null;
    this.hooks.ui.updateHud(v);
  }

  private fillSide(out: DuelSideView, p: Plow, i: number): void {
    out.name = this.profiles[i]?.name ?? (i === 0 ? 'Host' : 'Guest');
    out.plow = this.stats[i]?.plowKind ?? 'classic';
    out.hpFrac = p.dead ? 0 : Math.max(0, Math.min(1, p.hp / Math.max(1, p.maxHp)));
    out.wins = this.score[i];
  }

  /** Probe / debug view of the match. */
  debugState(): Record<string, unknown> {
    const me = this.ctx.plow as Plow;
    const op = this.oppPlow;
    const hp = (p: Plow | null) => (p ? Math.round(p.hp * 10) / 10 : -1);
    const host = this.role === 'host';
    return {
      role: this.role, phase: this.phase, round: this.round, score: [...this.score], timer: Math.round(this.timer * 10) / 10,
      hp: host ? [hp(me), hp(op)] : [hp(op), hp(me)],
      maxHp: host ? [me.maxHp, op?.maxHp] : [op?.maxHp, me.maxHp],
      dead: host ? [me.dead, op?.dead] : [op?.dead, me.dead],
      pos: [me.position.x, me.position.z, op?.position.x ?? 0, op?.position.z ?? 0].map((v) => Math.round(v * 10) / 10),
      rtt: Math.round(this.rtt), bonus: [...this.bonus], power: [...this.power], ready: [...this.ready], rematch: [...this.rematch],
      levels: this.levels.map((l) => (l ? { ...l } : null)),
      stats: this.stats.map((s) => (s ? { maxHp: s.maxHp, maxSpeed: s.maxSpeed, damageMult: s.damageMult, plowKind: s.plowKind } : null)),
      haveSnap: this.haveSnap, buffered: this.buffer.size,
    };
  }
}
