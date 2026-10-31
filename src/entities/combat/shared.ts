import * as THREE from 'three';
import type { EnemyHandle, EnemyManagerAPI, GameContext, ImpactKind, ImpactOpts, PlowAPI } from '../../core/types';
import type { Lightning } from '../../fx/Lightning';
import type { PilotBinding } from '../pilot';

/** Scratch vectors shared by every combat module (never held across calls). */
export const _p = new THREE.Vector3();
export const _q = new THREE.Vector3();
export const _fwd = new THREE.Vector3();
export const _tip = new THREE.Vector3();

/** Wrap an angle into (-PI, PI]. */
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export type UltKind = 'volt' | 'brute' | 'arsenal';

/** What the per-plow kits need back from Combat: the bound pilot, the shared meter and the shared hit pipeline. */
export interface CombatHost {
  readonly ctx: GameContext;
  /** Current pilot binding (changes on Combat.bind). */
  readonly b: PilotBinding;
  readonly lightning: Lightning;
  readonly threat: Threat;
  /** The shared ultimate meter 0..1 (Critical Mass / FIRESTORM / ultimates; one net field). */
  crit: number;
  /** No VOLT-9 / BRUTUS / ARSENAL ultimate is playing out. */
  readonly ultIdle: boolean;
  startUlt(kind: UltKind, plow: PlowAPI): void;
  shake(intensity: number): void;
  impactHit(kind: ImpactKind, pos: THREE.Vector3, strength?: number, opts?: ImpactOpts): void;
  smashProps(x: number, z: number, r: number): void;
  /** Snapshot of enemies overlapping a circle (copied: damage() may mutate manager lists), in Combat's shared
   *  target buffer: call clearTargets() when done with it. */
  collect(x: number, z: number, radius: number): EnemyHandle[];
  clearTargets(): void;
  hitMult(e: EnemyHandle): number;
  lastStandMult(): number;
  onPlayerHit(dealt: number, killed: boolean, target?: EnemyHandle, canChain?: boolean, heal?: boolean): void;
}

/** Base for the per-plow kits: short-hands onto the host so ability code reads like it did inside Combat. */
export abstract class Kit {
  constructor(protected readonly h: CombatHost) {}
  protected get b(): PilotBinding {
    return this.h.b;
  }
  protected get ctx(): GameContext {
    return this.h.ctx;
  }
  protected get lightning(): Lightning {
    return this.h.lightning;
  }
  protected shake(intensity: number): void {
    this.h.shake(intensity);
  }
  protected impactHit(kind: ImpactKind, pos: THREE.Vector3, strength?: number, opts?: ImpactOpts): void {
    this.h.impactHit(kind, pos, strength, opts);
  }
  protected smashProps(x: number, z: number, r: number): void {
    this.h.smashProps(x, z, r);
  }
  protected collect(x: number, z: number, radius: number): EnemyHandle[] {
    return this.h.collect(x, z, radius);
  }
  protected clearTargets(): void {
    this.h.clearTargets();
  }
  protected hitMult(e: EnemyHandle): number {
    return this.h.hitMult(e);
  }
  protected lastStandMult(): number {
    return this.h.lastStandMult();
  }
  protected onPlayerHit(dealt: number, killed: boolean, target?: EnemyHandle, canChain = true, heal = true): void {
    this.h.onPlayerHit(dealt, killed, target, canChain, heal);
  }
}

/** Threat: damage each bot dealt you, decaying with this time constant (s). A hit is credited to the nearest bot
 *  within THREAT_RADIUS of where it came from. */
const THREAT_TAU = 10;
const THREAT_RADIUS = 6;

/** Recent damage each bot dealt a pilot (decays; ARSENAL targeting reads it). */
export class Threat {
  private map = new Map<EnemyHandle, number>();
  private buf: EnemyHandle[] = [];

  add(e: EnemyHandle, dmg: number): void {
    this.map.set(e, (this.map.get(e) ?? 0) + dmg);
  }

  /** Credit `dmg` to the bot nearest to where a hit came from, for callers that don't name the attacker. */
  note(enemies: EnemyManagerAPI | undefined, fromX: number, fromZ: number, dmg: number): void {
    if (!enemies) return;
    const q = enemies.query(fromX, fromZ, THREAT_RADIUS, this.buf);
    let best: EnemyHandle | null = null;
    let bestD = Infinity;
    for (let i = 0; i < q.length; i++) {
      const e = q[i];
      if (!e.alive) continue;
      const d = Math.hypot(e.position.x - fromX, e.position.z - fromZ) - e.radius;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (best) this.add(best, dmg);
  }

  update(dt: number): void {
    if (this.map.size === 0) return;
    const k = Math.exp(-dt / THREAT_TAU);
    for (const [e, v] of this.map) {
      const nv = v * k;
      if (!e.alive || nv < 0.5) this.map.delete(e);
      else this.map.set(e, nv);
    }
  }

  of(e: EnemyHandle): number {
    return this.map.get(e) ?? 0;
  }

  /** ARSENAL target priority: bots that have been hurting you first, then wounded ones, then close ones. */
  score(e: EnemyHandle, x: number, z: number): number {
    const d = Math.hypot(e.position.x - x, e.position.z - z);
    return 3 * this.of(e) + 10 * (1 - Math.max(0, e.hp) / Math.max(1, e.maxHp)) + 20 / (1 + d / 10);
  }

  clear(): void {
    this.map.clear();
  }
}
