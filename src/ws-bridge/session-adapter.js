// C3 WS Bridge — Session Adapter
// ══════════════════════════════════════════════════════════════════════════════
//
// v59.0 — Maps a WebSocket connection to a ChatController session.
//
// Responsibilities:
//   1. Manage per-connection state (seq counter, turn ID, abort controller)
//   2. Build ChatController.handle() requests with event hooks injected
//   3. Forward intermediate events to WS client via send callback
//   4. Enforce max-1-concurrent-turn execution model
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  Channel,
  AgentEventType,
  buildAgentEvent,
  buildChannelMessage,
  messageId,
} from './protocol.js';

/**
 * Create a session adapter for a single WebSocket connection.
 *
 * @param {Object} options
 * @param {Function} options.send — (jsonString) => void, sends to WS client
 * @param {Function} options.handleRequest — ChatController.handle(request) function
 * @param {Object}  options.logger — Logger instance
 * @param {string}  [options.sessionId] — Explicit session ID (default: auto-generated)
 * @returns {SessionAdapter}
 */
export function createSessionAdapter({ send, handleRequest, logger, sessionId = null }) {
  let seq = 0;
  let turnCounter = 0;
  let currentTurnId = null;
  let abortController = null;

  // Fáze 5 — E4: Pending edit approvals (reqId → {resolve, reject, timer})
  const editPending = new Map();

  const sid = sessionId || `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // ─── Internal helpers ──────────────────────────────────────────────

  function sendChannel(channel, data) {
    send(buildChannelMessage(channel, data));
  }

  function sendAgentEvent(type, turnId, payload) {
    sendChannel(Channel.AGENT, buildAgentEvent(++seq, type, turnId, payload));
  }

  function sendStatus() {
    sendChannel(Channel.STATUS, {
      agentStatus: currentTurnId ? 'executing' : 'idle',
    });
  }

  // ─── Turn execution ────────────────────────────────────────────────

  /**
   * Process a user chat message through ChatController.
   * Enforces max-1-concurrent-turn. Injects event hooks into request context.
   *
   * @param {string} content — User message text
   * @param {Object} [options] — { editMode, conversationId }
   */
  async function processChat(content, options = {}) {
    if (!content || typeof content !== 'string') return;

    // Max 1 concurrent turn
    if (currentTurnId) {
      sendChannel(Channel.CHAT, {
        id: messageId('sys'),
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
        context: {
          turnId,
          signal: abortController.signal,
          editMode: options.editMode || 'auto',

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
              return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                  editPending.delete(reqId);
                  sendAgentEvent('edit_timeout', turnId, { reqId, file: filePath });
                  reject(new Error('Edit request timeout (30s)'));
                }, 30000);
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
        },
      };

      const response = await handleRequest(request);

      // Send final response via chat channel
      sendChannel(Channel.CHAT, {
        id: messageId('msg'),
        type: 'assistant',
        content: response.response,
        timestamp: new Date().toISOString(),
        metadata: {
          mode: response.mode,
          confidence: response.confidence,
          turnId,
          state: response.state,
        },
      });

      // Turn end — success
      sendAgentEvent(AgentEventType.TURN_END, turnId, {
        status: 'ok',
        durationMs: Date.now() - turnStartTime,
      });

    } catch (err) {
      const durationMs = Date.now() - turnStartTime;

      if (err.name === 'AbortError') {
        sendAgentEvent(AgentEventType.TURN_END, turnId, {
          status: 'cancelled_by_user',
          durationMs,
        });
      } else if (err.message?.includes('timeout')) {
        sendAgentEvent(AgentEventType.TURN_END, turnId, {
          status: 'timeout',
          durationMs,
          error: err.message,
        });
        sendAgentEvent(AgentEventType.ERROR, turnId, {
          code: 'TIMEOUT',
          message: err.message,
          recoverable: true,
        });
      } else {
        logger.error('WSSession', `Turn error: ${err.message}`, { turnId });
        sendAgentEvent(AgentEventType.TURN_END, turnId, {
          status: 'error',
          durationMs,
          error: err.message,
        });
        sendAgentEvent(AgentEventType.ERROR, turnId, {
          code: 'UNEXPECTED',
          message: err.message,
          recoverable: false,
        });
      }

      // Send error to chat
      sendChannel(Channel.CHAT, {
        id: messageId('err'),
        type: 'system',
        content: err.name === 'AbortError'
          ? 'Zpracování zrušeno.'
          : `Chyba: ${err.message}`,
        timestamp: new Date().toISOString(),
      });

    } finally {
      // Broadcast real context % estimate based on turn count
      const estimatedTokens = turnCounter * 800; // rough estimate per turn
      const tokenBudget = 32000;
      const contextPercent = Math.min(95, Math.round((estimatedTokens / tokenBudget) * 100));

      currentTurnId = null;
      abortController = null;

      sendChannel(Channel.STATUS, {
        agentStatus: 'idle',
        contextPercent: contextPercent,
      });
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
        error: 'Invalid terminal request: type must be "exec" with a non-empty command string.',
      });
      return;
    }

    const reqId = data.reqId || `term-${Date.now()}`;
    const startTime = Date.now();

    // Notify IDE that execution started
    sendChannel(Channel.TERMINAL, {
      type: 'exec_start',
      reqId,
      command: data.command,
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
        signal: abortController?.signal,
      });

      sendChannel(Channel.TERMINAL, {
        type: 'exec_result',
        reqId,
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
   * @param {Object} data — { action: 'cancel' | 'ping' }
   */
  function handleControl(data) {
    switch (data.action) {
      case 'cancel':
        if (abortController) {
          abortController.abort();
          logger.info('WSSession', 'Execution cancelled by user', { sessionId: sid });
        }
        sendChannel(Channel.CONTROL, { action: 'cancel', success: true });
        break;

      case 'ping':
        sendChannel(Channel.CONTROL, { action: 'pong', success: true });
        break;

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
                sendAgentEvent('edit_conflict', currentTurnId, {
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
        })();
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
    if (abortController) {
      abortController.abort();
    }
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
    get isExecuting() { return currentTurnId !== null; },
    get currentTurnId() { return currentTurnId; },
    processChat,
    handleTerminal,
    handleControl,
    sendStatus,
    cleanup,
  };
}
