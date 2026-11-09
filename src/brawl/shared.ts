import * as THREE from 'three';
import type { BrawlEntry, EnemyHandle } from '../core/types';
import type { BRAWL_PERSONALITIES } from '../config/brawl';
import type { UpgradeId } from '../config/upgrades';
import type { Rival } from './rival';

/* Snowdome Brawl: shared types, rival tuning constants and helpers (split out of BrawlManager.ts). */

/** How a hit landed (kill feed icon): 'zap' = VOLT-9 lightning, 'pound' = BRUTUS Ground Pound. */
export type Method = 'slam' | 'ram' | 'dash' | 'whirl' | 'wall' | 'zap' | 'pound' | 'other';
export type Personality = (typeof BRAWL_PERSONALITIES)[number];
export type Mode = 'gather' | 'fight' | 'heal' | 'flee';

// Rival kit. Base numbers (speed 10.5, accel 14, turn 2.6, collect 0.13, ball 1.4m, ram 14, dash +16 m/s every
// 2.6s, whirl 4m+blade / 10 dmg every 6s) live in BrawlManager.rivalStats(), scaled per lobby and per rival.
/** Rival speed (m/s, driving or knockback) above which it smashes destructible props rather than bumping off. */
export const RIVAL_PROP_SMASH_SPEED = 9;
export const RIVAL_R = 1.6;
export const RIVAL_MASS = 1.5;
export const SLAM_MIN_R = 0.55;
export const SLAM_WIND = 0.22;
export const SLAM_CD = 0.7;
export const DASH_T = 0.5;
export const WHIRL_T = 0.9;
export const WHIRL_TICKS = [0.1, 0.35, 0.6, 0.85];
export const SHIELD_COS = 0.5;
export const COCOA_MAX = 6;
export const COCOA_EVERY = 12;
export const COCOA_HEAL = 40;
export const KILL_CREDIT_WINDOW = 6;
export const HEARING = 70;
/** Terrain: rival hull height (ceiling bonks / deck walls), ice grip linger (s). */
export const RIVAL_HEIGHT = 2.4;
export const RIVAL_ICE_LINGER = 0.4;

export const _cam = new THREE.Vector3();
export const EMPTY: readonly EnemyHandle[] = [];

export const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const clamp = THREE.MathUtils.clamp;
export const pick = <T>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface Fighter {
  entry: BrawlEntry;
  rival: Rival | null;
  lastHitBy: Fighter | null;
  lastHitAt: number;
  lastHitMethod: Method;
}

/** Per-rival kit: the rival's own rolled garage levels (see rivalStats) through the player's FX curves. */
export interface RivalStats {
  elite: boolean;
  maxSpeed: number;
  accel: number;
  turn: number;
  collect: number;
  maxBall: number;
  maxBallVol: number;
  ramBase: number;
  dashPower: number;
  dashCd: number;
  whirlR: number;
  whirlDmg: number;
  whirlCd: number;
  dmgMult: number;
  /** Multiplier on damage taken (Reinforced Frame levels). */
  damageTaken: number;
  /** HP regenerated per second (Repair Kit levels). */
  hpRegen: number;
  skill: number;
  reaction: number;
  /** The rival's rolled garage levels (debug / tuning). */
  levels: Partial<Record<UpgradeId, number>>;
  /** Fraction of frontal damage the held ball blocks (0.4, or 0.75 with Ice Shield). */
  shieldBlock: number;
  /** Avalanche Core: wider, harder-knocking slams. */
  avalanche: boolean;
  /** Drives VOLT-9: plow stat multipliers applied, electric skin, bot Thunderclap. */
  volt: boolean;
  /** Drives BRUTUS: plow stat multipliers applied, tracked-dozer body, bot Ground Pound. */
  brute: boolean;
}

export interface Cocoa {
  root: THREE.Group;
  spin: THREE.Group;
  halo: THREE.Mesh;
  x: number;
  z: number;
  t: number;
}

export interface DebrisChunk {
  pos: THREE.Vector3;
  rot: THREE.Euler;
  scale: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  rz: number;
  life: number;
}

/** One kill's chunks of one material (the rival's paint as it was at the kill, or dark metal), one instanced draw. */
export interface Debris {
  mesh: THREE.InstancedMesh;
  /** The paint clone (owned, disposed with the batch); null for the shared dark material. */
  mat: THREE.MeshStandardMaterial | null;
  chunks: DebrisChunk[];
}
