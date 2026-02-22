// Phase 3: Social + Health Insurance Engine — Unit Tests
// ══════════════════════════════════════════════════════════════════════════════

import { strict as assert } from 'assert';
import { toCents, toCZK } from '../src/expertises/ledger/ledger-engine.js';
import {
  computeSocialOverview, computeHealthOverview, computeInsuranceOverviews,
  generateAdvanceSchedule, reconcilePayments,
} from '../src/expertises/ledger/ledger-insurance.js';
import { RATES } from '../src/expertises/tools/tax-rates.js';

let passed = 0, failed = 0;
const failures = [];

function it(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err) { failed++; failures.push(name); console.log(`  ❌ ${name}: ${err.message}`); }
}

const rates2024 = RATES[2024];

// ─── Test Data ───────────────────────────────────────────────────────────────

const mainEntity = {
  id: 'test-ins-main', name: 'Test OSVČ Main', entity_type: 'osvc',
  tax_regime: 'actual', main_or_secondary: 'main',
  children: 0, spouse_credit: 0,
};

const secondaryEntity = {
  id: 'test-ins-side', name: 'Test OSVČ Side', entity_type: 'osvc',
  tax_regime: 'actual', main_or_secondary: 'secondary',
  children: 0, spouse_credit: 0,
};

const flatEntity = {
  id: 'test-ins-flat', name: 'Test OSVČ Flat', entity_type: 'osvc',
  tax_regime: 'flat_expense', flat_expense_category: 'rate_60',
  main_or_secondary: 'main',
  children: 0, spouse_credit: 0,
};

// 1.2M income, 350K expenses → taxBase = 850,000 CZK = 85,000,000 cents
const standardEntries = [
  { entry_type: 'income', amount_cents: toCents(800000), category: 'services', entry_date: '2024-03-15', period_year: 2024 },
  { entry_type: 'income', amount_cents: toCents(400000), category: 'consulting', entry_date: '2024-06-20', period_year: 2024 },
  { entry_type: 'expense', amount_cents: toCents(250000), category: 'office', entry_date: '2024-04-01', period_year: 2024, is_tax_deductible: 1 },
  { entry_type: 'expense', amount_cents: toCents(100000), category: 'travel', entry_date: '2024-07-15', period_year: 2024, is_tax_deductible: 1 },
];

// 80K income, no expenses → taxBase = 80,000 CZK (below secondary threshold 105,520)
const lowIncomeEntries = [
  { entry_type: 'income', amount_cents: toCents(80000), category: 'services', entry_date: '2024-05-10', period_year: 2024 },
];

// 200K income, no expenses → taxBase = 200,000 CZK (above secondary threshold)
const aboveThresholdEntries = [
  { entry_type: 'income', amount_cents: toCents(200000), category: 'services', entry_date: '2024-05-10', period_year: 2024 },
];

// 1.2M income (flat_60: 720K expenses → taxBase = 480,000 CZK)
const flatIncomeEntries = [
  { entry_type: 'income', amount_cents: toCents(1200000), category: 'services', entry_date: '2024-06-15', period_year: 2024 },
];

function makeAdvances(monthly, count, category, year) {
  return Array.from({ length: count }, (_, i) => ({
    entry_type: 'insurance_payment',
    amount_cents: monthly,
    category,
    entry_date: `${year}-${String(i + 1).padStart(2, '0')}-15`,
    period_year: year,
  }));
}

// ─── 1. Social Insurance Overview ────────────────────────────────────────────

console.log('\n── 1. Social Insurance Overview ──');

it('computes social overview for main activity', () => {
  const result = computeSocialOverview({
    entity: mainEntity, entries: standardEntries, rates: rates2024, year: 2024,
  });
  assert.equal(result.type, 'social');
  assert.equal(result.year, 2024);
  assert.equal(result.entity_id, 'test-ins-main');
  assert.equal(result.is_main, true);
  assert.equal(result.tax_base_cents, toCents(850000));
  assert.equal(result.assessment_base_cents, toCents(850000) / 2); // 50%
  assert.equal(result.rate, 0.292);
  // annual = round(42,500,000 * 0.292) = 12,410,000
  assert.equal(result.annual_obligation_cents, 12_410_000);
  assert.equal(result.monthly_obligation_cents, Math.round(12_410_000 / 12));
});

it('detects underpayment when no advances paid', () => {
  const result = computeSocialOverview({
    entity: mainEntity, entries: standardEntries, rates: rates2024, year: 2024,
  });
  assert.equal(result.total_paid_cents, 0);
  assert.equal(result.has_underpayment, true);
  assert.equal(result.has_overpayment, false);
  assert.equal(result.underpayment_cents, 12_410_000);
  assert.equal(result.overpayment_cents, 0);
});

it('detects overpayment when advances exceed obligation', () => {
  const advances = makeAdvances(1_100_000, 12, 'social', 2024);
  const result = computeSocialOverview({
    entity: mainEntity, entries: standardEntries, rates: rates2024, year: 2024,
    paidAdvances: advances,
  });
  const totalPaid = 1_100_000 * 12;
  assert.equal(result.total_paid_cents, totalPaid);
  assert.equal(result.months_paid, 12);
  assert.equal(result.has_overpayment, true);
  assert.equal(result.has_underpayment, false);
  assert.equal(result.overpayment_cents, totalPaid - 12_410_000);
  assert.equal(result.difference_cents, totalPaid - 12_410_000);
});

it('computes next year monthly advance (above minimum)', () => {
  const result = computeSocialOverview({
    entity: mainEntity, entries: standardEntries, rates: rates2024, year: 2024,
  });
  // monthlyBase = round(42,500,000 / 12) = 3,541,667
  // computedMonthly = round(3,541,667 * 0.292) = round(1,034,166.76) = 1,034,167
  const expectedMonthly = Math.round(Math.round(toCents(850000) / 2 / 12) * 0.292);
  assert.equal(result.next_year_monthly_cents, expectedMonthly);
  assert(result.next_year_monthly_cents > result.min_monthly_cents);
});

it('secondary activity below threshold — zero obligation', () => {
  const result = computeSocialOverview({
    entity: secondaryEntity, entries: lowIncomeEntries, rates: rates2024, year: 2024,
  });
  assert.equal(result.is_main, false);
  assert.equal(result.below_threshold, true);
  assert.equal(result.annual_obligation_cents, 0);
  assert.equal(result.assessment_base_cents, 0);
});

it('secondary activity above threshold — computes obligation', () => {
  const result = computeSocialOverview({
    entity: secondaryEntity, entries: aboveThresholdEntries, rates: rates2024, year: 2024,
  });
  assert.equal(result.is_main, false);
  assert.equal(result.below_threshold, false);
  assert(result.annual_obligation_cents > 0);
  assert.equal(result.assessment_base_cents, toCents(200000) / 2);
});

it('secondary next year monthly falls to minimum when below threshold', () => {
  const result = computeSocialOverview({
    entity: secondaryEntity, entries: lowIncomeEntries, rates: rates2024, year: 2024,
  });
  // socialBase = 0 (below threshold) → computed = 0 → clamped to min
  assert.equal(result.next_year_monthly_cents, toCents(rates2024.social.osvc_min_monthly_side));
});

// ─── 2. Health Insurance Overview ────────────────────────────────────────────

console.log('\n── 2. Health Insurance Overview ──');

it('computes health overview for main activity', () => {
  const result = computeHealthOverview({
    entity: mainEntity, entries: standardEntries, rates: rates2024, year: 2024,
  });
  assert.equal(result.type, 'health');
  assert.equal(result.year, 2024);
  assert.equal(result.tax_base_cents, toCents(850000));
  assert.equal(result.assessment_base_cents, toCents(850000) / 2);
  assert.equal(result.rate, 0.135);
  // annual = round(42,500,000 * 0.135) = 5,737,500
  assert.equal(result.annual_obligation_cents, 5_737_500);
});

it('health overview tracks paid advances', () => {
  const advances = makeAdvances(296_800, 8, 'health', 2024);
  const result = computeHealthOverview({
    entity: mainEntity, entries: standardEntries, rates: rates2024, year: 2024,
    paidAdvances: advances,
  });
  assert.equal(result.total_paid_cents, 296_800 * 8);
  assert.equal(result.months_paid, 8);
  assert.equal(result.has_underpayment, true);
  assert.equal(result.underpayment_cents, 5_737_500 - 296_800 * 8);
});

it('health next year monthly above minimum', () => {
  const result = computeHealthOverview({
    entity: mainEntity, entries: standardEntries, rates: rates2024, year: 2024,
  });
  const expectedMonthly = Math.round(Math.round(toCents(850000) / 2 / 12) * 0.135);
  assert.equal(result.next_year_monthly_cents, expectedMonthly);
  assert(result.next_year_monthly_cents > result.min_monthly_cents);
});

it('health at minimum for low income (flat expense)', () => {
  const result = computeHealthOverview({
    entity: flatEntity, entries: flatIncomeEntries, rates: rates2024, year: 2024,
  });
  // flat_60: taxBase = 480,000 CZK, healthBase = 240,000 CZK = 24,000,000 cents
  // minImplied = round(3,561,600 / 0.135) = 26,382,222
  // 24,000,000 < 26,382,222 → uses minImplied base
  // healthInsurance = round(26,382,222 * 0.135) = 3,561,600
  assert.equal(result.annual_obligation_cents, 3_561_600);
  assert.equal(result.min_monthly_cents, toCents(rates2024.health.osvc_min_monthly));
});

// ─── 3. Combined Overviews ──────────────────────────────────────────────────

console.log('\n── 3. Combined Overviews ──');

it('separates payments by category and computes both overviews', () => {
  const allEntries = [
    ...standardEntries,
    ...makeAdvances(385_200, 6, 'social', 2024),
    ...makeAdvances(296_800, 6, 'health', 2024),
    { entry_type: 'tax_payment', amount_cents: toCents(50000), category: 'income_tax', entry_date: '2024-03-31', period_year: 2024 },
  ];
  const result = computeInsuranceOverviews({
    entity: mainEntity, entries: allEntries, rates: rates2024, year: 2024,
  });

  // Social overview computed from non-payment entries
  assert.equal(result.social.type, 'social');
  assert.equal(result.social.total_paid_cents, 385_200 * 6);
  assert.equal(result.social.months_paid, 6);

  // Health overview computed from non-payment entries
  assert.equal(result.health.type, 'health');
  assert.equal(result.health.total_paid_cents, 296_800 * 6);
  assert.equal(result.health.months_paid, 6);
});

it('combined totals are correct', () => {
  const allEntries = [
    ...standardEntries,
    ...makeAdvances(385_200, 6, 'social', 2024),
    ...makeAdvances(296_800, 6, 'health', 2024),
  ];
  const result = computeInsuranceOverviews({
    entity: mainEntity, entries: allEntries, rates: rates2024, year: 2024,
  });
  const c = result.combined;
  assert.equal(c.year, 2024);
  assert.equal(c.total_obligation_cents,
    result.social.annual_obligation_cents + result.health.annual_obligation_cents);
  assert.equal(c.total_paid_cents,
    result.social.total_paid_cents + result.health.total_paid_cents);
  assert.equal(c.total_difference_cents, c.total_paid_cents - c.total_obligation_cents);
  assert.equal(c.has_underpayment, c.total_difference_cents < 0);
  assert.equal(c.next_year_total_monthly_cents,
    c.next_year_social_monthly_cents + c.next_year_health_monthly_cents);
});

// ─── 4. Advance Schedule ────────────────────────────────────────────────────

console.log('\n── 4. Advance Schedule ──');

it('generates 12 months', () => {
  const schedule = generateAdvanceSchedule({
    socialMonthly: 1_000_000, healthMonthly: 500_000, year: 2025,
  });
  assert.equal(schedule.length, 12);
  assert.equal(schedule[0].month, 1);
  assert.equal(schedule[11].month, 12);
});

it('correct period labels', () => {
  const schedule = generateAdvanceSchedule({
    socialMonthly: 1_000_000, healthMonthly: 500_000, year: 2025,
  });
  assert.equal(schedule[0].period, '2025-01');
  assert.equal(schedule[5].period, '2025-06');
  assert.equal(schedule[11].period, '2025-12');
});

it('correct due dates (social 20th, health 8th of next month)', () => {
  const schedule = generateAdvanceSchedule({
    socialMonthly: 1_000_000, healthMonthly: 500_000, year: 2025,
  });
  // January → due February
  assert.equal(schedule[0].social_due, '2025-02-20');
  assert.equal(schedule[0].health_due, '2025-02-08');
  // June → due July
  assert.equal(schedule[5].social_due, '2025-07-20');
  assert.equal(schedule[5].health_due, '2025-07-08');
});

it('December wraps to next year', () => {
  const schedule = generateAdvanceSchedule({
    socialMonthly: 1_000_000, healthMonthly: 500_000, year: 2025,
  });
  assert.equal(schedule[11].social_due, '2026-01-20');
  assert.equal(schedule[11].health_due, '2026-01-08');
});

it('correct amounts per month', () => {
  const schedule = generateAdvanceSchedule({
    socialMonthly: 1_034_167, healthMonthly: 478_125, year: 2025,
  });
  for (const m of schedule) {
    assert.equal(m.social_cents, 1_034_167);
    assert.equal(m.health_cents, 478_125);
    assert.equal(m.total_cents, 1_034_167 + 478_125);
  }
});

// ─── 5. Payment Reconciliation ──────────────────────────────────────────────

console.log('\n── 5. Payment Reconciliation ──');

it('matches payments to schedule months', () => {
  const schedule = generateAdvanceSchedule({
    socialMonthly: 500_000, healthMonthly: 300_000, year: 2024,
  });
  // Pay January and February (near their due dates)
  const payments = [
    { amount_cents: 800_000, entry_date: '2024-02-18', category: 'combined' },
    { amount_cents: 800_000, entry_date: '2024-03-19', category: 'combined' },
  ];
  const result = reconcilePayments({ schedule, payments });
  assert.equal(result.matched.length, 12);
  // Jan and Feb should be matched
  assert.equal(result.matched[0].paid_cents, 800_000);
  assert.equal(result.matched[1].paid_cents, 800_000);
  assert.equal(result.unmatched.length, 0);
});

it('detects missed months', () => {
  const schedule = generateAdvanceSchedule({
    socialMonthly: 500_000, healthMonthly: 300_000, year: 2024,
  });
  // Only pay first 3 months
  const payments = [
    { amount_cents: 800_000, entry_date: '2024-02-15', category: 'combined' },
    { amount_cents: 800_000, entry_date: '2024-03-15', category: 'combined' },
    { amount_cents: 800_000, entry_date: '2024-04-15', category: 'combined' },
  ];
  const result = reconcilePayments({ schedule, payments });
  assert.equal(result.missedMonths.length, 9);
  // Months 4-12 missed
  assert(result.missedMonths.includes(4));
  assert(result.missedMonths.includes(12));
});

it('identifies unmatched payments (too far from any due date)', () => {
  const schedule = generateAdvanceSchedule({
    socialMonthly: 500_000, healthMonthly: 300_000, year: 2024,
  });
  // Payment far outside the schedule year
  const payments = [
    { amount_cents: 800_000, entry_date: '2025-06-15', category: 'combined' },
  ];
  const result = reconcilePayments({ schedule, payments });
  assert.equal(result.unmatched.length, 1);
  assert.equal(result.unmatched[0].amount_cents, 800_000);
  assert.equal(result.missedMonths.length, 12); // all missed
});

it('calculates per-month difference (overpaid vs expected)', () => {
  const schedule = generateAdvanceSchedule({
    socialMonthly: 500_000, healthMonthly: 300_000, year: 2024,
  });
  // Overpay January
  const payments = [
    { amount_cents: 1_000_000, entry_date: '2024-02-18', category: 'combined' },
  ];
  const result = reconcilePayments({ schedule, payments });
  assert.equal(result.matched[0].paid_cents, 1_000_000);
  assert.equal(result.matched[0].expected_cents, 800_000);
  assert.equal(result.matched[0].difference_cents, 200_000);
});

// ─── 6. Edge Cases ──────────────────────────────────────────────────────────

console.log('\n── 6. Edge Cases ──');

it('zero income → minimum social obligation (main)', () => {
  const result = computeSocialOverview({
    entity: mainEntity, entries: [], rates: rates2024, year: 2024,
  });
  assert.equal(result.tax_base_cents, 0);
  // At minimum: annual = minMonthly * 12
  const minAnnual = toCents(rates2024.social.osvc_min_monthly) * 12;
  assert.equal(result.annual_obligation_cents, minAnnual);
  // Next year monthly = min (computed from zero base)
  assert.equal(result.next_year_monthly_cents, toCents(rates2024.social.osvc_min_monthly));
});

it('zero income → minimum health obligation', () => {
  const result = computeHealthOverview({
    entity: mainEntity, entries: [], rates: rates2024, year: 2024,
  });
  assert.equal(result.tax_base_cents, 0);
  const minAnnual = toCents(rates2024.health.osvc_min_monthly) * 12;
  assert.equal(result.annual_obligation_cents, minAnnual);
  assert.equal(result.next_year_monthly_cents, toCents(rates2024.health.osvc_min_monthly));
});

it('exact payment matches obligation → zero difference', () => {
  const result = computeSocialOverview({
    entity: mainEntity, entries: standardEntries, rates: rates2024, year: 2024,
    paidAdvances: [{ amount_cents: 12_410_000, category: 'social', entry_date: '2024-12-31' }],
  });
  assert.equal(result.difference_cents, 0);
  assert.equal(result.has_overpayment, false);
  assert.equal(result.has_underpayment, false);
  assert.equal(result.overpayment_cents, 0);
  assert.equal(result.underpayment_cents, 0);
});

it('reconciliation with empty payments → all months missed', () => {
  const schedule = generateAdvanceSchedule({
    socialMonthly: 100_000, healthMonthly: 50_000, year: 2024,
  });
  const result = reconcilePayments({ schedule, payments: [] });
  assert.equal(result.missedMonths.length, 12);
  assert.equal(result.matched.every(m => m.paid_cents === 0), true);
  assert.equal(result.unmatched.length, 0);
});

it('combined overview with zero income', () => {
  const result = computeInsuranceOverviews({
    entity: mainEntity, entries: [], rates: rates2024, year: 2024,
  });
  const c = result.combined;
  assert(c.total_obligation_cents > 0); // minimums apply
  assert.equal(c.total_paid_cents, 0);
  assert.equal(c.has_underpayment, true);
  assert.equal(c.total_underpayment_cents, c.total_obligation_cents);
});

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
console.log(`Phase 3 Insurance Tests: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failures.length > 0) {
  console.log('\nFailed tests:');
  failures.forEach(f => console.log(`  - ${f}`));
}
console.log('═'.repeat(60));
process.exit(failed > 0 ? 1 : 0);
