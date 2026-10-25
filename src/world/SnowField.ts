import * as THREE from 'three';
import type { GameContext, SnowFieldAPI, ZoneDef } from '../core/types';
import { ARENA, ENEMY_GATES, GATE_WIDTH, snowFieldSize } from '../core/types';
import { dequantDepth, quantDepth, type SnowPatch } from '../net/protocol';

const EDGE = 2; // edits never touch the outermost vertices (keeps the field rim flush with the outer ground)
const LUT_SIZE = 256;
const LUT_MAX_DEPTH = 0.4;
const REGEN_INTERVAL = 0.25;
/** Snow banks drifted up against the inner wall faces (extra depth fraction, falloff distance in m). */
const BANK = 0.45;
const BANK_DIST = 2.4;
/** Brawl: big contested snow drifts. */
const DRIFT_COUNT = 14;
const DRIFT_PEAK = 1.3;
/** Brawl spawn ring radius (m) kept free of drifts (spawn points are expected around this ring). */
const SPAWN_RING_R = 70;
/** Max dirty rects tracked between flushes (several vehicles plow far apart in Brawl). */
const MAX_RECTS = 16;

const BARE_COLORS: Record<ZoneDef['theme'], number> = {
  meadow: 0x6f7a3f,
  pines: 0x4a3a2b,
  lake: 0x7f9db3,
  blizzard: 0x7f8b99,
  peak: 0x5a4e68,
  rally: 0x8a6a4a,
  brawl: 0x5d6478,
};

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};


export class SnowField implements SnowFieldAPI {
  private ctx: GameContext;

  // grid layout (rebuilt when the arena size changes)
  private fieldSize = 0;
  private N = 0; // segments per side
  private V = 0; // vertices per side
  private CELL = 0.5;
  private HALF = 0;
  private CELL_AREA = 0.25;
  private INV_CELL = 2;
  private AX0 = 0;
  private AX1 = 0;
  private AZ0 = 0;
  private AZ1 = 0;

  private depth = new Float32Array(0);
  private initial = new Float32Array(0);
  private sparkle = new Float32Array(0);
  private total = 0;
  private initialTotal = 1;
  private addCap = 1.25;

  private geometry: THREE.BufferGeometry | null = null;
  private posAttr!: THREE.BufferAttribute;
  private normAttr!: THREE.BufferAttribute;
  private colAttr!: THREE.BufferAttribute;
  private attrs: THREE.BufferAttribute[] = [];
  private mesh: THREE.Mesh;
  private material: THREE.MeshStandardMaterial;
  /** Brawl's cheaper snow: Lambert shading, no glitter (it's the competitive mode, frame rate first). */
  private fastMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  private outer: THREE.Mesh;
  private outerMat: THREE.MeshStandardMaterial;
  private lut = new Float32Array(LUT_SIZE * 3);

  // dirty rects (vertex indices, inclusive): [x0, x1, z0, z1] * MAX_RECTS
  private rects = new Int32Array(MAX_RECTS * 4);
  private rectCount = 0;
  private regenTimer = 0;
  /** Duel host: edits (not regen) since the last takeNetPatches(), for the snapshot stream. Off otherwise. */
  netTrack = false;
  private netRects = new Int32Array(MAX_RECTS * 4);
  private netCount = 0;
  /** Snow regrowth rate (m/s) override: the Duel uses one fixed rate for both players (0 on the guest, which only
   *  shows the host's snow). null = the player's Snow Machine stats. */
  regenRate: number | null = null;

  get size(): number {
    return this.fieldSize;
  }

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.0 });
    // Subtle glitter: view-dependent sparkle on snowy (bright) surfaces.
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSnowWorld;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSnowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSnowWorld;')
        .replace(
          '#include <dithering_fragment>',
          `#include <dithering_fragment>
          {
            vec3 cellP = floor(vSnowWorld * 9.0);
            float rnd = fract(sin(dot(cellP, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            vec3 vdir = normalize(cameraPosition - vSnowWorld);
            float tw = fract(rnd * 17.0 + dot(vdir, vec3(3.1, 1.7, 2.3)) * 2.0);
            float s = step(0.985, rnd) * smoothstep(0.75, 1.0, tw) * smoothstep(0.75, 0.95, vColor.r);
            gl_FragColor.rgb += vec3(s * 0.6);
          }`,
        );
    };
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'SnowField';
    ctx.scene.add(this.mesh);

    this.outerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    this.outer = new THREE.Mesh(new THREE.BufferGeometry(), this.outerMat);
    this.outer.receiveShadow = true;
    this.outer.name = 'OuterGround';
    ctx.scene.add(this.outer);

    this.reset(ctx.zone);
  }

  /* ------------------------------------------------------------------ grid build */

  /** (Re)allocate the grid + meshes for the current ARENA size. */
  private build(size: number): void {
    const cell = size <= 100 ? 0.5 : 1.0;
    const N = Math.round(size / cell);
    const V = N + 1;
    const CELL = size / N;
    const HALF = size / 2;
    this.fieldSize = size;
    this.N = N;
    this.V = V;
    this.CELL = CELL;
    this.HALF = HALF;
    this.CELL_AREA = CELL * CELL;
    this.INV_CELL = 1 / CELL;

    const count = V * V;
    this.depth = new Float32Array(count);
    this.initial = new Float32Array(count);
    this.sparkle = new Float32Array(count);
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let iz = 0; iz < V; iz++) {
      for (let ix = 0; ix < V; ix++) {
        const i = iz * V + ix;
        pos[i * 3] = -HALF + ix * CELL;
        pos[i * 3 + 2] = -HALF + iz * CELL;
        nor[i * 3 + 1] = 1;
        this.sparkle[i] = 0.965 + hash2(ix, iz, 99) * 0.05;
      }
    }
    const idx = new Uint32Array(N * N * 6);
    let k = 0;
    for (let iz = 0; iz < N; iz++) {
      for (let ix = 0; ix < N; ix++) {
        const a = iz * V + ix;
        const b = a + 1;
        const c = a + V;
        const d = c + 1;
        // alternate diagonal for less directional artifacts
        if ((ix + iz) & 1) {
          idx[k++] = a; idx[k++] = c; idx[k++] = b;
          idx[k++] = b; idx[k++] = c; idx[k++] = d;
        } else {
          idx[k++] = a; idx[k++] = c; idx[k++] = d;
          idx[k++] = a; idx[k++] = d; idx[k++] = b;
        }
      }
    }
    if (this.geometry) this.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3);
    this.normAttr = new THREE.BufferAttribute(nor, 3);
    this.colAttr = new THREE.BufferAttribute(col, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.normAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('normal', this.normAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), HALF * Math.SQRT2 + 3);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(-HALF, -1, -HALF), new THREE.Vector3(HALF, 4, HALF));
    this.geometry = geo;
    this.attrs = [this.posAttr, this.normAttr, this.colAttr];
    this.mesh.geometry = geo;
    this.rectCount = 0;

    // Outer ground: huge snowy plane with a square hole where the field is.
    const shape = new THREE.Shape();
    const O = 700;
    shape.moveTo(-O, -O);
    shape.lineTo(O, -O);
    shape.lineTo(O, O);
    shape.lineTo(-O, O);
    shape.lineTo(-O, -O);
    const hole = new THREE.Path();
    const h = HALF - CELL * 0.6;
    hole.moveTo(-h, -h);
    hole.lineTo(-h, h);
    hole.lineTo(h, h);
    hole.lineTo(h, -h);
    hole.lineTo(-h, -h);
    shape.holes.push(hole);
    const og = new THREE.ShapeGeometry(shape);
    og.rotateX(-Math.PI / 2);
    this.outer.geometry.dispose();
    this.outer.geometry = og;
  }

  /* ------------------------------------------------------------------ setup */

  reset(zone: ZoneDef): void {
    this.mesh.material = zone.theme === 'brawl' ? this.fastMaterial : this.material;
    const want = snowFieldSize();
    if (Math.abs(want - this.fieldSize) > 1e-6 || !this.geometry) this.build(want);
    const { V, CELL, HALF, INV_CELL, N } = this;
    // vertex index range of the playable arena (snow outside the walls doesn't count toward totalSnowFraction)
    this.AX0 = Math.max(0, Math.ceil((ARENA.minX + HALF) * INV_CELL));
    this.AX1 = Math.min(N, Math.floor((ARENA.maxX + HALF) * INV_CELL));
    this.AZ0 = Math.max(0, Math.ceil((ARENA.minZ + HALF) * INV_CELL));
    this.AZ1 = Math.min(N, Math.floor((ARENA.maxZ + HALF) * INV_CELL));
    const { AX0, AX1, AZ0, AZ1 } = this;

    const brawl = zone.theme === 'brawl';
    const base = zone.snowDepth;
    this.addCap = brawl ? base + DRIFT_PEAK + 0.3 : Math.max(base * 2.4, base + 0.6);
    const seed = (zone.index + 7) * 7919 + 13;
    // arena-edge points of the gates (no snow bank in the gate mouths) — campaign only
    const gateEdges = brawl
      ? []
      : ENEMY_GATES.map((g) => ({
        x: Math.min(ARENA.maxX, Math.max(ARENA.minX, g.x)),
        z: Math.min(ARENA.maxZ, Math.max(ARENA.minZ, g.z)),
      }));
    const drifts = brawl ? this.planDrifts(seed) : [];
    const d = this.depth;
    const init = this.initial;
    let total = 0;
    // larger arena: stretch the noise a bit so features aren't tiny relative to the space
    const nf = brawl ? 0.7 : 1;
    for (let iz = 0; iz < V; iz++) {
      const z = -HALF + iz * CELL;
      for (let ix = 0; ix < V; ix++) {
        const x = -HALF + ix * CELL;
        // low-frequency rolling variation
        const n1 = valueNoise(x * 0.045 * nf, z * 0.045 * nf, seed) * 2 - 1;
        const n2 = valueNoise(x * 0.11 * nf + 31, z * 0.11 * nf - 17, seed + 1) * 2 - 1;
        let m = 1 + n1 * 0.17 + n2 * 0.08;
        // small wind drifts: elongated ridges
        const dr = valueNoise(x * 0.06 * nf + z * 0.02, z * 0.22 * nf, seed + 2);
        m += smooth(0.62, 0.9, dr) * 0.22;
        // flush with the outer ground near the field rim (the rim lies outside the arena walls)
        const edgeDist = Math.min(HALF - Math.abs(x), HALF - Math.abs(z));
        const e = smooth(0.5, 3, edgeDist);
        m = 1 + (m - 1) * e;
        // drifts banked against the inside of the arena walls (except in the gate mouths)
        const dw = Math.min(x - ARENA.minX, ARENA.maxX - x, z - ARENA.minZ, ARENA.maxZ - z);
        if (dw >= 0 && dw < BANK_DIST) {
          let gate = false;
          for (let g = 0; g < gateEdges.length; g++) {
            const gx = x - gateEdges[g].x;
            const gz = z - gateEdges[g].z;
            if (gx * gx + gz * gz < (GATE_WIDTH * 0.5 + 1.5) ** 2) gate = true;
          }
          if (!gate) m += BANK * (1 - smooth(0, BANK_DIST, dw)) * (0.75 + 0.5 * valueNoise(x * 0.3, z * 0.3, seed + 3));
        }
        let v = base * m;
        // big contested drifts (Brawl): smooth elliptical mounds with a lumpy crest
        for (let k = 0; k < drifts.length; k++) {
          const dr2 = drifts[k];
          const lx = x - dr2.x;
          const lz = z - dr2.z;
          const u = (lx * dr2.c + lz * dr2.s) * dr2.irA;
          const w = (-lx * dr2.s + lz * dr2.c) * dr2.irB;
          const q = u * u + w * w;
          if (q < 1) {
            const f = 1 - q;
            v += dr2.peak * f * f * (0.85 + 0.3 * valueNoise(x * 0.35, z * 0.35, seed + 5 + k));
          }
        }
        const i = iz * V + ix;
        d[i] = v;
        init[i] = v;
        if (ix >= AX0 && ix <= AX1 && iz >= AZ0 && iz <= AZ1) total += v;
      }
    }
    this.total = total * this.CELL_AREA;
    this.initialTotal = Math.max(1e-6, this.total);
    this.regenTimer = 0;

    // Color LUT: bare ground -> packed snow -> fresh snow
    const snow = new THREE.Color(zone.snowTint);
    const bare = new THREE.Color(BARE_COLORS[zone.theme] ?? 0x6f7a3f);
    const packed = new THREE.Color(zone.snowTint).multiply(new THREE.Color(0xc4d2e6));
    const tmp = new THREE.Color();
    for (let j = 0; j < LUT_SIZE; j++) {
      const dep = (j / (LUT_SIZE - 1)) * LUT_MAX_DEPTH;
      const a = smooth(0.0, 0.06, dep);
      const b = smooth(0.05, 0.3, dep);
      tmp.copy(bare).lerp(packed, a).lerp(snow, b);
      this.lut[j * 3] = tmp.r;
      this.lut[j * 3 + 1] = tmp.g;
      this.lut[j * 3 + 2] = tmp.b;
    }
    this.outerMat.color.copy(snow).multiplyScalar(0.97);
    this.outer.position.y = base;

    this.rectCount = 0;
    this.markDirty(0, V - 1, 0, V - 1);
    this.flush();
  }

  /** Deterministic Brawl drift layout: clear of obstacles, walls, the center and the spawn ring. */
  private planDrifts(seed: number): { x: number; z: number; c: number; s: number; irA: number; irB: number; peak: number }[] {
    const out: { x: number; z: number; c: number; s: number; irA: number; irB: number; peak: number }[] = [];
    const obstacles = this.ctx.world?.obstacles ?? [];
    const lim = ARENA.maxX - 6;
    for (let tries = 0; tries < 600 && out.length < DRIFT_COUNT; tries++) {
      const r1 = hash2(tries, 1, seed + 11);
      const r2 = hash2(tries, 2, seed + 11);
      const r3 = hash2(tries, 3, seed + 11);
      const r4 = hash2(tries, 4, seed + 11);
      const R = 6 + r3 * 6; // 6..12 m
      const x = (r1 * 2 - 1) * (lim - R * 0.7);
      const z = (r2 * 2 - 1) * (lim - R * 0.7);
      if (Math.abs(x) + R * 0.7 > lim || Math.abs(z) + R * 0.7 > lim) continue;
      const dc = Math.hypot(x, z);
      if (dc < 14 + R * 0.5) continue; // keep the centerpiece plaza open
      if (Math.abs(dc - SPAWN_RING_R) < R * 0.8 + 4) continue; // spawn ring
      let ok = true;
      for (const o of obstacles) {
        if (Math.hypot(x - o.x, z - o.z) < o.r + R * 0.65) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      for (const q of out) {
        if (Math.hypot(x - q.x, z - q.z) < (R + 1 / q.irA) * 0.85) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const ang = r4 * Math.PI;
      const elong = 1.2 + hash2(tries, 5, seed + 11) * 0.5;
      out.push({ x, z, c: Math.cos(ang), s: Math.sin(ang), irA: 1 / (R * elong), irB: 1 / (R / elong), peak: DRIFT_PEAK * (0.85 + 0.15 * hash2(tries, 6, seed)) });
    }
    return out;
  }

  /* ------------------------------------------------------------------ queries */

  getDepth(x: number, z: number): number {
    const N = this.N;
    const fx = (x + this.HALF) * this.INV_CELL;
    const fz = (z + this.HALF) * this.INV_CELL;
    if (fx < 0 || fz < 0 || fx > N || fz > N) return 0;
    let ix = Math.floor(fx);
    let iz = Math.floor(fz);
    if (ix >= N) ix = N - 1;
    if (iz >= N) iz = N - 1;
    const tx = fx - ix;
    const tz = fz - iz;
    const d = this.depth;
    const V = this.V;
    const i = iz * V + ix;
    const a = d[i];
    const b = d[i + 1];
    const c = d[i + V];
    const e = d[i + V + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (e - c) * tx) * tz;
  }

  totalSnowFraction(): number {
    return this.total / this.initialTotal;
  }

  /* ------------------------------------------------------------------ edits */

  /** Merge into an overlapping/nearby dirty rect, else track a new one (merge into the closest when full). */
  private markDirty(x0: number, x1: number, z0: number, z1: number): void {
    this.rectCount = mergeRect(this.rects, this.rectCount, x0, x1, z0, z1);
  }

  /** An edit (plow / collect / add / melt): GPU upload, plus the duel host's network patch list. */
  private markEdit(x0: number, x1: number, z0: number, z1: number): void {
    this.rectCount = mergeRect(this.rects, this.rectCount, x0, x1, z0, z1);
    if (this.netTrack) this.netCount = mergeRect(this.netRects, this.netCount, x0, x1, z0, z1);
  }

  /* ------------------------------------------------------------------ duel netcode */

  /** Vertices per side of the grid. */
  get verts(): number {
    return this.V;
  }

  /** Move the edits since the last call into `out` (vertex rects). Returns the count. */
  takeNetPatches(out: SnowPatch[]): number {
    const n = this.netCount;
    const r = this.netRects;
    for (let k = 0; k < n; k++) {
      const o = k * 4;
      let p = out[k];
      if (!p) out[k] = p = { x0: 0, z0: 0, w: 0, h: 0 };
      p.x0 = r[o];
      p.z0 = r[o + 2];
      p.w = r[o + 1] - r[o] + 1;
      p.h = r[o + 3] - r[o + 2] + 1;
    }
    out.length = n;
    this.netCount = 0;
    return n;
  }

  /** Depth at vertex (ix, iz) quantised to a byte (net/protocol.ts SNOW_Q_MAX). */
  readQuant(ix: number, iz: number): number {
    return quantDepth(this.depth[iz * this.V + ix]);
  }

  /** Duel guest: set vertex (ix, iz) from a host byte (call patchDone after each patch). */
  writeQuant(ix: number, iz: number, b: number): void {
    if (ix < 0 || iz < 0 || ix >= this.V || iz >= this.V) return;
    this.depth[iz * this.V + ix] = dequantDepth(b);
  }

  /** Duel guest: a host patch was written; queue it for upload. */
  patchDone(p: SnowPatch): void {
    const V = this.V;
    this.markDirty(Math.max(0, p.x0), Math.min(V - 1, p.x0 + p.w - 1), Math.max(0, p.z0), Math.min(V - 1, p.z0 + p.h - 1));
  }

  /** Read-only plowLine: the volume the blade WOULD remove (duel guest: spray + sound while predicting). */
  measureLine(x1: number, z1: number, x2: number, z2: number, thickness: number, fraction: number): number {
    if (fraction <= 0) return 0;
    const { V, CELL, HALF, INV_CELL } = this;
    const r = Math.max(thickness * 0.5, CELL * 0.5);
    const r2 = r * r;
    const ix0 = Math.max(EDGE, Math.floor((Math.min(x1, x2) - r + HALF) * INV_CELL));
    const ix1 = Math.min(V - 1 - EDGE, Math.ceil((Math.max(x1, x2) + r + HALF) * INV_CELL));
    const iz0 = Math.max(EDGE, Math.floor((Math.min(z1, z2) - r + HALF) * INV_CELL));
    const iz1 = Math.min(V - 1 - EDGE, Math.ceil((Math.max(z1, z2) + r + HALF) * INV_CELL));
    if (ix0 > ix1 || iz0 > iz1) return 0;
    const f = Math.min(1, fraction);
    const sx = x2 - x1;
    const sz = z2 - z1;
    const len2 = sx * sx + sz * sz;
    const invLen2 = len2 > 1e-9 ? 1 / len2 : 0;
    const d = this.depth;
    let removed = 0;
    for (let iz = iz0; iz <= iz1; iz++) {
      const pz = -HALF + iz * CELL - z1;
      const row = iz * V;
      for (let ix = ix0; ix <= ix1; ix++) {
        const px = -HALF + ix * CELL - x1;
        let t = (px * sx + pz * sz) * invLen2;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const ex = px - sx * t;
        const ez = pz - sz * t;
        if (ex * ex + ez * ez <= r2) removed += d[row + ix] * f;
      }
    }
    return removed * this.CELL_AREA;
  }

  plowLine(x1: number, z1: number, x2: number, z2: number, thickness: number, fraction: number): number {
    if (fraction <= 0) return 0;
    const { V, CELL, HALF, INV_CELL } = this;
    const r = Math.max(thickness * 0.5, CELL * 0.5);
    const r2 = r * r;
    const ix0 = Math.max(EDGE, Math.floor((Math.min(x1, x2) - r + HALF) * INV_CELL));
    const ix1 = Math.min(V - 1 - EDGE, Math.ceil((Math.max(x1, x2) + r + HALF) * INV_CELL));
    const iz0 = Math.max(EDGE, Math.floor((Math.min(z1, z2) - r + HALF) * INV_CELL));
    const iz1 = Math.min(V - 1 - EDGE, Math.ceil((Math.max(z1, z2) + r + HALF) * INV_CELL));
    if (ix0 > ix1 || iz0 > iz1) return 0;
    const f = Math.min(1, fraction);
    const sx = x2 - x1;
    const sz = z2 - z1;
    const len2 = sx * sx + sz * sz;
    const invLen2 = len2 > 1e-9 ? 1 / len2 : 0;
    const d = this.depth;
    let removed = 0;
    for (let iz = iz0; iz <= iz1; iz++) {
      const pz = -HALF + iz * CELL - z1;
      const row = iz * V;
      for (let ix = ix0; ix <= ix1; ix++) {
        const px = -HALF + ix * CELL - x1;
        let t = (px * sx + pz * sz) * invLen2;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        const ex = px - sx * t;
        const ez = pz - sz * t;
        if (ex * ex + ez * ez <= r2) {
          const i = row + ix;
          const v = d[i];
          if (v > 0) {
            const rem = v * f;
            d[i] = v - rem;
            removed += rem;
          }
        }
      }
    }
    if (removed > 0) {
      removed *= this.CELL_AREA;
      this.total -= removed;
      this.markEdit(ix0, ix1, iz0, iz1);
    }
    return removed;
  }

  collectDisc(x: number, z: number, radius: number, fraction: number): number {
    if (fraction <= 0) return 0;
    const { V, CELL, HALF, INV_CELL } = this;
    const r = Math.max(radius, CELL * 0.5);
    const r2 = r * r;
    const ix0 = Math.max(EDGE, Math.floor((x - r + HALF) * INV_CELL));
    const ix1 = Math.min(V - 1 - EDGE, Math.ceil((x + r + HALF) * INV_CELL));
    const iz0 = Math.max(EDGE, Math.floor((z - r + HALF) * INV_CELL));
    const iz1 = Math.min(V - 1 - EDGE, Math.ceil((z + r + HALF) * INV_CELL));
    if (ix0 > ix1 || iz0 > iz1) return 0;
    const f = Math.min(1, fraction);
    const invR = 1 / r;
    const d = this.depth;
    let removed = 0;
    for (let iz = iz0; iz <= iz1; iz++) {
      const dz = -HALF + iz * CELL - z;
      const row = iz * V;
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = -HALF + ix * CELL - x;
        const q = dx * dx + dz * dz;
        if (q <= r2) {
          const i = row + ix;
          const v = d[i];
          if (v > 0) {
            // soft rim
            const w = Math.min(1, (1 - Math.sqrt(q) * invR) * 3);
            const rem = v * f * w;
            d[i] = v - rem;
            removed += rem;
          }
        }
      }
    }
    if (removed > 0) {
      removed *= this.CELL_AREA;
      this.total -= removed;
      this.markEdit(ix0, ix1, iz0, iz1);
    }
    return removed;
  }

  addSnow(x: number, z: number, radius: number, volume: number): void {
    if (volume <= 0) return;
    const { V, CELL, HALF, INV_CELL } = this;
    const r = Math.max(radius, CELL * 1.2);
    const r2 = r * r;
    const ix0 = Math.max(EDGE, Math.floor((x - r + HALF) * INV_CELL));
    const ix1 = Math.min(V - 1 - EDGE, Math.ceil((x + r + HALF) * INV_CELL));
    const iz0 = Math.max(EDGE, Math.floor((z - r + HALF) * INV_CELL));
    const iz1 = Math.min(V - 1 - EDGE, Math.ceil((z + r + HALF) * INV_CELL));
    if (ix0 > ix1 || iz0 > iz1) return;
    const invR2 = 1 / r2;
    // pass 1: total weight
    let wsum = 0;
    for (let iz = iz0; iz <= iz1; iz++) {
      const dz = -HALF + iz * CELL - z;
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = -HALF + ix * CELL - x;
        const q = (dx * dx + dz * dz) * invR2;
        if (q < 1) {
          const w = 1 - q;
          wsum += w * w;
        }
      }
    }
    if (wsum <= 0) return;
    const k = volume / (wsum * this.CELL_AREA);
    const cap = this.addCap;
    const d = this.depth;
    let added = 0;
    for (let iz = iz0; iz <= iz1; iz++) {
      const dz = -HALF + iz * CELL - z;
      const row = iz * V;
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = -HALF + ix * CELL - x;
        const q = (dx * dx + dz * dz) * invR2;
        if (q < 1) {
          const w = 1 - q;
          const i = row + ix;
          const v = d[i];
          if (v < cap) {
            let nv = v + k * w * w;
            if (nv > cap) nv = cap;
            d[i] = nv;
            added += nv - v;
          }
        }
      }
    }
    if (added > 0) {
      this.total += added * this.CELL_AREA;
      this.markEdit(ix0, ix1, iz0, iz1);
    }
  }

  melt(x: number, z: number, radius: number, amount: number): void {
    if (amount <= 0) return;
    const { V, CELL, HALF, INV_CELL } = this;
    const r = Math.max(radius, CELL * 0.5);
    const r2 = r * r;
    const ix0 = Math.max(EDGE, Math.floor((x - r + HALF) * INV_CELL));
    const ix1 = Math.min(V - 1 - EDGE, Math.ceil((x + r + HALF) * INV_CELL));
    const iz0 = Math.max(EDGE, Math.floor((z - r + HALF) * INV_CELL));
    const iz1 = Math.min(V - 1 - EDGE, Math.ceil((z + r + HALF) * INV_CELL));
    if (ix0 > ix1 || iz0 > iz1) return;
    const invR = 1 / r;
    const d = this.depth;
    let removed = 0;
    for (let iz = iz0; iz <= iz1; iz++) {
      const dz = -HALF + iz * CELL - z;
      const row = iz * V;
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = -HALF + ix * CELL - x;
        const q = dx * dx + dz * dz;
        if (q <= r2) {
          const i = row + ix;
          const v = d[i];
          if (v > 0) {
            const m = amount * (1 - Math.sqrt(q) * invR);
            const nv = v > m ? v - m : 0;
            removed += v - nv;
            d[i] = nv;
          }
        }
      }
    }
    if (removed > 0) {
      this.total -= removed * this.CELL_AREA;
      this.markEdit(ix0, ix1, iz0, iz1);
    }
  }

  /* ------------------------------------------------------------------ update */

  update(dt: number): void {
    this.regenTimer += dt;
    if (this.regenTimer >= REGEN_INTERVAL) {
      const rate = (this.regenRate ?? this.ctx.stats.snowRegen) * this.ctx.zone.snowRegenMult;
      const step = rate * this.regenTimer;
      this.regenTimer = 0;
      this.regen(step > 0 ? step : 0);
    }
    this.flush();
  }

  /** Grow snow back toward the initial depth (never above it) and recompute the exact arena total. */
  private regen(step: number): void {
    const { V, AX0, AX1, AZ0, AZ1 } = this;
    const d = this.depth;
    const init = this.initial;
    let cx0 = V;
    let cx1 = -1;
    let cz0 = V;
    let cz1 = -1;
    let total = 0;
    for (let iz = EDGE; iz < V - EDGE; iz++) {
      const row = iz * V;
      const inZ = iz >= AZ0 && iz <= AZ1;
      let rx0 = V;
      let rx1 = -1;
      for (let ix = EDGE; ix < V - EDGE; ix++) {
        const i = row + ix;
        let v = d[i];
        if (step > 0) {
          const cap = init[i];
          if (v < cap) {
            v += step;
            if (v > cap) v = cap;
            d[i] = v;
            if (ix < rx0) rx0 = ix;
            rx1 = ix;
          }
        }
        if (inZ && ix >= AX0 && ix <= AX1) total += v;
      }
      if (rx1 >= 0) {
        // flush row runs in vertical bands so far-apart trails don't force a full-field upload
        if (cx1 >= 0 && (iz > cz1 + 2 || rx0 > cx1 + 6 || rx1 < cx0 - 6)) {
          this.markDirty(cx0, cx1, cz0, cz1);
          cx0 = V;
          cx1 = -1;
          cz0 = V;
        }
        if (rx0 < cx0) cx0 = rx0;
        if (rx1 > cx1) cx1 = rx1;
        if (iz < cz0) cz0 = iz;
        cz1 = iz;
      }
    }
    // exact running total over the playable arena (avoids float drift and ignores snow outside the walls)
    this.total = total * this.CELL_AREA;
    if (cx1 >= 0) this.markDirty(cx0, cx1, cz0, cz1);
  }

  /** Push the dirty rects (heights, normals, colors) to the GPU. */
  private flush(): void {
    const n = this.rectCount;
    if (n === 0) return;
    this.rectCount = 0;
    const r = this.rects;
    const V = this.V;
    for (let k = 0; k < n; k++) {
      const o = k * 4;
      this.flushRect(Math.max(0, r[o] - 1), Math.min(V - 1, r[o + 1] + 1), Math.max(0, r[o + 2] - 1), Math.min(V - 1, r[o + 3] + 1));
    }
    for (const a of this.attrs) a.needsUpdate = true;
  }

  private flushRect(x0: number, x1: number, z0: number, z1: number): void {
    const V = this.V;
    const d = this.depth;
    const pos = this.posAttr.array as Float32Array;
    const nor = this.normAttr.array as Float32Array;
    const col = this.colAttr.array as Float32Array;
    const lut = this.lut;
    const sp = this.sparkle;
    const lutScale = (LUT_SIZE - 1) / LUT_MAX_DEPTH;
    const inv2c = 1 / (2 * this.CELL);
    for (let iz = z0; iz <= z1; iz++) {
      const row = iz * V;
      const up = iz > 0 ? row - V : row;
      const dn = iz < V - 1 ? row + V : row;
      for (let ix = x0; ix <= x1; ix++) {
        const i = row + ix;
        const h = d[i];
        const i3 = i * 3;
        pos[i3 + 1] = h;
        const hl = d[ix > 0 ? i - 1 : i];
        const hr = d[ix < V - 1 ? i + 1 : i];
        const hu = d[up + ix];
        const hd = d[dn + ix];
        const nx = (hl - hr) * inv2c;
        const nz = (hu - hd) * inv2c;
        const il = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
        nor[i3] = nx * il;
        nor[i3 + 1] = il;
        nor[i3 + 2] = nz * il;
        let li = (h * lutScale) | 0;
        if (li > LUT_SIZE - 1) li = LUT_SIZE - 1;
        else if (li < 0) li = 0;
        // slight shading: concave (lower than neighbours) gets a touch of blue shadow
        const curv = (hl + hr + hu + hd) * 0.25 - h;
        const s = sp[i] - (curv > 0 ? Math.min(0.12, curv * 1.5) : 0);
        const l3 = li * 3;
        col[i3] = lut[l3] * s;
        col[i3 + 1] = lut[l3 + 1] * s;
        col[i3 + 2] = lut[l3 + 2] * (s + (curv > 0 ? Math.min(0.06, curv * 0.8) : 0));
      }
    }
    // upload only the touched span of each row band (ranges are cleared by the renderer after upload)
    const start = (z0 * V + x0) * 3;
    const count = ((z1 - z0) * V + (x1 - x0) + 1) * 3;
    for (const a of this.attrs) a.addUpdateRange(start, count);
  }
}

/** Merge (x0..x1, z0..z1) into an overlapping / nearby rect of `r` (`n` used), else append one (merge into the
 *  cheapest when full). Returns the new count. */
function mergeRect(r: Int32Array, n: number, x0: number, x1: number, z0: number, z1: number): number {
  const pad = 3;
  let best = -1;
  let bestCost = Infinity;
  for (let k = 0; k < n; k++) {
    const o = k * 4;
    if (x0 <= r[o + 1] + pad && x1 >= r[o] - pad && z0 <= r[o + 3] + pad && z1 >= r[o + 2] - pad) {
      best = k;
      bestCost = -1;
      break;
    }
    if (n >= MAX_RECTS) {
      const nx = Math.max(x1, r[o + 1]) - Math.min(x0, r[o]);
      const nz = Math.max(z1, r[o + 3]) - Math.min(z0, r[o + 2]);
      const cost = nx * nz - (r[o + 1] - r[o]) * (r[o + 3] - r[o + 2]);
      if (cost < bestCost) {
        bestCost = cost;
        best = k;
      }
    }
  }
  if (best < 0) {
    const o = n * 4;
    r[o] = x0;
    r[o + 1] = x1;
    r[o + 2] = z0;
    r[o + 3] = z1;
    return n + 1;
  }
  const o = best * 4;
  if (x0 < r[o]) r[o] = x0;
  if (x1 > r[o + 1]) r[o + 1] = x1;
  if (z0 < r[o + 2]) r[o + 2] = z0;
  if (z1 > r[o + 3]) r[o + 3] = z1;
  return n;
}

