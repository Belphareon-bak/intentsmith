import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Optional real-Ollama suite.
 *
 * Separate from `vitest.config.ts` so it can never be picked up by
 * `pnpm test`, `pnpm test:coverage` or `pnpm verify`. Requires
 * `INTENTSMITH_RUN_REAL_OLLAMA=1` and an already installed local model in
 * `INTENTSMITH_OLLAMA_TEST_MODEL`; it never downloads one.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@intentsmith/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
      '@intentsmith/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@intentsmith/inference': fileURLToPath(new URL('./packages/inference/src/index.ts', import.meta.url)),
      '@intentsmith/hardware': fileURLToPath(new URL('./packages/hardware/src/index.ts', import.meta.url)),
      '@intentsmith/adapter-ollama': fileURLToPath(new URL('./packages/adapter-ollama/src/index.ts', import.meta.url)),
      '@intentsmith/persistence': fileURLToPath(new URL('./packages/persistence/src/index.ts', import.meta.url)),
      '@intentsmith/testing': fileURLToPath(new URL('./packages/testing/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tools/ollama/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 60_000,
    pool: 'forks',
  },
});
