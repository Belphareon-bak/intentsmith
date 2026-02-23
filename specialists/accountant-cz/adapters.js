// Accountant-CZ Tool Adapters
// ══════════════════════════════════════════════════════════════════════════════
//
// Wraps each accountant tool in a ToolAdapter with:
//   - required params declaration
//   - year fallback to latest supported
//   - sanity checks (amount cap)
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
}
