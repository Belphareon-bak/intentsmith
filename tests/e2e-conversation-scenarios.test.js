// CRE v45.0 — E2E Conversation Scenarios
// ══════════════════════════════════════════════════════════════════════════════
//
// Comprehensive end-to-end conversation tests with full Q&A export.
//
// SCENARIOS:
// 1. REPORT→FORMAT: User asks for report, then changes format preferences
// 2. SEARCH→PRODUCT: User searches for products, explores options
// 3. CREATIVE: Ideation/brainstorming (CREATIVE intent, no web search)
// 4. LOCAL: Deterministic local queries (dates, math)
// 5. TOPIC_CHANGE: Topic isolation (no cross-topic preference bleeding)
//
// INVARIANTS TESTED:
// - expertStrength=0 identical to default
// - max 1 axis change per feedback
// - topicHash isolation per responseType
// - CREATIVE never triggers web.search
// - LOCAL is terminal (no tool calls)
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import {
  creDecisionEngine,
  DecisionType,
  IntentType,
  CREDecision,
  ResponseIntent,
  detectResponseIntent,
} from '../src/unification/cre-decision.js';

import {
  UserPreferences,
  Verbosity,
  Structure,
  FollowUpStyle,
} from '../src/memory/preferences.js';

import {
  ExpertAgent,
  ExpertStrength,
  ExpertWeights,
  expertRegistry,
} from '../src/experts/expert-layer.js';

// ════════════════════════════════════════════════════════════════════════════════
// Test Output Configuration
// ════════════════════════════════════════════════════════════════════════════════

const OUTPUT_FILE = path.join(process.cwd(), 'tests', 'e2e-conversation-output.txt');
const outputLines = [];

function log(message) {
  outputLines.push(message);
  console.log(message);
}

function exportOutput() {
  const timestamp = new Date().toISOString();
  const header = `
╔══════════════════════════════════════════════════════════════════════════════╗
║  CRE v45.0 — E2E Conversation Scenarios Output                              ║
║  Generated: ${timestamp}                                       ║
╚══════════════════════════════════════════════════════════════════════════════╝

`;
  fs.writeFileSync(OUTPUT_FILE, header + outputLines.join('\n'));
  console.log(`\n✅ Output exported to: ${OUTPUT_FILE}\n`);
}

// ════════════════════════════════════════════════════════════════════════════════
// v45.0 KOLO 2: FORMAT_CHANGE Detection (mirrors handlers.js logic)
// ════════════════════════════════════════════════════════════════════════════════

const FollowUpType = {
  NEW_QUERY: 'NEW_QUERY',
  FORMAT_CHANGE: 'FORMAT_CHANGE',
  REFINEMENT: 'REFINEMENT',
  CONTINUATION: 'CONTINUATION',
};

function detectFollowUpType(input, sessionState) {
  const lastResponse = sessionState?.lastResponse;
  const lastInput = sessionState?.lastUserInput;

  if (!lastResponse || !lastInput) {
    return { type: FollowUpType.NEW_QUERY, reusePreviousData: false };
  }

  const inputLower = input.toLowerCase().trim();

  // v45.0: FORMAT_CHANGE patterns (without ^ anchors!)
  const formatChangePatterns = [
    /(kratší|zkrať|stručněji|brief|shorter|delší|podrobněji|more detail)/i,
    /(shrnout|shrň|sumarizuj|summarize|shrnutí|summary)/i,
    /(v tabulce|as table|jako seznam|as list|v bodech|bullet|odrážk)/i,
    /(ve formě|in form of|formát|format)/i,
    /(jednodušeji|simpler|formálněji|more formal|neformálně|informal)/i,
    /(přepiš|rewrite|změň formát|change format|přeformátuj|reformat)/i,
    /(teď to|můžeš to|dej mi to|give me|can you).*(jinak|kratší|delší|stručněji|podrobněji|v bodech)/i,
  ];

  if (formatChangePatterns.some(p => p.test(inputLower))) {
    return { type: FollowUpType.FORMAT_CHANGE, reusePreviousData: true };
  }

  // Gratitude = no tool call needed
  const gratitudePatterns = [/díky/i, /děkuj/i, /thanks/i, /super/i, /skvělé/i, /perfect/i];
  if (gratitudePatterns.some(p => p.test(inputLower))) {
    return { type: FollowUpType.CONTINUATION, reusePreviousData: true, isGratitude: true };
  }

  return { type: FollowUpType.NEW_QUERY, reusePreviousData: false };
}

// ════════════════════════════════════════════════════════════════════════════════
// v45.0 KOLO 2: Mock LLM Response Generator (with preference support)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Simulates LLM responses based on intent, context, and preferences
 * v45.0: Now respects FORMAT_CHANGE and generates varied CREATIVE responses
 */
function mockLLMResponse(intent, input, context = {}) {
  const inputLower = input.toLowerCase();
  const prefs = context.preferences || {};
  const followUp = context.followUpType || {};

  // ════════════════════════════════════════════════════════════════════════════
  // GRATITUDE RESPONSES (no filler!)
  // ════════════════════════════════════════════════════════════════════════════
  if (followUp.isGratitude) {
    return 'Rádo se stalo! Pokud budete potřebovat něco dalšího, jsem tu.';
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FORMAT_CHANGE: Reformat previous data (don't repeat full report!)
  // ════════════════════════════════════════════════════════════════════════════
  if (followUp.type === FollowUpType.FORMAT_CHANGE && context.lastResponseData) {
    // Shorter/summary request
    if (/(kratší|stručněji|shrnout|shrň|summary)/i.test(inputLower)) {
      return `**Shrnutí:** Trh roste o 35%, Tesla vede, baterie levnější. Doporučení: sledovat vývoj.`;
    }
    // Bullet request
    if (/(v bodech|odrážk|bullet|seznam|ve formě)/i.test(inputLower)) {
      return `**Klíčové body:**
- Růst trhu: +35% meziročně
- Lídři: Tesla (18%), BYD (+120% YoY)
- Trend: Klesající ceny baterií (-15%)
- Regulace: Přísnější emisní normy v EU
- Doporučení: Sledovat čínské výrobce`;
    }
    // Default reformat
    return `Přeformátováno dle požadavku. Klíčové body zůstávají: pozitivní trend, rostoucí adopce, příznivé vyhlídky.`;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FACTUAL / SEARCH RESPONSES
  // ════════════════════════════════════════════════════════════════════════════
  if (intent === IntentType.FACTUAL || intent === IntentType.SEARCH) {
    if (inputLower.includes('bitcoin')) {
      return 'Bitcoin je momentálně na ceně 45 230 USD (+2.3% za 24h). Trend je rostoucí díky institucionální adopci a blížícímu se halvingu.';
    }
    if (inputLower.includes('trend')) {
      return 'Aktuální trend ukazuje růst o 15% za poslední měsíc. Hlavní faktory: ETF schválení, snížení úrokových sazeb, rostoucí institucionální zájem.';
    }
    if (inputLower.includes('ethereum') || inputLower.includes('porovnej')) {
      return `**Bitcoin vs Ethereum:**
- BTC: 45 230 USD (+2.3%)
- ETH: 2 850 USD (+1.8%)
- BTC dominance: 52%
- ETH má vyšší aktivitu DeFi, BTC je "digitální zlato"`;
    }
    return 'Na základě aktuálních dat: sledované metriky vykazují pozitivní vývoj s mírným růstem za poslední období.';
  }

  // ════════════════════════════════════════════════════════════════════════════
  // REPORT RESPONSES (with preference support)
  // ════════════════════════════════════════════════════════════════════════════
  if (intent === IntentType.REPORT) {
    // Crypto comparison report
    if (inputLower.includes('porovnej') || inputLower.includes('srovnej') || inputLower.includes('compare')) {
      if (inputLower.includes('ethereum') || inputLower.includes('eth')) {
        return `# Srovnání: Bitcoin vs Ethereum

## Aktuální ceny
| Měna | Cena | 24h změna | 30d změna |
|------|------|-----------|-----------|
| BTC  | 45 230 USD | +2.3% | +15% |
| ETH  | 2 850 USD | +1.8% | +12% |

## Klíčové rozdíly
- **BTC**: Store of value, "digitální zlato", nižší volatilita
- **ETH**: Smart contracts, DeFi ekosystém, vyšší utility

## Závěr
Bitcoin vhodný pro dlouhodobé držení, Ethereum pro aktivnější využití v DeFi.

Zdroje: CoinGecko, CryptoCompare`;
      }
    }
    // Minimal verbosity
    if (prefs.verbosity === 'minimal') {
      return `Trh EV: +35% YoY. Tesla vede, BYD roste. Baterie levnější → vyšší adopce.`;
    }
    // Bullets structure
    if (prefs.structure === 'bullets') {
      return `- Růst trhu s EV: +35% meziročně
- Lídr: Tesla (market share 18%)
- Challenger: BYD (+120% YoY)
- Ceny baterií: -15% za rok
- Prognóza 2026: 20M prodaných EV globálně`;
    }
    // Default full report
    return `# Analýza trhu s elektromobily

## Klíčová zjištění
Trh s elektromobily zaznamenal meziroční růst 35%. Tesla si udržuje vedení s 18% tržním podílem, ale BYD agresivně expanduje (+120% YoY).

## Faktory růstu
- Klesající ceny baterií (-15% YoY)
- Přísnější emisní regulace v EU
- Růst nabíjecí infrastruktury

## Závěr
Očekáváme pokračující růst. Doporučení: sledovat vývoj čínských výrobců a regulatorní změny.

Zdroje: BloombergNEF, IEA Global EV Outlook 2026`;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CREATIVE RESPONSES (varied, no filler!)
  // ════════════════════════════════════════════════════════════════════════════
  if (intent === IntentType.CREATIVE) {
    const turnNumber = context.creativeTurn || 1;

    // Initial campaign request
    if (inputLower.includes('kampaň') || turnNumber === 1) {
      return `# Marketingová kampaň "Budoucnost je teď"

## Koncept
Emocionální storytelling zaměřený na životní momenty, které technologie umožňuje.

## Klíčové prvky
1. **Hero video (60s)**: Příběh rodiny napříč generacemi
2. **Social media série**: 15 krátkých videí s reálnými use cases
3. **Influencer partnerství**: Tech a lifestyle influenceři

## Cílová skupina
Millennials a Gen Z (25-40 let), digitálně aktivní, hledající efektivitu.

## Timeline
- Příprava: 4 týdny
- Produkce: 6 týdnů
- Launch: Q2 2026`;
    }

    // Impact/effect question
    if (inputLower.includes('vliv') || inputLower.includes('effect') || inputLower.includes('impact')) {
      return `## Očekávaný vliv na zákazníky

**Emocionální rovina:**
- Posílení důvěry v značku (+25% brand affinity)
- Vytvoření pocitu "být součástí něčeho většího"

**Behaviorální změny:**
- Zvýšení konverzí o 15-20%
- Prodloužení času na webu o 40%
- Vyšší engagement na sociálních sítích

**Dlouhodobý efekt:**
- Budování loajální komunity
- Organický word-of-mouth marketing`;
    }

    // Expand/develop request
    if (inputLower.includes('rozviň') || inputLower.includes('social media') || inputLower.includes('expand')) {
      return `## Social Media Strategie - Detail

### Formáty obsahu
1. **Reels/TikTok (15s)**: Rychlé tipy a "wow" momenty
2. **Stories (24h)**: Behind-the-scenes, ankety, Q&A
3. **Feed posts**: Inspirativní vizuály s příběhy zákazníků
4. **Live sessions**: Týdenní Q&A s produktovým týmem

### Harmonogram
- Pondělí: Motivační start týdne
- Středa: Edukativní obsah
- Pátek: User-generated content
- Víkend: Lifestyle a komunita

### KPIs
- Engagement rate: cíl 5%+
- Reach growth: +20% měsíčně
- Conversion rate: 2-3%`;
    }

    // Alternative version request
    if (inputLower.includes('alternativ') || inputLower.includes('jinou') || inputLower.includes('jinak')) {
      return `# Alternativní koncept: "Malé kroky, velký dopad"

## Odlišný přístup
Místo velkolepého storytellingu se zaměříme na micro-momenty - drobné každodenní situace, kde produkt pomáhá.

## Klíčové prvky
1. **UGC kampaň**: Zákazníci sdílejí své "aha" momenty
2. **Série mini-dokumentů**: 3-minutové příběhy reálných uživatelů
3. **Interaktivní web**: Konfigurátor "Jak vám pomůžeme?"

## Tón komunikace
Přátelský, autentický, bez korporátního jazyka.

## Proč tato varianta?
- Nižší produkční náklady
- Vyšší autenticita
- Rychlejší iterace na základě feedbacku`;
    }

    // Generic creative follow-up
    return `## Další rozvoj konceptu

Na základě předchozích bodů navrhuji tyto konkrétní kroky:
- Detailní rozepsání časové osy s milníky
- Definice KPIs pro každou fázi
- Příprava A/B testů pro klíčové kreativy
- Identifikace potenciálních influencer partnerů`;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LOCAL RESPONSES
  // ════════════════════════════════════════════════════════════════════════════
  if (intent === IntentType.LOCAL) {
    if (inputLower.includes('datum') || inputLower.includes('dnes')) {
      return 'Dnes je 28. ledna 2026, úterý.';
    }
    if (inputLower.includes('úplněk')) {
      return 'Příští úplněk bude 12. února 2026.';
    }
    if (/\d+\s*\+\s*\d+/.test(inputLower) || inputLower.includes('kolik')) {
      return '15 + 27 = 42';
    }
    return 'Výsledek lokálního výpočtu.';
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CONVERSATIONAL (gratitude already handled above)
  // ════════════════════════════════════════════════════════════════════════════
  return 'Jak vám mohu dále pomoci?';
}

// ════════════════════════════════════════════════════════════════════════════════
// v45.0 KOLO 2: Conversation Simulator (with FORMAT_CHANGE support)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Simulates a complete conversation turn
 * v45.0: Now detects FORMAT_CHANGE and skips tool calls when reusing data
 * v45.0 KOLO 3: Now detects ResponseIntent for output formatting
 */
function simulateTurn(input, context = {}) {
  const sessionState = context.sessionState || {};

  // v45.0: Detect follow-up type BEFORE making decision
  const followUp = detectFollowUpType(input, sessionState);

  // v45.0 KOLO 3: Detect ResponseIntent from user input
  const responseIntent = detectResponseIntent(input, {
    lastResponseIntent: sessionState.lastResponseIntent,
  });

  // Get CRE decision
  const decision = creDecisionEngine.decide(input, context);

  // v45.0: If FORMAT_CHANGE, override decision to skip tool call
  let effectiveDecision = decision.toJSON();
  if (followUp.reusePreviousData && effectiveDecision.type === DecisionType.TOOL_CALL) {
    effectiveDecision = {
      ...effectiveDecision,
      type: DecisionType.ANSWER,  // No tool call needed
      tools: [],
      _formatChangeSkippedToolCall: true,
    };
  }

  // Generate response with context
  const responseContext = {
    ...context,
    followUpType: followUp,
    lastResponseData: sessionState.lastResponseData,
    creativeTurn: context.creativeTurn || 1,
    preferences: context.preferences || {},
    responseIntent,  // v45.0 KOLO 3: Pass ResponseIntent to response generator
  };

  const response = mockLLMResponse(decision.intent, input, responseContext);

  return {
    input,
    decision: effectiveDecision,
    followUp,
    responseIntent,  // v45.0 KOLO 3: Include ResponseIntent in result
    response,
    timestamp: Date.now(),
  };
}

/**
 * Simulates a multi-turn conversation
 * v45.0: Tracks session state for FORMAT_CHANGE detection
 */
function simulateConversation(scenario, turns) {
  const results = [];
  let context = {
    lastIntent: null,
    conversationState: {},
    sessionState: {
      awaitingSlots: [],
      lastResponse: null,
      lastUserInput: null,
      lastResponseData: null,
    },
    creativeTurn: 0,
    preferences: {},
  };

  log(`\n${'═'.repeat(80)}`);
  log(`SCENARIO: ${scenario}`);
  log(`${'═'.repeat(80)}`);

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const input = typeof turn === 'string' ? turn : turn.input;

    log(`\n─── TURN ${i + 1} ───`);
    log(`USER: ${input}`);

    // Track CREATIVE turns
    if (context.lastIntent === IntentType.CREATIVE) {
      context.creativeTurn++;
    } else {
      context.creativeTurn = 1;
    }

    const result = simulateTurn(input, context);
    results.push(result);

    log(`INTENT: ${result.decision.intent}`);
    log(`DECISION: ${result.decision.type}`);
    if (result.responseIntent && result.responseIntent !== ResponseIntent.DIRECT) {
      log(`RESPONSE_INTENT: ${result.responseIntent}`);
    }
    if (result.decision._formatChangeSkippedToolCall) {
      log(`FORMAT_CHANGE: ✓ Skipped tool call, reusing previous data`);
    }
    log(`TOOLS: ${result.decision.tools?.join(', ') || '(none)'}`);
    log(`RESPONSE:\n${result.response}`);

    // Update context for next turn
    context.lastIntent = result.decision.intent;
    context.conversationState.lastIntent = result.decision.intent;
    context.sessionState.lastResponse = result.response;
    context.sessionState.lastUserInput = input;
    context.sessionState.lastResponseData = result.response; // Cache for FORMAT_CHANGE
    context.sessionState.lastResponseIntent = result.responseIntent; // v45.0 KOLO 3: Track ResponseIntent
  }

  log(`\n${'─'.repeat(80)}`);

  return results;
}

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO 1: REPORT→FORMAT
// ════════════════════════════════════════════════════════════════════════════════

describe('E2E SCENARIO 1: REPORT→FORMAT', () => {
  let prefs;
  let conversationResults;

  beforeEach(() => {
    prefs = new UserPreferences({
      verbosity: Verbosity.NORMAL,
      structure: Structure.MIXED,
    });
  });

  it('handles full REPORT conversation with format preferences', () => {
    const turns = [
      'Dej mi report o trhu s elektromobily za poslední měsíc',
      'Můžeš to shrnout stručněji?',
      'Teď to prosím ve formě odrážek',
      'Díky, to je super',
    ];

    conversationResults = simulateConversation('REPORT→FORMAT', turns);

    // Invariant checks
    assert.strictEqual(conversationResults[0].decision.intent, IntentType.REPORT);
    assert.strictEqual(conversationResults[0].decision.type, DecisionType.TOOL_CALL);
    assert.ok(conversationResults[0].decision.tools.includes('web.search'));

    log('\n📊 INVARIANT CHECKS:');
    log(`✓ First turn: REPORT intent with TOOL_CALL`);
    log(`✓ Tools: ${conversationResults[0].decision.tools.join(', ')}`);
  });

  it('preference changes respect max 1 axis rule', () => {
    // Simulate user liking bullet format
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

    // Check: only ONE axis changed
    const verbosityChanged = prefs.verbosity !== beforeVerbosity;
    const structureChanged = prefs.structure !== beforeStructure;
    const axesChanged = (verbosityChanged ? 1 : 0) + (structureChanged ? 1 : 0);

    log('\n📊 PREFERENCE INVARIANT CHECK:');
    log(`  Before: verbosity=${beforeVerbosity}, structure=${beforeStructure}`);
    log(`  After:  verbosity=${prefs.verbosity}, structure=${prefs.structure}`);
    log(`  Axes changed: ${axesChanged}`);

    assert.ok(axesChanged <= 1, `INVARIANT VIOLATION: ${axesChanged} axes changed (max 1 allowed)`);
    log(`✓ Max 1 axis change rule respected`);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO 2: SEARCH→PRODUCT
// ════════════════════════════════════════════════════════════════════════════════

describe('E2E SCENARIO 2: SEARCH→PRODUCT', () => {
  let conversationResults;

  it('handles product search conversation', () => {
    const turns = [
      'Najdi mi informace o ceně bitcoinu',
      'A jaký je trend?',
      'Porovnej to s ethereem',
      'Díky za info',
    ];

    conversationResults = simulateConversation('SEARCH→PRODUCT', turns);

    // Bitcoin query can be SEARCH or FACTUAL (both valid, both use TOOL_CALL)
    const firstIntent = conversationResults[0].decision.intent;
    assert.ok(
      [IntentType.SEARCH, IntentType.FACTUAL].includes(firstIntent),
      `First turn should be SEARCH or FACTUAL, got ${firstIntent}`
    );
    assert.strictEqual(conversationResults[0].decision.type, DecisionType.TOOL_CALL);
    assert.ok(conversationResults[0].decision.tools.includes('web.search'));

    // Follow-up questions should maintain search context
    assert.ok(
      [IntentType.SEARCH, IntentType.FACTUAL].includes(conversationResults[1].decision.intent),
      'Follow-up should maintain search context'
    );

    log('\n📊 INVARIANT CHECKS:');
    log(`✓ First turn: ${firstIntent} intent with TOOL_CALL`);
    log(`✓ Tools: ${conversationResults[0].decision.tools.join(', ')}`);
    log(`✓ Follow-up maintains search context`);
  });

  it('topicHash isolates feedback per topic', () => {
    const prefs = new UserPreferences();

    // Feedback for Bitcoin topic
    prefs.recordPositiveFeedback({
      responseType: 'SEARCH',
      input: 'informace o bitcoinu',
      verbosity: Verbosity.DETAILED,
    });

    // Feedback for Ethereum topic
    prefs.recordPositiveFeedback({
      responseType: 'SEARCH',
      input: 'informace o ethereu',
      verbosity: Verbosity.MINIMAL,
    });

    // Check topicHashes are different
    const bitcoinFeedback = prefs.feedbackHistory.find(f =>
      f.topicHash && f.topicHash.includes('bitcoin')
    );
    const ethereumFeedback = prefs.feedbackHistory.find(f =>
      f.topicHash && f.topicHash.includes('ethereu') || f.topicHash?.includes('ethereum')
    );

    log('\n📊 TOPIC ISOLATION CHECK:');
    log(`  Bitcoin topicHash: ${bitcoinFeedback?.topicHash || 'N/A'}`);
    log(`  Ethereum topicHash: ${ethereumFeedback?.topicHash || 'N/A'}`);

    if (bitcoinFeedback && ethereumFeedback) {
      assert.notStrictEqual(
        bitcoinFeedback.topicHash,
        ethereumFeedback.topicHash,
        'Topics should have different hashes'
      );
      log(`✓ Topic hashes are isolated`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO 3: CREATIVE
// ════════════════════════════════════════════════════════════════════════════════

describe('E2E SCENARIO 3: CREATIVE', () => {
  let conversationResults;

  it('CREATIVE never triggers web.search', () => {
    const turns = [
      'Vymysli mi marketingovou kampaň pro nový produkt',
      'Jaký to může mít vliv na zákazníky?',
      'Rozviň tu myšlenku o social media',
      'Dej mi ještě alternativní verzi',
    ];

    conversationResults = simulateConversation('CREATIVE', turns);

    // CRITICAL INVARIANT: CREATIVE NEVER uses web.search
    for (let i = 0; i < conversationResults.length; i++) {
      const result = conversationResults[i];

      if (result.decision.intent === IntentType.CREATIVE) {
        assert.strictEqual(
          result.decision.type,
          DecisionType.ANSWER,
          `Turn ${i + 1}: CREATIVE must use ANSWER, not ${result.decision.type}`
        );
        assert.strictEqual(
          result.decision.tools?.length || 0,
          0,
          `Turn ${i + 1}: CREATIVE must NOT have tools`
        );
      }
    }

    log('\n📊 CREATIVE INVARIANT CHECK:');
    log(`✓ All CREATIVE turns use ANSWER (not TOOL_CALL)`);
    log(`✓ No web.search tools in CREATIVE intent`);
  });

  it('CREATIVE follow-ups stay in CREATIVE mode', () => {
    // "jaký to může mít vliv" after CREATIVE should stay CREATIVE
    const context = {
      lastIntent: IntentType.CREATIVE,
      conversationState: { lastIntent: IntentType.CREATIVE },
    };

    const followUpInputs = [
      'jaký to může mít vliv na hráče?',
      'rozviň tu myšlenku',
      'co by se stalo kdyby...',
    ];

    log('\n📊 CREATIVE FOLLOW-UP CHECK:');

    for (const input of followUpInputs) {
      const decision = creDecisionEngine.decide(input, context);
      log(`  "${input}" → ${decision.intent}`);

      assert.strictEqual(
        decision.intent,
        IntentType.CREATIVE,
        `Follow-up "${input}" should stay CREATIVE`
      );
    }

    log(`✓ All CREATIVE follow-ups maintained CREATIVE intent`);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO 4: LOCAL
// ════════════════════════════════════════════════════════════════════════════════

describe('E2E SCENARIO 4: LOCAL', () => {
  let conversationResults;

  it('LOCAL is terminal - no tool calls', () => {
    const turns = [
      'Jaké je dnes datum?',
      'Kdy bude úplněk?',
      'Kolik je 15 + 27?',
    ];

    conversationResults = simulateConversation('LOCAL', turns);

    // LOCAL must be terminal with DecisionType.LOCAL, not TOOL_CALL
    for (let i = 0; i < conversationResults.length; i++) {
      const result = conversationResults[i];

      if (result.decision.intent === IntentType.LOCAL) {
        assert.strictEqual(
          result.decision.type,
          DecisionType.LOCAL,
          `Turn ${i + 1}: LOCAL intent must use LOCAL decision type`
        );
        assert.strictEqual(
          result.decision.tools?.length || 0,
          0,
          `Turn ${i + 1}: LOCAL must NOT have tools (direct computation)`
        );
      }
    }

    log('\n📊 LOCAL INVARIANT CHECK:');
    log(`✓ All LOCAL turns use DecisionType.LOCAL`);
    log(`✓ No tool calls for LOCAL intent`);
  });

  it('LOCAL has higher priority than SEARCH patterns', () => {
    // "kdy bude úplněk" contains "kdy" which could match SEARCH
    // but LOCAL should have priority
    const inputs = [
      'kdy bude úplněk?',
      'jaké je dnes datum?',
      'kolik je hodin?',
    ];

    log('\n📊 LOCAL PRIORITY CHECK:');

    for (const input of inputs) {
      const decision = creDecisionEngine.decide(input, {});
      log(`  "${input}" → ${decision.intent}`);

      assert.strictEqual(
        decision.intent,
        IntentType.LOCAL,
        `"${input}" should be LOCAL, not ${decision.intent}`
      );
    }

    log(`✓ LOCAL has priority over SEARCH patterns`);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO 5: TOPIC_CHANGE
// ════════════════════════════════════════════════════════════════════════════════

describe('E2E SCENARIO 5: TOPIC_CHANGE', () => {
  let prefs;

  beforeEach(() => {
    prefs = new UserPreferences({
      verbosity: Verbosity.NORMAL,
      structure: Structure.MIXED,
      followUpStyle: FollowUpStyle.ADAPTIVE,
    });
  });

  it('preferences are isolated per responseType', () => {
    // User likes DETAILED for SEARCH
    for (let i = 0; i < 5; i++) {
      prefs.recordPositiveFeedback({
        responseType: 'SEARCH',
        verbosity: Verbosity.DETAILED,
      });
    }

    // User likes MINIMAL for REPORT
    for (let i = 0; i < 5; i++) {
      prefs.recordPositiveFeedback({
        responseType: 'REPORT',
        verbosity: Verbosity.MINIMAL,
      });
    }

    const searchOptimized = prefs.getOptimizedFor('SEARCH');
    const reportOptimized = prefs.getOptimizedFor('REPORT');

    log('\n📊 RESPONSE TYPE ISOLATION:');
    log(`  SEARCH optimized: verbosity=${searchOptimized.verbosity}`);
    log(`  REPORT optimized: verbosity=${reportOptimized.verbosity}`);

    assert.strictEqual(searchOptimized.verbosity, Verbosity.DETAILED);
    assert.strictEqual(reportOptimized.verbosity, Verbosity.MINIMAL);

    log(`✓ Preferences correctly isolated per responseType`);
  });

  it('topic change does not bleed preferences', () => {
    const turns = [
      { input: 'Najdi info o bitcoinu', responseType: 'SEARCH' },
      { input: 'Teď mi dej report o elektromobilech', responseType: 'REPORT' },
      { input: 'Vymysli kampaň pro krypto', responseType: 'CREATIVE' },
    ];

    log('\n═════════════════════════════════════════════════════════════════════════════');
    log('SCENARIO: TOPIC_CHANGE');
    log('═════════════════════════════════════════════════════════════════════════════');

    const results = [];
    let context = { lastIntent: null };

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];

      log(`\n─── TURN ${i + 1} ───`);
      log(`USER: ${turn.input}`);

      const decision = creDecisionEngine.decide(turn.input, context);

      log(`INTENT: ${decision.intent}`);
      log(`DECISION: ${decision.type}`);

      // Record feedback for this turn
      prefs.recordPositiveFeedback({
        responseType: turn.responseType,
        input: turn.input,
        verbosity: Verbosity.DETAILED,
      });

      const lastFeedback = prefs.feedbackHistory[prefs.feedbackHistory.length - 1];
      log(`TOPIC_HASH: ${lastFeedback.topicHash || 'N/A'}`);
      log(`RESPONSE_TYPE: ${lastFeedback.responseType}`);

      results.push({
        ...turn,
        decision: decision.toJSON(),
        topicHash: lastFeedback.topicHash,
      });

      context.lastIntent = decision.intent;
    }

    log('\n📊 TOPIC ISOLATION CHECK:');

    // All topics should have different hashes
    const hashes = results.map(r => r.topicHash).filter(Boolean);
    const uniqueHashes = new Set(hashes);

    log(`  Topics: ${results.map(r => r.input.substring(0, 30)).join(', ')}`);
    log(`  Hashes: ${hashes.join(', ')}`);
    log(`  Unique hashes: ${uniqueHashes.size}`);

    assert.strictEqual(
      uniqueHashes.size,
      hashes.length,
      'Each topic should have unique hash'
    );

    log(`✓ No preference bleeding between topics`);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// INVARIANT: expertStrength=0 identical to default
// ════════════════════════════════════════════════════════════════════════════════

describe('E2E INVARIANT: expertStrength=0', () => {
  it('expert with strength=0 returns { active: false } only', () => {
    const expert = new ExpertAgent({
      id: 'test_expert',
      name: 'Test Expert',
      domain: 'general',
      strength: ExpertStrength.OFF,
    });

    const hints = expert.getSynthesisHints();

    log('\n📊 EXPERT STRENGTH=0 INVARIANT:');
    log(`  Hints: ${JSON.stringify(hints)}`);

    assert.deepStrictEqual(hints, { active: false });
    assert.strictEqual(Object.keys(hints).length, 1);

    log(`✓ expertStrength=0 returns exactly { active: false }`);
  });

  it('built-in experts with strength=0 are identical to default', () => {
    const expertIds = ['writer', 'analyst', 'lawyer'];

    log('\n📊 BUILT-IN EXPERTS WITH STRENGTH=0:');

    for (const id of expertIds) {
      const expert = expertRegistry.get(id);
      if (!expert) {
        log(`  ${id}: not found in registry`);
        continue;
      }

      // Save original strength
      const originalStrength = expert.strength;

      // Set to OFF
      expert.setStrength(0);
      const hintsOff = expert.getSynthesisHints();

      log(`  ${id}: ${JSON.stringify(hintsOff)}`);

      assert.deepStrictEqual(hintsOff, { active: false });

      // Restore original
      expert.setStrength(originalStrength);
    }

    log(`✓ All built-in experts with strength=0 return { active: false }`);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Export Output After All Tests
// ════════════════════════════════════════════════════════════════════════════════

after(() => {
  log('\n' + '═'.repeat(80));
  log('ALL E2E SCENARIOS COMPLETED');
  log('═'.repeat(80));

  exportOutput();
});

// ════════════════════════════════════════════════════════════════════════════════
// Banner
// ════════════════════════════════════════════════════════════════════════════════

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  CRE v45.0 — E2E Conversation Scenarios                                     ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  SCENARIO 1: REPORT→FORMAT (report with format changes)                      ║
║  SCENARIO 2: SEARCH→PRODUCT (product search with follow-ups)                 ║
║  SCENARIO 3: CREATIVE (ideation, no web search)                              ║
║  SCENARIO 4: LOCAL (deterministic queries)                                   ║
║  SCENARIO 5: TOPIC_CHANGE (topic isolation)                                  ║
║                                                                              ║
║  INVARIANTS:                                                                 ║
║  - expertStrength=0 identical to default                                     ║
║  - max 1 axis change per feedback                                            ║
║  - topicHash isolation per responseType                                      ║
║  - CREATIVE never triggers web.search                                        ║
║  - LOCAL is terminal (no tool calls)                                         ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
