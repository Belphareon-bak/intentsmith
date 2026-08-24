import { createHash } from 'node:crypto';

import {
  computeEffectRequestDigest,
  validateEffectRequest,
  validateEffectResultForRequest,
} from '../../contracts/m2/effect-v1.js';

import {
  M2_TOOL_CONTRACT_KIND,
  M2_TOOL_CONTRACT_VERSION,
  M2_TOOL_AUTHORITY_MODE,
  M2_TOOL_ERROR_CODE,
  M2_TOOL_TERMINAL_STATUS,
  computeM2ToolRequestDigest,
  computeM2ToolValueDigest,
  normalizeM2ToolValue,
  validateM2ToolRequest,
  validateM2ToolResult,
} from '../../contracts/m2/tool-v1.js';
import {
  getM2ToolDescriptor,
  expectedM2EffectOperationKey,
  projectM2EffectToolTerminal,
} from './m2-tool-registry.js';
import {
  createProcessExecutionOwner,
} from '../effects/execution-owner.js';

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
    'bindToolEffect',
    'getToolRequestByEffect',
    'getEffectLinkByRequest',
    'getEffectLinkByEffect',
    'getExactEffectResult',
    'invalidatePendingEffect',
    'invalidateToolEffectOperation',
    'getToolEffectOperationInvalidation',
    'getToolEffectInvalidation',
    'getToolExecutionClaim',
    'claimToolExecution',
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
    // A websocket connection ID changes on reconnect. The durable authority
    // session is therefore derived from the persisted conversation identity;
    // the transient session is still required above as authenticated ingress.
    sessionId: stableIdentifier('session', conversationSeed),
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
    && effectRequest.origin.surface === request.origin.surface
    && effectRequest.origin.sessionId === request.origin.sessionId
    && effectRequest.origin.conversationId === request.origin.conversationId
    && effectRequest.kind === descriptor.requiredEffectKind;
  const operationMatches = effectRequest.idempotencyKey
    === expectedM2EffectOperationKey(request);
  if (!requestMatches || !operationMatches) {
    return { valid: false, reason: 'EffectRequest identity mismatch' };
  }
  if (
    typeof descriptor.validateEffectTranslation !== 'function'
    || descriptor.validateEffectTranslation(request, effectRequest) !== true
  ) {
    return { valid: false, reason: 'effect payload translation mismatch' };
  }
  if (effectResult !== null) {
    const resultValidation = validateEffectResultForRequest(effectRequest, effectResult);
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
    outputSchema: request.outputSchema,
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
  executionOwnerFactory = createProcessExecutionOwner,
} = {}) {
  const repository = requireRepository(repositoryValue);
  if (typeof clock !== 'function' || typeof scheduleTimeout !== 'function') {
    fail(M2ToolBrokerErrorCode.INPUT_INVALID, 'Tool broker clock and scheduler are required');
  }
  if (typeof descriptorResolver !== 'function') {
    fail(M2ToolBrokerErrorCode.INPUT_INVALID, 'Tool descriptor resolver is required');
  }
  if (typeof executionOwnerFactory !== 'function') {
    fail(M2ToolBrokerErrorCode.INPUT_INVALID, 'Tool execution ownership authority is required');
  }

  function inProgress(request, claim) {
    return Object.freeze({
      request,
      value: null,
      result: null,
      state: 'in_progress',
      executionGeneration: claim.generation,
    });
  }

  function acquireExecution(request) {
    return repository.claimToolExecution({
      requestId: request.requestId,
      executionOwner: executionOwnerFactory(),
    });
  }

  function createRequest({ toolId, input, context = {}, timeoutMs = 30_000 } = {}) {
    const descriptor = descriptorResolver(toolId);
    if (!descriptor) {
      fail(M2ToolBrokerErrorCode.INPUT_INVALID, `No M2 descriptor owns tool ${toolId}`);
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
      fail(M2ToolBrokerErrorCode.INPUT_INVALID, 'Tool timeout is outside the contract range');
    }
    let normalizedInput;
    try {
      normalizedInput = normalizeM2ToolValue(input);
    } catch (error) {
      fail(M2ToolBrokerErrorCode.INPUT_INVALID, 'Tool input has no canonical JSON form', {
        toolId,
        cause: error?.message || String(error),
      });
    }
    const inputErrors = descriptor.validateInput(normalizedInput);
    if (inputErrors.length > 0) {
      fail(M2ToolBrokerErrorCode.INPUT_INVALID, 'Tool input does not match its registered schema', {
        toolId,
        errors: inputErrors,
      });
    }
    const inputDigest = computeM2ToolValueDigest(normalizedInput);
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
      authorityMode: descriptor.authorityMode,
      inputSchema: descriptor.inputSchema,
      outputSchema: descriptor.outputSchema,
      input: normalizedInput,
      inputDigest,
      requiredEffectKind: descriptor.requiredEffectKind,
      effectBinding: typeof descriptor.buildEffectBinding === 'function'
        ? descriptor.buildEffectBinding(normalizedInput)
        : null,
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

  function commitExecution({ request, value: _untrustedProviderValue, result, executionClaim }) {
    try {
      repository.recordToolResult(result, { executionClaim });
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
    // The durable canonical ToolResult is the only outward authority. Returning
    // raw provider bytes here made the first response differ from exact replay
    // after NFC normalization and could leak provider-owned metadata.
    return Object.freeze({
      request,
      value: stored.status === M2_TOOL_TERMINAL_STATUS.OK ? stored.output : null,
      result: stored,
    });
  }

  function bindTranslatedEffect(request, translation) {
    if (!translation.valid) return translation;
    try {
      repository.bindToolEffect({
        requestId: request.requestId,
        effectRequestId: translation.effectRequest.effectId,
        effectRequest: translation.effectRequest,
      });
    } catch (error) {
      throw new M2ToolBrokerError(
        M2ToolBrokerErrorCode.RESULT_UNCOMMITTED,
        'Tool effect binding could not be committed; terminal truth is withheld',
        { requestId: request.requestId, cause: error?.message || String(error) },
      );
    }
    return translation;
  }

  function commitEffectTerminal({ request, descriptor, translation, executionClaim }) {
    const effectRequest = translation.effectRequest;
    const effectResult = translation.effectResult;
    if (!effectResult) return null;
    const projection = projectM2EffectToolTerminal(
      request,
      descriptor,
      effectRequest,
      effectResult,
    );
    const terminalStartedAtMs = Date.parse(projection.startedAt);
    const terminalCompletedAtMs = Date.parse(projection.completedAt);
    return commitExecution({
      request,
      executionClaim,
      value: projection.status === M2_TOOL_TERMINAL_STATUS.OK ? projection.output : null,
      result: terminalResult({
        request,
        descriptor,
        status: projection.status,
        output: projection.output,
        error: projection.error,
        effectRequestId: projection.effectRequestId,
        startedAtMs: terminalStartedAtMs,
        completedAtMs: terminalCompletedAtMs,
        evidenceRefs: projection.evidenceRefs,
        lateCompletionRejected: projection.lateCompletionRejected,
      }),
    });
  }

  function commitInterrupted({ request, descriptor, kind, startedAtMs, executionClaim }) {
    return commitExecution({
      request,
      executionClaim,
      value: null,
      result: terminalResult({
        request,
        descriptor,
        status: kind === 'cancelled'
          ? M2_TOOL_TERMINAL_STATUS.CANCELLED
          : M2_TOOL_TERMINAL_STATUS.TIMEOUT,
        error: {
          code: kind === 'cancelled'
            ? M2_TOOL_ERROR_CODE.CANCELLED
            : M2_TOOL_ERROR_CODE.TIMEOUT,
          message: kind === 'cancelled'
            ? 'Tool effect preparation was cancelled'
            : 'Tool effect preparation exceeded its deadline',
          retryable: kind === 'timed_out',
        },
        startedAtMs,
        completedAtMs: requireClockValue(clock),
        evidenceRefs: [`tool:${request.requestId}:${kind}:effect-not-executed`],
        lateCompletionRejected: true,
      }),
    });
  }

  function neutralizeEffectOperation(request, reasonCode) {
    try {
      return repository.invalidateToolEffectOperation({
        requestId: request.requestId,
        reasonCode,
      });
    } catch (error) {
      throw new M2ToolBrokerError(
        M2ToolBrokerErrorCode.RESULT_UNCOMMITTED,
        'Tool effect preparation could not be durably neutralized; terminal truth is withheld',
        {
          requestId: request.requestId,
          cause: error?.details?.cause || error?.message || String(error),
        },
      );
    }
  }

  function commitClosedEffectOperation({
    request,
    descriptor,
    invalidation,
    executionClaim,
  }) {
    const reason = invalidation.reasonCode;
    const cancelled = reason === 'TOOL_EFFECT_PREPARATION_CANCELLED';
    const timedOut = reason === 'TOOL_EFFECT_PREPARATION_TIMEOUT';
    const translationInvalid = reason === 'TOOL_EFFECT_TRANSLATION_INVALID';
    const status = cancelled
      ? M2_TOOL_TERMINAL_STATUS.CANCELLED
      : timedOut
        ? M2_TOOL_TERMINAL_STATUS.TIMEOUT
        : M2_TOOL_TERMINAL_STATUS.ERROR;
    const code = cancelled
      ? M2_TOOL_ERROR_CODE.CANCELLED
      : timedOut
        ? M2_TOOL_ERROR_CODE.TIMEOUT
        : translationInvalid
          ? 'TOOL_EFFECT_TRANSLATION_INVALID'
          : 'TOOL_EFFECT_PREPARATION_FAILED';
    return commitExecution({
      request,
      executionClaim,
      value: null,
      result: terminalResult({
        request,
        descriptor,
        status,
        error: {
          code,
          message: `Tool effect operation is durably closed (${reason})`,
          retryable: false,
        },
        startedAtMs: executionClaim.claimedAtMs,
        completedAtMs: Math.max(executionClaim.claimedAtMs, invalidation.invalidatedAtMs),
        evidenceRefs: invalidation.effectId
          ? [
            `effect:${invalidation.effectId}:invalidated`,
            `effect-operation-invalidated-at:${invalidation.invalidatedAtMs}`,
          ]
          : [
            `tool:${request.requestId}:effect-operation-invalidated`,
            `effect-operation-invalidated-at:${invalidation.invalidatedAtMs}`,
          ],
        lateCompletionRejected: true,
      }),
    });
  }

  function assertSettlementCaller(request, context) {
    const actor = canonicalActor(context);
    const conversationSeed = context?.conversationId;
    if (!(['string', 'number'].includes(typeof conversationSeed))
      || String(conversationSeed).length === 0) {
      fail(M2ToolBrokerErrorCode.INPUT_INVALID, 'Persisted conversation identity is required');
    }
    const exact = actor.type === request.actor.type
      && actor.id === request.actor.id
      && stableIdentifier('conversation', conversationSeed) === request.origin.conversationId;
    if (!exact) {
      fail(M2ToolBrokerErrorCode.INPUT_INVALID, 'Tool effect settlement caller does not own the request');
    }
  }

  function settleEffect({ effectId, context = {} } = {}) {
    const link = repository.getEffectLinkByEffect(effectId);
    if (!link) return null;
    const request = link.request || repository.getToolRequestByEffect(effectId);
    assertSettlementCaller(request, context);
    const existingResult = repository.getToolResult(request.requestId);
    if (existingResult) {
      return Object.freeze({
        request,
        value: existingResult.status === M2_TOOL_TERMINAL_STATUS.OK
          ? existingResult.output
          : null,
        result: existingResult,
        effectRequestId: effectId,
      });
    }
    const descriptor = descriptorResolver(request.toolId);
    const effectResult = repository.getExactEffectResult(effectId);
    if (!effectResult) {
      return Object.freeze({
        request,
        value: null,
        result: null,
        state: 'approval_required',
        effectRequestId: effectId,
      });
    }
    const translation = bindTranslatedEffect(request, validateEffectTranslation(
      request,
      descriptor,
      { effectRequest: link.effectRequest, effectResult },
    ));
    if (!translation.valid) {
      fail(
        M2ToolBrokerErrorCode.CONTRACT_INVALID,
        'Stored tool/effect settlement no longer matches its exact translation',
        { requestId: request.requestId, effectId, reason: translation.reason },
      );
    }
    return commitEffectTerminal({
      request,
      descriptor,
      translation,
      executionClaim: repository.getToolExecutionClaim(request.requestId),
    });
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
    const existingLink = repository.getEffectLinkByRequest(request.requestId);
    if (existingLink) {
      return settleEffect({ effectId: existingLink.effectId, context });
    }
    const executionClaim = acquireExecution(request);
    if (!executionClaim.acquired) {
      const racedResult = repository.getToolResult(request.requestId);
      if (racedResult) {
        return Object.freeze({
          request,
          value: racedResult.status === M2_TOOL_TERMINAL_STATUS.OK ? racedResult.output : null,
          result: racedResult,
        });
      }
      const racedLink = repository.getEffectLinkByRequest(request.requestId);
      if (racedLink) return settleEffect({ effectId: racedLink.effectId, context });
      return inProgress(request, executionClaim.claim);
    }
    const commitClaimed = input => commitExecution({
      ...input,
      executionClaim: executionClaim.claim,
    });
    const startedAtMs = requireClockValue(clock);

    const existingInvalidation = request.authorityMode === M2_TOOL_AUTHORITY_MODE.EFFECT
      ? repository.getToolEffectOperationInvalidation(request.requestId)
        || repository.getToolEffectInvalidation(request.requestId)
      : null;
    if (existingInvalidation) {
      return commitClosedEffectOperation({
        request,
        descriptor,
        invalidation: existingInvalidation,
        executionClaim: executionClaim.claim,
      });
    }

    if (request.authorityMode === M2_TOOL_AUTHORITY_MODE.UNAVAILABLE) {
      return commitClaimed({
        request,
        value: null,
        result: terminalResult({
          request,
          descriptor,
          status: M2_TOOL_TERMINAL_STATUS.ERROR,
          error: {
            code: M2_TOOL_ERROR_CODE.EFFECT_AUTHORITY_UNAVAILABLE,
            message: `${toolId} has no exact M2 effect translation installed`,
            retryable: false,
          },
          startedAtMs,
          completedAtMs: requireClockValue(clock),
          evidenceRefs: [`tool:${request.requestId}:authority-unavailable`],
        }),
      });
    }

    if (request.authorityMode === M2_TOOL_AUTHORITY_MODE.EFFECT) {
      if (request.origin.projectId === null) {
        return commitClaimed({
          request,
          value: null,
          result: terminalResult({
            request,
            descriptor,
            status: M2_TOOL_TERMINAL_STATUS.ERROR,
            error: {
              code: M2_TOOL_ERROR_CODE.EFFECT_AUTHORITY_UNAVAILABLE,
              message: `${toolId} requires an active registered project before effect authority`,
              retryable: false,
            },
            startedAtMs,
            completedAtMs: requireClockValue(clock),
            evidenceRefs: [`tool:${request.requestId}:project-authority-unavailable`],
          }),
        });
      }
      if (!effectAdapter || typeof effectAdapter.prepare !== 'function') {
        return commitClaimed({
          request,
          value: null,
          result: terminalResult({
            request,
            descriptor,
            status: M2_TOOL_TERMINAL_STATUS.ERROR,
            error: {
              code: M2_TOOL_ERROR_CODE.EFFECT_AUTHORITY_UNAVAILABLE,
              message: `${toolId} requires ${request.requiredEffectKind} authority before execution`,
              retryable: false,
            },
            startedAtMs,
            completedAtMs: requireClockValue(clock),
            evidenceRefs: [`tool:${request.requestId}:effect-not-invoked`],
          }),
        });
      }
      if (context?.signal?.aborted) {
        return commitInterrupted({
          request,
          descriptor,
          kind: 'cancelled',
          startedAtMs,
          executionClaim: executionClaim.claim,
        });
      }
      const controller = new AbortController();
      const timeout = timeoutPromise(scheduleTimeout, request.timeoutMs);
      const cancellation = cancellationPromise(context?.signal);
      const preparation = Promise.resolve()
        .then(() => effectAdapter.prepare({
          request,
          context: { ...context, signal: controller.signal },
          signal: controller.signal,
        }))
        .then(
          value => ({ kind: 'provider', ok: true, value }),
          error => ({ kind: 'provider', ok: false, error }),
        );
      const first = await Promise.race([preparation, timeout.promise, cancellation.promise]);
      timeout.dispose();
      cancellation.dispose();
      if (first.kind !== 'provider') {
        controller.abort(first.kind);
        const invalidation = neutralizeEffectOperation(
          request,
          first.kind === 'cancelled'
            ? 'TOOL_EFFECT_PREPARATION_CANCELLED'
            : 'TOOL_EFFECT_PREPARATION_TIMEOUT',
        );
        return commitClosedEffectOperation({
          request,
          descriptor,
          invalidation,
          executionClaim: executionClaim.claim,
        });
      }
      if (!first.ok) {
        const invalidation = neutralizeEffectOperation(
          request,
          'TOOL_EFFECT_PREPARATION_FAILED',
        );
        return commitClosedEffectOperation({
          request,
          descriptor,
          invalidation,
          executionClaim: executionClaim.claim,
        });
      }
      const prepared = first.value;
      const candidate = validateEffectTranslation(request, descriptor, prepared);
      if (!candidate.valid) {
        // Adapter return bytes are not authority. Neutralize the exact durable
        // operation even if the adapter throws away or forges its return shape.
        const operationInvalidation = neutralizeEffectOperation(
          request,
          'TOOL_EFFECT_TRANSLATION_INVALID',
        );
        const exposedAuthority = prepared?.effectRequest != null
          || prepared?.effectResult != null
          || prepared?.effectRequestId != null;
        const effectRequestId = typeof prepared?.effectRequestId === 'string'
          ? prepared.effectRequestId
          : prepared?.effectRequest?.effectId;
        if (
          exposedAuthority
          && typeof effectRequestId === 'string'
          && effectRequestId !== operationInvalidation.effectId
        ) {
          try {
            repository.invalidatePendingEffect({
              requestId: request.requestId,
              effectRequestId,
              reasonCode: 'TOOL_EFFECT_TRANSLATION_INVALID',
            });
          } catch (error) {
            throw new M2ToolBrokerError(
              M2ToolBrokerErrorCode.RESULT_UNCOMMITTED,
              'Invalid exposed effect authority could not be durably neutralized',
              {
                requestId: request.requestId,
                cause: error?.details?.cause || error?.message || String(error),
              },
            );
          }
        }
        return commitClosedEffectOperation({
          request,
          descriptor,
          invalidation: operationInvalidation,
          executionClaim: executionClaim.claim,
        });
      }

      // An independent worker or direct-SQL authority transaction may close
      // the exact operation while the adapter is awaited. Re-read durable
      // truth before linking; the DB link trigger is the final race fence.
      const postPrepareInvalidation = repository.getToolEffectOperationInvalidation(
        request.requestId,
      ) || repository.getToolEffectInvalidation(request.requestId);
      if (postPrepareInvalidation) {
        return commitClosedEffectOperation({
          request,
          descriptor,
          invalidation: postPrepareInvalidation,
          executionClaim: executionClaim.claim,
        });
      }

      // `state` and `effectRequestId` returned beside the canonical documents
      // are hints, not authority. Derive the only observable state from the
      // validated EffectRequest/EffectResult pair before binding, so corrupted
      // adapter metadata cannot create Tool terminal -> later effect success.
      let translation;
      try {
        translation = bindTranslatedEffect(request, candidate);
      } catch (error) {
        const bindRaceInvalidation = repository.getToolEffectOperationInvalidation(
          request.requestId,
        ) || repository.getToolEffectInvalidation(request.requestId);
        if (bindRaceInvalidation) {
          return commitClosedEffectOperation({
            request,
            descriptor,
            invalidation: bindRaceInvalidation,
            executionClaim: executionClaim.claim,
          });
        }
        throw error;
      }
      const effectRequestId = translation.effectRequest.effectId;
      const terminal = commitEffectTerminal({
        request,
        descriptor,
        translation,
        executionClaim: executionClaim.claim,
      });
      if (terminal) return terminal;
      return Object.freeze({
        request,
        value: null,
        result: null,
        state: 'approval_required',
        effectRequestId,
      });
    }

    if (request.authorityMode !== M2_TOOL_AUTHORITY_MODE.DIRECT || !descriptor.direct) {
      fail(M2ToolBrokerErrorCode.CONTRACT_INVALID, `Tool ${toolId} has inconsistent authority mode`);
    }
    if (typeof invoke !== 'function') {
      fail(M2ToolBrokerErrorCode.INPUT_INVALID, `Direct tool ${toolId} requires an implementation`);
    }
    const controller = new AbortController();
    const timeout = timeoutPromise(scheduleTimeout, request.timeoutMs);
    const cancellation = cancellationPromise(context?.signal);
    const invocation = Promise.resolve()
      .then(() => invoke(controller.signal, request.input))
      .then(
        value => ({ kind: 'provider', ok: true, value }),
        error => ({ kind: 'provider', ok: false, error }),
      );
    const first = await Promise.race([invocation, timeout.promise, cancellation.promise]);
    timeout.dispose();
    cancellation.dispose();
    if (first.kind !== 'provider') controller.abort(first.kind);

    if (first.kind === 'cancelled' || first.kind === 'timed_out') {
      return commitClaimed({
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
      return commitClaimed({
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
      return commitClaimed({
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
      return commitClaimed({
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
    return commitClaimed({
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

  return Object.freeze({ createRequest, execute, settleEffect });
}

export default createM2ToolBroker;
