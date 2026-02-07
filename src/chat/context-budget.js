// CRE v56.1 — Sprint 4A: Context Budget
// ══════════════════════════════════════════════════════════════════════════════
//
// Token-budgeted context building per intent type.
//
// Architecture:
//   CRE decides intent → buildBudgetedContext(intent) → handler gets right-sized context
//
// Invariants:
//   ❗ Budget is applied AFTER CRE routing — NEVER influences intent classification
//   ❗ Summary is a cache, NOT a replacement for DB turns
//   ❗ Verbatim turns always have priority over summary
//   ❗ Summarization failure = graceful degradation (no summary, not crash)
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Intent Budgets (tokens)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Token allocation per intent type.
 *
 * Each intent has a different mix of context needs:
 * - history:  conversation turns (verbatim + optional summary)
 * - search:   web search results / tool data
 * - ltm:      long-term memory facts
 */
export const INTENT_BUDGETS = Object.freeze({
  CONVERSATIONAL: { history: 2000, search: 0,    ltm: 500  },
  CREATIVE:       { history: 3000, search: 0,    ltm: 300  },
  SEARCH:         { history: 500,  search: 3000, ltm: 200  },
  FACTUAL:        { history: 500,  search: 2000, ltm: 200  },
  REPORT:         { history: 300,  search: 5000, ltm: 200  },
  ITEM_LOOKUP:    { history: 300,  search: 4000, ltm: 200  },
  CODE:           { history: 1500, search: 0,    ltm: 500  },
  LOCAL:          { history: 800,  search: 0,    ltm: 300  },
  COMMAND:        { history: 300,  search: 0,    ltm: 0    },
  AMBIGUOUS:      { history: 1000, search: 0,    ltm: 300  },
  BUILD:          { history: 1000, search: 0,    ltm: 500  },
  // Future: PROJECT and EXPERT budgets
  _PROJECT:       { history: 4000, search: 2000, ltm: 500  },
  _EXPERT:        { history: 3000, search: 2000, ltm: 1000 },
});

/**
 * Default budget when intent is unknown or missing from table.
 */
const DEFAULT_BUDGET = { history: 1000, search: 2000, ltm: 300 };

// ─────────────────────────────────────────────────────────────────────────────
// Token Estimation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimate token count for text.
 *
 * Czech text averages ~3.5 chars/token (longer words, diacritics).
 * English text averages ~4 chars/token.
 * We use 3.5 as conservative estimate for mixed content.
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 3.5);
}

// ─────────────────────────────────────────────────────────────────────────────
// Budget Resolver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get token budget for a given intent.
 *
 * @param {string} intent — IntentType value
 * @returns {{ history: number, search: number, ltm: number }}
 */
export function getBudgetForIntent(intent) {
  return INTENT_BUDGETS[intent] || DEFAULT_BUDGET;
}

// ─────────────────────────────────────────────────────────────────────────────
// Summarization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Summary prompt — deterministic, factual, no interpretation.
 */
const SUMMARY_SYSTEM_PROMPT = `Jsi sumarizační modul. Shrň následující konverzaci do stručného, faktického přehledu.

PRAVIDLA:
- POUZE fakta z konverzace (co uživatel řekl, co asistent odpověděl)
- Žádné interpretace, žádné závěry, žádná hodnocení, žádná doporučení
- Shrnutí NESMÍ obsahovat názory, predikce ani rady — pouze to, co se v konverzaci stalo
- Maximálně 5 vět
- Zachovej: jména, čísla, data, rozhodnutí, akční body
- Ignoruj: pozdravy, small talk, opakování
- Piš ve stejném jazyce jako konverzace

FORMÁT:
Stručné shrnutí v odstavci. Žádné seznamy, žádné odrážky.`;

/**
 * Build a summarization prompt for older turns.
 *
 * @param {Array<{ role: string, content: string }>} turns
 * @returns {string}
 */
export function buildSummaryPrompt(turns) {
  const turnText = turns
    .map(t => `${t.role}: ${t.content}`)
    .join('\n');

  return `Shrň tuto konverzaci:\n\n${turnText}`;
}

/**
 * Get the summary system prompt.
 * Exported for testing.
 */
export function getSummarySystemPrompt() {
  return SUMMARY_SYSTEM_PROMPT;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: Build Budgeted Context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a token-budgeted context for a given intent.
 *
 * This replaces the hardcoded `store.buildHandlerHistory(id, 10)`.
 *
 * Algorithm:
 *   1. Get budget for intent
 *   2. Load recent turns from DB
 *   3. Fill verbatim turns from newest to oldest, within budget
 *   4. If not all turns fit → check for existing summary or mark as needed
 *   5. Trim LTM context to budget
 *
 * @param {string} conversationId
 * @param {string} intent — IntentType value
 * @param {Object} opts
 * @param {Object} opts.store — ConversationStore instance
 * @param {string} [opts.ltmContext=''] — Pre-built LTM context string
 * @param {Function} [opts.summarizer=null] — async (turns) → string (LLM call)
 * @returns {Promise<BudgetedContext>}
 */
export async function buildBudgetedContext(conversationId, intent, opts = {}) {
  const { store, ltmContext = '', summarizer = null } = opts;

  if (!store) {
    logger.warn('ContextBudget', 'No store provided, returning empty context');
    return createEmptyContext(intent);
  }

  const budget = getBudgetForIntent(intent);

  // ─── Step 1: Load turns (more than needed for budget check) ───
  const MAX_LOAD = 30; // load up to 30 turns to check if summary is needed
  const allTurns = store.getRecentTurns(conversationId, MAX_LOAD);

  if (allTurns.length === 0) {
    return createEmptyContext(intent);
  }

  // ─── Step 2: Fill verbatim turns from newest, within budget ───
  const verbatimTurns = [];
  let historyTokens = 0;

  // Iterate from newest to oldest
  for (let i = allTurns.length - 1; i >= 0; i--) {
    const turn = allTurns[i];
    const turnTokens = estimateTokens(turn.content);

    if (historyTokens + turnTokens > budget.history) {
      break;
    }

    verbatimTurns.unshift(turn); // prepend to maintain order
    historyTokens += turnTokens;
  }

  // ─── Step 3: Determine if summary is needed ───
  let summary = null;
  let summaryTokens = 0;
  let summaryUsed = false;
  let summaryMsgId = null;

  const olderTurnsExist = verbatimTurns.length < allTurns.length;

  if (olderTurnsExist) {
    // Check for existing summary in store
    const existingSummary = store.getSummary?.(conversationId);

    if (existingSummary?.summary) {
      const oldestVerbatimId = verbatimTurns[0]?.id || 0;
      const summaryUpToId = existingSummary.upToMsgId || 0;

      // Summary is still valid if it covers turns before our verbatim window
      if (summaryUpToId > 0 && summaryUpToId < oldestVerbatimId) {
        summary = existingSummary.summary;
        summaryTokens = estimateTokens(summary);
        summaryUsed = true;
        summaryMsgId = summaryUpToId;
      }
    }

    // If no valid summary exists and we have a summarizer, create one
    if (!summary && summarizer) {
      const olderTurns = allTurns.slice(0, allTurns.length - verbatimTurns.length);
      try {
        summary = await summarizer(olderTurns);
        summaryTokens = estimateTokens(summary);
        summaryUsed = true;

        // Persist for future use
        const lastOlderId = olderTurns[olderTurns.length - 1]?.id || 0;
        summaryMsgId = lastOlderId;
        if (store.setSummary) {
          store.setSummary(conversationId, summary, lastOlderId);
        }
      } catch (err) {
        // Graceful degradation: continue without summary
        logger.warn('ContextBudget', `Summarization failed: ${err.message}`);
        summary = null;
        summaryTokens = 0;
      }
    }
  }

  // ─── Step 4: Budget LTM context ───
  let trimmedLtm = ltmContext;
  let ltmTokens = estimateTokens(ltmContext);

  if (ltmTokens > budget.ltm && budget.ltm > 0) {
    // Truncate LTM to budget (rough: cut by character ratio)
    const ratio = budget.ltm / ltmTokens;
    const maxChars = Math.floor(ltmContext.length * ratio);
    trimmedLtm = ltmContext.substring(0, maxChars);
    ltmTokens = budget.ltm;
  } else if (budget.ltm === 0) {
    trimmedLtm = '';
    ltmTokens = 0;
  }

  // ─── Step 5: Build handler-compatible history ───
  const handlerHistory = verbatimTurns.map(t => ({
    response: {
      tag: { speaker: t.role === 'assistant' ? 'system' : t.role },
      content: t.content,
    },
    timestamp: new Date(t.created_at).getTime(),
  }));

  // ─── Result ───
  const totalTokens = historyTokens + summaryTokens + ltmTokens;

  return {
    historyTurns: verbatimTurns,
    handlerHistory,
    summary,
    ltmContext: trimmedLtm,
    tokenUsage: {
      history: historyTokens,
      summary: summaryTokens,
      ltm: ltmTokens,
      total: totalTokens,
      budget: budget.history + budget.ltm,
    },
    source: {
      summaryUsed,
      summaryMsgId,
      verbatimCount: verbatimTurns.length,
      totalTurnsInDB: allTurns.length,
      olderTurnsExist,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Build history context string (for prompt injection)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format budgeted context into a prompt-ready string.
 *
 * @param {BudgetedContext} budgeted — Result from buildBudgetedContext
 * @returns {string}
 */
export function formatBudgetedHistory(budgeted) {
  const parts = [];

  // Summary first (older context)
  if (budgeted.summary) {
    parts.push(`[Shrnutí předchozí konverzace: ${budgeted.summary}]`);
  }

  // Verbatim turns
  if (budgeted.historyTurns.length > 0) {
    const turnLines = budgeted.historyTurns
      .map(t => `${t.role}: ${t.content}`)
      .join('\n');
    parts.push(turnLines);
  }

  return parts.join('\n\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createEmptyContext(intent) {
  const budget = getBudgetForIntent(intent);
  return {
    historyTurns: [],
    handlerHistory: [],
    summary: null,
    ltmContext: '',
    tokenUsage: {
      history: 0,
      summary: 0,
      ltm: 0,
      total: 0,
      budget: budget.history + budget.ltm,
    },
    source: {
      summaryUsed: false,
      summaryMsgId: null,
      verbatimCount: 0,
      totalTurnsInDB: 0,
      olderTurnsExist: false,
    },
  };
}

export default {
  INTENT_BUDGETS,
  estimateTokens,
  getBudgetForIntent,
  buildBudgetedContext,
  formatBudgetedHistory,
  buildSummaryPrompt,
  getSummarySystemPrompt,
};
