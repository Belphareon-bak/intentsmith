// C.3 v35.1 Correction Enforcement Layer
// ══════════════════════════════════════════════════════════════════════════════
// Deterministická vrstva pro vynucení correction mode behavior
// 
// CORRECTION MODE invarianty:
// 1. acknowledge error - přiznat chybu
// 2. invalidate previous claim - zneplatnit předchozí tvrzení
// 3. do NOT introduce new facts unless sourced - žádná nová fakta bez zdroje
// 4. do NOT defend previous answer - žádná obhajoba
//
// Tato vrstva běží PO LLM, ale PŘED vrácením odpovědi uživateli.
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// DETECTION PATTERNS
// ════════════════════════════════════════════════════════════════════════════

// Fráze přiznávající chybu (musí být specifické!)
const ERROR_ADMISSION_PATTERNS = [
  /opravuji/i,
  /máš pravdu/i,
  /omlouvám se/i,
  /měl jsem chybu/i,
  /mýlil jsem se/i,
  /pardon/i,
  /špatně jsem/i,
  /děkuji za opravu/i,
  /ano,?\s*máš pravdu/i,
  /přiznávám/i,
  /🔄/,  // Emoji prefix
];

// Obranný jazyk (nesmí být v correction mode)
const DEFENSIVE_PATTERNS = [
  /ale já/i,
  /měl jsem pravdu/i,
  /to není fér/i,
  /původní odpověď byla správná/i,
  /nesouhlasím/i,
  /trvám na/i,
  /jak jsem říkal/i,
  /podle mě/i,
  /já si myslím/i,
  /neměl jsem chybu/i,
  /to jsem neřekl/i,
];

// Nová fakta bez zdroje (konkrétní data)
const NEW_FACT_PATTERNS = [
  /\d{1,2}\.\s*(ledna|února|března|dubna|května|června|července|srpna|září|října|listopadu|prosince)/i,
  /\d{1,2}\.\s*\d{1,2}\.\s*\d{4}/,  // DD.MM.YYYY
  /v \d{1,2}:\d{2}/,  // čas
  /\d+\s*(Kč|CZK|EUR|USD)/i,  // ceny
  /přesně\s+\d/i,
  /konkrétně\s+\d/i,
];

// ════════════════════════════════════════════════════════════════════════════
// DETECTION FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Kontrola, zda text obsahuje přiznání chyby
 */
export function containsErrorAdmission(text) {
  if (!text) return false;
  return ERROR_ADMISSION_PATTERNS.some(p => p.test(text));
}

/**
 * Kontrola, zda text obsahuje obranný jazyk
 */
export function containsDefensiveLanguage(text) {
  if (!text) return false;
  return DEFENSIVE_PATTERNS.some(p => p.test(text));
}

/**
 * Kontrola, zda text zavádí nová konkrétní fakta
 */
export function introducesNewFacts(text) {
  if (!text) return false;
  return NEW_FACT_PATTERNS.some(p => p.test(text));
}

/**
 * Extrahuje obranné části textu
 */
export function extractDefensiveParts(text) {
  if (!text) return [];
  
  const parts = [];
  const sentences = text.split(/[.!?]+/).filter(s => s.trim());
  
  for (const sentence of sentences) {
    if (DEFENSIVE_PATTERNS.some(p => p.test(sentence))) {
      parts.push(sentence.trim());
    }
  }
  
  return parts;
}

// ════════════════════════════════════════════════════════════════════════════
// CORRECTION ENFORCEMENT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Přidá prefix přiznání chyby pokud chybí
 */
function prependErrorAdmission(text) {
  const prefixes = [
    '🔄 **Opravuji svou předchozí odpověď.**\n\n',
    '🔄 **Opravuji:**\n\n',
    '🔄 **Máš pravdu, opravuji:**\n\n',
  ];
  
  // Vyber náhodně pro přirozenost
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  
  return prefix + text;
}

/**
 * Odstraní obranné části z textu
 */
function stripDefensiveParts(text) {
  if (!text) return text;
  
  const sentences = text.split(/(?<=[.!?])\s+/);
  const filtered = sentences.filter(sentence => {
    return !DEFENSIVE_PATTERNS.some(p => p.test(sentence));
  });
  
  return filtered.join(' ').trim();
}

/**
 * Downgraduje konkrétní fakta na nejistotu
 */
function downgradeToUncertainty(text, context) {
  if (!text) return text;
  
  let modified = text;
  
  // Nahraď konkrétní tvrzení nejistotou
  const replacements = [
    [/přesně (\d+\. \w+)/gi, 'přibližně $1 (vyžaduje ověření)'],
    [/určitě (\d+)/gi, 'pravděpodobně $1'],
    [/(\d+)\s*(Kč|CZK)/gi, 'cca $1 $2 (bez aktuálních dat)'],
  ];
  
  for (const [pattern, replacement] of replacements) {
    modified = modified.replace(pattern, replacement);
  }
  
  // Přidej disclaimer na konec pokud obsahuje nová fakta
  if (introducesNewFacts(modified) && !context?.get()?.source) {
    modified += '\n\n⚠️ *Tato informace vyžaduje ověření z aktuálního zdroje.*';
  }
  
  return modified;
}

/**
 * Hlavní enforcement funkce
 * Volá se PO LLM, PŘED vrácením odpovědi
 */
export function enforceCorrection(output, context) {
  // Pokud nejsme v correction mode, nic neděláme
  if (!context?.correctionMode) {
    return {
      text: output,
      enforced: false,
      changes: []
    };
  }
  
  logger.info('CorrectionEnforcer', 'Enforcing correction mode');
  
  let text = output;
  const changes = [];
  
  // 1. Zkontroluj přiznání chyby
  if (!containsErrorAdmission(text)) {
    text = prependErrorAdmission(text);
    changes.push('added_error_admission');
    logger.debug('CorrectionEnforcer', 'Added error admission prefix');
  }
  
  // 2. Odstraň obranný jazyk
  if (containsDefensiveLanguage(text)) {
    const defensiveParts = extractDefensiveParts(text);
    text = stripDefensiveParts(text);
    changes.push('stripped_defensive_language');
    logger.debug('CorrectionEnforcer', 'Stripped defensive parts', { parts: defensiveParts });
  }
  
  // 3. Downgraduj nová fakta bez zdroje
  if (introducesNewFacts(text) && !context?.get()?.source) {
    text = downgradeToUncertainty(text, context);
    changes.push('downgraded_to_uncertainty');
    logger.debug('CorrectionEnforcer', 'Downgraded facts to uncertainty');
  }
  
  // 4. Ověř, že výsledek není prázdný
  if (!text || text.trim().length < 10) {
    text = '🔄 **Opravuji svou předchozí odpověď.**\n\nMůžeš mi prosím upřesnit, co bylo špatně? Rád to napravím.';
    changes.push('fallback_response');
  }
  
  return {
    text,
    enforced: true,
    changes
  };
}

// ════════════════════════════════════════════════════════════════════════════
// METADATA ENRICHMENT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Obohacuje metadata o correction-related flagy
 */
export function enrichCorrectionMetadata(metadata, text, context, enforcementResult) {
  return {
    ...metadata,
    correctionModeUsed: context?.correctionMode || false,
    correctionEnforced: enforcementResult?.enforced || false,
    correctionChanges: enforcementResult?.changes || [],
    admitsError: containsErrorAdmission(text),
    hasDefensiveLanguage: containsDefensiveLanguage(text),
    introducesNewFacts: introducesNewFacts(text) && !context?.get()?.source,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// VALIDATION (pro testy)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Validuje, že correction response splňuje invarianty
 */
export function validateCorrectionResponse(text, context) {
  const issues = [];
  
  if (!context?.correctionMode) {
    return { valid: true, issues: [] };
  }
  
  // Invariant 1: Musí přiznat chybu
  if (!containsErrorAdmission(text)) {
    issues.push('MISSING_ERROR_ADMISSION');
  }
  
  // Invariant 2: Nesmí obsahovat obranný jazyk
  if (containsDefensiveLanguage(text)) {
    issues.push('CONTAINS_DEFENSIVE_LANGUAGE');
  }
  
  // Invariant 3: Nesmí zavádět nová fakta bez zdroje
  if (introducesNewFacts(text) && !context?.get()?.source) {
    issues.push('INTRODUCES_UNSOURCED_FACTS');
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  containsErrorAdmission,
  containsDefensiveLanguage,
  introducesNewFacts,
  extractDefensiveParts,
  enforceCorrection,
  enrichCorrectionMetadata,
  validateCorrectionResponse
};
