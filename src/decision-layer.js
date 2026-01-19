// C.3 v34.4 - Decision Layer
// ══════════════════════════════════════════════════════════════════════════════
// Rozhodovací vrstva: Jaký typ problému řešíme? Jaká pravidla platí?
// 
// KLÍČOVÝ PRINCIP:
// Neopravuj data. Oprav rozhodování o datech.
// Jakmile C3 ví, jaký typ problému řeší, zbytek už umí.

/**
 * Typy datových problémů
 * Každý typ má jiná pravidla pro data layer, web search a LLM
 */
export const DATA_PROBLEM_TYPES = {
  PRICE_RANGE: 'price_range',       // Ceny, cenová rozmezí, srovnání cen
  SPECIFICATION: 'specification',    // Technické specifikace, parametry
  AVAILABILITY: 'availability',      // Dostupnost, kde koupit, skladem
  CONSENSUS: 'consensus',            // Názory, recenze, "co je lepší"
  PROCEDURAL: 'procedural',          // Návody, jak na to, postupy
  HYBRID: 'hybrid'                   // Kombinace více typů
};

/**
 * Content Representation types
 * Určuje JAK se obsah zobrazí (nezávisle na tom, jak se získal)
 */
export const CONTENT_REPRESENTATION = {
  NARRATIVE: 'narrative',     // Příběh, text, esej, povídka - žádné tabulky/metadata
  STRUCTURED: 'structured',   // Sekce s nadpisy, ale textově (návody, články)
  TABULAR: 'tabular',         // Tabulková data bez meta-headeru
  REPORT: 'report'            // Tabulka + metadata + confidence badges
};

/**
 * Map problem type to content representation
 * DETERMINISTICKÉ - žádné LLM rozhodování
 */
export function getContentRepresentation(problemType, artifactType = null) {
  // Special case: explicit narrative request (story, book, etc.)
  // This is checked first because it overrides problem type
  
  switch (problemType) {
    case DATA_PROBLEM_TYPES.PROCEDURAL:
      return CONTENT_REPRESENTATION.STRUCTURED; // Default for procedural
      
    case DATA_PROBLEM_TYPES.CONSENSUS:
      return CONTENT_REPRESENTATION.STRUCTURED;
      
    case DATA_PROBLEM_TYPES.PRICE_RANGE:
    case DATA_PROBLEM_TYPES.AVAILABILITY:
    case DATA_PROBLEM_TYPES.SPECIFICATION:
      return CONTENT_REPRESENTATION.REPORT;
      
    case DATA_PROBLEM_TYPES.HYBRID:
      return CONTENT_REPRESENTATION.STRUCTURED; // Safe default
      
    default:
      return CONTENT_REPRESENTATION.STRUCTURED;
  }
}

/**
 * Detect if request is for narrative content (story, book, essay)
 * This OVERRIDES the problem type representation
 */
export function isNarrativeRequest(message) {
  const narrativePatterns = [
    /povídka|povídku|příběh|příběhu/i,
    /kniha|knihu|knížka|knížku/i,
    /esej|essay/i,
    /román|novela/i,
    /vyprávění|vyprávěj/i,
    /story|tale|narrative/i,
    /napsat.*text|text.*napsat/i,
    /kreativní.*psaní|creative.*writing/i,
    /fikce|fiction/i,
    /báseň|poem/i
  ];
  
  return narrativePatterns.some(p => p.test(message));
}

/**
 * Get representation constraints
 * Defines what IS and ISN'T allowed for each representation type
 */
export function getRepresentationConstraints(representation) {
  switch (representation) {
    case CONTENT_REPRESENTATION.NARRATIVE:
      return {
        allowTables: false,
        allowMetaHeader: false,
        allowConfidenceBadges: false,
        allowCurrencyInfo: false,
        allowDataQualityBanner: false,
        requireProse: true,
        format: 'continuous_text'
      };
      
    case CONTENT_REPRESENTATION.STRUCTURED:
      return {
        allowTables: false,      // Prefer text with sections
        allowMetaHeader: false,
        allowConfidenceBadges: false,
        allowCurrencyInfo: false,
        allowDataQualityBanner: false,
        requireProse: true,
        format: 'sections_with_headers'
      };
      
    case CONTENT_REPRESENTATION.TABULAR:
      return {
        allowTables: true,
        allowMetaHeader: false,
        allowConfidenceBadges: false,
        allowCurrencyInfo: true,
        allowDataQualityBanner: false,
        requireProse: false,
        format: 'table_only'
      };
      
    case CONTENT_REPRESENTATION.REPORT:
      return {
        allowTables: true,
        allowMetaHeader: true,
        allowConfidenceBadges: true,
        allowCurrencyInfo: true,
        allowDataQualityBanner: true,
        requireProse: false,
        format: 'full_report'
      };
      
    default:
      return getRepresentationConstraints(CONTENT_REPRESENTATION.STRUCTURED);
  }
}

/**
 * Confidence levels s reálným dopadem na chování
 */
export const CONFIDENCE_LEVELS = {
  HIGH: 'high',       // Ověřená data → povolena konkrétní tvrzení
  MEDIUM: 'medium',   // Odhad → jen intervaly, žádné přesné hodnoty
  LOW: 'low'          // Orientační → zákaz přesných čísel, povinná poznámka
};

/**
 * Decision Matrix
 * Definuje pravidla pro každý typ datového problému
 */
export const DECISION_MATRIX = {
  [DATA_PROBLEM_TYPES.PRICE_RANGE]: {
    dataLayer: 'required_if_exists',  // Povinný pokud existuje pro doménu
    webSearch: 'evidence',            // Web search jen jako evidence
    llmFreedom: 'low',                // LLM nesmí vymýšlet ceny
    outputConstraints: {
      requireInterval: true,          // Musí být rozmezí, ne přesná cena
      requireTypCeny: true,           // Musí být typ (retail/bazar/odhad)
      requireConfidence: true,        // Musí být jistota
      maxConfidenceWithoutSource: 'low'  // Bez zdroje max low confidence
    }
  },
  
  [DATA_PROBLEM_TYPES.SPECIFICATION]: {
    dataLayer: 'optional',            // Volitelný
    webSearch: 'forbidden',           // Specifikace se nemění, web zbytečný
    llmFreedom: 'medium',             // LLM může použít training data
    outputConstraints: {
      requireInterval: false,
      requireTypCeny: false,
      requireConfidence: false,
      maxConfidenceWithoutSource: 'medium'
    }
  },
  
  [DATA_PROBLEM_TYPES.AVAILABILITY]: {
    dataLayer: 'forbidden',           // Data layer nemá aktuální dostupnost
    evidenceLayer: 'required',        // Evidence (web/cache) POVINNÁ
    webSearch: 'required',            // Web search povinný pro čerstvá data
    llmFreedom: 'low',                // LLM nesmí hádat dostupnost
    outputConstraints: {
      requireFreshness: true,         // Musí být čerstvé (max 24h)
      requireSource: true,            // Musí být uveden zdroj
      requireTimestamp: true,         // Musí být časové razítko
      maxConfidenceWithoutSource: 'low',
      maxAgeHours: 24                 // Data starší než 24h = neplatná
    }
  },
  
  [DATA_PROBLEM_TYPES.CONSENSUS]: {
    dataLayer: 'forbidden',           // Názory nejsou v data layer
    webSearch: 'required',            // Web search povinný pro zdroje
    llmFreedom: 'high',               // LLM může syntetizovat názory
    outputConstraints: {
      requireMultipleSources: true,   // Alespoň 2-3 zdroje
      requireBalancedView: true,      // Vyvážený pohled
      noNumericResolution: true,      // ZÁKAZ numerické agregace (žádné "průměrně 4.5/5")
      preservePlurality: true,        // Zachovat různé názory
      maxConfidenceWithoutSource: 'medium'
    }
  },
  
  [DATA_PROBLEM_TYPES.PROCEDURAL]: {
    dataLayer: 'forbidden',           // Postupy nejsou v data layer
    webSearch: 'forbidden',           // LLM to umí samo
    llmFreedom: 'full',               // Plná svoboda
    outputConstraints: {
      maxConfidenceWithoutSource: 'high'  // LLM ví jak na to
    }
  },
  
  [DATA_PROBLEM_TYPES.HYBRID]: {
    dataLayer: 'per_subtask',         // Dle subtasků
    webSearch: 'per_subtask',         // Dle subtasků
    llmFreedom: 'controlled',         // Řízená svoboda
    outputConstraints: {
      requireSubtaskClassification: true,
      processSubtasksIndependently: true
    }
  }
};

/**
 * Patterns pro detekci typu datového problému
 */
const PROBLEM_PATTERNS = {
  [DATA_PROBLEM_TYPES.PRICE_RANGE]: [
    /cen[auy]|price|stoj[íi]|kolik|kč|czk|eur|\bkoupit\b/i,
    /levn[ěý]|drah[ýé]|rozpočet|budget/i,
    /srovn[áa]n[íi].*cen|porovn[áa]n[íi].*cen/i,
    /kolik stoj[íi]|za kolik|cena.*je/i
  ],
  
  [DATA_PROBLEM_TYPES.SPECIFICATION]: [
    /specifikace|parametr[yů]|technick[áéý]/i,
    /kolik.*gb|kolik.*ghz|jaký.*procesor/i,
    /rozměr[yů]|hmotnost|váha|výkon.*\bw\b/i,
    /jaké.*má.*vlastnosti/i
  ],
  
  [DATA_PROBLEM_TYPES.AVAILABILITY]: [
    /kde.*koupit|kde.*sehnat|kde.*k dostání/i,
    /dostupn[ýéá]|skladem|na sklade/i,
    /kdy.*vyjde|kdy.*bude|release|datum.*vydání/i,
    /objednávka|předobjednávka|preorder/i
  ],
  
  [DATA_PROBLEM_TYPES.CONSENSUS]: [
    /co.*je.*lepší|který.*je.*lepší|jaký.*doporuč/i,
    /recenz[ei]|hodnocení|názor[yů]/i,
    /zkušenost[i]|experience|review/i,
    /vyplatí.*se|stojí.*za.*to/i
  ],
  
  [DATA_PROBLEM_TYPES.PROCEDURAL]: [
    /jak.*na.*to|jak.*udělat|jak.*vytvořit/i,
    /návod|tutorial|postup|guide/i,
    /krok.*za.*krokem|step.*by.*step/i,
    /nainstalovat|nastavit|nakonfigurovat/i,
    /vysvětli|popiš.*jak|ukaž.*jak/i
  ]
};

/**
 * Classify data problem type from user message
 * @param {string} message - User message
 * @param {string} [intent] - Already classified intent (FILE_REQUEST, etc.)
 * @returns {{type: string, confidence: number, subtypes?: string[]}}
 */
export function classifyDataProblem(message, intent = null) {
  const scores = {};
  const lower = message.toLowerCase();
  
  // Score each problem type
  for (const [type, patterns] of Object.entries(PROBLEM_PATTERNS)) {
    scores[type] = 0;
    for (const pattern of patterns) {
      if (pattern.test(lower)) {
        scores[type]++;
      }
    }
  }
  
  // Find best match
  let bestType = DATA_PROBLEM_TYPES.PROCEDURAL; // Default
  let bestScore = 0;
  let totalScore = 0;
  
  for (const [type, score] of Object.entries(scores)) {
    totalScore += score;
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }
  
  // Check for hybrid (multiple types with similar scores)
  const highScoreTypes = Object.entries(scores)
    .filter(([_, score]) => score > 0 && score >= bestScore * 0.7)
    .map(([type, _]) => type);
  
  if (highScoreTypes.length > 1) {
    return {
      type: DATA_PROBLEM_TYPES.HYBRID,
      confidence: bestScore > 0 ? Math.min(0.8, bestScore / 3) : 0.3,
      subtypes: highScoreTypes
    };
  }
  
  // Adjust based on intent
  if (intent === 'FILE_REQUEST' || intent === 'TABLE_REQUEST') {
    // File/table requests are more likely price_range or specification
    if (bestType === DATA_PROBLEM_TYPES.PROCEDURAL && bestScore === 0) {
      bestType = DATA_PROBLEM_TYPES.PRICE_RANGE;
    }
  }
  
  return {
    type: bestType,
    confidence: bestScore > 0 ? Math.min(0.95, 0.5 + bestScore * 0.15) : 0.3,
    subtypes: null
  };
}

/**
 * Get decision rules for a data problem type
 * @param {string} problemType
 * @returns {object} Decision rules from matrix
 */
export function getDecisionRules(problemType) {
  return DECISION_MATRIX[problemType] || DECISION_MATRIX[DATA_PROBLEM_TYPES.PROCEDURAL];
}

/**
 * Determine what tools/sources to use based on problem type and available resources
 * @param {string} problemType
 * @param {object} available - { dataLayer: boolean, webSearch: boolean }
 * @returns {{useDataLayer: boolean, useWebSearch: boolean, llmMode: string, warnings: string[]}}
 */
export function determineStrategy(problemType, available = {}) {
  const rules = getDecisionRules(problemType);
  const warnings = [];
  
  let useDataLayer = false;
  let useWebSearch = false;
  let llmMode = rules.llmFreedom;
  
  // Data Layer decision
  switch (rules.dataLayer) {
    case 'required_if_exists':
      useDataLayer = available.dataLayer === true;
      if (!useDataLayer && problemType === DATA_PROBLEM_TYPES.PRICE_RANGE) {
        warnings.push('Data layer nedostupný - ceny budou odhadované');
        llmMode = 'medium'; // Upgrade LLM freedom since no data layer
      }
      break;
    case 'optional':
      useDataLayer = available.dataLayer === true;
      break;
    case 'forbidden':
    case 'per_subtask':
      useDataLayer = false;
      break;
  }
  
  // Web Search decision
  switch (rules.webSearch) {
    case 'required':
      useWebSearch = available.webSearch === true;
      if (!useWebSearch) {
        warnings.push('Web search nedostupný - odpověď může být neaktuální');
      }
      break;
    case 'evidence':
      useWebSearch = available.webSearch === true; // Use if available, not critical
      break;
    case 'forbidden':
    case 'per_subtask':
      useWebSearch = false;
      break;
  }
  
  return {
    useDataLayer,
    useWebSearch,
    llmMode,
    warnings,
    rules
  };
}

/**
 * Confidence Engine - Apply constraints based on confidence level
 * @param {object} data - Artifact data
 * @param {string} confidence - Confidence level
 * @param {string} problemType - Type of data problem
 * @returns {{data: object, warnings: string[], blocked: string[]}}
 */
export function applyConfidenceConstraints(data, confidence, problemType) {
  const rules = getDecisionRules(problemType);
  const warnings = [];
  const blocked = [];
  
  // Clone data
  const constrainedData = JSON.parse(JSON.stringify(data));
  
  if (confidence === CONFIDENCE_LEVELS.LOW) {
    // LOW: Zákaz přesných čísel
    if (rules.outputConstraints?.requireInterval) {
      // Check if any item has exact price instead of range
      constrainedData.data?.forEach(item => {
        if (item.cena && !item.cena_min && !item.cena_max) {
          blocked.push(`Přesná cena "${item.cena}" blokována - nízká jistota`);
          delete item.cena;
        }
      });
    }
    
    // Add mandatory warning
    warnings.push('⚠️ Orientační data - doporučujeme ověřit aktuální informace');
  }
  
  if (confidence === CONFIDENCE_LEVELS.MEDIUM) {
    // MEDIUM: Jen intervaly
    if (rules.outputConstraints?.requireInterval) {
      constrainedData.data?.forEach(item => {
        // Ensure ranges, not exact values
        if (item.cena_min === item.cena_max && item.cena_min) {
          // Expand to 10% range
          const value = item.cena_min;
          item.cena_min = Math.round(value * 0.95);
          item.cena_max = Math.round(value * 1.05);
        }
      });
    }
  }
  
  // HIGH: No additional constraints
  
  return {
    data: constrainedData,
    warnings,
    blocked
  };
}

/**
 * Evidence Object structure for web search results
 * LLM nesmí tyto objekty měnit, jen je interpretuje
 */
export function createEvidenceObject(webResult) {
  return {
    source_type: detectSourceType(webResult.url),
    source_url: webResult.url,
    source_title: webResult.title,
    published_at: webResult.date || null,
    age_days: webResult.date ? daysSince(webResult.date) : null,
    claim_type: detectClaimType(webResult.content),
    value: webResult.snippet || webResult.content?.substring(0, 200),
    credibility: assessCredibility(webResult)
  };
}

function detectSourceType(url) {
  if (!url) return 'unknown';
  const lower = url.toLowerCase();
  
  if (/alza|czc|mall|datart|electroworld/i.test(lower)) return 'retail';
  if (/bazos|sbazar|aukro/i.test(lower)) return 'bazar';
  if (/forum|reddit|diskuze/i.test(lower)) return 'forum';
  if (/blog|medium|substack/i.test(lower)) return 'blog';
  if (/\.gov\.|\.edu\./i.test(lower)) return 'official';
  if (/news|zpravy|idnes|novinky/i.test(lower)) return 'news';
  
  return 'website';
}

function detectClaimType(content) {
  if (!content) return 'unknown';
  const lower = content.toLowerCase();
  
  if (/kč|czk|cena|price|\d+\s*,-/i.test(lower)) return 'price';
  if (/skladem|dostupn|available/i.test(lower)) return 'availability';
  if (/recenze|review|hodnocení/i.test(lower)) return 'opinion';
  if (/specifikace|parametr/i.test(lower)) return 'specification';
  
  return 'general';
}

function daysSince(dateStr) {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    return Math.floor((now - date) / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

function assessCredibility(webResult) {
  let score = 0.5; // Default medium
  
  // Boost for known reliable sources
  if (/alza|czc|datart|\.gov\.|\.edu\./i.test(webResult.url)) {
    score += 0.2;
  }
  
  // Reduce for forums, blogs
  if (/forum|reddit|blog/i.test(webResult.url)) {
    score -= 0.2;
  }
  
  // Reduce for old content
  const age = webResult.date ? daysSince(webResult.date) : 30;
  if (age > 30) score -= 0.1;
  if (age > 90) score -= 0.2;
  
  return Math.max(0.1, Math.min(0.9, score));
}

/**
 * Build failure mode message
 * @param {string} failureType
 * @param {object} context
 * @returns {string}
 */
export function buildFailureMessage(failureType, context = {}) {
  const messages = {
    'no_data_source': 'Pro tuto doménu nemáme ověřená data. Odpověď je založena na odhadu.',
    'stale_data': 'Data mohou být zastaralá. Doporučujeme ověřit aktuální stav.',
    'conflicting_sources': 'Zdroje si protiřečí. Zobrazujeme rozmezí z nalezených hodnot.',
    'low_credibility': 'Nalezené zdroje mají nízkou důvěryhodnost. Berte informace s rezervou.',
    'estimate_only': 'Používáme odhad na základě podobných produktů/služeb.',
    'partial_data': 'Podařilo se získat pouze částečná data.',
    'web_search_failed': 'Nepodařilo se vyhledat aktuální informace.',
    'unknown_domain': 'Pro tuto oblast nemáme specializované zdroje.',
    'hybrid_partial': 'Některé části dotazu nemohly být plně zodpovězeny.'
  };
  
  return messages[failureType] || 'Došlo k neočekávané situaci při získávání dat.';
}

// ════════════════════════════════════════════════════════════════════════════
// HYBRID TASK HANDLING
// ════════════════════════════════════════════════════════════════════════════

/**
 * Patterns for splitting hybrid queries into subtasks
 */
const SUBTASK_SPLITTERS = [
  // "X a Y" pattern
  /(.+?)\s+a\s+(?:také\s+)?(.+)/i,
  // "X, Y a Z" pattern  
  /(.+?),\s*(.+?)\s+a\s+(.+)/i,
  // "nejdřív X, pak Y" pattern
  /nejd[řr][íi]v\s+(.+?),?\s*pak\s+(.+)/i,
  // "X vs Y" / "X nebo Y" pattern
  /(.+?)\s+(?:vs\.?|versus|nebo)\s+(.+)/i
];

/**
 * Split hybrid message into subtasks
 * @param {string} message
 * @param {string[]} detectedTypes - Types detected in classification
 * @returns {{subtasks: Array<{text: string, type: string}>, isSplittable: boolean}}
 */
export function splitHybridTask(message, detectedTypes = []) {
  // Try pattern-based splitting
  for (const pattern of SUBTASK_SPLITTERS) {
    const match = message.match(pattern);
    if (match) {
      const parts = match.slice(1).filter(p => p && p.trim());
      if (parts.length >= 2) {
        // Classify each part
        const subtasks = parts.map(part => {
          const classification = classifyDataProblem(part.trim());
          return {
            text: part.trim(),
            type: classification.type,
            confidence: classification.confidence
          };
        });
        
        return {
          subtasks,
          isSplittable: true,
          splitMethod: 'pattern'
        };
      }
    }
  }
  
  // If we have detected multiple types but couldn't split by pattern,
  // return the whole message with dominant type warning
  if (detectedTypes && detectedTypes.length > 1) {
    return {
      subtasks: [{
        text: message,
        type: detectedTypes[0], // Use dominant type
        confidence: 0.6
      }],
      isSplittable: false,
      splitMethod: 'none',
      warning: `Hybrid query detected (${detectedTypes.join(', ')}) but couldn't split. Using dominant type.`
    };
  }
  
  return {
    subtasks: [{ text: message, type: DATA_PROBLEM_TYPES.PROCEDURAL, confidence: 0.5 }],
    isSplittable: false,
    splitMethod: 'none'
  };
}

/**
 * Process hybrid task - execute each subtask with appropriate strategy
 * @param {string} message
 * @param {object} classification - From classifyDataProblem
 * @param {object} available - { dataLayer, webSearch }
 * @returns {{strategies: Array, warnings: string[]}}
 */
export function processHybridTask(message, classification, available = {}) {
  const warnings = [];
  
  // Split into subtasks
  const { subtasks, isSplittable, warning } = splitHybridTask(message, classification.subtypes);
  
  if (warning) {
    warnings.push(warning);
  }
  
  // Get strategy for each subtask
  const strategies = subtasks.map(subtask => {
    const strategy = determineStrategy(subtask.type, available);
    return {
      ...subtask,
      strategy
    };
  });
  
  // Check for conflicts (e.g., one subtask needs web, another forbids it)
  const needsWeb = strategies.some(s => s.strategy.rules?.webSearch === 'required');
  const forbidsWeb = strategies.some(s => s.strategy.rules?.webSearch === 'forbidden');
  
  if (needsWeb && forbidsWeb) {
    warnings.push('Části dotazu mají protichůdné požadavky na zdroje dat.');
  }
  
  return {
    strategies,
    warnings,
    isSplittable,
    subtaskCount: subtasks.length
  };
}

/**
 * Apply consensus-specific constraints
 * Ensures LLM doesn't numerically aggregate opinions
 */
export function applyConsensusConstraints(data) {
  const warnings = [];
  
  // Check for numeric aggregations that should be avoided
  const numericPatterns = [
    /průměr(ně|em)?/i,
    /\d+(\.\d+)?\s*\/\s*\d+/,  // "4.5/5" pattern
    /celkem\s+\d+/i,
    /hodnocení:\s*\d+/i
  ];
  
  if (data.data) {
    for (const item of data.data) {
      for (const [key, value] of Object.entries(item)) {
        if (typeof value === 'string') {
          for (const pattern of numericPatterns) {
            if (pattern.test(value)) {
              warnings.push(`Numerická agregace detekována v "${key}". Pro consensus problémy zachovej pluralitu názorů.`);
            }
          }
        }
      }
    }
  }
  
  return {
    data,
    warnings,
    hasViolations: warnings.length > 0
  };
}

export default {
  DATA_PROBLEM_TYPES,
  CONFIDENCE_LEVELS,
  DECISION_MATRIX,
  // Problem classification
  classifyDataProblem,
  getDecisionRules,
  determineStrategy,
  // Confidence
  applyConfidenceConstraints,
  // Evidence
  createEvidenceObject,
  buildFailureMessage,
  // Hybrid handling
  splitHybridTask,
  processHybridTask,
  applyConsensusConstraints,
  // Representation (NEW)
  CONTENT_REPRESENTATION,
  getContentRepresentation,
  isNarrativeRequest,
  getRepresentationConstraints
};
