// Phase 5 — Compliance Layer (Pure Computation)
// ══════════════════════════════════════════════════════════════════════════════
//
// PURE FUNCTIONS ONLY. No DB. No side effects.
//
// Handles:
//   - Czech OSVČ obligation definitions (deadlines by law)
//   - Deadline proximity detection (OK / WARNING / OVERDUE)
//   - Comprehensive compliance check across all obligations
//   - VAT period deadline generation
//
// All dates as 'YYYY-MM-DD' strings.
//
// ══════════════════════════════════════════════════════════════════════════════

// ─── OSVČ Obligation Definitions ────────────────────────────────────────────

const OSVC_OBLIGATIONS = [
  {
    code: 'dpfo_filing',
    name: 'Daňové přiznání k DPFO',
    recurring: 'annual',
    deadline_month: 4,
    deadline_day: 1,
    law: '§38g ZDP',
    description: 'Podání přiznání k dani z příjmů fyzických osob',
  },
  {
    code: 'dpfo_payment',
    name: 'Úhrada nedoplatku DPFO',
    recurring: 'annual',
    deadline_month: 4,
    deadline_day: 1,
    law: '§38g ZDP',
    description: 'Úhrada nedoplatku na dani z příjmů',
  },
  {
    code: 'cssz_overview',
    name: 'Přehled OSVČ pro ČSSZ',
    recurring: 'annual',
    deadline_month: 5,
    deadline_day: 2,
    law: '§15 z. 589/1992 Sb.',
    description: 'Přehled o příjmech a výdajích OSVČ pro ČSSZ',
  },
  {
    code: 'vzp_overview',
    name: 'Přehled OSVČ pro VZP',
    recurring: 'annual',
    deadline_month: 5,
    deadline_day: 2,
    law: '§24 z. 592/1992 Sb.',
    description: 'Přehled o příjmech a výdajích OSVČ pro zdravotní pojišťovnu',
  },
  {
    code: 'social_advance',
    name: 'Záloha na sociální pojištění',
    recurring: 'monthly',
    deadline_day: 20,
    law: '§14a z. 589/1992 Sb.',
    description: 'Měsíční záloha na sociální pojištění (do 20. následujícího měsíce)',
  },
  {
    code: 'health_advance',
    name: 'Záloha na zdravotní pojištění',
    recurring: 'monthly',
    deadline_day: 8,
    law: '§7 z. 592/1992 Sb.',
    description: 'Měsíční záloha na zdravotní pojištění (do 8. následujícího měsíce)',
  },
  {
    code: 'vat_return',
    name: 'Přiznání k DPH',
    recurring: 'periodic',
    deadline_day: 25,
    law: '§101 z. 235/2004 Sb.',
    description: 'Přiznání k dani z přidané hodnoty',
    condition: 'vat_registered',
  },
  {
    code: 'control_report',
    name: 'Kontrolní hlášení',
    recurring: 'periodic',
    deadline_day: 25,
    law: '§101c z. 235/2004 Sb.',
    description: 'Kontrolní hlášení DPH',
    condition: 'vat_registered',
  },
];

// ─── Get Obligations ────────────────────────────────────────────────────────

/**
 * Get applicable obligations for an entity.
 * Filters by VAT registration status.
 * PURE FUNCTION.
 *
 * @param {Object} entity - entity_profiles row
 * @returns {Object[]} Applicable obligations
 */
export function getObligations(entity) {
  return OSVC_OBLIGATIONS.filter(o => {
    if (o.condition === 'vat_registered' && !entity.vat_registered) return false;
    return true;
  });
}

// ─── Deadline Generation ────────────────────────────────────────────────────

/**
 * Get all annual deadlines for a given year (filing year = year + 1).
 * E.g. year=2024 → deadlines in 2025 (April 1, May 2, etc.)
 * PURE FUNCTION.
 *
 * @param {number} year - fiscal year (the year being reported)
 * @returns {Object[]} Deadlines with date strings
 */
export function getAnnualDeadlines(year) {
  const filingYear = year + 1;
  return OSVC_OBLIGATIONS
    .filter(o => o.recurring === 'annual')
    .map(o => ({
      code: o.code,
      name: o.name,
      deadline: `${filingYear}-${String(o.deadline_month).padStart(2, '0')}-${String(o.deadline_day).padStart(2, '0')}`,
      law: o.law,
      description: o.description,
    }));
}

/**
 * Get insurance advance deadlines for a specific month.
 * Advances for month M are due in month M+1.
 * PURE FUNCTION.
 *
 * @param {number} year
 * @param {number} month - the month being paid for (1-12)
 * @returns {Object[]} Deadlines
 */
export function getMonthlyDeadlines(year, month) {
  const dueMonth = month === 12 ? 1 : month + 1;
  const dueYear = month === 12 ? year + 1 : year;

  return OSVC_OBLIGATIONS
    .filter(o => o.recurring === 'monthly')
    .map(o => ({
      code: o.code,
      name: o.name,
      for_period: `${year}-${String(month).padStart(2, '0')}`,
      deadline: `${dueYear}-${String(dueMonth).padStart(2, '0')}-${String(o.deadline_day).padStart(2, '0')}`,
      law: o.law,
    }));
}

/**
 * Get VAT deadlines for a year based on period type.
 * VAT return + KH are due by 25th of the month after period end.
 * PURE FUNCTION.
 *
 * @param {number} year
 * @param {'monthly'|'quarterly'} periodType
 * @returns {Object[]} VAT deadlines
 */
export function getVATDeadlines(year, periodType) {
  const deadlines = [];
  const periods = periodType === 'monthly' ? 12 : 4;

  for (let p = 1; p <= periods; p++) {
    let endMonth;
    if (periodType === 'monthly') {
      endMonth = p;
    } else {
      endMonth = p * 3;
    }

    const dueMonth = endMonth === 12 ? 1 : endMonth + 1;
    const dueYear = endMonth === 12 ? year + 1 : year;
    const deadline = `${dueYear}-${String(dueMonth).padStart(2, '0')}-25`;

    const periodLabel = periodType === 'monthly'
      ? `${year}-${String(p).padStart(2, '0')}`
      : `${year}-Q${p}`;

    deadlines.push({
      code: 'vat_return',
      name: 'Přiznání k DPH',
      period: periodLabel,
      deadline,
    });
    deadlines.push({
      code: 'control_report',
      name: 'Kontrolní hlášení',
      period: periodLabel,
      deadline,
    });
  }

  return deadlines;
}

// ─── Deadline Status Check ──────────────────────────────────────────────────

/**
 * Check status of a deadline relative to current date.
 * PURE FUNCTION.
 *
 * @param {string} deadlineDate - 'YYYY-MM-DD'
 * @param {string} asOfDate - 'YYYY-MM-DD'
 * @param {number} [warningDays=14] - days before deadline to trigger warning
 * @returns {{ status: 'ok'|'warning'|'overdue', days_remaining: number }}
 */
export function checkDeadlineStatus(deadlineDate, asOfDate, warningDays = 14) {
  const deadline = new Date(deadlineDate + 'T00:00:00');
  const now = new Date(asOfDate + 'T00:00:00');
  const diffMs = deadline.getTime() - now.getTime();
  const daysRemaining = Math.ceil(diffMs / (24 * 60 * 60 * 1000));

  if (daysRemaining < 0) {
    return { status: 'overdue', days_remaining: daysRemaining };
  }
  if (daysRemaining <= warningDays) {
    return { status: 'warning', days_remaining: daysRemaining };
  }
  return { status: 'ok', days_remaining: daysRemaining };
}

// ─── Comprehensive Compliance Check ─────────────────────────────────────────

/**
 * Run a comprehensive compliance check for an entity and year.
 * PURE FUNCTION — evaluates obligations against provided state.
 *
 * @param {{
 *   entity: Object,
 *   year: number,
 *   asOfDate: string,
 *   periodLock: Object|null,
 *   vatPeriods: Object[],
 *   insurancePayments: { social: Object[], health: Object[] },
 *   entries: Object[],
 *   rates: Object,
 * }} input
 * @returns {{ results: Object[], summary: Object }}
 */
export function runComplianceCheck({
  entity, year, asOfDate,
  periodLock = null,
  vatPeriods = [],
  insurancePayments = { social: [], health: [] },
  entries = [],
  rates,
}) {
  const results = [];
  const filingYear = year + 1;

  // ── 1. Tax return filed? (period lock = proxy for filing) ──
  const dpfoDeadline = `${filingYear}-04-01`;
  const dpfoStatus = checkDeadlineStatus(dpfoDeadline, asOfDate);

  if (periodLock) {
    results.push({
      code: 'dpfo_filing',
      status: 'ok',
      detail: 'Období zamčeno — přiznání podáno',
      deadline: dpfoDeadline,
    });
  } else if (dpfoStatus.status === 'overdue') {
    results.push({
      code: 'dpfo_filing',
      status: 'violation',
      detail: `Přiznání nebylo podáno — termín ${dpfoDeadline} uplynul před ${Math.abs(dpfoStatus.days_remaining)} dny`,
      deadline: dpfoDeadline,
    });
  } else {
    results.push({
      code: 'dpfo_filing',
      status: dpfoStatus.status,
      detail: dpfoStatus.status === 'warning'
        ? `Zbývá ${dpfoStatus.days_remaining} dní do termínu podání`
        : `Termín ${dpfoDeadline} — zbývá ${dpfoStatus.days_remaining} dní`,
      deadline: dpfoDeadline,
    });
  }

  // ── 2. ČSSZ overview ──
  const csszDeadline = `${filingYear}-05-02`;
  const csszStatus = checkDeadlineStatus(csszDeadline, asOfDate);
  results.push({
    code: 'cssz_overview',
    status: periodLock ? 'ok' : csszStatus.status === 'overdue' ? 'violation' : csszStatus.status,
    detail: periodLock
      ? 'Přehled ČSSZ — rok uzavřen'
      : `Termín ${csszDeadline} — ${csszStatus.days_remaining} dní`,
    deadline: csszDeadline,
  });

  // ── 3. VZP overview ──
  const vzpDeadline = `${filingYear}-05-02`;
  const vzpStatus = checkDeadlineStatus(vzpDeadline, asOfDate);
  results.push({
    code: 'vzp_overview',
    status: periodLock ? 'ok' : vzpStatus.status === 'overdue' ? 'violation' : vzpStatus.status,
    detail: periodLock
      ? 'Přehled VZP — rok uzavřen'
      : `Termín ${vzpDeadline} — ${vzpStatus.days_remaining} dní`,
    deadline: vzpDeadline,
  });

  // ── 4. Insurance advance payments ──
  const socialPaid = insurancePayments.social.length;
  const healthPaid = insurancePayments.health.length;

  // How many months should have been paid by asOfDate?
  const asOf = new Date(asOfDate);
  let expectedMonths = 0;
  if (asOf.getFullYear() > year) {
    expectedMonths = 12;
  } else if (asOf.getFullYear() === year) {
    // Advance for month M due in M+1, so by end of month N, months 1..N-1 should be paid
    expectedMonths = Math.max(0, asOf.getMonth()); // getMonth() is 0-based
  }

  if (expectedMonths > 0) {
    results.push({
      code: 'social_advance',
      status: socialPaid >= expectedMonths ? 'ok' : socialPaid > 0 ? 'warning' : 'violation',
      detail: `Zaplaceno ${socialPaid}/${expectedMonths} záloh na SP`,
      deadline: null,
    });
    results.push({
      code: 'health_advance',
      status: healthPaid >= expectedMonths ? 'ok' : healthPaid > 0 ? 'warning' : 'violation',
      detail: `Zaplaceno ${healthPaid}/${expectedMonths} záloh na ZP`,
      deadline: null,
    });
  }

  // ── 5. VAT obligations (only if VAT registered) ──
  if (entity.vat_registered) {
    const closedPeriods = vatPeriods.filter(p => p.status === 'submitted' || p.status === 'closed');
    const openPeriods = vatPeriods.filter(p => p.status === 'open');

    // How many periods should exist for the year?
    // We look at asOfDate to determine how many periods have elapsed
    let expectedPeriods = 0;
    if (asOf.getFullYear() > year) {
      expectedPeriods = 12; // all months (simplified — assume monthly)
    } else if (asOf.getFullYear() === year) {
      expectedPeriods = Math.max(0, asOf.getMonth()); // months before current
    }

    if (expectedPeriods > 0) {
      results.push({
        code: 'vat_return',
        status: closedPeriods.length >= expectedPeriods ? 'ok'
          : openPeriods.length > 0 ? 'warning' : 'violation',
        detail: `DPH: ${closedPeriods.length} uzavřeno, ${openPeriods.length} otevřeno (očekáváno ${expectedPeriods})`,
        deadline: null,
      });
      results.push({
        code: 'control_report',
        status: closedPeriods.length >= expectedPeriods ? 'ok'
          : openPeriods.length > 0 ? 'warning' : 'violation',
        detail: `KH: ${closedPeriods.length} podáno z ${expectedPeriods} období`,
        deadline: null,
      });
    }
  }

  // ── Summary ──
  const violations = results.filter(r => r.status === 'violation').length;
  const warnings = results.filter(r => r.status === 'warning').length;
  const ok = results.filter(r => r.status === 'ok').length;

  return {
    results,
    summary: {
      year,
      entity_id: entity.id,
      as_of_date: asOfDate,
      total_checks: results.length,
      ok,
      warnings,
      violations,
      overall_status: violations > 0 ? 'violation' : warnings > 0 ? 'warning' : 'ok',
    },
  };
}

export default {
  getObligations, getAnnualDeadlines, getMonthlyDeadlines,
  getVATDeadlines, checkDeadlineStatus, runComplianceCheck,
};
