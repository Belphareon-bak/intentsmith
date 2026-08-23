import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { db, projects } from '../db/database.js';
import { EffectAuthorityRepository } from './effect-authority-repository.js';
import { createApprovalGrantIssuer } from './approval-grant-issuer.js';
import { createEffectBroker } from './effect-broker.js';

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
} = {}) {
  const repository = new EffectAuthorityRepository(database, { clock });
  const broker = brokerOverride || createEffectBroker(repository, { clock, workspaceAuthority });
  const issuer = issuerOverride || createApprovalGrantIssuer(repository, { clock });

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
      const exact = existing?.session_id === sessionId
        && existing.conversation_id === conversationId
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

  return Object.freeze({
    async requestFilesystemWrite({
      sessionId,
      conversationId,
      subjectId,
      projectId,
      projectRoot,
      relativePath,
      content,
      signal,
    } = {}) {
      requireText(sessionId, 'sessionId');
      requireText(conversationId, 'conversationId');
      requireActorIdentifier(subjectId);
      if (!Number.isSafeInteger(projectId) || projectId <= 0) {
        const error = new TypeError('projectId must identify a registered project');
        error.code = 'EFFECT_RUNTIME_INPUT_INVALID';
        throw error;
      }
      const payload = Buffer.from(content, 'utf8');
      const runId = stableIdentifier('run', conversationId);
      const idempotencyKey = stableIdentifier(
        'write',
        JSON.stringify({ sessionId, projectId, relativePath, digest: payloadDigest(payload) }),
      );
      const prepared = await broker.prepareFilesystemWrite({
        runId,
        actor: { type: 'user', id: subjectId },
        origin: {
          surface: 'studio',
          sessionId: stableIdentifier('session', sessionId),
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
      if (repository.getEffectResult(prepared.effectId)) {
        const error = new Error('Effect already has an immutable terminal result');
        error.code = 'EFFECT_ALREADY_TERMINAL';
        throw error;
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

    async approveFilesystemWrite({ effectId, sessionId, conversationId, subjectId, signal } = {}) {
      requireText(effectId, 'effectId');
      requireText(sessionId, 'sessionId');
      requireText(conversationId, 'conversationId');
      requireActorIdentifier(subjectId);
      const pending = database.prepare(`
        SELECT * FROM m2_pending_effect_payloads
        WHERE effect_id = ? AND session_id = ? AND conversation_id = ? AND subject_id = ?
      `).get(effectId, sessionId, conversationId, subjectId);
      if (!pending) {
        const error = new Error('No exact pending filesystem effect belongs to this caller');
        error.code = 'EFFECT_PENDING_NOT_FOUND';
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
      const result = await broker.execute({ effectId, grantId: grant.grantId, payload, signal });
      database.prepare('DELETE FROM m2_pending_effect_payloads WHERE effect_id = ?').run(effectId);
      return result;
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
  });
}

// Database initialization and migration complete before this module is loaded
// by the write handler or approval intercept.
export const effectFileRuntime = createEffectFileRuntime();

export default effectFileRuntime;
