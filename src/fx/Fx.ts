import * as THREE from 'three';
import type { FxAPI, GameContext, PowderOpts, SmokeOpts, SmolderOpts, SparkOpts } from '../core/types';
import { MAX_PUFFS, MAX_RINGS, MAX_SCORCH, MAX_SPARKS, PuffBatch, RingBatch, ScorchBatch, SparkBatch } from './particles';

/* Pooled particle effects. Draw calls: chunks (lit icosahedra) + sparks + puffs + rings + scorch, each ONE
 * instanced batch with a fixed cap that is hidden while empty. Only the live prefix of each buffer is uploaded. */

const MAX_P = 3000;
const MAX_TEXT = 48;
const MAX_SMOLDER = 24;
const TEXT_LIFE = 0.9;
/** Gentle constant breeze so smoke columns lean instead of rising dead straight. */
const WIND_X = 0.55;
const WIND_Z = 0.3;

/** Effect pool sizes (reported by probes). */
export const FX_POOLS = { chunks: MAX_P, sparks: MAX_SPARKS, puffs: MAX_PUFFS, rings: MAX_RINGS, scorch: MAX_SCORCH, smolder: MAX_SMOLDER };

interface FloatLabel {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  age: number;
  active: boolean;
}

interface Smolder {
  x: number; y: number; z: number;
  t: number; dur: number; scale: number;
  smokeAcc: number; emberAcc: number; fireAcc: number;
  active: boolean;
}

export class Fx implements FxAPI {
  private ctx: GameContext;
  private mesh: THREE.InstancedMesh;
  private n = 0;
  // particle SoA
  private px = new Float32Array(MAX_P);
  private py = new Float32Array(MAX_P);
  private pz = new Float32Array(MAX_P);
  private vx = new Float32Array(MAX_P);
  private vy = new Float32Array(MAX_P);
  private vz = new Float32Array(MAX_P);
  private age = new Float32Array(MAX_P);
  private life = new Float32Array(MAX_P);
  private size = new Float32Array(MAX_P);
  private grav = new Float32Array(MAX_P);
  private drag = new Float32Array(MAX_P);
  private rot = new Float32Array(MAX_P);
  private rotV = new Float32Array(MAX_P);
  private col = new Float32Array(MAX_P * 3);
  private colorDirty = false;

  private sparkBatch = new SparkBatch();
  private puffBatch = new PuffBatch();
  private ringBatch = new RingBatch();
  private scorchBatch = new ScorchBatch();
  private smolders: Smolder[] = [];

  private sprayAcc = 0;
  private sprayPuffAcc = 0;
  private labels: FloatLabel[] = [];
  private overlay: HTMLDivElement;

  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();
  private tmpV = new THREE.Vector3();
  private side = new THREE.Vector3();
  private readonly ground = (x: number, z: number): number => (this.ctx.snow ? this.ctx.snow.getDepth(x, z) : 0);

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x5a6a80, emissiveIntensity: 0.35, flatShading: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_P);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    ctx.scene.add(this.mesh);
    ctx.scene.add(this.scorchBatch.mesh, this.ringBatch.mesh, this.puffBatch.mesh, this.sparkBatch.mesh);

    for (let i = 0; i < MAX_SMOLDER; i++) {
      this.smolders.push({ x: 0, y: 0, z: 0, t: 0, dur: 0, scale: 1, smokeAcc: 0, emberAcc: 0, fireAcc: 0, active: false });
    }

    // Floating text overlay
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:20;overflow:hidden;';
    document.body.appendChild(ov);
    this.overlay = ov;
    for (let i = 0; i < MAX_TEXT; i++) {
      const el = document.createElement('div');
      el.style.cssText =
        "position:absolute;left:0;top:0;display:none;white-space:nowrap;font-family:'Arial Black','Arial Rounded MT Bold',Impact,sans-serif;" +
        'font-weight:900;color:#fff;-webkit-text-stroke:1.5px #1b2340;paint-order:stroke fill;' +
        'text-shadow:0 3px 0 #1b2340,0 0 6px rgba(0,0,0,.35);will-change:transform,opacity;';
      ov.appendChild(el);
      this.labels.push({ el, pos: new THREE.Vector3(), age: 0, active: false });
    }
  }

  /** Live instance counts per pool (debug / probes). */
  get stats(): Record<string, number> {
    return { chunks: this.n, sparks: this.sparkBatch.n, puffs: this.puffBatch.n, rings: this.ringBatch.n, scorch: this.scorchBatch.n, smolder: this.smolders.filter((s) => s.active).length };
  }

  private emit(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    life: number, size: number, gravity: number, drag: number, r: number, g: number, b: number,
  ): void {
    let i = this.n;
    if (i >= MAX_P) {
      i = (Math.random() * MAX_P) | 0; // recycle a random one
    } else {
      this.n++;
    }
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.size[i] = size;
    this.grav[i] = gravity; this.drag[i] = drag;
    this.rot[i] = Math.random() * 6.28; this.rotV[i] = (Math.random() - 0.5) * 12;
    const j = i * 3;
    this.col[j] = r; this.col[j + 1] = g; this.col[j + 2] = b;
    this.colorDirty = true;
  }

  burst(pos: THREE.Vector3, opts?: { color?: number; count?: number; speed?: number; size?: number; gravity?: number; life?: number }): void {
    const count = Math.min(400, opts?.count ?? 24);
    const speed = opts?.speed ?? 6;
    const size = opts?.size ?? 0.2;
    const gravity = opts?.gravity ?? 18;
    const life = opts?.life ?? 1.0;
    const hex = opts?.color ?? 0xffffff;
    const c = this.tmpColor.set(hex);
    const isWhite = opts?.color === undefined;
    const hr = ((hex >> 16) & 255) / 255, hg = ((hex >> 8) & 255) / 255, hb = (hex & 255) / 255;
    const hi = Math.max(hr, hg, hb);
    const sat = hi - Math.min(hr, hg, hb);

    // Rising bursts (smoke, steam, flame) become soft puffs; saturated bright ones glow additively.
    if (gravity < 0) {
      const glow = sat > 0.3 && hi > 0.5;
      this.smoke(pos, {
        count: Math.max(1, Math.round(count * 0.6)),
        color: hex,
        size: size * 1.5,
        grow: glow ? 2.2 : 3,
        life: life * (glow ? 1 : 1.2),
        speed: speed * 0.45,
        up: speed * 0.25,
        rise: -gravity * 0.45,
        drag: 1.6,
        spread: 0.15 + size * 0.3,
        opacity: glow ? 0.85 : hi < 0.35 ? 0.7 : 0.5,
        additive: glow ? 0.35 : 0,
      });
      return;
    }
    // Small, short-lived coloured bursts are sparks: streaks instead of tumbling chunks.
    if (!isWhite && hex !== 0xffffff && size <= 0.12 && life <= 0.6) {
      this.sparks(pos, null, { count, color: hex, speed: speed * 1.15, size: Math.max(0.05, size * 0.7), gravity, life: life * 1.1 });
      return;
    }

    for (let k = 0; k < count; k++) {
      // random direction, biased upward
      const u = Math.random() * Math.PI * 2;
      const v = Math.random() * 0.9 + 0.1;
      const h = Math.sqrt(1 - v * v);
      const s = speed * (0.35 + Math.random() * 0.75);
      const tint = isWhite ? 0.86 + Math.random() * 0.14 : 0.8 + Math.random() * 0.3;
      this.emit(
        pos.x + (Math.random() - 0.5) * 0.3, pos.y + Math.random() * 0.3, pos.z + (Math.random() - 0.5) * 0.3,
        Math.cos(u) * h * s, v * s * 1.1, Math.sin(u) * h * s,
        life * (0.6 + Math.random() * 0.6), size * (0.5 + Math.random() * 0.8), gravity, 1.2,
        Math.min(1, c.r * tint), Math.min(1, c.g * tint), Math.min(1, c.b * (isWhite ? tint + 0.06 : tint)),
      );
    }
    // Snow clumps kick up a little powder too.
    if (size >= 0.2 && gravity >= 8 && hr > 0.85 && hg > 0.85 && hb > 0.85) {
      this.smoke(pos, {
        count: Math.min(6, Math.ceil(count / 8)), color: hex, size: 0.3 + size, grow: 3, life: 0.6 + life * 0.5,
        speed: speed * 0.45, up: 0.8, rise: -1.2, drag: 2.4, spread: 0.4, opacity: 0.45,
      });
    }
  }

  sparks(pos: THREE.Vector3, dir: THREE.Vector3 | null, opts?: SparkOpts): void {
    const count = Math.min(200, opts?.count ?? 14);
    const speed = opts?.speed ?? 12;
    const spread = THREE.MathUtils.clamp(opts?.spread ?? (dir ? 0.55 : 1), 0, 1);
    const width = opts?.size ?? 0.08;
    const stretch = opts?.length ?? 0.035;
    const gravity = opts?.gravity ?? 20;
    const life = opts?.life ?? 0.4;
    const c = this.tmpColor.set(opts?.color ?? 0xffc04a);
    const sb = this.sparkBatch;
    let dx = 0, dy = 1, dz = 0;
    if (dir) {
      const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
      dx = dir.x / l; dy = dir.y / l; dz = dir.z / l;
    }
    for (let k = 0; k < count; k++) {
      // Random unit vector, then pulled toward `dir` by (1 - spread). Without dir: upper hemisphere.
      const u = Math.random() * Math.PI * 2;
      const v = dir ? Math.random() * 2 - 1 : Math.random() * 0.95 + 0.05;
      const h = Math.sqrt(1 - v * v);
      let rx = Math.cos(u) * h, ry = v, rz = Math.sin(u) * h;
      if (dir) {
        rx = dx + rx * spread * 1.6; ry = dy + ry * spread * 1.6; rz = dz + rz * spread * 1.6;
        const l = Math.hypot(rx, ry, rz) || 1;
        rx /= l; ry /= l; rz /= l;
      }
      const s = speed * (0.4 + Math.random() * 0.8);
      const tint = 0.85 + Math.random() * 0.3;
      sb.emit(
        pos.x + (Math.random() - 0.5) * 0.2, pos.y + (Math.random() - 0.5) * 0.2, pos.z + (Math.random() - 0.5) * 0.2,
        rx * s, ry * s, rz * s,
        life * (0.5 + Math.random() * 0.8), width * (0.7 + Math.random() * 0.6), stretch, gravity, 1.4,
        c.r * tint, c.g * tint, c.b * tint,
      );
    }
  }

  smoke(pos: THREE.Vector3, opts?: SmokeOpts): void {
    const count = Math.min(120, opts?.count ?? 6);
    const size = opts?.size ?? 0.6;
    const grow = opts?.grow ?? 3;
    const life = opts?.life ?? 1.6;
    const speed = opts?.speed ?? 1.5;
    const up = opts?.up ?? 1.2;
    const rise = opts?.rise ?? 1;
    const drag = opts?.drag ?? 1.5;
    const spread = opts?.spread ?? 0.4;
    const alpha = opts?.opacity ?? 0.6;
    const add = opts?.additive ?? 0;
    const radial = opts?.radial ?? false;
    const dir = opts?.dir;
    const c = this.tmpColor.set(opts?.color ?? 0x34363c);
    const pb = this.puffBatch;
    for (let k = 0; k < count; k++) {
      const u = Math.random() * Math.PI * 2;
      let vx: number, vy: number, vz: number;
      if (radial) {
        const s = speed * (0.55 + Math.random() * 0.6);
        vx = Math.cos(u) * s; vz = Math.sin(u) * s; vy = up * (0.3 + Math.random() * 0.9);
      } else {
        const v = Math.random() * 2 - 1;
        const h = Math.sqrt(1 - v * v);
        const s = speed * Math.random();
        vx = Math.cos(u) * h * s; vy = v * s * 0.6 + up * (0.6 + Math.random() * 0.6); vz = Math.sin(u) * h * s;
      }
      if (dir) {
        const s = 0.6 + Math.random() * 0.6;
        vx += dir.x * s; vy += dir.y * s; vz += dir.z * s;
      }
      const r = spread * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      const tint = 0.9 + Math.random() * 0.2;
      const s0 = size * (0.75 + Math.random() * 0.5);
      pb.emit(
        pos.x + Math.cos(a) * r, pos.y + (Math.random() - 0.5) * spread * 0.6, pos.z + Math.sin(a) * r,
        vx, vy, vz,
        life * (0.7 + Math.random() * 0.6), s0, s0 * grow * (0.8 + Math.random() * 0.4), rise, drag,
        Math.min(4, c.r * tint), Math.min(4, c.g * tint), Math.min(4, c.b * tint), alpha * (0.75 + Math.random() * 0.25), add,
      );
    }
  }

  powder(pos: THREE.Vector3, opts?: PowderOpts): void {
    const sc = opts?.size ?? 1;
    const color = opts?.color ?? 0xd6e3f3;
    const gy = this.ground(pos.x, pos.z);
    this.tmpV.set(pos.x, Math.max(pos.y, gy + 0.3), pos.z);
    // Ground-hugging ring that races outward + a lazy column of powder in the middle.
    this.smoke(this.tmpV, {
      count: Math.round(10 + sc * 8), color, size: 0.55 + sc * 0.25, grow: 3.2, life: 1.2 + sc * 0.25,
      speed: 6 + sc * 3, up: 1, rise: -0.4, drag: 2.6, spread: 0.6 * sc, opacity: 0.85, radial: true,
    });
    this.tmpV.y += 0.4 * sc;
    this.smoke(this.tmpV, {
      count: Math.round(5 + sc * 4), color, size: 0.6 + sc * 0.3, grow: 2.6, life: 1.4 + sc * 0.3,
      speed: 2.2 * sc, up: 2.5 + sc, rise: -1.2, drag: 2, spread: 0.5 * sc, opacity: 0.75,
    });
    // Fine flakes.
    const n = Math.round(14 + sc * 12);
    for (let k = 0; k < n; k++) {
      const u = Math.random() * Math.PI * 2;
      const s = (3 + Math.random() * 6) * (0.7 + sc * 0.3);
      const t = 0.88 + Math.random() * 0.12;
      this.emit(
        pos.x, this.tmpV.y, pos.z, Math.cos(u) * s, 3 + Math.random() * 5 * sc, Math.sin(u) * s,
        0.6 + Math.random() * 0.6, 0.05 + Math.random() * 0.07, 12, 2, t, t, Math.min(1, t + 0.06),
      );
    }
  }

  scorch(pos: THREE.Vector3, radius: number, strength = 0.85): void {
    this.scorchBatch.spawn(pos.x, this.ground(pos.x, pos.z) + 0.03, pos.z, radius, strength);
  }

  fireball(pos: THREE.Vector3, scale = 1): void {
    this.smoke(pos, { count: Math.round(7 + 5 * scale), color: 0xff7a1a, additive: 0.3, size: 0.9 * scale, grow: 2.4, life: 0.6, speed: 4 * scale, up: 2, rise: 2, drag: 3, spread: 0.6 * scale, opacity: 1 });
    this.smoke(pos, { count: 2, color: 0xffe08a, additive: 0.5, size: 1.6 * scale, grow: 1.8, life: 0.28, speed: 0, up: 0, rise: 0, drag: 0, spread: 0, opacity: 1 });
    this.smoke(pos, { count: Math.round(4 + 3 * scale), color: 0x2a2a2e, size: 0.6 * scale, grow: 3, life: 1.6, speed: 3 * scale, up: 2, rise: 1.2, drag: 2, spread: 0.4 * scale, opacity: 0.7 });
  }

  smolder(pos: THREE.Vector3, opts?: SmolderOpts): void {
    let s = this.smolders.find((x) => !x.active);
    if (!s) {
      s = this.smolders[0];
      for (const x of this.smolders) if (x.t / x.dur > s.t / s.dur) s = x;
    }
    s.active = true;
    s.x = pos.x; s.y = pos.y; s.z = pos.z;
    s.t = 0;
    s.dur = opts?.seconds ?? 2.5;
    s.scale = THREE.MathUtils.clamp(opts?.scale ?? 1, 0.3, 3);
    s.smokeAcc = 0; s.emberAcc = 0; s.fireAcc = 0;
  }

  private updateSmolders(dt: number): void {
    const pb = this.puffBatch;
    const sb = this.sparkBatch;
    for (const s of this.smolders) {
      if (!s.active) continue;
      s.t += dt;
      if (s.t >= s.dur) {
        s.active = false;
        continue;
      }
      const k = 1 - s.t / s.dur;
      const sc = s.scale;
      s.smokeAcc += dt * 15 * Math.sqrt(sc) * (0.35 + 0.65 * k);
      s.emberAcc += dt * 16 * sc * k;
      s.fireAcc += dt * 14 * Math.sqrt(sc) * Math.max(0, k - 0.35);
      while (s.smokeAcc >= 1) {
        s.smokeAcc -= 1;
        const g = 0.018 + Math.random() * 0.03;
        const s0 = (0.35 + Math.random() * 0.25) * sc;
        pb.emit(
          s.x + (Math.random() - 0.5) * 0.8 * sc, s.y + 0.2 + Math.random() * 0.4, s.z + (Math.random() - 0.5) * 0.8 * sc,
          WIND_X * 0.6 + (Math.random() - 0.5) * 0.7, 1.6 + Math.random() * 1.4, WIND_Z * 0.6 + (Math.random() - 0.5) * 0.7,
          1.7 + Math.random() * 0.8, s0, s0 * (3.6 + Math.random() * 1.6), 0.7, 0.45,
          g, g, g * 1.08, 0.6 * (0.55 + 0.45 * k), 0,
        );
      }
      while (s.fireAcc >= 1) {
        s.fireAcc -= 1;
        const s0 = (0.3 + Math.random() * 0.25) * sc;
        pb.emit(
          s.x + (Math.random() - 0.5) * 0.6 * sc, s.y + 0.2, s.z + (Math.random() - 0.5) * 0.6 * sc,
          (Math.random() - 0.5) * 0.6, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 0.6,
          0.3 + Math.random() * 0.25, s0, s0 * 1.6, 3, 1,
          1.3, 0.38 + Math.random() * 0.25, 0.05, 0.85, 0.3,
        );
      }
      while (s.emberAcc >= 1) {
        s.emberAcc -= 1;
        const u = Math.random() * Math.PI * 2;
        const h = 0.6 + Math.random() * 1.6;
        sb.emit(
          s.x + (Math.random() - 0.5) * 0.7 * sc, s.y + 0.3 + Math.random() * 0.5, s.z + (Math.random() - 0.5) * 0.7 * sc,
          Math.cos(u) * h + WIND_X, 2.5 + Math.random() * 4, Math.sin(u) * h + WIND_Z,
          0.7 + Math.random() * 0.8, 0.06 + Math.random() * 0.04, 0.03, 3.5, 1.1,
          1, 0.32 + Math.random() * 0.2, 0.05,
        );
      }
    }
  }

  spray(pos: THREE.Vector3, dir: THREE.Vector3, intensity: number): void {
    if (intensity <= 0) return;
    const dt = this.lastDt;
    const it = Math.min(1, intensity);
    const side = this.side.set(dir.z, 0, -dir.x);
    // Soft powder plume off the blade end.
    this.sprayPuffAcc += it * 26 * dt;
    let puffs = Math.min(4, Math.floor(this.sprayPuffAcc));
    this.sprayPuffAcc -= Math.floor(this.sprayPuffAcc);
    while (puffs-- > 0) {
      const sgn = Math.random() < 0.5 ? -1 : 1;
      const lateral = (1.5 + Math.random() * 2) * sgn;
      const fwd = 1.2 + Math.random() * 2.5;
      const off = (Math.random() - 0.5) * 1.2;
      const t = 0.84 + Math.random() * 0.1;
      const s0 = 0.25 + Math.random() * 0.2;
      this.puffBatch.emit(
        pos.x + side.x * off, pos.y + 0.15 + Math.random() * 0.3, pos.z + side.z * off,
        dir.x * fwd + side.x * lateral, 1.2 + Math.random() * 1.6 * (0.5 + it * 0.5), dir.z * fwd + side.z * lateral,
        0.55 + Math.random() * 0.4, s0, s0 * (3.2 + Math.random() * 1.6), -1.4, 2.4,
        t, t + 0.02, Math.min(1, t + 0.07), 0.32 + 0.22 * it, 0,
      );
    }
    // Flakes.
    this.sprayAcc += it * 240 * dt;
    let count = Math.floor(this.sprayAcc);
    if (count <= 0) return;
    this.sprayAcc -= count;
    count = Math.min(count, 24);
    for (let k = 0; k < count; k++) {
      const sgn = Math.random() < 0.5 ? -1 : 1;
      const lateral = (2.5 + Math.random() * 4) * sgn;
      const fwd = 1.5 + Math.random() * 3.5;
      const up = 2.5 + Math.random() * 4 * (0.5 + intensity * 0.5);
      const off = (Math.random() - 0.5) * 1.6;
      const t = 0.9 + Math.random() * 0.1;
      this.emit(
        pos.x + side.x * off, pos.y + 0.2 + Math.random() * 0.3, pos.z + side.z * off,
        dir.x * fwd + side.x * lateral, up, dir.z * fwd + side.z * lateral,
        0.5 + Math.random() * 0.45, 0.04 + Math.random() * 0.07, 14, 1.8,
        t, t, Math.min(1, t + 0.06),
      );
    }
  }

  floatText(pos: THREE.Vector3, text: string, color = '#ffffff', size = 1): void {
    let lab = this.labels.find((l) => !l.active);
    if (!lab) {
      // recycle oldest
      lab = this.labels[0];
      for (const l of this.labels) if (l.age > lab.age) lab = l;
    }
    lab.active = true;
    lab.age = 0;
    lab.pos.copy(pos);
    lab.pos.x += (Math.random() - 0.5) * 0.6;
    lab.pos.y += 1.2;
    lab.el.textContent = text;
    lab.el.style.color = color;
    lab.el.style.fontSize = `${Math.round(22 * size)}px`;
    lab.el.style.display = 'block';
  }

  ring(pos: THREE.Vector3, radius: number, color = 0xffffff): void {
    this.ringBatch.spawn(pos.x, 0.08 + this.ground(pos.x, pos.z), pos.z, radius, color);
  }

  shake(intensity: number): void {
    this.ctx.cameraRig?.addShake(intensity);
  }

  clear(): void {
    this.n = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.sparkBatch.clear();
    this.puffBatch.clear();
    this.ringBatch.clear();
    this.scorchBatch.clear();
    for (const s of this.smolders) s.active = false;
    for (const l of this.labels) {
      l.active = false;
      l.el.style.display = 'none';
    }
  }

  private lastDt = 1 / 60;

  update(dt: number): void {
    this.lastDt = dt > 0 ? dt : 1 / 60;
    const snow = this.ctx.snow;
    const { px, py, pz, vx, vy, vz, age, life, size, grav, drag, rot, rotV, col } = this;
    const d = this.dummy;
    let i = 0;
    while (i < this.n) {
      age[i] += dt;
      if (age[i] >= life[i]) {
        this.kill(i);
        continue;
      }
      const dr = Math.max(0, 1 - drag[i] * dt);
      vx[i] *= dr; vz[i] *= dr;
      vy[i] = vy[i] * dr - grav[i] * dt;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      rot[i] += rotV[i] * dt;
      if (vy[i] < 0 && py[i] < 2) {
        const floor = (snow ? snow.getDepth(px[i], pz[i]) : 0) + 0.05;
        if (py[i] < floor) {
          py[i] = floor;
          vy[i] *= -0.25;
          vx[i] *= 0.5; vz[i] *= 0.5;
          rotV[i] *= 0.5;
        }
      }
      const f = age[i] / life[i];
      const s = size[i] * (f < 0.6 ? 1 : 1 - (f - 0.6) / 0.4) * Math.min(1, age[i] * 25 + 0.3);
      d.position.set(px[i], py[i], pz[i]);
      d.rotation.set(rot[i], rot[i] * 0.7, 0);
      d.scale.setScalar(Math.max(0.0001, s));
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
      i++;
    }
    const n = this.n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      // Upload only the live prefix, not the whole 3000-instance buffer.
      const im = this.mesh.instanceMatrix;
      im.clearUpdateRanges();
      im.addUpdateRange(0, n * 16);
      im.needsUpdate = true;
      if (this.colorDirty) {
        const ic = this.mesh.instanceColor!;
        (ic.array as Float32Array).set(col.subarray(0, n * 3));
        ic.clearUpdateRanges();
        ic.addUpdateRange(0, n * 3);
        ic.needsUpdate = true;
        this.colorDirty = false;
      }
    }

    this.updateSmolders(dt);
    this.sparkBatch.update(dt, this.ground);
    this.puffBatch.update(dt, this.ground);
    this.ringBatch.update(dt);
    this.scorchBatch.update(dt, this.ground);

    // Labels
    const cam = this.ctx.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const l of this.labels) {
      if (!l.active) continue;
      l.age += dt;
      if (l.age >= TEXT_LIFE) {
        l.active = false;
        l.el.style.display = 'none';
        continue;
      }
      l.pos.y += dt * 1.8;
      const v = this.tmpV.copy(l.pos).project(cam);
      if (v.z > 1 || v.z < -1) {
        l.el.style.opacity = '0';
        continue;
      }
      const t = l.age / TEXT_LIFE;
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.6 : 1.2 - Math.min(0.2, (t - 0.15) * 0.6);
      l.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%) scale(${pop.toFixed(3)})`;
      l.el.style.opacity = t < 0.6 ? '1' : (1 - (t - 0.6) / 0.4).toFixed(3);
    }
  }

  /** Swap-remove particle i with the last live one. */
  private kill(i: number): void {
    const last = --this.n;
    if (i === last) return;
    this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pz[i] = this.pz[last];
    this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
    this.age[i] = this.age[last]; this.life[i] = this.life[last]; this.size[i] = this.size[last];
    this.grav[i] = this.grav[last]; this.drag[i] = this.drag[last];
    this.rot[i] = this.rot[last]; this.rotV[i] = this.rotV[last];
    const a = i * 3, b = last * 3;
    this.col[a] = this.col[b]; this.col[a + 1] = this.col[b + 1]; this.col[a + 2] = this.col[b + 2];
    this.colorDirty = true;
  }
}
