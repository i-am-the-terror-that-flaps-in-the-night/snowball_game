import { defineConfig } from 'vite';
export default defineConfig({
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 2000 },
  // Agent worktrees live under .claude/worktrees; keep their copies of tests/ out of this checkout's runs.
  test: { include: ['tests/**/*.test.ts'] },
});
