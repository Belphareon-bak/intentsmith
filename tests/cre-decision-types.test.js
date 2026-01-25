// CRE v36.8 Decision Types Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests for Tool-First CREDecision Contract
//
// ══════════════════════════════════════════════════════════════════════════════

import {
  ToolName,
  RefusalReason,
  ResponseTemplate,
  Verbosity,
  toolCall,
  askUser,
  refuse,
  answer,
  multiStep,
  createSlotRequest,
  validateDecision,
  isToolCall,
  isAskUser,
  isRefuse,
  isAnswer,
  isMultiStep,
  fromLegacyResult,
  hasLegacyText
} from '../src/chat/cre-decision-types.js';

import {
  ResponseRenderer,
  responseRenderer,
  renderDecision
} from '../src/chat/response-renderer.js';

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
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

function assertFalse(condition, msg = '') {
  if (condition) throw new Error(msg || 'Expected false');
}

function assertContains(str, substr, msg = '') {
  if (!str.includes(substr)) {
    throw new Error(`${msg}: "${str}" should contain "${substr}"`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 1: DECISION CREATORS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('🏗️  DECISION CREATORS');
console.log('════════════════════════════════════════════════════════════');

test('toolCall creates valid TOOL_CALL decision', () => {
  const decision = toolCall('web.search', { query: 'test' });
  
  assertEqual(decision.type, 'TOOL_CALL');
  assertEqual(decision.tool, 'web.search');
  assertEqual(decision.params.query, 'test');
  assertEqual(decision.then, null);
});

test('toolCall with then creates chained decision', () => {
  const thenDecision = answer('factual_answer');
  const decision = toolCall('web.search', { query: 'test' }, thenDecision);
  
  assertEqual(decision.type, 'TOOL_CALL');
  assertEqual(decision.then.type, 'ANSWER');
});

test('askUser creates valid ASK_USER decision', () => {
  const slots = [createSlotRequest('location', 'text')];
  const decision = askUser(slots, ResponseTemplate.SLOT_REQUEST);
  
  assertEqual(decision.type, 'ASK_USER');
  assertEqual(decision.slots.length, 1);
  assertEqual(decision.slots[0].name, 'location');
  assertEqual(decision.template, 'slot_request');
});

test('askUser accepts single slot without array', () => {
  const slot = createSlotRequest('year', 'number');
  const decision = askUser(slot);
  
  assertEqual(decision.type, 'ASK_USER');
  assertEqual(decision.slots.length, 1);
});

test('refuse creates valid REFUSE decision', () => {
  const decision = refuse('OUT_OF_SCOPE', ['Try asking differently']);
  
  assertEqual(decision.type, 'REFUSE');
  assertEqual(decision.reason, 'OUT_OF_SCOPE');
  assertEqual(decision.alternatives.length, 1);
});

test('answer creates valid ANSWER decision', () => {
  const decision = answer('factual_answer', { data: { fact: 'test' } });
  
  assertEqual(decision.type, 'ANSWER');
  assertEqual(decision.template, 'factual_answer');
  assertEqual(decision.data.fact, 'test');
  assertEqual(decision.verbosity, 'normal');
});

test('answer accepts dataRef instead of data', () => {
  const decision = answer('search_results', { dataRef: 'step_1_results' });
  
  assertEqual(decision.type, 'ANSWER');
  assertEqual(decision.dataRef, 'step_1_results');
  assertEqual(decision.data, null);
});

test('multiStep creates valid MULTI_STEP decision', () => {
  const steps = [
    toolCall('web.search', { query: 'test' }),
    answer('search_results', { dataRef: 'step_0' })
  ];
  const decision = multiStep(steps, false);
  
  assertEqual(decision.type, 'MULTI_STEP');
  assertEqual(decision.steps.length, 2);
  assertEqual(decision.parallel, false);
});

test('multiStep parallel flag works', () => {
  const steps = [
    toolCall('web.search', { query: 'a' }),
    toolCall('web.search', { query: 'b' })
  ];
  const decision = multiStep(steps, true);
  
  assertEqual(decision.parallel, true);
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 2: SLOT REQUESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📋 SLOT REQUESTS');
console.log('════════════════════════════════════════════════════════════');

test('createSlotRequest with minimal params', () => {
  const slot = createSlotRequest('name', 'text');
  
  assertEqual(slot.name, 'name');
  assertEqual(slot.type, 'text');
  assertEqual(slot.required, true);
  assertEqual(slot.default, null);
});

test('createSlotRequest with options', () => {
  const slot = createSlotRequest('format', 'select', {
    description: 'Output format',
    options: ['pdf', 'docx', 'html'],
    default: 'pdf',
    required: false
  });
  
  assertEqual(slot.name, 'format');
  assertEqual(slot.type, 'select');
  assertEqual(slot.description, 'Output format');
  assertEqual(slot.options.length, 3);
  assertEqual(slot.default, 'pdf');
  assertEqual(slot.required, false);
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 3: DECISION VALIDATION
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('✔️  DECISION VALIDATION');
console.log('════════════════════════════════════════════════════════════');

test('validateDecision passes valid TOOL_CALL', () => {
  const decision = toolCall('web.search', { query: 'test' });
  const result = validateDecision(decision);
  
  assertTrue(result.valid, 'Should be valid');
  assertEqual(result.errors.length, 0);
});

test('validateDecision fails on null', () => {
  const result = validateDecision(null);
  
  assertFalse(result.valid);
  assertContains(result.errors[0], 'null');
});

test('validateDecision fails on missing type', () => {
  const result = validateDecision({ tool: 'test' });
  
  assertFalse(result.valid);
  assertContains(result.errors[0], 'type');
});

test('validateDecision fails on TOOL_CALL without tool', () => {
  const result = validateDecision({ type: 'TOOL_CALL', params: {} });
  
  assertFalse(result.valid);
  assertContains(result.errors[0], 'tool');
});

test('validateDecision fails on ASK_USER without slots', () => {
  const result = validateDecision({ 
    type: 'ASK_USER', 
    template: 'slot_request' 
  });
  
  assertFalse(result.valid);
  assertContains(result.errors[0], 'slots');
});

test('validateDecision fails on REFUSE without reason', () => {
  const result = validateDecision({ type: 'REFUSE' });
  
  assertFalse(result.valid);
  assertContains(result.errors[0], 'reason');
});

test('validateDecision fails on ANSWER without template', () => {
  const result = validateDecision({ type: 'ANSWER', data: {} });
  
  assertFalse(result.valid);
  assertContains(result.errors[0], 'template');
});

test('validateDecision REJECTS ANSWER with content string', () => {
  const result = validateDecision({ 
    type: 'ANSWER', 
    template: 'factual_answer',
    content: 'This should not be here!'  // FORBIDDEN
  });
  
  assertFalse(result.valid, 'ANSWER with content string should be invalid');
  assertContains(result.errors[0], 'content');
});

test('validateDecision validates nested MULTI_STEP', () => {
  const decision = multiStep([
    toolCall('web.search', { query: 'test' }),
    { type: 'ANSWER' }  // Invalid - missing template
  ]);
  
  const result = validateDecision(decision);
  
  assertFalse(result.valid);
  assertContains(result.errors[0], 'Step 1');
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 4: TYPE CHECKERS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('🔍 TYPE CHECKERS');
console.log('════════════════════════════════════════════════════════════');

test('isToolCall identifies TOOL_CALL', () => {
  assertTrue(isToolCall({ type: 'TOOL_CALL' }));
  assertFalse(isToolCall({ type: 'ANSWER' }));
  assertFalse(isToolCall(null));
});

test('isAskUser identifies ASK_USER', () => {
  assertTrue(isAskUser({ type: 'ASK_USER' }));
  assertFalse(isAskUser({ type: 'TOOL_CALL' }));
});

test('isRefuse identifies REFUSE', () => {
  assertTrue(isRefuse({ type: 'REFUSE' }));
  assertFalse(isRefuse({ type: 'ANSWER' }));
});

test('isAnswer identifies ANSWER', () => {
  assertTrue(isAnswer({ type: 'ANSWER' }));
  assertFalse(isAnswer({ type: 'REFUSE' }));
});

test('isMultiStep identifies MULTI_STEP', () => {
  assertTrue(isMultiStep({ type: 'MULTI_STEP' }));
  assertFalse(isMultiStep({ type: 'TOOL_CALL' }));
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 5: LEGACY COMPATIBILITY
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('🔄 LEGACY COMPATIBILITY');
console.log('════════════════════════════════════════════════════════════');

test('fromLegacyResult converts REFUSE action', () => {
  const decision = fromLegacyResult('Cannot do that', null, 'REFUSE');
  
  assertEqual(decision.type, 'REFUSE');
  assertEqual(decision.reason, 'OUT_OF_SCOPE');
  assertEqual(decision.context.legacyText, 'Cannot do that');
});

test('fromLegacyResult converts generic action to ANSWER', () => {
  const decision = fromLegacyResult('Some answer', 'ASSERTION', 'ANSWER');
  
  assertEqual(decision.type, 'ANSWER');
  assertEqual(decision.template, 'factual_answer');
  assertEqual(decision.context.legacyText, 'Some answer');
});

test('hasLegacyText detects legacy decisions', () => {
  const legacyDecision = fromLegacyResult('Old text', null, 'ANSWER');
  const newDecision = answer('factual_answer', { data: {} });
  
  assertTrue(hasLegacyText(legacyDecision));
  assertFalse(hasLegacyText(newDecision));
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 6: RESPONSE RENDERER
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📝 RESPONSE RENDERER');
console.log('════════════════════════════════════════════════════════════');

await asyncTest('renderer handles ASK_USER with slot', async () => {
  const decision = askUser([createSlotRequest('year', 'number')]);
  const result = await renderDecision(decision);
  
  assertContains(result.text, 'rok');
  assertEqual(result.metadata.template, 'slot_request');
});

await asyncTest('renderer handles REFUSE with reason', async () => {
  const decision = refuse('CAPABILITY_NOT_AVAILABLE');
  const result = await renderDecision(decision);
  
  assertContains(result.text, 'není');
  assertEqual(result.metadata.reason, 'CAPABILITY_NOT_AVAILABLE');
});

await asyncTest('renderer handles REFUSE with alternatives', async () => {
  const decision = refuse('OUT_OF_SCOPE', ['Option 1', 'Option 2']);
  const result = await renderDecision(decision);
  
  assertContains(result.text, 'Option 1');
  assertContains(result.text, 'Option 2');
});

await asyncTest('renderer handles ANSWER confirmation', async () => {
  const decision = answer(ResponseTemplate.CONFIRMATION);
  const result = await renderDecision(decision);
  
  assertContains(result.text, '✅');
});

await asyncTest('renderer handles ANSWER greeting', async () => {
  const decision = answer(ResponseTemplate.GREETING);
  const result = await renderDecision(decision);
  
  assertContains(result.text.toLowerCase(), 'ahoj');
});

await asyncTest('renderer handles search results with data', async () => {
  const decision = answer(ResponseTemplate.SEARCH_RESULTS, {
    data: [
      { title: 'Result 1', description: 'First result' },
      { title: 'Result 2', description: 'Second result' }
    ]
  });
  const result = await renderDecision(decision);
  
  assertContains(result.text, 'Result 1');
  assertContains(result.text, 'Result 2');
  assertEqual(result.metadata.count, 2);
});

await asyncTest('renderer handles empty search results', async () => {
  const decision = answer(ResponseTemplate.SEARCH_RESULTS, { data: [] });
  const result = await renderDecision(decision);
  
  assertContains(result.text, 'žádné');
  assertEqual(result.metadata.count, 0);
});

await asyncTest('renderer handles legacy text', async () => {
  const decision = fromLegacyResult('Legacy response text', null, 'ANSWER');
  const result = await renderDecision(decision);
  
  assertEqual(result.text, 'Legacy response text');
  assertTrue(result.metadata.legacy);
});

await asyncTest('renderer handles source selection', async () => {
  const decision = askUser(
    [createSlotRequest('source', 'select')],
    ResponseTemplate.SOURCE_SELECTION,
    { sourceType: 'cars' }
  );
  const result = await renderDecision(decision);
  
  assertContains(result.text, 'auto');
  assertContains(result.text, 'Sauto');
});

await asyncTest('renderer handles TOOL_CALL placeholder', async () => {
  const decision = toolCall('web.search', { query: 'test' });
  const result = await renderDecision(decision);
  
  assertContains(result.text, '🔄');
  assertEqual(result.metadata.toolCall, 'web.search');
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 7: ENUMS COMPLETENESS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📊 ENUMS COMPLETENESS');
console.log('════════════════════════════════════════════════════════════');

test('ToolName has essential tools', () => {
  assertTrue(ToolName['web.search'] !== undefined);
  assertTrue(ToolName['web.fetch'] !== undefined);
  assertTrue(ToolName['fs.read'] !== undefined);
  assertTrue(ToolName['fs.write'] !== undefined);
  assertTrue(ToolName['git.status'] !== undefined);
  assertTrue(ToolName['shell.exec'] !== undefined);
});

test('RefusalReason has essential reasons', () => {
  assertTrue(RefusalReason.CAPABILITY_NOT_AVAILABLE !== undefined);
  assertTrue(RefusalReason.PERMISSION_DENIED !== undefined);
  assertTrue(RefusalReason.MISSING_REQUIRED_DATA !== undefined);
  assertTrue(RefusalReason.OUT_OF_SCOPE !== undefined);
});

test('ResponseTemplate has essential templates', () => {
  assertTrue(ResponseTemplate.FACTUAL_ANSWER !== undefined);
  assertTrue(ResponseTemplate.SEARCH_RESULTS !== undefined);
  assertTrue(ResponseTemplate.REFUSAL !== undefined);
  assertTrue(ResponseTemplate.SLOT_REQUEST !== undefined);
  assertTrue(ResponseTemplate.CONFIRMATION !== undefined);
});

test('Verbosity has all levels', () => {
  assertEqual(Verbosity.MINIMAL, 'minimal');
  assertEqual(Verbosity.NORMAL, 'normal');
  assertEqual(Verbosity.DETAILED, 'detailed');
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 8: CRITICAL CONTRACT ENFORCEMENT
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('🚨 CRITICAL CONTRACT ENFORCEMENT');
console.log('════════════════════════════════════════════════════════════');

test('ANSWER decision NEVER has content property', () => {
  // This is the KEY CONTRACT: ANSWER uses template + data, NEVER content string
  const decision = answer(ResponseTemplate.FACTUAL_ANSWER, {
    data: { info: 'test' }
  });
  
  assertTrue(decision.content === undefined, 'ANSWER should not have content');
  assertTrue(decision.template !== undefined, 'ANSWER must have template');
});

test('validateDecision catches content string violation', () => {
  // Manually construct bad decision
  const badDecision = {
    type: 'ANSWER',
    template: 'factual_answer',
    content: 'This is wrong - text belongs in renderer!'
  };
  
  const result = validateDecision(badDecision);
  assertFalse(result.valid, 'Should reject ANSWER with content string');
});

test('REFUSE uses code, not free-form text', () => {
  const decision = refuse('PERMISSION_DENIED');
  
  // reason should be a code, not arbitrary text
  assertTrue(RefusalReason[decision.reason] !== undefined, 
    'Refusal reason must be from RefusalReason enum');
});

test('Decision types are mutually exclusive', () => {
  const tc = toolCall('web.search', {});
  const au = askUser([createSlotRequest('x', 'text')]);
  const rf = refuse('OUT_OF_SCOPE');
  const an = answer('factual_answer');
  const ms = multiStep([tc]);
  
  // Each should match only one checker
  assertTrue(isToolCall(tc) && !isAskUser(tc) && !isRefuse(tc) && !isAnswer(tc));
  assertTrue(isAskUser(au) && !isToolCall(au) && !isRefuse(au) && !isAnswer(au));
  assertTrue(isRefuse(rf) && !isToolCall(rf) && !isAskUser(rf) && !isAnswer(rf));
  assertTrue(isAnswer(an) && !isToolCall(an) && !isAskUser(an) && !isRefuse(an));
  assertTrue(isMultiStep(ms) && !isToolCall(ms) && !isAskUser(ms) && !isAnswer(ms));
});

// ════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📊 CRE DECISION TYPES TEST SUMMARY');
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
  process.exit(1);
} else {
  console.log('\n✅ ALL CRE DECISION TYPES TESTS PASSED');
}
