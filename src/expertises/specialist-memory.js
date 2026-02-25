// D4: Specialist Memory — Persistent Context per Specialist + Conversation
// ══════════════════════════════════════════════════════════════════════════════
//
// DB-backed key-value store that persists specialist context across sessions.
// Tools write via explicit memoryWrites contract (opt-in, not automatic).
//
// Integration:
//   ToolExecutor processes result.memoryWrites[] after successful execution.
//   buildExpertiseSystemPrompt() injects getContext() into LLM prompt.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

export class SpecialistMemory {
  /**
   * @param {import('better-sqlite3').Database} db
   */
  constructor(db) {
    this.db = db;
    this._stmts = null;
    /** @type {import('../telemetry/specialist-telemetry.js').SpecialistTelemetry|null} v82 */
    this._telemetry = null;
  }

  /**
   * v82: Set passive telemetry for memory observability.
   * @param {import('../telemetry/specialist-telemetry.js').SpecialistTelemetry} telemetry
   */
  setTelemetry(telemetry) {
    this._telemetry = telemetry;
  }

  /** Lazy-prepare all statements. */
  _prepare() {
    if (this._stmts) return this._stmts;

    this._stmts = {
      get: this.db.prepare(`
        SELECT value, value_type FROM specialist_memory
        WHERE specialist_id = ? AND conversation_id = ? AND key = ?
        LIMIT 1
      `),

      getAll: this.db.prepare(`
        SELECT key, value, value_type FROM specialist_memory
        WHERE specialist_id = ? AND conversation_id = ?
        ORDER BY updated_at DESC
      `),

      upsert: this.db.prepare(`
        INSERT INTO specialist_memory (specialist_id, conversation_id, key, value, value_type)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(specialist_id, conversation_id, key) DO UPDATE SET
          value = excluded.value,
          value_type = excluded.value_type,
          updated_at = CURRENT_TIMESTAMP
      `),

      delete: this.db.prepare(`
        DELETE FROM specialist_memory
        WHERE specialist_id = ? AND conversation_id = ? AND key = ?
      `),

      clear: this.db.prepare(`
        DELETE FROM specialist_memory
        WHERE specialist_id = ? AND conversation_id = ?
      `),

      count: this.db.prepare(`
        SELECT COUNT(*) as count FROM specialist_memory
        WHERE specialist_id = ? AND conversation_id = ?
      `),
    };

    return this._stmts;
  }

  // ─── Read API ──────────────────────────────────────────────────────────

  /**
   * Get a single value.
   * @param {string} specialistId
   * @param {string} conversationId
   * @param {string} key
   * @returns {*} Parsed value or null
   */
  get(specialistId, conversationId, key) {
    const row = this._prepare().get.get(specialistId, conversationId, key);
    // v82: Telemetry — only op, never keys or values
    this._telemetry?.record(row ? 'memory.hit' : 'memory.miss', {
      specialistId, metadata: { op: 'get' },
    });
    if (!row) return null;
    return this._parseValue(row.value, row.value_type);
  }

  /**
   * Get all values for a specialist+conversation.
   * @returns {Object} { key: value }
   */
  getAll(specialistId, conversationId) {
    const rows = this._prepare().getAll.all(specialistId, conversationId);
    const result = {};
    for (const row of rows) {
      result[row.key] = this._parseValue(row.value, row.value_type);
    }
    return result;
  }

  /**
   * Get formatted context string for prompt injection.
   * Returns null if no memory entries exist.
   *
   * Format:
   *   Context for this conversation:
   *   - last_income: 850000 (number)
   *   - last_entity_type: osvc (string)
   *
   * @returns {string|null}
   */
  getContext(specialistId, conversationId) {
    const rows = this._prepare().getAll.all(specialistId, conversationId);
    // v82: Telemetry — only op and count, never keys or values
    this._telemetry?.record(rows.length > 0 ? 'memory.hit' : 'memory.miss', {
      specialistId, metadata: { op: 'getContext', keyCount: rows.length },
    });
    if (rows.length === 0) return null;

    const lines = ['Context for this conversation:'];
    for (const row of rows) {
      const value = this._parseValue(row.value, row.value_type);
      const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      lines.push(`- ${row.key}: ${displayValue} (${row.value_type})`);
    }
    return lines.join('\n');
  }

  // ─── Write API ─────────────────────────────────────────────────────────

  /**
   * Set a single value.
   * @param {string} specialistId
   * @param {string} conversationId
   * @param {string} key
   * @param {*} value
   * @param {string} [valueType='string']
   */
  set(specialistId, conversationId, key, value, valueType = 'string') {
    const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
    this._prepare().upsert.run(specialistId, conversationId, key, serialized, valueType);
  }

  /**
   * Process memoryWrites from a tool execution result.
   * @param {string} specialistId
   * @param {string} conversationId
   * @param {Array<{key: string, value: *, type?: string}>} writes
   */
  processWrites(specialistId, conversationId, writes) {
    if (!writes?.length) return;

    // v82: Telemetry — only count, never keys or values
    this._telemetry?.record('memory.write', {
      specialistId, metadata: { count: writes.length },
    });

    const runBulk = this.db.transaction(() => {
      for (const w of writes) {
        this.set(specialistId, conversationId, w.key, w.value, w.type || 'string');
      }
    });
    runBulk();

    logger.debug('SpecialistMemory', `Wrote ${writes.length} entries for ${specialistId}/${conversationId}`);
  }

  /**
   * Delete a single key.
   */
  delete(specialistId, conversationId, key) {
    this._prepare().delete.run(specialistId, conversationId, key);
  }

  /**
   * Clear all memory for a specialist+conversation.
   */
  clear(specialistId, conversationId) {
    this._prepare().clear.run(specialistId, conversationId);
  }

  /**
   * Count memory entries.
   */
  count(specialistId, conversationId) {
    return this._prepare().count.get(specialistId, conversationId).count;
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  _parseValue(raw, valueType) {
    switch (valueType) {
      case 'number': return Number(raw);
      case 'boolean': return raw === 'true' || raw === '1';
      case 'json': {
        try { return JSON.parse(raw); }
        catch { return raw; }
      }
      default: return raw;
    }
  }
}

// ─── Singleton (lazy, requires db) ──────────────────────────────────────────

let _instance = null;

/**
 * Get or create the SpecialistMemory singleton.
 * @param {import('better-sqlite3').Database} [db]
 * @returns {SpecialistMemory}
 */
export function getSpecialistMemory(db = null) {
  if (!_instance) {
    if (!db) throw new Error('SpecialistMemory: db required on first call');
    _instance = new SpecialistMemory(db);
  }
  return _instance;
}

export default { SpecialistMemory, getSpecialistMemory };
