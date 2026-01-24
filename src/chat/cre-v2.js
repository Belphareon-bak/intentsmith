// C.3 v36.6 Conversational Reasoning Engine v2
// ══════════════════════════════════════════════════════════════════════════════
// 
// CRE je SOUDCE, ne moderátor.
// 
// v36.6 CRITICAL CHANGES:
//   - FIX 2: Forbidden Meta-Claims (no "jako AI", no "nemohu prohledávat")
//   - FIX 3: Deterministic Execution Fallbacks (reason → specific response)
//   - FIX 4: System Slots (now, timezone) - NEVER ask user for date
//
// Flow:
//   1. Detect (intent, domain, volatility, workflow)
//   2. Extract slots from message
//   3. Update DialogState (AUTHORITATIVE)
//   4. Decision Matrix (single source of truth)
//   5. EXECUTION AUTHORITY - precondition check with DETERMINISTIC fallbacks
//   6. CALENDAR AUTO-RESPONSE (v36.5)
//   7. Execute decision
//   8. Speech Act Enforcement
//   9. Answer Quality Gate + META-CLAIM SANITIZATION
//   10. Evidence-Based Confidence Tracking
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import {
  DialogState,
  Slot,
  DecisionTrace,
  Domain,
  DialogIntent,
  WorkflowIntent,
  DataRequirement,
  Certainty,
  Volatility,
  Verifiability,
  TemporalScope,
  ReasoningDepth,
  AnswerMode,
  SystemAction,
  SpeechAct
} from './dialog-state-v2.js';
import { decide, explainDecision, Decision } from './decision-matrix.js';
import {
  guardExecution,
  createSafeExecutionContext,
  generateExecutionFallback,
  ExecutionBlockReason
} from './execution-contracts.js';
import {
  capabilityRegistry,
  generateSystemContext,
  getSystemSlots,
  evaluateCapabilityStatus,
  generateCapabilityFallback,
  getMoonPhaseInfo,
  CapabilityKind,
  WorkflowCapabilityMap
} from './capability-registry.js';
import { responseRenderer } from './response-renderer.js';
import {
  answer,
  askUser,
  refuse,
  toolCall,
  createSlotRequest,
  ResponseTemplate,
  RefusalReason,
  Verbosity
} from './cre-decision-types.js';

// ════════════════════════════════════════════════════════════════════════════
// CRE RESULT
// ════════════════════════════════════════════════════════════════════════════

export class CREResult {
  constructor() {
    this.success = false;
    this.text = null;
    this.speechAct = null;
    this.decision = null;
    this.state = null;
    this.enforcement = [];
    this.qualityGate = null;  // Quality gate result
    this.trace = null;        // Decision trace
    this.error = null;
  }
  
  static ok(text, speechAct, decision, state, qualityGate = null) {
    const r = new CREResult();
    r.success = true;
    r.text = text;
    r.speechAct = speechAct;
    r.decision = decision;
    r.state = state.getSnapshot();
    r.trace = decision?.trace?.toJSON() || null;
    r.qualityGate = qualityGate;
    return r;
  }
  
  static fail(error) {
    const r = new CREResult();
    r.success = false;
    r.error = error;
    return r;
  }
  
  // Get human-readable explanation
  explain() {
    const lines = [];
    if (this.decision) {
      lines.push(`Action: ${this.decision.action}`);
      lines.push(`Reason: ${this.decision.reason}`);
      lines.push(`Speech Act: ${this.speechAct}`);
    }
    if (this.trace) {
      lines.push(`\nTrace:`);
      lines.push(`  Rule: ${this.trace.ruleName} (#${this.trace.matchedRule})`);
      lines.push(`  Domain: ${this.trace.inputs.domain}`);
      lines.push(`  Intent: ${this.trace.inputs.intent}`);
    }
    if (this.qualityGate) {
      if (this.qualityGate.warnings?.length > 0) {
        lines.push(`\nWarnings: ${this.qualityGate.warnings.map(w => w.code).join(', ')}`);
      }
      if (this.qualityGate.fallback) {
        lines.push(`\nFallback applied!`);
      }
    }
    return lines.join('\n');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// DETECTION PATTERNS
// ════════════════════════════════════════════════════════════════════════════

const CHALLENGE_PATTERNS = [
  /špatně/i, /to není pravda/i, /blbost/i, /jsi mimo/i,
  /mýlíš se/i, /oprav/i, /chyba/i, /nesmysl/i
];

const CONFIRM_PATTERNS = [
  /souhlasíš\??$/i, /dává to smysl\??$/i, /je to tak\??$/i,
  /správně\??$/i, /ok\??$/i, /sedí to\??$/i
];

const BUILD_PATTERNS = [
  /^(pro |v |k |na )\w+$/i,
  /^\d{4}$/,
  /^v\s+(lednu|únoru|březnu|dubnu|květnu|červnu|červenci|srpnu|září|říjnu|listopadu|prosinci)/i,
  /^(leden|únor|březen|duben|květen|červen|červenec|srpen|září|říjen|listopad|prosinec)$/i
];

const COMMAND_PATTERNS = [
  /^(udělej|vytvoř|vygeneruj|napiš|připrav)/i
];

const EXPLORE_PATTERNS = [
  /co.*myslíš/i, /jaký.*názor/i, /poraď/i, /doporuč/i, /navrhni/i
];

const HIGH_VOL_PATTERNS = [
  /aktuální/i, /dnes/i, /právě/i, /cen[ay]/i, /stojí/i,
  /počasí/i, /kurz/i, /směn/i, /zpráv/i
];

const LOW_VOL_PATTERNS = [
  /definice/i, /co je/i, /kdo napsal/i, /historie/i,
  /chemick/i, /fyzikální/i, /matematick/i
];

// ════════════════════════════════════════════════════════════════════════════
// DETECTORS
// ════════════════════════════════════════════════════════════════════════════

export function detectIntent(message, state) {
  const msg = message.trim();
  
  // CHALLENGE (highest priority)
  if (CHALLENGE_PATTERNS.some(p => p.test(msg))) {
    return DialogIntent.CHALLENGE;
  }
  
  // COMMAND
  if (COMMAND_PATTERNS.some(p => p.test(msg))) {
    return DialogIntent.COMMAND;
  }
  
  // CONFIRM (only in follow-up)
  if (state.isFollowUp() && CONFIRM_PATTERNS.some(p => p.test(msg))) {
    return DialogIntent.CONFIRM;
  }
  
  // BUILD (short context addition)
  if (state.isFollowUp()) {
    if (state.wasLastActionAsk() && msg.length < 40 && !msg.includes('?')) {
      return DialogIntent.BUILD;
    }
    if (BUILD_PATTERNS.some(p => p.test(msg))) {
      return DialogIntent.BUILD;
    }
  }
  
  // EXPLORE
  if (EXPLORE_PATTERNS.some(p => p.test(msg))) {
    return DialogIntent.EXPLORE;
  }
  
  // Default: SEEK
  return DialogIntent.SEEK;
}

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

export function detectVolatility(message, domain) {
  const msg = message.toLowerCase();
  
  // Pattern-based HIGH
  if (HIGH_VOL_PATTERNS.some(p => p.test(msg))) {
    return Volatility.HIGH;
  }
  
  // Domain-based HIGH
  if ([Domain.PRICES, Domain.WEATHER, Domain.NEWS].includes(domain)) {
    return Volatility.HIGH;
  }
  
  // Pattern-based LOW
  if (LOW_VOL_PATTERNS.some(p => p.test(msg))) {
    return Volatility.LOW;
  }
  
  return Volatility.MEDIUM;
}

// ════════════════════════════════════════════════════════════════════════════
// v36.3 DETECTORS - EPISTEMIC DIMENSIONS
// ════════════════════════════════════════════════════════════════════════════

import { DataDependency } from './dialog-state-v2.js';

// LIVE DATA domains - cannot answer without real-time source
const LIVE_DATA_PATTERNS = [
  /počasí|teplota|déšť|sníh|bouřk/i,              // Weather
  /aktuální.*cen|cen.*dnes|stojí teď/i,           // Current prices
  /kurz.*dnes|aktuální.*kurz/i,                    // Exchange rates
  /doprav|zácpa|traffic/i,                         // Traffic
  /otevírací.*doba|je otevř/i,                     // Opening hours
  /akcie.*dnes|stock.*today/i,                     // Stock prices
  /je.*k dispozici|skladem/i                       // Availability
];

// VARIANT-SENSITIVE domains - specs vary by trim/version/region
const VARIANT_SENSITIVE_PATTERNS = [
  /uzávěrk.*diferenciál/i,                         // Locking diff
  /výbav[ay]|příplatek|standard|paket/i,          // Equipment packages
  /motor.*verz|verz.*motor/i,                      // Engine variants
  /model.*rok|ročník/i,                            // Model years
  /cen[ay].*nov|nov.*cen/i,                        // New car prices
  /specifikac.*trh|regionální/i,                   // Regional specs
  /dostupn.*trzích/i                               // Market availability
];

// CERTAINTY PRESSURE - user demanding guarantees
const CERTAINTY_PRESSURE_PATTERNS = [
  /100\s*%/i, /stoprocentn/i,                      // 100%
  /zaruč|garantuj/i,                               // Guarantee
  /bez chyby|přesně/i,                             // Exactly
  /jist[ěý]|na jistotu/i,                          // Certainly
  /určitě.*správn/i,                               // Definitely correct
  /nesmí.*chyba/i                                  // Must not be wrong
];

// USER FRUSTRATION
const FRUSTRATION_PATTERNS = [
  /jsi (úplně )?mimo/i,
  /to je (úplná )?blbost/i,
  /nesmysl/i,
  /k ničemu/i,
  /nepoužiteln/i,
  /frustr/i
];

/**
 * Detect data dependency type
 * LIVE = requires real-time source, cannot answer from knowledge
 * STATIC = can answer from knowledge base
 */
export function detectDataDependency(message, domain) {
  const msg = message.toLowerCase();
  
  // Explicit LIVE patterns
  if (LIVE_DATA_PATTERNS.some(p => p.test(msg))) {
    return DataDependency.LIVE;
  }
  
  // Domain-based LIVE
  if (domain === Domain.WEATHER || domain === Domain.NEWS) {
    return DataDependency.LIVE;
  }
  
  // Prices with "aktuální" or future reference
  if (domain === Domain.PRICES) {
    if (/aktuální|dnes|teď|právě/i.test(msg)) {
      return DataDependency.LIVE;
    }
  }
  
  // Historical = STATIC
  if (/historie|v roce \d{4}|byl|byla/i.test(msg)) {
    return DataDependency.STATIC;
  }
  
  // Definitions = STATIC
  if (/definice|co je|jak funguje|princip/i.test(msg)) {
    return DataDependency.STATIC;
  }
  
  return DataDependency.UNKNOWN;
}

/**
 * Detect variant-sensitive queries
 * These require evidence because specs vary by trim/region/year
 */
export function detectVariantSensitivity(message, domain) {
  const msg = message.toLowerCase();
  
  // Explicit variant patterns
  if (VARIANT_SENSITIVE_PATTERNS.some(p => p.test(msg))) {
    return true;
  }
  
  // Automotive with specific features
  if (/auto|voz|car/i.test(msg)) {
    if (/má|mají|obsahuj|vybaven/i.test(msg)) {
      return true;
    }
  }
  
  // Products with specs
  if (/specifikac|parametr|vlastnost/i.test(msg)) {
    if (domain === Domain.PRICES || /produkt|výrobek/i.test(msg)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Detect certainty pressure from user
 * When user demands 100% accuracy or guarantees
 */
export function detectCertaintyPressure(message) {
  return CERTAINTY_PRESSURE_PATTERNS.some(p => p.test(message));
}

/**
 * Detect user frustration
 */
export function detectUserFrustration(message) {
  return FRUSTRATION_PATTERNS.some(p => p.test(message));
}

// ════════════════════════════════════════════════════════════════════════════
// v36.4 DETECTORS - ADVANCED EPISTEMIC DIMENSIONS
// ════════════════════════════════════════════════════════════════════════════

import { ConceptExistence } from './dialog-state-v2.js';

// NON-EXISTENT CONCEPT patterns (pseudoscience, made-up terms)
const NON_EXISTENT_PATTERNS = [
  /kvantov[ýá].*horoskop/i,                        // Quantum horoscope
  /astrolog.*kvant/i,                              // Astrology + quantum
  /homeopat.*věd/i,                                // Homeopathy as science
  /telepatick.*internet/i,                         // Telepathic internet
  /feng.*shui.*fyzik/i,                            // Feng shui physics
  /numerolog.*matemat/i,                           // Numerology math
  /reiki.*medicín/i,                               // Reiki medicine
  /čakr.*anatom/i,                                 // Chakra anatomy
  /bioenerget.*léčb/i,                             // Bioenergy healing
  /detox.*orgán/i,                                 // Organ detox (specific)
];

// Pseudoscience domain markers
const PSEUDOSCIENCE_MARKERS = [
  'kvantové vědomí', 'quantum consciousness',
  'éterické pole', 'etheric field',
  'univerzální energie', 'universal energy',
  'morfická rezonance', 'morphic resonance',
  'vibrační frekvence', 'vibrational frequency'
];

// IMPOSSIBILITY patterns (undeterministic future)
const IMPOSSIBILITY_PATTERNS = [
  /kolik.*bude.*stát.*v roce 20[3-9]\d/i,         // Price in 2030+
  /cen[ay].*20[3-9]\d/i,                           // Price 2030+
  /předpověď.*20[3-9]\d/i,                         // Prediction 2030+
  /(bude|budou).*za \d+ let/i,                     // In X years
  /jak.*bude.*vypadat.*budoucnost/i,              // What will future look like
  /předpovíš.*budoucnost/i,                        // Predict the future
];

// MULTI-DOMAIN patterns (strings for includes)
const MULTI_DOMAIN_MARKERS = [
  ' a ', ' i ', ' plus ',                          // Connectors
];

/**
 * Detect if concept exists or is pseudoscience/fiction
 * NON_EXISTENT = must refuse with explanation
 */
export function detectConceptExistence(message) {
  const msg = message.toLowerCase();
  
  // Check explicit non-existent patterns
  if (NON_EXISTENT_PATTERNS.some(p => p.test(msg))) {
    return ConceptExistence.NON_EXISTENT;
  }
  
  // Check pseudoscience markers
  if (PSEUDOSCIENCE_MARKERS.some(m => msg.includes(m.toLowerCase()))) {
    return ConceptExistence.NON_EXISTENT;
  }
  
  // Contradictory combinations
  const hasScience = /fyzik|chemie|biolog|medicín|věd/i.test(msg);
  const hasPseudo = /horoskop|astrolog|numerolog|tarot|věštb/i.test(msg);
  
  if (hasScience && hasPseudo) {
    return ConceptExistence.NON_EXISTENT;
  }
  
  return ConceptExistence.KNOWN;
}

/**
 * Detect epistemically impossible questions
 * IMPOSSIBLE = must refuse, no PROVISIONAL/ESTIMATE allowed
 */
export function detectImpossibility(message, domain) {
  const msg = message.toLowerCase();
  const currentYear = new Date().getFullYear();
  
  // Check explicit impossibility patterns
  if (IMPOSSIBILITY_PATTERNS.some(p => p.test(msg))) {
    return true;
  }
  
  // Year extraction - future > 5 years
  const yearMatch = msg.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1]);
    if (year > currentYear + 5) {
      // Price prediction for far future
      if (domain === Domain.PRICES || /cen|stát|stojí|koupit/i.test(msg)) {
        return true;
      }
    }
  }
  
  // "za X let" where X > 5
  const yearsMatch = msg.match(/za (\d+) let/i);
  if (yearsMatch) {
    const years = parseInt(yearsMatch[1]);
    if (years > 5 && /cen|stát|koupit|vypad/i.test(msg)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Detect multi-domain queries that need splitting
 */
export function detectMultiDomainQuery(message) {
  const msg = message.toLowerCase();
  
  // Count distinct domains mentioned
  const domains = [];
  
  if (/počasí|teplota|déšť/i.test(msg)) domains.push('weather');
  if (/cen[ay]|stojí|koupit/i.test(msg)) domains.push('prices');
  if (/úplněk|měsíc|hvězd|fáze/i.test(msg)) domains.push('astronomical');
  if (/zpráv|novin|událost/i.test(msg)) domains.push('news');
  if (/gpu|cpu|grafik|procesor/i.test(msg)) domains.push('tech');
  
  // Multi-domain if 2+ distinct domains
  if (domains.length >= 2) {
    return true;
  }
  
  // Check for explicit connectors between different topics
  if (MULTI_DOMAIN_MARKERS.some(m => msg.includes(m))) {
    // Verify there are actually different topics
    const parts = msg.split(/\s+a\s+|\s+i\s+/i);
    if (parts.length >= 2) {
      const part1Domain = detectDomain(parts[0]);
      const part2Domain = detectDomain(parts[1]);
      if (part1Domain !== part2Domain && 
          part1Domain !== Domain.UNKNOWN && 
          part2Domain !== Domain.UNKNOWN) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Determine refusal reason for better UX messaging
 * v36.9: Uses RefusalReason from cre-decision-types.js
 */
export function determineRefusalReason(state) {
  if (state.epistemic.dataDependency === DataDependency.LIVE && !state.epistemic.hasEvidence) {
    return RefusalReason.MISSING_REQUIRED_DATA;
  }
  if (state.epistemic.impossibility) {
    return RefusalReason.OUT_OF_SCOPE;
  }
  if (state.epistemic.conceptExistence === ConceptExistence.NON_EXISTENT) {
    return RefusalReason.OUT_OF_SCOPE;
  }
  return RefusalReason.OUT_OF_SCOPE;
}

// ════════════════════════════════════════════════════════════════════════════
// v36.4.2 WORKFLOW DETECTION
// ════════════════════════════════════════════════════════════════════════════

// NEWS AGGREGATION patterns
const NEWS_AGGREGATION_PATTERNS = [
  /souhrn.*zpráv/i,                              // "souhrn zpráv"
  /přehled.*novin/i,                             // "přehled novin"
  /co (se|je) nov[éý]ho/i,                       // "co je nového"
  /zprávy.*za.*(týden|měsíc|den)/i,              // "zprávy za týden"
  /news.*summary/i,                              // English variant
  /aktuální.*dění/i,                             // "aktuální dění"
  /události.*posledn/i                           // "události z posledních..."
];

// SEARCH patterns (market search, find items)
const SEARCH_PATTERNS = [
  /najdi\s+mi/i,                                 // "najdi mi"
  /vyhledej/i,                                   // "vyhledej"
  /hledám/i,                                     // "hledám"
  /kde\s+(koupím|seženu|najdu)/i,               // "kde koupím"
  /inzerát/i,                                    // "inzerát"
  /nabídka\s+na/i,                               // "nabídka na"
  /find\s+me/i                                   // English variant
];

// REPORT patterns (generate document)
const REPORT_PATTERNS = [
  /vytvoř.*report/i,                             // "vytvoř report"
  /generuj.*pdf/i,                               // "generuj PDF"
  /připrav.*dokument/i,                          // "připrav dokument"
  /shrnutí.*do.*(pdf|dokumentu)/i,              // "shrnutí do PDF"
  /export/i                                      // "export"
];

// ADVICE patterns (just explanation)
const ADVICE_PATTERNS = [
  /jak\s+(najít|vybrat|koupit)/i,               // "jak najít"
  /poraď.*mi/i,                                  // "poraď mi"
  /co.*doporučuješ/i,                           // "co doporučuješ"
  /jaký.*je.*nejlepší/i,                        // "jaký je nejlepší"
  /vysvětli/i                                    // "vysvětli"
];

// CALENDAR patterns (deterministic, can be computed)
const CALENDAR_PATTERNS = [
  /kdy.*bude.*úplněk/i,                         // "kdy bude úplněk"
  /za kolik.*dní.*úplněk/i,                    // "za kolik dní úplněk"
  /fáze.*měsíce/i,                              // "fáze měsíce"
  /nov.*měsíc/i,                                // "nový měsíc" (lunar)
  /kolik.*dní.*do/i,                            // "kolik dní do vánoc"
  /kdy.*je.*(vánoce|velikonoce|svátek)/i,      // "kdy je svátek"
  /jaký.*je.*dnes.*den/i,                       // "jaký je dnes den"
  /co.*je.*za.*den/i,                           // "co je za den"
  /kolikátého.*je/i                             // "kolikátého je"
];

/**
 * Detect workflow intent from message
 * Returns WorkflowIntent enum value
 */
export function detectWorkflowIntent(message) {
  const msg = message.toLowerCase();
  
  // Priority order: specific intents first
  
  // CALENDAR (deterministic computation - highest priority)
  if (CALENDAR_PATTERNS.some(p => p.test(msg))) {
    return WorkflowIntent.CALENDAR;
  }
  
  // NEWS_AGGREGATION (requires external corpus)
  if (NEWS_AGGREGATION_PATTERNS.some(p => p.test(msg))) {
    return WorkflowIntent.NEWS_AGGREGATION;
  }
  
  // SEARCH (requires marketplace/database access)
  if (SEARCH_PATTERNS.some(p => p.test(msg))) {
    return WorkflowIntent.SEARCH;
  }
  
  // REPORT (requires data for artifact)
  if (REPORT_PATTERNS.some(p => p.test(msg))) {
    return WorkflowIntent.REPORT;
  }
  
  // ADVICE (can answer from knowledge)
  if (ADVICE_PATTERNS.some(p => p.test(msg))) {
    return WorkflowIntent.ADVICE;
  }
  
  return WorkflowIntent.CHAT;
}

/**
 * Detect what kind of data is required for this query
 */
export function detectDataRequirement(message, workflowIntent, domain) {
  // NEWS always needs corpus
  if (workflowIntent === WorkflowIntent.NEWS_AGGREGATION) {
    return DataRequirement.CORPUS;
  }
  
  // SEARCH needs structured data
  if (workflowIntent === WorkflowIntent.SEARCH) {
    return DataRequirement.STRUCTURED;
  }
  
  // REPORT needs some form of data
  if (workflowIntent === WorkflowIntent.REPORT) {
    // What kind depends on domain
    if (domain === Domain.NEWS || /zpráv|novin/i.test(message)) {
      return DataRequirement.CORPUS;
    }
    if (domain === Domain.PRICES || /cen|inzerát/i.test(message)) {
      return DataRequirement.STRUCTURED;
    }
    if (domain === Domain.WEATHER) {
      return DataRequirement.REALTIME;
    }
    return DataRequirement.STRUCTURED;
  }
  
  // ADVICE can usually work from knowledge
  if (workflowIntent === WorkflowIntent.ADVICE) {
    return DataRequirement.NONE;
  }
  
  return DataRequirement.NONE;
}

/**
 * Check if workflow preconditions are met
 * Returns { met: boolean, missing: string[] }
 */
export function checkWorkflowPreconditions(state) {
  const result = {
    met: true,
    missing: []
  };
  
  const { workflow } = state;
  
  // If no data required, preconditions are met
  if (workflow.dataRequirement === DataRequirement.NONE) {
    return result;
  }
  
  // Check data availability
  if (!workflow.dataAvailable) {
    result.met = false;
    
    switch (workflow.dataRequirement) {
      case DataRequirement.CORPUS:
        result.missing.push('external_news_sources');
        break;
      case DataRequirement.STRUCTURED:
        result.missing.push('search_backend');
        break;
      case DataRequirement.REALTIME:
        result.missing.push('realtime_data_source');
        break;
    }
  }
  
  // Check external sources if needed
  if (workflow.dataRequirement === DataRequirement.CORPUS && 
      workflow.externalSources.length === 0) {
    result.met = false;
    if (!result.missing.includes('external_news_sources')) {
      result.missing.push('news_source_selection');
    }
  }
  
  return result;
}

// ════════════════════════════════════════════════════════════════════════════
// SLOT EXTRACTION
// ════════════════════════════════════════════════════════════════════════════

const MONTHS = {
  'leden': 1, 'únor': 2, 'březen': 3, 'duben': 4, 'květen': 5, 'červen': 6,
  'červenec': 7, 'srpen': 8, 'září': 9, 'říjen': 10, 'listopad': 11, 'prosinec': 12,
  'ledna': 1, 'února': 2, 'března': 3, 'dubna': 4, 'května': 5, 'června': 6,
  'července': 7, 'srpna': 8, 'září': 9, 'října': 10, 'listopadu': 11, 'prosince': 12,
  'lednu': 1, 'únoru': 2, 'březnu': 3, 'dubnu': 4, 'květnu': 5, 'červnu': 6,
  'červenci': 7, 'srpnu': 8, 'září': 9, 'říjnu': 10, 'listopadu': 11, 'prosinci': 12
};

export function extractSlots(message, state) {
  const msg = message.toLowerCase();
  const extracted = [];
  
  // Year
  const yearMatch = msg.match(/\b(20\d{2})\b/);
  if (yearMatch) {
    if (state.fillSlot('year', parseInt(yearMatch[1]), 1.0, 'user')) {
      extracted.push('year');
    }
  }
  
  // Month
  for (const [name, num] of Object.entries(MONTHS)) {
    if (msg.includes(name)) {
      if (state.fillSlot('month', num, 1.0, 'user')) {
        extracted.push('month');
      }
      break;
    }
  }
  
  // Location
  if (/prah[ay]|prague|praze/i.test(msg)) {
    if (state.fillSlot('location', 'Praha', 1.0, 'user')) {
      extracted.push('location');
    }
  } else if (/brn[oěu]/i.test(msg)) {
    if (state.fillSlot('location', 'Brno', 1.0, 'user')) {
      extracted.push('location');
    }
  }
  
  return extracted;
}

// ════════════════════════════════════════════════════════════════════════════
// NOTE: Templates moved to response-renderer.js (v36.9)
// CRE now returns CREDecision objects, ResponseRenderer handles text.
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// NOTE: Speech Act & Correction enforcement moved to response-renderer.js (v36.9)
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// CALENDAR QUERY HANDLER (v36.5)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Handle calendar queries with deterministic computation
 * Returns response string or null if cannot handle
 */
function handleCalendarQuery(message) {
  const msg = message.toLowerCase();
  const systemSlots = getSystemSlots();
  
  // Moon phase query
  if (/úplněk|fáze.*měsíce|nov.*měsíc/i.test(msg)) {
    const moonInfo = getMoonPhaseInfo();
    
    if (/za kolik/i.test(msg) || /kdy.*bude/i.test(msg)) {
      return `🌕 Další úplněk bude za **${moonInfo.daysUntilFullMoon} dní** (${moonInfo.nextFullMoonDate}).

Aktuální fáze: ${moonInfo.currentPhase}
Dnešní datum: ${systemSlots.date}`;
    }
    
    return `🌙 **Aktuální fáze měsíce:** ${moonInfo.currentPhase}

Další úplněk: za ${moonInfo.daysUntilFullMoon} dní (${moonInfo.nextFullMoonDate})
Dnešní datum: ${systemSlots.date}`;
  }
  
  // Current date query
  if (/jaký.*je.*dnes.*den|co.*je.*za.*den|kolikátého/i.test(msg)) {
    return `📅 Dnes je **${systemSlots.dayOfWeek}, ${systemSlots.date}**

Čas: ${systemSlots.time} (${systemSlots.timezone})`;
  }
  
  // Days until event (simple calculation)
  const daysUntilMatch = msg.match(/kolik.*dní.*do\s+(\S+)/i);
  if (daysUntilMatch) {
    const event = daysUntilMatch[1];
    
    // Handle common events
    const now = new Date();
    let targetDate = null;
    let eventName = event;
    
    if (/váno/i.test(event)) {
      targetDate = new Date(now.getFullYear(), 11, 24); // Dec 24
      if (targetDate < now) targetDate = new Date(now.getFullYear() + 1, 11, 24);
      eventName = 'Vánoc';
    } else if (/velikono/i.test(event)) {
      // Easter is complex - approximate
      eventName = 'Velikonoc';
    } else if (/nový.*rok|silvestr/i.test(event)) {
      targetDate = new Date(now.getFullYear() + 1, 0, 1); // Jan 1
      eventName = 'Nového roku';
    }
    
    if (targetDate) {
      const daysUntil = Math.ceil((targetDate - now) / (1000 * 60 * 60 * 24));
      return `📅 Do **${eventName}** zbývá **${daysUntil} dní**.

Dnešní datum: ${systemSlots.date}`;
    }
  }
  
  return null; // Cannot handle - pass to LLM
}

// ════════════════════════════════════════════════════════════════════════════
// EXECUTION FALLBACK DETERMINATION (v36.4.4)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Determine the appropriate fallback action when execution cannot proceed
 * 
 * @param {WorkflowIntent} workflowIntent - The detected workflow intent
 * @param {string[]} missing - List of missing capabilities/data
 * @returns {SystemAction} - The fallback action to take
 */
function determineExecutionFallback(workflowIntent, missing) {
  // NEWS_AGGREGATION without sources → ask for sources
  if (workflowIntent === WorkflowIntent.NEWS_AGGREGATION) {
    return SystemAction.ASK_DATA_SOURCE;
  }
  
  // SEARCH without backend → offer alternatives
  if (workflowIntent === WorkflowIntent.SEARCH) {
    return SystemAction.OFFER_SEARCH_SETUP;
  }
  
  // REPORT without data → block
  if (workflowIntent === WorkflowIntent.REPORT) {
    if (missing.includes('data') || missing.includes('dataLength')) {
      return SystemAction.BLOCK_NO_DATA;
    }
    return SystemAction.ASK_DATA_SOURCE;
  }
  
  // Default fallback
  return SystemAction.ASK_CLARIFICATION;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN PROCESS FUNCTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Process a message through the Conversational Reasoning Engine
 *
 * v36.9: CRE no longer accepts llmCall parameter.
 * Text generation is handled exclusively by ResponseRenderer.
 * LLM calls use only SYNTHESIZER token via llmGateway.
 *
 * @param {string} message - User message
 * @param {DialogState} state - Dialog state (will be mutated)
 * @param {object} context - Additional context (source URL, sessionId, etc.)
 * @returns {Promise<CREResult>}
 */
export async function process(message, state, context = {}) {
  try {
    // v36.9: Generate unique decisionId for this request (propagated to all subsystems)
    const decisionId = context.decisionId || `cre-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: DETECT
    // ═══════════════════════════════════════════════════════════════════════

    const domain = detectDomain(message);
    const intent = detectIntent(message, state);
    const volatility = detectVolatility(message, domain);
    
    // v36.4.4: Workflow detection
    const workflowIntent = detectWorkflowIntent(message);
    const dataRequirement = detectDataRequirement(message, workflowIntent, domain);
    
    // Update state
    state.setDomain(domain);
    state.dialogIntent = intent;
    
    // v36.4.4: Update workflow state
    state.workflow.intent = workflowIntent;
    state.workflow.dataRequirement = dataRequirement;
    state.workflow.dataAvailable = !!(context.data || context.corpus || context.searchBackend);
    state.workflow.externalSources = context.newsSources || [];
    
    // v36.4.4: Detect additional epistemic flags
    state.epistemic.dataDependency = detectDataDependency(message, domain);
    state.epistemic.conceptExistence = detectConceptExistence(message);
    state.epistemic.impossibility = detectImpossibility(message, domain);
    state.dialogFlags.multiDomainQuery = detectMultiDomainQuery(message);
    state.dialogFlags.certaintyPressure = detectCertaintyPressure(message);
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: EXTRACT SLOTS
    // ═══════════════════════════════════════════════════════════════════════
    
    const extractedSlots = extractSlots(message, state);
    
    // BUILD intent → lock all slots after extraction
    if (intent === DialogIntent.BUILD) {
      state.lockAllResolved();
    }
    
    // CHALLENGE intent → enter correction mode
    if (intent === DialogIntent.CHALLENGE) {
      state.correctionMode = true;
    }
    
    // CONFIRM intent → revoke clarification permission
    if (intent === DialogIntent.CONFIRM) {
      state.setPermission('mayAskClarification', false);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: UPDATE EPISTEMIC STATE
    // ═══════════════════════════════════════════════════════════════════════
    
    // Set epistemic based on volatility and evidence
    const certainty = context.source ? Certainty.HIGH :
                      volatility === Volatility.LOW ? Certainty.HIGH : Certainty.MEDIUM;
    const evidenceRequired = volatility === Volatility.HIGH;
    
    state.setEpistemic(certainty, volatility, evidenceRequired);
    
    // Handle evidence from context
    if (context.source) {
      // Evidence provided - grant answer permission and relax enforcement
      state.epistemic.hasEvidence = true;
      state.setPermission('mayAnswer', true);
      state.enforcement.forbidNumbers = false;
      state.enforcement.forbidPrices = false;
      state.enforcement.requireDisclaimer = false;
    } else if (volatility === Volatility.HIGH) {
      // HIGH volatility without evidence → revoke answer permission
      state.setPermission('mayAnswer', false);
    }
    
    logger.info('CRE', 'Analysis complete', {
      decisionId,
      domain, intent, volatility, certainty,
      extractedSlots,
      openSlots: state.getOpenSlots(),
      permissions: state.permissions,
      enforcement: state.enforcement
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: DECISION MATRIX
    // ═══════════════════════════════════════════════════════════════════════
    
    let decision = decide(state);
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4.5: EXECUTION AUTHORITY (v36.4.4)
    // ═══════════════════════════════════════════════════════════════════════

    const executionContext = createSafeExecutionContext(context);
    const executionGuard = guardExecution(state.workflow.intent, executionContext);

    logger.info('CRE', 'Execution authority check', {
      decisionId,
      workflowIntent: state.workflow.intent,
      canExecute: executionGuard.canExecute,
      missing: executionGuard.missing,
      blockReason: executionGuard.blockReason
    });

    // Override decision if execution cannot proceed
    if (!executionGuard.canExecute) {
      if (executionGuard.fallbackResponse) {
        logger.warn('CRE', 'Execution blocked - using deterministic fallback', {
          originalAction: decision.action,
          blockReason: executionGuard.blockReason
        });

        // v36.9: Return fallback as rendered execution template
        const fallbackText = responseRenderer.renderExecutionFallback(
          determineExecutionFallback(state.workflow.intent, executionGuard.missing),
          { workflowIntent: state.workflow.intent, message }
        );

        return CREResult.ok(fallbackText, SpeechAct.QUESTION, decision, state, null);
      }

      const fallbackAction = determineExecutionFallback(state.workflow.intent, executionGuard.missing);

      logger.warn('CRE', 'Execution blocked - applying fallback action', {
        originalAction: decision.action,
        fallbackAction: fallbackAction,
        reason: executionGuard.error
      });

      decision = new Decision(
        fallbackAction,
        executionGuard.error || 'Execution preconditions not met',
        SpeechAct.QUESTION
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4.6: CALENDAR AUTO-RESPONSE (v36.5)
    // ═══════════════════════════════════════════════════════════════════════

    if (state.workflow.intent === WorkflowIntent.CALENDAR) {
      const calendarResponse = handleCalendarQuery(message);
      if (calendarResponse) {
        logger.info('CRE', 'Calendar query auto-answered', { query: message });
        return CREResult.ok(calendarResponse, SpeechAct.FACT, decision, state, null);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: CREATE CRE DECISION (v36.9 - NO TEXT GENERATION)
    // ═══════════════════════════════════════════════════════════════════════
    // CRE creates a structured CREDecision object.
    // Text generation happens ONLY in ResponseRenderer.

    let creDecision;
    let speechAct = decision.speechAct;

    switch (decision.action) {
      case SystemAction.ASK_CLARIFICATION: {
        const slot = decision.askSlot || 'clarification';
        creDecision = askUser(
          [createSlotRequest(slot, 'text', { required: true })],
          ResponseTemplate.SLOT_REQUEST
        );
        speechAct = SpeechAct.QUESTION;
        break;
      }

      case SystemAction.DEFER_TO_SEARCH: {
        creDecision = refuse(RefusalReason.MISSING_REQUIRED_DATA, [
          'Mohu vyhledat aktuální data, upřesni zdroj.'
        ]);
        speechAct = SpeechAct.REFUSAL;
        break;
      }

      case SystemAction.RESET_CONTEXT: {
        creDecision = askUser(
          [createSlotRequest('topic', 'text', { description: '🔄 Změnil jsi téma. Co tě teď zajímá?' })],
          ResponseTemplate.SLOT_REQUEST
        );
        state.previousDomain = null;
        speechAct = SpeechAct.QUESTION;
        break;
      }

      case SystemAction.REFUSE: {
        const refusalReason = determineRefusalReason(state);
        creDecision = refuse(refusalReason);
        speechAct = SpeechAct.REFUSAL;
        break;
      }

      case SystemAction.ASK_DATA_SOURCE: {
        const sourceType = state.workflow.intent === WorkflowIntent.NEWS_AGGREGATION ? 'news' :
                          state.workflow.intent === WorkflowIntent.REPORT ? 'report' : 'default';
        creDecision = askUser(
          [createSlotRequest('source', 'text', { required: true })],
          ResponseTemplate.SOURCE_SELECTION,
          { sourceType }
        );
        speechAct = SpeechAct.QUESTION;
        break;
      }

      case SystemAction.OFFER_SEARCH_SETUP: {
        const searchType = /auto|vůz|vozidl|4x4|motor/i.test(message) ? 'cars' :
                          /byt|nemovitost|dům|pronájem|sreality/i.test(message) ? 'flats' : 'default';
        creDecision = askUser(
          [createSlotRequest('source', 'text', { required: true })],
          ResponseTemplate.SOURCE_SELECTION,
          { sourceType: searchType }
        );
        speechAct = SpeechAct.QUESTION;
        break;
      }

      case SystemAction.BLOCK_NO_DATA: {
        creDecision = refuse(RefusalReason.MISSING_REQUIRED_DATA, [
          'Poskytneš mi data',
          'Řekneš mi, odkud je mám získat',
          'Navrhneme alternativní postup'
        ]);
        speechAct = SpeechAct.REFUSAL;
        break;
      }

      case SystemAction.ANSWER_WITH_BOUNDS: {
        const bounds = decision.getBounds?.(state) || state.getBoundedAnswerOptions?.() || [];
        creDecision = answer(ResponseTemplate.FACTUAL_ANSWER, {
          data: {
            bounds: bounds,
            type: 'conditional',
            userMessage: message
          },
          verbosity: Verbosity.NORMAL,
          context: { resolvedSlots: state.getResolvedSlots() }
        });
        speechAct = SpeechAct.CONDITIONAL;
        break;
      }

      default: {
        // ANSWER, ANSWER_WITH_DISCLAIMER, ANSWER_STRUCTURAL, CONFIRM_CONTEXT, CORRECT_PREVIOUS
        // All use FACTUAL_ANSWER or EXPLANATION template with data for synthesis
        const templateType = decision.action === SystemAction.CONFIRM_CONTEXT
          ? ResponseTemplate.CONFIRMATION
          : ResponseTemplate.FACTUAL_ANSWER;

        creDecision = answer(templateType, {
          data: {
            action: decision.action,
            constraints: decision.constraints || [],
            resolvedSlots: state.getResolvedSlots(),
            userMessage: message
          },
          verbosity: Verbosity.NORMAL,
          context: { resolvedSlots: state.getResolvedSlots() }
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6: RENDER DECISION VIA ResponseRenderer (v36.9)
    // ═══════════════════════════════════════════════════════════════════════
    // ResponseRenderer handles: text generation, speech act enforcement,
    // quality gate, meta-claim sanitization.

    const renderContext = {
      state,
      decision,
      speechAct,
      action: decision.action,
      userMessage: message,
      constraints: decision.constraints || [],
      resolvedSlots: state.getResolvedSlots(),
      sessionId: context.sessionId || 'cre-' + Date.now(),
      decisionId,
      executionResults: context.executionResults
    };

    const renderResult = await responseRenderer.render(creDecision, renderContext);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 7: EVIDENCE-BASED CONFIDENCE TRACKING
    // ═══════════════════════════════════════════════════════════════════════

    if (decision.action === SystemAction.CORRECT_PREVIOUS) {
      state.recordCorrection();
    } else if (decision.action !== SystemAction.ASK_CLARIFICATION &&
               decision.action !== SystemAction.DEFER_TO_SEARCH) {
      if (state.epistemic.hasEvidence || context.source) {
        state.recordVerifiedAnswer();
        state.updateCoherence(0.1);
      } else {
        state.recordUnverifiedAnswer();
        state.updateCoherence(0.05);
      }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 8: RETURN RESULT
    // ═══════════════════════════════════════════════════════════════════════

    const result = CREResult.ok(
      renderResult.text,
      speechAct,
      decision,
      state,
      renderResult.metadata?.qualityGate || null
    );
    result.enforcement = renderResult.enforcement || [];
    result.creDecision = creDecision;  // Attach structured decision for debugging
    result.decisionId = decisionId;    // v36.9: Propagate for audit/replay

    return result;
    
  } catch (error) {
    logger.error('CRE', 'Processing error', error);
    return CREResult.fail(error.message);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// NOTE: buildPrompt moved to response-renderer.js as buildSynthesisPrompt (v36.9)
// CRE no longer builds prompts or calls LLM directly for text generation.
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export {
  DialogState,
  Slot,
  DecisionTrace,
  Domain,
  DialogIntent,
  Certainty,
  Volatility,
  Verifiability,
  TemporalScope,
  ReasoningDepth,
  AnswerMode,
  SystemAction,
  SpeechAct,
  Decision
};

export default {
  process,
  CREResult,
  detectIntent,
  detectDomain,
  detectVolatility,
  extractSlots,
  explainDecision
};
