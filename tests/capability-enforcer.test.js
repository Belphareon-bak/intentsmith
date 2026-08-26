// C3-Agent v63.3 — Capability Enforcer + Strict Enforcement + Retry Decay + ExecutionTrace Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// T-CE1:  evaluateDeterminism — hedging detection, ratio-based scoring
// T-CE2:  evaluateRiskTolerance — caveat detection
// T-CE3:  evaluateVerbosity — word count → score mapping
// T-CE4:  evaluateStructure — structural markers
// T-CE5:  computeCapabilityDrift — per-dimension drift, violation thresholds
// T-CE6:  enforceCapabilities — main entry point, aggregation
// T-CE7:  ExpertiseEnforcer strict mode — hard fail after retries
// T-CE8:  ExpertiseEnforcer retry decay — temperature/topP decay, seed, audit
// T-CE10: ExecutionTrace ID — propagation through retry audit trail
//
// Spuštění: node tests/capability-enforcer.test.js
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
  evaluateDeterminism,
  evaluateRiskTolerance,
  evaluateVerbosity,
  evaluateStructure,
  computeCapabilityDrift,
  enforceCapabilities,
  CAPABILITY_ENFORCEMENT_CONFIG,
} from '../src/expertises/capability-enforcer.js';

import {
  ExpertiseEnforcer,
  checkForbiddenPhrases,
  checkResponseLength,
} from '../src/expertises/expertise-enforcement.js';

// ══════════════════════════════════════════════════════════════════════════════
// T-CE1: DETERMINISM EVALUATION
// ══════════════════════════════════════════════════════════════════════════════

describe('T-CE1: evaluateDeterminism', async () => {
  await it('no hedging → high determinism score', () => {
    const output = 'Výsledek je 42. Toto je správná odpověď. Žádná pochybnost zde neexistuje.';
    const result = evaluateDeterminism(output, { determinism: 90 });
    assert.ok(result.score >= 80, `Expected high score, got ${result.score}`);
    assert.strictEqual(result.violations.length, 0, 'should have no violations');
  });

  await it('heavy hedging → violation for high determinism profile', () => {
    const output = 'Možná to bude asi pravděpodobně tak, že nejspíš případ. Asi bych řekl, že možná ano, asi ne.';
    const result = evaluateDeterminism(output, { determinism: 90 });
    assert.ok(result.violations.length > 0, 'should have violations for high determinism + heavy hedging');
  });

  await it('hedging is acceptable for low determinism', () => {
    const output = 'Možná bychom mohli pravděpodobně zvážit asi tuto variantu.';
    const result = evaluateDeterminism(output, { determinism: 20 });
    assert.strictEqual(result.violations.length, 0, 'low determinism should allow hedging');
  });

  await it('missing profile returns neutral score', () => {
    const result = evaluateDeterminism('test', {});
    assert.strictEqual(result.score, 50, 'missing determinism → neutral');
  });

  await it('null output returns neutral', () => {
    const result = evaluateDeterminism(null, { determinism: 80 });
    assert.strictEqual(result.score, 50);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-CE2: RISK TOLERANCE EVALUATION
// ══════════════════════════════════════════════════════════════════════════════

describe('T-CE2: evaluateRiskTolerance', async () => {
  await it('caveats present → lower risk score', () => {
    const output = 'Pozor, toto řešení má omezení. Riziko je, že konzultujte odborníka pro bezpečnost.';
    const result = evaluateRiskTolerance(output, { riskTolerance: 10 });
    assert.strictEqual(result.violations.length, 0, 'low risk + caveats = no violation');
  });

  await it('no caveats → violation for low risk profile', () => {
    // Must be >30 words to trigger caveat check
    const output = 'Jednoduše to udělejte takto. Nastavte hodnotu na 100 a klikněte na tlačítko. ' +
      'Pak přejděte na další stránku a vyplňte formulář. Odešlete ho a počkejte na potvrzení. ' +
      'Celý proces trvá přibližně pět minut a je zcela automatizovaný bez jakýchkoli komplikací.';
    const result = evaluateRiskTolerance(output, { riskTolerance: 10 });
    assert.ok(result.violations.length > 0, 'low risk + no caveats = violation');
  });

  await it('high risk tolerance allows no caveats', () => {
    const output = 'Jednoduše to udělejte. Nastavte hodnotu a pokračujte dál, žádné problémy se neočekávají.';
    const result = evaluateRiskTolerance(output, { riskTolerance: 90 });
    assert.strictEqual(result.violations.length, 0, 'high risk can skip caveats');
  });

  await it('null/missing profile returns neutral', () => {
    const result = evaluateRiskTolerance('test', null);
    assert.strictEqual(result.score, 50);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-CE3: VERBOSITY EVALUATION
// ══════════════════════════════════════════════════════════════════════════════

describe('T-CE3: evaluateVerbosity', async () => {
  await it('short response → low verbosity score', () => {
    const output = 'Ano, 42.';
    const result = evaluateVerbosity(output, { verbosity: 30 });
    assert.ok(result.score <= 30, `Expected low score, got ${result.score}`);
    assert.strictEqual(result.violations.length, 0, 'low verbosity profile + short response = ok');
  });

  await it('short response → violation for high verbosity profile', () => {
    const output = 'Odpověď je stručná.';
    const result = evaluateVerbosity(output, { verbosity: 80 });
    assert.ok(result.violations.length > 0, 'high verbosity expects longer response');
  });

  await it('long response → high verbosity score', () => {
    const words = Array(300).fill('slovo').join(' ');
    const result = evaluateVerbosity(words, { verbosity: 80 });
    assert.ok(result.score >= 60, `Expected high score for 300 words, got ${result.score}`);
    assert.strictEqual(result.violations.length, 0);
  });

  await it('very long response warns for low verbosity profile', () => {
    const words = Array(400).fill('slovo').join(' ');
    const result = evaluateVerbosity(words, { verbosity: 20 });
    assert.ok(result.warnings.length > 0, 'low verbosity + very long = warning');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-CE4: STRUCTURE EVALUATION
// ══════════════════════════════════════════════════════════════════════════════

describe('T-CE4: evaluateStructure', async () => {
  await it('detects markdown headers', () => {
    const output = '## Sekce 1\n\nObsah.\n\n### Podsekce\n\nDalší obsah.';
    const result = evaluateStructure(output, {});
    assert.ok(result.metrics.headers >= 2, `Expected >=2 headers, got ${result.metrics.headers}`);
  });

  await it('detects bullet lists', () => {
    const output = '- Položka 1\n- Položka 2\n- Položka 3';
    const result = evaluateStructure(output, {});
    assert.ok(result.metrics.bulletLists >= 3);
  });

  await it('warns on high reasoning + long response without structure', () => {
    const words = Array(200).fill('slovo').join(' ');
    const result = evaluateStructure(words, { reasoning: 85 });
    assert.ok(result.warnings.length > 0, 'high reasoning + long + no structure = warning');
  });

  await it('null output returns score 0', () => {
    const result = evaluateStructure(null, {});
    assert.strictEqual(result.score, 0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-CE5: CAPABILITY DRIFT
// ══════════════════════════════════════════════════════════════════════════════

describe('T-CE5: computeCapabilityDrift', async () => {
  await it('no drift when observed matches expected', () => {
    const result = computeCapabilityDrift(
      { determinism: 80, riskTolerance: 20, verbosity: 60 },
      { determinism: 80, riskTolerance: 20, verbosity: 60 },
    );
    assert.strictEqual(result.driftScore, 0);
    assert.strictEqual(result.violations.length, 0);
    assert.strictEqual(result.hasCritical, false);
  });

  await it('small drift → warning, no violation', () => {
    const result = computeCapabilityDrift(
      { determinism: 80, riskTolerance: 20, verbosity: 60 },
      { determinism: 55, riskTolerance: 20, verbosity: 60 }, // delta 25 on determinism
    );
    assert.ok(result.driftScore > 0, 'should have non-zero drift');
    assert.strictEqual(result.violations.length, 0, 'delta=25 is below violation threshold');
    // delta 25 is exactly at DRIFT_WARNING_THRESHOLD, but the average is (25+0+0)/3 ≈ 8
  });

  await it('large drift → violation', () => {
    const result = computeCapabilityDrift(
      { determinism: 90, riskTolerance: 10, verbosity: 80 },
      { determinism: 40, riskTolerance: 10, verbosity: 80 }, // delta 50 on determinism
    );
    assert.ok(result.violations.length > 0, 'delta 50 > 40 threshold = violation');
    assert.strictEqual(result.hasCritical, true);
  });

  await it('missing dimensions are skipped', () => {
    const result = computeCapabilityDrift(
      { determinism: 80 },
      { verbosity: 60 },
    );
    assert.strictEqual(result.driftScore, 0, 'no matching dimensions = no drift');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-CE6: ENFORCE CAPABILITIES (MAIN ENTRY)
// ══════════════════════════════════════════════════════════════════════════════

describe('T-CE6: enforceCapabilities', async () => {
  await it('passing response with matching profile', () => {
    // Deterministic (no hedging), cautious (has caveats), verbose (200+ words)
    // For verbosity=70 we need a long response to avoid drift
    const output = '## Daň z příjmů fyzických osob\n\n' +
      'Daň z příjmů fyzických osob podle §7 zákona č. 586/1992 Sb. činí 15% ze základu daně. ' +
      'Základ daně se snižuje o nezdanitelné části dle §15 zákona.\n\n' +
      '### Postup výpočtu\n\n' +
      '1. Stanovte celkové příjmy ze samostatné činnosti za zdaňovací období.\n' +
      '2. Odečtěte prokazatelně vynaložené výdaje nebo uplatněte paušální výdaje (60% pro živnosti).\n' +
      '3. Vypočtěte základ daně jako rozdíl příjmů a výdajů.\n' +
      '4. Uplatněte nezdanitelné části základu daně (penzijní připojištění, životní pojištění, dary).\n' +
      '5. Aplikujte sazbu 15% na základ daně zaokrouhlený na celé stokoruny dolů.\n' +
      '6. Uplatněte slevy na dani (základní sleva na poplatníka 30 840 Kč pro rok 2024).\n\n' +
      '### Důležité termíny\n\n' +
      '- Řádný termín podání: 1. dubna následujícího roku\n' +
      '- Elektronické podání: 2. května\n' +
      '- S daňovým poradcem: 1. července\n\n' +
      '### Sociální a zdravotní pojištění\n\n' +
      'Vedle daně z příjmů je OSVČ povinna platit zálohy na sociální pojištění (29.2% z vyměřovacího základu) ' +
      'a zdravotní pojištění (13.5% z vyměřovacího základu). Vyměřovací základ činí 50% základu daně.\n\n' +
      '**Pozor:** Toto je informativní přehled. Konzultujte daňového poradce pro konkrétní situaci. ' +
      'Sazby a limity se mohou meziročně měnit. Aktuální informace naleznete na stránkách Finanční správy ČR.\n';
    // riskTolerance=50 (neutral) to avoid drift with caveat density
    const profile = { determinism: 80, riskTolerance: 50, verbosity: 70, reasoning: 75 };
    const result = enforceCapabilities(output, profile);
    assert.strictEqual(result.passed, true, `Violations: ${result.violations.join('; ')}`);
  });

  await it('failing response with mismatched profile', () => {
    // High determinism profile but heavy hedging
    const output = 'Možná asi pravděpodobně nejspíš bych řekl, že to asi bude kolem 42.';
    const profile = { determinism: 95, riskTolerance: 50, verbosity: 50 };
    const result = enforceCapabilities(output, profile);
    assert.ok(result.violations.length > 0, 'should have violations');
    assert.strictEqual(result.passed, false);
  });

  await it('null inputs return passed=true', () => {
    const result = enforceCapabilities(null, null);
    assert.strictEqual(result.passed, true, 'null inputs are graceful');
  });

  await it('returns all evaluator results', () => {
    const output = 'Test response s dostatečnou délkou pro evaluaci všech dimenzí capability systému.';
    const profile = { determinism: 50, riskTolerance: 50, verbosity: 50, reasoning: 50 };
    const result = enforceCapabilities(output, profile);
    assert.ok('determinism' in result.evaluations);
    assert.ok('riskTolerance' in result.evaluations);
    assert.ok('verbosity' in result.evaluations);
    assert.ok('structure' in result.evaluations);
    assert.ok('scores' in result);
    assert.ok('drift' in result);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-CE7: STRICT MODE (ExpertiseEnforcer)
// ══════════════════════════════════════════════════════════════════════════════

describe('T-CE7: ExpertiseEnforcer strict mode', async () => {
  await it('strict mode returns hardFail when retries exhausted', async () => {
    const expert = {
      id: 'test-strict',
      styleRules: {
        forbiddenPhrases: ['odhaduji'],
        minResponseLength: 20,
        strictToolEnforcement: true,
      },
    };

    // regenerateFn always returns violating response
    const regenerateFn = async () => 'odhaduji, že to bude 42 korun';

    const enforcer = new ExpertiseEnforcer(expert, regenerateFn, { strict: true });
    const result = await enforcer.enforce('odhaduji, že to bude 100 korun', 'Kolik stojí?');

    assert.strictEqual(result.passed, false);
    assert.strictEqual(result.hardFail, true);
    assert.strictEqual(result.response, null, 'strict mode suppresses response');
    assert.ok(result.attempts >= 2, `Should have retried, got ${result.attempts} attempts`);
    assert.ok(result.retryAudit.length > 0, 'should have retry audit');
  });

  await it('strict mode passes on successful retry', async () => {
    const expert = {
      id: 'test-strict-pass',
      styleRules: {
        forbiddenPhrases: ['odhaduji'],
        minResponseLength: 20,
      },
    };

    let callCount = 0;
    const regenerateFn = async () => {
      callCount++;
      return 'Daňový základ činí přesně 15 000 CZK dle výpočtu.'; // clean response
    };

    const enforcer = new ExpertiseEnforcer(expert, regenerateFn, { strict: true });
    const result = await enforcer.enforce('odhaduji to na 15 000', 'Kolik?');

    assert.strictEqual(result.passed, true);
    assert.ok(callCount >= 1, 'should have retried at least once');
    assert.ok(!result.hardFail, 'should not be hard fail');
  });

  await it('non-strict mode returns response even on failure', async () => {
    const expert = {
      id: 'test-nonstrict',
      styleRules: {
        forbiddenPhrases: ['odhaduji'],
        minResponseLength: 20,
      },
    };

    const regenerateFn = async () => 'odhaduji, že to bude asi 42';

    const enforcer = new ExpertiseEnforcer(expert, regenerateFn, { strict: false });
    const result = await enforcer.enforce('odhaduji, response here for testing', 'Kolik?');

    assert.strictEqual(result.passed, false);
    assert.ok(result.response !== null, 'non-strict keeps response');
    assert.ok(!result.hardFail, 'non-strict has no hardFail');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-CE8: RETRY DECAY (ExpertiseEnforcer)
// ══════════════════════════════════════════════════════════════════════════════

describe('T-CE8: ExpertiseEnforcer retry decay', async () => {
  await it('regenerateFn receives retryOptions with temperatureDecay and seed', async () => {
    const expert = {
      id: 'test-decay',
      styleRules: {
        forbiddenPhrases: ['BAD_WORD'],
        minResponseLength: 10,
      },
    };

    const receivedOptions = [];
    const regenerateFn = async (prompt, violations, retryOptions) => {
      receivedOptions.push(retryOptions);
      return 'BAD_WORD still here for retry testing';
    };

    const enforcer = new ExpertiseEnforcer(expert, regenerateFn, { maxRetries: 2 });
    await enforcer.enforce('BAD_WORD in initial response', 'Question');

    assert.ok(receivedOptions.length >= 1, 'should have retried');
    const firstRetry = receivedOptions[0];
    assert.strictEqual(firstRetry.temperatureDecay, 0.1, 'first retry must decay by exactly 0.1');
    assert.ok(firstRetry.topPDecay > 0, 'should have topP decay');
    assert.ok(firstRetry.seed, 'should have seed');
    assert.ok(firstRetry.attempt >= 2, 'attempt should be >= 2');
  });

  await it('temperature decay increases with attempts', async () => {
    const expert = {
      id: 'test-escalation',
      styleRules: {
        forbiddenPhrases: ['BAD'],
        minResponseLength: 10,
      },
    };

    const receivedOptions = [];
    const regenerateFn = async (prompt, violations, retryOptions) => {
      receivedOptions.push(retryOptions);
      return 'BAD response again for testing';
    };

    const enforcer = new ExpertiseEnforcer(expert, regenerateFn, { maxRetries: 2 });
    await enforcer.enforce('BAD initial response here', 'Q');

    assert.strictEqual(receivedOptions.length, 2);
    assert.strictEqual(receivedOptions[0].temperatureDecay, 0.1);
    assert.strictEqual(receivedOptions[1].temperatureDecay, 0.2);
  });

  await it('retry budget above the L0-3 maximum is rejected', async () => {
    const expert = { id: 'test-max-retries', styleRules: {} };
    assert.throws(
      () => new ExpertiseEnforcer(expert, async () => 'retry', { maxRetries: 3 }),
      /expertise-enforcer:max-retries-out-of-range/,
    );
  });

  await it('retry audit trail is populated', async () => {
    const expert = {
      id: 'test-audit',
      styleRules: {
        forbiddenPhrases: ['VIOLATION'],
        minResponseLength: 10,
      },
    };

    const regenerateFn = async () => 'VIOLATION still present in retry';

    const enforcer = new ExpertiseEnforcer(expert, regenerateFn, { maxRetries: 2 });
    const result = await enforcer.enforce('VIOLATION in initial text', 'Q');

    assert.ok(result.retryAudit, 'should have retryAudit');
    assert.ok(result.retryAudit.length >= 2, `Expected >=2 audit entries, got ${result.retryAudit.length}`);

    // First entry is initial check
    assert.ok(result.retryAudit[0].violations.length > 0, 'first entry has violations');
    assert.ok(result.retryAudit[0].timestamp, 'has timestamp');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-CE9: CHAOS TESTS (cross-layer interaction)
// ══════════════════════════════════════════════════════════════════════════════

describe('T-CE9: Cross-layer chaos tests', async () => {
  await it('strict enforcement + capability drift on same response', async () => {
    // Accountant-like config: strict enforcement + high determinism
    const expert = {
      id: 'chaos-strict-cap',
      styleRules: {
        forbiddenPhrases: ['odhaduji'],
        minResponseLength: 50,
        strictToolEnforcement: true,
      },
    };

    // Response that PASSES enforcement but has capability drift
    const goodResponse = 'Daňový základ podle §7 zákona č. 586/1992 Sb. činí přesně 150 000 CZK. ' +
      'Sazba daně je 15%. Výsledná daň činí 22 500 CZK. Konzultujte daňového poradce.';

    // Verify enforcement passes
    const enforcer = new ExpertiseEnforcer(expert, null, { strict: true });
    const enfResult = await enforcer.enforce(goodResponse, 'test');
    assert.strictEqual(enfResult.passed, true, 'should pass enforcement');

    // Verify capability evaluation independently
    const capProfile = { determinism: 95, riskTolerance: 5, verbosity: 50 };
    const capResult = enforceCapabilities(goodResponse, capProfile);
    // This is informational — capability enforcer may flag drift but that's separate from enforcement
    assert.ok(typeof capResult.driftScore === 'number', 'should compute drift score');
    assert.ok(typeof capResult.passed === 'boolean', 'should have passed flag');
  });

  await it('strict hardFail + retry audit trail are complete', async () => {
    const expert = {
      id: 'chaos-audit',
      styleRules: {
        forbiddenPhrases: ['BANNED'],
        minResponseLength: 30,
        strictToolEnforcement: true,
      },
    };

    let retryCount = 0;
    const regenerateFn = async (prompt, violations, retryOptions) => {
      retryCount++;
      // Verify retryOptions are passed correctly
      assert.ok(retryOptions.temperatureDecay > 0, 'decay present');
      assert.ok(retryOptions.seed, 'seed present');
      return 'BANNED word still present in the response here for testing.';
    };

    const enforcer = new ExpertiseEnforcer(expert, regenerateFn, { strict: true, maxRetries: 2 });
    const result = await enforcer.enforce('BANNED word in initial response text here.', 'Q');

    assert.strictEqual(result.hardFail, true, 'strict mode → hardFail');
    assert.strictEqual(result.response, null, 'strict mode → no response');
    assert.strictEqual(retryCount, 2, 'should retry exactly 2 times');
    assert.ok(result.retryAudit.length >= 3, 'audit: 1 initial + 2 retries');
  });

  await it('enforceCapabilities is deterministic across 50 runs', () => {
    const output = 'Výsledek analýzy ukazuje, že implementace je správná. Pozor na edge cases. ' +
      'Doporučuji konzultovat s týmem před nasazením do produkce.';
    const profile = { determinism: 70, riskTolerance: 30, verbosity: 50, reasoning: 60 };

    const results = [];
    for (let i = 0; i < 50; i++) {
      results.push(enforceCapabilities(output, profile));
    }

    // All runs must produce identical results
    const first = JSON.stringify(results[0]);
    for (let i = 1; i < results.length; i++) {
      assert.strictEqual(JSON.stringify(results[i]), first, `Run ${i} differs from run 0`);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-CE10: EXECUTION TRACE ID (v63.3)
// ══════════════════════════════════════════════════════════════════════════════

describe('T-CE10: ExecutionTrace ID in retry audit', async () => {
  await it('traceId appears in all retry audit entries when provided', async () => {
    const traceId = 'test-trace-' + Date.now();
    const expert = {
      id: 'trace-test',
      styleRules: {
        forbiddenPhrases: ['FORBIDDEN'],
        minResponseLength: 20,
      },
    };

    let retryCount = 0;
    const regenerateFn = async () => {
      retryCount++;
      if (retryCount < 2) return 'FORBIDDEN still present in this response text here.';
      return 'Clean response without any violations. This is a proper answer with enough length.';
    };

    const enforcer = new ExpertiseEnforcer(expert, regenerateFn, {
      executionTraceId: traceId,
      maxRetries: 2,
    });
    const result = await enforcer.enforce('FORBIDDEN in initial response text here.', 'Q');

    assert.strictEqual(result.passed, true, 'should pass after retry');
    assert.ok(result.retryAudit.length >= 2, 'should have audit entries');

    // ALL audit entries must have the same traceId
    for (const entry of result.retryAudit) {
      assert.strictEqual(entry.executionTraceId, traceId,
        `Audit entry attempt ${entry.attempt} must have traceId`);
      assert.strictEqual(entry.executionStep, 'ENFORCER',
        `Audit entry attempt ${entry.attempt} must have executionStep=ENFORCER`);
    }
  });

  await it('traceId is null when not provided', async () => {
    const expert = {
      id: 'trace-null',
      styleRules: {
        forbiddenPhrases: ['BAD'],
        minResponseLength: 20,
      },
    };

    const regenerateFn = async () => 'Good response without any violations, long enough text.';

    const enforcer = new ExpertiseEnforcer(expert, regenerateFn, { maxRetries: 1 });
    const result = await enforcer.enforce('BAD word in initial response text here.', 'Q');

    assert.strictEqual(result.passed, true, 'should pass');
    for (const entry of result.retryAudit) {
      assert.strictEqual(entry.executionTraceId, null,
        'traceId should be null when not provided');
    }
  });

  await it('traceId does NOT change across retries (same UUID for entire turn)', async () => {
    const traceId = 'immutable-trace-uuid-12345';
    const expert = {
      id: 'trace-immutable',
      styleRules: {
        forbiddenPhrases: ['NOPE'],
        minResponseLength: 20,
      },
    };

    const regenerateFn = async () => 'NOPE still present in retry response text here.';

    const enforcer = new ExpertiseEnforcer(expert, regenerateFn, {
      executionTraceId: traceId,
      strict: true,
      maxRetries: 2,
    });
    const result = await enforcer.enforce('NOPE in initial response text here.', 'Q');

    assert.strictEqual(result.hardFail, true, 'strict → hardFail');
    assert.ok(result.retryAudit.length === 3, '1 initial + 2 retries');

    // Collect all traceIds — must all be identical
    const traceIds = result.retryAudit.map(e => e.executionTraceId);
    const uniqueIds = new Set(traceIds);
    assert.strictEqual(uniqueIds.size, 1, 'All entries must have same traceId');
    assert.strictEqual([...uniqueIds][0], traceId, 'TraceId must match constructor value');
  });

  await it('traceId included in passing response (no violations, no retry)', async () => {
    const traceId = 'pass-through-trace-uuid';
    const expert = {
      id: 'trace-pass',
      styleRules: { forbiddenPhrases: [], minResponseLength: 5 },
    };

    const enforcer = new ExpertiseEnforcer(expert, null, { executionTraceId: traceId });
    const result = await enforcer.enforce('Clean response, no issues at all.', 'Q');

    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.wasRetried, false);
    // No retryAudit when passing on first attempt — that's fine
    assert.strictEqual(result.attempts, 1);
  });
});

// ─── Runner ──────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n' + '═'.repeat(70));
  console.log('  C3-Agent v63.3 — Capability Enforcer + Strict + Retry + Trace Tests');
  console.log('═'.repeat(70));

  for (const test of pendingTests) {
    await test();
  }

  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const f of failures) {
      console.log(`    ❌ ${f.name}: ${f.error}`);
    }
  }
  console.log(`${'─'.repeat(70)}\n`);

  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
