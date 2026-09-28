import {
  M1_CONTRACT_KIND,
  M1_CONTRACT_VERSION,
  validateConversationCommand,
  validateConversationResult,
  validateCoreEvent,
} from '../../contracts/m1/index.js';
import {
  AbortSource,
  abortSourceOf,
  abortWithReason,
  isAbortError,
  throwIfAborted,
} from '../core/abort-error.js';
import {
  chatTurnErrorPayload,
  isChatTurnError,
} from '../core/chat-turn-error.js';

export const M7_CONVERSATION_EXECUTOR_STAGE = 'IMPLEMENTED_NOT_ACTIVE';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000;
const DEFAULT_CANCEL_CONFIRMATION_MS = 5_000;
const executors = new WeakSet();

function requireFunction(value, label, fallback = null) {
  const resolved = value ?? fallback;
  if (typeof resolved !== 'function') {
    throw new TypeError(`m7-conversation-executor:${label}-required`);
  }
  return resolved;
}

function requireDuration(value, label, fallback, maximum) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new TypeError(`m7-conversation-executor:${label}-invalid`);
  }
  return resolved;
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function result(command, terminal) {
  const value = {
    contract: M1_CONTRACT_KIND.CONVERSATION_RESULT,
    version: M1_CONTRACT_VERSION,
    requestId: command.requestId,
    conversationId: command.conversationId,
    turnId: command.turnId,
    ...terminal,
  };
  const validation = validateConversationResult(value);
  if (!validation.valid) {
    throw new TypeError(`m7-conversation-executor:result-invalid:${validation.errors.join(',')}`);
  }
  return deepFreeze(value);
}

function failure(command, error, signal) {
  if (isAbortError(error) || signal?.aborted) {
    const timeout = abortSourceOf(error, signal) === AbortSource.TIMEOUT;
    return result(command, {
      status: timeout ? 'timeout' : 'cancelled',
      error: timeout
        ? { code: 'CHAT_TIMEOUT', message: 'Chat request timed out.' }
        : { code: 'CHAT_CANCELLED', message: 'Chat request was cancelled.' },
    });
  }
  if (isChatTurnError(error)) {
    const payload = chatTurnErrorPayload(error);
    return result(command, {
      status: 'error',
      error: { code: payload.code, message: payload.message },
    });
  }
  return result(command, {
    status: 'error',
    error: { code: 'CHAT_PROCESSING_FAILED', message: 'Chat processing failed.' },
  });
}

function authorityError(command, code, message) {
  return result(command, { status: 'error', error: { code, message } });
}

function terminalEvent(command, terminal) {
  const event = {
    contract: M1_CONTRACT_KIND.CORE_EVENT,
    version: M1_CONTRACT_VERSION,
    requestId: command.requestId,
    conversationId: command.conversationId,
    turnId: command.turnId,
    sequence: 1,
    phase: 'terminal',
    eventType: 'result',
    terminalStatus: terminal.status,
    payload: { result: terminal },
  };
  const validation = validateCoreEvent(event);
  if (!validation.valid) {
    throw new TypeError(`m7-conversation-executor:event-invalid:${validation.errors.join(',')}`);
  }
  return deepFreeze(event);
}

function validateIdentityContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.subjectId !== 'string' || value.subjectId.length === 0
    || typeof value.deviceId !== 'string' || value.deviceId.length === 0) {
    throw new TypeError('m7-conversation-executor:trusted-context-invalid');
  }
  return value;
}

function normalizeProjectId(value) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('m7-conversation-executor:project-id-invalid');
  }
  return value;
}

function completionRace(active, timeoutMs, setTimer, clearTimer) {
  let timer = null;
  return Promise.race([
    active.completion,
    new Promise(resolve => {
      timer = setTimer(() => resolve({ status: 'confirmation-timeout' }), timeoutMs);
      timer?.unref?.();
    }),
  ]).finally(() => {
    if (timer !== null) clearTimer(timer);
  });
}

export function createM7ConversationCommandExecutor({
  cancelConfirmationMs,
  clearTimeoutFn,
  handleRequest,
  observeCoreEvent,
  resolveConversationProjectId,
  setTimeoutFn,
  timeoutMs,
} = {}) {
  const handle = requireFunction(handleRequest, 'handle-request');
  const observe = requireFunction(observeCoreEvent, 'observe-core-event');
  const resolveProject = requireFunction(
    resolveConversationProjectId,
    'resolve-conversation-project-id',
  );
  const setTimer = requireFunction(setTimeoutFn, 'set-timeout', setTimeout);
  const clearTimer = requireFunction(clearTimeoutFn, 'clear-timeout', clearTimeout);
  const executionTimeout = requireDuration(timeoutMs, 'timeout', DEFAULT_TIMEOUT_MS, 30 * 60 * 1_000);
  const cancellationTimeout = requireDuration(
    cancelConfirmationMs,
    'cancel-confirmation',
    DEFAULT_CANCEL_CONFIRMATION_MS,
    60_000,
  );
  const activeTurns = new Map();

  function emit(command, terminal, subjectId, projectId) {
    // The event is derived entirely from an already validated terminal. A
    // bounded in-memory observer outage must not turn a committed chat result
    // into an UNKNOWN mutation; the event capability reports it unavailable.
    try {
      return observe({
        event: terminalEvent(command, terminal),
        projectId,
        subjectId,
      }) === true;
    } catch {
      return false;
    }
  }

  async function execute(command, trustedContext) {
    if (!executors.has(executor)) {
      throw new TypeError('m7-conversation-executor:genuine-executor-required');
    }
    const validation = validateConversationCommand(command);
    if (!validation.valid) {
      throw new TypeError(`m7-conversation-executor:command-invalid:${validation.errors.join(',')}`);
    }
    const context = validateIdentityContext(trustedContext);
    const projectId = normalizeProjectId(await resolveProject(command.conversationId));

    if (command.action === 'cancel') {
      const active = activeTurns.get(command.conversationId);
      let terminal;
      if (!active) {
        terminal = authorityError(
          command,
          'M1_REMOTE_CANCEL_NOT_ACTIVE',
          'The conversation has no active remote turn to cancel.',
        );
      } else if (command.requestId === active.requestId || command.turnId === active.turnId) {
        terminal = authorityError(
          command,
          'M1_REMOTE_CANCEL_IDENTITY_CONFLICT',
          'The cancel operation must use independent request and turn identities.',
        );
      } else {
        abortWithReason(
          active.abortController,
          AbortSource.USER,
          'Active remote conversation turn cancelled by a signed M7 invocation',
        );
        const target = await completionRace(
          active,
          cancellationTimeout,
          setTimer,
          clearTimer,
        );
        terminal = target.status === 'cancelled'
          ? result(command, {
            status: 'cancelled',
            error: { code: 'CHAT_CANCELLED', message: 'The active conversation turn was cancelled.' },
          })
          : result(command, {
            status: target.status === 'confirmation-timeout' ? 'timeout' : 'error',
            error: target.status === 'confirmation-timeout'
              ? { code: 'CHAT_TIMEOUT', message: 'Timed out while confirming cancellation.' }
              : { code: 'M1_REMOTE_CANCEL_NOT_CONFIRMED', message: 'Cancellation was not confirmed.' },
          });
      }
      emit(command, terminal, context.subjectId, projectId);
      return terminal;
    }

    if (activeTurns.has(command.conversationId)) {
      const terminal = authorityError(
        command,
        'M1_CONVERSATION_BUSY',
        'The conversation already has an active turn.',
      );
      emit(command, terminal, context.subjectId, projectId);
      return terminal;
    }

    const abortController = new AbortController();
    let resolveCompletion;
    const completion = new Promise(resolve => { resolveCompletion = resolve; });
    const active = {
      abortController,
      completion,
      requestId: command.requestId,
      resolveCompletion,
      turnId: command.turnId,
    };
    activeTurns.set(command.conversationId, active);
    const timer = setTimer(() => {
      abortWithReason(
        abortController,
        AbortSource.TIMEOUT,
        `M7 conversation timeout after ${executionTimeout}ms`,
      );
    }, executionTimeout);
    timer?.unref?.();

    let terminal;
    try {
      const response = await handle({
        message: command.input,
        sessionId: `m7:${context.deviceId}`,
        conversationId: command.conversationId,
        projectId,
        requestId: command.requestId,
        turnId: command.turnId,
        signal: abortController.signal,
        authenticatedSubject: deepFreeze({ actorType: 'user', actorId: context.subjectId }),
        context: {
          conversationId: command.conversationId,
          m2LifecycleOnly: true,
          projectId,
          requestId: command.requestId,
          signal: abortController.signal,
          turnId: command.turnId,
        },
      });
      throwIfAborted(abortController.signal);
      if (response?.metadata?.shellCommand) {
        terminal = authorityError(
          command,
          'M1_EFFECT_AUTHORITY_REQUIRED',
          'The response requires an effect that is unavailable on this command boundary.',
        );
      } else if (response?.metadata?.m2LifecycleRequired) {
        terminal = authorityError(
          command,
          'M2_LIFECYCLE_AUTHORITY_REQUIRED',
          'Use the exact M2 lifecycle plan and approval capability.',
        );
      } else if (response?.metadata?.approvalRequired) {
        terminal = authorityError(
          command,
          'M2_EFFECT_AUTHORITY_REQUIRED',
          'The effect requires a separate exact M2 approval.',
        );
      } else {
        terminal = result(command, {
          status: 'ok',
          response: {
            content: response.response,
            metadata: {
              mode: response.mode,
              confidence: response.confidence,
            },
          },
        });
      }
    } catch (error) {
      terminal = failure(command, error, abortController.signal);
    } finally {
      clearTimer(timer);
      if (activeTurns.get(command.conversationId) === active) {
        activeTurns.delete(command.conversationId);
      }
      active.resolveCompletion({ status: terminal?.status ?? 'error' });
    }
    emit(command, terminal, context.subjectId, projectId);
    return terminal;
  }

  const executor = Object.freeze({
    execute,
    stage: M7_CONVERSATION_EXECUTOR_STAGE,
  });
  executors.add(executor);
  return executor;
}

export function isGenuineM7ConversationCommandExecutor(value) {
  return executors.has(value);
}

export default createM7ConversationCommandExecutor;
