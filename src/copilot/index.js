// CRE v42.x True Copilot Experience Index
// ══════════════════════════════════════════════════════════════════════════════
//
// LAYER 7 — TRUE COPILOT EXPERIENCE
//
// v42.0: Intent Continuity
//   - SessionGoal: Track implicit user goals across session
//   - IntentTracker: Manage multiple goals, enable "ok pokračuj"
//
// v42.1: Proactive Mode
//   - ProactiveSuggestion: System suggestions (opt-in, no auto-exec)
//   - ProactiveSuggestionEngine: Manage suggestions with rules
//
// Rules:
//   ✅ May suggest next step, warn about risk, recommend refactor
//   ❌ No auto-execution without approval
//   ❌ No changes without confidence > 0.8
//
// ══════════════════════════════════════════════════════════════════════════════

// v42.0: Intent Continuity
export {
  GoalStatus, ProgressType,
  GoalUpdateSource, GOAL_UPDATE_THRESHOLD,  // Goal drift prevention
  SessionGoal,
  createProgressItem, createSessionGoal,
} from './session-goal.js';

export {
  IntentConfidence, IntentChangeType,
  IntentTracker,
  createIntentTracker,
} from './intent-tracker.js';

// v42.1: Proactive Mode
export {
  SuggestionType, SuggestionPriority, SuggestionAction,
  MIN_SUGGESTION_CONFIDENCE,
  MAX_SUGGESTION_REPETITIONS,  // Noise prevention
  ProactiveSuggestion,
  ProactiveSuggestionEngine,
  createSuggestionEngine,
  nextStepSuggestion, riskWarningSuggestion, refactorSuggestion,
} from './proactive-suggestions.js';
