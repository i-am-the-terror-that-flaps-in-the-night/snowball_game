import * as THREE from 'three';
import type { GameContext } from './types';
import type { PlowKind } from '../config/plows';
import { ACTIONS, type Action } from './input';
import { configureBloom } from '../render/post';

const SETTINGS_KEY = 'snowplow-showdown-settings-v1';

/** Graphics quality. 'auto' picks one of the three tiers itself (opt-in; HIGH is the default). */
export type Quality = 'low' | 'medium' | 'high' | 'auto';
/** A concrete quality tier (what 'auto' resolves to). */
export type QualityTier = Exclude<Quality, 'auto'>;
export const QUALITY_TIERS: readonly QualityTier[] = ['low', 'medium', 'high'];

/** Every render lever a quality tier sets. Live levers apply on a settings change (applyQuality); the arena-build
 *  ones (weather, crowd) apply from the next arena build. */
export interface QualityPreset {
  /** Pixel-ratio cap (min with devicePixelRatio), and the cap in Brawl / The Omega Works (setBrawlPerf). */
  pixelRatioCap: number;
  brawlPixelRatioCap: number;
  /** Sun shadow map on, and its size (the Brawl dome uses brawlShadowMapSize). */
  shadows: boolean;
  shadowMapSize: number;
  brawlShadowMapSize: number;
  /** Bloom allowed (it still needs the Bloom setting on). */
  bloom: boolean;
  /** Hide the impact flash point lights (a light-count change: applied on a settings change only, then warmed). */
  hideFlashLights: boolean;
  /** Multiplier on particle burst / spark / smoke / spray counts (fx/Fx.ts). */
  fxScale: number;
  /** The singularity's lensing screen grab (a second scene render); off = undistorted fallback. */
  lensGrab: boolean;
  /** Next arena build: weather particle counts multiplier, and drop the big soft haze layers (dust, steam). */
  weatherScale: number;
  dropHaze: boolean;
  /** Next arena build: share of the stadium crowd kept (subsampled after the full list is built). */
  crowdFraction: number;
}

const PRESETS: Record<QualityTier, Readonly<QualityPreset>> = {
  // HIGH = the game's long-standing constants (pixel-identical to the pre-preset build).
  high: {
    pixelRatioCap: 2, brawlPixelRatioCap: 1.5, shadows: true, shadowMapSize: 2048, brawlShadowMapSize: 1024, bloom: true,
    hideFlashLights: false, fxScale: 1, lensGrab: true, weatherScale: 1, dropHaze: false, crowdFraction: 1,
  },
  medium: {
    pixelRatioCap: 1.5, brawlPixelRatioCap: 1.5, shadows: true, shadowMapSize: 1024, brawlShadowMapSize: 1024, bloom: false,
    hideFlashLights: false, fxScale: 1, lensGrab: true, weatherScale: 1, dropHaze: false, crowdFraction: 1,
  },
  low: {
    pixelRatioCap: 1, brawlPixelRatioCap: 1, shadows: false, shadowMapSize: 1024, brawlShadowMapSize: 1024, bloom: false,
    hideFlashLights: true, fxScale: 0.5, lensGrab: false, weatherScale: 0.5, dropHaze: true, crowdFraction: 0.5,
  },
};

/** The levers of a quality tier (pure). */
export function preset(q: QualityTier): Readonly<QualityPreset> {
  return PRESETS[q];
}

/** Renderer pixel ratio for a preset. */
export function pixelRatioFor(p: Readonly<QualityPreset>, dpr: number, brawl: boolean): number {
  return Math.min(dpr, brawl ? p.brawlPixelRatioCap : p.pixelRatioCap);
}

/** Scale a particle count by fxScale (exactly `n` at scale 1; never rounds a non-zero count to 0). */
export function scaleCount(n: number, scale: number): number {
  if (scale === 1 || n <= 0) return n;
  return Math.max(1, Math.round(n * scale));
}

/** Player options (separate from the progress save so "Reset progress" never wipes them). */
export interface Settings {
  /** 0..1 volumes. */
  master: number;
  music: number;
  sfx: number;
  /** Camera shake multiplier, 0..1. */
  shake: number;
  /** Comfort: scales every camera shake / kick / landing thump / FOV punch down to REDUCED_SHAKE on top of `shake`. */
  reduceShake: boolean;
  quality: Quality;
  /** Photosensitivity: dims screen flashes, the damage vignette and impact lights. */
  reduceFlash: boolean;
  /** Bloom post-processing (HIGH quality only). */
  bloom: boolean;
  /** Slow-mo cinematic when an ultimate wipes 3+ bots. */
  ultCam: boolean;
  /** Vehicles switched to the snowball kit (SPACE slam / E whirlwind) instead of their own SPACE / E. */
  snowKit: Partial<Record<PlowKind, boolean>>;
  /** Rebound primary key per action (KeyboardEvent.code). Missing = default. */
  keys: Partial<Record<Action, string>>;
}

function defaults(): Settings {
  return { master: 1, music: 1, sfx: 1, shake: 1, reduceShake: false, quality: 'high', reduceFlash: false, bloom: true, ultCam: true, snowKit: {}, keys: {} };
}

const clamp01 = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

function load(): Settings {
  const d = defaults();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return d;
    const p = JSON.parse(raw) as Partial<Settings>;
    const keys: Partial<Record<Action, string>> = {};
    if (p.keys && typeof p.keys === 'object') {
      for (const a of ACTIONS) {
        const k = (p.keys as Record<string, unknown>)[a.id];
        if (typeof k === 'string' && k) keys[a.id] = k;
      }
    }
    return {
      master: clamp01(p.master, d.master),
      music: clamp01(p.music, d.music),
      sfx: clamp01(p.sfx, d.sfx),
      shake: clamp01(p.shake, d.shake),
      reduceShake: p.reduceShake === true,
      quality: p.quality === 'low' || p.quality === 'medium' || p.quality === 'auto' ? p.quality : 'high',
      reduceFlash: p.reduceFlash === true,
      bloom: p.bloom !== false,
      ultCam: p.ultCam !== false,
      snowKit: p.snowKit && typeof p.snowKit === 'object' ? Object.fromEntries(Object.entries(p.snowKit).filter(([, v]) => v === true)) : {},
      keys,
    };
  } catch {
    return d;
  }
}

/** Live settings; read directly by systems that need them every frame (e.g. CameraRig shake). */
export const settings: Settings = load();

/** Share of the camera shake left with "Reduce screen shake" on. */
export const REDUCED_SHAKE = 0.3;

/** Effective camera-shake multiplier: the slider, times REDUCED_SHAKE when "Reduce screen shake" is on. */
export function shakeScale(s: Pick<Settings, 'shake' | 'reduceShake'> = settings): number {
  return s.shake * (s.reduceShake ? REDUCED_SHAKE : 1);
}

/** UI flag: the settings overlay is open (gamepad Start must not unpause underneath it). */
export const settingsUi = { open: false };

export function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}

export function applyAudio(ctx: GameContext): void {
  ctx.audio.setVolumes(settings.master, settings.music, settings.sfx);
}

export function applyBindings(ctx: GameContext): void {
  ctx.input.setBindings(settings.keys);
}

/** Called after every applyQuality (quality / Bloom changes rebuild shader programs): Game re-runs its shader warm-up
 *  (render/warmup.ts) here. */
export const renderHooks: { afterQuality: ((ctx: GameContext) => void) | null } = { afterQuality: null };

/* ------------------------------------------------------------------ AUTO quality
 * Opt-in. First guess from the GPU's renderer string, then refined from the median frame time of a stretch of play
 * after the countdown (Game.frame), at most once per arena, with hysteresis, and applied at the next arena start.
 * The resolved tier lives here, never in `settings` (saveSettings serialises the whole object). */

/** Median frame time (ms) above which AUTO steps one tier down, and under which it may step one tier up. */
export const AUTO_DOWN_MS = 25;
export const AUTO_UP_MS = 18;
/** Frames skipped after an arena starts (shader warm-up, first-frame hitches), then frames sampled. */
export const AUTO_SKIP_FRAMES = 60;
export const AUTO_SAMPLE_FRAMES = 240;

/** AUTO's resolved tier, plus a ceiling: a tier that ran too slow is never climbed back to (no ping-pong). */
export interface AutoState {
  tier: QualityTier;
  ceiling: QualityTier;
}

/** First AUTO guess from the WebGL renderer string (pure): software rasterisers and known weak integrated GPUs get
 *  LOW, mid-range integrated / APU graphics MEDIUM, anything else HIGH. */
export function guessTier(renderer: string): QualityTier {
  const r = renderer.toLowerCase();
  if (/swiftshader|llvmpipe|softpipe|software|basic render|lavapipe/.test(r)) return 'low';
  if (/intel.*(hd graphics|uhd graphics(?! 7[57]0)|gma)|mali|adreno|powervr|videocore|tegra/.test(r)) return 'low';
  if (/intel.*(iris|xe|arc a3)|radeon(\(tm\))? graphics|radeon vega|vangogh|custom gpu|apple m1(?! (pro|max|ultra))/.test(r)) return 'medium';
  return 'high';
}

/** One AUTO refinement from a median frame time (pure). Slow -> one tier down and lower the ceiling; fast -> one tier
 *  up, never past the ceiling; in between -> hold. */
export function autoStep(s: AutoState, medianMs: number): AutoState {
  const i = QUALITY_TIERS.indexOf(s.tier);
  if (medianMs > AUTO_DOWN_MS && i > 0) {
    const t = QUALITY_TIERS[i - 1];
    return { tier: t, ceiling: t };
  }
  if (medianMs < AUTO_UP_MS && i < QUALITY_TIERS.indexOf(s.ceiling)) return { tier: QUALITY_TIERS[i + 1], ceiling: s.ceiling };
  return s;
}

/** Collects frame times for one AUTO decision: skips the first frames, then returns the median once enough are in
 *  (once; reset() at each arena start). */
export class AutoSampler {
  private skip = AUTO_SKIP_FRAMES;
  private samples: number[] = [];
  private done = false;

  reset(): void {
    this.skip = AUTO_SKIP_FRAMES;
    this.samples.length = 0;
    this.done = false;
  }

  /** Feed one frame time (ms); returns the median when the sample is complete, else null. */
  push(ms: number): number | null {
    if (this.done) return null;
    if (this.skip > 0) {
      this.skip--;
      return null;
    }
    this.samples.push(ms);
    if (this.samples.length < AUTO_SAMPLE_FRAMES) return null;
    this.done = true;
    const a = this.samples.slice().sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
}

let autoState: AutoState | null = null;
let autoPending: AutoState | null = null;

/** The tier the game renders at now ('auto' resolved). */
export function effectiveTier(): QualityTier {
  return settings.quality === 'auto' ? (autoState?.tier ?? 'high') : settings.quality;
}

/** The levers in effect now. */
export function currentPreset(): Readonly<QualityPreset> {
  return PRESETS[effectiveTier()];
}

/** UI label of the current quality: 'AUTO · MEDIUM' etc. for AUTO. */
export function qualityLabel(): string {
  return settings.quality === 'auto' ? `AUTO · ${effectiveTier().toUpperCase()}` : settings.quality.toUpperCase();
}

function rendererString(r: THREE.WebGLRenderer): string {
  try {
    const gl = r.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  } catch {
    return '';
  }
}

/** Game.frame: a finished AUTO frame-time sample (median, ms). The decision waits for the next arena start. */
export function reportAutoFrameTime(medianMs: number): void {
  if (settings.quality !== 'auto' || !autoState) return;
  autoPending = autoStep(autoPending ?? autoState, medianMs);
}

/** Arena start: apply a pending AUTO decision (before the arena is built, so weather / crowd follow it). No warm-up
 *  here: the arena start warms everything once it is built. */
export function commitAutoQuality(ctx: GameContext): void {
  const next = autoPending;
  autoPending = null;
  if (settings.quality !== 'auto' || !next || !autoState) return;
  const changed = next.tier !== autoState.tier;
  autoState = next;
  if (changed) applyQualityNow(ctx, false);
}

/* ------------------------------------------------------------------ apply */

let appliedShadows: boolean | null = null;
let brawlPerf = false;

/** Brawl is the competitive mode: the preset's Brawl pixel-ratio cap there (HIGH: 1.5, campaign / Survival keep up
 *  to 2x). Tiers whose two caps match leave the pixel ratio alone. */
export function setBrawlPerf(ctx: GameContext, on: boolean): void {
  if (on === brawlPerf) return;
  brawlPerf = on;
  const p = currentPreset();
  if (p.pixelRatioCap !== p.brawlPixelRatioCap) {
    ctx.renderer.setPixelRatio(pixelRatioFor(p, window.devicePixelRatio, on));
    ctx.renderer.setSize(window.innerWidth, window.innerHeight);
  }
  syncBloom(ctx);
}

/** Bloom runs where the preset allows it (HIGH) with the Bloom setting on; Brawl gets the cheaper bloom chain. */
function syncBloom(ctx: GameContext): void {
  configureBloom(ctx.renderer, currentPreset().bloom && settings.bloom, brawlPerf);
}

/** Apply the quality preset's live levers: pixel ratio, shadow map (on/off and size), bloom, the impact flash
 *  lights; then Game re-runs its shader warm-up. Weather and crowd follow at the next arena build. */
export function applyQuality(ctx: GameContext): void {
  applyQualityNow(ctx, true);
}

function applyQualityNow(ctx: GameContext, warm: boolean): void {
  const r = ctx.renderer;
  if (settings.quality === 'auto' && !autoState) {
    const t = guessTier(rendererString(r));
    autoState = { tier: t, ceiling: 'high' };
  }
  const p = currentPreset();
  r.setPixelRatio(pixelRatioFor(p, window.devicePixelRatio, brawlPerf));
  r.setSize(window.innerWidth, window.innerHeight);
  if (appliedShadows !== null && appliedShadows !== p.shadows) {
    // Shadow-map on/off changes shader programs: force every material to recompile.
    ctx.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (Array.isArray(m)) for (const x of m) x.needsUpdate = true;
      else if (m) (m as THREE.Material).needsUpdate = true;
    });
  }
  r.shadowMap.enabled = p.shadows;
  r.shadowMap.needsUpdate = true;
  appliedShadows = p.shadows;
  // Systems built after the first applyAllSettings (Game constructor) read the preset themselves.
  ctx.world?.syncShadowMapSize?.();
  ctx.impact?.setFlashLightsHidden?.(p.hideFlashLights);
  syncBloom(ctx);
  if (warm) renderHooks.afterQuality?.(ctx);
}

export function applyAllSettings(ctx: GameContext): void {
  applyAudio(ctx);
  applyBindings(ctx);
  applyQuality(ctx);
}
