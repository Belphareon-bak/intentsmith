// CRE v45.0 KOLO 5.1 — Relevance Filter Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// CONTRACT:
// - Each ToolResult gets relevanceScore (0-1)
// - < 0.3 → IGNORE
// - 0.3-0.6 → MARGINAL
// - > 0.6 → FULL
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  RelevanceLevel,
  RELEVANCE_THRESHOLD_IGNORE,
  RELEVANCE_THRESHOLD_FULL,
  extractQueryKeywords,
  calculateRelevanceScore,
  filterToolResults,
  getRelevanceSynthesisInstructions,
} from '../src/quality/relevance-filter.js';

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Keyword Extraction
// ════════════════════════════════════════════════════════════════════════════════

describe('Relevance Filter: Keyword Extraction', () => {
  it('extracts meaningful keywords from Czech query', () => {
    const query = 'Jaký je kurz bitcoinu dnes?';
    const keywords = extractQueryKeywords(query);

    assert.ok(keywords.includes('kurz'), 'Should include "kurz"');
    assert.ok(keywords.includes('bitcoinu'), 'Should include "bitcoinu"');
    assert.ok(keywords.includes('dnes'), 'Should include "dnes"');
    assert.ok(!keywords.includes('je'), 'Should exclude stop word "je"');
  });

  it('extracts keywords from English query', () => {
    const query = 'What is the current price of bitcoin?';
    const keywords = extractQueryKeywords(query);

    assert.ok(keywords.includes('current'), 'Should include "current"');
    assert.ok(keywords.includes('price'), 'Should include "price"');
    assert.ok(keywords.includes('bitcoin'), 'Should include "bitcoin"');
    assert.ok(!keywords.includes('the'), 'Should exclude stop word "the"');
  });

  it('handles empty query', () => {
    const keywords = extractQueryKeywords('');
    assert.strictEqual(keywords.length, 0);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Relevance Scoring
// ════════════════════════════════════════════════════════════════════════════════

describe('Relevance Filter: Scoring', () => {
  it('high relevance for matching content', () => {
    const result = { content: 'Aktuální kurz bitcoinu je 45000 USD.' };
    const query = 'Jaký je kurz bitcoinu?';

    const { score, level } = calculateRelevanceScore(result, query);

    assert.ok(score > RELEVANCE_THRESHOLD_FULL, `Score ${score} should be > ${RELEVANCE_THRESHOLD_FULL}`);
    assert.strictEqual(level, RelevanceLevel.FULL);
  });

  it('low relevance for off-topic content', () => {
    const result = { content: 'Správně se píše "bys" nebo "by js". Gramatické pravidlo.' };
    const query = 'Jaký je kurz bitcoinu?';

    const { score, level } = calculateRelevanceScore(result, query);

    assert.ok(score < RELEVANCE_THRESHOLD_IGNORE, `Score ${score} should be < ${RELEVANCE_THRESHOLD_IGNORE}`);
    assert.strictEqual(level, RelevanceLevel.IGNORE);
  });

  it('marginal relevance for partially related content', () => {
    const result = { content: 'Bitcoin je kryptoměna. V roce 2020 stál 10000 USD.' };
    const query = 'Jaký je aktuální kurz bitcoinu?';

    const { score, level } = calculateRelevanceScore(result, query);

    // Should be between thresholds
    assert.ok(
      score >= RELEVANCE_THRESHOLD_IGNORE && score <= RELEVANCE_THRESHOLD_FULL,
      `Score ${score} should be MARGINAL range`
    );
  });

  it('penalizes very short content', () => {
    const shortResult = { content: 'OK' };
    const longResult = { content: 'Bitcoin je decentralizovaná digitální měna bez centrální banky.' };
    const query = 'Co je bitcoin?';

    const shortScore = calculateRelevanceScore(shortResult, query).score;
    const longScore = calculateRelevanceScore(longResult, query).score;

    assert.ok(longScore > shortScore, 'Longer relevant content should score higher');
  });

  it('detects off-topic patterns (grammar correction)', () => {
    const result = { content: 'Správně se píše "bys" nebo "by jsi". Tohle je gramatické pravidlo.' };
    const query = 'Jaká je politická situace?';

    const { level, reasons } = calculateRelevanceScore(result, query);

    assert.ok(
      reasons.some(r => r.includes('off_topic')),
      'Should detect off-topic pattern'
    );
    assert.strictEqual(level, RelevanceLevel.IGNORE);
  });

  it('detects off-topic patterns (ads)', () => {
    const result = { content: 'Sponzorovaný obsah. Kupte si bitcoin se slevou 50%!' };
    const query = 'Co je bitcoin?';

    const { reasons } = calculateRelevanceScore(result, query);

    assert.ok(
      reasons.some(r => r.includes('off_topic')),
      'Should detect ad content as off-topic'
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Results Filtering
// ════════════════════════════════════════════════════════════════════════════════

describe('Relevance Filter: filterToolResults', () => {
  const query = 'Jaký je kurz bitcoinu?';

  const mockResults = [
    { content: 'Aktuální kurz bitcoinu je 45000 USD.', source: 'cnb.cz' },
    { content: 'Bitcoin klesl o 5% za poslední týden.', source: 'news.cz' },
    { content: 'Správně se píše "bys" nikoliv "by jsi".', source: 'grammar.cz' },
    { content: 'Reklama: Kupte kryptoměny!', source: 'ads.com' },
    { content: 'Bitcoin historie a technologie.', source: 'wiki.org' },
  ];

  it('separates results into relevant, marginal, ignored', () => {
    const { relevant, marginal, stats } = filterToolResults(mockResults, query);

    assert.strictEqual(stats.total, 5);
    assert.ok(relevant.length > 0, 'Should have relevant results');
    assert.ok(stats.ignored > 0, 'Should have ignored results');
  });

  it('annotates results with _relevance', () => {
    const { relevant } = filterToolResults(mockResults, query);

    for (const result of relevant) {
      assert.ok('_relevance' in result, 'Should have _relevance annotation');
      assert.ok(typeof result._relevance.score === 'number');
      assert.ok(result._relevance.level);
    }
  });

  it('sorts relevant results by score (highest first)', () => {
    const { relevant } = filterToolResults(mockResults, query);

    if (relevant.length >= 2) {
      for (let i = 1; i < relevant.length; i++) {
        assert.ok(
          relevant[i - 1]._relevance.score >= relevant[i]._relevance.score,
          'Results should be sorted by score descending'
        );
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Synthesis Instructions
// ════════════════════════════════════════════════════════════════════════════════

describe('Relevance Filter: Synthesis Instructions', () => {
  it('includes source counts in instructions', () => {
    const filtered = {
      relevant: [{ _relevance: { score: 0.8 } }, { _relevance: { score: 0.7 } }],
      marginal: [{ _relevance: { score: 0.5 } }],
      stats: { total: 5, relevant: 2, marginal: 1, ignored: 2, avgRelevantScore: 0.75 },
    };

    const instructions = getRelevanceSynthesisInstructions(filtered);

    assert.ok(instructions.includes('PRIMÁRNÍ ZDROJE (2)'), 'Should mention primary sources count');
    assert.ok(instructions.includes('OKRAJOVÉ ZDROJE (1)'), 'Should mention marginal sources count');
  });

  it('warns when no relevant sources', () => {
    const filtered = {
      relevant: [],
      marginal: [],
      stats: { total: 3, relevant: 0, marginal: 0, ignored: 3, avgRelevantScore: 0 },
    };

    const instructions = getRelevanceSynthesisInstructions(filtered);

    assert.ok(instructions.includes('VAROVÁNÍ'), 'Should include warning');
  });

  it('warns when average relevance is low', () => {
    const filtered = {
      relevant: [{ _relevance: { score: 0.65 } }],
      marginal: [],
      stats: { total: 2, relevant: 1, marginal: 0, ignored: 1, avgRelevantScore: 0.65 },
    };

    const instructions = getRelevanceSynthesisInstructions(filtered);

    assert.ok(instructions.includes('UPOZORNĚNÍ'), 'Should include caution');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Contract Invariants
// ════════════════════════════════════════════════════════════════════════════════

describe('Relevance Filter: Contract Invariants', () => {
  it('INVARIANT: Thresholds are properly ordered', () => {
    assert.ok(RELEVANCE_THRESHOLD_IGNORE < RELEVANCE_THRESHOLD_FULL);
    assert.ok(RELEVANCE_THRESHOLD_IGNORE >= 0);
    assert.ok(RELEVANCE_THRESHOLD_FULL <= 1);
  });

  it('INVARIANT: Score is always 0-1', () => {
    const testCases = [
      { content: '' },
      { content: 'Very relevant bitcoin price information' },
      { content: 'Completely off topic unrelated content about grammar' },
    ];

    for (const result of testCases) {
      const { score } = calculateRelevanceScore(result, 'test query');
      assert.ok(score >= 0 && score <= 1, `Score ${score} should be between 0 and 1`);
    }
  });

  it('INVARIANT: Level matches score thresholds', () => {
    const result = { content: 'Test content for scoring' };
    const { score, level } = calculateRelevanceScore(result, 'test');

    if (score < RELEVANCE_THRESHOLD_IGNORE) {
      assert.strictEqual(level, RelevanceLevel.IGNORE);
    } else if (score < RELEVANCE_THRESHOLD_FULL) {
      assert.strictEqual(level, RelevanceLevel.MARGINAL);
    } else {
      assert.strictEqual(level, RelevanceLevel.FULL);
    }
  });

  it('CONTRACT: Grammar corrections are filtered out', () => {
    const grammarResult = { content: 'Mělo by se psát "by jsi" nebo správně "bys".' };
    const { level } = calculateRelevanceScore(grammarResult, 'politická situace v ČR');

    assert.strictEqual(level, RelevanceLevel.IGNORE, 'Grammar corrections should be IGNORED');
  });
});

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  CRE v45.0 KOLO 5.1 — Relevance Filter Tests                                ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  CONTRACT:                                                                   ║
║  - relevanceScore: 0-1 for each ToolResult                                   ║
║  - < 0.3 → IGNORE                                                            ║
║  - 0.3-0.6 → MARGINAL                                                        ║
║  - > 0.6 → FULL                                                              ║
║                                                                              ║
║  Off-topic patterns (grammar, ads) are automatically filtered.               ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
