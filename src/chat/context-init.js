// v67.0 — Context Init: Hierarchical scan on first project turn
// ══════════════════════════════════════════════════════════════════════════════
//
// On the FIRST turn of a project-scoped conversation, automatically:
// 1. Ensure README.md exists (README-first)
// 2. Read README.md for project overview
// 3. Scan directory structure (top 2 levels)
// 4. Detect stack (package.json, Cargo.toml, etc.)
// 5. Load Memory Bank entries
// 6. Build a comprehensive context block for the LLM
//
// This runs ONCE per conversation (tracked via project_memory flag).
// Subsequent turns skip the scan (Memory Bank provides continuity).
//
// ══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { logger } from '../core/logger.js';
import { ensureReadme } from './handlers/utils/readme-generator.js';

// Track initialized conversations (in-memory; resets on restart is fine)
const initializedConversations = new Set();

/**
 * Check if context init is needed and build it if so.
 *
 * @param {string} conversationId
 * @param {Object} project — { id, name, path, description }
 * @param {Object} [memoryBank] — MemoryBank instance
 * @param {Object} [db] — Database module (for project_memory lookup)
 * @returns {string} — Context block to inject, or empty string
 */
export function maybeInitContext(conversationId, project, memoryBank, db) {
  if (!conversationId || !project?.path || !project?.id) return '';
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
  const projectPath = project.path;
  const sections = [];

  // 1. Ensure README exists
  ensureReadme(projectPath, { name: project.name, description: project.description || '' });

  // 2. Read README.md
  try {
    const readmePath = path.join(projectPath, 'README.md');
    if (fs.existsSync(readmePath)) {
      const readme = fs.readFileSync(readmePath, 'utf-8');
      // Truncate to reasonable size for context
      const truncated = readme.substring(0, 3000);
      sections.push(`[README.md]\n${truncated}`);
    }
  } catch (err) {
    logger.debug('ContextInit', `README read failed: ${err.message}`);
  }

  // 3. Read .c3/project.json if exists
  try {
    const metaPath = path.join(projectPath, '.c3', 'project.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      if (meta.type || meta.lifecycle) {
        sections.push(`[Projekt metadata]\nTyp: ${meta.type || 'N/A'}, Fáze: ${meta.lifecycle || 'N/A'}`);
      }
    }
  } catch { /* non-critical */ }

  // 4. Key config files (first 50 lines)
  const configFiles = ['package.json', 'tsconfig.json', '.env.example'];
  for (const cf of configFiles) {
    try {
      const cfPath = path.join(projectPath, cf);
      if (fs.existsSync(cfPath)) {
        const content = fs.readFileSync(cfPath, 'utf-8');
        const lines = content.split('\n').slice(0, 50).join('\n');
        sections.push(`[${cf}]\n${lines}`);
      }
    } catch { /* skip */ }
  }

  // 5. Memory Bank context
  if (memoryBank) {
    const mbContext = memoryBank.buildContext(project.id);
    if (mbContext) {
      sections.push(mbContext);
    }
  }

  // 6. Cached project analysis from DB (v88.2)
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

  const header = `KONTEXT PROJEKTU (automatický scan při prvním dotazu):`;
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
