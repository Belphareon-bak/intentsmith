import { createM2FileListTarget, createM2FileListPolicyPayload } from '../../contracts/m2/file-list-snapshot-v1.js';
import { isM2FileListOutputRequest, createM2FileListOutputEvidence } from '../../contracts/m2/file-list-output-v1.js';
import { EffectFileListOutputRepository } from './effect-file-list-output-repository.js';
import { createFilesystemListEffectProvider } from './filesystem-list-effect-provider.js';
import { createM2FileReadPolicyPayload, createM2FileReadOutputEvidence } from '../../contracts/m2/file-read-output-v1.js';
import { EffectFileReadOutputRepository } from './effect-file-read-output-repository.js';
import { createHash } from 'node:crypto';
import {
  M2_EFFECT_CONTRACT_KIND,
  canonicalStringify,
  computeEffectRequestDigest,
  validateApprovalGrantForRequest,
  validateEffectResult,
  validateEffectResultForRequest,
} from '../../contracts/m2/effect-current.js';
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
    'getEffectInvalidation',
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

function conservativeRollbackEvidence(request, evidence, reason) {
  const observed = evidence && typeof evidence === 'object' ? evidence : {};
  const fallbackPaths = request.kind.startsWith('fs.')
    ? [request.target.relativePath]
    : [];
  const evidenceRefs = new Set(observed.evidenceRefs || []);
  evidenceRefs.add(`effect:${request.effectId}:${reason}`);
  return {
    ...observed,
    changes: {
      ...emptyChanges(),
      ...(observed.changes || {}),
      paths: observed.changes?.paths?.length
        ? observed.changes.paths
        : fallbackPaths,
    },
    rollback: observed.rollback?.required === true
      ? observed.rollback
      : {
        required: true,
        status: 'pending',
        evidenceRef: `effect:${request.effectId}:rollback-pending`,
      },
    evidenceRefs: [...evidenceRefs],
  };
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
  const authority = validateApprovalGrantForRequest(request, grant);
  if (!authority.valid || grant.constraints.maxBytes !== payload.length) {
    fail(
      EffectBrokerErrorCode.CONSTRAINT_MISMATCH,
      'ApprovalGrant does not authorize the exact effect payload and scope',
      { effectId: request.effectId, grantId: grant.grantId },
    );
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
  providers = { 'fs.write': createFilesystemEffectProvider(), 'fs.read': createFilesystemEffectProvider(), 'project.fs.list': createFilesystemListEffectProvider() },
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

  async function prepareFilesystemEffect({
    kind,
    rootList = false,
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
    if (signal?.aborted) {
      fail(EffectBrokerErrorCode.INPUT_INVALID, 'Effect preparation was cancelled during workspace observation');
    }
    if (rootList && relativePath !== '.') fail(EffectBrokerErrorCode.INPUT_INVALID, 'Root listing requires explicit dot path');
    const target = rootList ? { projectRoot: observed.canonicalRoot, relativePath: '.', real: observed.canonicalRoot }
      : resolveProjectTarget(observed.canonicalRoot, relativePath);
    if (target.projectRoot !== observed.canonicalRoot) {
      fail(EffectBrokerErrorCode.INPUT_INVALID, 'Workspace canonical root changed during observation');
    }
    const effectId = stableEffectId(runId, idempotencyKey);
    const existing = repository.getEffectRequest(effectId);
    const request = {
      contract: M2_EFFECT_CONTRACT_KIND.EFFECT_REQUEST,
      version: rootList ? 2 : 1,
      effectId,
      runId,
      parentEffectId: null,
      actor,
      origin,
      kind,
      target: rootList ? createM2FileListTarget(target.projectRoot) : {
        type: 'filesystem',
        canonicalRoot: target.projectRoot,
        relativePath: target.relativePath,
        resolvedRealpath: target.real,
      },
      payloadDigest: sha256(payload),
      payloadBytes: payload.length,
      workspaceRevision: observed.workspaceRevision,
      requiredCapability: rootList ? 'project.fs.list' : kind === 'fs.read' ? 'project.fs.read' : 'project.fs.write',
      riskClass: kind === 'fs.read' ? 'read' : 'write',
      timeoutMs,
      idempotencyKey,
      approvalGrantId: null,
      // Idempotent retry must reproduce the originally committed request
      // bytes. A fresh wall clock would turn an exact retry into a conflict.
      createdAt: existing?.createdAt || new Date(nowMs(clock)).toISOString(),
    };
    if (signal?.aborted) {
      fail(EffectBrokerErrorCode.INPUT_INVALID, 'Effect preparation was cancelled before request registration');
    }
    repository.registerEffectRequest(request);
    const stored = repository.getEffectRequest(effectId);
    return Object.freeze({
      state: stored.approvalGrantId ? 'approved' : 'approval_required',
      effectId: stored.effectId,
      request: stored,
    });
  }

  function prepareFilesystemWrite(input = {}) {
    return prepareFilesystemEffect({ ...input, kind: 'fs.write' });
  }

  function prepareFilesystemRead(input = {}) {
    return prepareFilesystemEffect({ ...input, kind: 'fs.read', content: createM2FileReadPolicyPayload() });
  }

  function prepareFilesystemListRoot(input = {}) {
    return prepareFilesystemEffect({ ...input, kind: 'fs.read', rootList: true, content: createM2FileListPolicyPayload() });
  }

  async function execute({ effectId, grantId, payload: payloadValue, signal } = {}) {
    const payload = bytesFromPayload(payloadValue);
    const request = repository.getEffectRequest(effectId);
    if (!request) fail(EffectBrokerErrorCode.REQUEST_NOT_FOUND, 'EffectRequest does not exist', { effectId });
    if (repository.getEffectInvalidation(effectId)) {
      fail(EffectBrokerErrorCode.CONSTRAINT_MISMATCH, 'EffectRequest was durably invalidated', {
        effectId,
      });
    }
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

    const boundRequest = Object.freeze({ ...request, approvalGrantId: grantId });
    repository.consumeApprovalGrant({
      grantId,
      request: boundRequest,
      executionOwner,
    });

    const startedAtMs = nowMs(clock);
    const commitOutcome = outcomeValue => {
      const readOnly = boundRequest.kind === 'fs.read';
      const rootList = isM2FileListOutputRequest(boundRequest);
      // Synchronous directory syscalls can outlast the scheduled timer. Never
      // publish listing bytes after the original total execution deadline.
      if (rootList && outcomeValue.status === 'succeeded'
        && nowMs(clock) >= startedAtMs + boundRequest.timeoutMs) {
        outcomeValue = { status: 'timed_out', errorCode: 'EFFECT_TIMED_OUT' };
      }
      if (readOnly && outcomeValue.status !== 'succeeded') {
        // Read cancellation/failure never publishes late bytes and cannot
        // inherit write-style changes, rollback or provider-controlled text.
        outcomeValue = { status: outcomeValue.status, errorCode: outcomeValue.errorCode,
          evidence: { evidenceRefs: [`effect:${effectId}:file-read-${outcomeValue.status}`] },
          lateCompletionRejected: false };
      }
      let result = resultFromOutcome({
        request: boundRequest,
        grantId,
        startedAtMs,
        completedAtMs: nowMs(clock),
        outcome: outcomeValue,
      });
      const validation = validateEffectResultForRequest(boundRequest, result);
      let readEvidenceValid = true;
      if (readOnly && result.terminalStatus === 'succeeded') {
        try {
          if (rootList) createM2FileListOutputEvidence(boundRequest, result, outcomeValue.evidence?.fileListBytes);
          else createM2FileReadOutputEvidence(boundRequest, result, outcomeValue.evidence?.fileReadBytes);
        }
        catch { readEvidenceValid = false; }
      }
      if (!validation.valid || !readEvidenceValid) {
        result = resultFromOutcome({
          request: boundRequest,
          grantId,
          startedAtMs,
          completedAtMs: nowMs(clock),
          outcome: {
            status: readOnly ? 'failed' : 'orphaned',
            errorCode: 'EFFECT_PROVIDER_EVIDENCE_INVALID',
            evidence: readOnly ? { evidenceRefs: [`effect:${effectId}:file-read-evidence-invalid`] } : conservativeRollbackEvidence(
              boundRequest,
              null,
              'provider-evidence-invalid',
            ),
            lateCompletionRejected: !readOnly,
          },
        });
      }
      try {
        if (readOnly && result.terminalStatus === 'succeeded') {
          if (rootList) new EffectFileListOutputRepository(repository).recordSuccessfulFileList({
            request: boundRequest, result, bytes: outcomeValue.evidence.fileListBytes,
          });
          else new EffectFileReadOutputRepository(repository).recordSuccessfulFileRead({
            request: boundRequest, result, bytes: outcomeValue.evidence.fileReadBytes,
          });
        } else repository.recordEffectResult(result);
      } catch (error) {
        throw new EffectBrokerError(
          EffectBrokerErrorCode.RESULT_UNCOMMITTED,
          'Effect terminal result could not be committed; success is withheld',
          { effectId, terminalStatus: result.terminalStatus, cause: error?.message || String(error) },
        );
      }
      return Object.freeze(result);
    };

    const controller = new AbortController();
    const timeout = delay(scheduleTimeout, boundRequest.timeoutMs, { kind: 'timed_out' });
    const cancellation = cancelledPromise(signal);
    const observationPromise = Promise.resolve()
      .then(() => observeExactProject({
        projectId: boundRequest.origin.projectId,
        projectRoot: boundRequest.target.canonicalRoot,
        signal: controller.signal,
      }))
      .then(
        value => ({ kind: 'observation', ok: true, value }),
        error => ({ kind: 'observation', ok: false, error }),
      );
    const observation = await Promise.race([
      observationPromise,
      timeout.promise,
      cancellation.promise,
    ]);
    if (observation.kind !== 'observation') {
      controller.abort(observation.kind);
      timeout.cancel();
      cancellation.cancel();
      return commitOutcome({
        status: observation.kind === 'cancelled' ? 'cancelled' : 'timed_out',
        errorCode: observation.kind === 'cancelled' ? 'EFFECT_CANCELLED' : 'EFFECT_TIMED_OUT',
        evidence: { evidenceRefs: [`effect:${effectId}:workspace-observation-${observation.kind}`] },
        lateCompletionRejected: false,
      });
    }
    if (!observation.ok) {
      timeout.cancel();
      cancellation.cancel();
      return commitOutcome({
        status: signal?.aborted ? 'cancelled' : 'failed',
        errorCode: signal?.aborted
          ? 'EFFECT_CANCELLED'
          : normalizedErrorCode(observation.error, 'EFFECT_WORKSPACE_OBSERVATION_FAILED'),
        evidence: {
          evidenceRefs: [`effect:${effectId}:workspace-observation-failed`],
        },
        lateCompletionRejected: signal?.aborted === true,
      });
    }
    const observed = observation.value;
    if (
      observed.canonicalRoot !== boundRequest.target.canonicalRoot
      || observed.workspaceRevision !== boundRequest.workspaceRevision
    ) {
      timeout.cancel();
      cancellation.cancel();
      return commitOutcome({
        status: 'failed',
        errorCode: EffectBrokerErrorCode.WORKSPACE_STALE,
        evidence: { evidenceRefs: [`effect:${effectId}:workspace-stale`] },
        lateCompletionRejected: false,
      });
    }

    if (isM2FileListOutputRequest(boundRequest)
      && nowMs(clock) >= startedAtMs + boundRequest.timeoutMs) {
      timeout.cancel(); cancellation.cancel();
      return commitOutcome({ status: 'timed_out', errorCode: 'EFFECT_TIMED_OUT' });
    }
    const provider = providerFor(providers, isM2FileListOutputRequest(boundRequest) ? 'project.fs.list' : boundRequest.kind);
    if (!provider || typeof provider.execute !== 'function') {
      timeout.cancel();
      cancellation.cancel();
      return commitOutcome({
        status: 'failed',
        errorCode: EffectBrokerErrorCode.PROVIDER_MISSING,
        evidence: { evidenceRefs: [`effect:${effectId}:provider-missing`] },
        lateCompletionRejected: false,
      });
    }

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
          evidence: conservativeRollbackEvidence(
            request,
            first.error?.evidence,
            'provider-applied-error',
          ),
          lateCompletionRejected: true,
        };
      } else {
        outcome = {
          status: first.error?.code === 'EFFECT_CANCELLED' ? 'cancelled' : 'failed',
          errorCode: normalizedErrorCode(first.error),
          evidence: first.error?.evidence || {
            evidenceRefs: [`effect:${effectId}:provider-pre-effect-failed`],
          },
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
          evidence: conservativeRollbackEvidence(
            request,
            settled.ok ? settled.evidence : settled.error?.evidence,
            `${first.kind}-after-provider-start`,
          ),
          lateCompletionRejected: true,
        };
      } else {
        outcome = {
          status: 'orphaned',
          errorCode: 'EFFECT_ORPHANED',
          evidence: conservativeRollbackEvidence(
            request,
            null,
            'provider-settlement-unknown',
          ),
          lateCompletionRejected: true,
        };
      }
    }

    return commitOutcome(outcome);
  }

  return Object.freeze({ prepareFilesystemWrite, prepareFilesystemRead, prepareFilesystemListRoot, execute });
}

export const _testInternals = Object.freeze({
  bytesFromPayload,
  sha256,
  stableEffectId,
  verifyGrantConstraints,
});

export default createEffectBroker;
