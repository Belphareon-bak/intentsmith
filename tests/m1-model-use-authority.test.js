#!/usr/bin/env node

import {
  assert,
  assertEqual,
  suite,
  summary,
  test,
  testAsync,
} from './harness.js';
import Database from 'better-sqlite3';
import { ModelRegistry } from '../src/upgrade/model-registry.js';
import { UpgradeManager } from '../src/upgrade/upgrade-manager.js';
import { callWithAuth, llmGateway } from '../src/llm/gateway.js';
import { createAuthToken } from '../src/llm/auth-types.js';
import { AbortSource, abortWithReason } from '../src/core/abort-error.js';
import {
  MODEL_ACTIVITY_OWNER,
  ModelUseAuthority,
  modelUseAuthority,
} from '../src/upgrade/model-use-authority.js';

const DIGEST = 'a'.repeat(64);
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

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('expected callback to throw');
}

async function captureAsync(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected promise to reject');
}

function installedModel(name = 'lease-fixture:latest') {
  return {
    name,
    digestSha256: DIGEST,
    digest: `sha256:${DIGEST}`,
    sizeGB: '1.0',
  };
}

function gatewayToken(suffix) {
  return createAuthToken({
    role: 'CRE_DECISION',
    decisionId: `model-use-authority-${suffix}`,
    auditContext: { sessionId: `model-use-authority-${suffix}` },
  });
}

function providerChatResponse(content) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ message: { role: 'assistant', content } }),
  };
}

function stalledProviderBody(signal, started) {
  return {
    ok: true,
    status: 200,
    json: async () => {
      started.resolve();
      if (signal.aborted) throw signal.reason;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  };
}

function createRegistry(authority) {
  const registry = new ModelRegistry();
  registry.init({
    db: null,
    upgradeManager: null,
    modelBindingApplication: {
      getProtectedModelNames: () => [],
      runExclusiveModelMutation: async (_input, callback) => callback(),
      applyManualBinding: async () => ({ ok: true }),
    },
    broadcast: () => {},
    modelUseAuthority: authority,
  });
  return registry;
}

suite('M1 model use authority — per-canonical shared/exclusive leases');

test('request shape and owner vocabulary fail closed', () => {
  const authority = new ModelUseAuthority();
  for (const request of [
    null,
    {},
    Object.assign(Object.create({ inherited: true }), {
      modelName: 'fixture',
      owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
    }),
    { modelName: 'fixture', owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY, extra: true },
    { modelName: '', owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY },
    { modelName: 'fixture', owner: 'UNREGISTERED_OWNER' },
  ]) {
    const error = captureError(() => authority.acquireShared(request));
    assertEqual(error.code, 'MODEL_USE_INPUT_INVALID');
  }
  const sharedMutationOwner = captureError(() => authority.acquireShared({
    modelName: 'fixture',
    owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
  }));
  assertEqual(sharedMutationOwner.code, 'MODEL_USE_INPUT_INVALID');
  const exclusiveUseOwner = captureError(() => authority.acquireExclusive({
    modelName: 'fixture',
    owner: MODEL_ACTIVITY_OWNER.MODEL_VALIDATION,
  }));
  assertEqual(exclusiveUseOwner.code, 'MODEL_USE_INPUT_INVALID');
});

test('latest alias shares one canonical lease state', () => {
  const authority = new ModelUseAuthority();
  const first = authority.acquireShared({
    modelName: 'Lease-Fixture',
    owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
  });
  const second = authority.acquireShared({
    modelName: 'lease-fixture:latest',
    owner: MODEL_ACTIVITY_OWNER.MODEL_VALIDATION,
  });
  assertEqual(authority.snapshot('LEASE-FIXTURE:latest').activeUseCount, 2);
  const blocked = captureError(() => authority.acquireExclusive({
    modelName: 'lease-fixture',
    owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
  }));
  assertEqual(blocked.code, 'MODEL_MUTATION_ACTIVE_USE');
  assertEqual(blocked.details.activeUseCount, 2);
  second.release();
  first.release();
  assertEqual(authority.snapshot('lease-fixture').activeUseCount, 0);
});

test('independent canonical identities never share a global lock', () => {
  const authority = new ModelUseAuthority();
  const first = authority.acquireExclusive({
    modelName: 'first-fixture:latest',
    owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
  });
  const second = authority.acquireShared({
    modelName: 'second-fixture:latest',
    owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
  });
  assertEqual(authority.snapshot('first-fixture').exclusiveOwner, MODEL_ACTIVITY_OWNER.MODEL_DELETE);
  assertEqual(authority.snapshot('second-fixture').activeUseCount, 1);
  second.release();
  first.release();
});

test('exclusive lease blocks new use and a second mutation', () => {
  const authority = new ModelUseAuthority();
  const lease = authority.acquireExclusive({
    modelName: 'lease-fixture',
    owner: MODEL_ACTIVITY_OWNER.MODEL_PULL,
  });
  const useError = captureError(() => authority.acquireShared({
    modelName: 'lease-fixture:latest',
    owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
  }));
  assertEqual(useError.code, 'MODEL_USE_EXCLUSIVE_ACTIVE');
  assertEqual(useError.details.owner, MODEL_ACTIVITY_OWNER.MODEL_PULL);
  const mutationError = captureError(() => authority.acquireExclusive({
    modelName: 'lease-fixture',
    owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
  }));
  assertEqual(mutationError.code, 'MODEL_MUTATION_EXCLUSIVE_ACTIVE');
  lease.release();
});

await testAsync('callback helpers release both modes after rejection', async () => {
  const authority = new ModelUseAuthority();
  const sharedError = await captureAsync(authority.runShared({
    modelName: 'lease-fixture',
    owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
  }, async () => {
    throw new Error('shared fixture failure');
  }));
  assertEqual(sharedError.message, 'shared fixture failure');
  assertEqual(authority.snapshot('lease-fixture').activeUseCount, 0);

  const exclusiveError = await captureAsync(authority.runExclusive({
    modelName: 'lease-fixture',
    owner: MODEL_ACTIVITY_OWNER.MODEL_PULL,
  }, async () => {
    throw new Error('exclusive fixture failure');
  }));
  assertEqual(exclusiveError.message, 'exclusive fixture failure');
  assertEqual(authority.snapshot('lease-fixture').exclusiveOwner, null);
});

test('a lease cannot be released twice', () => {
  const authority = new ModelUseAuthority();
  const lease = authority.acquireShared({
    modelName: 'lease-fixture',
    owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
  });
  lease.release();
  const error = captureError(() => lease.release());
  assertEqual(error.code, 'MODEL_USE_LEASE_RELEASED');
});

suite('M1 model use authority — registry use/delete races');

await testAsync('generic active use blocks delete with a typed error before inventory', async () => {
  const authority = new ModelUseAuthority();
  let inventoryCalls = 0;
  let providerCalls = 0;
  const registry = createRegistry(authority);
  registry.getInstalled = async () => {
    inventoryCalls += 1;
    return [installedModel()];
  };
  globalThis.fetch = async () => {
    providerCalls += 1;
    return { ok: true };
  };
  const useLease = authority.acquireShared({
    modelName: 'lease-fixture:latest',
    owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
  });
  try {
    const error = await captureAsync(registry.deleteModel('lease-fixture', {
      expectedDigestSha256: DIGEST,
    }));
    assertEqual(error.code, 'MODEL_DELETE_IN_USE');
    assertEqual(inventoryCalls, 0);
    assertEqual(providerCalls, 0);
  } finally {
    useLease.release();
    globalThis.fetch = originalFetch;
  }
});

await testAsync('delete holds exclusive ownership through the provider effect', async () => {
  const authority = new ModelUseAuthority();
  const providerGate = deferred();
  let providerCalls = 0;
  const registry = createRegistry(authority);
  registry.getInstalled = async () => [installedModel()];
  globalThis.fetch = async () => {
    providerCalls += 1;
    await providerGate.promise;
    return { ok: true };
  };
  try {
    const deletion = registry.deleteModel('lease-fixture:latest', {
      expectedDigestSha256: DIGEST,
    });
    while (providerCalls === 0) await Promise.resolve();
    const blocked = captureError(() => authority.acquireShared({
      modelName: 'lease-fixture',
      owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
    }));
    assertEqual(blocked.code, 'MODEL_USE_EXCLUSIVE_ACTIVE');
    assertEqual(blocked.details.owner, MODEL_ACTIVITY_OWNER.MODEL_DELETE);
    providerGate.resolve();
    await deletion;
    assertEqual(authority.snapshot('lease-fixture').exclusiveOwner, null);
  } finally {
    providerGate.resolve();
    globalThis.fetch = originalFetch;
  }
});

suite('M1 model use authority — pull/delete serialization');

await testAsync('active shared use blocks pull before the provider request', async () => {
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    throw new Error('unexpected provider effect');
  };
  const useLease = modelUseAuthority.acquireShared({
    modelName: 'pull-lease-fixture',
    owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
  });
  try {
    const manager = new UpgradeManager();
    const error = await captureAsync(manager.pullModel('pull-lease-fixture:latest'));
    assertEqual(error.code, 'MODEL_MUTATION_ACTIVE_USE');
    assertEqual(providerCalls, 0);
  } finally {
    useLease.release();
    globalThis.fetch = originalFetch;
  }
});

await testAsync('pull holds exclusive ownership through the streamed response', async () => {
  const readGate = deferred();
  let reads = 0;
  globalThis.fetch = async () => ({
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          reads += 1;
          if (reads === 1) await readGate.promise;
          return { done: true, value: undefined };
        },
      }),
    },
  });
  try {
    const manager = new UpgradeManager();
    const pull = manager.pullModel('pull-stream-fixture:latest');
    while (reads === 0) await Promise.resolve();
    const blocked = captureError(() => modelUseAuthority.acquireShared({
      modelName: 'pull-stream-fixture',
      owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
    }));
    assertEqual(blocked.code, 'MODEL_USE_EXCLUSIVE_ACTIVE');
    assertEqual(blocked.details.owner, MODEL_ACTIVITY_OWNER.MODEL_PULL);
    readGate.resolve();
    await pull;
    assertEqual(modelUseAuthority.snapshot('pull-stream-fixture').exclusiveOwner, null);
  } finally {
    readGate.resolve();
    globalThis.fetch = originalFetch;
  }
});

await testAsync('default registry and pull wiring share the production singleton', async () => {
  const readGate = deferred();
  let reads = 0;
  let inventoryCalls = 0;
  let deleteCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/pull')) {
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => {
              reads += 1;
              if (reads === 1) await readGate.promise;
              return { done: true, value: undefined };
            },
          }),
        },
      };
    }
    deleteCalls += 1;
    return { ok: true };
  };
  const registry = createRegistry(undefined);
  registry.getInstalled = async () => {
    inventoryCalls += 1;
    return [installedModel('default-wire-fixture:latest')];
  };
  try {
    const manager = new UpgradeManager();
    const pull = manager.pullModel('default-wire-fixture:latest');
    while (reads === 0) await Promise.resolve();
    const blocked = await captureAsync(registry.deleteModel('default-wire-fixture', {
      expectedDigestSha256: DIGEST,
    }));
    assertEqual(blocked.code, 'MODEL_DELETE_IN_USE');
    assertEqual(inventoryCalls, 0);
    assertEqual(deleteCalls, 0);

    readGate.resolve();
    await pull;
    const deleted = await registry.deleteModel('default-wire-fixture', {
      expectedDigestSha256: DIGEST,
    });
    assertEqual(deleted.deleted, 'default-wire-fixture:latest');
    assertEqual(inventoryCalls, 2);
    assertEqual(deleteCalls, 1);
  } finally {
    readGate.resolve();
    globalThis.fetch = originalFetch;
  }
});

suite('M1 model use authority — gateway provider lifecycle');

await testAsync('gateway usage binds caller telemetry to the served durable artifact digest', async () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE model_desired_bindings (
      role TEXT PRIMARY KEY, model_name TEXT NOT NULL, digest_sha256 TEXT NOT NULL
    );
    CREATE TABLE model_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      role TEXT NOT NULL,
      request_type TEXT,
      model_digest_sha256 TEXT
    );
  `);
  db.prepare(`
    INSERT INTO model_desired_bindings(role, model_name, digest_sha256)
    VALUES ('CHAT', 'usage-fixture:latest', ?)
  `).run(DIGEST);
  globalThis.fetch = async () => providerChatResponse('tracked');
  llmGateway.setUsageDb(db);
  try {
    const result = await callWithAuth(gatewayToken('digest-usage'), 'track me', {
      model: 'usage-fixture', capability: 'reasoning', retries: 1,
    });
    assertEqual(result.content, 'tracked');
    const row = db.prepare('SELECT role, model_digest_sha256 FROM model_usage').get();
    assertEqual(row.role, 'CRE_DECISION');
    assertEqual(row.model_digest_sha256, DIGEST);
  } finally {
    llmGateway.setUsageDb(null);
    db.close();
    globalThis.fetch = originalFetch;
  }
});

await testAsync('pre-provider setup failure releases the semaphore without a model lease', async () => {
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return providerChatResponse('unexpected');
  };
  const options = {
    _authToken: gatewayToken('setup-failure'),
    model: 'gateway-setup-fixture:latest',
    capability: 'reasoning',
    retries: 1,
  };
  Object.defineProperty(options, 'format', {
    enumerable: true,
    get() { throw new Error('owned setup fixture failure'); },
  });
  try {
    const error = await captureAsync(llmGateway.call('setup failure', options));
    assertEqual(error.message, 'owned setup fixture failure');
    assertEqual(providerCalls, 0);
    assertEqual(modelUseAuthority.snapshot('gateway-setup-fixture').activeUseCount, 0);
    assertEqual(llmGateway.getConcurrencyStats().active, 0);
    assertEqual(llmGateway.getConcurrencyStats().queued, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await testAsync('active model mutation blocks gateway before provider and releases its slot', async () => {
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return providerChatResponse('unexpected');
  };
  const mutationLease = modelUseAuthority.acquireExclusive({
    modelName: 'gateway-blocked-fixture',
    owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
  });
  try {
    const error = await captureAsync(callWithAuth(
      gatewayToken('mutation-blocked'),
      'must not reach provider',
      {
        model: 'gateway-blocked-fixture:latest',
        capability: 'reasoning',
        retries: 1,
      },
    ));
    assertEqual(error.code, 'MODEL_USE_EXCLUSIVE_ACTIVE');
    assertEqual(providerCalls, 0);
    assertEqual(llmGateway.getConcurrencyStats().active, 0);
    assertEqual(llmGateway.getConcurrencyStats().queued, 0);
  } finally {
    mutationLease.release();
    globalThis.fetch = originalFetch;
  }
});

await testAsync('in-flight gateway use blocks delete until the provider terminal', async () => {
  const providerGate = deferred();
  let providerCalls = 0;
  let inventoryCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/delete')) return { ok: true };
    providerCalls += 1;
    await providerGate.promise;
    return providerChatResponse('gateway complete');
  };
  const registry = createRegistry(undefined);
  registry.getInstalled = async () => {
    inventoryCalls += 1;
    return [installedModel('gateway-race-fixture:latest')];
  };
  let gatewayCall;
  try {
    gatewayCall = callWithAuth(
      gatewayToken('delete-race'),
      'hold provider open',
      {
        model: 'gateway-race-fixture:latest',
        capability: 'reasoning',
        retries: 1,
      },
    );
    while (providerCalls === 0) await Promise.resolve();
    const blocked = await captureAsync(registry.deleteModel('gateway-race-fixture', {
      expectedDigestSha256: DIGEST,
    }));
    assertEqual(blocked.code, 'MODEL_DELETE_IN_USE');
    assertEqual(inventoryCalls, 0);
    providerGate.resolve();
    assertEqual((await gatewayCall).content, 'gateway complete');
    assertEqual(modelUseAuthority.snapshot('gateway-race-fixture').activeUseCount, 0);
    assertEqual(llmGateway.getConcurrencyStats().active, 0);
  } finally {
    providerGate.resolve();
    await gatewayCall?.catch(() => {});
    globalThis.fetch = originalFetch;
  }
});

await testAsync('a queued gateway request does not reserve its model early', async () => {
  const originalMax = llmGateway._concurrency.max;
  const firstGate = deferred();
  let firstStarted = false;
  let providerCalls = 0;
  globalThis.fetch = async (_url, options) => {
    providerCalls += 1;
    const body = JSON.parse(options.body);
    if (body.model === 'gateway-owner-fixture') {
      firstStarted = true;
      await firstGate.promise;
      return providerChatResponse('first complete');
    }
    return providerChatResponse('second complete');
  };
  try {
    llmGateway._concurrency.max = 1;
    const first = callWithAuth(gatewayToken('queue-owner'), 'first', {
      model: 'gateway-owner-fixture',
      capability: 'reasoning',
      retries: 1,
    });
    while (!firstStarted) await Promise.resolve();
    const second = callWithAuth(gatewayToken('queue-waiter'), 'second', {
      model: 'gateway-queued-fixture',
      capability: 'reasoning',
      retries: 1,
    });
    while (llmGateway.getConcurrencyStats().queued !== 1) await Promise.resolve();

    const mutationLease = modelUseAuthority.acquireExclusive({
      modelName: 'gateway-queued-fixture:latest',
      owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
    });
    mutationLease.release();

    firstGate.resolve();
    assertEqual((await first).content, 'first complete');
    assertEqual((await second).content, 'second complete');
    assertEqual(providerCalls, 2);
    assertEqual(llmGateway.getConcurrencyStats().active, 0);
    assertEqual(llmGateway.getConcurrencyStats().queued, 0);
  } finally {
    firstGate.resolve();
    llmGateway._concurrency.max = originalMax;
    llmGateway._concurrency.active = 0;
    llmGateway._concurrency.queue.length = 0;
    globalThis.fetch = originalFetch;
  }
});

await testAsync('already-aborted request keeps cancellation precedence over an active mutation', async () => {
  let providerCalls = 0;
  globalThis.fetch = async () => {
    providerCalls += 1;
    return providerChatResponse('unexpected');
  };
  const mutationLease = modelUseAuthority.acquireExclusive({
    modelName: 'gateway-pre-abort-fixture',
    owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
  });
  const controller = new AbortController();
  controller.abort();
  try {
    const error = await captureAsync(callWithAuth(
      gatewayToken('pre-abort'),
      'cancel before ownership',
      {
        model: 'gateway-pre-abort-fixture:latest',
        capability: 'reasoning',
        retries: 1,
        signal: controller.signal,
      },
    ));
    assertEqual(error.name, 'AbortError');
    assertEqual(providerCalls, 0);
    assertEqual(llmGateway.getConcurrencyStats().active, 0);
    assertEqual(llmGateway.getConcurrencyStats().queued, 0);
  } finally {
    mutationLease.release();
    globalThis.fetch = originalFetch;
  }
});

await testAsync('gateway timeout owns the response body and releases lease and slot', async () => {
  const bodyStarted = deferred();
  let providerCalls = 0;
  globalThis.fetch = async (_url, options) => {
    providerCalls += 1;
    return stalledProviderBody(options.signal, bodyStarted);
  };
  let call;
  try {
    call = callWithAuth(gatewayToken('body-timeout'), 'stall body', {
      model: 'gateway-body-timeout-fixture:latest',
      capability: 'reasoning',
      retries: 1,
      timeout: 10,
    });
    await bodyStarted.promise;
    assertEqual(modelUseAuthority.snapshot('gateway-body-timeout-fixture').activeUseCount, 1);
    const blocked = captureError(() => modelUseAuthority.acquireExclusive({
      modelName: 'gateway-body-timeout-fixture',
      owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
    }));
    assertEqual(blocked.code, 'MODEL_MUTATION_ACTIVE_USE');
    const error = await captureAsync(call);
    assertEqual(error.name, 'AbortError');
    assertEqual(error.abortSource, AbortSource.TIMEOUT);
    assertEqual(providerCalls, 1);
    assertEqual(modelUseAuthority.snapshot('gateway-body-timeout-fixture').activeUseCount, 0);
    const mutationLease = modelUseAuthority.acquireExclusive({
      modelName: 'gateway-body-timeout-fixture',
      owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
    });
    mutationLease.release();
    assertEqual(llmGateway.getConcurrencyStats().active, 0);
    assertEqual(llmGateway.getConcurrencyStats().queued, 0);
  } finally {
    await call?.catch(() => {});
    globalThis.fetch = originalFetch;
  }
});

await testAsync('user cancel owns the response body and releases lease and slot', async () => {
  const bodyStarted = deferred();
  const controller = new AbortController();
  let providerCalls = 0;
  globalThis.fetch = async (_url, options) => {
    providerCalls += 1;
    return stalledProviderBody(options.signal, bodyStarted);
  };
  let call;
  try {
    call = callWithAuth(gatewayToken('body-cancel'), 'cancel body', {
      model: 'gateway-body-cancel-fixture:latest',
      capability: 'reasoning',
      retries: 1,
      timeout: 1000,
      signal: controller.signal,
    });
    await bodyStarted.promise;
    assertEqual(modelUseAuthority.snapshot('gateway-body-cancel-fixture').activeUseCount, 1);
    const blocked = captureError(() => modelUseAuthority.acquireExclusive({
      modelName: 'gateway-body-cancel-fixture',
      owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
    }));
    assertEqual(blocked.code, 'MODEL_MUTATION_ACTIVE_USE');
    abortWithReason(controller, AbortSource.USER, 'fixture user cancellation');
    const error = await captureAsync(call);
    assertEqual(error.name, 'AbortError');
    assertEqual(error.abortSource, AbortSource.USER);
    assertEqual(error.message, 'fixture user cancellation');
    assertEqual(providerCalls, 1);
    assertEqual(modelUseAuthority.snapshot('gateway-body-cancel-fixture').activeUseCount, 0);
    const mutationLease = modelUseAuthority.acquireExclusive({
      modelName: 'gateway-body-cancel-fixture',
      owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
    });
    mutationLease.release();
    assertEqual(llmGateway.getConcurrencyStats().active, 0);
    assertEqual(llmGateway.getConcurrencyStats().queued, 0);
  } finally {
    controller.abort();
    await call?.catch(() => {});
    globalThis.fetch = originalFetch;
  }
});

await testAsync('gateway keeps one lease across a retry delay', async () => {
  const originalSleep = llmGateway.sleep;
  const retryStarted = deferred();
  const retryGate = deferred();
  let providerCalls = 0;
  let inventoryCalls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/api/delete')) return { ok: true };
    providerCalls += 1;
    if (providerCalls === 1) {
      throw Object.assign(new Error('fixture refused'), { code: 'ECONNREFUSED' });
    }
    return providerChatResponse('retry complete');
  };
  llmGateway.sleep = async () => {
    retryStarted.resolve();
    await retryGate.promise;
  };
  const registry = createRegistry(undefined);
  registry.getInstalled = async () => {
    inventoryCalls += 1;
    return [installedModel('gateway-retry-fixture:latest')];
  };
  let call;
  try {
    call = callWithAuth(gatewayToken('retry-lease'), 'retry once', {
      model: 'gateway-retry-fixture:latest',
      capability: 'reasoning',
      retries: 2,
    });
    await retryStarted.promise;
    const blocked = await captureAsync(registry.deleteModel('gateway-retry-fixture', {
      expectedDigestSha256: DIGEST,
    }));
    assertEqual(blocked.code, 'MODEL_DELETE_IN_USE');
    assertEqual(inventoryCalls, 0);
    retryGate.resolve();
    assertEqual((await call).content, 'retry complete');
    assertEqual(providerCalls, 2);
    assertEqual(modelUseAuthority.snapshot('gateway-retry-fixture').activeUseCount, 0);
    assertEqual(llmGateway.getConcurrencyStats().active, 0);
    assertEqual(llmGateway.getConcurrencyStats().queued, 0);
  } finally {
    retryGate.resolve();
    await call?.catch(() => {});
    llmGateway.sleep = originalSleep;
    globalThis.fetch = originalFetch;
  }
});

await testAsync('malformed provider body cannot leak gateway ownership', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => { throw new SyntaxError('private malformed fixture'); },
  });
  try {
    const error = await captureAsync(callWithAuth(
      gatewayToken('malformed-cleanup'),
      'malformed response',
      {
        model: 'gateway-malformed-fixture:latest',
        capability: 'reasoning',
        retries: 1,
      },
    ));
    assertEqual(error.message.includes('private malformed fixture'), false);
    assertEqual(modelUseAuthority.snapshot('gateway-malformed-fixture').activeUseCount, 0);
    assertEqual(llmGateway.getConcurrencyStats().active, 0);
    assertEqual(llmGateway.getConcurrencyStats().queued, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await testAsync('provider AbortError without owned signal abort remains malformed response', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      const error = new Error('untrusted provider abort label');
      error.name = 'AbortError';
      throw error;
    },
  });
  try {
    const error = await captureAsync(callWithAuth(
      gatewayToken('foreign-abort-label'),
      'foreign abort label',
      {
        model: 'gateway-foreign-abort-fixture:latest',
        capability: 'reasoning',
        retries: 1,
      },
    ));
    assertEqual(error.name, 'Error');
    assertEqual(error.cause?.code, 'LLM_PROVIDER_MALFORMED_RESPONSE');
    assertEqual(error.message.includes('untrusted provider abort label'), false);
    assertEqual(modelUseAuthority.snapshot('gateway-foreign-abort-fixture').activeUseCount, 0);
    assertEqual(llmGateway.getConcurrencyStats().active, 0);
    assertEqual(llmGateway.getConcurrencyStats().queued, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

globalThis.fetch = originalFetch;
summary();
