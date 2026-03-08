// Build Handoff Handler — Chat Agent → Planner Pipeline
// ══════════════════════════════════════════════════════════════════════════════
//
// ARCHITECTURE RULE: Chat NEVER calls Executor directly.
// Chat detects BUILD intent → asks user for confirmation → hands off to Planner.
//
// Flow:
//   1. CRE detects BUILD intent (DecisionType.PLAN)
//   2. Chat shows summary + asks "jít stavět?"
//   3. User confirms → Planner.start() → D1 analyzes
//   4. D1 may CLARIFY → Chat forwards answers
//   5. D1 creates plan → Chat shows plan → user approves
//   6. Planner runs D1→CODE→R2→R1 pipeline autonomously
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../../core/logger.js';
import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from '../controller.js';

// Lazy-load WorkflowState — planner is optional (Phase C)
let WorkflowState = null;
try {
  const mod = await import('../../planner/index.js');
  WorkflowState = mod.WorkflowState;
} catch (err) {
  logger.warn('BuildHandoff', `Planner not available: ${err.message}`);
}

// ─── Helper: create TaggedResponse with proper ResponseTag ──────────────────

function buildResponse(content, metadata = {}) {
  return new TaggedResponse({
    content,
    tag: new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION,
      confidence: 0.9,
      canExecute: false,
      metadata,
    }),
  });
}

// ─── Handoff State (per session) ────────────────────────────────────────────

const handoffStates = new Map();

/**
 * @typedef {Object} HandoffState
 * @property {'PROPOSED'|'CONFIRMING'|'CLARIFYING'|'PLAN_REVIEW'|'EXECUTING'|'DONE'} phase
 * @property {string|null} workflowSessionId - Planner workflow session ID
 * @property {string} originalRequest - Original user request
 * @property {Object|null} plan - Plan from D1 (when in PLAN_REVIEW)
 * @property {string[]} clarificationQuestions - D1's clarification questions
 */

function getHandoffState(sessionId) {
  return handoffStates.get(sessionId) || null;
}

function setHandoffState(sessionId, state) {
  handoffStates.set(sessionId, { ...state, updatedAt: new Date().toISOString() });
}

function clearHandoffState(sessionId) {
  handoffStates.delete(sessionId);
}

// ─── Project-scope detection heuristic ──────────────────────────────────────

/**
 * Detect whether a BUILD request is project-scope (lifecycle) vs quick build.
 *
 * Project-scope indicators:
 *   - "celý projekt/systém", "kompletní", "od specifikace", "vícero fází"
 *   - "e-shop", "full system", "from spec", "multi-phase"
 *   - Multiple component mentions (backend + frontend + DB)
 *
 * Quick build (existing path):
 *   - "postav API endpoint", "scaffoldni Express server", single component
 *
 * @param {string} input - User's original message
 * @param {Object} [decision] - CRE decision (optional, for metadata)
 * @returns {boolean} true if project-scope → lifecycle path
 */
export function isProjectScopeBuild(input, decision = null) {
  const text = input.toLowerCase();

  // Explicit lifecycle/project-scope patterns
  const PROJECT_SCOPE_PATTERNS = [
    /cel[ýé]?\s+(projekt|syst[ée]m|aplikac[ei]|stack|řešení|reseni)/i,
    /kompletn[ií]\s+(projekt|syst[ée]m|aplikac[ei]|stack|řešení|reseni|e-?shop)/i,
    /od\s+specifikace/i,
    /v[ií]cero?\s+f[áa]z[ií]/i,
    /multi-?phase/i,
    /full\s+(project|system|application|stack|solution)/i,
    /from\s+spec(ification)?/i,
    /end[- ]to[- ]end/i,
    /lifecycle/i,
    /milestone/i,
    /e-?shop/i,
    /kompletní\s+e-?/i,
    /chci\s+postavit\s+kompletn/i,
    /chci\s+postavit\s+cel/i,
    /chci\s+vybudovat/i,
    /celou\s+aplikaci/i,
    /celý\s+stack/i,
  ];

  if (PROJECT_SCOPE_PATTERNS.some(p => p.test(input))) {
    return true;
  }

  // Multi-component heuristic: if 3+ distinct component types mentioned → project-scope
  const COMPONENT_INDICATORS = [
    /\b(frontend|front[- ]end|ui|react|vue|angular|svelte)\b/i,
    /\b(backend|back[- ]end|server|api|express|fastify|nest|koa)\b/i,
    /\b(databáz[ei]|database|db|postgre(?:s|sql)?|mysql|mongo(?:db)?|redis|sqlite)\b/i,
    /\b(auth|autentikac|autentizac|authentication|authorization|login)\b/i,
    /\b(deploy|nasaz|ci\/?cd|pipeline|docker|k8s|kubernetes)\b/i,
    /\b(monitoring|logging|observability|grafana|prometheus)\b/i,
    /\b(testing|testy|e2e|unit\s+test|integration\s+test)\b/i,
  ];

  const componentCount = COMPONENT_INDICATORS.filter(p => p.test(input)).length;
  if (componentCount >= 3) {
    return true;
  }

  return false;
}

// ─── Phase 1: BUILD detected → propose handoff ─────────────────────────────

/**
 * Handle initial BUILD/PLAN decision from CRE.
 * Shows user what will happen and asks for confirmation.
 *
 * If project-scope build detected → delegates to lifecycle-handoff.js
 * Otherwise → quick build (existing Planner pipeline)
 *
 * @param {string} input - User's original message
 * @param {Object} decision - CRE decision (type: PLAN, intent: BUILD)
 * @param {Object} context - Handler context
 * @returns {TaggedResponse}
 */
export function handleBuildDetected(input, decision, context) {
  const { sessionId } = context;

  // v61: Project-scope gate — lifecycle path for complex projects
  if (isProjectScopeBuild(input, decision)) {
    logger.info('BuildHandoff', 'Project-scope BUILD → lifecycle handoff', {
      sessionId,
      input: input.substring(0, 100),
    });
    // Dynamic import to avoid circular dependency
    return import('./lifecycle-handoff.js').then(m => m.handleLifecycleBuildDetected(input, decision, context));
  }

  logger.info('BuildHandoff', 'BUILD intent detected, proposing handoff', {
    sessionId,
    input: input.substring(0, 100),
  });

  // Store handoff state
  setHandoffState(sessionId, {
    phase: 'PROPOSED',
    workflowSessionId: null,
    originalRequest: input,
    plan: null,
    clarificationQuestions: [],
  });

  // Ask user for explicit confirmation
  const summary = extractBuildSummary(input);

  return buildResponse(formatProposal(summary, input), {
      buildHandoff: true,
      phase: 'PROPOSED',
      awaitingConfirmation: true,
      originalRequest: input,
    });
}

// ─── Phase 2: User confirms → start Planner ────────────────────────────────

/**
 * Handle user's confirmation to start building.
 * Called when user says "ano"/"jo"/"jdi"/"build" after PROPOSED phase.
 *
 * @param {string} input - User's confirmation message
 * @param {Object} context - Handler context
 * @returns {Promise<TaggedResponse>}
 */
export async function handleBuildConfirmed(input, context) {
  const { sessionId } = context;
  const state = getHandoffState(sessionId);

  if (!state || state.phase !== 'PROPOSED') {
    return null; // Not in handoff flow
  }

  logger.info('BuildHandoff', 'User confirmed build, starting Planner', { sessionId });

  try {
    const { workflowOrchestrator } = await import('../../planner/index.js');
    const result = await workflowOrchestrator.start(state.originalRequest, {
      sessionId,
      source: 'chat-handoff',
    });

    // Handle D1's response
    if (result.state === WorkflowState.CLARIFYING) {
      // D1 needs more info
      setHandoffState(sessionId, {
        ...state,
        phase: 'CLARIFYING',
        workflowSessionId: result.sessionId,
        clarificationQuestions: result.questions,
      });

      return buildResponse(formatClarificationRequest(result.questions), {
          buildHandoff: true,
          phase: 'CLARIFYING',
          workflowSessionId: result.sessionId,
          questions: result.questions,
        });
    }

    if (result.state === WorkflowState.AWAITING_APPROVAL) {
      // D1 created a plan, show it to user
      setHandoffState(sessionId, {
        ...state,
        phase: 'PLAN_REVIEW',
        workflowSessionId: result.sessionId,
        plan: result.plan,
      });

      return buildResponse(formatPlanReview(result.plan), {
          buildHandoff: true,
          phase: 'PLAN_REVIEW',
          workflowSessionId: result.sessionId,
          plan: result.plan,
        });
    }

    // Unexpected state
    return buildResponse(`Planner vrátil neočekávaný stav: ${result.state}. Zkus to znovu.`);

  } catch (err) {
    logger.error('BuildHandoff', 'Planner start failed', { error: err.message });
    clearHandoffState(sessionId);

    return buildResponse(`Planner selhal: ${err.message}. Zkusíme to jinak?`);
  }
}

// ─── Phase 3: Forward clarification answers ─────────────────────────────────

/**
 * Forward user's clarification answers to Planner (D1).
 *
 * @param {string} input - User's answers
 * @param {Object} context - Handler context
 * @returns {Promise<TaggedResponse>}
 */
export async function handleClarificationAnswer(input, context) {
  const { sessionId } = context;
  const state = getHandoffState(sessionId);

  if (!state || state.phase !== 'CLARIFYING') {
    return null;
  }

  logger.info('BuildHandoff', 'Forwarding clarification to Planner', { sessionId });

  try {
    const { workflowOrchestrator } = await import('../../planner/index.js');
    const result = await workflowOrchestrator.clarify(state.workflowSessionId, input);

    if (result.state === WorkflowState.CLARIFYING) {
      // D1 needs even more info
      setHandoffState(sessionId, {
        ...state,
        clarificationQuestions: result.questions,
      });

      return buildResponse(formatClarificationRequest(result.questions), { buildHandoff: true, phase: 'CLARIFYING' });
    }

    if (result.state === WorkflowState.AWAITING_APPROVAL) {
      setHandoffState(sessionId, {
        ...state,
        phase: 'PLAN_REVIEW',
        plan: result.plan,
      });

      return buildResponse(formatPlanReview(result.plan), { buildHandoff: true, phase: 'PLAN_REVIEW', plan: result.plan });
    }

    return buildResponse(`Neočekávaný stav: ${result.state}`);

  } catch (err) {
    logger.error('BuildHandoff', 'Clarification failed', { error: err.message });
    return buildResponse(`Chyba při zpracování upřesnění: ${err.message}`);
  }
}

// ─── Phase 4: User approves/rejects plan ────────────────────────────────────

/**
 * Handle plan approval — starts the CODE→R2→R1 execution pipeline.
 *
 * @param {string} input - User's approval/rejection
 * @param {Object} context - Handler context
 * @returns {Promise<TaggedResponse>}
 */
export async function handlePlanVerdict(input, context) {
  const { sessionId } = context;
  const state = getHandoffState(sessionId);

  if (!state || state.phase !== 'PLAN_REVIEW') {
    return null;
  }

  const isApproval = /^(ano|jo|ok|yes|schvaluji?|approve|jdi|spusť|start|👍)\s*[!.]?$/i.test(input.trim())
    || /^(vypadá to dobře|looks good|lgtm)/i.test(input.trim());

  const isRejection = /^(ne|no|nechci|cancel|zrušit?|odmít|reject)/i.test(input.trim());

  if (isRejection) {
    // Extract feedback (everything after the rejection word)
    const feedback = input.replace(/^(ne|no|nechci|cancel|zrušit?|odmít|reject)\s*/i, '').trim();

    logger.info('BuildHandoff', 'User rejected plan', { sessionId, hasFeedback: !!feedback });

    try {
      const { workflowOrchestrator } = await import('../../planner/index.js');
      const result = await workflowOrchestrator.reject(state.workflowSessionId, feedback);

      if (result.state === WorkflowState.AWAITING_APPROVAL) {
        setHandoffState(sessionId, { ...state, plan: result.plan });

        return buildResponse(`D1 přepracoval plán:\n\n${formatPlanReview(result.plan)}`, { buildHandoff: true, phase: 'PLAN_REVIEW', plan: result.plan });
      }

      clearHandoffState(sessionId);
      return buildResponse(`Planner skončil ve stavu: ${result.state}. ${result.error || ''}`);
    } catch (err) {
      clearHandoffState(sessionId);
      return buildResponse(`Chyba: ${err.message}`);
    }
  }

  if (!isApproval) {
    // Not a clear yes/no — treat as feedback for plan revision
    return handlePlanFeedback(input, context);
  }

  // ─── APPROVED — start execution pipeline ──────────────────────────────
  logger.info('BuildHandoff', 'User approved plan, starting execution', { sessionId });

  setHandoffState(sessionId, { ...state, phase: 'EXECUTING' });

  try {
    const { workflowOrchestrator } = await import('../../planner/index.js');
    const result = await workflowOrchestrator.approve(state.workflowSessionId);

    if (result.state === WorkflowState.COMPLETED) {
      clearHandoffState(sessionId);

      return buildResponse(formatCompletionReport(result), {
          buildHandoff: true,
          phase: 'DONE',
          workflowSessionId: state.workflowSessionId,
          stepsExecuted: result.history?.length || 0,
        });
    }

    if (result.state === WorkflowState.FAILED) {
      clearHandoffState(sessionId);

      return buildResponse(formatFailureReport(result), { buildHandoff: true, phase: 'FAILED' });
    }

    // Still running (shouldn't happen with sync orchestrator, but safety)
    return buildResponse(`Pipeline běží... stav: ${result.state}`);

  } catch (err) {
    logger.error('BuildHandoff', 'Execution failed', { error: err.message });
    clearHandoffState(sessionId);

    return buildResponse(`Execution pipeline selhal: ${err.message}`);
  }
}

// ─── Plan feedback (not approval, not rejection — modification) ─────────────

async function handlePlanFeedback(input, context) {
  const { sessionId } = context;
  const state = getHandoffState(sessionId);

  // Treat input as modification feedback → reject with feedback → get revised plan
  try {
    const { workflowOrchestrator } = await import('../../planner/index.js');
    const result = await workflowOrchestrator.reject(state.workflowSessionId, input);

    if (result.state === WorkflowState.AWAITING_APPROVAL) {
      setHandoffState(sessionId, { ...state, plan: result.plan });

      return buildResponse(`D1 upravil plán podle tvého feedbacku:\n\n${formatPlanReview(result.plan)}`, { buildHandoff: true, phase: 'PLAN_REVIEW', plan: result.plan });
    }

    clearHandoffState(sessionId);
    return buildResponse(`Planner vrátil: ${result.state}. ${result.error || ''}`);
  } catch (err) {
    return buildResponse(`Chyba při úpravě plánu: ${err.message}`);
  }
}

// ─── Active handoff check ───────────────────────────────────────────────────

/**
 * Check if session has an active build handoff.
 * Used by conversation handler to intercept messages during handoff flow.
 *
 * @param {string} sessionId
 * @returns {HandoffState|null}
 */
export function getActiveBuildHandoff(sessionId) {
  return getHandoffState(sessionId);
}

/**
 * Cancel active handoff (user says "zrušit", "cancel", etc.)
 * @param {string} sessionId
 */
export function cancelBuildHandoff(sessionId) {
  clearHandoffState(sessionId);
  logger.info('BuildHandoff', 'Build handoff cancelled', { sessionId });
}

// ─── Formatting helpers ─────────────────────────────────────────────────────

function extractBuildSummary(input) {
  // Extract the core goal from the input
  const cleaned = input
    .replace(/^(postav|rozjeď|nasaď|deployni|scaffoldni|vytvoř|nastav|připrav)\s+(mi\s+)?/i, '')
    .replace(/^(build|set up|create|deploy|scaffold|spin up|provision)\s+(me\s+)?(a\s+)?/i, '')
    .trim();
  return cleaned || input;
}

function formatProposal(summary, originalInput) {
  return [
    `🔨 **Build intent detekován**`,
    ``,
    `Cíl: ${summary}`,
    ``,
    `Toto spustí Planner pipeline:`,
    `  D1 (deepseek-r1) → analýza a plán`,
    `  CODE (qwen3.5:27b) → implementace`,
    `  R2 → quick review → R1 → final review`,
    ``,
    `Chceš jít stavět? (ano/ne)`,
  ].join('\n');
}

function formatClarificationRequest(questions) {
  const qs = questions.map((q, i) => `  ${i + 1}. ${q}`).join('\n');
  return [
    `🤔 D1 potřebuje upřesnit zadání:`,
    ``,
    qs,
    ``,
    `Odpověz na otázky, ať může vytvořit přesný plán.`,
  ].join('\n');
}

function formatPlanReview(plan) {
  if (!plan) return 'Plán není dostupný.';

  const lines = [`📋 **Plán: ${plan.title || 'Bez názvu'}**`];

  if (plan.estimatedComplexity) {
    lines.push(`Složitost: ${plan.estimatedComplexity}`);
  }
  lines.push('');

  if (plan.steps && plan.steps.length > 0) {
    lines.push('Kroky:');
    for (const step of plan.steps) {
      const approval = step.approval ? ' ⚠️ (vyžaduje schválení)' : '';
      lines.push(`  ${step.id}. [${step.type || '?'}] ${step.action || step.detail || '?'}${approval}`);
    }
    lines.push('');
  }

  if (plan.risks && plan.risks.length > 0) {
    lines.push(`Rizika: ${plan.risks.join(', ')}`);
    lines.push('');
  }

  lines.push('Schválíš plán? (ano/ne, nebo napiš feedback pro úpravu)');

  return lines.join('\n');
}

function formatCompletionReport(result) {
  const steps = result.history?.length || 0;
  const lines = [
    `✅ **Build dokončen**`,
    ``,
    `Plán: ${result.plan?.title || '?'}`,
    `Kroků provedeno: ${steps}`,
    `Kvalita: ${result.quality || 'approved'}`,
  ];

  // Show implementation summary (not full code)
  if (result.implementation && Array.isArray(result.implementation)) {
    lines.push('');
    lines.push('Výstupy:');
    for (const impl of result.implementation) {
      lines.push(`  ${impl.stepId}. ${impl.action || '?'} — ✅`);
    }
  }

  return lines.join('\n');
}

function formatFailureReport(result) {
  return [
    `❌ **Build selhal**`,
    ``,
    `Důvod: ${result.error || 'Neznámá chyba'}`,
    `Fix pokusy: ${result.fixAttempts || '?'}`,
    ``,
    `Chceš to zkusit znovu s jiným zadáním?`,
  ].join('\n');
}

export { setHandoffState };

export default {
  isProjectScopeBuild,
  handleBuildDetected,
  handleBuildConfirmed,
  handleClarificationAnswer,
  handlePlanVerdict,
  getActiveBuildHandoff,
  cancelBuildHandoff,
  setHandoffState,
};
