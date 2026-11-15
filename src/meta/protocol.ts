import type { Progression, ProtocolCheckpoint, ProtocolSave } from '../core/Progression';
import { ZONES } from '../config/zones';
import { UPGRADES, upgradeCost } from '../config/upgrades';
import { GEAR_BY_ID, gearSpent } from '../config/gear';
import { PROTOCOL_CLEAR_REWARD, PROTOCOL_FINALE, PROTOCOL_REPEAT_FRAC } from '../config/protocol';

/* PROTOCOL C meta (config/protocol.ts): the unlock rule, the clear / best-time record and the per-wave checkpoint.
 * Lives in save.protocol (validated by Progression's sanitizeProtocol on load and import). The campaign's own
 * records (unlockedZones, zones, hardCleared, challenge stars) are never touched. */

/** Unlocked once every campaign arena has been cleared on normal AND on Hard. */
export function protocolUnlocked(p: Progression): boolean {
  return ZONES.every((z) => p.zoneRecord(z.id).cleared && p.data.hardCleared?.[z.id] === true);
}

/** Does a run started at `wave` write its records (clear, best time / wave, checkpoint, clear reward)? Only with the
 *  unlock, and only from wave 1 or a saved checkpoint: a dev start (__game.startProtocol(n)) past wave 1 times only
 *  part of the rush and records nothing. */
export function protocolRecordsRun(unlocked: boolean, wave: number, fromCheckpoint: boolean): boolean {
  return unlocked && (wave <= 1 || fromCheckpoint);
}

/** The teaser: after the normal Omega clear the zone select shows a locked, glitched seventh card. */
export function protocolTeased(p: Progression): boolean {
  return p.zoneRecord(ZONES[ZONES.length - 1].id).cleared;
}

/** The save's Protocol record (a fresh one if missing). */
export function protocolSave(p: Progression): ProtocolSave {
  return (p.data.protocol ??= { cleared: false, clears: 0, bestTime: 0, bestWave: 0, cleanClear: false, checkpoint: null });
}

/** Coins the next clear pays (first clear vs repeat). */
export function protocolReward(p: Progression): number {
  return protocolSave(p).cleared ? Math.round(PROTOCOL_CLEAR_REWARD * PROTOCOL_REPEAT_FRAC) : PROTOCOL_CLEAR_REWARD;
}

export interface ProtocolClear {
  firstClear: boolean;
  reward: number;
  /** New best total time (s). */
  newBest: boolean;
  bestTime: number;
}

/** Record a clear in `time` s (fights only: shops excluded) with `uses` checkpoint retries. Saves; Game pays the coins. */
export function recordProtocolClear(p: Progression, time: number, uses: number): ProtocolClear {
  const s = protocolSave(p);
  const reward = protocolReward(p);
  const firstClear = !s.cleared;
  const t = Math.max(0, Math.round(time * 10) / 10);
  const newBest = s.bestTime <= 0 || t < s.bestTime;
  s.cleared = true;
  s.clears = Math.min(1e6, s.clears + 1);
  if (newBest) s.bestTime = t;
  s.bestWave = PROTOCOL_FINALE;
  // a run with no checkpoint retry (a later challenge star reads it)
  if (uses <= 0) s.cleanClear = true;
  s.checkpoint = null;
  p.commit();
  return { firstClear, reward, newBest, bestTime: s.bestTime };
}

/** Wave reached on a failed run (best wave reached is kept; PROTOCOL_FINALE = reached THE WHITEOUT). */
export function recordProtocolWave(p: Progression, wave: number): void {
  const s = protocolSave(p);
  s.bestWave = Math.max(s.bestWave, Math.min(PROTOCOL_FINALE, Math.max(0, Math.floor(wave))));
  p.commit();
}

/** Save the checkpoint taken at a wave's start (null clears it). */
export function saveCheckpoint(p: Progression, ck: ProtocolCheckpoint | null): void {
  protocolSave(p).checkpoint = ck ? { ...ck } : null;
  p.commit();
}

/** The run state a checkpoint captures (Game's RunTally fields + the plow). */
export interface RunSnapshotSource {
  wave: number;
  hp: number;
  maxHp: number;
  /** ctx.time now and when the run started (run time = fights only: the sim clock stops in shops). */
  time: number;
  start: number;
  kills: number;
  coins: number;
  uses: number;
}

/** Snapshot of a run at a wave's start (Game.protocolCheckpoint); wave PROTOCOL_FINALE = THE WHITEOUT starting. */
export function takeCheckpoint(r: RunSnapshotSource): ProtocolCheckpoint {
  return {
    wave: Math.max(1, Math.min(PROTOCOL_FINALE, Math.floor(r.wave))),
    hpFrac: Math.max(0.01, Math.min(1, r.hp / Math.max(1, r.maxHp))),
    elapsed: Math.max(0, r.time - r.start),
    kills: Math.max(0, r.kills),
    coins: Math.max(0, r.coins),
    uses: Math.max(0, r.uses),
  };
}

/** What RETRY WAVE n puts back for a plow of `maxHp` at sim time `time` (Game.startProtocol): HP, tallies, the run's
 *  start time (so the run clock continues from the checkpoint), and one more checkpoint use. */
export function restoreCheckpoint(ck: ProtocolCheckpoint, maxHp: number, time: number): { wave: number; hp: number; kills: number; coins: number; start: number; uses: number } {
  return {
    wave: ck.wave,
    hp: Math.max(1, Math.min(1, ck.hpFrac) * maxHp),
    kills: ck.kills,
    coins: ck.coins,
    start: time - ck.elapsed,
    uses: ck.uses + 1,
  };
}

/** m:ss.t for a best time (0 = none: '—'). */
export function formatRunTime(t: number): string {
  if (!(t > 0)) return '—';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

/** Coins the pilot has spent getting stronger: every upgrade level bought and every gear item level (PROTOCOL C's
 *  enemy scaling, config/protocol.ts spendScale). Cosmetics and plow unlocks don't count. */
export function protocolSpent(p: Progression): number {
  let t = 0;
  for (const u of UPGRADES) {
    const n = Math.min(p.level(u.id), u.maxLevel, 999);
    for (let l = 0; l < n; l++) t += upgradeCost(u, l);
  }
  for (const [id, lvl] of Object.entries(p.data.gear?.owned ?? {})) {
    const def = GEAR_BY_ID[id];
    if (def && typeof lvl === 'number') t += gearSpent(def, lvl);
  }
  return Math.round(t);
}
