/* PROTOCOL C balance estimate (`npm run balance`): per wave, the bosses' total HP at a pilot's spend level, and the
 * time it takes that pilot's single-target DPS (sim.ts singleDps) to chew through it. A rough planning number: it
 * ignores movement, dodging, area hits on several bosses at once and the finale (THE WHITEOUT), so real clears run
 * faster in packs and slower against the boss moves. */
import { ENEMIES } from '../../src/config/enemies';
import { GEAR_BY_ID, gearSpent } from '../../src/config/gear';
import { PROTOCOL_WAVES, protocolRounds, spendScale } from '../../src/config/protocol';
import { HARD } from '../../src/config/challenges';
import { UPGRADE_BY_ID, upgradeCost, type UpgradeId } from '../../src/config/upgrades';
import type { PlowKind } from '../../src/config/plows';
import { LINE, TIER_DEF, singleDps, type Tier } from './sim';

/** Garage levels per tier in sim.ts, as coins spent (upgrades from 0 + gear item levels), like meta/protocol.ts
 *  protocolSpent does for a real save. */
export function tierSpend(levels: Partial<Record<UpgradeId, number>>, gear: Record<string, number>): number {
  let t = 0;
  for (const [id, n] of Object.entries(levels) as [UpgradeId, number][]) {
    const def = UPGRADE_BY_ID[id];
    for (let l = 0; l < Math.min(n ?? 0, def.maxLevel); l++) t += upgradeCost(def, l);
  }
  for (const [id, lvl] of Object.entries(gear)) {
    const def = GEAR_BY_ID[id];
    if (def) t += gearSpent(def, lvl);
  }
  return Math.round(t);
}

export interface WaveRow {
  wave: number;
  bosses: number;
  hp: number;
  seconds: number;
}

/** Total boss HP per wave at spend scale `k` (headline + echoes; THE CHAIRMAN in wave 7). */
export function waveHp(k: { hp: number }): { wave: number; bosses: number; hp: number }[] {
  return protocolRounds().map((r, i) => {
    let hp = 0;
    let n = 0;
    for (const g of r.groups) {
      const def = ENEMIES[g.type];
      // In game: def.hp x group.hpMult x zone.enemyHpMult (= HARD.hpMult x k.hp).
      hp += def.hp * (g.hpMult ?? 1) * HARD.hpMult * k.hp * g.count;
      n += g.count;
    }
    return { wave: i + 1, bosses: n, hp: Math.round(hp) };
  });
}

/** Coins a sim tier has spent for `kind` (core four + the plow's line at the tier's levels, plus its gear). */
export function spentFor(kind: PlowKind, tier: Tier): number {
  const t = TIER_DEF[tier];
  const lv: Partial<Record<UpgradeId, number>> = {};
  for (const id of ['engine', 'armor', 'packedIce', 'hopper'] as UpgradeId[]) if (t.core) lv[id] = t.core;
  for (const id of LINE[kind]) if (t.line) lv[id] = t.line;
  return tierSpend(lv, t.gear);
}

/** Per-wave estimate for one plow at one sim tier, spending `spent` coins. */
export function protocolEstimate(kind: PlowKind, tier: Tier, spent: number): WaveRow[] {
  const dps = singleDps(kind, tier, 30);
  const k = spendScale(spent);
  return waveHp(k).map((w) => ({ ...w, seconds: Math.round(w.hp / Math.max(1, dps)) }));
}

export const PROTOCOL_WAVE_COUNT = PROTOCOL_WAVES;
