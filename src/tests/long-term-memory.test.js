// CRE v37.1 Long-Term Memory + AutoLearner Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests:
// - LongTermMemory: write, read, forget, queryByKind, confidence, TTL
// - AutoLearner: observe, promote, threshold, consistency
// - Integration: learner → LTM promotion
//
// ══════════════════════════════════════════════════════════════════════════════

import { LongTermMemory, MemoryKind, MemorySource } from '../memory/long-term.js';
import { AutoLearner, ObservationType } from '../memory/learning.js';

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
console.log('  CRE v37.1 Long-Term Memory + AutoLearner Tests');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

// ────────────────────────────────────────────────────────────────────────────
// LongTermMemory: Write + Read
// ────────────────────────────────────────────────────────────────────────────

console.log('\ud83d\udccb LTM: Write + Read');

test('write stores a preference', () => {
  const ltm = new LongTermMemory({ userId: 'user1' });
  const result = ltm.write({ kind: 'preference', key: 'avoid_formats', value: ['pdf'], confidence: 1.0 });
  assertTrue(result.stored, 'Should store');
  assertEqual(result.key, 'avoid_formats', 'key');
});

test('read retrieves stored value', () => {
  const ltm = new LongTermMemory({ userId: 'user2' });
  ltm.write({ kind: 'preference', key: 'language', value: 'cs' });
  const result = ltm.read({ kind: 'preference', key: 'language' });
  assertEqual(result.value, 'cs', 'value');
  assertEqual(result.confidence, 1.0, 'default confidence');
  assertEqual(result.source, 'explicit', 'default source');
});

test('read non-existent returns NOT_FOUND', () => {
  const ltm = new LongTermMemory({ userId: 'user3' });
  const result = ltm.read({ kind: 'preference', key: 'nonexistent' });
  assertEqual(result.code, 'NOT_FOUND', 'code');
});

test('write with custom confidence and source', () => {
  const ltm = new LongTermMemory({ userId: 'user4' });
  ltm.write({ kind: 'pattern', key: 'search_style', value: 'detailed', confidence: 0.7, source: 'inferred' });
  const result = ltm.read({ kind: 'pattern', key: 'search_style' });
  assertEqual(result.confidence, 0.7, 'confidence');
  assertEqual(result.source, 'inferred', 'source');
});

test('write overwrites existing entry', () => {
  const ltm = new LongTermMemory({ userId: 'user5' });
  ltm.write({ kind: 'preference', key: 'verbosity', value: 'minimal' });
  ltm.write({ kind: 'preference', key: 'verbosity', value: 'detailed' });
  assertEqual(ltm.read({ kind: 'preference', key: 'verbosity' }).value, 'detailed', 'overwritten');
});

test('write with invalid kind returns error', () => {
  const ltm = new LongTermMemory({ userId: 'user6' });
  const result = ltm.write({ kind: 'invalid_kind', key: 'x', value: 1 });
  assertTrue(!result.stored, 'Should not store');
  assertEqual(result.code, 'INVALID_KIND', 'code');
});

// ────────────────────────────────────────────────────────────────────────────
// LongTermMemory: Confidence threshold
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb LTM: Confidence');

test('read with minConfidence filters low-confidence entries', () => {
  const ltm = new LongTermMemory({ userId: 'conf1' });
  ltm.write({ kind: 'pattern', key: 'low', value: 'x', confidence: 0.3 });
  const result = ltm.read({ kind: 'pattern', key: 'low', minConfidence: 0.5 });
  assertEqual(result.code, 'LOW_CONFIDENCE', 'Should reject low confidence');
});

test('read with minConfidence allows high-confidence entries', () => {
  const ltm = new LongTermMemory({ userId: 'conf2' });
  ltm.write({ kind: 'pattern', key: 'high', value: 'y', confidence: 0.9 });
  const result = ltm.read({ kind: 'pattern', key: 'high', minConfidence: 0.5 });
  assertEqual(result.value, 'y', 'Should return value');
});

test('updateConfidence changes confidence', () => {
  const ltm = new LongTermMemory({ userId: 'conf3' });
  ltm.write({ kind: 'preference', key: 'x', value: 1, confidence: 0.5 });
  ltm.updateConfidence('preference', 'x', 0.9);
  assertEqual(ltm.read({ kind: 'preference', key: 'x' }).confidence, 0.9, 'updated');
});

test('updateConfidence clamps to 0-1', () => {
  const ltm = new LongTermMemory({ userId: 'conf4' });
  ltm.write({ kind: 'preference', key: 'y', value: 1, confidence: 0.5 });
  ltm.updateConfidence('preference', 'y', 1.5);
  assertEqual(ltm.read({ kind: 'preference', key: 'y' }).confidence, 1.0, 'clamped to 1');
});

// ────────────────────────────────────────────────────────────────────────────
// LongTermMemory: TTL
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb LTM: TTL');

test('TTL: non-expired entry is readable', () => {
  const ltm = new LongTermMemory({ userId: 'ttl1' });
  ltm.write({ kind: 'preference', key: 'fresh', value: 'alive', ttl: 60 });
  assertEqual(ltm.read({ kind: 'preference', key: 'fresh' }).value, 'alive', 'Should be readable');
});

test('TTL: expired entry returns EXPIRED', () => {
  const ltm = new LongTermMemory({ userId: 'ttl2' });
  // Manually create an expired entry
  const id = `mem_ttl2_preference_old`;
  ltm.store.set(id, {
    id, userId: 'ttl2', kind: 'preference', key: 'old', value: 'dead',
    confidence: 1.0, source: 'explicit',
    createdAt: Date.now() - 10000, ttl: 5, // 5s TTL, created 10s ago
    lastUsed: null,
  });
  const result = ltm.read({ kind: 'preference', key: 'old' });
  assertEqual(result.code, 'EXPIRED', 'Should be expired');
});

// ────────────────────────────────────────────────────────────────────────────
// LongTermMemory: QueryByKind
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb LTM: QueryByKind');

test('queryByKind returns all entries of kind', () => {
  const ltm = new LongTermMemory({ userId: 'query1' });
  ltm.write({ kind: 'preference', key: 'a', value: 1 });
  ltm.write({ kind: 'preference', key: 'b', value: 2 });
  ltm.write({ kind: 'pattern', key: 'c', value: 3 });

  const prefs = ltm.queryByKind('preference');
  assertEqual(prefs.length, 2, 'Should find 2 preferences');
  assertTrue(prefs.some(p => p.key === 'a'), 'Should include a');
  assertTrue(prefs.some(p => p.key === 'b'), 'Should include b');
});

test('queryByKind with minConfidence filters', () => {
  const ltm = new LongTermMemory({ userId: 'query2' });
  ltm.write({ kind: 'pattern', key: 'strong', value: 'x', confidence: 0.9 });
  ltm.write({ kind: 'pattern', key: 'weak', value: 'y', confidence: 0.3 });

  const strong = ltm.queryByKind('pattern', { minConfidence: 0.5 });
  assertEqual(strong.length, 1, 'Should find only strong');
  assertEqual(strong[0].key, 'strong', 'Should be the strong one');
});

// ────────────────────────────────────────────────────────────────────────────
// LongTermMemory: Forget
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb LTM: Forget');

test('forget removes entry', () => {
  const ltm = new LongTermMemory({ userId: 'forget1' });
  ltm.write({ kind: 'preference', key: 'temp', value: 'x' });
  const result = ltm.forget({ kind: 'preference', key: 'temp', reason: 'user_rejected' });
  assertTrue(result.deleted, 'Should delete');
  assertEqual(result.reason, 'user_rejected', 'reason');
  assertEqual(ltm.read({ kind: 'preference', key: 'temp' }).code, 'NOT_FOUND', 'Gone');
});

test('forget non-existent returns deleted: false', () => {
  const ltm = new LongTermMemory({ userId: 'forget2' });
  const result = ltm.forget({ kind: 'preference', key: 'nope' });
  assertTrue(!result.deleted, 'Should not delete');
});

// ────────────────────────────────────────────────────────────────────────────
// LongTermMemory: Stats
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb LTM: Stats');

test('getStats returns breakdown by kind and source', () => {
  const ltm = new LongTermMemory({ userId: 'stats1' });
  ltm.write({ kind: 'preference', key: 'a', value: 1, source: 'explicit' });
  ltm.write({ kind: 'preference', key: 'b', value: 2, source: 'inferred' });
  ltm.write({ kind: 'pattern', key: 'c', value: 3, source: 'inferred' });

  const stats = ltm.getStats();
  assertEqual(stats.entries, 3, 'entries');
  assertEqual(stats.byKind.preference, 2, 'preference count');
  assertEqual(stats.byKind.pattern, 1, 'pattern count');
  assertEqual(stats.bySource.explicit, 1, 'explicit count');
  assertEqual(stats.bySource.inferred, 2, 'inferred count');
});

// ────────────────────────────────────────────────────────────────────────────
// AutoLearner: Observation
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb AutoLearner: Observation');

test('observe records observation', () => {
  const learner = new AutoLearner({ promotionThreshold: 3 });
  const result = learner.observe({ type: 'correction', key: 'format', value: 'no_pdf' });
  assertTrue(!result.learned, 'Should not learn on first');
  assertEqual(result.count, 1, 'count');
});

test('observe increments count', () => {
  const learner = new AutoLearner({ promotionThreshold: 3 });
  learner.observe({ type: 'correction', key: 'x', value: 'a' });
  learner.observe({ type: 'correction', key: 'x', value: 'a' });
  assertEqual(learner.getCount('correction', 'x'), 2, 'count');
});

test('observe below threshold does not promote', () => {
  const learner = new AutoLearner({ promotionThreshold: 5 });
  for (let i = 0; i < 4; i++) {
    const r = learner.observe({ type: 'preference', key: 'lang', value: 'cs' });
    assertTrue(!r.learned, `Should not learn at count ${i + 1}`);
  }
});

// ────────────────────────────────────────────────────────────────────────────
// AutoLearner: Promotion
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb AutoLearner: Promotion');

test('observe at threshold promotes to long-term', () => {
  const ltm = new LongTermMemory({ userId: 'learn1' });
  const learner = new AutoLearner({ promotionThreshold: 3, longTermMemory: ltm });

  learner.observe({ type: 'correction', key: 'answer_style', value: 'concise' });
  learner.observe({ type: 'correction', key: 'answer_style', value: 'concise' });
  const result = learner.observe({ type: 'correction', key: 'answer_style', value: 'concise' });

  assertTrue(result.learned, 'Should learn');
  assertEqual(result.kind, 'correction', 'kind');
  assertEqual(result.value, 'concise', 'value');
  assertTrue(result.confidence > 0.5, 'confidence > 0.5');

  // Verify it's in LTM
  const stored = ltm.read({ kind: 'correction', key: 'answer_style' });
  assertEqual(stored.value, 'concise', 'Should be in LTM');
});

test('inconsistent values prevent promotion', () => {
  const learner = new AutoLearner({ promotionThreshold: 3 });
  learner.observe({ type: 'preference', key: 'format', value: 'pdf' });
  learner.observe({ type: 'preference', key: 'format', value: 'docx' });
  const result = learner.observe({ type: 'preference', key: 'format', value: 'html' });

  assertTrue(!result.learned, 'Should not learn inconsistent');
});

test('promoted key is not re-promoted', () => {
  const ltm = new LongTermMemory({ userId: 'learn2' });
  const learner = new AutoLearner({ promotionThreshold: 2, longTermMemory: ltm });

  learner.observe({ type: 'correction', key: 'lang', value: 'cs' });
  learner.observe({ type: 'correction', key: 'lang', value: 'cs' });
  // Now promoted

  // Further observations should not re-promote
  const result = learner.observe({ type: 'correction', key: 'lang', value: 'cs' });
  assertTrue(!result.learned, 'Should not re-promote');
  assertTrue(learner.isPromoted('correction', 'lang'), 'isPromoted');
});

test('corrections use most recent value', () => {
  const ltm = new LongTermMemory({ userId: 'learn3' });
  const learner = new AutoLearner({ promotionThreshold: 3, longTermMemory: ltm });

  learner.observe({ type: 'correction', key: 'style', value: 'v1' });
  learner.observe({ type: 'correction', key: 'style', value: 'v2' });
  const result = learner.observe({ type: 'correction', key: 'style', value: 'v3' });

  assertTrue(result.learned, 'Should learn');
  assertEqual(result.value, 'v3', 'Should use most recent for corrections');
});

// ────────────────────────────────────────────────────────────────────────────
// AutoLearner: Stats
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb AutoLearner: Stats');

test('getStats returns observation counts', () => {
  const learner = new AutoLearner({ promotionThreshold: 3 });
  learner.observe({ type: 'correction', key: 'a', value: 1 });
  learner.observe({ type: 'preference', key: 'b', value: 2 });

  const stats = learner.getStats();
  assertEqual(stats.observed, 2, 'observed');
  assertEqual(stats.activeObservations, 2, 'activeObservations');
});

test('reset clears all state', () => {
  const learner = new AutoLearner({ promotionThreshold: 2 });
  learner.observe({ type: 'correction', key: 'x', value: 1 });
  learner.observe({ type: 'correction', key: 'x', value: 1 }); // promotes
  learner.reset();

  assertEqual(learner.getCount('correction', 'x'), 0, 'count reset');
  assertTrue(!learner.isPromoted('correction', 'x'), 'promoted reset');
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
