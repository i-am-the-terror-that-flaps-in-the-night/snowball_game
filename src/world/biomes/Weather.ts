import * as THREE from 'three';
import type { BiomeParticles } from '../../config/zones';

/**
 * Biome weather: falling snow, ash + rising embers, wind-blown dust, steam, confetti.
 *
 * Fully GPU-driven: every layer is one THREE.Points draw whose particles live in a box that follows the camera. Each
 * particle has a fixed random seed; the vertex shader moves it by (wind, fall) * time, wraps it into the box with
 * mod() and fades it near the box edges, so the CPU only writes three uniforms per layer per frame (no per-particle
 * loop, no buffer uploads). A layer can be masked to one half of the world (The Thermal Divide: steam over the hot
 * west half, snow over the cold east half).
 */

export type WeatherShape = 'soft' | 'confetti' | 'spark';

export interface WeatherLayerDef {
  count: number;
  /** Particle colours (each particle picks one). */
  colors: number[];
  /** Particle size in metres (each particle varies 0.6x..1.4x). */
  size: number;
  /** Downward speed m/s (negative = rising). */
  fall: number;
  /** Horizontal drift m/s (x, z). */
  wind: [number, number];
  /** Side-to-side flutter amplitude, m. */
  sway: number;
  opacity: number;
  shape?: WeatherShape;
  additive?: boolean;
  /** 0..1 twinkle (embers, glints). */
  flicker?: number;
  /** -1 = only over x < 0, 1 = only over x > 0. */
  side?: -1 | 1;
}

/** Wrap box (m): BOX x BOX around the camera, HEIGHT tall starting BELOW m under it. */
const BOX = 70;
const HEIGHT = 36;
const BELOW = 12;

const CONFETTI = [0xc8102e, 0xffffff, 0x1f3b8c, 0xf2c033, 0xff3d7f, 0x22d3ff, 0x7cff5a, 0xff8c00];

/** The layers of a biome's weather. `density` = ZoneDef.snowfall (0..1). */
export function weatherLayers(kind: BiomeParticles, density: number): WeatherLayerDef[] {
  const d = Math.min(1, Math.max(0, density));
  switch (kind) {
    case 'snow':
      return [{ count: Math.round(1500 + d * 6500), colors: [0xffffff], size: 0.13, fall: 1.4, wind: [0.8 + d * 2, 0.4], sway: 0.6, opacity: 0.9 }];
    case 'ash':
      return [
        { count: Math.round(1200 + d * 3500), colors: [0x5e5754, 0x7d7672, 0x9a938e, 0x403a38], size: 0.13, fall: 0.75, wind: [0.7, 0.35], sway: 0.9, opacity: 0.8 },
        { count: Math.round(250 + d * 650), colors: [0xff7a1a, 0xffb02a, 0xff4a10, 0xffd060], size: 0.09, fall: -1.7, wind: [0.5, 0.2], sway: 1.3, opacity: 1, shape: 'spark', additive: true, flicker: 0.65 },
      ];
    case 'dust':
      return [
        { count: Math.round(1800 + d * 4000), colors: [0xc0703f, 0xa85a32, 0xd89060, 0x8a4426], size: 0.075, fall: 0.25, wind: [9, 3], sway: 0.4, opacity: 0.75 },
        { count: 160, colors: [0xd89a70, 0xc88058], size: 6, fall: 0.1, wind: [6, 2], sway: 1.5, opacity: 0.09 },
      ];
    case 'steam':
      return [
        { count: 300, colors: [0xffe8e2, 0xffffff, 0xffd6c8], size: 2.6, fall: -2.2, wind: [0.6, 0.2], sway: 1.4, opacity: 0.16, side: -1 },
        { count: 260, colors: [0xff7a1a, 0xffb02a, 0xff4a10], size: 0.09, fall: -1.6, wind: [0.4, 0.2], sway: 1.2, opacity: 1, shape: 'spark', additive: true, flicker: 0.6, side: -1 },
        { count: Math.round(1200 + d * 3500), colors: [0xffffff, 0xe6f4ff], size: 0.13, fall: 1.5, wind: [1.6, 0.4], sway: 0.6, opacity: 0.9, side: 1 },
      ];
    case 'confetti':
      return [{ count: Math.round(1200 + d * 2800), colors: CONFETTI, size: 0.24, fall: 1.15, wind: [0.6, 0.3], sway: 0.9, opacity: 1, shape: 'confetti' }];
  }
}

/** Aurora-tinted diamond-dust glints for the glacier (added on top of its snow). */
export const GLINTS: WeatherLayerDef = {
  count: 500, colors: [0xd8fbff, 0x7dffc4, 0xb89cff, 0x8ff0ff], size: 0.08, fall: 0.25, wind: [0.6, 0.2], sway: 0.8, opacity: 1, shape: 'spark', additive: true, flicker: 0.85,
};

const VERT = /* glsl */ `
attribute vec4 aSeed;
attribute vec3 aColor;
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uBox;
uniform vec3 uVel;
uniform float uSway;
uniform float uSize;
uniform float uPx;
uniform float uFlicker;
uniform float uSide;
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
varying float vSpin;
void main() {
  float ph = aSeed.w * 100.0;
  float spd = 0.7 + fract(ph * 0.37) * 0.6;
  vec3 p = aSeed.xyz * uBox + uVel * (spd * uTime);
  p.x += sin(uTime * 1.3 + ph) * uSway;
  p.z += cos(uTime * 1.1 + ph * 1.7) * uSway;
  vec3 o = uCam - vec3(uBox.x * 0.5, ${BELOW.toFixed(1)}, uBox.z * 0.5);
  p = o + mod(p - o, uBox);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float a = uOpacity * (1.0 - smoothstep(uBox.x * 0.3, uBox.x * 0.5, length(p.xz - uCam.xz)));
  float yf = (p.y - o.y) / uBox.y;
  a *= smoothstep(0.0, 0.08, yf) * (1.0 - smoothstep(0.88, 1.0, yf));
  if (uSide != 0.0) a *= smoothstep(-2.0, 2.0, p.x * uSide);
  if (uFlicker > 0.0) a *= 1.0 - uFlicker + uFlicker * (0.5 + 0.5 * sin(uTime * (5.0 + fract(ph) * 9.0) + ph));
  vAlpha = a;
  vColor = aColor;
  vSpin = ph + uTime * (1.5 + fract(ph * 3.1) * 3.0);
  gl_PointSize = a <= 0.003 ? 0.0 : uSize * (0.6 + fract(ph * 1.9) * 0.8) * uPx / max(-mv.z, 0.3);
}`;

const FRAG = /* glsl */ `
uniform int uShape;
varying vec3 vColor;
varying float vAlpha;
varying float vSpin;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a;
  vec3 c = vColor;
  if (uShape == 1) {
    // tumbling confetti: a spinning rectangle that flips edge-on
    float cs = cos(vSpin), sn = sin(vSpin);
    q = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y);
    float w = 0.42;
    float h = 0.06 + 0.24 * abs(cos(vSpin * 0.7));
    a = step(abs(q.x), w) * step(abs(q.y), h);
    c *= 0.75 + 0.35 * abs(cos(vSpin * 0.7));
  } else if (uShape == 2) {
    float d = length(q) * 2.0;
    a = smoothstep(1.0, 0.0, d);
    a *= a;
    c *= 1.0 + 1.5 * smoothstep(0.5, 0.0, d);
  } else {
    float d = length(q) * 2.0;
    a = smoothstep(1.0, 0.25, d);
  }
  a *= vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

interface Layer {
  points: THREE.Points;
  mat: THREE.ShaderMaterial;
}

export class Weather {
  private layers: Layer[] = [];
  private scene: THREE.Scene;
  private size = new THREE.Vector2();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Replace every layer. */
  set(defs: WeatherLayerDef[]): void {
    this.clear();
    for (const def of defs) this.layers.push(this.build(def));
  }

  clear(): void {
    for (const l of this.layers) {
      this.scene.remove(l.points);
      l.points.geometry.dispose();
      l.mat.dispose();
    }
    this.layers.length = 0;
  }

  /** Per frame: three uniform writes per layer. */
  update(time: number, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer): void {
    if (!this.layers.length) return;
    renderer.getDrawingBufferSize(this.size);
    const px = this.size.y * 0.5 * camera.projectionMatrix.elements[5];
    for (const l of this.layers) {
      const u = l.mat.uniforms;
      u.uTime.value = time;
      (u.uCam.value as THREE.Vector3).copy(camera.position);
      u.uPx.value = px;
    }
  }

  private build(def: WeatherLayerDef): Layer {
    const n = def.count;
    const seed = new Float32Array(n * 4);
    const col = new Float32Array(n * 3);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      seed[i * 4] = Math.random();
      seed[i * 4 + 1] = Math.random();
      seed[i * 4 + 2] = Math.random();
      seed[i * 4 + 3] = Math.random();
      c.setHex(def.colors[(Math.random() * def.colors.length) | 0]);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    // positions are computed in the shader; a dummy attribute keeps three's draw range = n
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uBox: { value: new THREE.Vector3(BOX, HEIGHT, BOX) },
        uVel: { value: new THREE.Vector3(def.wind[0], -def.fall, def.wind[1]) },
        uSway: { value: def.sway },
        uSize: { value: def.size },
        uPx: { value: 400 },
        uFlicker: { value: def.flicker ?? 0 },
        uSide: { value: def.side ?? 0 },
        uOpacity: { value: def.opacity },
        uShape: { value: def.shape === 'confetti' ? 1 : def.shape === 'spark' ? 2 : 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: def.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: false,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 5;
    points.matrixAutoUpdate = false;
    points.raycast = () => {};
    this.scene.add(points);
    return { points, mat };
  }
}
