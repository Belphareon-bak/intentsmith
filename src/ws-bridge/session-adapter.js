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
import { featureManager } from '../core/feature-manager.js';
import {
  AbortSource,
  abortSourceOf,
  abortWithReason,
  isAbortError,
  throwIfAborted,
} from '../core/abort-error.js';

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
  staleTurnMs = 5 * 60 * 1000,
  staleSweepMs = 60_000,
  staleClock = null,
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
        activeTurns.delete(convId);
      }
    }
  }, STALE_SWEEP_MS);

  // Fáze 5 — E4: Pending edit approvals (reqId → {resolve, reject, timer})
  const editPending = new Map();

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

  function sendAgentEvent(type, turnId, payload) {
    sendChannel(Channel.AGENT, buildAgentEvent(++seq, type, turnId, payload));
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
  async function processChat(content, options = {}) {
    if (!content || typeof content !== 'string') return;

    const convId = options.conversationId || '__default__';

    // Per-conversation mutex: reject only if THIS conversation is busy
    if (activeTurns.has(convId)) {
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
    const turnId = `t-${String(turnCounter).padStart(3, '0')}`;
    const ac = new AbortController();
    activeTurns.set(convId, { turnId, abortController: ac, startTime: staleNow() });

    const turnStartTime = Date.now();

    // Telemetry: create collector for this turn (if enabled)
    const turnTelemetry = config.features.telemetry
      ? new TurnTelemetry(turnId, sid, convId)
      : null;

    sendAgentEvent(AgentEventType.TURN_START, turnId, { input: content });

    try {
      // ═══════════════════════════════════════════════════════════════
      // Build request with IDE event hooks injected into context.
      // ChatController.handle() passes context → fullContext → handler.
      // Handlers call hooks at appropriate points (B2 changes).
      // ═══════════════════════════════════════════════════════════════

      const request = {
        message: content,
        sessionId: sid,
        conversationId: options.conversationId || null,
        projectId: options.projectId || null,
        attachments: options.attachments || [],
        // ChatController.handle() reads the cancellation signal from the
        // top-level request before projecting it into handler context.
        signal: ac.signal,
        context: {
          turnId,
          signal: ac.signal,
          editMode: options.editMode || 'auto',
          projectId: options.projectId || null,
          telemetry: turnTelemetry,

          // Hook: CRE decision (called in ChatController.process after mode detection)
          onCREDecision: (decision) => {
            sendAgentEvent(AgentEventType.CRE_DECISION, turnId, {
              intent: decision.intent,
              confidence: decision.confidence,
              input: content,
              actionType: decision.actionType,
              tools: decision.tools,
            });
          },

          // Hook: Tool call start (ASYNC — edit interception in ask mode)
          onToolCall: async (tool, args) => {
            sendAgentEvent(AgentEventType.TOOL_CALL, turnId, { tool, args });

            // E4: Intercept fs.write in ask mode → send diff to IDE, wait for approve/reject
            if (tool === 'fs.write' && options.editMode === 'ask') {
              const reqId = `er-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
              const filePath = args.path;

              // Read current file content for diff
              const fs = await import('fs/promises');
              let oldContent = '';
              let baseHash = null; // null = new file
              try {
                oldContent = await fs.readFile(filePath, 'utf-8');
                const { createHash } = await import('crypto');
                baseHash = createHash('sha256').update(oldContent).digest('hex').substring(0, 16);
              } catch { /* new file — baseHash stays null */ }

              // Send edit_request with old + new + baseHash
              sendAgentEvent('edit_request', turnId, {
                reqId,
                file: filePath,
                oldContent,
                newContent: args.content,
                baseHash,
              });

              // Wait for approve/reject from IDE (30s timeout — invariant 14)
              // v124: Wrap resolve/reject to auto-clear timer (prevents leak)
              return new Promise((rawResolve, rawReject) => {
                const timer = setTimeout(() => {
                  editPending.delete(reqId);
                  sendAgentEvent('edit_timeout', turnId, { reqId, file: filePath });
                  rawReject(new Error('Edit request timeout (30s)'));
                }, 30000);
                const resolve = (v) => { clearTimeout(timer); rawResolve(v); };
                const reject = (e) => { clearTimeout(timer); rawReject(e); };
                editPending.set(reqId, { resolve, reject, timer, filePath, newContent: args.content, baseHash });
              });
            }
          },

          // Hook: Tool call result (called in handleToolCallDecision after execute)
          onToolResult: (tool, result) => {
            sendAgentEvent(AgentEventType.TOOL_RESULT, turnId, {
              tool,
              success: result.success,
              durationMs: result.durationMs,
              summary: result.summary,
            });
          },

          // Hook: LLM synthesis start (called in synthesizeWithLLM before LLM call)
          onLLMStart: (model, tokensIn) => {
            sendAgentEvent(AgentEventType.LLM_START, turnId, { model, tokensIn });
          },

          // Hook: LLM token (streaming — reserved for future use)
          onLLMToken: (token) => {
            sendAgentEvent(AgentEventType.LLM_TOKEN, turnId, { token });
          },

          // Hook: LLM synthesis done (called in synthesizeWithLLM after LLM returns)
          onLLMDone: (tokensOut, durationMs) => {
            sendAgentEvent(AgentEventType.LLM_DONE, turnId, { tokensOut, durationMs });
          },

          // Hook: Output quality gate verdict (called after D6 gate check)
          onGateVerdict: (verdict) => {
            sendAgentEvent(AgentEventType.GATE_VERDICT, turnId, verdict);
          },

          // Hook: System step — structured internal operation detail
          // level: 1 = key steps (default), 2 = verbose detail
          onSystemStep: (step, detail, level) => {
            const maxLevel = config.features?.agentLogLevel ?? 2;
            if ((level || 1) <= maxLevel) {
              sendAgentEvent(AgentEventType.SYSTEM_STEP, turnId, { step, detail });
            }
          },
        },
      };

      const response = await handleRequest(request);
      throwIfAborted(ac.signal);

      // Send final response via chat channel — include conversationId for session routing
      const responseConvId = response.conversationId || requestConversationId;
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

      // v65.0: Auto-execute shell command if CRE detected SHELL intent
      if (response.metadata?.shellCommand) {
        const shellCmd = response.metadata.shellCommand;
        logger.info('WSSession', `Auto-executing shell command from SHELL intent: ${shellCmd}`, { turnId });
        // Fire-and-forget — handleTerminal sends results via terminal channel
        handleTerminal({ type: 'exec', command: shellCmd, reqId: `shell-${turnId}`, conversationId: requestConversationId })
          .catch(err => logger.error('WSSession', `Shell auto-exec failed: ${err.message}`));
      }

      // Turn end — success
      const telemetrySnapshot = turnTelemetry?.finalize(turnStartTime) ?? null;
      sendAgentEvent(AgentEventType.TURN_END, turnId, {
        status: 'ok',
        durationMs: Date.now() - turnStartTime,
        ...(telemetrySnapshot ? { telemetry: telemetrySnapshot } : {}),
      });
      if (telemetrySnapshot) {
        logger.info('TurnTelemetry', JSON.stringify(telemetrySnapshot));
      }
      persistTelemetry(telemetrySnapshot);

    } catch (err) {
      const durationMs = Date.now() - turnStartTime;
      const abortSource = isAbortError(err)
        ? abortSourceOf(err, ac.signal, AbortSource.USER)
        : null;

      if (abortSource === AbortSource.TIMEOUT || err.message?.includes('timeout')) {
        turnTelemetry?.recordCancel('timeout');
        const snap = turnTelemetry?.finalize(turnStartTime) ?? null;
        sendAgentEvent(AgentEventType.TURN_END, turnId, {
          status: 'timeout',
          durationMs,
          error: err.message,
          ...(snap ? { telemetry: snap } : {}),
        });
        persistTelemetry(snap);
        sendAgentEvent(AgentEventType.ERROR, turnId, {
          code: 'TIMEOUT',
          message: err.message,
          recoverable: true,
        });
      } else if (isAbortError(err)) {
        turnTelemetry?.recordCancel('user');
        const snap = turnTelemetry?.finalize(turnStartTime) ?? null;
        sendAgentEvent(AgentEventType.TURN_END, turnId, {
          status: 'cancelled_by_user',
          durationMs,
          ...(snap ? { telemetry: snap } : {}),
        });
        persistTelemetry(snap);
      } else {
        logger.error('WSSession', `Turn error: ${err.message}`, { turnId });
        const snap = turnTelemetry?.finalize(turnStartTime) ?? null;
        sendAgentEvent(AgentEventType.TURN_END, turnId, {
          status: 'error',
          durationMs,
          error: err.message,
          ...(snap ? { telemetry: snap } : {}),
        });
        persistTelemetry(snap);
        sendAgentEvent(AgentEventType.ERROR, turnId, {
          code: 'UNEXPECTED',
          message: err.message,
          recoverable: false,
        });
      }

      // Send error to chat — include conversationId for session routing
      sendChannel(Channel.CHAT, {
        id: messageId('err'),
        type: 'system',
        content: isAbortError(err) && abortSource !== AbortSource.TIMEOUT
          ? 'Zpracování zrušeno.'
          : `Chyba: ${err.message}`,
        conversationId: requestConversationId,
        timestamp: new Date().toISOString(),
      });

    } finally {
      // Safe delete — only remove if turnId matches (future-proof against queue scenarios)
      const entry = activeTurns.get(convId);
      if (entry && entry.turnId === turnId) {
        activeTurns.delete(convId);
      }

      try {
        sendChannel(Channel.STATUS, {
          agentStatus: activeTurns.size > 0 ? 'executing' : 'idle',
        });
      } catch (finallyErr) {
        logger.error('WSSession', `Finally block error: ${finallyErr.message}`, { sessionId: sid });
      }
    }
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

      // E4: Edit approve — hash guard, write file, broadcast new hash
      case 'edit_approve': {
        const pending = editPending.get(data.requestId);
        if (!pending) break;
        clearTimeout(pending.timer);
        editPending.delete(data.requestId);

        // Hash guard + write (async IIFE)
        (async () => {
          try {
            const fs = await import('fs/promises');
            const { createHash } = await import('crypto');

            // Verify file hasn't changed since baseHash
            if (pending.baseHash !== null) {
              let currentHash = null;
              try {
                const currentContent = await fs.readFile(pending.filePath, 'utf-8');
                currentHash = createHash('sha256').update(currentContent).digest('hex').substring(0, 16);
              } catch { /* file deleted? */ }

              if (currentHash !== pending.baseHash) {
                sendAgentEvent('edit_conflict', null, {
                  reqId: data.requestId,
                  file: pending.filePath,
                  message: 'Soubor byl změněn od doby vytvoření diffu.',
                });
                pending.reject(new Error('Edit conflict: file changed'));
                return;
              }
            }

            // Safe write
            await fs.writeFile(pending.filePath, pending.newContent, 'utf-8');
            const newHash = createHash('sha256').update(pending.newContent).digest('hex').substring(0, 16);

            // Broadcast for file watcher / tree refresh
            sendChannel(Channel.STATUS, {
              fileWritten: { path: pending.filePath, hash: newHash },
            });

            logger.info('WSSession', `Edit approved: ${pending.filePath}`, { sessionId: sid });
            pending.resolve({ approved: true });
          } catch (err) {
            logger.error('WSSession', `Edit write error: ${err.message}`, { sessionId: sid });
            pending.reject(err);
          }
        })().catch(err => {
          logger.error('WSSession', `Unhandled edit_approve error: ${err.message}`, { sessionId: sid });
        });
        break;
      }

      // E4: Edit reject
      case 'edit_reject': {
        const pending = editPending.get(data.requestId);
        if (!pending) break;
        clearTimeout(pending.timer);
        editPending.delete(data.requestId);
        logger.info('WSSession', `Edit rejected: ${pending.filePath}`, { sessionId: sid });
        pending.reject(new Error('Edit rejected by user'));
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
    // Reject all pending edits on disconnect
    for (const [reqId, pending] of editPending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Session disconnected'));
    }
    editPending.clear();
    logger.info('WSSession', 'Session cleaned up', { sessionId: sid });
  }

  // ─── Public API ────────────────────────────────────────────────────

  return {
    get sessionId() { return sid; },
    get isExecuting() { return activeTurns.size > 0; },
    get activeTurnCount() { return activeTurns.size; },
    processChat,
    handleTerminal,
    handleControl,
    sendStatus,
    cleanup,
  };
}
