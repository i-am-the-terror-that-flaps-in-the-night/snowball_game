import type { GameContext, ZoneDef } from '../core/types';
import type { Progression } from '../core/Progression';

/* STUB (scaffold) — the challenges builder replaces this file: per-arena star challenges + Hard mode. */

/** Hard-mode version of a campaign arena (tougher bots, better pay). */
export function hardZone(zone: ZoneDef): ZoneDef {
  return { ...zone };
}

/** Hard mode for an arena opens once its normal clear is done. */
export function hardUnlocked(p: Progression, zoneIndex: number): boolean {
  void p;
  void zoneIndex;
  return false;
}

/** Record a Hard-mode clear; returns the coin reward for it (Game adds the coins). */
export function recordHardClear(p: Progression, zoneIndex: number): number {
  void p;
  void zoneIndex;
  return 0;
}

/** Listens for runFinished and awards challenge stars. Constructed once by Game. */
export class ChallengeTracker {
  constructor(ctx: GameContext) {
    void ctx;
  }
}
