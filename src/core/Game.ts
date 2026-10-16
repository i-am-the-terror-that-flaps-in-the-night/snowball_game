import * as THREE from 'three';
import { EventBus } from './events';
import { Input } from './input';
import { Progression } from './Progression';
import { BRAWL_ARENA_HALF, CAMPAIGN_ARENA_HALF, setArenaHalfSize } from './types';
import type { BrawlDifficulty, GameContext, HudState, RunSummary, UIHandlers } from './types';
import { BRAWL_ZONE, ZONES } from '../config/zones';
import { ENEMIES } from '../config/enemies';
import { SnowField } from '../world/SnowField';
import { Environment } from '../world/Environment';
import { Plow } from '../entities/Plow';
import { Combat } from '../entities/Combat';
import { EnemyManager } from '../entities/Enemies';
import { WaveDirector } from '../entities/Waves';
import { BrawlManager } from '../brawl/BrawlManager';
import { Pickups } from '../fx/Pickups';
import { Fx } from '../fx/Fx';
import { CameraRig } from '../fx/CameraRig';
import { AudioSystem } from '../audio/Audio';
import { UI } from '../ui/UI';

type State =
  | 'menu' | 'countdown' | 'playing' | 'shop' | 'paused' | 'wrecked' | 'gameover' | 'victory'
  | 'brawlCountdown' | 'brawl' | 'brawlOver';
type Mode = 'campaign' | 'brawl';

const COUNTDOWN_SECONDS = 3;
const BOSS_COUNTDOWN_SECONDS = 4;
/** Seconds of slow-motion wreck animation before the game-over screen. */
const WRECK_SECONDS = 1.6;
const COMBO_WINDOW = 2.5;

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
  private run = { kills: 0, coins: 0, biggestBall: 0, bestCombo: 0, bossDefeated: false };
  private hud: HudState;
  private mode: Mode = 'campaign';
  private campaignEnemies: EnemyManager;
  private brawlDifficulty: BrawlDifficulty = 'pro';

  constructor(container: HTMLElement, uiRoot: HTMLElement) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
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
    ctx.pickups = new Pickups(ctx);

    const handlers: UIHandlers = {
      onStartZone: (i) => this.startRun(i),
      onStartBrawl: (d) => this.startBrawl(d),
      onResume: () => this.resume(),
      onQuitToMenu: () => this.toMenu(),
      onRetry: () => this.startRun(this.zoneIndex),
      onResetSave: () => {
        progression.resetSave();
        this.refreshStats();
      },
      onToggleMute: () => this.toggleMute(),
    };
    ctx.ui = new UI(ctx, uiRoot, handlers);

    this.hud = this.blankHud();
    this.wireEvents();

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
      if (e.code === 'Escape' || e.code === 'KeyP') this.togglePause();
      if (e.code === 'KeyM') this.toggleMute();
    });

    // Handy for automated playtesting / debugging in the console.
    (window as unknown as { __game: Game }).__game = this;

    this.toMenu();
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
    setArenaHalfSize(mode === 'brawl' ? BRAWL_ARENA_HALF : CAMPAIGN_ARENA_HALF);
    ctx.enemies = mode === 'brawl' ? ctx.brawl : this.campaignEnemies;
    ctx.zone = mode === 'brawl' ? BRAWL_ZONE : ZONES[0];
    ctx.fx.clear();
    ctx.world.setZone(ctx.zone);
    ctx.snow.reset(ctx.zone);
  }

  private toMenu(): void {
    const { ctx } = this;
    this.setMode('campaign');
    this.state = 'menu';
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

  startRun(zoneIndex: number): void {
    const { ctx } = this;
    if (!ctx.progression.isZoneUnlocked(zoneIndex)) return;
    this.setMode('campaign');
    this.zoneIndex = zoneIndex;
    this.roundIndex = 0;
    this.run = { kills: 0, coins: 0, biggestBall: 0, bestCombo: 0, bossDefeated: false };
    this.combo = 0;
    ctx.zone = ZONES[zoneIndex];
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
    this.run = { kills: 0, coins: 0, biggestBall: 0, bestCombo: 0, bossDefeated: false };
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

  private brawlOver(): void {
    const { ctx } = this;
    const result = ctx.brawl.result;
    this.state = 'brawlOver';
    ctx.audio.setEngine(0, 0);
    ctx.audio.setPlowing(0);
    if (!result) return this.toMenu();
    ctx.progression.recordBrawl(result.placement, result.kills, result.bestStreak);
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
    if (this.isBossRound) {
      this.countdown = BOSS_COUNTDOWN_SECONDS;
      const first = ctx.zone.rounds[this.roundIndex].groups[0];
      const def = ENEMIES[first.type];
      ctx.ui.bossIntro(ctx.zone.bossName, def.title);
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
    ctx.ui.toast(this.isBossRound ? 'FIGHT!' : `ROUND ${this.roundIndex + 1}`, 'big');
  }

  private roundCleared(): void {
    const { ctx } = this;
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
    const firstClear = ctx.progression.recordRun(this.zoneIndex, ctx.zone.rounds.length, true, this.run.kills);
    const reward = firstClear ? ctx.zone.clearReward : Math.round(ctx.zone.clearReward * 0.4);
    ctx.progression.addCoins(reward);
    this.run.coins += reward;
    const next = ZONES[this.zoneIndex + 1];
    const summary: RunSummary = {
      ...this.summaryBase(ctx.zone.rounds.length),
      firstClear,
      clearReward: reward,
      unlockedZoneName: firstClear && next ? next.name : null,
    };
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
    this.state = 'gameover';
    ctx.progression.recordRun(this.zoneIndex, this.roundIndex, false, this.run.kills);
    ctx.audio.play('gameOver');
    ctx.ui.setHudVisible(false);
    ctx.ui.showGameOver({ ...this.summaryBase(this.roundIndex), firstClear: false, clearReward: 0, unlockedZoneName: null });
  }

  private summaryBase(roundsCleared: number) {
    return {
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
    if (this.state === 'playing' || this.state === 'countdown' || this.state === 'brawl' || this.state === 'brawlCountdown') {
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
    ctx.plow.applyStats(ctx.stats);
  }

  private wireEvents(): void {
    const { events, ui } = this.ctx;
    events.on('enemyKilled', () => this.run.kills++);
    events.on('coinCollected', ({ amount }) => (this.run.coins += amount));
    events.on('enemyHit', () => {
      this.combo = this.comboT > 0 ? this.combo + 1 : 1;
      this.comboT = COMBO_WINDOW;
      this.run.bestCombo = Math.max(this.run.bestCombo, this.combo);
    });
    events.on('strike', ({ count }) => {
      // Brawl economy is kills/streaks/shutdowns only (keeps the results breakdown exact).
      if (this.mode === 'brawl') return void ui.toast(`STRIKE! x${count}`, 'info');
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
    const active = state === 'playing' || state === 'countdown' || state === 'wrecked';

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

      if (state === 'wrecked') {
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

      if (this.state === 'playing' || this.state === 'countdown') {
        const speedFrac = Math.min(1, Math.abs(ctx.plow.speed) / ctx.stats.maxSpeed);
        ctx.audio.setEngine(ctx.input.throttle, speedFrac);
      }
      this.updateHud();
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
    hud.fAbility = ctx.stats.plowKind === 'volt' ? 'zap' : 'fire';
    hud.shield = ctx.combat.shieldFrac;
    hud.snowFraction = ctx.snow.totalSnowFraction();
    hud.bosses = ctx.enemies.bosses.map((b) => ({ name: ENEMIES[b.type].name, title: ENEMIES[b.type].title, hp: b.hp, maxHp: b.maxHp }));
    hud.combo = this.combo;
    const counting = this.state === 'countdown' || this.state === 'brawlCountdown';
    hud.countdown = counting ? Math.max(0, this.countdown) : 0;
    hud.brawl = this.mode === 'brawl' ? ctx.brawl.hud() : null;
    if (hud.brawl) {
      hud.zoneName = ctx.zone.name;
      hud.bossRound = false;
      hud.enemiesRemaining = 0;
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
