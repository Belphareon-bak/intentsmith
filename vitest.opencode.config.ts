import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Optional real-OpenCode lifecycle suite.
 *
 * Separate from `vitest.config.ts`, so neither `pnpm test` nor `pnpm verify`
 * can discover it. The operator must provide an already installed pinned
 * binary; IntentSmith never installs or upgrades OpenCode.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@intentsmith/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
      '@intentsmith/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@intentsmith/inference': fileURLToPath(new URL('./packages/inference/src/index.ts', import.meta.url)),
      '@intentsmith/hardware': fileURLToPath(new URL('./packages/hardware/src/index.ts', import.meta.url)),
      '@intentsmith/worker-sdk': fileURLToPath(new URL('./packages/worker-sdk/src/index.ts', import.meta.url)),
      '@intentsmith/process-runtime': fileURLToPath(new URL('./packages/process-runtime/src/index.ts', import.meta.url)),
      '@intentsmith/adapter-opencode': fileURLToPath(new URL('./packages/adapter-opencode/src/index.ts', import.meta.url)),
      '@intentsmith/adapter-ollama/fixtures': fileURLToPath(
        new URL('./packages/adapter-ollama/src/fixtures.ts', import.meta.url),
      ),
      '@intentsmith/adapter-ollama': fileURLToPath(new URL('./packages/adapter-ollama/src/index.ts', import.meta.url)),
      '@intentsmith/persistence': fileURLToPath(new URL('./packages/persistence/src/index.ts', import.meta.url)),
      '@intentsmith/testing': fileURLToPath(new URL('./packages/testing/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tools/opencode/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 15_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
