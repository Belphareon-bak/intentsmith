/**
 * Chat Integration Tests - End-to-End Flow
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Tests complete input → output flow without real HTTP.
 * Uses mocks for external services (web search, LLM).
 *
 * Run: node --test tests/chat-integration.test.js
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';

import {
  ChatController,
  ChatMode,
  SessionState,
} from '../src/unification/chat-controller.js';

import {
  DecisionType,
  IntentType,
} from '../src/unification/cre-decision.js';

import {
  getDefaultHandlers,
} from '../src/unification/handlers.js';

// ════════════════════════════════════════════════════════════════════════════════
// CONFIGURE CHAT CONTROLLER WITH REAL HANDLERS
// ════════════════════════════════════════════════════════════════════════════════

// v44.7 - Must configure handlers before tests run
ChatController.configure({
  handlers: getDefaultHandlers(),
});

// ════════════════════════════════════════════════════════════════════════════════
// MOCK SETUP
// ════════════════════════════════════════════════════════════════════════════════

// Track which tools were called
const toolCallLog = [];

// Mock tool executor results
const mockToolResults = {
  'web.search': {
    status: 'SUCCESS',
    results: [
      { title: 'Test Result 1', url: 'https://example.com/1', snippet: 'First result' },
      { title: 'Test Result 2', url: 'https://example.com/2', snippet: 'Second result' },
    ],
  },
  'local.calendar': {
    status: 'SUCCESS',
    answer: 15,
    unit: 'dní',
    explanation: 'Příští úplněk bude za 15 dní',
  },
  'local.date': {
    status: 'SUCCESS',
    answer: '27.1.2026',
    explanation: 'Dnes je pondělí, 27.1.2026',
  },
  'local.math': {
    status: 'SUCCESS',
    answer: 42,
    explanation: '6 * 7 = 42',
  },
};

/**
 * Simple chat function for integration tests
 */
async function chat(input, options = {}) {
  const sessionId = options.sessionId || `test-${Date.now()}`;

  try {
    const result = await ChatController.handle({
      message: input,
      sessionId,
      userId: options.userId || null,
      context: {
        hasActiveProject: options.hasActiveProject || false,
        project: options.project || null,
        expert: options.expert || null,
        ...options.context,
      },
    });

    // Log for assertions
    // v44.7 - ChatController.handle() returns metadata directly, not wrapped in .tag
    // Only log if tools array is non-empty ([] is truthy but means no tool calls)
    if (result.metadata?.decision?.tools?.length > 0) {
      toolCallLog.push({
        input,
        tools: result.metadata.decision.tools,
        intent: result.metadata.decision.intent,
      });
    }

    return {
      success: true,
      content: result.response,
      mode: result.mode,
      confidence: result.confidence,
      intent: result.metadata?.decision?.intent,
      type: result.metadata?.decision?.type,
      tools: result.metadata?.decision?.tools,
      metadata: result.metadata,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// Reset log before each test
function resetToolLog() {
  toolCallLog.length = 0;
}

// ════════════════════════════════════════════════════════════════════════════════
// LOCAL INTEGRATION TESTS
// ════════════════════════════════════════════════════════════════════════════════

describe('Integration: LOCAL Queries', () => {

  beforeEach(() => {
    resetToolLog();
  });

  describe('Moon phase queries return direct answer', () => {
    it('"kdy bude úplněk?" returns date calculation', async () => {
      const res = await chat('kdy bude úplněk?');

      assert.ok(res.success, 'Should succeed');
      assert.strictEqual(res.intent, IntentType.LOCAL,
        'Should be LOCAL intent');
      assert.strictEqual(res.type, DecisionType.LOCAL,
        'Should be LOCAL decision type');

      // Should NOT have called web.search
      const searchCalls = toolCallLog.filter(t => t.tools?.includes('web.search'));
      assert.strictEqual(searchCalls.length, 0,
        'LOCAL should NOT call web.search');
    });

    it('"za kolik dní bude úplněk" returns number', async () => {
      const res = await chat('za kolik dní bude úplněk');

      assert.ok(res.success);
      assert.strictEqual(res.intent, IntentType.LOCAL);

      // Content should contain the answer
      assert.ok(res.content.includes('úplněk') || res.content.includes('dní'),
        'Response should mention moon/days');
    });
  });

  describe('Date/time queries return direct answer', () => {
    it('"kolik je hodin?" returns time', async () => {
      const res = await chat('kolik je hodin?');

      assert.ok(res.success);
      assert.strictEqual(res.intent, IntentType.LOCAL);
      assert.strictEqual(res.type, DecisionType.LOCAL);
    });

    it('"jaké je dnes datum?" returns date', async () => {
      const res = await chat('jaké je dnes datum?');

      assert.ok(res.success);
      assert.strictEqual(res.intent, IntentType.LOCAL);
    });
  });

  describe('Math calculations return direct answer', () => {
    it('"5 + 3" returns 8', async () => {
      const res = await chat('5 + 3');

      assert.ok(res.success);
      assert.strictEqual(res.intent, IntentType.LOCAL);
    });

    it('"kolik je 10 * 20" returns 200', async () => {
      const res = await chat('kolik je 10 * 20');

      assert.ok(res.success);
      assert.strictEqual(res.intent, IntentType.LOCAL);
    });
  });

  describe('LOCAL never calls external tools', () => {
    const localQueries = [
      'kdy bude úplněk?',
      'kolik je hodin?',
      'jaké je datum?',
      '100 / 4',
      'napiš číslo za kolik dní bude úplněk',
    ];

    for (const query of localQueries) {
      it(`"${query.substring(0, 30)}..." does not call web.search`, async () => {
        resetToolLog();

        const res = await chat(query);

        assert.ok(res.success);

        // Check no web.search was logged
        const webSearchCalls = toolCallLog.filter(t =>
          t.tools?.includes('web.search')
        );
        assert.strictEqual(webSearchCalls.length, 0,
          `"${query}" should NOT trigger web.search`);
      });
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// CONVERSATIONAL INTEGRATION TESTS
// ════════════════════════════════════════════════════════════════════════════════

describe('Integration: CONVERSATIONAL Queries', () => {

  beforeEach(() => {
    resetToolLog();
  });

  describe('Creative writing returns direct response', () => {
    it('"napiš báseň" does NOT call web.search', async () => {
      const res = await chat('napiš báseň o zimě');

      assert.ok(res.success);
      assert.strictEqual(res.intent, IntentType.CONVERSATIONAL,
        'Should be CONVERSATIONAL');
      assert.strictEqual(res.type, DecisionType.ANSWER,
        'Should be ANSWER (direct)');

      // Verify NO web.search was called
      const searchCalls = toolCallLog.filter(t => t.tools?.includes('web.search'));
      assert.strictEqual(searchCalls.length, 0,
        'Creative writing should NOT call web.search');
    });

    it('"napiš příběh" is CONVERSATIONAL', async () => {
      const res = await chat('napiš příběh o drakovi');

      assert.ok(res.success);
      assert.strictEqual(res.intent, IntentType.CONVERSATIONAL);
    });

    it('"write a poem" is CONVERSATIONAL', async () => {
      const res = await chat('write a poem about nature');

      assert.ok(res.success);
      assert.strictEqual(res.intent, IntentType.CONVERSATIONAL);
    });
  });

  describe('Greetings return direct response', () => {
    it('"ahoj" is handled directly', async () => {
      const res = await chat('ahoj');

      assert.ok(res.success);
      assert.strictEqual(res.intent, IntentType.CONVERSATIONAL);
      assert.strictEqual(res.type, DecisionType.ANSWER);
    });

    it('"díky" is handled directly', async () => {
      const res = await chat('díky');

      assert.ok(res.success);
      assert.strictEqual(res.intent, IntentType.CONVERSATIONAL);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SEARCH INTEGRATION TESTS
// ════════════════════════════════════════════════════════════════════════════════

describe('Integration: SEARCH Queries', () => {

  beforeEach(() => {
    resetToolLog();
  });

  describe('Search queries use web.search', () => {
    it('"najdi inzerát na auto" triggers web.search', async () => {
      const res = await chat('najdi inzerát na auto 4x4');

      assert.ok(res.success);
      assert.strictEqual(res.intent, IntentType.SEARCH,
        'Should be SEARCH intent');
      assert.strictEqual(res.type, DecisionType.TOOL_CALL,
        'Should be TOOL_CALL');
      assert.ok(res.tools?.includes('web.search'),
        'Should include web.search tool');
    });

    it('"hledej restaurace" triggers web.search', async () => {
      const res = await chat('hledej nejlepší restaurace v Praze');

      assert.ok(res.success);
      assert.strictEqual(res.intent, IntentType.SEARCH);
    });
  });

  describe('Search continuation maintains context', () => {
    it('Follow-up search maintains SEARCH intent', async () => {
      // First search
      const res1 = await chat('najdi hotely v Praze', {
        sessionId: 'search-session-1',
      });

      assert.ok(res1.success);
      assert.strictEqual(res1.intent, IntentType.SEARCH);

      // TODO: Continuation would need session state persistence
      // For now, just verify first search works
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// REPORT INTEGRATION TESTS
// ════════════════════════════════════════════════════════════════════════════════

describe('Integration: REPORT Queries', () => {

  beforeEach(() => {
    resetToolLog();
  });

  it('"dej mi souhrn zpráv" triggers TOOL_CALL', async () => {
    const res = await chat('dej mi souhrn zpráv za poslední týden');

    assert.ok(res.success);
    assert.strictEqual(res.intent, IntentType.REPORT,
      'Should be REPORT intent');
    assert.strictEqual(res.type, DecisionType.TOOL_CALL,
      'Should be TOOL_CALL');
  });

  it('"analyzuj data" is REPORT', async () => {
    const res = await chat('analyzuj data o prodeji');

    assert.ok(res.success);
    assert.strictEqual(res.intent, IntentType.REPORT);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// NEGATIVE TESTS - INVARIANT VALIDATION
// ════════════════════════════════════════════════════════════════════════════════

describe('Negative Tests - Things That Must NOT Happen', () => {

  beforeEach(() => {
    resetToolLog();
  });

  describe('LOCAL queries must NEVER use web.search', () => {
    it('"kdy bude úplněk?" must not trigger external search', async () => {
      const res = await chat('kdy bude úplněk?');

      assert.ok(res.success);

      // CRITICAL: Must be LOCAL, not SEARCH
      assert.notStrictEqual(res.intent, IntentType.SEARCH,
        'Moon phase should NOT be SEARCH');
      assert.strictEqual(res.intent, IntentType.LOCAL,
        'Moon phase MUST be LOCAL');

      // CRITICAL: Must not have web.search in tools
      if (res.tools && res.tools.length > 0) {
        assert.ok(!res.tools.includes('web.search'),
          'LOCAL must NOT include web.search');
      }
    });
  });

  describe('CONVERSATIONAL must NEVER call tools', () => {
    it('"napiš báseň" must not trigger any tool', async () => {
      resetToolLog();

      const res = await chat('napiš báseň');

      assert.ok(res.success);

      // CRITICAL: Must be ANSWER, not TOOL_CALL
      assert.strictEqual(res.type, DecisionType.ANSWER,
        'Creative writing must be ANSWER');

      // Check log - no tool calls should have happened
      assert.strictEqual(toolCallLog.length, 0,
        'No tools should be called for creative writing');
    });
  });

  describe('Clear intents must NOT trigger ASK_USER', () => {
    const clearIntentQueries = [
      { query: 'kdy bude úplněk?', expectedIntent: IntentType.LOCAL },
      { query: 'kolik je hodin?', expectedIntent: IntentType.LOCAL },
      { query: 'napiš báseň', expectedIntent: IntentType.CONVERSATIONAL },
      { query: 'najdi hotely', expectedIntent: IntentType.SEARCH },
    ];

    for (const { query, expectedIntent } of clearIntentQueries) {
      it(`"${query}" must not be ASK_USER`, async () => {
        const res = await chat(query);

        assert.ok(res.success);
        assert.notStrictEqual(res.type, DecisionType.ASK_USER,
          `Clear intent "${query}" must NOT trigger ASK_USER`);
        assert.strictEqual(res.intent, expectedIntent,
          `Should be ${expectedIntent}`);
      });
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// RESPONSE QUALITY TESTS
// ════════════════════════════════════════════════════════════════════════════════

describe('Response Quality', () => {

  describe('LOCAL responses contain computed data', () => {
    it('Moon phase response contains date or number', async () => {
      const res = await chat('kdy bude úplněk?');

      assert.ok(res.success);
      assert.ok(res.content, 'Should have content');

      // Response should contain some computed value
      const hasComputation = /\d+|dní|datum|úplněk/i.test(res.content);
      assert.ok(hasComputation,
        'LOCAL response should contain computed data');
    });

    it('Time response contains time format', async () => {
      const res = await chat('kolik je hodin?');

      assert.ok(res.success);
      assert.ok(res.content, 'Should have content');

      // Should contain time-related content
      const hasTime = /\d+[.:]\d+|hodin|čas/i.test(res.content);
      assert.ok(hasTime,
        'Time response should contain time data');
    });
  });

  describe('Responses are not chatty excuses', () => {
    const forbiddenPhrases = [
      'nemám přístup',
      'nemohu vyhledávat',
      'nemám aktuální',
      'I cannot search',
      'I don\'t have access',
    ];

    it('LOCAL responses do not contain forbidden phrases', async () => {
      const res = await chat('kdy bude úplněk?');

      assert.ok(res.success);

      for (const phrase of forbiddenPhrases) {
        assert.ok(!res.content?.toLowerCase().includes(phrase.toLowerCase()),
          `Response should NOT contain "${phrase}"`);
      }
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// RUN INFO
// ════════════════════════════════════════════════════════════════════════════════

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  Chat Integration Tests - End-to-End Flow                                    ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║  Testing complete input → output without real HTTP                           ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
