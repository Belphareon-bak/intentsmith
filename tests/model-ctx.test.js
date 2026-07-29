#!/usr/bin/env node

import {
  assertEqual,
  suite,
  summary,
  test,
  testAsync,
} from './harness.js';
import {
  clearNumCtxCache,
  getNumCtx,
  initModelNumCtx,
  setNumCtx,
} from '../src/llm/model-ctx.js';

suite('Effective model context registry');

test('returns the conservative default before initialization', () => {
  clearNumCtxCache();
  assertEqual(getNumCtx('qwen3.5:27b'), 8192);
});

test('supports an explicit caller fallback', () => {
  clearNumCtxCache();
  assertEqual(getNumCtx('qwen3.5:27b', 4096), 4096);
});

test('normalizes model names for cache lookup', () => {
  clearNumCtxCache();
  setNumCtx('QWEN3.5:27B', 6144);
  assertEqual(getNumCtx('qwen3.5:27b'), 6144);
});

test('does not cache invalid or unsafe context sizes', () => {
  clearNumCtxCache();
  setNumCtx('qwen3.5:27b', Number.NaN);
  setNumCtx('qwen3.5:27b', 511);
  setNumCtx('', 4096);
  assertEqual(getNumCtx('qwen3.5:27b', 3072), 3072);
});

test('cache clear revokes a previously computed value', () => {
  clearNumCtxCache();
  setNumCtx('qwen3.5:27b', 4096);
  clearNumCtxCache();
  assertEqual(getNumCtx('qwen3.5:27b', 2048), 2048);
});

await testAsync('initialization respects the model-declared context ceiling', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      model_info: { 'test.context_length': 2048 },
    }),
  });

  try {
    clearNumCtxCache();
    const numCtx = await initModelNumCtx('test-model:1b', 'http://unit.test');
    assertEqual(numCtx, 2048);
    assertEqual(getNumCtx('test-model:1b'), 2048);
  } finally {
    globalThis.fetch = originalFetch;
    clearNumCtxCache();
  }
});

summary();
