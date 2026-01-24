// C.3 v35.1 Chat Hard Rules
// ══════════════════════════════════════════════════════════════════════════════
// P0.0 - CHAT CORRECTNESS MODE
// Tyto guardy běží PŘED LLM voláním
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ════════════════════════════════════════════════════════════════════════════

const CONFIDENCE_THRESHOLD = 0.5;

// Faktické indikátory - vyžadují evidence
const FACT_INDICATORS = [
  /kdy\s+(bude|je|byl)/i,
  /kolik\s+(je|bylo|bude)/i,
  /jaké?\s+(je|jsou|bylo|byly)/i,
  /v\s+roce\s+\d{4}/i,
  /(leden|únor|březen|duben|květen|červen|červenec|srpen|září|říjen|listopad|prosinec)/i,
  /\b20\d{2}\b/,
  /(datum|den|měsíc|rok|čas|hodina)/i,
  /(cena|stojí|kolik|Kč|CZK|EUR|USD)/i,
  /(kdo|kde|odkud|kam)\s+(je|jsou|byl|byla|byli)/i,
  /(aktuální|současn|teď|nyní|dnes|právě)/i,  // Aktuální dotazy (bez \b pro UTF-8)
  /(počasí|teplota|předpověď)/i,  // Počasí
  /fáze\s+měsíce/i,  // Explicitně fáze měsíce
];

// Correction triggers
const CORRECTION_TRIGGERS = [
  'jsi mimo',
  'jsi úplně mimo',
  'ne, myslel jsem',
  'ne, myslela jsem',
  'ne, myslím',
  'tady je zdroj',
  'tady je správný zdroj',
  'špatně',
  'spatne',
  'to není správně',
  'to neni spravne',
  'ne, já myslím',
  'ne, já myslel',
  'pořád špatně',
  'porad spatne',
  'vlastně myslím',
  'myslím únor',
  'myslím březen',
  ', ne 20',  // "myslím X, ne 2024"
];

// Artifact triggers - vyžadují explicitní příkaz
const ARTIFACT_TRIGGERS = [
  /vygeneruj\s+(\w+\s+)?(pdf|dokument|tabulku?|xlsx|docx|graf)/i,
  /vytvoř\s+(\w+\s+)?(pdf|dokument|tabulku?|xlsx|docx|graf)/i,
  /udělej\s+(\w+\s+)?(pdf|dokument|tabulku?|xlsx|docx|graf)/i,
  /připrav\s+(\w+\s+)?(pdf|dokument|tabulku?|xlsx|docx|graf)/i,
  /sestav\s+(\w+\s+)?(pdf|dokument|tabulku?|xlsx|docx|graf)/i,
  /exportuj\s+do/i,
  /ulož\s+jako/i,
];

// ════════════════════════════════════════════════════════════════════════════
// CHAT CONTEXT (session-level)
// ════════════════════════════════════════════════════════════════════════════

export class ChatContext {
  constructor() {
    this.reset();
  }

  reset() {
    this.lock = {
      year: null,
      month: null,
      domain: null,
      topic: null,
      source: null,
      sourceType: null,
      lockedAt: null
    };
    this.correctionMode = false;
    this.lastQuery = null;
    this.lastResponse = null;
    this.evidenceRequired = false;
    this.artifactAllowed = false;
    
    // Context resolution tracking
    this.messageCount = 0;
    this.resolvedFields = new Set();  // Tracks which fields were explicitly resolved
    this.lastDomain = null;           // For domain drift detection
  }

  update(extracted) {
    const now = new Date().toISOString();
    
    // Track what was resolved
    if (extracted.year) {
      this.lock.year = extracted.year;
      this.resolvedFields.add('year');
    }
    if (extracted.month) {
      this.lock.month = extracted.month;
      this.resolvedFields.add('month');
    }
    if (extracted.domain) {
      this.lastDomain = this.lock.domain;
      this.lock.domain = extracted.domain;
      this.resolvedFields.add('domain');
    }
    if (extracted.topic) {
      this.lock.topic = extracted.topic;
      this.resolvedFields.add('topic');
    }
    if (extracted.source) {
      this.lock.source = extracted.source;
      this.resolvedFields.add('source');
    }
    if (extracted.sourceType) this.lock.sourceType = extracted.sourceType;
    
    this.lock.lockedAt = now;
    this.messageCount++;
    
    logger.debug('ChatContext', 'Lock updated', { 
      ...this.lock, 
      resolvedFields: Array.from(this.resolvedFields),
      messageCount: this.messageCount 
    });
  }

  get() {
    return { ...this.lock };
  }
  
  /**
   * Checks if context is sufficiently resolved for answering
   * Returns true if we have enough info to skip uncertainty disclaimers
   */
  isResolved() {
    // Domain is resolved AND (year is resolved OR we have source)
    const hasDomain = this.lock.domain !== null;
    const hasTimeContext = this.lock.year !== null || this.lock.month !== null;
    const hasSource = this.lock.source !== null;
    
    // If domain is astronomical/factual, we need year OR source
    if (this.lock.domain === 'astronomical') {
      return hasTimeContext || hasSource;
    }
    
    // For other domains, having any resolved field counts
    return this.resolvedFields.size > 0;
  }
  
  /**
   * Checks if current message is a follow-up (not first message)
   */
  isFollowUp() {
    return this.messageCount > 0;
  }
  
  /**
   * Checks if context is stable (no domain drift, follow-up mode)
   */
  isStable() {
    return this.isFollowUp() && this.lastDomain === this.lock.domain;
  }

  enterCorrectionMode() {
    this.correctionMode = true;
    this.lastResponse = null; // Invalidate previous response
    logger.info('ChatContext', 'Entering correction mode');
  }

  exitCorrectionMode() {
    this.correctionMode = false;
  }

  setEvidenceRequired(required) {
    this.evidenceRequired = required;
  }

  setArtifactAllowed(allowed) {
    this.artifactAllowed = allowed;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// GUARD A: FACT GUARD
// ════════════════════════════════════════════════════════════════════════════

/**
 * Detekuje, zda dotaz vyžaduje faktickou odpověď (evidence required)
 */
export function detectFactualQuery(query) {
  const queryLower = query.toLowerCase();
  
  const indicators = [];
  
  for (const pattern of FACT_INDICATORS) {
    if (pattern.test(query)) {
      indicators.push(pattern.toString());
    }
  }
  
  const isFactual = indicators.length > 0;
  
  return {
    isFactual,
    indicators,
    requiresEvidence: isFactual,
    recommendation: isFactual 
      ? 'REQUIRE_EVIDENCE' 
      : 'ALLOW_LLM'
  };
}

/**
 * Generuje "odmítací" odpověď když chybí evidence
 */
export function generateNoEvidenceResponse(query, context) {
  const lock = context.get();
  
  let response = 'Bez ověření nemohu odpovědět přesně.';
  
  // Přidej kontext pokud existuje
  if (lock.year || lock.month) {
    response += ` (Kontext: `;
    if (lock.month) response += `měsíc ${lock.month}`;
    if (lock.year) response += `, rok ${lock.year}`;
    response += ')';
  }
  
  response += '\n\nMohu:\n';
  response += '• Vyhledat aktuální informace na webu\n';
  response += '• Požádat tě o zdroj dat\n';
  response += '• Odpovědět s upozorněním, že jde o odhad';
  
  return response;
}

// ════════════════════════════════════════════════════════════════════════════
// GUARD B: CONTEXT LOCK
// ════════════════════════════════════════════════════════════════════════════

/**
 * Extrahuje kontext z query
 */
export function extractContext(query) {
  const context = {};
  const queryLower = query.toLowerCase();
  
  // Year
  const yearMatch = query.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    context.year = parseInt(yearMatch[1]);
  }
  
  // Month
  const months = {
    'leden': 1, 'ledna': 1, 'lednu': 1,
    'únor': 2, 'února': 2, 'unor': 2, 'unora': 2, 'únoru': 2,
    'březen': 3, 'března': 3, 'brezen': 3, 'brezna': 3, 'březnu': 3,
    'duben': 4, 'dubna': 4, 'dubnu': 4,
    'květen': 5, 'května': 5, 'kveten': 5, 'kvetna': 5, 'květnu': 5,
    'červen': 6, 'června': 6, 'cerven': 6, 'cervna': 6, 'červnu': 6,
    'červenec': 7, 'července': 7, 'cervenec': 7, 'cervence': 7, 'červenci': 7,
    'srpen': 8, 'srpna': 8, 'srpnu': 8,
    'září': 9, 'zari': 9, 'záři': 9,
    'říjen': 10, 'října': 10, 'rijen': 10, 'rijna': 10, 'říjnu': 10,
    'listopad': 11, 'listopadu': 11, 'listopadu': 11,
    'prosinec': 12, 'prosince': 12, 'prosinci': 12
  };
  
  for (const [name, num] of Object.entries(months)) {
    if (queryLower.includes(name)) {
      context.month = num;
      context.monthName = name;
      break;
    }
  }
  
  // Domain detection
  if (/měsíc|úplněk|fáze|nov\b|zatmění|astronomie/i.test(queryLower)) {
    context.domain = 'astronomical';
  } else if (/cena|gpu|rtx|grafik|notebook|počítač/i.test(queryLower)) {
    context.domain = 'prices';
  } else if (/počasí|teplota|déšť|vítr|předpověď/i.test(queryLower)) {
    context.domain = 'weather';
  } else if (/politik|volby|vláda|prezident|parlament/i.test(queryLower)) {
    context.domain = 'politics';
  }
  
  // Explicit URL - check FIRST before other patterns
  const urlMatch = query.match(/(https?:\/\/[^\s]+)/);
  if (urlMatch) {
    context.source = urlMatch[1];
    context.sourceType = 'explicit_url';
  }
  
  return context;
}

/**
 * Kontroluje změnu domény (contamination)
 */
export function checkDomainContamination(newDomain, currentLock) {
  if (!currentLock.domain || !newDomain) {
    return { contaminated: false };
  }
  
  if (newDomain !== currentLock.domain) {
    return {
      contaminated: true,
      oldDomain: currentLock.domain,
      newDomain: newDomain,
      action: 'RESET_CONTEXT'
    };
  }
  
  return { contaminated: false };
}

// ════════════════════════════════════════════════════════════════════════════
// GUARD C: NO-GUESS RULE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Detekuje nejednoznačný dotaz
 */
export function detectAmbiguousQuery(query, context) {
  const issues = [];
  const lock = context.get();
  
  // Časový dotaz bez roku
  if (/kdy|datum|den/i.test(query) && !lock.year && !/20\d{2}/.test(query)) {
    issues.push({
      type: 'MISSING_YEAR',
      question: 'Který rok máš na mysli?'
    });
  }
  
  // Měsíční dotaz bez měsíce
  if (/měsíc|úplněk|fáze/i.test(query) && !lock.month && !/leden|únor|březen|duben|květen|červen|červenec|srpen|září|říjen|listopad|prosinec/i.test(query)) {
    issues.push({
      type: 'MISSING_MONTH',
      question: 'Který měsíc tě zajímá?'
    });
  }
  
  return {
    isAmbiguous: issues.length > 0,
    issues,
    recommendation: issues.length > 0 ? 'ASK_CLARIFICATION' : 'PROCEED'
  };
}

/**
 * Generuje clarification response
 */
export function generateClarificationResponse(ambiguity) {
  if (!ambiguity.isAmbiguous) return null;
  
  let response = 'Potřebuji upřesnění:\n\n';
  
  for (const issue of ambiguity.issues) {
    response += `• ${issue.question}\n`;
  }
  
  return response;
}

// ════════════════════════════════════════════════════════════════════════════
// GUARD D: CORRECTION MODE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Detekuje correction trigger
 */
export function detectCorrectionTrigger(query) {
  const queryLower = query.toLowerCase();
  
  for (const trigger of CORRECTION_TRIGGERS) {
    if (queryLower.includes(trigger)) {
      return {
        triggered: true,
        trigger: trigger,
        action: 'ENTER_CORRECTION_MODE'
      };
    }
  }
  
  return { triggered: false };
}

// ════════════════════════════════════════════════════════════════════════════
// GUARD E: ARTIFACT SEPARATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Detekuje explicitní artifact request
 */
export function detectArtifactRequest(query) {
  for (const pattern of ARTIFACT_TRIGGERS) {
    if (pattern.test(query)) {
      return {
        requested: true,
        pattern: pattern.toString()
      };
    }
  }
  
  return { requested: false };
}

/**
 * Kontroluje, zda je artifact povolený v aktuálním kontextu
 */
export function canGenerateArtifact(query, context) {
  const artifactRequest = detectArtifactRequest(query);
  const factual = detectFactualQuery(query);
  const lock = context.get();
  
  // Artifact jen na explicitní příkaz
  if (!artifactRequest.requested) {
    return {
      allowed: false,
      reason: 'NO_EXPLICIT_REQUEST',
      message: 'Artifact se generuje pouze na explicitní příkaz.'
    };
  }
  
  // Bez kontextu (žádná doména, žádná data) = odmítnuto
  const hasContext = lock.domain || lock.source || lock.year || lock.month;
  if (!hasContext && !factual.isFactual) {
    return {
      allowed: false,
      reason: 'NO_CONTEXT',
      message: 'Pro vytvoření artefaktu potřebuji vědět, o čem má být.'
    };
  }
  
  // Faktický dotaz nebo evidence required bez zdroje
  const needsEvidence = factual.isFactual || context.evidenceRequired;
  
  if (needsEvidence && !lock.source) {
    return {
      allowed: false,
      reason: 'FACTUAL_WITHOUT_EVIDENCE',
      message: 'Pro faktický artifact potřebuji ověřená data.'
    };
  }
  
  return { allowed: true };
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN PIPELINE GUARD
// ════════════════════════════════════════════════════════════════════════════

/**
 * Hlavní guard - volá se PŘED LLM
 * Vrací rozhodnutí o dalším postupu
 */
export function runChatGuards(query, context) {
  const result = {
    proceed: true,
    action: 'CALL_LLM',
    response: null,
    warnings: [],
    context: {}
  };

  // 1. Extract and update context
  const extracted = extractContext(query);
  result.context = extracted;
  
  // 2. Check domain contamination
  const currentLock = context.get();
  const contamination = checkDomainContamination(extracted.domain, currentLock);
  
  if (contamination.contaminated) {
    logger.info('ChatGuards', 'Domain contamination detected', contamination);
    context.reset();
    result.warnings.push(`Domain change: ${contamination.oldDomain} → ${contamination.newDomain}`);
  }
  
  // Update context lock
  context.update(extracted);
  
  // 3. Check correction trigger
  const correction = detectCorrectionTrigger(query);
  if (correction.triggered) {
    context.enterCorrectionMode();
    result.warnings.push('Correction mode activated');
  }
  
  // 4. Check factual query
  const factual = detectFactualQuery(query);
  if (factual.isFactual) {
    context.setEvidenceRequired(true);
    
    // Pokud nemáme zdroj, označ to
    if (!context.get().source) {
      result.warnings.push('Evidence required but no source');
      // Necháme LLM odpovědět, ale přidáme disclaimer
      result.addDisclaimer = true;
    }
  }
  
  // 5. Check ambiguity (neblokuje, jen varuje)
  const ambiguity = detectAmbiguousQuery(query, context);
  if (ambiguity.isAmbiguous) {
    // Pro první dotaz v tématu se zeptáme
    if (!currentLock.domain) {
      result.proceed = false;
      result.action = 'ASK_CLARIFICATION';
      result.response = generateClarificationResponse(ambiguity);
      return result;
    } else {
      // Máme kontext, pokračujeme s warningem
      result.warnings.push('Ambiguous query, using context');
    }
  }
  
  // 6. Check artifact
  const artifactRequest = detectArtifactRequest(query);
  const artifactCheck = canGenerateArtifact(query, context);
  context.setArtifactAllowed(artifactCheck.allowed);
  result.artifactRequested = artifactRequest.requested;
  result.artifactAllowed = artifactCheck.allowed;
  result.artifactBlockReason = artifactCheck.reason;
  
  if (artifactRequest.requested && !artifactCheck.allowed) {
    result.warnings.push(`Artifact blocked: ${artifactCheck.reason}`);
    
    // If artifact requested but blocked without context, return fallback
    if (artifactCheck.reason === 'NO_CONTEXT') {
      result.proceed = false;
      result.action = 'ARTIFACT_BLOCKED_NO_CONTEXT';
      result.response = '❓ Co konkrétně mám vytvořit? Potřebuji vědět:\n\n• O čem má být obsah?\n• Jaká data mám použít?\n• V jakém formátu to chceš?';
      return result;
    }
  }
  
  // Log result
  logger.debug('ChatGuards', 'Guard result', {
    action: result.action,
    warnings: result.warnings,
    contextLock: context.get()
  });
  
  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// RESPONSE POST-PROCESSOR
// ════════════════════════════════════════════════════════════════════════════

/**
 * Post-procesuje LLM odpověď
 * Přidává disclaimery, kontroluje halucinace
 */
export function postProcessResponse(response, query, context, guardResult) {
  let processed = response;
  
  // Přidej disclaimer pro faktické dotazy bez evidence
  if (guardResult.addDisclaimer) {
    processed = '⚠️ *Odpověď bez ověření:*\n\n' + processed;
    processed += '\n\n---\n*Pro přesnou odpověď potřebuji ověřená data.*';
  }
  
  // V correction mode přidej prefix
  if (context.correctionMode) {
    processed = '🔄 **Opravuji předchozí odpověď:**\n\n' + processed;
    context.exitCorrectionMode();
  }
  
  return processed;
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  ChatContext,
  detectFactualQuery,
  generateNoEvidenceResponse,
  extractContext,
  checkDomainContamination,
  detectAmbiguousQuery,
  generateClarificationResponse,
  detectCorrectionTrigger,
  detectArtifactRequest,
  canGenerateArtifact,
  runChatGuards,
  postProcessResponse
};
