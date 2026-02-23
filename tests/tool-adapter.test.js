// ToolAdapter Unit Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests the ToolAdapter base class and accountant-cz adapters.
// Covers: validate, normalize, execute, run pipeline, clarify flow,
//         year fallback, amount sanity check.
//
// Run: node tests/tool-adapter.test.js
// ══════════════════════════════════════════════════════════════════════════════

import { ToolAdapter } from '../src/expertises/tool-adapter.js';
import {
  TaxCalculatorAdapter,
  VATCalculatorAdapter,
  SalaryCalculatorAdapter,
  DeadlineCheckerAdapter,
  CompareAdapter,
} from '../specialists/accountant-cz/adapters.js';

let passed = 0;
let failed = 0;
const failures = [];

function pass(name) {
  console.log(`  ✅ ${name}`);
  passed++;
}

function fail(name, msg) {
  console.log(`  ❌ ${name}: ${msg}`);
  failed++;
  failures.push({ name, msg });
}

function assert(condition, name, detail = '') {
  if (condition) pass(name);
  else fail(name, detail || 'assertion failed');
}

function assertEq(actual, expected, name) {
  if (actual === expected) pass(name);
  else fail(name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════ ToolAdapter Unit Tests ══════');

// ── 1. Base class: validate ─────────────────────────────────────────────────
console.log('\n── 1. ToolAdapter.validate() ──');

{
  const adapter = new ToolAdapter({ required: ['gross_income', 'year'] });

  const ok = adapter.validate({ gross_income: 500000, year: 2025 });
  assertEq(ok.status, 'ok', 'validate: all required present → ok');

  const missing = adapter.validate({ gross_income: 500000 });
  assertEq(missing.status, 'clarify', 'validate: missing year → clarify');
  assert(missing.missingParams.includes('year'), 'validate: missingParams contains year');
  assert(!missing.missingParams.includes('gross_income'), 'validate: missingParams does not contain present param');

  const allMissing = adapter.validate({});
  assertEq(allMissing.status, 'clarify', 'validate: all missing → clarify');
  assertEq(allMissing.missingParams.length, 2, 'validate: 2 missing params');

  const noRequired = new ToolAdapter({});
  assertEq(noRequired.validate({}).status, 'ok', 'validate: no required → always ok');
}

// ── 2. Base class: normalize ────────────────────────────────────────────────
console.log('\n── 2. ToolAdapter.normalize() ──');

{
  const adapter = new ToolAdapter({
    defaults: { entity_type: 'osvc', expense_type: 'flat_60' },
    supportedYears: [2024, 2025],
  });

  // Defaults applied
  const n1 = adapter.normalize({});
  assertEq(n1.entity_type, 'osvc', 'normalize: default entity_type applied');
  assertEq(n1.expense_type, 'flat_60', 'normalize: default expense_type applied');

  // Params override defaults
  const n2 = adapter.normalize({ entity_type: 'sro' });
  assertEq(n2.entity_type, 'sro', 'normalize: param overrides default');
  assertEq(n2.expense_type, 'flat_60', 'normalize: non-overridden default stays');

  // Year fallback
  const n3 = adapter.normalize({});
  assert(typeof n3.year === 'number', 'normalize: year fallback applied');
  assert([2024, 2025].includes(n3.year), 'normalize: year is supported');

  // Year NOT overwritten if present
  const n4 = adapter.normalize({ year: 2024 });
  assertEq(n4.year, 2024, 'normalize: explicit year not overwritten');

  // Amount sanity check
  const sanity = adapter.normalize({ gross_income: 50_000_000_000 });
  assertEq(sanity._rejected, true, 'normalize: unrealistic amount → rejected');
  assertEq(sanity.status, 'error', 'normalize: rejection status is error');
  assert(sanity.error === 'AMOUNT_UNREALISTIC', 'normalize: error code is AMOUNT_UNREALISTIC');
}

// ── 3. Base class: run pipeline ─────────────────────────────────────────────
console.log('\n── 3. ToolAdapter.run() pipeline ──');

{
  class TestAdapter extends ToolAdapter {
    constructor() {
      super({ required: ['value'], supportedYears: [2024, 2025] });
    }
    execute(params) {
      return { success: true, result: { doubled: params.value * 2, year: params.year } };
    }
  }

  const adapter = new TestAdapter();

  // Full pipeline success
  const ok = adapter.run({ value: 42 });
  assertEq(ok.status, 'ok', 'run: success status');
  assertEq(ok.data.doubled, 84, 'run: result data correct');
  assert(typeof ok.data.year === 'number', 'run: year was normalized');

  // Missing required → clarify
  const clarify = adapter.run({});
  assertEq(clarify.status, 'clarify', 'run: missing required → clarify');
  assert(clarify.missingParams.includes('value'), 'run: clarify lists missing param');

  // Tool returns {success: false}
  class FailAdapter extends ToolAdapter {
    constructor() { super({}); }
    execute() { return { success: false, error: 'bad input' }; }
  }
  const failResult = new FailAdapter().run({});
  assertEq(failResult.status, 'error', 'run: tool failure → error status');
  assertEq(failResult.error, 'bad input', 'run: error message passed through');

  // Tool throws
  class ThrowAdapter extends ToolAdapter {
    constructor() { super({}); }
    execute() { throw new Error('kaboom'); }
  }
  const throwResult = new ThrowAdapter().run({});
  assertEq(throwResult.status, 'error', 'run: tool throw → error status');
  assertEq(throwResult.error, 'kaboom', 'run: thrown error message captured');
}

// ── 4. TaxCalculatorAdapter ─────────────────────────────────────────────────
console.log('\n── 4. TaxCalculatorAdapter ──');

{
  const adapter = new TaxCalculatorAdapter();

  // Missing gross_income → clarify
  const c = adapter.run({});
  assertEq(c.status, 'clarify', 'tax: no gross_income → clarify');
  assert(c.missingParams.includes('gross_income'), 'tax: missingParams has gross_income');

  // Success with year fallback
  const ok = adapter.run({ gross_income: 850000 });
  assertEq(ok.status, 'ok', 'tax: 850k → ok');
  assert(ok.data.net_income > 0, 'tax: net_income > 0');
  assert(ok.data.total_tax_burden > 0, 'tax: total_tax_burden > 0');
  assert([2024, 2025].includes(ok.data.year), 'tax: year fallback applied');

  // Entity type defaults to osvc
  assertEq(ok.data.entity_type, 'osvc', 'tax: default entity_type = osvc');

  // Explicit year
  const ok2 = adapter.run({ gross_income: 500000, year: 2024 });
  assertEq(ok2.status, 'ok', 'tax: explicit year 2024 → ok');
  assertEq(ok2.data.year, 2024, 'tax: year preserved');
}

// ── 5. VATCalculatorAdapter ─────────────────────────────────────────────────
console.log('\n── 5. VATCalculatorAdapter ──');

{
  const adapter = new VATCalculatorAdapter();

  const c = adapter.run({});
  assertEq(c.status, 'clarify', 'vat: no amount → clarify');

  const ok = adapter.run({ amount: 10000, rate: '21', direction: 'add' });
  assertEq(ok.status, 'ok', 'vat: 10000 add 21% → ok');
  assertEq(ok.data.vat, 2100, 'vat: 10000 × 21% = 2100');
  assertEq(ok.data.total, 12100, 'vat: total = 12100');
}

// ── 6. SalaryCalculatorAdapter ──────────────────────────────────────────────
console.log('\n── 6. SalaryCalculatorAdapter ──');

{
  const adapter = new SalaryCalculatorAdapter();

  const c = adapter.run({});
  assertEq(c.status, 'clarify', 'salary: no gross_salary → clarify');

  const ok = adapter.run({ gross_salary: 50000 });
  assertEq(ok.status, 'ok', 'salary: 50k → ok');
  assert(ok.data.net_salary > 0, 'salary: net > 0');
  assert(ok.data.net_salary < 50000, 'salary: net < gross');
}

// ── 7. DeadlineCheckerAdapter ───────────────────────────────────────────────
console.log('\n── 7. DeadlineCheckerAdapter ──');

{
  const adapter = new DeadlineCheckerAdapter();

  const c = adapter.run({});
  assertEq(c.status, 'clarify', 'deadline: no entity_type → clarify');
  assert(c.missingParams.includes('entity_type'), 'deadline: clarify lists entity_type');

  const ok = adapter.run({ entity_type: 'osvc' });
  assertEq(ok.status, 'ok', 'deadline: osvc → ok');
  assert(ok.data.deadlines.length > 0, 'deadline: has deadlines');
}

// ── 8. CompareAdapter ───────────────────────────────────────────────────────
console.log('\n── 8. CompareAdapter ──');

{
  const adapter = new CompareAdapter();

  const c = adapter.run({});
  assertEq(c.status, 'clarify', 'compare: no gross_income → clarify');

  const ok = adapter.run({ gross_income: 1000000 });
  assertEq(ok.status, 'ok', 'compare: 1M → ok');
  assert(ok.data.osvc !== undefined, 'compare: has osvc result');
  assert(ok.data.sro !== undefined, 'compare: has sro result');
  assert(ok.data.comparison !== undefined, 'compare: has comparison');
}

// ── 9. Year fallback determinism ────────────────────────────────────────────
console.log('\n── 9. Year fallback determinism ──');

{
  // Run 10 times — year must be same every time
  const adapter = new TaxCalculatorAdapter();
  const years = [];
  for (let i = 0; i < 10; i++) {
    const result = adapter.run({ gross_income: 500000 });
    if (result.status === 'ok') years.push(result.data.year);
  }
  const allSame = years.every(y => y === years[0]);
  assert(allSame, 'year fallback: deterministic (10 runs same year)');
  assert([2024, 2025].includes(years[0]), `year fallback: is supported year (${years[0]})`);
}

// ── 10. Amount sanity cap ───────────────────────────────────────────────────
console.log('\n── 10. Amount sanity cap ──');

{
  const tax = new TaxCalculatorAdapter();
  const r1 = tax.run({ gross_income: 12_000_000_000 });
  assertEq(r1.status, 'error', 'sanity: 12B → error');
  assertEq(r1.error, 'AMOUNT_UNREALISTIC', 'sanity: error code');

  const vat = new VATCalculatorAdapter();
  const r2 = vat.run({ amount: 5_000_000_000 });
  assertEq(r2.status, 'error', 'sanity: 5B VAT → error');

  // Normal amounts pass
  const r3 = tax.run({ gross_income: 999_000_000 });
  assertEq(r3.status, 'ok', 'sanity: 999M → ok (under cap)');
}

// ══════════════════════════════════════════════════════════════════════════════
// Summary
console.log(`\n${'═'.repeat(60)}`);
console.log(`ToolAdapter Tests: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ❌ ${f.name}: ${f.msg}`);
  }
}
console.log('');

process.exit(failed > 0 ? 1 : 0);
