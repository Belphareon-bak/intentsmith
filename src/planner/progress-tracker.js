// Progress Tracker — Enhanced Project Progress (Phase C2)
// ══════════════════════════════════════════════════════════════════════════════
//
// Extends workflow.getProgress() with:
//   - Time estimates based on historical step durations
//   - Human-readable progress bar visualization
//   - Per-step status table
//   - Blocker formatting
//   - Project summary for dashboard / IDE panel
//
// ══════════════════════════════════════════════════════════════════════════════

import { WorkflowState } from './workflow.js';

// ─── Stage Labels (CZ + EN) ────────────────────────────────────────────────

const STAGE_LABELS = {
  cs: {
    IDLE: 'Čeká na start',
    ANALYZING: 'D1 analyzuje zadání',
    CLARIFYING: 'Čeká na upřesnění',
    PLANNING: 'D1 vytváří plán',
    AWAITING_APPROVAL: 'Čeká na schválení',
    IMPLEMENTING: 'CODE implementuje',
    QUICK_REVIEWING: 'R2 rychlá kontrola',
    FIX_DELIBERATING: 'D2 navrhuje opravy',
    APPLYING_FIX: 'CODE aplikuje opravy',
    FINAL_REVIEWING: 'R1 finální review',
    REDESIGNING: 'D1 redesign',
    COMPLETED: 'Dokončeno',
    FAILED: 'Selhalo',
  },
  en: {
    IDLE: 'Waiting to start',
    ANALYZING: 'D1 analyzing request',
    CLARIFYING: 'Awaiting clarification',
    PLANNING: 'D1 creating plan',
    AWAITING_APPROVAL: 'Awaiting approval',
    IMPLEMENTING: 'CODE implementing',
    QUICK_REVIEWING: 'R2 quick review',
    FIX_DELIBERATING: 'D2 fix deliberation',
    APPLYING_FIX: 'CODE applying fixes',
    FINAL_REVIEWING: 'R1 final review',
    REDESIGNING: 'D1 redesigning',
    COMPLETED: 'Completed',
    FAILED: 'Failed',
  },
};

// ─── Pipeline stages in order ───────────────────────────────────────────────

const PIPELINE_STAGES = [
  'D1_ANALYZE', 'D1_PLAN', 'CODE_IMPLEMENT',
  'R2_QUICK_REVIEW', 'R1_FINAL_REVIEW',
];

const STAGE_ORDER = {
  IDLE: 0, ANALYZING: 1, CLARIFYING: 1.5, PLANNING: 2,
  AWAITING_APPROVAL: 2.5, IMPLEMENTING: 3, QUICK_REVIEWING: 4,
  FIX_DELIBERATING: 3.5, APPLYING_FIX: 3.5,
  FINAL_REVIEWING: 5, REDESIGNING: 2,
  COMPLETED: 6, FAILED: -1,
};

// ─── Historical average durations (seconds) per step ────────────────────────
// These are initial estimates; will be refined from actual data.

const DEFAULT_DURATIONS = {
  D1_ANALYZE: 15,
  D1_PLAN: 30,
  D1_CLARIFY: 5,
  CODE_IMPLEMENT: 45,    // per step
  R2_QUICK_REVIEW: 20,
  D2_FIX: 25,
  CODE_FIX: 30,
  R1_FINAL_REVIEW: 25,
  D1_REDESIGN: 30,
};

// ─── Time Estimation ────────────────────────────────────────────────────────

/**
 * Estimate remaining time based on progress and historical durations.
 * Uses actual durations from session history when available.
 */
export function estimateRemainingTime(progress) {
  if (!progress) return null;
  if (progress.state === 'COMPLETED') return 0;
  if (progress.state === 'FAILED') return null;

  // Build duration map from history
  const actualDurations = {};
  for (const step of (progress.stepsCompleted || [])) {
    if (step.duration) {
      const key = step.step.replace(/_\d+$/, ''); // CODE_IMPLEMENT_3 → CODE_IMPLEMENT
      if (!actualDurations[key]) actualDurations[key] = [];
      actualDurations[key].push(step.duration);
    }
  }

  // Average actual durations
  const avgDurations = {};
  for (const [key, values] of Object.entries(actualDurations)) {
    avgDurations[key] = values.reduce((a, b) => a + b, 0) / values.length;
  }

  // Estimate remaining based on current stage
  const remainingStages = getRemainingStages(progress.state, progress.totalSteps, progress.implementedSteps);
  let totalRemaining = 0;

  for (const stage of remainingStages) {
    const key = stage.key;
    const count = stage.count || 1;
    const avg = avgDurations[key] || DEFAULT_DURATIONS[key] || 20;
    totalRemaining += avg * count;
  }

  return Math.round(totalRemaining);
}

function getRemainingStages(state, totalSteps, implementedSteps) {
  const remaining = [];
  const stepsLeft = Math.max(0, (totalSteps || 0) - (implementedSteps || 0));

  switch (state) {
    case 'ANALYZING':
      remaining.push({ key: 'D1_ANALYZE', count: 1 });
      remaining.push({ key: 'D1_PLAN', count: 1 });
      remaining.push({ key: 'CODE_IMPLEMENT', count: totalSteps || 3 });
      remaining.push({ key: 'R2_QUICK_REVIEW', count: 1 });
      remaining.push({ key: 'R1_FINAL_REVIEW', count: 1 });
      break;
    case 'CLARIFYING':
    case 'PLANNING':
      remaining.push({ key: 'D1_PLAN', count: 1 });
      remaining.push({ key: 'CODE_IMPLEMENT', count: totalSteps || 3 });
      remaining.push({ key: 'R2_QUICK_REVIEW', count: 1 });
      remaining.push({ key: 'R1_FINAL_REVIEW', count: 1 });
      break;
    case 'AWAITING_APPROVAL':
      remaining.push({ key: 'CODE_IMPLEMENT', count: totalSteps || 3 });
      remaining.push({ key: 'R2_QUICK_REVIEW', count: 1 });
      remaining.push({ key: 'R1_FINAL_REVIEW', count: 1 });
      break;
    case 'IMPLEMENTING':
      remaining.push({ key: 'CODE_IMPLEMENT', count: stepsLeft });
      remaining.push({ key: 'R2_QUICK_REVIEW', count: 1 });
      remaining.push({ key: 'R1_FINAL_REVIEW', count: 1 });
      break;
    case 'QUICK_REVIEWING':
      remaining.push({ key: 'R2_QUICK_REVIEW', count: 1 });
      remaining.push({ key: 'R1_FINAL_REVIEW', count: 1 });
      break;
    case 'FIX_DELIBERATING':
    case 'APPLYING_FIX':
      remaining.push({ key: 'D2_FIX', count: 1 });
      remaining.push({ key: 'CODE_FIX', count: 1 });
      remaining.push({ key: 'R2_QUICK_REVIEW', count: 1 });
      remaining.push({ key: 'R1_FINAL_REVIEW', count: 1 });
      break;
    case 'FINAL_REVIEWING':
      remaining.push({ key: 'R1_FINAL_REVIEW', count: 1 });
      break;
    case 'REDESIGNING':
      remaining.push({ key: 'D1_REDESIGN', count: 1 });
      remaining.push({ key: 'CODE_IMPLEMENT', count: totalSteps || 3 });
      remaining.push({ key: 'R2_QUICK_REVIEW', count: 1 });
      remaining.push({ key: 'R1_FINAL_REVIEW', count: 1 });
      break;
  }

  return remaining;
}

// ─── Formatting ─────────────────────────────────────────────────────────────

/**
 * Format progress as a compact human-readable string.
 */
export function formatProgress(progress, lang = 'cs') {
  if (!progress) return '(žádná data)';

  const labels = STAGE_LABELS[lang] || STAGE_LABELS.cs;
  const pct = progress.percentage ?? 0;
  const bar = progressBar(pct, 20);
  const stage = labels[progress.state] || progress.state;
  const remaining = estimateRemainingTime(progress);

  const parts = [
    `${bar} **${pct}%** — ${stage}`,
  ];

  // Steps info
  if (progress.totalSteps > 0) {
    parts.push(`Kroky: ${progress.implementedSteps}/${progress.totalSteps} implementováno`);
  }

  // Fix/redesign attempts
  if (progress.fixAttempts > 0) {
    parts.push(`Opravy: ${progress.fixAttempts}/${progress.maxFixAttempts}`);
  }
  if (progress.redesignAttempts > 0) {
    parts.push(`Redesign: ${progress.redesignAttempts}/${progress.maxRedesignAttempts}`);
  }

  // Time estimate
  if (remaining !== null && remaining > 0) {
    parts.push(`⏱️ ~${formatDuration(remaining)}`);
  }

  // Blockers
  if (progress.blockers?.length > 0) {
    parts.push('');
    parts.push(`⚠️ Blocker${progress.blockers.length > 1 ? 'y' : ''}:`);
    for (const b of progress.blockers.slice(0, 3)) {
      const icon = b.severity === 'error' ? '🔴' : '🟡';
      parts.push(`  ${icon} ${b.description}${b.location ? ` (${b.location})` : ''}`);
    }
    if (progress.blockers.length > 3) {
      parts.push(`  ... +${progress.blockers.length - 3} dalších`);
    }
  }

  return parts.join('\n');
}

/**
 * Format a session list item with mini-progress.
 */
export function formatSessionSummary(session, progress) {
  const pct = progress?.percentage ?? 0;
  const bar = progressBar(pct, 10);
  const title = session.planTitle || session.request?.slice(0, 50) || 'Bez názvu';
  const state = session.state;
  const date = (session.updatedAt || session.createdAt || '').slice(0, 10);

  const statusIcon = state === 'COMPLETED' ? '✅' :
                     state === 'FAILED' ? '❌' :
                     state === 'AWAITING_APPROVAL' || state === 'CLARIFYING' ? '⏸️' :
                     '🔄';

  return `${statusIcon} **${title}**\n` +
    `   ${bar} ${pct}% | \`${state}\` | ${date}` +
    (progress?.blockers?.length ? ` | ⚠️ ${progress.blockers.length} blocker${progress.blockers.length > 1 ? 's' : ''}` : '');
}

/**
 * Format a detailed progress view for IDE panel / API response.
 */
export function formatDetailedProgress(progress) {
  if (!progress) return null;

  const stepTimeline = (progress.stepsCompleted || []).map(s => ({
    step: s.step,
    duration: s.duration ? `${(s.duration / 1000).toFixed(1)}s` : '?',
    verdict: s.verdict || '—',
    timestamp: s.timestamp,
    icon: s.verdict === 'PASS' ? '✅' : s.verdict === 'FAIL' ? '❌' : '🔄',
  }));

  return {
    sessionId: progress.sessionId,
    state: progress.state,
    percentage: progress.percentage,
    currentStage: progress.currentStage,
    estimatedRemaining: estimateRemainingTime(progress),
    steps: {
      total: progress.totalSteps,
      implemented: progress.implementedSteps,
      remaining: Math.max(0, (progress.totalSteps || 0) - (progress.implementedSteps || 0)),
    },
    attempts: {
      fix: { current: progress.fixAttempts, max: progress.maxFixAttempts },
      redesign: { current: progress.redesignAttempts, max: progress.maxRedesignAttempts },
    },
    blockers: progress.blockers || [],
    timeline: stepTimeline,
    timing: {
      created: progress.createdAt,
      updated: progress.updatedAt,
      elapsed: progress.createdAt
        ? Math.round((Date.now() - new Date(progress.createdAt).getTime()) / 1000)
        : null,
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function progressBar(pct, width = 20) {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}min`;
}

// ─── API Response Builder ───────────────────────────────────────────────────

/**
 * Build a JSON response for the progress API endpoint.
 * @param {Function} getProgressFn - workflowOrchestrator.getProgress
 * @param {string} [sessionId] - Specific session, or null for all active
 */
export function buildProgressApiResponse(getProgressFn, listSessionsFn, sessionId = null) {
  if (sessionId) {
    const progress = getProgressFn(sessionId);
    if (!progress) return { error: 'Session not found', status: 404 };
    return { status: 200, data: formatDetailedProgress(progress) };
  }

  // All sessions
  const sessions = listSessionsFn({ activeOnly: false });
  const results = sessions.slice(0, 20).map(s => {
    const progress = getProgressFn(s.sessionId);
    return {
      ...s,
      progress: progress ? formatDetailedProgress(progress) : null,
    };
  });

  return { status: 200, data: results };
}

// ─── Exports ────────────────────────────────────────────────────────────────

export default {
  estimateRemainingTime,
  formatProgress,
  formatSessionSummary,
  formatDetailedProgress,
  buildProgressApiResponse,
  STAGE_LABELS,
};
