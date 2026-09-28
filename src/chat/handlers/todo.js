// v67.0 — TODO Workflow: /todo and /done commands in chat
// ══════════════════════════════════════════════════════════════════════════════
//
// Simple project-scoped TODO list managed via chat commands.
// Stored in project_memory table with category='todo'.
//
// Commands:
//   /todo <text>     — Add a new TODO item
//   /todo            — List all pending TODOs
//   /done <text>     — Mark a TODO as done (fuzzy match)
//   /done            — List completed TODOs
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../../core/logger.js';
import db from '../../db/database.js';

const TODO_CATEGORY = 'todo';

/**
 * Check if input is a /todo or /done command.
 * @param {string} input
 * @returns {{ type: 'todo'|'done'|null, text: string }}
 */
export function parseTodoCommand(input) {
  const trimmed = input.trim();
  const todoMatch = trimmed.match(/^\/todo\s*(.*)/i);
  if (todoMatch) return { type: 'todo', text: todoMatch[1].trim() };

  const doneMatch = trimmed.match(/^\/done\s*(.*)/i);
  if (doneMatch) return { type: 'done', text: doneMatch[1].trim() };

  return { type: null, text: '' };
}

/**
 * Handle /todo command.
 * @param {string} text — Text after /todo
 * @param {number} projectId
 * @returns {{ handled: boolean, content: string }}
 */
export function handleTodo(text, projectId) {
  if (!projectId) {
    return { handled: true, content: '⚠️ Žádný aktivní projekt. TODOs jsou vázány na projekt.' };
  }

  // /todo (no text) — list all pending TODOs
  if (!text) {
    return listTodos(projectId, false);
  }

  // /todo <text> — add new TODO
  return addTodo(text, projectId);
}

/**
 * Handle /done command.
 * @param {string} text — Text after /done (fuzzy match)
 * @param {number} projectId
 * @returns {{ handled: boolean, content: string }}
 */
export function handleDone(text, projectId) {
  if (!projectId) {
    return { handled: true, content: '⚠️ Žádný aktivní projekt.' };
  }

  // /done (no text) — list completed
  if (!text) {
    return listTodos(projectId, true);
  }

  // /done <text> — mark matching TODO as done
  return markDone(text, projectId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function addTodo(text, projectId) {
  const key = `todo_${Date.now()}`;
  const value = JSON.stringify({
    text,
    status: 'pending',
    createdAt: new Date().toISOString(),
    completedAt: null,
  });

  try {
    db.projectMemory.set.run(projectId, key, value, TODO_CATEGORY);
    logger.debug('TodoWorkflow', `Added TODO: ${text.substring(0, 40)}`, { projectId });
    return { handled: true, content: `✅ TODO přidáno: **${text}**` };
  } catch (err) {
    logger.error('TodoWorkflow', `Add failed: ${err.message}`, { projectId });
    return { handled: true, content: `❌ Chyba: ${err.message}` };
  }
}

function listTodos(projectId, showCompleted) {
  try {
    const rows = db.projectMemory.listByCategory.all(projectId, TODO_CATEGORY);
    if (!rows || rows.length === 0) {
      return { handled: true, content: showCompleted
        ? '📋 Žádné dokončené TODOs.'
        : '📋 Žádné TODO items. Přidejte přes `/todo text`.' };
    }

    const items = rows
      .map(r => {
        try { return { key: r.key, ...JSON.parse(r.value) }; }
        catch { return { key: r.key, text: r.value, status: 'pending' }; }
      })
      .filter(i => showCompleted ? i.status === 'done' : i.status === 'pending');

    if (items.length === 0) {
      return { handled: true, content: showCompleted
        ? '📋 Žádné dokončené TODOs.'
        : '📋 Všechny úkoly splněny! 🎉' };
    }

    const icon = showCompleted ? '✅' : '📌';
    const header = showCompleted ? '**Dokončené TODOs:**' : '**Pending TODOs:**';
    const list = items.map((i, idx) => `${idx + 1}. ${icon} ${i.text}`).join('\n');

    return { handled: true, content: `${header}\n${list}` };
  } catch (err) {
    return { handled: true, content: `❌ Chyba: ${err.message}` };
  }
}

function markDone(text, projectId) {
  try {
    const rows = db.projectMemory.listByCategory.all(projectId, TODO_CATEGORY);
    if (!rows || rows.length === 0) {
      return { handled: true, content: '📋 Žádné TODO items k dokončení.' };
    }

    // Parse items and find best fuzzy match
    const lowerText = text.toLowerCase();
    let bestMatch = null;
    let bestScore = 0;

    for (const row of rows) {
      let item;
      try { item = JSON.parse(row.value); } catch { continue; }
      if (item.status === 'done') continue;

      const itemText = (item.text || '').toLowerCase();
      // Simple fuzzy: check if all words from query appear in the TODO text
      const words = lowerText.split(/\s+/).filter(w => w.length > 1);
      const matchCount = words.filter(w => itemText.includes(w)).length;
      const score = words.length > 0 ? matchCount / words.length : 0;

      if (score > bestScore) {
        bestScore = score;
        bestMatch = { key: row.key, item };
      }
    }

    if (!bestMatch || bestScore < 0.5) {
      return { handled: true, content: `❌ Nenalezen TODO odpovídající: "${text}"` };
    }

    // Mark as done
    bestMatch.item.status = 'done';
    bestMatch.item.completedAt = new Date().toISOString();
    db.projectMemory.set.run(
      projectId, bestMatch.key, JSON.stringify(bestMatch.item), TODO_CATEGORY
    );

    logger.debug('TodoWorkflow', `Marked done: ${bestMatch.item.text.substring(0, 40)}`, { projectId });
    return { handled: true, content: `✅ Hotovo: **${bestMatch.item.text}**` };
  } catch (err) {
    return { handled: true, content: `❌ Chyba: ${err.message}` };
  }
}
