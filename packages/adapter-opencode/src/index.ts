/**
 * OpenCode worker adapter.
 *
 * Depends on `@intentsmith/worker-sdk` and `@intentsmith/process-runtime` only.
 * Nothing here reaches Core, persistence or the server.
 *
 * Test fixtures live in `./fixtures.js` and are not re-exported, so the fake
 * agent script can never ship in the production surface.
 */
export { ACP_PROTOCOL_VERSION, AcpProtocolError } from './acp-error.js';
export {
  DEFAULT_STREAM_LIMITS,
  createStrictAcpStream,
  type StreamLimits,
  type StreamViolation,
  type StrictStream,
  type StrictStreamOptions,
} from './strict-stream.js';
export {
  SUPPORTED_STOP_REASONS,
  outcomeForStopReason,
  parsePromptResponse,
  type StopReason,
  type TurnOutcome,
} from './stop-reason.js';
export {
  OpenCodeWorker,
  type OpenCodeAdapterOptions,
  type PermissionDecision,
  type ToolProposal,
} from './adapter.js';
export {
  GATEWAY_TOKEN_ENV,
  PROVIDER_ID,
  assertConfigHasNoDirectInference,
  buildOpenCodeConfig,
  createOpenCodeRuntime,
  type GeneratedRuntime,
  type OpenCodeRuntimeOptions,
} from './runtime-config.js';
