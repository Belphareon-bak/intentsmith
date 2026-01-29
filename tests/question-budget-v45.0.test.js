// CRE v45.0 KOLO 3 — Question Budget Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests for Question Budget / Conversational Offers functionality.
//
// INVARIANTS:
// 1. Clear tasks execute immediately (no questions)
// 2. Vague tasks may trigger clarification (max 1 per turn)
// 3. Expansion offers only when response is short AND context allows
// 4. Never offer on gratitude or minimal responses
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  isTaskClear,
  shouldOfferExpansion,
  getExpansionOfferText,
  ResponseIntent,
} from '../src/unification/cre-decision.js';

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Task Clarity Detection
// ════════════════════════════════════════════════════════════════════════════════

describe('Question Budget: Task Clarity', () => {
  describe('clear tasks (should NOT ask questions)', () => {
    const clearTasks = [
      { input: 'Najdi informace o bitcoinu', reason: 'explicit_command' },
      { input: 'Dej mi report o elektromobilech', reason: 'explicit_command' },
      { input: 'Co je to blockchain?', reason: 'explicit_command' },
      { input: 'Cena akcie Tesla', reason: 'explicit_command' },
      { input: 'Find information about electric cars', reason: 'explicit_command' },
      { input: 'Summarize the latest news about AI', reason: 'explicit_command' },
      { input: 'Porovnej bitcoin s ethereem', reason: 'sufficient_detail' },
      { input: 'Jak funguje strojové učení?', reason: 'explicit_command' },
    ];

    for (const { input, reason } of clearTasks) {
      it(`"${input}" is clear (${reason})`, () => {
        const result = isTaskClear(input);
        assert.strictEqual(result.clear, true, `Expected clear=true for "${input}"`);
      });
    }
  });

  describe('unclear tasks (MAY ask questions)', () => {
    const unclearTasks = [
      { input: 'hmm', reason: 'too_short' },
      { input: 'něco', reason: 'vague_input' },
      { input: 'pomoz mi', reason: 'vague_input' },
      { input: 'no', reason: 'too_short' },
      { input: 'help me', reason: 'vague_input' },
      { input: 'stuff', reason: 'vague_input' },
    ];

    for (const { input, reason } of unclearTasks) {
      it(`"${input}" is unclear (${reason})`, () => {
        const result = isTaskClear(input);
        assert.strictEqual(result.clear, false, `Expected clear=false for "${input}"`);
      });
    }
  });

  describe('context-aware clarity', () => {
    it('follow-up in conversation is clear', () => {
      const result = isTaskClear('a jaký trend?', {
        lastIntent: 'FACTUAL',
        conversationLength: 2,
      });
      assert.strictEqual(result.clear, true);
      assert.strictEqual(result.reason, 'conversation_context');
    });

    it('first turn ambiguity requires more detail', () => {
      const result = isTaskClear('report', {
        lastIntent: null,
        conversationLength: 0,
      });
      assert.strictEqual(result.clear, false);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Expansion Offers
// ════════════════════════════════════════════════════════════════════════════════

describe('Question Budget: Expansion Offers', () => {
  describe('should NOT offer expansion', () => {
    it('never on gratitude responses', () => {
      const result = shouldOfferExpansion('Rádo se stalo! Pokud potřebujete více info, ptejte se.', {});
      assert.strictEqual(result.offer, false);
    });

    it('never when user requested MINIMAL', () => {
      const result = shouldOfferExpansion('42', {
        responseIntent: ResponseIntent.MINIMAL,
      });
      assert.strictEqual(result.offer, false);
    });

    it('not too frequently (turnsSinceLastOffer < 3)', () => {
      const result = shouldOfferExpansion('Bitcoin je na 45k USD.', {
        turnsSinceLastOffer: 1,
        intent: 'FACTUAL',
      });
      assert.strictEqual(result.offer, false);
    });
  });

  describe('should offer expansion', () => {
    it('short factual response gets expand_detail offer', () => {
      const result = shouldOfferExpansion('Bitcoin je momentálně na 45 230 USD.', {
        turnsSinceLastOffer: 5,
        intent: 'FACTUAL',
      });
      assert.strictEqual(result.offer, true);
      assert.strictEqual(result.type, 'expand_detail');
    });

    it('single-item response gets comparison offer', () => {
      const result = shouldOfferExpansion('Tesla Model 3 má dojezd 500 km a cenu od 40 000 EUR.', {
        turnsSinceLastOffer: 3,
        intent: 'SEARCH',
      });
      assert.strictEqual(result.offer, true);
      assert.strictEqual(result.type, 'offer_comparison');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Expansion Offer Text
// ════════════════════════════════════════════════════════════════════════════════

describe('Question Budget: Offer Text', () => {
  it('expand_detail has correct text', () => {
    const text = getExpansionOfferText('expand_detail');
    assert.ok(text.includes('podrobnější'));
  });

  it('offer_comparison has correct text', () => {
    const text = getExpansionOfferText('offer_comparison');
    assert.ok(text.includes('srovnat'));
  });

  it('unknown type returns empty string', () => {
    const text = getExpansionOfferText('unknown_type');
    assert.strictEqual(text, '');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Invariants
// ════════════════════════════════════════════════════════════════════════════════

describe('Question Budget: Invariants', () => {
  it('INVARIANT: max 1 question per turn (budget enforcement)', () => {
    // This tests the concept - actual enforcement is in handlers
    // Here we just verify the detection functions work correctly
    const vague1 = isTaskClear('hmm');
    const vague2 = isTaskClear('something');

    assert.strictEqual(vague1.clear, false);
    assert.strictEqual(vague2.clear, false);

    // Both are unclear, but handler should only ask once
    // This invariant is enforced in handlers.js, not here
  });

  it('INVARIANT: gratitude never triggers expansion', () => {
    const gratitudeResponses = [
      'Rádo se stalo!',
      'Není zač, rád pomůžu.',
      'Rádi pomůžeme kdykoliv.',
    ];

    for (const response of gratitudeResponses) {
      const result = shouldOfferExpansion(response, {});
      assert.strictEqual(result.offer, false, `Gratitude "${response}" should not trigger offer`);
    }
  });

  it('INVARIANT: MINIMAL responseIntent blocks expansion', () => {
    const shortResponses = ['42', 'Ano', '28. ledna 2026'];

    for (const response of shortResponses) {
      const result = shouldOfferExpansion(response, {
        responseIntent: ResponseIntent.MINIMAL,
      });
      assert.strictEqual(result.offer, false, `MINIMAL "${response}" should not trigger offer`);
    }
  });
});

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  CRE v45.0 KOLO 3 — Question Budget Tests                                   ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  TEST AREAS:                                                                 ║
║  1. Task Clarity Detection (clear vs unclear tasks)                          ║
║  2. Expansion Offer Logic (when to offer more)                               ║
║  3. Offer Text Generation                                                    ║
║  4. Invariant Enforcement                                                    ║
║                                                                              ║
║  INVARIANTS:                                                                 ║
║  - Clear tasks execute immediately                                           ║
║  - Max 1 question per turn                                                   ║
║  - Gratitude never triggers expansion                                        ║
║  - MINIMAL responseIntent blocks expansion                                   ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
