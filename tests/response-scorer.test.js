// tests/response-scorer.test.js — Response Scorer Unit Tests
import { suite, test, assert, assertEqual, summary } from './harness.js';
import {
  scoreResponse,
  buildScoreRetryPrompt,
  scoreRelevance,
  scoreCompleteness,
  scoreCoherence,
  scoreIntentAlignment,
  scoreLanguageQuality,
  extractKeywords,
  DIMENSION_WEIGHTS,
  INTENT_LENGTH_EXPECTATIONS,
} from '../src/chat/quality/response-scorer.js';

// ═══════════════════════════════════════════════════════════════════════════
// Dimension 1: RELEVANCE
// ═══════════════════════════════════════════════════════════════════════════
suite('Response Scorer — Relevance');

test('high relevance: response addresses query keywords', () => {
  const score = scoreRelevance(
    'Docker je kontejnerová platforma pro izolaci aplikací. Používá kontejnery pro deploy.',
    'Co je Docker?',
  );
  assert(score >= 0.5, `expected >=0.5, got ${score}`);
});

test('low relevance: response off-topic', () => {
  const score = scoreRelevance(
    'Dobrý den, jak se máte? Dnes je krásný den na procházku.',
    'Co je Docker?',
  );
  assert(score < 0.4, `expected <0.4, got ${score}`);
});

test('empty query returns neutral', () => {
  const score = scoreRelevance('Nějaká odpověď.', '');
  assertEqual(score, 0.5);
});

test('empty response returns 0', () => {
  const score = scoreRelevance('', 'Co je Docker?');
  assertEqual(score, 0);
});

test('stem matching works for Czech morphology', () => {
  const score = scoreRelevance(
    'Rekurzivní funkce volá sama sebe s menším podproblémem.',
    'Vysvětli rekurzi v programování',
  );
  assert(score >= 0.3, `stem match should work for rekurz*, got ${score}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// Dimension 2: COMPLETENESS
// ═══════════════════════════════════════════════════════════════════════════
suite('Response Scorer — Completeness');

test('too short for CODE intent', () => {
  const score = scoreCompleteness('ok', 'CODE');
  assert(score < 0.3, `2 chars for CODE should be low, got ${score}`);
});

test('ideal length for CONVERSATIONAL', () => {
  const response = 'A'.repeat(150);
  const score = scoreCompleteness(response, 'CONVERSATIONAL');
  assert(score >= 0.8, `150 chars for CONVERSATIONAL should be near ideal, got ${score}`);
});

test('overly long for LOCAL', () => {
  const response = 'A'.repeat(2000);
  const score = scoreCompleteness(response, 'LOCAL');
  assert(score < 0.8, `2000 chars for LOCAL should be penalized, got ${score}`);
});

test('ideal CODE response', () => {
  const response = 'A'.repeat(300);
  const score = scoreCompleteness(response, 'CODE');
  assert(score >= 0.9, `300 chars for CODE should be ideal, got ${score}`);
});

test('unknown intent uses default', () => {
  const response = 'A'.repeat(200);
  const score = scoreCompleteness(response, 'UNKNOWN_INTENT');
  assert(score >= 0.5, `200 chars for unknown should be okay, got ${score}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// Dimension 3: COHERENCE
// ═══════════════════════════════════════════════════════════════════════════
suite('Response Scorer — Coherence');

test('structured response scores higher', () => {
  const structured = `# Docker\n\nDocker je platforma pro kontejnerizaci.\n\n- Izolace aplikací\n- Snadný deploy\n- Reprodukovatelnost`;
  const flat = 'Docker je platforma pro kontejnerizaci izolace aplikací snadný deploy reprodukovatelnost.';
  const s1 = scoreCoherence(structured);
  const s2 = scoreCoherence(flat);
  assert(s1 > s2, `structured (${s1}) should score higher than flat (${s2})`);
});

test('empty response scores 0', () => {
  assertEqual(scoreCoherence(''), 0);
});

test('code blocks boost coherence', () => {
  const withCode = 'Zde je příklad:\n\n```python\ndef hello():\n    print("Hello")\n```\n\nToto vytiskne Hello.';
  const score = scoreCoherence(withCode);
  assert(score >= 0.5, `code blocks should boost coherence, got ${score}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// Dimension 4: INTENT ALIGNMENT
// ═══════════════════════════════════════════════════════════════════════════
suite('Response Scorer — Intent Alignment');

test('CODE response with code block scores high', () => {
  const score = scoreIntentAlignment('```python\ndef fib(n):\n    return n if n < 2 else fib(n-1) + fib(n-2)\n```', 'CODE');
  assert(score >= 0.8, `CODE with code block should score high, got ${score}`);
});

test('CODE response without code scores low', () => {
  const score = scoreIntentAlignment('Fibonacci je matematická posloupnost čísle.', 'CODE');
  assert(score <= 0.4, `CODE without code should score low, got ${score}`);
});

test('SEARCH response with URLs scores high', () => {
  const score = scoreIntentAlignment('Docker je... Zdroje: https://docker.com https://docs.docker.com', 'SEARCH');
  assert(score >= 0.8, `SEARCH with 2 URLs should score high, got ${score}`);
});

test('SEARCH response without URLs scores low', () => {
  const score = scoreIntentAlignment('Docker je kontejnerová platforma.', 'SEARCH');
  assert(score <= 0.4, `SEARCH without URLs should score low, got ${score}`);
});

test('CONVERSATIONAL scores reasonably for any text', () => {
  const score = scoreIntentAlignment('Ahoj! Jak ti mohu pomoci?', 'CONVERSATIONAL');
  assert(score >= 0.6, `CONVERSATIONAL should accept any text, got ${score}`);
});

test('CREATIVE response without URLs scores high', () => {
  const response = 'Byl jednou jeden robot, který snil o hvězdách. Každou noc pozoroval oblohu a přemýšlel o smyslu své existence.';
  const score = scoreIntentAlignment(response, 'CREATIVE');
  assert(score >= 0.7, `CREATIVE without URLs should score high, got ${score}`);
});

test('DESIGN response with structure scores high', () => {
  const response = '# Architektura\n\n## Vrstvy\n- Controller\n- Service\n- Repository';
  const score = scoreIntentAlignment(response, 'DESIGN');
  assert(score >= 0.8, `DESIGN with structure should score high, got ${score}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// Dimension 5: LANGUAGE QUALITY
// ═══════════════════════════════════════════════════════════════════════════
suite('Response Scorer — Language Quality');

test('good Czech with diacritics scores high', () => {
  const score = scoreLanguageQuality(
    'Rekurzivní funkce je taková, která volá sama sebe. Příkladem je výpočet faktoriálu.',
    'cs',
  );
  assert(score >= 0.7, `good Czech should score high, got ${score}`);
});

test('text without diacritics scores lower', () => {
  const score = scoreLanguageQuality(
    'Rekurzivni funkce je takova, ktera vola sama sebe. Prikladem je vypocet faktorialu.',
    'cs',
  );
  assert(score < 0.7, `missing diacritics should score lower, got ${score}`);
});

test('Slovak contamination penalized', () => {
  const score = scoreLanguageQuality(
    'Potrebujete používať ďalšie stránky pre vyhľadávanie.',
    'cs',
  );
  assert(score < 0.5, `Slovak text should score low, got ${score}`);
});

test('English target is lenient', () => {
  const score = scoreLanguageQuality('This is a response in English.', 'en');
  assert(score >= 0.7, `English should be lenient, got ${score}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// COMPOSITE SCORER
// ═══════════════════════════════════════════════════════════════════════════
suite('Response Scorer — Composite');

test('good CODE response scores >=60', () => {
  const result = scoreResponse(
    '```python\ndef factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n```\n\nTato funkce vypočítá faktoriál čísla n pomocí rekurze.',
    { query: 'Napiš funkci pro faktoriál v Pythonu', intent: 'CODE', lang: 'cs' },
  );
  assert(result.total >= 60, `good CODE response should score >=60, got ${result.total}`);
  assert(result.issues.length === 0, `should have no issues, got: ${result.issues.join(', ')}`);
});

test('poor response scores <60', () => {
  const result = scoreResponse('ok', {
    query: 'Vysvětli, jak funguje Docker a jeho architektura',
    intent: 'SEARCH',
    lang: 'cs',
  });
  assert(result.total < 60, `"ok" for SEARCH query should score <60, got ${result.total}`);
  assert(result.issues.length > 0, 'should have issues');
});

test('result has all required fields', () => {
  const result = scoreResponse('test', { query: 'q', intent: 'CONVERSATIONAL' });
  assert(typeof result.total === 'number', 'total should be number');
  assert(result.dimensions != null, 'dimensions should exist');
  assert(Array.isArray(result.issues), 'issues should be array');
  assert(Array.isArray(result.hints), 'hints should be array');
  assert(result.threshold != null, 'threshold should exist');
  assert(typeof result.threshold.retry === 'number', 'retry threshold');
  assert(typeof result.threshold.refinement === 'number', 'refinement threshold');
});

test('score range is 0-100', () => {
  // Very bad
  const low = scoreResponse('', { query: 'Velký dotaz', intent: 'REPORT' });
  assert(low.total >= 0, `score should be >=0, got ${low.total}`);

  // Very good
  const high = scoreResponse(
    '# Analýza\n\nDocker je kontejnerová platforma.\n\n## Výhody\n- Izolace\n- Deploy\n\nZdroje: https://docker.com https://docs.docker.com',
    { query: 'Co je Docker?', intent: 'SEARCH', lang: 'cs' },
  );
  assert(high.total <= 100, `score should be <=100, got ${high.total}`);
});

test('DIMENSION_WEIGHTS sum to 1.0', () => {
  const sum = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 1.0) < 0.001, `weights should sum to 1.0, got ${sum}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// RETRY PROMPT BUILDER
// ═══════════════════════════════════════════════════════════════════════════
suite('Response Scorer — Retry Prompt');

test('buildScoreRetryPrompt generates hints for low score', () => {
  const score = scoreResponse('ok', {
    query: 'Napiš bubblsort v Pythonu',
    intent: 'CODE',
    lang: 'cs',
  });
  const prompt = buildScoreRetryPrompt(score);
  assert(prompt.length > 0, 'should generate non-empty prompt');
  assert(prompt.includes('KVALITA'), 'should contain quality header');
});

test('buildScoreRetryPrompt returns empty for good score', () => {
  const score = {
    total: 85,
    hints: [],
    threshold: { retry: 60 },
  };
  const prompt = buildScoreRetryPrompt(score);
  assertEqual(prompt, '');
});

// ═══════════════════════════════════════════════════════════════════════════
// KEYWORD EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════
suite('Response Scorer — Keyword Extraction');

test('extracts meaningful words', () => {
  const kw = extractKeywords('Co je Docker a jak funguje?');
  assert(kw.includes('docker'), 'should extract docker');
  assert(kw.includes('funguje'), 'should extract funguje');
  assert(!kw.includes('je'), 'should exclude stop word "je"');
  assert(!kw.includes('co'), 'should exclude stop word "co"');
});

test('handles Czech diacritics', () => {
  const kw = extractKeywords('Vysvětli rekurzivní funkci');
  assert(kw.includes('vysvětli'), 'should handle ě');
  assert(kw.includes('rekurzivní'), 'should handle í');
});

test('empty string returns empty', () => {
  const kw = extractKeywords('');
  assertEqual(kw.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// INTENT LENGTH EXPECTATIONS
// ═══════════════════════════════════════════════════════════════════════════
suite('Response Scorer — Config');

test('all expected intents have length expectations', () => {
  const expectedIntents = ['SEARCH', 'REPORT', 'CODE', 'DESIGN', 'CREATIVE', 'CONVERSATIONAL', 'FACTUAL', 'LOCAL'];
  for (const intent of expectedIntents) {
    assert(INTENT_LENGTH_EXPECTATIONS[intent] != null, `${intent} should have length expectations`);
    assert(INTENT_LENGTH_EXPECTATIONS[intent].min < INTENT_LENGTH_EXPECTATIONS[intent].ideal,
      `${intent}: min < ideal`);
    assert(INTENT_LENGTH_EXPECTATIONS[intent].ideal < INTENT_LENGTH_EXPECTATIONS[intent].max,
      `${intent}: ideal < max`);
  }
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
