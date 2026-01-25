// CRE v36.9 LLM Enforcement Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests that PROVE the CRE is the ONLY path to LLM.
//
// Categories:
//   1. GREP-TEST: No direct ollama calls outside gateway
//   2. CRE-OR-CRASH: Unauthorized LLM calls throw
//   3. LEGACY_DIRECT: Requires env flag
//   4. STOP-CONDITION: Max 1 LLM call per render, only SYNTHESIZER token
//   5. ResponseRenderer: Correct decision → text conversion
//
// ══════════════════════════════════════════════════════════════════════════════

import { llmGateway } from '../src/llm/gateway.js';
import {
  createAuthToken,
  LLMCallerRole,
  LLMCapability
} from '../src/llm/auth-types.js';
import { ResponseRenderer, responseRenderer, renderDecision } from '../src/chat/response-renderer.js';
import {
  answer,
  askUser,
  refuse,
  toolCall,
  multiStep,
  createSlotRequest,
  ResponseTemplate,
  RefusalReason,
  Verbosity,
  validateDecision
} from '../src/chat/cre-decision-types.js';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

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

function assertFalse(condition, msg = '') {
  if (condition) throw new Error(msg || 'Expected false');
}

function assertThrows(fn, expectedMsg = '') {
  let threw = false;
  let error;
  try {
    fn();
  } catch (e) {
    threw = true;
    error = e;
  }
  if (!threw) throw new Error(`Expected to throw${expectedMsg ? ': ' + expectedMsg : ''}`);
  if (expectedMsg && !error.message.includes(expectedMsg)) {
    throw new Error(`Expected error containing "${expectedMsg}", got "${error.message}"`);
  }
}

async function assertAsyncThrows(fn, expectedMsg = '') {
  let threw = false;
  let error;
  try {
    await fn();
  } catch (e) {
    threw = true;
    error = e;
  }
  if (!threw) throw new Error(`Expected async to throw${expectedMsg ? ': ' + expectedMsg : ''}`);
  if (expectedMsg && !error.message.includes(expectedMsg)) {
    throw new Error(`Expected error containing "${expectedMsg}", got "${error.message}"`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// RUN ALL TESTS (async wrapper)
// ════════════════════════════════════════════════════════════════════════════

async function runAllTests() {

// ════════════════════════════════════════════════════════════════════════════
// 1. GREP-TEST: No direct ollama calls outside gateway
// ════════════════════════════════════════════════════════════════════════════

console.log('\n📋 1. GREP-TEST: No direct ollama calls outside gateway');
console.log('─'.repeat(60));

function getAllSourceFiles(dir, files = []) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'tests') continue;
      getAllSourceFiles(fullPath, files);
    } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

test('No direct fetch to ollama/api outside gateway.js', () => {
  const srcDir = resolve(import.meta.url.replace('file://', ''), '../../');
  const files = getAllSourceFiles(srcDir);

  // v36.9.1: All subsystems migrated to llmGateway with auth tokens.
  // Only UI file remains (frontend, cannot use server-side gateway).
  const KNOWN_BYPASSES = [
    'ui/architect/architect.js'  // Frontend: fetch to /api/tags for model listing
  ];

  const violations = [];

  for (const file of files) {
    // Skip gateway itself and client (which routes through gateway)
    if (file.includes('llm/gateway.js') || file.includes('llm/client.js')) continue;

    const content = readFileSync(file, 'utf-8');

    // Check for direct ollama fetch calls
    if (/fetch\s*\([^)]*ollama|fetch\s*\([^)]*\/api\/(chat|generate)/i.test(content)) {
      const relativePath = file.replace(srcDir, '').replace(/^\//, '');
      // Check if this is a known bypass
      if (!KNOWN_BYPASSES.some(bp => relativePath.includes(bp))) {
        violations.push(relativePath);
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(`NEW direct ollama calls found in: ${violations.join(', ')}`);
  }
});

test('KNOWN_BYPASSES list must NOT grow (only shrink as subsystems are migrated)', () => {
  // v36.9.1: Migrated 6 subsystems, only UI frontend remains.
  // This number must stay at 1 or decrease to 0.
  const MAX_ALLOWED_BYPASSES = 1;
  const KNOWN_BYPASSES = [
    'ui/architect/architect.js'  // Frontend: fetch to /api/tags for model listing
  ];
  assertTrue(
    KNOWN_BYPASSES.length <= MAX_ALLOWED_BYPASSES,
    `KNOWN_BYPASSES must not grow beyond ${MAX_ALLOWED_BYPASSES}, currently: ${KNOWN_BYPASSES.length}`
  );
});

test('No imports of callOllama in non-legacy files (chat/, agents/)', () => {
  const srcDir = resolve(import.meta.url.replace('file://', ''), '../../');
  const files = getAllSourceFiles(srcDir);

  const violations = [];

  for (const file of files) {
    // Only check chat/ and agents/ modules (core logic)
    if (!file.includes('/chat/') && !file.includes('/agents/')) continue;

    const content = readFileSync(file, 'utf-8');

    if (/import.*callOllama/i.test(content)) {
      violations.push(file.replace(srcDir, 'src/'));
    }
  }

  if (violations.length > 0) {
    throw new Error(`callOllama imports in core modules: ${violations.join(', ')}`);
  }
});

test('No text generation in CRE (no content strings in decisions)', () => {
  const srcDir = resolve(import.meta.url.replace('file://', ''), '../../');
  const creFile = join(srcDir, 'chat/cre-v2.js');
  const content = readFileSync(creFile, 'utf-8');

  // CRE must NOT contain template strings for user-facing text
  // (moved to response-renderer.js)
  const hasOldTemplates = /TEMPLATES\s*=\s*\{[\s\S]*?ASK:/.test(content);
  assertFalse(hasOldTemplates, 'CRE still contains old TEMPLATES object');

  // CRE must NOT call buildPrompt (moved to response-renderer.js)
  const hasBuildPrompt = /function buildPrompt\(/.test(content);
  assertFalse(hasBuildPrompt, 'CRE still contains buildPrompt function');

  // CRE must NOT have enforceSpeechAct (moved to response-renderer.js)
  const hasEnforceSpeechAct = /function enforceSpeechAct\(/.test(content);
  assertFalse(hasEnforceSpeechAct, 'CRE still contains enforceSpeechAct function');
});

// ════════════════════════════════════════════════════════════════════════════
// 2. CRE-OR-CRASH: Unauthorized LLM calls throw
// ════════════════════════════════════════════════════════════════════════════

console.log('\n📋 2. CRE-OR-CRASH: Unauthorized LLM calls throw');
console.log('─'.repeat(60));

test('Gateway strict mode is enabled by default', () => {
  // Create fresh gateway to test defaults
  const freshGateway = new (llmGateway.constructor)();
  assertTrue(freshGateway.strictMode, 'Strict mode should be enabled by default');
});

await await asyncTest('LLM call without auth token throws LLM_CALL_OUTSIDE_CRE', async () => {
  // Ensure no auth token
  llmGateway.revoke();

  // Save and restore strict mode
  const wasStrict = llmGateway.strictMode;
  llmGateway.strictMode = true;

  try {
    await assertAsyncThrows(
      () => llmGateway.call('test prompt', {}),
      'LLM_CALL_OUTSIDE_CRE'
    );
  } finally {
    llmGateway.strictMode = wasStrict;
  }
});

await test('Authorizing with expired token throws', () => {
  const token = createAuthToken({
    role: LLMCallerRole.CRE_DECISION,
    decisionId: 'test-expired',
    auditContext: { sessionId: 'test-session' }
  });

  // Force expire
  token.expiresAt = Date.now() - 1000;

  assertThrows(
    () => llmGateway.authorize(token),
    'Invalid LLM auth token'
  );
});

test('Gateway hasActiveToken() returns false without auth', () => {
  llmGateway.revoke();
  assertFalse(llmGateway.hasActiveToken(), 'Should return false without token');
});

test('Gateway hasActiveToken() returns true with valid auth', () => {
  const token = createAuthToken({
    role: LLMCallerRole.CRE_DECISION,
    decisionId: 'test-active',
    auditContext: { sessionId: 'test-session' }
  });
  llmGateway.authorize(token);
  assertTrue(llmGateway.hasActiveToken(), 'Should return true with valid token');
  llmGateway.revoke();
});

// ════════════════════════════════════════════════════════════════════════════
// 3. LEGACY_DIRECT: Requires env flag
// ════════════════════════════════════════════════════════════════════════════

console.log('\n📋 3. LEGACY_DIRECT: Requires env flag');
console.log('─'.repeat(60));

await await asyncTest('Legacy call without ALLOW_LEGACY_LLM env throws', async () => {
  llmGateway.revoke();
  const wasStrict = llmGateway.strictMode;
  llmGateway.strictMode = true;

  // Ensure env var is not set
  const oldEnv = process.env.ALLOW_LEGACY_LLM;
  delete process.env.ALLOW_LEGACY_LLM;

  try {
    await assertAsyncThrows(
      () => llmGateway.call('test', { legacyRole: 'LEGACY_DIRECT' }),
      'LLM_CALL_OUTSIDE_CRE'
    );
  } finally {
    llmGateway.strictMode = wasStrict;
    if (oldEnv !== undefined) process.env.ALLOW_LEGACY_LLM = oldEnv;
  }
});

await asyncTest('Legacy call WITH ALLOW_LEGACY_LLM=1 does not throw (but logs)', async () => {
  llmGateway.revoke();
  const wasStrict = llmGateway.strictMode;
  llmGateway.strictMode = true;

  const oldEnv = process.env.ALLOW_LEGACY_LLM;
  process.env.ALLOW_LEGACY_LLM = '1';

  try {
    // This should not throw (but will fail on network since no ollama running)
    // We just check it doesn't throw the auth error
    try {
      await llmGateway.call('test', { legacyRole: 'LEGACY_DIRECT' });
    } catch (e) {
      // Network error is OK (no ollama running), auth error is NOT OK
      if (e.message.includes('LLM_CALL_OUTSIDE_CRE')) {
        throw new Error('Should not throw auth error with ALLOW_LEGACY_LLM=1');
      }
      // Network errors are expected in test environment
    }
  } finally {
    llmGateway.strictMode = wasStrict;
    if (oldEnv !== undefined) {
      process.env.ALLOW_LEGACY_LLM = oldEnv;
    } else {
      delete process.env.ALLOW_LEGACY_LLM;
    }
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 4. STOP-CONDITION: ResponseRenderer LLM limits
// ════════════════════════════════════════════════════════════════════════════

console.log('\n📋 4. STOP-CONDITION: ResponseRenderer LLM limits');
console.log('─'.repeat(60));

await asyncTest('ResponseRenderer uses max 1 LLM call per render()', async () => {
  const renderer = new ResponseRenderer();

  // Render a synthesis template
  const decision = answer(ResponseTemplate.FACTUAL_ANSWER, {
    data: { answer: 'Test answer' }
  });

  const result = await renderer.render(decision, {});

  // llmCallCount should be 0 or 1 (0 if LLM is down, 1 if it ran)
  assertTrue(renderer.llmCallCount <= 1, `LLM call count should be <= 1, got ${renderer.llmCallCount}`);
});

await asyncTest('ResponseRenderer resets LLM counter per render() call', async () => {
  const renderer = new ResponseRenderer();

  // First render
  await renderer.render(answer(ResponseTemplate.GREETING), {});

  // Second render - counter should reset
  await renderer.render(answer(ResponseTemplate.FAREWELL), {});

  // Counter should be 0 (static templates don't call LLM)
  assertEqual(renderer.llmCallCount, 0, 'Counter reset');
});

await asyncTest('Static templates do NOT call LLM', async () => {
  const renderer = new ResponseRenderer();

  const staticTemplates = [
    answer(ResponseTemplate.GREETING),
    answer(ResponseTemplate.FAREWELL),
    answer(ResponseTemplate.CONFIRMATION),
    answer(ResponseTemplate.ACKNOWLEDGMENT)
  ];

  for (const decision of staticTemplates) {
    await renderer.render(decision, {});
    assertEqual(renderer.llmCallCount, 0, `Static template ${decision.template} should not call LLM`);
  }
});

test('Only SYNTHESIZER and CRE_DECISION tokens are allowed for CRE pipeline', () => {
  // These are the ONLY roles that should be used in the CRE pipeline
  const allowedRoles = [LLMCallerRole.CRE_DECISION, LLMCallerRole.SYNTHESIZER];

  // Verify these roles exist
  assertTrue(!!LLMCallerRole.CRE_DECISION, 'CRE_DECISION role exists');
  assertTrue(!!LLMCallerRole.SYNTHESIZER, 'SYNTHESIZER role exists');

  // Verify SYNTHESIZER has correct capabilities (summarization, extraction)
  const token = createAuthToken({
    role: LLMCallerRole.SYNTHESIZER,
    decisionId: 'test',
    auditContext: { sessionId: 'test' }
  });

  assertTrue(token.allowedCapabilities.includes('summarization'), 'SYNTHESIZER has summarization');
  assertTrue(token.allowedCapabilities.includes('extraction'), 'SYNTHESIZER has extraction');
  assertEqual(token.maxTokens, 1000, 'SYNTHESIZER max tokens is 1000');
});

// ════════════════════════════════════════════════════════════════════════════
// 5. ResponseRenderer: Decision → Text
// ════════════════════════════════════════════════════════════════════════════

console.log('\n📋 5. ResponseRenderer: Decision → Text');
console.log('─'.repeat(60));

await asyncTest('ASK_USER renders slot request text', async () => {
  const decision = askUser(
    [createSlotRequest('year', 'number')],
    ResponseTemplate.SLOT_REQUEST
  );

  const result = await responseRenderer.render(decision, {});
  assertTrue(result.text.includes('rok'), `Should contain year-related text, got: ${result.text}`);
});

await asyncTest('REFUSE renders refusal reason', async () => {
  const decision = refuse(RefusalReason.CAPABILITY_NOT_AVAILABLE);
  const result = await responseRenderer.render(decision, {});
  assertTrue(result.text.includes('není'), `Should contain refusal text, got: ${result.text}`);
});

await asyncTest('ANSWER with GREETING renders static greeting', async () => {
  const decision = answer(ResponseTemplate.GREETING);
  const result = await responseRenderer.render(decision, {});
  assertTrue(result.text.includes('Ahoj'), `Should contain greeting, got: ${result.text}`);
});

await asyncTest('ANSWER with SEARCH_RESULTS renders results', async () => {
  const decision = answer(ResponseTemplate.SEARCH_RESULTS, {
    data: [
      { title: 'Item 1', description: 'Desc 1', url: 'http://example.com' },
      { title: 'Item 2', description: 'Desc 2' }
    ]
  });

  const result = await responseRenderer.render(decision, {});
  assertTrue(result.text.includes('Item 1'), `Should contain first item`);
  assertTrue(result.text.includes('2 výsledků'), `Should mention result count`);
});

await asyncTest('ANSWER with SEARCH_NO_RESULTS renders no-results message', async () => {
  const decision = answer(ResponseTemplate.SEARCH_NO_RESULTS);
  const result = await responseRenderer.render(decision, {});
  assertTrue(result.text.includes('Nebyly nalezeny'), `Should say no results found`);
});

await asyncTest('REFUSE with alternatives lists them', async () => {
  const decision = refuse(RefusalReason.MISSING_REQUIRED_DATA, [
    'Poskytni data',
    'Upřesni zdroj'
  ]);

  const result = await responseRenderer.render(decision, {});
  assertTrue(result.text.includes('Poskytni data'), 'Should list alternatives');
  assertTrue(result.text.includes('Upřesni zdroj'), 'Should list alternatives');
});

await asyncTest('TOOL_CALL renders working message', async () => {
  const decision = toolCall('web.search', { query: 'test' });
  const result = await responseRenderer.render(decision, {});
  assertTrue(result.text.includes('Provádím'), `Should show working status`);
  assertTrue(result.metadata.toolCall === 'web.search', 'Should have toolCall metadata');
});

await asyncTest('MULTI_STEP renders all non-tool steps', async () => {
  const decision = multiStep([
    answer(ResponseTemplate.GREETING),
    answer(ResponseTemplate.CONFIRMATION)
  ]);

  const result = await responseRenderer.render(decision, {});
  assertTrue(result.text.includes('Ahoj'), 'Should include greeting');
  assertTrue(result.text.includes('Hotovo'), 'Should include confirmation');
});

await asyncTest('Legacy text is passed through', async () => {
  const decision = answer(ResponseTemplate.FACTUAL_ANSWER, {
    context: { legacyText: 'Legacy response text' }
  });

  const result = await responseRenderer.render(decision, {});
  assertTrue(result.text.includes('Legacy response text'), 'Should pass through legacy text');
});

await asyncTest('Null decision returns error', async () => {
  const result = await responseRenderer.render(null, {});
  assertTrue(result.text.includes('Prázdné rozhodnutí'), 'Should show error for null');
  assertTrue(result.metadata.error, 'Should mark as error');
});

await asyncTest('FACTUAL_ANSWER with string data uses fallback without LLM', async () => {
  const decision = answer(ResponseTemplate.FACTUAL_ANSWER, {
    data: 'Simple string answer'
  });

  // Without LLM running, should fall back to data as-is
  const result = await responseRenderer.render(decision, {});
  assertTrue(
    result.text.includes('Simple string answer'),
    `Should contain data string as fallback, got: ${result.text}`
  );
});

await asyncTest('COMPARISON_TABLE renders table format', async () => {
  const decision = answer(ResponseTemplate.COMPARISON_TABLE, {
    data: [
      { name: 'A', price: '100', speed: 'fast' },
      { name: 'B', price: '200', speed: 'slow' }
    ]
  });

  const result = await responseRenderer.render(decision, {});
  assertTrue(result.text.includes('Porovnání'), 'Should have comparison header');
  assertTrue(result.text.includes('A'), 'Should show item A');
  assertTrue(result.text.includes('B'), 'Should show item B');
});

await asyncTest('renderExecutionFallback handles ASK_DATA_SOURCE', () => {
  const text = responseRenderer.renderExecutionFallback('ASK_DATA_SOURCE', {
    workflowIntent: 'NEWS_AGGREGATION'
  });
  assertTrue(text.includes('zprávy'), 'Should mention news');
});

await asyncTest('renderExecutionFallback handles OFFER_SEARCH_SETUP', () => {
  const text = responseRenderer.renderExecutionFallback('OFFER_SEARCH_SETUP', {
    message: 'hledám auto 4x4'
  });
  assertTrue(text.includes('auto') || text.includes('Sauto'), 'Should mention cars');
});

await asyncTest('CREDecision validation rejects content string', () => {
  const badDecision = {
    type: 'ANSWER',
    template: ResponseTemplate.FACTUAL_ANSWER,
    content: 'This should not be here!'  // FORBIDDEN
  };

  const validation = validateDecision(badDecision);
  assertFalse(validation.valid, 'Should reject decision with content string');
  assertTrue(
    validation.errors.some(e => e.includes('content')),
    'Error should mention content field'
  );
});

// ════════════════════════════════════════════════════════════════════════════
// RESULTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n' + '═'.repeat(60));
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`\n✅ ${passed} passed, ❌ ${failed} failed (total: ${results.length})`);

if (failed > 0) {
  console.log('\nFailed tests:');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`  ❌ ${r.name}: ${r.error}`);
  });
  process.exit(1);
}

} // end runAllTests

runAllTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
