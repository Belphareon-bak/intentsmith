// C.3 v35.0.0.1 - Artifact Pipeline
// ══════════════════════════════════════════════════════════════════════════════
// Handles artifact generation with HARD validation + graceful degradation
// v2: Semantic intent classifier (hybrid: heuristic + LLM)
// v3: Decision Layer - rozhodování O datech, ne generování dat

import fs from 'fs';
import path from 'path';

// Decision Layer - CORE of v34.4
let decisionLayer = null;
try {
  decisionLayer = await import('./decision-layer.js');
  console.log('[Artifact] Decision layer loaded');
} catch (err) {
  console.log('[Artifact] Decision layer not available:', err.message);
}

// ════════════════════════════════════════════════════════════════════════════
// INTENT CLASSIFIER v2 - SEMANTIC (HYBRID)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Intent types
 */
export const INTENT = {
  FILE_REQUEST: 'FILE_REQUEST',       // Explicit file generation
  REPORT_REQUEST: 'REPORT_REQUEST',   // Implicit file (report, overview)
  TABLE_REQUEST: 'TABLE_REQUEST',     // Tabular data output
  CONFIG_REQUEST: 'CONFIG_REQUEST',   // Configuration files
  CHAT: 'CHAT'                        // Regular conversation
};

/**
 * Quick heuristic patterns - HIGH confidence only
 * These bypass LLM call when match is clear
 */
const HEURISTIC_PATTERNS = {
  [INTENT.FILE_REQUEST]: {
    patterns: [
      /vygeneruj\s+(mi\s+)?(pdf|dokument|soubor|xlsx|docx|csv|excel)\b/i,
      /vytvoř\s+(mi\s+)?(pdf|dokument|soubor|xlsx|docx|csv|excel)\b/i,
      /exportuj\s+(jako\s+)?(pdf|xlsx|docx|csv)\b/i,
      /ulož\s+(jako|do)\s+(pdf|xlsx|docx|csv)\b/i,
      /generate\s+(a\s+)?(pdf|document|file|xlsx|docx|csv)\b/i,
      /create\s+(a\s+)?(pdf|document|file|spreadsheet)\b/i,
      /export\s+(as\s+)?(pdf|xlsx|docx|csv)\b/i,
    ],
    confidence: 0.95
  },
  [INTENT.TABLE_REQUEST]: {
    patterns: [
      /\b(xlsx|excel|spreadsheet|tabulka)\s+(s|obsahující|kde)/i,
      /data\s+(do|v)\s+(excelu?|xlsx|csv)/i,
      /jako\s+(excel|xlsx|csv|tabulku)/i,
    ],
    confidence: 0.9
  },
  [INTENT.CONFIG_REQUEST]: {
    patterns: [
      /\b(config|konfigurace?)\s+(soubor|file|pro)/i,
      /\.(json|ya?ml|env|ini)\s+(soubor|file)/i,
    ],
    confidence: 0.9
  }
};

/**
 * Semantic indicators - used by LLM classifier
 * These are hints, not hard rules
 */
const SEMANTIC_INDICATORS = {
  fileOutput: [
    'stáhnout', 'ke stažení', 'download', 'uložit', 'save',
    'exportovat', 'export', 'soubor', 'file', 'dokument'
  ],
  reportOutput: [
    'přehled', 'overview', 'report', 'souhrn', 'summary',
    'analýza', 'analysis', 'srovnání', 'comparison', 'porovnat'
  ],
  tableOutput: [
    'tabulka', 'table', 'seznam', 'list', 'data', 'řádky', 'sloupce'
  ],
  questionIndicators: [
    'co je', 'what is', 'jak', 'how', 'proč', 'why', 'kdy', 'when',
    'vysvětli', 'explain', 'popiš', 'describe', '?'
  ]
};

/**
 * Intent classification cache
 */
const intentCache = new Map();
const CACHE_MAX_SIZE = 100;

/**
 * Normalize message for cache key
 */
function normalizeForCache(message) {
  return message.toLowerCase().trim().substring(0, 200);
}

/**
 * Quick heuristic classification
 * Returns result only if confidence is high
 */
function classifyHeuristic(message) {
  for (const [intent, config] of Object.entries(HEURISTIC_PATTERNS)) {
    for (const pattern of config.patterns) {
      if (pattern.test(message)) {
        return {
          intent,
          confidence: config.confidence,
          method: 'heuristic'
        };
      }
    }
  }
  return null;
}

/**
 * Count semantic indicators in message
 */
function countIndicators(message, indicators) {
  const lower = message.toLowerCase();
  return indicators.filter(ind => lower.includes(ind)).length;
}

/**
 * Analyze message for semantic hints
 */
function analyzeSemantics(message) {
  return {
    fileHints: countIndicators(message, SEMANTIC_INDICATORS.fileOutput),
    reportHints: countIndicators(message, SEMANTIC_INDICATORS.reportOutput),
    tableHints: countIndicators(message, SEMANTIC_INDICATORS.tableOutput),
    questionHints: countIndicators(message, SEMANTIC_INDICATORS.questionIndicators)
  };
}

/**
 * Build LLM classification prompt
 */
function buildClassifierPrompt(message, semantics) {
  return `Classify the user's intent into exactly ONE category.

USER MESSAGE: "${message}"

SEMANTIC ANALYSIS:
- File/download hints: ${semantics.fileHints}
- Report/overview hints: ${semantics.reportHints}  
- Table/data hints: ${semantics.tableHints}
- Question hints: ${semantics.questionHints}

CATEGORIES:
- FILE_REQUEST: User wants to generate/download a file (PDF, XLSX, DOCX, CSV)
- REPORT_REQUEST: User wants a report, overview, comparison, or analysis (implies file output)
- TABLE_REQUEST: User wants tabular data, spreadsheet, or structured data export
- CONFIG_REQUEST: User wants a configuration file (JSON, YAML, ENV)
- CHAT: User is asking a question, wants explanation, or just chatting

RULES:
1. If user mentions downloading, saving, or exporting → likely FILE_REQUEST or TABLE_REQUEST
2. If user wants "přehled", "srovnání", "report" → REPORT_REQUEST (even without explicit "PDF")
3. If user asks "what is", "how to", "explain" → CHAT
4. When in doubt between REPORT_REQUEST and CHAT → prefer REPORT_REQUEST if output seems expected

Respond with JSON only:
{"intent": "CATEGORY", "confidence": 0.0-1.0, "reason": "brief explanation"}`;
}

/**
 * Classify intent using LLM
 * @param {string} message - User message
 * @param {function} llmCall - Function to call LLM
 */
async function classifyWithLLM(message, llmCall) {
  const semantics = analyzeSemantics(message);
  const prompt = buildClassifierPrompt(message, semantics);
  
  const systemPrompt = `You are an intent classifier. Respond ONLY with valid JSON. No explanation outside JSON.`;
  
  try {
    const result = await llmCall(prompt, systemPrompt, {
      temperature: 0.1,  // Low temperature for consistency
      max_tokens: 100
    });
    
    // Parse JSON from response
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Validate intent
      if (Object.values(INTENT).includes(parsed.intent)) {
        return {
          intent: parsed.intent,
          confidence: Math.min(parsed.confidence || 0.7, 0.95),
          reason: parsed.reason || 'LLM classification',
          method: 'llm'
        };
      }
    }
  } catch (err) {
    console.warn('LLM classification failed:', err.message);
  }
  
  // Fallback to semantic analysis
  return classifyFromSemantics(semantics);
}

/**
 * Fallback classification from semantic analysis
 */
function classifyFromSemantics(semantics) {
  const { fileHints, reportHints, tableHints, questionHints } = semantics;
  
  // Strong question signal → CHAT
  if (questionHints >= 2 && fileHints === 0 && reportHints === 0) {
    return { intent: INTENT.CHAT, confidence: 0.7, method: 'semantic-fallback' };
  }
  
  // File/download signal
  if (fileHints >= 2) {
    return { intent: INTENT.FILE_REQUEST, confidence: 0.7, method: 'semantic-fallback' };
  }
  
  // Report signal
  if (reportHints >= 1) {
    return { intent: INTENT.REPORT_REQUEST, confidence: 0.65, method: 'semantic-fallback' };
  }
  
  // Table signal
  if (tableHints >= 1) {
    return { intent: INTENT.TABLE_REQUEST, confidence: 0.65, method: 'semantic-fallback' };
  }
  
  // Default to CHAT
  return { intent: INTENT.CHAT, confidence: 0.6, method: 'semantic-fallback' };
}

/**
 * Main classification function - HYBRID approach
 * 1. Check cache
 * 2. Try quick heuristic (high confidence patterns)
 * 3. If uncertain, use LLM classifier
 * 
 * @param {string} message - User message
 * @param {function} llmCall - Optional LLM call function for semantic classification
 */
export async function classifyIntent(message, llmCall = null) {
  const cacheKey = normalizeForCache(message);
  
  // 1. Check cache
  if (intentCache.has(cacheKey)) {
    const cached = intentCache.get(cacheKey);
    return { ...cached, cached: true };
  }
  
  // 2. Try quick heuristic
  const heuristicResult = classifyHeuristic(message);
  if (heuristicResult && heuristicResult.confidence >= 0.9) {
    cacheResult(cacheKey, heuristicResult);
    return heuristicResult;
  }
  
  // 3. Use LLM if available and heuristic is uncertain
  let result;
  if (llmCall) {
    result = await classifyWithLLM(message, llmCall);
  } else {
    // No LLM available - use semantic fallback
    const semantics = analyzeSemantics(message);
    result = classifyFromSemantics(semantics);
  }
  
  // Merge with heuristic if both have results
  if (heuristicResult && result.confidence < heuristicResult.confidence) {
    result = heuristicResult;
  }
  
  cacheResult(cacheKey, result);
  return result;
}

/**
 * Cache classification result
 */
function cacheResult(key, result) {
  // Evict old entries if cache is full
  if (intentCache.size >= CACHE_MAX_SIZE) {
    const firstKey = intentCache.keys().next().value;
    intentCache.delete(firstKey);
  }
  intentCache.set(key, result);
}

/**
 * Legacy function for backward compatibility
 * Maps to new classifyIntent
 */
export function classifyTask(message) {
  // Synchronous version - uses only heuristic + semantic
  const heuristicResult = classifyHeuristic(message);
  if (heuristicResult && heuristicResult.confidence >= 0.9) {
    return {
      type: heuristicResult.intent === INTENT.CHAT ? 'CHAT' : 'ARTIFACT',
      intent: heuristicResult.intent,
      artifactType: detectFileType(message) || 'pdf',
      topic: extractTopic(message),
      confidence: heuristicResult.confidence
    };
  }
  
  // Semantic fallback
  const semantics = analyzeSemantics(message);
  const semanticResult = classifyFromSemantics(semantics);
  
  return {
    type: semanticResult.intent === INTENT.CHAT ? 'CHAT' : 'ARTIFACT',
    intent: semanticResult.intent,
    artifactType: detectFileType(message) || 'pdf',
    topic: extractTopic(message),
    confidence: semanticResult.confidence
  };
}

/**
 * Detect file type from message
 */
function detectFileType(message) {
  const typePatterns = {
    pdf: /\bpdf\b/i,
    xlsx: /\b(xlsx|excel|spreadsheet)\b/i,
    csv: /\bcsv\b/i,
    docx: /\b(docx|word)\b/i,
    json: /\bjson\b/i,
  };
  
  for (const [type, pattern] of Object.entries(typePatterns)) {
    if (pattern.test(message)) return type;
  }
  return null;
}

/**
 * Extract topic/subject from message
 */
function extractTopic(message) {
  return message
    .replace(/vygeneruj\s+(mi\s+)?/gi, '')
    .replace(/vytvoř\s+(mi\s+)?/gi, '')
    .replace(/připrav\s+(mi\s+)?/gi, '')
    .replace(/exportuj\s+(jako\s+)?/gi, '')
    .replace(/udělej\s+(mi\s+)?/gi, '')
    .replace(/\b(pdf|xlsx|excel|csv|docx|word|dokument|tabulku?|soubor|report|přehled)\b/gi, '')
    .replace(/\s+(s|kde|který|která|které|obsahující)\s+/gi, ' ')
    .replace(/ke\s+stažení/gi, '')
    .trim();
}

// ════════════════════════════════════════════════════════════════════════════
// LOCALE CONTEXT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Get locale context for LLM
 * Supports both flat structure and nested settingsState from sidebar
 */
export function getLocaleContext(settings = {}) {
  // Handle nested structure from frontend settingsState
  const loc = settings.location || settings;
  
  // Map currency to symbol
  const currencySymbols = {
    'CZK': 'Kč',
    'EUR': '€',
    'USD': '$',
    'GBP': '£',
    'PLN': 'zł'
  };
  
  // Map language code to name
  const languageNames = {
    'cs': 'čeština',
    'en': 'English',
    'de': 'Deutsch',
    'sk': 'slovenčina'
  };
  
  // Map country code to name
  const countryNames = {
    'CZ': 'Czech Republic',
    'SK': 'Slovakia',
    'DE': 'Germany',
    'US': 'United States',
    'GB': 'United Kingdom'
  };
  
  const currency = loc.currency || 'CZK';
  const language = loc.language || 'cs';
  const country = loc.country || 'CZ';
  
  return {
    locale: `${language}-${country}`,
    currency: currency,
    currencySymbol: currencySymbols[currency] || currency,
    region: countryNames[country] || country,
    language: languageNames[language] || language,
    timezone: loc.timezone || 'Europe/Prague',
    city: loc.city || 'Praha'
  };
}

/**
 * Build locale enforcement rules for system prompt
 */
export function buildLocaleRules(locale) {
  return `
LOCALE ENFORCEMENT (MANDATORY):
- Currency: ${locale.currency} (${locale.currencySymbol}) - ALL prices MUST be in this currency
- Language: ${locale.language} - respond in this language
- Region: ${locale.region} - use local context for pricing/availability
- If prices are uncertain, show ranges (e.g., "15 000 - 18 000 Kč")
- For used/bazaar items, explicitly mark as "bazar" with price range
`;
}

// ════════════════════════════════════════════════════════════════════════════
// ARTIFACT GENERATION PROMPT WITH DATA CONFIDENCE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Data confidence levels
 */
export const DATA_CONFIDENCE = {
  HIGH: 'high',      // Verified data from reliable source
  MEDIUM: 'medium',  // Estimated/heuristic data
  LOW: 'low',        // Guessed/example data
  UNKNOWN: 'unknown' // No confidence info
};

/**
 * Build system prompt for artifact generation
 * DYNAMICKÝ podle typu problému, dostupnosti dat A reprezentace
 * 
 * @param {object} task - Task info
 * @param {object} locale - Locale settings
 * @param {object} context - Decision context { problemType, hasDataSource, llmMode, representation }
 */
export function buildArtifactPrompt(task, locale, context = {}) {
  const localeRules = buildLocaleRules(locale);
  const { problemType, hasDataSource, llmMode, representation } = context;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // NARRATIVE MODE - completely different prompt for stories/essays
  // ═══════════════════════════════════════════════════════════════════════════
  if (representation === 'narrative') {
    return `ROLE: You are a CREATIVE WRITER.
TASK: Write a narrative text (story, essay, article) for a ${task.artifactType.toUpperCase()} document.

LANGUAGE: ${locale.language}

OUTPUT FORMAT (MANDATORY):
You MUST respond with valid JSON in this structure:
{
  "title": "Title of the work",
  "content": "The full narrative text with paragraphs separated by \\n\\n",
  "metadata": {
    "type": "narrative",
    "wordCount": approximate_word_count
  }
}

═══════════════════════════════════════════════════════════════════════════
NARRATIVE WRITING RULES
═══════════════════════════════════════════════════════════════════════════

1. Write CONTINUOUS PROSE - no tables, no bullet points, no lists
2. Use PARAGRAPHS separated by blank lines
3. Include natural dialogue if appropriate
4. Focus on storytelling, not data presentation
5. NO metadata banners, NO confidence badges, NO currency info
6. NO "data quality" indicators - this is creative content

STYLE:
- Engaging narrative voice
- Descriptive language
- Natural flow between paragraphs
- Appropriate for the requested format (story/essay/article)

Your response will be parsed as JSON. Output ONLY the JSON, no markdown.`;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STRUCTURED MODE - sections with text, no tables
  // ═══════════════════════════════════════════════════════════════════════════
  if (representation === 'structured') {
    return `ROLE: You are a DOCUMENT WRITER.
TASK: Write structured text content for a ${task.artifactType.toUpperCase()} document.

LANGUAGE: ${locale.language}

OUTPUT FORMAT (MANDATORY):
You MUST respond with valid JSON in this structure:
{
  "title": "Document title",
  "sections": [
    {
      "heading": "Section heading",
      "content": "Section content as paragraphs..."
    }
  ],
  "metadata": {
    "type": "structured"
  }
}

═══════════════════════════════════════════════════════════════════════════
STRUCTURED CONTENT RULES
═══════════════════════════════════════════════════════════════════════════

1. Organize content into SECTIONS with headings
2. Write in PARAGRAPHS, not bullet points
3. NO tables unless explicitly requested
4. NO metadata banners or confidence badges
5. Focus on clear, readable prose

Your response will be parsed as JSON. Output ONLY the JSON, no markdown.`;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // REPORT/TABULAR MODE - original data-focused prompt
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Base prompt for data/report mode
  let prompt = `ROLE: You are a DATA EXTRACTION and FORMATTING assistant.
TASK: Generate structured data for a ${task.artifactType.toUpperCase()} file.

${localeRules}

OUTPUT FORMAT (MANDATORY):
You MUST respond with valid JSON in this exact structure:
{
  "title": "Document title in ${locale.language}",
  "description": "Brief description",
  "data": [
    { "column1": "value1", "column2": "value2", ... }
  ],
  "columns": ["column1", "column2", ...],
  "notes": ["Note about data accuracy"],
  "metadata": {
    "confidence": "high|medium|low",
    "market": "${locale.region}",
    "source": "heuristic",
    "generated_at": "auto-filled"
  }
}
`;

  // ═══════════════════════════════════════════════════════════════════════════
  // DYNAMICKÉ INSTRUKCE PODLE KONTEXTU (for report mode)
  // ═══════════════════════════════════════════════════════════════════════════
  
  if (hasDataSource) {
    // Data layer poskytl data → LLM jen anotuje
    prompt += `
═══════════════════════════════════════════════════════════════════════════
DATA PROVIDED EXTERNALLY
═══════════════════════════════════════════════════════════════════════════

Data jsou poskytována z externího ověřeného zdroje.
Tvůj úkol je POUZE:
- Vygenerovat výstižný title (max 60 znaků)
- Napsat krátký description (max 120 znaků)  
- Přidat vysvětlující poznámky kde je to vhodné

NEGENERUJ vlastní data - ta budou doplněna automaticky.
`;
  } else if (llmMode === 'low' || problemType === 'price_range') {
    // Price range bez data source → LLM musí být konzervativní
    prompt += `
═══════════════════════════════════════════════════════════════════════════
CONSERVATIVE DATA MODE
═══════════════════════════════════════════════════════════════════════════

Pro tuto doménu NEMÁME ověřený zdroj dat.
Proto MUSÍŠ:

1. Používat ROZMEZÍ (cena_min, cena_max), nikdy přesné hodnoty
2. Nastavit jistota: "low" pro všechny položky
3. Nastavit typ_ceny: "odhad" pro neověřené ceny
4. Přidat poznámku: "Ceny jsou orientační odhady"

PRAVIDLA PRO ODHADY:
- Buď KONZERVATIVNÍ - raději podhodnoť než nadhodnoť
- Nová generace produktů: max +30-50% oproti předchozí
- Neznámé produkty: uveď široké rozmezí

COLUMN SCHEMA (povinné pro cenové tabulky):
["produkt", "specifikace", "cena_min", "cena_max", "typ_ceny", "jistota"]

cena_min, cena_max = ČÍSLA (ne stringy)
typ_ceny = "retail" | "bazar" | "odhad"
jistota = "low" (pro odhady)
`;
  } else if (llmMode === 'medium' || problemType === 'specification') {
    // Specifikace → LLM může použít training data
    prompt += `
═══════════════════════════════════════════════════════════════════════════
SPECIFICATION MODE
═══════════════════════════════════════════════════════════════════════════

Generuješ technické specifikace/parametry.
Můžeš použít své znalosti, ale:

1. Buď přesný u ověřitelných faktů
2. Označ nejistá data jako jistota: "medium"
3. Neuvádej ceny pokud o ně není explicitně žádáno

Pro tabulky se specifikacemi:
- Používej relevantní sloupce pro danou doménu
- Jednotky vždy uváděj (GB, MHz, kg, mm, ...)
`;
  } else if (llmMode === 'high' || llmMode === 'full' || problemType === 'procedural') {
    // Procedurální → LLM má volnou ruku
    prompt += `
═══════════════════════════════════════════════════════════════════════════
KNOWLEDGE MODE
═══════════════════════════════════════════════════════════════════════════

Můžeš využít své plné znalosti.
Toto NENÍ cenový/datový dotaz - jde o:
- Návod / postup
- Vysvětlení
- Doporučení

Nastavit jistota: "high" pokud jsi si jistý.
`;
  } else {
    // Default - střední cesta
    prompt += `
═══════════════════════════════════════════════════════════════════════════
BALANCED MODE
═══════════════════════════════════════════════════════════════════════════

Generuj data na základě svých znalostí.
- Pro fakta: jistota "high" nebo "medium"
- Pro odhady: jistota "low"
- Pro ceny: vždy rozmezí (cena_min, cena_max)
- Přidat poznámku o spolehlivosti dat
`;
  }

  // Společné závěrečné instrukce
  prompt += `

═══════════════════════════════════════════════════════════════════════════
CRITICAL RULES (VŽDY PLATÍ)
═══════════════════════════════════════════════════════════════════════════

1. ONLY output JSON - no markdown, no explanation, no preamble
2. Prices as NUMBERS (45000), not strings ("45 000 Kč")
3. Be HONEST about confidence - nepředstírej jistotu
4. If unsure, use wider ranges and lower confidence

Your response will be parsed as JSON. Any text outside the JSON will cause failure.`;

  return prompt;
}


// ════════════════════════════════════════════════════════════════════════════
// RESPONSE PARSER & VALIDATOR WITH GRACEFUL DEGRADATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Price sanity reference data (CZK, Czech market 2024-2025)
 */
const PRICE_REFERENCE = {
  'RTX 5090': { min: 55000, max: 75000, typ: 'odhad', jistota: 'low' },
  'RTX 5080': { min: 35000, max: 50000, typ: 'odhad', jistota: 'low' },
  'RTX 5070': { min: 20000, max: 28000, typ: 'odhad', jistota: 'low' },
  'RTX 4090': { min: 45000, max: 60000, typ: 'retail', jistota: 'medium' },
  'RTX 4080': { min: 28000, max: 38000, typ: 'retail', jistota: 'medium' },
  'RTX 4070 Ti': { min: 22000, max: 28000, typ: 'retail', jistota: 'medium' },
  'RTX 4070': { min: 16000, max: 20000, typ: 'retail', jistota: 'medium' },
  'RTX 4060 Ti': { min: 12000, max: 15000, typ: 'retail', jistota: 'medium' },
  'RTX 4060': { min: 9000, max: 12000, typ: 'retail', jistota: 'medium' },
  'RTX 3090': { min: 18000, max: 25000, typ: 'bazar', jistota: 'medium' },
  'RTX 3080': { min: 12000, max: 18000, typ: 'bazar', jistota: 'medium' },
  'RTX 3070': { min: 8000, max: 12000, typ: 'bazar', jistota: 'medium' },
};

/**
 * Normalize and validate artifact data
 * - Ensures required columns exist
 * - Applies price sanity checks
 * - Converts data types
 */
function normalizeArtifactData(data, locale) {
  const normalized = { ...data };
  const warnings = [];
  
  // Check if this looks like a product/price table
  const hasPrice = data.columns?.some(c => 
    /cena|price|cost/i.test(c)
  ) || data.data?.some(row => 
    Object.values(row).some(v => /\d+.*[Kk]č|CZK|\d{4,}/.test(String(v)))
  );
  
  if (hasPrice && data.data?.length > 0) {
    // Ensure required columns exist
    const requiredCols = ['typ_ceny', 'jistota'];
    const existingCols = new Set(data.columns || Object.keys(data.data[0]));
    
    for (const col of requiredCols) {
      if (!existingCols.has(col)) {
        // Add missing column with defaults
        normalized.columns = [...(normalized.columns || []), col];
      }
    }
    
    // Process each row
    normalized.data = data.data.map((row, idx) => {
      const newRow = { ...row };
      
      // Try to identify product name for price reference
      const productName = Object.values(row).find(v => 
        /RTX|GTX|RX\s?\d/i.test(String(v))
      );
      
      // Extract product key for reference lookup
      const productKey = productName ? 
        String(productName).match(/RTX\s*\d{4}(\s*Ti)?/i)?.[0]?.replace(/\s+/g, ' ') : 
        null;
      
      const reference = productKey ? PRICE_REFERENCE[productKey] : null;
      
      // Normalize price fields
      for (const [key, val] of Object.entries(row)) {
        if (/cena|price/i.test(key)) {
          // Extract numeric value
          let numVal = val;
          if (typeof val === 'string') {
            // Remove currency symbols, spaces, etc.
            numVal = parseInt(val.replace(/[^\d]/g, ''), 10) || val;
          }
          
          // Apply price sanity check
          if (reference && typeof numVal === 'number') {
            if (numVal > reference.max * 1.5) {
              warnings.push(`${productKey}: cena ${numVal} snížena na ${reference.max} (sanity check)`);
              numVal = reference.max;
            }
            if (numVal < reference.min * 0.5) {
              warnings.push(`${productKey}: cena ${numVal} zvýšena na ${reference.min} (sanity check)`);
              numVal = reference.min;
            }
          }
          
          newRow[key] = numVal;
        }
      }
      
      // Handle min/max price columns
      if (newRow.cena_min !== undefined && newRow.cena_max !== undefined) {
        if (reference) {
          // Sanity check on min/max
          if (newRow.cena_min > reference.max * 1.5) {
            newRow.cena_min = reference.min;
            newRow.cena_max = reference.max;
            warnings.push(`${productKey}: ceny opraveny podle reference`);
          }
        }
      }
      
      // Ensure typ_ceny exists
      if (!newRow.typ_ceny) {
        if (reference) {
          newRow.typ_ceny = reference.typ;
        } else if (/bazar|used|second/i.test(JSON.stringify(row))) {
          newRow.typ_ceny = 'bazar';
        } else if (/odhad|estimate/i.test(JSON.stringify(row))) {
          newRow.typ_ceny = 'odhad';
        } else {
          newRow.typ_ceny = 'retail';
        }
      }
      
      // Ensure jistota exists
      if (!newRow.jistota) {
        if (reference) {
          newRow.jistota = reference.jistota;
        } else {
          newRow.jistota = 'medium';
        }
      }
      
      return newRow;
    });
    
    // Ensure columns array matches data
    if (normalized.data.length > 0) {
      normalized.columns = Object.keys(normalized.data[0]);
    }
  }
  
  // Add warnings to notes
  if (warnings.length > 0) {
    normalized.notes = [
      ...(normalized.notes || []),
      `Automatické korekce: ${warnings.length} cen upraveno podle referenčních dat`
    ];
    normalized.metadata = {
      ...normalized.metadata,
      sanity_checks: warnings.length,
      warnings
    };
  }
  
  return normalized;
}

/**
 * Format price for display (number -> "XX XXX Kč")
 */
function formatPrice(value, currency = 'Kč') {
  if (typeof value === 'number') {
    return value.toLocaleString('cs-CZ').replace(/,/g, ' ') + ' ' + currency;
  }
  return value;
}

/**
 * Parse LLM response for NARRATIVE/STRUCTURED content
 * Different structure than data reports
 */
export function parseNarrativeResponse(response, representation = 'narrative') {
  // Try to extract JSON from response
  let jsonStr = response;
  
  // Remove markdown code blocks if present
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }
  
  // Try to find JSON object
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonStr = objectMatch[0];
  }
  
  try {
    const data = JSON.parse(jsonStr);
    
    // Validate based on representation type
    if (representation === 'narrative') {
      // Narrative needs: title and content
      if (!data.title) {
        data.title = 'Bez názvu';
      }
      if (!data.content && !data.text && !data.body) {
        // Try to use sections if available
        if (data.sections && Array.isArray(data.sections)) {
          data.content = data.sections.map(s => 
            `## ${s.heading || s.title || ''}\n\n${s.content || s.text || ''}`
          ).join('\n\n');
        } else {
          return {
            success: false,
            error: 'Missing content field for narrative',
            raw: response.substring(0, 500)
          };
        }
      }
      
      // Normalize content field
      data.content = data.content || data.text || data.body;
      
      return {
        success: true,
        data: {
          title: data.title,
          content: data.content,
          metadata: {
            type: 'narrative',
            ...data.metadata
          }
        }
      };
      
    } else if (representation === 'structured') {
      // Structured needs: title and sections
      if (!data.title) {
        data.title = 'Bez názvu';
      }
      
      // Accept either sections array or content
      if (data.sections && Array.isArray(data.sections)) {
        return {
          success: true,
          data: {
            title: data.title,
            sections: data.sections,
            metadata: {
              type: 'structured',
              ...data.metadata
            }
          }
        };
      } else if (data.content) {
        // Convert content to single section
        return {
          success: true,
          data: {
            title: data.title,
            sections: [{ heading: '', content: data.content }],
            metadata: {
              type: 'structured',
              ...data.metadata
            }
          }
        };
      }
      
      return {
        success: false,
        error: 'Missing sections or content for structured document',
        raw: response.substring(0, 500)
      };
    }
    
    // Fallback
    return {
      success: false,
      error: 'Unknown representation type',
      raw: response.substring(0, 500)
    };
    
  } catch (err) {
    // Try plain text fallback for narrative
    if (representation === 'narrative' && response.length > 100) {
      // Assume the whole response is the content
      const lines = response.trim().split('\n');
      const title = lines[0].replace(/^#*\s*/, '').substring(0, 100);
      const content = lines.slice(1).join('\n').trim();
      
      if (content.length > 50) {
        return {
          success: true,
          data: {
            title: title || 'Bez názvu',
            content: content,
            metadata: { type: 'narrative' }
          }
        };
      }
    }
    
    return {
      success: false,
      error: `Parse error: ${err.message}`,
      raw: response.substring(0, 500)
    };
  }
}

/**
 * Parse LLM response and extract JSON data
 * Returns partial data for graceful degradation if full parse fails
 */
export function parseArtifactResponse(response, locale = { currency: 'CZK' }) {
  // Try to extract JSON from response
  let jsonStr = response;
  
  // Remove markdown code blocks if present
  const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }
  
  // Try to find JSON object
  const objectMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    jsonStr = objectMatch[0];
  }
  
  try {
    const data = JSON.parse(jsonStr);
    
    // Validate required fields
    if (!data.title || !data.data || !Array.isArray(data.data)) {
      return {
        success: false,
        partial: true,
        error: 'Invalid artifact structure: missing title or data array',
        fallback: extractFallbackData(response)
      };
    }
    
    if (data.data.length === 0) {
      return {
        success: false,
        partial: true,
        error: 'Artifact data array is empty',
        fallback: extractFallbackData(response)
      };
    }
    
    // Add default metadata if missing
    if (!data.metadata) {
      data.metadata = {
        confidence: DATA_CONFIDENCE.MEDIUM,
        price_type: 'estimate',
        source: 'heuristic',
        generated_at: new Date().toISOString()
      };
    } else {
      data.metadata.generated_at = new Date().toISOString();
    }
    
    // NORMALIZE DATA with sanity checks
    const normalized = normalizeArtifactData(data, locale);
    
    return {
      success: true,
      data: normalized
    };
    
  } catch (err) {
    // Graceful degradation - try to extract something useful
    const fallback = extractFallbackData(response);
    
    return {
      success: false,
      partial: fallback !== null,
      error: `JSON parse error: ${err.message}`,
      fallback,
      raw: response.substring(0, 500)
    };
  }
}

/**
 * Extract fallback data from non-JSON response
 * Tries to find markdown tables or lists
 */
function extractFallbackData(response) {
  // Try to extract markdown table
  const tableMatch = response.match(/\|[^\n]+\|\n\|[-:| ]+\|\n((?:\|[^\n]+\|\n?)+)/);
  if (tableMatch) {
    const rows = tableMatch[0].split('\n').filter(r => r.trim() && !r.includes('---'));
    if (rows.length >= 2) {
      const headers = rows[0].split('|').map(h => h.trim()).filter(Boolean);
      const data = rows.slice(1).map(row => {
        const cells = row.split('|').map(c => c.trim()).filter(Boolean);
        const obj = {};
        headers.forEach((h, i) => {
          obj[h] = cells[i] || '';
        });
        return obj;
      });
      
      return {
        title: 'Extrahovaná data',
        description: 'Data extrahována z textové odpovědi',
        data,
        columns: headers,
        notes: ['⚠️ Částečná extrakce - doporučujeme regenerovat'],
        metadata: {
          confidence: DATA_CONFIDENCE.LOW,
          source: 'fallback_extraction',
          generated_at: new Date().toISOString()
        }
      };
    }
  }
  
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// PDF GENERATOR (HTML-based) WITH CONFIDENCE DISPLAY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Confidence badge HTML
 */
function getConfidenceBadge(confidence) {
  const badges = {
    high: { color: '#10b981', label: '✓ Ověřená data', bg: '#d1fae5' },
    medium: { color: '#f59e0b', label: '⚡ Odhad', bg: '#fef3c7' },
    low: { color: '#ef4444', label: '⚠️ Orientační', bg: '#fee2e2' },
    unknown: { color: '#6b7280', label: '? Neznámá kvalita', bg: '#f3f4f6' }
  };
  const badge = badges[confidence] || badges.unknown;
  return `<span style="background:${badge.bg};color:${badge.color};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;">${badge.label}</span>`;
}

/**
 * Generate PDF from artifact data
 * Uses HTML template converted to PDF via browser print
 * Returns HTML that can be rendered as PDF
 */
export function generatePdfHtml(artifactData, locale) {
  const { title, description, data, columns, notes, metadata = {} } = artifactData;
  
  // Auto-detect columns if not provided
  let cols = columns || (data.length > 0 ? Object.keys(data[0]) : []);
  
  // Reorder columns for better display (product first, prices middle, metadata last)
  const priorityOrder = ['produkt', 'gpu', 'cpu', 'nazev', 'name', 'specifikace', 'vram', 'cena_min', 'cena_max', 'cena', 'typ_ceny', 'jistota'];
  cols = cols.sort((a, b) => {
    const aIdx = priorityOrder.findIndex(p => a.toLowerCase().includes(p));
    const bIdx = priorityOrder.findIndex(p => b.toLowerCase().includes(p));
    if (aIdx === -1 && bIdx === -1) return 0;
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });
  
  const confidence = metadata.confidence || 'unknown';
  const source = metadata.source || 'neznámý';
  
  // Format cell value based on column type
  function formatCell(value, colName) {
    if (value === undefined || value === null) return '-';
    
    const col = colName.toLowerCase();
    
    // Price formatting
    if (col.includes('cena') || col.includes('price')) {
      if (typeof value === 'number') {
        return value.toLocaleString('cs-CZ').replace(/,/g, ' ') + ' Kč';
      }
    }
    
    // Typ ceny badge
    if (col === 'typ_ceny') {
      const badges = {
        'retail': '<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:4px;font-size:12px;">retail</span>',
        'bazar': '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:12px;">bazar</span>',
        'odhad': '<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:4px;font-size:12px;">odhad</span>'
      };
      return badges[value] || value;
    }
    
    // Jistota badge
    if (col === 'jistota') {
      const badges = {
        'high': '<span style="color:#065f46;">✓ vysoká</span>',
        'medium': '<span style="color:#92400e;">◐ střední</span>',
        'low': '<span style="color:#991b1b;">○ nízká</span>'
      };
      return badges[value] || value;
    }
    
    return escapeHtml(String(value));
  }
  
  // Check if we have separate min/max columns - merge them for display
  const hasMinMax = cols.includes('cena_min') && cols.includes('cena_max');
  let displayCols = [...cols];
  if (hasMinMax) {
    // Replace cena_min, cena_max with single "cena" column
    displayCols = displayCols.filter(c => c !== 'cena_min' && c !== 'cena_max');
    const insertIdx = displayCols.findIndex(c => c.toLowerCase().includes('typ')) || displayCols.length;
    displayCols.splice(insertIdx, 0, 'cena');
  }
  
  const html = `<!DOCTYPE html>
<html lang="${locale.locale}">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: 'Segoe UI', Arial, sans-serif; 
      padding: 40px;
      color: #1a1a2e;
      background: #fff;
    }
    .header { 
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 3px solid #4361ee;
    }
    h1 { 
      color: #4361ee;
      font-size: 28px;
      margin-bottom: 10px;
    }
    .description {
      color: #666;
      font-size: 14px;
      margin-bottom: 15px;
    }
    .meta {
      display: flex;
      gap: 15px;
      flex-wrap: wrap;
      align-items: center;
      font-size: 12px;
      color: #666;
    }
    .meta-item {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .confidence-banner {
      margin: 20px 0;
      padding: 15px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 15px;
    }
    .confidence-high { background: #d1fae5; border-left: 4px solid #10b981; }
    .confidence-medium { background: #fef3c7; border-left: 4px solid #f59e0b; }
    .confidence-low { background: #fee2e2; border-left: 4px solid #ef4444; }
    .confidence-unknown { background: #f3f4f6; border-left: 4px solid #6b7280; }
    table { 
      width: 100%; 
      border-collapse: collapse; 
      margin: 20px 0;
      font-size: 14px;
    }
    th { 
      background: #4361ee;
      color: white;
      padding: 12px 15px;
      text-align: left;
      font-weight: 600;
    }
    td { 
      padding: 12px 15px;
      border-bottom: 1px solid #e0e0e0;
    }
    tr:nth-child(even) { background: #f8f9fa; }
    tr:hover { background: #e8f4f8; }
    .price-cell {
      font-weight: 600;
      color: #1a1a2e;
      white-space: nowrap;
    }
    .notes {
      margin-top: 30px;
      padding: 15px;
      background: #f8fafc;
      border-left: 4px solid #64748b;
      font-size: 13px;
    }
    .notes h3 { 
      color: #475569;
      margin-bottom: 10px;
      font-size: 14px;
    }
    .notes ul { margin-left: 20px; }
    .notes li { margin: 5px 0; color: #666; }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
      font-size: 11px;
      color: #999;
      display: flex;
      justify-content: space-between;
    }
    @media print {
      body { padding: 20px; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(title)}</h1>
    ${description ? `<p class="description">${escapeHtml(description)}</p>` : ''}
    <div class="meta">
      <span class="meta-item">📅 ${new Date().toLocaleDateString(locale.locale)}</span>
      <span class="meta-item">💰 ${locale.currency}</span>
      <span class="meta-item">🌍 ${locale.region}</span>
      ${getConfidenceBadge(confidence)}
    </div>
  </div>
  
  <div class="confidence-banner confidence-${confidence}">
    <div>
      <strong>Kvalita dat:</strong> ${confidence === 'high' ? 'Ověřená data z důvěryhodných zdrojů' : 
        confidence === 'medium' ? 'Odhad na základě znalosti trhu - ceny se mohou lišit' :
        confidence === 'low' ? 'Orientační data - doporučujeme ověřit aktuální ceny' :
        'Kvalita dat nebyla ověřena'}
    </div>
    ${source !== 'unknown' ? `<div style="font-size:12px;color:#666;">Zdroj: ${escapeHtml(source)}</div>` : ''}
  </div>
  
  <table>
    <thead>
      <tr>
        ${displayCols.map(col => `<th>${escapeHtml(formatColumnName(col))}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${data.map(row => `
        <tr>
          ${displayCols.map(col => {
            // Handle merged price column
            if (col === 'cena' && hasMinMax) {
              const min = row.cena_min;
              const max = row.cena_max;
              if (min !== undefined && max !== undefined) {
                const minStr = typeof min === 'number' ? min.toLocaleString('cs-CZ').replace(/,/g, ' ') : min;
                const maxStr = typeof max === 'number' ? max.toLocaleString('cs-CZ').replace(/,/g, ' ') : max;
                return `<td class="price-cell">${minStr} - ${maxStr} Kč</td>`;
              }
            }
            return `<td>${formatCell(row[col], col)}</td>`;
          }).join('')}
        </tr>
      `).join('')}
    </tbody>
  </table>
  
  ${notes && notes.length > 0 ? `
    <div class="notes">
      <h3>📝 Poznámky</h3>
      <ul>
        ${notes.map(note => `<li>${escapeHtml(note)}</li>`).join('')}
      </ul>
    </div>
  ` : ''}
  
  <div class="footer">
    <span>Vygenerováno: p(AI)assistant v35.0.0</span>
    <span>${new Date().toLocaleString(locale.locale)}</span>
  </div>
</body>
</html>`;

  return html;
}

/**
 * Format column name for display
 */
function formatColumnName(col) {
  return col
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^\w/, c => c.toUpperCase())
    .trim();
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ════════════════════════════════════════════════════════════════════════════
// ARTIFACT FILE MANAGER WITH PDF SUPPORT
// ════════════════════════════════════════════════════════════════════════════

const ARTIFACTS_DIR = './data/artifacts';

// Check if puppeteer is available
let puppeteer = null;
try {
  puppeteer = await import('puppeteer');
  console.log('[Artifact] Puppeteer available - PDF generation enabled');
} catch (e) {
  console.log('[Artifact] Puppeteer not installed - using HTML fallback for PDF');
  console.log('[Artifact] To enable PDF: npm install puppeteer');
}

/**
 * Ensure artifacts directory exists
 */
export function ensureArtifactsDir() {
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }
}

/**
 * Generate actual PDF from HTML using puppeteer
 * @param {string} html - HTML content
 * @param {string} outputPath - Path to save PDF
 */
async function generatePdfFromHtml(html, outputPath) {
  if (!puppeteer) {
    return false;
  }
  
  try {
    const browser = await puppeteer.default.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    
    await page.pdf({
      path: outputPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        right: '20mm',
        bottom: '20mm',
        left: '20mm'
      }
    });
    
    await browser.close();
    return true;
  } catch (err) {
    console.error('[Artifact] PDF generation failed:', err.message);
    return false;
  }
}

/**
 * Save artifact and return metadata
 * @param {string} content - File content (HTML for PDF)
 * @param {string} type - File type (pdf, csv, etc.)
 * @param {string} title - Document title
 * @param {object} meta - Additional metadata
 */
export async function saveArtifact(content, type, title, meta = {}) {
  ensureArtifactsDir();
  
  // Generate filename
  const timestamp = Date.now();
  const safeName = title
    .toLowerCase()
    .replace(/[^a-z0-9áčďéěíňóřšťúůýž]+/gi, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
  
  let filename, filepath, actualType, mimeType;
  
  if (type === 'pdf') {
    // Try to generate actual PDF
    const pdfFilename = `${safeName}-${timestamp}.pdf`;
    const pdfPath = path.join(ARTIFACTS_DIR, pdfFilename);
    
    const pdfGenerated = await generatePdfFromHtml(content, pdfPath);
    
    if (pdfGenerated) {
      // PDF generated successfully
      filename = pdfFilename;
      filepath = pdfPath;
      actualType = 'pdf';
      mimeType = 'application/pdf';
      
      // Also save HTML as backup
      const htmlPath = path.join(ARTIFACTS_DIR, `${safeName}-${timestamp}.html`);
      fs.writeFileSync(htmlPath, content, 'utf-8');
    } else {
      // Fallback to HTML
      filename = `${safeName}-${timestamp}.html`;
      filepath = path.join(ARTIFACTS_DIR, filename);
      actualType = 'html';
      mimeType = 'text/html';
      fs.writeFileSync(filepath, content, 'utf-8');
    }
  } else {
    // Other types (csv, json, etc.)
    filename = `${safeName}-${timestamp}.${type}`;
    filepath = path.join(ARTIFACTS_DIR, filename);
    actualType = type;
    mimeType = type === 'csv' ? 'text/csv' : 
               type === 'json' ? 'application/json' : 
               'text/plain';
    fs.writeFileSync(filepath, content, 'utf-8');
  }
  
  // Create metadata file
  const metaFilepath = filepath + '.meta.json';
  const fullMeta = {
    id: timestamp.toString(),
    filename,
    title,
    requestedType: type,
    actualType,
    mimeType,
    size: fs.statSync(filepath).size,
    created: new Date().toISOString(),
    puppeteerAvailable: !!puppeteer,
    ...meta
  };
  fs.writeFileSync(metaFilepath, JSON.stringify(fullMeta, null, 2), 'utf-8');
  
  // Return metadata
  return {
    ...fullMeta,
    filepath,
    downloadUrl: `/api/artifacts/${filename}`,
    // Flag if PDF was requested but HTML delivered
    htmlFallback: type === 'pdf' && actualType === 'html'
  };
}

/**
 * Get artifact by filename
 */
export function getArtifact(filename) {
  const filepath = path.join(ARTIFACTS_DIR, filename);
  if (fs.existsSync(filepath)) {
    return {
      content: fs.readFileSync(filepath, 'utf-8'),
      filepath
    };
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN PIPELINE WITH DECISION LAYER
// ════════════════════════════════════════════════════════════════════════════

// Try to load data layer
let dataLayer = null;
try {
  dataLayer = await import('./data/index.js');
  console.log('[Artifact] Data layer loaded, domains:', dataLayer.getAvailableDomains());
} catch (err) {
  console.log('[Artifact] Data layer not available, using LLM-only mode');
}

/**
 * Execute artifact pipeline with Decision Layer
 * 
 * Flow:
 * 1. Classify intent (FILE_REQUEST, TABLE_REQUEST, etc.)
 * 2. Classify data problem type (price_range, specification, procedural, etc.)
 * 3. Determine strategy based on decision matrix
 * 4. Execute with appropriate tools (data layer / LLM)
 * 5. Apply confidence constraints
 * 
 * @param {string} message - User message
 * @param {object} settings - User settings (locale, etc.)
 * @param {function} llmCall - Function to call LLM
 * @returns {Promise<{success: boolean, artifact?: object, preview?: object, error?: string}>}
 */
export async function executeArtifactPipeline(message, settings, llmCall) {
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Classify task (intent)
  // ═══════════════════════════════════════════════════════════════════════════
  const task = classifyTask(message);
  
  if (task.type !== 'ARTIFACT') {
    return { success: false, error: 'Not an artifact request' };
  }
  
  // Get locale context
  const locale = getLocaleContext(settings);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Classify data problem type (DECISION LAYER)
  // ═══════════════════════════════════════════════════════════════════════════
  let problemType = 'procedural'; // Default
  let strategy = { useDataLayer: false, useWebSearch: false, llmMode: 'full', warnings: [] };
  let problemClassification = null;
  
  if (decisionLayer) {
    problemClassification = decisionLayer.classifyDataProblem(message, task.intent);
    problemType = problemClassification.type;
    
    console.log(`[Artifact] Problem type: ${problemType} (confidence: ${problemClassification.confidence})`);
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 2.5: Handle HYBRID tasks
    // ═══════════════════════════════════════════════════════════════════════════
    if (problemType === 'hybrid' && problemClassification.subtypes) {
      console.log(`[Artifact] Hybrid task detected, subtypes: ${problemClassification.subtypes.join(', ')}`);
      
      const hybridResult = decisionLayer.processHybridTask(
        message, 
        problemClassification,
        { dataLayer: dataLayer !== null, webSearch: false }
      );
      
      strategy.warnings.push(...hybridResult.warnings);
      
      // Use the dominant subtype's strategy
      if (hybridResult.strategies.length > 0) {
        const dominantSubtask = hybridResult.strategies[0];
        problemType = dominantSubtask.type;
        strategy = {
          ...dominantSubtask.strategy,
          warnings: [...strategy.warnings, ...dominantSubtask.strategy.warnings],
          isHybrid: true,
          subtasks: hybridResult.strategies
        };
        
        console.log(`[Artifact] Hybrid resolved to dominant type: ${problemType}`);
      }
    } else {
      // Determine strategy based on decision matrix
      strategy = decisionLayer.determineStrategy(problemType, {
        dataLayer: dataLayer !== null,
        webSearch: false // TODO: when web search is integrated
      });
    }
    
    console.log(`[Artifact] Strategy: dataLayer=${strategy.useDataLayer}, llmMode=${strategy.llmMode}`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2.6: Determine CONTENT REPRESENTATION
  // ═══════════════════════════════════════════════════════════════════════════
  let contentRepresentation = 'structured'; // Default
  let representationConstraints = {};
  
  if (decisionLayer) {
    // Check for explicit narrative request FIRST (overrides problem type)
    const isNarrative = decisionLayer.isNarrativeRequest(message);
    
    if (isNarrative) {
      contentRepresentation = decisionLayer.CONTENT_REPRESENTATION.NARRATIVE;
      console.log(`[Artifact] Narrative request detected - using narrative representation`);
    } else {
      contentRepresentation = decisionLayer.getContentRepresentation(problemType, task.artifactType);
    }
    
    representationConstraints = decisionLayer.getRepresentationConstraints(contentRepresentation);
    console.log(`[Artifact] Representation: ${contentRepresentation}, allowTables=${representationConstraints.allowTables}`);
  }
  
  // Track what we used
  let usedDataLayer = false;
  let dataLayerResult = null;
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Try DATA LAYER (if strategy says so)
  // ═══════════════════════════════════════════════════════════════════════════
  if (strategy.useDataLayer && dataLayer) {
    try {
      dataLayerResult = await dataLayer.fetchDomainData(message, locale);
      
      if (dataLayerResult && dataLayerResult.items && dataLayerResult.items.length > 0) {
        console.log(`[Artifact] Data layer returned ${dataLayerResult.items.length} items`);
        usedDataLayer = true;
        
        // Generate title and description via LLM (lightweight, using data-provided context)
        let title, description;
        try {
          const metaPrompt = buildArtifactPrompt(task, locale, {
            problemType,
            hasDataSource: true,
            llmMode: 'low'
          });
          
          const metaResponse = await llmCall(
            `Pro tato data vygeneruj krátký název (max 50 znaků) a popis (max 100 znaků) v češtině.
Data (ukázka): ${dataLayerResult.items.slice(0, 3).map(i => JSON.stringify(i)).join(', ')}
Celkem položek: ${dataLayerResult.items.length}
Zdroj: ${dataLayerResult.source}
Odpověz POUZE JSON: {"title": "...", "description": "..."}`,
            'Jsi asistent pro generování titulků. Odpovídej POUZE validním JSON.',
            { temperature: 0.3, max_tokens: 100 }
          );
          
          const metaMatch = metaResponse.content.match(/\{[\s\S]*\}/);
          if (metaMatch) {
            const meta = JSON.parse(metaMatch[0]);
            title = meta.title;
            description = meta.description;
          }
        } catch (e) {
          console.warn('[Artifact] Meta generation failed, using defaults');
        }
        
        // Fallback titles
        if (!title) {
          title = task.topic ? `Přehled: ${task.topic}` : 'Datový přehled';
        }
        if (!description) {
          description = `${dataLayerResult.items.length} položek z ${dataLayerResult.source}`;
        }
        
        // Convert to artifact format
        const artifactData = dataLayer.dataResultToArtifact(dataLayerResult, title, description);
        
        // Apply confidence constraints from decision layer
        let constrainedData = artifactData;
        if (decisionLayer) {
          const constraints = decisionLayer.applyConfidenceConstraints(
            artifactData, 
            dataLayerResult.confidence, 
            problemType
          );
          constrainedData = constraints.data;
          strategy.warnings.push(...constraints.warnings);
        }
        
        // Normalize data
        const normalizedData = normalizeArtifactData(constrainedData, locale);
        
        // Add warnings to notes
        if (strategy.warnings.length > 0) {
          normalizedData.notes = [...(normalizedData.notes || []), ...strategy.warnings];
        }
        
        // Generate and save artifact
        return generateAndSaveArtifact(normalizedData, task, locale);
      }
    } catch (err) {
      console.warn(`[Artifact] Data layer failed: ${err.message}`);
      strategy.warnings.push(decisionLayer?.buildFailureMessage('no_data_source') || 'Data source unavailable');
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: FALLBACK TO LLM (if data layer not used or failed)
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`[Artifact] Using LLM mode (${strategy.llmMode}), representation: ${contentRepresentation}`);
  
  // Build DYNAMIC prompt based on decision context AND representation
  const systemPrompt = buildArtifactPrompt(task, locale, {
    problemType,
    hasDataSource: false,
    llmMode: strategy.llmMode,
    representation: contentRepresentation  // Pass representation mode
  });
  
  // User prompt varies by representation and problem type
  let userPrompt;
  
  if (contentRepresentation === 'narrative') {
    // Narrative mode - story/essay request
    userPrompt = `Napiš: ${task.topic || message}

Požadovaný formát: ${task.artifactType}
Jazyk: ${locale.language}

Vytvoř poutavý text s přirozeným vyprávěním.`;
  } else if (contentRepresentation === 'structured') {
    // Structured mode - sections with text
    userPrompt = `Vytvoř strukturovaný dokument: ${task.topic || message}

Rozděl do logických sekcí s nadpisy.
Piš v odstavcích, ne v bodech.`;
  } else if (problemType === 'price_range') {
    userPrompt = `Generate data for: ${task.topic || message}

IMPORTANT - Toto je cenový dotaz BEZ ověřeného zdroje dat:
- Všechny ceny jsou ODHADY
- Použij ROZMEZÍ (cena_min, cena_max)
- Nastav jistota: "low"
- Nastav typ_ceny: "odhad"
- Buď KONZERVATIVNÍ

Market: ${locale.region}
Currency: ${locale.currency}`;
  } else if (problemType === 'specification') {
    userPrompt = `Generate data for: ${task.topic || message}

Generuj technické specifikace na základě svých znalostí.
Pro ověřitelná fakta použij jistota: "medium" nebo "high".`;
  } else {
    userPrompt = `Generate data for: ${task.topic || message}

Použij své znalosti. Buď upřímný ohledně jistoty dat.
Market: ${locale.region}, Currency: ${locale.currency}`;
  }
  
  // Call LLM
  let llmResponse;
  try {
    llmResponse = await llmCall(userPrompt, systemPrompt, {
      temperature: contentRepresentation === 'narrative' ? 0.7 : (strategy.llmMode === 'low' ? 0.2 : 0.4),
      top_p: 0.9
    });
  } catch (err) {
    return {
      success: false,
      error: `LLM call failed: ${err.message}`
    };
  }
  
  // Parse response - different for narrative vs data
  let parsed;
  if (contentRepresentation === 'narrative' || contentRepresentation === 'structured') {
    // Parse narrative/structured response
    parsed = parseNarrativeResponse(llmResponse.content, contentRepresentation);
  } else {
    // Parse data/report response (original)
    parsed = parseArtifactResponse(llmResponse.content, locale);
  }
  
  // Handle different outcomes
  if (parsed.success) {
    // Skip data constraints for narrative content
    let constrainedData = parsed.data;
    
    if (contentRepresentation !== 'narrative' && contentRepresentation !== 'structured') {
      if (decisionLayer && problemType === 'price_range') {
        // For price queries without data source, force low confidence
        const constraints = decisionLayer.applyConfidenceConstraints(
          parsed.data, 
          'low', // Force low since no verified source
          problemType
        );
        constrainedData = constraints.data;
        strategy.warnings.push(...constraints.warnings);
      }
      
      // Apply consensus constraints (no numeric aggregation)
      if (decisionLayer && problemType === 'consensus') {
        const consensusCheck = decisionLayer.applyConsensusConstraints(constrainedData);
        if (consensusCheck.hasViolations) {
          strategy.warnings.push(...consensusCheck.warnings);
          console.warn('[Artifact] Consensus violations:', consensusCheck.warnings);
        }
      }
      
      // Normalize
      constrainedData = normalizeArtifactData(constrainedData, locale);
      
      // Add failure mode warning if no data source was used for price query
      if (problemType === 'price_range' && !usedDataLayer) {
        constrainedData.notes = [
          ...(constrainedData.notes || []),
          decisionLayer?.buildFailureMessage('estimate_only') || 'Ceny jsou orientační odhady',
          ...strategy.warnings
        ];
      }
      
      // Add warnings for other problem types
      if (strategy.warnings.length > 0 && problemType !== 'price_range') {
        constrainedData.notes = [
          ...(constrainedData.notes || []),
          ...strategy.warnings
        ];
      }
    }
    
    // Pass representation to artifact generator
    return generateAndSaveArtifact(constrainedData, task, locale, {
      representation: contentRepresentation,
      constraints: representationConstraints
    });
  } else if (parsed.partial && parsed.fallback) {
    // Partial success
    console.warn('Artifact: Using fallback extraction');
    const result = await generateAndSaveArtifact(parsed.fallback, task, locale);
    result.warning = 'Data extrahována z nestrukturované odpovědi.';
    result.canRetry = true;
    return result;
  } else {
    // Complete failure
    return {
      success: false,
      error: parsed.error,
      raw: parsed.raw,
      canRetry: true,
      suggestion: 'Zkuste upřesnit požadavek nebo zjednodušit dotaz.'
    };
  }
}

/**
 * Generate and save artifact file
 * @param {object} data - Artifact data
 * @param {object} task - Task info
 * @param {object} locale - Locale settings
 * @param {object} options - { representation, constraints }
 */
async function generateAndSaveArtifact(data, task, locale, options = {}) {
  const { representation = 'report', constraints = {} } = options;
  
  // Generate file content based on representation
  let fileContent;
  
  if (representation === 'narrative') {
    // Narrative content - prose, no tables
    fileContent = generateNarrativeHtml(data, locale);
  } else if (representation === 'structured') {
    // Structured content - sections with headers
    fileContent = generateStructuredHtml(data, locale);
  } else if (task.artifactType === 'pdf' || task.artifactType === 'docx' || task.artifactType === 'html') {
    // Report mode (default) - tables with metadata
    fileContent = generatePdfHtml(data, locale);
  } else if (task.artifactType === 'csv') {
    fileContent = generateCsv(data);
  } else if (task.artifactType === 'xlsx') {
    // For now, use CSV (xlsx requires external lib)
    fileContent = generateCsv(data);
    task.artifactType = 'csv'; // Fallback
  } else {
    fileContent = generatePdfHtml(data, locale);
  }
  
  // Save artifact with full metadata (now async for PDF generation)
  const artifact = await saveArtifact(fileContent, task.artifactType, data.title, {
    locale: locale.locale,
    currency: representation === 'narrative' ? null : locale.currency,
    region: representation === 'narrative' ? null : locale.region,
    confidence: representation === 'narrative' ? null : (data.metadata?.confidence || 'unknown'),
    intent: task.intent,
    representation,
    rowCount: data.data?.length || 0,
    wordCount: data.content ? data.content.split(/\s+/).length : 0
  });
  
  return {
    success: true,
    artifact,
    data,
    metadata: data.metadata,
    htmlFallback: artifact.htmlFallback
  };
}

/**
 * Generate HTML for NARRATIVE content (story, essay)
 * NO tables, NO metadata banners, NO confidence badges
 */
function generateNarrativeHtml(data, locale) {
  const content = data.content || '';
  
  // Convert newlines to paragraphs
  const paragraphs = content
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
    .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  
  return `<!DOCTYPE html>
<html lang="${locale.language || 'cs'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(data.title)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Merriweather:ital,wght@0,400;0,700;1,400&display=swap');
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: 'Merriweather', Georgia, serif;
      line-height: 1.8;
      max-width: 700px;
      margin: 0 auto;
      padding: 60px 40px;
      color: #2d3748;
      background: #fff;
    }
    
    h1 {
      font-size: 2.2em;
      font-weight: 700;
      margin-bottom: 40px;
      text-align: center;
      color: #1a202c;
    }
    
    p {
      margin-bottom: 1.5em;
      text-align: justify;
      text-indent: 1.5em;
    }
    
    p:first-of-type {
      text-indent: 0;
    }
    
    p:first-of-type::first-letter {
      font-size: 3em;
      float: left;
      line-height: 1;
      padding-right: 8px;
      font-weight: 700;
    }
    
    @media print {
      body { padding: 40px 60px; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(data.title)}</h1>
  ${paragraphs}
</body>
</html>`;
}

/**
 * Generate HTML for STRUCTURED content (articles, guides)
 * Sections with headers, prose content, NO tables
 */
function generateStructuredHtml(data, locale) {
  const sections = data.sections || [];
  
  const sectionsHtml = sections.map(section => {
    const heading = section.heading || section.title || '';
    const content = section.content || section.text || '';
    
    const paragraphs = content
      .split(/\n\n+/)
      .map(p => p.trim())
      .filter(p => p.length > 0)
      .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('\n');
    
    return `
      ${heading ? `<h2>${escapeHtml(heading)}</h2>` : ''}
      ${paragraphs}
    `;
  }).join('\n');
  
  return `<!DOCTYPE html>
<html lang="${locale.language || 'cs'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(data.title)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap');
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      line-height: 1.7;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 30px;
      color: #374151;
      background: #fff;
    }
    
    h1 {
      font-size: 2em;
      font-weight: 600;
      margin-bottom: 30px;
      color: #111827;
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 15px;
    }
    
    h2 {
      font-size: 1.4em;
      font-weight: 600;
      margin: 30px 0 15px 0;
      color: #1f2937;
    }
    
    p {
      margin-bottom: 1.2em;
    }
    
    @media print {
      body { padding: 30px 50px; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(data.title)}</h1>
  ${sectionsHtml}
</body>
</html>`;
}

/**
 * Generate CSV content
 */
function generateCsv(artifactData) {
  const { data, columns } = artifactData;
  const cols = columns || (data.length > 0 ? Object.keys(data[0]) : []);
  
  const header = cols.join(',');
  const rows = data.map(row => 
    cols.map(col => {
      const val = String(row[col] || '');
      // Escape quotes and wrap in quotes if contains comma
      if (val.includes(',') || val.includes('"')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    }).join(',')
  );
  
  return [header, ...rows].join('\n');
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  // Intent classifier v2
  INTENT,
  classifyIntent,
  classifyTask,  // Legacy backward compat
  
  // Locale
  getLocaleContext,
  buildLocaleRules,
  
  // Artifact generation
  buildArtifactPrompt,
  parseArtifactResponse,
  generatePdfHtml,
  saveArtifact,
  getArtifact,
  executeArtifactPipeline,
  
  // Data confidence
  DATA_CONFIDENCE
};
