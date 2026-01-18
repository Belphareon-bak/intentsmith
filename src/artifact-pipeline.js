// C.3 v34.3.2.1 - Artifact Pipeline
// ══════════════════════════════════════════════════════════════════════════════
// Handles artifact generation with HARD validation + graceful degradation
// v2: Semantic intent classifier (hybrid: heuristic + LLM)

import fs from 'fs';
import path from 'path';

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
 * Build system prompt for artifact generation with data confidence contract
 */
export function buildArtifactPrompt(task, locale) {
  const localeRules = buildLocaleRules(locale);
  
  return `ROLE: You are a DATA EXTRACTION and FORMATTING assistant.
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
    "price_type": "retail|used|estimate|range",
    "market": "${locale.region}",
    "source": "description of data source or 'heuristic'",
    "generated_at": "auto-filled"
  }
}

DATA COVERAGE RULES (MANDATORY):
When generating product/item lists, you MUST cover:
1. LATEST GENERATION - Always include the newest available products (e.g., RTX 50xx if exists)
2. CURRENT MAINSTREAM - Products actively sold in retail (e.g., RTX 40xx)
3. PREVIOUS GENERATION - Used/second-hand options (e.g., RTX 30xx)

If uncertain about newest products:
- STILL include them with "odhad" or "nízká jistota" note
- Set confidence to "low" for those items
- Add explanatory note like "RTX 50xx - ceny jsou předběžné odhady"

NEVER omit an entire product generation just because you're uncertain about prices!

DATA CONFIDENCE RULES:
- "high": Only if data is from known, reliable source (official specs, verified prices)
- "medium": Estimated data based on market knowledge (typical for prices)
- "low": Example/placeholder data when real data unavailable

PRICE RULES:
- For current products: use "retail" with price range (min-max)
- For older/used products: use "used" or "range" with bazaar prices
- ALWAYS show ranges, never single exact prices
- Format: "15 000 - 18 000 ${locale.currencySymbol}" (with spaces in thousands)

IMPORTANT:
1. ONLY output the JSON structure above - no markdown, no explanation
2. Include BOTH new and used options where applicable
3. Be HONEST about data confidence - don't pretend certainty
4. If you're estimating, say so in notes
5. Prices MUST be in ${locale.currency} for ${locale.region} market

CRITICAL: Your response will be parsed as JSON. Any text outside the JSON will cause failure.`;
}

// ════════════════════════════════════════════════════════════════════════════
// RESPONSE PARSER & VALIDATOR WITH GRACEFUL DEGRADATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Parse LLM response and extract JSON data
 * Returns partial data for graceful degradation if full parse fails
 */
export function parseArtifactResponse(response) {
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
    
    return {
      success: true,
      data
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
  const cols = columns || (data.length > 0 ? Object.keys(data[0]) : []);
  
  const confidence = metadata.confidence || 'unknown';
  const priceType = metadata.price_type || 'unknown';
  const source = metadata.source || 'neznámý';
  
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
        ${cols.map(col => `<th>${escapeHtml(formatColumnName(col))}</th>`).join('')}
      </tr>
    </thead>
    <tbody>
      ${data.map(row => `
        <tr>
          ${cols.map(col => `<td>${escapeHtml(String(row[col] || '-'))}</td>`).join('')}
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
    <span>Vygenerováno: p(AI)assistant v34.3.2</span>
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
// MAIN PIPELINE WITH GRACEFUL DEGRADATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Execute artifact pipeline
 * @param {string} message - User message
 * @param {object} settings - User settings (locale, etc.)
 * @param {function} llmCall - Function to call LLM
 * @returns {Promise<{success: boolean, artifact?: object, preview?: object, error?: string}>}
 */
export async function executeArtifactPipeline(message, settings, llmCall) {
  // 1. Classify task with intent detection
  const task = classifyTask(message);
  
  if (task.type !== 'ARTIFACT') {
    return { success: false, error: 'Not an artifact request' };
  }
  
  // 2. Get locale context
  const locale = getLocaleContext(settings);
  
  // 3. Build prompt
  const systemPrompt = buildArtifactPrompt(task, locale);
  const userPrompt = `Generate data for: ${task.topic || message}

Remember:
- Include CURRENT products (2024-2025) as "new"
- Include OLDER products as "used/bazaar" with price ranges
- All prices in ${locale.currency} for ${locale.region} market
- Be honest about data confidence`;
  
  // 4. Call LLM
  let llmResponse;
  try {
    llmResponse = await llmCall(userPrompt, systemPrompt, {
      temperature: 0.3,
      top_p: 0.9
    });
  } catch (err) {
    return {
      success: false,
      error: `LLM call failed: ${err.message}`
    };
  }
  
  // 5. Parse response (with graceful degradation)
  const parsed = parseArtifactResponse(llmResponse.content);
  
  // 6. Handle different outcomes
  if (parsed.success) {
    // Full success - generate artifact
    return generateAndSaveArtifact(parsed.data, task, locale);
  } else if (parsed.partial && parsed.fallback) {
    // Partial success - use fallback data with warning
    console.warn('Artifact: Using fallback extraction');
    const result = await generateAndSaveArtifact(parsed.fallback, task, locale);
    result.warning = 'Data extrahována z nestrukturované odpovědi. Doporučujeme zkusit znovu.';
    result.canRetry = true;
    return result;
  } else {
    // Complete failure - return error with preview if possible
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
 */
async function generateAndSaveArtifact(data, task, locale) {
  // Generate file content
  let fileContent;
  if (task.artifactType === 'pdf') {
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
    currency: locale.currency,
    region: locale.region,
    confidence: data.metadata?.confidence || 'unknown',
    intent: task.intent,
    rowCount: data.data?.length || 0
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
