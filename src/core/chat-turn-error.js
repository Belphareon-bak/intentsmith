// Terminal chat failures that must not be represented as assistant responses.
import { AbortSource, createAbortError, isAbortError, throwIfAborted } from './abort-error.js';

export const ChatTurnErrorCode = Object.freeze({
  LLM_PROVIDER_UNAVAILABLE: 'LLM_PROVIDER_UNAVAILABLE',
  CHAT_PROCESSING_FAILED: 'CHAT_PROCESSING_FAILED',
  CHAT_CONTEXT_CAPACITY_EXCEEDED: 'CHAT_CONTEXT_CAPACITY_EXCEEDED',
  CHAT_PERSISTENCE_FAILED: 'CHAT_PERSISTENCE_FAILED',
  MODEL_RESPONSE_TRUNCATED: 'MODEL_RESPONSE_TRUNCATED',
  M2_EFFECT_AUTHORITY_REQUIRED: 'M2_EFFECT_AUTHORITY_REQUIRED',
});

export const ChatTurnErrorMessage = Object.freeze({
  LLM_PROVIDER_UNAVAILABLE: 'Model provider is temporarily unavailable.',
  CHAT_PROCESSING_FAILED: 'Chat processing failed.',
  CHAT_CONTEXT_CAPACITY_EXCEEDED: 'Zpráva nebo kontext rozhovoru je pro nastavené okno CHAT příliš dlouhý. Zkraťte zprávu, zvětšete kontext role CHAT nebo začněte novou konverzaci.',
  CHAT_PERSISTENCE_FAILED: 'Chat response could not be persisted.',
  MODEL_RESPONSE_TRUNCATED: 'Model response was incomplete and was not saved.',
  M2_EFFECT_AUTHORITY_REQUIRED: 'This write requires M2 effect authority.',
});

const PROVIDER_FAILURE_TYPES = new Set([
  'LLM_CALL_FAILED',
  'EXPERT_LLM_FAILED',
  'DESIGN_LLM_FAILED',
  'DESIGN_CONTINUE_FAILED',
  'CODE_ANALYSIS_SYNTHESIS_FAILED',
]);

export class ChatTurnError extends Error {
  constructor(message, {
    code,
    statusCode,
    recoverable,
    sourceErrorType = null,
    cause = null,
  }) {
    super(message, cause === null ? undefined : { cause });
    this.name = 'ChatTurnError';
    this.code = code;
    this.statusCode = statusCode;
    this.recoverable = recoverable;
    this.sourceErrorType = sourceErrorType;
  }
}

export class LLMProviderUnavailableError extends ChatTurnError {
  constructor(sourceErrorType = 'LLM_CALL_FAILED') {
    super(ChatTurnErrorMessage.LLM_PROVIDER_UNAVAILABLE, {
      code: ChatTurnErrorCode.LLM_PROVIDER_UNAVAILABLE,
      statusCode: 503,
      recoverable: true,
      sourceErrorType,
    });
    this.name = 'LLMProviderUnavailableError';
  }
}

export class ChatProcessingError extends ChatTurnError {
  constructor(sourceErrorType = null, cause = null) {
    super(ChatTurnErrorMessage.CHAT_PROCESSING_FAILED, {
      code: ChatTurnErrorCode.CHAT_PROCESSING_FAILED,
      statusCode: 500,
      recoverable: false,
      sourceErrorType,
      cause,
    });
    this.name = 'ChatProcessingError';
  }
}

export class ChatContextCapacityError extends ChatTurnError {
  constructor(sourceErrorType, cause = null) {
    super(ChatTurnErrorMessage.CHAT_CONTEXT_CAPACITY_EXCEEDED, {
      code: ChatTurnErrorCode.CHAT_CONTEXT_CAPACITY_EXCEEDED,
      statusCode: 413,
      recoverable: false,
      sourceErrorType,
      cause,
    });
    this.name = 'ChatContextCapacityError';
  }
}

export class ChatPrivacyError extends ChatTurnError {
  constructor() {
    super('Chat je zastaven: ukládání historie je vypnuté nebo nastavení soukromí nelze ověřit. Režim bez historie zatím není podporován. Zkontrolujte nastavení paměti.', {
      code: 'CHAT_PRIVACY_UNAVAILABLE', statusCode: 409, recoverable: false,
    });
  }
}

export class ChatPersistenceError extends ChatTurnError {
  constructor(cause = null) {
    super(ChatTurnErrorMessage.CHAT_PERSISTENCE_FAILED, {
      code: ChatTurnErrorCode.CHAT_PERSISTENCE_FAILED,
      statusCode: 500,
      // The user turn may already be durable. An automatic retry could create
      // a duplicate, so this boundary must not advertise a blind retry.
      recoverable: false,
      sourceErrorType: 'ASSISTANT_TURN_PERSIST_FAILED',
      cause,
    });
    this.name = 'ChatPersistenceError';
  }
}

export class ModelResponseTruncatedError extends ChatTurnError {
  constructor(finishReason = 'length') {
    super(ChatTurnErrorMessage.MODEL_RESPONSE_TRUNCATED, {
      code: ChatTurnErrorCode.MODEL_RESPONSE_TRUNCATED,
      statusCode: 502,
      recoverable: true,
      sourceErrorType: `MODEL_FINISH_REASON_${String(finishReason).toUpperCase()}`,
    });
    this.name = 'ModelResponseTruncatedError';
    this.finishReason = finishReason;
  }
}

export class EffectAuthorityRequiredError extends ChatTurnError {
  constructor(cause = null) {
    super(ChatTurnErrorMessage.M2_EFFECT_AUTHORITY_REQUIRED, {
      code: ChatTurnErrorCode.M2_EFFECT_AUTHORITY_REQUIRED,
      statusCode: 409,
      recoverable: false,
      sourceErrorType: 'LEGACY_FS_WRITE_CONTAINED',
      cause,
    });
    this.name = 'EffectAuthorityRequiredError';
  }
}

export function isChatTurnError(error) {
  return error instanceof ChatTurnError;
}

// Call only at a model-call boundary: a rejected call is never a usable
// classification or project reply. Successful but invalid model content is
// handled by the caller's output validation, separately from availability.
export function throwChatModelCallFailure(error, signal, sourceErrorType = 'LLM_CALL_FAILED') {
  throwIfAborted(signal);
  const chain = [];
  const visited = new Set();
  for (let cause = error; cause && typeof cause === 'object' && !visited.has(cause); cause = cause.cause) {
    visited.add(cause);
    chain.push(cause);
  }
  // Cancellation has priority, including a timeout wrapped by the bridge.
  const aborted = chain.find(isAbortError);
  if (aborted) throw aborted;
  for (const cause of chain) {
    if (isChatTurnError(cause)) throw cause;
    if (cause.code === 'LLM_CONTEXT_WINDOW_EXCEEDED') {
      throw new ChatContextCapacityError(sourceErrorType, error);
    }
    if (cause.code === 'LLM_PROVIDER_MALFORMED_RESPONSE') {
      throw new ChatProcessingError(sourceErrorType, error);
    }
  }
  // Missing/unverified artifacts and future gateway failure codes must fail
  // closed too. Do not infer availability from provider message text.
  throw new LLMProviderUnavailableError(sourceErrorType);
}

export function chatTurnErrorPayload(error) {
  if (!isChatTurnError(error)) {
    throw new TypeError('Expected a ChatTurnError');
  }
  return {
    code: error.code,
    message: error.message,
    recoverable: error.recoverable,
  };
}

export function throwIfTerminalChatFailure(response) {
  const metadata = response?.metadata ?? response?.tag?.metadata;
  if (metadata?.finishReason === 'length') {
    throw new ModelResponseTruncatedError(metadata.finishReason);
  }
  if (metadata?.codeAnalysis === true) {
    if (metadata.projectContext?.status === 'cancelled') throw createAbortError(AbortSource.USER);
    if (metadata.projectContext?.status === 'timeout') throw createAbortError(AbortSource.TIMEOUT);
  }
  if (metadata?.error !== true) return;

  if (PROVIDER_FAILURE_TYPES.has(metadata.errorType)) {
    throw new LLMProviderUnavailableError(metadata.errorType);
  }
  throw new ChatProcessingError(metadata.errorType || null);
}
