// C3 WS Bridge — Public API
// ══════════════════════════════════════════════════════════════════════════════
//
// v59.0 — IDE ↔ Backend WebSocket bridge
//
// Usage:
//   import { attachWebSocketServer } from './ws-bridge/index.js';
//   const wss = attachWebSocketServer(httpServer, ChatController, logger);
//
// ══════════════════════════════════════════════════════════════════════════════

export { attachWebSocketServer, broadcast } from './ws-server.js';
export { createSessionAdapter } from './session-adapter.js';
export {
  PROTOCOL_VERSION,
  BACKEND_VERSION,
  Channel,
  AgentEventType,
  buildChannelMessage,
  buildAgentEvent,
  buildHelloAck,
  buildHelloReject,
  messageId,
} from './protocol.js';
