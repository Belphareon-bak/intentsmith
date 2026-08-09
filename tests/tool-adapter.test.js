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
import { createAdapters } from '../specialists/accountant-cz/adapters.js';

const {
  TaxCalculatorAdapter,
  VATCalculatorAdapter,
  SalaryCalculatorAdapter,
  DeadlineCheckerAdapter,
  CompareAdapter,
} = createAdapters(ToolAdapter);

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

assert(
  Object.getPrototypeOf(TaxCalculatorAdapter.prototype) === ToolAdapter.prototype,
  'factory: adapters extend the injected ToolAdapter identity',
);
let missingInjection = null;
try {
  createAdapters(null);
} catch (error) {
  missingInjection = error;
}
assertEq(
  missingInjection?.message,
  'ACCOUNTANT_TOOL_ADAPTER_REQUIRED',
  'factory: missing ToolAdapter fails explicitly',
);

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

// ── 11. validateResult() base class ─────────────────────────────────────────
console.log('\n── 11. validateResult() base class ──');

{
  // Default validateResult = always valid (noop)
  const adapter = new ToolAdapter({});
  const v = adapter.validateResult({}, { anything: true });
  assertEq(v.valid, true, 'validateResult: default is always valid');
  assertEq(Array.isArray(v.issues) ? v.issues.length : 0, 0, 'validateResult: default has no issues');

  // run() with validateResult that returns warnings
  class WarnAdapter extends ToolAdapter {
    constructor() { super({}); }
    execute() { return { success: true, result: { value: 42 } }; }
    validateResult(params, result) {
      return {
        valid: false,
        issues: [{ field: 'value', message: 'value is suspicious', severity: 'warn' }],
      };
    }
  }
  const warnResult = new WarnAdapter().run({});
  assertEq(warnResult.status, 'ok', 'validateResult: warn → still ok');
  assert(warnResult.meta !== undefined, 'validateResult: warn → has meta');
  assert(Array.isArray(warnResult.meta?.warnings), 'validateResult: warn → meta.warnings is array');
  assertEq(warnResult.meta.warnings.length, 1, 'validateResult: warn → 1 warning');
  assertEq(warnResult.meta.warnings[0].severity, 'warn', 'validateResult: warn → severity is warn');

  // run() with validateResult that returns error
  class ErrorValidationAdapter extends ToolAdapter {
    constructor() { super({}); }
    execute() { return { success: true, result: { value: 999 } }; }
    validateResult(params, result) {
      return {
        valid: false,
        issues: [{ field: 'value', message: 'value way too high', severity: 'error' }],
      };
    }
  }
  const errResult = new ErrorValidationAdapter().run({});
  assertEq(errResult.status, 'error', 'validateResult: error → status error');
  assertEq(errResult.error, 'RESULT_SANITY_FAIL', 'validateResult: error code');
  assert(errResult.message.includes('way too high'), 'validateResult: error message included');

  // run() without validation issues → no meta
  class CleanAdapter extends ToolAdapter {
    constructor() { super({}); }
    execute() { return { success: true, result: { value: 1 } }; }
    validateResult() { return { valid: true }; }
  }
  const cleanResult = new CleanAdapter().run({});
  assertEq(cleanResult.status, 'ok', 'validateResult: clean → ok');
  assertEq(cleanResult.meta, undefined, 'validateResult: clean → no meta');
}

// ── 12. Adapter validateResult — real tool results ──────────────────────────
console.log('\n── 12. Adapter validateResult() — real tools ──');

{
  // TaxCalculator: valid result passes validation
  const tax = new TaxCalculatorAdapter();
  const taxOk = tax.run({ gross_income: 850000 });
  assertEq(taxOk.status, 'ok', 'tax validation: 850k → ok');
  assertEq(taxOk.meta, undefined, 'tax validation: no warnings');

  // TaxCalculator: net + tax = gross
  const taxResult = taxOk.data;
  if (taxResult.net_income && taxResult.total_tax_burden && taxResult.gross_income) {
    const diff = Math.abs((taxResult.net_income + taxResult.total_tax_burden) - taxResult.gross_income);
    assert(diff <= 1, `tax validation: net + tax ≈ gross (diff ${diff})`);
  }

  // VAT: valid result passes
  const vat = new VATCalculatorAdapter();
  const vatOk = vat.run({ amount: 10000, rate: '21', direction: 'add' });
  assertEq(vatOk.status, 'ok', 'vat validation: passes');
  assertEq(vatOk.meta, undefined, 'vat validation: no warnings');

  // Salary: valid result passes
  const salary = new SalaryCalculatorAdapter();
  const salaryOk = salary.run({ gross_salary: 50000 });
  assertEq(salaryOk.status, 'ok', 'salary validation: passes');
  assertEq(salaryOk.meta, undefined, 'salary validation: no warnings');

  // Deadline: valid result passes
  const deadline = new DeadlineCheckerAdapter();
  const deadlineOk = deadline.run({ entity_type: 'osvc' });
  assertEq(deadlineOk.status, 'ok', 'deadline validation: passes');
  assertEq(deadlineOk.meta, undefined, 'deadline validation: no warnings');

  // Compare: valid result passes
  const compare = new CompareAdapter();
  const compareOk = compare.run({ gross_income: 1000000 });
  assertEq(compareOk.status, 'ok', 'compare validation: passes');
  assertEq(compareOk.meta, undefined, 'compare validation: no warnings');
}

// ── 13. Adapter validateResult — sanity check edge cases ────────────────────
console.log('\n── 13. validateResult() edge cases ──');

{
  // Tax: direct validateResult with bad data
  const tax = new TaxCalculatorAdapter();
  const badSum = tax.validateResult(
    { gross_income: 1000000 },
    { net_income: 500000, total_tax_burden: 400000, gross_income: 1000000 }
  );
  assert(!badSum.valid, 'tax sanity: net + tax != gross → invalid');
  assert(badSum.issues.some(i => i.field === 'sum'), 'tax sanity: sum issue reported');

  // Tax: effective_rate > 80 → error (only for income >= 300k)
  const badRate = tax.validateResult(
    { gross_income: 500000 },
    { effective_rate: 85, net_income: 75000, total_tax_burden: 425000, gross_income: 500000 }
  );
  assert(!badRate.valid, 'tax sanity: rate 85% (500k income) → invalid');
  assert(badRate.issues.some(i => i.field === 'effective_rate' && i.severity === 'error'), 'tax sanity: rate 85% → error severity');

  // Tax: effective_rate 65% → warn (for income >= 300k)
  const warnRate = tax.validateResult(
    { gross_income: 500000 },
    { effective_rate: 65, net_income: 175000, total_tax_burden: 325000, gross_income: 500000 }
  );
  assert(!warnRate.valid, 'tax sanity: rate 65% (500k income) → invalid (has warning)');
  assert(warnRate.issues.some(i => i.field === 'effective_rate' && i.severity === 'warn'), 'tax sanity: rate 65% → warn severity');

  // Tax: effective_rate 90% for low income → OK (minimums dominate)
  const lowIncomeHighRate = tax.validateResult(
    { gross_income: 100000 },
    { effective_rate: 90, net_income: 10000, total_tax_burden: 90000, gross_income: 100000 }
  );
  assert(lowIncomeHighRate.valid, 'tax sanity: rate 90% on 100k income → valid (minimums)');

  // VAT: base + vat != total
  const vat = new VATCalculatorAdapter();
  const badVat = vat.validateResult({}, { base: 10000, vat: 2100, total: 13000 });
  assert(!badVat.valid, 'vat sanity: sum mismatch → invalid');

  // VAT: negative VAT
  const negVat = vat.validateResult({}, { base: 10000, vat: -500, total: 9500 });
  assert(!negVat.valid, 'vat sanity: negative vat → invalid');

  // Salary: net >= gross
  const salary = new SalaryCalculatorAdapter();
  const badSalary = salary.validateResult({}, { net_salary: 55000, gross_salary: 50000 });
  assert(!badSalary.valid, 'salary sanity: net >= gross → invalid');

  // Deadline: empty deadlines
  const deadline = new DeadlineCheckerAdapter();
  const badDeadline = deadline.validateResult({}, { deadlines: [] });
  assert(!badDeadline.valid, 'deadline sanity: empty → invalid');

  // Compare: missing osvc
  const compare = new CompareAdapter();
  const badCompare = compare.validateResult({}, { sro: {}, comparison: { winner: 'sro' } });
  assert(!badCompare.valid, 'compare sanity: missing osvc → invalid');

  // Compare: invalid winner
  const badWinner = compare.validateResult({}, { osvc: {}, sro: {}, comparison: { winner: 'abc' } });
  assert(!badWinner.valid, 'compare sanity: invalid winner → invalid');
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
