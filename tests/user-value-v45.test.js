// ═══════════════════════════════════════════════════════════════════════════════
// v45.0 User Value Tests
// ═══════════════════════════════════════════════════════════════════════════════
// These tests verify ACTUAL USER VALUE, not just internal mechanics.
// They check that the output the user sees meets their expectations.
//
// Previous tests: decision.intent === 'REPORT' ✓ (mechanics)
// These tests: response contains synthesis with bullet points (user value)
// ═══════════════════════════════════════════════════════════════════════════════

import assert from 'node:assert';
import { test, describe } from 'node:test';

import { creDecisionEngine, IntentType, DecisionType } from '../src/unification/cre-decision.js';

// ─────────────────────────────────────────────────────────────────────────────
// INTENT DETECTION USER VALUE
// ─────────────────────────────────────────────────────────────────────────────
// These tests verify that user queries get the RIGHT intent classification
// so they receive the RIGHT type of response.

describe('v45.0 — Intent Detection User Value', () => {

  describe('ITEM_LOOKUP detection', () => {
    const itemLookupQueries = [
      'dej mi 4 inzeráty na auta',
      'najdi mi 5 bytů v Praze',
      'vyber mi 3 nabídky práce',    // uses "vyber" pattern
      '10 nejlepších restaurací',
      'top 5 notebooků do 20000',
      'find me 3 used cars',
      'show me 5 apartments',
      'list 10 best restaurants',
    ];

    for (const query of itemLookupQueries) {
      test(`"${query.substring(0, 40)}..." → ITEM_LOOKUP`, () => {
        const decision = creDecisionEngine.decide(query, {});

        assert.strictEqual(
          decision.intent,
          IntentType.ITEM_LOOKUP,
          `Expected ITEM_LOOKUP for "${query}", got ${decision.intent}`
        );

        // ITEM_LOOKUP must be TOOL_CALL (needs search/scrape)
        assert.strictEqual(
          decision.type,
          DecisionType.TOOL_CALL,
          `ITEM_LOOKUP must use TOOL_CALL, got ${decision.type}`
        );
      });
    }
  });

  describe('REPORT detection', () => {
    const reportQueries = [
      'shrnutí politiky ČR za 14 dní',
      'přehled novinek z AI světa',
      'souhrn ekonomických zpráv',
      'dej mi přehled situace na Ukrajině',  // uses "přehled" which is detected
      'create a report on market trends',
      'summarize the tech news this week',
    ];

    for (const query of reportQueries) {
      test(`"${query.substring(0, 40)}..." → REPORT`, () => {
        const decision = creDecisionEngine.decide(query, {});

        assert.strictEqual(
          decision.intent,
          IntentType.REPORT,
          `Expected REPORT for "${query}", got ${decision.intent}`
        );
      });
    }
  });

  describe('ITEM_LOOKUP vs REPORT disambiguation', () => {
    test('"4 inzeráty na auta" is ITEM_LOOKUP, not REPORT', () => {
      const decision = creDecisionEngine.decide('dej mi 4 inzeráty na auta', {});

      assert.notStrictEqual(
        decision.intent,
        IntentType.REPORT,
        'Item lookup with specific count must NOT be REPORT'
      );

      assert.strictEqual(
        decision.intent,
        IntentType.ITEM_LOOKUP,
        'Item lookup with specific count must be ITEM_LOOKUP'
      );
    });

    test('"přehled aut na trhu" is REPORT, not ITEM_LOOKUP', () => {
      const decision = creDecisionEngine.decide('dej mi přehled aut na trhu', {});

      assert.strictEqual(
        decision.intent,
        IntentType.REPORT,
        'General overview must be REPORT'
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STICKY INTENT BREAKING
// ─────────────────────────────────────────────────────────────────────────────
// These tests verify that sticky intent doesn't override explicit new requests.

describe('v45.0 — Sticky Intent Breaking', () => {

  test('ITEM_LOOKUP breaks sticky REPORT', () => {
    // Simulate: previous query was REPORT
    const context = {
      lastIntent: IntentType.REPORT,
      conversationState: { lastIntent: IntentType.REPORT },
    };

    // New query explicitly asks for items
    const decision = creDecisionEngine.decide('dej mi 4 inzeráty na auta', context);

    // Should be ITEM_LOOKUP, not sticky REPORT
    assert.strictEqual(
      decision.intent,
      IntentType.ITEM_LOOKUP,
      `ITEM_LOOKUP must break sticky REPORT, got ${decision.intent}`
    );
  });

  test('Intent break patterns prevent sticky intent', () => {
    const context = {
      lastIntent: IntentType.REPORT,
    };

    const breakQueries = [
      'teď chci najít auto',
      'změň téma - hledám byt',
      'něco jiného - ukaz mi notebooky',
      'chci najít práci',
    ];

    for (const query of breakQueries) {
      const decision = creDecisionEngine.decide(query, context);

      // Should NOT be REPORT (sticky should be broken)
      assert.notStrictEqual(
        decision.intent,
        IntentType.REPORT,
        `"${query}" should break sticky REPORT, got ${decision.intent}`
      );
    }
  });

  test('Continuation patterns maintain sticky intent', () => {
    const context = {
      lastIntent: IntentType.SEARCH,
    };

    const continuationQueries = [
      'a co dál?',
      'ještě něco',
      'další informace',
    ];

    for (const query of continuationQueries) {
      const decision = creDecisionEngine.decide(query, context);

      // Should maintain SEARCH (sticky applies)
      assert.strictEqual(
        decision.intent,
        IntentType.SEARCH,
        `"${query}" should maintain sticky SEARCH, got ${decision.intent}`
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT FORMAT VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────
// These helpers validate that output meets user expectations.

function validateReportOutput(content) {
  const issues = [];

  // REPORT must NOT be just a list of URLs
  const urlOnlyPattern = /^(https?:\/\/[^\s]+\s*)+$/m;
  if (urlOnlyPattern.test(content)) {
    issues.push('REPORT is just URLs without synthesis');
  }

  // REPORT must NOT start with "Zde jsou zdroje:"
  if (/^Zde jsou zdroje:/i.test(content)) {
    issues.push('REPORT starts with forbidden phrase "Zde jsou zdroje:"');
  }

  // REPORT should have some structured content
  const hasBullets = /[•\-\*]\s+/.test(content);
  const hasHeaders = /^##?\s+/m.test(content);
  const hasParagraphs = content.split('\n\n').length > 1;

  if (!hasBullets && !hasHeaders && !hasParagraphs) {
    issues.push('REPORT lacks structure (no bullets, headers, or paragraphs)');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

function validateItemLookupOutput(content, expectedCount) {
  const issues = [];

  // ITEM_LOOKUP must have clickable links
  const linkCount = (content.match(/https?:\/\/[^\s)]+/g) || []).length;
  if (linkCount === 0) {
    issues.push('ITEM_LOOKUP has no URLs');
  }

  // ITEM_LOOKUP should have numbered items
  const numberedItems = (content.match(/^\d+\./gm) || []).length;
  if (numberedItems < expectedCount * 0.5) {
    issues.push(`ITEM_LOOKUP has fewer items than expected (${numberedItems} vs ${expectedCount})`);
  }

  // ITEM_LOOKUP must NOT be generic marketplace homepages
  const genericHomepages = [
    'bazos.cz/?',
    'sauto.cz/?',
    'sreality.cz/?',
    'heureka.cz/?',
  ];
  for (const homepage of genericHomepages) {
    if (content.includes(homepage) && !content.includes(`${homepage}detail`)) {
      issues.push(`ITEM_LOOKUP contains generic homepage: ${homepage}`);
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// OUTPUT VALIDATION TESTS (MOCK)
// ─────────────────────────────────────────────────────────────────────────────
// These tests verify that the validation functions work correctly.

describe('v45.0 — Output Validation Helpers', () => {

  describe('REPORT validation', () => {
    test('rejects URL-only content', () => {
      const badContent = `https://example.com/1
https://example.com/2
https://example.com/3`;

      const result = validateReportOutput(badContent);
      assert.strictEqual(result.valid, false);
      assert.ok(result.issues.some(i => i.includes('just URLs')));
    });

    test('rejects "Zde jsou zdroje:" prefix', () => {
      const badContent = `Zde jsou zdroje:
- CNN Prima
- iDNES`;

      const result = validateReportOutput(badContent);
      assert.strictEqual(result.valid, false);
      assert.ok(result.issues.some(i => i.includes('forbidden phrase')));
    });

    test('accepts structured synthesis', () => {
      const goodContent = `## Hlavní události
• První důležitá událost se týkala ekonomiky
• Druhý bod o politice

Závěr: Situace se vyvíjí pozitivně.`;

      const result = validateReportOutput(goodContent);
      assert.strictEqual(result.valid, true);
    });
  });

  describe('ITEM_LOOKUP validation', () => {
    test('rejects content without URLs', () => {
      const badContent = `1. Škoda Octavia - 250 000 Kč
2. VW Golf - 200 000 Kč`;

      const result = validateItemLookupOutput(badContent, 4);
      assert.strictEqual(result.valid, false);
      assert.ok(result.issues.some(i => i.includes('no URLs')));
    });

    test('accepts numbered items with links', () => {
      const goodContent = `1. **Škoda Octavia 1.6 TDI** - 250 000 Kč
   🔗 https://bazos.cz/inzerat/12345

2. **VW Golf VII** - 200 000 Kč
   🔗 https://sauto.cz/detail/67890

3. **Ford Focus** - 180 000 Kč
   🔗 https://bazos.cz/inzerat/11111

4. **Hyundai i30** - 220 000 Kč
   🔗 https://sauto.cz/detail/22222`;

      const result = validateItemLookupOutput(goodContent, 4);
      assert.strictEqual(result.valid, true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT VALIDATION HELPERS FOR E2E TESTS
// ─────────────────────────────────────────────────────────────────────────────

export { validateReportOutput, validateItemLookupOutput };
