import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BLOOM_SCALE,
  BLOOM_SCALE_BRAWL,
  EXCESS_LUM,
  MSAA_MAX_PIXELS,
  bloomResolution,
  hdrExcess,
  installBloomChunk,
  sceneSamples,
} from '../src/render/post';

describe('bloom post', () => {
  it('sizes the bloom chain from the CSS size, cheaper in Brawl', () => {
    expect(bloomResolution(1920, 1080, false)).toEqual({ w: Math.round(1920 * BLOOM_SCALE), h: Math.round(1080 * BLOOM_SCALE) });
    const b = bloomResolution(1920, 1080, true);
    expect(b).toEqual({ w: Math.round(1920 * BLOOM_SCALE_BRAWL), h: Math.round(1080 * BLOOM_SCALE_BRAWL) });
    expect(b.w).toBeLessThan(bloomResolution(1920, 1080, false).w);
    expect(bloomResolution(0, 0, false)).toEqual({ w: 2, h: 2 });
  });

  it('multisamples the scene target only when the canvas has MSAA and the buffer is not huge', () => {
    expect(sceneSamples(1920, 1080, true)).toBe(4);
    expect(sceneSamples(1920, 1080, false)).toBe(0);
    expect(sceneSamples(3840, 2160, true)).toBe(0);
    expect(2880 * 1620).toBeGreaterThan(MSAA_MAX_PIXELS); // Brawl at 1.5x on a 1080p window
    expect(2560 * 1440).toBeLessThanOrEqual(MSAA_MAX_PIXELS);
  });

  it('lit snow and the sky carry no HDR excess; emissives and HDR FX do', () => {
    // Sun 2.5 + hemisphere 0.9 on white snow peaks at ~0.85 linear luminance.
    expect(hdrExcess(0.85, 0.85, 0.85)).toEqual([0, 0, 0]);
    expect(hdrExcess(EXCESS_LUM, EXCESS_LUM, EXCESS_LUM)).toEqual([0, 0, 0]);
    // VOLT-9 coil: emissive 0x2fb8ff x1.5 plus its lit 0x9fe8ff base.
    const coil = hdrExcess(0.34, 1.7, 2.3);
    expect(Math.min(...coil)).toBeGreaterThan(0);
    // Hue is kept: the excess is a scaled copy of the colour.
    expect(coil[2] / coil[1]).toBeCloseTo(2.3 / 1.7, 6);
  });

  it("replaces three's identity CustomToneMapping with ACES + excess, once", () => {
    expect(installBloomChunk()).toBe(true);
    const src = THREE.ShaderChunk.tonemapping_pars_fragment;
    expect(src).not.toContain('vec3 CustomToneMapping( vec3 color ) { return color; }');
    expect(src).toMatch(/vec3 CustomToneMapping\( vec3 color \) \{[^}]*ACESFilmicToneMapping\( color \)/);
    expect(installBloomChunk()).toBe(true);
    expect(THREE.ShaderChunk.tonemapping_pars_fragment).toBe(src);
  });
});
