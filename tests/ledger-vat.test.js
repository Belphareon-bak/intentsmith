// Phase 4: VAT Engine — Unit Tests
// ══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';
import Database from 'better-sqlite3';
import { LedgerRepository } from '../src/expertises/ledger/ledger-repository.js';
import { toCents } from '../src/expertises/ledger/ledger-engine.js';
import {
  computeVATReturn, computeControlReport,
  checkRegistrationObligation, validateVATEntry,
  getVATPeriodBounds, computeVATPeriodSummary,
} from '../src/expertises/ledger/ledger-vat.js';
import { RATES } from '../src/expertises/tools/tax-rates.js';

let passed = 0, failed = 0;
const failures = [];

function it(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; failures.push(name); console.log(`  ❌ ${name}: ${err.message}`); }
}

// ─── Setup: in-memory DB with all migrations ────────────────────────────────

const db = new Database(':memory:');
const { up: up1 } = await import('../src/db/migrations/2026_02_19_008_v69_ledger_core.js');
const { up: up2 } = await import('../src/db/migrations/2026_02_20_009_v70_period_locks.js');
const { up: up3 } = await import('../src/db/migrations/2026_02_22_010_v72_vat_engine.js');
const { up: up4 } = await import('../src/db/migrations/2026_02_22_011_v73_compliance.js');
up1(db); up2(db); up3(db); up4(db);

const repo = new LedgerRepository(db);
const rates2024 = RATES[2024];

// Create VAT-registered test entity
const { id: entityId } = repo.createEntity({
  id: 'test-vat', name: 'Test OSVČ VAT', entity_type: 'osvc',
  tax_regime: 'actual', main_or_secondary: 'main', vat_registered: 1,
});

// ─── Test Data Helpers ──────────────────────────────────────────────────────

const Q1 = { start: '2024-01-01', end: '2024-03-31' };

// Standard domestic sale at 21%
function sale21(amount, opts = {}) {
  return {
    entry_type: 'income', amount_cents: toCents(amount),
    vat_rate: 0.21, vat_amount_cents: Math.round(toCents(amount) * 0.21),
    vat_type: 'standard', category: 'services',
    entry_date: opts.date || '2024-02-15', period_year: 2024,
    supply_date: opts.supply_date || opts.date || '2024-02-15',
    partner_dic: opts.dic || 'CZ12345678',
    partner_name: opts.name || 'Firma s.r.o.',
    document_number: opts.doc || 'FV2024001',
  };
}

// Standard domestic sale at 12%
function sale12(amount, opts = {}) {
  return {
    entry_type: 'income', amount_cents: toCents(amount),
    vat_rate: 0.12, vat_amount_cents: Math.round(toCents(amount) * 0.12),
    vat_type: 'standard', category: 'goods',
    entry_date: opts.date || '2024-02-15', period_year: 2024,
    supply_date: opts.supply_date || opts.date || '2024-02-15',
    partner_dic: opts.dic || 'CZ12345678',
    partner_name: opts.name || 'Firma s.r.o.',
    document_number: opts.doc || 'FV2024002',
  };
}

// Standard domestic purchase at 21%
function purchase21(amount, opts = {}) {
  return {
    entry_type: 'expense', amount_cents: toCents(amount),
    vat_rate: 0.21, vat_amount_cents: Math.round(toCents(amount) * 0.21),
    vat_type: 'standard', category: 'material', is_tax_deductible: 1,
    entry_date: opts.date || '2024-01-20', period_year: 2024,
    supply_date: opts.supply_date || opts.date || '2024-01-20',
    partner_dic: opts.dic || 'CZ87654321',
    partner_name: opts.name || 'Dodavatel a.s.',
    document_number: opts.doc || 'PF2024001',
  };
}

// Purchase at 12%
function purchase12(amount, opts = {}) {
  return {
    entry_type: 'expense', amount_cents: toCents(amount),
    vat_rate: 0.12, vat_amount_cents: Math.round(toCents(amount) * 0.12),
    vat_type: 'standard', category: 'goods', is_tax_deductible: 1,
    entry_date: opts.date || '2024-01-20', period_year: 2024,
    supply_date: opts.supply_date || opts.date || '2024-01-20',
    partner_dic: opts.dic || 'CZ87654321',
    partner_name: opts.name || 'Dodavatel a.s.',
    document_number: opts.doc || 'PF2024002',
  };
}

// ─── 1. Schema ──────────────────────────────────────────────────────────────

console.log('\n── 1. Schema ──');

it('vat_periods table exists', () => {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vat_periods'").get();
  assert(row);
});

it('financial_entries has new VAT columns', () => {
  const cols = db.prepare("PRAGMA table_info(financial_entries)").all().map(c => c.name);
  assert(cols.includes('supply_date'));
  assert(cols.includes('partner_dic'));
  assert(cols.includes('partner_name'));
  assert(cols.includes('document_number'));
  assert(cols.includes('vat_type'));
});

it('indexes created', () => {
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name);
  assert(indexes.includes('idx_vp_entity'));
  assert(indexes.includes('idx_fe_supply_date'));
});

// ─── 2. Repository: VAT Entry Storage ───────────────────────────────────────

console.log('\n── 2. Repository: VAT Entry Storage ──');

it('addEntry stores VAT metadata', () => {
  const { id } = repo.addEntry(entityId, sale21(50000, { dic: 'CZ11111111', doc: 'FV-TEST-001' }));
  const entry = repo.getEntry(id);
  assert.equal(entry.vat_rate, 0.21);
  assert.equal(entry.vat_amount_cents, Math.round(toCents(50000) * 0.21));
  assert.equal(entry.vat_type, 'standard');
  assert.equal(entry.partner_dic, 'CZ11111111');
  assert.equal(entry.document_number, 'FV-TEST-001');
  assert.equal(entry.supply_date, '2024-02-15');
});

it('updateEntry preserves VAT fields', () => {
  const { id } = repo.addEntry(entityId, sale21(30000));
  repo.updateEntry(id, { partner_dic: 'CZ99999999', document_number: 'FV-UPD-001' });
  const entry = repo.getEntry(id);
  assert.equal(entry.partner_dic, 'CZ99999999');
  assert.equal(entry.document_number, 'FV-UPD-001');
  assert.equal(entry.vat_type, 'standard'); // unchanged
});

it('addEntry without VAT fields defaults to NULL', () => {
  const { id } = repo.addEntry(entityId, {
    entry_type: 'income', amount_cents: toCents(10000), category: 'cash',
    entry_date: '2024-05-01', period_year: 2024,
  });
  const entry = repo.getEntry(id);
  assert.equal(entry.vat_type, null);
  assert.equal(entry.partner_dic, null);
  assert.equal(entry.supply_date, null);
});

// ─── 3. Repository: VAT Periods ─────────────────────────────────────────────

console.log('\n── 3. Repository: VAT Periods ──');

it('createVATPeriod creates an open period', () => {
  const { id } = repo.createVATPeriod(entityId, {
    period_type: 'monthly', period_start: '2024-01-01', period_end: '2024-01-31',
  });
  assert(id > 0);
  const period = repo.getVATPeriod(entityId, '2024-01-01');
  assert.equal(period.status, 'open');
  assert.equal(period.period_type, 'monthly');
});

it('closeVATPeriod submits with data', () => {
  repo.closeVATPeriod(entityId, '2024-01-01', {
    vatReturn: { total: 100 }, controlReport: { a4: [] },
  });
  const period = repo.getVATPeriod(entityId, '2024-01-01');
  assert.equal(period.status, 'submitted');
  assert(period.submitted_at);
  assert.equal(JSON.parse(period.vat_return_json).total, 100);
});

it('closeVATPeriod throws for already closed', () => {
  assert.throws(
    () => repo.closeVATPeriod(entityId, '2024-01-01', { vatReturn: {}, controlReport: {} }),
    /not found or already closed/,
  );
});

it('getOpenVATPeriods returns only open periods', () => {
  repo.createVATPeriod(entityId, {
    period_type: 'monthly', period_start: '2024-02-01', period_end: '2024-02-29',
  });
  const open = repo.getOpenVATPeriods(entityId);
  assert.equal(open.length, 1);
  assert.equal(open[0].period_start, '2024-02-01');
});

// ─── 4. VAT Return — Standard Domestic ──────────────────────────────────────

console.log('\n── 4. VAT Return — Standard Domestic ──');

it('computes output at 21% (row 1)', () => {
  const entries = [sale21(100000)]; // 100K base, 21K VAT
  const result = computeVATReturn({ entries, rates: rates2024, period: Q1 });
  assert.equal(result.rows.r1_base, toCents(100000));
  assert.equal(result.rows.r1_vat, Math.round(toCents(100000) * 0.21));
  assert.equal(result.rows.r2_base, 0); // no reduced
});

it('computes output at 12% (row 2)', () => {
  const entries = [sale12(50000)]; // 50K base, 6K VAT
  const result = computeVATReturn({ entries, rates: rates2024, period: Q1 });
  assert.equal(result.rows.r2_base, toCents(50000));
  assert.equal(result.rows.r2_vat, Math.round(toCents(50000) * 0.12));
});

it('computes input deductions at 21% (row 40)', () => {
  const entries = [purchase21(80000)]; // 80K base, 16.8K VAT
  const result = computeVATReturn({ entries, rates: rates2024, period: Q1 });
  assert.equal(result.rows.r40_base, toCents(80000));
  assert.equal(result.rows.r40_vat, Math.round(toCents(80000) * 0.21));
});

it('computes input deductions at 12% (row 41)', () => {
  const entries = [purchase12(30000)];
  const result = computeVATReturn({ entries, rates: rates2024, period: Q1 });
  assert.equal(result.rows.r41_base, toCents(30000));
  assert.equal(result.rows.r41_vat, Math.round(toCents(30000) * 0.12));
});

it('own tax liability = output VAT - input VAT (positive = pay)', () => {
  const entries = [sale21(200000), purchase21(80000)];
  const result = computeVATReturn({ entries, rates: rates2024, period: Q1 });
  const expectedOutput = Math.round(toCents(200000) * 0.21);
  const expectedInput = Math.round(toCents(80000) * 0.21);
  assert.equal(result.summary.total_output_vat_cents, expectedOutput);
  assert.equal(result.summary.total_input_vat_cents, expectedInput);
  assert.equal(result.summary.own_tax_liability_cents, expectedOutput - expectedInput);
  assert.equal(result.summary.is_excessive_deduction, false);
  assert.equal(result.summary.tax_to_pay_cents, expectedOutput - expectedInput);
});

it('excessive deduction when inputs > outputs', () => {
  const entries = [sale21(50000), purchase21(200000)];
  const result = computeVATReturn({ entries, rates: rates2024, period: Q1 });
  assert(result.summary.own_tax_liability_cents < 0);
  assert.equal(result.summary.is_excessive_deduction, true);
  assert.equal(result.summary.excessive_deduction_cents, Math.abs(result.summary.own_tax_liability_cents));
  assert.equal(result.summary.tax_to_pay_cents, 0);
});

it('filters entries by period (supply_date)', () => {
  const entries = [
    sale21(100000, { supply_date: '2024-02-15' }),  // in Q1
    sale21(200000, { supply_date: '2024-05-15' }),  // outside Q1
  ];
  const result = computeVATReturn({ entries, rates: rates2024, period: Q1 });
  assert.equal(result.rows.r1_base, toCents(100000)); // only Q1 entry
  assert.equal(result.entry_count, 1);
});

it('skips entries without vat_rate', () => {
  const entries = [
    sale21(100000),
    { entry_type: 'income', amount_cents: toCents(50000), category: 'cash',
      entry_date: '2024-01-15', period_year: 2024 }, // no VAT
  ];
  const result = computeVATReturn({ entries, rates: rates2024, period: Q1 });
  assert.equal(result.entry_count, 1);
  assert.equal(result.rows.r1_base, toCents(100000));
});

// ─── 5. VAT Return — Reverse Charge & EU ────────────────────────────────────

console.log('\n── 5. VAT Return — Reverse Charge & EU ──');

it('reverse charge expense: appears on both output (r10) and input (r40)', () => {
  const entries = [{
    entry_type: 'expense', amount_cents: toCents(100000),
    vat_rate: 0.21, vat_amount_cents: Math.round(toCents(100000) * 0.21),
    vat_type: 'reverse_charge', category: 'construction', is_tax_deductible: 1,
    entry_date: '2024-03-01', supply_date: '2024-03-01', period_year: 2024,
    partner_dic: 'CZ55555555',
  }];
  const result = computeVATReturn({ entries, rates: rates2024, period: Q1 });
  // Output side (r10)
  assert.equal(result.rows.r10_base, toCents(100000));
  assert.equal(result.rows.r10_vat, Math.round(toCents(100000) * 0.21));
  // Input side (r40) — deduction
  assert.equal(result.rows.r40_base, toCents(100000));
  assert.equal(result.rows.r40_vat, Math.round(toCents(100000) * 0.21));
  // Net effect = 0 (output and input cancel)
  assert.equal(result.summary.own_tax_liability_cents, 0);
});

it('EU acquisition: appears on both output (r3) and input (r40)', () => {
  const entries = [{
    entry_type: 'expense', amount_cents: toCents(50000),
    vat_rate: 0.21, vat_amount_cents: Math.round(toCents(50000) * 0.21),
    vat_type: 'eu_acquisition', category: 'goods', is_tax_deductible: 1,
    entry_date: '2024-02-10', supply_date: '2024-02-10', period_year: 2024,
    partner_dic: 'DE123456789',
  }];
  const result = computeVATReturn({ entries, rates: rates2024, period: Q1 });
  assert.equal(result.rows.r3_base, toCents(50000));
  assert.equal(result.rows.r3_vat, Math.round(toCents(50000) * 0.21));
  assert.equal(result.rows.r40_base, toCents(50000));
  assert.equal(result.rows.r40_vat, Math.round(toCents(50000) * 0.21));
});

it('EU supply: goes to r26 (exempt with deduction right)', () => {
  const entries = [{
    entry_type: 'income', amount_cents: toCents(200000),
    vat_rate: 0, vat_amount_cents: 0,
    vat_type: 'eu_supply', category: 'goods',
    entry_date: '2024-01-15', supply_date: '2024-01-15', period_year: 2024,
    partner_dic: 'SK2020123456',
  }];
  const result = computeVATReturn({ entries, rates: rates2024, period: Q1 });
  assert.equal(result.rows.r26_base, toCents(200000));
  assert.equal(result.rows.r1_base, 0); // not in standard output
});

it('exempt supply: goes to r25', () => {
  const entries = [{
    entry_type: 'income', amount_cents: toCents(80000),
    vat_rate: 0, vat_amount_cents: 0,
    vat_type: 'exempt', category: 'education',
    entry_date: '2024-03-01', supply_date: '2024-03-01', period_year: 2024,
  }];
  const result = computeVATReturn({ entries, rates: rates2024, period: Q1 });
  assert.equal(result.rows.r25_base, toCents(80000));
});

// ─── 6. Control Report (Kontrolní hlášení) ──────────────────────────────────

console.log('\n── 6. Control Report (Kontrolní hlášení) ──');

it('A.4: sales > 10,000 CZK go to individual items', () => {
  const entries = [sale21(15000, { dic: 'CZ11111111', doc: 'FV-KH-001' })];
  // total = 15000 + 3150 = 18150 > 10000
  const result = computeControlReport({ entries, period: Q1 });
  assert.equal(result.a4.length, 1);
  assert.equal(result.a4[0].partner_dic, 'CZ11111111');
  assert.equal(result.a4[0].document_number, 'FV-KH-001');
  assert.equal(result.a4[0].base_cents, toCents(15000));
});

it('A.5: sales ≤ 10,000 CZK go to aggregate', () => {
  const entries = [sale21(5000, { dic: 'CZ22222222', doc: 'FV-KH-002' })];
  // total = 5000 + 1050 = 6050 ≤ 10000
  const result = computeControlReport({ entries, period: Q1 });
  assert.equal(result.a4.length, 0);
  assert.equal(result.a5.standard.base, toCents(5000));
  assert.equal(result.a5.standard.vat, Math.round(toCents(5000) * 0.21));
});

it('B.2: purchases > 10,000 CZK go to individual items', () => {
  const entries = [purchase21(20000, { dic: 'CZ33333333', doc: 'PF-KH-001' })];
  const result = computeControlReport({ entries, period: Q1 });
  assert.equal(result.b2.length, 1);
  assert.equal(result.b2[0].partner_dic, 'CZ33333333');
});

it('B.3: purchases ≤ 10,000 CZK go to aggregate', () => {
  const entries = [purchase21(3000)];
  // total = 3000 + 630 = 3630 ≤ 10000
  const result = computeControlReport({ entries, period: Q1 });
  assert.equal(result.b2.length, 0);
  assert.equal(result.b3.standard.base, toCents(3000));
});

it('KH excludes non-standard vat_type entries', () => {
  const entries = [
    sale21(50000), // standard — goes to A.4
    { entry_type: 'income', amount_cents: toCents(100000),
      vat_rate: 0.21, vat_amount_cents: Math.round(toCents(100000) * 0.21),
      vat_type: 'reverse_charge', category: 'construction',
      entry_date: '2024-01-15', supply_date: '2024-01-15', period_year: 2024 },
  ];
  const result = computeControlReport({ entries, period: Q1 });
  assert.equal(result.a4.length, 1); // only standard
});

it('KH totals are correct', () => {
  const entries = [
    sale21(50000), // A.4 (> 10K)
    sale21(5000),  // A.5 (≤ 10K)
    purchase21(30000), // B.2 (> 10K)
    purchase12(2000),  // B.3 (≤ 10K)
  ];
  const result = computeControlReport({ entries, period: Q1 });
  assert.equal(result.totals.a4_count, 1);
  assert.equal(result.totals.b2_count, 1);
  assert.equal(result.totals.a5_base_cents, toCents(5000));
  assert.equal(result.totals.b3_base_cents, toCents(2000));
});

// ─── 7. Rolling 12M Registration Obligation ────────────────────────────────

console.log('\n── 7. Rolling 12M Registration Obligation ──');

it('below threshold → not obligated', () => {
  const entries = [
    sale21(500000, { date: '2024-06-15', supply_date: '2024-06-15' }),
    sale21(300000, { date: '2024-09-15', supply_date: '2024-09-15' }),
  ];
  const result = checkRegistrationObligation({
    entries, asOfDate: '2024-12-31', rates: rates2024,
  });
  assert.equal(result.obligated, false);
  assert.equal(result.total_supply_cents, toCents(800000));
  assert.equal(result.threshold_cents, toCents(2000000));
});

it('above threshold → obligated with exceeded_date', () => {
  const entries = [
    sale21(800000, { date: '2024-03-15', supply_date: '2024-03-15' }),
    sale21(700000, { date: '2024-06-15', supply_date: '2024-06-15' }),
    sale21(600000, { date: '2024-09-15', supply_date: '2024-09-15' }),
  ];
  const result = checkRegistrationObligation({
    entries, asOfDate: '2024-12-31', rates: rates2024,
  });
  assert.equal(result.obligated, true);
  assert.equal(result.total_supply_cents, toCents(2100000));
  assert.equal(result.exceeded_date, '2024-09-15');
});

it('only counts income entries in the 12M window', () => {
  const entries = [
    sale21(1500000, { date: '2024-06-15', supply_date: '2024-06-15' }),
    purchase21(1000000, { date: '2024-07-15', supply_date: '2024-07-15' }), // ignored
    sale21(100000, { date: '2023-01-01', supply_date: '2023-01-01' }), // outside window
  ];
  const result = checkRegistrationObligation({
    entries, asOfDate: '2024-12-31', rates: rates2024,
  });
  assert.equal(result.total_supply_cents, toCents(1500000));
  assert.equal(result.obligated, false);
});

// ─── 8. VAT Entry Validation ────────────────────────────────────────────────

console.log('\n── 8. VAT Entry Validation ──');

it('valid entry passes validation', () => {
  const entry = sale21(50000);
  const result = validateVATEntry(entry, rates2024);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

it('invalid DIČ format produces error', () => {
  const entry = { ...sale21(50000), partner_dic: 'INVALID' };
  const result = validateVATEntry(entry, rates2024);
  assert.equal(result.valid, false);
  assert(result.errors.some(e => e.includes('DIČ')));
});

it('invalid vat_type produces error', () => {
  const entry = { ...sale21(50000), vat_type: 'unknown_type' };
  const result = validateVATEntry(entry, rates2024);
  assert.equal(result.valid, false);
  assert(result.errors.some(e => e.includes('vat_type')));
});

it('unusual VAT rate produces warning', () => {
  const entry = { ...sale21(50000), vat_rate: 0.19 }; // not 21%, 12%, or 0%
  const result = validateVATEntry(entry, rates2024);
  assert.equal(result.valid, true); // warning, not error
  assert(result.warnings.some(w => w.includes('19%')));
});

it('missing supply_date produces warning', () => {
  const entry = { ...sale21(50000), supply_date: null };
  const result = validateVATEntry(entry, rates2024);
  assert(result.warnings.some(w => w.includes('DUZP')));
});

it('item > 10K without partner_dic produces warning', () => {
  const entry = { ...sale21(50000), partner_dic: null };
  const result = validateVATEntry(entry, rates2024);
  assert(result.warnings.some(w => w.includes('DIČ')));
});

it('VAT amount mismatch produces warning', () => {
  const entry = { ...sale21(50000), vat_amount_cents: 999999 }; // way off
  const result = validateVATEntry(entry, rates2024);
  assert(result.warnings.some(w => w.includes('neodpovídá')));
});

// ─── 9. Period Bounds ───────────────────────────────────────────────────────

console.log('\n── 9. Period Bounds ──');

it('monthly period bounds: January', () => {
  const p = getVATPeriodBounds(2024, 1, 'monthly');
  assert.equal(p.start, '2024-01-01');
  assert.equal(p.end, '2024-01-31');
});

it('monthly period bounds: February (leap year)', () => {
  const p = getVATPeriodBounds(2024, 2, 'monthly');
  assert.equal(p.start, '2024-02-01');
  assert.equal(p.end, '2024-02-29'); // 2024 is leap year
});

it('quarterly period bounds: Q1', () => {
  const p = getVATPeriodBounds(2024, 1, 'quarterly');
  assert.equal(p.start, '2024-01-01');
  assert.equal(p.end, '2024-03-31');
});

it('quarterly period bounds: Q4', () => {
  const p = getVATPeriodBounds(2024, 4, 'quarterly');
  assert.equal(p.start, '2024-10-01');
  assert.equal(p.end, '2024-12-31');
});

// ─── 10. Combined Period Summary ────────────────────────────────────────────

console.log('\n── 10. Combined Period Summary ──');

it('computeVATPeriodSummary includes return + KH', () => {
  const entries = [
    sale21(100000, { supply_date: '2024-01-15' }),
    purchase21(50000, { supply_date: '2024-02-10' }),
  ];
  const result = computeVATPeriodSummary({
    entries, rates: rates2024, year: 2024, periodNumber: 1, periodType: 'quarterly',
  });
  assert.equal(result.year, 2024);
  assert.equal(result.period_number, 1);
  assert.equal(result.period_type, 'quarterly');
  assert(result.vat_return);
  assert(result.control_report);
  assert(result.vat_return.summary.own_tax_liability_cents > 0);
});

// ─── 11. Edge Cases ─────────────────────────────────────────────────────────

console.log('\n── 11. Edge Cases ──');

it('empty entries → zero VAT return', () => {
  const result = computeVATReturn({ entries: [], rates: rates2024, period: Q1 });
  assert.equal(result.summary.total_output_vat_cents, 0);
  assert.equal(result.summary.total_input_vat_cents, 0);
  assert.equal(result.summary.own_tax_liability_cents, 0);
  assert.equal(result.entry_count, 0);
});

it('empty entries → empty control report', () => {
  const result = computeControlReport({ entries: [], period: Q1 });
  assert.equal(result.a4.length, 0);
  assert.equal(result.b2.length, 0);
  assert.equal(result.totals.a4_count, 0);
});

it('mixed rates in single period', () => {
  const entries = [
    sale21(100000, { supply_date: '2024-01-15' }),
    sale12(50000, { supply_date: '2024-02-15' }),
    purchase21(30000, { supply_date: '2024-03-15' }),
    purchase12(20000, { supply_date: '2024-03-20' }),
  ];
  const result = computeVATReturn({ entries, rates: rates2024, period: Q1 });
  assert.equal(result.rows.r1_base, toCents(100000));
  assert.equal(result.rows.r2_base, toCents(50000));
  assert.equal(result.rows.r40_base, toCents(30000));
  assert.equal(result.rows.r41_base, toCents(20000));
  const expectedOwnTax =
    (Math.round(toCents(100000) * 0.21) + Math.round(toCents(50000) * 0.12))
    - (Math.round(toCents(30000) * 0.21) + Math.round(toCents(20000) * 0.12));
  assert.equal(result.summary.own_tax_liability_cents, expectedOwnTax);
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
console.log(`Phase 4 VAT Tests: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failures.length > 0) {
  console.log('\nFailed tests:');
  failures.forEach(f => console.log(`  - ${f}`));
}
console.log('═'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
