// C3-Agent v57.3 — Czech VAT Calculator
// ══════════════════════════════════════════════════════════════════════════════
//
// Deterministický výpočet DPH. Zákon č. 235/2004 Sb., o DPH.
//
// Od 2024: dvě sazby (21% základní, 12% snížená) + 0% (export).
// Dříve existovaly dvě snížené sazby (15% a 10%), od 2024 sloučeny do 12%.
//
// ══════════════════════════════════════════════════════════════════════════════

import { getRates, supportedYears } from './tax-rates.js';

/**
 * @typedef {Object} VATInput
 * @property {number} amount — Částka (Kč)
 * @property {'21'|'12'|'0'|21|12|0} [rate='21'] — Sazba DPH
 * @property {'add'|'remove'} [direction='add'] — Přidat DPH k základu / Odečíst DPH z celkové ceny
 * @property {number} [year] — Pro ověření sazeb
 */

/**
 * @typedef {Object} VATResult
 * @property {number} base — Základ daně (bez DPH)
 * @property {number} vat — DPH
 * @property {number} total — Celková cena (s DPH)
 * @property {number} rate_percent — Použitá sazba v %
 * @property {string} direction
 * @property {string[]} assumptions
 */

/**
 * Calculate Czech VAT.
 *
 * @param {VATInput} input
 * @returns {{ success: boolean, result?: VATResult, error?: string }}
 */
export function calculateVAT(input) {
  if (typeof input.amount !== 'number' || input.amount < 0) {
    return { success: false, error: 'amount musí být nezáporné číslo' };
  }

  const requestedYear = input.year || new Date().getFullYear();
  // Fallback to latest supported year if current year not available
  let year = requestedYear;
  let rates;
  try {
    rates = getRates(year);
  } catch {
    const supported = supportedYears();
    year = supported[supported.length - 1]; // Latest available
    rates = getRates(year);
  }

  // Parse rate
  const rateStr = String(input.rate || '21');
  let rateDecimal;

  switch (rateStr) {
    case '21': rateDecimal = rates.vat.standard_rate; break;
    case '12': rateDecimal = rates.vat.reduced_rate; break;
    case '0': rateDecimal = rates.vat.zero_rate; break;
    default:
      return { success: false, error: `Neplatná sazba DPH: ${rateStr}%. Platné sazby: 21%, 12%, 0%` };
  }

  const direction = input.direction || 'add';
  const amount = input.amount;
  const assumptions = [`Sazba DPH: ${rateStr}% (zákon č. 235/2004 Sb.)`, `Rok: ${year}`];

  let base, vat, total;

  if (direction === 'add') {
    // Částka je základ, přidáváme DPH
    base = Math.round(amount * 100) / 100;
    vat = Math.round(base * rateDecimal * 100) / 100;
    total = Math.round((base + vat) * 100) / 100;
    assumptions.push('Vstupní částka = základ daně (bez DPH)');
  } else if (direction === 'remove') {
    // Částka je celková cena s DPH, odečítáme
    total = Math.round(amount * 100) / 100;
    base = Math.round((total / (1 + rateDecimal)) * 100) / 100;
    vat = Math.round((total - base) * 100) / 100;
    assumptions.push('Vstupní částka = cena včetně DPH');
  } else {
    return { success: false, error: `Neplatný direction: ${direction}. Povolené: add, remove` };
  }

  return {
    success: true,
    result: {
      base,
      vat,
      total,
      rate_percent: parseFloat(rateStr),
      rate_decimal: rateDecimal,
      direction,
      year,
      assumptions,
    },
  };
}

/**
 * Quick helper: add VAT to base amount.
 * @param {number} base
 * @param {number} [ratePercent=21]
 * @returns {{ base: number, vat: number, total: number }}
 */
export function addVAT(base, ratePercent = 21) {
  const r = calculateVAT({ amount: base, rate: String(ratePercent), direction: 'add' });
  return r.success ? r.result : null;
}

/**
 * Quick helper: remove VAT from total amount.
 * @param {number} total
 * @param {number} [ratePercent=21]
 * @returns {{ base: number, vat: number, total: number }}
 */
export function removeVAT(total, ratePercent = 21) {
  const r = calculateVAT({ amount: total, rate: String(ratePercent), direction: 'remove' });
  return r.success ? r.result : null;
}

export default { calculateVAT, addVAT, removeVAT };
