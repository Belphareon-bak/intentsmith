// CRE v37.2 Preference Engine + Preference Resolver Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests:
// - UserPreferences: get, set, serialize, defaults
// - PreferenceEngine: apply (verbosity, autoExecute, risk, technicalDepth)
// - PreferenceResolverService: observe, integration with LTM
// - Stop-conditions: same query → different decision for different user
//
// ══════════════════════════════════════════════════════════════════════════════

import { UserPreferences, PreferenceEngine, Verbosity, RiskTolerance, TechnicalDepth } from '../memory/preferences.js';
import { PreferenceResolverService } from '../chat/preference-resolver.js';
import { LongTermMemory, MemoryKind } from '../memory/long-term.js';
import { AutoLearner } from '../memory/learning.js';

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
console.log('  CRE v37.2 Preference Engine + Resolver Tests');
console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

// ────────────────────────────────────────────────────────────────────────────
// UserPreferences: Defaults
// ────────────────────────────────────────────────────────────────────────────

console.log('\ud83d\udccb UserPreferences: Defaults');

test('UserPreferences has correct defaults', () => {
  const prefs = new UserPreferences();
  assertEqual(prefs.verbosity, 'normal', 'verbosity');
  assertEqual(prefs.riskTolerance, 'medium', 'riskTolerance');
  assertEqual(prefs.technicalDepth, 'basic', 'technicalDepth');
  assertEqual(prefs.language, 'cs', 'language');
  assertEqual(prefs.autoExecute, false, 'autoExecute');
});

test('UserPreferences accepts initial values', () => {
  const prefs = new UserPreferences({ verbosity: 'minimal', language: 'en' });
  assertEqual(prefs.verbosity, 'minimal', 'verbosity');
  assertEqual(prefs.language, 'en', 'language');
});

test('get/set work for standard axes', () => {
  const prefs = new UserPreferences();
  prefs.set('verbosity', 'detailed');
  assertEqual(prefs.get('verbosity'), 'detailed', 'get after set');
});

test('get/set work for custom axes', () => {
  const prefs = new UserPreferences();
  prefs.set('avoid_formats', ['pdf']);
  assertEqual(prefs.get('avoid_formats')[0], 'pdf', 'custom axis');
});

test('toJSON serializes correctly', () => {
  const prefs = new UserPreferences({ verbosity: 'minimal', autoExecute: true });
  prefs.set('custom_key', 42);
  const json = prefs.toJSON();
  assertEqual(json.verbosity, 'minimal', 'verbosity');
  assertEqual(json.autoExecute, true, 'autoExecute');
  assertEqual(json.custom.custom_key, 42, 'custom');
});

test('fromJSON deserializes correctly', () => {
  const json = { verbosity: 'detailed', language: 'en', custom: { x: 1 } };
  const prefs = UserPreferences.fromJSON(json);
  assertEqual(prefs.verbosity, 'detailed', 'verbosity');
  assertEqual(prefs.language, 'en', 'language');
  assertEqual(prefs.custom.x, 1, 'custom');
});

// ────────────────────────────────────────────────────────────────────────────
// PreferenceEngine: Apply verbosity
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb PreferenceEngine: Verbosity');

test('NORMAL verbosity does not modify decision', () => {
  const engine = new PreferenceEngine({
    preferences: new UserPreferences({ verbosity: 'normal' }),
  });
  const decision = { type: 'ANSWER', template: 'factual', verbosity: 'normal' };
  const result = engine.apply(decision);
  assertEqual(result.verbosity, 'normal', 'unchanged');
});

test('MINIMAL verbosity modifies ANSWER decision', () => {
  const engine = new PreferenceEngine({
    preferences: new UserPreferences({ verbosity: 'minimal' }),
  });
  const decision = { type: 'ANSWER', template: 'factual', verbosity: 'normal' };
  const result = engine.apply(decision);
  assertEqual(result.verbosity, 'minimal', 'changed to minimal');
});

test('DETAILED verbosity modifies ANSWER decision', () => {
  const engine = new PreferenceEngine({
    preferences: new UserPreferences({ verbosity: 'detailed' }),
  });
  const decision = { type: 'ANSWER', template: 'factual', verbosity: 'normal' };
  const result = engine.apply(decision);
  assertEqual(result.verbosity, 'detailed', 'changed to detailed');
});

test('Verbosity does not affect non-ANSWER decisions', () => {
  const engine = new PreferenceEngine({
    preferences: new UserPreferences({ verbosity: 'minimal' }),
  });
  const decision = { type: 'TOOL_CALL', tool: 'web.search' };
  const result = engine.apply(decision);
  assertEqual(result.type, 'TOOL_CALL', 'type unchanged');
  assertTrue(result.verbosity === undefined, 'no verbosity added');
});

// ────────────────────────────────────────────────────────────────────────────
// PreferenceEngine: Auto-execute
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb PreferenceEngine: Auto-execute');

test('autoExecute=false does not modify ASK_USER', () => {
  const engine = new PreferenceEngine({
    preferences: new UserPreferences({ autoExecute: false }),
  });
  const decision = { type: 'ASK_USER', slots: [{ name: 'source' }], template: 'slot_request' };
  const result = engine.apply(decision);
  assertEqual(result.type, 'ASK_USER', 'Should stay ASK_USER');
});

test('autoExecute=true with known slot value resolves ASK_USER', () => {
  const ltm = new LongTermMemory({ userId: 'auto1' });
  ltm.write({ kind: 'preference', key: 'source', value: 'cars.cz' });

  const engine = new PreferenceEngine({
    preferences: new UserPreferences({ autoExecute: true, riskTolerance: 'medium' }),
    longTermMemory: ltm,
  });

  const decision = { type: 'ASK_USER', slots: [{ name: 'source' }], template: 'slot_request' };
  const result = engine.apply(decision);

  assertEqual(result.type, 'ANSWER', 'Should auto-resolve to ANSWER');
  assertTrue(result._autoResolved, 'Should be marked auto-resolved');
  assertEqual(result.data.slots.source, 'cars.cz', 'Should resolve from LTM');
});

test('autoExecute=true with unknown slot keeps ASK_USER', () => {
  const engine = new PreferenceEngine({
    preferences: new UserPreferences({ autoExecute: true, riskTolerance: 'medium' }),
  });

  const decision = { type: 'ASK_USER', slots: [{ name: 'unknown_slot' }], template: 'slot_request' };
  const result = engine.apply(decision);
  assertEqual(result.type, 'ASK_USER', 'Should stay ASK_USER');
});

test('autoExecute blocked when riskTolerance is LOW', () => {
  const ltm = new LongTermMemory({ userId: 'auto2' });
  ltm.write({ kind: 'preference', key: 'source', value: 'x' });

  const engine = new PreferenceEngine({
    preferences: new UserPreferences({ autoExecute: true, riskTolerance: 'low' }),
    longTermMemory: ltm,
  });

  const decision = { type: 'ASK_USER', slots: [{ name: 'source' }], template: 'x' };
  const result = engine.apply(decision);
  assertEqual(result.type, 'ASK_USER', 'LOW risk blocks auto-execute');
});

// ────────────────────────────────────────────────────────────────────────────
// PreferenceEngine: Risk tolerance
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb PreferenceEngine: Risk');

test('HIGH risk tolerance sets relaxGates hint', () => {
  const engine = new PreferenceEngine({
    preferences: new UserPreferences({ riskTolerance: 'high' }),
  });
  const decision = { type: 'TOOL_CALL', tool: 'fs.write' };
  const result = engine.apply(decision);
  assertTrue(result._preferenceHints?.relaxGates, 'Should set relaxGates');
});

test('MEDIUM risk tolerance does not set relaxGates', () => {
  const engine = new PreferenceEngine({
    preferences: new UserPreferences({ riskTolerance: 'medium' }),
  });
  const decision = { type: 'TOOL_CALL', tool: 'fs.write' };
  const result = engine.apply(decision);
  assertTrue(!result._preferenceHints?.relaxGates, 'Should not set relaxGates');
});

// ────────────────────────────────────────────────────────────────────────────
// PreferenceEngine: Technical depth
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb PreferenceEngine: Technical Depth');

test('ADVANCED technicalDepth sets hint on ANSWER', () => {
  const engine = new PreferenceEngine({
    preferences: new UserPreferences({ technicalDepth: 'advanced' }),
  });
  const decision = { type: 'ANSWER', template: 'factual', verbosity: 'normal' };
  const result = engine.apply(decision);
  assertTrue(result._preferenceHints?.technicalDetail, 'Should set technicalDetail');
});

test('BASIC technicalDepth does not set hint', () => {
  const engine = new PreferenceEngine({
    preferences: new UserPreferences({ technicalDepth: 'basic' }),
  });
  const decision = { type: 'ANSWER', template: 'factual', verbosity: 'normal' };
  const result = engine.apply(decision);
  assertTrue(!result._preferenceHints?.technicalDetail, 'Should not set hint');
});

// ────────────────────────────────────────────────────────────────────────────
// PreferenceResolverService: Integration
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb PreferenceResolver: Integration');

test('observePreference stores in LTM immediately', () => {
  const ltm = new LongTermMemory({ userId: 'resolve1' });
  const resolver = new PreferenceResolverService({ longTermMemory: ltm });
  resolver.init(ltm);

  resolver.observePreference('avoid_formats', ['pdf']);

  const stored = ltm.read({ kind: 'preference', key: 'avoid_formats' });
  assertEqual(stored.value[0], 'pdf', 'Should be in LTM');
  assertEqual(stored.source, 'explicit', 'source');
  assertEqual(stored.confidence, 1.0, 'confidence');
});

test('observePreference updates engine preference', () => {
  const resolver = new PreferenceResolverService();
  resolver.observePreference('verbosity', 'minimal');
  assertEqual(resolver.getPreferences().verbosity, 'minimal', 'Engine updated');
});

test('observeCorrection feeds AutoLearner', () => {
  const resolver = new PreferenceResolverService();
  resolver.observeCorrection('answer_style', 'concise');
  resolver.observeCorrection('answer_style', 'concise');
  // Below threshold, not promoted yet
  const stats = resolver.getStats();
  assertEqual(stats.learner.observed, 2, 'observed');
});

test('applyToDecision uses engine.apply', () => {
  const prefs = new UserPreferences({ verbosity: 'detailed' });
  const engine = new PreferenceEngine({ preferences: prefs });
  const resolver = new PreferenceResolverService({ engine });

  const decision = { type: 'ANSWER', template: 'factual', verbosity: 'normal' };
  const result = resolver.applyToDecision(decision);
  assertEqual(result.verbosity, 'detailed', 'Should apply preference');
});

// ────────────────────────────────────────────────────────────────────────────
// STOP-CONDITIONS v37.2
// ────────────────────────────────────────────────────────────────────────────

console.log('\n\ud83d\udccb Stop-Conditions v37.2');

test('Same decision → different result for different preferences', () => {
  // User A: minimal verbosity
  const engineA = new PreferenceEngine({
    preferences: new UserPreferences({ verbosity: 'minimal' }),
  });
  // User B: detailed verbosity
  const engineB = new PreferenceEngine({
    preferences: new UserPreferences({ verbosity: 'detailed' }),
  });

  const decision = { type: 'ANSWER', template: 'factual', verbosity: 'normal' };

  const resultA = engineA.apply(decision);
  const resultB = engineB.apply(decision);

  assertEqual(resultA.verbosity, 'minimal', 'User A: minimal');
  assertEqual(resultB.verbosity, 'detailed', 'User B: detailed');
  assertTrue(resultA.verbosity !== resultB.verbosity, 'Different for different users');
});

test('Preferences are not prompt-hack (no text in decision)', () => {
  const engine = new PreferenceEngine({
    preferences: new UserPreferences({ verbosity: 'detailed', technicalDepth: 'advanced' }),
  });

  const decision = { type: 'ANSWER', template: 'factual', verbosity: 'normal' };
  const result = engine.apply(decision);

  // Result should NOT contain any text about preferences
  const serialized = JSON.stringify(result);
  assertTrue(!serialized.includes('preferuješ'), 'No Czech preference text');
  assertTrue(!serialized.includes('you prefer'), 'No English preference text');
  assertTrue(!serialized.includes('because'), 'No explanation text');
});

test('CRE remains authority: null decision passes through unchanged', () => {
  const engine = new PreferenceEngine({
    preferences: new UserPreferences({ verbosity: 'detailed' }),
  });
  const result = engine.apply(null);
  assertEqual(result, null, 'null unchanged');
});

test('"uz mi nenabizej PDF" → preference stored, next decision reflects it', () => {
  const ltm = new LongTermMemory({ userId: 'stop1' });
  const resolver = new PreferenceResolverService({ longTermMemory: ltm });
  resolver.init(ltm);

  // User says "uz mi nenabizej PDF"
  resolver.observePreference('avoid_formats', ['pdf']);

  // Verify stored
  const stored = ltm.read({ kind: 'preference', key: 'avoid_formats' });
  assertEqual(stored.value[0], 'pdf', 'PDF preference stored');

  // Verify retrievable for next decision
  const prefs = ltm.queryByKind('preference');
  assertTrue(prefs.some(p => p.key === 'avoid_formats'), 'Queryable');
});

test('Preference can be forgotten / overwritten', () => {
  const ltm = new LongTermMemory({ userId: 'stop2' });
  ltm.write({ kind: 'preference', key: 'avoid_formats', value: ['pdf'] });

  // User changes mind
  ltm.forget({ kind: 'preference', key: 'avoid_formats', reason: 'user_changed_mind' });
  assertEqual(ltm.read({ kind: 'preference', key: 'avoid_formats' }).code, 'NOT_FOUND', 'Forgotten');

  // Or overwrite
  ltm.write({ kind: 'preference', key: 'avoid_formats', value: ['docx'] });
  assertEqual(ltm.read({ kind: 'preference', key: 'avoid_formats' }).value[0], 'docx', 'Overwritten');
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
