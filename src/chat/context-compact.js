// v67.1 — Auto-Compact: Background Context Compression (hardened)
// ══════════════════════════════════════════════════════════════════════════════
//
// Background compaction; a later turn waits if its history would otherwise
// discard unsummarized messages.
// When conversation context exceeds threshold (default 75% of context window),
// or the unsummarized history reaches the bounded load limit, older turns
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
import { callWithAuth, llmGateway } from '../llm/gateway.js';
import { createAuthToken, LLMCallerRole, LLMCapability } from '../llm/auth-types.js';
import { getNumCtx } from '../llm/model-ctx.js';
import { abortErrorFromSignal, throwIfAborted } from '../core/abort-error.js';
import { CHAT_HISTORY_MAX_TURNS } from './conversation-context.js';

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

// ChatController loads up to CHAT_HISTORY_MAX_TURNS raw messages.
// Trigger while every unsummarized turn is still in that history, before the
// next message can displace its oldest turn. Keep this in sync with controller.
const HANDLER_HISTORY_MAX_TURNS = CHAT_HISTORY_MAX_TURNS;
const SUMMARY_OUTPUT_TOKEN_CAP = 1000; // TOOL_INTERNAL ceiling is 2048.
const MAX_USER_IDENTIFIER_QUOTES = 16;
const MAX_USER_IDENTIFIER_QUOTE_BYTES = 1024;
const IDENTIFIER_DECLARATION = /(?<![\p{L}\p{N}_])(?:kód|code|identifikátor|identifier|id|token|klíč|key)(?:[ \t]+(?:je|is)[ \t]+|[ \t]*[:=][ \t]*|[ \t]+)(?<value>[A-Za-z][A-Za-z0-9_-]{2,63})(?![\p{L}\p{N}_-]|\.[A-Za-z0-9])/giu;
const USER_QUOTE_HEADER = '[Doslovné citace z uživatelských zpráv; nejsou tvrzením asistenta]';

// The model may shorten a label/value relationship into an ambiguous topic.
// Keep a bounded, verbatim citation from the original user turn alongside its
// prose summary. Assistant replies never create citations: they may be wrong.
function exactUserIdentifierQuotes(turns) {
  const quotes = [];
  const seen = new Set();
  for (const turn of turns) {
    if (turn.role !== 'user') continue;
    if (!Number.isSafeInteger(turn.id) || turn.id <= 0) {
      throw new Error('CONTEXT_SUMMARY_SOURCE_ID_INVALID');
    }
    const content = turn.content;
    if (typeof content !== 'string') continue;
    for (const match of content.matchAll(IDENTIFIER_DECLARATION)) {
      const value = match.groups.value;
      // Ordinary words after a label are not exact identifiers.
      if (!/[0-9_-]/.test(value) && !/^[A-Z]{3,}$/.test(value)) continue;
      const key = `${match[0].slice(0, -value.length).toLocaleLowerCase('en-US')}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const start = Math.max(content.lastIndexOf('\n', match.index - 1),
        content.lastIndexOf('.', match.index - 1),
        content.lastIndexOf('!', match.index - 1),
        content.lastIndexOf('?', match.index - 1)) + 1;
      const endCandidates = ['\n', '.', '!', '?'].map(separator =>
        content.indexOf(separator, match.index + match[0].length)).filter(index => index !== -1);
      const end = endCandidates.length ? Math.min(...endCandidates) + 1 : content.length;
      const quoteStart = end - start > 240 ? Math.max(start, match.index - 64) : start;
      const quoteEnd = end - start > 240
        ? Math.min(end, match.index + match[0].length + 64) : end;
      quotes.push({ source: 'user', messageId: turn.id,
        quote: content.slice(quoteStart, quoteEnd).trim() });
      if (quotes.length > MAX_USER_IDENTIFIER_QUOTES) {
        throw new Error('CONTEXT_SUMMARY_IDENTIFIER_QUOTES_TOO_MANY');
      }
    }
  }
  const text = quotes.map(quote => JSON.stringify(quote)).join('\n');
  if (Buffer.byteLength(text, 'utf8') > MAX_USER_IDENTIFIER_QUOTE_BYTES) {
    throw new Error('CONTEXT_SUMMARY_IDENTIFIER_QUOTES_TOO_LARGE');
  }
  return text;
}

function formatSummaryTurn(turn) {
  const source = turn.role === 'assistant' ? 'assistant (neověřená odpověď)' : turn.role;
  return `${source}: ${turn.content}`;
}

function effectiveKeepTurns(configured, historyLimit = HANDLER_HISTORY_MAX_TURNS) {
  if (!Number.isSafeInteger(configured) || configured < 1) {
    throw new Error('INTENTSMITH_COMPACT_KEEP_TURNS must be a positive integer');
  }
  // Reserve one slot for the summary and one for the next user's message.
  // Otherwise the first post-compaction turn can evict an unsummarized fact.
  return Math.min(configured, historyLimit - 2);
}

/** Snapshot every compaction limit from one effective model context. */
export function getCompactionBudget(
  summaryModel = config.compact.summaryModel || config.models.CHAT,
) {
  const contextWindow = Math.min(getNumCtx(summaryModel, config.compact.contextWindow),
    llmGateway.getRoleContextWindow('CHAT',config.models.CHAT,config.compact.contextWindow));
  return Object.freeze({
    summaryModel,
    contextWindow,
    thresholdTokens: Math.floor(contextWindow * config.compact.threshold),
    safetyMaxChars: Math.floor(contextWindow * 0.6) * 4,
    maxOutputTokens: Math.min(SUMMARY_OUTPUT_TOKEN_CAP, Math.floor(contextWindow / 4),
      llmGateway.getRoleRuntimeSettings('CHAT',summaryModel)?.maxOutputTokens??Infinity),
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
export function maybeCompact(conversationId, store, sessionId, historyLimit = HANDLER_HISTORY_MAX_TURNS) {
  if (!conversationId || !store) return;
  if (activeCompactions.has(conversationId)) return;

  const keepTurns = effectiveKeepTurns(config.compact.keepTurns, historyLimit);
  const unsummarizedTurns = store.getUnsummarizedTurnCount?.(conversationId);
  const retentionDue = Number.isInteger(unsummarizedTurns)
    && unsummarizedTurns >= historyLimit;

  // Token pressure remains rate-limited. Retention cannot wait 30 seconds:
  // the next short exchange could otherwise evict unsummarized messages.
  const lastTime = lastCompactionTime.get(conversationId);
  if (!retentionDue && lastTime && (Date.now() - lastTime) < COMPACTION_COOLDOWN_MS) return;

  // Effective context window: VRAM-optimized value from model-ctx registry,
  // falling back to config.compact.contextWindow if not yet initialized.
  const budget = getCompactionBudget();

  // Estimate the same bounded, summary-aware history supplied to chat handlers.
  const messageTokens = store.getEffectiveHistoryTokens(conversationId, historyLimit);
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
  // following turn can wait before its bounded history snapshot clips data.
  const work = runCompaction(conversationId, store, keepTurns, sessionId, { ...budget, historyLimit });
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

/** Never discard raw messages at the load cap without a completed summary. */
export async function ensureCompactionBeforeNextTurn(conversationId, store, sessionId, signal = null, historyLimit = HANDLER_HISTORY_MAX_TURNS) {
  throwIfAborted(signal);
  // Token pressure can start a summary well before the load cap. Do not
  // construct the next prompt from a range that is currently being archived.
  await awaitPendingCompaction(conversationId, signal);
  // An exchange can arrive while a token-pressure summary is running. Recheck
  // once and compact a fresh range if it still reaches the bounded load cap.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const count = store.getUnsummarizedTurnCount?.(conversationId);
    if (!Number.isSafeInteger(count)) throw new Error('CONTEXT_HISTORY_COUNT_UNAVAILABLE');
    if (count < historyLimit) return;
    // Retry a prior failed/incomplete compaction before the bounded handler
    // snapshot. Failed model output remains raw and durable, never a summary.
    if (!activeCompactions.has(conversationId)) maybeCompact(conversationId, store, sessionId, historyLimit);
    await awaitPendingCompaction(conversationId, signal);
    const remaining = store.getUnsummarizedTurnCount?.(conversationId);
    if (!Number.isSafeInteger(remaining)) throw new Error('CONTEXT_HISTORY_COUNT_UNAVAILABLE');
    if (remaining < historyLimit) return;
    if (remaining >= count) throw new Error('CONTEXT_SUMMARY_UNAVAILABLE');
  }
  throw new Error('CONTEXT_SUMMARY_UNAVAILABLE');
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
    const userIdentifierQuotes = exactUserIdentifierQuotes(turnsToSummarize);

    // Build text to summarize (include previous summary if exists)
    // Limit by TURN COUNT, not string length — avoids cutting mid-message
    let textToSummarize = '';
    if (existing && existing.summary) {
      const existingProse = existing.summary.split(`\n\n${USER_QUOTE_HEADER}\n`)[0];
      textToSummarize += `[Předchozí souhrn]\n${existingProse}\n\n[Nové zprávy od posledního souhrnu]\n`;
      const newTurns = turnsToSummarize.filter(t => t.id > (existing.upToMsgId || 0));
      if (newTurns.length > MAX_TURNS_TO_SUMMARIZE) throw new Error('CONTEXT_SUMMARY_INPUT_TOO_MANY_TURNS');
      textToSummarize += newTurns.map(formatSummaryTurn).join('\n');
    } else {
      if (turnsToSummarize.length > MAX_TURNS_TO_SUMMARIZE) throw new Error('CONTEXT_SUMMARY_INPUT_TOO_MANY_TURNS');
      textToSummarize += turnsToSummarize.map(formatSummaryTurn).join('\n');
    }
    const userQuoteBlock = userIdentifierQuotes
      ? `\n\n${USER_QUOTE_HEADER}\n${userIdentifierQuotes}` : '';
    textToSummarize += userQuoteBlock;

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

    // Keep the model's prose and the deterministic citation together inside
    // the same output allowance instead of silently growing the next prompt.
    const modelOutputTokens = budget.maxOutputTokens - Math.ceil(userQuoteBlock.length / 4);
    if (modelOutputTokens < 128) throw new Error('CONTEXT_SUMMARY_IDENTIFIER_QUOTES_TOO_LARGE');

    let result;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = createAuthToken({
        role: LLMCallerRole.TOOL_INTERNAL,
        decisionId: `compact-${conversationId.substring(0, 8)}-${Date.now()}-${attempt}`,
        auditContext: { sessionId: sessionId || 'system' },
        maxTokens: modelOutputTokens,
        capabilities: [LLMCapability.SUMMARIZATION],
      });
      const prompt = [
        'Jsi konverzační asistent. Shrň následující konverzaci stručně a úplně.',
        'Zachovej rozhodnutí, kontext projektu, dosud provedené akce a uživatelské preference.',
        'Přesná uživatelská označení a jejich hodnoty nepřekládej, nepřejmenovávej ani nezaměňuj s názvem projektu.',
        'Předchozí odpovědi asistenta mohou být chybné. Pokud je shrnuješ, označ je jako odpovědi asistenta; nepovyšuj je na ověřená fakta.',
        attempt ? 'Předchozí pokus dosáhl výstupního limitu. Napiš celý souhrn úsporněji, přibližně do 120 slov.'
          : 'Piš česky, přibližně do 200 slov. Souhrn dokonči.',
        '', textToSummarize, '', '---', 'Souhrn:',
      ].join('\n');
      result = await callWithAuth(token, prompt, {
        model: budget.summaryModel,
        num_ctx: budget.contextWindow,
        maxTokens: modelOutputTokens,
        timeout: 60000,
        correlation:{modelRole:budget.summaryModel===config.models.CHAT?'CHAT':null},
      });
      if (result?.finishReason === 'stop' && result.content?.trim()) break;
      if (result?.finishReason !== 'length') break;
    }
    // Incomplete or empty summaries must never replace raw history.
    if (result?.finishReason !== 'stop' || !result.content?.trim()) {
      throw new Error(`CONTEXT_SUMMARY_INCOMPLETE:${result?.finishReason || 'unknown'}`);
    }
    // Only source turns may create the reserved citation block. A model can
    // echo its header from the prompt or fabricate one; storing that text
    // would make the next recursive summary mistake model prose for provenance.
    if (result.content.includes(USER_QUOTE_HEADER)) {
      throw new Error('CONTEXT_SUMMARY_PROVENANCE_DELIMITER_IN_MODEL_OUTPUT');
    }

    const summaryText = result.content.trim() + userQuoteBlock;
    if (summaryText.length > budget.safetyMaxChars) {
      throw new Error('CONTEXT_SUMMARY_OUTPUT_TOO_LARGE');
    }

    // ─── Invariant: keepTurns must not be part of summary ───
    // lastTurnId is the ID of the LAST turn we summarized.
    // Kept turns all have id > lastTurnId. This is guaranteed by the slice logic.

    // Measure immediately around the synchronous summary write so any turns
    // appended while the LLM was working do not appear as compaction savings.
    const tokensBefore = store.getEffectiveHistoryTokens(conversationId, budget.historyLimit);

    // Atomic store
    store.setSummary(conversationId, summaryText, lastTurnId);

    // Post-compaction: recalculate the same handler view and log its delta.
    const tokensAfter = store.getEffectiveHistoryTokens(conversationId, budget.historyLimit);
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
