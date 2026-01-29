// CRE v45.0 KOLO 4.2 — Atomic Answer Gate Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// CONTRACT:
// If ResponseIntent === MINIMAL or prefersMinimal === true:
// - Response MUST be 1 sentence
// - NO intro phrases
// - NO explanations
// - NO links
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert';

// Import the functions we need to test
// Note: These are internal functions, we'll test via the module interface
import { ResponseIntent } from '../src/unification/cre-decision.js';

// ════════════════════════════════════════════════════════════════════════════════
// Helper: Mimic atomicAnswerGate logic for testing
// ════════════════════════════════════════════════════════════════════════════════

const ATOMIC_FORBIDDEN_PATTERNS = [
  /^ano[,\s]/i,
  /^samozřejmě/i,
  /^jistě/i,
  /zde je/i,
  /tady je/i,
  /here is/i,
  /here's/i,
  /mohu (případně|také)/i,
  /can also/i,
  /pokud chcete/i,
  /if you want/i,
  /chcete.*\?/i,
  /want.*\?/i,
  /https?:\/\//i,
];

function countSentences(text) {
  if (!text) return 0;
  return text
    .split(/[.!?]+/)
    .filter(s => s.trim().length > 3)
    .length;
}

function atomicAnswerGate(content, options = {}) {
  const { responseIntent, prefersMinimal } = options;

  if (responseIntent !== 'MINIMAL' && !prefersMinimal) {
    return { pass: true };
  }

  if (!content || typeof content !== 'string') {
    return { pass: false, reason: 'EMPTY_RESPONSE' };
  }

  const trimmed = content.trim();

  for (const pattern of ATOMIC_FORBIDDEN_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        pass: false,
        reason: 'FORBIDDEN_PATTERN',
        violation: pattern.toString(),
      };
    }
  }

  const sentences = countSentences(trimmed);
  if (sentences > 1) {
    return {
      pass: false,
      reason: 'TOO_MANY_SENTENCES',
      count: sentences,
    };
  }

  if (trimmed.length > 200) {
    return {
      pass: false,
      reason: 'TOO_LONG',
      length: trimmed.length,
    };
  }

  return { pass: true };
}

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Atomic Responses (PASS)
// ════════════════════════════════════════════════════════════════════════════════

describe('Atomic Answer Gate: Valid Responses (PASS)', () => {
  const validAtomicResponses = [
    '45 230 USD',
    'Bitcoin je kryptoměna.',
    'Ano.',
    'Ne.',
    '28. ledna 2026',
    '42',
    'Trh roste.',
    'Tesla Model 3.',
    'Ethereum.',
    'Stoupá o 15 %.',
  ];

  for (const response of validAtomicResponses) {
    it(`"${response}" passes atomic gate`, () => {
      const result = atomicAnswerGate(response, {
        responseIntent: 'MINIMAL',
      });
      assert.strictEqual(result.pass, true, `Expected PASS for "${response}"`);
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Non-Atomic Responses (FAIL)
// ════════════════════════════════════════════════════════════════════════════════

describe('Atomic Answer Gate: Invalid Responses (FAIL)', () => {
  describe('Forbidden intro phrases', () => {
    const forbiddenIntros = [
      'Ano, zde je odpověď: 45 230 USD',
      'Samozřejmě! Bitcoin je na 45k.',
      'Jistě, zde je cena.',
      'Zde je požadovaná informace.',
      'Tady je číslo.',
      "Here is the answer.",
      "Here's what you need.",
    ];

    for (const response of forbiddenIntros) {
      it(`"${response}" fails (forbidden intro)`, () => {
        const result = atomicAnswerGate(response, {
          responseIntent: 'MINIMAL',
        });
        assert.strictEqual(result.pass, false);
        assert.strictEqual(result.reason, 'FORBIDDEN_PATTERN');
      });
    }
  });

  describe('Forbidden offers', () => {
    const forbiddenOffers = [
      'Bitcoin je na 45k. Mohu případně rozvést.',
      '45 230 USD. Chcete více informací?',
      'Stoupá. Pokud chcete, mohu vysvětlit.',
    ];

    for (const response of forbiddenOffers) {
      it(`"${response}" fails (forbidden offer)`, () => {
        const result = atomicAnswerGate(response, {
          responseIntent: 'MINIMAL',
        });
        assert.strictEqual(result.pass, false);
      });
    }
  });

  describe('Forbidden links', () => {
    it('Response with URL fails', () => {
      const result = atomicAnswerGate('45k https://example.com', {
        responseIntent: 'MINIMAL',
      });
      assert.strictEqual(result.pass, false);
      assert.strictEqual(result.reason, 'FORBIDDEN_PATTERN');
    });
  });

  describe('Too many sentences', () => {
    const multiSentence = [
      'Bitcoin je kryptoměna. Vznikla v roce 2009.',
      'Cena je 45k. Trend je rostoucí. Doporučuji sledovat.',
    ];

    for (const response of multiSentence) {
      it(`"${response}" fails (multiple sentences)`, () => {
        const result = atomicAnswerGate(response, {
          responseIntent: 'MINIMAL',
        });
        assert.strictEqual(result.pass, false);
        assert.strictEqual(result.reason, 'TOO_MANY_SENTENCES');
      });
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Gate Bypass (Non-MINIMAL)
// ════════════════════════════════════════════════════════════════════════════════

describe('Atomic Answer Gate: Bypass for Non-MINIMAL', () => {
  it('Long response passes if not MINIMAL', () => {
    const longResponse = `Bitcoin je decentralizovaná kryptoměna. Vznikla v roce 2009.
    Používá technologii blockchain. Cena je velmi volatilní.`;

    const result = atomicAnswerGate(longResponse, {
      responseIntent: 'DIRECT',
      prefersMinimal: false,
    });

    assert.strictEqual(result.pass, true, 'Non-MINIMAL should bypass gate');
  });

  it('Intro phrase passes if not MINIMAL', () => {
    const result = atomicAnswerGate('Ano, zde je odpověď.', {
      responseIntent: 'BULLETS',
    });
    assert.strictEqual(result.pass, true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: prefersMinimal Trigger
// ════════════════════════════════════════════════════════════════════════════════

describe('Atomic Answer Gate: prefersMinimal Trigger', () => {
  it('prefersMinimal=true activates gate even without MINIMAL responseIntent', () => {
    const result = atomicAnswerGate('Ano, zde je odpověď: 45k.', {
      responseIntent: 'DIRECT',
      prefersMinimal: true,
    });

    assert.strictEqual(result.pass, false, 'prefersMinimal should activate gate');
  });

  it('Long response fails with prefersMinimal=true', () => {
    const result = atomicAnswerGate('Bitcoin je kryptoměna. Vznikla v roce 2009.', {
      prefersMinimal: true,
    });

    assert.strictEqual(result.pass, false);
    assert.strictEqual(result.reason, 'TOO_MANY_SENTENCES');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Sentence Count
// ════════════════════════════════════════════════════════════════════════════════

describe('Atomic Answer Gate: Sentence Counting', () => {
  it('counts "." as sentence end', () => {
    assert.strictEqual(countSentences('Hello. World.'), 2);
  });

  it('counts "!" as sentence end', () => {
    assert.strictEqual(countSentences('Hello! World!'), 2);
  });

  it('counts "?" as sentence end', () => {
    assert.strictEqual(countSentences('Hello? World?'), 2);
  });

  it('ignores short fragments', () => {
    assert.strictEqual(countSentences('OK. This is a sentence.'), 1);
  });

  it('handles single sentence', () => {
    assert.strictEqual(countSentences('Bitcoin je kryptoměna.'), 1);
  });

  it('handles numbers without false positive', () => {
    assert.strictEqual(countSentences('45.230 USD'), 1);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Contract Invariants
// ════════════════════════════════════════════════════════════════════════════════

describe('Atomic Answer Gate: Contract Invariants', () => {
  it('INVARIANT: MINIMAL response must be exactly 1 sentence', () => {
    const oneSentence = atomicAnswerGate('Bitcoin stojí 45k.', {
      responseIntent: 'MINIMAL',
    });
    const twoSentences = atomicAnswerGate('Bitcoin stojí 45k. Trend je rostoucí.', {
      responseIntent: 'MINIMAL',
    });

    assert.strictEqual(oneSentence.pass, true);
    assert.strictEqual(twoSentences.pass, false);
  });

  it('INVARIANT: No "zde je" in MINIMAL', () => {
    const result = atomicAnswerGate('Zde je odpověď.', {
      responseIntent: 'MINIMAL',
    });
    assert.strictEqual(result.pass, false);
  });

  it('INVARIANT: No offers in MINIMAL', () => {
    const result = atomicAnswerGate('45k. Mohu případně rozvést.', {
      responseIntent: 'MINIMAL',
    });
    assert.strictEqual(result.pass, false);
  });
});

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  CRE v45.0 KOLO 4.2 — Atomic Answer Gate Tests                              ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  CONTRACT:                                                                   ║
║  - MINIMAL response = 1 sentence                                             ║
║  - NO intro phrases ("Ano, zde je...")                                       ║
║  - NO explanations                                                           ║
║  - NO offers                                                                 ║
║  - NO links                                                                  ║
║                                                                              ║
║  TRIGGERS:                                                                   ║
║  - ResponseIntent === MINIMAL                                                ║
║  - ConversationStyle.prefersMinimal === true                                 ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
