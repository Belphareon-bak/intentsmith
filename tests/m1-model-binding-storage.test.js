#!/usr/bin/env node

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';

import {
  assert,
  assertEqual,
  assertThrows,
  suite,
  summary,
  testAsync,
} from './harness.js';
import { runMigrations } from '../src/db/migrate.js';
import { up as installBindingOperationJournal } from '../src/db/migrations/2026_08_08_048_model_binding_operations.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const CONTRACT_DIGEST = 'c'.repeat(64);
const POLICY_VERSION = 'd-plus-v1';

function assertThrowsMatching(callback, pattern) {
  const error = assertThrows(callback);
  assert(pattern.test(error.message), `Expected "${error.message}" to match ${pattern}`);
  return error;
}

async function withMigratedDb(callback) {
  const directory = mkdtempSync(
    path.join(process.env.INTENTSMITH_TEST_ARTIFACT_DIR, 'model-binding-storage-'),
  );
  const databasePath = path.join(directory, 'binding.sqlite');
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  try {
    await runMigrations(db);
    return await callback(db);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: false });
  }
}

function insertBaseline(db, {
  role = 'CHAT',
  eventId = 'event-baseline-observed',
  modelName = 'base:latest',
  canonicalName = 'base',
  digestSha256 = DIGEST_A,
  revision = 1,
  createdAtMs = 1000,
} = {}) {
  db.prepare(`
    INSERT INTO model_failover_events (
      event_id, event_type, role, binding_revision, actor, reason_code,
      policy_version, desired_model_name, desired_digest_sha256, created_at_ms
    ) VALUES (?, 'DESIRED_OBSERVED', ?, ?, 'user:fixture',
      'DESIRED_ARTIFACT_OBSERVED', ?, ?, ?, ?)
  `).run(
    eventId,
    role,
    revision,
    POLICY_VERSION,
    modelName,
    digestSha256,
    createdAtMs,
  );
  db.prepare(`
    INSERT INTO model_desired_bindings (
      role, model_name, canonical_name, digest_sha256, binding_revision,
      source, actor, observed_at_ms, updated_at_ms, last_event_id
    ) VALUES (?, ?, ?, ?, ?, 'LEGACY_OVERRIDE', 'user:fixture', ?, ?, ?)
  `).run(
    role,
    modelName,
    canonicalName,
    digestSha256,
    revision,
    createdAtMs,
    createdAtMs,
    eventId,
  );
}

function insertManualEvent(db, {
  eventId,
  operationId,
  kind,
  role = 'CHAT',
  revision,
  targetModelName,
  targetDigestSha256,
  actor = 'user:fixture',
  rowVersion = null,
  episodeId = null,
  detailsJson = '{}',
  createdAtMs,
} = {}) {
  const reasonCode = kind === 'USER_APPLY'
    ? 'USER_MODEL_BINDING_APPLIED'
    : 'USER_MODEL_BINDING_ROLLED_BACK';
  db.prepare(`
    INSERT INTO model_failover_events (
      event_id, event_type, role, binding_revision, row_version, episode_id,
      operation_id, actor,
      reason_code, policy_version, desired_model_name, desired_digest_sha256,
      verified, details_json, created_at_ms
    ) VALUES (?, 'DESIRED_CHANGED', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    eventId,
    role,
    revision,
    rowVersion,
    episodeId,
    operationId,
    actor,
    reasonCode,
    POLICY_VERSION,
    targetModelName,
    targetDigestSha256,
    detailsJson,
    createdAtMs,
  );
}

function insertOperation(db, {
  operationId,
  requestKey,
  kind,
  role = 'CHAT',
  expectedRevision,
  committedRevision = expectedRevision + 1,
  previousModelName,
  previousCanonicalName,
  previousDigestSha256,
  targetModelName,
  targetCanonicalName,
  targetDigestSha256,
  predecessorOperationId = null,
  rollbackOfOperationId = null,
  verificationStatus = 'NOT_VERIFIED',
  runtimeStatus = 'NOT_APPLIED',
  desiredEventId,
  actor = 'user:fixture',
  createdAtMs,
} = {}) {
  const reasonCode = kind === 'USER_APPLY'
    ? 'USER_MODEL_BINDING_APPLIED'
    : 'USER_MODEL_BINDING_ROLLED_BACK';
  return db.prepare(`
    INSERT INTO model_binding_operations (
      operation_id, request_key, role, operation_kind,
      expected_binding_revision, committed_binding_revision,
      previous_model_name, previous_canonical_name, previous_digest_sha256,
      target_model_name, target_canonical_name, target_digest_sha256,
      predecessor_operation_id, rollback_of_operation_id,
      verification_status, runtime_status, desired_event_id, actor,
      reason_code, policy_version, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    operationId,
    requestKey,
    role,
    kind,
    expectedRevision,
    committedRevision,
    previousModelName,
    previousCanonicalName,
    previousDigestSha256,
    targetModelName,
    targetCanonicalName,
    targetDigestSha256,
    predecessorOperationId,
    rollbackOfOperationId,
    verificationStatus,
    runtimeStatus,
    desiredEventId,
    actor,
    reasonCode,
    POLICY_VERSION,
    createdAtMs,
  );
}

function updateProjection(db, {
  role = 'CHAT',
  kind,
  expectedRevision,
  committedRevision = expectedRevision + 1,
  targetModelName,
  targetCanonicalName,
  targetDigestSha256,
  desiredEventId,
  actor = 'user:fixture',
  createdAtMs,
} = {}) {
  return db.prepare(`
    UPDATE model_desired_bindings
    SET model_name = ?, canonical_name = ?, digest_sha256 = ?,
        binding_revision = ?, source = ?, actor = ?, observed_at_ms = ?,
        updated_at_ms = ?, last_event_id = ?
    WHERE role = ? AND binding_revision = ?
  `).run(
    targetModelName,
    targetCanonicalName,
    targetDigestSha256,
    committedRevision,
    kind,
    actor,
    createdAtMs,
    createdAtMs,
    desiredEventId,
    role,
    expectedRevision,
  );
}

function recordApply(db, {
  operationId = 'operation-user-apply-0001',
  requestKey = 'request-user-apply-0001',
  eventId = 'event-user-apply-0001',
  createdAtMs = 2000,
} = {}) {
  const input = {
    operationId,
    requestKey,
    kind: 'USER_APPLY',
    expectedRevision: 1,
    previousModelName: 'base:latest',
    previousCanonicalName: 'base',
    previousDigestSha256: DIGEST_A,
    targetModelName: 'candidate:latest',
    targetCanonicalName: 'candidate',
    targetDigestSha256: DIGEST_B,
    desiredEventId: eventId,
    createdAtMs,
  };
  insertManualEvent(db, {
    eventId,
    operationId,
    kind: input.kind,
    revision: 2,
    targetModelName: input.targetModelName,
    targetDigestSha256: input.targetDigestSha256,
    createdAtMs,
  });
  insertOperation(db, input);
  const update = updateProjection(db, input);
  assertEqual(update.changes, 1);
  return input;
}

function insertDetectedIncident(db) {
  db.prepare(`
    INSERT INTO model_failover_events (
      event_id, event_type, role, binding_revision, row_version, episode_id,
      actor, reason_code, policy_version, state_after, desired_model_name,
      desired_digest_sha256, created_at_ms
    ) VALUES ('event-incident-detected', 'DETECTED', 'CHAT', 1, 1,
      'episode-incident-0001', 'system:binding-integrity',
      'BOUND_MODEL_NOT_INSTALLED', ?, 'DETECTED', 'base:latest', ?, 4000)
  `).run(POLICY_VERSION, DIGEST_A);
  db.prepare(`
    INSERT INTO model_failover_state (
      role, desired_revision, episode_id, state, active_failover,
      policy_version, actor, reason_code, row_version, detected_at_ms,
      updated_at_ms, last_event_id
    ) VALUES ('CHAT', 1, 'episode-incident-0001', 'DETECTED', 0, ?,
      'system:binding-integrity', 'BOUND_MODEL_NOT_INSTALLED', 1, 4000, 4000,
      'event-incident-detected')
  `).run(POLICY_VERSION);
}

function claimDetectedIncident(db) {
  db.prepare(`
    INSERT INTO model_failover_events (
      event_id, event_type, role, binding_revision, row_version, episode_id,
      operation_id, actor, reason_code, policy_version, state_before,
      state_after, desired_model_name, desired_digest_sha256, created_at_ms
    ) VALUES ('event-incident-claimed', 'ACTIVATION_CLAIMED', 'CHAT', 1, 2,
      'episode-incident-0001', 'operation-incident-activate-0001',
      'system:binding-integrity', 'FAILOVER_OPERATION_CLAIMED', ?,
      'DETECTED', 'DETECTED', 'base:latest', ?, 4100)
  `).run(POLICY_VERSION, DIGEST_A);
  db.prepare(`
    UPDATE model_failover_state
    SET row_version = 2,
        claim_operation_id = 'operation-incident-activate-0001',
        claim_token = 'claim-token-incident-0001', claim_kind = 'ACTIVATE',
        claim_started_at_ms = 4100, claim_expires_at_ms = 5100,
        updated_at_ms = 4100, last_event_id = 'event-incident-claimed'
    WHERE role = 'CHAT'
  `).run();
}

function activateClaimedIncident(db) {
  db.prepare(`
    INSERT INTO model_failover_proofs (
      proof_id, validation_run_id, role, suite, role_contract_sha256,
      model_name, model_canonical_name, model_digest_sha256,
      validation_version, policy_version, score, required_score, passed_count,
      required_passed_count, total_count, duration_ms, result,
      inventory_before_name, inventory_before_digest, inventory_after_name,
      inventory_after_digest, started_at_ms, completed_at_ms, expires_at_ms,
      created_at_ms
    ) VALUES ('proof-incident-0001', 'validation-incident-0001', 'CHAT', 'chat', ?,
      'fallback:latest', 'fallback', ?, 'v123.1', ?, 1, 0.8, 6, 5, 6, 500,
      'PASS', 'fallback:latest', ?, 'fallback:latest', ?, 4200, 4700, 900000,
      4700)
  `).run(CONTRACT_DIGEST, DIGEST_B, POLICY_VERSION, DIGEST_B, DIGEST_B);
  db.prepare(`
    INSERT INTO model_failover_events (
      event_id, event_type, role, binding_revision, row_version, episode_id,
      operation_id, actor, reason_code, policy_version, state_before,
      state_after, desired_model_name, desired_digest_sha256,
      fallback_model_name, fallback_canonical_name, fallback_digest_sha256,
      proof_id, verified, created_at_ms
    ) VALUES ('event-incident-activated', 'ACTIVATED', 'CHAT', 1, 3,
      'episode-incident-0001', 'operation-incident-activate-0001',
      'system:binding-integrity', 'LOCAL_FAILOVER_ACTIVATED', ?, 'DETECTED',
      'ACTIVATED', 'base:latest', ?, 'fallback:latest', 'fallback', ?,
      'proof-incident-0001', 1, 4800)
  `).run(POLICY_VERSION, DIGEST_A, DIGEST_B);
  db.prepare(`
    UPDATE model_failover_state
    SET state = 'ACTIVATED', active_failover = 1,
        fallback_model_name = 'fallback:latest',
        fallback_canonical_name = 'fallback', fallback_digest_sha256 = ?,
        proof_id = 'proof-incident-0001',
        active_event_id = 'event-incident-activated', proof_verified_at_ms = 4800,
        activated_at_ms = 4800, updated_at_ms = 4800, row_version = 3,
        claim_operation_id = NULL, claim_token = NULL, claim_kind = NULL,
        claim_started_at_ms = NULL, claim_expires_at_ms = NULL,
        last_event_id = 'event-incident-activated'
    WHERE role = 'CHAT'
  `).run(DIGEST_B);
}

function assertManualOperationBlockedByIncident(db, suffix) {
  const eventId = `event-incident-manual-${suffix}`;
  const operationId = `operation-incident-manual-${suffix}`;
  insertManualEvent(db, {
    eventId,
    operationId,
    kind: 'USER_APPLY',
    revision: 2,
    targetModelName: 'candidate:latest',
    targetDigestSha256: DIGEST_B,
    createdAtMs: 6000,
  });
  assertThrowsMatching(() => insertOperation(db, {
    operationId,
    requestKey: `request-incident-manual-${suffix}`,
    kind: 'USER_APPLY',
    expectedRevision: 1,
    previousModelName: 'base:latest',
    previousCanonicalName: 'base',
    previousDigestSha256: DIGEST_A,
    targetModelName: 'candidate:latest',
    targetCanonicalName: 'candidate',
    targetDigestSha256: DIGEST_B,
    desiredEventId: eventId,
    createdAtMs: 6000,
  }), /atomic incident supersede seam/i);
  assertEqual(db.prepare('SELECT COUNT(*) AS count FROM model_binding_operations').get().count, 0);
  assertEqual(
    db.prepare("SELECT binding_revision FROM model_desired_bindings WHERE role = 'CHAT'").get()
      .binding_revision,
    1,
  );
}

suite('M1 manual model binding storage — append-only unverified lineage');

await testAsync('migration creates the exact manual operation journal contract', async () => {
  await withMigratedDb(async db => {
    const columns = db.prepare('PRAGMA table_info(model_binding_operations)').all();
    assertEqual(JSON.stringify(columns.map(column => column.name)), JSON.stringify([
      'operation_id',
      'request_key',
      'role',
      'operation_kind',
      'expected_binding_revision',
      'committed_binding_revision',
      'previous_model_name',
      'previous_canonical_name',
      'previous_digest_sha256',
      'target_model_name',
      'target_canonical_name',
      'target_digest_sha256',
      'predecessor_operation_id',
      'rollback_of_operation_id',
      'verification_status',
      'runtime_status',
      'desired_event_id',
      'actor',
      'reason_code',
      'policy_version',
      'details_json',
      'created_at_ms',
    ]));
    assertEqual(
      columns.find(column => column.name === 'verification_status').dflt_value,
      "'NOT_VERIFIED'",
    );
    assertEqual(
      columns.find(column => column.name === 'runtime_status').dflt_value,
      "'NOT_APPLIED'",
    );
    assertEqual(columns.some(column => column.name === 'proof_id'), false);
    const indexes = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'index' AND tbl_name = 'model_binding_operations'
      ORDER BY name
    `).all().map(row => row.name);
    assert(indexes.includes('idx_model_binding_operations_one_rollback'));
    assert(indexes.includes('idx_model_binding_operations_role_revision'));
    const triggers = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name LIKE 'trg_model_binding_operations_%'
      ORDER BY name
    `).all().map(row => row.name);
    assertEqual(triggers.length, 8);
  });
});

await testAsync('migration rejects pre-existing manual projections without provenance', async () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE model_desired_bindings (role TEXT NOT NULL, source TEXT NOT NULL);
      INSERT INTO model_desired_bindings (role, source) VALUES ('CHAT', 'USER_APPLY');
    `);
    assertThrowsMatching(
      () => installBindingOperationJournal(db),
      /manual desired binding CHAT\/USER_APPLY lacks operation lineage/i,
    );
    assertEqual(
      db.prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name = 'model_binding_operations'
      `).get().count,
      0,
    );
  } finally {
    db.close();
  }

  const collisionDb = new Database(':memory:');
  try {
    collisionDb.exec(`
      CREATE TABLE model_desired_bindings (role TEXT NOT NULL, source TEXT NOT NULL);
      CREATE TABLE model_binding_operations (operation_id TEXT PRIMARY KEY);
    `);
    assertThrowsMatching(
      () => installBindingOperationJournal(collisionDb),
      /pre-exists its migration authority/i,
    );
  } finally {
    collisionDb.close();
  }
});

await testAsync('USER_APPLY and USER_ROLLBACK append exact lineage without legacy effects', async () => {
  await withMigratedDb(async db => {
    insertBaseline(db);
    const apply = db.transaction(() => recordApply(db));
    const applyInput = apply.immediate();

    const rollbackInput = {
      operationId: 'operation-user-rollback-0001',
      requestKey: 'request-user-rollback-0001',
      kind: 'USER_ROLLBACK',
      expectedRevision: 2,
      previousModelName: applyInput.targetModelName,
      previousCanonicalName: applyInput.targetCanonicalName,
      previousDigestSha256: applyInput.targetDigestSha256,
      targetModelName: applyInput.previousModelName,
      targetCanonicalName: applyInput.previousCanonicalName,
      targetDigestSha256: applyInput.previousDigestSha256,
      predecessorOperationId: applyInput.operationId,
      rollbackOfOperationId: applyInput.operationId,
      desiredEventId: 'event-user-rollback-0001',
      createdAtMs: 3000,
    };
    const rollback = db.transaction(() => {
      insertManualEvent(db, {
        eventId: rollbackInput.desiredEventId,
        operationId: rollbackInput.operationId,
        kind: rollbackInput.kind,
        revision: 3,
        targetModelName: rollbackInput.targetModelName,
        targetDigestSha256: rollbackInput.targetDigestSha256,
        createdAtMs: rollbackInput.createdAtMs,
      });
      insertOperation(db, rollbackInput);
      assertEqual(updateProjection(db, rollbackInput).changes, 1);
    });
    rollback.immediate();

    const operations = db.prepare(`
      SELECT operation_id, operation_kind, expected_binding_revision,
        committed_binding_revision, rollback_of_operation_id,
        verification_status, runtime_status
      FROM model_binding_operations
      ORDER BY committed_binding_revision
    `).all();
    assertEqual(operations.length, 2);
    assertEqual(operations[0].operation_id, applyInput.operationId);
    assertEqual(operations[1].rollback_of_operation_id, applyInput.operationId);
    assertEqual(operations[1].verification_status, 'NOT_VERIFIED');
    assertEqual(operations[1].runtime_status, 'NOT_APPLIED');
    const desired = db.prepare('SELECT * FROM model_desired_bindings WHERE role = ?').get('CHAT');
    assertEqual(desired.binding_revision, 3);
    assertEqual(desired.model_name, 'base:latest');
    assertEqual(desired.source, 'USER_ROLLBACK');
    assertEqual(db.prepare('SELECT COUNT(*) AS count FROM model_overrides').get().count, 0);
    assertEqual(db.prepare('SELECT COUNT(*) AS count FROM upgrade_history').get().count, 0);
  });
});

await testAsync('manual desired projection cannot bypass its operation journal', async () => {
  await withMigratedDb(async db => {
    insertBaseline(db);
    insertManualEvent(db, {
      eventId: 'event-unbacked-apply',
      operationId: 'operation-unbacked-apply',
      kind: 'USER_APPLY',
      revision: 2,
      targetModelName: 'candidate:latest',
      targetDigestSha256: DIGEST_B,
      createdAtMs: 2000,
    });
    assertThrowsMatching(() => updateProjection(db, {
      kind: 'USER_APPLY',
      expectedRevision: 1,
      targetModelName: 'candidate:latest',
      targetCanonicalName: 'candidate',
      targetDigestSha256: DIGEST_B,
      desiredEventId: 'event-unbacked-apply',
      createdAtMs: 2000,
    }), /matching binding operation/i);
    assertEqual(
      db.prepare('SELECT binding_revision FROM model_desired_bindings WHERE role = ?').get('CHAT')
        .binding_revision,
      1,
    );
  });
});

await testAsync('manual projection rejects stale replay, source escape and deletion', async () => {
  await withMigratedDb(async db => {
    insertBaseline(db);
    const first = db.transaction(() => recordApply(db)).immediate();
    const second = {
      operationId: 'operation-user-apply-replay-0002',
      requestKey: 'request-user-apply-replay-0002',
      kind: 'USER_APPLY',
      expectedRevision: 2,
      previousModelName: first.targetModelName,
      previousCanonicalName: first.targetCanonicalName,
      previousDigestSha256: first.targetDigestSha256,
      targetModelName: 'candidate-v2:latest',
      targetCanonicalName: 'candidate-v2',
      targetDigestSha256: DIGEST_A,
      predecessorOperationId: first.operationId,
      desiredEventId: 'event-user-apply-replay-0002',
      createdAtMs: 3000,
    };
    const secondTransaction = db.transaction(() => {
      insertManualEvent(db, {
        eventId: second.desiredEventId,
        operationId: second.operationId,
        kind: second.kind,
        revision: 3,
        targetModelName: second.targetModelName,
        targetDigestSha256: second.targetDigestSha256,
        createdAtMs: second.createdAtMs,
      });
      insertOperation(db, second);
      assertEqual(updateProjection(db, second).changes, 1);
    });
    secondTransaction.immediate();

    assertThrowsMatching(() => db.prepare(`
      UPDATE model_desired_bindings
      SET model_name = ?, canonical_name = ?, digest_sha256 = ?,
          binding_revision = 2, source = 'USER_APPLY', actor = 'user:fixture',
          observed_at_ms = 2000, updated_at_ms = 2000,
          last_event_id = 'event-user-apply-0001'
      WHERE role = 'CHAT'
    `).run(
      first.targetModelName,
      first.targetCanonicalName,
      first.targetDigestSha256,
    ), /matching binding operation/i);
    assertThrowsMatching(() => db.prepare(`
      UPDATE model_desired_bindings
      SET source = 'LEGACY_OVERRIDE'
      WHERE role = 'CHAT'
    `).run(), /cannot leave operation authority/i);
    assertThrowsMatching(() => db.prepare(`
      DELETE FROM model_desired_bindings WHERE role = 'CHAT'
    `).run(), /cannot be deleted without reconciliation/i);

    db.prepare(`
      INSERT INTO model_failover_events (
        event_id, event_type, role, binding_revision, actor, reason_code,
        policy_version, desired_model_name, desired_digest_sha256, created_at_ms
      ) VALUES ('event-replace-manual-with-legacy', 'DESIRED_CHANGED', 'CHAT', 4,
        'user:fixture', 'LEGACY_REPLACEMENT_ATTEMPT', ?, 'rogue:latest', ?, 4000)
    `).run(POLICY_VERSION, DIGEST_B);
    const beforeReplace = db.prepare(`
      SELECT * FROM model_desired_bindings WHERE role = 'CHAT'
    `).get();
    assertEqual(db.pragma('recursive_triggers', { simple: true }), 0);
    assertThrowsMatching(() => db.prepare(`
      INSERT OR REPLACE INTO model_desired_bindings (
        role, model_name, canonical_name, digest_sha256, binding_revision,
        source, actor, observed_at_ms, updated_at_ms, last_event_id
      ) VALUES ('CHAT', 'rogue:latest', 'rogue', ?, 4, 'LEGACY_OVERRIDE',
        'user:fixture', 4000, 4000, 'event-replace-manual-with-legacy')
    `).run(DIGEST_B), /cannot be replaced without reconciliation/i);
    assertEqual(
      JSON.stringify(db.prepare(`
        SELECT * FROM model_desired_bindings WHERE role = 'CHAT'
      `).get()),
      JSON.stringify(beforeReplace),
    );

    const desired = db.prepare(`
      SELECT model_name, binding_revision, source
      FROM model_desired_bindings WHERE role = 'CHAT'
    `).get();
    assertEqual(desired.model_name, second.targetModelName);
    assertEqual(desired.binding_revision, 3);
    assertEqual(desired.source, 'USER_APPLY');
  });
});

await testAsync('manual operation rejects incident-shaped audit metadata', async () => {
  await withMigratedDb(async db => {
    insertBaseline(db);
    for (const [suffix, eventOverrides] of [
      ['row-version', { rowVersion: 1 }],
      ['episode', { episodeId: 'episode-false-manual-0001' }],
      ['details', { detailsJson: '{"claim":"false"}' }],
    ]) {
      const operationId = `operation-invalid-metadata-${suffix}`;
      const eventId = `event-invalid-metadata-${suffix}`;
      insertManualEvent(db, {
        eventId,
        operationId,
        kind: 'USER_APPLY',
        revision: 2,
        targetModelName: 'candidate:latest',
        targetDigestSha256: DIGEST_B,
        createdAtMs: 2000,
        ...eventOverrides,
      });
      assertThrowsMatching(() => insertOperation(db, {
        operationId,
        requestKey: `request-invalid-metadata-${suffix}`,
        kind: 'USER_APPLY',
        expectedRevision: 1,
        previousModelName: 'base:latest',
        previousCanonicalName: 'base',
        previousDigestSha256: DIGEST_A,
        targetModelName: 'candidate:latest',
        targetCanonicalName: 'candidate',
        targetDigestSha256: DIGEST_B,
        desiredEventId: eventId,
        createdAtMs: 2000,
      }), /matching unverified audit event/i);
    }
    assertEqual(db.prepare('SELECT COUNT(*) AS count FROM model_binding_operations').get().count, 0);
  });
});

await testAsync('manual operation fails closed for detected, claimed and activated incidents', async () => {
  for (const variant of ['detected', 'claimed', 'activated']) {
    await withMigratedDb(async db => {
      insertBaseline(db);
      insertDetectedIncident(db);
      if (variant !== 'detected') claimDetectedIncident(db);
      if (variant === 'activated') activateClaimedIncident(db);
      assertManualOperationBlockedByIncident(db, variant);
    });
  }
});

await testAsync('journal rejects verification claims, runtime claims and mismatched authority', async () => {
  await withMigratedDb(async db => {
    insertBaseline(db);
    const baseInput = {
      operationId: 'operation-invalid-authority-0001',
      requestKey: 'request-invalid-authority-0001',
      kind: 'USER_APPLY',
      expectedRevision: 1,
      previousModelName: 'base:latest',
      previousCanonicalName: 'base',
      previousDigestSha256: DIGEST_A,
      targetModelName: 'candidate:latest',
      targetCanonicalName: 'candidate',
      targetDigestSha256: DIGEST_B,
      desiredEventId: 'event-invalid-authority-0001',
      createdAtMs: 2000,
    };
    insertManualEvent(db, {
      eventId: baseInput.desiredEventId,
      operationId: baseInput.operationId,
      kind: baseInput.kind,
      revision: 2,
      targetModelName: baseInput.targetModelName,
      targetDigestSha256: baseInput.targetDigestSha256,
      createdAtMs: baseInput.createdAtMs,
    });
    assertThrowsMatching(
      () => insertOperation(db, { ...baseInput, verificationStatus: 'VERIFIED' }),
      /verification_status/i,
    );
    assertThrowsMatching(
      () => insertOperation(db, { ...baseInput, runtimeStatus: 'APPLIED' }),
      /runtime_status/i,
    );
    assertThrowsMatching(
      () => insertOperation(db, { ...baseInput, previousDigestSha256: DIGEST_B }),
      /current desired projection/i,
    );
    assertThrowsMatching(
      () => insertOperation(db, { ...baseInput, targetDigestSha256: DIGEST_A }),
      /matching unverified audit event/i,
    );
    const noOp = {
      ...baseInput,
      operationId: 'operation-invalid-noop-0001',
      requestKey: 'request-invalid-noop-0001',
      targetModelName: baseInput.previousModelName,
      targetCanonicalName: baseInput.previousCanonicalName,
      targetDigestSha256: baseInput.previousDigestSha256,
      desiredEventId: 'event-invalid-noop-0001',
    };
    insertManualEvent(db, {
      eventId: noOp.desiredEventId,
      operationId: noOp.operationId,
      kind: noOp.kind,
      revision: 2,
      targetModelName: noOp.targetModelName,
      targetDigestSha256: noOp.targetDigestSha256,
      createdAtMs: noOp.createdAtMs,
    });
    assertThrowsMatching(
      () => insertOperation(db, noOp),
      /previous_model_name <> target_model_name/i,
    );
    assertEqual(db.prepare('SELECT COUNT(*) AS count FROM model_binding_operations').get().count, 0);
  });
});

await testAsync('rollback must be one exact direct reversal and can happen only once', async () => {
  await withMigratedDb(async db => {
    insertBaseline(db);
    const applyInput = db.transaction(() => recordApply(db)).immediate();
    const rollbackBase = {
      operationId: 'operation-rollback-exact-0001',
      requestKey: 'request-rollback-exact-0001',
      kind: 'USER_ROLLBACK',
      expectedRevision: 2,
      previousModelName: applyInput.targetModelName,
      previousCanonicalName: applyInput.targetCanonicalName,
      previousDigestSha256: applyInput.targetDigestSha256,
      targetModelName: applyInput.previousModelName,
      targetCanonicalName: applyInput.previousCanonicalName,
      targetDigestSha256: applyInput.previousDigestSha256,
      predecessorOperationId: applyInput.operationId,
      rollbackOfOperationId: applyInput.operationId,
      desiredEventId: 'event-rollback-exact-0001',
      createdAtMs: 3000,
    };
    insertManualEvent(db, {
      eventId: rollbackBase.desiredEventId,
      operationId: rollbackBase.operationId,
      kind: rollbackBase.kind,
      revision: 3,
      targetModelName: rollbackBase.targetModelName,
      targetDigestSha256: rollbackBase.targetDigestSha256,
      createdAtMs: rollbackBase.createdAtMs,
    });
    assertThrowsMatching(
      () => insertOperation(db, { ...rollbackBase, targetDigestSha256: DIGEST_B }),
      /exact reversal/i,
    );
    assertThrowsMatching(
      () => insertOperation(db, { ...rollbackBase, rollbackOfOperationId: null }),
      /exact reversal of its direct apply/i,
    );
    insertBaseline(db, {
      role: 'D1',
      eventId: 'event-d1-current-candidate',
      modelName: rollbackBase.previousModelName,
      canonicalName: rollbackBase.previousCanonicalName,
      digestSha256: rollbackBase.previousDigestSha256,
      revision: 2,
      createdAtMs: 2500,
    });
    insertManualEvent(db, {
      eventId: 'event-d1-cross-role-rollback',
      operationId: 'operation-d1-cross-role-rollback',
      kind: 'USER_ROLLBACK',
      role: 'D1',
      revision: 3,
      targetModelName: rollbackBase.targetModelName,
      targetDigestSha256: rollbackBase.targetDigestSha256,
      createdAtMs: 2900,
    });
    assertThrowsMatching(
      () => insertOperation(db, {
        ...rollbackBase,
        operationId: 'operation-d1-cross-role-rollback',
        requestKey: 'request-d1-cross-role-rollback',
        role: 'D1',
        desiredEventId: 'event-d1-cross-role-rollback',
        createdAtMs: 2900,
      }),
      /exact reversal of its direct apply/i,
    );
    insertOperation(db, rollbackBase);

    insertManualEvent(db, {
      eventId: 'event-rollback-duplicate-0002',
      operationId: 'operation-rollback-duplicate-0002',
      kind: 'USER_ROLLBACK',
      revision: 3,
      targetModelName: rollbackBase.targetModelName,
      targetDigestSha256: rollbackBase.targetDigestSha256,
      createdAtMs: 3100,
    });
    assertThrowsMatching(() => insertOperation(db, {
      ...rollbackBase,
      operationId: 'operation-rollback-duplicate-0002',
      requestKey: 'request-rollback-duplicate-0002',
      desiredEventId: 'event-rollback-duplicate-0002',
      createdAtMs: 3100,
    }), /UNIQUE constraint failed/i);
  });
});

await testAsync('a later manual apply must name the exact preceding operation', async () => {
  await withMigratedDb(async db => {
    insertBaseline(db);
    const first = db.transaction(() => recordApply(db)).immediate();
    const second = {
      operationId: 'operation-user-apply-0002',
      requestKey: 'request-user-apply-0002',
      kind: 'USER_APPLY',
      expectedRevision: 2,
      previousModelName: first.targetModelName,
      previousCanonicalName: first.targetCanonicalName,
      previousDigestSha256: first.targetDigestSha256,
      targetModelName: 'candidate-v2:latest',
      targetCanonicalName: 'candidate-v2',
      targetDigestSha256: DIGEST_A,
      desiredEventId: 'event-user-apply-0002',
      createdAtMs: 3000,
    };
    insertManualEvent(db, {
      eventId: second.desiredEventId,
      operationId: second.operationId,
      kind: second.kind,
      revision: 3,
      targetModelName: second.targetModelName,
      targetDigestSha256: second.targetDigestSha256,
      createdAtMs: second.createdAtMs,
    });
    assertThrowsMatching(
      () => insertOperation(db, second),
      /requires its exact predecessor/i,
    );
    insertOperation(db, { ...second, predecessorOperationId: first.operationId });
  });
});

await testAsync('operation journal is append-only and transaction failures leave no orphans', async () => {
  await withMigratedDb(async db => {
    insertBaseline(db);
    const applyInput = db.transaction(() => recordApply(db)).immediate();
    assertThrowsMatching(() => db.prepare(`
      UPDATE model_binding_operations SET actor = 'user:other' WHERE operation_id = ?
    `).run(applyInput.operationId), /append-only/i);
    assertThrowsMatching(() => db.prepare(`
      DELETE FROM model_binding_operations WHERE operation_id = ?
    `).run(applyInput.operationId), /append-only/i);
  });

  await withMigratedDb(async db => {
    insertBaseline(db);
    db.exec(`
      CREATE TRIGGER fixture_reject_manual_projection
      BEFORE UPDATE ON model_desired_bindings
      WHEN NEW.source = 'USER_APPLY'
      BEGIN
        SELECT RAISE(ABORT, 'fixture projection failure');
      END;
    `);
    const transaction = db.transaction(() => recordApply(db, {
      operationId: 'operation-transaction-failure',
      requestKey: 'request-transaction-failure',
      eventId: 'event-transaction-failure',
    }));
    assertThrowsMatching(() => transaction.immediate(), /fixture projection failure/i);
    assertEqual(db.prepare(`
      SELECT COUNT(*) AS count FROM model_binding_operations
    `).get().count, 0);
    assertEqual(db.prepare(`
      SELECT COUNT(*) AS count FROM model_failover_events
      WHERE event_id = 'event-transaction-failure'
    `).get().count, 0);
    const desired = db.prepare('SELECT * FROM model_desired_bindings WHERE role = ?').get('CHAT');
    assertEqual(desired.binding_revision, 1);
    assertEqual(desired.source, 'LEGACY_OVERRIDE');
  });
});

summary();
