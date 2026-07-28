/**
 * OpenCode worker adapter.
 *
 * Depends on `@intentsmith/worker-sdk` and `@intentsmith/process-runtime` only.
 * Nothing here reaches Core, persistence or the server.
 *
 * Test fixtures live in `./fixtures.js` and are not re-exported, so the fake
 * agent script can never ship in the production surface.
 */
export {
  ACP_PROTOCOL_VERSION,
  AcpClient,
  AcpProtocolError,
  LineBuffer,
  parseInbound,
  type AcpInbound,
  type AcpNotification,
  type AcpRequest,
  type AcpResponse,
  type AcpTransport,
} from './acp.js';
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
