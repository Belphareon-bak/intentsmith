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
import { tryResolveClarification, assessGoalAlignment } from './clarification.js';
import { handleLocalDecision, computeCalendar, computeDate } from './local.js';
import { handleFileDecision, handleFileWriteDecision } from './file.js';
import {
  handleToolCallDecision,
  handleAskUserDecision,
  handleAnswerDecision,
  handleRefuseDecision,
} from './decisions.js';
import { buildProjectHint } from './utils/project-context-prompt.js';
import { getScriptSuggestion } from './utils/script-discovery.js';
import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from '../controller.js';
// ─── v93.1: Shared intercepts via pre-handler ─────────────────────────────────
import { preHandle } from './pre-handler.js';
import { config } from '../../config.js';

// ─── Post-CRE modules (lazy-loaded, null if feature disabled) ─────────────────
// Only modules needed AFTER CRE decision — shared intercepts are in pre-handler.js.
let handleBuildDetected;
let handleSkillDecision;
let isWizardTrigger, handleAgentWizardDetected, getActiveWizard;
let recordDecisionForDetector;

if (config.features.lifecycle !== false) {
  try {
    const bh = await import('./build-handoff.js');
    handleBuildDetected = bh.handleBuildDetected;
  } catch (err) {
    logger.warn('Conversation', `Build handoff not available: ${err.message}`);
  }
}

if (config.features.skills !== false) {
  try {
    const sk = await import('./skill.js');
    handleSkillDecision = sk.handleSkillDecision;
  } catch (err) {
    logger.warn('Conversation', `Skills handler not available: ${err.message}`);
  }
  try {
    const det = await import('../../skills/detector.js');
    recordDecisionForDetector = det.recordDecision;
  } catch (err) {
    logger.warn('Conversation', `Skill detector not available: ${err.message}`);
  }
}

if (config.features.agents !== false) {
  try {
    const wiz = await import('./agent-wizard.js');
    getActiveWizard = wiz.getActiveWizard;
    handleAgentWizardDetected = wiz.handleAgentWizardDetected;
    isWizardTrigger = wiz.isWizardTrigger;
  } catch (err) {
    logger.warn('Conversation', `Agent wizard not available: ${err.message}`);
  }
}

import {
  handleDesignDecision,
  handleDesignContinue,
  isExplicitFactQuery,
} from './design.js';
// v86 M2: Pattern tracking (cross-conversation learning)
import { patternTracker } from '../../memory/pattern-tracker.js';

// v57.3: Patterns for date-correction detection
const DATE_CORRECTION_PATTERNS = [
  /dnes\s+(?:je|máme|mame)\s+(?:ale\s+)?\d{1,2}\s*\.\s*\d{1,2}/i,
  /dneska\s+(?:je|máme)\s+(?:ale\s+)?\d{1,2}\s*\.\s*\d{1,2}/i,
  /(?:ale\s+)?dnes\s+(?:je|máme)\s+\d{1,2}\s*\.\s*\d{1,2}/i,
  /(?:dnešní|dnesni|aktuální|aktualni)\s+datum/i,
  /today\s+is\s+\w+\s*\d/i,               // "today is February 24" (actual correction with date)
  // v72: REMOVED /today'?s\s+date/i — too broad, catches "What is today's date?" as correction
];

// v58.3: DESIGN CLOSE — graceful "hotovo" / "díky, to stačí"
const DESIGN_CLOSE_PATTERNS = [
  /^hotovo[\s!.]*$/i,
  /^to\s+(je\s+)?v[šs]e[\s!.]*$/i,           // "to je vše", "to vše"
  /^d[ií]ky,?\s+(to\s+)?sta[čc][ií][\s!.]*$/i, // "díky, to stačí"
  /^sta[čc][ií][\s!.]*$/i,                     // "stačí"
  /^uzav[rř]i\s+(projekt|session|design)/i,   // "uzavři projekt"
  /^ukon[čc]i\s+(design|n[áa]vrh|pl[áa]n)/i, // "ukonči design"
  /^that'?s\s+(all|enough|it)[\s!.]*$/i,      // "that's all"
  /^done[\s!.]*$/i,                            // "done"
  /^we'?re\s+done/i,                          // "we're done"
  /^close\s+(project|design|session)/i,       // "close project"
];

// v58.0 Sprint 3: BUILD TRANSITION — "jdeme stavět" closes DESIGN → BUILD
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

/** Build a quick system TaggedResponse (shorthand for intercept returns) */
function systemResponse(content, metadata = {}, confidence = 1.0) {
  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.CONVERSATION,
    confidence,
    canExecute: false,
    metadata,
  });
  return new TaggedResponse({ content, tag });
}

/**
 * v65.0: Handle SHELL decision — return response with shellCommand in metadata.
 * Session adapter picks up shellCommand and auto-executes via terminal channel.
 */
export function handleShellDecision(input, decision, context) {
  const { sessionState } = context;
  const command = decision.metadata?.shellCommand || input.trim();

  if (sessionState) {
    sessionState.recordDecision(decision, input);
  }

  logger.info('HandleShell', `Shell command detected`, { command, input: input.substring(0, 50) });

  // ResponseTag/TaggedResponse imported at top-level from ../controller.js
  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.CONVERSATION,
    confidence: decision.confidence,
    canExecute: false,
    metadata: {
      decision: decision.toJSON(),
      handler: 'shell.exec',
      shellCommand: command,
    },
  });

  // v67.0: Script discovery — check project scripts before ad-hoc execution
  let content = `⚡ Spouštím: \`${command}\``;
  try {
    const projectPath = context.project?.path;
    if (projectPath) {
      const suggestion = getScriptSuggestion(projectPath, command);
      if (suggestion) {
        content += `\n\n${suggestion}`;
      }
    }
  } catch { /* non-critical */ }

  return new TaggedResponse({ content, tag });
}

export async function conversationHandler(input, context) {
  const { sessionId, sessionState } = context;

  // Telemetry: pick up collector from context (created in session-adapter)
  const telemetry = context.telemetry ?? null;

  // ════════════════════════════════════════════════════════════════════════════
  // v93.1: Shared intercept chain — feedback, session resume, TODO, build handoff,
  // lifecycle, agent wizard, skill confirmation, attachment guard
  // ════════════════════════════════════════════════════════════════════════════
  const pre = await preHandle(input, context, 'CONVERSATION');
  if (pre.handled) return pre.response;



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
      } else if (resolvedDecision.type === DecisionType.ASK_USER) {
        // v87: Clarification resolved to ASK_USER (e.g. CODE without project context).
        // Must handle here — falling through to CRE.decide() would reclassify the
        // short input (e.g. "kod") as AMBIGUOUS, creating an infinite clarification loop.
        return handleAskUserDecision(input, resolvedDecision, context);
      } else if (resolvedDecision.type === DecisionType.PLAN) {
        // v87: BUILD intent from clarification
        if (handleBuildDetected) return handleBuildDetected(input, resolvedDecision, context);
        return await handleAnswerDecision(input, resolvedDecision, context);
      } else if (resolvedDecision.type === DecisionType.REFUSE) {
        return handleRefuseDecision(input, resolvedDecision, context);
      }
      // Unknown type — fall through to normal processing (should not happen)
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

    creDecisionEngine.logIntercept('date_correction', 'User correcting date — replaying LOCAL computation', {
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

      return systemResponse(`📊 **${confirmationMsg}**`, { dateCorrection: true }, 0.95);
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
      const replayDecision = creDecisionEngine.overrideDecision({
        type: DecisionType.TOOL_CALL,
        intent: replayIntent,
        tools: replayTools,
        source: 'reformulation',
        reason: `Reformulation of previous ${replayIntent} intent`,
        confidence: 0.85,
        originalDecision: previousDecision,
        metadata: { reformulation: true, originalInput: effectiveInput },
      });
      return await handleToolCallDecision(effectiveInput, replayDecision, context);
    } else {
      // CONVERSATIONAL/CREATIVE/DESIGN — replay as answer with previous input
      // v58.0: DESIGN gets its own handler
      const resolvedIntent = replayIntent === IntentType.CREATIVE ? IntentType.CREATIVE
        : replayIntent === IntentType.DESIGN ? IntentType.DESIGN
        : IntentType.CONVERSATIONAL;
      const replayDecision = creDecisionEngine.overrideDecision({
        type: DecisionType.ANSWER,
        intent: resolvedIntent,
        source: 'reformulation',
        reason: `Reformulation of previous ${replayIntent} intent`,
        confidence: 0.85,
        originalDecision: previousDecision,
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

    // DESIGN_CLOSE_PATTERNS hoisted to module scope
    const isGracefulClose = DESIGN_CLOSE_PATTERNS.some(p => p.test(input.trim()));

    if (isGracefulClose) {
      const closedProject = typeof sessionState.closeDesignProject === 'function'
        ? sessionState.closeDesignProject('graceful_close')
        : (() => { const p = sessionState.activeDesignProject; sessionState.activeDesignProject = null; return p; })();

      logger.info('ConversationHandler', 'DESIGN project closed — graceful close signal', {
        input: input.substring(0, 50),
        projectType: closedProject?.type,
        turnCount: closedProject?.turnCount,
      });

      // Return immediate short confirmation — no CRE, no LLM call
      // ResponseTag/TaggedResponse imported at top-level from ../controller.js
      const closeLang = closedProject?.language === 'en'
        ? `Design session closed. We can continue anytime.`
        : `Projekt uzavřen. Kdykoliv můžeme pokračovat.`;
      const tag = new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM,
        mode: ChatMode.CONVERSATION,
        confidence: 1.0,
        canExecute: false,
        metadata: { designClosed: true, closedProject: closedProject?.type },
      });
      return new TaggedResponse({ content: closeLang, tag });
    }
    // ════════════════════════════════════════════════════════════════════════

    // BUILD_TRANSITION_PATTERNS hoisted to module scope
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

      const designDecision = creDecisionEngine.overrideDecision({
        type: DecisionType.ANSWER,
        intent: IntentType.DESIGN,
        source: 'design_continue',
        reason: 'DESIGN_CONTINUE — active project follow-up',
        confidence: 0.9,
        metadata: { designContinue: true },
      });
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

  // v65.4: Enrich CRE input with project hint for better intent classification
  const projectHint = buildProjectHint(context);
  const creInput = projectHint ? input + projectHint : input;
  // v71: decide() is now async (LLM-first classification)
  let decision = await creDecisionEngine.decide(creInput, decisionContext);

  // Telemetry: record CRE classification + decision timing
  telemetry?.recordClassification({
    intent: decision.intent,
    classifiedBy: decision.metadata?.classifiedBy,
    confidence: decision.confidence,
    classificationTimeMs: decision.metadata?.classificationTimeMs,
    diag: decision.metadata?.diag ?? null,
  });
  telemetry?.recordDecision({
    decideTimeMs: decision.metadata?.decideTimeMs,
    overrideApplied: decision.metadata?.override === true,
    overrideSource: decision.metadata?.overrideSource ?? null,
  });

  // STEP 1.5: Fail-fast assertion - catch bugs early
  assertDecision(decision);

  // v86 M2: Record turn for pattern tracking (cross-conversation learning)
  try {
    patternTracker.recordTurn(decision.intent, input);
  } catch (_) {}

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

  // VAGUE_INPUT_PATTERNS hoisted to module scope
  const isVagueInput = VAGUE_INPUT_PATTERNS.some(p => p.test(input.trim()));

  // v44.9 FIX B: Block SEARCH/TOOL_CALL on first turn for vague inputs
  if (isFirstTurn && isVagueInput && decision.type === DecisionType.TOOL_CALL) {
    logger.info('ConversationHandler', 'First turn SEARCH blocked for vague input - forcing CONVERSATIONAL', {
      originalIntent: decision.intent,
      input: input.substring(0, 50),
    });

    decision = creDecisionEngine.overrideDecision({
      type: DecisionType.ANSWER,
      intent: IntentType.CONVERSATIONAL,
      source: 'first_turn_vague_input',
      reason: 'First turn vague input - optimistic conversational response instead of SEARCH',
      confidence: 0.6,
      originalDecision: decision,
      metadata: {
        firstTurnOverride: true,
        vagueInputBlocked: true,
        inputPreview: input.substring(0, 100),
      },
    });
  }

  if (isFirstTurn && decision.type === DecisionType.ASK_USER) {
    logger.info('ConversationHandler', 'First turn ASK_USER blocked - forcing CREATIVE/CONVERSATIONAL answer', {
      originalIntent: decision.intent,
      input: input.substring(0, 50),
    });

    // Force CREATIVE if it looks like an ideation request, otherwise CONVERSATIONAL
    const isIdeation = /vymyslet|navrh|nápad|inspirac|kampaň|kampan|příběh|pribeh/i.test(input);

    decision = creDecisionEngine.overrideDecision({
      type: DecisionType.ANSWER,
      intent: isIdeation ? IntentType.CREATIVE : IntentType.CONVERSATIONAL,
      source: 'first_turn_ask_user',
      reason: 'First turn - optimistic answer instead of ASK_USER',
      confidence: 0.7,
      originalDecision: decision,
      metadata: {
        firstTurnOverride: true,
        inputPreview: input.substring(0, 100),
      },
    });
  }

  logger.info('ConversationHandler', `CRE Decision: ${decision.type}`, {
    intent: decision.intent,
    tools: decision.tools,
    reason: decision.reason,
  });

  // System step: CRE decided
  if (typeof context.onSystemStep === 'function') {
    try { context.onSystemStep('cre_decided', decision.type + ' / ' + decision.intent); } catch (_) {}
  }

  // v59.0 - Check for agent wizard trigger BEFORE standard routing (optional — Phase B)
  if (isWizardTrigger && isWizardTrigger(input) && !getActiveWizard(sessionId)) {
    creDecisionEngine.logIntercept('agent_wizard_trigger', 'Agent wizard trigger detected post-CRE — overriding routing', {
      input: input.substring(0, 80), originalDecision: decision?.toJSON?.() || decision,
    });
    return handleAgentWizardDetected(input, context);
  }

  // v85: Record decision type for workflow pattern detector
  if (recordDecisionForDetector && sessionState) {
    try { recordDecisionForDetector(sessionState, decision.type, sessionId); } catch (_) {}
  }

  // STEP 2: Handle based on decision type
  if (typeof context.onSystemStep === 'function') {
    try { context.onSystemStep('routing_switch', decision.type, 2); } catch (_) {}
  }
  switch (decision.type) {
    // ════════════════════════════════════════════════════════════════════════
    // BUILD → PLAN: Handoff to Planner pipeline
    // ════════════════════════════════════════════════════════════════════════
    case DecisionType.PLAN:
      if (handleBuildDetected) return handleBuildDetected(input, decision, context);
      // Phase C not loaded — fall through to ANSWER
      return await handleAnswerDecision(input, decision, context);

    // ════════════════════════════════════════════════════════════════════════
    // v85: SKILL — resolve + confirm + execute deterministic macro-recipe
    // ════════════════════════════════════════════════════════════════════════
    case DecisionType.SKILL:
      if (handleSkillDecision) {
        const skillResult = await handleSkillDecision(input, decision, context);
        if (skillResult) return skillResult;
      }
      // Skill handler not loaded or returned null — fall through to ANSWER
      return await handleAnswerDecision(input, decision, context);

    // ════════════════════════════════════════════════════════════════════════
    // v44.7 FIX 1: LOCAL is TERMINAL - direct computation, no tools
    // v63.0: FILE_READ/FILE_EXPLAIN also route through LOCAL (terminal)
    // ════════════════════════════════════════════════════════════════════════
    case DecisionType.LOCAL:
      if (decision.intent === IntentType.FILE_READ || decision.intent === IntentType.FILE_EXPLAIN) {
        return await handleFileDecision(input, decision, context);
      }
      // v70: FILE_WRITE intent → write content to file
      if (decision.intent === IntentType.FILE_WRITE) {
        return await handleFileWriteDecision(input, decision, context);
      }
      // v65.0: SHELL intent → route to terminal execution
      if (decision.intent === IntentType.SHELL) {
        return handleShellDecision(input, decision, context);
      }
      return await handleLocalDecision(input, decision, context);

    case DecisionType.TOOL_CALL:
      return await handleToolCallDecision(input, decision, context);

    case DecisionType.ASK_USER:
      // v72: CODE intent without project → answer inline instead of asking for project
      if (decision.intent === IntentType.CODE &&
          (decision.slots?.includes('project_context') || decision.slots?.includes('file_path'))) {
        logger.info('ConversationHandler', 'CODE without project → inline ANSWER', { input: input.substring(0, 60) });
        return await handleAnswerDecision(input, { ...decision, type: DecisionType.ANSWER, toJSON() { return { ...this, toJSON: undefined }; } }, context);
      }
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
