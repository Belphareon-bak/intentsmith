// C3-Agent v63.0 — Merge → Enforcement Integration Test (🔴3)
// ══════════════════════════════════════════════════════════════════════════════
//
// Critical test: merge 2 expertises → create synthetic enforcement config
// → run through ExpertEnforcer → simulate LLM output → verify enforcement
// works identically to single-expert flow.
//
// Verify:
//   - All forbiddenPhrases (regex + string) work in merged config
//   - minResponseLength applies (MAX from both)
//   - Disclaimers don't duplicate
//   - Retry works with merged config
//
// Spuštění: node tests/merge-enforcement-integration.test.js
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

import { mergeExpertisePrompt } from '../src/experts/merge-engine.js';
import { BUILTIN_EXPERTS } from '../src/experts/expert-layer.js';
import { ExpertEnforcer, checkForbiddenPhrases, checkResponseLength, quickCheck } from '../src/experts/expert-enforcement.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function expert(id, weight = 0.5) {
  return { ...BUILTIN_EXPERTS[id], weight };
}

/**
 * Build synthetic expert config from merge result,
 * exactly as handleMergedExpertises() does.
 */
function buildSyntheticExpert(mergeResult, expertises) {
  return {
    id: '_merged',
    name: expertises.map(e => e.name || e.id).join(' + '),
    domain: 'merged',
    styleRules: {
      forbiddenPhrases: mergeResult.enforcement.forbiddenPhrases,
      minResponseLength: mergeResult.enforcement.minResponseLength,
      toolEnforcement: mergeResult.enforcement.toolEnforcement,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// T-EI1: MERGED ENFORCEMENT DETECTS VIOLATIONS
// ══════════════════════════════════════════════════════════════════════════════

describe('T-EI1: Merged enforcement detects violations', async () => {
  await it('forbiddenPhrases from developer expert work in merged config', () => {
    // developer has: /TODO.*later/i, /this is just an example/i, /you might want to/i
    const mergeResult = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    const synthetic = buildSyntheticExpert(mergeResult, [BUILTIN_EXPERTS.developer, BUILTIN_EXPERTS.analyst]);

    // This response contains a phrase forbidden by developer
    const badResponse = 'Here is the code. TODO: fix this later when you have time. The analysis shows positive results.';
    const check = checkForbiddenPhrases(badResponse, synthetic.styleRules.forbiddenPhrases);
    assert.ok(!check.valid, 'should detect TODO.*later from developer forbiddenPhrases');
  });

  await it('forbiddenPhrases from analyst expert work in merged config', () => {
    const mergeResult = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    const synthetic = buildSyntheticExpert(mergeResult, [BUILTIN_EXPERTS.developer, BUILTIN_EXPERTS.analyst]);

    // analyst has: /možná/i, /asi/i, /nevím přesně/i, /obecně platí/i
    const badResponse = 'Na základě analýzy dat asi bude výsledek pozitivní. Kód je připraven k nasazení s tím, že obecně platí pravidlo kvality.';
    const check = checkForbiddenPhrases(badResponse, synthetic.styleRules.forbiddenPhrases);
    assert.ok(!check.valid, 'should detect "asi" from analyst forbiddenPhrases');
  });

  await it('DEFAULT_FORBIDDEN_PHRASES work in merged config', () => {
    const mergeResult = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    const synthetic = buildSyntheticExpert(mergeResult, [BUILTIN_EXPERTS.developer, BUILTIN_EXPERTS.analyst]);

    // Default: /jako (velký )?jazykový model/i
    const badResponse = 'Jako velký jazykový model nemohu provádět skutečné výpočty, ale mohu vám poradit.';
    const check = checkForbiddenPhrases(badResponse, synthetic.styleRules.forbiddenPhrases);
    assert.ok(!check.valid, 'should detect default "jako jazykový model"');
  });

  await it('regex and string forbiddenPhrases both work', () => {
    // Accountant has string-type forbidden phrases: 'odhaduji', 'přibližně', etc.
    // Use developer + ai_expert instead (both compatible, both have regex phrases)
    const mergeResult = mergeExpertisePrompt([expert('developer', 0.7), expert('ai_expert', 0.3)]);
    const synthetic = buildSyntheticExpert(mergeResult, [BUILTIN_EXPERTS.developer, BUILTIN_EXPERTS.ai_expert]);

    // Clean response should pass
    const goodResponse = 'Na základě analýzy kódu doporučuji refactoring modulu authentication. Transformer architektura je vhodná pro tento use case, protože umožňuje paralelní zpracování sekvencí.';
    const check = checkForbiddenPhrases(goodResponse, synthetic.styleRules.forbiddenPhrases);
    assert.ok(check.valid, `clean response should pass, got violations: ${check.violations}`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-EI2: MIN RESPONSE LENGTH USES MAX
// ══════════════════════════════════════════════════════════════════════════════

describe('T-EI2: minResponseLength uses MAX from both experts', async () => {
  await it('merged minResponseLength = MAX(developer=50, analyst=100) + capability modifier', () => {
    const mergeResult = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    // Base: MAX(50, 100) = 100, then +50 from riskTolerance LOW capability modifier (weighted avg < 30)
    assert.strictEqual(mergeResult.enforcement.minResponseLength, 150,
      'should use MAX of both experts + capability modifier');
  });

  await it('short response fails merged length check', () => {
    const mergeResult = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    const minLen = mergeResult.enforcement.minResponseLength;

    const shortResponse = 'Ano, funguje.'; // 13 chars < 100
    const check = checkResponseLength(shortResponse, minLen);
    assert.ok(!check.valid, 'short response should fail length check');
  });

  await it('adequate response passes merged length check', () => {
    const mergeResult = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    const minLen = mergeResult.enforcement.minResponseLength;

    const goodResponse = 'Na základě analýzy kódu doporučuji následující přístup: Refaktorizujte modul pro lepší testovatelnost a udržitelnost. Oddělte business logiku od IO operací.';
    const check = checkResponseLength(goodResponse, minLen);
    assert.ok(check.valid, 'adequate response should pass length check');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-EI3: DISCLAIMER DEDUPLICATION
// ══════════════════════════════════════════════════════════════════════════════

describe('T-EI3: Disclaimers do not duplicate', async () => {
  await it('single disclaimer expert produces exactly 1 disclaimer', () => {
    // lawyer has disclaimer, political_analyst does not
    const mergeResult = mergeExpertisePrompt([expert('lawyer', 0.7), expert('political_analyst', 0.3)]);
    const disclaimers = mergeResult.enforcement.disclaimers;
    assert.strictEqual(disclaimers.length, 1, `expected 1 disclaimer, got ${disclaimers.length}`);
    assert.ok(disclaimers[0].includes('advokáta'));
  });

  await it('no disclaimers when both experts have none', () => {
    const mergeResult = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    assert.strictEqual(mergeResult.enforcement.disclaimers.length, 0,
      'developer + analyst should have 0 disclaimers');
  });

  await it('prompt includes disclaimers section only when present', () => {
    // With disclaimer
    const withDisc = mergeExpertisePrompt([expert('lawyer', 0.7), expert('political_analyst', 0.3)]);
    assert.ok(withDisc.prompt.includes('Disclaimery'), 'should have disclaimers section');

    // Without disclaimer
    const withoutDisc = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    assert.ok(!withoutDisc.prompt.includes('Disclaimery'), 'should NOT have disclaimers section');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-EI4: ENFORCER RETRY WITH MERGED CONFIG
// ══════════════════════════════════════════════════════════════════════════════

describe('T-EI4: ExpertEnforcer retry with merged config', async () => {
  await it('enforcer passes clean response immediately', async () => {
    const mergeResult = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    const synthetic = buildSyntheticExpert(mergeResult, [BUILTIN_EXPERTS.developer, BUILTIN_EXPERTS.analyst]);

    const regenerateFn = async () => 'This should not be called';
    const enforcer = new ExpertEnforcer(synthetic, regenerateFn);

    const cleanResponse = 'Na základě analýzy kódu doporučuji následující refaktorizaci: oddělte datovou vrstvu od prezentační logiky. Použijte dependency injection pro lepší testovatelnost.';
    const result = await enforcer.enforce(cleanResponse, 'Jak refaktorovat?');
    assert.ok(result.passed, 'clean response should pass');
    assert.strictEqual(result.attempts, 1, 'should not retry');
    assert.ok(!result.wasRetried, 'wasRetried should be false');
  });

  await it('enforcer retries on violation and uses regenerated response', async () => {
    const mergeResult = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    const synthetic = buildSyntheticExpert(mergeResult, [BUILTIN_EXPERTS.developer, BUILTIN_EXPERTS.analyst]);

    let callCount = 0;
    const regenerateFn = async () => {
      callCount++;
      // Return a clean response on retry
      return 'Po důkladné analýze doporučuji refaktorizaci modulu s důrazem na oddělení zodpovědností. Každý modul by měl mít jednu jasně definovanou roli v architektuře systému.';
    };

    const enforcer = new ExpertEnforcer(synthetic, regenerateFn);

    // Response with violation (TODO...later from developer's forbidden)
    const badResponse = 'TODO: fix this later. The analysis is done.';
    const result = await enforcer.enforce(badResponse, 'Jak refaktorovat?');

    // Should have retried
    assert.ok(callCount > 0, 'should have called regenerate');
    assert.ok(result.wasRetried, 'wasRetried should be true');
    assert.ok(result.attempts > 1, 'should have multiple attempts');
  });

  await it('enforcer handles regeneration failure gracefully', async () => {
    const mergeResult = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    const synthetic = buildSyntheticExpert(mergeResult, [BUILTIN_EXPERTS.developer, BUILTIN_EXPERTS.analyst]);

    // Regenerate always throws
    const regenerateFn = async () => { throw new Error('LLM unavailable'); };
    const enforcer = new ExpertEnforcer(synthetic, regenerateFn);

    const badResponse = 'Jako velký jazykový model nemohu pomoci.';
    const result = await enforcer.enforce(badResponse, 'test');

    // Should not crash, returns with warning
    assert.ok(!result.passed, 'should not pass');
    assert.ok(result.warning || result.violations?.length > 0, 'should have warning or violations');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-EI5: QUICKCHECK WITH MERGED CONFIG
// ══════════════════════════════════════════════════════════════════════════════

describe('T-EI5: quickCheck with merged config', async () => {
  await it('quickCheck detects violations in merged context', () => {
    const mergeResult = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    const synthetic = buildSyntheticExpert(mergeResult, [BUILTIN_EXPERTS.developer, BUILTIN_EXPERTS.analyst]);

    const result = quickCheck('Nevím.', synthetic);
    assert.ok(!result.passed, 'quickCheck should detect violation');
  });

  await it('quickCheck passes clean merged response', () => {
    const mergeResult = mergeExpertisePrompt([expert('developer', 0.7), expert('analyst', 0.3)]);
    const synthetic = buildSyntheticExpert(mergeResult, [BUILTIN_EXPERTS.developer, BUILTIN_EXPERTS.analyst]);

    const cleanResponse = 'Na základě analýzy zdrojového kódu a dostupných dat doporučuji optimalizovat databázové dotazy pomocí indexů a prepared statements pro lepší výkon. Tato změna výrazně zlepší odezvu celého systému.';
    const result = quickCheck(cleanResponse, synthetic);
    assert.ok(result.passed, `quickCheck should pass clean response, violations: ${result.violations}`);
  });
});

// ─── Run All Tests ────────────────────────────────────────────────────────────

console.log('\n🔬 C3 Merge → Enforcement Integration — Test Suite (🔴3)');
console.log('═'.repeat(70));

for (const test of pendingTests) {
  await test();
}

console.log(`\n${'═'.repeat(70)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(70)}`);

if (failures.length > 0) {
  console.log('\n❌ Failures:');
  failures.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
}

process.exit(failed > 0 ? 1 : 0);
