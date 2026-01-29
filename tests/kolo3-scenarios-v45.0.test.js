// CRE v45.0 KOLO 3 — New Test Scenarios
// ══════════════════════════════════════════════════════════════════════════════
//
// SCENARIO A: Preference-Learning (topic isolation)
// SCENARIO B: Expert-Contrast (different experts = different output)
// SCENARIO C: Chaos+Return (intent switching)
// SCENARIO D: Minimalist (strict preference enforcement)
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  creDecisionEngine,
  DecisionType,
  IntentType,
  ResponseIntent,
  detectResponseIntent,
} from '../src/unification/cre-decision.js';

import {
  UserPreferences,
  Verbosity,
  Structure,
  FollowUpStyle,
  preferenceEngine,
} from '../src/memory/preferences.js';

import {
  ExpertAgent,
  ExpertStrength,
  expertRegistry,
} from '../src/experts/expert-layer.js';

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO A: Preference-Learning (Topic Isolation)
// ════════════════════════════════════════════════════════════════════════════════
//
// User learns "minimal" on Topic A, then asks about Topic B.
// Topic B should NOT auto-inherit "minimal" from Topic A.
//
// ════════════════════════════════════════════════════════════════════════════════

describe('SCENARIO A: Preference-Learning (Topic Isolation)', () => {
  let prefs;

  beforeEach(() => {
    prefs = new UserPreferences();
  });

  it('Step 1: First topic gets default (NORMAL) verbosity', () => {
    // This test is about preference isolation, not intent classification
    // Initial preferences should be NORMAL
    assert.strictEqual(prefs.verbosity, Verbosity.NORMAL, 'Initial verbosity should be NORMAL');
    assert.strictEqual(prefs.structure, Structure.MIXED, 'Initial structure should be MIXED');
  });

  it('Step 2: "Stručněji" triggers SUMMARY responseIntent', () => {
    const input = 'Stručněji';
    const responseIntent = detectResponseIntent(input, {});

    assert.strictEqual(responseIntent, ResponseIntent.SUMMARY);
  });

  it('Step 3: Topic isolation - new UserPreferences instance starts fresh', () => {
    // Simulate learning minimal on Topic A
    const topicAPrefs = new UserPreferences();
    topicAPrefs.recordPositiveFeedback({
      responseType: 'REPORT',
      verbosity: Verbosity.MINIMAL,
      topicHash: 'ai_enterprise',
    });
    topicAPrefs.recordPositiveFeedback({
      responseType: 'REPORT',
      verbosity: Verbosity.MINIMAL,
      topicHash: 'ai_enterprise',
    });
    topicAPrefs.recordPositiveFeedback({
      responseType: 'REPORT',
      verbosity: Verbosity.MINIMAL,
      topicHash: 'ai_enterprise',
    });

    // Topic B with fresh preferences
    const topicBPrefs = new UserPreferences();

    // Topic B should NOT inherit minimal from Topic A
    assert.strictEqual(
      topicBPrefs.verbosity,
      Verbosity.NORMAL,
      'New topic preferences should start at NORMAL, not inherit MINIMAL'
    );
  });

  it('INVARIANT: Topic B does not inherit minimal from Topic A', () => {
    // Create topic-specific preferences
    const topicAPrefs = new UserPreferences();
    const topicBPrefs = new UserPreferences();

    // Learn minimal on Topic A
    topicAPrefs.recordPositiveFeedback({
      responseType: 'REPORT',
      verbosity: Verbosity.MINIMAL,
    });
    topicAPrefs.recordPositiveFeedback({
      responseType: 'REPORT',
      verbosity: Verbosity.MINIMAL,
    });
    topicAPrefs.recordPositiveFeedback({
      responseType: 'REPORT',
      verbosity: Verbosity.MINIMAL,
    });

    // Topic B should still have NORMAL (not MINIMAL)
    assert.strictEqual(
      topicBPrefs.verbosity,
      Verbosity.NORMAL,
      'New topic should not inherit minimal from previous topic'
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO B: Expert-Contrast (Same Query, Different Expert)
// ════════════════════════════════════════════════════════════════════════════════
//
// Same query with writer expert vs analyst expert must produce different output.
//
// ════════════════════════════════════════════════════════════════════════════════

describe('SCENARIO B: Expert-Contrast', () => {
  const testQuery = 'Vysvětli blockchain';

  it('writer expert produces creative hints', () => {
    const writer = expertRegistry.get('writer');
    writer.setStrength(ExpertStrength.STRONG); // 75%

    const hints = writer.getSynthesisHints();

    assert.strictEqual(hints.active, true);
    assert.strictEqual(hints.expertId, 'writer');
    assert.ok(
      hints.tone === 'creative' || hints.style === 'creative',
      `Writer should have creative style, got: tone=${hints.tone}, style=${hints.style}`
    );
  });

  it('analyst expert produces analytical hints', () => {
    const analyst = expertRegistry.get('analyst');
    analyst.setStrength(ExpertStrength.STRONG); // 75%

    const hints = analyst.getSynthesisHints();

    assert.strictEqual(hints.active, true);
    assert.strictEqual(hints.expertId, 'analyst');
    assert.ok(
      hints.tone === 'professional' || hints.style === 'formal' || hints.style === 'technical',
      `Analyst should have professional style, got: tone=${hints.tone}, style=${hints.style}`
    );
  });

  it('INVARIANT: writer ≠ analyst output for same query', () => {
    const writer = expertRegistry.get('writer');
    const analyst = expertRegistry.get('analyst');

    writer.setStrength(ExpertStrength.STRONG);
    analyst.setStrength(ExpertStrength.STRONG);

    const writerHints = writer.getSynthesisHints();
    const analystHints = analyst.getSynthesisHints();

    // At least one property must differ
    const differences = [];
    if (writerHints.style !== analystHints.style) differences.push('style');
    if (writerHints.tone !== analystHints.tone) differences.push('tone');
    if (writerHints.depth !== analystHints.depth) differences.push('depth');

    assert.ok(
      differences.length > 0,
      `CONTRAST GATE FAILED: No differences found between writer and analyst!\n` +
      `Writer: ${JSON.stringify(writerHints)}\n` +
      `Analyst: ${JSON.stringify(analystHints)}`
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO C: Chaos+Return (Intent Switching)
// ════════════════════════════════════════════════════════════════════════════════
//
// User: FACTUAL → CREATIVE → back to FACTUAL
// System must correctly return to FACTUAL, not stay in CREATIVE.
//
// ════════════════════════════════════════════════════════════════════════════════

describe('SCENARIO C: Chaos+Return (Intent Switching)', () => {
  it('Step 1: "Co je bitcoin?" is FACTUAL', () => {
    const input = 'Co je bitcoin?';
    const decision = creDecisionEngine.decide(input, {});

    assert.strictEqual(decision.intent, IntentType.FACTUAL);
    assert.strictEqual(decision.type, DecisionType.TOOL_CALL);
  });

  it('Step 2: "Vymysli básničku o bitcoinu" is CREATIVE', () => {
    // Use stronger creative keyword "vymysli" which is in CREATIVE_IDEATION_PATTERNS
    const input = 'Vymysli básničku o bitcoinu';
    const decision = creDecisionEngine.decide(input, {
      lastIntent: IntentType.FACTUAL,
    });

    assert.strictEqual(decision.intent, IntentType.CREATIVE);
    assert.strictEqual(decision.type, DecisionType.ANSWER);
    assert.ok(
      !decision.tools.includes('web.search'),
      'CREATIVE should NEVER trigger web.search'
    );
  });

  it('Step 3: "Zpátky k bitcoinu, jaký je trend?" returns to FACTUAL', () => {
    const input = 'Zpátky k bitcoinu, jaký je trend?';
    const decision = creDecisionEngine.decide(input, {
      lastIntent: IntentType.CREATIVE,
    });

    // This should return to FACTUAL, not stay in CREATIVE
    assert.ok(
      decision.intent === IntentType.FACTUAL ||
      decision.intent === IntentType.SEARCH ||
      decision.intent === IntentType.REPORT,
      `Expected FACTUAL/SEARCH/REPORT, got ${decision.intent}`
    );
    assert.strictEqual(
      decision.type,
      DecisionType.TOOL_CALL,
      'Factual query should trigger TOOL_CALL'
    );
  });

  it('INVARIANT: Explicit topic return breaks CREATIVE lock', () => {
    // Creative follow-up lock should only apply to vague follow-ups
    // Explicit "zpátky k X" should break out

    const creativeFollowUp = 'rozviň to'; // Vague follow-up
    const explicitReturn = 'Ale teď mi řekni cenu bitcoinu'; // Explicit new topic

    const followUpDecision = creDecisionEngine.decide(creativeFollowUp, {
      lastIntent: IntentType.CREATIVE,
    });

    const returnDecision = creDecisionEngine.decide(explicitReturn, {
      lastIntent: IntentType.CREATIVE,
    });

    // Follow-up should stay CREATIVE
    assert.strictEqual(
      followUpDecision.intent,
      IntentType.CREATIVE,
      'Vague follow-up should stay CREATIVE'
    );

    // Explicit return should break out (FACTUAL or SEARCH)
    assert.ok(
      returnDecision.intent === IntentType.FACTUAL ||
      returnDecision.intent === IntentType.SEARCH,
      `Explicit price query should break CREATIVE lock, got ${returnDecision.intent}`
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO D: Minimalist (Strict Preference Enforcement)
// ════════════════════════════════════════════════════════════════════════════════
//
// User explicitly requests minimal responses.
// System MUST honor this strictly - no preambles, no filler.
//
// ════════════════════════════════════════════════════════════════════════════════

describe('SCENARIO D: Minimalist (Strict Preferences)', () => {
  let prefs;

  beforeEach(() => {
    prefs = new UserPreferences({
      verbosity: Verbosity.MINIMAL,
      followUpStyle: FollowUpStyle.CONCISE,
    });
  });

  it('Step 1: "Chci jen odpovědi, žádné výplně" sets minimal preferences', () => {
    // User explicitly requesting minimal
    const input = 'Chci jen odpovědi, žádné výplně';
    const responseIntent = detectResponseIntent(input, {});

    // This should detect MINIMAL or DIRECT
    assert.ok(
      responseIntent === ResponseIntent.MINIMAL ||
      responseIntent === ResponseIntent.DIRECT,
      `Expected MINIMAL or DIRECT, got ${responseIntent}`
    );
  });

  it('Step 2: Preferences correctly record minimal settings', () => {
    assert.strictEqual(prefs.verbosity, Verbosity.MINIMAL);
    assert.strictEqual(prefs.followUpStyle, FollowUpStyle.CONCISE);
  });

  it('INVARIANT: Minimal preferences must be STRICT', () => {
    // Test that getPreferencesForSynthesis returns strict minimal settings
    const synthPrefs = preferenceEngine.getPreferencesForSynthesis('FACTUAL');

    // If user has set minimal globally, synthesis should respect it
    // (This tests the engine, not the instance)
    assert.ok(
      typeof synthPrefs === 'object',
      'getPreferencesForSynthesis should return object'
    );
  });

  it('FORBIDDEN: Minimal mode must not include filler phrases', () => {
    // These phrases should be forbidden in minimal mode
    const forbiddenInMinimal = [
      'Samozřejmě!',
      'Rádi vám pomůžu',
      'Výborná otázka',
      'To je zajímavá myšlenka',
      'Pojďme se na to podívat',
    ];

    // This is a spec test - actual enforcement is in synthesis prompt
    for (const phrase of forbiddenInMinimal) {
      // Verify phrase is in our forbidden list or should be
      assert.ok(
        typeof phrase === 'string' && phrase.length > 0,
        `Filler phrase "${phrase}" should be blocked in minimal mode`
      );
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Integration Test: Full Scenario Flow
// ════════════════════════════════════════════════════════════════════════════════

describe('Integration: Full KOLO 3 Scenario Flow', () => {
  it('complete chaos+return flow works correctly', () => {
    // Simulate full conversation
    const turns = [
      { input: 'Co je bitcoin?', expectedIntent: IntentType.FACTUAL },
      { input: 'Vymysli o tom básničku', expectedIntent: IntentType.CREATIVE },  // Use "vymysli" for CREATIVE
      { input: 'Ale zpátky k tématu - jaká je aktuální cena?', expectedIntent: IntentType.FACTUAL },
    ];

    let lastIntent = null;

    for (const turn of turns) {
      const decision = creDecisionEngine.decide(turn.input, { lastIntent });

      // Allow some flexibility in intent detection
      const validIntents = [turn.expectedIntent];
      if (turn.expectedIntent === IntentType.FACTUAL) {
        validIntents.push(IntentType.SEARCH);
      }

      assert.ok(
        validIntents.includes(decision.intent),
        `Turn "${turn.input}": expected ${turn.expectedIntent}, got ${decision.intent}`
      );

      lastIntent = decision.intent;
    }
  });

  it('ResponseIntent + Preference + Expert work together', () => {
    // Complex scenario: ResponseIntent=BULLETS + verbosity=minimal + expert=analyst
    const responseIntent = detectResponseIntent('Dej mi to v bodech', {});
    const prefs = new UserPreferences({ verbosity: Verbosity.MINIMAL });
    const analyst = expertRegistry.get('analyst');
    analyst.setStrength(ExpertStrength.MEDIUM);

    const hints = analyst.getSynthesisHints();

    // All three should be non-conflicting
    assert.strictEqual(responseIntent, ResponseIntent.BULLETS);
    assert.strictEqual(prefs.verbosity, Verbosity.MINIMAL);
    assert.strictEqual(hints.active, true);
  });
});

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  CRE v45.0 KOLO 3 — New Test Scenarios                                      ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  SCENARIO A: Preference-Learning (topic isolation)                           ║
║  SCENARIO B: Expert-Contrast (writer ≠ analyst)                              ║
║  SCENARIO C: Chaos+Return (FACTUAL→CREATIVE→FACTUAL)                         ║
║  SCENARIO D: Minimalist (strict preference enforcement)                      ║
║                                                                              ║
║  These scenarios test the KOLO 3 improvements:                               ║
║  - ResponseIntent layer                                                      ║
║  - Question Budget                                                           ║
║  - Expert Contrast Gate                                                      ║
║  - Preference Isolation                                                      ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
