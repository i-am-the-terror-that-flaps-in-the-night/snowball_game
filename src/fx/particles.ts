import * as THREE from 'three';

/* GPU particle batches for Fx. Each effect type is ONE Mesh over an InstancedBufferGeometry (a single quad,
 * instanced) with a fixed max count, allocated once. The CPU simulates the live prefix [0, n) with swap-remove
 * and uploads only that range each frame (addUpdateRange); geometry.instanceCount = n and the mesh hides at 0,
 * so an idle batch costs no draw call.
 *
 * Billboards and streaks are oriented in the vertex shader from viewMatrix, i.e. the camera as it is at render
 * time, so they never lag a frame even when Fx.update runs before the camera rig.
 *
 * Blending: puffs, sparks and rings use premultiplied alpha (ONE, ONE_MINUS_SRC_ALPHA). A per-particle "add"
 * factor scales the written alpha, so 0 = normal alpha blending (smoke, snow powder) and 1 = pure additive
 * (fire, glow) inside the same draw call. */

export const MAX_SPARKS = 600;
export const MAX_PUFFS = 400;
export const MAX_RINGS = 32;
export const MAX_SCORCH = 24;

const _c = new THREE.Color();

/** Unit quad: x,y in [-1, 1] (z = 0), two triangles. */
function quadGeometry(): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.instanceCount = 0;
  return g;
}

function instAttr(g: THREE.InstancedBufferGeometry, name: string, max: number, size: number): THREE.InstancedBufferAttribute {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(max * size), size);
  a.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute(name, a);
  return a;
}

/** Mark only the live prefix of each attribute for upload. */
function uploadLive(n: number, attrs: THREE.InstancedBufferAttribute[]): void {
  if (n <= 0) return;
  for (const a of attrs) {
    a.clearUpdateRanges();
    a.addUpdateRange(0, n * a.itemSize);
    a.needsUpdate = true;
  }
}

function premulMaterial(opts: THREE.ShaderMaterialParameters): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    ...opts,
  });
}

function batchMesh(g: THREE.BufferGeometry, m: THREE.Material, order: number): THREE.Mesh {
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = order;
  mesh.visible = false;
  mesh.name = 'fx-batch';
  // Fx batches are not pickable.
  mesh.raycast = () => {};
  return mesh;
}

/* ------------------------------------------------------------------ textures (procedural, no assets) */

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function dataTexture(size: number, fn: (u: number, v: number) => number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = Math.max(0, Math.min(1, fn((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1)));
      const i = (y * size + x) * 4;
      const b = Math.round(v * 255);
      data[i] = b; data[i + 1] = b; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Soft cloudy puff: radial falloff broken up by a few soft lumps. */
function puffTexture(): THREE.DataTexture {
  const r = rng(7);
  const blobs: number[] = [];
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2;
    const d = 0.15 + r() * 0.4;
    blobs.push(Math.cos(a) * d, Math.sin(a) * d, 0.22 + r() * 0.2, 0.5 + r() * 0.5);
  }
  return dataTexture(64, (u, v) => {
    const d2 = u * u + v * v;
    if (d2 >= 1) return 0;
    const fall = (1 - d2) * (1 - d2);
    let lump = 0.45 * Math.exp(-d2 * 3);
    for (let i = 0; i < blobs.length; i += 4) {
      const dx = u - blobs[i], dy = v - blobs[i + 1], s = blobs[i + 2];
      lump += blobs[i + 3] * Math.exp(-(dx * dx + dy * dy) / (s * s));
    }
    return fall * Math.min(1, lump * 0.75);
  });
}

/** Irregular soot blotch with radial streaks for scorch decals. */
function scorchTexture(): THREE.DataTexture {
  const r = rng(31);
  const rays: number[] = [];
  for (let i = 0; i < 11; i++) rays.push(r() * Math.PI * 2, 0.72 + r() * 0.26, 0.16 + r() * 0.22);
  const blobs: number[] = [];
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2;
    const d = 0.2 + r() * 0.35;
    blobs.push(Math.cos(a) * d, Math.sin(a) * d, 0.18 + r() * 0.2);
  }
  return dataTexture(128, (u, v) => {
    const d = Math.hypot(u, v);
    if (d >= 1) return 0;
    const ang = Math.atan2(v, u);
    let reach = 0.62;
    for (let i = 0; i < rays.length; i += 3) {
      let da = Math.abs(ang - rays[i]);
      if (da > Math.PI) da = Math.PI * 2 - da;
      reach = Math.max(reach, rays[i + 1] * Math.exp(-(da * da) / (rays[i + 2] * rays[i + 2])));
    }
    for (let i = 0; i < blobs.length; i += 3) {
      const dx = u - blobs[i], dy = v - blobs[i + 1];
      if (Math.hypot(dx, dy) < blobs[i + 2]) reach = Math.max(reach, d + 0.12);
    }
    const core = 1 - THREE.MathUtils.smoothstep(d, reach * 0.25, reach);
    const grain = 0.82 + 0.18 * Math.sin(u * 37 + Math.sin(v * 23) * 2) * Math.sin(v * 41 + u * 7);
    return core * grain * (1 - THREE.MathUtils.smoothstep(d, 0.85, 1));
  });
}

/* ------------------------------------------------------------------ shared GLSL */

const FOG_VERT = /* glsl */ `
varying float vFogDepth;
`;
const FOG_FRAG = /* glsl */ `
#ifdef USE_FOG
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform float fogDensity;
#endif
varying float vFogDepth;
float fxFog() {
#ifdef USE_FOG
  #ifdef FOG_EXP2
  return 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
  return smoothstep(fogNear, fogFar, vFogDepth);
  #endif
#else
  return 0.0;
#endif
}
vec3 fxFogColor() {
#ifdef USE_FOG
  return fogColor;
#else
  return vec3(0.0);
#endif
}
`;

/* ------------------------------------------------------------------ sparks */

/** Thin bright streaks stretched along their velocity (metal hits, lightning impacts, embers). */
export class SparkBatch {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private aHead: THREE.InstancedBufferAttribute;
  private aTail: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  n = 0;
  private px = new Float32Array(MAX_SPARKS);
  private py = new Float32Array(MAX_SPARKS);
  private pz = new Float32Array(MAX_SPARKS);
  private vx = new Float32Array(MAX_SPARKS);
  private vy = new Float32Array(MAX_SPARKS);
  private vz = new Float32Array(MAX_SPARKS);
  private age = new Float32Array(MAX_SPARKS);
  private life = new Float32Array(MAX_SPARKS);
  private width = new Float32Array(MAX_SPARKS);
  private stretch = new Float32Array(MAX_SPARKS);
  private grav = new Float32Array(MAX_SPARKS);
  private drag = new Float32Array(MAX_SPARKS);
  private col = new Float32Array(MAX_SPARKS * 3);

  constructor() {
    const g = (this.geo = quadGeometry());
    this.aHead = instAttr(g, 'iHead', MAX_SPARKS, 4);
    this.aTail = instAttr(g, 'iTail', MAX_SPARKS, 3);
    this.aCol = instAttr(g, 'iColor', MAX_SPARKS, 4);
    const mat = premulMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: /* glsl */ `
        attribute vec4 iHead;
        attribute vec3 iTail;
        attribute vec4 iColor;
        varying vec2 vQ;
        varying vec4 vColor;
        ${FOG_VERT}
        void main() {
          vec4 h = viewMatrix * vec4(iHead.xyz, 1.0);
          vec4 t = viewMatrix * vec4(iHead.xyz - iTail, 1.0);
          vec2 d = h.xy - t.xy;
          float L = length(d);
          vec2 dir = L > 1e-5 ? d / L : vec2(1.0, 0.0);
          vec2 perp = vec2(-dir.y, dir.x);
          float w = iHead.w;
          float a = position.x * 0.5 + 0.5;
          vec4 p = mix(t, h, a);
          // Tapered: full width at the head, a thin tail.
          p.xy += dir * position.x * w + perp * position.y * w * mix(0.25, 1.0, a);
          vQ = position.xy;
          vColor = iColor;
          vFogDepth = -p.z;
          gl_Position = projectionMatrix * p;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vQ;
        varying vec4 vColor;
        ${FOG_FRAG}
        void main() {
          float across = 1.0 - vQ.y * vQ.y;
          float along = 0.25 + 0.75 * (vQ.x * 0.5 + 0.5);
          float a = across * across * along * vColor.a * (1.0 - fxFog());
          if (a < 0.004) discard;
          gl_FragColor = vec4(vColor.rgb, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          // Mostly additive, with a little coverage so hot colours still read over white snow.
          gl_FragColor = vec4(gl_FragColor.rgb * a, a * 0.75);
        }`,
    });
    this.mesh = batchMesh(g, mat, 5);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, width: number, stretch: number, gravity: number, drag: number, r: number, g: number, b: number): void {
    let i = this.n;
    if (i >= MAX_SPARKS) i = (Math.random() * MAX_SPARKS) | 0;
    else this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.width[i] = width; this.stretch[i] = stretch;
    this.grav[i] = gravity; this.drag[i] = drag;
    const j = i * 3;
    this.col[j] = r; this.col[j + 1] = g; this.col[j + 2] = b;
  }

  update(dt: number, ground: (x: number, z: number) => number): void {
    const { px, py, pz, vx, vy, vz, age, life, width, stretch, grav, drag, col } = this;
    const H = this.aHead.array as Float32Array;
    const T = this.aTail.array as Float32Array;
    const C = this.aCol.array as Float32Array;
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
      if (vy[i] < 0 && py[i] < 2.5) {
        const fl = ground(px[i], pz[i]) + 0.04;
        if (py[i] < fl) {
          py[i] = fl;
          vy[i] *= -0.35;
          vx[i] *= 0.6; vz[i] *= 0.6;
          life[i] = Math.min(life[i], age[i] + 0.12); // sparks die shortly after hitting snow
        }
      }
      const f = age[i] / life[i];
      const k = 1 - f;
      // Hot white core early, cooling to the base colour.
      const hot = Math.max(0, 1 - f * 4) * 0.45;
      const e = 1.1 * k + 0.5;
      const j = i * 3, h = i * 4;
      H[h] = px[i]; H[h + 1] = py[i]; H[h + 2] = pz[i]; H[h + 3] = width[i] * (0.6 + 0.4 * k);
      let tx = vx[i] * stretch[i], ty = vy[i] * stretch[i], tz = vz[i] * stretch[i];
      const L = Math.hypot(tx, ty, tz);
      if (L > 1.6) {
        const s = 1.6 / L;
        tx *= s; ty *= s; tz *= s;
      }
      T[j] = tx; T[j + 1] = ty; T[j + 2] = tz;
      C[h] = (col[j] + hot) * e; C[h + 1] = (col[j + 1] + hot) * e; C[h + 2] = (col[j + 2] + hot) * e;
      C[h + 3] = Math.min(1, k * 1.5);
      i++;
    }
    this.finish();
  }

  private finish(): void {
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    uploadLive(this.n, [this.aHead, this.aTail, this.aCol]);
  }

  clear(): void {
    this.n = 0;
    this.finish();
  }

  private kill(i: number): void {
    const l = --this.n;
    if (i === l) return;
    this.px[i] = this.px[l]; this.py[i] = this.py[l]; this.pz[i] = this.pz[l];
    this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l]; this.vz[i] = this.vz[l];
    this.age[i] = this.age[l]; this.life[i] = this.life[l]; this.width[i] = this.width[l]; this.stretch[i] = this.stretch[l];
    this.grav[i] = this.grav[l]; this.drag[i] = this.drag[l];
    const a = i * 3, b = l * 3;
    this.col[a] = this.col[b]; this.col[a + 1] = this.col[b + 1]; this.col[a + 2] = this.col[b + 2];
  }
}

/* ------------------------------------------------------------------ soft puffs */

/** Camera-facing soft billboards that grow and fade: smoke, dust, snow powder, fire glow. */
export class PuffBatch {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private aPos: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  private aMisc: THREE.InstancedBufferAttribute;
  n = 0;
  private px = new Float32Array(MAX_PUFFS);
  private py = new Float32Array(MAX_PUFFS);
  private pz = new Float32Array(MAX_PUFFS);
  private vx = new Float32Array(MAX_PUFFS);
  private vy = new Float32Array(MAX_PUFFS);
  private vz = new Float32Array(MAX_PUFFS);
  private age = new Float32Array(MAX_PUFFS);
  private life = new Float32Array(MAX_PUFFS);
  private s0 = new Float32Array(MAX_PUFFS);
  private s1 = new Float32Array(MAX_PUFFS);
  private rise = new Float32Array(MAX_PUFFS);
  private drag = new Float32Array(MAX_PUFFS);
  private rot = new Float32Array(MAX_PUFFS);
  private rotV = new Float32Array(MAX_PUFFS);
  private alpha = new Float32Array(MAX_PUFFS);
  private add = new Float32Array(MAX_PUFFS);
  private col = new Float32Array(MAX_PUFFS * 3);

  constructor() {
    const g = (this.geo = quadGeometry());
    this.aPos = instAttr(g, 'iPos', MAX_PUFFS, 4);
    this.aCol = instAttr(g, 'iColor', MAX_PUFFS, 4);
    this.aMisc = instAttr(g, 'iMisc', MAX_PUFFS, 2);
    const mat = premulMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]),
      vertexShader: /* glsl */ `
        attribute vec4 iPos;
        attribute vec4 iColor;
        attribute vec2 iMisc;
        varying vec2 vUv;
        varying vec4 vColor;
        varying float vAdd;
        varying float vShade;
        ${FOG_VERT}
        void main() {
          vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
          float c = cos(iMisc.x), s = sin(iMisc.x);
          vec2 o = mat2(c, s, -s, c) * position.xy;
          mv.xy += o * iPos.w;
          vShade = o.y;
          vUv = position.xy * 0.5 + 0.5;
          vColor = iColor;
          vAdd = iMisc.y;
          vFogDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec2 vUv;
        varying vec4 vColor;
        varying float vAdd;
        varying float vShade;
        ${FOG_FRAG}
        void main() {
          vec4 tex = texture2D(map, vUv);
          float a = tex.r * vColor.a;
          if (a < 0.003) discard;
          float f = fxFog();
          // Fake volume: lit top, shaded underside and thin edges (not for additive glow).
          float lit = mix(0.5, 1.12, clamp(vShade * 0.5 + 0.5, 0.0, 1.0)) * mix(0.8, 1.0, tex.r);
          vec3 col = vColor.rgb * mix(lit, 1.0, vAdd);
          col = mix(col, fxFogColor(), f * (1.0 - vAdd));
          a *= 1.0 - f * vAdd;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          gl_FragColor = vec4(gl_FragColor.rgb * a, a * (1.0 - vAdd));
        }`,
    });
    mat.uniforms.map.value = puffTexture();
    this.mesh = batchMesh(g, mat, 4);
  }

  /** Index to write: the next free slot, or (when full) the most-faded of a few random samples. */
  private slot(): number {
    if (this.n < MAX_PUFFS) return this.n++;
    let best = 0, bf = -1;
    for (let k = 0; k < 5; k++) {
      const i = (Math.random() * MAX_PUFFS) | 0;
      const f = this.age[i] / this.life[i];
      if (f > bf) { bf = f; best = i; }
    }
    return best;
  }

  emit(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    life: number, size0: number, size1: number, rise: number, drag: number,
    r: number, g: number, b: number, alpha: number, add: number,
  ): void {
    const i = this.slot();
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = size0; this.s1[i] = size1;
    this.rise[i] = rise; this.drag[i] = drag;
    this.rot[i] = Math.random() * 6.283; this.rotV[i] = (Math.random() - 0.5) * 1.6;
    this.alpha[i] = alpha; this.add[i] = add;
    const j = i * 3;
    this.col[j] = r; this.col[j + 1] = g; this.col[j + 2] = b;
  }

  update(dt: number, ground: (x: number, z: number) => number): void {
    const { px, py, pz, vx, vy, vz, age, life, s0, s1, rise, drag, rot, rotV, alpha, add, col } = this;
    const P = this.aPos.array as Float32Array;
    const C = this.aCol.array as Float32Array;
    const M = this.aMisc.array as Float32Array;
    let i = 0;
    while (i < this.n) {
      age[i] += dt;
      if (age[i] >= life[i]) {
        this.kill(i);
        continue;
      }
      const dr = Math.max(0, 1 - drag[i] * dt);
      vx[i] *= dr; vz[i] *= dr;
      vy[i] = vy[i] * dr + rise[i] * dt;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      rot[i] += rotV[i] * dt;
      const f = age[i] / life[i];
      const g = 1 - (1 - f) * (1 - f);
      const s = s0[i] + (s1[i] - s0[i]) * g;
      if (py[i] < 3 + s) {
        const fl = ground(px[i], pz[i]) + s * 0.35;
        if (py[i] < fl) {
          py[i] = fl;
          if (vy[i] < 0) vy[i] = 0;
        }
      }
      const fadeIn = Math.min(1, f * 10);
      const a = alpha[i] * fadeIn * Math.pow(1 - f, 1.4);
      const j = i * 3, h = i * 4, m = i * 2;
      P[h] = px[i]; P[h + 1] = py[i]; P[h + 2] = pz[i]; P[h + 3] = s;
      C[h] = col[j]; C[h + 1] = col[j + 1]; C[h + 2] = col[j + 2]; C[h + 3] = a;
      M[m] = rot[i]; M[m + 1] = add[i];
      i++;
    }
    this.finish();
  }

  private finish(): void {
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    uploadLive(this.n, [this.aPos, this.aCol, this.aMisc]);
  }

  clear(): void {
    this.n = 0;
    this.finish();
  }

  private kill(i: number): void {
    const l = --this.n;
    if (i === l) return;
    this.px[i] = this.px[l]; this.py[i] = this.py[l]; this.pz[i] = this.pz[l];
    this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l]; this.vz[i] = this.vz[l];
    this.age[i] = this.age[l]; this.life[i] = this.life[l]; this.s0[i] = this.s0[l]; this.s1[i] = this.s1[l];
    this.rise[i] = this.rise[l]; this.drag[i] = this.drag[l]; this.rot[i] = this.rot[l]; this.rotV[i] = this.rotV[l];
    this.alpha[i] = this.alpha[l]; this.add[i] = this.add[l];
    const a = i * 3, b = l * 3;
    this.col[a] = this.col[b]; this.col[a + 1] = this.col[b + 1]; this.col[a + 2] = this.col[b + 2];
  }
}

/* ------------------------------------------------------------------ shockwave rings */

/** Ground shockwaves: a thin bright band that races outward, a soft inner falloff and a faint dark leading edge
 *  so even white rings read on white snow. */
export class RingBatch {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private aPos: THREE.InstancedBufferAttribute;
  private aCol: THREE.InstancedBufferAttribute;
  private aParam: THREE.InstancedBufferAttribute;
  n = 0;
  private x = new Float32Array(MAX_RINGS);
  private y = new Float32Array(MAX_RINGS);
  private z = new Float32Array(MAX_RINGS);
  private radius = new Float32Array(MAX_RINGS);
  private age = new Float32Array(MAX_RINGS);
  private life = new Float32Array(MAX_RINGS);
  private col = new Float32Array(MAX_RINGS * 3);

  constructor() {
    const g = (this.geo = quadGeometry());
    this.aPos = instAttr(g, 'iPos', MAX_RINGS, 4);
    this.aCol = instAttr(g, 'iColor', MAX_RINGS, 4);
    this.aParam = instAttr(g, 'iParam', MAX_RINGS, 2);
    const mat = premulMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: /* glsl */ `
        attribute vec4 iPos;
        attribute vec4 iColor;
        attribute vec2 iParam;
        varying vec2 vQ;
        varying vec4 vColor;
        varying vec2 vParam;
        ${FOG_VERT}
        void main() {
          vec3 w = iPos.xyz + vec3(position.x, 0.0, -position.y) * iPos.w * 1.25;
          vec4 mv = viewMatrix * vec4(w, 1.0);
          vQ = position.xy * 1.25;
          vColor = iColor;
          vParam = iParam;
          vFogDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vQ;
        varying vec4 vColor;
        varying vec2 vParam;
        ${FOG_FRAG}
        void main() {
          float d = length(vQ);
          float w = vParam.x;
          float t = vParam.y;
          float x = (d - 1.0) / w;
          float band = exp(-x * x * 1.6);
          float inner = d < 1.0 ? pow(d, 3.0) * (0.22 + 0.5 * (1.0 - t)) : 0.0;
          float lead = (d - 1.0 - w * 1.4) / (w * 1.2);
          float dark = exp(-lead * lead) * 0.22;
          float A = vColor.a * (1.0 - fxFog());
          float light = (band + inner) * A;
          if (light + dark * A < 0.004) discard;
          gl_FragColor = vec4(vColor.rgb * (1.0 + band * 0.8), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          gl_FragColor = vec4(gl_FragColor.rgb * light, min(1.0, (band * 0.85 + inner * 0.5 + dark) * A));
        }`,
    });
    this.mesh = batchMesh(g, mat, 3);
  }

  spawn(x: number, y: number, z: number, radius: number, color: number): void {
    let i = this.n;
    if (i >= MAX_RINGS) {
      // Recycle the most-finished ring.
      i = 0;
      for (let k = 1; k < MAX_RINGS; k++) if (this.age[k] / this.life[k] > this.age[i] / this.life[i]) i = k;
    } else this.n++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.radius[i] = Math.max(0.1, radius);
    this.age[i] = 0;
    this.life[i] = 0.45 + Math.min(0.5, radius * 0.04);
    _c.set(color);
    const j = i * 3;
    this.col[j] = _c.r; this.col[j + 1] = _c.g; this.col[j + 2] = _c.b;
  }

  update(dt: number): void {
    const P = this.aPos.array as Float32Array;
    const C = this.aCol.array as Float32Array;
    const Q = this.aParam.array as Float32Array;
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) {
        this.kill(i);
        continue;
      }
      const e = 1 - Math.pow(1 - t, 3);
      const R = this.radius[i] * (0.12 + 0.88 * e);
      const h = i * 4, j = i * 3;
      P[h] = this.x[i]; P[h + 1] = this.y[i]; P[h + 2] = this.z[i]; P[h + 3] = R;
      C[h] = this.col[j]; C[h + 1] = this.col[j + 1]; C[h + 2] = this.col[j + 2];
      C[h + 3] = 0.95 * Math.pow(1 - t, 1.3);
      // Band width in ring-radius units: ~0.35 m thick, thinning as it fades.
      Q[i * 2] = Math.min(0.2, Math.max(0.025, (0.42 - 0.2 * t) / R));
      Q[i * 2 + 1] = t;
      i++;
    }
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    uploadLive(this.n, [this.aPos, this.aCol, this.aParam]);
  }

  clear(): void {
    this.n = 0;
    this.geo.instanceCount = 0;
    this.mesh.visible = false;
  }

  private kill(i: number): void {
    const l = --this.n;
    if (i === l) return;
    this.x[i] = this.x[l]; this.y[i] = this.y[l]; this.z[i] = this.z[l];
    this.radius[i] = this.radius[l]; this.age[i] = this.age[l]; this.life[i] = this.life[l];
    const a = i * 3, b = l * 3;
    this.col[a] = this.col[b]; this.col[a + 1] = this.col[b + 1]; this.col[a + 2] = this.col[b + 2];
  }
}

/* ------------------------------------------------------------------ scorch decals */

const SCORCH_LIFE = 8;

/** Dark soot decals on the snow (explosions, wrecks). Flat quads just above the snow with polygonOffset, so the
 *  snow field's vertex colours are never touched. */
export class ScorchBatch {
  readonly mesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private aPos: THREE.InstancedBufferAttribute;
  private aMisc: THREE.InstancedBufferAttribute;
  n = 0;
  private x = new Float32Array(MAX_SCORCH);
  private y = new Float32Array(MAX_SCORCH);
  private z = new Float32Array(MAX_SCORCH);
  private radius = new Float32Array(MAX_SCORCH);
  private rot = new Float32Array(MAX_SCORCH);
  private age = new Float32Array(MAX_SCORCH);
  private strength = new Float32Array(MAX_SCORCH);

  constructor() {
    const g = (this.geo = quadGeometry());
    this.aPos = instAttr(g, 'iPos', MAX_SCORCH, 4);
    this.aMisc = instAttr(g, 'iMisc', MAX_SCORCH, 2);
    const mat = premulMaterial({
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]),
      vertexShader: /* glsl */ `
        attribute vec4 iPos;
        attribute vec2 iMisc;
        varying vec2 vUv;
        varying float vA;
        ${FOG_VERT}
        void main() {
          float c = cos(iMisc.x), s = sin(iMisc.x);
          vec2 q = mat2(c, s, -s, c) * position.xy * iPos.w;
          vec4 mv = viewMatrix * vec4(iPos.x + q.x, iPos.y, iPos.z - q.y, 1.0);
          vUv = position.xy * 0.5 + 0.5;
          vA = iMisc.y;
          vFogDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec2 vUv;
        varying float vA;
        ${FOG_FRAG}
        void main() {
          float m = texture2D(map, vUv).r;
          float a = m * vA * (1.0 - fxFog());
          if (a < 0.004) discard;
          // Soot: near-black core, warm brown at the fringe.
          vec3 col = mix(vec3(0.09, 0.06, 0.045), vec3(0.015, 0.013, 0.012), m);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          gl_FragColor = vec4(gl_FragColor.rgb * a, a);
        }`,
    });
    mat.uniforms.map.value = scorchTexture();
    this.mesh = batchMesh(g, mat, 1);
  }

  spawn(x: number, y: number, z: number, radius: number, strength: number): void {
    let i = this.n;
    if (i >= MAX_SCORCH) {
      i = 0;
      for (let k = 1; k < MAX_SCORCH; k++) if (this.age[k] > this.age[i]) i = k;
    } else this.n++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.radius[i] = radius; this.rot[i] = Math.random() * 6.283;
    this.age[i] = 0; this.strength[i] = Math.min(1, strength);
  }

  update(dt: number, ground: (x: number, z: number) => number): void {
    const P = this.aPos.array as Float32Array;
    const M = this.aMisc.array as Float32Array;
    let i = 0;
    while (i < this.n) {
      this.age[i] += dt;
      const t = this.age[i] / SCORCH_LIFE;
      if (t >= 1) {
        this.kill(i);
        continue;
      }
      // Follow the snow surface (it melts / gets plowed under the decal), never rising above where it landed.
      const gy = ground(this.x[i], this.z[i]) + 0.03;
      if (gy < this.y[i]) this.y[i] = gy;
      const h = i * 4;
      P[h] = this.x[i]; P[h + 1] = this.y[i]; P[h + 2] = this.z[i];
      P[h + 3] = this.radius[i] * (0.85 + 0.15 * Math.min(1, this.age[i] * 8));
      M[i * 2] = this.rot[i];
      M[i * 2 + 1] = this.strength[i] * Math.min(1, this.age[i] * 10) * (t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
      i++;
    }
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    uploadLive(this.n, [this.aPos, this.aMisc]);
  }

  clear(): void {
    this.n = 0;
    this.geo.instanceCount = 0;
    this.mesh.visible = false;
  }

  private kill(i: number): void {
    const l = --this.n;
    if (i === l) return;
    this.x[i] = this.x[l]; this.y[i] = this.y[l]; this.z[i] = this.z[l];
    this.radius[i] = this.radius[l]; this.rot[i] = this.rot[l]; this.age[i] = this.age[l]; this.strength[i] = this.strength[l];
  }
}
