// Tool Executor Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests that verify the ToolExecutor correctly EXECUTES tools
// instead of just describing them.
//
// ══════════════════════════════════════════════════════════════════════════════

import assert from 'assert';
import {
  ToolExecutor,
  ExecutionResult,
  ExecutionStatus,
} from '../src/unification/tool-executor.js';
import {
  CREDecision,
  DecisionType,
  IntentType,
  ToolType,
} from '../src/unification/cre-decision.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test Helpers
// ─────────────────────────────────────────────────────────────────────────────

function test(name, fn) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result
        .then(() => {
          console.log(`✓ ${name}`);
          return true;
        })
        .catch((err) => {
          console.error(`✗ ${name}`);
          console.error(`  Error: ${err.message}`);
          return false;
        });
    }
    console.log(`✓ ${name}`);
    return Promise.resolve(true);
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(`  Error: ${err.message}`);
    return Promise.resolve(false);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Test Suite
// ─────────────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(' Tool Executor Tests');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  // ─────────────────────────────────────────────────────────────────────────────
  // ExecutionResult Tests
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('--- ExecutionResult ---\n');

  if (await test('ExecutionResult success status', () => {
    const result = new ExecutionResult({
      status: ExecutionStatus.SUCCESS,
      toolResults: [{ tool: 'web.search', success: true, data: {} }],
      summary: 'Results found',
    });
    assert.strictEqual(result.succeeded, true);
    assert.strictEqual(result.hasResults, true);
  })) passed++; else failed++;

  if (await test('ExecutionResult failed status', () => {
    const result = new ExecutionResult({
      status: ExecutionStatus.FAILED,
      error: 'All tools failed',
    });
    assert.strictEqual(result.succeeded, false);
    assert.strictEqual(result.hasResults, false);
  })) passed++; else failed++;

  if (await test('ExecutionResult partial status', () => {
    const result = new ExecutionResult({
      status: ExecutionStatus.PARTIAL,
      toolResults: [
        { tool: 'web.search', success: true, data: {} },
        { tool: 'web.scrape', success: false, error: 'Failed' },
      ],
    });
    assert.strictEqual(result.succeeded, false);
    assert.strictEqual(result.hasResults, true);
  })) passed++; else failed++;

  // ─────────────────────────────────────────────────────────────────────────────
  // ToolExecutor Tests
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n--- ToolExecutor Basic ---\n');

  if (await test('ToolExecutor instance creation', () => {
    const executor = new ToolExecutor();
    assert.ok(executor);
    assert.ok(executor.toolHandlers instanceof Map);
    assert.ok(executor.toolHandlers.size > 0, 'Should have registered handlers');
  })) passed++; else failed++;

  if (await test('ToolExecutor rejects non-TOOL_CALL decisions', async () => {
    const executor = new ToolExecutor();
    const decision = new CREDecision({
      type: DecisionType.ANSWER,
      intent: IntentType.CONVERSATIONAL,
      reason: 'Test',
    });

    const result = await executor.execute(decision, {});
    assert.strictEqual(result.status, ExecutionStatus.FAILED);
    assert.ok(result.error.includes('Cannot execute decision type'));
  })) passed++; else failed++;

  if (await test('ToolExecutor rejects TOOL_CALL without tools', async () => {
    const executor = new ToolExecutor();
    // Create a decision object manually to bypass constructor validation
    const decision = {
      type: DecisionType.TOOL_CALL,
      intent: IntentType.SEARCH,
      tools: [],
      toJSON: () => ({}),
    };

    const result = await executor.execute(decision, {});
    assert.strictEqual(result.status, ExecutionStatus.FAILED);
    assert.ok(result.error.includes('no tools'));
  })) passed++; else failed++;

  // ─────────────────────────────────────────────────────────────────────────────
  // Tool Handler Registration
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n--- Custom Tool Handlers ---\n');

  if (await test('ToolExecutor custom handler registration', async () => {
    const executor = new ToolExecutor();

    // Register mock search handler
    executor.register(ToolType.WEB_SEARCH, async (params) => {
      return {
        results: [
          { title: 'Test Result', url: 'https://example.com', snippet: 'Test snippet' },
        ],
      };
    });

    const decision = new CREDecision({
      type: DecisionType.TOOL_CALL,
      intent: IntentType.SEARCH,
      tools: [ToolType.WEB_SEARCH],
      reason: 'Test',
    });

    const result = await executor.execute(decision, { input: 'test query' });
    assert.strictEqual(result.status, ExecutionStatus.SUCCESS);
    assert.strictEqual(result.toolResults.length, 1);
    assert.strictEqual(result.toolResults[0].success, true);
    assert.ok(result.toolResults[0].data.results.length > 0);
  })) passed++; else failed++;

  if (await test('ToolExecutor handles tool failure gracefully', async () => {
    const executor = new ToolExecutor();

    // Register failing handler
    executor.register(ToolType.WEB_SEARCH, async () => {
      throw new Error('Network error');
    });

    const decision = new CREDecision({
      type: DecisionType.TOOL_CALL,
      intent: IntentType.SEARCH,
      tools: [ToolType.WEB_SEARCH],
      reason: 'Test',
    });

    const result = await executor.execute(decision, { input: 'test query' });
    assert.strictEqual(result.status, ExecutionStatus.FAILED);
    assert.strictEqual(result.toolResults[0].success, false);
    assert.ok(result.toolResults[0].error.includes('Network error'));
  })) passed++; else failed++;

  if (await test('ToolExecutor handles partial success', async () => {
    const executor = new ToolExecutor();

    // Register mixed handlers
    executor.register(ToolType.WEB_SEARCH, async () => ({ results: [] }));
    executor.register(ToolType.WEB_SCRAPE, async () => {
      throw new Error('Scrape failed');
    });

    const decision = new CREDecision({
      type: DecisionType.TOOL_CALL,
      intent: IntentType.REPORT,
      tools: [ToolType.WEB_SEARCH, ToolType.WEB_SCRAPE],
      reason: 'Test',
    });

    const result = await executor.execute(decision, { input: 'test query' });
    assert.strictEqual(result.status, ExecutionStatus.PARTIAL);
    assert.strictEqual(result.toolResults.filter(r => r.success).length, 1);
    assert.strictEqual(result.toolResults.filter(r => !r.success).length, 1);
  })) passed++; else failed++;

  // ─────────────────────────────────────────────────────────────────────────────
  // Service Wiring
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n--- Service Wiring ---\n');

  if (await test('ToolExecutor wireServices connects search service', async () => {
    const executor = new ToolExecutor();

    // Wire mock search service
    executor.wireServices({
      searchService: {
        search: async (query) => ({
          results: [{ title: `Result for: ${query}`, url: 'https://test.com' }],
        }),
      },
    });

    const decision = new CREDecision({
      type: DecisionType.TOOL_CALL,
      intent: IntentType.SEARCH,
      tools: [ToolType.WEB_SEARCH],
      reason: 'Test',
    });

    const result = await executor.execute(decision, { input: 'bitcoin price' });
    assert.strictEqual(result.status, ExecutionStatus.SUCCESS);
    assert.ok(result.toolResults[0].data.results[0].title.includes('bitcoin price'));
  })) passed++; else failed++;

  // ─────────────────────────────────────────────────────────────────────────────
  // Timeout Handling
  // ─────────────────────────────────────────────────────────────────────────────

  console.log('\n--- Timeout Handling ---\n');

  if (await test('ToolExecutor handles tool timeout', async () => {
    const executor = new ToolExecutor({ timeout: 100 }); // 100ms timeout

    // Register slow handler
    executor.register(ToolType.WEB_SEARCH, async () => {
      await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay
      return { results: [] };
    });

    const decision = new CREDecision({
      type: DecisionType.TOOL_CALL,
      intent: IntentType.SEARCH,
      tools: [ToolType.WEB_SEARCH],
      reason: 'Test',
    });

    const result = await executor.execute(decision, { input: 'test' });
    assert.strictEqual(result.status, ExecutionStatus.FAILED);
    assert.ok(result.toolResults[0].error.includes('Timeout'));
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
}

runTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
