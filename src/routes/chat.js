// H9: Chat, Conversations, Drafts & Memory routes
export function createChatRoutes(deps) {
  const { db, parseBody, sendJSON, sendStaticFile, safeError, safeParseInt, logger, ChatController } = deps;
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

    // ══════════════════════════════════════════════════════════════════════════
    // POST /chat, Chat UI, Export Pipeline
    // ══════════════════════════════════════════════════════════════════════════

    'POST /chat': async (req, res) => {
      const body = await parseBody(req);
      const { message, session_id } = body;

      if (!message) {
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
          userId: null,
          signal: abortController.signal,  // v63.0: propagate cancel signal
          context: {
            hasActiveProject: false,
          },
        });

        if (abortController.signal.aborted) return; // Client gone — don't send response

        sendJSON(res, 200, {
          response: result.response,
          mode: result.mode,
          confidence: result.confidence,
          session_id: sessionId, // v56.0: Return session_id for continuity
        });

      } catch (err) {
        if (abortController.signal.aborted) return; // Client gone
        logger.error('Server', `Chat error: ${err.message}`);
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

      try {
        const { exportConversation } = await import('../chat/export-pipeline.js');
        const result = await exportConversation(conversation_id, {
          format: format || 'md',
          scope: scope || 'conversation',
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

      try {
        const conversations = db.conversations.listRecent.all(limit);
        sendJSON(res, 200, { conversations });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    'POST /api/conversations': async (req, res) => {
      const body = await parseBody(req);
      const { project_id, title } = body;

      try {
        const id = `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const conversation = db.conversations.getOrCreate(id, project_id || null, title || null);

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
        const messages = db.messages.listByConversation.all(params.id);
        sendJSON(res, 200, { messages });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // Delete conversation
    'DELETE /api/conversations/:id': async (req, res, params) => {
      try {
        // Delete messages first (foreign key)
        db.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(params.id);
        // Delete attachments
        db.db.prepare('DELETE FROM attachments WHERE conversation_id = ?').run(params.id);
        // Delete conversation
        db.db.prepare('DELETE FROM conversations WHERE id = ?').run(params.id);

        sendJSON(res, 200, { success: true });
      } catch (err) {
        sendJSON(res, 500, safeError(err));
      }
    },

    // Chat (send message)
    // v44.0: ALL chat goes through ChatController - THE ONLY entry point
    // v56.0 Sprint 3: DB persistence now handled by ConversationStore inside ChatController.handle
    'POST /api/chat': async (req, res) => {
      const body = await parseBody(req);
      const { conversation_id, project_id, message } = body;

      if (!conversation_id || !message) {
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
        // v56.0: No manual DB writes here — ChatController.handle persists via ConversationStore
        logger.info('Server', `[ChatController] Processing: "${message.substring(0, 50)}..."`);

        const result = await ChatController.handle({
          message,
          sessionId: conversation_id,
          userId: body.userId || null,
          signal: abortController.signal,  // v63.0: propagate cancel signal
          context: {
            projectId: project_id,
            hasActiveProject: !!project_id,
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
        sendJSON(res, 200, { draft });
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
