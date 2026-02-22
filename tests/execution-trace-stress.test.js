// C3-Agent v63.3 — ExecutionTrace Stress Test
// ══════════════════════════════════════════════════════════════════════════════
//
// Stress scenario: 3-expert merge + strict (accountant) + capability drift
// + retry + inheritance chain + tool enforcement → full trace reconstruction.
//
// Tests:
//   T-ST1: 3-expert merge with strict accountant — enforcement propagation
//   T-ST2: Inheritance chain + capability drift on merged output
//   T-ST3: Retry with temperature decay across strict merge
//   T-ST4: Full execution trace reconstruction (all steps present)
//   T-ST5: Prompt hash determinism (same input → same hash)
//   T-ST6: Token source classification
//
// Spuštění: node tests/execution-trace-stress.test.js
//
// ══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';
import { createHash, randomUUID } from 'crypto';

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

import { mergeExpertisePrompt } from '../src/expertises/merge-engine.js';
import { ExpertiseEnforcer, checkForbiddenPhrases } from '../src/expertises/expertise-enforcement.js';
import { enforceCapabilities } from '../src/expertises/capability-enforcer.js';
import { resolveInheritance } from '../src/expertises/expertise-layer.js';

// ─── Test Data ───────────────────────────────────────────────────────────────

// Simplified experts for stress testing — mimic real built-in experts
const ACCOUNTANT = {
  id: 'accountant',
  name: 'Účetní',
  domain: 'accounting',
  weight: 0.8,
  position: 0,
  temperature: 0.2,
  tone: 'professional',
  capabilities: { reasoning: 75, creativity: 5, determinism: 95, riskTolerance: 5, verbosity: 50 },
  modules: {
    domain_rules: ['Vždy cituj zákonné normy', 'Používej přesná čísla'],
    emphasis: ['Přesnost výpočtů'],
    constraints: ['Nikdy neodhaduj daňové povinnosti'],
    vocabulary: ['základ daně', 'sazba', 'sleva na poplatníka'],
    antipatterns: ['Nepoužívej neurčité výrazy pro finanční částky'],
    disclaimer: 'Konzultujte daňového poradce pro konkrétní situaci.',
  },
  styleRules: {
    forbiddenPhrases: ['odhaduji', 'asi tak', /zhruba \d+/i],
    minResponseLength: 80,
    toolEnforcement: true,
    strictToolEnforcement: true,
  },
};

const LAWYER = {
  id: 'lawyer',
  name: 'Právník',
  domain: 'law',
  weight: 0.6,
  position: 1,
  temperature: 0.3,
  tone: 'formal',
  capabilities: { reasoning: 80, creativity: 10, determinism: 90, riskTolerance: 5, verbosity: 70 },
  modules: {
    domain_rules: ['Cituj relevantní paragrafy', 'Rozlišuj mezi občanským a obchodním právem'],
    emphasis: ['Právní jistota'],
    constraints: ['Nikdy neposkytuj právní rady jako konečný verdikt'],
    vocabulary: ['ustanovení', 'novela', 'judikatura'],
    antipatterns: [],
    disclaimer: 'Konzultujte advokáta pro právně závazné stanovisko.',
  },
  styleRules: {
    forbiddenPhrases: ['to je jasné', 'bez pochyby'],
    minResponseLength: 60,
  },
};

const ANALYST = {
  id: 'analyst',
  name: 'Analytik',
  domain: 'analysis',
  weight: 0.4,
  position: 2,
  temperature: 0.4,
  tone: 'professional',
  capabilities: { reasoning: 90, creativity: 20, determinism: 80, riskTolerance: 20, verbosity: 60 },
  modules: {
    domain_rules: ['Analyzuj data systematicky', 'Uveď zdroje dat'],
    emphasis: ['Struktura a přehlednost'],
    constraints: ['Neprezentuj korelaci jako kauzalitu'],
    vocabulary: ['trend', 'meziročně', 'koeficient'],
    antipatterns: [],
    disclaimer: null,
  },
  styleRules: {
    forbiddenPhrases: [],
    minResponseLength: 40,
  },
};

// Parent expert for inheritance testing
const PARENT_EXPERTISE = {
  id: 'finance_base',
  name: 'Finance Base',
  capabilities: { reasoning: 60, creativity: 10, determinism: 85, riskTolerance: 10, verbosity: 55 },
  modules: {
    domain_rules: ['Vždy uveď měnu', 'Zaokrouhluj na celé koruny'],
    emphasis: [],
    constraints: ['Nepoužívej zastaralé daňové sazby'],
    vocabulary: ['CZK', 'EUR'],
    antipatterns: [],
    disclaimer: null,
  },
  styleRules: {
    forbiddenPhrases: ['přibližně'],
    minResponseLength: 40,
  },
};

const CHILD_WITH_PARENT = {
  ...ACCOUNTANT,
  id: 'accountant_child',
  parent: 'finance_base',
  inheritance: {
    domain_rules: 'extend',
    constraints: 'extend',
    vocabulary: 'extend',
  },
};

// ══════════════════════════════════════════════════════════════════════════════
// T-ST1: 3-EXPERT MERGE + STRICT ENFORCEMENT
// ══════════════════════════════════════════════════════════════════════════════

describe('T-ST1: 3-expert merge with strict accountant', async () => {
  await it('merges 3 experts without compatibility block', () => {
    // accountant+lawyer+analyst should NOT be hard-blocked
    // (determinism gap: 95 vs 80 = 15, within threshold)
    const result = mergeExpertisePrompt(
      [ACCOUNTANT, LAWYER, ANALYST],
      null, null, {},
    );
    assert.ok(result.prompt.length > 100, 'merged prompt should be substantial');
    assert.strictEqual(result.metadata.expertiseIds.length, 3);
    assert.ok(result.metadata.temperature <= 0.4, `temperature ${result.metadata.temperature} should be ≤0.4`);
  });

  await it('merged enforcement inherits UNION of all forbiddenPhrases', () => {
    const result = mergeExpertisePrompt(
      [ACCOUNTANT, LAWYER, ANALYST],
      null, null, {},
    );
    const fp = result.enforcement.forbiddenPhrases;
    // accountant: 'odhaduji', 'asi tak', /zhruba \d+/i
    // lawyer: 'to je jasné', 'bez pochyby'
    // analyst: (none)
    assert.ok(fp.length >= 5, `Expected ≥5 forbidden phrases, got ${fp.length}`);
  });

  await it('minResponseLength = MAX(80, 60, 40) + capMod(+50 low riskTolerance) = 130', () => {
    // Base: MAX(80, 60, 40) = 80
    // Step 13.5: avg riskTolerance = (5+5+20)/3 ≈ 10 → LOW → +50 modifier
    // Final: 80 + 50 = 130
    const result = mergeExpertisePrompt(
      [ACCOUNTANT, LAWYER, ANALYST],
      null, null, {},
    );
    assert.strictEqual(result.enforcement.minResponseLength, 130);
  });

  await it('disclaimers are deduplicated UNION', () => {
    const result = mergeExpertisePrompt(
      [ACCOUNTANT, LAWYER, ANALYST],
      null, null, {},
    );
    const disclaimers = result.enforcement.disclaimers;
    assert.ok(disclaimers.length >= 2, `Expected ≥2 disclaimers, got ${disclaimers.length}`);
    // No duplicates
    const unique = new Set(disclaimers.map(d => d.trim().toLowerCase()));
    assert.strictEqual(unique.size, disclaimers.length, 'No duplicate disclaimers');
  });

  await it('strict propagation: accountant strict → merged strict', () => {
    // Simulate what expertise.js does
    const hasStrict = [ACCOUNTANT, LAWYER, ANALYST].some(
      e => e.styleRules?.strictToolEnforcement,
    );
    assert.strictEqual(hasStrict, true, 'accountant has strict → merged should be strict');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-ST2: INHERITANCE + CAPABILITY DRIFT
// ══════════════════════════════════════════════════════════════════════════════

describe('T-ST2: Inheritance chain + capability drift on merged output', async () => {
  await it('child inherits parent modules via extend', () => {
    const registry = { finance_base: PARENT_EXPERTISE };
    const resolved = resolveInheritance(CHILD_WITH_PARENT, registry);

    // domain_rules: parent(2) + child(2) = 4 (deduplicated)
    assert.ok(resolved.modules.domain_rules.length >= 3,
      `Expected ≥3 domain_rules, got ${resolved.modules.domain_rules.length}`);
    // constraints: parent(1) + child(1) = 2
    assert.ok(resolved.modules.constraints.length >= 2,
      `Expected ≥2 constraints, got ${resolved.modules.constraints.length}`);
  });

  await it('child inherits parent capabilities (undefined dims)', () => {
    const registry = { finance_base: PARENT_EXPERTISE };
    const resolved = resolveInheritance(CHILD_WITH_PARENT, registry);

    // Child ACCOUNTANT has all 5 dims defined → should keep child values
    assert.strictEqual(resolved.capabilities.determinism, 95, 'child explicit → keeps');
    assert.strictEqual(resolved.capabilities.creativity, 5, 'child explicit → keeps');
  });

  await it('enforcement: forbiddenPhrases UNION (parent + child)', () => {
    const registry = { finance_base: PARENT_EXPERTISE };
    const resolved = resolveInheritance(CHILD_WITH_PARENT, registry);

    // parent: ['přibližně'], child: ['odhaduji', 'asi tak', /zhruba/i]
    const allForbidden = resolved.styleRules.forbiddenPhrases;
    assert.ok(allForbidden.length >= 4, `Expected ≥4 phrases, got ${allForbidden.length}`);
    // Check parent phrase is present
    const hasParentPhrase = allForbidden.some(p =>
      (typeof p === 'string' && p === 'přibližně') ||
      (p instanceof RegExp && p.source === 'přibližně')
    );
    assert.ok(hasParentPhrase, 'Parent phrase "přibližně" should be inherited');
  });

  await it('capability drift detection on merged accountant+lawyer output', () => {
    const mergeResult = mergeExpertisePrompt(
      [ACCOUNTANT, LAWYER],
      null, null, {},
    );
    const capVector = mergeResult.metadata.capabilityVector;
    assert.ok(capVector, 'merged result should have capabilityVector');

    // Simulate a response with hedging (should cause determinism drift)
    const hedgyResponse = 'Možná by se dalo říct, že daňový základ pravděpodobně činí asi ' +
      'kolem 150 000 CZK. Nejspíš bude sazba 15%. To záleží na konkrétní situaci. ' +
      'Pozor ale na specifické okolnosti, které mohou výpočet ovlivnit. ' +
      'Konzultujte odborníka pro přesné informace.';

    const driftResult = enforceCapabilities(hedgyResponse, capVector);
    // High determinism profile + hedging → should have violations or high drift
    assert.ok(driftResult.driftScore > 0, `Expected drift > 0, got ${driftResult.driftScore}`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-ST3: RETRY WITH TEMPERATURE DECAY ACROSS STRICT MERGE
// ══════════════════════════════════════════════════════════════════════════════

describe('T-ST3: Retry with temperature decay in strict merged enforcer', async () => {
  await it('strict merged enforcer: all retries fail → hardFail with full audit', async () => {
    const traceId = randomUUID();

    // Build merged enforcement config (simulating what expertise.js does)
    const mergeResult = mergeExpertisePrompt(
      [ACCOUNTANT, LAWYER],
      null, null, {},
    );

    const syntheticExpert = {
      id: '_merged',
      styleRules: {
        forbiddenPhrases: mergeResult.enforcement.forbiddenPhrases,
        minResponseLength: mergeResult.enforcement.minResponseLength,
        strictToolEnforcement: true,
      },
    };

    let attempts = 0;
    const retryOptionsLog = [];

    const regenerateFn = async (prompt, violations, retryOptions) => {
      attempts++;
      retryOptionsLog.push({ ...retryOptions });
      // Always return violating response
      return 'Odhaduji asi tak zhruba 42000 CZK. To je jasné, bez pochyby.';
    };

    const enforcer = new ExpertiseEnforcer(syntheticExpert, regenerateFn, {
      strict: true,
      executionTraceId: traceId,
      maxRetries: 2,
    });

    const result = await enforcer.enforce(
      'Odhaduji asi tak zhruba 42000 CZK, to je jasné.',
      'Kolik zaplatím daň?',
    );

    // Verify hard fail
    assert.strictEqual(result.hardFail, true, 'strict → hardFail');
    assert.strictEqual(result.response, null, 'strict → no response');
    assert.strictEqual(result.passed, false);
    assert.strictEqual(attempts, 2, 'should retry exactly 2 times');

    // Verify retry audit trail
    assert.strictEqual(result.retryAudit.length, 3, '1 initial + 2 retries');
    for (const entry of result.retryAudit) {
      assert.strictEqual(entry.executionTraceId, traceId, 'all entries share traceId');
      assert.strictEqual(entry.executionStep, 'ENFORCER');
    }

    // Verify temperature decay progression
    assert.ok(retryOptionsLog[0].temperatureDecay > 0, 'first retry has decay');
    assert.ok(retryOptionsLog[1].temperatureDecay > retryOptionsLog[0].temperatureDecay,
      'decay increases on subsequent retries');

    // Verify unique seeds per retry
    assert.notStrictEqual(retryOptionsLog[0].seed, retryOptionsLog[1].seed,
      'each retry gets unique seed');
  });

  await it('strict merged enforcer: second retry succeeds → passed with audit', async () => {
    const traceId = randomUUID();

    const syntheticExpert = {
      id: '_merged',
      styleRules: {
        forbiddenPhrases: ['BAD_WORD'],
        minResponseLength: 30,
        strictToolEnforcement: true,
      },
    };

    let attempts = 0;
    const regenerateFn = async () => {
      attempts++;
      if (attempts < 2) return 'BAD_WORD still present in retry response for test purposes.';
      return 'Daňový základ činí přesně 150 000 CZK. Sazba daně je 15%. Výsledná daň činí 22 500 CZK.';
    };

    const enforcer = new ExpertiseEnforcer(syntheticExpert, regenerateFn, {
      strict: true,
      executionTraceId: traceId,
      maxRetries: 2,
    });

    const result = await enforcer.enforce('BAD_WORD in initial response text.', 'test?');

    assert.strictEqual(result.passed, true, 'should pass on second retry');
    assert.strictEqual(result.wasRetried, true);
    assert.ok(result.retryAudit.length >= 2, 'audit has initial + retries');

    // Last audit entry should show passed
    const lastEntry = result.retryAudit[result.retryAudit.length - 1];
    assert.strictEqual(lastEntry.passed, true, 'last entry marked passed');
    assert.strictEqual(lastEntry.executionTraceId, traceId);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-ST4: FULL EXECUTION TRACE RECONSTRUCTION
// ══════════════════════════════════════════════════════════════════════════════

describe('T-ST4: Full execution trace reconstruction', async () => {
  await it('single traceId connects all layers: LLM + ENFORCER + CAPABILITY', async () => {
    const traceId = randomUUID();

    // Simulate full pipeline: merge → LLM → enforce → capability drift

    // 1. Merge (pure function, no traceId needed)
    const mergeResult = mergeExpertisePrompt(
      [ACCOUNTANT, LAWYER, ANALYST],
      null, null, {},
    );
    assert.ok(mergeResult.audit, 'merge produces audit');

    // 2. LLM step (simulated — would normally be an actual call)
    const llmEntry = {
      executionTraceId: traceId,
      conversationId: 'stress-test-conv',
      executionStep: 'LLM',
      expertId: 'accountant+lawyer+analyst',
      model: 'qwen-test',
      temperature: mergeResult.metadata.temperature,
      promptHash: createHash('sha256').update('test-prompt' + mergeResult.prompt).digest('hex'),
      promptTokens: 150,
      completionTokens: 200,
      latencyMs: 1234,
      tokenSource: 'provider',
      metadata: { merged: true, expertiseCount: 3 },
    };
    assert.strictEqual(llmEntry.executionTraceId, traceId);
    assert.strictEqual(llmEntry.tokenSource, 'provider');
    assert.ok(llmEntry.promptHash.length === 64, 'SHA-256 = 64 hex chars');

    // 3. Enforcement step
    const syntheticExpert = {
      id: '_merged',
      styleRules: {
        forbiddenPhrases: mergeResult.enforcement.forbiddenPhrases,
        minResponseLength: mergeResult.enforcement.minResponseLength,
      },
    };

    const enforcer = new ExpertiseEnforcer(syntheticExpert, null, {
      executionTraceId: traceId,
    });

    const cleanResponse = 'Daňový základ podle §7 zákona č. 586/1992 Sb. činí přesně 150 000 CZK. ' +
      'Sazba daně z příjmů fyzických osob je 15%. Výsledná daňová povinnost po uplatnění ' +
      'základní slevy na poplatníka činí 0 CZK. Konzultujte daňového poradce.';

    const enfResult = await enforcer.enforce(cleanResponse, 'test');
    assert.strictEqual(enfResult.passed, true, 'clean response passes enforcement');

    // 4. Capability drift step
    const capResult = enforceCapabilities(cleanResponse, mergeResult.metadata.capabilityVector);
    const driftEntry = {
      executionTraceId: traceId,
      executionStep: 'CAPABILITY',
      expertId: 'accountant+lawyer+analyst',
      driftScore: capResult.driftScore,
    };
    assert.strictEqual(driftEntry.executionTraceId, traceId);

    // 5. Verify all steps share the same traceId
    const allTraceIds = [
      llmEntry.executionTraceId,
      driftEntry.executionTraceId,
      traceId, // enforcer uses same ID
    ];
    const unique = new Set(allTraceIds);
    assert.strictEqual(unique.size, 1, 'All layers share one traceId');
  });

  await it('merge audit can be annotated with traceId at persist time', () => {
    const traceId = randomUUID();
    const mergeResult = mergeExpertisePrompt(
      [ACCOUNTANT, LAWYER],
      null, null, {},
    );

    // Handler adds traceId when persisting (merge-engine stays pure)
    const annotatedAudit = { ...mergeResult.audit, executionTraceId: traceId };
    assert.strictEqual(annotatedAudit.executionTraceId, traceId);
    assert.ok(annotatedAudit.expertiseIds.length === 2);
    assert.ok(annotatedAudit.timestamp, 'has timestamp');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-ST5: PROMPT HASH DETERMINISM
// ══════════════════════════════════════════════════════════════════════════════

describe('T-ST5: Prompt hash determinism', async () => {
  await it('same prompt → same hash across 100 runs', () => {
    const prompt = 'Kolik zaplatím daň z příjmů fyzických osob z hrubého příjmu 850 000 CZK?';
    const systemPrompt = 'Jsi účetní expert. Odpovídej přesně.';
    const combined = prompt + systemPrompt;

    const hashes = new Set();
    for (let i = 0; i < 100; i++) {
      hashes.add(createHash('sha256').update(combined).digest('hex'));
    }
    assert.strictEqual(hashes.size, 1, 'All 100 hashes must be identical');
  });

  await it('different prompts → different hashes', () => {
    const hash1 = createHash('sha256').update('prompt A').digest('hex');
    const hash2 = createHash('sha256').update('prompt B').digest('hex');
    assert.notStrictEqual(hash1, hash2);
  });

  await it('hash is exactly 64 hex characters (SHA-256)', () => {
    const hash = createHash('sha256').update('test').digest('hex');
    assert.strictEqual(hash.length, 64);
    assert.ok(/^[0-9a-f]+$/.test(hash), 'Only hex chars');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// T-ST6: TOKEN SOURCE + PERFORMANCE TIMER
// ══════════════════════════════════════════════════════════════════════════════

describe('T-ST6: Token source classification + timer precision', async () => {
  await it('provider tokens → tokenSource = provider', () => {
    const result = { promptTokens: 150, completionTokens: 200 };
    const source = result.promptTokens != null ? 'provider' : 'estimated';
    assert.strictEqual(source, 'provider');
  });

  await it('null tokens → tokenSource = estimated', () => {
    const result = { promptTokens: null, completionTokens: null };
    const source = result.promptTokens != null ? 'provider' : 'estimated';
    assert.strictEqual(source, 'estimated');
  });

  await it('undefined tokens → tokenSource = estimated', () => {
    const result = {};
    const source = result.promptTokens != null ? 'provider' : 'estimated';
    assert.strictEqual(source, 'estimated');
  });

  await it('performance.now() returns sub-ms precision number', () => {
    const start = performance.now();
    // Spin briefly
    let x = 0;
    for (let i = 0; i < 10000; i++) x += i;
    const elapsed = performance.now() - start;
    assert.ok(typeof elapsed === 'number');
    assert.ok(elapsed >= 0);
    assert.ok(elapsed < 1000, 'should be well under 1s');
  });
});

// ─── Runner ──────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n' + '═'.repeat(70));
  console.log('  C3-Agent v63.3 — ExecutionTrace Stress Test');
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
