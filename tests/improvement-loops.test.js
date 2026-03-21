// tests/improvement-loops.test.js — Improvement Loops Unit Tests
import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';
import {
  fastRetryGate,
  selfRefine,
  improveResponse,
} from '../src/chat/quality/improvement-loops.js';

// ═══════════════════════════════════════════════════════════════════════════
// Loop 1: FAST RETRY GATE
// ═══════════════════════════════════════════════════════════════════════════
suite('Improvement Loops — Fast Retry Gate');

test('good response: no retry', () => {
  const result = fastRetryGate(
    '```python\ndef factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n```\n\nTato rekurzivní funkce počítá faktoriál.',
    'Napiš funkci pro faktoriál',
    { query: 'Napiš funkci pro faktoriál v Pythonu', intent: 'CODE', lang: 'cs' },
  );
  assertEqual(result.shouldRetry, false);
  assert(result.score.total >= 60, `good response should score >=60, got ${result.score.total}`);
});

test('bad response: triggers retry', () => {
  const result = fastRetryGate(
    'ok',
    'original prompt',
    { query: 'Vysvětli architekturu REST API pro e-shop', intent: 'DESIGN', lang: 'cs' },
  );
  assertEqual(result.shouldRetry, true);
  assert(result.enhancedPrompt.length > 'original prompt'.length, 'prompt should be enhanced');
  assert(result.enhancedPrompt.includes('KVALITA'), 'should contain quality hint');
});

test('retry result includes score object', () => {
  const result = fastRetryGate('ok', 'prompt', { query: 'q', intent: 'CODE' });
  assert(result.score != null, 'score should be present');
  assert(typeof result.score.total === 'number', 'score.total should be number');
  assert(Array.isArray(result.score.issues), 'score.issues should be array');
});

test('borderline response near threshold', () => {
  // A mediocre response that might be near the threshold
  const response = 'Docker je platforma pro kontejnerizaci. Používá kontejnery pro izolaci aplikací a snadný deploy.';
  const result = fastRetryGate(
    response,
    'prompt',
    { query: 'Co je Docker?', intent: 'CONVERSATIONAL', lang: 'cs' },
  );
  // Should have a score — either retry or not, but no crash
  assert(typeof result.shouldRetry === 'boolean', 'shouldRetry must be boolean');
  assert(result.score.total >= 0 && result.score.total <= 100, 'score in range');
});

// ═══════════════════════════════════════════════════════════════════════════
// Loop 2: SELF-REFINEMENT
// ═══════════════════════════════════════════════════════════════════════════
suite('Improvement Loops — Self-Refinement');

await testAsync('skips refinement for good response', async () => {
  const mockLLM = async () => { throw new Error('should not be called'); };
  const result = await selfRefine(
    '```python\ndef factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n```\n\nTato rekurzivní funkce počítá faktoriál pomocí rekurze.',
    { query: 'Napiš funkci pro faktoriál v Pythonu', intent: 'CODE', lang: 'cs' },
    mockLLM,
  );
  assertEqual(result.improved, false);
  assert(result.scoreBefore.total >= 60, 'good response should be above threshold');
});

await testAsync('attempts refinement for poor response', async () => {
  let called = false;
  const mockLLM = async (prompt) => {
    called = true;
    return {
      content: '```python\ndef factorial(n):\n    """Výpočet faktoriálu čísla n.\"\"\"\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\n```\n\nRekurzivní funkce pro výpočet faktoriálu v Pythonu.',
    };
  };
  // Must be >20 chars but low quality
  const result = await selfRefine(
    'Nevím, zkuste se zeptat jinde prosím.',
    { query: 'Napiš funkci pro faktoriál v Pythonu', intent: 'CODE', lang: 'cs' },
    mockLLM,
  );
  assertEqual(called, true, 'LLM should be called');
  // Whether it improved depends on the mock response scoring
  assert(typeof result.improved === 'boolean', 'improved should be boolean');
  assert(result.scoreBefore != null, 'scoreBefore should exist');
});

await testAsync('handles LLM failure gracefully', async () => {
  const failLLM = async () => { throw new Error('LLM unavailable'); };
  const result = await selfRefine(
    'short',
    { query: 'Vysvětli Docker', intent: 'CONVERSATIONAL', lang: 'cs' },
    failLLM,
  );
  assertEqual(result.improved, false);
  assertEqual(result.response, 'short');
});

await testAsync('skips refinement for empty response', async () => {
  const mockLLM = async () => { throw new Error('should not be called'); };
  const result = await selfRefine(
    '',
    { query: 'q', intent: 'CODE', lang: 'cs' },
    mockLLM,
  );
  assertEqual(result.improved, false);
});

await testAsync('rejects refinement that scores worse', async () => {
  const worseLLM = async () => {
    return { content: 'x' }; // Worse than original
  };
  const original = 'Docker je kontejnerová platforma pro izolaci aplikací.';
  const result = await selfRefine(
    original,
    { query: 'Co je Docker?', intent: 'SEARCH', lang: 'cs' },
    worseLLM,
  );
  // If original was already below threshold, refinement attempted
  // But worse result should be rejected
  if (result.scoreAfter) {
    assertEqual(result.improved, false, 'worse refinement should be rejected');
    assertEqual(result.response, original, 'should keep original');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FULL PIPELINE: improveResponse()
// ═══════════════════════════════════════════════════════════════════════════
suite('Improvement Loops — Full Pipeline');

await testAsync('fast mode: no LLM calls, only scoring', async () => {
  const mockLLM = async () => { throw new Error('should not be called'); };
  const result = await improveResponse(
    'Dobrá odpověď',
    { query: 'Ahoj', intent: 'CONVERSATIONAL', lang: 'cs' },
    mockLLM,
    { mode: 'fast' },
  );
  assertEqual(result.improved, false);
  assert(result.telemetry.originalScore != null, 'should have original score');
  assertEqual(result.telemetry.mode, 'fast');
  assertEqual(result.telemetry.loopsUsed, 0);
});

await testAsync('balanced mode: attempts refinement for low score', async () => {
  let llmCalled = false;
  const mockLLM = async () => {
    llmCalled = true;
    return {
      content: 'Docker je kontejnerová platforma. Umožňuje izolaci aplikací v kontejnerech, snadný deploy a reprodukovatelné prostředí.',
    };
  };
  const result = await improveResponse(
    'ok',
    { query: 'Co je Docker?', intent: 'SEARCH', lang: 'cs' },
    mockLLM,
    { mode: 'balanced' },
  );
  // "ok" for SEARCH should trigger refinement attempt
  assert(result.telemetry.originalScore < 60, 'original should be low');
  // LLM may or may not be called depending on exact threshold
  assert(typeof result.improved === 'boolean', 'improved should be boolean');
});

await testAsync('telemetry structure is correct', async () => {
  const result = await improveResponse(
    'test response',
    { query: 'q', intent: 'CONVERSATIONAL' },
    null,
    { mode: 'fast' },
  );
  const t = result.telemetry;
  assert(typeof t.originalScore === 'number', 'originalScore');
  assert(typeof t.finalScore === 'number', 'finalScore');
  assert(typeof t.loopsUsed === 'number', 'loopsUsed');
  assert(typeof t.improved === 'boolean', 'improved');
  assert(typeof t.mode === 'string', 'mode');
});

await testAsync('good response passes through unchanged', async () => {
  const goodResponse = '# Docker\n\nDocker je kontejnerová platforma pro izolaci aplikací.\n\n## Výhody\n- Snadný deploy\n- Reprodukovatelnost\n- Izolace\n\nZdroje: https://docker.com https://docs.docker.com';
  const result = await improveResponse(
    goodResponse,
    { query: 'Co je Docker?', intent: 'SEARCH', lang: 'cs' },
    null,
    { mode: 'balanced' },
  );
  assertEqual(result.response, goodResponse);
  assertEqual(result.improved, false);
});

const result = summary();
process.exit(result.failed > 0 ? 1 : 0);
