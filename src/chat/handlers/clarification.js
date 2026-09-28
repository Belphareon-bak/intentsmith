// handlers/clarification.js — Clarification resolution & goal alignment
// ══════════════════════════════════════════════════════════════════════════════
// v44.2+ - Handles pending clarifications, intent resolution, goal drift
// v64.0  - All decisions routed through CRE Gatekeeper overrideDecision()
// ══════════════════════════════════════════════════════════════════════════════

import { DecisionType, IntentType } from '../cre-decision.js';
import { creDecisionEngine } from '../cre-decision.js';
import { logger } from '../../core/logger.js';
import { CLARIFICATION_KEYWORDS, isClarification } from './utils/intent.js';

/**
 * Try to resolve a pending clarification from user input.
 *
 * v44.6 - Strong intent detection, max 1× clarification
 * v44.7 - LOCAL support
 *
 * @param {string} input - User's clarification input
 * @param {Object} sessionState - Session state
 * @param {Object} context - Handler context
 * @returns {Object|null} Resolved decision or null
 */
export function tryResolveClarification(input, sessionState, context) {
  const pendingDecision = sessionState.pendingDecision;
  const awaitingSlots = sessionState.awaitingSlots;
  const lastUserInput = sessionState.lastUserInput;

  if (!pendingDecision) {
    return null;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // v44.6 FIX 1: NEW STRONG INTENT = HARD RESET
  // ════════════════════════════════════════════════════════════════════════════
  const newIntent = creDecisionEngine.classifyIntent(input);

  const STRONG_INTENTS = [
    IntentType.LOCAL,
    IntentType.CONVERSATIONAL,
    IntentType.CODE,
    IntentType.REPORT,
    IntentType.CREATIVE,
  ];

  if (STRONG_INTENTS.includes(newIntent)) {
    logger.info('TryResolveClarification', 'New strong intent detected, clearing pendingDecision', {
      newIntent,
      input: input.substring(0, 50),
      previousPending: pendingDecision?.intent,
    });
    sessionState.clearPendingDecision();
    return null;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // v44.6 FIX 2: ASK_USER MAX 1× LIMIT
  // ════════════════════════════════════════════════════════════════════════════
  if (pendingDecision.attempts >= 1) {
    logger.warn('TryResolveClarification', 'Max clarification attempts reached, clearing pendingDecision', {
      attempts: pendingDecision.attempts,
      input: input.substring(0, 50),
    });
    sessionState.clearPendingDecision();

    return creDecisionEngine.overrideDecision({
      type: DecisionType.ANSWER,
      intent: IntentType.CONVERSATIONAL,
      source: 'clarification_max_attempts',
      reason: 'Max clarification attempts reached - processing as conversational',
      confidence: 0.5,
      metadata: { maxAttemptsReached: true, originalInput: input },
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // v44.6 FIX 5: CLARIFICATION CONTENT RESPECTING
  // ════════════════════════════════════════════════════════════════════════════
  if (/datum|číslo|jen datum|bez odkazů|no links|just.*date/i.test(input)) {
    logger.info('TryResolveClarification', 'User requested local/direct response', {
      input: input.substring(0, 50),
    });
    sessionState.clearPendingDecision();
    return creDecisionEngine.overrideDecision({
      type: DecisionType.LOCAL,
      intent: IntentType.LOCAL,
      source: 'clarification_local_request',
      reason: 'User explicitly requested local/direct response (datum/bez odkazů)',
      confidence: 0.9,
      metadata: { handler: 'local.date', localComputation: true },
    });
  }

  const normalizedInput = input.toLowerCase().trim();

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 1: Intent clarification (user replied with intent keyword)
  // ════════════════════════════════════════════════════════════════════════════

  if (awaitingSlots.includes('intent_clarification')) {
    const resolvedIntent = CLARIFICATION_KEYWORDS[normalizedInput];

    if (resolvedIntent) {
      return buildResolvedDecision(resolvedIntent, lastUserInput, context);
    }

    for (const [keyword, intent] of Object.entries(CLARIFICATION_KEYWORDS)) {
      if (normalizedInput.includes(keyword)) {
        return buildResolvedDecision(intent, lastUserInput, context);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 2: Source/URL clarification
  // ════════════════════════════════════════════════════════════════════════════

  if (awaitingSlots.includes('source')) {
    const urlMatch = input.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) {
      return creDecisionEngine.overrideDecision({
        type: DecisionType.TOOL_CALL,
        intent: pendingDecision.intent || IntentType.SEARCH,
        tools: ['web.scrape'],
        source: 'clarification_source_url',
        reason: 'User provided URL for source clarification',
        confidence: 0.9,
        metadata: { params: { url: urlMatch[0] } },
      });
    }

    if (normalizedInput.length > 2) {
      return creDecisionEngine.overrideDecision({
        type: DecisionType.TOOL_CALL,
        intent: pendingDecision.intent || IntentType.SEARCH,
        tools: ['web.search'],
        source: 'clarification_source_topic',
        reason: 'User provided search topic for source clarification',
        confidence: 0.85,
        metadata: { params: { query: input } },
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 3: Project context clarification
  // ════════════════════════════════════════════════════════════════════════════

  if (awaitingSlots.includes('project_context') || awaitingSlots.includes('file_path')) {
    const generalPhrases = ['obecná', 'obecne', 'obecný', 'general', 'žádný projekt', 'zadny projekt'];
    if (generalPhrases.some(p => normalizedInput.includes(p))) {
      // v64.0: CONVERSATIONAL (not FACTUAL) — user declined project context,
      // answering directly without tools is CONVERSATIONAL behavior.
      return creDecisionEngine.overrideDecision({
        type: DecisionType.ANSWER,
        intent: IntentType.CONVERSATIONAL,
        source: 'clarification_general_question',
        reason: 'User indicated general question, not project-specific',
        confidence: 0.85,
      });
    }

    const filePathMatch = input.match(/[./\\][\w./\\-]+\.\w+/);
    if (filePathMatch) {
      return creDecisionEngine.overrideDecision({
        type: DecisionType.TOOL_CALL,
        intent: IntentType.CODE,
        tools: ['file.read'],
        source: 'clarification_file_path',
        reason: 'User provided file path',
        confidence: 0.85,
        metadata: { params: { path: filePathMatch[0] } },
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 4: Tool failure - alternative action
  // ════════════════════════════════════════════════════════════════════════════

  if (awaitingSlots.includes('alternative_action')) {
    const failedDecision = pendingDecision;

    if (/znovu|retry|opakovat|zkus/i.test(normalizedInput)) {
      return creDecisionEngine.overrideDecision({
        type: DecisionType.TOOL_CALL,
        intent: failedDecision.intent || IntentType.SEARCH,
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
        type: DecisionType.TOOL_CALL,
        intent: failedDecision.intent || IntentType.SEARCH,
        tools: ['web.scrape'],
        source: 'clarification_alt_url',
        reason: 'User provided alternative URL after failure',
        confidence: 0.9,
        originalDecision: failedDecision,
        metadata: { params: { url: urlMatch[0] } },
      });
    }

    if (normalizedInput.length > 3 && !/^(ne|no|cancel|zrušit)$/i.test(normalizedInput)) {
      return creDecisionEngine.overrideDecision({
        type: DecisionType.TOOL_CALL,
        intent: failedDecision.intent || IntentType.SEARCH,
        tools: ['web.search'],
        source: 'clarification_reformulated',
        reason: 'User provided reformulated query after failure',
        confidence: 0.85,
        originalDecision: failedDecision,
        metadata: { params: { query: input } },
      });
    }

    if (/^(ne|no|cancel|zrušit|stop)$/i.test(normalizedInput)) {
      return creDecisionEngine.overrideDecision({
        type: DecisionType.ANSWER,
        intent: IntentType.CONVERSATIONAL,
        source: 'clarification_cancelled',
        reason: 'User cancelled after failure',
        confidence: 0.9,
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 5: Goal drift confirmation
  // ════════════════════════════════════════════════════════════════════════════

  if (awaitingSlots.includes('goal_drift_confirmation')) {
    const driftDecision = pendingDecision;

    if (/^(ano|yes|ok|pokračuj|jasně|fajn|jo)/i.test(normalizedInput)) {
      if (sessionState?.resetDriftCount) {
        sessionState.resetDriftCount();
      }
      return creDecisionEngine.overrideDecision({
        type: DecisionType.TOOL_CALL,
        intent: driftDecision.intent,
        tools: driftDecision.tools,
        source: 'clarification_drift_confirmed',
        reason: 'User confirmed goal drift - proceeding',
        confidence: 0.9,
        originalDecision: driftDecision,
        metadata: { goalDriftConfirmed: true, params: { query: driftDecision.originalInput || lastUserInput } },
      });
    }

    if (/^(ne|no|cancel|zrušit|stop|zpět)/i.test(normalizedInput)) {
      if (sessionState?.resetDriftCount) {
        sessionState.resetDriftCount();
      }
      return creDecisionEngine.overrideDecision({
        type: DecisionType.ANSWER,
        intent: IntentType.CONVERSATIONAL,
        source: 'clarification_drift_declined',
        reason: 'User declined goal drift - returning to project goal',
        confidence: 0.9,
        metadata: { returnToGoal: true },
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 6: pendingDecision exists + input looks like clarification
  // ════════════════════════════════════════════════════════════════════════════

  if (pendingDecision && isClarification(input)) {
    const pendingIntent = pendingDecision.intent || IntentType.SEARCH;

    logger.info('TryResolveClarification', 'Using pendingDecision (fallback)', {
      pendingIntent,
      input: input.substring(0, 50),
      pendingType: pendingDecision.type,
    });

    if (pendingDecision.type === DecisionType.TOOL_CALL ||
        pendingDecision.type === 'TOOL_CALL_FAILED') {
      return creDecisionEngine.overrideDecision({
        type: DecisionType.TOOL_CALL,
        intent: pendingIntent,
        tools: pendingDecision.tools || ['web.search'],
        source: 'clarification_pending_fallback',
        reason: 'Resolved from pendingDecision with clarification input',
        confidence: 0.8,
        originalDecision: pendingDecision,
        metadata: { params: { query: pendingDecision.originalInput || lastUserInput, clarification: input } },
      });
    }

    return buildResolvedDecision(pendingIntent, lastUserInput || input, context);
  }

  return null;
}

/**
 * Build a resolved decision based on clarified intent
 *
 * v44.2 - CRITICAL: Must return TOOL_CALL for SEARCH/REPORT/FACTUAL
 * "report" = TOOL_CALL, NEVER ASK_USER
 */
export function buildResolvedDecision(intent, originalInput, context) {
  const toolMapping = {
    [IntentType.SEARCH]: ['web.search'],
    [IntentType.REPORT]: ['web.search', 'web.scrape'],
    [IntentType.FACTUAL]: ['web.search'],
    [IntentType.CODE]: context?.hasActiveProject ? ['file.read', 'file.write'] : [],
    [IntentType.CONVERSATIONAL]: [],
  };

  const tools = toolMapping[intent] || ['web.search'];

  if (intent === IntentType.CONVERSATIONAL) {
    return creDecisionEngine.overrideDecision({
      type: DecisionType.ANSWER,
      intent,
      source: 'clarification_resolved',
      reason: 'Resolved to CONVERSATIONAL - direct answer allowed',
      confidence: 0.9,
    });
  }

  if (intent === IntentType.CODE && tools.length === 0) {
    return creDecisionEngine.overrideDecision({
      type: DecisionType.ASK_USER,
      intent,
      slots: ['project_context'],
      source: 'clarification_resolved',
      reason: 'CODE intent requires project context',
      confidence: 0.7,
    });
  }

  return creDecisionEngine.overrideDecision({
    type: DecisionType.TOOL_CALL,
    intent,
    tools,
    source: 'clarification_resolved',
    reason: `Clarification resolved: ${intent} → TOOL_CALL`,
    confidence: 0.9,
    metadata: { params: { query: originalInput } },
  });
}

/**
 * Assess if an operation is aligned with the project goal
 *
 * @param {string} input - User input
 * @param {string} goal - Project goal
 * @param {string} intent - Detected intent
 * @returns {{ aligned: boolean, reason: string }}
 */
export function assessGoalAlignment(input, goal, intent) {
  if (!goal || !input) {
    return { aligned: true, reason: 'No goal to check against' };
  }

  const inputLower = input.toLowerCase();
  const goalLower = goal.toLowerCase();

  const goalKeywords = goalLower
    .split(/[\s,.\-:;]+/)
    .filter(w => w.length > 3)
    .slice(0, 10);

  const matchingKeywords = goalKeywords.filter(kw => inputLower.includes(kw));

  if (matchingKeywords.length > 0) {
    return { aligned: true, reason: `Matches goal keywords: ${matchingKeywords.join(', ')}` };
  }

  if (intent === IntentType.CODE) {
    return { aligned: true, reason: 'CODE intent in project context' };
  }

  if (intent === IntentType.SEARCH || intent === IntentType.REPORT) {
    return {
      aligned: false,
      reason: `Search/Report may not be directly related to goal: "${goal.substring(0, 50)}"`,
    };
  }

  return { aligned: true, reason: 'Default alignment' };
}
