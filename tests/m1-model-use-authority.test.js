#!/usr/bin/env node

import {
  assert,
  assertEqual,
  suite,
  summary,
  test,
  testAsync,
} from './harness.js';
import { ModelRegistry } from '../src/upgrade/model-registry.js';
import { UpgradeManager } from '../src/upgrade/upgrade-manager.js';
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

function createRegistry(authority, validationRunner = null) {
  const registry = new ModelRegistry();
  registry.init({
    db: null,
    upgradeManager: null,
    modelBindingApplication: {
      getProtectedModelNames: () => [],
      runExclusiveModelMutation: async (_input, callback) => callback(),
      applyManualBinding: async () => ({ ok: true }),
    },
    validationRunner,
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

suite('M1 model use authority — registry validation/delete races');

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

await testAsync('active validation blocks delete before inventory and provider effects', async () => {
  const authority = new ModelUseAuthority();
  const validationGate = deferred();
  let runnerCalls = 0;
  let inventoryCalls = 0;
  let providerCalls = 0;
  const registry = createRegistry(authority, {
    async runAll() {
      runnerCalls += 1;
      await validationGate.promise;
      return { overallScore: 1, results: [] };
    },
  });
  registry.getInstalled = async () => {
    inventoryCalls += 1;
    return [installedModel()];
  };
  globalThis.fetch = async () => {
    providerCalls += 1;
    return { ok: true };
  };
  try {
    const reservation = registry.startValidation(
      'lease-fixture:latest',
      ['reasoning'],
      () => {},
    );
    await Promise.resolve();
    assertEqual(runnerCalls, 1);
    const error = await captureAsync(registry.deleteModel('lease-fixture', {
      expectedDigestSha256: DIGEST,
    }));
    assertEqual(error.code, 'MODEL_DELETE_VALIDATING');
    assertEqual(inventoryCalls, 0);
    assertEqual(providerCalls, 0);
    validationGate.resolve();
    await reservation.completion;
    assertEqual(authority.snapshot('lease-fixture').activeUseCount, 0);
  } finally {
    validationGate.resolve();
    globalThis.fetch = originalFetch;
  }
});

await testAsync('batch validation refuses a model held by an exclusive mutation', async () => {
  const authority = new ModelUseAuthority();
  let runnerCalls = 0;
  const registry = createRegistry(authority, {
    async runAll() {
      runnerCalls += 1;
      return { overallScore: 1, results: [] };
    },
    getAllScores: () => new Map(),
  });
  registry.getInstalled = async () => [installedModel()];
  const mutationLease = authority.acquireExclusive({
    modelName: 'lease-fixture',
    owner: MODEL_ACTIVITY_OWNER.MODEL_PULL,
  });
  try {
    const accepted = await registry.validateAll();
    assertEqual(accepted.queued.length, 1);
    while (registry._batchRunning) await Promise.resolve();
    assertEqual(runnerCalls, 0);
  } finally {
    mutationLease.release();
  }
});

await testAsync('delete reservation rejects a newly starting validation before its runner', async () => {
  const authority = new ModelUseAuthority();
  const inventoryGate = deferred();
  let inventoryCalls = 0;
  let runnerCalls = 0;
  const registry = createRegistry(authority, {
    async runAll() {
      runnerCalls += 1;
      return { overallScore: 1, results: [] };
    },
  });
  registry.getInstalled = async () => {
    inventoryCalls += 1;
    if (inventoryCalls === 1) await inventoryGate.promise;
    return [installedModel()];
  };
  globalThis.fetch = async () => ({ ok: true });
  try {
    const deletion = registry.deleteModel('lease-fixture:latest', {
      expectedDigestSha256: DIGEST,
    });
    while (inventoryCalls === 0) await Promise.resolve();
    const error = captureError(() => registry.startValidation(
      'lease-fixture',
      ['reasoning'],
      () => {},
    ));
    assertEqual(error.code, 'MODEL_VALIDATION_MODEL_MUTATING');
    assertEqual(runnerCalls, 0);
    inventoryGate.resolve();
    const result = await deletion;
    assertEqual(result.deleted, 'lease-fixture:latest');
  } finally {
    inventoryGate.resolve();
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

suite('M1 model use authority — legacy pull/delete serialization');

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

globalThis.fetch = originalFetch;
summary();
