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
import { parseTodoCommand, handleTodo, handleDone } from './todo.js';
import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from '../controller.js';
// ─── Optional module imports (B/C/D) — lazy-loaded, null if feature disabled ──
import { config } from '../../config.js';

// Phase C: Build handoff (planner pipeline)
let handleBuildDetected, handleBuildConfirmed, handleClarificationAnswer,
    handlePlanVerdict, getActiveBuildHandoff, cancelBuildHandoff, setHandoffState;

// Phase C: Lifecycle handoff (project lifecycle)
let getActiveLifecycleHandoff, cancelLifecycleHandoff, handleLifecycleInput;

// Phase C: Session resume (multi-session projects)
let detectResumeIntent, handleResumeRequest, handleProgressRequest;

// Phase B: Agent wizard
let getActiveWizard, cancelWizard, handleWizardInput, handleAgentWizardDetected, isWizardTrigger;

// Load Phase C modules
if (config.features.lifecycle !== false) {
  try {
    const bh = await import('./build-handoff.js');
    handleBuildDetected = bh.handleBuildDetected;
    handleBuildConfirmed = bh.handleBuildConfirmed;
    handleClarificationAnswer = bh.handleClarificationAnswer;
    handlePlanVerdict = bh.handlePlanVerdict;
    getActiveBuildHandoff = bh.getActiveBuildHandoff;
    cancelBuildHandoff = bh.cancelBuildHandoff;
    setHandoffState = bh.setHandoffState;
  } catch (err) {
    logger.warn('Conversation', `Build handoff not available: ${err.message}`);
  }

  try {
    const lh = await import('./lifecycle-handoff.js');
    getActiveLifecycleHandoff = lh.getActiveLifecycleHandoff;
    cancelLifecycleHandoff = lh.cancelLifecycleHandoff;
    handleLifecycleInput = lh.handleLifecycleInput;
  } catch (err) {
    logger.warn('Conversation', `Lifecycle handoff not available: ${err.message}`);
  }

  try {
    const sr = await import('./session-resume.js');
    detectResumeIntent = sr.detectResumeIntent;
    handleResumeRequest = sr.handleResumeRequest;
    handleProgressRequest = sr.handleProgressRequest;
  } catch (err) {
    logger.warn('Conversation', `Session resume not available: ${err.message}`);
  }
}

// Load Phase B modules
if (config.features.agents !== false) {
  try {
    const wiz = await import('./agent-wizard.js');
    getActiveWizard = wiz.getActiveWizard;
    cancelWizard = wiz.cancelWizard;
    handleWizardInput = wiz.handleWizardInput;
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

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE C1: SESSION RESUME / PROGRESS INTERCEPT (optional — Phase C)
  // ════════════════════════════════════════════════════════════════════════════
  const resumeIntent = detectResumeIntent ? detectResumeIntent(input) : null;

  if (resumeIntent === 'resume') {
    creDecisionEngine.logIntercept('session_resume', 'User requesting session resume — routing to resume handler', {
      sessionId,
    });
    const result = await handleResumeRequest(input, context, setHandoffState);
    if (result.handled) {
      if (result.pendingChoice) {
        context.sessionState.pendingResumeChoice = result.pendingChoice;
      }
      return systemResponse(result.content, {
        sessionResume: true,
        pendingChoice: result.pendingChoice || null,
      });
    }
  }

  if (resumeIntent === 'progress') {
    creDecisionEngine.logIntercept('progress_inquiry', 'User asking about progress — routing to progress handler', {
      sessionId,
    });
    const result = handleProgressRequest();
    if (result.handled) {
      return systemResponse(result.content, { progressInquiry: true });
    }
  }

  // Handle numeric session selection after resume list was shown
  if (context.sessionState?.pendingResumeChoice) {
    const num = parseInt(input.trim());
    if (!isNaN(num) && num >= 1) {
      const choices = context.sessionState.pendingResumeChoice;
      const idx = num - 1;
      if (idx < choices.length) {
        const { restoreSession } = await import('./session-resume.js');
        const result = await restoreSession(
          sessionId,
          choices[idx].sessionId,
          setHandoffState,
        );
        delete context.sessionState.pendingResumeChoice;
        return systemResponse(result.message, { sessionResume: true });
      }
    }
    delete context.sessionState.pendingResumeChoice;
  }
  // ════════════════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════════════════
  // v67.0: TODO WORKFLOW — /todo and /done commands (deterministic, no LLM)
  // ════════════════════════════════════════════════════════════════════════════
  const todoCmd = parseTodoCommand(input);
  if (todoCmd.type) {
    const projectId = context.project?.id || null;
    const result = todoCmd.type === 'todo'
      ? handleTodo(todoCmd.text, projectId)
      : handleDone(todoCmd.text, projectId);
    if (result.handled) {
      return systemResponse(result.content, { todoCommand: todoCmd.type });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BUILD HANDOFF INTERCEPT — route messages during active Planner flow (optional — Phase C)
  // ════════════════════════════════════════════════════════════════════════════
  const activeHandoff = getActiveBuildHandoff ? getActiveBuildHandoff(sessionId) : null;
  if (activeHandoff) {
    creDecisionEngine.logIntercept('build_handoff', `Active build handoff (phase: ${activeHandoff.phase}) — routing to build handler`, {
      sessionId, phase: activeHandoff.phase,
    });
    // Cancel command
    if (/^(zrušit?|cancel|stop|zpět|back)\s*[!.]?$/i.test(input.trim())) {
      cancelBuildHandoff(sessionId);
      return systemResponse('Build zrušen. Jsem zpět v chat módu.', { buildCancelled: true });
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
          return systemResponse('OK, zůstáváme v chatu.', { buildCancelled: true });
        }
        // Ambiguous — remind user
        return systemResponse('Chceš spustit Planner pipeline? (ano/ne)', { buildConfirmation: true }, 0.9);
      }
      case 'CLARIFYING':
        return await handleClarificationAnswer(input, context);
      case 'PLAN_REVIEW':
        return await handlePlanVerdict(input, context);
      case 'EXECUTING':
        return systemResponse('Pipeline právě běží, počkej na výsledek...', { pipelineRunning: true }, 0.9);
      default:
        // Unknown phase — clear and continue normally
        cancelBuildHandoff(sessionId);
        break;
    }
  }
  // ════════════════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════════════════
  // v62: C4 LIFECYCLE AUTO-DETECT — new session for existing project with active lifecycle
  // ════════════════════════════════════════════════════════════════════════════
  if (getActiveLifecycleHandoff && !getActiveLifecycleHandoff(sessionId)) {
    const projectId = context.project?.id || context.projectId;
    if (projectId && config.features.lifecycle !== false) {
      try {
        const { getLcStateByProject, setLcState: setLcS, bindSessionToLifecycle: bindS } =
            await import('./lifecycle-state.js');

        // A) RAM lookup by projectId — fast path (catches sessionId mismatch)
        const existing = getLcStateByProject(projectId);
        if (existing && existing.state.phase !== 'COMPLETED' && existing.state.phase !== 'FAILED') {
          setLcS(sessionId, { ...existing.state });
          if (existing.state.lifecycleId) bindS(sessionId, existing.state.lifecycleId);
          logger.info('Conversation', `C4: Lifecycle state migrated from ${existing.sessionId} to ${sessionId} for project ${projectId}`);
        } else {
          // B) DB fallback — restore from DB when RAM has no match
          const { lifecycles: lcRepo, lifecycleHandoffState: lhsRepo } = await import('../../db/database.js');
          const activeLc = lcRepo.findActiveByProject.get(projectId);
          if (activeLc && activeLc.phase !== 'COMPLETED' && activeLc.phase !== 'FAILED') {
            const prev = activeLc.active_session_id && lhsRepo
              ? lhsRepo.findBySession.get(activeLc.active_session_id) : null;
            setLcS(sessionId, {
              phase: activeLc.phase,
              lifecycleId: activeLc.id,
              currentMilestoneId: prev?.current_milestone_id || null,
              originalRequest: prev?.original_request || '',
              projectId: activeLc.project_id,
              projectPath: context.project?.path || prev?.project_path,
            });
            bindS(sessionId, activeLc.id);
            logger.info('Conversation', `C4: Auto-detected active lifecycle ${activeLc.id} for project ${projectId}`);
          }
        }
      } catch (err) {
        logger.debug('Conversation', `Lifecycle auto-detect: ${err.message}`);
      }
    }
  }
  // ════════════════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════════════════
  // v61: LIFECYCLE HANDOFF INTERCEPT — route messages during active lifecycle (optional — Phase C)
  // ════════════════════════════════════════════════════════════════════════════
  const activeLifecycle = getActiveLifecycleHandoff ? getActiveLifecycleHandoff(sessionId) : null;
  if (activeLifecycle) {
    creDecisionEngine.logIntercept('lifecycle_handoff', 'Active lifecycle handoff — routing to lifecycle handler', {
      sessionId, phase: activeLifecycle.phase,
    });
    // Cancel command
    if (/^(zru[sš]it?|cancel|stop)\s*[!.]?$/i.test(input.trim())) {
      cancelLifecycleHandoff(sessionId);
      return systemResponse('Lifecycle zrušen. Jsem zpět v chat módu.', { lifecycleCancelled: true });
    }

    const lcResult = await handleLifecycleInput(input, context);
    if (lcResult) return lcResult;
  }
  // ════════════════════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════════════════════
  // v59.0 - AGENT WIZARD INTERCEPT — route messages during active wizard flow (optional — Phase B)
  // ════════════════════════════════════════════════════════════════════════════
  const activeWizard = getActiveWizard ? getActiveWizard(sessionId) : null;
  if (activeWizard) {
    creDecisionEngine.logIntercept('agent_wizard', 'Active agent wizard — routing to wizard handler', {
      sessionId, wizardStep: activeWizard.step,
    });
    if (/^(zru[sš]it?|cancel|stop|zp[eě]t|back)\s*[!.]?$/i.test(input.trim())) {
      cancelWizard(sessionId);
      return systemResponse('Wizard zrušen. Jsem zpět v chat módu.', { wizardCancelled: true });
    }
    return await handleWizardInput(input, context);
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

  // v59.0 - Check for agent wizard trigger BEFORE standard routing (optional — Phase B)
  if (isWizardTrigger && isWizardTrigger(input) && !getActiveWizard(sessionId)) {
    creDecisionEngine.logIntercept('agent_wizard_trigger', 'Agent wizard trigger detected post-CRE — overriding routing', {
      input: input.substring(0, 80), originalDecision: decision?.toJSON?.() || decision,
    });
    return handleAgentWizardDetected(input, context);
  }

  // STEP 2: Handle based on decision type
  switch (decision.type) {
    // ════════════════════════════════════════════════════════════════════════
    // BUILD → PLAN: Handoff to Planner pipeline
    // ════════════════════════════════════════════════════════════════════════
    case DecisionType.PLAN:
      if (handleBuildDetected) return handleBuildDetected(input, decision, context);
      // Phase C not loaded — fall through to ANSWER
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
