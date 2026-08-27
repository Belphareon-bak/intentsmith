// Audited local model failover repository.
//
// This checkpoint owns desired-binding observation, manual binding intent,
// incident detection, bounded operation claims and append-only outcomes from
// the separate binding application service. The repository records effects;
// it deliberately does not execute a provider call, runtime mutation,
// verification, broadcast, automatic failover or scheduler work itself.

import { createHash, randomUUID } from 'node:crypto';
import { readModelAutomationPolicy } from '../db/model-policy.js';
import { canonicalModelName } from './model-identity.js';

export const MODEL_FAILOVER_POLICY_VERSION = 'd-plus-v1';
export const MODEL_FAILOVER_ACTOR = 'system:binding-integrity';
export const MAX_MODEL_FAILOVER_CLAIM_MS = 5 * 60 * 1000;
export const MAX_MODEL_BINDING_PROVIDER_CLAIM_MS = 5 * 60 * 1000;
export const MODEL_BINDING_VERIFICATION_METHOD = 'OLLAMA_CHAT_EXACT_DIGEST_V1';

export const MODEL_FAILOVER_ROLES = Object.freeze([
  'D1',
  'D2',
  'CODE',
  'R1',
  'R2',
  'CHAT',
  'VISION',
]);

const ROLES = new Set(MODEL_FAILOVER_ROLES);
const OBSERVABLE_DESIRED_SOURCES = new Set([
  'CONFIG_DEFAULT',
  'LEGACY_OVERRIDE',
]);
const MANUAL_DESIRED_SOURCES = new Set(['USER_APPLY', 'USER_ROLLBACK']);
const PROVIDER_REQUEST_PURPOSES = new Set([
  'USER_APPLY_TARGET',
  'LEGACY_BASELINE_RECOVERY',
]);
const APPLICATION_RUNTIME_KINDS = new Set(['RUNTIME_APPLY', 'STARTUP_REHYDRATE']);
const APPLICATION_FAILURE_POLICY = Object.freeze({
  RUNTIME_APPLY: Object.freeze({
    MODEL_BINDING_PROVIDER_UNAVAILABLE: true,
    MODEL_BINDING_TARGET_NOT_INSTALLED: true,
    MODEL_BINDING_TARGET_DIGEST_MISSING: false,
    MODEL_BINDING_TARGET_DIGEST_DRIFT: false,
    MODEL_BINDING_ARTIFACT_IN_USE: true,
    MODEL_BINDING_RUNTIME_COMMIT_FAILED: true,
  }),
  STARTUP_REHYDRATE: Object.freeze({
    MODEL_BINDING_REHYDRATE_TARGET_UNAVAILABLE: true,
    MODEL_BINDING_REHYDRATE_DIGEST_DRIFT: false,
    MODEL_BINDING_REHYDRATE_RUNTIME_COMMIT_FAILED: true,
  }),
  VERIFICATION: Object.freeze({
    MODEL_BINDING_VERIFICATION_PROVIDER_UNAVAILABLE: true,
    MODEL_BINDING_VERIFICATION_REJECTED: true,
    MODEL_BINDING_VERIFICATION_DIGEST_DRIFT: false,
  }),
  NOTIFICATION: Object.freeze({
    MODEL_BINDING_NOTIFICATION_DELIVERY_FAILED: false,
    MODEL_BINDING_NOTIFICATION_RECEIPT_NOT_ISSUED: false,
  }),
});
const PROVIDER_PULL_FAILURE_POLICY = Object.freeze({
  MODEL_BINDING_PROVIDER_UNAVAILABLE: true,
  MODEL_BINDING_PROVIDER_PULL_FAILED: true,
  MODEL_BINDING_TARGET_NOT_INSTALLED: true,
  MODEL_BINDING_TARGET_DIGEST_MISSING: false,
  MODEL_BINDING_TARGET_AMBIGUOUS: false,
  MODEL_BINDING_TARGET_DIGEST_DRIFT: false,
});
const CLAIMS = Object.freeze({
  ACTIVATE: Object.freeze({
    eventType: 'ACTIVATION_CLAIMED',
    allowedState: 'DETECTED',
    activeFailover: 0,
  }),
  RESTORE: Object.freeze({
    eventType: 'RESTORE_CLAIMED',
    allowedState: 'ACTIVATED',
    activeFailover: 1,
  }),
  REAPPLY: Object.freeze({
    eventType: 'REAPPLY_CLAIMED',
    allowedState: 'ACTIVATED',
    activeFailover: 1,
  }),
});
const TERMINAL_OPERATIONS = Object.freeze({
  ACTIVATE: Object.freeze({
    successEventType: 'ACTIVATED',
    failureEventType: 'ACTIVATION_FAILED',
    successReasonCode: 'LOCAL_FAILOVER_ACTIVATED',
    failureReasonCode: 'LOCAL_FAILOVER_ACTIVATION_FAILED',
    stateBefore: 'DETECTED',
    stateAfter: 'ACTIVATED',
    activeBefore: 0,
    activeAfter: 1,
  }),
  RESTORE: Object.freeze({
    successEventType: 'RESTORED',
    failureEventType: 'RESTORE_FAILED',
    successReasonCode: 'DESIRED_MODEL_RESTORED',
    failureReasonCode: 'DESIRED_MODEL_RESTORE_FAILED',
    stateBefore: 'ACTIVATED',
    stateAfter: 'RESTORED',
    activeBefore: 1,
    activeAfter: 0,
  }),
  REAPPLY: Object.freeze({
    successEventType: 'REAPPLIED',
    failureEventType: 'REAPPLY_FAILED',
    successReasonCode: 'LOCAL_FAILOVER_REAPPLIED',
    failureReasonCode: 'LOCAL_FAILOVER_REAPPLY_FAILED',
    stateBefore: 'ACTIVATED',
    stateAfter: 'ACTIVATED',
    activeBefore: 1,
    activeAfter: 1,
  }),
});
const FAILOVER_FAILURE_PHASES = new Set([
  'VERIFICATION',
  'PERSISTENCE',
  'RUNTIME_APPLY',
  'RESTORE',
  'REHYDRATE',
]);
const DEFAULT_IDS = Object.freeze({
  event: () => `evt_${randomUUID()}`,
  episode: () => `ep_${randomUUID()}`,
  operation: () => `op_${randomUUID()}`,
  claimToken: () => `claim_${randomUUID()}`,
});
// Migration 053 owns these exact fail-closed signals.  SQLite reports a
// RAISE(ABORT, ...) trigger as SQLITE_CONSTRAINT_TRIGGER, so the extended
// result code alone cannot distinguish an identity collision from any other
// storage-contract trigger.  Keep this allowlist exact: a broad trigger match
// would misclassify business-constraint failures as generated-ID conflicts.
const APPEND_ONLY_IDENTITY_CONFLICT_SIGNALS = new Set([
  'MODEL_FAILOVER_PROOF_IDENTITY_CONFLICT',
  'MODEL_FAILOVER_EVENT_IDENTITY_CONFLICT',
  'MODEL_BINDING_OPERATION_IDENTITY_CONFLICT',
  'MODEL_BINDING_APPLICATION_IDENTITY_CONFLICT',
  'MODEL_BINDING_PROVIDER_OPERATION_IDENTITY_CONFLICT',
  'MODEL_BINDING_PROVIDER_ATTEMPT_IDENTITY_CONFLICT',
  'MODEL_BINDING_USER_NOOP_APPEND_ONLY_CONFLICT',
  'MODEL_BINDING_USER_NOOP_PROVIDER_SUPERSEDES_CONFLICT',
]);

function hasOwnedAppendOnlyIdentityConflictSignal(error) {
  if (error?.code !== 'SQLITE_CONSTRAINT_TRIGGER' || typeof error.message !== 'string') {
    return false;
  }
  for (const signal of APPEND_ONLY_IDENTITY_CONFLICT_SIGNALS) {
    if (error.message.startsWith(`${signal}:`)) return true;
  }
  return false;
}

export class ModelFailoverRepositoryError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'ModelFailoverRepositoryError';
    this.code = code;
    this.details = options.details || null;
  }
}

function fail(code, message, details = null) {
  throw new ModelFailoverRepositoryError(code, message, { details });
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireInput(value) {
  if (!isPlainObject(value)) {
    fail('MODEL_FAILOVER_INPUT_INVALID', 'Model failover input must be a plain object');
  }
  return value;
}

function requireCoordinatorPolicy(db, required) {
  if (!required) return;
  // Decision 020/E: the generic settings document can no longer answer this.
  const policy = readModelAutomationPolicy(db);
  if (policy.valid !== true || policy.policy?.autoFailoverEnabled !== true) {
    fail(
      'MODEL_FAILOVER_AUTO_FAILOVER_DISABLED',
      'Automatic failover policy is not enabled inside the write transaction',
      { reason: policy.reason || 'AUTO_FAILOVER_DISABLED' },
    );
  }
}

function rejectAuthorityOverrides(input, fields) {
  const supplied = fields.filter(field => Object.hasOwn(input, field));
  if (supplied.length > 0) {
    fail(
      'MODEL_FAILOVER_AUTHORITY_OVERRIDE_REJECTED',
      'Repository-owned authority fields cannot be supplied by the caller',
      { fields: supplied },
    );
  }
}

function requireExactInputFields(input, allowedFields) {
  const unexpected = Object.keys(input)
    .filter(field => !allowedFields.includes(field))
    .sort();
  if (unexpected.length > 0) {
    fail(
      'MODEL_FAILOVER_AUTHORITY_OVERRIDE_REJECTED',
      'Repository-owned or unknown fields cannot be supplied by the caller',
      { fields: unexpected },
    );
  }
}

function requireString(value, field, { min = 1, max = 128 } = {}) {
  if (typeof value !== 'string') {
    fail('MODEL_FAILOVER_INPUT_INVALID', `${field} must be a string`, { field });
  }
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    fail('MODEL_FAILOVER_INPUT_INVALID', `${field} has an invalid length`, { field });
  }
  return normalized;
}

function requireRole(value) {
  const role = requireString(value, 'role', { max: 16 }).toUpperCase();
  if (!ROLES.has(role)) {
    fail('MODEL_FAILOVER_ROLE_INVALID', 'Unknown model role', { role });
  }
  return role;
}

function requireUserActor(value) {
  const actor = requireString(value, 'actor');
  if (!/^user:[^\s]+$/u.test(actor)) {
    fail('MODEL_FAILOVER_ACTOR_INVALID', 'Manual binding actor must use a user: identity', {
      actor,
    });
  }
  return actor;
}

function requireProviderOrigin(value) {
  const origin = requireString(value, 'providerOrigin', { max: 256 });
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    fail('MODEL_BINDING_PROVIDER_ORIGIN_INVALID', 'providerOrigin must be a valid URL');
  }
  if (parsed.protocol !== 'http:'
    || !new Set(['127.0.0.1', 'localhost', '[::1]']).has(parsed.hostname)
    || parsed.username
    || parsed.password
    || parsed.port === '0'
    || parsed.origin !== origin
    || (parsed.pathname !== '/' && parsed.pathname !== '')) {
    fail(
      'MODEL_BINDING_PROVIDER_ORIGIN_INVALID',
      'providerOrigin must be a canonical uncredentialed loopback HTTP origin',
      { providerOrigin: origin },
    );
  }
  return parsed.origin;
}

function requireDigest(value, field = 'digestSha256') {
  const digest = requireString(value, field, { min: 64, max: 64 });
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    fail('MODEL_FAILOVER_DIGEST_INVALID', `${field} must be lowercase SHA-256`, { field });
  }
  return digest;
}

function requireContractHash(value, field = 'roleContractSha256') {
  return requireDigest(value, field);
}

function requireBoolean(value, field) {
  if (typeof value !== 'boolean') {
    fail('MODEL_FAILOVER_INPUT_INVALID', `${field} must be a boolean`, { field });
  }
  return value;
}

function claimTokenSha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('MODEL_FAILOVER_INPUT_INVALID', `${field} must be a positive safe integer`, { field });
  }
  return value;
}

function requireNonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('MODEL_FAILOVER_INPUT_INVALID', `${field} must be a non-negative safe integer`, { field });
  }
  return value;
}

function incrementSafeInteger(value, field) {
  requirePositiveInteger(value, field);
  const incremented = value + 1;
  if (!Number.isSafeInteger(incremented)) {
    fail('MODEL_FAILOVER_INPUT_INVALID', `${field} cannot be incremented safely`, { field });
  }
  return incremented;
}

function incrementNonNegativeSafeInteger(value, field) {
  requireNonNegativeInteger(value, field);
  const incremented = value + 1;
  if (!Number.isSafeInteger(incremented)) {
    fail('MODEL_FAILOVER_INPUT_INVALID', `${field} cannot be incremented safely`, { field });
  }
  return incremented;
}

function providerClaimExpiry(nowMs) {
  const expiresAtMs = nowMs + MAX_MODEL_BINDING_PROVIDER_CLAIM_MS;
  if (!Number.isSafeInteger(expiresAtMs)) {
    fail(
      'MODEL_BINDING_PROVIDER_CLAIM_WINDOW_INVALID',
      'Provider effect claim expiry overflows safe time',
    );
  }
  return expiresAtMs;
}

function requireDatabase(db) {
  if (!db
    || typeof db.prepare !== 'function'
    || typeof db.transaction !== 'function') {
    fail('MODEL_FAILOVER_DB_INVALID', 'A better-sqlite3 database is required');
  }
  return db;
}

function mapDesired(row) {
  if (!row) return null;
  return {
    role: row.role,
    modelName: row.model_name,
    canonicalName: row.canonical_name,
    digestSha256: row.digest_sha256,
    bindingRevision: row.binding_revision,
    source: row.source,
    actor: row.actor,
    observedAtMs: row.observed_at_ms,
    updatedAtMs: row.updated_at_ms,
    lastEventId: row.last_event_id,
  };
}

function mapState(row, { includeClaimToken = false } = {}) {
  if (!row) return null;
  const mapped = {
    role: row.role,
    desiredRevision: row.desired_revision,
    episodeId: row.episode_id,
    state: row.state,
    activeFailover: row.active_failover === 1,
    fallbackModelName: row.fallback_model_name,
    fallbackCanonicalName: row.fallback_canonical_name,
    fallbackDigestSha256: row.fallback_digest_sha256,
    proofId: row.proof_id,
    activeEventId: row.active_event_id,
    policyVersion: row.policy_version,
    actor: row.actor,
    reasonCode: row.reason_code,
    failurePhase: row.failure_phase,
    proofVerifiedAtMs: row.proof_verified_at_ms,
    rowVersion: row.row_version,
    claimOperationId: row.claim_operation_id,
    claimPresent: row.claim_token !== null,
    claimKind: row.claim_kind,
    claimStartedAtMs: row.claim_started_at_ms,
    claimExpiresAtMs: row.claim_expires_at_ms,
    detectedAtMs: row.detected_at_ms,
    activatedAtMs: row.activated_at_ms,
    resolvedAtMs: row.resolved_at_ms,
    updatedAtMs: row.updated_at_ms,
    lastEventId: row.last_event_id,
  };
  if (includeClaimToken) mapped.claimToken = row.claim_token;
  return mapped;
}

function mapEvent(row) {
  let details;
  try {
    details = JSON.parse(row.details_json);
  } catch (error) {
    throw new ModelFailoverRepositoryError(
      'MODEL_FAILOVER_CORRUPT_STORAGE',
      'Model failover event details are not valid JSON',
      { cause: error, details: { eventId: row.event_id } },
    );
  }
  if (!isPlainObject(details)) {
    fail('MODEL_FAILOVER_CORRUPT_STORAGE', 'Model failover event details are not an object', {
      eventId: row.event_id,
    });
  }
  return {
    seq: row.seq,
    eventId: row.event_id,
    eventType: row.event_type,
    role: row.role,
    bindingRevision: row.binding_revision,
    rowVersion: row.row_version,
    episodeId: row.episode_id,
    operationId: row.operation_id,
    actor: row.actor,
    reasonCode: row.reason_code,
    policyVersion: row.policy_version,
    stateBefore: row.state_before,
    stateAfter: row.state_after,
    desiredModelName: row.desired_model_name,
    desiredDigestSha256: row.desired_digest_sha256,
    fallbackModelName: row.fallback_model_name,
    fallbackCanonicalName: row.fallback_canonical_name,
    fallbackDigestSha256: row.fallback_digest_sha256,
    proofId: row.proof_id,
    verified: row.verified === 1,
    failurePhase: row.failure_phase,
    details,
    createdAtMs: row.created_at_ms,
  };
}

function mapProof(row) {
  if (!row) return null;
  return Object.freeze({
    proofId: row.proof_id,
    validationRunId: row.validation_run_id,
    role: row.role,
    suite: row.suite,
    roleContractSha256: row.role_contract_sha256,
    modelName: row.model_name,
    modelCanonicalName: row.model_canonical_name,
    modelDigestSha256: row.model_digest_sha256,
    validationVersion: row.validation_version,
    policyVersion: row.policy_version,
    score: row.score,
    requiredScore: row.required_score,
    passedCount: row.passed_count,
    requiredPassedCount: row.required_passed_count,
    totalCount: row.total_count,
    durationMs: row.duration_ms,
    result: row.result,
    startedAtMs: row.started_at_ms,
    completedAtMs: row.completed_at_ms,
    expiresAtMs: row.expires_at_ms,
    createdAtMs: row.created_at_ms,
    measurementArtifactSha256: row.measurement_artifact_sha256,
    acceptanceArtifactSha256: row.acceptance_artifact_sha256,
    sourceRevision: row.source_revision,
  });
}

function mapRuntimeFinalization(row) {
  if (!row) return null;
  return Object.freeze({
    operationId: row.operation_id,
    terminalEventId: row.terminal_event_id,
    eventType: row.event_type,
    role: row.role,
    episodeId: row.episode_id,
    targetModelName: row.event_type === 'RESTORED'
      ? row.desired_model_name
      : row.fallback_model_name,
    targetCanonicalName: row.event_type === 'RESTORED'
      ? canonicalModelName(row.desired_model_name)
      : row.fallback_canonical_name,
    targetDigestSha256: row.event_type === 'RESTORED'
      ? row.desired_digest_sha256
      : row.fallback_digest_sha256,
    transitionCreatedAtMs: row.transition_created_at_ms,
    status: row.receipt_id === null ? 'UNKNOWN' : row.finalize_kind,
    receiptId: row.receipt_id,
    configVersion: row.config_version,
    finalizedAtMs: row.finalized_at_ms,
  });
}

function mapRuntimeHealth(row) {
  if (!row) return null;
  const expired = row.proof_expires_at_ms <= row.observed_now_ms;
  return Object.freeze({
    role: row.role,
    episodeId: row.episode_id,
    activeEventId: row.active_event_id,
    proofId: row.proof_id,
    proofExpiresAtMs: row.proof_expires_at_ms,
    status: row.health_status || (expired ? 'PROOF_EXPIRED_UNRECORDED' : 'HEALTHY'),
    observedAtMs: row.health_observed_at_ms,
  });
}

function mapBindingOperation(row) {
  if (!row) return null;
  let details;
  try {
    details = JSON.parse(row.details_json);
  } catch (error) {
    throw new ModelFailoverRepositoryError(
      'MODEL_FAILOVER_CORRUPT_STORAGE',
      'Model binding operation details are not valid JSON',
      { cause: error, details: { operationId: row.operation_id } },
    );
  }
  if (!isPlainObject(details)) {
    fail('MODEL_FAILOVER_CORRUPT_STORAGE', 'Model binding operation details are not an object', {
      operationId: row.operation_id,
    });
  }
  return {
    operationId: row.operation_id,
    requestKey: row.request_key,
    role: row.role,
    kind: row.operation_kind,
    expectedBindingRevision: row.expected_binding_revision,
    committedBindingRevision: row.committed_binding_revision,
    previousModelName: row.previous_model_name,
    previousCanonicalName: row.previous_canonical_name,
    previousDigestSha256: row.previous_digest_sha256,
    targetModelName: row.target_model_name,
    targetCanonicalName: row.target_canonical_name,
    targetDigestSha256: row.target_digest_sha256,
    predecessorOperationId: row.predecessor_operation_id,
    rollbackOfOperationId: row.rollback_of_operation_id,
    verificationStatus: row.verification_status,
    runtimeStatus: row.runtime_status,
    desiredEventId: row.desired_event_id,
    actor: row.actor,
    reasonCode: row.reason_code,
    policyVersion: row.policy_version,
    details,
    createdAtMs: row.created_at_ms,
  };
}

function mapBindingApplicationAttempt(row) {
  if (!row) return null;
  return {
    seq: row.seq,
    operationId: row.operation_id,
    attemptRevision: row.attempt_revision,
    kind: row.attempt_kind,
    outcome: row.outcome,
    observedModelName: row.observed_model_name,
    observedCanonicalName: row.observed_canonical_name,
    observedDigestSha256: row.observed_digest_sha256,
    verificationMethod: row.verification_method,
    failureCode: row.failure_code,
    retryable: row.retryable === 1,
    runtimeChanged: row.runtime_changed === 1,
    createdAtMs: row.created_at_ms,
  };
}

function mapBindingRuntimeFinalizeReceipt(row) {
  if (!row) return null;
  return {
    seq: row.seq,
    operationId: row.operation_id,
    runtimeAttemptRevision: row.runtime_attempt_revision,
    kind: row.finalization_kind,
    configVersion: row.config_version,
    recoveredByAttemptRevision: row.recovered_by_attempt_revision,
    createdAtMs: row.created_at_ms,
  };
}

function deriveBindingApplicationState(operationRow, attemptRows, finalizeRows = []) {
  if (!operationRow) return null;
  const attempts = attemptRows.map(mapBindingApplicationAttempt);
  const runtimeFinalizeReceipts = finalizeRows.map(mapBindingRuntimeFinalizeReceipt);
  const runtimeAttempts = attempts.filter(attempt => APPLICATION_RUNTIME_KINDS.has(attempt.kind));
  const runtimeAttempt = runtimeAttempts.at(-1) || null;
  const unresolvedRuntimeAttempt = [...runtimeAttempts].reverse().find(attempt => (
    attempt.outcome === 'SUCCEEDED'
      && !runtimeFinalizeReceipts.some(receipt => (
        receipt.runtimeAttemptRevision === attempt.attemptRevision
      ))
  )) || null;
  const runtimeFinalizeReceipt = runtimeAttempt?.outcome === 'SUCCEEDED'
    ? runtimeFinalizeReceipts.find(receipt => (
      receipt.runtimeAttemptRevision === runtimeAttempt.attemptRevision
        && receipt.kind === 'DIRECT_CONFIRMED'
    )) || null
    : null;
  const runtimeFinalized = runtimeFinalizeReceipt !== null;
  const verificationAttempt = runtimeAttempt?.outcome === 'SUCCEEDED' && runtimeFinalized
    ? [...attempts]
      .reverse()
      .find(attempt => attempt.kind === 'VERIFICATION'
        && attempt.attemptRevision > runtimeAttempt.attemptRevision) || null
    : null;
  const notificationAttempt = runtimeFinalized
    ? [...attempts]
      .reverse()
      .find(attempt => attempt.kind === 'NOTIFICATION') || null
    : null;

  let state = 'PENDING';
  let runtimeStatus = 'NOT_APPLIED';
  let runtimeFinalizeStatus = 'NOT_REQUIRED';
  let verificationStatus = 'NOT_VERIFIED';
  let failurePhase = null;
  let failureCode = null;
  let retryable = false;

  if (unresolvedRuntimeAttempt) {
    state = 'RUNTIME_RECONCILIATION_REQUIRED';
    runtimeStatus = 'APPLIED';
    runtimeFinalizeStatus = 'UNKNOWN';
    failurePhase = 'RUNTIME_FINALIZE';
    failureCode = 'MODEL_BINDING_RUNTIME_RECONCILIATION_REQUIRED';
    retryable = true;
  } else if (runtimeAttempt?.outcome === 'FAILED') {
    state = 'FAILED';
    runtimeStatus = 'FAILED';
    failurePhase = runtimeAttempt.kind;
    failureCode = runtimeAttempt.failureCode;
    retryable = runtimeAttempt.retryable;
  } else if (runtimeAttempt?.outcome === 'SUCCEEDED') {
    runtimeStatus = 'APPLIED';
    if (runtimeFinalized) {
      runtimeFinalizeStatus = 'DIRECT_CONFIRMED';
      state = 'APPLIED_PENDING_VERIFICATION';
      if (verificationAttempt?.outcome === 'SUCCEEDED') {
        state = 'VERIFIED';
        verificationStatus = 'VERIFIED';
      } else if (verificationAttempt?.outcome === 'FAILED') {
        state = 'FAILED';
        verificationStatus = 'FAILED';
        failurePhase = 'VERIFICATION';
        failureCode = verificationAttempt.failureCode;
        retryable = verificationAttempt.retryable;
      }
    }
  }

  return {
    operationId: operationRow.operation_id,
    role: operationRow.role,
    kind: operationRow.operation_kind,
    committedBindingRevision: operationRow.committed_binding_revision,
    state,
    runtimeStatus,
    runtimeFinalizeStatus,
    verificationStatus,
    failurePhase,
    failureCode,
    retryable,
    attemptRevision: attempts.at(-1)?.attemptRevision ?? 0,
    lastRuntimeAttempt: runtimeAttempt,
    lastUnresolvedRuntimeAttempt: unresolvedRuntimeAttempt,
    lastRuntimeFinalizeReceipt: runtimeFinalizeReceipt,
    lastVerificationAttempt: verificationAttempt,
    notificationStatus: notificationAttempt
      ? notificationAttempt.outcome
      : 'NOT_RECORDED',
    notificationFailureCode: notificationAttempt?.failureCode ?? null,
    attempts,
    runtimeFinalizeReceipts,
  };
}

function requireBindingApplicationFailure(kind, value) {
  const failureCode = requireString(value, 'failureCode', { min: 3, max: 96 }).toUpperCase();
  const policy = APPLICATION_FAILURE_POLICY[kind];
  if (!policy || !Object.hasOwn(policy, failureCode)) {
    fail(
      'MODEL_BINDING_APPLICATION_FAILURE_CODE_INVALID',
      'Application failure code is not allowed for this attempt kind',
      { kind, failureCode },
    );
  }
  return {
    failureCode,
    retryable: policy[failureCode],
  };
}

function committedDesiredFromOperation(row) {
  return {
    role: row.role,
    modelName: row.target_model_name,
    canonicalName: row.target_canonical_name,
    digestSha256: row.target_digest_sha256,
    bindingRevision: row.committed_binding_revision,
    source: row.operation_kind,
    actor: row.actor,
    observedAtMs: row.created_at_ms,
    updatedAtMs: row.created_at_ms,
    lastEventId: row.desired_event_id,
  };
}

export class ModelFailoverRepository {
  constructor(db, options = {}) {
    this.db = requireDatabase(db);
    if (!isPlainObject(options)) {
      fail('MODEL_FAILOVER_OPTIONS_INVALID', 'Repository options must be a plain object');
    }
    this.clock = options.clock ?? Date.now;
    if (typeof this.clock !== 'function') {
      fail('MODEL_FAILOVER_OPTIONS_INVALID', 'Repository clock must be a function');
    }
    const ids = options.ids ?? DEFAULT_IDS;
    if (!isPlainObject(ids)) {
      fail('MODEL_FAILOVER_OPTIONS_INVALID', 'Repository ID factory must be a plain object');
    }
    for (const key of ['event', 'episode', 'operation', 'claimToken']) {
      if (typeof ids[key] !== 'function') {
        fail('MODEL_FAILOVER_OPTIONS_INVALID', `Repository ID factory is missing ${key}`);
      }
    }
    this.ids = ids;
    this.providerOperationId = typeof ids.providerOperation === 'function'
      ? ids.providerOperation
      : ids.operation;
  }

  #now(operation) {
    let value;
    try {
      value = this.clock();
    } catch (error) {
      throw new ModelFailoverRepositoryError(
        'MODEL_FAILOVER_CLOCK_FAILED',
        `Model failover ${operation} clock failed`,
        { cause: error, details: { operation } },
      );
    }
    if (!Number.isSafeInteger(value) || value < 1) {
      fail('MODEL_FAILOVER_CLOCK_INVALID', 'Repository clock returned an invalid time', {
        operation,
      });
    }
    return value;
  }

  #id(kind, { min = 1 } = {}) {
    let value;
    try {
      value = this.ids[kind]();
    } catch (error) {
      throw new ModelFailoverRepositoryError(
        'MODEL_FAILOVER_ID_FACTORY_FAILED',
        `Model failover ${kind} ID factory failed`,
        { cause: error, details: { kind } },
      );
    }
    return requireString(value, `${kind}Id`, { min });
  }

  #nextProviderOperationId() {
    let value;
    try {
      value = this.providerOperationId();
    } catch (error) {
      throw new ModelFailoverRepositoryError(
        'MODEL_FAILOVER_ID_FACTORY_FAILED',
        'Model binding provider operation ID factory failed',
        { cause: error, details: { kind: 'providerOperation' } },
      );
    }
    return requireString(value, 'providerOperationId', { min: 16 });
  }

  #read(operation, callback) {
    try {
      return callback();
    } catch (error) {
      if (error instanceof ModelFailoverRepositoryError) throw error;
      if (typeof error?.code === 'string'
        && (error.code.startsWith('SQLITE_BUSY') || error.code.startsWith('SQLITE_LOCKED'))) {
        throw new ModelFailoverRepositoryError(
          'MODEL_FAILOVER_DB_BUSY',
          `Model failover ${operation} read could not acquire the database`,
          { cause: error, details: { operation, sqliteCode: error.code } },
        );
      }
      throw new ModelFailoverRepositoryError(
        'MODEL_FAILOVER_DB_READ_FAILED',
        `Model failover ${operation} read failed`,
        { cause: error, details: { operation } },
      );
    }
  }

  #write(operation, callback) {
    if (this.db.inTransaction) {
      fail(
        'MODEL_FAILOVER_TRANSACTION_OWNERSHIP_REQUIRED',
        `Model failover ${operation} must own the top-level database transaction`,
        { operation },
      );
    }
    const transaction = this.db.transaction(callback);
    try {
      return transaction.immediate();
    } catch (error) {
      if (error instanceof ModelFailoverRepositoryError) throw error;
      const sqliteCode = typeof error?.code === 'string' ? error.code : null;
      if (sqliteCode?.startsWith('SQLITE_BUSY') || sqliteCode?.startsWith('SQLITE_LOCKED')) {
        throw new ModelFailoverRepositoryError(
          'MODEL_FAILOVER_DB_BUSY',
          `Model failover ${operation} transaction could not acquire the database`,
          { cause: error, details: { operation, sqliteCode } },
        );
      }
      const ownedAppendOnlyIdentityConflict = hasOwnedAppendOnlyIdentityConflictSignal(error);
      if (sqliteCode === 'SQLITE_CONSTRAINT_UNIQUE'
        || sqliteCode === 'SQLITE_CONSTRAINT_PRIMARYKEY'
        || ownedAppendOnlyIdentityConflict) {
        throw new ModelFailoverRepositoryError(
          'MODEL_FAILOVER_ID_CONFLICT',
          `Model failover ${operation} generated a conflicting identity`,
          { cause: error, details: { operation, sqliteCode } },
        );
      }
      if (sqliteCode?.startsWith('SQLITE_CONSTRAINT')) {
        throw new ModelFailoverRepositoryError(
          'MODEL_FAILOVER_STORAGE_CONTRACT',
          `Model failover ${operation} violated the storage contract`,
          { cause: error, details: { operation, sqliteCode } },
        );
      }
      throw new ModelFailoverRepositoryError(
        'MODEL_FAILOVER_DB_WRITE_FAILED',
        `Model failover ${operation} transaction failed`,
        { cause: error, details: { operation } },
      );
    }
  }

  #desiredRow(role) {
    return this.db.prepare(
      'SELECT * FROM model_desired_bindings WHERE role = ?'
    ).get(role);
  }

  #stateRow(role) {
    return this.db.prepare(
      'SELECT * FROM model_failover_state WHERE role = ?'
    ).get(role);
  }

  #bindingOperationRow(operationId) {
    return this.db.prepare(
      'SELECT * FROM model_binding_operations WHERE operation_id = ?'
    ).get(operationId);
  }

  #bindingOperationByRequestKey(requestKey) {
    return this.db.prepare(
      'SELECT * FROM model_binding_operations WHERE request_key = ?'
    ).get(requestKey);
  }

  #bindingNoopByRequestKey(requestKey) {
    return this.db.prepare(
      'SELECT * FROM model_binding_user_noop_receipts WHERE request_key = ?'
    ).get(requestKey);
  }

  #bindingNoopSupersededProviderOperationIds(receiptId) {
    return this.db.prepare(`
      SELECT superseded.provider_operation_id
      FROM model_binding_user_noop_provider_supersedes superseded
      JOIN model_binding_provider_operations provider
        ON provider.operation_id = superseded.provider_operation_id
      WHERE superseded.receipt_id = ?
      ORDER BY provider.command_seq
    `).all(receiptId).map(row => row.provider_operation_id);
  }

  #mapBindingNoop(row) {
    if (!row) return null;
    return {
      receiptId: row.receipt_id,
      requestKey: row.request_key,
      role: row.role,
      bindingRevision: row.binding_revision,
      modelName: row.model_name,
      canonicalName: row.canonical_name,
      digestSha256: row.digest_sha256,
      actor: row.actor,
      providerCommandCutoffSeq: row.provider_command_cutoff_seq,
      sourceProviderOperationId: row.source_provider_operation_id,
      supersededProviderOperationIds:
        this.#bindingNoopSupersededProviderOperationIds(row.receipt_id),
      createdAtMs: row.created_at_ms,
    };
  }

  #desiredFromBindingNoop(row) {
    if (!row) return null;
    return {
      role: row.role,
      modelName: row.model_name,
      canonicalName: row.canonical_name,
      digestSha256: row.digest_sha256,
      bindingRevision: row.binding_revision,
      source: row.desired_source,
      actor: row.desired_actor,
      observedAtMs: row.desired_observed_at_ms,
      updatedAtMs: row.desired_updated_at_ms,
      lastEventId: row.desired_last_event_id,
    };
  }

  #bindingApplicationAttemptRows(operationId) {
    return this.db.prepare(`
      SELECT *
      FROM model_binding_application_attempts
      WHERE operation_id = ?
      ORDER BY attempt_revision
    `).all(operationId);
  }

  #bindingRuntimeFinalizeRows(operationId) {
    return this.db.prepare(`
      SELECT *
      FROM model_binding_runtime_finalize_receipts
      WHERE operation_id = ?
      ORDER BY runtime_attempt_revision, seq
    `).all(operationId);
  }

  #bindingApplicationState(operationRow) {
    return deriveBindingApplicationState(
      operationRow,
      operationRow ? this.#bindingApplicationAttemptRows(operationRow.operation_id) : [],
      operationRow ? this.#bindingRuntimeFinalizeRows(operationRow.operation_id) : [],
    );
  }

  #providerOperationRow(operationId) {
    return this.db.prepare(
      'SELECT * FROM model_binding_provider_operations WHERE operation_id = ?'
    ).get(operationId);
  }

  #unresolvedProviderSuccesses(role, expectedBindingRevision) {
    return this.db.prepare(`
      SELECT provider.operation_id, provider.request_key, provider.requested_model_name,
             provider.actor, terminal.observed_canonical_name,
             terminal.observed_digest_sha256
      FROM model_binding_provider_operations provider
      JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      LEFT JOIN model_binding_operations binding
        ON binding.request_key = provider.request_key
      WHERE provider.role = ?
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = ?
        AND terminal.outcome IN ('SUCCEEDED','RECONCILED_PRESENT')
        AND binding.operation_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = provider.operation_id
        )
      ORDER BY provider.command_seq
    `).all(role, expectedBindingRevision);
  }

  #pendingProviderOperation(role, expectedBindingRevision) {
    return this.db.prepare(`
      SELECT provider.operation_id, provider.requested_model_name
      FROM model_binding_provider_operations provider
      LEFT JOIN model_binding_provider_attempts terminal
        ON terminal.operation_id = provider.operation_id
      WHERE provider.role = ?
        AND provider.request_purpose = 'USER_APPLY_TARGET'
        AND provider.expected_binding_revision = ?
        AND terminal.operation_id IS NULL
      ORDER BY provider.command_seq
      LIMIT 1
    `).get(role, expectedBindingRevision);
  }

  #failForPendingProviderOperation(pending, details = {}) {
    if (!pending) return;
    fail(
      'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS',
      'Binding authority cannot advance during a live provider command',
      {
        ...details,
        providerOperationId: pending.operation_id,
        requestedModelName: pending.requested_model_name,
      },
    );
  }

  #failForUnresolvedProviderSuccess(unresolved, details = {}) {
    if (!unresolved) return;
    fail(
      'MODEL_BINDING_PROVIDER_UNRESOLVED_SUCCESS',
      'Resolve or explicitly supersede the earlier provider success before changing the binding',
      {
        ...details,
        providerOperationId: unresolved.operation_id,
        requestedModelName: unresolved.requested_model_name,
      },
    );
  }

  #mapProviderOperation(row) {
    if (!row) return null;
    const attempt = this.db.prepare(`
      SELECT * FROM model_binding_provider_attempts
      WHERE operation_id = ?
      ORDER BY attempt_revision DESC
      LIMIT 1
    `).get(row.operation_id);
    const claim = this.db.prepare(`
      SELECT * FROM model_binding_provider_claims
      WHERE operation_id = ?
    `).get(row.operation_id);
    return {
      operationId: row.operation_id,
      commandSeq: row.command_seq,
      requestKey: row.request_key,
      role: row.role,
      kind: row.effect_kind,
      requestPurpose: row.request_purpose,
      expectedBindingRevision: row.expected_binding_revision,
      providerOrigin: row.provider_origin,
      requestedModelName: row.requested_model_name,
      requestedCanonicalName: row.requested_canonical_name,
      actor: row.actor,
      createdAtMs: row.created_at_ms,
      claim: claim ? {
        claimToken: claim.claim_token,
        fencingRevision: claim.fencing_revision,
        leaseExpiresAtMs: claim.lease_expires_at_ms,
        updatedAtMs: claim.updated_at_ms,
      } : null,
      terminal: attempt ? {
        outcome: attempt.outcome,
        observedModelName: attempt.observed_model_name,
        observedCanonicalName: attempt.observed_canonical_name,
        observedDigestSha256: attempt.observed_digest_sha256,
        failureCode: attempt.failure_code,
        retryable: attempt.retryable === 1,
        fencingRevision: attempt.fencing_revision,
        createdAtMs: attempt.created_at_ms,
      } : null,
    };
  }

  #mappedBindingOperation(operationRow) {
    if (!operationRow) return null;
    return {
      ...mapBindingOperation(operationRow),
      applicationState: this.#bindingApplicationState(operationRow),
    };
  }

  #currentManualOperation(desired) {
    if (!desired || !MANUAL_DESIRED_SOURCES.has(desired.source)) return null;
    const operation = this.db.prepare(`
      SELECT *
      FROM model_binding_operations
      WHERE role = ? AND operation_kind = ? AND committed_binding_revision = ?
        AND target_model_name = ? AND target_canonical_name = ?
        AND target_digest_sha256 = ? AND actor = ? AND desired_event_id = ?
      LIMIT 1
    `).get(
      desired.role,
      desired.source,
      desired.binding_revision,
      desired.model_name,
      desired.canonical_name,
      desired.digest_sha256,
      desired.actor,
      desired.last_event_id,
    );
    if (!operation) {
      fail('MODEL_FAILOVER_CORRUPT_STORAGE', 'Manual desired binding has no exact operation lineage', {
        role: desired.role,
        bindingRevision: desired.binding_revision,
      });
    }
    return operation;
  }

  #retireSupersededIncident(state) {
    if (!state || state.state !== 'SUPERSEDED_BY_USER') return false;
    const retired = this.db.prepare(`
      DELETE FROM model_failover_state
      WHERE role = ? AND desired_revision = ? AND episode_id = ?
        AND row_version = ? AND state = ? AND active_failover = 0
        AND last_event_id = ?
    `).run(
      state.role,
      state.desired_revision,
      state.episode_id,
      state.row_version,
      state.state,
      state.last_event_id,
    );
    if (retired.changes !== 1) {
      fail('MODEL_FAILOVER_STALE_STATE', 'Closed failover projection changed before retirement', {
        role: state.role,
        episodeId: state.episode_id,
        rowVersion: state.row_version,
      });
    }
    return true;
  }

  #requireManualSupersedableIncident(incident, {
    role,
    expectedBindingRevision,
    desired,
  }) {
    if (!incident) return;
    if (incident.state === 'FAILED') {
      fail(
        'MODEL_FAILOVER_FAILED_INCIDENT_REQUIRES_RUNTIME_COORDINATOR',
        'A failed failover incident requires explicit runtime recovery before manual binding',
        {
          role,
          episodeId: incident.episode_id,
          state: incident.state,
          activeFailover: incident.active_failover === 1,
          failurePhase: incident.failure_phase,
          retryableNow: false,
          retryPrerequisite: 'RUNTIME_COORDINATOR_RECOVERY',
        },
      );
    }
    if (incident.state === 'RESTORED') {
      fail(
        'MODEL_FAILOVER_RESTORED_INCIDENT_REQUIRES_RUNTIME_COORDINATOR',
        'A restored failover incident requires explicit runtime retirement before manual binding',
        {
          role,
          episodeId: incident.episode_id,
          state: incident.state,
          activeFailover: incident.active_failover === 1,
          failurePhase: incident.failure_phase,
          retryableNow: false,
          retryPrerequisite: 'AUDITED_TERMINAL_RETIREMENT',
        },
      );
    }
    if (incident.state !== 'DETECTED' || incident.active_failover !== 0) {
      fail(
        'MODEL_FAILOVER_ACTIVE_INCIDENT_REQUIRES_RUNTIME_COORDINATOR',
        'Manual binding cannot supersede an active or non-detected incident without runtime coordination',
        { role, episodeId: incident.episode_id, state: incident.state },
      );
    }
    if (incident.desired_revision !== expectedBindingRevision) {
      fail('MODEL_FAILOVER_STALE_DESIRED', 'Incident desired revision no longer matches', {
        role,
        expectedBindingRevision,
        actualBindingRevision: incident.desired_revision,
      });
    }
    if (incident.policy_version !== MODEL_FAILOVER_POLICY_VERSION) {
      fail('MODEL_FAILOVER_POLICY_MISMATCH', 'Failover incident policy is not current', {
        role,
        actualPolicyVersion: incident.policy_version,
      });
    }
    const claimAbsent = incident.claim_operation_id === null
      && incident.claim_token === null
      && incident.claim_kind === null
      && incident.claim_started_at_ms === null
      && incident.claim_expires_at_ms === null;
    const activateClaimComplete = incident.claim_operation_id !== null
      && incident.claim_token !== null
      && incident.claim_kind === 'ACTIVATE'
      && incident.claim_started_at_ms !== null
      && incident.claim_expires_at_ms !== null;
    const detectedMetadataValid = incident.actor === MODEL_FAILOVER_ACTOR
      && incident.reason_code === 'BOUND_MODEL_NOT_INSTALLED'
      && incident.fallback_model_name === null
      && incident.fallback_canonical_name === null
      && incident.fallback_digest_sha256 === null
      && incident.proof_id === null
      && incident.active_event_id === null
      && incident.failure_phase === null
      && incident.proof_verified_at_ms === null
      && incident.activated_at_ms === null
      && incident.resolved_at_ms === null;
    const originEvents = this.db.prepare(`
      SELECT *
      FROM model_failover_events
      WHERE event_type = 'DETECTED' AND role = ? AND binding_revision = ?
        AND row_version = 1 AND episode_id = ? AND operation_id IS NULL
        AND actor = ? AND reason_code = 'BOUND_MODEL_NOT_INSTALLED'
        AND policy_version = ? AND state_before IS NULL
        AND state_after = 'DETECTED' AND desired_model_name = ?
        AND desired_digest_sha256 = ? AND fallback_model_name IS NULL
        AND fallback_canonical_name IS NULL AND fallback_digest_sha256 IS NULL
        AND proof_id IS NULL AND verified = 0 AND failure_phase IS NULL
        AND details_json = '{}' AND created_at_ms = ?
    `).all(
      role,
      expectedBindingRevision,
      incident.episode_id,
      MODEL_FAILOVER_ACTOR,
      MODEL_FAILOVER_POLICY_VERSION,
      desired.model_name,
      desired.digest_sha256,
      incident.detected_at_ms,
    );
    const origin = originEvents.length === 1 ? originEvents[0] : null;
    const current = this.db.prepare(
      'SELECT * FROM model_failover_events WHERE event_id = ?'
    ).get(incident.last_event_id);
    const currentCommonValid = current
      && current.role === role
      && current.binding_revision === expectedBindingRevision
      && current.row_version === incident.row_version
      && current.episode_id === incident.episode_id
      && current.actor === MODEL_FAILOVER_ACTOR
      && current.policy_version === MODEL_FAILOVER_POLICY_VERSION
      && current.state_after === 'DETECTED'
      && current.desired_model_name === desired.model_name
      && current.desired_digest_sha256 === desired.digest_sha256
      && current.fallback_model_name === null
      && current.fallback_canonical_name === null
      && current.fallback_digest_sha256 === null
      && current.proof_id === null
      && current.verified === 0
      && current.failure_phase === null
      && current.details_json === '{}'
      && current.created_at_ms === incident.updated_at_ms;
    let currentLineageValid = false;
    if (currentCommonValid && claimAbsent) {
      if (incident.row_version === 1) {
        currentLineageValid = current.event_id === origin?.event_id
          && current.event_type === 'DETECTED'
          && current.operation_id === null
          && current.state_before === null
          && current.reason_code === 'BOUND_MODEL_NOT_INSTALLED'
          && incident.updated_at_ms === incident.detected_at_ms;
      } else if (current.event_type === 'CLAIM_EXPIRED'
        && current.operation_id !== null
        && current.state_before === 'DETECTED'
        && current.reason_code === 'EXPIRED_CLAIM_RELEASED') {
        const claimed = this.db.prepare(`
          SELECT 1 AS present
          FROM model_failover_events
          WHERE event_type = 'ACTIVATION_CLAIMED' AND operation_id = ?
            AND role = ? AND binding_revision = ? AND row_version = ?
            AND episode_id = ? AND actor = ?
            AND reason_code = 'FAILOVER_OPERATION_CLAIMED'
            AND policy_version = ? AND state_before = 'DETECTED'
            AND state_after = 'DETECTED' AND desired_model_name = ?
            AND desired_digest_sha256 = ? AND fallback_model_name IS NULL
            AND fallback_canonical_name IS NULL AND fallback_digest_sha256 IS NULL
            AND proof_id IS NULL AND verified = 0 AND failure_phase IS NULL
            AND details_json = '{}' AND created_at_ms < ?
        `).get(
          current.operation_id,
          role,
          expectedBindingRevision,
          incident.row_version - 1,
          incident.episode_id,
          MODEL_FAILOVER_ACTOR,
          MODEL_FAILOVER_POLICY_VERSION,
          desired.model_name,
          desired.digest_sha256,
          current.created_at_ms,
        );
        currentLineageValid = Boolean(claimed);
      }
    } else if (currentCommonValid && activateClaimComplete) {
      currentLineageValid = current.event_type === 'ACTIVATION_CLAIMED'
        && current.operation_id === incident.claim_operation_id
        && current.state_before === 'DETECTED'
        && current.reason_code === 'FAILOVER_OPERATION_CLAIMED'
        && current.created_at_ms === incident.claim_started_at_ms;
    }
    if ((!claimAbsent && !activateClaimComplete)
      || !detectedMetadataValid
      || originEvents.length !== 1
      || !currentLineageValid) {
      fail('MODEL_FAILOVER_CORRUPT_STORAGE', 'Detected incident is not safe for manual supersede', {
        role,
        episodeId: incident.episode_id,
      });
    }
  }

  #manualResult(outcome, operationRow) {
    return {
      outcome,
      kind: operationRow.operation_kind,
      operation: this.#mappedBindingOperation(operationRow),
      committedDesired: committedDesiredFromOperation(operationRow),
      currentDesired: mapDesired(this.#desiredRow(operationRow.role)),
      requestKeyConsumed: true,
    };
  }

  #replayManualOperation(operation, expected) {
    const commonMatches = operation.role === expected.role
      && operation.operation_kind === expected.kind
      && operation.expected_binding_revision === expected.expectedBindingRevision
      && operation.actor === expected.actor;
    const semanticMatches = expected.kind === 'USER_APPLY'
      ? operation.target_canonical_name === expected.targetCanonicalName
        && operation.target_digest_sha256 === expected.targetDigestSha256
      : operation.rollback_of_operation_id === expected.rollbackOfOperationId;
    if (!commonMatches || !semanticMatches) {
      fail('MODEL_FAILOVER_REQUEST_KEY_CONFLICT', 'Manual binding request key has different semantics', {
        requestKey: expected.requestKey,
      });
    }
    return this.#manualResult('REPLAYED', operation);
  }

  #recordManualBinding({
    requestKey,
    role,
    kind,
    actor,
    desired,
    targetModelName,
    targetCanonicalName,
    targetDigestSha256,
    predecessorOperationId,
    rollbackOfOperationId = null,
    incident,
  }) {
    const nowMs = this.#now(kind === 'USER_APPLY'
      ? 'recordUserBindingApply'
      : 'recordUserBindingRollback');
    if (nowMs < desired.updated_at_ms) {
      fail('MODEL_FAILOVER_CLOCK_ROLLBACK', 'Repository clock moved before desired binding', {
        role,
        nowMs,
        updatedAtMs: desired.updated_at_ms,
      });
    }
    if (incident && nowMs < incident.updated_at_ms) {
      fail('MODEL_FAILOVER_CLOCK_ROLLBACK', 'Repository clock moved before failover incident', {
        role,
        nowMs,
        updatedAtMs: incident.updated_at_ms,
      });
    }

    const operationId = this.#id('operation');
    const desiredEventId = this.#id('event');
    const supersedeEventId = incident ? this.#id('event') : null;
    const committedBindingRevision = incrementSafeInteger(
      desired.binding_revision,
      'bindingRevision',
    );
    const reasonCode = kind === 'USER_APPLY'
      ? 'USER_MODEL_BINDING_APPLIED'
      : 'USER_MODEL_BINDING_ROLLED_BACK';

    this.db.prepare(`
      INSERT INTO model_failover_events (
        event_id, event_type, role, binding_revision, operation_id, actor,
        reason_code, policy_version, desired_model_name, desired_digest_sha256,
        verified, details_json, created_at_ms
      ) VALUES (?, 'DESIRED_CHANGED', ?, ?, ?, ?, ?, ?, ?, ?, 0, '{}', ?)
    `).run(
      desiredEventId,
      role,
      committedBindingRevision,
      operationId,
      actor,
      reasonCode,
      MODEL_FAILOVER_POLICY_VERSION,
      targetModelName,
      targetDigestSha256,
      nowMs,
    );

    this.db.prepare(`
      INSERT INTO model_binding_operations (
        operation_id, request_key, role, operation_kind,
        expected_binding_revision, committed_binding_revision,
        previous_model_name, previous_canonical_name, previous_digest_sha256,
        target_model_name, target_canonical_name, target_digest_sha256,
        predecessor_operation_id, rollback_of_operation_id,
        verification_status, runtime_status, desired_event_id, actor,
        reason_code, policy_version, details_json, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        'NOT_VERIFIED', 'NOT_APPLIED', ?, ?, ?, ?, '{}', ?)
    `).run(
      operationId,
      requestKey,
      role,
      kind,
      desired.binding_revision,
      committedBindingRevision,
      desired.model_name,
      desired.canonical_name,
      desired.digest_sha256,
      targetModelName,
      targetCanonicalName,
      targetDigestSha256,
      predecessorOperationId,
      rollbackOfOperationId,
      desiredEventId,
      actor,
      reasonCode,
      MODEL_FAILOVER_POLICY_VERSION,
      nowMs,
    );

    // The state FK uses ON UPDATE RESTRICT so SQLite checks it at the desired
    // revision statement unless this transaction explicitly defers all FKs.
    // The final state update below restores the exact role/revision target;
    // COMMIT and the explicit foreign_key_check both remain fail-closed.
    this.db.prepare('PRAGMA defer_foreign_keys = ON').run();

    const desiredUpdate = this.db.prepare(`
      UPDATE model_desired_bindings
      SET model_name = ?, canonical_name = ?, digest_sha256 = ?,
          binding_revision = ?, source = ?, actor = ?, observed_at_ms = ?,
          updated_at_ms = ?, last_event_id = ?
      WHERE role = ? AND binding_revision = ? AND model_name = ?
        AND canonical_name = ? AND digest_sha256 = ? AND last_event_id = ?
    `).run(
      targetModelName,
      targetCanonicalName,
      targetDigestSha256,
      committedBindingRevision,
      kind,
      actor,
      nowMs,
      nowMs,
      desiredEventId,
      role,
      desired.binding_revision,
      desired.model_name,
      desired.canonical_name,
      desired.digest_sha256,
      desired.last_event_id,
    );
    if (desiredUpdate.changes !== 1) {
      fail('MODEL_FAILOVER_STALE_DESIRED', 'Manual binding lost its desired-state CAS', {
        role,
        expectedBindingRevision: desired.binding_revision,
      });
    }

    if (incident) {
      const nextRowVersion = incrementSafeInteger(incident.row_version, 'rowVersion');
      this.db.prepare(`
        INSERT INTO model_failover_events (
          event_id, event_type, role, binding_revision, row_version, episode_id,
          operation_id, actor, reason_code, policy_version, state_before,
          state_after, desired_model_name, desired_digest_sha256,
          fallback_model_name, fallback_canonical_name, fallback_digest_sha256,
          proof_id, verified, details_json, created_at_ms
        ) VALUES (?, 'SUPERSEDED_BY_USER', ?, ?, ?, ?, ?, ?,
          'USER_BINDING_SUPERSEDED_FAILOVER', ?, ?, 'SUPERSEDED_BY_USER', ?, ?,
          ?, ?, ?, ?, 0, '{}', ?)
      `).run(
        supersedeEventId,
        role,
        committedBindingRevision,
        nextRowVersion,
        incident.episode_id,
        operationId,
        actor,
        MODEL_FAILOVER_POLICY_VERSION,
        incident.state,
        targetModelName,
        targetDigestSha256,
        incident.fallback_model_name,
        incident.fallback_canonical_name,
        incident.fallback_digest_sha256,
        incident.proof_id,
        nowMs,
      );
      const superseded = this.db.prepare(`
        UPDATE model_failover_state
        SET desired_revision = ?, state = 'SUPERSEDED_BY_USER',
            active_failover = 0, fallback_model_name = NULL,
            fallback_canonical_name = NULL, fallback_digest_sha256 = NULL,
            proof_id = NULL, active_event_id = NULL, actor = ?,
            reason_code = 'USER_BINDING_SUPERSEDED_FAILOVER',
            failure_phase = NULL, proof_verified_at_ms = NULL,
            row_version = ?, claim_operation_id = NULL, claim_token = NULL,
            claim_kind = NULL, claim_started_at_ms = NULL,
            claim_expires_at_ms = NULL, resolved_at_ms = ?, updated_at_ms = ?,
            last_event_id = ?
        WHERE role = ? AND desired_revision = ? AND episode_id = ?
          AND row_version = ? AND state = 'DETECTED' AND active_failover = 0
          AND policy_version = ?
          AND claim_operation_id IS ? AND claim_token IS ? AND claim_kind IS ?
          AND claim_started_at_ms IS ? AND claim_expires_at_ms IS ?
      `).run(
        committedBindingRevision,
        actor,
        nextRowVersion,
        nowMs,
        nowMs,
        supersedeEventId,
        role,
        desired.binding_revision,
        incident.episode_id,
        incident.row_version,
        MODEL_FAILOVER_POLICY_VERSION,
        incident.claim_operation_id,
        incident.claim_token,
        incident.claim_kind,
        incident.claim_started_at_ms,
        incident.claim_expires_at_ms,
      );
      if (superseded.changes !== 1) {
        fail('MODEL_FAILOVER_STALE_STATE', 'Manual binding lost its incident-state CAS', {
          role,
          episodeId: incident.episode_id,
          expectedRowVersion: incident.row_version,
        });
      }
    }

    const foreignKeyViolation = this.db.prepare('PRAGMA foreign_key_check').get();
    if (foreignKeyViolation) {
      fail('MODEL_FAILOVER_STORAGE_CONTRACT', 'Manual binding left an invalid foreign-key projection', {
        table: foreignKeyViolation.table,
        rowid: foreignKeyViolation.rowid,
        parent: foreignKeyViolation.parent,
        foreignKeyId: foreignKeyViolation.fkid,
      });
    }

    return this.#manualResult('RECORDED', this.#bindingOperationRow(operationId));
  }

  #recordBindingApplicationAttempt({
    operationName,
    operationId,
    expectedAttemptRevision,
    kind,
    outcome,
    observedModelName = null,
    observedDigestSha256 = null,
    failureCode = null,
    runtimeChanged = false,
  }) {
    return this.#write(operationName, () => {
      const operation = this.#bindingOperationRow(operationId);
      if (!operation) {
        fail(
          'MODEL_FAILOVER_BINDING_OPERATION_MISSING',
          'Binding application operation does not exist',
          { operationId },
        );
      }

      const attempts = this.#bindingApplicationAttemptRows(operationId);
      const currentAttemptRevision = attempts.at(-1)?.attempt_revision ?? 0;
      const observedCanonicalName = observedModelName === null
        ? null
        : canonicalModelName(observedModelName);
      if (observedModelName !== null && !observedCanonicalName) {
        fail(
          'MODEL_FAILOVER_MODEL_NAME_INVALID',
          'observedModelName has no canonical identity',
        );
      }
      const digest = observedDigestSha256 === null
        ? null
        : requireDigest(observedDigestSha256, 'observedDigestSha256');
      const verificationMethod = kind === 'VERIFICATION'
        ? MODEL_BINDING_VERIFICATION_METHOD
        : null;
      const failure = outcome === 'FAILED'
        ? requireBindingApplicationFailure(kind, failureCode)
        : { failureCode: null, retryable: false };

      const replay = attempts.find(
        attempt => attempt.attempt_revision === expectedAttemptRevision + 1,
      );
      if (replay) {
        const matches = replay.attempt_kind === kind
          && replay.outcome === outcome
          && replay.observed_model_name === observedModelName
          && replay.observed_canonical_name === observedCanonicalName
          && replay.observed_digest_sha256 === digest
          && replay.verification_method === verificationMethod
          && replay.failure_code === failure.failureCode
          && replay.retryable === (failure.retryable ? 1 : 0)
          && replay.runtime_changed === (runtimeChanged ? 1 : 0);
        if (matches) {
          return {
            outcome: 'REPLAYED',
            attempt: mapBindingApplicationAttempt(replay),
            applicationState: this.#bindingApplicationState(operation),
          };
        }
      }
      if (currentAttemptRevision !== expectedAttemptRevision) {
        fail(
          'MODEL_BINDING_APPLICATION_STALE_ATTEMPT',
          'Binding application attempt revision no longer matches',
          {
            operationId,
            expectedAttemptRevision,
            actualAttemptRevision: currentAttemptRevision,
          },
        );
      }
      if (kind === 'RUNTIME_APPLY' && attempts.some(attempt => (
        APPLICATION_RUNTIME_KINDS.has(attempt.attempt_kind)
          && attempt.outcome === 'SUCCEEDED'
      ))) {
        fail(
          'MODEL_BINDING_APPLICATION_TRANSITION_INVALID',
          'Runtime apply cannot repeat after a successful runtime commit',
          { operationId, kind, currentAttemptRevision },
        );
      }
      if (APPLICATION_RUNTIME_KINDS.has(kind)) {
        const lastRuntimeSuccessRevision = attempts
          .filter(attempt => APPLICATION_RUNTIME_KINDS.has(attempt.attempt_kind)
            && attempt.outcome === 'SUCCEEDED')
          .at(-1)?.attempt_revision ?? 0;
        const terminalFailure = attempts.find(attempt => (
          APPLICATION_RUNTIME_KINDS.has(attempt.attempt_kind)
          && attempt.outcome === 'FAILED'
          && attempt.retryable === 0
          && attempt.attempt_revision > lastRuntimeSuccessRevision
        ));
        if (terminalFailure) {
          fail(
            'MODEL_BINDING_APPLICATION_NONRETRYABLE_TERMINAL',
            'No later runtime attempt is allowed after a non-retryable failure',
            {
              operationId,
              failureCode: terminalFailure.failure_code,
              currentAttemptRevision,
            },
          );
        }
      }

      const attemptRevision = incrementNonNegativeSafeInteger(
        expectedAttemptRevision,
        'expectedAttemptRevision',
      );
      const createdAtMs = this.#now(operationName);
      this.db.prepare(`
        INSERT INTO model_binding_application_attempts (
          operation_id, attempt_revision, attempt_kind, outcome,
          observed_model_name, observed_canonical_name, observed_digest_sha256,
          verification_method, failure_code, retryable, created_at_ms,
          runtime_changed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        operationId,
        attemptRevision,
        kind,
        outcome,
        observedModelName,
        observedCanonicalName,
        digest,
        verificationMethod,
        failure.failureCode,
        failure.retryable ? 1 : 0,
        createdAtMs,
        runtimeChanged ? 1 : 0,
      );

      if (APPLICATION_RUNTIME_KINDS.has(kind) && outcome === 'SUCCEEDED') {
        this.db.prepare(`
          INSERT INTO model_overrides (
            role, model, previous_model, score, applied_by, applied_at,
            verified, binding_operation_id, model_canonical_name,
            model_digest_sha256, verification_status
          ) VALUES (?, ?, ?, NULL, ?, datetime(? / 1000, 'unixepoch'),
            0, ?, ?, ?, 'PENDING')
          ON CONFLICT(role) DO UPDATE SET
            model = excluded.model,
            previous_model = excluded.previous_model,
            score = excluded.score,
            applied_by = excluded.applied_by,
            applied_at = excluded.applied_at,
            verified = 0,
            binding_operation_id = excluded.binding_operation_id,
            model_canonical_name = excluded.model_canonical_name,
            model_digest_sha256 = excluded.model_digest_sha256,
            verification_status = 'PENDING'
        `).run(
          operation.role,
          operation.target_model_name,
          operation.previous_model_name,
          operation.actor,
          createdAtMs,
          operation.operation_id,
          operation.target_canonical_name,
          operation.target_digest_sha256,
        );
      } else if (kind === 'STARTUP_REHYDRATE' && outcome === 'FAILED') {
        const updated = this.db.prepare(`
          UPDATE model_overrides
          SET verified = 0, verification_status = 'FAILED'
          WHERE role = ? AND binding_operation_id = ?
            AND model = ? AND model_canonical_name = ?
            AND model_digest_sha256 = ?
        `).run(
          operation.role,
          operation.operation_id,
          operation.target_model_name,
          operation.target_canonical_name,
          operation.target_digest_sha256,
        );
        const existingOverride = this.db.prepare(`
          SELECT binding_operation_id, verification_status
          FROM model_overrides
          WHERE role = ?
        `).get(operation.role);
        const preservedPriorAuthority = existingOverride
          && existingOverride.binding_operation_id !== operation.operation_id;
        if (updated.changes !== 1 && existingOverride && !preservedPriorAuthority) {
          fail(
            'MODEL_BINDING_APPLICATION_OVERRIDE_MISMATCH',
            'Rehydrate failure target is not the active compatibility override',
            { operationId, role: operation.role },
          );
        }
      } else if (kind === 'VERIFICATION') {
        const verificationStatus = outcome === 'SUCCEEDED' ? 'VERIFIED' : 'FAILED';
        const verified = outcome === 'SUCCEEDED' ? 1 : 0;
        const updated = this.db.prepare(`
          UPDATE model_overrides
          SET verified = ?, verification_status = ?
          WHERE role = ? AND binding_operation_id = ?
            AND model = ? AND model_canonical_name = ?
            AND model_digest_sha256 = ?
        `).run(
          verified,
          verificationStatus,
          operation.role,
          operation.operation_id,
          operation.target_model_name,
          operation.target_canonical_name,
          operation.target_digest_sha256,
        );
        if (updated.changes !== 1) {
          fail(
            'MODEL_BINDING_APPLICATION_OVERRIDE_MISMATCH',
            'Verification target is not the active compatibility override',
            { operationId, role: operation.role },
          );
        }
      }

      const attempt = this.db.prepare(`
        SELECT *
        FROM model_binding_application_attempts
        WHERE operation_id = ? AND attempt_revision = ?
      `).get(operationId, attemptRevision);
      return {
        outcome: 'RECORDED',
        attempt: mapBindingApplicationAttempt(attempt),
        applicationState: this.#bindingApplicationState(operation),
      };
    });
  }

  getDesired(roleValue) {
    const role = requireRole(roleValue);
    return this.#read('getDesired', () => mapDesired(this.#desiredRow(role)));
  }

  getState(roleValue) {
    const role = requireRole(roleValue);
    return this.#read('getState', () => mapState(this.#stateRow(role)));
  }

  getBindingOperation(operationIdValue) {
    const operationId = requireString(operationIdValue, 'operationId', { min: 16 });
    return this.#read(
      'getBindingOperation',
      () => this.#mappedBindingOperation(this.#bindingOperationRow(operationId)),
    );
  }

  getBindingApplicationState(operationIdValue) {
    const operationId = requireString(operationIdValue, 'operationId', { min: 16 });
    return this.#read('getBindingApplicationState', () => {
      const operation = this.#bindingOperationRow(operationId);
      if (!operation) return null;
      return this.#bindingApplicationState(operation);
    });
  }

  listCurrentManualBindingsForRehydrate() {
    return this.#read('listCurrentManualBindingsForRehydrate', () => this.db.prepare(`
      SELECT operation.*
      FROM model_binding_operations operation
      JOIN model_desired_bindings desired
        ON desired.role = operation.role
       AND desired.binding_revision = operation.committed_binding_revision
       AND desired.model_name = operation.target_model_name
       AND desired.canonical_name = operation.target_canonical_name
       AND desired.digest_sha256 = operation.target_digest_sha256
       AND desired.source = operation.operation_kind
       AND desired.actor = operation.actor
       AND desired.last_event_id = operation.desired_event_id
      ORDER BY operation.role
    `).all().map(operation => this.#mappedBindingOperation(operation)));
  }

  listLegacyOverridesForRehydrate() {
    return this.#read('listLegacyOverridesForRehydrate', () => this.db.prepare(`
      SELECT role, model, previous_model, applied_at
      FROM model_overrides
      WHERE binding_operation_id IS NULL
        AND verification_status = 'LEGACY_UNVERIFIED'
      ORDER BY role
    `).all().map(row => ({
      role: row.role,
      modelName: row.model,
      previousModelName: row.previous_model,
      appliedAt: row.applied_at,
    })));
  }

  listCompatibilityOverridesForRehydrate() {
    return this.#read('listCompatibilityOverridesForRehydrate', () => this.db.prepare(`
      SELECT role, model, previous_model, applied_at, binding_operation_id,
        model_canonical_name, model_digest_sha256, verification_status
      FROM model_overrides
      ORDER BY role
    `).all().map(row => ({
      role: row.role,
      modelName: row.model,
      previousModelName: row.previous_model,
      appliedAt: row.applied_at,
      bindingOperationId: row.binding_operation_id,
      canonicalName: row.model_canonical_name,
      digestSha256: row.model_digest_sha256,
      verificationStatus: row.verification_status,
    })));
  }

  getProviderOperation(operationIdValue) {
    const operationId = requireString(operationIdValue, 'operationId', { min: 16 });
    return this.#read(
      'getProviderOperation',
      () => this.#mapProviderOperation(this.#providerOperationRow(operationId)),
    );
  }

  getLatestProviderOperation(roleValue) {
    const role = requireRole(roleValue);
    return this.#read('getLatestProviderOperation', () => this.#mapProviderOperation(
      this.db.prepare(`
        SELECT *
        FROM model_binding_provider_operations
        WHERE role = ?
        ORDER BY command_seq DESC
        LIMIT 1
      `).get(role),
    ));
  }

  getRelevantProviderOperation(roleValue) {
    const role = requireRole(roleValue);
    return this.#read('getRelevantProviderOperation', () => this.#mapProviderOperation(
      this.db.prepare(`
        SELECT provider.*
        FROM model_binding_provider_operations provider
        JOIN model_desired_bindings desired
          ON desired.role = provider.role
        LEFT JOIN model_binding_operations binding
          ON binding.request_key = provider.request_key
        WHERE provider.role = ?
          AND provider.request_purpose = 'USER_APPLY_TARGET'
          AND NOT EXISTS (
            SELECT 1
            FROM model_binding_user_noop_provider_supersedes superseded
            WHERE superseded.provider_operation_id = provider.operation_id
          )
          AND (
            provider.expected_binding_revision = desired.binding_revision
            OR binding.committed_binding_revision = desired.binding_revision
          )
        ORDER BY provider.command_seq DESC
        LIMIT 1
      `).get(role),
    ));
  }

  listPendingProviderOperations() {
    return this.#read('listPendingProviderOperations', () => this.db.prepare(`
      SELECT operation.*
      FROM model_binding_provider_operations operation
      LEFT JOIN model_binding_provider_attempts attempt
        ON attempt.operation_id = operation.operation_id
      WHERE attempt.operation_id IS NULL
      ORDER BY operation.command_seq
    `).all().map(row => this.#mapProviderOperation(row)));
  }

  listResumableProviderOperations() {
    return this.#read('listResumableProviderOperations', () => this.db.prepare(`
      SELECT operation.*
      FROM model_binding_provider_operations operation
      JOIN model_binding_provider_attempts attempt
        ON attempt.operation_id = operation.operation_id
      LEFT JOIN model_binding_operations binding
        ON binding.request_key = operation.request_key
      WHERE operation.request_purpose = 'USER_APPLY_TARGET'
        AND attempt.outcome IN ('SUCCEEDED','RECONCILED_PRESENT')
        AND binding.operation_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM model_binding_user_noop_provider_supersedes superseded
          WHERE superseded.provider_operation_id = operation.operation_id
        )
      ORDER BY operation.command_seq
    `).all().map(row => this.#mapProviderOperation(row)));
  }

  renewManualProviderPullClaim(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'operationId',
      'claimToken',
      'expectedFencingRevision',
    ]);
    const operationId = requireString(input.operationId, 'operationId', { min: 16 });
    const claimToken = requireString(input.claimToken, 'claimToken', { min: 16, max: 256 });
    const expectedFencingRevision = requirePositiveInteger(
      input.expectedFencingRevision,
      'expectedFencingRevision',
    );
    return this.#write('renewManualProviderPullClaim', () => {
      const nowMs = this.#now('renewManualProviderPullClaim');
      const expiresAtMs = providerClaimExpiry(nowMs);
      const current = this.db.prepare(`
        SELECT claim_token, fencing_revision, lease_expires_at_ms, updated_at_ms
        FROM model_binding_provider_claims
        WHERE operation_id = ?
      `).get(operationId);
      if (!current
        || current.claim_token !== claimToken
        || current.fencing_revision !== expectedFencingRevision
        || current.lease_expires_at_ms < nowMs) {
        fail(
          'MODEL_BINDING_PROVIDER_CLAIM_STALE',
          'Provider effect claim is no longer live or owned by this worker',
          { operationId, expectedFencingRevision },
        );
      }
      // Two commands can legitimately fall in the same clock tick. The
      // existing lease is already authoritative; do not manufacture an
      // oversized heartbeat merely to force a write.
      if (expiresAtMs <= current.lease_expires_at_ms) {
        return this.#mapProviderOperation(this.#providerOperationRow(operationId));
      }
      const result = this.db.prepare(`
        UPDATE model_binding_provider_claims
        SET lease_expires_at_ms = ?, updated_at_ms = ?
        WHERE operation_id = ?
          AND claim_token = ?
          AND fencing_revision = ?
          AND lease_expires_at_ms >= ?
      `).run(
        expiresAtMs,
        nowMs,
        operationId,
        claimToken,
        expectedFencingRevision,
        nowMs,
      );
      if (result.changes !== 1) {
        fail(
          'MODEL_BINDING_PROVIDER_CLAIM_STALE',
          'Provider effect claim is no longer live or owned by this worker',
          { operationId, expectedFencingRevision },
        );
      }
      return this.#mapProviderOperation(this.#providerOperationRow(operationId));
    });
  }

  claimManualProviderPullRecovery(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, ['operationId']);
    const operationId = requireString(input.operationId, 'operationId', { min: 16 });
    return this.#write('claimManualProviderPullRecovery', () => {
      const operation = this.#providerOperationRow(operationId);
      if (!operation) {
        fail(
          'MODEL_BINDING_PROVIDER_OPERATION_MISSING',
          'Provider pull operation does not exist',
          { operationId },
        );
      }
      const terminal = this.db.prepare(`
        SELECT 1 FROM model_binding_provider_attempts WHERE operation_id = ?
      `).get(operationId);
      if (terminal) {
        fail(
          'MODEL_BINDING_PROVIDER_TERMINAL_CONFLICT',
          'Provider pull already has a terminal outcome',
          { operationId },
        );
      }
      const claim = this.db.prepare(`
        SELECT * FROM model_binding_provider_claims WHERE operation_id = ?
      `).get(operationId);
      if (!claim) {
        fail(
          'MODEL_BINDING_PROVIDER_CLAIM_MISSING',
          'Pending provider effect has no active claim projection',
          { operationId },
        );
      }
      const nowMs = this.#now('claimManualProviderPullRecovery');
      if (claim.lease_expires_at_ms >= nowMs) {
        fail(
          'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS',
          'Provider effect is still owned by a live worker lease',
          {
            operationId,
            fencingRevision: claim.fencing_revision,
            leaseExpiresAtMs: claim.lease_expires_at_ms,
          },
        );
      }
      const nextFencingRevision = incrementSafeInteger(
        claim.fencing_revision,
        'fencingRevision',
      );
      const claimToken = this.#id('claimToken', { min: 16 });
      const expiresAtMs = providerClaimExpiry(nowMs);
      const result = this.db.prepare(`
        UPDATE model_binding_provider_claims
        SET claim_token = ?, fencing_revision = ?,
            lease_expires_at_ms = ?, updated_at_ms = ?
        WHERE operation_id = ?
          AND claim_token = ?
          AND fencing_revision = ?
          AND lease_expires_at_ms < ?
      `).run(
        claimToken,
        nextFencingRevision,
        expiresAtMs,
        nowMs,
        operationId,
        claim.claim_token,
        claim.fencing_revision,
        nowMs,
      );
      if (result.changes !== 1) {
        fail(
          'MODEL_BINDING_PROVIDER_CLAIM_STALE',
          'Provider recovery claim lost its compare-and-swap race',
          { operationId, expectedFencingRevision: claim.fencing_revision },
        );
      }
      return this.#mapProviderOperation(this.#providerOperationRow(operationId));
    });
  }

  recordManualProviderPullIntent(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'requestKey',
      'role',
      'requestPurpose',
      'expectedBindingRevision',
      'providerOrigin',
      'targetModelName',
      'actor',
    ]);
    const requestKey = requireString(input.requestKey, 'requestKey', { min: 16, max: 128 });
    const role = requireRole(input.role);
    const requestPurpose = requireString(input.requestPurpose, 'requestPurpose', { max: 64 });
    if (!PROVIDER_REQUEST_PURPOSES.has(requestPurpose)) {
      fail(
        'MODEL_BINDING_PROVIDER_PURPOSE_INVALID',
        'Provider request purpose is not allowed',
        { requestPurpose },
      );
    }
    const expectedBindingRevision = requestPurpose === 'USER_APPLY_TARGET'
      ? requirePositiveInteger(input.expectedBindingRevision, 'expectedBindingRevision')
      : null;
    if (requestPurpose === 'LEGACY_BASELINE_RECOVERY'
      && input.expectedBindingRevision !== null) {
      fail(
        'MODEL_BINDING_PROVIDER_PURPOSE_INVALID',
        'Legacy baseline recovery cannot claim a binding revision',
      );
    }
    const providerOrigin = requireProviderOrigin(input.providerOrigin);
    const targetModelName = requireString(input.targetModelName, 'targetModelName', { max: 512 });
    const targetCanonicalName = canonicalModelName(targetModelName);
    if (!targetCanonicalName) {
      fail('MODEL_FAILOVER_MODEL_NAME_INVALID', 'targetModelName has no canonical identity');
    }
    const actor = requireUserActor(input.actor);

    return this.#write('recordManualProviderPullIntent', () => {
      const replay = this.db.prepare(`
        SELECT * FROM model_binding_provider_operations WHERE request_key = ?
      `).get(requestKey);
      if (replay) {
        const matches = replay.role === role
          && replay.effect_kind === 'PULL'
          && replay.request_purpose === requestPurpose
          && replay.expected_binding_revision === expectedBindingRevision
          && replay.provider_origin === providerOrigin
          && replay.requested_model_name === targetModelName
          && replay.requested_canonical_name === targetCanonicalName
          && replay.actor === actor;
        if (!matches) {
          fail(
            'MODEL_BINDING_PROVIDER_REQUEST_CONFLICT',
            'Provider request key was replayed with different authority',
            { requestKey },
          );
        }
        return { outcome: 'REPLAYED', operation: this.#mapProviderOperation(replay) };
      }

      const activeClaim = this.db.prepare(`
        SELECT operation_id, role, provider_origin, requested_canonical_name,
               fencing_revision, lease_expires_at_ms
        FROM model_binding_provider_claims
        WHERE role = ?
           OR (provider_origin = ? AND requested_canonical_name = ?)
        LIMIT 1
      `).get(role, providerOrigin, targetCanonicalName);
      if (activeClaim) {
        fail(
          'MODEL_BINDING_PROVIDER_OPERATION_IN_PROGRESS',
          'Provider effect authority is already claimed',
          {
            operationId: activeClaim.operation_id,
            role: activeClaim.role,
            providerOrigin: activeClaim.provider_origin,
            requestedCanonicalName: activeClaim.requested_canonical_name,
            fencingRevision: activeClaim.fencing_revision,
            leaseExpiresAtMs: activeClaim.lease_expires_at_ms,
          },
        );
      }

      if (requestPurpose === 'USER_APPLY_TARGET') {
        const desired = this.#desiredRow(role);
        if (!desired || desired.binding_revision !== expectedBindingRevision) {
          fail(
            'MODEL_FAILOVER_STALE_DESIRED',
            'Provider intent requires the current desired binding revision',
            {
              role,
              expectedBindingRevision,
              actualBindingRevision: desired?.binding_revision ?? null,
            },
          );
        }
        const [unresolvedSuccess] = this.#unresolvedProviderSuccesses(
          role,
          expectedBindingRevision,
        );
        this.#failForUnresolvedProviderSuccess(unresolvedSuccess, {
          role,
          expectedBindingRevision,
        });
      }

      const operationId = this.#nextProviderOperationId();
      const createdAtMs = this.#now('recordManualProviderPullIntent');
      const initialClaimToken = this.#id('claimToken', { min: 16 });
      const initialClaimExpiresAtMs = providerClaimExpiry(createdAtMs);
      this.db.prepare(`
        INSERT INTO model_binding_provider_operations (
          operation_id, request_key, role, effect_kind, request_purpose,
          expected_binding_revision, provider_origin,
          requested_model_name, requested_canonical_name, actor,
          initial_claim_token, initial_claim_expires_at_ms, created_at_ms
        ) VALUES (?, ?, ?, 'PULL', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        operationId,
        requestKey,
        role,
        requestPurpose,
        expectedBindingRevision,
        providerOrigin,
        targetModelName,
        targetCanonicalName,
        actor,
        initialClaimToken,
        initialClaimExpiresAtMs,
        createdAtMs,
      );
      return {
        outcome: 'RECORDED',
        operation: this.#mapProviderOperation(this.#providerOperationRow(operationId)),
      };
    });
  }

  #recordProviderPullTerminal({ operationId, claimToken, expectedFencingRevision,
    outcome, observedModelName = null, observedDigestSha256 = null, failureCode = null }) {
    return this.#write('recordManualProviderPullTerminal', () => {
      const operation = this.#providerOperationRow(operationId);
      if (!operation) {
        fail(
          'MODEL_BINDING_PROVIDER_OPERATION_MISSING',
          'Provider pull operation does not exist',
          { operationId },
        );
      }
      const replay = this.db.prepare(`
        SELECT * FROM model_binding_provider_attempts WHERE operation_id = ?
      `).get(operationId);
      const observedCanonicalName = observedModelName === null
        ? null
        : canonicalModelName(observedModelName);
      const digest = observedDigestSha256 === null
        ? null
        : requireDigest(observedDigestSha256, 'observedDigestSha256');
      const retryable = outcome === 'FAILED'
        ? PROVIDER_PULL_FAILURE_POLICY[failureCode]
        : outcome === 'RECONCILED_ABSENT';
      if (outcome === 'FAILED' && typeof retryable !== 'boolean') {
        fail(
          'MODEL_BINDING_PROVIDER_FAILURE_CODE_INVALID',
          'Provider pull failure code is not allowed',
          { failureCode },
        );
      }
      if (replay) {
        const matches = replay.outcome === outcome
          && replay.observed_model_name === observedModelName
          && replay.observed_canonical_name === observedCanonicalName
          && replay.observed_digest_sha256 === digest
          && replay.failure_code === failureCode
          && replay.retryable === (retryable ? 1 : 0)
          && replay.claim_token === claimToken
          && replay.fencing_revision === expectedFencingRevision;
        if (!matches) {
          fail(
            replay.claim_token !== claimToken
              || replay.fencing_revision !== expectedFencingRevision
              ? 'MODEL_BINDING_PROVIDER_CLAIM_STALE'
              : 'MODEL_BINDING_PROVIDER_TERMINAL_CONFLICT',
            replay.claim_token !== claimToken
              || replay.fencing_revision !== expectedFencingRevision
              ? 'Provider terminal replay does not own the recorded fencing claim'
              : 'Provider pull already has a different terminal outcome',
            {
              operationId,
              expectedFencingRevision,
              recordedFencingRevision: replay.fencing_revision,
            },
          );
        }
        return { outcome: 'REPLAYED', operation: this.#mapProviderOperation(operation) };
      }
      const createdAtMs = this.#now('recordManualProviderPullTerminal');
      const liveClaim = this.db.prepare(`
        SELECT claim_token, fencing_revision, lease_expires_at_ms
        FROM model_binding_provider_claims
        WHERE operation_id = ?
      `).get(operationId);
      if (!liveClaim
        || liveClaim.claim_token !== claimToken
        || liveClaim.fencing_revision !== expectedFencingRevision
        || liveClaim.lease_expires_at_ms < createdAtMs) {
        fail(
          'MODEL_BINDING_PROVIDER_CLAIM_STALE',
          'Provider terminal audit requires the live fenced claim',
          {
            operationId,
            expectedFencingRevision,
            actualFencingRevision: liveClaim?.fencing_revision ?? null,
            leaseExpiresAtMs: liveClaim?.lease_expires_at_ms ?? null,
            createdAtMs,
          },
        );
      }
      this.db.prepare(`
        INSERT INTO model_binding_provider_attempts (
          operation_id, attempt_revision, outcome, observed_model_name,
          observed_canonical_name, observed_digest_sha256, failure_code,
          retryable, claim_token, fencing_revision, created_at_ms
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        operationId,
        outcome,
        observedModelName,
        observedCanonicalName,
        digest,
        failureCode,
        retryable ? 1 : 0,
        claimToken,
        expectedFencingRevision,
        createdAtMs,
      );
      return { outcome: 'RECORDED', operation: this.#mapProviderOperation(operation) };
    });
  }

  recordManualProviderPullSucceeded(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'operationId',
      'claimToken',
      'expectedFencingRevision',
      'observedModelName',
      'observedDigestSha256',
    ]);
    return this.#recordProviderPullTerminal({
      operationId: requireString(input.operationId, 'operationId', { min: 16 }),
      claimToken: requireString(input.claimToken, 'claimToken', { min: 16, max: 256 }),
      expectedFencingRevision: requirePositiveInteger(
        input.expectedFencingRevision,
        'expectedFencingRevision',
      ),
      outcome: 'SUCCEEDED',
      observedModelName: requireString(input.observedModelName, 'observedModelName', { max: 512 }),
      observedDigestSha256: input.observedDigestSha256,
    });
  }

  recordManualProviderPullFailed(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'operationId',
      'claimToken',
      'expectedFencingRevision',
      'failureCode',
    ]);
    return this.#recordProviderPullTerminal({
      operationId: requireString(input.operationId, 'operationId', { min: 16 }),
      claimToken: requireString(input.claimToken, 'claimToken', { min: 16, max: 256 }),
      expectedFencingRevision: requirePositiveInteger(
        input.expectedFencingRevision,
        'expectedFencingRevision',
      ),
      outcome: 'FAILED',
      failureCode: requireString(input.failureCode, 'failureCode', { min: 3, max: 96 }).toUpperCase(),
    });
  }

  recordManualProviderPullReconciledPresent(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'operationId',
      'claimToken',
      'expectedFencingRevision',
      'observedModelName',
      'observedDigestSha256',
    ]);
    return this.#recordProviderPullTerminal({
      operationId: requireString(input.operationId, 'operationId', { min: 16 }),
      claimToken: requireString(input.claimToken, 'claimToken', { min: 16, max: 256 }),
      expectedFencingRevision: requirePositiveInteger(
        input.expectedFencingRevision,
        'expectedFencingRevision',
      ),
      outcome: 'RECONCILED_PRESENT',
      observedModelName: requireString(input.observedModelName, 'observedModelName', { max: 512 }),
      observedDigestSha256: input.observedDigestSha256,
    });
  }

  recordManualProviderPullReconciledAbsent(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'operationId',
      'claimToken',
      'expectedFencingRevision',
    ]);
    return this.#recordProviderPullTerminal({
      operationId: requireString(input.operationId, 'operationId', { min: 16 }),
      claimToken: requireString(input.claimToken, 'claimToken', { min: 16, max: 256 }),
      expectedFencingRevision: requirePositiveInteger(
        input.expectedFencingRevision,
        'expectedFencingRevision',
      ),
      outcome: 'RECONCILED_ABSENT',
      failureCode: 'MODEL_BINDING_PROVIDER_OUTCOME_UNRESOLVED',
    });
  }

  recordManualRuntimeApplied(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'operationId',
      'expectedAttemptRevision',
      'observedModelName',
      'observedDigestSha256',
      'runtimeChanged',
    ]);
    if (typeof input.runtimeChanged !== 'boolean') {
      fail('MODEL_FAILOVER_INPUT_INVALID', 'runtimeChanged must be a boolean', {
        field: 'runtimeChanged',
      });
    }
    return this.#recordBindingApplicationAttempt({
      operationName: 'recordManualRuntimeApplied',
      operationId: requireString(input.operationId, 'operationId', { min: 16 }),
      expectedAttemptRevision: requireNonNegativeInteger(
        input.expectedAttemptRevision,
        'expectedAttemptRevision',
      ),
      kind: 'RUNTIME_APPLY',
      outcome: 'SUCCEEDED',
      observedModelName: requireString(
        input.observedModelName,
        'observedModelName',
        { max: 512 },
      ),
      observedDigestSha256: input.observedDigestSha256,
      runtimeChanged: input.runtimeChanged === true,
    });
  }

  recordManualRuntimeFinalized(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'operationId',
      'expectedAttemptRevision',
      'configVersion',
    ]);
    const operationId = requireString(input.operationId, 'operationId', { min: 16 });
    const expectedAttemptRevision = requirePositiveInteger(
      input.expectedAttemptRevision,
      'expectedAttemptRevision',
    );
    const configVersion = requireNonNegativeInteger(input.configVersion, 'configVersion');

    return this.#write('recordManualRuntimeFinalized', () => {
      const operation = this.#bindingOperationRow(operationId);
      if (!operation) {
        fail(
          'MODEL_FAILOVER_BINDING_OPERATION_MISSING',
          'Binding runtime finalize operation does not exist',
          { operationId },
        );
      }

      const runtimeAttempts = this.#bindingApplicationAttemptRows(operationId).filter(
        attempt => APPLICATION_RUNTIME_KINDS.has(attempt.attempt_kind),
      );
      const runtimeAttempt = runtimeAttempts.find(
        attempt => attempt.attempt_revision === expectedAttemptRevision,
      );
      const latestRuntimeAttempt = runtimeAttempts.at(-1) || null;
      if (!runtimeAttempt
        || runtimeAttempt.outcome !== 'SUCCEEDED'
        || latestRuntimeAttempt?.attempt_revision !== expectedAttemptRevision) {
        fail(
          'MODEL_BINDING_RUNTIME_FINALIZE_ATTEMPT_INVALID',
          'Runtime finalize requires the latest successful runtime generation',
          {
            operationId,
            expectedAttemptRevision,
            actualLatestAttemptRevision: latestRuntimeAttempt?.attempt_revision ?? null,
            actualOutcome: runtimeAttempt?.outcome ?? null,
          },
        );
      }

      const cutoff = this.db.prepare(`
        SELECT max_preexisting_runtime_attempt_revision
        FROM model_binding_runtime_finalize_cutoffs
        WHERE operation_id = ?
      `).get(operationId);
      if (cutoff
        && expectedAttemptRevision <= cutoff.max_preexisting_runtime_attempt_revision) {
        fail(
          'MODEL_BINDING_RUNTIME_FINALIZE_REHYDRATE_REQUIRED',
          'Pre-054 runtime success requires a new startup generation before confirmation',
          {
            operationId,
            expectedAttemptRevision,
            maxPreexistingRuntimeAttemptRevision:
              cutoff.max_preexisting_runtime_attempt_revision,
          },
        );
      }

      const existing = this.db.prepare(`
        SELECT *
        FROM model_binding_runtime_finalize_receipts
        WHERE operation_id = ? AND runtime_attempt_revision = ?
      `).get(operationId, expectedAttemptRevision);
      if (existing) {
        if (existing.finalization_kind === 'DIRECT_CONFIRMED'
          && existing.config_version === configVersion
          && existing.recovered_by_attempt_revision === null) {
          return {
            outcome: 'REPLAYED',
            receipt: mapBindingRuntimeFinalizeReceipt(existing),
            recoveredReceipts: this.#bindingRuntimeFinalizeRows(operationId)
              .filter(row => row.recovered_by_attempt_revision === expectedAttemptRevision)
              .map(mapBindingRuntimeFinalizeReceipt),
            applicationState: this.#bindingApplicationState(operation),
          };
        }
        fail(
          'MODEL_BINDING_RUNTIME_FINALIZE_CONFLICT',
          'Runtime generation already has a different finalize receipt',
          { operationId, expectedAttemptRevision },
        );
      }

      const existingFinalizeRows = this.#bindingRuntimeFinalizeRows(operationId);
      const hadDirectReceipt = existingFinalizeRows.some(
        receipt => receipt.finalization_kind === 'DIRECT_CONFIRMED',
      );
      const cutoffRevision = cutoff?.max_preexisting_runtime_attempt_revision ?? 0;
      const legacyHistoryAlreadyOwned = runtimeAttempts.some(attempt => (
        attempt.attempt_kind === 'RUNTIME_APPLY'
          && attempt.outcome === 'SUCCEEDED'
          && attempt.runtime_changed === 1
          && attempt.attempt_revision <= cutoffRevision
      ));
      const historyRuntimeAttempt = !hadDirectReceipt && !legacyHistoryAlreadyOwned
        ? runtimeAttempts.find(attempt => (
          attempt.outcome === 'SUCCEEDED'
            && attempt.runtime_changed === 1
        )) || null
        : null;

      const createdAtMs = this.#now('recordManualRuntimeFinalized');
      this.db.prepare(`
        INSERT INTO model_binding_runtime_finalize_receipts (
          operation_id, runtime_attempt_revision, finalization_kind,
          config_version, recovered_by_attempt_revision, created_at_ms
        ) VALUES (?, ?, 'DIRECT_CONFIRMED', ?, NULL, ?)
      `).run(operationId, expectedAttemptRevision, configVersion, createdAtMs);

      if (historyRuntimeAttempt) {
        this.db.prepare(`
          INSERT INTO upgrade_history (
            role, from_model, to_model, score, action, created_at
          ) VALUES (?, ?, ?, NULL, ?, datetime(? / 1000, 'unixepoch'))
        `).run(
          operation.role,
          operation.previous_model_name,
          operation.target_model_name,
          operation.operation_kind === 'USER_ROLLBACK' ? 'rollback' : 'apply',
          createdAtMs,
        );
      }

      const recovered = [];
      if (runtimeAttempt.attempt_kind === 'STARTUP_REHYDRATE') {
        const unresolved = this.db.prepare(`
          SELECT attempt.attempt_revision
          FROM model_binding_application_attempts attempt
          LEFT JOIN model_binding_runtime_finalize_receipts receipt
            ON receipt.operation_id = attempt.operation_id
           AND receipt.runtime_attempt_revision = attempt.attempt_revision
          WHERE attempt.operation_id = ?
            AND attempt.attempt_revision < ?
            AND attempt.attempt_kind IN ('RUNTIME_APPLY','STARTUP_REHYDRATE')
            AND attempt.outcome = 'SUCCEEDED'
            AND receipt.seq IS NULL
          ORDER BY attempt.attempt_revision
        `).all(operationId, expectedAttemptRevision);
        const insertRecovered = this.db.prepare(`
          INSERT INTO model_binding_runtime_finalize_receipts (
            operation_id, runtime_attempt_revision, finalization_kind,
            config_version, recovered_by_attempt_revision, created_at_ms
          ) VALUES (?, ?, 'RECOVERED_BY', NULL, ?, ?)
        `);
        for (const unresolvedAttempt of unresolved) {
          insertRecovered.run(
            operationId,
            unresolvedAttempt.attempt_revision,
            expectedAttemptRevision,
            createdAtMs,
          );
          recovered.push(this.db.prepare(`
            SELECT *
            FROM model_binding_runtime_finalize_receipts
            WHERE operation_id = ? AND runtime_attempt_revision = ?
          `).get(operationId, unresolvedAttempt.attempt_revision));
        }
      }

      const receipt = this.db.prepare(`
        SELECT *
        FROM model_binding_runtime_finalize_receipts
        WHERE operation_id = ? AND runtime_attempt_revision = ?
      `).get(operationId, expectedAttemptRevision);
      return {
        outcome: 'RECORDED',
        receipt: mapBindingRuntimeFinalizeReceipt(receipt),
        recoveredReceipts: recovered.map(mapBindingRuntimeFinalizeReceipt),
        applicationState: this.#bindingApplicationState(operation),
      };
    });
  }

  recordManualRuntimeApplyFailed(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'operationId',
      'expectedAttemptRevision',
      'failureCode',
    ]);
    return this.#recordBindingApplicationAttempt({
      operationName: 'recordManualRuntimeApplyFailed',
      operationId: requireString(input.operationId, 'operationId', { min: 16 }),
      expectedAttemptRevision: requireNonNegativeInteger(
        input.expectedAttemptRevision,
        'expectedAttemptRevision',
      ),
      kind: 'RUNTIME_APPLY',
      outcome: 'FAILED',
      failureCode: input.failureCode,
    });
  }

  recordManualStartupRehydrated(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'operationId',
      'expectedAttemptRevision',
      'observedModelName',
      'observedDigestSha256',
      'runtimeChanged',
    ]);
    if (typeof input.runtimeChanged !== 'boolean') {
      fail('MODEL_FAILOVER_INPUT_INVALID', 'runtimeChanged must be a boolean', {
        field: 'runtimeChanged',
      });
    }
    return this.#recordBindingApplicationAttempt({
      operationName: 'recordManualStartupRehydrated',
      operationId: requireString(input.operationId, 'operationId', { min: 16 }),
      expectedAttemptRevision: requireNonNegativeInteger(
        input.expectedAttemptRevision,
        'expectedAttemptRevision',
      ),
      kind: 'STARTUP_REHYDRATE',
      outcome: 'SUCCEEDED',
      observedModelName: requireString(
        input.observedModelName,
        'observedModelName',
        { max: 512 },
      ),
      observedDigestSha256: input.observedDigestSha256,
      runtimeChanged: input.runtimeChanged === true,
    });
  }

  recordManualStartupRehydrateFailed(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'operationId',
      'expectedAttemptRevision',
      'failureCode',
    ]);
    return this.#recordBindingApplicationAttempt({
      operationName: 'recordManualStartupRehydrateFailed',
      operationId: requireString(input.operationId, 'operationId', { min: 16 }),
      expectedAttemptRevision: requireNonNegativeInteger(
        input.expectedAttemptRevision,
        'expectedAttemptRevision',
      ),
      kind: 'STARTUP_REHYDRATE',
      outcome: 'FAILED',
      failureCode: input.failureCode,
    });
  }

  recordManualVerificationSucceeded(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'operationId',
      'expectedAttemptRevision',
      'observedModelName',
      'observedDigestSha256',
    ]);
    return this.#recordBindingApplicationAttempt({
      operationName: 'recordManualVerificationSucceeded',
      operationId: requireString(input.operationId, 'operationId', { min: 16 }),
      expectedAttemptRevision: requireNonNegativeInteger(
        input.expectedAttemptRevision,
        'expectedAttemptRevision',
      ),
      kind: 'VERIFICATION',
      outcome: 'SUCCEEDED',
      observedModelName: requireString(
        input.observedModelName,
        'observedModelName',
        { max: 512 },
      ),
      observedDigestSha256: input.observedDigestSha256,
    });
  }

  recordManualVerificationFailed(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'operationId',
      'expectedAttemptRevision',
      'failureCode',
    ]);
    return this.#recordBindingApplicationAttempt({
      operationName: 'recordManualVerificationFailed',
      operationId: requireString(input.operationId, 'operationId', { min: 16 }),
      expectedAttemptRevision: requireNonNegativeInteger(
        input.expectedAttemptRevision,
        'expectedAttemptRevision',
      ),
      kind: 'VERIFICATION',
      outcome: 'FAILED',
      failureCode: input.failureCode,
    });
  }

  recordManualNotificationSucceeded(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, ['operationId', 'expectedAttemptRevision']);
    const operationId = requireString(input.operationId, 'operationId', { min: 16 });
    const operation = this.#read(
      'recordManualNotificationSucceededTarget',
      () => this.#bindingOperationRow(operationId),
    );
    if (!operation) {
      fail(
        'MODEL_FAILOVER_BINDING_OPERATION_MISSING',
        'Binding notification operation does not exist',
        { operationId },
      );
    }
    return this.#recordBindingApplicationAttempt({
      operationName: 'recordManualNotificationSucceeded',
      operationId,
      expectedAttemptRevision: requireNonNegativeInteger(
        input.expectedAttemptRevision,
        'expectedAttemptRevision',
      ),
      kind: 'NOTIFICATION',
      outcome: 'SUCCEEDED',
      observedModelName: operation.target_model_name,
      observedDigestSha256: operation.target_digest_sha256,
    });
  }

  recordManualNotificationFailed(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'operationId',
      'expectedAttemptRevision',
      'failureCode',
    ]);
    return this.#recordBindingApplicationAttempt({
      operationName: 'recordManualNotificationFailed',
      operationId: requireString(input.operationId, 'operationId', { min: 16 }),
      expectedAttemptRevision: requireNonNegativeInteger(
        input.expectedAttemptRevision,
        'expectedAttemptRevision',
      ),
      kind: 'NOTIFICATION',
      outcome: 'FAILED',
      failureCode: input.failureCode,
    });
  }

  getEffectiveBinding(roleValue) {
    const role = requireRole(roleValue);
    return this.#read('getEffectiveBinding', () => {
      const desired = mapDesired(this.#desiredRow(role));
      if (!desired) return null;
      const state = mapState(this.#stateRow(role));
      if (state?.activeFailover) {
        return {
          source: 'FAILOVER',
          role,
          modelName: state.fallbackModelName,
          canonicalName: state.fallbackCanonicalName,
          digestSha256: state.fallbackDigestSha256,
          desired,
          state,
        };
      }
      if (MANUAL_DESIRED_SOURCES.has(desired.source)) {
        const operation = this.#currentManualOperation(this.#desiredRow(role));
        const applicationState = this.#bindingApplicationState(operation);
        if (applicationState.runtimeStatus === 'APPLIED'
          && applicationState.runtimeFinalizeStatus === 'DIRECT_CONFIRMED') {
          return {
            source: 'MANUAL',
            role,
            modelName: desired.modelName,
            canonicalName: desired.canonicalName,
            digestSha256: desired.digestSha256,
            desired,
            state,
            operation: this.#mappedBindingOperation(operation),
            applicationState,
          };
        }
        return {
          source: 'PENDING_MANUAL',
          role,
          modelName: null,
          canonicalName: null,
          digestSha256: null,
          desired,
          state,
          pendingOperation: {
            operationId: operation.operation_id,
            kind: operation.operation_kind,
            verificationStatus: operation.verification_status,
            runtimeStatus: operation.runtime_status,
            applicationState,
          },
        };
      }
      return {
        source: 'DESIRED',
        role,
        modelName: desired.modelName,
        canonicalName: desired.canonicalName,
        digestSha256: desired.digestSha256,
        desired,
        state,
      };
    });
  }

  observeDesiredBinding(inputValue) {
    const input = requireInput(inputValue);
    rejectAuthorityOverrides(input, ['nowMs', 'eventId', 'bindingRevision']);
    const role = requireRole(input.role);
    const modelName = requireString(input.modelName, 'modelName', { max: 512 });
    const canonicalName = canonicalModelName(modelName);
    if (!canonicalName) {
      fail('MODEL_FAILOVER_MODEL_NAME_INVALID', 'modelName has no canonical identity');
    }
    const digestSha256 = requireDigest(input.digestSha256);
    const source = requireString(input.source, 'source', { max: 32 });
    if (MANUAL_DESIRED_SOURCES.has(source)) {
      fail(
        'MODEL_FAILOVER_MANUAL_SOURCE_REQUIRES_DEDICATED_API',
        'Manual binding changes require recordUserBindingApply or recordUserBindingRollback',
        { source },
      );
    }
    if (!OBSERVABLE_DESIRED_SOURCES.has(source)) {
      fail('MODEL_FAILOVER_SOURCE_INVALID', 'Unknown desired binding source', { source });
    }
    const actor = requireString(input.actor, 'actor');
    if (input.expectedAbsent !== undefined && input.expectedAbsent !== true) {
      fail(
        'MODEL_FAILOVER_EXPECTED_ABSENT_INVALID',
        'expectedAbsent may only be the literal true',
      );
    }
    const expectedAbsent = input.expectedAbsent === true;
    if (input.requireAutoFailoverEnabled !== undefined
      && input.requireAutoFailoverEnabled !== true) {
      fail(
        'MODEL_FAILOVER_POLICY_REQUIREMENT_INVALID',
        'requireAutoFailoverEnabled may only be the literal true',
      );
    }
    const policyRequired = input.requireAutoFailoverEnabled === true;

    return this.#write('observeDesiredBinding', () => {
      requireCoordinatorPolicy(this.db, policyRequired);
      const existing = this.#desiredRow(role);
      if (existing
        && existing.canonical_name === canonicalName
        && existing.digest_sha256 === digestSha256
        && existing.source === source) {
        return { outcome: 'UNCHANGED', binding: mapDesired(existing) };
      }
      if (expectedAbsent && existing) {
        fail(
          'MODEL_FAILOVER_STALE_DESIRED',
          'Desired binding appeared before the initial observation committed',
          {
            role,
            actualDesiredRevision: existing.binding_revision,
            actualSource: existing.source,
          },
        );
      }
      if (existing) {
        const pendingProvider = this.#pendingProviderOperation(
          role,
          existing.binding_revision,
        );
        this.#failForPendingProviderOperation(pendingProvider, {
          role,
          expectedBindingRevision: existing.binding_revision,
        });
        const [unresolvedSuccess] = this.#unresolvedProviderSuccesses(
          role,
          existing.binding_revision,
        );
        this.#failForUnresolvedProviderSuccess(unresolvedSuccess, {
          role,
          expectedBindingRevision: existing.binding_revision,
        });
      }
      const incident = this.#stateRow(role);
      if (incident) {
        fail(
          'MODEL_FAILOVER_DESIRED_CHANGE_REQUIRES_SUPERSEDE',
          'Desired binding cannot change while a failover incident row exists',
          { role, episodeId: incident.episode_id, state: incident.state },
        );
      }
      const observedAtMs = this.#now('observeDesiredBinding');
      if (existing && observedAtMs < existing.updated_at_ms) {
        fail('MODEL_FAILOVER_CLOCK_ROLLBACK', 'Repository clock moved before desired state', {
          role,
          nowMs: observedAtMs,
          updatedAtMs: existing.updated_at_ms,
        });
      }
      const eventId = this.#id('event');

      const bindingRevision = existing
        ? incrementSafeInteger(existing.binding_revision, 'bindingRevision')
        : 1;
      const eventType = existing ? 'DESIRED_CHANGED' : 'DESIRED_OBSERVED';
      const reasonCode = existing
        ? 'DESIRED_BINDING_CHANGED'
        : 'DESIRED_ARTIFACT_OBSERVED';
      this.db.prepare(`
        INSERT INTO model_failover_events (
          event_id, event_type, role, binding_revision, actor, reason_code,
          policy_version, desired_model_name, desired_digest_sha256,
          created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        eventId,
        eventType,
        role,
        bindingRevision,
        actor,
        reasonCode,
        MODEL_FAILOVER_POLICY_VERSION,
        modelName,
        digestSha256,
        observedAtMs,
      );

      if (existing) {
        const update = this.db.prepare(`
          UPDATE model_desired_bindings
          SET model_name = ?, canonical_name = ?, digest_sha256 = ?,
              binding_revision = ?, source = ?, actor = ?, observed_at_ms = ?,
              updated_at_ms = ?, last_event_id = ?
          WHERE role = ? AND binding_revision = ?
        `).run(
          modelName,
          canonicalName,
          digestSha256,
          bindingRevision,
          source,
          actor,
          observedAtMs,
          observedAtMs,
          eventId,
          role,
          existing.binding_revision,
        );
        if (update.changes !== 1) {
          fail('MODEL_FAILOVER_STALE_DESIRED', 'Desired binding changed concurrently', { role });
        }
      } else {
        this.db.prepare(`
          INSERT INTO model_desired_bindings (
            role, model_name, canonical_name, digest_sha256, binding_revision,
            source, actor, observed_at_ms, updated_at_ms, last_event_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          role,
          modelName,
          canonicalName,
          digestSha256,
          bindingRevision,
          source,
          actor,
          observedAtMs,
          observedAtMs,
          eventId,
        );
      }

      return {
        outcome: existing ? 'CHANGED' : 'CREATED',
        binding: mapDesired(this.#desiredRow(role)),
      };
    });
  }

  recordUserBindingApply(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'requestKey',
      'role',
      'expectedBindingRevision',
      'targetModelName',
      'targetDigestSha256',
      'actor',
    ]);
    const requestKey = requireString(input.requestKey, 'requestKey', { min: 16, max: 128 });
    const role = requireRole(input.role);
    const expectedBindingRevision = requirePositiveInteger(
      input.expectedBindingRevision,
      'expectedBindingRevision',
    );
    const targetModelName = requireString(
      input.targetModelName,
      'targetModelName',
      { max: 512 },
    );
    const targetCanonicalName = canonicalModelName(targetModelName);
    if (!targetCanonicalName) {
      fail('MODEL_FAILOVER_MODEL_NAME_INVALID', 'targetModelName has no canonical identity');
    }
    const targetDigestSha256 = requireDigest(input.targetDigestSha256, 'targetDigestSha256');
    const actor = requireUserActor(input.actor);

    return this.#write('recordUserBindingApply', () => {
      const noopReplay = this.#bindingNoopByRequestKey(requestKey);
      if (noopReplay) {
        const matches = noopReplay.role === role
          && noopReplay.binding_revision === expectedBindingRevision
          && noopReplay.canonical_name === targetCanonicalName
          && noopReplay.digest_sha256 === targetDigestSha256
          && noopReplay.actor === actor;
        if (!matches) {
          fail(
            'MODEL_FAILOVER_REQUEST_KEY_CONFLICT',
            'Manual binding no-op request key has different semantics',
            { requestKey },
          );
        }
        const committedDesired = this.#desiredFromBindingNoop(noopReplay);
        const currentDesired = mapDesired(this.#desiredRow(role));
        return {
          outcome: 'REPLAYED',
          kind: 'USER_APPLY',
          operation: null,
          noOpReceipt: this.#mapBindingNoop(noopReplay),
          committedDesired,
          currentDesired,
          requestKeyConsumed: true,
        };
      }
      const replay = this.#bindingOperationByRequestKey(requestKey);
      if (replay) {
        return this.#replayManualOperation(replay, {
          requestKey,
          role,
          kind: 'USER_APPLY',
          expectedBindingRevision,
          actor,
          targetCanonicalName,
          targetDigestSha256,
        });
      }

      const desired = this.#desiredRow(role);
      if (!desired) {
        fail('MODEL_FAILOVER_DESIRED_MISSING', 'Cannot apply a manual binding without desired state', {
          role,
        });
      }
      if (desired.binding_revision !== expectedBindingRevision) {
        fail('MODEL_FAILOVER_STALE_DESIRED', 'Desired binding revision no longer matches', {
          role,
          expectedBindingRevision,
          actualBindingRevision: desired.binding_revision,
        });
      }
      const pendingProvider = this.#pendingProviderOperation(role, expectedBindingRevision);
      this.#failForPendingProviderOperation(pendingProvider, {
        role,
        expectedBindingRevision,
      });
      const supersededProvider = this.db.prepare(`
        SELECT provider.operation_id, superseded.receipt_id
        FROM model_binding_provider_operations provider
        JOIN model_binding_user_noop_provider_supersedes superseded
          ON superseded.provider_operation_id = provider.operation_id
        WHERE provider.request_key = ?
        LIMIT 1
      `).get(requestKey);
      if (supersededProvider) {
        fail(
          'MODEL_BINDING_PROVIDER_COMMAND_SUPERSEDED',
          'Provider command was closed by a later no-op receipt',
          {
            requestKey,
            providerOperationId: supersededProvider.operation_id,
            noOpReceiptId: supersededProvider.receipt_id,
          },
        );
      }
      if (desired.canonical_name === targetCanonicalName
        && desired.digest_sha256 === targetDigestSha256) {
        const createdAtMs = this.#now('recordUserBindingApplyNoop');
        if (createdAtMs < desired.updated_at_ms) {
          fail('MODEL_FAILOVER_CLOCK_ROLLBACK', 'Repository clock moved before desired binding', {
            role,
            createdAtMs,
            updatedAtMs: desired.updated_at_ms,
          });
        }
        const futureTerminal = this.db.prepare(`
          SELECT provider.operation_id, terminal.created_at_ms
          FROM model_binding_provider_operations provider
          JOIN model_binding_provider_attempts terminal
            ON terminal.operation_id = provider.operation_id
          WHERE provider.role = ?
            AND provider.request_purpose = 'USER_APPLY_TARGET'
            AND provider.expected_binding_revision = ?
            AND terminal.created_at_ms > ?
            AND NOT EXISTS (
              SELECT 1
              FROM model_binding_user_noop_provider_supersedes superseded
              WHERE superseded.provider_operation_id = provider.operation_id
            )
          ORDER BY terminal.created_at_ms, provider.rowid
          LIMIT 1
        `).get(role, desired.binding_revision, createdAtMs);
        if (futureTerminal) {
          fail(
            'MODEL_FAILOVER_CLOCK_ROLLBACK',
            'Repository clock moved before a provider terminal outcome',
            {
              role,
              providerOperationId: futureTerminal.operation_id,
              createdAtMs,
              providerTerminalAtMs: futureTerminal.created_at_ms,
            },
          );
        }
        const receiptId = this.#id('operation');
        const providerFrontier = this.db.prepare(`
          SELECT COALESCE(MAX(provider.command_seq), 0) AS command_seq
          FROM model_binding_provider_operations provider
          WHERE provider.role = ?
            AND provider.request_purpose = 'USER_APPLY_TARGET'
            AND provider.expected_binding_revision = ?
        `).get(role, desired.binding_revision);
        const sourceProvider = this.db.prepare(`
          SELECT provider.operation_id, provider.command_seq
          FROM model_binding_provider_operations provider
          JOIN model_binding_provider_attempts terminal
            ON terminal.operation_id = provider.operation_id
          WHERE provider.request_key = ?
            AND terminal.outcome IN ('SUCCEEDED','RECONCILED_PRESENT')
          LIMIT 1
        `).get(requestKey);
        this.db.prepare(`
          INSERT INTO model_binding_user_noop_receipts (
            receipt_id, request_key, role, binding_revision, model_name,
            canonical_name, digest_sha256, actor,
            desired_source, desired_actor, desired_observed_at_ms,
            desired_updated_at_ms, desired_last_event_id,
            provider_command_cutoff_seq, source_provider_operation_id, created_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          receiptId,
          requestKey,
          role,
          desired.binding_revision,
          desired.model_name,
          desired.canonical_name,
          desired.digest_sha256,
          actor,
          desired.source,
          desired.actor,
          desired.observed_at_ms,
          desired.updated_at_ms,
          desired.last_event_id,
          providerFrontier.command_seq,
          sourceProvider?.operation_id ?? null,
          createdAtMs,
        );
        const currentDesired = mapDesired(desired);
        return {
          outcome: 'UNCHANGED',
          kind: 'USER_APPLY',
          operation: null,
          noOpReceipt: this.#mapBindingNoop(this.#bindingNoopByRequestKey(requestKey)),
          committedDesired: currentDesired,
          currentDesired,
          requestKeyConsumed: true,
        };
      }
      const unresolvedSuccesses = this.#unresolvedProviderSuccesses(
        role,
        expectedBindingRevision,
      );
      const conflictingSuccess = unresolvedSuccesses.find(provider => !(
        provider.request_key === requestKey
        && provider.actor === actor
        && provider.observed_canonical_name === targetCanonicalName
        && provider.observed_digest_sha256 === targetDigestSha256
      ));
      this.#failForUnresolvedProviderSuccess(conflictingSuccess, {
        role,
        expectedBindingRevision,
      });
      let incident = this.#stateRow(role);
      if (incident?.state === 'SUPERSEDED_BY_USER') {
        this.#retireSupersededIncident(incident);
        incident = null;
      }
      if (incident) {
        this.#requireManualSupersedableIncident(incident, {
          role,
          expectedBindingRevision,
          desired,
        });
      }

      const predecessor = this.#currentManualOperation(desired);
      return this.#recordManualBinding({
        requestKey,
        role,
        kind: 'USER_APPLY',
        actor,
        desired,
        targetModelName,
        targetCanonicalName,
        targetDigestSha256,
        predecessorOperationId: predecessor?.operation_id ?? null,
        incident,
      });
    });
  }

  recordUserBindingRollback(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'requestKey',
      'role',
      'expectedBindingRevision',
      'rollbackOfOperationId',
      'expectedFailedVerificationAttemptRevision',
      'actor',
    ]);
    const requestKey = requireString(input.requestKey, 'requestKey', { min: 16, max: 128 });
    const role = requireRole(input.role);
    const expectedBindingRevision = requirePositiveInteger(
      input.expectedBindingRevision,
      'expectedBindingRevision',
    );
    const rollbackOfOperationId = requireString(
      input.rollbackOfOperationId,
      'rollbackOfOperationId',
      { min: 16 },
    );
    // Decision 022/A: the third CAS member. The rollback must land on exactly the
    // failed verification attempt the user was warned about — not on whatever
    // attempt happens to be latest when the click arrives.
    const expectedFailedVerificationAttemptRevision = requireNonNegativeInteger(
      input.expectedFailedVerificationAttemptRevision,
      'expectedFailedVerificationAttemptRevision',
    );
    const actor = requireUserActor(input.actor);

    return this.#write('recordUserBindingRollback', () => {
      const replay = this.#bindingOperationByRequestKey(requestKey);
      if (replay) {
        return this.#replayManualOperation(replay, {
          requestKey,
          role,
          kind: 'USER_ROLLBACK',
          expectedBindingRevision,
          actor,
          rollbackOfOperationId,
        });
      }

      const desired = this.#desiredRow(role);
      if (!desired) {
        fail('MODEL_FAILOVER_DESIRED_MISSING', 'Cannot rollback a manual binding without desired state', {
          role,
        });
      }
      const applied = this.#bindingOperationRow(rollbackOfOperationId);
      if (!applied) {
        fail('MODEL_FAILOVER_BINDING_OPERATION_MISSING', 'Rollback apply operation does not exist', {
          role,
          rollbackOfOperationId,
        });
      }
      if (applied.operation_kind !== 'USER_APPLY' || applied.role !== role) {
        fail('MODEL_FAILOVER_ROLLBACK_TARGET_INVALID', 'Rollback target is not an apply for this role', {
          role,
          rollbackOfOperationId,
        });
      }
      // Decision 022/A: inside the same transaction, the newest attempt of this
      // operation must still be exactly the FAILED verification the user acted
      // on. A background reverify appends a newer attempt and makes the click
      // stale — an application precheck alone cannot see that race.
      const latestAttempt = this.#bindingApplicationAttemptRows(rollbackOfOperationId).at(-1);
      // Exact revision equality is the whole check. A background reverify —
      // the race decision 022 names — appends a NEW attempt revision, so a click
      // issued against the failed verification no longer matches. Demanding the
      // named attempt also be FAILED would add nothing here and would reject the
      // legitimate rollback of a successfully verified binding.
      // An operation with no attempts yet is revision 0, the same convention the
      // derived application state uses.
      if ((latestAttempt?.attempt_revision ?? 0) !== expectedFailedVerificationAttemptRevision) {
        fail(
          'MODEL_FAILOVER_ROLLBACK_ATTEMPT_STALE',
          'Rollback no longer matches the failed verification attempt it was issued for',
          {
            role,
            rollbackOfOperationId,
            expectedFailedVerificationAttemptRevision,
            actualAttemptRevision: latestAttempt?.attempt_revision ?? null,
            actualAttemptKind: latestAttempt?.attempt_kind ?? null,
            actualOutcome: latestAttempt?.outcome ?? null,
          },
        );
      }
      const priorRollback = this.db.prepare(`
        SELECT operation_id, request_key
        FROM model_binding_operations
        WHERE rollback_of_operation_id = ?
      `).get(rollbackOfOperationId);
      if (priorRollback) {
        fail('MODEL_FAILOVER_ROLLBACK_ALREADY_RECORDED', 'Apply operation already has a rollback', {
          role,
          rollbackOfOperationId,
          rollbackOperationId: priorRollback.operation_id,
        });
      }
      if (desired.binding_revision !== expectedBindingRevision) {
        fail('MODEL_FAILOVER_STALE_DESIRED', 'Desired binding revision no longer matches', {
          role,
          expectedBindingRevision,
          actualBindingRevision: desired.binding_revision,
        });
      }
      const pendingProvider = this.#pendingProviderOperation(role, expectedBindingRevision);
      this.#failForPendingProviderOperation(pendingProvider, {
        role,
        expectedBindingRevision,
      });
      const currentMatchesApply = applied.committed_binding_revision === expectedBindingRevision
        && desired.source === 'USER_APPLY'
        && desired.model_name === applied.target_model_name
        && desired.canonical_name === applied.target_canonical_name
        && desired.digest_sha256 === applied.target_digest_sha256
        && desired.last_event_id === applied.desired_event_id;
      if (!currentMatchesApply) {
        fail('MODEL_FAILOVER_ROLLBACK_NOT_CURRENT', 'Rollback apply is not the current desired binding', {
          role,
          rollbackOfOperationId,
        });
      }
      const [unresolvedSuccess] = this.#unresolvedProviderSuccesses(
        role,
        expectedBindingRevision,
      );
      this.#failForUnresolvedProviderSuccess(unresolvedSuccess, {
        role,
        expectedBindingRevision,
      });
      let incident = this.#stateRow(role);
      if (incident?.state === 'SUPERSEDED_BY_USER') {
        this.#retireSupersededIncident(incident);
        incident = null;
      }
      if (incident) {
        this.#requireManualSupersedableIncident(incident, {
          role,
          expectedBindingRevision,
          desired,
        });
      }

      return this.#recordManualBinding({
        requestKey,
        role,
        kind: 'USER_ROLLBACK',
        actor,
        desired,
        targetModelName: applied.previous_model_name,
        targetCanonicalName: applied.previous_canonical_name,
        targetDigestSha256: applied.previous_digest_sha256,
        predecessorOperationId: applied.operation_id,
        rollbackOfOperationId: applied.operation_id,
        incident,
      });
    });
  }

  recordDetection(inputValue) {
    const input = requireInput(inputValue);
    rejectAuthorityOverrides(input, ['nowMs', 'eventId', 'episodeId', 'actor']);
    const role = requireRole(input.role);
    const expectedDesiredRevision = requirePositiveInteger(
      input.expectedDesiredRevision,
      'expectedDesiredRevision',
    );
    if (input.detectionOnly !== undefined && input.detectionOnly !== true) {
      fail(
        'MODEL_FAILOVER_DETECTION_ONLY_INVALID',
        'detectionOnly may only be the literal true',
      );
    }
    const detectionOnly = input.detectionOnly === true;
    if (input.requireAutoFailoverEnabled !== undefined
      && input.requireAutoFailoverEnabled !== true) {
      fail(
        'MODEL_FAILOVER_POLICY_REQUIREMENT_INVALID',
        'requireAutoFailoverEnabled may only be the literal true',
      );
    }
    const policyRequired = input.requireAutoFailoverEnabled === true;

    return this.#write('recordDetection', () => {
      requireCoordinatorPolicy(this.db, policyRequired);
      const desired = this.#desiredRow(role);
      if (!desired) {
        fail('MODEL_FAILOVER_DESIRED_MISSING', 'Cannot detect failover without a desired binding', { role });
      }
      if (desired.binding_revision !== expectedDesiredRevision) {
        fail('MODEL_FAILOVER_STALE_DESIRED', 'Desired binding revision no longer matches', {
          role,
          expectedDesiredRevision,
          actualDesiredRevision: desired.binding_revision,
        });
      }
      let existing = this.#stateRow(role);
      if (detectionOnly && existing) {
        const exactUnclaimedDetection = existing.desired_revision === expectedDesiredRevision
          && existing.state === 'DETECTED'
          && existing.active_failover === 0
          && existing.claim_token === null;
        if (!exactUnclaimedDetection) {
          fail('MODEL_FAILOVER_INCIDENT_EXISTS', 'A failover incident already exists for this role', {
            role,
            episodeId: existing.episode_id,
            state: existing.state,
          });
        }
      }
      if (MANUAL_DESIRED_SOURCES.has(desired.source)) {
        const operation = this.#currentManualOperation(desired);
        const applicationState = this.#bindingApplicationState(operation);
        fail(
          'MODEL_FAILOVER_RUNTIME_BINDING_UNCONFIRMED',
          'Automatic failover detection is disabled for manual binding authority',
          {
            role,
            bindingRevision: desired.binding_revision,
            operationId: operation.operation_id,
            runtimeStatus: applicationState.runtimeStatus,
            applicationState: applicationState.state,
            retryPrerequisite: 'AUTOMATIC_FAILOVER_COORDINATOR',
          },
        );
      }
      if (!detectionOnly && existing?.state === 'SUPERSEDED_BY_USER') {
        this.#retireSupersededIncident(existing);
        existing = null;
      }
      if (existing) {
        if (existing.policy_version !== MODEL_FAILOVER_POLICY_VERSION) {
          fail('MODEL_FAILOVER_POLICY_MISMATCH', 'Existing incident uses a different policy', {
            role,
            actualPolicyVersion: existing.policy_version,
          });
        }
        if (existing.desired_revision === expectedDesiredRevision
          && existing.state === 'DETECTED'
          && existing.active_failover === 0
          && existing.claim_token === null) {
          return { outcome: 'UNCHANGED', state: mapState(existing) };
        }
        fail('MODEL_FAILOVER_INCIDENT_EXISTS', 'A failover incident already exists for this role', {
          role,
          episodeId: existing.episode_id,
          state: existing.state,
        });
      }
      const detectedAtMs = this.#now('recordDetection');
      if (detectedAtMs < desired.updated_at_ms) {
        fail('MODEL_FAILOVER_CLOCK_ROLLBACK', 'Repository clock moved before desired state', {
          role,
          nowMs: detectedAtMs,
          updatedAtMs: desired.updated_at_ms,
        });
      }
      const episodeId = this.#id('episode');
      const eventId = this.#id('event');

      this.db.prepare(`
        INSERT INTO model_failover_events (
          event_id, event_type, role, binding_revision, row_version, episode_id,
          actor, reason_code, policy_version, state_after, desired_model_name,
          desired_digest_sha256, created_at_ms
        ) VALUES (?, 'DETECTED', ?, ?, 1, ?, ?, 'BOUND_MODEL_NOT_INSTALLED', ?,
          'DETECTED', ?, ?, ?)
      `).run(
        eventId,
        role,
        expectedDesiredRevision,
        episodeId,
        MODEL_FAILOVER_ACTOR,
        MODEL_FAILOVER_POLICY_VERSION,
        desired.model_name,
        desired.digest_sha256,
        detectedAtMs,
      );
      this.db.prepare(`
        INSERT INTO model_failover_state (
          role, desired_revision, episode_id, state, active_failover,
          policy_version, actor, reason_code, row_version, detected_at_ms,
          updated_at_ms, last_event_id
        ) VALUES (?, ?, ?, 'DETECTED', 0, ?, ?, 'BOUND_MODEL_NOT_INSTALLED',
          1, ?, ?, ?)
      `).run(
        role,
        expectedDesiredRevision,
        episodeId,
        MODEL_FAILOVER_POLICY_VERSION,
        MODEL_FAILOVER_ACTOR,
        detectedAtMs,
        detectedAtMs,
        eventId,
      );

      return { outcome: 'CREATED', state: mapState(this.#stateRow(role)) };
    });
  }

  claimOperation(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'role',
      'episodeId',
      'expectedDesiredRevision',
      'expectedRowVersion',
      'kind',
      'leaseMs',
      'requireAutoFailoverEnabled',
    ]);
    rejectAuthorityOverrides(input, [
      'nowMs',
      'eventId',
      'operationId',
      'claimToken',
      'actor',
    ]);
    const role = requireRole(input.role);
    const episodeId = requireString(input.episodeId, 'episodeId');
    const expectedDesiredRevision = requirePositiveInteger(
      input.expectedDesiredRevision,
      'expectedDesiredRevision',
    );
    const expectedRowVersion = requirePositiveInteger(
      input.expectedRowVersion,
      'expectedRowVersion',
    );
    const kind = requireString(input.kind, 'kind', { max: 16 }).toUpperCase();
    const claim = CLAIMS[kind];
    if (!claim) {
      fail('MODEL_FAILOVER_CLAIM_KIND_INVALID', 'Unknown failover claim kind', { kind });
    }
    const leaseMs = requirePositiveInteger(input.leaseMs, 'leaseMs');
    if (leaseMs > MAX_MODEL_FAILOVER_CLAIM_MS) {
      fail('MODEL_FAILOVER_CLAIM_WINDOW_INVALID', 'Failover claim lease exceeds the maximum', {
        leaseMs,
        maxClaimMs: MAX_MODEL_FAILOVER_CLAIM_MS,
      });
    }
    const requireAutoFailoverEnabled = input.requireAutoFailoverEnabled === undefined
      ? false
      : requireBoolean(input.requireAutoFailoverEnabled, 'requireAutoFailoverEnabled');

    return this.#write('claimOperation', () => {
      requireCoordinatorPolicy(this.db, requireAutoFailoverEnabled);
      const desired = this.#desiredRow(role);
      if (!desired) {
        fail('MODEL_FAILOVER_DESIRED_MISSING', 'Cannot claim failover without a desired binding', { role });
      }
      if (desired.binding_revision !== expectedDesiredRevision) {
        fail('MODEL_FAILOVER_STALE_DESIRED', 'Desired binding revision no longer matches', {
          role,
          expectedDesiredRevision,
          actualDesiredRevision: desired.binding_revision,
        });
      }
      const state = this.#stateRow(role);
      if (!state || state.episode_id !== episodeId) {
        fail('MODEL_FAILOVER_INCIDENT_MISMATCH', 'Failover incident does not match the claim', {
          role,
          episodeId,
        });
      }
      if (state.desired_revision !== expectedDesiredRevision) {
        fail('MODEL_FAILOVER_STALE_DESIRED', 'Incident desired revision no longer matches', {
          role,
          expectedDesiredRevision,
          actualDesiredRevision: state.desired_revision,
        });
      }
      if (state.row_version !== expectedRowVersion) {
        fail('MODEL_FAILOVER_STALE_STATE', 'Failover state row version no longer matches', {
          role,
          expectedRowVersion,
          actualRowVersion: state.row_version,
        });
      }
      if (state.policy_version !== MODEL_FAILOVER_POLICY_VERSION) {
        fail('MODEL_FAILOVER_POLICY_MISMATCH', 'Failover state policy version is not current', {
          role,
          actualPolicyVersion: state.policy_version,
        });
      }
      const nowMs = this.#now('claimOperation');
      if (nowMs < state.updated_at_ms) {
        fail('MODEL_FAILOVER_CLOCK_ROLLBACK', 'Repository clock moved before failover state', {
          role,
          nowMs,
          updatedAtMs: state.updated_at_ms,
        });
      }
      if (state.claim_token !== null) {
        const code = state.claim_expires_at_ms < nowMs
          ? 'MODEL_FAILOVER_CLAIM_EXPIRED_REQUIRES_RECLAIM'
          : 'MODEL_FAILOVER_CLAIM_HELD';
        fail(code, 'Failover state already has an operation claim', {
          role,
          claimKind: state.claim_kind,
          claimExpiresAtMs: state.claim_expires_at_ms,
        });
      }
      if (state.state !== claim.allowedState
        || state.active_failover !== claim.activeFailover) {
        fail('MODEL_FAILOVER_CLAIM_STATE_INVALID', 'Claim kind is not valid for the current state', {
          role,
          kind,
          state: state.state,
          activeFailover: state.active_failover === 1,
        });
      }
      const expiresAtMs = nowMs + leaseMs;
      if (!Number.isSafeInteger(expiresAtMs)) {
        fail('MODEL_FAILOVER_CLAIM_WINDOW_INVALID', 'Failover claim expiry overflows safe time');
      }
      const operationId = this.#id('operation');
      const token = this.#id('claimToken', { min: 16 });
      const eventId = this.#id('event');

      const nextRowVersion = incrementSafeInteger(expectedRowVersion, 'expectedRowVersion');
      this.db.prepare(`
        INSERT INTO model_failover_events (
          event_id, event_type, role, binding_revision, row_version, episode_id,
          operation_id, actor, reason_code, policy_version, state_before,
          state_after, desired_model_name, desired_digest_sha256, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'FAILOVER_OPERATION_CLAIMED', ?,
          ?, ?, ?, ?, ?)
      `).run(
        eventId,
        claim.eventType,
        role,
        expectedDesiredRevision,
        nextRowVersion,
        episodeId,
        operationId,
        MODEL_FAILOVER_ACTOR,
        MODEL_FAILOVER_POLICY_VERSION,
        state.state,
        state.state,
        desired.model_name,
        desired.digest_sha256,
        nowMs,
      );
      const update = this.db.prepare(`
        UPDATE model_failover_state
        SET row_version = ?, claim_operation_id = ?, claim_token = ?,
            claim_kind = ?, claim_started_at_ms = ?, claim_expires_at_ms = ?,
            updated_at_ms = ?, last_event_id = ?
        WHERE role = ? AND desired_revision = ? AND episode_id = ?
          AND row_version = ? AND state = ? AND active_failover = ?
          AND policy_version = ? AND claim_token IS NULL
      `).run(
        nextRowVersion,
        operationId,
        token,
        kind,
        nowMs,
        expiresAtMs,
        nowMs,
        eventId,
        role,
        expectedDesiredRevision,
        episodeId,
        expectedRowVersion,
        claim.allowedState,
        claim.activeFailover,
        MODEL_FAILOVER_POLICY_VERSION,
      );
      if (update.changes !== 1) {
        fail('MODEL_FAILOVER_STALE_STATE', 'Failover claim lost its state CAS', {
          role,
          expectedRowVersion,
        });
      }

      return {
        outcome: 'CLAIMED',
        claim: {
          operationId,
          token,
          kind,
          startedAtMs: nowMs,
          expiresAtMs,
          eventId,
        },
        state: mapState(this.#stateRow(role)),
      };
    });
  }

  listEligibleProofs(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'role',
      'roleContractSha256',
      'requireAutoFailoverEnabled',
    ]);
    const role = requireRole(input.role);
    const roleContractSha256 = requireContractHash(input.roleContractSha256);
    const requireAutoFailoverEnabled = input.requireAutoFailoverEnabled === undefined
      ? true
      : requireBoolean(input.requireAutoFailoverEnabled, 'requireAutoFailoverEnabled');
    return this.#read('listEligibleProofs', () => {
      requireCoordinatorPolicy(this.db, requireAutoFailoverEnabled);
      const nowMs = this.#now('listEligibleProofs');
      return this.db.prepare(`
        SELECT *
        FROM model_failover_proofs
        WHERE role = ?
          AND role_contract_sha256 = ?
          AND policy_version = ?
          AND result = 'PASS'
          AND completed_at_ms <= ?
          AND expires_at_ms > ?
          AND measurement_artifact_sha256 IS NOT NULL
          AND acceptance_artifact_sha256 IS NOT NULL
          AND source_revision IS NOT NULL
        ORDER BY completed_at_ms DESC, proof_id
      `).all(
        role,
        roleContractSha256,
        MODEL_FAILOVER_POLICY_VERSION,
        nowMs,
        nowMs,
      ).map(mapProof);
    });
  }

  completeOperation(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'role',
      'episodeId',
      'expectedDesiredRevision',
      'expectedRowVersion',
      'operationId',
      'claimToken',
      'kind',
      'proofId',
      'roleContractSha256',
      'targetModelName',
      'targetDigestSha256',
    ]);
    rejectAuthorityOverrides(input, ['nowMs', 'eventId', 'actor', 'policyVersion']);
    const role = requireRole(input.role);
    const episodeId = requireString(input.episodeId, 'episodeId');
    const expectedDesiredRevision = requirePositiveInteger(
      input.expectedDesiredRevision,
      'expectedDesiredRevision',
    );
    const expectedRowVersion = requirePositiveInteger(
      input.expectedRowVersion,
      'expectedRowVersion',
    );
    const operationId = requireString(input.operationId, 'operationId');
    const claimToken = requireString(input.claimToken, 'claimToken', { min: 16 });
    const kind = requireString(input.kind, 'kind', { max: 16 }).toUpperCase();
    const terminal = TERMINAL_OPERATIONS[kind];
    if (!terminal) {
      fail('MODEL_FAILOVER_CLAIM_KIND_INVALID', 'Unknown failover terminal kind', { kind });
    }
    const proofId = requireString(input.proofId, 'proofId', { min: 16 });
    const roleContractSha256 = requireContractHash(input.roleContractSha256);
    const targetModelName = requireString(input.targetModelName, 'targetModelName', { max: 512 });
    const targetCanonicalName = canonicalModelName(targetModelName);
    if (!targetCanonicalName) {
      fail('MODEL_FAILOVER_INPUT_INVALID', 'targetModelName has no canonical identity');
    }
    const targetDigestSha256 = requireDigest(input.targetDigestSha256, 'targetDigestSha256');
    const tokenDigest = claimTokenSha256(claimToken);

    return this.#write('completeOperation', () => {
      const replay = this.db.prepare(`
        SELECT * FROM model_failover_events
        WHERE operation_id = ? AND event_type = ?
      `).get(operationId, terminal.successEventType);
      if (replay) {
        let details;
        try {
          details = JSON.parse(replay.details_json);
        } catch (_) {
          details = null;
        }
        const replayTargetMatches = kind === 'RESTORE'
          ? replay.fallback_model_name === null
            && replay.fallback_canonical_name === null
            && replay.fallback_digest_sha256 === null
          : replay.fallback_model_name === targetModelName
            && replay.fallback_canonical_name === targetCanonicalName
            && replay.fallback_digest_sha256 === targetDigestSha256;
        if (replay.role === role
          && replay.binding_revision === expectedDesiredRevision
          && replay.episode_id === episodeId
          && replay.proof_id === proofId
          && replayTargetMatches
          && details?.claimTokenSha256 === tokenDigest
          && details?.roleContractSha256 === roleContractSha256) {
          return {
            outcome: 'ALREADY_COMPLETED',
            event: mapEvent(replay),
            state: mapState(this.#stateRow(role)),
          };
        }
        fail(
          'MODEL_FAILOVER_TERMINAL_IDENTITY_CONFLICT',
          'Failover operation already has a different terminal outcome',
          { operationId, kind },
        );
      }

      requireCoordinatorPolicy(this.db, kind === 'ACTIVATE' || kind === 'REAPPLY');
      const desired = this.#desiredRow(role);
      if (!desired || desired.binding_revision !== expectedDesiredRevision) {
        fail('MODEL_FAILOVER_STALE_DESIRED', 'Terminal desired binding no longer matches', {
          role,
          expectedDesiredRevision,
          actualDesiredRevision: desired?.binding_revision ?? null,
        });
      }
      const state = this.#stateRow(role);
      if (!state || state.episode_id !== episodeId) {
        fail('MODEL_FAILOVER_INCIDENT_MISMATCH', 'Terminal failover incident does not match', {
          role,
          episodeId,
        });
      }
      if (state.desired_revision !== expectedDesiredRevision
        || state.row_version !== expectedRowVersion) {
        fail('MODEL_FAILOVER_STALE_STATE', 'Terminal failover state no longer matches', {
          role,
          expectedRowVersion,
          actualRowVersion: state.row_version,
        });
      }
      if (state.policy_version !== MODEL_FAILOVER_POLICY_VERSION
        || state.state !== terminal.stateBefore
        || state.active_failover !== terminal.activeBefore
        || state.claim_kind !== kind
        || state.claim_operation_id !== operationId
        || state.claim_token !== claimToken) {
        fail('MODEL_FAILOVER_CLAIM_MISMATCH', 'Terminal failover claim tuple does not match', {
          role,
          kind,
          operationId,
        });
      }
      const nowMs = this.#now('completeOperation');
      if (nowMs < state.updated_at_ms) {
        fail('MODEL_FAILOVER_CLOCK_ROLLBACK', 'Repository clock moved before terminal state');
      }
      if (state.claim_expires_at_ms < nowMs) {
        fail('MODEL_FAILOVER_CLAIM_EXPIRED', 'Failover claim expired before terminal commit', {
          role,
          operationId,
          claimExpiresAtMs: state.claim_expires_at_ms,
          nowMs,
        });
      }
      const proof = this.db.prepare(`
        SELECT * FROM model_failover_proofs WHERE proof_id = ?
      `).get(proofId);
      if (!proof
        || proof.role !== role
        || proof.role_contract_sha256 !== roleContractSha256
        || proof.policy_version !== MODEL_FAILOVER_POLICY_VERSION
        || proof.result !== 'PASS'
        || proof.model_canonical_name !== targetCanonicalName
        || proof.model_digest_sha256 !== targetDigestSha256
        || proof.completed_at_ms > nowMs
        || proof.expires_at_ms <= nowMs
        || proof.measurement_artifact_sha256 === null
        || proof.acceptance_artifact_sha256 === null
        || proof.source_revision === null) {
        fail(
          'MODEL_FAILOVER_PROOF_INELIGIBLE',
          'Terminal transition requires the exact fresh artifact-bound role proof',
          { role, proofId, targetModelName, targetDigestSha256 },
        );
      }
      if (kind === 'ACTIVATE'
        && targetCanonicalName === desired.canonical_name) {
        fail(
          'MODEL_FAILOVER_FALLBACK_INVALID',
          'Fallback must differ from the missing desired model identity',
        );
      }
      if (kind === 'RESTORE'
        && (targetModelName !== desired.model_name
          || targetCanonicalName !== desired.canonical_name
          || targetDigestSha256 !== desired.digest_sha256)) {
        fail('MODEL_FAILOVER_RESTORE_TARGET_INVALID', 'Restore target is not the exact desired artifact');
      }
      if (kind === 'REAPPLY'
        && (targetModelName !== state.fallback_model_name
          || targetCanonicalName !== state.fallback_canonical_name
          || targetDigestSha256 !== state.fallback_digest_sha256)) {
        fail('MODEL_FAILOVER_REAPPLY_TARGET_INVALID', 'Reapply target is not the active fallback artifact');
      }

      const eventId = this.#id('event');
      const nextRowVersion = incrementSafeInteger(expectedRowVersion, 'expectedRowVersion');
      const fallback = kind === 'RESTORE'
        ? [null, null, null]
        : [targetModelName, targetCanonicalName, targetDigestSha256];
      const detailsJson = JSON.stringify({
        claimTokenSha256: tokenDigest,
        roleContractSha256,
      });
      this.db.prepare(`
        INSERT INTO model_failover_events (
          event_id, event_type, role, binding_revision, row_version, episode_id,
          operation_id, actor, reason_code, policy_version, state_before,
          state_after, desired_model_name, desired_digest_sha256,
          fallback_model_name, fallback_canonical_name, fallback_digest_sha256,
          proof_id, verified, details_json, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        eventId,
        terminal.successEventType,
        role,
        expectedDesiredRevision,
        nextRowVersion,
        episodeId,
        operationId,
        MODEL_FAILOVER_ACTOR,
        terminal.successReasonCode,
        MODEL_FAILOVER_POLICY_VERSION,
        terminal.stateBefore,
        terminal.stateAfter,
        desired.model_name,
        desired.digest_sha256,
        ...fallback,
        proofId,
        detailsJson,
        nowMs,
      );

      let update;
      if (kind === 'ACTIVATE') {
        update = this.db.prepare(`
          UPDATE model_failover_state
          SET state = 'ACTIVATED', active_failover = 1,
              fallback_model_name = ?, fallback_canonical_name = ?,
              fallback_digest_sha256 = ?, proof_id = ?, active_event_id = ?,
              actor = ?, reason_code = ?, failure_phase = NULL,
              proof_verified_at_ms = ?, row_version = ?,
              claim_operation_id = NULL, claim_token = NULL, claim_kind = NULL,
              claim_started_at_ms = NULL, claim_expires_at_ms = NULL,
              activated_at_ms = ?, resolved_at_ms = NULL,
              updated_at_ms = ?, last_event_id = ?
          WHERE role = ? AND desired_revision = ? AND episode_id = ?
            AND row_version = ? AND state = 'DETECTED' AND active_failover = 0
            AND policy_version = ? AND claim_operation_id = ?
            AND claim_token = ? AND claim_kind = 'ACTIVATE'
        `).run(
          targetModelName,
          targetCanonicalName,
          targetDigestSha256,
          proofId,
          eventId,
          MODEL_FAILOVER_ACTOR,
          terminal.successReasonCode,
          nowMs,
          nextRowVersion,
          nowMs,
          nowMs,
          eventId,
          role,
          expectedDesiredRevision,
          episodeId,
          expectedRowVersion,
          MODEL_FAILOVER_POLICY_VERSION,
          operationId,
          claimToken,
        );
      } else if (kind === 'REAPPLY') {
        update = this.db.prepare(`
          UPDATE model_failover_state
          SET fallback_model_name = ?, fallback_canonical_name = ?,
              fallback_digest_sha256 = ?, proof_id = ?, active_event_id = ?,
              actor = ?, reason_code = ?, failure_phase = NULL,
              proof_verified_at_ms = ?, row_version = ?,
              claim_operation_id = NULL, claim_token = NULL, claim_kind = NULL,
              claim_started_at_ms = NULL, claim_expires_at_ms = NULL,
              updated_at_ms = ?, last_event_id = ?
          WHERE role = ? AND desired_revision = ? AND episode_id = ?
            AND row_version = ? AND state = 'ACTIVATED' AND active_failover = 1
            AND policy_version = ? AND claim_operation_id = ?
            AND claim_token = ? AND claim_kind = 'REAPPLY'
        `).run(
          targetModelName,
          targetCanonicalName,
          targetDigestSha256,
          proofId,
          eventId,
          MODEL_FAILOVER_ACTOR,
          terminal.successReasonCode,
          nowMs,
          nextRowVersion,
          nowMs,
          eventId,
          role,
          expectedDesiredRevision,
          episodeId,
          expectedRowVersion,
          MODEL_FAILOVER_POLICY_VERSION,
          operationId,
          claimToken,
        );
      } else {
        update = this.db.prepare(`
          UPDATE model_failover_state
          SET state = 'RESTORED', active_failover = 0,
              actor = ?, reason_code = ?, failure_phase = NULL,
              row_version = ?, claim_operation_id = NULL, claim_token = NULL,
              claim_kind = NULL, claim_started_at_ms = NULL,
              claim_expires_at_ms = NULL, resolved_at_ms = ?,
              updated_at_ms = ?, last_event_id = ?
          WHERE role = ? AND desired_revision = ? AND episode_id = ?
            AND row_version = ? AND state = 'ACTIVATED' AND active_failover = 1
            AND policy_version = ? AND claim_operation_id = ?
            AND claim_token = ? AND claim_kind = 'RESTORE'
        `).run(
          MODEL_FAILOVER_ACTOR,
          terminal.successReasonCode,
          nextRowVersion,
          nowMs,
          nowMs,
          eventId,
          role,
          expectedDesiredRevision,
          episodeId,
          expectedRowVersion,
          MODEL_FAILOVER_POLICY_VERSION,
          operationId,
          claimToken,
        );
      }
      if (update.changes !== 1) {
        fail('MODEL_FAILOVER_STALE_STATE', 'Terminal failover transition lost its state CAS', {
          role,
          expectedRowVersion,
        });
      }
      return {
        outcome: 'COMPLETED',
        proof: mapProof(proof),
        event: mapEvent(this.db.prepare('SELECT * FROM model_failover_events WHERE event_id = ?').get(eventId)),
        state: mapState(this.#stateRow(role)),
      };
    });
  }

  failOperation(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'role',
      'episodeId',
      'expectedDesiredRevision',
      'expectedRowVersion',
      'operationId',
      'claimToken',
      'kind',
      'failurePhase',
    ]);
    rejectAuthorityOverrides(input, ['nowMs', 'eventId', 'actor', 'reasonCode']);
    const role = requireRole(input.role);
    const episodeId = requireString(input.episodeId, 'episodeId');
    const expectedDesiredRevision = requirePositiveInteger(
      input.expectedDesiredRevision,
      'expectedDesiredRevision',
    );
    const expectedRowVersion = requirePositiveInteger(
      input.expectedRowVersion,
      'expectedRowVersion',
    );
    const operationId = requireString(input.operationId, 'operationId');
    const claimToken = requireString(input.claimToken, 'claimToken', { min: 16 });
    const kind = requireString(input.kind, 'kind', { max: 16 }).toUpperCase();
    const terminal = TERMINAL_OPERATIONS[kind];
    if (!terminal) {
      fail('MODEL_FAILOVER_CLAIM_KIND_INVALID', 'Unknown failover terminal kind', { kind });
    }
    const failurePhase = requireString(input.failurePhase, 'failurePhase', { max: 32 }).toUpperCase();
    if (!FAILOVER_FAILURE_PHASES.has(failurePhase)) {
      fail('MODEL_FAILOVER_FAILURE_PHASE_INVALID', 'Unknown failover failure phase', {
        failurePhase,
      });
    }
    const tokenDigest = claimTokenSha256(claimToken);

    return this.#write('failOperation', () => {
      const replay = this.db.prepare(`
        SELECT * FROM model_failover_events
        WHERE operation_id = ? AND event_type = ?
      `).get(operationId, terminal.failureEventType);
      if (replay) {
        let details;
        try {
          details = JSON.parse(replay.details_json);
        } catch (_) {
          details = null;
        }
        if (replay.role === role
          && replay.binding_revision === expectedDesiredRevision
          && replay.episode_id === episodeId
          && replay.failure_phase === failurePhase
          && details?.claimTokenSha256 === tokenDigest) {
          return {
            outcome: 'ALREADY_FAILED',
            event: mapEvent(replay),
            state: mapState(this.#stateRow(role)),
          };
        }
        fail(
          'MODEL_FAILOVER_TERMINAL_IDENTITY_CONFLICT',
          'Failover operation already has a different failure outcome',
          { operationId, kind },
        );
      }
      const desired = this.#desiredRow(role);
      const state = this.#stateRow(role);
      if (!desired || desired.binding_revision !== expectedDesiredRevision) {
        fail('MODEL_FAILOVER_STALE_DESIRED', 'Failed operation desired binding no longer matches');
      }
      if (!state
        || state.episode_id !== episodeId
        || state.desired_revision !== expectedDesiredRevision
        || state.row_version !== expectedRowVersion
        || state.policy_version !== MODEL_FAILOVER_POLICY_VERSION
        || state.state !== terminal.stateBefore
        || state.active_failover !== terminal.activeBefore
        || state.claim_kind !== kind
        || state.claim_operation_id !== operationId
        || state.claim_token !== claimToken) {
        fail('MODEL_FAILOVER_CLAIM_MISMATCH', 'Failed operation claim tuple does not match', {
          role,
          kind,
          operationId,
        });
      }
      const nowMs = this.#now('failOperation');
      if (nowMs < state.updated_at_ms) {
        fail('MODEL_FAILOVER_CLOCK_ROLLBACK', 'Repository clock moved before failed operation');
      }
      const eventId = this.#id('event');
      const nextRowVersion = incrementSafeInteger(expectedRowVersion, 'expectedRowVersion');
      const stateAfter = kind === 'ACTIVATE' ? 'FAILED' : 'ACTIVATED';
      const detailsJson = JSON.stringify({ claimTokenSha256: tokenDigest });
      this.db.prepare(`
        INSERT INTO model_failover_events (
          event_id, event_type, role, binding_revision, row_version, episode_id,
          operation_id, actor, reason_code, policy_version, state_before,
          state_after, desired_model_name, desired_digest_sha256,
          fallback_model_name, fallback_canonical_name, fallback_digest_sha256,
          verified, failure_phase, details_json, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      `).run(
        eventId,
        terminal.failureEventType,
        role,
        expectedDesiredRevision,
        nextRowVersion,
        episodeId,
        operationId,
        MODEL_FAILOVER_ACTOR,
        terminal.failureReasonCode,
        MODEL_FAILOVER_POLICY_VERSION,
        terminal.stateBefore,
        stateAfter,
        desired.model_name,
        desired.digest_sha256,
        kind === 'ACTIVATE' ? null : state.fallback_model_name,
        kind === 'ACTIVATE' ? null : state.fallback_canonical_name,
        kind === 'ACTIVATE' ? null : state.fallback_digest_sha256,
        failurePhase,
        detailsJson,
        nowMs,
      );
      const update = this.db.prepare(`
        UPDATE model_failover_state
        SET state = ?, active_failover = ?, actor = ?, reason_code = ?,
            failure_phase = ?, row_version = ?, claim_operation_id = NULL,
            claim_token = NULL, claim_kind = NULL, claim_started_at_ms = NULL,
            claim_expires_at_ms = NULL, updated_at_ms = ?, last_event_id = ?
        WHERE role = ? AND desired_revision = ? AND episode_id = ?
          AND row_version = ? AND state = ? AND active_failover = ?
          AND policy_version = ? AND claim_operation_id = ?
          AND claim_token = ? AND claim_kind = ?
      `).run(
        stateAfter,
        terminal.activeBefore,
        MODEL_FAILOVER_ACTOR,
        terminal.failureReasonCode,
        kind === 'ACTIVATE' ? failurePhase : null,
        nextRowVersion,
        nowMs,
        eventId,
        role,
        expectedDesiredRevision,
        episodeId,
        expectedRowVersion,
        terminal.stateBefore,
        terminal.activeBefore,
        MODEL_FAILOVER_POLICY_VERSION,
        operationId,
        claimToken,
        kind,
      );
      if (update.changes !== 1) {
        fail('MODEL_FAILOVER_STALE_STATE', 'Failed failover operation lost its state CAS', {
          role,
          expectedRowVersion,
        });
      }
      return {
        outcome: 'FAILED',
        event: mapEvent(this.db.prepare('SELECT * FROM model_failover_events WHERE event_id = ?').get(eventId)),
        state: mapState(this.#stateRow(role)),
      };
    });
  }

  getRuntimeFinalization(operationIdValue) {
    const operationId = requireString(operationIdValue, 'operationId');
    return this.#read('getRuntimeFinalization', () => mapRuntimeFinalization(
      this.db.prepare(`
        SELECT event.operation_id, event.event_id AS terminal_event_id,
          event.event_type, event.role, event.episode_id,
          event.desired_model_name, event.desired_digest_sha256,
          event.fallback_model_name, event.fallback_canonical_name,
          event.fallback_digest_sha256,
          event.created_at_ms AS transition_created_at_ms,
          receipt.receipt_id, receipt.finalize_kind, receipt.config_version,
          receipt.created_at_ms AS finalized_at_ms
        FROM model_failover_events event
        LEFT JOIN model_failover_runtime_finalize_receipts receipt
          ON receipt.operation_id = event.operation_id
         AND receipt.terminal_event_id = event.event_id
        WHERE event.operation_id = ?
          AND event.event_type IN ('ACTIVATED','REAPPLIED','RESTORED')
      `).get(operationId),
    ));
  }

  listPendingRuntimeFinalizations() {
    return this.#read('listPendingRuntimeFinalizations', () => this.db.prepare(`
      SELECT event.operation_id, event.event_id AS terminal_event_id,
        event.event_type, event.role, event.episode_id,
        event.desired_model_name, event.desired_digest_sha256,
        event.fallback_model_name, event.fallback_canonical_name,
        event.fallback_digest_sha256,
        event.created_at_ms AS transition_created_at_ms,
        NULL AS receipt_id, NULL AS finalize_kind, NULL AS config_version,
        NULL AS finalized_at_ms
      FROM model_failover_events event
      LEFT JOIN model_failover_runtime_finalize_receipts receipt
        ON receipt.operation_id = event.operation_id
       AND receipt.terminal_event_id = event.event_id
      WHERE event.event_type IN ('ACTIVATED','REAPPLIED','RESTORED')
        AND receipt.receipt_id IS NULL
      ORDER BY event.seq
    `).all().map(mapRuntimeFinalization));
  }

  recordRuntimeFinalized(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'operationId',
      'terminalEventId',
      'configVersion',
      'finalizeKind',
    ]);
    rejectAuthorityOverrides(input, ['receiptId', 'nowMs', 'role', 'episodeId']);
    const operationId = requireString(input.operationId, 'operationId');
    const terminalEventId = requireString(input.terminalEventId, 'terminalEventId');
    const configVersion = requireNonNegativeInteger(input.configVersion, 'configVersion');
    const finalizeKind = requireString(input.finalizeKind, 'finalizeKind', { max: 32 }).toUpperCase();
    if (!new Set(['DIRECT_CONFIRMED', 'RECOVERED_OBSERVED']).has(finalizeKind)) {
      fail('MODEL_FAILOVER_RUNTIME_FINALIZE_KIND_INVALID', 'Unknown runtime finalize kind', {
        finalizeKind,
      });
    }

    return this.#write('recordRuntimeFinalized', () => {
      const terminal = this.db.prepare(`
        SELECT * FROM model_failover_events
        WHERE operation_id = ? AND event_id = ?
          AND event_type IN ('ACTIVATED','REAPPLIED','RESTORED')
          AND verified = 1
      `).get(operationId, terminalEventId);
      if (!terminal) {
        fail(
          'MODEL_FAILOVER_RUNTIME_FINALIZE_TARGET_INVALID',
          'Runtime finalize receipt requires an exact successful terminal event',
          { operationId, terminalEventId },
        );
      }
      const existing = this.db.prepare(`
        SELECT * FROM model_failover_runtime_finalize_receipts
        WHERE operation_id = ? OR terminal_event_id = ?
      `).get(operationId, terminalEventId);
      if (existing) {
        if (existing.operation_id === operationId
          && existing.terminal_event_id === terminalEventId
          && existing.finalize_kind === finalizeKind
          && existing.config_version === configVersion) {
          return {
            outcome: 'ALREADY_FINALIZED',
            finalization: this.getRuntimeFinalization(operationId),
          };
        }
        fail(
          'MODEL_FAILOVER_RUNTIME_FINALIZE_IDENTITY_CONFLICT',
          'Runtime finalize receipt already exists with a different identity',
          { operationId, terminalEventId },
        );
      }
      const state = this.#stateRow(terminal.role);
      const currentTerminal = terminal.event_type === 'RESTORED'
        ? state?.state === 'RESTORED' && state.last_event_id === terminalEventId
        : state?.state === 'ACTIVATED' && state.active_event_id === terminalEventId;
      if (!currentTerminal) {
        fail(
          'MODEL_FAILOVER_RUNTIME_FINALIZE_STALE',
          'Runtime finalize target is no longer the current failover transition',
          { operationId, terminalEventId, role: terminal.role },
        );
      }
      const nowMs = this.#now('recordRuntimeFinalized');
      if (nowMs < terminal.created_at_ms) {
        fail('MODEL_FAILOVER_CLOCK_ROLLBACK', 'Repository clock moved before terminal event');
      }
      const receiptId = this.#id('event');
      this.db.prepare(`
        INSERT INTO model_failover_runtime_finalize_receipts (
          receipt_id, operation_id, terminal_event_id, role, episode_id,
          finalize_kind, config_version, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        receiptId,
        operationId,
        terminalEventId,
        terminal.role,
        terminal.episode_id,
        finalizeKind,
        configVersion,
        nowMs,
      );
      return {
        outcome: 'FINALIZED',
        finalization: this.getRuntimeFinalization(operationId),
      };
    });
  }

  getRuntimeHealth(roleValue) {
    const role = requireRole(roleValue);
    return this.#read('getRuntimeHealth', () => {
      const nowMs = this.#now('getRuntimeHealth');
      const row = this.db.prepare(`
        SELECT state.role, state.episode_id, state.active_event_id,
          state.proof_id, proof.expires_at_ms AS proof_expires_at_ms,
          health.health_status, health.observed_at_ms AS health_observed_at_ms,
          ? AS observed_now_ms
        FROM model_failover_state state
        JOIN model_failover_proofs proof ON proof.proof_id = state.proof_id
        LEFT JOIN model_failover_health_events health
          ON health.active_event_id = state.active_event_id
         AND health.health_status = 'DEGRADED_PROOF_EXPIRED'
        WHERE state.role = ? AND state.state = 'ACTIVATED'
          AND state.active_failover = 1
      `).get(nowMs, role);
      return mapRuntimeHealth(row);
    });
  }

  recordActiveProofExpired(inputValue) {
    const input = requireInput(inputValue);
    requireExactInputFields(input, [
      'role',
      'episodeId',
      'expectedRowVersion',
      'activeEventId',
    ]);
    rejectAuthorityOverrides(input, ['healthEventId', 'nowMs', 'proofId', 'healthStatus']);
    const role = requireRole(input.role);
    const episodeId = requireString(input.episodeId, 'episodeId');
    const expectedRowVersion = requirePositiveInteger(input.expectedRowVersion, 'expectedRowVersion');
    const activeEventId = requireString(input.activeEventId, 'activeEventId');

    return this.#write('recordActiveProofExpired', () => {
      const state = this.#stateRow(role);
      if (!state
        || state.episode_id !== episodeId
        || state.row_version !== expectedRowVersion
        || state.state !== 'ACTIVATED'
        || state.active_failover !== 1
        || state.active_event_id !== activeEventId
        || state.proof_id === null) {
        fail('MODEL_FAILOVER_STALE_STATE', 'Active proof-expiry state no longer matches', {
          role,
          episodeId,
          expectedRowVersion,
          activeEventId,
        });
      }
      const existing = this.db.prepare(`
        SELECT * FROM model_failover_health_events
        WHERE active_event_id = ? AND health_status = 'DEGRADED_PROOF_EXPIRED'
      `).get(activeEventId);
      if (existing) {
        return {
          outcome: 'ALREADY_RECORDED',
          health: this.getRuntimeHealth(role),
        };
      }
      const proof = this.db.prepare(`
        SELECT * FROM model_failover_proofs WHERE proof_id = ?
      `).get(state.proof_id);
      const nowMs = this.#now('recordActiveProofExpired');
      if (!proof || proof.expires_at_ms > nowMs) {
        fail('MODEL_FAILOVER_PROOF_STILL_FRESH', 'Active proof has not expired', {
          role,
          proofId: state.proof_id,
          expiresAtMs: proof?.expires_at_ms ?? null,
          nowMs,
        });
      }
      const healthEventId = this.#id('event');
      this.db.prepare(`
        INSERT INTO model_failover_health_events (
          health_event_id, role, episode_id, active_event_id, proof_id,
          health_status, observed_at_ms
        ) VALUES (?, ?, ?, ?, ?, 'DEGRADED_PROOF_EXPIRED', ?)
      `).run(
        healthEventId,
        role,
        episodeId,
        activeEventId,
        state.proof_id,
        nowMs,
      );
      return {
        outcome: 'RECORDED',
        health: this.getRuntimeHealth(role),
      };
    });
  }

  expireClaim(inputValue) {
    const input = requireInput(inputValue);
    rejectAuthorityOverrides(input, [
      'nowMs',
      'eventId',
      'operationId',
      'actor',
      'claimToken',
    ]);
    const role = requireRole(input.role);
    const episodeId = requireString(input.episodeId, 'episodeId');
    const expectedDesiredRevision = requirePositiveInteger(
      input.expectedDesiredRevision,
      'expectedDesiredRevision',
    );
    const expectedRowVersion = requirePositiveInteger(
      input.expectedRowVersion,
      'expectedRowVersion',
    );
    const expectedOperationId = requireString(
      input.expectedOperationId,
      'expectedOperationId',
    );
    const expectedClaimKind = requireString(
      input.expectedClaimKind,
      'expectedClaimKind',
      { max: 16 },
    ).toUpperCase();
    const claim = CLAIMS[expectedClaimKind];
    if (!claim) {
      fail('MODEL_FAILOVER_CLAIM_KIND_INVALID', 'Unknown failover claim kind', {
        kind: expectedClaimKind,
      });
    }
    const nextExpectedRowVersion = incrementSafeInteger(
      expectedRowVersion,
      'expectedRowVersion',
    );

    return this.#write('expireClaim', () => {
      const desired = this.#desiredRow(role);
      if (!desired) {
        fail('MODEL_FAILOVER_DESIRED_MISSING', 'Cannot expire claim without a desired binding', { role });
      }
      if (desired.binding_revision !== expectedDesiredRevision) {
        fail('MODEL_FAILOVER_STALE_DESIRED', 'Desired binding revision no longer matches', {
          role,
          expectedDesiredRevision,
          actualDesiredRevision: desired.binding_revision,
        });
      }
      const state = this.#stateRow(role);
      if (!state || state.episode_id !== episodeId) {
        fail('MODEL_FAILOVER_INCIDENT_MISMATCH', 'Failover incident does not match the expiry request', {
          role,
          episodeId,
        });
      }
      if (state.desired_revision !== expectedDesiredRevision) {
        fail('MODEL_FAILOVER_STALE_DESIRED', 'Incident desired revision no longer matches', {
          role,
          expectedDesiredRevision,
          actualDesiredRevision: state.desired_revision,
        });
      }
      if (state.policy_version !== MODEL_FAILOVER_POLICY_VERSION) {
        fail('MODEL_FAILOVER_POLICY_MISMATCH', 'Failover state policy version is not current', {
          role,
          actualPolicyVersion: state.policy_version,
        });
      }
      if (state.row_version === nextExpectedRowVersion
        && state.claim_token === null) {
        const expiryEvent = this.db.prepare(`
          SELECT * FROM model_failover_events
          WHERE event_id = ? AND event_type = 'CLAIM_EXPIRED'
            AND role = ? AND binding_revision = ? AND row_version = ?
            AND episode_id = ? AND operation_id = ? AND policy_version = ?
            AND state_before = ? AND state_after = ?
            AND desired_model_name = ? AND desired_digest_sha256 = ?
            AND reason_code = 'EXPIRED_CLAIM_RELEASED'
        `).get(
          state.last_event_id,
          role,
          expectedDesiredRevision,
          nextExpectedRowVersion,
          episodeId,
          expectedOperationId,
          MODEL_FAILOVER_POLICY_VERSION,
          state.state,
          state.state,
          desired.model_name,
          desired.digest_sha256,
        );
        const claimedEvent = this.db.prepare(`
          SELECT event_id FROM model_failover_events
          WHERE operation_id = ? AND event_type = ? AND role = ?
            AND binding_revision = ? AND episode_id = ?
            AND state_before = ? AND state_after = ?
            AND desired_model_name = ? AND desired_digest_sha256 = ?
        `).get(
          expectedOperationId,
          claim.eventType,
          role,
          expectedDesiredRevision,
          episodeId,
          state.state,
          state.state,
          desired.model_name,
          desired.digest_sha256,
        );
        if (expiryEvent && claimedEvent) {
          return {
            outcome: 'ALREADY_EXPIRED',
            expiredOperationId: expectedOperationId,
            eventId: expiryEvent.event_id,
            state: mapState(state),
          };
        }
      }
      if (state.row_version !== expectedRowVersion) {
        fail('MODEL_FAILOVER_STALE_STATE', 'Failover state row version no longer matches', {
          role,
          expectedRowVersion,
          actualRowVersion: state.row_version,
        });
      }
      if (state.claim_token === null) {
        fail('MODEL_FAILOVER_CLAIM_MISSING', 'Failover state has no claim to expire', { role });
      }
      if (state.claim_operation_id !== expectedOperationId
        || state.claim_kind !== expectedClaimKind) {
        fail('MODEL_FAILOVER_CLAIM_MISMATCH', 'Claim tuple does not match the expiry request', {
          role,
          expectedOperationId,
          actualOperationId: state.claim_operation_id,
          expectedKind: expectedClaimKind,
          actualKind: state.claim_kind,
        });
      }
      if (state.state !== claim.allowedState
        || state.active_failover !== claim.activeFailover) {
        fail('MODEL_FAILOVER_CLAIM_STATE_INVALID', 'Claim kind is not valid for the current state', {
          role,
          kind: expectedClaimKind,
          state: state.state,
          activeFailover: state.active_failover === 1,
        });
      }
      const nowMs = this.#now('expireClaim');
      if (nowMs < state.updated_at_ms) {
        fail('MODEL_FAILOVER_CLOCK_ROLLBACK', 'Repository clock moved before failover state', {
          role,
          nowMs,
          updatedAtMs: state.updated_at_ms,
        });
      }
      if (state.claim_expires_at_ms >= nowMs) {
        fail('MODEL_FAILOVER_CLAIM_NOT_EXPIRED', 'Failover claim is still live', {
          role,
          claimExpiresAtMs: state.claim_expires_at_ms,
          nowMs,
        });
      }

      const eventId = this.#id('event');

      this.db.prepare(`
        INSERT INTO model_failover_events (
          event_id, event_type, role, binding_revision, row_version, episode_id,
          operation_id, actor, reason_code, policy_version, state_before,
          state_after, desired_model_name, desired_digest_sha256, created_at_ms
        ) VALUES (?, 'CLAIM_EXPIRED', ?, ?, ?, ?, ?, ?, 'EXPIRED_CLAIM_RELEASED',
          ?, ?, ?, ?, ?, ?)
      `).run(
        eventId,
        role,
        expectedDesiredRevision,
        nextExpectedRowVersion,
        episodeId,
        expectedOperationId,
        MODEL_FAILOVER_ACTOR,
        MODEL_FAILOVER_POLICY_VERSION,
        state.state,
        state.state,
        desired.model_name,
        desired.digest_sha256,
        nowMs,
      );
      const expired = this.db.prepare(`
        UPDATE model_failover_state
        SET row_version = ?, claim_operation_id = NULL, claim_token = NULL,
            claim_kind = NULL, claim_started_at_ms = NULL,
            claim_expires_at_ms = NULL, updated_at_ms = ?, last_event_id = ?
        WHERE role = ? AND desired_revision = ? AND episode_id = ?
          AND row_version = ? AND state = ? AND active_failover = ?
          AND policy_version = ? AND claim_operation_id = ?
          AND claim_kind = ? AND claim_token = ?
          AND claim_started_at_ms = ? AND claim_expires_at_ms = ?
          AND claim_expires_at_ms < ?
      `).run(
        nextExpectedRowVersion,
        nowMs,
        eventId,
        role,
        expectedDesiredRevision,
        episodeId,
        expectedRowVersion,
        claim.allowedState,
        claim.activeFailover,
        MODEL_FAILOVER_POLICY_VERSION,
        expectedOperationId,
        expectedClaimKind,
        state.claim_token,
        state.claim_started_at_ms,
        state.claim_expires_at_ms,
        nowMs,
      );
      if (expired.changes !== 1) {
        fail('MODEL_FAILOVER_STALE_STATE', 'Expired claim lost its state CAS', {
          role,
          expectedRowVersion,
        });
      }

      return {
        outcome: 'EXPIRED',
        expiredOperationId: expectedOperationId,
        eventId,
        state: mapState(this.#stateRow(role)),
      };
    });
  }

  listActiveForRestart() {
    return this.#read('listActiveForRestart', () => this.db.prepare(`
      SELECT state.*
      FROM model_failover_state state
      JOIN model_desired_bindings desired
        ON desired.role = state.role
       AND desired.binding_revision = state.desired_revision
      WHERE state.active_failover = 1
      ORDER BY state.role
    `).all().map(mapState));
  }

  listEvents(inputValue) {
    const input = requireInput(inputValue);
    const role = requireRole(input.role);
    const rawAfterSeq = input.afterSeq ?? 0;
    const afterSeq = rawAfterSeq === 0
      ? 0
      : requirePositiveInteger(rawAfterSeq, 'afterSeq');
    const limit = requirePositiveInteger(input.limit ?? 100, 'limit');
    if (limit > 500) {
      fail('MODEL_FAILOVER_EVENT_LIMIT_INVALID', 'Event page limit exceeds 500', { limit });
    }
    return this.#read('listEvents', () => this.db.prepare(`
      SELECT * FROM model_failover_events
      WHERE role = ? AND seq > ?
      ORDER BY seq
      LIMIT ?
    `).all(role, afterSeq, limit).map(mapEvent));
  }
}

export function createModelFailoverRepository(db, options = {}) {
  return new ModelFailoverRepository(db, options);
}
