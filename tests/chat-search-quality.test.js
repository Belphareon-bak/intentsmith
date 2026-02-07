// C3-Agent v55.2 — Sprint 1 Tests: Search Quality & Language Detection
// ══════════════════════════════════════════════════════════════════════════════
//
// T7: Web Search Quality Tests
//   T7.1: Search result quality scoring
//   T7.2: Scrape content quality detection
//   T7.3: Usefulness metrics tracking
//
// T8.3: Language Detection & Prompt Injection
//   T8.3.1: Czech detection
//   T8.3.2: English detection
//   T8.3.3: Ambiguous / unknown
//   T8.3.4: Prompt instruction generation
//   T8.3.5: Integration with synthesis prompt
//
// Spuštění: node --experimental-vm-modules tests/chat-search-quality.test.js
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
  scoreResult,
  scoreSearchResults,
  scoreScrapeContent,
  searchMetrics,
} from '../src/chat/handlers/utils/search-metrics.js';

import {
  detectLanguage,
  buildLanguageInstruction,
  getLanguageContext,
} from '../src/chat/handlers/utils/language.js';

import {
  buildSynthesisSystemPrompt,
} from '../src/chat/handlers/utils/synthesis.js';

// ══════════════════════════════════════════════════════════════════════════════
// T7: WEB SEARCH QUALITY TESTS
// ══════════════════════════════════════════════════════════════════════════════

describe('T7.1: Search Result Quality Scoring', () => {

  it('Complete result (title + url + long snippet) scores ≥ 0.9', async () => {
    const score = scoreResult({
      title: 'Best restaurants in Prague',
      url: 'https://example.com/restaurants',
      snippet: 'Prague offers a wide variety of dining options from traditional Czech cuisine to modern fusion restaurants. Here are the top picks for 2024.',
    });
    assert.ok(score >= 0.9, `Expected ≥ 0.9, got ${score}`);
  });

  it('Result with short snippet scores 0.5-0.8', async () => {
    const score = scoreResult({
      title: 'Prague restaurants',
      url: 'https://example.com',
      snippet: 'Traditional Czech dining options.',
    });
    assert.ok(score >= 0.5 && score <= 0.8, `Expected 0.5-0.8, got ${score}`);
  });

  it('Result without snippet scores ≤ 0.5', async () => {
    const score = scoreResult({
      title: 'Prague guide',
      url: 'https://example.com',
      snippet: '',
    });
    assert.ok(score <= 0.5, `Expected ≤ 0.5, got ${score}`);
  });

  it('Empty result scores 0', async () => {
    const score = scoreResult({});
    assert.equal(score, 0);
  });

  it('Result set with 5 complete results grades GOOD', async () => {
    const results = Array.from({ length: 5 }, (_, i) => ({
      title: `Result ${i + 1} about Prague restaurants`,
      url: `https://example${i}.com/food`,
      snippet: 'Prague has many excellent restaurants offering traditional Czech cuisine including svíčková, knedlíky, and trdelník. Prices range from budget to fine dining.',
    }));
    const quality = scoreSearchResults(results, 'restaurace Praha');
    assert.equal(quality.grade, 'GOOD');
    assert.ok(quality.completeResults >= 3, `Expected ≥ 3 complete, got ${quality.completeResults}`);
  });

  it('Result set with all empty snippets grades POOR', async () => {
    const results = Array.from({ length: 3 }, (_, i) => ({
      title: `Result ${i}`,
      url: `https://example${i}.com`,
      snippet: '',
    }));
    const quality = scoreSearchResults(results, 'test query');
    assert.equal(quality.grade, 'POOR');
    assert.equal(quality.emptySnippets, 3);
  });

  it('Empty result set grades EMPTY', async () => {
    const quality = scoreSearchResults([], 'any query');
    assert.equal(quality.grade, 'EMPTY');
    assert.equal(quality.totalResults, 0);
  });

  it('Query relevance measures keyword overlap', async () => {
    const results = [
      { title: 'Praha restaurace', url: 'https://a.com', snippet: 'Nejlepší restaurace v Praze pro rok 2024' },
      { title: 'Brno hotely', url: 'https://b.com', snippet: 'Ubytování v Brně za rozumné ceny' },
      { title: 'Praha jídlo', url: 'https://c.com', snippet: 'Kde se najíst v Praze - průvodce' },
    ];
    const quality = scoreSearchResults(results, 'restaurace Praha');
    // 2 out of 3 results mention "praha" or "restaurace"
    assert.ok(quality.queryRelevance >= 0.5, `Expected relevance ≥ 0.5, got ${quality.queryRelevance}`);
  });
});

describe('T7.2: Scrape Content Quality Detection', () => {

  it('Long relevant content grades GOOD', async () => {
    const content = 'Praha je hlavní město České republiky s bohatou historií a kulturou. ' +
      'Město nabízí širokou škálu restaurací, od tradičních českých hospod po moderní fine dining. ' +
      'Mezi nejoblíbenější místa patří Staroměstské náměstí, Karlův most a Pražský hrad. ' +
      'Počet obyvatel přesahuje 1,3 milionu a město je jedním z nejnavštěvovanějších v Evropě.';
    const quality = scoreScrapeContent(content, 'Praha restaurace');
    assert.ok(quality.usable, 'Expected usable=true');
    assert.equal(quality.grade, 'GOOD');
  });

  it('Empty content detected as EMPTY', async () => {
    const quality = scoreScrapeContent('', 'test');
    assert.ok(!quality.usable, 'Expected usable=false');
    assert.equal(quality.reason, 'EMPTY_CONTENT');
  });

  it('Very short content detected as TOO_SHORT', async () => {
    const quality = scoreScrapeContent('Welcome to our site.', 'test');
    assert.ok(!quality.usable, 'Expected usable=false');
    assert.equal(quality.reason, 'TOO_SHORT');
  });

  it('Login wall detected (short content + login pattern)', async () => {
    const quality = scoreScrapeContent('Please log in to continue. Sign in required.', 'test');
    assert.ok(!quality.usable, 'Expected usable=false');
    assert.equal(quality.reason, 'LOGIN_WALL');
  });

  it('JavaScript required detected', async () => {
    const quality = scoreScrapeContent('Please enable JavaScript to use this application.', 'test');
    assert.ok(!quality.usable, 'Expected usable=false');
    assert.equal(quality.reason, 'JS_REQUIRED');
  });

  it('CAPTCHA detected', async () => {
    const quality = scoreScrapeContent('Please verify you are human. Complete the captcha below.', 'test');
    assert.ok(!quality.usable, 'Expected usable=false');
    assert.equal(quality.reason, 'CAPTCHA');
  });

  it('Long content with login mention is NOT blocked (mention in passing)', async () => {
    const longContent = 'x'.repeat(600) + ' Please log in to access premium features. ' + 'y'.repeat(600);
    const quality = scoreScrapeContent(longContent, 'test');
    // Long content with login mention = not blocked (it's in passing)
    assert.ok(quality.usable, 'Expected usable=true for long content with incidental login mention');
  });

  it('Content relevance measures keyword overlap', async () => {
    const content = 'Nejlepší restaurace v Praze nabízejí tradiční českou kuchyni. ' +
      'Praha je gastronomický ráj s desítkami vynikajících podniků. ' +
      'Od tradičních hospůdek po moderní restaurace s michelinskou hvězdou.';
    const quality = scoreScrapeContent(content, 'restaurace Praha');
    assert.ok(quality.usable, 'Expected usable=true');
    assert.ok(quality.relevance > 0, `Expected relevance > 0, got ${quality.relevance}`);
  });

  it('Irrelevant content has low relevance', async () => {
    const content = 'The weather forecast for London shows rain throughout the week with temperatures around 12 degrees celsius.';
    const quality = scoreScrapeContent(content, 'restaurace Praha');
    assert.equal(quality.relevance, 0, `Expected relevance 0 for irrelevant content, got ${quality.relevance}`);
  });
});

describe('T7.3: Usefulness Metrics Tracking', () => {

  it('Records and retrieves search events', async () => {
    searchMetrics.reset();

    searchMetrics.record({
      query: 'test query 1',
      provider: 'DuckDuckGo',
      resultCount: 5,
      resultGrade: 'GOOD',
      outcome: 'SUCCESS',
      latencyMs: 450,
    });

    searchMetrics.record({
      query: 'test query 2',
      provider: 'SearX',
      resultCount: 0,
      resultGrade: 'EMPTY',
      outcome: 'NO_RESULTS',
      latencyMs: 2000,
    });

    const metrics = searchMetrics.getMetrics();
    assert.equal(metrics.totalSearches, 2);
    assert.equal(metrics.successRate, 0.5);
    assert.equal(metrics.outcomeDistribution.SUCCESS, 1);
    assert.equal(metrics.outcomeDistribution.NO_RESULTS, 1);
  });

  it('getRecent returns latest events', async () => {
    const recent = searchMetrics.getRecent(5);
    assert.ok(recent.length >= 2, `Expected ≥ 2 events, got ${recent.length}`);
    assert.equal(recent[recent.length - 1].query, 'test query 2');
  });

  it('Grade distribution is tracked', async () => {
    const metrics = searchMetrics.getMetrics();
    assert.equal(metrics.gradeDistribution.GOOD, 1);
    assert.equal(metrics.gradeDistribution.EMPTY, 1);
  });

  it('Provider distribution is tracked', async () => {
    const metrics = searchMetrics.getMetrics();
    assert.equal(metrics.providerDistribution.DuckDuckGo, 1);
    assert.equal(metrics.providerDistribution.SearX, 1);
  });

  it('Reset clears all metrics', async () => {
    searchMetrics.reset();
    const metrics = searchMetrics.getMetrics();
    assert.equal(metrics.totalSearches, 0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T8.3: LANGUAGE DETECTION & PROMPT INJECTION
// ══════════════════════════════════════════════════════════════════════════════

describe('T8.3.1: Czech Detection', () => {

  it('Czech with diacritics → cs (high confidence)', async () => {
    const result = detectLanguage('Jaké jsou nejlepší restaurace v Praze?');
    assert.equal(result.language, 'cs');
    assert.ok(result.confidence >= 0.9, `Expected confidence ≥ 0.9, got ${result.confidence}`);
  });

  it('Czech without diacritics but Czech patterns → cs', async () => {
    const result = detectLanguage('co je to GraphQL a jak to funguje');
    assert.equal(result.language, 'cs');
    assert.ok(result.confidence >= 0.7, `Expected confidence ≥ 0.7, got ${result.confidence}`);
  });

  it('Czech greeting → cs', async () => {
    const result = detectLanguage('ahoj, jak se mas');
    assert.equal(result.language, 'cs');
  });

  it('"najdi na webu" → cs', async () => {
    const result = detectLanguage('najdi na webu informace o Praze');
    assert.equal(result.language, 'cs');
  });

  it('Czech with mixed but predominantly Czech → cs', async () => {
    const result = detectLanguage('jak se nastavi API key pro OpenAI');
    assert.equal(result.language, 'cs');
  });
});

describe('T8.3.2: English Detection', () => {

  it('Clear English → en', async () => {
    const result = detectLanguage('What are the best restaurants in Prague?');
    assert.equal(result.language, 'en');
    assert.ok(result.confidence >= 0.7, `Expected confidence ≥ 0.7, got ${result.confidence}`);
  });

  it('English greeting → en', async () => {
    const result = detectLanguage('Hello, how are you doing today?');
    assert.equal(result.language, 'en');
  });

  it('Technical English → en', async () => {
    const result = detectLanguage('Explain how the JavaScript event loop works');
    assert.equal(result.language, 'en');
  });
});

describe('T8.3.3: Ambiguous / Unknown', () => {

  it('Very short input → unknown', async () => {
    const result = detectLanguage('ok');
    assert.equal(result.language, 'unknown');
  });

  it('Empty input → unknown', async () => {
    const result = detectLanguage('');
    assert.equal(result.language, 'unknown');
  });

  it('Single word "test" → unknown', async () => {
    const result = detectLanguage('test');
    assert.equal(result.language, 'unknown');
  });

  it('Pure technical term → unknown', async () => {
    const result = detectLanguage('GraphQL');
    assert.equal(result.language, 'unknown');
  });
});

describe('T8.3.4: Prompt Instruction Generation', () => {

  it('Czech → contains ČESKY instruction', async () => {
    const instruction = buildLanguageInstruction('cs');
    assert.ok(instruction.includes('ČESKY'), 'Missing ČESKY in instruction');
    assert.ok(instruction.includes('PŘELOŽ'), 'Missing PŘELOŽ (translate) instruction');
  });

  it('English → contains ENGLISH instruction', async () => {
    const instruction = buildLanguageInstruction('en');
    assert.ok(instruction.includes('ENGLISH'), 'Missing ENGLISH in instruction');
  });

  it('Unknown → empty string (no enforcement)', async () => {
    const instruction = buildLanguageInstruction('unknown');
    assert.equal(instruction, '');
  });
});

describe('T8.3.5: getLanguageContext convenience', () => {

  it('Czech input → Czech context with instruction', async () => {
    const ctx = getLanguageContext('Jaké je počasí v Praze?');
    assert.equal(ctx.language, 'cs');
    assert.ok(ctx.instruction.length > 0, 'Expected non-empty instruction');
    assert.ok(ctx.instruction.includes('ČESKY'));
  });

  it('English input → English context with instruction', async () => {
    const ctx = getLanguageContext('What is the weather in Prague?');
    assert.equal(ctx.language, 'en');
    assert.ok(ctx.instruction.includes('ENGLISH'));
  });

  it('Unknown input → falls back to default (cs)', async () => {
    const ctx = getLanguageContext('ok', 'cs');
    assert.equal(ctx.language, 'cs');
    assert.ok(ctx.instruction.includes('ČESKY'));
  });

  it('Unknown input with en default → falls back to en', async () => {
    const ctx = getLanguageContext('ok', 'en');
    assert.equal(ctx.language, 'en');
    assert.ok(ctx.instruction.includes('ENGLISH'));
  });
});

describe('T8.3.6: Integration — Language in Synthesis System Prompt', () => {

  it('buildSynthesisSystemPrompt accepts language instruction', async () => {
    const langInstruction = buildLanguageInstruction('cs');
    const prompt = buildSynthesisSystemPrompt('SEARCH', {}, null, null, langInstruction);
    assert.ok(prompt.includes('ČESKY'), 'Synthesis prompt missing Czech instruction');
    assert.ok(prompt.includes('PŘELOŽ'), 'Synthesis prompt missing translate instruction');
  });

  it('buildSynthesisSystemPrompt works without language (backward compat)', async () => {
    const prompt = buildSynthesisSystemPrompt('SEARCH', {});
    assert.ok(prompt.includes('response synthesizer'), 'Missing base prompt');
    assert.ok(!prompt.includes('ČESKY'), 'Should not have Czech instruction without passing it');
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
