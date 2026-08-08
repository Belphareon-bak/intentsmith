// Audited local model failover repository.
//
// This checkpoint owns desired-binding observation, incident detection and
// bounded operation claims. It deliberately does not apply a runtime model,
// execute validation, activate a proof, restore a binding or schedule work.

import { randomUUID } from 'node:crypto';
import { canonicalModelName } from './model-identity.js';

export const MODEL_FAILOVER_POLICY_VERSION = 'd-plus-v1';
export const MODEL_FAILOVER_ACTOR = 'system:binding-integrity';
export const MAX_MODEL_FAILOVER_CLAIM_MS = 5 * 60 * 1000;

const ROLES = new Set(['D1', 'D2', 'CODE', 'R1', 'R2', 'CHAT', 'VISION']);
const OBSERVABLE_DESIRED_SOURCES = new Set([
  'CONFIG_DEFAULT',
  'LEGACY_OVERRIDE',
]);
const MANUAL_DESIRED_SOURCES = new Set(['USER_APPLY', 'USER_ROLLBACK']);
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
const DEFAULT_IDS = Object.freeze({
  event: () => `evt_${randomUUID()}`,
  episode: () => `ep_${randomUUID()}`,
  operation: () => `op_${randomUUID()}`,
  claimToken: () => `claim_${randomUUID()}`,
});

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

function requireDigest(value, field = 'digestSha256') {
  const digest = requireString(value, field, { min: 64, max: 64 });
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    fail('MODEL_FAILOVER_DIGEST_INVALID', `${field} must be lowercase SHA-256`, { field });
  }
  return digest;
}

function requirePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('MODEL_FAILOVER_INPUT_INVALID', `${field} must be a positive safe integer`, { field });
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
      if (sqliteCode === 'SQLITE_CONSTRAINT_UNIQUE'
        || sqliteCode === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
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

  getDesired(roleValue) {
    const role = requireRole(roleValue);
    return this.#read('getDesired', () => mapDesired(this.#desiredRow(role)));
  }

  getState(roleValue) {
    const role = requireRole(roleValue);
    return this.#read('getState', () => mapState(this.#stateRow(role)));
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
        'MODEL_FAILOVER_MANUAL_SEAM_NOT_IMPLEMENTED',
        'Manual binding changes require the future atomic override and supersede seam',
        { source },
      );
    }
    if (!OBSERVABLE_DESIRED_SOURCES.has(source)) {
      fail('MODEL_FAILOVER_SOURCE_INVALID', 'Unknown desired binding source', { source });
    }
    const actor = requireString(input.actor, 'actor');

    return this.#write('observeDesiredBinding', () => {
      const existing = this.#desiredRow(role);
      if (existing
        && existing.canonical_name === canonicalName
        && existing.digest_sha256 === digestSha256
        && existing.source === source) {
        return { outcome: 'UNCHANGED', binding: mapDesired(existing) };
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

  recordDetection(inputValue) {
    const input = requireInput(inputValue);
    rejectAuthorityOverrides(input, ['nowMs', 'eventId', 'episodeId', 'actor']);
    const role = requireRole(input.role);
    const expectedDesiredRevision = requirePositiveInteger(
      input.expectedDesiredRevision,
      'expectedDesiredRevision',
    );

    return this.#write('recordDetection', () => {
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
      const existing = this.#stateRow(role);
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

    return this.#write('claimOperation', () => {
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
