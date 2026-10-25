import * as THREE from 'three';
import { EventBus } from './events';
import { Input } from './input';
import { Progression } from './Progression';
import { applyAllSettings, setBrawlPerf, settingsUi } from './settings';
import { BRAWL_ARENA_HALF, CAMPAIGN_ARENA_HALF, setArenaHalfSize } from './types';
import type { BrawlDifficulty, GameContext, HudState, RunSummary, UIHandlers } from './types';
import { BRAWL_ZONE, ZONES } from '../config/zones';
import { ENEMIES, type EnemyType } from '../config/enemies';
import { PLOWS } from '../config/plows';
import { SnowField } from '../world/SnowField';
import { Environment } from '../world/Environment';
import { Plow } from '../entities/Plow';
import { Combat } from '../entities/Combat';
import { EnemyManager } from '../entities/Enemies';
import { WaveDirector } from '../entities/Waves';
import { BrawlManager } from '../brawl/BrawlManager';
import { SurvivalManager, fullRepairCost, survivalUnlocked } from '../survival/SurvivalManager';
import { Pickups } from '../fx/Pickups';
import { Fx } from '../fx/Fx';
import { CameraRig } from '../fx/CameraRig';
import { AudioSystem } from '../audio/Audio';
import { UI } from '../ui/UI';
import { Tutorial } from '../ui/Tutorial';
import { ChallengeTracker, hardUnlocked, hardZone, recordHardClear } from '../meta/challenges';
import { Achievements } from '../meta/achievements';
import { installShadowProxies } from '../render/shadowProxy';
import { todaysDaily } from '../meta/daily';
import { equippedLook } from '../meta/cosmetics';
import { emitKillFx } from '../fx/killFx';
import type { GameEvents, KillSource } from './events';

type State =
  | 'menu' | 'countdown' | 'playing' | 'shop' | 'paused' | 'wrecked' | 'gameover' | 'victory'
  | 'brawlCountdown' | 'brawl' | 'brawlOver' | 'tutorial';
type Mode = 'campaign' | 'brawl' | 'survival';
/** States where a DOM menu has focus (gamepad drives it via synthetic key events). */
const MENU_STATES = new Set<State>(['menu', 'shop', 'paused', 'gameover', 'victory', 'brawlOver']);

const COUNTDOWN_SECONDS = 3;
const BOSS_COUNTDOWN_SECONDS = 4;
/** Seconds of slow-motion wreck animation before the game-over screen. */
const WRECK_SECONDS = 1.6;
const COMBO_WINDOW = 2.5;
/** Arena 1 for the Tutorial, paying no coins (kills / strikes give nothing; progression is untouched). */
const TUTORIAL_ZONE = { ...ZONES[0], coinMult: 0 };

/** Boss intro subtitle: one boss -> its title; a pair (SLUSH & SLEET) -> one "NAME — title" line each. */
/** Per-run tallies (reset at every run / match start). */
interface RunTally {
  kills: number;
  coins: number;
  biggestBall: number;
  bestCombo: number;
  bossDefeated: boolean;
  killsBy: Record<KillSource, number>;
  damage: number;
  /** ctx.time when the run started (ctx.time only advances while the sim runs). */
  start: number;
}

function bossIntroTitle(types: EnemyType[]): string {
  const uniq = [...new Set(types)].filter((t) => ENEMIES[t].isBoss);
  if (uniq.length <= 1) return uniq.length ? ENEMIES[uniq[0]].title : '';
  return uniq.map((t) => `${ENEMIES[t].name} — ${ENEMIES[t].title}`).join('\n');
}

export class Game {
  readonly ctx: GameContext;
  private renderer: THREE.WebGLRenderer;
  private timer = new THREE.Timer();
  private state: State = 'menu';
  private pausedFrom: State = 'playing';
  private zoneIndex = 0;
  private roundIndex = 0;
  private countdown = 0;
  private lastCountdownInt = -1;
  private wreckT = 0;
  private combo = 0;
  private comboT = 0;
  private run: RunTally = this.newRun();
  /** Current campaign run is the arena's Hard mode; current Survival run is the Daily. */
  private hard = false;
  private daily = false;
  private hud: HudState;
  private mode: Mode = 'campaign';
  private campaignEnemies: EnemyManager;
  private brawlDifficulty: BrawlDifficulty = 'pro';
  private survival: SurvivalManager;
  private tutorial: Tutorial;

  constructor(container: HTMLElement, uiRoot: HTMLElement) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
    // Shadow-only proxy casters (render/shadowProxy.ts) need their stand-in visible during the shadow pass only.
    installShadowProxies(renderer);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);
    const progression = new Progression();
    if (new URLSearchParams(location.search).has('debug')) progression.debugGrant();

    // Systems are constructed in order; constructors may only touch the "core" fields below.
    const ctx = {
      renderer,
      scene,
      camera,
      events: new EventBus(),
      input: new Input(),
      progression,
      stats: progression.computeStats(),
      zone: ZONES[0],
      time: 0,
    } as GameContext;
    this.ctx = ctx;

    ctx.audio = new AudioSystem();
    ctx.audio.muted = progression.data.muted;
    applyAllSettings(ctx);
    ctx.cameraRig = new CameraRig(ctx);
    ctx.fx = new Fx(ctx);
    ctx.world = new Environment(ctx);
    ctx.snow = new SnowField(ctx);
    ctx.plow = new Plow(ctx);
    ctx.combat = new Combat(ctx);
    this.campaignEnemies = new EnemyManager(ctx);
    ctx.enemies = this.campaignEnemies;
    ctx.brawl = new BrawlManager(ctx);
    ctx.waves = new WaveDirector(ctx);
    this.survival = new SurvivalManager(ctx);
    ctx.pickups = new Pickups(ctx);

    const handlers: UIHandlers = {
      onStartZone: (i, hard) => this.startRun(i, hard),
      onStartBrawl: (d) => this.startBrawl(d),
      onResume: () => this.resume(),
      onQuitToMenu: () => this.toMenu(),
      onStartSurvival: () => this.startSurvival(),
      onStartDaily: () => this.startSurvival(true),
      onStartTutorial: () => this.startTutorial(),
      onRetry: () => (this.mode === 'survival' ? this.startSurvival(this.daily) : this.startRun(this.zoneIndex, this.hard)),
      onResetSave: () => {
        progression.resetSave();
        this.refreshStats();
      },
      onToggleMute: () => this.toggleMute(),
    };
    ctx.ui = new UI(ctx, uiRoot, handlers);
    this.tutorial = new Tutorial(ctx, uiRoot, (next) => (next === 'arena' ? this.startRun(0) : this.toMenu()));
    // Meta progression: both only listen to ctx.events (runFinished etc.).
    new ChallengeTracker(ctx);
    new Achievements(ctx);

    this.hud = this.blankHud();
    this.wireEvents();
    // Survival pit stop: purchases apply to the live plow straight away.
    progression.onChange(() => {
      if (this.state === 'shop' && this.mode === 'survival') this.applyLiveStats();
    });

    // Menu backdrop: arena 0 scenery.
    ctx.world.setZone(ctx.zone);
    ctx.snow.reset(ctx.zone);
    ctx.plow.applyStats(ctx.stats);
    ctx.plow.reset();

    window.addEventListener('resize', () => this.onResize());
    const unlock = () => ctx.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.state === 'tutorial') return this.tutorial.skip();
      if (ctx.input.matches('pause', e.code)) this.togglePause();
      if (e.code === 'KeyM') this.toggleMute();
    });

    // Handy for automated playtesting / debugging in the console.
    (window as unknown as { __game: Game }).__game = this;

    this.toMenu();
    if (Tutorial.shouldAutoStart(progression)) this.startTutorial();
    this.timer.connect(document);
    renderer.setAnimationLoop((t) => this.frame(t));
  }

  /* ------------------------------------------------------------------ flow */

  /** Switch arena size, enemy manager and venue between the campaign and Brawl mode. */
  private setMode(mode: Mode): void {
    const { ctx } = this;
    if (mode === this.mode) return;
    this.clearArena();
    this.mode = mode;
    setBrawlPerf(ctx, mode === 'brawl');
    setArenaHalfSize(mode === 'brawl' ? BRAWL_ARENA_HALF : CAMPAIGN_ARENA_HALF);
    ctx.enemies = mode === 'brawl' ? ctx.brawl : this.campaignEnemies;
    ctx.zone = mode === 'brawl' ? BRAWL_ZONE : mode === 'survival' ? this.survival.zone : ZONES[0];
    ctx.fx.clear();
    ctx.world.setZone(ctx.zone);
    ctx.snow.reset(ctx.zone);
  }

  private toMenu(): void {
    const { ctx } = this;
    this.setMode('campaign');
    this.state = 'menu';
    this.tutorial.stop();
    this.clearArena();
    ctx.plow.reset();
    ctx.ui.setHudVisible(false);
    ctx.ui.showMainMenu();
    ctx.cameraRig.setMode('menu');
    ctx.audio.setEngine(0, 0);
    ctx.audio.setPlowing(0);
    ctx.audio.setMusic(true);
  }

  private clearArena(): void {
    const { ctx } = this;
    this.campaignEnemies.clear();
    ctx.brawl.clear();
    ctx.combat.clear();
    ctx.pickups.clear();
    ctx.waves.clear();
  }

  private newRun(): RunTally {
    return {
      kills: 0, coins: 0, biggestBall: 0, bestCombo: 0, bossDefeated: false,
      killsBy: { slam: 0, ram: 0, whirl: 0, other: 0 }, damage: 0, start: this.ctx?.time ?? 0,
    };
  }

  /** `hard`: the arena's Hard mode (needs hardUnlocked). */
  startRun(zoneIndex: number, hard = false): void {
    const { ctx } = this;
    if (!ctx.progression.isZoneUnlocked(zoneIndex)) return;
    if (hard && !hardUnlocked(ctx.progression, zoneIndex)) return;
    this.setMode('campaign');
    this.zoneIndex = zoneIndex;
    this.hard = hard;
    this.roundIndex = 0;
    this.run = this.newRun();
    this.combo = 0;
    ctx.zone = hard ? hardZone(ZONES[zoneIndex]) : ZONES[zoneIndex];
    this.refreshStats();
    this.clearArena();
    ctx.fx.clear();
    ctx.world.setZone(ctx.zone);
    ctx.snow.reset(ctx.zone);
    ctx.plow.reset();
    ctx.ui.hideOverlays();
    ctx.ui.setHudVisible(true);
    ctx.ui.toast(ctx.zone.name, 'big');
    ctx.cameraRig.setMode('follow');
    ctx.cameraRig.snap();
    this.beginCountdown();
  }

  startBrawl(difficulty: BrawlDifficulty): void {
    const { ctx } = this;
    this.brawlDifficulty = difficulty;
    this.setMode('brawl');
    this.run = this.newRun();
    this.combo = 0;
    this.refreshStats();
    this.clearArena();
    ctx.fx.clear();
    ctx.snow.reset(ctx.zone);
    ctx.brawl.start(difficulty);
    ctx.ui.hideOverlays();
    ctx.ui.setHudVisible(true);
    ctx.ui.toast('SNOWDOME BRAWL', 'big');
    ctx.cameraRig.setMode('follow');
    ctx.cameraRig.snap();
    this.state = 'brawlCountdown';
    this.countdown = COUNTDOWN_SECONDS + 1;
    this.lastCountdownInt = -1;
    ctx.ui.toast('Everyone hunts everyone. Streaks multiply your coins!', 'info');
  }

  /** Guided onboarding in arena 1 with training bots (see Tutorial). Replayable from the main menu. */
  startTutorial(): void {
    const { ctx } = this;
    this.setMode('campaign');
    this.zoneIndex = 0;
    this.hard = false;
    this.roundIndex = 0;
    this.run = this.newRun();
    this.combo = 0;
    ctx.zone = TUTORIAL_ZONE;
    this.refreshStats();
    this.clearArena();
    ctx.fx.clear();
    ctx.world.setZone(ctx.zone);
    ctx.snow.reset(ctx.zone);
    ctx.plow.reset();
    ctx.ui.hideOverlays();
    ctx.ui.setHudVisible(true);
    ctx.ui.toast('TRAINING YARD', 'big');
    ctx.cameraRig.setMode('follow');
    ctx.cameraRig.snap();
    ctx.input.clear();
    this.state = 'tutorial';
    this.tutorial.start();
  }

  /** Endless Survival: campaign bots in one arena, scaling waves, a boss every 5 (see SurvivalManager).
   *  `daily`: today's seeded Daily run with its modifier (meta/daily.ts). */
  startSurvival(daily = false): void {
    const { ctx } = this;
    if (!survivalUnlocked(ctx.progression)) return;
    this.setMode('survival');
    this.daily = daily;
    this.roundIndex = 0;
    this.run = this.newRun();
    this.combo = 0;
    this.survival.reset(daily ? todaysDaily() : null);
    this.refreshStats();
    this.clearArena();
    ctx.fx.clear();
    ctx.snow.reset(ctx.zone);
    ctx.plow.reset();
    ctx.ui.hideOverlays();
    ctx.ui.setHudVisible(true);
    ctx.ui.toast(this.survival.title, 'big');
    ctx.cameraRig.setMode('follow');
    ctx.cameraRig.snap();
    this.beginCountdown();
  }

  /** Survival wave cleared: bonus + patch-up, then a short breather into the next wave. */
  private survivalWaveCleared(): void {
    const { ctx } = this;
    ctx.pickups.collectAll();
    ctx.combat.clear();
    if (this.survival.isBossWave) this.run.bossDefeated = true;
    const bonus = this.survival.waveCleared();
    this.run.coins += bonus;
    ctx.audio.play('roundClear');
    ctx.ui.toast(`WAVE ${this.survival.wave} CLEARED! +${bonus}`, 'good');
    this.openSurvivalShop();
  }

  /** Between-wave PIT STOP: the sim is frozen (state 'shop') until NEXT WAVE, then the breather countdown runs. */
  private openSurvivalShop(): void {
    const { ctx } = this;
    const sv = this.survival;
    const wave = sv.wave;
    const repairCost = fullRepairCost(wave);
    this.state = 'shop';
    ctx.audio.setEngine(0, 0);
    ctx.audio.setPlowing(0);
    this.updateHud();
    ctx.ui.showSurvivalShop({
      cleared: wave,
      nextBoss: sv.bossNameFor(wave + 1),
      repairCost,
      canRepair: () => ctx.plow.hp < ctx.plow.maxHp - 0.5,
      onRepair: () => {
        if (ctx.plow.hp >= ctx.plow.maxHp - 0.5 || !ctx.progression.spend(repairCost)) return false;
        ctx.plow.hp = ctx.plow.maxHp;
        this.updateHud();
        return true;
      },
      onContinue: () => {
        if (this.state !== 'shop' || this.mode !== 'survival') return;
        this.applyLiveStats();
        ctx.ui.hideOverlays();
        ctx.input.clear();
        this.beginCountdown();
      },
    });
  }

  /** Recompute stats mid-run (Survival pit stop): max-HP gains also heal by the delta. */
  private applyLiveStats(): void {
    const { ctx } = this;
    const plow = ctx.plow;
    const oldHp = plow.hp;
    const oldMax = plow.maxHp;
    this.refreshStats();
    plow.hp = Math.min(plow.maxHp, Math.max(0, oldHp + Math.max(0, plow.maxHp - oldMax)));
    this.updateHud();
  }

  private survivalOver(): void {
    const { ctx } = this;
    const sv = this.survival;
    this.state = 'gameover';
    const newBest = sv.finish(this.run.kills);
    this.emitRunFinished({ mode: 'survival', won: false, wave: sv.wave, daily: this.daily });
    ctx.audio.play('gameOver');
    ctx.ui.setHudVisible(false);
    ctx.ui.showGameOver({
      ...this.summaryBase(sv.cleared),
      totalRounds: sv.wave,
      firstClear: false,
      clearReward: 0,
      unlockedZoneName: null,
      survival: { wave: sv.wave, best: sv.best, newBest },
    });
  }

  private brawlOver(): void {
    const { ctx } = this;
    const result = ctx.brawl.result;
    this.state = 'brawlOver';
    ctx.audio.setEngine(0, 0);
    ctx.audio.setPlowing(0);
    if (!result) return this.toMenu();
    ctx.progression.recordBrawl(result.placement, result.kills, result.bestStreak);
    this.emitRunFinished({
      mode: 'brawl', won: result.placement === 1, kills: result.kills, placement: result.placement,
      bestStreak: result.bestStreak, brawlDifficulty: this.brawlDifficulty,
    });
    ctx.audio.play(result.placement === 1 ? 'victory' : 'gameOver');
    ctx.ui.setHudVisible(false);
    ctx.ui.showBrawlResults(result);
  }

  private get isBossRound(): boolean {
    return !!this.ctx.zone.rounds[this.roundIndex]?.boss;
  }

  private beginCountdown(): void {
    const { ctx } = this;
    this.state = 'countdown';
    this.lastCountdownInt = -1;
    if (this.mode === 'survival') {
      this.countdown = this.survival.nextWave();
      const boss = this.survival.boss;
      if (boss) {
        const sub = bossIntroTitle(boss.types);
        ctx.ui.bossIntro(boss.name, boss.types.length > 1 ? `Wave ${this.survival.wave}\n${sub}` : `Wave ${this.survival.wave} · ${sub}`);
        ctx.audio.play('boss');
      } else ctx.ui.toast(`Wave ${this.survival.wave} incoming…`, 'info');
    } else if (this.isBossRound) {
      this.countdown = BOSS_COUNTDOWN_SECONDS;
      ctx.ui.bossIntro(ctx.zone.bossName, bossIntroTitle(ctx.zone.rounds[this.roundIndex].groups.map((g) => g.type)));
      ctx.audio.play('boss');
    } else {
      this.countdown = COUNTDOWN_SECONDS;
      ctx.ui.toast(`Round ${this.roundIndex + 1} — plow up a snowball!`, 'info');
    }
  }

  private startRound(): void {
    const { ctx } = this;
    this.state = 'playing';
    ctx.waves.start(ctx.zone, this.roundIndex);
    ctx.events.emit('roundStarted', { round: this.roundIndex + 1, total: ctx.zone.rounds.length, boss: this.isBossRound });
    ctx.audio.play('roundStart');
    const label = this.mode === 'survival' ? `WAVE ${this.survival.wave}` : `ROUND ${this.roundIndex + 1}`;
    ctx.ui.toast(this.isBossRound ? 'FIGHT!' : label, 'big');
  }

  private roundCleared(): void {
    const { ctx } = this;
    if (this.mode === 'survival') return this.survivalWaveCleared();
    ctx.pickups.collectAll();
    const bonus = Math.round((15 + 10 * this.roundIndex) * ctx.zone.coinMult);
    ctx.progression.addCoins(bonus);
    this.run.coins += bonus;
    ctx.combat.clear();
    ctx.audio.play('roundClear');
    if (this.roundIndex >= ctx.zone.rounds.length - 1) {
      this.victory();
      return;
    }
    this.state = 'shop';
    ctx.audio.setEngine(0, 0);
    ctx.audio.setPlowing(0);
    ctx.ui.showShop(this.roundIndex + 2, ctx.zone.rounds.length, () => {
      this.refreshStats();
      ctx.plow.hp = Math.min(ctx.plow.maxHp, ctx.plow.hp + ctx.stats.repairFraction * ctx.plow.maxHp);
      ctx.ui.hideOverlays();
      this.roundIndex++;
      this.beginCountdown();
    });
  }

  private victory(): void {
    const { ctx } = this;
    this.state = 'victory';
    this.run.bossDefeated = true;
    // Hard mode never changes unlocks; it records its own clear (meta/challenges.ts) and pays its own reward.
    const firstClear = ctx.progression.recordRun(this.zoneIndex, ctx.zone.rounds.length, !this.hard, this.run.kills) && !this.hard;
    const reward = this.hard
      ? recordHardClear(ctx.progression, this.zoneIndex)
      : firstClear ? ctx.zone.clearReward : Math.round(ctx.zone.clearReward * 0.4);
    ctx.progression.addCoins(reward);
    this.run.coins += reward;
    const next = ZONES[this.zoneIndex + 1];
    const summary: RunSummary = {
      ...this.summaryBase(ctx.zone.rounds.length),
      firstClear,
      clearReward: reward,
      unlockedZoneName: firstClear && next ? next.name : null,
    };
    this.emitRunFinished({ mode: 'campaign', won: true, zoneIndex: this.zoneIndex, roundsCleared: ctx.zone.rounds.length, hard: this.hard });
    ctx.audio.setEngine(0, 0);
    ctx.audio.setPlowing(0);
    ctx.audio.play('victory');
    ctx.ui.setHudVisible(false);
    ctx.ui.showVictory(summary);
  }

  private wrecked(): void {
    this.state = 'wrecked';
    this.wreckT = WRECK_SECONDS;
    this.ctx.audio.setEngine(0, 0);
    this.ctx.audio.setPlowing(0);
    this.ctx.audio.play('explosion');
    this.ctx.fx.shake(1.2);
    this.ctx.ui.toast('WRECKED!', 'big');
  }

  private gameOver(): void {
    const { ctx } = this;
    if (this.mode === 'survival') return this.survivalOver();
    this.state = 'gameover';
    ctx.progression.recordRun(this.zoneIndex, this.roundIndex, false, this.run.kills);
    this.emitRunFinished({ mode: 'campaign', won: false, zoneIndex: this.zoneIndex, roundsCleared: this.roundIndex, hard: this.hard });
    ctx.audio.play('gameOver');
    ctx.ui.setHudVisible(false);
    ctx.ui.showGameOver({ ...this.summaryBase(this.roundIndex), firstClear: false, clearReward: 0, unlockedZoneName: null });
  }

  /** Emit runFinished with this run's tallies (call after the result is recorded, before the results screen). */
  private emitRunFinished(extra: Partial<GameEvents['runFinished']> & Pick<GameEvents['runFinished'], 'mode' | 'won'>): void {
    const { ctx, run } = this;
    ctx.events.emit('runFinished', {
      plow: ctx.stats.plowKind,
      kills: run.kills,
      killsBy: { ...run.killsBy },
      coins: run.coins,
      bestCombo: run.bestCombo,
      biggestBall: run.biggestBall,
      duration: Math.max(0, ctx.time - run.start),
      damageTaken: run.damage,
      ...extra,
    });
  }

  private summaryBase(roundsCleared: number) {
    return {
      hard: this.mode === 'campaign' && this.hard,
      daily: this.mode === 'survival' && this.daily,
      zoneName: this.ctx.zone.name,
      bossName: this.ctx.zone.bossName,
      roundsCleared,
      totalRounds: this.ctx.zone.rounds.length,
      bossDefeated: this.run.bossDefeated,
      coinsEarned: this.run.coins,
      kills: this.run.kills,
      bestCombo: this.run.bestCombo,
      biggestBall: this.run.biggestBall,
    };
  }

  private togglePause(): void {
    if (this.state === 'playing' || this.state === 'countdown' || this.state === 'brawl' || this.state === 'brawlCountdown' || this.state === 'tutorial') {
      this.pausedFrom = this.state;
      this.state = 'paused';
      this.ctx.audio.setEngine(0, 0);
      this.ctx.audio.setPlowing(0);
      this.ctx.ui.showPause();
    } else if (this.state === 'paused') {
      this.resume();
    }
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.state = this.pausedFrom;
    this.ctx.ui.hideOverlays();
    this.ctx.input.clear();
  }

  private toggleMute(): void {
    const a = this.ctx.audio;
    a.muted = !a.muted;
    this.ctx.progression.setMuted(a.muted);
    this.ctx.ui.toast(a.muted ? 'Sound off' : 'Sound on', 'info');
  }

  private refreshStats(): void {
    const { ctx } = this;
    ctx.stats = ctx.progression.computeStats();
    if (this.mode === 'survival') this.survival.adjustStats(ctx.stats);
    ctx.plow.applyStats(ctx.stats);
  }

  private wireEvents(): void {
    const { events, ui } = this.ctx;
    events.on('enemyKilled', ({ enemy, source }) => {
      // Paint Shop kill effect (player kills only: Brawl emits this just for the player's kills).
      const kill = equippedLook(this.ctx.progression).kill;
      if (kill.style) emitKillFx(this.ctx, kill, enemy.position);
      this.run.kills++;
      this.run.killsBy[source ?? 'other']++;
    });
    events.on('plowDamaged', ({ amount }) => (this.run.damage += amount));
    events.on('coinCollected', ({ amount }) => (this.run.coins += amount));
    events.on('enemyHit', () => {
      this.combo = this.comboT > 0 ? this.combo + 1 : 1;
      this.comboT = COMBO_WINDOW;
      this.run.bestCombo = Math.max(this.run.bestCombo, this.combo);
    });
    events.on('strike', ({ count }) => {
      // Brawl economy is kills/streaks/shutdowns only (keeps the results breakdown exact).
      // Tutorial pays nothing either.
      if (this.mode === 'brawl' || this.state === 'tutorial') return void ui.toast(`STRIKE! x${count}`, 'info');
      const bonus = Math.round(count * 4 * this.ctx.zone.coinMult);
      this.ctx.progression.addCoins(bonus);
      this.run.coins += bonus;
      ui.toast(`STRIKE! x${count} +${bonus}`, 'big');
    });
    events.on('bossPhase', ({ name, label }) => ui.toast(`${name}: ${label}`, 'bad'));
    events.on('bossDefeated', ({ name }) => ui.toast(`${name} DESTROYED!`, 'big'));
  }

  /* ------------------------------------------------------------------ loop */

  private frame(t: number): void {
    this.timer.update(t);
    const dt = Math.min(this.timer.getDelta(), 0.05);
    // Gamepad: menus get synthetic arrow/Enter/Esc keys; Start toggles pause (not under the settings overlay).
    const input = this.ctx.input;
    input.menuNav = MENU_STATES.has(this.state) || settingsUi.open;
    input.poll();
    if (input.padPause && !settingsUi.open) this.togglePause();
    this.tick(dt);
    this.renderer.render(this.ctx.scene, this.ctx.camera);
  }

  /** Advance the simulation by dt seconds without rendering (also used by headless playtests). */
  tick(dt: number): void {
    if (this.state === 'brawl' || this.state === 'brawlCountdown') {
      this.tickBrawl(dt);
      return;
    }
    const { ctx, state } = this;
    const active = state === 'playing' || state === 'countdown' || state === 'wrecked' || state === 'tutorial';

    if (active) {
      // Slow-motion while the wreck animation plays.
      const simDt = state === 'wrecked' ? dt * 0.35 : dt;
      ctx.time += simDt;
      ctx.plow.update(simDt);
      ctx.snow.update(simDt);
      if (state === 'playing') ctx.waves.update(simDt);
      ctx.enemies.update(simDt);
      ctx.combat.update(simDt);
      ctx.pickups.update(simDt);

      if (this.comboT > 0) {
        this.comboT -= simDt;
        if (this.comboT <= 0) this.combo = 0;
      }

      if (state === 'tutorial') {
        this.tutorial.update(simDt); // handles its own wrecks; no waves / round flow
      } else if (state === 'wrecked') {
        this.wreckT -= dt;
        if (this.wreckT <= 0) this.gameOver();
      } else if (ctx.plow.dead) {
        this.wrecked();
      } else if (state === 'countdown') {
        this.countdown -= dt;
        const n = Math.ceil(this.countdown);
        if (n !== this.lastCountdownInt && n > 0 && n <= 3) ctx.audio.play('countdown');
        this.lastCountdownInt = n;
        if (this.countdown <= 0) this.startRound();
      } else if (ctx.waves.done) {
        this.roundCleared();
      }

      if (this.state === 'playing' || this.state === 'countdown' || this.state === 'tutorial') {
        const speedFrac = Math.min(1, Math.abs(ctx.plow.speed) / ctx.stats.maxSpeed);
        ctx.audio.setEngine(ctx.input.throttle, speedFrac);
      }
      if (this.state !== 'menu') this.updateHud();
    }

    ctx.fx.update(dt);
    ctx.world.update(dt);
    ctx.cameraRig.update(dt);
    ctx.input.endFrame();
  }

  private tickBrawl(dt: number): void {
    const { ctx } = this;
    const counting = this.state === 'brawlCountdown';
    ctx.time += dt;
    ctx.plow.update(dt);
    ctx.snow.update(dt);
    ctx.enemies.update(dt);
    ctx.combat.update(dt);
    ctx.pickups.update(dt);
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }
    if (counting) {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n !== this.lastCountdownInt && n > 0 && n <= 3) ctx.audio.play('countdown');
      this.lastCountdownInt = n;
      if (this.countdown <= 0) {
        this.state = 'brawl';
        ctx.brawl.activate();
        ctx.audio.play('roundStart');
        ctx.ui.toast('BRAWL!', 'big');
      }
    } else if (ctx.brawl.over) {
      this.brawlOver();
    }
    if (this.state === 'brawl' || this.state === 'brawlCountdown') {
      const speedFrac = Math.min(1, Math.abs(ctx.plow.speed) / ctx.stats.maxSpeed);
      ctx.audio.setEngine(ctx.plow.dead ? 0 : ctx.input.throttle, speedFrac);
      this.updateHud();
    }
    ctx.fx.update(dt);
    ctx.world.update(dt);
    ctx.cameraRig.update(dt);
    ctx.input.endFrame();
  }

  private blankHud(): HudState {
    return {
      zoneName: '', round: 1, totalRounds: 1, bossRound: false, enemiesRemaining: 0, plowHp: 1, plowMaxHp: 1,
      ballRadius: 0, ballMaxRadius: 1, coins: 0, dashReady: 1, whirlReady: -1, flameReady: -1, fAbility: 'fire', shield: -1, snowFraction: 1, bosses: [], combo: 0, countdown: 0, brawl: null,
    };
  }

  private updateHud(): void {
    const { ctx, hud } = this;
    hud.zoneName = ctx.zone.name;
    hud.round = this.roundIndex + 1;
    hud.totalRounds = ctx.zone.rounds.length;
    hud.bossRound = this.isBossRound;
    hud.enemiesRemaining = this.state === 'countdown' ? 0 : ctx.waves.remaining;
    hud.plowHp = ctx.plow.hp;
    hud.plowMaxHp = ctx.plow.maxHp;
    hud.ballRadius = ctx.plow.heldBallRadius;
    hud.ballMaxRadius = ctx.stats.maxBallRadius;
    hud.coins = ctx.progression.coins;
    hud.dashReady = ctx.plow.dashReady;
    hud.whirlReady = ctx.plow.whirlReady;
    hud.flameReady = ctx.combat.flameReady;
    hud.fAbility = PLOWS[ctx.stats.plowKind].fAbility;
    hud.shield = ctx.combat.shieldFrac;
    hud.overload = ctx.combat.overloadHeat;
    hud.overloadCost = ctx.combat.overloadCost;
    hud.snowFraction = ctx.snow.totalSnowFraction();
    hud.bosses = ctx.enemies.bosses.map((b) => ({ name: ENEMIES[b.type].name, title: ENEMIES[b.type].title, hp: b.hp, maxHp: b.maxHp }));
    hud.combo = this.combo;
    const counting = this.state === 'countdown' || this.state === 'brawlCountdown';
    hud.countdown = counting ? Math.max(0, this.countdown) : 0;
    hud.brawl = this.mode === 'brawl' ? ctx.brawl.hud() : null;
    hud.survival = this.mode === 'survival' ? this.survival.hud() : null;
    hud.hideRound = this.state === 'tutorial' || (this.state === 'paused' && this.pausedFrom === 'tutorial');
    if (hud.brawl) {
      hud.zoneName = ctx.zone.name;
      hud.bossRound = false;
      hud.enemiesRemaining = 0;
    }
    if (this.state === 'tutorial') {
      hud.zoneName = 'TRAINING YARD';
      hud.enemiesRemaining = ctx.enemies.aliveCount();
      hud.bossRound = false;
    }
    this.run.biggestBall = Math.max(this.run.biggestBall, hud.ballRadius);
    ctx.ui.updateHud(hud);
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.ctx.camera.aspect = w / h;
    this.ctx.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}
