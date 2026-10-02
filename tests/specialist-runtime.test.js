// D1: Specialist Runtime — Unit Tests
// ═══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';
import { readFileSync } from 'node:fs';
import {
  specialistRuntime,
  ToolRegistry,
  IntentDetector,
  SpecialistRuntime,
} from '../src/expertises/specialist-runtime.js';
import { ToolAdapter } from '../src/expertises/tool-adapter.js';
import {
  EXTENSION_HOST_CAPABILITY,
  canonicalizeLegacySpecialistManifest,
  createExtensionContextV1,
} from '../contracts/m3/extension-v1.js';
import { register as registerAccountant } from '../specialists/accountant-cz/index.js';

// Accountant is a self-contained dynamic specialist since v121. Activate its
// real package entry point explicitly through the same frozen ExtensionContext
// boundary used by the production loader.
const accountantManifest = canonicalizeLegacySpecialistManifest(JSON.parse(readFileSync(
  new URL('../specialists/accountant-cz/specialist.json', import.meta.url),
  'utf8',
)));
await registerAccountant(createExtensionContextV1({
  manifest: accountantManifest,
  hostCapabilities: {
    [EXTENSION_HOST_CAPABILITY.SPECIALIST_RUNTIME]: specialistRuntime,
    [EXTENSION_HOST_CAPABILITY.TOOL_ADAPTER]: ToolAdapter,
  },
}));

let passed = 0, failed = 0;
const failures = [];

function it(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; failures.push(name); console.log(`  ❌ ${name}: ${err.message}`); }
}

// ─── 1. Registry ─────────────────────────────────────────────────────────────

console.log('\n── 1. ToolRegistry ──');

it('accountant is registered as specialist', () => {
  assert(specialistRuntime.isSpecialist('accountant'));
});

it('non-existent specialist returns false', () => {
  assert(!specialistRuntime.isSpecialist('nonexistent'));
});

it('accountant has 6 tools', () => {
  const config = specialistRuntime.getSpecialistConfig('accountant');
  assert(config);
  assert.equal(config.tools.length, 6);
  assert.equal(config.domain, 'finance');
});

it('getSpecialistIds includes accountant', () => {
  const ids = specialistRuntime.getSpecialistIds();
  assert(ids.includes('accountant'));
});

it('getSpecialistConfig returns tool metadata', () => {
  const config = specialistRuntime.getSpecialistConfig('accountant');
  const toolIds = config.tools.map(t => t.id);
  assert(toolIds.includes('accountant.tax_calculator'));
  assert(toolIds.includes('accountant.vat_calculator'));
  assert(toolIds.includes('accountant.salary_calculator'));
  assert(toolIds.includes('accountant.deadline_checker'));
  assert(toolIds.includes('accountant.compare_tax_entities'));
});

// ─── 2. Intent Detection ─────────────────────────────────────────────────────

console.log('\n── 2. IntentDetector ──');

const detector = new IntentDetector();
const accountantConfig = specialistRuntime.registry.getSpecialist('accountant');

it('detects VAT query: "kolik je DPH z 10000"', () => {
  const match = detector.detect('kolik je DPH z 10000', accountantConfig);
  assert(match);
  assert.equal(match.tool.id, 'accountant.vat_calculator');
  assert.equal(match.params.amount, 10000);
});

it('detects salary query: "čistá mzda z 50000"', () => {
  const match = detector.detect('čistá mzda z 50000', accountantConfig);
  assert(match);
  assert.equal(match.tool.id, 'accountant.salary_calculator');
  assert.equal(match.params.gross_salary, 50000);
});

it('detects tax query: "kolik zaplatím daně z 850k OSVČ"', () => {
  const match = detector.detect('kolik zaplatím daně z 850k OSVČ', accountantConfig);
  assert(match);
  assert.equal(match.tool.id, 'accountant.tax_calculator');
  assert.equal(match.params.gross_income, 850000);
  assert.equal(match.params.entity_type, 'osvc');
});

it('detects deadline query: "kdy je termín přiznání"', () => {
  const match = detector.detect('kdy je termín daňového přiznání', accountantConfig);
  assert(match);
  assert.equal(match.tool.id, 'accountant.deadline_checker');
});

it('detects comparison query: "porovnej OSVČ vs s.r.o."', () => {
  const match = detector.detect('porovnej OSVČ vs s.r.o. při příjmu 850k', accountantConfig);
  assert(match);
  assert.equal(match.tool.id, 'accountant.compare_tax_entities');
});

it('returns null for non-matching input', () => {
  const match = detector.detect('jaké je počasí?', accountantConfig);
  assert.equal(match, null);
});

it('returns null for short input', () => {
  const match = detector.detect('hi', accountantConfig);
  assert.equal(match, null);
});

it('extracts year from context', () => {
  const match = detector.detect('kolik zaplatím daně za rok 2025 z 500k OSVČ', accountantConfig);
  assert(match);
  assert.equal(match.params.year, 2025);
  assert.equal(match.params.gross_income, 500000);
});

it('extracts VAT direction (remove)', () => {
  const match = detector.detect('cena bez DPH z 12100', accountantConfig);
  assert(match);
  assert.equal(match.params.direction, 'remove');
});

it('extracts VAT reduced rate (12%)', () => {
  const match = detector.detect('DPH se sníženou sazbou z 10000', accountantConfig);
  assert(match);
  assert.equal(match.params.rate, '12');
});

// ─── 3. Tool Execution ──────────────────────────────────────────────────────

console.log('\n── 3. Tool Execution (async) ──');

async function runAsyncTests() {
  // tryToolExecution — full pipeline
  const vatInput = 'kolik je DPH z 10000';
  // An offline fixture supplies the semantic meaning. The runtime still
  // validates numeric grounding and runs the real deterministic calculator.
  const vatResult = await specialistRuntime.tryToolExecution('accountant', vatInput, {
    interpretInput: async () => ({ contract: 'VatIntent', version: 1,
      action: 'calculate', amount: 10000, rate: '21', year: 2025, direction: 'add',
      presentation: { style: 'table', itemCount: null, itemCountSource: null },
      segments: [{ text: vatInput, kind: 'calculation' }], clarification: null }),
  });
  it('tryToolExecution returns VAT result', () => {
    assert(vatResult);
    assert.equal(vatResult.toolType, 'accountant.vat_calculator');
    assert(vatResult.result);
  });

  const salaryResult = await specialistRuntime.tryToolExecution('accountant', 'čistá mzda z 50000 za rok 2025');
  it('tryToolExecution returns salary result', () => {
    assert(salaryResult);
    assert.equal(salaryResult.toolType, 'accountant.salary_calculator');
  });

  const taxResult = await specialistRuntime.tryToolExecution('accountant', 'daně z 850k OSVČ za rok 2025');
  it('tryToolExecution returns tax result', () => {
    assert(taxResult);
    assert.equal(taxResult.toolType, 'accountant.tax_calculator');
    assert.equal(typeof taxResult.presentation, 'string');
    assert.match(taxResult.presentation, /Celkové daňové zatížení/);
    assert.match(taxResult.presentation, /informativní přehled/);
  });

  const wordMillionTax = await specialistRuntime.tryToolExecution(
    'accountant',
    'Jakou celkovou dan z prijmu zaplatim pri primu milion korun jako zivnostnik?',
  );
  it('tax calculator parses a Czech word-million amount and renders it deterministically', () => {
    assert(wordMillionTax);
    assert.equal(wordMillionTax.params.gross_income, 1000000);
    assert.equal(wordMillionTax.result.gross_income, 1000000);
    assert.equal(typeof wordMillionTax.presentation, 'string');
    assert.match(wordMillionTax.presentation, /1[^\d]*000[^\d]*000/);
  });

  const noMatch = await specialistRuntime.tryToolExecution('accountant', 'jaké je počasí?');
  it('tryToolExecution returns null for no match', () => {
    assert.equal(noMatch, null);
  });

  const noSpecialist = await specialistRuntime.tryToolExecution('writer', 'write a story');
  it('tryToolExecution returns null for non-specialist', () => {
    assert.equal(noSpecialist, null);
  });


  // Eligibility is independent of calculator execution. Information requests
  // must reach the existing reader fallback; arithmetic stays source-grounded.
  const informationInputs = [
    'Co je DPH v Německu?',
    'Vysvětli mi prosím význam DPH.',
    'Jaké jsou sazby DPH ve Francii?',
    'Co znamená DPH pro spotřebitele?',
    'Můžeš stručně popsat DPH v Evropské unii?',
    'K čemu slouží DPH?',
    'Jaká je sazba DPH 21 %?',
    'Jaká je sazba DPH za rok 2025?',
  ];
  const vatTool = accountantConfig.tools.find(tool => tool.id === 'accountant.vat_calculator');
  const originalVatRun = vatTool.toolAdapter.run;
  const originalVatExecute = vatTool.toolAdapter.execute;
  let vatExecutions = 0, arithmeticCalls = 0;
  vatTool.toolAdapter.execute = function (...args) {
    arithmeticCalls++;
    return originalVatExecute.apply(this, args);
  };
  vatTool.toolAdapter.run = function (...args) {
    vatExecutions++;
    return originalVatRun.apply(this, args);
  };
  try {
    for (const input of informationInputs) {
      const before = vatExecutions;
      const answer = await specialistRuntime.tryToolExecution('accountant', input);
      it(`informational VAT has no calculator/clarifier: ${input}`, () => {
        assert.equal(answer, null);
        assert.equal(vatExecutions, before);
      });
    }
    const informationPlan = input => ({ contract: 'VatIntent', version: 1,
      action: 'clarify', amount: null, rate: '21', year: 2025, direction: null,
      presentation: { style: 'explanation', itemCount: null, itemCountSource: null },
      segments: [{ text: input, kind: 'context' }], clarification: 'calculationIntent' });
    const semanticInfo = 'Prosím vysvětli, co je DPH.';
    const semanticAnswer = await specialistRuntime.tryToolExecution('accountant', semanticInfo, {
      interpretInput: async () => informationPlan(semanticInfo),
    });
    it('existing complete non-calculation semantic plan falls back without arithmetic', () => {
      assert.equal(semanticAnswer, null);
    });
    const quotedInput = 'Vysvětli pojem „vypočítej DPH z 10000 Kč“.';
    const quotedAnswer = await specialistRuntime.tryToolExecution('accountant', quotedInput, {
      interpretInput: async () => ({ ...informationPlan(quotedInput), segments: [
        { text: 'Vysvětli pojem ', kind: 'context' },
        { text: '„vypočítej DPH z 10000 Kč“', kind: 'quote' },
        { text: '.', kind: 'context' },
      ] }),
    });
    it('quoted arithmetic is data in a validated information request', () => {
      assert.equal(quotedAnswer, null);
    });
    // One quote segment cannot hide unquoted arithmetic between two quotes.
    for (const [open, close] of [['"', '"'], ['„', '“']]) {
      const input = `Vysvětli ${open}x${close} a vypočítej DPH z 10000 Kč a ${open}y${close}.`;
      const answer = await specialistRuntime.tryToolExecution('accountant', input, {
        interpretInput: async () => ({ ...informationPlan(input), segments: [
          { text: 'Vysvětli ', kind: 'context' },
          { text: `${open}x${close} a vypočítej DPH z 10000 Kč a ${open}y${close}`, kind: 'quote' },
          { text: '.', kind: 'context' },
        ] }),
      });
      it(`quote envelope cannot suppress an actual unquoted calculation: ${open}${close}`, () => {
        assert.equal(answer?.status, 'clarify');
        assert.equal(answer?.toolType, 'accountant.vat_calculator');
        assert.equal(answer?.result, undefined);
        assert.equal(arithmeticCalls, 0);
      });
    }
    for (const [input, interpretInput] of [
      ['Vypočítej DPH.', undefined],
      ['Nechci výpočet DPH.', undefined],
      ['DPH z 10000 Kč nebo 12000 Kč', undefined],
      ['Vypočítej DPH.', async () => informationPlan('Vypočítej DPH.')],
      ['DPH z 10000 Kč nebo 12000 Kč', async () => ({
        ...informationPlan('DPH z 10000 Kč nebo 12000 Kč'), action: 'calculate',
        amount: 10000, direction: 'add', clarification: null, segments: [
          { text: 'DPH z 10000 Kč', kind: 'calculation' },
          { text: ' nebo 12000 Kč', kind: 'context' },
        ],
      })],
      ['DPH 21 % nebo 12 % z 10000 Kč', async () => ({
        ...informationPlan('DPH 21 % nebo 12 % z 10000 Kč'), action: 'calculate',
        amount: 10000, direction: 'add', clarification: null,
        segments: [{ text: 'DPH 21 % nebo 12 % z 10000 Kč', kind: 'calculation' }],
      })],
      ['Nespočítej DPH z 10000 Kč.', async () => ({
        ...informationPlan('Nespočítej DPH z 10000 Kč.'),
        segments: [{ text: 'Nespočítej DPH z 10000 Kč.', kind: 'negated_calculation' }],
      })],
      ['Vypočítej DPH ze stejné částky.', async () => ({
        ...informationPlan('Vypočítej DPH ze stejné částky.'), action: 'calculate',
        amount: 10000, direction: 'add', clarification: null,
        segments: [{ text: 'Vypočítej DPH ze stejné částky.', kind: 'calculation' }],
      })],
      ['Co je DPH?', async () => ({
        ...informationPlan('Co je DPH?'), segments: [{ text: 'DPH?', kind: 'context' }],
      })],
    ]) {
      const answer = await specialistRuntime.tryToolExecution('accountant', input, { interpretInput });
      it(`calculation/malformed meaning stays fail-closed: ${input}`, () => {
        assert.equal(answer?.status, 'clarify');
        assert.equal(answer?.toolType, 'accountant.vat_calculator');
        assert.equal(answer?.result, undefined);
      });
    }
    it('information and all guarded inputs invoke zero arithmetic', () => {
      assert.equal(arithmeticCalls, 0);
    });
    const sessionId = 'vat-eligibility-source-current';
    const first = await specialistRuntime.tryToolExecution('accountant', 'DPH z 10000 Kč za rok 2025', { sessionId });
    const info = await specialistRuntime.tryToolExecution('accountant', 'Co je DPH v Německu?', { sessionId });
    const afterInformation = specialistRuntime._sessionCache.get(sessionId, 'accountant');
    const second = await specialistRuntime.tryToolExecution('accountant', 'DPH z 12000 Kč za rok 2025', { sessionId });
    it('information cannot merge old VAT values and a fresh operand remains authoritative', () => {
      assert.equal(first.params.amount, 10000);
      assert.equal(info, null);
      assert.equal(afterInformation, null);
      assert.equal(second.params.amount, 12000);
      assert.equal(second.result.base, 12000);
      assert.equal(arithmeticCalls, 2);
    });
  } finally {
    vatTool.toolAdapter.run = originalVatRun;
    vatTool.toolAdapter.execute = originalVatExecute;
  }

  // The in-process result is exact and belongs to the currently registered
  // tool. Invalid tags must not turn a failed resolver into reader fallback.
  const applicabilityCases = [
    ['correct', { contract: 'SpecialistInputResolution', version: 1, status: 'not_applicable', toolId: 'eligibility.tool' }, true],
    ['wrong tool', { contract: 'SpecialistInputResolution', version: 1, status: 'not_applicable', toolId: 'foreign.tool' }, false],
    ['unknown version', { contract: 'SpecialistInputResolution', version: 2, status: 'not_applicable', toolId: 'eligibility.tool' }, false],
    ['unknown status', { contract: 'SpecialistInputResolution', version: 1, status: 'unknown', toolId: 'eligibility.tool' }, false],
    ['extra field', { contract: 'SpecialistInputResolution', version: 1, status: 'not_applicable', toolId: 'eligibility.tool', amount: 10000 }, false],
    ['missing key', { contract: 'SpecialistInputResolution', version: 1, status: 'not_applicable' }, false],
    ['untyped status', { status: 'not_applicable', toolId: 'eligibility.tool' }, false],
    ['wrong contract', { contract: 'ForeignResolution', version: 1, status: 'not_applicable', toolId: 'eligibility.tool' }, false],
    ['symbol extra', { contract: 'SpecialistInputResolution', version: 1, status: 'not_applicable', toolId: 'eligibility.tool', [Symbol('extra')]: true }, false],
  ];
  for (const [label, resolution, accepted] of applicabilityCases) {
    const isolated = new SpecialistRuntime();
    let projectInvocations = 0, toolExecutions = 0;
    isolated.setProjectContextHost({ openInvocation() { projectInvocations++; throw new Error('Unexpected project authority'); } });
    isolated.registerSpecialist({ id: 'eligibility', tools: [{ id: 'eligibility.tool',
      patterns: [{ patterns: [/DPH/u] }], resolveParams: async () => resolution,
      failClosed: true, needsProjectContext: true,
      toolAdapter: { run() { toolExecutions++; throw new Error('Unexpected arithmetic'); } },
    }] });
    const answer = await isolated.tryToolExecution('eligibility', 'Co je DPH?');
    it(`typed applicability boundary: ${label}`, () => {
      if (accepted) assert.equal(answer, null);
      else assert.equal(answer?.errorCode, 'M3_SPECIALIST_INPUT_RESOLUTION_FAILED');
      assert.equal(projectInvocations, 0);
      assert.equal(toolExecutions, 0);
    });
  }
  const cancelled = new SpecialistRuntime();
  const controller = new AbortController();
  cancelled.registerSpecialist({ id: 'cancelled', tools: [{ id: 'cancelled.tool',
    patterns: [{ patterns: [/DPH/u] }], failClosed: true,
    resolveParams: async () => { controller.abort(new Error('Owned cancellation')); return {
      contract: 'SpecialistInputResolution', version: 1, status: 'not_applicable', toolId: 'cancelled.tool',
    }; },
  }] });
  let cancellation = null;
  try { await cancelled.tryToolExecution('cancelled', 'Co je DPH?', { signal: controller.signal }); }
  catch (error) { cancellation = error; }
  it('cancellation during resolution cannot become not-applicable fallback', () => {
    assert.equal(cancellation?.name, 'AbortError');
    assert.equal(cancellation?.code, 'ABORT_ERR');
    assert.equal(cancellation?.abortSource, 'user');
  });

  // ─── 4. Custom Specialist Registration ─────────────────────────────────

  console.log('\n── 4. Custom Specialist Registration ──');

  const testRuntime = new SpecialistRuntime();
  testRuntime.registerSpecialist({
    id: 'test_specialist',
    domain: 'testing',
    tools: [{
      id: 'test.hello',
      name: 'Hello Tool',
      description: 'Returns a greeting',
      modulePath: './tools/tax-calc.js', // reuse any existing module
      functionName: 'calculateTax',       // just to test loading
      patterns: [{
        patterns: [/hello tool/i],
      }],
      extractParams: () => ({ gross_income: 100000 }),
    }],
  });

  it('custom specialist registered', () => {
    assert(testRuntime.isSpecialist('test_specialist'));
  });

  it('custom specialist has correct config', () => {
    const config = testRuntime.getSpecialistConfig('test_specialist');
    assert.equal(config.domain, 'testing');
    assert.equal(config.tools.length, 1);
  });

  it('custom specialist detects intent', () => {
    const det = new IntentDetector();
    const match = det.detect('hello tool please', testRuntime.registry.getSpecialist('test_specialist'));
    assert(match);
    assert.equal(match.tool.id, 'test.hello');
  });
}

// ─── Run ─────────────────────────────────────────────────────────────────────

runAsyncTests().then(() => {
  console.log(`\n══════════════════════════════════════════════════════════`);
  console.log(`  Specialist Runtime: ${passed}/${passed + failed} PASS, ${failed} FAIL`);
  console.log(`══════════════════════════════════════════════════════════`);
  if (failed === 0) console.log('✅ ALL SPECIALIST RUNTIME TESTS PASS');
  else console.log(`❌ Failures: ${failures.join(', ')}`);
  process.exitCode = failed > 0 ? 1 : 0;
}).catch(err => {
  console.error('Test error:', err);
  process.exitCode = 1;
});
