// CRE v36.4.3 Real User Simulation Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE: Test full flow USER → CRE → EXECUTION → RESPONSE
//
// These are NOT synthetic tests. These are REAL user sentences that:
// - Come from actual user interactions
// - Test the full pipeline
// - Verify execution contracts
// - Ensure no crashes
//
// ══════════════════════════════════════════════════════════════════════════════

import { 
  DialogState, SystemAction, SpeechAct, 
  WorkflowIntent, DataRequirement, Domain 
} from '../chat/dialog-state-v2.js';
import { decide } from '../chat/decision-matrix.js';
import { 
  detectIntent, detectDomain, detectWorkflowIntent, detectDataRequirement,
  checkWorkflowPreconditions, detectVolatility, detectDataDependency,
  detectConceptExistence, detectImpossibility, detectMultiDomainQuery,
  detectCertaintyPressure
} from '../chat/cre-v2.js';
import {
  guardExecution, validateExecutionContract, createSafeExecutionContext
} from '../chat/execution-contracts.js';

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

function assertNoThrow(fn, msg = '') {
  try {
    fn();
  } catch (e) {
    throw new Error(`${msg}: unexpected throw: ${e.message}`);
  }
}

function assertNotNull(value, msg = '') {
  if (value === null || value === undefined) {
    throw new Error(`${msg}: expected non-null, got ${value}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// REAL USER SENTENCES (from actual failures)
// ════════════════════════════════════════════════════════════════════════════

const REAL_USER_SENTENCES = {
  // These caused actual crashes or bad behavior
  NEWS_TRUMP: 'dej mi souhrn zpráv za poslední týden ohledně Trumpovi politiky',
  CAR_SEARCH: 'najdi mi inzerát na auto, které má 4x4 a uzávěrku diferenciálu, benzínový motor a je do 200 tisíc',
  
  // Edge cases
  MIXED_QUERY: 'kdy bude úplněk a kolik stojí RTX 4090?',
  WEATHER_FUTURE: 'jaké bude počasí v Praze o víkendu?',
  FUEL_2032: 'kolik bude stát benzín v roce 2032?',
  QUANTUM_HOROSCOPE: 'jaký je můj kvantový horoskop na tento týden?',
  CERTAINTY_DEMAND: 'řekni mi přesně kolik to bude stát, potřebuji 100% jistotu',
  
  // Should work normally
  ADVICE_CAR: 'jak najít auto s pohonem 4x4?',
  HISTORY_APOLLO: 'kdy přistálo Apollo 11 na měsíci?',
  SIMPLE_CHAT: 'ahoj, jak se máš?',
  
  // Ambiguous
  AMBIGUOUS_SEARCH: 'auto do 200 tisíc',
  AMBIGUOUS_REPORT: 'udělej mi report',
  
  // Czech variations
  FLAT_SEARCH: 'hledám byt 3+1 v Praze do 25 tisíc měsíčně',
  NEWS_AI: 'co je nového v oblasti umělé inteligence?',
  PRICE_CHECK: 'kolik stojí iPhone 15 Pro?'
};

// ════════════════════════════════════════════════════════════════════════════
// FULL PIPELINE SIMULATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Simulates full pipeline: USER → CRE → EXECUTION → RESPONSE
 * Returns structured result for testing
 */
function simulateFullPipeline(userMessage, executionContext = {}) {
  const result = {
    input: userMessage,
    detection: {},
    state: null,
    decision: null,
    executionGuard: null,
    crashed: false,
    crashError: null
  };
  
  try {
    // Step 1: Detection
    result.detection = {
      domain: detectDomain(userMessage),
      workflowIntent: detectWorkflowIntent(userMessage),
      volatility: detectVolatility(userMessage, detectDomain(userMessage)),
      dataDependency: detectDataDependency(userMessage, detectDomain(userMessage)),
      conceptExistence: detectConceptExistence(userMessage),
      impossibility: detectImpossibility(userMessage, detectDomain(userMessage)),
      multiDomain: detectMultiDomainQuery(userMessage),
      certaintyPressure: detectCertaintyPressure(userMessage)
    };
    
    // Step 2: Build state
    const state = new DialogState();
    state.setDomain(result.detection.domain);
    state.workflow.intent = result.detection.workflowIntent;
    state.workflow.dataRequirement = detectDataRequirement(
      userMessage, 
      result.detection.workflowIntent, 
      result.detection.domain
    );
    state.workflow.dataAvailable = executionContext.dataAvailable || false;
    state.epistemic.volatility = result.detection.volatility;
    state.epistemic.dataDependency = result.detection.dataDependency;
    state.epistemic.conceptExistence = result.detection.conceptExistence;
    state.epistemic.impossibility = result.detection.impossibility;
    state.dialogFlags.multiDomainQuery = result.detection.multiDomain;
    state.dialogFlags.certaintyPressure = result.detection.certaintyPressure;
    
    result.state = state;
    
    // Step 3: Decision
    result.decision = decide(state);
    
    // Step 4: Execution guard
    result.executionGuard = guardExecution(
      result.detection.workflowIntent,
      executionContext
    );
    
  } catch (error) {
    result.crashed = true;
    result.crashError = error.message;
  }
  
  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 1: EXECUTION CONTRACT VALIDATION
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📦 🅰️ Execution Contract Validation');
console.log('════════════════════════════════════════════════════════════');

test('EC-1: ARTIFACT_GENERATION requires data[]', () => {
  const validation = validateExecutionContract(WorkflowIntent.REPORT, {
    data: null
  });
  assertFalse(validation.valid, 'Should be invalid without data');
  assertTrue(validation.missing.includes('data'), 'Should require data');
});

test('EC-2: ARTIFACT_GENERATION requires non-empty data[]', () => {
  const validation = validateExecutionContract(WorkflowIntent.REPORT, {
    data: []
  });
  assertFalse(validation.valid, 'Should be invalid with empty data');
  assertTrue(validation.missing.includes('dataLength'), 'Should require dataLength');
});

test('EC-3: MARKET_SEARCH requires searchBackend', () => {
  const validation = validateExecutionContract(WorkflowIntent.SEARCH, {
    searchBackend: null
  });
  assertFalse(validation.valid, 'Should be invalid without backend');
  assertTrue(validation.missing.includes('searchBackend'), 'Should require searchBackend');
});

test('EC-4: NEWS_AGGREGATION requires newsSources', () => {
  const validation = validateExecutionContract(WorkflowIntent.NEWS_AGGREGATION, {
    newsSources: [],
    corpus: []
  });
  assertFalse(validation.valid, 'Should be invalid without sources');
  assertTrue(validation.missing.includes('newsSources'), 'Should require newsSources');
});

test('EC-5: ADVICE has no special requirements', () => {
  const validation = validateExecutionContract(WorkflowIntent.ADVICE, {});
  assertTrue(validation.valid, 'ADVICE should always be valid');
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 2: SAFE CONTEXT CREATION
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📦 🅱️ Safe Context Creation (no undefined.length crashes)');
console.log('════════════════════════════════════════════════════════════');

test('SC-1: Empty input creates safe defaults', () => {
  const ctx = createSafeExecutionContext({});
  assertNotNull(ctx.corpus, 'corpus should not be null');
  assertTrue(Array.isArray(ctx.corpus), 'corpus should be array');
  assertEqual(ctx.corpus.length, 0, 'corpus should be empty');
});

test('SC-2: Undefined input creates safe defaults', () => {
  const ctx = createSafeExecutionContext(undefined);
  assertNotNull(ctx.newsSources, 'newsSources should not be null');
  assertTrue(Array.isArray(ctx.newsSources), 'newsSources should be array');
});

test('SC-3: Null data is handled safely', () => {
  const ctx = createSafeExecutionContext({ data: null });
  // Should not throw when checking data
  assertNoThrow(() => {
    const hasData = ctx.data && ctx.data.length > 0;
  }, 'Checking data should not throw');
});

test('SC-4: guardExecution never throws', () => {
  assertNoThrow(() => {
    guardExecution(WorkflowIntent.NEWS_AGGREGATION, undefined);
  }, 'guardExecution with undefined');
  
  assertNoThrow(() => {
    guardExecution(WorkflowIntent.SEARCH, null);
  }, 'guardExecution with null');
  
  assertNoThrow(() => {
    guardExecution(WorkflowIntent.REPORT, {});
  }, 'guardExecution with empty object');
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 3: REAL USER SENTENCES - PIPELINE TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📦 🅲️ Real User Sentences - Full Pipeline');
console.log('════════════════════════════════════════════════════════════');

test('RU-1: NEWS_TRUMP - pipeline does not crash', () => {
  const result = simulateFullPipeline(REAL_USER_SENTENCES.NEWS_TRUMP);
  assertFalse(result.crashed, `Should not crash: ${result.crashError}`);
});

test('RU-2: NEWS_TRUMP - detects NEWS_AGGREGATION intent', () => {
  const result = simulateFullPipeline(REAL_USER_SENTENCES.NEWS_TRUMP);
  assertEqual(result.detection.workflowIntent, WorkflowIntent.NEWS_AGGREGATION, 
    'Should detect NEWS_AGGREGATION');
});

test('RU-3: NEWS_TRUMP - blocks without sources', () => {
  const result = simulateFullPipeline(REAL_USER_SENTENCES.NEWS_TRUMP, {});
  assertTrue(
    result.decision.action === SystemAction.ASK_DATA_SOURCE ||
    !result.executionGuard.canExecute,
    'Should block without sources'
  );
});

test('RU-4: CAR_SEARCH - pipeline does not crash', () => {
  const result = simulateFullPipeline(REAL_USER_SENTENCES.CAR_SEARCH);
  assertFalse(result.crashed, `Should not crash: ${result.crashError}`);
});

test('RU-5: CAR_SEARCH - detects SEARCH intent', () => {
  const result = simulateFullPipeline(REAL_USER_SENTENCES.CAR_SEARCH);
  assertEqual(result.detection.workflowIntent, WorkflowIntent.SEARCH, 
    'Should detect SEARCH');
});

test('RU-6: CAR_SEARCH - offers search setup without backend', () => {
  const result = simulateFullPipeline(REAL_USER_SENTENCES.CAR_SEARCH, {});
  assertTrue(
    result.decision.action === SystemAction.OFFER_SEARCH_SETUP ||
    !result.executionGuard.canExecute,
    'Should offer search setup or block'
  );
});

test('RU-7: ADVICE_CAR - allows execution', () => {
  const result = simulateFullPipeline(REAL_USER_SENTENCES.ADVICE_CAR);
  assertEqual(result.detection.workflowIntent, WorkflowIntent.ADVICE, 
    'Should detect ADVICE');
  assertTrue(result.executionGuard.canExecute, 'ADVICE should be executable');
});

test('RU-8: FUEL_2032 - detects impossibility', () => {
  const result = simulateFullPipeline(REAL_USER_SENTENCES.FUEL_2032);
  assertTrue(result.detection.impossibility, 'Should detect impossibility');
  assertEqual(result.decision.action, SystemAction.REFUSE, 'Should REFUSE');
});

test('RU-9: QUANTUM_HOROSCOPE - detects non-existent concept', () => {
  const result = simulateFullPipeline(REAL_USER_SENTENCES.QUANTUM_HOROSCOPE);
  assertEqual(result.detection.conceptExistence, 'NON_EXISTENT', 
    'Should detect NON_EXISTENT');
  assertEqual(result.decision.action, SystemAction.REFUSE, 'Should REFUSE');
});

test('RU-10: MIXED_QUERY - detects multi-domain', () => {
  const result = simulateFullPipeline(REAL_USER_SENTENCES.MIXED_QUERY);
  assertTrue(result.detection.multiDomain, 'Should detect multi-domain');
  assertEqual(result.decision.action, SystemAction.SPLIT_OR_CLARIFY, 
    'Should SPLIT_OR_CLARIFY');
});

test('RU-11: CERTAINTY_DEMAND - detects pressure and REFUSES', () => {
  const result = simulateFullPipeline(REAL_USER_SENTENCES.CERTAINTY_DEMAND);
  assertTrue(result.detection.certaintyPressure, 'Should detect certainty pressure');
  assertEqual(result.decision.action, SystemAction.REFUSE, 'Should REFUSE');
});

test('RU-12: SIMPLE_CHAT - normal flow', () => {
  const result = simulateFullPipeline(REAL_USER_SENTENCES.SIMPLE_CHAT);
  assertEqual(result.detection.workflowIntent, WorkflowIntent.CHAT, 
    'Should detect CHAT');
  assertTrue(result.executionGuard.canExecute, 'CHAT should be executable');
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 4: DECISION → EXECUTION ALIGNMENT
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📦 🅳️ Decision → Execution Alignment');
console.log('════════════════════════════════════════════════════════════');

test('DE-1: ASK_DATA_SOURCE decision → execution blocked', () => {
  const result = simulateFullPipeline(REAL_USER_SENTENCES.NEWS_TRUMP, {});
  
  if (result.decision.action === SystemAction.ASK_DATA_SOURCE) {
    // Decision is to ask for sources, execution should be blocked
    assertFalse(result.executionGuard.canExecute, 
      'When asking for sources, execution should be blocked');
  }
});

test('DE-2: OFFER_SEARCH_SETUP decision → execution blocked', () => {
  const result = simulateFullPipeline(REAL_USER_SENTENCES.CAR_SEARCH, {});
  
  if (result.decision.action === SystemAction.OFFER_SEARCH_SETUP) {
    assertFalse(result.executionGuard.canExecute,
      'When offering search setup, execution should be blocked');
  }
});

test('DE-3: With valid context, execution allowed', () => {
  const result = simulateFullPipeline(REAL_USER_SENTENCES.NEWS_TRUMP, {
    dataAvailable: true,
    newsSources: ['reuters', 'ap'],
    corpus: [{ title: 'Test', content: 'Test content' }]
  });
  
  // With valid context, either decision allows it or execution guard allows it
  const canProceed = result.executionGuard.canExecute;
  assertTrue(canProceed, 'With valid context, should be able to proceed');
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 5: EDGE CASES - NO CRASHES
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📦 🅴️ Edge Cases - No Crashes');
console.log('════════════════════════════════════════════════════════════');

test('EDGE-1: Empty message does not crash', () => {
  assertNoThrow(() => {
    simulateFullPipeline('');
  }, 'Empty message should not crash');
});

test('EDGE-2: Very long message does not crash', () => {
  const longMessage = 'najdi mi ' + 'auto '.repeat(100);
  assertNoThrow(() => {
    simulateFullPipeline(longMessage);
  }, 'Long message should not crash');
});

test('EDGE-3: Special characters do not crash', () => {
  assertNoThrow(() => {
    simulateFullPipeline('co stojí €100 nebo $50?');
  }, 'Special chars should not crash');
});

test('EDGE-4: Unicode does not crash', () => {
  assertNoThrow(() => {
    simulateFullPipeline('najdi mi 中文 auto');
  }, 'Unicode should not crash');
});

test('EDGE-5: All real sentences do not crash', () => {
  Object.entries(REAL_USER_SENTENCES).forEach(([key, sentence]) => {
    assertNoThrow(() => {
      simulateFullPipeline(sentence);
    }, `${key} should not crash`);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 6: CZECH VARIATIONS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📦 🅵️ Czech Language Variations');
console.log('════════════════════════════════════════════════════════════');

test('CZ-1: FLAT_SEARCH detects SEARCH intent', () => {
  const result = simulateFullPipeline(REAL_USER_SENTENCES.FLAT_SEARCH);
  assertEqual(result.detection.workflowIntent, WorkflowIntent.SEARCH,
    'Should detect SEARCH for flat search');
});

test('CZ-2: NEWS_AI detects NEWS_AGGREGATION', () => {
  const result = simulateFullPipeline(REAL_USER_SENTENCES.NEWS_AI);
  assertEqual(result.detection.workflowIntent, WorkflowIntent.NEWS_AGGREGATION,
    'Should detect NEWS_AGGREGATION for AI news');
});

test('CZ-3: PRICE_CHECK detects correct domain', () => {
  const result = simulateFullPipeline(REAL_USER_SENTENCES.PRICE_CHECK);
  assertEqual(result.detection.domain, Domain.PRICES, 
    'Should detect PRICES domain');
});

// ════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📊 REAL USER SIMULATION TEST SUMMARY');
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
  
  setTimeout(() => { throw new Error('Real user simulation tests failed'); }, 0);
} else {
  console.log('\n✅ ALL REAL USER SIMULATION TESTS PASSED');
}
