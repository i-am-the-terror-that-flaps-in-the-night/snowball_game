import * as THREE from 'three';
import type { FxAPI, GhostFxAPI } from '../core/types';

/* Spectral purple FX for the Paint Shop's Ghostfire trail and Soul Harvest kill effect. ONE instanced quad batch
 * (fixed cap, allocated once, hidden while empty) draws every shape procedurally in the fragment shader: flame
 * tongues, curling wisps, chain links, the skull-faced soul, dash streaks, glowing track marks, the hull flash, and
 * the trail's billowing violet-black SMOKE with LIGHTNING flickering inside it.
 * Shapes are solid, normal-blended violet with a dark edge (so they read on bright snow) plus a little additive core
 * glow (so they read at night). Souls live in a small fixed pool and are drawn into the same buffer.
 *
 * Pure helpers (soulPose, flameHalfWidth) are exported for tests. */

/** Ghostfire palette (also the cosmetics' shop swatches). */
export const GHOST_CORE = 0xb04dff;
export const GHOST_BRIGHT = 0xe0a8ff;
export const GHOST_DEEP = 0x4a1a7a;
export const GHOST_EDGE = 0x1a0630;

export const MAX_GHOST = 900;
export const MAX_SOULS = 6;

/** Sprite shapes (the `kind` the fragment shader switches on). */
export const G_FLAME = 0;
export const G_WISP = 1;
export const G_LINK = 2;
export const G_SKULL = 3;
export const G_STREAK = 4;
export const G_TRACK = 5;
export const G_FLASH = 6;
export const G_SMOKE = 7;
export const G_BOLT = 8;

/** Soul timeline (seconds): spiral up out of the wreck, then dart home to the player's hull. */
export const SOUL_RISE = 1.15;
export const SOUL_DART_MAX = 1.6;
/** Spiral: turns per second, start / end radius (m), height gained (m). */
const SOUL_SPIN = 1.35;
const SOUL_R0 = 0.35;
const SOUL_R1 = 1.25;
export const SOUL_RISE_H = 3.6;
/** Dart: start / top speed (m/s), steering rate, arrival radius (m), hull height above the plow origin (m). */
const DART_V0 = 5;
const DART_V1 = 30;
const DART_STEER = 7;
const DART_HIT = 0.7;
const HULL_Y = 1.7;
/** Soul sprite half size (m). */
const SOUL_SIZE = 1.25;

/** Ghostfire trail: track-mark life (s) / width (m), flame + wisp lives. */
const TRACK_LIFE = 1.3;
const TRACK_W = 0.2;
const FLAME_LIFE = 0.45;
const WISP_LIFE = 1.15;
/** Ghostfire smoke: life (s), start / end half size (m), rise; lightning flicker life and chance per puff. */
const SMOKE_LIFE = 1.5;
const SMOKE_S0 = 0.75;
const SMOKE_S1 = 1.7;
const BOLT_LIFE = 0.13;
const BOLT_CHANCE = 0.3;
const BOLT_CHANCE_DASH = 0.75;

/** Half width of a flame / wisp teardrop at height y (-1 bottom .. 1 tip) in quad units (mirrors the shader). */
export function flameHalfWidth(y: number): number {
  if (y <= -0.4) {
    const d = y + 0.4;
    return Math.sqrt(Math.max(0, 0.25 - d * d));
  }
  return 0.5 * Math.pow(Math.max(0, 1 - (y + 0.4) / 1.4), 1.3);
}

/** Soul spiral pose `t` seconds into the rise (offset from the wreck, y up). Writes into `out`. */
export function soulPose(t: number, phase: number, out: THREE.Vector3): THREE.Vector3 {
  const k = Math.min(1, Math.max(0, t / SOUL_RISE));
  const a = phase + t * SOUL_SPIN * Math.PI * 2;
  const r = SOUL_R0 + (SOUL_R1 - SOUL_R0) * k;
  const h = 0.6 + SOUL_RISE_H * (1 - (1 - k) * (1 - k));
  return out.set(Math.cos(a) * r, h, Math.sin(a) * r);
}

const FOG_VERT = /* glsl */ `varying float vFogDepth;`;
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
attribute vec4 iDir;  // xyz orientation (streak / track), half length (0 = billboard)
attribute vec4 iMisc; // kind, life fraction, alpha, rotation / seed
varying vec2 vP;
varying vec4 vMisc;
${FOG_VERT}
void main() {
  vP = position.xy;
  vMisc = iMisc;
  vec4 mv;
  if (iMisc.x > 4.5 && iMisc.x < 5.5) {
    // Track mark: flat on the ground, long axis along iDir.
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
    float c = cos(iMisc.w), s = sin(iMisc.w);
    // Flames / wisps / skulls stay upright (seed only); links, flashes, smoke and bolts spin.
    vec2 o = (iMisc.x < 1.5 || (iMisc.x > 2.5 && iMisc.x < 3.5)) ? position.xy : mat2(c, s, -s, c) * position.xy;
    mv.xy += o * iPos.w;
    // The hull flash is pulled toward the camera so the plow's own bodywork never swallows it; lightning a little so
    // it flickers on the near side of its smoke.
    if (iMisc.x > 5.5 && iMisc.x < 6.5) mv.z += 2.5;
    if (iMisc.x > 7.5) mv.z += 0.6;
  }
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uCore;
uniform vec3 uBright;
uniform vec3 uDeep;
uniform vec3 uEdge;
varying vec2 vP;
varying vec4 vMisc;
${FOG_FRAG}

float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }

float halfW(float y) {
  if (y <= -0.4) { float d = y + 0.4; return sqrt(max(0.0, 0.25 - d * d)); }
  return 0.5 * pow(max(0.0, 1.0 - (y + 0.4) / 1.4), 1.3);
}

// Colour ramp from an inner-distance e (0 at the silhouette): dark edge -> deep -> core -> bright heart.
vec3 ramp(float e, float heart) {
  vec3 c = mix(uEdge, uDeep, smoothstep(0.0, 0.06, e));
  c = mix(c, uCore, smoothstep(0.06, 0.16, e));
  return mix(c, uBright, smoothstep(0.0, 1.0, heart));
}

void main() {
  float kind = vMisc.x;
  float f = vMisc.y;
  float alpha = vMisc.z;
  float seed = vMisc.w;
  vec2 p = vP;
  vec3 col;
  float a = 0.0;
  float add = 0.0;

  if (kind < 1.5) {
    // Flame tongue (0) / wisp (1): a wobbling teardrop, tip up. Wisps are paler with a longer curling tail.
    bool wisp = kind > 0.5;
    float t = (p.y + 1.0) * 0.5;
    float sway = sin(p.y * (wisp ? 3.2 : 5.0) + seed * 7.0 + uTime * (wisp ? 5.0 : 11.0)) * (wisp ? 0.32 : 0.18) * t;
    float x = p.x - sway;
    float hw = halfW(p.y) * (wisp ? 0.85 : 1.0) * (1.0 - f * 0.35);
    float e = hw - abs(x);
    if (e <= 0.0) discard;
    float heart = wisp ? 0.75 * smoothstep(0.12, 0.3, e) : smoothstep(0.16, 0.32, e) * (1.0 - t * 0.6);
    col = ramp(e, heart);
    a = 1.0;
    add = 0.35 * smoothstep(0.1, 0.25, e);
    if (wisp) a = 0.82;
  } else if (kind < 2.5) {
    // Chain link: an oval ring (odd seeds show the link edge-on as a narrow pill).
    bool edgeOn = fract(seed * 0.5) > 0.25;
    vec2 q = edgeOn ? p * vec2(3.2, 1.0) : p * vec2(1.25, 0.85);
    float r = length(q);
    float e = edgeOn ? 1.0 - r : 0.24 - abs(r - 0.72);
    if (e <= 0.0) discard;
    col = ramp(e * 0.9, smoothstep(0.08, 0.16, e));
    a = 0.6 + 0.4 * step(0.0, sin(uTime * 38.0 + seed * 13.0));
    add = 0.3;
  } else if (kind < 3.5) {
    // Soul: a round head trailing a long curling tail, with a faint skull face.
    vec2 hc = p - vec2(0.0, 0.4);
    float eHead = 0.42 - length(hc) + sin(atan(hc.y, hc.x) * 5.0 + uTime * 4.0 + seed) * 0.018;
    float t = clamp((0.4 - p.y) / 1.4, 0.0, 1.0);
    float cx = sin(t * 4.5 - uTime * 6.0 + seed) * 0.3 * t;
    float eTail = p.y < 0.4 ? 0.36 * pow(1.0 - t, 1.2) - abs(p.x - cx) : -1.0;
    float e = max(eHead, eTail);
    if (e <= 0.0) discard;
    col = ramp(e, 0.4 * smoothstep(0.12, 0.3, e) + 0.45 * smoothstep(-0.3, 0.3, p.y));
    a = mix(0.55, 0.9, smoothstep(-0.6, 0.2, p.y));
    add = 0.3 * smoothstep(0.1, 0.3, e);
    // Face (head centre ~ (0, 0.38)): two eye sockets, a nose notch, a row of teeth.
    vec2 h = p - vec2(0.0, 0.4);
    vec2 eye = vec2(abs(h.x) - 0.17, h.y - 0.02);
    float eyeD = length(eye * vec2(1.0, 1.25));
    float nose = step(abs(h.x) * 1.6 + (h.y + 0.17), 0.09) * step(-0.2, h.y);
    float teeth = step(abs(h.y + 0.3), 0.035) * step(abs(h.x), 0.16) * step(0.25, fract(h.x * 12.5 + 0.5));
    float face = max(max(1.0 - smoothstep(0.1, 0.125, eyeD), nose), teeth);
    col = mix(col, uEdge, face * 0.9);
    // Glinting pupils.
    col = mix(col, uBright, (1.0 - smoothstep(0.02, 0.04, eyeD)) * (0.6 + 0.4 * sin(uTime * 9.0 + seed)));
    a = max(a, face * 0.95);
  } else if (kind < 4.5) {
    // Dash streak: a tapering spectral ribbon, head at +y, fading toward the tail.
    float t = (1.0 - p.y) * 0.5;
    float hw = mix(0.95, 0.25, t);
    float wob = sin(p.y * 9.0 + uTime * 20.0 + seed * 5.0) * 0.12 * t;
    float e = hw - abs(p.x - wob);
    float cap = 1.0 - smoothstep(0.8, 1.0, abs(p.y));
    if (e <= 0.0 || cap <= 0.0) discard;
    col = ramp(e * 0.4, 0.5 * smoothstep(0.3, 0.7, e) * (1.0 - t));
    a = cap * mix(1.0, 0.25, t);
    add = 0.3 * smoothstep(0.25, 0.6, e);
  } else if (kind < 5.5) {
    // Track glow: rounded stripe with a dark rim, hot centre line.
    float ex = 1.0 - abs(p.x);
    float ey = 1.0 - abs(p.y);
    float e = min(ex, ey * 3.0);
    if (e <= 0.0) discard;
    col = mix(uEdge, uDeep, smoothstep(0.1, 0.45, ex));
    col = mix(col, uCore, smoothstep(0.65, 0.95, ex) * (1.0 - f));
    col = mix(uEdge, col, smoothstep(0.0, 0.18, ex));
    a = smoothstep(0.0, 0.12, ex) * smoothstep(0.0, 0.3, ey);
    add = 0.4 * smoothstep(0.5, 0.9, ex);
  } else if (kind > 6.5 && kind < 7.5) {
    // Smoke: a soft, lumpy, slowly churning violet-black billow, darkest in the middle, a faint violet rim light.
    float r = length(p);
    float ang = atan(p.y, p.x);
    float rad = 0.78 + 0.1 * sin(ang * 3.0 + seed + uTime * 0.8) + 0.07 * sin(ang * 5.0 - seed * 2.0 - uTime * 1.1)
      + 0.05 * sin(ang * 8.0 + seed * 3.0 + uTime * 1.7);
    float e = rad - r;
    if (e <= 0.0) discard;
    float soft = smoothstep(0.0, 0.32, e);
    col = mix(uDeep * 0.55, uEdge * 0.7, smoothstep(0.05, 0.5, e));
    col += uCore * 0.22 * (1.0 - smoothstep(0.0, 0.18, e)) * (1.0 - f);
    a = soft * mix(0.92, 0.55, f);
    add = 0.0;
  } else if (kind > 7.5) {
    // Lightning: a jagged white-violet bolt crackling inside the smoke (five zig-zag segments, flickering).
    float u = (p.y + 1.0) * 2.5;
    float i0 = floor(u);
    float xc = mix(hash1(i0 + seed * 9.1), hash1(i0 + 1.0 + seed * 9.1), fract(u)) * 0.9 - 0.45;
    xc *= smoothstep(0.0, 0.3, 1.0 - abs(p.y));
    float d = abs(p.x - xc);
    float core = 1.0 - smoothstep(0.035, 0.07, d);
    float glow = 1.0 - smoothstep(0.07, 0.3, d);
    float cap = 1.0 - smoothstep(0.85, 1.0, abs(p.y));
    float on = step(0.0, sin(uTime * 70.0 + seed * 17.0) + 0.35);
    a = (core + glow * 0.55) * cap * on;
    if (a < 0.01) discard;
    col = mix(uCore, vec3(1.0, 0.94, 1.0), core);
    add = 0.85;
  } else {
    // Hull flash: an eight-point star with a bright heart and a dark rim.
    float r = length(p);
    float ang = atan(p.y, p.x);
    float spike = 0.5 + 0.5 * pow(abs(cos(ang * 4.0)), 6.0);
    float rad = mix(0.45, 1.0, spike) * (0.55 + 0.45 * f);
    float e = rad - r;
    if (e <= 0.0) discard;
    col = ramp(e * 0.6, 1.0 - smoothstep(0.0, 0.35, r));
    a = 1.0;
    add = 0.55 * (1.0 - smoothstep(0.1, 0.5, r));
  }

  a *= alpha;
  if (a < 0.004) discard;
  float fog = gFog();
  col = mix(col, gFogColor(), fog);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * a, a * (1.0 - add));
}`;

interface Soul {
  active: boolean;
  /** 0 = spiralling up, 1 = darting home. */
  phase: 0 | 1;
  t: number;
  ox: number; oy: number; oz: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  spin: number;
  emitT: number;
  /** Live target (the player plow's position object; read every frame, never copied). */
  target: THREE.Vector3 | null;
}

const _v = new THREE.Vector3();
const SPARKS_LAND = { count: 14, color: GHOST_CORE, speed: 7, size: 0.07, gravity: 6, life: 0.4 };
const SMOKE_RELEASE = { count: 6, color: GHOST_DEEP, size: 0.45, grow: 2.2, life: 1.1, speed: 0.8, up: 1.6, rise: 1.2, drag: 1.4, spread: 0.6, opacity: 0.55, additive: 0 };
const SMOKE_RELEASE_GLOW = { count: 4, color: GHOST_CORE, size: 0.35, grow: 2, life: 0.7, speed: 0.6, up: 2.2, rise: 1.5, drag: 1.4, spread: 0.4, opacity: 0.7, additive: 0.5 };

export class GhostFx implements GhostFxAPI {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aDir: THREE.InstancedBufferAttribute;
  private readonly aMisc: THREE.InstancedBufferAttribute;
  private readonly attrs: readonly THREE.InstancedBufferAttribute[];
  /** Live particles [0, n). Souls are written after them each frame. */
  n = 0;
  private readonly px = new Float32Array(MAX_GHOST);
  private readonly py = new Float32Array(MAX_GHOST);
  private readonly pz = new Float32Array(MAX_GHOST);
  private readonly vx = new Float32Array(MAX_GHOST);
  private readonly vy = new Float32Array(MAX_GHOST);
  private readonly vz = new Float32Array(MAX_GHOST);
  private readonly dx = new Float32Array(MAX_GHOST);
  private readonly dy = new Float32Array(MAX_GHOST);
  private readonly dz = new Float32Array(MAX_GHOST);
  private readonly age = new Float32Array(MAX_GHOST);
  private readonly life = new Float32Array(MAX_GHOST);
  private readonly s0 = new Float32Array(MAX_GHOST);
  private readonly s1 = new Float32Array(MAX_GHOST);
  private readonly len = new Float32Array(MAX_GHOST);
  private readonly rise = new Float32Array(MAX_GHOST);
  private readonly curl = new Float32Array(MAX_GHOST);
  private readonly seed = new Float32Array(MAX_GHOST);
  private readonly kind = new Uint8Array(MAX_GHOST);
  private readonly alpha = new Float32Array(MAX_GHOST);
  private readonly souls: Soul[] = [];
  private time = 0;

  /**
   * `fx` gets the release smoke / landing sparks (null in tests). `ground(x, z, y)` = the surface an effect at
   * height y lands on (snow top, carved ruts, decks, ramps); without it the plow's own height is used.
   */
  constructor(private readonly fx: FxAPI | null, private readonly ground: ((x: number, z: number, y: number) => number) | null = null) {
    const g = (this.geo = new THREE.InstancedBufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.instanceCount = 0;
    const cap = MAX_GHOST + MAX_SOULS;
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
          uCore: { value: new THREE.Color(GHOST_CORE) },
          uBright: { value: new THREE.Color(GHOST_BRIGHT) },
          uDeep: { value: new THREE.Color(GHOST_DEEP) },
          uEdge: { value: new THREE.Color(GHOST_EDGE) },
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
    mesh.name = 'fx-ghost';
    mesh.raycast = () => {};
    for (let i = 0; i < MAX_SOULS; i++) {
      this.souls.push({ active: false, phase: 0, t: 0, ox: 0, oy: 0, oz: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, emitT: 0, target: null });
    }
  }

  /** Live counts (debug / tests). */
  get stats(): { sprites: number; souls: number } {
    let s = 0;
    for (const o of this.souls) if (o.active) s++;
    return { sprites: this.n, souls: s };
  }

  private slot(): number {
    if (this.n < MAX_GHOST) return this.n++;
    let best = 0, bf = -1;
    for (let k = 0; k < 5; k++) {
      const i = (Math.random() * MAX_GHOST) | 0;
      const f = this.age[i] / this.life[i];
      if (f > bf) { bf = f; best = i; }
    }
    return best;
  }

  /** One sprite. `len` > 0 orients it along (ddx, ddy, ddz) (streaks, tracks); `curl` swirls it as it rises. */
  private emit(
    kind: number, x: number, y: number, z: number, vx: number, vy: number, vz: number,
    life: number, size0: number, size1: number, rise: number, curl: number, alpha: number,
    len = 0, ddx = 0, ddy = 0, ddz = 0,
  ): void {
    const i = this.slot();
    this.kind[i] = kind;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = size0; this.s1[i] = size1;
    this.rise[i] = rise; this.curl[i] = curl; this.alpha[i] = alpha;
    this.len[i] = len; this.dx[i] = ddx; this.dy[i] = ddy; this.dz[i] = ddz;
    this.seed[i] = Math.random() * 6.283;
  }

  /**
   * Ghostfire puff from one rear corner at (x, y, z). `groundY` = the surface under the plow, `yaw` its heading,
   * `moved` = metres the plow travelled since the last puff (lays a glowing track mark that long; 0 = parked).
   */
  trail(x: number, y: number, z: number, groundY: number, yaw: number, moved: number, dash: boolean): void {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    // The surface under the corner (ramps / ruts / decks), never far from the plow's own height.
    if (this.ground) {
      const g = this.ground(x, z, groundY + 0.6);
      if (Math.abs(g - groundY) < 1.5) groundY = g;
    }
    const gy = groundY + 0.06;
    // Track glow under the corner, stretched over the ground covered since the last puff.
    if (moved > 0.02) {
      // Centred on the stretch just covered, overlapping the previous mark a little so the line stays unbroken.
      const m = Math.min(2.4, moved);
      // Tilt the mark with the slope (ramps) so neither end sinks into the surface.
      let slope = 0;
      if (this.ground) {
        const gb = this.ground(x - fx * m, z - fz * m, groundY + 0.6);
        if (Math.abs(gb - groundY) < 1.5) slope = (groundY - gb) / m;
      }
      this.emit(G_TRACK, x - fx * m * 0.5, gy - slope * m * 0.5, z - fz * m * 0.5, 0, 0, 0, TRACK_LIFE, TRACK_W, TRACK_W * 0.85, 0, 0, 0.9,
        m * 0.5 + 0.2, fx, slope, fz);
    }
    // A low ember glow at the base: a few small, dim flame tongues (the colour under the smoke).
    const jx = (Math.random() - 0.5) * 0.3, jz = (Math.random() - 0.5) * 0.3;
    if (Math.random() < 0.55) {
      this.emit(G_FLAME, x + jx - fx * 0.15, groundY + 0.2, z + jz - fz * 0.15, -fx * 0.5, 0.4, -fz * 0.5,
        FLAME_LIFE * (0.8 + Math.random() * 0.4), 0.22 + Math.random() * 0.08, 0.1, 1.2, 0, 0.75);
    }
    // Thick violet-black smoke rolling off the back and billowing up (the body of the trail).
    const puffs = dash ? 3 : 2;
    for (let k = 0; k < puffs; k++) {
      const back = 0.2 + Math.random() * 0.4 + k * 0.5;
      this.emit(G_SMOKE, x + jx * 2 - fx * back, y - 0.25 + Math.random() * 0.3, z + jz * 2 - fz * back,
        -fx * (dash ? 1.4 : 0.7) + (Math.random() - 0.5) * 0.5, 0.35 + Math.random() * 0.35, -fz * (dash ? 1.4 : 0.7) + (Math.random() - 0.5) * 0.5,
        SMOKE_LIFE * (0.8 + Math.random() * 0.4), SMOKE_S0 * (0.8 + Math.random() * 0.4), SMOKE_S1 * (0.8 + Math.random() * 0.4), 0.35, 0.3 + Math.random() * 0.3, 0.95);
    }
    // Lightning crackling inside the cloud (more on a dash).
    if (Math.random() < (dash ? BOLT_CHANCE_DASH : BOLT_CHANCE)) {
      const back = 0.8 + Math.random() * (dash ? 2.4 : 1.4);
      this.emit(G_BOLT, x - fx * back + (Math.random() - 0.5) * 0.8, y + 0.1 + Math.random() * 0.7, z - fz * back + (Math.random() - 0.5) * 0.8,
        -fx * 0.4, 0.2, -fz * 0.4, BOLT_LIFE * (0.8 + Math.random() * 0.6), 0.7 + Math.random() * 0.45, 0.75, 0, 0, 1);
    }
    // The odd pale wisp curling out of the top of the smoke.
    if (Math.random() < (dash ? 0.35 : 0.15)) {
      this.emit(G_WISP, x + jx, y + 0.3, z + jz, -fx * 0.6 + (Math.random() - 0.5) * 0.5, 1 + Math.random() * 0.5, -fz * 0.6 + (Math.random() - 0.5) * 0.5,
        WISP_LIFE * (0.8 + Math.random() * 0.4), 0.2 + Math.random() * 0.06, 0.32, 0.9, 0.35 + Math.random() * 0.3, 0.7);
    }
    if (!dash) return;
    // Dash: a dark spectral streak with ghostly chain links flickering inside it.
    this.emit(G_STREAK, x - fx * 1.2, y + 0.1 + Math.random() * 0.3, z - fz * 1.2, -fx * 2, 0.3, -fz * 2, 0.38, 0.42, 0.12, 0, 0, 0.85,
      1.9 + Math.random() * 0.6, fx, 0, fz);
    if (Math.random() < 0.6) {
      const back = 0.5 + Math.random() * 1.6;
      this.emit(G_LINK, x - fx * back + jx, y + 0.15 + Math.random() * 0.3, z - fz * back + jz, -fx * 1.2, 0.3, -fz * 1.2,
        0.45, 0.32, 0.24, 0, 0, 1);
    }
  }

  /** Soul Harvest: a skull-faced soul rises out of the wreck at `at`, spirals up, then darts into `target`. */
  soul(at: THREE.Vector3, target: THREE.Vector3 | null): void {
    let s: Soul | null = null;
    for (const o of this.souls) if (!o.active) { s = o; break; }
    if (!s) {
      // Pool full: recycle the one furthest along.
      s = this.souls[0];
      for (const o of this.souls) if (o.phase > s.phase || (o.phase === s.phase && o.t > s.t)) s = o;
    }
    s.active = true;
    s.phase = 0;
    s.t = 0;
    s.ox = at.x; s.oy = at.y; s.oz = at.z;
    s.spin = Math.random() * Math.PI * 2;
    soulPose(0, s.spin, _v);
    s.x = at.x + _v.x; s.y = at.y + _v.y; s.z = at.z + _v.z;
    s.vx = 0; s.vy = 0; s.vz = 0;
    s.emitT = 0;
    s.target = target;
    // Release puff: dark violet smoke curling off the wreck with a glowing heart.
    if (this.fx) {
      _v.set(at.x, at.y + 0.6, at.z);
      this.fx.smoke(_v, SMOKE_RELEASE);
      this.fx.smoke(_v, SMOKE_RELEASE_GLOW);
    }
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      this.emit(G_WISP, at.x + Math.cos(a) * 0.5, at.y + 0.4, at.z + Math.sin(a) * 0.5, Math.cos(a) * 0.8, 1.6, Math.sin(a) * 0.8,
        0.9, 0.18, 0.32, 1, 0.5, 0.9);
    }
  }

  private land(s: Soul): void {
    s.active = false;
    const t = s.target;
    const x = t ? t.x : s.x, y = t ? t.y + HULL_Y : s.y, z = t ? t.z : s.z;
    this.emit(G_FLASH, x, y, z, 0, 0, 0, 0.4, 0.9, 1.9, 0, 0, 1);
    for (let k = 0; k < 5; k++) {
      this.emit(G_WISP, x, y, z, (Math.random() - 0.5) * 3, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 3, 0.55, 0.12, 0.2, 0.5, 0.4, 0.9);
    }
    if (this.fx) {
      _v.set(x, y, z);
      this.fx.sparks(_v, null, SPARKS_LAND);
      _v.y = (t ? t.y : y - HULL_Y) + 0.05;
      this.fx.ring(_v, 2.2, GHOST_CORE);
    }
  }

  private updateSouls(dt: number): void {
    for (const s of this.souls) {
      if (!s.active) continue;
      s.t += dt;
      const px = s.x, py = s.y, pz = s.z;
      if (s.phase === 0) {
        soulPose(s.t, s.spin, _v);
        s.x = s.ox + _v.x; s.y = s.oy + _v.y; s.z = s.oz + _v.z;
        if (dt > 0) { s.vx = (s.x - px) / dt; s.vy = (s.y - py) / dt; s.vz = (s.z - pz) / dt; }
        if (s.t >= SOUL_RISE) {
          if (!s.target) {
            s.active = false;
            continue;
          }
          s.phase = 1;
          s.t = 0;
        }
      } else {
        const tg = s.target!;
        const tx = tg.x - s.x, ty = tg.y + HULL_Y - s.y, tz = tg.z - s.z;
        const d = Math.hypot(tx, ty, tz);
        const step = (DART_V0 + (DART_V1 - DART_V0) * Math.min(1, s.t / 0.5));
        if (d < DART_HIT || d < step * dt || s.t > SOUL_DART_MAX) {
          this.land(s);
          continue;
        }
        const k = 1 - Math.exp(-DART_STEER * dt);
        s.vx += (tx / d * step - s.vx) * k;
        s.vy += (ty / d * step - s.vy) * k;
        s.vz += (tz / d * step - s.vz) * k;
        s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      }
      // Ghost trail behind the soul: wisps while it rises, a streak while it darts.
      s.emitT -= dt;
      if (s.emitT <= 0) {
        s.emitT = s.phase === 0 ? 0.045 : 0.025;
        const sp = Math.hypot(s.vx, s.vy, s.vz);
        if (s.phase === 1 && sp > 1) {
          this.emit(G_STREAK, s.x - s.vx * 0.03, s.y - s.vy * 0.03, s.z - s.vz * 0.03, 0, 0, 0, 0.25, 0.4, 0.1, 0, 0, 0.9,
            Math.min(1.8, sp * 0.06), s.vx / sp, s.vy / sp, s.vz / sp);
        } else {
          this.emit(G_WISP, s.x + (Math.random() - 0.5) * 0.3, s.y - 0.55, s.z + (Math.random() - 0.5) * 0.3, -s.vx * 0.15, 0.2, -s.vz * 0.15,
            0.7, 0.26, 0.08, 0.2, 0.3, 0.85);
        }
      }
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time % 1000;
    this.updateSouls(dt);
    const { px, py, pz, vx, vy, vz, dx, dy, dz, age, life, s0, s1, len, rise, curl, seed, kind, alpha } = this;
    const P = this.aPos.array as Float32Array;
    const D = this.aDir.array as Float32Array;
    const M = this.aMisc.array as Float32Array;
    const drag = Math.max(0, 1 - 1.6 * dt);
    let i = 0;
    while (i < this.n) {
      age[i] += dt;
      if (age[i] >= life[i]) {
        this.kill(i);
        continue;
      }
      vx[i] *= drag; vz[i] *= drag;
      vy[i] = vy[i] * drag + rise[i] * dt;
      px[i] += vx[i] * dt; py[i] += vy[i] * dt; pz[i] += vz[i] * dt;
      const f = age[i] / life[i];
      const s = s0[i] + (s1[i] - s0[i]) * f;
      // Curl: swirl around the rise axis, wider as it climbs.
      let cx = 0, cz = 0;
      if (curl[i] > 0) {
        const a = seed[i] + age[i] * 4.2;
        cx = Math.cos(a) * curl[i] * f;
        cz = Math.sin(a) * curl[i] * f;
      }
      const k = kind[i];
      const fadeIn = Math.min(1, f * (k === G_TRACK ? 30 : 8));
      const fade = k === G_FLASH ? 1 - f * f : k === G_TRACK ? Math.pow(1 - f, 1.6) : k === G_SMOKE ? 1 - f : 1 - f * f * f;
      const h = i * 4;
      P[h] = px[i] + cx; P[h + 1] = py[i]; P[h + 2] = pz[i] + cz; P[h + 3] = s;
      D[h] = dx[i]; D[h + 1] = dy[i]; D[h + 2] = dz[i]; D[h + 3] = len[i];
      M[h] = k; M[h + 1] = f; M[h + 2] = alpha[i] * fadeIn * fade; M[h + 3] = seed[i];
      i++;
    }
    // Souls after the particles (bob and pulse slightly).
    let n = this.n;
    for (let j = 0; j < this.souls.length; j++) {
      const s = this.souls[j];
      if (!s.active) continue;
      const h = n * 4;
      const grow = s.phase === 0 ? Math.min(1, s.t * 4) : 1 - Math.min(0.45, s.t * 0.5);
      P[h] = s.x; P[h + 1] = s.y + Math.sin(this.time * 5 + j) * 0.05; P[h + 2] = s.z; P[h + 3] = SOUL_SIZE * grow;
      D[h] = 0; D[h + 1] = 0; D[h + 2] = 0; D[h + 3] = 0;
      M[h] = G_SKULL; M[h + 1] = 0; M[h + 2] = Math.min(1, s.t * 5 + (s.phase === 1 ? 1 : 0)); M[h + 3] = j * 1.7;
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
    for (const s of this.souls) s.active = false;
    this.finish(0);
  }

  private kill(i: number): void {
    const l = --this.n;
    if (i === l) return;
    this.kind[i] = this.kind[l];
    this.px[i] = this.px[l]; this.py[i] = this.py[l]; this.pz[i] = this.pz[l];
    this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l]; this.vz[i] = this.vz[l];
    this.dx[i] = this.dx[l]; this.dy[i] = this.dy[l]; this.dz[i] = this.dz[l];
    this.age[i] = this.age[l]; this.life[i] = this.life[l]; this.s0[i] = this.s0[l]; this.s1[i] = this.s1[l];
    this.len[i] = this.len[l]; this.rise[i] = this.rise[l]; this.curl[i] = this.curl[l];
    this.seed[i] = this.seed[l]; this.alpha[i] = this.alpha[l];
  }
}
