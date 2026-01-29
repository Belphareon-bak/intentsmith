// CRE v45.0 KOLO 4 — Conversational Style Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests for ConversationStyle inference system.
//
// KEY INVARIANTS:
// 1. Signals inferred from behavior, not explicit feedback
// 2. Confidence decays over time
// 3. Topic change causes decay
// 4. Default toleratesLinks = true
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  ConversationStyle,
  STYLE_SIGNAL_PATTERNS,
  DECAY_ON_TOPIC_CHANGE,
  DECAY_PER_TURN,
  SIGNAL_BOOST,
} from '../src/memory/conversation-style.js';

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Signal Detection
// ════════════════════════════════════════════════════════════════════════════════

describe('ConversationStyle: Signal Detection', () => {
  let style;

  beforeEach(() => {
    style = new ConversationStyle();
  });

  describe('prefersMinimal signals', () => {
    const minimalInputs = [
      'Jen číslo',
      'Stručně prosím',
      'Zkrať to',
      'Žádné výplně',
      'Just the number',
      'Brief please',
      'No fluff',
    ];

    for (const input of minimalInputs) {
      it(`"${input}" triggers prefersMinimal`, () => {
        const signals = style.processInput(input);
        assert.ok(
          signals.some(s => s.dimension === 'prefersMinimal'),
          `Expected prefersMinimal signal for "${input}"`
        );
        assert.strictEqual(style.prefers('prefersMinimal'), true);
      });
    }
  });

  describe('prefersNumbers signals', () => {
    const numberInputs = [
      'Jen číslo',
      'Kolik přesně?',
      'Dej mi číslo',
      'Just the number',
      'How much exactly?',
    ];

    for (const input of numberInputs) {
      it(`"${input}" triggers prefersNumbers`, () => {
        const signals = style.processInput(input);
        assert.ok(
          signals.some(s => s.dimension === 'prefersNumbers'),
          `Expected prefersNumbers signal for "${input}"`
        );
      });
    }
  });

  describe('toleratesLinks signals', () => {
    it('"Ne odkazy" sets toleratesLinks = false', () => {
      style.processInput('Ne odkazy prosím');
      assert.strictEqual(style.shouldIncludeLinks(), false);
    });

    it('"Bez odkazů" sets toleratesLinks = false', () => {
      style.processInput('Odpověz bez odkazů');
      assert.strictEqual(style.shouldIncludeLinks(), false);
    });

    it('"Dej mi odkaz" sets toleratesLinks = true', () => {
      // First set to false
      style.processInput('Ne odkazy');
      assert.strictEqual(style.shouldIncludeLinks(), false);

      // Then explicitly ask for links
      style.processInput('Dej mi odkaz na zdroj');
      assert.strictEqual(style.shouldIncludeLinks(), true);
    });

    it('Default toleratesLinks = true', () => {
      assert.strictEqual(style.shouldIncludeLinks(), true);
    });
  });

  describe('prefersExamples signals', () => {
    const exampleInputs = [
      'Rozveď to',
      'Dej mi příklad',
      'Podrobněji prosím',
      'Explain more',
      'Give me an example',
    ];

    for (const input of exampleInputs) {
      it(`"${input}" triggers prefersExamples`, () => {
        const signals = style.processInput(input);
        assert.ok(
          signals.some(s => s.dimension === 'prefersExamples'),
          `Expected prefersExamples signal for "${input}"`
        );
      });
    }
  });

  describe('prefersStructure signals', () => {
    it('"V bodech" triggers prefersStructure', () => {
      style.processInput('Dej mi to v bodech');
      assert.strictEqual(style.prefers('prefersStructure'), true);
    });

    it('"Seznam" triggers prefersStructure', () => {
      style.processInput('Jako seznam');
      assert.strictEqual(style.prefers('prefersStructure'), true);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Confidence Decay
// ════════════════════════════════════════════════════════════════════════════════

describe('ConversationStyle: Confidence Decay', () => {
  let style;

  beforeEach(() => {
    style = new ConversationStyle();
  });

  it('confidence increases with signal', () => {
    const beforeConfidence = style.dimensions.prefersMinimal.confidence;
    style.processInput('Stručně');
    const afterConfidence = style.dimensions.prefersMinimal.confidence;

    assert.ok(
      afterConfidence > beforeConfidence,
      `Confidence should increase: ${beforeConfidence} → ${afterConfidence}`
    );
  });

  it('confidence decays per turn', () => {
    // Set initial signal
    style.processInput('Stručně');
    const initialConfidence = style.dimensions.prefersMinimal.confidence;

    // Process neutral input (causes decay)
    style.processInput('Jaká je cena bitcoinu?');
    const afterDecay = style.dimensions.prefersMinimal.confidence;

    assert.ok(
      afterDecay < initialConfidence,
      `Confidence should decay: ${initialConfidence} → ${afterDecay}`
    );
  });

  it('topic change causes additional decay', () => {
    // Set signal on Topic A
    style.processInput('Stručně', 'topic_a');
    const topicAConfidence = style.dimensions.prefersMinimal.confidence;

    // Change to Topic B
    style.processInput('Co je blockchain?', 'topic_b');
    const topicBConfidence = style.dimensions.prefersMinimal.confidence;

    // Should have both turn decay and topic decay
    const expectedDecay = topicAConfidence * DECAY_PER_TURN * DECAY_ON_TOPIC_CHANGE;

    assert.ok(
      Math.abs(topicBConfidence - expectedDecay) < 0.01,
      `Topic change should apply extra decay: ${topicAConfidence} → ${topicBConfidence} (expected ~${expectedDecay})`
    );
  });

  it('confidence resets to default when too low', () => {
    // Set minimal preference
    style.processInput('Stručně');
    assert.strictEqual(style.prefers('prefersMinimal', 0.1), true);

    // Simulate many turns without reinforcement
    for (let i = 0; i < 100; i++) {
      style.processInput('Neutral input');
    }

    // Should reset to default (false for prefersMinimal)
    assert.strictEqual(
      style.dimensions.prefersMinimal.value,
      false,
      'Should reset to default when confidence decays'
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Synthesis Hints
// ════════════════════════════════════════════════════════════════════════════════

describe('ConversationStyle: Synthesis Hints', () => {
  let style;

  beforeEach(() => {
    style = new ConversationStyle();
  });

  it('generates hints for active preferences', () => {
    style.processInput('Jen číslo, bez odkazů');

    const hints = style.getSynthesisHints();

    assert.ok(hints.length > 0, 'Should generate hints');
    assert.ok(
      hints.some(h => h.toLowerCase().includes('minimal') || h.toLowerCase().includes('concise')),
      'Should include minimal hint'
    );
    assert.ok(
      hints.some(h => h.toLowerCase().includes('link') || h.toLowerCase().includes('url')),
      'Should include no-links hint'
    );
  });

  it('returns empty hints when no preferences active', () => {
    const hints = style.getSynthesisHints();
    assert.strictEqual(hints.length, 0, 'Should have no hints initially');
  });

  it('getEffectiveStyle respects threshold', () => {
    style.processInput('Stručně');

    // With low threshold, should include the preference
    const lowThreshold = style.getEffectiveStyle(0.1);
    assert.ok('prefersMinimal' in lowThreshold);

    // With high threshold, should not include
    const highThreshold = style.getEffectiveStyle(0.9);
    assert.ok(!('prefersMinimal' in highThreshold) || highThreshold.prefersMinimal === undefined);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Integration Scenarios
// ════════════════════════════════════════════════════════════════════════════════

describe('ConversationStyle: Integration Scenarios', () => {
  let style;

  beforeEach(() => {
    style = new ConversationStyle();
  });

  it('Scenario E: Preference inference (numbers only)', () => {
    // Turn 1: Normal question
    style.processInput('Jaký je kurz USD?', 'currency');
    let effective = style.getEffectiveStyle();
    assert.ok(!effective.prefersNumbers, 'Should not prefer numbers yet');

    // Turn 2: "Jen číslo"
    style.processInput('Jen číslo', 'currency');
    effective = style.getEffectiveStyle();
    assert.strictEqual(effective.prefersMinimal, true, 'Should prefer minimal');
    assert.strictEqual(effective.prefersNumbers, true, 'Should prefer numbers');

    // Turn 3: Follow-up (preference should persist)
    style.processInput('A EUR?', 'currency');
    effective = style.getEffectiveStyle();
    assert.strictEqual(effective.prefersNumbers, true, 'Should still prefer numbers');
  });

  it('Scenario: No links persistence', () => {
    // Turn 1: Request no links
    style.processInput('Odpověz bez odkazů', 'topic1');
    assert.strictEqual(style.shouldIncludeLinks(), false);

    // Turn 2: Normal question (links still off)
    style.processInput('Co je to AI?', 'topic1');
    assert.strictEqual(style.shouldIncludeLinks(), false, 'Should still not include links');

    // Turn 3: Topic change (links decay but might still be off)
    style.processInput('Jaká je cena bitcoinu?', 'topic2');
    // After topic change, tolerance should have decayed
    const dim = style.dimensions.toleratesLinks;
    assert.ok(dim.confidence < SIGNAL_BOOST, 'Confidence should decay on topic change');
  });

  it('Scenario: Conflicting signals', () => {
    // First prefer examples
    style.processInput('Rozveď to s příklady');
    assert.strictEqual(style.prefers('prefersExamples'), true);

    // Then prefer minimal (should override)
    style.processInput('Stručně, bez příkladů');
    assert.strictEqual(style.prefers('prefersMinimal'), true);

    // Both are active with different confidence
    const effective = style.getEffectiveStyle(0.1);
    assert.ok(effective.prefersMinimal || effective.prefersExamples);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Invariants
// ════════════════════════════════════════════════════════════════════════════════

describe('ConversationStyle: Invariants', () => {
  it('INVARIANT: toleratesLinks defaults to true', () => {
    const style = new ConversationStyle();
    assert.strictEqual(style.shouldIncludeLinks(), true);
  });

  it('INVARIANT: reset() restores defaults', () => {
    const style = new ConversationStyle();
    style.processInput('Jen číslo, bez odkazů');

    assert.strictEqual(style.prefers('prefersMinimal'), true);
    assert.strictEqual(style.shouldIncludeLinks(), false);

    style.reset();

    assert.strictEqual(style.prefers('prefersMinimal'), false);
    assert.strictEqual(style.shouldIncludeLinks(), true);
    assert.strictEqual(style.turnCount, 0);
  });

  it('INVARIANT: signal history is bounded', () => {
    const style = new ConversationStyle();

    // Generate many signals
    for (let i = 0; i < 100; i++) {
      style.processInput('Stručně');
    }

    assert.ok(
      style.signalHistory.length <= 50,
      `History should be bounded: ${style.signalHistory.length}`
    );
  });
});

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  CRE v45.0 KOLO 4 — Conversational Style Tests                              ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  TEST AREAS:                                                                 ║
║  1. Signal Detection (prefersMinimal, prefersNumbers, toleratesLinks, etc.)  ║
║  2. Confidence Decay (per turn, on topic change)                             ║
║  3. Synthesis Hints generation                                               ║
║  4. Integration scenarios (preference inference)                             ║
║                                                                              ║
║  KEY DIFFERENCE from UserPreferences:                                        ║
║  ConversationStyle = INFERRED from behavior                                  ║
║  UserPreferences = EXPLICIT feedback                                         ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
