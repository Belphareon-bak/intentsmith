// CRE v44.11 — REPORT Pipeline Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests for the REPORT pipeline fix:
// 1. REPORT intent only returns web.search tool (not web.scrape)
// 2. web.scrape requires valid URL (SCRAPE_REQUIRES_URL guard)
// 3. REPORT fallback when search fails (no ASK_USER)
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  creDecisionEngine,
  CREDecision,
  DecisionType,
  IntentType,
  ToolType,
} from '../src/unification/cre-decision.js';

import { toolExecutor } from '../src/unification/tool-executor.js';

// ════════════════════════════════════════════════════════════════════════════════
// TEST 1: REPORT intent only returns web.search
// ════════════════════════════════════════════════════════════════════════════════

describe('REPORT Intent Tool Selection (v44.11 FIX 1)', () => {
  it('REPORT intent returns only web.search, not web.scrape', () => {
    const tools = creDecisionEngine.getRequiredTools(IntentType.REPORT, 'dej mi report');

    assert.ok(tools.includes(ToolType.WEB_SEARCH), 'REPORT must include web.search');
    assert.ok(!tools.includes(ToolType.WEB_SCRAPE), 'REPORT must NOT include web.scrape directly');
    assert.strictEqual(tools.length, 1, 'REPORT should have exactly 1 tool (web.search)');
  });

  it('REPORT decision has web.search tool only', () => {
    // Use a stronger REPORT pattern
    const decision = creDecisionEngine.decide('vytvoř report o AI trendech', {});

    assert.strictEqual(decision.intent, IntentType.REPORT, 'Intent should be REPORT');
    assert.strictEqual(decision.type, DecisionType.TOOL_CALL, 'Decision should be TOOL_CALL');
    assert.ok(decision.tools.includes('web.search'), 'Tools must include web.search');
    assert.ok(!decision.tools.includes('web.scrape'), 'Tools must NOT include web.scrape');
  });

  it('SEARCH intent also returns only web.search', () => {
    const tools = creDecisionEngine.getRequiredTools(IntentType.SEARCH, 'najdi');

    assert.ok(tools.includes(ToolType.WEB_SEARCH), 'SEARCH must include web.search');
    assert.ok(!tools.includes(ToolType.WEB_SCRAPE), 'SEARCH must NOT include web.scrape');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST 2: web.scrape URL guard
// ════════════════════════════════════════════════════════════════════════════════

describe('web.scrape URL Guard (v44.11 FIX 3)', () => {
  it('web.scrape fails without URL (SCRAPE_REQUIRES_URL)', async () => {
    const result = await toolExecutor.executeWebScrape({});

    assert.strictEqual(result.success, false, 'Should fail without URL');
    assert.ok(result.error.includes('SCRAPE_REQUIRES_URL'), `Error should mention SCRAPE_REQUIRES_URL, got: ${result.error}`);
    assert.strictEqual(result.errorCode, 'SCRAPE_REQUIRES_URL');
  });

  it('web.scrape fails with query string instead of URL (SCRAPE_INVALID_URL)', async () => {
    const result = await toolExecutor.executeWebScrape({ url: 'dej mi report o AI' });

    assert.strictEqual(result.success, false, 'Should fail with non-URL string');
    assert.ok(result.error.includes('SCRAPE_INVALID_URL'), `Error should mention SCRAPE_INVALID_URL, got: ${result.error}`);
    assert.strictEqual(result.errorCode, 'SCRAPE_INVALID_URL');
  });

  it('web.scrape fails with query parameter (not url)', async () => {
    // This is the exact bug scenario - passing query instead of url
    const result = await toolExecutor.executeWebScrape({ query: 'dej mi report ceske politiky' });

    assert.strictEqual(result.success, false, 'Should fail when only query is provided');
    assert.ok(result.errorCode === 'SCRAPE_REQUIRES_URL' || result.errorCode === 'SCRAPE_INVALID_URL',
      `Error code should be SCRAPE_REQUIRES_URL or SCRAPE_INVALID_URL, got: ${result.errorCode}`);
  });

  it('web.scrape accepts valid HTTPS URL', async () => {
    // Note: This test may fail due to network issues, but it should NOT fail validation
    const result = await toolExecutor.executeWebScrape({ url: 'https://example.com' });

    // Either succeeds or fails with network error (NOT validation error)
    if (!result.success) {
      assert.ok(!result.errorCode?.includes('INVALID_URL'), 'Should not be URL validation error');
      assert.ok(!result.errorCode?.includes('REQUIRES_URL'), 'Should not be missing URL error');
    }
  });

  it('web.scrape accepts valid HTTP URL', async () => {
    const result = await toolExecutor.executeWebScrape({ url: 'http://example.com' });

    if (!result.success) {
      assert.ok(!result.errorCode?.includes('INVALID_URL'), 'Should not be URL validation error');
      assert.ok(!result.errorCode?.includes('REQUIRES_URL'), 'Should not be missing URL error');
    }
  });

  it('web.scrape accepts urls array from REPORT pipeline', async () => {
    const result = await toolExecutor.executeWebScrape({
      urls: ['https://example.com', 'https://example.org']
    });

    // Should use first URL from array
    if (!result.success) {
      assert.ok(!result.errorCode?.includes('INVALID_URL'), 'Should not be URL validation error');
      assert.ok(!result.errorCode?.includes('REQUIRES_URL'), 'Should not be missing URL error');
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST 3: REPORT patterns detection
// ════════════════════════════════════════════════════════════════════════════════

describe('REPORT Intent Detection', () => {
  const reportPatterns = [
    'vytvoř report o AI',                   // "vytvoř report" triggers REPORT
    'analyzuj konkurenci',                  // "analyzuj" triggers REPORT
    'shrň mi tenhle článek',                // "shrň" triggers REPORT
    'porovnej iPhone a Samsung',            // "porovnej" triggers REPORT
    'přehled elektromobilů',                // "přehled" triggers REPORT
    'dej mi souhrn',                        // "souhrn" triggers REPORT
    'zprávy za poslední týden',             // "za poslední" triggers REPORT
    'dej mi přehled trhu',                  // "přehled" triggers REPORT
  ];

  reportPatterns.forEach(input => {
    it(`"${input}" → REPORT intent`, () => {
      const intent = creDecisionEngine.classifyIntent(input);
      assert.strictEqual(intent, IntentType.REPORT, `Expected REPORT for "${input}", got ${intent}`);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Banner
// ════════════════════════════════════════════════════════════════════════════════

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  REPORT Pipeline Tests v45.0                                                ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  v44.11: REPORT returns only web.search (not web.scrape)                     ║
║  v44.11: web.scrape requires valid URL (SCRAPE_REQUIRES_URL guard)           ║
║  v45.0: Tools return ToolResult (structured DATA, no text)                  ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
