// CRE v36.4.2 Workflow E2E Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE: Test Intent → Workflow → Execution pipeline
//
// These tests verify that:
// • NEWS_AGGREGATION triggers ASK_DATA_SOURCE (not artifact generation)
// • SEARCH triggers OFFER_SEARCH_SETUP (not generic advice)
// • REPORT without data triggers BLOCK_NO_DATA
// • Execution layer never receives undefined data
//
// ══════════════════════════════════════════════════════════════════════════════

import { 
  DialogState, SystemAction, SpeechAct, 
  WorkflowIntent, DataRequirement, Domain 
} from '../chat/dialog-state-v2.js';
import { decide } from '../chat/decision-matrix.js';
import { 
  detectIntent, detectDomain, detectWorkflowIntent, detectDataRequirement,
  checkWorkflowPreconditions
} from '../chat/cre-v2.js';

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

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) {
    throw new Error(`${msg}: expected true, got false`);
  }
}

function assertFalse(condition, msg = '') {
  if (condition) {
    throw new Error(`${msg}: expected false, got true`);
  }
}

function assertIncludes(arr, item, msg = '') {
  if (!arr.includes(item)) {
    throw new Error(`${msg}: expected ${item} in [${arr.join(', ')}]`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// WORKFLOW INTENT DETECTION TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📦 🅰️ Workflow Intent Detection');
console.log('════════════════════════════════════════════════════════════');

test('W-A1: News aggregation - "souhrn zpráv za týden"', () => {
  const message = 'dej mi souhrn zpráv za poslední týden ohledně Trumpovi politiky';
  const intent = detectWorkflowIntent(message);
  assertEqual(intent, WorkflowIntent.NEWS_AGGREGATION, 'Should detect NEWS_AGGREGATION');
});

test('W-A2: News aggregation - "co je nového"', () => {
  const message = 'co je nového v oblasti AI za posledních 7 dní?';
  const intent = detectWorkflowIntent(message);
  assertEqual(intent, WorkflowIntent.NEWS_AGGREGATION, 'Should detect NEWS_AGGREGATION');
});

test('W-A3: Search - "najdi mi inzerát"', () => {
  const message = 'najdi mi inzerát na auto s 4x4 a uzávěrkou do 200 tisíc';
  const intent = detectWorkflowIntent(message);
  assertEqual(intent, WorkflowIntent.SEARCH, 'Should detect SEARCH');
});

test('W-A4: Search - "hledám"', () => {
  const message = 'hledám byt 3+1 v Praze do 25 tisíc měsíčně';
  const intent = detectWorkflowIntent(message);
  assertEqual(intent, WorkflowIntent.SEARCH, 'Should detect SEARCH');
});

test('W-A5: Advice - "jak najít"', () => {
  const message = 'jak najít dobré auto s pohonem 4x4?';
  const intent = detectWorkflowIntent(message);
  assertEqual(intent, WorkflowIntent.ADVICE, 'Should detect ADVICE');
});

test('W-A6: Report - "vytvoř report"', () => {
  const message = 'vytvoř report o prodeji za minulý měsíc';
  const intent = detectWorkflowIntent(message);
  assertEqual(intent, WorkflowIntent.REPORT, 'Should detect REPORT');
});

test('W-A7: Chat - simple question', () => {
  const message = 'co je to kvantová mechanika?';
  const intent = detectWorkflowIntent(message);
  assertEqual(intent, WorkflowIntent.CHAT, 'Should detect CHAT');
});

// ════════════════════════════════════════════════════════════════════════════
// DATA REQUIREMENT DETECTION TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📦 🅱️ Data Requirement Detection');
console.log('════════════════════════════════════════════════════════════');

test('W-B1: NEWS_AGGREGATION requires CORPUS', () => {
  const req = detectDataRequirement('souhrn zpráv', WorkflowIntent.NEWS_AGGREGATION, Domain.NEWS);
  assertEqual(req, DataRequirement.CORPUS, 'NEWS should require CORPUS');
});

test('W-B2: SEARCH requires STRUCTURED', () => {
  const req = detectDataRequirement('najdi mi auto', WorkflowIntent.SEARCH, Domain.PRICES);
  assertEqual(req, DataRequirement.STRUCTURED, 'SEARCH should require STRUCTURED');
});

test('W-B3: ADVICE requires NONE', () => {
  const req = detectDataRequirement('jak najít', WorkflowIntent.ADVICE, Domain.UNKNOWN);
  assertEqual(req, DataRequirement.NONE, 'ADVICE should require NONE');
});

test('W-B4: REPORT on news requires CORPUS', () => {
  const req = detectDataRequirement('report o zprávách', WorkflowIntent.REPORT, Domain.NEWS);
  assertEqual(req, DataRequirement.CORPUS, 'NEWS REPORT should require CORPUS');
});

// ════════════════════════════════════════════════════════════════════════════
// WORKFLOW PRECONDITION TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📦 🅲️ Workflow Precondition Checks');
console.log('════════════════════════════════════════════════════════════');

test('W-C1: Preconditions met when no data required', () => {
  const state = new DialogState();
  state.workflow.intent = WorkflowIntent.ADVICE;
  state.workflow.dataRequirement = DataRequirement.NONE;
  
  const result = checkWorkflowPreconditions(state);
  assertTrue(result.met, 'Preconditions should be met');
  assertEqual(result.missing.length, 0, 'No missing items');
});

test('W-C2: Preconditions NOT met when CORPUS required but unavailable', () => {
  const state = new DialogState();
  state.workflow.intent = WorkflowIntent.NEWS_AGGREGATION;
  state.workflow.dataRequirement = DataRequirement.CORPUS;
  state.workflow.dataAvailable = false;
  
  const result = checkWorkflowPreconditions(state);
  assertFalse(result.met, 'Preconditions should NOT be met');
  assertTrue(result.missing.length > 0, 'Should have missing items');
  assertIncludes(result.missing, 'external_news_sources', 'Should require news sources');
});

test('W-C3: Preconditions NOT met when STRUCTURED required but unavailable', () => {
  const state = new DialogState();
  state.workflow.intent = WorkflowIntent.SEARCH;
  state.workflow.dataRequirement = DataRequirement.STRUCTURED;
  state.workflow.dataAvailable = false;
  
  const result = checkWorkflowPreconditions(state);
  assertFalse(result.met, 'Preconditions should NOT be met');
  assertIncludes(result.missing, 'search_backend', 'Should require search backend');
});

// ════════════════════════════════════════════════════════════════════════════
// DECISION MATRIX WORKFLOW TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📦 🅳️ Decision Matrix Workflow Rules');
console.log('════════════════════════════════════════════════════════════');

test('W-D1: NEWS without corpus → ASK_DATA_SOURCE', () => {
  const state = new DialogState();
  state.workflow.intent = WorkflowIntent.NEWS_AGGREGATION;
  state.workflow.dataRequirement = DataRequirement.CORPUS;
  state.workflow.dataAvailable = false;
  
  const decision = decide(state);
  assertEqual(decision.action, SystemAction.ASK_DATA_SOURCE, 'Should ASK_DATA_SOURCE');
  assertEqual(decision.speechAct, SpeechAct.QUESTION, 'Should be QUESTION');
});

test('W-D2: SEARCH without backend → OFFER_SEARCH_SETUP', () => {
  const state = new DialogState();
  state.workflow.intent = WorkflowIntent.SEARCH;
  state.workflow.dataRequirement = DataRequirement.STRUCTURED;
  state.workflow.dataAvailable = false;
  
  const decision = decide(state);
  assertEqual(decision.action, SystemAction.OFFER_SEARCH_SETUP, 'Should OFFER_SEARCH_SETUP');
});

test('W-D3: REPORT without data → BLOCK_NO_DATA', () => {
  const state = new DialogState();
  state.workflow.intent = WorkflowIntent.REPORT;
  state.workflow.dataRequirement = DataRequirement.STRUCTURED;
  state.workflow.dataAvailable = false;
  
  const decision = decide(state);
  assertEqual(decision.action, SystemAction.BLOCK_NO_DATA, 'Should BLOCK_NO_DATA');
});

test('W-D4: ADVICE → normal flow (not blocked)', () => {
  const state = new DialogState();
  state.workflow.intent = WorkflowIntent.ADVICE;
  state.workflow.dataRequirement = DataRequirement.NONE;
  
  const decision = decide(state);
  // Should NOT be blocked - should fall through to normal answer
  assertTrue(
    decision.action !== SystemAction.BLOCK_NO_DATA &&
    decision.action !== SystemAction.ASK_DATA_SOURCE,
    'ADVICE should not be blocked'
  );
});

// ════════════════════════════════════════════════════════════════════════════
// FULL WORKFLOW E2E TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📦 🅴️ Full Workflow E2E');
console.log('════════════════════════════════════════════════════════════');

test('W-E1: Full flow - News request without sources', () => {
  const message = 'dej mi souhrn zpráv za poslední týden ohledně Trumpovi politiky';
  
  // Step 1: Detect workflow intent
  const workflowIntent = detectWorkflowIntent(message);
  assertEqual(workflowIntent, WorkflowIntent.NEWS_AGGREGATION, 'Step 1: Detect intent');
  
  // Step 2: Detect data requirement
  const domain = detectDomain(message);
  const dataReq = detectDataRequirement(message, workflowIntent, domain);
  assertEqual(dataReq, DataRequirement.CORPUS, 'Step 2: Detect data requirement');
  
  // Step 3: Setup state
  const state = new DialogState();
  state.setDomain(domain);
  state.workflow.intent = workflowIntent;
  state.workflow.dataRequirement = dataReq;
  state.workflow.dataAvailable = false; // No sources configured
  
  // Step 4: Check preconditions
  const preconditions = checkWorkflowPreconditions(state);
  assertFalse(preconditions.met, 'Step 4: Preconditions not met');
  
  // Step 5: Decision
  const decision = decide(state);
  assertEqual(decision.action, SystemAction.ASK_DATA_SOURCE, 'Step 5: Correct decision');
  
  console.log('     ✓ Full news flow correctly blocked without sources');
});

test('W-E2: Full flow - Search request without backend', () => {
  const message = 'najdi mi inzerát na auto s 4x4 a uzávěrkou diferenciálu do 200 tisíc';
  
  // Step 1: Detect workflow intent
  const workflowIntent = detectWorkflowIntent(message);
  assertEqual(workflowIntent, WorkflowIntent.SEARCH, 'Step 1: Detect SEARCH intent');
  
  // Step 2: Setup state
  const state = new DialogState();
  state.workflow.intent = workflowIntent;
  state.workflow.dataRequirement = DataRequirement.STRUCTURED;
  state.workflow.dataAvailable = false;
  
  // Step 3: Decision
  const decision = decide(state);
  assertEqual(decision.action, SystemAction.OFFER_SEARCH_SETUP, 'Step 3: Correct decision');
  
  console.log('     ✓ Full search flow correctly offers setup');
});

test('W-E3: Full flow - Advice request (should work)', () => {
  const message = 'jak najít auto s pohonem 4x4 a uzávěrkou diferenciálu?';
  
  // Step 1: Detect workflow intent
  const workflowIntent = detectWorkflowIntent(message);
  assertEqual(workflowIntent, WorkflowIntent.ADVICE, 'Step 1: Detect ADVICE intent');
  
  // Step 2: Setup state
  const state = new DialogState();
  state.workflow.intent = workflowIntent;
  state.workflow.dataRequirement = DataRequirement.NONE;
  
  // Step 3: Decision - should NOT be blocked
  const decision = decide(state);
  assertTrue(
    decision.action !== SystemAction.BLOCK_NO_DATA &&
    decision.action !== SystemAction.ASK_DATA_SOURCE &&
    decision.action !== SystemAction.OFFER_SEARCH_SETUP,
    'Step 3: Should not be blocked'
  );
  
  console.log('     ✓ Advice request correctly proceeds');
});

// ════════════════════════════════════════════════════════════════════════════
// EXECUTION SAFETY TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📦 🅵️ Execution Safety');
console.log('════════════════════════════════════════════════════════════');

test('W-F1: Workflow state is never undefined', () => {
  const state = new DialogState();
  assertTrue(state.workflow !== undefined, 'workflow should exist');
  assertTrue(state.workflow !== null, 'workflow should not be null');
  assertTrue(state.workflow.intent !== undefined, 'workflow.intent should exist');
});

test('W-F2: DataRequirement defaults to NONE', () => {
  const state = new DialogState();
  assertEqual(state.workflow.dataRequirement, DataRequirement.NONE, 'Default should be NONE');
});

test('W-F3: dataAvailable defaults to false', () => {
  const state = new DialogState();
  assertEqual(state.workflow.dataAvailable, false, 'Default should be false');
});

// ════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📊 WORKFLOW TEST SUMMARY');
console.log('════════════════════════════════════════════════════════════');

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

console.log(`  ✅ Passed:  ${passed}`);
console.log(`  ❌ Failed:  ${failed}`);

if (failed > 0) {
  console.log('\n❌ FAILURES:');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`  ${r.name}: ${r.error}`);
  });
  
  setTimeout(() => { throw new Error('Workflow tests failed'); }, 0);
} else {
  console.log('\n✅ ALL WORKFLOW TESTS PASSED');
}
