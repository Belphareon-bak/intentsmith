#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

import {
  EXPECTED_M6_MODEL_ARTIFACT_AUTHORITY_FINGERPRINT_V098,
  computeM6ModelArtifactAuthorityFingerprintV098,
  up as installModelArtifactAuthority,
} from '../src/db/migrations/2026_08_27_098_m6_model_artifact_authority.js';
import {
  createModelArtifactAuthorityRepository,
} from '../src/upgrade/model-artifact-authority-repository.js';
import {
  MODEL_ACTIVITY_OWNER,
  ModelUseAuthority,
} from '../src/upgrade/model-use-authority.js';
import { requireLoopbackModelProviderOrigin } from '../src/upgrade/model-provider-origin.js';
import { ModelRegistry } from '../src/upgrade/model-registry.js';
import { UpgradeManager } from '../src/upgrade/upgrade-manager.js';
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import { suite, summary, test, testAsync } from './harness.js';

let fixtureIndex = 0;

function identity(marker, pid) {
  return Object.freeze({
    pid,
    uid: 1000,
    bootId: `boot-${marker.padEnd(31, marker)}`,
    startTicks: String(10_000 + pid),
    instanceId: marker.repeat(64),
  });
}

function fixture({ probeA = () => 'LIVE', probeB = () => 'LIVE' } = {}) {
  fixtureIndex += 1;
  const databasePath = path.join(isolatedTestRuntime.temp, `m6-model-authority-${fixtureIndex}.sqlite`);
  const firstDb = new Database(databasePath);
  firstDb.pragma('foreign_keys = ON');
  installModelArtifactAuthority(firstDb);
  const secondDb = new Database(databasePath);
  secondDb.pragma('foreign_keys = ON');
  let now = 1_800_000_000_000;
  let id = 0;
  const options = (processIdentity, processProbe) => ({
    processIdentity,
    processProbe,
    clock: () => ++now,
    idFactory: () => `${String(++id).padStart(8, '0')}-0000-4000-8000-000000000000`,
  });
  const first = createModelArtifactAuthorityRepository(
    firstDb,
    options(identity('a', 101), probeA),
  );
  const second = createModelArtifactAuthorityRepository(
    secondDb,
    options(identity('b', 202), probeB),
  );
  return {
    databasePath,
    firstDb,
    secondDb,
    first,
    second,
    close() {
      firstDb.close();
      secondDb.close();
      if (existsSync(databasePath)) rmSync(databasePath, { force: false });
    },
  };
}

function capture(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('expected callback to throw');
}

suite('M6 durable model artifact authority');

test('migration installs the exact fingerprinted append-only schema', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  installModelArtifactAuthority(db);
  assert.equal(
    computeM6ModelArtifactAuthorityFingerprintV098(db),
    EXPECTED_M6_MODEL_ARTIFACT_AUTHORITY_FINGERPRINT_V098,
  );
  const names = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE name LIKE 'm6_model_artifact_%' ORDER BY name
  `).all().map(row => row.name);
  assert.deepEqual(names, [
    'm6_model_artifact_claims',
    'm6_model_artifact_events',
    'm6_model_artifact_operations',
  ]);
  const insertClaim = db.prepare(`
    INSERT INTO m6_model_artifact_claims (
      claim_id, canonical_name, mode, owner, owner_pid, owner_uid,
      owner_boot_id, owner_start_ticks, owner_instance_id, acquired_at_ms
    ) VALUES (?, 'schema-fixture', ?, ?, 99, 1000, ?, '12345', ?, 1000)
  `);
  insertClaim.run(
    'claim-schema-shared',
    'SHARED',
    'LLM_GATEWAY',
    'schema-boot-id-0000000000000000',
    'a'.repeat(64),
  );
  insertClaim.run(
    'claim-schema-delete',
    'EXCLUSIVE',
    'MODEL_DELETE',
    'schema-boot-id-0000000000000000',
    'b'.repeat(64),
  );
  const insertOperation = db.prepare(`
    INSERT INTO m6_model_artifact_operations (
      operation_id, claim_id, kind, exact_name, canonical_name,
      digest_sha256, source, provider_origin, created_at_ms
    ) VALUES (?, ?, 'DELETE', ?, ?, ?, 'USER_HTTP', ?, 1001)
  `);
  assert.throws(() => insertOperation.run(
    'operation-shared-claim',
    'claim-schema-shared',
    'schema-fixture:latest',
    'schema-fixture',
    'c'.repeat(64),
    'http://127.0.0.1:11434',
  ), /OPERATION_AUTHORITY_MISMATCH/u);
  assert.throws(() => insertOperation.run(
    'operation-name-mismatch',
    'claim-schema-delete',
    'foreign-fixture:latest',
    'schema-fixture',
    'c'.repeat(64),
    'http://127.0.0.1:11434',
  ), /CHECK constraint failed/u);
  assert.throws(() => insertOperation.run(
    'operation-origin-path',
    'claim-schema-delete',
    'schema-fixture:latest',
    'schema-fixture',
    'c'.repeat(64),
    'http://127.0.0.1:11434/redirect',
  ), /CHECK constraint failed/u);
  db.close();
});

test('two SQLite connections enforce shared/exclusive claims across process identities', () => {
  const state = fixture();
  try {
    const firstAuthority = new ModelUseAuthority({ durableRepository: state.first });
    const secondAuthority = new ModelUseAuthority({ durableRepository: state.second });
    const shared = firstAuthority.acquireShared({
      modelName: 'Cross-Process-Fixture',
      owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
    });
    const blockedDelete = capture(() => secondAuthority.acquireExclusive({
      modelName: 'cross-process-fixture:latest',
      owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
    }));
    assert.equal(blockedDelete.code, 'MODEL_MUTATION_ACTIVE_USE');
    assert.equal(blockedDelete.details.activeUseCount, 1);
    shared.release();

    const mutation = secondAuthority.acquireExclusive({
      modelName: 'cross-process-fixture',
      owner: MODEL_ACTIVITY_OWNER.MODEL_PULL,
    });
    const blockedUse = capture(() => firstAuthority.acquireShared({
      modelName: 'cross-process-fixture',
      owner: MODEL_ACTIVITY_OWNER.VRAM_ARTIFACT_USE,
    }));
    assert.equal(blockedUse.code, 'MODEL_USE_EXCLUSIVE_ACTIVE');
    mutation.release();
  } finally {
    state.close();
  }
});

test('gone owners are recovered atomically while unknown owners remain a fail-closed fence', () => {
  const gone = fixture({ probeB: () => 'GONE' });
  try {
    const first = new ModelUseAuthority({ durableRepository: gone.first });
    const second = new ModelUseAuthority({ durableRepository: gone.second });
    first.acquireShared({
      modelName: 'gone-fixture',
      owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
    });
    const recovered = second.acquireExclusive({
      modelName: 'gone-fixture',
      owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
    });
    const row = gone.firstDb.prepare(`
      SELECT release_reason FROM m6_model_artifact_claims
      WHERE owner_instance_id = ?
    `).get('a'.repeat(64));
    assert.equal(row.release_reason, 'OWNER_GONE_RECOVERED');
    recovered.release();
  } finally {
    gone.close();
  }

  const unknown = fixture({ probeB: () => 'UNKNOWN' });
  try {
    const first = new ModelUseAuthority({ durableRepository: unknown.first });
    const second = new ModelUseAuthority({ durableRepository: unknown.second });
    first.acquireShared({
      modelName: 'unknown-fixture',
      owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
    });
    const blocked = capture(() => second.acquireExclusive({
      modelName: 'unknown-fixture',
      owner: MODEL_ACTIVITY_OWNER.MODEL_DELETE,
    }));
    assert.equal(blocked.code, 'MODEL_MUTATION_ACTIVE_USE');
  } finally {
    unknown.close();
  }
});

test('intent and terminal outcome are append-only and an orphan fences all new work', () => {
  const state = fixture();
  try {
    const authority = new ModelUseAuthority({ durableRepository: state.first });
    const lease = authority.acquireExclusive({
      modelName: 'audit-fixture',
      owner: MODEL_ACTIVITY_OWNER.MODEL_PULL,
    });
    const { operationId } = state.first.recordIntent({
      claimId: lease.claimId,
      kind: 'PULL',
      exactName: 'audit-fixture:latest',
      canonicalName: 'audit-fixture',
      digestSha256: null,
      source: 'USER_HTTP',
      providerOrigin: 'http://127.0.0.1:11434',
    });
    state.first.recordOutcome(operationId, 'ORPHANED', 'MODEL_PULL_IDLE_TIMEOUT');
    lease.release();
    const blocked = capture(() => authority.acquireShared({
      modelName: 'audit-fixture',
      owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
    }));
    assert.equal(blocked.code, 'MODEL_ARTIFACT_OUTCOME_UNRESOLVED');
    assert.equal(blocked.details.operationId, operationId);

    const recovery = state.first.acquirePullRecoveryClaim(operationId);
    state.first.releaseClaim(recovery.claimId);
    state.first.reconcileSucceeded(operationId);
    const shared = authority.acquireShared({
      modelName: 'audit-fixture',
      owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
    });
    shared.release();

    for (const statement of [
      "UPDATE m6_model_artifact_operations SET source = 'RECOVERY'",
      'DELETE FROM m6_model_artifact_operations',
      "UPDATE m6_model_artifact_events SET status = 'FAILED'",
      'DELETE FROM m6_model_artifact_events',
    ]) assert.throws(() => state.firstDb.exec(statement), /append-only|cannot be deleted/u);
  } finally {
    state.close();
  }
});

test('intent-only crash is fenced and can only resume the same pull identity', () => {
  const state = fixture();
  try {
    const authority = new ModelUseAuthority({ durableRepository: state.first });
    const lease = authority.acquireExclusive({
      modelName: 'resume-fixture',
      owner: MODEL_ACTIVITY_OWNER.MODEL_PULL,
    });
    const { operationId } = state.first.recordIntent({
      claimId: lease.claimId,
      kind: 'PULL',
      exactName: 'resume-fixture:latest',
      canonicalName: 'resume-fixture',
      digestSha256: null,
      source: 'BINDING_APPLICATION',
      providerOrigin: 'http://localhost:11434',
    });
    lease.release();
    assert.equal(state.first.listOutstandingEffects()[0].state, 'INTENT_ONLY');
    const recovery = state.first.acquirePullRecoveryClaim(operationId);
    assert.equal(recovery.exactName, 'resume-fixture:latest');
    assert.equal(recovery.providerOrigin, 'http://localhost:11434');
    state.first.releaseClaim(recovery.claimId);
    state.first.reconcileSucceeded(operationId);
    assert.equal(state.first.listOutstandingEffects().length, 0);
  } finally {
    state.close();
  }
});

test('destructive provider origins are strict loopback and exact-path only', () => {
  for (const accepted of [
    'http://127.0.0.1:11434',
    'http://localhost:11434/',
    'http://[::1]:11434',
  ]) {
    const provider = requireLoopbackModelProviderOrigin(accepted);
    assert.match(provider.endpoint('/api/delete'), /^http:\/\//u);
  }
  for (const rejected of [
    'https://127.0.0.1:11434',
    'http://192.168.1.20:11434',
    'http://user:secret@127.0.0.1:11434',
    'http://127.0.0.1:11434/prefix',
    'http://127.0.0.1:11434?redirect=1',
  ]) assert.throws(
    () => requireLoopbackModelProviderOrigin(rejected),
    /loopback HTTP origin/u,
  );
});

await testAsync('stalled pull becomes a durable orphan and startup recovery resumes the same operation', async () => {
  const state = fixture();
  const originalFetch = globalThis.fetch;
  try {
    const authority = new ModelUseAuthority({ durableRepository: state.first });
    const manager = new UpgradeManager({ modelUseAuthority: authority });
    manager.setModelArtifactAuthorityRepository(state.first);
    manager._pullIdleTimeoutMs = 5;
    let cancelled = 0;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () => new Promise(() => {}),
          cancel: async () => { cancelled += 1; },
        }),
      },
    });
    let timeoutError;
    try {
      await manager.pullModel('stalled-fixture:latest', null, {
        baseUrl: 'http://127.0.0.1:11434',
        source: 'USER_HTTP',
      });
    } catch (error) {
      timeoutError = error;
    }
    assert.equal(timeoutError?.code, 'MODEL_PULL_IDLE_TIMEOUT');
    assert.equal(cancelled, 1);
    const outstanding = state.first.listOutstandingEffects();
    assert.equal(outstanding.length, 1);
    assert.equal(outstanding[0].state, 'ORPHANED');
    assert.equal(authority.snapshot('stalled-fixture').exclusiveOwner, null);
    assert.equal(authority.snapshot('stalled-fixture').outstandingEffect, outstanding[0].operationId);

    let recoveryReadCount = 0;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            recoveryReadCount += 1;
            return recoveryReadCount === 1
              ? { done: false, value: new TextEncoder().encode('{"status":"success"}') }
              : { done: true, value: undefined };
          },
        }),
      },
    });
    const recovered = await manager.recoverOutstandingModelPulls();
    assert.deepEqual(recovered, [{ operationId: outstanding[0].operationId, status: 'RECOVERED' }]);
    assert.equal(state.first.listOutstandingEffects().length, 0);
    const lease = authority.acquireShared({
      modelName: 'stalled-fixture',
      owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
    });
    lease.release();
  } finally {
    globalThis.fetch = originalFetch;
    state.close();
  }
});

await testAsync('pull EOF without an explicit provider success receipt fails closed', async () => {
  const state = fixture();
  const originalFetch = globalThis.fetch;
  try {
    const authority = new ModelUseAuthority({ durableRepository: state.first });
    const manager = new UpgradeManager({ modelUseAuthority: authority });
    manager.setModelArtifactAuthorityRepository(state.first);
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({ read: async () => ({ done: true, value: undefined }) }),
      },
    });
    let providerError;
    try {
      await manager.pullModel('missing-terminal-fixture:latest', null, {
        baseUrl: 'http://127.0.0.1:11434',
        source: 'USER_HTTP',
      });
    } catch (error) {
      providerError = error;
    }
    assert.equal(providerError?.code, 'MODEL_PULL_PROVIDER_TERMINAL_MISSING');
    assert.equal(state.first.listOutstandingEffects().length, 0);
    const operation = state.firstDb.prepare(`
      SELECT operation_id FROM m6_model_artifact_operations
      WHERE canonical_name = 'missing-terminal-fixture'
    `).get();
    const event = state.firstDb.prepare(`
      SELECT status, error_code FROM m6_model_artifact_events
      WHERE operation_id = ?
    `).get(operation.operation_id);
    assert.deepEqual(event, {
      status: 'FAILED',
      error_code: 'MODEL_PULL_PROVIDER_TERMINAL_MISSING',
    });
  } finally {
    globalThis.fetch = originalFetch;
    state.close();
  }
});

await testAsync('provider error cannot be hidden behind a success status', async () => {
  const state = fixture();
  const originalFetch = globalThis.fetch;
  try {
    const authority = new ModelUseAuthority({ durableRepository: state.first });
    const manager = new UpgradeManager({ modelUseAuthority: authority });
    manager.setModelArtifactAuthorityRepository(state.first);
    let reads = 0;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            reads += 1;
            return reads === 1
              ? {
                done: false,
                value: new TextEncoder().encode(
                  '{"status":"success","error":"digest verification failed"}\n',
                ),
              }
              : { done: true, value: undefined };
          },
        }),
      },
    });
    let providerError;
    try {
      await manager.pullModel('provider-error-fixture:latest', null, {
        baseUrl: 'http://127.0.0.1:11434',
        source: 'USER_HTTP',
      });
    } catch (error) {
      providerError = error;
    }
    assert.equal(providerError?.code, 'MODEL_PULL_PROVIDER_REPORTED_ERROR');
    const event = state.firstDb.prepare(`
      SELECT event.status, event.error_code
      FROM m6_model_artifact_events event
      JOIN m6_model_artifact_operations operation
        ON operation.operation_id = event.operation_id
      WHERE operation.canonical_name = 'provider-error-fixture'
    `).get();
    assert.deepEqual(event, {
      status: 'FAILED',
      error_code: 'MODEL_PULL_PROVIDER_REPORTED_ERROR',
    });
  } finally {
    globalThis.fetch = originalFetch;
    state.close();
  }
});

await testAsync('registry delete writes intent before provider and an exact append-only terminal', async () => {
  const state = fixture();
  const originalFetch = globalThis.fetch;
  try {
    const authority = new ModelUseAuthority({ durableRepository: state.first });
    const registry = new ModelRegistry();
    registry.init({
      db: state.firstDb,
      upgradeManager: null,
      modelBindingApplication: {
        getProtectedModelNames: () => [],
        runExclusiveModelMutation: async (_input, callback) => callback(),
      },
      validationRunner: null,
      broadcast: () => {},
      modelUseAuthority: authority,
      modelArtifactAuthorityRepository: state.first,
      requireDurableModelUseAuthority: true,
    });
    registry.getInstalled = async () => [{
      name: 'delete-audit-fixture:latest',
      digestSha256: 'c'.repeat(64),
      digest: `sha256:${'c'.repeat(64)}`,
      sizeGB: '2.0',
    }];
    let operationsAtEffect = 0;
    globalThis.fetch = async () => {
      operationsAtEffect = state.firstDb.prepare(
        'SELECT count(*) AS count FROM m6_model_artifact_operations',
      ).get().count;
      return { ok: true, status: 200 };
    };
    const result = await registry.deleteModel('delete-audit-fixture', {
      source: 'USER_HTTP',
      expectedDigestSha256: 'c'.repeat(64),
    });
    assert.equal(result.ok, true);
    assert.equal(operationsAtEffect, 1, 'provider ran before durable intent');
    const audit = state.firstDb.prepare(`
      SELECT o.kind, o.exact_name, o.digest_sha256, o.provider_origin,
             e.status, e.sequence
      FROM m6_model_artifact_operations o
      JOIN m6_model_artifact_events e ON e.operation_id = o.operation_id
    `).get();
    assert.deepEqual(audit, {
      kind: 'DELETE',
      exact_name: 'delete-audit-fixture:latest',
      digest_sha256: 'c'.repeat(64),
      provider_origin: 'http://127.0.0.1:11434',
      status: 'SUCCEEDED',
      sequence: 1,
    });
  } finally {
    globalThis.fetch = originalFetch;
    state.close();
  }
});

await testAsync('unknown delete outcome persists an orphan fence after lease release', async () => {
  const state = fixture();
  const originalFetch = globalThis.fetch;
  try {
    const authority = new ModelUseAuthority({ durableRepository: state.first });
    const registry = new ModelRegistry();
    registry.init({
      db: state.firstDb,
      upgradeManager: null,
      modelBindingApplication: {
        getProtectedModelNames: () => [],
        runExclusiveModelMutation: async (_input, callback) => callback(),
      },
      validationRunner: null,
      broadcast: () => {},
      modelUseAuthority: authority,
      modelArtifactAuthorityRepository: state.first,
      requireDurableModelUseAuthority: true,
    });
    registry.getInstalled = async () => [{
      name: 'delete-orphan-fixture:latest',
      digestSha256: 'd'.repeat(64),
      digest: `sha256:${'d'.repeat(64)}`,
      sizeGB: '2.0',
    }];
    globalThis.fetch = async () => { throw new Error('socket outcome unknown'); };
    let providerError;
    try {
      await registry.deleteModel('delete-orphan-fixture', { source: 'USER_HTTP' });
    } catch (error) {
      providerError = error;
    }
    assert.equal(providerError?.code, 'MODEL_DELETE_PROVIDER_UNAVAILABLE');
    const outstanding = state.first.listOutstandingEffects();
    assert.equal(outstanding.length, 1);
    assert.equal(outstanding[0].kind, 'DELETE');
    assert.equal(outstanding[0].state, 'ORPHANED');
    const blocked = capture(() => authority.acquireShared({
      modelName: 'delete-orphan-fixture',
      owner: MODEL_ACTIVITY_OWNER.LLM_GATEWAY,
    }));
    assert.equal(blocked.code, 'MODEL_ARTIFACT_OUTCOME_UNRESOLVED');
  } finally {
    globalThis.fetch = originalFetch;
    state.close();
  }
});

summary();
