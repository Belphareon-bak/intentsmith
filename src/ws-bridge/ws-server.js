// C3 WS Bridge — WebSocket Server
// ══════════════════════════════════════════════════════════════════════════════
//
// v59.0 — Attaches a WebSocket server to an existing HTTP server.
//
// Usage (in server.js):
//   import { attachWebSocketServer } from './ws-bridge/index.js';
//   const wss = attachWebSocketServer(httpServer, ChatController, logger);
//
// Protocol:
//   1. Client connects to ws://host:port/c3/ws
//   2. Client sends { type: 'hello', protocolVersion: 1, ideVersion: '...' }
//   3. Server replies hello_ack or hello_reject
//   4. Post-handshake: channeled messages { channel: 'chat'|'control'|'terminal', data: {...} }
//
// ══════════════════════════════════════════════════════════════════════════════

import { WebSocketServer } from 'ws';
import {
  PROTOCOL_VERSION,
  buildHelloAck,
  buildHelloReject,
} from './protocol.js';
import { createSessionAdapter } from './session-adapter.js';

/**
 * Attach a C3 WebSocket server to an existing HTTP server.
 *
 * @param {import('http').Server} httpServer — Existing Express/Node HTTP server
 * @param {Object} chatController — ChatController module (must have .handle(request))
 * @param {Object} logger — Logger instance with .info(), .warn(), .error()
 * @param {Object} [options]
 * @param {string} [options.path='/c3/ws'] — WebSocket endpoint path
 * @returns {WebSocketServer}
 */
export function attachWebSocketServer(httpServer, chatController, logger, options = {}) {
  const wsPath = options.path || '/c3/ws';

  const wss = new WebSocketServer({
    server: httpServer,
    path: wsPath,
  });

  logger.info('WSBridge', `WebSocket server attached at ${wsPath}`);

  wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    let handshakeDone = false;
    let session = null;

    logger.info('WSBridge', 'New connection', { ip: clientIP });

    // ─── Safe send wrapper ────────────────────────────────────────

    function safeSend(jsonString) {
      if (ws.readyState === 1 /* OPEN */) {
        ws.send(jsonString);
      }
    }

    // ─── Message handler ──────────────────────────────────────────

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (err) {
        logger.error('WSBridge', 'Failed to parse message', { error: err.message });
        return;
      }

      // ═══ Handshake phase ════════════════════════════════════════
      if (!handshakeDone) {
        if (msg.type === 'hello') {
          if (msg.protocolVersion !== PROTOCOL_VERSION) {
            safeSend(buildHelloReject(
              `Backend protocol v${PROTOCOL_VERSION} — IDE sent v${msg.protocolVersion}. Aktualizujte IDE.`,
            ));
            ws.close(4001, 'Protocol mismatch');
            return;
          }

          safeSend(buildHelloAck());
          handshakeDone = true;

          logger.info('WSBridge', 'Handshake OK', {
            ideVersion: msg.ideVersion,
            ip: clientIP,
          });

          // Create session adapter bound to this connection
          session = createSessionAdapter({
            send: safeSend,
            handleRequest: (request) => chatController.handle(request),
            logger,
          });

          // Send initial status
          session.sendStatus();
          return;
        }

        // Non-hello before handshake → reject
        logger.warn('WSBridge', 'Message before handshake', { type: msg.type });
        return;
      }

      // ═══ Post-handshake routing ═════════════════════════════════
      if (!session) return;

      switch (msg.channel) {
        case 'chat':
          session.processChat(msg.data?.content);
          break;

        case 'control':
          session.handleControl(msg.data || {});
          break;

        case 'terminal':
          session.handleTerminal(msg.data || {});
          break;

        default:
          logger.warn('WSBridge', `Unknown channel: ${msg.channel}`);
      }
    });

    // ─── Connection lifecycle ─────────────────────────────────────

    ws.on('close', (code, reason) => {
      if (session) {
        session.cleanup();
      }
      logger.info('WSBridge', 'Client disconnected', {
        code,
        reason: reason?.toString(),
        ip: clientIP,
      });
    });

    ws.on('error', (err) => {
      logger.error('WSBridge', 'Connection error', {
        error: err.message,
        ip: clientIP,
      });
    });
  });

  // ─── Server-level events ────────────────────────────────────────

  wss.on('error', (err) => {
    logger.error('WSBridge', `Server error: ${err.message}`);
  });

  return wss;
}
