// v67.1 — Auto-Compact: Background Context Compression (hardened)
// ══════════════════════════════════════════════════════════════════════════════
//
// NON-BLOCKING background compaction.
// When conversation context exceeds threshold (default 75% of context window),
// older turns are summarized by LLM and stored as a compressed summary.
// The conversation continues uninterrupted during compaction.
//
// Flow:
//   Turn N triggers compact at 77% → compact runs in background
//   → current turn proceeds normally
//   → background: older messages → LLM summarize → atomic setSummary()
//   Turn N+1: sees [summary] + [last K turns] + [new msg]
//
// Hardening (v67.1):
//   - Cooldown timer per conversation (min 30s between compactions)
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

// Track active compactions — prevent concurrent runs per conversation
const activeCompactions = new Set();

// Cooldown timestamps — conversationId → last completion timestamp
const lastCompactionTime = new Map();

// Minimum interval between compactions for the same conversation (ms)
const COMPACTION_COOLDOWN_MS = 30_000; // 30 seconds

// Estimated overhead for system prompt, project context, CRE hints, etc.
// This is NOT counted in messages table, but takes real context space.
const SYSTEM_PROMPT_OVERHEAD_TOKENS = 1500;

// Maximum number of turns to feed into a single summary LLM call
const MAX_TURNS_TO_SUMMARIZE = 50;

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

  // Cooldown check — don't re-trigger within 30s of last compaction
  const lastTime = lastCompactionTime.get(conversationId);
  if (lastTime && (Date.now() - lastTime) < COMPACTION_COOLDOWN_MS) return;

  const { threshold, keepTurns } = config.compact;

  // Effective context window: VRAM-optimized value from model-ctx registry,
  // falling back to config.compact.contextWindow if not yet initialized.
  const summaryModel = config.compact.summaryModel || config.models.CHAT;
  const contextWindow = getNumCtx(summaryModel, config.compact.contextWindow);

  // Token estimation: messages + system prompt overhead
  const messageTokens = store.getEstimatedTokens(conversationId);
  const totalTokens = messageTokens + SYSTEM_PROMPT_OVERHEAD_TOKENS;
  const thresholdTokens = Math.floor(contextWindow * threshold);

  if (totalTokens < thresholdTokens) return;

  logger.info('AutoCompact', `Triggering compaction`, {
    conversationId: conversationId.substring(0, 12),
    messageTokens,
    totalTokens,
    thresholdTokens,
    fillPercent: Math.round((totalTokens / contextWindow) * 100),
  });

  // Fire-and-forget
  runCompaction(conversationId, store, keepTurns, sessionId).catch(err => {
    logger.error('AutoCompact', `Compaction failed: ${err.message}`, {
      conversationId: conversationId.substring(0, 12),
    });
  });
}

/**
 * Run the actual compaction — summarize older turns, store as summary.
 *
 * @param {string} conversationId
 * @param {Object} store
 * @param {number} keepTurns — Number of recent turns to keep uncompressed
 * @param {string} [sessionId]
 */
async function runCompaction(conversationId, store, keepTurns, sessionId) {
  activeCompactions.add(conversationId);
  const tokensBefore = store.getEstimatedTokens(conversationId);

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
      const newTurns = turnsToSummarize
        .filter(t => t.id > (existing.upToMsgId || 0))
        .slice(-MAX_TURNS_TO_SUMMARIZE); // Take LAST N turns (most recent = most important)
      textToSummarize += newTurns.map(t => `${t.role}: ${t.content}`).join('\n');
    } else {
      const limitedTurns = turnsToSummarize.slice(-MAX_TURNS_TO_SUMMARIZE);
      textToSummarize += limitedTurns.map(t => `${t.role}: ${t.content}`).join('\n');

      // If we had to drop older turns, note it
      if (turnsToSummarize.length > MAX_TURNS_TO_SUMMARIZE) {
        textToSummarize = `[Přeskočeno ${turnsToSummarize.length - MAX_TURNS_TO_SUMMARIZE} starších zpráv]\n\n` + textToSummarize;
      }
    }

    // Safety truncate — hard limit at 60% contextWindow as last resort
    // (turn-count limit above should prevent this from ever triggering)
    const maxChars = Math.floor(config.compact.contextWindow * 0.6) * 4;
    if (textToSummarize.length > maxChars) {
      logger.warn('AutoCompact', 'Turn-limited text still exceeds char limit, truncating', {
        textLength: textToSummarize.length, maxChars,
      });
      textToSummarize = '...[zkráceno]\n' + textToSummarize.slice(-maxChars);
    }

    // Create auth token for compact LLM call
    const token = createAuthToken({
      role: LLMCallerRole.TOOL_INTERNAL,
      decisionId: `compact-${conversationId.substring(0, 8)}-${Date.now()}`,
      auditContext: { sessionId: sessionId || 'system' },
      capabilities: [LLMCapability.SUMMARIZATION],
    });

    const summaryModel = config.compact.summaryModel || config.models.CHAT;
    const prompt = [
      'Jsi konverzační asistent. Shrň následující konverzaci do stručného, ale kompletního souhrnu.',
      'Zachovej klíčové informace: rozhodnutí, kontext projektu, dosud provedené akce, uživatelské preference.',
      'Piš česky. Souhrn by měl být maximálně 500 slov.',
      '',
      textToSummarize,
      '',
      '---',
      'Souhrn:',
    ].join('\n');

    const result = await callWithAuth(token, prompt, {
      model: summaryModel,
      timeout: 60000,
    });

    // ─── Invariant: summary must not be empty ───
    if (!result || !result.content || !result.content.trim()) {
      logger.warn('AutoCompact', 'LLM returned empty summary — skipping', {
        conversationId: conversationId.substring(0, 12),
      });
      return;
    }

    const summaryText = result.content.trim();

    // ─── Invariant: keepTurns must not be part of summary ───
    // lastTurnId is the ID of the LAST turn we summarized.
    // Kept turns all have id > lastTurnId. This is guaranteed by the slice logic.

    // Atomic store
    store.setSummary(conversationId, summaryText, lastTurnId);

    // Post-compaction: recalculate tokens and log delta
    const tokensAfter = store.getEstimatedTokens(conversationId);
    const summaryTokens = Math.ceil(summaryText.length / 4);
    const savedTokens = tokensBefore - tokensAfter;
    const newFillPercent = Math.round(((tokensAfter + SYSTEM_PROMPT_OVERHEAD_TOKENS) / config.compact.contextWindow) * 100);

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
    activeCompactions.delete(conversationId);
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
