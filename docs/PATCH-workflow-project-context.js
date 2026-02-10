// ══════════════════════════════════════════════════════════════════════════════
// INTEGRATION PATCH: planner/workflow.js — Project Context Injection (Phase C)
// ══════════════════════════════════════════════════════════════════════════════
//
// This patch enhances the workflow pipeline to:
//   1. Link sessions to projects on start()
//   2. Inject project context into D1/CODE prompts
//   3. Record decisions and blockers in project memory
//   4. Add timeline events at key transitions
//
// WHERE: planner/workflow.js
// ══════════════════════════════════════════════════════════════════════════════

// ADD import at top:
//
//   import { getProjectContextManager } from './project-context.js';

// ─── PATCH 1: start() — link session to project ────────────────────────────
//
// In the start() method, after creating the session and before _d1Analyze:
//
//     // Phase C: link to project
//     const projectCtx = getProjectContextManager();
//     if (projectCtx) {
//       const project = projectCtx.resolveProject(request, context?.projectId);
//       if (project) {
//         session.projectId = project.id;
//         projectCtx.linkSessionToProject(session.id, project.id);
//         projectCtx.addTimelineEvent(project.id, 'Workflow started', request.slice(0, 100));
//       }
//     }

// ─── PATCH 2: _d1Analyze / _createPlan — inject context ────────────────────
//
// In the _buildD1Prompt() or equivalent prompt builder, append project context:
//
//     // Phase C: project context injection
//     const projectCtx = getProjectContextManager();
//     if (projectCtx && session.projectId) {
//       const ctxPrompt = projectCtx.buildContextPrompt(session.projectId);
//       if (ctxPrompt) {
//         systemPrompt += '\n\n--- PROJECT CONTEXT ---\n' + ctxPrompt;
//       }
//     }

// ─── PATCH 3: _recordResult() — store decisions ────────────────────────────
//
// After recording a step result in history, also store in project memory:
//
//     // Phase C: record in project memory
//     if (session.projectId) {
//       const projectCtx = getProjectContextManager();
//       if (projectCtx) {
//         if (result.verdict) {
//           projectCtx.recordDecision(session.projectId, session.id, result.step, result.verdict);
//         }
//         if (result.verdict === 'FAIL' && result.output?.issues) {
//           for (const issue of result.output.issues) {
//             projectCtx.recordBlocker(session.projectId, session.id, issue.description, issue.severity);
//           }
//         }
//       }
//     }

// ─── PATCH 4: State transitions — timeline events ──────────────────────────
//
// In _transitionState() or at key points:
//
//     if (session.projectId) {
//       const projectCtx = getProjectContextManager();
//       const msg = `State: ${oldState} → ${newState}`;
//       projectCtx?.addTimelineEvent(session.projectId, msg);
//     }

// ─── PATCH 5: WorkflowSession — add projectId field ────────────────────────
//
// In WorkflowSession constructor:
//
//     this.projectId = null;  // Phase C: linked project
//
// In _hydrateSession():
//
//     session.projectId = row.project_id || null;

// ══════════════════════════════════════════════════════════════════════════════
// NOTE: These patches are intentionally minimal — they add project awareness
// without changing the core D1→CODE→R2→R1 pipeline logic.
// ══════════════════════════════════════════════════════════════════════════════
