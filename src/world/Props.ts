import * as THREE from 'three';
import { ARENA, ENEMY_GATES, PLOW_SPAWN, type GameContext, type Obstacle } from '../core/types';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mulberry32 } from '../meta/daily';
import { getPropSkin, PROP_SKIN_KEYS, type PropSkin, type PropSkinKey } from './propSkins';

/**
 * Destructible props: crates and blocks scattered around the arena (dressed per arena by propSkins.ts). Deliberately cheap: exactly two
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
  /** Terrain ground height under the prop (0 on flat arenas). */
  y: number;
}

/** Props never stand on lava or on slopes steeper than this gradient (they would float off the hillside). */
const MAX_PROP_GRAD = 0.45;
const _g = { gx: 0, gz: 0 };

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
const _c = new THREE.Color();
/** Props sit this far (in prop half-sizes) into the ground, so none hovers on a gentle slope. */
const SINK = 0.08;

export class Props {
  private props: Prop[] = [];
  private meshes: Record<Kind, THREE.InstancedMesh>;
  private obstacles: Obstacle[] | null = null;
  private coins = false;

  private skin: PropSkin;

  constructor(private ctx: GameContext) {
    // Chamfered 2 m box (same bounds as the old plain box): the bevel catches a highlight on every edge.
    const box = new RoundedBoxGeometry(2, 2, 2, 1, 0.14);
    box.translate(0, 1, 0);
    // every arena's skin up front (a few small canvases): material / texture creation draws Math.random for uuids, so
    // doing it here keeps each arena load drawing the same number every visit (deterministic probes / replays)
    for (const k of PROP_SKIN_KEYS) getPropSkin(k);
    this.skin = getPropSkin('classic');
    const crate = new THREE.InstancedMesh(box, this.skin.crate, MAX_PER_KIND);
    const ice = new THREE.InstancedMesh(box, this.skin.ice, MAX_PER_KIND);
    this.meshes = { crate, ice };
    for (const m of [crate, ice]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.count = 0;
      m.frustumCulled = false;
      // per-instance tint (white except on The Thermal Divide's split skin)
      for (let i = 0; i < MAX_PER_KIND; i++) m.setColorAt(i, _c.set(0xffffff));
      ctx.scene.add(m);
    }
  }

  /** Dress the props for an arena (Environment.resetProps): materials + debris colours only. */
  private setSkin(key: PropSkinKey): void {
    this.skin = getPropSkin(key);
    this.meshes.crate.material = this.skin.crate;
    this.meshes.ice.material = this.skin.ice;
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
  reset(obstacles: Obstacle[], on: boolean, seed: number, brawl: boolean, coins: boolean, skin: PropSkinKey = 'classic'): void {
    this.setSkin(skin);
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
          const y = this.groundSpot(x, z, r);
          if (y === null) continue;
          const obs: Obstacle = { x, z, r, breakable: true };
          this.props.push({ kind, slot: used[kind]++, x, z, s, yaw: rnd() * Math.PI, alive: true, obs, y });
          obstacles.push(obs);
          fixed.push(obs);
        }
      }
    }
    this.meshes.crate.count = used.crate;
    this.meshes.ice.count = used.ice;
    const split = this.skin.split;
    for (const p of this.props) {
      this.place(p);
      const hot = p.x < 0;
      const tint = !split ? 0xffffff : p.kind === 'crate' ? (hot ? split.crateHot : split.crateCold) : (hot ? split.iceHot : split.iceCold);
      this.meshes[p.kind].setColorAt(p.slot, _c.set(tint));
    }
    for (const m of [this.meshes.crate, this.meshes.ice]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
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

  /** Terrain height for a prop of radius r at (x, z), or null where it can't stand: touching lava (centre + 8 points
   *  on its rim, with a little margin), on or next to a deck, a ramp's run-up / launch / landing corridor, a steep
   *  slope. Flat arenas: 0. */
  private groundSpot(x: number, z: number, r: number): number | null {
    const t = this.ctx.terrain;
    if (!t) return 0;
    if (t.patches.length) {
      if (t.materialAt(x, z) === 'lava') return null;
      const rr = r + 0.4;
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        if (t.materialAt(x + Math.cos(a) * rr, z + Math.sin(a) * rr) === 'lava') return null;
      }
    }
    // never in or against a deck (PROTOCOL C's low decks and their ramps): a crate would poke through the slab
    for (const d of t.decks) if (t.inDeck(d, x, z, r + 0.8)) return null;
    if (!t.active) return 0;
    for (const sh of t.shapes) {
      if (sh.kind !== 'ramp') continue;
      const dx = x - sh.x;
      const dz = z - sh.z;
      const v = dx * Math.sin(sh.rot) + dz * Math.cos(sh.rot);
      const u = dx * Math.cos(sh.rot) - dz * Math.sin(sh.rot);
      if (Math.abs(u) < sh.w / 2 + r + 0.5 && v > -5 - r && v < sh.len + (sh.fall ?? 1) + 7 + r) return null;
    }
    t.groundGrad(x, z, _g);
    if (_g.gx * _g.gx + _g.gz * _g.gz > MAX_PROP_GRAD * MAX_PROP_GRAD) return null;
    return t.ground(x, z);
  }

  private place(p: Prop): void {
    _q.setFromAxisAngle(_up, p.yaw);
    _m.compose(_v.set(p.x, p.y - SINK * p.s, p.z), _q, _s.setScalar(p.s));
    this.meshes[p.kind].setMatrixAt(p.slot, _m);
  }

  /** Break one prop: hide its instance, drop its collider, debris + sound (+ a couple of coins). */
  private smash(p: Prop, coins = true): void {
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
    _v.set(p.x, p.y + p.s, p.z);
    const [c0, c1] = p.kind === 'crate' ? this.skin.crateDebris : this.skin.iceDebris;
    if (p.kind === 'crate') {
      fx.burst(_v, { color: c0, count: 16, speed: 8, size: 0.28, gravity: 18, life: 0.8 });
      fx.burst(_v, { color: c1, count: 8, speed: 6, size: 0.2, gravity: 18, life: 0.7 });
    } else {
      fx.burst(_v, { color: c0, count: 18, speed: 9, size: 0.24, gravity: 18, life: 0.7 });
      fx.burst(_v, { color: c1, count: 10, speed: 5, size: 0.16, gravity: 10, life: 0.5 });
    }
    fx.smoke(_v, { count: 2, color: 0xe2ecf8, size: 0.8, grow: 2.5, life: 0.7, speed: 1.5, up: 1, rise: -0.5, drag: 2, spread: 0.5, opacity: 0.45 });
    this.ctx.audio?.play('wallHit', { volume: 0.55, pitch: p.kind === 'ice' ? 1.35 : 0.9 });
    if (coins && this.coins) this.ctx.pickups?.spawnCoins(_v.set(p.x, p.y + 0.5, p.z), PROP_COINS);
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

  /** Break the prop that owns this collider (rams / dashes / bots). False if it isn't a standing prop. `coins`
   *  false skips the coin drop (a bot broke it on its own). */
  breakObstacle(o: Obstacle, coins = true): boolean {
    if (!o.breakable) return false;
    const p = this.props.find((q) => q.obs === o);
    if (!p || !p.alive) return false;
    this.smash(p, coins);
    return true;
  }

  /** Standing props (tests / debug). */
  get standing(): number {
    let n = 0;
    for (const p of this.props) if (p.alive) n++;
    return n;
  }
}
