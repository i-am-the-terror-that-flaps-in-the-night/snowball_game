/* Balance report (not part of `npm test`): `npm run balance`. Prints the markdown tables used in docs/balance.md. */
import { it } from 'vitest';
import { KINDS, TIERS, clusterDps, duelDiscDamage, duelTtk, singleDps, statsFor, ultDamage, ultFill, ultFillBoss } from './balance/sim';

const f0 = (n: number) => (Number.isFinite(n) ? Math.round(n).toString() : '∞');
const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : '∞');
const pct = (v: number, mean: number) => `${v >= mean ? '+' : ''}${Math.round((v / mean - 1) * 100)}%`;
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

it('balance report', () => {
  // Storm strikes etc. roll Math.random: seed it so two runs print the same tables.
  let seed = 12345;
  Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
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
    out.push(`\nVOLT-9 1-target DPS with a bot near the dummy (no GROUNDED ARC, as on a typical bot in a wave): ${f0(singleDps('volt', tier, 60, false))}.`);
    out.push(
      `\nDuel Mag Discs alone, 2 s held: ${f0(duelDiscDamage(tier))} HP of a ${f0(statsFor('classic', tier).maxHp)}-HP Classic; ${f0(duelDiscDamage(tier, 2, 'arsenal'))} of a ${f0(statsFor('arsenal', tier).maxHp)}-HP ARSENAL mirror.`,
    );
  }
  process.stdout.write(out.join('\n') + '\n');
}, 600_000);
