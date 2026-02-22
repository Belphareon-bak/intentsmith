#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent v57.3 — Accountant Tools Test Suite
// ═══════════════════════════════════════════════════════════════════════════════
// Run: node test/accountant-tools.test.js

import { calculateTax, compareTaxEntities, fmtCZK } from '../src/expertises/tools/tax-calc.js';
import { calculateVAT, addVAT, removeVAT } from '../src/expertises/tools/vat-calc.js';
import { checkDeadlines } from '../src/expertises/tools/deadline-checker.js';
import { getRates, supportedYears, RATES } from '../src/expertises/tools/tax-rates.js';
import { checkStaleness, getStalenessWarnings, getVerificationTopics } from '../src/expertises/tools/tax-rates.js';
import { checkFreshness, getFreshnessWarnings, getVerificationStrategy, VERIFICATION_SOURCES, RATE_MONITOR_AGENT } from '../src/expertises/tools/tax-rates-freshness.js';
import { calculateSalary, compareSalaries } from '../src/expertises/tools/salary-calc.js';

let passed = 0, failed = 0;
const failures = [];
function ok(n) { passed++; console.log(`  ✅ ${n}`); }
function fail(n, e) { failed++; failures.push({n, m: e?.message||String(e)}); console.log(`  ❌ ${n}: ${e?.message||e}`); }
async function test(n, fn) { try { await fn(); ok(n); } catch(e) { fail(n, e); } }
function assert(c, m) { if (!c) throw new Error(m || 'Assertion failed'); }
function assertRange(val, min, max, name) {
  assert(val >= min && val <= max, `${name}: expected ${min}-${max}, got ${val}`);
}
function assertClose(val, expected, tolerance, name) {
  assert(Math.abs(val - expected) <= tolerance, `${name}: expected ~${expected} ±${tolerance}, got ${val}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. TAX RATES
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n📊 1. Tax Rates Data');

await test('getRates(2024) returns valid object', () => {
  const r = getRates(2024);
  assert(r.income_tax.base_rate === 0.15);
  assert(r.income_tax.higher_rate === 0.23);
  assert(r.social.osvc_rate === 0.292);
  assert(r.health.osvc_rate === 0.135);
  assert(r.corporate.rate === 0.21);
  assert(r.corporate.dividend_rate === 0.15);
});

await test('getRates(2025) returns valid object', () => {
  const r = getRates(2025);
  assert(r.income_tax.base_rate === 0.15);
  assert(r.social.osvc_min_monthly > getRates(2024).social.osvc_min_monthly, 'min monthly should increase');
});

await test('getRates(2099) throws', () => {
  try { getRates(2099); assert(false, 'should throw'); } catch(e) { assert(e.message.includes('není podporován')); }
});

await test('supportedYears returns array with 2024, 2025', () => {
  const years = supportedYears();
  assert(years.includes(2024) && years.includes(2025));
});

await test('RATES[year] — year-keyed, no global constants', () => {
  // Verify rates differ between years where expected
  assert(RATES[2024].social.osvc_min_monthly !== RATES[2025].social.osvc_min_monthly, 'min social should differ');
  assert(RATES[2024].salary.min_wage_monthly !== RATES[2025].salary.min_wage_monthly, 'min wage should differ');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. TAX CALCULATOR — OSVČ
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🧮 2. Tax Calculator — OSVČ');

await test('OSVČ 850k, paušál 60%, 2024 — basic computation', () => {
  const r = calculateTax({ gross_income: 850_000, expense_type: 'flat_60', entity_type: 'osvc', year: 2024 });
  assert(r.success, `should succeed: ${r.error}`);
  const t = r.result;

  // Výdaje: 850k * 60% = 510k
  assert(t.expenses === 510_000, `expenses: ${t.expenses}`);
  // Základ: 850k - 510k = 340k
  assert(t.tax_base === 340_000, `tax_base: ${t.tax_base}`);
  // Daň: 340k * 15% = 51k
  assert(t.income_tax_before_credits === 51_000, `tax before credits: ${t.income_tax_before_credits}`);
  // Po slevě na poplatníka: 51k - 30,840 = 20,160
  assert(t.income_tax === 20_160, `income_tax: ${t.income_tax}`);
  // Net income should be reasonable
  assertRange(t.net_income, 600_000, 800_000, 'net_income');
  // Effective rate
  assertRange(t.effective_rate, 10, 35, 'effective_rate');
});

await test('OSVČ 850k — assumptions are populated', () => {
  const r = calculateTax({ gross_income: 850_000, entity_type: 'osvc', year: 2024 });
  const t = r.result;
  assert(t.assumptions.length >= 3, `should have ≥3 assumptions, got ${t.assumptions.length}`);
  assert(t.assumptions.some(a => a.includes('Žádné další příjmy')), 'should assume no other income');
  assert(t.assumptions.some(a => a.includes('2024')), 'should mention year');
});

await test('OSVČ 850k — breakdown is populated', () => {
  const r = calculateTax({ gross_income: 850_000, entity_type: 'osvc', year: 2024 });
  const t = r.result;
  assert(t.breakdown.expense_description.includes('60%'));
  assert(t.breakdown.income_tax_computation.includes('15%'));
  assert(t.breakdown.social_computation.includes('29.2%'));
});

await test('OSVČ — paušál 80%', () => {
  const r = calculateTax({ gross_income: 500_000, expense_type: 'flat_80', entity_type: 'osvc', year: 2024 });
  assert(r.success);
  // 500k * 80% = 400k výdaje
  assert(r.result.expenses === 400_000);
  assert(r.result.tax_base === 100_000);
});

await test('OSVČ — paušál 40%', () => {
  const r = calculateTax({ gross_income: 1_000_000, expense_type: 'flat_40', entity_type: 'osvc', year: 2024 });
  assert(r.success);
  assert(r.result.expenses === 400_000);
});

await test('OSVČ — paušál cap (60% z 3M > 1.2M max)', () => {
  const r = calculateTax({ gross_income: 3_000_000, expense_type: 'flat_60', entity_type: 'osvc', year: 2024 });
  assert(r.success);
  // 3M * 60% = 1.8M → capped at 1.2M
  assert(r.result.expenses === 1_200_000, `expenses should be capped: ${r.result.expenses}`);
  assert(r.result.warnings.some(w => w.includes('zastropovány')), 'should warn about cap');
});

await test('OSVČ — skutečné výdaje', () => {
  const r = calculateTax({ gross_income: 1_000_000, expenses: 600_000, expense_type: 'actual', entity_type: 'osvc', year: 2024 });
  assert(r.success);
  assert(r.result.expenses === 600_000);
  assert(r.result.tax_base === 400_000);
});

await test('OSVČ — higher rate triggers above threshold', () => {
  const r = calculateTax({ gross_income: 5_000_000, expense_type: 'flat_60', entity_type: 'osvc', year: 2024 });
  assert(r.success);
  assert(r.result.warnings.some(w => w.includes('23%')), 'should warn about higher rate');
});

await test('OSVČ — child benefit', () => {
  const r1 = calculateTax({ gross_income: 850_000, entity_type: 'osvc', year: 2024, children: 0 });
  const r2 = calculateTax({ gross_income: 850_000, entity_type: 'osvc', year: 2024, children: 2 });
  assert(r1.success && r2.success);
  // 2 children = child_1 (15,204) + child_2 (22,320) = 37,524
  assert(r2.result.child_benefit === 15_204 + 22_320, `child benefit: ${r2.result.child_benefit}`);
  assert(r2.result.net_income > r1.result.net_income, 'children should increase net');
});

await test('OSVČ — spouse credit', () => {
  const r = calculateTax({ gross_income: 850_000, entity_type: 'osvc', year: 2024, spouse_credit: true });
  assert(r.success);
  assert(r.result.credits > getRates(2024).credits.taxpayer, 'total credits should exceed taxpayer-only');
});

await test('OSVČ — zero income', () => {
  const r = calculateTax({ gross_income: 0, entity_type: 'osvc', year: 2024 });
  assert(r.success);
  assert(r.result.income_tax === 0);
  // Still pays minimum social/health
  assert(r.result.social_insurance > 0, 'should pay minimum social');
  assert(r.result.health_insurance > 0, 'should pay minimum health');
});

await test('OSVČ — social insurance minimum', () => {
  const r = calculateTax({ gross_income: 100_000, expense_type: 'flat_60', entity_type: 'osvc', year: 2024 });
  assert(r.success);
  const minAnnual = getRates(2024).social.osvc_min_monthly * 12;
  assert(r.result.social_insurance >= minAnnual, `social should be ≥ min ${minAnnual}, got ${r.result.social_insurance}`);
});

await test('OSVČ — monthly breakdown', () => {
  const r = calculateTax({ gross_income: 850_000, entity_type: 'osvc', year: 2024 });
  assert(r.success);
  assert(r.result.social_monthly > 0);
  assert(r.result.health_monthly > 0);
  assertClose(r.result.social_monthly * 12, r.result.social_insurance, 12, 'social monthly*12');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. TAX CALCULATOR — s.r.o.
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🏢 3. Tax Calculator — s.r.o.');

await test('s.r.o. 1M zisk, 2024', () => {
  const r = calculateTax({ gross_income: 1_000_000, entity_type: 'sro', year: 2024 });
  assert(r.success);
  const t = r.result;

  // DPPO: 1M * 21% = 210k
  assert(t.corporate_tax === 210_000, `DPPO: ${t.corporate_tax}`);
  // Zisk po dani: 1M - 210k = 790k
  assert(t.profit_after_tax === 790_000, `profit after tax: ${t.profit_after_tax}`);
  // Dividenda: 790k * 15% = 118,500
  assert(t.dividend_tax === 118_500, `dividend tax: ${t.dividend_tax}`);
  // Čistý: 790k - 118.5k = 671,500
  assert(t.dividend_net === 671_500, `net dividend: ${t.dividend_net}`);
  // Efektivní sazba: ~32.85%
  assertClose(t.effective_rate, 32.85, 0.1, 'effective_rate');
});

await test('s.r.o. — combined rate formula', () => {
  const rates = getRates(2024);
  const theoretical = (1 - (1 - rates.corporate.rate) * (1 - rates.corporate.dividend_rate)) * 100;
  assertClose(theoretical, 32.85, 0.01, 'theoretical combined rate');
});

await test('s.r.o. — assumptions include dividenda', () => {
  const r = calculateTax({ gross_income: 500_000, entity_type: 'sro', year: 2024 });
  assert(r.result.assumptions.some(a => a.includes('dividenda')));
  assert(r.result.assumptions.some(a => a.includes('jednatel')));
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. COMPARE ENTITIES
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n⚖️ 4. Entity Comparison');

await test('compareTaxEntities — returns both results', () => {
  const r = compareTaxEntities(850_000, { year: 2024, expense_type: 'flat_60' });
  assert(r.success);
  assert(r.osvc.entity_type === 'osvc');
  assert(r.sro.entity_type === 'sro');
  assert(typeof r.comparison.difference === 'number');
  assert(r.comparison.winner === 'osvc' || r.comparison.winner === 'sro');
});

await test('compareTaxEntities — OSVČ usually wins at lower income', () => {
  const r = compareTaxEntities(500_000, { year: 2024, expense_type: 'flat_60' });
  assert(r.success);
  // OSVČ with 60% flat expenses at 500k should beat s.r.o.
  assert(r.comparison.osvc_net > r.comparison.sro_net, 'OSVČ should win at 500k');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. VALIDATION / ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n⚠️ 5. Validation');

await test('negative income → error', () => {
  const r = calculateTax({ gross_income: -100, entity_type: 'osvc', year: 2024 });
  assert(!r.success && r.error.includes('nezáporné'));
});

await test('invalid expense_type → error', () => {
  const r = calculateTax({ gross_income: 100_000, expense_type: 'flat_99', year: 2024 });
  assert(!r.success);
});

await test('actual expenses without amount → error', () => {
  const r = calculateTax({ gross_income: 100_000, expense_type: 'actual', year: 2024 });
  assert(!r.success);
});

await test('invalid entity_type → error', () => {
  const r = calculateTax({ gross_income: 100_000, entity_type: 'as', year: 2024 });
  assert(!r.success);
});

await test('unsupported year → error', () => {
  const r = calculateTax({ gross_income: 100_000, year: 2019 });
  assert(!r.success);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. VAT CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n💰 6. VAT Calculator');

await test('addVAT 21% — 10000 → 12100', () => {
  const r = calculateVAT({ amount: 10_000, rate: '21', direction: 'add', year: 2024 });
  assert(r.success);
  assert(r.result.base === 10_000);
  assert(r.result.vat === 2_100);
  assert(r.result.total === 12_100);
});

await test('removeVAT 21% — 12100 → 10000', () => {
  const r = calculateVAT({ amount: 12_100, rate: '21', direction: 'remove', year: 2024 });
  assert(r.success);
  assertClose(r.result.base, 10_000, 1, 'base');
  assertClose(r.result.vat, 2_100, 1, 'vat');
});

await test('VAT 12% (snížená)', () => {
  const r = calculateVAT({ amount: 10_000, rate: '12', direction: 'add', year: 2024 });
  assert(r.success);
  assert(r.result.vat === 1_200);
  assert(r.result.total === 11_200);
});

await test('VAT 0%', () => {
  const r = calculateVAT({ amount: 10_000, rate: '0', direction: 'add', year: 2024 });
  assert(r.success);
  assert(r.result.vat === 0);
  assert(r.result.total === 10_000);
});

await test('VAT roundtrip: add then remove', () => {
  const added = calculateVAT({ amount: 7_777, rate: '21', direction: 'add', year: 2024 }).result;
  const removed = calculateVAT({ amount: added.total, rate: '21', direction: 'remove', year: 2024 }).result;
  assertClose(removed.base, 7_777, 1, 'roundtrip base');
});

await test('VAT invalid rate → error', () => {
  assert(!calculateVAT({ amount: 100, rate: '15', year: 2024 }).success);
});

await test('VAT negative amount → error', () => {
  assert(!calculateVAT({ amount: -100 }).success);
});

await test('VAT assumptions populated', () => {
  const r = calculateVAT({ amount: 1000, rate: '21', direction: 'add', year: 2024 });
  assert(r.success, `should succeed: ${r.error}`);
  assert(r.result.assumptions.length >= 2);
  assert(r.result.assumptions.some(a => a.includes('235/2004')));
});

await test('VAT fallback to latest year when current year unsupported', () => {
  // Don't specify year — defaults to 2026 which isn't in rates, should fallback
  const r = calculateVAT({ amount: 1000, rate: '21', direction: 'add' });
  assert(r.success, `should succeed with fallback: ${r.error}`);
  assert(r.result.total === 1210);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. DEADLINE CHECKER
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n📅 7. Deadline Checker');

await test('OSVČ 2024 deadlines — basic', () => {
  const r = checkDeadlines({ entity_type: 'osvc', year: 2024, reference_date: '2025-01-15' });
  assert(r.success);
  const d = r.result;
  assert(d.deadlines.length >= 5, `should have ≥5 deadlines, got ${d.deadlines.length}`);
  assert(d.next_deadline !== null, 'should have a next deadline');
  assert(d.filing_year === 2025);
});

await test('OSVČ deadlines — contains DPFO, OSSZ, VZP', () => {
  const r = checkDeadlines({ entity_type: 'osvc', year: 2024, reference_date: '2025-01-15' });
  const names = r.result.deadlines.map(d => d.name);
  assert(names.some(n => n.includes('DPFO')), 'should have DPFO');
  assert(names.some(n => n.includes('OSSZ')), 'should have OSSZ');
  assert(names.some(n => n.includes('VZP')), 'should have VZP');
});

await test('OSVČ with advisor — extended deadlines', () => {
  const noAdvisor = checkDeadlines({ entity_type: 'osvc', year: 2024, reference_date: '2025-01-15' });
  const withAdvisor = checkDeadlines({ entity_type: 'osvc', year: 2024, has_advisor: true, reference_date: '2025-01-15' });

  const naDPFO = noAdvisor.result.deadlines.find(d => d.id === 'dpfo_electronic');
  const waDPFO = withAdvisor.result.deadlines.find(d => d.id === 'dpfo_electronic');

  assert(naDPFO.date === '2025-05-02', `no advisor: ${naDPFO.date}`);
  assert(waDPFO.date === '2025-07-01', `with advisor: ${waDPFO.date}`);
});

await test('s.r.o. deadlines — no OSSZ/VZP přehledy', () => {
  const r = checkDeadlines({ entity_type: 'sro', year: 2024, reference_date: '2025-01-15' });
  const ids = r.result.deadlines.map(d => d.id);
  assert(!ids.includes('prehled_ossz'), 'should NOT have OSSZ for s.r.o.');
  assert(!ids.includes('prehled_vzp'), 'should NOT have VZP for s.r.o.');
});

await test('VAT payer — includes DPH deadlines', () => {
  const r = checkDeadlines({ entity_type: 'osvc', year: 2024, is_vat_payer: true, reference_date: '2025-01-15' });
  const names = r.result.deadlines.map(d => d.name);
  assert(names.some(n => n.includes('DPH')), 'should have DPH deadlines');
  assert(names.some(n => n.includes('Kontrolní hlášení')), 'should have KH');
});

await test('urgency calculation — overdue items', () => {
  // Reference date after DPFO paper deadline
  const r = checkDeadlines({ entity_type: 'osvc', year: 2024, reference_date: '2025-05-15' });
  assert(r.result.overdue.length > 0, 'should have overdue deadlines');
  assert(r.result.overdue[0].urgency === 'critical');
  assert(r.result.overdue[0].days_until < 0);
});

await test('urgency levels — sorted correctly', () => {
  const r = checkDeadlines({ entity_type: 'osvc', year: 2024, reference_date: '2025-03-25' });
  const deadlines = r.result.deadlines;
  // First items should be overdue or critical, last should be info/low
  for (let i = 0; i < deadlines.length - 1; i++) {
    if (deadlines[i].overdue && !deadlines[i+1].overdue) continue; // overdue first ✓
    if (!deadlines[i].overdue && !deadlines[i+1].overdue) {
      assert(new Date(deadlines[i].date) <= new Date(deadlines[i+1].date), 'should be sorted by date');
    }
  }
});

await test('deadlines — legal references populated', () => {
  const r = checkDeadlines({ entity_type: 'osvc', year: 2024, reference_date: '2025-01-15' });
  for (const d of r.result.deadlines) {
    assert(d.legal_ref && d.legal_ref.length > 5, `deadline ${d.id} missing legal_ref`);
  }
});

await test('deadlines — penalties populated', () => {
  const r = checkDeadlines({ entity_type: 'osvc', year: 2024, reference_date: '2025-01-15' });
  for (const d of r.result.deadlines) {
    assert(d.penalty && d.penalty.length > 5, `deadline ${d.id} missing penalty`);
  }
});

await test('deadlines — invalid entity → error', () => {
  assert(!checkDeadlines({ entity_type: 'as', year: 2024 }).success);
});

await test('deadlines — invalid year → error', () => {
  assert(!checkDeadlines({ entity_type: 'osvc', year: 2099 }).success);
});

await test('deadlines — assumptions populated', () => {
  const r = checkDeadlines({ entity_type: 'osvc', year: 2024, has_advisor: true, reference_date: '2025-03-01' });
  assert(r.result.assumptions.length >= 3);
  assert(r.result.assumptions.some(a => a.includes('daňový poradce')));
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. FORMAT HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🔧 8. Helpers');

await test('fmtCZK formats correctly', () => {
  const s = fmtCZK(1_234_567);
  assert(s.includes('1'), `should contain digit: ${s}`);
  assert(typeof s === 'string' && s.length > 3);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. STALENESS & VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n📅 9. Staleness & Verification');

await test('checkStaleness — 2024 not stale (recently verified)', () => {
  const r = checkStaleness(2024, 365); // 365 day tolerance
  assert(!r.stale, `should not be stale with 365d tolerance`);
  assert(r.confidence === 'high');
});

await test('checkStaleness — 2025 has medium confidence', () => {
  const r = checkStaleness(2025);
  assert(r.confidence === 'medium');
  assert(r.warnings.some(w => w.includes('odhady')), 'should warn about estimates');
});

await test('checkStaleness — unsupported year', () => {
  const r = checkStaleness(2099);
  assert(r.stale === true);
  assert(r.confidence === 'none');
});

await test('getStalenessWarnings — returns array', () => {
  const w = getStalenessWarnings(2024);
  assert(Array.isArray(w));
});

await test('getVerificationTopics — returns topics for year', () => {
  const topics = getVerificationTopics(2025);
  assert(topics.length >= 5, `should have ≥5 topics, got ${topics.length}`);
  assert(topics.every(t => t.searchQuery && t.fields.length > 0), 'each topic needs query + fields');
  assert(topics.some(t => t.topic.includes('zálohy')), 'should include zálohy topic');
  assert(topics.some(t => t.topic.includes('mzda')), 'should include mzda topic');
});

await test('RATES._meta exists for all years', () => {
  for (const year of supportedYears()) {
    const meta = RATES[year]._meta;
    assert(meta, `year ${year} missing _meta`);
    assert(meta.verified_at, `year ${year} missing verified_at`);
    assert(meta.valid_from, `year ${year} missing valid_from`);
    assert(meta.source, `year ${year} missing source`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. FRESHNESS & VERIFICATION STRATEGY
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🔄 10. Freshness & Verification Strategy');

await test('checkFreshness — 2024 verified year', () => {
  const r = checkFreshness(2024);
  assert(r.year_status === 'verified', `status: ${r.year_status}`);
  assert(r.last_check !== null);
  assert(typeof r.days_since_check === 'number');
});

await test('checkFreshness — 2025 provisional year', () => {
  const r = checkFreshness(2025);
  assert(r.year_status === 'provisional', `status: ${r.year_status}`);
  assert(r.warnings.some(w => w.includes('provizorní')), 'should warn about provisional');
  assert(r.low_confidence.length > 0, 'should have low confidence categories');
});

await test('checkFreshness — unknown year', () => {
  const r = checkFreshness(2099);
  assert(!r.fresh);
  assert(r.year_status === 'unknown');
  assert(r.warnings.length > 0);
});

await test('getFreshnessWarnings — returns array', () => {
  const w = getFreshnessWarnings(2025);
  assert(Array.isArray(w));
  // 2025 is provisional, so should have some warnings
  assert(w.some(warning => warning.includes('⚠️')), 'should have warning markers');
});

await test('VERIFICATION_SOURCES — covers all key areas', () => {
  assert(VERIFICATION_SOURCES.length >= 5, `should have ≥5 sources, got ${VERIFICATION_SOURCES.length}`);
  const ids = VERIFICATION_SOURCES.map(s => s.id);
  assert(ids.includes('cssz_osvc'), 'should include ČSSZ');
  assert(ids.includes('vzp_osvc'), 'should include VZP');
  assert(ids.includes('mpsv_min_wage'), 'should include min wage');
  assert(ids.includes('zdp_sazby'), 'should include ZDP');
  // Each source has required fields
  for (const s of VERIFICATION_SOURCES) {
    assert(s.url, `${s.id} missing url`);
    assert(s.affects.length > 0, `${s.id} missing affects`);
    assert(s.keywords.length > 0, `${s.id} missing keywords`);
    assert(s.check_frequency_days > 0, `${s.id} missing frequency`);
  }
});

await test('RATE_MONITOR_AGENT — valid agent definition', () => {
  assert(RATE_MONITOR_AGENT.id === 'tax-rate-monitor');
  assert(RATE_MONITOR_AGENT.schedule.includes('9'));
  assert(typeof RATE_MONITOR_AGENT.getSourcesDueForCheck === 'function');
  assert(typeof RATE_MONITOR_AGENT.buildSearchQueries === 'function');
});

await test('RATE_MONITOR_AGENT — getSourcesDueForCheck with no history', () => {
  const due = RATE_MONITOR_AGENT.getSourcesDueForCheck({});
  assert(due.length === VERIFICATION_SOURCES.length, 'all sources should be due with no history');
});

await test('RATE_MONITOR_AGENT — getSourcesDueForCheck filters recent', () => {
  const recentChecks = {};
  for (const s of VERIFICATION_SOURCES) {
    recentChecks[s.id] = new Date().toISOString(); // Just checked
  }
  const due = RATE_MONITOR_AGENT.getSourcesDueForCheck(recentChecks);
  assert(due.length === 0, 'no sources should be due if all just checked');
});

await test('getVerificationStrategy — past verified year = no verify', () => {
  const r = getVerificationStrategy(2024);
  assert(!r.should_verify, `2024 should not need verification: ${r.reason}`);
});

await test('getVerificationStrategy — current/future year = verify', () => {
  const currentYear = new Date().getFullYear();
  const r = getVerificationStrategy(currentYear);
  assert(r.should_verify, `current year should need verification`);
  assert(r.queries.length > 0, 'should have search queries');
});

await test('getVerificationStrategy — specific categories', () => {
  const currentYear = new Date().getFullYear();
  const r = getVerificationStrategy(currentYear, ['social', 'health']);
  assert(r.should_verify);
  assert(r.queries.some(q => q.includes('zálohy')), 'should include zálohy query');
  // Should NOT include VAT or salary queries when not requested
  assert(r.queries.length <= 2, `should be focused: ${r.queries.length} queries`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. SALARY CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n💼 11. Salary Calculator');

await test('Salary 50k gross, 2024 — basic computation', () => {
  const r = calculateSalary({ gross_salary: 50_000, year: 2024 });
  assert(r.success, `should succeed: ${r.error}`);
  const s = r.result;

  // SP zaměstnanec: 50000 * 6.5% = 3250
  assert(s.social_employee === 3_250, `social_ee: ${s.social_employee}`);
  // ZP zaměstnanec: 50000 * 4.5% = 2250
  assert(s.health_employee === 2_250, `health_ee: ${s.health_employee}`);
  // Total deductions: 5500
  assert(s.total_employee_deductions === 5_500);
  // Tax base rounded: 50000 (already divisible by 100)
  assert(s.tax_base_rounded === 50_000, `tax_base_rounded: ${s.tax_base_rounded}`);
  // Záloha: 50000 * 15% = 7500
  assert(s.tax_advance_before_credits === 7_500, `tax_before_credits: ${s.tax_advance_before_credits}`);
  // Sleva na poplatníka: 30840/12 = 2570
  assert(s.credits === 2_570, `credits: ${s.credits}`);
  // Záloha po slevě: 7500 - 2570 = 4930
  assert(s.tax_advance === 4_930, `tax_advance: ${s.tax_advance}`);
  // Čistá mzda: 50000 - 5500 - 4930 = 39570
  assert(s.net_salary === 39_570, `net: ${s.net_salary}`);
  // Zaměstnavatel SP: 50000 * 24.8% = 12400
  assert(s.social_employer === 12_400, `social_er: ${s.social_employer}`);
  // Zaměstnavatel ZP: 50000 * 9% = 4500
  assert(s.health_employer === 4_500, `health_er: ${s.health_employer}`);
  // Celkový náklad: 50000 + 12400 + 4500 = 66900
  assert(s.total_employer_cost === 66_900, `employer_cost: ${s.total_employer_cost}`);
});

await test('Salary — net_to_gross_ratio is reasonable', () => {
  const r = calculateSalary({ gross_salary: 50_000, year: 2024 });
  // 39570/50000 ≈ 79.14%
  assertClose(r.result.net_to_gross_ratio, 79.14, 0.1, 'net_to_gross');
});

await test('Salary — employer_overhead_pct', () => {
  const r = calculateSalary({ gross_salary: 50_000, year: 2024 });
  // (66900-50000)/50000 = 33.8%
  assertClose(r.result.employer_overhead_pct, 33.8, 0.1, 'overhead');
});

await test('Salary — with 2 children', () => {
  const r0 = calculateSalary({ gross_salary: 40_000, year: 2024, children: 0 });
  const r2 = calculateSalary({ gross_salary: 40_000, year: 2024, children: 2 });
  assert(r0.success && r2.success);
  assert(r2.result.child_benefit > 0, 'should have child benefit');
  assert(r2.result.net_salary > r0.result.net_salary, 'children should increase net');
  // child_1 monthly: 15204/12 = 1267, child_2: 22320/12 = 1860
  assertClose(r2.result.child_benefit, 1267 + 1860, 2, 'child_benefit');
});

await test('Salary — child bonus (low salary + children)', () => {
  const r = calculateSalary({ gross_salary: 20_000, year: 2024, children: 3 });
  assert(r.success);
  assert(r.result.tax_advance === 0, `tax should be 0, got ${r.result.tax_advance}`);
  assert(r.result.tax_bonus > 0, `should get tax bonus, got ${r.result.tax_bonus}`);
  assert(r.result.net_salary > r.result.gross_salary - r.result.total_employee_deductions, 'net > gross - deductions');
});

await test('Salary — unsigned declaration (no credits)', () => {
  const signed = calculateSalary({ gross_salary: 40_000, year: 2024, signed_declaration: true });
  const unsigned = calculateSalary({ gross_salary: 40_000, year: 2024, signed_declaration: false });
  assert(signed.success && unsigned.success);
  assert(unsigned.result.credits === 0, 'no credits without declaration');
  assert(unsigned.result.net_salary < signed.result.net_salary, 'lower net without declaration');
  assert(unsigned.result.warnings.some(w => w.includes('prohlášení')));
});

await test('Salary — min wage warning', () => {
  const r = calculateSalary({ gross_salary: 10_000, year: 2024 });
  assert(r.success);
  assert(r.result.warnings.some(w => w.includes('minimální mzd')), 'should warn about min wage');
});

await test('Salary — zero salary', () => {
  const r = calculateSalary({ gross_salary: 0, year: 2024 });
  assert(r.success);
  assert(r.result.net_salary === 0);
  assert(r.result.total_employer_cost === 0);
});

await test('Salary — annual mode', () => {
  const r = calculateSalary({ gross_salary: 600_000, year: 2024, mode: 'annual' });
  assert(r.success);
  assert(r.result.mode === 'annual');
  assert(r.result.gross_salary === 50_000, 'should divide by 12');
  assert(r.result.annual, 'should have annual totals');
  assert(r.result.annual.gross_annual === 600_000);
  assertClose(r.result.annual.net_annual, r.result.net_salary * 12, 1, 'annual net');
});

await test('Salary — negative input → error', () => {
  assert(!calculateSalary({ gross_salary: -5000 }).success);
});

await test('Salary — breakdown populated', () => {
  const r = calculateSalary({ gross_salary: 45_000, year: 2024 });
  assert(r.success);
  assert(r.result.breakdown.employee.includes('čistá'));
  assert(r.result.breakdown.employer.includes('náklad'));
  assert(r.result.breakdown.tax.includes('záloha'));
});

await test('Salary — assumptions populated', () => {
  const r = calculateSalary({ gross_salary: 45_000, year: 2024 });
  assert(r.result.assumptions.length >= 3);
  assert(r.result.assumptions.some(a => a.includes('2024')));
  assert(r.result.assumptions.some(a => a.includes('HPP')));
});

await test('compareSalaries — marginal tax rate', () => {
  const r = compareSalaries([40_000, 50_000, 60_000], { year: 2024 });
  assert(r.success, `should succeed: ${r.error}`);
  assert(r.comparisons.length === 2);
  assertRange(r.comparisons[0].marginal_tax_rate, 20, 45, 'marginal_rate 40→50k');
  assert(r.comparisons[0].net_increase > 0, 'net should increase');
  assert(r.comparisons[0].net_increase < r.comparisons[0].gross_increase, 'net increase < gross increase');
});

await test('compareSalaries — insufficient data → error', () => {
  assert(!compareSalaries([40_000]).success);
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n' + '═'.repeat(60));
console.log(`Accountant Tools: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ❌ ${f.n}: ${f.m}`);
}
console.log('═'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
