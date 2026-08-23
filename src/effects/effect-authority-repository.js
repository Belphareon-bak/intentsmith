import {
  M2_EFFECT_CONTRACT_KIND,
  canonicalStringify,
  computeEffectRequestDigest,
  timestampToMs,
  validateApprovalGrant,
  validateEffectRequest,
  validateEffectResult,
} from '../../contracts/m2/effect-v1.js';

export const EffectAuthorityErrorCode = Object.freeze({
  INPUT_INVALID: 'EFFECT_AUTHORITY_INPUT_INVALID',
  REQUEST_NOT_FOUND: 'EFFECT_REQUEST_NOT_FOUND',
  REQUEST_CONFLICT: 'EFFECT_REQUEST_CONFLICT',
  RESULT_CONFLICT: 'EFFECT_RESULT_CONFLICT',
  RESULT_AUTHORITY_MISSING: 'EFFECT_RESULT_AUTHORITY_MISSING',
  GRANT_NOT_FOUND: 'APPROVAL_GRANT_NOT_FOUND',
  GRANT_SCOPE_MISMATCH: 'APPROVAL_GRANT_SCOPE_MISMATCH',
  GRANT_NOT_YET_VALID: 'APPROVAL_GRANT_NOT_YET_VALID',
  GRANT_EXPIRED: 'APPROVAL_GRANT_EXPIRED',
  GRANT_REVOKED: 'APPROVAL_GRANT_REVOKED',
  GRANT_CONSUMED: 'APPROVAL_GRANT_CONSUMED',
  GRANT_CONFLICT: 'APPROVAL_GRANT_CONFLICT',
  STORAGE_FAILURE: 'EFFECT_AUTHORITY_STORAGE_FAILURE',
});

export class EffectAuthorityError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'EffectAuthorityError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new EffectAuthorityError(code, message, details);
}

function requireDatabase(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    fail(EffectAuthorityErrorCode.INPUT_INVALID, 'A better-sqlite3 database is required');
  }
  return db;
}

function requireValid(value, validator, label) {
  const validation = validator(value);
  if (!validation.valid) {
    fail(
      EffectAuthorityErrorCode.INPUT_INVALID,
      `${label} is invalid`,
      { errors: [...validation.errors] },
    );
  }
  return value;
}

function isoFromMs(value) {
  return new Date(value).toISOString();
}

function requireTimestamp(value, label) {
  try {
    return timestampToMs(value);
  } catch {
    fail(EffectAuthorityErrorCode.INPUT_INVALID, `${label} must be a canonical ISO timestamp`);
  }
}

function immediate(db, callback) {
  const tx = db.transaction(callback);
  return tx.immediate ? tx.immediate() : tx();
}

function requireClock(clock) {
  if (typeof clock !== 'function') {
    fail(EffectAuthorityErrorCode.INPUT_INVALID, 'A trusted authority clock is required');
  }
  return clock;
}

function requireExecutionOwner(value) {
  const valid = value
    && typeof value === 'object'
    && typeof value.ownerId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.ownerId)
    && Number.isSafeInteger(value.pid)
    && value.pid > 0
    && typeof value.bootId === 'string'
    && value.bootId.trim().length > 0
    && value.bootId.length <= 256
    && typeof value.startIdentity === 'string'
    && value.startIdentity.trim().length > 0
    && value.startIdentity.length <= 256;
  if (!valid) fail(EffectAuthorityErrorCode.INPUT_INVALID, 'A bounded execution owner is required');
  return value;
}

function storageFailure(operation, error) {
  fail(
    EffectAuthorityErrorCode.STORAGE_FAILURE,
    `Effect authority storage failed during ${operation}`,
    { cause: error?.message || String(error), sqliteCode: error?.code || null },
  );
}

function normalizeRequestForStoredComparison(request, grantId) {
  if (request.approvalGrantId !== grantId) {
    fail(
      EffectAuthorityErrorCode.GRANT_SCOPE_MISMATCH,
      'Effect request must name the grant being consumed',
      { expectedGrantId: grantId, actualGrantId: request.approvalGrantId },
    );
  }
  return { ...request, approvalGrantId: null };
}

function grantFromRow(row) {
  if (!row) return null;
  try {
    const original = JSON.parse(row.grant_json);
    const grant = {
      ...original,
      consumedAt: row.consumed_at_ms === null ? null : isoFromMs(row.consumed_at_ms),
      consumedByEffectId: row.consumed_by_effect_id,
      revokedAt: row.revoked_at_ms === null ? null : isoFromMs(row.revoked_at_ms),
      revocationReason: row.revocation_reason,
    };
    const validation = validateApprovalGrant(grant);
    const indexedIdentityMatches = grant.grantId === row.grant_id
      && grant.scope?.effectId === row.effect_id
      && grant.scope?.runId === row.run_id
      && grant.scope?.projectId === row.project_id
      && grant.scope?.kind === row.kind
      && grant.scope?.payloadDigest === row.payload_digest
      && grant.scope?.payloadBytes === row.payload_bytes
      && grant.scope?.workspaceRevision === row.workspace_revision
      && grant.nonce === row.nonce;
    if (!validation.valid || !indexedIdentityMatches) {
      throw new Error(`stored ApprovalGrant is invalid: ${validation.errors.join(',')}`);
    }
    return Object.freeze(grant);
  } catch (error) {
    storageFailure('grant read', error);
  }
}

export class EffectAuthorityRepository {
  constructor(db, { clock = Date.now } = {}) {
    this.db = requireDatabase(db);
    this.clock = requireClock(clock);
  }

  #now() {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 0) {
      fail(EffectAuthorityErrorCode.INPUT_INVALID, 'Authority clock returned an invalid timestamp');
    }
    return value;
  }

  registerEffectRequest(requestValue) {
    const request = requireValid(requestValue, validateEffectRequest, 'EffectRequest');
    if (request.approvalGrantId !== null) {
      fail(
        EffectAuthorityErrorCode.INPUT_INVALID,
        'A new EffectRequest cannot carry a pre-bound ApprovalGrant',
      );
    }
    const encoded = canonicalStringify(request);
    const requestDigest = computeEffectRequestDigest(request);
    try {
      this.db.prepare(`
        INSERT INTO m2_effect_requests (
          effect_id, run_id, project_id, kind, payload_digest, payload_bytes,
          request_digest, workspace_revision, idempotency_key, request_json, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        request.effectId,
        request.runId,
        request.origin.projectId,
        request.kind,
        request.payloadDigest,
        request.payloadBytes,
        requestDigest,
        request.workspaceRevision,
        request.idempotencyKey,
        encoded,
        requireTimestamp(request.createdAt, 'EffectRequest.createdAt'),
      );
      return Object.freeze({ created: true, request: Object.freeze({ ...request }) });
    } catch (error) {
      const existing = this.db.prepare(`
        SELECT request_json FROM m2_effect_requests
        WHERE effect_id = ? OR (run_id = ? AND idempotency_key = ?)
        ORDER BY CASE WHEN effect_id = ? THEN 0 ELSE 1 END
        LIMIT 1
      `).get(request.effectId, request.runId, request.idempotencyKey, request.effectId);
      if (existing?.request_json === encoded) {
        return Object.freeze({ created: false, request: Object.freeze({ ...request }) });
      }
      if (!existing) storageFailure('request registration', error);
      fail(
        EffectAuthorityErrorCode.REQUEST_CONFLICT,
        'Effect request identity is already bound to different bytes',
        { effectId: request.effectId, cause: error.message },
      );
    }
  }

  getEffectRequest(effectId) {
    const row = this.db.prepare(`
      SELECT request.*, grant.grant_id
      FROM m2_effect_requests request
      LEFT JOIN m2_approval_grants grant ON grant.effect_id = request.effect_id
      WHERE request.effect_id = ?
    `).get(effectId);
    if (!row) return null;
    try {
      const request = JSON.parse(row.request_json);
      const validation = validateEffectRequest(request);
      const indexedIdentityMatches = request.effectId === row.effect_id
        && request.runId === row.run_id
        && request.origin?.projectId === row.project_id
        && request.kind === row.kind
        && request.payloadDigest === row.payload_digest
        && request.payloadBytes === row.payload_bytes
        && computeEffectRequestDigest(request) === row.request_digest
        && request.workspaceRevision === row.workspace_revision
        && request.idempotencyKey === row.idempotency_key;
      if (!validation.valid || request.approvalGrantId !== null || !indexedIdentityMatches) {
        throw new Error(`stored EffectRequest is invalid: ${validation.errors.join(',')}`);
      }
      return Object.freeze({ ...request, approvalGrantId: row.grant_id ?? null });
    } catch (error) {
      storageFailure('request read', error);
    }
  }

  issueApprovalGrant(grantValue) {
    const grant = requireValid(grantValue, validateApprovalGrant, 'ApprovalGrant');
    if (
      grant.consumedAt !== null
      || grant.consumedByEffectId !== null
      || grant.revokedAt !== null
      || grant.revocationReason !== null
    ) {
      fail(EffectAuthorityErrorCode.INPUT_INVALID, 'A new ApprovalGrant must be active');
    }
    const authorityNowMs = this.#now();
    const issuedAtMs = requireTimestamp(grant.issuedAt, 'ApprovalGrant.issuedAt');
    const expiresAtMs = requireTimestamp(grant.expiresAt, 'ApprovalGrant.expiresAt');
    if (issuedAtMs > authorityNowMs) {
      fail(
        EffectAuthorityErrorCode.INPUT_INVALID,
        'ApprovalGrant cannot be issued in the future',
        { issuedAtMs, authorityNowMs },
      );
    }
    if (expiresAtMs <= authorityNowMs) {
      fail(
        EffectAuthorityErrorCode.GRANT_EXPIRED,
        'ApprovalGrant is already expired at issuance',
        { expiresAtMs, authorityNowMs },
      );
    }
    const request = this.getEffectRequest(grant.scope.effectId);
    if (!request) {
      fail(
        EffectAuthorityErrorCode.REQUEST_NOT_FOUND,
        'ApprovalGrant references an unknown EffectRequest',
        { effectId: grant.scope.effectId },
      );
    }
    if (this.getEffectResult(grant.scope.effectId)) {
      fail(
        EffectAuthorityErrorCode.RESULT_CONFLICT,
        'A terminal EffectRequest cannot receive a new ApprovalGrant',
        { effectId: grant.scope.effectId },
      );
    }
    const scopeMatches = request.runId === grant.scope.runId
      && request.origin.projectId === grant.scope.projectId
      && request.effectId === grant.scope.effectId
      && request.kind === grant.scope.kind
      && request.payloadDigest === grant.scope.payloadDigest
      && request.payloadBytes === grant.scope.payloadBytes
      && request.workspaceRevision === grant.scope.workspaceRevision
      && request.actor.type === 'user'
      && request.actor.id === grant.subject.actorId;
    if (!scopeMatches) {
      fail(
        EffectAuthorityErrorCode.GRANT_SCOPE_MISMATCH,
        'ApprovalGrant scope does not exactly match its EffectRequest',
        { effectId: grant.scope.effectId },
      );
    }
    const encoded = canonicalStringify(grant);
    try {
      this.db.prepare(`
        INSERT INTO m2_approval_grants (
          grant_id, effect_id, run_id, project_id, kind, payload_digest, payload_bytes,
          workspace_revision, nonce, grant_json, issued_at_ms, expires_at_ms,
          consumed_at_ms, consumed_by_effect_id, revoked_at_ms, revocation_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
      `).run(
        grant.grantId,
        grant.scope.effectId,
        grant.scope.runId,
        grant.scope.projectId,
        grant.scope.kind,
        grant.scope.payloadDigest,
        grant.scope.payloadBytes,
        grant.scope.workspaceRevision,
        grant.nonce,
        encoded,
        issuedAtMs,
        expiresAtMs,
      );
      return Object.freeze({ created: true, grant: Object.freeze({ ...grant }) });
    } catch (error) {
      const existing = this.db.prepare(`
        SELECT * FROM m2_approval_grants
        WHERE grant_id = ? OR effect_id = ? OR nonce = ?
        ORDER BY CASE WHEN grant_id = ? THEN 0 ELSE 1 END
        LIMIT 1
      `).get(grant.grantId, grant.scope.effectId, grant.nonce, grant.grantId);
      if (
        existing?.grant_json === encoded
        && existing.consumed_at_ms === null
        && existing.revoked_at_ms === null
      ) return Object.freeze({ created: false, grant: grantFromRow(existing) });
      if (!existing) storageFailure('grant issuance', error);
      fail(
        EffectAuthorityErrorCode.GRANT_CONFLICT,
        'Approval grant identity is already bound or the effect already has a grant',
        { grantId: grant.grantId, effectId: grant.scope.effectId, cause: error.message },
      );
    }
  }

  getApprovalGrant(grantId) {
    return grantFromRow(
      this.db.prepare('SELECT * FROM m2_approval_grants WHERE grant_id = ?').get(grantId),
    );
  }

  consumeApprovalGrant({ grantId, request: requestValue, executionOwner: executionOwnerValue }) {
    const request = requireValid(requestValue, validateEffectRequest, 'EffectRequest');
    const executionOwner = requireExecutionOwner(executionOwnerValue);
    const atMs = this.#now();
    const comparable = normalizeRequestForStoredComparison(request, grantId);
    const expectedRequestJson = canonicalStringify(comparable);

    return immediate(this.db, () => {
      const storedRequest = this.db.prepare(`
        SELECT request_json FROM m2_effect_requests WHERE effect_id = ?
      `).get(request.effectId);
      if (!storedRequest) {
        fail(
          EffectAuthorityErrorCode.REQUEST_NOT_FOUND,
          'EffectRequest does not exist',
          { effectId: request.effectId },
        );
      }
      if (storedRequest.request_json !== expectedRequestJson) {
        fail(
          EffectAuthorityErrorCode.GRANT_SCOPE_MISMATCH,
          'Current EffectRequest differs from the approved request',
          { effectId: request.effectId },
        );
      }

      this.#assertGrantConsumable(grantId, request, atMs);

      this.db.prepare(`
        INSERT INTO m2_effect_execution_claims (
          effect_id, grant_id, owner_id, owner_pid, owner_boot_id,
          owner_start_identity, claimed_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        request.effectId,
        grantId,
        executionOwner.ownerId,
        executionOwner.pid,
        executionOwner.bootId,
        executionOwner.startIdentity,
        atMs,
      );

      const update = this.db.prepare(`
        UPDATE m2_approval_grants
        SET consumed_at_ms = ?, consumed_by_effect_id = effect_id
        WHERE grant_id = ?
          AND effect_id = ?
          AND run_id = ?
          AND project_id = ?
          AND kind = ?
          AND payload_digest = ?
          AND payload_bytes = ?
          AND workspace_revision = ?
          AND consumed_at_ms IS NULL
          AND revoked_at_ms IS NULL
          AND issued_at_ms <= ?
          AND expires_at_ms > ?
      `).run(
        atMs,
        grantId,
        request.effectId,
        request.runId,
        request.origin.projectId,
        request.kind,
        request.payloadDigest,
        request.payloadBytes,
        request.workspaceRevision,
        atMs,
        atMs,
      );
      if (update.changes !== 1) this.#failGrantState(grantId, request, atMs);
      return Object.freeze({ consumed: true, grant: this.getApprovalGrant(grantId) });
    });
  }

  #assertGrantConsumable(grantId, request, atMs) {
    const row = this.db.prepare('SELECT * FROM m2_approval_grants WHERE grant_id = ?').get(grantId);
    if (!row) fail(EffectAuthorityErrorCode.GRANT_NOT_FOUND, 'ApprovalGrant does not exist', { grantId });
    if (row.consumed_at_ms !== null) {
      fail(EffectAuthorityErrorCode.GRANT_CONSUMED, 'ApprovalGrant was already consumed', { grantId });
    }
    if (row.revoked_at_ms !== null) {
      fail(EffectAuthorityErrorCode.GRANT_REVOKED, 'ApprovalGrant was revoked', { grantId });
    }
    if (row.issued_at_ms > atMs) {
      fail(
        EffectAuthorityErrorCode.GRANT_NOT_YET_VALID,
        'ApprovalGrant is not valid before its issuance time',
        { grantId },
      );
    }
    if (row.expires_at_ms <= atMs) {
      fail(EffectAuthorityErrorCode.GRANT_EXPIRED, 'ApprovalGrant expired', { grantId });
    }
    const exact = row.effect_id === request.effectId
      && row.run_id === request.runId
      && row.project_id === request.origin.projectId
      && row.kind === request.kind
      && row.payload_digest === request.payloadDigest
      && row.payload_bytes === request.payloadBytes
      && row.workspace_revision === request.workspaceRevision;
    if (!exact) {
      fail(
        EffectAuthorityErrorCode.GRANT_SCOPE_MISMATCH,
        'ApprovalGrant does not match the current EffectRequest',
        { grantId, effectId: request.effectId },
      );
    }
  }

  getExecutionClaim(effectId) {
    const row = this.db.prepare(`
      SELECT effect_id AS effectId, grant_id AS grantId, owner_id AS ownerId,
             owner_pid AS ownerPid, owner_boot_id AS ownerBootId,
             owner_start_identity AS ownerStartIdentity,
             claimed_at_ms AS claimedAtMs
      FROM m2_effect_execution_claims WHERE effect_id = ?
    `).get(effectId);
    return row ? Object.freeze(row) : null;
  }

  #failGrantState(grantId, request, atMs) {
    const row = this.db.prepare('SELECT * FROM m2_approval_grants WHERE grant_id = ?').get(grantId);
    if (!row) fail(EffectAuthorityErrorCode.GRANT_NOT_FOUND, 'ApprovalGrant does not exist', { grantId });
    if (row.consumed_at_ms !== null) {
      fail(EffectAuthorityErrorCode.GRANT_CONSUMED, 'ApprovalGrant was already consumed', { grantId });
    }
    if (row.revoked_at_ms !== null) {
      fail(EffectAuthorityErrorCode.GRANT_REVOKED, 'ApprovalGrant was revoked', { grantId });
    }
    if (row.issued_at_ms > atMs) {
      fail(
        EffectAuthorityErrorCode.GRANT_NOT_YET_VALID,
        'ApprovalGrant is not valid before its issuance time',
        { grantId },
      );
    }
    if (row.expires_at_ms <= atMs) {
      fail(EffectAuthorityErrorCode.GRANT_EXPIRED, 'ApprovalGrant expired', { grantId });
    }
    fail(
      EffectAuthorityErrorCode.GRANT_SCOPE_MISMATCH,
      'ApprovalGrant does not match the current EffectRequest',
      { grantId, effectId: request.effectId },
    );
  }

  revokeApprovalGrant({ grantId, reason }) {
    const atMs = this.#now();
    if (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 1024) {
      fail(EffectAuthorityErrorCode.INPUT_INVALID, 'A bounded revocation reason is required');
    }
    return immediate(this.db, () => {
      const update = this.db.prepare(`
        UPDATE m2_approval_grants
        SET revoked_at_ms = ?, revocation_reason = ?
        WHERE grant_id = ?
          AND consumed_at_ms IS NULL
          AND revoked_at_ms IS NULL
      `).run(atMs, reason, grantId);
      if (update.changes === 1) {
        return Object.freeze({ revoked: true, grant: this.getApprovalGrant(grantId) });
      }
      const row = this.db.prepare('SELECT * FROM m2_approval_grants WHERE grant_id = ?').get(grantId);
      if (!row) fail(EffectAuthorityErrorCode.GRANT_NOT_FOUND, 'ApprovalGrant does not exist', { grantId });
      if (row.consumed_at_ms !== null) {
        fail(EffectAuthorityErrorCode.GRANT_CONSUMED, 'Consumed ApprovalGrant cannot be revoked', { grantId });
      }
      if (row.revoked_at_ms !== null) {
        return Object.freeze({ revoked: false, grant: grantFromRow(row) });
      }
      fail(EffectAuthorityErrorCode.GRANT_CONFLICT, 'ApprovalGrant revocation lost authority race', { grantId });
    });
  }

  revokeRunGrants({ runId, reason }) {
    if (typeof runId !== 'string' || runId.trim().length === 0) {
      fail(EffectAuthorityErrorCode.INPUT_INVALID, 'runId is required');
    }
    const atMs = this.#now();
    if (typeof reason !== 'string' || reason.trim().length === 0 || reason.length > 1024) {
      fail(EffectAuthorityErrorCode.INPUT_INVALID, 'A bounded revocation reason is required');
    }
    return immediate(this.db, () => {
      const active = this.db.prepare(`
        SELECT grant_id FROM m2_approval_grants
        WHERE run_id = ?
          AND consumed_at_ms IS NULL
          AND revoked_at_ms IS NULL
        ORDER BY grant_id
      `).all(runId);
      const update = this.db.prepare(`
        UPDATE m2_approval_grants
        SET revoked_at_ms = ?, revocation_reason = ?
        WHERE grant_id = ? AND consumed_at_ms IS NULL AND revoked_at_ms IS NULL
      `);
      for (const row of active) {
        const result = update.run(atMs, reason, row.grant_id);
        if (result.changes !== 1) {
          fail(EffectAuthorityErrorCode.GRANT_CONFLICT, 'Run revocation lost authority race', {
            grantId: row.grant_id,
          });
        }
      }
      return Object.freeze({ revoked: active.length, grantIds: Object.freeze(active.map(row => row.grant_id)) });
    });
  }

  recordEffectResult(resultValue) {
    const result = requireValid(resultValue, validateEffectResult, 'EffectResult');
    const encoded = canonicalStringify(result);
    const request = this.getEffectRequest(result.effectId);
    if (!request) {
      fail(
        EffectAuthorityErrorCode.REQUEST_NOT_FOUND,
        'EffectResult references an unknown EffectRequest',
        { effectId: result.effectId },
      );
    }
    const requestDigest = computeEffectRequestDigest(request);
    const identityMatches = result.runId === request.runId
      && result.projectId === request.origin.projectId
      && result.requestDigest === requestDigest;
    if (!identityMatches) {
      fail(
        EffectAuthorityErrorCode.RESULT_AUTHORITY_MISSING,
        'EffectResult does not identify its exact EffectRequest authority',
        { effectId: result.effectId },
      );
    }
    if (result.approvalGrantId !== request.approvalGrantId) {
      fail(
        EffectAuthorityErrorCode.RESULT_AUTHORITY_MISSING,
        'EffectResult names a grant that is not bound to its EffectRequest',
        { effectId: result.effectId, grantId: result.approvalGrantId },
      );
    }
    const grant = this.getApprovalGrant(result.approvalGrantId);
    const claim = this.getExecutionClaim(result.effectId);
    if (
      !grant
      || !claim
      || claim.grantId !== result.approvalGrantId
      || grant.scope.effectId !== result.effectId
      || grant.scope.runId !== result.runId
      || grant.scope.projectId !== result.projectId
      || grant.consumedAt === null
      || grant.consumedByEffectId !== result.effectId
      || grant.revokedAt !== null
    ) {
      fail(
        EffectAuthorityErrorCode.RESULT_AUTHORITY_MISSING,
        'EffectResult requires its exact consumed grant and execution claim',
        { effectId: result.effectId, grantId: result.approvalGrantId },
      );
    }
    const startedAtMs = requireTimestamp(result.startedAt, 'EffectResult.startedAt');
    if (startedAtMs < requireTimestamp(request.createdAt, 'EffectRequest.createdAt')) {
      fail(
        EffectAuthorityErrorCode.INPUT_INVALID,
        'EffectResult cannot start before its EffectRequest exists',
        { effectId: result.effectId },
      );
    }
    if (startedAtMs < claim.claimedAtMs) {
      fail(
        EffectAuthorityErrorCode.INPUT_INVALID,
        'EffectResult cannot start before its execution authority was consumed',
        { effectId: result.effectId, claimedAtMs: claim.claimedAtMs },
      );
    }
    try {
      this.db.prepare(`
        INSERT INTO m2_effect_results (
          effect_id, run_id, project_id, request_digest, approval_grant_id,
          terminal_status, result_json, completed_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        result.effectId,
        result.runId,
        result.projectId,
        result.requestDigest,
        result.approvalGrantId,
        result.terminalStatus,
        encoded,
        requireTimestamp(result.completedAt, 'EffectResult.completedAt'),
      );
      return Object.freeze({ created: true, result: Object.freeze({ ...result }) });
    } catch (error) {
      const existing = this.db.prepare(`
        SELECT result_json FROM m2_effect_results WHERE effect_id = ?
      `).get(result.effectId);
      if (existing?.result_json === encoded) {
        return Object.freeze({ created: false, result: Object.freeze({ ...result }) });
      }
      if (!existing) storageFailure('result recording', error);
      fail(
        EffectAuthorityErrorCode.RESULT_CONFLICT,
        'Effect already has a different terminal result',
        { effectId: result.effectId, cause: error.message },
      );
    }
  }

  getEffectResult(effectId) {
    const row = this.db.prepare(`
      SELECT * FROM m2_effect_results WHERE effect_id = ?
    `).get(effectId);
    if (!row) return null;
    try {
      const result = JSON.parse(row.result_json);
      const validation = validateEffectResult(result);
      const indexedIdentityMatches = result.effectId === row.effect_id
        && result.runId === row.run_id
        && result.projectId === row.project_id
        && result.requestDigest === row.request_digest
        && result.approvalGrantId === row.approval_grant_id
        && result.terminalStatus === row.terminal_status;
      if (!validation.valid || !indexedIdentityMatches) {
        throw new Error(`stored EffectResult is invalid: ${validation.errors.join(',')}`);
      }
      return Object.freeze(result);
    } catch (error) {
      storageFailure('result read', error);
    }
  }

  listAuthorityEvents(effectId) {
    return Object.freeze(this.db.prepare(`
      SELECT seq, event_id AS eventId, event_type AS eventType,
             effect_id AS effectId, grant_id AS grantId, run_id AS runId,
             project_id AS projectId, occurred_at_ms AS occurredAtMs,
             details_json AS detailsJson
      FROM m2_effect_authority_events
      WHERE effect_id = ?
      ORDER BY seq
    `).all(effectId).map(row => {
      try {
        return Object.freeze({
          ...row,
          details: Object.freeze(JSON.parse(row.detailsJson)),
        });
      } catch (error) {
        storageFailure('authority event read', error);
      }
    }));
  }
}

export const _testInternals = Object.freeze({ grantFromRow, normalizeRequestForStoredComparison });

export default EffectAuthorityRepository;
