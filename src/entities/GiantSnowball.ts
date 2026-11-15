import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GameContext } from '../core/types';
import { ARENA } from '../core/types';
import { makeSurface } from '../world/Terrain';
import { AV, WO, ballFrac, ballFull, ballGrow } from '../config/whiteout';
import { M } from './enemies/models';
import { standIns } from '../render/standIns';

/**
 * THE AVALANCHE's GIANT SNOWBALL (PROTOCOL C finale, core/whiteoutDirector.ts runs it). One ball at a time:
 *  - it forms out of the snow (FORM_T s, growing from nothing to START_R) at a spot clear of the plow;
 *  - ANY plow pushes it: on contact it takes the plow's closing speed (x AV.PUSH), leaning toward the plow's heading
 *    (AV.STEER), so ramming it, nudging it and steering it all work the same for every vehicle; a big ball is heavy
 *    (the plow pushing it is held to AV.HEAVY of its top speed at full size);
 *  - it rolls with drag on the terrain (down slopes, up ramps, off deck sides and the arena walls) and GROWS as it rolls
 *    through snow (config/whiteout.ts ballGrow), scooping a trench (SnowField.collectDisc);
 *  - it picks up what lies on the floor (bot scrap, briefcases, gold, crate planks, THE CHAIRMAN's red cap) and every
 *    crate it smashes: they stick to it and roll with it;
 *  - gusts shove it, shards chip it (chip()), lava melts it; under AV.MIN_R it bursts into powder (a new one forms
 *    AV.RESPAWN_T s later from the snow left).
 *  - Rolled into the target (the eye on the stand front): onHit(full): full size = the director's ending; smaller = it
 *    bursts against the eye (onHit(false)) and a new one forms.
 * The visual (a lumpy snow sphere + the stuck debris) is built once per scene (prewarm, hidden; warmMeshes() hands the
 * warm-up visible stand-ins). No per-frame allocation.
 */

/** Floor debris kinds (pooled meshes). */
type DebrisKind = 'cap' | 'case' | 'scrap' | 'gear' | 'gold' | 'plank' | 'ice';
const KINDS: readonly DebrisKind[] = ['cap', 'case', 'case', 'scrap', 'scrap', 'scrap', 'gear', 'gear', 'gold', 'gold', 'gold', 'ice', 'ice', 'plank', 'plank', 'plank', 'plank', 'plank', 'plank', 'scrap', 'gold', 'ice'];
/** What lies on the floor when THE AVALANCHE starts (x, z, kind index into KINDS): the wreckage of the fight. */
const FLOOR: readonly [number, number, number][] = [
  [2.5, -22, 0], // THE CHAIRMAN's cap, where he fell
  [-5, -15, 1], [9, 4, 2], [-11, 2, 3], [5, 11, 4], [-18, 14, 5], [17, -9, 6], [-4, 21, 7], [20, 18, 8], [-21, -6, 9],
  [11, -17, 10], [0, -6, 11], [-14, -19, 12],
];
const _surf = makeSurface();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _o = { x: 0, z: 0 };

interface Debris {
  obj: THREE.Object3D;
  kind: DebrisKind;
  /** 'floor' = lying at (x, z); 'stuck' = on the ball (local unit direction in `dir`); 'off'. */
  state: 'floor' | 'stuck' | 'off';
  x: number;
  z: number;
  spin: number;
  size: number;
  dir: THREE.Vector3;
}

export interface BallTarget {
  x: number;
  z: number;
  r: number;
}

export class GiantSnowball {
  active = false;
  x = 0;
  z = 0;
  y = 0;
  vx = 0;
  vz = 0;
  r = 0;
  /** Seconds left of forming (0 = formed). */
  forming = 0;
  /** Seconds to the next ball after a burst (-1 = none pending). */
  respawnT = -1;
  /** Bursts so far (too small at the eye, shards / lava). */
  bursts = 0;
  /** Debris stuck to it right now. */
  stuck = 0;
  /** The eye: the ball touching it reports onHit. */
  target: BallTarget | null = null;
  onHit: ((full: boolean) => void) | null = null;
  /** Rolled distance of this ball (m). */
  rolled = 0;
  /** A plow is pushing it this frame. */
  pushed = false;
  /** Wind on it right now (m/s^2: a gust blowing; the director sets it every frame). */
  readonly wind = { x: 0, z: 0 };

  private scene: THREE.Scene | null = null;
  private group = new THREE.Group();
  private mesh!: THREE.Mesh;
  private mat!: THREE.MeshStandardMaterial;
  private shadow!: THREE.Mesh;
  private shadowMat!: THREE.MeshBasicMaterial;
  private debris: Debris[] = [];
  private warm: THREE.Object3D[] = [];
  private trailT = 0;
  /** This frame's dt (collide's banked edge). */
  private bankDt = 0;
  private flash = 0;
  private time = 0;

  constructor(private readonly ctx: GameContext) {}

  /* ------------------------------------------------------------------ build */

  /** Build (hidden) into `scene` once per scene. */
  prewarm(scene: THREE.Scene): void {
    if (this.scene === scene) return;
    if (!this.mesh) this.build();
    this.scene = scene;
    scene.add(this.group);
    this.group.visible = false;
    for (const d of this.debris) {
      scene.add(d.obj);
      d.obj.visible = false;
    }
  }

  /** Visible stand-ins sharing every material (the scene's copies are hidden until THE AVALANCHE). */
  warmMeshes(): THREE.Object3D[] {
    if (!this.mesh) this.build();
    return this.warm;
  }

  private build(): void {
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0, emissive: 0x9cc6ff, emissiveIntensity: 0.16 });
    this.mesh = new THREE.Mesh(ballGeometry(), this.mat);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);
    // a soft dark blob under it (reads on the floodlit snow at night)
    this.shadowMat = new THREE.MeshBasicMaterial({ color: 0x0a1020, transparent: true, opacity: 0.4, depthWrite: false, map: blobTexture() });
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), this.shadowMat);
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);
    this.group.name = 'GiantSnowball';
    for (const kind of KINDS) {
      const obj = debrisModel(kind);
      this.debris.push({ obj, kind, state: 'off', x: 0, z: 0, spin: 0, size: 1, dir: new THREE.Vector3() });
    }
    const w = standIns([this.group, ...this.debris.map((d) => d.obj)]);
    this.warm = w;
  }

  /* ------------------------------------------------------------------ API */

  /** HUD: 0..1 of the way to full size; full. */
  get frac(): number {
    return ballFrac(this.r);
  }
  get full(): boolean {
    return ballFull(this.r);
  }

  /** THE AVALANCHE begins: the wreckage lies on the floor; no ball yet. */
  begin(): void {
    this.end();
    this.bursts = 0;
    const snow = this.ctx.snow;
    for (let i = 0; i < this.debris.length; i++) {
      const d = this.debris[i];
      d.state = 'off';
      d.obj.visible = false;
    }
    for (const [x, z, k] of FLOOR) {
      const d = this.debris[k];
      if (!d) continue;
      d.state = 'floor';
      d.x = x;
      d.z = z;
      d.spin = (x * 1.7 + z * 0.9) % 6.28;
      d.obj.visible = !!this.scene;
      d.obj.position.set(x, (snow?.topAt?.(x, z) ?? 0) + 0.2, z);
      d.obj.rotation.set(0.3 * Math.sin(d.spin), d.spin, 0.25 * Math.cos(d.spin));
      d.obj.scale.setScalar(1);
    }
  }

  /** A ball forms at (x, z). */
  spawn(x: number, z: number): void {
    this.active = true;
    this.x = x;
    this.z = z;
    this.vx = this.vz = 0;
    this.r = AV.START_R;
    this.forming = AV.FORM_T;
    this.respawnT = -1;
    this.rolled = 0;
    this.flash = 0;
    this.mesh.quaternion.identity();
    this.group.visible = !!this.scene;
    this.place(0);
    const fx = this.ctx.fx;
    _v.set(x, this.y - this.r * 0.5, z);
    fx?.powder(_v, { size: 2.2, color: 0xeaf6ff });
    fx?.ring(_v, 3.2, 0xdff4ff);
    this.ctx.audio?.play('freeze', { volume: 0.7, pitch: 0.6 });
  }

  /** Everything off (the ending / leaving). */
  end(): void {
    this.active = false;
    this.respawnT = -1;
    this.group.visible = false;
    this.stuck = 0;
    for (const d of this.debris) {
      if (d.state === 'stuck') this.unstick(d);
      d.state = 'off';
      d.obj.visible = false;
    }
  }

  /** Hide the ball where it is (the ending: it is swallowed by the eye). */
  hide(): void {
    this.active = false;
    this.group.visible = false;
    for (const d of this.debris) if (d.state === 'stuck') d.obj.visible = false;
  }

  /** A shard landed at (x, z): the spike comes down through the ring's middle, so it chips the ball only when it
   *  strikes the ball's body (ring centre within r + half the ring radius): a ball steered off the ring's middle in
   *  the telegraph escapes (the whole ring touching its outline was a near-certain hit on a big ball). */
  chip(x: number, z: number): void {
    if (!this.active || this.forming > 0) return;
    if (Math.hypot(x - this.x, z - this.z) > WO.SHARD_R * 0.5 + this.r) return;
    this.r -= AV.CHIP;
    this.flash = 1;
    const fx = this.ctx.fx;
    _v.set(x, this.y + this.r * 0.4, z);
    fx?.burst(_v, CHIP_BURST);
    fx?.floatText(_v.set(this.x, this.y + this.r + 1.6, this.z), 'CHIPPED!', '#9fd8ff', 0.9);
    this.ctx.audio?.play('burst', { volume: 0.7, pitch: 0.7 });
    if (this.r < AV.MIN_R) this.burst('TOO SMALL! IT BURST');
  }

  /** It bursts into powder (gives a share of its snow back to the floor); a new one forms after RESPAWN_T s. */
  burst(label: string): void {
    if (!this.active) return;
    const ctx = this.ctx;
    this.active = false;
    this.bursts++;
    this.respawnT = AV.RESPAWN_T;
    this.group.visible = false;
    const r = Math.max(0.6, this.r);
    _v.set(this.x, this.y, this.z);
    ctx.fx?.powder(_v, { size: 1.6 + r, color: 0xf2f8ff });
    ctx.fx?.burst(_v, BURST_BIG);
    ctx.fx?.ring(_v, r * 2.4, 0xdff4ff);
    ctx.fx?.shake(0.5);
    ctx.audio?.play('burst', { volume: 1, pitch: 0.55 });
    _v.y += r + 2;
    ctx.fx?.floatText(_v, label, '#ffffff', 1.1);
    ctx.snow?.addSnow(this.x, this.z, r * 1.8, (4 / 3) * Math.PI * r * r * r * 0.25);
    // what it carried drops off and scatters
    for (const d of this.debris) {
      if (d.state !== 'stuck') continue;
      this.unstick(d);
      d.state = 'floor';
      const a = Math.random() * Math.PI * 2;
      const k = r * (1.1 + Math.random() * 0.8);
      d.x = clampIn(this.x + Math.sin(a) * k, 1.5);
      d.z = clampIn(this.z + Math.cos(a) * k, 1.5);
      d.obj.position.set(d.x, (ctx.snow?.topAt?.(d.x, d.z) ?? 0) + 0.2, d.z);
    }
    this.stuck = 0;
  }

  /* ------------------------------------------------------------------ per frame */

  /** `spawnAt`: where the next ball forms (the director picks it), called when a respawn falls due. */
  update(dt: number, spawnAt: (out: { x: number; z: number }) => void): void {
    this.time += dt;
    if (!this.active) {
      if (this.respawnT >= 0 && (this.respawnT -= dt) < 0) {
        spawnAt(_o);
        this.spawn(_o.x, _o.z);
      }
      this.spinFloor(dt);
      return;
    }
    const ctx = this.ctx;
    if (this.forming > 0) this.forming = Math.max(0, this.forming - dt);
    // gusts shove it (while one blows)
    this.vx += this.wind.x * dt;
    this.vz += this.wind.z * dt;
    // slopes and ramps
    const t = ctx.terrain;
    const feet = this.y - this.r;
    if (t?.active) {
      t.surfaceAt(this.x, this.z, feet + 0.3, _surf);
      this.vx -= _surf.gx * AV.SLOPE * dt;
      this.vz -= _surf.gz * AV.SLOPE * dt;
    }
    // drag (a big ball carries more)
    const drag = AV.DRAG + AV.DRAG_BIG * (this.r / AV.FULL_R);
    const k = Math.exp(-drag * dt);
    this.vx *= k;
    this.vz *= k;
    this.contactPlow(dt);
    // move
    const ox = this.x;
    const oz = this.z;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.bankDt = dt;
    this.collide();
    const ds = Math.hypot(this.x - ox, this.z - oz);
    this.rolled += ds;
    this.place(dt);
    // roll: about the axis across its motion
    if (ds > 1e-5) {
      _axis.set(this.z - oz, 0, -(this.x - ox)).normalize();
      _q.setFromAxisAngle(_axis, ds / Math.max(0.3, this.r));
      this.mesh.quaternion.premultiply(_q);
    }
    this.grow(ds, dt);
    if (!this.active) return;
    this.pickUp();
    this.syncStuck();
    this.hitTarget();
    this.spinFloor(dt);
  }

  /** Grow on snow (scooping a trench), melt on lava. */
  private grow(ds: number, dt: number): void {
    const ctx = this.ctx;
    const t = ctx.terrain;
    const onDeck = t?.active ? (t.heightAt(this.x, this.z, this.y - this.r + 0.3), t.heightDeck >= 0) : false;
    if (t?.patches.length && !onDeck && t.materialAt(this.x, this.z) === 'lava') {
      this.r -= AV.LAVA * dt;
      this.trailT -= dt;
      if (this.trailT <= 0) {
        this.trailT = 0.12;
        _v.set(this.x + (Math.random() - 0.5) * this.r, this.y - this.r * 0.6, this.z + (Math.random() - 0.5) * this.r);
        ctx.fx?.burst(_v, STEAM);
        ctx.audio?.play('lavaBurn', { volume: 0.6, pitch: 0.8 });
      }
      if (this.r < AV.MIN_R) this.burst('MELTED!');
      return;
    }
    if (ds <= 0 || onDeck || !ctx.snow) return;
    // the snow it rolls onto: at its leading edge (under its centre the trench it scoops is already dug)
    const sp = Math.hypot(this.vx, this.vz) || 1;
    const lead = this.r * 0.85;
    const depth = ctx.snow.getDepth(this.x + (this.vx / sp) * lead, this.z + (this.vz / sp) * lead);
    this.r = ballGrow(this.r, ds, depth);
    if (depth > 0.02) ctx.snow.collectDisc(this.x, this.z, this.r * 0.72, Math.min(0.9, ds * 0.4));
    this.trailT -= dt;
    if (this.trailT <= 0 && ds / Math.max(1e-4, dt) > 2.5) {
      this.trailT = 0.14;
      _v.set(this.x - this.vx * 0.05, this.y - this.r * 0.85, this.z - this.vz * 0.05);
      ctx.fx?.burst(_v, TRAIL);
    }
  }

  /** Any plow: contact pushes the ball with the plow's closing velocity. */
  private contactPlow(dt: number): void {
    this.pushed = false;
    const plow = this.ctx.plow;
    if (!plow || plow.dead) return;
    const p = plow.position;
    // airborne over it: no contact
    if (p.y > this.y + this.r * 0.6) return;
    const dx = this.x - p.x;
    const dz = this.z - p.z;
    const min = this.r + plow.radius * 0.85;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return;
    const d = Math.sqrt(d2) || 1e-3;
    const nx = dx / d;
    const nz = dz / d;
    const fx = Math.sin(plow.heading);
    const fz = Math.cos(plow.heading);
    const pvx = fx * plow.speed;
    const pvz = fz * plow.speed;
    const closing = (pvx - this.vx) * nx + (pvz - this.vz) * nz;
    if (closing > 0) {
      // leaning toward the plow's heading (driving forward) so it steers where the plow points
      const s = plow.speed >= 0 ? AV.STEER : 0;
      let ux = nx * (1 - s) + fx * s;
      let uz = nz * (1 - s) + fz * s;
      const ul = Math.hypot(ux, uz) || 1;
      ux /= ul;
      uz /= ul;
      const imp = closing * AV.PUSH * (this.forming > 0 ? 0.5 : 1);
      this.vx += ux * imp;
      this.vz += uz * imp;
      this.pushed = true;
      // heavy: the plow pushing a big ball slows
      const top = (this.ctx.stats?.maxSpeed ?? 12) * (1 - (1 - AV.HEAVY) * this.frac);
      if (plow.speed > top) plow.speed += (top - plow.speed) * Math.min(1, dt * 6);
      if (closing > 7) {
        _v.set(this.x - nx * this.r, this.y, this.z - nz * this.r);
        this.ctx.fx?.powder(_v, { size: 0.9, color: 0xeaf6ff });
        this.ctx.audio?.play('thud', { volume: Math.min(1, closing / 14), pitch: 0.7 });
      }
    }
    // separate: the ball moves out (the plow keeps driving)
    const over = min - d;
    this.x += nx * over;
    this.z += nz * over;
  }

  /** Arena walls, deck sides, props (big enough: it smashes crates and keeps a plank). After moving, the plow is kept
   *  out of it (a ball wedged on a wall stops the plow instead). */
  private collide(): void {
    const ctx = this.ctx;
    const lim = ARENA.maxX - this.r * 0.9;
    // the banked edge: rolls it back off the walls (no pinned ball in a corner)
    const bx = Math.abs(this.x) - (lim - AV.BANK_W);
    if (bx > 0) this.vx -= Math.sign(this.x) * AV.BANK * Math.min(1, bx / AV.BANK_W) * this.bankDt;
    const limZ0 = ARENA.maxZ - this.r * 0.9;
    const bz = Math.abs(this.z) - (limZ0 - AV.BANK_W);
    if (bz > 0) this.vz -= Math.sign(this.z) * AV.BANK * Math.min(1, bz / AV.BANK_W) * this.bankDt;
    if (this.x > lim || this.x < -lim) {
      this.x = Math.max(-lim, Math.min(lim, this.x));
      this.vx *= -0.35;
    }
    const limZ = ARENA.maxZ - this.r * 0.9;
    if (this.z > limZ || this.z < -limZ) {
      this.z = Math.max(-limZ, Math.min(limZ, this.z));
      this.vz *= -0.35;
    }
    const t = ctx.terrain;
    if (t?.active && t.decks.length) {
      const feet = this.y - this.r;
      const deck = t.wallAt(this.x, this.z, feet, this.r * 1.6, this.r * 0.9);
      if (deck) {
        t.pushOut(deck, this.x, this.z, this.r * 0.9, _o);
        let nx = _o.x - this.x;
        let nz = _o.z - this.z;
        const nl = Math.hypot(nx, nz);
        this.x = _o.x;
        this.z = _o.z;
        if (nl > 1e-4) {
          nx /= nl;
          nz /= nl;
          const vn = this.vx * nx + this.vz * nz;
          if (vn < 0) {
            this.vx -= nx * vn * 1.35;
            this.vz -= nz * vn * 1.35;
          }
        }
      }
    }
    const obs = ctx.world?.obstacles;
    if (obs) {
      for (let i = 0; i < obs.length; i++) {
        const o = obs[i];
        const dx = this.x - o.x;
        const dz = this.z - o.z;
        const min = this.r * 0.9 + o.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        if (o.breakable && this.r >= 1.5 && ctx.world.breakObstacle(o, false)) {
          this.stickNew('plank');
          ctx.audio?.play('ram', { volume: 0.6, pitch: 0.8 });
          continue;
        }
        const d = Math.sqrt(d2) || 1e-3;
        const nx = dx / d;
        const nz = dz / d;
        this.x = o.x + nx * min;
        this.z = o.z + nz * min;
        const vn = this.vx * nx + this.vz * nz;
        if (vn < 0) {
          this.vx -= nx * vn * 1.35;
          this.vz -= nz * vn * 1.35;
        }
      }
    }
    // the plow stays out of it
    const plow = ctx.plow;
    if (plow && !plow.dead && plow.position.y < this.y + this.r * 0.6) {
      const dx = plow.position.x - this.x;
      const dz = plow.position.z - this.z;
      const min = this.r + plow.radius * 0.85;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 1e-3;
        plow.position.x = this.x + (dx / d) * min;
        plow.position.z = this.z + (dz / d) * min;
        const into = -(Math.sin(plow.heading) * dx + Math.cos(plow.heading) * dz) / d;
        if (into > 0.5 && plow.speed > 0) plow.speed *= 0.7;
      }
    }
  }

  /** Height: on the snow top (sunk in a little) or a deck; eased so it never pops. */
  private place(dt: number): void {
    const ctx = this.ctx;
    const t = ctx.terrain;
    let ground = 0;
    let snowD = 0;
    if (t?.active) {
      ground = t.heightAt(this.x, this.z, this.y - this.r + 0.4);
      if (t.heightDeck < 0) snowD = ctx.snow?.getDepth(this.x, this.z) ?? 0;
    } else snowD = ctx.snow?.getDepth(this.x, this.z) ?? 0;
    const form = this.forming > 0 ? 1 - this.forming / AV.FORM_T : 1;
    const shown = this.r * (form * form * (3 - 2 * form));
    const want = ground + snowD * 0.6 + shown * 0.95;
    this.y = dt > 0 ? this.y + (want - this.y) * Math.min(1, dt * 14) : want;
    this.group.position.set(this.x, this.y, this.z);
    this.mesh.scale.setScalar(Math.max(0.02, shown));
    this.flash = Math.max(0, this.flash - dt * 4);
    this.mat.emissiveIntensity = 0.16 + this.flash * 0.9 + (this.full ? 0.12 + 0.08 * Math.sin(this.time * 6) : 0);
    // the blob sits on the floor under it
    this.shadow.position.set(0, ground + snowD + 0.06 - this.y, 0);
    this.shadow.scale.setScalar(shown * 1.25);
  }

  /** Floor debris touching the ball sticks to it. */
  private pickUp(): void {
    for (const d of this.debris) {
      if (d.state !== 'floor') continue;
      const dx = d.x - this.x;
      const dz = d.z - this.z;
      const reach = this.r * 0.95 + 0.35;
      if (dx * dx + dz * dz > reach * reach) continue;
      // its direction from the centre, in the ball's own (rolling) frame
      _v.set(dx, -this.r * 0.55, dz).normalize();
      this.stick(d, _v);
    }
  }

  /** Stick a free pool piece of `kind` on (a crate it smashed). */
  private stickNew(kind: DebrisKind): void {
    let pick: Debris | null = null;
    for (const d of this.debris) if (d.kind === kind && d.state === 'off') pick = d;
    if (!pick) return;
    const a = Math.random() * Math.PI * 2;
    _v.set(Math.sin(a), (Math.random() - 0.5) * 0.8, Math.cos(a)).normalize();
    this.stick(pick, _v);
  }

  private stick(d: Debris, worldDir: THREE.Vector3): void {
    d.state = 'stuck';
    _qi.copy(this.mesh.quaternion).invert();
    d.dir.copy(worldDir).applyQuaternion(_qi);
    this.mesh.add(d.obj);
    d.obj.visible = true;
    // planted along its direction, half sunk
    d.obj.quaternion.setFromUnitVectors(_up, d.dir);
    _q.setFromAxisAngle(_up, d.spin);
    d.obj.quaternion.multiply(_q);
    this.stuck++;
    if (d.kind === 'cap') {
      _w.set(this.x, this.y + this.r + 2.2, this.z);
      this.ctx.fx?.floatText(_w, "THE CHAIRMAN'S CAP!", '#ff4a5e', 1);
    }
    this.ctx.audio?.play('clash', { volume: 0.35, pitch: 1.5 });
  }

  private unstick(d: Debris): void {
    if (d.obj.parent !== this.scene && this.scene) this.scene.add(d.obj);
    d.obj.quaternion.identity();
    d.obj.rotation.set(0.3 * Math.sin(d.spin), d.spin, 0.25 * Math.cos(d.spin));
    d.obj.scale.setScalar(1);
  }

  /** Stuck debris keeps its world size as the ball grows (the mesh is scaled by the radius). */
  private syncStuck(): void {
    const s = Math.max(0.02, this.mesh.scale.x);
    for (const d of this.debris) {
      if (d.state !== 'stuck') continue;
      d.obj.position.copy(d.dir).multiplyScalar(0.94);
      d.obj.scale.setScalar(1 / s);
    }
  }

  /** Floor pieces bob a little in the wind (and settle on the snow as it falls). */
  private spinFloor(dt: number): void {
    const snow = this.ctx.snow;
    for (const d of this.debris) {
      if (d.state !== 'floor') continue;
      const y = (snow?.topAt?.(d.x, d.z) ?? 0) + 0.15;
      d.obj.position.y += (y - d.obj.position.y) * Math.min(1, dt * 6);
    }
  }

  private hitTarget(): void {
    const tg = this.target;
    if (!tg || this.forming > 0) return;
    const reach = this.r + tg.r + AV.HIT_PAD;
    if ((this.x - tg.x) ** 2 + (this.z - tg.z) ** 2 > reach * reach) return;
    const full = this.full;
    if (full) {
      this.vx = this.vz = 0;
      this.onHit?.(true);
    } else {
      this.onHit?.(false);
      this.burst('TOO SMALL! IT BURST');
    }
  }
}

/* ------------------------------------------------------------------ helpers */

function clampIn(v: number, pad: number): number {
  return Math.max(ARENA.minX + pad, Math.min(ARENA.maxX - pad, v));
}

/** A big lumpy snowball (unit radius): packed bands and clumps, vertex-coloured white with cold blue in the creases. */
function ballGeometry(): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 5);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    // rolled-on layers (bands round one axis) + clumps
    const band = Math.sin(v.y * 9 + Math.sin(v.x * 3.1) * 1.6) * 0.5 + 0.5;
    const clump = Math.sin(v.x * 7.3 + v.z * 5.1) * Math.sin(v.y * 6.7 - v.x * 4.3) * 0.5 + 0.5;
    const n = band * 0.035 + clump * 0.06 + (hash(v.x, v.y, v.z) - 0.5) * 0.03;
    pos.setXYZ(i, v.x * (1 + n), v.y * (1 + n), v.z * (1 + n));
    const crease = 1 - clump;
    col[i * 3] = 0.94 - crease * 0.16;
    col[i * 3 + 1] = 0.97 - crease * 0.09;
    col[i * 3 + 2] = 1.0;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function hash(x: number, y: number, z: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

let _blob: THREE.Texture | null = null;
function blobTexture(): THREE.Texture {
  if (_blob) return _blob;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.55, 'rgba(255,255,255,0.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
  }
  _blob = new THREE.CanvasTexture(c);
  return _blob;
}

/** One piece of floor debris (local +y = out of the ball when stuck). Shared bot materials (already compiled). */
function debrisModel(kind: DebrisKind): THREE.Object3D {
  const grp = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    grp.add(m);
  };
  switch (kind) {
    case 'cap':
      // THE CHAIRMAN's red cap (dome + brim + the front panel), oversized so it reads on the ball
      add(new THREE.SphereGeometry(0.62, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.capRed(), 0, 0, 0);
      add(new THREE.CylinderGeometry(0.66, 0.66, 0.06, 16, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 1.5), M.capRed(), 0, 0.02, 0.18);
      add(new THREE.PlaneGeometry(0.72, 0.3), M.maga(), 0, 0.3, 0.53, -0.45);
      break;
    case 'case':
      add(new THREE.BoxGeometry(0.95, 0.7, 0.3), M.rustDark(), 0, 0.3, 0);
      add(new THREE.BoxGeometry(0.36, 0.08, 0.1), M.gold(), 0, 0.7, 0);
      break;
    case 'scrap':
      add(new THREE.BoxGeometry(0.7, 0.45, 0.55), M.dark(), 0, 0.15, 0, 0.3, 0.4, 0.2);
      add(new THREE.BoxGeometry(0.75, 0.08, 0.25), M.hazard(), 0, 0.42, 0.1, 0.3, 0.4, 0.2);
      break;
    case 'gear':
      add(new THREE.TorusGeometry(0.42, 0.13, 6, 10), M.steel(), 0, 0.2, 0, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.12, 0.12, 0.4, 8), M.dark(), 0, 0.2, 0);
      break;
    case 'gold':
      add(new THREE.DodecahedronGeometry(0.42, 0), M.gold(), 0, 0.2, 0, 0.4, 0.2, 0.7);
      break;
    case 'ice':
      add(new THREE.OctahedronGeometry(0.5, 0).scale(0.6, 1.4, 0.6), M.ice(), 0, 0.35, 0, 0.2, 0, 0.3);
      break;
    case 'plank':
      add(new THREE.BoxGeometry(1.1, 0.12, 0.3), M.rustDark(), 0, 0.08, 0, 0, 0.5, 0.2);
      add(new THREE.BoxGeometry(0.9, 0.12, 0.28), M.rustDark(), 0.1, 0.18, 0.15, 0, -0.4, -0.15);
      break;
  }
  return grp;
}

const CHIP_BURST = { color: 0xeaf6ff, count: 24, speed: 7, size: 0.3, gravity: 10, life: 0.9 };
const BURST_BIG = { color: 0xffffff, count: 70, speed: 13, size: 0.42, gravity: 9, life: 1.4 };
const TRAIL = { color: 0xeef6ff, count: 4, speed: 2.2, size: 0.32, gravity: 5, life: 0.6 };
const STEAM = { color: 0xdfe6ee, count: 5, speed: 2, size: 0.5, gravity: -3, life: 1 };
