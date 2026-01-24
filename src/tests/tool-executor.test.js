// CRE v36.9.2 ToolExecutor Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests:
// - Missing required param → MISSING_PARAM
// - Unknown tool → UNKNOWN_TOOL
// - Permission denied → PERMISSION_DENIED
// - Successful execution
// - Timeout handling
// - E2E: CREDecision(TOOL_CALL) → ToolExecutor → HTTP → parsed results
//
// ══════════════════════════════════════════════════════════════════════════════

import { toolExecutor } from '../tools/executor.js';
import { ToolError } from '../tools/executor.js';
import { toolRegistry } from '../tools/registry.js';
import { toolCall } from '../chat/cre-decision-types.js';

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
// MOCK FETCH (for E2E test)
// ════════════════════════════════════════════════════════════════════════════

function mockFetch(responseBody, status = 200) {
  global.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody),
    headers: { entries: () => [] },
  });
}

function restoreFetch() {
  delete global.fetch;
}

// ════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
console.log('  CRE v36.9.2 ToolExecutor Tests');
console.log('══════════════════════════════════════════════════════════════\n');

// ────────────────────────────────────────────────────────────────────────────
// Unknown Tool
// ────────────────────────────────────────────────────────────────────────────

console.log('📋 Unknown Tool');

await asyncTest('Unknown tool returns UNKNOWN_TOOL error', async () => {
  const decision = toolCall('nonexistent.tool', { foo: 'bar' });
  const result = await toolExecutor.execute(decision);

  assertTrue(!result.ok, 'Should fail');
  assertEqual(result.code, ToolError.UNKNOWN_TOOL, 'Error code');
  assertTrue(result.error.includes('nonexistent.tool'), 'Error message');
});

// ────────────────────────────────────────────────────────────────────────────
// Missing Params
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Missing Params');

await asyncTest('Missing required param returns MISSING_PARAM', async () => {
  // web.search requires 'query'
  const decision = toolCall('web.search', {});
  const result = await toolExecutor.execute(decision);

  assertTrue(!result.ok, 'Should fail');
  assertEqual(result.code, ToolError.MISSING_PARAM, 'Error code');
  assertTrue(result.error.includes('query'), 'Should mention missing param');
});

await asyncTest('Missing required param on fs.read returns MISSING_PARAM', async () => {
  const decision = toolCall('fs.read', {});
  const result = await toolExecutor.execute(decision);

  assertTrue(!result.ok, 'Should fail');
  assertEqual(result.code, ToolError.MISSING_PARAM, 'Error code');
  assertTrue(result.error.includes('path'), 'Should mention missing path');
});

await asyncTest('Partial params still fail if required one is missing', async () => {
  // web.fetch requires 'url', has optional 'headers'
  const decision = toolCall('web.fetch', { headers: { 'X-Custom': 'test' } });
  const result = await toolExecutor.execute(decision);

  assertTrue(!result.ok, 'Should fail');
  assertEqual(result.code, ToolError.MISSING_PARAM, 'Error code');
  assertTrue(result.error.includes('url'), 'Should mention missing url');
});

// ────────────────────────────────────────────────────────────────────────────
// Permission Denied
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Permission Check');

await asyncTest('Permission denied when required permission not granted', async () => {
  // Remove fs.write permission temporarily
  toolExecutor.revokePermission('fs.write');

  const decision = toolCall('fs.write', { path: '/tmp/test.txt', content: 'hello' });
  const result = await toolExecutor.execute(decision);

  assertTrue(!result.ok, 'Should fail');
  assertEqual(result.code, ToolError.PERMISSION_DENIED, 'Error code');
  assertTrue(result.error.includes('fs.write'), 'Should mention missing permission');

  // Restore
  toolExecutor.grantPermission('fs.write');
});

// ────────────────────────────────────────────────────────────────────────────
// Successful Execution
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Successful Execution');

await asyncTest('data.parse executes successfully with valid JSON', async () => {
  const decision = toolCall('data.parse', { input: '{"name":"test","value":42}' });
  const result = await toolExecutor.execute(decision);

  assertTrue(result.ok, 'Should succeed');
  assertEqual(result.data.data.name, 'test', 'Parsed name');
  assertEqual(result.data.data.value, 42, 'Parsed value');
  assertTrue(result.duration >= 0, 'Should have duration');
});

await asyncTest('data.parse returns error for invalid JSON', async () => {
  const decision = toolCall('data.parse', { input: 'not json {{{' });
  const result = await toolExecutor.execute(decision);

  // Tool returns error object, executor wraps it
  assertTrue(!result.ok, 'Should fail');
  assertEqual(result.code, 'PARSE_ERROR', 'Error code from tool');
});

await asyncTest('data.filter works with criteria', async () => {
  const data = [
    { name: 'A', price: 100 },
    { name: 'B', price: 250 },
    { name: 'C', price: 150 },
  ];
  const decision = toolCall('data.filter', {
    data,
    criteria: { price: { max: 200 } },
  });
  const result = await toolExecutor.execute(decision);

  assertTrue(result.ok, 'Should succeed');
  assertEqual(result.data.count, 2, 'Should filter to 2 items');
});

// ────────────────────────────────────────────────────────────────────────────
// Timeout
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Timeout');

await asyncTest('Tool timeout returns TIMEOUT error', async () => {
  // Register a slow tool
  toolRegistry.register({
    name: 'test.slow',
    description: 'Deliberately slow tool for testing',
    params: { required: [], optional: [] },
    permissions: [],
    execute: async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      return { data: 'done' };
    },
  });

  const decision = toolCall('test.slow', {});
  const result = await toolExecutor.execute(decision, { timeout: 50, internal: true });

  assertTrue(!result.ok, 'Should fail');
  assertEqual(result.code, ToolError.TIMEOUT, 'Error code');
});

// ────────────────────────────────────────────────────────────────────────────
// executeDecision (validates type)
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 executeDecision');

await asyncTest('executeDecision rejects non-TOOL_CALL decisions', async () => {
  const result = await toolExecutor.executeDecision({ type: 'ANSWER', text: 'hi' });

  assertTrue(!result.ok, 'Should fail');
  assertEqual(result.code, 'INVALID_DECISION', 'Error code');
});

await asyncTest('executeDecision accepts valid TOOL_CALL', async () => {
  const decision = toolCall('data.parse', { input: '{"x":1}' });
  const result = await toolExecutor.executeDecision(decision);

  assertTrue(result.ok, 'Should succeed');
  assertEqual(result.data.data.x, 1, 'Parsed data');
});

// ────────────────────────────────────────────────────────────────────────────
// E2E: CREDecision → ToolExecutor → HTTP → Parsed Results
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 E2E: web.search flow');

await asyncTest('E2E: "najdi auto 4x4 do 200k" → TOOL_CALL → HTTP → results', async () => {
  // Mock search API response
  const mockResults = {
    items: [
      { title: 'Suzuki Jimny 4x4 2018', link: 'https://cars.cz/jimny', snippet: 'Cena: 189 000 Kč, 4x4, benzin' },
      { title: 'Dacia Duster 4x4 2017', link: 'https://cars.cz/duster', snippet: 'Cena: 175 000 Kč, 4x4, diesel' },
      { title: 'Fiat Panda 4x4 2016', link: 'https://cars.cz/panda', snippet: 'Cena: 145 000 Kč, 4x4, benzin' },
    ]
  };

  mockFetch(mockResults);

  // This is what CRE would produce:
  const decision = toolCall('web.search', {
    query: 'auto 4x4 do 200000 Kč',
    maxResults: 5,
    language: 'cs'
  });

  // Execute through ToolExecutor (same as CRE would)
  const result = await toolExecutor.executeDecision(decision);

  // Verify the full chain worked
  assertTrue(result.ok, 'Should succeed');
  assertTrue(Array.isArray(result.data), 'Should return array of results');
  assertEqual(result.data.length, 3, 'Should have 3 results');
  assertEqual(result.data[0].title, 'Suzuki Jimny 4x4 2018', 'First result title');
  assertTrue(result.data[0].url.includes('cars.cz'), 'First result URL');
  assertTrue(result.data[1].snippet.includes('175 000'), 'Second result snippet');
  assertTrue(result.duration >= 0, 'Should have duration');

  restoreFetch();
});

await asyncTest('E2E: web.search with backend error returns clean error', async () => {
  mockFetch('Service Unavailable', 503);

  const decision = toolCall('web.search', {
    query: 'test query',
  });

  const result = await toolExecutor.executeDecision(decision);

  // HTTP client retries, eventually returns error
  // The tool returns an error object
  assertTrue(!result.ok, 'Should fail');
  assertTrue(result.duration >= 0, 'Should have duration');

  restoreFetch();
});

// ────────────────────────────────────────────────────────────────────────────
// Registry basics
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Registry');

test('Registry has web tools registered', () => {
  assertTrue(toolRegistry.has('web.search'), 'web.search');
  assertTrue(toolRegistry.has('web.fetch'), 'web.fetch');
  assertTrue(toolRegistry.has('web.scrape'), 'web.scrape');
});

test('Registry has data tools registered', () => {
  assertTrue(toolRegistry.has('data.parse'), 'data.parse');
  assertTrue(toolRegistry.has('data.filter'), 'data.filter');
});

test('Registry has fs tools registered', () => {
  assertTrue(toolRegistry.has('fs.read'), 'fs.read');
  assertTrue(toolRegistry.has('fs.write'), 'fs.write');
  assertTrue(toolRegistry.has('fs.list'), 'fs.list');
});

test('Registry metadata includes params and permissions', () => {
  const meta = toolRegistry.getMetadata('web.search');
  assertTrue(meta !== undefined, 'Should have metadata');
  assertTrue(meta.params.required.includes('query'), 'Should require query');
  assertTrue(meta.permissions.includes('web.read'), 'Should require web.read');
});

test('Registry list returns all tool names', () => {
  const list = toolRegistry.list();
  assertTrue(list.length >= 7, 'Should have at least 7 tools');
  assertTrue(list.includes('web.search'), 'Should include web.search');
});

// ────────────────────────────────────────────────────────────────────────────
// Metrics
// ────────────────────────────────────────────────────────────────────────────

console.log('\n📋 Metrics');

test('getStats returns counts, errorsByCode, durations, byTool', () => {
  const stats = toolExecutor.getStats();

  // We've run several tools above, stats should reflect that
  assertTrue(stats.totalExecutions > 0, 'Should have executions');
  assertTrue(stats.counts.success > 0, 'Should have successes');
  assertTrue(stats.counts.errors > 0, 'Should have errors');
  assertTrue(typeof stats.errorsByCode === 'object', 'Should have errorsByCode');
  assertTrue(stats.errorsByCode.MISSING_PARAM > 0, 'Should track MISSING_PARAM');
  assertTrue(stats.errorsByCode.UNKNOWN_TOOL > 0, 'Should track UNKNOWN_TOOL');
  assertTrue(typeof stats.durations === 'object', 'Should have durations');
  assertTrue(stats.durations.min >= 0, 'Duration min >= 0');
  assertTrue(stats.durations.max >= stats.durations.min, 'Duration max >= min');
  assertTrue(stats.durations.avg >= 0, 'Duration avg >= 0');
  assertTrue(stats.durations.p95 >= 0, 'Duration p95 >= 0');
  assertTrue(typeof stats.byTool === 'object', 'Should have byTool');
  assertTrue(stats.byTool['data.parse'] !== undefined, 'Should track data.parse');
  assertTrue(stats.byTool['data.parse'].calls > 0, 'data.parse calls > 0');
  assertTrue(stats.byTool['data.parse'].avgDuration >= 0, 'data.parse avgDuration >= 0');
});

// ════════════════════════════════════════════════════════════════════════════
// RESULTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`  Results: ${passed} passed, ${failed} failed, ${results.length} total`);
console.log('══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
