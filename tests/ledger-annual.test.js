// Phase 2: Annual Tax Engine — Unit Tests
// ══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';
import Database from 'better-sqlite3';
import { LedgerRepository } from '../specialists/accountant-cz/ledger/ledger-repository.js';
import { toCents, toCZK, computeAnnualSummary } from '../specialists/accountant-cz/ledger/ledger-engine.js';
import {
  applyTaxLosses, detectTaxLoss, generateTaxReturnData, computeYearCloseSummary,
} from '../specialists/accountant-cz/ledger/ledger-annual.js';
import { RATES } from '../specialists/accountant-cz/tools/tax-rates.js';

let passed = 0, failed = 0;
const failures = [];

function it(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; failures.push(name); console.log(`  ❌ ${name}: ${err.message}`); }
}

// ─── Setup: in-memory DB with migrations ─────────────────────────────────────

const db = new Database(':memory:');
const { up: up1 } = await import('../src/db/migrations/2026_02_19_008_v69_ledger_core.js');
const { up: up2 } = await import('../src/db/migrations/2026_02_20_009_v70_period_locks.js');
const { up: up3 } = await import('../src/db/migrations/2026_02_22_010_v72_vat_engine.js');
const { up: up4 } = await import('../src/db/migrations/2026_02_22_011_v73_compliance.js');
up1(db); up2(db); up3(db); up4(db);

const repo = new LedgerRepository(db);

const rates2024 = RATES[2024];
const rates2025 = RATES[2025];

// Create test entity
const { id: entityId } = repo.createEntity({
  id: 'test-annual', name: 'Test OSVČ', entity_type: 'osvc',
  tax_regime: 'actual', main_or_secondary: 'main',
});

// Populate with 2024 entries
repo.addEntries(entityId, [
  { entry_type: 'income', amount_cents: toCents(1000000), category: 'services', entry_date: '2024-03-15', period_year: 2024 },
  { entry_type: 'income', amount_cents: toCents(200000), category: 'consulting', entry_date: '2024-06-20', period_year: 2024 },
  { entry_type: 'expense', amount_cents: toCents(300000), category: 'office', entry_date: '2024-04-01', period_year: 2024, is_tax_deductible: 1 },
  { entry_type: 'expense', amount_cents: toCents(50000), category: 'travel', entry_date: '2024-07-15', period_year: 2024, is_tax_deductible: 1 },
  { entry_type: 'tax_payment', amount_cents: toCents(20000), category: 'income_tax', entry_date: '2024-03-31', period_year: 2024 },
  { entry_type: 'insurance_payment', amount_cents: toCents(46224), category: 'social', entry_date: '2024-06-30', period_year: 2024 },
]);

// ─── 1. Schema ───────────────────────────────────────────────────────────────

console.log('\n── 1. Schema ──');

it('period_locks table exists', () => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='period_locks'").get();
  assert(row);
});

it('tax_losses table exists', () => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='tax_losses'").get();
  assert(row);
});

it('indexes created', () => {
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name);
  assert(indexes.includes('idx_pl_entity'));
  assert(indexes.includes('idx_tl_entity'));
});

// ─── 2. Period Locking ───────────────────────────────────────────────────────

console.log('\n── 2. Period Locking ──');

it('isPeriodLocked returns false initially', () => {
  assert.equal(repo.isPeriodLocked(entityId, 2024), false);
});

it('lockPeriod locks a year', () => {
  repo.lockPeriod(entityId, 2024, { locked_by: 'test', notes: 'Year close test' });
  assert.equal(repo.isPeriodLocked(entityId, 2024), true);
});

it('getPeriodLock returns lock details', () => {
  const lock = repo.getPeriodLock(entityId, 2024);
  assert(lock);
  assert.equal(lock.entity_id, entityId);
  assert.equal(lock.year, 2024);
  assert.equal(lock.locked_by, 'test');
  assert(lock.locked_at);
});

it('lockPeriod throws for already locked', () => {
  assert.throws(() => repo.lockPeriod(entityId, 2024), /already locked/);
});

it('getLockedYears returns all locked years', () => {
  const years = repo.getLockedYears(entityId);
  assert.equal(years.length, 1);
  assert.equal(years[0].year, 2024);
});

// ─── 3. Period Lock Guards ───────────────────────────────────────────────────

console.log('\n── 3. Period Lock Guards ──');

it('addEntry rejects when period is locked', () => {
  assert.throws(
    () => repo.addEntry(entityId, {
      entry_type: 'income', amount_cents: 1000_00,
      category: 'test', entry_date: '2024-12-01', period_year: 2024,
    }),
    /locked/,
  );
});

it('updateEntry rejects when period is locked', () => {
  // Get an existing entry from 2024
  const entries = repo.getEntriesByYear(entityId, 2024);
  assert(entries.length > 0);
  assert.throws(
    () => repo.updateEntry(entries[0].id, { amount_cents: 999_00 }),
    /locked/,
  );
});

it('softDeleteEntry rejects when period is locked', () => {
  const entries = repo.getEntriesByYear(entityId, 2024);
  assert.throws(
    () => repo.softDeleteEntry(entries[0].id),
    /locked/,
  );
});

it('addEntry still works for unlocked periods', () => {
  // 2025 is not locked
  const { id } = repo.addEntry(entityId, {
    entry_type: 'income', amount_cents: 50000_00,
    category: 'test', entry_date: '2025-01-15', period_year: 2025,
  });
  assert(id > 0);
  // Cleanup
  repo.softDeleteEntry(id);
});

// ─── 4. Unlock Period ────────────────────────────────────────────────────────

console.log('\n── 4. Unlock Period ──');

it('unlockPeriod removes lock', () => {
  repo.unlockPeriod(entityId, 2024);
  assert.equal(repo.isPeriodLocked(entityId, 2024), false);
});

it('unlockPeriod throws if not locked', () => {
  assert.throws(() => repo.unlockPeriod(entityId, 2024), /not locked/);
});

it('addEntry works after unlock', () => {
  const { id } = repo.addEntry(entityId, {
    entry_type: 'expense', amount_cents: 1000_00,
    category: 'test-unlock', entry_date: '2024-12-30', period_year: 2024,
  });
  assert(id > 0);
  // Cleanup
  repo.softDeleteEntry(id);
});

// ─── 5. Tax Loss Detection (Pure) ───────────────────────────────────────────

console.log('\n── 5. Tax Loss Detection ──');

it('detectTaxLoss: no loss when income > expenses', () => {
  const entries = [
    { entry_type: 'income', amount_cents: toCents(500000), category: 'a', is_tax_deductible: 1 },
    { entry_type: 'expense', amount_cents: toCents(200000), category: 'b', is_tax_deductible: 1 },
  ];
  const result = detectTaxLoss(entries, { tax_regime: 'actual' }, rates2024);
  assert.equal(result.hasLoss, false);
  assert.equal(result.lossAmountCents, 0);
});

it('detectTaxLoss: detects loss when expenses > income', () => {
  const entries = [
    { entry_type: 'income', amount_cents: toCents(100000), category: 'a', is_tax_deductible: 1 },
    { entry_type: 'expense', amount_cents: toCents(250000), category: 'b', is_tax_deductible: 1 },
  ];
  const result = detectTaxLoss(entries, { tax_regime: 'actual' }, rates2024);
  assert.equal(result.hasLoss, true);
  assert.equal(result.lossAmountCents, toCents(150000));
});

it('detectTaxLoss: flat_expense never has loss (expenses ≤ income)', () => {
  const entries = [
    { entry_type: 'income', amount_cents: toCents(100000), category: 'a', is_tax_deductible: 1 },
  ];
  const entity = { tax_regime: 'flat_expense', flat_expense_category: 'rate_60' };
  const result = detectTaxLoss(entries, entity, rates2024);
  assert.equal(result.hasLoss, false);
});

it('detectTaxLoss: flat_tax returns no loss', () => {
  const result = detectTaxLoss([], { tax_regime: 'flat_tax' }, rates2024);
  assert.equal(result.hasLoss, false);
});

// ─── 6. Tax Loss Carryforward (Pure) ─────────────────────────────────────────

console.log('\n── 6. Tax Loss Carryforward ──');

it('applyTaxLosses: applies single loss', () => {
  const losses = [
    { origin_year: 2022, remaining_cents: toCents(100000), expires_year: 2027 },
  ];
  const result = applyTaxLosses(toCents(300000), losses, 2024);
  assert.equal(result.adjustedTaxBase, toCents(200000));
  assert.equal(result.totalApplied, toCents(100000));
  assert.equal(result.lossesApplied.length, 1);
  assert.equal(result.lossesApplied[0].new_remaining_cents, 0);
});

it('applyTaxLosses: applies multiple losses FIFO', () => {
  const losses = [
    { origin_year: 2021, remaining_cents: toCents(50000), expires_year: 2026 },
    { origin_year: 2022, remaining_cents: toCents(80000), expires_year: 2027 },
  ];
  const result = applyTaxLosses(toCents(100000), losses, 2024);
  assert.equal(result.adjustedTaxBase, toCents(0));
  assert.equal(result.totalApplied, toCents(100000));
  assert.equal(result.lossesApplied.length, 2);
  // First loss fully used
  assert.equal(result.lossesApplied[0].applied_cents, toCents(50000));
  assert.equal(result.lossesApplied[0].new_remaining_cents, 0);
  // Second loss partially used
  assert.equal(result.lossesApplied[1].applied_cents, toCents(50000));
  assert.equal(result.lossesApplied[1].new_remaining_cents, toCents(30000));
});

it('applyTaxLosses: skips expired losses', () => {
  const losses = [
    { origin_year: 2018, remaining_cents: toCents(100000), expires_year: 2023 }, // expired
    { origin_year: 2022, remaining_cents: toCents(50000), expires_year: 2027 },
  ];
  const result = applyTaxLosses(toCents(200000), losses, 2024);
  assert.equal(result.totalApplied, toCents(50000));
  assert.equal(result.lossesApplied.length, 1);
  assert.equal(result.lossesApplied[0].origin_year, 2022);
});

it('applyTaxLosses: no losses to apply', () => {
  const result = applyTaxLosses(toCents(300000), [], 2024);
  assert.equal(result.adjustedTaxBase, toCents(300000));
  assert.equal(result.totalApplied, 0);
  assert.equal(result.lossesApplied.length, 0);
});

it('applyTaxLosses: loss > tax base → base = 0', () => {
  const losses = [
    { origin_year: 2023, remaining_cents: toCents(500000), expires_year: 2028 },
  ];
  const result = applyTaxLosses(toCents(200000), losses, 2024);
  assert.equal(result.adjustedTaxBase, 0);
  assert.equal(result.totalApplied, toCents(200000));
  assert.equal(result.lossesApplied[0].new_remaining_cents, toCents(300000));
});

// ─── 7. Tax Loss Repository ─────────────────────────────────────────────────

console.log('\n── 7. Tax Loss Repository ──');

it('recordTaxLoss stores loss', () => {
  repo.recordTaxLoss(entityId, 2023, toCents(150000));
  const loss = repo.getTaxLoss(entityId, 2023);
  assert(loss);
  assert.equal(loss.original_amount_cents, toCents(150000));
  assert.equal(loss.remaining_cents, toCents(150000));
  assert.equal(loss.expires_year, 2028);
});

it('getActiveLosses returns unexpired losses', () => {
  const losses = repo.getActiveLosses(entityId, 2024);
  assert.equal(losses.length, 1);
  assert.equal(losses[0].origin_year, 2023);
});

it('updateLossRemaining reduces remaining', () => {
  repo.updateLossRemaining(entityId, 2023, toCents(50000));
  const loss = repo.getTaxLoss(entityId, 2023);
  assert.equal(loss.remaining_cents, toCents(50000));
  // Restore
  repo.updateLossRemaining(entityId, 2023, toCents(150000));
});

it('getActiveLosses excludes fully used losses', () => {
  repo.recordTaxLoss(entityId, 2022, toCents(100000));
  repo.updateLossRemaining(entityId, 2022, 0); // fully used
  const losses = repo.getActiveLosses(entityId, 2024);
  assert.equal(losses.length, 1); // only 2023 remaining
  assert.equal(losses[0].origin_year, 2023);
});

// ─── 8. Tax Return Data Generation ──────────────────────────────────────────

console.log('\n── 8. Tax Return Data ──');

const testEntity = {
  id: entityId, entity_type: 'osvc', name: 'Test OSVČ',
  tax_regime: 'actual', main_or_secondary: 'main',
  children: 0, spouse_credit: 0, rates_version: '2024_v1',
};

const entries2024 = repo.getEntriesByYear(entityId, 2024);

it('generateTaxReturnData produces valid form', () => {
  const form = generateTaxReturnData({
    entity: testEntity, entries: entries2024, rates: rates2024, year: 2024,
  });

  assert.equal(form.rok, 2024);
  assert.equal(form.typ_subjektu, 'osvc');
  assert.equal(form.p1_typ_vydaju, 'actual');
  assert(form.p1_prijmy_celkem > 0);
  assert(form.p1_vydaje_celkem > 0);
  assert(form.p1_rozdil > 0);
  assert(form.dan_pred_slevami > 0);
  assert(form.slevy_celkem > 0);
  assert(form.socialni_pojistne > 0);
  assert(form.zdravotni_pojistne > 0);
  assert(form.celkove_zatizeni > 0);
  assert(form.cisty_prijem > 0);
  assert(form.efektivni_sazba > 0);
});

it('generateTaxReturnData: příjmy = 1200000', () => {
  const form = generateTaxReturnData({
    entity: testEntity, entries: entries2024, rates: rates2024, year: 2024,
  });
  assert.equal(form.p1_prijmy_celkem, 1200000);
});

it('generateTaxReturnData: výdaje = 350000', () => {
  const form = generateTaxReturnData({
    entity: testEntity, entries: entries2024, rates: rates2024, year: 2024,
  });
  assert.equal(form.p1_vydaje_celkem, 350000);
});

it('generateTaxReturnData: základ daně = 850000', () => {
  const form = generateTaxReturnData({
    entity: testEntity, entries: entries2024, rates: rates2024, year: 2024,
  });
  assert.equal(form.p1_rozdil, 850000);
});

it('generateTaxReturnData includes advance payments', () => {
  const form = generateTaxReturnData({
    entity: testEntity, entries: entries2024, rates: rates2024, year: 2024,
  });
  assert.equal(form.zaplacene_zalohy_dan, 20000);
  assert.equal(form.zaplacene_zalohy_pojistne, 46224);
});

it('generateTaxReturnData: doplatek daně calculated', () => {
  const form = generateTaxReturnData({
    entity: testEntity, entries: entries2024, rates: rates2024, year: 2024,
  });
  // doplatek = dan_celkem - zaplacene_zalohy_dan
  assert.equal(form.doplatek_dan, form.dan_celkem - form.zaplacene_zalohy_dan);
});

it('generateTaxReturnData: with loss carryforward', () => {
  const losses = [
    { origin_year: 2023, remaining_cents: toCents(100000), expires_year: 2028 },
  ];
  const form = generateTaxReturnData({
    entity: testEntity, entries: entries2024, rates: rates2024, year: 2024,
    activeLosses: losses,
  });
  assert.equal(form.p1_ztrata_minulych_let, 100000);
  assert.equal(form.p1_zaklad_dane_upraveny, 850000 - 100000);
  assert(form.p1_ztrata_detail.length > 0);
});

// ─── 9. Year Close Summary ──────────────────────────────────────────────────

console.log('\n── 9. Year Close Summary ──');

it('computeYearCloseSummary produces complete data', () => {
  const result = computeYearCloseSummary({
    entity: testEntity, entries: entries2024, rates: rates2024, year: 2024,
  });

  assert.equal(result.year, 2024);
  assert.equal(result.entity_id, entityId);
  assert(result.summary);
  assert(result.taxReturn);
  assert(result.loss);
  assert(result.lossApplication);
  assert.equal(result.entryCount, entries2024.length);
  assert.equal(result.rates_version, '2024_v1');
});

it('computeYearCloseSummary: no loss for profitable year', () => {
  const result = computeYearCloseSummary({
    entity: testEntity, entries: entries2024, rates: rates2024, year: 2024,
  });
  assert.equal(result.loss.hasLoss, false);
});

it('computeYearCloseSummary: detects loss for unprofitable year', () => {
  const lossEntries = [
    { entry_type: 'income', amount_cents: toCents(50000), category: 'a', is_tax_deductible: 1 },
    { entry_type: 'expense', amount_cents: toCents(200000), category: 'b', is_tax_deductible: 1 },
  ];
  const result = computeYearCloseSummary({
    entity: testEntity, entries: lossEntries, rates: rates2024, year: 2024,
  });
  assert.equal(result.loss.hasLoss, true);
  assert.equal(result.loss.lossAmountCents, toCents(150000));
});

// ─── 10. Lock with Calculation Run ──────────────────────────────────────────

console.log('\n── 10. Lock with Calculation Run ──');

it('lockPeriod with calculation_run_id', () => {
  const closeSummary = computeYearCloseSummary({
    entity: testEntity, entries: entries2024, rates: rates2024, year: 2024,
  });

  const { id: runId } = repo.saveCalculationRun({
    entity_id: entityId, year: 2024, rates_version: closeSummary.rates_version,
    input: { entity: testEntity, entryCount: entries2024.length },
    result: closeSummary.summary,
  });

  repo.lockPeriod(entityId, 2024, {
    locked_by: 'annual_close', calculation_run_id: runId, notes: 'Roční uzávěrka 2024',
  });

  const lock = repo.getPeriodLock(entityId, 2024);
  assert.equal(lock.locked_by, 'annual_close');
  assert.equal(lock.calculation_run_id, runId);
  assert(lock.notes.includes('2024'));
});

it('locked period has associated calculation run', () => {
  const lock = repo.getPeriodLock(entityId, 2024);
  const run = repo.getLatestRun(entityId, 2024);
  assert(run);
  assert.equal(lock.calculation_run_id, run.id);
});

// ─── 11. Edge Cases ──────────────────────────────────────────────────────────

console.log('\n── 11. Edge Cases ──');

it('generateTaxReturnData: zero income year', () => {
  const form = generateTaxReturnData({
    entity: testEntity, entries: [], rates: rates2024, year: 2024,
  });
  assert.equal(form.p1_prijmy_celkem, 0);
  assert.equal(form.p1_vydaje_celkem, 0);
  assert.equal(form.dan_celkem, 0);
  assert(form.socialni_pojistne > 0); // minimums
  assert(form.zdravotni_pojistne > 0); // minimums
});

it('generateTaxReturnData: with children', () => {
  const entityKids = { ...testEntity, children: 2 };
  const form = generateTaxReturnData({
    entity: entityKids, entries: entries2024, rates: rates2024, year: 2024,
  });
  assert(form.zvyhodneni_deti > 0);
});

it('generateTaxReturnData: flat_expense entity', () => {
  const flatEntity = {
    ...testEntity, tax_regime: 'flat_expense', flat_expense_category: 'rate_60',
  };
  const form = generateTaxReturnData({
    entity: flatEntity, entries: entries2024, rates: rates2024, year: 2024,
  });
  assert.equal(form.p1_typ_vydaju, 'flat_60');
  // Flat 60% of 1.2M = 720000
  assert.equal(form.p1_vydaje_celkem, 720000);
  assert.equal(form.p1_rozdil, 480000);
});

it('generateTaxReturnData: 2025 rates', () => {
  const form = generateTaxReturnData({
    entity: testEntity,
    entries: [{ entry_type: 'income', amount_cents: toCents(800000), category: 'a', is_tax_deductible: 1 }],
    rates: rates2025, year: 2025,
  });
  assert.equal(form.rok, 2025);
  assert(form.socialni_mesicni >= Math.round(rates2025.social.osvc_min_monthly));
});

// ─── Summary ─────────────────────────────────────────────────────────────────

// Cleanup
repo.unlockPeriod(entityId, 2024);

console.log(`\n══════════════════════════════════════════════════════════`);
console.log(`  Annual Engine: ${passed}/${passed + failed} PASS, ${failed} FAIL`);
console.log(`══════════════════════════════════════════════════════════`);
if (failed === 0) console.log('✅ ALL ANNUAL ENGINE TESTS PASS');
else console.log(`❌ Failures: ${failures.join(', ')}`);

db.close();
