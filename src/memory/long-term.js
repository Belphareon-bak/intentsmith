// CRE v86.0 Long-Term Memory
// ══════════════════════════════════════════════════════════════════════════════
//
// Persistent, per-user memory backed by SQLite.
// NOT a chat log. Stores structured facts with confidence, source, and kind.
//
// v86: Confidence Decay + Reinforcement
//   effective_confidence = base_confidence * e^(-λ * age_days)
//   On reuse: confidence += REINFORCE_BOOST (capped at 0.95), access_count++
//   λ = 0.01 (half-life ~69 days — memory halves in ~2.5 months)
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
// DECAY CONSTANTS
// ════════════════════════════════════════════════════════════════════════════

const DECAY_LAMBDA = 0.01;          // half-life ~69 days
const REINFORCE_BOOST = 0.05;       // confidence bump on reuse
const REINFORCE_CAP = 0.95;         // max confidence after reinforcement
const MS_PER_DAY = 86_400_000;

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
  // CONFIDENCE DECAY
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Calculate effective confidence with exponential time decay.
   *
   * Formula: effective = base * e^(-λ * ageDays)
   *
   * @param {number} baseConfidence - Stored confidence (0.0 to 1.0)
   * @param {number} createdAt - Creation timestamp (ms)
   * @returns {number} Effective confidence after decay
   */
  effectiveConfidence(baseConfidence, createdAt) {
    const ageDays = (Date.now() - createdAt) / MS_PER_DAY;
    if (ageDays <= 0) return baseConfidence;
    return baseConfidence * Math.exp(-DECAY_LAMBDA * ageDays);
  }

  /**
   * Reinforce a memory entry (bump confidence + access count on reuse).
   *
   * @param {string} kind - MemoryKind
   * @param {string} key - Entry key
   * @returns {{ reinforced: boolean, confidence?: number, accessCount?: number }}
   */
  reinforce(kind, key) {
    const id = `mem_${this.userId}_${kind}_${key}`;
    const entry = this.store.get(id);

    if (!entry) {
      // Try DB
      if (this.db) {
        try {
          const row = this.db.prepare(
            'SELECT confidence, access_count FROM memory WHERE id = ? AND user_id = ?'
          ).get(id, this.userId);
          if (row) {
            const newConf = Math.min(REINFORCE_CAP, (row.confidence || 0.5) + REINFORCE_BOOST);
            const newCount = (row.access_count || 0) + 1;
            this.db.prepare(
              'UPDATE memory SET confidence = ?, access_count = ?, last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?'
            ).run(newConf, newCount, id);
            return { reinforced: true, confidence: newConf, accessCount: newCount };
          }
        } catch (err) {
          logger.debug('LongTermMemory', `reinforce DB error: ${err.message}`);
        }
      }
      return { reinforced: false, code: 'NOT_FOUND' };
    }

    // In-memory entry found
    entry.confidence = Math.min(REINFORCE_CAP, (entry.confidence || 0.5) + REINFORCE_BOOST);
    entry.accessCount = (entry.accessCount || 0) + 1;
    entry.lastUsed = Date.now();

    if (this.db) {
      try {
        this.db.prepare(
          'UPDATE memory SET confidence = ?, access_count = ?, last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).run(entry.confidence, entry.accessCount, id);
      } catch (_) {}
    }

    return { reinforced: true, confidence: entry.confidence, accessCount: entry.accessCount };
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
      accessCount: 0,
      ttl: opts.ttl || null,
    };

    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          INSERT OR REPLACE INTO memory (id, user_id, kind, key, value, confidence, source, ttl, access_count, last_accessed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
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

    // v86: Apply confidence decay
    const effConf = this.effectiveConfidence(entry.confidence, entry.createdAt);

    // Check effective confidence threshold
    if (effConf < minConf) {
      return { error: `Effective confidence too low: ${effConf.toFixed(3)} < ${minConf}`, code: 'LOW_CONFIDENCE' };
    }

    // Update access tracking
    entry.lastUsed = Date.now();
    entry.accessCount = (entry.accessCount || 0) + 1;
    if (this.db) {
      try {
        this.db.prepare(
          'UPDATE memory SET last_used = CURRENT_TIMESTAMP, last_accessed_at = CURRENT_TIMESTAMP, access_count = COALESCE(access_count, 0) + 1 WHERE id = ?'
        ).run(id);
      } catch (err) { /* non-critical */ }
    }

    return {
      value: entry.value,
      confidence: entry.confidence,
      effectiveConfidence: effConf,
      source: entry.source,
      kind: entry.kind,
      key: entry.key,
      createdAt: entry.createdAt,
      accessCount: entry.accessCount,
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
    const now = Date.now();

    if (this.db) {
      try {
        // Fetch all entries for kind — decay filtering happens in JS
        const rows = this.db.prepare(
          'SELECT * FROM memory WHERE user_id = ? AND kind = ?'
        ).all(this.userId, kind);
        for (const row of rows) {
          const createdAt = new Date(row.created_at).getTime();
          // Check TTL
          if (row.ttl && createdAt + (row.ttl * 1000) < now) continue;
          // v86: Apply decay
          const effConf = this.effectiveConfidence(row.confidence, createdAt);
          if (effConf < minConf) continue;
          results.push({
            key: row.key,
            value: JSON.parse(row.value),
            confidence: row.confidence,
            effectiveConfidence: effConf,
            source: row.source,
            accessCount: row.access_count || 0,
          });
        }
        // Sort by effective confidence (highest first)
        results.sort((a, b) => b.effectiveConfidence - a.effectiveConfidence);
        return results;
      } catch (err) {
        logger.error('LongTermMemory', 'queryByKind SQLite error', { kind, error: err.message });
      }
    }

    // In-memory fallback
    for (const entry of this.store.values()) {
      if (entry.userId === this.userId && entry.kind === kind) {
        // Check TTL
        if (entry.ttl && entry.createdAt + (entry.ttl * 1000) < now) continue;
        // v86: Apply decay
        const effConf = this.effectiveConfidence(entry.confidence, entry.createdAt);
        if (effConf < minConf) continue;
        results.push({
          key: entry.key,
          value: entry.value,
          confidence: entry.confidence,
          effectiveConfidence: effConf,
          source: entry.source,
          accessCount: entry.accessCount || 0,
        });
      }
    }

    results.sort((a, b) => b.effectiveConfidence - a.effectiveConfidence);
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
