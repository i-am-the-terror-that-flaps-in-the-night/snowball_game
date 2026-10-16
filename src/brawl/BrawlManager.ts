import * as THREE from 'three';
import {
  ARENA,
  PLOW_MASS,
  SLAM_DAMAGE_K,
  ballRadius,
  ballVolume,
  type BrawlAPI,
  type BrawlDifficulty,
  type BrawlEntry,
  type BrawlHud,
  type BrawlResult,
  type DamageOpts,
  type EnemyHandle,
  type EnemyType,
  type GameContext,
  type SoundName,
} from '../core/types';
import {
  BRAWL_BOTS,
  BRAWL_BOT_NAMES,
  BRAWL_CLAN_TAGS,
  BRAWL_COLORS,
  BRAWL_DIFFICULTIES,
  BRAWL_KILL_COINS,
  BRAWL_KILL_TARGET,
  BRAWL_PERSONALITIES,
  BRAWL_PLACEMENT_BONUS,
  BRAWL_RESPAWN,
  BRAWL_SHUTDOWN_PER_STREAK,
  BRAWL_SPAWN_PROTECT,
  BRAWL_TAUNTS,
  BRAWL_TIME,
  BRAWL_HIT_CAP,
  PLAYER_BRAWL_COLOR,
  brawlHit,
  STREAK_TIERS,
  streakMult,
  type BrawlDifficultyDef,
} from '../config/brawl';
import { FX, UPGRADES, type UpgradeId } from '../config/upgrades';
import { BLADE_W, BLADE_Z, RIVAL_KINDS, createCocoa, createRivalRig, getDarkMaterial, getDebrisGeometry, type RivalRig } from './models';
import { NameTag, SpeechBubble } from './tags';
import { PLOWS } from '../config/plows';
import { Lightning } from '../fx/Lightning';
import {
  VOLT_CLAP_CD,
  VOLT_CLAP_DMG,
  VOLT_CLAP_KB,
  VOLT_CLAP_R,
  VOLT_CLAP_STUN,
  VOLT_CLAP_WIND,
  VOLT_ELITE_BONUS,
  VOLT_RIVAL_CHANCE,
  attachVoltRig,
  type VoltRig,
} from './voltRival';

/* Snowdome Brawl: the player + BRAWL_BOTS rival AI plows in a huge arena, everyone hunting everyone.
 * Rivals carry the player's kit (plow a ball, slam, ram, dash strike, whirlwind). Implements
 * EnemyManagerAPI, so every external damage() call is the PLAYER attacking. */

type Method = 'slam' | 'ram' | 'dash' | 'whirl' | 'wall' | 'other';
type Personality = (typeof BRAWL_PERSONALITIES)[number];
type Mode = 'gather' | 'fight' | 'heal' | 'flee';

// Rival kit. Base numbers (speed 10.5, accel 14, turn 2.6, collect 0.13, ball 1.4m, ram 14, dash +16 m/s every
// 2.6s, whirl 4m+blade / 10 dmg every 6s) live in BrawlManager.rivalStats(), scaled per lobby and per rival.
const RIVAL_R = 1.6;
const RIVAL_MASS = 1.5;
const SLAM_MIN_R = 0.55;
const SLAM_WIND = 0.22;
const SLAM_CD = 0.7;
const DASH_T = 0.5;
const WHIRL_T = 0.9;
const WHIRL_TICKS = [0.1, 0.35, 0.6, 0.85];
const SHIELD_COS = 0.5;
const COCOA_MAX = 6;
const COCOA_EVERY = 12;
const COCOA_HEAL = 40;
const KILL_CREDIT_WINDOW = 6;
const HEARING = 70;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _cam = new THREE.Vector3();
const EMPTY: readonly EnemyHandle[] = [];

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = THREE.MathUtils.clamp;
const pick = <T>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];
function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

interface Fighter {
  entry: BrawlEntry;
  rival: Rival | null;
  lastHitBy: Fighter | null;
  lastHitAt: number;
  lastHitMethod: Method;
}

let nextId = 5000;

/** Per-rival kit: the rival's own rolled garage levels (see rivalStats) through the player's FX curves. */
interface RivalStats {
  elite: boolean;
  maxSpeed: number;
  accel: number;
  turn: number;
  collect: number;
  maxBall: number;
  maxBallVol: number;
  ramBase: number;
  dashPower: number;
  dashCd: number;
  whirlR: number;
  whirlDmg: number;
  whirlCd: number;
  dmgMult: number;
  /** Multiplier on damage taken (Reinforced Frame levels). */
  damageTaken: number;
  /** HP regenerated per second (Repair Kit levels). */
  hpRegen: number;
  skill: number;
  reaction: number;
  /** The rival's rolled garage levels (debug / tuning). */
  levels: Partial<Record<UpgradeId, number>>;
  /** Fraction of frontal damage the held ball blocks (0.4, or 0.75 with Ice Shield). */
  shieldBlock: number;
  /** Avalanche Core: wider, harder-knocking slams. */
  avalanche: boolean;
  /** Drives VOLT-9: plow stat multipliers applied, electric skin, bot Thunderclap. */
  volt: boolean;
}

class Rival implements EnemyHandle {
  readonly id = nextId++;
  readonly type: EnemyType = 'rival';
  readonly radius = RIVAL_R;
  readonly mass = RIVAL_MASS;
  readonly isBoss = false;
  readonly rig: RivalRig;
  readonly tag: NameTag;
  readonly bubble = new SpeechBubble();
  readonly position: THREE.Vector3;
  hp: number;
  maxHp: number;
  alive = true;
  f!: Fighter;
  s!: RivalStats;
  readonly pers: Personality;

  heading = 0;
  speed = 0;
  desH = 0;
  desSpeed = 0;
  kvx = 0;
  kvz = 0;
  vx = 0;
  vz = 0;
  ballVol = 0;
  ballSpin = 0;
  wheelSpin = 0;
  lean = 0;

  // timers
  protectT = 0;
  respawnT = 0;
  frozenT = 0;
  flashT = 0;
  dashT = 0;
  dashCd = 1 + Math.random() * 2;
  whirlT = -1;
  whirlCd = 3 + Math.random() * 3;
  whirlTick = 0;
  slamT = -1;
  slamCd = 0;
  ramCd = 0;
  recoverT = 0;
  thinkT = 0;
  dodgeT = 0;
  dodgeH = 0;
  stuckT = 0;
  stuckCheckT = 1.2;
  stuckX = 0;
  stuckZ = 0;
  tauntCd = 0;
  /** VOLT-9 Thunderclap: telegraph timer (-1 = idle) and cooldown. */
  clapT = -1;
  clapCd = 2 + Math.random() * 3;
  volt: VoltRig | null = null;

  // AI
  mode: Mode = 'gather';
  target: Fighter | null = null;
  goalX = 0;
  goalZ = 0;
  goalT = 0;

  constructor(kindIndex: number, name: string, color: string, pers: Personality, hp: number) {
    this.rig = createRivalRig(RIVAL_KINDS[kindIndex % RIVAL_KINDS.length], color);
    this.position = this.rig.root.position;
    this.hp = hp;
    this.maxHp = hp;
    this.pers = pers;
    this.tag = new NameTag(name, color);
  }

  get ballR(): number {
    return ballRadius(this.ballVol);
  }
  get dashing(): boolean {
    return this.dashT > 0;
  }
  get whirling(): boolean {
    return this.whirlT >= 0;
  }
  get targetable(): boolean {
    return this.alive && this.protectT <= 0;
  }
}

interface Cocoa {
  root: THREE.Group;
  spin: THREE.Group;
  halo: THREE.Mesh;
  x: number;
  z: number;
  t: number;
}

interface Debris {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  rz: number;
  life: number;
}

export class BrawlManager implements BrawlAPI {
  private ctx: GameContext;
  private group = new THREE.Group();
  private rivals: Rival[] = [];
  private fighters: Fighter[] = [];
  private player!: Fighter;
  private diff: BrawlDifficultyDef = BRAWL_DIFFICULTIES[1];
  /** The player's endless-upgrade levels at match start; each rival rolls its own garage around them. */
  private playerLevels: Partial<Record<UpgradeId, number>> = {};
  private started = false;
  private active = false;
  private _over = false;
  private _result: BrawlResult | null = null;
  private timeLeft = BRAWL_TIME;
  private time = 0;
  private coinsEarned = 0;
  private playerDown = false;
  private playerRespawnT = 0;
  private killedBy = '';
  private spawnPoints: { x: number; z: number }[] = [];
  private cocoas: Cocoa[] = [];
  private cocoaT = 0;
  private debris: Debris[] = [];
  private queryOut: EnemyHandle[] = [];
  private hudObj: BrawlHud;
  private board: BrawlEntry[] = [];
  /** Bolts for VOLT-9 rivals (coil arcs, clap crackle + blast). */
  private lightning: Lightning;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.group.name = 'brawl';
    ctx.scene.add(this.group);
    this.lightning = new Lightning(ctx.scene);
    this.hudObj = {
      timeLeft: BRAWL_TIME,
      killTarget: BRAWL_KILL_TARGET,
      leaderboard: this.board,
      playerRank: 1,
      playerStreak: 0,
      streakMult: 1,
      respawnIn: 0,
      killedBy: '',
      arenaHalf: ARENA.maxX,
      me: { x: 0, z: 0, heading: 0 },
      blips: [],
      pickups: [],
      obstacles: [],
    };
  }

  /* ================================================================== BrawlAPI */

  get over(): boolean {
    return this._over;
  }
  get result(): BrawlResult | null {
    return this._result;
  }
  get bosses(): readonly EnemyHandle[] {
    return EMPTY;
  }

  start(difficulty: BrawlDifficulty): void {
    this.clear();
    const ctx = this.ctx;
    this.diff = BRAWL_DIFFICULTIES.find((d) => d.id === difficulty) ?? BRAWL_DIFFICULTIES[1];
    this.started = true;
    this.active = false;
    this.timeLeft = BRAWL_TIME;
    this.time = 0;
    this.coinsEarned = 0;
    this.playerDown = false;
    this.killedBy = '';
    this.captureGear();
    this.buildSpawnPoints();

    this.player = {
      entry: { name: 'YOU', color: PLAYER_BRAWL_COLOR, kills: 0, deaths: 0, streak: 0, bestStreak: 0, isPlayer: true, alive: true },
      rival: null,
      lastHitBy: null,
      lastHitAt: -99,
      lastHitMethod: 'other',
    };
    this.fighters.push(this.player);
    this.board.push(this.player.entry);

    const names = shuffle(BRAWL_BOT_NAMES);
    const colors = shuffle(BRAWL_COLORS);
    const kinds = shuffle(RIVAL_KINDS.map((_, i) => i));
    const pts = shuffle(this.spawnPoints);
    const p0 = pts[0];
    ctx.plow.reset({ x: p0.x, z: p0.z, heading: Math.atan2(-p0.x, -p0.z) });
    const clans = shuffle(BRAWL_CLAN_TAGS);
    for (let i = 0; i < BRAWL_BOTS; i++) {
      const p = pts[(i + 1) % pts.length];
      const elite = i < this.diff.elites;
      const name = elite ? `${clans[i % clans.length]}${names[i % names.length]}` : names[i % names.length];
      // Elites are brawlers/rammers (aggressive streak farmers); the rest cycle through all personalities.
      const pers = elite ? BRAWL_PERSONALITIES[i % 2] : BRAWL_PERSONALITIES[i % BRAWL_PERSONALITIES.length];
      const r = this.makeRival(name, colors[i % colors.length], kinds[i % kinds.length] + i, pers, 1, elite);
      this.placeRival(r, p.x, p.z, Math.atan2(-p.x, -p.z));
      r.protectT = 0;
    }
    for (let i = 0; i < 4; i++) this.spawnCocoa();
  }

  activate(): void {
    this.active = true;
  }

  hud(): BrawlHud {
    const h = this.hudObj;
    const plow = this.ctx.plow;
    h.timeLeft = Math.max(0, this.timeLeft);
    h.killTarget = BRAWL_KILL_TARGET;
    if (this.player) this.player.entry.alive = !plow.dead;
    this.sortBoard();
    h.leaderboard = this.board;
    h.playerRank = this.player ? this.board.indexOf(this.player.entry) + 1 : 1;
    h.playerStreak = this.player ? this.player.entry.streak : 0;
    h.streakMult = streakMult(h.playerStreak);
    h.respawnIn = this.playerDown ? Math.max(0, this.playerRespawnT) : 0;
    h.killedBy = this.killedBy;
    h.arenaHalf = ARENA.maxX;
    h.me.x = plow.position.x;
    h.me.z = plow.position.z;
    h.me.heading = plow.heading;
    let n = 0;
    for (const r of this.rivals) {
      if (!r.alive) continue;
      let b = h.blips[n];
      if (!b) {
        b = { x: 0, z: 0, color: '', bounty: false };
        h.blips[n] = b;
      }
      b.x = r.position.x;
      b.z = r.position.z;
      b.color = r.f.entry.color;
      b.bounty = r.f.entry.streak >= 3;
      n++;
    }
    h.blips.length = n;
    for (let i = 0; i < this.cocoas.length; i++) {
      let p = h.pickups[i];
      if (!p) {
        p = { x: 0, z: 0 };
        h.pickups[i] = p;
      }
      p.x = this.cocoas[i].x;
      p.z = this.cocoas[i].z;
    }
    h.pickups.length = this.cocoas.length;
    h.obstacles = this.ctx.world.obstacles;
    return h;
  }

  /* ================================================================== EnemyManagerAPI */

  spawn(type: EnemyType, x: number, z: number, opts?: { hpMult?: number; heading?: number }): EnemyHandle {
    void type;
    const r = this.makeRival(pick(BRAWL_BOT_NAMES), pick(BRAWL_COLORS), Math.floor(Math.random() * 6), pick(BRAWL_PERSONALITIES), opts?.hpMult);
    this.placeRival(r, x, z, opts?.heading ?? 0);
    return r;
  }

  query(x: number, z: number, radius: number, out?: EnemyHandle[]): EnemyHandle[] {
    const res = out ?? this.queryOut;
    res.length = 0;
    for (const r of this.rivals) {
      if (!r.targetable) continue;
      const d = Math.hypot(r.position.x - x, r.position.z - z);
      if (d < radius + r.radius) res.push(r);
    }
    return res;
  }

  /** Every external damage() call is the player attacking. */
  damage(enemy: EnemyHandle, amount: number, opts?: DamageOpts): boolean {
    const r = enemy as Rival;
    if (!(r instanceof Rival) || !r.targetable || this._over) return false;
    const src = opts?.source ?? 'other';
    const method: Method = src === 'ram' ? (this.ctx.plow.dashing ? 'dash' : 'ram') : src === 'slam' ? 'slam' : src === 'whirl' ? 'whirl' : 'other';
    if (opts?.freezeSeconds) r.frozenT = Math.max(r.frozenT, opts.freezeSeconds);
    const k = opts?.knockback;
    const fx = opts?.fromX ?? this.ctx.plow.position.x;
    const fz = opts?.fromZ ?? this.ctx.plow.position.z;
    const before = r.hp;
    const killed = this.hurtRival(r, amount, this.player, method, k ? k.x : 0, k ? k.z : 0, src === 'whirl', fx, fz);
    if (before !== r.hp) this.ctx.events.emit('enemyHit', { enemy: r, damage: before - Math.max(0, r.hp) });
    return killed;
  }

  aliveCount(): number {
    let n = 0;
    for (const r of this.rivals) if (r.alive) n++;
    return n;
  }

  clear(): void {
    for (const r of this.rivals) this.disposeRival(r);
    this.rivals.length = 0;
    this.fighters.length = 0;
    this.board.length = 0;
    for (const c of this.cocoas) this.group.remove(c.root);
    this.cocoas.length = 0;
    for (const d of this.debris) {
      this.group.remove(d.mesh);
      (d.mesh.material as THREE.Material).dispose();
    }
    this.debris.length = 0;
    this.lightning.clear();
    this.started = false;
    this.active = false;
    this._over = false;
    this._result = null;
    this.playerDown = false;
    this.killedBy = '';
    this.hudObj.blips.length = 0;
    this.hudObj.pickups.length = 0;
  }

  /* ================================================================== update */

  update(dt: number): void {
    if (!this.started) return;
    const ctx = this.ctx;
    this.time += dt;
    _cam.copy(ctx.camera.position);
    const fighting = this.active && !this._over;

    if (fighting) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) this.endMatch();
    }

    this.updatePlayerLife(dt);

    for (const r of this.rivals) {
      if (!r.alive) {
        r.respawnT -= dt;
        if (r.respawnT <= 0 && !this._over) this.respawnRival(r);
        continue;
      }
      this.tickTimers(r, dt);
      if (fighting) {
        r.thinkT -= dt;
        if (r.thinkT <= 0) {
          r.thinkT = r.s.reaction * (0.7 + Math.random() * 0.6);
          this.think(r);
        }
        this.steer(r, dt);
      } else {
        r.desSpeed = 0;
        r.desH = r.heading;
      }
      this.drive(r, dt);
    }

    this.resolveContacts(fighting);
    this.updateCocoa(dt, fighting);
    this.updateDebris(dt);
    for (const r of this.rivals) this.animate(r, dt);
    this.lightning.update(dt);
  }

  /* ================================================================== setup */

  /** Snapshot of the player's garage (endless upgrades only; specials are player perks). */
  private captureGear(): void {
    this.playerLevels = {};
    // Endless upgrades only, minus Pilot perks (player-only — rivals never copy those).
    for (const u of UPGRADES) if (u.maxLevel === Infinity && !u.playerOnly) this.playerLevels[u.id] = this.ctx.progression.level(u.id);
  }

  /** A rival's own garage: every upgrade rolled around the player's level for this lobby, then turned into
   *  stats with the SAME FX curves the player uses — so bots scale like real players instead of copying
   *  (and compounding) the player's multipliers. */
  private rivalStats(elite: boolean): { stats: RivalStats; hp: number } {
    const d = this.diff;
    const b = d.botLevels;
    const [lo, hi] = elite ? b.elite : b.regular;
    const floor = elite ? b.eliteFloor : b.floor;
    const levels: Partial<Record<UpgradeId, number>> = {};
    for (const id of Object.keys(this.playerLevels) as UpgradeId[]) {
      const mine = this.playerLevels[id] ?? 0;
      levels[id] = Math.max(floor, Math.round(mine * (lo + Math.random() * (hi - lo))));
    }
    const L = (id: UpgradeId) => levels[id] ?? 0;
    const maxBall = FX.maxBallRadius(L('hopper'));
    // Perks: a rival may own the same one-time specials the player owns.
    const prog = this.ctx.progression;
    const perkP = elite ? d.perkChance.elite : d.perkChance.regular;
    const iceShield = prog.level('iceShield') > 0 && Math.random() < perkP;
    const avalanche = prog.level('avalancheCore') > 0 && Math.random() < perkP;
    // Some rivals roll the VOLT-9 plow (more often in harder lobbies and among elites): its stat multipliers
    // only — the Volt upgrade line is player-only; they get a fixed bot Thunderclap instead.
    const volt = Math.random() < VOLT_RIVAL_CHANCE[d.id] + (elite ? VOLT_ELITE_BONUS : 0);
    const pd = PLOWS[volt ? 'volt' : 'classic'];
    const stats: RivalStats = {
      elite,
      maxSpeed: FX.maxSpeed(L('engine')) * (elite ? 1.02 : 1) * pd.speedMult,
      accel: FX.accel(L('engine')) * pd.accelMult,
      turn: FX.turnRate(L('engine')),
      // Rival blades don't widen visually, so blade levels show up as faster snow collection.
      collect: 0.13 * (FX.collectRate(L('compactor')) / 0.12) * (FX.bladeWidth(L('blade')) / 2.6),
      maxBall,
      maxBallVol: ballVolume(maxBall),
      ramBase: FX.ramDamage(L('ramSpikes')),
      dashPower: FX.dashPower(L('nitro')) * pd.dashPowerMult,
      dashCd: FX.dashCooldown(L('nitro')) + 0.2,
      whirlR: FX.whirlRadius(L('whirl')) + BLADE_W / 2,
      whirlDmg: FX.whirlDamage(L('whirl')),
      whirlCd: FX.whirlCooldown(L('whirl')),
      dmgMult: d.dmgMult * FX.damageMult(L('packedIce')) * (elite ? 1.05 : 1) * pd.slamMult,
      damageTaken: FX.damageTaken(L('plating')),
      hpRegen: FX.hpRegen(L('repairKit')),
      skill: clamp(d.skill + (elite ? 0.12 : -0.08), 0.1, 1),
      reaction: d.reaction * (elite ? 0.8 : 1.1),
      levels,
      shieldBlock: iceShield ? 0.75 : 0.4,
      avalanche,
      volt,
    };
    const hp = FX.maxHp(L('armor')) * (140 / 120) * d.hpMult * (elite ? 1.15 : 1) * pd.hpMult;
    return { stats, hp };
  }

  /** Number of streak tiers a fighter has reached (0..STREAK_TIERS.length). */
  private tierOf(streak: number): number {
    let n = 0;
    for (const t of STREAK_TIERS) if (streak >= t.at) n++;
    return n;
  }

  /** Rival damage multiplier including the "on fire" streak buff. */
  private dmgMult(r: Rival): number {
    return r.s.dmgMult * (1 + this.diff.streakBuff * this.tierOf(r.f.entry.streak));
  }

  /** Rival top speed including the streak buff. */
  private topSpeed(r: Rival): number {
    return r.s.maxSpeed * (1 + this.diff.streakBuff * 0.6 * this.tierOf(r.f.entry.streak));
  }

  private makeRival(name: string, color: string, kind: number, pers: Personality, hpMult = 1, elite = false): Rival {
    const rs = this.rivalStats(elite);
    const hp = Math.round(rs.hp * hpMult);
    const r = new Rival(kind, name, color, pers, hp);
    r.s = rs.stats;
    if (r.s.volt) {
      r.volt = attachVoltRig(r.rig, RIVAL_KINDS[kind % RIVAL_KINDS.length]);
      r.tag.setBadge('⚡');
    }
    r.f = {
      entry: { name, color, kills: 0, deaths: 0, streak: 0, bestStreak: 0, isPlayer: false, alive: true },
      rival: r,
      lastHitBy: null,
      lastHitAt: -99,
      lastHitMethod: 'other',
    };
    this.group.add(r.rig.root);
    this.group.add(r.tag.sprite);
    this.group.add(r.bubble.sprite);
    this.rivals.push(r);
    this.fighters.push(r.f);
    this.board.push(r.f.entry);
    return r;
  }

  private placeRival(r: Rival, x: number, z: number, heading: number): void {
    r.position.set(x, 0, z);
    r.heading = heading;
    r.desH = heading;
    r.speed = 0;
    r.kvx = r.kvz = 0;
    r.hp = r.maxHp;
    r.alive = true;
    r.f.entry.alive = true;
    r.ballVol = 0;
    r.dashT = 0;
    r.whirlT = -1;
    r.slamT = -1;
    r.clapT = -1;
    r.frozenT = 0;
    r.protectT = BRAWL_SPAWN_PROTECT;
    r.mode = 'gather';
    r.target = null;
    r.goalT = 0;
    r.stuckX = x;
    r.stuckZ = z;
    r.rig.root.visible = true;
    r.tag.sprite.visible = true;
    r.rig.root.rotation.set(0, heading, 0);
  }

  private disposeRival(r: Rival): void {
    this.group.remove(r.rig.root);
    this.group.remove(r.tag.sprite);
    this.group.remove(r.bubble.sprite);
    r.rig.dispose();
    r.volt?.dispose();
    r.tag.dispose();
    r.bubble.dispose();
  }

  private buildSpawnPoints(): void {
    const half = ARENA.maxX;
    const pts: { x: number; z: number }[] = [];
    const ring = (rad: number, n: number, off: number) => {
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * Math.PI * 2;
        pts.push({ x: Math.sin(a) * rad, z: Math.cos(a) * rad });
      }
    };
    ring(half * 0.77, 12, 0); // ~70m: the band the Snowdome keeps clear of obstacles and drifts
    ring(half * 0.38, 6, Math.PI / 6);
    this.spawnPoints = pts.map((p) => this.freeSpot(p.x, p.z, 4));
  }

  /** Nudge a point out of obstacles (and inside the walls). */
  private freeSpot(x: number, z: number, margin: number): { x: number; z: number } {
    const lim = ARENA.maxX - 6;
    for (let iter = 0; iter < 8; iter++) {
      let moved = false;
      for (const o of this.ctx.world.obstacles) {
        const dx = x - o.x;
        const dz = z - o.z;
        const d = Math.hypot(dx, dz);
        const need = o.r + RIVAL_R + margin;
        if (d < need) {
          const nx = d > 1e-3 ? dx / d : 1;
          const nz = d > 1e-3 ? dz / d : 0;
          x = o.x + nx * need;
          z = o.z + nz * need;
          moved = true;
        }
      }
      x = clamp(x, -lim, lim);
      z = clamp(z, -lim, lim);
      if (!moved) break;
    }
    return { x, z };
  }

  /** Spawn point farthest from every living fighter. */
  private bestSpawn(): { x: number; z: number } {
    let best = this.spawnPoints[0];
    let bestD = -1;
    for (const p of this.spawnPoints) {
      let minD = Infinity;
      for (const f of this.fighters) {
        if (!this.isAlive(f)) continue;
        const d = Math.hypot(this.fx(f) - p.x, this.fz(f) - p.z);
        if (d < minD) minD = d;
      }
      const score = minD + Math.random() * 8;
      if (score > bestD) {
        bestD = score;
        best = p;
      }
    }
    return best;
  }

  /* ================================================================== fighter helpers */

  private fx(f: Fighter): number {
    return f.rival ? f.rival.position.x : this.ctx.plow.position.x;
  }
  private fz(f: Fighter): number {
    return f.rival ? f.rival.position.z : this.ctx.plow.position.z;
  }
  private isAlive(f: Fighter): boolean {
    return f.rival ? f.rival.alive : !this.ctx.plow.dead;
  }
  private isTargetable(f: Fighter): boolean {
    return f.rival ? f.rival.targetable : !this.ctx.plow.dead && !this.ctx.plow.invulnerable;
  }
  private hpFrac(f: Fighter): number {
    if (f.rival) return f.rival.hp / f.rival.maxHp;
    const p = this.ctx.plow;
    return p.hp / Math.max(1, p.maxHp);
  }

  /** Volume 0..1 for a sound at (x, z), heard from the player. */
  private hear(x: number, z: number): number {
    const p = this.ctx.plow.position;
    return clamp(1 - Math.hypot(x - p.x, z - p.z) / HEARING, 0, 1);
  }
  private sfx(name: SoundName, x: number, z: number, vol = 1, pitch = 1): void {
    const v = this.hear(x, z) * vol;
    if (v > 0.06) this.ctx.audio.play(name, { volume: v, pitch });
  }
  private near(x: number, z: number, d = 75): boolean {
    return Math.hypot(x - _cam.x, z - _cam.z) < d;
  }

  /* ================================================================== AI */

  private think(r: Rival): void {
    const skill = r.s.skill;
    const pers = r.pers;
    const hp = r.hp / r.maxHp;

    // Get clear of a crackling VOLT-9 about to Thunderclap.
    if (r.dodgeT <= 0 && skill > 0.5 && Math.random() < skill) {
      for (const o of this.rivals) {
        if (o === r || !o.alive || o.clapT < 0) continue;
        const dx = r.position.x - o.position.x;
        const dz = r.position.z - o.position.z;
        if (Math.hypot(dx, dz) > VOLT_CLAP_R + RIVAL_R + 1) continue;
        r.dodgeT = VOLT_CLAP_WIND;
        r.dodgeH = Math.atan2(dx, dz);
        return;
      }
    }

    // Dodge incoming dash-strikes / slams aimed at us.
    if (r.dodgeT <= 0 && Math.random() < skill * 0.9) {
      for (const f of this.fighters) {
        if (f.rival === r || !this.isAlive(f)) continue;
        // Dashes / slam wind-ups always read as threats; smart rivals (elites, Legend) also respect anyone
        // lining up a big held ball on them.
        const smart = r.s.elite || skill >= 0.9;
        const bigBall = smart && (f.rival ? f.rival.ballR >= 0.8 && f.rival.slamCd <= 0 : this.ctx.plow.heldBallRadius >= 0.8);
        const threat = f.rival ? f.rival.dashing || f.rival.slamT >= 0 || bigBall : this.ctx.plow.dashing || bigBall;
        if (!threat) continue;
        if (bigBall && Math.hypot(r.position.x - this.fx(f), r.position.z - this.fz(f)) > 8) continue;
        const dx = r.position.x - this.fx(f);
        const dz = r.position.z - this.fz(f);
        const d = Math.hypot(dx, dz);
        if (d > 14) continue;
        const h = f.rival ? f.rival.heading : this.ctx.plow.heading;
        const aim = Math.abs(wrap(Math.atan2(dx, dz) - h));
        if (aim < 0.45) {
          r.dodgeT = 0.55;
          const side = wrap(Math.atan2(dx, dz) - r.heading) > 0 ? 1 : -1;
          r.dodgeH = Math.atan2(dx, dz) + side * Math.PI * 0.5;
          if (r.dashCd <= 0 && skill > 0.6 && Math.random() < pers.dashLove) {
            // Side-hop out of the lane (no heading snap): a burst of lateral velocity on the dash cooldown.
            r.kvx += Math.sin(r.dodgeH) * 15;
            r.kvz += Math.cos(r.dodgeH) * 15;
            r.dashCd = r.s.dashCd * 0.6;
            this.sfx('dash', r.position.x, r.position.z, 0.6, 1.2);
            if (this.near(r.position.x, r.position.z, 60)) {
              _v.set(r.position.x, 0.5, r.position.z);
              this.ctx.fx.burst(_v, { color: 0xffffff, count: 14, speed: 6, size: 0.24, gravity: 14, life: 0.6 });
            }
          }
          return;
        }
      }
    }

    // Heal / flee when hurt. Bots on a streak protect it: they bail out earlier.
    const streaking = r.f.entry.streak >= 3;
    if (hp < 0.35 * (0.6 + pers.caution) + (streaking ? 0.18 : 0) + (r.s.elite ? 0.08 : 0) && this.cocoas.length) {
      r.mode = 'heal';
      return;
    }
    if (hp < 0.2 + (streaking ? 0.1 : 0) && (pers.caution > 0.3 || streaking)) {
      r.mode = 'flee';
      return;
    }

    // Pick a target.
    let best: Fighter | null = null;
    let bestS = -Infinity;
    let maxKills = 0;
    for (const f of this.fighters) if (!f.entry.isPlayer) maxKills = Math.max(maxKills, f.entry.kills);
    // Cap how many rivals hunt the player at once (the lobby focuses you, but doesn't all pile on).
    let hunters = 0;
    for (const o of this.rivals) if (o !== r && o.alive && o.target === this.player) hunters++;
    // A player on a 5+ streak draws one extra hunter (bounty).
    const playerOpen = hunters < this.diff.maxHunters + (this.player.entry.streak >= 5 ? 1 : 0);
    const pe = this.player.entry;
    const playerLeads = pe.kills > 0 && pe.kills >= maxKills;
    for (const f of this.fighters) {
      if (f.rival === r || !this.isTargetable(f)) continue;
      if (f === this.player && !playerOpen) continue;
      const d = Math.hypot(this.fx(f) - r.position.x, this.fz(f) - r.position.z);
      let s = 60 / (d + 8);
      s += (1 - this.hpFrac(f)) * (pers.id === 'vulture' || r.s.elite ? 2 : 0.9) * pers.aggression;
      if (r.f.lastHitBy === f && this.time - r.f.lastHitAt < 6) s += 1.2;
      if (f === r.target) s += 0.4; // commitment
      if (f === this.player) {
        // Bounty hunting: the lobby goes after the player, harder when they lead or are on a streak.
        s += this.diff.playerFocus;
        if (playerLeads) s += 0.6 * this.diff.playerFocus;
        s += 0.35 * this.tierOf(pe.streak) * this.diff.playerFocus;
      } else {
        // Elites farm weaker bots; ordinary bots only mildly chase other bots' bounties.
        if (r.s.elite && f.rival && !f.rival.s.elite) s += 0.35;
        // Elites mostly leave each other alone (they farm bots and hunt the player) unless it's revenge.
        else if (r.s.elite && f.rival?.s.elite && r.f.lastHitBy !== f) s -= 0.35;
        // Ordinary bots steer clear of elites (more so when streaking) unless it's revenge — shutting elites
        // down is the player's job (and pays the shutdown bounty).
        else if (!r.s.elite && f.rival?.s.elite && r.f.lastHitBy !== f) s -= f.entry.streak >= 3 ? 0.9 : 0.45;
        else if (f.entry.streak >= 3) s += 0.2;
      }
      if (s > bestS) {
        bestS = s;
        best = f;
      }
    }
    r.target = best;
    const tDist = best ? Math.hypot(this.fx(best) - r.position.x, this.fz(best) - r.position.z) : Infinity;

    // Gather snow if the ball is small and nobody is in our face.
    const wantBall = 0.35 + 0.6 * pers.ballHunger;
    const engageRange = 16 - 6 * pers.aggression + (best === this.player ? 10 * this.diff.playerFocus : 0) + (r.s.elite ? 6 : 0);
    if (r.ballR < wantBall && tDist > engageRange) {
      r.mode = 'gather';
      return;
    }
    r.mode = best ? 'fight' : 'gather';
  }

  /** Per-frame steering toward the current goal + attack triggers. */
  private steer(r: Rival, dt: number): void {
    const ctx = this.ctx;
    if (r.slamT >= 0) {
      r.desSpeed = r.slamT < SLAM_WIND ? 2 : this.topSpeed(r);
      return;
    }
    if (r.clapT >= 0) {
      // Charging a Thunderclap: brake and crackle.
      r.desSpeed = 1.5;
      return;
    }
    if (r.stuckT > 0) {
      r.stuckT -= dt;
      r.desSpeed = -6;
      r.desH = r.heading + 1.2;
      return;
    }
    if (r.recoverT > 0) {
      r.recoverT -= dt;
      r.desSpeed = -5;
      r.desH = r.heading;
      return;
    }
    if (r.dodgeT > 0) {
      r.dodgeT -= dt;
      this.headTo(r, r.position.x + Math.sin(r.dodgeH) * 10, r.position.z + Math.cos(r.dodgeH) * 10, this.topSpeed(r));
      return;
    }

    let gx = r.position.x;
    let gz = r.position.z;
    let spd = this.topSpeed(r);
    switch (r.mode) {
      case 'gather': {
        r.goalT -= dt;
        if (r.goalT <= 0 || Math.hypot(r.goalX - r.position.x, r.goalZ - r.position.z) < 4) this.pickSnowGoal(r);
        gx = r.goalX;
        gz = r.goalZ;
        spd = this.topSpeed(r) * 0.85;
        break;
      }
      case 'heal': {
        let bd = Infinity;
        for (const c of this.cocoas) {
          const d = Math.hypot(c.x - r.position.x, c.z - r.position.z);
          if (d < bd) {
            bd = d;
            gx = c.x;
            gz = c.z;
          }
        }
        if (bd === Infinity) r.mode = 'fight';
        break;
      }
      case 'flee': {
        const t = r.f.lastHitBy;
        if (t && this.isAlive(t)) {
          gx = r.position.x + (r.position.x - this.fx(t));
          gz = r.position.z + (r.position.z - this.fz(t));
        }
        break;
      }
      case 'fight': {
        const t = r.target;
        if (!t || !this.isTargetable(t)) {
          r.mode = 'gather';
          break;
        }
        const tx = this.fx(t);
        const tz = this.fz(t);
        // Lead the target by its velocity (better aim with skill).
        let tvx = 0;
        let tvz = 0;
        if (t.rival) {
          tvx = t.rival.vx;
          tvz = t.rival.vz;
        } else {
          ctx.plow.getForward(_fwd);
          tvx = _fwd.x * ctx.plow.speed;
          tvz = _fwd.z * ctx.plow.speed;
        }
        const d = Math.hypot(tx - r.position.x, tz - r.position.z);
        const lead = (d / 20) * r.s.skill;
        gx = tx + tvx * lead;
        gz = tz + tvz * lead;
        const ang = Math.abs(wrap(Math.atan2(gx - r.position.x, gz - r.position.z) - r.heading));
        const br = r.ballR;
        const tR = t.rival ? RIVAL_R : ctx.plow.radius;
        // THUNDERCLAP (VOLT-9) when anyone is well inside the blast radius.
        if (r.s.volt && r.clapCd <= 0 && r.slamT < 0 && r.whirlT < 0 && !r.dashing && this.countEnemiesNear(r, VOLT_CLAP_R * 0.75) >= 1) {
          this.startClap(r);
          break;
        }
        // SLAM when close and lined up with a decent ball.
        if (br >= SLAM_MIN_R && r.slamCd <= 0 && r.whirlT < 0 && d < BLADE_Z + br * 2 + tR + 1.2 && ang < 0.5) {
          this.startSlam(r);
          break;
        }
        // WHIRL when swarmed.
        if (r.whirlCd <= 0 && r.slamT < 0) {
          const near = this.countEnemiesNear(r, r.s.whirlR + br);
          if (near >= 2 || (near >= 1 && Math.random() < r.pers.whirlLove * dt * 1.5)) {
            this.startWhirl(r);
            break;
          }
        }
        // DASH STRIKE when aligned at mid range.
        const tol = 0.1 + 0.3 * (1 - r.s.skill);
        if (r.dashCd <= 0 && d > 5 && d < 15 && ang < tol && Math.random() < r.pers.dashLove * dt * 4) {
          this.startDash(r);
          break;
        }
        // Otherwise drive in to ram — ease off when holding a slam-worthy ball to line it up.
        spd = br >= SLAM_MIN_R && d < 9 ? 6.5 : this.topSpeed(r);
        break;
      }
    }
    this.headTo(r, gx, gz, spd);
  }

  /** Set desired heading toward (gx, gz) with obstacle/wall avoidance. */
  private headTo(r: Rival, gx: number, gz: number, spd: number): void {
    let dx = gx - r.position.x;
    let dz = gz - r.position.z;
    const dist = Math.hypot(dx, dz) || 1;
    dx /= dist;
    dz /= dist;
    // Obstacles ahead: steer around.
    let ax = 0;
    let az = 0;
    for (const o of this.ctx.world.obstacles) {
      const ox = o.x - r.position.x;
      const oz = o.z - r.position.z;
      const along = ox * dx + oz * dz;
      if (along < 0 || along > 14 || along > dist) continue;
      const lat = ox * dz - oz * dx; // signed lateral offset
      const need = o.r + RIVAL_R + 1.2;
      if (Math.abs(lat) < need) {
        const push = (need - Math.abs(lat)) / need * (1 - along / 16);
        const side = lat >= 0 ? -1 : 1;
        ax += dz * side * push * 2.2;
        az += -dx * side * push * 2.2;
      }
    }
    // Walls.
    const m = 7;
    const p = r.position;
    if (p.x > ARENA.maxX - m) ax -= (p.x - (ARENA.maxX - m)) / m;
    if (p.x < ARENA.minX + m) ax += (ARENA.minX + m - p.x) / m;
    if (p.z > ARENA.maxZ - m) az -= (p.z - (ARENA.maxZ - m)) / m;
    if (p.z < ARENA.minZ + m) az += (ARENA.minZ + m - p.z) / m;
    dx += ax;
    dz += az;
    r.desH = Math.atan2(dx, dz);
    const turnNeed = Math.abs(wrap(r.desH - r.heading));
    r.desSpeed = turnNeed > 1.6 ? spd * 0.4 : spd;
  }

  private pickSnowGoal(r: Rival): void {
    const snow = this.ctx.snow;
    let bx = r.position.x;
    let bz = r.position.z;
    let bd = -1;
    const lim = ARENA.maxX - 8;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const rad = 8 + Math.random() * 30;
      const x = clamp(r.position.x + Math.sin(a) * rad, -lim, lim);
      const z = clamp(r.position.z + Math.cos(a) * rad, -lim, lim);
      const d = snow.getDepth(x, z) - rad * 0.004;
      if (d > bd) {
        bd = d;
        bx = x;
        bz = z;
      }
    }
    r.goalX = bx;
    r.goalZ = bz;
    r.goalT = 2.5 + Math.random() * 2;
  }

  private countEnemiesNear(r: Rival, rad: number): number {
    let n = 0;
    for (const f of this.fighters) {
      if (f.rival === r || !this.isTargetable(f)) continue;
      if (Math.hypot(this.fx(f) - r.position.x, this.fz(f) - r.position.z) < rad) n++;
    }
    return n;
  }

  /* ================================================================== moves */

  private startDash(r: Rival): void {
    r.dashT = DASH_T;
    r.dashCd = r.s.dashCd;
    r.speed = Math.max(r.speed, 0) + r.s.dashPower;
    this.sfx('dash', r.position.x, r.position.z, 0.8);
  }

  private startWhirl(r: Rival): void {
    r.whirlT = 0;
    r.whirlTick = 0;
    r.whirlCd = r.s.whirlCd;
    this.sfx('whirl', r.position.x, r.position.z, 0.8);
  }

  private startSlam(r: Rival): void {
    r.slamT = 0;
    r.slamCd = SLAM_CD;
  }

  private startClap(r: Rival): void {
    r.clapT = 0;
    r.clapCd = VOLT_CLAP_CD * (0.9 + Math.random() * 0.2);
    if (r.volt) r.volt.crackleT = 0;
    this.sfx('zap', r.position.x, r.position.z, 0.8, 0.7);
  }

  /** Bot Thunderclap: lightning blast around a VOLT-9 rival — damage (brawl-capped), shock-slow and knockback to
   *  every other fighter in range; the player is hit through combat.hitPlow so Battery Shield / i-frames apply. */
  private voltClap(r: Rival): void {
    const ctx = this.ctx;
    const px = r.position.x;
    const pz = r.position.z;
    const R = VOLT_CLAP_R;
    const dmg = VOLT_CLAP_DMG * this.dmgMult(r);
    const seen = this.near(px, pz, 90);
    if (seen) {
      _v.set(px, 24, pz);
      _v2.set(px, 1.2, pz);
      this.lightning.bolt(_v, _v2, { life: 0.35, width: 0.6, jag: 2, color: 0x9fe8ff });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
        _v.set(px, 1.6, pz);
        _v2.set(px + Math.sin(a) * R, 0.2, pz + Math.cos(a) * R);
        this.lightning.bolt(_v, _v2, { life: 0.25, width: 0.2, jag: 1 });
      }
      _v.set(px, 0.1, pz);
      ctx.fx.ring(_v, R, 0x7fdcff);
      ctx.fx.ring(_v, R * 0.6, 0xffffff);
      ctx.fx.burst(_v, { color: 0x9fe8ff, count: 30, speed: 12, size: 0.1, gravity: 8, life: 0.5 });
      const k = this.hear(px, pz);
      if (k > 0.1) ctx.fx.shake(0.15 + 0.45 * k);
    }
    this.sfx('thunder', px, pz, 1);
    for (const f of this.fighters) {
      if (f.rival === r || !this.isTargetable(f)) continue;
      const tx = this.fx(f);
      const tz = this.fz(f);
      const tR = f.rival ? RIVAL_R : ctx.plow.radius;
      const d = Math.hypot(tx - px, tz - pz);
      if (d > R + tR * 0.5) continue;
      const nx = (tx - px) / (d || 1);
      const nz = (tz - pz) / (d || 1);
      if (seen) {
        _v.set(px, 2, pz);
        _v2.set(tx, 1.2, tz);
        this.lightning.bolt(_v, _v2, { life: 0.3, width: 0.32 });
      }
      if (f.rival) f.rival.frozenT = Math.max(f.rival.frozenT, VOLT_CLAP_STUN);
      this.hitFighter(f, r.f, dmg, 'other', nx * VOLT_CLAP_KB, nz * VOLT_CLAP_KB, VOLT_CLAP_KB, true, px, pz);
    }
  }

  private slamImpact(r: Rival): void {
    const ctx = this.ctx;
    const br = r.ballR;
    if (br < 0.2) return;
    const fx = Math.sin(r.heading);
    const fz = Math.cos(r.heading);
    const cx = r.position.x + fx * (BLADE_Z + br + 0.5);
    const cz = r.position.z + fz * (BLADE_Z + br + 0.5);
    const zone = (br * 1.3 + 1.0) * (r.s.avalanche ? 1.5 : 1);
    const dmg = SLAM_DAMAGE_K * br * br * this.dmgMult(r);
    for (const f of this.fighters) {
      if (f.rival === r || !this.isTargetable(f)) continue;
      const tx = this.fx(f);
      const tz = this.fz(f);
      const tR = f.rival ? RIVAL_R : ctx.plow.radius;
      const d = Math.hypot(tx - cx, tz - cz);
      if (d > zone + tR) continue;
      const nx = (tx - r.position.x) / (Math.hypot(tx - r.position.x, tz - r.position.z) || 1);
      const nz = (tz - r.position.z) / (Math.hypot(tx - r.position.x, tz - r.position.z) || 1);
      const kb = (10 + 6 * br) * (r.s.avalanche ? 1.6 : 1);
      this.hitFighter(f, r.f, dmg, 'slam', nx * kb, nz * kb, kb, false, r.position.x, r.position.z);
    }
    // Ball shatters.
    const vol = r.ballVol;
    r.ballVol = 0;
    ctx.snow.addSnow(cx, cz, br * 1.6, vol * 0.4);
    r.speed += 8;
    if (this.near(cx, cz)) {
      _v.set(cx, br, cz);
      ctx.fx.burst(_v, { color: 0xffffff, count: Math.round(14 + br * 16), speed: 7 + br * 3, size: 0.25 + br * 0.08, gravity: 16, life: 0.9 });
      _v.y = 0.1;
      ctx.fx.ring(_v, zone + 0.6, 0xffffff);
      const k = this.hear(cx, cz);
      if (k > 0.2) ctx.fx.shake(0.12 + 0.3 * br * k);
    }
    this.sfx('slam', cx, cz, 0.9, clamp(1.2 - br * 0.25, 0.7, 1.2));
  }

  private whirlTick(r: Rival, final: boolean): void {
    const ctx = this.ctx;
    const R = r.s.whirlR + r.ballR;
    const dmg = r.s.whirlDmg * this.dmgMult(r);
    for (const f of this.fighters) {
      if (f.rival === r || !this.isTargetable(f)) continue;
      const tx = this.fx(f);
      const tz = this.fz(f);
      const dx = tx - r.position.x;
      const dz = tz - r.position.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d > R + (f.rival ? RIVAL_R : ctx.plow.radius) * 0.5) continue;
      const kb = final ? 18 : -5;
      this.hitFighter(f, r.f, dmg, 'whirl', (dx / d) * kb, (dz / d) * kb, kb, true, r.position.x, r.position.z);
    }
    // Sucks up snow into the ball.
    const got = ctx.snow.collectDisc(r.position.x, r.position.z, R * 0.7, 0.35);
    r.ballVol = Math.min(r.s.maxBallVol, r.ballVol + got * r.s.collect);
    if (this.near(r.position.x, r.position.z, 60)) {
      _v.set(r.position.x, 0.1, r.position.z);
      if (final) ctx.fx.ring(_v, R * 1.1, 0xbfeaff);
      _v.y = 1.2;
      ctx.fx.burst(_v, { color: 0xffffff, count: final ? 18 : 8, speed: final ? 12 : 7, size: 0.18, gravity: 6, life: 0.6 });
    }
    this.sfx('whirlTick', r.position.x, r.position.z, final ? 0.9 : 0.6, 0.9 + r.whirlTick * 0.12);
  }

  /* ================================================================== damage */

  /** A rival attacker hits fighter `victim` (player or rival). */
  private hitFighter(victim: Fighter, attacker: Fighter, dmg: number, method: Method, kx: number, kz: number, kb: number, unblockable: boolean, fromX: number, fromZ: number): void {
    if (this._over) return;
    if (victim.rival) {
      this.hurtRival(victim.rival, dmg, attacker, method, kx, kz, unblockable, fromX, fromZ);
      return;
    }
    const final = this.ctx.combat.hitPlow(brawlHit(dmg, this.ctx.plow.maxHp), fromX, fromZ, { knockback: kb, unblockable });
    if (final > 0) {
      victim.lastHitBy = attacker;
      victim.lastHitAt = this.time;
      victim.lastHitMethod = method;
    }
  }

  /** Damage a rival. Applies spawn protection, ball shield, dash/whirl reductions. Returns true on kill. */
  private hurtRival(r: Rival, amount: number, attacker: Fighter | null, method: Method, kx: number, kz: number, unblockable: boolean, fromX: number, fromZ: number): boolean {
    if (!r.targetable || this._over || amount <= 0) return false;
    // Brawl hit cap: nothing one-shots from full hp.
    // Wrecking Ball (player-only perk) raises the cap on the player's own hits.
    const capFrac = attacker === this.player ? BRAWL_HIT_CAP + this.ctx.stats.hitCapBonus : BRAWL_HIT_CAP;
    let dmg = brawlHit(amount, r.maxHp, capFrac) * r.s.damageTaken;
    // Ball shield on frontal hits.
    const br = r.ballR;
    if (!unblockable && br >= 0.2) {
      const dx = fromX - r.position.x;
      const dz = fromZ - r.position.z;
      const d = Math.hypot(dx, dz) || 1;
      if ((dx / d) * Math.sin(r.heading) + (dz / d) * Math.cos(r.heading) >= SHIELD_COS) {
        const blocked = dmg * r.s.shieldBlock;
        dmg -= blocked;
        r.ballVol = Math.max(0, r.ballVol - blocked * 0.04);
      }
    }
    if (r.dashing) dmg *= 0.5;
    if (r.whirling) dmg *= 0.7;
    // "On fire": every streak tier also hardens the rival a little.
    dmg *= 1 - 0.1 * this.tierOf(r.f.entry.streak);
    // Elites out-class ordinary bots: their hits dent them less (the player hits elites at full strength).
    if (r.s.elite && attacker?.rival && !attacker.rival.s.elite) dmg *= 0.7;
    r.hp -= dmg;
    r.flashT = 0.12;
    r.kvx += kx / r.mass;
    r.kvz += kz / r.mass;
    if (attacker) {
      r.f.lastHitBy = attacker;
      r.f.lastHitAt = this.time;
      r.f.lastHitMethod = method;
    }
    // Damage numbers for bot-vs-bot hits (Combat already shows the player's).
    if (attacker && !attacker.entry.isPlayer && this.near(r.position.x, r.position.z, 45)) {
      _v.set(r.position.x, r.rig.height + 1.2, r.position.z);
      this.ctx.fx.floatText(_v, `${Math.round(dmg)}`, '#e8eef6', 0.6);
    }
    if (r.hp <= 0) {
      r.hp = 0;
      this.onDeath(r.f, attacker, method);
      return true;
    }
    return false;
  }

  private onDeath(victim: Fighter, killer: Fighter | null, method: Method): void {
    const ctx = this.ctx;
    if (killer === victim) killer = null;
    const v = victim.entry;
    v.deaths++;
    v.alive = false;
    const victimStreak = v.streak;
    v.streak = 0;

    let coins = 0;
    let mult = 1;
    if (killer) {
      const k = killer.entry;
      k.kills++;
      k.streak++;
      k.bestStreak = Math.max(k.bestStreak, k.streak);
      mult = streakMult(k.streak);
      let shutdownBonus = 0;
      if (k.isPlayer) {
        coins = Math.round(BRAWL_KILL_COINS * mult * this.diff.coinMult);
        if (victimStreak >= 3) {
          shutdownBonus = Math.round(BRAWL_SHUTDOWN_PER_STREAK * victimStreak * this.diff.coinMult);
          coins += shutdownBonus;
        }
      }
      const tier = STREAK_TIERS.find((t) => t.at === k.streak);
      if (tier) {
        ctx.events.emit('brawlStreak', { name: k.name, color: k.color, count: k.streak, label: tier.label, mult: tier.mult, isPlayer: k.isPlayer });
        if (k.isPlayer) ctx.audio.play('streak');
      }
      if (victimStreak >= 3) {
        ctx.events.emit('brawlShutdown', { killer: k.name, victim: v.name, streak: victimStreak, bonus: shutdownBonus, killerIsPlayer: k.isPlayer });
        if (k.isPlayer) ctx.audio.play('shutdown');
      }
      if (coins > 0) this.award(coins, mult);
      // Rivals repair from the wreck they made — keeps streaks alive.
      if (killer.rival && killer.rival.alive) {
        const kr = killer.rival;
        const heal = kr.maxHp * this.diff.killHeal;
        kr.hp = Math.min(kr.maxHp, kr.hp + heal);
        if (this.near(kr.position.x, kr.position.z, 50)) {
          _v.set(kr.position.x, kr.rig.height + 2.2, kr.position.z);
          this.ctx.fx.floatText(_v, `+${Math.round(heal)}`, '#5dff8a', 0.7);
        }
      }
      if (killer.rival && killer.rival.tauntCd <= 0 && Math.random() < 0.4) {
        killer.rival.bubble.show(pick(BRAWL_TAUNTS));
        killer.rival.tauntCd = 8;
      }
    }
    ctx.events.emit('brawlKill', {
      killer: killer ? killer.entry.name : '',
      killerColor: killer ? killer.entry.color : '#ffffff',
      victim: v.name,
      victimColor: v.color,
      method: killer ? method : method === 'other' ? 'wall' : method,
      killerIsPlayer: !!killer?.entry.isPlayer,
      victimIsPlayer: v.isPlayer,
    });

    if (victim.rival) {
      const r = victim.rival;
      if (killer?.entry.isPlayer) ctx.events.emit('enemyKilled', { enemy: r, coins });
      this.wreckRival(r);
    } else {
      this.killedBy = killer ? killer.entry.name : '';
    }
    if (killer && killer.entry.kills >= BRAWL_KILL_TARGET) this.endMatch();
  }

  private award(coins: number, mult: number): void {
    const ctx = this.ctx;
    ctx.progression.addCoins(coins);
    ctx.events.emit('coinCollected', { amount: coins });
    this.coinsEarned += coins;
    _v.set(ctx.plow.position.x, 3.6, ctx.plow.position.z);
    ctx.fx.floatText(_v, mult > 1 ? `+${coins}  x${mult} STREAK` : `+${coins}`, '#ffd84a', 1.1);
    ctx.audio.play('coin', { pitch: 1 + Math.min(0.5, mult * 0.08) });
  }

  private wreckRival(r: Rival): void {
    const ctx = this.ctx;
    r.alive = false;
    r.respawnT = BRAWL_RESPAWN;
    r.rig.root.visible = false;
    r.tag.sprite.visible = false;
    r.bubble.hide();
    if (r.ballVol > 0) ctx.snow.addSnow(r.position.x, r.position.z, 2.5, r.ballVol * 0.5);
    r.ballVol = 0;
    const x = r.position.x;
    const z = r.position.z;
    if (this.near(x, z, 90)) {
      _v.set(x, 1.2, z);
      ctx.fx.burst(_v, { color: 0xff8a2a, count: 26, speed: 12, size: 0.14, gravity: 18, life: 0.6 });
      ctx.fx.burst(_v, { color: 0x30343a, count: 16, speed: 5, size: 0.5, gravity: -2, life: 1.4 });
      ctx.fx.burst(_v, { color: 0xffffff, count: 18, speed: 8, size: 0.3, gravity: 14, life: 1 });
      _v.y = 0.1;
      ctx.fx.ring(_v, 5, 0xffb060);
      const k = this.hear(x, z);
      if (k > 0.1) ctx.fx.shake(0.15 + 0.5 * k);
      // Debris chunks in the rival's paint + dark metal.
      for (let i = 0; i < 7; i++) {
        const mat = i % 2 === 0 ? r.rig.paint.clone() : getDarkMaterial().clone();
        const mesh = new THREE.Mesh(getDebrisGeometry(), mat);
        mesh.position.set(x + (Math.random() - 0.5) * 1.5, 1 + Math.random(), z + (Math.random() - 0.5) * 1.5);
        mesh.castShadow = true;
        this.group.add(mesh);
        const a = Math.random() * Math.PI * 2;
        const s = 4 + Math.random() * 6;
        this.debris.push({ mesh, vx: Math.sin(a) * s, vy: 6 + Math.random() * 6, vz: Math.cos(a) * s, rx: (Math.random() - 0.5) * 14, rz: (Math.random() - 0.5) * 14, life: 2.4 + Math.random() });
      }
    }
    this.sfx('explosion', x, z, 0.9);
  }

  private respawnRival(r: Rival): void {
    const p = this.bestSpawn();
    this.placeRival(r, p.x, p.z, Math.atan2(-p.x, -p.z));
    r.f.lastHitBy = null;
    this.sfx('respawn', p.x, p.z, 0.7);
  }

  private updatePlayerLife(dt: number): void {
    const ctx = this.ctx;
    const plow = ctx.plow;
    if (!this.player) return;
    if (plow.dead && !this.playerDown) {
      this.playerDown = true;
      this.playerRespawnT = BRAWL_RESPAWN;
      const f = this.player;
      const killer = f.lastHitBy && this.time - f.lastHitAt < KILL_CREDIT_WINDOW ? f.lastHitBy : null;
      this.onDeath(f, killer, f.lastHitMethod);
    }
    if (this.playerDown && !this._over) {
      this.playerRespawnT -= dt;
      if (this.playerRespawnT <= 0) {
        const p = this.bestSpawn();
        plow.reset({ x: p.x, z: p.z, heading: Math.atan2(-p.x, -p.z) });
        ctx.cameraRig.snap();
        ctx.audio.play('respawn');
        this.playerDown = false;
        this.player.entry.alive = true;
        this.player.lastHitBy = null;
        this.killedBy = '';
      }
    }
  }

  /* ================================================================== physics */

  private tickTimers(r: Rival, dt: number): void {
    r.protectT = Math.max(0, r.protectT - dt);
    if (r.s.hpRegen > 0 && r.hp < r.maxHp) r.hp = Math.min(r.maxHp, r.hp + r.s.hpRegen * dt);
    r.frozenT = Math.max(0, r.frozenT - dt);
    r.flashT = Math.max(0, r.flashT - dt);
    r.ramCd = Math.max(0, r.ramCd - dt);
    r.slamCd = Math.max(0, r.slamCd - dt);
    r.tauntCd = Math.max(0, r.tauntCd - dt);
    if (r.dashT > 0) r.dashT = Math.max(0, r.dashT - dt);
    else r.dashCd = Math.max(0, r.dashCd - dt);
    if (r.whirlT < 0) r.whirlCd = Math.max(0, r.whirlCd - dt);
    if (r.bubble.t > 0) {
      r.bubble.t -= dt;
      if (r.bubble.t <= 0) r.bubble.hide();
    }
    // Slam wind-up -> impact.
    if (r.slamT >= 0) {
      const prev = r.slamT;
      r.slamT += dt;
      if (prev < SLAM_WIND && r.slamT >= SLAM_WIND) this.slamImpact(r);
      if (r.slamT > SLAM_WIND + 0.25) r.slamT = -1;
    }
    // Whirl ticks.
    if (r.whirlT >= 0) {
      r.whirlT += dt;
      while (r.whirlTick < WHIRL_TICKS.length && r.whirlT >= WHIRL_TICKS[r.whirlTick]) {
        this.whirlTick(r, r.whirlTick === WHIRL_TICKS.length - 1);
        r.whirlTick++;
      }
      if (r.whirlT >= WHIRL_T) r.whirlT = -1;
    }
    // VOLT-9 Thunderclap: telegraph -> blast (only once the match is live).
    if (r.s.volt) {
      if (r.clapT >= 0) {
        r.clapT += dt;
        if (r.clapT >= VOLT_CLAP_WIND) {
          r.clapT = -1;
          if (this.active && !this._over) this.voltClap(r);
        }
      } else r.clapCd = Math.max(0, r.clapCd - dt);
    }
    // Stuck detection.
    r.stuckCheckT -= dt;
    if (r.stuckCheckT <= 0) {
      r.stuckCheckT = 1.2;
      const moved = Math.hypot(r.position.x - r.stuckX, r.position.z - r.stuckZ);
      if (moved < 1.2 && r.desSpeed > 3 && r.slamT < 0 && r.whirlT < 0 && this.active) r.stuckT = 0.8;
      r.stuckX = r.position.x;
      r.stuckZ = r.position.z;
    }
  }

  private drive(r: Rival, dt: number): void {
    const ctx = this.ctx;
    const frozen = r.frozenT > 0 ? 0.5 : 1;
    const diff = wrap(r.desH - r.heading);
    const turnRate = r.s.turn * (r.dashing ? 0.4 : 1) * frozen * (0.45 + 0.55 * Math.min(1, Math.abs(r.speed) / 4));
    const turn = clamp(diff, -turnRate * dt, turnRate * dt);
    r.heading = wrap(r.heading + turn);
    r.lean += (clamp(turn / Math.max(dt, 1e-4) * 0.04, -0.12, 0.12) - r.lean) * Math.min(1, dt * 6);

    const cap = this.topSpeed(r) * frozen * (1 - 0.2 * (r.ballR / r.s.maxBall)) * (r.whirling ? 0.75 : 1);
    if (!r.dashing) {
      const target = clamp(r.desSpeed, -cap * 0.45, cap);
      if (r.speed > cap) r.speed = Math.max(cap, r.speed - 14 * dt);
      else r.speed += clamp(target - r.speed, -r.s.accel * 1.4 * dt, r.s.accel * dt);
    }

    const fx = Math.sin(r.heading);
    const fz = Math.cos(r.heading);
    const decay = Math.exp(-4 * dt);
    r.kvx *= decay;
    r.kvz *= decay;
    r.vx = fx * r.speed + r.kvx;
    r.vz = fz * r.speed + r.kvz;
    r.position.x += r.vx * dt;
    r.position.z += r.vz * dt;

    // Walls.
    const lim = RIVAL_R;
    let wall = false;
    if (r.position.x < ARENA.minX + lim) { r.position.x = ARENA.minX + lim; r.kvx = Math.abs(r.kvx) * 0.4; wall = true; }
    if (r.position.x > ARENA.maxX - lim) { r.position.x = ARENA.maxX - lim; r.kvx = -Math.abs(r.kvx) * 0.4; wall = true; }
    if (r.position.z < ARENA.minZ + lim) { r.position.z = ARENA.minZ + lim; r.kvz = Math.abs(r.kvz) * 0.4; wall = true; }
    if (r.position.z > ARENA.maxZ - lim) { r.position.z = ARENA.maxZ - lim; r.kvz = -Math.abs(r.kvz) * 0.4; wall = true; }
    // Obstacles.
    for (const o of ctx.world.obstacles) {
      const dx = r.position.x - o.x;
      const dz = r.position.z - o.z;
      const d = Math.hypot(dx, dz);
      const need = o.r + RIVAL_R;
      if (d < need && d > 1e-4) {
        r.position.x = o.x + (dx / d) * need;
        r.position.z = o.z + (dz / d) * need;
        wall = true;
      }
    }
    if (wall && Math.abs(r.speed) > 6) {
      if (r.dashing) {
        r.dashT = 0;
        this.sfx('wallHit', r.position.x, r.position.z, 0.8);
      }
      r.speed *= 0.4;
    }

    // Plow snow into the ball.
    if (r.speed > 0.5 && r.whirlT < 0) {
      const rx = fz;
      const rz = -fx;
      const bx = r.position.x + fx * BLADE_Z;
      const bz = r.position.z + fz * BLADE_Z;
      const hw = BLADE_W / 2;
      const removed = ctx.snow.plowLine(bx - rx * hw, bz - rz * hw, bx + rx * hw, bz + rz * hw, r.speed * dt + 0.35, 0.85);
      if (removed > 0) {
        r.ballVol = Math.min(r.s.maxBallVol, r.ballVol + removed * r.s.collect);
        if (removed > 0.02 && this.near(bx, bz, 40)) {
          _v.set(bx, 0.4, bz);
          _v2.set(fx, 0.5, fz).normalize();
          ctx.fx.spray(_v, _v2, Math.min(1, removed * 2) * 0.6);
        }
      }
    }
  }

  /** Vehicle-vehicle separation, rams and dash strikes (player included). */
  private resolveContacts(fighting: boolean): void {
    const ctx = this.ctx;
    const plow = ctx.plow;
    const n = this.rivals.length;
    // Rival vs rival.
    for (let i = 0; i < n; i++) {
      const a = this.rivals[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.rivals[j];
        if (!b.alive) continue;
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const d = Math.hypot(dx, dz);
        const minD = a.radius + b.radius;
        if (d >= minD || d < 1e-4) continue;
        const nx = dx / d;
        const nz = dz / d;
        const push = (minD - d) * 0.5;
        a.position.x -= nx * push;
        a.position.z -= nz * push;
        b.position.x += nx * push;
        b.position.z += nz * push;
        if (!fighting) continue;
        // n points a -> b; tryRivalRam wants the unit vector from the victim to the attacker.
        this.tryRivalRam(a, b.f, -nx, -nz);
        this.tryRivalRam(b, a.f, nx, nz);
      }
    }
    // Rivals vs player.
    if (plow.dead) return;
    plow.getForward(_fwd);
    for (const r of this.rivals) {
      if (!r.alive) continue;
      const dx = r.position.x - plow.position.x;
      const dz = r.position.z - plow.position.z;
      const d = Math.hypot(dx, dz);
      const minD = r.radius + plow.radius;
      if (d >= minD || d < 1e-4) continue;
      const nx = dx / d;
      const nz = dz / d;
      const total = r.mass + PLOW_MASS;
      const overlap = minD - d;
      r.position.x += nx * overlap * (PLOW_MASS / total);
      r.position.z += nz * overlap * (PLOW_MASS / total);
      plow.position.x -= nx * overlap * (r.mass / total);
      plow.position.z -= nz * overlap * (r.mass / total);
      if (!fighting) continue;
      // Player rams the rival.
      const dot = _fwd.x * nx + _fwd.z * nz;
      if (dot > 0.55 && plow.speed > 3 && r.ramCd <= 0 && r.targetable) {
        const closing = plow.speed * dot - (r.vx * nx + r.vz * nz);
        ctx.combat.playerRam(r, Math.max(closing, plow.speed * 0.6));
        r.ramCd = 0.35;
        if (!plow.dashing) plow.speed *= 0.6;
      }
      // Rival rams the player (n points player -> rival = victim -> attacker).
      this.tryRivalRam(r, this.player, nx, nz);
    }
  }

  /** Rival `a` rams fighter `victim` if its front faces them at speed. n = unit vector from victim to a. */
  private tryRivalRam(a: Rival, victim: Fighter, nx: number, nz: number): void {
    if (a.ramCd > 0 || a.speed < 4 || !this.isTargetable(victim)) return;
    const fx = Math.sin(a.heading);
    const fz = Math.cos(a.heading);
    // a -> victim direction is -n.
    const dot = -(fx * nx + fz * nz);
    if (dot < 0.55) return;
    const br = a.ballR;
    const ballBonus = br > 0.2 ? 6 * br * br : 0;
    const dashing = a.dashing;
    const dmg = (dashing ? 25 + a.s.ramBase * 1.8 : a.s.ramBase * clamp(a.speed / 10, 0.3, 1.8)) * this.dmgMult(a) + ballBonus;
    const kb = dashing ? 22 : 4 + a.speed * 0.9;
    a.ramCd = 0.35;
    this.hitFighter(victim, a.f, dmg, dashing ? 'dash' : 'ram', -nx * kb, -nz * kb, kb, false, a.position.x, a.position.z);
    if (br > 0.2) a.ballVol *= 0.9;
    if (!dashing) {
      a.speed *= 0.5;
      a.recoverT = 0.35 + Math.random() * 0.3;
    }
    const x = this.fx(victim);
    const z = this.fz(victim);
    if (this.near(x, z, 60)) {
      _v.set((a.position.x + x) / 2, 1, (a.position.z + z) / 2);
      this.ctx.fx.burst(_v, { color: 0xffc04a, count: dashing ? 22 : 10, speed: dashing ? 12 : 7, size: 0.09, gravity: 22, life: 0.4 });
    }
    if (!victim.entry.isPlayer) this.sfx(dashing ? 'dashStrike' : 'ram', a.position.x, a.position.z, 0.7);
  }

  /* ================================================================== cocoa */

  private spawnCocoa(): void {
    if (this.cocoas.length >= COCOA_MAX) return;
    const lim = ARENA.maxX - 10;
    const p = this.freeSpot((Math.random() * 2 - 1) * lim, (Math.random() * 2 - 1) * lim, 3);
    const c = createCocoa();
    c.root.position.set(p.x, 0, p.z);
    this.group.add(c.root);
    this.cocoas.push({ root: c.root, spin: c.spin, halo: c.halo, x: p.x, z: p.z, t: Math.random() * 6 });
  }

  private updateCocoa(dt: number, fighting: boolean): void {
    const ctx = this.ctx;
    if (fighting) {
      this.cocoaT += dt;
      if (this.cocoaT >= COCOA_EVERY) {
        this.cocoaT = 0;
        this.spawnCocoa();
      }
    }
    for (let i = this.cocoas.length - 1; i >= 0; i--) {
      const c = this.cocoas[i];
      c.t += dt;
      c.spin.rotation.y += dt * 1.8;
      c.spin.position.y = 0.6 + Math.sin(c.t * 2.4) * 0.18 + ctx.snow.getDepth(c.x, c.z);
      c.halo.scale.setScalar(1 + Math.sin(c.t * 3) * 0.12);
      if (!fighting) continue;
      let taker: Fighter | null = null;
      if (!ctx.plow.dead && Math.hypot(ctx.plow.position.x - c.x, ctx.plow.position.z - c.z) < ctx.plow.radius + 1) taker = this.player;
      if (!taker) {
        for (const r of this.rivals) {
          if (r.alive && Math.hypot(r.position.x - c.x, r.position.z - c.z) < RIVAL_R + 1) {
            taker = r.f;
            break;
          }
        }
      }
      if (!taker) continue;
      if (taker.rival) {
        taker.rival.hp = Math.min(taker.rival.maxHp, taker.rival.hp + COCOA_HEAL);
        if (taker.rival.mode === 'heal') taker.rival.mode = 'fight';
      } else {
        ctx.plow.hp = Math.min(ctx.plow.maxHp, ctx.plow.hp + COCOA_HEAL);
      }
      _v.set(c.x, 3, c.z);
      if (this.near(c.x, c.z, 60)) ctx.fx.floatText(_v, `+${COCOA_HEAL}`, '#5dff8a', 1);
      this.sfx('heal', c.x, c.z, 0.9);
      this.group.remove(c.root);
      this.cocoas.splice(i, 1);
    }
  }

  private updateDebris(dt: number): void {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.life -= dt;
      d.vy -= 22 * dt;
      d.mesh.position.x += d.vx * dt;
      d.mesh.position.y += d.vy * dt;
      d.mesh.position.z += d.vz * dt;
      if (d.mesh.position.y < 0.15) {
        d.mesh.position.y = 0.15;
        d.vy = Math.abs(d.vy) * 0.3;
        d.vx *= 0.6;
        d.vz *= 0.6;
        d.rx *= 0.6;
        d.rz *= 0.6;
      }
      d.mesh.rotation.x += d.rx * dt;
      d.mesh.rotation.z += d.rz * dt;
      if (d.life < 0.5) d.mesh.scale.setScalar(Math.max(0.01, d.life / 0.5));
      if (d.life <= 0) {
        this.group.remove(d.mesh);
        (d.mesh.material as THREE.Material).dispose();
        this.debris.splice(i, 1);
      }
    }
  }

  /* ================================================================== visuals */

  private animate(r: Rival, dt: number): void {
    const rig = r.rig;
    const tagVisible = r.alive && this.started;
    r.tag.sprite.visible = tagVisible;
    if (!r.alive) {
      r.bubble.sprite.visible = false;
      return;
    }
    const depth = this.ctx.snow.getDepth(r.position.x, r.position.z);
    r.position.y += (Math.min(0.25, depth * 0.3) - r.position.y) * Math.min(1, dt * 6);
    rig.root.rotation.set(0, r.heading, 0);
    // Whirl spin of the body + tornado.
    if (r.whirlT >= 0) {
      const k = r.whirlT / WHIRL_T;
      rig.body.rotation.y = (1 - (1 - k) * (1 - k)) * Math.PI * 4;
      rig.tornado.visible = true;
      rig.tornado.rotation.y += dt * 14;
      const s = (r.s.whirlR + r.ballR) / 4.2;
      rig.tornado.scale.set(s, 0.8 + Math.sin(k * Math.PI) * 0.4, s);
    } else {
      rig.body.rotation.y = 0;
      rig.tornado.visible = false;
    }
    rig.body.rotation.z = r.lean;
    // Slam wind-up: rear back, then lunge.
    const slamK = r.slamT >= 0 ? (r.slamT < SLAM_WIND ? -0.12 * (r.slamT / SLAM_WIND) : 0.1) : 0;
    rig.body.rotation.x += (slamK - rig.body.rotation.x) * Math.min(1, dt * 18);
    // Wheels.
    r.wheelSpin += r.speed * dt;
    for (let i = 0; i < rig.wheels.length; i++) rig.wheels[i].rotation.x = r.wheelSpin / rig.wheelR[i];
    // Held ball.
    const br = r.ballR;
    rig.ball.visible = br > 0.15;
    if (rig.ball.visible) {
      rig.ball.scale.setScalar(br);
      rig.ball.position.set(0, br - r.position.y + 0.02, BLADE_Z + br);
      r.ballSpin += (r.speed * dt) / Math.max(0.2, br);
      rig.ball.rotation.x = r.ballSpin;
    }
    // Glow: slam wind-up / bounty.
    const bounty = r.f.entry.streak >= 5;
    const winding = r.slamT >= 0 && r.slamT < SLAM_WIND;
    rig.glow.visible = winding || bounty || r.dashing;
    rig.glowMat.opacity = winding ? 0.5 + 0.4 * (r.slamT / SLAM_WIND) : r.dashing ? 0.45 : 0.25 + 0.15 * Math.sin(this.time * 6);
    // Flash / frozen / protection blink.
    const paint = rig.paint;
    if (r.flashT > 0) {
      paint.emissive.setRGB(1, 1, 1);
      paint.emissiveIntensity = 0.8;
    } else if (r.frozenT > 0) {
      paint.emissive.setRGB(0.3, 0.6, 1);
      paint.emissiveIntensity = 0.6;
    } else {
      paint.emissiveIntensity = 0;
    }
    rig.root.visible = r.protectT <= 0 || Math.sin(this.time * 30) > -0.3;
    rig.beacon.emissiveIntensity = 1.5 + Math.sin(this.time * 8 + r.id) * 1;
    if (r.volt) this.animateVolt(r, dt);
    // Tag + bubble.
    const top = rig.height + 0.9;
    r.tag.set(r.hp / r.maxHp, r.f.entry.streak, r.protectT > 0);
    r.tag.place(r.position.x, r.position.y + top, r.position.z, _cam);
    if (r.bubble.t > 0) r.bubble.place(r.position.x, r.position.y + top + 2.4, r.position.z, _cam);
  }

  /** VOLT-9 rival: pulsing coils, idle arcs between them, and the Thunderclap telegraph (growing ground ring +
   *  crackle bolts from the coils to the ground). */
  private animateVolt(r: Rival, dt: number): void {
    const v = r.volt!;
    const charging = r.clapT >= 0;
    const k = charging ? r.clapT / VOLT_CLAP_WIND : 0;
    v.coilMat.emissiveIntensity = charging ? 2 + 3 * k : 1.2 + 0.8 * Math.sin(this.time * 14 + r.id) * Math.sin(this.time * 5.3);
    v.telegraph.visible = charging;
    if (charging) {
      v.telegraph.scale.setScalar(VOLT_CLAP_R * (0.35 + 0.65 * k));
      v.telegraphMat.opacity = (0.35 + 0.45 * k) * (0.75 + 0.25 * Math.sin(this.time * 40));
    }
    if (!this.near(r.position.x, r.position.z, 70) || !r.rig.root.visible) return;
    v.arcT -= dt;
    v.crackleT -= dt;
    const arc = v.arcT <= 0;
    const crackle = charging && v.crackleT <= 0;
    if (!arc && !crackle) return;
    r.rig.root.updateMatrixWorld();
    const a = v.coilTops[0].getWorldPosition(_v);
    const b = v.coilTops[1].getWorldPosition(_v2);
    if (arc) {
      v.arcT = charging ? 0.05 : 0.25 + Math.random() * 0.6;
      this.lightning.bolt(a, b, { life: 0.1, width: 0.1, jag: 0.35, color: 0x3fa8ff });
    }
    if (crackle) {
      v.crackleT = 0.06;
      const from = Math.random() < 0.5 ? a : b;
      const ang = Math.random() * Math.PI * 2;
      const rad = VOLT_CLAP_R * (0.3 + 0.6 * k) * (0.5 + 0.5 * Math.random());
      _fwd.set(r.position.x + Math.sin(ang) * rad, 0.15, r.position.z + Math.cos(ang) * rad);
      this.lightning.bolt(from, _fwd, { life: 0.12, width: 0.14, jag: 0.7, color: 0x9fe8ff });
    }
  }

  /* ================================================================== match end */

  private sortBoard(): void {
    this.board.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || (a.isPlayer ? -1 : b.isPlayer ? 1 : 0));
  }

  private endMatch(): void {
    if (this._over) return;
    this._over = true;
    this.timeLeft = Math.max(0, this.timeLeft);
    for (const r of this.rivals) {
      r.desSpeed = 0;
      r.dashT = 0;
    }
    this.sortBoard();
    const pe = this.player.entry;
    const placement = this.board.indexOf(pe) + 1;
    const bonus = Math.round((BRAWL_PLACEMENT_BONUS[placement - 1] ?? 0) * this.diff.coinMult);
    if (bonus > 0) {
      this.ctx.progression.addCoins(bonus);
      this.ctx.events.emit('coinCollected', { amount: bonus });
      this.coinsEarned += bonus;
    }
    this._result = {
      difficulty: this.diff.id,
      placement,
      total: this.board.length,
      kills: pe.kills,
      deaths: pe.deaths,
      bestStreak: pe.bestStreak,
      coinsEarned: this.coinsEarned,
      placementBonus: bonus,
      leaderboard: this.board.map((e) => ({ ...e })),
    };
  }
}
