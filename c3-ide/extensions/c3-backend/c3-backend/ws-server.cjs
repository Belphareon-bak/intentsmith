/**
 * C3 Backend — WebSocket Server
 *
 * Integrates with existing Express server. Add to your c3-backend entry point:
 *
 *   const { createC3WebSocketServer } = require('./ws-server');
 *   createC3WebSocketServer(httpServer, conversationHandler, logger);
 *
 * Implements:
 * - Protocol versioning handshake (hello/hello_ack/hello_reject)
 * - Turn lifecycle (turn_start / turn_end)
 * - Agent event routing (CRE, tools, gate, LLM)
 * - Monotonic seq counter (agent panel sorts by seq, not timestamp)
 * - Cancel support
 * - Agent execution model: max 1 concurrent turn
 */

const { WebSocketServer } = require('ws');

const PROTOCOL_VERSION = 1;
const BACKEND_VERSION = '58.3';

/**
 * Create and attach C3 WebSocket server to existing HTTP server.
 *
 * @param {import('http').Server} httpServer — existing Express server
 * @param {object} conversationHandler — your existing C3 conversation handler
 * @param {object} logger — your existing C3 logger
 * @returns {WebSocketServer}
 */
function createC3WebSocketServer(httpServer, conversationHandler, logger) {
  const wss = new WebSocketServer({ server: httpServer, path: '/c3/ws' });

  wss.on('connection', (ws, req) => {
    const session = createSession(ws, conversationHandler, logger);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        session.handleMessage(msg);
      } catch (err) {
        logger.error('WS', 'Failed to parse message', { error: err.message });
      }
    });

    ws.on('close', () => {
      session.cleanup();
    });

    ws.on('error', (err) => {
      logger.error('WS', 'Connection error', { error: err.message });
    });
  });

  return wss;
}

/**
 * Per-connection session state.
 */
function createSession(ws, conversationHandler, logger) {
  let seq = 0;
  let turnCounter = 0;
  let currentTurnId = null;
  let handshakeDone = false;
  let abortController = null;

  // Subscriptions to logger events (cleaned up on disconnect)
  const subscriptions = [];

  // ─── Send helpers ──────────────────────────────────────

  function send(channel, data) {
    if (ws.readyState !== 1 /* OPEN */) return;
    ws.send(JSON.stringify({ channel, data }));
  }

  function sendAgentEvent(type, turnId, payload) {
    send('agent', {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      seq: ++seq,
      turnId,
      type,
      timestamp: new Date().toISOString(),
      payload,
    });
  }

  // ─── Message handler ───────────────────────────────────

  function handleMessage(msg) {
    // Handshake phase
    if (!handshakeDone) {
      // Accept both flat { type: 'hello' } and wrapped { channel: 'handshake', data: { type: 'hello' } }
      const helloData = (msg.channel === 'handshake' && msg.data) ? msg.data : msg;
      if (helloData.type === 'hello') {
        const protoVer = helloData.protocol_version ?? helloData.protocolVersion;
        if (protoVer !== PROTOCOL_VERSION) {
          send('handshake', {
            type: 'hello_reject',
            reason: `Protocol mismatch — backend v${PROTOCOL_VERSION}, IDE sent v${protoVer}. Aktualizujte IDE.`,
            requiredProtocol: PROTOCOL_VERSION,
          });
          ws.close(4001, 'Protocol mismatch');
          return;
        }

        send('handshake', {
          type: 'hello_ack',
          protocol_version: PROTOCOL_VERSION,
          protocolVersion: PROTOCOL_VERSION,
          backend_version: BACKEND_VERSION,
          backendVersion: BACKEND_VERSION,
        });

        handshakeDone = true;
        logger.info('WS', 'Handshake OK', { ideVersion: helloData.ide_version || helloData.ideVersion });

        // Subscribe to logger events
        subscribeToLoggerEvents();

        // Send initial status
        sendStatus();
        return;
      }

      // Non-hello message before handshake → reject
      send('handshake', {
        type: 'hello_reject',
        reason: 'Complete handshake first — send hello before other messages.',
      });
      return;
    }

    // Post-handshake messages
    switch (msg.channel) {
      case 'chat':
        handleChatMessage(msg.data);
        break;

      case 'agent':
        // Agent channel: cancel, etc.
        if (msg.data?.type === 'cancel') {
          handleControl({ action: 'cancel' });
        }
        break;

      case 'control':
        handleControl(msg.data);
        break;
    }
  }

  // ─── Chat handling ─────────────────────────────────────

  async function handleChatMessage(data) {
    const content = data.content;
    if (!content || typeof content !== 'string') return;

    // Agent execution model: max 1 concurrent turn
    if (currentTurnId) {
      // Already executing — queue or reject
      send('chat', {
        id: `sys-${Date.now()}`,
        type: 'system',
        content: 'Agent právě zpracovává předchozí zprávu. Počkejte prosím.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Start new turn
    turnCounter++;
    currentTurnId = `t-${String(turnCounter).padStart(3, '0')}`;
    const turnId = currentTurnId;
    const turnStartTime = Date.now();

    abortController = new AbortController();

    sendAgentEvent('turn_start', turnId, { input: content });

    // Echo user message to chat channel
    send('chat', {
      id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: 'user',
      content,
      timestamp: new Date().toISOString(),
    });

    try {
      // Call existing conversation handler with event hooks
      const response = await conversationHandler.handle(content, {
        turnId,
        signal: abortController.signal,

        // CRE decision hook
        onCREDecision: (decision) => {
          sendAgentEvent('cre_decision', turnId, {
            intent: decision.intent,
            confidence: decision.confidence,
            input: content,
            actionType: decision.actionType,
            tools: decision.tools,
          });
        },

        // Tool call hook
        onToolCall: (tool, args) => {
          sendAgentEvent('tool_call', turnId, { tool, args });
        },

        // Tool result hook
        onToolResult: (tool, result) => {
          sendAgentEvent('tool_result', turnId, {
            tool,
            success: result.success,
            durationMs: result.durationMs,
            resultSummary: result.summary,
          });
        },

        // LLM start hook
        onLLMStart: (model, tokensIn) => {
          sendAgentEvent('llm_start', turnId, { model, tokensIn });
        },

        // LLM token hook (streaming)
        onLLMToken: (token) => {
          sendAgentEvent('llm_token', turnId, { token });
        },

        // LLM done hook
        onLLMDone: (tokensOut, durationMs) => {
          sendAgentEvent('llm_done', turnId, { tokensOut, durationMs });
        },

        // Gate verdict hook
        onGateVerdict: (verdict) => {
          sendAgentEvent('gate_verdict', turnId, verdict);
        },
      });

      // Send final response via chat channel
      const responseText = response.content || response.text;
      send('chat', {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'assistant',
        content: responseText,
        timestamp: new Date().toISOString(),
        metadata: {
          intent: response.intent,
          confidence: response.confidence,
          turnId,
        },
      });

      // Turn end — success
      const dur = Date.now() - turnStartTime;
      sendAgentEvent('turn_end', turnId, {
        status: 'ok',
        duration_ms: dur,
        durationMs: dur,
      });

    } catch (err) {
      const errDur = Date.now() - turnStartTime;
      if (err.name === 'AbortError') {
        sendAgentEvent('turn_end', turnId, {
          status: 'cancelled_by_user',
          duration_ms: errDur,
          durationMs: errDur,
        });
      } else if (err.message?.includes('timeout')) {
        sendAgentEvent('turn_end', turnId, {
          status: 'timeout',
          duration_ms: errDur,
          durationMs: errDur,
          error: err.message,
        });
        sendAgentEvent('error', turnId, {
          code: 'TIMEOUT',
          message: err.message,
          recoverable: true,
        });
      } else {
        sendAgentEvent('turn_end', turnId, {
          status: 'error',
          duration_ms: errDur,
          durationMs: errDur,
          error: err.message,
        });
        sendAgentEvent('error', turnId, {
          code: 'UNEXPECTED',
          message: err.message,
          recoverable: false,
        });
      }

      // Send error to chat
      send('chat', {
        id: `err-${Date.now()}`,
        type: 'system',
        content: err.name === 'AbortError'
          ? 'Zpracování zrušeno.'
          : `Chyba: ${err.message}`,
        timestamp: new Date().toISOString(),
      });

    } finally {
      currentTurnId = null;
      abortController = null;
      sendStatus();
    }
  }

  // ─── Control handling ──────────────────────────────────

  function handleControl(data) {
    switch (data.action) {
      case 'cancel':
        if (abortController) {
          abortController.abort();
          logger.info('WS', 'Execution cancelled by user');
        }
        send('control', { action: 'cancel', success: true });
        break;

      case 'ping':
        send('control', { action: 'pong', success: true });
        break;
    }
  }

  // ─── Logger event subscriptions ────────────────────────

  function subscribeToLoggerEvents() {
    // Hook into existing logger for events not emitted by conversation handler
    // (e.g., background tasks, system status changes)

    if (typeof logger.on === 'function') {
      const onStatusChange = (data) => {
        if (currentTurnId) {
          sendAgentEvent('status_change', currentTurnId, data);
        }
      };
      logger.on('statusChange', onStatusChange);
      subscriptions.push(() => logger.off('statusChange', onStatusChange));

      // Forward CRE, LLM, Gate events from logger (alternative to callback hooks)
      const onCRE = (data) => {
        if (currentTurnId) sendAgentEvent('cre_decision', currentTurnId, data);
      };
      const onLLMStart = (data) => {
        if (currentTurnId) sendAgentEvent('llm_start', currentTurnId, data);
      };
      const onLLMDone = (data) => {
        if (currentTurnId) sendAgentEvent('llm_done', currentTurnId, data);
      };
      const onGate = (data) => {
        if (currentTurnId) sendAgentEvent('gate_verdict', currentTurnId, data);
      };
      logger.on('CREDecision', onCRE);
      logger.on('LLMStart', onLLMStart);
      logger.on('LLMDone', onLLMDone);
      logger.on('GateVerdict', onGate);
      subscriptions.push(
        () => logger.off('CREDecision', onCRE),
        () => logger.off('LLMStart', onLLMStart),
        () => logger.off('LLMDone', onLLMDone),
        () => logger.off('GateVerdict', onGate),
      );
    }
  }

  // ─── Status ────────────────────────────────────────────

  function sendStatus() {
    const state = currentTurnId ? 'executing' : 'idle';
    send('status', {
      agentState: state,
      agentStatus: state,
      connected: true,
      backendVersion: BACKEND_VERSION,
      // TODO: add project info from persistent store
    });
  }

  // ─── Cleanup ───────────────────────────────────────────

  function cleanup() {
    // Cancel any running execution
    if (abortController) {
      abortController.abort();
    }

    // Unsubscribe from logger events
    for (const unsub of subscriptions) {
      try { unsub(); } catch { /* ignore */ }
    }
    subscriptions.length = 0;

    logger.info('WS', 'Client disconnected');
  }

  // ─── Public interface ──────────────────────────────────

  return {
    handleMessage,
    cleanup,
  };
}

module.exports = { createC3WebSocketServer, PROTOCOL_VERSION };
