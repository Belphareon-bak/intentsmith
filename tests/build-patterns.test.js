import './helpers/isolated-test-db.js';

// BUILD Pattern Detection Tests
// ══════════════════════════════════════════════════════════════════════════════

import assert from 'node:assert/strict';
import { IntentType, DecisionType, CREDecisionEngine, CREDecision } from '../src/chat/cre-decision.js';

const engine = new CREDecisionEngine();
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}: ${e.message}`); }
}

console.log('\n═══ BUILD Pattern Detection Tests ═══\n');

// ── Czech BUILD ─────────────────────────────────────────────────────────────

console.log('── Czech BUILD ──');

const CZ = [
  'postav mi REST API', 'postav mi webovou aplikaci',
  'rozjeď mi Kubernetes cluster', 'nasaď to na server',
  'deployni to na produkci', 'scaffoldni nový projekt',
  'nastav mi infrastrukturu pro monitoring', 'nastav mi CI/CD pipeline',
  'automatizuj deployment', 'vytvoř mi celý nový projekt',
  'vytvoř mi kompletní stack', 'postav mi celý backend',
  'chci mít monitoring', 'potřebuji systém pro správu uživatelů',
  'jdeme stavět', 'jdi stavět API', 'začni stavět frontend',
  'spusť build', 'připrav mi prostředí pro vývoj',
];

for (const input of CZ) {
  test(`CZ: "${input}"`, () => {
    assert.equal(engine.classifyIntent(input), IntentType.BUILD);
  });
}

// ── English BUILD ───────────────────────────────────────────────────────────

console.log('\n── English BUILD ──');

const EN = [
  'build me a REST API', 'build a project with React and Express',
  'set up a new project with Docker', 'set up a server cluster',
  'create a full new project', 'create a complete stack with auth',
  "let's build a microservice", 'start building the frontend',
  'spin up a dev cluster', 'provision infrastructure for staging',
];

for (const input of EN) {
  test(`EN: "${input}"`, () => {
    assert.equal(engine.classifyIntent(input), IntentType.BUILD);
  });
}

// ── BUILD > CODE priority ───────────────────────────────────────────────────

console.log('\n── BUILD > CODE ──');

const priority = [
  'postav mi API',
  'build me a full stack app',
  'set up a project with testing',
  'vytvoř mi kompletní systém',
];

for (const input of priority) {
  test(`BUILD > CODE: "${input}"`, () => {
    assert.equal(engine.classifyIntent(input), IntentType.BUILD);
  });
}

// ── Non-BUILD (no false positives) ──────────────────────────────────────────

console.log('\n── Non-BUILD ──');

const NOT_BUILD = [
  ['napiš mi funkci na parsování JSON', 'should be CODE or other'],
  ['ahoj, jak se máš?', 'should be CONVERSATIONAL'],
  ['kolik je hodin?', 'should be LOCAL'],
  ['najdi mi 5 bytů v Praze', 'should be ITEM_LOOKUP'],
  ['díky za pomoc', 'should be CONVERSATIONAL'],
  ['napiš mi báseň o kočce', 'should be CREATIVE'],
  ['co je nového ve světě AI?', 'should be SEARCH or FACTUAL'],
];

for (const [input, reason] of NOT_BUILD) {
  test(`NOT BUILD: "${input}" (${reason})`, () => {
    assert.notEqual(engine.classifyIntent(input), IntentType.BUILD);
  });
}

// ── Decision invariants ─────────────────────────────────────────────────────

console.log('\n── Decision invariants ──');

test('PLAN decision requires BUILD intent', () => {
  assert.throws(() => {
    new CREDecision({ type: DecisionType.PLAN, intent: IntentType.SEARCH, tools: [], reason: 'x', confidence: 0.9 });
  });
});

test('BUILD intent requires PLAN decision', () => {
  assert.throws(() => {
    new CREDecision({ type: DecisionType.TOOL_CALL, intent: IntentType.BUILD, tools: ['x'], reason: 'x', confidence: 0.9 });
  });
});

test('Valid PLAN+BUILD works', () => {
  const d = new CREDecision({ type: DecisionType.PLAN, intent: IntentType.BUILD, tools: [], reason: 'x', confidence: 0.9 });
  assert.equal(d.type, DecisionType.PLAN);
  assert.equal(d.intent, IntentType.BUILD);
});

// ── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══\n`);
if (failed > 0) process.exit(1);
