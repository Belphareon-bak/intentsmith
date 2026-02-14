// CRE v55.1 — Follow-up Detection & Clarification
// ══════════════════════════════════════════════════════════════════════════════
// Extracted from handlers.js for better modularity
//
// Contains:
// - Follow-up type detection (FORMAT_CHANGE, REFINEMENT, etc.)
// - Clarification resolution
//
// v64.0: All decisions routed through CRE Gatekeeper overrideDecision()
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../../../core/logger.js';
import { CLARIFICATION_KEYWORDS } from './intent.js';
import { creDecisionEngine } from '../../cre-decision.js';

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOW-UP TYPE
// ─────────────────────────────────────────────────────────────────────────────

export const FollowUpType = {
  FORMAT_CHANGE: 'FORMAT_CHANGE',  // Same data, different presentation
  REFINEMENT: 'REFINEMENT',        // Same topic, narrower focus
  NEW_QUERY: 'NEW_QUERY',          // Completely different topic
  CONTINUATION: 'CONTINUATION',    // Continue discussing same topic
};

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOW-UP DETECTION PATTERNS
// ─────────────────────────────────────────────────────────────────────────────

const FORMAT_CHANGE_PATTERNS = [
  // Shorter/longer/summary (CZ + EN)
  /(kratší|zkrať|stručněji|brief|shorter|delší|podrobněji|more detail)/i,
  /(shrnout|shrň|sumarizuj|summarize|shrnutí|summary)/i,
  // Structure changes
  /(v tabulce|as table|jako seznam|as list|v bodech|bullet|odrážk)/i,
  /(ve formě|in form of|formát|format)/i,
  // Style changes
  /(jednodušeji|simpler|formálněji|more formal|neformálně|informal)/i,
  // Explicit reformat requests
  /(přepiš|rewrite|změň formát|change format|přeformátuj|reformat)/i,
  // "teď to..." or "můžeš to..." followed by style word
  /(teď to|můžeš to|dej mi to|give me|can you).*(jinak|kratší|delší|stručněji|podrobněji|v bodech)/i,
];

const REFINEMENT_PATTERNS = [
  // Filter additions
  /^(jen|pouze|only|just|bez|without|s |with )/i,
  // Constraints
  /^(do \d|pod \d|nad \d|max |min |levnější|cheaper|dražší)/i,
  // Selections
  /^(první|první tři|top \d|ten první|the first)/i,
  // Specific aspect
  /^(konkrétně|specifically|hlavně|mainly|especially)/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// FOLLOW-UP DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect the type of follow-up based on current input and session context
 *
 * v45.0 FIX 1.4 - Distinguish between FORMAT_CHANGE, REFINEMENT, etc.
 *
 * @param {string} input - Current user input
 * @param {Object} sessionState - Session state with history
 * @param {Object} options - Additional options
 * @param {string} options.IntentType - IntentType enum for comparison
 * @returns {{ type: string, confidence: number, reusePreviousData: boolean }}
 */
export function detectFollowUpType(input, sessionState, options = {}) {
  const { IntentType } = options;
  const lastDecision = sessionState?.lastDecision;
  const lastInput = sessionState?.lastUserInput;

  // No history = definitely new query
  if (!lastDecision || !lastInput) {
    return { type: FollowUpType.NEW_QUERY, confidence: 1.0, reusePreviousData: false };
  }

  const inputLower = input.toLowerCase().trim();

  // Pattern 1: FORMAT_CHANGE - user wants different presentation
  if (FORMAT_CHANGE_PATTERNS.some(p => p.test(inputLower))) {
    return {
      type: FollowUpType.FORMAT_CHANGE,
      confidence: 0.9,
      reusePreviousData: true,
    };
  }

  // Pattern 2: REFINEMENT - narrowing down previous query
  if (REFINEMENT_PATTERNS.some(p => p.test(inputLower))) {
    return {
      type: FollowUpType.REFINEMENT,
      confidence: 0.85,
      reusePreviousData: false,
    };
  }

  // Pattern 3: CONTINUATION - discussing same topic
  const isContinuation =
    inputLower.length < 30 &&
    (inputLower.includes('to') ||
     inputLower.includes('tenhle') ||
     inputLower.includes('tohle') ||
     inputLower.includes('ten') ||
     inputLower.includes('it') ||
     inputLower.includes('this'));

  if (isContinuation && IntentType && lastDecision.intent !== IntentType.CONVERSATIONAL) {
    return {
      type: FollowUpType.CONTINUATION,
      confidence: 0.7,
      reusePreviousData: true,
    };
  }

  // Pattern 4: NEW_QUERY - detect topic change via keyword overlap
  const lastWords = new Set(
    lastInput.toLowerCase().split(/\s+/).filter(w => w.length > 3)
  );
  const currentWords = inputLower.split(/\s+/).filter(w => w.length > 3);
  const sharedWords = currentWords.filter(w => lastWords.has(w));

  if (sharedWords.length === 0 && currentWords.length >= 2) {
    return {
      type: FollowUpType.NEW_QUERY,
      confidence: 0.8,
      reusePreviousData: false,
    };
  }

  // Default: continuation if keyword overlap
  if (sharedWords.length > 0) {
    return {
      type: FollowUpType.CONTINUATION,
      confidence: 0.6,
      reusePreviousData: false,
    };
  }

  // Fallback: new query
  return {
    type: FollowUpType.NEW_QUERY,
    confidence: 0.5,
    reusePreviousData: false,
  };
}

/**
 * Get previous tool data from session state if available
 * Used for FORMAT_CHANGE follow-ups to avoid re-fetching
 */
export function getPreviousToolData(sessionState) {
  if (!sessionState?.lastToolResults) {
    return null;
  }

  // Check if data is still fresh (within 5 minutes)
  const dataAge = Date.now() - (sessionState.lastToolResultsTimestamp || 0);
  const maxAge = 5 * 60 * 1000;

  if (dataAge > maxAge) {
    logger.debug('FollowUp', 'Previous tool data expired', { dataAge, maxAge });
    return null;
  }

  return sessionState.lastToolResults;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLARIFICATION RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strong intents that should NEVER be treated as clarification
 */
const STRONG_INTENTS = [
  'LOCAL',
  'CONVERSATIONAL',
  'CODE',
  'REPORT',
  'CREATIVE',
];

/**
 * Try to resolve pending clarification from user input
 *
 * @param {string} input - User's clarification response
 * @param {Object} sessionState - Session state with pending decision
 * @param {Object} context - Request context
 * @param {Object} options - Additional dependencies
 * @param {Object} options.creDecisionEngine - CRE decision engine
 * @param {Object} options.DecisionType - DecisionType enum
 * @param {Object} options.IntentType - IntentType enum
 * @returns {Object|null} - Resolved decision or null if not resolved
 */
export function tryResolveClarification(input, sessionState, context, options = {}) {
  const { creDecisionEngine, DecisionType, IntentType } = options;
  
  const pendingDecision = sessionState.pendingDecision;
  const awaitingSlots = sessionState.awaitingSlots;
  const lastUserInput = sessionState.lastUserInput;

  if (!pendingDecision) {
    return null;
  }

  // FIX 1: NEW STRONG INTENT = HARD RESET
  if (creDecisionEngine) {
    const newIntent = creDecisionEngine.classifyIntent(input);

    if (STRONG_INTENTS.includes(newIntent)) {
      logger.info('Clarification', 'New strong intent detected, clearing pending', {
        newIntent,
        input: input.substring(0, 50),
        previousPending: pendingDecision?.intent,
      });
      sessionState.clearPendingDecision();
      return null;
    }
  }

  // FIX 2: ASK_USER MAX 1× LIMIT
  if (pendingDecision.attempts >= 1) {
    logger.warn('Clarification', 'Max attempts reached, clearing pending', {
      attempts: pendingDecision.attempts,
    });
    sessionState.clearPendingDecision();

    return creDecisionEngine.overrideDecision({
      type: DecisionType?.ANSWER || 'ANSWER',
      intent: IntentType?.CONVERSATIONAL || 'CONVERSATIONAL',
      source: 'clarification_max_attempts',
      reason: 'Max clarification attempts reached - processing as conversational',
      confidence: 0.5,
      metadata: { maxAttemptsReached: true, originalInput: input },
    });
  }

  // FIX 5: CLARIFICATION CONTENT RESPECTING
  if (/datum|číslo|jen datum|bez odkazů|no links|just.*date/i.test(input)) {
    logger.info('Clarification', 'User requested local/direct response');
    sessionState.clearPendingDecision();
    return creDecisionEngine.overrideDecision({
      type: DecisionType?.LOCAL || 'LOCAL',
      intent: IntentType?.LOCAL || 'LOCAL',
      source: 'clarification_local_request',
      reason: 'User explicitly requested local/direct response',
      confidence: 0.9,
      metadata: { handler: 'local.date', localComputation: true },
    });
  }

  const normalizedInput = input.toLowerCase().trim();

  // CASE 1: Intent clarification
  if (awaitingSlots?.includes('intent_clarification')) {
    const resolvedIntent = CLARIFICATION_KEYWORDS[normalizedInput];
    if (resolvedIntent) {
      return buildResolvedDecision(resolvedIntent, lastUserInput, context, options);
    }

    for (const [keyword, intent] of Object.entries(CLARIFICATION_KEYWORDS)) {
      if (normalizedInput.includes(keyword)) {
        return buildResolvedDecision(intent, lastUserInput, context, options);
      }
    }
  }

  // CASE 2: Source/URL clarification
  if (awaitingSlots?.includes('source')) {
    const urlMatch = input.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) {
      return creDecisionEngine.overrideDecision({
        type: DecisionType?.TOOL_CALL || 'TOOL_CALL',
        intent: pendingDecision.intent || IntentType?.SEARCH || 'SEARCH',
        tools: ['web.scrape'],
        source: 'clarification_source_url',
        reason: 'User provided URL for source clarification',
        confidence: 0.9,
        metadata: { params: { url: urlMatch[0] } },
      });
    }

    if (normalizedInput.length > 2) {
      return creDecisionEngine.overrideDecision({
        type: DecisionType?.TOOL_CALL || 'TOOL_CALL',
        intent: pendingDecision.intent || IntentType?.SEARCH || 'SEARCH',
        tools: ['web.search'],
        source: 'clarification_source_topic',
        reason: 'User provided search topic',
        confidence: 0.85,
        metadata: { params: { query: input } },
      });
    }
  }

  // CASE 3: Project context clarification
  if (awaitingSlots?.includes('project_context') || awaitingSlots?.includes('file_path')) {
    const generalPhrases = ['obecná', 'obecne', 'obecný', 'general', 'žádný projekt'];
    if (generalPhrases.some(p => normalizedInput.includes(p))) {
      // v64.0: CONVERSATIONAL (not FACTUAL) — user declined project context,
      // answering directly without tools is CONVERSATIONAL behavior.
      return creDecisionEngine.overrideDecision({
        type: DecisionType?.ANSWER || 'ANSWER',
        intent: IntentType?.CONVERSATIONAL || 'CONVERSATIONAL',
        source: 'clarification_general_question',
        reason: 'User indicated general question (no project context)',
        confidence: 0.85,
      });
    }

    const filePathMatch = input.match(/[./\\][\w./\\-]+\.\w+/);
    if (filePathMatch) {
      return creDecisionEngine.overrideDecision({
        type: DecisionType?.TOOL_CALL || 'TOOL_CALL',
        intent: IntentType?.CODE || 'CODE',
        tools: ['file.read'],
        source: 'clarification_file_path',
        reason: 'User provided file path',
        confidence: 0.85,
        metadata: { params: { path: filePathMatch[0] } },
      });
    }
  }

  // CASE 4: Alternative action after failure
  if (awaitingSlots?.includes('alternative_action')) {
    const failedDecision = pendingDecision;

    if (/znovu|retry|opakovat|zkus/i.test(normalizedInput)) {
      return creDecisionEngine.overrideDecision({
        type: DecisionType?.TOOL_CALL || 'TOOL_CALL',
        intent: failedDecision.intent || IntentType?.SEARCH || 'SEARCH',
        tools: failedDecision.failedTools || ['web.search'],
        source: 'clarification_retry',
        reason: 'User requested retry after failure',
        confidence: 0.8,
        originalDecision: failedDecision,
        metadata: { params: { query: failedDecision.originalInput || lastUserInput } },
      });
    }

    const urlMatch = input.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) {
      return creDecisionEngine.overrideDecision({
        type: DecisionType?.TOOL_CALL || 'TOOL_CALL',
        intent: failedDecision.intent || IntentType?.SEARCH || 'SEARCH',
        tools: ['web.scrape'],
        source: 'clarification_alt_url',
        reason: 'User provided alternative URL',
        confidence: 0.85,
        originalDecision: failedDecision,
        metadata: { params: { url: urlMatch[0] } },
      });
    }
  }

  // Not resolved
  return null;
}

/**
 * Build a resolved decision based on intent.
 * v64.0: Routes through CRE Gatekeeper overrideDecision() for audit trail.
 */
function buildResolvedDecision(intent, originalInput, context, options = {}) {
  const { DecisionType, IntentType } = options;

  const intentStr = intent || 'CONVERSATIONAL';

  switch (intentStr) {
    case IntentType?.SEARCH:
    case 'SEARCH':
      return creDecisionEngine.overrideDecision({
        type: DecisionType?.TOOL_CALL || 'TOOL_CALL',
        intent: intentStr,
        tools: ['web.search'],
        source: 'clarification_resolved',
        reason: `Clarified intent: ${intentStr}`,
        metadata: { params: { query: originalInput } },
      });

    case IntentType?.REPORT:
    case 'REPORT':
      return creDecisionEngine.overrideDecision({
        type: DecisionType?.TOOL_CALL || 'TOOL_CALL',
        intent: intentStr,
        tools: ['web.search', 'web.scrape'],
        source: 'clarification_resolved',
        reason: `Clarified intent: ${intentStr}`,
        metadata: { params: { query: originalInput } },
      });

    case IntentType?.CODE:
    case 'CODE':
      return creDecisionEngine.overrideDecision({
        type: DecisionType?.ANSWER || 'ANSWER',
        intent: intentStr,
        source: 'clarification_resolved',
        reason: `Clarified intent: ${intentStr}`,
      });

    case IntentType?.CONVERSATIONAL:
    case 'CONVERSATIONAL':
      return creDecisionEngine.overrideDecision({
        type: DecisionType?.ANSWER || 'ANSWER',
        intent: intentStr,
        source: 'clarification_resolved',
        reason: `Clarified intent: ${intentStr}`,
      });

    default:
      return creDecisionEngine.overrideDecision({
        type: DecisionType?.ANSWER || 'ANSWER',
        intent: intentStr,
        source: 'clarification_resolved',
        reason: `Clarified intent: ${intentStr} (default)`,
      });
  }
}

export default {
  FollowUpType,
  detectFollowUpType,
  getPreviousToolData,
  tryResolveClarification,
};
