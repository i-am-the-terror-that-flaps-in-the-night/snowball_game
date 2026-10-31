import * as THREE from 'three';
import { ARENA, ENEMY_GATES, PLOW_SPAWN, type GameContext, type Obstacle } from '../core/types';
import { mulberry32 } from '../meta/daily';

/**
 * Destructible props: wooden crates and ice blocks scattered around the arena. Deliberately cheap: exactly two
 * states (standing / destroyed), no HP, no physics. All props of a kind are ONE InstancedMesh (destroyed = a
 * zero-scale matrix), each standing prop is a circle collider in world.obstacles, and breaking one is a one-off
 * debris burst. Player attacks call blast() / blastRay(); ramming or dashing into a prop breaks it (Plow).
 */

type Kind = 'crate' | 'ice';

interface Prop {
  kind: Kind;
  /** Index inside its kind's InstancedMesh. */
  slot: number;
  x: number;
  z: number;
  /** Half size (m) and yaw, for rebuilding the matrix on reset. */
  s: number;
  yaw: number;
  alive: boolean;
  obs: Obstacle;
}

const MAX_PER_KIND = 24;
/** Props per arena: campaign / Survival arenas, the much bigger Brawl Snowdome. */
const COUNT_ARENA = 14;
const COUNT_BRAWL = 26;
/** Coins dropped by a broken crate / ice block (campaign + Survival only). */
const PROP_COINS = 2;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function crateTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#a8743f';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#8a5a2c';
  for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 2);
  g.strokeStyle = '#5a3a1a';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 58, 58);
  g.beginPath();
  g.moveTo(6, 6);
  g.lineTo(58, 58);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Props {
  private props: Prop[] = [];
  private meshes: Record<Kind, THREE.InstancedMesh>;
  private obstacles: Obstacle[] | null = null;
  private coins = false;

  constructor(private ctx: GameContext) {
    const box = new THREE.BoxGeometry(2, 2, 2);
    box.translate(0, 1, 0);
    const crate = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ map: typeof document === 'undefined' ? null : crateTexture(), color: typeof document === 'undefined' ? 0xa8743f : 0xffffff, roughness: 0.8 }), MAX_PER_KIND);
    const ice = new THREE.InstancedMesh(
      box,
      new THREE.MeshStandardMaterial({ color: 0x9fdcff, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.82, emissive: 0x1a5a8a, emissiveIntensity: 0.25 }),
      MAX_PER_KIND,
    );
    this.meshes = { crate, ice };
    for (const m of [crate, ice]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.count = 0;
      m.frustumCulled = false;
      ctx.scene.add(m);
    }
  }

  /** Remove every prop (setZone calls this; the arena's obstacle list is about to be rebuilt anyway). */
  clear(): void {
    this.props.length = 0;
    this.obstacles = null;
    this.meshes.crate.count = this.meshes.ice.count = 0;
  }

  /**
   * (Re)build the props for the current arena into `obstacles` (world.obstacles), all standing. `on` false = none
   * (Duel, Tutorial, menus). Layout is deterministic per arena, avoiding the plow spawn, the gate lanes and
   * existing obstacles.
   */
  reset(obstacles: Obstacle[], on: boolean, seed: number, brawl: boolean, coins: boolean): void {
    // Drop our old colliders from the list by identity, then start over.
    for (const p of this.props) {
      const i = obstacles.indexOf(p.obs);
      if (i >= 0) obstacles.splice(i, 1);
    }
    this.props.length = 0;
    this.obstacles = obstacles;
    this.coins = coins;
    const used: Record<Kind, number> = { crate: 0, ice: 0 };
    if (on) {
      const rnd = mulberry32(seed);
      const half = ARENA.maxX;
      const want = brawl ? COUNT_BRAWL : COUNT_ARENA;
      const fixed = obstacles.slice();
      for (let tries = 0; this.props.length < want && tries < want * 40; tries++) {
        // Small clusters: pick a spot, then a few props around it.
        const a = rnd() * Math.PI * 2;
        const rr = half * (0.3 + rnd() * 0.58);
        const cx = Math.sin(a) * rr;
        const cz = Math.cos(a) * rr;
        const n = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < n && this.props.length < want; k++) {
          const kind: Kind = rnd() < 0.55 ? 'crate' : 'ice';
          if (used[kind] >= MAX_PER_KIND) continue;
          const s = kind === 'crate' ? 0.6 + rnd() * 0.15 : 0.65 + rnd() * 0.2;
          const x = cx + (rnd() - 0.5) * 4;
          const z = cz + (rnd() - 0.5) * 4;
          const r = s * 1.25;
          if (!this.clearSpot(x, z, r, half, fixed)) continue;
          const obs: Obstacle = { x, z, r, breakable: true };
          this.props.push({ kind, slot: used[kind]++, x, z, s, yaw: rnd() * Math.PI, alive: true, obs });
          obstacles.push(obs);
          fixed.push(obs);
        }
      }
    }
    this.meshes.crate.count = used.crate;
    this.meshes.ice.count = used.ice;
    for (const p of this.props) this.place(p);
    this.meshes.crate.instanceMatrix.needsUpdate = this.meshes.ice.instanceMatrix.needsUpdate = true;
  }

  private clearSpot(x: number, z: number, r: number, half: number, fixed: Obstacle[]): boolean {
    if (Math.abs(x) > half - 3 - r || Math.abs(z) > half - 3 - r) return false;
    if (Math.hypot(x - PLOW_SPAWN.x, z - PLOW_SPAWN.z) < 8 + r) return false;
    if (Math.hypot(x, z) < 6 + r) return false;
    for (const g of ENEMY_GATES) {
      // Keep the lane in from each gate open (gate -> arena centre, first ~14 m).
      const gx = Math.sign(g.x) * Math.min(Math.abs(g.x), half);
      const gz = Math.sign(g.z) * Math.min(Math.abs(g.z), half);
      if (Math.hypot(x - gx, z - gz) < 14 + r) return false;
    }
    for (const o of fixed) if (Math.hypot(x - o.x, z - o.z) < o.r + r + 1.2) return false;
    return true;
  }

  private place(p: Prop): void {
    _q.setFromAxisAngle(_up, p.yaw);
    _m.compose(_v.set(p.x, 0, p.z), _q, _s.setScalar(p.s));
    this.meshes[p.kind].setMatrixAt(p.slot, _m);
  }

  /** Break one prop: hide its instance, drop its collider, debris + sound (+ a couple of coins). */
  private smash(p: Prop): void {
    if (!p.alive) return;
    p.alive = false;
    const mesh = this.meshes[p.kind];
    mesh.setMatrixAt(p.slot, ZERO);
    mesh.instanceMatrix.needsUpdate = true;
    const obs = this.obstacles;
    if (obs) {
      const i = obs.indexOf(p.obs);
      if (i >= 0) obs.splice(i, 1);
    }
    const fx = this.ctx.fx;
    _v.set(p.x, p.s, p.z);
    if (p.kind === 'crate') {
      fx.burst(_v, { color: 0xa8743f, count: 16, speed: 8, size: 0.28, gravity: 18, life: 0.8 });
      fx.burst(_v, { color: 0x5a3a1a, count: 8, speed: 6, size: 0.2, gravity: 18, life: 0.7 });
    } else {
      fx.burst(_v, { color: 0xbfe8ff, count: 18, speed: 9, size: 0.24, gravity: 18, life: 0.7 });
      fx.burst(_v, { color: 0xffffff, count: 10, speed: 5, size: 0.16, gravity: 10, life: 0.5 });
    }
    fx.smoke(_v, { count: 2, color: 0xe2ecf8, size: 0.8, grow: 2.5, life: 0.7, speed: 1.5, up: 1, rise: -0.5, drag: 2, spread: 0.5, opacity: 0.45 });
    this.ctx.audio?.play('wallHit', { volume: 0.55, pitch: p.kind === 'ice' ? 1.35 : 0.9 });
    if (this.coins) this.ctx.pickups?.spawnCoins(_v.set(p.x, 0.5, p.z), PROP_COINS);
  }

  /** Break every standing prop overlapping the circle. Returns how many broke. */
  blast(x: number, z: number, r: number): number {
    let n = 0;
    for (const p of this.props) {
      if (!p.alive) continue;
      const rr = r + p.obs.r;
      const dx = p.x - x;
      const dz = p.z - z;
      if (dx * dx + dz * dz <= rr * rr) {
        this.smash(p);
        n++;
      }
    }
    return n;
  }

  /** First standing prop along the ray from (x, z) (unit dir), within `range`: break it and return the distance
   *  to it, or -1. */
  blastRay(x: number, z: number, dx: number, dz: number, range: number): number {
    let best: Prop | null = null;
    let bestT = range;
    for (const p of this.props) {
      if (!p.alive) continue;
      const t = (p.x - x) * dx + (p.z - z) * dz;
      if (t < 0 || t > bestT) continue;
      const off = Math.abs((p.x - x) * dz - (p.z - z) * dx);
      if (off <= p.obs.r && t < bestT) {
        bestT = t;
        best = p;
      }
    }
    if (!best) return -1;
    this.smash(best);
    return bestT;
  }

  /** Break the prop that owns this collider (rams / dashes). False if it isn't a standing prop. */
  breakObstacle(o: Obstacle): boolean {
    if (!o.breakable) return false;
    const p = this.props.find((q) => q.obs === o);
    if (!p || !p.alive) return false;
    this.smash(p);
    return true;
  }

  /** Standing props (tests / debug). */
  get standing(): number {
    let n = 0;
    for (const p of this.props) if (p.alive) n++;
    return n;
  }
}
