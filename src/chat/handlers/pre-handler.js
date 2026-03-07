// Pre-Handler Middleware — shared intercept chain for all handler modes
// v93.1: Extracted from conversation.js to fix missing interceptors in PROJECT/EXPERTISE modes.
//
// Problem: conversation.js had 12 intercepts, project.js had 3 mirrored copies,
// expertise.js had 0. Missing interceptors = real runtime bugs:
//   - Attachment guard doesn't fire in PROJECT/EXPERTISE mode
//   - Reformulation ("zkus to česky") doesn't work in PROJECT/EXPERTISE
//   - M3 feedback learning doesn't run in PROJECT/EXPERTISE
//   - TODO workflow not available in PROJECT/EXPERTISE
//
// Solution: Intercept registry with mode filtering. Each handler calls
// preHandle(input, context, mode) and checks result.handled.

import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from '../controller.js';
import { creDecisionEngine, DecisionType, IntentType, REFORMULATION_PATTERNS } from '../cre-decision.js';
import { logger } from '../../core/logger.js';
import { parseTodoCommand, handleTodo, handleDone } from './todo.js';
import { handleFileDecision } from './file.js';
import { config } from '../../config.js';

// ─── Lazy-loaded Phase modules (null if feature disabled) ────────────────────
let handleBuildConfirmed, handleClarificationAnswer, handlePlanVerdict,
    getActiveBuildHandoff, cancelBuildHandoff, setHandoffState;
let getActiveLifecycleHandoff, cancelLifecycleHandoff, handleLifecycleInput;
let detectResumeIntent, handleResumeRequest, handleProgressRequest;
let getActiveWizard, cancelWizard, handleWizardInput;
let handleSkillConfirmation;

// Feedback detection (M3)
let detectFeedback, classifyFeedback, FeedbackSignal;
let preferenceEngine, longTermMemory, MemoryKind, MemorySource;

let _initialized = false;

async function _initModules() {
  if (_initialized) return;
  _initialized = true;

  // M3 Feedback
  try {
    const fb = await import('../../memory/feedback-detector.js');
    detectFeedback = fb.detectFeedback;
    classifyFeedback = fb.classifyFeedback;
    FeedbackSignal = fb.FeedbackSignal;
    const pref = await import('../../memory/preferences.js');
    preferenceEngine = pref.preferenceEngine;
    const ltm = await import('../../memory/long-term.js');
    longTermMemory = ltm.longTermMemory;
    MemoryKind = ltm.MemoryKind;
    MemorySource = ltm.MemorySource;
  } catch (err) {
    logger.debug('PreHandler', `Feedback modules not available: ${err.message}`);
  }

  // Phase C: Build handoff
  if (config.features.lifecycle !== false) {
    try {
      const bh = await import('./build-handoff.js');
      handleBuildConfirmed = bh.handleBuildConfirmed;
      handleClarificationAnswer = bh.handleClarificationAnswer;
      handlePlanVerdict = bh.handlePlanVerdict;
      getActiveBuildHandoff = bh.getActiveBuildHandoff;
      cancelBuildHandoff = bh.cancelBuildHandoff;
      setHandoffState = bh.setHandoffState;
    } catch (err) {
      logger.debug('PreHandler', `Build handoff not available: ${err.message}`);
    }

    try {
      const lh = await import('./lifecycle-handoff.js');
      getActiveLifecycleHandoff = lh.getActiveLifecycleHandoff;
      cancelLifecycleHandoff = lh.cancelLifecycleHandoff;
      handleLifecycleInput = lh.handleLifecycleInput;
    } catch (err) {
      logger.debug('PreHandler', `Lifecycle handoff not available: ${err.message}`);
    }

    try {
      const sr = await import('./session-resume.js');
      detectResumeIntent = sr.detectResumeIntent;
      handleResumeRequest = sr.handleResumeRequest;
      handleProgressRequest = sr.handleProgressRequest;
    } catch (err) {
      logger.debug('PreHandler', `Session resume not available: ${err.message}`);
    }
  }

  // Phase B: Agent wizard
  if (config.features.agents !== false) {
    try {
      const wiz = await import('./agent-wizard.js');
      getActiveWizard = wiz.getActiveWizard;
      cancelWizard = wiz.cancelWizard;
      handleWizardInput = wiz.handleWizardInput;
    } catch (err) {
      logger.debug('PreHandler', `Agent wizard not available: ${err.message}`);
    }
  }

  // Phase D: Skills
  if (config.features.skills !== false) {
    try {
      const sk = await import('./skill.js');
      handleSkillConfirmation = sk.handleSkillConfirmation;
    } catch (err) {
      logger.debug('PreHandler', `Skills handler not available: ${err.message}`);
    }
  }
}

// ─── Mode-aware systemResponse helper ────────────────────────────────────────

const MODE_MAP = {
  CONVERSATION: ChatMode.CONVERSATION,
  PROJECT: ChatMode.PROJECT,
  EXPERTISE: ChatMode.EXPERTISE,
};

function systemResponse(content, mode, metadata = {}, confidence = 1.0) {
  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: MODE_MAP[mode] || ChatMode.CONVERSATION,
    confidence,
    canExecute: false,
    metadata,
  });
  return new TaggedResponse({ content, tag });
}

function cancelMessage(what, mode) {
  const suffix = mode === 'PROJECT' ? 'v projektu' : 'v chat módu';
  return `${what} zrušen. Jsem zpět ${suffix}.`;
}

// ─── v103: Upgrade notification (lazy-loaded) ──────────────────────────────
let _upgradeManager = null;
let _MIN_NOTIFY_SCORE = 6;

// ─── Intercept definitions ───────────────────────────────────────────────────
// Each intercept: { name, modes, fn(input, context, mode) → { handled, response? } }
// modes: ['*'] = all modes, or specific ['CONVERSATION', 'PROJECT']

const intercepts = [];

// 0. UPGRADE NOTIFICATION (v103) — side-effect only, once per session
intercepts.push({
  name: 'upgrade_notification',
  modes: ['*'],
  async fn(_input, context, _mode) {
    // Only notify once per session
    if (context.sessionState?._upgradeNotified) return { handled: false };

    // Lazy-load upgrade manager
    if (!_upgradeManager) {
      try {
        const um = await import('../../upgrade/upgrade-manager.js');
        _upgradeManager = um.upgradeManager;
        _MIN_NOTIFY_SCORE = um.MIN_NOTIFY_SCORE ?? 6;
      } catch {
        return { handled: false };
      }
    }

    const proposals = _upgradeManager.getNotifiableProposals();
    if (proposals.length === 0) return { handled: false };

    // Mark notified (prevents repeated notifications)
    if (context.sessionState) context.sessionState._upgradeNotified = true;

    // Emit system step with summary
    if (typeof context.onSystemStep === 'function') {
      const summary = proposals.slice(0, 3).map(p =>
        `${p.role}: ${p.currentModel} → ${p.candidateModel} (score ${p.score}, ${p.riskLevel})`
      ).join('; ');
      try {
        context.onSystemStep('model_upgrade', `${proposals.length} upgrade(s) available: ${summary}`);
      } catch (_) {}
    }

    logger.info('PreHandler', `Upgrade notification: ${proposals.length} proposals above score ${_MIN_NOTIFY_SCORE}`);
    return { handled: false }; // never short-circuits
  },
});

// 1. FEEDBACK DETECTION (M3) — always run, side-effect only (no short-circuit)
intercepts.push({
  name: 'feedback_detection',
  modes: ['*'],
  async fn(input, context, _mode) {
    if (!detectFeedback || !context.sessionState?.lastDecision) return { handled: false };
    try {
      const feedback = detectFeedback(input, context.sessionState);
      if (feedback.type === FeedbackSignal.NEUTRAL) return { handled: false };

      const feedbackClass = classifyFeedback(feedback.type);
      const lastIntent = context.sessionState.lastIntent || 'unknown';

      if (feedbackClass === 'positive') {
        preferenceEngine.recordPositiveFeedback({
          responseType: lastIntent,
          verbosity: preferenceEngine.preferences.verbosity,
          structure: preferenceEngine.preferences.structure,
          input: context.sessionState.lastUserInput,
        });
      } else if (feedbackClass === 'negative') {
        preferenceEngine.recordNegativeFeedback({
          responseType: lastIntent,
          verbosity: preferenceEngine.preferences.verbosity,
          structure: preferenceEngine.preferences.structure,
          reason: feedback.signal,
          input: context.sessionState.lastUserInput,
        });
      }

      if (feedback.type === FeedbackSignal.CORRECTION && feedback.correctionData && longTermMemory.initialized) {
        longTermMemory.write({
          kind: MemoryKind.CORRECTION,
          key: `corr_${Date.now()}`,
          value: {
            original: feedback.correctionData.original,
            corrected: feedback.correctionData.corrected,
            context: lastIntent,
          },
          confidence: 0.8,
          source: MemorySource.CORRECTED,
        });
      }

      logger.debug('PreHandler', 'Feedback detected', {
        type: feedback.type, signal: feedback.signal, confidence: feedback.confidence,
      });
    } catch (err) {
      logger.debug('PreHandler', `Feedback detection error: ${err.message}`);
    }
    return { handled: false }; // never short-circuits
  },
});

// 2. SESSION RESUME / PROGRESS — CONVERSATION only
intercepts.push({
  name: 'session_resume',
  modes: ['CONVERSATION'],
  async fn(input, context, mode) {
    const resumeIntent = detectResumeIntent ? detectResumeIntent(input) : null;

    if (resumeIntent === 'resume') {
      if (typeof context.onSystemStep === 'function') {
        try { context.onSystemStep('session_resume', 'User requesting session resume', 2); } catch (_) {}
      }
      creDecisionEngine.logIntercept('session_resume', 'User requesting session resume — routing to resume handler', {
        sessionId: context.sessionId,
      });
      const result = await handleResumeRequest(input, context, setHandoffState);
      if (result.handled) {
        if (result.pendingChoice) {
          context.sessionState.pendingResumeChoice = result.pendingChoice;
        }
        return {
          handled: true,
          response: systemResponse(result.content, mode, {
            sessionResume: true,
            pendingChoice: result.pendingChoice || null,
          }),
        };
      }
    }

    if (resumeIntent === 'progress') {
      creDecisionEngine.logIntercept('progress_inquiry', 'User asking about progress — routing to progress handler', {
        sessionId: context.sessionId,
      });
      const result = handleProgressRequest();
      if (result.handled) {
        return { handled: true, response: systemResponse(result.content, mode, { progressInquiry: true }) };
      }
    }

    // Numeric session selection after resume list
    if (context.sessionState?.pendingResumeChoice) {
      const num = parseInt(input.trim());
      if (!isNaN(num) && num >= 1) {
        const choices = context.sessionState.pendingResumeChoice;
        const idx = num - 1;
        if (idx < choices.length) {
          const { restoreSession } = await import('./session-resume.js');
          const result = await restoreSession(
            context.sessionId, choices[idx].sessionId, setHandoffState,
          );
          delete context.sessionState.pendingResumeChoice;
          return { handled: true, response: systemResponse(result.message, mode, { sessionResume: true }) };
        }
      }
      delete context.sessionState.pendingResumeChoice;
    }

    return { handled: false };
  },
});

// 3. TODO WORKFLOW — all modes
intercepts.push({
  name: 'todo_workflow',
  modes: ['*'],
  async fn(input, context, mode) {
    const todoCmd = parseTodoCommand(input);
    if (!todoCmd.type) return { handled: false };
    const projectId = context.project?.id || null;
    const result = todoCmd.type === 'todo'
      ? handleTodo(todoCmd.text, projectId)
      : handleDone(todoCmd.text, projectId);
    if (result.handled) {
      return { handled: true, response: systemResponse(result.content, mode, { todoCommand: todoCmd.type }) };
    }
    return { handled: false };
  },
});

// 4. BUILD HANDOFF — all modes
intercepts.push({
  name: 'build_handoff',
  modes: ['*'],
  async fn(input, context, mode) {
    const activeHandoff = getActiveBuildHandoff ? getActiveBuildHandoff(context.sessionId) : null;
    if (!activeHandoff) return { handled: false };

    if (typeof context.onSystemStep === 'function') {
      try { context.onSystemStep('build_handoff', `phase: ${activeHandoff.phase}`, 2); } catch (_) {}
    }
    creDecisionEngine.logIntercept('build_handoff', `Active build handoff (phase: ${activeHandoff.phase}) — routing to build handler [${mode}]`, {
      sessionId: context.sessionId, phase: activeHandoff.phase,
    });

    if (/^(zrušit?|cancel|stop|zpět|back)\s*[!.]?$/i.test(input.trim())) {
      cancelBuildHandoff(context.sessionId);
      return { handled: true, response: systemResponse(cancelMessage('Build', mode), mode, { buildCancelled: true }) };
    }

    switch (activeHandoff.phase) {
      case 'PROPOSED': {
        const isYes = /^(ano|jo|ok|yes|jdi|jasně?|sure|build|stavět|start)\s*[!.]?$/i.test(input.trim());
        const isNo = /^(ne|no|nechci|cancel|zrušit?)\s*[!.]?$/i.test(input.trim());
        if (isYes) return { handled: true, response: await handleBuildConfirmed(input, context) };
        if (isNo) {
          cancelBuildHandoff(context.sessionId);
          return { handled: true, response: systemResponse('OK, zůstáváme v chatu.', mode, { buildCancelled: true }) };
        }
        return { handled: true, response: systemResponse('Chceš spustit Planner pipeline? (ano/ne)', mode, { buildConfirmation: true }, 0.9) };
      }
      case 'CLARIFYING':
        return { handled: true, response: await handleClarificationAnswer(input, context) };
      case 'PLAN_REVIEW':
        return { handled: true, response: await handlePlanVerdict(input, context) };
      case 'EXECUTING':
        return { handled: true, response: systemResponse('Pipeline právě běží, počkej na výsledek...', mode, { pipelineRunning: true }, 0.9) };
      default:
        cancelBuildHandoff(context.sessionId);
        return { handled: false };
    }
  },
});

// 5. C4 LIFECYCLE AUTO-DETECT — all modes
intercepts.push({
  name: 'c4_lifecycle_autodetect',
  modes: ['*'],
  async fn(input, context, _mode) {
    if (!getActiveLifecycleHandoff || getActiveLifecycleHandoff(context.sessionId)) return { handled: false };
    const projectId = context.project?.id || context.projectId;
    if (!projectId || config.features.lifecycle === false) return { handled: false };

    try {
      const { getLcStateByProject, setLcState: setLcS, bindSessionToLifecycle: bindS } =
          await import('./lifecycle-state.js');

      // A) RAM lookup
      const existing = getLcStateByProject(projectId);
      if (existing && existing.state.phase !== 'COMPLETED' && existing.state.phase !== 'FAILED') {
        setLcS(context.sessionId, { ...existing.state });
        if (existing.state.lifecycleId) bindS(context.sessionId, existing.state.lifecycleId);
        logger.info('PreHandler', `C4: Lifecycle state migrated from ${existing.sessionId} to ${context.sessionId} for project ${projectId}`);
      } else {
        // B) DB fallback
        const { lifecycles: lcRepo, lifecycleHandoffState: lhsRepo, projects: projRepo } = await import('../../db/database.js');
        const activeLc = lcRepo.findActiveByProject.get(projectId);
        if (activeLc && activeLc.phase !== 'COMPLETED' && activeLc.phase !== 'FAILED') {
          const prev = activeLc.active_session_id && lhsRepo
            ? lhsRepo.findBySession.get(activeLc.active_session_id) : null;
          let resolvedPath = context.project?.path || prev?.project_path;
          if (!resolvedPath) {
            const proj = projRepo.findById.get(projectId);
            if (proj?.path) resolvedPath = proj.path;
          }
          setLcS(context.sessionId, {
            phase: activeLc.phase,
            lifecycleId: activeLc.id,
            currentMilestoneId: prev?.current_milestone_id || null,
            originalRequest: prev?.original_request || '',
            projectId: activeLc.project_id,
            projectPath: resolvedPath,
          });
          bindS(context.sessionId, activeLc.id);
          logger.info('PreHandler', `C4: Auto-detected active lifecycle ${activeLc.id} for project ${projectId}`);
        }
      }
    } catch (err) {
      logger.debug('PreHandler', `Lifecycle auto-detect: ${err.message}`);
    }
    return { handled: false }; // never short-circuits — just sets state
  },
});

// 6. POST-LIFECYCLE CONTEXT — all modes
intercepts.push({
  name: 'post_lifecycle_context',
  modes: ['*'],
  async fn(input, context, _mode) {
    if (!context.hasActiveProject || !context.project?.id) return { handled: false };
    try {
      const { projectMemory } = await import('../../db/database.js');
      const lcPhase = projectMemory.get.get(context.project.id, 'lifecycle_phase');
      if (lcPhase?.value === 'COMPLETED' && !context.sessionState?.projectGoal) {
        const lcSummary = projectMemory.get.get(context.project.id, 'lifecycle_summary');
        if (lcSummary?.value) {
          context.sessionState.setProjectGoal('Dokončený lifecycle projekt. ' + lcSummary.value.slice(0, 500));
          logger.debug('PreHandler', `Post-lifecycle context injected for project ${context.project.id}`);
        }
      }
    } catch (_) { /* non-fatal */ }
    return { handled: false };
  },
});

// 7. LIFECYCLE HANDOFF — all modes
intercepts.push({
  name: 'lifecycle_handoff',
  modes: ['*'],
  async fn(input, context, mode) {
    const activeLifecycle = getActiveLifecycleHandoff ? getActiveLifecycleHandoff(context.sessionId) : null;
    if (!activeLifecycle) return { handled: false };

    if (typeof context.onSystemStep === 'function') {
      try { context.onSystemStep('lifecycle', `phase: ${activeLifecycle.phase}`, 2); } catch (_) {}
    }
    creDecisionEngine.logIntercept('lifecycle_handoff', `Active lifecycle handoff — routing to lifecycle handler [${mode}]`, {
      sessionId: context.sessionId, phase: activeLifecycle.phase,
    });

    if (/^(zru[sš]it?|cancel|stop)\s*[!.]?$/i.test(input.trim())) {
      cancelLifecycleHandoff(context.sessionId);
      return { handled: true, response: systemResponse(cancelMessage('Lifecycle', mode), mode, { lifecycleCancelled: true }) };
    }

    const lcResult = await handleLifecycleInput(input, context);
    if (lcResult) return { handled: true, response: lcResult };
    return { handled: false };
  },
});

// 8. AGENT WIZARD — CONVERSATION only
intercepts.push({
  name: 'agent_wizard',
  modes: ['CONVERSATION'],
  async fn(input, context, mode) {
    const activeWiz = getActiveWizard ? getActiveWizard(context.sessionId) : null;
    if (!activeWiz) return { handled: false };

    if (typeof context.onSystemStep === 'function') {
      try { context.onSystemStep('agent_wizard', `step: ${activeWiz.step}`, 2); } catch (_) {}
    }
    creDecisionEngine.logIntercept('agent_wizard', 'Active agent wizard — routing to wizard handler', {
      sessionId: context.sessionId, wizardStep: activeWiz.step,
    });

    if (/^(zru[sš]it?|cancel|stop|zp[eě]t|back)\s*[!.]?$/i.test(input.trim())) {
      cancelWizard(context.sessionId);
      return { handled: true, response: systemResponse(cancelMessage('Wizard', mode), mode, { wizardCancelled: true }) };
    }

    return { handled: true, response: await handleWizardInput(input, context) };
  },
});

// 9. SKILL CONFIRMATION — all modes
intercepts.push({
  name: 'skill_confirmation',
  modes: ['*'],
  async fn(input, context, _mode) {
    if (!handleSkillConfirmation) return { handled: false };
    const skillResult = await handleSkillConfirmation(input, context);
    if (skillResult) return { handled: true, response: skillResult };
    return { handled: false };
  },
});

// 10. ATTACHMENT GUARD — all modes
intercepts.push({
  name: 'attachment_guard',
  modes: ['*'],
  async fn(input, context, _mode) {
    if (!context.attachments || context.attachments.length === 0) return { handled: false };

    const fileRefPattern = /analyzuj|vysvětli|vysvětl|rozbor|co\s+dělá|co\s+obsahuje|co\s+je\s+v|popi[sš]|shrň|závislost|identifikuj|explain|analy[zs]|what\s+does|what\s+is\s+(in|this)|descri|summar|look\s+at/i;
    if (!fileRefPattern.test(input)) return { handled: false };

    const attachNames = context.attachments.map(a => a.name).join(', ');
    logger.info('PreHandler', `Attachment guard → FILE_EXPLAIN (deterministic)`, {
      input: input.substring(0, 60), attachments: attachNames,
    });

    if (typeof context.onSystemStep === 'function') {
      try { context.onSystemStep('attachment_guard', `FILE_EXPLAIN ← ${attachNames}`); } catch (_) {}
    }

    const primaryAttachment = context.attachments[0];
    const attachDecision = creDecisionEngine.overrideDecision({
      type: DecisionType.LOCAL,
      intent: IntentType.FILE_EXPLAIN,
      source: 'attachment_guard',
      reason: `Attachment present (${attachNames}) + file-reference query → deterministic FILE_EXPLAIN`,
      confidence: 0.95,
      metadata: {
        hasAttachments: true,
        attachmentCount: context.attachments.length,
        attachmentNames: attachNames,
        filePath: primaryAttachment.name,
        handler: 'file.explain',
      },
    });

    return { handled: true, response: await handleFileDecision(input, attachDecision, context) };
  },
});

// ─── Main pre-handler function ───────────────────────────────────────────────

/**
 * Run shared intercept chain before mode-specific handler logic.
 *
 * @param {string} input - User message
 * @param {Object} context - Full handler context
 * @param {'CONVERSATION'|'PROJECT'|'EXPERTISE'} mode - Handler mode
 * @returns {Promise<{ handled: boolean, response?: TaggedResponse }>}
 */
export async function preHandle(input, context, mode) {
  await _initModules();

  for (const intercept of intercepts) {
    // Mode filter: ['*'] matches all, otherwise check specific mode
    if (!intercept.modes.includes('*') && !intercept.modes.includes(mode)) continue;

    try {
      const result = await intercept.fn(input, context, mode);
      if (result.handled) {
        logger.debug('PreHandler', `Intercept "${intercept.name}" handled request [${mode}]`);
        return result;
      }
    } catch (err) {
      logger.warn('PreHandler', `Intercept "${intercept.name}" failed: ${err.message}`);
      // Non-fatal — continue to next intercept
    }
  }

  return { handled: false };
}

// ─── Exports for handlers that need direct access ────────────────────────────
// These are needed by conversation.js for post-CRE logic (wizard trigger, skill detection)

export { getActiveBuildHandoff, getActiveLifecycleHandoff, getActiveWizard, setHandoffState };
