// handlers/clarification.js — Clarification resolution & goal alignment
// ══════════════════════════════════════════════════════════════════════════════
// v44.2+ - Handles pending clarifications, intent resolution, goal drift
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

    return {
      type: DecisionType.ANSWER,
      intent: IntentType.CONVERSATIONAL,
      tools: [],
      confidence: 0.5,
      reason: 'Max clarification attempts reached - processing as conversational',
      metadata: {
        maxAttemptsReached: true,
        originalInput: input,
      },
      toJSON() { return this; },
    };
  }

  // ════════════════════════════════════════════════════════════════════════════
  // v44.6 FIX 5: CLARIFICATION CONTENT RESPECTING
  // ════════════════════════════════════════════════════════════════════════════
  if (/datum|číslo|jen datum|bez odkazů|no links|just.*date/i.test(input)) {
    logger.info('TryResolveClarification', 'User requested local/direct response', {
      input: input.substring(0, 50),
    });
    sessionState.clearPendingDecision();
    return {
      type: DecisionType.LOCAL,
      intent: IntentType.LOCAL,
      tools: [],
      confidence: 0.9,
      reason: 'User explicitly requested local/direct response (datum/bez odkazů)',
      metadata: {
        handler: 'local.date',
        localComputation: true,
      },
      toJSON() { return this; },
    };
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
      return {
        type: DecisionType.TOOL_CALL,
        intent: pendingDecision.intent || IntentType.SEARCH,
        tools: ['web.scrape'],
        params: { url: urlMatch[0] },
        confidence: 0.9,
        reason: 'User provided URL for source clarification',
        toJSON() { return this; },
      };
    }

    if (normalizedInput.length > 2) {
      return {
        type: DecisionType.TOOL_CALL,
        intent: pendingDecision.intent || IntentType.SEARCH,
        tools: ['web.search'],
        params: { query: input },
        confidence: 0.85,
        reason: 'User provided search topic for source clarification',
        toJSON() { return this; },
      };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 3: Project context clarification
  // ════════════════════════════════════════════════════════════════════════════

  if (awaitingSlots.includes('project_context') || awaitingSlots.includes('file_path')) {
    const generalPhrases = ['obecná', 'obecne', 'obecný', 'general', 'žádný projekt', 'zadny projekt'];
    if (generalPhrases.some(p => normalizedInput.includes(p))) {
      return {
        type: DecisionType.ANSWER,
        intent: IntentType.FACTUAL,
        confidence: 0.85,
        reason: 'User indicated general question, not project-specific',
        toJSON() { return this; },
      };
    }

    const filePathMatch = input.match(/[./\\][\w./\\-]+\.\w+/);
    if (filePathMatch) {
      return {
        type: DecisionType.TOOL_CALL,
        intent: IntentType.CODE,
        tools: ['file.read'],
        params: { path: filePathMatch[0] },
        confidence: 0.85,
        reason: 'User provided file path',
        toJSON() { return this; },
      };
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 4: Tool failure - alternative action
  // ════════════════════════════════════════════════════════════════════════════

  if (awaitingSlots.includes('alternative_action')) {
    const failedDecision = pendingDecision;

    if (/znovu|retry|opakovat|zkus/i.test(normalizedInput)) {
      return {
        type: DecisionType.TOOL_CALL,
        intent: failedDecision.intent || IntentType.SEARCH,
        tools: failedDecision.failedTools || ['web.search'],
        params: { query: failedDecision.originalInput || lastUserInput },
        confidence: 0.8,
        reason: 'User requested retry after failure',
        toJSON() { return this; },
      };
    }

    const urlMatch = input.match(/https?:\/\/[^\s]+/i);
    if (urlMatch) {
      return {
        type: DecisionType.TOOL_CALL,
        intent: failedDecision.intent || IntentType.SEARCH,
        tools: ['web.scrape'],
        params: { url: urlMatch[0] },
        confidence: 0.9,
        reason: 'User provided alternative URL after failure',
        toJSON() { return this; },
      };
    }

    if (normalizedInput.length > 3 && !/^(ne|no|cancel|zrušit)$/i.test(normalizedInput)) {
      return {
        type: DecisionType.TOOL_CALL,
        intent: failedDecision.intent || IntentType.SEARCH,
        tools: ['web.search'],
        params: { query: input },
        confidence: 0.85,
        reason: 'User provided reformulated query after failure',
        toJSON() { return this; },
      };
    }

    if (/^(ne|no|cancel|zrušit|stop)$/i.test(normalizedInput)) {
      return {
        type: DecisionType.ANSWER,
        intent: IntentType.CONVERSATIONAL,
        confidence: 0.9,
        reason: 'User cancelled after failure',
        toJSON() { return this; },
      };
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
      return {
        type: DecisionType.TOOL_CALL,
        intent: driftDecision.intent,
        tools: driftDecision.tools,
        params: { query: driftDecision.originalInput || lastUserInput },
        confidence: 0.9,
        reason: 'User confirmed goal drift - proceeding',
        metadata: { goalDriftConfirmed: true },
        toJSON() { return this; },
      };
    }

    if (/^(ne|no|cancel|zrušit|stop|zpět)/i.test(normalizedInput)) {
      if (sessionState?.resetDriftCount) {
        sessionState.resetDriftCount();
      }
      return {
        type: DecisionType.ANSWER,
        intent: IntentType.CONVERSATIONAL,
        confidence: 0.9,
        reason: 'User declined goal drift - returning to project goal',
        metadata: { returnToGoal: true },
        toJSON() { return this; },
      };
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
      return {
        type: DecisionType.TOOL_CALL,
        intent: pendingIntent,
        tools: pendingDecision.tools || ['web.search'],
        params: {
          query: pendingDecision.originalInput || lastUserInput,
          clarification: input,
        },
        confidence: 0.8,
        reason: 'Resolved from pendingDecision with clarification input',
        toJSON() { return this; },
      };
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
    [IntentType.CODE]: context.hasActiveProject ? ['file.read', 'file.write'] : [],
    [IntentType.CONVERSATIONAL]: [],
  };

  const tools = toolMapping[intent] || ['web.search'];

  if (intent === IntentType.CONVERSATIONAL) {
    return {
      type: DecisionType.ANSWER,
      intent,
      confidence: 0.9,
      reason: 'Resolved to CONVERSATIONAL - direct answer allowed',
      toJSON() { return this; },
    };
  }

  if (intent === IntentType.CODE && tools.length === 0) {
    return {
      type: DecisionType.ASK_USER,
      intent,
      slots: ['project_context'],
      confidence: 0.7,
      reason: 'CODE intent requires project context',
      toJSON() { return this; },
    };
  }

  return {
    type: DecisionType.TOOL_CALL,
    intent,
    tools,
    params: { query: originalInput },
    confidence: 0.9,
    reason: `Clarification resolved: ${intent} → TOOL_CALL`,
    toJSON() { return this; },
  };
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
