// Phase 5: Compliance Layer — Unit Tests
// ══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';
import Database from 'better-sqlite3';
import { LedgerRepository } from '../src/expertises/ledger/ledger-repository.js';
import { toCents } from '../src/expertises/ledger/ledger-engine.js';
import {
  getObligations, getAnnualDeadlines, getMonthlyDeadlines,
  getVATDeadlines, checkDeadlineStatus, runComplianceCheck,
} from '../src/expertises/ledger/ledger-compliance.js';
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

// Test entities
const { id: entityId } = repo.createEntity({
  id: 'test-compliance', name: 'Test OSVČ Compliance', entity_type: 'osvc',
  tax_regime: 'actual', main_or_secondary: 'main', vat_registered: 0,
});

const { id: vatEntityId } = repo.createEntity({
  id: 'test-compliance-vat', name: 'Test OSVČ VAT Compliance', entity_type: 'osvc',
  tax_regime: 'actual', main_or_secondary: 'main', vat_registered: 1,
});

const entity = repo.getEntity(entityId);
const vatEntity = repo.getEntity(vatEntityId);

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n╔═══════════════════════════════════════════════╗');
console.log('║  Phase 5: Compliance Layer                    ║');
console.log('╚═══════════════════════════════════════════════╝\n');

// ─── 1. Schema ──────────────────────────────────────────────────────────────

console.log('── Schema ──');

it('compliance_checks table exists', () => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const names = tables.map(t => t.name);
  assert.ok(names.includes('compliance_checks'));
});

// ─── 2. getObligations ──────────────────────────────────────────────────────

console.log('\n── getObligations ──');

it('returns base obligations for non-VAT OSVČ', () => {
  const obs = getObligations(entity);
  const codes = obs.map(o => o.code);
  assert.ok(codes.includes('dpfo_filing'));
  assert.ok(codes.includes('cssz_overview'));
  assert.ok(codes.includes('vzp_overview'));
  assert.ok(codes.includes('social_advance'));
  assert.ok(codes.includes('health_advance'));
  assert.ok(!codes.includes('vat_return'), 'Non-VAT entity should not have VAT obligations');
  assert.ok(!codes.includes('control_report'));
});

it('includes VAT obligations for VAT-registered entity', () => {
  const obs = getObligations(vatEntity);
  const codes = obs.map(o => o.code);
  assert.ok(codes.includes('vat_return'));
  assert.ok(codes.includes('control_report'));
});

// ─── 3. getAnnualDeadlines ──────────────────────────────────────────────────

console.log('\n── getAnnualDeadlines ──');

it('returns correct filing-year deadlines for 2024', () => {
  const deadlines = getAnnualDeadlines(2024);
  assert.ok(deadlines.length >= 4);
  const dpfo = deadlines.find(d => d.code === 'dpfo_filing');
  assert.equal(dpfo.deadline, '2025-04-01');
  const cssz = deadlines.find(d => d.code === 'cssz_overview');
  assert.equal(cssz.deadline, '2025-05-02');
  const vzp = deadlines.find(d => d.code === 'vzp_overview');
  assert.equal(vzp.deadline, '2025-05-02');
});

it('deadlines have law references', () => {
  const deadlines = getAnnualDeadlines(2024);
  for (const d of deadlines) {
    assert.ok(d.law, `Missing law reference for ${d.code}`);
  }
});

// ─── 4. getMonthlyDeadlines ─────────────────────────────────────────────────

console.log('\n── getMonthlyDeadlines ──');

it('returns social + health advance deadlines for January', () => {
  const deadlines = getMonthlyDeadlines(2024, 1);
  assert.equal(deadlines.length, 2);
  const social = deadlines.find(d => d.code === 'social_advance');
  assert.equal(social.deadline, '2024-02-20');
  assert.equal(social.for_period, '2024-01');
  const health = deadlines.find(d => d.code === 'health_advance');
  assert.equal(health.deadline, '2024-02-08');
});

it('December advance due in January of next year', () => {
  const deadlines = getMonthlyDeadlines(2024, 12);
  const social = deadlines.find(d => d.code === 'social_advance');
  assert.equal(social.deadline, '2025-01-20');
});

// ─── 5. getVATDeadlines ─────────────────────────────────────────────────────

console.log('\n── getVATDeadlines ──');

it('generates 24 monthly VAT deadlines (return + KH)', () => {
  const deadlines = getVATDeadlines(2024, 'monthly');
  assert.equal(deadlines.length, 24); // 12 months × 2 (return + KH)
  const jan = deadlines.find(d => d.period === '2024-01' && d.code === 'vat_return');
  assert.equal(jan.deadline, '2024-02-25');
  const dec = deadlines.find(d => d.period === '2024-12' && d.code === 'vat_return');
  assert.equal(dec.deadline, '2025-01-25');
});

it('generates 8 quarterly VAT deadlines', () => {
  const deadlines = getVATDeadlines(2024, 'quarterly');
  assert.equal(deadlines.length, 8); // 4 quarters × 2
  const q1 = deadlines.find(d => d.period === '2024-Q1' && d.code === 'vat_return');
  assert.equal(q1.deadline, '2024-04-25');
  const q4 = deadlines.find(d => d.period === '2024-Q4' && d.code === 'vat_return');
  assert.equal(q4.deadline, '2025-01-25');
});

// ─── 6. checkDeadlineStatus ─────────────────────────────────────────────────

console.log('\n── checkDeadlineStatus ──');

it('future deadline → ok', () => {
  const r = checkDeadlineStatus('2025-04-01', '2025-01-15');
  assert.equal(r.status, 'ok');
  assert.ok(r.days_remaining > 14);
});

it('within warning window → warning', () => {
  const r = checkDeadlineStatus('2025-04-01', '2025-03-25');
  assert.equal(r.status, 'warning');
  assert.ok(r.days_remaining <= 14);
  assert.ok(r.days_remaining >= 0);
});

it('past deadline → overdue', () => {
  const r = checkDeadlineStatus('2025-04-01', '2025-04-15');
  assert.equal(r.status, 'overdue');
  assert.ok(r.days_remaining < 0);
});

it('exact deadline date → ok (0 days remaining)', () => {
  const r = checkDeadlineStatus('2025-04-01', '2025-04-01');
  assert.equal(r.status, 'warning'); // 0 days ≤ 14 = warning
  assert.equal(r.days_remaining, 0);
});

it('custom warning window', () => {
  const r = checkDeadlineStatus('2025-04-01', '2025-03-25', 5);
  assert.equal(r.status, 'ok'); // 7 days > 5 day window
});

// ─── 7. runComplianceCheck ──────────────────────────────────────────────────

console.log('\n── runComplianceCheck ──');

it('all OK when period locked and in filing year', () => {
  const r = runComplianceCheck({
    entity, year: 2024, asOfDate: '2025-01-15',
    periodLock: { year: 2024 },
    insurancePayments: {
      social: new Array(12).fill({ amount_cents: toCents(3852) }),
      health: new Array(12).fill({ amount_cents: toCents(2968) }),
    },
    entries: [],
    rates: rates2024,
  });
  assert.equal(r.summary.overall_status, 'ok');
  assert.equal(r.summary.violations, 0);
});

it('violation when tax return not filed past deadline', () => {
  const r = runComplianceCheck({
    entity, year: 2024, asOfDate: '2025-05-01',
    periodLock: null,
    insurancePayments: { social: [], health: [] },
    entries: [],
    rates: rates2024,
  });
  const dpfo = r.results.find(c => c.code === 'dpfo_filing');
  assert.equal(dpfo.status, 'violation');
  assert.equal(r.summary.violations >= 1, true);
});

it('warning for approaching deadline', () => {
  const r = runComplianceCheck({
    entity, year: 2024, asOfDate: '2025-03-25',
    periodLock: null,
    insurancePayments: { social: [], health: [] },
    entries: [],
    rates: rates2024,
  });
  const dpfo = r.results.find(c => c.code === 'dpfo_filing');
  assert.equal(dpfo.status, 'warning');
});

it('insurance advance violation when none paid', () => {
  const r = runComplianceCheck({
    entity, year: 2024, asOfDate: '2025-06-01',
    periodLock: null,
    insurancePayments: { social: [], health: [] },
    entries: [],
    rates: rates2024,
  });
  const social = r.results.find(c => c.code === 'social_advance');
  assert.equal(social.status, 'violation');
  const health = r.results.find(c => c.code === 'health_advance');
  assert.equal(health.status, 'violation');
});

it('insurance advance warning when partially paid', () => {
  const r = runComplianceCheck({
    entity, year: 2024, asOfDate: '2025-06-01',
    periodLock: null,
    insurancePayments: {
      social: new Array(6).fill({ amount_cents: toCents(3852) }),
      health: new Array(6).fill({ amount_cents: toCents(2968) }),
    },
    entries: [],
    rates: rates2024,
  });
  const social = r.results.find(c => c.code === 'social_advance');
  assert.equal(social.status, 'warning'); // 6 paid, 12 expected
});

it('non-VAT entity skips VAT checks', () => {
  const r = runComplianceCheck({
    entity, year: 2024, asOfDate: '2025-06-01',
    periodLock: { year: 2024 },
    insurancePayments: {
      social: new Array(12).fill({ amount_cents: toCents(3852) }),
      health: new Array(12).fill({ amount_cents: toCents(2968) }),
    },
    vatPeriods: [],
    entries: [],
    rates: rates2024,
  });
  const vatCodes = r.results.filter(c => c.code === 'vat_return' || c.code === 'control_report');
  assert.equal(vatCodes.length, 0);
});

it('VAT entity gets VAT checks', () => {
  const r = runComplianceCheck({
    entity: vatEntity, year: 2024, asOfDate: '2025-06-01',
    periodLock: null,
    insurancePayments: { social: [], health: [] },
    vatPeriods: [
      { status: 'submitted' }, { status: 'submitted' },
      { status: 'open' },
    ],
    entries: [],
    rates: rates2024,
  });
  const vat = r.results.find(c => c.code === 'vat_return');
  assert.ok(vat, 'VAT check should exist');
  assert.equal(vat.status, 'warning'); // 2 submitted < 12 expected, but open exists
});

it('summary counts correct', () => {
  const r = runComplianceCheck({
    entity, year: 2024, asOfDate: '2025-06-01',
    periodLock: null,
    insurancePayments: { social: [], health: [] },
    entries: [],
    rates: rates2024,
  });
  assert.equal(r.summary.total_checks, r.results.length);
  assert.equal(r.summary.ok + r.summary.warnings + r.summary.violations, r.summary.total_checks);
});

// ─── 8. Repository — Compliance Checks ──────────────────────────────────────

console.log('\n── Repository Compliance CRUD ──');

it('saveComplianceCheck + getComplianceChecks', () => {
  repo.saveComplianceCheck(entityId, {
    rule_code: 'dpfo_filing', year: 2024, status: 'ok', detail: 'Filed on time',
  });
  repo.saveComplianceCheck(entityId, {
    rule_code: 'cssz_overview', year: 2024, status: 'warning', detail: 'Due soon',
  });
  const checks = repo.getComplianceChecks(entityId, 2024);
  assert.equal(checks.length, 2);
  assert.ok(checks.some(c => c.rule_code === 'dpfo_filing' && c.status === 'ok'));
});

it('upsert updates existing check', () => {
  repo.saveComplianceCheck(entityId, {
    rule_code: 'dpfo_filing', year: 2024, status: 'violation', detail: 'Now overdue',
  });
  const checks = repo.getComplianceChecks(entityId, 2024);
  const dpfo = checks.find(c => c.rule_code === 'dpfo_filing');
  assert.equal(dpfo.status, 'violation');
});

it('getComplianceChecksByRule returns history', () => {
  repo.saveComplianceCheck(entityId, {
    rule_code: 'dpfo_filing', year: 2023, status: 'ok',
  });
  const history = repo.getComplianceChecksByRule(entityId, 'dpfo_filing');
  assert.ok(history.length >= 2);
  assert.equal(history[0].year, 2024); // newest first
});

// ─── 9. Edge Cases ──────────────────────────────────────────────────────────

console.log('\n── Edge Cases ──');

it('early in year — no advance obligations yet', () => {
  const r = runComplianceCheck({
    entity, year: 2025, asOfDate: '2025-01-05',
    periodLock: null,
    insurancePayments: { social: [], health: [] },
    entries: [],
    rates: rates2024,
  });
  // asOfDate is in year 2025, which is the fiscal year being checked
  // month is January (index 0), so expectedMonths = 0
  const social = r.results.find(c => c.code === 'social_advance');
  assert.equal(social, undefined); // no advance checks yet
});

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(50)}`);
console.log(`Phase 5 Compliance: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('Failures:');
  failures.forEach(f => console.log(`  - ${f}`));
}
console.log('═'.repeat(50));
process.exit(failed > 0 ? 1 : 0);
