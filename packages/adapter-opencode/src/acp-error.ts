/**
 * Protocol error raised at the IntentSmith boundary.
 *
 * The ACP lifecycle itself is handled by `@agentclientprotocol/sdk` (ADR 0016).
 * This type covers the checks IntentSmith keeps for itself: stream framing,
 * session ownership, stop-reason validation and terminal-event ordering.
 */
export class AcpProtocolError extends Error {
  readonly code = 'ACP_PROTOCOL_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'AcpProtocolError';
  }
}

/** Protocol version IntentSmith implements. Matches the SDK's PROTOCOL_VERSION. */
export const ACP_PROTOCOL_VERSION = 1;
