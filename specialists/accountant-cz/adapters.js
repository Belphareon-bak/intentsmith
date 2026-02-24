// Accountant-CZ Tool Adapters
// ══════════════════════════════════════════════════════════════════════════════
//
// Wraps each accountant tool in a ToolAdapter with:
//   - required params declaration
//   - year fallback to latest supported
//   - sanity checks (amount cap + post-execution validation)
//   - standardized return contract (ok | clarify | error)
//
// ══════════════════════════════════════════════════════════════════════════════

import { ToolAdapter } from '../../src/expertises/tool-adapter.js';
import { calculateTax, compareTaxEntities } from './tools/tax-calc.js';
import { calculateVAT } from './tools/vat-calc.js';
import { calculateSalary } from './tools/salary-calc.js';
import { checkDeadlines } from './tools/deadline-checker.js';
import { supportedYears } from './tools/tax-rates.js';

const SUPPORTED = supportedYears(); // [2024, 2025]

// ─── Tax Calculator ─────────────────────────────────────────────────────────

export class TaxCalculatorAdapter extends ToolAdapter {
  constructor() {
    super({
      required: ['gross_income'],
      supportedYears: SUPPORTED,
      defaults: { entity_type: 'osvc' },
    });
  }

  execute(params) {
    return calculateTax(params);
  }

  validateResult(params, result) {
    const issues = [];
    const r = result;
    if (!r) return { valid: true };

    // net + tax ≈ gross (tolerance 1 Kč)
    if (r.net_income != null && r.total_tax_burden != null && r.gross_income != null) {
      const diff = Math.abs((r.net_income + r.total_tax_burden) - r.gross_income);
      if (diff > 1) {
        issues.push({ field: 'sum', message: `net + tax != gross (diff ${diff})`, severity: 'error' });
      }
    }

    // effective_rate sanity check
    // Note: For low income (<300k), minimum insurance payments cause legitimately
    // high effective rates (e.g. 100k income → ~85% rate). Only flag for higher income.
    if (r.effective_rate != null) {
      const highIncomeCheck = r.gross_income != null && r.gross_income >= 300000;
      if (r.effective_rate < 0) {
        issues.push({ field: 'effective_rate', message: `effective_rate ${r.effective_rate}% is negative`, severity: 'error' });
      } else if (highIncomeCheck && r.effective_rate > 80) {
        issues.push({ field: 'effective_rate', message: `effective_rate ${r.effective_rate}% > 80%`, severity: 'error' });
      } else if (highIncomeCheck && r.effective_rate > 60) {
        issues.push({ field: 'effective_rate', message: `effective_rate ${r.effective_rate}% > 60% (suspicious)`, severity: 'warn' });
      }
    }

    // net_income > 0 for positive gross (only for income >= 300k)
    // Note: For very low income (<300k), minimum insurance payments (~94k/year)
    // can exceed gross income, producing legitimately negative net.
    if (r.net_income != null && r.net_income <= 0 && r.gross_income != null && r.gross_income >= 300000) {
      issues.push({ field: 'net_income', message: 'net_income ≤ 0 despite positive gross', severity: 'error' });
    }

    return { valid: issues.length === 0, issues };
  }
}

// ─── VAT Calculator ─────────────────────────────────────────────────────────

export class VATCalculatorAdapter extends ToolAdapter {
  constructor() {
    super({
      required: ['amount'],
      supportedYears: SUPPORTED,
    });
  }

  execute(params) {
    return calculateVAT(params);
  }

  validateResult(params, result) {
    const issues = [];
    const r = result;
    if (!r) return { valid: true };

    // base + vat = total (tolerance 1 Kč)
    if (r.base != null && r.vat != null && r.total != null) {
      const diff = Math.abs((r.base + r.vat) - r.total);
      if (diff > 1) {
        issues.push({ field: 'sum', message: `base + vat != total (diff ${diff})`, severity: 'error' });
      }
    }

    // vat non-negative
    if (r.vat != null && r.vat < 0) {
      issues.push({ field: 'vat', message: 'negative VAT', severity: 'error' });
    }

    return { valid: issues.length === 0, issues };
  }
}

// ─── Salary Calculator ──────────────────────────────────────────────────────

export class SalaryCalculatorAdapter extends ToolAdapter {
  constructor() {
    super({
      required: ['gross_salary'],
      supportedYears: SUPPORTED,
    });
  }

  execute(params) {
    return calculateSalary(params);
  }

  validateResult(params, result) {
    const issues = [];
    const r = result;
    if (!r) return { valid: true };

    // net < gross
    if (r.net_salary != null && r.gross_salary != null && r.net_salary >= r.gross_salary) {
      issues.push({ field: 'net_salary', message: 'net_salary ≥ gross_salary', severity: 'error' });
    }

    // net_to_gross_ratio 50-95%
    if (r.net_to_gross_ratio != null) {
      if (r.net_to_gross_ratio < 50 || r.net_to_gross_ratio > 95) {
        issues.push({ field: 'net_to_gross_ratio', message: `ratio ${r.net_to_gross_ratio}% outside 50-95%`, severity: 'error' });
      }
    }

    return { valid: issues.length === 0, issues };
  }
}

// ─── Deadline Checker ───────────────────────────────────────────────────────

export class DeadlineCheckerAdapter extends ToolAdapter {
  constructor() {
    super({
      required: ['entity_type'],
      supportedYears: SUPPORTED,
    });
  }

  execute(params) {
    return checkDeadlines(params);
  }

  validateResult(params, result) {
    const issues = [];
    const r = result;
    if (!r) return { valid: true };

    if (!Array.isArray(r.deadlines) || r.deadlines.length === 0) {
      issues.push({ field: 'deadlines', message: 'empty deadlines array', severity: 'error' });
    }

    return { valid: issues.length === 0, issues };
  }
}

// ─── Compare Tax Entities ───────────────────────────────────────────────────

export class CompareAdapter extends ToolAdapter {
  constructor() {
    super({
      required: ['gross_income'],
      supportedYears: SUPPORTED,
    });
  }

  execute(params) {
    // compareTaxEntities expects (grossIncome, opts) — normalize in adapter
    const { gross_income, ...opts } = params;
    return compareTaxEntities(gross_income, opts);
  }

  validateResult(params, result) {
    const issues = [];
    const r = result;
    if (!r) return { valid: true };

    if (!r.osvc) issues.push({ field: 'osvc', message: 'missing osvc result', severity: 'error' });
    if (!r.sro) issues.push({ field: 'sro', message: 'missing sro result', severity: 'error' });

    if (r.comparison && !['osvc', 'sro'].includes(r.comparison.winner)) {
      issues.push({ field: 'winner', message: `invalid winner: ${r.comparison.winner}`, severity: 'error' });
    }

    return { valid: issues.length === 0, issues };
  }
}
