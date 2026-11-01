import * as THREE from 'three';
import type { EnemyHandle, EnemyManagerAPI, GameContext, ImpactKind, ImpactOpts, PlowAPI } from '../../core/types';
import type { Lightning } from '../../fx/Lightning';
import type { PilotBinding } from '../pilot';
import type { Terrain } from '../../world/Terrain';

/** Scratch vectors shared by every combat module (never held across calls). */
export const _p = new THREE.Vector3();
export const _q = new THREE.Vector3();
export const _fwd = new THREE.Vector3();
export const _tip = new THREE.Vector3();

/** Wrap an angle into (-PI, PI]. */
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export type UltKind = 'volt' | 'brute' | 'arsenal';

/* ------------------------------------------------------------------ height rules (level overhaul, 3D combat)
 * Every ground attack only hits targets near the attacker's height. Two flavours:
 *   - BODY hits (rams, dash strikes, whirl, flame cone, saws, Tesla field, bot / boss melee): feet-to-feet,
 *     heightOk(attackerY, targetY, HIT_BAND) (+ a little for huge bosses).
 *   - WAVE hits (slam shockwave, Inferno fireball, Thunderclap, Ground Pound, meltdown, quakes, boss pounds / spins /
 *     swipes / leap landings): the wave runs along the floor on the attacker's level, so the target must stand on
 *     it: heightOk(floor under the target, targetY, WAVE_BAND). A plow more than WAVE_BAND above the ground clears a
 *     shockwave; a bot on a deck above you, or flying, is not hit by your slam. An attacker in the air blasts at its
 *     own height (feet-to-feet). On flat arenas the floor is 0 (no terrain query at all). */

/** Feet-to-feet band (m) for body hits. */
export const HIT_BAND = 2.2;
/** Height (m) above the floor a target must clear to hop over a ground shockwave. */
export const WAVE_BAND = 1.2;
/** NUKE / big blasts reach higher above the floor (m). */
export const BLAST_BAND = 3;

/** The height rule: is a target with feet at `targetY` within `band` metres of the attacker's height `attackerY`? */
export function heightOk(attackerY: number, targetY: number, band = HIT_BAND): boolean {
  const d = targetY - attackerY;
  return d <= band && d >= -band;
}

/** Body band for an attacker / target of collision radius r: huge bosses are tall, so they reach a bit higher. */
export function bodyBand(r: number): number {
  return HIT_BAND + Math.max(0, r - 1.2) * 0.5;
}

/** Floor height a ground attack launched from feet height `fromY` has at (x, z): the ground, or a deck on the
 *  attacker's level (Terrain.heightAt ignores decks above fromY + STEP_UP). 0 on flat arenas. Sets
 *  terrain.heightDeck (the deck id of that floor, -1 = ground). */
export function waveFloor(t: Terrain | undefined, fromY: number, x: number, z: number): number {
  return t && t.active ? t.heightAt(x, z, fromY) : 0;
}

/** Top of what lies at (x, z) on the level of feet height `fromY`: a deck top, or the snow top on the ground (where
 *  shattered balls, sprays and slam rings start). Just the snow depth on flat arenas. */
export function floorTop(t: Terrain | undefined, snow: { getDepth(x: number, z: number): number } | null | undefined, fromY: number, x: number, z: number): number {
  const f = waveFloor(t, fromY, x, z);
  if (t && t.active && t.heightDeck >= 0) return f;
  return f + (snow ? snow.getDepth(x, z) : 0);
}

/** Does a ground wave from an attacker (feet `fromY`, airborne?) reach a target standing at (x, z) with feet `targetY`?
 *  `fromDeck`: the deck the attacker stands on (-1 = the ground). A wave started on a deck runs along that deck (and
 *  any floor level with it): it does not spill over the deck's edge onto the ground below, or onto a lower deck. */
export function waveHits(
  t: Terrain | undefined, fromY: number, fromAir: boolean, x: number, z: number, targetY: number, band = WAVE_BAND, fromDeck = -1,
): boolean {
  if (fromAir) return heightOk(fromY, targetY, Math.max(band, HIT_BAND));
  const floor = waveFloor(t, fromY, x, z);
  if (fromDeck >= 0 && t && t.active && t.heightDeck !== fromDeck && !heightOk(fromY, floor, WAVE_BAND)) return false;
  return heightOk(floor, targetY, band);
}

/** Where a PERSISTENT ground attack (FIRESTORM burning ground, NUKE / meltdown pools, the EARTHQUAKE's later rings)
 *  judges height from: the floor under the plow when it was cast, fixed for the attack's life (driving off a ramp
 *  afterwards does not lift the fire off the ground). */
export interface CastOrigin {
  /** Floor height (m) at the cast point. */
  y: number;
  /** Deck id of that floor (-1 = the ground). */
  deck: number;
}

/** Fill `out` with the floor under `plow` right now (0 / ground for scripted plows without terrain fields). */
export function castOrigin(plow: PlowAPI, out: CastOrigin): CastOrigin {
  out.y = Number.isFinite(plow.surfaceY) ? plow.surfaceY : 0;
  out.deck = typeof plow.deck === 'number' ? plow.deck : -1;
  return out;
}

/**
 * A bot's NON-contact hit on the player's plow (boss ground shockwaves that already passed their own wave check,
 * THE DONALD's reflected / thrown hits): same damage scaling as EnemyManager.hitPlow, but sent without an `attacker`
 * so Combat.hitPlow skips the feet-to-feet body band (that band is for blades and bodies touching). The hit is still
 * credited to the nearest bot (Combat's threat note). Returns the damage dealt.
 */
export function waveHitPlow(
  ctx: GameContext,
  e: { readonly position: THREE.Vector3; readonly dmgOutMult: number },
  dmg: number,
  opts?: { knockback?: number; unblockable?: boolean; fromX?: number; fromZ?: number },
): number {
  const combat = ctx.combat;
  const plow = ctx.plow;
  if (!combat || !plow || plow.dead) return 0;
  return combat.hitPlow(dmg * e.dmgOutMult * (ctx.zone.enemyDmgMult ?? 1), opts?.fromX ?? e.position.x, opts?.fromZ ?? e.position.z, {
    knockback: opts?.knockback,
    unblockable: opts?.unblockable,
  });
}

/** How a player attack filters its targets by height (Combat.collect): none, body (feet-to-feet) or ground wave. */
export const Reach = { Any: 0, Body: 1, Wave: 2, Blast: 3 } as const;
export type Reach = (typeof Reach)[keyof typeof Reach];

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
  collect(x: number, z: number, radius: number, reach?: Reach, from?: CastOrigin): EnemyHandle[];
  /** Height rule for one target vs the bound plow (see Reach), or vs a fixed cast origin `from` (persistent ground
   *  attacks: Wave / Blast judge from that floor, never from the plow's live height). */
  reaches(e: EnemyHandle, reach: Reach, from?: CastOrigin): boolean;
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
  protected collect(x: number, z: number, radius: number, reach: Reach = Reach.Any, from?: CastOrigin): EnemyHandle[] {
    return this.h.collect(x, z, radius, reach, from);
  }
  protected reaches(e: EnemyHandle, reach: Reach, from?: CastOrigin): boolean {
    return this.h.reaches(e, reach, from);
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
