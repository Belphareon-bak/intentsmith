// C.3 v35.3 Decision Layer
// ══════════════════════════════════════════════════════════════════════════════
// 
// Decision Layer ROZHODUJE (ne doporučuje).
// Vrací JEDINOU povolenou akci s constraints.
// LLM NESMÍ nic mimo tento kontrakt.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import {
  DialogState,
  Decision,
  DialogIntent,
  PermittedAction,
  AnswerType,
  CorrectionType,
  Volatility,
  Certainty,
  Domain
} from './dialog-state.js';

// ════════════════════════════════════════════════════════════════════════════
// INTENT DETECTION
// ════════════════════════════════════════════════════════════════════════════

const CHALLENGE_PATTERNS = [
  /špatně/i,
  /to není pravda/i,
  /to je blbost/i,
  /jsi mimo/i,
  /mýlíš se/i,
  /ne,\s+(správně|to)\s+je/i,
  /oprav/i,
  /chyba/i,
  /nesmysl/i,
];

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
];

const BUILD_PATTERNS = [
  /^(a |a co |co )(v |pro |k )/i,
  /^(pro |v |k |na )\w+$/i,
  /^v\s+(lednu|únoru|březnu|dubnu|květnu|červnu|červenci|srpnu|září|říjnu|listopadu|prosinci)/i,
  /^myslím\s+/i,
  /^(ten|ta|to|ty)\s+/i,
  /^(roku |v roce |rok )\d{4}$/i,
  /^\d{4}$/,
  /^(leden|únor|březen|duben|květen|červen|červenec|srpen|září|říjen|listopad|prosinec)$/i,
];

const COMMAND_PATTERNS = [
  /^(udělej|vytvoř|vygeneruj|napiš|připrav|sestav)/i,
];

const EXPLORE_PATTERNS = [
  /co.*myslíš/i,
  /jaký.*názor/i,
  /poraď/i,
  /doporuč/i,
  /navrhni/i,
  /brainstorm/i,
];

/**
 * Detect dialog intent from message
 */
export function detectIntent(message, dialogState) {
  const msg = message.trim();
  
  // CHALLENGE - highest priority (user is correcting)
  if (CHALLENGE_PATTERNS.some(p => p.test(msg))) {
    return DialogIntent.CHALLENGE;
  }
  
  // COMMAND
  if (COMMAND_PATTERNS.some(p => p.test(msg))) {
    return DialogIntent.COMMAND;
  }
  
  // CONFIRM - only in follow-up context
  if (dialogState.isFollowUp() && CONFIRM_PATTERNS.some(p => p.test(msg))) {
    return DialogIntent.CONFIRM;
  }
  
  // BUILD - short message building on context
  if (dialogState.isFollowUp()) {
    // If we just asked something, this is likely BUILD
    if (dialogState.justAsked() && msg.length < 50) {
      return DialogIntent.BUILD;
    }
    // Pattern-based BUILD
    if (BUILD_PATTERNS.some(p => p.test(msg))) {
      return DialogIntent.BUILD;
    }
  }
  
  // EXPLORE - open-ended questions
  if (EXPLORE_PATTERNS.some(p => p.test(msg))) {
    return DialogIntent.EXPLORE;
  }
  
  // Default: SEEK
  return DialogIntent.SEEK;
}

// ════════════════════════════════════════════════════════════════════════════
// VOLATILITY DETECTION
// ════════════════════════════════════════════════════════════════════════════

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
  /směn/i,
  /počasí/i,
  /teplota/i,
  /zpráv[ay]/i,
  /novin[ky]/i,
  /sklad(em)?/i,
  /dostupn/i,
];

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
 * Detect volatility of the topic
 */
export function detectVolatility(message, domain) {
  const msg = message.toLowerCase();
  
  // HIGH volatility patterns
  if (HIGH_VOLATILITY_PATTERNS.some(p => p.test(msg))) {
    return Volatility.HIGH;
  }
  
  // Domain-based HIGH volatility
  if (domain === Domain.PRICES || domain === Domain.WEATHER || domain === Domain.NEWS) {
    return Volatility.HIGH;
  }
  
  // LOW volatility patterns
  if (LOW_VOLATILITY_PATTERNS.some(p => p.test(msg))) {
    return Volatility.LOW;
  }
  
  return Volatility.MEDIUM;
}

// ════════════════════════════════════════════════════════════════════════════
// DOMAIN DETECTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Detect domain from message
 */
export function detectDomain(message) {
  const msg = message.toLowerCase();
  
  if (/cen[ay]|stojí|koupit|prodej|kč|czk|eur|\$/i.test(msg)) {
    return Domain.PRICES;
  }
  if (/počasí|teplota|déšť|sníh|vítr|bouřk/i.test(msg)) {
    return Domain.WEATHER;
  }
  if (/zpráv|novin|událost|stalo se/i.test(msg)) {
    return Domain.NEWS;
  }
  if (/úplněk|nov|měsíc|hvězd|planety|zatmění|astronomic/i.test(msg)) {
    return Domain.ASTRONOMICAL;
  }
  if (/jak funguje|princip|technick|specifikac/i.test(msg)) {
    return Domain.TECHNICAL;
  }
  if (/definice|co je|historie|kdo (napsal|vynalezl)/i.test(msg)) {
    return Domain.FACTUAL;
  }
  
  return Domain.UNKNOWN;
}

// ════════════════════════════════════════════════════════════════════════════
// SLOT REQUIREMENTS
// ════════════════════════════════════════════════════════════════════════════

const DOMAIN_REQUIRED_SLOTS = {
  [Domain.ASTRONOMICAL]: ['year', 'month'],
  [Domain.PRICES]: ['entity'],  // Co chce koupit
  [Domain.WEATHER]: ['location', 'timeframe'],
  [Domain.NEWS]: ['topic', 'timeframe'],
};

/**
 * Get required slots for domain
 */
function getRequiredSlots(domain) {
  return DOMAIN_REQUIRED_SLOTS[domain] || [];
}

/**
 * Check which slots are missing
 */
function getMissingSlots(domain, dialogState) {
  const required = getRequiredSlots(domain);
  const missing = [];
  
  for (const slot of required) {
    if (!dialogState.hasFact(slot)) {
      missing.push(slot);
    }
  }
  
  return missing;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN DECISION FUNCTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Make a decision about what action to take
 * Returns SINGLE permitted action with constraints
 * 
 * @param {string} message - User message
 * @param {DialogState} dialogState - Current dialog state
 * @param {object} context - Additional context (source URL, etc.)
 * @returns {Decision}
 */
export function makeDecision(message, dialogState, context = {}) {
  // 1. Detect intent
  const intent = detectIntent(message, dialogState);
  dialogState.intent = intent;
  
  // 2. Detect domain (if not already set)
  if (dialogState.domain === Domain.UNKNOWN) {
    dialogState.domain = detectDomain(message);
  }
  
  // 3. Detect volatility
  const volatility = detectVolatility(message, dialogState.domain);
  dialogState.setVolatility(volatility);
  
  // 4. Get locked facts for constraints
  const lockedFacts = Array.from(dialogState.lockedFacts);
  
  logger.debug('Decision', 'Analysis', {
    intent,
    domain: dialogState.domain,
    volatility,
    lockedFacts
  });
  
  // ═══════════════════════════════════════════════════════════════════════
  // DECISION LOGIC
  // ═══════════════════════════════════════════════════════════════════════
  
  // ─────────────────────────────────────────────────────────────────────────
  // CHALLENGE → Correction flow
  // ─────────────────────────────────────────────────────────────────────────
  if (intent === DialogIntent.CHALLENGE) {
    const correctionType = detectCorrectionType(message);
    dialogState.setPendingCorrection(correctionType);
    
    return Decision.answer(`User is correcting: ${correctionType}`, AnswerType.FACTUAL)
      .withMustInclude(['acknowledgment', 'correction'])
      .withMustAvoid(['defensive', 'repeat_error'])
      .withMustNotAsk(lockedFacts);
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // CONFIRM → Validation only (NO new info, NO questions)
  // ─────────────────────────────────────────────────────────────────────────
  if (intent === DialogIntent.CONFIRM) {
    return Decision.confirm('User wants validation, not new information')
      .withMustNotAsk([...lockedFacts, 'year', 'month', 'location'])  // Lock everything
      .withMustAvoid(['new_facts', 'uncertainty_disclaimer', 'web_search'])
      .withAnswerType(AnswerType.CONDITIONAL);
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // BUILD → Use context, lock facts, answer directly
  // ─────────────────────────────────────────────────────────────────────────
  if (intent === DialogIntent.BUILD) {
    // Extract and resolve facts from BUILD message
    extractAndResolveFacts(message, dialogState);
    
    // Lock all resolved facts (user provided context, don't re-ask!)
    dialogState.lockAllResolved();
    
    // Now answer directly
    const answerType = volatility === Volatility.HIGH ? 
      AnswerType.STRUCTURAL : AnswerType.FACTUAL;
    
    return Decision.answer('User provided context, answering with it', answerType)
      .withMustNotAsk(Array.from(dialogState.lockedFacts))
      .withMaxCertainty(volatility === Volatility.HIGH ? Certainty.LOW : Certainty.MEDIUM);
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // COMMAND → Execute
  // ─────────────────────────────────────────────────────────────────────────
  if (intent === DialogIntent.COMMAND) {
    // Check if we have enough context for the command
    if (!context.hasArtifactContext) {
      return Decision.ask('artifact_content', 'Need to know what to create')
        .withMustNotAsk(lockedFacts);
    }
    
    return Decision.answer('Executing command', AnswerType.FACTUAL)
      .withMustNotAsk(lockedFacts);
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // EXPLORE → Open-ended answer
  // ─────────────────────────────────────────────────────────────────────────
  if (intent === DialogIntent.EXPLORE) {
    return Decision.answer('Open-ended exploration', AnswerType.EXPLANATORY)
      .withMustNotAsk(lockedFacts);
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // SEEK → Main information seeking flow
  // ─────────────────────────────────────────────────────────────────────────
  
  // Check for HIGH volatility without source → STRUCTURAL answer or REFUSE
  if (volatility === Volatility.HIGH && !context.source) {
    // If we have some context, give structural answer
    if (dialogState.resolvedFacts.size > 0) {
      return Decision.answer('High volatility with partial context', AnswerType.STRUCTURAL)
        .withMustAvoid(['specific_numbers', 'exact_dates', 'price_claims'])
        .withMustInclude(['range_or_general', 'suggest_verification'])
        .withMaxCertainty(Certainty.LOW)
        .withMustNotAsk(lockedFacts);
    }
    
    // No context at all → REFUSE (need source)
    return Decision.defer('High volatility data requires external source')
      .withMustInclude(['suggest_search', 'explain_why']);
  }
  
  // Check for missing required slots
  const missingSlots = getMissingSlots(dialogState.domain, dialogState);
  const askableSlots = missingSlots.filter(s => dialogState.canAskAbout(s));
  
  // If there are askable slots AND we haven't just asked → ASK
  if (askableSlots.length > 0 && !dialogState.justAsked()) {
    const slotToAsk = askableSlots[0];
    return Decision.ask(slotToAsk, `Missing required slot: ${slotToAsk}`)
      .withMustNotAsk(lockedFacts);
  }
  
  // All slots locked or resolved → ANSWER
  const answerType = determineAnswerType(volatility, dialogState);
  
  return Decision.answer('All required context available', answerType)
    .withMustNotAsk(lockedFacts)
    .withMaxCertainty(volatility === Volatility.HIGH ? Certainty.LOW : Certainty.MEDIUM);
}

// ════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Detect correction type from message
 */
function detectCorrectionType(message) {
  const msg = message.toLowerCase();
  
  // Epistemic correction ("nemůžeš si být jistý")
  if (/nemůžeš.*jist|nevíš|odkud to víš/i.test(msg)) {
    return CorrectionType.EPISTEMIC;
  }
  
  // Scope correction ("to jsem se neptal")
  if (/neptal|nechtěl jsem|mimo téma|to ne/i.test(msg)) {
    return CorrectionType.SCOPE;
  }
  
  // Default: Factual correction
  return CorrectionType.FACTUAL;
}

/**
 * Extract and resolve facts from BUILD message
 */
function extractAndResolveFacts(message, dialogState) {
  const msg = message.toLowerCase();
  
  // Year extraction
  const yearMatch = msg.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    dialogState.resolveFact('year', parseInt(yearMatch[1]));
  }
  
  // Month extraction
  const months = {
    'leden': 1, 'únor': 2, 'březen': 3, 'duben': 4,
    'květen': 5, 'červen': 6, 'červenec': 7, 'srpen': 8,
    'září': 9, 'říjen': 10, 'listopad': 11, 'prosinec': 12,
    'ledna': 1, 'února': 2, 'března': 3, 'dubna': 4,
    'května': 5, 'června': 6, 'července': 7, 'srpna': 8,
    'září': 9, 'října': 10, 'listopadu': 11, 'prosince': 12,
    'lednu': 1, 'únoru': 2, 'březnu': 3, 'dubnu': 4,
    'květnu': 5, 'červnu': 6, 'červenci': 7, 'srpnu': 8,
    'září': 9, 'říjnu': 10, 'listopadu': 11, 'prosinci': 12
  };
  
  for (const [name, num] of Object.entries(months)) {
    if (msg.includes(name)) {
      dialogState.resolveFact('month', num);
      break;
    }
  }
  
  // Location extraction (simple)
  if (/praha|prague/i.test(msg)) {
    dialogState.resolveFact('location', 'Praha');
  } else if (/brno/i.test(msg)) {
    dialogState.resolveFact('location', 'Brno');
  }
}

/**
 * Determine appropriate answer type based on context
 */
function determineAnswerType(volatility, dialogState) {
  // HIGH volatility without source → STRUCTURAL
  if (volatility === Volatility.HIGH) {
    return AnswerType.STRUCTURAL;
  }
  
  // LOW volatility → FACTUAL
  if (volatility === Volatility.LOW) {
    return AnswerType.FACTUAL;
  }
  
  // MEDIUM volatility with resolved context → FACTUAL
  if (dialogState.resolvedFacts.size > 0) {
    return AnswerType.FACTUAL;
  }
  
  // Default: CONDITIONAL
  return AnswerType.CONDITIONAL;
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  makeDecision,
  detectIntent,
  detectVolatility,
  detectDomain
};
