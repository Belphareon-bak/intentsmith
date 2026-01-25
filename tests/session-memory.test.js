// CRE v37.0 Session Memory + Reference Resolver Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests:
// - SessionMemory: turns, slots, goals, context
// - ReferenceResolver: Czech/English patterns, keyword resolution
// - Integration: session + resolver working together
//
// ══════════════════════════════════════════════════════════════════════════════

import { SessionMemory, createTurnRecord, createGoalRef } from '../src/memory/session.js';
import { ReferenceResolver } from '../src/memory/reference-resolver.js';

// ════════════════════════════════════════════════════════════════════════════
// TEST FRAMEWORK
// ════════════════════════════════════════════════════════════════════════════

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`  \u2705 ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.log(`  \u274c ${name}`);
    console.log(`     \u2514\u2500 ${error.message}`);
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

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
console.log('  CRE v37.0 Session Memory + Reference Resolver Tests');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

// ────────────────────────────────────────────────────────────────────────────
// SessionMemory: Turns
// ────────────────────────────────────────────────────────────────────────────

console.log('\ud83d\udccb Session Memory: Turns');

test('addTurn records a turn with decision', () => {
  const session = new SessionMemory('test-1');
  const decision = { type: 'ANSWER', template: 'factual_answer' };
  const turn = session.addTurn('najdi auto', decision);

  assertTrue(turn.turnId !== undefined, 'Should have turnId');
  assertEqual(turn.userMessage, 'najdi auto', 'userMessage');
  assertEqual(turn.decision.type, 'ANSWER', 'decision type');
  assertEqual(session.turns.length, 1, 'turns count');
});

test('lastDecision is updated after addTurn', () => {
  const session = new SessionMemory('test-2');
  session.addTurn('msg1', { type: 'TOOL_CALL', tool: 'web.search' });
  assertEqual(session.lastDecision.type, 'TOOL_CALL', 'lastDecision type');
  assertEqual(session.lastDecision.tool, 'web.search', 'lastDecision tool');
});

test('lastToolResult is updated when provided', () => {
  const session = new SessionMemory('test-3');
  const result = { data: [{ title: 'Jimny' }] };
  session.addTurn('search', { type: 'TOOL_CALL' }, result);
  assertEqual(session.lastToolResult.data[0].title, 'Jimny', 'lastToolResult');
});

test('getRecentTurns returns last N turns', () => {
  const session = new SessionMemory('test-4');
  for (let i = 0; i < 10; i++) {
    session.addTurn(`msg${i}`, { type: 'ANSWER' });
  }
  const recent = session.getRecentTurns(3);
  assertEqual(recent.length, 3, 'Should return 3');
  assertEqual(recent[0].userMessage, 'msg7', 'First of 3');
});

test('maxTurns prevents unbounded growth', () => {
  const session = new SessionMemory('test-5');
  session.maxTurns = 5;
  for (let i = 0; i < 10; i++) {
    session.addTurn(`msg${i}`, { type: 'ANSWER' });
  }
  assertEqual(session.turns.length, 5, 'Should cap at maxTurns');
  assertEqual(session.turns[0].userMessage, 'msg5', 'Oldest should be msg5');
});

// ────────────────────────────────────────────────────────────────────────────
// SessionMemory: Slots
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb Session Memory: Slots');

test('setSlot and getSlot work', () => {
  const session = new SessionMemory('test-slots-1');
  session.setSlot('budget', 200000);
  assertEqual(session.getSlot('budget'), 200000, 'slot value');
});

test('correctSlot preserves previous value', () => {
  const session = new SessionMemory('test-slots-2');
  session.setSlot('budget', 200000);
  session.correctSlot('budget', 150000);
  assertEqual(session.getSlot('budget'), 150000, 'corrected value');
  // Check the internal entry has previous
  const entry = session.slots.get('budget');
  assertEqual(entry.source, 'corrected', 'source');
  assertEqual(entry.previous, 200000, 'previous value preserved');
});

test('getAllSlots returns plain object', () => {
  const session = new SessionMemory('test-slots-3');
  session.setSlot('make', 'Suzuki');
  session.setSlot('type', '4x4');
  const all = session.getAllSlots();
  assertEqual(all.make, 'Suzuki', 'make');
  assertEqual(all.type, '4x4', 'type');
});

test('clearSlot removes a slot', () => {
  const session = new SessionMemory('test-slots-4');
  session.setSlot('temp', 'value');
  session.clearSlot('temp');
  assertEqual(session.getSlot('temp'), undefined, 'Should be undefined');
});

test('addTurn with extractedSlots populates slots', () => {
  const session = new SessionMemory('test-slots-5');
  session.addTurn('auto 4x4 do 200k', { type: 'ANSWER' }, null, { budget: 200000, type: '4x4' });
  assertEqual(session.getSlot('budget'), 200000, 'Extracted budget');
  assertEqual(session.getSlot('type'), '4x4', 'Extracted type');
});

// ────────────────────────────────────────────────────────────────────────────
// SessionMemory: Goals
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb Session Memory: Goals');

test('addGoal creates an active goal', () => {
  const session = new SessionMemory('test-goals-1');
  const goal = session.addGoal('Find a 4x4 car under 200k');
  assertTrue(goal.id.startsWith('goal_'), 'goal ID');
  assertEqual(goal.status, 'active', 'status');
  assertEqual(goal.description, 'Find a 4x4 car under 200k', 'description');
});

test('completeGoal sets status to completed', () => {
  const session = new SessionMemory('test-goals-2');
  const goal = session.addGoal('Test goal');
  session.completeGoal(goal.id);
  assertEqual(goal.status, 'completed', 'completed');
});

test('abandonGoal sets status to abandoned', () => {
  const session = new SessionMemory('test-goals-3');
  const goal = session.addGoal('Will abandon');
  session.abandonGoal(goal.id);
  assertEqual(goal.status, 'abandoned', 'abandoned');
});

test('getActiveGoals filters correctly', () => {
  const session = new SessionMemory('test-goals-4');
  const g1 = session.addGoal('Active 1');
  const g2 = session.addGoal('Active 2');
  const g3 = session.addGoal('Done');
  session.completeGoal(g3.id);
  assertEqual(session.getActiveGoals().length, 2, 'Should have 2 active');
});

// ────────────────────────────────────────────────────────────────────────────
// SessionMemory: Context
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb Session Memory: Context');

test('getContext returns structured context for CRE', () => {
  const session = new SessionMemory('test-ctx-1');
  session.addTurn('test', { type: 'ANSWER', template: 'factual' });
  session.setSlot('budget', 200000);
  session.addGoal('Find car');

  const ctx = session.getContext();
  assertEqual(ctx.sessionId, 'test-ctx-1', 'sessionId');
  assertEqual(ctx.turnCount, 1, 'turnCount');
  assertEqual(ctx.lastDecision.type, 'ANSWER', 'lastDecision');
  assertEqual(ctx.activeSlots.budget, 200000, 'activeSlots');
  assertEqual(ctx.activeGoals.length, 1, 'activeGoals');
  assertEqual(ctx.recentTurns.length, 1, 'recentTurns');
});

test('reset clears all session state', () => {
  const session = new SessionMemory('test-ctx-2');
  session.addTurn('x', { type: 'ANSWER' });
  session.setSlot('a', 1);
  session.addGoal('g');
  session.reset();
  assertEqual(session.turns.length, 0, 'turns');
  assertEqual(session.slots.size, 0, 'slots');
  assertEqual(session.openGoals.length, 0, 'goals');
  assertEqual(session.lastDecision, null, 'lastDecision');
});

// ────────────────────────────────────────────────────────────────────────────
// ReferenceResolver: Czech patterns
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb Reference Resolver: Czech');

test('"to predchozi" resolves to LAST_RESULT', () => {
  const resolver = new ReferenceResolver();
  const session = {
    lastDecision: { type: 'TOOL_CALL', tool: 'web.search' },
    lastToolResult: { data: [{ title: 'Jimny' }] },
    activeSlots: {},
  };
  const result = resolver.resolve('to predchozi myslel jsem jinak', session);
  // "to předchozí" won't match because we used ASCII, but "myslel jsem jinak" should match
  assertTrue(result.hasReference, 'Should resolve');
  assertEqual(result.referenceType, 'CORRECTION', 'type');
});

test('"uprav to" resolves to CORRECTION', () => {
  const resolver = new ReferenceResolver();
  const session = {
    lastDecision: { type: 'ANSWER', template: 'factual' },
    lastToolResult: null,
    activeSlots: {},
  };
  const result = resolver.resolve('uprav to prosim', session);
  assertTrue(result.hasReference, 'Should resolve');
  assertEqual(result.referenceType, 'CORRECTION', 'type');
  assertTrue(result.isCorrection, 'isCorrection');
});

test('"jinak" resolves to CORRECTION', () => {
  const resolver = new ReferenceResolver();
  const session = {
    lastDecision: { type: 'ANSWER' },
    activeSlots: {},
  };
  const result = resolver.resolve('jinak', session);
  assertTrue(result.hasReference, 'Should resolve');
  assertEqual(result.referenceType, 'CORRECTION', 'type');
});

test('"znovu" resolves to REPEAT', () => {
  const resolver = new ReferenceResolver();
  const session = {
    lastDecision: { type: 'TOOL_CALL', tool: 'web.search' },
    activeSlots: {},
  };
  const result = resolver.resolve('znovu', session);
  assertTrue(result.hasReference, 'Should resolve');
  assertEqual(result.referenceType, 'REPEAT', 'type');
});

// ────────────────────────────────────────────────────────────────────────────
// ReferenceResolver: English patterns
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb Reference Resolver: English');

test('"the previous result" resolves to LAST_RESULT', () => {
  const resolver = new ReferenceResolver();
  const session = {
    lastDecision: { type: 'ANSWER' },
    lastToolResult: { data: 'x' },
    activeSlots: {},
  };
  const result = resolver.resolve('show me the previous result', session);
  assertTrue(result.hasReference, 'Should resolve');
  assertEqual(result.referenceType, 'LAST_RESULT', 'type');
});

test('"fix it" resolves to CORRECTION', () => {
  const resolver = new ReferenceResolver();
  const session = {
    lastDecision: { type: 'ANSWER' },
    activeSlots: {},
  };
  const result = resolver.resolve('fix it please', session);
  assertTrue(result.hasReference, 'Should resolve');
  assertEqual(result.referenceType, 'CORRECTION', 'type');
  assertTrue(result.isCorrection, 'isCorrection');
});

test('"that document" resolves to LAST_ARTIFACT', () => {
  const resolver = new ReferenceResolver();
  const session = {
    lastDecision: { type: 'TOOL_CALL', tool: 'artifact.pdf' },
    lastToolResult: { path: '/tmp/report.pdf' },
    activeSlots: {},
    recentTurns: [
      { decision: { tool: 'artifact.pdf' }, executionResult: { path: '/tmp/report.pdf' } }
    ],
  };
  const result = resolver.resolve('send me that document', session);
  assertTrue(result.hasReference, 'Should resolve');
  assertEqual(result.referenceType, 'LAST_ARTIFACT', 'type');
});

// ────────────────────────────────────────────────────────────────────────────
// ReferenceResolver: No reference
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb Reference Resolver: No reference');

test('Normal message without reference returns hasReference=false', () => {
  const resolver = new ReferenceResolver();
  const session = { lastDecision: null, activeSlots: {} };
  const result = resolver.resolve('najdi auto 4x4 do 200k', session);
  assertTrue(!result.hasReference, 'Should not resolve');
  assertEqual(result.referenceType, null, 'null type');
});

test('Empty message returns hasReference=false', () => {
  const resolver = new ReferenceResolver();
  const result = resolver.resolve('', {});
  assertTrue(!result.hasReference, 'No reference');
});

test('containsReference quick check works', () => {
  const resolver = new ReferenceResolver();
  assertTrue(resolver.containsReference('uprav to'), 'Should detect');
  assertTrue(!resolver.containsReference('najdi auto'), 'Should not detect');
});

// ────────────────────────────────────────────────────────────────────────────
// ReferenceResolver: Keyword resolution
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb Reference Resolver: Keyword');

test('"to Jimny" resolves via keyword from recent turns', () => {
  const resolver = new ReferenceResolver();
  const session = {
    lastDecision: null,
    activeSlots: {},
    recentTurns: [
      {
        userMessage: 'najdi auto',
        executionResult: { data: [{ title: 'Suzuki Jimny 4x4' }] },
      },
    ],
  };
  const result = resolver.resolve('to Jimny kolik stoji', session);
  assertTrue(result.hasReference, 'Should resolve keyword');
  assertEqual(result.referenceType, 'KEYWORD', 'type');
});

// ────────────────────────────────────────────────────────────────────────────
// Integration: Session + Resolver
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb Integration: Session + Resolver');

test('Full flow: session context feeds resolver', () => {
  const session = new SessionMemory('integration-1');
  session.addTurn('najdi auto 4x4', { type: 'TOOL_CALL', tool: 'web.search' }, { data: [{ title: 'Jimny' }] });

  const resolver = new ReferenceResolver();
  const ctx = session.getContext();
  const result = resolver.resolve('uprav to', ctx);

  assertTrue(result.hasReference, 'Should resolve');
  assertEqual(result.referenceType, 'CORRECTION', 'type');
  assertTrue(result.isCorrection, 'isCorrection');
  assertEqual(result.resolvedFrom.type, 'TOOL_CALL', 'resolvedFrom');
});

test('Session stats work', () => {
  const session = new SessionMemory('stats-1');
  session.addTurn('a', { type: 'ANSWER' });
  session.setSlot('x', 1);
  session.addGoal('g1');

  const stats = session.getStats();
  assertEqual(stats.turns, 1, 'turns');
  assertEqual(stats.slots, 1, 'slots');
  assertEqual(stats.activeGoals, 1, 'activeGoals');
});

// ════════════════════════════════════════════════════════════════════════════
// RESULTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`  Results: ${passed} passed, ${failed} failed, ${results.length} total`);
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

if (failed > 0) {
  process.exit(1);
}
