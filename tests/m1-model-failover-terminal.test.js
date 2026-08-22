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
  readModelAutomationPolicy,
  updateModelAutomationPolicy,
} from '../src/db/model-policy.js';
import {
  ModelFailoverRepositoryError,
  createModelFailoverRepository,
} from '../src/upgrade/model-failover.js';
import { getModelFailoverProofContract } from '../src/upgrade/model-failover-proof-policy.js';

const DESIRED_DIGEST = 'a'.repeat(64);
const FALLBACK_DIGEST = 'b'.repeat(64);
const SOURCE_REVISION = 'f'.repeat(40);
const ROLE_CONTRACT_SHA256 = getModelFailoverProofContract('CHAT').roleContractSha256;

function createRuntime(initialNow = 1000) {
  let now = initialNow;
  const counters = { event: 0, episode: 0, operation: 0, claimToken: 0 };
  return {
    setNow(value) {
      now = value;
    },
    options: {
      clock: () => now,
      ids: {
        event: () => `terminal-event-${++counters.event}`,
        episode: () => `terminal-episode-${++counters.episode}`,
        operation: () => `terminal-operation-${++counters.operation}`,
        claimToken: () => `terminal-claim-token-${++counters.claimToken}`,
      },
    },
  };
}

async function withRepository(callback) {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    await runMigrations(db);
    const runtime = createRuntime();
    const repository = createModelFailoverRepository(db, runtime.options);
    updateModelAutomationPolicy(db, {
      values: { autoFailoverEnabled: true },
      expectedRevision: 1,
      actor: 'user:terminal-test',
      source: POLICY_SOURCE.TYPED_ROUTE,
    });
    const desired = repository.observeDesiredBinding({
      role: 'CHAT',
      modelName: 'reasoner',
      digestSha256: DESIRED_DIGEST,
      source: 'CONFIG_DEFAULT',
      actor: 'system:binding-integrity',
      expectedAbsent: true,
      requireAutoFailoverEnabled: true,
    }).binding;
    runtime.setNow(2000);
    const detected = repository.recordDetection({
      role: 'CHAT',
      expectedDesiredRevision: desired.bindingRevision,
      detectionOnly: true,
      requireAutoFailoverEnabled: true,
    }).state;
    return await callback({ db, runtime, repository, desired, detected });
  } finally {
    db.close();
  }
}

function artifactHash(kind, proofId) {
  return createHash('sha256').update(`${kind}:${proofId}`).digest('hex');
}

function insertPassingProof(db, {
  proofId,
  validationRunId = `${proofId}-run`,
  modelName,
  canonicalName,
  digestSha256,
  completedAtMs = 2050,
  expiresAtMs = 900000,
  roleContractSha256 = ROLE_CONTRACT_SHA256,
} = {}) {
  const measurementHash = artifactHash('measurement', proofId);
  const acceptanceHash = artifactHash('acceptance', proofId);
  db.prepare(`
    INSERT INTO model_failover_proof_artifacts (
      artifact_sha256, kind, byte_length, source_revision, created_at_ms
    ) VALUES (?, 'MEASUREMENT', 100, ?, ?)
  `).run(measurementHash, SOURCE_REVISION, completedAtMs);
  db.prepare(`
    INSERT INTO model_failover_proof_artifacts (
      artifact_sha256, kind, byte_length, source_revision, created_at_ms
    ) VALUES (?, 'PARENT_ACCEPTANCE', 100, ?, ?)
  `).run(acceptanceHash, SOURCE_REVISION, completedAtMs);
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
    validationRunId,
    roleContractSha256,
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
    measurementHash,
    acceptanceHash,
    SOURCE_REVISION,
  );
  return proofId;
}

function claim(repository, state, kind, overrides = {}) {
  return repository.claimOperation({
    role: 'CHAT',
    episodeId: state.episodeId,
    expectedDesiredRevision: state.desiredRevision,
    expectedRowVersion: state.rowVersion,
    kind,
    leaseMs: 1000,
    requireAutoFailoverEnabled: kind !== 'RESTORE',
    ...overrides,
  });
}

function complete(repository, claimed, {
  kind = claimed.claim.kind,
  proofId,
  targetModelName,
  targetDigestSha256,
  overrides = {},
}) {
  return repository.completeOperation({
    role: 'CHAT',
    episodeId: claimed.state.episodeId,
    expectedDesiredRevision: claimed.state.desiredRevision,
    expectedRowVersion: claimed.state.rowVersion,
    operationId: claimed.claim.operationId,
    claimToken: claimed.claim.token,
    kind,
    proofId,
    roleContractSha256: ROLE_CONTRACT_SHA256,
    targetModelName,
    targetDigestSha256,
    ...overrides,
  });
}

function captureError(callback) {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error('Expected callback to throw');
}

function assertRepositoryError(error, code) {
  assert(error instanceof ModelFailoverRepositoryError, `Expected repository error, got ${error}`);
  assertEqual(error.code, code);
}

function snapshot(db) {
  return JSON.stringify({
    state: db.prepare('SELECT * FROM model_failover_state ORDER BY role').all(),
    events: db.prepare('SELECT * FROM model_failover_events ORDER BY seq').all(),
  });
}

async function activateFallback(context, proofId = 'proof-terminal-fallback-0001') {
  insertPassingProof(context.db, {
    proofId,
    modelName: 'fallback:latest',
    canonicalName: 'fallback',
    digestSha256: FALLBACK_DIGEST,
  });
  context.runtime.setNow(2100);
  const eligible = context.repository.listEligibleProofs({
    role: 'CHAT',
    roleContractSha256: ROLE_CONTRACT_SHA256,
  });
  assertEqual(eligible.length, 1);
  assertEqual(eligible[0].proofId, proofId);
  const claimed = claim(context.repository, context.detected, 'ACTIVATE');
  context.runtime.setNow(2200);
  const activated = complete(context.repository, claimed, {
    proofId,
    targetModelName: 'fallback:latest',
    targetDigestSha256: FALLBACK_DIGEST,
  });
  return { claimed, activated, proofId };
}

suite('M1 model failover terminal repository — proof and claim CAS');

await testAsync('fresh artifact-bound proof activates once and exact replay is idempotent', async () => {
  await withRepository(async context => {
    const { claimed, activated, proofId } = await activateFallback(context);
    assertEqual(activated.outcome, 'COMPLETED');
    assertEqual(activated.event.eventType, 'ACTIVATED');
    assertEqual(activated.event.verified, true);
    assertEqual(activated.state.state, 'ACTIVATED');
    assertEqual(activated.state.activeFailover, true);
    assertEqual(activated.state.fallbackModelName, 'fallback:latest');
    assertEqual(activated.state.fallbackDigestSha256, FALLBACK_DIGEST);
    assertEqual(activated.state.proofId, proofId);
    assertEqual(activated.state.claimPresent, false);

    const replay = complete(context.repository, claimed, {
      proofId,
      targetModelName: 'fallback:latest',
      targetDigestSha256: FALLBACK_DIGEST,
    });
    assertEqual(replay.outcome, 'ALREADY_COMPLETED');
    assertEqual(
      context.db.prepare("SELECT COUNT(*) AS count FROM model_failover_events WHERE event_type = 'ACTIVATED'").get().count,
      1,
    );
  });
});

await testAsync('proof expiry equality and contract drift fail with zero terminal mutation', async () => {
  await withRepository(async context => {
    const expiresAtMs = 3000;
    const proofId = insertPassingProof(context.db, {
      proofId: 'proof-terminal-expiry-0001',
      modelName: 'fallback:latest',
      canonicalName: 'fallback',
      digestSha256: FALLBACK_DIGEST,
      expiresAtMs,
    });
    context.runtime.setNow(2100);
    const claimed = claim(context.repository, context.detected, 'ACTIVATE', { leaseMs: 2000 });
    context.runtime.setNow(expiresAtMs);
    const before = snapshot(context.db);
    assertEqual(context.repository.listEligibleProofs({
      role: 'CHAT',
      roleContractSha256: ROLE_CONTRACT_SHA256,
    }).length, 0);
    assertRepositoryError(captureError(() => complete(context.repository, claimed, {
      proofId,
      targetModelName: 'fallback:latest',
      targetDigestSha256: FALLBACK_DIGEST,
    })), 'MODEL_FAILOVER_PROOF_INELIGIBLE');
    assertEqual(snapshot(context.db), before);

    context.runtime.setNow(2900);
    assertRepositoryError(captureError(() => complete(context.repository, claimed, {
      proofId,
      targetModelName: 'fallback:latest',
      targetDigestSha256: FALLBACK_DIGEST,
      overrides: { roleContractSha256: 'c'.repeat(64) },
    })), 'MODEL_FAILOVER_PROOF_INELIGIBLE');
    assertEqual(snapshot(context.db), before);
  });
});

await testAsync('policy disable after claim blocks activation but audited failure releases it', async () => {
  await withRepository(async context => {
    const proofId = insertPassingProof(context.db, {
      proofId: 'proof-terminal-policy-off-0001',
      modelName: 'fallback:latest',
      canonicalName: 'fallback',
      digestSha256: FALLBACK_DIGEST,
    });
    context.runtime.setNow(2100);
    const claimed = claim(context.repository, context.detected, 'ACTIVATE');
    const currentPolicy = readModelAutomationPolicy(context.db);
    updateModelAutomationPolicy(context.db, {
      values: { autoFailoverEnabled: false },
      expectedRevision: currentPolicy.revision,
      actor: 'user:terminal-test',
      source: POLICY_SOURCE.TYPED_ROUTE,
    });
    context.runtime.setNow(2200);
    assertRepositoryError(captureError(() => complete(context.repository, claimed, {
      proofId,
      targetModelName: 'fallback:latest',
      targetDigestSha256: FALLBACK_DIGEST,
    })), 'MODEL_FAILOVER_AUTO_FAILOVER_DISABLED');
    const failed = context.repository.failOperation({
      role: 'CHAT',
      episodeId: claimed.state.episodeId,
      expectedDesiredRevision: claimed.state.desiredRevision,
      expectedRowVersion: claimed.state.rowVersion,
      operationId: claimed.claim.operationId,
      claimToken: claimed.claim.token,
      kind: 'ACTIVATE',
      failurePhase: 'VERIFICATION',
    });
    assertEqual(failed.state.state, 'FAILED');
    assertEqual(failed.state.activeFailover, false);
    assertEqual(failed.state.failurePhase, 'VERIFICATION');
    assertEqual(failed.state.claimPresent, false);
  });
});

await testAsync('active fallback reapply stays active and rotates its proof root', async () => {
  await withRepository(async context => {
    const activated = await activateFallback(context);
    context.runtime.setNow(2300);
    const secondProofId = insertPassingProof(context.db, {
      proofId: 'proof-terminal-fallback-0002',
      modelName: 'fallback:latest',
      canonicalName: 'fallback',
      digestSha256: FALLBACK_DIGEST,
      completedAtMs: 2250,
    });
    const reapplyClaim = claim(context.repository, activated.activated.state, 'REAPPLY');
    context.runtime.setNow(2400);
    const reapplied = complete(context.repository, reapplyClaim, {
      proofId: secondProofId,
      targetModelName: 'fallback:latest',
      targetDigestSha256: FALLBACK_DIGEST,
    });
    assertEqual(reapplied.event.eventType, 'REAPPLIED');
    assertEqual(reapplied.state.state, 'ACTIVATED');
    assertEqual(reapplied.state.activeFailover, true);
    assertEqual(reapplied.state.proofId, secondProofId);
    assertEqual(reapplied.state.activatedAtMs, activated.activated.state.activatedAtMs);
  });
});

await testAsync('restore needs a fresh desired proof while restore failure keeps fallback active', async () => {
  await withRepository(async context => {
    const activated = await activateFallback(context);
    context.runtime.setNow(2300);
    const failedClaim = claim(context.repository, activated.activated.state, 'RESTORE');
    context.runtime.setNow(2400);
    const failed = context.repository.failOperation({
      role: 'CHAT',
      episodeId: failedClaim.state.episodeId,
      expectedDesiredRevision: failedClaim.state.desiredRevision,
      expectedRowVersion: failedClaim.state.rowVersion,
      operationId: failedClaim.claim.operationId,
      claimToken: failedClaim.claim.token,
      kind: 'RESTORE',
      failurePhase: 'RESTORE',
    });
    assertEqual(failed.event.eventType, 'RESTORE_FAILED');
    assertEqual(failed.state.state, 'ACTIVATED');
    assertEqual(failed.state.activeFailover, true);
    assertEqual(failed.state.claimPresent, false);

    const desiredProofId = insertPassingProof(context.db, {
      proofId: 'proof-terminal-desired-0001',
      modelName: 'reasoner',
      canonicalName: 'reasoner',
      digestSha256: DESIRED_DIGEST,
      completedAtMs: 2450,
    });
    context.runtime.setNow(2500);
    const restoreClaim = claim(context.repository, failed.state, 'RESTORE');
    context.runtime.setNow(2600);
    const restored = complete(context.repository, restoreClaim, {
      proofId: desiredProofId,
      targetModelName: 'reasoner',
      targetDigestSha256: DESIRED_DIGEST,
    });
    assertEqual(restored.event.eventType, 'RESTORED');
    assertEqual(restored.event.proofId, desiredProofId);
    assertEqual(restored.state.state, 'RESTORED');
    assertEqual(restored.state.activeFailover, false);
    assertEqual(restored.state.resolvedAtMs, 2600);
  });
});

summary();
