import { randomBytes, randomUUID } from 'node:crypto';
import {
  M2_EFFECT_CONTRACT_KIND,
  deriveApprovalGrantConstraints,
} from '../../contracts/m2/effect-current.js';

export const ApprovalGrantIssuerErrorCode = Object.freeze({
  INPUT_INVALID: 'APPROVAL_GRANT_ISSUER_INPUT_INVALID',
  REQUEST_NOT_FOUND: 'EFFECT_REQUEST_NOT_FOUND',
  SUBJECT_MISMATCH: 'APPROVAL_GRANT_SUBJECT_MISMATCH',
  REQUEST_TERMINAL: 'EFFECT_REQUEST_TERMINAL',
});

export class ApprovalGrantIssuerError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ApprovalGrantIssuerError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new ApprovalGrantIssuerError(code, message, details);
}

function requireFactory(factory, label) {
  if (typeof factory !== 'function') {
    fail(ApprovalGrantIssuerErrorCode.INPUT_INVALID, `${label} must be a function`);
  }
  return factory;
}

function nowMs(clock) {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(ApprovalGrantIssuerErrorCode.INPUT_INVALID, 'Issuer clock returned an invalid timestamp');
  }
  return value;
}

function requireIdentifier(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
    fail(ApprovalGrantIssuerErrorCode.INPUT_INVALID, `${label} is invalid`);
  }
  return value;
}

/**
 * Create the only component allowed to mint an ApprovalGrant. The caller names
 * an already-stored effect and an authenticated user; every scope and
 * constraint byte is derived from that stored request.
 */
export function createApprovalGrantIssuer(repository, {
  clock = Date.now,
  grantIdFactory = () => `grant:${randomUUID()}`,
  nonceFactory = () => randomBytes(24).toString('hex'),
  defaultTtlMs = 5 * 60 * 1000,
} = {}) {
  if (!repository || typeof repository.getEffectRequest !== 'function'
    || typeof repository.getEffectResult !== 'function'
    || typeof repository.issueApprovalGrant !== 'function') {
    fail(ApprovalGrantIssuerErrorCode.INPUT_INVALID, 'Effect authority repository is required');
  }
  requireFactory(clock, 'clock');
  requireFactory(grantIdFactory, 'grantIdFactory');
  requireFactory(nonceFactory, 'nonceFactory');
  if (!Number.isSafeInteger(defaultTtlMs) || defaultTtlMs < 1) {
    fail(ApprovalGrantIssuerErrorCode.INPUT_INVALID, 'defaultTtlMs must be a positive integer');
  }

  return Object.freeze({
    issue({ effectId, authenticatedSubject, ttlMs = defaultTtlMs } = {}) {
      requireIdentifier(effectId, 'effectId');
      if (
        authenticatedSubject?.actorType !== 'user'
        || typeof authenticatedSubject.actorId !== 'string'
      ) {
        fail(
          ApprovalGrantIssuerErrorCode.SUBJECT_MISMATCH,
          'An authenticated user subject is required',
        );
      }
      if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 86_400_000) {
        fail(ApprovalGrantIssuerErrorCode.INPUT_INVALID, 'ttlMs is outside the allowed range');
      }

      const request = repository.getEffectRequest(effectId);
      if (!request) {
        fail(
          ApprovalGrantIssuerErrorCode.REQUEST_NOT_FOUND,
          'Cannot approve an unknown EffectRequest',
          { effectId },
        );
      }
      if (repository.getEffectResult(effectId)) {
        fail(
          ApprovalGrantIssuerErrorCode.REQUEST_TERMINAL,
          'A terminal EffectRequest cannot be approved again',
          { effectId },
        );
      }
      if (
        request.actor?.type !== 'user'
        || request.actor.id !== authenticatedSubject.actorId
      ) {
        fail(
          ApprovalGrantIssuerErrorCode.SUBJECT_MISMATCH,
          'Authenticated subject does not own this EffectRequest',
          { effectId },
        );
      }
      if (request.approvalGrantId !== null) {
        const existing = repository.getApprovalGrant(request.approvalGrantId);
        if (existing?.subject.actorId !== authenticatedSubject.actorId) {
          fail(
            ApprovalGrantIssuerErrorCode.SUBJECT_MISMATCH,
            'EffectRequest is already bound to a different approval subject',
            { effectId },
          );
        }
        return Object.freeze({ created: false, grant: existing });
      }

      const issuedAtMs = nowMs(clock);
      const expiresAtMs = issuedAtMs + ttlMs;
      if (!Number.isSafeInteger(expiresAtMs)) {
        fail(ApprovalGrantIssuerErrorCode.INPUT_INVALID, 'ApprovalGrant expiry overflow');
      }
      const grant = {
        contract: M2_EFFECT_CONTRACT_KIND.APPROVAL_GRANT,
        version: 1,
        grantId: requireIdentifier(grantIdFactory(request), 'grantId'),
        subject: {
          actorType: 'user',
          actorId: requireIdentifier(authenticatedSubject.actorId, 'authenticatedSubject.actorId'),
        },
        scope: {
          runId: request.runId,
          projectId: request.origin.projectId,
          effectId: request.effectId,
          kind: request.kind,
          payloadDigest: request.payloadDigest,
          payloadBytes: request.payloadBytes,
          workspaceRevision: request.workspaceRevision,
        },
        constraints: deriveApprovalGrantConstraints(request),
        issuedAt: new Date(issuedAtMs).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString(),
        singleUse: true,
        nonce: String(nonceFactory(request)),
        consumedAt: null,
        consumedByEffectId: null,
        revokedAt: null,
        revocationReason: null,
      };
      return repository.issueApprovalGrant(grant);
    },
  });
}

export default createApprovalGrantIssuer;
