import * as THREE from 'three';
import type { FxAPI, GameContext } from '../core/types';

const MAX_P = 3000;
const MAX_RINGS = 16;
const MAX_TEXT = 48;
const TEXT_LIFE = 0.9;

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  radius: number;
  active: boolean;
}

interface FloatLabel {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  age: number;
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

  private sprayAcc = 0;
  private rings: Ring[] = [];
  private labels: FloatLabel[] = [];
  private overlay: HTMLDivElement;

  private dummy = new THREE.Object3D();
  private tmpColor = new THREE.Color();
  private tmpV = new THREE.Vector3();
  private side = new THREE.Vector3();

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
    ctx.scene.add(this.mesh);

    // Rings
    const ringGeo = new THREE.RingGeometry(0.82, 1, 48);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < MAX_RINGS; i++) {
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(ringGeo, m);
      mesh.visible = false;
      mesh.renderOrder = 2;
      ctx.scene.add(mesh);
      this.rings.push({ mesh, mat: m, age: 0, life: 0.6, radius: 1, active: false });
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
    const c = this.tmpColor.set(opts?.color ?? 0xffffff);
    const isWhite = opts?.color === undefined;
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
  }

  spray(pos: THREE.Vector3, dir: THREE.Vector3, intensity: number): void {
    if (intensity <= 0) return;
    const dt = this.lastDt;
    this.sprayAcc += Math.min(1, intensity) * 320 * dt;
    let count = Math.floor(this.sprayAcc);
    if (count <= 0) return;
    this.sprayAcc -= count;
    count = Math.min(count, 30);
    const side = this.side.set(dir.z, 0, -dir.x);
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
        0.5 + Math.random() * 0.45, 0.05 + Math.random() * 0.09, 14, 1.8,
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
    let r = this.rings.find((x) => !x.active);
    if (!r) {
      r = this.rings[0];
      for (const x of this.rings) if (x.age / x.life > r.age / r.life) r = x;
    }
    r.active = true;
    r.age = 0;
    r.life = 0.45 + Math.min(0.5, radius * 0.04);
    r.radius = radius;
    r.mat.color.set(color);
    r.mesh.position.set(pos.x, 0.08 + (this.ctx.snow ? this.ctx.snow.getDepth(pos.x, pos.z) : 0), pos.z);
    r.mesh.visible = true;
  }

  shake(intensity: number): void {
    this.ctx.cameraRig?.addShake(intensity);
  }

  clear(): void {
    this.n = 0;
    this.mesh.count = 0;
    for (const r of this.rings) {
      r.active = false;
      r.mesh.visible = false;
    }
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
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.colorDirty && this.n > 0) {
      const arr = this.mesh.instanceColor!.array as Float32Array;
      arr.set(col.subarray(0, this.n * 3));
      this.mesh.instanceColor!.needsUpdate = true;
      this.colorDirty = false;
    }

    // Rings
    for (const r of this.rings) {
      if (!r.active) continue;
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - t, 3);
      const sc = r.radius * (0.15 + 0.85 * e);
      r.mesh.scale.set(sc, 1, sc);
      r.mat.opacity = 0.85 * (1 - t);
    }

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
