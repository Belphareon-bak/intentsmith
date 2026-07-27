import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@intentsmith/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
      '@intentsmith/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@intentsmith/persistence': fileURLToPath(new URL('./packages/persistence/src/index.ts', import.meta.url)),
      '@intentsmith/testing': fileURLToPath(new URL('./packages/testing/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['**/*.test.ts'],
    exclude: ['**/dist/**', '**/node_modules/**'],
    pool: 'threads',
    testTimeout: 5000,
    hookTimeout: 5000,
    coverage: {
      reportsDirectory: 'coverage',
    },
  },
});
