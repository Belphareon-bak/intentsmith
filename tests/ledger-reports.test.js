// Phase 6: Report Engine — Unit Tests
// ══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';
import Database from 'better-sqlite3';
import { LedgerRepository } from '../src/expertises/ledger/ledger-repository.js';
import { toCents, toCZK } from '../src/expertises/ledger/ledger-engine.js';
import {
  generateDPFOReport, generateCSSZReport, generateVZPReport,
  generateCashBook, generateIncomeSummary, generateAdvanceReport,
  formatReportAsMarkdown,
} from '../src/expertises/ledger/ledger-reports.js';
import { RATES } from '../src/expertises/tools/tax-rates.js';

let passed = 0, failed = 0;
const failures = [];

function it(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; failures.push(name); console.log(`  ❌ ${name}: ${err.message}`); }
}

// ─── Setup ──────────────────────────────────────────────────────────────────

const db = new Database(':memory:');
const { up: up1 } = await import('../src/db/migrations/2026_02_19_008_v69_ledger_core.js');
const { up: up2 } = await import('../src/db/migrations/2026_02_20_009_v70_period_locks.js');
const { up: up3 } = await import('../src/db/migrations/2026_02_22_010_v72_vat_engine.js');
const { up: up4 } = await import('../src/db/migrations/2026_02_22_011_v73_compliance.js');
up1(db); up2(db); up3(db); up4(db);

const repo = new LedgerRepository(db);
const rates2024 = RATES[2024];

const { id: entityId } = repo.createEntity({
  id: 'test-reports', name: 'Jan Novák', entity_type: 'osvc',
  tax_regime: 'actual', main_or_secondary: 'main',
});
const entity = repo.getEntity(entityId);

// Add test entries for 2024
const testEntries = [
  { entry_type: 'income', amount_cents: toCents(50000), category: 'services',
    entry_date: '2024-01-15', period_year: 2024, description: 'Webová zakázka A' },
  { entry_type: 'income', amount_cents: toCents(30000), category: 'services',
    entry_date: '2024-03-20', period_year: 2024, description: 'Konzultace B' },
  { entry_type: 'income', amount_cents: toCents(20000), category: 'goods',
    entry_date: '2024-06-10', period_year: 2024, description: 'Prodej licence' },
  { entry_type: 'expense', amount_cents: toCents(15000), category: 'office',
    entry_date: '2024-02-01', period_year: 2024, description: 'Nájem kancelář', is_tax_deductible: 1 },
  { entry_type: 'expense', amount_cents: toCents(5000), category: 'services',
    entry_date: '2024-04-15', period_year: 2024, description: 'Účetní software', is_tax_deductible: 1 },
  { entry_type: 'expense', amount_cents: toCents(8000), category: 'transport',
    entry_date: '2024-07-20', period_year: 2024, description: 'PHM', is_tax_deductible: 1 },
  { entry_type: 'tax_payment', amount_cents: toCents(10000), category: 'tax',
    entry_date: '2024-06-15', period_year: 2024, description: 'Záloha DPFO' },
  { entry_type: 'insurance_payment', amount_cents: toCents(3852), category: 'social',
    entry_date: '2024-02-20', period_year: 2024, description: 'SP leden' },
  { entry_type: 'insurance_payment', amount_cents: toCents(3852), category: 'social',
    entry_date: '2024-03-20', period_year: 2024, description: 'SP únor' },
  { entry_type: 'insurance_payment', amount_cents: toCents(2968), category: 'health',
    entry_date: '2024-02-08', period_year: 2024, description: 'ZP leden' },
  { entry_type: 'insurance_payment', amount_cents: toCents(2968), category: 'health',
    entry_date: '2024-03-08', period_year: 2024, description: 'ZP únor' },
];

repo.addEntries(entityId, testEntries);
const entries = repo.getEntriesByYear(entityId, 2024);

// Non-payment entries for insurance calculations
const nonPaymentEntries = entries.filter(
  e => e.entry_type !== 'insurance_payment' && e.entry_type !== 'tax_payment',
);

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n╔═══════════════════════════════════════════════╗');
console.log('║  Phase 6: Report Engine                       ║');
console.log('╚═══════════════════════════════════════════════╝\n');

// ─── 1. DPFO Report ────────────────────────────────────────────────────────

console.log('── DPFO Report ──');

it('generates DPFO report with correct structure', () => {
  const report = generateDPFOReport({ entity, entries: nonPaymentEntries, rates: rates2024, year: 2024 });
  assert.equal(report.report_type, 'dpfo');
  assert.equal(report.year, 2024);
  assert.equal(report.form_code, '25 5405/P1');
  assert.equal(report.entity_name, 'Jan Novák');
  assert.ok(report.data.p1_prijmy_celkem > 0);
  assert.ok(report.data.p1_vydaje_celkem > 0);
  assert.ok(report.generated_at);
});

it('DPFO income matches 100,000 CZK', () => {
  const report = generateDPFOReport({ entity, entries: nonPaymentEntries, rates: rates2024, year: 2024 });
  assert.equal(report.data.p1_prijmy_celkem, 100000);
  assert.equal(report.data.p1_vydaje_celkem, 28000);
  assert.equal(report.data.p1_rozdil, 72000);
});

it('DPFO with tax losses', () => {
  const losses = [{ origin_year: 2023, remaining_cents: toCents(20000), expires_year: 2028 }];
  const report = generateDPFOReport({
    entity, entries: nonPaymentEntries, rates: rates2024, year: 2024, activeLosses: losses,
  });
  assert.equal(report.data.p1_ztrata_minulych_let, 20000);
  assert.equal(report.data.p1_zaklad_dane_upraveny, 52000);
});

// ─── 2. ČSSZ Report ────────────────────────────────────────────────────────

console.log('\n── ČSSZ Report ──');

it('generates ČSSZ report with correct structure', () => {
  const socialPayments = entries.filter(e => e.entry_type === 'insurance_payment' && e.category === 'social');
  const report = generateCSSZReport({
    entity, entries: nonPaymentEntries, rates: rates2024, year: 2024, paidAdvances: socialPayments,
  });
  assert.equal(report.report_type, 'cssz_overview');
  assert.ok(report.data.annual_obligation_cents > 0);
  assert.ok(report.data.total_paid_cents > 0);
  assert.equal(report.data.months_paid, 2);
  assert.ok(report.data.has_underpayment);
});

// ─── 3. VZP Report ──────────────────────────────────────────────────────────

console.log('\n── VZP Report ──');

it('generates VZP report with correct structure', () => {
  const healthPayments = entries.filter(e => e.entry_type === 'insurance_payment' && e.category === 'health');
  const report = generateVZPReport({
    entity, entries: nonPaymentEntries, rates: rates2024, year: 2024, paidAdvances: healthPayments,
  });
  assert.equal(report.report_type, 'vzp_overview');
  assert.ok(report.data.annual_obligation_cents > 0);
  assert.equal(report.data.months_paid, 2);
});

// ─── 4. Cash Book ───────────────────────────────────────────────────────────

console.log('\n── Cash Book ──');

it('cash book has chronological entries', () => {
  const book = generateCashBook({ entries, year: 2024 });
  assert.equal(book.report_type, 'cash_book');
  assert.equal(book.rows.length, entries.length);
  // Verify chronological order
  for (let i = 1; i < book.rows.length; i++) {
    assert.ok(book.rows[i].date >= book.rows[i - 1].date,
      `Row ${i} date ${book.rows[i].date} should be >= ${book.rows[i - 1].date}`);
  }
});

it('cash book running balance is correct', () => {
  const book = generateCashBook({ entries, year: 2024 });
  const lastRow = book.rows[book.rows.length - 1];
  assert.equal(lastRow.running_income_cents, book.totals.income_cents);
  assert.equal(lastRow.running_expense_cents, book.totals.expense_cents);
  assert.equal(lastRow.running_balance_cents, book.totals.income_cents - book.totals.expense_cents);
});

it('cash book totals match aggregation', () => {
  const book = generateCashBook({ entries, year: 2024 });
  assert.equal(book.totals.income_cents, toCents(100000));
  assert.equal(book.totals.expense_cents, toCents(28000));
  assert.equal(book.totals.entry_count, entries.length);
});

// ─── 5. Income Summary ─────────────────────────────────────────────────────

console.log('\n── Income Summary ──');

it('income summary by category', () => {
  const summary = generateIncomeSummary({ entity, entries, rates: rates2024, year: 2024 });
  assert.equal(summary.report_type, 'income_summary');
  assert.ok(summary.categories.length > 0);
  const services = summary.categories.find(c => c.category === 'services');
  assert.ok(services);
  assert.equal(services.income_cents, toCents(80000));
  assert.equal(services.expense_cents, toCents(5000));
});

it('income summary totals', () => {
  const summary = generateIncomeSummary({ entity, entries, rates: rates2024, year: 2024 });
  assert.equal(summary.totals.income_cents, toCents(100000));
  assert.equal(summary.totals.expense_cents, toCents(28000));
  assert.equal(summary.entry_count, entries.length);
});

it('categories sorted by balance descending', () => {
  const summary = generateIncomeSummary({ entity, entries, rates: rates2024, year: 2024 });
  for (let i = 1; i < summary.categories.length; i++) {
    assert.ok(summary.categories[i].balance_cents <= summary.categories[i - 1].balance_cents);
  }
});

// ─── 6. Advance Report ─────────────────────────────────────────────────────

console.log('\n── Advance Report ──');

it('advance report generates schedule + reconciliation', () => {
  const report = generateAdvanceReport({ entity, entries, rates: rates2024, year: 2024 });
  assert.equal(report.report_type, 'advance_report');
  assert.equal(report.schedule.length, 12);
  assert.ok(report.reconciliation);
  assert.equal(report.reconciliation.matched.length, 12);
});

it('advance report shows underpayment', () => {
  const report = generateAdvanceReport({ entity, entries, rates: rates2024, year: 2024 });
  // Only 2 social + 2 health payments, so difference should be negative
  assert.ok(report.social.paid_cents > 0);
  assert.ok(report.social.difference_cents < 0, 'Should have underpayment');
});

it('advance report missed months', () => {
  const report = generateAdvanceReport({ entity, entries, rates: rates2024, year: 2024 });
  assert.ok(report.reconciliation.missedMonths.length > 0);
});

// ─── 7. Markdown Export ─────────────────────────────────────────────────────

console.log('\n── Markdown Export ──');

it('DPFO report to markdown', () => {
  const report = generateDPFOReport({ entity, entries: nonPaymentEntries, rates: rates2024, year: 2024 });
  const md = formatReportAsMarkdown(report);
  assert.ok(md.includes('# Daňové přiznání k DPFO'));
  assert.ok(md.includes('Jan Novák'));
  assert.ok(md.includes('Příjmy celkem'));
  assert.ok(md.includes('Daň po slevách'));
  assert.ok(md.includes('25 5405/P1'));
});

it('cash book to markdown', () => {
  const book = generateCashBook({ entries, year: 2024 });
  const md = formatReportAsMarkdown(book);
  assert.ok(md.includes('# Peněžní deník'));
  assert.ok(md.includes('Datum'));
  assert.ok(md.includes('Celkem příjmy'));
});

it('income summary to markdown', () => {
  const summary = generateIncomeSummary({ entity, entries, rates: rates2024, year: 2024 });
  const md = formatReportAsMarkdown(summary);
  assert.ok(md.includes('# Přehled příjmů a výdajů'));
  assert.ok(md.includes('Kategorie'));
});

it('ČSSZ report to markdown', () => {
  const report = generateCSSZReport({
    entity, entries: nonPaymentEntries, rates: rates2024, year: 2024, paidAdvances: [],
  });
  const md = formatReportAsMarkdown(report);
  assert.ok(md.includes('Přehled OSVČ pro ČSSZ'));
  assert.ok(md.includes('Vyměřovací základ'));
});

// ─── 8. Edge Cases ──────────────────────────────────────────────────────────

console.log('\n── Edge Cases ──');

it('empty entries → zero report', () => {
  const book = generateCashBook({ entries: [], year: 2024 });
  assert.equal(book.rows.length, 0);
  assert.equal(book.totals.income_cents, 0);
  assert.equal(book.totals.expense_cents, 0);
});

it('empty entries → income summary with zero totals', () => {
  const summary = generateIncomeSummary({ entity, entries: [], rates: rates2024, year: 2024 });
  assert.equal(summary.totals.income_cents, 0);
  assert.equal(summary.categories.length, 0);
});

it('DPFO with zero income', () => {
  const report = generateDPFOReport({ entity, entries: [], rates: rates2024, year: 2024 });
  assert.equal(report.data.p1_prijmy_celkem, 0);
  assert.equal(report.data.dan_po_slevach, 0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`Phase 6 Reports: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(`  - ${f}`));
}
console.log('═'.repeat(50));
process.exit(failed > 0 ? 1 : 0);
