// CRE v37.1 Long-Term Memory
// ══════════════════════════════════════════════════════════════════════════════
//
// Persistent, per-user memory backed by SQLite.
// NOT a chat log. Stores structured facts with confidence, source, and kind.
//
// MemoryKind types:
//   preference  — user preferences ("no PDF", "verbose answers")
//   project     — project context (paths, configs, goals)
//   style       — communication style patterns
//   correction  — user corrections (self-improvement data)
//   pattern     — detected behavioral patterns
//   agent_internal — internal agent state (not user-facing)
//
// CRE never reads storage directly — everything goes through this layer.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// MEMORY KIND
// ════════════════════════════════════════════════════════════════════════════

export const MemoryKind = {
  PREFERENCE: 'preference',
  PROJECT: 'project',
  STYLE: 'style',
  CORRECTION: 'correction',
  PATTERN: 'pattern',
  AGENT_INTERNAL: 'agent_internal',
};

// ════════════════════════════════════════════════════════════════════════════
// MEMORY SOURCE
// ════════════════════════════════════════════════════════════════════════════

export const MemorySource = {
  EXPLICIT: 'explicit',     // User explicitly stated
  INFERRED: 'inferred',     // Inferred from behavior
  CORRECTED: 'corrected',   // Result of correction
  SYSTEM: 'system',         // System-generated
};

// ════════════════════════════════════════════════════════════════════════════
// LONG-TERM MEMORY
// ════════════════════════════════════════════════════════════════════════════

/**
 * LongTermMemory — persistent per-user fact store
 *
 * Uses SQLite in production, in-memory Map for tests.
 * All reads/writes go through policy checks.
 */
export class LongTermMemory {
  constructor(options = {}) {
    this.userId = options.userId || 'default';
    this.db = options.db || null; // SQLite connection (null = in-memory mode)
    this.store = new Map(); // In-memory fallback / cache
    this.initialized = false;
    this.minConfidenceDefault = 0.5;
  }

  /**
   * Initialize storage
   * In production: creates SQLite table if not exists.
   * In test/dev: uses in-memory Map.
   */
  init() {
    if (this.db) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS memory (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          key TEXT NOT NULL,
          value JSON NOT NULL,
          confidence REAL DEFAULT 1.0,
          source TEXT DEFAULT 'explicit',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_used DATETIME,
          ttl INTEGER,
          UNIQUE(user_id, kind, key)
        )
      `);
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_memory_user_kind ON memory(user_id, kind)
      `);
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_memory_key ON memory(user_id, key)
      `);
      logger.info('LongTermMemory', 'SQLite initialized', { userId: this.userId });
    }
    this.initialized = true;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // WRITE
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Store a memory entry
   *
   * @param {Object} opts
   * @param {string} opts.kind - MemoryKind
   * @param {string} opts.key - Unique key within kind
   * @param {*} opts.value - Any serializable value
   * @param {number} [opts.confidence=1.0] - 0.0 to 1.0
   * @param {string} [opts.source='explicit'] - MemorySource
   * @param {number} [opts.ttl] - Time-to-live in seconds (null = forever)
   * @returns {{ stored: boolean, id: string, key: string }}
   */
  write(opts) {
    if (!opts.kind || !MemoryKind[opts.kind.toUpperCase()]) {
      return { stored: false, error: `Invalid kind: ${opts.kind}`, code: 'INVALID_KIND' };
    }
    if (!opts.key) {
      return { stored: false, error: 'Key is required', code: 'MISSING_KEY' };
    }

    const id = `mem_${this.userId}_${opts.kind}_${opts.key}`;
    const entry = {
      id,
      userId: this.userId,
      kind: opts.kind,
      key: opts.key,
      value: opts.value,
      confidence: opts.confidence ?? 1.0,
      source: opts.source || MemorySource.EXPLICIT,
      createdAt: Date.now(),
      lastUsed: null,
      ttl: opts.ttl || null,
    };

    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO memory (id, user_id, kind, key, value, confidence, source, ttl)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(id, this.userId, opts.kind, opts.key, JSON.stringify(opts.value), entry.confidence, entry.source, entry.ttl);
      } catch (err) {
        logger.error('LongTermMemory', 'SQLite write error', { key: opts.key, error: err.message });
        return { stored: false, error: err.message, code: 'DB_ERROR' };
      }
    }

    // Always update in-memory cache
    this.store.set(id, entry);

    logger.debug('LongTermMemory', `Stored: ${opts.kind}/${opts.key}`, {
      confidence: entry.confidence,
      source: entry.source,
    });

    return { stored: true, id, key: opts.key };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // READ
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Read a memory entry by kind + key
   *
   * @param {Object} opts
   * @param {string} opts.kind - MemoryKind
   * @param {string} opts.key - Key to look up
   * @param {number} [opts.minConfidence] - Minimum confidence threshold
   * @returns {{ value: *, confidence: number, source: string } | { error: string, code: string }}
   */
  read(opts) {
    if (!opts.kind || !opts.key) {
      return { error: 'kind and key required', code: 'MISSING_PARAMS' };
    }

    const id = `mem_${this.userId}_${opts.kind}_${opts.key}`;
    const minConf = opts.minConfidence ?? this.minConfidenceDefault;

    let entry = this.store.get(id);

    // Try SQLite if not in cache
    if (!entry && this.db) {
      try {
        const row = this.db.prepare(
          'SELECT * FROM memory WHERE id = ? AND user_id = ?'
        ).get(id, this.userId);
        if (row) {
          entry = {
            ...row,
            value: JSON.parse(row.value),
            userId: row.user_id,
            createdAt: new Date(row.created_at).getTime(),
            lastUsed: row.last_used ? new Date(row.last_used).getTime() : null,
          };
          this.store.set(id, entry); // Cache
        }
      } catch (err) {
        logger.error('LongTermMemory', 'SQLite read error', { key: opts.key, error: err.message });
      }
    }

    if (!entry) {
      return { error: `Not found: ${opts.kind}/${opts.key}`, code: 'NOT_FOUND' };
    }

    // Check TTL
    if (entry.ttl && entry.createdAt + (entry.ttl * 1000) < Date.now()) {
      this.forget({ kind: opts.kind, key: opts.key, reason: 'expired' });
      return { error: 'Entry expired', code: 'EXPIRED' };
    }

    // Check confidence threshold
    if (entry.confidence < minConf) {
      return { error: `Confidence too low: ${entry.confidence} < ${minConf}`, code: 'LOW_CONFIDENCE' };
    }

    // Update lastUsed
    entry.lastUsed = Date.now();
    if (this.db) {
      try {
        this.db.prepare('UPDATE memory SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(id);
      } catch (err) { /* non-critical */ }
    }

    return {
      value: entry.value,
      confidence: entry.confidence,
      source: entry.source,
      kind: entry.kind,
      key: entry.key,
      createdAt: entry.createdAt,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // QUERY (by kind)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Query all memories of a given kind for current user
   *
   * @param {string} kind - MemoryKind
   * @param {Object} [opts]
   * @param {number} [opts.minConfidence]
   * @returns {Array<{ key, value, confidence, source }>}
   */
  queryByKind(kind, opts = {}) {
    const minConf = opts.minConfidence ?? 0;
    const results = [];

    if (this.db) {
      try {
        const rows = this.db.prepare(
          'SELECT * FROM memory WHERE user_id = ? AND kind = ? AND confidence >= ?'
        ).all(this.userId, kind, minConf);
        for (const row of rows) {
          results.push({
            key: row.key,
            value: JSON.parse(row.value),
            confidence: row.confidence,
            source: row.source,
          });
        }
        return results;
      } catch (err) {
        logger.error('LongTermMemory', 'queryByKind SQLite error', { kind, error: err.message });
      }
    }

    // In-memory fallback
    for (const entry of this.store.values()) {
      if (entry.userId === this.userId && entry.kind === kind && entry.confidence >= minConf) {
        // Check TTL
        if (entry.ttl && entry.createdAt + (entry.ttl * 1000) < Date.now()) {
          continue;
        }
        results.push({
          key: entry.key,
          value: entry.value,
          confidence: entry.confidence,
          source: entry.source,
        });
      }
    }

    return results;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FORGET
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Forget a memory entry
   *
   * @param {Object} opts
   * @param {string} opts.kind
   * @param {string} opts.key
   * @param {string} [opts.reason] - Why it was forgotten
   * @returns {{ deleted: boolean, reason?: string }}
   */
  forget(opts) {
    if (!opts.kind || !opts.key) {
      return { deleted: false, error: 'kind and key required' };
    }

    const id = `mem_${this.userId}_${opts.kind}_${opts.key}`;
    const existed = this.store.delete(id);

    if (this.db) {
      try {
        this.db.prepare('DELETE FROM memory WHERE id = ? AND user_id = ?').run(id, this.userId);
      } catch (err) {
        logger.error('LongTermMemory', 'SQLite delete error', { key: opts.key, error: err.message });
      }
    }

    if (existed || this.db) {
      logger.debug('LongTermMemory', `Forgot: ${opts.kind}/${opts.key}`, { reason: opts.reason || 'explicit' });
    }

    return { deleted: existed, kind: opts.kind, key: opts.key, reason: opts.reason };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // UPDATE CONFIDENCE
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Update confidence of an existing entry (e.g. after repeated confirmation)
   */
  updateConfidence(kind, key, newConfidence) {
    const id = `mem_${this.userId}_${kind}_${key}`;
    const entry = this.store.get(id);
    if (entry) {
      entry.confidence = Math.max(0, Math.min(1, newConfidence));
      if (this.db) {
        try {
          this.db.prepare('UPDATE memory SET confidence = ? WHERE id = ?').run(entry.confidence, id);
        } catch (err) { /* non-critical */ }
      }
      return { updated: true, confidence: entry.confidence };
    }
    return { updated: false, code: 'NOT_FOUND' };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STATS
  // ──────────────────────────────────────────────────────────────────────────

  getStats() {
    const byKind = {};
    const bySource = {};
    let totalConfidence = 0;
    let count = 0;

    for (const entry of this.store.values()) {
      if (entry.userId !== this.userId) continue;
      count++;
      byKind[entry.kind] = (byKind[entry.kind] || 0) + 1;
      bySource[entry.source] = (bySource[entry.source] || 0) + 1;
      totalConfidence += entry.confidence;
    }

    return {
      userId: this.userId,
      entries: count,
      byKind,
      bySource,
      avgConfidence: count > 0 ? totalConfidence / count : 0,
    };
  }

  /**
   * Clear all entries for current user (for testing)
   */
  clear() {
    const toDelete = [];
    for (const [id, entry] of this.store) {
      if (entry.userId === this.userId) toDelete.push(id);
    }
    for (const id of toDelete) this.store.delete(id);

    if (this.db) {
      try {
        this.db.prepare('DELETE FROM memory WHERE user_id = ?').run(this.userId);
      } catch (err) { /* non-critical */ }
    }
  }
}

// Singleton (in-memory mode for now; SQLite wired in production config)
export const longTermMemory = new LongTermMemory();

export default LongTermMemory;
