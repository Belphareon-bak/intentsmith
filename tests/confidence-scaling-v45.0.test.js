// CRE v45.0 KOLO 5.3 — Answer Confidence Scaling Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// CONTRACT:
// - Response sounds CONFIDENT when data is strong
// - Response sounds CAUTIOUS when data is weak
// - NO explicit disclaimers ("Nemohu si být jistý...")
// - Use natural hedging ("Dostupná data naznačují...")
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  ConfidenceLevel,
  calculateAnswerConfidence,
  FORBIDDEN_DISCLAIMERS,
  HEDGING_PHRASES,
  getConfidenceSynthesisInstructions,
  selectHedgingPhrase,
  validateConfidenceResponse,
} from '../src/quality/confidence-scaling.js';

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Confidence Calculation
// ════════════════════════════════════════════════════════════════════════════════

describe('Confidence Scaling: Calculation', () => {
  it('HIGH confidence with strong data', () => {
    const filtered = {
      relevant: [
        { _relevance: { score: 0.9 } },
        { _relevance: { score: 0.85 } },
        { _relevance: { score: 0.8 } },
      ],
      marginal: [],
      stats: { avgRelevantScore: 0.85, relevant: 3 },
    };

    const annotated = [
      { _sourceTrust: { trust: 'official' } },
      { _sourceTrust: { trust: 'media' } },
      { _sourceTrust: { trust: 'official' } },
    ];

    const { level } = calculateAnswerConfidence(filtered, annotated);

    assert.strictEqual(level, ConfidenceLevel.HIGH);
  });

  it('LOW confidence with weak data', () => {
    const filtered = {
      relevant: [{ _relevance: { score: 0.35 } }],
      marginal: [],
      stats: { avgRelevantScore: 0.35, relevant: 1 },
    };

    const annotated = [
      { _sourceTrust: { trust: 'unknown' } },
    ];

    const { level } = calculateAnswerConfidence(filtered, annotated);

    assert.ok(
      level === ConfidenceLevel.LOW || level === ConfidenceLevel.UNCERTAIN,
      `Expected LOW or UNCERTAIN, got ${level}`
    );
  });

  it('UNCERTAIN with no relevant sources', () => {
    const filtered = {
      relevant: [],
      marginal: [],
      stats: { avgRelevantScore: 0, relevant: 0 },
    };

    const { level } = calculateAnswerConfidence(filtered, []);

    assert.strictEqual(level, ConfidenceLevel.UNCERTAIN);
  });

  it('boosts confidence for official sources', () => {
    const filtered = {
      relevant: [{ _relevance: { score: 0.6 } }],
      marginal: [],
      stats: { avgRelevantScore: 0.6, relevant: 1 },
    };

    const withOfficial = [{ _sourceTrust: { trust: 'official' } }];
    const withUnknown = [{ _sourceTrust: { trust: 'unknown' } }];

    const officialConfidence = calculateAnswerConfidence(filtered, withOfficial);
    const unknownConfidence = calculateAnswerConfidence(filtered, withUnknown);

    assert.ok(
      officialConfidence.score > unknownConfidence.score,
      'Official source should boost confidence'
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Hedging Phrases
// ════════════════════════════════════════════════════════════════════════════════

describe('Confidence Scaling: Hedging Phrases', () => {
  it('HIGH confidence has no hedging', () => {
    const phrase = selectHedgingPhrase(ConfidenceLevel.HIGH);
    assert.strictEqual(phrase, '', 'HIGH confidence should not hedge');
  });

  it('MEDIUM confidence has mild hedging', () => {
    const phrase = selectHedgingPhrase(ConfidenceLevel.MEDIUM);
    assert.ok(phrase.length > 0, 'MEDIUM confidence should have hedging');
    const lower = phrase.toLowerCase();
    assert.ok(
      lower.includes('dostupn') || lower.includes('základ'),
      `Should use natural hedging, got: "${phrase}"`
    );
  });

  it('LOW confidence has stronger hedging', () => {
    const phrase = selectHedgingPhrase(ConfidenceLevel.LOW);
    assert.ok(phrase.length > 0);
    const lower = phrase.toLowerCase();
    assert.ok(
      lower.includes('naznač') || lower.includes('pravděpodobně') || lower.includes('neověřen') || lower.includes('některé'),
      `Should indicate uncertainty, got: "${phrase}"`
    );
  });

  it('UNCERTAIN confidence acknowledges limitations', () => {
    const phrase = selectHedgingPhrase(ConfidenceLevel.UNCERTAIN);
    assert.ok(phrase.length > 0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Forbidden Disclaimers
// ════════════════════════════════════════════════════════════════════════════════

describe('Confidence Scaling: Forbidden Disclaimers', () => {
  it('detects "Nemohu si být jistý"', () => {
    const response = 'Nemohu si být jistý, ale myslím že ano.';
    const { valid, violations } = validateConfidenceResponse(response);

    assert.strictEqual(valid, false);
    assert.ok(violations.length > 0);
  });

  it('detects "Jako AI"', () => {
    const response = 'Jako AI nemám přístup k aktuálním datům.';
    const { valid } = validateConfidenceResponse(response);

    assert.strictEqual(valid, false);
  });

  it('detects "Omlouvám se"', () => {
    const response = 'Omlouvám se, ale na tuto otázku neznám odpověď.';
    const { valid } = validateConfidenceResponse(response);

    assert.strictEqual(valid, false);
  });

  it('detects English disclaimers', () => {
    const response = 'I cannot be certain about this information.';
    const { valid } = validateConfidenceResponse(response);

    assert.strictEqual(valid, false);
  });

  it('allows valid responses without disclaimers', () => {
    const response = 'Bitcoin aktuálně stojí 45000 USD.';
    const { valid } = validateConfidenceResponse(response);

    assert.strictEqual(valid, true);
  });

  it('allows natural hedging', () => {
    const response = 'Podle dostupných zdrojů je cena stabilní.';
    const { valid } = validateConfidenceResponse(response);

    assert.strictEqual(valid, true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Synthesis Instructions
// ════════════════════════════════════════════════════════════════════════════════

describe('Confidence Scaling: Synthesis Instructions', () => {
  it('HIGH confidence says to be direct', () => {
    const confidence = { level: ConfidenceLevel.HIGH, factors: ['high_relevance'] };
    const instructions = getConfidenceSynthesisInstructions(confidence);

    assert.ok(instructions.includes('Vysoká'), 'Should indicate high confidence');
    assert.ok(instructions.includes('přímo') || instructions.includes('sebevědom'), 'Should encourage directness');
  });

  it('LOW confidence recommends hedging', () => {
    const confidence = { level: ConfidenceLevel.LOW, factors: ['low_relevance'] };
    const instructions = getConfidenceSynthesisInstructions(confidence);

    assert.ok(instructions.includes('Nízká'), 'Should indicate low confidence');
    assert.ok(instructions.includes('naznač') || instructions.includes('Dostupná data'), 'Should suggest hedging');
  });

  it('always includes forbidden phrases reminder', () => {
    const confidence = { level: ConfidenceLevel.MEDIUM, factors: [] };
    const instructions = getConfidenceSynthesisInstructions(confidence);

    assert.ok(instructions.includes('ZAKÁZANÉ FRÁZE'));
    assert.ok(instructions.includes('Nemohu si být jist'));
    assert.ok(instructions.includes('Jako AI'));
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Contract Invariants
// ════════════════════════════════════════════════════════════════════════════════

describe('Confidence Scaling: Contract Invariants', () => {
  it('INVARIANT: Score is always 0-1', () => {
    const testCases = [
      { filtered: { relevant: [], marginal: [], stats: { avgRelevantScore: 0 } }, annotated: [] },
      { filtered: { relevant: Array(10).fill({ _relevance: { score: 1 } }), marginal: [], stats: { avgRelevantScore: 1 } }, annotated: Array(10).fill({ _sourceTrust: { trust: 'official' } }) },
    ];

    for (const { filtered, annotated } of testCases) {
      const { score } = calculateAnswerConfidence(filtered, annotated);
      assert.ok(score >= 0 && score <= 1, `Score ${score} should be 0-1`);
    }
  });

  it('INVARIANT: Level always valid', () => {
    const levels = Object.values(ConfidenceLevel);
    const { level } = calculateAnswerConfidence(
      { relevant: [], marginal: [], stats: { avgRelevantScore: 0.5 } },
      []
    );

    assert.ok(levels.includes(level), `Level ${level} should be valid`);
  });

  it('INVARIANT: All hedging phrases are non-empty for non-HIGH', () => {
    for (const [level, phrases] of Object.entries(HEDGING_PHRASES)) {
      if (level === ConfidenceLevel.HIGH) continue;

      const nonEmpty = phrases.filter(p => p.length > 0);
      assert.ok(nonEmpty.length > 0, `${level} should have at least one hedging phrase`);
    }
  });

  it('CONTRACT: No hedging phrase contains forbidden patterns', () => {
    const allPhrases = Object.values(HEDGING_PHRASES).flat();

    for (const phrase of allPhrases) {
      if (!phrase) continue;

      for (const forbidden of FORBIDDEN_DISCLAIMERS) {
        assert.ok(
          !forbidden.test(phrase),
          `Hedging phrase "${phrase}" should not match forbidden pattern ${forbidden}`
        );
      }
    }
  });
});

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  CRE v45.0 KOLO 5.3 — Answer Confidence Scaling Tests                       ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  CONTRACT:                                                                   ║
║  - CONFIDENT when data is strong                                             ║
║  - CAUTIOUS when data is weak                                                ║
║  - NO explicit disclaimers                                                   ║
║  - Use natural hedging                                                       ║
║                                                                              ║
║  ❌ "Nemohu si být jistý..."                                                 ║
║  ✅ "Dostupná data naznačují..."                                             ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
