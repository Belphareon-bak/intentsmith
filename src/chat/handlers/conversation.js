// Conversation Handler — extracted from handlers.js
// Main handler for CONVERSATION mode using CRE Decision Engine

import {
  creDecisionEngine,
  DecisionType,
  IntentType,
  assertDecision,
  REFORMULATION_PATTERNS,
  DESIGN_CONTINUE_PATTERNS,
} from '../cre-decision.js';
import { logger } from '../../core/logger.js';
import { isVagueInput } from './utils/intent.js';
import { tryResolveClarification, buildResolvedDecision, assessGoalAlignment } from './clarification.js';
import { handleLocalDecision, computeCalendar, computeDate } from './local.js';
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
import {
  handleDesignDecision,
  handleDesignContinue,
  isExplicitFactQuery,
} from './design.js';

// v57.3: Patterns for date-correction detection
const DATE_CORRECTION_PATTERNS = [
  /dnes\s+(?:je|máme|mame)\s+(?:ale\s+)?\d{1,2}\s*\.\s*\d{1,2}/i,
  /dneska\s+(?:je|máme)\s+(?:ale\s+)?\d{1,2}\s*\.\s*\d{1,2}/i,
  /(?:ale\s+)?dnes\s+(?:je|máme)\s+\d{1,2}\s*\.\s*\d{1,2}/i,
  /(?:dnešní|dnesni|aktuální|aktualni)\s+datum/i,
  /today\s+is\s+/i,
  /today'?s\s+date/i,
];

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

  // ════════════════════════════════════════════════════════════════════════════
  // v57.3: DATE CORRECTION HANDLING
  // ════════════════════════════════════════════════════════════════════════════
  // "dnes je ale 8.2.2026" after LOCAL computation → confirm date + replay
  // User is questioning whether we know the correct date.
  // ════════════════════════════════════════════════════════════════════════════
  const isDateCorrection = DATE_CORRECTION_PATTERNS.some(p => p.test(input.trim()));
  if (isDateCorrection && sessionState?.lastDecision) {
    const previousDecision = sessionState.lastDecision;
    const previousInput = sessionState.lastUserInput || '';

    logger.info('ConversationHandler', 'Date correction detected', {
      input: input.substring(0, 50),
      previousIntent: previousDecision.intent,
    });

    if (previousDecision.intent === IntentType.LOCAL) {
      // Replay LOCAL computation — it already uses new Date() so result is correct
      // Just need to acknowledge and confirm
      const now = new Date();
      const todayStr = now.toLocaleDateString('cs-CZ');

      // Re-run the original computation to get fresh result with today's date
      let recomputedResult;
      try {
        if (/úplněk|uplnek|moon/i.test(previousInput)) {
          recomputedResult = computeCalendar(previousInput);
        } else {
          recomputedResult = computeDate(previousInput);
        }
      } catch (e) {
        recomputedResult = { explanation: null };
      }

      const confirmationMsg = recomputedResult?.explanation
        ? `Ano, dnes je ${todayStr}. ${recomputedResult.explanation}.`
        : `Ano, dnes je ${todayStr}. Moje předchozí odpověď byla vypočtena z tohoto data.`;

      // Record and return
      if (sessionState) {
        sessionState.recordDecision(previousDecision, input);
      }

      return {
        content: `📊 **${confirmationMsg}**`,
        tag: 'RESPONSE',
        speaker: 'SYSTEM',
        mode: context.mode || 'conversation',
        confidence: 0.95,
      };
    }
    // For non-LOCAL previous intents, fall through to normal processing
  }

  // ════════════════════════════════════════════════════════════════════════════
  // v57.3: REFORMULATION DETECTION
  // ════════════════════════════════════════════════════════════════════════════
  // "zkus to v ceskem jazyce" = replay previous intent, not new classification.
  // "zkus to znovu" = retry previous action.
  // Must be checked BEFORE decide() to avoid AMBIGUOUS classification.
  // ════════════════════════════════════════════════════════════════════════════
  const isReformulation = REFORMULATION_PATTERNS.some(p => p.test(input.trim()));
  if (isReformulation && sessionState?.lastDecision) {
    const previousDecision = sessionState.lastDecision;
    const previousInput = sessionState.lastUserInput || input;

    logger.info('ConversationHandler', 'Reformulation detected — replaying previous intent', {
      input: input.substring(0, 50),
      previousIntent: previousDecision.intent,
      previousInput: previousInput.substring(0, 50),
    });

    // Build decision from previous intent with current input context
    const replayIntent = previousDecision.intent || IntentType.CONVERSATIONAL;
    const replayTools = creDecisionEngine.getRequiredTools(replayIntent, previousInput);

    // For language switch: use the PREVIOUS input as the task, current input just changes language
    const effectiveInput = previousInput;

    if (replayTools.length > 0) {
      const replayDecision = new (await import('../cre-decision.js')).CREDecision({
        type: DecisionType.TOOL_CALL,
        intent: replayIntent,
        tools: replayTools,
        reason: `Reformulation of previous ${replayIntent} intent`,
        confidence: 0.85,
        metadata: { reformulation: true, originalInput: effectiveInput },
      });
      return await handleToolCallDecision(effectiveInput, replayDecision, context);
    } else {
      // CONVERSATIONAL/CREATIVE/DESIGN — replay as answer with previous input
      // v58.0: DESIGN gets its own handler
      const resolvedIntent = replayIntent === IntentType.CREATIVE ? IntentType.CREATIVE
        : replayIntent === IntentType.DESIGN ? IntentType.DESIGN
        : IntentType.CONVERSATIONAL;
      const replayDecision = new (await import('../cre-decision.js')).CREDecision({
        type: DecisionType.ANSWER,
        intent: resolvedIntent,
        reason: `Reformulation of previous ${replayIntent} intent`,
        confidence: 0.85,
        metadata: { reformulation: true, originalInput: effectiveInput },
      });
      if (resolvedIntent === IntentType.DESIGN) {
        return await handleDesignDecision(effectiveInput, replayDecision, context);
      }
      return await handleAnswerDecision(effectiveInput, replayDecision, context);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // v58.0: DESIGN_CONTINUE INTERCEPT — check BEFORE CRE decide()
  // ════════════════════════════════════════════════════════════════════════════
  // If there's an active DESIGN project and user sends a follow-up,
  // route directly to DESIGN handler WITHOUT CRE classification.
  // This prevents "více podrobností" from being classified as SEARCH.
  //
  // Escape hatches:
  //   - Explicit fact query → let CRE classify (FACTUAL/SEARCH)
  //   - Explicit intent break ("teď chci něco jiného") → close project, let CRE classify
  // ════════════════════════════════════════════════════════════════════════════
  if (sessionState?.activeDesignProject) {
    const isDesignFollowUp = DESIGN_CONTINUE_PATTERNS.some(p => p.test(input.trim()));
    const isFactQuery = isExplicitFactQuery(input);

    // Explicit break patterns (from cre-decision.js INTENT_BREAK_PATTERNS)
    const isExplicitBreak = /^(teď|ted|nyní|nyni|změň|zmen|přepni|prepni|něco|neco|dost|stačí|staci|konec)\s/i.test(input.trim());

    // ════════════════════════════════════════════════════════════════════════
    // v58.0 Sprint 3: BUILD TRANSITION — "jdeme stavět" closes DESIGN → BUILD
    // ════════════════════════════════════════════════════════════════════════
    const BUILD_TRANSITION_PATTERNS = [
      /jdeme?\s+stav[eě]t/i,              // "jdeme stavět", "jdem stavět"
      /jdi\s+stav[eě]t/i,                 // "jdi stavět"
      /za[cč]ni\s+stav[eě]t/i,            // "začni stavět"
      /za[cč]ni\s+implementovat/i,         // "začni implementovat"
      /jdi\s+(do|na)\s+(implementac|k[oó]d|v[ýy]voj)/i,  // "jdi do implementace"
      /p[rř]ejdi\s+(ke?\s+|na\s+|do\s+)(stav|implementac|k[oó]d|v[ýy]voj)/i,
      /postav\s+(to|mi\s+to)/i,            // "postav to", "postav mi to"
      /let'?s\s+build/i,                   // "let's build"
      /start\s+(building|coding|implementing)/i,
      /implement\s+this/i,
      /go\s+ahead\s+and\s+build/i,
    ];

    const isBuildTransition = BUILD_TRANSITION_PATTERNS.some(p => p.test(input.trim()));

    if (isBuildTransition) {
      const closedProject = typeof sessionState.closeDesignProject === 'function'
        ? sessionState.closeDesignProject('build_transition')
        : (() => { const p = sessionState.activeDesignProject; sessionState.activeDesignProject = null; return p; })();

      logger.info('ConversationHandler', 'DESIGN → BUILD transition', {
        input: input.substring(0, 80),
        projectType: closedProject?.type,
        turnCount: closedProject?.turnCount,
      });

      // Fall through — CRE will classify as BUILD → Planner handoff
      // Attach design context to decisionContext so Planner gets it
      decisionContext.designContext = closedProject;
    } else if (isDesignFollowUp && !isExplicitBreak && !isFactQuery) {
      logger.info('ConversationHandler', 'DESIGN_CONTINUE intercept — routing to design handler', {
        input: input.substring(0, 80),
        projectType: sessionState.activeDesignProject.type,
        turnCount: sessionState.activeDesignProject.turnCount,
      });

      const designDecision = {
        type: DecisionType.ANSWER,
        intent: IntentType.DESIGN,
        tools: [],
        reason: 'DESIGN_CONTINUE — active project follow-up',
        confidence: 0.9,
        metadata: { designContinue: true },
        toJSON() { return this; },
      };
      return await handleDesignContinue(input, designDecision, context);
    } else if (isExplicitBreak) {
      const closedProject = typeof sessionState.closeDesignProject === 'function'
        ? sessionState.closeDesignProject('explicit_break')
        : (() => { sessionState.activeDesignProject = null; return null; })();

      logger.info('ConversationHandler', 'DESIGN project closed — explicit intent break', {
        input: input.substring(0, 50),
        projectType: closedProject?.type,
      });
      // Fall through to normal CRE classification
    } else if (isFactQuery) {
      logger.info('ConversationHandler', 'DESIGN escape hatch — fact query during design', {
        input: input.substring(0, 50),
      });
      // Fall through to CRE — project stays active
    }
  }

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
      // v44.8: ANSWER is valid for CONVERSATIONAL, CREATIVE, DESIGN, and CODE intents
      // v58.0: Added DESIGN — structured synthesis from LLM knowledge
      // v58.2: Added CODE — imperative code requests get inline answer
      const ANSWER_VALID_INTENTS = [IntentType.CONVERSATIONAL, IntentType.CREATIVE, IntentType.DESIGN, IntentType.CODE];
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
          toJSON() { return { ...this, toJSON: undefined }; },
        }, context);
      }
      // v58.0: DESIGN gets its own handler with specialized system prompt
      if (decision.intent === IntentType.DESIGN) {
        return await handleDesignDecision(input, decision, context);
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
