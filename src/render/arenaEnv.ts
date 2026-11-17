import * as THREE from 'three';
import { withPrivateRandom } from './privateRandom';

/* Arena reflections (art pass, docs/art-pass.md "Arena reflections and softer ambient light").
 *
 * One small pre-filtered environment map per arena look (day / night), set as scene.environment: every standard
 * material (palette-merged parts included: scene.environment is not a material property, so palette eligibility is
 * unchanged) gets reflections that match the arena and an ambient that varies with direction, instead of the flat
 * two-colour hemisphere light. NOT a scene capture: a procedural sky drawn by one shader from the arena's own numbers
 *   - the ambient the hemisphere light gave (sky colour above, bounce colour below, scaled so the diffuse irradiance
 *     matches what the hemisphere light hands over: see radiance() below),
 *   - the visible sky gradient (zenith / horizon tint),
 *   - the arena palette as a band of stands around the horizon, with a darker boards line under it,
 *   - a soft glow toward the sun / moon (the directional light keeps the sharp highlight), and the floodlight heads
 *     (the two tower spots by day, every lamp bank at night) as small bright lamps,
 * rendered into a 128 px cube and pre-filtered with PMREM. Built once per arena load (Environment.setZone, before the
 * arena's shader warm-up), under a private RNG (privateRandom.ts) so the gameplay stream is untouched.
 *
 * Every build lands in ONE persistent cube-UV target, so the texture object never changes (no program change from
 * one arena to the next). The generator, the sky shader and the scratch target are disposed after each build (their
 * programs are released). The plows' paints take this map too (render/reflections.ts).
 *
 * Highlights stay under the bloom threshold: the brightest radiance in the map is capped (LUM_CAP), so even a mirror
 * paint (envMapIntensity 1.2) reflecting a floodlight stays below EXCESS_LUM (render/post.ts). */

/** Cube face size of the source capture (the PMREM's largest level). */
export const ENV_SIZE = 128;
/** Peak linear luminance of any direction of the map (lamps, sun glow). */
export const LUM_CAP = 0.8;
export const MAX_LAMPS = 8;
const MAX_ACCENTS = 6;

export interface EnvLamp {
  /** Direction from the arena centre (world). */
  dir: THREE.Vector3;
  color: THREE.Color;
  /** Angular radius (rad) and peak share of LUM_CAP. */
  size: number;
  power: number;
}

/** Everything the procedural sky is drawn from (colours are linear working space unless noted). */
export interface EnvInput {
  /** The arena's full hemisphere light (colour x intensity gives its irradiance). */
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  /** Share of that ambient the map carries (the hemisphere light keeps the rest). */
  share: number;
  /** Detail contrast, 0 = a plain hemisphere. */
  detail: number;
  /** The visible sky gradient. */
  skyTop: THREE.Color;
  skyBottom: THREE.Color;
  horizon: THREE.Color;
  /** Arena palette (stands band). */
  accents: readonly THREE.Color[];
  /** Brightness of the stands band (radiance of a white seat). */
  band: number;
  /** Toward the sun / moon (where its light comes from), its colour x intensity. */
  sunDir: THREE.Vector3;
  sun: THREE.Color;
  lamps: readonly EnvLamp[];
}

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
	vDir = normalize( position );
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const frag = /* glsl */ `
uniform vec3 uHemiA;
uniform vec3 uHemiB;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uHorizon;
uniform float uDetail;
uniform vec3 uAccents[ ${MAX_ACCENTS} ];
uniform int uAccentCount;
uniform float uBand;
uniform vec3 uSunDir;
uniform vec3 uSun;
uniform vec4 uLamps[ ${MAX_LAMPS} ];
uniform vec3 uLampCols[ ${MAX_LAMPS} ];
uniform int uLampCount;
uniform float uCap;
varying vec3 vDir;
float lum( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }
void main() {
	vec3 d = normalize( vDir );
	float h = d.y;
	// Plain ambient: a + b * y reproduces the hemisphere light's irradiance after the cosine convolution (see TS).
	vec3 base = max( uHemiA + uHemiB * h, vec3( 0.0 ) );
	vec3 c = base;
	if ( h > 0.0 ) {
		// Sky: the visible gradient's hue at the ambient's brightness.
		vec3 g = mix( uHorizon, uBottom, smoothstep( 0.0, 0.18, h ) );
		g = mix( g, uTop, smoothstep( 0.15, 0.85, h ) );
		vec3 tint = g * ( lum( base ) / max( lum( g ), 1e-4 ) );
		// (a light touch: the hemisphere colours are the arena's tuned ambient hue)
		c = mix( base, tint, 0.18 );
		// Brightness over the sky: a bright horizon, a deeper zenith (reflections get a horizon line to show; the
		// cosine-weighted mean stays within a few % of the plain ambient, so diffuse light barely moves).
		c *= mix( 1.45, 1.0, smoothstep( 0.2, 0.45, h ) ) * mix( 1.0, 0.75, smoothstep( 0.5, 1.0, h ) );
		// The stands: a band of the arena colours just above the horizon, in blocks around the bowl.
		float az = atan( d.x, d.z );
		float cell = floor( ( az + 3.14159265 ) * 7.0 );
		vec3 seat = vec3( 0.85 );
		for ( int i = 0; i < ${MAX_ACCENTS}; i ++ ) {
			if ( i < uAccentCount && int( mod( cell, float( uAccentCount + 1 ) ) ) == i ) seat = uAccents[ i ];
		}
		float band = smoothstep( 0.0, 0.03, h ) * ( 1.0 - smoothstep( 0.17, 0.24, h ) );
		c = mix( c, seat * uBand, band * 0.85 );
	} else {
		// Boards / walls: a darker line just under the horizon, then the lit snow.
		c *= 1.0 - 0.3 * ( 1.0 - smoothstep( -0.07, -0.02, h ) ) * smoothstep( -0.12, -0.07, h );
	}
	c = mix( base, c, uDetail );
	// Soft glow toward the sun / moon (the directional light draws the sharp highlight itself).
	float sa = max( dot( d, uSunDir ), 0.0 );
	c += uSun * uDetail * ( 0.05 * pow( sa, 6.0 ) + 0.12 * pow( sa, 64.0 ) );
	// Lamps: floodlight heads.
	for ( int i = 0; i < ${MAX_LAMPS}; i ++ ) {
		if ( i >= uLampCount ) break;
		vec4 l = uLamps[ i ];
		float a = acos( clamp( dot( d, l.xyz ), -1.0, 1.0 ) );
		float k = exp( - a * a / ( l.w * l.w ) );
		c += uLampCols[ i ] * k * uDetail;
	}
	float L = lum( c );
	if ( L > uCap ) c *= uCap / L;
	gl_FragColor = vec4( c, 1.0 );
}`;

const _c = new THREE.Color();
const _v = new THREE.Vector3();

/** Linear luminance (Rec. 709) of a working-space colour. */
export function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** Radiance terms (a, b: radiance = a + b * dir.y) of the plain ambient part of the map, so its diffuse lighting
 *  equals the hemisphere light's `share`:
 *   - three's hemisphere light: indirect diffuse = E_h(n) * albedo / PI, E_h(n) = mix(ground, sky, (n.y + 1) / 2) * I;
 *   - an environment radiance L(d) = a + b * d.y lights a surface with E(n) = PI * a + (2 PI / 3) * b * n.y (cosine
 *     convolution), and three's IBL diffuse is E(n) * albedo / PI (getIBLIrradiance returns PI * the convolved map).
 *  Matching both: a = (sky + ground) / 2 * I / PI, b = 1.5 * (sky - ground) / 2 * I / PI. Pure (exported for tests). */
export function hemiRadiance(sky: THREE.Color, ground: THREE.Color, intensity: number, share: number, a: THREE.Color, b: THREE.Color): void {
  const k = (intensity * share) / Math.PI;
  a.copy(sky).add(ground).multiplyScalar(0.5 * k);
  b.copy(sky).sub(ground).multiplyScalar(0.75 * k);
}

const IBL_LINE = '\tradiance += iblRadiance;';
let specGain: number | null = null;

/** Scale the environment's specular (reflected) light of every standard program by `gain`, diffuse untouched (a
 *  patch of three's lights_fragment_maps chunk, like post.ts patches the tone mapping). Programs compiled before keep
 *  their source; the first arena map is built before any arena program compiles, and setting scene.environment
 *  recompiles the rest. Once per session (later calls with another gain are ignored). False if three's chunk changed. */
export function installSpecularGain(gain: number): boolean {
  if (specGain !== null) return true;
  const src = THREE.ShaderChunk.lights_fragment_maps;
  if (!src.includes(IBL_LINE)) {
    console.warn('arenaEnv: three lights_fragment_maps chunk changed, no specular gain');
    specGain = 1;
    return false;
  }
  specGain = gain;
  const g = Number.isInteger(gain) ? `${gain}.0` : `${gain}`;
  THREE.ShaderChunk.lights_fragment_maps = src.replace(IBL_LINE, `\tradiance += iblRadiance * ${g};`);
  return true;
}

interface Persist {
  target: THREE.WebGLRenderTarget;
}
const targets = new WeakMap<THREE.WebGLRenderer, Persist>();

function makeMaterial(): THREE.ShaderMaterial {
  const v3 = () => ({ value: new THREE.Vector3() });
  const col = () => ({ value: new THREE.Color() });
  return new THREE.ShaderMaterial({
    name: 'arenaEnvSky',
    uniforms: {
      uHemiA: col(), uHemiB: col(), uTop: col(), uBottom: col(), uHorizon: col(), uDetail: { value: 1 },
      uAccents: { value: Array.from({ length: MAX_ACCENTS }, () => new THREE.Color()) }, uAccentCount: { value: 0 }, uBand: { value: 0 },
      uSunDir: v3(), uSun: col(),
      uLamps: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4()) },
      uLampCols: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Color()) }, uLampCount: { value: 0 },
      uCap: { value: LUM_CAP },
    },
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
  });
}

function fill(m: THREE.ShaderMaterial, e: EnvInput): void {
  const u = m.uniforms;
  hemiRadiance(e.hemiSky, e.hemiGround, e.hemiIntensity, e.share, u.uHemiA.value, u.uHemiB.value);
  u.uTop.value.copy(e.skyTop);
  u.uBottom.value.copy(e.skyBottom);
  u.uHorizon.value.copy(e.horizon);
  u.uDetail.value = e.detail;
  const n = Math.min(MAX_ACCENTS, e.accents.length);
  for (let i = 0; i < n; i++) (u.uAccents.value as THREE.Color[])[i].copy(e.accents[i]);
  u.uAccentCount.value = n;
  u.uBand.value = e.band * e.share;
  u.uSunDir.value.copy(e.sunDir).normalize();
  u.uSun.value.copy(e.sun).multiplyScalar(e.share);
  const ln = Math.min(MAX_LAMPS, e.lamps.length);
  for (let i = 0; i < ln; i++) {
    const l = e.lamps[i];
    _v.copy(l.dir).normalize();
    (u.uLamps.value as THREE.Vector4[])[i].set(_v.x, _v.y, _v.z, l.size);
    // lamp peak: `power` of the cap, in the lamp's hue
    _c.copy(l.color);
    const lu = Math.max(luminance(_c), 1e-4);
    (u.uLampCols.value as THREE.Color[])[i].copy(_c).multiplyScalar((LUM_CAP * l.power) / lu);
  }
  u.uLampCount.value = ln;
}

/** Render the arena's environment into the renderer's persistent cube-UV target (created on first use) and return
 *  its texture (always the same object for a renderer). */
export function buildArenaEnv(renderer: THREE.WebGLRenderer, e: EnvInput): THREE.Texture {
  return withPrivateRandom(() => {
    const scene = new THREE.Scene();
    const mat = makeMaterial();
    fill(mat, e);
    const geo = new THREE.SphereGeometry(10, 16, 8);
    scene.add(new THREE.Mesh(geo, mat));
    const gen = new THREE.PMREMGenerator(renderer);
    const shadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    let out: THREE.WebGLRenderTarget;
    try {
      out = gen.fromScene(scene, 0, 0.1, 100, { size: ENV_SIZE });
    } finally {
      renderer.shadowMap.autoUpdate = shadowAuto;
    }
    let p = targets.get(renderer);
    if (!p) {
      // First build: its output becomes the persistent target.
      targets.set(renderer, (p = { target: out }));
      out.texture.name = 'arenaEnv';
    } else {
      renderer.copyTextureToTexture(out.texture, p.target.texture);
      out.dispose();
    }
    gen.dispose();
    geo.dispose();
    mat.dispose();
    return p.target.texture;
  });
}

/** The persistent arena environment texture of a renderer, or null before the first build. */
export function arenaEnvTexture(renderer: THREE.WebGLRenderer): THREE.Texture | null {
  return targets.get(renderer)?.target.texture ?? null;
}
