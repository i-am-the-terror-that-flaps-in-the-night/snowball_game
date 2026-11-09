import { ARENA, type BrawlAPI, type BrawlDifficulty, type BrawlEntry, type BrawlHud, type BrawlResult, type DamageOpts, type EnemyHandle, type EnemyType } from '../core/types';
import { BRAWL_BOTS, BRAWL_BOT_NAMES, BRAWL_CLAN_TAGS, BRAWL_COLORS, BRAWL_DIFFICULTIES, BRAWL_KILL_TARGET, BRAWL_PERSONALITIES, BRAWL_PLACEMENT_BONUS, BRAWL_TIME, PLAYER_BRAWL_COLOR, streakMult } from '../config/brawl';
import { RIVAL_KINDS } from './models';
import { launchVert } from '../world/terrainMotion';
import { _cam, EMPTY, pick, shuffle, type Method } from './shared';
import { Rival } from './rival';
import { BrawlAI } from './BrawlAI';

/* Snowdome Brawl: the player + BRAWL_BOTS rival AI plows in a huge arena, everyone hunting everyone.
 * Rivals carry the player's kit (plow a ball, slam, ram, dash strike, whirlwind). Implements
 * EnemyManagerAPI, so every external damage() call is the PLAYER attacking. */

/** Board order: most kills, then fewest deaths, then the player first (hoisted: sorted every frame). */
const byStanding = (a: BrawlEntry, b: BrawlEntry): number => b.kills - a.kills || a.deaths - b.deaths || (a.isPlayer ? -1 : b.isPlayer ? 1 : 0);

export class BrawlManager extends BrawlAI implements BrawlAPI {
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

  launch(enemy: EnemyHandle, vy: number): void {
    const r = enemy as Rival;
    if (!(r instanceof Rival) || !r.alive) return;
    launchVert(r.vert, vy);
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
    // F abilities come through as 'other': a stun is the Ground Pound, anything else on VOLT-9 is lightning.
    const method: Method =
      src === 'ram' ? (this.ctx.plow.dashing ? 'dash' : 'ram')
      : src === 'slam' ? 'slam'
      : src === 'whirl' ? 'whirl'
      : opts?.stunSeconds ? 'pound'
      : this.ctx.stats.plowKind === 'volt' ? 'zap'
      : 'other';
    if (opts?.freezeSeconds) r.frozenT = Math.max(r.frozenT, opts.freezeSeconds);
    if (opts?.stunSeconds) this.stunRival(r, opts.stunSeconds);
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
    for (const d of this.debris) this.disposeDebris(d);
    this.debris.length = 0;
    if (this.balls) {
      this.balls.count = 0;
      this.balls.visible = false;
    }
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

  tickClock(seconds: number): void {
    if (this.started && this.active && !this._over && seconds > 0) {
      this.timeLeft -= seconds;
      if (this.timeLeft <= 0) this.endMatch();
    }
  }

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
    this.syncBalls();
    this.lightning.update(dt);
  }

  /* ================================================================== match end */

  private sortBoard(): void {
    this.board.sort(byStanding);
  }

  protected endMatch(): void {
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
