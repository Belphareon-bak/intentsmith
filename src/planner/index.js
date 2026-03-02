// Planner Module — Planning & Workflow Intelligence
// ══════════════════════════════════════════════════════════════════════════════
//
// ARCHITECTURE ROLE: Agent #2 (Planner / LLM-B)
//
// Contains:
//   - WorkflowOrchestrator: D1→CODE→R2→D2/R1 pipeline (per-task execution)
//   - ProjectLifecycle: Full project lifecycle (SPEC→PLANNING→BUILD→REVIEW)
//   - Plan types and status definitions
//
// v61: Lifecycle system added (Phase C — Collaborative Milestone Execution)
//
// ══════════════════════════════════════════════════════════════════════════════

// ─── Workflow (existing) ─────────────────────────────────────────────────────

export {
  WorkflowOrchestrator,
  WorkflowSession,
  WorkflowState,
  ReviewVerdict,
  callLLM,
  parseJSON,
} from './workflow.js';

import { WorkflowOrchestrator } from './workflow.js';
import { workflowSessions } from '../db/database.js';

// Phase C2: Progress tracker with time estimates and formatting
export {
  formatProgress,
  formatSessionSummary,
  formatDetailedProgress,
  estimateRemainingTime,
  buildProgressApiResponse,
} from './progress-tracker.js';

// ─── Lifecycle (v61 — Phase C) ──────────────────────────────────────────────

export {
  ProjectPhase,
  MilestoneStatus,
  CheckpointMode,
  ChangeRequestStatus,
  ProjectLifecycle,
} from './lifecycle.js';

export { validateSpec } from './lifecycle-spec.js';
export { validateDependencies, checkDependencies } from './lifecycle-planning.js';
export { validateMilestoneSize, suggestMilestoneSplit, estimateContextTokens } from './milestone-size.js';
export { startNextMilestone, approveMilestonePlan, handleMilestoneBlocked, getBuildProgress } from './lifecycle-build.js';
export { DriftCheckType, getDriftHistory, getAggregateHealth } from './lifecycle-review.js';
export { validatePreservation, rejectChange, listChangeRequests } from './lifecycle-change.js';
export { computeLifecycleProgress, formatLifecycleProgress, formatMilestoneTable, formatHealthScoreHistory } from './lifecycle-progress.js';

// ─── Singletons ──────────────────────────────────────────────────────────────

// DB-backed workflow orchestrator (replaces the no-DB default from workflow.js)
export const workflowOrchestrator = new WorkflowOrchestrator({ db: workflowSessions });
