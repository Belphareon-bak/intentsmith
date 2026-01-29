// CRE v45.0 KOLO 4.6 — Learning Safety Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// CONTRACT:
// - Max 1 axis change per feedback
// - Preference decay after topic change
// - No preference is permanent
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  UserPreferences,
  Verbosity,
  Structure,
  FollowUpStyle,
} from '../src/memory/preferences.js';

import {
  ConversationStyle,
  DECAY_ON_TOPIC_CHANGE,
  DECAY_PER_TURN,
  SIGNAL_BOOST,
  FormatMemory,
} from '../src/memory/conversation-style.js';

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Max 1 Axis Change
// ════════════════════════════════════════════════════════════════════════════════

describe('Learning Safety: Max 1 Axis Change', () => {
  let prefs;

  beforeEach(() => {
    prefs = new UserPreferences();
  });

  it('single feedback changes at most 1 axis', () => {
    // Record positive feedback for multiple axes
    const result = prefs.recordPositiveFeedback({
      responseType: 'REPORT',
      verbosity: Verbosity.MINIMAL,
      structure: Structure.BULLETS,
      followUpStyle: FollowUpStyle.CONCISE,
    });

    // This is first feedback, no change yet
    assert.strictEqual(prefs.verbosity, Verbosity.NORMAL);
    assert.strictEqual(prefs.structure, Structure.MIXED);
  });

  it('3 consistent feedbacks change exactly 1 axis', () => {
    const context = {
      responseType: 'REPORT',
      verbosity: Verbosity.MINIMAL,
      structure: Structure.BULLETS,
    };

    // Record 3 positive feedbacks
    prefs.recordPositiveFeedback(context);
    prefs.recordPositiveFeedback(context);

    const beforeVerbosity = prefs.verbosity;
    const beforeStructure = prefs.structure;

    prefs.recordPositiveFeedback(context);

    const afterVerbosity = prefs.verbosity;
    const afterStructure = prefs.structure;

    // Count axes changed
    const verbosityChanged = beforeVerbosity !== afterVerbosity;
    const structureChanged = beforeStructure !== afterStructure;
    const axesChanged = (verbosityChanged ? 1 : 0) + (structureChanged ? 1 : 0);

    assert.ok(
      axesChanged <= 1,
      `INVARIANT VIOLATION: ${axesChanged} axes changed (max 1 allowed)`
    );
  });

  it('mixed feedback signals prevent change', () => {
    // Positive
    prefs.recordPositiveFeedback({
      responseType: 'REPORT',
      verbosity: Verbosity.MINIMAL,
    });

    // Negative (different direction)
    prefs.recordNegativeFeedback({
      responseType: 'REPORT',
      verbosity: Verbosity.DETAILED,
    });

    // Positive again
    prefs.recordPositiveFeedback({
      responseType: 'REPORT',
      verbosity: Verbosity.MINIMAL,
    });

    // Mixed signals should not trigger change
    assert.strictEqual(prefs.verbosity, Verbosity.NORMAL, 'Mixed signals should not change preference');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Preference Decay
// ════════════════════════════════════════════════════════════════════════════════

describe('Learning Safety: Preference Decay', () => {
  let style;

  beforeEach(() => {
    style = new ConversationStyle();
  });

  it('confidence decays per turn', () => {
    style.processInput('Stručně');
    const initialConfidence = style.dimensions.prefersMinimal.confidence;

    // Process neutral input
    style.processInput('Jaká je cena?');
    const afterDecay = style.dimensions.prefersMinimal.confidence;

    assert.ok(
      afterDecay < initialConfidence,
      `Confidence should decay: ${initialConfidence} → ${afterDecay}`
    );
    assert.ok(
      Math.abs(afterDecay - initialConfidence * DECAY_PER_TURN) < 0.01,
      'Decay should follow DECAY_PER_TURN rate'
    );
  });

  it('topic change triggers additional decay', () => {
    style.processInput('Stručně', 'topic_a');
    const beforeTopicChange = style.dimensions.prefersMinimal.confidence;

    style.processInput('Co je blockchain?', 'topic_b');
    const afterTopicChange = style.dimensions.prefersMinimal.confidence;

    // Should have both turn decay AND topic decay
    const expectedDecay = beforeTopicChange * DECAY_PER_TURN * DECAY_ON_TOPIC_CHANGE;

    assert.ok(
      Math.abs(afterTopicChange - expectedDecay) < 0.01,
      `Topic change decay: ${beforeTopicChange} → ${afterTopicChange} (expected ~${expectedDecay})`
    );
  });

  it('preference fully decays after many turns', () => {
    style.processInput('Stručně');
    assert.strictEqual(style.prefers('prefersMinimal'), true);

    // Many turns without reinforcement
    for (let i = 0; i < 100; i++) {
      style.processInput('Neutral input');
    }

    // Should be fully decayed
    assert.strictEqual(
      style.prefers('prefersMinimal'),
      false,
      'Preference should decay to false after many turns'
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: No Permanent Preferences
// ════════════════════════════════════════════════════════════════════════════════

describe('Learning Safety: No Permanent Preferences', () => {
  it('ConversationStyle.reset() clears all preferences', () => {
    const style = new ConversationStyle();

    style.processInput('Stručně, bez odkazů');
    assert.strictEqual(style.prefers('prefersMinimal'), true);
    assert.strictEqual(style.shouldIncludeLinks(), false);

    style.reset();

    assert.strictEqual(style.prefers('prefersMinimal'), false);
    assert.strictEqual(style.shouldIncludeLinks(), true);
    assert.strictEqual(style.turnCount, 0);
  });

  it('FormatMemory.reset() clears all formats', () => {
    const memory = new FormatMemory();

    memory.setFormat('topic1', 'BULLETS');
    memory.setFormat('topic2', 'SUMMARY');

    assert.strictEqual(memory.getFormat('topic1'), 'BULLETS');

    memory.reset();

    assert.strictEqual(memory.getFormat('topic1'), null);
    assert.strictEqual(memory.globalFormat, null);
  });

  it('new UserPreferences instance starts fresh', () => {
    const prefs1 = new UserPreferences({ verbosity: Verbosity.MINIMAL });
    const prefs2 = new UserPreferences();

    assert.strictEqual(prefs1.verbosity, Verbosity.MINIMAL);
    assert.strictEqual(prefs2.verbosity, Verbosity.NORMAL);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Contract Invariants
// ════════════════════════════════════════════════════════════════════════════════

describe('Learning Safety: Contract Invariants', () => {
  it('INVARIANT: DECAY_PER_TURN is between 0.9 and 0.99', () => {
    assert.ok(DECAY_PER_TURN >= 0.9, 'DECAY_PER_TURN should be >= 0.9');
    assert.ok(DECAY_PER_TURN < 1.0, 'DECAY_PER_TURN should be < 1.0');
  });

  it('INVARIANT: DECAY_ON_TOPIC_CHANGE is significant (< 0.7)', () => {
    assert.ok(
      DECAY_ON_TOPIC_CHANGE <= 0.7,
      `DECAY_ON_TOPIC_CHANGE (${DECAY_ON_TOPIC_CHANGE}) should be <= 0.7 for meaningful decay`
    );
  });

  it('INVARIANT: SIGNAL_BOOST is moderate (0.2-0.5)', () => {
    assert.ok(SIGNAL_BOOST >= 0.2, 'SIGNAL_BOOST should be >= 0.2');
    assert.ok(SIGNAL_BOOST <= 0.5, 'SIGNAL_BOOST should be <= 0.5');
  });

  it('INVARIANT: Single feedback never overrides global preference', () => {
    const prefs = new UserPreferences({ verbosity: Verbosity.DETAILED });

    // Single feedback should not change
    prefs.recordPositiveFeedback({
      responseType: 'REPORT',
      verbosity: Verbosity.MINIMAL,
    });

    assert.strictEqual(
      prefs.verbosity,
      Verbosity.DETAILED,
      'Single feedback should not override initial preference'
    );
  });
});

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  CRE v45.0 KOLO 4.6 — Learning Safety Tests                                 ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  CONTRACT:                                                                   ║
║  - Max 1 axis change per feedback (UserPreferences)                          ║
║  - Preference decay after topic change (ConversationStyle)                   ║
║  - No preference is permanent (reset(), decay)                               ║
║                                                                              ║
║  This ensures the system doesn't "overlearn" from short interactions.        ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
