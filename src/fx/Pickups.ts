import * as THREE from 'three';
import { ARENA, type GameContext, type PickupsAPI } from '../core/types';
import { makeSurface } from '../world/Terrain';

const MAX_COINS = 300;
const COIN_R = 0.32;
const COIN_H = 0.08;
/** Terrain: resting coins roll downhill (share of -g * gradient) with rolling friction (1/s). */
const COIN_ROLL = 0.6;
const COIN_FRICTION = 2.2;
/** Gradient below which a slow coin stops rolling for good. */
const COIN_STATIC = 0.06;
const _grad = { gx: 0, gz: 0 };
/** Surface scratch for rolling coins on arenas with decks (the gradient under a resting coin). */
const _surf = makeSurface();

interface Coin {
  active: boolean;
  value: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  spin: number;
  phase: number;
  grounded: boolean;
  homing: boolean;
  /** Resting on terrain where friction wins (stops the per-frame slope query). */
  settled: boolean;
}

export class Pickups implements PickupsAPI {
  private ctx: GameContext;
  private mesh: THREE.InstancedMesh;
  private coins: Coin[] = [];
  private dummy = new THREE.Object3D();
  private tmp = new THREE.Vector3();
  private hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    const geo = new THREE.CylinderGeometry(COIN_R, COIN_R, COIN_H, 14);
    geo.rotateX(Math.PI / 2); // face along Z so spinning around Y shows the face
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffc43a,
      metalness: 0.85,
      roughness: 0.28,
      emissive: 0x7a4a00,
      emissiveIntensity: 0.55,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_COINS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    // Hidden while empty: an InstancedMesh with count 0 still costs a (main + shadow) draw call.
    this.mesh.visible = false;
    ctx.scene.add(this.mesh);
    for (let i = 0; i < MAX_COINS; i++) {
      this.coins.push({
        active: false, value: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
        age: 0, spin: 0, phase: 0, grounded: false, homing: false, settled: false,
      });
      this.mesh.setMatrixAt(i, this.hidden);
    }
  }

  spawnCoins(pos: THREE.Vector3, amount: number): void {
    amount = Math.max(0, Math.round(amount));
    if (amount <= 0) return;
    const n = Math.max(1, Math.min(6, amount, Math.ceil(amount / 3)));
    const base = Math.floor(amount / n);
    let rem = amount - base * n;
    for (let i = 0; i < n; i++) {
      const c = this.coins.find((k) => !k.active);
      const v = base + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
      if (!c) {
        // Pool exhausted: award directly
        this.award(v, pos, false);
        continue;
      }
      c.active = true;
      c.value = v;
      const terr = this.ctx.terrain;
      const floor0 = terr && terr.decks.length ? this.floor(pos.x, pos.z, pos.y) - COIN_R : terr && terr.active && this.ctx.snow ? this.ctx.snow.topAt(pos.x, pos.z) : 0;
      c.pos.set(pos.x, Math.max(pos.y, floor0 + 0.4) + 0.3, pos.z);
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 2.5;
      c.vel.set(Math.cos(a) * s, 5 + Math.random() * 3, Math.sin(a) * s);
      c.age = 0;
      c.spin = Math.random() * Math.PI * 2;
      c.phase = Math.random() * Math.PI * 2;
      c.grounded = false;
      c.homing = false;
      c.settled = false;
    }
  }

  private award(value: number, pos: THREE.Vector3, fx: boolean): void {
    const ctx = this.ctx;
    ctx.progression.addCoins(value);
    ctx.events.emit('coinCollected', { amount: value });
    if (fx) {
      ctx.audio?.play('coin', { pitch: 1 + Math.random() * 0.15 });
      ctx.fx?.floatText(pos, '+' + value, '#ffd84a');
    }
  }

  collectAll(): number {
    let total = 0;
    for (const c of this.coins) {
      if (c.active) {
        total += c.value;
        c.active = false;
      }
    }
    if (total > 0) {
      this.ctx.progression.addCoins(total);
      this.ctx.events.emit('coinCollected', { amount: total });
    }
    this.clear();
    return total;
  }

  clear(): void {
    for (let i = 0; i < MAX_COINS; i++) {
      this.coins[i].active = false;
      this.mesh.setMatrixAt(i, this.hidden);
    }
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.instanceMatrix.clearUpdateRanges();
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt: number): void {
    const ctx = this.ctx;
    const plow = ctx.plow;
    const magnet = ctx.stats.magnetRadius;
    const t = ctx.time;
    let maxIdx = -1;
    for (let i = 0; i < MAX_COINS; i++) {
      const c = this.coins[i];
      if (!c.active) {
        this.mesh.setMatrixAt(i, this.hidden);
        continue;
      }
      c.age += dt;
      let y = c.pos.y;
      if (plow) {
        const dx = plow.position.x - c.pos.x;
        const dz = plow.position.z - c.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < plow.radius + 0.6) {
          c.active = false;
          this.award(c.value, c.pos, true);
          this.mesh.setMatrixAt(i, this.hidden);
          continue;
        }
        if (!c.homing && c.age > 0.5 && (d < magnet || c.age > 10)) c.homing = true;
        if (c.homing) {
          const sp = 8 + c.age * 6;
          this.tmp.set(dx, plow.position.y + 1 - c.pos.y, dz).normalize();
          c.vel.lerp(this.tmp.multiplyScalar(Math.min(40, sp)), Math.min(1, dt * 8));
          c.pos.addScaledVector(c.vel, dt);
          y = c.pos.y;
        }
      }
      if (!c.homing) {
        if (!c.grounded) {
          const y0 = c.pos.y - COIN_R; // query decks from before the move (a fast fall can't skip a deck top)
          c.vel.y -= 22 * dt;
          c.pos.addScaledVector(c.vel, dt);
          const floor = this.floor(c.pos.x, c.pos.z, Math.max(y0, c.pos.y - COIN_R));
          if (c.pos.y < floor) {
            c.pos.y = floor;
            if (c.vel.y < -2.2) {
              c.vel.y *= -0.45;
              c.vel.x *= 0.6;
              c.vel.z *= 0.6;
            } else {
              c.grounded = true;
              c.vel.set(0, 0, 0);
            }
          }
          y = c.pos.y;
        } else {
          const terr = ctx.terrain;
          if (terr && terr.active && !c.settled) {
            // Roll with the slope (settles where the ground is flat enough for friction to win).
            if (terr.decks.length) {
              terr.surfaceAt(c.pos.x, c.pos.z, c.pos.y - COIN_R, _surf);
              _grad.gx = _surf.gx;
              _grad.gz = _surf.gz;
            } else terr.groundGrad(c.pos.x, c.pos.z, _grad);
            if (Math.abs(_grad.gx) + Math.abs(_grad.gz) < COIN_STATIC && Math.abs(c.vel.x) + Math.abs(c.vel.z) < 0.05) c.settled = true;
            const k = terr.gravity * COIN_ROLL * dt;
            c.vel.x -= _grad.gx * k;
            c.vel.z -= _grad.gz * k;
            const f = Math.exp(-COIN_FRICTION * dt);
            c.vel.x *= f;
            c.vel.z *= f;
            if (Math.abs(c.vel.x) + Math.abs(c.vel.z) > 0.02) {
              c.pos.x = Math.min(ARENA.maxX - 1, Math.max(ARENA.minX + 1, c.pos.x + c.vel.x * dt));
              c.pos.z = Math.min(ARENA.maxZ - 1, Math.max(ARENA.minZ + 1, c.pos.z + c.vel.z * dt));
            }
          }
          const floor = this.floor(c.pos.x, c.pos.z, c.pos.y - COIN_R);
          if (floor < c.pos.y - 0.3 && terr && terr.decks.length) {
            // Rolled off a deck edge: fall.
            c.grounded = false;
            c.settled = false;
          } else c.pos.y = floor;
          y = c.pos.y + 0.15 + Math.sin(t * 3 + c.phase) * 0.12;
        }
      }
      c.spin += dt * (c.homing ? 14 : 3.5);
      const pop = Math.min(1, c.age * 6);
      const scl = (0.8 + Math.min(1.2, c.value / 12) * 0.35) * pop;
      this.dummy.position.set(c.pos.x, y, c.pos.z);
      this.dummy.rotation.set(0, c.spin, 0);
      this.dummy.scale.setScalar(scl);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      maxIdx = i;
    }
    this.mesh.count = maxIdx + 1;
    this.mesh.visible = maxIdx >= 0;
    if (maxIdx >= 0) {
      // Only the drawn prefix changed; the slots above it are hidden and never drawn.
      const im = this.mesh.instanceMatrix;
      im.clearUpdateRanges();
      im.addUpdateRange(0, (maxIdx + 1) * 16);
      im.needsUpdate = true;
    }
  }

  /** Resting height of a coin's centre at (x, z) for a coin whose bottom is at height y (decks: the surface under it). */
  private floor(x: number, z: number, y: number): number {
    const snow = this.ctx.snow;
    const terr = this.ctx.terrain;
    if (terr && terr.decks.length) {
      // Height only (no gradient / material). Snow lies on the ground layer only.
      const h = terr.heightAt(x, z, y);
      return h + (snow && terr.heightDeck < 0 ? snow.getDepth(x, z) : 0) + COIN_R;
    }
    return (snow ? snow.topAt(x, z) : 0) + COIN_R;
  }
}
