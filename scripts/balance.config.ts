import { defineConfig } from 'vite';
/** `npm run balance`: the headless balance report (kept out of the default `npm test` run). */
export default defineConfig({ test: { include: ['scripts/balance.test.ts'] } });
