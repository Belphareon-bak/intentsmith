// Accountant Specialist (CZ) — Package Entry Point
// ══════════════════════════════════════════════════════════════════════════════
//
// Registers accountant tools into SpecialistRuntime.
// Called by specialist-loader on enable().
//
// v75: ToolAdapter contract — validate → normalize → execute
//
// ══════════════════════════════════════════════════════════════════════════════

import { fileURLToPath } from 'url';
import path from 'path';
import {
  TaxCalculatorAdapter,
  VATCalculatorAdapter,
  SalaryCalculatorAdapter,
  DeadlineCheckerAdapter,
  CompareAdapter,
} from './adapters.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Inline Extractors (synchronous, no import needed) ───────────────────────

function extractAmountInline(input) {
  // "850k", "850K" → ×1000 (but NOT "850Kč" — that's currency, not thousand)
  let m = input.match(/(\d[\d\s,.]*\d)\s*[kK](?![čcČC])(?:\s|$|,|\.|;)/);
  if (m) return parseFloat(m[1].replace(/[\s,]/g, '').replace(',', '.')) * 1000;

  // "2M", "2m", "2mil"
  m = input.match(/(\d[\d\s,.]*\d?)\s*[mM](?:il)?(?:\s|$|,|\.|;)/);
  if (m) return parseFloat(m[1].replace(/[\s,]/g, '').replace(',', '.')) * 1000000;

  // "850 tis", "850 tisíc"
  m = input.match(/(\d[\d\s,.]*\d?)\s*tis[ií]?c?(?:\s|$)/i);
  if (m) return parseFloat(m[1].replace(/[\s,]/g, '').replace(',', '.')) * 1000;

  // Plain numbers: "850000", "850 000", "50000"
  m = input.match(/(\d{1,3}(?:\s\d{3})+|\d{4,})/);
  if (m) return parseInt(m[1].replace(/\s/g, ''));

  // "z 50000", "ze 100000"
  m = input.match(/(?:z|ze|from)\s+(\d{3,})/);
  if (m) return parseInt(m[1]);

  return null;
}

function extractYearInline(input) {
  const m = input.match(/(?:za\s+rok\s*|rok(?:u)?\s*|v\s+roce\s*|year\s*)(202[3-9]|203[0-5])/);
  if (m) return parseInt(m[1]);
  const m2 = input.match(/\b(202[3-9])\b/);
  if (m2) return parseInt(m2[1]);
  return null;
}

// ─── Registration ────────────────────────────────────────────────────────────

/**
 * Register accountant specialist tools into the runtime.
 * Called by specialist-loader on enable().
 *
 * @param {Object} ctx
 * @param {import('../../src/expertises/specialist-runtime.js').SpecialistRuntime} ctx.runtime
 */
export function register(ctx) {
  const { runtime } = ctx;
  const toolsDir = path.join(__dirname, 'tools');

  runtime.registerSpecialist({
    id: 'accountant',
    domain: 'finance',
    globalParamExtractor: null,
    tools: [
      {
        id: 'accountant.compare_tax_entities',
        name: 'Porovnání OSVČ vs s.r.o.',
        description: 'Compare tax burden between sole proprietor and limited company',
        modulePath: path.join(toolsDir, 'tax-calc.js'),
        functionName: 'compareTaxEntities',
        toolAdapter: new CompareAdapter(),
        patterns: [{
          priority: 10,
          patterns: [
            /(?:porovn|srovn|rozd[ií]l|lépe|lepe|v[ýy]hodn|porovnat|srovnat)/i,
          ],
        }],
        extractParams: (input) => {
          const amount = extractAmountInline(input);
          const year = extractYearInline(input);
          const params = {};
          if (amount) params.gross_income = amount;
          if (year) params.year = year;
          return params;
        },
      },
      {
        id: 'accountant.vat_calculator',
        name: 'Kalkulačka DPH',
        description: 'Calculate VAT (add/remove) at Czech rates',
        modulePath: path.join(toolsDir, 'vat-calc.js'),
        functionName: 'calculateVAT',
        toolAdapter: new VATCalculatorAdapter(),
        patterns: [{
          priority: 8,
          patterns: [
            /(?:DPH|dph)\s*.{0,30}(?:z\s|ze\s|p[řr]idat|ode[čc][ií]st|kolik|v[ýy][šs]e|sazba)/i,
            /(?:kolik|jak[áa]|jakou|v[ýy][šs]e)\s*.{0,20}(?:DPH|dph)/i,
            /(?:p[řr]id|ode[čc]|vypo[čc]).{0,15}(?:DPH|dph)/i,
          ],
        }],
        extractParams: (input) => {
          const amount = extractAmountInline(input);
          const year = extractYearInline(input);
          const params = {};
          if (amount) params.amount = amount;
          if (year) params.year = year;
          const lower = input.toLowerCase();
          if (/12\s*%|sn[ií][žz]en|ni[žz][šs][ií]/i.test(lower)) params.rate = '12';
          else if (/0\s*%|osvobozen|export/i.test(lower)) params.rate = '0';
          else params.rate = '21';
          if (/bez\s+DPH|ode[čc][ií]st|remove|without/i.test(lower)) params.direction = 'remove';
          else params.direction = 'add';
          return params;
        },
      },
      {
        id: 'accountant.salary_calculator',
        name: 'Mzdová kalkulačka',
        description: 'Calculate net salary from gross (Czech social + health + tax)',
        modulePath: path.join(toolsDir, 'salary-calc.js'),
        functionName: 'calculateSalary',
        toolAdapter: new SalaryCalculatorAdapter(),
        patterns: [{
          priority: 6,
          patterns: [
            /(?:[čc]ist[áa]|hrub[áa])\s*.{0,15}(?:mzd|plat|v[ýy]plat)/i,
            /(?:mzd|plat|v[ýy]plat)\s*.{0,20}(?:[čc]ist|hrub|netto|brutto)/i,
            /(?:superhrub|n[áa]klad\s+zam[ěe]stnavatel)/i,
          ],
        }],
        extractParams: (input) => {
          const amount = extractAmountInline(input);
          const year = extractYearInline(input);
          const params = {};
          if (amount) params.gross_salary = amount;
          if (year) params.year = year;
          const childMatch = input.match(/(\d+)\s*(?:d[ěe][tí]|d[ií]t[ěe]|child)/i);
          if (childMatch) params.children = parseInt(childMatch[1]);
          return params;
        },
      },
      {
        id: 'accountant.deadline_checker',
        name: 'Daňové termíny',
        description: 'Check Czech tax filing deadlines',
        modulePath: path.join(toolsDir, 'deadline-checker.js'),
        functionName: 'checkDeadlines',
        toolAdapter: new DeadlineCheckerAdapter(),
        patterns: [{
          priority: 4,
          patterns: [
            /(?:kdy|do kdy|term[ií]n|lh[ůu]t|deadline)\s*.{0,30}(?:da[ňn]|p[řr]izn[áa]n[ií]|p[řr]ehled|hl[áa][šs]en[ií])/i,
            /(?:da[ňn]|p[řr]izn[áa]n[ií])\s*.{0,20}(?:kdy|do kdy|term[ií]n|lh[ůu]t)/i,
            /(?:do kdy)\s+(?:podat|odevzdat|odeslat)/i,
          ],
        }],
        extractParams: (input) => {
          const year = extractYearInline(input);
          const params = {};
          if (year) params.year = year;
          const lower = input.toLowerCase();
          if (/osv[čc]|[žz]ivnost/i.test(lower)) params.entity_type = 'osvc';
          else if (/s\.?\s?r\.?\s?o|sro/i.test(lower)) params.entity_type = 'sro';
          if (/poradce|advisor/i.test(lower)) params.has_advisor = true;
          if (/pl[áa]tce\s+DPH/i.test(lower)) params.is_vat_payer = true;
          return params;
        },
      },
      {
        id: 'accountant.tax_calculator',
        name: 'Daňová kalkulačka',
        description: 'Calculate income tax + social/health insurance for OSVČ/s.r.o.',
        modulePath: path.join(toolsDir, 'tax-calc.js'),
        functionName: 'calculateTax',
        toolAdapter: new TaxCalculatorAdapter(),
        patterns: [{
          priority: 2,
          patterns: [
            // Require computation verb OR amount alongside tax keyword
            /(?:kolik|jak[áa]|jakou|v[ýy][šs]e|celkov)\s*.{0,30}(?:da[ňn]|dan[ěe]|odvod|zaplat[ií]m)/i,
            /(?:da[ňn]|dan[ěe])\s*.{0,20}(?:z\s+p[řr][ií]jm|osv[čc]|s\.?\s?r\.?\s?o)/i,
            /(?:zdan[ěe]n[ií]|da[ňn]ov[áa]\s+povinnost)\s*.{0,20}(?:\d|osv[čc]|s\.?\s?r\.?\s?o|[žz]ivnost)/i,
            /(?:odvody|dan[ěe])\s+(?:z|ze)\s+\d/i,
          ],
        }],
        extractParams: (input) => {
          const amount = extractAmountInline(input);
          const year = extractYearInline(input);
          const params = {};
          if (amount) params.gross_income = amount;
          if (year) params.year = year;
          const lower = input.toLowerCase();
          if (/osv[čc]|[žz]ivnost/i.test(lower)) params.entity_type = 'osvc';
          else if (/s\.?\s?r\.?\s?o|sro/i.test(lower)) params.entity_type = 'sro';
          if (/pau[šs][áa]l.*80|80\s*%\s*pau[šs]/i.test(lower)) params.expense_type = 'flat_80';
          else if (/pau[šs][áa]l.*60|60\s*%/i.test(lower)) params.expense_type = 'flat_60';
          else if (/pau[šs][áa]l.*40|40\s*%/i.test(lower)) params.expense_type = 'flat_40';
          else if (/skute[čc]n|actual/i.test(lower)) params.expense_type = 'actual';
          return params;
        },
      },
    ],
  });
}

/**
 * Unregister accountant specialist from the runtime.
 * Called by specialist-loader on disable().
 *
 * @param {Object} ctx
 * @param {import('../../src/expertises/specialist-runtime.js').SpecialistRuntime} ctx.runtime
 */
export function unregister(ctx) {
  const { runtime } = ctx;
  if (typeof runtime.unregisterSpecialist === 'function') {
    runtime.unregisterSpecialist('accountant');
  }
}
