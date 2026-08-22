#!/usr/bin/env node

import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

import {
  assert,
  assertEqual,
  suite,
  summary,
  testAsync,
} from './harness.js';
import { runMigrations } from '../src/db/migrate.js';
import {
  POLICY_SOURCE,
  updateModelAutomationPolicy,
} from '../src/db/model-policy.js';
import { createModelFailoverRepository } from '../src/upgrade/model-failover.js';
import { getModelFailoverProofContract } from '../src/upgrade/model-failover-proof-policy.js';
import {
  createModelBindingApplication,
} from '../src/upgrade/model-binding-application.js';
import {
  ModelFailoverApplicationError,
  createModelFailoverApplication,
} from '../src/upgrade/model-failover-application.js';
import { ModelUseAuthority } from '../src/upgrade/model-use-authority.js';
import { canonicalModelName } from '../src/upgrade/model-identity.js';

const DESIRED_MODEL = 'reasoner';
const DESIRED_DIGEST = 'a'.repeat(64);
const FALLBACK_MODEL = 'fallback:latest';
const FALLBACK_DIGEST = 'b'.repeat(64);
const SOURCE_REVISION = 'f'.repeat(40);
const ROLE_CONTRACT_SHA256 = getModelFailoverProofContract('CHAT').roleContractSha256;

function createClock(initialNow = 1000) {
  let now = initialNow;
  const counters = { event: 0, episode: 0, operation: 0, claimToken: 0 };
  return {
    setNow(value) { now = value; },
    options: {
      clock: () => now,
      ids: {
        event: () => `application-event-${++counters.event}`,
        episode: () => `application-episode-${++counters.episode}`,
        operation: () => `application-operation-${++counters.operation}`,
        claimToken: () => `application-claim-token-${++counters.claimToken}`,
      },
    },
  };
}

function artifactHash(kind, proofId) {
  return createHash('sha256').update(`${kind}:${proofId}`).digest('hex');
}

function insertProof(db, {
  proofId,
  modelName,
  digestSha256,
  completedAtMs = 2050,
  expiresAtMs = 900000,
}) {
  const canonicalName = canonicalModelName(modelName);
  const measurement = artifactHash('measurement', proofId);
  const acceptance = artifactHash('acceptance', proofId);
  db.prepare(`
    INSERT INTO model_failover_proof_artifacts (
      artifact_sha256, kind, byte_length, source_revision, created_at_ms
    ) VALUES (?, 'MEASUREMENT', 100, ?, ?)
  `).run(measurement, SOURCE_REVISION, completedAtMs);
  db.prepare(`
    INSERT INTO model_failover_proof_artifacts (
      artifact_sha256, kind, byte_length, source_revision, created_at_ms
    ) VALUES (?, 'PARENT_ACCEPTANCE', 100, ?, ?)
  `).run(acceptance, SOURCE_REVISION, completedAtMs);
  db.prepare(`
    INSERT INTO model_failover_proofs (
      proof_id, validation_run_id, role, suite, role_contract_sha256,
      model_name, model_canonical_name, model_digest_sha256,
      validation_version, policy_version, score, required_score, passed_count,
      required_passed_count, total_count, duration_ms, result,
      inventory_before_name, inventory_before_digest, inventory_after_name,
      inventory_after_digest, started_at_ms, completed_at_ms, expires_at_ms,
      created_at_ms, measurement_artifact_sha256, acceptance_artifact_sha256,
      source_revision
    ) VALUES (?, ?, 'CHAT', 'chat', ?, ?, ?, ?, 'v123.1', 'd-plus-v1',
      1, 1, 8, 8, 8, 50, 'PASS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    proofId,
    `${proofId}-run`,
    ROLE_CONTRACT_SHA256,
    modelName,
    canonicalName,
    digestSha256,
    modelName,
    digestSha256,
    modelName,
    digestSha256,
    completedAtMs - 50,
    completedAtMs,
    expiresAtMs,
    completedAtMs,
    measurement,
    acceptance,
    SOURCE_REVISION,
  );
}

function createProvider(initialInventory) {
  let inventory = initialInventory.map(entry => ({ ...entry }));
  const effects = { listInstalled: 0, resolveExact: 0, pull: 0, verifyExact: 0 };
  const listInstalled = async () => {
    effects.listInstalled++;
    return inventory.map(entry => Object.freeze({ ...entry }));
  };
  const resolveFromInventory = (entries, modelName, options = {}) => {
    const canonical = canonicalModelName(modelName);
    const matches = entries.filter(entry => entry.canonicalName === canonical);
    if (matches.length !== 1) {
      const error = new Error('target unavailable');
      error.code = 'MODEL_BINDING_TARGET_NOT_INSTALLED';
      throw error;
    }
    const [match] = matches;
    if (options.expectedDigestSha256 && match.digestSha256 !== options.expectedDigestSha256) {
      const error = new Error('digest drift');
      error.code = 'MODEL_BINDING_TARGET_DIGEST_DRIFT';
      throw error;
    }
    return Object.freeze({ ...match });
  };
  return {
    effects,
    setInventory(value) { inventory = value.map(entry => ({ ...entry })); },
    async listInstalled() { return listInstalled(); },
    resolveFromInventory,
    async resolveExact(modelName, options = {}) {
      effects.resolveExact++;
      return resolveFromInventory(await listInstalled(), modelName, options);
    },
    async pull() { effects.pull++; throw new Error('pull forbidden'); },
    async verifyExact(expected) { effects.verifyExact++; return this.resolveExact(expected.modelName, { expectedDigestSha256: expected.digestSha256 }); },
    getOrigin() { return 'http://127.0.0.1:11434'; },
  };
}

function createRuntime(initialModel = DESIRED_MODEL) {
  let modelName = initialModel;
  let configVersion = 0;
  let token = null;
  let failCommitOnce = false;
  const effects = { prepare: 0, commit: 0, compensate: 0 };
  return {
    effects,
    setModel(value) { modelName = value; },
    failNextCommit() { failCommitOnce = true; },
    snapshot(role) { return Object.freeze({ role, modelName, configVersion }); },
    prepare(input) {
      effects.prepare++;
      if (token || canonicalModelName(modelName) !== canonicalModelName(input.expectedModel)) {
        const error = new Error('runtime CAS mismatch');
        error.code = 'MODEL_BINDING_RUNTIME_CAS_MISMATCH';
        throw error;
      }
      token = Object.freeze({
        role: input.role,
        previousModel: modelName,
        targetModel: input.targetModel,
        versionBefore: configVersion,
        incrementVersion: input.incrementVersion !== false,
        changed: modelName !== input.targetModel,
      });
      modelName = input.targetModel;
      return token;
    },
    commit(inputToken) {
      effects.commit++;
      if (inputToken !== token) throw new Error('invalid runtime token');
      if (failCommitOnce) {
        failCommitOnce = false;
        const error = new Error('synthetic commit failure');
        error.code = 'MODEL_BINDING_RUNTIME_COMMIT_FAILED';
        throw error;
      }
      configVersion += token.incrementVersion ? 1 : 0;
      const result = Object.freeze({
        role: token.role,
        from: token.previousModel,
        to: token.targetModel,
        configVersion,
        changed: token.changed,
      });
      token = null;
      return result;
    },
    compensate(inputToken) {
      effects.compensate++;
      if (inputToken !== token) throw new Error('invalid compensation token');
      modelName = token.previousModel;
      token = null;
    },
    rehydrateLegacy(input) {
      const from = modelName;
      modelName = input.targetModel;
      return { role: input.role, from, to: modelName, configVersion };
    },
    resolvePendingProposals() { return { approved: null, expired: 0 }; },
  };
}

async function createContext({ proofExpiresAtMs = 900000 } = {}) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  await runMigrations(db);
  const clock = createClock();
  const repository = createModelFailoverRepository(db, clock.options);
  updateModelAutomationPolicy(db, {
    values: { autoFailoverEnabled: true },
    expectedRevision: 1,
    actor: 'user:failover-application-test',
    source: POLICY_SOURCE.TYPED_ROUTE,
  });
  const desired = repository.observeDesiredBinding({
    role: 'CHAT',
    modelName: DESIRED_MODEL,
    digestSha256: DESIRED_DIGEST,
    source: 'CONFIG_DEFAULT',
    actor: 'system:binding-integrity',
    expectedAbsent: true,
    requireAutoFailoverEnabled: true,
  }).binding;
  clock.setNow(2000);
  repository.recordDetection({
    role: 'CHAT',
    expectedDesiredRevision: desired.bindingRevision,
    detectionOnly: true,
    requireAutoFailoverEnabled: true,
  });
  insertProof(db, {
    proofId: 'proof-application-fallback-0001',
    modelName: FALLBACK_MODEL,
    digestSha256: FALLBACK_DIGEST,
    expiresAtMs: proofExpiresAtMs,
  });
  clock.setNow(2100);
  const provider = createProvider([{
    name: FALLBACK_MODEL,
    canonicalName: canonicalModelName(FALLBACK_MODEL),
    digestSha256: FALLBACK_DIGEST,
  }]);
  const runtime = createRuntime();
  const notifications = [];
  const authority = new ModelUseAuthority();
  const mutationOwner = createModelBindingApplication({
    repository,
    runtime,
    provider,
    modelUseAuthority: authority,
    publishControl: payload => notifications.push(payload),
    scheduleRecovery: () => null,
    cancelRecovery: () => {},
  });
  const application = createModelFailoverApplication({
    repository,
    runtime,
    provider,
    mutationOwner,
    modelUseAuthority: authority,
    publishControl: payload => notifications.push(payload),
  });
  return {
    db,
    clock,
    repository,
    provider,
    runtime,
    mutationOwner,
    application,
    notifications,
  };
}

function closeContext(context) {
  context.db.close();
}

function captureAsync(callback) {
  return callback().then(
    () => { throw new Error('Expected callback to reject'); },
    error => error,
  );
}

suite('M1 automatic failover application — real runtime cutover');

await testAsync('activation changes runtime, keeps desired binding, and records direct finalization', async () => {
  const context = await createContext();
  try {
    context.clock.setNow(2200);
    const result = await context.application.runRole({ role: 'CHAT' });
    assertEqual(result.status, 'APPLIED');
    assertEqual(result.reason, 'ACTIVATE');
    assertEqual(context.runtime.snapshot('CHAT').modelName, FALLBACK_MODEL);
    assertEqual(context.repository.getDesired('CHAT').modelName, DESIRED_MODEL);
    assertEqual(context.repository.getState('CHAT').state, 'ACTIVATED');
    assertEqual(context.repository.getRuntimeFinalization(result.operationId).status, 'DIRECT_CONFIRMED');
    assertEqual(context.provider.effects.pull, 0);
    assertEqual(context.notifications.filter(event => event.action === 'model_changed').length, 1);

    const replay = await context.application.runRole({ role: 'CHAT' });
    assertEqual(replay.status, 'UNCHANGED');
    assertEqual(replay.reason, 'FALLBACK_ACTIVE_EXACT');
    assertEqual(context.runtime.effects.prepare, 1);
  } finally {
    closeContext(context);
  }
});

await testAsync('pre-terminal provider failure is audited and leaves runtime unchanged', async () => {
  const context = await createContext();
  try {
    context.provider.resolveExact = async () => {
      const error = new Error('provider unavailable');
      error.code = 'MODEL_BINDING_PROVIDER_UNAVAILABLE';
      throw error;
    };
    context.clock.setNow(2200);
    const error = await captureAsync(() => context.application.runRole({ role: 'CHAT' }));
    assertEqual(error.code, 'MODEL_BINDING_PROVIDER_UNAVAILABLE');
    assertEqual(context.runtime.snapshot('CHAT').modelName, DESIRED_MODEL);
    assertEqual(context.repository.getState('CHAT').state, 'FAILED');
    assertEqual(context.repository.getState('CHAT').failurePhase, 'PERSISTENCE');
    assertEqual(context.repository.listPendingRuntimeFinalizations().length, 0);
  } finally {
    closeContext(context);
  }
});

await testAsync('manual binding owner excludes failover before inventory or claim effects', async () => {
  const context = await createContext();
  try {
    let release;
    const held = context.mutationOwner.runExclusiveModelMutation(
      { kind: 'MODEL_DELETE' },
      () => new Promise(resolve => { release = resolve; }),
    );
    await Promise.resolve();
    const eventsBefore = context.db.prepare('SELECT COUNT(*) AS count FROM model_failover_events').get().count;
    const error = await captureAsync(() => context.application.runRole({ role: 'CHAT' }));
    assertEqual(error.code, 'MODEL_BINDING_APPLICATION_BUSY');
    assertEqual(context.provider.effects.listInstalled, 0);
    assertEqual(context.db.prepare('SELECT COUNT(*) AS count FROM model_failover_events').get().count, eventsBefore);
    release();
    await held;
  } finally {
    closeContext(context);
  }
});

await testAsync('commit failure leaves an honest UNKNOWN receipt gap that the next run recovers', async () => {
  const context = await createContext();
  try {
    context.runtime.failNextCommit();
    context.clock.setNow(2200);
    const error = await captureAsync(() => context.application.runRole({ role: 'CHAT' }));
    assert(error instanceof ModelFailoverApplicationError);
    assertEqual(error.code, 'MODEL_FAILOVER_RUNTIME_RECONCILIATION_REQUIRED');
    assertEqual(context.runtime.snapshot('CHAT').modelName, DESIRED_MODEL);
    const [pending] = context.repository.listPendingRuntimeFinalizations();
    assertEqual(pending.status, 'UNKNOWN');
    assertEqual(context.repository.getState('CHAT').state, 'ACTIVATED');

    context.clock.setNow(2300);
    const recovered = await context.application.runRole({ role: 'CHAT', startup: true });
    assertEqual(recovered.status, 'RECOVERED');
    assertEqual(context.runtime.snapshot('CHAT').modelName, FALLBACK_MODEL);
    assertEqual(context.repository.getRuntimeFinalization(pending.operationId).status, 'RECOVERED_OBSERVED');
  } finally {
    closeContext(context);
  }
});

await testAsync('exact desired return with a fresh proof restores without changing desired lineage', async () => {
  const context = await createContext();
  try {
    context.clock.setNow(2200);
    await context.application.runRole({ role: 'CHAT' });
    const desiredBefore = JSON.stringify(context.repository.getDesired('CHAT'));
    insertProof(context.db, {
      proofId: 'proof-application-desired-0001',
      modelName: DESIRED_MODEL,
      digestSha256: DESIRED_DIGEST,
      completedAtMs: 2250,
    });
    context.provider.setInventory([
      { name: DESIRED_MODEL, canonicalName: DESIRED_MODEL, digestSha256: DESIRED_DIGEST },
      { name: FALLBACK_MODEL, canonicalName: canonicalModelName(FALLBACK_MODEL), digestSha256: FALLBACK_DIGEST },
    ]);
    context.clock.setNow(2300);
    const restored = await context.application.runRole({ role: 'CHAT' });
    assertEqual(restored.reason, 'RESTORE');
    assertEqual(context.runtime.snapshot('CHAT').modelName, DESIRED_MODEL);
    assertEqual(context.repository.getState('CHAT').state, 'RESTORED');
    assertEqual(JSON.stringify(context.repository.getDesired('CHAT')), desiredBefore);
  } finally {
    closeContext(context);
  }
});

await testAsync('expiry keeps active fallback bound, notifies once, and blocks reapply', async () => {
  const context = await createContext({ proofExpiresAtMs: 2300 });
  try {
    context.clock.setNow(2200);
    await context.application.runRole({ role: 'CHAT' });
    context.clock.setNow(2300);
    const degraded = await context.application.runRole({ role: 'CHAT' });
    assertEqual(degraded.status, 'DEGRADED_PROOF_EXPIRED');
    assertEqual(context.runtime.snapshot('CHAT').modelName, FALLBACK_MODEL);
    assertEqual(context.notifications.filter(event => event.action === 'model_failover_degraded').length, 1);

    const repeated = await context.application.runRole({ role: 'CHAT' });
    assertEqual(repeated.status, 'DEGRADED_PROOF_EXPIRED');
    assertEqual(context.notifications.filter(event => event.action === 'model_failover_degraded').length, 1);
    const prepareBefore = context.runtime.effects.prepare;
    context.runtime.setModel(DESIRED_MODEL);
    const blocked = await context.application.runRole({ role: 'CHAT', startup: true });
    assertEqual(blocked.status, 'DEGRADED_PROOF_EXPIRED');
    assertEqual(context.runtime.effects.prepare, prepareBefore);
    assertEqual(context.repository.getState('CHAT').activeFailover, true);
  } finally {
    closeContext(context);
  }
});

summary();
