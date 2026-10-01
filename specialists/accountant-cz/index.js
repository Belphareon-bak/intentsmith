// Accountant Specialist (CZ) — Package Entry Point
// ══════════════════════════════════════════════════════════════════════════════
//
// Self-contained specialist package: registers tools, boost patterns,
// knowledge, scenarios, tool types, and expertise into the runtime.
//
// v121: Self-contained registration — no hardcoded dependencies in core.
//
// ══════════════════════════════════════════════════════════════════════════════

import { fileURLToPath } from 'url';
import path from 'path';
import { createAdapters } from './adapters.js';
import { supportedYears } from './tools/tax-rates.js';

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

  // Common Czech word forms used in conversational amounts.
  if (/\bp[ůu]l\s+milionu?\b/i.test(input)) return 500000;
  if (/\b(?:jeden\s+)?milion(?:u)?\b/i.test(input)) return 1000000;

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

const VAT_NUMBER = '(?<whole>\\d{1,3}(?:[ \\u00a0\\u202f.]\\d{3})+|\\d+)(?:[,.](?<fraction>\\d{1,2}))?';
const VAT_CURRENCY = new RegExp(`(?<![\\p{L}\\d])${VAT_NUMBER}\\s*(?<scale>mil(?:ion(?:u)?)?|tis(?:[ií]c)?|[kKmM])?\\s*(?:Kč|CZK)(?!\\p{L})`, 'giu');
const VAT_SCALED = new RegExp(`(?<![\\p{L}\\d])${VAT_NUMBER}\\s*(?<scale>mil(?:ion(?:u)?)?|tis(?:[ií]c)?|[kKmM])(?!\\p{L})`, 'giu');
const VAT_PLAIN = new RegExp(`(?<![\\p{L}\\d])${VAT_NUMBER}(?![\\p{L}\\d])`, 'giu');

function vatAmountFromMatch(match) {
  const whole = match.groups.whole.replace(/[ .\u00a0\u202f]/gu, '');
  const fraction = (match.groups.fraction || '').padEnd(2, '0');
  const scale = match.groups.scale || '';
  const multiplier = /^(?:mil|m$)/iu.test(scale) ? 1_000_000
    : /^(?:tis|k$)/iu.test(scale) ? 1_000 : 1;
  const cents = (Number(whole) * 100 + Number(fraction || '0')) * multiplier;
  return Number.isSafeInteger(cents) && cents <= 100_000_000_000
    ? cents / 100 : null;
}

function vatAmountMatches(input) {
  const currency = [...input.matchAll(VAT_CURRENCY)];
  if (currency.length > 0) return currency;
  const scaled = [...input.matchAll(VAT_SCALED)];
  if (scaled.length > 0) return scaled;
  return [...input.matchAll(VAT_PLAIN)];
}

function extractVatParamsInline(input) {
  const params = {};
  const normalized = input.normalize('NFKC');
  const yearReferences = [...normalized.matchAll(/(?:za\s+rok|roku?|v\s+roce|year)\s*(\d{4})\b/giu)];
  const yearAlternatives = yearReferences.length
    ? [...normalized.matchAll(/\b(?:nebo|anebo|či)\s*(\d{4})\b/giu)] : [];
  const years = [...yearReferences, ...yearAlternatives].map(match => Number(match[1]));
  if (years.length > 1 && new Set(years).size > 1) params.inputError = 'year';
  else if (years.length) params.year = years[0];

  const percentages = [...normalized.matchAll(/(?<!\d)(\d+(?:[,.]\d{1,2})?)\s*%(?!\p{L})/gu)];
  const rates = percentages.map(match => match[1].replace(',', '.'));
  if (rates.length > 1 && new Set(rates).size > 1) params.inputError ||= 'rate';
  else if (rates.length) params.rate = rates[0];
  else if (/sn[ií][žz]en|ni[žz][šs][ií]/iu.test(normalized)) params.rate = '12';
  else if (/osvobozen|export/iu.test(normalized)) params.rate = '0';
  else params.rate = '21'; // Default is explicit in the result's assumptions.

  let amountSource = normalized;
  for (const match of [...yearReferences, ...yearAlternatives, ...percentages]) {
    amountSource = amountSource.slice(0, match.index)
      + ' '.repeat(match[0].length)
      + amountSource.slice(match.index + match[0].length);
  }
  for (const match of amountSource.matchAll(/(?<!\d)\d{1,2}\.\s*\d{1,2}\.\s*\d{4}(?!\d)/gu)) {
    amountSource = amountSource.slice(0, match.index)
      + ' '.repeat(match[0].length)
      + amountSource.slice(match.index + match[0].length);
  }
  // A sign or an isolated three-digit decimal group can change the amount's
  // meaning. Ask for one unambiguous amount instead of parsing a substring.
  if (/(?:^|[^\p{L}\d])[-−]\s*\d/u.test(amountSource)
      || /\d+[.,]\d{3}(?!\d|[.,]\d)/u.test(amountSource)) {
    params.inputError ||= 'amount';
  }
  const amounts = vatAmountMatches(amountSource);
  // Prefer explicit currency, but do not silently drop another bare amount.
  if ([...amountSource.matchAll(VAT_PLAIN)].some(candidate =>
    !amounts.some(amount => candidate.index >= amount.index
      && candidate.index + candidate[0].length <= amount.index + amount[0].length))) {
    params.inputError ||= 'amount';
  }
  if (amounts.length > 1) params.inputError ||= 'amount';
  else if (amounts.length === 1) {
    const amount = vatAmountFromMatch(amounts[0]);
    if (amount === null) params.inputError ||= 'amount';
    else params.amount = amount;
  }
  if (params.amount === undefined) params.inputError ||= 'amount';

  const negatedAction = /\bne(?:p[řr]id|p[řr]i[čc][ií]t|ode[čc]|odpo[čc]|nav[ýy][šs]|vypo[čc]|po[čc][ií]t)\p{L}*/iu.test(normalized)
    || /\b(?:nechci|nem[aá]m[e]?|nesm[ií]m[e]?)\b.{0,32}\b(?:p[řr]id|ode[čc]|odpo[čc]|vypo[čc]|po[čc][ií]t)\p{L}*/iu.test(normalized);
  if (negatedAction) {
    params.inputError ||= 'direction';
    return params;
  }

  const addVerb = /p[řr]id[eě]j|p[řr]idat|p[řr]i[čc]ti|nav[ýy][šs]/iu.test(normalized);
  const removeVerb = /ode[čc]ti|ode[čc][ií]st|odpo[čc][ií]t|remove|without/iu.test(normalized);
  const amountMatch = amounts.length === 1 ? amounts[0] : null;
  const before = amountMatch ? normalized.slice(Math.max(0, amountMatch.index - 30), amountMatch.index) : '';
  const after = amountMatch ? normalized.slice(amountMatch.index + amountMatch[0].length,
    amountMatch.index + amountMatch[0].length + 26) : '';
  const gross = /(?:v[čc]etn[eě]|s)\s+DPH/iu.test(after)
    || /(?:cena\s+(?:s|v[čc]etn[eě])\s+DPH|celkov[aá]\s+cena)\s*$/iu.test(before);
  const net = /bez\s+DPH/iu.test(after)
    || /(?:z[aá]klad(?:u)?(?:\s+dan[eě])?|cena\s+bez\s+DPH)\s*$/iu.test(before);
  const asksNetFrom = /cen[auy]\s+bez\s+DPH\s+z(?:e)?\s*$/iu.test(before);
  const vagueGross = /v[čc]etn[eě]\s+dan[eě]/iu.test(after);
  if (vagueGross || (addVerb && removeVerb) || (gross && net)
      || (addVerb && gross) || (removeVerb && net)
      || (addVerb && asksNetFrom)) params.inputError ||= 'direction';
  else if (removeVerb || gross || asksNetFrom) params.direction = 'remove';
  else if (addVerb || net || /DPH\s+z(?:e)?\s+/iu.test(normalized)) params.direction = 'add';
  else params.inputError ||= 'direction';
  return params;
}

function formatCZK(value) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
  }).format(value);
}

export function renderTaxResult({ result }) {
  if (!result || typeof result !== 'object') {
    throw new TypeError('accountant.tax_calculator requires a structured result');
  }

  const isSro = result.entity_type === 'sro';
  const totalTax = isSro ? result.total_tax : result.total_tax_burden;
  const rows = isSro
    ? [
        ['Vstupní zisk', result.gross_income],
        ['Zdanitelný zisk', result.taxable_profit],
        ['Daň z příjmů právnických osob', result.corporate_tax],
        ['Daň z dividendy', result.dividend_tax],
        ['Celkové daňové zatížení', totalTax],
        ['Čistý příjem po daních', result.net_income],
      ]
    : [
        ['Hrubý příjem', result.gross_income],
        ['Výdaje', result.expenses],
        ['Základ daně', result.tax_base],
        ['Daň z příjmů po slevách', result.income_tax],
        ['Sociální pojištění', result.social_insurance],
        ['Zdravotní pojištění', result.health_insurance],
        ['Celkové daňové zatížení', totalTax],
        ['Čistý příjem', result.net_income],
      ];

  const assumptions = Array.isArray(result.assumptions) ? result.assumptions : [];
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  const lines = [
    `## Daňový přehled — ${isSro ? 's.r.o.' : 'OSVČ'} (ČR, ${result.year})`,
    '',
    '| Položka | Výsledek |',
    '|---|---:|',
    ...rows.map(([label, value]) => `| ${label} | ${formatCZK(value)} |`),
    `| Efektivní sazba | ${Number(result.effective_rate).toLocaleString('cs-CZ')} % |`,
  ];

  if (assumptions.length > 0) {
    lines.push('', '### Předpoklady', '', ...assumptions.map(value => `- ${value}`));
  }
  if (warnings.length > 0) {
    lines.push('', '### Upozornění', '', ...warnings.map(value => `- ${value}`));
  }
  lines.push(
    '',
    '### Nezahrnuje',
    '',
    '- Individuální okolnosti neuvedené ve vstupu a závazné posouzení daňovým poradcem.',
    '',
    '*Toto je informativní přehled, nikoli závazná daňová rada. Pro konkrétní daňové rozhodnutí konzultujte daňového poradce.*',
  );
  return lines.join('\n');
}

function vatCents(value, label) {
  const cents = Math.round(value * 100);
  if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(cents)
      || Math.abs(value * 100 - cents) > 1e-6) {
    throw new TypeError(`accountant.vat_calculator invalid ${label}`);
  }
  return cents;
}

function formatVatCents(cents) {
  return `${new Intl.NumberFormat('cs-CZ', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)} Kč`;
}

/** Render only the bounded calculator result, never a generated legal claim. */
export function renderVatResult({ result, params } = {}) {
  if (!result || typeof result !== 'object' || Array.isArray(result)
      || !Number.isSafeInteger(result.year) || !supportedYears().includes(result.year)
      || ![0, 12, 21].includes(result.rate_percent)
      || !['add', 'remove'].includes(result.direction)
      || result.rate_decimal !== result.rate_percent / 100) {
    throw new TypeError('accountant.vat_calculator requires a valid structured result');
  }
  const base = vatCents(result.base, 'base');
  const vat = vatCents(result.vat, 'vat');
  const total = vatCents(result.total, 'total');
  if (base + vat !== total) {
    throw new TypeError('accountant.vat_calculator inconsistent monetary totals');
  }
  const assumptions = [
    `Sazba DPH: ${result.rate_percent}% (zákon č. 235/2004 Sb.)`,
    `Rok: ${result.year}`,
    result.direction === 'add'
      ? 'Vstupní částka = základ daně (bez DPH)'
      : 'Vstupní částka = cena včetně DPH',
  ];
  if (!Array.isArray(result.assumptions)
      || result.assumptions.length !== assumptions.length
      || result.assumptions.some((value, index) => value !== assumptions[index])) {
    throw new TypeError('accountant.vat_calculator inconsistent assumptions');
  }
  if (params !== undefined) {
    if (!params || typeof params !== 'object' || Array.isArray(params)
        || !Number.isFinite(params.amount) || params.amount < 0
        || String(params.rate) !== String(result.rate_percent)
        || params.direction !== result.direction
        || (params.year !== undefined && params.year !== result.year)) {
      throw new TypeError('accountant.vat_calculator parameters differ from result');
    }
    const input = vatCents(params.amount, 'input amount');
    const roundRatio = (numerator, denominator) =>
      Math.floor((2 * numerator + denominator) / (2 * denominator));
    const expectedBase = result.direction === 'add'
      ? input : roundRatio(input * 100, 100 + result.rate_percent);
    const expectedVat = result.direction === 'add'
      ? roundRatio(expectedBase * result.rate_percent, 100) : input - expectedBase;
    const expectedTotal = result.direction === 'add' ? expectedBase + expectedVat : input;
    if (base !== expectedBase || vat !== expectedVat || total !== expectedTotal) {
      throw new TypeError('accountant.vat_calculator values differ from parameters');
    }
  }
  return [
    `ČR, rok ${result.year}:`,
    '',
    '| Položka | Částka |',
    '|---|---:|',
    `| Základ daně | ${formatVatCents(base)} |`,
    `| DPH (${result.rate_percent} %) | ${formatVatCents(vat)} |`,
    `| Cena s DPH celkem | ${formatVatCents(total)} |`,
    '',
    '### Předpoklady',
    ...assumptions.map(value => `- ${value}`),
    '',
    '### Nezahrnuje',
    '- Individuální daňové posouzení konkrétního plnění.',
    '',
    '*Toto je informativní přehled, nikoli závazná daňová rada. Pro konkrétní daňové rozhodnutí konzultujte daňového poradce.*',
  ].join('\n');
}

function extractYearInline(input) {
  const m = input.match(/(?:za\s+rok\s*|rok(?:u)?\s*|v\s+roce\s*|year\s*)(202[3-9]|203[0-5])/);
  if (m) return parseInt(m[1]);
  const m2 = input.match(/\b(202[3-9])\b/);
  if (m2) return parseInt(m2[1]);
  return null;
}

// ─── Expertise Definition ────────────────────────────────────────────────────
// Previously in BUILTIN_EXPERTISES — now owned by the specialist package.

const ACCOUNTANT_EXPERTISE = {
  id: 'accountant',
  name: 'Účetní',
  icon: '🧮',
  domain: 'finance',
  description: 'Přehledy, cashflow, rozpočty, daně',
  isCustom: true,
  primaryProblemTypes: ['price_range', 'specification'],
  allowedRepresentations: ['tabular', 'report'],
  planningDepth: 'light',
  reviewPolicy: 'self',
  dataUsagePolicy: 'controlled',
  outputBias: 'conservative',
  preferredModels: ['qwen3.5:27b'],
  temperature: 0.2,
  tools: ['tax_calculator', 'vat_calculator', 'deadline_checker', 'salary_calculator'],
  capabilities: { reasoning: 75, creativity: 5, determinism: 95, riskTolerance: 5, verbosity: 50 },
  tone: 'professional',
  modules: {
    domain_rules: [
      'Vždy specifikuj zdaňovací období a jurisdikci (ČR)',
      'Rozlišuj OSVČ (§7 ZDP), s.r.o. (§21 ZDP), zaměstnance (§6 ZDP)',
      'Pro každý výpočet použij odpovídající nástroj',
      'Cituj zákony plnou citací (číslo zákona/rok Sb.)',
    ],
    emphasis: [
      'Přesné výpočty pomocí nástrojů',
      'Plné citace zákonů',
      'Sekce Předpoklady a Nezahrnuje',
    ],
    constraints: [
      'NIKDY nepočítej ručně',
      'NIKDY neodhaduj čísla',
      'Výsledky z nástrojů cituj přesně',
      'Měna CZK, zaokrouhlení na celé koruny',
    ],
    vocabulary: ['zdaňovací období', 'OSVČ', 'DPH', 'základ daně', 'sleva na dani', 'odvody', 'paušální výdaje'],
    antipatterns: ['Ruční výpočty bez nástrojů', 'Odhady místo přesných čísel', 'Zkrácené citace zákonů'],
    disclaimer: 'Toto je informativní přehled, nikoli závazná daňová rada. Pro konkrétní daňové rozhodnutí konzultujte daňového poradce.',
  },
  styleRules: {
    tone: 'professional',
    minResponseLength: 100,
    toolEnforcement: true,
    strictToolEnforcement: true,
    forbiddenPhrases: [
      'odhaduji',
      'přibližně',
      'může být kolem',
      'tipuji',
    ],
  },
  systemPrompt: `Jsi daňový specialista pro Českou republiku.

## KONTEXT
{{ memory_context }}

## PRAVIDLA

### Jurisdikce a rok
- Vždy specifikuj zdaňovací období (rok) a jurisdikci (ČR)
- Rozlišuj OSVČ (§7 ZDP), s.r.o. (§21 ZDP), zaměstnance (§6 ZDP)
- Při dotazu na aktuální rok VŽDY nejdřív ověř sazby přes vyhledávání

### Výpočty — POVINNÉ POUŽITÍ NÁSTROJŮ
- Pro KAŽDÝ výpočet MUSÍŠ použít odpovídající nástroj:
  - Daň z příjmů → tax_calculator
  - DPH → vat_calculator
  - Čistá mzda → salary_calculator
  - Lhůty → deadline_checker
- NIKDY nepočítej ručně. NIKDY neodhaduj čísla.
- Výsledky z nástrojů cituj přesně, neupravuj.
- Pokud nemáš dostatek vstupních dat pro přesný výpočet:
  - Musíš to říct
  - Uvést předpoklady (assumptions z výstupu nástroje)
  - Nesmíš výsledek prezentovat jako definitivní

### Citace zákonů
Místo zkráceného "§7 ZDP" uváděj plnou citaci:
"§7 zákona č. 586/1992 Sb., o daních z příjmů (příjmy ze samostatné činnosti)"

### Výstup
- Přehledy formátuj jako Markdown tabulky
- Měna: CZK (Kč), zaokrouhlení na celé koruny
- Vždy uveď sekci "Předpoklady" s výčtem co bylo předpokládáno
- Vždy uveď sekci "Nezahrnuje" s výčtem co výpočet nepokrývá

### Disclaimer (POVINNÝ)
Na konci KAŽDÉ odpovědi obsahující výpočet nebo daňovou radu:
"*Toto je informativní přehled, nikoli závazná daňová rada. Pro konkrétní daňové rozhodnutí konzultujte daňového poradce.*"`,
};

// ─── Tool definitions ────────────────────────────────────────────────────────

function buildToolDefinitions(toolsDir, ToolAdapter) {
  const {
    TaxCalculatorAdapter,
    VATCalculatorAdapter,
    SalaryCalculatorAdapter,
    DeadlineCheckerAdapter,
    CompareAdapter,
  } = createAdapters(ToolAdapter);

  return [
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
      failClosed: true,
      renderResult: renderVatResult,
      patterns: [{
        priority: 8,
        patterns: [
          /(?:DPH|dph)\s*.{0,30}(?:z\s|ze\s|p[řr]idat|ode[čc][ií]st|kolik|v[ýy][šs]e|sazba)/i,
          /(?:kolik|jak[áa]|jakou|v[ýy][šs]e)\s*.{0,20}(?:DPH|dph)/i,
          /(?:p[řr]id|ode[čc]|vypo[čc]).{0,15}(?:DPH|dph)/i,
          /(?:v[čc]etn[eě]|s)\s+DPH.{0,40}(?:vypo[čc]|z[aá]klad)/i,
        ],
      }],
      extractParams: extractVatParamsInline,
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
      renderResult: renderTaxResult,
      patterns: [{
        priority: 2,
        patterns: [
          /(?:kolik|jak[áa]|jakou|v[ýy][šs]e|celkov)\s*.{0,30}(?:da[ňn]|dan[ěe]|odvod|zaplat[ií]m)/i,
          /(?:minim[áa]ln[ií]\s+)?z[áa]loh\w*\s*.{0,25}(?:soci[áa]ln|zdravotn)\w*\s*.{0,20}(?:osv[čc]|[žz]ivnost)/i,
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
    {
      id: 'accountant.document_workflow', name: 'Doklady a přiznání',
      modulePath: path.join(toolsDir, 'document-workflow.js'), functionName: 'runDocumentWorkflow',
      patterns: [{priority:1,patterns:[/kontroln[ií]\s+hl[aá][sš]en|p[rř]izn[aá]n|^(?:stav|podklady|doklady|odpov[eě][dď]|doklad|export|pr[uů]vodce|n[aá]pov[eě]da)(?:\s|$)|📎/i]}],
      extractParams: input => ({input}), needsTurnContext:true, needsAccountingWorkflow:true,
      acceptsAllInput:true, failClosed:true, renderResult:({result})=>result.text,
    },
  ];
}

// ─── Boost Patterns ──────────────────────────────────────────────────────────

const ACCOUNTANT_BOOST_PATTERNS = [
  /\b(?:OSVČ|DPH)\b/i,
  /\bdaňov/i,
  /\bpaušál/i,
  /základ\s+dan/i,
  /\bodvod[yů]/i,
  /\bzdanění/i,
  /\bpojistn/i,
];

// ─── Registration ────────────────────────────────────────────────────────────

/**
 * Register accountant specialist — tools, boost patterns, knowledge,
 * scenarios, tool types, and expertise.
 *
 * v121: Self-contained registration via ctx.registries.
 *
 * @param {Object} ctx - Registration context from specialist-loader
 */
export async function register(ctx) {
  const runtime = ctx.requireCapability('specialist.runtime.v1');
  const ToolAdapter = ctx.requireCapability('specialist.tool-adapter.v1');
  const manifest = ctx.manifest.payload;
  const specialistId = ctx.extensionId;
  const log = ctx.getCapability('core.logger.v1');
  const knowledgeBase = ctx.getCapability('specialist.knowledge-base.v1');
  const registries = {
    autoSelect: ctx.getCapability('specialist.registry.auto-select.v1'),
    scenario: ctx.getCapability('specialist.registry.scenario.v1'),
    cre: ctx.getCapability('specialist.registry.cre.v1'),
    toolExecutor: ctx.getCapability('specialist.registry.tool-executor.v1'),
    capability: ctx.getCapability('specialist.registry.capability.v1'),
    expertise: ctx.getCapability('specialist.registry.expertise.v1'),
  };

  const toolsDir = path.join(__dirname, 'tools');
  const tools = buildToolDefinitions(toolsDir, ToolAdapter);

  // 1. Tools — register into SpecialistRuntime
  runtime.registerSpecialist({
    id: 'accountant',
    domain: 'finance',
    globalParamExtractor: null,
    tools,
  });

  // 2. Expertise — register custom expertise definition
  if (registries.expertise) {
    registries.expertise.addCustom(ACCOUNTANT_EXPERTISE);
  }

  // 3. Boost patterns — register into auto-select
  if (registries.autoSelect?.registerBoostPatterns) {
    registries.autoSelect.registerBoostPatterns('accountant', ACCOUNTANT_BOOST_PATTERNS);
  }

  // 4. Knowledge seeding
  if (knowledgeBase) {
    try {
      const { seedAccountantKnowledge } = await import('./knowledge/seed.js');
      seedAccountantKnowledge(knowledgeBase);
    } catch (err) {
      log?.warn?.('Accountant', `Knowledge seed failed: ${err.message}`);
    }
  }

  // 5. Scenarios
  if (registries.scenario?.register) {
    try {
      const { taxOptimizationScenario } = await import('./scenarios/tax-optimization.js');
      registries.scenario.register(taxOptimizationScenario);
    } catch (err) {
      log?.warn?.('Accountant', `Scenario registration failed: ${err.message}`);
    }
  }

  // 6. ToolType registration — dynamic CRE tool types
  if (registries.cre?.registerToolType) {
    for (const tool of manifest?.tools || []) {
      registries.cre.registerToolType(tool.id);
    }
  }

  // 7. ToolExecutor handlers — register tool execution handlers for CRE
  if (registries.toolExecutor?.register) {
    for (const tool of tools) {
      registries.toolExecutor.register(tool.id, (params) => tool.toolAdapter.run(params));
    }
  }

  // 8. Capabilities (v121 Krok 3 — registered when CapabilityRegistry is available)
  if (registries.capability?.register) {
    for (const cap of manifest.providedCapabilities) {
      registries.capability.register(cap, specialistId);
    }
  }
}

/**
 * Unregister accountant specialist from all registries.
 * v121: Fail-safe — each step independent, errors don't block others.
 *
 * @param {Object} ctx - Registration context from specialist-loader
 */
export function unregister(ctx) {
  const runtime = ctx.requireCapability('specialist.runtime.v1');
  const manifest = ctx.manifest.payload;
  const specialistId = ctx.extensionId;
  const registries = {
    autoSelect: ctx.getCapability('specialist.registry.auto-select.v1'),
    scenario: ctx.getCapability('specialist.registry.scenario.v1'),
    cre: ctx.getCapability('specialist.registry.cre.v1'),
    toolExecutor: ctx.getCapability('specialist.registry.tool-executor.v1'),
    capability: ctx.getCapability('specialist.registry.capability.v1'),
    expertise: ctx.getCapability('specialist.registry.expertise.v1'),
  };

  // 1. Tools
  try {
    if (typeof runtime?.unregisterSpecialist === 'function') {
      runtime.unregisterSpecialist('accountant');
    }
  } catch { /* handled by loader fail-safe */ }

  // 2. Expertise
  try {
    registries.expertise?.removeCustom('accountant');
  } catch { /* noop */ }

  // 3. Boost patterns
  try {
    registries.autoSelect?.unregisterBoostPatterns('accountant');
  } catch { /* noop */ }

  // 4. Scenarios
  try {
    registries.scenario?.unregisterBySpecialist?.('accountant');
  } catch { /* noop */ }

  // 5. ToolType + ToolExecutor
  try {
    for (const tool of manifest?.tools || []) {
      registries.cre?.unregisterToolType(tool.id);
      registries.toolExecutor?.unregister(tool.id);
    }
  } catch { /* noop */ }

  // 6. Capabilities
  try {
    registries.capability?.unregisterBySpecialist?.(specialistId);
  } catch { /* noop */ }
}
