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
// v39.1: Safe Autonomy
//   - SafetyLimits: Global safety constraints
//   - Sandbox: Isolated execution environment
//   - AuditLog: Comprehensive audit trail
//
// v39.2: Self-Correction
//   - FailureAnalyzer: Failure classification and learning
//   - CorrectionStrategy: Correction action selection
//
// v39.3: Local Copilot Mode
//   - CopilotContext: Working context maintenance
//   - SuggestionEngine: Proactive suggestions
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
