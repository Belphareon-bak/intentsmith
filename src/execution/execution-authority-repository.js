import { createHash } from 'node:crypto';

import {
  canonicalizeM2ExecutionValue,
  computeM2ExecutionValueDigest,
  computeM2ProjectChangeRequestDigest,
  validateM2ProjectChangeRequest,
  validateM2ProjectChangeResult,
  validateM2ProjectChangeResultForRequest,
} from '../../contracts/m2/execution-v1.js';
import { timestampToMs } from '../../contracts/m2/effect-v1.js';
import { registerM2ExecutionSemanticFunctions } from '../db/migrations/2026_08_24_078_m2_execution_authority.js';

export const ExecutionAuthorityErrorCode = Object.freeze({
  INPUT_INVALID: 'EXECUTION_AUTHORITY_INPUT_INVALID',
  REQUEST_NOT_FOUND: 'EXECUTION_REQUEST_NOT_FOUND',
  REQUEST_CONFLICT: 'EXECUTION_REQUEST_CONFLICT',
  CLAIM_BUSY: 'EXECUTION_CLAIM_BUSY',
  CLAIM_LIVENESS_UNKNOWN: 'EXECUTION_CLAIM_LIVENESS_UNKNOWN',
  STALE_FENCE: 'EXECUTION_STALE_FENCE',
  APPROVAL_INCOMPLETE: 'EXECUTION_APPROVAL_INCOMPLETE',
  RESULT_CONFLICT: 'EXECUTION_RESULT_CONFLICT',
  RESULT_AUTHORITY_MISSING: 'EXECUTION_RESULT_AUTHORITY_MISSING',
  STORAGE_FAILURE: 'EXECUTION_AUTHORITY_STORAGE_FAILURE',
});

export class ExecutionAuthorityError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ExecutionAuthorityError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new ExecutionAuthorityError(code, message, details);
}

function immediate(db, callback) {
  const transaction = db.transaction(callback);
  return transaction.immediate ? transaction.immediate() : transaction();
}

function requireDatabase(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    fail(ExecutionAuthorityErrorCode.INPUT_INVALID, 'A better-sqlite3 database is required');
  }
  return db;
}

function requireClock(clock) {
  if (typeof clock !== 'function') {
    fail(ExecutionAuthorityErrorCode.INPUT_INVALID, 'A trusted execution clock is required');
  }
  return clock;
}

function requireValid(value, validator, label) {
  const validation = validator(value);
  if (!validation.valid) {
    fail(
      ExecutionAuthorityErrorCode.INPUT_INVALID,
      `${label} is invalid`,
      { errors: [...validation.errors] },
    );
  }
  return value;
}

function requireTimestamp(value, label) {
  try {
    return timestampToMs(value);
  } catch {
    fail(ExecutionAuthorityErrorCode.INPUT_INVALID, `${label} must be a canonical timestamp`);
  }
}

function requireOwner(value) {
  const valid = value
    && typeof value === 'object'
    && typeof value.ownerId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.ownerId)
    && Number.isSafeInteger(value.pid)
    && value.pid > 0
    && typeof value.bootId === 'string'
    && value.bootId.length >= 1
    && value.bootId.length <= 256
    && typeof value.startIdentity === 'string'
    && value.startIdentity.length >= 1
    && value.startIdentity.length <= 256;
  if (!valid) fail(ExecutionAuthorityErrorCode.INPUT_INVALID, 'A bounded execution owner is required');
  return value;
}

function requireGeneration(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail(ExecutionAuthorityErrorCode.INPUT_INVALID, 'A positive fencing generation is required');
  }
  return value;
}

function sha256Bytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function storageFailure(operation, error) {
  fail(
    ExecutionAuthorityErrorCode.STORAGE_FAILURE,
    `Execution authority storage failed during ${operation}`,
    { cause: error?.message || String(error), sqliteCode: error?.code || null },
  );
}

function freezeRow(row) {
  return row ? Object.freeze(row) : null;
}

function latestLease(db, executionId, generation) {
  const row = db.prepare(`
    SELECT COALESCE(
      (SELECT lease_until_ms FROM m2_execution_claim_renewals
       WHERE execution_id = ? AND generation = ?
       ORDER BY renewal_seq DESC LIMIT 1),
      (SELECT lease_until_ms FROM m2_execution_claims
       WHERE execution_id = ? AND generation = ?)
    ) AS lease_until_ms
  `).get(executionId, generation, executionId, generation);
  return row?.lease_until_ms ?? null;
}

function claimFromRow(db, row) {
  if (!row) return null;
  return Object.freeze({
    executionId: row.execution_id,
    generation: row.generation,
    ownerId: row.owner_id,
    ownerPid: row.owner_pid,
    ownerBootId: row.owner_boot_id,
    ownerStartIdentity: row.owner_start_identity,
    claimedAtMs: row.claimed_at_ms,
    leaseUntilMs: latestLease(db, row.execution_id, row.generation),
  });
}

export class ExecutionAuthorityRepository {
  constructor(db, { clock = Date.now } = {}) {
    this.db = requireDatabase(db);
    this.clock = requireClock(clock);
    registerM2ExecutionSemanticFunctions(this.db);
  }

  #now() {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 0) {
      fail(ExecutionAuthorityErrorCode.INPUT_INVALID, 'Execution clock returned an invalid time');
    }
    return value;
  }

  registerProjectChange(requestValue, { files, git = null } = {}) {
    const request = requireValid(
      requestValue,
      validateM2ProjectChangeRequest,
      'ProjectChangeRequest',
    );
    if (!Array.isArray(files) || files.length !== request.changes.length) {
      fail(
        ExecutionAuthorityErrorCode.INPUT_INVALID,
        'Durable before/after bytes are required for every declared change',
      );
    }
    const encoded = canonicalizeM2ExecutionValue(request);
    const requestDigest = computeM2ProjectChangeRequestDigest(request);
    if (request.gitCommit === null) {
      if (git !== null) {
        fail(ExecutionAuthorityErrorCode.INPUT_INVALID, 'Git material is unexpected for this request');
      }
    } else if (
      !git
      || typeof git.message !== 'string'
      || !git.identity
      || computeM2ExecutionValueDigest(git.message) !== request.gitCommit.messageDigest
      || computeM2ExecutionValueDigest(git.identity) !== request.gitCommit.identityDigest
    ) {
      fail(ExecutionAuthorityErrorCode.INPUT_INVALID, 'Exact durable Git material is required');
    }
    const material = files.map((file, ordinal) => {
      const change = request.changes[ordinal];
      if (!file || file.path !== change.path
        || !Buffer.isBuffer(file.beforeBytes) || !Buffer.isBuffer(file.afterBytes)) {
        fail(
          ExecutionAuthorityErrorCode.INPUT_INVALID,
          `Durable file material ${ordinal} does not match its change`,
        );
      }
      if (file.beforeBytes.length !== change.before.bytes
        || file.afterBytes.length !== change.after.bytes
        || (!change.before.exists && file.beforeBytes.length !== 0)
        || (change.before.exists && sha256Bytes(file.beforeBytes) !== change.before.digest)
        || sha256Bytes(file.afterBytes) !== change.after.digest) {
        fail(
          ExecutionAuthorityErrorCode.INPUT_INVALID,
          `Durable file material ${ordinal} has a digest or byte-count mismatch`,
        );
      }
      return Object.freeze({ change, ordinal, beforeBytes: file.beforeBytes, afterBytes: file.afterBytes });
    });

    try {
      return immediate(this.db, () => {
        const existing = this.db.prepare(`
          SELECT request_json FROM m2_execution_requests WHERE execution_id = ?
        `).get(request.executionId);
        if (existing) {
          if (existing.request_json !== encoded) {
            fail(
              ExecutionAuthorityErrorCode.REQUEST_CONFLICT,
              'Execution identity is already bound to different request bytes',
              { executionId: request.executionId },
            );
          }
          const storedFiles = this.db.prepare(`
            SELECT relative_path, before_bytes, after_bytes FROM m2_execution_files
            WHERE execution_id = ? ORDER BY ordinal
          `).all(request.executionId);
          const exact = storedFiles.length === material.length
            && storedFiles.every((row, index) => (
              row.relative_path === material[index].change.path
              && Buffer.compare(row.before_bytes, material[index].beforeBytes) === 0
              && Buffer.compare(row.after_bytes, material[index].afterBytes) === 0
            ));
          if (!exact) {
            fail(
              ExecutionAuthorityErrorCode.REQUEST_CONFLICT,
              'Execution identity has different durable file material',
              { executionId: request.executionId },
            );
          }
          const storedGit = this.db.prepare(`
            SELECT message, identity_json FROM m2_execution_git_material
            WHERE execution_id = ?
          `).get(request.executionId);
          const gitExact = request.gitCommit === null
            ? storedGit === undefined
            : storedGit?.message === git.message
              && storedGit.identity_json === canonicalizeM2ExecutionValue(git.identity);
          if (!gitExact) {
            fail(
              ExecutionAuthorityErrorCode.REQUEST_CONFLICT,
              'Execution identity has different durable Git material',
              { executionId: request.executionId },
            );
          }
          return Object.freeze({ created: false, request: Object.freeze(request) });
        }

        this.db.prepare(`
          INSERT INTO m2_execution_requests (
            execution_id, run_id, project_id, request_digest, workspace_revision,
            authority_set_digest, request_json, created_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          request.executionId,
          request.runId,
          request.project.projectId,
          requestDigest,
          request.project.workspaceRevision,
          request.authoritySetDigest,
          encoded,
          requireTimestamp(request.createdAt, 'ProjectChangeRequest.createdAt'),
        );

        if (request.gitCommit !== null) {
          this.db.prepare(`
            INSERT INTO m2_execution_git_material (execution_id, message, identity_json)
            VALUES (?, ?, ?)
          `).run(
            request.executionId,
            git.message,
            canonicalizeM2ExecutionValue(git.identity),
          );
        }

        const insertFile = this.db.prepare(`
          INSERT INTO m2_execution_files (
            execution_id, ordinal, relative_path,
            before_exists, before_digest, before_bytes, before_byte_count, before_mode,
            after_digest, after_bytes, after_byte_count, after_mode,
            forward_effect_id, rollback_effect_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const insertStep = this.db.prepare(`
          INSERT INTO m2_execution_steps (execution_id, role, ordinal, effect_id, request_digest)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const { change, ordinal, beforeBytes, afterBytes } of material) {
          insertFile.run(
            request.executionId,
            ordinal,
            change.path,
            change.before.exists ? 1 : 0,
            change.before.digest,
            beforeBytes,
            change.before.bytes,
            change.before.mode,
            change.after.digest,
            afterBytes,
            change.after.bytes,
            change.after.mode,
            change.forwardAuthority.effectId,
            change.rollbackAuthority.effectId,
          );
          insertStep.run(
            request.executionId, 'forward', ordinal,
            change.forwardAuthority.effectId, change.forwardAuthority.requestDigest,
          );
          insertStep.run(
            request.executionId, 'rollback', ordinal,
            change.rollbackAuthority.effectId, change.rollbackAuthority.requestDigest,
          );
        }
        insertStep.run(
          request.executionId, 'focused_test', 0,
          request.focusedTest.authority.effectId, request.focusedTest.authority.requestDigest,
        );
        if (request.gitCommit !== null) {
          insertStep.run(
            request.executionId, 'git_commit', 0,
            request.gitCommit.authority.effectId, request.gitCommit.authority.requestDigest,
          );
        }
        return Object.freeze({ created: true, request: Object.freeze(request) });
      });
    } catch (error) {
      if (error instanceof ExecutionAuthorityError) throw error;
      storageFailure('request registration', error);
    }
  }

  getProjectChangeRequest(executionId) {
    const row = this.db.prepare(`
      SELECT * FROM m2_execution_requests WHERE execution_id = ?
    `).get(executionId);
    if (!row) return null;
    try {
      const request = JSON.parse(row.request_json);
      const validation = validateM2ProjectChangeRequest(request);
      const exact = validation.valid
        && request.executionId === row.execution_id
        && request.runId === row.run_id
        && request.project.projectId === row.project_id
        && request.project.workspaceRevision === row.workspace_revision
        && request.authoritySetDigest === row.authority_set_digest
        && computeM2ProjectChangeRequestDigest(request) === row.request_digest;
      if (!exact) throw new Error(`stored request invalid: ${validation.errors.join(',')}`);
      return Object.freeze(request);
    } catch (error) {
      storageFailure('request read', error);
    }
  }

  getFileMaterial(executionId) {
    return Object.freeze(this.db.prepare(`
      SELECT ordinal, relative_path AS path, before_exists AS beforeExists,
             before_digest AS beforeDigest, before_bytes AS beforeBytes,
             before_mode AS beforeMode, after_digest AS afterDigest,
             after_bytes AS afterBytes, after_mode AS afterMode,
             forward_effect_id AS forwardEffectId, rollback_effect_id AS rollbackEffectId
      FROM m2_execution_files WHERE execution_id = ? ORDER BY ordinal
    `).all(executionId).map(row => Object.freeze(row)));
  }

  getSteps(executionId) {
    return Object.freeze(this.db.prepare(`
      SELECT role, ordinal, effect_id AS effectId, request_digest AS requestDigest
      FROM m2_execution_steps WHERE execution_id = ? ORDER BY role, ordinal
    `).all(executionId).map(row => Object.freeze(row)));
  }

  getGitMaterial(executionId) {
    const row = this.db.prepare(`
      SELECT message, identity_json AS identityJson
      FROM m2_execution_git_material WHERE execution_id = ?
    `).get(executionId);
    if (!row) return null;
    try {
      return Object.freeze({ message: row.message, identity: Object.freeze(JSON.parse(row.identityJson)) });
    } catch (error) {
      storageFailure('Git material read', error);
    }
  }

  getLatestClaim(executionId) {
    return claimFromRow(this.db, this.db.prepare(`
      SELECT * FROM m2_execution_claims WHERE execution_id = ?
      ORDER BY generation DESC LIMIT 1
    `).get(executionId));
  }

  acquireClaim({ executionId, owner: ownerValue, leaseMs = 30_000, liveness }) {
    const owner = requireOwner(ownerValue);
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 300_000) {
      fail(ExecutionAuthorityErrorCode.INPUT_INVALID, 'leaseMs must be between 1000 and 300000');
    }
    if (!liveness || typeof liveness.isProvablyDead !== 'function') {
      fail(ExecutionAuthorityErrorCode.INPUT_INVALID, 'A fail-closed liveness provider is required');
    }
    const atMs = this.#now();
    return immediate(this.db, () => {
      if (!this.getProjectChangeRequest(executionId)) {
        fail(
          ExecutionAuthorityErrorCode.REQUEST_NOT_FOUND,
          'ProjectChangeRequest does not exist',
          { executionId },
        );
      }
      const latest = this.getLatestClaim(executionId);
      if (latest) {
        if (latest.leaseUntilMs > atMs) {
          fail(
            ExecutionAuthorityErrorCode.CLAIM_BUSY,
            'Execution has a live lease',
            { executionId, generation: latest.generation, leaseUntilMs: latest.leaseUntilMs },
          );
        }
        if (!liveness.isProvablyDead(latest)) {
          fail(
            ExecutionAuthorityErrorCode.CLAIM_LIVENESS_UNKNOWN,
            'Expired owner is not provably dead',
            { executionId, generation: latest.generation },
          );
        }
      }
      const generation = (latest?.generation ?? 0) + 1;
      this.db.prepare(`
        INSERT INTO m2_execution_claims (
          execution_id, generation, owner_id, owner_pid, owner_boot_id,
          owner_start_identity, claimed_at_ms, lease_until_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        executionId,
        generation,
        owner.ownerId,
        owner.pid,
        owner.bootId,
        owner.startIdentity,
        atMs,
        atMs + leaseMs,
      );
      return this.getLatestClaim(executionId);
    });
  }

  renewClaim({ executionId, generation: generationValue, ownerId, leaseMs = 30_000 }) {
    const generation = requireGeneration(generationValue);
    if (typeof ownerId !== 'string' || !Number.isSafeInteger(leaseMs)
      || leaseMs < 1_000 || leaseMs > 300_000) {
      fail(ExecutionAuthorityErrorCode.INPUT_INVALID, 'Invalid claim renewal');
    }
    const atMs = this.#now();
    return immediate(this.db, () => {
      const claim = this.getLatestClaim(executionId);
      if (!claim || claim.generation !== generation || claim.ownerId !== ownerId) {
        fail(ExecutionAuthorityErrorCode.STALE_FENCE, 'Claim renewal has stale authority');
      }
      if (claim.leaseUntilMs <= atMs) {
        fail(ExecutionAuthorityErrorCode.STALE_FENCE, 'An expired claim cannot renew itself');
      }
      const row = this.db.prepare(`
        SELECT COALESCE(max(renewal_seq), 0) + 1 AS next_seq
        FROM m2_execution_claim_renewals WHERE execution_id = ? AND generation = ?
      `).get(executionId, generation);
      this.db.prepare(`
        INSERT INTO m2_execution_claim_renewals (
          execution_id, generation, renewal_seq, renewed_at_ms, lease_until_ms
        ) VALUES (?, ?, ?, ?, ?)
      `).run(executionId, generation, row.next_seq, atMs, atMs + leaseMs);
      return this.getLatestClaim(executionId);
    });
  }

  recordApprovalSet({ executionId, generation: generationValue, grantIds }) {
    const generation = requireGeneration(generationValue);
    if (!Array.isArray(grantIds) || grantIds.length === 0
      || grantIds.some(value => typeof value !== 'string')
      || new Set(grantIds).size !== grantIds.length) {
      fail(ExecutionAuthorityErrorCode.INPUT_INVALID, 'A unique complete grant ID set is required');
    }
    const sorted = [...grantIds].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    if (sorted.some((value, index) => value !== grantIds[index])) {
      fail(ExecutionAuthorityErrorCode.INPUT_INVALID, 'Grant IDs must be bytewise sorted');
    }
    const request = this.getProjectChangeRequest(executionId);
    if (!request) fail(ExecutionAuthorityErrorCode.REQUEST_NOT_FOUND, 'Execution request does not exist');
    const atMs = this.#now();
    try {
      this.db.prepare(`
        INSERT INTO m2_execution_approval_sets (
          execution_id, generation, authority_set_digest, grant_ids_json, consumed_at_ms
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        executionId,
        generation,
        request.authoritySetDigest,
        canonicalizeM2ExecutionValue(grantIds),
        atMs,
      );
      return Object.freeze({ created: true, executionId, generation, grantIds: Object.freeze([...grantIds]) });
    } catch (error) {
      const existing = this.db.prepare(`
        SELECT * FROM m2_execution_approval_sets WHERE execution_id = ? AND generation = ?
      `).get(executionId, generation);
      if (existing
        && existing.generation === generation
        && existing.grant_ids_json === canonicalizeM2ExecutionValue(grantIds)) {
        return Object.freeze({ created: false, executionId, generation, grantIds: Object.freeze([...grantIds]) });
      }
      if (String(error?.message).includes('M2_EXECUTION_APPROVAL_SET_INCOMPLETE')) {
        fail(
          ExecutionAuthorityErrorCode.APPROVAL_INCOMPLETE,
          'The complete exact authority set has not been consumed',
          { executionId, generation },
        );
      }
      storageFailure('approval-set recording', error);
    }
  }

  getLatestApprovalSet(executionId) {
    const row = this.db.prepare(`
      SELECT execution_id AS executionId, generation,
             authority_set_digest AS authoritySetDigest,
             grant_ids_json AS grantIdsJson, consumed_at_ms AS consumedAtMs
      FROM m2_execution_approval_sets WHERE execution_id = ?
      ORDER BY generation DESC LIMIT 1
    `).get(executionId);
    if (!row) return null;
    try {
      return Object.freeze({
        ...row,
        grantIds: Object.freeze(JSON.parse(row.grantIdsJson)),
      });
    } catch (error) {
      storageFailure('approval-set read', error);
    }
  }

  getConsumedApprovalSet(executionId) {
    const rows = this.db.prepare(`
      SELECT step.effect_id AS effectId,
             claim.grant_id AS grantId,
             grant.effect_id AS grantEffectId,
             grant.consumed_at_ms AS consumedAtMs,
             grant.consumed_by_effect_id AS consumedByEffectId,
             grant.revoked_at_ms AS revokedAtMs
      FROM m2_execution_steps step
      LEFT JOIN m2_effect_execution_claims claim ON claim.effect_id = step.effect_id
      LEFT JOIN m2_approval_grants grant ON grant.grant_id = claim.grant_id
      WHERE step.execution_id = ?
      ORDER BY step.role, step.ordinal
    `).all(executionId);
    if (rows.length === 0) {
      fail(ExecutionAuthorityErrorCode.REQUEST_NOT_FOUND, 'Execution steps do not exist');
    }
    const claimed = rows.filter(row => row.grantId !== null);
    if (claimed.length === 0) {
      return Object.freeze({ status: 'none', grantIds: Object.freeze([]) });
    }
    const complete = claimed.length === rows.length
      && rows.every(row => row.grantId
        && row.grantEffectId === row.effectId
        && row.consumedAtMs !== null
        && row.consumedByEffectId === row.effectId
        && row.revokedAtMs === null)
      && new Set(rows.map(row => row.grantId)).size === rows.length;
    const grantIds = claimed.map(row => row.grantId)
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
    return Object.freeze({
      status: complete ? 'complete' : 'partial',
      grantIds: Object.freeze(grantIds),
    });
  }

  appendEvent({ eventId, executionId, generation: generationValue, phase, type, path = null, effectId = null, details = {} }) {
    const generation = requireGeneration(generationValue);
    if (typeof eventId !== 'string' || typeof phase !== 'string' || typeof type !== 'string') {
      fail(ExecutionAuthorityErrorCode.INPUT_INVALID, 'A bounded execution event is required');
    }
    const occurredAtMs = this.#now();
    try {
      this.db.prepare(`
        INSERT INTO m2_execution_events (
          event_id, execution_id, generation, phase, event_type,
          relative_path, effect_id, occurred_at_ms, details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        eventId,
        executionId,
        generation,
        phase,
        type,
        path,
        effectId,
        occurredAtMs,
        canonicalizeM2ExecutionValue(details),
      );
      return Object.freeze({ created: true, eventId, occurredAtMs });
    } catch (error) {
      const existing = this.db.prepare(`
        SELECT event_id FROM m2_execution_events WHERE event_id = ?
      `).get(eventId);
      if (existing) return Object.freeze({ created: false, eventId, occurredAtMs: null });
      if (String(error?.message).includes('M2_EXECUTION_EVENT_STALE_FENCE')) {
        fail(ExecutionAuthorityErrorCode.STALE_FENCE, 'Execution event has stale fencing authority');
      }
      storageFailure('event append', error);
    }
  }

  recordProcess({ executionId, generation: generationValue, effectId, supervisorPid, processGroupId, ownerBootId, ownerStartIdentity }) {
    const generation = requireGeneration(generationValue);
    const startedAtMs = this.#now();
    try {
      this.db.prepare(`
        INSERT INTO m2_execution_processes (
          execution_id, generation, effect_id, supervisor_pid, process_group_id,
          owner_boot_id, owner_start_identity, started_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        executionId,
        generation,
        effectId,
        supervisorPid,
        processGroupId,
        ownerBootId,
        ownerStartIdentity,
        startedAtMs,
      );
      return Object.freeze({ created: true, effectId, startedAtMs });
    } catch (error) {
      storageFailure('process recording', error);
    }
  }

  recordResult(resultValue) {
    const result = requireValid(resultValue, validateM2ProjectChangeResult, 'ProjectChangeResult');
    const request = this.getProjectChangeRequest(result.executionId);
    if (!request) {
      fail(ExecutionAuthorityErrorCode.REQUEST_NOT_FOUND, 'Execution request does not exist');
    }
    const semantic = validateM2ProjectChangeResultForRequest(request, result);
    if (!semantic.valid) {
      fail(
        ExecutionAuthorityErrorCode.RESULT_AUTHORITY_MISSING,
        'Result does not prove its exact project-change request',
        { errors: [...semantic.errors] },
      );
    }
    const encoded = canonicalizeM2ExecutionValue(result);
    try {
      this.db.prepare(`
        INSERT INTO m2_execution_results (
          execution_id, request_digest, run_id, project_id, generation,
          terminal_status, result_json, completed_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        result.executionId,
        result.requestDigest,
        result.runId,
        result.projectId,
        result.fencingGeneration,
        result.terminalStatus,
        encoded,
        requireTimestamp(result.completedAt, 'ProjectChangeResult.completedAt'),
      );
      return Object.freeze({ created: true, result: Object.freeze(result) });
    } catch (error) {
      const existing = this.db.prepare(`
        SELECT result_json FROM m2_execution_results WHERE execution_id = ?
      `).get(result.executionId);
      if (existing?.result_json === encoded) {
        return Object.freeze({ created: false, result: Object.freeze(result) });
      }
      if (String(error?.message).includes('M2_EXECUTION_RESULT_AUTHORITY_MISSING')) {
        fail(
          ExecutionAuthorityErrorCode.RESULT_AUTHORITY_MISSING,
          'SQL terminal truth rejected the execution result',
          { executionId: result.executionId },
        );
      }
      if (existing) {
        fail(
          ExecutionAuthorityErrorCode.RESULT_CONFLICT,
          'Execution already has a different terminal result',
          { executionId: result.executionId },
        );
      }
      storageFailure('result recording', error);
    }
  }

  getResult(executionId) {
    const row = this.db.prepare(`
      SELECT result_json FROM m2_execution_results WHERE execution_id = ?
    `).get(executionId);
    if (!row) return null;
    try {
      const result = JSON.parse(row.result_json);
      const request = this.getProjectChangeRequest(executionId);
      const validation = request
        ? validateM2ProjectChangeResultForRequest(request, result)
        : validateM2ProjectChangeResult(result);
      if (!validation.valid) throw new Error(`stored result invalid: ${validation.errors.join(',')}`);
      return Object.freeze(result);
    } catch (error) {
      storageFailure('result read', error);
    }
  }

  listEvents(executionId) {
    return Object.freeze(this.db.prepare(`
      SELECT seq, event_id AS eventId, generation, phase, event_type AS type,
             relative_path AS path, effect_id AS effectId,
             occurred_at_ms AS occurredAtMs, details_json AS detailsJson
      FROM m2_execution_events WHERE execution_id = ? ORDER BY seq
    `).all(executionId).map(row => {
      try {
        return Object.freeze({ ...row, details: Object.freeze(JSON.parse(row.detailsJson)) });
      } catch (error) {
        storageFailure('event read', error);
      }
    }));
  }
}

export const _testInternals = Object.freeze({ claimFromRow, latestLease, sha256Bytes });

export default ExecutionAuthorityRepository;
