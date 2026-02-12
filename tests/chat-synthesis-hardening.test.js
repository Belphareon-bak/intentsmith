// C3-Agent v55.2 — Sprint 2 Tests: Synthesis Hardening
// ══════════════════════════════════════════════════════════════════════════════
//
// T8.1: D6 gate for ANSWER path
// T8.2: FACTUAL/SEARCH prompt hardening contracts
// T8.3: Creative gate enforcement (retry, not log)
// T8.4: Confidence-based response styling
//
// Spuštění: node --experimental-vm-modules tests/chat-synthesis-hardening.test.js
//
// ══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';

// ─── Test Infrastructure ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];
const pendingTests = [];

function describe(name, fn) {
  pendingTests.push(async () => {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`  ${name}`);
    console.log(`${'═'.repeat(70)}`);
    await fn();
  });
}

async function it(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
  }
}

// ─── Imports ─────────────────────────────────────────────────────────────────

import {
  enforceOutputContract,
  buildOutputGateRetryPrompt,
} from '../src/chat/handlers/utils/output-gate.js';

import {
  buildSynthesisSystemPrompt,
} from '../src/chat/handlers/utils/synthesis.js';

import {
  assertCreativeQuality,
} from '../src/chat/handlers/utils/quality.js';

import {
  getConfidenceSynthesisInstructions,
  calculateAnswerConfidence,
  ConfidenceLevel,
  validateConfidenceResponse,
} from '../src/chat/quality/confidence-scaling.js';


// ══════════════════════════════════════════════════════════════════════════════
// T8.1: D6 GATE FOR ANSWER PATH
// ══════════════════════════════════════════════════════════════════════════════

describe('T8.1: D6 Gate covers ANSWER path (not just TOOL_CALL)', () => {

  it('D6 gate detects zombie in CONVERSATIONAL intent', async () => {
    const verdict = enforceOutputContract(
      'Jako jazykový model nemám přístup k internetu.',
      { intent: 'CONVERSATIONAL' }
    );
    assert.ok(!verdict.ok, 'Should fail on zombie');
    assert.equal(verdict.failDimension, 'D6.1_ZOMBIE');
  });

  it('D6 gate passes good conversational response', async () => {
    const verdict = enforceOutputContract(
      'Ahoj! Jak ti mohu pomoct? Rád ti odpovím na jakýkoli dotaz o programování, technologiích, nebo třeba pomohu s nějakým projektem. Stačí říct, co potřebuješ.',
      { intent: 'CONVERSATIONAL' }
    );
    assert.ok(verdict.ok, `Should pass, got: ${verdict.reason}`);
  });

  it('D6 gate detects hollow filler in ANSWER path', async () => {
    const verdict = enforceOutputContract(
      'Rád ti pomůžu.',
      { intent: 'CONVERSATIONAL' }
    );
    // This should fail either as ZOMBIE (hollow filler) or LOW_CONTENT
    assert.ok(!verdict.ok, 'Should fail on hollow/short content');
  });

  it('D6 gate retry prompt builds correctly for CONVERSATIONAL', async () => {
    const verdict = enforceOutputContract(
      'Zde je moje odpověď na váš dotaz.',
      { intent: 'CONVERSATIONAL' }
    );
    assert.ok(!verdict.ok);
    const retryPrompt = buildOutputGateRetryPrompt('Jaké je počasí?', verdict);
    assert.ok(retryPrompt.length > 50, 'Retry prompt should be substantial');
    assert.ok(retryPrompt.includes('Jaké je počasí?'), 'Should preserve original prompt');
  });

  it('D6 gate catches capability denial in ANSWER path', async () => {
    const verdict = enforceOutputContract(
      'Nemohu vyhledávat na internetu, ale mohu ti říct obecné informace.',
      { intent: 'CONVERSATIONAL' }
    );
    assert.ok(!verdict.ok, 'Should fail on capability denial');
    assert.equal(verdict.failDimension, 'D6.1_ZOMBIE');
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// T8.2: FACTUAL / SEARCH PROMPT HARDENING
// ══════════════════════════════════════════════════════════════════════════════

describe('T8.2: FACTUAL / SEARCH prompt contracts', () => {

  it('SEARCH system prompt contains anti-meta-start rules', async () => {
    const prompt = buildSynthesisSystemPrompt('SEARCH', {});
    assert.ok(prompt.includes('Vyhledal jsem'), 'Should mention forbidden start "Vyhledal jsem"');
    assert.ok(prompt.includes('FIRST SENTENCE'), 'Should specify first sentence must be answer');
    assert.ok(prompt.includes('FORBIDDEN'), 'Should have forbidden section');
  });

  it('FACTUAL system prompt enforces concrete answer first', async () => {
    const prompt = buildSynthesisSystemPrompt('FACTUAL', {});
    assert.ok(prompt.includes('FIRST SENTENCE'), 'Should specify first sentence is the answer');
    assert.ok(prompt.includes('Maximum 3'), 'Should enforce brevity');
    assert.ok(prompt.includes('GOOD:') && prompt.includes('BAD:'), 'Should have positive/negative examples');
  });

  it('SEARCH prompt bans inline URLs in text', async () => {
    const prompt = buildSynthesisSystemPrompt('SEARCH', {});
    assert.ok(prompt.includes('footnote'), 'Should specify footnote format for sources');
  });

  it('FACTUAL prompt requires concrete datum', async () => {
    const prompt = buildSynthesisSystemPrompt('FACTUAL', {});
    assert.ok(prompt.includes('concrete') || prompt.includes('konkrétní') || prompt.includes('datum'),
      'Should require concrete data');
  });

  it('REPORT prompt requires at least 3 data points', async () => {
    const prompt = buildSynthesisSystemPrompt('REPORT', {});
    assert.ok(prompt.includes('3 concrete') || prompt.includes('3 konkrétní'),
      'Should require 3+ concrete data points');
  });

  it('ITEM_LOOKUP prompt requires clickable URLs per item', async () => {
    const prompt = buildSynthesisSystemPrompt('ITEM_LOOKUP', {});
    assert.ok(prompt.includes('clickable URL') || prompt.includes('🔗'),
      'Should require URLs per item');
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// T8.3: CREATIVE GATE ENFORCEMENT (RETRY, NOT LOG)
// ══════════════════════════════════════════════════════════════════════════════

describe('T8.3: Creative quality gate enforcement', () => {

  it('assertCreativeQuality rejects empty response', async () => {
    const result = assertCreativeQuality('', 'napiš báseň');
    assert.ok(!result.valid, 'Empty should fail');
    assert.ok(result.reason.toLowerCase().includes('empty'), `Should mention empty, got: ${result.reason}`);
  });

  it('assertCreativeQuality rejects too-short creative content', async () => {
    const result = assertCreativeQuality('Ok, tady je.', 'vymysli kampaň pro kavárnu');
    assert.ok(!result.valid, 'Too short should fail');
    assert.ok(result.reason.includes('too short') || result.reason.includes('short'),
      `Should mention short, got: ${result.reason}`);
  });

  it('assertCreativeQuality rejects input echo (short)', async () => {
    const input = 'napiš příběh o drakovi co zachraňuje princeznu';
    const result = assertCreativeQuality(
      'napiš příběh o drakovi co zachraňuje princeznu - to je zajímavý nápad',
      input
    );
    assert.ok(!result.valid, 'Should reject echo (caught as too short or echo)');
  });

  it('assertCreativeQuality passes substantive creative response', async () => {
    const response = `Kavárna "Zrnko Pravdy" — Marketingová kampaň

1. **Ranní rituál** — Sociální média série "Praha se probouzí"
   Fotografie lokálních zákazníků s their morning coffee, shot v golden hour.
   Rozpočet: 5000 Kč/měsíc na Instagram stories.

2. **Loyalty program "Kávový kompas"**
   Každá 7. káva zdarma, ale se speciálním twist — zákazník si vylosuje
   překvapení (extra shot, alternativní mléko, domácí dezert).

3. **Kolaborace s local businesses**
   Partnerství s knihkupectvím Neoluxor — kupón na kávu ke každému nákupu nad 500 Kč.`;

    const result = assertCreativeQuality(response, 'vymysli kampaň pro kavárnu');
    assert.ok(result.valid, `Should pass, got: ${result.reason}`);
  });

  it('assertCreativeQuality rejects empty markdown structure', async () => {
    // Must be >100 chars to pass length check, so skeleton check activates
    const result = assertCreativeQuality(
      '# Kampaň pro kavárnu Zrnko\n\n## Marketingové nápady\n\n### Fáze 1\n\n### Fáze 2\n\n### Fáze 3\n\n### Fáze 4\n\n### Závěr',
      'vymysli kampaň pro kavárnu'
    );
    assert.ok(!result.valid, 'Empty structure should fail');
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// T8.4: CONFIDENCE-BASED RESPONSE STYLING
// ══════════════════════════════════════════════════════════════════════════════

describe('T8.4: Confidence-based response styling', () => {

  it('HIGH confidence instructions say "formuluj přímo"', async () => {
    const instructions = getConfidenceSynthesisInstructions({
      level: ConfidenceLevel.HIGH,
      score: 0.9,
      factors: ['high_relevance', 'multiple_sources'],
    });
    assert.ok(instructions.includes('přímo') || instructions.includes('sebevědomě'),
      'HIGH should instruct direct/confident tone');
  });

  it('LOW confidence instructions use natural hedging', async () => {
    const instructions = getConfidenceSynthesisInstructions({
      level: ConfidenceLevel.LOW,
      score: 0.3,
      factors: ['low_relevance'],
    });
    assert.ok(instructions.includes('naznačují') || instructions.includes('Pravděpodobně') || instructions.includes('Nízká'),
      'LOW should suggest hedging');
    assert.ok(instructions.includes('NIKDY') || instructions.includes('ZAKÁZANÉ'),
      'Should include forbidden phrases reminder');
  });

  it('UNCERTAIN confidence acknowledges limited data', async () => {
    const instructions = getConfidenceSynthesisInstructions({
      level: ConfidenceLevel.UNCERTAIN,
      score: 0.15,
      factors: ['no_relevant_sources'],
    });
    assert.ok(instructions.includes('omezené') || instructions.includes('Velmi nízká'),
      'UNCERTAIN should acknowledge data limitations');
  });

  it('validateConfidenceResponse catches forbidden disclaimers', async () => {
    const result = validateConfidenceResponse(
      'Jako AI nemohu si být jistý, ale myslím, že Praha má asi milion obyvatel.'
    );
    assert.ok(!result.valid, 'Should catch forbidden disclaimer');
    assert.ok(result.violations.length >= 1, 'Should have at least 1 violation');
  });

  it('validateConfidenceResponse passes clean response', async () => {
    const result = validateConfidenceResponse(
      'Praha má přibližně 1,3 milionu obyvatel. Je to největší město České republiky.'
    );
    assert.ok(result.valid, `Should pass, violations: ${result.violations}`);
  });

  it('Confidence calculation returns structured result', async () => {
    const confidence = calculateAnswerConfidence(
      {
        relevant: [{ type: 'SEARCH', data: { results: [] } }],
        marginal: [],
        stats: { avgRelevantScore: 0.8, totalResults: 3, relevantCount: 2 },
      },
      [{ _sourceTrust: { trust: 'official' } }]
    );
    assert.ok(confidence.level, 'Should have level');
    assert.ok(typeof confidence.score === 'number', 'Should have numeric score');
    assert.ok(Array.isArray(confidence.factors), 'Should have factors array');
  });
});


// ══════════════════════════════════════════════════════════════════════════════
// RUN ALL TESTS
// ══════════════════════════════════════════════════════════════════════════════

for (const test of pendingTests) {
  await test();
}

console.log(`\n${'═'.repeat(70)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log(`${'═'.repeat(70)}`);

if (failures.length > 0) {
  console.log('\nFailed tests:');
  failures.forEach(f => console.log(`  ❌ ${f.name}: ${f.error}`));
}

process.exit(failed > 0 ? 1 : 0);
