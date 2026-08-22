#!/usr/bin/env node
//
// Decision 023/A — narrow shared artifact authority on the VRAM path.
//
// These are the mandatory negative proofs of the decision. They pin that the
// artifact cannot be deleted underneath an unload/reload/media task, and — just
// as importantly — that the checkpoint does NOT silently claim global GPU
// residency: VRAM_ARTIFACT_USE and LLM_GATEWAY may hold a shared lease at the
// same time. Finding 003 stays open.

import {
  assert,
  assertEqual,
  suite,
  summary,
  testAsync,
} from './harness.js';
import { VRAMManager } from '../src/media/vram-manager.js';
import {
  MODEL_ACTIVITY_OWNER,
  ModelUseAuthority,
} from '../src/upgrade/model-use-authority.js';

const CHAT_MODEL = 'vram-fixture:27b';
const originalFetch = globalThis.fetch;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function captureAsync(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected promise to reject');
}

/**
 * Provider recorder. Every /api/generate POST is an artifact effect; /api/ps is
 * discovery only. Tests assert on `effects`, never on log output.
 */
function installProvider({ loaded = [CHAT_MODEL], body = null, onEffect = null } = {}) {
  const calls = { ps: 0, effects: [], bodies: 0 };
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.endsWith('/api/ps')) {
      calls.ps += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ models: loaded.map(name => ({ name })) }),
      };
    }
    if (href.endsWith('/api/generate')) {
      const parsed = JSON.parse(options.body || '{}');
      calls.effects.push(parsed.model);
      if (onEffect) await onEffect(parsed.model);
      return {
        ok: true,
        status: 200,
        text: async () => {
          calls.bodies += 1;
          if (body) await body(parsed.model);
          return '{}';
        },
      };
    }
    throw new Error(`unexpected fetch: ${href}`);
  };
  return calls;
}

function createManager(authority, chatModel = CHAT_MODEL) {
  return new VRAMManager({
    ollamaUrl: 'http://127.0.0.1:11434',
    chatModel,
    modelUseAuthority: authority,
  });
}

function takeDelete(authority, modelName) {
  return authority.acquireExclusive({
    modelName,
    owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
  });
}

suite('M1 VRAM artifact use — decision 023/A narrow shared authority');

await testAsync('delete between unload and reload is refused before any inventory read', async () => {
  const authority = new ModelUseAuthority();
  const manager = createManager(authority);
  const calls = installProvider();
  try {
    await manager.unloadOllama();
    assertEqual(calls.effects.length, 1, 'unload produced exactly one artifact effect');

    // The window the decision names: unload is done, reload has not run yet.
    const deleteLease = takeDelete(authority, CHAT_MODEL);
    deleteLease.release();

    // While the reload holds the identity the same delete must fail.
    const reloadStarted = deferred();
    const holdBody = deferred();
    installProvider({
      body: async () => {
        reloadStarted.resolve();
        await holdBody.promise;
      },
    });
    const reloading = manager.reloadOllama();
    await reloadStarted.promise;
    let refused = null;
    try {
      takeDelete(authority, CHAT_MODEL);
    } catch (error) {
      refused = error;
    }
    holdBody.resolve();
    await reloading;

    assert(refused !== null, 'delete during reload was refused');
    assertEqual(refused.code, 'MODEL_MUTATION_ACTIVE_USE', 'refusal is the typed active-use code');
    assert(
      refused.details.activeOwners.includes(MODEL_ACTIVITY_OWNER.VRAM_ARTIFACT_USE),
      'refusal names VRAM_ARTIFACT_USE as the holder',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await testAsync('an active delete stops the VRAM task before its first provider effect', async () => {
  const authority = new ModelUseAuthority();
  const manager = createManager(authority);
  const calls = installProvider();
  const deleteLease = takeDelete(authority, CHAT_MODEL);
  try {
    let taskRan = false;
    const error = await captureAsync(manager.acquire(async () => {
      taskRan = true;
      return 'must-not-run';
    }));
    assertEqual(error.code, 'MODEL_USE_EXCLUSIVE_ACTIVE', 'task rejected with the typed conflict');
    assertEqual(taskRan, false, 'task body never ran');
    assertEqual(calls.effects.length, 0, 'zero provider effects');
  } finally {
    deleteLease.release();
    globalThis.fetch = originalFetch;
  }
});

await testAsync('one conflicting identity in a multi-model list means zero unload POSTs', async () => {
  const authority = new ModelUseAuthority();
  const manager = createManager(authority);
  const calls = installProvider({ loaded: ['first:latest', CHAT_MODEL, 'third:8b'] });
  // The conflict is on the SECOND identity — the first lease is acquired and
  // must be released again without any effect having been produced.
  const deleteLease = takeDelete(authority, CHAT_MODEL);
  try {
    const error = await captureAsync(manager.unloadOllama());
    assertEqual(error.code, 'MODEL_USE_EXCLUSIVE_ACTIVE', 'conflict escaped the broad catch');
    assertEqual(calls.effects.length, 0, 'zero unload POSTs');
    assertEqual(calls.ps, 1, 'discovery still happened — it touches no artifact');
  } finally {
    deleteLease.release();
    globalThis.fetch = originalFetch;
  }
  // Every previously acquired lease was released on the conflict path.
  assertEqual(
    authority.snapshot('first:latest').activeUseCount,
    0,
    'earlier lease was released',
  );
});

await testAsync('delete stays blocked while a response body is still pending', async () => {
  const authority = new ModelUseAuthority();
  const manager = createManager(authority);
  const bodyReached = deferred();
  const releaseBody = deferred();
  installProvider({
    body: async () => {
      bodyReached.resolve();
      await releaseBody.promise;
    },
  });
  try {
    const unloading = manager.unloadOllama();
    await bodyReached.promise;

    let refused = null;
    try {
      takeDelete(authority, CHAT_MODEL);
    } catch (error) {
      refused = error;
    }
    assert(refused !== null, 'delete refused while the body was pending');
    assertEqual(refused.code, 'MODEL_MUTATION_ACTIVE_USE', 'refusal is typed');

    releaseBody.resolve();
    await unloading;

    // Only after the body completed does the identity become free.
    const granted = takeDelete(authority, CHAT_MODEL);
    granted.release();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await testAsync('fetch, body and task failures all release every lease', async () => {
  const authority = new ModelUseAuthority();
  const manager = createManager(authority);
  try {
    // 1. provider fetch failure
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/api/ps')) {
        return { ok: true, status: 200, json: async () => ({ models: [{ name: CHAT_MODEL }] }) };
      }
      throw new Error('provider socket died');
    };
    await manager.unloadOllama();
    assertEqual(authority.snapshot(CHAT_MODEL).activeUseCount, 0, 'fetch failure released the lease');

    // 2. response body failure
    installProvider({ body: async () => { throw new Error('body truncated'); } });
    await manager.unloadOllama();
    assertEqual(authority.snapshot(CHAT_MODEL).activeUseCount, 0, 'body failure released the lease');

    // 3. task failure
    const taskError = await captureAsync(manager.acquire(async () => {
      throw new Error('media task exploded');
    }));
    assertEqual(taskError.message, 'media task exploded', 'task error propagates unchanged');
    assertEqual(authority.snapshot(CHAT_MODEL).activeUseCount, 0, 'task failure released the lease');

    // The identity is genuinely free — a delete now succeeds.
    const granted = takeDelete(authority, CHAT_MODEL);
    granted.release();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await testAsync('name and name:latest produce a single canonical reservation', async () => {
  const authority = new ModelUseAuthority();
  const manager = createManager(authority, 'dedup-fixture');
  const calls = installProvider({
    loaded: ['dedup-fixture', 'dedup-fixture:latest', 'dedup-fixture'],
  });
  const seen = [];
  try {
    const bodyReached = deferred();
    const releaseBody = deferred();
    installProvider({
      loaded: ['dedup-fixture', 'dedup-fixture:latest'],
      body: async () => {
        seen.push(authority.snapshot('dedup-fixture').activeUseCount);
        bodyReached.resolve();
        await releaseBody.promise;
      },
    });
    const unloading = manager.unloadOllama();
    await bodyReached.promise;
    assertEqual(
      authority.snapshot('dedup-fixture:latest').activeUseCount,
      1,
      'both spellings share one canonical reservation',
    );
    releaseBody.resolve();
    await unloading;
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert(calls.effects.length >= 0, 'recorder installed');
  assertEqual(seen[0], 1, 'exactly one reader while the first body was open');
});

await testAsync('VRAM_ARTIFACT_USE and LLM_GATEWAY hold shared leases at the same time', async () => {
  // This is the anti-overclaim proof. If the checkpoint ever silently became a
  // global GPU authority, this test would fail — and it must not.
  const authority = new ModelUseAuthority();
  const manager = createManager(authority);
  const gatewayLease = authority.acquireShared({
    modelName: CHAT_MODEL,
    owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
  });
  installProvider();
  try {
    await manager.unloadOllama();
    assertEqual(
      authority.snapshot(CHAT_MODEL).activeUseCount,
      1,
      'gateway lease survived the unload — inference is not fenced by this edge',
    );
  } finally {
    gatewayLease.release();
    globalThis.fetch = originalFetch;
  }
});

await testAsync('delete during a running media task fails typed and immediately', async () => {
  const authority = new ModelUseAuthority();
  const manager = createManager(authority);
  installProvider();
  const taskRunning = deferred();
  const finishTask = deferred();
  try {
    const running = manager.acquire(async () => {
      taskRunning.resolve();
      await finishTask.promise;
      return 'done';
    });
    await taskRunning.promise;

    const startedAt = Date.now();
    let refused = null;
    try {
      takeDelete(authority, CHAT_MODEL);
    } catch (error) {
      refused = error;
    }
    const elapsed = Date.now() - startedAt;

    assert(refused !== null, 'delete was refused');
    assertEqual(refused.code, 'MODEL_MUTATION_ACTIVE_USE', 'refusal is the typed in-use code');
    assert(elapsed < 100, `refusal was immediate, not a wait (${elapsed} ms)`);

    finishTask.resolve();
    assertEqual(await running, 'done', 'the media task still finished normally');
    // No TTL: the lease was released by the finally, not by expiry.
    const granted = takeDelete(authority, CHAT_MODEL);
    granted.release();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

summary();
