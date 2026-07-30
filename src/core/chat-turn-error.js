// Terminal chat failures that must not be represented as assistant responses.

export const ChatTurnErrorCode = Object.freeze({
  LLM_PROVIDER_UNAVAILABLE: 'LLM_PROVIDER_UNAVAILABLE',
  CHAT_PROCESSING_FAILED: 'CHAT_PROCESSING_FAILED',
});

export const ChatTurnErrorMessage = Object.freeze({
  LLM_PROVIDER_UNAVAILABLE: 'Model provider is temporarily unavailable.',
  CHAT_PROCESSING_FAILED: 'Chat processing failed.',
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
  }) {
    super(message);
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
  constructor(sourceErrorType = null) {
    super(ChatTurnErrorMessage.CHAT_PROCESSING_FAILED, {
      code: ChatTurnErrorCode.CHAT_PROCESSING_FAILED,
      statusCode: 500,
      recoverable: false,
      sourceErrorType,
    });
    this.name = 'ChatProcessingError';
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
