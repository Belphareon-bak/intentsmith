// D-int6: Accountant Integration E2E Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests the full accountant integration pipeline:
// 1. Detector: Czech queries → correct tool + params
// 2. Parameter extraction: natural language → structured params
// 3. Tool execution with extracted params
// 4. Memory change awareness
// 5. Expert handler interception (unit-level, no LLM)
//
// Run: node tests/accountant-e2e.test.js
// ══════════════════════════════════════════════════════════════════════════════

import {
  detectAccountantTool,
  extractAmount,
  extractEntityType,
  extractYear,
  extractVATParams,
  extractTaxParams,
  extractDeadlineParams,
  ACCOUNTANT_TOOL_TYPES,
  TAX_PATTERNS,
  VAT_PATTERNS,
  SALARY_PATTERNS,
  DEADLINE_PATTERNS,
  COMPARE_PATTERNS,
} from '../src/experts/tools/accountant-detector.js';

import { calculateTax, compareTaxEntities } from '../src/experts/tools/tax-calc.js';
import { calculateVAT } from '../src/experts/tools/vat-calc.js';
import { calculateSalary } from '../src/experts/tools/salary-calc.js';
import { checkDeadlines } from '../src/experts/tools/deadline-checker.js';
import { ExpertStore } from '../src/experts/expert-store.js';

let passed = 0;
let failed = 0;
const failures = [];

function pass(name) {
  console.log(`  \u2705 ${name}`);
  passed++;
}

function fail(name, msg) {
  console.log(`  \u274C ${name}: ${msg}`);
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
console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550 D-int6: Accountant Integration E2E Tests \u2550\u2550\u2550\u2550\u2550\u2550');

// ── 1. Detector: Pattern Matching ────────────────────────────────────────────
console.log('\n\u2500\u2500 1. Detector: Pattern Matching \u2500\u2500');

const DETECTION_CASES = [
  // TAX
  ['Kolik zaplatim z 850k jako OSVC za rok 2024?', 'accountant.tax_calculator'],
  ['Jaká je daň z příjmů pro OSVČ?', 'accountant.tax_calculator'],
  ['odvody OSVČ z 1200000', 'accountant.tax_calculator'],
  ['Kolik zaplatím daní z příjmu 500000?', 'accountant.tax_calculator'],
  ['zdanění příjmu 850 tisíc', 'accountant.tax_calculator'],
  ['jaké jsou odvody z 1M jako živnostník', 'accountant.tax_calculator'],
  ['výdaje paušál 60% z příjmu 900k', 'accountant.tax_calculator'],

  // VAT
  ['DPH z 10000', 'accountant.vat_calculator'],
  ['Jaká je DPH z 10000?', 'accountant.vat_calculator'],
  ['přidej DPH k 50000', 'accountant.vat_calculator'],
  ['cena bez DPH z 12100', 'accountant.vat_calculator'],
  ['kolik je DPH sazba 12%', 'accountant.vat_calculator'],

  // SALARY
  ['Čistá mzda z 50000', 'accountant.salary_calculator'],
  ['hrubá mzda 45000 kolik čistého', 'accountant.salary_calculator'],
  ['čistá výplata z hrubého 60000', 'accountant.salary_calculator'],
  ['odvody zaměstnance z platu 40000', 'accountant.salary_calculator'],

  // DEADLINE
  ['Kdy je deadline pro přiznání?', 'accountant.deadline_checker'],
  ['do kdy podat přehled OSSZ', 'accountant.deadline_checker'],
  ['termín pro kontrolní hlášení', 'accountant.deadline_checker'],
  ['lhůta pro daňové přiznání 2024', 'accountant.deadline_checker'],

  // COMPARE
  ['je výhodnější OSVČ nebo s.r.o. z 1M?', 'accountant.compare_tax_entities'],
  ['porovnej OSVČ vs sro při příjmu 850k', 'accountant.compare_tax_entities'],

  // NON-MATCH (should return null)
  ['Jaké je počasí?', null],
  ['Kolik stojí iPhone?', null],
  ['Ahoj, jak se máš?', null],
  ['Navrhni architekturu pro web', null],
  ['Kdo je president?', null],
  ['Přelož tohle do angličtiny', null],
];

for (const [input, expectedTool] of DETECTION_CASES) {
  const result = detectAccountantTool(input);
  const label = input.substring(0, 45).padEnd(45);
  if (expectedTool === null) {
    assert(result === null, `No match: ${label}`, `got: ${result?.toolType}`);
  } else {
    assert(result !== null, `Detected: ${label}`, 'returned null');
    if (result) {
      assertEq(result.toolType, expectedTool, `Tool: ${label}`);
    }
  }
}

// ── 2. Parameter Extraction ──────────────────────────────────────────────────
console.log('\n\u2500\u2500 2. Parameter Extraction \u2500\u2500');

// Amount extraction
assertEq(extractAmount('z 850k jako OSVC'), 850000, 'Amount: 850k → 850000');
assertEq(extractAmount('příjem 2M ročně'), 2000000, 'Amount: 2M → 2000000');
assertEq(extractAmount('z 850 tis'), 850000, 'Amount: 850 tis → 850000');
assertEq(extractAmount('z 850000'), 850000, 'Amount: 850000 → 850000');
assertEq(extractAmount('ze 50000 hrubého'), 50000, 'Amount: ze 50000 → 50000');
assertEq(extractAmount('z 1 200 000'), 1200000, 'Amount: 1 200 000 → 1200000');

// Entity type
assertEq(extractEntityType('jako OSVČ'), 'osvc', 'Entity: OSVČ → osvc');
assertEq(extractEntityType('pro s.r.o.'), 'sro', 'Entity: s.r.o. → sro');
assertEq(extractEntityType('jako živnostník'), 'osvc', 'Entity: živnostník → osvc');
assertEq(extractEntityType('jako zaměstnanec'), null, 'Entity: zaměstnanec → null');

// Year
assertEq(extractYear('za rok 2024'), 2024, 'Year: za rok 2024 → 2024');
assertEq(extractYear('v roce 2025'), 2025, 'Year: v roce 2025 → 2025');
assertEq(extractYear('příjmy 2024'), 2024, 'Year: standalone 2024 → 2024');
assertEq(extractYear('kolik zaplatím'), null, 'Year: no year → null');

// VAT params
{
  const v1 = extractVATParams('přidej DPH k ceně');
  assertEq(v1.rate, '21', 'VAT: default rate 21');
  assertEq(v1.direction, 'add', 'VAT: default direction add');

  const v2 = extractVATParams('cena bez DPH snížená sazba');
  assertEq(v2.rate, '12', 'VAT: snížená → 12');
  assertEq(v2.direction, 'remove', 'VAT: bez DPH → remove');
}

// Tax params
{
  const t1 = extractTaxParams('paušál 80% z 900k');
  assertEq(t1.expense_type, 'flat_80', 'Tax: paušál 80% → flat_80');

  const t2 = extractTaxParams('skutečné výdaje 300k');
  assertEq(t2.expense_type, 'actual', 'Tax: skutečné → actual');

  const t3 = extractTaxParams('příjem 500k, 2 děti');
  assertEq(t3.children, 2, 'Tax: 2 děti → children=2');
}

// Deadline params
{
  const d1 = extractDeadlineParams('mám daňového poradce');
  assertEq(d1.has_advisor, true, 'Deadline: poradce → has_advisor');

  const d2 = extractDeadlineParams('jsem plátce DPH měsíční');
  assertEq(d2.is_vat_payer, true, 'Deadline: plátce DPH → is_vat_payer');
  assertEq(d2.vat_period, 'monthly', 'Deadline: měsíční DPH → monthly');
}

// ── 3. Full Detection + Param Extraction ─────────────────────────────────────
console.log('\n\u2500\u2500 3. Full Detection + Params \u2500\u2500');

{
  const r = detectAccountantTool('Kolik zaplatím z 850k jako OSVČ za rok 2024?');
  assert(r !== null, 'Full TAX detection');
  assertEq(r.toolType, 'accountant.tax_calculator', 'Full TAX tool type');
  assertEq(r.params.gross_income, 850000, 'Full TAX gross_income');
  assertEq(r.params.entity_type, 'osvc', 'Full TAX entity_type');
  assertEq(r.params.year, 2024, 'Full TAX year');
}

{
  const r = detectAccountantTool('DPH z 10000 snížená sazba');
  assert(r !== null, 'Full VAT detection');
  assertEq(r.toolType, 'accountant.vat_calculator', 'Full VAT tool type');
  assertEq(r.params.amount, 10000, 'Full VAT amount');
  assertEq(r.params.rate, '12', 'Full VAT rate');
  assertEq(r.params.direction, 'add', 'Full VAT direction');
}

{
  const r = detectAccountantTool('Čistá mzda z 50000 se 2 dětmi');
  assert(r !== null, 'Full SALARY detection');
  assertEq(r.toolType, 'accountant.salary_calculator', 'Full SALARY tool type');
  assertEq(r.params.gross_salary, 50000, 'Full SALARY gross_salary');
  assertEq(r.params.children, 2, 'Full SALARY children');
}

{
  const r = detectAccountantTool('Kdy je lhůta pro daňové přiznání OSVČ 2024?');
  assert(r !== null, 'Full DEADLINE detection');
  assertEq(r.toolType, 'accountant.deadline_checker', 'Full DEADLINE tool type');
  assertEq(r.params.entity_type, 'osvc', 'Full DEADLINE entity_type');
  assertEq(r.params.year, 2024, 'Full DEADLINE year');
}

{
  const r = detectAccountantTool('Porovnej OSVČ a s.r.o. při příjmu 1M');
  assert(r !== null, 'Full COMPARE detection');
  assertEq(r.toolType, 'accountant.compare_tax_entities', 'Full COMPARE tool type');
  assertEq(r.params.gross_income, 1000000, 'Full COMPARE gross_income');
}

// ── 4. Tool Execution with Extracted Params ──────────────────────────────────
console.log('\n\u2500\u2500 4. Tool Execution \u2500\u2500');

{
  // TAX — use year 2024 (explicitly in query)
  const detection = detectAccountantTool('Kolik zaplatím z 850k jako OSVČ za rok 2024?');
  const result = calculateTax(detection.params);
  assert(result.success, 'TAX: calculation succeeded');
  assert(result.result.net_income > 0, 'TAX: net_income > 0');
  assert(result.result.total_tax_burden > 0, 'TAX: total_tax_burden > 0');
  assert(result.result.effective_rate > 0, 'TAX: effective_rate > 0');
  assertEq(result.result.entity_type, 'osvc', 'TAX: entity_type = osvc');
  assert(result.result.assumptions.length > 0, 'TAX: has assumptions');
  console.log(`    Net income: ${result.result.net_income} CZK, effective rate: ${result.result.effective_rate}%`);
}

{
  // VAT — year-independent, works always
  const detection = detectAccountantTool('Jaká je DPH z 10000?');
  const params = { ...detection.params, year: 2025 };
  const result = calculateVAT(params);
  assert(result.success, 'VAT: calculation succeeded');
  assert(result.result.vat > 0, 'VAT: vat amount > 0');
  assert(result.result.total > result.result.base, 'VAT: total > base');
  assertEq(result.result.rate_percent, 21, 'VAT: rate = 21%');
  console.log(`    Base: ${result.result.base}, VAT: ${result.result.vat}, Total: ${result.result.total}`);
}

{
  // SALARY — needs year 2025 (2026 not supported)
  const detection = detectAccountantTool('Čistá mzda z 50000');
  const params = { ...detection.params, year: 2025 };
  const result = calculateSalary(params);
  assert(result.success, 'SALARY: calculation succeeded');
  assert(result.result.net_salary > 0, 'SALARY: net_salary > 0');
  assert(result.result.net_salary < result.result.gross_salary, 'SALARY: net < gross');
  assert(result.result.total_employer_cost > result.result.gross_salary, 'SALARY: employer cost > gross');
  console.log(`    Gross: ${result.result.gross_salary}, Net: ${result.result.net_salary}`);
}

{
  // DEADLINE — use year 2024
  const detection = detectAccountantTool('Kdy je lhůta pro daňové přiznání OSVČ 2024?');
  const result = checkDeadlines(detection.params);
  assert(result.success, 'DEADLINE: check succeeded');
  assert(result.result.deadlines.length > 0, 'DEADLINE: has deadlines');
  assert(result.result.total_count > 0, 'DEADLINE: total_count > 0');
  console.log(`    Found ${result.result.total_count} deadlines, next: ${result.result.next_deadline?.name || 'none'}`);
}

{
  // COMPARE — needs year 2025
  const detection = detectAccountantTool('Porovnej OSVČ a s.r.o. při příjmu 1M');
  const params = { ...detection.params, year: 2025 };
  const result = compareTaxEntities(params.gross_income, params);
  assert(result.success, 'COMPARE: comparison succeeded');
  assert(result.osvc !== undefined, 'COMPARE: has OSVČ result');
  assert(result.sro !== undefined, 'COMPARE: has s.r.o. result');
  console.log(`    OSVČ net: ${result.osvc?.net_income}, s.r.o. net: ${result.sro?.net_income}`);
}

// ── 5. Memory Change Awareness ───────────────────────────────────────────────
console.log('\n\u2500\u2500 5. Memory Change Awareness \u2500\u2500');

{
  const store = new ExpertStore();

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

// ── 6. Edge Cases ────────────────────────────────────────────────────────────
console.log('\n\u2500\u2500 6. Edge Cases \u2500\u2500');

{
  // Empty/short input
  assertEq(detectAccountantTool(''), null, 'Edge: empty string');
  assertEq(detectAccountantTool('hi'), null, 'Edge: very short');
  assertEq(detectAccountantTool(null), null, 'Edge: null input');

  // No amount in tax query — should still detect tool type
  const r1 = detectAccountantTool('Jaké jsou odvody OSVČ?');
  if (r1) {
    assertEq(r1.toolType, 'accountant.tax_calculator', 'Edge: no amount → still TAX');
    assert(r1.params.gross_income === null || r1.params.gross_income === undefined, 'Edge: no amount in params');
  } else {
    pass('Edge: no amount → no detection (acceptable)');
  }

  // Diacritics-free input
  const r2 = detectAccountantTool('kolik zaplatim z 850k jako osvc');
  assert(r2 !== null, 'Edge: no diacritics detected');
  if (r2) assertEq(r2.toolType, 'accountant.tax_calculator', 'Edge: no diacritics tool');

  // Mixed language
  const r3 = detectAccountantTool('tax calculation from 500k as OSVČ');
  if (r3) {
    assertEq(r3.toolType, 'accountant.tax_calculator', 'Edge: English+Czech');
  } else {
    pass('Edge: mixed language → no detection (acceptable)');
  }
}

// ── 7. Diacritics-free Detection ─────────────────────────────────────────────
console.log('\n\u2500\u2500 7. Diacritics-free Queries \u2500\u2500');

{
  const queries = [
    ['cista mzda z 40000', 'accountant.salary_calculator'],
    ['kolik zaplatim dani z 600k', 'accountant.tax_calculator'],
    ['dph z 8000', 'accountant.vat_calculator'],
    ['do kdy podat priznani osvc 2024', 'accountant.deadline_checker'],
  ];

  for (const [input, expectedTool] of queries) {
    const r = detectAccountantTool(input);
    if (r) {
      assertEq(r.toolType, expectedTool, `NoDiacritics: ${input.substring(0, 30)}`);
    } else {
      fail(`NoDiacritics: ${input.substring(0, 30)}`, 'returned null');
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Summary
console.log(`\n${'═'.repeat(60)}`);
console.log(`Accountant E2E Tests: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  \u274C ${f.name}: ${f.msg}`);
  }
}
console.log('');

process.exit(failed > 0 ? 1 : 0);
