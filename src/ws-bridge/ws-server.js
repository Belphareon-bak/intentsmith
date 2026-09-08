// C3 WS Bridge — WebSocket Server
// ══════════════════════════════════════════════════════════════════════════════
//
// v59.0 — Attaches a WebSocket server to an existing HTTP server.
//
// Usage (in server.js):
//   import { attachWebSocketServer } from './ws-bridge/index.js';
//   const wss = attachWebSocketServer(httpServer, ChatController, logger, {
//     allowedOrigins,
//     localCapability,
//   });
//
// Protocol:
//   1. Client connects to ws://host:port/c3/ws
//   2. Client sends { type: 'hello', protocolVersion: 1, ideVersion: '...' }
//   3. Server replies hello_ack or hello_reject
//   4. Post-handshake: channeled messages { channel: 'chat'|'control'|'terminal', data: {...} }
//
// ══════════════════════════════════════════════════════════════════════════════

import { WebSocketServer } from 'ws';
import { createM1AttachmentLimits } from './m1-attachment-policy.js';
import { config } from '../config.js';
import {
  M1_WIRE_FEATURE,
  PROTOCOL_VERSION,
  buildHelloAckFromNegotiatedFeatures,
  buildHelloReject,
  negotiateFeatures,
} from './protocol.js';
import {
  createSessionAdapter,
  validateM1StudioFrame,
} from './session-adapter.js';
import { watchProject, unwatchProject } from './file-watcher.js';
import { getConversationStore } from '../chat/conversation-store.js';
import { isIdentifier } from '../../contracts/m1/shared.js';
import {
  evaluateLegacyLocalAccess,
  isValidLegacyLocalCapability,
  parseLegacyLocalWebSocketCapability,
} from '../security/legacy-local-access-policy.js';
import {
  RouteAuthClass,
  createGlobalAuthAuthority,
} from '../security/global-auth-policy.js';

const WS_OPEN = 1;
const DROP_LOG_INTERVAL = 10;
const MAX_REHYDRATE_CONVERSATIONS = 32;
const RehydrateValidationStatus = Object.freeze({
  ACK: 'ack',
  REJECT: 'reject',
  UNAVAILABLE: 'unavailable',
});
const RehydrateRejectReason = Object.freeze({
  INVALID_CONVERSATION_SET: 'INVALID_CONVERSATION_SET',
  TOO_MANY_CONVERSATIONS: 'TOO_MANY_CONVERSATIONS',
  INVALID_CONVERSATION_ID: 'INVALID_CONVERSATION_ID',
  DUPLICATE_CONVERSATION_ID: 'DUPLICATE_CONVERSATION_ID',
});
const _wsStats = {
  droppedMessages: 0,
};

function isM1ChatFrameCandidate(message) {
  if (message?.channel !== 'chat'
    || message.data === null
    || typeof message.data !== 'object'
    || Array.isArray(message.data)) {
    return false;
  }
  return Object.hasOwn(message.data, 'command')
    || Object.hasOwn(message.data, 'context');
}

let _wss = null;
let _bridgeLogger = console;

function createLegacyWebSocketVerifyClient({
  httpServer,
  allowedOrigins,
  localCapability,
  authAuthority,
  logger,
}) {
  if (!authAuthority || typeof authAuthority.authorize !== 'function') {
    throw new TypeError('WSBridge requires the bootstrap global auth authority');
  }
  return (info, done) => {
    const address = httpServer.address();
    const expectedPort = typeof address === 'object' && address
      ? address.port
      : null;
    const presentedLocalCredential = parseLegacyLocalWebSocketCapability(
      info.req?.headers?.['sec-websocket-protocol'],
    );
    const access = evaluateLegacyLocalAccess({
      host: info.req?.headers?.host,
      expectedPort,
      remoteAddress: info.req?.socket?.remoteAddress,
      origin: info.origin,
      allowedOrigins,
      expectedCapability: localCapability,
      presentedCapability: presentedLocalCredential.state === 'valid'
        ? presentedLocalCredential.token
        : undefined,
      fetchSite: info.req?.headers?.['sec-fetch-site'],
    });

    if (!access.allowed) {
      logger.warn('WSBridge', 'Rejected local WebSocket upgrade', {
        reason: access.reasonCode,
        ip: info.req?.socket?.remoteAddress,
      });
      done(false, 403, 'Forbidden');
      return;
    }

    const authorization = authAuthority.authorize({
      routeKey: 'WS /c3/ws',
      routeClass: RouteAuthClass.MUTATE,
      headers: info.req?.headers ?? {},
      remoteAddress: info.req?.socket?.remoteAddress,
      websocketProtocols: info.req?.headers?.['sec-websocket-protocol'],
      websocketLocalCredential: presentedLocalCredential,
    });
    if (!authorization.allowed) {
      logger.warn('WSBridge', 'Rejected unauthenticated WebSocket upgrade', {
        reason: authorization.code,
        ip: info.req?.socket?.remoteAddress,
      });
      done(false, authorization.status, 'Unauthorized');
      return;
    }
    info.req.authenticatedSubject = authorization.subject;
    info.req.authenticatedCredentialType = authorization.credentialType;
    done(true);
  };
}

function recordDroppedMessage(logger, meta = {}) {
  const targetLogger = logger && typeof logger.warn === 'function' ? logger : _bridgeLogger;
  _wsStats.droppedMessages++;
  if (_wsStats.droppedMessages % DROP_LOG_INTERVAL === 0) {
    targetLogger.warn('WSBridge', `Dropped ${_wsStats.droppedMessages} websocket message(s)`, meta);
  }
}

function validateRehydrateConversationIds(candidateIds, store) {
  if (!Array.isArray(candidateIds)) {
    return {
      status: RehydrateValidationStatus.REJECT,
      reason: RehydrateRejectReason.INVALID_CONVERSATION_SET,
    };
  }
  if (candidateIds.length > MAX_REHYDRATE_CONVERSATIONS) {
    return {
      status: RehydrateValidationStatus.REJECT,
      reason: RehydrateRejectReason.TOO_MANY_CONVERSATIONS,
    };
  }

  const seen = new Set();
  for (const candidate of candidateIds) {
    if (typeof candidate !== 'string' || !isIdentifier(candidate)) {
      return {
        status: RehydrateValidationStatus.REJECT,
        reason: RehydrateRejectReason.INVALID_CONVERSATION_ID,
      };
    }
    if (seen.has(candidate)) {
      return {
        status: RehydrateValidationStatus.REJECT,
        reason: RehydrateRejectReason.DUPLICATE_CONVERSATION_ID,
      };
    }
    seen.add(candidate);
  }

  try {
    if (
      !store
      || typeof store.isDurableReady !== 'function'
      || store.isDurableReady() !== true
      || typeof store.exists !== 'function'
    ) {
      return { status: RehydrateValidationStatus.UNAVAILABLE };
    }
  } catch {
    return { status: RehydrateValidationStatus.UNAVAILABLE };
  }

  const validIds = [];
  const invalidIds = [];
  for (const candidate of candidateIds) {
    try {
      const exists = store.exists(candidate);
      if (exists === true) validIds.push(candidate);
      else if (exists === false) invalidIds.push(candidate);
      else return { status: RehydrateValidationStatus.UNAVAILABLE };
    } catch {
      // Never publish a partial authoritative ACK: the client could erase a
      // locally cached conversation whose DB lookup only failed transiently.
      return { status: RehydrateValidationStatus.UNAVAILABLE };
    }
  }
  return {
    status: RehydrateValidationStatus.ACK,
    complete: true,
    validIds,
    invalidIds,
  };
}

export function getWebSocketBridgeHealth() {
  return {
    droppedMessages: _wsStats.droppedMessages,
    connectedClients: _wss?.clients?.size || 0,
  };
}

/**
 * Attach a C3 WebSocket server to an existing HTTP server.
 *
 * @param {import('http').Server} httpServer — Existing Express/Node HTTP server
 * @param {Object} chatController — ChatController module (must have .handle(request))
 * @param {Object} logger — Logger instance with .info(), .warn(), .error()
 * @param {Object} [options]
 * @param {string} [options.path='/c3/ws'] — WebSocket endpoint path
 * @param {string[]} [options.allowedOrigins=[]] — Explicit local browser origins
 * @param {string} options.localCapability — Per-process opaque-origin capability
 * @param {string} [options.adminToken] — Runtime admin credential; never logged
 * @param {(token:string)=>Object} [options.validateApiToken] — Scoped token reader
 * @param {boolean} [options.production] — Explicit production auth semantics
 * @param {boolean} [options.m1WireSupported=false] — Explicit activation seam;
 *   production opts in only after the B4 behavior gate passes.
 * @returns {WebSocketServer}
 */
export function attachWebSocketServer(httpServer, chatController, logger, options = {}) {
  const wsPath = options.path || '/c3/ws';
  const m1WireSupported = options.m1WireSupported === true;
  _bridgeLogger = logger || console;
  if (!isValidLegacyLocalCapability(options.localCapability)) {
    throw new Error('WSBridge requires a valid local browser capability');
  }

  const wss = new WebSocketServer({
    server: httpServer,
    path: wsPath,
    // Decision 021/R1-B: the project had no payload ceiling at all, so the
    // library default was the only bound. The frame ceiling comes from the same
    // named seam as the attachment limits it has to contain.
    maxPayload: createM1AttachmentLimits(config.limits || {}).maxFrameBytes,
    verifyClient: createLegacyWebSocketVerifyClient({
      httpServer,
      allowedOrigins: options.allowedOrigins || [],
      localCapability: options.localCapability,
      authAuthority: options.authAuthority ?? createGlobalAuthAuthority({
        localCapability: options.localCapability,
        adminToken: options.adminToken,
        validateApiToken: options.validateApiToken,
        production: options.production ?? process.env.NODE_ENV === 'production',
      }),
      logger,
    }),
  });

  logger.info('WSBridge', `WebSocket server attached at ${wsPath}`);

  wss.on('connection', (ws, req) => {
    const clientIP = req.socket.remoteAddress;
    const authenticatedSubject = req.authenticatedSubject;
    if (
      authenticatedSubject?.actorType !== 'user'
      || typeof authenticatedSubject.actorId !== 'string'
      || authenticatedSubject.actorId.length === 0
    ) {
      logger.error('WSBridge', 'Verified connection is missing authenticated subject');
      ws.close(1008, 'Authenticated subject required');
      return;
    }
    let handshakeDone = false;
    let negotiatedFeatures = Object.freeze([]);
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
      if (ws.readyState !== WS_OPEN) {
        recordDroppedMessage(_bridgeLogger, { reason: 'socket_not_open', ip: clientIP });
        return false;
      }
      try {
        ws.send(jsonString);
        return true;
      } catch (err) {
        recordDroppedMessage(_bridgeLogger, {
          reason: 'send_failed',
          error: err.message,
          ip: clientIP,
        });
        return false;
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
          negotiatedFeatures = Object.freeze(negotiateFeatures(clientFeatures, {
            m1WireSupported,
          }));
          safeSend(buildHelloAckFromNegotiatedFeatures(negotiatedFeatures));
          handshakeDone = true;

          logger.info('WSBridge', 'Handshake OK', {
            ideVersion: msg.ideVersion,
            requestedFeatures: clientFeatures,
            negotiatedFeatures,
            ip: clientIP,
          });

          // Create session adapter bound to this connection
          session = createSessionAdapter({
            send: safeSend,
            handleRequest: (request) => chatController.handle(request),
            logger,
            // The subject is minted by the global upgrade guard. Message body
            // fields cannot manufacture or replace transport authority.
            authenticatedSubject,
            observeCoreEvent: options.observeCoreEvent ?? null,
          });

          // Send initial status
          session.sendStatus();

          // F2: Start file watcher if workspace feature negotiated
          if (negotiatedFeatures.includes('workspace') && options.projectPath) {
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

      const m1WireNegotiated = negotiatedFeatures.includes(M1_WIRE_FEATURE);
      if (msg.channel === 'chat' && m1WireNegotiated) {
        const validation = validateM1StudioFrame(msg.data);
        if (!validation.valid) {
          logger.warn('WSBridge', 'Rejected malformed negotiated M1 frame', {
            errors: validation.errors,
            ip: clientIP,
          });
          ws.close(1008, 'Invalid M1 chat frame');
          return;
        }
        session.processM1Command(msg.data).catch(error => {
          logger.error('WSBridge', 'M1 session adapter failed', {
            error: error.message,
            code: error.code || null,
            ip: clientIP,
          });
          if (error.code === 'M1_WS_CANCEL_IDENTITY_CONFLICT') {
            ws.close(1008, 'Invalid M1 command identity');
          } else {
            ws.close(1011, 'M1 wire adapter failure');
          }
        });
        return;
      }

      if (isM1ChatFrameCandidate(msg)) {
        if (!m1WireNegotiated) {
          logger.warn('WSBridge', 'Rejected M1 chat frame without negotiation', {
            ip: clientIP,
          });
          ws.close(1008, 'M1 wire not negotiated');
          return;
        }
      }

      if (m1WireNegotiated && msg.channel === 'control' && msg.data?.action === 'cancel') {
        logger.warn('WSBridge', 'Rejected legacy cancel on negotiated M1 session', {
          ip: clientIP,
        });
        ws.close(1008, 'Legacy cancel forbidden on M1 wire');
        return;
      }

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
            // IDE reconnected — validate the complete bounded identity set.
            const rehydrateRequestId = msg.data.rehydrateRequestId;
            if (!isIdentifier(rehydrateRequestId)) {
              logger.warn('WSBridge', 'Rejected malformed rehydrate request id');
              ws.close(1008, 'Invalid rehydrate request id');
              return;
            }
            const convIds = msg.data.conversationIds;
            const validation = validateRehydrateConversationIds(
              convIds,
              getConversationStore(),
            );
            if (validation.status === RehydrateValidationStatus.UNAVAILABLE) {
              logger.warn('WSBridge', 'Rehydrate validation unavailable', {
                requestedCount: Array.isArray(convIds) ? convIds.length : null,
              });
              ws.close(1011, 'Rehydrate validation unavailable');
              return;
            }
            if (validation.status === RehydrateValidationStatus.REJECT) {
              logger.warn('WSBridge', 'Rejected malformed rehydrate identity set', {
                reason: validation.reason,
                requestedCount: Array.isArray(convIds) ? convIds.length : null,
              });
              safeSend(JSON.stringify({
                channel: 'control',
                data: {
                  action: 'rehydrate_reject',
                  rehydrateRequestId,
                  reason: validation.reason,
                },
              }));
              return;
            }
            const { validIds, invalidIds } = validation;
            logger.info('WSBridge', 'Rehydrate request validated', {
              examinedCount: convIds.length,
              validCount: validIds.length,
              invalidCount: invalidIds.length,
            });
            safeSend(JSON.stringify({
              channel: 'control',
              data: {
                action: 'rehydrate_ack',
                rehydrateRequestId,
                complete: true,
                validIds,
                invalidIds,
              },
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

/**
 * Broadcast a message to all connected WS clients.
 * @param {string} channel - Protocol channel ('control', 'chat', etc.)
 * @param {Object} data - Message payload
 */
export function broadcast(channel, data) {
  if (!_wss) return;
  const msg = JSON.stringify({ channel, data });
  for (const client of _wss.clients) {
    if (client.readyState !== WS_OPEN) {
      recordDroppedMessage(_bridgeLogger, { reason: 'client_not_open', channel });
      continue;
    }
    try {
      client.send(msg);
    } catch (err) {
      recordDroppedMessage(_bridgeLogger, {
        reason: 'broadcast_failed',
        channel,
        error: err.message,
      });
    }
  }
}

export const _testInternals = {
  createLegacyWebSocketVerifyClient,
  isM1ChatFrameCandidate,
  recordDroppedMessage,
  RehydrateRejectReason,
  RehydrateValidationStatus,
  validateRehydrateConversationIds,
  resetBridgeState() {
    _wsStats.droppedMessages = 0;
    _wss = null;
    _bridgeLogger = console;
  },
};
