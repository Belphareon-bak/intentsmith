import type { ScenarioDefinition } from './types.js';

export const LOCAL_GPU_SMOKE_MANIFEST: ScenarioDefinition[] = [
  {
    id: 'approved-edit',
    version: '1',
    command: [
      'corepack',
      'pnpm',
      'test:opencode',
      '--',
      'tools/opencode/real-product-lifecycle.test.ts',
      '-t',
      'asks first, changes the workspace only after approval, and passes on Git-derived evidence',
    ],
    timeoutMs: 900_000,
    requiredPreconditions: ['opencode-ai@1.18.8', 'Ollama', 'qwen3:14b', 'idle RTX 3090'],
  },
  {
    id: 'deny-while-pending',
    version: '1',
    command: [
      'corepack',
      'pnpm',
      'test:opencode',
      '--',
      'tools/opencode/real-product-lifecycle.test.ts',
      '-t',
      'deny prevents the protected side effect and settles the run',
    ],
    timeoutMs: 900_000,
    requiredPreconditions: ['opencode-ai@1.18.8', 'Ollama', 'qwen3:14b', 'idle RTX 3090'],
  },
];
