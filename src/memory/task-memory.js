// Task Memory v107 (F5) — Cross-milestone learning for execution loop
// ══════════════════════════════════════════════════════════════════════════════
//
// Persistent memory of fix attempts: what worked, what failed, architecture
// decisions. Used by execution loop to avoid repeating failed strategies and
// leverage past successes.
//
// Two memory layers:
//   - Iteration memory: volatile, within one loop run (in execution-loop.js)
//   - Task memory: persistent, across milestones (this module)
//
// Decay: gentler than LTM (lambda=0.005, half-life ~139 days)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const DECAY_LAMBDA = 0.005;         // half-life ~139 days (gentler than LTM's 0.01)
const REINFORCE_BOOST = 0.05;
const REINFORCE_CAP = 0.95;
const MS_PER_DAY = 86_400_000;

// ─── Task Memory ────────────────────────────────────────────────────────────

export class TaskMemory {
  constructor() {
    this.db = null;
  }

  /**
   * Initialize with database connection.
   */
  init(db) {
    this.db = db;
    this._ensureTable();
  }

  _ensureTable() {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        confidence REAL DEFAULT 0.8,
        milestone_id TEXT,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER,
        access_count INTEGER DEFAULT 0,
        UNIQUE(project_id, kind, key)
      )
    `);
  }

  // ─── Record Fix ─────────────────────────────────────────────────────

  /**
   * Record the result of a fix attempt.
   *
   * @param {Object} entry
   * @param {string} entry.projectId
   * @param {string} entry.errorCode      - NormalizedError.code
   * @param {string} entry.file           - File where error occurred
   * @param {string} entry.symbol         - Symbol context (optional)
   * @param {string} entry.patchFile      - File that was patched
   * @param {boolean} entry.success       - Did the fix resolve the error?
   * @param {string} entry.strategy       - Description of what was tried
   * @param {string} entry.milestoneId
   */
  async recordFix(entry) {
    if (!this.db) return;

    const kind = entry.success ? 'fix_strategy' : 'error_pattern';
    const key = `${entry.errorCode || 'UNKNOWN'}:${entry.file || ''}:${entry.symbol || ''}`;
    const value = JSON.stringify({
      patchFile: entry.patchFile,
      strategy: entry.strategy,
      success: entry.success,
    });
    const confidence = entry.success ? 0.8 : 0.5;
    const now = Date.now();

    try {
      // Check existing
      const existing = this.db.prepare(
        'SELECT id, kind, confidence, value FROM task_memory WHERE project_id = ? AND kind = ? AND key = ?',
      ).get(entry.projectId, kind, key);

      if (existing) {
        const existingVal = JSON.parse(existing.value);

        if (!existingVal.success && entry.success) {
          // Failure → success: overwrite with success
          this.db.prepare(
            'UPDATE task_memory SET value = ?, confidence = 0.8, last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?',
          ).run(value, now, existing.id);
        } else if (existingVal.success && !entry.success) {
          // Success → failure: reduce confidence
          const newConf = Math.max(0.1, existing.confidence - 0.1);
          this.db.prepare(
            'UPDATE task_memory SET confidence = ?, last_accessed_at = ? WHERE id = ?',
          ).run(newConf, now, existing.id);
        } else {
          // Same outcome: reinforce
          const newConf = Math.min(REINFORCE_CAP, existing.confidence + REINFORCE_BOOST);
          this.db.prepare(
            'UPDATE task_memory SET confidence = ?, last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?',
          ).run(newConf, now, existing.id);
        }
      } else {
        this.db.prepare(
          'INSERT INTO task_memory (project_id, kind, key, value, confidence, milestone_id, created_at, last_accessed_at, access_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
        ).run(entry.projectId, kind, key, value, confidence, entry.milestoneId || null, now, now);
      }
    } catch (err) {
      logger.warn('TaskMemory', `recordFix failed: ${err.message}`);
    }
  }

  // ─── Record Architecture Decision ───────────────────────────────────

  /**
   * Record an architecture decision.
   *
   * @param {Object} entry
   * @param {string} entry.projectId
   * @param {string} entry.decision
   * @param {string} entry.rationale
   * @param {string} entry.milestoneId
   */
  async recordArchDecision(entry) {
    if (!this.db) return;

    const kind = 'architecture_decision';
    const key = (entry.decision || '').toLowerCase().replace(/\s+/g, '_').slice(0, 64);
    const value = JSON.stringify({
      decision: entry.decision,
      rationale: entry.rationale,
    });
    const now = Date.now();

    try {
      const existing = this.db.prepare(
        'SELECT id, confidence FROM task_memory WHERE project_id = ? AND kind = ? AND key = ?',
      ).get(entry.projectId, kind, key);

      if (existing) {
        const newConf = Math.min(REINFORCE_CAP, existing.confidence + REINFORCE_BOOST);
        this.db.prepare(
          'UPDATE task_memory SET confidence = ?, last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?',
        ).run(newConf, now, existing.id);
      } else {
        this.db.prepare(
          'INSERT INTO task_memory (project_id, kind, key, value, confidence, milestone_id, created_at, last_accessed_at, access_count) VALUES (?, ?, ?, ?, 0.9, ?, ?, ?, 0)',
        ).run(entry.projectId, kind, key, value, entry.milestoneId || null, now, now);
      }
    } catch (err) {
      logger.warn('TaskMemory', `recordArchDecision failed: ${err.message}`);
    }
  }

  // ─── Query Relevant ─────────────────────────────────────────────────

  /**
   * Retrieve relevant past experiences for current fix iteration.
   *
   * @param {Array} errors - NormalizedError[]
   * @param {Array<string>} files - Currently modified files
   * @param {Object} opts - {projectId, maxResults?: 10, minConfidence?: 0.3}
   * @returns {Promise<Array<{kind, key, value, confidence, effectiveConfidence}>>}
   */
  async queryRelevant(errors, files, opts = {}) {
    if (!this.db) return [];

    const { projectId, maxResults = 10, minConfidence = 0.3 } = opts;
    if (!projectId) return [];

    try {
      // Build key patterns from errors
      const errorKeys = (errors || []).map(e => `${e.code || 'UNKNOWN'}:${e.file || ''}`);

      // Query all entries for this project above confidence threshold
      const rows = this.db.prepare(
        'SELECT kind, key, value, confidence, created_at, access_count FROM task_memory WHERE project_id = ? AND confidence >= ?',
      ).all(projectId, minConfidence);

      const now = Date.now();
      const results = [];

      for (const row of rows) {
        // Match by error code prefix or file
        let relevant = false;

        // Architecture decisions are always relevant
        if (row.kind === 'architecture_decision') {
          relevant = true;
        } else {
          // Check if key matches any error pattern
          for (const ek of errorKeys) {
            if (row.key.startsWith(ek)) { relevant = true; break; }
          }
          // Check if key mentions any current file
          if (!relevant && files) {
            for (const f of files) {
              if (row.key.includes(f)) { relevant = true; break; }
            }
          }
        }

        if (!relevant) continue;

        // Apply decay
        const ageDays = (now - row.created_at) / MS_PER_DAY;
        const effectiveConfidence = row.confidence * Math.exp(-DECAY_LAMBDA * ageDays);

        if (effectiveConfidence >= minConfidence) {
          results.push({
            kind: row.kind,
            key: row.key,
            value: row.value,
            confidence: row.confidence,
            effectiveConfidence,
          });
        }
      }

      // Sort by effective confidence descending, cap at maxResults
      results.sort((a, b) => b.effectiveConfidence - a.effectiveConfidence);
      return results.slice(0, maxResults);
    } catch (err) {
      logger.warn('TaskMemory', `queryRelevant failed: ${err.message}`);
      return [];
    }
  }

  // ─── Query by Project ───────────────────────────────────────────────

  /**
   * All entries for a project.
   */
  async queryByProject(projectId, opts = {}) {
    if (!this.db || !projectId) return [];

    try {
      const rows = this.db.prepare(
        'SELECT kind, key, value, confidence, created_at, access_count FROM task_memory WHERE project_id = ?',
      ).all(projectId);

      return rows;
    } catch (err) {
      logger.warn('TaskMemory', `queryByProject failed: ${err.message}`);
      return [];
    }
  }

  // ─── Prune ──────────────────────────────────────────────────────────

  /**
   * Remove low-confidence entries.
   *
   * @param {Object} opts - {minEffectiveConfidence?: 0.1, maxAge?: 180}
   */
  async prune(opts = {}) {
    if (!this.db) return;

    const { minEffectiveConfidence = 0.1, maxAge = 180 } = opts;
    const cutoff = Date.now() - maxAge * MS_PER_DAY;

    try {
      // Remove entries older than maxAge with decayed confidence below threshold
      const rows = this.db.prepare(
        'SELECT id, confidence, created_at, kind FROM task_memory WHERE created_at < ?',
      ).all(cutoff);

      const now = Date.now();
      let removed = 0;

      for (const row of rows) {
        // Keep architecture decisions longer (they decay slower in practice)
        if (row.kind === 'architecture_decision') continue;

        const ageDays = (now - row.created_at) / MS_PER_DAY;
        const effective = row.confidence * Math.exp(-DECAY_LAMBDA * ageDays);

        if (effective < minEffectiveConfidence) {
          this.db.prepare('DELETE FROM task_memory WHERE id = ?').run(row.id);
          removed++;
        }
      }

      if (removed > 0) {
        logger.info('TaskMemory', `Pruned ${removed} low-confidence entries`);
      }
    } catch (err) {
      logger.warn('TaskMemory', `prune failed: ${err.message}`);
    }
  }

  // ─── Reinforce ──────────────────────────────────────────────────────

  /**
   * Boost confidence on reuse.
   *
   * @param {string} projectId
   * @param {string} kind
   * @param {string} key
   */
  async reinforce(projectId, kind, key) {
    if (!this.db) return;

    try {
      const row = this.db.prepare(
        'SELECT id, confidence FROM task_memory WHERE project_id = ? AND kind = ? AND key = ?',
      ).get(projectId, kind, key);

      if (!row) return; // no-op for nonexistent

      const newConf = Math.min(REINFORCE_CAP, row.confidence + REINFORCE_BOOST);
      this.db.prepare(
        'UPDATE task_memory SET confidence = ?, access_count = access_count + 1, last_accessed_at = ? WHERE id = ?',
      ).run(newConf, Date.now(), row.id);
    } catch (err) {
      logger.warn('TaskMemory', `reinforce failed: ${err.message}`);
    }
  }

  // ─── Stats ──────────────────────────────────────────────────────────

  /**
   * Entry counts by kind for a project.
   */
  async getStats(projectId) {
    if (!this.db) return {};

    try {
      const rows = this.db.prepare(
        'SELECT kind, COUNT(*) as count FROM task_memory WHERE project_id = ? GROUP BY kind',
      ).all(projectId);

      const stats = {};
      for (const row of rows) stats[row.kind] = row.count;
      return stats;
    } catch (err) {
      logger.warn('TaskMemory', `getStats failed: ${err.message}`);
      return {};
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const taskMemory = new TaskMemory();

// ─── Format Helper ──────────────────────────────────────────────────────────

/**
 * Format task memory entries for LLM prompt.
 */
export function formatTaskMemory(entries) {
  if (!entries || entries.length === 0) return '';
  return entries.map(e => {
    try {
      const parsed = JSON.parse(e.value);
      const outcome = parsed.success ? 'WORKED' : 'FAILED';
      return `- [${outcome}] ${e.key}: ${parsed.strategy || parsed.decision || ''} (confidence: ${(e.effectiveConfidence * 100).toFixed(0)}%)`;
    } catch (_) {
      return `- ${e.key}: ${e.value}`;
    }
  }).join('\n');
}
