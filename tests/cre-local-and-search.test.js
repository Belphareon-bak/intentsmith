/**
 * CRE Decision Tests - Core Logic Layer
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Tests pure CRE decision making without handlers.
 * These tests validate the fundamental intent classification and decision logic.
 *
 * Run: node --test tests/cre-local-and-search.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  CREDecision,
  CREDecisionEngine,
  creDecisionEngine,
  DecisionType,
  IntentType,
} from '../src/unification/cre-decision.js';

// ════════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Create CRE decision with context
 * @param {string} input - User input
 * @param {Object} ctx - Context options
 * @returns {CREDecision}
 */
function decide(input, ctx = {}) {
  return creDecisionEngine.decide(input, {
    lastIntent: ctx.lastIntent || null,
    hasActiveProject: ctx.hasActiveProject || false,
    expert: ctx.expert || null,
    sessionState: ctx.sessionState || null,
    awaitingSlots: ctx.awaitingSlots || [],
  });
}

/**
 * Classify intent only (without full decision)
 */
function classify(input) {
  return creDecisionEngine.classifyIntent(input);
}

// ════════════════════════════════════════════════════════════════════════════════
// LOCAL INTENT TESTS
// ════════════════════════════════════════════════════════════════════════════════

describe('LOCAL Intent - Absolute Priority', () => {

  describe('Moon phase queries', () => {
    it('LOCAL: "kdy bude úplněk?" → LOCAL calendar', () => {
      const d = decide('kdy bude úplněk?');

      assert.strictEqual(d.intent, IntentType.LOCAL,
        'Intent should be LOCAL');
      assert.strictEqual(d.type, DecisionType.LOCAL,
        'Type should be LOCAL (terminal)');
      assert.strictEqual(d.metadata?.handler, 'local.calendar',
        'Handler should be local.calendar');
    });

    it('LOCAL: "kdy bude uplnek" (without diacritics) → LOCAL calendar', () => {
      const d = decide('kdy bude uplnek');

      assert.strictEqual(d.intent, IntentType.LOCAL);
      assert.strictEqual(d.type, DecisionType.LOCAL);
      assert.strictEqual(d.metadata?.handler, 'local.calendar');
    });

    it('LOCAL: "za kolik dní bude úplněk" → LOCAL calendar', () => {
      const d = decide('za kolik dní bude úplněk');

      assert.strictEqual(d.intent, IntentType.LOCAL);
      assert.strictEqual(d.metadata?.handler, 'local.calendar');
    });
  });

  describe('Date/time queries', () => {
    it('LOCAL: "kolik je hodin?" → LOCAL date', () => {
      const d = decide('kolik je hodin?');

      assert.strictEqual(d.intent, IntentType.LOCAL);
      assert.strictEqual(d.type, DecisionType.LOCAL);
      assert.strictEqual(d.metadata?.handler, 'local.date');
    });

    it('LOCAL: "jaké je dnes datum?" → LOCAL date', () => {
      const d = decide('jaké je dnes datum?');

      assert.strictEqual(d.intent, IntentType.LOCAL);
      assert.strictEqual(d.metadata?.handler, 'local.date');
    });

    it('LOCAL: "what time is it?" → LOCAL date', () => {
      const d = decide('what time is it?');

      assert.strictEqual(d.intent, IntentType.LOCAL);
    });
  });

  describe('Math calculations', () => {
    it('LOCAL: "5 + 3" → LOCAL math', () => {
      const d = decide('5 + 3');

      assert.strictEqual(d.intent, IntentType.LOCAL);
      assert.strictEqual(d.metadata?.handler, 'local.math');
    });

    it('LOCAL: "kolik je 10 * 20" → LOCAL math', () => {
      const d = decide('kolik je 10 * 20');

      assert.strictEqual(d.intent, IntentType.LOCAL);
      assert.strictEqual(d.metadata?.handler, 'local.math');
    });

    it('LOCAL: "vypočítej 100 / 4" → LOCAL math', () => {
      const d = decide('vypočítej 100 / 4');

      assert.strictEqual(d.intent, IntentType.LOCAL);
    });
  });

  describe('Explicit LOCAL requests', () => {
    it('LOCAL: "napiš číslo za kolik dní bude úplněk" → LOCAL calendar', () => {
      const d = decide('napiš číslo za kolik dní bude úplněk');

      assert.strictEqual(d.intent, IntentType.LOCAL,
        'Should be LOCAL - explicit number request');
      assert.strictEqual(d.metadata?.handler, 'local.calendar');
    });

    it('LOCAL: "napiš mi číslo" → LOCAL', () => {
      const d = decide('napiš mi číslo kolik je hodin');

      assert.strictEqual(d.intent, IntentType.LOCAL);
    });

    it('LOCAL: "jen datum" → LOCAL', () => {
      const intent = classify('jen datum prosím');

      assert.strictEqual(intent, IntentType.LOCAL);
    });

    it('LOCAL: "bez odkazů" → LOCAL', () => {
      const intent = classify('bez odkazů, jen datum');

      assert.strictEqual(intent, IntentType.LOCAL);
    });

    it('LOCAL: "rovnou odpověď" → LOCAL', () => {
      const intent = classify('rovnou odpověď');

      assert.strictEqual(intent, IntentType.LOCAL);
    });
  });

  describe('LOCAL has priority over SEARCH patterns', () => {
    it('LOCAL beats SEARCH: question with "kdy" keyword', () => {
      // "kdy" is in SEARCH patterns but "kdy bude úplněk" should be LOCAL
      const d = decide('kdy bude úplněk?');

      assert.strictEqual(d.intent, IntentType.LOCAL,
        'LOCAL must have priority over SEARCH');
      assert.notStrictEqual(d.type, DecisionType.TOOL_CALL,
        'Should NOT be TOOL_CALL');
    });

    it('LOCAL beats SEARCH: question with "kolik" keyword', () => {
      const d = decide('kolik je hodin?');

      assert.strictEqual(d.intent, IntentType.LOCAL);
    });
  });

  describe('LOCAL never triggers ASK_USER', () => {
    const localQueries = [
      'kdy bude úplněk?',
      'kolik je hodin?',
      'jaké je datum?',
      '5 + 3',
      'za kolik dní bude nov?',
    ];

    for (const query of localQueries) {
      it(`LOCAL "${query.substring(0, 30)}..." → never ASK_USER`, () => {
        const d = decide(query);

        assert.notStrictEqual(d.type, DecisionType.ASK_USER,
          `"${query}" should NOT trigger ASK_USER`);
      });
    }
  });

  describe('LOCAL never uses tools', () => {
    it('LOCAL decision has no tools', () => {
      const d = decide('kdy bude úplněk?');

      assert.strictEqual(d.type, DecisionType.LOCAL);
      assert.ok(!d.tools || d.tools.length === 0,
        'LOCAL must not have tools');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// CONVERSATIONAL INTENT TESTS
// ════════════════════════════════════════════════════════════════════════════════

describe('CONVERSATIONAL Intent - Direct Answer', () => {

  describe('Creative writing', () => {
    it('CONVERSATIONAL: "napiš báseň o zimě" → ANSWER only', () => {
      const d = decide('napiš báseň o zimě');

      assert.strictEqual(d.intent, IntentType.CONVERSATIONAL,
        'Creative writing should be CONVERSATIONAL');
      assert.strictEqual(d.type, DecisionType.ANSWER,
        'Should be ANSWER (direct response)');
      assert.ok(!d.tools || d.tools.length === 0,
        'Should have no tools');
    });

    it('CONVERSATIONAL: "napiš příběh o drakovi" → ANSWER', () => {
      const d = decide('napiš příběh o drakovi');

      assert.strictEqual(d.intent, IntentType.CONVERSATIONAL);
      assert.strictEqual(d.type, DecisionType.ANSWER);
    });

    it('CONVERSATIONAL: "napiš mi pohádku" → ANSWER', () => {
      const d = decide('napiš mi pohádku');

      assert.strictEqual(d.intent, IntentType.CONVERSATIONAL);
      assert.strictEqual(d.type, DecisionType.ANSWER);
    });

    it('CONVERSATIONAL: "vytvoř text o přírodě" → ANSWER', () => {
      const d = decide('vytvoř text o přírodě');

      assert.strictEqual(d.intent, IntentType.CONVERSATIONAL);
    });

    it('CONVERSATIONAL: "write a poem about love" → ANSWER', () => {
      const d = decide('write a poem about love');

      assert.strictEqual(d.intent, IntentType.CONVERSATIONAL);
      assert.strictEqual(d.type, DecisionType.ANSWER);
    });
  });

  describe('Greetings and small talk', () => {
    it('CONVERSATIONAL: "ahoj" → ANSWER', () => {
      const d = decide('ahoj');

      assert.strictEqual(d.intent, IntentType.CONVERSATIONAL);
      assert.strictEqual(d.type, DecisionType.ANSWER);
    });

    it('CONVERSATIONAL: "díky" → ANSWER', () => {
      const d = decide('díky');

      assert.strictEqual(d.intent, IntentType.CONVERSATIONAL);
    });

    it('CONVERSATIONAL: "jak se máš?" → ANSWER', () => {
      const d = decide('jak se máš?');

      assert.strictEqual(d.intent, IntentType.CONVERSATIONAL);
    });
  });

  describe('CONVERSATIONAL never calls tools', () => {
    it('should throw if creating TOOL_CALL for CONVERSATIONAL', () => {
      assert.throws(() => {
        new CREDecision({
          type: DecisionType.TOOL_CALL,
          intent: IntentType.CONVERSATIONAL,
          tools: ['web.search'],
          reason: 'test - this should fail',
        });
      }, /CONVERSATIONAL.*NEVER call tools/);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SEARCH INTENT TESTS
// ════════════════════════════════════════════════════════════════════════════════

describe('SEARCH Intent - Tool First', () => {

  describe('Explicit search queries', () => {
    it('SEARCH: "najdi inzerát na auto" → TOOL_CALL web.search', () => {
      const d = decide('najdi inzerát na auto');

      assert.strictEqual(d.intent, IntentType.SEARCH,
        'Should be SEARCH intent');
      assert.strictEqual(d.type, DecisionType.TOOL_CALL,
        'Should be TOOL_CALL');
      assert.ok(d.tools.includes('web.search'),
        'Should include web.search tool');
    });

    it('SEARCH: "hledej nejlepší restaurace" → TOOL_CALL', () => {
      const d = decide('hledej nejlepší restaurace');

      assert.strictEqual(d.intent, IntentType.SEARCH);
      assert.strictEqual(d.type, DecisionType.TOOL_CALL);
    });

    it('SEARCH: "vyhledej recenze na iPhone" → TOOL_CALL', () => {
      const d = decide('vyhledej recenze na iPhone');

      assert.strictEqual(d.intent, IntentType.SEARCH);
    });
  });

  describe('Implicit search queries', () => {
    it('SEARCH: "co je nového v AI?" → TOOL_CALL', () => {
      const d = decide('co je nového v AI?');

      assert.strictEqual(d.intent, IntentType.SEARCH);
      assert.strictEqual(d.type, DecisionType.TOOL_CALL);
    });

    it('SEARCH: "aktuální cena bitcoinu" → TOOL_CALL', () => {
      const d = decide('aktuální cena bitcoinu');

      // Could be SEARCH or FACTUAL - both use TOOL_CALL
      assert.strictEqual(d.type, DecisionType.TOOL_CALL);
    });
  });

  describe('SEARCH continuation (sticky intent)', () => {
    it('SEARCH continuation: "zkus najít konkrétní" stays SEARCH', () => {
      const d = decide('zkus najít konkrétní inzeráty', {
        lastIntent: IntentType.SEARCH,
      });

      assert.strictEqual(d.intent, IntentType.SEARCH,
        'Should maintain SEARCH intent');
      assert.strictEqual(d.type, DecisionType.TOOL_CALL,
        'Should still be TOOL_CALL');
    });

    it('SEARCH continuation: "hledej dál" stays SEARCH', () => {
      const d = decide('hledej dál', {
        lastIntent: IntentType.SEARCH,
      });

      assert.strictEqual(d.intent, IntentType.SEARCH);
    });

    it('SEARCH continuation: "najdi podobné" stays SEARCH', () => {
      const d = decide('najdi podobné', {
        lastIntent: IntentType.SEARCH,
      });

      assert.strictEqual(d.intent, IntentType.SEARCH);
    });

    it('SEARCH continuation: "a co jiné?" stays SEARCH', () => {
      const d = decide('a co jiné?', {
        lastIntent: IntentType.SEARCH,
      });

      assert.strictEqual(d.intent, IntentType.SEARCH);
    });

    it('SEARCH continuation: "konkrétnější" stays SEARCH', () => {
      const d = decide('konkrétnější výsledky', {
        lastIntent: IntentType.SEARCH,
      });

      assert.strictEqual(d.intent, IntentType.SEARCH);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// REPORT INTENT TESTS
// ════════════════════════════════════════════════════════════════════════════════

describe('REPORT Intent - Always Tool First', () => {

  it('REPORT: "dej mi souhrn zpráv" → TOOL_CALL', () => {
    const d = decide('dej mi souhrn zpráv za poslední týden');

    assert.strictEqual(d.intent, IntentType.REPORT);
    assert.strictEqual(d.type, DecisionType.TOOL_CALL);
  });

  it('REPORT: "vytvoř přehled" → TOOL_CALL', () => {
    const d = decide('vytvoř přehled trhu');

    assert.strictEqual(d.intent, IntentType.REPORT);
    assert.strictEqual(d.type, DecisionType.TOOL_CALL);
  });

  it('REPORT: "analyzuj data" → TOOL_CALL', () => {
    const d = decide('analyzuj data o prodeji');

    assert.strictEqual(d.intent, IntentType.REPORT);
  });

  it('REPORT never returns ANSWER', () => {
    const d = decide('dej mi souhrn');

    assert.notStrictEqual(d.type, DecisionType.ANSWER,
      'REPORT must never be ANSWER');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// INVALID COMBINATIONS (INVARIANT TESTS)
// ════════════════════════════════════════════════════════════════════════════════

describe('Invalid Intent/Type Combinations', () => {

  const invalidCombinations = [
    ['LOCAL', 'TOOL_CALL', /LOCAL_INTENT_CANNOT_CALL_TOOLS/],
    ['CONVERSATIONAL', 'TOOL_CALL', /CONVERSATIONAL.*NEVER call tools/],
    ['SEARCH', 'ANSWER', /ANSWER.*ONLY allowed for CONVERSATIONAL/],
    ['REPORT', 'ANSWER', /ANSWER.*ONLY allowed for CONVERSATIONAL/],
    ['FACTUAL', 'ANSWER', /ANSWER.*ONLY allowed for CONVERSATIONAL/],
  ];

  for (const [intent, type, errorPattern] of invalidCombinations) {
    it(`Invalid: ${intent} + ${type} should throw`, () => {
      assert.throws(() => {
        new CREDecision({
          type: DecisionType[type],
          intent: IntentType[intent],
          tools: type === 'TOOL_CALL' ? ['web.search'] : [],
          reason: `test - ${intent} + ${type} should fail`,
        });
      }, errorPattern);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// VALID COMBINATIONS (POSITIVE INVARIANT TESTS)
// ════════════════════════════════════════════════════════════════════════════════

describe('Valid Intent/Type Combinations', () => {

  const validCombinations = [
    ['LOCAL', 'LOCAL', [], 'local.calendar'],
    ['CONVERSATIONAL', 'ANSWER', [], null],
    ['SEARCH', 'TOOL_CALL', ['web.search'], null],
    ['REPORT', 'TOOL_CALL', ['web.search'], null],
    ['FACTUAL', 'TOOL_CALL', ['web.search'], null],
    ['CODE', 'TOOL_CALL', ['file.read'], null],
    ['AMBIGUOUS', 'ASK_USER', [], null],
  ];

  for (const [intent, type, tools, handler] of validCombinations) {
    it(`Valid: ${intent} + ${type}`, () => {
      const decision = new CREDecision({
        type: DecisionType[type],
        intent: IntentType[intent],
        tools,
        slots: type === 'ASK_USER' ? ['intent_clarification'] : [],
        reason: `test - ${intent} + ${type}`,
        metadata: handler ? { handler } : {},
      });

      assert.strictEqual(decision.type, DecisionType[type]);
      assert.strictEqual(decision.intent, IntentType[intent]);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// RUN INFO
// ════════════════════════════════════════════════════════════════════════════════

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  CRE Decision Tests - Core Logic Layer                                       ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║  Testing pure CRE decision making without handlers                           ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
