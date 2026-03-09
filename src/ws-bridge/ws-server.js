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
import { watchProject, unwatchProject } from './file-watcher.js';

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
    let activeWatchPath = null; // F2: file watcher lifecycle

    function startWatching(projectPath) {
      if (!projectPath || activeWatchPath === projectPath) return;
      if (activeWatchPath) unwatchProject(activeWatchPath);
      activeWatchPath = projectPath;
      watchProject(projectPath, (events) => {
        safeSend(JSON.stringify({
          channel: 'workspace',
          data: { type: 'file_batch', events },
        }));
      });
      logger.info('WSBridge', `Watching: ${projectPath}`, { ip: clientIP });
    }

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

          const clientFeatures = Array.isArray(msg.features) ? msg.features : [];
          safeSend(buildHelloAck(clientFeatures));
          handshakeDone = true;

          logger.info('WSBridge', 'Handshake OK', {
            ideVersion: msg.ideVersion,
            features: clientFeatures,
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

          // F2: Start file watcher if workspace feature negotiated
          if (clientFeatures.includes('workspace') && options.projectPath) {
            startWatching(options.projectPath);
          }
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
          session.processChat(msg.data?.content, {
            editMode: msg.data?.editMode,
            conversationId: msg.data?.conversationId,
            agentId: msg.data?.agentId,
            projectId: msg.data?.projectId,
            attachments: msg.data?.attachments || [],
          });
          break;

        case 'control':
          if (msg.data?.action === 'rehydrate') {
            // IDE reconnected — validate conversation IDs
            const convIds = msg.data.conversationIds || [];
            logger.info('WSBridge', 'Rehydrate request', { conversationIds: convIds });
            // For now, acknowledge all — full DB validation in Phase 1.2
            safeSend(JSON.stringify({
              channel: 'control',
              data: { action: 'rehydrate_ack', validIds: convIds }
            }));
          } else if (msg.data?.action === 'edit_approve' || msg.data?.action === 'edit_reject') {
            // Edit ACK from IDE
            logger.info('WSBridge', `Edit ${msg.data.action}`, { requestId: msg.data.requestId });
            session.handleControl(msg.data);
          } else {
            session.handleControl(msg.data || {});
          }
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
      // F2: Stop file watcher on disconnect
      if (activeWatchPath) {
        unwatchProject(activeWatchPath);
        activeWatchPath = null;
      }
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

  _wss = wss;
  return wss;
}

// ─── Broadcast (v103.1) ──────────────────────────────────────────────────

let _wss = null;

/**
 * Broadcast a message to all connected WS clients.
 * @param {string} channel - Protocol channel ('control', 'chat', etc.)
 * @param {Object} data - Message payload
 */
export function broadcast(channel, data) {
  if (!_wss) return;
  const msg = JSON.stringify({ channel, data });
  for (const client of _wss.clients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}
