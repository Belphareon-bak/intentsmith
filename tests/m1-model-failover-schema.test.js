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
import { getCurrentVersion, runMigrations } from '../src/db/migrate.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const CONTRACT_DIGEST = 'c'.repeat(64);

function assertThrowsMatching(fn, pattern) {
  const error = assertThrows(fn);
  assert(
    pattern.test(error.message),
    `Expected error "${error.message}" to match ${pattern}`,
  );
  return error;
}

async function withMigratedDb(callback) {
  const directory = mkdtempSync(
    path.join(process.env.INTENTSMITH_TEST_ARTIFACT_DIR, 'failover-schema-'),
  );
  const databasePath = path.join(directory, 'failover.sqlite');
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  try {
    await runMigrations(db);
    return await callback(db, databasePath);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: false });
  }
}

function names(db, type) {
  return db.prepare(
    'SELECT name FROM sqlite_master WHERE type = ? ORDER BY name',
  ).all(type).map(row => row.name);
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
}

function schemaSnapshot(db) {
  return JSON.stringify(db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all());
}

function insertDesiredObservedEvent(db, {
  eventId = 'event-desired-observed',
  role = 'CHAT',
  revision = 1,
  model = 'qwen3.5:27b',
  digest = DIGEST_A,
} = {}) {
  db.prepare(`
    INSERT INTO model_failover_events (
      event_id, event_type, role, binding_revision, actor, reason_code,
      policy_version, desired_model_name, desired_digest_sha256, created_at_ms
    ) VALUES (?, 'DESIRED_OBSERVED', ?, ?, 'user:fixture',
      'DESIRED_ARTIFACT_OBSERVED', 'd-plus-v1', ?, ?, 1000)
  `).run(eventId, role, revision, model, digest);
}

function insertDesiredBinding(db, {
  eventId = 'event-desired-observed',
  role = 'CHAT',
  revision = 1,
  model = 'qwen3.5:27b',
  canonical = model,
  digest = DIGEST_A,
} = {}) {
  db.prepare(`
    INSERT INTO model_desired_bindings (
      role, model_name, canonical_name, digest_sha256, binding_revision,
      source, actor, observed_at_ms, updated_at_ms, last_event_id
    ) VALUES (?, ?, ?, ?, ?, 'LEGACY_OVERRIDE', 'user:fixture', 1000, 1000, ?)
  `).run(role, model, canonical, digest, revision, eventId);
}

function insertPassingProof(db, {
  proofId = 'proof-fixture-0001',
  validationRunId = `${proofId}-run`,
  role = 'CHAT',
  suiteName = 'chat',
  model = 'fallback:latest',
  canonical = 'fallback',
  digest = DIGEST_B,
  contractDigest = CONTRACT_DIGEST,
  policyVersion = 'd-plus-v1',
  score = 1,
  requiredScore = 0.8,
  passedCount = 6,
  requiredPassedCount = 5,
  totalCount = 6,
  startedAt = 1100,
  completedAt = 1600,
  expiresAt = 900000,
  createdAt = completedAt,
} = {}) {
  db.prepare(`
    INSERT INTO model_failover_proofs (
      proof_id, validation_run_id, role, suite, role_contract_sha256,
      model_name, model_canonical_name, model_digest_sha256,
      validation_version, policy_version, score, required_score, passed_count,
      required_passed_count, total_count, duration_ms, result,
      inventory_before_name, inventory_before_digest, inventory_after_name,
      inventory_after_digest, started_at_ms, completed_at_ms, expires_at_ms,
      created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'v123.1', ?, ?, ?, ?, ?, ?, 500,
      'PASS', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    proofId,
    validationRunId,
    role,
    suiteName,
    contractDigest,
    model,
    canonical,
    digest,
    policyVersion,
    score,
    requiredScore,
    passedCount,
    requiredPassedCount,
    totalCount,
    model,
    digest,
    model,
    digest,
    startedAt,
    completedAt,
    expiresAt,
    createdAt,
  );
}

function insertActivationEvent(db, {
  eventId = 'event-activated',
  role = 'CHAT',
  revision = 1,
  rowVersion = 3,
  episodeId = 'episode-1',
  operationId = 'operation-activate-1',
  policyVersion = 'd-plus-v1',
  desiredModel = 'qwen3.5:27b',
  desiredDigest = DIGEST_A,
  fallbackModel = 'fallback:latest',
  fallbackCanonical = 'fallback',
  fallbackDigest = DIGEST_B,
  proofId = 'proof-fixture-0001',
  createdAt = 3000,
} = {}) {
  db.prepare(`
    INSERT INTO model_failover_events (
      event_id, event_type, role, binding_revision, row_version, episode_id,
      operation_id, actor, reason_code, policy_version, state_before,
      state_after, desired_model_name, desired_digest_sha256,
      fallback_model_name, fallback_canonical_name, fallback_digest_sha256,
      proof_id, verified, created_at_ms
    ) VALUES (?, 'ACTIVATED', ?, ?, ?, ?, ?, 'system:binding-integrity',
      'LOCAL_FAILOVER_ACTIVATED', ?, 'DETECTED', 'ACTIVATED', ?, ?, ?, ?, ?,
      ?, 1, ?)
  `).run(
    eventId,
    role,
    revision,
    rowVersion,
    episodeId,
    operationId,
    policyVersion,
    desiredModel,
    desiredDigest,
    fallbackModel,
    fallbackCanonical,
    fallbackDigest,
    proofId,
    createdAt,
  );
}

function insertDetectedState(db, {
  role = 'CHAT',
  revision = 1,
  episodeId = 'episode-1',
  desiredModel = 'qwen3.5:27b',
  desiredDigest = DIGEST_A,
  createdAt = 2000,
} = {}) {
  db.prepare(`
    INSERT INTO model_failover_events (
      event_id, event_type, role, binding_revision, row_version, episode_id,
      actor, reason_code, policy_version, state_after, desired_model_name,
      desired_digest_sha256, created_at_ms
    ) VALUES ('event-detected', 'DETECTED', ?, ?, 1, ?,
      'system:binding-integrity', 'BOUND_MODEL_NOT_INSTALLED', 'd-plus-v1',
      'DETECTED', ?, ?, ?)
  `).run(role, revision, episodeId, desiredModel, desiredDigest, createdAt);
  db.prepare(`
    INSERT INTO model_failover_state (
      role, desired_revision, episode_id, state, active_failover,
      policy_version, actor, reason_code, row_version, detected_at_ms,
      updated_at_ms, last_event_id
    ) VALUES (?, ?, ?, 'DETECTED', 0, 'd-plus-v1',
      'system:binding-integrity', 'BOUND_MODEL_NOT_INSTALLED', 1, ?, ?,
      'event-detected')
  `).run(role, revision, episodeId, createdAt, createdAt);
}

function claimOperation(db, {
  eventId = 'event-activation-claimed',
  eventType = 'ACTIVATION_CLAIMED',
  claimKind = 'ACTIVATE',
  operationId = 'operation-activate-1',
  claimToken = 'claim-token-activate-0001',
  role = 'CHAT',
  revision = 1,
  rowVersion = 2,
  episodeId = 'episode-1',
  state = 'DETECTED',
  desiredModel = 'qwen3.5:27b',
  desiredDigest = DIGEST_A,
  startedAt = 2500,
  expiresAt = 3500,
} = {}) {
  db.prepare(`
    INSERT INTO model_failover_events (
      event_id, event_type, role, binding_revision, row_version, episode_id,
      operation_id, actor, reason_code, policy_version, state_before,
      state_after, desired_model_name, desired_digest_sha256, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'system:binding-integrity',
      'FAILOVER_OPERATION_CLAIMED', 'd-plus-v1', ?, ?, ?, ?, ?)
  `).run(
    eventId,
    eventType,
    role,
    revision,
    rowVersion,
    episodeId,
    operationId,
    state,
    state,
    desiredModel,
    desiredDigest,
    startedAt,
  );
  db.prepare(`
    UPDATE model_failover_state
    SET row_version = ?, claim_operation_id = ?, claim_token = ?, claim_kind = ?,
        claim_started_at_ms = ?, claim_expires_at_ms = ?, updated_at_ms = ?,
        last_event_id = ?
    WHERE role = ?
  `).run(
    rowVersion,
    operationId,
    claimToken,
    claimKind,
    startedAt,
    expiresAt,
    startedAt,
    eventId,
    role,
  );
}

suite('M1 model failover schema — exact migration contract');

await testAsync('fresh file-backed DB creates all failover tables, indexes and triggers', async () => {
  await withMigratedDb(async (db) => {
    assertEqual(getCurrentVersion(db), '2026_08_08_047_model_failover_claim_expiry');

    for (const table of [
      'model_desired_bindings',
      'model_failover_events',
      'model_failover_proofs',
      'model_failover_state',
    ]) {
      assert(names(db, 'table').includes(table), `missing table ${table}`);
    }

    assertEqual(JSON.stringify(columns(db, 'model_desired_bindings')), JSON.stringify([
      'role', 'model_name', 'canonical_name', 'digest_sha256', 'binding_revision',
      'source', 'actor', 'observed_at_ms', 'updated_at_ms', 'last_event_id',
    ]));
    for (const column of [
      'role', 'desired_revision', 'episode_id', 'state', 'active_failover',
      'fallback_model_name', 'fallback_canonical_name', 'fallback_digest_sha256',
      'proof_id', 'active_event_id', 'policy_version', 'actor', 'reason_code',
      'failure_phase', 'proof_verified_at_ms', 'row_version',
      'claim_operation_id', 'claim_token', 'claim_kind', 'claim_started_at_ms',
      'claim_expires_at_ms', 'detected_at_ms', 'activated_at_ms',
      'resolved_at_ms', 'updated_at_ms', 'last_event_id',
    ]) {
      assert(columns(db, 'model_failover_state').includes(column), `missing state.${column}`);
    }

    const indexNames = names(db, 'index');
    for (const index of [
      'idx_model_failover_event_episode',
      'idx_model_failover_event_operation',
      'idx_model_failover_event_role_seq',
      'idx_model_failover_proof_eligibility',
      'idx_model_failover_state_active',
      'idx_model_failover_state_claim_expiry',
    ]) {
      assert(indexNames.includes(index), `missing index ${index}`);
    }

    const triggerNames = names(db, 'trigger');
    for (const trigger of [
      'trg_model_failover_events_append_only_delete',
      'trg_model_failover_events_append_only_update',
      'trg_model_failover_events_claim_expired',
      'trg_model_failover_events_fallback_proof',
      'trg_model_failover_events_restore_proof',
      'trg_model_failover_events_terminal_claim',
      'trg_model_failover_proofs_append_only_delete',
      'trg_model_failover_proofs_append_only_update',
      'trg_model_desired_bindings_last_event_insert',
      'trg_model_desired_bindings_last_event_update',
      'trg_model_failover_state_active_proof_insert',
      'trg_model_failover_state_active_proof_update',
      'trg_model_failover_state_active_event_insert',
      'trg_model_failover_state_active_event_update',
      'trg_model_failover_state_claim_event_insert',
      'trg_model_failover_state_claim_event_update',
      'trg_model_failover_state_last_event_insert',
      'trg_model_failover_state_last_event_update',
    ]) {
      assert(triggerNames.includes(trigger), `missing trigger ${trigger}`);
    }
  });
});

await testAsync('second migration run is a no-op with an identical schema snapshot', async () => {
  await withMigratedDb(async (db) => {
    const before = schemaSnapshot(db);
    const result = await runMigrations(db);
    assertEqual(result.applied.length, 0);
    assertEqual(result.skipped.length, 49);
    assertEqual(schemaSnapshot(db), before);
  });
});

suite('M1 model failover schema — fail-closed constraints');

await testAsync('CLAIM_EXPIRED requires the exact claim and strictly passed expiry', async () => {
  await withMigratedDb(async (db) => {
    insertDesiredObservedEvent(db);
    insertDesiredBinding(db);
    insertDetectedState(db);
    claimOperation(db);

    const insertExpired = ({
      eventId,
      operationId = 'operation-activate-1',
      actor = 'system:binding-integrity',
      reasonCode = 'EXPIRED_CLAIM_RELEASED',
      policyVersion = 'd-plus-v1',
      stateBefore = 'DETECTED',
      stateAfter = 'DETECTED',
      desiredModel = 'qwen3.5:27b',
      desiredDigest = DIGEST_A,
      detailsJson = '{}',
      createdAt,
    }) => db.prepare(`
      INSERT INTO model_failover_events (
        event_id, event_type, role, binding_revision, row_version, episode_id,
        operation_id, actor, reason_code, policy_version, state_before,
        state_after, desired_model_name, desired_digest_sha256, details_json,
        created_at_ms
      ) VALUES (?, 'CLAIM_EXPIRED', 'CHAT', 1, 3, 'episode-1', ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      operationId,
      actor,
      reasonCode,
      policyVersion,
      stateBefore,
      stateAfter,
      desiredModel,
      desiredDigest,
      detailsJson,
      createdAt,
    );

    assertThrowsMatching(() => insertExpired({
      eventId: 'event-expiry-at-boundary',
      createdAt: 3500,
    }), /matching expired claim/i);
    assertThrowsMatching(() => insertExpired({
      eventId: 'event-expiry-wrong-operation',
      operationId: 'operation-other',
      createdAt: 3501,
    }), /matching expired claim/i);
    for (const [suffix, override] of [
      ['actor', { actor: 'system:other' }],
      ['reason', { reasonCode: 'OTHER_REASON' }],
      ['policy', { policyVersion: 'd-plus-v0' }],
      ['state-before', { stateBefore: 'FAILED' }],
      ['state-after', { stateAfter: 'FAILED' }],
      ['model', { desiredModel: 'other-model' }],
      ['digest', { desiredDigest: DIGEST_B }],
      ['details', { detailsJson: '{"unexpected":true}' }],
    ]) {
      assertThrowsMatching(() => insertExpired({
        eventId: `event-expiry-wrong-${suffix}`,
        createdAt: 3501,
        ...override,
      }), /matching expired claim/i);
    }

    insertExpired({ eventId: 'event-expiry-valid', createdAt: 3501 });
    assertEqual(
      db.prepare("SELECT count(*) AS count FROM model_failover_events WHERE event_type = 'CLAIM_EXPIRED'").get().count,
      1,
    );
  });
});

await testAsync('desired binding rejects invalid role, digest and non-integer revision', async () => {
  await withMigratedDb(async (db) => {
    insertDesiredObservedEvent(db);
    insertDesiredBinding(db);

    assertThrowsMatching(() => insertDesiredObservedEvent(db, {
      eventId: 'event-invalid-role',
      role: 'UNKNOWN',
      revision: 2,
    }), /CHECK|audit event/i);
    assertThrowsMatching(() => insertDesiredObservedEvent(db, {
      eventId: 'event-invalid-digest',
      digest: 'A'.repeat(64),
    }), /CHECK/i);
    assertThrowsMatching(() => insertDesiredObservedEvent(db, {
      eventId: 'event-short-digest',
      digest: 'a'.repeat(63),
    }), /CHECK/i);
    assertThrowsMatching(() => insertDesiredBinding(db, {
      eventId: 'event-desired-observed',
      role: 'D1',
      revision: 1,
      digest: 'A'.repeat(64),
    }), /CHECK|audit event/i);
    assertThrowsMatching(() => db.prepare(`
      INSERT INTO model_desired_bindings (
        role, model_name, canonical_name, digest_sha256, binding_revision,
        source, actor, observed_at_ms, updated_at_ms, last_event_id
      ) VALUES ('D1', 'model', 'model', ?, 1.5, 'CONFIG_DEFAULT',
        'system:fixture', 1000, 1000, 'event-desired-observed')
    `).run(DIGEST_A), /CHECK|audit event/i);
  });
});

await testAsync('PASS proof requires the role suite, exact digests and declared thresholds', async () => {
  await withMigratedDb(async (db) => {
    for (const [label, overrides] of [
      ['wrong-suite', { role: 'CHAT', suiteName: 'vision' }],
      ['score-below-threshold', { score: 0.79, requiredScore: 0.8 }],
      ['count-below-threshold', { passedCount: 4, requiredPassedCount: 5 }],
      ['uppercase-model-digest', { digest: 'A'.repeat(64) }],
      ['short-model-digest', { digest: 'a'.repeat(63) }],
      ['long-model-digest', { digest: 'a'.repeat(65) }],
      ['nonhex-contract-digest', { contractDigest: `${'c'.repeat(63)}g` }],
      ['short-contract-digest', { contractDigest: 'c'.repeat(63) }],
      ['created-before-complete', { createdAt: 1500, completedAt: 1600 }],
    ]) {
      assertThrowsMatching(() => insertPassingProof(db, {
        proofId: `proof-${label}-0001`,
        ...overrides,
      }), /CHECK/i);
    }

    insertPassingProof(db);
    const proof = db.prepare(`
      SELECT suite, score, required_score, passed_count, required_passed_count
      FROM model_failover_proofs WHERE proof_id = 'proof-fixture-0001'
    `).get();
    assertEqual(proof.suite, 'chat');
    assertEqual(proof.score, 1);
    assertEqual(proof.required_score, 0.8);
    assertEqual(proof.passed_count, 6);
    assertEqual(proof.required_passed_count, 5);
  });
});

await testAsync('desired and incident projections reject unrelated last-event pointers', async () => {
  await withMigratedDb(async (db) => {
    insertDesiredObservedEvent(db);
    assertThrowsMatching(() => insertDesiredBinding(db, {
      role: 'D1',
      model: 'reasoner:latest',
      canonical: 'reasoner',
    }), /audit event/i);

    insertDesiredBinding(db);
    db.prepare(`
      INSERT INTO model_failover_events (
        event_id, event_type, role, binding_revision, row_version, episode_id,
        actor, reason_code, policy_version, state_after, desired_model_name,
        desired_digest_sha256, created_at_ms
      ) VALUES ('event-detected', 'DETECTED', 'CHAT', 1, 1, 'episode-1',
        'system:binding-integrity', 'BOUND_MODEL_NOT_INSTALLED', 'd-plus-v1',
        'DETECTED', 'qwen3.5:27b', ?, 2000)
    `).run(DIGEST_A);

    assertThrowsMatching(() => db.prepare(`
      INSERT INTO model_failover_state (
        role, desired_revision, episode_id, state, active_failover,
        policy_version, actor, reason_code, row_version, detected_at_ms,
        updated_at_ms, last_event_id
      ) VALUES ('CHAT', 1, 'different-episode', 'DETECTED', 0, 'd-plus-v1',
        'system:binding-integrity', 'BOUND_MODEL_NOT_INSTALLED', 1, 2000, 2000,
        'event-detected')
    `).run(), /audit event/i);
  });
});

await testAsync('verified audit events require a fresh matching artifact proof', async () => {
  await withMigratedDb(async (db) => {
    insertDesiredObservedEvent(db);
    insertDesiredBinding(db);
    insertDetectedState(db);
    claimOperation(db);
    insertPassingProof(db);
    insertPassingProof(db, {
      proofId: 'proof-vision-fixture-0001',
      role: 'VISION',
      suiteName: 'vision',
    });

    for (const [label, overrides] of [
      ['wrong-role', { proofId: 'proof-vision-fixture-0001' }],
      ['wrong-canonical', { fallbackCanonical: 'other-fallback' }],
      ['wrong-digest', { fallbackDigest: 'd'.repeat(64) }],
      ['wrong-policy', { policyVersion: 'different-policy' }],
      ['wrong-desired-name', { desiredModel: 'different-desired:latest' }],
      ['wrong-desired-digest', { desiredDigest: 'd'.repeat(64) }],
      ['wrong-binding-revision', { revision: 2 }],
      ['expired', { createdAt: 900001 }],
    ]) {
      assertThrowsMatching(() => insertActivationEvent(db, {
        eventId: `event-${label}`,
        ...overrides,
      }), /fresh proof|live claim/i);
    }

    insertActivationEvent(db);
    db.prepare(`
      UPDATE model_failover_state
      SET state = 'ACTIVATED', active_failover = 1,
          fallback_model_name = 'fallback:latest',
          fallback_canonical_name = 'fallback', fallback_digest_sha256 = ?,
          proof_id = 'proof-fixture-0001', active_event_id = 'event-activated',
          proof_verified_at_ms = 3000, activated_at_ms = 3000,
          row_version = 3, claim_operation_id = NULL, claim_token = NULL,
          claim_kind = NULL, claim_started_at_ms = NULL,
          claim_expires_at_ms = NULL, updated_at_ms = 3000,
          last_event_id = 'event-activated'
      WHERE role = 'CHAT'
    `).run(DIGEST_B);

    insertPassingProof(db, {
      proofId: 'proof-desired-fixture-0001',
      model: 'qwen3.5:27b',
      canonical: 'qwen3.5:27b',
      digest: DIGEST_A,
    });
    claimOperation(db, {
      eventId: 'event-restore-claimed',
      eventType: 'RESTORE_CLAIMED',
      claimKind: 'RESTORE',
      operationId: 'operation-restore-1',
      claimToken: 'claim-token-restore-0001',
      rowVersion: 4,
      state: 'ACTIVATED',
      startedAt: 4000,
      expiresAt: 6000,
    });
    const insertRestoreEvent = proofId => db.prepare(`
      INSERT INTO model_failover_events (
        event_id, event_type, role, binding_revision, row_version, episode_id,
        operation_id, actor, reason_code, policy_version, state_before,
        state_after, desired_model_name, desired_digest_sha256, proof_id,
        verified, created_at_ms
      ) VALUES (?, 'RESTORED', 'CHAT', 1, 5, 'episode-1',
        'operation-restore-1',
        'system:binding-integrity', 'DESIRED_MODEL_RESTORED', 'd-plus-v1',
        'ACTIVATED', 'RESTORED', 'qwen3.5:27b', ?, ?, 1, 5000)
    `).run(
      proofId === 'proof-desired-fixture-0001'
        ? 'event-restored-valid'
        : 'event-restored-invalid',
      DIGEST_A,
      proofId,
    );

    assertThrowsMatching(
      () => insertRestoreEvent('proof-fixture-0001'),
      /fresh desired proof/i,
    );
    insertRestoreEvent('proof-desired-fixture-0001');
    db.prepare(`
      UPDATE model_failover_state
      SET state = 'RESTORED', active_failover = 0, row_version = 5,
          claim_operation_id = NULL, claim_token = NULL, claim_kind = NULL,
          claim_started_at_ms = NULL, claim_expires_at_ms = NULL,
          resolved_at_ms = 5000, updated_at_ms = 5000,
          last_event_id = 'event-restored-valid'
      WHERE role = 'CHAT'
    `).run();
    assertEqual(
      db.prepare("SELECT verified FROM model_failover_events WHERE event_id = 'event-restored-valid'").get().verified,
      1,
    );
  });
});

await testAsync('active failover requires a matching role/name/digest proof', async () => {
  await withMigratedDb(async (db) => {
    insertDesiredObservedEvent(db);
    insertDesiredBinding(db);
    insertDetectedState(db);

    assertThrowsMatching(() => db.prepare(`
      UPDATE model_failover_state
      SET state = 'ACTIVATED', active_failover = 1,
          fallback_model_name = 'fallback:latest',
          fallback_canonical_name = 'fallback',
          fallback_digest_sha256 = ?, proof_id = NULL,
          activated_at_ms = 3000, updated_at_ms = 3000
      WHERE role = 'CHAT'
    `).run(DIGEST_B), /CHECK|proof|audit event/i);

    insertPassingProof(db);
    assertThrowsMatching(
      () => insertActivationEvent(db),
      /live claim/i,
    );
    claimOperation(db);
    for (const [label, overrides] of [
      ['wrong-operation', { operationId: 'operation-other' }],
      ['expired-claim', { createdAt: 3501 }],
      ['skipped-row-version', { rowVersion: 4 }],
    ]) {
      assertThrowsMatching(() => insertActivationEvent(db, {
        eventId: `event-claim-${label}`,
        ...overrides,
      }), /live claim/i);
    }
    insertActivationEvent(db);
    db.prepare(`
      UPDATE model_failover_state
      SET state = 'ACTIVATED', active_failover = 1,
          fallback_model_name = 'fallback:latest',
          fallback_canonical_name = 'fallback',
          fallback_digest_sha256 = ?, proof_id = 'proof-fixture-0001',
          active_event_id = 'event-activated',
          proof_verified_at_ms = 3000,
          activated_at_ms = 3000, updated_at_ms = 3000,
          row_version = 3, claim_operation_id = NULL, claim_token = NULL,
          claim_kind = NULL, claim_started_at_ms = NULL,
          claim_expires_at_ms = NULL, last_event_id = 'event-activated'
      WHERE role = 'CHAT'
    `).run(DIGEST_B);

    const state = db.prepare('SELECT * FROM model_failover_state WHERE role = ?').get('CHAT');
    assertEqual(state.state, 'ACTIVATED');
    assertEqual(state.active_failover, 1);
    assertEqual(state.fallback_digest_sha256, DIGEST_B);

    assertThrowsMatching(() => db.prepare(`
      UPDATE model_failover_state
      SET fallback_digest_sha256 = ?
      WHERE role = 'CHAT'
    `).run('d'.repeat(64)), /proof|activation event/i);

    assertThrowsMatching(() => db.prepare(`
      UPDATE model_failover_state
      SET policy_version = 'different-policy'
      WHERE role = 'CHAT'
    `).run(), /proof|audit event|activation event/i);

    assertThrowsMatching(() => db.prepare(`
      UPDATE model_failover_state
      SET proof_verified_at_ms = 900001
      WHERE role = 'CHAT'
    `).run(), /proof|activation event/i);

    assertThrowsMatching(() => db.prepare(`
      UPDATE model_failover_state
      SET activated_at_ms = 900001
      WHERE role = 'CHAT'
    `).run(), /activation event/i);

    const invalidClaimTransaction = db.transaction(() => {
      db.prepare(`
        INSERT INTO model_failover_events (
          event_id, event_type, role, binding_revision, row_version, episode_id,
          operation_id, actor, reason_code, policy_version, state_before,
          state_after, desired_model_name, desired_digest_sha256, created_at_ms
        ) VALUES ('event-unowned-claim', 'ACTIVATION_CLAIMED', 'CHAT', 1, 4,
          'episode-1', 'operation-unowned-claim', 'system:binding-integrity',
          'CLAIMED_WITHOUT_STATE', 'd-plus-v1', 'ACTIVATED', 'ACTIVATED',
          'qwen3.5:27b', ?, 4000)
      `).run(DIGEST_A);
      db.prepare(`
        UPDATE model_failover_state
        SET row_version = 4, updated_at_ms = 4000,
            last_event_id = 'event-unowned-claim'
        WHERE role = 'CHAT'
      `).run();
    });
    assertThrowsMatching(() => invalidClaimTransaction(), /claim/i);
    assertEqual(
      db.prepare("SELECT count(*) AS count FROM model_failover_events WHERE event_id = 'event-unowned-claim'").get().count,
      0,
    );

    insertDesiredObservedEvent(db, {
      eventId: 'event-desired-vision',
      role: 'VISION',
      model: 'vision-model:latest',
    });
    insertDesiredBinding(db, {
      eventId: 'event-desired-vision',
      role: 'VISION',
      model: 'vision-model:latest',
      canonical: 'vision-model',
    });
    db.prepare(`
      INSERT INTO model_failover_events (
        event_id, event_type, role, binding_revision, row_version, episode_id,
        actor, reason_code, policy_version, state_after, desired_model_name,
        desired_digest_sha256, created_at_ms
      ) VALUES ('event-vision-active-shape', 'ACTIVATION_CLAIMED', 'VISION', 1,
        1, 'episode-vision', 'system:binding-integrity', 'CLAIMED', 'd-plus-v1',
        'ACTIVATED', 'vision-model:latest', ?, 3000)
    `).run(DIGEST_A);
    assertThrowsMatching(() => db.prepare(`
      INSERT INTO model_failover_state (
        role, desired_revision, episode_id, state, active_failover,
        fallback_model_name, fallback_canonical_name, fallback_digest_sha256,
        proof_id, active_event_id, proof_verified_at_ms, policy_version, actor,
        reason_code, row_version, detected_at_ms, activated_at_ms,
        updated_at_ms, last_event_id
      ) VALUES ('VISION', 1, 'episode-vision', 'ACTIVATED', 1,
        'fallback:latest', 'fallback', ?, 'proof-fixture-0001', NULL, 3000,
        'd-plus-v1', 'system:binding-integrity', 'LOCAL_FAILOVER_ACTIVATED',
        1, 2000, 3000, 3000, 'event-vision-active-shape')
    `).run(DIGEST_B), /CHECK|proof|activation event/i);
  });
});

await testAsync('active failover accepts a matching reapply claim and fresh terminal proof', async () => {
  await withMigratedDb(async (db) => {
    insertDesiredObservedEvent(db);
    insertDesiredBinding(db);
    insertPassingProof(db);
    insertDetectedState(db);
    claimOperation(db);
    insertActivationEvent(db);
    db.prepare(`
      UPDATE model_failover_state
      SET state = 'ACTIVATED', active_failover = 1,
          fallback_model_name = 'fallback:latest',
          fallback_canonical_name = 'fallback', fallback_digest_sha256 = ?,
          proof_id = 'proof-fixture-0001', active_event_id = 'event-activated',
          proof_verified_at_ms = 3000, activated_at_ms = 3000,
          row_version = 3, claim_operation_id = NULL, claim_token = NULL,
          claim_kind = NULL, claim_started_at_ms = NULL,
          claim_expires_at_ms = NULL, updated_at_ms = 3000,
          last_event_id = 'event-activated'
      WHERE role = 'CHAT'
    `).run(DIGEST_B);

    assertThrowsMatching(() => db.prepare(`
      INSERT INTO model_failover_events (
        event_id, event_type, role, binding_revision, row_version, episode_id,
        operation_id, actor, reason_code, policy_version, state_before,
        state_after, desired_model_name, desired_digest_sha256,
        fallback_model_name, fallback_canonical_name, fallback_digest_sha256,
        proof_id, verified, created_at_ms
      ) VALUES ('event-reapplied-without-claim', 'REAPPLIED', 'CHAT', 1, 4,
        'episode-1', 'operation-reapply-without-claim',
        'system:binding-integrity', 'LOCAL_FAILOVER_REAPPLIED', 'd-plus-v1',
        'ACTIVATED', 'ACTIVATED', 'qwen3.5:27b', ?, 'fallback:latest',
        'fallback', ?, 'proof-fixture-0001', 1, 4000)
    `).run(DIGEST_A, DIGEST_B), /live claim/i);
    claimOperation(db, {
      eventId: 'event-reapply-claimed',
      eventType: 'REAPPLY_CLAIMED',
      claimKind: 'REAPPLY',
      operationId: 'operation-reapply-1',
      claimToken: 'claim-token-reapply-0001',
      rowVersion: 4,
      state: 'ACTIVATED',
      startedAt: 4000,
      expiresAt: 6000,
    });

    const claimed = db.prepare(
      'SELECT * FROM model_failover_state WHERE role = ?'
    ).get('CHAT');
    assertEqual(claimed.claim_kind, 'REAPPLY');
    assertEqual(claimed.active_event_id, 'event-activated');

    insertPassingProof(db, {
      proofId: 'proof-reapply-0001',
      startedAt: 4100,
      completedAt: 4500,
      createdAt: 4500,
    });
    db.prepare(`
      INSERT INTO model_failover_events (
        event_id, event_type, role, binding_revision, row_version, episode_id,
        operation_id, actor, reason_code, policy_version, state_before,
        state_after, desired_model_name, desired_digest_sha256,
        fallback_model_name, fallback_canonical_name, fallback_digest_sha256,
        proof_id, verified, created_at_ms
      ) VALUES ('event-reapplied', 'REAPPLIED', 'CHAT', 1, 5, 'episode-1',
        'operation-reapply-1', 'system:binding-integrity',
        'LOCAL_FAILOVER_REAPPLIED', 'd-plus-v1', 'ACTIVATED', 'ACTIVATED',
        'qwen3.5:27b', ?, 'fallback:latest', 'fallback', ?,
        'proof-reapply-0001', 1, 5000)
    `).run(DIGEST_A, DIGEST_B);
    db.prepare(`
      UPDATE model_failover_state
      SET proof_id = 'proof-reapply-0001', active_event_id = 'event-reapplied',
          proof_verified_at_ms = 5000, row_version = 5,
          claim_operation_id = NULL, claim_token = NULL, claim_kind = NULL,
          claim_started_at_ms = NULL, claim_expires_at_ms = NULL,
          updated_at_ms = 5000, last_event_id = 'event-reapplied'
      WHERE role = 'CHAT'
    `).run();

    const reapplied = db.prepare(
      'SELECT * FROM model_failover_state WHERE role = ?'
    ).get('CHAT');
    assertEqual(reapplied.state, 'ACTIVATED');
    assertEqual(reapplied.active_failover, 1);
    assertEqual(reapplied.active_event_id, 'event-reapplied');
    assertEqual(reapplied.proof_id, 'proof-reapply-0001');
    assertEqual(reapplied.activated_at_ms, 3000);
    assertEqual(reapplied.proof_verified_at_ms, 5000);
    assertEqual(reapplied.claim_token, null);
  });
});

await testAsync('proofs and events are append-only and audit references block deletion', async () => {
  await withMigratedDb(async (db) => {
    insertDesiredObservedEvent(db);
    insertDesiredBinding(db);
    insertPassingProof(db);

    assertThrowsMatching(() => db.prepare(
      "UPDATE model_failover_events SET reason_code = 'CHANGED' WHERE event_id = 'event-desired-observed'",
    ).run(), /append-only/i);
    assertThrowsMatching(() => db.prepare(
      "DELETE FROM model_failover_events WHERE event_id = 'event-desired-observed'",
    ).run(), /append-only/i);
    assertThrowsMatching(() => db.prepare(
      "UPDATE model_failover_proofs SET score = 0.5 WHERE proof_id = 'proof-fixture-0001'",
    ).run(), /append-only/i);
    assertThrowsMatching(() => db.prepare(
      "DELETE FROM model_failover_proofs WHERE proof_id = 'proof-fixture-0001'",
    ).run(), /append-only/i);
  });
});

summary();
