// CRE v45.0 KOLO 4.4 — Curiosity Budget Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// CONTRACT:
// - NO questions (no "?")
// - Use parentheses format: "(Mohu případně rozvést...)"
// - Max 1 offer per response
// - Never on MINIMAL or gratitude
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  ResponseIntent,
  ImplicitOfferType,
  shouldIncludeImplicitOffer,
  getImplicitOffer,
  validateImplicitOffer,
} from '../src/unification/cre-decision.js';

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: shouldIncludeImplicitOffer
// ════════════════════════════════════════════════════════════════════════════════

describe('Curiosity Budget: shouldIncludeImplicitOffer', () => {
  describe('should NOT include offer', () => {
    it('MINIMAL responseIntent blocks offer', () => {
      const result = shouldIncludeImplicitOffer({
        responseIntent: ResponseIntent.MINIMAL,
      });
      assert.strictEqual(result.shouldOffer, false);
      assert.strictEqual(result.reason, 'MINIMAL_MODE');
    });

    it('prefersMinimal blocks offer', () => {
      const result = shouldIncludeImplicitOffer({
        prefersMinimal: true,
      });
      assert.strictEqual(result.shouldOffer, false);
      assert.strictEqual(result.reason, 'MINIMAL_MODE');
    });

    it('gratitude blocks offer', () => {
      const result = shouldIncludeImplicitOffer({
        isGratitude: true,
      });
      assert.strictEqual(result.shouldOffer, false);
      assert.strictEqual(result.reason, 'GRATITUDE');
    });

    it('too frequent (< 3 turns) blocks offer', () => {
      const result = shouldIncludeImplicitOffer({
        turnsSinceLastOffer: 1,
      });
      assert.strictEqual(result.shouldOffer, false);
      assert.strictEqual(result.reason, 'TOO_FREQUENT');
    });

    it('long response (> 500 chars) blocks offer', () => {
      const result = shouldIncludeImplicitOffer({
        turnsSinceLastOffer: 5,
        responseLength: 600,
      });
      assert.strictEqual(result.shouldOffer, false);
      assert.strictEqual(result.reason, 'RESPONSE_TOO_LONG');
    });
  });

  describe('should include offer', () => {
    it('normal context allows offer', () => {
      const result = shouldIncludeImplicitOffer({
        responseIntent: ResponseIntent.DIRECT,
        turnsSinceLastOffer: 5,
        responseLength: 200,
      });
      assert.strictEqual(result.shouldOffer, true);
    });

    it('BULLETS responseIntent allows offer', () => {
      const result = shouldIncludeImplicitOffer({
        responseIntent: ResponseIntent.BULLETS,
        turnsSinceLastOffer: 3,
        responseLength: 100,
      });
      assert.strictEqual(result.shouldOffer, true);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: getImplicitOffer
// ════════════════════════════════════════════════════════════════════════════════

describe('Curiosity Budget: getImplicitOffer', () => {
  it('returns empty for MINIMAL', () => {
    const offer = getImplicitOffer({
      responseIntent: ResponseIntent.MINIMAL,
    });
    assert.strictEqual(offer, '');
  });

  it('returns empty for gratitude', () => {
    const offer = getImplicitOffer({
      isGratitude: true,
    });
    assert.strictEqual(offer, '');
  });

  it('returns offer for normal context', () => {
    const offer = getImplicitOffer({
      responseIntent: ResponseIntent.DIRECT,
      turnsSinceLastOffer: 5,
      responseLength: 100,
      responseContent: 'Toto je odpověď.',
    });
    assert.ok(offer.length > 0, 'Should return non-empty offer');
    assert.ok(offer.includes('(Mohu'), 'Should start with parenthetical');
  });

  it('chooses strategy offer for strategy content', () => {
    const offer = getImplicitOffer({
      turnsSinceLastOffer: 5,
      responseLength: 100,
      responseContent: 'Tato strategie je efektivní.',
    });
    assert.ok(offer.includes('strateg'), 'Should offer strategy expansion');
  });

  it('chooses risks offer for risk content', () => {
    const offer = getImplicitOffer({
      turnsSinceLastOffer: 5,
      responseLength: 100,
      responseContent: 'Hlavní riziko je volatilita.',
    });
    assert.ok(offer.includes('rizik'), 'Should offer risks expansion');
  });

  it('chooses examples offer for generic content', () => {
    const offer = getImplicitOffer({
      turnsSinceLastOffer: 5,
      responseLength: 100,
      responseContent: 'Bitcoin je kryptoměna.',
    });
    assert.ok(offer.includes('příklad'), 'Should offer examples expansion');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: validateImplicitOffer
// ════════════════════════════════════════════════════════════════════════════════

describe('Curiosity Budget: validateImplicitOffer', () => {
  it('empty offer is valid', () => {
    const result = validateImplicitOffer('');
    assert.strictEqual(result.valid, true);
  });

  it('parenthetical offer without question is valid', () => {
    const result = validateImplicitOffer('(Mohu případně rozvést strategii.)');
    assert.strictEqual(result.valid, true);
  });

  it('offer with question mark is INVALID', () => {
    const result = validateImplicitOffer('Chcete více informací?');
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.violation, 'CONTAINS_QUESTION');
  });

  it('offer without parentheses is INVALID', () => {
    const result = validateImplicitOffer('Mohu případně rozvést strategii.');
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.violation, 'NOT_PARENTHETICAL');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Contract Invariants
// ════════════════════════════════════════════════════════════════════════════════

describe('Curiosity Budget: Contract Invariants', () => {
  it('INVARIANT: All built-in offers have no questions', () => {
    const contexts = [
      { responseContent: 'strategie', turnsSinceLastOffer: 5, responseLength: 100 },
      { responseContent: 'riziko', turnsSinceLastOffer: 5, responseLength: 100 },
      { responseContent: 'příklad', turnsSinceLastOffer: 5, responseLength: 100 },
      { responseContent: 'alternativa', turnsSinceLastOffer: 5, responseLength: 100 },
      { responseContent: 'zdroj', turnsSinceLastOffer: 5, responseLength: 100 },
      { responseContent: 'krok', turnsSinceLastOffer: 5, responseLength: 100 },
    ];

    for (const ctx of contexts) {
      const offer = getImplicitOffer(ctx);
      if (offer) {
        assert.ok(
          !offer.includes('?'),
          `Offer "${offer}" should not contain question mark`
        );
      }
    }
  });

  it('INVARIANT: All built-in offers are parenthetical', () => {
    const offer = getImplicitOffer({
      responseContent: 'test',
      turnsSinceLastOffer: 5,
      responseLength: 100,
    });

    if (offer.trim()) {
      assert.ok(offer.includes('('), 'Offer should contain opening parenthesis');
      assert.ok(offer.includes(')'), 'Offer should contain closing parenthesis');
    }
  });

  it('INVARIANT: MINIMAL never gets offer', () => {
    const contexts = [
      { responseIntent: ResponseIntent.MINIMAL, turnsSinceLastOffer: 100 },
      { prefersMinimal: true, turnsSinceLastOffer: 100 },
    ];

    for (const ctx of contexts) {
      const offer = getImplicitOffer(ctx);
      assert.strictEqual(offer, '', 'MINIMAL should never get offer');
    }
  });

  it('INVARIANT: Max 1 offer per response (no multiple offers)', () => {
    const offer = getImplicitOffer({
      responseContent: 'strategie a rizika a příklady',
      turnsSinceLastOffer: 5,
      responseLength: 100,
    });

    // Count "(Mohu" occurrences
    const offerCount = (offer.match(/\(Mohu/g) || []).length;
    assert.ok(offerCount <= 1, `Should have max 1 offer, found ${offerCount}`);
  });
});

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  CRE v45.0 KOLO 4.4 — Curiosity Budget Tests                                ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  CONTRACT:                                                                   ║
║  - NO questions (no "?")                                                     ║
║  - Parenthetical format: "(Mohu případně...)"                                ║
║  - Max 1 offer per response                                                  ║
║  - Never on MINIMAL or gratitude                                             ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
