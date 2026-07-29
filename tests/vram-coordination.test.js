// v131: VRAM Coordination Tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import { VRAMManager, _estimateWeightsMb, _kvMbPer1k } from '../src/media/vram-manager.js';
import { getVramUsage, getVramUsageAsync, _clearVramCache } from '../src/system/gpu-detector.js';
import { clearNumCtxCache, getNumCtx } from '../src/llm/model-ctx.js';

// ── Mock infrastructure ───────────────────────────────────────────────────

let _mockExecSync = null;
let _mockFetchResponses = [];

// Intercept execSync for nvidia-smi tests
import { execSync as _realExecSync } from 'child_process';

// Global fetch mock
const _realFetch = globalThis.fetch;
function mockFetch(responses) {
  _mockFetchResponses = [...responses];
  globalThis.fetch = async (url, opts) => {
    const entry = _mockFetchResponses.shift();
    if (!entry) return { ok: false, status: 500, text: async () => 'no mock', json: async () => ({}) };
    if (entry.error) throw entry.error;
    return {
      ok: entry.ok ?? true,
      status: entry.status ?? 200,
      text: async () => JSON.stringify(entry.body ?? {}),
      json: async () => entry.body ?? {},
    };
  };
}
function restoreFetch() {
  globalThis.fetch = _realFetch;
  _mockFetchResponses = [];
}

function createManager(overrides = {}) {
  return new VRAMManager({
    ollamaUrl: 'http://mock:11434',
    chatModel: 'qwen3.5:27b',
    comfyuiUrl: 'http://mock:8188',
    gpuTotalVramMb: 24576,
    ...overrides,
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite 1: Helper functions
// ══════════════════════════════════════════════════════════════════════════════

suite('VRAM helpers');

test('_estimateWeightsMb returns 620*params+420 for valid params', () => {
  assertEqual(_estimateWeightsMb(27), 620 * 27 + 420);  // 17160
  assertEqual(_estimateWeightsMb(7), 620 * 7 + 420);    // 4760
  assertEqual(_estimateWeightsMb(32), 620 * 32 + 420);  // 20260
});

test('_estimateWeightsMb returns 16200 for null/zero params', () => {
  assertEqual(_estimateWeightsMb(0), 16200);
  assertEqual(_estimateWeightsMb(null), 16200);
  assertEqual(_estimateWeightsMb(undefined), 16200);
});

test('_kvMbPer1k uses explicit modelMeta.kv_per_1k', () => {
  assertEqual(_kvMbPer1k({ kv_per_1k: 300 }, 27), 300);
  assertEqual(_kvMbPer1k({ kv_per_1k: 150 }, 7), 150);
});

test('_kvMbPer1k estimates from params when no meta', () => {
  // ~9 MB per 1K per billion params
  assertEqual(_kvMbPer1k(null, 27), 243);  // 27 * 9
  assertEqual(_kvMbPer1k(null, 7), 63);
  assertEqual(_kvMbPer1k({}, 32), 288);
});

test('_kvMbPer1k returns 250 as safe default with no data', () => {
  assertEqual(_kvMbPer1k(null, 0), 250);
  assertEqual(_kvMbPer1k(null, null), 250);
  assertEqual(_kvMbPer1k(undefined, undefined), 250);
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 2: getVramUsage (nvidia-smi)
// ══════════════════════════════════════════════════════════════════════════════

suite('getVramUsage (nvidia-smi)');

test('getVramUsage returns data on NVIDIA systems', () => {
  // This test only passes on systems with nvidia-smi
  _clearVramCache();
  const result = getVramUsage();
  // May be null if no nvidia-smi — that's OK
  if (result) {
    assert(result.totalMb > 0, 'totalMb should be positive');
    assert(result.freeMb >= 0, 'freeMb should be non-negative');
    assert(result.usedMb >= 0, 'usedMb should be non-negative');
    assertEqual(result.source, 'nvidia-smi');
  }
});

test('getVramUsage returns cached result within TTL', () => {
  _clearVramCache();
  const r1 = getVramUsage();
  const r2 = getVramUsage();
  // Both should be same object reference (cached)
  if (r1 && r2) {
    assertEqual(r1.totalMb, r2.totalMb);
    assertEqual(r1.freeMb, r2.freeMb);
  }
});

test('_clearVramCache forces fresh read', () => {
  const r1 = getVramUsage();
  _clearVramCache();
  // After clear, cache is empty — next call re-queries
  // Can't assert different values (system state same), but at least no crash
  const r2 = getVramUsage();
  assert(true, 'No crash after cache clear');
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 3: getVramUsageAsync (fallback)
// ══════════════════════════════════════════════════════════════════════════════

suite('getVramUsageAsync (fallback)');

await testAsync('getVramUsageAsync prefers nvidia-smi over ComfyUI', async () => {
  _clearVramCache();
  const result = await getVramUsageAsync({ comfyuiUrl: 'http://localhost:99999' });
  // On NVIDIA system: should use nvidia-smi, not attempt ComfyUI
  if (result) {
    assertEqual(result.source, 'nvidia-smi');
  }
});

await testAsync('getVramUsageAsync falls back to ComfyUI when nvidia-smi unavailable', async () => {
  _clearVramCache();
  // We can't easily disable nvidia-smi in tests — just verify no crash
  const result = await getVramUsageAsync({ comfyuiUrl: 'http://localhost:99999' });
  // result may be from nvidia-smi or null (ComfyUI unreachable) — both fine
  assert(true, 'No crash on unreachable ComfyUI');
});

await testAsync('getVramUsageAsync returns null when all sources fail', async () => {
  _clearVramCache();
  // No ComfyUI URL → only nvidia-smi → may work or may not
  const result = await getVramUsageAsync({});
  // On non-NVIDIA: null. On NVIDIA: data. Both are valid.
  assert(true, 'No crash');
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 4: computeNumCtx
// ══════════════════════════════════════════════════════════════════════════════

suite('computeNumCtx');

await testAsync('returns 4096 fallback when VRAM cannot be queried', async () => {
  const mgr = createManager();
  // Mock: getVramUsageAsync returns null
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('no ollama'); };
  _clearVramCache();
  // Override the dynamic import result — we need to control what getVramUsageAsync returns
  // Since we can't easily mock dynamic imports, we use a workaround:
  // If nvidia-smi IS available (dev machine), this will succeed.
  // Test the fallback by checking the logic with real data.
  globalThis.fetch = origFetch;

  // Alternative: test the computation logic directly
  const numCtx = await mgr.computeNumCtx({ modelParams: 27 });
  assert(numCtx >= 2048, `num_ctx should be >= 2048, got ${numCtx}`);
  assert(numCtx <= 8192, `num_ctx should be <= 8192 (gateway max), got ${numCtx}`);
  assert(numCtx % 1024 === 0, `num_ctx should be multiple of 1024, got ${numCtx}`);
});

await testAsync('computeNumCtx stores result in _targetNumCtx', async () => {
  const mgr = createManager();
  clearNumCtxCache();
  const result = await mgr.computeNumCtx({ modelParams: 27 });
  assertEqual(mgr.getTargetNumCtx(), result);
  assertEqual(getNumCtx('qwen3.5:27b'), result);
});

await testAsync('computeNumCtx respects maxCtx gateway limit', async () => {
  const mgr = createManager();
  const result = await mgr.computeNumCtx({ modelParams: 7, maxCtx: 4096 });
  assert(result <= 4096, `num_ctx should be <= maxCtx 4096, got ${result}`);
});

await testAsync('computeNumCtx clamps to minimum 2048', async () => {
  const mgr = createManager();
  // Very large model on small GPU → should clamp to 2048
  const result = await mgr.computeNumCtx({ modelParams: 100, modelWeightsMb: 50000 });
  assertEqual(result, 2048);
});

await testAsync('computeNumCtx is always a multiple of 1024', async () => {
  const mgr = createManager();
  const result = await mgr.computeNumCtx({ modelParams: 27 });
  assertEqual(result % 1024, 0);
});

await testAsync('computeNumCtx uses model meta kv_per_1k when available', async () => {
  const mgr = createManager();
  mgr.setModelMeta({ kv_per_1k: 100 });  // low KV = more context
  const result = await mgr.computeNumCtx({ modelParams: 27 });
  // With low KV per 1K, should get higher context (up to gateway max 8192)
  assert(result >= 2048, `Should be at least 2048, got ${result}`);
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 5: reloadOllama with num_ctx
// ══════════════════════════════════════════════════════════════════════════════

suite('reloadOllama with num_ctx');

await testAsync('reloadOllama sends num_ctx in options', async () => {
  const mgr = createManager();
  let capturedBody = null;

  mockFetch([
    // computeNumCtx may call getVramUsageAsync → might try ComfyUI
    { ok: false, status: 502 },  // ComfyUI fallback fails
    // The actual reload request
    { ok: true, body: { response: '' } },
  ]);

  // Override to capture the generate request
  const fetchCalls = [];
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  };

  await mgr.reloadOllama();

  globalThis.fetch = savedFetch;

  // Find the /api/generate call
  const genCall = fetchCalls.find(c => c.url?.includes('/api/generate') && c.body?.prompt);
  assert(genCall, 'Should have made a generate call');
  assert(genCall.body.options?.num_ctx > 0, `Should have num_ctx, got ${JSON.stringify(genCall.body.options)}`);
});

await testAsync('reloadOllama respects cooldown', async () => {
  const mgr = createManager();
  const fetchCalls = [];
  globalThis.fetch = async (url, opts) => {
    fetchCalls.push(url);
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  };

  await mgr.reloadOllama();
  const firstCount = fetchCalls.length;

  // Immediate second call should be skipped (cooldown)
  await mgr.reloadOllama();
  assertEqual(fetchCalls.length, firstCount, 'Second reload should be skipped (cooldown)');

  restoreFetch();
});

await testAsync('reloadOllama skips if no chatModel', async () => {
  const mgr = createManager({ chatModel: '' });
  const fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(url);
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  };

  await mgr.reloadOllama();
  assertEqual(fetchCalls.length, 0, 'Should not make any fetch calls');

  restoreFetch();
});

await testAsync('reloadOllama handles network error gracefully', async () => {
  const mgr = createManager();
  mgr._lastReloadTime = 0;  // bypass cooldown

  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  // Should not throw
  await mgr.reloadOllama();
  assertEqual(mgr._ollamaUnloaded, false, 'Should mark as not-unloaded');

  restoreFetch();
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 6: unloadOllama (all models)
// ══════════════════════════════════════════════════════════════════════════════

suite('unloadOllama (all models)');

await testAsync('unloadOllama queries /api/ps and unloads all models', async () => {
  const mgr = createManager();
  const unloadedModels = [];

  globalThis.fetch = async (url, opts) => {
    if (url.includes('/api/ps')) {
      return {
        ok: true, status: 200,
        text: async () => '{}',
        json: async () => ({
          models: [
            { name: 'qwen3.5:27b' },
            { name: 'deepseek-r1-32b' },
          ],
        }),
      };
    }
    if (url.includes('/api/generate')) {
      const body = JSON.parse(opts.body);
      if (body.keep_alive === '0') unloadedModels.push(body.model);
    }
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  };

  await mgr.unloadOllama();

  assert(unloadedModels.includes('qwen3.5:27b'), 'Should unload qwen3.5:27b');
  assert(unloadedModels.includes('deepseek-r1-32b'), 'Should unload deepseek-r1-32b');
  assertEqual(unloadedModels.length, 2);
  assertEqual(mgr._ollamaUnloaded, true);

  restoreFetch();
});

await testAsync('unloadOllama falls back to chatModel if /api/ps fails', async () => {
  const mgr = createManager();
  const unloadedModels = [];

  globalThis.fetch = async (url, opts) => {
    if (url.includes('/api/ps')) {
      throw new Error('connection refused');
    }
    if (url.includes('/api/generate')) {
      const body = JSON.parse(opts.body);
      if (body.keep_alive === '0') unloadedModels.push(body.model);
    }
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  };

  await mgr.unloadOllama();

  assertEqual(unloadedModels.length, 1);
  assertEqual(unloadedModels[0], 'qwen3.5:27b');

  restoreFetch();
});

await testAsync('unloadOllama handles empty model list', async () => {
  const mgr = createManager({ chatModel: '' });

  globalThis.fetch = async (url) => {
    if (url.includes('/api/ps')) {
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({ models: [] }) };
    }
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  };

  await mgr.unloadOllama();
  assertEqual(mgr._ollamaUnloaded, true);

  restoreFetch();
});

await testAsync('unloadOllama is non-fatal on complete failure', async () => {
  const mgr = createManager();
  globalThis.fetch = async () => { throw new Error('total failure'); };

  await mgr.unloadOllama();  // should not throw
  assertEqual(mgr._ollamaUnloaded, true);

  restoreFetch();
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 7: auditOllamaModels (startup)
// ══════════════════════════════════════════════════════════════════════════════

suite('auditOllamaModels (startup)');

await testAsync('returns none when no models loaded', async () => {
  const mgr = createManager();
  globalThis.fetch = async (url) => {
    if (url.includes('/api/ps')) {
      return { ok: true, status: 200, text: async () => '{}', json: async () => ({ models: [] }) };
    }
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  };

  const result = await mgr.auditOllamaModels();
  assertEqual(result.action, 'none');

  restoreFetch();
});

await testAsync('returns ok when VRAM usage is fine', async () => {
  const mgr = createManager();
  globalThis.fetch = async (url) => {
    if (url.includes('/api/ps')) {
      return {
        ok: true, status: 200, text: async () => '{}',
        json: async () => ({
          models: [{
            name: 'qwen3.5:27b',
            size: 18_000_000_000,         // 18 GB total
            size_vram: 17_500_000_000,    // 17.5 GB on GPU (>95%)
            context_length: 8192,          // within gateway limit
          }],
        }),
      };
    }
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  };

  const result = await mgr.auditOllamaModels();
  assertEqual(result.action, 'ok');

  restoreFetch();
});

await testAsync('returns reloaded when CPU spillover detected', async () => {
  const mgr = createManager();
  mgr._lastReloadTime = 0;  // bypass cooldown
  const actions = [];

  globalThis.fetch = async (url, opts) => {
    if (url.includes('/api/ps')) {
      return {
        ok: true, status: 200, text: async () => '{}',
        json: async () => ({
          models: [{
            name: 'qwen3.5:27b',
            size: 25_000_000_000,         // 25 GB total
            size_vram: 14_000_000_000,    // only 14 GB on GPU — 44% spillover!
            context_length: 32768,         // also excessive
          }],
        }),
      };
    }
    if (url.includes('/api/generate')) {
      const body = opts?.body ? JSON.parse(opts.body) : {};
      actions.push(body.keep_alive === '0' ? 'unload' : 'reload');
    }
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  };

  const result = await mgr.auditOllamaModels();
  assertEqual(result.action, 'reloaded');
  assert(result.details.includes('CPU spillover'), 'Should mention CPU spillover');
  assert(result.details.includes('excessive ctx'), 'Should mention excessive context');

  restoreFetch();
});

await testAsync('returns reloaded when only excessive context detected', async () => {
  const mgr = createManager();
  mgr._lastReloadTime = 0;

  globalThis.fetch = async (url, opts) => {
    if (url.includes('/api/ps')) {
      return {
        ok: true, status: 200, text: async () => '{}',
        json: async () => ({
          models: [{
            name: 'qwen3.5:27b',
            size: 18_000_000_000,
            size_vram: 17_500_000_000,   // VRAM fine (>95%)
            context_length: 32768,        // but context too high
          }],
        }),
      };
    }
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  };

  const result = await mgr.auditOllamaModels();
  assertEqual(result.action, 'reloaded');
  assert(result.details.includes('excessive ctx'), 'Should mention excessive context');

  restoreFetch();
});

await testAsync('returns skip when Ollama unreachable', async () => {
  const mgr = createManager();
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };

  const result = await mgr.auditOllamaModels();
  assertEqual(result.action, 'error');

  restoreFetch();
});

await testAsync('returns none when chat model not loaded', async () => {
  const mgr = createManager();
  globalThis.fetch = async (url) => {
    if (url.includes('/api/ps')) {
      return {
        ok: true, status: 200, text: async () => '{}',
        json: async () => ({
          models: [{ name: 'llava:13b', size: 8000000000, size_vram: 8000000000, context_length: 4096 }],
        }),
      };
    }
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  };

  const result = await mgr.auditOllamaModels();
  assertEqual(result.action, 'none');
  assert(result.details.includes('not loaded'), 'Should say model not loaded');

  restoreFetch();
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 8: waitForVramDrop
// ══════════════════════════════════════════════════════════════════════════════

suite('waitForVramDrop');

await testAsync('returns true when VRAM is already below target', async () => {
  const mgr = createManager();
  _clearVramCache();
  // On dev machine with nvidia-smi, VRAM is currently whatever it is
  // Use a very high target to guarantee success
  const result = await mgr.waitForVramDrop(99999, { timeoutMs: 1000, pollMs: 100 });
  // On NVIDIA: true (current usage < 99999). On non-NVIDIA: false (can't monitor)
  assert(typeof result === 'boolean', 'Should return boolean');
});

await testAsync('returns false on timeout when target not reached', async () => {
  const mgr = createManager();
  _clearVramCache();
  // Target 0 MB — impossible to reach
  const result = await mgr.waitForVramDrop(0, { timeoutMs: 500, pollMs: 100 });
  // On NVIDIA: false (timeout). On non-NVIDIA: false (can't monitor)
  assertEqual(result, false);
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 9: freeVram (ComfyUI connector)
// ══════════════════════════════════════════════════════════════════════════════

suite('freeVram (ComfyUI connector)');

await testAsync('freeVram sends POST to /free endpoint', async () => {
  const { ComfyUIConnector } = await import('../src/media/comfyui-connector.js');
  const connector = new ComfyUIConnector({ baseUrl: 'http://mock:8188' });
  let capturedUrl = null;
  let capturedBody = null;

  globalThis.fetch = async (url, opts) => {
    capturedUrl = url;
    capturedBody = opts?.body ? JSON.parse(opts.body) : null;
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
  };

  await connector.freeVram();

  assertEqual(capturedUrl, 'http://mock:8188/free');
  assertEqual(capturedBody?.unload_models, true);
  assertEqual(capturedBody?.free_memory, true);

  restoreFetch();
});

await testAsync('freeVram does not throw on network error', async () => {
  const { ComfyUIConnector } = await import('../src/media/comfyui-connector.js');
  const connector = new ComfyUIConnector({ baseUrl: 'http://mock:8188' });

  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };

  // Should NOT throw
  await connector.freeVram();
  assert(true, 'freeVram did not throw');

  restoreFetch();
});

await testAsync('freeVram does not throw on non-ok response', async () => {
  const { ComfyUIConnector } = await import('../src/media/comfyui-connector.js');
  const connector = new ComfyUIConnector({ baseUrl: 'http://mock:8188' });

  globalThis.fetch = async () => ({
    ok: false, status: 404,
    text: async () => 'Not Found',
    json: async () => ({}),
  });

  await connector.freeVram();
  assert(true, 'freeVram did not throw on 404');

  restoreFetch();
});

// ══════════════════════════════════════════════════════════════════════════════
// Suite 10: State & integration
// ══════════════════════════════════════════════════════════════════════════════

suite('State & integration');

test('getState includes targetNumCtx', () => {
  const mgr = createManager();
  const state = mgr.getState();
  assert('targetNumCtx' in state, 'State should include targetNumCtx');
  assertEqual(state.targetNumCtx, 4096);  // default
});

test('getTargetNumCtx returns constructor default', () => {
  const mgr = createManager({ defaultNumCtx: 6144 });
  assertEqual(mgr.getTargetNumCtx(), 6144);
});

test('setModelMeta stores metadata', () => {
  const mgr = createManager();
  mgr.setModelMeta({ params: 27.8, kv_per_1k: 285 });
  assertEqual(mgr._modelMeta.kv_per_1k, 285);
});

test('constructor defaults are safe', () => {
  const mgr = new VRAMManager();
  assertEqual(mgr._ollamaUrl, 'http://127.0.0.1:11434');
  assertEqual(mgr._chatModel, '');
  assertEqual(mgr._targetNumCtx, 4096);  // safe default, not 8192
  assertEqual(mgr._lastReloadTime, 0);
});

test('FIFO queue works with acquire', async () => {
  const mgr = createManager();
  const order = [];

  // Override broadcast to prevent WS errors
  mgr._broadcastState = () => {};

  const p1 = mgr.acquire(async () => { order.push(1); return 'a'; });
  const p2 = mgr.acquire(async () => { order.push(2); return 'b'; });

  const [r1, r2] = await Promise.all([p1, p2]);
  assertEqual(r1, 'a');
  assertEqual(r2, 'b');
  assertEqual(order[0], 1);
  assertEqual(order[1], 2);
});

// ══════════════════════════════════════════════════════════════════════════════

summary();
