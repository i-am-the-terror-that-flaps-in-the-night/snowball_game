import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

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
 * single-sampled and the pixel density (DPR >= 1.5) does the anti-aliasing. */

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
varying vec2 vUv;
vec3 bright( vec2 uv ) {
	vec3 c = texture2D( tDiffuse, uv ).rgb;
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
    this.materialHighPassFilter.fragmentShader = BRIGHT_FRAG;
    this.materialHighPassFilter.uniforms = this.hp;
    this.materialHighPassFilter.needsUpdate = true;
  }

  /** Returns the texture holding the composited glow (at half the bloom resolution). */
  renderGlow(renderer: THREE.WebGLRenderer, input: THREE.WebGLRenderTarget): THREE.Texture {
    renderer.getClearColor(this.oldClear);
    const oldAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);
    this.hp.tDiffuse.value = input.texture;
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
    uniforms: { tScene: { value: null }, tBloom: { value: null }, sceneMix: { value: 1 } },
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
varying vec2 vUv;
void main() {
	vec3 s = min( texture2D( tScene, vUv ).rgb, vec3( 1.0 ) );
	gl_FragColor = vec4( sceneMix * s + texture2D( tBloom, vUv ).rgb, 1.0 );
}`,
    depthTest: false,
    depthWrite: false,
  });
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
  brawl = false;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.antialias = !!renderer.getContextAttributes()?.antialias;
    renderer.getDrawingBufferSize(this.size);
    this.scene = this.sceneTarget(this.size.x, this.size.y);
    const b = this.bloomSize();
    this.bloom = new Bloom(b.w, b.h);
    this.bw = b.w;
    this.bh = b.h;
  }

  private sceneTarget(w: number, h: number): THREE.WebGLRenderTarget {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedInt101111Type,
      format: THREE.RGBFormat,
      samples: sceneSamples(w, h, this.antialias),
      depthBuffer: true,
      stencilBuffer: false,
      resolveDepthBuffer: false,
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
  private sync(): void {
    const { x, y } = this.renderer.getDrawingBufferSize(this.size);
    if (this.scene.width !== x || this.scene.height !== y) {
      if (this.scene.samples !== sceneSamples(x, y, this.antialias)) {
        this.scene.dispose();
        this.scene = this.sceneTarget(x, y);
      } else this.scene.setSize(x, y);
    }
    const b = this.bloomSize();
    if (b.w !== this.bw || b.h !== this.bh) {
      this.bloom.setSize(b.w, b.h);
      this.bw = b.w;
      this.bh = b.h;
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const r = this.renderer;
    this.sync();
    const tone = r.toneMapping;
    r.toneMapping = tone === THREE.NoToneMapping ? tone : THREE.CustomToneMapping;
    r.setRenderTarget(this.scene);
    try {
      r.render(scene, camera);
    } finally {
      r.toneMapping = tone;
    }
    const glow = this.bloom.renderGlow(r, this.scene);
    const u = this.out.uniforms;
    const bright = bloomDebug.view === 'bright';
    u.tScene.value = this.scene.texture;
    u.tBloom.value = bright ? this.bloom.renderTargetBright.texture : glow;
    u.sceneMix.value = bright ? 0 : 1;
    r.setRenderTarget(null);
    this.quad.render(r);
  }

  dispose(): void {
    this.scene.dispose();
    this.bloom.dispose();
    this.out.dispose();
    this.quad.dispose();
  }
}

/** Debug: 'bright' shows only what passes the threshold (from the console: import('/src/render/post.ts')). */
export const bloomDebug = { view: 'final' as 'final' | 'bright' };

const posts = new WeakMap<THREE.WebGLRenderer, Post>();
const active = new WeakSet<THREE.WebGLRenderer>();

/** Turn bloom on / off for this renderer (settings.ts: HIGH quality + Bloom setting) and pick the Brawl budget. */
export function configureBloom(renderer: THREE.WebGLRenderer, on: boolean, brawl: boolean): void {
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
  active.add(renderer);
}

export function bloomActive(renderer: THREE.WebGLRenderer): boolean {
  return active.has(renderer);
}

/** The frame's render call: the bloom pipeline when configured, else a plain renderer.render() to the canvas. */
export function renderFrame(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  const p = active.has(renderer) ? posts.get(renderer) : undefined;
  if (p) p.render(scene, camera);
  else renderer.render(scene, camera);
}
