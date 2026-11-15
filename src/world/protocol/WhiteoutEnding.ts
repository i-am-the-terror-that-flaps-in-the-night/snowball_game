import * as THREE from 'three';
import { currentPreset } from '../../core/settings';
import { ARENA } from '../../core/types';
import { densePuffTexture, softPuffTexture } from '../../fx/particles';
import { standIns } from '../../render/standIns';
import { ROWS, ROW_RISE, STAND_N0, ROW_D } from '../environment/layout';

/**
 * THE IMPLOSION (PROTOCOL C finale ending; core/whiteoutDirector.ts drives every value per frame). A visual only:
 *  - SUCK: thousands of storm flakes all over the arena and the sky spiral into one point (the cracked eye), slow at
 *    first, then faster and faster (one additive Points draw, all in the shader);
 *  - CORE: the point itself: a cold star that swells as the storm pours in, shrinks to a pinprick, then FLASHES;
 *  - WAVE: the shockwave: a towering ring of snow billows blasting out from the point across the arena and over the
 *    stands (one Points draw);
 *  - BURIAL: four drifts heaped over the stands to the brim (heightfield strips, risen as the wave passes each one);
 *  - PHONES: the crowd's phone lights popping back on one by one on top of the snow (one additive Points draw;
 *    `lights` 0..1 is how far into the pop-on, each light has its own moment).
 * Built once per scene (prewarm, hidden; warmMeshes() hands the warm-up visible stand-ins), no per-frame allocation.
 * LOW: half the particles.
 */

const SUCK_N = 5000;
const WAVE_N = 1100;
const PHONES_N = 900;
/** Drift strips: segments along the stand, across it. */
const SEG_S = 72;
const SEG_N = 18;
/** The stands' top (the arena's base snow 0.5 + the rows) and the drift's brim over it (m). */
const STAND_TOP = 0.5 + 0.25 + ROWS * ROW_RISE;
const BRIM = STAND_TOP + 1.05;
/** Drift extent across a side (m out from the arena edge: from inside the wall to past the back wall). */
const N_IN = -3;
const N_OUT = STAND_N0 + ROWS * ROW_D + 1.6;

const SUCK_VERT = /* glsl */ `
  uniform float uSuck;
  uniform float uScale;
  uniform vec3 uP;
  attribute vec4 aData;
  varying float vA;
  void main() {
    // position = (angle, radius, height), aData = (delay, spin, size, seed)
    float u = clamp((uSuck * 1.5 - aData.x) / 0.95, 0.0, 1.0);
    float e = u * u * u;
    float r = position.y * (1.0 - e);
    float ang = position.x + aData.y * (u * 1.2 + e * 7.0);
    vec3 p = uP + vec3(cos(ang) * r, mix(position.z, 0.0, e), sin(ang) * r);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float d = -mv.z;
    vA = smoothstep(0.0, 0.1, u) * (1.0 - smoothstep(0.88, 1.0, u)) * smoothstep(1.0, 4.0, d);
    float stretch = 1.0 + e * 1.5;
    gl_PointSize = vA > 0.003 ? clamp(aData.z * stretch * uScale / max(d, 0.5), 1.5, 48.0) : 0.0;
    gl_Position = projectionMatrix * mv;
  }`;
const SUCK_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying float vA;
  void main() {
    float m = texture2D(uMap, gl_PointCoord).g;
    float a = m * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vec3(0.8, 0.92, 1.0) * 1.6 * a, a);
  }`;

const WAVE_VERT = /* glsl */ `
  uniform float uR;
  uniform float uH;
  uniform float uScale;
  uniform float uTime;
  uniform vec3 uP;
  attribute vec4 aData;
  varying float vShade;
  varying float vSeed;
  varying float vFade;
  void main() {
    // position = (angle, height share, radial jitter), aData = (size, seed, churn, -)
    float ang = position.x + sin(uTime * 2.0 + aData.y * 30.0) * 0.01;
    float rr = uR + position.z * (1.6 + uR * 0.05) - position.y * uR * 0.04;
    float h = position.y * uH * (1.0 - 0.35 * abs(position.z)) + sin(uTime * 3.0 + aData.y * 50.0) * 0.4;
    vec3 p = uP + vec3(cos(ang) * rr, h, sin(ang) * rr);
    vShade = clamp(0.45 + position.y * 0.5 + aData.z * 0.2, 0.0, 1.0);
    vSeed = aData.y;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float d = -mv.z;
    vFade = smoothstep(2.0, 7.0, d);
    gl_PointSize = clamp(aData.x * (0.8 + uH * 0.06) * uScale / max(d, 0.5), 1.0, 900.0);
    gl_Position = projectionMatrix * mv;
  }`;
const WAVE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uAlpha;
  varying float vShade;
  varying float vSeed;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = vSeed * 6.2831;
    c = mat2(cos(r), -sin(r), sin(r), cos(r)) * c;
    float m = texture2D(uMap, c + 0.5).g;
    float a = m * uAlpha * vFade;
    if (a < 0.01) discard;
    vec3 col = mix(vec3(0.42, 0.5, 0.64), vec3(0.97, 0.99, 1.0), vShade);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const PHONE_VERT = /* glsl */ `
  uniform float uLights;
  uniform float uScale;
  uniform float uTime;
  uniform float uSpan;
  attribute vec3 color;
  attribute vec2 aData;
  varying vec3 vCol;
  void main() {
    // aData = (birth 0..1, seed)
    float age = (uLights - aData.x) * uSpan;
    float on = step(0.0, age);
    float pop = 1.0 + 1.8 * exp(-max(age, 0.0) * 9.0);
    vec3 p = position;
    p.y += abs(sin(uTime * (3.0 + fract(aData.y * 7.0) * 2.5) + aData.y * 20.0)) * 0.22 * on;
    p.x += sin(uTime * 1.3 + aData.y * 11.0) * 0.08;
    float tw = 0.7 + 0.3 * sin(uTime * (1.5 + fract(aData.y * 3.3) * 3.0) + aData.y * 40.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float d = -mv.z;
    vCol = color * tw * on * min(1.0, 0.25 + age * 3.0);
    gl_PointSize = on > 0.5 ? clamp(1.3 * pop * uScale / max(d, 0.5), 3.0, 48.0) : 0.0;
    gl_Position = projectionMatrix * mv;
  }`;
const PHONE_FRAG = /* glsl */ `
  varying vec3 vCol;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float core = smoothstep(0.35, 0.0, r);
    float halo = pow(1.0 - r, 2.2);
    gl_FragColor = vec4(vCol * (halo * 0.75 + core * 1.2), 1.0);
  }`;

interface Drift {
  mesh: THREE.Mesh;
  /** 0..1 risen. */
  k: number;
}

class WhiteoutEnding {
  /** Drive these (the director, every frame). suck 0..1; core: size (m) and brightness; wave radius (m) / height (m) /
   *  alpha; lights 0..1. `point`: where it all goes (the eye). */
  suck = 0;
  coreSize = 0;
  coreGlow = 0;
  waveR = 0;
  waveH = 0;
  waveA = 0;
  lights = 0;
  readonly point = new THREE.Vector3(0, 3.4, -29.8);

  private scene: THREE.Scene | null = null;
  readonly group = new THREE.Group();
  private suckPts!: THREE.Points;
  private suckMat!: THREE.ShaderMaterial;
  private wavePts!: THREE.Points;
  private waveMat!: THREE.ShaderMaterial;
  private phones!: THREE.Points;
  private phoneMat!: THREE.ShaderMaterial;
  private core!: THREE.Sprite;
  private coreMat!: THREE.SpriteMaterial;
  private ring!: THREE.Sprite;
  private ringMat!: THREE.SpriteMaterial;
  private driftMat!: THREE.MeshStandardMaterial;
  private drifts: Drift[] = [];
  private warm: THREE.Object3D[] = [];
  private time = 0;

  prewarm(scene: THREE.Scene): void {
    if (this.scene === scene) return;
    if (!this.suckPts) this.build();
    this.scene = scene;
    scene.add(this.group);
    this.group.visible = false;
  }

  warmMeshes(): THREE.Object3D[] {
    if (!this.suckPts) this.build();
    return this.warm;
  }

  get shown(): boolean {
    return this.group.visible;
  }

  /** On (all parts at rest: nothing drawn until driven) or off. */
  show(on: boolean): void {
    this.group.visible = on;
    this.suck = this.coreSize = this.coreGlow = this.waveR = this.waveH = this.waveA = this.lights = 0;
    for (const d of this.drifts) this.setDrift(d, 0);
    if (!on) return;
    const half = currentPreset().fxScale < 1;
    this.suckPts.geometry.setDrawRange(0, half ? SUCK_N / 2 : SUCK_N);
    this.wavePts.geometry.setDrawRange(0, half ? WAVE_N / 2 : WAVE_N);
    this.phones.geometry.setDrawRange(0, half ? PHONES_N / 2 : PHONES_N);
  }

  /** Side `i` (0 n, 1 s, 2 w, 3 e) buried 0..1. */
  bury(i: number, k: number): void {
    const d = this.drifts[i];
    if (d) this.setDrift(d, k);
  }
  buried(i: number): number {
    return this.drifts[i]?.k ?? 0;
  }

  private setDrift(d: Drift, k: number): void {
    d.k = Math.max(0, Math.min(1, k));
    const e = 1 - (1 - d.k) * (1 - d.k);
    d.mesh.visible = d.k > 0.001;
    d.mesh.scale.y = Math.max(0.001, e);
  }

  /** Per frame (real time). `viewH`: drawing buffer height (px). */
  update(dt: number, camera: THREE.Camera, viewH: number): void {
    if (!this.group.visible) return;
    this.time += dt;
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 60;
    const scale = viewH / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    const su = this.suckMat.uniforms;
    su.uSuck.value = this.suck;
    su.uScale.value = scale;
    su.uP.value.copy(this.point);
    this.suckPts.visible = this.suck > 0 && this.suck < 1.2;
    const wu = this.waveMat.uniforms;
    wu.uR.value = this.waveR;
    wu.uH.value = this.waveH;
    wu.uAlpha.value = this.waveA;
    wu.uScale.value = scale;
    wu.uTime.value = this.time;
    wu.uP.value.set(this.point.x, 0.4, this.point.z);
    this.wavePts.visible = this.waveA > 0.01;
    const pu = this.phoneMat.uniforms;
    pu.uLights.value = this.lights;
    pu.uScale.value = scale;
    pu.uTime.value = this.time;
    this.phones.visible = this.lights > 0;
    // the core: a cold star with a flickering ring
    const on = this.coreGlow > 0.01 && this.coreSize > 0.01;
    this.core.visible = this.ring.visible = on;
    if (on) {
      const fl = 0.85 + 0.15 * Math.sin(this.time * 47) * Math.sin(this.time * 13);
      this.core.position.copy(this.point);
      this.ring.position.copy(this.point);
      this.core.scale.setScalar(this.coreSize * fl);
      this.coreMat.opacity = Math.min(1, this.coreGlow);
      this.ring.scale.setScalar(this.coreSize * (2.2 + 0.4 * Math.sin(this.time * 9)));
      this.ringMat.opacity = Math.min(1, this.coreGlow) * 0.55;
      this.ringMat.rotation = this.time * 3;
    }
  }

  /* ------------------------------------------------------------------ build */

  private build(): void {
    const soft = softPuffTexture();
    const dense = densePuffTexture();
    this.group.name = 'WhiteoutEnding';
    const r = rng(77);
    // SUCK: everywhere round the point, out to beyond the stands and high into the sky
    {
      const pos = new Float32Array(SUCK_N * 3);
      const dat = new Float32Array(SUCK_N * 4);
      for (let i = 0; i < SUCK_N; i++) {
        pos[i * 3] = r() * Math.PI * 2;
        pos[i * 3 + 1] = 8 + Math.pow(r(), 0.7) * 70;
        pos[i * 3 + 2] = -3 + r() * 46;
        dat[i * 4] = r() * 0.5;
        dat[i * 4 + 1] = r() < 0.85 ? 1 : -1;
        dat[i * 4 + 2] = 0.12 + r() * 0.2;
        dat[i * 4 + 3] = r();
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aData', new THREE.BufferAttribute(dat, 4));
      this.suckMat = new THREE.ShaderMaterial({
        name: 'whiteoutSuck',
        uniforms: { uSuck: { value: 0 }, uScale: { value: 900 }, uP: { value: new THREE.Vector3() }, uMap: { value: soft } },
        vertexShader: SUCK_VERT,
        fragmentShader: SUCK_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      });
      this.suckPts = new THREE.Points(g, this.suckMat);
      this.suckPts.frustumCulled = false;
      this.suckPts.renderOrder = 8;
      this.group.add(this.suckPts);
    }
    // WAVE: a ring of billows (angle, height share, radial jitter)
    {
      const pos = new Float32Array(WAVE_N * 3);
      const dat = new Float32Array(WAVE_N * 4);
      for (let i = 0; i < WAVE_N; i++) {
        pos[i * 3] = (i / WAVE_N) * Math.PI * 2 + r() * 0.05;
        pos[i * 3 + 1] = Math.pow(r(), 1.4);
        pos[i * 3 + 2] = (r() - 0.5) * 2;
        dat[i * 4] = 2.2 + r() * 2.6;
        dat[i * 4 + 1] = r();
        dat[i * 4 + 2] = r() - 0.5;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aData', new THREE.BufferAttribute(dat, 4));
      this.waveMat = new THREE.ShaderMaterial({
        name: 'whiteoutWave',
        uniforms: { uR: { value: 0 }, uH: { value: 0 }, uAlpha: { value: 0 }, uScale: { value: 900 }, uTime: { value: 0 }, uP: { value: new THREE.Vector3() }, uMap: { value: dense } },
        vertexShader: WAVE_VERT,
        fragmentShader: WAVE_FRAG,
        transparent: true,
        depthWrite: false,
        fog: false,
      });
      this.wavePts = new THREE.Points(g, this.waveMat);
      this.wavePts.frustumCulled = false;
      this.wavePts.renderOrder = 7;
      this.group.add(this.wavePts);
    }
    // CORE + ring
    this.coreMat = new THREE.SpriteMaterial({ map: soft, color: 0xe6f6ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false, fog: false });
    this.core = new THREE.Sprite(this.coreMat);
    this.core.renderOrder = 20;
    this.ringMat = new THREE.SpriteMaterial({ map: ringTexture(), color: 0x9fdcff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, toneMapped: false, fog: false });
    this.ring = new THREE.Sprite(this.ringMat);
    this.ring.renderOrder = 19;
    this.group.add(this.core, this.ring);
    // BURIAL drifts over the four stands
    this.driftMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0, emissive: 0x7f9fc8, emissiveIntensity: 0.08 });
    const phonePos: number[] = [];
    const phoneCol: number[] = [];
    const phoneDat: number[] = [];
    const sides: [string, number][] = [['n', 0], ['s', 1], ['w', 2], ['e', 3]];
    const perSide = PHONES_N / 4;
    const glow = [0x7fe8ff, 0xffd257, 0xff7ad8, 0x9dff7a];
    for (const [key, si] of sides) {
      const geo = driftGeometry(key, si);
      const mesh = new THREE.Mesh(geo, this.driftMat);
      mesh.receiveShadow = true;
      mesh.visible = false;
      this.group.add(mesh);
      this.drifts.push({ mesh, k: 0 });
      // phone lights held up out of the snow on the drift's top
      for (let i = 0; i < perSide; i++) {
        const s = -ARENA.maxX + 1 + r() * (ARENA.maxX * 2 - 2);
        const n = STAND_N0 + 0.5 + r() * (ROWS * ROW_D - 0.8);
        const [x, z] = sideMap(key, s, n);
        const y = driftHeight(s, n, si) + 0.35 + r() * 0.35;
        phonePos.push(x, y, z);
        const c = new THREE.Color(r() < 0.72 ? 0xfff6e8 : glow[(r() * glow.length) | 0]).multiplyScalar(1.5);
        phoneCol.push(c.r, c.g, c.b);
        // one by one: a few first, then the whole house (the far side last)
        phoneDat.push(Math.min(0.98, Math.pow(r(), 0.75) * 0.9 + (si === 1 ? 0.08 : 0)), r());
      }
    }
    {
      const g = new THREE.BufferGeometry();
      // shuffle-free: the draw range (LOW) keeps every other side's share via an interleave
      const n = phonePos.length / 3;
      const P = new Float32Array(n * 3);
      const C = new Float32Array(n * 3);
      const D = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const side = i % 4;
        const k = Math.floor(i / 4);
        const j = side * perSide + k;
        P.set(phonePos.slice(j * 3, j * 3 + 3), i * 3);
        C.set(phoneCol.slice(j * 3, j * 3 + 3), i * 3);
        D.set(phoneDat.slice(j * 2, j * 2 + 2), i * 2);
      }
      g.setAttribute('position', new THREE.BufferAttribute(P, 3));
      g.setAttribute('color', new THREE.BufferAttribute(C, 3));
      g.setAttribute('aData', new THREE.BufferAttribute(D, 2));
      this.phoneMat = new THREE.ShaderMaterial({
        name: 'whiteoutPhones',
        uniforms: { uLights: { value: 0 }, uScale: { value: 900 }, uTime: { value: 0 }, uSpan: { value: 4 } },
        vertexShader: PHONE_VERT,
        fragmentShader: PHONE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        fog: false,
      });
      this.phones = new THREE.Points(g, this.phoneMat);
      this.phones.frustumCulled = false;
      this.phones.renderOrder = 6;
      this.group.add(this.phones);
    }
    this.warm = standIns([this.group]);
  }

  /** The phones' pop-on span (s): how long `lights` 0 -> 1 takes (the pop's timing). */
  set lightSpan(s: number) {
    if (this.phoneMat) this.phoneMat.uniforms.uSpan.value = s;
  }
}

/* ------------------------------------------------------------------ helpers */

/** (s along the side, n out from the arena edge) -> world (x, z) for side `key`. */
function sideMap(key: string, s: number, n: number): [number, number] {
  switch (key) {
    case 'n':
      return [s, ARENA.minZ - n];
    case 's':
      return [s, ARENA.maxZ + n];
    case 'w':
      return [ARENA.minX - n, s];
    default:
      return [ARENA.maxX + n, s];
  }
}

/** The drift's height (m) at (s, n) on side `si`: banked up the inside of the wall, over the rows to the brim of the
 *  back wall, lumpy, tumbling off behind. */
function driftHeight(s: number, n: number, si: number): number {
  const u = (n - N_IN) / (N_OUT - N_IN);
  let h: number;
  if (n < 0) h = 1.1 + (2.9 - 1.1) * ((n - N_IN) / -N_IN);
  else if (n < STAND_N0 + 1) h = 2.9 + (BRIM - 2.9) * smooth01(n / (STAND_N0 + 1));
  else h = BRIM;
  // the back: drops off past the back wall
  if (u > 0.88) h *= 1 - 0.35 * smooth01((u - 0.88) / 0.12);
  // lumps (the crowd under it) and wind-driven waves
  h += 0.28 * Math.sin(s * 0.9 + si * 2.1) * Math.sin(n * 1.3 + s * 0.31) + 0.22 * Math.sin(s * 0.23 + si) + 0.12 * Math.sin(s * 2.7 + n * 2.1);
  return Math.max(0.2, h);
}

function smooth01(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

function driftGeometry(key: string, si: number): THREE.BufferGeometry {
  const s0 = ARENA.minX - 12;
  const s1 = ARENA.maxX + 12;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= SEG_N; j++) {
    const n = N_IN + ((N_OUT - N_IN) * j) / SEG_N;
    for (let i = 0; i <= SEG_S; i++) {
      const s = s0 + ((s1 - s0) * i) / SEG_S;
      // corners: the end of a side tucks down under its neighbour
      const end = Math.min(s - s0, s1 - s) / 5;
      const h = driftHeight(s, n, si) * smooth01(end);
      const [x, z] = sideMap(key, s, n);
      pos.push(x, h, z);
      const sparkle = 0.95 + 0.05 * Math.sin(s * 5.3 + n * 7.1);
      col.push(0.93 * sparkle, 0.96 * sparkle, 1.0);
    }
  }
  const W = SEG_S + 1;
  for (let j = 0; j < SEG_N; j++) {
    for (let i = 0; i < SEG_S; i++) {
      const a = j * W + i;
      // winding: faces up whichever way the side runs
      if (key === 'n' || key === 'e') idx.push(a, a + 1, a + W, a + 1, a + W + 1, a + W);
      else idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

let _ringTex: THREE.Texture | null = null;
function ringTexture(): THREE.Texture {
  if (_ringTex) return _ringTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    const gr = g.createRadialGradient(64, 64, 30, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.62, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.72, 'rgba(255,255,255,0.25)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
  }
  _ringTex = new THREE.CanvasTexture(c);
  return _ringTex;
}

/** Deterministic build RNG (no gameplay RNG drawn at build time). */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The one ending (built per scene, shown only in THE IMPLOSION). */
export const whiteoutEnding = new WhiteoutEnding();
