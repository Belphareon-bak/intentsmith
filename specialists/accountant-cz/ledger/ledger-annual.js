// Phase 2 — Annual Tax Engine (Pure Computation)
// ══════════════════════════════════════════════════════════════════════════════
//
// PURE FUNCTIONS ONLY. No DB. No side effects. No logging.
//
// Handles:
//   - Tax return data generation (Příloha 1 / DPFO)
//   - Tax loss carryforward (§34 ZDP — 5 let)
//   - Year-closing summary with all required fields
//
// Orchestration (closeYear) is the only impure operation and lives
// in a separate orchestrator, NOT here.
//
// ══════════════════════════════════════════════════════════════════════════════

import { toCZK, toCents, computeAnnualSummary, aggregateEntries } from './ledger-engine.js';

// ─── Tax Loss Carryforward ────────────────────────────────────────────────────

/**
 * Apply tax losses to reduce the tax base (§34 ZDP).
 * Losses are applied FIFO (oldest first), up to 5 years from origin.
 * PURE FUNCTION — returns new state, doesn't modify DB.
 *
 * @param {number} taxBaseCents - current year tax base in cents
 * @param {Object[]} activeLosses - from repo.getActiveLosses(), sorted by origin_year ASC
 * @param {number} currentYear
 * @returns {{ adjustedTaxBase: number, lossesApplied: Object[], totalApplied: number }}
 */
export function applyTaxLosses(taxBaseCents, activeLosses, currentYear) {
  let remaining = taxBaseCents;
  const lossesApplied = [];

  for (const loss of activeLosses) {
    if (remaining <= 0) break;
    if (loss.expires_year < currentYear) continue;
    if (loss.remaining_cents <= 0) continue;

    const apply = Math.min(remaining, loss.remaining_cents);
    lossesApplied.push({
      origin_year: loss.origin_year,
      applied_cents: apply,
      new_remaining_cents: loss.remaining_cents - apply,
    });
    remaining -= apply;
  }

  const totalApplied = lossesApplied.reduce((s, l) => s + l.applied_cents, 0);

  return {
    adjustedTaxBase: Math.max(0, taxBaseCents - totalApplied),
    lossesApplied,
    totalApplied,
  };
}

/**
 * Detect if a year has a tax loss (negative base before clamping).
 * @param {Object[]} entries
 * @param {Object} entity
 * @param {Object} rates
 * @returns {{ hasLoss: boolean, lossAmountCents: number }}
 */
export function detectTaxLoss(entries, entity, rates) {
  const agg = aggregateEntries(entries);
  const grossIncome = agg.totalIncome;

  let expenses;
  if (entity.tax_regime === 'flat_expense' && entity.flat_expense_category) {
    const flatKey = entity.flat_expense_category;
    const flatConfig = rates.flat_expense[flatKey];
    if (!flatConfig) return { hasLoss: false, lossAmountCents: 0 };
    expenses = Math.min(Math.round(grossIncome * flatConfig.rate), toCents(flatConfig.max));
  } else if (entity.tax_regime === 'actual') {
    expenses = agg.deductibleExpenses;
  } else {
    return { hasLoss: false, lossAmountCents: 0 };
  }

  const rawBase = grossIncome - expenses;
  if (rawBase < 0) {
    return { hasLoss: true, lossAmountCents: Math.abs(rawBase) };
  }
  return { hasLoss: false, lossAmountCents: 0 };
}

// ─── Tax Return Data ──────────────────────────────────────────────────────────

/**
 * Generate structured data for DPFO tax return (Příloha 1 — §7 ZDP).
 * PURE FUNCTION.
 *
 * This produces a flat object with field names matching the official
 * MFin form structure (25 5405/P1). Values in CZK (whole crowns).
 *
 * @param {{ entity: Object, entries: Object[], rates: Object, year: number,
 *           activeLosses?: Object[] }} input
 * @returns {Object} Tax return data
 */
export function generateTaxReturnData({ entity, entries, rates, year, activeLosses = [] }) {
  // 1. Compute annual summary
  const summary = computeAnnualSummary({ entity, entries, rates, year });

  // 2. Apply losses if available
  const lossResult = applyTaxLosses(summary.tax_base_cents, activeLosses, year);

  // 3. Build form fields (CZK, whole crowns)
  const form = {
    // ── Hlavička ──
    rok: year,
    typ_subjektu: entity.entity_type,
    jmeno: entity.name || '',
    dic: '',
    hlavni_cinnost: entity.main_or_secondary === 'main',

    // ── Příloha 1 (§7) ──
    p1_prijmy_celkem: Math.round(toCZK(summary.gross_income_cents)),
    p1_vydaje_celkem: Math.round(toCZK(summary.expenses_cents)),
    p1_typ_vydaju: summary.regime,
    p1_rozdil: Math.round(toCZK(summary.tax_base_cents)),

    // ── Úpravy základu daně ──
    p1_ztrata_minulych_let: Math.round(toCZK(lossResult.totalApplied)),
    p1_zaklad_dane_upraveny: Math.round(toCZK(lossResult.adjustedTaxBase)),
    p1_ztrata_detail: lossResult.lossesApplied.map(l => ({
      rok_vzniku: l.origin_year,
      uplatneno: Math.round(toCZK(l.applied_cents)),
      zbyvajici: Math.round(toCZK(l.new_remaining_cents)),
    })),

    // ── Daň ──
    dan_pred_slevami: Math.round(toCZK(summary.income_tax_raw_cents)),
    slevy_celkem: Math.round(toCZK(summary.credits_cents)),
    slevy_detail: summary.credits_detail.map(c => ({
      nazev: c.name,
      castka: Math.round(toCZK(c.amount)),
    })),
    dan_po_slevach: Math.round(toCZK(summary.income_tax_cents)),
    zvyhodneni_deti: Math.round(toCZK(summary.child_benefit_cents)),
    danovy_bonus: Math.round(toCZK(summary.tax_bonus_cents)),
    dan_celkem: Math.round(toCZK(summary.income_tax_cents)),

    // ── Pojistné ──
    socialni_pojistne: Math.round(toCZK(summary.social_insurance_cents)),
    socialni_vym_zaklad: Math.round(toCZK(summary.social_base_cents)),
    socialni_mesicni: Math.round(toCZK(summary.social_monthly_cents)),
    zdravotni_pojistne: Math.round(toCZK(summary.health_insurance_cents)),
    zdravotni_vym_zaklad: Math.round(toCZK(summary.health_base_cents)),
    zdravotni_mesicni: Math.round(toCZK(summary.health_monthly_cents)),

    // ── Souhrn ──
    celkove_zatizeni: Math.round(toCZK(summary.total_burden_cents)),
    cisty_prijem: Math.round(toCZK(summary.net_income_cents)),
    efektivni_sazba: summary.effective_rate,

    // ── Zaplacené zálohy (z entries) ──
    zaplacene_zalohy_dan: Math.round(toCZK(summary.total_tax_payments_cents)),
    zaplacene_zalohy_pojistne: Math.round(toCZK(summary.total_insurance_payments_cents)),
    doplatek_dan: Math.round(toCZK(summary.income_tax_cents)) - Math.round(toCZK(summary.total_tax_payments_cents)),

    // ── Metadata ──
    warnings: summary.warnings,
    has_loss: summary.tax_base_cents === 0 && summary.gross_income_cents > 0
      && summary.expenses_cents > summary.gross_income_cents,
  };

  return form;
}

// ─── Year Close Summary ───────────────────────────────────────────────────────

/**
 * Compute a complete year-close summary with all data needed to:
 *   1. Lock the period
 *   2. Save to calculation_runs
 *   3. Record any tax loss
 *   4. Generate tax return
 *
 * PURE FUNCTION — orchestrator handles persistence.
 *
 * @param {{ entity: Object, entries: Object[], rates: Object, year: number,
 *           activeLosses?: Object[] }} input
 * @returns {Object}
 */
export function computeYearCloseSummary({ entity, entries, rates, year, activeLosses = [] }) {
  const summary = computeAnnualSummary({ entity, entries, rates, year });
  const taxReturn = generateTaxReturnData({ entity, entries, rates, year, activeLosses });
  const loss = detectTaxLoss(entries, entity, rates);
  const lossApplication = applyTaxLosses(summary.tax_base_cents, activeLosses, year);

  return {
    year,
    entity_id: entity.id,
    summary,
    taxReturn,
    loss,
    lossApplication,
    entryCount: entries.length,
    rates_version: entity.rates_version || `${year}_v1`,
  };
}

export default {
  applyTaxLosses, detectTaxLoss, generateTaxReturnData, computeYearCloseSummary,
};
