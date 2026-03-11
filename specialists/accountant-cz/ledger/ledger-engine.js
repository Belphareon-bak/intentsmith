// Phase 1 — Ledger Engine (Pure Computation)
// ══════════════════════════════════════════════════════════════════════════════
//
// PURE FUNCTIONS ONLY. No DB. No side effects. No logging.
//
// All amounts in haléře (cents). Caller converts to/from CZK.
//
// Handles:
//   - OSVČ: flat_expense / actual expense modes
//   - Income tax: base + higher rate
//   - Social insurance: minimum, maximum, main/secondary activity
//   - Health insurance: minimum, no cap
//   - Tax credits: taxpayer, children, spouse
//   - Edge cases: negative base, zero income, secondary activity
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Convert CZK to haléře.
 * @param {number} czk
 * @returns {number}
 */
export function toCents(czk) {
  return Math.round(czk * 100);
}

/**
 * Convert haléře to CZK.
 * @param {number} cents
 * @returns {number}
 */
export function toCZK(cents) {
  return cents / 100;
}

// ─── Entry Aggregation ────────────────────────────────────────────────────────

/**
 * Aggregate entries into income/expense totals (in cents).
 * Only counts active entries (deleted_at IS NULL assumed by caller).
 *
 * @param {Object[]} entries - financial_entries rows
 * @returns {{ totalIncome: number, totalExpense: number, totalTaxPayments: number,
 *             totalInsurancePayments: number, deductibleExpenses: number,
 *             byCategory: Object }}
 */
export function aggregateEntries(entries) {
  let totalIncome = 0;
  let totalExpense = 0;
  let totalTaxPayments = 0;
  let totalInsurancePayments = 0;
  let deductibleExpenses = 0;
  const byCategory = {};

  for (const e of entries) {
    const amt = e.amount_cents;

    switch (e.entry_type) {
      case 'income':
        totalIncome += amt;
        break;
      case 'expense':
        totalExpense += amt;
        if (e.is_tax_deductible) deductibleExpenses += amt;
        break;
      case 'tax_payment':
        totalTaxPayments += amt;
        break;
      case 'insurance_payment':
        totalInsurancePayments += amt;
        break;
    }

    const cat = e.category || 'uncategorized';
    if (!byCategory[cat]) byCategory[cat] = { income: 0, expense: 0 };
    if (e.entry_type === 'income') byCategory[cat].income += amt;
    if (e.entry_type === 'expense') byCategory[cat].expense += amt;
  }

  return {
    totalIncome, totalExpense, totalTaxPayments, totalInsurancePayments,
    deductibleExpenses, byCategory,
  };
}

// ─── Tax Base Calculation ─────────────────────────────────────────────────────

/**
 * Compute tax base for OSVČ.
 *
 * @param {Object} entity - entity_profiles row
 * @param {{ totalIncome: number, deductibleExpenses: number }} agg - from aggregateEntries
 * @param {Object} rates - year rates from RATES constant
 * @returns {{ taxBase: number, expenses: number, expenseMethod: string, warnings: string[] }}
 */
export function computeTaxBase(entity, agg, rates) {
  const warnings = [];
  const grossIncome = agg.totalIncome; // in cents

  let expenses;
  let expenseMethod;

  if (entity.tax_regime === 'flat_expense' && entity.flat_expense_category) {
    // Paušální výdaje
    const flatKey = entity.flat_expense_category;
    const flatConfig = rates.flat_expense[flatKey];
    if (!flatConfig) {
      throw new Error(`Unknown flat_expense_category: ${flatKey}`);
    }

    const flatAmount = Math.round(grossIncome * flatConfig.rate);
    const maxCents = toCents(flatConfig.max);
    expenses = Math.min(flatAmount, maxCents);
    expenseMethod = `flat_${flatConfig.rate * 100}`;

    if (flatAmount > maxCents) {
      warnings.push(`Paušální výdaje zastropovány na ${toCZK(maxCents)} Kč`);
    }
  } else if (entity.tax_regime === 'flat_tax') {
    // Paušální daň — tax base computation is different
    expenses = 0;
    expenseMethod = 'flat_tax';
    warnings.push('Paušální daň — standardní výpočet daně se nepoužívá');
  } else {
    // Skutečné výdaje
    expenses = agg.deductibleExpenses;
    expenseMethod = 'actual';
  }

  const taxBase = Math.max(0, grossIncome - expenses);

  if (grossIncome - expenses < 0) {
    warnings.push('Záporný základ daně → daň = 0, pojistné = minima');
  }

  return { taxBase, expenses, expenseMethod, warnings };
}

// ─── Income Tax ───────────────────────────────────────────────────────────────

/**
 * Compute income tax (OSVČ) from tax base in cents.
 *
 * @param {number} taxBaseCents
 * @param {Object} entity
 * @param {Object} rates
 * @returns {{ incomeTax: number, credits: number, childBenefit: number,
 *             taxBonus: number, finalTax: number, creditsDetail: Object[] }}
 */
export function computeIncomeTax(taxBaseCents, entity, rates) {
  const thresholdCents = toCents(rates.income_tax.higher_rate_threshold);
  let rawTax;

  if (taxBaseCents <= thresholdCents) {
    rawTax = Math.round(taxBaseCents * rates.income_tax.base_rate);
  } else {
    const basePart = Math.round(thresholdCents * rates.income_tax.base_rate);
    const higherPart = Math.round((taxBaseCents - thresholdCents) * rates.income_tax.higher_rate);
    rawTax = basePart + higherPart;
  }

  // Credits
  const creditsDetail = [];
  let totalCredits = toCents(rates.credits.taxpayer);
  creditsDetail.push({ name: 'Sleva na poplatníka', amount: totalCredits });

  if (entity.spouse_credit) {
    const spouseCents = toCents(rates.credits.spouse);
    totalCredits += spouseCents;
    creditsDetail.push({ name: 'Sleva na manžela/ku', amount: spouseCents });
  }

  const taxAfterCredits = Math.max(0, rawTax - totalCredits);

  // Child benefit
  let childBenefit = 0;
  const children = entity.children || 0;
  for (let i = 1; i <= children; i++) {
    let amount;
    if (i === 1) amount = toCents(rates.credits.child_1);
    else if (i === 2) amount = toCents(rates.credits.child_2);
    else amount = toCents(rates.credits.child_3);
    childBenefit += amount;
  }

  const taxAfterChildren = taxAfterCredits - childBenefit;
  const finalTax = Math.max(0, taxAfterChildren);
  const taxBonus = taxAfterChildren < 0 ? Math.abs(taxAfterChildren) : 0;

  return {
    incomeTax: rawTax,
    credits: totalCredits,
    childBenefit,
    taxBonus,
    finalTax,
    creditsDetail,
  };
}

// ─── Social Insurance ─────────────────────────────────────────────────────────

/**
 * Compute social insurance for OSVČ.
 * @param {number} taxBaseCents
 * @param {Object} entity
 * @param {Object} rates
 * @returns {{ socialInsurance: number, socialBase: number, isMinimum: boolean, isCapped: boolean }}
 */
export function computeSocial(taxBaseCents, entity, rates) {
  const isMain = entity.main_or_secondary === 'main';
  const baseMultiplier = rates.social.osvc_base_multiplier;

  // Vyměřovací základ = 50% daňového základu
  const socialBase = Math.round(taxBaseCents * baseMultiplier);

  // Min/max
  const minMonthly = isMain
    ? toCents(rates.social.osvc_min_monthly)
    : toCents(rates.social.osvc_min_monthly_side);
  const minAnnual = minMonthly * 12;

  const maxBaseCents = toCents(rates.social.max_base);

  // For secondary activity: check if income exceeds threshold
  // If not, social is 0 (no obligation)
  if (!isMain) {
    const thresholdCents = toCents(rates.social.osvc_side_threshold);
    if (taxBaseCents < thresholdCents) {
      return { socialInsurance: 0, socialBase: 0, isMinimum: false, isCapped: false };
    }
  }

  // Effective base: clamped between min implied base and max
  const effectiveBase = Math.min(Math.max(socialBase, Math.round(minAnnual / rates.social.osvc_rate)), maxBaseCents);

  let socialInsurance = Math.round(effectiveBase * rates.social.osvc_rate);
  let isMinimum = false;
  let isCapped = false;

  if (socialInsurance < minAnnual) {
    socialInsurance = minAnnual;
    isMinimum = true;
  }

  const maxSocial = Math.round(maxBaseCents * rates.social.osvc_rate);
  if (socialInsurance > maxSocial) {
    socialInsurance = maxSocial;
    isCapped = true;
  }

  return { socialInsurance, socialBase, isMinimum, isCapped };
}

// ─── Health Insurance ─────────────────────────────────────────────────────────

/**
 * Compute health insurance for OSVČ.
 * @param {number} taxBaseCents
 * @param {Object} rates
 * @returns {{ healthInsurance: number, healthBase: number, isMinimum: boolean }}
 */
export function computeHealth(taxBaseCents, rates) {
  const baseMultiplier = rates.health.osvc_base_multiplier;

  const healthBase = Math.round(taxBaseCents * baseMultiplier);
  const minMonthly = toCents(rates.health.osvc_min_monthly);
  const minAnnual = minMonthly * 12;

  let healthInsurance = Math.round(
    Math.max(healthBase, Math.round(minAnnual / rates.health.osvc_rate)) * rates.health.osvc_rate,
  );

  let isMinimum = false;
  if (healthInsurance < minAnnual) {
    healthInsurance = minAnnual;
    isMinimum = true;
  }

  // No cap for health insurance
  return { healthInsurance, healthBase, isMinimum };
}

// ─── Annual Summary ───────────────────────────────────────────────────────────

/**
 * Compute full annual tax summary for an OSVČ entity.
 * PURE FUNCTION. No DB, no side effects.
 *
 * @param {{ entity: Object, entries: Object[], rates: Object, year: number }} input
 * @returns {Object} Full breakdown
 */
export function computeAnnualSummary({ entity, entries, rates, year }) {
  // 1. Aggregate entries
  const agg = aggregateEntries(entries);

  // 2. Tax base
  const { taxBase, expenses, expenseMethod, warnings } = computeTaxBase(entity, agg, rates);

  // 3. Flat tax shortcut
  if (entity.tax_regime === 'flat_tax') {
    const monthlyPayment = toCents(rates.flat_tax.monthly_payment);
    const annualPayment = monthlyPayment * 12;
    return {
      entity_type: entity.entity_type,
      year,
      regime: 'flat_tax',
      gross_income_cents: agg.totalIncome,
      annual_payment_cents: annualPayment,
      monthly_payment_cents: monthlyPayment,
      net_income_cents: agg.totalIncome - annualPayment,
      effective_rate: agg.totalIncome > 0
        ? Math.round((annualPayment / agg.totalIncome) * 10000) / 100
        : 0,
      warnings,
      aggregation: agg,
    };
  }

  // 4. Income tax
  const tax = computeIncomeTax(taxBase, entity, rates);

  // 5. Social insurance
  const social = computeSocial(taxBase, entity, rates);

  // 6. Health insurance
  const health = computeHealth(taxBase, rates);

  // 7. Totals
  const totalBurden = tax.finalTax + social.socialInsurance + health.healthInsurance;
  const netIncome = agg.totalIncome - totalBurden + tax.taxBonus;
  const effectiveRate = agg.totalIncome > 0
    ? Math.round((totalBurden / agg.totalIncome) * 10000) / 100
    : 0;

  return {
    entity_type: entity.entity_type,
    year,
    regime: expenseMethod,

    // Amounts in cents
    gross_income_cents: agg.totalIncome,
    expenses_cents: expenses,
    tax_base_cents: taxBase,

    income_tax_raw_cents: tax.incomeTax,
    credits_cents: tax.credits,
    credits_detail: tax.creditsDetail,
    child_benefit_cents: tax.childBenefit,
    tax_bonus_cents: tax.taxBonus,
    income_tax_cents: tax.finalTax,

    social_insurance_cents: social.socialInsurance,
    social_base_cents: social.socialBase,
    social_monthly_cents: Math.round(social.socialInsurance / 12),
    social_is_minimum: social.isMinimum,
    social_is_capped: social.isCapped,

    health_insurance_cents: health.healthInsurance,
    health_base_cents: health.healthBase,
    health_monthly_cents: Math.round(health.healthInsurance / 12),
    health_is_minimum: health.isMinimum,

    total_burden_cents: totalBurden,
    net_income_cents: netIncome,
    effective_rate: effectiveRate,

    // Bookkeeping
    total_expense_entries_cents: agg.totalExpense,
    total_tax_payments_cents: agg.totalTaxPayments,
    total_insurance_payments_cents: agg.totalInsurancePayments,

    warnings,
    aggregation: agg,
  };
}

export default {
  toCents, toCZK,
  aggregateEntries, computeTaxBase, computeIncomeTax,
  computeSocial, computeHealth, computeAnnualSummary,
};
