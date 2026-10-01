// IntentSmith-Agent v57.3 — Czech VAT Calculator
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
  const rawCents = input?.amount * 100;
  const amountCents = Math.round(rawCents);
  if (typeof input?.amount !== 'number' || !Number.isFinite(input.amount)
      || input.amount < 0 || input.amount > 1_000_000_000
      || !Number.isSafeInteger(amountCents)
      || Math.abs(rawCents - amountCents) > 1e-7) {
    return { success: false, error: 'amount musí být nezáporná částka s nejvýše dvěma desetinnými místy' };
  }

  const explicitYear = input.year !== undefined && input.year !== null;
  const requestedYear = explicitYear ? input.year : new Date().getFullYear();
  // Only an omitted year may fall back. Never silently change a requested tax period.
  let year = requestedYear;
  let rates;
  try {
    rates = getRates(year);
  } catch {
    if (explicitYear) {
      return { success: false, error: `Nepodporovaný rok DPH: ${requestedYear}` };
    }
    const supported = supportedYears();
    year = supported[supported.length - 1]; // Latest available
    rates = getRates(year);
  }

  // Parse rate
  const rateStr = String(input.rate ?? '21');
  let rateDecimal;

  switch (rateStr) {
    case '21': rateDecimal = rates.vat.standard_rate; break;
    case '12': rateDecimal = rates.vat.reduced_rate; break;
    case '0': rateDecimal = rates.vat.zero_rate; break;
    default:
      return { success: false, error: `Neplatná sazba DPH: ${rateStr}%. Platné sazby: 21%, 12%, 0%` };
  }
  const ratePercent = Number(rateStr);
  if (!Number.isFinite(rateDecimal)
      || Math.abs(rateDecimal * 100 - ratePercent) > 1e-8) {
    return { success: false, error: 'Sazba DPH neodpovídá podkladům pro zvolený rok' };
  }

  const direction = input.direction || 'add';
  const assumptions = [`Sazba DPH: ${rateStr}% (zákon č. 235/2004 Sb.)`, `Rok: ${year}`];

  // All rounding is in integer haléře. Half a haléř rounds upward, avoiding
  // binary-float disagreement between the calculator and its presentation.
  const roundRatio = (numerator, denominator) =>
    Math.floor((2 * numerator + denominator) / (2 * denominator));
  let baseCents, vatCents, totalCents;

  if (direction === 'add') {
    // Částka je základ, přidáváme DPH
    baseCents = amountCents;
    vatCents = roundRatio(baseCents * ratePercent, 100);
    totalCents = baseCents + vatCents;
    assumptions.push('Vstupní částka = základ daně (bez DPH)');
  } else if (direction === 'remove') {
    // Částka je celková cena s DPH, odečítáme
    totalCents = amountCents;
    baseCents = roundRatio(totalCents * 100, 100 + ratePercent);
    vatCents = totalCents - baseCents;
    assumptions.push('Vstupní částka = cena včetně DPH');
  } else {
    return { success: false, error: `Neplatný direction: ${direction}. Povolené: add, remove` };
  }
  if (![baseCents, vatCents, totalCents].every(Number.isSafeInteger)) {
    return { success: false, error: 'Výsledek DPH překračuje přesný číselný rozsah' };
  }

  return {
    success: true,
    result: {
      base: baseCents / 100,
      vat: vatCents / 100,
      total: totalCents / 100,
      rate_percent: ratePercent,
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
