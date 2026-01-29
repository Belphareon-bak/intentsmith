// CRE v45.0 — Invariant Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests for critical invariants that MUST NOT be violated:
//
// 1. expertStrength=0 MUST be identical to default (no expert)
// 2. _maybeAdjustPreferences() MUST change max 1 axis per feedback
// 3. topicHash isolation - feedback per responseType
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

import {
  UserPreferences,
  Verbosity,
  Structure,
  FollowUpStyle,
} from '../src/memory/preferences.js';

// ════════════════════════════════════════════════════════════════════════════════
// INVARIANT 1: expertStrength=0 is identical to default
// ════════════════════════════════════════════════════════════════════════════════

describe('INVARIANT: expertStrength=0 identical to default', () => {
  it('getSynthesisHints returns { active: false } when strength is OFF', () => {
    const expert = new ExpertAgent({
      id: 'test_expert',
      name: 'Test Expert',
      domain: 'general',
      strength: ExpertStrength.OFF,
    });

    const hints = expert.getSynthesisHints();

    assert.deepStrictEqual(hints, { active: false });
    assert.strictEqual(hints.active, false);
    assert.strictEqual(hints.expertId, undefined);
    assert.strictEqual(hints.influence, undefined);
  });

  it('getSynthesisHints with override strength=0 returns { active: false }', () => {
    const expert = new ExpertAgent({
      id: 'test_expert',
      name: 'Test Expert',
      domain: 'general',
      strength: ExpertStrength.STRONG, // Default strong
    });

    // Override to OFF
    const hints = expert.getSynthesisHints(ExpertStrength.OFF);

    assert.deepStrictEqual(hints, { active: false });
  });

  it('setStrength(0) sets strength to OFF', () => {
    const expert = new ExpertAgent({
      id: 'test_expert',
      name: 'Test Expert',
      domain: 'general',
      strength: ExpertStrength.MEDIUM,
    });

    const result = expert.setStrength(0);

    assert.strictEqual(result, ExpertStrength.OFF);
    assert.strictEqual(expert.strength, ExpertStrength.OFF);

    const hints = expert.getSynthesisHints();
    assert.deepStrictEqual(hints, { active: false });
  });

  it('built-in experts with strength=0 return inactive hints', () => {
    // Test with a real built-in expert
    const writer = expertRegistry.get('writer');
    if (writer) {
      writer.setStrength(0);
      const hints = writer.getSynthesisHints();
      assert.deepStrictEqual(hints, { active: false });
      // Reset for other tests
      writer.setStrength(ExpertStrength.MEDIUM);
    }
  });

  it('hints with active=false have no expert-specific fields', () => {
    const expert = new ExpertAgent({
      id: 'test_expert',
      name: 'Test Expert',
      domain: 'software_development',
      strength: ExpertStrength.OFF,
    });

    const hints = expert.getSynthesisHints();

    // MUST NOT have any expert-specific fields
    assert.strictEqual(Object.keys(hints).length, 1, 'Should only have "active" field');
    assert.ok(!('expertId' in hints));
    assert.ok(!('expertName' in hints));
    assert.ok(!('influence' in hints));
    assert.ok(!('style' in hints));
    assert.ok(!('depth' in hints));
    assert.ok(!('vocabulary' in hints));
    assert.ok(!('caution' in hints));
    assert.ok(!('systemAddition' in hints));
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// INVARIANT 2: _maybeAdjustPreferences() max 1 axis per feedback
// ════════════════════════════════════════════════════════════════════════════════

describe('INVARIANT: max 1 axis change per feedback', () => {
  it('changes only verbosity when both verbosity and structure would change', () => {
    const prefs = new UserPreferences({
      verbosity: Verbosity.NORMAL,
      structure: Structure.MIXED,
    });

    // Simulate 3 consistent positive feedbacks with DIFFERENT settings
    const context = {
      responseType: 'SEARCH',
      verbosity: Verbosity.DETAILED,  // Would change verbosity
      structure: Structure.BULLETS,    // Would change structure
    };

    // Add 3 consistent positive feedbacks
    prefs.recordPositiveFeedback(context);
    prefs.recordPositiveFeedback(context);

    // Before 3rd feedback, nothing should change yet
    assert.strictEqual(prefs.verbosity, Verbosity.NORMAL);
    assert.strictEqual(prefs.structure, Structure.MIXED);

    prefs.recordPositiveFeedback(context);

    // After 3rd feedback:
    // - verbosity SHOULD change (higher priority)
    // - structure should NOT change (only 1 axis per feedback)
    assert.strictEqual(prefs.verbosity, Verbosity.DETAILED, 'Verbosity should change (priority 1)');
    assert.strictEqual(prefs.structure, Structure.MIXED, 'Structure should NOT change in same feedback');
  });

  it('does not change anything with mixed signals', () => {
    const prefs = new UserPreferences({
      verbosity: Verbosity.NORMAL,
      structure: Structure.MIXED,
    });

    const context = {
      responseType: 'REPORT',
      verbosity: Verbosity.DETAILED,
      structure: Structure.BULLETS,
    };

    // Mixed signals: positive, negative, positive
    prefs.recordPositiveFeedback(context);
    prefs.recordNegativeFeedback(context);
    prefs.recordPositiveFeedback(context);

    // Nothing should change with mixed signals
    assert.strictEqual(prefs.verbosity, Verbosity.NORMAL);
    assert.strictEqual(prefs.structure, Structure.MIXED);
  });

  it('respects priority order: verbosity > structure > followUpStyle', () => {
    const prefs = new UserPreferences({
      verbosity: Verbosity.NORMAL,
      structure: Structure.MIXED,
      followUpStyle: FollowUpStyle.ADAPTIVE,
    });

    const context = {
      responseType: 'SEARCH',
      verbosity: Verbosity.MINIMAL,
      structure: Structure.PARAGRAPHS,
      followUpStyle: FollowUpStyle.CONCISE,
    };

    // 3 consistent positive feedbacks
    prefs.recordPositiveFeedback(context);
    prefs.recordPositiveFeedback(context);
    prefs.recordPositiveFeedback(context);

    // Only verbosity should change (highest priority)
    assert.strictEqual(prefs.verbosity, Verbosity.MINIMAL, 'Verbosity should change');
    assert.strictEqual(prefs.structure, Structure.MIXED, 'Structure should NOT change');
    assert.strictEqual(prefs.followUpStyle, FollowUpStyle.ADAPTIVE, 'FollowUpStyle should NOT change');
  });

  it('does not change preference if already at target value', () => {
    const prefs = new UserPreferences({
      verbosity: Verbosity.DETAILED,
      structure: Structure.MIXED,
    });

    const context = {
      responseType: 'SEARCH',
      verbosity: Verbosity.DETAILED,  // Already at target
      structure: Structure.BULLETS,
    };

    // 3 consistent positive feedbacks
    prefs.recordPositiveFeedback(context);
    prefs.recordPositiveFeedback(context);
    prefs.recordPositiveFeedback(context);

    // verbosity is already at target, so structure should change instead
    assert.strictEqual(prefs.verbosity, Verbosity.DETAILED, 'Verbosity unchanged (already at target)');
    assert.strictEqual(prefs.structure, Structure.BULLETS, 'Structure should change (next priority)');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// INVARIANT 3: topicHash isolation
// ════════════════════════════════════════════════════════════════════════════════

describe('INVARIANT: topicHash isolation', () => {
  it('generates topicHash from input', () => {
    const prefs = new UserPreferences();

    prefs.recordPositiveFeedback({
      responseType: 'SEARCH',
      input: 'najdi mi informace o bitcoinu',
    });

    const lastFeedback = prefs.feedbackHistory[prefs.feedbackHistory.length - 1];

    assert.ok(lastFeedback.topicHash, 'Should have topicHash');
    assert.ok(lastFeedback.topicHash.includes('bitcoin'), 'topicHash should include key term');
  });

  it('normalizes topicHash (lowercase, sorted)', () => {
    const prefs = new UserPreferences();

    prefs.recordPositiveFeedback({
      responseType: 'SEARCH',
      input: 'Bitcoin ETHEREUM crypto',
    });

    const lastFeedback = prefs.feedbackHistory[prefs.feedbackHistory.length - 1];

    // Should be lowercase and sorted
    assert.ok(lastFeedback.topicHash);
    assert.ok(!lastFeedback.topicHash.includes('B'), 'Should be lowercase');
    assert.ok(!lastFeedback.topicHash.includes('E'), 'Should be lowercase');
    // Sorted alphabetically
    const parts = lastFeedback.topicHash.split('_');
    const sorted = [...parts].sort();
    assert.deepStrictEqual(parts, sorted, 'Should be sorted');
  });

  it('filters out stopwords from topicHash', () => {
    const prefs = new UserPreferences();

    prefs.recordPositiveFeedback({
      responseType: 'SEARCH',
      input: 'dej mi informace o tom co je bitcoin a jak funguje',
    });

    const lastFeedback = prefs.feedbackHistory[prefs.feedbackHistory.length - 1];

    // Stopwords should be filtered
    assert.ok(lastFeedback.topicHash);
    assert.ok(!lastFeedback.topicHash.includes('dej'), 'Should filter stopword "dej"');
    assert.ok(!lastFeedback.topicHash.includes('tom'), 'Should filter stopword "tom"');
    assert.ok(!lastFeedback.topicHash.includes('jak'), 'Should filter stopword "jak"');
    assert.ok(lastFeedback.topicHash.includes('bitcoin'), 'Should keep key term');
  });

  it('limits topicHash to max 5 tokens', () => {
    const prefs = new UserPreferences();

    prefs.recordPositiveFeedback({
      responseType: 'REPORT',
      input: 'analyzuj bitcoin ethereum solana cardano polkadot avalanche cosmos near',
    });

    const lastFeedback = prefs.feedbackHistory[prefs.feedbackHistory.length - 1];

    const parts = lastFeedback.topicHash.split('_');
    assert.ok(parts.length <= 5, `Should have max 5 tokens, got ${parts.length}`);
  });

  it('stores responseType at top level for faster filtering', () => {
    const prefs = new UserPreferences();

    prefs.recordPositiveFeedback({
      responseType: 'SEARCH',
      verbosity: Verbosity.NORMAL,
    });

    const lastFeedback = prefs.feedbackHistory[prefs.feedbackHistory.length - 1];

    // responseType should be at top level
    assert.strictEqual(lastFeedback.responseType, 'SEARCH');
    // Also in context for backward compatibility
    assert.strictEqual(lastFeedback.context.responseType, 'SEARCH');
  });

  it('getOptimizedFor filters by responseType', () => {
    const prefs = new UserPreferences({
      verbosity: Verbosity.NORMAL,
    });

    // Add positive feedback for SEARCH with DETAILED
    for (let i = 0; i < 5; i++) {
      prefs.recordPositiveFeedback({
        responseType: 'SEARCH',
        verbosity: Verbosity.DETAILED,
      });
    }

    // Add positive feedback for REPORT with MINIMAL
    for (let i = 0; i < 5; i++) {
      prefs.recordPositiveFeedback({
        responseType: 'REPORT',
        verbosity: Verbosity.MINIMAL,
      });
    }

    // getOptimizedFor should return different settings per responseType
    const searchOptimized = prefs.getOptimizedFor('SEARCH');
    const reportOptimized = prefs.getOptimizedFor('REPORT');

    assert.strictEqual(searchOptimized.verbosity, Verbosity.DETAILED, 'SEARCH should prefer DETAILED');
    assert.strictEqual(reportOptimized.verbosity, Verbosity.MINIMAL, 'REPORT should prefer MINIMAL');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Banner
// ════════════════════════════════════════════════════════════════════════════════

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  v45.0 Invariant Tests                                                      ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  INVARIANT 1: expertStrength=0 identical to default (no expert)              ║
║  INVARIANT 2: _maybeAdjustPreferences() max 1 axis per feedback              ║
║  INVARIANT 3: topicHash isolation per responseType                           ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
