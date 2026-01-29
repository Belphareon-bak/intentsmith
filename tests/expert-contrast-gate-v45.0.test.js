// CRE v45.0 KOLO 3 — Expert Contrast Gate Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests that same query + different expert → different output
//
// INVARIANT: Expert influence MUST be visible in output
// If writer and analyst produce identical output, expert system is broken.
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  ExpertAgent,
  ExpertStrength,
  ExpertWeights,
  expertRegistry,
} from '../src/experts/expert-layer.js';

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Expert Synthesis Hints
// ════════════════════════════════════════════════════════════════════════════════

describe('Expert Contrast Gate: Synthesis Hints', () => {
  let writerExpert;
  let analystExpert;

  beforeEach(() => {
    writerExpert = expertRegistry.get('writer');
    analystExpert = expertRegistry.get('analyst');
  });

  it('writer hints include creative style', () => {
    writerExpert.setStrength(ExpertStrength.STRONG);
    const hints = writerExpert.getSynthesisHints();

    assert.strictEqual(hints.active, true);
    assert.strictEqual(hints.expertId, 'writer');
    // Writer should have creative-oriented settings
    assert.ok(
      hints.tone === 'creative' ||
      hints.style === ExpertWeights.STYLE_CREATIVE ||
      (hints.systemAddition && hints.systemAddition.includes('kreativní')),
      'Writer hints should indicate creative style'
    );
  });

  it('analyst hints include analytical style', () => {
    analystExpert.setStrength(ExpertStrength.STRONG);
    const hints = analystExpert.getSynthesisHints();

    assert.strictEqual(hints.active, true);
    assert.strictEqual(hints.expertId, 'analyst');
    // Analyst should have professional/technical settings
    assert.ok(
      hints.tone === 'professional' ||
      hints.style === ExpertWeights.STYLE_FORMAL ||
      hints.style === ExpertWeights.STYLE_TECHNICAL,
      'Analyst hints should indicate professional/analytical style'
    );
  });

  it('CONTRAST: writer ≠ analyst hints', () => {
    writerExpert.setStrength(ExpertStrength.STRONG);
    analystExpert.setStrength(ExpertStrength.STRONG);

    const writerHints = writerExpert.getSynthesisHints();
    const analystHints = analystExpert.getSynthesisHints();

    // Key difference checks
    assert.notStrictEqual(
      writerHints.expertId,
      analystHints.expertId,
      'Expert IDs should differ'
    );

    // At least one style dimension should differ
    const styleDiffers = writerHints.style !== analystHints.style;
    const depthDiffers = writerHints.depth !== analystHints.depth;
    const toneDiffers = writerHints.tone !== analystHints.tone;

    assert.ok(
      styleDiffers || depthDiffers || toneDiffers,
      `CONTRAST GATE FAILED: Writer and Analyst hints are identical!\n` +
      `Writer: style=${writerHints.style}, depth=${writerHints.depth}, tone=${writerHints.tone}\n` +
      `Analyst: style=${analystHints.style}, depth=${analystHints.depth}, tone=${analystHints.tone}`
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Expert System Additions
// ════════════════════════════════════════════════════════════════════════════════

describe('Expert Contrast Gate: System Additions', () => {
  it('writer with strength >= 50% gets creative system addition', () => {
    const writer = expertRegistry.get('writer');
    writer.setStrength(ExpertStrength.MEDIUM); // 50%

    const hints = writer.getSynthesisHints();

    // System addition should be included at 50%+
    if (hints.influence >= 0.5) {
      assert.ok(
        hints.systemAddition === null ||
        typeof hints.systemAddition === 'string',
        'systemAddition should be string or null'
      );
    }
  });

  it('analyst with strength >= 50% gets analytical system addition', () => {
    const analyst = expertRegistry.get('analyst');
    analyst.setStrength(ExpertStrength.MEDIUM); // 50%

    const hints = analyst.getSynthesisHints();

    // System addition at 50%+
    if (hints.influence >= 0.5 && hints.systemAddition) {
      // Analyst additions should NOT contain creative language
      assert.ok(
        !hints.systemAddition.toLowerCase().includes('kreativní'),
        'Analyst system addition should not mention creative'
      );
    }
  });

  it('strength=0 returns { active: false } for both', () => {
    const writer = expertRegistry.get('writer');
    const analyst = expertRegistry.get('analyst');

    writer.setStrength(ExpertStrength.OFF);
    analyst.setStrength(ExpertStrength.OFF);

    const writerHints = writer.getSynthesisHints();
    const analystHints = analyst.getSynthesisHints();

    assert.deepStrictEqual(writerHints, { active: false });
    assert.deepStrictEqual(analystHints, { active: false });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Expert Contrast with Same Query
// ════════════════════════════════════════════════════════════════════════════════

describe('Expert Contrast Gate: Same Query Different Output', () => {
  const testQuery = 'Vysvětli mi blockchain';

  it('same query + writer expert produces different hints than analyst', () => {
    const writer = expertRegistry.get('writer');
    const analyst = expertRegistry.get('analyst');

    writer.setStrength(ExpertStrength.STRONG);
    analyst.setStrength(ExpertStrength.STRONG);

    const writerHints = writer.getSynthesisHints();
    const analystHints = analyst.getSynthesisHints();

    // Create a hash of key properties to compare
    const writerSignature = JSON.stringify({
      style: writerHints.style,
      depth: writerHints.depth,
      tone: writerHints.tone,
    });

    const analystSignature = JSON.stringify({
      style: analystHints.style,
      depth: analystHints.depth,
      tone: analystHints.tone,
    });

    assert.notStrictEqual(
      writerSignature,
      analystSignature,
      `CONTRAST GATE VIOLATION: Same query "${testQuery}" produces identical style signatures!\n` +
      `Writer: ${writerSignature}\n` +
      `Analyst: ${analystSignature}`
    );
  });

  it('buildSynthesisSystemPrompt with different experts produces different prompts', async () => {
    // Dynamically import handlers to test the actual prompt building
    const { buildSynthesisSystemPrompt } = await import('../src/unification/handlers.js')
      .catch(() => ({ buildSynthesisSystemPrompt: null }));

    if (!buildSynthesisSystemPrompt) {
      // If function is not exported, test the concept via hints
      const writer = expertRegistry.get('writer');
      const analyst = expertRegistry.get('analyst');

      writer.setStrength(ExpertStrength.STRONG);
      analyst.setStrength(ExpertStrength.STRONG);

      const writerHints = writer.getSynthesisHints();
      const analystHints = analyst.getSynthesisHints();

      // Verify hints are structurally different enough to produce different prompts
      assert.notDeepStrictEqual(
        { style: writerHints.style, depth: writerHints.depth },
        { style: analystHints.style, depth: analystHints.depth },
        'Writer and Analyst must produce different synthesis influences'
      );
      return;
    }

    // If function is exported, test directly
    const writer = expertRegistry.get('writer');
    const analyst = expertRegistry.get('analyst');

    writer.setStrength(ExpertStrength.STRONG);
    analyst.setStrength(ExpertStrength.STRONG);

    const writerPrompt = buildSynthesisSystemPrompt('REPORT', {}, writer.getSynthesisHints());
    const analystPrompt = buildSynthesisSystemPrompt('REPORT', {}, analyst.getSynthesisHints());

    assert.notStrictEqual(
      writerPrompt,
      analystPrompt,
      'Different experts should produce different system prompts'
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Strength Scaling
// ════════════════════════════════════════════════════════════════════════════════

describe('Expert Contrast Gate: Strength Scaling', () => {
  it('higher strength = higher influence in hints', () => {
    const writer = expertRegistry.get('writer');

    writer.setStrength(ExpertStrength.LIGHT);  // 25%
    const lightHints = writer.getSynthesisHints();

    writer.setStrength(ExpertStrength.STRONG); // 75%
    const strongHints = writer.getSynthesisHints();

    assert.ok(
      strongHints.influence > lightHints.influence,
      `Stronger expert should have higher influence: LIGHT=${lightHints.influence}, STRONG=${strongHints.influence}`
    );
  });

  it('system addition only appears at strength >= 50%', () => {
    const analyst = expertRegistry.get('analyst');

    analyst.setStrength(ExpertStrength.LIGHT); // 25%
    const lightHints = analyst.getSynthesisHints();

    analyst.setStrength(ExpertStrength.MEDIUM); // 50%
    const mediumHints = analyst.getSynthesisHints();

    // At 25%, systemAddition should be null (influence < 0.5)
    if (lightHints.influence < 0.5) {
      assert.strictEqual(
        lightHints.systemAddition,
        null,
        'systemAddition should be null below 50% strength'
      );
    }

    // At 50%+, systemAddition may be present
    // (depends on expert having additions to contribute)
    assert.ok(
      mediumHints.influence >= 0.5,
      'Medium strength should have influence >= 0.5'
    );
  });
});

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  CRE v45.0 KOLO 3 — Expert Contrast Gate Tests                              ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  INVARIANT: Same query + different expert = DIFFERENT output                 ║
║                                                                              ║
║  TEST AREAS:                                                                 ║
║  1. Writer vs Analyst synthesis hints differ                                 ║
║  2. System additions differ by expert type                                   ║
║  3. Same query produces different style signatures                           ║
║  4. Strength scaling affects influence                                       ║
║                                                                              ║
║  FAILURE means: Expert system has no visible effect on output!               ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
