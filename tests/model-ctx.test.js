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
  resolveNumCtx,
  setNumCtx,
} from '../src/llm/model-ctx.js';
import {
  MODEL_RUNTIME_PROFILE,
  MODEL_RUNTIME_PROFILE_DRIFT_KEYS,
  MODEL_RUNTIME_PROFILE_KEYS,
  getModelRuntimeProfile,
  validateApprovedModelRuntimeProfile,
  validateModelRuntimeProfile,
} from '../src/llm/model-runtime-profile.js';

suite('Committed model runtime profile');

test('pins the exact approved dimensions without claiming a physical VRAM fit', () => {
  const expectedProfileKeys = [
    'contextWindowTokens',
    'digestSha256',
    'fallbackPolicy',
    'minimumGpuResidencyPercent',
    'minimumHeadroomMiB',
    'model',
    'schemaVersion',
  ];
  const expectedDriftKeys = expectedProfileKeys.filter(key => key !== 'schemaVersion');
  assertEqual(Object.isFrozen(MODEL_RUNTIME_PROFILE), true);
  assertEqual(MODEL_RUNTIME_PROFILE.schemaVersion, 1);
  assertEqual(MODEL_RUNTIME_PROFILE.model, 'qwen3.5:27b');
  assertEqual(
    MODEL_RUNTIME_PROFILE.digestSha256,
    '7653528ba5cba4dd8e19da24aaddc7f4d0b5ecd93571c0825dfd4137958ec06e',
  );
  assertEqual(MODEL_RUNTIME_PROFILE.contextWindowTokens, 4096);
  assertEqual(MODEL_RUNTIME_PROFILE.minimumHeadroomMiB, 1024);
  assertEqual(MODEL_RUNTIME_PROFILE.minimumGpuResidencyPercent, 100);
  assertEqual(MODEL_RUNTIME_PROFILE.fallbackPolicy, 'forbid');
  assertEqual(
    JSON.stringify(Object.keys(MODEL_RUNTIME_PROFILE).sort()),
    JSON.stringify(expectedProfileKeys),
  );
  assertEqual(JSON.stringify(MODEL_RUNTIME_PROFILE_KEYS), JSON.stringify(expectedProfileKeys));
  assertEqual(JSON.stringify(MODEL_RUNTIME_PROFILE_DRIFT_KEYS), JSON.stringify(expectedDriftKeys));
  assertEqual('modelWeightsMb' in MODEL_RUNTIME_PROFILE, false);
  assertEqual('kvMbPer1k' in MODEL_RUNTIME_PROFILE, false);
});

test('rejects incomplete, extended, malformed, and dimension-drifted profiles', () => {
  const missing = { ...MODEL_RUNTIME_PROFILE };
  delete missing.digestSha256;
  assertEqual(validateModelRuntimeProfile(missing).valid, false);
  assertEqual(validateModelRuntimeProfile({ ...MODEL_RUNTIME_PROFILE, provider: 'ollama' }).valid, false);
  assertEqual(validateModelRuntimeProfile({ ...MODEL_RUNTIME_PROFILE, schemaVersion: 2 }).valid, false);
  assertEqual(validateModelRuntimeProfile({ ...MODEL_RUNTIME_PROFILE, digestSha256: 'bad' }).valid, false);

  const alternatives = {
    model: 'other:1b',
    digestSha256: 'b'.repeat(64),
    contextWindowTokens: 8192,
    minimumHeadroomMiB: 2048,
    minimumGpuResidencyPercent: 99,
    fallbackPolicy: 'allow',
  };
  for (const key of MODEL_RUNTIME_PROFILE_DRIFT_KEYS) {
    const validation = validateApprovedModelRuntimeProfile({
      ...MODEL_RUNTIME_PROFILE,
      [key]: alternatives[key],
    });
    assertEqual(validation.valid, false, `${key} drift must fail`);
    assert(validation.errors.includes(`drift:${key}`), `${key} drift reason missing`);
  }
});

test('applies only to the exact reference model identity', () => {
  assertEqual(getModelRuntimeProfile(' QWEN3.5:27B '), MODEL_RUNTIME_PROFILE);
  assertEqual(getModelRuntimeProfile('qwen3.5:27b:latest'), null);
  assertEqual(getModelRuntimeProfile('other:27b'), null);
});

suite('Effective model context registry');

test('returns the committed ceiling before reference-model initialization', () => {
  clearNumCtxCache();
  assertEqual(getNumCtx('qwen3.5:27b'), 4096);
});

test('supports an explicit caller fallback for an unprofiled model', () => {
  clearNumCtxCache();
  assertEqual(getNumCtx('fixture:1b', 4096), 4096);
});

test('normalizes model names for cache lookup', () => {
  clearNumCtxCache();
  setNumCtx('FIXTURE:1B', 6144);
  assertEqual(getNumCtx('fixture:1b'), 6144);
});

test('does not cache invalid or unsafe context sizes', () => {
  clearNumCtxCache();
  setNumCtx('fixture:1b', Number.NaN);
  setNumCtx('fixture:1b', 511);
  setNumCtx('fixture:1b', 2048.5);
  setNumCtx('fixture:1b', 262145);
  setNumCtx('', 4096);
  assertEqual(getNumCtx('fixture:1b', 3072), 3072);
});

test('cache clear revokes a previously computed value', () => {
  clearNumCtxCache();
  setNumCtx('fixture:1b', 4096);
  clearNumCtxCache();
  assertEqual(getNumCtx('fixture:1b', 2048), 2048);
});

test('cache and request values can lower but never raise the reference ceiling', () => {
  clearNumCtxCache();
  setNumCtx('qwen3.5:27b', 8192);
  assertEqual(getNumCtx('qwen3.5:27b'), 4096);
  assertEqual(resolveNumCtx('qwen3.5:27b', 8192), 4096);
  assertEqual(resolveNumCtx('qwen3.5:27b', 2048), 2048);

  setNumCtx('qwen3.5:27b', 2048);
  assertEqual(getNumCtx('qwen3.5:27b'), 2048);
  assertEqual(resolveNumCtx('qwen3.5:27b', 4096), 2048);

  clearNumCtxCache();
  assertEqual(resolveNumCtx('unprofiled:1b', 32768), 32768);
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

  const profiledUnknown = await fitsVram(MODEL_RUNTIME_PROFILE.model, {
    numCtx: MODEL_RUNTIME_PROFILE.contextWindowTokens,
    observeVram: async () => {
      observerCalls += 1;
      return { totalMb: 24576, freeMb: 24576, source: 'fixture' };
    },
  });
  assertEqual(profiledUnknown.state, VramFitState.UNKNOWN);
  assertEqual(profiledUnknown.reason, VramFitReason.FOOTPRINT_UNKNOWN);
  assertEqual(observerCalls, 0, 'runtime profile must not become physical FIT evidence');

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

await testAsync('reference initialization cannot raise the committed ceiling', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      model_info: { 'qwen.context_length': 262144 },
    }),
  });

  try {
    clearNumCtxCache();
    const numCtx = await initModelNumCtx('qwen3.5:27b', 'http://unit.test', {
      observeVram: async () => ({ totalMb: 98304, usedMb: 0 }),
    });
    assertEqual(numCtx, 4096);
    assertEqual(getNumCtx('qwen3.5:27b'), 4096);
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
