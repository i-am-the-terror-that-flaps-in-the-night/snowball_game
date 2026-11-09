import * as THREE from 'three';
import { ARENA, ballVolume, type BrawlEntry, type BrawlHud, type BrawlResult, type EnemyHandle, type GameContext, type SoundName } from '../core/types';
import { BRAWL_DIFFICULTIES, BRAWL_KILL_TARGET, BRAWL_SPAWN_PROTECT, BRAWL_TIME, STREAK_TIERS, streakMult, type BrawlDifficultyDef } from '../config/brawl';
import { FX, UPGRADES, type UpgradeId } from '../config/upgrades';
import { BLADE_W } from './models';
import { PLOWS } from '../config/plows';
import { Lightning } from '../fx/Lightning';
import { VOLT_ELITE_BONUS, VOLT_RIVAL_CHANCE, attachVoltRig } from './voltRival';
import { BRUTE_ELITE_BONUS, BRUTE_RIVAL_CHANCE, attachBruteRig } from './bruteRival';
import { makeSurface } from '../world/Terrain';
import { LavaCache } from '../world/terrainMotion';
import { RIVAL_R, HEARING, _cam, clamp, type Personality, type Fighter, type RivalStats, type Cocoa, type Debris } from './shared';
import { Rival } from './rival';

const _surf = makeSurface();

/* Snowdome Brawl, base layer: match state, rival setup + stats scaling, spawn points, fighter helpers.
 * BrawlManager extends BrawlAI -> BrawlPhysics -> BrawlCombat -> BrawlVisuals -> BrawlBase. */

export abstract class BrawlBase {
  /** Lava patches of the current terrain (rival hazard avoidance). */
  protected lava = new LavaCache();
  protected ctx: GameContext;
  protected group = new THREE.Group();
  protected rivals: Rival[] = [];
  protected fighters: Fighter[] = [];
  protected player!: Fighter;
  protected diff: BrawlDifficultyDef = BRAWL_DIFFICULTIES[1];
  /** The player's endless-upgrade levels at match start; each rival rolls its own garage around them. */
  protected playerLevels: Partial<Record<UpgradeId, number>> = {};
  protected started = false;
  protected active = false;
  protected _over = false;
  protected _result: BrawlResult | null = null;
  protected timeLeft = BRAWL_TIME;
  protected time = 0;
  protected coinsEarned = 0;
  protected playerDown = false;
  protected playerRespawnT = 0;
  protected killedBy = '';
  protected spawnPoints: { x: number; z: number }[] = [];
  protected cocoas: Cocoa[] = [];
  protected cocoaT = 0;
  protected debris: Debris[] = [];
  /** Every rival's held snowball (one instanced draw); rebuilt by syncBalls. */
  protected balls: THREE.InstancedMesh | null = null;
  protected queryOut: EnemyHandle[] = [];
  protected hudObj: BrawlHud;
  protected board: BrawlEntry[] = [];
  /** Bolts for VOLT-9 rivals (coil arcs, clap crackle + blast). */
  protected lightning: Lightning;

  /** Match end (BrawlManager): a kill that reaches the target ends the match. */
  protected abstract endMatch(): void;

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

  /* ================================================================== setup */

  /** Snapshot of the player's garage (endless upgrades only; specials are player perks). */
  protected captureGear(): void {
    this.playerLevels = {};
    // Endless upgrades only, minus Pilot perks (player-only — rivals never copy those).
    const eff = this.ctx.progression.effectiveLevels();
    for (const u of UPGRADES) if (u.maxLevel === Infinity && !u.playerOnly) this.playerLevels[u.id] = eff[u.id] ?? 0;
  }

  /** A rival's own garage: every upgrade rolled around the player's level for this lobby, then turned into
   *  stats with the SAME FX curves the player uses — so bots scale like real players instead of copying
   *  (and compounding) the player's multipliers. */
  protected rivalStats(elite: boolean): { stats: RivalStats; hp: number } {
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
    const iceShield = prog.statLevel('iceShield') > 0 && Math.random() < perkP;
    const avalanche = prog.statLevel('avalancheCore') > 0 && Math.random() < perkP;
    // Some rivals roll the VOLT-9 or BRUTUS plow (more often in harder lobbies and among elites): their stat
    // multipliers only — the Volt / Brute upgrade lines are player-only; they get a fixed bot Thunderclap /
    // Ground Pound instead. One roll; if the two chances add past 90% they're scaled down to leave some Classics.
    let pv = VOLT_RIVAL_CHANCE[d.id] + (elite ? VOLT_ELITE_BONUS : 0);
    let pb = BRUTE_RIVAL_CHANCE[d.id] + (elite ? BRUTE_ELITE_BONUS : 0);
    if (pv + pb > 0.9) {
      const k = 0.9 / (pv + pb);
      pv *= k;
      pb *= k;
    }
    const roll = Math.random();
    const volt = roll < pv;
    const brute = !volt && roll < pv + pb;
    const pd = PLOWS[volt ? 'volt' : brute ? 'brute' : 'classic'];
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
      brute,
    };
    const hp = FX.maxHp(L('armor')) * (140 / 120) * d.hpMult * (elite ? 1.15 : 1) * pd.hpMult;
    return { stats, hp };
  }

  /** Number of streak tiers a fighter has reached (0..STREAK_TIERS.length). */
  protected tierOf(streak: number): number {
    let n = 0;
    for (const t of STREAK_TIERS) if (streak >= t.at) n++;
    return n;
  }

  /** Rival damage multiplier including the "on fire" streak buff. */
  protected dmgMult(r: Rival): number {
    return r.s.dmgMult * (1 + this.diff.streakBuff * this.tierOf(r.f.entry.streak));
  }

  /** Rival top speed including the streak buff. */
  protected topSpeed(r: Rival): number {
    return r.s.maxSpeed * (1 + this.diff.streakBuff * 0.6 * this.tierOf(r.f.entry.streak));
  }

  protected makeRival(name: string, color: string, kind: number, pers: Personality, hpMult = 1, elite = false): Rival {
    const rs = this.rivalStats(elite);
    const hp = Math.round(rs.hp * hpMult);
    const r = new Rival(kind, name, color, pers, hp, rs.stats.volt ? 'volt' : rs.stats.brute ? 'brute' : 'classic');
    r.s = rs.stats;
    if (r.s.volt) {
      r.volt = attachVoltRig(r.rig);
      r.tag.setBadge('⚡');
    } else if (r.s.brute) {
      r.brute = attachBruteRig(r.rig);
      r.tag.setBadge('🦏');
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

  protected placeRival(r: Rival, x: number, z: number, heading: number): void {
    r.position.set(x, 0, z);
    // Terrain: feet on the topmost surface (flat arenas: 0, as always).
    const terr = this.ctx.terrain;
    const v = r.vert;
    v.surfaceY = terr.active ? terr.surfaceAt(x, z, Infinity, _surf).y : 0;
    v.deck = terr.active ? _surf.deck : -1;
    v.y = v.surfaceY;
    v.vy = 0;
    v.airborne = false;
    v.airTime = 0;
    r.position.y = v.y;
    r.sink = 0;
    r.ice = 0;
    r.ivx = r.ivz = 0;
    r.tiltP = r.tiltR = 0;
    r.rig.root.rotation.order = 'YXZ';
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
    r.poundT = -1;
    r.stunT = 0;
    r.rig.body.position.y = 0;
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

  protected disposeRival(r: Rival): void {
    this.group.remove(r.rig.root);
    this.group.remove(r.tag.sprite);
    this.group.remove(r.bubble.sprite);
    r.rig.dispose();
    r.volt?.dispose();
    r.brute?.dispose();
    r.tag.dispose();
    r.bubble.dispose();
  }

  protected buildSpawnPoints(): void {
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
  protected freeSpot(x: number, z: number, margin: number): { x: number; z: number } {
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
  protected bestSpawn(): { x: number; z: number } {
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

  protected fx(f: Fighter): number {
    return f.rival ? f.rival.position.x : this.ctx.plow.position.x;
  }
  protected fz(f: Fighter): number {
    return f.rival ? f.rival.position.z : this.ctx.plow.position.z;
  }
  protected isAlive(f: Fighter): boolean {
    return f.rival ? f.rival.alive : !this.ctx.plow.dead;
  }
  protected isTargetable(f: Fighter): boolean {
    return f.rival ? f.rival.targetable : !this.ctx.plow.dead && !this.ctx.plow.invulnerable;
  }
  protected hpFrac(f: Fighter): number {
    if (f.rival) return f.rival.hp / f.rival.maxHp;
    const p = this.ctx.plow;
    return p.hp / Math.max(1, p.maxHp);
  }

  /** Volume 0..1 for a sound at (x, z), heard from the player. */
  protected hear(x: number, z: number): number {
    const p = this.ctx.plow.position;
    return clamp(1 - Math.hypot(x - p.x, z - p.z) / HEARING, 0, 1);
  }
  protected sfx(name: SoundName, x: number, z: number, vol = 1, pitch = 1): void {
    const v = this.hear(x, z) * vol;
    if (v > 0.06) this.ctx.audio.play(name, { volume: v, pitch });
  }
  protected near(x: number, z: number, d = 75): boolean {
    return Math.hypot(x - _cam.x, z - _cam.z) < d;
  }
}
