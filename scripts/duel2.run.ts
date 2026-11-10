/* Two-way Duel report (not part of `npm test`): `npm run duel2`. Options by env var (vitest owns the CLI flags) or
 * after `--`: DUEL2_N / --n (fights per pair per tier per variant, default 40), DUEL2_SEED / --seed (default 1),
 * DUEL2_OUT / --out (markdown file, default ./duel2-report.md), DUEL2_TIERS / --tiers (comma list, default all). */
import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { report } from './balance/duel2';
import { TIERS, type Tier } from './balance/sim';

function opt(flag: string, env: string, def: string): string {
  const argv = process.argv;
  const i = argv.indexOf(`--${flag}`);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${flag}=`));
  if (eq) return eq.slice(flag.length + 3);
  return process.env[env] ?? def;
}

it('two-way duel report', () => {
  const N = Math.max(1, Number(opt('n', 'DUEL2_N', '40')) | 0);
  const seed = Number(opt('seed', 'DUEL2_SEED', '1')) | 0;
  const out = opt('out', 'DUEL2_OUT', './duel2-report.md');
  const tiers = opt('tiers', 'DUEL2_TIERS', TIERS.join(','))
    .split(',')
    .filter((t): t is Tier => (TIERS as string[]).includes(t));
  const md = report(N, seed, tiers, undefined, (s) => process.stderr.write(`[duel2] ${s}\n`));
  process.stdout.write(md);
  writeFileSync(out, md);
  process.stderr.write(`[duel2] report written to ${out}\n`);
}, 3_600_000);
