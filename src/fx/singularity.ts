import * as THREE from 'three';
import { currentPreset } from '../core/settings';

/* ARSENAL ultimate SINGULARITY: a black hole that opens mid-fight, holds ~3 s, then collapses and detonates.
 *
 * Layers (all in one Group, hidden while idle; everything is built once in the constructor):
 *   lens      camera-facing quad, ~4.2x the core radius. Does the black core (shadow), the sharp photon ring at its
 *             rim, the Einstein-ring glint, the lensed arc of the disc wrapped over the top / under the bottom
 *             (Interstellar look) and the gravitational lensing of whatever is behind it. Drawn first among the
 *             transparent objects (renderOrder -10) with depthTest off; foreground objects are masked out with the
 *             grab's depth texture instead (see below).
 *   coreDepth colour-less disc at the core that writes depth, so the far half of the accretion disc, infalling
 *             particles behind the hole and other FX behind it are hidden by the black core.
 *   disc      flat ring tilted ~16 degrees to the view (the near half crosses the core), spiral streak noise,
 *             white-hot inner edge -> cyan -> violet -> deep blue, Doppler-bright on the approaching side, Keplerian
 *             differential spin. Premultiplied blend (emission + a little occlusion) so it reads on white snow.
 *   motes     one instanced draw of pooled infall particles (snow, cyan sparks, dark scrap) spiralling in, stretched
 *             along their screen-space velocity; reused as outward debris streaks for the explosion.
 *   collapse  flash billboard (white-cyan core + anamorphic streak), shock ring billboard + ring in the disc plane,
 *             and a refractive ripple billboard that bends the scene behind the shock front.
 *
 * Lensing: a real screen-space refraction without touching the render pipeline. In the lens quad's onBeforeRender
 * (like three's Reflector) the scene is rendered again into a small 512x512 half-float target from the SAME camera,
 * with a projection sub-window (setViewOffset) covering just the lens on screen, so frustum culling throws away
 * nearly everything else, the shadow maps are reused (shadowMap.autoUpdate off) and this effect itself is hidden.
 * The target is flagged like post.ts's scene target (isXRRenderTarget + sRGB), so it holds exactly the
 * display-referred colours the frame would have, on both the canvas path (ACES) and the bloom path (ACES + HDR
 * excess), with no extra shader programs. The lens shader then samples it with a point-mass lens map
 * (beta = theta - thetaE^2 / theta, faded to zero deflection at the quad's edge, slight chromatic split) and
 * re-projects each deflected point through the grab camera, so the mapping is exact whatever the grab window.
 * A depth texture on the grab masks out anything nearer than the lens plane (players in front stay crisp and
 * unlensed, the ground in front of a low hole fades in softly instead of cutting a seam). If the camera isn't a
 * PerspectiveCamera or float colour buffers are missing, the lens falls back to a darkening ring + rings only.
 *
 * NaN / Inf safety: every division / normalize / pow / atan in the shaders is guarded and every output is clamped to
 * [0, 32] (a NaN pixel once smeared black blocks through the bloom chain). */

const CYAN = new THREE.Color(0x38e8ff);
const VIOLET = new THREE.Color(0x8a4dff);
const DEEP = new THREE.Color(0x2a3cff);
const GRAB_SIZE = 512;
const MOTES = 170;
/** Disc tilt toward the camera (radians): near edge-on, like the film shot. */
const DISC_TILT = THREE.MathUtils.degToRad(20);
const OPEN_TIME = 0.5;
const SHRINK_TIME = 0.2;
const BOOM_TIME = 1.0;

const NOISE = /* glsl */ `
float shHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
// value noise, periodic in x with period per
float shNoiseP(vec2 p, float per) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, per), x1 = mod(i.x + 1.0, per);
  float a = shHash(vec2(x0, i.y)), b = shHash(vec2(x1, i.y));
  float c = shHash(vec2(x0, i.y + 1.0)), d = shHash(vec2(x1, i.y + 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// streaky orbit noise: a in [0,1) around the ring, rad along the radius
float shStreak(float a, float rad, float seed) {
  float n = shNoiseP(vec2(a * 10.0, rad * 9.0 + seed), 10.0) * 0.5
          + shNoiseP(vec2(a * 20.0, rad * 23.0 + seed * 1.7), 20.0) * 0.32
          + shNoiseP(vec2(a * 40.0, rad * 47.0 + seed * 2.3), 40.0) * 0.18;
  return n;
}
float shAtan(vec2 p) { return atan(p.y, abs(p.x) < 1e-6 ? (p.x < 0.0 ? -1e-6 : 1e-6) : p.x); }
`;

/** Shared by lens + ripple: re-project a lens-plane point through the grab camera, and the foreground mask. */
const GRAB_GLSL = /* glsl */ `
uniform sampler2D tCap;
uniform sampler2D tDepth;
uniform mat4 uCapProj;
uniform float uCapNear;
uniform float uCapFar;
uniform float uGrab;
varying vec3 vC;
varying vec3 vR;
varying vec3 vU;
vec3 planeView(vec2 q) { return vC + vR * q.x + vU * q.y; }
vec2 capUv(vec2 q) {
  vec4 c = uCapProj * vec4(planeView(q), 1.0);
  vec2 uv = c.xy / max(c.w, 1e-3) * 0.5 + 0.5;
  return clamp(uv, vec2(0.002), vec2(0.998));
}
vec3 capColor(vec2 uv) {
  vec3 c = texture2D(tCap, uv).rgb;
  float s = c.r + c.g + c.b;
  if (!(s >= 0.0) || !(s < 1000.0)) c = vec3(0.0);
  return clamp(c, vec3(0.0), vec3(16.0));
}
// 1 where the scene at this pixel is nearer than the lens plane by more than ~soft metres
float foreground(vec2 q, float soft) {
  float d = texture2D(tDepth, capUv(q)).x;
  float n = uCapNear, f = uCapFar;
  float den = (f - n) * clamp(d, 0.0, 1.0) - f;
  float sceneZ = (n * f) / min(den, -1e-4);
  float planeZ = planeView(q).z;
  return smoothstep(0.15 * soft, soft, sceneZ - planeZ);
}
`;

const BILLBOARD_VERT = /* glsl */ `
varying vec2 vP;
varying vec3 vC;
varying vec3 vR;
varying vec3 vU;
void main() {
  vP = position.xy;
  vC = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vR = (modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz;
  vU = (modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const LENS_FRAG = /* glsl */ `
${NOISE}
${GRAB_GLSL}
varying vec2 vP;
uniform float uRL;
uniform float uRc;
uniform float uRe;
uniform float uStrength;
uniform float uDark;
uniform float uFade;
uniform float uTime;
uniform float uWob;
uniform float uRing;
uniform float uArc;
uniform float uSpin;
uniform vec3 uCyan;
uniform vec3 uViolet;
void main() {
  vec2 pp = vP;
  float lp = length(pp);
  float r = lp * uRL;                       // metres from the centre, in the lens plane
  float phi = shAtan(pp);
  float rc = uRc * (1.0 + uWob * sin(3.0 * phi + uTime * 7.0) + 0.6 * uWob * sin(5.0 * phi - uTime * 11.0));
  rc = max(rc, 1e-3);
  float aa = max(fwidth(r), 1e-4) * 1.2;
  float core = 1.0 - smoothstep(rc - aa, rc + aa, r);

  // ---- lensed background
  float rr = max(r, 0.05);
  float win = 1.0 - smoothstep(0.3 * uRL, 0.92 * uRL, r);
  float def = min(uStrength * win * (uRe * uRe) / (rr * rr), 6.0);
  float edge = 1.0 - smoothstep(0.72 * uRL, uRL, r);
  float near = 1.0 - smoothstep(rc, 0.75 * uRL, r);
  vec3 bg = vec3(0.0);
  float fg = 0.0;
  if (uGrab > 0.5) {
    bg.r = capColor(capUv(pp * (1.0 - def * 1.035))).r;
    bg.g = capColor(capUv(pp * (1.0 - def))).g;
    bg.b = capColor(capUv(pp * (1.0 - def * 0.965))).b;
    fg = foreground(pp, 4.0);
  }
  // gravitational redshift-ish darkening toward the hole, cool tint, extra darkness during the collapse
  float dk = mix(1.0, 0.3, near * uStrength) * (1.0 - uDark * (1.0 - smoothstep(0.0, uRL, r)));
  bg *= dk * mix(vec3(1.0), vec3(0.78, 0.9, 1.12), near);
  float aBg = uGrab > 0.5 ? edge : edge * (1.0 - dk) * 0.85;

  // ---- photon ring + Einstein glint
  float dr = r - rc;
  float ring = exp(-(dr * dr) / max(pow(0.025 * uRc + aa, 2.0), 1e-6));
  float glow = exp(-max(dr, 0.0) / max(0.2 * uRc, 1e-3)) * step(0.0, dr);
  float side = 1.0 - 0.3 * cos(phi);        // approaching (left) side brighter
  float pulse = 1.0 + 0.18 * sin(uTime * 5.0 + 1.3);
  vec3 em = (mix(uCyan, vec3(1.0), 0.75) * 1.7 * ring + uCyan * 0.28 * glow) * side * pulse * uRing;
  float er = (r - uRe * 1.04) / max(0.07 * uRc, 1e-3);
  em += uCyan * 0.18 * exp(-er * er) * uStrength * uRing * (0.7 + 0.3 * sin(phi * 2.0 + uTime));

  // ---- lensed arc of the disc over the top (thick) and under the bottom (thin)
  float sp = sin(phi);
  float w = uRc * (0.1 + 0.6 * smoothstep(-0.25, 1.0, sp));
  float u = (r - rc * 1.025) / max(w, 1e-3);
  float prof = smoothstep(0.0, 0.05, u) * exp(-max(u, 0.0) * 2.4) * (1.0 - smoothstep(1.2, 2.2, u));
  float a01 = phi / 6.2831853 + 0.5;
  float n = shStreak(fract(a01 + uTime * uSpin * 0.12), u * 0.6, 7.0);
  vec3 arcCol = mix(mix(uCyan, vec3(1.0), 0.6) * 1.2, uCyan * 0.95, smoothstep(0.0, 0.35, u));
  arcCol = mix(arcCol, uViolet * 0.8, smoothstep(0.35, 1.3, u));
  em += arcCol * prof * (0.3 + 2.0 * n * n) * side * uArc * mix(0.55, 1.0, smoothstep(-0.6, 0.6, sp));

  em *= 1.0 - core;                          // nothing glows inside the shadow
  float a = max(core, aBg) * (1.0 - fg) * uFade;
  vec3 col = (bg * aBg * (1.0 - core) + em) * (1.0 - fg) * uFade;
  gl_FragColor = vec4(clamp(col, vec3(0.0), vec3(32.0)), clamp(a, 0.0, 1.0));
}`;

const RIPPLE_FRAG = /* glsl */ `
${GRAB_GLSL}
varying vec2 vP;
uniform float uScale;
uniform float uRadius;
uniform float uWidth;
uniform float uAmp;
uniform vec3 uCyan;
void main() {
  vec2 pp = vP;
  float r = length(pp) * uScale;
  float x = (r - uRadius) / max(uWidth, 1e-3);
  float g = exp(-x * x);
  float band = exp(-x * x * 0.6);
  float edge = 1.0 - smoothstep(0.85 * uScale, uScale, r);
  if (uGrab < 0.5 || band * edge < 0.003) { gl_FragColor = vec4(0.0); return; }
  // derivative-of-gaussian push: the scene is compressed ahead of the front, stretched behind it
  float k = 1.0 - uAmp * (-2.0 * x * g) / max(r, 0.5);
  vec2 dir = pp;
  float ca = 0.004 * g;
  vec3 c = vec3(capColor(capUv(dir * (k + ca))).r, capColor(capUv(dir * k)).g, capColor(capUv(dir * (k - ca))).b);
  c += uCyan * 0.08 * g * min(uAmp, 2.0);
  float a = band * edge * (1.0 - foreground(pp, 1.6));
  gl_FragColor = vec4(clamp(c * a, vec3(0.0), vec3(32.0)), clamp(a, 0.0, 1.0));
}`;

const DISC_VERT = /* glsl */ `
varying vec2 vL;
void main() {
  vL = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const DISC_FRAG = /* glsl */ `
${NOISE}
varying vec2 vL;
uniform float uIn;
uniform float uOut;
uniform float uTime;
uniform float uSpin;
uniform float uAlpha;
uniform vec3 uCyan;
uniform vec3 uViolet;
uniform vec3 uDeep;
void main() {
  float r = length(vL);
  float rr = max(r, 1e-3);
  float t = clamp((r - uIn) / max(uOut - uIn, 1e-3), 0.0, 1.0);
  float phi = shAtan(vL);
  float omega = uSpin * pow(clamp(uIn / rr, 0.05, 1.0), 1.5);    // Keplerian-ish: inner laps faster
  float a = fract(phi / 6.2831853 + 0.5 + uTime * omega * 0.159155);
  float n = shStreak(a, t * 1.6, 3.0);
  float n2 = shNoiseP(vec2(fract(a * 3.0 + t * 0.7) * 6.0, t * 4.0), 6.0);  // slow spiral arms
  float dens = 0.15 + 1.9 * n * n * (0.55 + 0.7 * n2);
  float prof = smoothstep(0.0, 0.03, t) * pow(1.0 - t, 1.3) * (1.0 + 0.8 * exp(-t * 12.0));
  vec3 c = mix(mix(uCyan, vec3(1.0), 0.65) * 1.3, uCyan * 1.0, smoothstep(0.0, 0.14, t));
  c = mix(c, uViolet * 0.85, smoothstep(0.22, 0.6, t));
  c = mix(c, uDeep * 0.5, smoothstep(0.65, 1.0, t));
  float dop = clamp(1.0 - 0.5 * vL.x / rr, 0.4, 1.5);            // left side approaches the camera
  float beam = dop * dop;
  c = mix(c, vec3(dot(c, vec3(0.33))) * vec3(0.85, 0.95, 1.1), clamp(dop - 1.0, 0.0, 0.6) * 0.5);  // blue-white shift
  vec3 em = c * prof * dens * beam * uAlpha;
  float occ = clamp(prof * (0.35 + dens) * 0.6, 0.0, 0.8) * uAlpha;
  gl_FragColor = vec4(clamp(em, vec3(0.0), vec3(32.0)), occ);
}`;

const FLASH_FRAG = /* glsl */ `
varying vec2 vP;
uniform float uI;
uniform vec3 uCyan;
void main() {
  vec2 p = vP;
  float r2 = dot(p, p);
  float core = exp(-r2 * 60.0);
  float halo = exp(-sqrt(r2) * 7.0);
  float streak = exp(-abs(p.y) * 90.0) * exp(-abs(p.x) * 3.0);
  vec3 c = vec3(1.0) * core * 2.0 + mix(uCyan, vec3(1.0), 0.3) * halo * 0.3 + uCyan * streak * 0.8;
  float edge = 1.0 - smoothstep(0.8, 1.0, sqrt(r2));
  float occ = clamp(core * 0.9 + halo * 0.65, 0.0, 0.92);       // replace, don't stack on bright snow
  gl_FragColor = vec4(clamp(c * uI * edge, vec3(0.0), vec3(32.0)), clamp(occ * uI * edge, 0.0, 1.0));
}`;

const RING_FRAG = /* glsl */ `
varying vec2 vP;
uniform float uScale;
uniform float uRadius;
uniform float uWidth;
uniform float uI;
uniform vec3 uCyan;
uniform vec3 uViolet;
void main() {
  float r = length(vP) * uScale;
  float x = (r - uRadius) / max(uWidth, 1e-3);
  // sharp leading edge, softer trailing wake
  float lead = exp(-x * x * 9.0) * step(0.0, x);
  float wake = exp(-max(-x, 0.0) * 2.2) * step(x, 0.0);
  float m = max(lead, wake * 0.55);
  vec3 c = mix(uViolet * 0.7, uCyan * 1.0, smoothstep(-1.2, -0.05, x));
  c = mix(c, mix(uCyan, vec3(1.0), 0.7) * 1.5, exp(-x * x * 25.0));
  float edge = 1.0 - smoothstep(0.9 * uScale, uScale, r);
  float k = m * uI * edge;
  gl_FragColor = vec4(clamp(c * k, vec3(0.0), vec3(32.0)), clamp(k * 0.6, 0.0, 1.0));
}`;

const MOTE_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iCol;
attribute vec2 iSize;
varying vec2 vQ;
varying vec4 vCol;
void main() {
  vec3 head = (modelViewMatrix * vec4(iPos, 1.0)).xyz;
  vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
  vec3 view = head / max(length(head), 1e-4);
  vec3 seg = vv * iSize.y;
  vec3 perp = seg - view * dot(seg, view);
  float L = length(perp);
  vec3 dir = L > 1e-5 ? perp / L : vec3(0.0, 1.0, 0.0);
  vec3 side = cross(dir, view);
  float sl = length(side);
  side = sl > 1e-5 ? side / sl : vec3(1.0, 0.0, 0.0);
  float len = max(L, iSize.x * 2.0);
  vec3 p = head - dir * len * (1.0 - position.y) + side * position.x * iSize.x;
  vQ = position.xy;
  vCol = iCol;
  gl_Position = projectionMatrix * vec4(p, 1.0);
}`;

const MOTE_FRAG = /* glsl */ `
varying vec2 vQ;
varying vec4 vCol;
void main() {
  float across = 1.0 - vQ.x * vQ.x;
  float along = smoothstep(0.0, 1.0, vQ.y) * smoothstep(1.0, 0.85, vQ.y);
  float m = clamp(across * (0.25 + 0.75 * along), 0.0, 1.0);
  vec3 em = max(vCol.rgb, vec3(0.0)) * m;
  gl_FragColor = vec4(clamp(em, vec3(0.0), vec3(32.0)), clamp(vCol.a * m, 0.0, 1.0));
}`;

/** Premultiplied alpha: rgb is added, alpha occludes what's behind. Lets one draw both glow and darken. */
function premul(m: THREE.ShaderMaterial): THREE.ShaderMaterial {
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  m.blendEquation = THREE.AddEquation;
  m.premultipliedAlpha = true;
  return m;
}

function premulBillboard(frag: string, uniforms: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return premul(new THREE.ShaderMaterial({
    vertexShader: BILLBOARD_VERT,
    fragmentShader: frag,
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  }));
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const _v = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _R = new THREE.Vector3();
const _U = new THREE.Vector3();
const _T = new THREE.Vector3();
const _N = new THREE.Vector3();
const _Y = new THREE.Vector3();

type MoteKind = 0 | 1 | 2; // snow, spark, scrap

export class SingularityFx {
  private readonly group = new THREE.Group();
  /** Photosensitivity setting, read at every open() (the FX may be built long before its first use). */
  reduceFlash: boolean;
  private readonly lensingOn: boolean;

  private readonly lens: THREE.Mesh;
  private readonly lensMat: THREE.ShaderMaterial;
  private readonly coreDepth: THREE.Mesh;
  private readonly disc: THREE.Mesh;
  private readonly discMat: THREE.ShaderMaterial;
  private readonly motes: THREE.Mesh;
  private readonly moteMat: THREE.ShaderMaterial;
  private readonly flash: THREE.Mesh;
  private readonly flashMat: THREE.ShaderMaterial;
  private readonly ring: THREE.Mesh;
  private readonly ringMat: THREE.ShaderMaterial;
  private readonly flatRing: THREE.Mesh;
  private readonly flatRingMat: THREE.ShaderMaterial;
  private readonly ripple: THREE.Mesh;
  private readonly rippleMat: THREE.ShaderMaterial;
  private readonly geos: THREE.BufferGeometry[] = [];

  // screen grab for the lensing / ripple
  private readonly rt: THREE.WebGLRenderTarget;
  private readonly capCam = new THREE.PerspectiveCamera();
  private readonly grabU: Record<string, THREE.IUniform>;
  private grabOk: boolean | null = null;
  private grabbing = false;

  // motes (struct-of-arrays, local disc frame)
  private readonly mPos: Float32Array;
  private readonly mVel: Float32Array;
  private readonly mCol: Float32Array;
  private readonly mSize: Float32Array;
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aVel: THREE.InstancedBufferAttribute;
  private readonly aCol: THREE.InstancedBufferAttribute;
  private readonly aSize: THREE.InstancedBufferAttribute;
  private readonly mR = new Float32Array(MOTES);
  private readonly mPhi = new Float32Array(MOTES);
  private readonly mH0 = new Float32Array(MOTES);
  private readonly mR0 = new Float32Array(MOTES);
  private readonly mAge = new Float32Array(MOTES);
  private readonly mSpd = new Float32Array(MOTES);
  private readonly mKind = new Uint8Array(MOTES);
  private readonly mSeed = new Float32Array(MOTES);

  private readonly center = new THREE.Vector3();
  private state: 'idle' | 'open' | 'collapse' = 'idle';
  private t = 0; // since open
  private ct = 0; // since collapse
  private rc = 3; // core radius (m)
  private R = 40; // pull radius
  private boomed = false;

  constructor(scene: THREE.Scene, opts?: { reduceFlash?: boolean; lensing?: boolean }) {
    this.reduceFlash = !!opts?.reduceFlash;
    this.lensingOn = opts?.lensing !== false;
    this.group.name = 'SingularityFx';
    this.group.visible = false;

    this.rt = new THREE.WebGLRenderTarget(GRAB_SIZE, GRAB_SIZE, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.rt.texture.name = 'singularity.grab';
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;
    this.rt.depthTexture = new THREE.DepthTexture(GRAB_SIZE, GRAB_SIZE);
    // Render like the canvas / post.ts scene target (tone mapping + sRGB encode), see post.ts.
    (this.rt as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
    this.capCam.matrixAutoUpdate = true;

    this.grabU = {
      tCap: { value: this.rt.texture },
      tDepth: { value: this.rt.depthTexture },
      uCapProj: { value: new THREE.Matrix4() },
      uCapNear: { value: 0.1 },
      uCapFar: { value: 1000 },
      uGrab: { value: 0 },
    };

    const quad = new THREE.PlaneGeometry(2, 2);
    this.geos.push(quad);

    // ---- lens (core, photon ring, lensed arc, lensing)
    this.lensMat = premul(
      new THREE.ShaderMaterial({
        vertexShader: BILLBOARD_VERT,
        fragmentShader: LENS_FRAG,
        uniforms: {
          ...this.grabU,
          uRL: { value: 12 },
          uRc: { value: 3 },
          uRe: { value: 4 },
          uStrength: { value: 1 },
          uDark: { value: 0 },
          uFade: { value: 1 },
          uTime: { value: 0 },
          uWob: { value: 0 },
          uRing: { value: 1 },
          uArc: { value: 1 },
          uSpin: { value: 1 },
          uCyan: { value: CYAN },
          uViolet: { value: VIOLET },
        },
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.lens = new THREE.Mesh(quad, this.lensMat);
    this.lens.renderOrder = -10;
    this.lens.frustumCulled = false;
    this.lens.onBeforeRender = (renderer, sc, camera) => this.grab(renderer, sc, camera, this.lens, this.lensMat);

    // ---- depth-only core disc
    const circle = new THREE.CircleGeometry(1, 48);
    this.geos.push(circle);
    this.coreDepth = new THREE.Mesh(circle, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true }));
    this.coreDepth.renderOrder = -9;
    this.coreDepth.frustumCulled = false;

    // ---- accretion disc
    this.discMat = premul(
      new THREE.ShaderMaterial({
        vertexShader: DISC_VERT,
        fragmentShader: DISC_FRAG,
        uniforms: {
          uIn: { value: 1.3 },
          uOut: { value: 3.3 },
          uTime: { value: 0 },
          uSpin: { value: 7 },
          uAlpha: { value: 1 },
          uCyan: { value: CYAN },
          uViolet: { value: VIOLET },
          uDeep: { value: DEEP },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    // Unit-core disc geometry (inner 1.3, outer 3.3 core radii); the mesh is scaled by the core radius.
    const discGeo = new THREE.RingGeometry(1.3, 3.3, 160, 8);
    this.geos.push(discGeo);
    this.disc = new THREE.Mesh(discGeo, this.discMat);
    this.disc.renderOrder = 2;
    this.disc.frustumCulled = false;

    // ---- infall motes
    const mg = new THREE.InstancedBufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    mg.setIndex([0, 1, 2, 2, 1, 3]);
    this.mPos = new Float32Array(MOTES * 3);
    this.mVel = new Float32Array(MOTES * 3);
    this.mCol = new Float32Array(MOTES * 4);
    this.mSize = new Float32Array(MOTES * 2);
    this.aPos = new THREE.InstancedBufferAttribute(this.mPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(this.mVel, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(this.mCol, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(this.mSize, 2).setUsage(THREE.DynamicDrawUsage);
    mg.setAttribute('iPos', this.aPos);
    mg.setAttribute('iVel', this.aVel);
    mg.setAttribute('iCol', this.aCol);
    mg.setAttribute('iSize', this.aSize);
    mg.instanceCount = MOTES;
    this.geos.push(mg);
    this.moteMat = premul(
      new THREE.ShaderMaterial({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.motes = new THREE.Mesh(mg, this.moteMat);
    this.motes.renderOrder = 3;
    this.motes.frustumCulled = false;

    // ---- collapse / explosion
    this.flashMat = premulBillboard(FLASH_FRAG, { uI: { value: 0 }, uCyan: { value: CYAN } });
    this.flash = new THREE.Mesh(quad, this.flashMat);
    this.flash.renderOrder = 6;
    this.flash.frustumCulled = false;
    this.flashMat.depthTest = false;
    const ringU = () => ({
      uScale: { value: 1 },
      uRadius: { value: 0 },
      uWidth: { value: 1 },
      uI: { value: 0 },
      uCyan: { value: CYAN },
      uViolet: { value: VIOLET },
    });
    this.ringMat = premulBillboard(RING_FRAG, ringU());
    this.ring = new THREE.Mesh(quad, this.ringMat);
    this.ring.renderOrder = 5;
    this.ring.frustumCulled = false;
    this.flatRingMat = premulBillboard(RING_FRAG, ringU());
    this.flatRing = new THREE.Mesh(quad, this.flatRingMat);
    this.flatRing.renderOrder = 5;
    this.flatRing.frustumCulled = false;
    this.rippleMat = premul(
      new THREE.ShaderMaterial({
        vertexShader: BILLBOARD_VERT,
        fragmentShader: RIPPLE_FRAG,
        uniforms: { ...this.grabU, uScale: { value: 1 }, uRadius: { value: 0 }, uWidth: { value: 1 }, uAmp: { value: 0 }, uCyan: { value: CYAN } },
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.ripple = new THREE.Mesh(quad, this.rippleMat);
    this.ripple.renderOrder = -10;
    this.ripple.frustumCulled = false;
    this.ripple.onBeforeRender = (renderer, sc, camera) => this.grab(renderer, sc, camera, this.ripple, this.rippleMat);

    this.group.add(this.lens, this.coreDepth, this.disc, this.motes, this.flash, this.ring, this.flatRing, this.ripple);
    scene.add(this.group);
  }

  get active(): boolean {
    return this.state !== 'idle';
  }

  open(pos: THREE.Vector3, radius: number): void {
    this.center.copy(pos);
    this.group.position.copy(pos);
    this.R = Math.max(1, radius);
    this.rc = THREE.MathUtils.clamp(this.R * 0.075, 2.2, 3.5);
    this.state = 'open';
    this.t = 0;
    this.ct = 0;
    this.boomed = false;
    this.group.visible = true;
    this.lens.visible = this.coreDepth.visible = this.disc.visible = this.motes.visible = true;
    this.flash.visible = this.ring.visible = this.flatRing.visible = this.ripple.visible = false;
    for (let i = 0; i < MOTES; i++) this.spawnMote(i, true);
  }

  collapse(): void {
    if (this.state !== 'open') return;
    this.state = 'collapse';
    this.ct = 0;
  }

  update(dt: number, camera: THREE.Camera): void {
    if (this.state === 'idle') return;
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.t += dt;
    if (this.state === 'collapse') this.ct += dt;

    // camera-facing basis (world up kept as the billboard's up, so the lensed arc sits on top)
    camera.getWorldPosition(_camPos);
    for (const m of [this.lens, this.coreDepth, this.flash, this.ring, this.ripple]) m.lookAt(_camPos);
    this.lens.updateMatrix();
    _m.extractRotation(this.lens.matrix);
    _R.setFromMatrixColumn(_m, 0);
    _U.setFromMatrixColumn(_m, 1);
    _T.setFromMatrixColumn(_m, 2);
    // disc: normal tilted DISC_TILT toward the camera from the billboard's up; local +Y points away from the camera
    const ce = Math.cos(DISC_TILT), se = Math.sin(DISC_TILT);
    _N.copy(_U).multiplyScalar(ce).addScaledVector(_T, se);
    _Y.copy(_U).multiplyScalar(se).addScaledVector(_T, -ce);
    _m.makeBasis(_R, _Y, _N);
    this.disc.quaternion.setFromRotationMatrix(_m);
    this.motes.quaternion.copy(this.disc.quaternion);
    this.flatRing.quaternion.copy(this.disc.quaternion);

    const rc0 = this.rc;
    const t = this.t;
    // opening: grow from a point with an elastic overshoot + wobble
    const g = t < OPEN_TIME * 2.4 ? Math.max(0, 1 - Math.exp(-7 * t) * Math.cos(11 * t)) : 1;
    let shrink = 1;
    let dark = 0;
    if (this.state === 'collapse') {
      const k = Math.min(1, this.ct / SHRINK_TIME);
      shrink = Math.max(0, 1 - k * k * (3 - 2 * k)) * (1 - k * 0.15);
      dark = smooth(0, SHRINK_TIME * 0.7, this.ct) * (this.reduceFlash ? 0.5 : 0.8);
    }
    const pulse = 1 + 0.03 * Math.sin(t * 5);
    const rc = Math.max(rc0 * g * pulse * shrink, 1e-3);
    const RL = rc0 * 4.2 * Math.max(g, 0.05) * (0.55 + 0.45 * shrink);

    const lu = this.lensMat.uniforms;
    lu.uRL.value = RL;
    lu.uRc.value = rc;
    lu.uRe.value = rc * 1.32;
    lu.uStrength.value = Math.min(1, t * 3) * (0.4 + 0.6 * shrink);
    lu.uDark.value = dark;
    lu.uFade.value = smooth(0, 0.12, t);
    lu.uTime.value = t;
    lu.uWob.value = 0.1 * Math.exp(-3.5 * t) + 0.012 + (this.state === 'collapse' ? 0.08 * (1 - shrink) : 0);
    lu.uRing.value = smooth(0.05, 0.35, t) * (this.state === 'collapse' ? 1 + 1.5 * (1 - shrink) : 1);
    lu.uArc.value = smooth(0.1, 0.6, t) * shrink;
    lu.uSpin.value = 1 + (this.state === 'collapse' ? 4 * (1 - shrink) : 0);
    this.lens.scale.setScalar(RL);
    this.coreDepth.scale.setScalar(rc * 0.98);

    const du = this.discMat.uniforms;
    du.uTime.value = t;
    du.uSpin.value = 7 * (1 + (this.state === 'collapse' ? 3 * (1 - shrink) : 0));
    du.uAlpha.value = smooth(0.08, 0.55, t) * shrink;
    // disc grows a little behind the core, swirls in on collapse
    const discScale = rc0 * Math.max(0.001, smooth(0, 0.7, t) * 0.85 + 0.15) * pulse * (0.3 + 0.7 * shrink);
    this.disc.scale.setScalar(discScale);

    const inCollapseShrink = this.state === 'collapse' && this.ct < SHRINK_TIME;
    const showHole = this.state === 'open' || inCollapseShrink;
    this.lens.visible = showHole;
    this.coreDepth.visible = showHole;
    this.disc.visible = showHole;

    if (this.state === 'collapse' && this.ct >= SHRINK_TIME) {
      if (!this.boomed) this.boom();
      this.updateBoom(this.ct - SHRINK_TIME);
      if (this.ct - SHRINK_TIME > BOOM_TIME) {
        this.state = 'idle';
        this.group.visible = false;
        return;
      }
    }

    this.updateMotes(dt, rc);
  }

  // ------------------------------------------------------------------ motes

  private spawnMote(i: number, initial: boolean): void {
    const S = this.rc / 3;
    const rMin = this.rc * 2.6;
    const rMax = Math.max(rMin + 2, Math.min(this.R * 0.45, 22));
    const u = Math.random();
    const r0 = initial ? rMin + (rMax - rMin) * Math.sqrt(u) : rMax * (0.75 + 0.25 * u);
    const kindRoll = Math.random();
    const kind: MoteKind = kindRoll < 0.45 ? 0 : kindRoll < 0.72 ? 1 : 2;
    this.mKind[i] = kind;
    this.mR[i] = this.mR0[i] = r0;
    this.mPhi[i] = Math.random() * Math.PI * 2;
    this.mH0[i] = (Math.random() * 2 - 1) * r0 * (kind === 2 ? 0.25 : 0.55);
    this.mAge[i] = initial ? -Math.random() * 0.6 : 0;
    this.mSpd[i] = 0.75 + Math.random() * 0.5;
    this.mSeed[i] = Math.random();
    const s2 = i * 2;
    this.mSize[s2] = (kind === 0 ? 0.08 : kind === 1 ? 0.03 : 0.17) * S * (0.7 + 0.6 * Math.random());
    this.mSize[s2 + 1] = kind === 1 ? 0.05 : kind === 0 ? 0.035 : 0.025;
    this.placeMote(i);
    this.mVel[i * 3] = this.mVel[i * 3 + 1] = this.mVel[i * 3 + 2] = 0;
  }

  private placeMote(i: number): void {
    const r = this.mR[i];
    const h = this.mH0[i] * Math.pow(Math.max(r / this.mR0[i], 0), 1.6);
    const p = i * 3;
    this.mPos[p] = r * Math.cos(this.mPhi[i]);
    this.mPos[p + 1] = r * Math.sin(this.mPhi[i]);
    this.mPos[p + 2] = h;
  }

  private updateMotes(dt: number, rc: number): void {
    const boom = this.boomed;
    const S = this.rc / 3;
    const collapsing = this.state === 'collapse';
    const fadeIn = smooth(0, 0.25, this.t);
    for (let i = 0; i < MOTES; i++) {
      const p = i * 3;
      const c = i * 4;
      const kind = this.mKind[i];
      if (boom) {
        // outward debris: integrate the stored velocity with drag
        const e = this.ct - SHRINK_TIME;
        const drag = Math.exp(-2.4 * dt);
        this.mVel[p] *= drag;
        this.mVel[p + 1] *= drag;
        this.mVel[p + 2] *= drag;
        this.mVel[p + 2] -= 3 * dt * (kind === 2 ? 2 : 0.3);
        this.mPos[p] += this.mVel[p] * dt;
        this.mPos[p + 1] += this.mVel[p + 1] * dt;
        this.mPos[p + 2] += this.mVel[p + 2] * dt;
        const life = Math.max(0, 1 - e / (BOOM_TIME * (0.6 + 0.4 * this.mSeed[i])));
        this.setMoteColor(c, kind, life, life);
        continue;
      }
      this.mAge[i] += dt;
      if (this.mAge[i] < 0) {
        this.mCol[c + 3] = this.mCol[c] = this.mCol[c + 1] = this.mCol[c + 2] = 0;
        continue;
      }
      const r = this.mR[i];
      const px = this.mPos[p], py = this.mPos[p + 1], pz = this.mPos[p + 2];
      const pull = (collapsing ? 5 : 1) * this.mSpd[i];
      const dr = (1.2 + (55 * S * S) / (r + 0.5)) * pull * S;
      const nr = r - dr * dt;
      const omega = (1.4 + 30 * Math.pow(this.rc / Math.max(r, 0.3), 1.5) / 3) * this.mSpd[i] * (collapsing ? 2 : 1);
      this.mPhi[i] += omega * dt;
      if (nr < rc * 0.92) {
        if (collapsing) {
          this.mR[i] = 0;
          this.mCol[c + 3] = this.mCol[c] = this.mCol[c + 1] = this.mCol[c + 2] = 0;
          continue;
        }
        this.spawnMote(i, false);
        this.mCol[c + 3] = this.mCol[c] = this.mCol[c + 1] = this.mCol[c + 2] = 0;
        continue;
      }
      this.mR[i] = nr;
      this.placeMote(i);
      const idt = 1 / Math.max(dt, 1e-4);
      this.mVel[p] = (this.mPos[p] - px) * idt;
      this.mVel[p + 1] = (this.mPos[p + 1] - py) * idt;
      this.mVel[p + 2] = (this.mPos[p + 2] - pz) * idt;
      const a = Math.min(1, this.mAge[i] / 0.3) * fadeIn * smooth(rc * 0.92, rc * 1.5, nr);
      const heat = 1 - smooth(rc * 1.2, rc * 4.5, nr); // glow hotter as they near the hole
      this.setMoteColor(c, kind, a, heat);
    }
    this.aPos.needsUpdate = this.aVel.needsUpdate = this.aCol.needsUpdate = this.aSize.needsUpdate = true;
  }

  /** rgb = emission (premultiplied), a = occlusion. */
  private setMoteColor(c: number, kind: number, a: number, heat: number): void {
    const col = this.mCol;
    if (kind === 0) {
      // snow: white, gets a cyan rim glow near the hole
      const e = 0.8 + 0.4 * heat;
      col[c] = (0.9 - 0.4 * heat) * e * a;
      col[c + 1] = (0.95) * e * a;
      col[c + 2] = 1.0 * e * a;
      col[c + 3] = 0.55 * a;
    } else if (kind === 1) {
      const e = (0.7 + 0.7 * heat) * a;
      col[c] = (0.22 + 0.5 * heat) * e;
      col[c + 1] = 0.91 * e;
      col[c + 2] = 1.0 * e;
      col[c + 3] = 0.35 * a;
    } else {
      // dark scrap: occludes, faint cyan sheen when hot
      col[c] = 0.02 * heat * a;
      col[c + 1] = 0.25 * heat * a;
      col[c + 2] = 0.3 * heat * a;
      col[c + 3] = 0.9 * a;
    }
  }

  // ------------------------------------------------------------------ explosion

  private boom(): void {
    this.boomed = true;
    this.flash.visible = true;
    this.ring.visible = true;
    this.flatRing.visible = true;
    this.ripple.visible = true;
    this.motes.visible = true;
    const S = this.rc / 3;
    for (let i = 0; i < MOTES; i++) {
      const p = i * 3;
      // random direction, biased toward the disc plane (local z small)
      const phi = Math.random() * Math.PI * 2;
      const z = (Math.random() * 2 - 1) * (Math.random() < 0.7 ? 0.35 : 1);
      const s = Math.sqrt(Math.max(0, 1 - z * z));
      const dx = s * Math.cos(phi), dy = s * Math.sin(phi);
      const r0 = Math.random() * this.rc * 0.5;
      this.mPos[p] = dx * r0;
      this.mPos[p + 1] = dy * r0;
      this.mPos[p + 2] = z * r0;
      const kindRoll = Math.random();
      const kind: MoteKind = kindRoll < 0.45 ? 1 : kindRoll < 0.7 ? 0 : 2;
      this.mKind[i] = kind;
      const spd = (kind === 1 ? 45 : kind === 0 ? 30 : 22) * S * (0.5 + Math.random());
      this.mVel[p] = dx * spd;
      this.mVel[p + 1] = dy * spd;
      this.mVel[p + 2] = z * spd;
      this.mSize[i * 2] = (kind === 1 ? 0.045 : kind === 0 ? 0.09 : 0.2) * S * (0.7 + 0.6 * Math.random());
      this.mSize[i * 2 + 1] = kind === 1 ? 0.045 : 0.03;
      this.mSeed[i] = Math.random();
    }
  }

  private updateBoom(e: number): void {
    const rf = this.reduceFlash;
    // flash: instant peak, fast decay
    // flash: ~0.1 s peak, gone by ~0.3 s, and only a few core radii wide (big != white)
    const fi = (rf ? 0.3 : 1) * (e < 0.025 ? e / 0.025 : Math.exp(-(e - 0.025) * 16));
    this.flashMat.uniforms.uI.value = fi;
    this.flash.scale.setScalar(this.rc * ((rf ? 2 : 2.5) + (rf ? 3 : 6) * (1 - Math.exp(-e * 14))));
    this.flash.visible = fi > 0.002;

    const Rmax = this.R * 0.5;
    const k = Math.min(1, e / 0.85);
    const ease = 1 - Math.pow(1 - k, 3);
    const rad = this.rc * 0.5 + (Rmax - this.rc * 0.5) * ease;
    const life = Math.pow(Math.max(0, 1 - e / BOOM_TIME), 1.5);
    const ru = this.ringMat.uniforms;
    ru.uScale.value = Rmax * 1.1;
    ru.uRadius.value = rad;
    ru.uWidth.value = 0.5 + 2.2 * ease;
    ru.uI.value = life;
    this.ring.scale.setScalar(Rmax * 1.1);
    const fu = this.flatRingMat.uniforms;
    const rad2 = this.rc * 0.5 + (Rmax * 1.15 - this.rc * 0.5) * (1 - Math.pow(1 - Math.min(1, e / 0.95), 3));
    fu.uScale.value = Rmax * 1.25;
    fu.uRadius.value = rad2;
    fu.uWidth.value = 0.6 + 2.5 * ease;
    fu.uI.value = life * 0.5;
    this.flatRing.scale.setScalar(Rmax * 1.25);

    const pu = this.rippleMat.uniforms;
    pu.uScale.value = Rmax * 1.15;
    pu.uRadius.value = Math.max(0, rad - 1.2);
    pu.uWidth.value = 1.2 + 1.5 * ease;
    pu.uAmp.value = 3.0 * life * (rf ? 0.6 : 1);
    this.ripple.scale.setScalar(Rmax * 1.15);
    this.ripple.visible = life > 0.01;
  }

  // ------------------------------------------------------------------ screen grab

  /** onBeforeRender of the lens / ripple: re-render the scene behind `mesh` into the grab target. */
  private grab(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, mesh: THREE.Mesh, mat: THREE.ShaderMaterial): void {
    const u = mat.uniforms;
    u.uGrab.value = 0;
    // LOW quality skips the second scene render: the lens keeps its undistorted fallback (darkening ring + rings).
    if (this.grabbing || !this.lensingOn || !currentPreset().lensGrab) return;
    if (this.grabOk === null) this.grabOk = renderer.extensions.has('EXT_color_buffer_float');
    if (!this.grabOk) return;
    const cam = camera as THREE.PerspectiveCamera;
    if (!cam.isPerspectiveCamera) return;
    mesh.getWorldPosition(_v).applyMatrix4(cam.matrixWorldInverse);
    const d = -_v.z;
    if (!(d > cam.near * 1.5)) return;
    const tanH = Math.tan(THREE.MathUtils.DEG2RAD * cam.fov * 0.5) / Math.max(cam.zoom, 1e-3);
    const aspect = Math.max(cam.aspect, 1e-3);
    const cy = _v.y / (d * tanH);
    const cx = _v.x / (d * tanH * aspect);
    const ry = (mesh.scale.x * 1.12) / (d * tanH);
    const rx = ry / aspect;
    const x0 = Math.max(cx - rx, -1.08), x1 = Math.min(cx + rx, 1.08);
    const y0 = Math.max(cy - ry, -1.08), y1 = Math.min(cy + ry, 1.08);
    if (!(x1 - x0 > 0.004 && y1 - y0 > 0.004)) return;

    const cc = this.capCam;
    cc.fov = cam.fov;
    cc.aspect = cam.aspect;
    cc.near = cam.near;
    cc.far = cam.far;
    cc.zoom = cam.zoom;
    cc.filmGauge = cam.filmGauge;
    cc.filmOffset = cam.filmOffset;
    cc.layers.mask = cam.layers.mask;
    cam.matrixWorld.decompose(cc.position, cc.quaternion, cc.scale);
    const W = 1000;
    cc.setViewOffset(W, W, ((x0 + 1) / 2) * W, ((1 - y1) / 2) * W, ((x1 - x0) / 2) * W, ((y1 - y0) / 2) * W);
    cc.updateMatrixWorld();

    const prevTarget = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace();
    const mip = renderer.getActiveMipmapLevel();
    const prevAuto = renderer.shadowMap.autoUpdate;
    const prevClear = renderer.autoClear;
    const prevXr = renderer.xr.enabled;
    this.grabbing = true;
    this.group.visible = false;
    try {
      renderer.shadowMap.autoUpdate = false;
      renderer.autoClear = true;
      renderer.xr.enabled = false;
      renderer.setRenderTarget(this.rt);
      renderer.render(scene, cc);
    } finally {
      this.group.visible = true;
      this.grabbing = false;
      renderer.shadowMap.autoUpdate = prevAuto;
      renderer.autoClear = prevClear;
      renderer.xr.enabled = prevXr;
      renderer.setRenderTarget(prevTarget, face, mip);
    }
    (u.uCapProj.value as THREE.Matrix4).copy(cc.projectionMatrix);
    u.uCapNear.value = cc.near;
    u.uCapFar.value = cc.far;
    u.uGrab.value = 1;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const m of [this.lensMat, this.discMat, this.moteMat, this.flashMat, this.ringMat, this.flatRingMat, this.rippleMat]) m.dispose();
    (this.coreDepth.material as THREE.Material).dispose();
    this.rt.depthTexture?.dispose();
    this.rt.dispose();
    this.state = 'idle';
  }
}
