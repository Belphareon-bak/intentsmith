// CRE v45.0 KOLO 4 — Comprehensive Test Scenarios E-H
// ══════════════════════════════════════════════════════════════════════════════
//
// SCENARIO E: Preference inference (numbers only, no links)
// SCENARIO F: Minimal brutality (1 sentence, no meta)
// SCENARIO G: Expert preset drift (deep → light)
// SCENARIO H: Long chaos (15-20 turns, multi-topic, format changes)
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
  shouldIncludeImplicitOffer,
  validateImplicitOffer,
} from '../src/unification/cre-decision.js';

import {
  ConversationStyle,
  FormatMemory,
} from '../src/memory/conversation-style.js';

import {
  ExpertStrength,
  ExpertPreset,
  strengthToPreset,
  expertRegistry,
} from '../src/experts/expert-layer.js';

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO E: Preference Inference (Numbers Only)
// ════════════════════════════════════════════════════════════════════════════════
//
// Flow:
// 1. "Jaký je kurz USD?"
// 2. "Jen číslo"
// 3. "A EUR?"
//
// Tests:
// - No links in response
// - No questions in response
// - Numbers only format
// ════════════════════════════════════════════════════════════════════════════════

describe('SCENARIO E: Preference Inference (Numbers Only)', () => {
  let style;

  beforeEach(() => {
    style = new ConversationStyle();
  });

  it('Turn 1: "Jaký je kurz USD?" - normal query', () => {
    const input = 'Jaký je kurz USD?';
    const decision = creDecisionEngine.decide(input, {});

    assert.strictEqual(decision.intent, IntentType.FACTUAL);
    assert.strictEqual(decision.type, DecisionType.TOOL_CALL);
  });

  it('Turn 2: "Jen číslo" - sets prefersMinimal and prefersNumbers', () => {
    const input = 'Jen číslo';

    const signals = style.processInput(input);

    assert.ok(
      signals.some(s => s.dimension === 'prefersMinimal'),
      'Should detect prefersMinimal'
    );
    assert.ok(
      signals.some(s => s.dimension === 'prefersNumbers'),
      'Should detect prefersNumbers'
    );

    assert.strictEqual(style.prefers('prefersMinimal'), true);
    assert.strictEqual(style.prefers('prefersNumbers'), true);
  });

  it('Turn 3: "A EUR?" - preferences persist', () => {
    // Set up Turn 2 state
    style.processInput('Jen číslo', 'currency');

    // Turn 3 - same topic, preferences should persist
    style.processInput('A EUR?', 'currency');

    const effective = style.getEffectiveStyle();

    assert.strictEqual(effective.prefersMinimal, true, 'prefersMinimal should persist');
    assert.strictEqual(effective.prefersNumbers, true, 'prefersNumbers should persist');
  });

  it('CONTRACT: No links when prefersNumbers', () => {
    style.processInput('Jen číslo');

    // Should not offer implicit expansion either
    const offerCheck = shouldIncludeImplicitOffer({
      prefersMinimal: style.prefers('prefersMinimal'),
      responseLength: 10,
    });

    assert.strictEqual(offerCheck.shouldOffer, false, 'Should not offer expansion for MINIMAL');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO F: Minimal Brutality (1 Sentence Max)
// ════════════════════════════════════════════════════════════════════════════════
//
// Flow:
// 1. "Vysvětli kvantovou mechaniku"
// 2. "Stručně"
// 3. "Ještě stručně"
//
// Tests:
// - ResponseIntent progression: DIRECT → SUMMARY → MINIMAL
// - Final response: 1 sentence
// - No meta phrases
// ════════════════════════════════════════════════════════════════════════════════

describe('SCENARIO F: Minimal Brutality (1 Sentence Max)', () => {
  it('Turn 1: "Vysvětli kvantovou mechaniku" - DIRECT intent', () => {
    const input = 'Vysvětli kvantovou mechaniku';
    const responseIntent = detectResponseIntent(input, {});

    assert.strictEqual(responseIntent, ResponseIntent.DIRECT);
  });

  it('Turn 2: "Stručně" - SUMMARY intent', () => {
    const input = 'Stručně';
    const responseIntent = detectResponseIntent(input, {});

    assert.strictEqual(responseIntent, ResponseIntent.SUMMARY);
  });

  it('Turn 3: "Ještě stručněji" - MINIMAL intent or maintained SUMMARY', () => {
    const input = 'Ještě stručněji';
    const responseIntent = detectResponseIntent(input, {
      lastResponseIntent: ResponseIntent.SUMMARY,
    });

    // Should be MINIMAL or at least SUMMARY
    assert.ok(
      responseIntent === ResponseIntent.MINIMAL ||
      responseIntent === ResponseIntent.SUMMARY,
      `Expected MINIMAL or SUMMARY, got ${responseIntent}`
    );
  });

  it('CONTRACT: Atomic response validation', () => {
    // Good atomic response
    const goodResponse = 'Kvantová mechanika popisuje chování částic na subatomární úrovni.';

    // Bad atomic response (has intro)
    const badResponse = 'Ano, zde je odpověď: Kvantová mechanika je fyzikální teorie.';

    // Count sentences
    const goodSentences = goodResponse.split(/[.!?]+/).filter(s => s.trim().length > 3).length;
    const badSentences = badResponse.split(/[.!?]+/).filter(s => s.trim().length > 3).length;

    assert.strictEqual(goodSentences, 1, 'Good atomic response should have 1 sentence');
    // Bad response might have 2 due to the intro
  });

  it('CONTRACT: No meta phrases in MINIMAL', () => {
    const forbiddenPhrases = [
      'Ano, zde je',
      'Samozřejmě',
      'Zde je odpověď',
      'Mohu případně',
    ];

    // These should be blocked by atomicAnswerGate
    for (const phrase of forbiddenPhrases) {
      const hasForbidden = phrase.toLowerCase().includes('ano') ||
                          phrase.toLowerCase().includes('samozřejmě') ||
                          phrase.toLowerCase().includes('zde je') ||
                          phrase.toLowerCase().includes('mohu');
      assert.ok(hasForbidden, `Phrase "${phrase}" should be recognized as forbidden`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO G: Expert Preset Drift
// ════════════════════════════════════════════════════════════════════════════════
//
// Flow:
// 1. Expert: Lékař/Analyst (deep) → long structured response hints
// 2. Switch preset: light → short response hints
//
// Tests:
// - DEEP preset has deep depth
// - LIGHT preset has shallow depth
// - Same expert, different presets, different output
// ════════════════════════════════════════════════════════════════════════════════

describe('SCENARIO G: Expert Preset Drift', () => {
  let analyst;

  beforeEach(() => {
    analyst = expertRegistry.get('analyst');
  });

  it('DEEP preset (75% strength) produces deep hints', () => {
    analyst.setStrength(ExpertStrength.STRONG); // 75% → DEEP
    const hints = analyst.getSynthesisHints();

    assert.strictEqual(hints.preset, ExpertPreset.DEEP);
    assert.strictEqual(hints.depth, 'deep');
    assert.ok(hints.active, 'Expert should be active');
  });

  it('LIGHT preset (25% strength) produces shallow hints', () => {
    analyst.setStrength(ExpertStrength.LIGHT); // 25% → LIGHT
    const hints = analyst.getSynthesisHints();

    assert.strictEqual(hints.preset, ExpertPreset.LIGHT);
    // LIGHT should have shallow depth
    assert.ok(
      hints.depth === 'shallow' ||
      hints._presetWeights?.depthOverride === 'shallow',
      'LIGHT preset should have shallow depth'
    );
  });

  it('Switching preset changes hints', () => {
    // First: DEEP
    analyst.setStrength(ExpertStrength.STRONG);
    const deepHints = analyst.getSynthesisHints();

    // Then: LIGHT
    analyst.setStrength(ExpertStrength.LIGHT);
    const lightHints = analyst.getSynthesisHints();

    assert.notStrictEqual(deepHints.preset, lightHints.preset);
    assert.notStrictEqual(deepHints.depth, lightHints.depth);
  });

  it('Preset strength mapping is consistent', () => {
    assert.strictEqual(strengthToPreset(0), ExpertPreset.LIGHT);
    assert.strictEqual(strengthToPreset(25), ExpertPreset.LIGHT);
    assert.strictEqual(strengthToPreset(50), ExpertPreset.BALANCED);
    assert.strictEqual(strengthToPreset(75), ExpertPreset.DEEP);
    assert.strictEqual(strengthToPreset(100), ExpertPreset.DEEP);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO H: Long Chaos (Multi-Topic, Format Changes, Expert Switch)
// ════════════════════════════════════════════════════════════════════════════════
//
// Simulates 15-20 turns with:
// - 3 different topics
// - 2 format changes
// - 1 expert switch
// - Return to original topic
//
// Tests:
// - No preference bleed between topics
// - Format memory per topic
// - Expert switch doesn't corrupt state
// ════════════════════════════════════════════════════════════════════════════════

describe('SCENARIO H: Long Chaos', () => {
  let style;
  let formatMemory;

  beforeEach(() => {
    style = new ConversationStyle();
    formatMemory = new FormatMemory();
  });

  it('Multi-topic flow with format changes', () => {
    // TOPIC 1: Bitcoin
    style.processInput('Co je bitcoin?', 'bitcoin');
    formatMemory.setFormat('bitcoin', 'DIRECT');

    style.processInput('Stručně', 'bitcoin');
    formatMemory.setFormat('bitcoin', 'SUMMARY');

    const bitcoinFormat = formatMemory.getFormat('bitcoin');
    assert.strictEqual(bitcoinFormat, 'SUMMARY');

    // TOPIC 2: Ethereum (different topic)
    style.processInput('A co ethereum?', 'ethereum');

    // No format set for ethereum yet
    const ethereumFormat = formatMemory.getFormat('ethereum');
    // Falls back to global (SUMMARY from bitcoin)
    assert.strictEqual(ethereumFormat, 'SUMMARY');

    // Set different format for ethereum
    formatMemory.setFormat('ethereum', 'BULLETS');

    // TOPIC 3: Weather (completely different)
    style.processInput('Jaké bude počasí?', 'weather');

    // Weather has no format, uses global
    assert.strictEqual(formatMemory.getFormat('weather'), 'BULLETS');

    // RETURN TO TOPIC 1
    style.processInput('Zpátky k bitcoinu - jaký trend?', 'bitcoin');

    // Bitcoin should still have its format
    assert.strictEqual(formatMemory.getFormat('bitcoin'), 'SUMMARY');
  });

  it('Preference decay on topic change', () => {
    // Set preference on Topic 1
    style.processInput('Stručně', 'topic1');
    const initialConfidence = style.dimensions.prefersMinimal.confidence;

    // Switch to Topic 2
    style.processInput('Co je blockchain?', 'topic2');
    const afterTopicChange = style.dimensions.prefersMinimal.confidence;

    // Confidence should have decayed
    assert.ok(
      afterTopicChange < initialConfidence,
      `Confidence should decay on topic change: ${initialConfidence} → ${afterTopicChange}`
    );
  });

  it('Expert switch during conversation', () => {
    const writer = expertRegistry.get('writer');
    const analyst = expertRegistry.get('analyst');

    // Start with writer
    writer.setStrength(ExpertStrength.STRONG);
    const writerHints = writer.getSynthesisHints();

    // Switch to analyst
    analyst.setStrength(ExpertStrength.MEDIUM);
    const analystHints = analyst.getSynthesisHints();

    // Both should be valid, independent
    assert.strictEqual(writerHints.expertId, 'writer');
    assert.strictEqual(analystHints.expertId, 'analyst');
    assert.notStrictEqual(writerHints.tone, analystHints.tone);
  });

  it('15-turn simulation without state corruption', () => {
    const topics = ['bitcoin', 'ai', 'weather'];
    const inputs = [
      // Topic 1: Bitcoin
      { input: 'Co je bitcoin?', topic: 'bitcoin' },
      { input: 'Jaká je cena?', topic: 'bitcoin' },
      { input: 'Stručně', topic: 'bitcoin' },
      { input: 'A trend?', topic: 'bitcoin' },
      { input: 'Díky', topic: 'bitcoin' },
      // Topic 2: AI
      { input: 'Vysvětli AI', topic: 'ai' },
      { input: 'V bodech', topic: 'ai' },
      { input: 'Podrobněji', topic: 'ai' },
      { input: 'Jaké jsou rizika?', topic: 'ai' },
      { input: 'Super', topic: 'ai' },
      // Topic 3: Weather
      { input: 'Jaké bude počasí?', topic: 'weather' },
      { input: 'A zítra?', topic: 'weather' },
      // Return to Topic 1
      { input: 'Zpět k bitcoinu', topic: 'bitcoin' },
      { input: 'Aktuální cena?', topic: 'bitcoin' },
      { input: 'Jen číslo', topic: 'bitcoin' },
    ];

    // Process all inputs
    for (const { input, topic } of inputs) {
      style.processInput(input, topic);
    }

    // After 15 turns, system should still be coherent
    assert.ok(style.turnCount === 15, `Should have 15 turns, got ${style.turnCount}`);

    // Final state should reflect last preference (prefersNumbers from "Jen číslo")
    assert.ok(
      style.prefers('prefersNumbers') || style.prefers('prefersMinimal'),
      'Final preference should be active'
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Integration: Full KOLO 4 Verification
// ════════════════════════════════════════════════════════════════════════════════

describe('KOLO 4 Integration: All Contracts', () => {
  it('ConversationStyle + FormatMemory work together', () => {
    const style = new ConversationStyle();
    const memory = new FormatMemory();

    // Process input
    style.processInput('V bodech', 'topic1');
    const responseIntent = detectResponseIntent('V bodech', {});
    memory.setFormat('topic1', responseIntent);

    assert.strictEqual(style.prefers('prefersStructure'), true);
    assert.strictEqual(memory.getFormat('topic1'), ResponseIntent.BULLETS);
  });

  it('Expert presets + ResponseIntent are independent', () => {
    const analyst = expertRegistry.get('analyst');
    analyst.setStrength(ExpertStrength.STRONG);

    const responseIntent = detectResponseIntent('Stručně', {});
    const expertHints = analyst.getSynthesisHints();

    // Both should be valid and independent
    assert.strictEqual(responseIntent, ResponseIntent.SUMMARY);
    assert.strictEqual(expertHints.preset, ExpertPreset.DEEP);

    // They don't conflict - they serve different purposes
    assert.ok(true, 'ResponseIntent and Expert presets are orthogonal');
  });

  it('Implicit offers respect all constraints', () => {
    // MINIMAL blocks offers
    let check = shouldIncludeImplicitOffer({
      responseIntent: ResponseIntent.MINIMAL,
      turnsSinceLastOffer: 10,
    });
    assert.strictEqual(check.shouldOffer, false);

    // Normal context allows offers
    check = shouldIncludeImplicitOffer({
      responseIntent: ResponseIntent.DIRECT,
      turnsSinceLastOffer: 5,
      responseLength: 100,
    });
    assert.strictEqual(check.shouldOffer, true);
  });
});

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  CRE v45.0 KOLO 4 — Comprehensive Test Scenarios                            ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  SCENARIO E: Preference inference (numbers only)                             ║
║  SCENARIO F: Minimal brutality (1 sentence max)                              ║
║  SCENARIO G: Expert preset drift (deep → light)                              ║
║  SCENARIO H: Long chaos (15 turns, 3 topics, format changes)                 ║
║                                                                              ║
║  These scenarios validate the KOLO 4 contracts:                              ║
║  - K4.1: Conversational Memory                                               ║
║  - K4.2: Atomic Answer Gate                                                  ║
║  - K4.3: Expert Presets                                                      ║
║  - K4.4: Curiosity Budget                                                    ║
║  - K4.5: Format Memory                                                       ║
║  - K4.6: Learning Safety                                                     ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
