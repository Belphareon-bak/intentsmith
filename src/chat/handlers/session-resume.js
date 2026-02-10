// Session Resume Handler — Multi-Session Project Continuity (Phase C1)
// ══════════════════════════════════════════════════════════════════════════════
//
// PROBLEM: Workflow sessions survive in DB, but handoff state (RAM Map) is lost
//          when server restarts or user opens a new chat session.
//
// SOLUTION: When user says "pokračuj kde jsme skončili" / "continue":
//   1. Detect resume intent (patterns below)
//   2. Query DB for active workflow sessions
//   3. Restore handoff state in build-handoff.js Map
//   4. Return formatted summary to user
//
// INTEGRATION: Called from conversation.js BEFORE CRE routing.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../../core/logger.js';
import { workflowOrchestrator, WorkflowState } from '../../planner/index.js';
import { formatProgress, formatSessionSummary } from '../../planner/progress-tracker.js';

// ─── Resume detection patterns ──────────────────────────────────────────────

const RESUME_PATTERNS = [
  // Czech: direct resume requests
  /pokračuj(?:\s+(?:kde|v|s|tam))?\s*(?:jsme|jsem)?\s*(?:skončil[iya]?|přestal[iya]?|zůstal[iya]?)?/i,
  /pokračovat\s+(?:v|s|na)\s+(?:projektu|práci|stavbě)/i,
  /vrať\s+se\s+k\s+(?:projektu|práci|stavbě|plánu)/i,
  /kde\s+jsme\s+(?:skončil[iya]?|přestal[iya]?|zůstal[iya]?)/i,
  /(?:obnov|obnovit)\s+(?:session|sezení|projekt)/i,
  /(?:chci|chceme)\s+pokračovat/i,
  /na\s+čem\s+jsme\s+(?:pracoval[iya]?|dělal[iya]?)/i,
  /co\s+(?:jsme|jsem)\s+(?:stavěl[iya]?|dělal[iya]?)\s+(?:minule|včera|naposledy)/i,
  /zpět\s+k\s+(?:projektu|buildu|stavbě)/i,

  // English: direct resume requests
  /continue\s+(?:where\s+we\s+left\s+off|from\s+where\s+we\s+stopped|building|the\s+project)/i,
  /resume\s+(?:the\s+)?(?:project|session|build|pipeline|work)/i,
  /pick\s+up\s+where\s+we\s+left\s+off/i,
  /(?:get\s+)?back\s+to\s+(?:the\s+)?(?:project|build|work)/i,
  /what\s+were\s+we\s+(?:building|working\s+on|doing)/i,
  /where\s+did\s+we\s+leave\s+off/i,
  /(?:restore|reload)\s+(?:the\s+)?(?:session|project|workflow)/i,
];

// Progress inquiry (not resume, just status check)
const PROGRESS_PATTERNS = [
  // Czech
  /(?:jaký|jaká)\s+je\s+(?:stav|progres|postup)\s+(?:projektu|buildu|pipeline)/i,
  /(?:jak|kolik)\s+(?:daleko|procent)\s+(?:je|jsme)\s+(?:s\s+)?(?:projektem|buildem)/i,
  /(?:ukaž|zobraz)\s+(?:stav|progres|postup)\s+(?:projektu|pipeline)/i,

  // English
  /(?:show|display|what(?:'s|\s+is))\s+(?:the\s+)?(?:project\s+)?(?:progress|status|state)/i,
  /how\s+(?:far|much)\s+(?:along\s+)?(?:is|are)\s+(?:the\s+)?(?:project|build|we)/i,
  /(?:pipeline|build|project)\s+(?:progress|status)/i,
];

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Check if input is a resume/progress request.
 * @returns {'resume'|'progress'|null}
 */
export function detectResumeIntent(input) {
  const trimmed = input.trim();

  for (const pattern of RESUME_PATTERNS) {
    if (pattern.test(trimmed)) return 'resume';
  }
  for (const pattern of PROGRESS_PATTERNS) {
    if (pattern.test(trimmed)) return 'progress';
  }

  return null;
}

/**
 * Find active workflow sessions from DB.
 * Returns sessions in interactive states that can be resumed.
 */
export function findResumableSessions() {
  const sessions = workflowOrchestrator.listSessions({ activeOnly: true });

  // Categorize by resumability
  const resumable = [];
  const interrupted = [];

  for (const s of sessions) {
    const state = s.state;
    if (state === WorkflowState.AWAITING_APPROVAL ||
        state === WorkflowState.CLARIFYING) {
      resumable.push(s);
    } else if (state !== WorkflowState.COMPLETED &&
               state !== WorkflowState.FAILED &&
               state !== WorkflowState.IDLE) {
      interrupted.push(s);
    }
  }

  return { resumable, interrupted, total: sessions.length };
}

/**
 * Restore a workflow session into the build-handoff state Map.
 * This bridges the gap between DB persistence and RAM-based handoff tracking.
 *
 * @param {string} chatSessionId - Current chat session ID
 * @param {string} workflowSessionId - Workflow session to restore
 * @param {Function} setHandoffStateFn - build-handoff.js setHandoffState
 * @returns {Object} Resume result with formatted message
 */
export async function restoreSession(chatSessionId, workflowSessionId, setHandoffStateFn) {
  try {
    const result = await workflowOrchestrator.resume(workflowSessionId);

    if (!result) {
      return { success: false, message: 'Session nebyla nalezena.' };
    }

    // Map workflow state to handoff phase
    const phaseMap = {
      [WorkflowState.AWAITING_APPROVAL]: 'PLAN_REVIEW',
      [WorkflowState.CLARIFYING]: 'CLARIFYING',
      [WorkflowState.IMPLEMENTING]: 'EXECUTING',
      [WorkflowState.QUICK_REVIEWING]: 'EXECUTING',
      [WorkflowState.FIX_DELIBERATING]: 'EXECUTING',
      [WorkflowState.APPLYING_FIX]: 'EXECUTING',
      [WorkflowState.FINAL_REVIEWING]: 'EXECUTING',
      [WorkflowState.REDESIGNING]: 'EXECUTING',
    };

    const phase = phaseMap[result.state];

    if (phase) {
      // Restore handoff state in RAM
      setHandoffStateFn(chatSessionId, {
        phase,
        workflowSessionId,
        originalRequest: result.plan?.title || 'Obnovená session',
        plan: result.plan || null,
        clarificationQuestions: result.questions || [],
        restored: true,
        restoredAt: new Date().toISOString(),
      });

      logger.info('SessionResume', 'Session restored', {
        chatSessionId,
        workflowSessionId,
        state: result.state,
        phase,
      });
    }

    // Format human-readable response
    const progress = workflowOrchestrator.getProgress(workflowSessionId);
    const message = formatResumeMessage(result, progress);

    return {
      success: true,
      message,
      state: result.state,
      phase: phase || null,
      sessionId: workflowSessionId,
      needsInput: phase === 'PLAN_REVIEW' || phase === 'CLARIFYING',
    };
  } catch (err) {
    logger.error('SessionResume', `Restore failed: ${err.message}`);
    return { success: false, message: `Nepodařilo se obnovit session: ${err.message}` };
  }
}

/**
 * Handle a resume request from the user.
 * Finds the most recent resumable session and restores it.
 */
export async function handleResumeRequest(input, context, setHandoffStateFn) {
  const { resumable, interrupted, total } = findResumableSessions();

  // No active sessions
  if (total === 0) {
    return {
      handled: true,
      content: '📋 Nemáš žádné aktivní projekty.\n\n' +
        'Řekni mi co chceš postavit a spustíme nový projekt přes Planner pipeline.',
    };
  }

  // No resumable (but some interrupted)
  if (resumable.length === 0 && interrupted.length > 0) {
    const list = interrupted.map((s, i) =>
      `  ${i + 1}. **${s.planTitle || s.request?.slice(0, 60) || 'Bez názvu'}** — ` +
      `stav: \`${s.state}\` (přerušeno)`
    ).join('\n');

    return {
      handled: true,
      content: `⚠️ Nalezeno ${interrupted.length} přerušených sessions:\n\n${list}\n\n` +
        'Tyto sessions byly přerušeny uprostřed pipeline a nelze je obnovit.\n' +
        'Můžeš spustit nový build se stejným zadáním.',
    };
  }

  // Single resumable — auto-resume
  if (resumable.length === 1) {
    const session = resumable[0];
    const result = await restoreSession(
      context.sessionId,
      session.sessionId,
      setHandoffStateFn,
    );
    return { handled: true, content: result.message };
  }

  // Multiple resumable — let user pick
  const list = resumable.map((s, i) =>
    `  ${i + 1}. **${s.planTitle || s.request?.slice(0, 60) || 'Bez názvu'}** — ` +
    `stav: \`${s.state}\` (${s.updatedAt?.slice(0, 10) || '?'})`
  ).join('\n');

  return {
    handled: true,
    content: `📋 Nalezeno ${resumable.length} obnovitelných sessions:\n\n${list}\n\n` +
      'Napiš číslo session, kterou chceš obnovit (1, 2, ...).',
    pendingChoice: resumable,
  };
}

/**
 * Handle a progress inquiry from the user.
 */
export function handleProgressRequest() {
  const sessions = workflowOrchestrator.listSessions({ activeOnly: false });

  if (sessions.length === 0) {
    return {
      handled: true,
      content: '📋 Žádné workflow sessions. Spusť nový projekt příkazem pro build.',
    };
  }

  // Show last 5 sessions
  const recent = sessions.slice(0, 5);
  const lines = recent.map(s => {
    const progress = workflowOrchestrator.getProgress(s.sessionId);
    return formatSessionSummary(s, progress);
  });

  return {
    handled: true,
    content: `📊 **Přehled projektů** (posledních ${recent.length}):\n\n${lines.join('\n\n')}`,
  };
}

// ─── Formatting ─────────────────────────────────────────────────────────────

function formatResumeMessage(result, progress) {
  const parts = [];

  if (result.state === WorkflowState.AWAITING_APPROVAL) {
    parts.push('🔄 **Session obnovena — čekám na schválení plánu.**\n');
    if (result.plan) {
      parts.push(`📐 **Plán: ${result.plan.title || 'Bez názvu'}**`);
      if (result.plan.steps?.length) {
        parts.push(`Kroky (${result.plan.steps.length}):`);
        for (const step of result.plan.steps.slice(0, 5)) {
          parts.push(`  • ${step.name || step.description || JSON.stringify(step).slice(0, 80)}`);
        }
        if (result.plan.steps.length > 5) {
          parts.push(`  ... a ${result.plan.steps.length - 5} dalších`);
        }
      }
      parts.push('\n**Schválit?** (ano / ne / [feedback])');
    }
  } else if (result.state === WorkflowState.CLARIFYING) {
    parts.push('🔄 **Session obnovena — čekám na upřesnění.**\n');
    if (result.questions?.length) {
      parts.push('D1 potřebuje odpovědi na:');
      for (const q of result.questions) {
        parts.push(`  ❓ ${q}`);
      }
    }
  } else if (result.state === WorkflowState.COMPLETED) {
    parts.push('✅ **Session je dokončena.**');
    if (result.plan) parts.push(`Plán: ${result.plan.title || 'N/A'}`);
  } else if (result.state === WorkflowState.FAILED) {
    parts.push('❌ **Session selhala.**');
    parts.push(result.message || '');
  } else {
    parts.push(`ℹ️ **Session:** ${result.message}`);
  }

  if (progress) {
    parts.push('');
    parts.push(formatProgress(progress));
  }

  return parts.filter(Boolean).join('\n');
}

// ─── Server startup: preload active sessions into RAM cache ─────────────────

/**
 * Call on server startup to warm the RAM cache with active workflow sessions.
 * This ensures getSession() doesn't have to hit DB on first access.
 */
export function preloadActiveSessions() {
  try {
    const active = workflowOrchestrator.listSessions({ activeOnly: true });
    for (const s of active) {
      // getSession triggers DB hydration into RAM cache
      workflowOrchestrator.getSession(s.sessionId);
    }
    if (active.length > 0) {
      logger.info('SessionResume', `Preloaded ${active.length} active workflow sessions`);
    }
    return active.length;
  } catch (err) {
    logger.debug('SessionResume', `Preload failed: ${err.message}`);
    return 0;
  }
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  detectResumeIntent,
  findResumableSessions,
  restoreSession,
  handleResumeRequest,
  handleProgressRequest,
  preloadActiveSessions,
};
