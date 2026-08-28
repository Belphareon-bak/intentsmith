// Terminal chat failures that must not be represented as assistant responses.

export const ChatTurnErrorCode = Object.freeze({
  LLM_PROVIDER_UNAVAILABLE: 'LLM_PROVIDER_UNAVAILABLE',
  CHAT_PROCESSING_FAILED: 'CHAT_PROCESSING_FAILED',
  CHAT_PERSISTENCE_FAILED: 'CHAT_PERSISTENCE_FAILED',
  MODEL_RESPONSE_TRUNCATED: 'MODEL_RESPONSE_TRUNCATED',
  M2_EFFECT_AUTHORITY_REQUIRED: 'M2_EFFECT_AUTHORITY_REQUIRED',
});

export const ChatTurnErrorMessage = Object.freeze({
  LLM_PROVIDER_UNAVAILABLE: 'Model provider is temporarily unavailable.',
  CHAT_PROCESSING_FAILED: 'Chat processing failed.',
  CHAT_PERSISTENCE_FAILED: 'Chat response could not be persisted.',
  MODEL_RESPONSE_TRUNCATED: 'Model response was incomplete and was not saved.',
  M2_EFFECT_AUTHORITY_REQUIRED: 'This write requires M2 effect authority.',
});

const PROVIDER_FAILURE_TYPES = new Set([
  'LLM_CALL_FAILED',
  'EXPERT_LLM_FAILED',
  'DESIGN_LLM_FAILED',
  'DESIGN_CONTINUE_FAILED',
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
  if (metadata?.error !== true) return;

  if (PROVIDER_FAILURE_TYPES.has(metadata.errorType)) {
    throw new LLMProviderUnavailableError(metadata.errorType);
  }
  throw new ChatProcessingError(metadata.errorType || null);
}
