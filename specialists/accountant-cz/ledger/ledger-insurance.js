// Phase 3 — Social + Health Insurance Engine (Pure Computation)
// ══════════════════════════════════════════════════════════════════════════════
//
// PURE FUNCTIONS ONLY. No DB. No side effects.
//
// Generates:
//   - Přehled OSVČ pro ČSSZ (social insurance overview)
//   - Přehled OSVČ pro VZP (health insurance overview)
//   - Monthly advance recommendations for next year
//   - Payment reconciliation (paid vs. owed)
//
// All amounts in haléře (cents).
//
// ══════════════════════════════════════════════════════════════════════════════

import { toCents, toCZK, aggregateEntries, computeTaxBase, computeSocial, computeHealth } from './ledger-engine.js';

// ─── Social Insurance Overview (Přehled OSVČ pro ČSSZ) ───────────────────────

/**
 * Compute social insurance overview for ČSSZ.
 * PURE FUNCTION.
 *
 * @param {{ entity: Object, entries: Object[], rates: Object, year: number,
 *           paidAdvances?: Object[] }} input
 *   paidAdvances = insurance_payment entries with category='social'
 * @returns {Object} ČSSZ overview data
 */
export function computeSocialOverview({ entity, entries, rates, year, paidAdvances = [] }) {
  const agg = aggregateEntries(entries);
  const { taxBase } = computeTaxBase(entity, agg, rates);
  const social = computeSocial(taxBase, entity, rates);

  const isMain = entity.main_or_secondary === 'main';
  const minMonthly = isMain
    ? toCents(rates.social.osvc_min_monthly)
    : toCents(rates.social.osvc_min_monthly_side);

  // What was paid in advances
  const totalPaid = paidAdvances.reduce((s, e) => s + e.amount_cents, 0);
  const monthsPaid = paidAdvances.length;

  // Annual obligation
  const annualObligation = social.socialInsurance;

  // Difference
  const difference = totalPaid - annualObligation;
  const hasOverpayment = difference > 0;
  const hasUnderpayment = difference < 0;

  // Monthly advance for next year (based on this year's base)
  const monthlyBase = Math.round(social.socialBase / 12);
  const computedMonthly = Math.round(monthlyBase * rates.social.osvc_rate);
  const nextYearMonthly = Math.max(computedMonthly, minMonthly);

  // Secondary activity: check threshold
  let belowThreshold = false;
  if (!isMain) {
    const thresholdCents = toCents(rates.social.osvc_side_threshold);
    belowThreshold = taxBase < thresholdCents;
  }

  return {
    year,
    entity_id: entity.id,
    type: 'social',

    // Vyměřovací základ
    tax_base_cents: taxBase,
    assessment_base_cents: social.socialBase,
    rate: rates.social.osvc_rate,

    // Roční povinnost
    annual_obligation_cents: annualObligation,
    monthly_obligation_cents: Math.round(annualObligation / 12),

    // Zaplacené zálohy
    total_paid_cents: totalPaid,
    months_paid: monthsPaid,

    // Doplatek / přeplatek
    difference_cents: difference,
    has_overpayment: hasOverpayment,
    has_underpayment: hasUnderpayment,
    underpayment_cents: hasUnderpayment ? Math.abs(difference) : 0,
    overpayment_cents: hasOverpayment ? difference : 0,

    // Nová záloha na další rok
    next_year_monthly_cents: nextYearMonthly,

    // Limity
    is_minimum: social.isMinimum,
    is_capped: social.isCapped,
    min_monthly_cents: minMonthly,
    max_base_cents: toCents(rates.social.max_base),

    // Vedlejší činnost
    is_main: isMain,
    below_threshold: belowThreshold,
  };
}

// ─── Health Insurance Overview (Přehled OSVČ pro VZP) ─────────────────────────

/**
 * Compute health insurance overview for VZP/health insurer.
 * PURE FUNCTION.
 *
 * @param {{ entity: Object, entries: Object[], rates: Object, year: number,
 *           paidAdvances?: Object[] }} input
 * @returns {Object} Health insurance overview data
 */
export function computeHealthOverview({ entity, entries, rates, year, paidAdvances = [] }) {
  const agg = aggregateEntries(entries);
  const { taxBase } = computeTaxBase(entity, agg, rates);
  const health = computeHealth(taxBase, rates);

  const minMonthly = toCents(rates.health.osvc_min_monthly);

  // What was paid in advances
  const totalPaid = paidAdvances.reduce((s, e) => s + e.amount_cents, 0);
  const monthsPaid = paidAdvances.length;

  // Annual obligation
  const annualObligation = health.healthInsurance;

  // Difference
  const difference = totalPaid - annualObligation;
  const hasOverpayment = difference > 0;
  const hasUnderpayment = difference < 0;

  // Monthly advance for next year
  const monthlyBase = Math.round(health.healthBase / 12);
  const computedMonthly = Math.round(monthlyBase * rates.health.osvc_rate);
  const nextYearMonthly = Math.max(computedMonthly, minMonthly);

  return {
    year,
    entity_id: entity.id,
    type: 'health',

    // Vyměřovací základ
    tax_base_cents: taxBase,
    assessment_base_cents: health.healthBase,
    rate: rates.health.osvc_rate,

    // Roční povinnost
    annual_obligation_cents: annualObligation,
    monthly_obligation_cents: Math.round(annualObligation / 12),

    // Zaplacené zálohy
    total_paid_cents: totalPaid,
    months_paid: monthsPaid,

    // Doplatek / přeplatek
    difference_cents: difference,
    has_overpayment: hasOverpayment,
    has_underpayment: hasUnderpayment,
    underpayment_cents: hasUnderpayment ? Math.abs(difference) : 0,
    overpayment_cents: hasOverpayment ? difference : 0,

    // Nová záloha na další rok
    next_year_monthly_cents: nextYearMonthly,

    // Limity
    is_minimum: health.isMinimum,
    min_monthly_cents: minMonthly,
    // Health has no cap
  };
}

// ─── Combined Overview ────────────────────────────────────────────────────────

/**
 * Compute both social and health overviews together.
 * Separates paid advances by category.
 *
 * @param {{ entity: Object, entries: Object[], rates: Object, year: number }} input
 * @returns {{ social: Object, health: Object, combined: Object }}
 */
export function computeInsuranceOverviews({ entity, entries, rates, year }) {
  // Separate insurance payment entries by category
  const socialPayments = entries.filter(
    e => e.entry_type === 'insurance_payment' && e.category === 'social',
  );
  const healthPayments = entries.filter(
    e => e.entry_type === 'insurance_payment' && e.category === 'health',
  );

  // Filter to non-payment entries for base calculation
  const nonPaymentEntries = entries.filter(
    e => e.entry_type !== 'insurance_payment' && e.entry_type !== 'tax_payment',
  );

  const social = computeSocialOverview({
    entity, entries: nonPaymentEntries, rates, year, paidAdvances: socialPayments,
  });
  const health = computeHealthOverview({
    entity, entries: nonPaymentEntries, rates, year, paidAdvances: healthPayments,
  });

  // Combined summary
  const totalObligation = social.annual_obligation_cents + health.annual_obligation_cents;
  const totalPaid = social.total_paid_cents + health.total_paid_cents;
  const totalDifference = totalPaid - totalObligation;

  return {
    social,
    health,
    combined: {
      year,
      total_obligation_cents: totalObligation,
      total_paid_cents: totalPaid,
      total_difference_cents: totalDifference,
      has_underpayment: totalDifference < 0,
      total_underpayment_cents: totalDifference < 0 ? Math.abs(totalDifference) : 0,
      total_overpayment_cents: totalDifference > 0 ? totalDifference : 0,
      next_year_social_monthly_cents: social.next_year_monthly_cents,
      next_year_health_monthly_cents: health.next_year_monthly_cents,
      next_year_total_monthly_cents: social.next_year_monthly_cents + health.next_year_monthly_cents,
    },
  };
}

// ─── Advance Schedule ─────────────────────────────────────────────────────────

/**
 * Generate a monthly advance payment schedule for a year.
 * PURE FUNCTION.
 *
 * @param {{ socialMonthly: number, healthMonthly: number, year: number }} input
 * @returns {Object[]} 12 months with due dates and amounts
 */
export function generateAdvanceSchedule({ socialMonthly, healthMonthly, year }) {
  const months = [];
  for (let m = 1; m <= 12; m++) {
    // Social: due by 20th of following month
    // Health: due by 8th of following month
    const socialDueMonth = m === 12 ? 1 : m + 1;
    const socialDueYear = m === 12 ? year + 1 : year;
    const healthDueMonth = socialDueMonth;
    const healthDueYear = socialDueYear;

    months.push({
      month: m,
      period: `${year}-${String(m).padStart(2, '0')}`,
      social_cents: socialMonthly,
      social_due: `${socialDueYear}-${String(socialDueMonth).padStart(2, '0')}-20`,
      health_cents: healthMonthly,
      health_due: `${healthDueYear}-${String(healthDueMonth).padStart(2, '0')}-08`,
      total_cents: socialMonthly + healthMonthly,
    });
  }
  return months;
}

// ─── Payment Reconciliation ───────────────────────────────────────────────────

/**
 * Reconcile actual insurance payments against expected schedule.
 * PURE FUNCTION.
 *
 * @param {{ schedule: Object[], payments: Object[] }} input
 *   schedule = from generateAdvanceSchedule
 *   payments = insurance_payment entries sorted by date
 * @returns {{ matched: Object[], unmatched: Object[], missedMonths: number[] }}
 */
export function reconcilePayments({ schedule, payments }) {
  const matched = [];
  const usedPayments = new Set();

  for (const month of schedule) {
    // Try to match a payment to this month (by date proximity)
    let bestMatch = null;
    let bestDistance = Infinity;

    for (let i = 0; i < payments.length; i++) {
      if (usedPayments.has(i)) continue;
      const p = payments[i];
      // Payment should be near the due date (within same month or previous)
      const pDate = new Date(p.entry_date);
      const dueDate = new Date(month.social_due);
      const distance = Math.abs(pDate.getTime() - dueDate.getTime());

      if (distance < bestDistance && distance < 45 * 24 * 60 * 60 * 1000) { // within 45 days
        bestMatch = i;
        bestDistance = distance;
      }
    }

    if (bestMatch !== null) {
      usedPayments.add(bestMatch);
      matched.push({
        month: month.month,
        period: month.period,
        expected_cents: month.total_cents,
        paid_cents: payments[bestMatch].amount_cents,
        difference_cents: payments[bestMatch].amount_cents - month.total_cents,
        payment_date: payments[bestMatch].entry_date,
      });
    } else {
      matched.push({
        month: month.month,
        period: month.period,
        expected_cents: month.total_cents,
        paid_cents: 0,
        difference_cents: -month.total_cents,
        payment_date: null,
      });
    }
  }

  const unmatched = payments
    .filter((_, i) => !usedPayments.has(i))
    .map(p => ({ amount_cents: p.amount_cents, date: p.entry_date, category: p.category }));

  const missedMonths = matched
    .filter(m => m.paid_cents === 0)
    .map(m => m.month);

  return { matched, unmatched, missedMonths };
}

export default {
  computeSocialOverview, computeHealthOverview, computeInsuranceOverviews,
  generateAdvanceSchedule, reconcilePayments,
};
