// v67.1 — Auto-Compact: Background Context Compression (hardened)
// ══════════════════════════════════════════════════════════════════════════════
//
// Background compaction; a later turn waits if its history would otherwise
// discard unsummarized messages.
// When conversation context exceeds threshold (default 75% of context window),
// or the unsummarized history reaches the handler's ten-turn limit, older turns
// are summarized by LLM and stored as a compressed summary.
// The conversation continues uninterrupted during compaction.
//
// Flow:
//   Turn N triggers compact at 77% → compact runs in background
//   → current turn proceeds normally
//   → background: older messages → LLM summarize → atomic setSummary()
//   Turn N+1: sees [summary] + [last K turns] + [new msg]
//
// Hardening (v67.1):
//   - Cooldown timer per conversation for token-pressure compactions
//   - Turn-count limit instead of string truncation
//   - System prompt overhead in token estimation
//   - Post-compaction token recalculation + delta logging
//   - Invariant checks (upToMsgId monotonic, summary non-empty)
//
// ══════════════════════════════════════════════════════════════════════════════

import { config } from '../config.js';
import { logger } from '../core/logger.js';
import { callWithAuth } from '../llm/gateway.js';
import { createAuthToken, LLMCallerRole, LLMCapability } from '../llm/auth-types.js';
import { getNumCtx } from '../llm/model-ctx.js';
import { abortErrorFromSignal, throwIfAborted } from '../core/abort-error.js';

// Track active compactions — prevent concurrent runs per conversation
const activeCompactions = new Map();

// Cooldown timestamps — conversationId → last completion timestamp
const lastCompactionTime = new Map();

// Minimum interval between compactions for the same conversation (ms)
const COMPACTION_COOLDOWN_MS = 30_000; // 30 seconds

// Estimated overhead for system prompt, project context, CRE hints, etc.
// This is NOT counted in messages table, but takes real context space.
const SYSTEM_PROMPT_OVERHEAD_TOKENS = 1500;

// Maximum number of turns to feed into a single summary LLM call
const MAX_TURNS_TO_SUMMARIZE = 50;

// ChatController builds handler history with a ten-turn raw-message limit.
// Trigger while every unsummarized turn is still in that history, before the
// next message can displace its oldest turn. Keep this in sync with controller.
const HANDLER_HISTORY_MAX_TURNS = 10;
const SUMMARY_OUTPUT_TOKEN_CAP = 1000; // TOOL_INTERNAL ceiling is 2048.

function effectiveKeepTurns(configured) {
  if (!Number.isSafeInteger(configured) || configured < 1) {
    throw new Error('INTENTSMITH_COMPACT_KEEP_TURNS must be a positive integer');
  }
  // Reserve one slot for the summary and one for the next user's message.
  // Otherwise the first post-compaction turn can evict an unsummarized fact.
  return Math.min(configured, HANDLER_HISTORY_MAX_TURNS - 2);
}

/** Snapshot every compaction limit from one effective model context. */
export function getCompactionBudget(
  summaryModel = config.compact.summaryModel || config.models.CHAT,
) {
  const contextWindow = getNumCtx(summaryModel, config.compact.contextWindow);
  return Object.freeze({
    summaryModel,
    contextWindow,
    thresholdTokens: Math.floor(contextWindow * config.compact.threshold),
    safetyMaxChars: Math.floor(contextWindow * 0.6) * 4,
    maxOutputTokens: Math.min(SUMMARY_OUTPUT_TOKEN_CAP, Math.floor(contextWindow / 4)),
  });
}

/**
 * Check if compaction is needed and fire it in the background if so.
 * This is FIRE-AND-FORGET — the caller does not await the result.
 *
 * @param {string} conversationId
 * @param {Object} store — ConversationStore instance
 * @param {string} [sessionId] — For audit context
 */
export function maybeCompact(conversationId, store, sessionId) {
  if (!conversationId || !store) return;
  if (activeCompactions.has(conversationId)) return;

  const keepTurns = effectiveKeepTurns(config.compact.keepTurns);
  const unsummarizedTurns = store.getUnsummarizedTurnCount?.(conversationId);
  const retentionDue = Number.isInteger(unsummarizedTurns)
    && unsummarizedTurns >= HANDLER_HISTORY_MAX_TURNS;

  // Token pressure remains rate-limited. Retention cannot wait 30 seconds:
  // the next short exchange could otherwise evict unsummarized messages.
  const lastTime = lastCompactionTime.get(conversationId);
  if (!retentionDue && lastTime && (Date.now() - lastTime) < COMPACTION_COOLDOWN_MS) return;

  // Effective context window: VRAM-optimized value from model-ctx registry,
  // falling back to config.compact.contextWindow if not yet initialized.
  const budget = getCompactionBudget();

  // Estimate the same bounded, summary-aware history supplied to chat handlers.
  const messageTokens = store.getEffectiveHistoryTokens(conversationId);
  const totalTokens = messageTokens + SYSTEM_PROMPT_OVERHEAD_TOKENS;

  if (!retentionDue && totalTokens < budget.thresholdTokens) return;

  logger.info('AutoCompact', `Triggering compaction`, {
    conversationId: conversationId.substring(0, 12),
    messageTokens,
    totalTokens,
    thresholdTokens: budget.thresholdTokens,
    fillPercent: Math.round((totalTokens / budget.contextWindow) * 100),
    reason: retentionDue ? 'history-retention' : 'token-threshold',
    unsummarizedTurns,
    configuredKeepTurns: config.compact.keepTurns,
    effectiveKeepTurns: keepTurns,
  });

  // The first turn proceeds while compaction runs. Keep the promise so the
  // following turn can wait before its ten-message history snapshot clips data.
  const work = runCompaction(conversationId, store, keepTurns, sessionId, budget);
  activeCompactions.set(conversationId, work);
  work.then(() => activeCompactions.delete(conversationId), err => {
    logger.error('AutoCompact', `Compaction failed: ${err.message}`, {
      conversationId: conversationId.substring(0, 12),
    });
    activeCompactions.delete(conversationId);
  });
}

/** Wait for a shared background summary without cancelling it for other turns. */
export async function awaitPendingCompaction(conversationId, signal = null) {
  throwIfAborted(signal);
  const work = activeCompactions.get(conversationId);
  if (!work) return;
  if (!signal) return work;
  let onAbort;
  const cancelled = new Promise((_, reject) => {
    onAbort = () => reject(abortErrorFromSignal(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    await Promise.race([work, cancelled]);
    throwIfAborted(signal);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Never build a ten-message snapshot while older raw messages lack a summary. */
export async function ensureCompactionBeforeNextTurn(conversationId, store, sessionId, signal = null) {
  throwIfAborted(signal);
  const count = store.getUnsummarizedTurnCount?.(conversationId);
  if (!Number.isSafeInteger(count)) throw new Error('CONTEXT_HISTORY_COUNT_UNAVAILABLE');
  if (count < HANDLER_HISTORY_MAX_TURNS) return;
  // Retry a prior failed/incomplete compaction before the next user turn is
  // persisted. Failed model output remains raw and durable, never a summary.
  if (count >= HANDLER_HISTORY_MAX_TURNS && !activeCompactions.has(conversationId)) {
    maybeCompact(conversationId, store, sessionId);
  }
  await awaitPendingCompaction(conversationId, signal);
  const remaining = store.getUnsummarizedTurnCount?.(conversationId);
  if (!Number.isSafeInteger(remaining) || remaining >= HANDLER_HISTORY_MAX_TURNS) {
    throw new Error('CONTEXT_SUMMARY_UNAVAILABLE');
  }
}

/**
 * Run the actual compaction — summarize older turns, store as summary.
 *
 * @param {string} conversationId
 * @param {Object} store
 * @param {number} keepTurns — Number of recent turns to keep uncompressed
 * @param {string} [sessionId]
 */
async function runCompaction(conversationId, store, keepTurns, sessionId, budget) {
  try {
    const allTurns = store.getAllTurns(conversationId);
    if (allTurns.length <= keepTurns) return;

    // Split: older turns to summarize, recent turns to keep
    const cutoff = allTurns.length - keepTurns;
    const turnsToSummarize = allTurns.slice(0, cutoff);
    const lastTurnId = turnsToSummarize[turnsToSummarize.length - 1].id;

    // ─── Invariant: upToMsgId must be monotonically increasing ───
    const existing = store.getSummary(conversationId);
    if (existing && existing.upToMsgId >= lastTurnId) return;
    if (existing && existing.upToMsgId && lastTurnId < existing.upToMsgId) {
      logger.error('AutoCompact', 'INVARIANT VIOLATION: upToMsgId would decrease', {
        conversationId: conversationId.substring(0, 12),
        existingUpTo: existing.upToMsgId,
        newUpTo: lastTurnId,
      });
      return;
    }

    // Build text to summarize (include previous summary if exists)
    // Limit by TURN COUNT, not string length — avoids cutting mid-message
    let textToSummarize = '';
    if (existing && existing.summary) {
      textToSummarize += `[Předchozí souhrn]\n${existing.summary}\n\n[Nové zprávy od posledního souhrnu]\n`;
      const newTurns = turnsToSummarize.filter(t => t.id > (existing.upToMsgId || 0));
      if (newTurns.length > MAX_TURNS_TO_SUMMARIZE) throw new Error('CONTEXT_SUMMARY_INPUT_TOO_MANY_TURNS');
      textToSummarize += newTurns.map(t => `${t.role}: ${t.content}`).join('\n');
    } else {
      if (turnsToSummarize.length > MAX_TURNS_TO_SUMMARIZE) throw new Error('CONTEXT_SUMMARY_INPUT_TOO_MANY_TURNS');
      textToSummarize += turnsToSummarize.map(t => `${t.role}: ${t.content}`).join('\n');
    }

    // If even the bounded source does not fit, keep durable raw history and
    // fail closed. Truncating its prefix would falsely mark omitted turns as
    // summarized and erase them from the next handler's effective context.
    const maxChars = budget.safetyMaxChars;
    if (textToSummarize.length > maxChars) {
      logger.warn('AutoCompact', 'Summary input exceeds context budget', {
        textLength: textToSummarize.length, maxChars,
      });
      throw new Error('CONTEXT_SUMMARY_INPUT_TOO_LARGE');
    }

    let result;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = createAuthToken({
        role: LLMCallerRole.TOOL_INTERNAL,
        decisionId: `compact-${conversationId.substring(0, 8)}-${Date.now()}-${attempt}`,
        auditContext: { sessionId: sessionId || 'system' },
        maxTokens: budget.maxOutputTokens,
        capabilities: [LLMCapability.SUMMARIZATION],
      });
      const prompt = [
        'Jsi konverzační asistent. Shrň následující konverzaci stručně a úplně.',
        'Zachovej rozhodnutí, kontext projektu, dosud provedené akce a uživatelské preference.',
        attempt ? 'Předchozí pokus dosáhl výstupního limitu. Napiš celý souhrn úsporněji, přibližně do 120 slov.'
          : 'Piš česky, přibližně do 200 slov. Souhrn dokonči.',
        '', textToSummarize, '', '---', 'Souhrn:',
      ].join('\n');
      result = await callWithAuth(token, prompt, {
        model: budget.summaryModel,
        num_ctx: budget.contextWindow,
        maxTokens: budget.maxOutputTokens,
        timeout: 60000,
      });
      if (result?.finishReason === 'stop' && result.content?.trim()) break;
      if (result?.finishReason !== 'length') break;
    }
    // Incomplete or empty summaries must never replace raw history.
    if (result?.finishReason !== 'stop' || !result.content?.trim()) {
      throw new Error(`CONTEXT_SUMMARY_INCOMPLETE:${result?.finishReason || 'unknown'}`);
    }

    const summaryText = result.content.trim();

    // ─── Invariant: keepTurns must not be part of summary ───
    // lastTurnId is the ID of the LAST turn we summarized.
    // Kept turns all have id > lastTurnId. This is guaranteed by the slice logic.

    // Measure immediately around the synchronous summary write so any turns
    // appended while the LLM was working do not appear as compaction savings.
    const tokensBefore = store.getEffectiveHistoryTokens(conversationId);

    // Atomic store
    store.setSummary(conversationId, summaryText, lastTurnId);

    // Post-compaction: recalculate the same handler view and log its delta.
    const tokensAfter = store.getEffectiveHistoryTokens(conversationId);
    const summaryTokens = Math.ceil(summaryText.length / 4);
    const savedTokens = tokensBefore - tokensAfter;
    const newFillPercent = Math.round(
      ((tokensAfter + SYSTEM_PROMPT_OVERHEAD_TOKENS) / budget.contextWindow) * 100,
    );

    logger.info('AutoCompact', `Compaction complete`, {
      conversationId: conversationId.substring(0, 12),
      summarizedTurns: turnsToSummarize.length,
      keptTurns: keepTurns,
      summaryTokens,
      upToMsgId: lastTurnId,
      tokensBefore,
      tokensAfter,
      savedTokens,
      newFillPercent,
    });
  } finally {
    lastCompactionTime.set(conversationId, Date.now());
  }
}

/**
 * Check if a compaction is currently running for a conversation.
 * @param {string} conversationId
 * @returns {boolean}
 */
export function isCompacting(conversationId) {
  return activeCompactions.has(conversationId);
}
