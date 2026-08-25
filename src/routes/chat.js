// H9: Chat, Conversations, Drafts & Memory routes
import {
  chatTurnErrorPayload,
  isChatTurnError,
} from '../core/chat-turn-error.js';
import {
  AbortSource,
  abortSourceOf,
  abortWithReason,
  isAbortError,
  throwIfAborted,
} from '../core/abort-error.js';
import {
  M1_CONTRACT_KIND,
  M1_CONTRACT_VERSION,
  validateConversationCommand,
  validateConversationResult,
} from '../../contracts/m1/index.js';

const DEFAULT_M1_CHAT_TIMEOUT_MS = 5 * 60 * 1000;

function m1Identity(command) {
  return {
    requestId: command.requestId,
    conversationId: command.conversationId,
    turnId: command.turnId,
  };
}

export function createM1ConversationResult(command, terminal) {
  const result = {
    contract: M1_CONTRACT_KIND.CONVERSATION_RESULT,
    version: M1_CONTRACT_VERSION,
    ...m1Identity(command),
    ...terminal,
  };
  const validation = validateConversationResult(result);
  if (!validation.valid) {
    const error = new Error('M1 conversation result violated the connector contract');
    error.code = 'M1_CONVERSATION_RESULT_INVALID';
    error.validationErrors = validation.errors;
    throw error;
  }
  return result;
}

export function mapM1ConversationFailure(command, error, signal = null) {
  if (isAbortError(error) || signal?.aborted) {
    const source = abortSourceOf(error, signal);
    if (source === AbortSource.TIMEOUT) {
      return {
        statusCode: 504,
        result: createM1ConversationResult(command, {
          status: 'timeout',
          error: {
            code: 'CHAT_TIMEOUT',
            message: 'Chat request timed out.',
          },
        }),
      };
    }
    return {
      statusCode: 409,
      result: createM1ConversationResult(command, {
        status: 'cancelled',
        error: {
          code: 'CHAT_CANCELLED',
          message: 'Chat request was cancelled.',
        },
      }),
    };
  }

  if (isChatTurnError(error)) {
    const payload = chatTurnErrorPayload(error);
    return {
      statusCode: error.statusCode,
      result: createM1ConversationResult(command, {
        status: 'error',
        error: {
          code: payload.code,
          message: payload.message,
        },
      }),
    };
  }

  return {
    statusCode: 500,
    result: createM1ConversationResult(command, {
      status: 'error',
      error: {
        code: 'CHAT_PROCESSING_FAILED',
        message: 'Chat processing failed.',
      },
    }),
  };
}

function sendTerminalChatError(res, error, sendJSON) {
  if (!isChatTurnError(error)) return false;
  const payload = chatTurnErrorPayload(error);
  sendJSON(res, error.statusCode, {
    error: payload.message,
    code: payload.code,
    recoverable: payload.recoverable,
  });
  return true;
}

export function createChatRoutes(deps) {
  const {
    db, parseBody, sendJSON, sendStaticFile, safeError, safeParseInt,
    logger, ChatController, config, expertiseLayer,
  } = deps;
  const configuredM1Timeout = deps.m1ChatTimeoutMs;
  const m1ChatTimeoutMs = Number.isFinite(configuredM1Timeout)
    && configuredM1Timeout > 0
    ? configuredM1Timeout
    : DEFAULT_M1_CHAT_TIMEOUT_MS;
  const activeM1Turns = new Map();

  async function waitForM1TurnCompletion(activeTurn) {
    let timeout;
    try {
      return await Promise.race([
        activeTurn.completion,
        new Promise(resolve => {
          timeout = setTimeout(
            () => resolve({ status: 'confirmation-timeout' }),
            m1ChatTimeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function handleM1ConversationCommand(req, res, body) {
    const validation = validateConversationCommand(body);
    if (!validation.valid) {
      return sendJSON(res, 400, {
        error: 'Invalid M1 ConversationCommand.',
        code: 'M1_CONVERSATION_COMMAND_INVALID',
        details: validation.errors,
      });
    }

    if (body.action === 'cancel') {
      const activeTurn = activeM1Turns.get(body.conversationId);
      if (!activeTurn) {
        return sendJSON(res, 409, createM1ConversationResult(body, {
          status: 'error',
          error: {
            code: 'M1_HTTP_CANCEL_NOT_ACTIVE',
            message: 'The conversation has no active turn to cancel.',
          },
        }));
      }
      if (body.requestId === activeTurn.requestId) {
        return sendJSON(res, 409, createM1ConversationResult(body, {
          status: 'error',
          error: {
            code: 'M1_HTTP_CANCEL_IDENTITY_CONFLICT',
            message: 'The cancel operation must have its own request identity.',
          },
        }));
      }

      abortWithReason(
        activeTurn.abortController,
        AbortSource.USER,
        'Active conversation turn cancelled by an M1 HTTP command',
      );
      const targetTerminal = await waitForM1TurnCompletion(activeTurn);
      if (targetTerminal.status === 'confirmation-timeout') {
        return sendJSON(res, 504, createM1ConversationResult(body, {
          status: 'timeout',
          error: {
            code: 'CHAT_TIMEOUT',
            message: 'Timed out while waiting for cancellation confirmation.',
          },
        }));
      }
      if (targetTerminal.status !== 'cancelled') {
        return sendJSON(res, 409, createM1ConversationResult(body, {
          status: 'error',
          error: {
            code: 'M1_HTTP_CANCEL_NOT_CONFIRMED',
            message: 'The active turn did not confirm user cancellation.',
          },
        }));
      }

      logger.info('ChatRoutes', 'M1 conversation-scoped cancel confirmed', {
        cancelRequestId: body.requestId,
        targetRequestId: activeTurn.requestId,
        conversationId: body.conversationId,
      });
      return sendJSON(res, 200, createM1ConversationResult(body, {
        status: 'cancelled',
        error: {
          code: 'CHAT_CANCELLED',
          message: 'The active conversation turn was cancelled.',
        },
      }));
    }

    if (activeM1Turns.has(body.conversationId)) {
      return sendJSON(res, 409, createM1ConversationResult(body, {
        status: 'error',
        error: {
          code: 'M1_CONVERSATION_BUSY',
          message: 'The conversation already has an active turn.',
        },
      }));
    }

    const abortController = new AbortController();
    let resolveCompletion;
    const completion = new Promise(resolve => { resolveCompletion = resolve; });
    const activeTurn = {
      requestId: body.requestId,
      turnId: body.turnId,
      abortController,
      completion,
    };
    activeM1Turns.set(body.conversationId, activeTurn);
    let terminalStatus = 'error';
    let peerDisconnected = false;
    const cancelForDisconnect = () => {
      peerDisconnected = true;
      abortWithReason(abortController, AbortSource.USER);
    };
    const cancelForClosedResponse = () => {
      if (!res.writableEnded) cancelForDisconnect();
    };
    req.once?.('aborted', cancelForDisconnect);
    res.once?.('close', cancelForClosedResponse);

    const timeout = setTimeout(() => {
      abortWithReason(
        abortController,
        AbortSource.TIMEOUT,
        `M1 HTTP chat timeout after ${m1ChatTimeoutMs}ms`,
      );
    }, m1ChatTimeoutMs);

    try {
      const controllerResult = await ChatController.handle({
        message: body.input,
        sessionId: body.requestId,
        conversationId: body.conversationId,
        requestId: body.requestId,
        turnId: body.turnId,
        signal: abortController.signal,
        authenticatedSubject: req.authenticatedSubject || null,
        context: {
          requestId: body.requestId,
          conversationId: body.conversationId,
          turnId: body.turnId,
        },
      });
      throwIfAborted(abortController.signal);

      const result = createM1ConversationResult(body, {
        status: 'ok',
        response: {
          content: controllerResult.response,
          metadata: {
            mode: controllerResult.mode,
            confidence: controllerResult.confidence,
          },
        },
      });
      terminalStatus = result.status;
      if (!peerDisconnected && !res.writableEnded) {
        sendJSON(res, 200, result);
      }
    } catch (error) {
      logger.error('ChatRoutes', `M1 chat failed: ${error.message}`);
      const terminal = mapM1ConversationFailure(
        body,
        error,
        abortController.signal,
      );
      terminalStatus = terminal.result.status;
      if (!peerDisconnected && !res.writableEnded) {
        sendJSON(res, terminal.statusCode, terminal.result);
      }
    } finally {
      clearTimeout(timeout);
      req.off?.('aborted', cancelForDisconnect);
      res.off?.('close', cancelForClosedResponse);
      if (activeM1Turns.get(body.conversationId) === activeTurn) {
        activeM1Turns.delete(body.conversationId);
      }
      resolveCompletion({ status: terminalStatus });
    }
  }

  return {
    // ══════════════════════════════════════════════════════════════════════════
    // Chat Session Management
    // ══════════════════════════════════════════════════════════════════════════

    'GET /api/chat/sessions/stats': (req, res) => {
      const stats = ChatController.getStats();
      sendJSON(res, 200, stats);
    },

    'GET /api/chat/sessions': (req, res) => {
      const sessionIds = ChatController.getActiveSessions();
      const sessions = sessionIds.map(id => ({
        sessionId: id,
        ...ChatController.getSessionInfo(id)
      }));
      sendJSON(res, 200, { sessions, total: sessions.length });
    },

    'GET /api/chat/sessions/:sessionId': (req, res, params) => {
      const info = ChatController.getSessionInfo(params.sessionId);
      if (!info.exists) {
        return sendJSON(res, 404, { error: 'Session not found' });
      }
      sendJSON(res, 200, info);
    },

    'DELETE /api/chat/sessions/:sessionId': (req, res, params) => {
      const info = ChatController.getSessionInfo(params.sessionId);
      if (!info.exists) {
        return sendJSON(res, 404, { error: 'Session not found' });
      }
      ChatController.removeSession(params.sessionId);
      sendJSON(res, 200, { success: true, deleted: params.sessionId });
    },

    // D5: Set active specialist for a chat session
    'POST /api/chat/specialist': async (req, res) => {
      try {
        const body = await parseBody(req);
        const sessionId = body.sessionId || 'session-0';
        if (!body.specialistId) {
          return sendJSON(res, 400, { error: 'specialistId is required' });
        }
        // Load specialist manifest
        const { getSpecialistLoader } = await import('../specialists/specialist-loader.js');
        const loader = getSpecialistLoader();
        const manifest = loader.getManifest(body.specialistId);
        if (!manifest) {
          return sendJSON(res, 404, { error: `Specialist not found: ${body.specialistId}` });
        }
        const enabled = loader.getEnabled().some(row => row.id === body.specialistId);
        if (!enabled) {
          return sendJSON(res, 409, {
            error: `Specialist is disabled: ${body.specialistId}`,
            errorCode: 'M3_SPECIALIST_UNAVAILABLE',
          });
        }
        ChatController.setSpecialist(sessionId, {
          id: manifest.id,
          version: manifest.version,
          name: manifest.name,
          domain: manifest.domain,
          description: manifest.description,
          tools: manifest.tools,
          primaryExpertiseId: manifest.expertises?.[0] || manifest.id,
        });
        sendJSON(res, 200, { ok: true, specialistId: manifest.id });
      } catch (err) {
        logger.error('ChatRoutes', `POST /api/chat/specialist failed: ${err.message}`);
        sendJSON(res, 500, { error: err.message });
      }
    },

    // D5: Clear active specialist
    'DELETE /api/chat/specialist': async (req, res) => {
      try {
        const body = await parseBody(req);
        const sessionId = body.sessionId || 'session-0';
        const state = ChatController.getState(sessionId);
        if (state) state.clearSpecialist();
        sendJSON(res, 200, { ok: true });
      } catch (err) {
        logger.error('ChatRoutes', `DELETE /api/chat/specialist failed: ${err.message}`);
        sendJSON(res, 500, { error: err.message });
      }
    },

    // ══════════════════════════════════════════════════════════════════════════
    // POST /chat, Chat UI, Export Pipeline
    // ══════════════════════════════════════════════════════════════════════════

    'POST /chat': async (req, res) => {
      const body = await parseBody(req);
      const { message, session_id } = body;

      if (typeof message !== 'string' || message.trim() === '') {
        return sendJSON(res, 400, { error: 'message is required' });
      }

      // v63.0: AbortController for client disconnect detection
      const abortController = new AbortController();
      req.on('close', () => {
        if (!res.writableEnded) {
          logger.info('Server', '[POST /chat] Client disconnected mid-processing');
          abortController.abort();
        }
      });

      try {
        // v56.0 Sprint 3: Use provided session_id or create a proper one
        const sessionId = session_id || `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        const result = await ChatController.handle({
          message,
          sessionId,
          expertise: body.expertise || undefined,  // v79: forward expertise for E2E testing
          userId: null,
          authenticatedSubject: req.authenticatedSubject || null,
          signal: abortController.signal,  // v63.0: propagate cancel signal
          attachments: body.attachments || [],  // v81.1: file attachments from IDE
          conversationId: body.conversationId || null,
          context: {
            hasActiveProject: false,
            projectId: body.projectId || null,
          },
        });

        if (abortController.signal.aborted) return; // Client gone — don't send response

        sendJSON(res, 200, {
          response: result.response,
          mode: result.mode,
          confidence: result.confidence,
          metadata: result.metadata || {},
          state: result.state || null,
          session_id: sessionId, // v56.0: Return session_id for continuity
        });

      } catch (err) {
        if (abortController.signal.aborted) return; // Client gone
        logger.error('Server', `Chat error: ${err.message}`);
        if (sendTerminalChatError(res, err, sendJSON)) return;
        sendJSON(res, 500, safeError(err));
      }
    },

    // ══════════════════════════════════════════════════════════════════════════
    // v56.1 Sprint 4C: CHAT UI
    // ══════════════════════════════════════════════════════════════════════════

    'GET /chat-ui': async (req, res) => {
      await sendStaticFile(res, 'src/chat/chat.html', 'text/html');
    },

    // ══════════════════════════════════════════════════════════════════════════
    // v56.1 Sprint 4B: EXPORT PIPELINE
    // ══════════════════════════════════════════════════════════════════════════

    'POST /api/export': async (req, res) => {
      const body = await parseBody(req);
      const { conversation_id, format, scope } = body;

      if (!conversation_id) {
        return sendJSON(res, 400, { error: 'conversation_id is required' });
      }
      if (format !== undefined && !['md', 'html', 'txt', 'pdf', 'docx', 'xlsx'].includes(format)) {
        return sendJSON(res, 400, { error: `Unsupported export format: ${format}` });
      }
      if (scope !== undefined && !['last', 'conversation', 'summary'].includes(scope)) {
        return sendJSON(res, 400, { error: `Unsupported export scope: ${scope}` });
      }

      try {
        const { exportConversation } = await import('../chat/export-pipeline.js');
        const pathModule = await import('path');
        const artifactsDir = pathModule.resolve(
          pathModule.dirname(config.db.path),
          'artifacts',
        );
        const result = await exportConversation(conversation_id, {
          format: format || 'md',
          scope: scope || 'conversation',
          artifactsDir,
        });

        sendJSON(res, 200, {
          filename: result.filename,
          download_url: result.downloadUrl,
          format: result.format,
          scope: result.scope,
          size: result.size,
          turn_count: result.turnCount,
        });
      } catch (err) {
        logger.error('Server', `Export error: ${err.message}`);
        if (/^Export: conversation .+ not found$/.test(err.message)) {
          return sendJSON(res, 404, { error: err.message });
        }
        if (err.message === 'Export: no messages to export') {
          return sendJSON(res, 409, { error: err.message });
        }
        sendJSON(res, 500, safeError(err));
      }
    },

    // ══════════════════════════════════════════════════════════════════════════
    // Memory API
    // ══════════════════════════════════════════════════════════════════════════

    // Memory API
    'GET /api/memory': async (req, res) => {
      try {
        const row = db.db.prepare('SELECT data FROM user_memory WHERE id = 1').get();
        if (row) {
          sendJSON(res, 200, JSON.parse(row.data));
        } else {
          sendJSON(res, 200, []);
        }
      } catch (err) {
        sendJSON(res, 200, []);
      }
    },

    'POST /api/memory': async (req, res) => {
      const body = await parseBody(req);
      // H6: Validate memory payload — max 100KB, must be array or object
      const json = JSON.stringify(body);
      if (json.length > 100 * 1024) {
        return sendJSON(res, 400, { error: 'Memory payload too large (max 100KB)' });
      }
      if (typeof body !== 'object' || body === null) {
        return sendJSON(res, 400, { error: 'Memory payload must be a JSON object or array' });
      }
      try {
        db.db.prepare(`
          INSERT OR REPLACE INTO user_memory (id, data, updated_at)
          VALUES (1, ?, datetime('now'))
        `).run(json);
        sendJSON(res, 200, { success: true });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // ══════════════════════════════════════════════════════════════════════════
    // Conversations CRUD + POST /api/chat
    // ══════════════════════════════════════════════════════════════════════════

    // Conversations
    'GET /api/conversations': async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const limit = parseInt(url.searchParams.get('limit')) || 10;
      const status = url.searchParams.get('status'); // active | archived | deleted | all

      try {
        let conversations;
        if (status === 'archived') {
          conversations = db.conversations.listArchived.all(limit);
        } else if (status === 'deleted') {
          conversations = db.conversations.listDeleted.all(limit);
        } else if (status === 'all') {
          conversations = db.conversations.listNotDeleted.all(limit);
        } else {
          // Default: active only
          conversations = (db.conversations.listActive?.all(limit)) ?? db.conversations.listRecentGlobal.all(limit);
        }
        sendJSON(res, 200, { conversations });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /api/conversations': async (req, res) => {
      const body = await parseBody(req);
      const { project_id, title, welcomeMessage } = body;

      try {
        const id = `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const conversation = db.conversations.getOrCreate(id, project_id || null, title || null);

        // v89: Persist welcome message as first assistant turn
        if (welcomeMessage && typeof welcomeMessage === 'string' && welcomeMessage.trim().length > 0) {
          try {
            const { ConversationStore, TurnRole } = await import('../chat/conversation-store.js');
            const store = new ConversationStore(db);
            store.appendTurn(id, TurnRole.ASSISTANT, welcomeMessage.trim(), {
              mode: 'PROJECT',
              intent: 'PROJECT_WELCOME',
              projectWelcome: true,
            });
          } catch { /* non-fatal — welcome just won't persist */ }
        }

        sendJSON(res, 201, { conversation });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    'GET /api/conversations/:id': async (req, res, params) => {
      try {
        const conversation = db.conversations.findById.get(params.id);

        if (!conversation) {
          return sendJSON(res, 404, { error: 'Conversation not found' });
        }

        sendJSON(res, 200, { conversation });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    'GET /api/conversations/:id/messages': async (req, res, params) => {
      try {
        const snapshot = db.transaction(() => {
          const conversation = db.conversations.findById.get(params.id);
          if (!conversation) return { found: false };
          return {
            found: true,
            messages: db.messages.listByConversation.all(params.id),
          };
        });
        if (!snapshot || snapshot.found !== true) {
          if (snapshot?.found === false) {
            return sendJSON(res, 404, {
              error: 'Conversation not found',
              code: 'CONVERSATION_NOT_FOUND',
            });
          }
          throw new Error('Conversation history snapshot is unavailable');
        }
        if (!Array.isArray(snapshot.messages)) {
          throw new Error('Conversation history snapshot is invalid');
        }
        sendJSON(res, 200, { messages: snapshot.messages });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // Update conversation (project assignment, title, etc.)
    'PUT /api/conversations/:id': async (req, res, params) => {
      const body = await parseBody(req);

      try {
        const conversation = db.conversations.findById.get(params.id);
        if (!conversation) {
          return sendJSON(res, 404, { error: 'Conversation not found' });
        }

        if (body.project_id !== undefined) {
          // Validate project exists before FK update
          if (body.project_id !== null) {
            const project = db.projects.findById.get(body.project_id);
            if (!project) {
              return sendJSON(res, 400, { error: 'Project not found', project_id: body.project_id });
            }
          }
          db.conversations.assignToProject.run(body.project_id, params.id);
        }

        if (body.title !== undefined) {
          db.conversations.updateTitle.run(body.title, params.id);
        }

        const updated = db.conversations.findById.get(params.id);
        sendJSON(res, 200, { conversation: updated });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // Archive conversation
    'PATCH /api/conversations/:id/archive': async (req, res, params) => {
      try {
        const conv = db.conversations.findById.get(params.id);
        if (!conv) return sendJSON(res, 404, { error: 'Conversation not found' });

        db.conversations.archive.run(params.id);
        sendJSON(res, 200, { success: true, status: 'archived' });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // Restore conversation from archive
    'PATCH /api/conversations/:id/restore': async (req, res, params) => {
      try {
        const conv = db.conversations.findById.get(params.id);
        if (!conv) return sendJSON(res, 404, { error: 'Conversation not found' });

        db.conversations.restore.run(params.id);
        sendJSON(res, 200, { success: true, status: 'active' });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // Delete conversation (soft by default, hard with ?hard=true)
    'DELETE /api/conversations/:id': async (req, res, params) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const hard = url.searchParams.get('hard') === 'true';

        const conv = db.conversations.findById.get(params.id);
        if (!conv) return sendJSON(res, 404, { error: 'Conversation not found' });

        if (hard) {
          // Hard delete — only for already soft-deleted conversations
          if (conv.state !== 'deleted') {
            return sendJSON(res, 400, { error: 'Only soft-deleted conversations can be hard-deleted' });
          }
          db.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(params.id);
          db.db.prepare('DELETE FROM attachments WHERE conversation_id = ?').run(params.id);
          db.db.prepare('DELETE FROM conversations WHERE id = ?').run(params.id);
          sendJSON(res, 200, { success: true, mode: 'hard' });
        } else {
          // Soft delete (default)
          db.conversations.softDelete.run(params.id);
          sendJSON(res, 200, { success: true, mode: 'soft' });
        }
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // Chat (send message)
    // v44.0: ALL chat goes through ChatController - THE ONLY entry point
    // v56.0 Sprint 3: DB persistence now handled by ConversationStore inside ChatController.handle
    'POST /api/chat': async (req, res) => {
      const body = await parseBody(req);
      if (body?.contract === M1_CONTRACT_KIND.CONVERSATION_COMMAND) {
        return handleM1ConversationCommand(req, res, body);
      }
      const { conversation_id, project_id, message } = body;

      if (
        typeof conversation_id !== 'string'
        || conversation_id.trim() === ''
        || typeof message !== 'string'
        || message.trim() === ''
      ) {
        return sendJSON(res, 400, { error: 'conversation_id and message are required' });
      }

      // v63.0: AbortController for client disconnect detection
      const abortController = new AbortController();
      req.on('close', () => {
        if (!res.writableEnded) {
          logger.info('Server', `[POST /api/chat] Client disconnected mid-processing (conv: ${conversation_id})`);
          abortController.abort();
        }
      });

      try {
        const conversation = db.conversations.findById.get(conversation_id);
        const storedProjectId = conversation?.project_id == null
          ? null
          : Number(conversation.project_id);
        let requestedProjectId = null;

        if (project_id !== undefined && project_id !== null) {
          requestedProjectId = Number(project_id);
          if (!Number.isSafeInteger(requestedProjectId) || requestedProjectId <= 0) {
            return sendJSON(res, 400, {
              error: 'project_id must be a positive integer',
            });
          }
          if (!db.projects.findById.get(requestedProjectId)) {
            return sendJSON(res, 404, {
              error: 'Project not found',
              project_id: requestedProjectId,
            });
          }
          if (storedProjectId !== null && storedProjectId !== requestedProjectId) {
            return sendJSON(res, 409, {
              error: 'Conversation is bound to a different project',
              conversation_id,
              project_id: storedProjectId,
            });
          }
        }

        const effectiveProjectId = storedProjectId ?? requestedProjectId;

        // v56.0: No manual DB writes here — ChatController.handle persists via ConversationStore
        logger.info('Server', `[ChatController] Processing: "${message.substring(0, 50)}..."`);

        let expertise;
        if (body.expertise_id !== undefined) {
          if (typeof body.expertise_id !== 'string' || body.expertise_id.trim() === '') {
            return sendJSON(res, 400, { error: 'expertise_id must be a non-empty string' });
          }
          const expertiseId = body.expertise_id.trim();
          const registered = expertiseLayer?.expertiseRegistry?.get(expertiseId);
          if (!registered) {
            return sendJSON(res, 404, { error: `Expertise not found: ${expertiseId}` });
          }
          expertise = registered.toJSON();
        }

        const result = await ChatController.handle({
          message,
          sessionId: conversation_id,
          userId: body.userId || null,
          authenticatedSubject: req.authenticatedSubject || null,
          expertise,
          attachments: body.attachments || [],
          signal: abortController.signal,  // v63.0: propagate cancel signal
          context: {
            projectId: effectiveProjectId,
            hasActiveProject: effectiveProjectId !== null,
          },
        });

        if (abortController.signal.aborted) return; // Client gone

        logger.info('Server', `[ChatController] Mode: ${result.mode}, Confidence: ${result.confidence.toFixed(2)}`);

        sendJSON(res, 200, {
          response: result.response,
          mode: result.mode,
          confidence: result.confidence,
          metadata: result.metadata,
        });

      } catch (err) {
        if (abortController.signal.aborted) return; // Client gone
        logger.error('Server', `Chat error: ${err.message}`);
        if (sendTerminalChatError(res, err, sendJSON)) return;
        sendJSON(res, 500, safeError(err));
      }
    },

    // ══════════════════════════════════════════════════════════════════════════
    // Drafts
    // ══════════════════════════════════════════════════════════════════════════

    // Drafts
    'GET /api/drafts': async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const conversationId = url.searchParams.get('conversation_id');
      const projectId = url.searchParams.get('project_id');

      try {
        const draft = db.drafts.get(conversationId, projectId ? parseInt(projectId) : null);
        sendJSON(res, 200, { draft: draft || null });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /api/drafts': async (req, res) => {
      const body = await parseBody(req);
      const { conversation_id, project_id, content } = body;

      if (!content) {
        return sendJSON(res, 400, { error: 'content is required' });
      }

      try {
        db.drafts.save(content, conversation_id, project_id ? parseInt(project_id) : null);
        sendJSON(res, 200, { success: true });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    'DELETE /api/drafts': async (req, res) => {
      const body = await parseBody(req);
      const { conversation_id, project_id } = body;

      try {
        db.drafts.clear(conversation_id, project_id ? parseInt(project_id) : null);
        sendJSON(res, 200, { success: true });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },
  };
}
