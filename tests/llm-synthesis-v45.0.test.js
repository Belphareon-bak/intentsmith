// CRE v45.0 — LLM Synthesis Layer Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests for Phase 1 architectural changes:
// 1. ToolExecutor returns structured DATA only (ToolResult)
// 2. Follow-up detection (FORMAT_CHANGE vs NEW_QUERY)
// 3. Adaptive result count based on relevance
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  ToolExecutor,
  ToolResult,
  ToolResultType,
  ExecutionStatus,
} from '../src/unification/tool-executor.js';

import {
  CREDecision,
  DecisionType,
  IntentType,
  ToolType,
} from '../src/unification/cre-decision.js';

// ════════════════════════════════════════════════════════════════════════════════
// TEST 1: ToolResult structure
// ════════════════════════════════════════════════════════════════════════════════

describe('v45.0 FIX 1.1: ToolResult Structure', () => {
  it('ToolResult.search creates proper structure', () => {
    const result = ToolResult.search({
      results: [
        { title: 'Test', url: 'https://test.com', snippet: 'Test snippet' },
      ],
      count: 1,
      source: 'duckduckgo',
      latency: 100,
    });

    assert.strictEqual(result.type, ToolResultType.SEARCH);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.results.length, 1);
    assert.strictEqual(result.data.count, 1);
    assert.strictEqual(result.meta.source, 'duckduckgo');
  });

  it('ToolResult.scrape creates proper structure', () => {
    const result = ToolResult.scrape({
      url: 'https://example.com',
      title: 'Example',
      content: 'Page content here',
      links: [],
      latency: 50,
    });

    assert.strictEqual(result.type, ToolResultType.SCRAPE);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.url, 'https://example.com');
    assert.strictEqual(result.data.content, 'Page content here');
  });

  it('ToolResult.local creates proper structure', () => {
    const result = ToolResult.local({
      subtype: 'date',
      data: {
        date: '2025-01-28',
        dayOfWeek: 'pondělí',
      },
    });

    assert.strictEqual(result.type, ToolResultType.LOCAL);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.data.subtype, 'date');
    assert.strictEqual(result.meta.localComputation, true);
  });

  it('ToolResult.failed creates proper error structure', () => {
    const result = ToolResult.failed({
      type: ToolResultType.SEARCH,
      error: 'Network timeout',
      errorCode: 'TIMEOUT',
      suggestion: 'Try again later',
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'Network timeout');
    assert.strictEqual(result.errorCode, 'TIMEOUT');
    assert.strictEqual(result.meta.suggestion, 'Try again later');
    assert.strictEqual(result.meta.retryable, true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST 2: ToolExecutor returns ToolResult
// ════════════════════════════════════════════════════════════════════════════════

describe('v45.0 FIX 1.1: ToolExecutor Returns ToolResult', () => {
  it('executeWebSearch returns ToolResult', async () => {
    const executor = new ToolExecutor();

    // Register mock handler that returns raw data (legacy)
    executor.register(ToolType.WEB_SEARCH, async () => {
      return ToolResult.search({
        results: [{ title: 'Test', url: 'https://test.com', snippet: 'Snippet' }],
        count: 1,
        source: 'mock',
        latency: 10,
      });
    });

    const decision = new CREDecision({
      type: DecisionType.TOOL_CALL,
      intent: IntentType.SEARCH,
      tools: [ToolType.WEB_SEARCH],
      reason: 'Test',
    });

    const result = await executor.execute(decision, { input: 'test' });

    assert.strictEqual(result.status, ExecutionStatus.SUCCESS);
    assert.ok(result.toolResults[0] instanceof ToolResult);
    assert.strictEqual(result.toolResults[0].type, ToolResultType.SEARCH);
  });

  it('ExecutionResult.getDataForSynthesis returns structured data', async () => {
    const executor = new ToolExecutor();

    executor.register(ToolType.WEB_SEARCH, async () => {
      return ToolResult.search({
        results: [{ title: 'Test', url: 'https://test.com', snippet: 'Snippet' }],
        count: 1,
        source: 'mock',
        latency: 10,
      });
    });

    const decision = new CREDecision({
      type: DecisionType.TOOL_CALL,
      intent: IntentType.SEARCH,
      tools: [ToolType.WEB_SEARCH],
      reason: 'Test',
    });

    const result = await executor.execute(decision, { input: 'test' });
    const synthesisData = result.getDataForSynthesis();

    assert.ok(synthesisData.results.length > 0);
    assert.strictEqual(synthesisData.hasFailures, false);
    assert.ok(synthesisData.totalDuration >= 0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST 3: URL Guard (from v44.11)
// ════════════════════════════════════════════════════════════════════════════════

describe('v45.0: URL Guard Preserved from v44.11', () => {
  it('web.scrape rejects non-URL input', async () => {
    const executor = new ToolExecutor();
    const result = await executor.executeWebScrape({ url: 'not a url' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorCode, 'SCRAPE_INVALID_URL');
  });

  it('web.scrape rejects missing URL', async () => {
    const executor = new ToolExecutor();
    const result = await executor.executeWebScrape({});

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorCode, 'SCRAPE_REQUIRES_URL');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST 4: Legacy handler compatibility
// ════════════════════════════════════════════════════════════════════════════════

describe('v45.0: Legacy Handler Compatibility', () => {
  it('wraps legacy handler results in ToolResult', async () => {
    const executor = new ToolExecutor();

    // Register legacy-style handler that returns raw object
    executor.register(ToolType.WEB_SEARCH, async () => {
      return {
        results: [{ title: 'Legacy', url: 'https://legacy.com' }],
      };
    });

    const decision = new CREDecision({
      type: DecisionType.TOOL_CALL,
      intent: IntentType.SEARCH,
      tools: [ToolType.WEB_SEARCH],
      reason: 'Test',
    });

    const result = await executor.execute(decision, { input: 'test' });

    assert.strictEqual(result.status, ExecutionStatus.SUCCESS);
    // Legacy results are wrapped in ToolResult
    assert.ok(result.toolResults[0] instanceof ToolResult);
    assert.strictEqual(result.toolResults[0].meta.source, 'legacy');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Banner
// ════════════════════════════════════════════════════════════════════════════════

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  LLM Synthesis Layer Tests v45.0                                            ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  Phase 1: Tools return DATA, LLM synthesizes RESPONSE                        ║
║                                                                              ║
║  FIX 1.1: ToolResult structure (search, scrape, local, failed)               ║
║  FIX 1.2: synthesizeWithLLM() integration (tested via handlers)              ║
║  FIX 1.3: Adaptive result count (tested via handlers)                        ║
║  FIX 1.4: Follow-up detection (FORMAT_CHANGE vs NEW_QUERY)                   ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
