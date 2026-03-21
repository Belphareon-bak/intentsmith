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
//   Loop 2 — Self-Refinement: If score still < 75 after retry, ask LLM to
//            critique and rewrite its own response. Adds 1 extra LLM call
//            (~2-4s latency). Only triggers for low-quality responses.
//
// Integration:
//   - Fast Retry: called inside synthesizeWithLLM() retry loop
//   - Self-Refinement: called after synthesis returns, before final return
//
// Telemetry:
//   Every improvement attempt is logged with before/after scores.
//
// ═══════════════════════════════════════════════════════════════════════════════

import { logger } from '../../core/logger.js';
import { scoreResponse, buildScoreRetryPrompt } from './response-scorer.js';

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

  const scoreBefore = scoreResponse(response, context);

  // Only refine if below refinement threshold
  if (scoreBefore.total >= scoreBefore.threshold.refinement) {
    return { improved: false, response, scoreBefore, scoreAfter: null };
  }

  // Don't refine very short or empty responses
  if (!response || response.length < 20) {
    return { improved: false, response, scoreBefore, scoreAfter: null };
  }

  try {
    const refinementPrompt = buildRefinementPrompt(query, response, scoreBefore, lang);

    const result = await callLLM(refinementPrompt, '', {
      sessionId: `refine-${opts.sessionId || 'default'}`,
      temperature: 0.3,
      signal: opts.signal,
    });

    if (!result?.content || result.content.length < 20) {
      logger.warn('ImprovementLoop', 'Self-refinement returned empty/short result');
      return { improved: false, response, scoreBefore, scoreAfter: null };
    }

    const scoreAfter = scoreResponse(result.content, context);

    // Only accept if refinement actually improved the score
    if (scoreAfter.total > scoreBefore.total) {
      logger.info('ImprovementLoop', 'Self-refinement improved response', {
        scoreBefore: scoreBefore.total,
        scoreAfter: scoreAfter.total,
        delta: scoreAfter.total - scoreBefore.total,
        intent,
      });
      return { improved: true, response: result.content, scoreBefore, scoreAfter };
    }

    // Refinement didn't improve — keep original
    logger.info('ImprovementLoop', 'Self-refinement did not improve, keeping original', {
      scoreBefore: scoreBefore.total,
      scoreAfter: scoreAfter.total,
    });
    return { improved: false, response, scoreBefore, scoreAfter };

  } catch (err) {
    logger.warn('ImprovementLoop', `Self-refinement failed: ${err.message}`);
    return { improved: false, response, scoreBefore, scoreAfter: null };
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
    originalScore: null,
    finalScore: null,
    loopsUsed: 0,
    improved: false,
    mode,
  };

  const scoreBefore = scoreResponse(response, context);
  telemetry.originalScore = scoreBefore.total;

  // Mode: fast — only score, no improvement
  if (mode === 'fast') {
    telemetry.finalScore = scoreBefore.total;
    return { response, improved: false, telemetry };
  }

  // Self-refinement (balanced/max mode)
  if (callLLM && scoreBefore.total < scoreBefore.threshold.refinement) {
    const refinement = await selfRefine(response, context, callLLM, opts);

    if (refinement.improved) {
      telemetry.loopsUsed++;
      telemetry.improved = true;
      telemetry.finalScore = refinement.scoreAfter.total;
      return { response: refinement.response, improved: true, telemetry };
    }
  }

  telemetry.finalScore = scoreBefore.total;
  return { response, improved: false, telemetry };
}

export default {
  fastRetryGate,
  selfRefine,
  improveResponse,
};
