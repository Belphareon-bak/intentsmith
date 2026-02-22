// C3-Agent v57.3 — Czech Tax Calculator
// ══════════════════════════════════════════════════════════════════════════════
//
// DETERMINISTICKÝ výpočet. Žádný LLM. Čísla musí sedět.
//
// Výstup vždy obsahuje:
//   assumptions: [] — co bylo předpokládáno (transparentnost)
//   warnings: []    — na co si dát pozor
//   breakdown: {}   — detailní rozpad výpočtu
//
// Podporuje:
//   - OSVČ (§7 ZDP): paušální i skutečné výdaje
//   - s.r.o. (§21 ZDP): DPPO + dividenda + celkové zatížení
//   - Slevy na dani: poplatník, děti, manžel/ka, student, invalidita
//
// ══════════════════════════════════════════════════════════════════════════════

import { getRates } from './tax-rates.js';

// ─────────────────────────────────────────────────────────────────────────────
// Input validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} TaxInput
 * @property {number} gross_income — Hrubý příjem za rok (Kč)
 * @property {number} [expenses] — Skutečné výdaje (Kč). Ignorováno při paušálu.
 * @property {'actual'|'flat_80'|'flat_60'|'flat_40'|'flat_30'} [expense_type='flat_60']
 * @property {'osvc'|'sro'} [entity_type='osvc']
 * @property {number} [year=current] — Zdaňovací období
 * @property {boolean} [main_activity=true] — Hlavní činnost OSVČ
 * @property {number} [children=0] — Počet dětí pro daňové zvýhodnění
 * @property {boolean} [spouse_credit=false] — Sleva na manžela/ku
 * @property {boolean} [student=false] — Student
 * @property {boolean} [disability=false] — Invalidita
 * @property {number} [disability_level=0] — 1, 2, 3, nebo 0
 * @property {boolean} [has_other_income=false] — Má jiné příjmy
 * @property {number} [other_income=0] — Další příjmy (pro informaci)
 */

function validateInput(input) {
  const errors = [];

  if (typeof input.gross_income !== 'number' || input.gross_income < 0) {
    errors.push('gross_income musí být nezáporné číslo');
  }

  if (input.expense_type && !['actual', 'flat_80', 'flat_60', 'flat_40', 'flat_30'].includes(input.expense_type)) {
    errors.push(`expense_type "${input.expense_type}" není platný. Povolené: actual, flat_80, flat_60, flat_40, flat_30`);
  }

  if (input.entity_type && !['osvc', 'sro'].includes(input.entity_type)) {
    errors.push(`entity_type "${input.entity_type}" není platný. Povolené: osvc, sro`);
  }

  if (input.expense_type === 'actual' && (typeof input.expenses !== 'number' || input.expenses < 0)) {
    errors.push('Pro skutečné výdaje musí být expenses nezáporné číslo');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [] };
}

// ─────────────────────────────────────────────────────────────────────────────
// OSVČ Calculator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Výpočet daně z příjmů pro OSVČ (§7 ZDP).
 *
 * @param {TaxInput} input
 * @returns {TaxResult}
 */
function calculateOSVC(input) {
  const year = input.year || new Date().getFullYear();
  const rates = getRates(year);

  const grossIncome = Math.round(input.gross_income);
  const expenseType = input.expense_type || 'flat_60';
  const mainActivity = input.main_activity !== false;
  const children = input.children || 0;

  const assumptions = [];
  const warnings = [];

  // ── 1. Výdaje ──────────────────────────────────────────────────────────

  let expenses;
  let expenseDescription;

  if (expenseType === 'actual') {
    expenses = Math.round(input.expenses || 0);
    expenseDescription = `Skutečné výdaje: ${fmtCZK(expenses)}`;
  } else {
    // Paušální výdaje
    const flatKey = expenseType.replace('flat_', 'rate_');
    const flatConfig = rates.flat_expense[flatKey];
    if (!flatConfig) {
      throw new Error(`Neznámý typ paušálních výdajů: ${expenseType}`);
    }

    const flatAmount = Math.round(grossIncome * flatConfig.rate);
    expenses = Math.min(flatAmount, flatConfig.max);
    expenseDescription = `Paušální výdaje ${flatConfig.rate * 100}%: ${fmtCZK(expenses)} (${flatConfig.description})`;

    if (flatAmount > flatConfig.max) {
      warnings.push(`Paušální výdaje zastropovány na ${fmtCZK(flatConfig.max)} (bez stropu by byly ${fmtCZK(flatAmount)})`);
    }
  }

  // ── 2. Základ daně ─────────────────────────────────────────────────────

  const taxBase = Math.max(0, grossIncome - expenses);

  // ── 3. Daň z příjmů ───────────────────────────────────────────────────

  let incomeTax;
  const higherThreshold = rates.income_tax.higher_rate_threshold;

  if (taxBase <= higherThreshold) {
    incomeTax = Math.round(taxBase * rates.income_tax.base_rate);
  } else {
    const basePart = Math.round(higherThreshold * rates.income_tax.base_rate);
    const higherPart = Math.round((taxBase - higherThreshold) * rates.income_tax.higher_rate);
    incomeTax = basePart + higherPart;
    warnings.push(`Příjem přesahuje ${fmtCZK(higherThreshold)} — část zdaněna zvýšenou sazbou ${rates.income_tax.higher_rate * 100}%`);
  }

  // ── 4. Slevy na dani ───────────────────────────────────────────────────

  let totalCredits = rates.credits.taxpayer; // Základní sleva vždy
  const creditsDetail = [
    { name: 'Sleva na poplatníka (§35ba/1a)', amount: rates.credits.taxpayer },
  ];

  if (input.spouse_credit) {
    totalCredits += rates.credits.spouse;
    creditsDetail.push({ name: 'Sleva na manžela/ku (§35ba/1b)', amount: rates.credits.spouse });
  } else {
    assumptions.push('Neuplatňuje se sleva na manžela/ku');
  }

  if (input.student) {
    totalCredits += rates.credits.student;
    creditsDetail.push({ name: 'Sleva na studenta (§35ba/1f)', amount: rates.credits.student });
  }

  if (input.disability && input.disability_level > 0) {
    let disAmount;
    switch (input.disability_level) {
      case 1: case 2: disAmount = rates.credits.disability_1; break;
      case 3: disAmount = rates.credits.disability_2; break;
      default: disAmount = 0;
    }
    if (disAmount > 0) {
      totalCredits += disAmount;
      creditsDetail.push({ name: `Sleva na invaliditu (stupeň ${input.disability_level})`, amount: disAmount });
    }
  }

  // Aplikace slev
  const taxAfterCredits = Math.max(0, incomeTax - totalCredits);

  // ── 5. Daňové zvýhodnění na děti ───────────────────────────────────────

  let childBenefit = 0;
  const childDetail = [];

  for (let i = 1; i <= children; i++) {
    let amount;
    if (i === 1) amount = rates.credits.child_1;
    else if (i === 2) amount = rates.credits.child_2;
    else amount = rates.credits.child_3;

    childBenefit += amount;
    childDetail.push({ child: i, amount });
  }

  // Zvýhodnění může jít do bonusu (záporná daň)
  const taxAfterChildren = taxAfterCredits - childBenefit;
  const finalIncomeTax = Math.max(0, taxAfterChildren);
  const taxBonus = taxAfterChildren < 0 ? Math.abs(taxAfterChildren) : 0;

  if (children === 0) {
    assumptions.push('Neuplatňuje se daňové zvýhodnění na děti');
  }

  // ── 6. Sociální pojištění ──────────────────────────────────────────────

  const socialBase = Math.round(taxBase * rates.social.osvc_base_multiplier);
  const minSocialAnnual = (mainActivity ? rates.social.osvc_min_monthly : rates.social.osvc_min_monthly_side) * 12;
  const maxSocialBase = rates.social.max_base;

  const effectiveSocialBase = Math.min(Math.max(socialBase, mainActivity ? minSocialAnnual / rates.social.osvc_rate : 0), maxSocialBase);
  let socialInsurance = Math.round(effectiveSocialBase * rates.social.osvc_rate);

  // Minimum check
  if (socialInsurance < minSocialAnnual) {
    socialInsurance = minSocialAnnual;
  }

  // Maximum check
  const maxSocial = Math.round(maxSocialBase * rates.social.osvc_rate);
  if (socialInsurance > maxSocial) {
    socialInsurance = maxSocial;
    warnings.push(`Sociální pojištění zastropováno na ${fmtCZK(maxSocial)} (maximální vyměřovací základ)`);
  }

  // ── 7. Zdravotní pojištění ─────────────────────────────────────────────

  const healthBase = Math.round(taxBase * rates.health.osvc_base_multiplier);
  const minHealthAnnual = rates.health.osvc_min_monthly * 12;

  let healthInsurance = Math.round(Math.max(healthBase, minHealthAnnual / rates.health.osvc_rate) * rates.health.osvc_rate);

  if (healthInsurance < minHealthAnnual) {
    healthInsurance = minHealthAnnual;
  }
  // ZP nemá strop

  // ── 8. Celkový výsledek ────────────────────────────────────────────────

  const totalTaxBurden = finalIncomeTax + socialInsurance + healthInsurance;
  const netIncome = grossIncome - totalTaxBurden + taxBonus;
  const effectiveRate = grossIncome > 0 ? totalTaxBurden / grossIncome : 0;

  // Default assumptions
  if (!input.has_other_income) {
    assumptions.push('Žádné další příjmy (§6, §8, §9, §10 ZDP)');
  }
  assumptions.push(`${mainActivity ? 'Hlavní' : 'Vedlejší'} činnost OSVČ`);
  assumptions.push(`Zdaňovací období: ${year}`);
  assumptions.push('Výpočet nezahrnuje zálohy na daň z předchozích období');

  return {
    entity_type: 'osvc',
    year,
    gross_income: grossIncome,
    expenses,
    expense_type: expenseType,
    tax_base: taxBase,

    income_tax_before_credits: incomeTax,
    credits: totalCredits,
    credits_detail: creditsDetail,
    child_benefit: childBenefit,
    child_detail: childDetail,
    tax_bonus: taxBonus,
    income_tax: finalIncomeTax,

    social_insurance: socialInsurance,
    social_base: socialBase,
    social_monthly: Math.round(socialInsurance / 12),

    health_insurance: healthInsurance,
    health_base: healthBase,
    health_monthly: Math.round(healthInsurance / 12),

    total_tax_burden: totalTaxBurden,
    net_income: netIncome,
    effective_rate: Math.round(effectiveRate * 10000) / 100, // %s 2 des. místy

    assumptions,
    warnings,

    breakdown: {
      expense_description: expenseDescription,
      income_tax_computation: taxBase <= higherThreshold
        ? `${fmtCZK(taxBase)} × ${rates.income_tax.base_rate * 100}% = ${fmtCZK(incomeTax)}`
        : `${fmtCZK(higherThreshold)} × ${rates.income_tax.base_rate * 100}% + ${fmtCZK(taxBase - higherThreshold)} × ${rates.income_tax.higher_rate * 100}% = ${fmtCZK(incomeTax)}`,
      social_computation: `${fmtCZK(socialBase)} (50% ZD) × ${rates.social.osvc_rate * 100}% = ${fmtCZK(socialInsurance)}/rok`,
      health_computation: `${fmtCZK(healthBase)} (50% ZD) × ${rates.health.osvc_rate * 100}% = ${fmtCZK(healthInsurance)}/rok`,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// s.r.o. Calculator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Výpočet daně pro s.r.o. (§21 ZDP) — DPPO + dividenda.
 *
 * @param {TaxInput} input — gross_income = zisk (příjmy - výdaje) s.r.o.
 * @returns {TaxResult}
 */
function calculateSRO(input) {
  const year = input.year || new Date().getFullYear();
  const rates = getRates(year);

  const profit = Math.round(input.gross_income); // U s.r.o. je vstup = zisk
  const expenses = Math.round(input.expenses || 0);
  const taxableProfit = expenses > 0 ? Math.max(0, profit - expenses) : profit;

  const assumptions = [];
  const warnings = [];

  // ── 1. Daň z příjmů PO ────────────────────────────────────────────────

  const corporateTax = Math.round(taxableProfit * rates.corporate.rate);

  // ── 2. Zisk po dani ───────────────────────────────────────────────────

  const profitAfterTax = taxableProfit - corporateTax;

  // ── 3. Dividenda ──────────────────────────────────────────────────────

  // Předpokládáme vyplacení celého zisku jako dividendy
  const dividendGross = profitAfterTax;
  const dividendTax = Math.round(dividendGross * rates.corporate.dividend_rate);
  const dividendNet = dividendGross - dividendTax;

  assumptions.push('Celý zisk po dani vyplacen jako dividenda');
  assumptions.push('Jednatel = společník (100% podíl)');
  assumptions.push(`Zdaňovací období: ${year}`);
  assumptions.push('Výpočet nezahrnuje odměnu jednatele (může být daňově výhodnější)');
  assumptions.push('Nezahrnuje sociální a zdravotní pojištění jednatele');

  // ── 4. Celkové daňové zatížení ─────────────────────────────────────────

  const totalTax = corporateTax + dividendTax;
  const effectiveRate = taxableProfit > 0 ? totalTax / taxableProfit : 0;

  // Kombinovaná efektivní sazba: 1 - (1 - 0.21) × (1 - 0.15) = 32.85%
  warnings.push(`Kombinovaná efektivní sazba DPPO + dividenda: ${(effectiveRate * 100).toFixed(1)}% (teoreticky ${((1 - (1 - rates.corporate.rate) * (1 - rates.corporate.dividend_rate)) * 100).toFixed(2)}%)`);

  if (!input.expenses) {
    assumptions.push('Vstup je zisk (příjmy mínus výdaje). Pokud zadáváš příjmy, zadej i výdaje.');
  }

  return {
    entity_type: 'sro',
    year,
    gross_income: profit,
    expenses,
    taxable_profit: taxableProfit,

    corporate_tax: corporateTax,
    corporate_rate: rates.corporate.rate,
    profit_after_tax: profitAfterTax,

    dividend_gross: dividendGross,
    dividend_tax: dividendTax,
    dividend_rate: rates.corporate.dividend_rate,
    dividend_net: dividendNet,

    total_tax: totalTax,
    net_income: dividendNet,
    effective_rate: Math.round(effectiveRate * 10000) / 100,

    assumptions,
    warnings,

    breakdown: {
      corporate_tax_computation: `${fmtCZK(taxableProfit)} × ${rates.corporate.rate * 100}% = ${fmtCZK(corporateTax)}`,
      dividend_computation: `${fmtCZK(dividendGross)} × ${rates.corporate.dividend_rate * 100}% = ${fmtCZK(dividendTax)}`,
      combined_rate: `1 - (1 - ${rates.corporate.rate}) × (1 - ${rates.corporate.dividend_rate}) = ${((1 - (1 - rates.corporate.rate) * (1 - rates.corporate.dividend_rate)) * 100).toFixed(2)}%`,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate Czech tax for OSVČ or s.r.o.
 *
 * @param {TaxInput} input
 * @returns {{ success: boolean, result?: TaxResult, error?: string }}
 */
export function calculateTax(input) {
  // Validate
  const validation = validateInput(input);
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; ') };
  }

  try {
    const entityType = input.entity_type || 'osvc';

    if (entityType === 'osvc') {
      return { success: true, result: calculateOSVC(input) };
    }

    if (entityType === 'sro') {
      return { success: true, result: calculateSRO(input) };
    }

    return { success: false, error: `Neznámý entity_type: ${entityType}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Compare OSVČ vs. s.r.o. for the same income.
 *
 * @param {number} grossIncome
 * @param {Object} opts — additional options (year, expense_type, children, etc.)
 * @returns {{ osvc: TaxResult, sro: TaxResult, comparison: Object }}
 */
export function compareTaxEntities(grossIncome, opts = {}) {
  const osvcResult = calculateTax({ ...opts, gross_income: grossIncome, entity_type: 'osvc' });
  const sroResult = calculateTax({ ...opts, gross_income: grossIncome, entity_type: 'sro' });

  if (!osvcResult.success || !sroResult.success) {
    return {
      success: false,
      error: osvcResult.error || sroResult.error,
    };
  }

  const osvc = osvcResult.result;
  const sro = sroResult.result;

  return {
    success: true,
    osvc,
    sro,
    comparison: {
      osvc_net: osvc.net_income,
      sro_net: sro.net_income,
      difference: osvc.net_income - sro.net_income,
      winner: osvc.net_income > sro.net_income ? 'osvc' : 'sro',
      osvc_effective_rate: osvc.effective_rate,
      sro_effective_rate: sro.effective_rate,
      note: 'Srovnání je zjednodušené. s.r.o. nezahrnuje odměnu jednatele a sociální/zdravotní pojištění.',
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format number as Czech currency string.
 */
function fmtCZK(amount) {
  return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 }).format(amount);
}

export { fmtCZK };

export default { calculateTax, compareTaxEntities, fmtCZK };
