import * as THREE from 'three';
import { ARENA, type GameContext, type Obstacle } from '../../core/types';
import type { Bot, Host } from './Bot';
import { DecalPool, type Decal } from './decals';

/* THE DONALD's arena props, owned by the EnemyManager (update / clear) and driven by the boss AI (bosses.ts):
 *  - BUILD THE WALL: lines of snow-brick wall segments. Each line is telegraphed by a gold ground stripe, then
 *    rises and becomes a chain of circle colliders pushed into ctx.world.obstacles (the plow and the bots collide
 *    with those). Slams (the 'slam' event) and dash strikes smash a gap; walls crumble on their own after ~9s.
 *  - DEPORTATION: a tractor-beam column + filling ground ring. When it fires, the plow (if inside) and any minion
 *    caught in it are flung on an arc to the far edge of the arena; the plow loses its held ball.
 *  - The RALLY podium: a breakable lectern that rises in front of the boss (breaking it ends the rally).
 *  - GOLD PLATED reflection: damage queued in Bot.reflectPool is sent back at the plow in small batches.
 * Everything is a handful of draws: one InstancedMesh for wall blocks, one for their gold caps, a beam column and
 * the podium group. */

const SEG = 1.3;
const SEG_R = 0.85;
const WALL_H = 2.5;
const MAX_SEGS = 240;
const RISE_T = 0.35;
const BEAM_COLOR = 0x7fe3ff;
const WALL_STRIPE = 0xffb21a;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

export interface WallLine {
  /** Start point and unit direction along the wall; `len` in metres. */
  x: number;
  z: number;
  dx: number;
  dz: number;
  len: number;
}

interface Wall {
  line: WallLine;
  segs: Seg[];
  tele: number;
  teleDur: number;
  life: number;
  risen: boolean;
  decal: Decal | null;
}

interface Seg {
  x: number;
  z: number;
  ry: number;
  tilt: number;
  o: Obstacle;
  /** 0..1 risen height. */
  k: number;
  /** Rising (tele done) / crumbling timer (>= 0 while crumbling). */
  up: boolean;
  die: number;
  /** Seconds before a queued crumble starts. */
  delay: number;
  dead: boolean;
  skip: boolean;
}

interface Flight {
  bot: Bot | null;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  t: number;
  dur: number;
}

interface Beam {
  x: number;
  z: number;
  r: number;
  t: number;
  dur: number;
  fired: boolean;
  /** Post-fire flash timer. */
  flash: number;
}

let _brickTex: THREE.Texture | null = null;
/** Snow bricks: off-white blocks with pale blue mortar, three staggered courses per tile. */
function brickTexture(): THREE.Texture {
  if (_brickTex) return _brickTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 192;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9fb6cc';
  g.fillRect(0, 0, 128, 192);
  const rows = 3;
  const bh = 192 / rows;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 ? -32 : 0;
    for (let i = -1; i < 3; i++) {
      const x = off + i * 64 + 4;
      const y = r * bh + 4;
      const shade = 236 + ((r * 7 + i * 13) % 5) * 4;
      g.fillStyle = `rgb(${shade},${shade + 2},${Math.min(255, shade + 10)})`;
      g.fillRect(x, y, 56, bh - 8);
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fillRect(x, y, 56, 6);
      g.fillStyle = 'rgba(120,150,190,0.25)';
      g.fillRect(x, y + bh - 16, 56, 8);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  _brickTex = t;
  return t;
}

class DonaldProps {
  private ctx: GameContext | null = null;
  private decals: DecalPool | null = null;
  private blocks: THREE.InstancedMesh | null = null;
  private caps: THREE.InstancedMesh | null = null;
  private walls: Wall[] = [];
  private segs: Seg[] = [];
  /** Obstacles we inserted into ctx.world.obstacles (removed by identity every sync). */
  private mine = new Set<Obstacle>();
  private flights: Flight[] = [];
  private beam: Beam | null = null;
  private beamRing: Decal | null = null;
  private beamFill: Decal | null = null;
  private column: THREE.Mesh | null = null;
  private columnMat: THREE.MeshBasicMaterial | null = null;
  private podium: THREE.Group | null = null;
  private podiumO: Obstacle = { x: 0, z: 0, r: 1.25 };
  private podiumK = 0;
  private podiumUp = false;
  private slamQ: { x: number; z: number; r: number }[] = [];
  private wasDashing = false;
  private reflectT = 0;
  private time = 0;
  /** Set when the player smashes the rally podium; the boss AI consumes it. */
  podiumBroken = false;

  private depth = (x: number, z: number): number => (this.ctx?.snow ? this.ctx.snow.getDepth(x, z) : 0);

  private init(ctx: GameContext): void {
    if (this.ctx === ctx) return;
    this.ctx = ctx;
    const scene = ctx.scene;
    this.decals = new DecalPool(scene);
    const blockGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const blockMat = new THREE.MeshStandardMaterial({ map: brickTexture(), roughness: 0.85, color: 0xffffff });
    this.blocks = new THREE.InstancedMesh(blockGeo, blockMat, MAX_SEGS);
    const capMat = new THREE.MeshStandardMaterial({ color: 0xf2c033, roughness: 0.3, metalness: 0.45, emissive: 0x3a2400, emissiveIntensity: 0.4 });
    this.caps = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), capMat, MAX_SEGS);
    for (const im of [this.blocks, this.caps]) {
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = 0;
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.visible = false;
      scene.add(im);
    }
    this.columnMat = new THREE.MeshBasicMaterial({
      color: 0x3ab8ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 32, 1, true).translate(0, 0.5, 0), this.columnMat);
    this.column.visible = false;
    this.column.renderOrder = 5;
    scene.add(this.column);
    this.podium = buildPodium();
    this.podium.visible = false;
    scene.add(this.podium);
    ctx.events.on('slam', (e) => this.slamQ.push({ x: e.position.x, z: e.position.z, r: e.radius }));
  }

  /* ------------------------------------------------------------------ API for the boss AI */

  get wallsUp(): boolean {
    return this.walls.length > 0;
  }
  get beamActive(): boolean {
    return !!this.beam && !this.beam.fired;
  }

  /** Telegraph + raise wall lines. Segments outside the arena or on top of the plow are skipped. */
  buildWalls(h: Host, lines: WallLine[], tele: number, life: number): void {
    this.init(h.ctx);
    for (const line of lines) {
      const n = Math.max(2, Math.round(line.len / SEG));
      const w: Wall = { line, segs: [], tele, teleDur: tele, life, risen: false, decal: this.decals!.stripe() };
      const ry = Math.atan2(line.dx, line.dz);
      for (let i = 0; i < n; i++) {
        if (this.segs.length >= MAX_SEGS) break;
        const a = (i + 0.5) * (line.len / n);
        const x = line.x + line.dx * a;
        const z = line.z + line.dz * a;
        const m = SEG_R + 0.4;
        if (x < ARENA.minX + m || x > ARENA.maxX - m || z < ARENA.minZ + m || z > ARENA.maxZ - m) continue;
        const s: Seg = { x, z, ry: ry + (Math.random() - 0.5) * 0.06, tilt: (Math.random() - 0.5) * 0.04, o: { x, z, r: SEG_R }, k: 0, up: false, die: -1, delay: 0, dead: false, skip: false };
        w.segs.push(s);
        this.segs.push(s);
      }
      if (w.segs.length === 0) {
        this.decals!.release(w.decal);
        continue;
      }
      // trim the telegraph to the clipped run
      const f = w.segs[0];
      const l = w.segs[w.segs.length - 1];
      line.x = f.x - line.dx * SEG * 0.5;
      line.z = f.z - line.dz * SEG * 0.5;
      line.len = Math.hypot(l.x - f.x, l.z - f.z) + SEG;
      this.walls.push(w);
    }
  }

  startBeam(h: Host, x: number, z: number, r: number, dur: number): void {
    this.init(h.ctx);
    this.beam = { x, z, r, t: dur, dur, fired: false, flash: 0 };
    this.beamRing ??= this.decals!.ring(false);
    this.beamFill ??= this.decals!.ring(true);
    h.sfx('charge', 0.7, 1.7, 0.1);
  }

  /** Raise the rally podium at (x, z), its front facing `heading`. */
  raisePodium(h: Host, x: number, z: number, heading: number): void {
    this.init(h.ctx);
    const p = this.podium!;
    p.position.set(x, -2, z);
    p.rotation.y = heading;
    p.visible = true;
    this.podiumO.x = x;
    this.podiumO.z = z;
    this.podiumK = 0;
    this.podiumUp = true;
    this.podiumBroken = false;
    h.ctx.fx.burst(_v.set(x, 1, z), { color: 0xffd24a, count: 24, speed: 6, size: 0.14, gravity: 10, life: 0.8 });
  }

  dropPodium(): void {
    this.podiumUp = false;
  }

  /* ------------------------------------------------------------------ per frame */

  update(h: Host, dt: number): void {
    const ctx = h.ctx;
    if (this.ctx !== ctx) {
      // nothing to do until the boss first uses a prop
      if (!h.findBoss('donald')) return;
      this.init(ctx);
    }
    this.time += dt;
    const boss = h.findBoss('donald');
    const plow = ctx.plow;

    // the boss is gone: everything collapses
    if (!boss) {
      for (const s of this.segs) {
        if (s.die >= 0) continue;
        s.die = 0;
        s.delay = Math.random() * 0.3;
      }
      if (this.beam) this.beam = null;
      this.podiumUp = false;
    }

    // ---- smashing: slams, dash strikes, and the boss bulldozing through its own walls
    for (const q of this.slamQ) {
      this.smashAt(h, q.x, q.z, q.r * 1.3 + 2.2, true);
      if (this.podiumK > 0.5 && this.podiumUp && Math.hypot(q.x - this.podiumO.x, q.z - this.podiumO.z) < q.r * 1.3 + 2.6) this.breakPodium(h);
    }
    this.slamQ.length = 0;
    const dashing = plow.dashing && !plow.dead;
    if (dashing || this.wasDashing) {
      const fx = Math.sin(plow.heading);
      const fz = Math.cos(plow.heading);
      const cx = plow.position.x + fx * 2.2;
      const cz = plow.position.z + fz * 2.2;
      const reach = SEG_R + 2.1;
      for (const s of this.segs) {
        if (s.dead || s.die >= 0 || s.k < 0.4) continue;
        if ((s.x - cx) ** 2 + (s.z - cz) ** 2 < reach * reach) {
          this.smashAt(h, s.x, s.z, 2.7, true);
          break;
        }
      }
      if (this.podiumUp && this.podiumK > 0.5 && Math.hypot(cx - this.podiumO.x, cz - this.podiumO.z) < 1.25 + 2.1) this.breakPodium(h);
    }
    this.wasDashing = dashing;
    if (boss && Math.abs(boss.speed) > 2.5) {
      const reach = boss.radius + SEG_R * 0.6;
      for (const s of this.segs) {
        if (s.dead || s.die >= 0 || s.k < 0.4) continue;
        if ((s.x - boss.position.x) ** 2 + (s.z - boss.position.z) ** 2 < reach * reach) this.smashAt(h, s.x, s.z, 0.5, false);
      }
    }

    this.updateWalls(h, dt);
    this.updateBeam(h, dt, boss);
    this.updateFlights(h, dt);
    this.updatePodium(dt);

    // ---- GOLD PLATED: reflect queued damage back in small batches
    this.reflectT -= dt;
    if (boss && boss.reflectPool >= 1 && this.reflectT <= 0) {
      const amt = Math.min(22, boss.reflectPool);
      boss.reflectPool = 0;
      this.reflectT = 0.45;
      if (!plow.dead) {
        h.hitPlow(boss, amt, { knockback: 3, unblockable: true });
        _v.set(plow.position.x, plow.position.y + 2.6, plow.position.z);
        ctx.fx.floatText(_v, `REFLECTED ${Math.round(amt)}`, '#ffd24a', 0.75);
        ctx.fx.burst(_v.set(plow.position.x, plow.position.y + 1.2, plow.position.z), { color: 0xffd24a, count: 12, speed: 6, size: 0.1, gravity: 10, life: 0.4 });
      }
    } else if (!boss) this.reflectT = 0;

    this.syncObstacles(ctx);
    this.syncMeshes();
    this.decals!.update(dt, this.depth);
  }

  clear(ctx: GameContext): void {
    if (this.ctx !== ctx) return;
    for (const w of this.walls) this.decals!.release(w.decal);
    this.walls.length = 0;
    this.segs.length = 0;
    this.flights.length = 0;
    this.beam = null;
    this.beamRing = this.decals!.release(this.beamRing);
    this.beamFill = this.decals!.release(this.beamFill);
    this.decals!.clear();
    this.podiumUp = false;
    this.podiumK = 0;
    this.podium!.visible = false;
    this.podiumBroken = false;
    this.slamQ.length = 0;
    this.column!.visible = false;
    this.syncObstacles(ctx);
    this.syncMeshes();
  }

  /* ------------------------------------------------------------------ internals */

  /** Smash every risen segment within `r` of (x, z); `widen` also knocks out the two neighbours on each side so
   *  the gap is wide enough for the plow. */
  private smashAt(h: Host, x: number, z: number, r: number, widen: boolean): void {
    let hit = false;
    for (const w of this.walls) {
      const n = w.segs.length;
      const kill = new Set<number>();
      for (let i = 0; i < n; i++) {
        const s = w.segs[i];
        if (s.dead || s.die >= 0 || s.k < 0.4) continue;
        if ((s.x - x) ** 2 + (s.z - z) ** 2 < (r + SEG_R) ** 2) {
          kill.add(i);
          if (widen) for (let j = -2; j <= 2; j++) if (i + j >= 0 && i + j < n) kill.add(i + j);
        }
      }
      for (const i of kill) {
        const s = w.segs[i];
        if (s.dead || s.die >= 0) continue;
        s.die = 0;
        hit = true;
        this.debris(h, s, 1);
      }
    }
    if (hit) {
      h.sfx('wallHit', 0.9, 1.15, 0.08);
      h.ctx.fx.shake(0.35);
    }
  }

  private debris(h: Host, s: Seg, k: number): void {
    const fx = h.ctx.fx;
    _v.set(s.x, WALL_H * 0.6, s.z);
    fx.burst(_v, { color: 0xffffff, count: Math.round(14 * k), speed: 7, size: 0.32, gravity: 16, life: 0.9 });
    fx.burst(_v, { color: 0xbcd2e6, count: Math.round(6 * k), speed: 5, size: 0.22, gravity: 18, life: 0.7 });
    _v.y = WALL_H;
    fx.burst(_v, { color: 0xffd24a, count: Math.round(5 * k), speed: 6, size: 0.1, gravity: 16, life: 0.5 });
  }

  private updateWalls(h: Host, dt: number): void {
    const plow = h.ctx.plow;
    for (let wi = this.walls.length - 1; wi >= 0; wi--) {
      const w = this.walls[wi];
      if (!w.risen) {
        w.tele -= dt;
        const p = 1 - Math.max(0, w.tele) / w.teleDur;
        const d = w.decal;
        if (d) {
          d.x = w.line.x;
          d.z = w.line.z;
          d.dx = w.line.dx;
          d.dz = w.line.dz;
          d.len = w.line.len * Math.min(1, 0.25 + p * 1.2);
          d.w = 1.8;
          d.mat.color.setHex(WALL_STRIPE);
          d.mat.opacity = (0.5 + 0.45 * p) * (0.75 + 0.25 * Math.sin(this.time * 26));
        }
        if (w.tele <= 0) {
          w.risen = true;
          w.decal = this.decals!.release(w.decal);
          let any = false;
          for (const s of w.segs) {
            // never trap the plow inside a block: leave that segment out
            if (Math.hypot(s.x - plow.position.x, s.z - plow.position.z) < SEG_R + plow.radius + 0.2) {
              s.skip = true;
              s.dead = true;
              continue;
            }
            s.up = true;
            any = true;
          }
          if (any) {
            h.sfx('slam', 0.7, 0.75, 0.05);
            h.ctx.fx.shake(0.3);
            for (let i = 0; i < w.segs.length; i += 3) {
              const s = w.segs[i];
              _v.set(s.x, 0.6, s.z);
              h.ctx.fx.burst(_v, { color: 0xffffff, count: 6, speed: 4, size: 0.3, gravity: 10, life: 0.7 });
            }
          }
        }
        continue;
      }
      const was = w.life;
      w.life -= dt;
      if (was > 0 && w.life <= 0) {
        // time's up: the wall crumbles from one end to the other
        h.sfx('wallHit', 0.5, 0.8, 0.1);
        for (let i = 0; i < w.segs.length; i++) {
          const s = w.segs[i];
          if (s.dead || s.die >= 0) continue;
          s.die = 0;
          s.delay = i * 0.03;
        }
      }
      let alive = 0;
      for (let i = 0; i < w.segs.length; i++) {
        const s = w.segs[i];
        if (s.dead) continue;
        if (s.die >= 0) {
          if (s.delay > 0) {
            s.delay -= dt;
            if (s.delay <= 0 && i % 2 === 0) this.debris(h, s, 0.5);
          } else s.die += dt;
          if (s.die >= 0.4) {
            s.dead = true;
            continue;
          }
        } else if (s.up) s.k = Math.min(1, s.k + dt / RISE_T);
        alive++;
      }
      if (alive === 0) {
        this.walls.splice(wi, 1);
      }
    }
    // drop dead segments
    let j = 0;
    for (const s of this.segs) if (!s.dead) this.segs[j++] = s;
    this.segs.length = j;
  }

  private updateBeam(h: Host, dt: number, boss: Bot | null): void {
    const b = this.beam;
    const col = this.column!;
    const cm = this.columnMat!;
    if (!b) {
      if (this.beamRing) this.beamRing = this.decals!.release(this.beamRing);
      if (this.beamFill) this.beamFill = this.decals!.release(this.beamFill);
      col.visible = false;
      return;
    }
    const ring = this.beamRing!;
    const fill = this.beamFill!;
    ring.x = fill.x = b.x;
    ring.z = fill.z = b.z;
    if (!b.fired) {
      b.t -= dt;
      const p = 1 - Math.max(0, b.t) / b.dur;
      const pulse = 0.75 + 0.25 * Math.sin(this.time * (14 + p * 20));
      ring.r0 = b.r - 0.45;
      ring.r1 = b.r;
      ring.mat.color.setHex(BEAM_COLOR);
      ring.mat.opacity = (0.45 + 0.45 * p) * pulse;
      fill.r0 = 0;
      fill.r1 = Math.max(0.05, b.r * p);
      fill.mat.color.setHex(BEAM_COLOR);
      fill.mat.opacity = 0.18 + 0.2 * p;
      col.visible = true;
      col.position.set(b.x, 0, b.z);
      col.scale.set(b.r * (1.15 - 0.15 * p), 22, b.r * (1.15 - 0.15 * p));
      cm.opacity = (0.06 + 0.16 * p) * pulse;
      if (b.t <= 0) this.fireBeam(h, b, boss);
    } else {
      b.flash -= dt;
      const k = Math.max(0, b.flash / 0.5);
      ring.mat.opacity = 0.9 * k;
      fill.mat.opacity = 0.5 * k;
      fill.r1 = b.r;
      col.scale.set(b.r * (0.4 + 0.6 * k), 22, b.r * (0.4 + 0.6 * k));
      cm.opacity = 0.55 * k;
      if (b.flash <= 0) {
        this.beam = null;
        col.visible = false;
      }
    }
  }

  private fireBeam(h: Host, b: Beam, boss: Bot | null): void {
    const ctx = h.ctx;
    const fx = ctx.fx;
    b.fired = true;
    b.flash = 0.5;
    _v.set(b.x, 0.2, b.z);
    fx.ring(_v, b.r, BEAM_COLOR);
    fx.ring(_v, b.r * 0.6, 0xffffff);
    _v.y = 2;
    fx.burst(_v, { color: 0xdff8ff, count: 40, speed: 9, size: 0.25, gravity: -2, life: 0.9 });
    fx.shake(0.45);
    h.sfx('shockwave', 0.8, 1.6, 0.1);
    h.sfx('whirl', 0.7, 1.4, 0.1);
    const plow = ctx.plow;
    if (!plow.dead && Math.hypot(plow.position.x - b.x, plow.position.z - b.z) < b.r) {
      const [tx, tz] = this.farEdge(b.x, b.z);
      const vol = plow.stealSnow(1);
      if (vol > 0.01) ctx.snow?.addSnow(b.x, b.z, 2.5, vol * 0.8);
      if (boss) h.hitPlow(boss, 8, { knockback: 0.5, unblockable: true, fromX: b.x, fromZ: b.z });
      this.flights.push({ bot: null, x0: plow.position.x, z0: plow.position.z, x1: tx, z1: tz, t: 0, dur: 1.0 });
      _v.set(plow.position.x, plow.position.y + 3, plow.position.z);
      fx.floatText(_v, 'DEPORTED!', '#7fe3ff', 1.3);
      h.sfx('steal', 0.9, 0.8, 0.1);
    }
    const caught = ctx.enemies.query(b.x, b.z, b.r - 0.6);
    for (const en of caught) {
      const bot = en as Bot;
      if (bot.isBoss || !bot.alive) continue;
      const [tx, tz] = this.farEdge(b.x, b.z);
      this.flights.push({ bot, x0: bot.position.x, z0: bot.position.z, x1: tx + (Math.random() - 0.5) * 6, z1: tz + (Math.random() - 0.5) * 6, t: 0, dur: 1.0 });
    }
  }

  /** The arena edge point (inset) farthest from (x, z), avoiding wall segments. */
  private farEdge(x: number, z: number): [number, number] {
    const i = 4.5;
    const pts: [number, number][] = [
      [ARENA.minX + i, ARENA.minZ + i], [0, ARENA.minZ + i + 4], [ARENA.maxX - i, ARENA.minZ + i],
      [ARENA.minX + i, 0], [ARENA.maxX - i, 0],
      [ARENA.minX + i, ARENA.maxZ - i], [0, ARENA.maxZ - i], [ARENA.maxX - i, ARENA.maxZ - i],
    ];
    let best = pts[0];
    let bd = -1;
    for (const p of pts) {
      let d = Math.hypot(p[0] - x, p[1] - z) + Math.random() * 6;
      for (const s of this.segs) if (!s.dead && Math.hypot(s.x - p[0], s.z - p[1]) < 3) d -= 100;
      if (d > bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  private updateFlights(h: Host, dt: number): void {
    const plow = h.ctx.plow;
    const fx = h.ctx.fx;
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const e = k * k * (3 - 2 * k);
      const x = f.x0 + (f.x1 - f.x0) * e;
      const z = f.z0 + (f.z1 - f.z0) * e;
      const arc = Math.sin(Math.PI * k) * 9;
      const bot = f.bot;
      if (bot) {
        if (!bot.alive) {
          this.flights.splice(i, 1);
          continue;
        }
        bot.position.x = x;
        bot.position.z = z;
        bot.kvx = bot.kvz = 0;
        bot.speed = 0;
        bot.stun = Math.max(bot.stun, 0.25);
        bot.rig.root.position.set(x, bot.groundY + arc, z);
        bot.rig.root.rotation.x = k * Math.PI * 2;
        if (k >= 1) bot.rig.root.rotation.x = 0;
      } else {
        if (plow.dead) {
          this.flights.splice(i, 1);
          continue;
        }
        plow.position.x = x;
        plow.position.z = z;
        plow.position.y = this.depth(x, z) * 0.6 + arc;
        plow.speed = 0;
      }
      if (k >= 1) {
        _v.set(x, 0.3, z);
        fx.ring(_v, bot ? 2 : 4, BEAM_COLOR);
        fx.burst(_v, { color: 0xffffff, count: bot ? 12 : 30, speed: 7, size: 0.3, gravity: 14, life: 0.8 });
        if (!bot) {
          fx.shake(0.5);
          h.sfx('wallHit', 0.8, 0.9, 0.1);
        }
        this.flights.splice(i, 1);
      }
    }
  }

  private breakPodium(h: Host): void {
    if (!this.podiumUp) return;
    this.podiumUp = false;
    this.podiumBroken = true;
    const fx = h.ctx.fx;
    _v.set(this.podiumO.x, 1.2, this.podiumO.z);
    fx.burst(_v, { color: 0xffd24a, count: 30, speed: 9, size: 0.16, gravity: 16, life: 0.8 });
    fx.burst(_v, { color: 0x1f3b8c, count: 14, speed: 7, size: 0.25, gravity: 18, life: 0.8 });
    fx.burst(_v, { color: 0xffffff, count: 16, speed: 7, size: 0.25, gravity: 18, life: 0.8 });
    fx.ring(_v.set(this.podiumO.x, 0.2, this.podiumO.z), 3, 0xffd24a);
    fx.shake(0.5);
    h.sfx('explosion', 0.6, 1.3, 0.1);
    this.podiumK = Math.min(this.podiumK, 0.5);
  }

  private updatePodium(dt: number): void {
    const p = this.podium;
    if (!p) return;
    if (this.podiumUp) this.podiumK = Math.min(1, this.podiumK + dt / 0.5);
    else this.podiumK = Math.max(0, this.podiumK - dt / 0.35);
    p.visible = this.podiumK > 0.01;
    if (p.visible) {
      const k = this.podiumK;
      const g = this.depth(this.podiumO.x, this.podiumO.z) * 0.6;
      p.position.y = g - 1.9 * (1 - k) + (this.podiumUp ? Math.sin(Math.min(1, k) * Math.PI) * 0.15 : 0);
    }
  }

  private syncObstacles(ctx: GameContext): void {
    const arr = ctx.world?.obstacles as Obstacle[] | undefined;
    if (!arr) return;
    if (this.mine.size > 0) {
      let j = 0;
      for (let i = 0; i < arr.length; i++) if (!this.mine.has(arr[i])) arr[j++] = arr[i];
      arr.length = j;
      this.mine.clear();
    }
    for (const s of this.segs) {
      if (s.dead || s.die >= 0 || s.k < 0.6) continue;
      arr.push(s.o);
      this.mine.add(s.o);
    }
    if (this.podiumUp && this.podiumK > 0.6) {
      arr.push(this.podiumO);
      this.mine.add(this.podiumO);
    }
  }

  private syncMeshes(): void {
    const blocks = this.blocks;
    const caps = this.caps;
    if (!blocks || !caps) return;
    let n = 0;
    for (const s of this.segs) {
      if (s.dead || !s.up) continue;
      let k = s.k;
      let sc = 1;
      if (s.die > 0) {
        const d = Math.min(1, s.die / 0.4);
        k *= 1 - d * 0.7;
        sc = 1 - d * 0.5;
      }
      // overshoot pop while rising
      const pop = s.k < 1 ? Math.sin(s.k * Math.PI) * 0.12 : 0;
      const y = -WALL_H * (1 - k) + pop;
      _q.setFromEuler(_e.set(s.tilt, s.ry, -s.tilt, 'YXZ'));
      _m.compose(_p.set(s.x, y, s.z), _q, _s.set(SEG * 1.1 * sc, WALL_H, 0.95 * sc));
      blocks.setMatrixAt(n, _m);
      _m.compose(_p.set(s.x, y + WALL_H + 0.06, s.z), _q, _s.set(SEG * 1.16 * sc, 0.16, 1.12 * sc));
      caps.setMatrixAt(n, _m);
      n++;
    }
    for (const im of [blocks, caps]) {
      im.count = n;
      im.visible = n > 0;
      if (n > 0) im.instanceMatrix.needsUpdate = true;
    }
  }
}

/** A gold-trimmed navy lectern with a red / white front, a gold seal and two microphones (front = local +Z). */
function buildPodium(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'DonaldPodium';
  const navy = new THREE.MeshStandardMaterial({ color: 0x1f3b8c, roughness: 0.55, flatShading: true });
  const gold = new THREE.MeshStandardMaterial({ color: 0xf2c033, roughness: 0.3, metalness: 0.45, emissive: 0x3a2400, emissiveIntensity: 0.4, flatShading: true });
  const red = new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.6, flatShading: true });
  const white = new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.5, flatShading: true });
  const black = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.5 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx;
    mesh.castShadow = true;
    g.add(mesh);
  };
  add(new THREE.BoxGeometry(2.0, 0.25, 1.3), gold, 0, 0.12, 0);
  add(new THREE.BoxGeometry(1.7, 1.8, 1.0), navy, 0, 1.15, 0);
  add(new THREE.BoxGeometry(1.74, 0.22, 0.04), red, 0, 0.55, 0.52);
  add(new THREE.BoxGeometry(1.74, 0.12, 0.04), white, 0, 0.72, 0.52);
  add(new THREE.BoxGeometry(1.74, 0.22, 0.04), red, 0, 0.88, 0.52);
  add(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 24).rotateX(Math.PI / 2), gold, 0, 1.55, 0.53);
  add(new THREE.CylinderGeometry(0.3, 0.3, 0.07, 5).rotateX(Math.PI / 2), white, 0, 1.55, 0.55);
  add(new THREE.BoxGeometry(2.0, 0.14, 1.25), gold, 0, 2.1, -0.05, -0.18);
  for (const sx of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 6), black, sx * 0.22, 2.45, 0.25, 0.5);
    add(new THREE.SphereGeometry(0.08, 8, 6), black, sx * 0.22, 2.75, 0.42);
  }
  return g;
}

export const donaldProps = new DonaldProps();
