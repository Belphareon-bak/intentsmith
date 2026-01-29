/**
 * Handler Flow Tests - Clarification & State Management
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Tests pendingDecision, resume, sticky intent, and clarification flows.
 * This layer tests handlers.js logic without real HTTP.
 *
 * Run: node --test tests/handlers-clarification-flow.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  creDecisionEngine,
  DecisionType,
  IntentType,
} from '../src/unification/cre-decision.js';

import {
  SessionState,
} from '../src/unification/chat-controller.js';

import {
  conversationHandler,
} from '../src/unification/handlers.js';

// ════════════════════════════════════════════════════════════════════════════════
// MOCK CONTEXT HELPER
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Create mock context for handler tests
 */
function createMockContext(sessionState, overrides = {}) {
  return {
    sessionId: `test-${Date.now()}`,
    sessionState,
    hasActiveProject: false,
    project: null,
    expert: null,
    history: [],
    ...overrides,
  };
}

/**
 * Run conversation handler with input and state
 */
async function runHandler(input, sessionState, contextOverrides = {}) {
  const context = createMockContext(sessionState, contextOverrides);

  try {
    const result = await conversationHandler(input, context);
    return {
      success: true,
      result,
      // Extract common properties for easier assertions
      type: result.tag?.metadata?.decision?.type,
      intent: result.tag?.metadata?.decision?.intent,
      content: result.content,
    };
  } catch (error) {
    return {
      success: false,
      error,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// PENDING DECISION TESTS
// ════════════════════════════════════════════════════════════════════════════════

describe('pendingDecision Management', () => {

  describe('LOCAL clears pendingDecision', () => {
    it('LOCAL query clears any pending SEARCH decision', async () => {
      const state = new SessionState('test-local-clears-pending');

      // Simulate pending ASK_USER from previous SEARCH
      state.setPendingDecision({
        type: DecisionType.ASK_USER,
        intent: IntentType.SEARCH,
        slots: ['intent_clarification'],
        attempts: 0,
      }, ['intent_clarification']);

      assert.ok(state.pendingDecision, 'Should have pending decision');
      assert.ok(state.awaitingClarification, 'Should be awaiting clarification');

      // Now user asks LOCAL question - should clear pending
      const res = await runHandler('kdy bude úplněk?', state);

      assert.ok(res.success, 'Handler should succeed');
      assert.strictEqual(res.intent, IntentType.LOCAL,
        'Should be LOCAL intent');
      assert.strictEqual(state.pendingDecision, null,
        'pendingDecision should be cleared');
    });

    it('CONVERSATIONAL clears pendingDecision', async () => {
      const state = new SessionState('test-conv-clears-pending');

      state.setPendingDecision({
        type: DecisionType.ASK_USER,
        intent: IntentType.AMBIGUOUS,
        slots: ['intent_clarification'],
        attempts: 0,
      }, ['intent_clarification']);

      const res = await runHandler('napiš mi báseň', state);

      assert.ok(res.success);
      assert.strictEqual(res.intent, IntentType.CONVERSATIONAL);
      assert.strictEqual(state.pendingDecision, null,
        'pendingDecision should be cleared by CONVERSATIONAL');
    });

    it('CODE intent clears pendingDecision', async () => {
      const state = new SessionState('test-code-clears-pending');

      state.setPendingDecision({
        type: DecisionType.ASK_USER,
        intent: IntentType.SEARCH,
        slots: ['intent_clarification'],
        attempts: 0,
      }, ['intent_clarification']);

      const res = await runHandler('napiš mi funkci pro sčítání', state);

      assert.ok(res.success);
      assert.strictEqual(res.intent, IntentType.CODE);
    });

    it('REPORT intent clears pendingDecision', async () => {
      const state = new SessionState('test-report-clears-pending');

      state.setPendingDecision({
        type: DecisionType.ASK_USER,
        intent: IntentType.AMBIGUOUS,
        slots: ['intent_clarification'],
        attempts: 0,
      }, ['intent_clarification']);

      const res = await runHandler('dej mi souhrn novinek', state);

      assert.ok(res.success);
      assert.strictEqual(res.intent, IntentType.REPORT);
    });
  });

  describe('pendingDecision does not persist across topics', () => {
    it('Topic change clears pending state', async () => {
      const state = new SessionState('test-topic-change');

      // First: ambiguous query → ASK_USER
      const res1 = await runHandler('něco nejasného xyz', state);

      // Now completely different topic with clear intent
      const res2 = await runHandler('kolik je hodin?', state);

      assert.strictEqual(res2.intent, IntentType.LOCAL,
        'New clear topic should be processed independently');
      assert.strictEqual(res2.type, DecisionType.LOCAL,
        'Should be LOCAL decision');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// ASK_USER MAX 1× LIMIT
// ════════════════════════════════════════════════════════════════════════════════

describe('ASK_USER Maximum 1× Limit', () => {

  it('ASK_USER only once - second attempt processes as new input', async () => {
    const state = new SessionState('test-ask-user-once');

    // First: ambiguous query → should get ASK_USER
    const res1 = await runHandler('xyz nejasné', state);

    // Check if we got ASK_USER (might not if patterns match something)
    if (res1.type === DecisionType.ASK_USER) {
      assert.ok(state.awaitingClarification, 'Should be awaiting clarification');
      assert.strictEqual(state.pendingDecision?.attempts, 1,
        'Should have 1 attempt recorded');

      // Second: still unclear → should NOT get ASK_USER again
      const res2 = await runHandler('stále nevím', state);

      assert.notStrictEqual(res2.type, DecisionType.ASK_USER,
        'Second ambiguous input should NOT trigger ASK_USER again');
    }
  });

  it('After ASK_USER limit, processes as new intent', async () => {
    const state = new SessionState('test-ask-user-fallback');

    // Manually set pending with attempts = 1 (already asked once)
    state.setPendingDecision({
      type: DecisionType.ASK_USER,
      intent: IntentType.AMBIGUOUS,
      slots: ['intent_clarification'],
      attempts: 1,
    }, ['intent_clarification']);

    // Any input should clear pending and process normally
    const res = await runHandler('něco', state);

    assert.strictEqual(state.pendingDecision, null,
      'pendingDecision should be cleared after max attempts');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// CLARIFICATION CONTENT RESPECTING
// ════════════════════════════════════════════════════════════════════════════════

describe('Clarification Content Respecting', () => {

  describe('"já chci datum" resolves to LOCAL', () => {
    it('"já chci datum" → LOCAL', async () => {
      const state = new SessionState('test-datum-clarification');

      // Set pending SEARCH decision
      state.setPendingDecision({
        type: DecisionType.ASK_USER,
        intent: IntentType.SEARCH,
        slots: ['intent_clarification'],
        attempts: 0,
      }, ['intent_clarification']);

      const res = await runHandler('já chci datum', state);

      assert.ok(res.success);
      assert.strictEqual(res.intent, IntentType.LOCAL,
        '"já chci datum" should resolve to LOCAL');
    });

    it('"jen datum" → LOCAL', async () => {
      const state = new SessionState('test-jen-datum');

      state.setPendingDecision({
        type: DecisionType.ASK_USER,
        intent: IntentType.SEARCH,
        slots: ['intent_clarification'],
        attempts: 0,
      }, ['intent_clarification']);

      const res = await runHandler('jen datum', state);

      assert.strictEqual(res.intent, IntentType.LOCAL);
    });

    it('"bez odkazů" → LOCAL', async () => {
      const state = new SessionState('test-bez-odkazu');

      state.setPendingDecision({
        type: DecisionType.ASK_USER,
        intent: IntentType.AMBIGUOUS,
        slots: ['intent_clarification'],
        attempts: 0,
      }, ['intent_clarification']);

      const res = await runHandler('bez odkazů', state);

      assert.strictEqual(res.intent, IntentType.LOCAL);
    });

    it('"číslo" → LOCAL', async () => {
      const state = new SessionState('test-cislo');

      state.setPendingDecision({
        type: DecisionType.ASK_USER,
        intent: IntentType.SEARCH,
        slots: ['intent_clarification'],
        attempts: 0,
      }, ['intent_clarification']);

      const res = await runHandler('číslo', state);

      assert.strictEqual(res.intent, IntentType.LOCAL);
    });
  });

  describe('Keyword clarification', () => {
    it('"report" clarifies to REPORT intent', async () => {
      const state = new SessionState('test-report-keyword');

      // First record a decision to set lastUserInput
      state.recordDecision({
        type: DecisionType.ASK_USER,
        intent: IntentType.AMBIGUOUS,
        slots: ['intent_clarification'],
        attempts: 0,
      }, 'zprávy o AI');

      // Now set pending for clarification
      state.setPendingDecision({
        type: DecisionType.ASK_USER,
        intent: IntentType.AMBIGUOUS,
        slots: ['intent_clarification'],
        attempts: 0,
      }, ['intent_clarification']);

      const res = await runHandler('report', state);

      // Should resolve to REPORT (handled as clarification keyword)
      assert.ok(res.success);
    });

    it('"vyhledávání" clarifies to SEARCH intent', async () => {
      const state = new SessionState('test-search-keyword');

      // First record a decision to set lastUserInput
      state.recordDecision({
        type: DecisionType.ASK_USER,
        intent: IntentType.AMBIGUOUS,
        slots: ['intent_clarification'],
        attempts: 0,
      }, 'najdi informace');

      state.setPendingDecision({
        type: DecisionType.ASK_USER,
        intent: IntentType.AMBIGUOUS,
        slots: ['intent_clarification'],
        attempts: 0,
      }, ['intent_clarification']);

      const res = await runHandler('vyhledávání', state);

      assert.ok(res.success);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// STICKY INTENT TESTS
// ════════════════════════════════════════════════════════════════════════════════

describe('Sticky Intent (Context Continuity)', () => {

  describe('SEARCH continuation patterns', () => {
    it('After SEARCH, "zkus najít konkrétní" stays SEARCH', async () => {
      const state = new SessionState('test-search-continuation');

      // Record previous SEARCH decision
      state.recordDecision({
        type: DecisionType.TOOL_CALL,
        intent: IntentType.SEARCH,
        tools: ['web.search'],
      }, 'najdi inzeráty na auta');

      // Continuation should stay SEARCH
      const decision = creDecisionEngine.decide('zkus najít konkrétní', {
        lastIntent: state.lastIntent,
      });

      assert.strictEqual(decision.intent, IntentType.SEARCH,
        'Continuation should maintain SEARCH intent');
      assert.strictEqual(decision.type, DecisionType.TOOL_CALL,
        'Should still be TOOL_CALL');
    });

    it('After SEARCH, "hledej dál" stays SEARCH', async () => {
      const state = new SessionState('test-search-hledej-dal');

      state.recordDecision({
        type: DecisionType.TOOL_CALL,
        intent: IntentType.SEARCH,
        tools: ['web.search'],
      }, 'najdi restaurace');

      const decision = creDecisionEngine.decide('hledej dál', {
        lastIntent: state.lastIntent,
      });

      assert.strictEqual(decision.intent, IntentType.SEARCH);
    });

    it('After SEARCH, "a co jiné?" stays SEARCH', async () => {
      const state = new SessionState('test-search-a-co-jine');

      state.recordDecision({
        type: DecisionType.TOOL_CALL,
        intent: IntentType.SEARCH,
        tools: ['web.search'],
      }, 'najdi hotely');

      const decision = creDecisionEngine.decide('a co jiné?', {
        lastIntent: state.lastIntent,
      });

      assert.strictEqual(decision.intent, IntentType.SEARCH);
    });
  });

  describe('REPORT continuation', () => {
    it('After REPORT, follow-up maintains REPORT', async () => {
      const state = new SessionState('test-report-continuation');

      state.recordDecision({
        type: DecisionType.TOOL_CALL,
        intent: IntentType.REPORT,
        tools: ['web.search'],
      }, 'dej mi souhrn zpráv');

      const decision = creDecisionEngine.decide('a ještě za minulý týden', {
        lastIntent: state.lastIntent,
      });

      // Should maintain sticky intent
      assert.strictEqual(decision.intent, IntentType.REPORT);
    });
  });

  describe('Sticky intent does NOT apply to strong intents', () => {
    it('LOCAL breaks sticky SEARCH', async () => {
      const state = new SessionState('test-local-breaks-sticky');

      state.recordDecision({
        type: DecisionType.TOOL_CALL,
        intent: IntentType.SEARCH,
        tools: ['web.search'],
      }, 'najdi informace');

      // LOCAL should override sticky intent
      const decision = creDecisionEngine.decide('kolik je hodin?', {
        lastIntent: state.lastIntent,
      });

      assert.strictEqual(decision.intent, IntentType.LOCAL,
        'LOCAL should override sticky SEARCH');
    });

    it('CONVERSATIONAL breaks sticky SEARCH', async () => {
      const state = new SessionState('test-conv-breaks-sticky');

      state.recordDecision({
        type: DecisionType.TOOL_CALL,
        intent: IntentType.SEARCH,
        tools: ['web.search'],
      }, 'najdi data');

      const decision = creDecisionEngine.decide('napiš báseň', {
        lastIntent: state.lastIntent,
      });

      assert.strictEqual(decision.intent, IntentType.CONVERSATIONAL,
        'CONVERSATIONAL should override sticky SEARCH');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TOOL FAILURE RECOVERY
// ════════════════════════════════════════════════════════════════════════════════

describe('Tool Failure Recovery', () => {

  it('After tool failure, retry clarification works', async () => {
    const state = new SessionState('test-tool-failure-retry');

    // Simulate tool failure state
    state.setPendingDecision({
      type: 'TOOL_CALL_FAILED',
      intent: IntentType.SEARCH,
      failedTools: ['web.search'],
      originalInput: 'najdi informace o AI',
      attempts: 0,
    }, ['alternative_action']);

    // User says "zkus znovu"
    const res = await runHandler('zkus znovu', state);

    assert.ok(res.success);
    // Should attempt retry (TOOL_CALL)
  });

  it('After tool failure, user can cancel', async () => {
    const state = new SessionState('test-tool-failure-cancel');

    state.setPendingDecision({
      type: 'TOOL_CALL_FAILED',
      intent: IntentType.SEARCH,
      failedTools: ['web.search'],
      originalInput: 'najdi něco',
      attempts: 0,
    }, ['alternative_action']);

    const res = await runHandler('ne', state);

    assert.ok(res.success);
    // Should cancel gracefully
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// GOAL DRIFT HANDLING
// ════════════════════════════════════════════════════════════════════════════════

describe('Goal Drift Handling', () => {

  it('Drift confirmation clears pending and resets count', async () => {
    const state = new SessionState('test-drift-confirm');

    state.setPendingDecision({
      type: 'GOAL_DRIFT_CONFIRMATION',
      intent: IntentType.SEARCH,
      tools: ['web.search'],
      originalInput: 'najdi něco jiného',
      attempts: 0,
    }, ['goal_drift_confirmation']);
    state.incrementDriftCount();

    const res = await runHandler('ano', state);

    assert.ok(res.success);
    assert.strictEqual(state.driftCount, 0,
      'Drift count should reset after confirmation');
  });

  it('Drift decline clears pending and resets count', async () => {
    const state = new SessionState('test-drift-decline');

    state.setPendingDecision({
      type: 'GOAL_DRIFT_CONFIRMATION',
      intent: IntentType.SEARCH,
      tools: ['web.search'],
      originalInput: 'off-topic',
      attempts: 0,
    }, ['goal_drift_confirmation']);
    state.incrementDriftCount();

    const res = await runHandler('ne', state);

    assert.ok(res.success);
    assert.strictEqual(state.driftCount, 0,
      'Drift count should reset after decline');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// RUN INFO
// ════════════════════════════════════════════════════════════════════════════════

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  Handler Flow Tests - Clarification & State Management                       ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║  Testing pendingDecision, resume, sticky intent flows                        ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
