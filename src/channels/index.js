// C.3 Channel Adapter Layer
// ══════════════════════════════════════════════════════════════════════════════
//
// Entry point for Channel Adapter infrastructure.
// See: docs/channels/CHANNEL_ADAPTER_CONTRACT.md
//
// ══════════════════════════════════════════════════════════════════════════════

export {
  ChannelType,
  ContentType,
  ErrorSource,
  ChannelCapabilities,
  C3InputEvent,
  C3OutputEvent,
  C3ErrorEvent,
} from './types.js';

// Adapters
export { CLIAdapter } from './cli-adapter.js';
