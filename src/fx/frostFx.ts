import * as THREE from 'three';
import type { FrostFxAPI, FxAPI, SoundName } from '../core/types';
import { currentPreset } from '../core/settings';

/* Ice-white FX for the PROTOCOL C exclusives (config/cosmetics.ts req.protocol): the "Whiteout" trail and the
 * "Avalanche" kill effect. Like fx/ghostFx.ts: ONE instanced quad batch (fixed cap, allocated once, hidden while empty)
 * whose fragment shader draws every shape procedurally, and a small fixed pool for the avalanche snowballs. No per-frame
 * allocation; the quality preset's fxScale (LOW: 0.5) halves the particle counts.
 *
 * Whiteout trail: a miniature blizzard following the plow. Snow streaks spiral round the plow's line of travel and peel
 * off behind it, fine flakes tumble out, ice-blue glints wink in it and a faint frost line is left on the tracks. A dash
 * throws a brief whiteout gust outward (a ring of powder puffs and radial streaks). Very occasionally a small closed eye
 * lies in the snow behind the plow and blinks open for a moment (THE WHITEOUT is watching).
 *
 * Avalanche kill: a small snowball rolls out of the wreck, the scrap scattered round the wreck flies into it
 * (Katamari-style) and it swells with each piece, then it implodes inward with a soft white flash.
 *
 * Pure helpers (spiralOffset, eyeOpen, avalancheRadius) are exported for tests. */

export const FROST_WHITE = 0xf4fbff;
export const FROST_ICE = 0xbfe8ff;
export const FROST_DEEP = 0x5aa6e0;

export const MAX_FROST = 700;
export const MAX_BALLS = 4;

/** Sprite shapes (the `kind` the fragment shader switches on). */
export const F_STREAK = 0;
export const F_FLAKE = 1;
export const F_GLINT = 2;
export const F_FROST = 3;
export const F_PUFF = 4;
export const F_EYE = 5;
export const F_BALL = 6;
export const F_FLASH = 7;
export const F_DEBRIS = 8;

/** Whiteout swirl: turns per second, radius at birth / at death (m), how far back it drifts (m/s). */
const SWIRL_SPIN = 1.15;
const SWIRL_R0 = 0.45;
const SWIRL_R1 = 1.55;
const SWIRL_BACK = 2.6;
const STREAK_LIFE = 0.9;
const FLAKE_LIFE = 1.3;
const FROST_LIFE = 2.2;
const FROST_W = 0.24;
const GLINT_LIFE = 0.32;
/** Eye: life (s), half size (m), minimum seconds between eyes, chance per trail puff once allowed. */
export const EYE_LIFE = 1.5;
const EYE_SIZE = 0.6;
const EYE_GAP = 7;
const EYE_CHANCE = 0.035;

/** Avalanche timeline (s): roll + gather, then the implosion. */
export const AVA_GATHER = 1.5;
export const AVA_IMPLODE = 0.28;
const AVA_R0 = 0.28;
const AVA_R1 = 1.05;
const AVA_SPEED = 4.2;
const AVA_DEBRIS = 10;

/** Offset (side, up) of a swirl streak `t` s after birth on a spiral starting at angle `phase` (pure; tests). */
export function spiralOffset(t: number, phase: number, out: { s: number; u: number; r: number }): { s: number; u: number; r: number } {
  const k = Math.min(1, Math.max(0, t / STREAK_LIFE));
  const a = phase + t * SWIRL_SPIN * Math.PI * 2;
  const r = SWIRL_R0 + (SWIRL_R1 - SWIRL_R0) * k;
  out.s = Math.cos(a) * r;
  out.u = Math.sin(a) * r * 0.75;
  out.r = r;
  return out;
}

/** Eye openness 0 (shut) .. 1 (wide) over its life fraction f: shut, a quick blink open, a look, then shut (pure). */
export function eyeOpen(f: number): number {
  if (f <= 0.25 || f >= 1) return 0;
  if (f < 0.38) return (f - 0.25) / 0.13;
  if (f < 0.78) return 1;
  return Math.max(0, 1 - (f - 0.78) / 0.14);
}

/** Avalanche ball radius `t` s after the wreck with `eaten` of `total` debris pieces swallowed (pure). */
export function avalancheRadius(t: number, eaten: number, total: number): number {
  if (t >= AVA_GATHER + AVA_IMPLODE) return 0;
  const grown = AVA_R0 + (AVA_R1 - AVA_R0) * Math.min(1, (eaten / Math.max(1, total)) * 0.75 + Math.min(1, t / AVA_GATHER) * 0.25);
  if (t <= AVA_GATHER) return grown;
  const k = (t - AVA_GATHER) / AVA_IMPLODE;
  // a last swell, then a fast collapse
  return grown * (k < 0.25 ? 1 + k * 0.6 : 1.15 * Math.pow(1 - (k - 0.25) / 0.75, 2));
}

const FOG_FRAG = /* glsl */ `
#ifdef USE_FOG
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform float fogDensity;
#endif
varying float vFogDepth;
float gFog() {
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
vec3 gFogColor() {
#ifdef USE_FOG
  return fogColor;
#else
  return vec3(0.0);
#endif
}`;

const VERT = /* glsl */ `
attribute vec4 iPos;  // xyz, half size (across)
attribute vec4 iDir;  // xyz orientation (streak / flat decal), half length (0 = billboard)
attribute vec4 iMisc; // kind, life fraction, alpha, rotation / seed
varying vec2 vP;
varying vec4 vMisc;
varying float vFogDepth;
void main() {
  vP = position.xy;
  vMisc = iMisc;
  vec4 mv;
  float k = iMisc.x;
  if ((k > 2.5 && k < 3.5) || (k > 4.5 && k < 5.5)) {
    // Frost line / eye: flat on the snow, long axis along iDir.
    vec3 d = normalize(iDir.xyz + vec3(1e-5, 0.0, 0.0));
    vec3 side = vec3(-d.z, 0.0, d.x);
    vec3 w = iPos.xyz + side * position.x * iPos.w + d * position.y * iDir.w;
    mv = viewMatrix * vec4(w, 1.0);
  } else if (iDir.w > 0.0) {
    // Streak: camera-facing ribbon stretched along the projected direction.
    mv = viewMatrix * vec4(iPos.xyz, 1.0);
    vec3 dv = (viewMatrix * vec4(iDir.xyz, 0.0)).xyz;
    vec2 a = dv.xy;
    float l = length(a);
    a = l > 1e-4 ? a / l : vec2(0.0, 1.0);
    vec2 n = vec2(-a.y, a.x);
    mv.xy += n * position.x * iPos.w + a * position.y * iDir.w;
  } else {
    mv = viewMatrix * vec4(iPos.xyz, 1.0);
    // Glints, puffs and debris spin; the ball keeps its light from the top (its roll is drawn in the shader).
    float c = cos(iMisc.w), s = sin(iMisc.w);
    vec2 o = (k > 5.5 && k < 7.5) ? position.xy : mat2(c, s, -s, c) * position.xy;
    mv.xy += o * iPos.w;
    // the flash sits a little toward the camera so the wreck's smoke never swallows it
    if (k > 6.5 && k < 7.5) mv.z += 3.0;
  }
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uWhite;
uniform vec3 uIce;
uniform vec3 uDeep;
varying vec2 vP;
varying vec4 vMisc;
${FOG_FRAG}

float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  float kind = vMisc.x;
  float f = vMisc.y;
  float alpha = vMisc.z;
  float seed = vMisc.w;
  vec2 p = vP;
  vec3 col = uWhite;
  float a = 0.0;
  float add = 0.0;

  if (kind < 0.5) {
    // Snow streak: a tapering white ribbon (head at +y), cool blue edge, fading toward the tail.
    float t = (1.0 - p.y) * 0.5;
    float hw = mix(0.9, 0.2, t);
    float e = hw - abs(p.x);
    float cap = 1.0 - smoothstep(0.75, 1.0, abs(p.y));
    if (e <= 0.0 || cap <= 0.0) discard;
    // a deep-blue rim so it reads on bright snow; white heart so it reads at night
    col = mix(uDeep, uIce, smoothstep(0.0, 0.2, e));
    col = mix(col, uWhite, smoothstep(0.25, 0.6, e));
    a = cap * mix(1.0, 0.2, t) * smoothstep(0.0, 0.28, e);
    add = 0.25;
  } else if (kind < 1.5) {
    // Flake: a soft round dot with a brighter heart.
    float r = length(p);
    if (r >= 1.0) discard;
    col = mix(uDeep, uWhite, 1.0 - smoothstep(0.3, 0.85, r));
    a = 1.0 - smoothstep(0.7, 1.0, r);
    add = 0.2;
  } else if (kind < 2.5) {
    // Glint: a four-point ice star with a hot centre (mostly additive so it twinkles at night).
    float r = length(p);
    float ang = atan(p.y, p.x);
    float spike = pow(abs(cos(ang * 2.0)), 18.0);
    float e = mix(0.16, 1.0, spike) * (1.0 - r);
    if (e <= 0.0) discard;
    col = mix(uIce, uWhite, smoothstep(0.0, 0.5, e));
    a = smoothstep(0.0, 0.25, e) * (1.0 - f * f);
    add = 0.85;
  } else if (kind < 3.5) {
    // Frost line: a pale, crystalline stripe with feathery ice ticks.
    float ex = 1.0 - abs(p.x);
    float ey = 1.0 - abs(p.y);
    if (ex <= 0.0 || ey <= 0.0) discard;
    float tick = step(0.6, hash2(floor(vec2(p.x * 6.0, p.y * 34.0 + seed * 9.0))));
    float core = smoothstep(0.35, 0.95, ex);
    col = mix(uIce, uWhite, core);
    a = (0.4 * core + 0.25 * tick * smoothstep(0.0, 0.6, ex)) * smoothstep(0.0, 0.25, ey);
    add = 0.15;
  } else if (kind < 4.5) {
    // Powder puff: a lumpy soft white billow (the dash gust).
    float r = length(p);
    float ang = atan(p.y, p.x);
    float rad = 0.8 + 0.1 * sin(ang * 3.0 + seed) + 0.06 * sin(ang * 7.0 - seed * 2.0 + uTime * 2.0);
    float e = rad - r;
    if (e <= 0.0) discard;
    col = mix(uDeep, uIce, smoothstep(0.0, 0.35, e));
    col = mix(col, uWhite, smoothstep(0.3, 0.8, e) * 0.7);
    a = smoothstep(0.0, 0.4, e) * mix(0.8, 0.3, f);
  } else if (kind < 5.5) {
    // Eye in the snow: an almond lid that opens (openness rides in seed's integer part / 10), ice iris, dark pupil.
    float open = clamp(floor(seed) / 10.0, 0.0, 1.0);
    float lid = (1.0 - p.x * p.x) * mix(0.06, 0.62, open);
    float e = lid - abs(p.y);
    float rim = (1.0 - p.x * p.x) * 0.66 - abs(p.y);
    // the closed lid: a soft dark crease
    float crease = (1.0 - smoothstep(0.0, 0.08, abs(p.y))) * smoothstep(0.0, 0.25, 1.0 - abs(p.x)) * (1.0 - open);
    if (e <= 0.0 && crease <= 0.01) discard;
    vec2 q = p - vec2(0.0, 0.0);
    float ir = length(q * vec2(1.0, 1.15));
    col = mix(uWhite, uIce, smoothstep(0.55, 0.2, ir));
    col = mix(col, uDeep, smoothstep(0.32, 0.18, ir));
    col = mix(col, vec3(0.03, 0.06, 0.12), smoothstep(0.13, 0.08, ir));
    // a white catch-light
    col = mix(col, vec3(1.0), smoothstep(0.06, 0.02, length(q - vec2(0.08, 0.1))));
    a = smoothstep(0.0, 0.05, e);
    col = mix(col, uDeep * 0.6, smoothstep(0.08, 0.0, e) * step(0.0, e));
    if (crease > 0.01 && e <= 0.0) { col = uDeep * 0.55; a = crease * 0.8; }
    a *= smoothstep(0.0, 0.2, rim + 0.2);
    add = 0.1 * open;
  } else if (kind < 6.5) {
    // Snowball: a lit sphere (light from above / front), lumpy rim, scrap stuck in it rolling round (seed = roll).
    float r = length(p);
    float ang = atan(p.y, p.x);
    float rad = 0.96 + 0.035 * sin(ang * 7.0 + seed * 0.7) + 0.02 * sin(ang * 13.0 - seed);
    if (r > rad) discard;
    float z = sqrt(max(0.0, 1.0 - min(1.0, r / rad) * min(1.0, r / rad)));
    vec3 n = vec3(p / rad, z);
    float lit = 0.45 + 0.55 * max(0.0, dot(n, normalize(vec3(-0.35, 0.75, 0.55))));
    col = mix(uDeep * 0.9, uWhite, lit);
    col = mix(col, uIce, 0.25 * (1.0 - z));
    // scrap: dark flecks on the surface, scrolling with the roll
    vec2 sp = vec2(ang * 1.4 + seed, z * 3.0);
    vec2 cell = floor(sp * vec2(2.2, 2.4));
    float h = hash2(cell);
    vec2 fr = fract(sp * vec2(2.2, 2.4)) - 0.5;
    float fleck = step(0.62, h) * (1.0 - smoothstep(0.16, 0.24, length(fr))) * step(0.15, z);
    col = mix(col, mix(vec3(0.22, 0.24, 0.28), vec3(0.85, 0.55, 0.2), step(0.85, h)), fleck * 0.9);
    a = 1.0;
  } else if (kind < 7.5) {
    // Soft white flash with a faint ice ring.
    float r = length(p);
    if (r >= 1.0) discard;
    float ring = (1.0 - smoothstep(0.0, 0.08, abs(r - mix(0.3, 0.92, f)))) * 0.6;
    col = mix(uIce, uWhite, 1.0 - r);
    a = max((1.0 - smoothstep(0.0, 1.0, r)) * (1.0 - f), ring * (1.0 - f));
    add = 0.9;
  } else {
    // Debris: a small, jagged dark scrap chip with a lit edge (gold bits now and then).
    float ang = atan(p.y, p.x);
    float rad = 0.62 + 0.22 * hash1(floor((ang + 3.1416) * 0.95) + floor(seed * 7.0));
    float e = rad - length(p);
    if (e <= 0.0) discard;
    bool gold = hash1(seed * 3.1) > 0.8;
    col = gold ? vec3(0.95, 0.68, 0.25) : vec3(0.26, 0.28, 0.33);
    col = mix(col * 1.6, col, smoothstep(0.0, 0.15, e));
    a = 1.0;
  }

  a *= alpha;
  if (a < 0.004) discard;
  col = mix(col, gFogColor(), gFog());
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a, a * (1.0 - add));
}`;

interface Ball {
  active: boolean;
  t: number;
  x: number; y: number; z: number;
  dx: number; dz: number;
  roll: number;
  eaten: number;
  total: number;
  flashed: boolean;
}

const _sp = { s: 0, u: 0, r: 0 };
const _v = new THREE.Vector3();
const RING_COL = 0xdff4ff;

export class FrostFx implements FrostFxAPI {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aDir: THREE.InstancedBufferAttribute;
  private readonly aMisc: THREE.InstancedBufferAttribute;
  private readonly attrs: readonly THREE.InstancedBufferAttribute[];
  n = 0;
  private readonly px = new Float32Array(MAX_FROST);
  private readonly py = new Float32Array(MAX_FROST);
  private readonly pz = new Float32Array(MAX_FROST);
  private readonly vx = new Float32Array(MAX_FROST);
  private readonly vy = new Float32Array(MAX_FROST);
  private readonly vz = new Float32Array(MAX_FROST);
  /** Orientation (flat decals) / swirl axis (streaks: the plow's heading). */
  private readonly dx = new Float32Array(MAX_FROST);
  private readonly dz = new Float32Array(MAX_FROST);
  private readonly age = new Float32Array(MAX_FROST);
  private readonly life = new Float32Array(MAX_FROST);
  private readonly s0 = new Float32Array(MAX_FROST);
  private readonly s1 = new Float32Array(MAX_FROST);
  private readonly len = new Float32Array(MAX_FROST);
  private readonly grav = new Float32Array(MAX_FROST);
  private readonly seed = new Float32Array(MAX_FROST);
  private readonly kind = new Uint8Array(MAX_FROST);
  private readonly alpha = new Float32Array(MAX_FROST);
  /** Swirl streaks: spiral phase (NaN = plain particle). Debris: the ball it flies into (-1 = none) and its delay. */
  private readonly phase = new Float32Array(MAX_FROST);
  private readonly tgt = new Int8Array(MAX_FROST);
  private readonly balls: Ball[] = [];
  private time = 0;
  private eyeT = 0;

  /** `fx`: rings / powder for the avalanche (null in tests). `ground(x, z, y)` = the surface under an effect. */
  constructor(
    private readonly fx: FxAPI | null,
    private readonly ground: ((x: number, z: number, y: number) => number) | null = null,
    private readonly sfx: ((name: SoundName, volume: number, pitch: number) => void) | null = null,
  ) {
    const g = (this.geo = new THREE.InstancedBufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.instanceCount = 0;
    const cap = MAX_FROST + MAX_BALLS;
    const attr = (name: string): THREE.InstancedBufferAttribute => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute(name, a);
      return a;
    };
    this.aPos = attr('iPos');
    this.aDir = attr('iDir');
    this.aMisc = attr('iMisc');
    this.attrs = [this.aPos, this.aDir, this.aMisc];
    this.mat = new THREE.ShaderMaterial({
      fog: true,
      // streaks / flat decals can mirror the quad's winding (their axes follow a direction): draw both faces
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uWhite: { value: new THREE.Color(FROST_WHITE) },
          uIce: { value: new THREE.Color(FROST_ICE) },
          uDeep: { value: new THREE.Color(FROST_DEEP) },
        },
      ]),
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    const mesh = (this.mesh = new THREE.Mesh(g, this.mat));
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 5;
    mesh.visible = false;
    mesh.name = 'fx-frost';
    mesh.raycast = () => {};
    for (let i = 0; i < MAX_BALLS; i++) {
      this.balls.push({ active: false, t: 0, x: 0, y: 0, z: 0, dx: 0, dz: 1, roll: 0, eaten: 0, total: 0, flashed: false });
    }
  }

  get stats(): { sprites: number; balls: number } {
    let b = 0;
    for (const o of this.balls) if (o.active) b++;
    return { sprites: this.n, balls: b };
  }

  /** fxScale-thinned count: LOW keeps half (probabilistic for the fractional part, so small counts still show). */
  private scaled(count: number): number {
    const v = count * currentPreset().fxScale;
    const whole = Math.floor(v);
    return whole + (Math.random() < v - whole ? 1 : 0);
  }

  private slot(): number {
    if (this.n < MAX_FROST) return this.n++;
    let best = 0, bf = -1;
    for (let k = 0; k < 5; k++) {
      const i = (Math.random() * MAX_FROST) | 0;
      const f = this.age[i] / this.life[i];
      if (f > bf) { bf = f; best = i; }
    }
    return best;
  }

  private emit(
    kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number,
    life: number, size0: number, size1: number, grav: number, alpha: number, len = 0, ddx = 0, ddz = 0,
  ): number {
    const i = this.slot();
    this.kind[i] = kind;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = size0; this.s1[i] = size1;
    this.grav[i] = grav; this.alpha[i] = alpha; this.len[i] = len; this.dx[i] = ddx; this.dz[i] = ddz;
    this.seed[i] = Math.random() * 6.283;
    this.phase[i] = NaN;
    this.tgt[i] = -1;
    return i;
  }

  private groundAt(x: number, z: number, y: number, fallback: number): number {
    if (!this.ground) return fallback;
    const g = this.ground(x, z, y);
    return Math.abs(g - fallback) < 1.5 ? g : fallback;
  }

  /**
   * Whiteout puff from one rear corner at (x, y, z): `groundY` = the surface under the plow, `yaw` its heading, `moved`
   * = metres since the corner's last puff (a frost line that long; 0 = parked), `dash` = a whiteout gust.
   */
  trail(x: number, y: number, z: number, groundY: number, yaw: number, moved: number, dash: boolean): void {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    groundY = this.groundAt(x, z, groundY + 0.6, groundY);
    // Swirl streaks spiralling round the line of travel, drifting back.
    const swirls = this.scaled(dash ? 5 : 3);
    for (let k = 0; k < swirls; k++) {
      const i = this.emit(F_STREAK, x, y + 0.2, z, -fx * SWIRL_BACK, 0, -fz * SWIRL_BACK, STREAK_LIFE * (0.8 + Math.random() * 0.4),
        0.1, 0.05, 0, 0.95, 0.5, fx, fz);
      this.phase[i] = Math.random() * Math.PI * 2;
    }
    // The storm's body: a pale blue-white billow drifting back and up (thin, so the plow stays visible).
    if (Math.random() < 0.7 * currentPreset().fxScale) {
      this.emit(F_PUFF, x - fx * 0.6, y + 0.1, z - fz * 0.6, -fx * 1.8 + (Math.random() - 0.5), 0.5, -fz * 1.8 + (Math.random() - 0.5),
        0.9, 0.45, 1.3, -0.3, 0.35);
    }
    // Fine flakes tumbling out of the swirl.
    const flakes = this.scaled(dash ? 4 : 2);
    for (let k = 0; k < flakes; k++) {
      this.emit(F_FLAKE, x + (Math.random() - 0.5) * 0.8, y + Math.random() * 0.8, z + (Math.random() - 0.5) * 0.8,
        -fx * (1 + Math.random()) + (Math.random() - 0.5) * 1.6, 0.4 + Math.random() * 0.8, -fz * (1 + Math.random()) + (Math.random() - 0.5) * 1.6,
        FLAKE_LIFE * (0.7 + Math.random() * 0.6), 0.06 + Math.random() * 0.04, 0.04, 1.4, 0.95);
    }
    // Ice-blue glints winking in the storm.
    if (Math.random() < 0.3 * currentPreset().fxScale + (dash ? 0.3 : 0)) {
      const back = 0.4 + Math.random() * 1.4;
      this.emit(F_GLINT, x - fx * back + (Math.random() - 0.5), y + Math.random() * 0.9, z - fz * back + (Math.random() - 0.5),
        0, 0.2, 0, GLINT_LIFE * (0.8 + Math.random() * 0.5), 0.18 + Math.random() * 0.12, 0.05, 0, 1);
    }
    // Faint frost on the tracks.
    if (moved > 0.02) {
      const m = Math.min(2.4, moved);
      this.emit(F_FROST, x - fx * m * 0.5, groundY + 0.05, z - fz * m * 0.5, 0, 0, 0, FROST_LIFE, FROST_W, FROST_W * 0.8, 0, 0.75,
        m * 0.5 + 0.2, fx, fz);
    }
    // Now and then an eye in the snow behind the plow, blinking open for a moment.
    if (this.time - this.eyeT > EYE_GAP && Math.random() < EYE_CHANCE) {
      this.eyeT = this.time;
      const back = 2.4 + Math.random() * 1.2, side = (Math.random() - 0.5) * 1.6;
      const ex = x - fx * back + fz * side, ez = z - fz * back - fx * side;
      // lying in the snow across the track, its top lid toward the plow (long axis side to side)
      this.emit(F_EYE, ex, this.groundAt(ex, ez, groundY + 0.6, groundY) + 0.06, ez, 0, 0, 0, EYE_LIFE, EYE_SIZE, EYE_SIZE, 0, 1,
        EYE_SIZE * 0.8, fx, fz);
    }
    if (!dash) return;
    // Dash: a brief whiteout gust blowing outward round the plow.
    const n = this.scaled(10);
    for (let k = 0; k < n; k++) {
      const a = (k / Math.max(1, n)) * Math.PI * 2 + Math.random() * 0.4;
      const c = Math.cos(a), s = Math.sin(a);
      this.emit(F_PUFF, x + c * 0.5, groundY + 0.35 + Math.random() * 0.4, z + s * 0.5, c * (5 + Math.random() * 2), 0.6, s * (5 + Math.random() * 2),
        0.65 + Math.random() * 0.25, 0.4, 1.4, -0.5, 0.8);
      if (k % 2 === 0) {
        this.emit(F_STREAK, x + c * 0.8, groundY + 0.5 + Math.random() * 0.5, z + s * 0.8, c * 9, 0.3, s * 9, 0.32, 0.07, 0.03, 0, 0.9, 0.7, c, s);
      }
    }
  }

  /**
   * Avalanche: at the wreck `at`, a snowball rolls out along (dirX, dirZ), gathers the scrap scattered round the wreck
   * (swelling with each piece), then implodes with a soft white flash.
   */
  avalanche(at: THREE.Vector3, dirX: number, dirZ: number): void {
    let b: Ball | null = null;
    for (const o of this.balls) if (!o.active) { b = o; break; }
    if (!b) {
      b = this.balls[0];
      for (const o of this.balls) if (o.t > b.t) b = o;
    }
    const bi = this.balls.indexOf(b);
    const l = Math.hypot(dirX, dirZ) || 1;
    b.active = true;
    b.t = 0;
    b.dx = dirX / l;
    b.dz = dirZ / l;
    b.x = at.x;
    b.z = at.z;
    b.y = this.groundAt(at.x, at.z, at.y + 0.6, at.y);
    b.roll = 0;
    b.eaten = 0;
    b.flashed = false;
    // Scrap scattered round the wreck, a little ahead of the ball's path: each flies into the ball when it comes by.
    const total = this.scaled(AVA_DEBRIS);
    b.total = Math.max(1, total);
    for (let k = 0; k < total; k++) {
      const along = 0.4 + Math.random() * AVA_SPEED * AVA_GATHER * 0.7;
      const side = (Math.random() - 0.5) * 2.4;
      const x = at.x + b.dx * along - b.dz * side, z = at.z + b.dz * along + b.dx * side;
      const i = this.emit(F_DEBRIS, x, b.y + 0.12 + Math.random() * 0.2, z, (Math.random() - 0.5) * 2, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 2,
        AVA_GATHER + 0.4, 0.2 + Math.random() * 0.14, 0.18, 9, 1);
      this.tgt[i] = bi;
    }
    // A puff of powder as it pops out of the wreck.
    for (let k = 0; k < this.scaled(6); k++) {
      const a = Math.random() * Math.PI * 2;
      this.emit(F_PUFF, at.x, b.y + 0.3, at.z, Math.cos(a) * 2 + b.dx * 2, 1, Math.sin(a) * 2 + b.dz * 2, 0.7, 0.3, 0.9, -0.3, 0.7);
    }
    this.sfx?.('freeze', 0.55, 0.8);
  }

  private updateBalls(dt: number): void {
    for (let j = 0; j < this.balls.length; j++) {
      const b = this.balls[j];
      if (!b.active) continue;
      b.t += dt;
      const r = avalancheRadius(b.t, b.eaten, b.total);
      if (b.t < AVA_GATHER) {
        const v = AVA_SPEED * (1 - (b.t / AVA_GATHER) * 0.7);
        b.x += b.dx * v * dt;
        b.z += b.dz * v * dt;
        b.roll += (v * dt) / Math.max(0.2, r);
        b.y = this.groundAt(b.x, b.z, b.y + 0.6, b.y);
        // a little snow kicked up behind it
        if (Math.random() < 0.5 * currentPreset().fxScale) {
          this.emit(F_FLAKE, b.x - b.dx * r, b.y + 0.1, b.z - b.dz * r, -b.dx + (Math.random() - 0.5), 0.8, -b.dz + (Math.random() - 0.5), 0.6, 0.07, 0.03, 2, 0.9);
        }
      } else if (!b.flashed) {
        b.flashed = true;
        // Implode: streaks pulled inward from a shell round the ball.
        const cy = b.y + r;
        const n = this.scaled(14);
        for (let k = 0; k < n; k++) {
          const a = (k / Math.max(1, n)) * Math.PI * 2, e = (Math.random() - 0.3) * 1.2;
          const c = Math.cos(a) * Math.cos(e), s = Math.sin(a) * Math.cos(e), u = Math.sin(e);
          const R = r * 2.6;
          this.emit(F_STREAK, b.x + c * R, cy + u * R, b.z + s * R, -c * R / AVA_IMPLODE, -u * R / AVA_IMPLODE, -s * R / AVA_IMPLODE,
            AVA_IMPLODE, 0.08, 0.03, 0, 0.95, 0.5, -c, -s);
        }
      }
      if (b.t >= AVA_GATHER + AVA_IMPLODE) {
        b.active = false;
        const cy = b.y + 1.4;
        this.emit(F_FLASH, b.x, cy, b.z, 0, 0, 0, 0.45, 1.0, 2.6, 0, 1);
        for (let k = 0; k < this.scaled(8); k++) {
          this.emit(F_GLINT, b.x + (Math.random() - 0.5) * 2, cy + (Math.random() - 0.3) * 1.6, b.z + (Math.random() - 0.5) * 2, 0, 0.5, 0, 0.5, 0.25, 0.05, 0, 1);
        }
        if (this.fx) {
          _v.set(b.x, b.y + 0.05, b.z);
          this.fx.ring(_v, 2.4, RING_COL);
          // (no powder: its dust cloud reads as a dark smudge under the flash)
        }
        this.sfx?.('burst', 0.5, 1.5);
      }
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time % 1000;
    this.updateBalls(dt);
    const { px, py, pz, vx, vy, vz, dx, dz, age, life, s0, s1, len, grav, seed, kind, alpha, phase, tgt, balls } = this;
    const P = this.aPos.array as Float32Array;
    const D = this.aDir.array as Float32Array;
    const M = this.aMisc.array as Float32Array;
    const drag = Math.max(0, 1 - 1.2 * dt);
    let i = 0;
    while (i < this.n) {
      age[i] += dt;
      if (age[i] >= life[i]) {
        this.kill(i);
        continue;
      }
      const k = kind[i];
      const f = age[i] / life[i];
      // Debris flies into its ball once the ball is close (or late in the gather) and is swallowed on contact.
      const bi = tgt[i];
      if (k === F_DEBRIS && bi >= 0) {
        const b = balls[bi];
        if (!b.active || b.t >= AVA_GATHER) {
          this.kill(i);
          continue;
        }
        const r = avalancheRadius(b.t, b.eaten, b.total);
        const tx = b.x - px[i], ty = b.y + r - py[i], tz = b.z - pz[i];
        const d = Math.hypot(tx, ty, tz);
        if (d < r * 0.9) {
          b.eaten++;
          this.kill(i);
          continue;
        }
        if (d < r + 2.2 || b.t > AVA_GATHER * 0.65) {
          const sp = 9 + 10 * Math.min(1, b.t / AVA_GATHER);
          const kk = 1 - Math.exp(-10 * dt);
          vx[i] += (tx / d * sp - vx[i]) * kk;
          vy[i] += (ty / d * sp - vy[i]) * kk;
          vz[i] += (tz / d * sp - vz[i]) * kk;
        } else {
          vy[i] -= grav[i] * dt;
          vx[i] *= drag; vz[i] *= drag;
          // rest on the snow until the ball comes by
          const gy = b.y + 0.1;
          if (py[i] < gy) { py[i] = gy; vy[i] = 0; vx[i] *= 0.5; vz[i] *= 0.5; }
        }
      } else {
        vx[i] *= drag; vz[i] *= drag;
        vy[i] = vy[i] * drag - grav[i] * dt;
      }
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      const s = s0[i] + (s1[i] - s0[i]) * f;
      const h = i * 4;
      let ox = 0, oy = 0, oz = 0;
      let ddx = dx[i], ddy = 0, ddz = dz[i], l = len[i];
      const ph = phase[i];
      if (k === F_STREAK && ph === ph) {
        // Swirl: spiral round the travel axis (dx, dz); oriented along the spiral's tangent.
        spiralOffset(age[i], ph, _sp);
        const sx = -dz[i], sz = dx[i];
        ox = sx * _sp.s; oy = _sp.u; oz = sz * _sp.s;
        const a = ph + age[i] * SWIRL_SPIN * Math.PI * 2;
        const ts = -Math.sin(a), tu = Math.cos(a) * 0.75;
        ddx = sx * ts - dx[i] * 0.6; ddy = tu; ddz = sz * ts - dz[i] * 0.6;
        l = 0.2 + 0.16 * (1 - f);
      } else if (k === F_STREAK) {
        // plain streaks lie along their motion
        const sp = Math.hypot(vx[i], vy[i], vz[i]);
        if (sp > 0.01) { ddx = vx[i] / sp; ddy = vy[i] / sp; ddz = vz[i] / sp; }
      }
      const fadeIn = Math.min(1, f * (k === F_FROST ? 30 : 10));
      let fade = k === F_FROST ? Math.pow(1 - f, 1.4) : k === F_PUFF ? 1 - f : k === F_DEBRIS ? 1 : 1 - f * f * f;
      let misc = seed[i];
      if (k === F_EYE) {
        fade = Math.min(1, (1 - f) * 6) * Math.min(1, f * 8);
        // openness in the integer part (0..10), so the shader needs no extra attribute
        misc = Math.round(eyeOpen(f) * 10) + 0.5;
      } else if (k === F_DEBRIS) misc = seed[i] + age[i] * 9;
      P[h] = px[i] + ox; P[h + 1] = py[i] + oy; P[h + 2] = pz[i] + oz; P[h + 3] = s;
      D[h] = ddx; D[h + 1] = ddy; D[h + 2] = ddz; D[h + 3] = l;
      M[h] = k; M[h + 1] = f; M[h + 2] = alpha[i] * fadeIn * fade; M[h + 3] = misc;
      i++;
    }
    let n = this.n;
    for (let j = 0; j < balls.length; j++) {
      const b = balls[j];
      if (!b.active) continue;
      const r = avalancheRadius(b.t, b.eaten, b.total);
      if (r <= 0.01) continue;
      const h = n * 4;
      P[h] = b.x; P[h + 1] = b.y + r; P[h + 2] = b.z; P[h + 3] = r;
      D[h] = 0; D[h + 1] = 0; D[h + 2] = 0; D[h + 3] = 0;
      M[h] = F_BALL; M[h + 1] = 0; M[h + 2] = 1; M[h + 3] = b.roll;
      n++;
    }
    this.finish(n);
  }

  private finish(n: number): void {
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n <= 0) return;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, n * 4);
      a.needsUpdate = true;
    }
  }

  clear(): void {
    this.n = 0;
    for (const b of this.balls) b.active = false;
    this.finish(0);
  }

  private kill(i: number): void {
    const l = --this.n;
    if (i === l) return;
    this.kind[i] = this.kind[l];
    this.px[i] = this.px[l]; this.py[i] = this.py[l]; this.pz[i] = this.pz[l];
    this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l]; this.vz[i] = this.vz[l];
    this.dx[i] = this.dx[l]; this.dz[i] = this.dz[l];
    this.age[i] = this.age[l]; this.life[i] = this.life[l]; this.s0[i] = this.s0[l]; this.s1[i] = this.s1[l];
    this.len[i] = this.len[l]; this.grav[i] = this.grav[l];
    this.seed[i] = this.seed[l]; this.alpha[i] = this.alpha[l]; this.phase[i] = this.phase[l]; this.tgt[i] = this.tgt[l];
  }
}
