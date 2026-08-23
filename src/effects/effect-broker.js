import { createHash } from 'node:crypto';
import {
  M2_EFFECT_CONTRACT_KIND,
  canonicalStringify,
  computeEffectRequestDigest,
  validateEffectResult,
} from '../../contracts/m2/effect-v1.js';
import { resolveProjectTarget } from '../executor/project-path-authority.js';
import { createFilesystemEffectProvider } from './filesystem-effect-provider.js';
import { processExecutionOwner } from './execution-owner.js';

export const EffectBrokerErrorCode = Object.freeze({
  INPUT_INVALID: 'EFFECT_BROKER_INPUT_INVALID',
  REQUEST_NOT_FOUND: 'EFFECT_REQUEST_NOT_FOUND',
  GRANT_NOT_FOUND: 'APPROVAL_GRANT_NOT_FOUND',
  PAYLOAD_MISMATCH: 'EFFECT_PAYLOAD_MISMATCH',
  CONSTRAINT_MISMATCH: 'EFFECT_CONSTRAINT_MISMATCH',
  WORKSPACE_STALE: 'EFFECT_WORKSPACE_STALE',
  PROVIDER_MISSING: 'EFFECT_PROVIDER_MISSING',
  RESULT_UNCOMMITTED: 'EFFECT_RESULT_UNCOMMITTED',
});

export class EffectBrokerError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'EffectBrokerError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new EffectBrokerError(code, message, details);
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function nowMs(clock) {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(EffectBrokerErrorCode.INPUT_INVALID, 'Broker clock returned an invalid timestamp');
  }
  return value;
}

function bytesFromPayload(payload) {
  if (Buffer.isBuffer(payload)) return Buffer.from(payload);
  if (typeof payload === 'string') return Buffer.from(payload, 'utf8');
  if (payload instanceof Uint8Array) return Buffer.from(payload);
  fail(EffectBrokerErrorCode.INPUT_INVALID, 'Effect payload must be exact bytes or a string');
}

function requireRepository(repository) {
  const required = [
    'registerEffectRequest',
    'getEffectRequest',
    'getApprovalGrant',
    'getEffectResult',
    'consumeApprovalGrant',
    'recordEffectResult',
  ];
  if (!repository || required.some(method => typeof repository[method] !== 'function')) {
    fail(EffectBrokerErrorCode.INPUT_INVALID, 'Effect authority repository is required');
  }
  return repository;
}

function requireWorkspaceAuthority(authority) {
  if (!authority || typeof authority.observe !== 'function') {
    fail(EffectBrokerErrorCode.INPUT_INVALID, 'Workspace authority with observe() is required');
  }
  return authority;
}

function stableEffectId(runId, idempotencyKey) {
  const digest = createHash('sha256')
    .update(canonicalStringify({ runId, idempotencyKey }), 'utf8')
    .digest('hex');
  return `effect:${digest}`;
}

function emptyProcess() {
  return { pid: null, processGroupId: null, startIdentity: null, exitCode: null, signal: null };
}

function emptyChanges() {
  return { paths: [], beforeDigest: null, afterDigest: null, diffArtifact: null };
}

function emptyNetwork() {
  return { resolvedAddresses: [], finalUrl: null, status: null, bytes: 0 };
}

function emptyRollback() {
  return { required: false, status: 'not_required', evidenceRef: null };
}

function normalizedErrorCode(error, fallback = 'EFFECT_FAILED') {
  const candidate = typeof error?.code === 'string' ? error.code : fallback;
  const normalized = candidate.toUpperCase().replace(/[^A-Z0-9_:-]/g, '_').slice(0, 64);
  return /^[A-Z]/.test(normalized) ? normalized : fallback;
}

function providerFor(providers, kind) {
  if (providers instanceof Map) return providers.get(kind);
  return providers?.[kind];
}

function verifyGrantConstraints(request, grant, payload) {
  const exactScope = grant.scope.effectId === request.effectId
    && grant.scope.runId === request.runId
    && grant.scope.projectId === request.origin.projectId
    && grant.scope.kind === request.kind
    && grant.scope.payloadDigest === request.payloadDigest
    && grant.scope.payloadBytes === request.payloadBytes
    && grant.scope.workspaceRevision === request.workspaceRevision;
  if (!exactScope || grant.constraints.maxBytes !== payload.length) {
    fail(
      EffectBrokerErrorCode.CONSTRAINT_MISMATCH,
      'ApprovalGrant does not authorize the exact effect payload and scope',
      { effectId: request.effectId, grantId: grant.grantId },
    );
  }

  if (request.kind.startsWith('fs.')) {
    if (
      grant.constraints.allowedRealpaths.length !== 1
      || grant.constraints.allowedRealpaths[0] !== request.target.resolvedRealpath
      || grant.constraints.allowedBinary !== null
      || grant.constraints.allowedArgvDigest !== null
      || grant.constraints.allowedOrigin !== null
    ) {
      fail(EffectBrokerErrorCode.CONSTRAINT_MISMATCH, 'Filesystem grant constraints differ');
    }
  } else if (request.kind === 'process.exec') {
    if (
      grant.constraints.allowedRealpaths.length !== 0
      || grant.constraints.allowedBinary !== request.target.binary
      || grant.constraints.allowedArgvDigest !== request.target.argvDigest
      || grant.constraints.allowedOrigin !== null
    ) fail(EffectBrokerErrorCode.CONSTRAINT_MISMATCH, 'Process grant constraints differ');
  } else if (request.kind === 'network.request') {
    if (
      grant.constraints.allowedRealpaths.length !== 0
      || grant.constraints.allowedBinary !== null
      || grant.constraints.allowedArgvDigest !== null
      || grant.constraints.allowedOrigin !== request.target.origin
    ) fail(EffectBrokerErrorCode.CONSTRAINT_MISMATCH, 'Network grant constraints differ');
  }
}

function cancelScheduled(handle) {
  if (handle && typeof handle.cancel === 'function') handle.cancel();
  else if (handle !== undefined && handle !== null) clearTimeout(handle);
}

function delay(scheduleTimeout, durationMs, value) {
  let handle;
  const promise = new Promise(resolve => {
    handle = scheduleTimeout(() => resolve(value), durationMs);
  });
  return { promise, cancel: () => cancelScheduled(handle) };
}

function cancelledPromise(signal) {
  if (!signal) return { promise: new Promise(() => {}), cancel() {} };
  if (signal.aborted) return { promise: Promise.resolve({ kind: 'cancelled' }), cancel() {} };
  let listener;
  const promise = new Promise(resolve => {
    listener = () => resolve({ kind: 'cancelled' });
    signal.addEventListener('abort', listener, { once: true });
  });
  return {
    promise,
    cancel: () => signal.removeEventListener('abort', listener),
  };
}

function resultFromOutcome({ request, grantId, startedAtMs, completedAtMs, outcome }) {
  const evidence = outcome.evidence || {};
  return {
    contract: M2_EFFECT_CONTRACT_KIND.EFFECT_RESULT,
    version: 1,
    effectId: request.effectId,
    runId: request.runId,
    projectId: request.origin.projectId,
    requestDigest: computeEffectRequestDigest(request),
    approvalGrantId: grantId,
    terminalStatus: outcome.status,
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(Math.max(startedAtMs, completedAtMs)).toISOString(),
    process: evidence.process || emptyProcess(),
    changes: evidence.changes || emptyChanges(),
    network: evidence.network || emptyNetwork(),
    rollback: evidence.rollback || emptyRollback(),
    outputDigest: evidence.outputDigest || null,
    errorCode: outcome.status === 'succeeded' ? null : outcome.errorCode,
    evidenceRefs: [...(evidence.evidenceRefs || [])]
      .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
    lateCompletionRejected: outcome.lateCompletionRejected === true,
  };
}

/**
 * Canonical M2 effect broker. It creates requests from observed workspace state,
 * consumes a single-use grant before invoking a provider, and durably commits
 * the one terminal result before any success is returned to the caller.
 */
export function createEffectBroker(repositoryValue, {
  providers = { 'fs.write': createFilesystemEffectProvider() },
  clock = Date.now,
  scheduleTimeout = (callback, milliseconds) => setTimeout(callback, milliseconds),
  terminationGraceMs = 1_000,
  workspaceAuthority,
  executionOwner = processExecutionOwner,
} = {}) {
  const repository = requireRepository(repositoryValue);
  const authority = requireWorkspaceAuthority(workspaceAuthority);
  if (typeof clock !== 'function' || typeof scheduleTimeout !== 'function') {
    fail(EffectBrokerErrorCode.INPUT_INVALID, 'Broker clock and timeout scheduler are required');
  }
  if (!Number.isSafeInteger(terminationGraceMs) || terminationGraceMs < 0) {
    fail(EffectBrokerErrorCode.INPUT_INVALID, 'terminationGraceMs must be a non-negative integer');
  }

  async function observeExactProject({ projectId, projectRoot, signal }) {
    const observed = await authority.observe({ projectId, projectRoot, signal });
    if (
      !observed
      || typeof observed.canonicalRoot !== 'string'
      || typeof observed.workspaceRevision !== 'string'
      || observed.workspaceRevision.length === 0
    ) {
      fail(EffectBrokerErrorCode.INPUT_INVALID, 'Workspace authority returned an invalid observation');
    }
    return observed;
  }

  async function prepareFilesystemWrite({
    runId,
    actor,
    origin,
    projectId,
    projectRoot,
    relativePath,
    content,
    timeoutMs = 120_000,
    idempotencyKey,
    signal,
  } = {}) {
    if (signal?.aborted) fail(EffectBrokerErrorCode.INPUT_INVALID, 'Effect preparation was cancelled');
    if (origin?.projectId !== projectId) {
      fail(EffectBrokerErrorCode.INPUT_INVALID, 'Origin project identity does not match projectId');
    }
    const payload = bytesFromPayload(content);
    const observed = await observeExactProject({ projectId, projectRoot, signal });
    const target = resolveProjectTarget(observed.canonicalRoot, relativePath);
    if (target.projectRoot !== observed.canonicalRoot) {
      fail(EffectBrokerErrorCode.INPUT_INVALID, 'Workspace canonical root changed during observation');
    }
    const effectId = stableEffectId(runId, idempotencyKey);
    const existing = repository.getEffectRequest(effectId);
    const request = {
      contract: M2_EFFECT_CONTRACT_KIND.EFFECT_REQUEST,
      version: 1,
      effectId,
      runId,
      parentEffectId: null,
      actor,
      origin,
      kind: 'fs.write',
      target: {
        type: 'filesystem',
        canonicalRoot: target.projectRoot,
        relativePath: target.relativePath,
        resolvedRealpath: target.real,
      },
      payloadDigest: sha256(payload),
      payloadBytes: payload.length,
      workspaceRevision: observed.workspaceRevision,
      requiredCapability: 'project.fs.write',
      riskClass: 'write',
      timeoutMs,
      idempotencyKey,
      approvalGrantId: null,
      // Idempotent retry must reproduce the originally committed request
      // bytes. A fresh wall clock would turn an exact retry into a conflict.
      createdAt: existing?.createdAt || new Date(nowMs(clock)).toISOString(),
    };
    repository.registerEffectRequest(request);
    const stored = repository.getEffectRequest(effectId);
    return Object.freeze({
      state: stored.approvalGrantId ? 'approved' : 'approval_required',
      effectId: stored.effectId,
      request: stored,
    });
  }

  async function execute({ effectId, grantId, payload: payloadValue, signal } = {}) {
    const payload = bytesFromPayload(payloadValue);
    const request = repository.getEffectRequest(effectId);
    if (!request) fail(EffectBrokerErrorCode.REQUEST_NOT_FOUND, 'EffectRequest does not exist', { effectId });
    const grant = repository.getApprovalGrant(grantId);
    if (!grant) fail(EffectBrokerErrorCode.GRANT_NOT_FOUND, 'ApprovalGrant does not exist', { grantId });
    if (payload.length !== request.payloadBytes || sha256(payload) !== request.payloadDigest) {
      fail(
        EffectBrokerErrorCode.PAYLOAD_MISMATCH,
        'Execution payload differs from the approved EffectRequest bytes',
        { effectId },
      );
    }
    if (request.kind.startsWith('fs.') && !Buffer.from(payload.toString('utf8'), 'utf8').equals(payload)) {
      fail(EffectBrokerErrorCode.PAYLOAD_MISMATCH, 'Filesystem payload is not canonical UTF-8');
    }
    verifyGrantConstraints(request, grant, payload);
    const existingResult = repository.getEffectResult(effectId);
    if (existingResult) return existingResult;
    if (signal?.aborted) fail(EffectBrokerErrorCode.INPUT_INVALID, 'Effect execution was cancelled before grant consumption');

    const observed = await observeExactProject({
      projectId: request.origin.projectId,
      projectRoot: request.target.canonicalRoot,
      signal,
    });
    if (
      observed.canonicalRoot !== request.target.canonicalRoot
      || observed.workspaceRevision !== request.workspaceRevision
    ) {
      fail(
        EffectBrokerErrorCode.WORKSPACE_STALE,
        'Workspace changed after approval and before effect execution',
        { expected: request.workspaceRevision, observed: observed.workspaceRevision },
      );
    }

    const provider = providerFor(providers, request.kind);
    if (!provider || typeof provider.execute !== 'function') {
      fail(EffectBrokerErrorCode.PROVIDER_MISSING, `No provider is registered for ${request.kind}`);
    }
    const boundRequest = Object.freeze({ ...request, approvalGrantId: grantId });
    repository.consumeApprovalGrant({
      grantId,
      request: boundRequest,
      executionOwner,
    });

    const startedAtMs = nowMs(clock);
    const controller = new AbortController();
    const timeout = delay(scheduleTimeout, request.timeoutMs, { kind: 'timed_out' });
    const cancellation = cancelledPromise(signal);
    const providerPromise = Promise.resolve()
      .then(() => provider.execute({ request: boundRequest, grant, payload, signal: controller.signal }))
      .then(
        evidence => ({ kind: 'provider', ok: true, evidence }),
        error => ({ kind: 'provider', ok: false, error }),
      );

    let first;
    try {
      first = await Promise.race([providerPromise, timeout.promise, cancellation.promise]);
    } finally {
      if (first?.kind === 'provider') {
        timeout.cancel();
        cancellation.cancel();
      }
    }

    let outcome;
    if (first.kind === 'provider') {
      if (first.ok) {
        outcome = { status: 'succeeded', evidence: first.evidence, lateCompletionRejected: false };
      } else if (first.error?.effectApplied === true) {
        outcome = {
          status: 'orphaned',
          errorCode: normalizedErrorCode(first.error),
          evidence: first.error?.evidence,
          lateCompletionRejected: true,
        };
      } else {
        outcome = {
          status: first.error?.code === 'EFFECT_CANCELLED' ? 'cancelled' : 'failed',
          errorCode: normalizedErrorCode(first.error),
          evidence: first.error?.evidence,
          lateCompletionRejected: false,
        };
      }
    } else {
      controller.abort(first.kind);
      timeout.cancel();
      cancellation.cancel();
      const grace = delay(scheduleTimeout, terminationGraceMs, { kind: 'grace_expired' });
      const settled = await Promise.race([providerPromise, grace.promise]);
      grace.cancel();
      if (settled.kind === 'provider') {
        outcome = {
          status: first.kind === 'cancelled' ? 'cancelled' : 'timed_out',
          errorCode: first.kind === 'cancelled' ? 'EFFECT_CANCELLED' : 'EFFECT_TIMED_OUT',
          evidence: settled.ok ? settled.evidence : settled.error?.evidence,
          lateCompletionRejected: true,
        };
      } else {
        outcome = {
          status: 'orphaned',
          errorCode: 'EFFECT_ORPHANED',
          evidence: null,
          lateCompletionRejected: true,
        };
      }
    }

    let result = resultFromOutcome({
      request,
      grantId,
      startedAtMs,
      completedAtMs: nowMs(clock),
      outcome,
    });
    const validation = validateEffectResult(result);
    if (!validation.valid) {
      result = resultFromOutcome({
        request,
        grantId,
        startedAtMs,
        completedAtMs: nowMs(clock),
        outcome: {
          status: 'orphaned',
          errorCode: 'EFFECT_PROVIDER_EVIDENCE_INVALID',
          evidence: null,
          lateCompletionRejected: true,
        },
      });
    }
    try {
      repository.recordEffectResult(result);
    } catch (error) {
      throw new EffectBrokerError(
        EffectBrokerErrorCode.RESULT_UNCOMMITTED,
        'Effect terminal result could not be committed; success is withheld',
        { effectId, terminalStatus: result.terminalStatus, cause: error?.message || String(error) },
      );
    }
    return Object.freeze(result);
  }

  return Object.freeze({ prepareFilesystemWrite, execute });
}

export const _testInternals = Object.freeze({
  bytesFromPayload,
  sha256,
  stableEffectId,
  verifyGrantConstraints,
});

export default createEffectBroker;
