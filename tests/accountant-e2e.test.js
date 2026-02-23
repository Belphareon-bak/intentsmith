// Accountant Tool E2E Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests the accountant tool execution pipeline:
// 1. Tool execution with structured params
// 2. Memory change awareness
//
// Pattern detection is tested separately in routing-accuracy.test.js
// (uses real specialist, not legacy detector).
//
// Run: node tests/accountant-e2e.test.js
// ══════════════════════════════════════════════════════════════════════════════

import { calculateTax, compareTaxEntities } from '../src/expertises/tools/tax-calc.js';
import { calculateVAT } from '../src/expertises/tools/vat-calc.js';
import { calculateSalary } from '../src/expertises/tools/salary-calc.js';
import { checkDeadlines } from '../src/expertises/tools/deadline-checker.js';
import { ExpertiseStore } from '../src/expertises/expertise-store.js';

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
  else fail(name, `expected ${expected}, got ${actual}`);
}

// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════ Accountant Tool E2E Tests ══════');

// ── 1. Tool Execution ────────────────────────────────────────────────────────
console.log('\n── 1. Tool Execution ──');

{
  // TAX
  const result = calculateTax({ gross_income: 850000, entity_type: 'osvc', year: 2024 });
  assert(result.success, 'TAX: calculation succeeded');
  assert(result.result.net_income > 0, 'TAX: net_income > 0');
  assert(result.result.total_tax_burden > 0, 'TAX: total_tax_burden > 0');
  assert(result.result.effective_rate > 0, 'TAX: effective_rate > 0');
  assertEq(result.result.entity_type, 'osvc', 'TAX: entity_type = osvc');
  assert(result.result.assumptions.length > 0, 'TAX: has assumptions');
  console.log(`    Net income: ${result.result.net_income} CZK, effective rate: ${result.result.effective_rate}%`);
}

{
  // VAT
  const result = calculateVAT({ amount: 10000, rate: '21', direction: 'add', year: 2025 });
  assert(result.success, 'VAT: calculation succeeded');
  assert(result.result.vat > 0, 'VAT: vat amount > 0');
  assert(result.result.total > result.result.base, 'VAT: total > base');
  assertEq(result.result.rate_percent, 21, 'VAT: rate = 21%');
  console.log(`    Base: ${result.result.base}, VAT: ${result.result.vat}, Total: ${result.result.total}`);
}

{
  // SALARY
  const result = calculateSalary({ gross_salary: 50000, year: 2025 });
  assert(result.success, 'SALARY: calculation succeeded');
  assert(result.result.net_salary > 0, 'SALARY: net_salary > 0');
  assert(result.result.net_salary < result.result.gross_salary, 'SALARY: net < gross');
  assert(result.result.total_employer_cost > result.result.gross_salary, 'SALARY: employer cost > gross');
  console.log(`    Gross: ${result.result.gross_salary}, Net: ${result.result.net_salary}`);
}

{
  // DEADLINE
  const result = checkDeadlines({ entity_type: 'osvc', year: 2024 });
  assert(result.success, 'DEADLINE: check succeeded');
  assert(result.result.deadlines.length > 0, 'DEADLINE: has deadlines');
  assert(result.result.total_count > 0, 'DEADLINE: total_count > 0');
  console.log(`    Found ${result.result.total_count} deadlines, next: ${result.result.next_deadline?.name || 'none'}`);
}

{
  // COMPARE
  const result = compareTaxEntities(1000000, { year: 2025 });
  assert(result.success, 'COMPARE: comparison succeeded');
  assert(result.osvc !== undefined, 'COMPARE: has OSVČ result');
  assert(result.sro !== undefined, 'COMPARE: has s.r.o. result');
  console.log(`    OSVČ net: ${result.osvc?.net_income}, s.r.o. net: ${result.sro?.net_income}`);
}

// ── 2. Memory Change Awareness ──────────────────────────────────────────────
console.log('\n── 2. Memory Change Awareness ──');

{
  const store = new ExpertiseStore();

  // Set initial value
  store.setMemory('accountant', 'company_type', 's.r.o.');
  assertEq(store.getMemory('accountant', 'company_type'), 's.r.o.', 'Memory: initial set');

  // Overwrite with new value — should track previous
  store.setMemory('accountant', 'company_type', 'OSVČ');
  assertEq(store.getMemory('accountant', 'company_type'), 'OSVČ', 'Memory: updated');

  // Check history
  const items = store.getMemoryWithHistory('accountant');
  const companyItem = items.find(m => m.key === 'company_type');
  assert(companyItem !== undefined, 'Memory: found in history');
  assertEq(companyItem.value, 'OSVČ', 'Memory: current value');
  assertEq(companyItem.previousValue, 's.r.o.', 'Memory: previous value tracked');

  // Check context formatting
  const context = store.getMemoryContext('accountant');
  assert(context !== null, 'Memory: context not null');
  assert(context.includes('OSVČ'), 'Memory: context has current value');
  assert(context.includes('předchozí: s.r.o.'), 'Memory: context shows change');

  // Set another key without previous
  store.setMemory('accountant', 'ico', '12345678');
  const items2 = store.getMemoryWithHistory('accountant');
  const icoItem = items2.find(m => m.key === 'ico');
  assert(icoItem !== undefined, 'Memory: new key found');
  assert(icoItem.previousValue === null || icoItem.previousValue === undefined, 'Memory: no previous for new key');

  // Clean up
  store.clearMemory('accountant');
  assert(store.getAllMemory('accountant').length === 0, 'Memory: cleared');
}

// ══════════════════════════════════════════════════════════════════════════════
// Summary
console.log(`\n${'═'.repeat(60)}`);
console.log(`Accountant E2E Tests: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ❌ ${f.name}: ${f.msg}`);
  }
}
console.log('');

process.exit(failed > 0 ? 1 : 0);
