// tests/build-intent.test.js — BUILD intent detection + CRE invariants
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, assertThrows, summary } from './harness.js';
import {
  creDecisionEngine,
  DecisionType,
  IntentType,
  assertDecision,
  CREDecision,
} from '../src/chat/cre-decision.js';

// ═══════════════════════════════════════════════════════════════════════════════
suite('BUILD Pattern Detection — Czech');
// ═══════════════════════════════════════════════════════════════════════════════

const BUILD_CZ = [
  'postav mi REST API',
  'postav mi webovou aplikaci',
  'rozjeď mi cluster',
  'nasaď to na server',
  'deployni na produkci',
  'scaffoldni nový projekt',
  'nastav mi CI/CD pipeline',
  'nastav mi monitoring',
  'nastav mi infrastrukturu pro web',
  'automatizuj deployment',
  'vytvoř mi celý nový projekt',
  'postav mi celý stack',
  'chci mít monitoring',
  'potřebuji systém pro logování',
  'potřebuji aplikaci na objednávky',
  'jdeme stavět',
  'jdi stavět',
  'začni stavět',
  'spusť build',
  'připrav mi prostředí',
  'nakonfiguruj mi celý server',
];

for (const input of BUILD_CZ) {
  test(`CZ: "${input}" → BUILD`, () => {
    const intent = creDecisionEngine.classifyIntent(input);
    assertEqual(intent, IntentType.BUILD, `"${input}" classified as ${intent}, expected BUILD`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
suite('BUILD Pattern Detection — English');
// ═══════════════════════════════════════════════════════════════════════════════

const BUILD_EN = [
  'build me a REST API',
  'build me a project',
  'set up a server',
  'set up a monitoring pipeline',
  'create a full project',
  'create a complete new app',
  "let's build",
  'start building',
  'spin up a cluster',
  'provision infrastructure',
  'deploy to production',
  'scaffold a new project',
];

for (const input of BUILD_EN) {
  test(`EN: "${input}" → BUILD`, () => {
    const intent = creDecisionEngine.classifyIntent(input);
    assertEqual(intent, IntentType.BUILD, `"${input}" classified as ${intent}, expected BUILD`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
suite('BUILD vs CODE distinction');
// ═══════════════════════════════════════════════════════════════════════════════

const CODE_NOT_BUILD = [
  'napiš mi funkci pro sčítání',
  'write code for sorting',
  'oprav bug v parseru',
  'fix bug in handler',
  'refaktor tuhle třídu',
  'implementuj quicksort',
  'napiš kód pro validaci',
];

for (const input of CODE_NOT_BUILD) {
  test(`CODE not BUILD: "${input}"`, () => {
    const intent = creDecisionEngine.classifyIntent(input);
    assertEqual(intent, IntentType.CODE, `"${input}" classified as ${intent}, expected CODE`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
suite('BUILD vs other intents — no false positives');
// ═══════════════════════════════════════════════════════════════════════════════

const NOT_BUILD = [
  ['ahoj', IntentType.CONVERSATIONAL],
  ['jak se máš?', IntentType.CONVERSATIONAL],
  ['kolik je hodin?', IntentType.LOCAL],
  ['najdi mi restauraci', IntentType.SEARCH],
  ['vymysli mi kampaň', IntentType.CREATIVE],
  ['napiš báseň o jaru', IntentType.CREATIVE],
];

for (const [input, expected] of NOT_BUILD) {
  test(`Not BUILD: "${input}" → ${expected}`, () => {
    const intent = creDecisionEngine.classifyIntent(input);
    assertEqual(intent, expected, `"${input}" classified as ${intent}, expected ${expected}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
suite('CRE Decision: BUILD → PLAN routing');
// ═══════════════════════════════════════════════════════════════════════════════

test('BUILD intent produces PLAN decision', () => {
  const decision = creDecisionEngine.decide('postav mi REST API', {});
  assertEqual(decision.type, DecisionType.PLAN);
  assertEqual(decision.intent, IntentType.BUILD);
  assert(decision.tools.length === 0, 'PLAN should have no tools');
});

test('PLAN decision has buildRequest metadata', () => {
  const decision = creDecisionEngine.decide('build me a project', {});
  assert(decision.metadata?.buildRequest === true, 'Should have buildRequest metadata');
});

test('PLAN decision passes assertDecision', () => {
  const decision = creDecisionEngine.decide('postav mi celý stack', {});
  assert(assertDecision(decision) === true, 'assertDecision should return true');
});

// ═══════════════════════════════════════════════════════════════════════════════
suite('CRE Invariants — BUILD/PLAN constraints');
// ═══════════════════════════════════════════════════════════════════════════════

test('PLAN + non-BUILD intent throws', () => {
  assertThrows(() => {
    assertDecision({
      type: DecisionType.PLAN,
      intent: IntentType.SEARCH,
      tools: [],
      confidence: 0.9,
      reason: 'test',
      slots: [],
    });
  });
});

test('BUILD + ANSWER throws', () => {
  assertThrows(() => {
    assertDecision({
      type: DecisionType.ANSWER,
      intent: IntentType.BUILD,
      tools: [],
      confidence: 0.9,
      reason: 'test',
      slots: [],
    });
  });
});

test('BUILD + TOOL_CALL throws', () => {
  assertThrows(() => {
    assertDecision({
      type: DecisionType.TOOL_CALL,
      intent: IntentType.BUILD,
      tools: ['web.search'],
      confidence: 0.9,
      reason: 'test',
      slots: [],
    });
  });
});

test('Existing invariants still hold: CREATIVE + TOOL_CALL throws', () => {
  assertThrows(() => {
    assertDecision({
      type: DecisionType.TOOL_CALL,
      intent: IntentType.CREATIVE,
      tools: ['web.search'],
      confidence: 0.9,
      reason: 'test',
      slots: [],
    });
  });
});

test('Existing invariants still hold: LOCAL + TOOL_CALL throws (constructor)', () => {
  // LOCAL+TOOL_CALL is enforced in CREDecision constructor, not assertDecision
  assertThrows(() => {
    new CREDecision({
      type: DecisionType.TOOL_CALL,
      intent: IntentType.LOCAL,
      tools: ['web.search'],
      confidence: 0.9,
      reason: 'test',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════════
const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
