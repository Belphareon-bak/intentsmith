// v67.0 — Memory Bank: Project-Scoped Persistent Memory
// ══════════════════════════════════════════════════════════════════════════════
//
// Stores and retrieves project-specific knowledge that persists across
// conversations. Uses the existing `project_memory` table (DB-backed).
//
// Categories:
//   decision   — architectural decisions, tech choices
//   preference — user preferences for this project
//   context    — project context (stack, patterns, conventions)
//   progress   — what's done, what's pending
//   general    — uncategorized
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// Valid memory categories
export const MemoryCategory = Object.freeze({
  DECISION: 'decision',
  PREFERENCE: 'preference',
  CONTEXT: 'context',
  PROGRESS: 'progress',
  GENERAL: 'general',
});

/**
 * MemoryBank — project-scoped persistent memory.
 *
 * Wraps the `project_memory` table with a clean API.
 * All operations are synchronous (SQLite is sync).
 */
export class MemoryBank {
  #db;

  /**
   * @param {Object} db — Database module default export (has .projectMemory, .db)
   */
  constructor(db) {
    this.#db = db;
  }

  /**
   * Store a memory entry for a project.
   *
   * @param {number} projectId
   * @param {string} key — Unique key within project
   * @param {*} value — Any serializable value
   * @param {string} [category='general']
   * @returns {{ stored: boolean, key: string }}
   */
  set(projectId, key, value, category = MemoryCategory.GENERAL) {
    if (!projectId || !key) {
      return { stored: false, error: 'projectId and key are required' };
    }

    try {
      this.#db.projectMemory.setValue(projectId, key, value, category);
      logger.debug('MemoryBank', `Stored: ${category}/${key}`, { projectId });
      return { stored: true, key };
    } catch (err) {
      logger.error('MemoryBank', `Set failed: ${err.message}`, { projectId, key });
      return { stored: false, error: err.message };
    }
  }

  /**
   * Get a memory entry.
   *
   * @param {number} projectId
   * @param {string} key
   * @param {*} [defaultValue=null]
   * @returns {*}
   */
  get(projectId, key, defaultValue = null) {
    if (!projectId || !key) return defaultValue;
    return this.#db.projectMemory.getValue(projectId, key, defaultValue);
  }

  /**
   * Delete a memory entry.
   *
   * @param {number} projectId
   * @param {string} key
   * @returns {{ deleted: boolean }}
   */
  delete(projectId, key) {
    if (!projectId || !key) return { deleted: false };
    try {
      this.#db.projectMemory.delete.run(projectId, key);
      return { deleted: true };
    } catch (err) {
      logger.error('MemoryBank', `Delete failed: ${err.message}`, { projectId, key });
      return { deleted: false, error: err.message };
    }
  }

  /**
   * List all memories for a project.
   *
   * @param {number} projectId
   * @param {string} [category] — Filter by category (null = all)
   * @returns {Array<{ key: string, value: *, category: string, updated_at: string }>}
   */
  list(projectId, category = null) {
    if (!projectId) return [];

    try {
      const rows = category
        ? this.#db.projectMemory.listByCategory.all(projectId, category)
        : this.#db.projectMemory.listByProject.all(projectId);

      return (rows || []).map(row => ({
        key: row.key,
        value: this.#parseValue(row.value),
        category: row.category,
        updated_at: row.updated_at,
      }));
    } catch (err) {
      logger.error('MemoryBank', `List failed: ${err.message}`, { projectId });
      return [];
    }
  }

  /**
   * Build a context block for LLM prompt injection.
   * Returns formatted string with all project memories, grouped by category.
   *
   * @param {number} projectId
   * @param {number} [maxEntries=20] — Limit total entries
   * @returns {string} — Empty string if no memories
   */
  buildContext(projectId, maxEntries = 20) {
    if (!projectId) return '';

    const entries = this.list(projectId);
    if (entries.length === 0) return '';

    // Group by category
    const grouped = {};
    for (const e of entries.slice(0, maxEntries)) {
      const cat = e.category || 'general';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(e);
    }

    const categoryLabels = {
      decision: 'Rozhodnutí',
      preference: 'Preference',
      context: 'Kontext projektu',
      progress: 'Postup',
      general: 'Obecné',
    };

    const lines = ['PAMĚŤ PROJEKTU (Memory Bank):'];
    for (const [cat, items] of Object.entries(grouped)) {
      lines.push(`  ${categoryLabels[cat] || cat}:`);
      for (const item of items) {
        const val = typeof item.value === 'object'
          ? JSON.stringify(item.value)
          : String(item.value);
        lines.push(`    - ${item.key}: ${val}`);
      }
    }

    return lines.join('\n');
  }

  #parseValue(raw) {
    if (raw === null || raw === undefined) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
}

// Singleton — initialized lazily with DB
let _instance = null;

/**
 * Get the global MemoryBank instance.
 * @param {Object} [db] — Pass DB module on first call
 * @returns {MemoryBank}
 */
export function getMemoryBank(db = null) {
  if (!_instance && db) {
    _instance = new MemoryBank(db);
  }
  return _instance;
}

export default { MemoryBank, MemoryCategory, getMemoryBank };
