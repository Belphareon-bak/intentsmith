// CRE v45.0 — Expert Intensity Tests (Phase 3)
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests for Phase 3 architectural changes:
// 1. ExpertStrength quantized slider (0/25/50/75/100)
// 2. Expert weight overrides (style, depth, vocabulary, caution)
// 3. LLM Confidence Gate (anti-fluff detection)
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  ExpertStrength,
  ExpertWeights,
  ExpertAgent,
  expertRegistry,
  PLANNING_DEPTH,
  REVIEW_POLICY,
  DATA_USAGE,
  OUTPUT_BIAS,
} from '../src/experts/expert-layer.js';

// ════════════════════════════════════════════════════════════════════════════════
// TEST 1: ExpertStrength Quantized Values
// ════════════════════════════════════════════════════════════════════════════════

describe('v45.0 FIX 3.1: ExpertStrength Quantized Values', () => {
  it('ExpertStrength has correct quantized values', () => {
    assert.strictEqual(ExpertStrength.OFF, 0);
    assert.strictEqual(ExpertStrength.LIGHT, 25);
    assert.strictEqual(ExpertStrength.MEDIUM, 50);
    assert.strictEqual(ExpertStrength.STRONG, 75);
    assert.strictEqual(ExpertStrength.FULL, 100);
  });

  it('ExpertAgent defaults to MEDIUM strength', () => {
    const expert = new ExpertAgent({
      id: 'test',
      name: 'Test Expert',
      domain: 'test',
    });

    assert.strictEqual(expert.strength, ExpertStrength.MEDIUM);
  });

  it('ExpertAgent.setStrength quantizes to nearest level', () => {
    const expert = new ExpertAgent({
      id: 'test',
      name: 'Test Expert',
      domain: 'test',
    });

    // Test quantization to nearest level
    assert.strictEqual(expert.setStrength(10), 0);   // Closer to 0
    assert.strictEqual(expert.setStrength(15), 25);  // Closer to 25
    assert.strictEqual(expert.setStrength(40), 50);  // Closer to 50
    assert.strictEqual(expert.setStrength(63), 75);  // Closer to 75
    assert.strictEqual(expert.setStrength(90), 100); // Closer to 100
  });

  it('Built-in experts have default MEDIUM strength', () => {
    const writer = expertRegistry.get('writer');
    const analyst = expertRegistry.get('analyst');
    const lawyer = expertRegistry.get('lawyer');

    assert.strictEqual(writer.strength, ExpertStrength.MEDIUM);
    assert.strictEqual(analyst.strength, ExpertStrength.MEDIUM);
    assert.strictEqual(lawyer.strength, ExpertStrength.MEDIUM);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST 2: ExpertWeights System
// ════════════════════════════════════════════════════════════════════════════════

describe('v45.0 FIX 3.2: ExpertWeights System', () => {
  it('ExpertWeights has all dimensions', () => {
    // Style
    assert.ok(ExpertWeights.STYLE_FORMAL);
    assert.ok(ExpertWeights.STYLE_CASUAL);
    assert.ok(ExpertWeights.STYLE_CREATIVE);
    assert.ok(ExpertWeights.STYLE_TECHNICAL);

    // Depth
    assert.ok(ExpertWeights.DEPTH_SHALLOW);
    assert.ok(ExpertWeights.DEPTH_BALANCED);
    assert.ok(ExpertWeights.DEPTH_DEEP);

    // Vocabulary
    assert.ok(ExpertWeights.VOCAB_SIMPLE);
    assert.ok(ExpertWeights.VOCAB_TECHNICAL);
    assert.ok(ExpertWeights.VOCAB_DOMAIN);

    // Caution
    assert.ok(ExpertWeights.CAUTION_LOW);
    assert.ok(ExpertWeights.CAUTION_MEDIUM);
    assert.ok(ExpertWeights.CAUTION_HIGH);
  });

  it('ExpertAgent derives default weights from outputBias', () => {
    // Creative expert
    const writer = new ExpertAgent({
      id: 'test_writer',
      name: 'Test Writer',
      domain: 'creative_writing',
      outputBias: OUTPUT_BIAS.CREATIVE,
    });

    assert.strictEqual(writer.weights.style, ExpertWeights.STYLE_CREATIVE);
    assert.strictEqual(writer.weights.depth, ExpertWeights.DEPTH_DEEP);

    // Analytical expert
    const analyst = new ExpertAgent({
      id: 'test_analyst',
      name: 'Test Analyst',
      domain: 'analysis',
      outputBias: OUTPUT_BIAS.ANALYTICAL,
    });

    assert.strictEqual(analyst.weights.style, ExpertWeights.STYLE_TECHNICAL);
    assert.strictEqual(analyst.weights.vocabulary, ExpertWeights.VOCAB_TECHNICAL);

    // Conservative expert
    const lawyer = new ExpertAgent({
      id: 'test_lawyer',
      name: 'Test Lawyer',
      domain: 'legal',
      outputBias: OUTPUT_BIAS.CONSERVATIVE,
    });

    assert.strictEqual(lawyer.weights.caution, ExpertWeights.CAUTION_HIGH);
  });

  it('ExpertAgent derives weights from domain', () => {
    // Legal domain → high caution
    const lawyer = new ExpertAgent({
      id: 'test',
      name: 'Test',
      domain: 'legal',
    });
    assert.strictEqual(lawyer.weights.caution, ExpertWeights.CAUTION_HIGH);

    // Software domain → technical vocab
    const dev = new ExpertAgent({
      id: 'test',
      name: 'Test',
      domain: 'software_development',
    });
    assert.strictEqual(dev.weights.vocabulary, ExpertWeights.VOCAB_TECHNICAL);
  });

  it('ExpertAgent preserves custom weights', () => {
    const expert = new ExpertAgent({
      id: 'custom',
      name: 'Custom',
      domain: 'test',
      weights: {
        style: ExpertWeights.STYLE_CASUAL,
        depth: ExpertWeights.DEPTH_SHALLOW,
        vocabulary: ExpertWeights.VOCAB_SIMPLE,
        caution: ExpertWeights.CAUTION_LOW,
      },
    });

    assert.strictEqual(expert.weights.style, ExpertWeights.STYLE_CASUAL);
    assert.strictEqual(expert.weights.depth, ExpertWeights.DEPTH_SHALLOW);
    assert.strictEqual(expert.weights.vocabulary, ExpertWeights.VOCAB_SIMPLE);
    assert.strictEqual(expert.weights.caution, ExpertWeights.CAUTION_LOW);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST 3: Synthesis Hints
// ════════════════════════════════════════════════════════════════════════════════

describe('v45.0 FIX 3.2: Synthesis Hints', () => {
  it('getSynthesisHints returns inactive when strength is OFF', () => {
    const expert = new ExpertAgent({
      id: 'test',
      name: 'Test',
      domain: 'test',
      strength: ExpertStrength.OFF,
    });

    const hints = expert.getSynthesisHints();
    assert.strictEqual(hints.active, false);
  });

  it('getSynthesisHints returns active hints with correct fields', () => {
    const expert = new ExpertAgent({
      id: 'writer',
      name: 'Writer',
      domain: 'creative_writing',
      strength: ExpertStrength.STRONG,
      outputBias: OUTPUT_BIAS.CREATIVE,
    });

    const hints = expert.getSynthesisHints();

    assert.strictEqual(hints.active, true);
    assert.strictEqual(hints.expertId, 'writer');
    assert.strictEqual(hints.expertName, 'Writer');
    assert.strictEqual(hints.influence, 0.75); // 75%
    assert.ok(hints.style);
    assert.ok(hints.depth);
    assert.ok(hints.vocabulary);
    assert.ok(hints.caution);
  });

  it('getSynthesisHints accepts strength override', () => {
    const expert = new ExpertAgent({
      id: 'test',
      name: 'Test',
      domain: 'test',
      strength: ExpertStrength.MEDIUM,
    });

    // Override with FULL strength
    const hints = expert.getSynthesisHints(ExpertStrength.FULL);
    assert.strictEqual(hints.influence, 1.0);

    // Override with OFF
    const hintsOff = expert.getSynthesisHints(ExpertStrength.OFF);
    assert.strictEqual(hintsOff.active, false);
  });

  it('getSynthesisHints includes systemAddition at high influence', () => {
    const expert = new ExpertAgent({
      id: 'test',
      name: 'Test',
      domain: 'creative_writing',
      outputBias: OUTPUT_BIAS.CREATIVE,
      strength: ExpertStrength.STRONG, // 75%
    });

    const hints = expert.getSynthesisHints();

    // At 75% influence, systemAddition should be included
    assert.ok(hints.systemAddition);
  });

  it('getSynthesisHints excludes systemAddition at low influence', () => {
    const expert = new ExpertAgent({
      id: 'test',
      name: 'Test',
      domain: 'test',
      strength: ExpertStrength.LIGHT, // 25%
    });

    const hints = expert.getSynthesisHints();

    // At 25% influence, systemAddition should be null
    assert.strictEqual(hints.systemAddition, null);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST 4: Expert toJSON includes new fields
// ════════════════════════════════════════════════════════════════════════════════

describe('v45.0: ExpertAgent Serialization', () => {
  it('toJSON includes strength and weights', () => {
    const expert = new ExpertAgent({
      id: 'test',
      name: 'Test',
      domain: 'test',
      strength: ExpertStrength.STRONG,
      weights: {
        style: ExpertWeights.STYLE_CREATIVE,
        depth: ExpertWeights.DEPTH_DEEP,
        vocabulary: ExpertWeights.VOCAB_DOMAIN,
        caution: ExpertWeights.CAUTION_LOW,
      },
    });

    const json = expert.toJSON();

    assert.strictEqual(json.strength, ExpertStrength.STRONG);
    assert.deepStrictEqual(json.weights, {
      style: ExpertWeights.STYLE_CREATIVE,
      depth: ExpertWeights.DEPTH_DEEP,
      vocabulary: ExpertWeights.VOCAB_DOMAIN,
      caution: ExpertWeights.CAUTION_LOW,
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST 5: Expert CANNOT override decisions (invariant)
// ════════════════════════════════════════════════════════════════════════════════

describe('v45.0 INVARIANT: Expert Cannot Override Decisions', () => {
  it('Expert has no method to change intent', () => {
    const expert = expertRegistry.get('writer');

    // Expert should NOT have methods that can override CRE decisions
    assert.strictEqual(typeof expert.changeIntent, 'undefined');
    assert.strictEqual(typeof expert.forceTools, 'undefined');
    assert.strictEqual(typeof expert.suppressDecision, 'undefined');
  });

  it('getSynthesisHints only provides style hints', () => {
    const expert = expertRegistry.get('analyst');
    const hints = expert.getSynthesisHints();

    // Hints should only contain style-related fields
    assert.ok(hints.style);
    assert.ok(hints.depth);
    assert.ok(hints.vocabulary);
    assert.ok(hints.caution);

    // Should NOT contain decision-override fields
    assert.strictEqual(hints.overrideIntent, undefined);
    assert.strictEqual(hints.forceTools, undefined);
    assert.strictEqual(hints.suppressLocal, undefined);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Banner
// ════════════════════════════════════════════════════════════════════════════════

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  Expert Intensity Tests v45.0                                               ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  Phase 3: Expert Intensity & LLM Confidence Gate                             ║
║                                                                              ║
║  FIX 3.1: ExpertStrength quantized (0/25/50/75/100)                          ║
║  FIX 3.2: Expert weights (style, depth, vocabulary, caution)                 ║
║  FIX 3.3: Synthesis hints for synthesizeWithLLM()                            ║
║  INVARIANT: Expert cannot override intent/tools/decisions                    ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
