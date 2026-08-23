// ═══════════════════════════════════════════════════════════════════════════════
// Improvement Loops — Self-Correcting Response Pipeline
// ═══════════════════════════════════════════════════════════════════════════════
//
// v126: Two improvement loops that complement QGv2 structural fixes:
//
//   Loop 1 — Fast Retry: If semantic score < 60, re-prompt LLM with targeted
//            feedback. No extra LLM call overhead — reuses existing retry slot.
//            Deterministic trigger, minimal latency (~0s since it only affects
//            the retry prompt, not an extra call).
//
//   Loop 2 — Self-Refinement: historical B5 experiment retained only so the
//            measured Decision 024 evidence remains inspectable. Decision
//            024/C removed every production caller; this helper is not runtime
//            product behavior.
//
// Integration:
//   - Fast Retry: called inside synthesizeWithLLM() retry loop
//   - Self-Refinement: no production owner after Decision 024/C
//
// Telemetry:
//   Every improvement attempt is logged with before/after scores.
//
// ═══════════════════════════════════════════════════════════════════════════════

import { logger } from '../../core/logger.js';
import { scoreResponse, buildScoreRetryPrompt } from './response-scorer.js';

export const REFINEMENT_OWNER = null;

function normalizedUsage(result) {
  const promptTokens = result?.usage?.promptEvalCount
    ?? result?.promptEvalCount
    ?? result?.response?.usage?.promptEvalCount;
  const outputTokens = result?.usage?.evalCount
    ?? result?.evalCount
    ?? result?.response?.usage?.evalCount;
  const usage = {};
  if (Number.isFinite(promptTokens)) usage.promptTokens = promptTokens;
  if (Number.isFinite(outputTokens)) usage.outputTokens = outputTokens;
  if (Number.isFinite(promptTokens) && Number.isFinite(outputTokens)) {
    usage.totalTokens = promptTokens + outputTokens;
  }
  return usage;
}

function refinementResult({
  response,
  scoreBefore,
  scoreAfter = null,
  improved = false,
  attempted = false,
  outcome,
  startedAt,
  usage = {},
  providerDurationMs = null,
  similarity = null,
  errorCode = null,
}) {
  return {
    improved,
    response,
    scoreBefore,
    scoreAfter,
    attempted,
    outcome,
    latencyMs: attempted ? Math.max(0, Date.now() - startedAt) : 0,
    usage,
    providerDurationMs: Number.isFinite(providerDurationMs) ? providerDurationMs : null,
    similarity: Number.isFinite(similarity) ? similarity : null,
    errorCode,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Historical Delta Guard: token-level Jaccard overlap.
//
// The persisted outcome name `rejected_semantic_drift` predates Decision 024
// and remains for artifact compatibility. This metric is lexical overlap, not
// semantic similarity, and must not be used as a semantic acceptance claim.
// ─────────────────────────────────────────────────────────────────────────────

function tokenize(text) {
  return new Set((text || '').toLowerCase().split(/\W+/).filter(w => w.length > 2));
}

function tokenSimilarity(a, b) {
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let intersection = 0;
  for (const t of A) { if (B.has(t)) intersection++; }
  const union = new Set([...A, ...B]).size;
  return union > 0 ? intersection / union : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop 1: Fast Retry — Deterministic prompt enhancement
// ─────────────────────────────────────────────────────────────────────────────
// Called INSIDE the synthesis retry loop. Returns enhanced prompt if score is
// below threshold, or null if response is acceptable.

/**
 * Evaluate response and return retry prompt if quality is insufficient.
 *
 * @param {string} response — Current LLM output
 * @param {string} currentPrompt — Current synthesis prompt
 * @param {Object} context — { query, intent, lang }
 * @returns {{ shouldRetry: boolean, enhancedPrompt?: string, score: Object }}
 */
export function fastRetryGate(response, currentPrompt, context) {
  const score = scoreResponse(response, context);

  if (score.total >= score.threshold.retry) {
    return { shouldRetry: false, score };
  }

  // Score is below retry threshold — enhance prompt
  const retryInjection = buildScoreRetryPrompt(score);
  const enhancedPrompt = currentPrompt + retryInjection;

  logger.info('ImprovementLoop', 'Fast retry triggered', {
    score: score.total,
    threshold: score.threshold.retry,
    issues: score.issues,
    hintsCount: score.hints.length,
  });

  return {
    shouldRetry: true,
    enhancedPrompt,
    score,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Loop 2: Self-Refinement — LLM critique + rewrite
// ─────────────────────────────────────────────────────────────────────────────
// Called AFTER synthesis returns. Uses a secondary LLM call to critique and
// improve the response. Only triggers for score < refinement threshold.

/**
 * Build the critique prompt for self-refinement.
 *
 * @param {string} query — Original user query
 * @param {string} response — Current response
 * @param {Object} score — ResponseScore from scoreResponse()
 * @param {string} [lang='cs'] — Target language
 * @returns {string} System prompt for critique+rewrite
 */
function buildRefinementPrompt(query, response, score, lang = 'cs') {
  const issueDescriptions = [];

  if (score.dimensions.relevance < 0.4) {
    issueDescriptions.push('Odpověď neřeší otázku uživatele.');
  }
  if (score.dimensions.completeness < 0.4) {
    issueDescriptions.push('Odpověď je neúplná nebo příliš krátká/dlouhá.');
  }
  if (score.dimensions.coherence < 0.4) {
    issueDescriptions.push('Odpověď postrádá strukturu a přehlednost.');
  }
  if (score.dimensions.intentAlignment < 0.4) {
    issueDescriptions.push('Formát neodpovídá typu dotazu (např. chybí kód u CODE dotazu).');
  }
  if (score.dimensions.languageQuality < 0.4) {
    issueDescriptions.push('Jazyková kvalita je nízká (chybí diakritika, slovenismy).');
  }

  const langInstr = lang === 'cs'
    ? 'Piš výhradně česky s korektní diakritikou.'
    : 'Write in English.';

  return `Jsi recenzent odpovědí. Analyzuj a přepiš tuto odpověď tak, aby byla kvalitnější.

OTÁZKA UŽIVATELE:
${query}

SOUČASNÁ ODPOVĚĎ (kvalita ${score.total}/100):
${response}

ZJIŠTĚNÉ PROBLÉMY:
${issueDescriptions.length > 0 ? issueDescriptions.map(d => `- ${d}`).join('\n') : '- Obecně nízká kvalita'}

INSTRUKCE:
1. Zachovej všechny správné informace z původní odpovědi.
2. Oprav identifikované problémy.
3. ${langInstr}
4. Vrať POUZE vylepšenou odpověď — žádné komentáře, žádné vysvětlení.`;
}

/**
 * Attempt self-refinement of a response via LLM critique+rewrite.
 *
 * @param {string} response — Current response text
 * @param {Object} context — { query, intent, lang }
 * @param {Function} callLLM — async (prompt, systemPrompt, opts) => { content }
 * @param {Object} [opts] — { signal, sessionId, maxTimeMs }
 * @returns {Promise<{ improved: boolean, response: string, scoreBefore: Object, scoreAfter: Object|null }>}
 */
export async function selfRefine(response, context, callLLM, opts = {}) {
  const { query = '', intent = 'CONVERSATIONAL', lang = 'cs' } = context;
  const startedAt = Date.now();
  const measuredScore = scoreResponse(response, context);
  const scoreBefore = opts.scoreBefore && Number.isFinite(opts.scoreBefore.total)
    ? {
        ...measuredScore,
        ...opts.scoreBefore,
        threshold: measuredScore.threshold,
      }
    : measuredScore;

  // Only refine if below refinement threshold
  if (scoreBefore.total >= scoreBefore.threshold.refinement) {
    return refinementResult({
      response, scoreBefore, outcome: 'skipped_high_score', startedAt,
    });
  }

  // Don't refine very short or empty responses
  if (!response || response.length < 20) {
    return refinementResult({
      response, scoreBefore, outcome: 'skipped_short_or_empty', startedAt,
    });
  }

  try {
    const refinementPrompt = buildRefinementPrompt(query, response, scoreBefore, lang);

    const result = await callLLM(refinementPrompt, '', {
      sessionId: `refine-${opts.sessionId || 'default'}`,
      temperature: 0.3,
      signal: opts.signal,
    });

    const usage = normalizedUsage(result);
    const providerDurationMs = result?.duration;

    if (!result?.content || result.content.length < 20) {
      logger.warn('ImprovementLoop', 'Self-refinement returned empty/short result');
      return refinementResult({
        response,
        scoreBefore,
        attempted: true,
        outcome: 'rejected_empty_or_short',
        startedAt,
        usage,
        providerDurationMs,
      });
    }

    const candidate = result.content;
    const scoreAfter = scoreResponse(candidate, context);

    // ─── DRIFT GUARD 1: Similarity check ─────────────────────────
    // Reject if refined text drifts too far from original (Jaccard < 0.35)
    const similarity = tokenSimilarity(response, candidate);
    if (similarity < 0.35) {
      logger.info('ImprovementLoop', 'Refinement rejected: semantic drift', {
        similarity: similarity.toFixed(2), threshold: 0.35,
      });
      return refinementResult({
        response,
        scoreBefore,
        scoreAfter,
        attempted: true,
        outcome: 'rejected_semantic_drift',
        startedAt,
        usage,
        providerDurationMs,
        similarity,
      });
    }

    // ─── DRIFT GUARD 2: Length explosion check ───────────────────
    // Reject if refined text is >2× original length (balast/hallucination)
    if (candidate.length > response.length * 2.5) {
      logger.info('ImprovementLoop', 'Refinement rejected: length explosion', {
        originalLen: response.length, candidateLen: candidate.length,
      });
      return refinementResult({
        response,
        scoreBefore,
        scoreAfter,
        attempted: true,
        outcome: 'rejected_length_explosion',
        startedAt,
        usage,
        providerDurationMs,
        similarity,
      });
    }

    // ─── DRIFT GUARD 3: Intent preservation ──────────────────────
    // For CODE intent, reject if original had code blocks but refined doesn't
    if (intent === 'CODE' || intent === 'CODE_ANALYSIS') {
      const origHasCode = /```/.test(response);
      const candHasCode = /```/.test(candidate);
      if (origHasCode && !candHasCode) {
        logger.info('ImprovementLoop', 'Refinement rejected: code blocks removed');
        return refinementResult({
          response,
          scoreBefore,
          scoreAfter,
          attempted: true,
          outcome: 'rejected_code_removed',
          startedAt,
          usage,
          providerDurationMs,
          similarity,
        });
      }
    }

    // Only accept if refinement actually improved the score
    if (scoreAfter.total > scoreBefore.total) {
      logger.info('ImprovementLoop', 'Self-refinement improved response', {
        scoreBefore: scoreBefore.total,
        scoreAfter: scoreAfter.total,
        delta: scoreAfter.total - scoreBefore.total,
        intent,
      });
      return refinementResult({
        response: candidate,
        scoreBefore,
        scoreAfter,
        improved: true,
        attempted: true,
        outcome: 'accepted',
        startedAt,
        usage,
        providerDurationMs,
        similarity,
      });
    }

    // Refinement didn't improve — keep original
    logger.info('ImprovementLoop', 'Self-refinement did not improve, keeping original', {
      scoreBefore: scoreBefore.total,
      scoreAfter: scoreAfter.total,
    });
    return refinementResult({
      response,
      scoreBefore,
      scoreAfter,
      attempted: true,
      outcome: 'rejected_not_improved',
      startedAt,
      usage,
      providerDurationMs,
      similarity,
    });

  } catch (err) {
    const cancelled = opts.signal?.aborted
      || err?.name === 'AbortError'
      || err?.code === 'ABORT_ERR'
      || err?.code === 'MODEL_CANCELLED';
    const outcome = cancelled ? 'cancelled' : 'provider_error';
    logger.warn('ImprovementLoop', `Self-refinement ${outcome}: ${err.message}`);
    return refinementResult({
      response,
      scoreBefore,
      attempted: true,
      outcome,
      startedAt,
      errorCode: typeof err?.code === 'string'
        ? err.code
        : (typeof err?.name === 'string' ? err.name : 'MODEL_PROVIDER_ERROR'),
    });
  }
}

/**
 * Full improvement pipeline: fast retry gate + optional self-refinement.
 *
 * @param {string} response — Final response from synthesis
 * @param {Object} context — { query, intent, lang }
 * @param {Function} [callLLM] — Required for self-refinement
 * @param {Object} [opts] — { signal, sessionId, mode }
 * @returns {Promise<{ response: string, improved: boolean, telemetry: Object }>}
 */
export async function improveResponse(response, context, callLLM, opts = {}) {
  const mode = opts.mode || 'balanced'; // fast | balanced | max
  const telemetry = {
    schemaVersion: 1,
    owner: REFINEMENT_OWNER,
    originalScore: null,
    finalScore: null,
    loopsUsed: 0,
    improved: false,
    mode,
    attempted: false,
    accepted: false,
    outcome: 'not_evaluated',
    scoreBefore: null,
    scoreAfter: null,
    scoreDelta: null,
    latencyMs: 0,
    providerDurationMs: null,
    usage: {},
    similarity: null,
    errorCode: null,
  };

  const measuredScore = scoreResponse(response, context);
  const scoreBefore = opts.scoreBefore && Number.isFinite(opts.scoreBefore.total)
    ? {
        ...measuredScore,
        ...opts.scoreBefore,
        threshold: measuredScore.threshold,
      }
    : measuredScore;
  telemetry.originalScore = scoreBefore.total;
  telemetry.scoreBefore = scoreBefore;

  // Mode: fast — only score, no improvement
  if (mode === 'fast') {
    telemetry.finalScore = scoreBefore.total;
    telemetry.outcome = 'skipped_fast_mode';
    return { response, improved: false, telemetry };
  }

  if (scoreBefore.total >= scoreBefore.threshold.refinement) {
    telemetry.finalScore = scoreBefore.total;
    telemetry.outcome = 'skipped_high_score';
    return { response, improved: false, telemetry };
  }

  if (!callLLM) {
    telemetry.finalScore = scoreBefore.total;
    telemetry.outcome = 'skipped_no_provider';
    return { response, improved: false, telemetry };
  }

  const refinement = await selfRefine(response, context, callLLM, opts);
  telemetry.attempted = refinement.attempted;
  telemetry.accepted = refinement.improved;
  telemetry.improved = refinement.improved;
  telemetry.outcome = refinement.outcome;
  telemetry.scoreAfter = refinement.scoreAfter;
  telemetry.scoreDelta = refinement.scoreAfter
    ? refinement.scoreAfter.total - scoreBefore.total
    : null;
  telemetry.latencyMs = refinement.latencyMs;
  telemetry.providerDurationMs = refinement.providerDurationMs;
  telemetry.usage = refinement.usage;
  telemetry.similarity = refinement.similarity;
  telemetry.errorCode = refinement.errorCode;

  if (refinement.improved) {
    telemetry.loopsUsed = 1;
    telemetry.finalScore = refinement.scoreAfter.total;
    return { response: refinement.response, improved: true, telemetry };
  }

  telemetry.finalScore = scoreBefore.total;
  return { response, improved: false, telemetry };
}

// Exported for testing
export { tokenSimilarity };

export default {
  fastRetryGate,
  selfRefine,
  improveResponse,
  tokenSimilarity,
};
