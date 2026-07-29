import type { ChatMessage, ProviderErrorCode } from '@intentsmith/inference';

/**
 * Evidence available before one model attempt.
 *
 * A tool result means a prior call may already have changed the world.
 * An unmatched assistant call is ambiguous: the worker may have executed it
 * and failed before reporting the result. Only a transcript with no tool turn
 * at all proves absence strongly enough for the single protocol retry.
 */
export type SideEffectEvidence = 'proven_absent' | 'consumed' | 'ambiguous' | 'missing';

export type ProtocolRetryDecision = {
  retry: boolean;
  reason: string;
};

export type ToolProtocolAttemptAudit = {
  runId: string;
  attempt: 1 | 2;
  sideEffectEvidence: SideEffectEvidence;
  outcome: 'success' | 'error';
  errorCode?: string;
  retryDecision: 'allowed' | 'refused' | 'not_applicable';
  reason: string;
};

export function classifySideEffectEvidence(messages: readonly ChatMessage[]): SideEffectEvidence {
  if (messages.length === 0) return 'missing';
  if (messages.some(message => message.role === 'tool')) return 'consumed';
  if (messages.some(message => message.role === 'assistant' && (message.toolCalls?.length ?? 0) > 0)) {
    return 'ambiguous';
  }
  return 'proven_absent';
}

/**
 * Decides only the MODEL_TOOL_PROTOCOL_ERROR exception.
 *
 * This is deliberately not a generic retry policy. Transport errors,
 * cancellation, timeouts, denials and every other worker/provider failure are
 * terminal here, regardless of their own `retryable` flag.
 */
export function decideToolProtocolRetry(input: {
  attempt: 1 | 2;
  errorCode: ProviderErrorCode | string;
  sideEffectEvidence: SideEffectEvidence;
}): ProtocolRetryDecision {
  if (input.errorCode !== 'MODEL_TOOL_PROTOCOL_ERROR') {
    return {
      retry: false,
      reason: `Retry refused: ${input.errorCode} is not MODEL_TOOL_PROTOCOL_ERROR.`,
    };
  }
  if (input.attempt === 2) {
    return {
      retry: false,
      reason: 'Retry refused: the one permitted protocol retry was already consumed.',
    };
  }
  if (input.sideEffectEvidence !== 'proven_absent') {
    return {
      retry: false,
      reason: `Retry refused: side-effect evidence is ${input.sideEffectEvidence}, not proven_absent.`,
    };
  }
  return {
    retry: true,
    reason: 'Retry allowed once: the attempt ledger proves no tool turn or side effect was consumed.',
  };
}
