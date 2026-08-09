#!/usr/bin/env node

import Database from 'better-sqlite3';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { Worker } from 'node:worker_threads';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

import {
  assert,
  assertEqual,
  suite,
  summary,
  testAsync,
} from './harness.js';
import { runMigrations } from '../src/db/migrate.js';
import { config } from '../src/config.js';
import {
  createModelFailoverRepository,
} from '../src/upgrade/model-failover.js';
import {
  ModelBindingApplicationError,
  OllamaModelBindingProvider,
  createModelBindingApplication,
} from '../src/upgrade/model-binding-application.js';
import {
  canonicalModelName,
  sameModelName,
} from '../src/upgrade/model-identity.js';
import {
  MODEL_ACTIVITY_OWNER,
  ModelUseAuthority,
  modelUseAuthority as productionModelUseAuthority,
} from '../src/upgrade/model-use-authority.js';
import { ModelRegistry } from '../src/upgrade/model-registry.js';
import { UpgradeManager } from '../src/upgrade/upgrade-manager.js';
import { createSystemRoutes } from '../src/routes/system.js';
import {
  preHandle,
  setModelBindingApplication,
  setModelRegistry,
  setUpgradeManager,
} from '../src/chat/handlers/pre-handler.js';
import {
  _testInternals as wsServerTestInternals,
  broadcast as productionBroadcast,
} from '../src/ws-bridge/ws-server.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);
const ORIGINAL_BINDINGS = { ...config.models };

function restoreBindings() {
  for (const key of Object.keys(config.models)) delete config.models[key];
  Object.assign(config.models, ORIGINAL_BINDINGS);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function captureError(promiseOrCallback) {
  try {
    if (typeof promiseOrCallback === 'function') {
      await promiseOrCallback();
    } else {
      await promiseOrCallback;
    }
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to fail');
}

function model(name, digestSha256) {
  return Object.freeze({
    name,
    canonicalName: canonicalModelName(name),
    digestSha256,
  });
}

function assertMutationBlocked(authority, modelName, expectedOwner) {
  let error = null;
  let unexpectedLease = null;
  try {
    unexpectedLease = authority.acquireExclusive({
      modelName,
      owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
    });
  } catch (caught) {
    error = caught;
  } finally {
    unexpectedLease?.release();
  }
  assert(error, `Expected mutation to be blocked for ${modelName}`);
  assertEqual(error.code, 'MODEL_MUTATION_ACTIVE_USE');
  assert(error.details.activeOwners.includes(expectedOwner));
}

function assertMutationAvailable(authority, modelName) {
  const lease = authority.acquireExclusive({
    modelName,
    owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
  });
  lease.release();
}

class FakeExactProvider {
  constructor() {
    this.models = new Map([
      ['fixture-base', model('fixture-base', DIGEST_A)],
      ['fixture-target', model('fixture-target', DIGEST_B)],
      ['fixture-other', model('fixture-other', DIGEST_C)],
    ]);
    this.calls = {
      inventory: 0,
      snapshotResolve: 0,
      resolve: 0,
      ensure: 0,
      verify: 0,
      pull: 0,
    };
    this.resolveError = null;
    this.verifyError = null;
    this.verifyGate = null;
    this.afterEnsure = null;
    this.beforeResolve = null;
    this.afterInventory = null;
    this.pullTargets = new Map();
    this.onPullStart = null;
    this.pullGate = null;
    this.verifyConcurrent = 0;
    this.maxConcurrentVerify = 0;
  }

  getOrigin() {
    return 'http://127.0.0.1:11434';
  }

  #resolve(modelName, expectedDigestSha256 = null) {
    const canonical = canonicalModelName(modelName);
    const matches = [...this.models.values()].filter(candidate => (
      candidate.canonicalName === canonical
    ));
    if (matches.length === 0) {
      throw new ModelBindingApplicationError(
        'MODEL_BINDING_TARGET_NOT_INSTALLED',
        `Missing fixture model: ${modelName}`,
      );
    }
    if (matches.length !== 1) {
      throw new ModelBindingApplicationError(
        'MODEL_BINDING_TARGET_AMBIGUOUS',
        `Ambiguous fixture model: ${modelName}`,
      );
    }
    const resolved = matches[0];
    if (!/^[0-9a-f]{64}$/.test(resolved.digestSha256)) {
      throw new ModelBindingApplicationError(
        'MODEL_BINDING_TARGET_DIGEST_MISSING',
        `Missing fixture digest: ${modelName}`,
      );
    }
    if (expectedDigestSha256 && resolved.digestSha256 !== expectedDigestSha256) {
      throw new ModelBindingApplicationError(
        'MODEL_BINDING_TARGET_DIGEST_DRIFT',
        `Digest drift for fixture model: ${modelName}`,
      );
    }
    return resolved;
  }

  async resolveExact(modelName, options = {}) {
    this.calls.resolve++;
    if (this.resolveError) throw this.resolveError;
    this.beforeResolve?.(modelName, options);
    const resolved = this.#resolve(modelName, options.expectedDigestSha256 || null);
    this.afterEnsure?.(resolved);
    return resolved;
  }

  async listInstalled() {
    this.calls.inventory++;
    if (this.resolveError) throw this.resolveError;
    const inventory = [...this.models.values()];
    this.afterInventory?.(inventory);
    return inventory;
  }

  resolveFromInventory(inventory, modelName, options = {}) {
    this.calls.snapshotResolve++;
    const canonical = canonicalModelName(modelName);
    const matches = inventory.filter(candidate => candidate.canonicalName === canonical);
    if (matches.length === 0) {
      throw new ModelBindingApplicationError(
        'MODEL_BINDING_TARGET_NOT_INSTALLED',
        `Missing fixture model: ${modelName}`,
      );
    }
    if (matches.length !== 1) {
      throw new ModelBindingApplicationError(
        'MODEL_BINDING_TARGET_AMBIGUOUS',
        `Ambiguous fixture model: ${modelName}`,
      );
    }
    const resolved = matches[0];
    if (!/^[0-9a-f]{64}$/.test(resolved.digestSha256)) {
      throw new ModelBindingApplicationError(
        'MODEL_BINDING_TARGET_DIGEST_MISSING',
        `Missing fixture digest: ${modelName}`,
      );
    }
    if (options.expectedDigestSha256
      && resolved.digestSha256 !== options.expectedDigestSha256) {
      throw new ModelBindingApplicationError(
        'MODEL_BINDING_TARGET_DIGEST_DRIFT',
        `Digest drift for fixture model: ${modelName}`,
      );
    }
    return resolved;
  }

  async pull(modelName, onProgress) {
    const pulled = this.pullTargets.get(canonicalModelName(modelName));
    if (!pulled) {
      throw new ModelBindingApplicationError(
        'MODEL_BINDING_TARGET_NOT_INSTALLED',
        `Missing fixture model: ${modelName}`,
      );
    }
    this.onPullStart?.(modelName);
    this.calls.pull++;
    onProgress?.({ status: 'pulling', percent: 25 });
    if (this.pullGate) await this.pullGate.promise;
    this.models.set(pulled.name, pulled);
    onProgress?.({ status: 'pulled', percent: 100 });
  }

  async ensureInstalled(modelName, onProgress) {
    this.calls.ensure++;
    let resolved;
    try {
      resolved = this.#resolve(modelName);
    } catch (error) {
      const pulled = this.pullTargets.get(canonicalModelName(modelName));
      if (!pulled) throw error;
      await this.pull(modelName, onProgress);
      resolved = pulled;
    }
    this.afterEnsure?.(resolved);
    return resolved;
  }

  async verifyExact(expected) {
    this.calls.verify++;
    this.verifyConcurrent++;
    this.maxConcurrentVerify = Math.max(this.maxConcurrentVerify, this.verifyConcurrent);
    try {
      if (this.verifyGate) await this.verifyGate.promise;
      if (this.verifyError) throw this.verifyError;
      return this.#resolve(expected.modelName, expected.digestSha256);
    } finally {
      this.verifyConcurrent--;
    }
  }
}

const BINDING_APPLICATION_WORKER_SOURCE = String.raw`
  const Database = require('better-sqlite3');
  const { parentPort, workerData } = require('node:worker_threads');

  (async () => {
    const [repositoryModule, applicationModule, managerModule, configModule] = await Promise.all([
      import(workerData.repositoryModuleUrl),
      import(workerData.applicationModuleUrl),
      import(workerData.managerModuleUrl),
      import(workerData.configModuleUrl),
    ]);
    const db = new Database(workerData.databasePath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    const repository = repositoryModule.createModelFailoverRepository(db);
    const manager = new managerModule.UpgradeManager();
    manager.setDb(db);
    const provider = new applicationModule.OllamaModelBindingProvider({
      baseUrl: workerData.providerOrigin,
      pullImpl: async modelName => {
        const response = await fetch(workerData.providerOrigin + '/fixture-pull', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: modelName }),
        });
        if (!response.ok) throw new Error('fixture pull failed: ' + response.status);
      },
      inventoryTimeoutMs: 5000,
      verifyTimeoutMs: 5000,
    });
    const application = applicationModule.createModelBindingApplication({
      repository,
      runtime: manager.createBindingRuntimePort(),
      provider,
      publishControl: () => ({ accepted: true }),
      requestKeyFactory: ({ kind, role }) => (
        workerData.prefix + '-' + kind + '-' + role + '-request-0001'
      ),
      actorFactory: () => 'user:' + workerData.prefix,
      verificationAttempts: 1,
      logger: { warn() {}, info() {}, debug() {}, error() {} },
    });
    configModule.config.models.CHAT = 'fixture-base';
    parentPort.postMessage({ type: 'ready', prefix: workerData.prefix });
    await new Promise(resolve => parentPort.once('message', resolve));
    try {
      const result = await application.applyManualBinding({
        role: 'CHAT',
        targetModel: 'fixture-target',
      });
      parentPort.postMessage({
        type: 'result', prefix: workerData.prefix, ok: true, outcome: result.outcome,
      });
    } catch (error) {
      parentPort.postMessage({
        type: 'result', prefix: workerData.prefix, ok: false,
        code: error && error.code || null,
        message: error && error.message || String(error),
      });
    } finally {
      db.close();
      parentPort.close();
    }
  })().catch(error => {
    parentPort.postMessage({ type: 'fatal', message: error.stack || String(error) });
    parentPort.close();
  });
`;

function repositoryProxy(repository, overrides = {}) {
  return new Proxy(repository, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function withFixture(callback, options = {}) {
  const db = new Database(':memory:');
  await runMigrations(db);
  const repository = createModelFailoverRepository(db, options.repositoryOptions || {});
  const manager = new UpgradeManager();
  manager.setDb(db);
  const provider = options.provider || new FakeExactProvider();
  const events = [];
  let requestSequence = 0;
  const repositoryPort = options.repositoryFactory
    ? options.repositoryFactory(repository)
    : repository;
  const runtimePort = manager.createBindingRuntimePort();
  const useAuthority = options.useDefaultModelUseAuthority
    ? productionModelUseAuthority
    : options.modelUseAuthority || new ModelUseAuthority();
  const applicationOptions = {
    repository: repositoryPort,
    runtime: options.runtimeFactory ? options.runtimeFactory(runtimePort) : runtimePort,
    provider,
    publishControl: payload => {
      events.push(payload);
      if (options.publishError?.(payload)) throw new Error('fixture publish failed');
      if (options.publishReceipt) return options.publishReceipt(payload);
      return { accepted: true };
    },
    requestKeyFactory: options.requestKeyFactory || (({ kind, role }) => (
      `fixture-${kind}-${role}-${String(++requestSequence).padStart(4, '0')}`
    )),
    actorFactory: () => 'user:fixture-operator',
    verificationAttempts: options.verificationAttempts ?? 1,
    verificationRetryDelayMs: options.verificationRetryDelayMs ?? 1,
    delay: options.delay || (async () => {}),
    clock: options.applicationClock,
    scheduleRecovery: options.scheduleRecovery,
    cancelRecovery: options.cancelRecovery,
    logger: { warn() {}, info() {}, debug() {}, error() {} },
  };
  if (!options.useDefaultModelUseAuthority) {
    applicationOptions.modelUseAuthority = useAuthority;
  }
  const application = createModelBindingApplication(applicationOptions);
  if (options.startVerification !== false) application.startBackgroundVerification();

  config.models.CHAT = 'fixture-base';
  try {
    return await callback({
      db,
      repository,
      manager,
      provider,
      events,
      application,
      modelUseAuthority: useAuthority,
    });
  } finally {
    setModelBindingApplication(null);
    restoreBindings();
    db.close();
  }
}

async function withExpiringProviderFixture(callback, options = {}) {
  let nowMs = 1_000;
  return withFixture(async context => callback({
    ...context,
    expireProviderClaim() {
      nowMs += 300_001;
    },
  }), {
    ...options,
    repositoryOptions: {
      ...(options.repositoryOptions || {}),
      clock: () => nowMs,
    },
    applicationClock: options.applicationClock || (() => nowMs),
  });
}

function count(db, table) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
}

function providerClaim(operation) {
  assert(operation?.claim, 'Expected provider operation to own an active claim');
  return {
    claimToken: operation.claim.claimToken,
    expectedFencingRevision: operation.claim.fencingRevision,
  };
}

async function waitUntil(predicate, message, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

async function withLoopbackServer(handler, callback) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  try {
    return await callback(`http://127.0.0.1:${address.port}`, server);
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

function latestOperation(repository, role = 'CHAT') {
  const effective = repository.getEffectiveBinding(role);
  const id = effective?.operation?.operationId || effective?.pendingOperation?.operationId;
  return id ? repository.getBindingOperation(id) : null;
}

suite('M1 model binding application — one truthful commit point');

await testAsync('delete protection exposes current desired and one-step rollback identities', async () => {
  await withFixture(async ({ application }) => {
    const before = application.getProtectedModelNames();
    assert(before.some(model => sameModelName(model, 'fixture-base')));

    await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    const after = application.getProtectedModelNames();
    assert(after.some(model => sameModelName(model, 'fixture-target')));
    assert(after.some(model => sameModelName(model, 'fixture-base')));
  });
});

await testAsync('binding cutover re-resolves and reserves previous plus target through commit', async () => {
  const authority = new ModelUseAuthority();
  let exactResolveObserved = 0;
  let durableCommitObserved = 0;
  let runtimeCommitObserved = 0;
  const commitOrder = [];
  await withFixture(async ({ db, repository, provider, application }) => {
    const verifyExact = provider.verifyExact.bind(provider);
    provider.verifyExact = async input => {
      commitOrder.push('verify');
      return verifyExact(input);
    };
    provider.afterEnsure = resolved => {
      if (resolved.name !== 'fixture-target') return;
      const target = authority.snapshot('fixture-target');
      const previous = authority.snapshot('fixture-base');
      if (target.activeUseCount === 1 && previous.activeUseCount === 1) {
        exactResolveObserved++;
      }
    };

    const result = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();

    assertEqual(result.outcome, 'APPLIED');
    assertEqual(repository.getBindingApplicationState(result.operationId).state, 'VERIFIED');
    assertEqual(exactResolveObserved, 1);
    assertEqual(durableCommitObserved, 1);
    assertEqual(runtimeCommitObserved, 1);
    assertEqual(commitOrder.join(','), 'attempt,commit,receipt,broadcast,verify');
    assertMutationAvailable(authority, 'fixture-base');
    assertMutationAvailable(authority, 'fixture-target');
  }, {
    modelUseAuthority: authority,
    repositoryFactory(repository) {
      const recordApplied = repository.recordManualRuntimeApplied.bind(repository);
      const recordFinalized = repository.recordManualRuntimeFinalized.bind(repository);
      return repositoryProxy(repository, {
        recordManualRuntimeApplied(input) {
          assertMutationBlocked(
            authority,
            'fixture-base',
            MODEL_ACTIVITY_OWNER.BINDING_CUTOVER,
          );
          assertMutationBlocked(
            authority,
            'fixture-target:latest',
            MODEL_ACTIVITY_OWNER.BINDING_CUTOVER,
          );
          const unrelated = authority.acquireExclusive({
            modelName: 'fixture-other',
            owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
          });
          unrelated.release();
          durableCommitObserved++;
          commitOrder.push('attempt');
          const recorded = recordApplied(input);
          assertEqual(count(repository.db, 'upgrade_history'), 0);
          return recorded;
        },
        recordManualRuntimeFinalized(input) {
          commitOrder.push('receipt');
          const finalized = recordFinalized(input);
          assertEqual(count(repository.db, 'upgrade_history'), 1);
          return finalized;
        },
      });
    },
    runtimeFactory(runtime) {
      return Object.freeze({
        ...runtime,
        commit(token) {
          assertMutationBlocked(
            authority,
            'fixture-base',
            MODEL_ACTIVITY_OWNER.BINDING_CUTOVER,
          );
          assertMutationBlocked(
            authority,
            'fixture-target',
            MODEL_ACTIVITY_OWNER.BINDING_CUTOVER,
          );
          runtimeCommitObserved++;
          commitOrder.push('commit');
          return runtime.commit(token);
        },
      });
    },
    publishReceipt(payload) {
      if (payload.action === 'model_changed') commitOrder.push('broadcast');
      return { accepted: true };
    },
  });
});

await testAsync('non-authoritative in-memory history cannot tear a committed runtime finalize', async () => {
  await withFixture(async ({ db, repository, manager, application }) => {
    let historyCalls = 0;
    manager.recordUpgrade = () => {
      historyCalls++;
      throw new Error('fixture in-memory history failure');
    };
    const result = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();
    assertEqual(result.outcome, 'APPLIED');
    assertEqual(
      repository.getBindingApplicationState(result.operationId).runtimeFinalizeStatus,
      'DIRECT_CONFIRMED',
    );
    assertEqual(count(db, 'model_binding_runtime_finalize_receipts'), 1);
    assertEqual(count(db, 'upgrade_history'), 1);
    assertEqual(historyCalls, 0);
  });
});

await testAsync('cold pull finishes before binding cutover acquires shared use', async () => {
  const authority = new ModelUseAuthority();
  let pullObserved = 0;
  await withFixture(async ({ provider, application }) => {
    provider.models.delete('fixture-target');
    provider.pullTargets.set('fixture-target', model('fixture-target', DIGEST_B));
    provider.onPullStart = modelName => {
      assertEqual(authority.snapshot(modelName).activeUseCount, 0);
      const pullLease = authority.acquireExclusive({
        modelName,
        owner: MODEL_ACTIVITY_OWNER.MODEL_PULL,
      });
      pullObserved++;
      pullLease.release();
    };

    const result = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();
    assertEqual(result.outcome, 'APPLIED');
    assertEqual(pullObserved, 1);
    assertMutationAvailable(authority, 'fixture-target');
  }, { modelUseAuthority: authority });
});

await testAsync('default binding wiring shares the production model-use authority', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  let pullOutcomePromise = null;
  try {
    globalThis.fetch = async () => {
      fetchCalls++;
      return {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => ({ done: true, value: undefined }),
          }),
        },
      };
    };
    await withFixture(async ({ manager, provider, application }) => {
      provider.beforeResolve = modelName => {
        if (canonicalModelName(modelName) !== 'fixture-target') return;
        if (productionModelUseAuthority.snapshot('fixture-target').activeUseCount !== 1
          || productionModelUseAuthority.snapshot('fixture-base').activeUseCount !== 1) return;
        assertEqual(pullOutcomePromise, null, 'Expected one leased authoritative target resolve');
        pullOutcomePromise = manager.pullModel('fixture-target:latest').then(
          value => ({ ok: true, value }),
          error => ({ ok: false, error }),
        );
      };

      const applied = await application.applyManualBinding({
        role: 'CHAT',
        targetModel: 'fixture-target',
      });
      assert(pullOutcomePromise, 'Expected pull attempt during leased cutover resolve');
      const pullOutcome = await pullOutcomePromise;
      await application.awaitBackgroundWork();

      assertEqual(applied.outcome, 'APPLIED');
      assertEqual(pullOutcome.ok, false);
      assertEqual(pullOutcome.error.code, 'MODEL_MUTATION_ACTIVE_USE');
      assert(pullOutcome.error.details.activeOwners.includes(
        MODEL_ACTIVITY_OWNER.BINDING_CUTOVER,
      ));
      assertEqual(fetchCalls, 0, 'Conflicting pull must stop before provider I/O');
      assertEqual(
        productionModelUseAuthority.snapshot('fixture-base').activeUseCount,
        0,
      );
      assertEqual(
        productionModelUseAuthority.snapshot('fixture-target').activeUseCount,
        0,
      );
      assertMutationAvailable(productionModelUseAuthority, 'fixture-base');
      assertMutationAvailable(productionModelUseAuthority, 'fixture-target');
    }, { useDefaultModelUseAuthority: true });
  } finally {
    if (pullOutcomePromise) await pullOutcomePromise;
    globalThis.fetch = originalFetch;
  }
});

await testAsync('cutover conflict is retryable and releases a partially acquired lease set', async () => {
  const authority = new ModelUseAuthority();
  await withFixture(async ({ db, repository, manager, events, application }) => {
    const mutation = authority.acquireExclusive({
      modelName: 'fixture-target',
      owner: MODEL_ACTIVITY_OWNER.MODEL_PULL,
    });
    const error = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));

    assertEqual(error.code, 'MODEL_BINDING_RUNTIME_GUARD_REJECTED');
    assertEqual(error.details.exclusiveOwner, MODEL_ACTIVITY_OWNER.MODEL_PULL);
    const operation = latestOperation(repository);
    const state = repository.getBindingApplicationState(operation.operationId);
    assertEqual(state.runtimeStatus, 'FAILED');
    assertEqual(state.failureCode, 'MODEL_BINDING_RUNTIME_GUARD_REJECTED');
    assertEqual(state.retryable, true);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
    assertEqual(count(db, 'upgrade_history'), 0);
    assertEqual(events.filter(event => event.action === 'model_changed').length, 0);
    assertMutationAvailable(authority, 'fixture-base');
    assertEqual(
      authority.snapshot('fixture-target').exclusiveOwner,
      MODEL_ACTIVITY_OWNER.MODEL_PULL,
    );

    mutation.release();
    const retry = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();
    assertEqual(retry.operationId, operation.operationId);
    assertEqual(retry.outcome, 'APPLIED');
    assertMutationAvailable(authority, 'fixture-target');
  }, { modelUseAuthority: authority });
});

await testAsync('repository compensation runs under both cutover leases and releases them', async () => {
  const authority = new ModelUseAuthority();
  let compensationObserved = 0;
  await withFixture(async ({ application }) => {
    const error = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(error.code, 'MODEL_BINDING_RUNTIME_COMMIT_FAILED');
    assertEqual(compensationObserved, 1);
    assertMutationAvailable(authority, 'fixture-base');
    assertMutationAvailable(authority, 'fixture-target');
  }, {
    modelUseAuthority: authority,
    repositoryFactory(repository) {
      return repositoryProxy(repository, {
        recordManualRuntimeApplied() {
          throw new Error('fixture cutover repository failure');
        },
      });
    },
    runtimeFactory(runtime) {
      return Object.freeze({
        ...runtime,
        compensate(token) {
          assertMutationBlocked(
            authority,
            'fixture-base',
            MODEL_ACTIVITY_OWNER.BINDING_CUTOVER,
          );
          assertMutationBlocked(
            authority,
            'fixture-target',
            MODEL_ACTIVITY_OWNER.BINDING_CUTOVER,
          );
          compensationObserved++;
          return runtime.compensate(token);
        },
      });
    },
  });
});

await testAsync('runtime finalize failure releases leases but leaves the named reconciliation residual', async () => {
  const authority = new ModelUseAuthority();
  const scheduledRecoveries = [];
  await withFixture(async ({ db, repository, manager, events, application }) => {
    const error = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(error.code, 'MODEL_BINDING_RUNTIME_COMMIT_FAILED');
    assertEqual(error.details.internalState, 'RUNTIME_RECONCILIATION_REQUIRED');
    assertEqual(error.details.phase, 'RUNTIME_COMMIT');
    assertEqual(error.details.compensationOutcome, 'COMPENSATED');
    const operation = latestOperation(repository);
    const state = repository.getBindingApplicationState(operation.operationId);
    assertEqual(state.runtimeStatus, 'APPLIED');
    assertEqual(state.runtimeFinalizeStatus, 'UNKNOWN');
    assertEqual(repository.getEffectiveBinding('CHAT').source, 'PENDING_MANUAL');
    assertEqual(application.getBindingStatus({ role: 'CHAT' }).state, 'PENDING');
    assertEqual(application.getBindingStatus({ role: 'CHAT' }).runtimeStatus, 'NOT_APPLIED');
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
    assertEqual(count(db, 'model_binding_runtime_finalize_receipts'), 0);
    assertEqual(count(db, 'upgrade_history'), 0);
    assertEqual(events.filter(event => event.action === 'model_changed').length, 0);
    assertEqual(scheduledRecoveries.length, 1);
    assertMutationAvailable(authority, 'fixture-base');
    assertMutationAvailable(authority, 'fixture-target');
  }, {
    modelUseAuthority: authority,
    scheduleRecovery(callback) {
      scheduledRecoveries.push(callback);
      return callback;
    },
    cancelRecovery() {},
    runtimeFactory(runtime) {
      return Object.freeze({
        ...runtime,
        commit() {
          throw new Error('fixture runtime finalize failure');
        },
      });
    },
  });
});

await testAsync('runtime-attempt readback outage preserves the recovery fence before commit', async () => {
  const scheduled = [];
  let failReadback = false;
  let throwAfterAttempt = true;
  await withFixture(async ({ db, repository, manager, provider, application }) => {
    const error = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(error.code, 'MODEL_BINDING_RUNTIME_COMMIT_FAILED');
    assertEqual(error.details.phase, 'RUNTIME_ATTEMPT_READBACK');
    assertEqual(error.details.compensationOutcome, 'COMPENSATED');
    const operation = latestOperation(repository);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
    assertEqual(
      repository.getBindingApplicationState(operation.operationId).runtimeFinalizeStatus,
      'UNKNOWN',
    );
    assertEqual(count(db, 'model_binding_runtime_finalize_receipts'), 0);
    assertEqual(count(db, 'upgrade_history'), 0);
    assertEqual(scheduled.length, 1);

    scheduled[0].callback();
    await application.awaitBackgroundWork();
    assertEqual(
      repository.getBindingApplicationState(operation.operationId).runtimeFinalizeStatus,
      'DIRECT_CONFIRMED',
    );
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
    assertEqual(count(db, 'model_binding_runtime_finalize_receipts'), 2);
    assertEqual(count(db, 'upgrade_history'), 1);
    assertEqual(provider.calls.pull, 0);
  }, {
    scheduleRecovery(callback, delayMs) {
      const item = { callback, delayMs };
      scheduled.push(item);
      return item;
    },
    cancelRecovery() {},
    repositoryFactory(repository) {
      const recordApplied = repository.recordManualRuntimeApplied.bind(repository);
      const getState = repository.getBindingApplicationState.bind(repository);
      return repositoryProxy(repository, {
        recordManualRuntimeApplied(input) {
          const result = recordApplied(input);
          if (throwAfterAttempt) {
            throwAfterAttempt = false;
            failReadback = true;
            throw new Error('fixture runtime attempt return-path failure');
          }
          return result;
        },
        getBindingApplicationState(operationId) {
          if (failReadback) {
            failReadback = false;
            throw new Error('fixture runtime attempt readback unavailable');
          }
          return getState(operationId);
        },
      });
    },
  });
});

await testAsync('post-commit throw blocks replay and one exact recovery confirms both generations', async () => {
  const scheduled = [];
  let commitCalls = 0;
  let throwAfterFirstCommit = true;
  await withFixture(async ({ db, repository, manager, provider, events, application }) => {
    const error = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(error.code, 'MODEL_BINDING_RUNTIME_COMMIT_FAILED');
    assertEqual(error.details.compensationOutcome, 'COMPENSATION_FAILED');
    const operation = latestOperation(repository);
    const unknown = repository.getBindingApplicationState(operation.operationId);
    assertEqual(unknown.runtimeFinalizeStatus, 'UNKNOWN');
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
    assertEqual(count(db, 'model_binding_runtime_finalize_receipts'), 0);
    assertEqual(count(db, 'upgrade_history'), 0);
    assertEqual(scheduled.length, 1);

    const resolveCalls = provider.calls.resolve;
    const replay = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(replay.code, 'MODEL_BINDING_RUNTIME_COMMIT_FAILED');
    assertEqual(replay.details.phase, 'REPLAY_BLOCKED');
    assertEqual(provider.calls.resolve, resolveCalls);
    assertEqual(provider.calls.pull, 0);
    assertEqual(commitCalls, 1);
    assertEqual(events.filter(event => event.action === 'model_changed').length, 0);
    assertEqual(scheduled.length, 1);

    scheduled[0].callback();
    await application.awaitBackgroundWork();
    const recovered = repository.getBindingApplicationState(operation.operationId);
    assertEqual(recovered.runtimeFinalizeStatus, 'DIRECT_CONFIRMED');
    assertEqual(commitCalls, 2);
    assertEqual(provider.calls.pull, 0);
    assertEqual(count(db, 'upgrade_history'), 1);
    assertEqual(
      JSON.stringify(db.prepare(`
        SELECT runtime_attempt_revision, finalization_kind,
               recovered_by_attempt_revision
        FROM model_binding_runtime_finalize_receipts
        WHERE operation_id = ?
        ORDER BY runtime_attempt_revision
      `).all(operation.operationId)),
      JSON.stringify([
        {
          runtime_attempt_revision: 1,
          finalization_kind: 'RECOVERED_BY',
          recovered_by_attempt_revision: 2,
        },
        {
          runtime_attempt_revision: 2,
          finalization_kind: 'DIRECT_CONFIRMED',
          recovered_by_attempt_revision: null,
        },
      ]),
    );
    assertEqual(events.filter(event => event.action === 'model_changed').length, 1);
  }, {
    scheduleRecovery(callback, delayMs) {
      const item = { callback, delayMs };
      scheduled.push(item);
      return item;
    },
    cancelRecovery() {},
    runtimeFactory(runtime) {
      return Object.freeze({
        ...runtime,
        commit(token) {
          commitCalls++;
          const result = runtime.commit(token);
          if (throwAfterFirstCommit) {
            throwAfterFirstCommit = false;
            throw new Error('fixture throw after runtime commit');
          }
          return result;
        },
      });
    },
  });
});

await testAsync('receipt outage leaves committed runtime unknown until exact recovery', async () => {
  const scheduled = [];
  let rejectFirstReceipt = true;
  await withFixture(async ({ db, repository, manager, events, application }) => {
    const error = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(error.code, 'MODEL_BINDING_RUNTIME_COMMIT_FAILED');
    assertEqual(error.details.phase, 'RUNTIME_FINALIZE_RECEIPT');
    const operation = latestOperation(repository);
    assertEqual(
      repository.getBindingApplicationState(operation.operationId).runtimeFinalizeStatus,
      'UNKNOWN',
    );
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
    assertEqual(count(db, 'model_binding_runtime_finalize_receipts'), 0);
    assertEqual(count(db, 'upgrade_history'), 0);
    assertEqual(events.filter(event => event.action === 'model_changed').length, 0);
    assertEqual(scheduled.length, 1);

    scheduled[0].callback();
    await application.awaitBackgroundWork();
    assertEqual(
      repository.getBindingApplicationState(operation.operationId).runtimeFinalizeStatus,
      'DIRECT_CONFIRMED',
    );
    assertEqual(count(db, 'model_binding_runtime_finalize_receipts'), 2);
    assertEqual(count(db, 'upgrade_history'), 1);
    assertEqual(events.filter(event => event.action === 'model_changed').length, 1);
  }, {
    scheduleRecovery(callback, delayMs) {
      const item = { callback, delayMs };
      scheduled.push(item);
      return item;
    },
    cancelRecovery() {},
    repositoryFactory(repository) {
      const recordFinalized = repository.recordManualRuntimeFinalized.bind(repository);
      return repositoryProxy(repository, {
        recordManualRuntimeFinalized(input) {
          if (rejectFirstReceipt) {
            rejectFirstReceipt = false;
            throw new Error('fixture receipt unavailable');
          }
          return recordFinalized(input);
        },
      });
    },
  });
});

await testAsync('busy exact recovery rearms once without provider or runtime work', async () => {
  const scheduled = [];
  let rejectFirstReceipt = true;
  await withFixture(async ({ db, repository, provider, application }) => {
    const first = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(first.code, 'MODEL_BINDING_RUNTIME_COMMIT_FAILED');
    const operation = latestOperation(repository);
    assertEqual(scheduled.length, 1);
    const resolveCalls = provider.calls.resolve;
    const runtimeAttempts = count(db, 'model_binding_application_attempts');

    const entered = deferred();
    const release = deferred();
    const mutation = application.runExclusiveModelMutation(
      { kind: 'MODEL_DELETE' },
      async () => {
        entered.resolve();
        await release.promise;
        return { ok: true };
      },
    );
    await entered.promise;
    scheduled[0].callback();
    await application.awaitBackgroundWork();
    assertEqual(provider.calls.resolve, resolveCalls);
    assertEqual(provider.calls.pull, 0);
    assertEqual(count(db, 'model_binding_application_attempts'), runtimeAttempts);
    assertEqual(count(db, 'model_binding_runtime_finalize_receipts'), 0);
    assertEqual(scheduled.length, 2);

    release.resolve();
    assertEqual((await mutation).ok, true);
    scheduled[1].callback();
    await application.awaitBackgroundWork();
    assertEqual(
      repository.getBindingApplicationState(operation.operationId).runtimeFinalizeStatus,
      'DIRECT_CONFIRMED',
    );
    assertEqual(count(db, 'model_binding_runtime_finalize_receipts'), 2);
    assertEqual(count(db, 'upgrade_history'), 1);
    assertEqual(provider.calls.pull, 0);
  }, {
    scheduleRecovery(callback, delayMs) {
      const item = { callback, delayMs };
      scheduled.push(item);
      return item;
    },
    cancelRecovery() {},
    repositoryFactory(repository) {
      const recordFinalized = repository.recordManualRuntimeFinalized.bind(repository);
      return repositoryProxy(repository, {
        recordManualRuntimeFinalized(input) {
          if (rejectFirstReceipt) {
            rejectFirstReceipt = false;
            throw new Error('fixture initial receipt unavailable');
          }
          return recordFinalized(input);
        },
      });
    },
  });
});

await testAsync('failed exact recovery preserves the unknown fence and replay has no provider effect', async () => {
  const scheduled = [];
  let rejectFirstReceipt = true;
  await withFixture(async ({ db, repository, provider, events, application }) => {
    const first = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(first.code, 'MODEL_BINDING_RUNTIME_COMMIT_FAILED');
    const operation = latestOperation(repository);
    assertEqual(
      repository.getBindingApplicationState(operation.operationId).runtimeFinalizeStatus,
      'UNKNOWN',
    );
    assertEqual(scheduled.length, 1);

    provider.resolveError = new ModelBindingApplicationError(
      'MODEL_BINDING_PROVIDER_UNAVAILABLE',
      'fixture exact recovery unavailable',
    );
    scheduled[0].callback();
    await application.awaitBackgroundWork();
    const afterFailedRecovery = repository.getBindingApplicationState(operation.operationId);
    assertEqual(afterFailedRecovery.state, 'RUNTIME_RECONCILIATION_REQUIRED');
    assertEqual(afterFailedRecovery.runtimeStatus, 'APPLIED');
    assertEqual(afterFailedRecovery.runtimeFinalizeStatus, 'UNKNOWN');
    assertEqual(afterFailedRecovery.lastRuntimeAttempt.outcome, 'FAILED');
    assertEqual(afterFailedRecovery.lastUnresolvedRuntimeAttempt.attemptRevision, 1);
    assertEqual(repository.getEffectiveBinding('CHAT').source, 'PENDING_MANUAL');

    provider.resolveError = null;
    const resolveCalls = provider.calls.resolve;
    const replay = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(replay.code, 'MODEL_BINDING_RUNTIME_COMMIT_FAILED');
    assertEqual(replay.details.phase, 'REPLAY_BLOCKED');
    assertEqual(provider.calls.resolve, resolveCalls);
    assertEqual(provider.calls.pull, 0);
    assertEqual(events.filter(event => event.action === 'model_changed').length, 0);
    assertEqual(scheduled.length, 2);

    scheduled[1].callback();
    await application.awaitBackgroundWork();
    const recovered = repository.getBindingApplicationState(operation.operationId);
    assertEqual(recovered.runtimeFinalizeStatus, 'DIRECT_CONFIRMED');
    assertEqual(recovered.lastRuntimeAttempt.attemptRevision, 3);
    assertEqual(recovered.attemptRevision, 5);
    assertEqual(count(db, 'upgrade_history'), 1);
    assertEqual(provider.calls.pull, 0);
    assertEqual(events.filter(event => event.action === 'model_changed').length, 1);
    assertEqual(
      JSON.stringify(db.prepare(`
        SELECT runtime_attempt_revision, finalization_kind,
               recovered_by_attempt_revision
        FROM model_binding_runtime_finalize_receipts
        WHERE operation_id = ?
        ORDER BY runtime_attempt_revision
      `).all(operation.operationId)),
      JSON.stringify([
        {
          runtime_attempt_revision: 1,
          finalization_kind: 'RECOVERED_BY',
          recovered_by_attempt_revision: 3,
        },
        {
          runtime_attempt_revision: 3,
          finalization_kind: 'DIRECT_CONFIRMED',
          recovered_by_attempt_revision: null,
        },
      ]),
    );
  }, {
    scheduleRecovery(callback, delayMs) {
      const item = { callback, delayMs };
      scheduled.push(item);
      return item;
    },
    cancelRecovery() {},
    repositoryFactory(repository) {
      const recordFinalized = repository.recordManualRuntimeFinalized.bind(repository);
      return repositoryProxy(repository, {
        recordManualRuntimeFinalized(input) {
          if (rejectFirstReceipt) {
            rejectFirstReceipt = false;
            throw new Error('fixture initial receipt unavailable');
          }
          return recordFinalized(input);
        },
      });
    },
  });
});

await testAsync('receipt return-path failure re-reads committed authority without duplicate recovery', async () => {
  const scheduled = [];
  let throwAfterReceipt = true;
  await withFixture(async ({ db, repository, application }) => {
    const result = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();
    assertEqual(result.outcome, 'APPLIED');
    assertEqual(
      repository.getBindingApplicationState(result.operationId).runtimeFinalizeStatus,
      'DIRECT_CONFIRMED',
    );
    assertEqual(count(db, 'model_binding_runtime_finalize_receipts'), 1);
    assertEqual(count(db, 'upgrade_history'), 1);
    assertEqual(scheduled.length, 0);
  }, {
    scheduleRecovery(callback, delayMs) {
      const item = { callback, delayMs };
      scheduled.push(item);
      return item;
    },
    cancelRecovery() {},
    repositoryFactory(repository) {
      const recordFinalized = repository.recordManualRuntimeFinalized.bind(repository);
      return repositoryProxy(repository, {
        recordManualRuntimeFinalized(input) {
          const result = recordFinalized(input);
          if (throwAfterReceipt) {
            throwAfterReceipt = false;
            throw new Error('fixture receipt return-path failure');
          }
          return result;
        },
      });
    },
  });
});

await testAsync('receipt readback outage cannot lose the exact recovery timer', async () => {
  const scheduled = [];
  let failReadback = false;
  let rejectReceipt = true;
  await withFixture(async ({ db, repository, application }) => {
    const error = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(error.code, 'MODEL_BINDING_RUNTIME_COMMIT_FAILED');
    assertEqual(error.details.phase, 'RUNTIME_FINALIZE_RECEIPT_READBACK');
    const operation = latestOperation(repository);
    assertEqual(
      repository.getBindingApplicationState(operation.operationId).runtimeFinalizeStatus,
      'UNKNOWN',
    );
    assertEqual(scheduled.length, 1);
    assertEqual(count(db, 'model_binding_runtime_finalize_receipts'), 0);
    assertEqual(count(db, 'upgrade_history'), 0);

    scheduled[0].callback();
    await application.awaitBackgroundWork();
    assertEqual(
      repository.getBindingApplicationState(operation.operationId).runtimeFinalizeStatus,
      'DIRECT_CONFIRMED',
    );
    assertEqual(count(db, 'model_binding_runtime_finalize_receipts'), 2);
    assertEqual(count(db, 'upgrade_history'), 1);
  }, {
    scheduleRecovery(callback, delayMs) {
      const item = { callback, delayMs };
      scheduled.push(item);
      return item;
    },
    cancelRecovery() {},
    repositoryFactory(repository) {
      const getState = repository.getBindingApplicationState.bind(repository);
      const recordFinalized = repository.recordManualRuntimeFinalized.bind(repository);
      return repositoryProxy(repository, {
        recordManualRuntimeFinalized(input) {
          if (rejectReceipt) {
            rejectReceipt = false;
            failReadback = true;
            throw new Error('fixture receipt unavailable');
          }
          return recordFinalized(input);
        },
        getBindingApplicationState(operationId) {
          if (failReadback) {
            failReadback = false;
            throw new Error('fixture receipt readback unavailable');
          }
          return getState(operationId);
        },
      });
    },
  });
});

await testAsync('verification conflict retries after releasing the lease before delay', async () => {
  const authority = new ModelUseAuthority();
  let mutation = null;
  let delayCalls = 0;
  let durableVerificationObserved = 0;
  await withFixture(async ({ db, repository, provider, application }) => {
    const result = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    mutation = authority.acquireExclusive({
      modelName: 'fixture-target',
      owner: MODEL_ACTIVITY_OWNER.MODEL_PULL,
    });

    application.startBackgroundVerification();
    await application.awaitBackgroundWork();

    assertEqual(delayCalls, 1);
    assertEqual(provider.calls.verify, 1, 'Blocked attempt must stop before provider verify');
    assertEqual(durableVerificationObserved, 1);
    assertEqual(repository.getBindingApplicationState(result.operationId).state, 'VERIFIED');
    assertMutationAvailable(authority, 'fixture-target');
  }, {
    modelUseAuthority: authority,
    startVerification: false,
    verificationAttempts: 2,
    delay: async () => {
      delayCalls++;
      assertEqual(authority.snapshot('fixture-target').activeUseCount, 0);
      assertEqual(
        authority.snapshot('fixture-target').exclusiveOwner,
        MODEL_ACTIVITY_OWNER.MODEL_PULL,
      );
      mutation.release();
      mutation = null;
    },
    repositoryFactory(repository) {
      const original = repository.recordManualVerificationSucceeded.bind(repository);
      return repositoryProxy(repository, {
        recordManualVerificationSucceeded(input) {
          assertMutationBlocked(
            authority,
            'fixture-target:latest',
            MODEL_ACTIVITY_OWNER.BINDING_VERIFICATION,
          );
          durableVerificationObserved++;
          return original(input);
        },
      });
    },
  });
});

await testAsync('model delete reservation excludes binding apply before any runtime or provider effect', async () => {
  await withFixture(async ({ db, manager, provider, application }) => {
    const entered = deferred();
    const release = deferred();
    const deletion = application.runExclusiveModelMutation(
      { kind: 'MODEL_DELETE' },
      async () => {
        entered.resolve();
        await release.promise;
        return { ok: true };
      },
    );
    await entered.promise;

    const error = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(error.code, 'MODEL_BINDING_APPLICATION_BUSY');
    assertEqual(error.httpStatus, 409);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
    assertEqual(provider.calls.resolve, 0);
    assertEqual(provider.calls.ensure, 0);
    assertEqual(provider.calls.pull, 0);
    assertEqual(count(db, 'model_binding_operations'), 0);

    release.resolve();
    assertEqual((await deletion).ok, true);
  });
});

await testAsync('apply commits runtime and audit before exact verification can claim verified', async () => {
  await withFixture(async ({ db, repository, manager, provider, events, application }) => {
    provider.verifyGate = deferred();
    const result = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await Promise.resolve();

    const beforeVerification = repository.getBindingApplicationState(result.operationId);
    const overrideBefore = db.prepare(`
      SELECT verified, verification_status AS status
      FROM model_overrides WHERE role = 'CHAT'
    `).get();
    assertEqual(result.verified, false);
    assertEqual(beforeVerification.state, 'APPLIED_PENDING_VERIFICATION');
    assertEqual(overrideBefore.verified, 0);
    assertEqual(overrideBefore.status, 'PENDING');
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').configVersion, 1);
    assertEqual(count(db, 'upgrade_history'), 1);
    assertEqual(events.filter(event => event.action === 'model_changed').length, 1);

    provider.verifyGate.resolve();
    await application.awaitBackgroundWork();
    const verified = repository.getBindingApplicationState(result.operationId);
    const overrideAfter = db.prepare(`
      SELECT verified, verification_status AS status
      FROM model_overrides WHERE role = 'CHAT'
    `).get();
    assertEqual(verified.state, 'VERIFIED');
    assertEqual(overrideAfter.verified, 1);
    assertEqual(overrideAfter.status, 'VERIFIED');
    assertEqual(provider.calls.verify, 1);
  });
});

await testAsync('commit layer approves one matching proposal and expires the rest', async () => {
  await withFixture(async ({ db, application }) => {
    const insert = db.prepare(`
      INSERT INTO upgrade_proposals (
        role, current_model, candidate_model, score, status, detected_at
      ) VALUES ('CHAT', 'fixture-base', ?, ?, 'pending', ?)
    `);
    insert.run('fixture-target', 80, '2026-08-09 01:00:00');
    insert.run('fixture-target:latest', 90, '2026-08-09 02:00:00');
    insert.run('fixture-other', 95, '2026-08-09 03:00:00');

    await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();
    const rows = db.prepare(`
      SELECT candidate_model AS model, status
      FROM upgrade_proposals
      ORDER BY candidate_model
    `).all();
    assertEqual(rows.filter(row => row.status === 'approved').length, 1);
    assertEqual(rows.find(row => row.status === 'approved').model, 'fixture-target:latest');
    assertEqual(rows.filter(row => row.status === 'expired').length, 2);
  });
});

await testAsync('proposal resolution failure is repairable without replaying provider or runtime', async () => {
  let failResolution = true;
  await withFixture(async ({ db, repository, manager, provider, events, application }) => {
    db.prepare(`
      INSERT INTO upgrade_proposals (
        role, current_model, candidate_model, score, status, detected_at
      ) VALUES ('CHAT', 'fixture-base', 'fixture-target', 90, 'pending', ?)
    `).run('2026-08-09 04:00:00');

    const first = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    assertEqual(first.outcome, 'APPLIED_PROPOSAL_REPAIR_PENDING');
    assertEqual(first.proposalResolutionStatus, 'REPAIR_PENDING');
    assertEqual(first.warningCode, 'MODEL_BINDING_PROPOSAL_RESOLUTION_FAILED');
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
    assertEqual(db.prepare(`SELECT status FROM upgrade_proposals`).get().status, 'pending');
    assertEqual(events.filter(event => event.action === 'model_changed').length, 1);
    assertEqual(repository.getBindingApplicationState(first.operationId).notificationStatus, 'SUCCEEDED');
    const resolveCalls = provider.calls.resolve;

    const replay = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();

    assertEqual(replay.outcome, 'POST_COMMIT_REPAIRED');
    assertEqual(db.prepare(`SELECT status FROM upgrade_proposals`).get().status, 'approved');
    assertEqual(provider.calls.resolve, resolveCalls, 'Repair must not revisit the provider');
    assertEqual(count(db, 'upgrade_history'), 1);
    assertEqual(events.filter(event => event.action === 'model_changed').length, 1);
    assertEqual(repository.getBindingApplicationState(replay.operationId).notificationStatus, 'SUCCEEDED');
  }, {
    runtimeFactory: runtime => Object.freeze({
      ...runtime,
      resolvePendingProposals(role, modelName) {
        if (failResolution) {
          failResolution = false;
          throw new Error('fixture proposal transaction failed');
        }
        return runtime.resolvePendingProposals(role, modelName);
      },
    }),
  });
});

await testAsync('startup proposal repair failure never fabricates a runtime failure', async () => {
  let initialProposalFailure = true;
  await withFixture(async ({ db, repository, provider, application }) => {
    db.prepare(`
      INSERT INTO upgrade_proposals (
        role, current_model, candidate_model, score, status, detected_at
      ) VALUES ('CHAT', 'fixture-base', 'fixture-target', 90, 'pending', ?)
    `).run('2026-08-09 04:30:00');
    const first = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    assertEqual(first.outcome, 'APPLIED_PROPOSAL_REPAIR_PENDING');
    const operation = latestOperation(repository);
    assertEqual(
      repository.getBindingApplicationState(operation.operationId).runtimeStatus,
      'APPLIED',
    );

    config.models.CHAT = 'fixture-base';
    const restartManager = new UpgradeManager();
    restartManager.setDb(db);
    const restartRuntime = restartManager.createBindingRuntimePort();
    let restartProposalFailure = true;
    const restartApplication = createModelBindingApplication({
      repository,
      runtime: Object.freeze({
        ...restartRuntime,
        resolvePendingProposals(role, modelName, operationKind) {
          if (restartProposalFailure) {
            restartProposalFailure = false;
            throw new Error('fixture startup proposal repair unavailable');
          }
          return restartRuntime.resolvePendingProposals(role, modelName, operationKind);
        },
      }),
      provider,
      publishControl: () => ({ accepted: true }),
      verificationAttempts: 1,
      delay: async () => {},
    });

    const restored = await restartApplication.rehydrateBindings();
    assertEqual(restored.failed.length, 0);
    assertEqual(restored.restored, 1);
    assertEqual(restored.warnings.length, 1);
    assertEqual(restored.warnings[0].code, 'MODEL_BINDING_PROPOSAL_RESOLUTION_FAILED');
    assertEqual(restartManager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
    let state = repository.getBindingApplicationState(operation.operationId);
    assertEqual(
      state.attempts.filter(attempt => (
        attempt.kind === 'STARTUP_REHYDRATE' && attempt.outcome === 'FAILED'
      )).length,
      0,
    );

    restartApplication.startBackgroundVerification();
    await restartApplication.awaitBackgroundWork();
    state = repository.getBindingApplicationState(operation.operationId);
    assertEqual(
      state.attempts.filter(attempt => (
        attempt.kind === 'STARTUP_REHYDRATE' && attempt.outcome === 'FAILED'
      )).length,
      0,
    );
    assertEqual(db.prepare('SELECT status FROM upgrade_proposals').get().status, 'approved');
    assertEqual(state.notificationStatus, 'SUCCEEDED');
    assertEqual(state.verificationStatus, 'VERIFIED');
  }, {
    runtimeFactory: runtime => Object.freeze({
      ...runtime,
      resolvePendingProposals(role, modelName, operationKind) {
        if (initialProposalFailure) {
          initialProposalFailure = false;
          throw new Error('fixture initial proposal resolution unavailable');
        }
        return runtime.resolvePendingProposals(role, modelName, operationKind);
      },
    }),
  });
});

await testAsync('rollback expires proposals without inventing an approval', async () => {
  await withFixture(async ({ db, application }) => {
    const applied = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();
    assertEqual(applied.outcome, 'APPLIED');

    const insert = db.prepare(`
      INSERT INTO upgrade_proposals (
        role, current_model, candidate_model, score, status, detected_at
      ) VALUES ('CHAT', 'fixture-target', ?, ?, 'pending', ?)
    `);
    insert.run('fixture-base', 99, '2026-08-09 05:00:00');
    insert.run('fixture-other', 90, '2026-08-09 04:00:00');

    await application.rollbackManualBinding({ role: 'CHAT' });
    await application.awaitBackgroundWork();
    const rows = db.prepare(`SELECT status FROM upgrade_proposals ORDER BY id`).all();
    assertEqual(rows.filter(row => row.status === 'approved').length, 0);
    assertEqual(rows.filter(row => row.status === 'expired').length, 2);
  });
});

await testAsync('direct authority injection fails before durable or runtime effects', async () => {
  await withFixture(async ({ db, manager, application, events }) => {
    const error = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
      actor: 'system:forged',
      requestKey: 'forged',
      digestSha256: DIGEST_B,
      verified: true,
    }));
    assertEqual(error.code, 'MODEL_BINDING_APPLICATION_AUTHORITY_OVERRIDE_REJECTED');
    assertEqual(count(db, 'model_binding_operations'), 0);
    assertEqual(count(db, 'model_desired_bindings'), 0);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
    assertEqual(events.length, 0);
  });
});

await testAsync('provider request-key bounds fail before every provider or binding effect', async () => {
  for (const invalidKey of ['x'.repeat(15), 'x'.repeat(129)]) {
    await withFixture(async ({ db, provider, application }) => {
      provider.models.delete('fixture-target');
      provider.pullTargets.set('fixture-target', model('fixture-target', DIGEST_B));
      const error = await captureError(application.applyManualBinding({
        role: 'CHAT',
        targetModel: 'fixture-target',
      }));
      assertEqual(error.code, 'MODEL_BINDING_APPLICATION_INPUT_INVALID');
      assertEqual(provider.calls.pull, 0);
      assertEqual(count(db, 'model_binding_provider_operations'), 0);
      assertEqual(count(db, 'model_binding_operations'), 0);
    }, {
      requestKeyFactory: () => invalidKey,
    });
  }
});

await testAsync('provider outage fails before intent and never emits model_changed', async () => {
  await withFixture(async ({ db, manager, provider, events, application }) => {
    provider.resolveError = new ModelBindingApplicationError(
      'MODEL_BINDING_PROVIDER_UNAVAILABLE',
      'fixture provider unavailable',
    );
    const error = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(error.code, 'MODEL_BINDING_PROVIDER_UNAVAILABLE');
    assertEqual(count(db, 'model_binding_operations'), 0);
    assertEqual(count(db, 'model_desired_bindings'), 0);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
    assertEqual(events.filter(event => event.action === 'model_changed').length, 0);
  });
});

await testAsync('missing target is pulled only after durable provider intent', async () => {
  await withFixture(async ({ db, provider, events, application }) => {
    provider.models.delete('fixture-target');
    provider.pullTargets.set(
      canonicalModelName('fixture-target'),
      model('fixture-target', DIGEST_B),
    );
    provider.onPullStart = () => {
      assertEqual(count(db, 'model_binding_provider_operations'), 1);
      assertEqual(count(db, 'model_binding_provider_attempts'), 0);
      assertEqual(count(db, 'model_binding_operations'), 0);
    };

    const result = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'Fixture-Target:LATEST',
    });
    await application.awaitBackgroundWork();

    const providerOperation = db.prepare(`
      SELECT request_key AS requestKey, requested_model_name AS requestedModel,
             requested_canonical_name AS requestedCanonical
      FROM model_binding_provider_operations
    `).get();
    const bindingOperation = db.prepare(`
      SELECT request_key AS requestKey FROM model_binding_operations
    `).get();
    const terminal = db.prepare(`
      SELECT outcome, observed_digest_sha256 AS digest
      FROM model_binding_provider_attempts
    `).get();
    assertEqual(providerOperation.requestKey, bindingOperation.requestKey);
    assertEqual(providerOperation.requestedModel, 'Fixture-Target:LATEST');
    assertEqual(providerOperation.requestedCanonical, 'fixture-target');
    assertEqual(terminal.outcome, 'SUCCEEDED');
    assertEqual(terminal.digest, DIGEST_B);
    assertEqual(result.to, 'fixture-target');
    assert(events.some(event => event.action === 'model_pull_progress'));
  });
});

await testAsync('failed pull leaves an audited request and no binding effect', async () => {
  await withFixture(async ({ db, manager, provider, events, application }) => {
    provider.models.delete('fixture-target');
    const error = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(error.code, 'MODEL_BINDING_TARGET_NOT_INSTALLED');
    assertEqual(count(db, 'model_binding_provider_operations'), 1);
    assertEqual(count(db, 'model_binding_provider_attempts'), 1);
    assertEqual(
      db.prepare('SELECT outcome FROM model_binding_provider_attempts').get().outcome,
      'FAILED',
    );
    assertEqual(count(db, 'model_binding_operations'), 0);
    assertEqual(count(db, 'model_overrides'), 0);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
    assertEqual(events.filter(event => event.action === 'model_changed').length, 0);
  });
});

await testAsync('post-pull identity outage stays pending and next apply reconciles without repull', async () => {
  await withFixture(async ({ db, repository, manager, provider, application }) => {
    provider.models.delete('fixture-target');
    provider.pullTargets.set(
      canonicalModelName('fixture-target'),
      model('fixture-target', DIGEST_B),
    );
    provider.onPullStart = () => {
      provider.resolveError = new ModelBindingApplicationError(
        'MODEL_BINDING_PROVIDER_UNAVAILABLE',
        'fixture identity observation unavailable after pull',
      );
    };

    const first = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(first.code, 'MODEL_BINDING_PROVIDER_OUTCOME_UNRESOLVED');
    assertEqual(provider.calls.pull, 1);
    assertEqual(repository.listPendingProviderOperations().length, 1);
    assertEqual(count(db, 'model_binding_provider_attempts'), 0);
    assertEqual(count(db, 'model_binding_operations'), 0);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');

    provider.resolveError = null;
    provider.onPullStart = null;
    const repaired = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target:latest',
    });
    await application.awaitBackgroundWork();
    assertEqual(repaired.outcome, 'APPLIED');
    assertEqual(provider.calls.pull, 1, 'Reconciliation must not repeat the provider effect');
    assertEqual(repository.listPendingProviderOperations().length, 0);
    assertEqual(count(db, 'model_binding_provider_attempts'), 1);
    assertEqual(
      db.prepare('SELECT outcome FROM model_binding_provider_attempts').get().outcome,
      'RECONCILED_PRESENT',
    );
    const providerOperation = db.prepare(`
      SELECT request_key AS requestKey, request_purpose AS purpose,
             expected_binding_revision AS expectedRevision, provider_origin AS providerOrigin
      FROM model_binding_provider_operations
    `).get();
    assertEqual(providerOperation.requestKey, latestOperation(repository).requestKey);
    assertEqual(providerOperation.purpose, 'USER_APPLY_TARGET');
    assertEqual(providerOperation.expectedRevision, 1);
    assertEqual(providerOperation.providerOrigin, provider.getOrigin());
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
  });
});

await testAsync('expired owned provider claim is fenced and reconciled before retry without repull', async () => {
  let failTerminalAudit = true;
  await withExpiringProviderFixture(async ({
    db, repository, provider, application, expireProviderClaim,
  }) => {
    provider.models.delete('fixture-target');
    provider.pullTargets.set(
      canonicalModelName('fixture-target'),
      model('fixture-target', DIGEST_B),
    );

    const first = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(first.code, 'MODEL_BINDING_PROVIDER_AUDIT_FAILED');
    assertEqual(provider.calls.pull, 1);
    assertEqual(repository.listPendingProviderOperations().length, 1);
    assertEqual(count(db, 'model_binding_operations'), 0);

    expireProviderClaim();

    const repaired = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();
    assertEqual(repaired.outcome, 'APPLIED');
    assertEqual(provider.calls.pull, 1, 'Audit repair must not repeat the provider effect');
    assertEqual(repository.listPendingProviderOperations().length, 0);
    assertEqual(count(db, 'model_binding_provider_attempts'), 1);
    assertEqual(
      db.prepare('SELECT outcome FROM model_binding_provider_attempts').get().outcome,
      'RECONCILED_PRESENT',
    );
    assertEqual(
      db.prepare('SELECT request_key AS key FROM model_binding_provider_operations').get().key,
      latestOperation(repository).requestKey,
    );
  }, {
    repositoryFactory(repository) {
      return repositoryProxy(repository, {
        recordManualProviderPullSucceeded(input) {
          if (failTerminalAudit) {
            failTerminalAudit = false;
            throw new Error('fixture provider terminal audit unavailable');
          }
          return repository.recordManualProviderPullSucceeded(input);
        },
      });
    },
  });
});

await testAsync('startup never reconciles a provider effect while its original lease is live', async () => {
  await withFixture(async ({ repository, provider, application }) => {
    repository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'fixture-base',
      digestSha256: DIGEST_A,
      source: 'CONFIG_DEFAULT',
      actor: 'system:binding-application',
    });
    const intent = repository.recordManualProviderPullIntent({
      requestKey: 'fixture-provider-live-claim-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: provider.getOrigin(),
      targetModelName: 'fixture-target',
      actor: 'user:fixture-operator',
    });
    provider.calls.inventory = 0;

    const blocked = await application.rehydrateBindings();
    assertEqual(blocked.failed.length, 1);
    assertEqual(blocked.failed[0].code, 'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS');
    assertEqual(provider.calls.inventory, 0);
    assertEqual(repository.getProviderOperation(intent.operation.operationId).terminal, null);
    assertEqual(repository.listPendingProviderOperations().length, 1);
  });
});

await testAsync('startup schedules one fenced recovery at live provider lease expiry', async () => {
  const scheduled = [];
  await withExpiringProviderFixture(async ({
    db, repository, manager, provider, application, expireProviderClaim,
  }) => {
    repository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'fixture-base',
      digestSha256: DIGEST_A,
      source: 'CONFIG_DEFAULT',
      actor: 'system:binding-application',
    });
    const intent = repository.recordManualProviderPullIntent({
      requestKey: 'fixture-provider-scheduled-recovery-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: provider.getOrigin(),
      targetModelName: 'fixture-target',
      actor: 'user:fixture-operator',
    });
    provider.calls.inventory = 0;

    const blocked = await application.rehydrateBindings();
    assertEqual(blocked.failed.length, 1);
    assertEqual(blocked.failed[0].code, 'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS');
    assertEqual(provider.calls.inventory, 0);
    assertEqual(scheduled.length, 1);
    assert(scheduled[0].delayMs >= 300_000 && scheduled[0].delayMs <= 300_001);

    expireProviderClaim();
    scheduled[0].callback();
    await application.awaitBackgroundWork();
    assertEqual(provider.calls.inventory, 1);
    assertEqual(
      repository.getProviderOperation(intent.operation.operationId).terminal.outcome,
      'RECONCILED_PRESENT',
    );
    assertEqual(count(db, 'model_binding_operations'), 1);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
  }, {
    scheduleRecovery(callback, delayMs) {
      const scheduledRecovery = { callback, delayMs };
      scheduled.push(scheduledRecovery);
      return scheduledRecovery;
    },
  });
});

await testAsync('scheduled recovery repeats at renewed lease boundaries after transient reconciliation failures', async () => {
  for (const scenario of ['inventory-outage', 'ambiguous', 'missing-digest']) {
    const scheduled = [];
    await withExpiringProviderFixture(async ({
      repository, provider, application, expireProviderClaim,
    }) => {
      repository.observeDesiredBinding({
        role: 'CHAT',
        modelName: 'fixture-base',
        digestSha256: DIGEST_A,
        source: 'CONFIG_DEFAULT',
        actor: 'system:binding-application',
      });
      const intent = repository.recordManualProviderPullIntent({
        requestKey: `fixture-provider-repeat-${scenario}-0001`,
        role: 'CHAT',
        requestPurpose: 'USER_APPLY_TARGET',
        expectedBindingRevision: 1,
        providerOrigin: provider.getOrigin(),
        targetModelName: 'fixture-target',
        actor: 'user:fixture-operator',
      });
      const initial = await application.rehydrateBindings();
      assertEqual(initial.failed[0].code, 'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS');
      assertEqual(scheduled.length, 1);

      expireProviderClaim();
      if (scenario === 'inventory-outage') {
        provider.resolveError = new ModelBindingApplicationError(
          'MODEL_BINDING_PROVIDER_UNAVAILABLE',
          'fixture scheduled inventory outage',
        );
      } else if (scenario === 'ambiguous') {
        provider.models.set('fixture-target:latest', model('fixture-target:latest', DIGEST_C));
      } else {
        provider.models.set('fixture-target', model('fixture-target', ''));
      }
      scheduled[0].callback();
      await application.awaitBackgroundWork();
      assertEqual(repository.getProviderOperation(intent.operation.operationId).terminal, null);
      assertEqual(scheduled.length, 2, `${scenario} did not schedule a bounded retry`);
      assert(scheduled[1].delayMs >= 300_000 && scheduled[1].delayMs <= 300_001);

      expireProviderClaim();
      provider.resolveError = null;
      provider.models.delete('fixture-target:latest');
      provider.models.set('fixture-target', model('fixture-target', DIGEST_B));
      scheduled[1].callback();
      await application.awaitBackgroundWork();
      assertEqual(
        repository.getProviderOperation(intent.operation.operationId).terminal.outcome,
        'RECONCILED_PRESENT',
      );
      assertEqual(scheduled.length, 2, `${scenario} scheduled after terminal recovery`);
    }, {
      scheduleRecovery(callback, delayMs) {
        const record = { callback, delayMs };
        scheduled.push(record);
        return record;
      },
      cancelRecovery() {},
    });
  }
});

await testAsync('terminal provider recovery retries the unfinished binding commit', async () => {
  for (const scenario of ['runtime-guard', 'binding-record']) {
    const scheduled = [];
    let failBindingRecord = scenario === 'binding-record';
    await withExpiringProviderFixture(async ({
      repository, manager, provider, application, expireProviderClaim,
    }) => {
      repository.observeDesiredBinding({
        role: 'CHAT',
        modelName: 'fixture-base',
        digestSha256: DIGEST_A,
        source: 'CONFIG_DEFAULT',
        actor: 'system:binding-application',
      });
      const intent = repository.recordManualProviderPullIntent({
        requestKey: `fixture-provider-terminal-retry-${scenario}-0001`,
        role: 'CHAT',
        requestPurpose: 'USER_APPLY_TARGET',
        expectedBindingRevision: 1,
        providerOrigin: provider.getOrigin(),
        targetModelName: 'fixture-target',
        actor: 'user:fixture-operator',
      });
      if (scenario === 'runtime-guard') {
        manager._getRuntimeGuardDecision = modelName => ({
          allowed: canonicalModelName(modelName) !== 'fixture-target',
          reason: 'fixture transient runtime guard',
        });
      }

      await application.rehydrateBindings();
      assertEqual(scheduled.length, 1);
      expireProviderClaim();
      scheduled[0].callback();
      await application.awaitBackgroundWork();
      assertEqual(
        repository.getProviderOperation(intent.operation.operationId).terminal.outcome,
        'RECONCILED_PRESENT',
      );
      assertEqual(scheduled.length, 2, `${scenario} did not schedule binding recovery`);
      assertEqual(scheduled[1].delayMs, 1);

      manager._getRuntimeGuardDecision = () => ({ allowed: true, reason: null });
      scheduled[1].callback();
      await application.awaitBackgroundWork();
      const operation = repository.getEffectiveBinding('CHAT').operation;
      assert(operation && operation.requestKey === intent.operation.requestKey);
      assertEqual(
        repository.getBindingApplicationState(operation.operationId).runtimeStatus,
        'APPLIED',
      );
      assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
      assertEqual(scheduled.length, 2, `${scenario} rescheduled after applied binding`);
    }, {
      repositoryFactory(repository) {
        if (scenario !== 'binding-record') return repository;
        return repositoryProxy(repository, {
          recordUserBindingApply(input) {
            if (failBindingRecord) {
              failBindingRecord = false;
              throw new Error('fixture transient binding record failure');
            }
            return repository.recordUserBindingApply(input);
          },
        });
      },
      scheduleRecovery(callback, delayMs) {
        const record = { callback, delayMs };
        scheduled.push(record);
        return record;
      },
      cancelRecovery() {},
    });
  }
});

await testAsync('provider origin mismatch blocks startup and explicit resume before provider reads', async () => {
  await withFixture(async ({ db, repository, manager, provider, application }) => {
    repository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'fixture-base',
      digestSha256: DIGEST_A,
      source: 'CONFIG_DEFAULT',
      actor: 'system:binding-application',
    });
    const pending = repository.recordManualProviderPullIntent({
      requestKey: 'fixture-provider-origin-pending-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: 'http://127.0.0.1:11435',
      targetModelName: 'fixture-target',
      actor: 'user:fixture-operator',
    });
    provider.calls.inventory = 0;
    const startup = await application.rehydrateBindings();
    assertEqual(startup.failed.length, 1);
    assertEqual(startup.failed[0].code, 'MODEL_BINDING_PROVIDER_ORIGIN_MISMATCH');
    assertEqual(provider.calls.inventory, 0);
    assertEqual(repository.getProviderOperation(pending.operation.operationId).terminal, null);

    repository.recordManualProviderPullSucceeded({
      operationId: pending.operation.operationId,
      ...providerClaim(pending.operation),
      observedModelName: 'fixture-target',
      observedDigestSha256: DIGEST_B,
    });
    const terminalStartup = await application.rehydrateBindings();
    assertEqual(terminalStartup.failed.length, 1);
    assertEqual(terminalStartup.failed[0].code, 'MODEL_BINDING_PROVIDER_ORIGIN_MISMATCH');
    assertEqual(provider.calls.inventory, 0);
    assertEqual(count(db, 'model_binding_operations'), 0);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');

    const explicit = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(explicit.code, 'MODEL_BINDING_PROVIDER_ORIGIN_MISMATCH');
    assertEqual(count(db, 'model_binding_operations'), 0);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
  });
});

await testAsync('startup reconciles and resumes a durable provider intent with one inventory', async () => {
  await withExpiringProviderFixture(async ({
    db, repository, manager, provider, application, expireProviderClaim,
  }) => {
    repository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'fixture-base',
      digestSha256: DIGEST_A,
      source: 'CONFIG_DEFAULT',
      actor: 'system:binding-application',
    });
    const intent = repository.recordManualProviderPullIntent({
      requestKey: 'fixture-provider-startup-reconcile-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: provider.getOrigin(),
      targetModelName: 'fixture-target:latest',
      actor: 'user:fixture-operator',
    });
    expireProviderClaim();
    provider.calls.inventory = 0;

    const restored = await application.rehydrateBindings();
    assertEqual(restored.failed.length, 0);
    assertEqual(restored.restored, 1);
    assertEqual(provider.calls.inventory, 1);
    assertEqual(repository.listPendingProviderOperations().length, 0);
    assertEqual(
      repository.getProviderOperation(intent.operation.operationId).terminal.outcome,
      'RECONCILED_PRESENT',
    );
    const binding = latestOperation(repository);
    assertEqual(binding.requestKey, intent.operation.requestKey);
    assertEqual(count(db, 'model_binding_operations'), 1);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
  });
});

await testAsync('startup resumes terminal provider success from the pre-binding crash window', async () => {
  await withFixture(async ({ db, repository, manager, provider, application }) => {
    repository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'fixture-base',
      digestSha256: DIGEST_A,
      source: 'CONFIG_DEFAULT',
      actor: 'system:binding-application',
    });
    const intent = repository.recordManualProviderPullIntent({
      requestKey: 'fixture-provider-terminal-resume-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: provider.getOrigin(),
      targetModelName: 'fixture-target',
      actor: 'user:fixture-operator',
    });
    repository.recordManualProviderPullSucceeded({
      operationId: intent.operation.operationId,
      ...providerClaim(intent.operation),
      observedModelName: 'fixture-target',
      observedDigestSha256: DIGEST_B,
    });

    const restored = await application.rehydrateBindings();
    assertEqual(restored.failed.length, 0);
    assertEqual(restored.restored, 1);
    assertEqual(count(db, 'model_binding_operations'), 1);
    assertEqual(latestOperation(repository).requestKey, intent.operation.requestKey);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
  });
});

await testAsync('startup closes a same-target provider terminal with one durable no-op receipt', async () => {
  await withFixture(async ({ db, repository, manager, provider, events, application }) => {
    repository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'fixture-base',
      digestSha256: DIGEST_A,
      source: 'CONFIG_DEFAULT',
      actor: 'system:binding-application',
    });
    const intent = repository.recordManualProviderPullIntent({
      requestKey: 'fixture-provider-terminal-noop-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: provider.getOrigin(),
      targetModelName: 'fixture-base',
      actor: 'user:fixture-operator',
    });
    repository.recordManualProviderPullSucceeded({
      operationId: intent.operation.operationId,
      ...providerClaim(intent.operation),
      observedModelName: 'fixture-base',
      observedDigestSha256: DIGEST_A,
    });
    const pullsBefore = provider.calls.pull;

    const restored = await application.rehydrateBindings();
    assertEqual(restored.failed.length, 0);
    assertEqual(count(db, 'model_binding_operations'), 0);
    assertEqual(count(db, 'model_binding_user_noop_receipts'), 1);
    assertEqual(count(db, 'model_binding_user_noop_provider_supersedes'), 1);
    const receipt = db.prepare(`
      SELECT request_key AS requestKey, source_provider_operation_id AS sourceProviderOperationId
      FROM model_binding_user_noop_receipts
    `).get();
    assertEqual(receipt.requestKey, intent.operation.requestKey);
    assertEqual(receipt.sourceProviderOperationId, intent.operation.operationId);
    assertEqual(repository.listResumableProviderOperations().length, 0);
    assertEqual(provider.calls.pull, pullsBefore);
    assertEqual(events.filter(event => event.action === 'model_changed').length, 0);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');

    const restarted = createModelBindingApplication({
      repository,
      runtime: manager.createBindingRuntimePort(),
      provider,
      publishControl: () => ({ accepted: true }),
      verificationAttempts: 1,
      delay: async () => {},
      logger: { warn() {}, info() {}, debug() {}, error() {} },
    });
    const second = await restarted.rehydrateBindings();
    assertEqual(second.failed.length, 0);
    assertEqual(count(db, 'model_binding_user_noop_receipts'), 1);
    assertEqual(provider.calls.pull, pullsBefore);
    assertEqual(events.filter(event => event.action === 'model_changed').length, 0);
  });
});

await testAsync('installed alternate target cannot bypass an unresolved provider success', async () => {
  await withFixture(async ({ db, repository, manager, provider, application }) => {
    repository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'fixture-base',
      digestSha256: DIGEST_A,
      source: 'CONFIG_DEFAULT',
      actor: 'system:binding-application',
    });
    const intent = repository.recordManualProviderPullIntent({
      requestKey: 'fixture-provider-unresolved-installed-bypass-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: provider.getOrigin(),
      targetModelName: 'fixture-target',
      actor: 'user:fixture-operator',
    });
    repository.recordManualProviderPullSucceeded({
      operationId: intent.operation.operationId,
      ...providerClaim(intent.operation),
      observedModelName: 'fixture-target',
      observedDigestSha256: DIGEST_B,
    });
    assert(provider.models.has('fixture-other'));

    const blocked = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-other',
    }));
    assertEqual(blocked.code, 'MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS');
    assertEqual(repository.getDesired('CHAT').bindingRevision, 1);
    assertEqual(count(db, 'model_binding_operations'), 0);
    assertEqual(repository.listResumableProviderOperations().length, 1);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
    assertEqual(provider.calls.pull, 0);
  });
});

await testAsync('startup absence is observational, visible and requires a new provider attempt', async () => {
  await withExpiringProviderFixture(async ({
    db, repository, manager, provider, application, expireProviderClaim,
  }) => {
    repository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'fixture-base',
      digestSha256: DIGEST_A,
      source: 'CONFIG_DEFAULT',
      actor: 'system:binding-application',
    });
    provider.models.delete('fixture-target');
    const intent = repository.recordManualProviderPullIntent({
      requestKey: 'fixture-provider-absent-reconcile-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: provider.getOrigin(),
      targetModelName: 'fixture-target',
      actor: 'user:fixture-operator',
    });
    expireProviderClaim();

    const restored = await application.rehydrateBindings();
    assertEqual(restored.failed.length, 1);
    assertEqual(restored.failed[0].code, 'MODEL_BINDING_PROVIDER_OUTCOME_UNRESOLVED');
    assertEqual(
      repository.getProviderOperation(intent.operation.operationId).terminal.outcome,
      'RECONCILED_ABSENT',
    );
    assertEqual(count(db, 'model_binding_operations'), 0);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
    const status = application.getBindingStatus({ role: 'CHAT' });
    assertEqual(status.providerOperationId, intent.operation.operationId);
    assertEqual(status.providerRequestKey, intent.operation.requestKey);
    assertEqual(status.providerRequestPurpose, 'USER_APPLY_TARGET');
    assertEqual(status.providerStatus, 'RECONCILED_ABSENT');
    assertEqual(
      status.providerFailureCode,
      'MODEL_BINDING_PROVIDER_OUTCOME_UNRESOLVED',
    );
    assertEqual(status.providerRetryable, true);

    provider.pullTargets.set('fixture-target', model('fixture-target', DIGEST_B));
    const repaired = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();
    assertEqual(repaired.outcome, 'APPLIED');
    assertEqual(provider.calls.pull, 1);
    assertEqual(count(db, 'model_binding_provider_operations'), 2);
    assertEqual(count(db, 'model_binding_provider_attempts'), 2);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
  });
});

await testAsync('provider status hides historical absence after a newer installed binding', async () => {
  await withExpiringProviderFixture(async ({
    repository, provider, application, expireProviderClaim,
  }) => {
    repository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'fixture-base',
      digestSha256: DIGEST_A,
      source: 'CONFIG_DEFAULT',
      actor: 'system:binding-application',
    });
    provider.models.delete('fixture-target');
    const absent = repository.recordManualProviderPullIntent({
      requestKey: 'fixture-provider-status-absent-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: provider.getOrigin(),
      targetModelName: 'fixture-target',
      actor: 'user:fixture-operator',
    });
    expireProviderClaim();
    const reconciled = await application.rehydrateBindings();
    assertEqual(reconciled.failed[0].code, 'MODEL_BINDING_PROVIDER_OUTCOME_UNRESOLVED');
    assertEqual(
      application.getBindingStatus({ role: 'CHAT' }).providerOperationId,
      absent.operation.operationId,
    );

    provider.models.set('fixture-target', model('fixture-target', DIGEST_B));
    const applied = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();
    assertEqual(applied.outcome, 'APPLIED');
    const current = application.getBindingStatus({ role: 'CHAT' });
    assertEqual(current.runtimeStatus, 'APPLIED');
    assertEqual(current.providerOperationId, null);
    assertEqual(current.providerStatus, null);
    assertEqual(application.getBindingStatus({ role: 'R1' }).providerOperationId, null);
  });
});

await testAsync('same-target acceptance is durable, resolves proposals and supersedes stale provider status', async () => {
  await withExpiringProviderFixture(async ({
    db, repository, provider, events, application, expireProviderClaim,
  }) => {
    repository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'fixture-base',
      digestSha256: DIGEST_A,
      source: 'CONFIG_DEFAULT',
      actor: 'system:binding-application',
    });
    provider.models.delete('fixture-target');
    const absent = repository.recordManualProviderPullIntent({
      requestKey: 'fixture-provider-noop-status-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: provider.getOrigin(),
      targetModelName: 'fixture-target',
      actor: 'user:fixture-operator',
    });
    expireProviderClaim();
    await application.rehydrateBindings();
    assertEqual(
      application.getBindingStatus({ role: 'CHAT' }).providerOperationId,
      absent.operation.operationId,
    );
    db.prepare(`
      INSERT INTO upgrade_proposals (
        role, current_model, candidate_model, score, status, detected_at
      ) VALUES ('CHAT', 'fixture-base', 'fixture-base', 90, 'pending', ?)
    `).run('2026-08-09 05:00:00');

    const started = await application.beginManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-base',
    });
    assertEqual(started.phase, 'UNCHANGED');
    assertEqual(started.operationId, null);
    assert(typeof started.noOpReceiptId === 'string' && started.noOpReceiptId.length >= 16);
    const applied = await started.completion;
    await application.awaitBackgroundWork();
    assertEqual(applied.changed, false);
    assertEqual(applied.from, 'fixture-base');
    assertEqual(applied.to, 'fixture-base');
    assertEqual(applied.proposalResolutionStatus, 'SUCCEEDED');
    assertEqual(count(db, 'model_binding_operations'), 0);
    assertEqual(count(db, 'model_binding_user_noop_receipts'), 1);
    assertEqual(db.prepare('SELECT status FROM upgrade_proposals').get().status, 'approved');
    assertEqual(application.getBindingStatus({ role: 'CHAT' }).providerOperationId, null);
    assertEqual(events.filter(event => event.action === 'model_changed').length, 0);
  });
});

await testAsync('no-op receipt prevents superseded provider success from reviving on timer or restart', async () => {
  const scheduled = [];
  await withExpiringProviderFixture(async ({
    db, repository, manager, provider, application,
  }) => {
    repository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'fixture-base',
      digestSha256: DIGEST_A,
      source: 'CONFIG_DEFAULT',
      actor: 'system:binding-application',
    });
    const intent = repository.recordManualProviderPullIntent({
      requestKey: 'fixture-provider-noop-terminal-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: provider.getOrigin(),
      targetModelName: 'fixture-target',
      actor: 'user:fixture-operator',
    });
    const blocked = await application.rehydrateBindings();
    assertEqual(blocked.failed[0].code, 'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS');
    assertEqual(scheduled.length, 1);
    repository.recordManualProviderPullSucceeded({
      operationId: intent.operation.operationId,
      ...providerClaim(intent.operation),
      observedModelName: 'fixture-target',
      observedDigestSha256: DIGEST_B,
    });

    const accepted = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-base',
    });
    assertEqual(accepted.changed, false);
    assertEqual(repository.listResumableProviderOperations().length, 0);
    assertEqual(application.getBindingStatus({ role: 'CHAT' }).providerOperationId, null);

    scheduled[0].callback();
    await application.awaitBackgroundWork();
    assertEqual(scheduled.length, 1);
    assertEqual(count(db, 'model_binding_operations'), 0);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');

    const restarted = createModelBindingApplication({
      repository,
      runtime: manager.createBindingRuntimePort(),
      provider,
      publishControl: () => ({ accepted: true }),
      verificationAttempts: 1,
      delay: async () => {},
      logger: { warn() {}, info() {}, debug() {}, error() {} },
    });
    const restored = await restarted.rehydrateBindings();
    assertEqual(restored.failed.length, 0);
    assertEqual(count(db, 'model_binding_operations'), 0);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
  }, {
    scheduleRecovery(callback, delayMs) {
      const record = { callback, delayMs };
      scheduled.push(record);
      return record;
    },
    cancelRecovery() {},
  });
});

await testAsync('startup leaves ambiguous provider identity pending until exact recovery', async () => {
  await withExpiringProviderFixture(async ({
    repository, provider, application, expireProviderClaim,
  }) => {
    repository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'fixture-base',
      digestSha256: DIGEST_A,
      source: 'CONFIG_DEFAULT',
      actor: 'system:binding-application',
    });
    const intent = repository.recordManualProviderPullIntent({
      requestKey: 'fixture-provider-ambiguous-reconcile-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: provider.getOrigin(),
      targetModelName: 'fixture-target',
      actor: 'user:fixture-operator',
    });
    expireProviderClaim();
    provider.models.set('fixture-target:latest', model('fixture-target:latest', DIGEST_B));

    const blocked = await application.rehydrateBindings();
    assertEqual(blocked.failed.length, 1);
    assertEqual(blocked.failed[0].code, 'MODEL_BINDING_PROVIDER_RECONCILIATION_REQUIRED');
    assertEqual(repository.getProviderOperation(intent.operation.operationId).terminal, null);

    provider.models.delete('fixture-target:latest');
    const repaired = await application.rehydrateBindings();
    assertEqual(repaired.failed.length, 0);
    assertEqual(repaired.restored, 1);
    assertEqual(
      repository.getProviderOperation(intent.operation.operationId).terminal.outcome,
      'RECONCILED_PRESENT',
    );
  });
});

await testAsync('startup inventory outage leaves provider intent pending and retries exactly', async () => {
  await withExpiringProviderFixture(async ({
    repository, provider, application, expireProviderClaim,
  }) => {
    repository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'fixture-base',
      digestSha256: DIGEST_A,
      source: 'CONFIG_DEFAULT',
      actor: 'system:binding-application',
    });
    const intent = repository.recordManualProviderPullIntent({
      requestKey: 'fixture-provider-inventory-retry-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: provider.getOrigin(),
      targetModelName: 'fixture-target',
      actor: 'user:fixture-operator',
    });
    expireProviderClaim();
    provider.resolveError = new ModelBindingApplicationError(
      'MODEL_BINDING_PROVIDER_UNAVAILABLE',
      'fixture startup inventory unavailable',
    );

    const blocked = await application.rehydrateBindings();
    assertEqual(blocked.failed.length, 1);
    assertEqual(blocked.failed[0].code, 'MODEL_BINDING_PROVIDER_UNAVAILABLE');
    assertEqual(repository.getProviderOperation(intent.operation.operationId).terminal, null);
    assertEqual(repository.listPendingProviderOperations().length, 1);

    provider.resolveError = null;
    const repaired = await application.rehydrateBindings();
    assertEqual(repaired.failed.length, 0);
    assertEqual(repaired.restored, 1);
    assertEqual(repository.listPendingProviderOperations().length, 0);
  });
});

await testAsync('startup missing digest and terminal-audit outage remain retryable pending truth', async () => {
  let failReconciledAudit = true;
  await withExpiringProviderFixture(async ({
    repository, provider, application, expireProviderClaim,
  }) => {
    repository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'fixture-base',
      digestSha256: DIGEST_A,
      source: 'CONFIG_DEFAULT',
      actor: 'system:binding-application',
    });
    const intent = repository.recordManualProviderPullIntent({
      requestKey: 'fixture-provider-digest-audit-retry-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: provider.getOrigin(),
      targetModelName: 'fixture-target',
      actor: 'user:fixture-operator',
    });
    expireProviderClaim();
    provider.models.set('fixture-target', model('fixture-target', ''));

    const missingDigest = await application.rehydrateBindings();
    assertEqual(missingDigest.failed.length, 1);
    assertEqual(
      missingDigest.failed[0].code,
      'MODEL_BINDING_PROVIDER_RECONCILIATION_REQUIRED',
    );
    assertEqual(repository.getProviderOperation(intent.operation.operationId).terminal, null);

    provider.models.set('fixture-target', model('fixture-target', DIGEST_B));
    const auditBlocked = await application.rehydrateBindings();
    assertEqual(auditBlocked.failed.length, 1);
    assertEqual(
      auditBlocked.failed[0].code,
      'MODEL_BINDING_PROVIDER_RECONCILIATION_REQUIRED',
    );
    assertEqual(repository.getProviderOperation(intent.operation.operationId).terminal, null);

    const repaired = await application.rehydrateBindings();
    assertEqual(repaired.failed.length, 0);
    assertEqual(repaired.restored, 1);
    assertEqual(
      repository.getProviderOperation(intent.operation.operationId).terminal.outcome,
      'RECONCILED_PRESENT',
    );
  }, {
    repositoryFactory(repository) {
      return repositoryProxy(repository, {
        recordManualProviderPullReconciledPresent(input) {
          if (failReconciledAudit) {
            failReconciledAudit = false;
            throw new Error('fixture reconciled terminal audit unavailable');
          }
          return repository.recordManualProviderPullReconciledPresent(input);
        },
      });
    },
  });
});

await testAsync('new apply reconciles same-origin pending effects from another role', async () => {
  await withExpiringProviderFixture(async ({
    repository, provider, application, expireProviderClaim,
  }) => {
    const orphan = repository.recordManualProviderPullIntent({
      requestKey: 'fixture-provider-cross-role-reconcile-0001',
      role: 'R1',
      requestPurpose: 'LEGACY_BASELINE_RECOVERY',
      expectedBindingRevision: null,
      providerOrigin: provider.getOrigin(),
      targetModelName: 'fixture-target',
      actor: 'user:fixture-operator',
    });
    expireProviderClaim();

    const applied = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-other',
    });
    await application.awaitBackgroundWork();
    assertEqual(applied.outcome, 'APPLIED');
    assertEqual(repository.listPendingProviderOperations().length, 0);
    assertEqual(
      repository.getProviderOperation(orphan.operation.operationId).terminal.outcome,
      'RECONCILED_PRESENT',
    );
    assertEqual(provider.calls.pull, 0);
  });
});

await testAsync('concurrent apply loses with typed 409 and creates no second effect', async () => {
  await withFixture(async ({ db, manager, provider, application }) => {
    provider.models.delete('fixture-target');
    provider.pullTargets.set(
      canonicalModelName('fixture-target'),
      model('fixture-target', DIGEST_B),
    );
    provider.pullGate = deferred();

    const started = await application.beginManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    assertEqual(started.phase, 'PROVIDER_INTENT');
    const loser = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-other',
    }));
    assertEqual(loser.code, 'MODEL_BINDING_APPLICATION_BUSY');
    assertEqual(loser.httpStatus, 409);
    assertEqual(provider.calls.pull, 1);
    assertEqual(count(db, 'model_binding_provider_operations'), 1);
    assertEqual(count(db, 'model_binding_operations'), 0);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');

    provider.pullGate.resolve();
    const winner = await started.completion;
    await application.awaitBackgroundWork();
    assertEqual(winner.outcome, 'APPLIED');
    assertEqual(count(db, 'model_binding_provider_operations'), 1);
    assertEqual(count(db, 'model_binding_operations'), 1);
  });
});

await testAsync('two WAL application instances reject a second effect under a live claim', async () => {
  const directory = mkdtempSync(path.join(
    process.env.INTENTSMITH_TEST_ARTIFACT_DIR,
    'binding-provider-wal-race-',
  ));
  const databasePath = path.join(directory, 'binding.sqlite');
  const provider = new FakeExactProvider();
  let firstDb;
  let secondDb;
  try {
    config.models.CHAT = 'fixture-base';
    firstDb = new Database(databasePath);
    firstDb.pragma('journal_mode = WAL');
    firstDb.pragma('foreign_keys = ON');
    firstDb.pragma('busy_timeout = 5000');
    await runMigrations(firstDb);
    secondDb = new Database(databasePath);
    secondDb.pragma('journal_mode = WAL');
    secondDb.pragma('foreign_keys = ON');
    secondDb.pragma('busy_timeout = 5000');
    const firstRepository = createModelFailoverRepository(firstDb);
    const secondRepository = createModelFailoverRepository(secondDb);
    firstRepository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'fixture-base',
      digestSha256: DIGEST_A,
      source: 'CONFIG_DEFAULT',
      actor: 'system:binding-application',
    });
    const firstManager = new UpgradeManager();
    firstManager.setDb(firstDb);
    const secondManager = new UpgradeManager();
    secondManager.setDb(secondDb);
    const createApplication = (repository, manager, prefix) => createModelBindingApplication({
      repository,
      runtime: manager.createBindingRuntimePort(),
      provider,
      publishControl: () => ({ accepted: true }),
      requestKeyFactory: ({ kind, role }) => `${prefix}-${kind}-${role}-request-0001`,
      actorFactory: () => `user:${prefix}`,
      verificationAttempts: 1,
      delay: async () => {},
      logger: { warn() {}, info() {}, debug() {}, error() {} },
    });
    const firstApplication = createApplication(firstRepository, firstManager, 'first-worker');
    const secondApplication = createApplication(secondRepository, secondManager, 'second-worker');
    provider.models.delete('fixture-target');
    provider.pullTargets.set('fixture-target', model('fixture-target', DIGEST_B));
    provider.pullGate = deferred();

    const winner = await firstApplication.beginManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    assertEqual(winner.phase, 'PROVIDER_INTENT');
    const loser = await captureError(secondApplication.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(loser.code, 'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS');
    assertEqual(provider.calls.pull, 1);
    assertEqual(count(firstDb, 'model_binding_provider_operations'), 1);
    assertEqual(count(firstDb, 'model_binding_provider_attempts'), 0);

    provider.pullGate.resolve();
    const completed = await winner.completion;
    assertEqual(completed.outcome, 'APPLIED');
    assertEqual(provider.calls.pull, 1);
    assertEqual(count(firstDb, 'model_binding_operations'), 1);
    assertEqual(firstManager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
  } finally {
    restoreBindings();
    if (secondDb?.open) secondDb.close();
    if (firstDb?.open) firstDb.close();
    rmSync(directory, { recursive: true, force: false });
  }
});

await testAsync('two Worker isolates race one WAL provider effect and one typed loser', async () => {
  const directory = mkdtempSync(path.join(
    process.env.INTENTSMITH_TEST_ARTIFACT_DIR,
    'binding-provider-worker-race-',
  ));
  const databasePath = path.join(directory, 'binding.sqlite');
  const pullRelease = deferred();
  let pullRequests = 0;
  let targetInstalled = false;
  let db;
  try {
    await withLoopbackServer(async (req, res) => {
      if (req.method === 'GET' && req.url === '/api/tags') {
        const models = [{ name: 'fixture-base', digest: DIGEST_A }];
        if (targetInstalled) models.push({ name: 'fixture-target', digest: DIGEST_B });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ models }));
        return;
      }
      if (req.method === 'POST' && req.url === '/fixture-pull') {
        pullRequests++;
        // A broken claim guard must finish as a deterministic two-effect
        // assertion failure instead of leaving both workers parked forever.
        if (pullRequests > 1) pullRelease.resolve();
        await pullRelease.promise;
        targetInstalled = true;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      res.writeHead(404);
      res.end();
    }, async providerOrigin => {
      db = new Database(databasePath);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      db.pragma('busy_timeout = 5000');
      await runMigrations(db);
      createModelFailoverRepository(db).observeDesiredBinding({
        role: 'CHAT',
        modelName: 'fixture-base',
        digestSha256: DIGEST_A,
        source: 'CONFIG_DEFAULT',
        actor: 'system:binding-application',
      });

      const records = ['worker-left', 'worker-right'].map(prefix => {
        const ready = deferred();
        const result = deferred();
        const worker = new Worker(BINDING_APPLICATION_WORKER_SOURCE, {
          eval: true,
          workerData: {
            prefix,
            databasePath,
            providerOrigin,
            repositoryModuleUrl: new URL('../src/upgrade/model-failover.js', import.meta.url).href,
            applicationModuleUrl: new URL('../src/upgrade/model-binding-application.js', import.meta.url).href,
            managerModuleUrl: new URL('../src/upgrade/upgrade-manager.js', import.meta.url).href,
            configModuleUrl: new URL('../src/config.js', import.meta.url).href,
          },
        });
        worker.on('message', message => {
          if (message.type === 'ready') ready.resolve();
          if (message.type === 'result') {
            if (!message.ok) pullRelease.resolve();
            result.resolve(message);
          }
          if (message.type === 'fatal') {
            const error = new Error(message.message);
            ready.reject(error);
            result.reject(error);
            pullRelease.resolve();
          }
        });
        worker.on('error', error => {
          ready.reject(error);
          result.reject(error);
          pullRelease.resolve();
        });
        return {
          worker,
          ready: ready.promise,
          result: result.promise,
          exited: once(worker, 'exit'),
        };
      });
      await Promise.all(records.map(record => record.ready));
      for (const record of records) record.worker.postMessage({ type: 'go' });
      let watchdog;
      const results = await Promise.race([
        Promise.all(records.map(record => record.result)),
        new Promise((_, reject) => {
          watchdog = setTimeout(() => {
            pullRelease.resolve();
            for (const record of records) record.worker.terminate();
            reject(new Error('Worker/WAL provider race timed out after 5000 ms'));
          }, 5000);
        }),
      ]).finally(() => clearTimeout(watchdog));
      pullRelease.resolve();
      await Promise.all(records.map(record => record.exited));

      assertEqual(results.filter(result => result.ok).length, 1);
      assertEqual(results.filter(result => !result.ok).length, 1);
      assertEqual(
        results.find(result => !result.ok).code,
        'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS',
      );
      assertEqual(pullRequests, 1);
      assertEqual(count(db, 'model_binding_provider_operations'), 1);
      assertEqual(count(db, 'model_binding_provider_attempts'), 1);
      assertEqual(count(db, 'model_binding_operations'), 1);
    });
  } finally {
    pullRelease.resolve();
    if (db?.open) db.close();
    restoreBindings();
    rmSync(directory, { recursive: true, force: false });
  }
});

await testAsync('digest drift after intent is durable, terminal and has no runtime effect', async () => {
  await withFixture(async ({ db, repository, manager, provider, events, application }) => {
    provider.afterEnsure = resolved => {
      if (resolved.name === 'fixture-target') {
        provider.models.set('fixture-target', model('fixture-target', DIGEST_C));
      }
    };
    const error = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(error.code, 'MODEL_BINDING_TARGET_DIGEST_DRIFT');
    const operation = latestOperation(repository);
    const state = repository.getBindingApplicationState(operation.operationId);
    assertEqual(state.runtimeStatus, 'FAILED');
    assertEqual(state.failureCode, 'MODEL_BINDING_TARGET_DIGEST_DRIFT');
    assertEqual(state.retryable, false);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
    assertEqual(count(db, 'model_overrides'), 0);
    assertEqual(count(db, 'upgrade_history'), 0);
    assertEqual(events.filter(event => event.action === 'model_changed').length, 0);
  });
});

await testAsync('non-retryable apply requires explicit rollback before a replacement', async () => {
  await withFixture(async ({ db, repository, manager, provider, application }) => {
    provider.afterEnsure = resolved => {
      if (resolved.name === 'fixture-target') {
        provider.models.set('fixture-target', model('fixture-target', DIGEST_C));
      }
    };
    const failed = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(failed.code, 'MODEL_BINDING_TARGET_DIGEST_DRIFT');
    const first = latestOperation(repository);
    assertEqual(repository.getBindingApplicationState(first.operationId).retryable, false);

    const before = {
      operations: count(db, 'model_binding_operations'),
      runtime: manager.createBindingRuntimePort().snapshot('CHAT').modelName,
      desired: JSON.stringify(repository.getDesired('CHAT')),
    };
    const blocked = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-other',
    }));
    assertEqual(blocked.code, 'MODEL_BINDING_APPLICATION_NONRETRYABLE_TERMINAL');
    assertEqual(count(db, 'model_binding_operations'), before.operations);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, before.runtime);
    assertEqual(JSON.stringify(repository.getDesired('CHAT')), before.desired);

    await application.rollbackManualBinding({ role: 'CHAT' });
    const replacement = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-other',
    });
    await application.awaitBackgroundWork();
    assertEqual(replacement.outcome, 'APPLIED');
    assert(replacement.operationId !== first.operationId);
    assertEqual(count(db, 'model_binding_operations'), 3);
    assertEqual(
      db.prepare(`SELECT COUNT(*) AS n FROM model_binding_operations WHERE operation_kind = 'USER_ROLLBACK'`).get().n,
      1,
    );
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-other');
    assertEqual(repository.getBindingApplicationState(first.operationId).runtimeStatus, 'FAILED');
  });
});

await testAsync('same canonical retries get a new truthful receipt after explicit rollback', async () => {
  await withFixture(async ({ db, repository, manager, provider, application }) => {
    provider.afterEnsure = resolved => {
      if (resolved.name === 'fixture-target') {
        provider.models.set('fixture-target', model('fixture-target', DIGEST_C));
      }
    };
    const firstError = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(firstError.code, 'MODEL_BINDING_TARGET_DIGEST_DRIFT');
    const failed = latestOperation(repository);

    const blocked = await captureError(application.beginManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target:latest',
    }));
    assertEqual(blocked.code, 'MODEL_BINDING_APPLICATION_NONRETRYABLE_TERMINAL');
    assertEqual(count(db, 'model_binding_operations'), 1);
    await application.rollbackManualBinding({ role: 'CHAT' });
    const changedDigest = await application.beginManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target:latest',
    });
    assertEqual(changedDigest.phase, 'BINDING_OPERATION');
    assert(changedDigest.operationId !== failed.operationId);
    const changedDigestResult = await changedDigest.completion;
    await application.awaitBackgroundWork();
    assertEqual(changedDigestResult.operationId, changedDigest.operationId);
    assertEqual(changedDigestResult.outcome, 'APPLIED');
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
    assertEqual(count(db, 'model_binding_operations'), 3);
  });

  await withFixture(async ({ db, repository, manager, application }) => {
    repository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'fixture-base',
      digestSha256: DIGEST_A,
      source: 'CONFIG_DEFAULT',
      actor: 'system:binding-application',
    });
    const recorded = repository.recordUserBindingApply({
      requestKey: 'fixture-same-digest-failed-0001',
      role: 'CHAT',
      expectedBindingRevision: 1,
      targetModelName: 'fixture-target',
      targetDigestSha256: DIGEST_B,
      actor: 'user:fixture-operator',
    });
    repository.recordManualRuntimeApplyFailed({
      operationId: recorded.operation.operationId,
      expectedAttemptRevision: 0,
      failureCode: 'MODEL_BINDING_TARGET_DIGEST_MISSING',
    });

    const blocked = await captureError(application.beginManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(blocked.code, 'MODEL_BINDING_APPLICATION_NONRETRYABLE_TERMINAL');
    assertEqual(count(db, 'model_binding_operations'), 1);
    await application.rollbackManualBinding({ role: 'CHAT' });
    const sameDigest = await application.beginManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    assertEqual(sameDigest.phase, 'BINDING_OPERATION');
    assert(sameDigest.operationId !== recorded.operation.operationId);
    const result = await sameDigest.completion;
    await application.awaitBackgroundWork();
    assertEqual(result.operationId, sameDigest.operationId);
    assertEqual(result.outcome, 'APPLIED');
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
    assertEqual(count(db, 'model_binding_operations'), 3);
  });
});

await testAsync('non-retryable terminal blocks every replacement before provider effects', async () => {
  for (const scenario of ['missing', 'ambiguous']) {
    await withFixture(async ({ db, repository, manager, provider, events, application }) => {
      repository.observeDesiredBinding({
        role: 'CHAT',
        modelName: 'fixture-base',
        digestSha256: DIGEST_A,
        source: 'CONFIG_DEFAULT',
        actor: 'system:binding-application',
      });
      const recorded = repository.recordUserBindingApply({
        requestKey: `fixture-invalid-supersede-${scenario}-0001`,
        role: 'CHAT',
        expectedBindingRevision: 1,
        targetModelName: 'fixture-target',
        targetDigestSha256: DIGEST_B,
        actor: 'user:fixture-operator',
      });
      repository.recordManualRuntimeApplyFailed({
        operationId: recorded.operation.operationId,
        expectedAttemptRevision: 0,
        failureCode: 'MODEL_BINDING_TARGET_DIGEST_MISSING',
      });
      provider.models.delete('fixture-other');
      if (scenario === 'ambiguous') {
        provider.models.set('fixture-other', model('fixture-other', DIGEST_B));
        provider.models.set('fixture-other:latest', model('fixture-other:latest', DIGEST_C));
      }
      const before = {
        desired: JSON.stringify(repository.getDesired('CHAT')),
        runtime: JSON.stringify(manager.createBindingRuntimePort().snapshot('CHAT')),
        operations: count(db, 'model_binding_operations'),
        changedEvents: events.filter(event => event.action === 'model_changed').length,
        resolves: provider.calls.resolve,
        pulls: provider.calls.pull,
      };
      const error = await captureError(application.beginManualBinding({
        role: 'CHAT',
        targetModel: 'fixture-other',
      }));
      assertEqual(error.code, 'MODEL_BINDING_APPLICATION_NONRETRYABLE_TERMINAL');
      assertEqual(JSON.stringify(repository.getDesired('CHAT')), before.desired);
      assertEqual(JSON.stringify(manager.createBindingRuntimePort().snapshot('CHAT')), before.runtime);
      assertEqual(count(db, 'model_binding_operations'), before.operations);
      assertEqual(
        events.filter(event => event.action === 'model_changed').length,
        before.changedEvents,
      );
      assertEqual(provider.calls.resolve, before.resolves);
      assertEqual(provider.calls.pull, before.pulls);
    });
  }
});

await testAsync('repository failure compensates runtime and releases the token for retry', async () => {
  let failOnce = true;
  await withFixture(async ({ repository, manager, application }) => {
    const first = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(first.code, 'MODEL_BINDING_RUNTIME_COMMIT_FAILED');
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').configVersion, 0);

    const second = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();
    assertEqual(second.outcome, 'APPLIED');
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
    assertEqual(repository.getBindingApplicationState(second.operationId).state, 'VERIFIED');
  }, {
    repositoryFactory(repository) {
      const original = repository.recordManualRuntimeApplied.bind(repository);
      return repositoryProxy(repository, {
        recordManualRuntimeApplied(input) {
          if (failOnce) {
            failOnce = false;
            throw new Error('fixture terminal repository failure');
          }
          return original(input);
        },
      });
    },
  });
});

await testAsync('temporary runtime guard rejection is retryable after the guard clears', async () => {
  await withFixture(async ({ db, repository, manager, application }) => {
    let blocked = true;
    manager._getRuntimeGuardDecision = modelName => ({
      allowed: !(blocked && canonicalModelName(modelName) === 'fixture-target'),
      reason: blocked ? 'fixture temporary guard' : null,
    });

    const first = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(first.code, 'MODEL_BINDING_RUNTIME_GUARD_REJECTED');
    const operation = latestOperation(repository);
    assertEqual(repository.getBindingApplicationState(operation.operationId).retryable, true);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');

    blocked = false;
    const retry = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();
    assertEqual(retry.outcome, 'APPLIED');
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
    assertEqual(count(db, 'model_binding_operations'), 1);
    assertEqual(count(db, 'upgrade_history'), 1);
  });
});

await testAsync('guard-rejected rollback retries the same durable reversal after clear', async () => {
  await withFixture(async ({ db, repository, manager, application }) => {
    await application.applyManualBinding({ role: 'CHAT', targetModel: 'fixture-target' });
    await application.awaitBackgroundWork();
    let blocked = true;
    manager._getRuntimeGuardDecision = modelName => ({
      allowed: !(blocked && canonicalModelName(modelName) === 'fixture-base'),
      reason: blocked ? 'fixture temporary rollback guard' : null,
    });

    const first = await captureError(application.rollbackManualBinding({ role: 'CHAT' }));
    assertEqual(first.code, 'MODEL_BINDING_RUNTIME_GUARD_REJECTED');
    const reversal = latestOperation(repository);
    assertEqual(reversal.kind, 'USER_ROLLBACK');
    assertEqual(repository.getBindingApplicationState(reversal.operationId).retryable, true);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');

    blocked = false;
    const retry = await application.rollbackManualBinding({ role: 'CHAT' });
    await application.awaitBackgroundWork();
    assertEqual(retry.operationId, reversal.operationId);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
    assertEqual(count(db, 'model_binding_operations'), 2);
    assertEqual(count(db, 'upgrade_history'), 2);
  });
});

await testAsync('explicit rebind recovers a missing legacy artifact with audited pull lineage', async () => {
  await withFixture(async ({ db, repository, manager, provider, application }) => {
    config.models.CHAT = 'missing-legacy';
    db.prepare(`
      INSERT INTO model_overrides (
        role, model, previous_model, applied_by, verified,
        binding_operation_id, model_canonical_name, model_digest_sha256,
        verification_status
      ) VALUES ('CHAT', 'missing-legacy', 'fixture-base', 'user', 0,
        NULL, NULL, NULL, 'LEGACY_UNVERIFIED')
    `).run();
    provider.pullTargets.set('missing-legacy', model('missing-legacy', DIGEST_A));

    const result = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();

    const operation = repository.getBindingOperation(result.operationId);
    assertEqual(operation.previousModelName, 'missing-legacy');
    assertEqual(operation.previousDigestSha256, DIGEST_A);
    assertEqual(operation.targetModelName, 'fixture-target');
    assertEqual(count(db, 'model_binding_provider_operations'), 1);
    assertEqual(
      db.prepare(`SELECT outcome FROM model_binding_provider_attempts`).get().outcome,
      'SUCCEEDED',
    );
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
  });
});

await testAsync('legacy baseline recovery cannot acknowledge the user target command', async () => {
  await withFixture(async ({ db, provider, application }) => {
    config.models.CHAT = 'missing-legacy';
    db.prepare(`
      INSERT INTO model_overrides (
        role, model, previous_model, applied_by, verified,
        binding_operation_id, model_canonical_name, model_digest_sha256,
        verification_status
      ) VALUES ('CHAT', 'missing-legacy', 'fixture-base', 'user', 0,
        NULL, NULL, NULL, 'LEGACY_UNVERIFIED')
    `).run();
    provider.pullTargets.set('missing-legacy', model('missing-legacy', DIGEST_A));
    provider.pullGate = deferred();
    let accepted = false;
    const startedPromise = application.beginManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }).then(value => {
      accepted = true;
      return value;
    });

    await waitUntil(
      () => count(db, 'model_binding_provider_operations') === 1,
      'Legacy recovery intent was not committed',
    );
    const prerequisite = db.prepare(`
      SELECT request_purpose AS purpose FROM model_binding_provider_operations
    `).get();
    assertEqual(prerequisite.purpose, 'LEGACY_BASELINE_RECOVERY');
    await Promise.resolve();
    assertEqual(accepted, false, 'Prerequisite intent must not accept the target command');

    provider.pullGate.resolve();
    const started = await startedPromise;
    assertEqual(started.phase, 'BINDING_OPERATION');
    assert(started.operationId);
    const completed = await started.completion;
    await application.awaitBackgroundWork();
    assertEqual(completed.outcome, 'APPLIED');
    assertEqual(count(db, 'model_binding_operations'), 1);
  });
});

await testAsync('same applied operation replay has no provider, runtime or broadcast effect', async () => {
  await withFixture(async ({ db, manager, provider, events, application }) => {
    const first = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();
    const before = {
      resolve: provider.calls.resolve,
      ensure: provider.calls.ensure,
      verify: provider.calls.verify,
      events: events.length,
      history: count(db, 'upgrade_history'),
      version: manager.createBindingRuntimePort().snapshot('CHAT').configVersion,
    };
    const replay = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'FIXTURE-TARGET:latest',
    });
    await application.awaitBackgroundWork();
    assertEqual(replay.operationId, first.operationId);
    assertEqual(replay.outcome, 'REPLAYED');
    assertEqual(provider.calls.resolve, before.resolve);
    assertEqual(provider.calls.ensure, before.ensure);
    assertEqual(provider.calls.verify, before.verify);
    assertEqual(events.length, before.events);
    assertEqual(count(db, 'upgrade_history'), before.history);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').configVersion, before.version);
  });
});

await testAsync('different target cannot overtake a retryable unapplied manual operation', async () => {
  await withFixture(async ({ db, manager, provider, application }) => {
    manager._getRuntimeGuardDecision = modelName => ({
      allowed: canonicalModelName(modelName) !== 'fixture-target',
      reason: 'fixture retryable guard',
    });
    const first = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(first.code, 'MODEL_BINDING_RUNTIME_GUARD_REJECTED');
    const resolvesBefore = provider.calls.resolve;
    const error = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-other',
    }));
    assertEqual(error.code, 'MODEL_BINDING_APPLICATION_PENDING_OPERATION');
    assertEqual(provider.calls.resolve, resolvesBefore);
    assertEqual(count(db, 'model_binding_operations'), 1);
  });
});

await testAsync('rollback is append-only and restores the exact previous artifact', async () => {
  await withFixture(async ({ db, repository, manager, application }) => {
    const applied = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();
    const rolledBack = await application.rollbackManualBinding({ role: 'CHAT' });
    await application.awaitBackgroundWork();
    assertEqual(rolledBack.from, 'fixture-target');
    assertEqual(rolledBack.to, 'fixture-base');
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').configVersion, 2);
    assertEqual(count(db, 'model_binding_operations'), 2);
    assertEqual(count(db, 'upgrade_history'), 2);
    assert(repository.getBindingOperation(applied.operationId));
    const reversal = repository.getBindingOperation(rolledBack.operationId);
    assertEqual(reversal.rollbackOfOperationId, applied.operationId);
    assertEqual(reversal.kind, 'USER_ROLLBACK');
  });
});

await testAsync('runtime no-op rollback advances binding notification revision without DB history', async () => {
  await withFixture(async ({ db, manager, provider, events, application }) => {
    provider.afterEnsure = resolved => {
      if (resolved.name === 'fixture-target') {
        provider.models.set('fixture-target', model('fixture-target', DIGEST_C));
      }
    };
    await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    provider.models.set('fixture-target', model('fixture-target', DIGEST_B));
    const rollback = await application.rollbackManualBinding({ role: 'CHAT' });
    await application.awaitBackgroundWork();
    assertEqual(rollback.to, 'fixture-base');
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').configVersion, 1);
    assertEqual(count(db, 'upgrade_history'), 0);
    const changed = events.filter(event => event.action === 'model_changed');
    assertEqual(changed.length, 1);
    assertEqual(changed[0].fromModel, 'fixture-base');
    assertEqual(changed[0].toModel, 'fixture-base');
    assertEqual(changed[0].configVersion, 1);
  });
});

await testAsync('rollback preserves no-override 404 and isolates legacy rebind 409', async () => {
  await withFixture(async ({ db, application }) => {
    const missing = await captureError(application.rollbackManualBinding({ role: 'CHAT' }));
    assertEqual(missing.code, 'MODEL_BINDING_OVERRIDE_NOT_FOUND');
    assertEqual(missing.httpStatus, 404);
    assert(/No override found/.test(missing.message));

    db.prepare(`
      INSERT INTO model_overrides (
        role, model, previous_model, applied_by, verified,
        binding_operation_id, model_canonical_name, model_digest_sha256,
        verification_status
      ) VALUES ('CHAT', 'fixture-target', 'fixture-base', 'user', 0,
        NULL, NULL, NULL, 'LEGACY_UNVERIFIED')
    `).run();
    const legacy = await captureError(application.rollbackManualBinding({ role: 'CHAT' }));
    assertEqual(legacy.code, 'MODEL_BINDING_LEGACY_ROLLBACK_REQUIRES_REBIND');
    assertEqual(legacy.httpStatus, 409);
  });
});

await testAsync('verification failure stays active and never claims verified', async () => {
  await withFixture(async ({ db, repository, manager, provider, events, application }) => {
    provider.verifyError = new ModelBindingApplicationError(
      'MODEL_BINDING_VERIFICATION_REJECTED',
      'fixture probe rejected',
    );
    const result = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();
    const state = repository.getBindingApplicationState(result.operationId);
    const override = db.prepare(`
      SELECT verified, verification_status AS status
      FROM model_overrides WHERE role = 'CHAT'
    `).get();
    assertEqual(state.state, 'FAILED');
    assertEqual(state.failurePhase, 'VERIFICATION');
    assertEqual(override.verified, 0);
    assertEqual(override.status, 'FAILED');
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
    assertEqual(events.filter(event => event.action === 'upgrade_verify_failed').length, 1);
  });
});

await testAsync('explicit same-target apply retries failed verification without runtime replay', async () => {
  await withFixture(async ({ db, repository, manager, provider, events, application }) => {
    provider.verifyError = new ModelBindingApplicationError(
      'MODEL_BINDING_VERIFICATION_REJECTED',
      'fixture transient rejection',
    );
    const first = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();
    const before = {
      version: manager.createBindingRuntimePort().snapshot('CHAT').configVersion,
      history: count(db, 'upgrade_history'),
      changed: events.filter(event => event.action === 'model_changed').length,
      verify: provider.calls.verify,
    };

    provider.verifyError = null;
    const retry = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target:latest',
    });
    assertEqual(retry.outcome, 'VERIFICATION_RETRY_SCHEDULED');
    await application.awaitBackgroundWork();
    assertEqual(repository.getBindingApplicationState(first.operationId).state, 'VERIFIED');
    assertEqual(provider.calls.verify, before.verify + 1);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').configVersion, before.version);
    assertEqual(count(db, 'upgrade_history'), before.history);
    assertEqual(
      events.filter(event => event.action === 'model_changed').length,
      before.changed,
    );
  });
});

await testAsync('verification audit failure never rewrites a successful provider probe as failed', async () => {
  await withFixture(async ({ repository, provider, application }) => {
    const result = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();
    const state = repository.getBindingApplicationState(result.operationId);
    assertEqual(provider.calls.verify, 1);
    assertEqual(state.state, 'APPLIED_PENDING_VERIFICATION');
    assertEqual(state.verificationStatus, 'NOT_VERIFIED');
    assertEqual(
      state.attempts.filter(attempt => (
        attempt.kind === 'VERIFICATION' && attempt.outcome === 'FAILED'
      )).length,
      0,
    );
  }, {
    repositoryFactory(repository) {
      return repositoryProxy(repository, {
        recordManualVerificationSucceeded() {
          throw new Error('fixture verification audit unavailable');
        },
      });
    },
  });
});

await testAsync('notification failure is degraded and replay does not retry delivery', async () => {
  await withFixture(async ({ repository, manager, provider, events, application }) => {
    const result = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();
    assertEqual(result.outcome, 'APPLIED_NOTIFICATION_DEGRADED');
    assertEqual(
      repository.getBindingApplicationState(result.operationId).notificationStatus,
      'FAILED',
    );
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
    const before = { events: events.length, verify: provider.calls.verify };
    const replay = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    assertEqual(replay.outcome, 'REPLAYED');
    assertEqual(events.length, before.events);
    assertEqual(provider.calls.verify, before.verify);
  }, {
    publishError: payload => payload.action === 'model_changed',
  });
});

await testAsync('production broadcaster without transport is receipt-not-issued degraded', async () => {
  wsServerTestInternals.resetBridgeState();
  await withFixture(async ({ repository, application }) => {
    const result = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await application.awaitBackgroundWork();
    const state = repository.getBindingApplicationState(result.operationId);
    assertEqual(result.outcome, 'APPLIED_NOTIFICATION_DEGRADED');
    assertEqual(state.notificationStatus, 'FAILED');
    assertEqual(
      state.notificationFailureCode,
      'MODEL_BINDING_NOTIFICATION_RECEIPT_NOT_ISSUED',
    );
  }, {
    publishReceipt: payload => productionBroadcast('control', payload),
  });
});

suite('M1 model binding application — restart and entrypoint parity');

await testAsync('second restart recovers both pre-receipt runtime generations without provider replay', async () => {
  const directory = mkdtempSync(path.join(
    process.env.INTENTSMITH_TEST_ARTIFACT_DIR,
    'binding-finalize-double-restart-',
  ));
  const databasePath = path.join(directory, 'binding.sqlite');
  const provider = new FakeExactProvider();
  const firstScheduled = [];
  const secondScheduled = [];
  let firstDb;
  let secondDb;
  let thirdDb;
  try {
    config.models.CHAT = 'fixture-base';
    firstDb = new Database(databasePath);
    firstDb.pragma('foreign_keys = ON');
    await runMigrations(firstDb);
    const firstRepository = createModelFailoverRepository(firstDb);
    const firstManager = new UpgradeManager();
    firstManager.setDb(firstDb);
    const firstApplication = createModelBindingApplication({
      repository: repositoryProxy(firstRepository, {
        recordManualRuntimeFinalized() {
          throw new Error('fixture first receipt crash');
        },
      }),
      runtime: firstManager.createBindingRuntimePort(),
      provider,
      publishControl: () => ({ accepted: true }),
      scheduleRecovery(callback, delayMs) {
        const item = { callback, delayMs };
        firstScheduled.push(item);
        return item;
      },
      cancelRecovery() {},
      verificationAttempts: 1,
      logger: { warn() {}, info() {}, debug() {}, error() {} },
    });
    const firstError = await captureError(firstApplication.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(firstError.details.phase, 'RUNTIME_FINALIZE_RECEIPT');
    const operation = latestOperation(firstRepository);
    assertEqual(firstScheduled.length, 1);
    assertEqual(
      firstRepository.getBindingApplicationState(operation.operationId).attemptRevision,
      1,
    );
    firstDb.close();
    firstDb = null;

    config.models.CHAT = 'fixture-base';
    secondDb = new Database(databasePath);
    secondDb.pragma('foreign_keys = ON');
    const secondRepository = createModelFailoverRepository(secondDb);
    const secondManager = new UpgradeManager();
    secondManager.setDb(secondDb);
    const secondApplication = createModelBindingApplication({
      repository: repositoryProxy(secondRepository, {
        recordManualRuntimeFinalized() {
          throw new Error('fixture second receipt crash');
        },
      }),
      runtime: secondManager.createBindingRuntimePort(),
      provider,
      publishControl: () => ({ accepted: true }),
      scheduleRecovery(callback, delayMs) {
        const item = { callback, delayMs };
        secondScheduled.push(item);
        return item;
      },
      cancelRecovery() {},
      verificationAttempts: 1,
      logger: { warn() {}, info() {}, debug() {}, error() {} },
    });
    const secondPass = await secondApplication.rehydrateBindings();
    assertEqual(secondPass.restored, 0);
    assertEqual(secondPass.failed.length, 1);
    assertEqual(secondPass.failed[0].code, 'MODEL_BINDING_RUNTIME_COMMIT_FAILED');
    assertEqual(secondScheduled.length, 1);
    assertEqual(
      secondRepository.getBindingApplicationState(operation.operationId).attemptRevision,
      2,
    );
    secondDb.close();
    secondDb = null;

    config.models.CHAT = 'fixture-base';
    thirdDb = new Database(databasePath);
    thirdDb.pragma('foreign_keys = ON');
    const thirdRepository = createModelFailoverRepository(thirdDb);
    const thirdManager = new UpgradeManager();
    thirdManager.setDb(thirdDb);
    const events = [];
    const thirdApplication = createModelBindingApplication({
      repository: thirdRepository,
      runtime: thirdManager.createBindingRuntimePort(),
      provider,
      publishControl: payload => {
        events.push(payload);
        return { accepted: true };
      },
      verificationAttempts: 1,
      delay: async () => {},
      logger: { warn() {}, info() {}, debug() {}, error() {} },
    });
    const thirdPass = await thirdApplication.rehydrateBindings();
    assertEqual(thirdPass.failed.length, 0);
    assertEqual(thirdPass.restored, 1);
    const recovered = thirdRepository.getBindingApplicationState(operation.operationId);
    assertEqual(recovered.attemptRevision, 3);
    assertEqual(recovered.runtimeFinalizeStatus, 'DIRECT_CONFIRMED');
    assertEqual(
      JSON.stringify(thirdDb.prepare(`
        SELECT runtime_attempt_revision, finalization_kind,
               recovered_by_attempt_revision
        FROM model_binding_runtime_finalize_receipts
        WHERE operation_id = ?
        ORDER BY runtime_attempt_revision
      `).all(operation.operationId)),
      JSON.stringify([
        {
          runtime_attempt_revision: 1,
          finalization_kind: 'RECOVERED_BY',
          recovered_by_attempt_revision: 3,
        },
        {
          runtime_attempt_revision: 2,
          finalization_kind: 'RECOVERED_BY',
          recovered_by_attempt_revision: 3,
        },
        {
          runtime_attempt_revision: 3,
          finalization_kind: 'DIRECT_CONFIRMED',
          recovered_by_attempt_revision: null,
        },
      ]),
    );
    assertEqual(count(thirdDb, 'upgrade_history'), 1);
    assertEqual(
      JSON.stringify(thirdDb.prepare(`
        SELECT role, from_model, to_model, action
        FROM upgrade_history
      `).get()),
      JSON.stringify({
        role: 'CHAT',
        from_model: 'fixture-base',
        to_model: 'fixture-target',
        action: 'apply',
      }),
    );
    assertEqual(provider.calls.pull, 0);
    assertEqual(events.filter(event => event.action === 'model_changed').length, 0);
    thirdApplication.startBackgroundVerification();
    await thirdApplication.awaitBackgroundWork();
    assertEqual(events.filter(event => event.action === 'model_changed').length, 1);
  } finally {
    if (firstDb?.open) firstDb.close();
    if (secondDb?.open) secondDb.close();
    if (thirdDb?.open) thirdDb.close();
    restoreBindings();
    rmSync(directory, { recursive: true, force: false });
  }
});

await testAsync('real restart waits for a live provider lease then performs one fenced recovery', async () => {
  const directory = mkdtempSync(path.join(
    process.env.INTENTSMITH_TEST_ARTIFACT_DIR,
    'binding-live-lease-restart-',
  ));
  const databasePath = path.join(directory, 'binding.sqlite');
  let nowMs = 1_000;
  const scheduled = [];
  let firstDb;
  let secondDb;
  try {
    firstDb = new Database(databasePath);
    firstDb.pragma('journal_mode = WAL');
    firstDb.pragma('foreign_keys = ON');
    await runMigrations(firstDb);
    const firstRepository = createModelFailoverRepository(firstDb, { clock: () => nowMs });
    firstRepository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'fixture-base',
      digestSha256: DIGEST_A,
      source: 'CONFIG_DEFAULT',
      actor: 'system:binding-application',
    });
    const accepted = firstRepository.recordManualProviderPullIntent({
      requestKey: 'fixture-provider-real-restart-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: 'http://127.0.0.1:11434',
      targetModelName: 'fixture-target',
      actor: 'user:fixture-operator',
    });
    firstDb.close();
    firstDb = null;

    config.models.CHAT = 'fixture-base';
    secondDb = new Database(databasePath);
    secondDb.pragma('journal_mode = WAL');
    secondDb.pragma('foreign_keys = ON');
    const secondRepository = createModelFailoverRepository(secondDb, { clock: () => nowMs });
    const manager = new UpgradeManager();
    manager.setDb(secondDb);
    const provider = new FakeExactProvider();
    provider.calls.inventory = 0;
    const application = createModelBindingApplication({
      repository: secondRepository,
      runtime: manager.createBindingRuntimePort(),
      provider,
      publishControl: () => ({ accepted: true }),
      clock: () => nowMs,
      scheduleRecovery(callback, delayMs) {
        const item = { callback, delayMs };
        scheduled.push(item);
        return item;
      },
      verificationAttempts: 1,
      logger: { warn() {}, info() {}, debug() {}, error() {} },
    });

    const blocked = await application.rehydrateBindings();
    assertEqual(blocked.failed[0].code, 'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS');
    assertEqual(provider.calls.inventory, 0);
    assertEqual(scheduled.length, 1);

    nowMs += 300_001;
    scheduled[0].callback();
    await application.awaitBackgroundWork();
    assertEqual(provider.calls.inventory, 1);
    assertEqual(
      secondRepository.getProviderOperation(accepted.operation.operationId).terminal.outcome,
      'RECONCILED_PRESENT',
    );
    assertEqual(count(secondDb, 'model_binding_operations'), 1);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
  } finally {
    if (secondDb?.open) secondDb.close();
    if (firstDb?.open) firstDb.close();
    restoreBindings();
    rmSync(directory, { recursive: true, force: false });
  }
});

await testAsync('provider terminal resumes the accepted binding after a real DB close and reopen', async () => {
  const directory = mkdtempSync(path.join(
    process.env.INTENTSMITH_TEST_ARTIFACT_DIR,
    'binding-provider-resume-restart-',
  ));
  const databasePath = path.join(directory, 'binding.sqlite');
  const provider = new FakeExactProvider();
  let firstDb;
  let secondDb;
  try {
    config.models.CHAT = 'fixture-base';
    firstDb = new Database(databasePath);
    await runMigrations(firstDb);
    const firstRepository = createModelFailoverRepository(firstDb);
    firstRepository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'fixture-base',
      digestSha256: DIGEST_A,
      source: 'CONFIG_DEFAULT',
      actor: 'system:binding-application',
    });
    const intent = firstRepository.recordManualProviderPullIntent({
      requestKey: 'fixture-provider-real-restart-0001',
      role: 'CHAT',
      requestPurpose: 'USER_APPLY_TARGET',
      expectedBindingRevision: 1,
      providerOrigin: provider.getOrigin(),
      targetModelName: 'fixture-target',
      actor: 'user:fixture-operator',
    });
    firstRepository.recordManualProviderPullSucceeded({
      operationId: intent.operation.operationId,
      ...providerClaim(intent.operation),
      observedModelName: 'fixture-target',
      observedDigestSha256: DIGEST_B,
    });
    firstDb.close();
    firstDb = null;

    config.models.CHAT = 'fixture-base';
    secondDb = new Database(databasePath);
    const secondRepository = createModelFailoverRepository(secondDb);
    const secondManager = new UpgradeManager();
    secondManager.setDb(secondDb);
    const secondApplication = createModelBindingApplication({
      repository: secondRepository,
      runtime: secondManager.createBindingRuntimePort(),
      provider,
      publishControl: () => ({ accepted: true }),
      verificationAttempts: 1,
      delay: async () => {},
    });
    const restored = await secondApplication.rehydrateBindings();
    assertEqual(restored.failed.length, 0);
    assertEqual(restored.restored, 1);
    assertEqual(count(secondDb, 'model_binding_operations'), 1);
    assertEqual(latestOperation(secondRepository).requestKey, intent.operation.requestKey);
    assertEqual(secondManager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
  } finally {
    if (firstDb?.open) firstDb.close();
    if (secondDb?.open) secondDb.close();
    restoreBindings();
    rmSync(directory, { recursive: true, force: false });
  }
});

await testAsync('restart preserves post-commit truth and repairs a pending proposal', async () => {
  const directory = mkdtempSync(path.join(
    process.env.INTENTSMITH_TEST_ARTIFACT_DIR,
    'binding-application-post-commit-repair-',
  ));
  const databasePath = path.join(directory, 'binding.sqlite');
  const provider = new FakeExactProvider();
  let firstDb;
  let secondDb;
  try {
    config.models.CHAT = 'fixture-base';
    firstDb = new Database(databasePath);
    await runMigrations(firstDb);
    const firstRepository = createModelFailoverRepository(firstDb);
    const firstManager = new UpgradeManager();
    firstManager.setDb(firstDb);
    const firstRuntime = firstManager.createBindingRuntimePort();
    let failResolution = true;
    const firstApplication = createModelBindingApplication({
      repository: firstRepository,
      runtime: Object.freeze({
        ...firstRuntime,
        resolvePendingProposals(role, modelName, operationKind) {
          if (failResolution) {
            failResolution = false;
            throw new Error('fixture crash before proposal resolution');
          }
          return firstRuntime.resolvePendingProposals(role, modelName, operationKind);
        },
      }),
      provider,
      publishControl: () => ({ accepted: true }),
      verificationAttempts: 1,
      delay: async () => {},
    });
    firstDb.prepare(`
      INSERT INTO upgrade_proposals (
        role, current_model, candidate_model, score, status, detected_at
      ) VALUES ('CHAT', 'fixture-base', 'fixture-target', 90, 'pending', ?)
    `).run('2026-08-09 06:00:00');
    const applied = await firstApplication.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    assertEqual(applied.outcome, 'APPLIED_PROPOSAL_REPAIR_PENDING');
    const operation = latestOperation(firstRepository);
    const beforeRestart = firstRepository.getBindingApplicationState(operation.operationId);
    assertEqual(beforeRestart.runtimeStatus, 'APPLIED');
    assertEqual(beforeRestart.notificationStatus, 'SUCCEEDED');
    assertEqual(firstDb.prepare(`SELECT status FROM upgrade_proposals`).get().status, 'pending');
    firstDb.close();
    firstDb = null;

    config.models.CHAT = 'fixture-base';
    secondDb = new Database(databasePath);
    const secondRepository = createModelFailoverRepository(secondDb);
    const secondManager = new UpgradeManager();
    secondManager.setDb(secondDb);
    const notifications = [];
    const secondApplication = createModelBindingApplication({
      repository: secondRepository,
      runtime: secondManager.createBindingRuntimePort(),
      provider,
      publishControl: payload => {
        notifications.push(payload);
        return { accepted: true };
      },
      verificationAttempts: 1,
      delay: async () => {},
    });
    const restored = await secondApplication.rehydrateBindings();
    assertEqual(restored.failed.length, 0);
    assertEqual(secondDb.prepare(`SELECT status FROM upgrade_proposals`).get().status, 'approved');
    assertEqual(
      secondRepository.getBindingApplicationState(operation.operationId).notificationStatus,
      'SUCCEEDED',
    );
    secondApplication.startBackgroundVerification();
    await secondApplication.awaitBackgroundWork();
    assertEqual(
      secondRepository.getBindingApplicationState(operation.operationId).notificationStatus,
      'SUCCEEDED',
    );
    assertEqual(notifications.filter(event => event.action === 'model_changed').length, 0);
    assertEqual(secondManager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
  } finally {
    if (firstDb?.open) firstDb.close();
    if (secondDb?.open) secondDb.close();
    restoreBindings();
    rmSync(directory, { recursive: true, force: false });
  }
});

await testAsync('manual binding survives a real DB close and exact startup rehydrate', async () => {
  const directory = mkdtempSync(path.join(
    process.env.INTENTSMITH_TEST_ARTIFACT_DIR,
    'binding-application-restart-',
  ));
  const databasePath = path.join(directory, 'binding.sqlite');
  const provider = new FakeExactProvider();
  let firstDb;
  let secondDb;
  try {
    config.models.CHAT = 'fixture-base';
    firstDb = new Database(databasePath);
    await runMigrations(firstDb);
    const firstRepository = createModelFailoverRepository(firstDb);
    const firstManager = new UpgradeManager();
    firstManager.setDb(firstDb);
    const firstApplication = createModelBindingApplication({
      repository: firstRepository,
      runtime: firstManager.createBindingRuntimePort(),
      provider,
      publishControl: () => ({ accepted: true }),
      verificationAttempts: 1,
      delay: async () => {},
    });
    firstApplication.startBackgroundVerification();
    const applied = await firstApplication.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await firstApplication.awaitBackgroundWork();
    firstDb.close();
    firstDb = null;

    config.models.CHAT = 'fixture-base';
    secondDb = new Database(databasePath);
    const secondRepository = createModelFailoverRepository(secondDb);
    const secondManager = new UpgradeManager();
    secondManager.setDb(secondDb);
    const secondApplication = createModelBindingApplication({
      repository: secondRepository,
      runtime: secondManager.createBindingRuntimePort(),
      provider,
      publishControl: () => ({ accepted: true }),
      verificationAttempts: 1,
      delay: async () => {},
    });
    const restored = await secondApplication.rehydrateBindings();
    secondApplication.startBackgroundVerification();
    await secondApplication.awaitBackgroundWork();
    assertEqual(restored.restored, 1);
    assertEqual(restored.failed.length, 0);
    assertEqual(secondManager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
    assertEqual(secondManager.createBindingRuntimePort().snapshot('CHAT').configVersion, 0);
    const attempts = secondRepository.getBindingApplicationState(applied.operationId).attempts;
    assertEqual(attempts.filter(attempt => attempt.kind === 'STARTUP_REHYDRATE').length, 1);
    assertEqual(attempts.at(-1).kind, 'VERIFICATION');
  } finally {
    if (firstDb?.open) firstDb.close();
    if (secondDb?.open) secondDb.close();
    restoreBindings();
    rmSync(directory, { recursive: true, force: false });
  }
});

await testAsync('restart restores prior manual override before failed newer intent', async () => {
  const directory = mkdtempSync(path.join(
    process.env.INTENTSMITH_TEST_ARTIFACT_DIR,
    'binding-application-prior-restart-',
  ));
  const databasePath = path.join(directory, 'binding.sqlite');
  const provider = new FakeExactProvider();
  let firstDb;
  let secondDb;
  try {
    config.models.CHAT = 'fixture-base';
    firstDb = new Database(databasePath);
    await runMigrations(firstDb);
    const firstRepository = createModelFailoverRepository(firstDb);
    const firstManager = new UpgradeManager();
    firstManager.setDb(firstDb);
    const firstApplication = createModelBindingApplication({
      repository: firstRepository,
      runtime: firstManager.createBindingRuntimePort(),
      provider,
      publishControl: () => ({ accepted: true }),
      verificationAttempts: 1,
      delay: async () => {},
    });
    firstApplication.startBackgroundVerification();
    const prior = await firstApplication.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    await firstApplication.awaitBackgroundWork();

    provider.afterEnsure = resolved => {
      if (resolved.name === 'fixture-other') {
        provider.models.set('fixture-other', model('fixture-other', DIGEST_B));
      }
    };
    const newerError = await captureError(firstApplication.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-other',
    }));
    assertEqual(newerError.code, 'MODEL_BINDING_TARGET_DIGEST_DRIFT');
    const newer = latestOperation(firstRepository);
    assert(newer.operationId !== prior.operationId);
    firstDb.close();
    firstDb = null;

    provider.afterEnsure = null;
    config.models.CHAT = 'fixture-base';
    secondDb = new Database(databasePath);
    const secondRepository = createModelFailoverRepository(secondDb);
    const secondManager = new UpgradeManager();
    secondManager.setDb(secondDb);
    const secondApplication = createModelBindingApplication({
      repository: secondRepository,
      runtime: secondManager.createBindingRuntimePort(),
      provider,
      publishControl: () => ({ accepted: true }),
      verificationAttempts: 1,
      delay: async () => {},
    });
    const restored = await secondApplication.rehydrateBindings();
    const override = secondDb.prepare(`
      SELECT model, binding_operation_id AS operationId
      FROM model_overrides WHERE role = 'CHAT'
    `).get();
    assertEqual(restored.restored, 1);
    assertEqual(restored.failed.length, 1);
    assertEqual(
      restored.failed[0].code,
      'MODEL_BINDING_APPLICATION_NONRETRYABLE_TERMINAL',
    );
    assertEqual(secondManager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
    assertEqual(override.model, 'fixture-target');
    assertEqual(override.operationId, prior.operationId);
  } finally {
    if (firstDb?.open) firstDb.close();
    if (secondDb?.open) secondDb.close();
    restoreBindings();
    rmSync(directory, { recursive: true, force: false });
  }
});

await testAsync('prior exact override treats stale census identity as a hint under cutover leases', async () => {
  const authority = new ModelUseAuthority();
  await withFixture(async ({ db, repository, provider, application }) => {
    const prior = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });

    provider.afterEnsure = resolved => {
      if (resolved.name === 'fixture-other') {
        provider.models.set('fixture-other', model('fixture-other', DIGEST_B));
      }
    };
    const newerError = await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-other',
    }));
    assertEqual(newerError.code, 'MODEL_BINDING_TARGET_DIGEST_DRIFT');
    const newer = latestOperation(repository);
    assert(newer.operationId !== prior.operationId);

    provider.afterEnsure = null;
    config.models.CHAT = 'fixture-base';
    provider.models.set('fixture-target', model('fixture-target', DIGEST_C));
    let censusCorrected = false;
    let exactResolveUnderLease = false;
    provider.afterInventory = inventory => {
      if (censusCorrected
        || !inventory.some(candidate => (
          candidate.name === 'fixture-target' && candidate.digestSha256 === DIGEST_C
        ))) return;
      censusCorrected = true;
      provider.models.set('fixture-target', model('fixture-target', DIGEST_B));
    };
    provider.beforeResolve = (modelName, options) => {
      if (!censusCorrected
        || canonicalModelName(modelName) !== 'fixture-target'
        || options.expectedDigestSha256 !== DIGEST_B) return;
      exactResolveUnderLease = (
        authority.snapshot('fixture-base').activeUseCount === 1
        && authority.snapshot('fixture-target').activeUseCount === 1
      );
    };

    const restartManager = new UpgradeManager();
    restartManager.setDb(db);
    const restartApplication = createModelBindingApplication({
      repository,
      runtime: restartManager.createBindingRuntimePort(),
      provider,
      modelUseAuthority: authority,
      publishControl: () => ({ accepted: true }),
      verificationAttempts: 1,
      delay: async () => {},
    });
    const restored = await restartApplication.rehydrateBindings();

    assertEqual(restored.restored, 1);
    assertEqual(restored.failed.length, 1);
    assert(restored.failed.some(failure => (
      failure.code === 'MODEL_BINDING_APPLICATION_NONRETRYABLE_TERMINAL'
    )), `Missing newer terminal failure: ${JSON.stringify(restored.failed)}`);
    assertEqual(censusCorrected, true, 'Expected stale prior-override census identity');
    assertEqual(exactResolveUnderLease, true, 'Expected exact resolve under both cutover leases');
    assertEqual(restartManager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
    assertMutationAvailable(authority, 'fixture-base');
    assertMutationAvailable(authority, 'fixture-target');
  }, {
    modelUseAuthority: authority,
    startVerification: false,
  });
});

await testAsync('terminal runtime failure performs no provider work on restart', async () => {
  await withFixture(async ({ db, repository, provider, application }) => {
    provider.afterEnsure = resolved => {
      if (resolved.name === 'fixture-target') {
        provider.models.set('fixture-target', model('fixture-target', DIGEST_C));
      }
    };
    await captureError(application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    provider.afterEnsure = null;
    provider.calls.inventory = 0;
    provider.calls.snapshotResolve = 0;
    const attemptsBefore = count(db, 'model_binding_application_attempts');

    const restartManager = new UpgradeManager();
    restartManager.setDb(db);
    const restartApplication = createModelBindingApplication({
      repository,
      runtime: restartManager.createBindingRuntimePort(),
      provider,
      publishControl: () => ({ accepted: true }),
      verificationAttempts: 1,
      delay: async () => {},
    });
    const summaryResult = await restartApplication.rehydrateBindings();
    assertEqual(summaryResult.failed.length, 1);
    assertEqual(
      summaryResult.failed[0].code,
      'MODEL_BINDING_APPLICATION_NONRETRYABLE_TERMINAL',
    );
    assertEqual(provider.calls.inventory, 0);
    assertEqual(provider.calls.snapshotResolve, 0);
    assertEqual(count(db, 'model_binding_application_attempts'), attemptsBefore);
    assertEqual(restartManager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
  });
});

await testAsync('startup shares one inventory and serializes verification after activation', async () => {
  await withFixture(async ({ db, repository, provider, application }) => {
    config.models.R1 = 'fixture-base';
    await application.applyManualBinding({ role: 'CHAT', targetModel: 'fixture-target' });
    await application.applyManualBinding({ role: 'R1', targetModel: 'fixture-other' });
    await application.awaitBackgroundWork();

    config.models.CHAT = 'fixture-base';
    config.models.R1 = 'fixture-base';
    provider.calls.inventory = 0;
    provider.calls.verify = 0;
    provider.maxConcurrentVerify = 0;
    const gate = deferred();
    provider.verifyGate = gate;

    const restartManager = new UpgradeManager();
    restartManager.setDb(db);
    const restartApplication = createModelBindingApplication({
      repository,
      runtime: restartManager.createBindingRuntimePort(),
      provider,
      publishControl: () => ({ accepted: true }),
      verificationAttempts: 1,
      delay: async () => {},
    });
    const restored = await restartApplication.rehydrateBindings();
    assertEqual(restored.restored, 2);
    assertEqual(provider.calls.inventory, 1);
    assertEqual(provider.calls.verify, 0);

    restartApplication.startBackgroundVerification();
    await waitUntil(
      () => provider.calls.verify === 1,
      'first serialized verification did not start',
    );
    assertEqual(provider.maxConcurrentVerify, 1);
    gate.resolve();
    await restartApplication.awaitBackgroundWork();
    assertEqual(provider.calls.verify, 2);
    assertEqual(provider.maxConcurrentVerify, 1);
  });
});

await testAsync('startup census hint is re-resolved under cutover leases before restore', async () => {
  const authority = new ModelUseAuthority();
  await withFixture(async ({ db, repository, provider, application }) => {
    const applied = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    config.models.CHAT = 'fixture-base';

    let censusCaptured = false;
    let exactResolveUnderLease = false;
    provider.afterInventory = inventory => {
      if (censusCaptured
        || !inventory.some(candidate => (
          candidate.name === 'fixture-target' && candidate.digestSha256 === DIGEST_B
        ))) return;
      censusCaptured = true;
      provider.models.set('fixture-target', model('fixture-target', DIGEST_C));
    };
    provider.beforeResolve = (modelName, options) => {
      if (!censusCaptured
        || canonicalModelName(modelName) !== 'fixture-target'
        || options.expectedDigestSha256 !== DIGEST_B) return;
      exactResolveUnderLease = (
        authority.snapshot('fixture-base').activeUseCount === 1
        && authority.snapshot('fixture-target').activeUseCount === 1
      );
    };

    const restartManager = new UpgradeManager();
    restartManager.setDb(db);
    const restartApplication = createModelBindingApplication({
      repository,
      runtime: restartManager.createBindingRuntimePort(),
      provider,
      modelUseAuthority: authority,
      publishControl: () => ({ accepted: true }),
      verificationAttempts: 1,
      delay: async () => {},
    });
    const restored = await restartApplication.rehydrateBindings();
    const state = repository.getBindingApplicationState(applied.operationId);

    assertEqual(restored.restored, 0);
    assertEqual(restored.failed.length, 1);
    assertEqual(restored.failed[0].code, 'MODEL_BINDING_TARGET_DIGEST_DRIFT');
    assertEqual(state.runtimeStatus, 'FAILED');
    assertEqual(state.failureCode, 'MODEL_BINDING_REHYDRATE_DIGEST_DRIFT');
    assertEqual(state.retryable, false);
    assertEqual(restartManager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
    assertEqual(censusCaptured, true);
    assertEqual(exactResolveUnderLease, true);
    assertMutationAvailable(authority, 'fixture-base');
    assertMutationAvailable(authority, 'fixture-target');
  }, {
    modelUseAuthority: authority,
    startVerification: false,
  });
});

await testAsync('startup ignores a stale failing census when exact identity recovers under lease', async () => {
  const authority = new ModelUseAuthority();
  await withFixture(async ({ db, repository, provider, application }) => {
    const applied = await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    config.models.CHAT = 'fixture-base';
    provider.models.set('fixture-target', model('fixture-target', DIGEST_C));

    let censusCorrected = false;
    let exactResolveUnderLease = false;
    provider.afterInventory = inventory => {
      if (censusCorrected
        || !inventory.some(candidate => (
          candidate.name === 'fixture-target' && candidate.digestSha256 === DIGEST_C
        ))) return;
      censusCorrected = true;
      provider.models.set('fixture-target', model('fixture-target', DIGEST_B));
    };
    provider.beforeResolve = (modelName, options) => {
      if (!censusCorrected
        || canonicalModelName(modelName) !== 'fixture-target'
        || options.expectedDigestSha256 !== DIGEST_B) return;
      exactResolveUnderLease = (
        authority.snapshot('fixture-base').activeUseCount === 1
        && authority.snapshot('fixture-target').activeUseCount === 1
      );
    };

    const restartManager = new UpgradeManager();
    restartManager.setDb(db);
    const restartApplication = createModelBindingApplication({
      repository,
      runtime: restartManager.createBindingRuntimePort(),
      provider,
      modelUseAuthority: authority,
      publishControl: () => ({ accepted: true }),
      verificationAttempts: 1,
      delay: async () => {},
    });
    const restored = await restartApplication.rehydrateBindings();
    const state = repository.getBindingApplicationState(applied.operationId);

    assertEqual(restored.restored, 1);
    assertEqual(restored.failed.length, 0);
    assertEqual(censusCorrected, true);
    assertEqual(exactResolveUnderLease, true);
    assertEqual(restartManager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
    assertEqual(state.runtimeStatus, 'APPLIED');
    assertEqual(
      state.attempts.filter(attempt => (
        attempt.kind === 'STARTUP_REHYDRATE' && attempt.outcome === 'FAILED'
      )).length,
      0,
    );
    assertMutationAvailable(authority, 'fixture-base');
    assertMutationAvailable(authority, 'fixture-target');
  }, {
    modelUseAuthority: authority,
    startVerification: false,
  });
});

await testAsync('legacy override rehydrates without invented operation, digest or verification', async () => {
  await withFixture(async ({ db, manager, application }) => {
    db.prepare(`
      INSERT INTO model_overrides (
        role, model, previous_model, applied_by, verified,
        binding_operation_id, model_canonical_name, model_digest_sha256,
        verification_status
      ) VALUES ('CHAT', 'fixture-target', 'fixture-base', 'user', 0,
        NULL, NULL, NULL, 'LEGACY_UNVERIFIED')
    `).run();
    const result = await application.rehydrateBindings();
    assertEqual(result.legacyRestored, 1);
    assertEqual(result.restored, 0);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
    assertEqual(count(db, 'model_binding_operations'), 0);
    const row = db.prepare(`
      SELECT verified, binding_operation_id AS operationId,
             model_digest_sha256 AS digest, verification_status AS status
      FROM model_overrides WHERE role = 'CHAT'
    `).get();
    assertEqual(row.verified, 0);
    assertEqual(row.operationId, null);
    assertEqual(row.digest, null);
    assertEqual(row.status, 'LEGACY_UNVERIFIED');
  });
});

await testAsync('HTTP and chat strip caller authority and use the same application port', async () => {
  await withFixture(async ({ db }) => {
    const calls = [];
    const applyStarted = deferred();
    const fakeApplication = {
      async beginManualBinding(input) {
        calls.push({ source: 'application-start', input });
        const completion = applyStarted.promise.then(() => ({
          ok: true,
          role: input.role,
          from: 'fixture-base',
          to: input.targetModel,
          verified: false,
          configVersion: 1,
        }));
        return { accepted: true, phase: 'BINDING_OPERATION', completion };
      },
      async applyManualBinding(input) {
        calls.push({ source: 'application-complete', input });
        return {
          ok: true,
          role: input.role,
          from: 'fixture-base',
          to: input.targetModel,
          verified: false,
          configVersion: 1,
        };
      },
      async rollbackManualBinding() {
        throw new Error('not used');
      },
    };
    const responses = [];
    const routes = createSystemRoutes({
      db: { db },
      modelRegistry: null,
      modelBindingApplication: fakeApplication,
      parseBody: async () => ({
        role: 'CHAT',
        targetModel: 'fixture-target',
        actor: 'system:forged',
        requestKey: 'forged',
        digestSha256: DIGEST_C,
        verified: true,
        skipVerify: true,
        force: true,
      }),
      sendJSON: (_res, status, body) => responses.push({ status, body }),
    });
    const routePromise = routes['POST /api/system/upgrades/apply']({}, {});
    await waitUntil(() => calls.length === 1, 'HTTP route did not reach the application port');
    await routePromise;
    assertEqual(responses.length, 1, 'HTTP success should follow the durable start receipt');
    assertEqual(JSON.stringify(calls[0].input), JSON.stringify({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    assertEqual(responses[0].status, 200);
    assertEqual(JSON.stringify(responses[0].body), JSON.stringify({
      ok: true,
      status: 'started',
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
    applyStarted.resolve();
    await Promise.resolve();
    setModelBindingApplication(fakeApplication);
    const sessionState = {
      _upgradeNotified: true,
      _pendingUpgrades: [{
        role: 'CHAT',
        currentModel: 'fixture-base',
        candidateModel: 'fixture-target',
        score: 99,
        actor: 'system:forged',
      }],
    };
    const chat = await preHandle('ano', {
      sessionState,
      sessionId: 'fixture-session',
      conversationId: 'fixture-conversation',
    }, 'conversation');
    assertEqual(chat.handled, true);
    assertEqual(JSON.stringify(calls[1].input), JSON.stringify({
      role: 'CHAT',
      targetModel: 'fixture-target',
    }));
  });
});

async function assertHttpModelRouteRejectsInvalidRoles(endpoint) {
  await withFixture(async ({ db }) => {
    const calls = [];
    const fakeApplication = {
      async beginManualBinding(input) {
        calls.push({ kind: 'apply', input });
        throw new Error('invalid role reached apply authority');
      },
      async rollbackManualBinding(input) {
        calls.push({ kind: 'rollback', input });
        throw new Error('invalid role reached rollback authority');
      },
    };
    const invalidRoles = [
      'constructor',
      '__proto__',
      'chat',
      'CHAT ',
      1,
      {},
      [],
      Object('CHAT'),
    ];

    for (const role of invalidRoles) {
      const responses = [];
      const routes = createSystemRoutes({
        db: { db },
        modelRegistry: null,
        modelBindingApplication: fakeApplication,
        parseBody: async () => ({ role, targetModel: 'fixture-target' }),
        sendJSON: (_res, status, body) => responses.push({ status, body }),
      });

      await routes[endpoint]({}, {});

      assertEqual(responses.length, 1);
      assertEqual(responses[0].status, 400);
      assertEqual(calls.length, 0, `${endpoint} leaked invalid role to application authority`);
    }
  });
}

await testAsync('HTTP apply rejects inherited or non-exact model roles before application authority', async () => {
  await assertHttpModelRouteRejectsInvalidRoles('POST /api/system/upgrades/apply');
});

await testAsync('HTTP rollback rejects inherited or non-exact model roles before application authority', async () => {
  await assertHttpModelRouteRejectsInvalidRoles('POST /api/system/upgrades/rollback');
});

await testAsync('HTTP and chat present same-target acceptance without a false change', async () => {
  await withFixture(async ({ db, events, application }) => {
    const responses = [];
    const routes = createSystemRoutes({
      db: { db },
      modelRegistry: null,
      modelBindingApplication: application,
      parseBody: async () => ({ role: 'CHAT', targetModel: 'fixture-base' }),
      sendJSON: (_res, status, body) => responses.push({ status, body }),
    });
    await routes['POST /api/system/upgrades/apply']({}, {});
    assertEqual(responses[0].status, 200);
    assertEqual(responses[0].body.status, 'started');
    await waitUntil(
      () => count(db, 'model_binding_user_noop_receipts') === 1,
      'HTTP same-target acceptance did not persist its no-op receipt',
    );

    setModelBindingApplication(application);
    const chat = await preHandle('ano', {
      sessionState: {
        _upgradeNotified: true,
        _pendingUpgrades: [{
          role: 'CHAT',
          currentModel: 'fixture-base',
          candidateModel: 'fixture-base',
          score: 99,
        }],
      },
      sessionId: 'fixture-session',
      conversationId: 'fixture-conversation',
    }, 'conversation');
    assertEqual(chat.handled, true);
    assert(/Modely potvrzeny beze zmeny/.test(chat.response.content));
    assertEqual(count(db, 'model_binding_user_noop_receipts'), 2);
    assertEqual(count(db, 'model_binding_operations'), 0);
    assertEqual(events.filter(event => event.action === 'model_changed').length, 0);
  });
});

await testAsync('HTTP cold pull returns after durable intent and before provider completion', async () => {
  await withFixture(async ({ db, manager, provider, events, application }) => {
    provider.models.delete('fixture-target');
    provider.pullTargets.set('fixture-target', model('fixture-target', DIGEST_B));
    provider.pullGate = deferred();
    const responses = [];
    const routes = createSystemRoutes({
      db: { db },
      modelRegistry: null,
      modelBindingApplication: application,
      parseBody: async () => ({ role: 'CHAT', targetModel: 'fixture-target' }),
      sendJSON: (_res, status, body) => responses.push({ status, body }),
    });

    await routes['POST /api/system/upgrades/apply']({}, {});

    assertEqual(responses[0].status, 200);
    assertEqual(responses[0].body.status, 'started');
    assertEqual(count(db, 'model_binding_provider_operations'), 1);
    assertEqual(count(db, 'model_binding_provider_attempts'), 0);
    assertEqual(count(db, 'model_binding_operations'), 0);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
    assertEqual(events.filter(event => event.action === 'model_changed').length, 0);

    const pendingStatus = application.getBindingStatus({ role: 'CHAT' });
    assertEqual(pendingStatus.providerStatus, 'PENDING');
    assert(pendingStatus.providerOperationId);

    provider.pullGate.resolve();
    await waitUntil(
      () => events.some(event => event.action === 'model_changed'),
      'Accepted cold pull did not reach the durable binding commit',
    );
    await application.awaitBackgroundWork();
    assertEqual(count(db, 'model_binding_operations'), 1);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-target');
  });
});

await testAsync('second HTTP apply receives 409 while accepted cold pull owns the commit seam', async () => {
  await withFixture(async ({ db, provider, application }) => {
    provider.models.delete('fixture-target');
    provider.pullTargets.set('fixture-target', model('fixture-target', DIGEST_B));
    provider.pullGate = deferred();
    let requestBody = { role: 'CHAT', targetModel: 'fixture-target' };
    const responses = [];
    const routes = createSystemRoutes({
      db: { db },
      modelRegistry: null,
      modelBindingApplication: application,
      parseBody: async () => requestBody,
      sendJSON: (_res, status, body) => responses.push({ status, body }),
    });

    await routes['POST /api/system/upgrades/apply']({}, {});
    assertEqual(responses[0].status, 200);
    requestBody = { role: 'CHAT', targetModel: 'fixture-other' };
    await routes['POST /api/system/upgrades/apply']({}, {});
    assertEqual(responses[1].status, 409);
    assert(/Another binding application/.test(responses[1].body.error));
    assertEqual(count(db, 'model_binding_provider_operations'), 1);
    assertEqual(count(db, 'model_binding_operations'), 0);

    provider.pullGate.resolve();
    await waitUntil(
      () => count(db, 'model_binding_operations') === 1,
      'Accepted HTTP winner did not reach the binding commit',
    );
    await application.awaitBackgroundWork();
    assertEqual(count(db, 'model_binding_operations'), 1);
  });
});

await testAsync('HTTP maps an actual provider outage without false started success', async () => {
  const provider = new OllamaModelBindingProvider({
    baseUrl: 'http://127.0.0.1:11434',
    fetchImpl: async () => { throw new Error('fixture connection refused'); },
    inventoryTimeoutMs: 25,
  });
  await withFixture(async ({ db, manager, application }) => {
    const responses = [];
    const routes = createSystemRoutes({
      db: { db },
      modelRegistry: null,
      modelBindingApplication: application,
      parseBody: async () => ({ role: 'CHAT', targetModel: 'fixture-target' }),
      sendJSON: (_res, status, body) => responses.push({ status, body }),
    });

    await routes['POST /api/system/upgrades/apply']({}, {});

    assertEqual(responses.length, 1);
    assertEqual(responses[0].status, 503);
    assertEqual(responses[0].body.error, 'Ollama model inventory is unavailable');
    assertEqual(count(db, 'model_binding_operations'), 0);
    assertEqual(count(db, 'model_desired_bindings'), 0);
    assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
  }, { provider });
});

await testAsync('HTTP maps binding authority conflicts to 409 instead of false 500', async () => {
  await withFixture(async ({ db }) => {
    for (const code of [
      'MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS',
      'MODEL_BINDING_PROVIDER_COMMAND_SUPERSEDED',
      'MODEL_FAILOVER_STALE_DESIRED',
    ]) {
      const responses = [];
      const routes = createSystemRoutes({
        db: { db },
        modelRegistry: null,
        modelBindingApplication: {
          async beginManualBinding() {
            const error = new Error(`fixture ${code}`);
            error.code = code;
            throw error;
          },
        },
        parseBody: async () => ({ role: 'CHAT', targetModel: 'fixture-target' }),
        sendJSON: (_res, status, body) => responses.push({ status, body }),
      });
      await routes['POST /api/system/upgrades/apply']({}, {});
      assertEqual(responses.length, 1);
      assertEqual(responses[0].status, 409);
      assertEqual(responses[0].body.error, `fixture ${code}`);
    }
  });
});

await testAsync('HTTP and chat adapters have equal durable pull/apply truth', async () => {
  const runJourney = source => withFixture(async ({
    db,
    repository,
    manager,
    provider,
    events,
    application,
  }) => {
    const target = model('fixture-pulled', DIGEST_C);
    provider.pullTargets.set(target.canonicalName, target);
    let httpRoutes = null;
    const responses = [];
    let requestBody = {
      role: 'CHAT',
      targetModel: target.name,
      actor: 'system:forged',
      digestSha256: DIGEST_A,
    };

    if (source === 'HTTP') {
      httpRoutes = createSystemRoutes({
        db: { db },
        modelRegistry: null,
        modelBindingApplication: application,
        parseBody: async () => requestBody,
        sendJSON: (_res, status, body) => responses.push({ status, body }),
      });
      await httpRoutes['POST /api/system/upgrades/apply']({}, {});
      assertEqual(responses[0].status, 200);
      await waitUntil(
        () => events.some(event => event.action === 'model_changed'),
        'HTTP durable start did not reach the shared commit layer',
      );
    } else {
      setModelBindingApplication(application);
      const chat = await preHandle('ano', {
        sessionState: {
          _upgradeNotified: true,
          _pendingUpgrades: [{
            role: 'CHAT',
            currentModel: 'fixture-base',
            candidateModel: target.name,
            score: 99,
            actor: 'system:forged',
          }],
        },
        sessionId: 'fixture-session',
        conversationId: 'fixture-conversation',
      }, 'conversation');
      assertEqual(chat.handled, true);
    }
    await application.awaitBackgroundWork();

    const operation = latestOperation(repository);
    const state = repository.getBindingApplicationState(operation.operationId);
    const shape = {
      kind: operation.kind,
      desiredSource: repository.getDesired('CHAT').source,
      runtimeModel: manager.createBindingRuntimePort().snapshot('CHAT').modelName,
      runtimeStatus: state.runtimeStatus,
      verificationStatus: state.verificationStatus,
      notificationStatus: state.notificationStatus,
      history: count(db, 'upgrade_history'),
      providerPulls: provider.calls.pull,
      providerAudit: count(db, 'model_binding_provider_attempts'),
      progress: events.filter(event => event.action === 'model_pull_progress').length > 0,
    };

    if (source === 'HTTP') {
      const responseCount = responses.length;
      requestBody = { role: 'CHAT', force: true, skipVerify: true };
      await httpRoutes['POST /api/system/upgrades/rollback']({}, {});
      await application.awaitBackgroundWork();
      assertEqual(responses[responseCount].status, 200);
      assertEqual(manager.createBindingRuntimePort().snapshot('CHAT').modelName, 'fixture-base');
      assertEqual(count(db, 'model_binding_operations'), 2);

      assert(application.getBindingStatus({ role: 'CHAT' }).verificationStatus !== null);
    }
    return shape;
  });

  const http = await runJourney('HTTP');
  const chat = await runJourney('CHAT');
  assertEqual(JSON.stringify(http), JSON.stringify(chat));
});

await testAsync('ModelRegistry delegates assignment without forwarding legacy authority options', async () => {
  const calls = [];
  const registry = new ModelRegistry();
  registry.init({
    db: null,
    upgradeManager: null,
    modelBindingApplication: {
      async applyManualBinding(input) {
        calls.push(input);
        return { ok: true, role: input.role, to: input.targetModel };
      },
    },
    validationRunner: null,
    broadcast: () => {},
  });
  const result = await registry.assignModel('CHAT', 'fixture-target', {
    appliedBy: 'system:forged',
    score: 99,
    skipVerify: true,
  });
  assertEqual(result.ok, true);
  assertEqual(JSON.stringify(calls), JSON.stringify([{
    role: 'CHAT',
    targetModel: 'fixture-target',
  }]));
});

suite('M1 model binding application — strict provider and bypass guards');

await testAsync('strict provider rejects non-loopback, ambiguity, missing digest and drift', async () => {
  const invalidUrlProvider = new OllamaModelBindingProvider({
    baseUrl: 'https://example.com',
    fetchImpl: async () => new Response('{}'),
  });
  const urlError = await captureError(invalidUrlProvider.resolveExact('fixture'));
  assertEqual(urlError.code, 'MODEL_BINDING_PROVIDER_URL_INVALID');
  for (const baseUrl of ['http://localhost:0', 'http://localhost:00081']) {
    const nonCanonical = new OllamaModelBindingProvider({
      baseUrl,
      fetchImpl: async () => new Response('{}'),
    });
    const error = await captureError(nonCanonical.resolveExact('fixture'));
    assertEqual(error.code, 'MODEL_BINDING_PROVIDER_URL_INVALID');
  }

  const providerFor = models => new OllamaModelBindingProvider({
    baseUrl: 'http://127.0.0.1:11434',
    fetchImpl: async () => new Response(JSON.stringify({ models }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
  const ambiguous = await captureError(providerFor([
    { name: 'fixture', digest: DIGEST_A },
    { name: 'fixture:latest', digest: DIGEST_A },
  ]).resolveExact('fixture'));
  assertEqual(ambiguous.code, 'MODEL_BINDING_TARGET_AMBIGUOUS');

  const missingDigest = await captureError(providerFor([
    { name: 'fixture', digest: '' },
  ]).resolveExact('fixture'));
  assertEqual(missingDigest.code, 'MODEL_BINDING_TARGET_DIGEST_MISSING');

  const prefixed = await providerFor([
    { name: 'fixture', digest: `sha256:${DIGEST_A}` },
  ]).resolveExact('fixture');
  assertEqual(prefixed.digestSha256, DIGEST_A);

  const wrongPrefix = await captureError(providerFor([
    { name: 'fixture', digest: `sha512:${DIGEST_A}` },
  ]).resolveExact('fixture'));
  assertEqual(wrongPrefix.code, 'MODEL_BINDING_TARGET_DIGEST_MISSING');

  const drift = await captureError(providerFor([
    { name: 'fixture', digest: DIGEST_A },
  ]).resolveExact('fixture', { expectedDigestSha256: DIGEST_B }));
  assertEqual(drift.code, 'MODEL_BINDING_TARGET_DIGEST_DRIFT');
});

await testAsync('real loopback provider verifies tags-chat-tags with exact request shape', async () => {
  const sequence = [];
  let tagReads = 0;
  let chatBody = null;
  await withLoopbackServer(async (request, response) => {
    if (request.url === '/api/tags' && request.method === 'GET') {
      tagReads++;
      sequence.push(`tags-${tagReads}`);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        models: [{ name: 'fixture-target:latest', digest: DIGEST_B }],
      }));
      return;
    }
    if (request.url === '/api/chat' && request.method === 'POST') {
      sequence.push('chat');
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      chatBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        model: 'fixture-target:latest',
        done: true,
        message: { role: 'assistant', content: 'ok' },
      }));
      return;
    }
    response.writeHead(404).end();
  }, async baseUrl => {
    const provider = new OllamaModelBindingProvider({ baseUrl, verifyTimeoutMs: 200 });
    const verified = await provider.verifyExact({
      modelName: 'fixture-target',
      digestSha256: DIGEST_B,
    });
    assertEqual(verified.digestSha256, DIGEST_B);
  });
  assertEqual(sequence.join('>'), 'tags-1>chat>tags-2');
  assertEqual(chatBody.model, 'fixture-target:latest');
  assertEqual(chatBody.stream, false);
  assertEqual(chatBody.think, false);
  assertEqual(chatBody.options.num_predict, 1);
  assertEqual(chatBody.options.num_ctx, 512);
});

await testAsync('real loopback provider rejects malformed, incomplete, HTTP, timeout and drift', async () => {
  let scenario = 'empty';
  let tagReads = 0;
  await withLoopbackServer(async (request, response) => {
    if (request.url === '/api/tags') {
      tagReads++;
      const digest = scenario === 'drift' && tagReads > 1 ? DIGEST_C : DIGEST_B;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ models: [{ name: 'fixture-target', digest }] }));
      return;
    }
    if (request.url === '/api/chat') {
      for await (const _chunk of request) { /* drain */ }
      if (scenario === 'status') {
        response.writeHead(503).end('unavailable');
      } else if (scenario === 'malformed') {
        response.setHeader('Content-Type', 'application/json');
        response.end('{');
      } else if (scenario === 'empty') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          model: 'fixture-target',
          done: true,
          message: { role: 'assistant', content: '' },
        }));
      } else if (scenario === 'whitespace') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          model: 'fixture-target',
          done: true,
          message: { role: 'assistant', content: '   ' },
        }));
      } else if (scenario === 'wrong-type') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          model: 'fixture-target',
          done: true,
          message: { role: 'assistant', content: { text: 'ok' } },
        }));
      } else if (scenario === 'incomplete') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          model: 'fixture-target',
          done: false,
          message: { role: 'assistant', content: 'ok' },
        }));
      } else if (scenario === 'wrong-role') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          model: 'fixture-target',
          done: true,
          message: { role: 'user', content: 'ok' },
        }));
      } else if (scenario === 'wrong-model') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          model: 'other-model',
          done: true,
          message: { role: 'assistant', content: 'ok' },
        }));
      } else if (scenario === 'timeout') {
        // Intentionally wait for the provider-owned AbortSignal.
      } else {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          model: 'fixture-target',
          done: true,
          message: { role: 'assistant', content: 'ok' },
        }));
      }
      return;
    }
    response.writeHead(404).end();
  }, async (baseUrl, server) => {
    const expected = new Map([
      ['empty', 'MODEL_BINDING_VERIFICATION_REJECTED'],
      ['whitespace', 'MODEL_BINDING_VERIFICATION_REJECTED'],
      ['wrong-type', 'MODEL_BINDING_VERIFICATION_REJECTED'],
      ['incomplete', 'MODEL_BINDING_VERIFICATION_REJECTED'],
      ['wrong-role', 'MODEL_BINDING_VERIFICATION_REJECTED'],
      ['wrong-model', 'MODEL_BINDING_VERIFICATION_REJECTED'],
      ['malformed', 'MODEL_BINDING_VERIFICATION_REJECTED'],
      ['status', 'MODEL_BINDING_VERIFICATION_REJECTED'],
      ['drift', 'MODEL_BINDING_TARGET_DIGEST_DRIFT'],
      ['timeout', 'MODEL_BINDING_PROVIDER_UNAVAILABLE'],
    ]);
    for (const [name, code] of expected) {
      scenario = name;
      tagReads = 0;
      const provider = new OllamaModelBindingProvider({
        baseUrl,
        verifyTimeoutMs: name === 'timeout' ? 25 : 200,
      });
      const error = await captureError(provider.verifyExact({
        modelName: 'fixture-target',
        digestSha256: DIGEST_B,
      }));
      assertEqual(error.code, code);
      if (name === 'timeout') server.closeAllConnections?.();
    }
  });
});

await testAsync('provider-owned pull origin cannot drift with mutable config', async () => {
  let installed = false;
  let capturedAuthority = null;
  const originalUrl = config.ollama.baseUrl;
  try {
    await withLoopbackServer((request, response) => {
      if (request.url === '/api/tags') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          models: installed ? [{ name: 'fixture-target', digest: DIGEST_B }] : [],
        }));
        return;
      }
      response.writeHead(404).end();
    }, async baseUrl => {
      const provider = new OllamaModelBindingProvider({
        baseUrl,
        pullImpl: async (_modelName, _onProgress, authority) => {
          capturedAuthority = authority;
          config.ollama.baseUrl = 'http://127.0.0.1:9';
          installed = true;
        },
      });
      const resolved = await provider.ensureInstalled('fixture-target');
      assertEqual(resolved.digestSha256, DIGEST_B);
      assertEqual(capturedAuthority.baseUrl, baseUrl);
    });
  } finally {
    config.ollama.baseUrl = originalUrl;
  }
});

await testAsync('production pull composition performs tags-pull-tags on one pinned loopback origin', async () => {
  const sequence = [];
  let installed = false;
  let pullBody = null;
  const progress = [];
  await withLoopbackServer(async (request, response) => {
    if (request.url === '/api/tags' && request.method === 'GET') {
      sequence.push('tags');
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        models: installed ? [{ name: 'fixture-target:latest', digest: DIGEST_B }] : [],
      }));
      return;
    }
    if (request.url === '/api/pull' && request.method === 'POST') {
      sequence.push('pull');
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      pullBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      installed = true;
      response.setHeader('Content-Type', 'application/x-ndjson');
      response.end(`${JSON.stringify({ status: 'success' })}\n`);
      return;
    }
    response.writeHead(404).end();
  }, async baseUrl => {
    const manager = new UpgradeManager();
    const provider = new OllamaModelBindingProvider({
      baseUrl,
      pullImpl: (modelName, onProgress, authority) => (
        manager.pullModel(modelName, onProgress, authority)
      ),
    });
    const resolved = await provider.ensureInstalled(
      'fixture-target',
      entry => progress.push(entry),
    );
    assertEqual(resolved.name, 'fixture-target:latest');
    assertEqual(resolved.digestSha256, DIGEST_B);
  });
  assertEqual(sequence.join('>'), 'tags>pull>tags');
  assertEqual(JSON.stringify(pullBody), JSON.stringify({ name: 'fixture-target' }));
  assert(progress.some(entry => entry.status === 'success'));
});

await testAsync('chat cleanup adapter consumes one exact registry plan and one single-use approval', async () => {
  const prepared = [];
  const deleted = [];
  const candidates = [{
    model: 'cleanup-fixture',
    replacedBy: 'fixture-target',
    appliedAt: '2026-07-01 00:00:00',
  }];
  const sessionState = {
    _cleanupCandidates: [{
      model: 'stale-session-fixture',
      replacedBy: 'fixture-target',
      appliedAt: '2026-07-01 00:00:00',
    }],
  };
  setUpgradeManager({
    _db: {},
    getUnusedOldModels() {
      return candidates;
    },
  });
  setModelRegistry({
    isDeletable() {
      return { deletable: true };
    },
    async prepareDeletePlans(names) {
      prepared.push([...names]);
      return Object.freeze([Object.freeze({
        exactName: 'cleanup-fixture:latest',
        canonicalName: 'cleanup-fixture',
        digestSha256: DIGEST_A,
      })]);
    },
    async deleteModel(name, options) {
      deleted.push({ name, options });
      return { ok: true, deleted: name, digestSha256: DIGEST_A, freedGB: '1.0' };
    },
  });
  try {
    const withoutSession = await preHandle('smaz stare modely', {
      sessionId: 'cleanup-session',
      conversationId: 'cleanup-conversation',
    }, 'CONVERSATION');
    assertEqual(withoutSession.handled, true);
    assertEqual(withoutSession.response.tag.metadata.errorCode, 'MODEL_DELETE_SESSION_REQUIRED');
    assertEqual(prepared.length, 0);

    const preview = await preHandle('smaz stare modely', {
      sessionState,
      sessionId: 'cleanup-session',
      conversationId: 'cleanup-conversation',
    }, 'CONVERSATION');
    assertEqual(preview.handled, true);
    assertEqual(preview.response.tag.metadata.modelCleanupPrepared, true);
    assertEqual(JSON.stringify(prepared), JSON.stringify([['cleanup-fixture']]));
    assertEqual(deleted.length, 0);
    assertEqual(sessionState._pendingModelCleanup.length, 1);

    const confirmation = await preHandle('potvrdit smazani modelu', {
      sessionState,
      sessionId: 'cleanup-session',
      conversationId: 'cleanup-conversation',
    }, 'CONVERSATION');
    assertEqual(confirmation.handled, true);
    assertEqual(confirmation.response.tag.metadata.modelCleanup, true);
    assertEqual(JSON.stringify(deleted), JSON.stringify([{
      name: 'cleanup-fixture:latest',
      options: { source: 'USER_CHAT', expectedDigestSha256: DIGEST_A },
    }]));
    assertEqual(sessionState._pendingModelCleanup, null);
    assertEqual(sessionState._cleanupCandidates, null);

    const replay = await preHandle('potvrdit smazani modelu', {
      sessionState,
      sessionId: 'cleanup-session',
      conversationId: 'cleanup-conversation',
    }, 'CONVERSATION');
    assertEqual(replay.handled, true);
    assertEqual(deleted.length, 1);
  } finally {
    setModelRegistry(null);
    setUpgradeManager(null);
  }
});

await testAsync('real post-apply chat cleanup parks the protected one-step rollback model', async () => {
  await withFixture(async ({ db, manager, application }) => {
    await application.applyManualBinding({
      role: 'CHAT',
      targetModel: 'fixture-target',
    });
    db.prepare(`
      UPDATE model_overrides
      SET applied_at = '2026-07-01 00:00:00'
      WHERE role = 'CHAT'
    `).run();

    let inventoryCalls = 0;
    const registry = new ModelRegistry();
    registry.init({
      db,
      upgradeManager: manager,
      modelBindingApplication: application,
      validationRunner: null,
      broadcast: () => {},
    });
    registry.getInstalled = async () => {
      inventoryCalls += 1;
      return [{
        name: 'fixture-base:latest',
        digest: DIGEST_A,
        digestSha256: DIGEST_A,
        sizeGB: '1.0',
      }];
    };
    setUpgradeManager(manager);
    setModelRegistry(registry);
    try {
      const sessionState = {};
      const result = await preHandle('smaz stare modely', {
        sessionState,
        sessionId: 'protected-cleanup-session',
        conversationId: 'protected-cleanup-conversation',
      }, 'CONVERSATION');
      assertEqual(result.handled, true);
      assertEqual(result.response.content, 'Zadne nepouzivane modely k odstraneni.');
      assertEqual(sessionState._pendingModelCleanup, undefined);
      assertEqual(inventoryCalls, 0);
      assert(application.getProtectedModelNames().some(model => sameModelName(model, 'fixture-base')));
    } finally {
      setModelRegistry(null);
      setUpgradeManager(null);
    }
  });
});

await testAsync('source call graph has no production reference to legacy binding writers', async () => {
  const root = path.resolve('src');
  const files = [];
  const walk = directory => {
    for (const entry of readdirSync(directory).sort()) {
      const absolute = path.join(directory, entry);
      if (statSync(absolute).isDirectory()) walk(absolute);
      else if (/\.(?:[cm]?js|tsx?)$/.test(entry)) files.push(absolute);
    }
  };
  walk(root);

  const forbidden = [
    'applyUpgrade',
    'rollbackUpgrade',
    'loadPersistedOverrides',
    '_backgroundVerify',
  ];
  const allowedLegacyOccurrences = new Set([
    'upgrade/upgrade-manager.js:loadPersistedOverrides() {',
    'upgrade/upgrade-manager.js:async applyUpgrade(role, targetModel, opts = {}) {',
    "upgrade/upgrade-manager.js:this._requireLegacyBindingWriterAllowed('applyUpgrade');",
    'upgrade/upgrade-manager.js:async rollbackUpgrade(role, opts = {}) {',
    "upgrade/upgrade-manager.js:this._requireLegacyBindingWriterAllowed('rollbackUpgrade');",
    'upgrade/upgrade-manager.js:async _backgroundVerify(role, targetModel, previousModel, onFail) {',
    'upgrade/upgrade-manager.js:* Called after applyUpgrade to clean up proposals that are now obsolete.',
  ]);
  const violations = [];
  const modelChangedOwners = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const line of source.split('\n')) {
      if (!forbidden.some(method => line.includes(method))) continue;
      const occurrence = `${path.relative(root, file)}:${line.trim()}`;
      if (!allowedLegacyOccurrences.has(occurrence)) violations.push(occurrence);
    }
    if (/action\s*:\s*['"]model_changed['"]/.test(source)) {
      modelChangedOwners.push(path.relative(root, file));
    }
  }
  assertEqual(violations.length, 0, `Legacy binding calls remain: ${violations.join(', ')}`);
  assertEqual(
    JSON.stringify(modelChangedOwners),
    JSON.stringify(['upgrade/model-binding-application.js']),
  );
  const modelDeleteOwners = files.filter(file => (
    readFileSync(file, 'utf8').includes('/api/delete')
  )).map(file => path.relative(root, file));
  assertEqual(
    JSON.stringify(modelDeleteOwners),
    JSON.stringify(['upgrade/model-registry.js']),
  );

  const server = readFileSync(path.join(root, 'server.js'), 'utf8');
  assert(server.indexOf('await modelBindingApplication.rehydrateBindings()')
    < server.indexOf('const routeDeps = {'), 'rehydrate must finish before serving routes');
  const application = readFileSync(path.join(root, 'upgrade/model-binding-application.js'), 'utf8');
  assert(!application.includes('model_binding_proofs'), 'manual application must not issue proof');
  assert(!application.includes('claimOperation('), 'manual application must not consume failover claims');
});

summary();
