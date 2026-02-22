// D-int1: Accountant Tool Detector
// ══════════════════════════════════════════════════════════════════════════════
//
// Detects Czech accounting queries from natural language and extracts
// structured parameters for deterministic tool execution.
//
// Used by expert handler (D-int2) to intercept CRE ANSWER decisions
// and route to the correct accountant tool with extracted params.
//
// ══════════════════════════════════════════════════════════════════════════════

// ── Tool Type Constants (must match cre-decision.js ToolType) ────────────────

const ToolType = {
  TAX_CALCULATOR: 'accountant.tax_calculator',
  VAT_CALCULATOR: 'accountant.vat_calculator',
  SALARY_CALCULATOR: 'accountant.salary_calculator',
  DEADLINE_CHECKER: 'accountant.deadline_checker',
  COMPARE_TAX_ENTITIES: 'accountant.compare_tax_entities',
  COMPARE_SALARIES: 'accountant.compare_salaries',
};

// ── Pattern Groups ───────────────────────────────────────────────────────────
// Each group matches Czech + English queries (with and without diacritics)

const COMPARE_PATTERNS = [
  /(?:porovn|srovn|rozd[ií]l|lépe|lepe|v[ýy]hodn|porovnat|srovnat)/i,
  /(?:osv[čc]|[žz]ivnost).{0,20}(?:vs|nebo|oproti|proti|nebo).{0,20}(?:s\.?\s?r\.?\s?o|sro)/i,
  /(?:s\.?\s?r\.?\s?o|sro).{0,20}(?:vs|nebo|oproti|proti).{0,20}(?:osv[čc]|[žz]ivnost)/i,
  /compare.{0,20}(?:osvc|sro|sole.*proprietor|ltd)/i,
];

const VAT_PATTERNS = [
  /(?:DPH|dph)\s*.{0,30}(?:z\s|ze\s|p[řr]idat|ode[čc][ií]st|kolik|v[ýy][šs]e|sazba)/i,
  /(?:kolik|jak[áa]|jakou|v[ýy][šs]e)\s*.{0,20}(?:DPH|dph)/i,
  /(?:p[řr]id|ode[čc]|vypo[čc]).{0,15}(?:DPH|dph)/i,
  /(?:z[áa]klad|cena)\s*.{0,15}(?:bez|s|v[čc]etn[ěe])\s*.{0,10}(?:DPH|dph)/i,
  /(?:DPH|dph)\s+(?:z|ze)\s+\d/i,
  /(?:vat|value.added.tax).{0,20}(?:from|calculate|add|remove)/i,
];

const SALARY_PATTERNS = [
  /(?:[čc]ist[áa]|hrub[áa])\s*.{0,15}(?:mzd|plat|v[ýy]plat)/i,
  /(?:mzd|plat|v[ýy]plat)\s*.{0,20}(?:[čc]ist|hrub|netto|brutto)/i,
  /(?:kolik|jak[áa]|jakou)\s*.{0,20}(?:[čc]ist|net)\s*.{0,10}(?:mzd|plat|v[ýy]plat)/i,
  /(?:superhrub|n[áa]klad\s+zam[ěe]stnavatel)/i,
  /(?:odvody|poji[šs]t[ěe]n[ií])\s*.{0,20}(?:zam[ěe]stnanc|mzd)/i,
  /(?:gross|net)\s*salary/i,
];

const DEADLINE_PATTERNS = [
  /(?:kdy|do kdy|term[ií]n|lh[ůu]t|deadline)\s*.{0,30}(?:da[ňn]|p[řr]izn[áa]n[ií]|p[řr]ehled|hl[áa][šs]en[ií])/i,
  /(?:da[ňn]|p[řr]izn[áa]n[ií])\s*.{0,20}(?:kdy|do kdy|term[ií]n|lh[ůu]t)/i,
  /(?:kontroln[ií]|kontrolni)\s*.{0,10}(?:hl[áa][šs]en[ií])/i,
  /(?:souhrnn[ée]|souhrnne)\s*.{0,10}(?:hl[áa][šs]en[ií])/i,
  /(?:p[řr]ehled|prehled)\s*.{0,15}(?:OSSZ|[ČC]SSZ|VZP|cssz|vzp)/i,
  /(?:tax|filing)\s*deadline/i,
  /(?:do kdy)\s+(?:podat|odevzdat|odeslat)/i,
];

const TAX_PATTERNS = [
  /(?:kolik|jak[áa]|jakou|v[ýy][šs]e|celkov)\s*.{0,30}(?:da[ňn]|dan[ěe]|odvod|zaplat[ií]m|odvod[yů])/i,
  /(?:da[ňn]|dan[ěe])\s*.{0,20}(?:z\s+p[řr][ií]jm|osv[čc]|s\.?\s?r\.?\s?o|sro)/i,
  /(?:zdan[ěe]n[ií]|da[ňn]ov[áa]\s+povinnost)/i,
  /(?:soci[áa]ln[ií]|zdravotn[ií]|poji[šs]t[ěe]n[ií])\s*.{0,20}(?:osv[čc]|v[ýy][šs]e|kolik)/i,
  /(?:v[ýy]daj|vydaj)\s*.{0,15}(?:pau[šs][áa]l|skute[čc]n)/i,
  /(?:p[řr][ií]jm|prijm)\s*.{0,30}(?:osv[čc]|s\.?\s?r\.?\s?o|sro|podnik)/i,
  /(?:income|tax)\s+(?:calculation|calculator|from|for)/i,
  /(?:kolik|jak[ée])\s+(?:zaplat[ií]m|budu platit|jsou)\s+(?:dan[ěe]|odvody)/i,
  /(?:odvody|dan[ěe])\s+(?:z|ze)\s+\d/i,
  /odvody\s+(?:osv[čc]|s\.?\s?r\.?\s?o)/i,
];

// ── Amount Extraction ────────────────────────────────────────────────────────

function extractAmount(input) {
  // "850k", "850K", "850kč", "850Kč"
  let m = input.match(/(\d[\d\s,.]*\d)\s*[kK](?:[čc]|[Čč])?(?:\s|$|,|\.|;)/);
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

  // Small standalone numbers (for salary: 50000, VAT: 10000)
  m = input.match(/(?:z|ze|from)\s+(\d{3,})/);
  if (m) return parseInt(m[1]);

  return null;
}

// ── Entity Type Extraction ───────────────────────────────────────────────────

function extractEntityType(input) {
  const lower = input.toLowerCase();
  if (/osv[čc]|[žz]ivnost|zivnost|sole.?proprietor/i.test(lower)) return 'osvc';
  if (/s\.?\s?r\.?\s?o|sro|eseró[čc]ko|eserocko|ltd|gmbh/i.test(lower)) return 'sro';
  return null;
}

// ── Year Extraction ──────────────────────────────────────────────────────────

function extractYear(input) {
  const m = input.match(/(?:za\s+rok\s*|rok(?:u)?\s*|v\s+roce\s*|year\s*)(202[3-9]|203[0-5])/);
  if (m) return parseInt(m[1]);

  // Standalone year
  const m2 = input.match(/\b(202[3-9])\b/);
  if (m2) return parseInt(m2[1]);

  return null;
}

// ── VAT-Specific Extraction ──────────────────────────────────────────────────

function extractVATParams(input) {
  const params = {};
  const lower = input.toLowerCase();

  // Rate
  if (/12\s*%|sn[ií][žz]en|ni[žz][šs][ií]/i.test(lower)) params.rate = '12';
  else if (/0\s*%|osvobozen|export/i.test(lower)) params.rate = '0';
  else params.rate = '21';

  // Direction
  if (/bez\s+DPH|ode[čc][ií]st|odecist|remove|without/i.test(lower)) params.direction = 'remove';
  else params.direction = 'add';

  return params;
}

// ── Tax-Specific Extraction ──────────────────────────────────────────────────

function extractTaxParams(input) {
  const params = {};
  const lower = input.toLowerCase();

  // Expense type
  if (/pau[šs][áa]l.*80|80\s*%\s*pau[šs]/i.test(lower)) params.expense_type = 'flat_80';
  else if (/pau[šs][áa]l.*60|60\s*%/i.test(lower)) params.expense_type = 'flat_60';
  else if (/pau[šs][áa]l.*40|40\s*%/i.test(lower)) params.expense_type = 'flat_40';
  else if (/pau[šs][áa]l.*30|30\s*%/i.test(lower)) params.expense_type = 'flat_30';
  else if (/skute[čc]n|actual/i.test(lower)) params.expense_type = 'actual';

  // Children
  const childMatch = input.match(/(\d+)\s*(?:d[ěe][tí]|d[ií]t[ěe]|child)/i);
  if (childMatch) params.children = parseInt(childMatch[1]);

  // Spouse
  if (/man[žz]el|spouse/i.test(lower)) params.spouse_credit = true;

  // Student
  if (/student/i.test(lower)) params.student = true;

  return params;
}

// ── Deadline-Specific Extraction ─────────────────────────────────────────────

function extractDeadlineParams(input) {
  const params = {};
  const lower = input.toLowerCase();

  // Advisor
  if (/poradce|advisor|da[ňn]ov[ýy]\s+poradce/i.test(lower)) params.has_advisor = true;

  // VAT payer
  if (/pl[áa]tce\s+DPH|pl[áa]tce\s+dph|vat\s+payer/i.test(lower)) params.is_vat_payer = true;
  if (/m[ěe]s[ií][čc]n[ií].{0,5}DPH|DPH.{0,5}m[ěe]s[ií][čc]n|monthly.{0,5}vat|vat.{0,5}monthly/i.test(lower)) {
    params.is_vat_payer = true;
    params.vat_period = 'monthly';
  }
  if (/[čc]tvrtletn[ií].{0,5}DPH|DPH.{0,5}[čc]tvrtletn|quarterly.{0,5}vat|vat.{0,5}quarterly/i.test(lower)) {
    params.is_vat_payer = true;
    params.vat_period = 'quarterly';
  }

  return params;
}

// ── Main Detection Function ──────────────────────────────────────────────────

/**
 * Detect if input is an accountant tool query.
 * Returns null if no match, or { toolType, params } if matched.
 *
 * Priority: COMPARE > VAT > SALARY > DEADLINE > TAX
 * (COMPARE before TAX because both mention OSVČ/s.r.o.,
 *  VAT before TAX because "DPH" is unambiguous)
 *
 * @param {string} input - User message
 * @returns {{ toolType: string, params: Object } | null}
 */
export function detectAccountantTool(input) {
  if (!input || input.length < 5) return null;

  // ── COMPARE ──
  // Check for comparison patterns FIRST (mentions both entity types)
  if (COMPARE_PATTERNS.some(p => p.test(input)) && extractEntityType(input)) {
    const amount = extractAmount(input);
    const year = extractYear(input);
    const params = {};
    if (amount) params.gross_income = amount;
    if (year) params.year = year;
    return { toolType: ToolType.COMPARE_TAX_ENTITIES, params };
  }

  // ── VAT ──
  if (VAT_PATTERNS.some(p => p.test(input))) {
    const amount = extractAmount(input);
    const vatParams = extractVATParams(input);
    const year = extractYear(input);
    const params = { ...vatParams };
    if (amount) params.amount = amount;
    if (year) params.year = year;
    return { toolType: ToolType.VAT_CALCULATOR, params };
  }

  // ── SALARY ──
  if (SALARY_PATTERNS.some(p => p.test(input))) {
    const amount = extractAmount(input);
    const year = extractYear(input);
    const params = {};
    if (amount) params.gross_salary = amount;
    if (year) params.year = year;
    // Check for children
    const childMatch = input.match(/(\d+)\s*(?:d[ěe][tí]|d[ií]t[ěe]|child)/i);
    if (childMatch) params.children = parseInt(childMatch[1]);
    return { toolType: ToolType.SALARY_CALCULATOR, params };
  }

  // ── DEADLINE ──
  if (DEADLINE_PATTERNS.some(p => p.test(input))) {
    const entity = extractEntityType(input);
    const year = extractYear(input);
    const deadlineParams = extractDeadlineParams(input);
    const params = { ...deadlineParams };
    if (entity) params.entity_type = entity;
    if (year) params.year = year;
    return { toolType: ToolType.DEADLINE_CHECKER, params };
  }

  // ── TAX ──
  if (TAX_PATTERNS.some(p => p.test(input))) {
    const amount = extractAmount(input);
    const entity = extractEntityType(input);
    const year = extractYear(input);
    const taxParams = extractTaxParams(input);
    const params = { ...taxParams };
    if (amount) params.gross_income = amount;
    if (entity) params.entity_type = entity;
    if (year) params.year = year;
    return { toolType: ToolType.TAX_CALCULATOR, params };
  }

  return null;
}

// ── Exports for testing ──────────────────────────────────────────────────────

export {
  ToolType as ACCOUNTANT_TOOL_TYPES,
  extractAmount,
  extractEntityType,
  extractYear,
  extractVATParams,
  extractTaxParams,
  extractDeadlineParams,
  TAX_PATTERNS,
  VAT_PATTERNS,
  SALARY_PATTERNS,
  DEADLINE_PATTERNS,
  COMPARE_PATTERNS,
};
