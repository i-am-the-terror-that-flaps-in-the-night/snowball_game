import { describe, expect, it, afterEach } from 'vitest';
import * as THREE from 'three';
import { LOOK_STRENGTHS, look, lookPreset, setLook } from '../src/render/look';
import { applyBakedAO, bakedAOUniforms, paletteEligible, Palette } from '../src/render/palette';
import { AO_ATTRIBUTE, AO_INSTANCE_ATTRIBUTE, AO_TAG, bakeOcclusion, bakedAOTexture } from '../src/render/bakedAO';
import { hemiRadiance } from '../src/render/arenaEnv';
import { StaticBatch } from '../src/render/mergeStatic';
import { getPaintEnvMap } from '../src/render/reflections';
import { withPrivateRandom } from '../src/render/privateRandom';

afterEach(() => setLook('off', 'strong'));

describe('art pass look switches (render/look.ts)', () => {
  it('ships env + SSAO + contact by default (baked AO off) and the presets switch the parts', () => {
    expect({ env: look.env, bakedAO: look.bakedAO, ssao: look.ssao, contact: look.contact }).toEqual(lookPreset('ssao'));
    expect(lookPreset('env')).toEqual({ env: true, bakedAO: false, ssao: false, contact: false });
    expect(lookPreset('baked')).toEqual({ env: true, bakedAO: true, ssao: false, contact: true });
    expect(lookPreset('ssao')).toEqual({ env: true, bakedAO: false, ssao: true, contact: true });
    expect(lookPreset('all')).toEqual({ env: true, bakedAO: true, ssao: true, contact: true });
  });

  it('pushes the baked AO strength into the shared uniforms (0 = off)', () => {
    setLook('baked', 'subtle');
    expect(bakedAOUniforms.uBakedAO.value).toBe(LOOK_STRENGTHS.subtle.bakedAO);
    setLook('baked', 'strong');
    expect(bakedAOUniforms.uBakedAO.value).toBe(LOOK_STRENGTHS.strong.bakedAO);
    setLook('env');
    expect(bakedAOUniforms.uBakedAO.value).toBe(0);
  });

  it('strong is stronger than subtle on every lever', () => {
    const s = LOOK_STRENGTHS.subtle;
    const g = LOOK_STRENGTHS.strong;
    for (const k of ['envShare', 'detail', 'specular', 'bakedAO', 'ssao', 'contact'] as const) expect(g[k]).toBeGreaterThan(s[k]);
  });

  it('paints take the arena map (scene.environment) while the arena reflections are on', () => {
    setLook('env');
    expect(getPaintEnvMap({} as THREE.WebGLRenderer)).toBeNull();
  });
});

describe('arena environment map (render/arenaEnv.ts)', () => {
  it("a + b*y radiance gives the hemisphere light's irradiance after the cosine convolution", () => {
    const sky = new THREE.Color(0.9, 0.8, 0.7);
    const ground = new THREE.Color(0.3, 0.35, 0.4);
    const a = new THREE.Color();
    const b = new THREE.Color();
    hemiRadiance(sky, ground, 0.85, 0.6, a, b);
    // E(n) = PI a + (2 PI / 3) b n.y; three's hemisphere light: mix(ground, sky, (n.y + 1) / 2) * I
    const E = (ny: number, c: 'r' | 'g' | 'b') => Math.PI * a[c] + ((2 * Math.PI) / 3) * b[c] * ny;
    for (const c of ['r', 'g', 'b'] as const) {
      expect(E(1, c)).toBeCloseTo(sky[c] * 0.85 * 0.6, 6);
      expect(E(-1, c)).toBeCloseTo(ground[c] * 0.85 * 0.6, 6);
      expect(E(0, c)).toBeCloseTo(((sky[c] + ground[c]) / 2) * 0.85 * 0.6, 6);
    }
  });

  it('withPrivateRandom leaves the gameplay stream alone', () => {
    const r = Math.random;
    let calls = 0;
    Math.random = () => (calls++, 0.5);
    try {
      withPrivateRandom(() => new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
      expect(calls).toBe(0);
    } finally {
      Math.random = r;
    }
  });
});

describe('baked corner occlusion (render/bakedAO.ts + palette.ts applyBakedAO)', () => {
  it('patches a standard material once; the patched material is no longer a palette source', () => {
    const m = new THREE.MeshStandardMaterial({ color: 0x808080 });
    expect(paletteEligible(m, { side: THREE.FrontSide, flatShading: false })).toBe(true);
    expect(applyBakedAO(m)).toBe(true);
    const ob = m.onBeforeCompile;
    expect(applyBakedAO(m)).toBe(true);
    expect(m.onBeforeCompile).toBe(ob);
    expect(m.customProgramCacheKey()).toBe('bakedAO');
    expect(paletteEligible(m, { side: THREE.FrontSide, flatShading: false })).toBe(false);
    // already customised / not standard: left alone
    const c = new THREE.MeshStandardMaterial();
    c.onBeforeCompile = () => {};
    expect(applyBakedAO(c)).toBe(false);
    expect(applyBakedAO(new THREE.MeshBasicMaterial())).toBe(false);
    // the palette material can carry it (it is the destination material)
    const p = new Palette({ bakedAO: true });
    expect(p.material.customProgramCacheKey()).toBe('bakedAO');
    p.dispose();
  });

  it('the patch reads the attribute only behind its tag and multiplies the lighting', () => {
    const m = new THREE.MeshStandardMaterial();
    applyBakedAO(m);
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.physical.vertexShader,
      fragmentShader: THREE.ShaderLib.physical.fragmentShader,
    };
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('abs( aoDark.x - 0.5 ) < 0.01');
    expect(shader.vertexShader).toContain('texelFetch( uBakedAOTex');
    expect(shader.fragmentShader).toContain('reflectedLight.indirectDiffuse *= bao;');
    expect(shader.uniforms.uBakedAO).toBe(bakedAOUniforms.uBakedAO);
  });

  it('a corner next to a wall is darker than open ground; values carry the tag', () => {
    // a 1 m floor tile in the open, and one against a 3 m wall
    const open = new THREE.PlaneGeometry(1, 1, 2, 2).rotateX(-Math.PI / 2).translate(10, 0.01, 0);
    const corner = new THREE.PlaneGeometry(1, 1, 2, 2).rotateX(-Math.PI / 2).translate(0, 0.01, 0.6);
    const wall = new THREE.BoxGeometry(6, 3, 0.4).translate(0, 1.5, 0);
    bakeOcclusion([open, corner], {}, [open, corner, wall]);
    const mean = (g: THREE.BufferGeometry) => {
      const a = g.getAttribute(AO_ATTRIBUTE);
      let s = 0;
      for (let i = 0; i < a.count; i++) {
        expect(a.getX(i)).toBe(AO_TAG);
        s += a.getY(i);
      }
      return s / a.count;
    };
    expect(mean(open)).toBe(0);
    expect(mean(corner)).toBeGreaterThan(0.1);
  });

  it('static instanced meshes get one value per instance vertex in the shared texture', () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial(), 3);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 3; i++) im.setMatrixAt(i, m.makeTranslation(i * 1.2, 0.5, 0));
    bakeOcclusion([], {}, [], [im]);
    const tex = bakedAOTexture.value!;
    expect(tex).toBeTruthy();
    const attr = geo.getAttribute(AO_INSTANCE_ATTRIBUTE) as THREE.InstancedBufferAttribute;
    expect(attr.count).toBe(3);
    const V = geo.getAttribute('position').count;
    for (let i = 0; i < 3; i++) expect([attr.getX(i), attr.getY(i)]).toEqual([AO_TAG, i * V]);
    // the bottom vertices (on the ground) are occluded, the middle box's sides more than the end ones' outer sides
    const data = tex.image.data as Uint8Array;
    expect(Math.max(...data.subarray(0, 3 * V))).toBeGreaterThan(64);
  });

  it('StaticBatch.flush(ao) bakes the attribute into lit buckets and patches their material', () => {
    const batch = new StaticBatch();
    const mat = new THREE.MeshStandardMaterial({ color: 0x777777 });
    const basic = new THREE.MeshBasicMaterial();
    const box = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.Matrix4();
    batch.add(box, m.makeTranslation(0, 0.5, 0), mat);
    batch.add(box, m.makeTranslation(1.1, 0.5, 0), mat);
    batch.add(box, m.makeTranslation(3, 0.5, 0), basic);
    const out = batch.flush(undefined, {});
    const lit = out.find((o) => o.material === mat)!;
    const unlit = out.find((o) => o.material === basic)!;
    expect(lit.geometry.getAttribute(AO_ATTRIBUTE)).toBeTruthy();
    expect(unlit.geometry.getAttribute(AO_ATTRIBUTE)).toBeUndefined();
    expect(mat.customProgramCacheKey()).toBe('bakedAO');
  });
});
