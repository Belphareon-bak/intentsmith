// CRE v45.0 KOLO 5.2 — Source Trust Weighting Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// CONTRACT:
// - Classify sources: official | media | community | unknown
// - Affects ordering (official first)
// - Affects certainty in formulation
//
// ══════════════════════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  SourceTrust,
  TRUST_WEIGHTS,
  extractDomain,
  classifySourceTrust,
  annotateWithTrust,
  sortByTrust,
  getTrustSynthesisInstructions,
  getCombinedQualityScore,
} from '../src/quality/source-trust.js';

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Domain Extraction
// ════════════════════════════════════════════════════════════════════════════════

describe('Source Trust: Domain Extraction', () => {
  it('extracts domain from full URL', () => {
    assert.strictEqual(extractDomain('https://www.example.com/page'), 'example.com');
    assert.strictEqual(extractDomain('http://cnb.cz/data'), 'cnb.cz');
  });

  it('removes www prefix', () => {
    assert.strictEqual(extractDomain('https://www.google.com'), 'google.com');
    assert.strictEqual(extractDomain('www.example.com'), 'example.com');
  });

  it('handles bare domain', () => {
    assert.strictEqual(extractDomain('example.com'), 'example.com');
    assert.strictEqual(extractDomain('sub.example.com'), 'sub.example.com');
  });

  it('handles empty/invalid input', () => {
    assert.strictEqual(extractDomain(''), '');
    assert.strictEqual(extractDomain(null), '');
    assert.strictEqual(extractDomain(undefined), '');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Source Classification
// ════════════════════════════════════════════════════════════════════════════════

describe('Source Trust: Classification', () => {
  describe('OFFICIAL sources', () => {
    it('classifies .gov domains as OFFICIAL', () => {
      const { trust } = classifySourceTrust('https://www.usa.gov/info');
      assert.strictEqual(trust, SourceTrust.OFFICIAL);
    });

    it('classifies .edu domains as OFFICIAL', () => {
      const { trust } = classifySourceTrust('https://stanford.edu/research');
      assert.strictEqual(trust, SourceTrust.OFFICIAL);
    });

    it('classifies Czech government domains as OFFICIAL', () => {
      const { trust } = classifySourceTrust('https://cnb.cz/kurzy');
      assert.strictEqual(trust, SourceTrust.OFFICIAL);
    });

    it('classifies developer docs as OFFICIAL', () => {
      const { trust } = classifySourceTrust('https://developer.mozilla.org');
      assert.strictEqual(trust, SourceTrust.OFFICIAL);
    });
  });

  describe('MEDIA sources', () => {
    it('classifies Czech news as MEDIA', () => {
      const { trust } = classifySourceTrust('https://idnes.cz/article');
      assert.strictEqual(trust, SourceTrust.MEDIA);
    });

    it('classifies international news as MEDIA', () => {
      const { trust } = classifySourceTrust('https://bbc.com/news');
      assert.strictEqual(trust, SourceTrust.MEDIA);
    });

    it('classifies tech media as MEDIA', () => {
      const { trust } = classifySourceTrust('https://techcrunch.com/post');
      assert.strictEqual(trust, SourceTrust.MEDIA);
    });
  });

  describe('COMMUNITY sources', () => {
    it('classifies Wikipedia as COMMUNITY', () => {
      const { trust } = classifySourceTrust('https://en.wikipedia.org/wiki/Bitcoin');
      assert.strictEqual(trust, SourceTrust.COMMUNITY);
    });

    it('classifies Reddit as COMMUNITY', () => {
      const { trust } = classifySourceTrust('https://reddit.com/r/bitcoin');
      assert.strictEqual(trust, SourceTrust.COMMUNITY);
    });

    it('classifies Medium as COMMUNITY', () => {
      const { trust } = classifySourceTrust('https://medium.com/@author/post');
      assert.strictEqual(trust, SourceTrust.COMMUNITY);
    });

    it('classifies Stack Overflow as COMMUNITY', () => {
      const { trust } = classifySourceTrust('https://stackoverflow.com/questions/123');
      assert.strictEqual(trust, SourceTrust.COMMUNITY);
    });
  });

  describe('UNKNOWN sources', () => {
    it('classifies unknown domains as UNKNOWN', () => {
      const { trust } = classifySourceTrust('https://randomsite.xyz/page');
      assert.strictEqual(trust, SourceTrust.UNKNOWN);
    });

    it('classifies empty source as UNKNOWN', () => {
      const { trust } = classifySourceTrust('');
      assert.strictEqual(trust, SourceTrust.UNKNOWN);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Trust Weights
// ════════════════════════════════════════════════════════════════════════════════

describe('Source Trust: Weights', () => {
  it('OFFICIAL has highest weight', () => {
    assert.strictEqual(TRUST_WEIGHTS[SourceTrust.OFFICIAL], 1.0);
  });

  it('weights are properly ordered', () => {
    assert.ok(TRUST_WEIGHTS[SourceTrust.OFFICIAL] > TRUST_WEIGHTS[SourceTrust.MEDIA]);
    assert.ok(TRUST_WEIGHTS[SourceTrust.MEDIA] > TRUST_WEIGHTS[SourceTrust.COMMUNITY]);
    assert.ok(TRUST_WEIGHTS[SourceTrust.COMMUNITY] > TRUST_WEIGHTS[SourceTrust.UNKNOWN]);
  });

  it('all weights are 0-1', () => {
    for (const weight of Object.values(TRUST_WEIGHTS)) {
      assert.ok(weight >= 0 && weight <= 1, `Weight ${weight} should be 0-1`);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Annotation and Sorting
// ════════════════════════════════════════════════════════════════════════════════

describe('Source Trust: Annotation and Sorting', () => {
  const mockResults = [
    { content: 'Data 1', source: 'https://reddit.com/r/test' },
    { content: 'Data 2', source: 'https://cnb.cz/info' },
    { content: 'Data 3', source: 'https://idnes.cz/news' },
    { content: 'Data 4', source: 'https://unknown.xyz' },
  ];

  it('annotates results with _sourceTrust', () => {
    const annotated = annotateWithTrust(mockResults);

    for (const result of annotated) {
      assert.ok('_sourceTrust' in result, 'Should have _sourceTrust');
      assert.ok(result._sourceTrust.trust);
      assert.ok(typeof result._sourceTrust.weight === 'number');
    }
  });

  it('sorts results by trust (official first)', () => {
    const annotated = annotateWithTrust(mockResults);
    const sorted = sortByTrust(annotated);

    // First should be cnb.cz (OFFICIAL)
    assert.strictEqual(sorted[0]._sourceTrust.trust, SourceTrust.OFFICIAL);

    // Last should be unknown.xyz (UNKNOWN)
    assert.strictEqual(sorted[sorted.length - 1]._sourceTrust.trust, SourceTrust.UNKNOWN);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Synthesis Instructions
// ════════════════════════════════════════════════════════════════════════════════

describe('Source Trust: Synthesis Instructions', () => {
  it('includes trust level counts', () => {
    const annotated = [
      { _sourceTrust: { trust: SourceTrust.OFFICIAL } },
      { _sourceTrust: { trust: SourceTrust.OFFICIAL } },
      { _sourceTrust: { trust: SourceTrust.MEDIA } },
    ];

    const instructions = getTrustSynthesisInstructions(annotated);

    assert.ok(instructions.includes('OFICIÁLNÍ ZDROJE (2)'));
    assert.ok(instructions.includes('MEDIÁLNÍ ZDROJE (1)'));
  });

  it('warns when only unknown sources', () => {
    const annotated = [
      { _sourceTrust: { trust: SourceTrust.UNKNOWN } },
      { _sourceTrust: { trust: SourceTrust.UNKNOWN } },
    ];

    const instructions = getTrustSynthesisInstructions(annotated);

    assert.ok(instructions.includes('UPOZORNĚNÍ'), 'Should warn about unverified sources');
  });

  it('warns when community-heavy without official', () => {
    const annotated = [
      { _sourceTrust: { trust: SourceTrust.COMMUNITY } },
      { _sourceTrust: { trust: SourceTrust.COMMUNITY } },
      { _sourceTrust: { trust: SourceTrust.COMMUNITY } },
      { _sourceTrust: { trust: SourceTrust.MEDIA } },
    ];

    const instructions = getTrustSynthesisInstructions(annotated);

    assert.ok(instructions.includes('UPOZORNĚNÍ') || instructions.includes('KOMUNITNÍ'));
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Combined Quality Score
// ════════════════════════════════════════════════════════════════════════════════

describe('Source Trust: Combined Quality Score', () => {
  it('combines relevance and trust', () => {
    const result = {
      _relevance: { score: 0.8 },
      _sourceTrust: { weight: 1.0 },
    };

    const combined = getCombinedQualityScore(result);

    // 0.8 * 0.7 + 1.0 * 0.3 = 0.56 + 0.3 = 0.86
    assert.ok(Math.abs(combined - 0.86) < 0.01, `Combined score should be ~0.86, got ${combined}`);
  });

  it('handles missing annotations gracefully', () => {
    const result = {};
    const combined = getCombinedQualityScore(result);

    // Defaults: 0.5 relevance, 0.5 trust → 0.5
    assert.ok(combined === 0.5, `Default combined score should be 0.5, got ${combined}`);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// TEST SUITE: Contract Invariants
// ════════════════════════════════════════════════════════════════════════════════

describe('Source Trust: Contract Invariants', () => {
  it('INVARIANT: Classification always returns valid trust level', () => {
    const testUrls = [
      'https://gov.uk',
      'https://random.site',
      '',
      'invalid-url',
      'ftp://something.com',
    ];

    for (const url of testUrls) {
      const { trust } = classifySourceTrust(url);
      assert.ok(
        Object.values(SourceTrust).includes(trust),
        `Trust ${trust} should be valid SourceTrust`
      );
    }
  });

  it('INVARIANT: Weight always corresponds to trust level', () => {
    const testUrls = [
      'https://cnb.cz',
      'https://idnes.cz',
      'https://wikipedia.org',
      'https://unknown.xyz',
    ];

    for (const url of testUrls) {
      const { trust, weight } = classifySourceTrust(url);
      assert.strictEqual(weight, TRUST_WEIGHTS[trust], `Weight should match trust level`);
    }
  });
});

console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║  CRE v45.0 KOLO 5.2 — Source Trust Weighting Tests                          ║
║  ─────────────────────────────────────────────────────────────────────────── ║
║                                                                              ║
║  CONTRACT:                                                                   ║
║  - sourceTrust: official | media | community | unknown                       ║
║  - Affects ordering (official first)                                         ║
║  - Affects certainty in formulation                                          ║
║                                                                              ║
║  Official source ≠ blog ≠ wiki mirror                                        ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
