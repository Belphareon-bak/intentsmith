// Phase 6 — Report Engine (Pure Computation)
// ══════════════════════════════════════════════════════════════════════════════
//
// PURE FUNCTIONS ONLY. No DB. No side effects.
//
// Generates structured report data from Phase 1–4 engines:
//   - DPFO report (daňové přiznání)
//   - ČSSZ overview (přehled pro sociální správu)
//   - VZP overview (přehled pro zdravotní pojišťovnu)
//   - Cash book (peněžní deník)
//   - Income/expense summary
//   - Advance payment report (zálohy: zaplaceno vs. dluh)
//   - Markdown export
//
// All amounts in haléře (cents).
//
// ══════════════════════════════════════════════════════════════════════════════

import { toCZK, aggregateEntries } from './ledger-engine.js';
import { generateTaxReturnData } from './ledger-annual.js';
import { computeSocialOverview, computeHealthOverview, generateAdvanceSchedule, reconcilePayments } from './ledger-insurance.js';

// ─── DPFO Report ────────────────────────────────────────────────────────────

/**
 * Generate complete DPFO tax return report.
 * Wraps generateTaxReturnData with report metadata.
 * PURE FUNCTION.
 *
 * @param {{ entity: Object, entries: Object[], rates: Object, year: number,
 *           activeLosses?: Object[] }} input
 * @returns {Object} Report with form data + metadata
 */
export function generateDPFOReport({ entity, entries, rates, year, activeLosses = [] }) {
  const taxReturn = generateTaxReturnData({ entity, entries, rates, year, activeLosses });

  return {
    report_type: 'dpfo',
    title: `Daňové přiznání k DPFO za rok ${year}`,
    form_code: '25 5405/P1',
    year,
    entity_name: entity.name,
    entity_id: entity.id,
    generated_at: new Date().toISOString(),
    data: taxReturn,
  };
}

// ─── ČSSZ Report ────────────────────────────────────────────────────────────

/**
 * Generate ČSSZ (social insurance) overview report.
 * PURE FUNCTION.
 *
 * @param {{ entity: Object, entries: Object[], rates: Object, year: number,
 *           paidAdvances?: Object[] }} input
 * @returns {Object} Report
 */
export function generateCSSZReport({ entity, entries, rates, year, paidAdvances = [] }) {
  const overview = computeSocialOverview({ entity, entries, rates, year, paidAdvances });

  return {
    report_type: 'cssz_overview',
    title: `Přehled OSVČ pro ČSSZ za rok ${year}`,
    form_code: '89 542 8',
    year,
    entity_name: entity.name,
    entity_id: entity.id,
    generated_at: new Date().toISOString(),
    data: overview,
  };
}

// ─── VZP Report ─────────────────────────────────────────────────────────────

/**
 * Generate VZP (health insurance) overview report.
 * PURE FUNCTION.
 *
 * @param {{ entity: Object, entries: Object[], rates: Object, year: number,
 *           paidAdvances?: Object[] }} input
 * @returns {Object} Report
 */
export function generateVZPReport({ entity, entries, rates, year, paidAdvances = [] }) {
  const overview = computeHealthOverview({ entity, entries, rates, year, paidAdvances });

  return {
    report_type: 'vzp_overview',
    title: `Přehled OSVČ pro VZP za rok ${year}`,
    year,
    entity_name: entity.name,
    entity_id: entity.id,
    generated_at: new Date().toISOString(),
    data: overview,
  };
}

// ─── Cash Book (Peněžní deník) ──────────────────────────────────────────────

/**
 * Generate a cash book — chronological listing of all entries with running balance.
 * PURE FUNCTION.
 *
 * @param {{ entries: Object[], year: number }} input
 * @returns {Object} Cash book with rows and totals
 */
export function generateCashBook({ entries, year }) {
  // Sort by date, then by id
  const sorted = [...entries].sort((a, b) => {
    const d = (a.entry_date || '').localeCompare(b.entry_date || '');
    if (d !== 0) return d;
    return (a.id || 0) - (b.id || 0);
  });

  let runningIncome = 0;
  let runningExpense = 0;
  const rows = [];

  for (const e of sorted) {
    if (e.entry_type === 'income') runningIncome += e.amount_cents;
    if (e.entry_type === 'expense') runningExpense += e.amount_cents;

    rows.push({
      date: e.entry_date,
      document_ref: e.document_ref || e.document_number || null,
      description: e.description || '',
      entry_type: e.entry_type,
      category: e.category || 'uncategorized',
      income_cents: e.entry_type === 'income' ? e.amount_cents : 0,
      expense_cents: e.entry_type === 'expense' ? e.amount_cents : 0,
      tax_payment_cents: e.entry_type === 'tax_payment' ? e.amount_cents : 0,
      insurance_payment_cents: e.entry_type === 'insurance_payment' ? e.amount_cents : 0,
      vat_cents: e.vat_amount_cents || 0,
      running_income_cents: runningIncome,
      running_expense_cents: runningExpense,
      running_balance_cents: runningIncome - runningExpense,
    });
  }

  const agg = aggregateEntries(sorted);

  return {
    report_type: 'cash_book',
    title: `Peněžní deník za rok ${year}`,
    year,
    rows,
    totals: {
      income_cents: agg.totalIncome,
      expense_cents: agg.totalExpense,
      tax_payments_cents: agg.totalTaxPayments,
      insurance_payments_cents: agg.totalInsurancePayments,
      balance_cents: agg.totalIncome - agg.totalExpense,
      entry_count: sorted.length,
    },
  };
}

// ─── Income / Expense Summary ───────────────────────────────────────────────

/**
 * Generate income and expense summary grouped by category.
 * PURE FUNCTION.
 *
 * @param {{ entity: Object, entries: Object[], rates: Object, year: number }} input
 * @returns {Object} Summary
 */
export function generateIncomeSummary({ entity, entries, rates, year }) {
  const agg = aggregateEntries(entries);

  // Build category breakdown
  const categories = [];
  for (const [cat, data] of Object.entries(agg.byCategory)) {
    categories.push({
      category: cat,
      income_cents: data.income,
      expense_cents: data.expense,
      balance_cents: data.income - data.expense,
    });
  }
  categories.sort((a, b) => b.balance_cents - a.balance_cents);

  // Expense method
  let expenseMethod = entity.tax_regime;
  if (entity.tax_regime === 'flat_expense' && entity.flat_expense_category) {
    const flatConfig = rates.flat_expense[entity.flat_expense_category];
    if (flatConfig) expenseMethod = `paušál ${flatConfig.rate * 100}%`;
  }

  return {
    report_type: 'income_summary',
    title: `Přehled příjmů a výdajů za rok ${year}`,
    year,
    entity_name: entity.name,
    expense_method: expenseMethod,
    totals: {
      income_cents: agg.totalIncome,
      expense_cents: agg.totalExpense,
      deductible_expense_cents: agg.deductibleExpenses,
      tax_payments_cents: agg.totalTaxPayments,
      insurance_payments_cents: agg.totalInsurancePayments,
      balance_cents: agg.totalIncome - agg.totalExpense,
    },
    categories,
    entry_count: entries.length,
  };
}

// ─── Advance Payment Report ─────────────────────────────────────────────────

/**
 * Generate a report comparing scheduled vs actual insurance advance payments.
 * PURE FUNCTION.
 *
 * @param {{ entity: Object, entries: Object[], rates: Object, year: number }} input
 * @returns {Object} Advance report with reconciliation
 */
export function generateAdvanceReport({ entity, entries, rates, year }) {
  // Separate insurance payments
  const socialPayments = entries.filter(
    e => e.entry_type === 'insurance_payment' && e.category === 'social',
  );
  const healthPayments = entries.filter(
    e => e.entry_type === 'insurance_payment' && e.category === 'health',
  );
  const nonPaymentEntries = entries.filter(
    e => e.entry_type !== 'insurance_payment' && e.entry_type !== 'tax_payment',
  );

  // Get overviews for monthly amounts
  const socialOverview = computeSocialOverview({
    entity, entries: nonPaymentEntries, rates, year, paidAdvances: socialPayments,
  });
  const healthOverview = computeHealthOverview({
    entity, entries: nonPaymentEntries, rates, year, paidAdvances: healthPayments,
  });

  // Generate schedule
  const schedule = generateAdvanceSchedule({
    socialMonthly: socialOverview.monthly_obligation_cents,
    healthMonthly: healthOverview.monthly_obligation_cents,
    year,
  });

  // Reconcile
  const allPayments = [...socialPayments, ...healthPayments].sort(
    (a, b) => (a.entry_date || '').localeCompare(b.entry_date || ''),
  );
  const reconciliation = reconcilePayments({ schedule, payments: allPayments });

  return {
    report_type: 'advance_report',
    title: `Přehled záloh za rok ${year}`,
    year,
    entity_name: entity.name,
    social: {
      monthly_cents: socialOverview.monthly_obligation_cents,
      annual_cents: socialOverview.annual_obligation_cents,
      paid_cents: socialOverview.total_paid_cents,
      difference_cents: socialOverview.difference_cents,
    },
    health: {
      monthly_cents: healthOverview.monthly_obligation_cents,
      annual_cents: healthOverview.annual_obligation_cents,
      paid_cents: healthOverview.total_paid_cents,
      difference_cents: healthOverview.difference_cents,
    },
    schedule,
    reconciliation,
  };
}

// ─── Markdown Export ────────────────────────────────────────────────────────

/**
 * Format a report object as Markdown text.
 * PURE FUNCTION.
 *
 * @param {Object} report - any report from above functions
 * @returns {string} Markdown text
 */
export function formatReportAsMarkdown(report) {
  const lines = [];
  lines.push(`# ${report.title || report.report_type}`);
  lines.push('');

  if (report.entity_name) lines.push(`**Subjekt:** ${report.entity_name}`);
  if (report.year) lines.push(`**Rok:** ${report.year}`);
  if (report.form_code) lines.push(`**Formulář:** ${report.form_code}`);
  lines.push('');

  // Report-specific sections
  if (report.report_type === 'dpfo') {
    const d = report.data;
    lines.push('## Příjmy a výdaje');
    lines.push(`| Položka | Částka (Kč) |`);
    lines.push(`|---------|------------|`);
    lines.push(`| Příjmy celkem | ${_fmtCZK(d.p1_prijmy_celkem)} |`);
    lines.push(`| Výdaje celkem | ${_fmtCZK(d.p1_vydaje_celkem)} |`);
    lines.push(`| Základ daně | ${_fmtCZK(d.p1_rozdil)} |`);
    lines.push('');
    lines.push('## Daň');
    lines.push(`| Položka | Částka (Kč) |`);
    lines.push(`|---------|------------|`);
    lines.push(`| Daň před slevami | ${_fmtCZK(d.dan_pred_slevami)} |`);
    lines.push(`| Slevy | ${_fmtCZK(d.slevy_celkem)} |`);
    lines.push(`| Daň po slevách | ${_fmtCZK(d.dan_po_slevach)} |`);
    lines.push(`| Daňový bonus | ${_fmtCZK(d.danovy_bonus)} |`);
    lines.push('');
    lines.push('## Pojistné');
    lines.push(`| Položka | Částka (Kč) |`);
    lines.push(`|---------|------------|`);
    lines.push(`| Sociální pojistné | ${_fmtCZK(d.socialni_pojistne)} |`);
    lines.push(`| Zdravotní pojistné | ${_fmtCZK(d.zdravotni_pojistne)} |`);
    lines.push('');
    lines.push(`**Celkové zatížení:** ${_fmtCZK(d.celkove_zatizeni)} Kč`);
    lines.push(`**Čistý příjem:** ${_fmtCZK(d.cisty_prijem)} Kč`);
    lines.push(`**Efektivní sazba:** ${d.efektivni_sazba}%`);
  }

  if (report.report_type === 'cash_book') {
    lines.push('## Záznamy');
    lines.push('| Datum | Popis | Příjem | Výdaj | Saldo |');
    lines.push('|-------|-------|--------|-------|-------|');
    for (const r of report.rows) {
      lines.push(`| ${r.date} | ${r.description || '-'} | ${r.income_cents ? _fmtCZK(toCZK(r.income_cents)) : ''} | ${r.expense_cents ? _fmtCZK(toCZK(r.expense_cents)) : ''} | ${_fmtCZK(toCZK(r.running_balance_cents))} |`);
    }
    lines.push('');
    lines.push(`**Celkem příjmy:** ${_fmtCZK(toCZK(report.totals.income_cents))} Kč`);
    lines.push(`**Celkem výdaje:** ${_fmtCZK(toCZK(report.totals.expense_cents))} Kč`);
    lines.push(`**Saldo:** ${_fmtCZK(toCZK(report.totals.balance_cents))} Kč`);
  }

  if (report.report_type === 'income_summary') {
    lines.push('## Souhrn podle kategorií');
    lines.push('| Kategorie | Příjmy (Kč) | Výdaje (Kč) | Saldo (Kč) |');
    lines.push('|-----------|-------------|-------------|------------|');
    for (const c of report.categories) {
      lines.push(`| ${c.category} | ${_fmtCZK(toCZK(c.income_cents))} | ${_fmtCZK(toCZK(c.expense_cents))} | ${_fmtCZK(toCZK(c.balance_cents))} |`);
    }
    lines.push('');
    lines.push(`**Celkem příjmy:** ${_fmtCZK(toCZK(report.totals.income_cents))} Kč`);
    lines.push(`**Celkem výdaje:** ${_fmtCZK(toCZK(report.totals.expense_cents))} Kč`);
  }

  if (report.report_type === 'cssz_overview' || report.report_type === 'vzp_overview') {
    const d = report.data;
    lines.push('## Přehled');
    lines.push(`| Položka | Částka (Kč) |`);
    lines.push(`|---------|------------|`);
    lines.push(`| Vyměřovací základ | ${_fmtCZK(toCZK(d.assessment_base_cents))} |`);
    lines.push(`| Roční povinnost | ${_fmtCZK(toCZK(d.annual_obligation_cents))} |`);
    lines.push(`| Zaplacené zálohy | ${_fmtCZK(toCZK(d.total_paid_cents))} |`);
    lines.push(`| Doplatek/přeplatek | ${_fmtCZK(toCZK(d.difference_cents))} |`);
    lines.push(`| Nová měsíční záloha | ${_fmtCZK(toCZK(d.next_year_monthly_cents))} |`);
  }

  lines.push('');
  lines.push('---');
  lines.push(`*Generováno: ${report.generated_at || new Date().toISOString()}*`);

  return lines.join('\n');
}

function _fmtCZK(amount) {
  return new Intl.NumberFormat('cs-CZ').format(Math.round(amount));
}

export default {
  generateDPFOReport, generateCSSZReport, generateVZPReport,
  generateCashBook, generateIncomeSummary, generateAdvanceReport,
  formatReportAsMarkdown,
};
