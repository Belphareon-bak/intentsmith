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

function createToolDefinitionBuilder(ToolAdapter) {
  const {
    TaxCalculatorAdapter,
    VATCalculatorAdapter,
    SalaryCalculatorAdapter,
    DeadlineCheckerAdapter,
    CompareAdapter,
  } = createAdapters(ToolAdapter);

  return function buildToolDefinitions(toolsDir) {
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
    ];
  };
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
  if (typeof ctx?.ToolAdapter !== 'function') {
    throw new TypeError('ACCOUNTANT_TOOL_ADAPTER_REQUIRED');
  }
  const { runtime, manifest, logger: log } = ctx;
  const toolsDir = path.join(__dirname, 'tools');
  const buildToolDefinitions = createToolDefinitionBuilder(ctx.ToolAdapter);

  // 1. Tools — register into SpecialistRuntime
  runtime.registerSpecialist({
    id: 'accountant',
    domain: 'finance',
    globalParamExtractor: null,
    tools: buildToolDefinitions(toolsDir),
  });

  // 2. Expertise — register custom expertise definition
  if (ctx.registries?.expertise) {
    ctx.registries.expertise.addCustom(ACCOUNTANT_EXPERTISE);
  }

  // 3. Boost patterns — register into auto-select
  if (ctx.registries?.autoSelect?.registerBoostPatterns) {
    ctx.registries.autoSelect.registerBoostPatterns('accountant', ACCOUNTANT_BOOST_PATTERNS);
  }

  // 4. Knowledge seeding
  if (ctx.knowledgeBase) {
    try {
      const { seedAccountantKnowledge } = await import('./knowledge/seed.js');
      seedAccountantKnowledge(ctx.knowledgeBase);
    } catch (err) {
      log?.warn?.('Accountant', `Knowledge seed failed: ${err.message}`);
    }
  }

  // 5. Scenarios
  if (ctx.registries?.scenario?.register) {
    try {
      const { taxOptimizationScenario } = await import('./scenarios/tax-optimization.js');
      ctx.registries.scenario.register(taxOptimizationScenario);
    } catch (err) {
      log?.warn?.('Accountant', `Scenario registration failed: ${err.message}`);
    }
  }

  // 6. ToolType registration — dynamic CRE tool types
  if (ctx.registries?.cre?.registerToolType) {
    for (const tool of manifest?.tools || []) {
      ctx.registries.cre.registerToolType(tool.id);
    }
  }

  // 7. ToolExecutor handlers — register tool execution handlers for CRE
  if (ctx.registries?.toolExecutor?.register) {
    const tools = buildToolDefinitions(toolsDir);
    for (const tool of tools) {
      ctx.registries.toolExecutor.register(tool.id, async (params) => {
        if (tool.toolAdapter) {
          return tool.toolAdapter.run(params);
        }
        const mod = await import(tool.modulePath);
        return mod[tool.functionName](params);
      });
    }
  }

  // 8. Capabilities (v121 Krok 3 — registered when CapabilityRegistry is available)
  if (ctx.registries?.capability?.register) {
    for (const cap of manifest?.capabilities || []) {
      ctx.registries.capability.register(cap, manifest.id);
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
  const { runtime, manifest } = ctx;

  // 1. Tools
  try {
    if (typeof runtime?.unregisterSpecialist === 'function') {
      runtime.unregisterSpecialist('accountant');
    }
  } catch { /* handled by loader fail-safe */ }

  // 2. Expertise
  try {
    ctx.registries?.expertise?.removeCustom('accountant');
  } catch { /* noop */ }

  // 3. Boost patterns
  try {
    ctx.registries?.autoSelect?.unregisterBoostPatterns('accountant');
  } catch { /* noop */ }

  // 4. Scenarios
  try {
    ctx.registries?.scenario?.unregisterBySpecialist?.('accountant');
  } catch { /* noop */ }

  // 5. ToolType + ToolExecutor
  try {
    for (const tool of manifest?.tools || []) {
      ctx.registries?.cre?.unregisterToolType(tool.id);
      ctx.registries?.toolExecutor?.unregister(tool.id);
    }
  } catch { /* noop */ }

  // 6. Capabilities
  try {
    ctx.registries?.capability?.unregisterBySpecialist?.(manifest?.id);
  } catch { /* noop */ }
}
