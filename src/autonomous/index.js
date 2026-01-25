// CRE v39.x Autonomous Mode Index
// ══════════════════════════════════════════════════════════════════════════════
//
// LAYER 4 — AUTONOMOUS MODE
//
// v39.0: Goal Persistence
//   - GoalStore: Persistent goal storage
//   - GoalScheduler: Scheduling and queue management
//   - GoalRunner: Goal execution engine
//
// v39.0.1 Hotfix:
//   - Separate staticContext vs dynamicContext in GoalStore
//   - Per-goal sandboxMode support
//
// v39.1: Safe Autonomy
//   - SafetyLimits: Global safety constraints
//   - Sandbox: Isolated execution environment
//   - AuditLog: Comprehensive audit trail
//
// v39.1.1 Hotfix:
//   - SandboxManager: Per-goal sandbox instances
//
// v39.2: Self-Correction
//   - FailureAnalyzer: Failure classification and learning
//   - CorrectionStrategy: Correction action selection
//
// v39.2.1 Hotfix:
//   - FailureHistory: Global failure tracking
//   - Correction loop prevention
//
// v39.3: Local Copilot Mode
//   - CopilotContext: Working context maintenance
//   - SuggestionEngine: Proactive suggestions
//
// v39.3.1 Hotfix:
//   - SuggestionEngine connected to GoalStore and FailureHistory
//   - Goal-aware suggestions
//   - Failure-aware filtering
//
// ══════════════════════════════════════════════════════════════════════════════

// v39.0: Goal Persistence
export {
  GoalStatus, GoalPriority, GoalTrigger,
  GoalStore, goalStore, createGoal,
} from './goal-store.js';

export {
  DEFAULT_SCHEDULER_LIMITS,
  GoalScheduler, goalScheduler, parseSchedule,
} from './goal-scheduler.js';

export {
  GoalExecutionResult,
  GoalRunner, goalRunner,
} from './goal-runner.js';

// v39.1: Safe Autonomy
export {
  DEFAULT_SAFETY_LIMITS, LimitViolation,
  SafetyLimits, safetyLimits,
} from './safety-limits.js';

export {
  SandboxMode, SandboxViolation, DEFAULT_SANDBOX_RESTRICTIONS,
  Sandbox, sandbox,
  SandboxManager, sandboxManager,  // v39.1.1
} from './sandbox.js';

export {
  AuditEventType, AuditSeverity,
  AuditLog, auditLog,
} from './audit.js';

// v39.2: Self-Correction
export {
  FailureCategory,
  FailureAnalyzer, failureAnalyzer,
} from './failure-analyzer.js';

export {
  CorrectionAction,
  CorrectionStrategy, correctionStrategy,
  FailureHistory, failureHistory,  // v39.2.1
} from './correction-strategy.js';

// v39.3: Local Copilot Mode
export {
  ContextEventType, ContextCategory,
  CopilotContext, copilotContext,
} from './copilot-context.js';

export {
  SuggestionType, SuggestionPriority,
  SuggestionEngine, suggestionEngine,
} from './suggestions.js';
