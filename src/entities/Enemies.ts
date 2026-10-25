import * as THREE from 'three';
import type { DamageOpts, EnemyHandle, EnemyManagerAPI, GameContext, SoundName } from '../core/types';
import { ARENA, ENEMY_GATES, GATE_WIDTH, PLOW_MASS } from '../core/types';
import { ENEMIES, type EnemyType } from '../config/enemies';
import { Bot, Vuln, type Host } from './enemies/Bot';
import { HpBars, createRig, debrisGeometry, debrisMaterials, disposeRig, rollWheels } from './enemies/models';
import { DecalPool } from './enemies/decals';
import { MINION_AI, aroundAngle, clamp, initAI, orbit, resetAI, wrap } from './enemies/ai';
import { BOSS_AI } from './enemies/bosses';
import type { KillSource } from '../core/events';

/* EnemyManager: owns every bot (minions + bosses) of Snowplow Showdown.
 *  - spawning through ENEMY_GATES (bots drive in through the gate opening, then stay clamped inside ARENA)
 *  - per-type AI (enemies/ai.ts minions, enemies/bosses.ts bosses) with an attack-token system so at most
 *    2 minions (1 while a boss is alive) are winding up / attacking at once — others circle and strafe
 *  - motion integration with finite turn rates, knockback, wall clamping (+ wall-hit detection for charges)
 *  - bot-bot separation by mass, plow contact (separation, player rams, bot attack windows)
 *  - damage resolution: armor, Brute front plate, Frostbyte ball block + CLASH, vulnerability multipliers,
 *    freeze, knockback / mass, hit flash, minion HP bars, death explosions with flying debris
 *  - telegraph ground decals (charge stripes, warning rings) */

const FLASH_T = 0.12;
const ICE = new THREE.Color(0x8fd0ff);
const MAX_DEBRIS = 180;
const ENRAGE_COLOR: Partial<Record<EnemyType, number>> = { slush: 0xff2020, sleet: 0x2080ff, omega: 0xff1030, bulldoza: 0xff6a00, grinder: 0xff6a00, frostbyte: 0x40e0ff };

const _c = new THREE.Color();
const _ec = new THREE.Color();
const _v = new THREE.Vector3();

interface Debris {
  /** Transform only (not in the scene): drawn as an instance of the batch for its geometry + material. */
  obj: THREE.Object3D;
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  life: number;
  sx: number;
  sy: number;
  sz: number;
  /** Trails smoke while airborne (every other chunk). */
  smoke: boolean;
  active: boolean;
}

export class EnemyManager implements EnemyManagerAPI, Host {
  readonly ctx: GameContext;
  private list: Bot[] = [];
  private aliveN = 0;
  private nextId = 1;
  private bossList: Bot[] = [];
  private decals: DecalPool;
  private debris: Debris[] = [];
  /** One pooled InstancedMesh per debris geometry + material, refilled from the active chunks (syncDebris). */
  private debrisBatches = new Map<string, THREE.InstancedMesh>();
  private bars: HpBars;
  /** Camera orientation the HP bars were last billboarded to. */
  private barQ = new THREE.Quaternion();
  private attackers = 0;
  private thieves = 0;
  private nextTokenT = 0;
  private lastSfx = new Map<string, number>();
  private plowAlive = true;
  private bossAlive = false;
  private depthFn = (x: number, z: number): number => (this.ctx.snow ? this.ctx.snow.getDepth(x, z) : 0);

  // Host per-frame cache
  px = 0;
  pz = 0;
  pr = 1.6;
  plowBall = 0;
  ux = 0;
  uz = 1;
  time = 0;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.decals = new DecalPool(ctx.scene);
    this.bars = new HpBars(ctx.scene);
  }

  /* ------------------------------------------------------------------ API */

  get bosses(): readonly EnemyHandle[] {
    return this.bossList;
  }

  aliveCount(): number {
    return this.aliveN;
  }

  spawn(type: EnemyType, x: number, z: number, opts?: { hpMult?: number; heading?: number }): EnemyHandle {
    const ctx = this.ctx;
    const def = ENEMIES[type];
    const rig = createRig(type);
    const e = new Bot(this.nextId++, type, opts?.hpMult ?? 1, rig);
    e.position.set(x, 0, z);

    let gi = -1;
    let best = 10 * 10;
    for (let i = 0; i < ENEMY_GATES.length; i++) {
      const g = ENEMY_GATES[i];
      const d2 = (g.x - x) ** 2 + (g.z - z) ** 2;
      if (d2 < best) {
        best = d2;
        gi = i;
      }
    }
    e.gate = gi;
    e.entering = gi >= 0 && !this.inside(e);
    e.heading = opts?.heading ?? (gi >= 0 ? ENEMY_GATES[gi].heading : Math.atan2(-x, -z));
    e.desHeading = e.heading;
    initAI(e);
    if (type === 'sleet') e.cd3 = 3;
    e.groundY = this.depthFn(x, z) * 0.6;
    e.position.y = e.groundY;
    rig.root.position.copy(e.position);
    rig.root.rotation.y = e.heading;
    ctx.scene.add(rig.root);
    this.list.push(e);
    this.aliveN++;
    if (gi >= 0) ctx.world?.openGate(gi);

    if (def.isBoss) {
      this.refreshBosses();
      ctx.events.emit('bossSpawned', { enemy: e, name: def.name, title: def.title });
      const fx = ctx.fx;
      if (fx) {
        const g = gi >= 0 ? ENEMY_GATES[gi] : null;
        _v.set(g ? g.x + Math.sin(g.heading) * 7 : x, 0.1, g ? g.z + Math.cos(g.heading) * 7 : z);
        fx.ring(_v, def.radius * 3, def.color);
        fx.ring(_v, def.radius * 1.8, 0xffffff);
        _v.y = 1;
        fx.burst(_v, { color: 0xffffff, count: 30, speed: 7, size: 0.3, gravity: 12, life: 1 });
        fx.shake(0.6);
      }
    }
    return e;
  }

  query(x: number, z: number, radius: number, out: EnemyHandle[] = []): EnemyHandle[] {
    out.length = 0;
    for (const e of this.list) {
      if (!e.alive) continue;
      const r = radius + e.radius;
      const dx = e.position.x - x;
      const dz = e.position.z - z;
      if (dx * dx + dz * dz < r * r) out.push(e);
    }
    return out;
  }

  damage(enemy: EnemyHandle, amount: number, opts?: DamageOpts): boolean {
    const e = enemy as Bot;
    if (!e.alive || !(e instanceof Bot)) return false;
    const ctx = this.ctx;
    const src = opts?.source ?? 'other';
    const fromX = opts?.fromX ?? ctx.plow?.position.x ?? e.position.x;
    const fromZ = opts?.fromZ ?? ctx.plow?.position.z ?? e.position.z;
    let dx = fromX - e.position.x;
    let dz = fromZ - e.position.z;
    const dl = Math.hypot(dx, dz);
    if (dl > 1e-3) {
      dx /= dl;
      dz /= dl;
    }
    const front = dl > 1e-3 && Math.sin(e.heading + e.spinVis) * dx + Math.cos(e.heading + e.spinVis) * dz > 0.5;
    let dmg = amount;
    let deflect = false;

    if (e.type === 'brute' && front) {
      dmg *= 0.3;
      deflect = true;
    } else if (e.type === 'frostbyte' && e.ballR >= 0.5) {
      if (src === 'slam') {
        this.clash(e, opts?.ballRadius ?? 0);
        if (e.stun <= 0) dmg *= 0.3;
      } else if (front) {
        dmg *= 0.5;
        deflect = true;
      }
    } else if (e.type === 'spinner' && e.state === 'spin' && src === 'ram') {
      dmg *= 0.3;
      deflect = true;
    }

    dmg = Math.max(1, dmg - e.def.armor);
    let vm = 1;
    if (e.stun > 0) vm = Math.max(vm, e.stunMult);
    if (e.vulnT > 0 && e.vuln !== Vuln.None) vm = Math.max(vm, e.vulnMult);
    dmg *= vm;

    if (opts?.freezeSeconds && opts.freezeSeconds > 0) e.freeze = Math.max(e.freeze, opts.freezeSeconds);
    // Applied after the damage multiplier so the stunning hit itself gets no stun bonus; bosses shrug off half.
    if (opts?.stunSeconds && opts.stunSeconds > 0) {
      if (e.stun <= 0) e.stunMult = 1;
      e.stun = Math.max(e.stun, opts.stunSeconds * (e.isBoss ? 0.5 : 1));
    }
    const k = opts?.knockback;
    if (k) {
      let kx = k.x / e.mass;
      let kz = k.z / e.mass;
      const kl = Math.hypot(kx, kz);
      if (kl > 22) {
        kx *= 22 / kl;
        kz *= 22 / kl;
      }
      e.kvx += kx;
      e.kvz += kz;
    }
    e.hp -= dmg;
    e.flash = FLASH_T;

    const fx = ctx.fx;
    if (deflect && fx) {
      const fwX = Math.sin(e.heading);
      const fwZ = Math.cos(e.heading);
      _v.set(e.position.x + fwX * e.radius, e.groundY + e.rig.height * 0.4, e.position.z + fwZ * e.radius);
      fx.burst(_v, { color: e.type === 'frostbyte' ? 0xbff4ff : 0xffd24a, count: 16, speed: 9, size: 0.09, gravity: 20, life: 0.35 });
      if (e.blockFxT <= 0) {
        e.blockFxT = 0.25;
        this.sfx('block', 0.7, 1, 0.06);
        _v.y += 1.2;
        fx.floatText(_v, e.type === 'spinner' ? 'SPINNING!' : 'DEFLECT', '#9fd8ff', 0.7);
      }
    } else if (vm > 1 && fx) {
      _v.set(e.position.x, e.groundY + e.rig.height * 0.7, e.position.z);
      fx.burst(_v, { color: 0xffe14a, count: 10, speed: 6, size: 0.12, gravity: 10, life: 0.5 });
    }

    // Big hits stagger minions (cancels their wind-up).
    if (!e.isBoss && e.hp > 0 && e.vuln === Vuln.None && amount >= (e.type === 'brute' ? 30 : 18) && !deflect) {
      e.stagger = 0.45;
      resetAI(this, e);
    }

    ctx.events.emit('enemyHit', { enemy: e, damage: dmg });
    if (e.hp <= 0) {
      e.hp = 0;
      this.kill(e, src);
      return true;
    }
    return false;
  }

  clear(): void {
    for (const e of this.list) if (e.alive) this.removeVisual(e);
    this.list.length = 0;
    this.aliveN = 0;
    this.bossList.length = 0;
    this.syncBars();
    this.decals.clear();
    for (const d of this.debris) d.active = false;
    this.syncDebris();
    this.attackers = 0;
    this.thieves = 0;
    this.nextTokenT = 0;
    this.lastSfx.clear();
  }

  update(dt: number): void {
    const ctx = this.ctx;
    const plow = ctx.plow;
    this.time += dt;
    this.px = plow.position.x;
    this.pz = plow.position.z;
    this.pr = plow.radius;
    this.plowBall = plow.heldBallRadius;
    this.plowAlive = !plow.dead;

    // recount tokens (robust against any missed release)
    let att = 0;
    let th = 0;
    this.bossAlive = false;
    for (const e of this.list) {
      if (!e.alive) continue;
      if (e.token) att++;
      if (e.thiefToken) th++;
      if (e.isBoss) this.bossAlive = true;
    }
    this.attackers = att;
    this.thieves = th;

    const n = this.list.length;
    for (let i = 0; i < n; i++) {
      const e = this.list[i];
      if (e.alive) this.step(e, dt);
    }
    this.separate();
    this.plowContact();
    this.barQ.copy(ctx.camera.quaternion);
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.alive) this.render(e, dt);
    }
    this.syncBars();
    this.updateDebris(dt);
    this.decals.update(dt, this.depthFn);

    // compact
    let j = 0;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (e.alive) this.list[j++] = e;
    }
    this.list.length = j;
  }

  /* ------------------------------------------------------------------ Host services */

  dist(e: Bot): number {
    const dx = this.px - e.position.x;
    const dz = this.pz - e.position.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 1e-4) {
      this.ux = dx / d;
      this.uz = dz / d;
    } else {
      this.ux = Math.sin(e.heading);
      this.uz = Math.cos(e.heading);
    }
    return d;
  }

  tryToken(e: Bot): boolean {
    if (e.token || e.isBoss) return true;
    const max = this.bossAlive ? 1 : 2;
    if (this.attackers >= max || this.time < this.nextTokenT) return false;
    e.token = true;
    this.attackers++;
    this.nextTokenT = this.time + 0.45;
    return true;
  }

  tryThiefToken(e: Bot): boolean {
    if (e.thiefToken) return true;
    if (this.thieves >= 1) return false;
    e.thiefToken = true;
    this.thieves++;
    return true;
  }

  releaseToken(e: Bot): void {
    if (e.token) {
      e.token = false;
      this.attackers = Math.max(0, this.attackers - 1);
    }
    if (e.thiefToken) {
      e.thiefToken = false;
      this.thieves = Math.max(0, this.thieves - 1);
    }
  }

  stripe(e: Bot, x: number, z: number, dx: number, dz: number, len: number, w: number, color: number, alpha: number): void {
    if (!e.dStripe) e.dStripe = this.decals.stripe();
    const d = e.dStripe;
    d.x = x;
    d.z = z;
    d.dx = dx;
    d.dz = dz;
    d.len = Math.max(0.5, len);
    d.w = w;
    d.mat.color.setHex(color);
    d.mat.opacity = clamp(alpha, 0, 1);
  }

  ring(e: Bot, x: number, z: number, r: number, fill: number, color: number, alpha: number): void {
    if (!e.dRing) e.dRing = this.decals.ring(false);
    if (!e.dFill) e.dFill = this.decals.ring(true);
    const o = e.dRing;
    o.x = x;
    o.z = z;
    o.r0 = Math.max(0, r - 0.4);
    o.r1 = r;
    o.mat.color.setHex(color);
    o.mat.opacity = clamp(alpha, 0, 1);
    const f = e.dFill;
    f.x = x;
    f.z = z;
    f.r0 = 0;
    f.r1 = Math.max(0.05, r * clamp(fill, 0, 1));
    f.mat.color.setHex(color);
    f.mat.opacity = clamp(alpha * 0.4, 0, 1);
  }

  clearTele(e: Bot): void {
    e.dStripe = this.decals.release(e.dStripe);
    e.dRing = this.decals.release(e.dRing);
    e.dFill = this.decals.release(e.dFill);
  }

  spawnAtGate(type: EnemyType, gi: number): void {
    const g = ENEMY_GATES[gi % ENEMY_GATES.length];
    const def = ENEMIES[type];
    const lat = (Math.random() - 0.5) * Math.max(0, GATE_WIDTH - 2 * def.radius - 0.6);
    const fx = Math.sin(g.heading);
    const fz = Math.cos(g.heading);
    const back = 1 + Math.random() * 2;
    this.spawn(type, g.x + fz * lat - fx * back, g.z - fx * lat - fz * back, { hpMult: this.ctx.zone.enemyHpMult, heading: g.heading });
  }

  bossPhase(e: Bot, label: string): void {
    const ctx = this.ctx;
    ctx.events.emit('bossPhase', { enemy: e, name: e.def.name, label });
    this.sfx('roar', 1, e.radius > 2.8 ? 0.75 : 1, 0.3);
    const fx = ctx.fx;
    fx.shake(0.8);
    _v.set(e.position.x, e.groundY + 0.1, e.position.z);
    fx.ring(_v, e.radius * 3.2, ENRAGE_COLOR[e.type] ?? 0xff3030);
    _v.y += e.rig.height * 0.6;
    fx.burst(_v, { color: ENRAGE_COLOR[e.type] ?? 0xff3030, count: 30, speed: 8, size: 0.16, gravity: 8, life: 0.8 });
    fx.floatText(_v.set(e.position.x, e.groundY + e.rig.height + 1.2, e.position.z), label, '#ff6a5a', 1.3);
  }

  findBoss(type: EnemyType): Bot | null {
    for (const e of this.list) if (e.alive && e.type === type) return e;
    return null;
  }

  hitPlow(e: Bot, dmg: number, opts?: { knockback?: number; unblockable?: boolean; fromX?: number; fromZ?: number }): number {
    if (!this.plowAlive) return 0;
    const combat = this.ctx.combat;
    if (!combat) return 0;
    return combat.hitPlow(dmg * (this.ctx.zone.enemyDmgMult ?? 1), opts?.fromX ?? e.position.x, opts?.fromZ ?? e.position.z, {
      knockback: opts?.knockback,
      unblockable: opts?.unblockable,
    });
  }

  sfx(name: SoundName, volume = 1, pitch = 1, gap = 0.05): void {
    const last = this.lastSfx.get(name);
    if (last !== undefined && this.time - last < gap && this.time >= last) return;
    this.lastSfx.set(name, this.time);
    this.ctx.audio?.play(name, { volume, pitch });
  }

  label(e: Bot, text: string, color: string, size = 1): void {
    _v.set(e.position.x, e.groundY + e.rig.height + 0.9, e.position.z);
    this.ctx.fx?.floatText(_v, text, color, size);
  }

  sparks(e: Bot, color: number, count: number): void {
    const r = e.radius;
    _v.set(
      e.position.x + (Math.random() - 0.5) * r * 1.4,
      e.groundY + e.rig.height * (0.35 + Math.random() * 0.5),
      e.position.z + (Math.random() - 0.5) * r * 1.4,
    );
    this.ctx.fx?.burst(_v, { color, count, speed: 5, size: 0.08, gravity: 18, life: 0.4 });
  }

  fxAt(x: number, y: number, z: number, color: number, count: number, speed: number, size: number, gravity: number, life: number): void {
    _v.set(x, y, z);
    this.ctx.fx?.burst(_v, { color, count, speed, size, gravity, life });
  }

  wallDist(x: number, z: number, dx: number, dz: number, max: number): number {
    let t = max;
    if (dx > 1e-4) t = Math.min(t, (ARENA.maxX - x) / dx);
    else if (dx < -1e-4) t = Math.min(t, (ARENA.minX - x) / dx);
    if (dz > 1e-4) t = Math.min(t, (ARENA.maxZ - z) / dz);
    else if (dz < -1e-4) t = Math.min(t, (ARENA.minZ - z) / dz);
    return Math.max(0.5, t);
  }

  /* ------------------------------------------------------------------ internals */

  private refreshBosses(): void {
    this.bossList.length = 0;
    for (const e of this.list) if (e.alive && e.isBoss) this.bossList.push(e);
  }

  private inside(e: Bot): boolean {
    const r = e.radius;
    const p = e.position;
    return p.x >= ARENA.minX + r && p.x <= ARENA.maxX - r && p.z >= ARENA.minZ + r && p.z <= ARENA.maxZ - r;
  }

  private step(e: Bot, dt: number): void {
    e.stateT -= dt;
    e.cd -= dt;
    e.cd2 -= dt;
    e.cd3 -= dt;
    e.retargetT -= dt;
    e.sparkT -= dt;
    e.flash -= dt;
    e.ramCd -= dt;
    e.atkHitCd -= dt;
    e.blockFxT -= dt;
    e.hitT -= dt;
    if (e.freeze > 0) e.freeze = Math.max(0, e.freeze - dt);
    if (e.stun > 0) e.stun = Math.max(0, e.stun - dt);
    if (e.stagger > 0) e.stagger -= dt;
    if (e.vulnT > 0) {
      e.vulnT -= dt;
      if (e.vulnT <= 0) {
        e.vuln = Vuln.None;
        e.vulnMult = 1;
      }
    }
    e.turnRate = e.baseTurn;
    e.accel = e.baseAccel;

    if (e.entering) {
      const g = ENEMY_GATES[e.gate];
      e.desHeading = g.heading;
      e.desSpeed = Math.max(4.5, e.def.speed);
      e.turnRate = 3;
    } else if (!this.plowAlive) {
      if (e.taunt === 0) resetAI(this, e);
      e.taunt += dt;
      orbit(this, e, 8.5 + (e.id % 3), e.def.speed * 0.4, dt);
    } else if (e.stun > 0 || e.stagger > 0) {
      e.desSpeed = 0;
      e.accel = 14;
      e.windup = 0;
      e.jitter = 0;
    } else {
      e.taunt = 0;
      const ai = e.isBoss ? BOSS_AI[e.type] : MINION_AI[e.type];
      ai?.(this, e, dt);
    }
    e.wallHit = false;

    // integrate
    const fm = e.freeze > 0 ? 0.5 : 1;
    const dh = wrap(e.desHeading - e.heading);
    const mt = e.turnRate * dt * fm;
    e.heading = wrap(e.heading + clamp(dh, -mt, mt));
    const target = e.desSpeed * fm;
    const a = e.accel * dt * (Math.abs(target) < Math.abs(e.speed) ? 1.5 : 1);
    e.speed += clamp(target - e.speed, -a, a);
    const s = Math.sin(e.heading);
    const c = Math.cos(e.heading);
    e.vx = s * e.speed + e.kvx;
    e.vz = c * e.speed + e.kvz;
    e.position.x += e.vx * dt;
    e.position.z += e.vz * dt;
    const kd = Math.exp(-3.5 * dt);
    e.kvx *= kd;
    e.kvz *= kd;
    this.clampPos(e, true);
  }

  private clampPos(e: Bot, detect: boolean): void {
    const p = e.position;
    if (e.entering) {
      const g = ENEMY_GATES[e.gate];
      const fx = Math.sin(g.heading);
      const fz = Math.cos(g.heading);
      const ox = p.x - g.x;
      const oz = p.z - g.z;
      const lat = ox * fz - oz * fx;
      const lim = Math.max(0, GATE_WIDTH / 2 - e.radius * 0.85);
      if (Math.abs(lat) > lim) {
        const k = clamp(lat, -lim, lim) - lat;
        p.x += fz * k;
        p.z -= fx * k;
      }
      const along = ox * fx + oz * fz;
      if (along < -8) {
        p.x -= fx * (along + 8);
        p.z -= fz * (along + 8);
      }
      if (this.inside(e)) {
        e.entering = false;
        e.orbitA = aroundAngle(this, e);
      }
      return;
    }
    const r = e.radius;
    const minX = ARENA.minX + r;
    const maxX = ARENA.maxX - r;
    const minZ = ARENA.minZ + r;
    const maxZ = ARENA.maxZ - r;
    const th = 4;
    if (p.x < minX) {
      p.x = minX;
      if (detect && e.vx < -th) this.flagWall(e, 1, 0);
      if (e.kvx < 0) e.kvx = -e.kvx * 0.3;
    } else if (p.x > maxX) {
      p.x = maxX;
      if (detect && e.vx > th) this.flagWall(e, -1, 0);
      if (e.kvx > 0) e.kvx = -e.kvx * 0.3;
    }
    if (p.z < minZ) {
      p.z = minZ;
      if (detect && e.vz < -th) this.flagWall(e, 0, 1);
      if (e.kvz < 0) e.kvz = -e.kvz * 0.3;
    } else if (p.z > maxZ) {
      p.z = maxZ;
      if (detect && e.vz > th) this.flagWall(e, 0, -1);
      if (e.kvz > 0) e.kvz = -e.kvz * 0.3;
    }
  }

  private flagWall(e: Bot, nx: number, nz: number): void {
    e.wallHit = true;
    e.wallNx = nx;
    e.wallNz = nz;
  }

  private separate(): void {
    const L = this.list;
    const n = L.length;
    for (let i = 0; i < n; i++) {
      const a = L[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < n; j++) {
        const b = L[j];
        if (!b.alive) continue;
        let dx = b.position.x - a.position.x;
        let dz = b.position.z - a.position.z;
        const rr = a.radius + b.radius;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) continue;
        let d = Math.sqrt(d2);
        if (d < 1e-4) {
          dx = Math.random() - 0.5;
          dz = Math.random() - 0.5;
          d = Math.hypot(dx, dz);
        }
        const nx = dx / d;
        const nz = dz / d;
        const pen = rr - Math.min(d, rr);
        const wa = b.mass / (a.mass + b.mass);
        const wb = 1 - wa;
        a.position.x -= nx * pen * wa;
        a.position.z -= nz * pen * wa;
        b.position.x += nx * pen * wb;
        b.position.z += nz * pen * wb;
        // charging heavies bowl minions aside
        if (a.atk && a.speed > 8 && !b.isBoss && b.hitT <= 0) {
          b.hitT = 0.3;
          b.kvx += (nx * 10) / b.mass;
          b.kvz += (nz * 10) / b.mass;
        }
        if (b.atk && b.speed > 8 && !a.isBoss && a.hitT <= 0) {
          a.hitT = 0.3;
          a.kvx -= (nx * 10) / a.mass;
          a.kvz -= (nz * 10) / a.mass;
        }
      }
    }
    for (let i = 0; i < n; i++) if (L[i].alive) this.clampPos(L[i], false);
  }

  private plowContact(): void {
    const ctx = this.ctx;
    const plow = ctx.plow;
    const pfx = Math.sin(plow.heading);
    const pfz = Math.cos(plow.heading);
    const pr = plow.radius;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i];
      if (!e.alive) continue;
      let dx = e.position.x - plow.position.x;
      let dz = e.position.z - plow.position.z;
      const rr = e.radius + pr;
      const d2 = dx * dx + dz * dz;

      // bot attack window: contact (with a little reach) deals damage
      if (e.atk && this.plowAlive && e.atkHitCd <= 0 && d2 < (rr + 0.35) * (rr + 0.35)) {
        e.atkHits++;
        e.atkHitCd = e.atkRepeat > 0 ? e.atkRepeat : 99;
        this.hitPlow(e, e.atkDmg, { knockback: e.atkKnock, unblockable: e.atkUnblock });
        if (e.atkSteal > 0 && plow.heldBallRadius > 0) {
          const vol = plow.stealSnow(e.atkSteal);
          if (vol > 0) {
            if (e.type === 'thief') {
              e.carry += vol;
              e.stole = true;
            } else e.ballVol += vol;
            this.sfx('steal', 0.9, 1, 0.1);
            this.label(e, 'SNOW STOLEN!', '#7fe8ff', 0.9);
            _v.set(plow.position.x + pfx * 2.2, 1.2, plow.position.z + pfz * 2.2);
            ctx.fx.burst(_v, { color: 0xffffff, count: 18, speed: 5, size: 0.22, gravity: 10, life: 0.7 });
          }
        }
        if (!e.alive) continue;
      }

      if (d2 >= rr * rr) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-3) {
        dx = pfx;
        dz = pfz;
        d = 1;
      }
      const nx = dx / d;
      const nz = dz / d;
      const pen = rr - Math.min(d, rr);
      const we = PLOW_MASS / (PLOW_MASS + e.mass);
      const wp = 1 - we;
      e.position.x += nx * pen * we;
      e.position.z += nz * pen * we;
      plow.position.x -= nx * pen * wp;
      plow.position.z -= nz * pen * wp;
      this.px = plow.position.x;
      this.pz = plow.position.z;

      // player ram: the plow's front faces the bot and it's moving
      if (this.plowAlive && e.ramCd <= 0 && plow.speed > 3) {
        const dot = pfx * nx + pfz * nz;
        if (dot > 0.55) {
          const closing = plow.speed * dot - (e.vx * nx + e.vz * nz);
          if (closing > 1.5) {
            e.ramCd = 0.4;
            ctx.combat.playerRam(e, closing);
            if (!plow.dashing) plow.speed *= clamp(1 - e.mass / (e.mass + PLOW_MASS), 0.15, 0.75);
          }
        }
      }
      if (e.alive) this.clampPos(e, false);
    }
  }

  /** Frostbyte's ball meets the player's slammed ball: both shatter. */
  private clash(e: Bot, playerR: number): void {
    const ctx = this.ctx;
    const R = e.ballR;
    const fwX = Math.sin(e.heading);
    const fwZ = Math.cos(e.heading);
    const bx = e.position.x + fwX * (e.rig.front + R * 0.9);
    const bz = e.position.z + fwZ * (e.rig.front + R * 0.9);
    _v.set(bx, e.groundY + R, bz);
    ctx.fx.burst(_v, { color: 0xffffff, count: 50, speed: 10, size: 0.35, gravity: 12, life: 1.1 });
    ctx.fx.burst(_v, { color: 0x9feaff, count: 24, speed: 8, size: 0.18, gravity: 8, life: 0.8 });
    _v.y = e.groundY + 0.1;
    ctx.fx.ring(_v, R * 3 + 2, 0xbff4ff);
    ctx.fx.shake(0.7);
    this.sfx('clash', 1, 1, 0.1);
    ctx.snow?.addSnow(bx, bz, R * 1.6, e.ballVol * 0.5);
    if (playerR > R) {
      e.stun = 1.5;
      e.stunMult = 1.5;
      resetAI(this, e);
      this.label(e, 'CLASH! STUNNED', '#ffe14a', 1.2);
      this.sfx('stun', 0.9, 1, 0.1);
    } else {
      const diff = 18 * (R * R - playerR * playerR) + 6;
      this.hitPlow(e, diff, { knockback: 12 });
      this.label(e, 'CLASH!', '#ff8a7a', 1.2);
    }
    e.ballVol = 0;
    e.ballR = 0;
  }

  private kill(e: Bot, source: KillSource = 'other'): void {
    const ctx = this.ctx;
    const def = e.def;
    e.alive = false;
    this.aliveN = Math.max(0, this.aliveN - 1);
    this.releaseToken(e);
    this.removeVisual(e);
    if (e.isBoss) this.refreshBosses();

    const fx = ctx.fx;
    const p = e.position;
    const h = e.rig.height;
    this.spawnDebris(e);
    _v.set(p.x, e.groundY + h * 0.5, p.z);
    const big = e.isBoss ? 2.2 : 1;
    fx.burst(_v, { color: def.color, count: Math.round(18 * big + e.radius * 6), speed: 8 * Math.sqrt(big), size: 0.16 * big, gravity: 18, life: 0.9 });
    fx.burst(_v, { color: 0xffffff, count: Math.round(22 * big), speed: 6 * Math.sqrt(big), size: 0.3 * big, gravity: 12, life: 1.0 });
    fx.burst(_v, { color: 0xffa23a, count: Math.round(14 * big), speed: 10 * Math.sqrt(big), size: 0.1, gravity: 16, life: 0.45 });
    fx.burst(_v, { color: 0x3a3a40, count: Math.round(8 * big), speed: 3, size: 0.4 * big, gravity: -3, life: 1.2 });
    fx.fireball(_v, (0.6 + e.radius * 0.4) * big);
    _v.y = e.groundY + 0.1;
    fx.ring(_v, e.radius * 2.5, 0xffd27a);
    fx.scorch(_v, (1.2 + e.radius * 1.1) * big);
    fx.smolder(_v, { scale: (0.6 + e.radius * 0.35) * big, seconds: e.isBoss ? 3 : 2.5 });
    if (e.isBoss) {
      fx.ring(_v, e.radius * 4.5, def.color);
      _v.y = e.groundY + h * 0.8;
      fx.burst(_v, { color: def.accent, count: 50, speed: 14, size: 0.2, gravity: 14, life: 1.3 });
      fx.burst(_v, { color: 0xffe14a, count: 40, speed: 9, size: 0.14, gravity: 6, life: 1.4 });
      fx.shake(1.4);
      this.sfx('explosion', 1, 0.8, 0);
      this.sfx('bossDefeated', 1, 1, 0);
    } else {
      fx.shake(clamp(0.12 + e.radius * 0.12, 0.15, 0.45));
      this.sfx('kill', 0.9, 1.15 - e.radius * 0.15, 0.03);
    }

    // drop carried snow
    const snow = ctx.snow;
    if (snow) {
      if (e.carry > 0.01) snow.addSnow(p.x, p.z, 2.5, e.carry);
      if (e.ballVol > 0.01) snow.addSnow(p.x, p.z, Math.max(1.5, e.ballR * 1.6), e.ballVol * 0.7);
    }

    const coins = Math.round(def.coins * ctx.zone.coinMult);
    ctx.events.emit('enemyKilled', { enemy: e, coins, source });
    if (e.isBoss) ctx.events.emit('bossDefeated', { enemy: e, name: def.name });
    ctx.pickups?.spawnCoins(p.clone(), coins);
  }

  private removeVisual(e: Bot): void {
    e.endAtk();
    this.clearTele(e);
    const scene = this.ctx.scene;
    scene.remove(e.rig.root);
    disposeRig(e.rig);
    if (e.rig.barShow) {
      e.rig.barShow = false;
      this.syncBars();
    }
  }

  /** Rebuild the HP bar batch from every live minion's last bar state. */
  private syncBars(): void {
    const bars = this.bars;
    bars.begin();
    for (const e of this.list) if (e.alive && e.rig.barShow) bars.add(e.rig.barPos, this.barQ, e.rig.barFill);
    bars.end();
  }

  /* ------------------------------------------------------------------ rendering */

  private render(e: Bot, dt: number): void {
    const rig = e.rig;
    const t = this.time;
    const p = e.position;
    const gy = this.depthFn(p.x, p.z) * 0.6;
    e.groundY += (gy - e.groundY) * Math.min(1, dt * 8);
    p.y = e.groundY;

    // visual spin (spinner / grinder / sleet swipe); merge back into heading when it stops
    if (e.spinRate > 0.4) e.spinVis = wrap(e.spinVis + e.spinRate * dt);
    else if (e.spinVis !== 0) {
      e.heading = wrap(e.heading + e.spinVis);
      e.desHeading = e.heading;
      e.spinVis = 0;
    }
    e.spinRate *= Math.exp(-3 * dt);

    rig.root.position.set(p.x, e.groundY, p.z);
    rig.root.rotation.y = e.heading + e.spinVis;

    const body = rig.body;
    let by = Math.sin(t * 9 + e.bob) * 0.025 * (1 + Math.min(1, Math.abs(e.speed) * 0.1));
    if (e.type === 'thief') by += 0.45 + Math.sin(t * 3 + e.bob) * 0.08 + Math.min(0.3, e.carry * 0.04);
    if (!this.plowAlive && !e.entering) by += Math.abs(Math.sin(t * 7 + e.bob)) * (e.isBoss ? 0.35 : 0.28);
    if (e.jitter > 0) {
      body.position.x = Math.sin(t * 71 + e.bob) * e.jitter * e.radius;
      by += Math.sin(t * 53) * e.jitter * 0.5;
    } else body.position.x = 0;
    body.position.y = by;
    body.rotation.x = -e.windup * 0.06 + clamp(e.speed * 0.004, -0.04, 0.06) * (e.type === 'thief' ? 4 : 1);
    if (rig.lift) rig.lift.rotation.x = -e.rear * 0.42;

    const roll = e.speed * dt;
    rollWheels(rig, roll);
    for (const o of rig.spinY) o.rotation.y += e.sawRate * dt * ((o.userData.dir as number) ?? 1);
    for (const o of rig.spinZ) o.rotation.z += e.augerRate * dt;

    // eyes: flash rapidly during wind-ups, blink while taunting
    if (rig.eye) {
      let k = 1 + Math.sin(t * 2.5 + e.bob) * 0.12;
      if (e.windup > 0) k = 1 + (Math.sin(t * 38) > 0 ? 1.6 : 0.3) * (0.4 + e.windup);
      if (e.disabled) k = 0.35 + 0.3 * (Math.sin(t * 9) > 0 ? 1 : 0);
      if (!this.plowAlive) k = Math.sin(t * 5 + e.bob) > 0.2 ? 1.6 : 0.2;
      if (e.type === 'thief' && e.carry > 0.05) k *= 1.4;
      rig.eye.emissiveIntensity = rig.eyeBase * k;
    }
    if (rig.glow) {
      let gi = rig.glowBase + Math.max(e.glow, e.windup) * 3.2;
      if (e.type === 'omega') {
        gi = 1.2 + Math.sin(t * (e.enraged ? 11 : 3)) * (e.enraged ? 0.9 : 0.35) + e.windup * 2;
        if (e.vuln === Vuln.Exposed) gi = 5 + Math.sin(t * 24) * 2;
      } else if (e.vuln === Vuln.Overheat) gi = 3 + Math.sin(t * 16);
      rig.glow.emissiveIntensity = gi;
    }

    // paint: hit flash, overheated/exposed red glow, enrage glow, dizzy flicker, freeze tint
    const fl = e.flash > 0 ? e.flash / FLASH_T : 0;
    _c.setRGB(fl * 0.9, fl * 0.9, fl * 0.9);
    if (e.vuln === Vuln.Overheat) _c.r += 0.6 + 0.25 * Math.sin(t * 14);
    if (e.vuln === Vuln.Exposed) _c.r += 0.3 + 0.15 * Math.sin(t * 20);
    if (e.enraged) {
      _ec.setHex(ENRAGE_COLOR[e.type] ?? 0xff2020).multiplyScalar(0.16 + 0.1 * Math.sin(t * 8));
      _c.add(_ec);
    }
    if ((e.stun > 0 || e.vuln === Vuln.Dizzy) && Math.sin(t * 12) > 0) {
      _c.r += 0.12;
      _c.g += 0.1;
    }
    if (e.windup > 0.5 && !e.isBoss) _c.r += (e.windup - 0.5) * 0.4;
    const frozen = e.freeze > 0;
    if (frozen) _c.b += 0.25;
    for (let i = 0; i < rig.paint.length; i++) {
      const m = rig.paint[i];
      m.emissive.copy(_c);
      if (frozen) m.color.copy(rig.paintBase[i]).lerp(ICE, 0.55);
      else m.color.copy(rig.paintBase[i]);
    }
    rig.crust.visible = frozen;

    const dizzy = e.stun > 0 || e.vuln === Vuln.Dizzy;
    rig.stars.visible = dizzy;
    if (dizzy) {
      rig.stars.rotation.y += dt * 5;
      rig.stars.position.y = rig.height + 0.35 + Math.sin(t * 6) * 0.08;
    }

    // Frostbyte's ball rides in front of its blade
    if (rig.ball) {
      const R = e.ballR;
      rig.ball.visible = R > 0.15;
      if (rig.ball.visible) {
        rig.ball.position.set(0, R * 0.95, rig.front + R * 0.9);
        rig.ball.scale.setScalar(R);
        e.ballRoll += (e.speed * dt) / Math.max(0.3, R);
        rig.ball.rotation.x = e.ballRoll;
      }
      if (rig.ballMat) rig.ballMat.emissiveIntensity = 0.05 + (e.state === 'slamWind' ? e.windup * 1.8 * (0.7 + 0.3 * Math.sin(t * 30)) : 0);
    } else if (rig.tank) {
      const loaded = e.carry > 0.05;
      rig.tank.scale.setScalar(loaded ? Math.min(0.33, 0.1 + Math.cbrt(e.carry) * 0.11) : 0.05);
      if (rig.ballMat) rig.ballMat.emissiveIntensity = loaded ? 0.6 + 0.4 * Math.sin(t * 6) : 0.1;
    }

    // minion HP bar
    if (rig.bar) {
      rig.barShow = e.hp < e.maxHp;
      if (rig.barShow) {
        rig.barPos.set(p.x, e.groundY + rig.height + (e.type === 'thief' ? 0.95 : 0.5), p.z);
        rig.barFill = e.hp / e.maxHp;
      }
    }

    // exhaust puffs (thicker + darker while revving), steam when overheated / dizzy
    const fx = this.ctx.fx;
    e.puffT -= dt * (1 + e.windup * 5 + Math.abs(e.speed) * 0.08);
    if (e.puffT <= 0 && fx) {
      e.puffT = e.isBoss ? 0.32 : 0.55;
      const st = rig.stacks;
      const ch = Math.cos(e.heading);
      const sh = Math.sin(e.heading);
      const rev = e.windup > 0.25;
      for (let i = 0; i < st.length; i += 3) {
        const lx = st[i];
        const lz = st[i + 2];
        _v.set(p.x + lx * ch + lz * sh, e.groundY + st[i + 1], p.z - lx * sh + lz * ch);
        fx.burst(_v, { color: rev ? 0x2a2a30 : 0x70747c, count: rev ? 3 : 1, speed: rev ? 2 : 1, size: (e.isBoss ? 0.45 : 0.2) * (rev ? 1.4 : 1), gravity: -2.5, life: 0.9 });
      }
      if (e.vuln === Vuln.Overheat || e.vuln === Vuln.Exposed) {
        _v.set(p.x, e.groundY + rig.height * 0.9, p.z);
        fx.burst(_v, { color: 0xdfe6ee, count: 3, speed: 1.5, size: 0.3, gravity: -3, life: 0.8 });
      }
    }
    if (dizzy && e.sparkT <= 0) {
      e.sparkT = 0.2;
      this.sparks(e, 0xffd24a, 3);
    }
  }

  /* ------------------------------------------------------------------ debris */

  private spawnDebris(e: Bot): void {
    const mats = debrisMaterials(e.type);
    const n = e.isBoss ? 24 : 6 + Math.round(e.radius * 3);
    const p = e.position;
    const h = e.rig.height;
    const pow = e.isBoss ? 1.6 : 1;
    for (let i = 0; i < n; i++) {
      const d = this.acquireDebris();
      if (!d) break;
      d.geo = debrisGeometry(i);
      d.mat = mats[i % mats.length];
      const s = e.radius * (0.16 + Math.random() * 0.22);
      d.sx = s * (0.6 + Math.random());
      d.sy = s * (0.4 + Math.random() * 0.6);
      d.sz = s * (0.6 + Math.random());
      d.obj.scale.set(d.sx, d.sy, d.sz);
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * e.radius * 0.8;
      d.obj.position.set(p.x + Math.sin(a) * rr, e.groundY + 0.3 + Math.random() * h * 0.7, p.z + Math.cos(a) * rr);
      const sp = (3 + Math.random() * 6) * pow;
      d.vx = Math.sin(a) * sp + e.vx * 0.3;
      d.vz = Math.cos(a) * sp + e.vz * 0.3;
      d.vy = (5 + Math.random() * 7) * pow;
      d.rx = (Math.random() - 0.5) * 14;
      d.ry = (Math.random() - 0.5) * 14;
      d.rz = (Math.random() - 0.5) * 14;
      d.life = 1.6 + Math.random() * 1.4;
      d.smoke = (i & 1) === 0;
      d.active = true;
    }
    this.syncDebris();
  }

  private acquireDebris(): Debris | null {
    for (const d of this.debris) if (!d.active) return d;
    if (this.debris.length >= MAX_DEBRIS) return null;
    const d: Debris = { obj: new THREE.Object3D(), geo: debrisGeometry(0), mat: debrisMaterials('scrapper')[0], vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, life: 0, sx: 1, sy: 1, sz: 1, smoke: false, active: false };
    this.debris.push(d);
    return d;
  }

  private updateDebris(dt: number): void {
    for (const d of this.debris) {
      if (!d.active) continue;
      const m = d.obj;
      d.life -= dt;
      if (d.life <= 0) {
        d.active = false;
        continue;
      }
      d.vy -= 22 * dt;
      m.position.x += d.vx * dt;
      m.position.y += d.vy * dt;
      m.position.z += d.vz * dt;
      const g = this.depthFn(m.position.x, m.position.z) * 0.8 + d.sy * 0.5;
      if (m.position.y < g) {
        m.position.y = g;
        if (d.vy < 0) d.vy *= -0.32;
        d.vx *= 0.55;
        d.vz *= 0.55;
        d.rx *= 0.6;
        d.ry *= 0.6;
        d.rz *= 0.6;
      }
      m.rotation.x += d.rx * dt;
      m.rotation.y += d.ry * dt;
      m.rotation.z += d.rz * dt;
      // Burning chunks trail smoke while they fly.
      if (d.smoke && d.life > 0.9 && Math.random() < dt * 9) {
        this.ctx.fx.smoke(m.position, { count: 1, color: 0x2a2a2e, size: 0.22 + d.sx * 0.3, grow: 3, life: 0.9, speed: 0.3, up: 0.4, rise: 0.8, drag: 1.5, spread: 0, opacity: 0.55 });
      }
      if (d.life < 0.5) {
        const k = d.life / 0.5;
        m.scale.set(d.sx * k, d.sy * k, d.sz * k);
      }
    }
    this.syncDebris();
  }

  /** Write every active chunk's transform into its batch; empty batches are hidden, the rest get a fresh bounding
   *  sphere so both passes still frustum-cull them. */
  private syncDebris(): void {
    for (const b of this.debrisBatches.values()) b.count = 0;
    for (const d of this.debris) {
      if (!d.active) continue;
      const key = d.geo.uuid + d.mat.uuid;
      let b = this.debrisBatches.get(key);
      if (!b) {
        b = new THREE.InstancedMesh(d.geo, d.mat, MAX_DEBRIS);
        b.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        b.castShadow = true;
        b.count = 0;
        this.ctx.scene.add(b);
        this.debrisBatches.set(key, b);
      }
      d.obj.updateMatrix();
      b.setMatrixAt(b.count++, d.obj.matrix);
    }
    for (const b of this.debrisBatches.values()) {
      b.visible = b.count > 0;
      if (!b.visible) continue;
      b.instanceMatrix.needsUpdate = true;
      b.computeBoundingSphere();
    }
  }
}
