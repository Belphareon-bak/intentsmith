// C.3 v35.2 Dialog Control Layer (DCL)
// ══════════════════════════════════════════════════════════════════════════════
// 
// Vrstva mezi Intent Analysis a LLM, která řídí:
// - DialogState (co víme, co je zamčeno)
// - Query Types (SEEK / BUILD / CONFIRM)
// - Strategy Decision (co máme dělat)
// - Volatility Score (jak moc se data mění)
//
// Tok:
//   USER MESSAGE
//      ↓
//   Intent + Epistemic Analysis
//      ↓
//   DIALOG STATE UPDATE   ← tato vrstva
//      ↓
//   STRATEGY DECISION     ← tato vrstva
//      ↓
//   LLM (s rolí, ne jen promptem)
//      ↓
//   Post-Validation
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// QUERY TYPE DETECTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Query Types:
 * 
 * 🟢 SEEK - Hledám novou informaci
 *    "Jaké je počasí?" "Kdy je úplněk?"
 * 
 * 🟡 BUILD - Doplňuji kontext k předchozímu
 *    "Pro Prahu" "Myslím rok 2026" "A co v březnu?"
 * 
 * 🔵 CONFIRM - Chci validaci, NE nové ověřování
 *    "Souhlasíš?" "Dává to smysl?" "Myslíš že jo?"
 */

export const QueryType = {
  SEEK: 'SEEK',       // Nová informace
  BUILD: 'BUILD',     // Doplnění kontextu
  CONFIRM: 'CONFIRM', // Validace
  CORRECT: 'CORRECT', // Oprava (existující)
  COMMAND: 'COMMAND'  // Příkaz (udělej, vytvoř)
};

// BUILD patterns - doplňuje předchozí dotaz
const BUILD_PATTERNS = [
  /^(a |a co |co )(v |pro |k )/i,        // "a co v březnu", "a pro Prahu"
  /^(pro |v |k |na )\w+$/i,              // "pro Prahu", "v březnu" (krátká odpověď)
  /^v\s+(lednu|únoru|březnu|dubnu|květnu|červnu|červenci|srpnu|září|říjnu|listopadu|prosinci)/i,
  /^myslím\s+/i,                          // "myslím rok 2026"
  /^(ten|ta|to|ty)\s+/i,                 // "ten rok", "ta oblast"
  /^(roku |v roce |rok )\d{4}$/i,        // "roku 2026", "v roce 2026"
  /^\d{4}$/,                              // jen rok "2026"
  /^(leden|únor|březen|duben|květen|červen|červenec|srpen|září|říjen|listopad|prosinec)$/i,
];

// CONFIRM patterns - chce validaci, ne nové info
const CONFIRM_PATTERNS = [
  /souhlasíš\??$/i,
  /dává to smysl\??$/i,
  /myslíš,?\s*(že)?\s*(jo|ano|ne)\??$/i,
  /je to tak\??$/i,
  /správně\??$/i,
  /ok\??$/i,
  /má(š|m) pravdu\??$/i,
  /co (ty|si) (na to|myslíš)\??$/i,
  /sedí to\??$/i,
  /funguje to\??$/i,
  /platí to\??$/i,
];

// CORRECT patterns - opravuje předchozí
const CORRECT_PATTERNS = [
  /špatně/i,
  /to není pravda/i,
  /to je blbost/i,
  /jsi mimo/i,
  /mýlíš se/i,
  /ne,\s+(správně|to)\s+je/i,
  /oprav/i,
];

// COMMAND patterns - příkaz
const COMMAND_PATTERNS = [
  /^(udělej|vytvoř|vygeneruj|napiš|připrav|sestav)/i,
];

/**
 * Detekuje typ dotazu
 */
export function detectQueryType(message, dialogState) {
  const msg = message.trim();
  
  // COMMAND - příkazy
  if (COMMAND_PATTERNS.some(p => p.test(msg))) {
    return QueryType.COMMAND;
  }
  
  // CORRECT - opravy (existující detection)
  if (CORRECT_PATTERNS.some(p => p.test(msg))) {
    return QueryType.CORRECT;
  }
  
  // CONFIRM - validace
  if (CONFIRM_PATTERNS.some(p => p.test(msg))) {
    return QueryType.CONFIRM;
  }
  
  // BUILD - doplnění (musí být follow-up)
  if (dialogState?.turnCount > 0 && BUILD_PATTERNS.some(p => p.test(msg))) {
    return QueryType.BUILD;
  }
  
  // BUILD - krátká odpověď na clarification
  if (dialogState?.pendingClarification && msg.length < 30 && !msg.includes('?')) {
    // Pravděpodobně odpověď na "který rok?" apod.
    return QueryType.BUILD;
  }
  
  // Default: SEEK
  return QueryType.SEEK;
}

// ════════════════════════════════════════════════════════════════════════════
// VOLATILITY SCORE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Volatility - jak rychle se data mění
 * 
 * HIGH - mění se rychle (hodiny/dny)
 *   ceny, počasí, zprávy, kurzy, "aktuální"
 * 
 * MEDIUM - mění se pomalu (měsíce/roky)
 *   astronomické události, politické pozice, produkty
 * 
 * LOW - nemění se (fakta)
 *   historické události, fyzikální zákony, definice
 */

export const Volatility = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW'
};

// HIGH volatility markers
const HIGH_VOLATILITY_PATTERNS = [
  /aktuální/i,
  /dnes/i,
  /právě teď/i,
  /tento týden/i,
  /tento měsíc/i,
  /víkend/i,
  /cen[ay]?\b/i,
  /stojí/i,
  /kurz/i,
  /počasí/i,
  /teplota/i,
  /zpráv[ay]/i,
  /novin[ky]/i,
  /sklad(em)?/i,
  /dostupn/i,
];

// LOW volatility markers
const LOW_VOLATILITY_PATTERNS = [
  /definice/i,
  /co je/i,
  /co znamená/i,
  /kdo napsal/i,
  /kdo vynalezl/i,
  /historie/i,
  /historick/i,
  /chemick/i,
  /fyzikální/i,
  /matematick/i,
  /planeta/i,
  /prvek/i,
  /zákon/i,
  /vzorec/i,
];

/**
 * Detekuje volatility score
 */
export function detectVolatility(message, context) {
  const msg = message.toLowerCase();
  
  // HIGH volatility
  if (HIGH_VOLATILITY_PATTERNS.some(p => p.test(msg))) {
    return Volatility.HIGH;
  }
  
  // Domain-based volatility
  const domain = context?.get?.()?.domain;
  if (domain === 'prices' || domain === 'weather' || domain === 'news') {
    return Volatility.HIGH;
  }
  
  // LOW volatility
  if (LOW_VOLATILITY_PATTERNS.some(p => p.test(msg))) {
    return Volatility.LOW;
  }
  
  // Astronomical s rokem = MEDIUM (předpověditelné, ale potřeba ověřit)
  if (domain === 'astronomical' && context?.get?.()?.year) {
    return Volatility.MEDIUM;
  }
  
  // Default: MEDIUM
  return Volatility.MEDIUM;
}

// ════════════════════════════════════════════════════════════════════════════
// DIALOG STATE
// ════════════════════════════════════════════════════════════════════════════

/**
 * DialogState - stav konverzace
 * 
 * Trackuje:
 * - topic (o čem mluvíme)
 * - resolvedFacts (co už víme jistě)
 * - lockedFacts (co se NESMÍ znovu ptát)
 * - assumptions (předpoklady)
 * - mode (NORMAL / CONFIRMATION / CORRECTION)
 */
export class DialogState {
  constructor() {
    this.reset();
  }
  
  reset() {
    this.topic = null;
    this.resolvedFacts = {};
    this.lockedFacts = new Set();
    this.assumptions = [];
    this.mode = 'NORMAL';
    this.lastQueryType = null;
    this.lastAnswerType = null;  // 'fact' | 'estimate' | 'opinion' | 'clarification'
    this.turnCount = 0;
    this.pendingClarification = null;  // Co jsme se ptali
    this.disclaimerGiven = false;  // Aby se neopakoval
  }
  
  /**
   * Aktualizuje stav po user message
   */
  update(queryType, extracted) {
    this.turnCount++;
    this.lastQueryType = queryType;
    
    // Update topic
    if (extracted.domain) {
      this.topic = extracted.domain;
    }
    
    // Resolve facts from extraction
    if (extracted.year) {
      this.resolveFact('year', extracted.year);
    }
    if (extracted.month) {
      this.resolveFact('month', extracted.month);
    }
    if (extracted.location) {
      this.resolveFact('location', extracted.location);
    }
    
    // Mode transitions
    if (queryType === QueryType.CONFIRM) {
      this.mode = 'CONFIRMATION';
    } else if (queryType === QueryType.CORRECT) {
      this.mode = 'CORRECTION';
    } else if (queryType === QueryType.BUILD) {
      // BUILD mode clears pending clarification & locks the new fact
      this.pendingClarification = null;
      this.mode = 'NORMAL';
      // Lock what we just resolved
      this.lockAllResolved();
    } else {
      this.mode = 'NORMAL';
    }
    
    logger.debug('DialogState', 'Updated', {
      topic: this.topic,
      mode: this.mode,
      queryType,
      resolvedFacts: this.resolvedFacts,
      lockedFacts: Array.from(this.lockedFacts)
    });
  }
  
  /**
   * Označí fakt jako resolved
   */
  resolveFact(key, value) {
    this.resolvedFacts[key] = value;
    logger.debug('DialogState', `Resolved fact: ${key}=${value}`);
  }
  
  /**
   * Zamkne fakt - NESMÍ se znovu ptát
   */
  lockFact(key) {
    this.lockedFacts.add(key);
    logger.debug('DialogState', `Locked fact: ${key}`);
  }
  
  /**
   * Zamkne všechny resolved facts
   */
  lockAllResolved() {
    for (const key of Object.keys(this.resolvedFacts)) {
      this.lockedFacts.add(key);
    }
  }
  
  /**
   * Kontroluje, zda se můžeme ptát na tento fakt
   */
  canAskAbout(key) {
    return !this.lockedFacts.has(key);
  }
  
  /**
   * Kontroluje, zda máme resolved fakt
   */
  hasFact(key) {
    return this.resolvedFacts[key] !== undefined;
  }
  
  /**
   * Kontroluje, zda jsme v confirmation mode
   */
  isConfirmationMode() {
    return this.mode === 'CONFIRMATION';
  }
  
  /**
   * Kontroluje, zda jsme v correction mode
   */
  isCorrectionMode() {
    return this.mode === 'CORRECTION';
  }
  
  /**
   * Vrací všechny resolved facts
   */
  getResolvedFacts() {
    return { ...this.resolvedFacts };
  }
  
  /**
   * Nastavuje pending clarification
   */
  setPendingClarification(question) {
    this.pendingClarification = question;
  }
  
  /**
   * Kontroluje, zda máme dostatečný kontext pro odpověď
   */
  hasSufficientContext(requiredAny = []) {
    // Pokud je alespoň jeden z required vyplněn
    for (const key of requiredAny) {
      if (this.hasFact(key)) {
        return true;
      }
    }
    return requiredAny.length === 0;
  }
  
  /**
   * Je toto follow-up? (ne první zpráva)
   */
  isFollowUp() {
    return this.turnCount > 0;
  }
  
  /**
   * Snapshot pro export
   */
  getSnapshot() {
    return {
      topic: this.topic,
      resolvedFacts: { ...this.resolvedFacts },
      lockedFacts: Array.from(this.lockedFacts),
      mode: this.mode,
      turnCount: this.turnCount,
      disclaimerGiven: this.disclaimerGiven
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// STRATEGY DECISION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Response Strategy
 */
export const Strategy = {
  ANSWER_DIRECT: 'ANSWER_DIRECT',           // Odpověz přímo
  ANSWER_WITH_DISCLAIMER: 'ANSWER_WITH_DISCLAIMER', // Odpověz s upozorněním
  ASK_CLARIFICATION: 'ASK_CLARIFICATION',   // Zeptej se
  CONFIRM_CONTEXT: 'CONFIRM_CONTEXT',       // Confirmation mode - validuj
  REFUSE_WITHOUT_SOURCE: 'REFUSE_WITHOUT_SOURCE', // Odmítni bez zdroje
  CORRECT_PREVIOUS: 'CORRECT_PREVIOUS',     // Oprav předchozí
  EXECUTE_COMMAND: 'EXECUTE_COMMAND'        // Vykonej příkaz
};

/**
 * Rozhodne strategii odpovědi
 */
export function decideStrategy(queryType, volatility, dialogState, context) {
  const hasSource = context?.get?.()?.source;
  
  // COMMAND → execute
  if (queryType === QueryType.COMMAND) {
    return {
      strategy: Strategy.EXECUTE_COMMAND,
      reason: 'User issued command',
      noDisclaimer: true,
      noClarification: true
    };
  }
  
  // CORRECT → correction mode
  if (queryType === QueryType.CORRECT) {
    return {
      strategy: Strategy.CORRECT_PREVIOUS,
      reason: 'User is correcting previous answer',
      noDisclaimer: false,
      noClarification: true
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // 🔵 CONFIRM → CONFIRMATION MODE
  // - žádné nové web search
  // - žádné nové clarification
  // - pracuj jen s aktuálním kontextem
  // ═══════════════════════════════════════════════════════════════════════
  if (queryType === QueryType.CONFIRM) {
    return {
      strategy: Strategy.CONFIRM_CONTEXT,
      reason: 'User wants validation, not new info',
      noWebSearch: true,
      noClarification: true,
      noDisclaimer: true,
      useCurrentContext: true
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // 🟡 BUILD → USE EXISTING CONTEXT
  // - no clarification (user just provided context!)
  // - lock the new facts
  // ═══════════════════════════════════════════════════════════════════════
  if (queryType === QueryType.BUILD) {
    return {
      strategy: Strategy.ANSWER_DIRECT,
      reason: 'User is building on existing context',
      noClarification: true,
      noDisclaimer: dialogState.disclaimerGiven,
      lockFactsAfter: true
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // 🟢 SEEK - based on volatility
  // ═══════════════════════════════════════════════════════════════════════
  
  // SEEK with HIGH volatility + no source → refuse or ask
  if (queryType === QueryType.SEEK && volatility === Volatility.HIGH && !hasSource) {
    return {
      strategy: Strategy.REFUSE_WITHOUT_SOURCE,
      reason: 'High volatility data requires source',
      noFactClaims: true,
      suggestSearch: true
    };
  }
  
  // SEEK with MEDIUM volatility
  if (queryType === QueryType.SEEK && volatility === Volatility.MEDIUM) {
    // Check if we have sufficient resolved context
    if (dialogState.hasSufficientContext(['year', 'location', 'month'])) {
      return {
        strategy: Strategy.ANSWER_WITH_DISCLAIMER,
        reason: 'Medium volatility with resolved context',
        noDisclaimer: dialogState.disclaimerGiven,
        noClarification: true  // Context is resolved!
      };
    }
    
    // Check what we can ask about (respect locked facts!)
    const canAskYear = dialogState.canAskAbout('year');
    const canAskLocation = dialogState.canAskAbout('location');
    
    if (canAskYear || canAskLocation) {
      return {
        strategy: Strategy.ASK_CLARIFICATION,
        reason: 'Need more context for medium volatility',
        askAbout: canAskYear ? 'year' : 'location'
      };
    }
    
    // All facts locked → answer with disclaimer (don't ask again!)
    return {
      strategy: Strategy.ANSWER_WITH_DISCLAIMER,
      reason: 'Medium volatility, context locked - must answer',
      noDisclaimer: dialogState.disclaimerGiven,
      noClarification: true
    };
  }
  
  // SEEK with LOW volatility → answer directly
  if (queryType === QueryType.SEEK && volatility === Volatility.LOW) {
    return {
      strategy: Strategy.ANSWER_DIRECT,
      reason: 'Low volatility fact - can answer from knowledge',
      noDisclaimer: true,
      noClarification: true
    };
  }
  
  // Default: answer with disclaimer
  return {
    strategy: Strategy.ANSWER_WITH_DISCLAIMER,
    reason: 'Default safe strategy',
    noDisclaimer: dialogState.disclaimerGiven
  };
}

// ════════════════════════════════════════════════════════════════════════════
// DIALOG CONTROL LAYER (main entry point)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Hlavní DCL funkce - analyzuje zprávu a vrací strategie
 */
export function analyzeDialog(message, context, dialogState) {
  // Detect query type
  const queryType = detectQueryType(message, dialogState);
  
  // Detect volatility
  const volatility = detectVolatility(message, context);
  
  // Decide strategy
  const decision = decideStrategy(queryType, volatility, dialogState, context);
  
  logger.info('DCL', 'Dialog analysis', {
    queryType,
    volatility,
    strategy: decision.strategy,
    reason: decision.reason,
    mode: dialogState.mode
  });
  
  return {
    queryType,
    volatility,
    ...decision
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  QueryType,
  Volatility,
  Strategy,
  DialogState,
  detectQueryType,
  detectVolatility,
  decideStrategy,
  analyzeDialog
};
