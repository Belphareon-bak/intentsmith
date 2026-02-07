// Planner Module — Planning & Workflow Intelligence
// ══════════════════════════════════════════════════════════════════════════════
//
// ARCHITECTURE ROLE: Agent #2 (Planner / LLM-B)
//
// Contains:
//   - WorkflowOrchestrator: D1→CODE→R2→D2/R1 pipeline
//   - Plan types and status definitions
//
// Workflow:
//   User Request → D1 Analyze → [CLARIFY?] → D1 Plan → [Approve?]
//   → CODE Implement → R2 Quick Review → [PASS→R1 / FAIL→D2+CODE loop]
//   → R1 Final Review → [PASS→✅ / FAIL→D2 loop / REDESIGN→D1 loop]
//
// Phase C: DB-backed singleton with session persistence + resume + progress.
//
// ══════════════════════════════════════════════════════════════════════════════

export {
  WorkflowOrchestrator,
  WorkflowSession,
  WorkflowState,
  ReviewVerdict,
} from './workflow.js';

import { WorkflowOrchestrator } from './workflow.js';
import { workflowSessions } from '../db/database.js';

// DB-backed singleton (replaces the no-DB default from workflow.js)
export const workflowOrchestrator = new WorkflowOrchestrator({ db: workflowSessions });
