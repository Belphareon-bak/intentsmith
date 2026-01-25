// CRE v42.x True Copilot Experience Tests
// ══════════════════════════════════════════════════════════════════════════════

import assert from 'node:assert';
import { describe, it, beforeEach } from 'node:test';

import {
  // v42.0 - Intent Continuity
  GoalStatus, ProgressType,
  GoalUpdateSource, GOAL_UPDATE_THRESHOLD,
  SessionGoal, createSessionGoal, createProgressItem,
  IntentConfidence, IntentChangeType,
  IntentTracker, createIntentTracker,

  // v42.1 - Proactive Mode
  SuggestionType, SuggestionPriority, SuggestionAction,
  MIN_SUGGESTION_CONFIDENCE, MAX_SUGGESTION_REPETITIONS,
  ProactiveSuggestion,
  ProactiveSuggestionEngine, createSuggestionEngine,
  nextStepSuggestion, riskWarningSuggestion, refactorSuggestion,
} from '../src/copilot/index.js';

// ══════════════════════════════════════════════════════════════════════════════
// v42.0 — Intent Continuity Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('v42.0 — SessionGoal', () => {
  it('creates goal with required fields', () => {
    const goal = createSessionGoal('Implementace dark mode');

    assert.ok(goal.id.startsWith('goal_'));
    assert.strictEqual(goal.description, 'Implementace dark mode');
    assert.strictEqual(goal.implicit, true);
    assert.strictEqual(goal.status, GoalStatus.ACTIVE);
    assert.strictEqual(goal.confidence, 0.8);
  });

  it('rejects goal without description', () => {
    assert.throws(() => new SessionGoal({}), /requires description/);
  });

  it('rejects invalid confidence', () => {
    assert.throws(
      () => new SessionGoal({ description: 'test', confidence: 1.5 }),
      /between 0 and 1/
    );
  });

  it('tracks progress with markDone', () => {
    const goal = createSessionGoal('Test goal');

    goal.markDone('step 1');
    goal.markDone('step 2');

    const done = goal.getDoneItems();
    assert.strictEqual(done.length, 2);
    assert.strictEqual(done[0].description, 'step 1');
    assert.strictEqual(done[0].type, ProgressType.DONE);
    assert.ok(done[0].at); // Has timestamp
  });

  it('tracks next steps with addNext', () => {
    const goal = createSessionGoal('Test goal');

    goal.addNext('next step 1');
    goal.addNext('next step 2');

    const next = goal.getNextItems();
    assert.strictEqual(next.length, 2);
    assert.strictEqual(goal.getNextStep(), 'next step 1');
  });

  it('removes from next when marked done', () => {
    const goal = createSessionGoal('Test goal');

    goal.addNext('step A');
    goal.addNext('step B');
    goal.markDone('step A');

    const next = goal.getNextItems();
    assert.strictEqual(next.length, 1);
    assert.strictEqual(next[0].description, 'step B');

    const done = goal.getDoneItems();
    assert.strictEqual(done.length, 1);
    assert.strictEqual(done[0].description, 'step A');
  });

  it('tracks blocked items', () => {
    const goal = createSessionGoal('Test goal');

    goal.markBlocked('step X', 'missing dependency');

    const blocked = goal.getBlockedItems();
    assert.strictEqual(blocked.length, 1);
    assert.strictEqual(blocked[0].description, 'step X');
    assert.strictEqual(blocked[0].reason, 'missing dependency');
  });

  it('supports goal state transitions', () => {
    const goal = createSessionGoal('Test goal');
    assert.strictEqual(goal.isActive(), true);

    goal.pause();
    assert.strictEqual(goal.status, GoalStatus.PAUSED);

    goal.resume();
    assert.strictEqual(goal.status, GoalStatus.ACTIVE);

    goal.complete();
    assert.strictEqual(goal.status, GoalStatus.COMPLETED);
    assert.ok(goal.completedAt);
  });

  it('prevents operations on completed goal', () => {
    const goal = createSessionGoal('Test goal');
    goal.complete();

    assert.throws(() => goal.markDone('step'), /Cannot mark done on COMPLETED/);
    assert.throws(() => goal.addNext('step'), /Cannot add next step to COMPLETED/);
  });

  it('supports abandon with reason', () => {
    const goal = createSessionGoal('Test goal');
    goal.abandon('no longer needed');

    assert.strictEqual(goal.status, GoalStatus.ABANDONED);
    assert.strictEqual(goal.getMetadata().abandonReason, 'no longer needed');
  });

  it('generates summary for continuation', () => {
    const goal = createSessionGoal('Implementace dark mode');
    goal.markDone('toggle component');
    goal.addNext('CSS variables');

    const summary = goal.getSummary();

    assert.strictEqual(summary.goal, 'Implementace dark mode');
    assert.strictEqual(summary.doneCount, 1);
    assert.strictEqual(summary.nextCount, 1);
    assert.strictEqual(summary.lastDone, 'toggle component');
    assert.strictEqual(summary.nextStep, 'CSS variables');
  });

  it('serializes and deserializes correctly', () => {
    const goal = createSessionGoal('Test', { confidence: 0.9 });
    goal.markDone('step 1');
    goal.addNext('step 2');

    const json = goal.toJSON();
    const restored = SessionGoal.fromJSON(json);

    assert.strictEqual(restored.id, goal.id);
    assert.strictEqual(restored.description, 'Test');
    assert.strictEqual(restored.confidence, 0.9);
    assert.strictEqual(restored.getDoneItems().length, 1);
    assert.strictEqual(restored.getNextItems().length, 1);
  });
});

describe('v42.0 — IntentTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = createIntentTracker('session_123');
  });

  it('creates tracker with session ID', () => {
    assert.strictEqual(tracker.sessionId, 'session_123');
    assert.ok(tracker.createdAt);
    assert.strictEqual(tracker.hasActiveGoal(), false);
  });

  it('creates and tracks goals', () => {
    const goal = tracker.createGoal('Test goal');

    assert.ok(goal.id);
    assert.strictEqual(tracker.getAllGoals().length, 1);
  });

  it('sets active goal', () => {
    const goal = tracker.createGoal('Test goal');
    tracker.setActiveGoal(goal.id);

    assert.strictEqual(tracker.getActiveGoal().id, goal.id);
    assert.strictEqual(tracker.hasActiveGoal(), true);
  });

  it('pauses previous goal when setting new active', () => {
    const goal1 = tracker.createGoal('Goal 1');
    tracker.setActiveGoal(goal1.id);

    const goal2 = tracker.createGoal('Goal 2');
    tracker.setActiveGoal(goal2.id);

    assert.strictEqual(goal1.status, GoalStatus.PAUSED);
    assert.strictEqual(tracker.getActiveGoal().id, goal2.id);
  });

  it('infers goal from explicit new goal marker', () => {
    const result = tracker.inferGoal('Potřebuju implementovat dark mode');

    assert.strictEqual(result.change, IntentChangeType.NEW_GOAL);
    assert.ok(result.goal);
    assert.ok(result.goal.description.includes('dark mode'));
  });

  it('detects continuation requests', () => {
    const goal = tracker.createGoal('Test goal');
    tracker.setActiveGoal(goal.id);

    const result = tracker.inferGoal('ok pokračuj');

    assert.strictEqual(result.change, IntentChangeType.GOAL_PROGRESS);
    assert.strictEqual(result.goal.id, goal.id);
    assert.strictEqual(result.confidence, IntentConfidence.HIGH);
  });

  it('detects completion indicators', () => {
    const goal = tracker.createGoal('Test goal');
    tracker.setActiveGoal(goal.id);

    const result = tracker.inferGoal('hotovo');

    assert.strictEqual(result.change, IntentChangeType.GOAL_COMPLETE);
    assert.strictEqual(result.goal.status, GoalStatus.COMPLETED);
  });

  it('records progress on active goal', () => {
    const goal = tracker.createGoal('Test goal');
    tracker.setActiveGoal(goal.id);

    tracker.recordProgress('step completed');

    const doneItems = goal.getDoneItems();
    assert.strictEqual(doneItems.length, 1);
    assert.strictEqual(doneItems[0].description, 'step completed');
  });

  it('provides continuation context', () => {
    const goal = tracker.createGoal('Implementace dark mode');
    tracker.setActiveGoal(goal.id);
    tracker.recordProgress('toggle component');
    tracker.addNextStep('CSS variables');

    const context = tracker.getContinuationContext();

    assert.strictEqual(context.hasContext, true);
    assert.strictEqual(context.currentGoal, 'Implementace dark mode');
    assert.strictEqual(context.progress.lastDone, 'toggle component');
    assert.strictEqual(context.progress.nextStep, 'CSS variables');
    assert.ok(context.message.includes('Pracujeme na:'));
  });

  it('returns no-context message when no active goal', () => {
    const context = tracker.getContinuationContext();

    assert.strictEqual(context.hasContext, false);
    assert.ok(context.message.includes('No active goal'));
  });

  it('serializes and deserializes correctly', () => {
    const goal = tracker.createGoal('Test goal');
    tracker.setActiveGoal(goal.id);
    tracker.recordProgress('step 1');

    const json = tracker.toJSON();
    const restored = IntentTracker.fromJSON(json);

    assert.strictEqual(restored.sessionId, 'session_123');
    assert.strictEqual(restored.getAllGoals().length, 1);
    assert.strictEqual(restored.getActiveGoal()?.id, goal.id);
  });

  it('tracks history of intent changes', () => {
    tracker.createGoal('Goal 1');
    tracker.createGoal('Goal 2');

    const history = tracker.getHistory();
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[0].type, IntentChangeType.NEW_GOAL);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// v42.1 — Proactive Mode Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('v42.1 — ProactiveSuggestion', () => {
  it('creates suggestion with required fields', () => {
    const suggestion = new ProactiveSuggestion({
      type: SuggestionType.NEXT_STEP,
      priority: SuggestionPriority.MEDIUM,
      title: 'Add unit tests',
      description: 'The new function lacks test coverage',
      rationale: 'Tests prevent regressions',
      confidence: 0.9,
    });

    assert.ok(suggestion.id.startsWith('sug_'));
    assert.strictEqual(suggestion.type, SuggestionType.NEXT_STEP);
    assert.strictEqual(suggestion.priority, SuggestionPriority.MEDIUM);
    assert.strictEqual(suggestion.title, 'Add unit tests');
    assert.strictEqual(suggestion.confidence, 0.9);
    assert.strictEqual(suggestion.isPending(), true);
  });

  it('enforces minimum confidence for non-INFO suggestions', () => {
    assert.throws(
      () => new ProactiveSuggestion({
        type: SuggestionType.NEXT_STEP,
        priority: SuggestionPriority.MEDIUM,
        title: 'Test',
        description: 'Test',
        confidence: 0.5, // Below MIN_SUGGESTION_CONFIDENCE
      }),
      /require confidence/
    );
  });

  it('allows low confidence for INFO priority', () => {
    const suggestion = new ProactiveSuggestion({
      type: SuggestionType.NEXT_STEP,
      priority: SuggestionPriority.INFO,
      title: 'Test',
      description: 'Test',
      confidence: 0.5,
    });

    assert.strictEqual(suggestion.confidence, 0.5);
  });

  it('tracks user actions', () => {
    const suggestion = new ProactiveSuggestion({
      type: SuggestionType.NEXT_STEP,
      priority: SuggestionPriority.MEDIUM,
      title: 'Test',
      description: 'Test',
      confidence: 0.9,
    });

    suggestion.recordAction(SuggestionAction.APPROVE);

    assert.strictEqual(suggestion.isApproved(), true);
    assert.strictEqual(suggestion.isPending(), false);
    assert.ok(suggestion.userActionAt);
  });

  it('prevents duplicate actions', () => {
    const suggestion = new ProactiveSuggestion({
      type: SuggestionType.NEXT_STEP,
      priority: SuggestionPriority.MEDIUM,
      title: 'Test',
      description: 'Test',
      confidence: 0.9,
    });

    suggestion.recordAction(SuggestionAction.APPROVE);

    assert.throws(
      () => suggestion.recordAction(SuggestionAction.DISMISS),
      /already recorded/
    );
  });

  it('serializes and deserializes correctly', () => {
    const suggestion = new ProactiveSuggestion({
      type: SuggestionType.RISK_WARNING,
      priority: SuggestionPriority.HIGH,
      title: 'Security risk',
      description: 'Potential SQL injection',
      rationale: 'User input not sanitized',
      confidence: 0.95,
    });

    const json = suggestion.toJSON();
    const restored = ProactiveSuggestion.fromJSON(json);

    assert.strictEqual(restored.id, suggestion.id);
    assert.strictEqual(restored.type, SuggestionType.RISK_WARNING);
    assert.strictEqual(restored.confidence, 0.95);
  });
});

describe('v42.1 — ProactiveSuggestionEngine', () => {
  let engine;

  beforeEach(() => {
    engine = createSuggestionEngine('session_123', { enabled: true });
  });

  it('creates engine disabled by default', () => {
    const defaultEngine = createSuggestionEngine('test');
    assert.strictEqual(defaultEngine.enabled, false);
  });

  it('enables and disables proactive mode', () => {
    const e = createSuggestionEngine('test');

    assert.strictEqual(e.enabled, false);

    e.enable();
    assert.strictEqual(e.enabled, true);

    e.disable();
    assert.strictEqual(e.enabled, false);
  });

  it('returns null when suggesting while disabled', () => {
    const e = createSuggestionEngine('test');

    const suggestion = e.suggest({
      type: SuggestionType.NEXT_STEP,
      priority: SuggestionPriority.MEDIUM,
      title: 'Test',
      description: 'Test',
      confidence: 0.9,
    });

    assert.strictEqual(suggestion, null);
  });

  it('creates suggestions when enabled', () => {
    const suggestion = engine.suggest({
      type: SuggestionType.NEXT_STEP,
      priority: SuggestionPriority.MEDIUM,
      title: 'Test',
      description: 'Test description',
      confidence: 0.9,
    });

    assert.ok(suggestion);
    assert.strictEqual(suggestion.title, 'Test');
  });

  it('rejects low confidence suggestions (not INFO)', () => {
    const suggestion = engine.suggest({
      type: SuggestionType.NEXT_STEP,
      priority: SuggestionPriority.MEDIUM,
      title: 'Test',
      description: 'Test',
      confidence: 0.5,
    });

    assert.strictEqual(suggestion, null);
  });

  it('returns pending suggestions sorted by priority', () => {
    engine.suggest({
      type: SuggestionType.NEXT_STEP,
      priority: SuggestionPriority.LOW,
      title: 'Low priority',
      description: 'Test',
      confidence: 0.9,
    });

    engine.suggest({
      type: SuggestionType.RISK_WARNING,
      priority: SuggestionPriority.HIGH,
      title: 'High priority',
      description: 'Test',
      confidence: 0.9,
    });

    const pending = engine.getPendingSuggestions();

    assert.strictEqual(pending.length, 2);
    assert.strictEqual(pending[0].priority, SuggestionPriority.HIGH);
    assert.strictEqual(pending[1].priority, SuggestionPriority.LOW);
  });

  it('approves suggestions', () => {
    const suggestion = engine.suggest({
      type: SuggestionType.NEXT_STEP,
      priority: SuggestionPriority.MEDIUM,
      title: 'Test',
      description: 'Test',
      confidence: 0.9,
    });

    engine.approve(suggestion.id);

    assert.strictEqual(suggestion.isApproved(), true);
    assert.strictEqual(engine.getPendingSuggestions().length, 0);
  });

  it('dismisses suggestions', () => {
    const suggestion = engine.suggest({
      type: SuggestionType.NEXT_STEP,
      priority: SuggestionPriority.MEDIUM,
      title: 'Test',
      description: 'Test',
      confidence: 0.9,
    });

    engine.dismiss(suggestion.id, 'not needed');

    assert.strictEqual(suggestion.isDismissed(), true);
  });

  it('defers suggestions', () => {
    const suggestion = engine.suggest({
      type: SuggestionType.NEXT_STEP,
      priority: SuggestionPriority.MEDIUM,
      title: 'Test',
      description: 'Test',
      confidence: 0.9,
    });

    engine.defer(suggestion.id);

    assert.strictEqual(suggestion.userAction, SuggestionAction.DEFER);
  });

  it('prevents duplicate suggestions of same type+title', () => {
    engine.suggest({
      type: SuggestionType.NEXT_STEP,
      priority: SuggestionPriority.MEDIUM,
      title: 'Same title',
      description: 'First',
      confidence: 0.9,
    });

    const duplicate = engine.suggest({
      type: SuggestionType.NEXT_STEP,
      priority: SuggestionPriority.MEDIUM,
      title: 'Same title',
      description: 'Second',
      confidence: 0.9,
    });

    assert.strictEqual(duplicate, null);
  });

  it('tracks statistics', () => {
    engine.suggest({
      type: SuggestionType.NEXT_STEP,
      priority: SuggestionPriority.MEDIUM,
      title: 'Test 1',
      description: 'Test',
      confidence: 0.9,
    });

    const suggestion2 = engine.suggest({
      type: SuggestionType.REFACTOR,
      priority: SuggestionPriority.LOW,
      title: 'Test 2',
      description: 'Test',
      confidence: 0.85,
    });

    engine.approve(suggestion2.id);

    const stats = engine.getStats();

    assert.strictEqual(stats.total, 2);
    assert.strictEqual(stats.pending, 1);
    assert.strictEqual(stats.approved, 1);
    assert.ok(stats.averageConfidence > 0.8);
  });

  it('serializes and deserializes correctly', () => {
    engine.suggest({
      type: SuggestionType.NEXT_STEP,
      priority: SuggestionPriority.MEDIUM,
      title: 'Test',
      description: 'Test',
      confidence: 0.9,
    });

    const json = engine.toJSON();
    const restored = ProactiveSuggestionEngine.fromJSON(json);

    assert.strictEqual(restored.sessionId, 'session_123');
    assert.strictEqual(restored.enabled, true);
    assert.strictEqual(restored.getPendingSuggestions().length, 1);
  });
});

describe('v42.1 — Suggestion Helpers', () => {
  it('creates next step suggestion', () => {
    const config = nextStepSuggestion({
      title: 'Add tests',
      description: 'Missing test coverage',
      rationale: 'Tests prevent regressions',
    });

    assert.strictEqual(config.type, SuggestionType.NEXT_STEP);
    assert.strictEqual(config.priority, SuggestionPriority.MEDIUM);
    assert.strictEqual(config.title, 'Add tests');
    assert.ok(config.confidence >= MIN_SUGGESTION_CONFIDENCE);
  });

  it('creates risk warning suggestion', () => {
    const config = riskWarningSuggestion({
      title: 'SQL injection risk',
      description: 'User input not sanitized',
      rationale: 'Security vulnerability',
    });

    assert.strictEqual(config.type, SuggestionType.RISK_WARNING);
    assert.strictEqual(config.priority, SuggestionPriority.HIGH);
  });

  it('creates refactor suggestion', () => {
    const config = refactorSuggestion({
      title: 'Extract method',
      description: 'Function too long',
      rationale: 'Improve readability',
    });

    assert.strictEqual(config.type, SuggestionType.REFACTOR);
    assert.strictEqual(config.priority, SuggestionPriority.LOW);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Integration Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('v42.x — Integration: Intent Continuity + Proactive Mode', () => {
  it('suggests next step based on goal progress', () => {
    const tracker = createIntentTracker('session_123');
    const engine = createSuggestionEngine('session_123', { enabled: true });

    // Create goal and track progress
    const goal = tracker.createGoal('Implementace dark mode');
    tracker.setActiveGoal(goal.id);
    tracker.recordProgress('toggle component');

    // Engine suggests next step based on goal
    const suggestion = engine.suggest({
      type: SuggestionType.NEXT_STEP,
      priority: SuggestionPriority.MEDIUM,
      title: 'Add state management',
      description: 'Toggle needs state to persist preference',
      rationale: 'Based on goal progress',
      confidence: 0.9,
      relatedGoalId: goal.id,
    });

    assert.ok(suggestion);
    assert.strictEqual(suggestion.relatedGoalId, goal.id);

    // User approves → can now add to goal's next steps
    engine.approve(suggestion.id);
    tracker.addNextStep('Add state management');

    const context = tracker.getContinuationContext();
    assert.strictEqual(context.progress.nextStep, 'Add state management');
  });

  it('continuation context works after "ok pokračuj"', () => {
    const tracker = createIntentTracker('session_123');

    // Simulate conversation
    tracker.inferGoal('Potřebuju implementovat dark mode');
    tracker.recordProgress('toggle component');
    tracker.recordProgress('state management');
    tracker.addNextStep('CSS variables for theme');

    // User says "ok pokračuj"
    const result = tracker.inferGoal('ok pokračuj');

    assert.strictEqual(result.change, IntentChangeType.GOAL_PROGRESS);

    // System knows exactly where we left off
    const context = tracker.getContinuationContext();
    assert.strictEqual(context.hasContext, true);
    assert.strictEqual(context.progress.lastDone, 'state management');
    assert.strictEqual(context.progress.nextStep, 'CSS variables for theme');
    assert.ok(context.message.includes('CSS variables'));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// E2E Copilot Scenario Test
// ══════════════════════════════════════════════════════════════════════════════

describe('v42.x — E2E Copilot Scenario', () => {
  it('complete dark mode implementation workflow', () => {
    // ─────────────────────────────────────────────────────────────────────────
    // SETUP: Initialize copilot components
    // ─────────────────────────────────────────────────────────────────────────
    const tracker = createIntentTracker('session_e2e_001');
    const suggestionEngine = createSuggestionEngine('session_e2e_001');
    suggestionEngine.enable(); // Proactive mode requires explicit opt-in

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: User starts with implicit goal
    // ─────────────────────────────────────────────────────────────────────────
    const goalResult = tracker.inferGoal('Potřebuju implementovat dark mode do aplikace');

    assert.strictEqual(goalResult.change, IntentChangeType.NEW_GOAL);
    assert.ok(goalResult.goal.description.includes('dark mode'));
    assert.strictEqual(goalResult.goal.implicit, true);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: System provides proactive suggestion for next step
    // ─────────────────────────────────────────────────────────────────────────
    const suggestion1 = suggestionEngine.suggest(nextStepSuggestion({
      title: 'Create ThemeContext',
      description: 'Start by creating a ThemeContext component',
      rationale: 'React context is the standard way to share theme state',
      context: { currentStep: 'planning', projectType: 'react' },
    }));

    assert.ok(suggestion1);
    assert.strictEqual(suggestion1.type, SuggestionType.NEXT_STEP);
    assert.strictEqual(suggestion1.isPending(), true); // Waiting for user action

    // User approves the suggestion
    suggestionEngine.approve(suggestion1.id);
    assert.strictEqual(suggestion1.isApproved(), true);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: Record progress as user works
    // ─────────────────────────────────────────────────────────────────────────
    tracker.recordProgress('Created ThemeContext with light/dark themes');
    tracker.addNextStep('Add theme toggle button to Settings');
    tracker.addNextStep('Implement CSS variables');

    // Check continuation context
    const context1 = tracker.getContinuationContext();
    assert.strictEqual(context1.hasContext, true);
    assert.strictEqual(context1.progress.lastDone, 'Created ThemeContext with light/dark themes');
    assert.strictEqual(context1.progress.nextStep, 'Add theme toggle button to Settings');

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 4: System detects risk and proactively warns
    // ─────────────────────────────────────────────────────────────────────────
    const riskSuggestion = suggestionEngine.suggest(riskWarningSuggestion({
      title: 'SSR Flash Warning',
      description: 'Theme changes may cause flash of unstyled content during SSR',
      rationale: 'Server-side rendering doesn\'t know user preference',
      context: { severity: 'medium', affectedComponent: 'ThemeProvider' },
    }));

    assert.ok(riskSuggestion);
    assert.strictEqual(riskSuggestion.type, SuggestionType.RISK_WARNING);
    assert.strictEqual(riskSuggestion.priority, SuggestionPriority.HIGH);

    // User acknowledges
    suggestionEngine.dismiss(riskSuggestion.id);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 5: User says "ok pokračuj" after a break
    // ─────────────────────────────────────────────────────────────────────────
    const continueResult = tracker.inferGoal('ok pokračuj');

    assert.strictEqual(continueResult.change, IntentChangeType.GOAL_PROGRESS);
    assert.strictEqual(continueResult.goal.description, goalResult.goal.description);

    // System knows exactly where we were
    const context2 = tracker.getContinuationContext();
    assert.ok(context2.message.includes('toggle button'));

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 6: More progress, more suggestions
    // ─────────────────────────────────────────────────────────────────────────
    tracker.recordProgress('Added theme toggle button');

    // System suggests refactoring
    const refactorSug = suggestionEngine.suggest(refactorSuggestion({
      title: 'Extract Colors',
      description: 'Extract color constants to theme.js for maintainability',
      rationale: 'Centralized colors are easier to update',
      context: { complexity: 'low', benefit: 'Easier theme customization' },
    }));

    assert.ok(refactorSug);
    assert.strictEqual(refactorSug.type, SuggestionType.REFACTOR);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 7: Test noise prevention - repeated suggestions get suppressed
    // ─────────────────────────────────────────────────────────────────────────
    const testSugConfig = nextStepSuggestion({
      title: 'Run Tests',
      description: 'Run tests to verify implementation',
      rationale: 'Testing ensures correctness',
      context: { step: 'testing' },
    });

    // First 3 times it works (MAX_SUGGESTION_REPETITIONS = 3)
    const sug1 = suggestionEngine.suggest(testSugConfig);
    assert.ok(sug1);
    suggestionEngine.dismiss(sug1.id);

    const sug2 = suggestionEngine.suggest(testSugConfig);
    assert.ok(sug2);
    suggestionEngine.dismiss(sug2.id);

    const sug3 = suggestionEngine.suggest(testSugConfig);
    assert.ok(sug3);
    suggestionEngine.dismiss(sug3.id);

    // After 3 times, it's suppressed (auto-dismissed)
    const suppressed = suggestionEngine.suggest(testSugConfig);
    assert.strictEqual(suppressed, null);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 8: Goal drift prevention - low confidence updates need confirmation
    // ─────────────────────────────────────────────────────────────────────────
    const goal = tracker.getActiveGoal();

    // Low confidence update (system inferred)
    const updateResult = goal.proposeUpdate('Implement full theming system', {
      source: GoalUpdateSource.INFERRED,
      confidence: 0.5,  // Below GOAL_UPDATE_THRESHOLD
    });

    // Update is pending, not applied
    assert.strictEqual(updateResult.applied, false);
    assert.strictEqual(updateResult.pending, true);
    assert.strictEqual(goal.description, goalResult.goal.description); // Original

    // User confirms the update (returns this for chaining)
    goal.confirmPendingUpdate();
    assert.ok(goal.description.includes('full theming'));

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 9: Complete the goal
    // ─────────────────────────────────────────────────────────────────────────
    tracker.recordProgress('CSS variables implemented');
    tracker.recordProgress('All tests passing');
    tracker.recordProgress('Documentation updated');

    goal.complete();

    assert.strictEqual(goal.status, GoalStatus.COMPLETED);
    assert.ok(goal.completedAt);

    // Verify workflow completed successfully
    const activeGoal = tracker.getActiveGoal();
    assert.strictEqual(activeGoal.isCompleted(), true);
  });

  it('handles session with continuation context', () => {
    const tracker = createIntentTracker('session_continuation');

    // Start with a goal
    tracker.inferGoal('Implement user authentication');
    tracker.recordProgress('Created login form');
    tracker.addNextStep('Add password validation');
    tracker.addNextStep('Implement session management');

    // User says "ok pokračuj" - should continue with current goal
    const continueResult = tracker.inferGoal('ok pokračuj');

    assert.strictEqual(continueResult.change, IntentChangeType.GOAL_PROGRESS);

    // Context preserved
    const context = tracker.getContinuationContext();
    assert.strictEqual(context.hasContext, true);
    assert.strictEqual(context.progress.lastDone, 'Created login form');
    assert.strictEqual(context.progress.nextStep, 'Add password validation');

    // Continue working - complete the next step (password validation)
    tracker.recordProgress('Add password validation');

    // Another continuation
    const continue2 = tracker.inferGoal('pokračuj');
    assert.strictEqual(continue2.change, IntentChangeType.GOAL_PROGRESS);

    const context2 = tracker.getContinuationContext();
    assert.strictEqual(context2.progress.lastDone, 'Add password validation');
    // Next step after password validation is session management
    assert.strictEqual(context2.progress.nextStep, 'Implement session management');
  });

  it('integrates gate-like approval workflow with suggestions', () => {
    const suggestionEngine = createSuggestionEngine('session_approval_001');
    suggestionEngine.enable(); // Proactive mode requires explicit opt-in

    // High-confidence suggestion that should execute
    const safeSuggestion = suggestionEngine.suggest(nextStepSuggestion({
      title: 'Format Code',
      description: 'Format code with prettier',
      rationale: 'Consistent formatting improves readability',
      confidence: 0.95,
      context: { safe: true },
    }));

    assert.ok(safeSuggestion);
    assert.strictEqual(safeSuggestion.isPending(), true); // Still needs approval

    // Simulate approval flow - approve() returns the suggestion
    const approvedSuggestion = suggestionEngine.approve(safeSuggestion.id);
    assert.ok(approvedSuggestion);
    assert.strictEqual(approvedSuggestion.isApproved(), true);
    assert.strictEqual(safeSuggestion.isApproved(), true);

    // Check history
    const history = suggestionEngine.getHistory();
    const approved = history.find(h => h.suggestionId === safeSuggestion.id);
    assert.ok(approved);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Run Tests
// ══════════════════════════════════════════════════════════════════════════════

console.log('CRE v42.x — True Copilot Experience Tests\n');
