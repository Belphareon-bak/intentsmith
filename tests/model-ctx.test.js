#!/usr/bin/env node

import {
  assert,
  assertEqual,
  suite,
  summary,
  test,
  testAsync,
} from './harness.js';
import {
  VramFitReason,
  VramFitState,
  clearNumCtxCache,
  fitsVram,
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
  setNumCtx('qwen3.5:27b', 2048.5);
  setNumCtx('qwen3.5:27b', 262145);
  setNumCtx('', 4096);
  assertEqual(getNumCtx('qwen3.5:27b', 3072), 3072);
});

test('cache clear revokes a previously computed value', () => {
  clearNumCtxCache();
  setNumCtx('qwen3.5:27b', 4096);
  clearNumCtxCache();
  assertEqual(getNumCtx('qwen3.5:27b', 2048), 2048);
});

suite('Offline VRAM fit classification');

await testAsync('classifies exact fit and physical non-fit boundaries', async () => {
  const exactFit = await fitsVram('fixture:7b', {
    numCtx: 4096,
    reserveMb: 1024,
    modelWeightsMb: 4760,
    kvMbPer1k: 63,
    observeVram: async () => ({
      totalMb: 6036,
      freeMb: 6036,
      source: 'fixture',
    }),
  });
  assertEqual(exactFit.state, VramFitState.FIT);
  assertEqual(exactFit.reason, VramFitReason.FIT);
  assertEqual(exactFit.requiredMb, 5012);
  assertEqual(exactFit.totalMb, 6036);
  assertEqual(exactFit.freeMb, 6036);
  assertEqual(Object.isFrozen(exactFit), true);

  const oneMbShort = await fitsVram('fixture:7b', {
    numCtx: 4096,
    reserveMb: 1024,
    modelWeightsMb: 4760,
    kvMbPer1k: 63,
    observeVram: async () => ({
      totalMb: 6035,
      freeMb: 6035,
      source: 'fixture',
    }),
  });
  assertEqual(oneMbShort.state, VramFitState.NONFIT);
  assertEqual(oneMbShort.reason, VramFitReason.CAPACITY_NONFIT);
  assertEqual(oneMbShort.requiredMb, 5012);
});

await testAsync('low current free memory remains unknown when a model swap can fit', async () => {
  const result = await fitsVram('fixture:7b', {
    numCtx: 4096,
    modelWeightsMb: 4760,
    kvMbPer1k: 63,
    observeVram: async () => ({
      totalMb: 8192,
      freeMb: 2048,
      source: 'fixture',
    }),
  });
  assertEqual(result.state, VramFitState.UNKNOWN);
  assertEqual(result.reason, VramFitReason.CURRENT_FREE_INSUFFICIENT);
  assertEqual(result.requiredMb, 5012);
});

await testAsync('missing, throwing, and invalid observers fail to unknown', async () => {
  const observers = [
    async () => null,
    async () => { throw new Error('fixture observer unavailable'); },
    async () => ({
      get totalMb() { throw new Error('fixture total getter unavailable'); },
      freeMb: 4096,
      source: 'throwing-getter',
    }),
    async () => ({ totalMb: 4096, freeMb: 8192, source: 'invalid' }),
    async () => ({ totalMb: '8192', freeMb: '8192', source: 'string-values' }),
  ];
  for (const observeVram of observers) {
    const result = await fitsVram('fixture:7b', {
      numCtx: 4096,
      modelWeightsMb: 4760,
      kvMbPer1k: 63,
      observeVram,
    });
    assertEqual(result.state, VramFitState.UNKNOWN);
    assertEqual(result.reason, VramFitReason.OBSERVATION_UNAVAILABLE);
  }
});

await testAsync('unknown model footprint does not probe the host implicitly', async () => {
  let observerCalls = 0;
  const unknown = await fitsVram('fixture:7b', {
    numCtx: 4096,
    observeVram: async () => {
      observerCalls += 1;
      return { totalMb: 8192, freeMb: 8192, source: 'fixture' };
    },
  });
  assertEqual(unknown.state, VramFitState.UNKNOWN);
  assertEqual(unknown.reason, VramFitReason.FOOTPRINT_UNKNOWN);
  assertEqual(observerCalls, 0);

  const explicit = await fitsVram('custom-model', {
    numCtx: 2048,
    modelWeightsMb: 1000,
    kvMbPer1k: 50,
    observeVram: async () => ({
      totalMb: 4096,
      freeMb: 4096,
      source: 'fixture',
    }),
  });
  assertEqual(explicit.state, VramFitState.FIT);
  assertEqual(explicit.requiredMb, 1100);
  assert(Object.isFrozen(explicit));

  const partialOverride = await fitsVram('fixture:7b', {
    numCtx: 4096,
    modelWeightsMb: 1000,
    observeVram: async () => ({
      totalMb: 4096,
      freeMb: 4096,
      source: 'fixture',
    }),
  });
  assertEqual(partialOverride.state, VramFitState.UNKNOWN);
  assertEqual(partialOverride.reason, VramFitReason.INPUT_INVALID);
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
    const numCtx = await initModelNumCtx('test-model:1b', 'http://unit.test', {
      observeVram: async () => null,
    });
    assertEqual(numCtx, 2048);
    assertEqual(getNumCtx('test-model:1b'), 2048);
  } finally {
    globalThis.fetch = originalFetch;
    clearNumCtxCache();
  }
});

await testAsync('initialization distinguishes a parsed model from unknown-name fallback', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      model_info: { 'fixture.context_length': 32768 },
    }),
  });
  const vramFixture = async () => ({ totalMb: 8192, usedMb: 0 });

  try {
    clearNumCtxCache();
    const parsed = await initModelNumCtx('fixture:1b', 'http://unit.test', {
      observeVram: vramFixture,
    });
    const unknown = await initModelNumCtx('fixture-without-size', 'http://unit.test', {
      observeVram: vramFixture,
    });
    assertEqual(parsed, 32768);
    assertEqual(unknown, 8192);
  } finally {
    globalThis.fetch = originalFetch;
    clearNumCtxCache();
  }
});

summary();
