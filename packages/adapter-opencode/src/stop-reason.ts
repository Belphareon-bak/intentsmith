import { AcpProtocolError } from './acp.js';

/**
 * ACP prompt-turn stop reasons.
 *
 * Only `end_turn` means the agent finished the work it was asked to do.
 * Everything else is a non-success outcome and must never be presented as one:
 * a refusal and a token-limit truncation both end the turn, and both leave the
 * task unfinished.
 */
export const SUPPORTED_STOP_REASONS = [
  'end_turn',
  'max_tokens',
  'max_turn_requests',
  'refusal',
  'cancelled',
] as const;

export type StopReason = (typeof SUPPORTED_STOP_REASONS)[number];

export type TurnOutcome =
  | { kind: 'completed'; stopReason: 'end_turn' }
  | { kind: 'cancelled'; stopReason: 'cancelled' }
  | { kind: 'failed'; stopReason: StopReason; code: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a `session/prompt` response at runtime.
 *
 * An unknown stop reason is a protocol error rather than something to guess at.
 * Treating an unrecognised value as success would be the single most dangerous
 * default here: a future ACP version could add a reason that means "I gave up",
 * and IntentSmith would report a pass.
 */
export function parsePromptResponse(response: unknown): StopReason {
  if (!isRecord(response)) {
    throw new AcpProtocolError('Agent returned a prompt response that is not an object.');
  }
  const stopReason = response.stopReason;
  if (typeof stopReason !== 'string') {
    throw new AcpProtocolError('Agent returned a prompt response without a stopReason.');
  }
  if (!(SUPPORTED_STOP_REASONS as readonly string[]).includes(stopReason)) {
    throw new AcpProtocolError(
      `Agent returned an unsupported stopReason "${stopReason}"; refusing to interpret it as success.`,
    );
  }
  return stopReason as StopReason;
}

/** Maps a stop reason onto exactly one terminal worker outcome. */
export function outcomeForStopReason(stopReason: StopReason): TurnOutcome {
  switch (stopReason) {
    case 'end_turn':
      return { kind: 'completed', stopReason };
    case 'cancelled':
      return { kind: 'cancelled', stopReason };
    case 'refusal':
      return {
        kind: 'failed',
        stopReason,
        code: 'WORKER_REFUSED',
        message: 'The agent refused the request; no work was completed.',
      };
    case 'max_tokens':
      return {
        kind: 'failed',
        stopReason,
        code: 'WORKER_OUTPUT_TRUNCATED',
        message: 'The agent hit its token limit before finishing; the result is incomplete.',
      };
    case 'max_turn_requests':
      return {
        kind: 'failed',
        stopReason,
        code: 'WORKER_TURN_LIMIT',
        message: 'The agent hit its turn-request limit before finishing; the result is incomplete.',
      };
  }
}
