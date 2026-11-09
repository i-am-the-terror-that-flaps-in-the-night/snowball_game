import { afterEach, describe, expect, it, vi } from 'vitest';

const KEY = 'snowplow-showdown-settings-v1';

/** settings.ts reads localStorage once at import, so each case re-imports it fresh. */
async function loadWith(raw: string | null) {
  vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: (k: string) => (k === KEY ? raw : null), setItem: () => {} });
  return (await import('../src/core/settings')).settings;
}

afterEach(() => vi.unstubAllGlobals());

describe('settings', () => {
  it('defaults when nothing is stored', async () => {
    expect(await loadWith(null)).toEqual({ master: 1, music: 1, sfx: 1, shake: 1, reduceShake: false, quality: 'high', reduceFlash: false, bloom: true, ultCam: true, snowKit: {}, keys: {} });
  });

  it('defaults on corrupted storage', async () => {
    expect((await loadWith('{oops')).quality).toBe('high');
  });

  it('clamps volumes, validates quality and drops unknown key bindings', async () => {
    const s = await loadWith(JSON.stringify({ master: 2, music: -1, sfx: 'loud', shake: 0.5, quality: 'ultra', keys: { notAnAction: 'KeyQ' } }));
    expect(s.master).toBe(1);
    expect(s.music).toBe(0);
    expect(s.sfx).toBe(1);
    expect(s.shake).toBe(0.5);
    expect(s.quality).toBe('high');
    expect(s.keys).toEqual({});
  });

  it('the ultimate kill-cam defaults on and turns off only when stored false', async () => {
    expect((await loadWith(JSON.stringify({}))).ultCam).toBe(true);
    expect((await loadWith(JSON.stringify({ ultCam: false }))).ultCam).toBe(false);
    expect((await loadWith(JSON.stringify({ ultCam: 0 }))).ultCam).toBe(true);
  });

  it('loads reduceFlash only when it is literally true', async () => {
    expect((await loadWith(JSON.stringify({ reduceFlash: true }))).reduceFlash).toBe(true);
    expect((await loadWith(JSON.stringify({ reduceFlash: 'yes' }))).reduceFlash).toBe(false);
  });

  it('loads reduceShake only when it is literally true, and it scales the shake down', async () => {
    expect((await loadWith(JSON.stringify({ reduceShake: true }))).reduceShake).toBe(true);
    expect((await loadWith(JSON.stringify({ reduceShake: 1 }))).reduceShake).toBe(false);
    const { shakeScale, REDUCED_SHAKE } = await import('../src/core/settings');
    expect(shakeScale({ shake: 0.8, reduceShake: false })).toBeCloseTo(0.8, 6);
    expect(shakeScale({ shake: 0.8, reduceShake: true })).toBeCloseTo(0.8 * REDUCED_SHAKE, 6);
    expect(REDUCED_SHAKE).toBeLessThan(0.5);
  });

  it('keeps valid bindings and low quality', async () => {
    const { ACTIONS } = await import('../src/core/input');
    const a = ACTIONS[0].id;
    const s = await loadWith(JSON.stringify({ quality: 'low', keys: { [a]: 'KeyZ' } }));
    expect(s.quality).toBe('low');
    expect(s.keys).toEqual({ [a]: 'KeyZ' });
  });
});

describe('quality presets', () => {
  it('round-trips every tier and keeps the default object unchanged', async () => {
    for (const q of ['low', 'medium', 'high', 'auto'] as const) expect((await loadWith(JSON.stringify({ quality: q }))).quality).toBe(q);
    expect((await loadWith(JSON.stringify({ quality: 'ULTRA' }))).quality).toBe('high');
    expect((await loadWith(JSON.stringify({ quality: 3 }))).quality).toBe('high');
    expect((await loadWith(null)).quality).toBe('high');
  });

  it('never writes the resolved AUTO tier into the saved settings', async () => {
    let saved = '';
    vi.resetModules();
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ quality: 'auto' }), setItem: (_k: string, v: string) => (saved = v) });
    const m = await import('../src/core/settings');
    m.reportAutoFrameTime(40);
    m.saveSettings();
    expect(JSON.parse(saved).quality).toBe('auto');
    expect(m.effectiveTier()).toBe('high'); // nothing resolved before the renderer is known
    expect(m.qualityLabel()).toBe('AUTO · HIGH');
  });

  it("preset('high') is the game's long-standing constants", async () => {
    const { preset, pixelRatioFor } = await import('../src/core/settings');
    expect(preset('high')).toEqual({
      pixelRatioCap: 2, brawlPixelRatioCap: 1.5, shadows: true, shadowMapSize: 2048, brawlShadowMapSize: 1024, bloom: true,
      hideFlashLights: false, fxScale: 1, lensGrab: true, weatherScale: 1, dropHaze: false, crowdFraction: 1,
    });
    // Old formula: min(dpr, brawl ? 1.5 : 2).
    for (const dpr of [0.75, 1, 1.25, 1.5, 2, 3]) for (const b of [false, true]) expect(pixelRatioFor(preset('high'), dpr, b)).toBe(Math.min(dpr, b ? 1.5 : 2));
  });

  it("preset('medium') is HIGH with 1024 shadows, no bloom and a 1.5x cap", async () => {
    const { preset } = await import('../src/core/settings');
    expect(preset('medium')).toEqual({ ...preset('high'), pixelRatioCap: 1.5, shadowMapSize: 1024, bloom: false });
  });

  it("preset('low') cuts every lever", async () => {
    const { preset, pixelRatioFor } = await import('../src/core/settings');
    const hi = preset('high');
    const lo = preset('low');
    expect(pixelRatioFor(lo, 2, false)).toBe(1);
    expect(pixelRatioFor(lo, 2, true)).toBe(1);
    expect(lo.shadows).toBe(false);
    expect(lo.bloom).toBe(false);
    expect(lo.hideFlashLights).toBe(true);
    expect(lo.fxScale).toBeLessThan(hi.fxScale);
    expect(lo.lensGrab).toBe(false);
    expect(lo.weatherScale).toBeLessThan(hi.weatherScale);
    expect(lo.dropHaze).toBe(true);
    expect(lo.crowdFraction).toBeLessThan(hi.crowdFraction);
  });

  it('scales particle counts exactly at 1 and never to zero', async () => {
    const { scaleCount } = await import('../src/core/settings');
    for (const n of [0, 1, 7, 24, 400]) expect(scaleCount(n, 1)).toBe(n);
    expect(scaleCount(24, 0.5)).toBe(12);
    expect(scaleCount(1, 0.5)).toBe(1);
    expect(scaleCount(0, 0.5)).toBe(0);
  });

  it('weather: HIGH keeps the layers as they are, LOW halves them and drops the haze', async () => {
    const { weatherLayers, scaleWeatherLayers, HAZE_SIZE } = await import('../src/world/biomes/Weather');
    const dust = weatherLayers('dust', 0.5);
    expect(scaleWeatherLayers(dust, 1, false)).toBe(dust);
    const low = scaleWeatherLayers(dust, 0.5, true);
    expect(low.every((l) => l.size < HAZE_SIZE)).toBe(true);
    expect(low.length).toBe(dust.length - 1);
    expect(low[0].count).toBe(Math.round(dust[0].count / 2));
    expect(dust[0].count).toBe(Math.round(1800 + 0.5 * 4000)); // input untouched
    const steam = scaleWeatherLayers(weatherLayers('steam', 0.5), 0.5, true);
    expect(steam.some((l) => l.size >= HAZE_SIZE)).toBe(false);
  });

  it('guesses a first AUTO tier from the renderer string', async () => {
    const { guessTier } = await import('../src/core/settings');
    expect(guessTier('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)')).toBe('low');
    expect(guessTier('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('low');
    expect(guessTier('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('low');
    expect(guessTier('Mali-G57 MC2')).toBe('low');
    expect(guessTier('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('medium');
    expect(guessTier('AMD Custom GPU 0405 (vangogh, LLVM 15.0.7, DRM 3.49, 6.1.52-valve9-1-neptune-61)')).toBe('medium');
    expect(guessTier('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high');
    expect(guessTier('')).toBe('high');
  });

  it('AUTO steps with hysteresis and never climbs back to a tier that was too slow', async () => {
    const { autoStep, AUTO_DOWN_MS, AUTO_UP_MS } = await import('../src/core/settings');
    const hold = (AUTO_DOWN_MS + AUTO_UP_MS) / 2;
    let s = { tier: 'high' as const, ceiling: 'high' as const } as Parameters<typeof autoStep>[0];
    expect(autoStep(s, hold)).toBe(s); // dead band: no change
    expect(autoStep(s, 10)).toBe(s); // already at the top
    s = autoStep(s, AUTO_DOWN_MS + 5);
    expect(s).toEqual({ tier: 'medium', ceiling: 'medium' });
    expect(autoStep(s, 10)).toEqual(s); // HIGH was too slow: stay on MEDIUM even when fast
    s = autoStep(s, 40);
    expect(s).toEqual({ tier: 'low', ceiling: 'low' });
    expect(autoStep(s, 60)).toEqual(s); // floor
    // A low first guess (e.g. a weak GPU string) can climb while frames stay fast.
    let g = { tier: 'low', ceiling: 'high' } as Parameters<typeof autoStep>[0];
    g = autoStep(g, AUTO_UP_MS - 1);
    expect(g.tier).toBe('medium');
    g = autoStep(g, AUTO_UP_MS - 1);
    expect(g.tier).toBe('high');
    expect(autoStep(g, hold)).toBe(g);
  });

  it('AUTO: a 30 fps display / power-saver cap is not "slow"; frames clearly slower than the cap still are', async () => {
    const { autoStep, AUTO_CAP_SLACK } = await import('../src/core/settings');
    const s = { tier: 'high' as const, ceiling: 'high' as const } as Parameters<typeof autoStep>[0];
    expect(autoStep(s, 33.3, 33.3)).toBe(s); // locked at a 30 Hz cap: hold
    expect(autoStep(s, 33.3, 33.3 * AUTO_CAP_SLACK - 0.5)).toBe(s);
    expect(autoStep(s, 50, 33.3).tier).toBe('medium'); // missing the cap: step down
    expect(autoStep(s, 30, 16.7).tier).toBe('medium'); // 60 Hz display, 30 ms frames: step down as before
  });

  it('AUTO sampler skips the first frames and reports one median per arena', async () => {
    const { AutoSampler, AUTO_SKIP_FRAMES, AUTO_SAMPLE_FRAMES } = await import('../src/core/settings');
    const a = new AutoSampler();
    let got: number | null = null;
    for (let i = 0; i < AUTO_SKIP_FRAMES; i++) expect(a.push(1000)).toBeNull();
    for (let i = 0; i < AUTO_SAMPLE_FRAMES; i++) got = a.push(i % 2 ? 30 : 10) ?? got;
    expect(got).toBe(20);
    expect(a.push(5)).toBeNull();
    a.reset();
    expect(a.push(5)).toBeNull();
  });

  it('crowd subsample: deterministic, evenly spread, and never draws RNG', async () => {
    const { crowdKeep } = await import('../src/world/environment/layout');
    expect(crowdKeep(10, 1)).toBeNull();
    expect(crowdKeep(10, 0.5)).toEqual([1, 3, 5, 7, 9]);
    expect(crowdKeep(3000, 0.5)!.length).toBe(1500);
    expect(crowdKeep(3000, 0.5)).toEqual(crowdKeep(3000, 0.5));
  });

  it('LOW thins the Snowdome crowd after the HIGH list is built: flags, the crowd list and the RNG stream are unchanged', async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    const THREE = await import('three');
    const { settings } = await import('../src/core/settings');
    const { VenueScenery } = await import('../src/world/environment/VenueScenery');
    const { STYLES } = await import('../src/world/environment/styles');
    const { mulberry32 } = await import('../src/world/environment/layout');
    type Rec = { mat: unknown; items: { x: number; z: number; ry: number; color?: number }[] };
    // 'rally' also exercises the rally caps, whose colours draw RNG per figure inside flushCrowd.
    const build = (q: 'high' | 'low', theme: string) => {
      settings.quality = q;
      const env = Object.create(VenueScenery.prototype) as Record<string, unknown>;
      const insts: Rec[] = [];
      Object.assign(env, {
        rnd: mulberry32(1234),
        style: STYLES.brawl,
        zone: { theme },
        biome: null,
        crowd: null,
        bobTime: { value: 0 },
        bobAmp: { value: 0.2 },
        inst: (_g: unknown, mat: unknown, items: Rec['items']) => (insts.push({ mat, items: items.map((i) => ({ ...i })) }), null),
        bakeItems: () => {},
        sponsorAtlas: () => new THREE.Texture(),
        buildTowers: () => {},
        buildDomeScreens: () => {},
        buildDomeTunnels: () => {},
        buildDomeRig: () => {},
      });
      (env.buildSnowdome as (z: unknown, g: number) => void).call(env, {}, 0);
      const beforeFlush = insts.length;
      const fullCrowd = ((env.crowd as { items: Rec['items'] }).items).map((i) => ({ ...i }));
      (env.flushCrowd as () => void).call(env);
      const afterRnd = (env.rnd as () => number)();
      return { scenery: insts.slice(0, beforeFlush), crowdBody: insts[beforeFlush].items, fullCrowd, afterRnd };
    };
    try {
      for (const theme of ['brawl', 'rally']) {
        const hi = build('high', theme);
        const lo = build('low', theme);
        // Everything built before the crowd flush (tiers, seats, poles, FLAGS...) is identical.
        expect(lo.scenery.map((r) => r.items)).toEqual(hi.scenery.map((r) => r.items));
        // The full crowd list is the HIGH one; HIGH draws all of it, LOW an every-other subset of it.
        expect(lo.fullCrowd).toEqual(hi.fullCrowd);
        expect(hi.crowdBody).toEqual(hi.fullCrowd);
        expect(lo.crowdBody.length).toBe(Math.floor(hi.fullCrowd.length / 2));
        expect(lo.crowdBody).toEqual(hi.fullCrowd.filter((_, i) => i % 2 === 1));
        // Same RNG position afterwards: anything built later is unaffected.
        expect(lo.afterRnd).toBe(hi.afterRnd);
      }
    } finally {
      settings.quality = 'high';
    }
  });
});
