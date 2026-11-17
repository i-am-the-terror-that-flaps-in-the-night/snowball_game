import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { look, strength as lookStrength } from './look';
import { withPrivateRandom } from './privateRandom';

/* Bloom post-processing (HIGH quality only).
 *
 * Off (LOW, or the Bloom setting off): renderFrame() is a plain renderer.render() to the canvas, exactly as before.
 *
 * On: the scene renders into a float target (R11F_G11F_B10F) holding the same display-referred image the canvas
 * would get (ACES, sRGB encoded; fog, the toneMapped:false sky, snow glitter and blending all as before), except that
 * it is not clamped to 1 and tone-mapped materials add their HDR excess on top:
 *   stored = ACES(c) + EXCESS_GAIN * c * max(lum(c) - EXCESS_LUM, 0) / lum(c)       (c = linear HDR colour)
 * Lit snow (sun 2.5 + hemisphere 0.9) peaks at a linear luminance of ~0.85 and the sky dome is toneMapped:false, so
 * neither goes above display white. What does: emissive materials (emissiveIntensity ~1+), and additive FX stacking
 * over a bright background (lightning, fire, sparks, kill FX). The bright pass keeps what is above display white
 * (BLOOM.threshold, soft knee) and blurs it over UnrealBloomPass's mip chain at a fraction of the CSS resolution; the
 * final pass writes min(scene, 1) + glow to the canvas.
 *
 * Why not linear HDR + OutputPass: with the tone map applied after compositing, additive FX over the white snow get
 * squeezed by ACES' shoulder (lightning nearly vanished), the toneMapped:false sky dome lost its blue and the
 * display-space fog no longer matched it. Keeping the display-referred image avoids all three.
 *
 * How the scene pass gets that image (WebGL, r186): the target is flagged isXRRenderTarget, so materials take the
 * renderer's tone mapping and the target's colour space (sRGB) exactly as for the canvas; during the pass
 * renderer.toneMapping is CustomToneMapping, whose GLSL (ShaderChunk.tonemapping_pars_fragment) is replaced below by
 * "ACES + excess". Nothing else uses CustomToneMapping, so canvas-path programs behave as before. The scene pass is
 * still renderer.render(), so the shadow pass and the shadow-proxy wrapper (shadowProxy.ts) run unchanged. Turning
 * bloom on or off recompiles the scene's programs once (the tone-mapping mode is part of the program key).
 *
 * Cost: the glow chain is ~1 ms; the offscreen scene target is the rest. A 4x MSAA offscreen target costs ~3 ms more
 * than the canvas's own MSAA at 3840x2160 on ANGLE/Metal (explicit resolve), so above MSAA_MAX_PIXELS the target is
 * single-sampled and the pixel density (DPR >= 1.5) does the anti-aliasing.
 *
 * Screen-space AO (art pass, render/look.ts ssao; HIGH quality only, through configureBloom's `ssao`): only on this
 * path. The scene target then carries a depth texture (resolved from the MSAA depth with the colour, one blit); one
 * half-resolution pass rebuilds view positions and normals from that depth (no normal pass: that would draw the scene
 * twice) and gathers SSAO_SAMPLES occluders within SSAO.radius metres; a separable depth-aware blur (2 half-res passes)
 * smooths it, and the bright pass and the output pass multiply it into the scene colour, so it lands BEFORE the bloom
 * (an occluded pixel glows less too). Cost: the depth resolve + 3 half-res full-screen passes; no scene draw. */

/** Linear luminance above which tone-mapped materials carry HDR excess into the bloom. */
export const EXCESS_LUM = 1.0;
export const EXCESS_GAIN = 1.5;
/** Glow tuning, read every frame. threshold: display-referred level (sRGB encoded, 1 = white) where the glow starts,
 *  knee: soft ramp below it. */
export const BLOOM = { threshold: 1.1, knee: 0.1, strength: 0.6, radius: 0.35 };
/** Bloom resolution as a fraction of the CSS canvas size (UnrealBloomPass halves it again for its first mip, so at
 *  DPR 2 the brightest mip is a quarter of the drawing buffer per axis). */
export const BLOOM_SCALE = 1;
/** Brawl: smaller bloom chain (the mode already caps the pixel ratio at 1.5). */
export const BLOOM_SCALE_BRAWL = 0.6;

/** Size the bloom pass is created / resized with, from the CSS canvas size. */
export function bloomResolution(cssW: number, cssH: number, brawl: boolean): { w: number; h: number } {
  const s = brawl ? BLOOM_SCALE_BRAWL : BLOOM_SCALE;
  return { w: Math.max(2, Math.round(cssW * s)), h: Math.max(2, Math.round(cssH * s)) };
}

/** Drawing buffers above this many pixels get a single-sampled scene target (see the header). */
export const MSAA_MAX_PIXELS = 4.2e6;

/** SSAO tuning (read every frame): radius (m), bias (cosine below which a tap does not occlude, plus 0.002 per metre
 *  of distance), the screen radius cap (half-res px), the distance band (m) over which it fades out (fogged distance
 *  gets none), and the gain on the occlusion. Final strength: look.ts (ssao). */
export const SSAO = { radius: 1.5, bias: 0.06, maxPx: 48, fadeNear: 50, fadeFar: 110, intensity: 3 };
export const SSAO_SAMPLES = 12;

/** MSAA samples for the scene target: 4 like the canvas, unless the buffer is large enough to rely on pixel density. */
export function sceneSamples(drawW: number, drawH: number, antialias: boolean): number {
  return antialias && drawW * drawH <= MSAA_MAX_PIXELS ? 4 : 0;
}

/** CPU mirror of the HDR-pass excess term (per channel, linear in, linear out); for tests and tuning. */
export function hdrExcess(r: number, g: number, b: number): [number, number, number] {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const k = l > EXCESS_LUM ? (EXCESS_GAIN * (l - EXCESS_LUM)) / l : 0;
  return [r * k, g * k, b * k];
}

const f = (v: number) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
const CUSTOM_TONE = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
let chunkReady: boolean | null = null;

/** Swap the (unused) identity CustomToneMapping for "ACES + HDR excess". False if three's chunk changed. */
export function installBloomChunk(): boolean {
  if (chunkReady !== null) return chunkReady;
  const src = THREE.ShaderChunk.tonemapping_pars_fragment;
  chunkReady = src.includes(CUSTOM_TONE) && src.includes('vec3 ACESFilmicToneMapping( vec3 color )');
  if (!chunkReady) {
    console.warn('post: three tone-mapping chunk changed, bloom disabled');
    return false;
  }
  THREE.ShaderChunk.tonemapping_pars_fragment = src.replace(
    CUSTOM_TONE,
    `vec3 CustomToneMapping( vec3 color ) {
	vec3 hdr = color * toneMappingExposure;
	float l = dot( hdr, vec3( 0.2126, 0.7152, 0.0722 ) );
	float k = max( l - ${f(EXCESS_LUM)}, 0.0 ) * ${f(EXCESS_GAIN)} / max( l, 1e-4 );
	return ACESFilmicToneMapping( color ) + hdr * k;
}`,
  );
  return true;
}

const BLUR_X = new THREE.Vector2(1, 0);
const BLUR_Y = new THREE.Vector2(0, 1);

/** Excess above display white, 4 bilinear taps (a 4x4 box) so thin bright lines don't shimmer when downsampled. */
const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 srcTexel;
uniform float luminosityThreshold;
uniform float smoothWidth;
uniform sampler2D tAO;
uniform float aoMix;
varying vec2 vUv;
vec3 bright( vec2 uv ) {
	vec3 c = texture2D( tDiffuse, uv ).rgb;
	if ( aoMix > 0.0 ) c *= mix( 1.0, texture2D( tAO, uv ).r, aoMix );
	// A NaN / Inf / absurd pixel in the scene (any shader, any GPU) must not enter the blur chain: the separable blur
	// would smear it into a hard-edged black block across the screen. Comparisons are false for NaN, so this catches
	// it even where isnan() is optimised away.
	float m0 = c.r + c.g + c.b;
	if ( !( m0 >= 0.0 ) || !( m0 < 3000.0 ) ) c = vec3( 0.0 );
	c = min( c, vec3( 64.0 ) );
	float m = max( c.r, max( c.g, c.b ) );
	float soft = clamp( m - luminosityThreshold + smoothWidth, 0.0, 2.0 * smoothWidth );
	soft = soft * soft / ( 4.0 * smoothWidth + 1e-5 );
	return c * ( max( soft, m - luminosityThreshold ) / max( m, 1e-4 ) );
}
void main() {
	vec2 o = srcTexel;
	vec3 s = bright( vUv + vec2( -o.x, -o.y ) ) + bright( vUv + vec2( o.x, -o.y ) )
		+ bright( vUv + vec2( -o.x, o.y ) ) + bright( vUv + vec2( o.x, o.y ) );
	gl_FragColor = vec4( 0.25 * s, 1.0 );
}`;

/** Bright pass + mip blur + mip composite, without UnrealBloomPass's full-resolution additive blend. */
class Bloom extends UnrealBloomPass {
  private quad = new FullScreenQuad();
  private oldClear = new THREE.Color();
  private hp: Record<string, THREE.IUniform>;

  constructor(w: number, h: number) {
    super(new THREE.Vector2(w, h), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    this.hp = this.highPassUniforms as Record<string, THREE.IUniform>;
    this.hp.srcTexel = { value: new THREE.Vector2() };
    this.hp.tAO = { value: null };
    this.hp.aoMix = { value: 0 };
    this.materialHighPassFilter.fragmentShader = BRIGHT_FRAG;
    this.materialHighPassFilter.uniforms = this.hp;
    this.materialHighPassFilter.needsUpdate = true;
  }

  /** Returns the texture holding the composited glow (at half the bloom resolution). */
  renderGlow(renderer: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget, ao: THREE.Texture | null, aoMix: number): THREE.Texture {
    renderer.getClearColor(this.oldClear);
    const oldAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);
    this.hp.tDiffuse.value = input.texture;
    this.hp.tAO.value = ao;
    this.hp.aoMix.value = ao ? aoMix : 0;
    (this.hp.srcTexel.value as THREE.Vector2).set(1 / input.width, 1 / input.height);
    this.hp.luminosityThreshold.value = BLOOM.threshold;
    this.hp.smoothWidth.value = BLOOM.knee;
    this.quad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    this.quad.render(renderer);
    let src = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const m = this.separableBlurMaterials[i];
      this.quad.material = m;
      m.uniforms.colorTexture.value = src.texture;
      m.uniforms.direction.value = BLUR_X;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      this.quad.render(renderer);
      m.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      m.uniforms.direction.value = BLUR_Y;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      this.quad.render(renderer);
      src = this.renderTargetsVertical[i];
    }
    const cm = this.compositeMaterial;
    cm.uniforms.bloomStrength.value = BLOOM.strength;
    cm.uniforms.bloomRadius.value = BLOOM.radius;
    this.quad.material = cm;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    this.quad.render(renderer);
    renderer.setClearColor(this.oldClear, oldAlpha);
    renderer.autoClear = oldAutoClear;
    return this.renderTargetsHorizontal[0].texture;
  }

  override dispose(): void {
    super.dispose();
    this.quad.dispose();
  }
}

/** Canvas output: the scene clamped to display white plus the glow (both already display-encoded). */
function outputMaterial(): THREE.RawShaderMaterial {
  return new THREE.RawShaderMaterial({
    name: 'BloomOutput',
    uniforms: { tScene: { value: null }, tBloom: { value: null }, sceneMix: { value: 1 }, tAO: { value: null }, aoMix: { value: 0 } },
    vertexShader: /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,
    fragmentShader: /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform float sceneMix;
uniform sampler2D tAO;
uniform float aoMix;
varying vec2 vUv;
void main() {
	vec3 s = min( texture2D( tScene, vUv ).rgb, vec3( 1.0 ) );
	if ( aoMix > 0.0 ) s *= mix( 1.0, texture2D( tAO, vUv ).r, aoMix );
	vec3 b = texture2D( tBloom, vUv ).rgb;
	// Belt and braces (see bright()): never let a bad value through to the canvas.
	if ( !( s.r + s.g + s.b >= 0.0 ) ) s = vec3( 0.0 );
	if ( !( b.r + b.g + b.b >= 0.0 ) || !( b.r + b.g + b.b < 3000.0 ) ) b = vec3( 0.0 );
	gl_FragColor = vec4( sceneMix * s + b, 1.0 );
}`,
    depthTest: false,
    depthWrite: false,
  });
}

const QUAD_VERT = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

/** View position from a depth-buffer value (through the inverse projection). */
const VIEW_POS = /* glsl */ `
uniform sampler2D tDepth;
uniform mat4 projInv;
float depthAt( vec2 uv ) { return texture2D( tDepth, uv ).x; }
vec3 viewPos( vec2 uv, float d ) {
	vec4 v = projInv * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
	return v.xyz / v.w;
}`;

/** Half-res AO: SSAO_SAMPLES taps on a rotated golden-angle spiral (per-pixel interleaved-gradient rotation, which
 *  the blur removes) within SSAO.radius m; each tap occludes by the cosine between the normal and the direction to it,
 *  fading out with distance (no dark halos from far-behind geometry). Normals from depth: per axis the neighbour with
 *  the smaller depth step, so silhouettes don't smear. */
const SSAO_FRAG = /* glsl */ `
precision highp float;
${VIEW_POS}
uniform vec2 depthTexel;
uniform vec2 aoSize;
uniform float projY;
uniform float radius;
uniform float bias;
uniform float maxPx;
uniform float fadeNear;
uniform float fadeFar;
uniform float intensity;
varying vec2 vUv;
void main() {
	// a half-res pixel centre sits on a full-res texel corner: snap to one texel centre, so the centre and its
	// neighbours are always four different depth texels (else a neighbour can be the centre itself: a zero edge,
	// a garbage normal, rows of false occlusion)
	vec2 uv = ( floor( vUv / depthTexel ) + 0.5 ) * depthTexel;
	float d = depthAt( uv );
	if ( d >= 1.0 ) { gl_FragColor = vec4( 1.0 ); return; }
	vec3 P = viewPos( uv, d );
	vec2 dx = vec2( depthTexel.x, 0.0 );
	vec2 dy = vec2( 0.0, depthTexel.y );
	vec3 pl = viewPos( uv - dx, depthAt( uv - dx ) );
	vec3 pr = viewPos( uv + dx, depthAt( uv + dx ) );
	vec3 pd = viewPos( uv - dy, depthAt( uv - dy ) );
	vec3 pu = viewPos( uv + dy, depthAt( uv + dy ) );
	vec3 ex = abs( pr.z - P.z ) < abs( P.z - pl.z ) ? pr - P : P - pl;
	vec3 ey = abs( pu.z - P.z ) < abs( P.z - pd.z ) ? pu - P : P - pd;
	vec3 N = normalize( cross( ex, ey ) );
	float dist = -P.z;
	float px = min( radius * projY * 0.5 * aoSize.y / max( dist, 0.1 ), maxPx );
	if ( px < 1.0 ) { gl_FragColor = vec4( 1.0 ); return; }
	vec2 ruv = vec2( px ) / aoSize;
	float rot = 6.2831853 * fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
	float r2 = radius * radius;
	float occ = 0.0;
	for ( int i = 0; i < ${SSAO_SAMPLES}; i ++ ) {
		float t = ( float( i ) + 0.5 ) / ${SSAO_SAMPLES}.0;
		float a = rot + float( i ) * 2.399963;
		vec2 suv = uv + vec2( cos( a ), sin( a ) ) * sqrt( t ) * ruv;
		vec3 v = viewPos( suv, depthAt( suv ) ) - P;
		float vv = dot( v, v );
		float c = dot( v, N ) * inversesqrt( vv + 1e-6 );
		occ += max( c - bias - 0.002 * dist, 0.0 ) * ( 1.0 - smoothstep( 0.5 * r2, r2, vv ) );
	}
	float ao = clamp( 1.0 - intensity * occ / ${SSAO_SAMPLES}.0, 0.0, 1.0 );
	ao = mix( ao, 1.0, smoothstep( fadeNear, fadeFar, dist ) );
	gl_FragColor = vec4( ao, ao, ao, 1.0 );
}`;

/** Separable 9-tap blur of the AO, weighted down across depth steps (bilateral-ish; reads the full-res depth). */
const SSAO_BLUR_FRAG = /* glsl */ `
precision highp float;
${VIEW_POS}
uniform sampler2D tAO;
uniform vec2 dir;
varying vec2 vUv;
void main() {
	float z0 = -viewPos( vUv, depthAt( vUv ) ).z;
	float sum = 0.0;
	float wsum = 0.0;
	for ( int i = -4; i <= 4; i ++ ) {
		vec2 uv = vUv + dir * float( i );
		float z = -viewPos( uv, depthAt( uv ) ).z;
		float w = exp( -float( i * i ) / 10.0 ) / ( 1.0 + 40.0 * abs( z - z0 ) / max( z0, 0.1 ) );
		sum += texture2D( tAO, uv ).r * w;
		wsum += w;
	}
	float ao = sum / max( wsum, 1e-4 );
	gl_FragColor = vec4( ao, ao, ao, 1.0 );
}`;

/** The SSAO passes (half-res AO, blur across, blur down); built only where SSAO may run. */
class AOPass {
  private readonly a: THREE.WebGLRenderTarget;
  private readonly b: THREE.WebGLRenderTarget;
  readonly ao: THREE.RawShaderMaterial;
  readonly blur: THREE.RawShaderMaterial;
  private readonly quad = new FullScreenQuad();
  private readonly oldClear = new THREE.Color();

  constructor() {
    const rt = () => {
      const t = new THREE.WebGLRenderTarget(2, 2, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false });
      t.texture.name = 'post.ssao';
      t.texture.generateMipmaps = false;
      return t;
    };
    this.a = rt();
    this.b = rt();
    const common = () => ({ tDepth: { value: null }, projInv: { value: new THREE.Matrix4() } });
    this.ao = new THREE.RawShaderMaterial({
      name: 'SSAO',
      uniforms: {
        ...common(), depthTexel: { value: new THREE.Vector2() }, aoSize: { value: new THREE.Vector2() }, projY: { value: 1 },
        radius: { value: SSAO.radius }, bias: { value: SSAO.bias }, maxPx: { value: SSAO.maxPx }, fadeNear: { value: SSAO.fadeNear }, fadeFar: { value: SSAO.fadeFar },
        intensity: { value: SSAO.intensity },
      },
      vertexShader: QUAD_VERT, fragmentShader: SSAO_FRAG, depthTest: false, depthWrite: false,
    });
    this.blur = new THREE.RawShaderMaterial({
      name: 'SSAOBlur',
      uniforms: { ...common(), tAO: { value: null }, dir: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VERT, fragmentShader: SSAO_BLUR_FRAG, depthTest: false, depthWrite: false,
    });
  }

  /** AO of the frame in `depth` (the scene target's resolved depth, w x h) seen through `camera`; returns the
   *  blurred half-res AO. */
  render(r: THREE.WebGLRenderer, depth: THREE.DepthTexture, camera: THREE.Camera, w: number, h: number): THREE.Texture {
    const hw = Math.max(2, w >> 1);
    const hh = Math.max(2, h >> 1);
    if (this.a.width !== hw || this.a.height !== hh) {
      this.a.setSize(hw, hh);
      this.b.setSize(hw, hh);
    }
    const cam = camera as THREE.PerspectiveCamera;
    const u = this.ao.uniforms;
    u.tDepth.value = depth;
    (u.projInv.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    (u.depthTexel.value as THREE.Vector2).set(1 / w, 1 / h);
    (u.aoSize.value as THREE.Vector2).set(hw, hh);
    u.projY.value = cam.projectionMatrix.elements[5];
    u.radius.value = SSAO.radius;
    u.bias.value = SSAO.bias;
    u.maxPx.value = SSAO.maxPx;
    u.fadeNear.value = SSAO.fadeNear;
    u.fadeFar.value = SSAO.fadeFar;
    u.intensity.value = SSAO.intensity;
    const bu = this.blur.uniforms;
    bu.tDepth.value = depth;
    (bu.projInv.value as THREE.Matrix4).copy(cam.projectionMatrixInverse);
    r.getClearColor(this.oldClear);
    const oldAlpha = r.getClearAlpha();
    const oldAutoClear = r.autoClear;
    r.autoClear = false;
    this.quad.material = this.ao;
    r.setRenderTarget(this.a);
    this.quad.render(r);
    this.quad.material = this.blur;
    bu.tAO.value = this.a.texture;
    (bu.dir.value as THREE.Vector2).set(1 / hw, 0);
    r.setRenderTarget(this.b);
    this.quad.render(r);
    bu.tAO.value = this.b.texture;
    (bu.dir.value as THREE.Vector2).set(0, 1 / hh);
    r.setRenderTarget(this.a);
    this.quad.render(r);
    r.setClearColor(this.oldClear, oldAlpha);
    r.autoClear = oldAutoClear;
    return this.a.texture;
  }

  dispose(): void {
    this.a.dispose();
    this.b.dispose();
    this.ao.dispose();
    this.blur.dispose();
    this.quad.dispose();
  }
}

/** Geometry like FullScreenQuad's (position + uv only), for compiling the chain's materials (warm-up). */
function quadGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  return g;
}

class Post {
  private scene: THREE.WebGLRenderTarget;
  private readonly bloom: Bloom;
  private readonly out = outputMaterial();
  private readonly quad = new FullScreenQuad(this.out);
  private readonly size = new THREE.Vector2();
  private readonly antialias: boolean;
  private bw = 0;
  private bh = 0;
  /** Warm-up stand-ins (never drawn): the chain's offscreen materials and the canvas output, built here so a warm-up
   *  creates no objects (three's UUIDs draw Math.random). */
  private readonly warmCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly warmGeo = quadGeometry();
  private readonly warmChain = new THREE.Group();
  private readonly warmOut: THREE.Mesh;
  /** SSAO passes (HIGH quality: configureBloom's ssao), built the first time look.ssao asks for them; their warm-up
   *  stand-ins live in warmAO. */
  private ao: AOPass | null = null;
  private readonly warmAO = new THREE.Group();
  /** SSAO allowed by the quality preset. */
  ssaoAllowed = false;
  brawl = false;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.antialias = !!renderer.getContextAttributes()?.antialias;
    renderer.getDrawingBufferSize(this.size);
    this.scene = this.sceneTarget(this.size.x, this.size.y);
    const b = this.bloomSize();
    this.bloom = new Bloom(b.w, b.h);
    this.bw = b.w;
    this.bh = b.h;
    const bl = this.bloom;
    for (const m of [bl.materialHighPassFilter, ...bl.separableBlurMaterials, bl.compositeMaterial]) this.warmChain.add(new THREE.Mesh(this.warmGeo, m));
    this.warmOut = new THREE.Mesh(this.warmGeo, this.out);
  }

  /** Run `fn` under the scene pass's render state (tone mapping + target, see render()), restored before returning.
   *  Uses the target as it is: no sync(), so nothing is resized or re-created outside a frame. */
  withScenePass<T>(fn: () => T): T {
    const r = this.renderer;
    const tone = r.toneMapping;
    const prev = r.getRenderTarget();
    r.toneMapping = tone === THREE.NoToneMapping ? tone : THREE.CustomToneMapping;
    r.setRenderTarget(this.scene);
    try {
      return fn();
    } finally {
      r.toneMapping = tone;
      r.setRenderTarget(prev);
    }
  }

  /** Compile the chain's programs under the state each pass draws with: bright / blur / composite into an offscreen
   *  (non-XR, linear) bloom target, the output quad onto the canvas. */
  compileChain(compile: (obj: THREE.Object3D, camera: THREE.Camera) => Promise<unknown>): Promise<unknown>[] {
    const r = this.renderer;
    const prev = r.getRenderTarget();
    const jobs: Promise<unknown>[] = [];
    try {
      r.setRenderTarget(this.bloom.renderTargetBright);
      jobs.push(compile(this.warmChain, this.warmCam));
      if (this.warmAO.children.length) jobs.push(compile(this.warmAO, this.warmCam));
      r.setRenderTarget(null);
      jobs.push(compile(this.warmOut, this.warmCam));
    } finally {
      r.setRenderTarget(prev);
    }
    return jobs;
  }

  /** `depth`: attach a depth texture (resolved with the colour) for the SSAO pass. */
  private sceneTarget(w: number, h: number, depth = false): THREE.WebGLRenderTarget {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedInt101111Type,
      format: THREE.RGBFormat,
      samples: sceneSamples(w, h, this.antialias),
      depthBuffer: true,
      stencilBuffer: false,
      resolveDepthBuffer: depth,
      // float depth: 24-bit integer depth steps read as tiny ledges at mid range (AO bands across the floor)
      depthTexture: depth ? new THREE.DepthTexture(w, h, THREE.FloatType) : null,
    });
    rt.texture.name = 'post.scene';
    // Materials render into this target as they would into the canvas (tone mapping + sRGB output), see the header.
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    (rt as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
    return rt;
  }

  private bloomSize(): { w: number; h: number } {
    const el = this.renderer.domElement;
    const pr = this.renderer.getPixelRatio();
    return bloomResolution(el.width / pr, el.height / pr, this.brawl);
  }

  /** Follow renderer.setSize / setPixelRatio (resize, quality, Brawl) without hooking them. */
  private sync(depth: boolean): void {
    const { x, y } = this.renderer.getDrawingBufferSize(this.size);
    if (depth !== !!this.scene.depthTexture) {
      this.scene.dispose();
      this.scene = withPrivateRandom(() => this.sceneTarget(x, y, depth));
    } else if (this.scene.width !== x || this.scene.height !== y) {
      if (this.scene.samples !== sceneSamples(x, y, this.antialias)) {
        this.scene.dispose();
        this.scene = this.sceneTarget(x, y, depth);
      } else this.scene.setSize(x, y);
    }
    const b = this.bloomSize();
    if (b.w !== this.bw || b.h !== this.bh) {
      this.bloom.setSize(b.w, b.h);
      this.bw = b.w;
      this.bh = b.h;
    }
  }

  /** Build the SSAO passes (and their warm-up stand-ins) if the preset allows them; dropped when it doesn't. */
  syncAO(): void {
    if (this.ssaoAllowed && look.ssao && !this.ao) {
      withPrivateRandom(() => {
        const ao = (this.ao = new AOPass());
        this.warmAO.add(new THREE.Mesh(this.warmGeo, ao.ao), new THREE.Mesh(this.warmGeo, ao.blur));
      });
    } else if (!this.ssaoAllowed && this.ao) {
      this.ao.dispose();
      this.ao = null;
      this.warmAO.clear();
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;
    this.syncAO();
    const ao = this.ao && look.ssao ? this.ao : null;
    this.sync(!!ao);
    const tone = r.toneMapping;
    r.toneMapping = tone === THREE.NoToneMapping ? tone : THREE.CustomToneMapping;
    r.setRenderTarget(this.scene);
    try {
      r.render(scene, camera);
    } finally {
      r.toneMapping = tone;
    }
    const aoTex = ao ? ao.render(r, this.scene.depthTexture!, camera, this.scene.width, this.scene.height) : null;
    const aoMix = lookStrength().ssao;
    const glow = this.bloom.renderGlow(r, this.scene, aoTex, aoMix);
    const u = this.out.uniforms;
    u.tAO.value = aoTex;
    u.aoMix.value = aoTex ? aoMix : 0;
    if (bloomDebug.view === 'ao' && aoTex) {
      // debug: the blurred AO alone
      u.tScene.value = aoTex;
      u.tBloom.value = null;
      u.sceneMix.value = 1;
      u.aoMix.value = 0;
      r.setRenderTarget(null);
      this.quad.render(r);
      return;
    }
    const bright = bloomDebug.view === 'bright';
    u.tScene.value = this.scene.texture;
    u.tBloom.value = bright ? this.bloom.renderTargetBright.texture : glow;
    u.sceneMix.value = bright ? 0 : 1;
    r.setRenderTarget(null);
    this.quad.render(r);
  }

  dispose(): void {
    this.scene.dispose();
    this.ao?.dispose();
    this.bloom.dispose();
    this.out.dispose();
    this.quad.dispose();
    this.warmGeo.dispose();
  }
}

/** Debug: 'bright' shows only what passes the threshold, 'ao' the SSAO alone (from the console: import('/src/render/post.ts')). */
export const bloomDebug = { view: 'final' as 'final' | 'bright' | 'ao' };

const posts = new WeakMap<THREE.WebGLRenderer, Post>();
const active = new WeakSet<THREE.WebGLRenderer>();

/** Turn bloom on / off for this renderer (settings.ts: HIGH quality + Bloom setting) and pick the Brawl budget.
 *  `ssao`: the preset allows the screen-space AO (it runs while render/look.ts ssao is on, on this path only). */
export function configureBloom(renderer: THREE.WebGLRenderer, on: boolean, brawl: boolean, ssao = false): void {
  let p = posts.get(renderer);
  if (!on || !renderer.extensions.has('EXT_color_buffer_float') || !installBloomChunk()) {
    active.delete(renderer);
    if (p) {
      p.dispose();
      posts.delete(renderer);
    }
    return;
  }
  if (!p) posts.set(renderer, (p = new Post(renderer)));
  p.brawl = brawl;
  p.ssaoAllowed = ssao;
  p.syncAO();
  active.add(renderer);
}

/** The frame's render call: the bloom pipeline when configured, else a plain renderer.render() to the canvas. */
export function renderFrame(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  const p = active.has(renderer) ? posts.get(renderer) : undefined;
  if (p) p.render(scene, camera);
  else renderer.render(scene, camera);
}

/** Warm-up (render/warmup.ts): run `fn` under the frame's scene-pass state, the bloom target + tone mapping when bloom
 *  is on, else the plain canvas state. `fn` must be synchronous; the state is restored before this returns. */
export function withScenePass<T>(renderer: THREE.WebGLRenderer, fn: () => T): T {
  const p = active.has(renderer) ? posts.get(renderer) : undefined;
  return p ? p.withScenePass(fn) : fn();
}

/** Warm-up: compile jobs for the bloom chain's own programs (they are outside the scene); none when bloom is off. */
export function compileBloomChain(renderer: THREE.WebGLRenderer, compile: (obj: THREE.Object3D, camera: THREE.Camera) => Promise<unknown>): Promise<unknown>[] {
  const p = active.has(renderer) ? posts.get(renderer) : undefined;
  return p ? p.compileChain(compile) : [];
}
