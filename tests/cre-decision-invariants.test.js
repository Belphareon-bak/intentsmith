// CRE Decision Invariants Test
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests that verify the critical invariants:
// 1. SEARCH/FACTUAL/REPORT → TOOL_CALL (never ANSWER)
// 2. ANSWER only for CONVERSATIONAL
// 3. Forbidden phrases are blocked
//
// ══════════════════════════════════════════════════════════════════════════════

import assert from 'assert';
import {
  creDecisionEngine,
  CREDecision,
  DecisionType,
  IntentType,
  assertDecision,
  assertNoDirectAnswer,
  FORBIDDEN_PHRASES,
} from '../src/unification/cre-decision.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    return true;
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(`  Error: ${err.message}`);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REAL-WORLD REGRESSION TESTS
// These are the actual queries that FAILED before the fix
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(' CRE Decision Invariants - Real-World Regression Tests');
console.log('══════════════════════════════════════════════════════════════════════\n');

let passed = 0;
let failed = 0;

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT 1: SEARCH intent NEVER returns ANSWER
// ─────────────────────────────────────────────────────────────────────────────

console.log('--- INVARIANT 1: SEARCH intent never returns ANSWER ---\n');

const SEARCH_QUERIES = [
  'najdi mi auto 4x4 do 200k',
  'jaká je aktuální cena bitcoinu?',
  'co je to React?',
  'kdo je prezident USA?',
  'kde najdu dokumentaci k Node.js?',
  'kdy je příští Apple keynote?',
  'vyhledej nejlepší restaurace v Praze',
  'find the latest iPhone price',
  'what is the current weather in Prague?',
  'who won the last Super Bowl?',
];

for (const query of SEARCH_QUERIES) {
  if (test(`SEARCH: "${query.substring(0, 40)}..." → TOOL_CALL`, () => {
    const decision = creDecisionEngine.decide(query);
    assert.strictEqual(decision.type, DecisionType.TOOL_CALL,
      `Expected TOOL_CALL but got ${decision.type} for "${query}"`);
    assert.ok(decision.tools.includes('web.search'),
      `Expected web.search in tools but got ${decision.tools}`);
  })) passed++; else failed++;
}

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT 2: FACTUAL intent NEVER returns ANSWER
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- INVARIANT 2: FACTUAL intent never returns ANSWER ---\n');

const FACTUAL_QUERIES = [
  'jaké je počasí v Praze?',
  'kolik stojí bitcoin?',
  'kurz dolaru',
  'akcie Tesla',
  'crypto news',
  'výsledky fotbalu',
  'weather in London',
  'stock price of Apple',
];

for (const query of FACTUAL_QUERIES) {
  if (test(`FACTUAL: "${query}" → TOOL_CALL`, () => {
    const decision = creDecisionEngine.decide(query);
    assert.strictEqual(decision.type, DecisionType.TOOL_CALL,
      `Expected TOOL_CALL but got ${decision.type} for "${query}"`);
  })) passed++; else failed++;
}

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT 3: REPORT intent NEVER returns ANSWER
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- INVARIANT 3: REPORT intent never returns ANSWER ---\n');

const REPORT_QUERIES = [
  'vytvoř report o AI trendech',
  'analyzuj konkurenci na trhu',
  'shrň mi tenhle článek',
  'porovnej iPhone a Samsung',
  'přehled elektromobilů na trhu',
  'create a report on market trends',
  'analyze the competition',
];

for (const query of REPORT_QUERIES) {
  if (test(`REPORT: "${query}" → TOOL_CALL`, () => {
    const decision = creDecisionEngine.decide(query);
    assert.strictEqual(decision.type, DecisionType.TOOL_CALL,
      `Expected TOOL_CALL but got ${decision.type} for "${query}"`);
  })) passed++; else failed++;
}

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT 4: ANSWER is ONLY allowed for CONVERSATIONAL
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- INVARIANT 4: ANSWER only for CONVERSATIONAL ---\n');

const CONVERSATIONAL_QUERIES = [
  'ahoj!',
  'čau',
  'hello',
  'díky',
  'thanks',
  'jak se máš?',
  'how are you?',
];

for (const query of CONVERSATIONAL_QUERIES) {
  if (test(`CONVERSATIONAL: "${query}" → ANSWER allowed`, () => {
    const decision = creDecisionEngine.decide(query);
    assert.strictEqual(decision.type, DecisionType.ANSWER,
      `Expected ANSWER but got ${decision.type} for "${query}"`);
    assert.strictEqual(decision.intent, IntentType.CONVERSATIONAL,
      `Expected CONVERSATIONAL but got ${decision.intent}`);
  })) passed++; else failed++;
}

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT 5: CREDecision constructor throws for invalid ANSWER
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- INVARIANT 5: Constructor rejects invalid ANSWER ---\n');

if (test('ANSWER + SEARCH intent throws error', () => {
  assert.throws(() => {
    new CREDecision({
      type: DecisionType.ANSWER,
      intent: IntentType.SEARCH,
      reason: 'This should fail',
    });
  }, /ANSWER_NOT_ALLOWED_FOR_INTENT/);
})) passed++; else failed++;

if (test('ANSWER + FACTUAL intent throws error', () => {
  assert.throws(() => {
    new CREDecision({
      type: DecisionType.ANSWER,
      intent: IntentType.FACTUAL,
      reason: 'This should fail',
    });
  }, /ANSWER_NOT_ALLOWED_FOR_INTENT/);
})) passed++; else failed++;

if (test('ANSWER + REPORT intent throws error', () => {
  assert.throws(() => {
    new CREDecision({
      type: DecisionType.ANSWER,
      intent: IntentType.REPORT,
      reason: 'This should fail',
    });
  }, /ANSWER_NOT_ALLOWED_FOR_INTENT/);
})) passed++; else failed++;

if (test('ANSWER + CONVERSATIONAL intent is allowed', () => {
  const decision = new CREDecision({
    type: DecisionType.ANSWER,
    intent: IntentType.CONVERSATIONAL,
    reason: 'This should work',
  });
  assert.strictEqual(decision.type, DecisionType.ANSWER);
})) passed++; else failed++;

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT 6: assertDecision catches invalid decisions
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- INVARIANT 6: assertDecision validation ---\n');

if (test('assertDecision passes for valid TOOL_CALL', () => {
  const decision = creDecisionEngine.decide('najdi mi něco');
  assert.ok(assertDecision(decision));
})) passed++; else failed++;

if (test('assertDecision passes for valid ANSWER', () => {
  const decision = creDecisionEngine.decide('ahoj');
  assert.ok(assertDecision(decision));
})) passed++; else failed++;

if (test('assertNoDirectAnswer throws for SEARCH', () => {
  assert.throws(() => {
    assertNoDirectAnswer(IntentType.SEARCH);
  }, /DIRECT_ANSWER_FORBIDDEN/);
})) passed++; else failed++;

if (test('assertNoDirectAnswer passes for CONVERSATIONAL', () => {
  assertNoDirectAnswer(IntentType.CONVERSATIONAL); // Should not throw
})) passed++; else failed++;

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT 7: Forbidden phrases are detected
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- INVARIANT 7: Forbidden phrases detection ---\n');

const FORBIDDEN_RESPONSES = [
  'Omlouvám se, ale nemám přístup k aktuálním datům.',
  'Nemohu vyhledávat na internetu.',
  'Potřebuji URL, abych mohl pokračovat.',
  'Nemám k dispozici aktuální informace.',
  'I cannot browse the internet.',
  'I don\'t have access to real-time data.',
  'Please provide a URL.',
];

for (const response of FORBIDDEN_RESPONSES) {
  if (test(`Detects forbidden: "${response.substring(0, 35)}..."`, () => {
    const validation = creDecisionEngine.validateResponse(response);
    assert.strictEqual(validation.valid, false,
      `Expected invalid but got valid for "${response}"`);
    assert.ok(validation.violations.length > 0,
      `Expected violations but got none`);
  })) passed++; else failed++;
}

if (test('Allows clean response', () => {
  const validation = creDecisionEngine.validateResponse('Ahoj! Jak ti mohu pomoci?');
  assert.strictEqual(validation.valid, true);
  assert.strictEqual(validation.violations.length, 0);
})) passed++; else failed++;

// ─────────────────────────────────────────────────────────────────────────────
// CODE intent without project context
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n--- CODE intent without project context ---\n');

if (test('CODE without project → ASK_USER', () => {
  const decision = creDecisionEngine.decide('napiš mi funkci pro sčítání', {});
  assert.strictEqual(decision.type, DecisionType.ASK_USER,
    `Expected ASK_USER but got ${decision.type}`);
  assert.ok(decision.slots.includes('project_context'),
    `Expected project_context slot`);
})) passed++; else failed++;

if (test('CODE with project → TOOL_CALL', () => {
  const decision = creDecisionEngine.decide('napiš mi funkci pro sčítání', {
    hasActiveProject: true,
  });
  assert.strictEqual(decision.type, DecisionType.TOOL_CALL,
    `Expected TOOL_CALL but got ${decision.type}`);
})) passed++; else failed++;

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(` Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
