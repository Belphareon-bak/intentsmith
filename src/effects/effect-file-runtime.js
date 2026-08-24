import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import {
  M2_EFFECT_CONTRACT_KIND,
  computeEffectRequestDigest,
} from '../../contracts/m2/effect-v1.js';
import { db, projects } from '../db/database.js';
import { EffectAuthorityRepository } from './effect-authority-repository.js';
import { createApprovalGrantIssuer } from './approval-grant-issuer.js';
import { createEffectBroker } from './effect-broker.js';
import {
  processExecutionLiveness,
  processExecutionOwner,
} from './execution-owner.js';

function stableIdentifier(prefix, value) {
  const digest = createHash('sha256').update(String(value), 'utf8').digest('hex');
  return `${prefix}:${digest}`;
}

function payloadDigest(payload) {
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

async function observeRegisteredWorkspace({ projectId, projectRoot, signal }) {
  const canonicalRoot = await realpath(projectRoot);
  // ProjectContext owns the shared revision algorithm. This dynamic import
  // keeps the Effect contract independently testable while still making the
  // production runtime fail closed until that provider is installed.
  const { observeWorkspaceRevision } = await import('../code-intel/project-context-provider.js');
  return observeWorkspaceRevision(
    { projectId, canonicalRoot },
    { signal },
    { projects },
  );
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    const error = new TypeError(`${label} is required and must be bounded`);
    error.code = 'EFFECT_RUNTIME_INPUT_INVALID';
    throw error;
  }
  return value;
}

function requireActorIdentifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    const error = new TypeError('subjectId must be a canonical actor identifier');
    error.code = 'EFFECT_RUNTIME_INPUT_INVALID';
    throw error;
  }
  return value;
}

export function createEffectFileRuntime({
  database = db,
  clock = Date.now,
  workspaceAuthority = { observe: observeRegisteredWorkspace },
  broker: brokerOverride = null,
  issuer: issuerOverride = null,
  executionOwner = processExecutionOwner,
  executionLiveness = processExecutionLiveness,
} = {}) {
  const repository = new EffectAuthorityRepository(database, { clock });
  const broker = brokerOverride || createEffectBroker(repository, {
    clock,
    workspaceAuthority,
    executionOwner,
  });
  const issuer = issuerOverride || createApprovalGrantIssuer(repository, { clock });
  const activeEffects = new Set();

  function removeTerminalPending(effectId) {
    const result = repository.getEffectResult(effectId);
    if (!result) return null;
    // The result is the durable authority truth. Cleanup is deliberately
    // retryable: a crash or transient DELETE failure after result commit must
    // never make that terminal unreachable on the next approval/reconnect.
    try {
      database.prepare('DELETE FROM m2_pending_effect_payloads WHERE effect_id = ?').run(effectId);
    } catch { /* retried at runtime startup and on the next exact request */ }
    return result;
  }

  function reconcileTerminalPendingEffects() {
    const rows = database.prepare(`
      SELECT pending.effect_id AS effectId
      FROM m2_pending_effect_payloads pending
      JOIN m2_effect_results result ON result.effect_id = pending.effect_id
      ORDER BY pending.effect_id
    `).all();
    for (const { effectId } of rows) removeTerminalPending(effectId);
    return rows.length;
  }

  function recoverConsumedEffect(effectId) {
    const request = repository.getEffectRequest(effectId);
    if (!request?.approvalGrantId) return null;
    const terminal = removeTerminalPending(effectId);
    if (terminal) return terminal;
    const grant = repository.getApprovalGrant(request.approvalGrantId);
    if (!grant?.consumedAt || grant.consumedByEffectId !== effectId) return null;
    const claim = repository.getExecutionClaim(effectId);
    if (!claim || executionLiveness.isProvablyDead(claim) !== true) return null;
    const consumedAtMs = Date.parse(grant.consumedAt);
    const completedAtMs = Math.max(consumedAtMs, clock());
    const result = {
      contract: M2_EFFECT_CONTRACT_KIND.EFFECT_RESULT,
      version: 1,
      effectId,
      runId: request.runId,
      projectId: request.origin.projectId,
      requestDigest: computeEffectRequestDigest(request),
      approvalGrantId: grant.grantId,
      terminalStatus: 'orphaned',
      startedAt: new Date(consumedAtMs).toISOString(),
      completedAt: new Date(completedAtMs).toISOString(),
      process: {
        pid: null,
        processGroupId: null,
        startIdentity: null,
        exitCode: null,
        signal: null,
      },
      changes: {
        paths: [request.target.relativePath],
        beforeDigest: null,
        afterDigest: null,
        diffArtifact: null,
      },
      network: { resolvedAddresses: [], finalUrl: null, status: null, bytes: 0 },
      rollback: {
        required: true,
        status: 'pending',
        evidenceRef: `effect:${effectId}:rollback-pending`,
      },
      outputDigest: null,
      errorCode: 'EFFECT_RECOVERY_ORPHANED',
      evidenceRefs: [`effect:${effectId}:restart-recovery`],
      lateCompletionRejected: true,
    };
    repository.recordEffectResult(result);
    database.prepare('DELETE FROM m2_pending_effect_payloads WHERE effect_id = ?').run(effectId);
    return Object.freeze(result);
  }

  function recoverInterruptedFilesystemEffects() {
    const effectIds = database.prepare(`
      SELECT pending.effect_id AS effectId
      FROM m2_pending_effect_payloads pending
      JOIN m2_approval_grants grant ON grant.effect_id = pending.effect_id
      LEFT JOIN m2_effect_results result ON result.effect_id = pending.effect_id
      WHERE grant.consumed_at_ms IS NOT NULL
        AND result.effect_id IS NULL
      ORDER BY pending.effect_id
    `).all();
    const recovered = [];
    for (const { effectId } of effectIds) {
      if (activeEffects.has(effectId)) continue;
      const result = recoverConsumedEffect(effectId);
      if (result) recovered.push(result);
    }
    return Object.freeze(recovered);
  }

  function storePending({ effectId, sessionId, conversationId, subjectId, projectId, payload }) {
    const request = repository.getEffectRequest(effectId);
    const digest = payloadDigest(payload);
    const insert = database.prepare(`
      INSERT OR IGNORE INTO m2_pending_effect_payloads (
        effect_id, session_id, conversation_id, subject_id, project_id,
        payload, payload_digest, payload_bytes, created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      effectId,
      sessionId,
      conversationId,
      subjectId,
      projectId,
      payload,
      digest,
      payload.length,
      clock(),
    );
    if (insert.changes === 0) {
      const existing = database.prepare(`
        SELECT session_id, conversation_id, subject_id, project_id,
               payload_digest, payload_bytes
        FROM m2_pending_effect_payloads WHERE effect_id = ?
      `).get(effectId);
      const exact = existing?.conversation_id === conversationId
        && existing.subject_id === subjectId
        && existing.project_id === projectId
        && existing.payload_digest === digest
        && existing.payload_bytes === payload.length;
      if (!exact || request?.payloadDigest !== digest || request?.payloadBytes !== payload.length) {
        const error = new Error('Pending effect identity is already bound to different bytes');
        error.code = 'EFFECT_PENDING_CONFLICT';
        throw error;
      }
    }
  }

  const runtime = Object.freeze({
    async requestFilesystemWrite({
      sessionId,
      conversationId,
      subjectId,
      operationId,
      projectId,
      projectRoot,
      relativePath,
      content,
      signal,
    } = {}) {
      requireText(sessionId, 'sessionId');
      requireText(conversationId, 'conversationId');
      requireActorIdentifier(subjectId);
      requireText(operationId, 'operationId');
      if (!Number.isSafeInteger(projectId) || projectId <= 0) {
        const error = new TypeError('projectId must identify a registered project');
        error.code = 'EFFECT_RUNTIME_INPUT_INVALID';
        throw error;
      }
      const payload = Buffer.from(content, 'utf8');
      const runId = stableIdentifier('run', conversationId);
      const idempotencyKey = stableIdentifier(
        'operation',
        operationId,
      );
      const prepared = await broker.prepareFilesystemWrite({
        runId,
        actor: { type: 'user', id: subjectId },
        origin: {
          surface: 'studio',
          // Websocket sessions are authenticated ingress metadata, not durable
          // effect identity. Reconnect retries must reproduce request bytes.
          sessionId: stableIdentifier('session', conversationId),
          conversationId: stableIdentifier('conversation', conversationId),
          projectId,
        },
        projectId,
        projectRoot,
        relativePath,
        content: payload,
        timeoutMs: 120_000,
        idempotencyKey,
        signal,
      });
      if (signal?.aborted) {
        const error = new Error('Filesystem effect preparation was cancelled before pending authority');
        error.code = 'EFFECT_RUNTIME_INPUT_INVALID';
        throw error;
      }
      const terminal = removeTerminalPending(prepared.effectId);
      if (terminal) {
        return Object.freeze({
          ...prepared,
          state: 'terminal',
          result: terminal,
        });
      }
      storePending({
        effectId: prepared.effectId,
        sessionId,
        conversationId,
        subjectId,
        projectId,
        payload,
      });
      return prepared;
    },

    async approveFilesystemWrite({ effectId, conversationId, subjectId, signal } = {}) {
      requireText(effectId, 'effectId');
      requireText(conversationId, 'conversationId');
      requireActorIdentifier(subjectId);
      if (repository.getEffectInvalidation(effectId)) {
        const error = new Error('Filesystem effect was durably invalidated before approval');
        error.code = 'EFFECT_INVALIDATED';
        throw error;
      }
      const pending = database.prepare(`
        SELECT * FROM m2_pending_effect_payloads
        WHERE effect_id = ? AND conversation_id = ? AND subject_id = ?
      `).get(effectId, conversationId, subjectId);
      if (!pending) {
        const request = repository.getEffectRequest(effectId);
        const terminal = repository.getEffectResult(effectId);
        if (
          terminal
          && request?.actor?.type === 'user'
          && request.actor.id === subjectId
          && request.origin?.conversationId === stableIdentifier('conversation', conversationId)
        ) {
          return terminal;
        }
        const error = new Error('No exact pending filesystem effect belongs to this caller');
        error.code = 'EFFECT_PENDING_NOT_FOUND';
        throw error;
      }
      if (activeEffects.has(effectId)) {
        const error = new Error('Filesystem effect execution is already in progress');
        error.code = 'EFFECT_EXECUTION_IN_PROGRESS';
        throw error;
      }
      const terminal = removeTerminalPending(effectId);
      if (terminal) return terminal;
      const recovered = recoverConsumedEffect(effectId);
      if (recovered) return recovered;
      const boundRequest = repository.getEffectRequest(effectId);
      const boundGrant = boundRequest?.approvalGrantId
        ? repository.getApprovalGrant(boundRequest.approvalGrantId)
        : null;
      if (boundGrant?.consumedAt) {
        const error = new Error('Consumed effect execution owner is still live or cannot be disproved');
        error.code = 'EFFECT_EXECUTION_IN_DOUBT';
        throw error;
      }
      const payload = Buffer.from(pending.payload);
      if (payload.length !== pending.payload_bytes || payloadDigest(payload) !== pending.payload_digest) {
        const error = new Error('Pending filesystem payload failed its stored digest');
        error.code = 'EFFECT_PENDING_CORRUPT';
        throw error;
      }
      const subject = { actorType: 'user', actorId: subjectId };
      const grant = issuer.issue({ effectId, authenticatedSubject: subject }).grant;
      activeEffects.add(effectId);
      try {
        const result = await broker.execute({ effectId, grantId: grant.grantId, payload, signal });
        removeTerminalPending(effectId);
        return result;
      } finally {
        activeEffects.delete(effectId);
      }
    },

    getPending(effectId) {
      const row = database.prepare(`
        SELECT effect_id AS effectId, session_id AS sessionId,
               conversation_id AS conversationId, subject_id AS subjectId,
               project_id AS projectId, payload_digest AS payloadDigest,
               payload_bytes AS payloadBytes, created_at_ms AS createdAtMs
        FROM m2_pending_effect_payloads WHERE effect_id = ?
      `).get(effectId);
      return row ? Object.freeze(row) : null;
    },

    recoverInterruptedFilesystemEffects,
    reconcileTerminalPendingEffects,
  });
  // A newly-created runtime is the restart boundary for this SQLite authority.
  // Filesystem providers are synchronous and cannot survive the old process;
  // a consumed grant without a result is therefore terminally ambiguous and
  // must become a durable orphan instead of being replayed.
  reconcileTerminalPendingEffects();
  recoverInterruptedFilesystemEffects();
  return runtime;
}

// Database initialization and migration complete before this module is loaded
// by the write handler or approval intercept.
export const effectFileRuntime = createEffectFileRuntime();

export default effectFileRuntime;
