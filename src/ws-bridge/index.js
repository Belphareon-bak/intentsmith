// C3 WS Bridge — Public API
// ══════════════════════════════════════════════════════════════════════════════
//
// v59.0 — IDE ↔ Backend WebSocket bridge
//
// Usage:
//   import { attachWebSocketServer } from './ws-bridge/index.js';
//   const wss = attachWebSocketServer(httpServer, ChatController, logger, {
//     allowedOrigins,
//     localCapability,
//   });
//
// ══════════════════════════════════════════════════════════════════════════════

export { attachWebSocketServer, broadcast } from './ws-server.js';
export { createSessionAdapter } from './session-adapter.js';
export {
  PROTOCOL_VERSION,
  BACKEND_VERSION,
  M1_WIRE_FEATURE,
  Channel,
  AgentEventType,
  buildChannelMessage,
  buildAgentEvent,
  buildHelloAck,
  buildHelloAckFromNegotiatedFeatures,
  buildHelloReject,
  messageId,
  negotiateFeatures,
} from './protocol.js';
