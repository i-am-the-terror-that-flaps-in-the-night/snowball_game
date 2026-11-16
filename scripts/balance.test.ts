/* Balance report (not part of `npm test`): `npm run balance`. Prints the markdown tables used in docs/balance.md. */
import { it } from 'vitest';
import { protocolEstimate, spentFor } from './balance/protocol';
import { spendScale } from '../src/config/protocol';
import { KINDS, TIERS, clusterDps, duelLaserDamage, duelTtk, singleDps, spreadDps, statsFor, ultDamage, ultFill, ultFillBoss } from './balance/sim';

const f0 = (n: number) => (Number.isFinite(n) ? Math.round(n).toString() : '∞');
const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '∞');
const pct = (v: number, mean: number) => `${v >= mean ? '+' : ''}${Math.round((v / mean - 1) * 100)}%`;
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

/** Storm strikes etc. roll Math.random: each report seeds its own stream, so two runs print the same tables and the
 *  PROTOCOL C report (committed as scripts/balance/protocol-report.md) does not depend on what ran before it. */
function seedRandom(seed = 12345): void {
  Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}

it('balance report', () => {
  seedRandom();
  const out: string[] = [];
  for (const tier of TIERS) {
    const rows = KINDS.map((k) => {
      const ttk = KINDS.map((d) => duelTtk(k, d, tier));
      return { k, hp: statsFor(k, tier).maxHp, dps: singleDps(k, tier), aoe: clusterDps(k, tier), fill: ultFill(k, tier), boss: ultFillBoss(k, tier), ult: ultDamage(k, tier), ttk: avg(ttk), ttkMin: Math.min(...ttk) };
    });
    const dpsMean = avg(rows.slice(0, 4).map((r) => r.dps));
    const ultMean = avg(rows.map((r) => r.ult.total));
    const ttkMean = avg(rows.map((r) => r.ttk));
    out.push(`\n### ${tier}\n`);
    out.push('| plow | HP | 1-target DPS (vs plow mean) | cluster DPS | ult fill: fight / boss (s) | ult dmg, bots hit (vs mean) | duel TTK avg (vs mean) / min (s) |');
    out.push('|---|---|---|---|---|---|---|');
    for (const r of rows) {
      out.push(
        `| ${r.k} | ${f0(r.hp)} | ${f0(r.dps)} (${pct(r.dps, dpsMean)}) | ${f0(r.aoe)} | ${f1(r.fill)} / ${f1(r.boss)} | ${f0(r.ult.total)}, ${r.ult.hit} (${pct(r.ult.total, ultMean)}) | ${f1(r.ttk)} (${pct(r.ttk, ttkMean)}) / ${f1(r.ttkMin)} |`,
      );
    }
    const ring = spreadDps(tier);
    const flat = spreadDps(tier, false);
    out.push(`\nClassic ring play (each slam on the next of 5 spread bots): ${f0(ring)} DPS with STREAK, ${f0(flat)} without (${pct(ring, flat)}).`);
    out.push(`\nVOLT-9 1-target DPS with a bot near the dummy (no GROUNDED ARC, as on a typical bot in a wave): ${f0(singleDps('volt', tier, 60, false))}.`);
    out.push(
      `\nDuel Mag Laser alone, 2 s held: ${f0(duelLaserDamage(tier))} HP of a ${f0(statsFor('classic', tier).maxHp)}-HP Classic; ${f0(duelLaserDamage(tier, 2, 'arsenal'))} of a ${f0(statsFor('arsenal', tier).maxHp)}-HP ARSENAL mirror.`,
    );
  }
  process.stdout.write(out.join('\n') + '\n');
}, 600_000);

it('PROTOCOL C wave estimate', () => {
  // Boss HP per wave (spend-scaled) vs each plow's single-target DPS at the mid / unlock / high garages: a planning
  // number (the real clears: scripts/protocol-probe.mjs, docs/balance.md "PROTOCOL C").
  seedRandom();
  const out: string[] = ['\n### PROTOCOL C: seconds of single-target DPS to clear each wave\n'];
  for (const tier of ['mid', 'unlock', 'high'] as const) {
    out.push(`\n#### ${tier}\n`, '| plow | spent | k.hp | w1 | w2 | w3 | w4 | w5 | w6 | w7 | total |', '|---|---|---|---|---|---|---|---|---|---|---|');
    for (const k of KINDS) {
      const spent = spentFor(k, tier);
      const rows = protocolEstimate(k, tier, spent);
      const tot = rows.reduce((a, r) => a + r.seconds, 0);
      out.push(`| ${k} | ${spent} | ${spendScale(spent).hp.toFixed(2)} | ${rows.map((r) => r.seconds).join(' | ')} | ${tot} |`);
    }
  }
  console.log(out.join('\n'));
  require('fs').writeFileSync('scripts/balance/protocol-report.md', out.join('\n') + '\n');
}, 300000);
