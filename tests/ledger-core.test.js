// Phase 1: Ledger Core — Unit Tests
// ══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';
import Database from 'better-sqlite3';
import { LedgerRepository } from '../src/expertises/ledger/ledger-repository.js';
import {
  toCents, toCZK, aggregateEntries, computeTaxBase,
  computeIncomeTax, computeSocial, computeHealth, computeAnnualSummary,
} from '../src/expertises/ledger/ledger-engine.js';
import { RATES } from '../src/expertises/tools/tax-rates.js';

let passed = 0, failed = 0;
const failures = [];

function it(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; failures.push(name); console.log(`  ❌ ${name}: ${err.message}`); }
}

// ─── Setup: in-memory DB with migration ──────────────────────────────────────

const db = new Database(':memory:');
const { up } = await import('../src/db/migrations/2026_02_19_008_v69_ledger_core.js');
const { up: up2 } = await import('../src/db/migrations/2026_02_20_009_v70_period_locks.js');
const { up: up3 } = await import('../src/db/migrations/2026_02_22_010_v72_vat_engine.js');
const { up: up4 } = await import('../src/db/migrations/2026_02_22_011_v73_compliance.js');
up(db); up2(db); up3(db); up4(db);

const repo = new LedgerRepository(db);

// ─── 1. Schema ───────────────────────────────────────────────────────────────

console.log('\n── 1. Schema ──');

it('entity_profiles table exists', () => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entity_profiles'").get();
  assert(row);
});

it('financial_entries table exists', () => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='financial_entries'").get();
  assert(row);
});

it('entry_history table exists', () => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entry_history'").get();
  assert(row);
});

it('calculation_runs table exists', () => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='calculation_runs'").get();
  assert(row);
});

it('indexes created', () => {
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name);
  assert(indexes.includes('idx_fe_entity_year'));
  assert(indexes.includes('idx_fe_entity_date'));
  assert(indexes.includes('idx_fe_active'));
  assert(indexes.includes('idx_eh_entry'));
  assert(indexes.includes('idx_cr_entity_year'));
});

// ─── 2. Entity CRUD ──────────────────────────────────────────────────────────

console.log('\n── 2. Entity CRUD ──');

let entityId;

it('createEntity returns id', () => {
  const result = repo.createEntity({ name: 'Jan Novák', entity_type: 'osvc' });
  assert(result.id);
  entityId = result.id;
});

it('getEntity retrieves entity', () => {
  const e = repo.getEntity(entityId);
  assert(e);
  assert.equal(e.name, 'Jan Novák');
  assert.equal(e.entity_type, 'osvc');
  assert.equal(e.tax_regime, 'actual');
  assert.equal(e.main_or_secondary, 'main');
  assert.equal(e.children, 0);
});

it('updateEntity patches fields', () => {
  repo.updateEntity(entityId, { children: 2, tax_regime: 'flat_expense', flat_expense_category: 'rate_60' });
  const e = repo.getEntity(entityId);
  assert.equal(e.children, 2);
  assert.equal(e.tax_regime, 'flat_expense');
  assert.equal(e.flat_expense_category, 'rate_60');
  // Restore
  repo.updateEntity(entityId, { children: 0, tax_regime: 'actual', flat_expense_category: null });
});

it('listEntities includes created entity', () => {
  const list = repo.listEntities();
  assert(list.some(e => e.id === entityId));
});

it('getEntity returns null for missing', () => {
  assert.equal(repo.getEntity('nonexistent'), null);
});

it('updateEntity throws for missing entity', () => {
  assert.throws(() => repo.updateEntity('nonexistent', { name: 'x' }), /not found/);
});

it('createEntity with custom id', () => {
  const result = repo.createEntity({ id: 'default', name: 'Default OSVČ' });
  assert.equal(result.id, 'default');
  const e = repo.getEntity('default');
  assert.equal(e.name, 'Default OSVČ');
});

// ─── 3. Entry CRUD ───────────────────────────────────────────────────────────

console.log('\n── 3. Entry CRUD ──');

let entryId;

it('addEntry creates income entry', () => {
  const result = repo.addEntry(entityId, {
    entry_type: 'income', amount_cents: 100000_00,
    category: 'services', description: 'Faktura #001',
    document_ref: 'FV-2024-001', entry_date: '2024-03-15', period_year: 2024,
  });
  assert(result.id > 0);
  entryId = result.id;
});

it('getEntry retrieves entry', () => {
  const e = repo.getEntry(entryId);
  assert(e);
  assert.equal(e.entry_type, 'income');
  assert.equal(e.amount_cents, 100000_00);
  assert.equal(e.category, 'services');
  assert.equal(e.period_year, 2024);
  assert.equal(e.version, 1);
  assert.equal(e.deleted_at, null);
});

it('addEntry creates expense entry', () => {
  const result = repo.addEntry(entityId, {
    entry_type: 'expense', amount_cents: 25000_00,
    category: 'office', description: 'Nájem kancelář',
    entry_date: '2024-03-01', period_year: 2024,
  });
  assert(result.id > 0);
});

it('addEntry creates tax_payment entry', () => {
  const result = repo.addEntry(entityId, {
    entry_type: 'tax_payment', amount_cents: 5000_00,
    category: 'income_tax', description: 'Záloha Q1',
    entry_date: '2024-03-31', period_year: 2024,
  });
  assert(result.id > 0);
});

it('addEntry creates insurance_payment entry', () => {
  const result = repo.addEntry(entityId, {
    entry_type: 'insurance_payment', amount_cents: 3852_00,
    category: 'social', description: 'Sociální záloha březen',
    entry_date: '2024-03-20', period_year: 2024,
  });
  assert(result.id > 0);
});

it('getEntriesByYear returns all active entries', () => {
  const entries = repo.getEntriesByYear(entityId, 2024);
  assert.equal(entries.length, 4);
});

it('getEntriesByType filters correctly', () => {
  const incomes = repo.getEntriesByType(entityId, 2024, 'income');
  assert.equal(incomes.length, 1);
  assert.equal(incomes[0].amount_cents, 100000_00);
});

it('countEntries returns correct count', () => {
  assert.equal(repo.countEntries(entityId, 2024), 4);
});

it('getEntry returns null for missing', () => {
  assert.equal(repo.getEntry(99999), null);
});

// ─── 4. Update + Audit Trail ─────────────────────────────────────────────────

console.log('\n── 4. Update + Audit Trail ──');

it('updateEntry increments version and snapshots', () => {
  repo.updateEntry(entryId, { amount_cents: 120000_00, description: 'Faktura #001 (opraveno)' });
  const e = repo.getEntry(entryId);
  assert.equal(e.amount_cents, 120000_00);
  assert.equal(e.version, 2);
  assert(e.updated_at);
});

it('getEntryHistory shows old snapshot', () => {
  const history = repo.getEntryHistory(entryId);
  assert.equal(history.length, 1);
  assert.equal(history[0].snapshot.amount_cents, 100000_00);
  assert.equal(history[0].snapshot.version, 1);
});

it('second update creates second history entry', () => {
  repo.updateEntry(entryId, { description: 'Faktura #001 (final)' });
  const history = repo.getEntryHistory(entryId);
  assert.equal(history.length, 2);
  // Most recent snapshot first (id DESC) — snapshot taken before 2nd update has version=2
  assert.equal(history[0].snapshot.version, 2);
  // Older snapshot has version=1
  assert.equal(history[1].snapshot.version, 1);
});

it('updateEntry throws for missing entry', () => {
  assert.throws(() => repo.updateEntry(99999, { amount_cents: 1 }), /not found/);
});

// ─── 5. Soft Delete ──────────────────────────────────────────────────────────

console.log('\n── 5. Soft Delete ──');

it('softDeleteEntry marks entry as deleted', () => {
  // Create a temp entry to delete
  const { id } = repo.addEntry(entityId, {
    entry_type: 'expense', amount_cents: 999_00,
    category: 'misc', entry_date: '2024-06-01', period_year: 2024,
  });
  assert.equal(repo.countEntries(entityId, 2024), 5);

  repo.softDeleteEntry(id);
  assert.equal(repo.getEntry(id), null); // Not visible via getEntry
  assert.equal(repo.countEntries(entityId, 2024), 4); // Not counted
});

it('softDeleteEntry creates history snapshot', () => {
  // The temp entry from above should have 1 history entry (the pre-delete snapshot)
  // We need to track the id — let's create a fresh one
  const { id } = repo.addEntry(entityId, {
    entry_type: 'expense', amount_cents: 500_00,
    category: 'test', entry_date: '2024-07-01', period_year: 2024,
  });
  repo.softDeleteEntry(id);
  const history = repo.getEntryHistory(id);
  assert(history.length >= 1);
  assert.equal(history[0].snapshot.deleted_at, null); // Snapshot was before delete
});

it('softDeleteEntry throws for already deleted', () => {
  const { id } = repo.addEntry(entityId, {
    entry_type: 'expense', amount_cents: 100_00,
    category: 'test', entry_date: '2024-08-01', period_year: 2024,
  });
  repo.softDeleteEntry(id);
  assert.throws(() => repo.softDeleteEntry(id), /already deleted/);
});

// ─── 6. Date Range Queries ───────────────────────────────────────────────────

console.log('\n── 6. Date Range Queries ──');

it('getEntriesByDateRange filters correctly', () => {
  const entries = repo.getEntriesByDateRange(entityId, '2024-03-01', '2024-03-31');
  assert(entries.length >= 3); // income, expense, tax_payment, insurance from March
});

it('getEntriesByDateRange returns empty for no matches', () => {
  const entries = repo.getEntriesByDateRange(entityId, '2023-01-01', '2023-12-31');
  assert.equal(entries.length, 0);
});

// ─── 7. Calculation Runs ─────────────────────────────────────────────────────

console.log('\n── 7. Calculation Runs ──');

it('saveCalculationRun stores run', () => {
  const { id } = repo.saveCalculationRun({
    entity_id: entityId, year: 2024, rates_version: '2024_v1',
    input: { gross_income: 1000000 }, result: { net_income: 750000 },
  });
  assert(id);
});

it('getCalculationRuns retrieves runs with parsed JSON', () => {
  const runs = repo.getCalculationRuns(entityId, 2024);
  assert(runs.length >= 1);
  assert.equal(runs[0].input.gross_income, 1000000);
  assert.equal(runs[0].result.net_income, 750000);
});

it('getLatestRun returns most recent', () => {
  repo.saveCalculationRun({
    entity_id: entityId, year: 2024, rates_version: '2024_v2',
    input: { gross_income: 1200000 }, result: { net_income: 880000 },
  });
  const latest = repo.getLatestRun(entityId, 2024);
  assert.equal(latest.rates_version, '2024_v2');
  assert.equal(latest.input.gross_income, 1200000);
});

it('getLatestRun returns null for no runs', () => {
  assert.equal(repo.getLatestRun(entityId, 2099), null);
});

// ─── 8. Bulk Operations ──────────────────────────────────────────────────────

console.log('\n── 8. Bulk Operations ──');

it('addEntries inserts in transaction', () => {
  const before = repo.countEntries(entityId, 2025);
  const { ids } = repo.addEntries(entityId, [
    { entry_type: 'income', amount_cents: 50000_00, category: 'consulting', entry_date: '2025-01-15', period_year: 2025 },
    { entry_type: 'income', amount_cents: 60000_00, category: 'consulting', entry_date: '2025-02-15', period_year: 2025 },
    { entry_type: 'expense', amount_cents: 10000_00, category: 'office', entry_date: '2025-01-20', period_year: 2025 },
  ]);
  assert.equal(ids.length, 3);
  assert.equal(repo.countEntries(entityId, 2025), before + 3);
});

// ─── 9. Entity Cascade Delete ────────────────────────────────────────────────

console.log('\n── 9. Entity Cascade Delete ──');

it('deleteEntity cascades to entries', () => {
  const { id } = repo.createEntity({ name: 'Temp Entity' });
  repo.addEntry(id, {
    entry_type: 'income', amount_cents: 1000_00,
    category: 'test', entry_date: '2024-01-01', period_year: 2024,
  });
  assert.equal(repo.countEntries(id, 2024), 1);

  repo.deleteEntity(id);
  assert.equal(repo.getEntity(id), null);
  assert.equal(repo.countEntries(id, 2024), 0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// ENGINE TESTS (Pure Functions)
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n── 10. Engine: Helpers ──');

it('toCents converts correctly', () => {
  assert.equal(toCents(1000), 100000);
  assert.equal(toCents(0.5), 50);
  assert.equal(toCents(1234567.89), 123456789);
});

it('toCZK converts correctly', () => {
  assert.equal(toCZK(100000), 1000);
  assert.equal(toCZK(50), 0.5);
});

// ─── 11. aggregateEntries ────────────────────────────────────────────────────

console.log('\n── 11. Engine: Aggregation ──');

const testEntries = [
  { entry_type: 'income', amount_cents: 100000_00, category: 'services', is_tax_deductible: 1 },
  { entry_type: 'income', amount_cents: 50000_00, category: 'consulting', is_tax_deductible: 1 },
  { entry_type: 'expense', amount_cents: 20000_00, category: 'office', is_tax_deductible: 1 },
  { entry_type: 'expense', amount_cents: 5000_00, category: 'travel', is_tax_deductible: 0 },
  { entry_type: 'tax_payment', amount_cents: 10000_00, category: 'income_tax', is_tax_deductible: 0 },
  { entry_type: 'insurance_payment', amount_cents: 3852_00, category: 'social', is_tax_deductible: 0 },
];

it('aggregateEntries computes totals', () => {
  const agg = aggregateEntries(testEntries);
  assert.equal(agg.totalIncome, 150000_00);
  assert.equal(agg.totalExpense, 25000_00);
  assert.equal(agg.deductibleExpenses, 20000_00);
  assert.equal(agg.totalTaxPayments, 10000_00);
  assert.equal(agg.totalInsurancePayments, 3852_00);
});

it('aggregateEntries builds category breakdown', () => {
  const agg = aggregateEntries(testEntries);
  assert.equal(agg.byCategory.services.income, 100000_00);
  assert.equal(agg.byCategory.consulting.income, 50000_00);
  assert.equal(agg.byCategory.office.expense, 20000_00);
});

it('aggregateEntries handles empty entries', () => {
  const agg = aggregateEntries([]);
  assert.equal(agg.totalIncome, 0);
  assert.equal(agg.totalExpense, 0);
});

// ─── 12. computeAnnualSummary ────────────────────────────────────────────────

console.log('\n── 12. Engine: Annual Summary ──');

const rates2024 = RATES[2024];

// Standard OSVČ with actual expenses
const standardEntity = {
  entity_type: 'osvc', tax_regime: 'actual',
  main_or_secondary: 'main', children: 0, spouse_credit: 0,
};

const incomeEntries = [
  { entry_type: 'income', amount_cents: toCents(1000000), category: 'services', is_tax_deductible: 1 },
  { entry_type: 'expense', amount_cents: toCents(300000), category: 'costs', is_tax_deductible: 1 },
];

it('computeAnnualSummary: standard OSVČ 1M income', () => {
  const result = computeAnnualSummary({
    entity: standardEntity, entries: incomeEntries, rates: rates2024, year: 2024,
  });

  assert.equal(result.entity_type, 'osvc');
  assert.equal(result.year, 2024);
  assert.equal(result.regime, 'actual');
  assert.equal(result.gross_income_cents, toCents(1000000));
  assert.equal(result.expenses_cents, toCents(300000));
  assert.equal(result.tax_base_cents, toCents(700000));

  // Income tax: 700000 * 0.15 = 105000, minus taxpayer credit 30840 = 74160
  assert.equal(result.income_tax_raw_cents, toCents(700000 * 0.15));
  assert.equal(result.credits_cents, toCents(rates2024.credits.taxpayer));
  assert.equal(result.income_tax_cents, toCents(700000 * 0.15 - rates2024.credits.taxpayer));

  // Social: base = 350000, * 0.292 = 102200
  assert.equal(result.social_base_cents, toCents(350000));

  // Health: base = 350000, * 0.135 = 47250
  assert.equal(result.health_base_cents, toCents(350000));

  assert(result.total_burden_cents > 0);
  assert(result.net_income_cents > 0);
  assert(result.effective_rate > 0);
});

// Flat expense OSVČ
const flatEntity = {
  entity_type: 'osvc', tax_regime: 'flat_expense',
  flat_expense_category: 'rate_60',
  main_or_secondary: 'main', children: 1, spouse_credit: 0,
};

it('computeAnnualSummary: flat expense OSVČ', () => {
  const onlyIncome = [
    { entry_type: 'income', amount_cents: toCents(800000), category: 'services', is_tax_deductible: 1 },
  ];

  const result = computeAnnualSummary({
    entity: flatEntity, entries: onlyIncome, rates: rates2024, year: 2024,
  });

  assert.equal(result.regime, 'flat_60');
  // Flat 60%: 800000 * 0.6 = 480000
  assert.equal(result.expenses_cents, toCents(480000));
  // Tax base: 800000 - 480000 = 320000
  assert.equal(result.tax_base_cents, toCents(320000));
  // Has child benefit
  assert(result.child_benefit_cents > 0);
});

// Zero income
it('computeAnnualSummary: zero income → tax=0, minimums for insurance', () => {
  const result = computeAnnualSummary({
    entity: standardEntity, entries: [], rates: rates2024, year: 2024,
  });

  assert.equal(result.gross_income_cents, 0);
  assert.equal(result.tax_base_cents, 0);
  assert.equal(result.income_tax_cents, 0);
  // Social and health should be at minimums
  assert.equal(result.social_monthly_cents, toCents(rates2024.social.osvc_min_monthly));
  assert.equal(result.health_monthly_cents, toCents(rates2024.health.osvc_min_monthly));
});

// Negative tax base (expenses > income)
it('computeAnnualSummary: negative base → clamped to 0', () => {
  const lossEntries = [
    { entry_type: 'income', amount_cents: toCents(100000), category: 'services', is_tax_deductible: 1 },
    { entry_type: 'expense', amount_cents: toCents(200000), category: 'costs', is_tax_deductible: 1 },
  ];

  const result = computeAnnualSummary({
    entity: standardEntity, entries: lossEntries, rates: rates2024, year: 2024,
  });

  assert.equal(result.tax_base_cents, 0);
  assert.equal(result.income_tax_cents, 0);
  assert(result.warnings.some(w => w.includes('Záporný')));
});

// Secondary activity below threshold
it('computeAnnualSummary: secondary activity below threshold → social=0', () => {
  const secondaryEntity = { ...standardEntity, main_or_secondary: 'secondary' };
  const smallIncome = [
    { entry_type: 'income', amount_cents: toCents(50000), category: 'services', is_tax_deductible: 1 },
  ];

  const result = computeAnnualSummary({
    entity: secondaryEntity, entries: smallIncome, rates: rates2024, year: 2024,
  });

  // 50000 is below osvc_side_threshold (105520), so social = 0
  assert.equal(result.social_insurance_cents, 0);
});

// Children tax bonus
it('computeAnnualSummary: 3 children with low income → tax bonus', () => {
  const familyEntity = { ...standardEntity, children: 3 };
  const lowIncome = [
    { entry_type: 'income', amount_cents: toCents(300000), category: 'services', is_tax_deductible: 1 },
    { entry_type: 'expense', amount_cents: toCents(150000), category: 'costs', is_tax_deductible: 1 },
  ];

  const result = computeAnnualSummary({
    entity: familyEntity, entries: lowIncome, rates: rates2024, year: 2024,
  });

  // Tax base: 150000, tax: 22500, credits: 30840 → tax after credits: 0
  // Child benefit: 15204 + 22320 + 27840 = 65364
  // Tax bonus should be > 0
  assert(result.tax_bonus_cents > 0);
  assert.equal(result.income_tax_cents, 0);
});

// Flat tax regime
it('computeAnnualSummary: flat tax regime', () => {
  const flatTaxEntity = { ...standardEntity, tax_regime: 'flat_tax' };
  const income = [
    { entry_type: 'income', amount_cents: toCents(900000), category: 'services', is_tax_deductible: 1 },
  ];

  const result = computeAnnualSummary({
    entity: flatTaxEntity, entries: income, rates: rates2024, year: 2024,
  });

  assert.equal(result.regime, 'flat_tax');
  assert.equal(result.monthly_payment_cents, toCents(rates2024.flat_tax.monthly_payment));
  assert.equal(result.annual_payment_cents, toCents(rates2024.flat_tax.monthly_payment) * 12);
  assert(result.net_income_cents > 0);
});

// High income → higher rate
it('computeAnnualSummary: high income triggers higher rate', () => {
  const highIncome = [
    { entry_type: 'income', amount_cents: toCents(3000000), category: 'services', is_tax_deductible: 1 },
  ];

  const result = computeAnnualSummary({
    entity: standardEntity, entries: highIncome, rates: rates2024, year: 2024,
  });

  // Tax base = 3M, threshold = 1_368_900
  // Some portion taxed at 23%
  const thresholdCents = toCents(rates2024.income_tax.higher_rate_threshold);
  const expectedBasePart = Math.round(thresholdCents * 0.15);
  const expectedHigherPart = Math.round((toCents(3000000) - thresholdCents) * 0.23);
  assert.equal(result.income_tax_raw_cents, expectedBasePart + expectedHigherPart);
});

// Spouse credit
it('computeAnnualSummary: spouse credit reduces tax', () => {
  const spouseEntity = { ...standardEntity, spouse_credit: 1 };
  const income = [
    { entry_type: 'income', amount_cents: toCents(800000), category: 'services', is_tax_deductible: 1 },
  ];

  const withSpouse = computeAnnualSummary({
    entity: spouseEntity, entries: income, rates: rates2024, year: 2024,
  });
  const withoutSpouse = computeAnnualSummary({
    entity: standardEntity, entries: income, rates: rates2024, year: 2024,
  });

  assert(withSpouse.credits_cents > withoutSpouse.credits_cents);
  assert(withSpouse.income_tax_cents < withoutSpouse.income_tax_cents);
});

// 2025 rates
it('computeAnnualSummary: works with 2025 rates', () => {
  const result = computeAnnualSummary({
    entity: standardEntity,
    entries: [{ entry_type: 'income', amount_cents: toCents(1000000), category: 'services', is_tax_deductible: 1 }],
    rates: RATES[2025], year: 2025,
  });

  assert.equal(result.year, 2025);
  assert(result.total_burden_cents > 0);
  // 2025 has higher minimum social payments
  assert(result.social_monthly_cents >= toCents(RATES[2025].social.osvc_min_monthly));
});

// Flat expense cap
it('computeAnnualSummary: flat expense capped at max', () => {
  const highFlatEntity = {
    ...standardEntity, tax_regime: 'flat_expense', flat_expense_category: 'rate_60',
  };
  // 3M income → flat 60% = 1.8M but max is 1.2M
  const highIncome = [
    { entry_type: 'income', amount_cents: toCents(3000000), category: 'services', is_tax_deductible: 1 },
  ];

  const result = computeAnnualSummary({
    entity: highFlatEntity, entries: highIncome, rates: rates2024, year: 2024,
  });

  assert.equal(result.expenses_cents, toCents(1200000)); // Capped
  assert(result.warnings.some(w => w.includes('zastropovány')));
});

// ─── 13. Cross-check with existing tax-calc ──────────────────────────────────

console.log('\n── 13. Cross-check with tax-calc.js ──');

// Import existing calculator for comparison
const { calculateTax } = await import('../src/expertises/tools/tax-calc.js');

it('engine matches tax-calc.js for standard OSVČ 1M', () => {
  // Engine calculation
  const engineResult = computeAnnualSummary({
    entity: standardEntity,
    entries: [
      { entry_type: 'income', amount_cents: toCents(1000000), category: 'services', is_tax_deductible: 1 },
      { entry_type: 'expense', amount_cents: toCents(300000), category: 'costs', is_tax_deductible: 1 },
    ],
    rates: rates2024, year: 2024,
  });

  // Existing calculator
  const calcResult = calculateTax({
    gross_income: 1000000, expenses: 300000,
    expense_type: 'actual', entity_type: 'osvc', year: 2024,
  });

  assert(calcResult.success);
  const calc = calcResult.result;

  // Compare key figures (cents vs CZK)
  assert.equal(toCZK(engineResult.tax_base_cents), calc.tax_base);
  assert.equal(toCZK(engineResult.income_tax_raw_cents), calc.income_tax_before_credits);
  assert.equal(toCZK(engineResult.income_tax_cents), calc.income_tax);
  assert.equal(toCZK(engineResult.social_insurance_cents), calc.social_insurance);
  assert.equal(toCZK(engineResult.health_insurance_cents), calc.health_insurance);
});

it('engine matches tax-calc.js for flat_60 OSVČ 800K', () => {
  const engineResult = computeAnnualSummary({
    entity: { ...standardEntity, tax_regime: 'flat_expense', flat_expense_category: 'rate_60' },
    entries: [{ entry_type: 'income', amount_cents: toCents(800000), category: 'services', is_tax_deductible: 1 }],
    rates: rates2024, year: 2024,
  });

  const calcResult = calculateTax({
    gross_income: 800000, expense_type: 'flat_60', entity_type: 'osvc', year: 2024,
  });

  assert(calcResult.success);
  assert.equal(toCZK(engineResult.tax_base_cents), calcResult.result.tax_base);
  assert.equal(toCZK(engineResult.income_tax_cents), calcResult.result.income_tax);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n══════════════════════════════════════════════════════════`);
console.log(`  Ledger Core: ${passed}/${passed + failed} PASS, ${failed} FAIL`);
console.log(`══════════════════════════════════════════════════════════`);
if (failed === 0) console.log('✅ ALL LEDGER CORE TESTS PASS');
else console.log(`❌ Failures: ${failures.join(', ')}`);

db.close();
