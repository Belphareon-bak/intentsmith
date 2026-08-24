import { createHash } from 'node:crypto';

import {
  computeEffectRequestDigest,
  validateEffectRequest,
  validateEffectResult,
} from '../../contracts/m2/effect-v1.js';

import {
  M2_TOOL_CONTRACT_KIND,
  M2_TOOL_CONTRACT_VERSION,
  M2_TOOL_ERROR_CODE,
  M2_TOOL_TERMINAL_STATUS,
  computeM2ToolRequestDigest,
  computeM2ToolValueDigest,
  validateM2ToolRequest,
  validateM2ToolResult,
} from '../../contracts/m2/tool-v1.js';
import { getM2ToolDescriptor } from './m2-tool-registry.js';

export const M2ToolBrokerErrorCode = Object.freeze({
  INPUT_INVALID: 'M2_TOOL_BROKER_INPUT_INVALID',
  CONTRACT_INVALID: 'M2_TOOL_BROKER_CONTRACT_INVALID',
  RESULT_UNCOMMITTED: 'M2_TOOL_RESULT_UNCOMMITTED',
});

export class M2ToolBrokerError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'M2ToolBrokerError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new M2ToolBrokerError(code, message, details);
}

function stableIdentifier(prefix, value) {
  return `${prefix}:${createHash('sha256').update(String(value), 'utf8').digest('hex')}`;
}

function requireRepository(repository) {
  const methods = [
    'registerToolRequest',
    'getToolRequest',
    'getToolResult',
    'recordToolResult',
  ];
  if (!repository || methods.some(method => typeof repository[method] !== 'function')) {
    fail(M2ToolBrokerErrorCode.INPUT_INVALID, 'Durable M2 tool authority repository is required');
  }
  return repository;
}

function requireClockValue(clock) {
  const value = clock();
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(M2ToolBrokerErrorCode.INPUT_INVALID, 'Tool broker clock returned an invalid timestamp');
  }
  return value;
}

function canonicalActor(context) {
  const subject = context?.authenticatedSubject;
  if (
    subject?.actorType === 'user'
    && typeof subject.actorId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(subject.actorId)
  ) return { type: 'user', id: subject.actorId };
  fail(M2ToolBrokerErrorCode.INPUT_INVALID, 'Authenticated user identity is required');
}

function positiveProjectId(context) {
  const projectId = Number(context?.project?.id ?? context?.projectId);
  return Number.isSafeInteger(projectId) && projectId > 0 ? projectId : null;
}

function canonicalOrigin(context) {
  const sessionSeed = context?.sessionId;
  const conversationSeed = context?.conversationId;
  if (
    !(['string', 'number'].includes(typeof sessionSeed) && String(sessionSeed).length > 0)
    || !(['string', 'number'].includes(typeof conversationSeed) && String(conversationSeed).length > 0)
    || context?.userMessageId === null
    || context?.userMessageId === undefined
  ) {
    fail(
      M2ToolBrokerErrorCode.INPUT_INVALID,
      'Persisted session, conversation and user-message identity are required',
    );
  }
  return {
    surface: 'studio',
    sessionId: stableIdentifier('session', sessionSeed),
    conversationId: stableIdentifier('conversation', conversationSeed),
    projectId: positiveProjectId(context),
  };
}

function validateEffectTranslation(request, descriptor, prepared) {
  const effectRequest = prepared?.effectRequest;
  const effectResult = prepared?.effectResult ?? null;
  const requestValidation = validateEffectRequest(effectRequest);
  if (!requestValidation.valid) return { valid: false, reason: 'invalid EffectRequest' };
  const requestMatches = effectRequest.runId === request.runId
    && effectRequest.origin.projectId === request.origin.projectId
    && effectRequest.actor.type === request.actor.type
    && effectRequest.actor.id === request.actor.id
    && effectRequest.kind === descriptor.requiredEffectKind;
  if (!requestMatches) return { valid: false, reason: 'EffectRequest identity mismatch' };
  if (
    typeof descriptor.validateEffectTranslation !== 'function'
    || descriptor.validateEffectTranslation(request, effectRequest) !== true
  ) {
    return { valid: false, reason: 'effect payload translation mismatch' };
  }
  if (effectResult !== null) {
    const resultValidation = validateEffectResult(effectResult);
    if (
      !resultValidation.valid
      || effectResult.effectId !== effectRequest.effectId
      || effectResult.runId !== effectRequest.runId
      || effectResult.projectId !== effectRequest.origin.projectId
      || effectResult.requestDigest !== computeEffectRequestDigest(effectRequest)
    ) return { valid: false, reason: 'EffectResult authority mismatch' };
  }
  return { valid: true, effectRequest, effectResult };
}

function errorCode(error, fallback = M2_TOOL_ERROR_CODE.EXECUTION_FAILED) {
  const candidate = typeof error?.code === 'string' ? error.code : fallback;
  const normalized = candidate.toUpperCase().replace(/[^A-Z0-9_:-]/g, '_').slice(0, 64);
  return /^[A-Z]/.test(normalized) ? normalized : fallback;
}

function sortedUnique(values) {
  return [...new Set(values)]
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

function terminalResult({
  request,
  descriptor,
  status,
  output = null,
  error = null,
  effectRequestId = null,
  startedAtMs,
  completedAtMs,
  evidenceRefs = [],
  lateCompletionRejected = false,
}) {
  const successful = status === M2_TOOL_TERMINAL_STATUS.OK;
  const result = {
    contract: M2_TOOL_CONTRACT_KIND.RESULT,
    version: M2_TOOL_CONTRACT_VERSION,
    requestId: request.requestId,
    requestDigest: computeM2ToolRequestDigest(request),
    runId: request.runId,
    projectId: request.origin.projectId,
    toolId: request.toolId,
    toolVersion: request.toolVersion,
    status,
    outputSchema: descriptor.outputSchema,
    output: successful ? output : null,
    outputDigest: successful ? computeM2ToolValueDigest(output) : null,
    effectRequestId,
    error: successful ? null : {
      code: error.code,
      message: error.message,
      retryable: error.retryable === true,
    },
    startedAt: new Date(startedAtMs).toISOString(),
    completedAt: new Date(Math.max(startedAtMs, completedAtMs)).toISOString(),
    evidenceRefs: sortedUnique(evidenceRefs),
    lateCompletionRejected,
  };
  const validation = validateM2ToolResult(result);
  if (!validation.valid) {
    fail(M2ToolBrokerErrorCode.CONTRACT_INVALID, 'Tool broker produced an invalid ToolResult', {
      errors: validation.errors,
    });
  }
  return Object.freeze(result);
}

function cancellationPromise(signal) {
  if (!signal) return { promise: new Promise(() => {}), dispose() {} };
  if (signal.aborted) return { promise: Promise.resolve({ kind: 'cancelled' }), dispose() {} };
  let listener;
  const promise = new Promise(resolve => {
    listener = () => resolve({ kind: 'cancelled' });
    signal.addEventListener('abort', listener, { once: true });
  });
  return { promise, dispose: () => signal.removeEventListener('abort', listener) };
}

function timeoutPromise(scheduleTimeout, timeoutMs) {
  let handle;
  const promise = new Promise(resolve => {
    handle = scheduleTimeout(() => resolve({ kind: 'timed_out' }), timeoutMs);
  });
  return {
    promise,
    dispose() {
      if (handle && typeof handle.cancel === 'function') handle.cancel();
      else if (handle !== undefined && handle !== null) clearTimeout(handle);
    },
  };
}

export function createM2ToolBroker({
  repository: repositoryValue,
  clock = Date.now,
  scheduleTimeout = (callback, milliseconds) => setTimeout(callback, milliseconds),
  effectAdapter = null,
  descriptorResolver = getM2ToolDescriptor,
} = {}) {
  const repository = requireRepository(repositoryValue);
  if (typeof clock !== 'function' || typeof scheduleTimeout !== 'function') {
    fail(M2ToolBrokerErrorCode.INPUT_INVALID, 'Tool broker clock and scheduler are required');
  }
  if (typeof descriptorResolver !== 'function') {
    fail(M2ToolBrokerErrorCode.INPUT_INVALID, 'Tool descriptor resolver is required');
  }

  function createRequest({ toolId, input, context = {}, timeoutMs = 30_000 } = {}) {
    const descriptor = descriptorResolver(toolId);
    if (!descriptor) {
      fail(M2ToolBrokerErrorCode.INPUT_INVALID, `No M2 descriptor owns tool ${toolId}`);
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
      fail(M2ToolBrokerErrorCode.INPUT_INVALID, 'Tool timeout is outside the contract range');
    }
    const inputErrors = descriptor.validateInput(input);
    if (inputErrors.length > 0) {
      fail(M2ToolBrokerErrorCode.INPUT_INVALID, 'Tool input does not match its registered schema', {
        toolId,
        errors: inputErrors,
      });
    }
    const inputDigest = computeM2ToolValueDigest(input);
    const origin = canonicalOrigin(context);
    const actor = canonicalActor(context);
    const runSeed = context?.conversationId ?? context?.sessionId ?? 'anonymous';
    const runId = stableIdentifier('run', runSeed);
    const operationSeed = {
      runId,
      toolId,
      inputDigest,
      userMessageId: context?.userMessageId ?? null,
    };
    const idempotencyKey = stableIdentifier(
      'tool-operation',
      computeM2ToolValueDigest(operationSeed),
    );
    const requestId = stableIdentifier('tool', `${runId}:${idempotencyKey}:${toolId}`);
    const existing = repository.getToolRequest(requestId);
    const request = {
      contract: M2_TOOL_CONTRACT_KIND.REQUEST,
      version: M2_TOOL_CONTRACT_VERSION,
      requestId,
      runId,
      actor,
      origin,
      toolId: descriptor.id,
      toolVersion: descriptor.version,
      riskClass: descriptor.riskClass,
      inputSchema: descriptor.inputSchema,
      input,
      inputDigest,
      requiredEffectKind: descriptor.requiredEffectKind,
      timeoutMs,
      idempotencyKey,
      createdAt: existing?.createdAt || new Date(requireClockValue(clock)).toISOString(),
    };
    const validation = validateM2ToolRequest(request);
    if (!validation.valid) {
      fail(M2ToolBrokerErrorCode.CONTRACT_INVALID, 'Tool broker produced an invalid ToolRequest', {
        errors: validation.errors,
      });
    }
    repository.registerToolRequest(request);
    return repository.getToolRequest(requestId);
  }

  function commitExecution({ request, value, result }) {
    try {
      repository.recordToolResult(result);
    } catch (error) {
      throw new M2ToolBrokerError(
        M2ToolBrokerErrorCode.RESULT_UNCOMMITTED,
        'Tool terminal result could not be committed; success is withheld',
        { requestId: request.requestId, cause: error?.message || String(error) },
      );
    }
    const stored = repository.getToolResult(request.requestId);
    if (!stored) {
      fail(
        M2ToolBrokerErrorCode.RESULT_UNCOMMITTED,
        'Tool authority did not return the committed terminal result',
        { requestId: request.requestId },
      );
    }
    return Object.freeze({ request, value, result: stored });
  }

  async function execute({ toolId, input, context = {}, timeoutMs = 30_000, invoke } = {}) {
    const request = createRequest({ toolId, input, context, timeoutMs });
    const descriptor = descriptorResolver(request.toolId);
    const existingResult = repository.getToolResult(request.requestId);
    if (existingResult) {
      return Object.freeze({
        request,
        value: existingResult.status === M2_TOOL_TERMINAL_STATUS.OK
          ? existingResult.output
          : null,
        result: existingResult,
      });
    }
    const startedAtMs = requireClockValue(clock);

    if (!descriptor.direct) {
      if (!effectAdapter || typeof effectAdapter.prepare !== 'function') {
        return commitExecution({
          request,
          value: null,
          result: terminalResult({
            request,
            descriptor,
            status: M2_TOOL_TERMINAL_STATUS.ERROR,
            error: {
              code: M2_TOOL_ERROR_CODE.EFFECT_AUTHORITY_UNAVAILABLE,
              message: `${toolId} requires ${descriptor.requiredEffectKind} authority before execution`,
              retryable: false,
            },
            startedAtMs,
            completedAtMs: requireClockValue(clock),
            evidenceRefs: [`tool:${request.requestId}:effect-not-invoked`],
          }),
        });
      }
      const prepared = await effectAdapter.prepare({ request, context, signal: context?.signal });
      const translation = validateEffectTranslation(request, descriptor, prepared);
      const effectRequestId = translation.valid ? translation.effectRequest.effectId : null;
      const canonicalEffectResult = translation.valid ? translation.effectResult : null;
      if (canonicalEffectResult?.terminalStatus === 'succeeded') {
        const outputErrors = descriptor.validateOutput(prepared.output);
        if (
          outputErrors.length === 0
        ) {
          return commitExecution({
            request,
            value: prepared.output,
            result: terminalResult({
              request,
              descriptor,
              status: M2_TOOL_TERMINAL_STATUS.OK,
              output: prepared.output,
              effectRequestId,
              startedAtMs,
              completedAtMs: requireClockValue(clock),
              evidenceRefs: prepared.evidenceRefs || [],
            }),
          });
        }
      }
      if (canonicalEffectResult) {
        const status = canonicalEffectResult.terminalStatus === 'cancelled'
          ? M2_TOOL_TERMINAL_STATUS.CANCELLED
          : canonicalEffectResult.terminalStatus === 'timed_out'
            ? M2_TOOL_TERMINAL_STATUS.TIMEOUT
            : ['orphaned', 'killed'].includes(canonicalEffectResult.terminalStatus)
              ? M2_TOOL_TERMINAL_STATUS.ORPHANED
              : M2_TOOL_TERMINAL_STATUS.ERROR;
        return commitExecution({
          request,
          value: null,
          result: terminalResult({
            request,
            descriptor,
            status,
            error: {
              code: canonicalEffectResult.errorCode || M2_TOOL_ERROR_CODE.EXECUTION_FAILED,
              message: `${toolId} effect ended as ${canonicalEffectResult.terminalStatus}`,
              retryable: false,
            },
            effectRequestId,
            startedAtMs: Date.parse(canonicalEffectResult.startedAt),
            completedAtMs: Date.parse(canonicalEffectResult.completedAt),
            evidenceRefs: [
              `effect:${effectRequestId}`,
              ...(canonicalEffectResult.evidenceRefs || []),
            ],
            lateCompletionRejected: canonicalEffectResult.lateCompletionRejected,
          }),
        });
      }
      const approvalRequired = prepared?.state === 'approval_required' && translation.valid;
      if (approvalRequired) {
        return Object.freeze({
          request,
          value: null,
          result: null,
          state: 'approval_required',
          effectRequestId,
        });
      }
      return commitExecution({
        request,
        value: null,
        result: terminalResult({
          request,
          descriptor,
          status: M2_TOOL_TERMINAL_STATUS.ERROR,
          error: {
            code: M2_TOOL_ERROR_CODE.EFFECT_AUTHORITY_UNAVAILABLE,
            message: `${toolId} effect adapter did not produce canonical terminal authority`,
            retryable: false,
          },
          effectRequestId: null,
          startedAtMs,
          completedAtMs: requireClockValue(clock),
          evidenceRefs: translation.valid ? [`effect:${effectRequestId}:terminal-unavailable`] : [],
        }),
      });
    }

    if (typeof invoke !== 'function') {
      fail(M2ToolBrokerErrorCode.INPUT_INVALID, `Direct tool ${toolId} requires an implementation`);
    }
    const controller = new AbortController();
    const timeout = timeoutPromise(scheduleTimeout, request.timeoutMs);
    const cancellation = cancellationPromise(context?.signal);
    const invocation = Promise.resolve()
      .then(() => invoke(controller.signal))
      .then(
        value => ({ kind: 'provider', ok: true, value }),
        error => ({ kind: 'provider', ok: false, error }),
      );
    const first = await Promise.race([invocation, timeout.promise, cancellation.promise]);
    timeout.dispose();
    cancellation.dispose();
    if (first.kind !== 'provider') controller.abort(first.kind);

    if (first.kind === 'cancelled' || first.kind === 'timed_out') {
      return commitExecution({
        request,
        value: null,
        result: terminalResult({
          request,
          descriptor,
          status: first.kind === 'cancelled'
            ? M2_TOOL_TERMINAL_STATUS.CANCELLED
            : M2_TOOL_TERMINAL_STATUS.TIMEOUT,
          error: {
            code: first.kind === 'cancelled'
              ? M2_TOOL_ERROR_CODE.CANCELLED
              : M2_TOOL_ERROR_CODE.TIMEOUT,
            message: first.kind === 'cancelled'
              ? 'Tool execution was cancelled'
              : 'Tool execution exceeded its deadline',
            retryable: first.kind === 'timed_out',
          },
          startedAtMs,
          completedAtMs: requireClockValue(clock),
          evidenceRefs: [`tool:${request.requestId}:${first.kind}`],
          lateCompletionRejected: true,
        }),
      });
    }

    if (!first.ok) {
      return commitExecution({
        request,
        value: first.error,
        result: terminalResult({
          request,
          descriptor,
          status: M2_TOOL_TERMINAL_STATUS.ERROR,
          error: {
            code: errorCode(first.error),
            message: first.error?.message || 'Tool execution failed',
            retryable: false,
          },
          startedAtMs,
          completedAtMs: requireClockValue(clock),
        }),
      });
    }

    const legacyFailure = first.value && first.value.success === false;
    const output = first.value && first.value.success === true ? first.value.data : first.value;
    if (legacyFailure) {
      return commitExecution({
        request,
        value: first.value,
        result: terminalResult({
          request,
          descriptor,
          status: M2_TOOL_TERMINAL_STATUS.ERROR,
          error: {
            code: errorCode({ code: first.value.errorCode }),
            message: first.value.error || 'Tool execution failed',
            retryable: first.value.meta?.retryable === true,
          },
          startedAtMs,
          completedAtMs: requireClockValue(clock),
        }),
      });
    }
    const outputErrors = descriptor.validateOutput(output);
    if (outputErrors.length > 0) {
      return commitExecution({
        request,
        value: first.value,
        result: terminalResult({
          request,
          descriptor,
          status: M2_TOOL_TERMINAL_STATUS.ERROR,
          error: {
            code: M2_TOOL_ERROR_CODE.OUTPUT_INVALID,
            message: `Tool output does not match ${descriptor.outputSchema}`,
            retryable: false,
          },
          startedAtMs,
          completedAtMs: requireClockValue(clock),
          evidenceRefs: outputErrors.map(value => `schema:${value}`),
        }),
      });
    }
    return commitExecution({
      request,
      value: first.value,
      result: terminalResult({
        request,
        descriptor,
        status: M2_TOOL_TERMINAL_STATUS.OK,
        output,
        startedAtMs,
        completedAtMs: requireClockValue(clock),
      }),
    });
  }

  return Object.freeze({ createRequest, execute });
}

export default createM2ToolBroker;
