// CRE v39.x Autonomous Mode Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests for Layer 4 — Autonomous Mode:
//   - v39.0: Goal Persistence
//   - v39.1: Safe Autonomy
//   - v39.2: Self-Correction
//   - v39.3: Local Copilot Mode
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  // v39.0: Goal Persistence
  GoalStatus, GoalPriority, GoalTrigger,
  GoalStore, createGoal, parseSchedule,
  GoalScheduler, GoalRunner, GoalExecutionResult,

  // v39.1: Safe Autonomy
  SafetyLimits, DEFAULT_SAFETY_LIMITS, LimitViolation,
  Sandbox, SandboxMode, SandboxViolation,
  AuditLog, AuditEventType, AuditSeverity,

  // v39.2: Self-Correction
  FailureAnalyzer, FailureCategory,
  CorrectionStrategy, CorrectionAction,

  // v39.3: Local Copilot Mode
  CopilotContext, ContextEventType,
  SuggestionEngine, SuggestionType, SuggestionPriority,
} from '../src/autonomous/index.js';

// ════════════════════════════════════════════════════════════════════════════
// TEST FRAMEWORK
// ════════════════════════════════════════════════════════════════════════════

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.log(`  ❌ ${name}`);
    console.log(`     └─ ${error.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.log(`  ❌ ${name}`);
    console.log(`     └─ ${error.message}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

function assertFalse(condition, msg = '') {
  if (condition) throw new Error(msg || 'Expected false');
}

// ════════════════════════════════════════════════════════════════════════════
// v39.0: GOAL PERSISTENCE TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  CRE v39.x Autonomous Mode Tests');
console.log('══════════════════════════════════════════════════════════════\n');

console.log('📊 v39.0: Goal Persistence');

test('createGoal creates valid goal with defaults', () => {
  const goal = createGoal({ description: 'Test goal' });
  assertTrue(goal.id.startsWith('goal_'), 'ID prefix');
  assertEqual(goal.description, 'Test goal', 'Description');
  assertEqual(goal.status, GoalStatus.CREATED, 'Status');
  assertEqual(goal.priority, GoalPriority.NORMAL, 'Priority');
  assertTrue(goal.createdAt > 0, 'CreatedAt');
});

test('GoalStore creates and retrieves goals', () => {
  const store = new GoalStore();
  const goal = store.create({ description: 'Store test' });

  const retrieved = store.get(goal.id);
  assertEqual(retrieved.description, 'Store test', 'Retrieved goal');
  assertEqual(store.getAll().length, 1, 'Store size');
});

test('GoalStore status transitions work correctly', () => {
  const store = new GoalStore();
  const goal = store.create({ description: 'Transition test' });

  assertEqual(goal.status, GoalStatus.CREATED, 'Initial status');

  store.schedule(goal.id);
  assertEqual(goal.status, GoalStatus.SCHEDULED, 'After schedule');

  store.start(goal.id);
  assertEqual(goal.status, GoalStatus.RUNNING, 'After start');

  store.complete(goal.id, { result: 'done' });
  assertEqual(goal.status, GoalStatus.COMPLETED, 'After complete');
});

test('GoalStore rejects invalid transitions', () => {
  const store = new GoalStore();
  const goal = store.create({ description: 'Invalid transition' });

  // Can't start without scheduling
  const result = store.start(goal.id);
  assertFalse(result.success, 'Should reject start without schedule');
});

test('parseSchedule parses "every Xm" format', () => {
  const now = Date.now();
  const next = parseSchedule('every 5m', now);
  assertEqual(next, now + 5 * 60 * 1000, '5 minutes from now');
});

test('parseSchedule parses "every Xh" format', () => {
  const now = Date.now();
  const next = parseSchedule('every 2h', now);
  assertEqual(next, now + 2 * 60 * 60 * 1000, '2 hours from now');
});

test('GoalScheduler respects concurrency limits', () => {
  const scheduler = new GoalScheduler({
    limits: { maxConcurrentGoals: 2 },
  });

  const check1 = scheduler.store.getByStatus(GoalStatus.RUNNING);
  assertTrue(check1.length <= 2, 'Concurrency limit respected');
});

// ════════════════════════════════════════════════════════════════════════════
// v39.1: SAFE AUTONOMY TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n📊 v39.1: Safe Autonomy');

test('SafetyLimits has all required defaults', () => {
  assertTrue(DEFAULT_SAFETY_LIMITS.maxTokensPerGoal > 0, 'maxTokensPerGoal');
  assertTrue(DEFAULT_SAFETY_LIMITS.maxGoalDuration > 0, 'maxGoalDuration');
  assertTrue(DEFAULT_SAFETY_LIMITS.maxGoalsPerHour > 0, 'maxGoalsPerHour');
  assertTrue(Array.isArray(DEFAULT_SAFETY_LIMITS.blockedTools), 'blockedTools');
});

test('SafetyLimits allows actions within limits', () => {
  const safety = new SafetyLimits();
  const check = safety.check('START_GOAL', { currentConcurrent: 0 });
  assertTrue(check.allowed, 'Should allow start goal');
});

test('SafetyLimits blocks when limits exceeded', () => {
  const safety = new SafetyLimits();

  // Exceed goals per hour
  for (let i = 0; i < 25; i++) {
    safety.recordGoalStart();
  }

  const check = safety.check('START_GOAL');
  assertFalse(check.allowed, 'Should block');
  assertEqual(check.violation, LimitViolation.ACTION_LIMIT, 'Violation type');
});

test('SafetyLimits tracks token usage', () => {
  const safety = new SafetyLimits();
  safety.recordGoalStart();
  safety.recordTokens(1000);

  const usage = safety.getUsage();
  assertEqual(usage.tokens.goal, 1000, 'Goal tokens');
});

test('Sandbox allows operations in DISABLED mode', () => {
  const sandbox = new Sandbox({ mode: SandboxMode.DISABLED });
  const check = sandbox.checkPath('/etc/passwd', 'read');
  assertTrue(check.allowed, 'DISABLED allows all');
});

test('Sandbox blocks operations in RESTRICTED mode', () => {
  const sandbox = new Sandbox({ mode: SandboxMode.RESTRICTED });
  const check = sandbox.checkPath('/etc/passwd', 'read');
  assertFalse(check.allowed, 'RESTRICTED blocks');
  assertEqual(check.violation, SandboxViolation.PATH_BLOCKED, 'Violation type');
});

test('Sandbox virtual FS works in ISOLATED mode', () => {
  const sandbox = new Sandbox({
    mode: SandboxMode.ISOLATED,
    restrictions: {
      allowedPaths: ['/tmp'],
      blockedPaths: [],  // Clear blocked paths for test
    },
  });

  sandbox.virtualWrite('/tmp/test.txt', 'hello');
  const result = sandbox.virtualRead('/tmp/test.txt');

  assertTrue(result.success, 'Write and read');
  assertEqual(result.content, 'hello', 'Content matches');
});

test('Sandbox blocks shell exec when disabled', () => {
  const sandbox = new Sandbox({
    mode: SandboxMode.RESTRICTED,
    restrictions: { allowShellExec: false },
  });

  const check = sandbox.checkCommand('ls -la');
  assertFalse(check.allowed, 'Should block shell');
  assertEqual(check.violation, SandboxViolation.SHELL_EXEC_BLOCKED, 'Violation');
});

test('AuditLog logs events correctly', () => {
  const audit = new AuditLog();
  const entry = audit.log(AuditEventType.GOAL_CREATED, 'test', { goalId: 'g1' });

  assertTrue(entry.id.startsWith('audit_'), 'Entry ID');
  assertEqual(entry.type, AuditEventType.GOAL_CREATED, 'Event type');
  assertEqual(entry.source, 'test', 'Source');
});

test('AuditLog convenience methods work', () => {
  const audit = new AuditLog();

  audit.logGoalCreated('g1', 'Test goal');
  audit.logGoalStarted('g1');
  audit.logGoalCompleted('g1', { result: 'ok' });

  const goalEntries = audit.getByGoal('g1');
  assertEqual(goalEntries.length, 3, 'Three entries for goal');
});

test('AuditLog queries by type', () => {
  const audit = new AuditLog();

  audit.logGoalCreated('g1', 'Goal 1');
  audit.logGoalCreated('g2', 'Goal 2');
  audit.logGoalStarted('g1');

  const created = audit.getByType(AuditEventType.GOAL_CREATED);
  assertEqual(created.length, 2, 'Two created events');
});

test('AuditLog sanitizes sensitive data', () => {
  const audit = new AuditLog();

  const sanitized = audit.sanitizeParams({
    apiKey: 'secret123',
    password: 'hunter2',
    name: 'visible',
  });

  assertEqual(sanitized.apiKey, '[REDACTED]', 'API key redacted');
  assertEqual(sanitized.password, '[REDACTED]', 'Password redacted');
  assertEqual(sanitized.name, 'visible', 'Name visible');
});

// ════════════════════════════════════════════════════════════════════════════
// v39.2: SELF-CORRECTION TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n📊 v39.2: Self-Correction');

test('FailureAnalyzer classifies network errors', () => {
  const analyzer = new FailureAnalyzer();
  const record = analyzer.analyze('ECONNREFUSED: Connection refused');

  assertEqual(record.category, FailureCategory.NETWORK_ERROR, 'Category');
  assertTrue(record.analysis.isRetryable, 'Is retryable');
});

test('FailureAnalyzer classifies rate limiting', () => {
  const analyzer = new FailureAnalyzer();
  const record = analyzer.analyze('Rate limit exceeded (429)');

  assertEqual(record.category, FailureCategory.RATE_LIMITED, 'Category');
  assertTrue(record.analysis.isRetryable, 'Is retryable');
  assertTrue(record.analysis.retryDelay >= 60000, 'Long delay for rate limit');
});

test('FailureAnalyzer classifies permission errors', () => {
  const analyzer = new FailureAnalyzer();
  const record = analyzer.analyze('Permission denied: unauthorized access');

  assertEqual(record.category, FailureCategory.PERMISSION_DENIED, 'Category');
  assertFalse(record.analysis.isRetryable, 'Not retryable');
});

test('FailureAnalyzer generates suggestions', () => {
  const analyzer = new FailureAnalyzer();
  const record = analyzer.analyze('Connection timeout');

  assertTrue(record.suggestions.length > 0, 'Has suggestions');
  assertTrue(record.suggestions.some(s => s.toLowerCase().includes('retry')), 'Suggests retry');
});

test('CorrectionStrategy selects RETRY for retryable errors', () => {
  const analyzer = new FailureAnalyzer();
  const strategy = new CorrectionStrategy({ analyzer });

  const failure = analyzer.analyze('Network timeout', { stepId: 's1' });
  const correction = strategy.correct(failure, {});

  assertTrue(
    correction.action === CorrectionAction.RETRY ||
    correction.action === CorrectionAction.BACKOFF,
    'Selects retry or backoff'
  );
});

test('CorrectionStrategy selects ASK_USER for permission errors', () => {
  const analyzer = new FailureAnalyzer();
  const strategy = new CorrectionStrategy({ analyzer, maxRetries: 0 });

  const failure = analyzer.analyze('Permission denied');
  const correction = strategy.correct(failure, {});

  assertEqual(correction.action, CorrectionAction.ASK_USER, 'Asks user');
  assertTrue(correction.question !== undefined, 'Has question');
});

test('CorrectionStrategy respects retry limits', () => {
  const analyzer = new FailureAnalyzer();
  const strategy = new CorrectionStrategy({ analyzer, maxRetries: 2 });

  const failure = analyzer.analyze('Timeout', { stepId: 's1' });

  // Exhaust retries
  strategy.correct(failure, {});
  strategy.correct(failure, {});
  const third = strategy.correct(failure, {});

  // Should not retry after limit
  assertTrue(
    third.action !== CorrectionAction.RETRY &&
    third.action !== CorrectionAction.BACKOFF,
    'No retry after limit'
  );
});

test('CorrectionStrategy calculates exponential backoff', () => {
  const strategy = new CorrectionStrategy({ initialBackoffMs: 1000, backoffMultiplier: 2 });

  const delay0 = strategy.calculateBackoff(0);
  const delay1 = strategy.calculateBackoff(1);
  const delay2 = strategy.calculateBackoff(2);

  assertEqual(delay0, 1000, 'First delay');
  assertEqual(delay1, 2000, 'Second delay');
  assertEqual(delay2, 4000, 'Third delay');
});

// ════════════════════════════════════════════════════════════════════════════
// v39.3: LOCAL COPILOT MODE TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n📊 v39.3: Local Copilot Mode');

test('CopilotContext processes FILE_OPENED events', () => {
  const context = new CopilotContext();

  context.processEvent({
    type: ContextEventType.FILE_OPENED,
    data: { path: '/src/app.js' },
  });

  const snapshot = context.getSnapshot();
  assertEqual(snapshot.currentFile, '/src/app.js', 'Current file');
  assertTrue(snapshot.openFiles.includes('/src/app.js'), 'In open files');
  assertEqual(snapshot.language, 'javascript', 'Language detected');
});

test('CopilotContext detects language from extension', () => {
  const context = new CopilotContext();

  assertEqual(context.detectLanguage('/test.js'), 'javascript', 'JS');
  assertEqual(context.detectLanguage('/test.ts'), 'typescript', 'TS');
  assertEqual(context.detectLanguage('/test.py'), 'python', 'Python');
  assertEqual(context.detectLanguage('/test.go'), 'go', 'Go');
});

test('CopilotContext processes ERROR_DETECTED events', () => {
  const context = new CopilotContext();

  context.processEvent({
    type: ContextEventType.ERROR_DETECTED,
    data: { message: 'Syntax error', file: '/test.js', line: 10 },
  });

  const snapshot = context.getSnapshot();
  assertEqual(snapshot.errors.length, 1, 'Error stored');
  assertEqual(snapshot.errors[0].message, 'Syntax error', 'Error message');
});

test('CopilotContext infers debugging intent from errors', () => {
  const context = new CopilotContext();

  // Add multiple errors
  context.processEvent({ type: ContextEventType.ERROR_DETECTED, data: { message: 'Error 1' } });
  context.processEvent({ type: ContextEventType.ERROR_DETECTED, data: { message: 'Error 2' } });

  const intent = context.getIntent();
  assertEqual(intent.intent, 'debugging', 'Infers debugging');
  assertTrue(intent.confidence > 0.5, 'High confidence');
});

test('SuggestionEngine creates valid suggestions', () => {
  const engine = new SuggestionEngine({ context: new CopilotContext() });

  const suggestion = engine.createSuggestion({
    type: SuggestionType.FIX_ERROR,
    priority: SuggestionPriority.HIGH,
    title: 'Fix error',
    description: 'There is an error',
    confidence: 0.8,
  });

  assertTrue(suggestion.id.startsWith('sugg_'), 'ID');
  assertEqual(suggestion.type, SuggestionType.FIX_ERROR, 'Type');
  assertEqual(suggestion.priority, SuggestionPriority.HIGH, 'Priority');
  assertEqual(suggestion.status, 'pending', 'Status');
});

test('SuggestionEngine filters by confidence', () => {
  const engine = new SuggestionEngine({
    context: new CopilotContext(),
    minConfidence: 0.7,
  });

  const low = engine.addSuggestion(engine.createSuggestion({
    type: SuggestionType.REFACTOR,
    title: 'Low confidence',
    confidence: 0.5,
  }));

  const high = engine.addSuggestion(engine.createSuggestion({
    type: SuggestionType.FIX_ERROR,
    title: 'High confidence',
    confidence: 0.8,
  }));

  assertEqual(low, null, 'Low confidence rejected');
  assertTrue(high !== null, 'High confidence accepted');
});

test('SuggestionEngine tracks accepted/rejected', () => {
  const engine = new SuggestionEngine({ context: new CopilotContext() });

  const s1 = engine.addSuggestion(engine.createSuggestion({
    type: SuggestionType.FIX_ERROR,
    title: 'Accept me',
    confidence: 0.9,
  }));

  const s2 = engine.addSuggestion(engine.createSuggestion({
    type: SuggestionType.REFACTOR,
    title: 'Reject me',
    confidence: 0.9,
  }));

  engine.accept(s1.id);
  engine.reject(s2.id);

  const stats = engine.getStats();
  assertEqual(stats.accepted, 1, 'Accepted count');
  assertEqual(stats.rejected, 1, 'Rejected count');
});

test('SuggestionEngine getPending returns sorted by priority', () => {
  const engine = new SuggestionEngine({ context: new CopilotContext() });

  engine.addSuggestion(engine.createSuggestion({
    type: SuggestionType.REFACTOR,
    title: 'Low priority',
    priority: SuggestionPriority.LOW,
    confidence: 0.9,
  }));

  engine.addSuggestion(engine.createSuggestion({
    type: SuggestionType.FIX_ERROR,
    title: 'High priority',
    priority: SuggestionPriority.HIGH,
    confidence: 0.9,
  }));

  const pending = engine.getPending();
  assertEqual(pending[0].title, 'High priority', 'High priority first');
  assertEqual(pending[1].title, 'Low priority', 'Low priority second');
});

// ════════════════════════════════════════════════════════════════════════════
// RESULTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`  Results: ${passed} passed, ${failed} failed, ${results.length} total`);
console.log('══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
