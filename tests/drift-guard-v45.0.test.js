// CRE v45.0 KOLO 5.5 — Long-Form Drift Guard Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// CONTRACT:
// After 15+ turns, guard against:
// - Repetition (saying the same thing)
// - Unnecessary expansion (growing without reason)
// - Template starts (robotic openings)
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  DRIFT_GUARD_TURN_THRESHOLD,
  REPETITION_SIMILARITY_THRESHOLD,
  EXPANSION_RATIO_THRESHOLD,
  TEMPLATE_START_PATTERNS,
  calculateTextSimilarity,
  detectRepetition,
  detectExpansionDrift,
  detectTemplateStart,
  DriftGuard,
  validateAgainstDrift,
} from '../src/quality/drift-guard.js';

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Text Similarity
// ════════════════════════════════════════════════════════════════════════════════

describe('Drift Guard: Text Similarity', () => {
  it('identical texts have similarity 1.0', () => {
    const text = 'Bitcoin je digitální měna používaná online.';
    const similarity = calculateTextSimilarity(text, text);

    assert.strictEqual(similarity, 1.0);
  });

  it('completely different texts have low similarity', () => {
    const text1 = 'Bitcoin je kryptoměna.';
    const text2 = 'Počasí bude zítra slunečné.';
    const similarity = calculateTextSimilarity(text1, text2);

    assert.ok(similarity < 0.3, `Similarity ${similarity} should be < 0.3`);
  });

  it('partially similar texts have medium similarity', () => {
    const text1 = 'Bitcoin je digitální měna pro online platby.';
    const text2 = 'Bitcoin je kryptoměna určená pro online transakce.';
    const similarity = calculateTextSimilarity(text1, text2);

    assert.ok(similarity > 0.3 && similarity < 0.8, `Similarity ${similarity} should be medium`);
  });

  it('handles empty texts', () => {
    assert.strictEqual(calculateTextSimilarity('', 'něco'), 0);
    assert.strictEqual(calculateTextSimilarity('něco', ''), 0);
    assert.strictEqual(calculateTextSimilarity('', ''), 0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Repetition Detection
// ════════════════════════════════════════════════════════════════════════════════

describe('Drift Guard: Repetition Detection', () => {
  it('detects repeated content', () => {
    const newResponse = 'Bitcoin je digitální měna pro online platby.';
    const recentResponses = [
      'Cena akcie klesla o 5%.',
      'Bitcoin je digitální měna používaná pro online transakce.',
    ];

    const { isRepetition, similarity } = detectRepetition(newResponse, recentResponses);

    assert.ok(isRepetition, 'Should detect repetition');
    assert.ok(similarity >= REPETITION_SIMILARITY_THRESHOLD);
  });

  it('does not flag unique content', () => {
    const newResponse = 'Ethereum je platforma pro smart contracts.';
    const recentResponses = [
      'Bitcoin vznikl v roce 2009.',
      'Akciový trh dnes roste.',
    ];

    const { isRepetition } = detectRepetition(newResponse, recentResponses);

    assert.strictEqual(isRepetition, false);
  });

  it('handles empty recent responses', () => {
    const { isRepetition } = detectRepetition('Test response', []);

    assert.strictEqual(isRepetition, false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Expansion Drift Detection
// ════════════════════════════════════════════════════════════════════════════════

describe('Drift Guard: Expansion Drift', () => {
  it('detects consistent length growth', () => {
    const lengths = [100, 150, 225, 340, 510];
    const { isDrifting, avgGrowthRatio } = detectExpansionDrift(lengths);

    assert.strictEqual(isDrifting, true, 'Should detect expansion drift');
    assert.ok(avgGrowthRatio > 1.4, `Growth ratio ${avgGrowthRatio} should be > 1.4`);
  });

  it('does not flag stable lengths', () => {
    const lengths = [200, 190, 205, 195, 200];
    const { isDrifting } = detectExpansionDrift(lengths);

    assert.strictEqual(isDrifting, false);
  });

  it('does not flag decreasing lengths', () => {
    const lengths = [300, 250, 200, 180, 150];
    const { isDrifting } = detectExpansionDrift(lengths);

    assert.strictEqual(isDrifting, false);
  });

  it('needs at least 3 responses', () => {
    const { isDrifting } = detectExpansionDrift([100, 200]);

    assert.strictEqual(isDrifting, false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Template Start Detection
// ════════════════════════════════════════════════════════════════════════════════

describe('Drift Guard: Template Start Detection', () => {
  it('detects "Ano, zde je"', () => {
    const { hasTemplateStart } = detectTemplateStart('Ano, zde je odpověď na vaši otázku.');
    assert.strictEqual(hasTemplateStart, true);
  });

  it('detects "Samozřejmě"', () => {
    const { hasTemplateStart } = detectTemplateStart('Samozřejmě, rád vám pomohu.');
    assert.strictEqual(hasTemplateStart, true);
  });

  it('detects "Great question"', () => {
    const { hasTemplateStart } = detectTemplateStart('Great question! Here is the answer.');
    assert.strictEqual(hasTemplateStart, true);
  });

  it('detects "Jako AI"', () => {
    const { hasTemplateStart } = detectTemplateStart('Jako AI nemohu...');
    assert.strictEqual(hasTemplateStart, true);
  });

  it('detects "Rád ti pomohu"', () => {
    const { hasTemplateStart } = detectTemplateStart('Rád ti pomohu s tímto problémem.');
    assert.strictEqual(hasTemplateStart, true);
  });

  it('does not flag direct answers', () => {
    const { hasTemplateStart } = detectTemplateStart('Bitcoin aktuálně stojí 45000 USD.');
    assert.strictEqual(hasTemplateStart, false);
  });

  it('does not flag natural sentences', () => {
    const { hasTemplateStart } = detectTemplateStart('Cena bitcoinu je 45000 dolarů.');
    assert.strictEqual(hasTemplateStart, false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: DriftGuard Tracker
// ════════════════════════════════════════════════════════════════════════════════

describe('Drift Guard: Tracker', () => {
  let guard;

  beforeEach(() => {
    guard = new DriftGuard();
  });

  it('tracks turn count', () => {
    guard.recordResponse('Response 1');
    guard.recordResponse('Response 2');
    guard.recordResponse('Response 3');

    assert.strictEqual(guard.turnCount, 3);
  });

  it('tracks response lengths', () => {
    guard.recordResponse('Short');
    guard.recordResponse('Medium length response');
    guard.recordResponse('This is a longer response with more content');

    assert.strictEqual(guard.responseLengths.length, 3);
  });

  it('counts template starts', () => {
    guard.recordResponse('Ano, zde je odpověď.');
    guard.recordResponse('Direct answer here.');
    guard.recordResponse('Samozřejmě, pomohu.');

    assert.strictEqual(guard.templateStartCount, 2);
  });

  it('flags long-form after threshold', () => {
    for (let i = 0; i < DRIFT_GUARD_TURN_THRESHOLD; i++) {
      guard.recordResponse(`Response ${i}`);
    }

    const analysis = guard.recordResponse('Final response');

    assert.strictEqual(analysis.isLongForm, true);
  });

  it('generates warnings in long-form', () => {
    // Simulate 15 turns
    for (let i = 0; i < DRIFT_GUARD_TURN_THRESHOLD; i++) {
      guard.recordResponse(`Response ${i}`);
    }

    // Add template start
    const analysis = guard.recordResponse('Ano, zde je další odpověď.');

    assert.ok(analysis.isLongForm);
    assert.ok(analysis.warnings.includes('TEMPLATE_START'));
  });

  it('reset clears state', () => {
    guard.recordResponse('Test');
    guard.recordResponse('Test');
    guard.reset();

    assert.strictEqual(guard.turnCount, 0);
    assert.strictEqual(guard.templateStartCount, 0);
    assert.strictEqual(guard.recentResponses.length, 0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Validation Function
// ════════════════════════════════════════════════════════════════════════════════

describe('Drift Guard: Validation', () => {
  it('does not enforce before threshold', () => {
    const { valid } = validateAgainstDrift('Ano, zde je odpověď.', { turnCount: 5 });
    assert.strictEqual(valid, true, 'Should not enforce before threshold');
  });

  it('enforces after threshold', () => {
    const { valid, violations } = validateAgainstDrift('Ano, zde je odpověď.', {
      turnCount: 20,
      recentResponses: [],
    });

    assert.strictEqual(valid, false);
    assert.ok(violations.some(v => v.includes('TEMPLATE_START')));
  });

  it('flags repetition after threshold', () => {
    const { valid, violations } = validateAgainstDrift(
      'Bitcoin je digitální měna pro online platby a transakce.',
      {
        turnCount: 20,
        recentResponses: [
          'Cena bitcoinu dnes.',
          'Bitcoin je digitální měna pro online platby a převody.',
        ],
      }
    );

    assert.strictEqual(valid, false);
    assert.ok(violations.some(v => v.includes('REPETITION')));
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Drift Prevention Instructions
// ════════════════════════════════════════════════════════════════════════════════

describe('Drift Guard: Prevention Instructions', () => {
  it('returns empty before threshold', () => {
    const guard = new DriftGuard();
    guard.turnCount = 5;

    const instructions = guard.getDriftPreventionInstructions();

    assert.strictEqual(instructions, '');
  });

  it('returns guidance after threshold', () => {
    const guard = new DriftGuard();
    guard.turnCount = 20;

    const instructions = guard.getDriftPreventionInstructions();

    assert.ok(instructions.includes('DRIFT GUARD'));
    assert.ok(instructions.includes('DLOUHÁ KONVERZACE'));
  });

  it('warns about template overuse', () => {
    const guard = new DriftGuard();
    guard.turnCount = 20;
    guard.templateStartCount = 5;

    const instructions = guard.getDriftPreventionInstructions();

    assert.ok(instructions.includes('šablonový'));
  });

  it('warns about repetition', () => {
    const guard = new DriftGuard();
    guard.turnCount = 20;
    guard.repetitionCount = 3;

    const instructions = guard.getDriftPreventionInstructions();

    assert.ok(instructions.includes('Opakování'));
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Contract Invariants
// ════════════════════════════════════════════════════════════════════════════════

describe('Drift Guard: Contract Invariants', () => {
  it('INVARIANT: Threshold is at least 10', () => {
    assert.ok(DRIFT_GUARD_TURN_THRESHOLD >= 10, 'Threshold should be reasonable');
  });

  it('INVARIANT: Similarity threshold is 0-1', () => {
    assert.ok(REPETITION_SIMILARITY_THRESHOLD >= 0);
    assert.ok(REPETITION_SIMILARITY_THRESHOLD <= 1);
  });

  it('INVARIANT: Expansion ratio threshold > 1', () => {
    assert.ok(EXPANSION_RATIO_THRESHOLD > 1, 'Growth should be above 1x to be drift');
  });

  it('INVARIANT: All template patterns are valid regex', () => {
    for (const pattern of TEMPLATE_START_PATTERNS) {
      assert.ok(pattern instanceof RegExp, `${pattern} should be RegExp`);
      // Should not throw when testing
      pattern.test('test string');
    }
  });

  it('CONTRACT: Validation only active after threshold', () => {
    // Before threshold - always valid
    const before = validateAgainstDrift('Ano, zde je.', { turnCount: 5 });
    assert.strictEqual(before.valid, true);

    // After threshold - may be invalid
    const after = validateAgainstDrift('Ano, zde je.', { turnCount: 20 });
    assert.strictEqual(after.valid, false);
  });
});

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  CRE v45.0 KOLO 5.5 — Long-Form Drift Guard Tests                           ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  CONTRACT (after 15+ turns):                                                 ║
║  - No repetition (> 60% similarity)                                          ║
║  - No expansion drift (> 1.5x growth)                                        ║
║  - No template starts ("Ano, zde je...")                                     ║
║                                                                              ║
║  Anti-regression contract for long conversations.                            ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
