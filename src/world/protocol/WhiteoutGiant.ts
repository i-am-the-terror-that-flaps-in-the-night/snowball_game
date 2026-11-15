import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { currentPreset, scaleCount, settings } from '../../core/settings';
import { densePuffTexture, softPuffTexture } from '../../fx/particles';
import { standIns } from '../../render/standIns';

/**
 * THE WHITEOUT (PROTOCOL C finale): the storm giant outside the north stand. A visual only (its EYE is a bot the
 * director moves: core/whiteoutDirector.ts); this draws:
 *  - the BODY: a hunched mass of churning snow cloud: hundreds of big soft billows (one Points draw, animated in the
 *    vertex shader: each orbits its part and boils) over two noise-displaced translucent core shells, rising from a
 *    vortex skirt behind the stand; storm-lit pale grey-blue against the black sky, with lightning flickering inside;
 *  - swirling FLAKES round it (one additive Points draw, all in the shader) and orbiting jagged ICE PLATES (16
 *    instances);
 *  - ONE huge cold ice-blue EYE (a glowing iris with a slit pupil, HDR so it blooms) under two cloud lids, a halo;
 *  - two VORTEX ARMS (swirling tubes: shoulder -> elbow -> a funnel to the ground; the director plants a hand on a sweep
 *    lane);
 *  - the STORM HEART beams (up to five, from each Heart's tip to its chest).
 * Poses (set by the director every frame): rise 0..1 (from below the stand), lean 0..1 (0 = hunched over the stand,
 * peering in; 1 = STAGGER: the eye down on the stand front at arena level), anger 0..1, eye open / glare / pupil.
 * Built once per scene (prewarm, hidden: the warm-up compiles every program), drawn without fog (the storm fog would
 * swallow it), no per-frame allocation (scratch vectors; matrices written in place). LOW: half the billows, flakes.
 */

/** Where it stands (its pivot: the bottom of the skirt) and how far below it starts its rise (m). */
export const GIANT_BASE = new THREE.Vector3(0, -8, -66);
const SINK = 52;
/** The eye: radius (m), high pose (peering over the north stand) and the STAGGER pose (on the stand front). */
export const EYE_R = 3.8;
export const EYE_HIGH_POS = new THREE.Vector3(0, 12.5, -46);
export const EYE_DOWN_POS = new THREE.Vector3(0, 3.4, -29.8);
/** The swoop between them (a quadratic curve through this control point). */
const EYE_CTRL = new THREE.Vector3(0, 15, -38);
/** Torso tilt (rad, toward the arena): hunched idle .. STAGGER. */
const TILT_IDLE = 0.42;
const TILT_DOWN = 0.8;
/** Billows (HIGH; LOW halves), flakes, plates. */
const BILLOWS = 1000;
const FLAKES = 2600;
const PLATES = 16;
const BEAMS = 5;
/** Colours: the cloud's shadowed core and storm-lit tops, lightning, the eye. */
const CLOUD_DARK = new THREE.Color(0x161d2e);
const CLOUD_LIT = new THREE.Color(0xa6bad6);
const FLASH_COL = new THREE.Color(0x9fd2ff);

/* ------------------------------------------------------------------ shaders */

const NOISE = /* glsl */ `
  float hash3(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }`;

/** Billows: soft puffs orbiting their part centre (aCenter), boiling; shaded by height in the part and facing the arena. */
const BILLOW_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  uniform float uChurn;
  attribute vec3 aCenter;
  attribute vec4 aData;
  varying float vShade;
  varying float vSeed;
  varying float vFade;
  void main() {
    vec3 rel = position - aCenter;
    float a = uTime * aData.z * uChurn;
    float c = cos(a), s = sin(a);
    rel.xz = mat2(c, -s, s, c) * rel.xz;
    float boil = sin(uTime * (0.6 + aData.y * 0.7) * uChurn + aData.y * 40.0);
    rel *= 1.0 + 0.06 * boil;
    rel.y += 0.5 * sin(uTime * 0.5 + aData.y * 23.0);
    vec3 p = aCenter + rel;
    vec3 n = normalize(rel + vec3(0.0, 0.001, 0.0));
    // storm-lit from above and from the arena's floods, rim-lit at the silhouette, a dark core: it reads as a mass
    vec3 vn = normalize(normalMatrix * n);
    float rim = 1.0 - abs(vn.z);
    vShade = clamp(0.22 + n.y * 0.34 + max(n.z, 0.0) * 0.18 + rim * rim * 0.5 + aData.w, 0.0, 1.0);
    vSeed = aData.y;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float d = -mv.z;
    vFade = smoothstep(3.0, 11.0, d);
    gl_PointSize = clamp(aData.x * (1.0 + 0.12 * boil) * uScale / max(d, 0.5), 1.0, 1400.0);
    gl_Position = projectionMatrix * mv;
  }`;
const BILLOW_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uDark;
  uniform vec3 uLit;
  uniform vec3 uFlashCol;
  uniform float uAlpha;
  uniform float uFlash;
  uniform float uAnger;
  varying float vShade;
  varying float vSeed;
  varying float vFade;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = vSeed * 6.2831;
    c = mat2(cos(r), -sin(r), sin(r), cos(r)) * c;
    float m = texture2D(uMap, c + 0.5).g;
    float a = m * uAlpha * vFade;
    if (a < 0.008) discard;
    vec3 col = mix(uDark, uLit, vShade);
    col = mix(col, col * vec3(0.86, 0.94, 1.12), uAnger * 0.6);
    col += uFlashCol * uFlash * (0.35 + 0.9 * vShade) * (0.6 + 0.4 * fract(vSeed * 13.7));
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** Flakes: each spirals round the giant (radius / height / speed in aData) and drifts toward the arena. */
const FLAKE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  uniform float uChurn;
  uniform float uRise;
  attribute vec4 aData;
  varying float vA;
  void main() {
    float ang = position.x + uTime * aData.z * uChurn;
    float r = aData.x * (1.0 + 0.08 * sin(uTime * 0.9 + position.x * 5.0));
    float h = mod(position.y + uTime * aData.w * uChurn, 46.0);
    vec3 p = vec3(sin(ang) * r, h - 6.0 - (1.0 - uRise) * 52.0, cos(ang) * r * 0.8 + 8.0 + position.z);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float d = -mv.z;
    vA = smoothstep(2.0, 8.0, d) * smoothstep(0.0, 4.0, h) * (1.0 - smoothstep(40.0, 46.0, h));
    gl_PointSize = clamp(aData.y * uScale / max(d, 0.5), 1.2, 24.0);
    gl_Position = projectionMatrix * mv;
  }`;
const FLAKE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uAlpha;
  varying float vA;
  void main() {
    float m = texture2D(uMap, gl_PointCoord).g;
    float a = m * vA * uAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vec3(0.82, 0.92, 1.0) * 1.35, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** Core shells: noise-displaced, translucent with soft (fresnel-faded) edges. */
const SHELL_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;
  uniform float uFreq;
  uniform float uChurn;
  varying vec3 vN;
  varying vec3 vV;
  varying float vNoise;
  ${NOISE}
  void main() {
    float t = uTime * uChurn;
    vec3 q = position * uFreq;
    float n = vnoise(q + vec3(0.0, t * 0.35, t * 0.2));
    float n2 = vnoise(q * 2.3 - vec3(t * 0.4));
    float d = (n * 0.7 + n2 * 0.3 - 0.5) * uAmp;
    vec3 p = position + normal * d;
    vNoise = n * 0.7 + n2 * 0.3;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vV = -mv.xyz;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }`;
const SHELL_FRAG = /* glsl */ `
  uniform vec3 uDark;
  uniform vec3 uLit;
  uniform vec3 uFlashCol;
  uniform float uAlpha;
  uniform float uFlash;
  varying vec3 vN;
  varying vec3 vV;
  varying float vNoise;
  void main() {
    vec3 n = normalize(vN);
    vec3 v = normalize(vV);
    float facing = abs(dot(n, v));
    float shade = clamp(0.25 + n.y * 0.35 + (vNoise - 0.5) * 0.9, 0.0, 1.0);
    vec3 col = mix(uDark, uLit, shade);
    col += uFlashCol * uFlash * (0.3 + shade);
    float a = uAlpha * smoothstep(0.08, 0.55, facing);
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** Vortex tubes (arms, neck): swirling bands, brighter at the edges, scrolling up the tube. */
const VORTEX_VERT = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vUv = uv;
    vec3 p = position;
    float w = 1.0 + 0.12 * sin(uv.y * 18.0 - uTime * 6.0 + uv.x * 6.2831);
    p.xz *= w;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vV = -mv.xyz;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mv;
  }`;
const VORTEX_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uAlpha;
  uniform float uSpin;
  uniform float uFlash;
  uniform vec3 uDark;
  uniform vec3 uLit;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  float streak(float x, float w) {
    float f = fract(x);
    return smoothstep(0.0, w * 0.3, f) * (1.0 - smoothstep(w * 0.3, w, f));
  }
  void main() {
    float fres = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    // fade out round the camera (a funnel sweeping past the lens never fills the screen)
    float near = smoothstep(4.0, 13.0, length(vV));
    // thin bright snow streaks spiralling up the tube over a faint body, denser at the rim
    float s1 = streak(vUv.x * 4.0 + vUv.y * 6.0 - uTime * uSpin, 0.32);
    float s2 = streak(vUv.x * 7.0 + vUv.y * 11.0 - uTime * uSpin * 1.6 + 0.37, 0.2);
    float body = 0.16 + fres * 0.55;
    vec3 col = mix(uDark, uLit, clamp(0.3 + fres * 0.5, 0.0, 1.0)) + vec3(0.75, 0.88, 1.0) * (s1 * 0.85 + s2 * 0.5) + vec3(0.5, 0.75, 1.0) * uFlash;
    float ends = smoothstep(0.0, 0.06, vUv.y) * (1.0 - smoothstep(0.94, 1.0, vUv.y));
    float a = uAlpha * near * clamp(body + s1 * 0.55 + s2 * 0.35, 0.0, 1.0) * ends;
    gl_FragColor = vec4(col, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** The eye: dark socket, a glowing fibrous ice-blue iris (HDR: it blooms), a slit pupil that widens in a glare. */
const EYE_VERT = /* glsl */ `
  varying vec3 vP;
  void main() {
    vP = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const EYE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uGlare;
  uniform float uPupil;
  uniform float uFlash;
  uniform float uAnger;
  uniform float uCrack;
  varying vec3 vP;
  vec2 hash2(vec2 q) {
    q = vec2(dot(q, vec2(127.1, 311.7)), dot(q, vec2(269.5, 183.3)));
    return fract(sin(q) * 43758.5453);
  }
  // cell edges (F2 - F1): the cracks across the eye
  float cracks(vec2 x) {
    vec2 n = floor(x);
    vec2 f = fract(x);
    float f1 = 8.0;
    float f2 = 8.0;
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 o = hash2(n + g);
        vec2 r = g + o - f;
        float d = dot(r, r);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
      }
    }
    return sqrt(f2) - sqrt(f1);
  }
  void main() {
    vec3 p = normalize(vP);
    float d = acos(clamp(p.z, -1.0, 1.0));
    float ang = atan(p.y, p.x);
    float iris = 1.0 - smoothstep(0.86, 0.98, d);
    float fib = 0.5 + 0.5 * sin(ang * 41.0 + sin(ang * 7.0 + uTime * 0.7) * 2.4 + d * 12.0);
    float ring = smoothstep(0.62, 0.7, d) * (1.0 - smoothstep(0.78, 0.9, d));
    vec3 deep = vec3(0.02, 0.16, 0.62);
    vec3 mid = vec3(0.1, 0.55, 1.0);
    vec3 pale = vec3(0.75, 0.95, 1.0);
    vec3 irisCol = mix(deep, mid, 1.0 - smoothstep(0.45, 0.86, d));
    irisCol = mix(irisCol, pale, 1.0 - smoothstep(0.04, 0.28, d));
    irisCol *= 0.75 + fib * 0.65 + uAnger * 0.35;
    irisCol += vec3(0.35, 0.8, 1.0) * ring * 1.1;
    vec3 col = mix(vec3(0.03, 0.06, 0.12), irisCol, iris);
    float slit = mix(0.07, 0.24, uPupil) * sqrt(max(0.0, 1.0 - (p.y / 0.62) * (p.y / 0.62)));
    float pupil = (1.0 - smoothstep(slit * 0.7, slit, abs(p.x))) * step(0.0, p.z) * step(abs(p.y), 0.62);
    col = mix(col, vec3(0.0, 0.01, 0.04), pupil * (1.0 - uGlare * 0.85));
    col += vec3(0.75, 0.92, 1.0) * uGlare * 3.0 * iris;
    col += vec3(uFlash);
    if (uCrack > 0.0) {
      // THE IMPLOSION: cracks spread out from the pupil, white-hot light pouring through them
      vec2 q = p.xy / max(0.2, p.z + 1.2);
      float e = cracks(q * 3.2 + vec2(1.7, 3.1));
      float e2 = cracks(q * 7.0 - vec2(4.2, 0.6));
      float reach = smoothstep(uCrack * 1.25 + 0.05, uCrack * 1.25 - 0.15, d);
      float line = (1.0 - smoothstep(0.03, 0.1 + uCrack * 0.06, e)) + 0.7 * (1.0 - smoothstep(0.02, 0.06, e2)) * smoothstep(0.35, 0.6, uCrack);
      col = mix(col, col * (1.0 - 0.6 * uCrack), reach);
      col += vec3(0.75, 0.93, 1.0) * line * reach * (1.6 + uCrack * 2.6);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/* ------------------------------------------------------------------ helpers */

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

interface BillowPart {
  c: readonly [number, number, number];
  r: readonly [number, number, number];
  n: number;
  size: readonly [number, number];
  speed: number;
  shade: number;
}

function billowGeometry(parts: readonly BillowPart[], total: number, seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  let sum = 0;
  for (const p of parts) sum += p.n;
  const pos: number[] = [];
  const cen: number[] = [];
  const dat: number[] = [];
  // interleave parts so LOW's half draw range keeps every part
  const lists: number[][] = parts.map(() => []);
  parts.forEach((p, k) => {
    const n = Math.round((p.n / sum) * total);
    for (let i = 0; i < n; i++) {
      // a point in the shell between 55% and 100% of the ellipsoid, biased outward
      let x = 0, y = 0, z = 0, l = 2;
      while (l > 1 || l < 1e-4) {
        x = r() * 2 - 1;
        y = r() * 2 - 1;
        z = r() * 2 - 1;
        l = x * x + y * y + z * z;
      }
      const k2 = (0.55 + 0.45 * Math.sqrt(r())) / Math.sqrt(l);
      lists[k].push(
        p.c[0] + x * k2 * p.r[0], p.c[1] + y * k2 * p.r[1], p.c[2] + z * k2 * p.r[2],
        p.c[0], p.c[1], p.c[2],
        p.size[0] + r() * (p.size[1] - p.size[0]), r(), p.speed * (0.6 + r() * 0.8) * (r() < 0.5 ? -1 : 1), p.shade + (r() - 0.5) * 0.12,
      );
    }
  });
  let more = true;
  for (let i = 0; more; i++) {
    more = false;
    for (const l of lists) {
      if (i * 10 >= l.length) continue;
      more = true;
      const o = i * 10;
      pos.push(l[o], l[o + 1], l[o + 2]);
      cen.push(l[o + 3], l[o + 4], l[o + 5]);
      dat.push(l[o + 6], l[o + 7], l[o + 8], l[o + 9]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aCenter', new THREE.Float32BufferAttribute(cen, 3));
  g.setAttribute('aData', new THREE.Float32BufferAttribute(dat, 4));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 80);
  return g;
}

function billowMaterial(map: THREE.Texture, alpha: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'whiteoutBillow',
    uniforms: {
      uTime: { value: 0 }, uScale: { value: 900 }, uChurn: { value: 1 }, uMap: { value: map },
      uDark: { value: CLOUD_DARK.clone() }, uLit: { value: CLOUD_LIT.clone() }, uFlashCol: { value: FLASH_COL.clone() },
      uAlpha: { value: alpha }, uFlash: { value: 0 }, uAnger: { value: 0 },
    },
    vertexShader: BILLOW_VERT,
    fragmentShader: BILLOW_FRAG,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
}

function shellMaterial(alpha: number, amp: number, freq: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'whiteoutShell',
    uniforms: {
      uTime: { value: 0 }, uAmp: { value: amp }, uFreq: { value: freq }, uChurn: { value: 1 },
      uDark: { value: CLOUD_DARK.clone().multiplyScalar(0.8) }, uLit: { value: CLOUD_LIT.clone().multiplyScalar(0.85) }, uFlashCol: { value: FLASH_COL.clone() },
      uAlpha: { value: alpha }, uFlash: { value: 0 },
    },
    vertexShader: SHELL_VERT,
    fragmentShader: SHELL_FRAG,
    transparent: true,
    depthWrite: false,
    fog: false,
  });
}

/** A jagged ice plate: a flattened irregular crystal with a couple of spikes. */
function plateGeometry(): THREE.BufferGeometry {
  const r = rng(77);
  const parts: THREE.BufferGeometry[] = [];
  const main = new THREE.OctahedronGeometry(1, 0);
  const p = main.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (1.6 + r() * 0.5), p.getY(i) * (2.2 + r() * 0.6), p.getZ(i) * 0.35);
  parts.push(main);
  for (let k = 0; k < 3; k++) {
    const s = new THREE.OctahedronGeometry(1, 0);
    s.scale(0.35, 1.2 + r(), 0.2);
    s.rotateZ((r() - 0.5) * 2.4);
    s.translate((r() - 0.5) * 2, (r() - 0.5) * 2.4, 0);
    parts.push(s);
  }
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  return g;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

/** Torso-local anchors (the torso group's pivot is GIANT_BASE; +y up the body, +z toward the arena). */
const NECK = new THREE.Vector3(0, 36, -1);
const SHOULDER = [new THREE.Vector3(-18, 35, 1), new THREE.Vector3(18, 35, 1)];
const CHEST = new THREE.Vector3(0, 28, 8);
/** Where an idle hand rests (world): beyond the north stand's corners, its funnel drilled into the ground. */
const HAND_REST = [new THREE.Vector3(-29, -1, -40), new THREE.Vector3(29, -1, -40)];

interface Tube {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  /** A funnel: FUNNEL_FOOT x its radius at the start (the ground), full at the end. */
  funnel: boolean;
}

/** A funnel's foot radius share: x the top radius (FUNNEL_TOP m: its foot ~ the sweep's hit width). */
const FUNNEL_FOOT = 0.52;
const FUNNEL_TOP = 4.8;

class WhiteoutGiant {
  /** Pose (the director sets these every frame). */
  rise = 0;
  lean = 0;
  anger = 0;
  /** Eye lids target 0 (closed) .. 1 (open); glare 0..1 (charging white); pupil 0 (slit) .. 1 (wide). */
  open = 0;
  glare = 0;
  pupil = 0;
  /** THE IMPLOSION (the ending): crack 0..1 = cracks spreading over the eye; collapse 0..1 = the whole storm sucked into
   *  the eye (everything shrinks and spirals in on it; 1 = a point). */
  crack = 0;
  collapse = 0;
  /** Per arm: reach 0 (resting) .. 1 (the hand planted on `armTarget`). */
  readonly armReach = [0, 0];
  readonly armTarget = [new THREE.Vector3(), new THREE.Vector3()];

  private scene: THREE.Scene | null = null;
  readonly group = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private eyeGroup = new THREE.Group();
  private billows!: THREE.Points;
  private headBillows!: THREE.Points;
  private socketGeo!: THREE.BufferGeometry;
  private billowMat!: THREE.ShaderMaterial;
  private headMat!: THREE.ShaderMaterial;
  private flakes!: THREE.Points;
  private flakeMat!: THREE.ShaderMaterial;
  private shells: THREE.Mesh[] = [];
  private shellMats: THREE.ShaderMaterial[] = [];
  private plates!: THREE.InstancedMesh;
  private plateMat!: THREE.MeshStandardMaterial;
  private plateData = new Float32Array(PLATES * 6);
  private eyeMat!: THREE.ShaderMaterial;
  private lids: THREE.Mesh[] = [];
  private halo!: THREE.Sprite;
  private seam!: THREE.Mesh;
  private seamMat!: THREE.MeshBasicMaterial;
  private haloMat!: THREE.SpriteMaterial;
  private tubes: Tube[] = [];
  private beams: { core: THREE.Mesh; glow: THREE.Mesh; on: number; x: number; y: number; z: number }[] = [];
  private beamCoreMat!: THREE.MeshBasicMaterial;
  private beamGlowMat!: THREE.MeshBasicMaterial;
  private lid = 0;
  private flashK = 0;
  private bolt = 0;
  private boltT = 0;
  private time = 0;

  /** Build (hidden) into `scene` once, so every warm-up compiles its programs (Game: chairmanProps.prewarm precedent). */
  prewarm(scene: THREE.Scene): void {
    if (this.scene === scene) return;
    if (!this.scene) this.build();
    this.scene = scene;
    scene.add(this.group);
    this.group.visible = false;
  }

  get shown(): boolean {
    return this.group.visible;
  }

  /** Bring it on (hidden below the stand: rise from 0) or take it away. */
  show(on: boolean): void {
    this.group.visible = on;
    if (!on) {
      this.rise = this.lean = this.anger = this.open = this.glare = this.pupil = this.crack = this.collapse = 0;
      this.armReach[0] = this.armReach[1] = 0;
      this.lid = 0;
      for (const b of this.beams) b.on = 0;
      return;
    }
    // LOW: half the billows and flakes (read when it appears)
    const k = currentPreset().fxScale;
    this.billows.geometry.setDrawRange(0, Math.round(this.billows.geometry.getAttribute('position').count * (k < 1 ? 0.5 : 1)));
    this.headBillows.geometry.setDrawRange(0, Math.round(this.headBillows.geometry.getAttribute('position').count * (k < 1 ? 0.5 : 1)));
    this.socketGeo.setDrawRange(0, Math.round(this.socketGeo.getAttribute('position').count * (k < 1 ? 0.5 : 1)));
    this.flakes.geometry.setDrawRange(0, scaleCount(FLAKES, k));
  }

  /** A hit on the eye (white flash, decays fast). */
  flash(k = 1): void {
    this.flashK = Math.max(this.flashK, k);
  }

  /** Lightning flickers inside the body (k 0..1). */
  lightning(k = 1): void {
    this.bolt = Math.max(this.bolt, k);
  }

  /** Beam `i` from a Storm Heart's tip at (x, y, z) to the chest; k 0 = off, 1 = full (pulses / flickers in update). */
  setBeam(i: number, x: number, y: number, z: number, k: number): void {
    const b = this.beams[i];
    if (!b) return;
    b.x = x;
    b.y = y;
    b.z = z;
    b.on = k;
  }

  clearBeams(): void {
    for (const b of this.beams) b.on = 0;
  }

  /** The eye's centre in the world right now. */
  eyePos(out: THREE.Vector3): THREE.Vector3 {
    return this.eyeAt(this.lean, out).setY(out.y - (1 - this.rise) * SINK);
  }

  /** The eye's centre for a lean (rise 1). */
  eyeAt(lean: number, out: THREE.Vector3): THREE.Vector3 {
    const u = Math.max(0, Math.min(1, lean));
    const k = u * u * (3 - 2 * u);
    // quadratic swoop: forward and down onto the stand front
    const a = (1 - k) * (1 - k);
    const b = 2 * (1 - k) * k;
    const c = k * k;
    return out.set(
      EYE_HIGH_POS.x * a + EYE_CTRL.x * b + EYE_DOWN_POS.x * c,
      EYE_HIGH_POS.y * a + EYE_CTRL.y * b + EYE_DOWN_POS.y * c,
      EYE_HIGH_POS.z * a + EYE_CTRL.z * b + EYE_DOWN_POS.z * c,
    );
  }

  /** The chest (beam target) in the world right now. */
  chestPos(out: THREE.Vector3): THREE.Vector3 {
    this.torso.updateMatrixWorld();
    return out.copy(CHEST).applyMatrix4(this.torso.matrixWorld);
  }

  /* ------------------------------------------------------------------ build */

  private build(): void {
    const map = densePuffTexture();
    const soft = softPuffTexture();
    this.group.name = 'WhiteoutGiant';
    this.group.add(this.torso, this.head);
    this.torso.position.copy(GIANT_BASE);
    // body billows (torso-local)
    const parts: BillowPart[] = [
      { c: [0, 7, 0], r: [10, 10, 8], n: 130, size: [8, 13], speed: 0.22, shade: -0.22 },
      { c: [0, 20, 0], r: [14, 9, 9.5], n: 170, size: [9, 15], speed: 0.12, shade: -0.1 },
      { c: [0, 31, 0], r: [16, 8, 10], n: 190, size: [9, 15], speed: 0.1, shade: 0 },
      { c: [-18, 35, 1], r: [8, 7, 8], n: 100, size: [7, 12], speed: 0.16, shade: 0.06 },
      { c: [18, 35, 1], r: [8, 7, 8], n: 100, size: [7, 12], speed: 0.16, shade: 0.06 },
      { c: [0, 40, -2], r: [10, 6, 7], n: 90, size: [7, 12], speed: 0.14, shade: 0.1 },
    ];
    this.billowMat = billowMaterial(map, 0.62);
    this.billows = new THREE.Points(billowGeometry(parts, BILLOWS, 11), this.billowMat);
    this.billows.frustumCulled = false;
    this.billows.renderOrder = 3;
    this.torso.add(this.billows);
    // core shells: give the body its mass behind the billows
    for (const [cx, cy, cz, rx, ry, rz, a] of [
      [0, 19, 0, 12, 14, 8, 0.55],
      [0, 32, 0.5, 15, 8.5, 8.5, 0.5],
      [0, 6, 0, 9, 9, 7, 0.5],
    ] as const) {
      const m = shellMaterial(a, 2.4, 0.16);
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 4), m);
      s.position.set(cx, cy, cz);
      s.scale.set(rx, ry, rz);
      s.renderOrder = 2;
      s.frustumCulled = false;
      this.torso.add(s);
      this.shells.push(s);
      this.shellMats.push(m);
    }
    // head billows (head-local: the eye sits at the front, (0, 0, 0) is the eye's centre)
    const headParts: BillowPart[] = [
      { c: [0, 3.4, -6], r: [10.5, 7, 7.5], n: 160, size: [6, 11], speed: 0.18, shade: 0.04 },
      { c: [-7.4, 0.4, -3.6], r: [4.8, 4.6, 4.8], n: 45, size: [5, 8], speed: 0.24, shade: -0.04 },
      { c: [7.4, 0.4, -3.6], r: [4.8, 4.6, 4.8], n: 45, size: [5, 8], speed: 0.24, shade: -0.04 },
      { c: [0, -4.0, -4.2], r: [6.5, 3, 5], n: 45, size: [5, 8], speed: 0.2, shade: -0.2 },
    ];
    this.headMat = billowMaterial(map, 0.66);
    this.headBillows = new THREE.Points(billowGeometry(headParts, 260, 23), this.headMat);
    this.headBillows.frustumCulled = false;
    this.headBillows.renderOrder = 3;
    // the socket: a ring of billows round the eye, drawn over it (it sits IN the cloud, not on it)
    const socket = new THREE.Points(billowGeometry([{ c: [0, 0, 1.2], r: [5.6, 5.2, 1.4], n: 64, size: [2.4, 3.8], speed: 0.3, shade: 0.02 }], 64, 31), this.headMat);
    this.socketGeo = socket.geometry;
    for (let i = 0, a = socket.geometry.getAttribute('position'); i < a.count; i++) {
      // push each socket billow out to a ring (r 0.8..1 of the ellipse) so none sits over the iris
      const x = a.getX(i);
      const y = a.getY(i);
      const l = Math.hypot(x / 5.6, y / 5.2) || 1;
      const k = (0.9 + 0.12 * ((i * 0.618) % 1)) / l;
      a.setXY(i, x * k, y * k);
    }
    socket.frustumCulled = false;
    socket.renderOrder = 12;
    this.head.add(this.headBillows, this.eyeGroup, socket);
    const hm = shellMaterial(0.6, 1.6, 0.3);
    const hs = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), hm);
    hs.position.set(0, 2, -6.2);
    hs.scale.set(8.6, 6.5, 6.5);
    hs.renderOrder = 2;
    hs.frustumCulled = false;
    this.head.add(hs);
    this.shells.push(hs);
    this.shellMats.push(hm);
    // the eye: iris sphere, two cloud lids, a halo
    this.eyeMat = new THREE.ShaderMaterial({
      name: 'whiteoutEye',
      uniforms: { uTime: { value: 0 }, uGlare: { value: 0 }, uPupil: { value: 0 }, uFlash: { value: 0 }, uAnger: { value: 0 }, uCrack: { value: 0 } },
      vertexShader: EYE_VERT,
      fragmentShader: EYE_FRAG,
      fog: false,
      transparent: true,
    });
    const eye = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 40, 28), this.eyeMat);
    // drawn after the cloud (the transparent pass, opaque itself): the billows round it never veil it
    eye.renderOrder = 10;
    this.eyeGroup.add(eye);
    const lidMat = new THREE.MeshStandardMaterial({ color: 0x55657e, roughness: 0.95, flatShading: true, emissive: 0x141e30, emissiveIntensity: 1, fog: false, transparent: true });
    for (const sy of [1, -1]) {
      // a half shell over the front, hinged on the eye's horizontal axis: upper (sy 1) / lower (sy -1)
      const g = new THREE.SphereGeometry(EYE_R * 1.07, 28, 12, 0, Math.PI, 0, Math.PI / 2);
      if (sy < 0) g.rotateZ(Math.PI);
      const lid = new THREE.Mesh(g, lidMat);
      lid.renderOrder = 10;
      lid.userData.sy = sy;
      this.eyeGroup.add(lid);
      this.lids.push(lid);
    }
    // a frost brow ring round the socket
    const brow = new THREE.Mesh(new THREE.TorusGeometry(EYE_R * 1.12, 0.35, 6, 24), lidMat);
    brow.position.z = 0.4;
    brow.renderOrder = 10;
    this.eyeGroup.add(brow);
    // the seam between the shut lids: a thin cold glow (the eye is in there, watching)
    this.seamMat = new THREE.MeshBasicMaterial({ color: 0x8fdcff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    this.seam = new THREE.Mesh(new THREE.PlaneGeometry(EYE_R * 1.9, EYE_R * 0.1), this.seamMat);
    this.seam.position.z = EYE_R * 1.1;
    this.seam.renderOrder = 11;
    this.eyeGroup.add(this.seam);
    this.haloMat = new THREE.SpriteMaterial({ map: soft, color: 0x7fd0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.scale.set(EYE_R * 6, EYE_R * 6, 1);
    this.halo.renderOrder = 11;
    this.eyeGroup.add(this.halo);
    // flakes (giant-local, round the base: positions are angle / height phase / z jitter, aData radius / size /
    // angular speed / climb)
    const r = rng(5);
    const fp: number[] = [];
    const fd: number[] = [];
    for (let i = 0; i < FLAKES; i++) {
      fp.push(r() * Math.PI * 2, r() * 46, (r() - 0.5) * 6);
      fd.push(10 + r() * 22, 0.22 + r() * 0.3, (0.18 + r() * 0.35) * (r() < 0.8 ? 1 : -1), 0.6 + r() * 2.2);
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    fg.setAttribute('aData', new THREE.Float32BufferAttribute(fd, 4));
    fg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 80);
    this.flakeMat = new THREE.ShaderMaterial({
      name: 'whiteoutFlakes',
      uniforms: { uTime: { value: 0 }, uScale: { value: 900 }, uChurn: { value: 1 }, uRise: { value: 0 }, uMap: { value: soft }, uAlpha: { value: 0.9 } },
      vertexShader: FLAKE_VERT,
      fragmentShader: FLAKE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.flakes = new THREE.Points(fg, this.flakeMat);
    this.flakes.position.set(GIANT_BASE.x, 0, GIANT_BASE.z);
    this.flakes.frustumCulled = false;
    this.flakes.renderOrder = 4;
    this.group.add(this.flakes);
    // ice plates orbiting the torso
    this.plateMat = new THREE.MeshStandardMaterial({ color: 0xcfeeff, roughness: 0.14, metalness: 0.25, emissive: 0x2f78c8, emissiveIntensity: 0.9, flatShading: true, fog: false });
    this.plates = new THREE.InstancedMesh(plateGeometry(), this.plateMat, PLATES);
    this.plates.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.plates.frustumCulled = false;
    this.torso.add(this.plates);
    for (let i = 0; i < PLATES; i++) {
      const o = i * 6;
      this.plateData[o] = (i / PLATES) * Math.PI * 2 + r() * 0.3;
      this.plateData[o + 1] = 14 + r() * 6;
      this.plateData[o + 2] = 8 + r() * 26;
      this.plateData[o + 3] = (0.16 + r() * 0.12) * (i % 3 === 0 ? -1 : 1);
      this.plateData[o + 4] = 0.8 + r() * 1.0;
      this.plateData[o + 5] = r() * 6.28;
    }
    // vortex tubes: two per arm (upper arm, funnel to the ground) + the neck
    // upper arms / neck taper toward their far end; the funnels (tubes 1, 3) are narrow at the ground, wide up top
    const tubeGeo = new THREE.CylinderGeometry(0.62, 1, 1, 22, 14, true).translate(0, 0.5, 0);
    const funnelGeo = new THREE.CylinderGeometry(1, FUNNEL_FOOT, 1, 22, 14, true).translate(0, 0.5, 0);
    for (let i = 0; i < 5; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'whiteoutVortex',
        uniforms: {
          uTime: { value: 0 }, uAlpha: { value: 0.8 }, uSpin: { value: 1.2 }, uFlash: { value: 0 },
          uDark: { value: CLOUD_DARK.clone().multiplyScalar(1.3) }, uLit: { value: new THREE.Color(0xe4f0ff) },
        },
        vertexShader: VORTEX_VERT,
        fragmentShader: VORTEX_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const funnel = i === 1 || i === 3;
      const mesh = new THREE.Mesh(funnel ? funnelGeo : tubeGeo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 3;
      this.group.add(mesh);
      this.tubes.push({ mesh, mat, funnel });
    }
    // heart beams
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 6, true).translate(0, 0.5, 0);
    {
      // bright at the Heart, fading up toward the giant (no wall of light over its body)
      const pa = beamGeo.getAttribute('position');
      const col = new Float32Array(pa.count * 3);
      for (let i = 0; i < pa.count; i++) {
        const v = 1 - 0.8 * pa.getY(i);
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v * v;
      }
      beamGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    this.beamCoreMat = new THREE.MeshBasicMaterial({ color: 0xe8f8ff, vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    this.beamGlowMat = new THREE.MeshBasicMaterial({ color: 0x3aa8ff, vertexColors: true, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false });
    for (let i = 0; i < BEAMS; i++) {
      const core = new THREE.Mesh(beamGeo, this.beamCoreMat);
      const glow = new THREE.Mesh(beamGeo, this.beamGlowMat);
      core.frustumCulled = glow.frustumCulled = false;
      core.renderOrder = 6;
      glow.renderOrder = 5;
      core.visible = glow.visible = false;
      this.group.add(core, glow);
      this.beams.push({ core, glow, on: 0, x: 0, y: 0, z: 0 });
    }
  }

  /** Visible stand-ins sharing every program (the scene's copies stay hidden until the finale, and a warm-up compiles
   *  only what is visible): one per material and object kind. Built once. */
  warmMeshes(): THREE.Object3D[] {
    if (!this.billows) this.build();
    return (this.warm ??= standIns([this.group]));
  }
  private warm: THREE.Object3D[] | null = null;

  /* ------------------------------------------------------------------ per frame */

  /** `viewH`: the drawing buffer height (px), for the billow / flake sizes. */
  update(dt: number, camera: THREE.Camera, viewH: number): void {
    if (!this.group.visible) return;
    this.time += dt;
    const t = this.time;
    // poses are worked out in world space (an identity group); THE IMPLOSION's collapse is applied at the end
    const g = this.group;
    if (g.scale.x !== 1 || g.position.lengthSq() > 0 || g.quaternion.w !== 1) {
      g.position.set(0, 0, 0);
      g.quaternion.identity();
      g.scale.setScalar(1);
      g.updateMatrixWorld();
    }
    const rise = Math.max(0, Math.min(1, this.rise));
    const ease = 1 - (1 - rise) * (1 - rise);
    const sink = (1 - ease) * SINK;
    const anger = this.anger;
    const churn = 1 + anger * 1.4;
    const fov = (camera as THREE.PerspectiveCamera).fov ?? 60;
    const scale = viewH / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
    // lightning: random flickers inside, more often and brighter with anger
    this.boltT -= dt;
    if (this.boltT <= 0) {
      this.boltT = (2.6 - anger * 1.9) * (0.4 + Math.random());
      this.bolt = Math.max(this.bolt, 0.35 + Math.random() * (0.4 + anger * 0.5));
    }
    // (Reduced flashes: the lightning in the body at half strength, no flicker)
    const bolt = settings.reduceFlash ? this.bolt * 0.5 : this.bolt * (0.6 + 0.4 * Math.random());
    this.bolt = Math.max(0, this.bolt - dt * 4.5);
    this.flashK = Math.max(0, this.flashK - dt * 7);

    // torso: hunched, swaying; leans in for the STAGGER
    const lean = Math.max(0, Math.min(1, this.lean));
    const lk = lean * lean * (3 - 2 * lean);
    this.torso.position.set(GIANT_BASE.x, GIANT_BASE.y - sink, GIANT_BASE.z);
    this.torso.rotation.set(TILT_IDLE + (TILT_DOWN - TILT_IDLE) * lk + Math.sin(t * 0.4) * 0.025 * (1 + anger), Math.sin(t * 0.23) * 0.05, Math.sin(t * 0.31) * 0.03);
    this.torso.updateMatrixWorld();
    for (let i = 0; i < 2; i++) {
      const m = i === 0 ? this.billowMat : this.headMat;
      const u = m.uniforms;
      u.uTime.value = t;
      u.uScale.value = scale;
      u.uChurn.value = churn;
      u.uFlash.value = bolt;
      u.uAnger.value = anger;
      u.uAlpha.value = (m === this.headMat ? 0.6 : 0.52) * Math.min(1, rise * 1.6);
    }
    for (const m of this.shellMats) {
      m.uniforms.uTime.value = t;
      m.uniforms.uChurn.value = churn;
      m.uniforms.uFlash.value = bolt * 0.8;
    }
    const fu = this.flakeMat.uniforms;
    fu.uTime.value = t;
    fu.uScale.value = scale;
    fu.uChurn.value = churn;
    fu.uRise.value = ease;

    // plates orbit the torso, tumbling
    for (let i = 0; i < PLATES; i++) {
      const o = i * 6;
      const d = this.plateData;
      const a = d[o] + t * d[o + 3] * churn;
      const rr = d[o + 1] + Math.sin(t * 0.5 + i) * 1.2;
      _v.set(Math.sin(a) * rr, d[o + 2] + Math.sin(t * 0.7 + d[o + 5]) * 1.4, Math.cos(a) * rr * 0.8);
      _e.set(t * 0.6 + d[o + 5], a + Math.PI / 2, Math.sin(t * 0.4 + i) * 0.6);
      _q.setFromEuler(_e);
      _m.compose(_v, _q, _s.setScalar(d[o + 4]));
      this.plates.setMatrixAt(i, _m);
    }
    this.plates.instanceMatrix.needsUpdate = true;
    this.plateMat.emissiveIntensity = 0.8 + bolt * 1.2 + anger * 0.4;

    // head + eye: the eye peers over the stand (bobbing, looking about), swoops onto the stand front in a STAGGER
    this.eyeAt(lean, _a);
    _a.y -= sink;
    const idle = 1 - lk;
    _a.x += Math.sin(t * 0.37) * 1.2 * idle;
    _a.y += Math.sin(t * 0.53) * 0.5 * idle;
    this.head.position.copy(_a);
    this.head.rotation.set(-0.12 * idle + 0.25 * lk, Math.sin(t * 0.29) * 0.12 * idle, Math.sin(t * 0.41) * 0.05);
    this.head.scale.setScalar(1 + lk * 0.12);
    // lids: ease toward open; a blink now and then while open
    const target = this.open > 0.5 ? (Math.sin(t * 0.9) > 0.985 ? 0 : 1) : 0;
    this.lid += (target - this.lid) * Math.min(1, dt * (target > this.lid ? 5 : 9));
    for (const lid of this.lids) {
      const sy = lid.userData.sy as number;
      // closed: the halves meet at the eye's equator; open: rolled back up / down
      lid.rotation.x = sy > 0 ? -this.lid * 1.25 : this.lid * 1.05;
    }
    const eu = this.eyeMat.uniforms;
    eu.uTime.value = t;
    eu.uGlare.value = this.glare;
    eu.uPupil.value = Math.max(this.pupil, this.glare);
    eu.uFlash.value = this.flashK * 0.9;
    eu.uAnger.value = anger;
    // a faint cold glow even shut (it is in there), full open, blazing in a glare
    this.haloMat.opacity = (0.12 + this.lid * (0.4 + 0.6 * this.glare + 0.12 * Math.sin(t * 3))) * Math.min(1, rise * 2) + this.flashK * 0.4;
    this.halo.scale.setScalar(EYE_R * (5.5 + this.glare * 4));
    this.seamMat.opacity = Math.max(0, 1 - this.lid * 2.5) * (0.75 + 0.25 * Math.sin(t * 2.3)) * Math.min(1, rise * 2);
    this.seam.visible = this.seamMat.opacity > 0.01;

    // neck: from the torso's neck anchor to the back of the head
    _a.copy(NECK).applyMatrix4(this.torso.matrixWorld);
    _b.set(0, 2, -7).applyQuaternion(this.head.quaternion).add(this.head.position);
    this.tube(this.tubes[4], _a, _b, 5.5, 4, 0.55);

    // arms: shoulder -> elbow -> a funnel down to the hand (resting beside the stand, or planted on a sweep lane)
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -1 : 1;
      const k = Math.max(0, Math.min(1, this.armReach[i]));
      const ke = k * k * (3 - 2 * k);
      _a.copy(SHOULDER[i]).applyMatrix4(this.torso.matrixWorld);
      _b.copy(HAND_REST[i]).lerp(this.armTarget[i], ke);
      _b.y -= sink * (1 - ke);
      _b.x += Math.sin(t * 0.8 + i * 2) * 0.8 * (1 - ke);
      // elbow: above and outside the midpoint, dropping lower as the hand reaches into the arena
      _w.copy(_a).lerp(_b, 0.45);
      _w.x += sx * (6 - 4 * ke);
      _w.y += 4 + 7 * ke;
      this.tube(this.tubes[i * 2], _a, _w, 4.6, 3.2, 0.55);
      this.tube(this.tubes[i * 2 + 1], _b, _w, FUNNEL_TOP * FUNNEL_FOOT, FUNNEL_TOP, 0.55 + 0.3 * ke);
      this.tubes[i * 2 + 1].mat.uniforms.uSpin.value = 1.4 + ke * 2.2 + anger;
    }
    for (const tb of this.tubes) {
      tb.mat.uniforms.uTime.value = t;
      tb.mat.uniforms.uFlash.value = bolt * 0.35;
    }

    // heart beams: a flickering core in a soft glow, chest-bound
    this.chestPos(_b);
    for (const b of this.beams) {
      const on = b.on > 0.01 && rise > 0.5;
      b.core.visible = b.glow.visible = on;
      if (!on) continue;
      _a.set(b.x, b.y, b.z);
      const w = (0.14 + 0.04 * Math.sin(t * 37 + b.x)) * b.on;
      this.beam(b.core, _a, _b, w);
      this.beam(b.glow, _a, _b, w * 2.6);
    }
    this.beamCoreMat.opacity = 0.6 + 0.2 * Math.sin(t * 23);
    this.beamGlowMat.opacity = 0.22 + 0.08 * Math.sin(t * 11);

    // THE IMPLOSION: cracks over the eye; the whole storm spirals into the eye and shrinks to a point
    eu.uCrack.value = this.crack;
    const c = Math.max(0, Math.min(1, this.collapse));
    if (c > 0) {
      // slow at first, then everything goes at once
      const ce = c * c * (1.6 - 0.6 * c);
      const sc = Math.max(0.001, (1 - ce) * (1 - ce * 0.4));
      _q.setFromAxisAngle(UP, ce * ce * 5.5);
      // scale + spin about the eye (it stays where it is: everything else pours into it)
      _a.copy(this.head.position);
      _b.copy(_a).multiplyScalar(sc).applyQuaternion(_q);
      g.position.copy(_a).sub(_b);
      g.quaternion.copy(_q);
      g.scale.setScalar(sc);
      // the churn goes wild, the body brightens as it is drawn in
      for (let i = 0; i < 2; i++) {
        const m = i === 0 ? this.billowMat : this.headMat;
        m.uniforms.uChurn.value = churn + ce * 6;
        m.uniforms.uFlash.value = Math.max(bolt, ce * 0.35);
        // world-sized points: they shrink with the body (sqrt: the cloud thickens round the eye as it goes)
        m.uniforms.uScale.value = scale * Math.sqrt(sc);
      }
      fu.uScale.value = scale * Math.sqrt(sc);
      for (const m of this.shellMats) m.uniforms.uChurn.value = churn + ce * 6;
      fu.uChurn.value = churn + ce * 8;
      this.haloMat.opacity += ce * 0.6;
    }
  }

  /** Place a vortex tube from `a` (radius ra) to `b` (radius rb); `alpha`. The geometry's taper is fixed (an arm: 1 ->
   *  0.62; a funnel: FUNNEL_FOOT -> 1): the scale follows the wider end. */
  private tube(tb: Tube, a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, alpha: number): void {
    _v.copy(b).sub(a);
    const len = Math.max(0.01, _v.length());
    tb.mesh.position.copy(a);
    tb.mesh.quaternion.setFromUnitVectors(UP, _v.multiplyScalar(1 / len));
    const r = tb.funnel ? rb : Math.max(ra, rb / 0.62);
    tb.mesh.scale.set(r, len, r);
    tb.mat.uniforms.uAlpha.value = alpha * Math.min(1, this.rise * 1.5);
  }

  private beam(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3, w: number): void {
    _v.copy(b).sub(a);
    const len = Math.max(0.01, _v.length());
    mesh.position.copy(a);
    mesh.quaternion.setFromUnitVectors(UP, _v.multiplyScalar(1 / len));
    mesh.scale.set(w, len, w);
  }
}

/** The one giant (built per scene, shown only in the finale). */
export const whiteoutGiant = new WhiteoutGiant();
