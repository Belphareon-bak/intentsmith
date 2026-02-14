// ═══════════════════════════════════════════════════════════════════════════════
// Quality Pipeline — v62.3 Centralized Post-Processing
// ═══════════════════════════════════════════════════════════════════════════════
//
// Single entry point for all deterministic output post-processing.
// Called from:
//   - synthesis.js (after LLM generation + retry loop)
//   - controller.js (final gate before returning to user)
//
// The pipeline is IDEMPOTENT — safe to call multiple times on the same text.
// All operations are deterministic — no LLM calls, no randomness.
//
// ═══════════════════════════════════════════════════════════════════════════════

import { logger } from '../../core/logger.js';
import { runQualityGateV2 } from './quality-gate-v2.js';

/**
 * Run the centralized quality pipeline on LLM output.
 *
 * @param {string} text — Raw LLM output
 * @param {Object} context
 * @param {string} [context.lang='cs'] — Target language
 * @param {string} [context.intent] — CRE intent (SEARCH, REPORT, FACTUAL, etc.)
 * @param {string} [context.searchSubType] — SEARCH sub-type
 * @param {Array} [context.sourceUrls] — Pre-extracted source URLs [{ title, url }]
 * @param {string} [context.sessionId] — Session ID for logging
 * @returns {{ text: string, gateResult: Object }}
 */
export function runQualityPipeline(text, context = {}) {
  // Handle null/empty gracefully
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    const fallback = context.lang === 'en'
      ? 'Sorry, I was unable to generate a response. Please try again.'
      : 'Omlouvám se, nepodařilo se vygenerovat odpověď. Zkuste to prosím znovu.';
    return {
      text: fallback,
      gateResult: {
        fixesApplied: [],
        issuesDetected: [{ layer: 'content', type: 'empty_input' }],
        qualityFlags: {},
        severity: 'HIGH',
      },
    };
  }

  // Run QGv2 deterministic pipeline
  const gateResult = runQualityGateV2(text, context);

  // Log only when fixes were applied or issues detected
  if (gateResult.fixesApplied.length > 0 || gateResult.issuesDetected.length > 0) {
    logger.info('QualityPipeline', 'QGv2 processed', {
      fixes: gateResult.fixesApplied,
      issueCount: gateResult.issuesDetected.length,
      severity: gateResult.severity,
      sessionId: context.sessionId,
    });
  }

  return {
    text: gateResult.text,
    gateResult,
  };
}

export default { runQualityPipeline };
