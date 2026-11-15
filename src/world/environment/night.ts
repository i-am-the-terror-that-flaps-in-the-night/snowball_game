import * as THREE from 'three';
import type { ZoneDef } from '../../core/types';
import type { BiomeSky } from './styles';

/**
 * NIGHT arenas (Settings › Time of day; core/timeOfDay.ts decides per arena start). Purely visual: the same zone,
 * relit. Every arena keeps its identity at night:
 *   - nightLook(zone): the zone's light / sky / fog fields swapped for a dark themed sky (deep navy / indigo top, a
 *     horizon glow in the arena's colours), darker fog pulled to the theme, a dim cool moon as the shadow-casting sun
 *     and a lowered (never black) ambient, plus sky extras (stars everywhere, the glacier's aurora, a moon disc).
 *   - NIGHT_BOOST: how much the existing emissives (neon, lava, windows, ramp lips, gate lights) are turned up.
 *   - GlowPoints: ONE additive Points draw for every small light of the stadium at night: phone lights / glow sticks in
 *     the crowd (twinkling, bobbing with their spectator), camera flashes, and the halos of the floodlight lamps.
 *   - floodConeGeometry: the soft light cones under the floodlight heads (merged, one additive draw; dropped on LOW).
 * Environment.setZone applies the look, world/environment/NightScenery.ts builds the stadium dressing.
 */

/** Night overrides of one arena look. Colours are hex; the ZoneDef fields keep their meaning. */
export interface NightLook {
  skyTop: number;
  skyBottom: number;
  /** Fog + horizon colour (the scene background too). */
  fogColor: number;
  /** Moon (the shadow-casting directional light). */
  sunColor: number;
  sunIntensity: number;
  ambientColor: number;
  ambientIntensity: number;
  /** Sky extras / bounce / floodlight spot colours, replacing the day BIOME_SKY entry. */
  sky: BiomeSky;
  /** Floodlight lamp colour (lamp heads, cones, pools, the two real spot lights unless sky.spots is set). */
  flood: number;
  /** Phone-light / glow-stick colours in the crowd (white phone torches are added on top). */
  glow: number[];
}

/** Multiplier on the zone's floodlight spot intensity at night (the two real, shadow-free spots). */
export const NIGHT_SPOT_BOOST = 2.6;
/** The same for venues whose spots are already huge (Plaza stage lights, the Snowdome's towers). */
export const NIGHT_SPOT_BOOST_BIG = 1.4;
/** Multiplier on existing emissive intensities / glow opacities at night. */
export const NIGHT_BOOST = 1.6;
/** Crowd body lift at night: a floodlight wash so the spectators keep their colours (added emissive, x albedo). */
export const NIGHT_CROWD_LIFT = 0.55;

const MOON = { dir: [0.35, 0.42, -1] as [number, number, number], size: 0.03 };

export const NIGHT: Record<string, NightLook> = {
  // Coldboot Glacier: icy cyan horizon, a big aurora and stars over the relay station
  glacier: {
    skyTop: 0x01040f, skyBottom: 0x0a2440, fogColor: 0x10324c,
    sunColor: 0xa8d4ff, sunIntensity: 0.81, ambientColor: 0x7aa6e0, ambientIntensity: 0.45,
    sky: { bounce: 0x3c6c96, aurora: 1.35, stars: 1.2, spots: [0xc8ecff, 0xc8ecff], sun: { ...MOON, color: 0xdff2ff } },
    flood: 0xdff4ff, glow: [0x5ff0ff, 0x9a7bff, 0x3df5b0],
  },
  // Inferno Quarry: black-red sky, the lava glow on the horizon and through the smoke
  quarry: {
    skyTop: 0x060104, skyBottom: 0x3a0c06, fogColor: 0x46140a,
    sunColor: 0xffb48a, sunIntensity: 0.68, ambientColor: 0xd27a5c, ambientIntensity: 0.43,
    sky: { bounce: 0xff5a20, smoke: 0.7, stars: 0.35, spots: [0xffa060, 0xffbc80] },
    flood: 0xffcc96, glow: [0xff8a2a, 0xffd040, 0xff3a1a],
  },
  // Rust Basin: violet-black desert sky, a red-orange dust glow low down, a pale moon
  mars: {
    skyTop: 0x050309, skyBottom: 0x2a1018, fogColor: 0x4a2216,
    sunColor: 0xffe2cc, sunIntensity: 0.77, ambientColor: 0xc88a78, ambientIntensity: 0.43,
    sky: { bounce: 0xa05032, stars: 1.1, sun: { dir: [-0.35, 0.3, -1], size: 0.026, color: 0xffe8d8 } },
    flood: 0xfff0dc, glow: [0xff8a3d, 0x7fd8ff, 0xf0e8d8],
  },
  // The Thermal Divide: magma-red west, ice-blue east, under one starry sky
  divide: {
    skyTop: 0x0c0306, skyBottom: 0x3c0e08, fogColor: 0x2c2032,
    sunColor: 0xe8e0ff, sunIntensity: 0.68, ambientColor: 0xb8a6d0, ambientIntensity: 0.43,
    sky: {
      bounce: 0x806078, stars: 0.9,
      split: { top: 0x020814, bottom: 0x0a2c4c, horizon: 0x16405e },
      spots: [0xff7a3a, 0x7fe0ff], splitSpots: true,
    },
    flood: 0xfff0f0, glow: [0xff5a2a, 0x5fd8ff, 0xd070ff],
  },
  // Golden Tower Plaza: a deep blue rally night, gold glow over the skyline
  plaza: {
    skyTop: 0x030820, skyBottom: 0x1c2450, fogColor: 0x3c3040,
    sunColor: 0xfff0d0, sunIntensity: 0.68, ambientColor: 0xdccab4, ambientIntensity: 0.42,
    sky: { bounce: 0xb09060, stars: 0.6, sun: { ...MOON, color: 0xfff4dc } },
    flood: 0xffe2b0, glow: [0xc8102e, 0x1f3b8c, 0xf2c033],
  },
  // The Omega Works: indigo sky over a neon magenta horizon
  omega: {
    skyTop: 0x03041a, skyBottom: 0x4a1058, fogColor: 0x24163e,
    sunColor: 0xc8c0ff, sunIntensity: 0.64, ambientColor: 0x9a90e8, ambientIntensity: 0.41,
    sky: { stars: 1.0, sun: { ...MOON, color: 0xe8e0ff } },
    flood: 0xf2e8ff, glow: [0xff2bd6, 0x18e8ff, 0xffd400],
  },
  // THE SNOWDOME: a prime-time match under a violet-navy sky, sponsor colours everywhere
  brawl: {
    skyTop: 0x040820, skyBottom: 0x2a1a4c, fogColor: 0x2a2446,
    sunColor: 0xc8d4ff, sunIntensity: 0.72, ambientColor: 0xa8b0f0, ambientIntensity: 0.47,
    sky: { stars: 0.9, sun: { ...MOON, color: 0xe8eeff } },
    flood: 0xfff3e0, glow: [0xff3d7f, 0x22d3ff, 0xffd23a, 0x7cff5a],
  },
  // PROTOCOL C: a black-navy boardroom night, gold glow on the horizon, icy-white floods
  protocol: {
    skyTop: 0x02040e, skyBottom: 0x2a2210, fogColor: 0x2a2a34,
    sunColor: 0xd8e4ff, sunIntensity: 0.7, ambientColor: 0xc8c0b0, ambientIntensity: 0.45,
    sky: { bounce: 0x8a7a50, stars: 0.8, sun: { ...MOON, color: 0xfff4dc } },
    flood: 0xffeccc, glow: [0xffd257, 0x7fe0ff, 0xffffff],
  },
  // Anything else (the Training Yard's pines look): a plain navy night
  default: {
    skyTop: 0x030818, skyBottom: 0x1a2a4a, fogColor: 0x2a3448,
    sunColor: 0xc8dcff, sunIntensity: 0.72, ambientColor: 0xa8b8e0, ambientIntensity: 0.47,
    sky: { stars: 1.0, sun: { ...MOON, color: 0xeef4ff } },
    flood: 0xfff2d6, glow: [0xffc21a, 0x2f7de1, 0xe8423a],
  },
};

/** The night look of a zone: by biome (any venue dressed as one), else by venue theme. */
export function nightLook(zone: ZoneDef): NightLook {
  const key = zone.biome?.key;
  if (key && key !== 'snowdome' && NIGHT[key]) return NIGHT[key];
  return NIGHT[zone.theme] ?? NIGHT.default;
}

/** The zone with its light / sky / fog colours swapped for the night look (fog distances, snow and gameplay fields
 *  untouched). */
export function nightZone(zone: ZoneDef): ZoneDef {
  const n = nightLook(zone);
  return {
    ...zone,
    skyTop: n.skyTop, skyBottom: n.skyBottom, fogColor: n.fogColor,
    sunColor: n.sunColor, sunIntensity: n.sunIntensity, ambientColor: n.ambientColor, ambientIntensity: n.ambientIntensity,
  };
}

/* ------------------------------------------------------------------ glow points */

/** Point behaviour: steady halo, a twinkling phone light / glow stick that bobs with its spectator, a camera flash. */
export const GLOW_HALO = 0;
export const GLOW_PHONE = 1;
export const GLOW_FLASH = 2;

/** Collects stadium lights while a zone is built, then emits them as one additive Points draw. */
export class GlowPoints {
  private pos: number[] = [];
  private col: number[] = [];
  private size: number[] = [];
  private phase: number[] = [];
  private mode: number[] = [];
  private c = new THREE.Color();

  get count(): number {
    return this.size.length;
  }

  /** `size` is the glow diameter in metres. */
  add(x: number, y: number, z: number, color: number, size: number, mode: number, phase: number, gain = 1): void {
    this.pos.push(x, y, z);
    this.c.setHex(color).multiplyScalar(gain);
    this.col.push(this.c.r, this.c.g, this.c.b);
    this.size.push(size);
    this.phase.push(phase);
    this.mode.push(mode);
  }

  /** The Points (null when nothing was added). Uniforms are shared: the caller advances uTime / uScale per frame. */
  build(uniforms: GlowUniforms): THREE.Points | null {
    if (!this.size.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(this.size, 1));
    g.setAttribute('aPhase', new THREE.Float32BufferAttribute(this.phase, 1));
    g.setAttribute('aMode', new THREE.Float32BufferAttribute(this.mode, 1));
    g.computeBoundingSphere();
    const pts = new THREE.Points(g, glowMaterial(uniforms));
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    return pts;
  }
}

export interface GlowUniforms {
  uTime: { value: number };
  /** Pixels per metre at 1 m distance: viewport height / (2 tan(fov / 2)). */
  uScale: { value: number };
  /** Crowd bob amplitude (the same uniform object the crowd bodies use). */
  uBob: { value: number };
  uFogNear: { value: number };
  uFogFar: { value: number };
}

function glowMaterial(u: GlowUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...u },
    vertexShader: /* glsl */ `
      uniform float uTime; uniform float uScale; uniform float uBob; uniform float uFogNear; uniform float uFogFar;
      attribute vec3 color; attribute float aSize; attribute float aPhase; attribute float aMode;
      varying vec3 vCol;
      void main() {
        vec3 p = position;
        float a = 1.0;
        float s = aSize;
        if (aMode > 0.5) {
          // same bob as the crowd body (EnvironmentCore.bobify) so the light rides with its spectator
          p.y += abs(sin(uTime * (3.2 + fract(aPhase) * 2.6) + aPhase)) * uBob;
        }
        if (aMode > 0.5 && aMode < 1.5) {
          p.x += sin(uTime * (1.1 + fract(aPhase * 3.7)) + aPhase * 5.0) * 0.1;
          p.z += cos(uTime * (0.9 + fract(aPhase * 2.3)) + aPhase * 4.0) * 0.1;
          a = 0.6 + 0.4 * sin(uTime * (1.5 + fract(aPhase * 7.1) * 3.5) + aPhase * 13.0);
        } else if (aMode > 1.5) {
          float f = fract(uTime * (0.07 + fract(aPhase * 3.1) * 0.1) + fract(aPhase * 0.37));
          a = f < 0.03 ? 1.0 - f / 0.03 : 0.0;
          s *= 0.6 + a;
        }
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        // haze: far lights fade a little (never fully: the far stands keep twinkling)
        a *= 1.0 - 0.6 * smoothstep(uFogNear, uFogFar * 1.3, d);
        gl_PointSize = a > 0.003 ? clamp(s * uScale / max(d, 0.5), 1.5, 256.0) : 0.0;
        vCol = color * a;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        if (r > 1.0) discard;
        float core = smoothstep(0.35, 0.0, r);
        float halo = pow(1.0 - r, 2.2);
        gl_FragColor = vec4(vCol * (halo * 0.75 + core * 1.1), 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  });
}

/* ------------------------------------------------------------------ floodlight cones */

/** An open cone from `from` (radius r0) to `to` (radius r1) with a `v` attribute 0 at the lamp, 1 at the ground. */
export function floodConeGeometry(from: THREE.Vector3, to: THREE.Vector3, r0: number, r1: number, color: THREE.Color): THREE.BufferGeometry {
  const len = from.distanceTo(to);
  const g = new THREE.CylinderGeometry(r0, r1, len, 20, 1, true);
  // CylinderGeometry: +y half = top (r0). v: 0 at the lamp end.
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) v[i] = 0.5 - pos.getY(i) / len;
  g.setAttribute('aV', new THREE.BufferAttribute(v, 1));
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) color.toArray(col, i * 3);
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.translate(0, -len / 2, 0); // lamp at the origin, cone down -y
  const dir = to.clone().sub(from).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir));
  g.translate(from.x, from.y, from.z);
  g.deleteAttribute('uv');
  return g;
}

/** Additive cone shader: bright at the lamp, fading toward the ground, soft at the silhouette. */
export function floodConeMaterial(strength: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      attribute float aV; attribute vec3 aCol;
      varying float vV; varying vec3 vN; varying vec3 vView; varying vec3 vCol;
      void main() {
        vV = aV;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        // fade out close to the camera: a cone sweeping past the lens never washes the screen out
        vCol = aCol * smoothstep(6.0, 22.0, distance(cameraPosition, wp.xyz));
        vN = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uStrength;
      varying float vV; varying vec3 vN; varying vec3 vView; varying vec3 vCol;
      void main() {
        float edge = pow(abs(dot(normalize(vN), normalize(vView))), 1.2);
        float fall = pow(1.0 - vV, 1.7) * smoothstep(0.0, 0.06, vV);
        gl_FragColor = vec4(vCol * edge * fall * uStrength, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  });
}

/* ------------------------------------------------------------------ LED ribbon */

/** Scrolling LED ribbon texture (stand-front boards): colour blocks + slogans in the arena's accents on black. */
export function ledRibbonTexture(accents: number[], words: string[]): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#04050a';
  g.fillRect(0, 0, 1024, 64);
  const seg = 1024 / words.length;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.font = '900 40px "Arial Black", Impact, sans-serif';
  for (let i = 0; i < words.length; i++) {
    const col = '#' + accents[i % accents.length].toString(16).padStart(6, '0');
    const x0 = i * seg;
    g.fillStyle = col;
    g.fillRect(x0 + 4, 6, 10, 52);
    g.fillRect(x0 + seg - 14, 6, 10, 52);
    g.fillText(words[i], x0 + seg / 2, 35, seg - 40);
  }
  // LED dot grid
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 0; y < 64; y += 4) g.fillRect(0, y, 1024, 1);
  for (let x = 0; x < 1024; x += 4) g.fillRect(x, 0, 1, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
