// Conversation Handler — extracted from handlers.js
// Main handler for CONVERSATION mode using CRE Decision Engine

import {
  creDecisionEngine,
  DecisionType,
  IntentType,
  assertDecision,
} from '../cre-decision.js';
import { logger } from '../../core/logger.js';
import { isVagueInput } from './utils/intent.js';
import { tryResolveClarification, buildResolvedDecision, assessGoalAlignment } from './clarification.js';
import { handleLocalDecision } from './local.js';
import {
  handleToolCallDecision,
  handleAskUserDecision,
  handleAnswerDecision,
  handleRefuseDecision,
} from './decisions.js';
import {
  handleBuildDetected,
  handleBuildConfirmed,
  handleClarificationAnswer,
  handlePlanVerdict,
  getActiveBuildHandoff,
  cancelBuildHandoff,
} from './build-handoff.js';

export async function conversationHandler(input, context) {
  const { sessionId, sessionState } = context;

  // ════════════════════════════════════════════════════════════════════════════
  // BUILD HANDOFF INTERCEPT — route messages during active Planner flow
  // ════════════════════════════════════════════════════════════════════════════
  const activeHandoff = getActiveBuildHandoff(sessionId);
  if (activeHandoff) {
    // Cancel command
    if (/^(zrušit?|cancel|stop|zpět|back)\s*[!.]?$/i.test(input.trim())) {
      cancelBuildHandoff(sessionId);
      return {
        content: 'Build zrušen. Jsem zpět v chat módu.',
        tag: 'RESPONSE',
        speaker: 'SYSTEM',
        mode: context.mode || 'conversation',
        confidence: 1.0,
      };
    }

    // Route based on handoff phase
    switch (activeHandoff.phase) {
      case 'PROPOSED': {
        // Waiting for user to confirm "jít stavět?"
        const isYes = /^(ano|jo|ok|yes|jdi|jasně?|sure|build|stavět|start)\s*[!.]?$/i.test(input.trim());
        const isNo = /^(ne|no|nechci|cancel|zrušit?)\s*[!.]?$/i.test(input.trim());
        if (isYes) return await handleBuildConfirmed(input, context);
        if (isNo) {
          cancelBuildHandoff(sessionId);
          return { content: 'OK, zůstáváme v chatu.', tag: 'RESPONSE', speaker: 'SYSTEM', mode: context.mode, confidence: 1.0 };
        }
        // Ambiguous — remind user
        return { content: 'Chceš spustit Planner pipeline? (ano/ne)', tag: 'RESPONSE', speaker: 'SYSTEM', mode: context.mode, confidence: 0.9 };
      }
      case 'CLARIFYING':
        return await handleClarificationAnswer(input, context);
      case 'PLAN_REVIEW':
        return await handlePlanVerdict(input, context);
      case 'EXECUTING':
        return { content: 'Pipeline právě běží, počkej na výsledek...', tag: 'RESPONSE', speaker: 'SYSTEM', mode: context.mode, confidence: 0.9 };
      default:
        // Unknown phase — clear and continue normally
        cancelBuildHandoff(sessionId);
        break;
    }
  }
  // ════════════════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════════════════
  // v44.2 - CHECK FOR PENDING CLARIFICATION
  // ════════════════════════════════════════════════════════════════════════════

  // v44.8: Track if we started as a clarification follow-up (for first-turn check)
  const wasClarificationFollowUp = sessionState?.awaitingClarification;

  if (sessionState?.awaitingClarification) {
    const resolvedDecision = tryResolveClarification(input, sessionState, context);

    if (resolvedDecision) {
      logger.info('ConversationHandler', 'Clarification resolved', {
        originalIntent: sessionState.getPendingIntent(),
        resolvedIntent: resolvedDecision.intent,
        resolvedType: resolvedDecision.type,
      });

      // Clear pending state and process resolved decision
      sessionState.clearPendingDecision();

      // Handle the resolved decision
      // v44.7: LOCAL must be handled FIRST (terminal decision)
      if (resolvedDecision.type === DecisionType.LOCAL) {
        return await handleLocalDecision(input, resolvedDecision, context);
      } else if (resolvedDecision.type === DecisionType.TOOL_CALL) {
        // v44.4 - Pass goalDriftConfirmed if set in metadata
        const enrichedContext = resolvedDecision.metadata?.goalDriftConfirmed
          ? { ...context, goalDriftConfirmed: true }
          : context;
        return await handleToolCallDecision(input, resolvedDecision, enrichedContext);
      } else if (resolvedDecision.type === DecisionType.ANSWER) {
        return await handleAnswerDecision(input, resolvedDecision, context);
      }
      // For other types, fall through to normal processing
    }

    // If clarification not resolved, continue with normal flow
    // but include context that we were waiting
    logger.info('ConversationHandler', 'Clarification not resolved, processing as new input', {
      pendingIntent: sessionState.getPendingIntent(),
    });
  }

  // STEP 1: Get CRE Decision
  // v44.8: Pass lastIntent from sessionState for sticky intent logic
  const decisionContext = {
    ...context,
    lastIntent: sessionState?.lastIntent,
    lastDecision: sessionState?.lastDecision,
  };
  let decision = creDecisionEngine.decide(input, decisionContext);

  // STEP 1.5: Fail-fast assertion - catch bugs early
  assertDecision(decision);

  // ════════════════════════════════════════════════════════════════════════════
  // v44.8 FIX: NO ASK_USER ON FIRST TURN
  // v44.9 FIX B: NO SEARCH/TOOL_CALL FOR VAGUE INPUTS ON FIRST TURN
  // ════════════════════════════════════════════════════════════════════════════
  // First message in conversation should NEVER be ASK_USER.
  // First message with vague input should NEVER be SEARCH.
  // Instead: give optimistic conversational answer.
  // ════════════════════════════════════════════════════════════════════════════
  // First turn = no previous decision AND no pending decision AND not a clarification follow-up
  // v44.8: Also check wasClarificationFollowUp to handle cases where pendingDecision was just cleared
  const isFirstTurn = !sessionState?.lastDecision &&
                      !sessionState?.lastUserInput &&
                      !sessionState?.pendingDecision &&
                      !wasClarificationFollowUp;

  // v44.9 FIX B: Vague inputs that should NOT trigger SEARCH on first turn
  const VAGUE_INPUT_PATTERNS = [
    /^něco$/i,                    // "něco"
    /^hm+$/i,                     // "hm", "hmm", "hmmm"
    /^idk$/i,                     // "idk"
    /^nevím$/i,                   // "nevím"
    /^test$/i,                    // "test"
    /^[.!?]+$/,                   // just punctuation
    /^.{1,3}$/,                   // 1-3 characters (too short)
  ];
  const isVagueInput = VAGUE_INPUT_PATTERNS.some(p => p.test(input.trim()));

  // v44.9 FIX B: Block SEARCH/TOOL_CALL on first turn for vague inputs
  if (isFirstTurn && isVagueInput && decision.type === DecisionType.TOOL_CALL) {
    logger.info('ConversationHandler', 'First turn SEARCH blocked for vague input - forcing CONVERSATIONAL', {
      originalIntent: decision.intent,
      input: input.substring(0, 50),
    });

    decision = {
      type: DecisionType.ANSWER,
      intent: IntentType.CONVERSATIONAL,
      tools: [],
      confidence: 0.6,
      reason: 'First turn vague input - optimistic conversational response instead of SEARCH',
      slots: [],
      metadata: {
        firstTurnOverride: true,
        vagueInputBlocked: true,
        originalIntent: decision.intent,
        inputPreview: input.substring(0, 100),
      },
      toJSON() { return this; },
    };
  }

  if (isFirstTurn && decision.type === DecisionType.ASK_USER) {
    logger.info('ConversationHandler', 'First turn ASK_USER blocked - forcing CREATIVE/CONVERSATIONAL answer', {
      originalIntent: decision.intent,
      input: input.substring(0, 50),
    });

    // Force CREATIVE if it looks like an ideation request, otherwise CONVERSATIONAL
    const isIdeation = /vymyslet|navrh|nápad|inspirac|kampaň|kampan|příběh|pribeh/i.test(input);

    decision = {
      type: DecisionType.ANSWER,
      intent: isIdeation ? IntentType.CREATIVE : IntentType.CONVERSATIONAL,
      tools: [],
      confidence: 0.7,
      reason: 'First turn - optimistic answer instead of ASK_USER',
      slots: [],
      metadata: {
        firstTurnOverride: true,
        originalIntent: decision.intent,
        inputPreview: input.substring(0, 100),
      },
      toJSON() { return this; },
    };
  }

  logger.info('ConversationHandler', `CRE Decision: ${decision.type}`, {
    intent: decision.intent,
    tools: decision.tools,
    reason: decision.reason,
  });

  // STEP 2: Handle based on decision type
  switch (decision.type) {
    // ════════════════════════════════════════════════════════════════════════
    // BUILD → PLAN: Handoff to Planner pipeline
    // ════════════════════════════════════════════════════════════════════════
    case DecisionType.PLAN:
      return handleBuildDetected(input, decision, context);

    // ════════════════════════════════════════════════════════════════════════
    // v44.7 FIX 1: LOCAL is TERMINAL - direct computation, no tools
    // ════════════════════════════════════════════════════════════════════════
    case DecisionType.LOCAL:
      return await handleLocalDecision(input, decision, context);

    case DecisionType.TOOL_CALL:
      return await handleToolCallDecision(input, decision, context);

    case DecisionType.ASK_USER:
      return handleAskUserDecision(input, decision, context);

    case DecisionType.ANSWER:
      // v44.8: ANSWER is valid for CONVERSATIONAL and CREATIVE intents
      const ANSWER_VALID_INTENTS = [IntentType.CONVERSATIONAL, IntentType.CREATIVE];
      if (!ANSWER_VALID_INTENTS.includes(decision.intent)) {
        logger.warn('ConversationHandler', 'BLOCKED: ANSWER decision for non-valid intent', {
          intent: decision.intent,
          validIntents: ANSWER_VALID_INTENTS,
        });
        return await handleToolCallDecision(input, {
          ...decision,
          type: DecisionType.TOOL_CALL,
          tools: ['web.search'],
          reason: 'Forced TOOL_CALL for non-valid ANSWER intent',
        }, context);
      }
      return await handleAnswerDecision(input, decision, context);

    case DecisionType.REFUSE:
      return handleRefuseDecision(input, decision, context);

    default:
      // Unknown decision type - refuse to proceed
      return handleRefuseDecision(input, {
        ...decision,
        reason: 'Unknown decision type',
      }, context);
  }
}

/**
 * Handle TOOL_CALL decision - EXECUTE tools, don't describe them
 *
 * CRITICAL: This function RUNS tools and returns RESULTS.
 * It does NOT return "Spouštím vyhledávání..." text.
 *
 * v44.2 - On failure, offers ASK_USER fallback instead of just ending
 * v44.3 - Enforces project goal when project mode is active
 */
