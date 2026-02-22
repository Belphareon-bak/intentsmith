// C3-Agent v57.3 — Czech Salary Calculator
// ══════════════════════════════════════════════════════════════════════════════
//
// DETERMINISTICKÝ výpočet. Žádný LLM.
//
// Výpočet čisté mzdy zaměstnance + nákladů zaměstnavatele.
//
// Zdroje:
//   §6 ZDP (zákon č. 586/1992 Sb.) — příjmy ze závislé činnosti
//   §16 ZDP — sazba daně z příjmů FO
//   §35ba ZDP — slevy na dani
//   §35c ZDP — daňové zvýhodnění na děti
//   Zákon č. 589/1992 Sb. — sociální pojištění
//   Zákon č. 592/1992 Sb. — zdravotní pojištění
//
// ══════════════════════════════════════════════════════════════════════════════

import { getRates, getStalenessWarnings } from './tax-rates.js';

// ─────────────────────────────────────────────────────────────────────────────
// Input & Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SalaryInput
 * @property {number} gross_salary — Hrubá měsíční mzda (Kč)
 * @property {number} [year] — Rok pro sazby
 * @property {number} [children=0] — Počet dětí (pro daňové zvýhodnění)
 * @property {boolean} [spouse_credit=false] — Sleva na manžela/ku (1/12 ročně)
 * @property {boolean} [student=false] — Sleva na studenta
 * @property {boolean} [disability=false] — Invalidita
 * @property {number} [disability_level=0] — Stupeň invalidity (1, 2, 3)
 * @property {boolean} [ztpp=false] — Průkaz ZTP/P (dítě)
 * @property {boolean} [signed_declaration=true] — Podepsané prohlášení poplatníka
 * @property {'monthly'|'annual'} [mode='monthly'] — Měsíční nebo roční výpočet
 */

function validateInput(input) {
  const errors = [];

  if (typeof input.gross_salary !== 'number' || input.gross_salary < 0) {
    errors.push('gross_salary musí být nezáporné číslo');
  }

  if (input.mode && !['monthly', 'annual'].includes(input.mode)) {
    errors.push('mode musí být monthly nebo annual');
  }

  return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Calculation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute monthly salary breakdown.
 *
 * @param {SalaryInput} input
 * @returns {{ success: boolean, result?: SalaryResult, error?: string }}
 */
export function calculateSalary(input) {
  const validation = validateInput(input);
  if (!validation.valid) {
    return { success: false, error: validation.errors.join('; ') };
  }

  try {
    const year = input.year || new Date().getFullYear();
    const rates = getRates(year);

    const gross = Math.round(input.gross_salary);
    const mode = input.mode || 'monthly';
    const children = input.children || 0;
    const signedDeclaration = input.signed_declaration !== false;

    const assumptions = [];
    const warnings = [...getStalenessWarnings(year)];

    // Monthly gross (if annual, divide by 12 for per-month calc)
    const monthlyGross = mode === 'annual' ? Math.round(gross / 12) : gross;

    // ── 1. Odvody zaměstnance ──────────────────────────────────────────

    const socialEmployee = Math.round(monthlyGross * rates.social.employee_rate);
    const healthEmployee = Math.round(monthlyGross * rates.health.employee_rate);
    const totalEmployeeDeductions = socialEmployee + healthEmployee;

    // ── 2. Superhrubá mzda (základ daně) ───────────────────────────────
    // Od 2021: základ daně = hrubá mzda (superhrubá zrušena)

    const taxBase = monthlyGross;
    const taxBaseRounded = Math.ceil(taxBase / 100) * 100; // Zaokrouhlení na stokoruny nahoru

    // ── 3. Záloha na daň ───────────────────────────────────────────────

    // Měsíční limit pro zvýšenou sazbu = roční limit / 12
    const monthlyHigherThreshold = Math.round(rates.income_tax.higher_rate_threshold / 12);
    let taxAdvance;

    if (taxBaseRounded <= monthlyHigherThreshold) {
      taxAdvance = Math.round(taxBaseRounded * rates.income_tax.base_rate);
    } else {
      const basePart = Math.round(monthlyHigherThreshold * rates.income_tax.base_rate);
      const higherPart = Math.round((taxBaseRounded - monthlyHigherThreshold) * rates.income_tax.higher_rate);
      taxAdvance = basePart + higherPart;
      warnings.push(`Mzda přesahuje ${fmtCZK(monthlyHigherThreshold)}/měsíc — část zdaněna ${rates.income_tax.higher_rate * 100}%`);
    }

    // ── 4. Slevy na dani ───────────────────────────────────────────────

    let monthlyCredits = 0;
    const creditsDetail = [];

    if (signedDeclaration) {
      // Základní sleva na poplatníka (1/12 ročně)
      const taxpayerMonthly = Math.round(rates.credits.taxpayer / 12);
      monthlyCredits += taxpayerMonthly;
      creditsDetail.push({ name: 'Sleva na poplatníka', amount: taxpayerMonthly });

      if (input.spouse_credit) {
        const spouseMonthly = Math.round(rates.credits.spouse / 12);
        monthlyCredits += spouseMonthly;
        creditsDetail.push({ name: 'Sleva na manžela/ku', amount: spouseMonthly });
      }

      if (input.student) {
        const studentMonthly = Math.round(rates.credits.student / 12);
        monthlyCredits += studentMonthly;
        creditsDetail.push({ name: 'Sleva na studenta', amount: studentMonthly });
      }

      if (input.disability && input.disability_level > 0) {
        let annualAmount;
        switch (input.disability_level) {
          case 1: case 2: annualAmount = rates.credits.disability_1; break;
          case 3: annualAmount = rates.credits.disability_2; break;
          default: annualAmount = 0;
        }
        if (annualAmount > 0) {
          const disMonthly = Math.round(annualAmount / 12);
          monthlyCredits += disMonthly;
          creditsDetail.push({ name: `Sleva na invaliditu (st. ${input.disability_level})`, amount: disMonthly });
        }
      }
    } else {
      assumptions.push('Nepodepsáno prohlášení poplatníka — neuplatňují se slevy na dani');
      warnings.push('Bez podepsaného prohlášení se neuplatní slevy ani zvýhodnění na děti. Záloha na daň je vyšší.');
    }

    const taxAfterCredits = Math.max(0, taxAdvance - monthlyCredits);

    // ── 5. Daňové zvýhodnění na děti ───────────────────────────────────

    let childBenefit = 0;
    const childDetail = [];

    if (signedDeclaration && children > 0) {
      for (let i = 1; i <= children; i++) {
        let annualAmount;
        if (i === 1) annualAmount = rates.credits.child_1;
        else if (i === 2) annualAmount = rates.credits.child_2;
        else annualAmount = rates.credits.child_3;

        // ZTP/P zdvojnásobení
        if (input.ztpp) {
          annualAmount *= rates.credits.child_disabled_multiplier;
        }

        const monthlyAmount = Math.round(annualAmount / 12);
        childBenefit += monthlyAmount;
        childDetail.push({ child: i, monthly: monthlyAmount, annual: annualAmount, ztpp: !!input.ztpp });
      }
    }

    // Zvýhodnění: snižuje daň, může jít do bonusu
    const taxAfterChildren = taxAfterCredits - childBenefit;
    const finalTaxAdvance = Math.max(0, taxAfterChildren);
    const taxBonus = taxAfterChildren < 0 ? Math.abs(taxAfterChildren) : 0;

    // ── 6. Čistá mzda ─────────────────────────────────────────────────

    const netSalary = monthlyGross - totalEmployeeDeductions - finalTaxAdvance + taxBonus;

    // ── 7. Náklady zaměstnavatele ──────────────────────────────────────

    const socialEmployer = Math.round(monthlyGross * rates.social.employer_rate);
    const healthEmployer = Math.round(monthlyGross * rates.health.employer_rate);
    const totalEmployerCost = monthlyGross + socialEmployer + healthEmployer;

    // ── 8. Min wage check ──────────────────────────────────────────────

    if (monthlyGross < rates.salary.min_wage_monthly) {
      warnings.push(`Hrubá mzda ${fmtCZK(monthlyGross)} je pod minimální mzdou ${fmtCZK(rates.salary.min_wage_monthly)} pro rok ${year}`);
    }

    // ── Assumptions ────────────────────────────────────────────────────

    assumptions.push(`Zdaňovací období: ${year}`);
    assumptions.push('Hlavní pracovní poměr (HPP)');
    if (children === 0 && signedDeclaration) {
      assumptions.push('Neuplatňuje se daňové zvýhodnění na děti');
    }
    if (!input.spouse_credit && signedDeclaration) {
      assumptions.push('Neuplatňuje se sleva na manžela/ku');
    }
    assumptions.push('Výpočet nezahrnuje mimořádné odměny, příplatky, náhrady');

    // ── Result ─────────────────────────────────────────────────────────

    const result = {
      year,
      mode,
      gross_salary: monthlyGross,
      signed_declaration: signedDeclaration,

      // Zaměstnanec — odvody
      social_employee: socialEmployee,
      social_employee_rate: rates.social.employee_rate,
      health_employee: healthEmployee,
      health_employee_rate: rates.health.employee_rate,
      total_employee_deductions: totalEmployeeDeductions,

      // Daň
      tax_base: taxBase,
      tax_base_rounded: taxBaseRounded,
      tax_advance_before_credits: taxAdvance,
      credits: monthlyCredits,
      credits_detail: creditsDetail,
      child_benefit: childBenefit,
      child_detail: childDetail,
      tax_bonus: taxBonus,
      tax_advance: finalTaxAdvance,

      // Čistá mzda
      net_salary: netSalary,
      net_to_gross_ratio: monthlyGross > 0 ? Math.round((netSalary / monthlyGross) * 10000) / 100 : 0,

      // Zaměstnavatel
      social_employer: socialEmployer,
      social_employer_rate: rates.social.employer_rate,
      health_employer: healthEmployer,
      health_employer_rate: rates.health.employer_rate,
      total_employer_cost: totalEmployerCost,
      employer_overhead_pct: monthlyGross > 0
        ? Math.round(((totalEmployerCost - monthlyGross) / monthlyGross) * 10000) / 100
        : 0,

      assumptions,
      warnings,

      breakdown: {
        employee: `Hrubá ${fmtCZK(monthlyGross)} − SP ${fmtCZK(socialEmployee)} (${rates.social.employee_rate * 100}%) − ZP ${fmtCZK(healthEmployee)} (${rates.health.employee_rate * 100}%) − záloha daň ${fmtCZK(finalTaxAdvance)} ${taxBonus > 0 ? `+ bonus ${fmtCZK(taxBonus)} ` : ''}= čistá ${fmtCZK(netSalary)}`,
        employer: `Hrubá ${fmtCZK(monthlyGross)} + SP ${fmtCZK(socialEmployer)} (${rates.social.employer_rate * 100}%) + ZP ${fmtCZK(healthEmployer)} (${rates.health.employer_rate * 100}%) = celkový náklad ${fmtCZK(totalEmployerCost)}`,
        tax: `Základ ${fmtCZK(taxBaseRounded)} × ${rates.income_tax.base_rate * 100}% = ${fmtCZK(taxAdvance)} − slevy ${fmtCZK(monthlyCredits)} − zvýhodnění ${fmtCZK(childBenefit)} = záloha ${fmtCZK(finalTaxAdvance)}`,
      },
    };

    // Annual mode: add annual totals
    if (mode === 'annual') {
      result.annual = {
        gross_annual: gross,
        net_annual: netSalary * 12,
        total_employee_deductions_annual: totalEmployeeDeductions * 12,
        tax_advance_annual: finalTaxAdvance * 12,
        tax_bonus_annual: taxBonus * 12,
        total_employer_cost_annual: totalEmployerCost * 12,
      };
      assumptions.push('Roční výpočet: 12 × měsíční (bez 13. platu, odměn apod.)');
    }

    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Compare net salary at different gross levels.
 * Useful for "kolik bych dostal čistého kdyby mi přidali".
 *
 * @param {number[]} grossLevels — Array of gross salaries to compare
 * @param {Object} opts — shared options (year, children, etc.)
 * @returns {{ success: boolean, comparisons?: Array, error?: string }}
 */
export function compareSalaries(grossLevels, opts = {}) {
  if (!Array.isArray(grossLevels) || grossLevels.length < 2) {
    return { success: false, error: 'grossLevels musí být pole s ≥2 hodnotami' };
  }

  const results = [];
  for (const gross of grossLevels) {
    const r = calculateSalary({ ...opts, gross_salary: gross });
    if (!r.success) return { success: false, error: `Chyba pro ${gross} Kč: ${r.error}` };
    results.push(r.result);
  }

  const comparisons = [];
  for (let i = 1; i < results.length; i++) {
    const prev = results[i - 1];
    const curr = results[i];
    const grossDiff = curr.gross_salary - prev.gross_salary;
    const netDiff = curr.net_salary - prev.net_salary;
    const marginalRate = grossDiff > 0 ? Math.round(((grossDiff - netDiff) / grossDiff) * 10000) / 100 : 0;

    comparisons.push({
      from_gross: prev.gross_salary,
      to_gross: curr.gross_salary,
      gross_increase: grossDiff,
      net_increase: netDiff,
      marginal_tax_rate: marginalRate,
      note: `Z ${fmtCZK(grossDiff)} přidáno hrubého dostaneš ${fmtCZK(netDiff)} čistého navíc (marginální sazba ${marginalRate}%)`,
    });
  }

  return { success: true, results, comparisons };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtCZK(amount) {
  return new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK', maximumFractionDigits: 0 }).format(amount);
}

export default { calculateSalary, compareSalaries };
