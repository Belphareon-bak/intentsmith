// CRE v45.0 — Preference Learning Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests for Phase 2 architectural changes:
// 1. UserPreference model (structure, followUpStyle)
// 2. Feedback learning (positive/negative signals)
// 3. Preference optimization based on feedback history
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  UserPreferences,
  PreferenceEngine,
  PreferenceAxis,
  Verbosity,
  Structure,
  FollowUpStyle,
  RiskTolerance,
  TechnicalDepth,
} from '../src/memory/preferences.js';

// ════════════════════════════════════════════════════════════════════════════════
// TEST 1: v45.0 New Preference Axes
// ════════════════════════════════════════════════════════════════════════════════

describe('v45.0 FIX 2.1: New Preference Axes', () => {
  it('Structure enum has correct values', () => {
    assert.strictEqual(Structure.BULLETS, 'bullets');
    assert.strictEqual(Structure.PARAGRAPHS, 'paragraphs');
    assert.strictEqual(Structure.MIXED, 'mixed');
  });

  it('FollowUpStyle enum has correct values', () => {
    assert.strictEqual(FollowUpStyle.CONCISE, 'concise');
    assert.strictEqual(FollowUpStyle.COMPREHENSIVE, 'comprehensive');
    assert.strictEqual(FollowUpStyle.ADAPTIVE, 'adaptive');
  });

  it('PreferenceAxis includes new v45.0 axes', () => {
    assert.strictEqual(PreferenceAxis.STRUCTURE, 'structure');
    assert.strictEqual(PreferenceAxis.FOLLOW_UP_STYLE, 'followUpStyle');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST 2: UserPreferences model
// ════════════════════════════════════════════════════════════════════════════════

describe('v45.0 FIX 2.1: UserPreferences Model', () => {
  it('creates UserPreferences with defaults', () => {
    const prefs = new UserPreferences();

    assert.strictEqual(prefs.verbosity, Verbosity.NORMAL);
    assert.strictEqual(prefs.structure, Structure.MIXED);
    assert.strictEqual(prefs.followUpStyle, FollowUpStyle.ADAPTIVE);
    assert.deepStrictEqual(prefs.feedbackHistory, []);
    assert.strictEqual(prefs.feedbackStats.positiveCount, 0);
    assert.strictEqual(prefs.feedbackStats.negativeCount, 0);
  });

  it('creates UserPreferences with custom values', () => {
    const prefs = new UserPreferences({
      verbosity: Verbosity.DETAILED,
      structure: Structure.BULLETS,
      followUpStyle: FollowUpStyle.CONCISE,
    });

    assert.strictEqual(prefs.verbosity, Verbosity.DETAILED);
    assert.strictEqual(prefs.structure, Structure.BULLETS);
    assert.strictEqual(prefs.followUpStyle, FollowUpStyle.CONCISE);
  });

  it('toJSON includes v45.0 fields', () => {
    const prefs = new UserPreferences({
      structure: Structure.PARAGRAPHS,
      followUpStyle: FollowUpStyle.COMPREHENSIVE,
    });

    const json = prefs.toJSON();

    assert.strictEqual(json.structure, Structure.PARAGRAPHS);
    assert.strictEqual(json.followUpStyle, FollowUpStyle.COMPREHENSIVE);
    assert.ok(Array.isArray(json.feedbackHistory));
    assert.ok(typeof json.feedbackStats === 'object');
  });

  it('fromJSON restores v45.0 fields', () => {
    const original = new UserPreferences({
      structure: Structure.BULLETS,
      followUpStyle: FollowUpStyle.CONCISE,
    });

    original.recordPositiveFeedback({ responseType: 'search' });

    const restored = UserPreferences.fromJSON(original.toJSON());

    assert.strictEqual(restored.structure, Structure.BULLETS);
    assert.strictEqual(restored.followUpStyle, FollowUpStyle.CONCISE);
    assert.strictEqual(restored.feedbackStats.positiveCount, 1);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST 3: Feedback Learning
// ════════════════════════════════════════════════════════════════════════════════

describe('v45.0 FIX 2.2: Feedback Learning', () => {
  it('records positive feedback', () => {
    const prefs = new UserPreferences();

    prefs.recordPositiveFeedback({
      responseType: 'search',
      verbosity: Verbosity.DETAILED,
      structure: Structure.BULLETS,
    });

    assert.strictEqual(prefs.feedbackStats.positiveCount, 1);
    assert.strictEqual(prefs.feedbackStats.negativeCount, 0);
    assert.strictEqual(prefs.feedbackHistory.length, 1);
    assert.strictEqual(prefs.feedbackHistory[0].type, 'positive');
  });

  it('records negative feedback', () => {
    const prefs = new UserPreferences();

    prefs.recordNegativeFeedback({
      responseType: 'report',
      verbosity: Verbosity.MINIMAL,
      reason: 'too brief',
    });

    assert.strictEqual(prefs.feedbackStats.positiveCount, 0);
    assert.strictEqual(prefs.feedbackStats.negativeCount, 1);
    assert.strictEqual(prefs.feedbackHistory.length, 1);
    assert.strictEqual(prefs.feedbackHistory[0].type, 'negative');
  });

  it('getFeedbackStats returns correct values', () => {
    const prefs = new UserPreferences();

    prefs.recordPositiveFeedback({ responseType: 'search' });
    prefs.recordPositiveFeedback({ responseType: 'search' });
    prefs.recordNegativeFeedback({ responseType: 'report' });

    const stats = prefs.getFeedbackStats();

    assert.strictEqual(stats.positiveCount, 2);
    assert.strictEqual(stats.negativeCount, 1);
    assert.strictEqual(stats.total, 3);
    assert.ok(Math.abs(stats.satisfactionRate - 0.666) < 0.01);
  });

  it('adjusts preferences after consistent positive feedback', () => {
    const prefs = new UserPreferences({
      verbosity: Verbosity.NORMAL,
    });

    // Record 3 positive feedback with DETAILED verbosity
    for (let i = 0; i < 3; i++) {
      prefs.recordPositiveFeedback({
        responseType: 'search',
        verbosity: Verbosity.DETAILED,
      });
    }

    // Preference should shift to DETAILED
    assert.strictEqual(prefs.verbosity, Verbosity.DETAILED);
  });

  it('shifts verbosity after consistent negative feedback', () => {
    const prefs = new UserPreferences({
      verbosity: Verbosity.DETAILED,
    });

    // Record 3 negative feedback with DETAILED verbosity
    for (let i = 0; i < 3; i++) {
      prefs.recordNegativeFeedback({
        responseType: 'search',
        verbosity: Verbosity.DETAILED,
      });
    }

    // Should shift away from DETAILED
    assert.ok(prefs.verbosity !== Verbosity.DETAILED);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST 4: Preference Optimization
// ════════════════════════════════════════════════════════════════════════════════

describe('v45.0 FIX 2.2: Preference Optimization', () => {
  it('getOptimizedFor returns defaults without feedback', () => {
    const prefs = new UserPreferences();

    const optimized = prefs.getOptimizedFor('search');

    assert.strictEqual(optimized.verbosity, prefs.verbosity);
    assert.strictEqual(optimized.structure, prefs.structure);
    assert.strictEqual(optimized.followUpStyle, prefs.followUpStyle);
  });

  it('getOptimizedFor uses successful patterns', () => {
    const prefs = new UserPreferences();

    // Record positive feedback with specific settings
    prefs.recordPositiveFeedback({
      responseType: 'report',
      verbosity: Verbosity.DETAILED,
      structure: Structure.BULLETS,
    });
    prefs.recordPositiveFeedback({
      responseType: 'report',
      verbosity: Verbosity.DETAILED,
      structure: Structure.BULLETS,
    });
    prefs.recordPositiveFeedback({
      responseType: 'report',
      verbosity: Verbosity.DETAILED,
      structure: Structure.BULLETS,
    });

    const optimized = prefs.getOptimizedFor('report');

    assert.strictEqual(optimized.verbosity, Verbosity.DETAILED);
    assert.strictEqual(optimized.structure, Structure.BULLETS);
  });

  it('getOptimizedFor finds most common successful settings', () => {
    const prefs = new UserPreferences();

    // Record mixed feedback - DETAILED should win (3 vs 1)
    prefs.recordPositiveFeedback({ responseType: 'search', verbosity: Verbosity.DETAILED });
    prefs.recordPositiveFeedback({ responseType: 'search', verbosity: Verbosity.DETAILED });
    prefs.recordPositiveFeedback({ responseType: 'search', verbosity: Verbosity.DETAILED });
    prefs.recordPositiveFeedback({ responseType: 'search', verbosity: Verbosity.MINIMAL });

    const optimized = prefs.getOptimizedFor('search');

    assert.strictEqual(optimized.verbosity, Verbosity.DETAILED);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST 5: PreferenceEngine Integration
// ════════════════════════════════════════════════════════════════════════════════

describe('v45.0 FIX 2.3: PreferenceEngine Integration', () => {
  it('recordPositiveFeedback works through engine', () => {
    const engine = new PreferenceEngine();

    engine.recordPositiveFeedback({
      responseType: 'search',
      verbosity: Verbosity.NORMAL,
    });

    const stats = engine.getStats();
    assert.strictEqual(stats.feedbackStats.positiveCount, 1);
  });

  it('recordNegativeFeedback works through engine', () => {
    const engine = new PreferenceEngine();

    engine.recordNegativeFeedback({
      responseType: 'report',
      reason: 'too long',
    });

    const stats = engine.getStats();
    assert.strictEqual(stats.feedbackStats.negativeCount, 1);
  });

  it('getPreferencesForSynthesis returns correct format', () => {
    const engine = new PreferenceEngine({
      preferences: new UserPreferences({
        verbosity: Verbosity.DETAILED,
        structure: Structure.BULLETS,
        followUpStyle: FollowUpStyle.CONCISE,
        technicalDepth: TechnicalDepth.ADVANCED,
        language: 'cs',
      }),
    });

    const prefs = engine.getPreferencesForSynthesis('SEARCH');

    assert.strictEqual(prefs.verbosity, Verbosity.DETAILED);
    assert.strictEqual(prefs.structure, Structure.BULLETS);
    assert.strictEqual(prefs.followUpStyle, FollowUpStyle.CONCISE);
    assert.strictEqual(prefs.technicalDepth, TechnicalDepth.ADVANCED);
    assert.strictEqual(prefs.language, 'cs');
  });

  it('getOptimizedPreferences uses feedback history', () => {
    const engine = new PreferenceEngine();

    // Record feedback through engine
    engine.recordPositiveFeedback({ responseType: 'REPORT', structure: Structure.PARAGRAPHS });
    engine.recordPositiveFeedback({ responseType: 'REPORT', structure: Structure.PARAGRAPHS });
    engine.recordPositiveFeedback({ responseType: 'REPORT', structure: Structure.PARAGRAPHS });

    const optimized = engine.getOptimizedPreferences('REPORT');

    assert.strictEqual(optimized.structure, Structure.PARAGRAPHS);
  });

  it('getStats includes feedbackStats', () => {
    const engine = new PreferenceEngine();

    engine.recordPositiveFeedback({ responseType: 'search' });
    engine.recordNegativeFeedback({ responseType: 'search' });

    const stats = engine.getStats();

    assert.ok(stats.feedbackStats);
    assert.strictEqual(stats.feedbackStats.total, 2);
    assert.strictEqual(stats.feedbackStats.positiveCount, 1);
    assert.strictEqual(stats.feedbackStats.negativeCount, 1);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Banner
// ════════════════════════════════════════════════════════════════════════════════

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  Preference Learning Tests v45.0                                            ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  Phase 2: Feedback Learning & User Preferences                               ║
║                                                                              ║
║  FIX 2.1: UserPreference model (structure, followUpStyle)                    ║
║  FIX 2.2: Feedback learning (positive/negative signals)                      ║
║  FIX 2.3: PreferenceEngine integration with synthesizeWithLLM()              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
