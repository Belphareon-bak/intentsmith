// CRE v56.0 — Sprint 3: Conversation Store
// ══════════════════════════════════════════════════════════════════════════════
//
// SINGLE SOURCE OF TRUTH for conversation state.
//
// Architecture:
//   DB is authoritative. RAM is cache, not truth.
//   If it's not in DB, it doesn't exist.
//
//   ChatController → ConversationStore → DB (SQLite)
//                                       ↑ only source
//
// Invariants:
//   ❗ Every turn MUST be persisted before response is returned
//   ❗ History reads ALWAYS come from DB, never from RAM cache
//   ❗ Session IDs MUST be explicit — no implicit creation
//   ❗ Restart = same state (verified by T9.1)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Turn Role Types
// ─────────────────────────────────────────────────────────────────────────────

export const TurnRole = Object.freeze({
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
});

// ─────────────────────────────────────────────────────────────────────────────
// Conversation Store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ConversationStore — DB-backed conversation state manager.
 *
 * All state comes from the database.
 * ChatController DOES NOT own conversation history — this module does.
 *
 * @example
 *   const store = new ConversationStore(db);
 *   const conv = store.ensureConversation(sessionId);
 *   store.appendTurn(sessionId, TurnRole.USER, 'Ahoj');
 *   const history = store.getRecentTurns(sessionId, 10);
 */
export class ConversationStore {
  #db;

  /**
   * @param {Object} db — Database module with { conversations, messages } exports
   *                       Must expose prepared statements for CRUD operations.
   *                       Null = in-memory mode (for tests).
   */
  constructor(db = null) {
    this.#db = db;

    // In-memory fallback for tests (no SQLite dependency)
    if (!db) {
      this._memConversations = new Map(); // id → { id, title, message_count, state, created_at, updated_at }
      this._memMessages = [];             // [{ id, conversation_id, role, content, tokens, metadata, created_at }]
      this._nextMsgId = 1;
      this._memSessionStates = new Map(); // sessionId → { session_id, state_json, updated_at }
    }

    // v59.0: Self-migrate session_state table (no database.js changes needed)
    if (db && db.db) {
      try {
        db.db.exec(`
          CREATE TABLE IF NOT EXISTS session_state (
            session_id TEXT PRIMARY KEY,
            state_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          )
        `);
        this._sessionStateStmts = {
          save: db.db.prepare(`
            INSERT OR REPLACE INTO session_state (session_id, state_json, updated_at)
            VALUES (?, ?, ?)
          `),
          load: db.db.prepare(`
            SELECT state_json FROM session_state WHERE session_id = ?
          `),
          delete: db.db.prepare(`
            DELETE FROM session_state WHERE session_id = ?
          `),
          listAll: db.db.prepare(`
            SELECT session_id, updated_at FROM session_state ORDER BY updated_at DESC
          `),
        };
      } catch (err) {
        logger.warn('ConversationStore', `session_state migration failed: ${err.message}`);
        this._sessionStateStmts = null;
      }
    }
  }

  /**
   * Whether this store can authoritatively answer durable identity queries.
   *
   * An in-memory store is useful for focused tests, but it must never be used
   * to invalidate identities created by the durable SQLite runtime. Keep this
   * as an explicit capability instead of inferring authority from exists().
   *
   * @returns {boolean}
   */
  isDurableReady() {
    try {
      const database = this.#db?.db;
      return Boolean(
        database
        && database.open === true
        && database.memory === false
        && typeof this.#db?.conversations?.findById?.get === 'function'
      );
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Conversation CRUD
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Ensure a conversation exists in DB. Create if missing.
   *
   * @param {string} conversationId — Explicit ID (NOT auto-generated)
   * @param {Object} [opts]
   * @param {number} [opts.projectId] — Optional project association
   * @param {string} [opts.title] — Optional title
   * @returns {{ id: string, isNew: boolean }}
   */
  ensureConversation(conversationId, opts = {}) {
    if (!conversationId || typeof conversationId !== 'string') {
      throw new Error('ConversationStore: conversationId is required and must be a string');
    }

    // Validate projectId FK before using it — avoids FOREIGN KEY constraint failed
    let safeProjectId = opts.projectId || null;
    if (safeProjectId && this.#db) {
      try {
        const project = this.#db.projects.findById.get(safeProjectId);
        if (!project) {
          logger.warn('ConversationStore', `projectId ${safeProjectId} not found in projects table, ignoring`, {
            conversationId: conversationId.substring(0, 20),
          });
          safeProjectId = null;
        }
      } catch (err) {
        logger.warn('ConversationStore', `projectId validation failed: ${err.message}`);
        safeProjectId = null;
      }
    }

    if (this.#db) {
      // DB mode: use getOrCreate
      const existing = this.#db.conversations.findById.get(conversationId);
      if (existing) {
        // Update project_id if provided and conversation doesn't have one yet
        if (safeProjectId && !existing.project_id) {
          try {
            this.#db.conversations.assignToProject.run(safeProjectId, conversationId);
            logger.info('ConversationStore', `Linked conversation to project`, {
              conversationId: conversationId.substring(0, 20),
              projectId: safeProjectId,
            });
          } catch (err) {
            logger.warn('ConversationStore', `Failed to link conversation to project: ${err.message}`);
          }
        }
        return { id: conversationId, isNew: false };
      }
      this.#db.conversations.create.run(
        conversationId,
        safeProjectId,
        opts.title || null,
        null
      );
      return { id: conversationId, isNew: true };
    }

    // In-memory mode
    if (this._memConversations.has(conversationId)) {
      return { id: conversationId, isNew: false };
    }
    this._memConversations.set(conversationId, {
      id: conversationId,
      title: opts.title || null,
      project_id: opts.projectId || null,
      message_count: 0,
      state: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    return { id: conversationId, isNew: true };
  }

  /**
   * Get conversation metadata.
   * @param {string} conversationId
   * @returns {Object|null}
   */
  getConversation(conversationId) {
    if (this.#db) {
      return this.#db.conversations.findById.get(conversationId) || null;
    }
    return this._memConversations.get(conversationId) || null;
  }

  /**
   * Check if conversation exists.
   * @param {string} conversationId
   * @returns {boolean}
   */
  exists(conversationId) {
    return this.getConversation(conversationId) !== null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Turn Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Append a turn to the conversation. Persists IMMEDIATELY.
   *
   * INVARIANT: This must be called BEFORE returning a response to the user.
   *
   * @param {string} conversationId
   * @param {string} role — TurnRole.USER | TurnRole.ASSISTANT | TurnRole.SYSTEM
   * @param {string} content — Message content
   * @param {Object} [metadata] — Optional metadata (intent, confidence, model, etc.)
   * @returns {{ id: number, persisted: boolean }}
   */
  appendTurn(conversationId, role, content, metadata = {}) {
    if (!conversationId) {
      throw new Error('ConversationStore.appendTurn: conversationId is required');
    }
    if (!Object.values(TurnRole).includes(role)) {
      throw new Error(`ConversationStore.appendTurn: invalid role "${role}"`);
    }
    if (!content || typeof content !== 'string') {
      throw new Error('ConversationStore.appendTurn: content must be a non-empty string');
    }

    // Auto-create conversation if needed
    this.ensureConversation(conversationId);

    const metaStr = typeof metadata === 'string' ? metadata : JSON.stringify(metadata);
    const tokens = Math.ceil(content.length / 4); // rough estimate

    if (this.#db) {
      try {
        const result = this.#db.messages.add.run(
          conversationId, role, content, tokens, metaStr
        );
        logger.debug('ConversationStore', `Turn persisted`, {
          conversationId: conversationId.substring(0, 12),
          role,
          tokens,
          msgId: result.lastInsertRowid,
        });
        return { id: Number(result.lastInsertRowid), persisted: true };
      } catch (err) {
        logger.error('ConversationStore', `Failed to persist turn: ${err.message}`, {
          conversationId,
          role,
        });
        // CRITICAL: Do NOT silently fall back to RAM. Fail loudly.
        throw new Error(`ConversationStore: DB write failed — ${err.message}`);
      }
    }

    // In-memory mode
    const id = this._nextMsgId++;
    this._memMessages.push({
      id,
      conversation_id: conversationId,
      role,
      content,
      tokens,
      metadata: metaStr,
      created_at: new Date().toISOString(),
    });

    // Update conversation metadata
    const conv = this._memConversations.get(conversationId);
    if (conv) {
      conv.message_count++;
      conv.updated_at = new Date().toISOString();
    }

    return { id, persisted: true };
  }

  /**
   * Get the last N turns for a conversation. ALWAYS reads from DB.
   *
   * Returns in chronological order (oldest first).
   *
   * @param {string} conversationId
   * @param {number} [n=10] — Number of turns to retrieve
   * @returns {Array<{ id: number, role: string, content: string, metadata: Object, created_at: string }>}
   */
  getRecentTurns(conversationId, n = 10) {
    if (!conversationId) return [];

    let rows;

    if (this.#db) {
      try {
        rows = this.#db.messages.getLastN.all(conversationId, n);
      } catch (err) {
        logger.error('ConversationStore', `Failed to read turns: ${err.message}`);
        return [];
      }
    } else {
      // In-memory mode
      const all = this._memMessages
        .filter(m => m.conversation_id === conversationId)
        .sort((a, b) => a.id - b.id);
      rows = all.slice(-n);
    }

    return (rows || []).map(row => ({
      id: row.id,
      role: row.role,
      content: row.content,
      metadata: this.#parseMetadata(row.metadata),
      created_at: row.created_at,
    }));
  }

  /**
   * Get ALL turns for a conversation (for export / debug).
   *
   * @param {string} conversationId
   * @returns {Array}
   */
  getAllTurns(conversationId) {
    if (!conversationId) return [];

    if (this.#db) {
      try {
        const rows = this.#db.messages.listByConversation.all(conversationId);
        return (rows || []).map(row => ({
          id: row.id,
          role: row.role,
          content: row.content,
          metadata: this.#parseMetadata(row.metadata),
          created_at: row.created_at,
        }));
      } catch (err) {
        logger.error('ConversationStore', `Failed to read all turns: ${err.message}`);
        return [];
      }
    }

    // In-memory
    return this._memMessages
      .filter(m => m.conversation_id === conversationId)
      .sort((a, b) => a.id - b.id)
      .map(row => ({
        id: row.id,
        role: row.role,
        content: row.content,
        metadata: this.#parseMetadata(row.metadata),
        created_at: row.created_at,
      }));
  }

  /**
   * Get turn count for a conversation.
   * @param {string} conversationId
   * @returns {number}
   */
  getTurnCount(conversationId) {
    if (!conversationId) return 0;

    if (this.#db) {
      const conv = this.#db.conversations.findById.get(conversationId);
      return conv?.message_count || 0;
    }

    return this._memMessages.filter(m => m.conversation_id === conversationId).length;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Context Building (for LLM prompts)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Build conversation history string for LLM prompt injection.
   *
   * Format:
   *   user: Ahoj
   *   assistant: Zdravím! Jak vám mohu pomoci?
   *   user: Jaké je počasí?
   *
   * @param {string} conversationId
   * @param {number} [maxTurns=5] — Maximum turns to include
   * @returns {string} — Formatted history string, empty if no history
   */
  buildHistoryContext(conversationId, maxTurns = 5) {
    const turns = this.getRecentTurns(conversationId, maxTurns);
    if (turns.length === 0) return '';

    return turns
      .map(t => `${t.role}: ${t.content}`)
      .join('\n');
  }

  /**
   * Build a structured history array for handler context.
   *
   * This replaces ChatController.#responseHistory.
   *
   * @param {string} conversationId
   * @param {number} [maxTurns=10]
   * @returns {Array<{ response: { tag: { speaker: string }, content: string }, timestamp: number }>}
   */
  buildHandlerHistory(conversationId, maxTurns = 10) {
    // v67.0: Incorporate summary — if exists, prepend as synthetic system turn
    //        and only include turns after the summarized point.
    const summaryData = this.getSummary(conversationId);

    let turns;
    if (summaryData && summaryData.upToMsgId) {
      turns = this.getTurnsAfterId(conversationId, summaryData.upToMsgId);
      if (turns.length > maxTurns) {
        turns = turns.slice(-maxTurns);
      }
    } else {
      turns = this.getRecentTurns(conversationId, maxTurns);
    }

    const history = turns.map(t => ({
      response: {
        tag: { speaker: t.role === 'assistant' ? 'system' : t.role },
        content: t.content,
      },
      timestamp: new Date(t.created_at).getTime(),
    }));

    // Prepend summary as synthetic system turn
    if (summaryData) {
      history.unshift({
        response: {
          tag: { speaker: 'system' },
          content: `[Souhrn předchozí konverzace]\n${summaryData.summary}`,
        },
        timestamp: 0,
        isSummary: true,
      });
    }

    return history;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // v67.0 Auto-Compact Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get estimated total tokens for a conversation.
   * Uses the rough `Math.ceil(content.length / 4)` estimate stored per turn.
   *
   * @param {string} conversationId
   * @returns {number}
   */
  getEstimatedTokens(conversationId) {
    if (!conversationId) return 0;

    if (this.#db) {
      try {
        const row = this.#db.db.prepare(
          'SELECT COALESCE(SUM(tokens), 0) as total FROM messages WHERE conversation_id = ?'
        ).get(conversationId);
        return row?.total || 0;
      } catch (err) {
        logger.warn('ConversationStore', `getEstimatedTokens DB error: ${err.message}`);
        return 0;
      }
    }

    // In-memory
    return this._memMessages
      .filter(m => m.conversation_id === conversationId)
      .reduce((sum, m) => sum + (m.tokens || 0), 0);
  }

  /**
   * Get turns after a specific message ID (for post-summary context).
   *
   * @param {string} conversationId
   * @param {number} afterMsgId — Return turns with id > afterMsgId
   * @returns {Array<{ id: number, role: string, content: string, metadata: Object, created_at: string }>}
   */
  getTurnsAfterId(conversationId, afterMsgId) {
    if (!conversationId) return [];

    if (this.#db) {
      try {
        const rows = this.#db.db.prepare(
          'SELECT id, role, content, tokens, metadata, created_at FROM messages WHERE conversation_id = ? AND id > ? ORDER BY id ASC'
        ).all(conversationId, afterMsgId);
        return (rows || []).map(row => ({
          id: row.id,
          role: row.role,
          content: row.content,
          tokens: row.tokens,
          metadata: this.#parseMetadata(row.metadata),
          created_at: row.created_at,
        }));
      } catch (err) {
        logger.error('ConversationStore', `getTurnsAfterId DB error: ${err.message}`);
        return [];
      }
    }

    // In-memory
    return this._memMessages
      .filter(m => m.conversation_id === conversationId && m.id > afterMsgId)
      .sort((a, b) => a.id - b.id)
      .map(row => ({
        id: row.id,
        role: row.role,
        content: row.content,
        tokens: row.tokens,
        metadata: this.#parseMetadata(row.metadata),
        created_at: row.created_at,
      }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Session Management
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update conversation title (auto-title from first message).
   *
   * @param {string} conversationId
   * @param {string} title
   */
  setTitle(conversationId, title) {
    if (this.#db) {
      this.#db.conversations.updateTitle.run(title, conversationId);
    } else {
      const conv = this._memConversations.get(conversationId);
      if (conv) conv.title = title;
    }
  }

  /**
   * List recent conversations.
   *
   * @param {number} [limit=20]
   * @param {Object} [opts]
   * @param {number} [opts.projectId] — Filter by project
   * @returns {Array}
   */
  listRecent(limit = 20, opts = {}) {
    if (this.#db) {
      if (opts.projectId) {
        return this.#db.conversations.listRecentByProject.all(opts.projectId, limit);
      }
      return this.#db.conversations.listRecent.all(limit);
    }

    // In-memory
    let convs = [...this._memConversations.values()];
    if (opts.projectId) {
      convs = convs.filter(c => c.project_id === opts.projectId);
    }
    return convs
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))
      .slice(0, limit);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Summary Persistence (v56.1 Sprint 4A)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Store a conversation summary for context compression.
   *
   * Summary is a cache — NOT a replacement for turns.
   * `upToMsgId` tracks which turns were summarized.
   *
   * @param {string} conversationId
   * @param {string} summary — The compressed summary text
   * @param {number} upToMsgId — Last turn ID included in this summary
   */
  setSummary(conversationId, summary, upToMsgId) {
    if (!conversationId || typeof conversationId !== 'string') {
      throw new Error('setSummary: conversationId is required');
    }
    if (!summary || typeof summary !== 'string') {
      throw new Error('setSummary: summary must be a non-empty string');
    }

    if (this.#db) {
      try {
        this.#db.db.prepare(
          'UPDATE conversations SET summary = ?, summary_up_to_msg_id = ? WHERE id = ?'
        ).run(summary, upToMsgId, conversationId);
        return;
      } catch (err) {
        logger.warn('ConversationStore', `setSummary DB error: ${err.message}`);
      }
    }

    // In-memory
    if (!this._memSummaries) {
      this._memSummaries = new Map();
    }
    this._memSummaries.set(conversationId, { summary, upToMsgId });
  }

  /**
   * Retrieve stored summary for a conversation.
   *
   * @param {string} conversationId
   * @returns {{ summary: string, upToMsgId: number } | null}
   */
  getSummary(conversationId) {
    if (this.#db) {
      try {
        const row = this.#db.db.prepare(
          'SELECT summary, summary_up_to_msg_id as upToMsgId FROM conversations WHERE id = ?'
        ).get(conversationId);
        if (row?.summary) {
          return { summary: row.summary, upToMsgId: row.upToMsgId };
        }
        return null;
      } catch (err) {
        logger.warn('ConversationStore', `getSummary DB error: ${err.message}`);
        return null;
      }
    }

    // In-memory
    if (!this._memSummaries) return null;
    return this._memSummaries.get(conversationId) || null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────────────

  #parseMetadata(meta) {
    if (!meta) return {};
    if (typeof meta === 'object') return meta;
    try {
      return JSON.parse(meta);
    } catch {
      return {};
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // v59.0 Session State Persistence (for IDE bridge — survives restart)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Save session state to DB.
   * Replaces localStorage-based persistence (which doesn't work server-side).
   *
   * @param {string} sessionId
   * @param {string} stateJSON — JSON.stringify(sessionState.toJSON())
   * @returns {boolean} — true if persisted
   */
  saveSessionState(sessionId, stateJSON) {
    if (!sessionId || !stateJSON) return false;

    if (this._sessionStateStmts) {
      try {
        this._sessionStateStmts.save.run(sessionId, stateJSON, Date.now());
        return true;
      } catch (err) {
        logger.warn('ConversationStore', `saveSessionState failed: ${err.message}`);
        return false;
      }
    }

    // In-memory fallback
    if (this._memSessionStates) {
      this._memSessionStates.set(sessionId, {
        session_id: sessionId,
        state_json: stateJSON,
        updated_at: Date.now(),
      });
      return true;
    }

    return false;
  }

  /**
   * Load session state from DB.
   *
   * @param {string} sessionId
   * @returns {string|null} — JSON string or null
   */
  loadSessionState(sessionId) {
    if (!sessionId) return null;

    if (this._sessionStateStmts) {
      try {
        const row = this._sessionStateStmts.load.get(sessionId);
        return row?.state_json || null;
      } catch (err) {
        logger.warn('ConversationStore', `loadSessionState failed: ${err.message}`);
        return null;
      }
    }

    // In-memory fallback
    if (this._memSessionStates) {
      const entry = this._memSessionStates.get(sessionId);
      return entry?.state_json || null;
    }

    return null;
  }

  /**
   * Delete session state from DB.
   *
   * @param {string} sessionId
   * @returns {boolean}
   */
  deleteSessionState(sessionId) {
    if (!sessionId) return false;

    if (this._sessionStateStmts) {
      try {
        this._sessionStateStmts.delete.run(sessionId);
        return true;
      } catch (err) {
        logger.warn('ConversationStore', `deleteSessionState failed: ${err.message}`);
        return false;
      }
    }

    // In-memory fallback
    if (this._memSessionStates) {
      this._memSessionStates.delete(sessionId);
      return true;
    }

    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton (lazy — initialized when DB is ready)
// ─────────────────────────────────────────────────────────────────────────────

let _instance = null;

/**
 * Get the global ConversationStore instance.
 *
 * @param {Object} [db] — Pass DB on first call to initialize.
 * @returns {ConversationStore}
 */
export function getConversationStore(db = null) {
  if (!_instance) {
    _instance = new ConversationStore(db);
  }
  return _instance;
}

/**
 * Reset singleton (for tests).
 */
export function resetConversationStore() {
  _instance = null;
}

export default {
  ConversationStore,
  TurnRole,
  getConversationStore,
  resetConversationStore,
};
