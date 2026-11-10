import { defineConfig } from 'vite';
/** `npm run duel2`: the two-way Duel Monte Carlo report (kept out of the default `npm test` run). */
export default defineConfig({ test: { include: ['scripts/duel2.run.ts'] } });
