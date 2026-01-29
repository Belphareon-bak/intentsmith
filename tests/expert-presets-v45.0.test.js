// CRE v45.0 KOLO 4.3 — Expert Presets Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// CONTRACT:
// - Slider (0-100%) maps to preset (light/balanced/deep)
// - Preset defines weight configuration
// - Expert cannot change intent or force tools
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  ExpertAgent,
  ExpertStrength,
  ExpertPreset,
  strengthToPreset,
  getPresetWeights,
  expertRegistry,
} from '../src/experts/expert-layer.js';

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Strength to Preset Mapping
// ════════════════════════════════════════════════════════════════════════════════

describe('Expert Presets: Strength Mapping', () => {
  it('0-30% maps to LIGHT', () => {
    assert.strictEqual(strengthToPreset(0), ExpertPreset.LIGHT);
    assert.strictEqual(strengthToPreset(15), ExpertPreset.LIGHT);
    assert.strictEqual(strengthToPreset(30), ExpertPreset.LIGHT);
  });

  it('31-60% maps to BALANCED', () => {
    assert.strictEqual(strengthToPreset(31), ExpertPreset.BALANCED);
    assert.strictEqual(strengthToPreset(50), ExpertPreset.BALANCED);
    assert.strictEqual(strengthToPreset(60), ExpertPreset.BALANCED);
  });

  it('61-100% maps to DEEP', () => {
    assert.strictEqual(strengthToPreset(61), ExpertPreset.DEEP);
    assert.strictEqual(strengthToPreset(75), ExpertPreset.DEEP);
    assert.strictEqual(strengthToPreset(100), ExpertPreset.DEEP);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Preset Weight Configurations
// ════════════════════════════════════════════════════════════════════════════════

describe('Expert Presets: Weight Configurations', () => {
  it('LIGHT preset has shallow depth', () => {
    const weights = getPresetWeights(ExpertPreset.LIGHT);
    assert.strictEqual(weights.depth, 'shallow');
  });

  it('BALANCED preset uses default depth', () => {
    const weights = getPresetWeights(ExpertPreset.BALANCED, { depth: 'balanced' });
    assert.strictEqual(weights.depth, 'balanced');
  });

  it('DEEP preset forces deep depth', () => {
    const weights = getPresetWeights(ExpertPreset.DEEP);
    assert.strictEqual(weights.depth, 'deep');
  });

  it('DEEP preset overrides base weights depth', () => {
    const weights = getPresetWeights(ExpertPreset.DEEP, { depth: 'shallow' });
    assert.strictEqual(weights.depth, 'deep', 'DEEP preset should override to deep');
  });

  it('preset weights include multipliers', () => {
    const lightWeights = getPresetWeights(ExpertPreset.LIGHT);
    const deepWeights = getPresetWeights(ExpertPreset.DEEP);

    assert.ok(lightWeights._multipliers.styleMultiplier < deepWeights._multipliers.styleMultiplier);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Expert Synthesis Hints with Presets
// ════════════════════════════════════════════════════════════════════════════════

describe('Expert Presets: Synthesis Hints', () => {
  let writer;
  let analyst;

  beforeEach(() => {
    writer = expertRegistry.get('writer');
    analyst = expertRegistry.get('analyst');
  });

  it('LIGHT strength (25%) produces LIGHT preset hints', () => {
    writer.setStrength(ExpertStrength.LIGHT);
    const hints = writer.getSynthesisHints();

    assert.strictEqual(hints.preset, ExpertPreset.LIGHT);
    // LIGHT should have shallow depth
    assert.ok(
      hints.depth === 'shallow' || hints._presetWeights.depthOverride === 'shallow',
      'LIGHT preset should have shallow depth'
    );
  });

  it('MEDIUM strength (50%) produces BALANCED preset hints', () => {
    analyst.setStrength(ExpertStrength.MEDIUM);
    const hints = analyst.getSynthesisHints();

    assert.strictEqual(hints.preset, ExpertPreset.BALANCED);
  });

  it('STRONG strength (75%) produces DEEP preset hints', () => {
    writer.setStrength(ExpertStrength.STRONG);
    const hints = writer.getSynthesisHints();

    assert.strictEqual(hints.preset, ExpertPreset.DEEP);
    assert.strictEqual(hints.depth, 'deep', 'DEEP preset should have deep depth');
  });

  it('FULL strength (100%) produces DEEP preset hints', () => {
    analyst.setStrength(ExpertStrength.FULL);
    const hints = analyst.getSynthesisHints();

    assert.strictEqual(hints.preset, ExpertPreset.DEEP);
    assert.strictEqual(hints.depth, 'deep');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Scenario G - Expert Preset Drift
// ════════════════════════════════════════════════════════════════════════════════

describe('Expert Presets: Scenario G - Preset Drift', () => {
  it('Expert: Lékař (deep) → dlouhá strukturovaná odpověď hints', () => {
    // Assuming there's a doctor/medical expert, or we use analyst as proxy
    const analyst = expertRegistry.get('analyst');
    analyst.setStrength(ExpertStrength.STRONG); // Maps to DEEP

    const hints = analyst.getSynthesisHints();

    assert.strictEqual(hints.preset, ExpertPreset.DEEP);
    assert.strictEqual(hints.depth, 'deep');
    assert.ok(hints.active, 'Expert should be active');
  });

  it('Switch preset: light → stručnější hints', () => {
    const analyst = expertRegistry.get('analyst');
    analyst.setStrength(ExpertStrength.LIGHT); // Maps to LIGHT

    const hints = analyst.getSynthesisHints();

    assert.strictEqual(hints.preset, ExpertPreset.LIGHT);
    // LIGHT should produce shallow depth or different system addition
    assert.ok(
      hints.depth === 'shallow' ||
      (hints._presetWeights && hints._presetWeights.depthOverride === 'shallow'),
      'LIGHT preset should indicate shallow depth'
    );
  });

  it('Same expert, different presets produce different hints', () => {
    const writer = expertRegistry.get('writer');

    writer.setStrength(ExpertStrength.LIGHT);
    const lightHints = writer.getSynthesisHints();

    writer.setStrength(ExpertStrength.STRONG);
    const deepHints = writer.getSynthesisHints();

    assert.notStrictEqual(lightHints.preset, deepHints.preset);
    assert.notStrictEqual(lightHints.depth, deepHints.depth);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Contract Invariants
// ════════════════════════════════════════════════════════════════════════════════

describe('Expert Presets: Contract Invariants', () => {
  it('INVARIANT: Expert cannot change intent', () => {
    // This is tested in decision engine, but we verify hints don't include intent override
    const writer = expertRegistry.get('writer');
    writer.setStrength(ExpertStrength.FULL);
    const hints = writer.getSynthesisHints();

    assert.ok(!('intent' in hints), 'Expert hints should not include intent');
    assert.ok(!('overrideIntent' in hints), 'Expert hints should not override intent');
  });

  it('INVARIANT: Expert cannot force tools', () => {
    const analyst = expertRegistry.get('analyst');
    analyst.setStrength(ExpertStrength.FULL);
    const hints = analyst.getSynthesisHints();

    assert.ok(!('tools' in hints), 'Expert hints should not include tools');
    assert.ok(!('forceTools' in hints), 'Expert hints should not force tools');
  });

  it('INVARIANT: Preset includes weight multipliers', () => {
    const preset = getPresetWeights(ExpertPreset.BALANCED);
    assert.ok('_multipliers' in preset);
    assert.ok('styleMultiplier' in preset._multipliers);
  });

  it('INVARIANT: DEEP preset never produces shallow', () => {
    const weights = getPresetWeights(ExpertPreset.DEEP, { depth: 'shallow' });
    assert.notStrictEqual(weights.depth, 'shallow', 'DEEP should override to deep');
  });
});

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  CRE v45.0 KOLO 4.3 — Expert Presets Tests                                  ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  CONTRACT:                                                                   ║
║  - 0-30% → LIGHT preset (shallow depth, minimal style)                       ║
║  - 31-60% → BALANCED preset (default depth)                                  ║
║  - 61-100% → DEEP preset (deep depth, full style)                            ║
║                                                                              ║
║  SCENARIO G: Expert preset drift                                             ║
║  - Same expert with different presets → different output                     ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
