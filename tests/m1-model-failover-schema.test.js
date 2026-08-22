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
import {
  getCurrentVersion,
  runMigrations,
  _testInternals as migrationTestInternals,
} from '../src/db/migrate.js';
import { up as installAppendOnlyIdentity } from '../src/db/migrations/2026_08_09_053_model_binding_append_only_identity.js';
import { up as installRuntimeFinalization } from '../src/db/migrations/2026_08_09_054_model_binding_runtime_finalization.js';
import { createModelFailoverRepository } from '../src/upgrade/model-failover.js';

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

function normalizedTriggerSql(db, name) {
  const row = db.prepare(`
    SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?
  `).get(name);
  assert(row?.sql, `missing trigger SQL ${name}`);
  return row.sql.replace(/\s+/g, ' ').trim();
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

function insertPreFinalizeManualRuntimeSuccess(db, {
  attemptKind = 'RUNTIME_APPLY',
  includeHistory = attemptKind === 'RUNTIME_APPLY',
} = {}) {
  const operationId = 'operation-pre-054-runtime-success';
  const eventId = 'event-pre-054-user-apply';
  const apply = db.transaction(() => {
    db.prepare('PRAGMA defer_foreign_keys = ON').run();
    db.prepare(`
      INSERT INTO model_failover_events (
        event_id, event_type, role, binding_revision, operation_id, actor,
        reason_code, policy_version, desired_model_name, desired_digest_sha256,
        verified, details_json, created_at_ms
      ) VALUES (?, 'DESIRED_CHANGED', 'CHAT', 2, ?, 'user:fixture',
        'USER_MODEL_BINDING_APPLIED', 'd-plus-v1', 'candidate', ?, 0, '{}', 2000)
    `).run(eventId, operationId, DIGEST_B);
    db.prepare(`
      INSERT INTO model_binding_operations (
        operation_id, request_key, role, operation_kind,
        expected_binding_revision, committed_binding_revision,
        previous_model_name, previous_canonical_name, previous_digest_sha256,
        target_model_name, target_canonical_name, target_digest_sha256,
        predecessor_operation_id, rollback_of_operation_id,
        verification_status, runtime_status, desired_event_id, actor,
        reason_code, policy_version, details_json, created_at_ms
      ) VALUES (?, 'request-pre-054-user-apply', 'CHAT', 'USER_APPLY', 1, 2,
        'qwen3.5:27b', 'qwen3.5:27b', ?, 'candidate', 'candidate', ?, NULL, NULL,
        'NOT_VERIFIED', 'NOT_APPLIED', ?, 'user:fixture',
        'USER_MODEL_BINDING_APPLIED', 'd-plus-v1', '{}', 2000)
    `).run(operationId, DIGEST_A, DIGEST_B, eventId);
    const updated = db.prepare(`
      UPDATE model_desired_bindings
      SET model_name = 'candidate', canonical_name = 'candidate',
          digest_sha256 = ?, binding_revision = 2, source = 'USER_APPLY',
          actor = 'user:fixture', observed_at_ms = 2000, updated_at_ms = 2000,
          last_event_id = ?
      WHERE role = 'CHAT' AND binding_revision = 1
    `).run(DIGEST_B, eventId);
    assertEqual(updated.changes, 1);
    db.prepare(`
      INSERT INTO model_binding_application_attempts (
        operation_id, attempt_revision, attempt_kind, outcome,
        observed_model_name, observed_canonical_name, observed_digest_sha256,
        verification_method, failure_code, retryable, created_at_ms,
        runtime_changed
      ) VALUES (?, 1, ?, 'SUCCEEDED', 'candidate', 'candidate', ?,
        NULL, NULL, 0, 2100, 1)
    `).run(operationId, attemptKind, DIGEST_B);
    if (includeHistory) {
      db.prepare(`
        INSERT INTO upgrade_history (
          role, from_model, to_model, score, action, created_at
        ) VALUES (
          'CHAT', 'qwen3.5:27b', 'candidate', NULL, 'apply',
          datetime(2100 / 1000, 'unixepoch')
        )
      `).run();
    }
  });
  apply.immediate();
  return operationId;
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
    // Decision 020/E added migration 066; this pin follows the real tip.
    assertEqual(getCurrentVersion(db), '2026_08_22_066_model_automation_policy');

    for (const table of [
      'model_desired_bindings',
      'model_binding_operations',
      'model_binding_application_attempts',
      'model_binding_runtime_finalize_cutoffs',
      'model_binding_runtime_finalize_receipts',
      'model_binding_provider_operations',
      'model_binding_provider_attempts',
      'model_binding_provider_claims',
      'model_binding_user_noop_receipts',
      'model_binding_user_noop_provider_supersedes',
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
    assertEqual(JSON.stringify(columns(db, 'model_binding_application_attempts')), JSON.stringify([
      'seq', 'operation_id', 'attempt_revision', 'attempt_kind', 'outcome',
      'observed_model_name', 'observed_canonical_name', 'observed_digest_sha256',
      'verification_method', 'failure_code', 'retryable', 'created_at_ms',
      'runtime_changed',
    ]));
    assertEqual(
      JSON.stringify(columns(db, 'model_binding_runtime_finalize_cutoffs')),
      JSON.stringify([
        'operation_id', 'max_preexisting_runtime_attempt_revision',
      ]),
    );
    assertEqual(
      JSON.stringify(columns(db, 'model_binding_runtime_finalize_receipts')),
      JSON.stringify([
        'seq', 'operation_id', 'runtime_attempt_revision', 'finalization_kind',
        'config_version', 'recovered_by_attempt_revision', 'created_at_ms',
      ]),
    );
    assertEqual(JSON.stringify(columns(db, 'model_binding_provider_operations')), JSON.stringify([
      'command_seq', 'operation_id', 'request_key', 'role', 'effect_kind',
      'request_purpose', 'expected_binding_revision', 'provider_origin',
      'requested_model_name', 'requested_canonical_name', 'actor',
      'initial_claim_token', 'initial_claim_expires_at_ms', 'created_at_ms',
    ]));
    assertEqual(JSON.stringify(columns(db, 'model_binding_provider_attempts')), JSON.stringify([
      'seq', 'operation_id', 'attempt_revision', 'outcome', 'observed_model_name',
      'observed_canonical_name', 'observed_digest_sha256', 'failure_code',
      'retryable', 'claim_token', 'fencing_revision', 'created_at_ms',
    ]));
    assertEqual(JSON.stringify(columns(db, 'model_binding_provider_claims')), JSON.stringify([
      'operation_id', 'role', 'provider_origin', 'requested_canonical_name',
      'claim_token', 'fencing_revision', 'lease_expires_at_ms', 'updated_at_ms',
    ]));
    assertEqual(JSON.stringify(columns(db, 'model_binding_user_noop_receipts')), JSON.stringify([
      'receipt_id', 'request_key', 'role', 'binding_revision', 'model_name',
      'canonical_name', 'digest_sha256', 'actor', 'desired_source',
      'desired_actor', 'desired_observed_at_ms', 'desired_updated_at_ms',
      'desired_last_event_id', 'provider_command_cutoff_seq',
      'source_provider_operation_id', 'created_at_ms',
    ]));
    assertEqual(JSON.stringify(columns(
      db,
      'model_binding_user_noop_provider_supersedes',
    )), JSON.stringify([
      'receipt_id', 'provider_operation_id',
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
      'idx_model_binding_application_operation',
      'idx_model_binding_runtime_finalize_operation',
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
      'trg_model_binding_application_revision',
      'trg_model_binding_application_current_desired',
      'trg_model_binding_application_success_identity',
      'trg_model_binding_application_time_order',
      'trg_model_binding_application_runtime_prerequisite',
      'trg_model_binding_application_runtime_apply_once',
      'trg_model_binding_application_runtime_changed_shape',
      'trg_model_binding_application_runtime_apply_after_rehydrate',
      'trg_model_binding_application_nonretryable_runtime_terminal',
      'trg_model_binding_application_verification_terminal',
      'trg_model_binding_application_notification_once',
      'trg_model_binding_application_append_only_update',
      'trg_model_binding_application_append_only_delete',
      'trg_model_binding_application_finalize_prerequisite',
      'trg_model_binding_runtime_finalize_cutoff_sealed_insert',
      'trg_model_binding_runtime_finalize_cutoff_sealed_update',
      'trg_model_binding_runtime_finalize_cutoff_sealed_delete',
      'trg_model_binding_runtime_finalize_sequence_authority',
      'trg_model_binding_runtime_finalize_sequence_positive',
      'trg_model_binding_runtime_finalize_identity_conflict',
      'trg_model_binding_runtime_finalize_attempt_shape',
      'trg_model_binding_runtime_finalize_current_desired',
      'trg_model_binding_runtime_finalize_direct_latest',
      'trg_model_binding_runtime_finalize_direct_after_cutoff',
      'trg_model_binding_runtime_finalize_recovery_lineage',
      'trg_model_binding_runtime_finalize_time_order',
      'trg_model_binding_runtime_finalize_append_only_update',
      'trg_model_binding_runtime_finalize_append_only_delete',
      'trg_model_overrides_manual_identity_insert',
      'trg_model_overrides_legacy_cannot_replace_manual',
      'trg_model_overrides_manual_identity_update',
      'trg_model_overrides_manual_lineage_update',
      'trg_model_overrides_manual_lineage_delete',
      'trg_model_overrides_verified_authority_insert',
      'trg_model_overrides_verified_authority_update',
      'trg_model_binding_provider_attempt_once',
      'trg_model_binding_provider_operations_user_actor',
      'trg_model_binding_provider_command_sequence_authority',
      'trg_model_binding_provider_claim_conflict',
      'trg_model_binding_provider_claim_create',
      'trg_model_binding_provider_claim_update_guard',
      'trg_model_binding_provider_claim_delete_guard',
      'trg_model_binding_provider_terminal_claim',
      'trg_model_binding_provider_success_identity',
      'trg_model_binding_provider_time_order',
      'trg_model_binding_provider_claim_release',
      'trg_model_binding_operation_provider_lineage',
      'trg_model_binding_operation_provider_not_superseded',
      'trg_model_binding_operation_provider_unresolved_success',
      'trg_model_binding_operation_provider_pending',
      'trg_model_binding_provider_operations_append_only_update',
      'trg_model_binding_provider_operations_append_only_delete',
      'trg_model_binding_provider_attempts_append_only_update',
      'trg_model_binding_provider_attempts_append_only_delete',
      'trg_model_binding_provider_claims_insert_forbidden',
      'trg_model_binding_user_noop_projection',
      'trg_model_binding_user_noop_actor',
      'trg_model_binding_user_noop_provider_cutoff',
      'trg_model_binding_user_noop_provider_lineage',
      'trg_model_binding_user_noop_provider_supersedes_insert_conflict',
      'trg_model_binding_user_noop_provider_supersedes_update',
      'trg_model_binding_user_noop_provider_supersedes_delete',
      'trg_model_binding_user_noop_provider_frontier',
      'trg_model_binding_user_noop_source_provider_lineage',
      'trg_model_binding_user_noop_provider_pending',
      'trg_model_binding_user_noop_provider_time_order',
      'trg_model_binding_user_noop_provider_prefix',
      'trg_model_binding_user_noop_request_key',
      'trg_model_binding_user_noop_append_only_insert_conflict',
      'trg_model_binding_user_noop_append_only_update',
      'trg_model_binding_user_noop_append_only_delete',
      'trg_model_binding_provider_noop_request_conflict',
      'trg_model_binding_operation_noop_request_conflict',
      'trg_model_binding_provider_unresolved_success',
      'trg_model_binding_provider_desired_revision',
      'trg_model_desired_binding_provider_unresolved_success',
      'trg_model_desired_binding_provider_pending',
      'trg_model_desired_binding_provider_unresolved_insert',
      'trg_model_desired_binding_provider_pending_insert',
      'trg_model_desired_binding_provider_unresolved_delete',
      'trg_model_desired_binding_provider_pending_delete',
      'trg_model_failover_proofs_append_only_insert_conflict',
      'trg_model_failover_proofs_identity_required',
      'trg_model_failover_proofs_rowid_authority',
      'trg_model_failover_proofs_rowid_positive',
      'trg_model_failover_events_sequence_authority',
      'trg_model_failover_events_sequence_positive',
      'trg_model_failover_events_append_only_insert_conflict',
      'trg_model_binding_operations_append_only_insert_conflict',
      'trg_model_binding_operations_identity_required',
      'trg_model_binding_operations_rowid_authority',
      'trg_model_binding_operations_rowid_positive',
      'trg_model_binding_application_sequence_authority',
      'trg_model_binding_application_sequence_positive',
      'trg_model_binding_application_append_only_insert_conflict',
      'trg_model_binding_provider_command_sequence_positive',
      'trg_model_binding_provider_operations_append_only_insert_conflict',
      'trg_model_binding_provider_attempts_sequence_authority',
      'trg_model_binding_provider_attempts_sequence_positive',
      'trg_model_binding_provider_attempts_append_only_insert_conflict',
      'trg_model_binding_user_noop_rowid_authority',
      'trg_model_binding_user_noop_identity_required',
      'trg_model_binding_user_noop_rowid_positive',
      'trg_model_binding_user_noop_provider_supersedes_rowid_authority',
      'trg_model_binding_user_noop_provider_supersedes_rowid_positive',
    ]) {
      assert(triggerNames.includes(trigger), `missing trigger ${trigger}`);
    }

    const proofIdentity = normalizedTriggerSql(
      db,
      'trg_model_failover_proofs_append_only_insert_conflict',
    );
    assert(proofIdentity.includes('existing.proof_id = NEW.proof_id'));
    assert(proofIdentity.includes(
      'existing.validation_run_id = NEW.validation_run_id AND existing.role = NEW.role',
    ));
    const eventIdentity = normalizedTriggerSql(
      db,
      'trg_model_failover_events_append_only_insert_conflict',
    );
    assert(eventIdentity.includes('existing.event_id = NEW.event_id'));
    assert(eventIdentity.includes(
      'existing.operation_id = NEW.operation_id AND existing.event_type = NEW.event_type',
    ));
    const operationIdentity = normalizedTriggerSql(
      db,
      'trg_model_binding_operations_append_only_insert_conflict',
    );
    for (const fragment of [
      'existing.operation_id = NEW.operation_id',
      'existing.request_key = NEW.request_key',
      'existing.desired_event_id = NEW.desired_event_id',
      'existing.role = NEW.role AND existing.committed_binding_revision = NEW.committed_binding_revision',
      'existing.rollback_of_operation_id = NEW.rollback_of_operation_id',
    ]) assert(operationIdentity.includes(fragment), `missing operation identity clause ${fragment}`);
    const providerIdentity = normalizedTriggerSql(
      db,
      'trg_model_binding_provider_operations_append_only_insert_conflict',
    );
    for (const fragment of [
      'existing.operation_id = NEW.operation_id',
      'existing.request_key = NEW.request_key',
      'existing.initial_claim_token = NEW.initial_claim_token',
    ]) assert(providerIdentity.includes(fragment), `missing provider identity clause ${fragment}`);

    for (const [trigger, authorityPrefix] of [
      ['trg_model_binding_operations_current_projection', 'WHEN NOT (NEW.rowid <> -1 OR NEW.operation_id IS NULL OR EXISTS ('],
      ['trg_model_binding_application_revision', 'WHEN NOT (NEW.seq <> -1 OR EXISTS ('],
      ['trg_model_binding_provider_desired_revision', 'WHEN NOT (NEW.command_seq <> -1 OR EXISTS ('],
      ['trg_model_binding_provider_attempt_once', 'WHEN NOT (NEW.seq <> -1 OR EXISTS ('],
      ['trg_model_binding_user_noop_projection', 'WHEN NOT (NEW.rowid <> -1 OR NEW.receipt_id IS NULL OR EXISTS ('],
      ['trg_model_binding_user_noop_provider_lineage', 'WHEN NOT (NEW.rowid <> -1 OR EXISTS ('],
    ]) {
      assert(
        normalizedTriggerSql(db, trigger).includes(authorityPrefix),
        `${trigger} does not defer to the insert authority`,
      );
    }
  });
});

await testAsync('second migration run is a no-op with an identical schema snapshot', async () => {
  await withMigratedDb(async (db) => {
    const before = schemaSnapshot(db);
    const result = await runMigrations(db);
    assertEqual(result.applied.length, 0);
    assertEqual(result.skipped.length, 57);
    assertEqual(schemaSnapshot(db), before);
  });
});

await testAsync('migration 054 preserves pre-existing success as unconfirmed evidence', async () => {
  const directory = mkdtempSync(
    path.join(process.env.INTENTSMITH_TEST_ARTIFACT_DIR, 'finalize-schema-upgrade-'),
  );
  const databasePath = path.join(directory, 'finalize.sqlite');
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  try {
    const migrations = await migrationTestInternals.discoverMigrations();
    const through053 = migrations.filter(
      migration => migration.version <= '2026_08_09_053_model_binding_append_only_identity',
    );
    migrationTestInternals.runMigrationPlan(db, through053);
    insertDesiredObservedEvent(db);
    insertDesiredBinding(db);
    const operationId = insertPreFinalizeManualRuntimeSuccess(db);
    assertEqual(db.prepare('SELECT COUNT(*) AS count FROM upgrade_history').get().count, 1);
    const beforeAttempt = JSON.stringify(db.prepare(`
      SELECT *
      FROM model_binding_application_attempts
      WHERE operation_id = ?
    `).get(operationId));

    const result = migrationTestInternals.runMigrationPlan(db, migrations);
    assertEqual(
      JSON.stringify(result.applied),
      JSON.stringify([
        '2026_08_09_054_model_binding_runtime_finalization',
        '2026_08_22_066_model_automation_policy',
      ]),
    );
    assertEqual(result.skipped.length, 55);
    assertEqual(getCurrentVersion(db), '2026_08_22_066_model_automation_policy');
    assertEqual(
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM model_binding_runtime_finalize_receipts
      `).get().count,
      0,
    );
    assertEqual(
      db.prepare(`
        SELECT max_preexisting_runtime_attempt_revision AS cutoff
        FROM model_binding_runtime_finalize_cutoffs
        WHERE operation_id = ?
      `).get(operationId).cutoff,
      1,
    );
    assertThrowsMatching(() => db.prepare(`
      INSERT INTO model_binding_runtime_finalize_receipts (
        operation_id, runtime_attempt_revision, finalization_kind,
        config_version, recovered_by_attempt_revision, created_at_ms
      ) VALUES (?, 1, 'DIRECT_CONFIRMED', 1, NULL, 3000)
    `).run(operationId), /MODEL_BINDING_RUNTIME_FINALIZE_REHYDRATE_REQUIRED/);
    assertThrowsMatching(() => db.prepare(`
      UPDATE model_binding_runtime_finalize_cutoffs
      SET max_preexisting_runtime_attempt_revision = 0
      WHERE operation_id = ?
    `).run(operationId), /migration-sealed/);
    assertEqual(JSON.stringify(db.prepare(`
      SELECT *
      FROM model_binding_application_attempts
      WHERE operation_id = ?
    `).get(operationId)), beforeAttempt);
    assertEqual(db.prepare('SELECT COUNT(*) AS count FROM upgrade_history').get().count, 1);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: false });
  }
});

await testAsync('migration 054 rejects pre-existing changed runtime success without unique history', async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    const migrations = await migrationTestInternals.discoverMigrations();
    const through053 = migrations.filter(
      migration => migration.version <= '2026_08_09_053_model_binding_append_only_identity',
    );
    migrationTestInternals.runMigrationPlan(db, through053);
    insertDesiredObservedEvent(db);
    insertDesiredBinding(db);
    insertPreFinalizeManualRuntimeSuccess(db, { includeHistory: false });
    const before = schemaSnapshot(db);

    assertThrowsMatching(
      () => installRuntimeFinalization(db),
      /pre-054 changed runtime success lacks unique durable upgrade history/,
    );
    assertEqual(schemaSnapshot(db), before);
    assert(!names(db, 'table').includes('model_binding_runtime_finalize_cutoffs'));
    assert(!names(db, 'table').includes('model_binding_runtime_finalize_receipts'));
  } finally {
    db.close();
  }
});

await testAsync('migration 054 rejects ambiguous duplicate history before schema mutation', async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    const migrations = await migrationTestInternals.discoverMigrations();
    const through053 = migrations.filter(
      migration => migration.version <= '2026_08_09_053_model_binding_append_only_identity',
    );
    migrationTestInternals.runMigrationPlan(db, through053);
    insertDesiredObservedEvent(db);
    insertDesiredBinding(db);
    insertPreFinalizeManualRuntimeSuccess(db);
    db.prepare(`
      INSERT INTO upgrade_history (
        role, from_model, to_model, score, action, created_at
      ) VALUES (
        'CHAT', 'qwen3.5:27b', 'candidate', NULL, 'apply',
        datetime(2100 / 1000, 'unixepoch')
      )
    `).run();
    const before = schemaSnapshot(db);

    assertThrowsMatching(
      () => installRuntimeFinalization(db),
      /pre-054 changed runtime success lacks unique durable upgrade history/,
    );
    assertEqual(schemaSnapshot(db), before);
    assert(!names(db, 'table').includes('model_binding_runtime_finalize_cutoffs'));
    assert(!names(db, 'table').includes('model_binding_runtime_finalize_receipts'));
  } finally {
    db.close();
  }
});

await testAsync('post-054 recovery records history missing from a pre-054 startup success', async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    const migrations = await migrationTestInternals.discoverMigrations();
    const through053 = migrations.filter(
      migration => migration.version <= '2026_08_09_053_model_binding_append_only_identity',
    );
    migrationTestInternals.runMigrationPlan(db, through053);
    insertDesiredObservedEvent(db);
    insertDesiredBinding(db);
    const operationId = insertPreFinalizeManualRuntimeSuccess(db, {
      attemptKind: 'STARTUP_REHYDRATE',
    });
    assertEqual(db.prepare('SELECT COUNT(*) AS count FROM upgrade_history').get().count, 0);
    migrationTestInternals.runMigrationPlan(db, migrations);

    let nowMs = 3000;
    const repository = createModelFailoverRepository(db, {
      clock: () => nowMs,
      ids: {
        event: () => 'unused-finalize-event-id',
        episode: () => 'unused-finalize-episode-id',
        operation: () => 'unused-finalize-operation-id',
        claimToken: () => 'unused-finalize-claim-token',
      },
    });
    repository.recordManualStartupRehydrated({
      operationId,
      expectedAttemptRevision: 1,
      observedModelName: 'candidate',
      observedDigestSha256: DIGEST_B,
      runtimeChanged: false,
    });
    nowMs = 3100;
    repository.recordManualRuntimeFinalized({
      operationId,
      expectedAttemptRevision: 2,
      configVersion: 0,
    });
    assertEqual(JSON.stringify(db.prepare(`
      SELECT role, from_model, to_model, action
      FROM upgrade_history
    `).all()), JSON.stringify([{
      role: 'CHAT',
      from_model: 'qwen3.5:27b',
      to_model: 'candidate',
      action: 'apply',
    }]));
  } finally {
    db.close();
  }
});

await testAsync('migration 054 rejects incomplete application authority before mutation', async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    const migrations = await migrationTestInternals.discoverMigrations();
    const through053 = migrations.filter(
      migration => migration.version <= '2026_08_09_053_model_binding_append_only_identity',
    );
    migrationTestInternals.runMigrationPlan(db, through053);
    db.exec('DROP TRIGGER trg_model_binding_application_current_desired');
    const before = schemaSnapshot(db);
    assertThrowsMatching(
      () => installRuntimeFinalization(db),
      /application trigger set drifted before 054/,
    );
    assertEqual(schemaSnapshot(db), before);
    assert(!names(db, 'table').includes('model_binding_runtime_finalize_cutoffs'));
    assert(!names(db, 'table').includes('model_binding_runtime_finalize_receipts'));
  } finally {
    db.close();
  }
});

await testAsync('migration 054 rejects a multiline rogue trigger before mutation', async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    const migrations = await migrationTestInternals.discoverMigrations();
    const through053 = migrations.filter(
      migration => migration.version <= '2026_08_09_053_model_binding_append_only_identity',
    );
    migrationTestInternals.runMigrationPlan(db, through053);
    db.exec(`
      CREATE TRIGGER trg_model_binding_application_rogue_multiline
      BEFORE
      INSERT
      ON model_binding_application_attempts
      BEGIN
        SELECT 1;
      END
    `);
    const before = schemaSnapshot(db);
    assertThrowsMatching(
      () => installRuntimeFinalization(db),
      /application trigger set drifted before 054/,
    );
    assertEqual(schemaSnapshot(db), before);
    assert(!names(db, 'table').includes('model_binding_runtime_finalize_cutoffs'));
    assert(!names(db, 'table').includes('model_binding_runtime_finalize_receipts'));
  } finally {
    db.close();
  }
});

await testAsync('migration 054 rejects same-name trigger SQL drift before mutation', async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  try {
    const migrations = await migrationTestInternals.discoverMigrations();
    const through053 = migrations.filter(
      migration => migration.version <= '2026_08_09_053_model_binding_append_only_identity',
    );
    migrationTestInternals.runMigrationPlan(db, through053);
    db.exec(`
      DROP TRIGGER trg_model_binding_application_append_only_delete;
      CREATE TRIGGER trg_model_binding_application_append_only_delete
      BEFORE DELETE ON model_binding_application_attempts
      WHEN OLD.operation_id = '__drifted_guard__'
      BEGIN
        SELECT RAISE(ABORT, 'drifted append-only guard');
      END
    `);
    const before = schemaSnapshot(db);
    assertThrowsMatching(
      () => installRuntimeFinalization(db),
      /application trigger SQL drifted before 054/,
    );
    assertEqual(schemaSnapshot(db), before);
    assert(!names(db, 'table').includes('model_binding_runtime_finalize_cutoffs'));
    assert(!names(db, 'table').includes('model_binding_runtime_finalize_receipts'));
  } finally {
    db.close();
  }
});

await testAsync('migration 053 preserves populated journals while adding guards', async () => {
  const directory = mkdtempSync(
    path.join(process.env.INTENTSMITH_TEST_ARTIFACT_DIR, 'failover-schema-upgrade-'),
  );
  const databasePath = path.join(directory, 'failover.sqlite');
  const db = new Database(databasePath);
  let driftDb = null;
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  try {
    const migrations = await migrationTestInternals.discoverMigrations();
    const through053 = migrations.filter(
      migration => migration.version <= '2026_08_09_053_model_binding_append_only_identity',
    );
    const pre053 = through053.filter(
      migration => migration.version !== '2026_08_09_053_model_binding_append_only_identity',
    );
    migrationTestInternals.runMigrationPlan(db, pre053);
    insertDesiredObservedEvent(db);
    insertPassingProof(db);
    const before = JSON.stringify({
      events: db.prepare('SELECT * FROM model_failover_events ORDER BY seq').all(),
      proofs: db.prepare('SELECT * FROM model_failover_proofs ORDER BY proof_id').all(),
    });

    const result = migrationTestInternals.runMigrationPlan(db, through053);
    assertEqual(
      JSON.stringify(result.applied),
      JSON.stringify(['2026_08_09_053_model_binding_append_only_identity']),
    );
    assertEqual(result.skipped.length, 54);
    assertEqual(getCurrentVersion(db), '2026_08_09_053_model_binding_append_only_identity');
    assertEqual(JSON.stringify({
      events: db.prepare('SELECT * FROM model_failover_events ORDER BY seq').all(),
      proofs: db.prepare('SELECT * FROM model_failover_proofs ORDER BY proof_id').all(),
    }), before);

    driftDb = new Database(path.join(directory, 'trigger-drift.sqlite'));
    driftDb.pragma('foreign_keys = ON');
    migrationTestInternals.runMigrationPlan(driftDb, pre053);
    const driftTrigger = driftDb.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type = 'trigger' AND name = 'trg_model_binding_application_revision'
    `).get().sql;
    driftDb.exec('DROP TRIGGER trg_model_binding_application_revision');
    driftDb.exec(driftTrigger.replace(/\bWHEN\b/i, 'WHEN 1 = 1 AND'));
    const beforeRejectedMigration = schemaSnapshot(driftDb);
    assertThrowsMatching(
      () => migrationTestInternals.runMigrationPlan(driftDb, through053),
      /BEFORE INSERT trigger SQL drifted/,
    );
    assertEqual(getCurrentVersion(driftDb), '2026_08_09_052_model_binding_provider_effects');
    assertEqual(schemaSnapshot(driftDb), beforeRejectedMigration);
  } finally {
    if (driftDb?.open) driftDb.close();
    db.close();
    rmSync(directory, { recursive: true, force: false });
  }
});

await testAsync('migration 053 rejects pre-existing impossible journal identities before mutation', async () => {
  const directory = mkdtempSync(
    path.join(process.env.INTENTSMITH_TEST_ARTIFACT_DIR, 'failover-schema-preflight-'),
  );
  try {
    const migrations = await migrationTestInternals.discoverMigrations();
    const through053 = migrations.filter(
      migration => migration.version <= '2026_08_09_053_model_binding_append_only_identity',
    );
    const pre053 = through053.filter(
      migration => migration.version !== '2026_08_09_053_model_binding_append_only_identity',
    );
    const cases = [
      {
        name: 'null-proof-identity',
        table: 'model_failover_proofs',
        expected: /MODEL_BINDING_APPEND_ONLY_PREEXISTING_IDENTITY_VIOLATION: model_failover_proofs\.proof_id/,
        seed(db) {
          insertPassingProof(db, {
            proofId: null,
            validationRunId: 'preexisting-null-proof-run',
          });
        },
      },
      {
        name: 'negative-event-sequence',
        table: 'model_failover_events',
        expected: /MODEL_BINDING_APPEND_ONLY_PREEXISTING_ORDER_VIOLATION: model_failover_events\.seq/,
        seed(db) {
          db.prepare(`
            INSERT INTO model_failover_events (
              seq, event_id, event_type, role, binding_revision, actor,
              reason_code, policy_version, desired_model_name,
              desired_digest_sha256, created_at_ms
            ) VALUES (-1, 'preexisting-negative-event', 'DESIRED_OBSERVED',
              'CHAT', 1, 'user:fixture', 'DESIRED_ARTIFACT_OBSERVED',
              'd-plus-v1', 'qwen3.5:27b', ?, 1000)
          `).run(DIGEST_A);
        },
      },
    ];

    for (const fixture of cases) {
      const db = new Database(path.join(directory, `${fixture.name}.sqlite`));
      db.pragma('foreign_keys = ON');
      try {
        migrationTestInternals.runMigrationPlan(db, pre053);
        fixture.seed(db);
        const beforeSchema = schemaSnapshot(db);
        const beforeData = JSON.stringify(
          db.prepare(`SELECT rowid, * FROM ${fixture.table} ORDER BY rowid`).all(),
        );
        assertThrowsMatching(
          () => migrationTestInternals.runMigrationPlan(db, through053),
          fixture.expected,
        );
        assertEqual(
          getCurrentVersion(db),
          '2026_08_09_052_model_binding_provider_effects',
        );
        assertEqual(schemaSnapshot(db), beforeSchema);
        assertEqual(
          JSON.stringify(
            db.prepare(`SELECT rowid, * FROM ${fixture.table} ORDER BY rowid`).all(),
          ),
          beforeData,
        );
      } finally {
        db.close();
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: false });
  }
});

await testAsync('migration 053 preflights ordering authority for every guarded journal', async () => {
  const journalAuthorities = [
    ['model_failover_proofs', 'rowid'],
    ['model_failover_events', 'seq'],
    ['model_binding_operations', 'rowid'],
    ['model_binding_application_attempts', 'seq'],
    ['model_binding_provider_operations', 'command_seq'],
    ['model_binding_provider_attempts', 'seq'],
    ['model_binding_user_noop_receipts', 'rowid'],
    ['model_binding_user_noop_provider_supersedes', 'rowid'],
  ];
  const createMinimalAuthoritySchema = db => db.exec(`
    CREATE TABLE model_failover_proofs (
      proof_id TEXT, validation_run_id TEXT, role TEXT
    );
    CREATE TABLE model_failover_events (seq INTEGER);
    CREATE TABLE model_binding_operations (operation_id TEXT);
    CREATE TABLE model_binding_application_attempts (seq INTEGER);
    CREATE TABLE model_binding_provider_operations (command_seq INTEGER);
    CREATE TABLE model_binding_provider_attempts (seq INTEGER);
    CREATE TABLE model_binding_user_noop_receipts (receipt_id TEXT);
    CREATE TABLE model_binding_user_noop_provider_supersedes (
      receipt_id TEXT, provider_operation_id TEXT
    );
  `);

  for (const [table, column] of journalAuthorities) {
    const db = new Database(':memory:');
    try {
      createMinimalAuthoritySchema(db);
      if (column === 'rowid') {
        db.prepare(`INSERT INTO ${table} (rowid) VALUES (-1)`).run();
      } else {
        db.prepare(`INSERT INTO ${table} (${column}) VALUES (-1)`).run();
      }
      const beforeSchema = schemaSnapshot(db);
      const beforeData = JSON.stringify(
        db.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all(),
      );
      assertThrowsMatching(
        () => installAppendOnlyIdentity(db),
        new RegExp(
          `MODEL_BINDING_APPEND_ONLY_PREEXISTING_ORDER_VIOLATION: ${table}\\.${column}`,
        ),
      );
      assertEqual(schemaSnapshot(db), beforeSchema);
      assertEqual(
        JSON.stringify(db.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all()),
        beforeData,
      );
    } finally {
      db.close();
    }
  }

  for (const [table, identity] of [
    ['model_failover_proofs', 'proof_id'],
    ['model_binding_operations', 'operation_id'],
    ['model_binding_user_noop_receipts', 'receipt_id'],
  ]) {
    const db = new Database(':memory:');
    try {
      createMinimalAuthoritySchema(db);
      db.prepare(`INSERT INTO ${table} (${identity}) VALUES (NULL)`).run();
      const beforeSchema = schemaSnapshot(db);
      const beforeData = JSON.stringify(
        db.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all(),
      );
      assertThrowsMatching(
        () => installAppendOnlyIdentity(db),
        new RegExp(
          `MODEL_BINDING_APPEND_ONLY_PREEXISTING_IDENTITY_VIOLATION: ${table}\\.${identity}`,
        ),
      );
      assertEqual(schemaSnapshot(db), beforeSchema);
      assertEqual(
        JSON.stringify(db.prepare(`SELECT rowid, * FROM ${table} ORDER BY rowid`).all()),
        beforeData,
      );
    } finally {
      db.close();
    }
  }
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
    assertThrowsMatching(
      () => db.prepare(`
        UPDATE model_failover_state
        SET reason_code = 'MUTATED_AFTER_RESTORE'
        WHERE role = 'CHAT'
      `).run(),
      /terminal failover state is immutable/i,
    );
    assertThrowsMatching(
      () => db.prepare("DELETE FROM model_failover_state WHERE role = 'CHAT'").run(),
      /audited terminal retirement/i,
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
    insertPassingProof(db);

    assertThrowsMatching(() => db.prepare(`
      INSERT OR REPLACE INTO model_failover_events (
        event_id, event_type, role, binding_revision, row_version, episode_id,
        operation_id, actor, reason_code, policy_version, state_before,
        state_after, desired_model_name, desired_digest_sha256,
        fallback_model_name, fallback_canonical_name, fallback_digest_sha256,
        proof_id, verified, failure_phase, details_json, created_at_ms
      )
      SELECT event_id, event_type, role, binding_revision, row_version,
        episode_id, operation_id, 'user:replacement', reason_code,
        policy_version, state_before, state_after, desired_model_name,
        desired_digest_sha256, fallback_model_name, fallback_canonical_name,
        fallback_digest_sha256, proof_id, verified, failure_phase,
        details_json, created_at_ms
      FROM model_failover_events WHERE event_id = 'event-desired-observed'
    `).run(), /MODEL_FAILOVER_EVENT_IDENTITY_CONFLICT/);
    assertEqual(
      db.prepare(`
        SELECT actor FROM model_failover_events
        WHERE event_id = 'event-desired-observed'
      `).get().actor,
      'user:fixture',
    );
    assertThrowsMatching(() => db.prepare(`
      INSERT INTO model_failover_events (
        seq, event_id, event_type, role, binding_revision, actor, reason_code,
        policy_version, desired_model_name, desired_digest_sha256, created_at_ms
      ) VALUES (999, 'event-forged-sequence', 'DESIRED_OBSERVED', 'D1', 1,
        'user:fixture', 'DESIRED_ARTIFACT_OBSERVED', 'd-plus-v1',
        'reasoner', ?, 1001)
    `).run(DIGEST_A), /MODEL_FAILOVER_EVENT_SEQUENCE_AUTHORITY/);
    assertThrowsMatching(() => db.prepare(`
      INSERT INTO model_failover_events (
        seq, event_id, event_type, role, binding_revision, actor, reason_code,
        policy_version, desired_model_name, desired_digest_sha256, created_at_ms
      ) VALUES (-1, 'event-forged-negative-sequence', 'DESIRED_OBSERVED',
        'D1', 1, 'user:fixture', 'DESIRED_ARTIFACT_OBSERVED', 'd-plus-v1',
        'reasoner', ?, 1001)
    `).run(DIGEST_A), /MODEL_FAILOVER_EVENT_SEQUENCE_AUTHORITY/);

    db.prepare(`
      INSERT INTO model_failover_events (
        event_id, event_type, role, binding_revision, operation_id, actor,
        reason_code, policy_version, created_at_ms
      ) VALUES ('event-operation-identity-source', 'ACTIVATION_CLAIMED',
        'D1', 1, 'event-operation-identity-0001', 'system:binding-integrity',
        'FAILOVER_OPERATION_CLAIMED', 'd-plus-v1', 1001)
    `).run();
    assertThrowsMatching(() => db.prepare(`
      INSERT INTO model_failover_events (
        event_id, event_type, role, binding_revision, operation_id, actor,
        reason_code, policy_version, created_at_ms
      ) VALUES ('event-operation-identity-replacement', 'ACTIVATION_CLAIMED',
        'D1', 1, 'event-operation-identity-0001', 'system:binding-integrity',
        'FAILOVER_OPERATION_CLAIMED', 'd-plus-v1', 1001)
    `).run(), /MODEL_FAILOVER_EVENT_IDENTITY_CONFLICT/);

    assertThrowsMatching(() => db.prepare(`
      INSERT OR REPLACE INTO model_failover_proofs (
        proof_id, validation_run_id, role, suite, role_contract_sha256,
        model_name, model_canonical_name, model_digest_sha256,
        validation_version, policy_version, score, required_score,
        passed_count, required_passed_count, total_count, duration_ms, result,
        inventory_before_name, inventory_before_digest, inventory_after_name,
        inventory_after_digest, started_at_ms, completed_at_ms, expires_at_ms,
        created_at_ms
      )
      SELECT proof_id, validation_run_id, role, suite, role_contract_sha256,
        model_name, model_canonical_name, model_digest_sha256,
        'v123.replaced', policy_version, score, required_score,
        passed_count, required_passed_count, total_count, duration_ms, result,
        inventory_before_name, inventory_before_digest, inventory_after_name,
        inventory_after_digest, started_at_ms, completed_at_ms, expires_at_ms,
        created_at_ms
      FROM model_failover_proofs WHERE proof_id = 'proof-fixture-0001'
    `).run(), /MODEL_FAILOVER_PROOF_IDENTITY_CONFLICT/);
    assertEqual(
      db.prepare(`
        SELECT validation_version FROM model_failover_proofs
        WHERE proof_id = 'proof-fixture-0001'
      `).get().validation_version,
      'v123.1',
    );
    assertThrowsMatching(() => db.prepare(`
      INSERT OR REPLACE INTO model_failover_proofs (
        proof_id, validation_run_id, role, suite, role_contract_sha256,
        model_name, model_canonical_name, model_digest_sha256,
        validation_version, policy_version, score, required_score,
        passed_count, required_passed_count, total_count, duration_ms, result,
        inventory_before_name, inventory_before_digest, inventory_after_name,
        inventory_after_digest, started_at_ms, completed_at_ms, expires_at_ms,
        created_at_ms
      )
      SELECT 'proof-validation-role-conflict', validation_run_id, role, suite,
        role_contract_sha256, model_name, model_canonical_name,
        model_digest_sha256, validation_version, policy_version, score,
        required_score, passed_count, required_passed_count, total_count,
        duration_ms, result, inventory_before_name, inventory_before_digest,
        inventory_after_name, inventory_after_digest, started_at_ms,
        completed_at_ms, expires_at_ms, created_at_ms
      FROM model_failover_proofs WHERE proof_id = 'proof-fixture-0001'
    `).run(), /MODEL_FAILOVER_PROOF_IDENTITY_CONFLICT/);
    assertThrowsMatching(() => db.prepare(`
      INSERT OR REPLACE INTO model_failover_proofs (
        rowid, proof_id, validation_run_id, role, suite, role_contract_sha256,
        model_name, model_canonical_name, model_digest_sha256,
        validation_version, policy_version, score, required_score,
        passed_count, required_passed_count, total_count, duration_ms, result,
        inventory_before_name, inventory_before_digest, inventory_after_name,
        inventory_after_digest, started_at_ms, completed_at_ms, expires_at_ms,
        created_at_ms
      )
      SELECT rowid, 'proof-rowid-replacement', 'proof-rowid-replacement-run',
        role, suite, role_contract_sha256, model_name, model_canonical_name,
        model_digest_sha256, validation_version, policy_version, score,
        required_score, passed_count, required_passed_count, total_count,
        duration_ms, result, inventory_before_name, inventory_before_digest,
        inventory_after_name, inventory_after_digest, started_at_ms,
        completed_at_ms, expires_at_ms, created_at_ms
      FROM model_failover_proofs WHERE proof_id = 'proof-fixture-0001'
    `).run(), /MODEL_FAILOVER_PROOF_ROWID_AUTHORITY/);
    assertThrowsMatching(() => db.prepare(`
      INSERT INTO model_failover_proofs (
        rowid, proof_id, validation_run_id, role, suite, role_contract_sha256,
        model_name, model_canonical_name, model_digest_sha256,
        validation_version, policy_version, score, required_score,
        passed_count, required_passed_count, total_count, duration_ms, result,
        inventory_before_name, inventory_before_digest, inventory_after_name,
        inventory_after_digest, started_at_ms, completed_at_ms, expires_at_ms,
        created_at_ms
      )
      SELECT -1, 'proof-negative-rowid', 'proof-negative-rowid-run', role,
        suite, role_contract_sha256, model_name, model_canonical_name,
        model_digest_sha256, validation_version, policy_version, score,
        required_score, passed_count, required_passed_count, total_count,
        duration_ms, result, inventory_before_name, inventory_before_digest,
        inventory_after_name, inventory_after_digest, started_at_ms,
        completed_at_ms, expires_at_ms, created_at_ms
      FROM model_failover_proofs WHERE proof_id = 'proof-fixture-0001'
    `).run(), /MODEL_FAILOVER_PROOF_ROWID_AUTHORITY/);
    assertThrowsMatching(() => db.prepare(`
      INSERT INTO model_failover_proofs (
        proof_id, validation_run_id, role, suite, role_contract_sha256,
        model_name, model_canonical_name, model_digest_sha256,
        validation_version, policy_version, score, required_score,
        passed_count, required_passed_count, total_count, duration_ms, result,
        inventory_before_name, inventory_before_digest, inventory_after_name,
        inventory_after_digest, started_at_ms, completed_at_ms, expires_at_ms,
        created_at_ms
      )
      SELECT NULL, 'proof-null-identity-run', role, suite,
        role_contract_sha256, model_name, model_canonical_name,
        model_digest_sha256, validation_version, policy_version, score,
        required_score, passed_count, required_passed_count, total_count,
        duration_ms, result, inventory_before_name, inventory_before_digest,
        inventory_after_name, inventory_after_digest, started_at_ms,
        completed_at_ms, expires_at_ms, created_at_ms
      FROM model_failover_proofs WHERE proof_id = 'proof-fixture-0001'
    `).run(), /MODEL_FAILOVER_PROOF_IDENTITY_REQUIRED/);
    assertEqual(
      db.prepare('SELECT COUNT(*) AS count FROM model_failover_proofs').get().count,
      1,
    );

    insertDesiredBinding(db);

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
