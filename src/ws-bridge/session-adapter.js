// C3 WS Bridge — Session Adapter
// ══════════════════════════════════════════════════════════════════════════════
//
// v65.6 — Maps a WebSocket connection to a ChatController session.
//
// Responsibilities:
//   1. Manage per-connection state (seq counter, turn ID, abort controller)
//   2. Build ChatController.handle() requests with event hooks injected
//   3. Forward intermediate events to WS client via send callback
//   4. Enforce per-conversation turn mutex (different convs proceed in parallel)
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  Channel,
  AgentEventType,
  buildAgentEvent,
  buildChannelMessage,
  messageId,
} from './protocol.js';
import { TurnTelemetry } from '../telemetry/turn-telemetry.js';
import { config } from '../config.js';
import {
  createM1AttachmentLimits,
  validateM1Attachments,
} from './m1-attachment-policy.js';
import { featureManager } from '../core/feature-manager.js';
import {
  AbortSource,
  abortSourceOf,
  abortWithReason,
  isAbortError,
  throwIfAborted,
} from '../core/abort-error.js';
import {
  chatTurnErrorPayload,
  EffectAuthorityRequiredError,
  isChatTurnError,
} from '../core/chat-turn-error.js';
import {
  M1_CONTRACT_KIND,
  M1_CONTRACT_VERSION,
  validateConversationCommand,
  validateConversationResult,
  validateCoreEvent,
} from '../../contracts/m1/index.js';
import {
  isIdentifier,
  isPlainRecord,
  validateExactKeys,
  validationResult,
} from '../../contracts/m1/shared.js';

const M1_CANCEL_CONFIRMATION_TIMEOUT_MS = 5_000;

function createM1WsConversationResult(command, terminal) {
  const result = {
    contract: M1_CONTRACT_KIND.CONVERSATION_RESULT,
    version: M1_CONTRACT_VERSION,
    requestId: command.requestId,
    conversationId: command.conversationId,
    turnId: command.turnId,
    ...terminal,
  };
  const validation = validateConversationResult(result);
  if (!validation.valid) {
    const error = new Error('M1 WS result violated the connector contract');
    error.code = 'M1_CONVERSATION_RESULT_INVALID';
    error.validationErrors = validation.errors;
    throw error;
  }
  return result;
}

function mapM1WsConversationFailure(command, error, signal = null) {
  if (isAbortError(error) || signal?.aborted) {
    const source = abortSourceOf(error, signal);
    return createM1WsConversationResult(command, {
      status: source === AbortSource.TIMEOUT ? 'timeout' : 'cancelled',
      error: source === AbortSource.TIMEOUT
        ? { code: 'CHAT_TIMEOUT', message: 'Chat request timed out.' }
        : { code: 'CHAT_CANCELLED', message: 'Chat request was cancelled.' },
    });
  }
  if (isChatTurnError(error)) {
    const payload = chatTurnErrorPayload(error);
    return createM1WsConversationResult(command, {
      status: 'error',
      error: { code: payload.code, message: payload.message },
    });
  }
  return createM1WsConversationResult(command, {
    status: 'error',
    error: {
      code: 'CHAT_PROCESSING_FAILED',
      message: 'Chat processing failed.',
    },
  });
}

// The filesystem-backed attachment branch stays out of B4: ChatController treats
// an incoming path as read authority. Negotiated M1 therefore accepts inline
// content only — `path` is not part of the DTO and its presence rejects the
// whole collection, so a filesystem-backed item can never be downgraded to
// inline behind the user's back.
export const M1_STUDIO_ATTACHMENT_POLICY = 'BOUNDED_INLINE_ONLY';

export function validateM1StudioContext(value) {
  const errors = validateExactKeys(
    value,
    ['editMode', 'agentId', 'projectId', 'attachments'],
    [],
    'm1-studio-context',
  );
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (!['auto', 'ask'].includes(value.editMode)) {
    errors.push('m1-studio-context:invalid-editMode');
  }
  for (const key of ['agentId', 'projectId']) {
    if (value[key] !== null && !isIdentifier(value[key])) {
      errors.push(`m1-studio-context:invalid-${key}`);
    }
  }
  // Decision 021/R1 variant B: bounded inline-only. The server re-validates the
  // exact same policy the client applied, before any controller effect — a
  // client-side check is a UX affordance, not an authority.
  const attachments = validateM1Attachments(
    value.attachments,
    createM1AttachmentLimits(config.limits || {}),
  );
  if (!attachments.ok) {
    errors.push(`m1-studio-context:attachments-${attachments.code}`);
  }
  return validationResult(errors, value);
}

export function validateM1StudioFrame(value) {
  const errors = validateExactKeys(
    value,
    ['command', 'context'],
    [],
    'm1-studio-frame',
  );
  if (!isPlainRecord(value)) return validationResult(errors, value);
  const command = validateConversationCommand(value.command);
  const context = validateM1StudioContext(value.context);
  errors.push(...command.errors.map(error => `m1-studio-frame.command.${error}`));
  errors.push(...context.errors.map(error => `m1-studio-frame.context.${error}`));
  return validationResult(errors, value);
}

// v93: Notification router reference (set by server.js via setNotificationDeps)
let _notificationRouter = null;
let _notificationEmitter = null;

export function setNotificationDeps({ notificationRouter, notificationEmitter }) {
  _notificationRouter = notificationRouter;
  _notificationEmitter = notificationEmitter;
}

// Telemetry persistence — lazy-loaded once per process
let telemetryRepo = null;

async function persistTelemetry(snapshot) {
  if (!snapshot || !snapshot.turnId) return;
  try {
    if (!telemetryRepo) {
      const db = await import('../db/database.js');
      telemetryRepo = db.telemetrySnapshots;
    }
    telemetryRepo?.log(snapshot);
  } catch (_) { /* telemetry persistence must never throw */ }
}

/**
 * Create a session adapter for a single WebSocket connection.
 *
 * @param {Object} options
 * @param {Function} options.send — (jsonString) => void, sends to WS client
 * @param {Function} options.handleRequest — ChatController.handle(request) function
 * @param {Object}  options.logger — Logger instance
 * @param {string}  [options.sessionId] — Explicit session ID (default: auto-generated)
 * @param {{actorType:'user',actorId:string}|null} [options.authenticatedSubject]
 * @param {number}  [options.staleTurnMs] — Stale-turn threshold (default: 5 minutes)
 * @param {number}  [options.staleSweepMs] — Stale-turn sweep interval (default: 1 minute)
 * @param {Object}  [options.staleClock] — Injectable stale-sweep clock for tests
 * @returns {SessionAdapter}
 */
export function createSessionAdapter({
  send,
  handleRequest,
  logger,
  sessionId = null,
  authenticatedSubject = null,
  staleTurnMs = 5 * 60 * 1000,
  staleSweepMs = 60_000,
  staleClock = null,
  m1CancelConfirmationTimeoutMs = M1_CANCEL_CONFIRMATION_TIMEOUT_MS,
}) {
  let seq = 0;
  let turnCounter = 0;

  // Per-conversation MUTEX — each conversationId gets its own lock.
  // Different conversations proceed in parallel (Ollama queues GPU internally).
  // Same conversation: reject with "Počkejte" message.
  const activeTurns = new Map(); // conversationId → { turnId, abortController, startTime }

  // v124: Stale turn cleanup — abort and remove turns older than 5 minutes
  const STALE_TURN_MS = Number.isFinite(staleTurnMs) && staleTurnMs > 0
    ? staleTurnMs
    : 5 * 60 * 1000;
  const STALE_SWEEP_MS = Number.isFinite(staleSweepMs) && staleSweepMs > 0
    ? staleSweepMs
    : 60_000;
  const staleNow = staleClock?.now || Date.now;
  const staleSetInterval = staleClock?.setInterval || setInterval;
  const staleClearInterval = staleClock?.clearInterval || clearInterval;
  const m1CancelTimeoutMs = Number.isFinite(m1CancelConfirmationTimeoutMs)
    && m1CancelConfirmationTimeoutMs > 0
    ? m1CancelConfirmationTimeoutMs
    : M1_CANCEL_CONFIRMATION_TIMEOUT_MS;
  const _staleCleanupInterval = staleSetInterval(() => {
    const now = staleNow();
    for (const [convId, entry] of activeTurns) {
      if (now - entry.startTime > STALE_TURN_MS) {
        logger.warn('WSSession', `Stale turn cleanup: ${convId} (${Math.round((now - entry.startTime) / 1000)}s old)`, { sessionId: sid });
        try {
          abortWithReason(
            entry.abortController,
            AbortSource.TIMEOUT,
            `Stale turn timeout after ${STALE_TURN_MS}ms`,
          );
        } catch (_) {}
        // M1 cancel confirmation owns the active entry until its terminal is
        // emitted. Legacy retains its historical eager cleanup semantics.
        if (entry.kind !== 'm1') activeTurns.delete(convId);
      }
    }
  }, STALE_SWEEP_MS);

  const sid = sessionId || `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // ─── Internal helpers ──────────────────────────────────────────────

  // v124: Selective backpressure — drop streaming tokens when buffer full, keep critical messages
  function safeSend(jsonString) {
    try {
      if (send._ws && send._ws.bufferedAmount > 1024 * 1024) {
        try {
          const parsed = JSON.parse(jsonString);
          const isCritical = parsed?.channel === Channel.CHAT ||
            parsed?.data?.type === 'turn_end' || parsed?.data?.type === 'error' ||
            parsed?.data?.type === 'edit_request' || parsed?.data?.type === 'lifecycle_event';
          if (!isCritical) return; // Drop non-critical when backpressured
        } catch (_) { return; } // Can't parse → drop
      }
    } catch (_) { /* send._ws may not exist — skip backpressure check */ }
    send(jsonString);
  }

  function sendChannel(channel, data) {
    safeSend(buildChannelMessage(channel, data));
  }

  function sendAgentEvent(type, turnId, payload, conversationId = null) {
    const event = buildAgentEvent(++seq, type, turnId, payload);
    if (conversationId) event.conversationId = conversationId;
    sendChannel(Channel.AGENT, event);
  }

  function createM1Egress(command) {
    let sequence = 0;
    let terminalStatus = null;

    function sendEvent(event) {
      const validation = validateCoreEvent(event);
      if (!validation.valid) {
        const error = new Error('M1 CoreEvent violated the connector contract');
        error.code = 'M1_CORE_EVENT_INVALID';
        error.validationErrors = validation.errors;
        throw error;
      }
      sendChannel(Channel.CHAT, event);
      sequence = event.sequence;
      return event;
    }

    function progress(eventType, payload) {
      if (terminalStatus !== null) return false;
      let jsonPayload;
      try {
        jsonPayload = JSON.parse(JSON.stringify(payload ?? {}));
      } catch (error) {
        logger.warn('WSSession', 'Dropped non-JSON M1 progress payload', {
          eventType,
          requestId: command.requestId,
          error: error.message,
        });
        return false;
      }
      sendEvent({
        contract: M1_CONTRACT_KIND.CORE_EVENT,
        version: M1_CONTRACT_VERSION,
        requestId: command.requestId,
        conversationId: command.conversationId,
        turnId: command.turnId,
        sequence: sequence + 1,
        phase: 'progress',
        eventType,
        payload: jsonPayload,
      });
      return true;
    }

    function terminal(result) {
      if (terminalStatus !== null) {
        const error = new Error('M1 command already has a terminal result');
        error.code = 'M1_DUPLICATE_TERMINAL';
        throw error;
      }
      sendEvent({
        contract: M1_CONTRACT_KIND.CORE_EVENT,
        version: M1_CONTRACT_VERSION,
        requestId: command.requestId,
        conversationId: command.conversationId,
        turnId: command.turnId,
        sequence: sequence + 1,
        phase: 'terminal',
        eventType: 'result',
        terminalStatus: result.status,
        payload: { result },
      });
      terminalStatus = result.status;
      return result;
    }

    return Object.freeze({
      get terminalStatus() { return terminalStatus; },
      progress,
      terminal,
    });
  }

  function sendStatus() {
    sendChannel(Channel.STATUS, {
      agentStatus: activeTurns.size > 0 ? 'executing' : 'idle',
    });
  }

  // ─── Turn execution ────────────────────────────────────────────────

  /**
   * Process a user chat message through ChatController.
   * Enforces per-conversation mutex. Injects event hooks into request context.
   *
   * @param {string} content — User message text
   * @param {Object} [options] — { editMode, conversationId, projectId, agentId }
   */
  async function processChat(content, options = {}, m1Command = null) {
    if (!content || typeof content !== 'string') return;

    const convId = options.conversationId || '__default__';
    const m1Egress = m1Command === null ? null : createM1Egress(m1Command);

    // Per-conversation mutex: reject only if THIS conversation is busy
    if (activeTurns.has(convId)) {
      if (m1Egress) {
        m1Egress.terminal(createM1WsConversationResult(m1Command, {
          status: 'error',
          error: {
            code: 'M1_CONVERSATION_BUSY',
            message: 'The conversation already has an active turn.',
          },
        }));
        return;
      }
      sendChannel(Channel.CHAT, {
        id: messageId('sys'),
        type: 'system',
        content: 'Agent právě zpracovává předchozí zprávu v této konverzaci. Počkejte prosím.',
        conversationId: options.conversationId || null,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Log if other conversations are active (GPU queueing at Ollama level)
    if (activeTurns.size > 0) {
      logger.info('WSSession', `Parallel turn — ${activeTurns.size} other conversation(s) active, GPU queued at Ollama level`, {
        sessionId: sid, conversationId: convId,
      });
    }

    // Preserve request conversationId for routing responses back to correct session
    const requestConversationId = options.conversationId || null;

    // Start new turn — register in activeTurns
    turnCounter++;
    const turnId = m1Command?.turnId
      || `t-${String(turnCounter).padStart(3, '0')}`;
    const ac = new AbortController();
    let resolveCompletion;
    const completion = new Promise(resolve => { resolveCompletion = resolve; });
    const activeEntry = {
      kind: m1Egress ? 'm1' : 'legacy',
      requestId: m1Command?.requestId || null,
      turnId,
      abortController: ac,
      startTime: staleNow(),
      completion,
      resolveCompletion,
    };
    activeTurns.set(convId, activeEntry);

    const turnStartTime = Date.now();

    // Telemetry: create collector for this turn (if enabled)
    const turnTelemetry = config.features.telemetry
      ? new TurnTelemetry(turnId, sid, convId)
      : null;

    const sendTurnEvent = (type, payload) => {
      if (m1Egress) return m1Egress.progress(type, payload);
      return sendAgentEvent(type, turnId, payload, requestConversationId);
    };

    sendTurnEvent(AgentEventType.TURN_START, { input: content });

    try {
      // ═══════════════════════════════════════════════════════════════
      // Build request with IDE event hooks injected into context.
      // ChatController.handle() passes context → fullContext → handler.
      // Handlers call hooks at appropriate points (B2 changes).
      // ═══════════════════════════════════════════════════════════════

      const request = {
        message: content,
        sessionId: sid,
        authenticatedSubject,
        conversationId: options.conversationId || null,
        projectId: options.projectId || null,
        attachments: options.attachments || [],
        ...(m1Command ? {
          requestId: m1Command.requestId,
          turnId: m1Command.turnId,
        } : {}),
        // ChatController.handle() reads the cancellation signal from the
        // top-level request before projecting it into handler context.
        signal: ac.signal,
        context: {
          turnId,
          signal: ac.signal,
          editMode: options.editMode || 'auto',
          projectId: options.projectId || null,
          agentId: options.agentId || null,
          ...(m1Command ? {
            requestId: m1Command.requestId,
            conversationId: m1Command.conversationId,
          } : {}),
          telemetry: turnTelemetry,

          // Hook: CRE decision (called in ChatController.process after mode detection)
          onCREDecision: (decision) => {
            sendTurnEvent(AgentEventType.CRE_DECISION, {
              intent: decision.intent,
              confidence: decision.confidence,
              input: content,
              actionType: decision.actionType,
              tools: decision.tools,
            });
          },

          // Hook: Tool call start (ASYNC — legacy edit containment)
          onToolCall: async (tool, args) => {
            sendTurnEvent(AgentEventType.TOOL_CALL, { tool, args });

            // The legacy edit-preview protocol previously read and wrote an
            // arbitrary model-provided path here. It has no registered project
            // snapshot or ApprovalGrant identity, so M2 contains it until the
            // execution slice reconnects previews through the canonical broker.
            if (tool === 'file.write' || tool === 'fs.write') {
              sendTurnEvent('edit_authority_required', {
                file: typeof args?.path === 'string' ? args.path : null,
                code: 'M2_EFFECT_AUTHORITY_REQUIRED',
              });
              throw new EffectAuthorityRequiredError();
            }
          },

          // Hook: Tool call result (called in handleToolCallDecision after execute)
          onToolResult: (tool, result) => {
            sendTurnEvent(AgentEventType.TOOL_RESULT, {
              tool,
              success: result.success,
              durationMs: result.durationMs,
              summary: result.summary,
            });
          },

          // Hook: LLM synthesis start (called in synthesizeWithLLM before LLM call)
          onLLMStart: (model, tokensIn) => {
            sendTurnEvent(AgentEventType.LLM_START, { model, tokensIn });
          },

          // Hook: LLM token (streaming — reserved for future use)
          onLLMToken: (token) => {
            sendTurnEvent(AgentEventType.LLM_TOKEN, { token });
          },

          // Hook: LLM synthesis done (called in synthesizeWithLLM after LLM returns)
          onLLMDone: (tokensOut, durationMs) => {
            sendTurnEvent(AgentEventType.LLM_DONE, { tokensOut, durationMs });
          },

          // Hook: Output quality gate verdict (called after D6 gate check)
          onGateVerdict: (verdict) => {
            sendTurnEvent(AgentEventType.GATE_VERDICT, verdict);
          },

          // Hook: System step — structured internal operation detail
          // level: 1 = key steps (default), 2 = verbose detail
          onSystemStep: (step, detail, level) => {
            const maxLevel = config.features?.agentLogLevel ?? 2;
            if ((level || 1) <= maxLevel) {
              sendTurnEvent(AgentEventType.SYSTEM_STEP, { step, detail });
            }
          },
        },
      };

      const response = await handleRequest(request);
      throwIfAborted(ac.signal);

      const responseConvId = response.conversationId || requestConversationId;
      if (!m1Egress) {
        // Legacy assistant envelope — negotiated M1 never enters this branch.
        sendChannel(Channel.CHAT, {
          id: messageId('msg'),
          type: 'assistant',
          content: response.response,
          conversationId: responseConvId,
          timestamp: new Date().toISOString(),
          metadata: {
            mode: response.mode,
            confidence: response.confidence,
            turnId,
            state: response.state,
            conversationId: responseConvId,
          },
        });
      }

      // Decision 021/R2 variant A: an M1 turn that would need the legacy effect
      // must say so instead of returning ok. Silently skipping the effect and
      // reporting success would claim a parity the connector cannot deliver —
      // the effect has no M1 command/result authority, no approval ledger and
      // no single terminal. SHELL stays explicitly unavailable until M2 owns it.
      if (m1Egress && response.metadata?.shellCommand) {
        turnTelemetry?.finalize(turnStartTime);
        m1Egress.terminal(createM1WsConversationResult(m1Command, {
          status: 'error',
          error: {
            code: 'M1_EFFECT_AUTHORITY_REQUIRED',
            message: 'Tento krok vyžaduje efekt, který M1 kontrakt zatím neumí '
              + 'bezpečně potvrdit. Nic se nespustilo.',
          },
        }));
        logger.info('WSSession', 'M1 turn needed a legacy shell effect — refused before ok', {
          requestId: m1Command.requestId,
          turnId,
        });
        return;
      }

      // Legacy shell auto-exec is an effect authority outside B4. M1 remains
      // unadvertised in production while this behavior decision is open.
      if (!m1Egress && response.metadata?.shellCommand) {
        const shellCmd = response.metadata.shellCommand;
        logger.info('WSSession', `Auto-executing shell command from SHELL intent: ${shellCmd}`, { turnId });
        // Fire-and-forget — handleTerminal sends results via terminal channel
        handleTerminal({ type: 'exec', command: shellCmd, reqId: `shell-${turnId}`, conversationId: requestConversationId })
          .catch(err => logger.error('WSSession', `Shell auto-exec failed: ${err.message}`));
      }

      // Turn end — success
      const telemetrySnapshot = turnTelemetry?.finalize(turnStartTime) ?? null;
      if (m1Egress) {
        if (telemetrySnapshot) {
          sendTurnEvent('turn_metrics', { telemetry: telemetrySnapshot });
        }
        const metadata = {
          mode: response.mode,
          confidence: response.confidence,
          conversationId: m1Command.conversationId,
        };
        if (response.state !== undefined) {
          try { metadata.state = JSON.parse(JSON.stringify(response.state)); } catch (_) {}
        }
        m1Egress.terminal(createM1WsConversationResult(m1Command, {
          status: 'ok',
          response: {
            content: response.response,
            metadata,
          },
        }));
      } else {
        sendTurnEvent(AgentEventType.TURN_END, {
          status: 'ok',
          durationMs: Date.now() - turnStartTime,
          ...(telemetrySnapshot ? { telemetry: telemetrySnapshot } : {}),
        });
      }
      if (telemetrySnapshot) {
        logger.info('TurnTelemetry', JSON.stringify(telemetrySnapshot));
      }
      persistTelemetry(telemetrySnapshot);

    } catch (err) {
      const durationMs = Date.now() - turnStartTime;
      const abortSource = isAbortError(err)
        ? abortSourceOf(err, ac.signal, AbortSource.USER)
        : null;

      if (m1Egress) {
        const terminal = mapM1WsConversationFailure(m1Command, err, ac.signal);
        if (terminal.status === 'timeout') turnTelemetry?.recordCancel('timeout');
        if (terminal.status === 'cancelled') turnTelemetry?.recordCancel('user');
        const snap = turnTelemetry?.finalize(turnStartTime) ?? null;
        if (snap) m1Egress.progress('turn_metrics', { telemetry: snap });
        m1Egress.terminal(terminal);
        persistTelemetry(snap);
        if (terminal.status === 'error') {
          logger.error('WSSession', `M1 turn error: ${err.message}`, {
            requestId: m1Command.requestId,
            turnId,
          });
        }
        return;
      }

      if (
        abortSource === AbortSource.TIMEOUT
        || (!isAbortError(err) && err.message?.includes('timeout'))
      ) {
        turnTelemetry?.recordCancel('timeout');
        const snap = turnTelemetry?.finalize(turnStartTime) ?? null;
        sendTurnEvent(AgentEventType.TURN_END, {
          status: 'timeout',
          durationMs,
          error: err.message,
          ...(snap ? { telemetry: snap } : {}),
        });
        persistTelemetry(snap);
        sendTurnEvent(AgentEventType.ERROR, {
          code: 'TIMEOUT',
          message: err.message,
          recoverable: true,
        });
      } else if (isAbortError(err)) {
        turnTelemetry?.recordCancel('user');
        const snap = turnTelemetry?.finalize(turnStartTime) ?? null;
        sendTurnEvent(AgentEventType.TURN_END, {
          status: 'cancelled_by_user',
          durationMs,
          ...(snap ? { telemetry: snap } : {}),
        });
        persistTelemetry(snap);
      } else {
        logger.error('WSSession', `Turn error: ${err.message}`, { turnId });
        const terminalChatError = isChatTurnError(err)
          ? chatTurnErrorPayload(err)
          : null;
        const snap = turnTelemetry?.finalize(turnStartTime) ?? null;
        sendTurnEvent(AgentEventType.TURN_END, {
          status: 'error',
          durationMs,
          error: terminalChatError?.message || err.message,
          ...(snap ? { telemetry: snap } : {}),
        });
        persistTelemetry(snap);
        sendTurnEvent(AgentEventType.ERROR, {
          code: terminalChatError?.code || 'UNEXPECTED',
          message: terminalChatError?.message || err.message,
          recoverable: terminalChatError?.recoverable || false,
        });
      }

      // Send error to chat — include conversationId for session routing
      sendChannel(Channel.CHAT, {
        id: messageId('err'),
        type: 'system',
        content: isAbortError(err) && abortSource !== AbortSource.TIMEOUT
          ? 'Zpracování zrušeno.'
          : isChatTurnError(err)
            ? err.message
            : `Chyba: ${err.message}`,
        conversationId: requestConversationId,
        timestamp: new Date().toISOString(),
      });

    } finally {
      // Safe delete — only the exact owner may release this conversation.
      const entry = activeTurns.get(convId);
      if (entry === activeEntry) {
        activeTurns.delete(convId);
      }
      activeEntry.resolveCompletion({
        status: m1Egress?.terminalStatus || null,
      });

      try {
        sendChannel(Channel.STATUS, {
          agentStatus: activeTurns.size > 0 ? 'executing' : 'idle',
          conversationId: requestConversationId,
        });
      } catch (finallyErr) {
        logger.error('WSSession', `Finally block error: ${finallyErr.message}`, { sessionId: sid });
      }
    }
  }

  async function processM1Command(frame) {
    const validation = validateM1StudioFrame(frame);
    if (!validation.valid) {
      const error = new TypeError('Invalid M1 Studio frame');
      error.code = 'M1_STUDIO_FRAME_INVALID';
      error.validationErrors = validation.errors;
      throw error;
    }

    const { command, context } = frame;
    if (command.action === 'send') {
      return processChat(command.input, {
        editMode: context.editMode,
        conversationId: command.conversationId,
        agentId: context.agentId,
        projectId: context.projectId,
        attachments: context.attachments,
      }, command);
    }

    const activeTurn = activeTurns.get(command.conversationId);
    if (!activeTurn || activeTurn.kind !== 'm1') {
      const egress = createM1Egress(command);
      egress.terminal(createM1WsConversationResult(command, {
        status: 'error',
        error: {
          code: 'M1_WS_CANCEL_NOT_ACTIVE',
          message: 'The conversation has no active M1 turn to cancel.',
        },
      }));
      return;
    }
    if (
      command.requestId === activeTurn.requestId
      || command.turnId === activeTurn.turnId
    ) {
      // A colliding command cannot receive a terminal without corrupting the
      // target stream keyed by that same identity. Reject the frame and let
      // the transport close fail-closed instead.
      const error = new TypeError(
        'The M1 cancel operation must have its own request and turn identity.',
      );
      error.code = 'M1_WS_CANCEL_IDENTITY_CONFLICT';
      throw error;
    }
    const egress = createM1Egress(command);
    egress.progress('cancel_requested', {
      targetRequestId: activeTurn.requestId,
      targetTurnId: activeTurn.turnId,
    });
    abortWithReason(
      activeTurn.abortController,
      AbortSource.USER,
      'Active conversation turn cancelled by an M1 WebSocket command',
    );

    let timeout = null;
    let targetTerminal;
    try {
      targetTerminal = await Promise.race([
        activeTurn.completion,
        new Promise(resolve => {
          timeout = setTimeout(
            () => resolve({ status: 'confirmation-timeout' }),
            m1CancelTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (timeout !== null) clearTimeout(timeout);
    }

    if (targetTerminal.status === 'confirmation-timeout') {
      egress.terminal(createM1WsConversationResult(command, {
        status: 'timeout',
        error: {
          code: 'CHAT_TIMEOUT',
          message: 'Timed out while waiting for cancellation confirmation.',
        },
      }));
      return;
    }
    if (targetTerminal.status !== 'cancelled') {
      egress.terminal(createM1WsConversationResult(command, {
        status: 'error',
        error: {
          code: 'M1_WS_CANCEL_NOT_CONFIRMED',
          message: 'The active turn did not confirm user cancellation.',
        },
      }));
      return;
    }

    egress.terminal(createM1WsConversationResult(command, {
      status: 'cancelled',
      error: {
        code: 'CHAT_CANCELLED',
        message: 'The active conversation turn was cancelled.',
      },
    }));
  }

  // ─── Terminal execution ────────────────────────────────────────────

  /**
   * Handle a terminal command execution request.
   * Uses C3ToolExecutor with security validation (whitelist, argv spawn, sanitized env).
   *
   * @param {Object} data — { type: 'exec', command: string, cwd?: string, reqId?: string }
   */
  async function handleTerminal(data) {
    if (data.type !== 'exec' || !data.command || typeof data.command !== 'string') {
      sendChannel(Channel.TERMINAL, {
        type: 'error',
        reqId: data.reqId || null,
        conversationId: data.conversationId || null,
        error: 'Invalid terminal request: type must be "exec" with a non-empty command string.',
      });
      return;
    }

    const reqId = data.reqId || `term-${Date.now()}`;
    const startTime = Date.now();

    // Notify IDE that execution started (echo conversationId for multi-session routing)
    sendChannel(Channel.TERMINAL, {
      type: 'exec_start',
      reqId,
      command: data.command,
      conversationId: data.conversationId || null,
      timestamp: new Date().toISOString(),
    });

    try {
      // Dynamically import executor to avoid circular dependency at module level
      const { C3ToolExecutor } = await import('../executor/c3-tool-executor.js');
      const executor = new C3ToolExecutor();

      const result = await executor.execute({
        correlationId: `ws-term-${reqId}`,
        tool: 'shell',
        args: {
          command: data.command,
          cwd: data.cwd || undefined,
        },
        timeoutMs: 120000, // 2 minute default for interactive commands
        // No signal — terminal commands are independent of chat turn cancellation
      });

      sendChannel(Channel.TERMINAL, {
        type: 'exec_result',
        reqId,
        conversationId: data.conversationId || null,
        status: result.status,
        stdout: result.output?.stdout || '',
        stderr: result.output?.stderr || '',
        exitCode: result.output?.exitCode ?? (result.status === 'ok' ? 0 : 1),
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('WSSession', `Terminal exec error: ${err.message}`, { reqId });
      sendChannel(Channel.TERMINAL, {
        type: 'exec_result',
        reqId,
        conversationId: data.conversationId || null,
        status: 'error',
        stdout: '',
        stderr: err.message,
        exitCode: 1,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // ─── Control commands ──────────────────────────────────────────────

  /**
   * Handle a control command (cancel, ping).
   * @param {Object} data — { action: 'cancel' | 'ping', conversationId?: string }
   */
  function handleControl(data) {
    switch (data.action) {
      case 'cancel':
        if (data.conversationId) {
          // Cancel specific conversation
          const turn = activeTurns.get(data.conversationId);
          if (turn) {
            abortWithReason(turn.abortController, AbortSource.USER);
            logger.info('WSSession', 'Cancelled by user', { sessionId: sid, conversationId: data.conversationId });
          }
        } else {
          // No conversationId → cancel all active turns
          for (const [cid, turn] of activeTurns) {
            abortWithReason(turn.abortController, AbortSource.USER);
          }
          logger.info('WSSession', 'Cancel all — no conversationId provided', { sessionId: sid, activeCount: activeTurns.size });
        }
        sendChannel(Channel.CONTROL, { action: 'cancel', success: true });
        break;

      case 'ping':
        sendChannel(Channel.CONTROL, { action: 'pong', success: true });
        break;

      // v85: Sync feature settings from IDE
      case 'sync_settings': {
        try {
          const changed = featureManager.applySettings(data.settings || {});

          // v93: Sync SMTP notification settings to EmailChannel
          if (_notificationRouter && 'c3.notif.smtpHost' in (data.settings || {})) {
            _notificationRouter.updateChannelConfig('email', {
              host: data.settings['c3.notif.smtpHost'],
              port: data.settings['c3.notif.smtpPort'],
              user: data.settings['c3.notif.smtpUser'],
              pass: data.settings['c3.notif.smtpPass'],
              from: data.settings['c3.notif.smtpFrom'],
            });
            if (_notificationEmitter) _notificationEmitter.invalidateCache();
            logger.info('WSSession', 'SMTP notification config synced', { sessionId: sid });
          }

          sendChannel(Channel.CONTROL, { action: 'sync_settings', success: true, changed });
          if (changed > 0) {
            logger.info('WSSession', `Feature settings synced (${changed} changed)`, { sessionId: sid });
          }
        } catch (err) {
          logger.error('WSSession', `sync_settings failed: ${err.message}`);
          sendChannel(Channel.CONTROL, { action: 'sync_settings', success: false, error: err.message });
        }
        break;
      }

      // Legacy edit approval no longer owns filesystem authority. A client
      // replay cannot revive the removed direct-write bypass.
      case 'edit_approve': {
        sendChannel(Channel.CONTROL, {
          action: 'edit_approve',
          requestId: data.requestId || null,
          success: false,
          error: 'M2_EFFECT_AUTHORITY_REQUIRED',
        });
        break;
      }

      // E4: Edit reject
      case 'edit_reject': {
        sendChannel(Channel.CONTROL, {
          action: 'edit_reject',
          requestId: data.requestId || null,
          success: false,
          error: 'M2_EFFECT_AUTHORITY_REQUIRED',
        });
        break;
      }
    }
  }

  // ─── Cleanup ───────────────────────────────────────────────────────

  function cleanup() {
    // v124: Stop stale turn cleanup interval
    staleClearInterval(_staleCleanupInterval);
    // Abort all active turns on disconnect
    for (const [cid, turn] of activeTurns) {
      abortWithReason(turn.abortController, AbortSource.USER, 'Session disconnected');
    }
    activeTurns.clear();
    logger.info('WSSession', 'Session cleaned up', { sessionId: sid });
  }

  // ─── Public API ────────────────────────────────────────────────────

  return {
    get sessionId() { return sid; },
    get isExecuting() { return activeTurns.size > 0; },
    get activeTurnCount() { return activeTurns.size; },
    processChat,
    processM1Command,
    handleTerminal,
    handleControl,
    sendStatus,
    cleanup,
  };
}
