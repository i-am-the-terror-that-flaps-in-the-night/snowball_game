import * as THREE from 'three';
import { AO_TEX_WIDTH, bakedAOTexture } from './bakedAO';

/* Shared "palette" material: many static, untextured, opaque MeshStandardMaterials collapsed into ONE material so
 * their parts can merge into one draw. Each source material becomes a texel in three small DataTextures:
 *   map          = color                       (material.color stays white)
 *   emissiveMap  = emissive * emissiveIntensity (material.emissive white, intensity 1)
 *   roughnessMap = .g roughness, metalnessMap = .b metalness (same texture; material roughness = metalness = 1)
 * and a part picks its entry through a constant per-vertex uv (the texel centre). Textures are FloatType (the same
 * float32 the uniforms carry), NearestFilter, no mipmaps, NoColorSpace (values are linear working-space numbers),
 * so the shader computes white * texel = the original uniform: the same lighting maths as the source materials,
 * only the program differs (built-in material features only, so it carries over to WebGPURenderer; there
 * HalfFloatType may be needed if float32 textures turn out unfilterable, at the cost of ~1/2048 relative error).
 *
 * Eligible sources (paletteEligible): MeshStandardMaterial (not Physical) with no textures, opaque (opacity 1,
 * no alphaTest / transparent), not vertex-coloured, default onBeforeCompile, same side / flatShading / fog /
 * toneMapped / wireframe as the palette, and NOT changed at runtime (hit flashes, pulses and per-entity paint need
 * their own material). One Palette per (side, flatShading) variant. */

/** Baked corner occlusion (render/bakedAO.ts), shared by every patched material: darkening at full occlusion, and the
 *  share of it applied to direct light (0 = ambient / reflections only, like an aoMap). 0 strength = off, same program. */
export const bakedAOUniforms = { uBakedAO: { value: 0 }, uBakedAODirect: { value: 0 } };

const BAKED_AO = Symbol('bakedAO');

/** Multiply the baked occlusion (bakedAO.ts: the per-vertex AO_ATTRIBUTE of merged geometry, or for instanced meshes
 *  the shared occlusion texture indexed by AO_INSTANCE_ATTRIBUTE + gl_VertexID) into a standard material's lighting. For the
 *  DESTINATION material of merged static geometry (a palette's material, or a static batch's bucket material): a
 *  material with this patch is no longer a palette source (paletteEligible rejects custom onBeforeCompile), which is
 *  why it goes on the material the parts are merged INTO. Indirect light (ambient, environment) takes the full
 *  occlusion, direct light uBakedAODirect of it. Meshes without the attribute are untouched (see bakedAO.ts). One
 *  program variant per patched material kind (customProgramCacheKey). False (no patch) for materials that already
 *  customise their shader. */
export function applyBakedAO(m: THREE.Material): boolean {
  const s = m as THREE.MeshStandardMaterial & { [BAKED_AO]?: true };
  if (s[BAKED_AO]) return true;
  if (!s.isMeshStandardMaterial || s.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return false;
  if (s.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey) return false;
  s[BAKED_AO] = true;
  s.onBeforeCompile = (shader) => {
    shader.uniforms.uBakedAO = bakedAOUniforms.uBakedAO;
    shader.uniforms.uBakedAODirect = bakedAOUniforms.uBakedAODirect;
    shader.uniforms.uBakedAOTex = bakedAOTexture;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aoDark;
varying float vBakedAO;
#ifdef USE_INSTANCING
attribute vec2 aoInst;
uniform sampler2D uBakedAOTex;
#endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vBakedAO = abs( aoDark.x - 0.5 ) < 0.01 ? aoDark.y : 0.0;
#ifdef USE_INSTANCING
if ( abs( aoInst.x - 0.5 ) < 0.01 ) {
	int aoK = int( aoInst.y + 0.5 ) + gl_VertexID;
	vBakedAO = texelFetch( uBakedAOTex, ivec2( aoK % ${AO_TEX_WIDTH}, aoK / ${AO_TEX_WIDTH} ), 0 ).r;
}
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBakedAO;\nuniform float uBakedAODirect;\nvarying float vBakedAO;')
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
	{
		float bao = 1.0 - uBakedAO * vBakedAO;
		float bad = mix( 1.0, bao, uBakedAODirect );
		reflectedLight.indirectDiffuse *= bao;
		reflectedLight.indirectSpecular *= bao;
		reflectedLight.directDiffuse *= bad;
		reflectedLight.directSpecular *= bad;
	}`,
      );
  };
  s.customProgramCacheKey = () => 'bakedAO';
  s.needsUpdate = true;
  return true;
}

export interface PaletteOptions {
  /** Entries per texture side (size * size entries). Default 16. */
  size?: number;
  side?: THREE.Side;
  flatShading?: boolean;
  type?: THREE.TextureDataType;
  /** Patch the palette material for baked occlusion (applyBakedAO; the merged geometry carries the attribute). */
  bakedAO?: boolean;
}

type Source = THREE.MeshStandardMaterial;

export function paletteEligible(m: THREE.Material, p: { side: THREE.Side; flatShading: boolean }): m is Source {
  const s = m as Source;
  if (!s.isMeshStandardMaterial || (s as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) return false;
  if (s.transparent || s.opacity !== 1 || s.alphaTest > 0 || s.alphaHash || s.vertexColors || s.wireframe) return false;
  if (s.side !== p.side || s.flatShading !== p.flatShading || !s.fog || !s.toneMapped || s.envMap) return false;
  if (s.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile || s.clippingPlanes?.length) return false;
  if (s.blending !== THREE.NormalBlending || !s.depthTest || !s.depthWrite || !s.colorWrite || s.polygonOffset || s.dithering) return false;
  if (s.shadowSide !== null || s.envMapIntensity !== 1) return false;
  return !Object.values(s).some((v) => (v as THREE.Texture | null)?.isTexture);
}

export class Palette {
  readonly material: THREE.MeshStandardMaterial;
  readonly size: number;
  private readonly color: THREE.DataTexture;
  private readonly emissive: THREE.DataTexture;
  private readonly rm: THREE.DataTexture;
  private readonly keys = new Map<string, number>();

  constructor(opts: PaletteOptions = {}) {
    this.size = opts.size ?? 16;
    const n = this.size * this.size * 4;
    const type = opts.type ?? THREE.FloatType;
    const tex = () => {
      const data = type === THREE.HalfFloatType ? new Uint16Array(n) : new Float32Array(n);
      const t = new THREE.DataTexture(data, this.size, this.size, THREE.RGBAFormat, type);
      t.minFilter = t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.NoColorSpace;
      t.needsUpdate = true;
      return t;
    };
    this.color = tex();
    this.emissive = tex();
    this.rm = tex();
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1, roughness: 1, metalness: 1,
      map: this.color, emissiveMap: this.emissive, roughnessMap: this.rm, metalnessMap: this.rm,
      side: opts.side ?? THREE.FrontSide, flatShading: opts.flatShading ?? false,
    });
    this.material.name = 'palette';
    if (opts.bakedAO) applyBakedAO(this.material);
  }

  get count(): number {
    return this.keys.size;
  }

  /** Texel index for this source material's look (deduped by value). */
  entry(m: Source): number {
    const e = m.emissive.clone().multiplyScalar(m.emissiveIntensity);
    const key = `${m.color.r},${m.color.g},${m.color.b}|${e.r},${e.g},${e.b}|${m.roughness},${m.metalness}`;
    let i = this.keys.get(key);
    if (i !== undefined) return i;
    i = this.keys.size;
    if (i >= this.size * this.size) throw new Error('Palette full');
    this.keys.set(key, i);
    const put = (t: THREE.DataTexture, r: number, g: number, b: number) => {
      const d = t.image.data as Float32Array | Uint16Array;
      const v = d instanceof Uint16Array ? [r, g, b, 1].map(THREE.DataUtils.toHalfFloat) : [r, g, b, 1];
      d.set(v, i! * 4);
      t.needsUpdate = true;
    };
    put(this.color, m.color.r, m.color.g, m.color.b);
    put(this.emissive, e.r, e.g, e.b);
    put(this.rm, 0, m.roughness, m.metalness);
    return i;
  }

  /** uv of entry `i` (texel centre). */
  uv(i: number, out = new THREE.Vector2()): THREE.Vector2 {
    return out.set(((i % this.size) + 0.5) / this.size, (Math.floor(i / this.size) + 0.5) / this.size);
  }

  /** Point every vertex of `g` at the entry for `m` (overwrites / adds the uv attribute, in place). */
  apply(g: THREE.BufferGeometry, m: Source): THREE.BufferGeometry {
    const uv = this.uv(this.entry(m));
    const n = g.getAttribute('position').count;
    const a = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) (a[k * 2] = uv.x), (a[k * 2 + 1] = uv.y);
    g.setAttribute('uv', new THREE.BufferAttribute(a, 2));
    return g;
  }

  dispose(): void {
    this.material.dispose();
    this.color.dispose();
    this.emissive.dispose();
    this.rm.dispose();
  }
}
