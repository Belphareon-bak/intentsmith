import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@intentsmith/contracts': fileURLToPath(new URL('./packages/contracts/src/index.ts', import.meta.url)),
      '@intentsmith/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@intentsmith/inference': fileURLToPath(new URL('./packages/inference/src/index.ts', import.meta.url)),
      '@intentsmith/hardware': fileURLToPath(new URL('./packages/hardware/src/index.ts', import.meta.url)),
      '@intentsmith/worker-sdk': fileURLToPath(new URL('./packages/worker-sdk/src/index.ts', import.meta.url)),
      '@intentsmith/process-runtime': fileURLToPath(new URL('./packages/process-runtime/src/index.ts', import.meta.url)),
      '@intentsmith/adapter-opencode/fixtures': fileURLToPath(
        new URL('./packages/adapter-opencode/src/fixtures.ts', import.meta.url),
      ),
      '@intentsmith/adapter-opencode': fileURLToPath(new URL('./packages/adapter-opencode/src/index.ts', import.meta.url)),
      '@intentsmith/adapter-ollama/fixtures': fileURLToPath(
        new URL('./packages/adapter-ollama/src/fixtures.ts', import.meta.url),
      ),
      '@intentsmith/adapter-ollama': fileURLToPath(new URL('./packages/adapter-ollama/src/index.ts', import.meta.url)),
      '@intentsmith/persistence': fileURLToPath(new URL('./packages/persistence/src/index.ts', import.meta.url)),
      '@intentsmith/testing/worker-contract': fileURLToPath(
        new URL('./packages/testing/src/worker-contract.ts', import.meta.url),
      ),
      '@intentsmith/testing/provider-contract': fileURLToPath(
        new URL('./packages/testing/src/provider-contract.ts', import.meta.url),
      ),
      '@intentsmith/testing': fileURLToPath(new URL('./packages/testing/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['**/*.test.ts'],
    // The real-Ollama suite is opt-in only and must never run in `pnpm verify`
    // or normal CI; `pnpm test:ollama` targets it explicitly.
    exclude: ['**/dist/**', '**/node_modules/**', 'tools/ollama/**'],
    pool: 'threads',
    testTimeout: 5000,
    hookTimeout: 5000,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      include: [
        'packages/contracts/src/**/*.ts',
        'packages/core/src/**/*.ts',
        'packages/inference/src/**/*.ts',
        'packages/hardware/src/**/*.ts',
        'packages/worker-sdk/src/**/*.ts',
        'packages/process-runtime/src/**/*.ts',
        'packages/adapter-opencode/src/**/*.ts',
        'packages/adapter-ollama/src/**/*.ts',
        'packages/persistence/src/**/*.ts',
        'packages/testing/src/**/*.ts',
        'apps/server/src/**/*.ts',
        'apps/cli/src/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/index.ts', '**/dist/**', '**/fixtures.ts', '**/test-runtime.ts'],
      /**
       * Gates are set just below the measured Phase 1.1 values so a real
       * regression fails the build, without rewarding filler tests. The
       * per-file entries cover the critical domain logic: lifecycle, verdict,
       * capability/path policy, persistence transactions and schema
       * validation. There is deliberately no blanket 100% rule.
       */
      thresholds: {
        statements: 90,
        branches: 82,
        functions: 88,
        lines: 92,
        'packages/core/src/core.ts': { statements: 92, branches: 82, functions: 90, lines: 95 },
        'packages/core/src/lifecycle.ts': { statements: 95, branches: 78, functions: 95, lines: 95 },
        'packages/core/src/verdict.ts': { statements: 88, branches: 88, functions: 95, lines: 88 },
        'packages/core/src/path-policy.ts': { statements: 95, branches: 95, functions: 95, lines: 95 },
        'packages/inference/src/provider.ts': { statements: 95, branches: 95, functions: 95, lines: 95 },
        'packages/inference/src/endpoint-policy.ts': { statements: 95, branches: 90, functions: 95, lines: 95 },
        'packages/inference/src/remote-policy.ts': { statements: 95, branches: 90, functions: 95, lines: 95 },
        'packages/inference/src/scheduler.ts': { statements: 90, branches: 82, functions: 90, lines: 90 },
        'packages/adapter-ollama/src/dto.ts': { statements: 90, branches: 85, functions: 90, lines: 90 },
        'packages/adapter-ollama/src/ndjson.ts': { statements: 90, branches: 85, functions: 90, lines: 90 },
        'packages/hardware/src/model-fit.ts': { statements: 92, branches: 88, functions: 92, lines: 92 },
        'packages/persistence/src/database.ts': { statements: 95, branches: 85, functions: 95, lines: 95 },
        'packages/contracts/src/index.ts': { statements: 90, branches: 85, functions: 85, lines: 90 },
      },
    },
  },
});
