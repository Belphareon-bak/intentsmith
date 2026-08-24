// v67.0 — Context Init from already-persisted project context
// ══════════════════════════════════════════════════════════════════════════════
//
// On the FIRST turn of a project-scoped conversation, automatically:
// The chat ingress must not turn project selection into ambient filesystem
// authority. Filesystem context belongs to ProjectContextQuery/Snapshot; this
// compatibility initializer therefore consumes DB/memory data only.
//
// This runs ONCE per conversation (tracked via project_memory flag).
// Subsequent turns skip this compatibility initializer (Memory Bank provides continuity).
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// Track initialized conversations (in-memory; resets on restart is fine)
const initializedConversations = new Set();

/**
 * Check if context init is needed and build it if so.
 *
 * @param {string} conversationId
 * @param {Object} project — persisted identity; only id is consumed here
 * @param {Object} [memoryBank] — MemoryBank instance
 * @param {Object} [db] — Database module (for project_memory lookup)
 * @returns {string} — Context block to inject, or empty string
 */
export function maybeInitContext(conversationId, project, memoryBank, db) {
  if (!conversationId || !project?.id) return '';
  if (initializedConversations.has(conversationId)) return '';

  // Mark as initialized immediately (prevent double-init on concurrent calls)
  initializedConversations.add(conversationId);

  try {
    return buildInitContext(project, memoryBank, db);
  } catch (err) {
    logger.warn('ContextInit', `Init failed: ${err.message}`, { projectId: project.id });
    return '';
  }
}

/**
 * Build the initial context block for a project.
 *
 * @param {Object} project
 * @param {Object} [memoryBank]
 * @param {Object} [db] — Database module (for project_memory lookup)
 * @returns {string}
 */
function buildInitContext(project, memoryBank, db) {
  const sections = [];

  // 1. Memory Bank context
  if (memoryBank) {
    const mbContext = memoryBank.buildContext(project.id);
    if (mbContext) {
      sections.push(mbContext);
    }
  }

  // 2. Cached project analysis from DB (v88.2)
  if (db && project.id) {
    try {
      const pmDb = db.projectMemory || db;
      if (pmDb.get) {
        const row = pmDb.get.get(project.id, 'last_analysis');
        if (row?.value) {
          // Truncate to ~1500 chars — the full analysis is already in fullContext.projectAnalysis
          const truncated = row.value.length > 1500
            ? row.value.substring(0, 1500) + '\n...[zkráceno]'
            : row.value;
          sections.push(`[Analýza projektu]\n${truncated}`);
        }
      }
    } catch { /* non-critical */ }
  }

  if (sections.length === 0) return '';

  const header = 'KONTEXT PROJEKTU (persistovaný kontext bez filesystem scanu):';
  const body = sections.join('\n\n');

  // Limit total size to ~4000 chars (~1000 tokens)
  const maxLen = 4000;
  const full = `${header}\n\n${body}`;
  return full.length > maxLen ? full.substring(0, maxLen) + '\n...[zkráceno]' : full;
}

/**
 * Reset init state for a conversation (e.g. on conversation clear).
 * @param {string} conversationId
 */
export function resetContextInit(conversationId) {
  initializedConversations.delete(conversationId);
}
