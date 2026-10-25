import * as THREE from 'three';
import type { GameContext } from './types';
import { ACTIONS, type Action } from './input';

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
  quality: Quality;
  /** Rebound primary key per action (KeyboardEvent.code). Missing = default. */
  keys: Partial<Record<Action, string>>;
}

function defaults(): Settings {
  return { master: 1, music: 1, sfx: 1, shake: 1, quality: 'high', keys: {} };
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
      quality: p.quality === 'low' ? 'low' : 'high',
      keys,
    };
  } catch {
    return d;
  }
}

/** Live settings; read directly by systems that need them every frame (e.g. CameraRig shake). */
export const settings: Settings = load();

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
}

/** Low = 1x pixel ratio and no shadow maps; High = up to 2x (1.5x in Brawl) and PCF shadows. */
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
}

export function applyAllSettings(ctx: GameContext): void {
  applyAudio(ctx);
  applyBindings(ctx);
  applyQuality(ctx);
}
