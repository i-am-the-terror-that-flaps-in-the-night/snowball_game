import * as THREE from 'three';
import type { GameContext } from './types';
import type { PlowKind } from '../config/plows';
import { ACTIONS, type Action } from './input';
import { configureBloom } from '../render/post';

const SETTINGS_KEY = 'snowplow-showdown-settings-v1';

export type Quality = 'low' | 'high';

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
      quality: p.quality === 'low' ? 'low' : 'high',
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

let appliedQuality: Quality | null = null;
let brawlPerf = false;

/** Brawl is the competitive mode: cap the pixel ratio at 1.5 there (campaign / Survival keep up to 2x). */
export function setBrawlPerf(ctx: GameContext, on: boolean): void {
  if (on === brawlPerf) return;
  brawlPerf = on;
  if (settings.quality === 'high') {
    ctx.renderer.setPixelRatio(Math.min(window.devicePixelRatio, on ? 1.5 : 2));
    ctx.renderer.setSize(window.innerWidth, window.innerHeight);
  }
  syncBloom(ctx);
}

/** Bloom runs on HIGH only (with the Bloom setting on); Brawl gets the cheaper bloom chain. */
function syncBloom(ctx: GameContext): void {
  configureBloom(ctx.renderer, settings.quality === 'high' && settings.bloom, brawlPerf);
}

/** Low = 1x pixel ratio, no shadow maps, no bloom; High = up to 2x (1.5x in Brawl), PCF shadows and bloom. */
export function applyQuality(ctx: GameContext): void {
  const r = ctx.renderer;
  const high = settings.quality === 'high';
  r.setPixelRatio(high ? Math.min(window.devicePixelRatio, brawlPerf ? 1.5 : 2) : 1);
  r.setSize(window.innerWidth, window.innerHeight);
  if (appliedQuality !== null && appliedQuality !== settings.quality) {
    // Shadow-map on/off changes shader programs: force every material to recompile.
    ctx.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (Array.isArray(m)) for (const x of m) x.needsUpdate = true;
      else if (m) (m as THREE.Material).needsUpdate = true;
    });
  }
  r.shadowMap.enabled = high;
  r.shadowMap.needsUpdate = true;
  appliedQuality = settings.quality;
  syncBloom(ctx);
  renderHooks.afterQuality?.(ctx);
}

export function applyAllSettings(ctx: GameContext): void {
  applyAudio(ctx);
  applyBindings(ctx);
  applyQuality(ctx);
}
