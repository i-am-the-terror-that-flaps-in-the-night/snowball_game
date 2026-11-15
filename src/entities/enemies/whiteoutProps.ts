import * as THREE from 'three';
import type { GameContext } from '../../core/types';
import { currentPreset, scaleCount } from '../../core/settings';
import type { Bot } from './Bot';
import { DecalPool, type Decal } from './decals';
import { M } from './models';
import { waveHitPlow } from '../combat/shared';
import { softPuffTexture } from '../../fx/particles';
import { standIns } from '../../render/standIns';
import { whiteoutGiant } from '../../world/protocol/WhiteoutGiant';
import { WO } from '../../config/whiteout';

/* THE WHITEOUT's attacks on the floor (PROTOCOL C finale), driven by core/whiteoutDirector.ts. Every one is telegraphed
 * and pooled, built once per scene (prewarm, hidden: the warm-up compiles them), no per-frame allocation:
 *  - ICE SHARD RAIN: a deep-blue ring fills on each landing spot for the whole telegraph; in its last SHARD_FALL s a
 *    jagged ice spike drops out of the storm onto it (damage inside the ring), then stands SHARD_STAY s as an obstacle
 *    the plow bumps off, and bursts.
 *  - VORTEX ARM: a violet chevron lane across the arena fills, then the giant's arm plants its funnel at the lane's
 *    start and runs it to the end (one hit + a big knock off the lane), scouring a trench in the snow.
 *  - GUST: streaks of snow blowing across the arena (faint while it builds, a torrent while it blows): the plow is
 *    pushed along (no damage).
 *  - GLARE: the eye charges (a thin flickering beam), then a pale spot (ring + glow) slides after the plow along a beam
 *    from the eye: caught = a daze, the plow encased in frost for its length.
 * Damage goes through waveHitPlow with the EYE bot as the attacker (its outgoing scaling: the zone's damage x). */

const MAX_SHARDS = 16;
const MAX_LANES = 2;
/** Streak quads in a full gust (HIGH; LOW halves). */
const STREAKS = 90;
const SHARD_RING = 0x1f6dff;
const LANE_COL = 0x7a4dff;
const GLARE_COL = 0xbff8ff;
/** Height the shards fall from (m) and the obstacle radius of a standing shard. */
const SHARD_DROP = 30;
const SHARD_BODY = 0.95;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);

interface Shard {
  active: boolean;
  x: number;
  z: number;
  /** Telegraph left (s) of its total `tele`; then it stands `stay` s. */
  wait: number;
  tele: number;
  stay: number;
  spin: number;
  owner: Bot | null;
  dmg: number;
  ring: Decal | null;
  fill: Decal | null;
}

interface Lane {
  active: boolean;
  arm: number;
  x0: number;
  z0: number;
  dx: number;
  dz: number;
  len: number;
  /** Telegraph left of `tele`, then the run (`t` of `dur`). */
  wait: number;
  tele: number;
  t: number;
  dur: number;
  hit: boolean;
  owner: Bot | null;
  dmg: number;
  knock: number;
  puffT: number;
  stripe: Decal | null;
}

interface Gust {
  dx: number;
  dz: number;
  wait: number;
  tele: number;
  t: number;
  dur: number;
  frac: number;
}

interface Glare {
  x: number;
  z: number;
  charge: number;
  chargeDur: number;
  t: number;
  speed: number;
  done: boolean;
  owner: Bot | null;
}

class WhiteoutProps {
  private ctx: GameContext | null = null;
  private builtFor: THREE.Scene | null = null;
  private decals: DecalPool | null = null;
  private shards: Shard[] = [];
  private shardMesh: THREE.InstancedMesh | null = null;
  private lanes: Lane[] = [];
  private gust: Gust | null = null;
  private streaks: THREE.InstancedMesh | null = null;
  private streakMat: THREE.MeshBasicMaterial | null = null;
  /** Per streak: lateral offset, height, phase along, length, speed share (fixed at build). */
  private streakA = new Float32Array(STREAKS * 5);
  private glare: Glare | null = null;
  private glareRing: Decal | null = null;
  private glareFill: Decal | null = null;
  private beam: THREE.Mesh | null = null;
  private beamMat: THREE.MeshBasicMaterial | null = null;
  private spot: THREE.Sprite | null = null;
  private frost: THREE.Mesh | null = null;
  private frostT = 0;
  private time = 0;
  /** A shard landed at (x, z) (THE AVALANCHE: the director chips the giant snowball with it). */
  onShardLand: ((x: number, z: number) => void) | null = null;

  private depth = (x: number, z: number): number => (this.ctx?.snow ? this.ctx.snow.getDepth(x, z) : 0);

  prewarm(scene: THREE.Scene): void {
    this.build(scene);
  }

  private init(ctx: GameContext): void {
    if (this.ctx === ctx && this.builtFor === ctx.scene) return;
    this.ctx = ctx;
    this.build(ctx.scene);
  }

  private build(scene: THREE.Scene): void {
    if (this.builtFor === scene) return;
    this.builtFor = scene;
    this.decals = new DecalPool(scene);
    this.shards.length = 0;
    this.lanes.length = 0;
    for (let i = 0; i < MAX_SHARDS; i++) this.shards.push({ active: false, x: 0, z: 0, wait: 0, tele: 1, stay: 0, spin: 0, owner: null, dmg: 0, ring: null, fill: null });
    for (let i = 0; i < MAX_LANES; i++) {
      this.lanes.push({ active: false, arm: i, x0: 0, z0: 0, dx: 0, dz: 1, len: 1, wait: 0, tele: 1, t: 0, dur: 1, hit: false, owner: null, dmg: 0, knock: 0, puffT: 0, stripe: null });
    }
    // an ice spike: a tall jagged crystal with two side splinters, point down
    const spike = new THREE.OctahedronGeometry(1, 0);
    spike.scale(0.75, 2.3, 0.75);
    spike.translate(0, 1.6, 0);
    const shardMat = new THREE.MeshStandardMaterial({ color: 0xdaf2ff, roughness: 0.12, metalness: 0.1, emissive: 0x3a8cff, emissiveIntensity: 0.9, flatShading: true });
    this.shardMesh = new THREE.InstancedMesh(spike, shardMat, MAX_SHARDS);
    this.shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shardMesh.count = 0;
    this.shardMesh.castShadow = true;
    this.shardMesh.frustumCulled = false;
    this.shardMesh.visible = false;
    scene.add(this.shardMesh);
    // gust streaks: thin long planes lying along the wind
    this.streakMat = new THREE.MeshBasicMaterial({ color: 0xf2f8ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const sg = new THREE.PlaneGeometry(1, 0.09);
    this.streaks = new THREE.InstancedMesh(sg, this.streakMat, STREAKS);
    this.streaks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.streaks.count = 0;
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;
    this.streaks.renderOrder = 6;
    scene.add(this.streaks);
    for (let i = 0; i < STREAKS; i++) {
      const o = i * 5;
      this.streakA[o] = ((i * 0.618034) % 1) * 2 - 1;
      this.streakA[o + 1] = 0.3 + ((i * 0.381966) % 1) * 3.2;
      this.streakA[o + 2] = (i * 0.7548777) % 1;
      this.streakA[o + 3] = 2.5 + ((i * 0.5698403) % 1) * 4;
      this.streakA[o + 4] = 0.75 + ((i * 0.245) % 1) * 0.5;
    }
    // glare: beam from the eye + a glow on the spot
    this.beamMat = new THREE.MeshBasicMaterial({ color: GLARE_COL, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).translate(0, 0.5, 0), this.beamMat);
    this.beam.frustumCulled = false;
    this.beam.visible = false;
    this.beam.renderOrder = 7;
    scene.add(this.beam);
    this.spot = new THREE.Sprite(new THREE.SpriteMaterial({ map: softPuffTexture(), color: 0xaef2ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }));
    this.spot.visible = false;
    this.spot.renderOrder = 8;
    scene.add(this.spot);
    // frost shell on a dazed plow (the frozen-bot crust material: same program)
    this.frost = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), M.ice());
    this.frost.visible = false;
    this.frost.renderOrder = 5;
    scene.add(this.frost);
    const d = this.decals;
    for (const x of [d.ring(false), d.ring(true), d.stripe()]) d.release(x);
  }

  /* ------------------------------------------------------------------ API */

  /** Shards waiting / falling / standing. */
  get shardsLive(): number {
    let n = 0;
    for (const s of this.shards) if (s.active) n++;
    return n;
  }
  /** Standing shards (obstacles) right now. */
  get shardsStanding(): number {
    let n = 0;
    for (const s of this.shards) if (s.active && s.wait <= 0) n++;
    return n;
  }
  get lanesLive(): number {
    let n = 0;
    for (const l of this.lanes) if (l.active) n++;
    return n;
  }
  get gustInfo(): Readonly<Gust> | null {
    return this.gust;
  }
  get glareInfo(): Readonly<Glare> | null {
    return this.glare;
  }
  /** A shard's telegraph state (tests): wait left and total. */
  shardAt(i: number): Readonly<Shard> | undefined {
    return this.shards[i];
  }

  /** One shard onto (x, z): ring for `tele` s (the spike drops in the last SHARD_FALL s), `dmg` raw. False if full. */
  shard(ctx: GameContext, owner: Bot, x: number, z: number, tele: number, dmg: number): boolean {
    this.init(ctx);
    const s = this.shards.find((k) => !k.active);
    if (!s) return false;
    s.active = true;
    s.x = x;
    s.z = z;
    s.wait = s.tele = Math.max(WO.SHARD_FALL + 0.1, tele);
    s.stay = WO.SHARD_STAY;
    s.spin = (x * 7.3 + z * 3.1) % 6.28;
    s.owner = owner;
    s.dmg = dmg;
    s.ring = this.decals!.ring(false);
    s.fill = this.decals!.ring(true);
    return true;
  }

  /** A vortex-arm lane from (x0, z0) along unit (dx, dz) for `len` m: telegraph `tele` s, then the run `dur` s. */
  sweep(ctx: GameContext, owner: Bot, arm: number, x0: number, z0: number, dx: number, dz: number, len: number, tele: number, dur: number, dmg: number, knock: number): boolean {
    this.init(ctx);
    const l = this.lanes.find((k) => !k.active);
    if (!l) return false;
    Object.assign(l, { active: true, arm, x0, z0, dx, dz, len, wait: tele, tele: Math.max(1e-3, tele), t: 0, dur: Math.max(0.1, dur), hit: false, owner, dmg, knock, puffT: 0 });
    l.stripe = this.decals!.stripe();
    whiteoutGiant.armTarget[arm].set(x0, 0, z0);
    return true;
  }

  /** A gust along unit (dx, dz): streaks build for `tele` s, then it pushes at `frac` x top speed for `dur` s. */
  startGust(ctx: GameContext, dx: number, dz: number, tele: number, dur: number, frac: number): void {
    this.init(ctx);
    this.gust = { dx, dz, wait: tele, tele: Math.max(1e-3, tele), t: dur, dur, frac };
  }

  /** A glare: the eye charges `charge` s, then the spot starts at (x, z) and chases the plow for `dur` s. */
  startGlare(ctx: GameContext, owner: Bot, x: number, z: number, charge: number, dur: number, speed: number): void {
    this.init(ctx);
    this.glare = { x, z, charge, chargeDur: Math.max(1e-3, charge), t: dur, speed, done: false, owner };
    this.glareRing ??= this.decals!.ring(false);
    this.glareFill ??= this.decals!.ring(true);
  }

  /** Is a glare charging (the eye glows) / on? */
  get glaring(): number {
    const g = this.glare;
    if (!g) return 0;
    return g.charge > 0 ? 1 - g.charge / g.chargeDur : 1;
  }

  /** Drop the main attacks in progress (a STAGGER starts): telegraphs vanish, standing shards stay to burst. */
  calm(): void {
    for (const s of this.shards) if (s.active && s.wait > 0) this.dropShard(s);
    for (const l of this.lanes) if (l.active) this.dropLane(l);
    this.glare = null;
    this.gust = null;
  }

  clear(): void {
    if (!this.decals) return;
    for (const s of this.shards) this.dropShard(s);
    for (const l of this.lanes) this.dropLane(l);
    this.gust = null;
    this.glare = null;
    this.glareRing = this.decals.release(this.glareRing);
    this.glareFill = this.decals.release(this.glareFill);
    this.decals.clear();
    this.frostT = 0;
    if (this.frost) this.frost.visible = false;
    if (this.beam) this.beam.visible = false;
    if (this.spot) this.spot.visible = false;
    if (this.streaks) {
      this.streaks.visible = false;
      this.streaks.count = 0;
    }
    this.syncShards();
  }

  /* ------------------------------------------------------------------ per frame */

  update(ctx: GameContext, dt: number): void {
    this.init(ctx);
    this.time += dt;
    this.updateShards(ctx, dt);
    this.updateLanes(ctx, dt);
    this.updateGust(ctx, dt);
    this.updateGlare(ctx, dt);
    this.updateFrost(ctx, dt);
    this.decals!.update(dt, this.depth);
  }

  private dropShard(s: Shard): void {
    s.active = false;
    s.owner = null;
    s.ring = this.decals!.release(s.ring);
    s.fill = this.decals!.release(s.fill);
  }

  private dropLane(l: Lane): void {
    l.active = false;
    l.owner = null;
    l.stripe = this.decals!.release(l.stripe);
    whiteoutGiant.armReach[l.arm] = 0;
  }

  private updateShards(ctx: GameContext, dt: number): void {
    const plow = ctx.plow;
    const fx = ctx.fx;
    for (const s of this.shards) {
      if (!s.active) continue;
      if (s.wait > 0) {
        s.wait -= dt;
        const p = 1 - Math.max(0, s.wait) / s.tele;
        const ring = s.ring!;
        const fill = s.fill!;
        ring.x = fill.x = s.x;
        ring.z = fill.z = s.z;
        ring.r0 = WO.SHARD_R - 0.38;
        ring.r1 = WO.SHARD_R;
        fill.r0 = 0;
        fill.r1 = WO.SHARD_R * p;
        ring.mat.color.setHex(SHARD_RING);
        fill.mat.color.setHex(SHARD_RING);
        ring.mat.opacity = 0.95 * (0.7 + 0.3 * Math.sin(this.time * 24 + s.spin));
        fill.mat.opacity = 0.3 + 0.35 * p;
        if (s.wait <= 0) this.landShard(ctx, s);
        continue;
      }
      s.stay -= dt;
      // standing: the plow bumps off it
      if (!plow.dead) {
        const dx = plow.position.x - s.x;
        const dz = plow.position.z - s.z;
        const min = SHARD_BODY + plow.radius * 0.8;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && plow.position.y < 3) {
          const d = Math.sqrt(d2);
          // dead centre: back out the way it came
          const nx = d > 1e-3 ? dx / d : -Math.sin(plow.heading);
          const nz = d > 1e-3 ? dz / d : -Math.cos(plow.heading);
          plow.position.x = s.x + nx * min;
          plow.position.z = s.z + nz * min;
          const into = -(Math.sin(plow.heading) * nx + Math.cos(plow.heading) * nz);
          if (into > 0.3 && plow.speed > 0) plow.speed *= 0.6;
        }
      }
      if (s.stay <= 0) {
        _v.set(s.x, this.depth(s.x, s.z) + 1.4, s.z);
        fx.burst(_v, SHARD_BREAK);
        fx.burst(_v, SHARD_GLINT);
        this.dropShard(s);
      }
    }
    this.syncShards();
  }

  private landShard(ctx: GameContext, s: Shard): void {
    const fx = ctx.fx;
    const plow = ctx.plow;
    s.ring = this.decals!.release(s.ring);
    s.fill = this.decals!.release(s.fill);
    _v.set(s.x, this.depth(s.x, s.z) + 0.3, s.z);
    fx.powder(_v, { size: 1.1, color: 0xeaf6ff });
    fx.burst(_v, SHARD_HIT);
    fx.ring(_v, WO.SHARD_R, 0x7fc8ff);
    fx.shake(0.22);
    ctx.audio?.play('clash', { volume: 0.55, pitch: 1.35 });
    this.onShardLand?.(s.x, s.z);
    if (s.owner && !plow.dead && Math.hypot(plow.position.x - s.x, plow.position.z - s.z) < WO.SHARD_R + plow.radius * 0.4 && plow.position.y < 2.5) {
      waveHitPlow(ctx, s.owner, s.dmg, { knockback: 6, unblockable: true, fromX: s.x, fromZ: s.z });
    }
  }

  private syncShards(): void {
    const im = this.shardMesh;
    if (!im) return;
    let n = 0;
    for (const s of this.shards) {
      if (!s.active) continue;
      const fallLeft = s.wait;
      if (fallLeft > WO.SHARD_FALL) continue;
      // falling: from SHARD_DROP down onto the ring; standing: planted, tilted, bursting at the end
      const k = fallLeft > 0 ? 1 - fallLeft / WO.SHARD_FALL : 1;
      const y = this.depth(s.x, s.z) - 0.4 + (1 - k * k) * SHARD_DROP;
      _p.set(s.x, y, s.z);
      _q.setFromEuler(_e.set(0.18 * Math.sin(s.spin), s.spin, 0.15 * Math.cos(s.spin)));
      const sc = fallLeft > 0 ? 1 : Math.min(1, s.stay / 0.25);
      _m.compose(_p, _q, _s.set(sc, sc, sc));
      im.setMatrixAt(n++, _m);
    }
    im.count = n;
    im.visible = n > 0;
    if (n > 0) im.instanceMatrix.needsUpdate = true;
  }

  private updateLanes(ctx: GameContext, dt: number): void {
    const plow = ctx.plow;
    const fx = ctx.fx;
    for (const l of this.lanes) {
      if (!l.active) continue;
      const st = l.stripe!;
      st.x = l.x0;
      st.z = l.z0;
      st.dx = l.dx;
      st.dz = l.dz;
      st.len = l.len;
      st.w = WO.SWEEP_HW * 2;
      st.mat.color.setHex(LANE_COL);
      const arm = whiteoutGiant.armTarget[l.arm];
      if (l.wait > 0) {
        l.wait -= dt;
        const p = 1 - Math.max(0, l.wait) / l.tele;
        st.mat.opacity = 0.45 + 0.4 * p * (0.75 + 0.25 * Math.sin(this.time * 20));
        // the arm lifts and aims at the lane's start
        whiteoutGiant.armReach[l.arm] = Math.min(0.85, p * 1.1);
        arm.set(l.x0, 0, l.z0);
        continue;
      }
      l.t += dt;
      const k = Math.min(1, l.t / l.dur);
      const cx = l.x0 + l.dx * l.len * k;
      const cz = l.z0 + l.dz * l.len * k;
      arm.set(cx, 0, cz);
      whiteoutGiant.armReach[l.arm] = 1;
      st.mat.opacity = 0.35 * (1 - k);
      // the funnel scours the snow and throws powder
      if ((l.puffT -= dt) <= 0) {
        l.puffT = 0.06;
        _v.set(cx, this.depth(cx, cz) + 0.2, cz);
        fx.powder(_v, { size: 0.9, color: 0xeaf6ff });
        ctx.snow?.collectDisc(cx, cz, 2.2, 0.55);
      }
      if (!l.hit && l.owner && !plow.dead && plow.position.y < 3.5) {
        const dx = plow.position.x - cx;
        const dz = plow.position.z - cz;
        if (Math.hypot(dx, dz) < WO.SWEEP_HW + plow.radius * 0.6) {
          l.hit = true;
          // thrown off the lane (sideways, a little along it)
          const side = dx * l.dz - dz * l.dx >= 0 ? 1 : -1;
          const fx0 = plow.position.x - (l.dz * side * 2 + l.dx);
          const fz0 = plow.position.z - (-l.dx * side * 2 + l.dz);
          waveHitPlow(ctx, l.owner, l.dmg, { knockback: l.knock, unblockable: true, fromX: fx0, fromZ: fz0 });
          ctx.fx.shake(0.7);
          _v.set(plow.position.x, plow.position.y + 1.5, plow.position.z);
          ctx.fx.burst(_v, SHARD_HIT);
        }
      }
      if (l.t >= l.dur) this.dropLane(l);
    }
  }

  private updateGust(ctx: GameContext, dt: number): void {
    const g = this.gust;
    const im = this.streaks!;
    if (!g) {
      im.visible = false;
      im.count = 0;
      return;
    }
    let dens: number;
    let speed: number;
    if (g.wait > 0) {
      g.wait -= dt;
      const p = 1 - Math.max(0, g.wait) / g.tele;
      dens = 0.25 + 0.35 * p;
      speed = 14 + 10 * p;
    } else {
      g.t -= dt;
      dens = Math.min(1, (g.dur - g.t) / 0.3) * Math.min(1, g.t / 0.5 + 0.2);
      speed = 34;
      const plow = ctx.plow as { tow?(dx: number, dz: number, f: number, dt: number): void };
      if (!ctx.plow.dead) plow.tow?.(g.dx, g.dz, g.frac, dt);
      if (g.t <= 0) {
        this.gust = null;
        im.visible = false;
        im.count = 0;
        return;
      }
    }
    // streaks sweep across the whole floor along the wind, round the plow so they stay in view
    const cap = scaleCount(STREAKS, currentPreset().fxScale);
    const n = Math.min(cap, Math.round(cap * dens));
    const A = this.streakA;
    const px = ctx.plow.position.x;
    const pz = ctx.plow.position.z;
    const rx = -g.dz;
    const rz = g.dx;
    const yaw = Math.atan2(g.dx, g.dz) + Math.PI / 2;
    const span = 56;
    for (let i = 0; i < n; i++) {
      const o = i * 5;
      const along = ((A[o + 2] + (this.time * speed * A[o + 4]) / span) % 1) * span - span / 2;
      const lat = A[o] * 22;
      _p.set(px + g.dx * along + rx * lat, this.depth(px, pz) + A[o + 1], pz + g.dz * along + rz * lat);
      _q.setFromAxisAngle(_up, yaw);
      _m.compose(_p, _q, _s.set(A[o + 3] * (0.6 + dens * 0.8), 1 + dens * 0.6, 1));
      im.setMatrixAt(i, _m);
    }
    im.count = n;
    im.visible = n > 0;
    if (n > 0) im.instanceMatrix.needsUpdate = true;
    this.streakMat!.opacity = 0.35 + 0.45 * dens;
  }

  private updateGlare(ctx: GameContext, dt: number): void {
    const g = this.glare;
    const beam = this.beam!;
    const spot = this.spot!;
    if (!g) {
      beam.visible = spot.visible = false;
      if (this.glareRing) this.glareRing = this.decals!.release(this.glareRing);
      if (this.glareFill) this.glareFill = this.decals!.release(this.glareFill);
      return;
    }
    const plow = ctx.plow;
    const ring = this.glareRing!;
    const fill = this.glareFill!;
    let on = false;
    if (g.charge > 0) {
      g.charge -= dt;
    } else {
      on = true;
      g.t -= dt;
      // slide after the plow (slower than it drives: outrun it, or break line with a hard turn)
      const dx = plow.position.x - g.x;
      const dz = plow.position.z - g.z;
      const dl = Math.hypot(dx, dz);
      if (dl > 0.05) {
        const step = Math.min(dl, g.speed * dt);
        g.x += (dx / dl) * step;
        g.z += (dz / dl) * step;
      }
      if (!g.done && !plow.dead && dl < WO.GLARE_R + plow.radius * 0.3 && plow.position.y < 3) {
        g.done = true;
        plow.daze?.(WO.DAZE);
        this.frostT = WO.DAZE;
        _v.set(plow.position.x, plow.position.y + 1.2, plow.position.z);
        ctx.fx.burst(_v, FROST_HIT);
        ctx.fx.floatText(_v.setY(plow.position.y + 3), 'FROZEN!', '#bff4ff', 1.15);
        ctx.audio?.play('freeze', { volume: 0.9 });
      }
      if (g.t <= 0) {
        this.glare = null;
        return;
      }
    }
    ring.x = fill.x = g.x;
    ring.z = fill.z = g.z;
    ring.r0 = WO.GLARE_R - 0.3;
    ring.r1 = WO.GLARE_R;
    fill.r0 = 0;
    fill.r1 = WO.GLARE_R * (on ? 1 : 1 - g.charge / g.chargeDur);
    ring.mat.color.setHex(GLARE_COL);
    fill.mat.color.setHex(0x5fd8ff);
    ring.mat.opacity = on ? 0.95 : 0.4 + 0.4 * (Math.sin(this.time * 30) > 0 ? 1 : 0);
    fill.mat.opacity = on ? 0.5 : 0.2;
    // the beam from the eye down onto the spot
    whiteoutGiant.eyePos(_p);
    const gy = this.depth(g.x, g.z);
    _v.set(g.x, gy, g.z).sub(_p);
    const len = _v.length();
    beam.visible = len > 0.1;
    beam.position.copy(_p);
    beam.quaternion.setFromUnitVectors(_up, _v.multiplyScalar(1 / Math.max(1e-3, len)));
    const w = on ? 0.34 + 0.08 * Math.sin(this.time * 41) : 0.07;
    beam.scale.set(w, len, w);
    this.beamMat!.opacity = on ? 0.5 : 0.25 + 0.45 * (Math.sin(this.time * 33) > 0 ? 1 : 0);
    spot.visible = on;
    spot.position.set(g.x, gy + 0.5, g.z);
    spot.scale.setScalar(WO.GLARE_R * 2.3 * (1 + 0.08 * Math.sin(this.time * 17)));
    spot.material.opacity = 0.5;
  }

  private updateFrost(ctx: GameContext, dt: number): void {
    const f = this.frost!;
    if (this.frostT <= 0) {
      f.visible = false;
      return;
    }
    this.frostT -= dt;
    const plow = ctx.plow;
    f.visible = !plow.dead;
    const r = plow.radius * 1.25;
    f.position.set(plow.position.x, plow.position.y + r * 0.55, plow.position.z);
    f.scale.set(r, r * 0.75, r * 1.2);
    f.rotation.y = plow.heading;
    if (this.frostT <= 0) {
      _v.set(plow.position.x, plow.position.y + 1, plow.position.z);
      ctx.fx.burst(_v, SHARD_BREAK);
      f.visible = false;
    }
  }

  /** Meshes for the warm-up set (built hidden in the scene by prewarm). */
  /** Visible stand-ins of the pooled props (hidden in the scene until used; build them after prewarm()). */
  warmMeshes(): THREE.Object3D[] {
    return standIns([this.shardMesh, this.streaks, this.beam, this.spot, this.frost]);
  }
}

const SHARD_HIT = { color: 0xbfe8ff, count: 22, speed: 9, size: 0.16, gravity: 14, life: 0.7 };
const SHARD_BREAK = { color: 0xe8f6ff, count: 20, speed: 6, size: 0.2, gravity: 12, life: 0.8 };
const SHARD_GLINT = { color: 0x4ab8ff, count: 10, speed: 5, size: 0.1, gravity: 6, life: 0.5 };
const FROST_HIT = { color: 0xcff6ff, count: 30, speed: 6, size: 0.18, gravity: 4, life: 0.9 };

export const whiteoutProps = new WhiteoutProps();
