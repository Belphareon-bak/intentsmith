// D1: Specialist Runtime — Unit Tests
// ═══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';
import {
  specialistRuntime,
  ToolRegistry,
  IntentDetector,
  SpecialistRuntime,
} from '../src/expertises/specialist-runtime.js';

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

it('accountant has 5 tools', () => {
  const config = specialistRuntime.getSpecialistConfig('accountant');
  assert(config);
  assert.equal(config.tools.length, 5);
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
  const vatResult = await specialistRuntime.tryToolExecution('accountant', 'kolik je DPH z 10000');
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
  });

  const noMatch = await specialistRuntime.tryToolExecution('accountant', 'jaké je počasí?');
  it('tryToolExecution returns null for no match', () => {
    assert.equal(noMatch, null);
  });

  const noSpecialist = await specialistRuntime.tryToolExecution('writer', 'write a story');
  it('tryToolExecution returns null for non-specialist', () => {
    assert.equal(noSpecialist, null);
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
}).catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
