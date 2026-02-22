// Phase 4 — VAT Engine (Pure Computation)
// ══════════════════════════════════════════════════════════════════════════════
//
// PURE FUNCTIONS ONLY. No DB. No side effects.
//
// Handles:
//   - VAT return computation (Přiznání k DPH)
//   - Control report sections (Kontrolní hlášení — A.4/A.5/B.2/B.3)
//   - Rolling 12M registration obligation check
//   - VAT entry validation
//
// All amounts in haléře (cents).
// VAT types: 'standard', 'reverse_charge', 'exempt',
//            'eu_acquisition', 'eu_supply', 'export', 'import'
//
// ══════════════════════════════════════════════════════════════════════════════

import { toCents } from './ledger-engine.js';

// Valid vat_type values
const VALID_VAT_TYPES = new Set([
  'standard', 'reverse_charge', 'exempt',
  'eu_acquisition', 'eu_supply', 'export', 'import',
]);

// ─── VAT Return (Přiznání k DPH) ────────────────────────────────────────────

/**
 * Compute VAT return data for a period.
 * PURE FUNCTION.
 *
 * Maps to official DPH form rows:
 *   r1/r2:   Uskutečněná zdanitelná plnění (output, standard/reduced)
 *   r3/r4:   Pořízení z jiného členského státu (EU acquisition)
 *   r5/r6:   Přijaté služby z EU (§24)
 *   r10/r11: Režim přenesení daňové povinnosti — příjemce (reverse charge input)
 *   r25:     Plnění osvobozená s nárokem na odpočet
 *   r26:     Dodání do jiného členského státu (EU supply)
 *   r40/r41: Nárok na odpočet (input, standard/reduced)
 *   r62:     Vlastní daň / Nadměrný odpočet
 *
 * @param {{ entries: Object[], rates: Object, period: { start: string, end: string } }} input
 * @returns {Object} VAT return data with rows and summary
 */
export function computeVATReturn({ entries, rates, period }) {
  const stdRate = rates.vat.standard_rate;
  const redRate = rates.vat.reduced_rate;

  // Filter entries to period by supply_date (DUZP) or entry_date fallback
  const periodEntries = entries.filter(e => {
    const date = e.supply_date || e.entry_date;
    return date >= period.start && date <= period.end;
  });

  // Initialize all rows
  const rows = {
    // Output — uskutečněná zdanitelná plnění
    r1_base: 0, r1_vat: 0,    // standard rate (21%)
    r2_base: 0, r2_vat: 0,    // reduced rate (12%)
    // EU acquisition — pořízení z EU
    r3_base: 0, r3_vat: 0,    // standard rate
    r4_base: 0, r4_vat: 0,    // reduced rate
    // Reverse charge — přenesení daňové povinnosti (příjemce si sám vypočte DPH)
    r10_base: 0, r10_vat: 0,  // standard rate
    r11_base: 0, r11_vat: 0,  // reduced rate
    // Exempt + EU supply
    r25_base: 0,               // osvobozená plnění s nárokem na odpočet
    r26_base: 0,               // dodání do EU
    // Input deductions — nárok na odpočet
    r40_base: 0, r40_vat: 0,  // standard rate
    r41_base: 0, r41_vat: 0,  // reduced rate
  };

  for (const e of periodEntries) {
    // Skip entries without VAT data
    if (e.vat_rate == null) continue;

    const base = e.amount_cents;
    const vat = e.vat_amount_cents || 0;
    const vatType = e.vat_type || 'standard';
    const rate = e.vat_rate;

    if (e.entry_type === 'income') {
      // ── Output side (uskutečněná plnění) ──
      if (vatType === 'eu_supply') {
        rows.r26_base += base;
      } else if (vatType === 'export') {
        rows.r25_base += base;
      } else if (vatType === 'exempt') {
        rows.r25_base += base;
      } else if (vatType === 'reverse_charge') {
        // Supplier in domestic reverse charge — reports base, no VAT charged
        if (rate === stdRate) {
          rows.r10_base += base;
          rows.r10_vat += vat;
        } else if (rate === redRate) {
          rows.r11_base += base;
          rows.r11_vat += vat;
        }
      } else {
        // Standard domestic output
        if (rate === stdRate) {
          rows.r1_base += base;
          rows.r1_vat += vat;
        } else if (rate === redRate) {
          rows.r2_base += base;
          rows.r2_vat += vat;
        }
      }
    } else if (e.entry_type === 'expense') {
      // ── Input side (přijatá plnění / nárok na odpočet) ──
      if (vatType === 'eu_acquisition') {
        // Pořízení z EU: appears on both output (r3/r4) and input (r40/r41) side
        if (rate === stdRate) {
          rows.r3_base += base;
          rows.r3_vat += vat;
          rows.r40_base += base;
          rows.r40_vat += vat;
        } else if (rate === redRate) {
          rows.r4_base += base;
          rows.r4_vat += vat;
          rows.r41_base += base;
          rows.r41_vat += vat;
        }
      } else if (vatType === 'reverse_charge') {
        // Received reverse charge: appears on output (r10/r11) and input (r40/r41)
        if (rate === stdRate) {
          rows.r10_base += base;
          rows.r10_vat += vat;
          rows.r40_base += base;
          rows.r40_vat += vat;
        } else if (rate === redRate) {
          rows.r11_base += base;
          rows.r11_vat += vat;
          rows.r41_base += base;
          rows.r41_vat += vat;
        }
      } else if (vatType === 'exempt' || vatType === 'export') {
        // Exempt inputs — no deduction
      } else {
        // Standard domestic input — deduction
        if (rate === stdRate) {
          rows.r40_base += base;
          rows.r40_vat += vat;
        } else if (rate === redRate) {
          rows.r41_base += base;
          rows.r41_vat += vat;
        }
      }
    }
  }

  // ── Summary ──
  const totalOutputVAT = rows.r1_vat + rows.r2_vat + rows.r3_vat + rows.r4_vat
    + rows.r10_vat + rows.r11_vat;
  const totalInputVAT = rows.r40_vat + rows.r41_vat;
  const ownTaxLiability = totalOutputVAT - totalInputVAT;

  return {
    period,
    rows,
    summary: {
      total_output_vat_cents: totalOutputVAT,
      total_input_vat_cents: totalInputVAT,
      own_tax_liability_cents: ownTaxLiability,
      is_excessive_deduction: ownTaxLiability < 0,
      excessive_deduction_cents: ownTaxLiability < 0 ? Math.abs(ownTaxLiability) : 0,
      tax_to_pay_cents: ownTaxLiability > 0 ? ownTaxLiability : 0,
    },
    entry_count: periodEntries.filter(e => e.vat_rate != null).length,
  };
}

// ─── Control Report (Kontrolní hlášení) ──────────────────────────────────────

/**
 * KH threshold: items above this amount (including VAT) go into detailed sections.
 * Items at or below go into aggregate sections.
 */
const KH_THRESHOLD_CENTS = toCents(10_000);

/**
 * Compute control report (Kontrolní hlášení) sections.
 * PURE FUNCTION.
 *
 * Sections:
 *   A.4 — Uskutečněná plnění > 10,000 Kč (individual, with partner DIČ)
 *   A.5 — Uskutečněná plnění ≤ 10,000 Kč (aggregated by rate)
 *   B.2 — Přijatá plnění > 10,000 Kč (individual, with partner DIČ)
 *   B.3 — Přijatá plnění ≤ 10,000 Kč (aggregated by rate)
 *
 * @param {{ entries: Object[], period: { start: string, end: string } }} input
 * @returns {Object} Control report sections
 */
export function computeControlReport({ entries, period }) {
  const periodEntries = entries.filter(e => {
    const date = e.supply_date || e.entry_date;
    return date >= period.start && date <= period.end;
  });

  const a4 = []; // output > 10K — individual items
  const a5 = { standard: { base: 0, vat: 0 }, reduced: { base: 0, vat: 0 } }; // output ≤ 10K
  const b2 = []; // input > 10K — individual items
  const b3 = { standard: { base: 0, vat: 0 }, reduced: { base: 0, vat: 0 } }; // input ≤ 10K

  for (const e of periodEntries) {
    if (e.vat_rate == null) continue;
    const vatType = e.vat_type || 'standard';
    // Only standard domestic supplies go into KH A.4/A.5/B.2/B.3
    if (vatType !== 'standard') continue;

    const totalAmount = e.amount_cents + (e.vat_amount_cents || 0);
    const rateKey = e.vat_rate > 0.15 ? 'standard' : 'reduced';

    if (e.entry_type === 'income') {
      if (totalAmount > KH_THRESHOLD_CENTS) {
        a4.push({
          partner_dic: e.partner_dic || null,
          partner_name: e.partner_name || null,
          document_number: e.document_number || null,
          supply_date: e.supply_date || e.entry_date,
          base_cents: e.amount_cents,
          vat_cents: e.vat_amount_cents || 0,
          vat_rate: e.vat_rate,
        });
      } else {
        a5[rateKey].base += e.amount_cents;
        a5[rateKey].vat += e.vat_amount_cents || 0;
      }
    } else if (e.entry_type === 'expense') {
      if (totalAmount > KH_THRESHOLD_CENTS) {
        b2.push({
          partner_dic: e.partner_dic || null,
          partner_name: e.partner_name || null,
          document_number: e.document_number || null,
          supply_date: e.supply_date || e.entry_date,
          base_cents: e.amount_cents,
          vat_cents: e.vat_amount_cents || 0,
          vat_rate: e.vat_rate,
        });
      } else {
        b3[rateKey].base += e.amount_cents;
        b3[rateKey].vat += e.vat_amount_cents || 0;
      }
    }
  }

  return {
    period,
    a4, // individual output items > 10K
    a5, // aggregate output items ≤ 10K
    b2, // individual input items > 10K
    b3, // aggregate input items ≤ 10K
    totals: {
      a4_count: a4.length,
      a5_base_cents: a5.standard.base + a5.reduced.base,
      a5_vat_cents: a5.standard.vat + a5.reduced.vat,
      b2_count: b2.length,
      b3_base_cents: b3.standard.base + b3.reduced.base,
      b3_vat_cents: b3.standard.vat + b3.reduced.vat,
    },
  };
}

// ─── Rolling 12M Registration Obligation ─────────────────────────────────────

/**
 * Check if taxable supplies in a rolling 12-month window exceed the
 * VAT registration threshold (currently 2,000,000 CZK).
 * PURE FUNCTION.
 *
 * @param {{ entries: Object[], asOfDate: string, rates: Object }} input
 * @returns {{ obligated: boolean, total_supply_cents: number, threshold_cents: number,
 *             months_checked: number, exceeded_date?: string }}
 */
export function checkRegistrationObligation({ entries, asOfDate, rates }) {
  const thresholdCents = toCents(rates.vat.registration_threshold);

  // Calculate 12 months back from asOfDate
  const endDate = new Date(asOfDate);
  const startDate = new Date(asOfDate);
  startDate.setFullYear(startDate.getFullYear() - 1);
  startDate.setDate(startDate.getDate() + 1); // exclusive start

  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);

  // Sum taxable output supplies in the window
  let totalSupply = 0;
  let exceededDate = null;

  // Sort by date for first-exceeded detection
  const sorted = entries
    .filter(e => {
      if (e.entry_type !== 'income') return false;
      const date = e.supply_date || e.entry_date;
      return date >= startStr && date <= endStr;
    })
    .sort((a, b) => (a.supply_date || a.entry_date).localeCompare(b.supply_date || b.entry_date));

  // Running sum to find when threshold was crossed
  let runningSum = 0;
  for (const e of sorted) {
    runningSum += e.amount_cents;
    if (runningSum > thresholdCents && !exceededDate) {
      exceededDate = e.supply_date || e.entry_date;
    }
  }
  totalSupply = runningSum;

  return {
    obligated: totalSupply > thresholdCents,
    total_supply_cents: totalSupply,
    threshold_cents: thresholdCents,
    window_start: startStr,
    window_end: endStr,
    exceeded_date: exceededDate || null,
  };
}

// ─── VAT Entry Validation ────────────────────────────────────────────────────

/**
 * Validate a VAT entry for completeness and correctness.
 * PURE FUNCTION.
 *
 * @param {Object} entry - financial_entries row
 * @param {Object} rates - year rates
 * @returns {{ valid: boolean, warnings: string[], errors: string[] }}
 */
export function validateVATEntry(entry, rates) {
  const errors = [];
  const warnings = [];

  // 1. vat_type must be valid
  if (entry.vat_type && !VALID_VAT_TYPES.has(entry.vat_type)) {
    errors.push(`Neplatný vat_type: ${entry.vat_type}`);
  }

  // 2. If VAT rate is set, it should match known rates
  if (entry.vat_rate != null) {
    const knownRates = [rates.vat.standard_rate, rates.vat.reduced_rate, rates.vat.zero_rate];
    if (!knownRates.includes(entry.vat_rate)) {
      warnings.push(`Neobvyklá sazba DPH: ${entry.vat_rate * 100}%`);
    }
  }

  // 3. VAT amount consistency
  if (entry.vat_rate != null && entry.vat_amount_cents != null) {
    const expected = Math.round(entry.amount_cents * entry.vat_rate);
    const tolerance = 100; // 1 CZK rounding tolerance
    if (Math.abs(entry.vat_amount_cents - expected) > tolerance) {
      warnings.push(
        `DPH částka ${entry.vat_amount_cents} neodpovídá sazbě ${entry.vat_rate * 100}% `
        + `ze základu ${entry.amount_cents} (očekáváno ~${expected})`,
      );
    }
  }

  // 4. supply_date should be present for VAT entries
  if (entry.vat_rate != null && !entry.supply_date) {
    warnings.push('Chybí datum zdanitelného plnění (supply_date / DUZP)');
  }

  // 5. partner_dic format (CZ + 8-10 digits)
  if (entry.partner_dic) {
    const dicPattern = /^CZ\d{8,10}$/;
    if (!dicPattern.test(entry.partner_dic)) {
      errors.push(`Neplatný formát DIČ: ${entry.partner_dic} (očekáván formát CZxxxxxxxxxx)`);
    }
  }

  // 6. KH items > 10K should have partner_dic
  if (entry.vat_rate != null && (entry.vat_type || 'standard') === 'standard') {
    const total = entry.amount_cents + (entry.vat_amount_cents || 0);
    if (total > KH_THRESHOLD_CENTS && !entry.partner_dic) {
      warnings.push('Položka > 10 000 Kč bez DIČ partnera — nebude v KH A.4/B.2');
    }
  }

  // 7. document_number for KH
  if (entry.vat_rate != null && !entry.document_number) {
    warnings.push('Chybí číslo dokladu (document_number) — vyžadováno pro KH');
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}

// ─── VAT Period Helpers ──────────────────────────────────────────────────────

/**
 * Generate period boundaries for a given month or quarter.
 * PURE FUNCTION.
 *
 * @param {number} year
 * @param {number} periodNumber - month (1-12) or quarter (1-4)
 * @param {'monthly'|'quarterly'} periodType
 * @returns {{ start: string, end: string }}
 */
export function getVATPeriodBounds(year, periodNumber, periodType) {
  if (periodType === 'monthly') {
    const start = `${year}-${String(periodNumber).padStart(2, '0')}-01`;
    // Last day of month
    const lastDay = new Date(year, periodNumber, 0).getDate();
    const end = `${year}-${String(periodNumber).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
  }

  // Quarterly
  const startMonth = (periodNumber - 1) * 3 + 1;
  const endMonth = periodNumber * 3;
  const start = `${year}-${String(startMonth).padStart(2, '0')}-01`;
  const lastDay = new Date(year, endMonth, 0).getDate();
  const end = `${year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

/**
 * Compute a complete VAT period summary (return + control report).
 * PURE FUNCTION.
 *
 * @param {{ entries: Object[], rates: Object, year: number, periodNumber: number,
 *           periodType: 'monthly'|'quarterly' }} input
 * @returns {Object} Combined VAT period data
 */
export function computeVATPeriodSummary({ entries, rates, year, periodNumber, periodType }) {
  const period = getVATPeriodBounds(year, periodNumber, periodType);
  const vatReturn = computeVATReturn({ entries, rates, period });
  const controlReport = computeControlReport({ entries, period });

  return {
    year,
    period_number: periodNumber,
    period_type: periodType,
    period,
    vat_return: vatReturn,
    control_report: controlReport,
  };
}

export default {
  computeVATReturn, computeControlReport,
  checkRegistrationObligation, validateVATEntry,
  getVATPeriodBounds, computeVATPeriodSummary,
};
