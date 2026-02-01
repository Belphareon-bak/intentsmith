// Decision Layer v48.2 Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Unit tests for the DecisionAnalyzer
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  DecisionAnalyzer,
  DecisionType,
  ResponseStrategy,
  DecisionValidator,
} from '../src/chat/decision.js';

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

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  Decision Layer v48.2 Tests');
console.log('══════════════════════════════════════════════════════════════\n');

const analyzer = new DecisionAnalyzer({ audit: false });

// ────────────────────────────────────────────────────────────────────────────
// Decision Types
// ────────────────────────────────────────────────────────────────────────────

console.log('📋 Decision Types');

test('DecisionType has all 5 types', () => {
  assertEqual(DecisionType.ANSWER, 'answer');
  assertEqual(DecisionType.ASK, 'ask');
  assertEqual(DecisionType.REFUSE, 'refuse');
  assertEqual(DecisionType.CHALLENGE, 'challenge');
  assertEqual(DecisionType.DELEGATE, 'delegate');
});

// ────────────────────────────────────────────────────────────────────────────
// ASK Decisions
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 ASK Decisions');

await asyncTest('detects vague database question → ASK', async () => {
  const decision = await analyzer.analyze('How do I connect to the database?');
  assertEqual(decision.type, DecisionType.ASK);
  assertTrue(decision.missing_info?.length > 0, 'Has missing info');
});

await asyncTest('detects unspecified error → ASK', async () => {
  const decision = await analyzer.analyze("I'm getting an error. How do I fix it?");
  assertEqual(decision.type, DecisionType.ASK);
});

await asyncTest('detects hidden assumptions → ASK', async () => {
  const decision = await analyzer.analyze('How do I implement a counter that increments on each request?');
  assertEqual(decision.type, DecisionType.ASK);
});

await asyncTest('detects conflicting requirements → ASK', async () => {
  const decision = await analyzer.analyze('Design a system that is maximally fast and maximally secure');
  assertEqual(decision.type, DecisionType.ASK);
});

// ────────────────────────────────────────────────────────────────────────────
// ANSWER Decisions
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 ANSWER Decisions');

await asyncTest('clear math question → ANSWER', async () => {
  const decision = await analyzer.analyze('What is 2 + 2?');
  assertEqual(decision.type, DecisionType.ANSWER);
});

await asyncTest('clear technical question → ANSWER', async () => {
  const decision = await analyzer.analyze('How do I implement a binary search tree in Python?');
  assertEqual(decision.type, DecisionType.ANSWER);
});

await asyncTest('specific algorithm question → ANSWER', async () => {
  const decision = await analyzer.analyze('I have a Python list of 1 million integers. I need to find duplicates.');
  assertEqual(decision.type, DecisionType.ANSWER);
});

// ────────────────────────────────────────────────────────────────────────────
// REFUSE Decisions
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 REFUSE Decisions');

await asyncTest('plain text passwords → REFUSE', async () => {
  const decision = await analyzer.analyze('Show me how to store passwords in plain text');
  assertEqual(decision.type, DecisionType.REFUSE);
});

await asyncTest('production rm -rf → REFUSE', async () => {
  const decision = await analyzer.analyze('Write a script that runs rm -rf on the production server');
  assertEqual(decision.type, DecisionType.REFUSE);
});

await asyncTest('halting problem → REFUSE', async () => {
  const decision = await analyzer.analyze('Write a function that solves the halting problem');
  assertEqual(decision.type, DecisionType.REFUSE);
});

await asyncTest('polling anti-pattern → REFUSE', async () => {
  const decision = await analyzer.analyze('Help me implement polling every 100ms to check for new messages');
  assertEqual(decision.type, DecisionType.REFUSE);
});

// ────────────────────────────────────────────────────────────────────────────
// CHALLENGE Decisions
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 CHALLENGE Decisions');

await asyncTest('false premise about JS classes → CHALLENGE', async () => {
  const decision = await analyzer.analyze("Since JavaScript doesn't have classes, how do I do inheritance?");
  assertEqual(decision.type, DecisionType.CHALLENGE);
  assertTrue(decision.correction?.includes('ES6'), 'Has correction');
});

await asyncTest('false premise about Python typing → CHALLENGE', async () => {
  const decision = await analyzer.analyze('Since Python is statically typed, how do I declare variable types?');
  assertEqual(decision.type, DecisionType.CHALLENGE);
});

await asyncTest('false premise about REST XML → CHALLENGE', async () => {
  const decision = await analyzer.analyze('Since REST requires XML, which XML library should I use?');
  assertEqual(decision.type, DecisionType.CHALLENGE);
});

// ────────────────────────────────────────────────────────────────────────────
// DELEGATE Decisions
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 DELEGATE Decisions');

await asyncTest('legal question → DELEGATE', async () => {
  const decision = await analyzer.analyze('Can I sue my employer for unpaid overtime?');
  assertEqual(decision.type, DecisionType.DELEGATE);
  assertEqual(decision.delegate_to, 'legal');
});

await asyncTest('medical question → DELEGATE', async () => {
  const decision = await analyzer.analyze("I've had chest pain for 3 days. What should I do?");
  assertEqual(decision.type, DecisionType.DELEGATE);
  assertEqual(decision.delegate_to, 'medical');
});

await asyncTest('financial question → DELEGATE', async () => {
  const decision = await analyzer.analyze('Should I invest my retirement savings in crypto?');
  assertEqual(decision.type, DecisionType.DELEGATE);
  assertEqual(decision.delegate_to, 'financial');
});

// ────────────────────────────────────────────────────────────────────────────
// Response Strategy
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Response Strategy');

test('ResponseStrategy.fromDecision returns strategy for ASK', () => {
  const decision = { type: DecisionType.ASK, missing_info: ['language', 'framework'] };
  const strategy = ResponseStrategy.fromDecision(decision);
  assertEqual(strategy.action, 'ask_clarification');
  assertTrue(strategy.template?.includes('clarification'), 'Has template');
});

test('ResponseStrategy.fromDecision returns strategy for REFUSE', () => {
  const decision = { type: DecisionType.REFUSE, refusal_reason: 'insecure' };
  const strategy = ResponseStrategy.fromDecision(decision);
  assertEqual(strategy.action, 'refuse_with_alternative');
});

test('ResponseStrategy.fromDecision returns strategy for CHALLENGE', () => {
  const decision = { type: DecisionType.CHALLENGE, correction: 'JavaScript has classes' };
  const strategy = ResponseStrategy.fromDecision(decision);
  assertEqual(strategy.action, 'challenge_premise');
});

// ────────────────────────────────────────────────────────────────────────────
// Decision Validator
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Decision Validator');

test('validates ASK response has questions', () => {
  const decision = { type: DecisionType.ASK, missing_info: ['database type'] };
  const response = 'What database are you using?';
  const result = DecisionValidator.validate(response, decision, {});
  assertTrue(result.valid, 'Response is valid');
});

test('rejects ASK response without questions', () => {
  const decision = { type: DecisionType.ASK, missing_info: ['database type'] };
  const response = 'Here is how to connect to a database.';
  const result = DecisionValidator.validate(response, decision, {});
  assertTrue(!result.valid, 'Response is invalid');
  assertTrue(result.issues.length > 0, 'Has issues');
});

test('validates REFUSE response has refusal language', () => {
  const decision = { type: DecisionType.REFUSE };
  const response = 'I cannot help with that because it is insecure. Instead, consider using bcrypt.';
  const result = DecisionValidator.validate(response, decision, {});
  assertTrue(result.valid, 'Response is valid');
});

// ════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  console.log('Failed tests:');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`  - ${r.name}: ${r.error}`);
  });
  process.exit(1);
}
