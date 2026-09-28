// C.3 v35.4 Authoritative Dialog State
// ══════════════════════════════════════════════════════════════════════════════
// 
// DialogState ROZHODUJE a VYNUCUJE, ne jen popisuje.
// LLM nikdy nerozhoduje o těchto polích.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// ENUMS
// ════════════════════════════════════════════════════════════════════════════

export const Domain = {
  UNKNOWN: 'unknown',
  ASTRONOMICAL: 'astronomical',
  PRICES: 'prices',
  WEATHER: 'weather',
  NEWS: 'news',
  TECHNICAL: 'technical',
  FACTUAL: 'factual',
  CREATIVE: 'creative'
};

export const DialogIntent = {
  SEEK: 'SEEK',
  BUILD: 'BUILD',
  CONFIRM: 'CONFIRM',
  CHALLENGE: 'CHALLENGE',
  EXPLORE: 'EXPLORE',
  COMMAND: 'COMMAND'
};

// ════════════════════════════════════════════════════════════════════════════
// WORKFLOW INTENT (v36.4.2 - what action is needed?)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Rozlišuje TYP AKCE, kterou uživatel očekává:
 * - ADVICE: vysvětlení, doporučení (lze odpovědět z knowledge)
 * - SEARCH: vyhledání konkrétní položky (vyžaduje backend/crawler)
 * - NEWS_AGGREGATION: souhrn zpráv (vyžaduje external corpus)
 * - REPORT: generování dokumentu (vyžaduje data)
 * - CHAT: běžná konverzace
 * - CALENDAR: kalendářní dotazy, fáze měsíce, svátky
 */
export const WorkflowIntent = {
  ADVICE: 'ADVICE',               // "jak najít auto"
  SEARCH: 'SEARCH',               // "najdi mi inzerát"
  NEWS_AGGREGATION: 'NEWS_AGGREGATION', // "souhrn zpráv za týden"
  REPORT: 'REPORT',               // "vytvoř report"
  CALENDAR: 'CALENDAR',           // "kdy bude úplněk"
  CHAT: 'CHAT'                    // běžná konverzace
};

// ════════════════════════════════════════════════════════════════════════════
// DATA REQUIREMENT (v36.4.2 - what data is needed?)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Specifikuje jaká data jsou potřeba pro odpověď:
 * - NONE: žádná externí data
 * - REALTIME: aktuální ceny, počasí, kurzy
 * - CORPUS: sada dokumentů (zprávy, články)
 * - STRUCTURED: databáze, registry (inzeráty, produkty)
 */
export const DataRequirement = {
  NONE: 'NONE',
  REALTIME: 'REALTIME',
  CORPUS: 'CORPUS',
  STRUCTURED: 'STRUCTURED'
};

// ════════════════════════════════════════════════════════════════════════════
// EPISTEMIC ENUMS (rozšířené)
// ════════════════════════════════════════════════════════════════════════════

export const Certainty = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH'
};

export const Volatility = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH'
};

// Jak lze informaci ověřit (categorical)
export const Verifiability = {
  NONE: 'NONE',           // Nelze ověřit (názory, spekulace)
  WEB: 'WEB',             // Ověřitelné web searchem
  OFFICIAL: 'OFFICIAL',   // Oficiální zdroje (státní, vědecké)
  CONSENSUS: 'CONSENSUS'  // Obecný konsensus (matematika, fyzika)
};

// Verifiability scores (gradient 0..1) for Decision Matrix
// Allows: 0.8 = answer, 0.4 = answer + disclaimer, 0.1 = ask/refuse
export const VerifiabilityScore = {
  [Verifiability.NONE]: 0.1,      // Almost unverifiable
  [Verifiability.WEB]: 0.5,       // Can be found online
  [Verifiability.OFFICIAL]: 0.8,  // Official sources exist
  [Verifiability.CONSENSUS]: 0.95 // Expert consensus
};

/**
 * Get verifiability as gradient score (0..1)
 * Can be used in Decision Matrix for thresholds
 */
export function getVerifiabilityScore(verifiability) {
  if (typeof verifiability === 'number') {
    return Math.max(0, Math.min(1, verifiability));
  }
  return VerifiabilityScore[verifiability] || 0.5;
}

// Časová citlivost informace
export const TemporalScope = {
  STATIC: 'STATIC',       // Neměnné (historie, matematika)
  YEARLY: 'YEARLY',       // Mění se ročně (astronomie, kalendář)
  MONTHLY: 'MONTHLY',     // Mění se měsíčně
  REALTIME: 'REALTIME'    // Mění se v reálném čase (ceny, počasí)
};

// ════════════════════════════════════════════════════════════════════════════
// DATA DEPENDENCY (v36.3 - zdroj dat)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Rozlišuje TYP nejistoty:
 * - STATIC: Data existují, stačí znalosti (historie, matematika)
 * - LIVE: Vyžaduje real-time přístup (počasí, ceny, traffic)
 * - UNKNOWN: Nelze určit
 */
export const DataDependency = {
  STATIC: 'STATIC',   // Lze odpovědět ze znalostí
  LIVE: 'LIVE',       // Vyžaduje live data source
  UNKNOWN: 'UNKNOWN'  // Nelze určit
};

// ════════════════════════════════════════════════════════════════════════════
// CONCEPT EXISTENCE (v36.4 - existuje koncept vůbec?)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Rozlišuje zda koncept v dotazu EXISTUJE:
 * - KNOWN: Známý, reálný koncept
 * - UNKNOWN: Není jasné, může existovat
 * - NON_EXISTENT: Smyšlený, pseudovědecký, neexistující
 */
export const ConceptExistence = {
  KNOWN: 'KNOWN',           // Verified real concept
  UNKNOWN: 'UNKNOWN',       // Uncertain, may or may not exist
  NON_EXISTENT: 'NON_EXISTENT'  // Fabricated, pseudoscience, impossible
};

// ════════════════════════════════════════════════════════════════════════════
// REFUSAL REASON (v36.4 - proč odmítám?)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Specifikuje PROČ CRE odmítá odpovědět:
 * - DATA_UNAVAILABLE: Nemám přístup k live datům
 * - IMPOSSIBLE: Nelze odpovědět (predikce, nedeterministické)
 * - NON_EXISTENT: Koncept neexistuje
 * - OUT_OF_SCOPE: Mimo scope (bezpečnost, etika)
 */
export const RefusalReason = {
  DATA_UNAVAILABLE: 'DATA_UNAVAILABLE',
  IMPOSSIBLE: 'IMPOSSIBLE',
  NON_EXISTENT: 'NON_EXISTENT',
  OUT_OF_SCOPE: 'OUT_OF_SCOPE'
};

// ════════════════════════════════════════════════════════════════════════════
// REASONING DEPTH (jak daleko může systém jít)
// ════════════════════════════════════════════════════════════════════════════

export const ReasoningDepth = {
  SURFACE: 'SURFACE',           // Jen fakta, žádné odvozování
  COMPARATIVE: 'COMPARATIVE',   // Srovnání, ale ne doporučení
  EXPLORATORY: 'EXPLORATORY',   // Prozkoumávání možností
  ADVISORY: 'ADVISORY'          // Doporučení (vyžaduje explicitní souhlas)
};

// ════════════════════════════════════════════════════════════════════════════
// ANSWER MODE (jak odpovědět při nejistotě)
// ════════════════════════════════════════════════════════════════════════════

export const AnswerMode = {
  PRECISE: 'PRECISE',           // Musí být přesné, jinak neodpovídej
  BOUNDED: 'BOUNDED',           // Odpověz s podmínkami ("pokud X, pak Y")
  EXPLORATORY: 'EXPLORATORY'    // Nabídni možnosti
};

// ════════════════════════════════════════════════════════════════════════════
// DECISION TRACE (proč se rozhodlo + proč se NErozhodlo)
// ════════════════════════════════════════════════════════════════════════════

export class DecisionTrace {
  constructor() {
    // Matched rule info
    this.matchedRule = {
      id: -1,
      name: null,
      priority: -1
    };
    
    // All evaluated rules with results
    this.evaluatedRules = [];  // Array<{ id, name, result: 'MATCH'|'NO_MATCH', reason }>
    
    // Input state snapshot
    this.inputs = {
      domain: null,
      intent: null,
      openSlots: [],
      certainty: null,
      volatility: null,
      verifiability: null,
      temporalScope: null,
      correctionMode: false,
      hasEvidence: false,
      permissions: {},
      enforcement: {},
      confidence: {}
    };
    
    this.timestamp = Date.now();
  }
  
  setMatchedRule(index, name, priority = index) {
    this.matchedRule = { id: index, name, priority };
  }
  
  /**
   * Record evaluation of a rule (match or no-match with reason)
   */
  recordEvaluation(id, name, matched, reason = null) {
    this.evaluatedRules.push({
      id,
      name,
      result: matched ? 'MATCH' : 'NO_MATCH',
      reason: reason || (matched ? 'Condition satisfied' : 'Condition not met')
    });
  }
  
  captureInputs(state) {
    this.inputs = {
      domain: state.domain,
      intent: state.dialogIntent,
      openSlots: state.getOpenSlots(),
      certainty: state.epistemic.certainty,
      volatility: state.epistemic.volatility,
      verifiability: state.epistemic.verifiability,
      temporalScope: state.epistemic.temporalScope,
      correctionMode: state.correctionMode || false,
      hasEvidence: state.epistemic.hasEvidence || false,
      permissions: { ...state.permissions },
      enforcement: { ...state.enforcement },
      confidence: state.confidence ? { ...state.confidence } : {}
    };
  }
  
  /**
   * Get rules that didn't match
   */
  getRejectedRules() {
    return this.evaluatedRules.filter(r => r.result === 'NO_MATCH');
  }
  
  /**
   * Get count of rules evaluated before match
   */
  getRulesBeforeMatch() {
    return this.matchedRule.id;
  }
  
  toJSON() {
    return {
      matchedRule: this.matchedRule,
      evaluatedRules: this.evaluatedRules,
      inputs: this.inputs,
      timestamp: this.timestamp
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // MACHINE-READABLE OUTPUTS (pro adaptaci, ne jen audit)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Get structured data for auto-fix/regeneration
   * This is the KEY improvement - trace is now usable, not just loggable
   */
  getAdaptationData() {
    return {
      decision: {
        ruleId: this.matchedRule.id,
        ruleName: this.matchedRule.name,
        action: this.outputAction || null
      },
      context: {
        domain: this.inputs.domain,
        intent: this.inputs.intent,
        certainty: this.inputs.certainty,
        volatility: this.inputs.volatility,
        hasEvidence: this.inputs.hasEvidence
      },
      constraints: this._extractConstraints(),
      repairInstructions: this._generateRepairInstructions(),
      confidenceImpact: this._calculateConfidenceImpact()
    };
  }
  
  /**
   * Extract active constraints from enforcement
   */
  _extractConstraints() {
    const constraints = [];
    const enf = this.inputs.enforcement || {};
    
    if (enf.requireDisclaimer) constraints.push('REQUIRE_DISCLAIMER');
    if (enf.forbidNumbers) constraints.push('NO_SPECIFIC_NUMBERS');
    if (enf.forbidPrices) constraints.push('NO_SPECIFIC_PRICES');
    if (enf.forbidDates) constraints.push('NO_SPECIFIC_DATES');
    if (enf.requireHedge) constraints.push('REQUIRE_HEDGE');
    
    return constraints;
  }
  
  /**
   * Generate repair instructions for regeneration
   */
  _generateRepairInstructions() {
    const instructions = [];
    
    // Based on why rules were rejected, generate guidance
    for (const rule of this.getRejectedRules()) {
      if (rule.name === 'NO_ANSWER_PERMISSION' && !this.inputs.hasEvidence) {
        instructions.push({
          type: 'SEEK_EVIDENCE',
          message: 'Odpověď vyžaduje externí ověření. Použij web search.'
        });
      }
      
      if (rule.name === 'OPEN_SLOTS' && this.inputs.openSlots.length > 0) {
        instructions.push({
          type: 'FILL_SLOTS',
          message: `Chybí informace: ${this.inputs.openSlots.join(', ')}`,
          slots: this.inputs.openSlots
        });
      }
    }
    
    // Based on matched rule, add specific guidance
    if (this.matchedRule.name === 'HIGH_VOLATILITY_NO_EVIDENCE') {
      instructions.push({
        type: 'ADD_DISCLAIMER',
        message: 'Vysoká volatilita bez evidence. Přidej upozornění.'
      });
    }
    
    if (this.matchedRule.name === 'LOW_CERTAINTY') {
      instructions.push({
        type: 'HEDGE_CLAIMS',
        message: 'Nízká jistota. Použij "pravděpodobně", "přibližně".'
      });
    }
    
    return instructions;
  }
  
  /**
   * Calculate confidence impact of this decision
   * Positive = builds trust, Negative = reduces trust
   */
  _calculateConfidenceImpact() {
    let impact = 0;
    
    // Evidence-based decision → positive
    if (this.inputs.hasEvidence) {
      impact += 0.1;
    }
    
    // Correction mode → negative
    if (this.inputs.correctionMode) {
      impact -= 0.2;
    }
    
    // High volatility without evidence → negative
    if (this.inputs.volatility === 'HIGH' && !this.inputs.hasEvidence) {
      impact -= 0.1;
    }
    
    // Matched ANSWER with high certainty → positive
    if (this.matchedRule.name === 'DEFAULT_ANSWER' && 
        this.inputs.certainty === 'HIGH') {
      impact += 0.05;
    }
    
    return {
      delta: impact,
      reason: this._getImpactReason(impact)
    };
  }
  
  _getImpactReason(impact) {
    if (impact > 0) return 'Evidence-based or high certainty';
    if (impact < 0) return 'Correction or missing evidence';
    return 'Neutral';
  }
  
  /**
   * Set output action (called after decision is made)
   */
  setOutputAction(action) {
    this.outputAction = action;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // FEEDBACK MECHANISM (trace → state adaptation)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Apply feedback from this trace to the DialogState
   * This is the KEY improvement - trace AFFECTS future decisions
   * 
   * @param {DialogState} state - State to update
   * @param {Object} outcome - What happened with this decision
   */
  applyFeedback(state, outcome = {}) {
    const impact = this._calculateConfidenceImpact();
    
    // Apply confidence delta based on decision outcome
    if (outcome.wasRepaired) {
      // Repair needed = bad decision
      state.recordRepairAttempt(0.1);
      
      // KEY v36.1: Trace affects future behavior!
      // Repair means system was overconfident → increase volatility
      state.increaseVolatilityFromFeedback(0.1);
      
      logger.info('DecisionTrace', `Feedback: repair needed for ${this.matchedRule.name}, volatility increased`);
    }
    
    if (outcome.wasContradicted) {
      // User contradicted = very bad
      state.recordCorrection();
      
      // KEY v36.1: Contradiction means major overconfidence
      state.increaseVolatilityFromFeedback(0.2);
      
      logger.info('DecisionTrace', `Feedback: correction for ${this.matchedRule.name}, volatility increased significantly`);
    }
    
    if (outcome.wasConfirmed) {
      // User confirmed = good
      state.recordUserConfirmation();
      
      // Confirmation means we can be slightly less volatile
      state.decreaseVolatilityFromFeedback(0.05);
      
      logger.info('DecisionTrace', `Feedback: user confirmed ${this.matchedRule.name}`);
    }
    
    if (outcome.hadEvidence) {
      // Had external evidence = good
      state.recordVerifiedAnswer(outcome.evidenceSource);
      logger.info('DecisionTrace', `Feedback: verified answer for ${this.matchedRule.name}`);
    }
    
    // Track enforcement actions for future caution
    if (outcome.enforcedCorrection) {
      // AQG had to fix something → we should be more careful
      state.increaseVolatilityFromFeedback(0.05);
      logger.info('DecisionTrace', `Feedback: enforcement correction applied`);
    }
    
    // Record which rule was used (for pattern detection)
    if (!state.decisionHistory) {
      state.decisionHistory = [];
    }
    state.decisionHistory.push({
      rule: this.matchedRule.name,
      domain: this.inputs.domain,
      outcome: outcome.result || 'unknown',
      wasRepaired: outcome.wasRepaired || false,
      wasContradicted: outcome.wasContradicted || false,
      timestamp: Date.now()
    });
    
    // Limit history size
    if (state.decisionHistory.length > 20) {
      state.decisionHistory.shift();
    }
    
    return impact;
  }
  
  /**
   * Analyze decision history for patterns
   * Returns suggestions for decision adjustment
   */
  static analyzeHistory(state) {
    if (!state.decisionHistory || state.decisionHistory.length < 3) {
      return null;
    }
    
    const history = state.decisionHistory;
    const last5 = history.slice(-5);
    
    // Pattern: repeated LOW_CERTAINTY decisions
    const lowCertaintyCount = last5.filter(h => 
      h.rule === 'LOW_CERTAINTY' || h.rule === 'MEDIUM_CERTAINTY_DISCLAIMER'
    ).length;
    
    if (lowCertaintyCount >= 3) {
      return {
        pattern: 'REPEATED_LOW_CERTAINTY',
        suggestion: 'System is being overly cautious. Consider increasing base certainty.',
        adjustment: { certaintyBias: +0.1 }
      };
    }
    
    // Pattern: repeated repairs
    const repairCount = last5.filter(h => h.outcome === 'repaired').length;
    if (repairCount >= 2) {
      return {
        pattern: 'REPEATED_REPAIRS',
        suggestion: 'System needs stricter pre-generation constraints.',
        adjustment: { enforcementBias: +0.2 }
      };
    }
    
    // Pattern: user contradictions
    const contradictionCount = last5.filter(h => h.outcome === 'contradicted').length;
    if (contradictionCount >= 1) {
      return {
        pattern: 'USER_CONTRADICTION',
        suggestion: 'System made factual error. Increase evidence requirements.',
        adjustment: { evidenceBias: +0.3 }
      };
    }
    
    return null;
  }

  /**
   * Human-readable explanation including negative reasoning
   */
  explain() {
    const lines = [];
    
    // Header
    lines.push(`═══════════════════════════════════════════`);
    lines.push(`DECISION TRACE`);
    lines.push(`═══════════════════════════════════════════`);
    
    // Matched rule
    lines.push(`\n✅ MATCHED: ${this.matchedRule.name} (rule #${this.matchedRule.id})`);
    
    // Inputs
    lines.push(`\n📥 INPUTS:`);
    lines.push(`   Domain: ${this.inputs.domain}`);
    lines.push(`   Intent: ${this.inputs.intent}`);
    lines.push(`   Certainty: ${this.inputs.certainty}`);
    lines.push(`   Volatility: ${this.inputs.volatility}`);
    lines.push(`   Verifiability: ${this.inputs.verifiability}`);
    lines.push(`   TemporalScope: ${this.inputs.temporalScope}`);
    lines.push(`   CorrectionMode: ${this.inputs.correctionMode}`);
    lines.push(`   HasEvidence: ${this.inputs.hasEvidence}`);
    if (this.inputs.openSlots.length > 0) {
      lines.push(`   Open Slots: [${this.inputs.openSlots.join(', ')}]`);
    }
    if (this.inputs.confidence.factualSupport !== undefined) {
      lines.push(`   Confidence: factual=${this.inputs.confidence.factualSupport?.toFixed(2)}, corrections=${this.inputs.confidence.correctionCount}`);
    }
    
    // Rejected rules with reasons (NEGATIVE REASONING)
    const rejected = this.getRejectedRules();
    if (rejected.length > 0) {
      lines.push(`\n❌ REJECTED RULES (${rejected.length}):`);
      for (const r of rejected) {
        lines.push(`   [${r.id}] ${r.name}: ${r.reason}`);
      }
    }
    
    // All evaluations
    lines.push(`\n📊 EVALUATION ORDER:`);
    for (const r of this.evaluatedRules) {
      const icon = r.result === 'MATCH' ? '✅' : '❌';
      lines.push(`   ${icon} [${r.id}] ${r.name}`);
    }
    
    lines.push(`═══════════════════════════════════════════`);
    
    return lines.join('\n');
  }
  
  /**
   * Short summary for logs
   */
  summary() {
    const rejected = this.getRejectedRules();
    return `Decision: ${this.matchedRule.name} | Domain: ${this.inputs.domain} | Intent: ${this.inputs.intent} | Rejected: ${rejected.length}`;
  }
}

export const SystemAction = {
  ANSWER: 'ANSWER',
  ANSWER_WITH_DISCLAIMER: 'ANSWER_WITH_DISCLAIMER',
  ANSWER_STRUCTURAL: 'ANSWER_STRUCTURAL',
  ANSWER_WITH_BOUNDS: 'ANSWER_WITH_BOUNDS',  // "Pokud X, pak Y"
  ANSWER_PROVISIONAL: 'ANSWER_PROVISIONAL',   // v36.2: Answer + "souhlasíš?"
  ASK_CLARIFICATION: 'ASK_CLARIFICATION',
  SPLIT_OR_CLARIFY: 'SPLIT_OR_CLARIFY',       // v36.4: Multi-domain query
  REFUSE: 'REFUSE',
  CONFIRM_CONTEXT: 'CONFIRM_CONTEXT',
  CORRECT_PREVIOUS: 'CORRECT_PREVIOUS',
  DEFER_TO_SEARCH: 'DEFER_TO_SEARCH',
  DEFER_TO_SOURCE: 'DEFER_TO_SOURCE',         // v36.2: Delegate to knowledge provider
  RESET_CONTEXT: 'RESET_CONTEXT',
  
  // v36.4.2: Workflow actions
  ASK_DATA_SOURCE: 'ASK_DATA_SOURCE',         // Need to ask for source selection
  BLOCK_NO_DATA: 'BLOCK_NO_DATA',             // Cannot proceed without data
  OFFER_SEARCH_SETUP: 'OFFER_SEARCH_SETUP'    // Offer to set up search/crawler
};

export const SpeechAct = {
  FACT: 'FACT',
  ESTIMATE: 'ESTIMATE',
  HYPOTHESIS: 'HYPOTHESIS',
  SUGGESTION: 'SUGGESTION',
  QUESTION: 'QUESTION',
  REFUSAL: 'REFUSAL',
  CONFIRMATION: 'CONFIRMATION',
  CONDITIONAL: 'CONDITIONAL',     // "Pokud X, pak Y. Pokud Z, pak W."
  PROVISIONAL: 'PROVISIONAL'      // v36.2: "Myslím že X. Souhlasíš?"
};

// ════════════════════════════════════════════════════════════════════════════
// KNOWLEDGE PROVIDER INTERFACE (v36.2)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Abstract interface for external knowledge sources
 * CRE decides WHEN to use, provider decides HOW to fetch
 */
export class KnowledgeProvider {
  constructor(name, capabilities = {}) {
    this.name = name;
    this.capabilities = {
      realtime: false,      // Can fetch current data
      historical: false,    // Can fetch past data
      verified: false,      // Data is pre-verified
      structured: false,    // Returns structured data
      ...capabilities
    };
  }
  
  /**
   * Check if provider can answer this query type
   * @param {Object} query - { domain, temporalScope, verifiability }
   * @returns {boolean}
   */
  canHandle(query) {
    // Default: check if capabilities match query requirements
    if (query.temporalScope === TemporalScope.REALTIME && !this.capabilities.realtime) {
      return false;
    }
    return true;
  }
  
  /**
   * Fetch knowledge (to be overridden)
   * @param {string} query - Natural language query
   * @param {Object} context - { domain, slots, constraints }
   * @returns {Promise<KnowledgeResult>}
   */
  async fetch(query, context = {}) {
    throw new Error('KnowledgeProvider.fetch() must be implemented');
  }
  
  /**
   * Get confidence in the result
   * @returns {number} 0-1
   */
  getConfidence() {
    return this.capabilities.verified ? 0.9 : 0.6;
  }
}

/**
 * Result from knowledge provider
 */
export class KnowledgeResult {
  constructor(data, metadata = {}) {
    this.data = data;                    // The actual information
    this.source = metadata.source;       // URL or reference
    this.timestamp = metadata.timestamp || Date.now();
    this.confidence = metadata.confidence || 0.5;
    this.verified = metadata.verified || false;
    this.temporalScope = metadata.temporalScope || TemporalScope.STATIC;
  }
  
  /**
   * Check if result is still fresh
   */
  isFresh(maxAgeMs = 3600000) {  // Default 1 hour
    return (Date.now() - this.timestamp) < maxAgeMs;
  }
  
  /**
   * Convert to claim for CRE processing
   */
  toClaim() {
    return {
      text: this.data,
      sourceStatus: this.verified ? 'VERIFIED' : 'INFERRED',
      confidence: this.confidence,
      temporalScope: this.temporalScope,
      source: this.source
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SOURCE REGISTRY (v36.2)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Registry of available knowledge providers
 * CRE uses this to decide which source to delegate to
 */
export class SourceRegistry {
  constructor() {
    this.providers = new Map();
    this.defaultProvider = null;
  }
  
  /**
   * Register a knowledge provider
   */
  register(provider, isDefault = false) {
    this.providers.set(provider.name, provider);
    if (isDefault || !this.defaultProvider) {
      this.defaultProvider = provider;
    }
    logger.info('SourceRegistry', `Registered provider: ${provider.name}`, provider.capabilities);
  }
  
  /**
   * Find best provider for a query
   * @param {Object} query - { domain, temporalScope, verifiability }
   * @returns {KnowledgeProvider|null}
   */
  findProvider(query) {
    // First, find providers that can handle this query
    const capable = [];
    for (const [name, provider] of this.providers) {
      if (provider.canHandle(query)) {
        capable.push(provider);
      }
    }
    
    if (capable.length === 0) {
      return this.defaultProvider;
    }
    
    // Prefer verified sources for high-stakes queries
    if (query.verifiability === Verifiability.OFFICIAL || 
        query.verifiability === Verifiability.CONSENSUS) {
      const verified = capable.find(p => p.capabilities.verified);
      if (verified) return verified;
    }
    
    // Prefer realtime sources for realtime queries
    if (query.temporalScope === TemporalScope.REALTIME) {
      const realtime = capable.find(p => p.capabilities.realtime);
      if (realtime) return realtime;
    }
    
    return capable[0];
  }
  
  /**
   * Check if any provider can handle this query
   */
  hasCapableProvider(query) {
    return this.findProvider(query) !== null;
  }
  
  /**
   * Get all registered providers
   */
  getProviders() {
    return Array.from(this.providers.values());
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SLOT MODEL
// ════════════════════════════════════════════════════════════════════════════

export class Slot {
  constructor(key) {
    this.key = key;
    this.value = undefined;
    this.confidence = 0;        // 0-1
    this.source = null;         // 'user' | 'context' | 'evidence' | 'inference'
    this.locked = false;
  }
  
  fill(value, confidence, source) {
    if (this.locked) {
      logger.warn('Slot', `Attempted to fill locked slot: ${this.key}`);
      return false;
    }
    this.value = value;
    this.confidence = confidence;
    this.source = source;
    return true;
  }
  
  // Alias for tests - resolve(value, source, confidence)
  resolve(value, source = 'user', confidence = 1.0) {
    return this.fill(value, confidence, source);
  }
  
  lock() {
    this.locked = true;
  }
  
  isResolved() {
    return this.value !== undefined && this.confidence >= 0.7;
  }
  
  isLocked() {
    return this.locked === true;
  }
  
  isOpen() {
    return this.value === undefined || this.confidence < 0.7;
  }
  
  toJSON() {
    return {
      key: this.key,
      value: this.value,
      confidence: this.confidence,
      source: this.source,
      locked: this.locked
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// AUTHORITATIVE DIALOG STATE
// ════════════════════════════════════════════════════════════════════════════

export class DialogState {
  constructor() {
    this.reset();
  }
  
  reset() {
    // ─────────────────────────────────────────────────────────────────────────
    // DOMAIN & INTENT
    // ─────────────────────────────────────────────────────────────────────────
    this.domain = Domain.UNKNOWN;
    this.dialogIntent = null;
    
    // ─────────────────────────────────────────────────────────────────────────
    // SLOT-BASED FACTS
    // ─────────────────────────────────────────────────────────────────────────
    this.slots = new Map();  // key -> Slot
    this._initializeSlots();
    
    // ─────────────────────────────────────────────────────────────────────────
    // EPISTEMIC STATE (rozšířený)
    // ─────────────────────────────────────────────────────────────────────────
    this.epistemic = {
      certainty: Certainty.MEDIUM,
      volatility: Volatility.MEDIUM,
      evidenceRequired: false,
      verifiability: Verifiability.WEB,
      temporalScope: TemporalScope.STATIC,
      hasEvidence: false,
      
      // NEW: Jak daleko může systém jít v reasoning
      reasoningDepth: ReasoningDepth.SURFACE,
      
      // NEW: Jak odpovědět při nejistotě
      answerMode: AnswerMode.PRECISE,
      
      // v36.3: Variant-sensitive domains (trims, prices, versions)
      // When true: forbid specific claims without evidence
      variantSensitive: false,
      
      // v36.3: Data dependency (STATIC vs LIVE)
      // LIVE = cannot answer without real-time source
      dataDependency: DataDependency.UNKNOWN,
      
      // v36.4: Impossibility - nedeterministická budoucnost
      // When true: MUST refuse, no PROVISIONAL allowed
      impossibility: false,
      
      // v36.4: Concept existence check
      // NON_EXISTENT = refuse with explanation
      conceptExistence: ConceptExistence.KNOWN,
      
      // Volatility adjustment from feedback
      volatilityAdjustment: 0
    };
    
    // ─────────────────────────────────────────────────────────────────────────
    // DIALOG FLAGS (v36.3/36.4 - conversation-level triggers)
    // ─────────────────────────────────────────────────────────────────────────
    this.dialogFlags = {
      // User is demanding 100% certainty
      certaintyPressure: false,
      
      // User expressed frustration
      userFrustration: false,
      
      // User provided external source
      hasExternalSource: false,
      
      // v36.4: Multi-domain query detected
      // Requires SPLIT_OR_CLARIFY action
      multiDomainQuery: false
    };
    
    // ─────────────────────────────────────────────────────────────────────────
    // REFUSAL STATE (v36.4 - explicit refusal reason)
    // ─────────────────────────────────────────────────────────────────────────
    this.refusalReason = null;  // RefusalReason enum value
    
    // ─────────────────────────────────────────────────────────────────────────
    // WORKFLOW STATE (v36.4.2 - execution pipeline)
    // ─────────────────────────────────────────────────────────────────────────
    this.workflow = {
      // What action type is expected
      intent: WorkflowIntent.CHAT,
      
      // What data is required
      dataRequirement: DataRequirement.NONE,
      
      // Is required data available?
      dataAvailable: false,
      
      // External sources needed (news, markets)
      externalSources: [],
      
      // Artifact type requested (pdf, report, etc)
      artifactType: null,
      
      // Preconditions met for execution?
      preconditionsMet: false
    };
    
    // ─────────────────────────────────────────────────────────────────────────
    // TOPIC-SCOPED CONFIDENCE (ne globální!)
    // ─────────────────────────────────────────────────────────────────────────
    this.confidence = {
      // Globální coherence dialogu
      coherence: 0.5,
      
      // Počet korekcí (globální)
      correctionCount: 0,
      
      // PER-TOPIC confidence (klíč = domain)
      byTopic: new Map(),
      
      // Aktuální topic confidence (shortcut)
      get current() {
        return this._getCurrentTopicConfidence();
      }
    };
    
    // Helper pro current topic confidence
    this.confidence._getCurrentTopicConfidence = () => {
      const topic = this.domain || 'unknown';
      if (!this.confidence.byTopic.has(topic)) {
        this.confidence.byTopic.set(topic, {
          factualSupport: 0.0,
          verifiedClaims: 0,
          totalClaims: 0,
          userConfirmed: false,
          sourceVerified: false
        });
      }
      return this.confidence.byTopic.get(topic);
    };
    
    // Decision trace pro debugging
    this.lastTrace = null;
    
    // ─────────────────────────────────────────────────────────────────────────
    // PERMISSIONS (LLM cannot override these)
    // ─────────────────────────────────────────────────────────────────────────
    this.permissions = {
      mayAnswer: true,
      mayGuess: false,            // DEFAULT FALSE - no guessing!
      mayAskClarification: true,
      mayUseArtifact: false,
      maySearchWeb: false,
      mayProvideNumbers: true     // Added for forbid tracking
    };
    
    // ─────────────────────────────────────────────────────────────────────────
    // ENFORCEMENT (hard rules for output)
    // ─────────────────────────────────────────────────────────────────────────
    this.enforcement = {
      requireDisclaimer: false,
      forbidNumbers: false,
      forbidDates: false,
      forbidPrices: false,
      forbidSpecificClaims: false,
      requiredSpeechAct: null,
      requireCorrection: false
    };
    
    // ─────────────────────────────────────────────────────────────────────────
    // LAST DECISION (for audit)
    // ─────────────────────────────────────────────────────────────────────────
    this.lastDecision = {
      action: null,
      reason: null,
      speechAct: null,
      timestamp: null
    };
    
    // ─────────────────────────────────────────────────────────────────────────
    // TURN TRACKING
    // ─────────────────────────────────────────────────────────────────────────
    this.turnCount = 0;
    this.correctionMode = false;
    this.disclaimerGiven = false;
    this.previousDomain = null;
    
    // ─────────────────────────────────────────────────────────────────────────
    // COLLABORATIVE REASONING (v36.2)
    // ─────────────────────────────────────────────────────────────────────────
    this.collaborative = {
      // Pending provisional answer awaiting user confirmation
      pendingProvisional: null,
      
      // History of user confirmations/rejections
      confirmationHistory: [],
      
      // Source registry reference (set externally)
      sourceRegistry: null,
      
      // Last knowledge fetch result
      lastKnowledgeResult: null
    };
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // COLLABORATIVE REASONING METHODS (v36.2)
  // ══════════════════════════════════════════════════════════════════════════
  
  /**
   * Set the source registry for knowledge providers
   */
  setSourceRegistry(registry) {
    this.collaborative.sourceRegistry = registry;
    logger.info('DialogState', `Source registry set with ${registry.getProviders().length} providers`);
  }
  
  /**
   * Check if we should use provisional answer (collaborative mode)
   * Used when:
   * - Can't verify but have reasonable answer
   * - User hasn't confirmed yet
   * - Not a high-stakes domain
   * 
   * This is a NARROW condition - most answers should NOT be provisional
   */
  shouldUseProvisionalAnswer() {
    // Only for SEEK intent
    if (this.dialogIntent !== DialogIntent.SEEK) {
      return false;
    }
    
    // Don't use provisional for high volatility without evidence
    if (this.epistemic.volatility === Volatility.HIGH && !this.epistemic.hasEvidence) {
      return false;
    }
    
    // Don't use for CONSENSUS or OFFICIAL verifiability - those are high-confidence
    if (this.epistemic.verifiability === Verifiability.CONSENSUS ||
        this.epistemic.verifiability === Verifiability.OFFICIAL) {
      return false;
    }
    
    // Don't use if user already rejected in this domain
    const domainRejections = this.collaborative.confirmationHistory
      .filter(h => h.domain === this.domain && !h.confirmed)
      .length;
    
    if (domainRejections >= 2) {
      return false;  // User rejected twice in this domain, be more careful
    }
    
    // Don't use if there's a pending provisional already
    if (this.collaborative.pendingProvisional) {
      return false;
    }
    
    // Use provisional ONLY when:
    // - Certainty is MEDIUM
    // - No external verification available
    // - Verifiability is WEB (not too low, not too high)
    return this.epistemic.certainty === Certainty.MEDIUM &&
           !this.epistemic.hasEvidence &&
           this.epistemic.verifiability === Verifiability.WEB;
  }
  
  /**
   * Create a provisional answer for user confirmation
   * @param {string} content - The answer content
   * @param {string} reason - Why we're not certain
   */
  createProvisionalAnswer(content, reason) {
    this.collaborative.pendingProvisional = {
      content,
      reason,
      domain: this.domain,
      timestamp: Date.now(),
      slots: Object.fromEntries(this.slots)
    };
    
    logger.info('DialogState', `Created provisional answer in domain ${this.domain}`);
    return this.collaborative.pendingProvisional;
  }
  
  /**
   * Record user's response to provisional answer
   * @param {boolean} confirmed - Did user confirm?
   * @param {string} feedback - Optional feedback
   */
  recordProvisionalResponse(confirmed, feedback = null) {
    const pending = this.collaborative.pendingProvisional;
    if (!pending) {
      logger.warn('DialogState', 'No pending provisional to record response for');
      return;
    }
    
    this.collaborative.confirmationHistory.push({
      domain: pending.domain,
      confirmed,
      feedback,
      timestamp: Date.now()
    });
    
    // Update confidence based on response
    if (confirmed) {
      this.recordUserConfirmation();
      logger.info('DialogState', `Provisional answer confirmed for ${pending.domain}`);
    } else {
      this.recordNegativeFeedback();
      logger.info('DialogState', `Provisional answer rejected for ${pending.domain}`);
    }
    
    // Clear pending
    this.collaborative.pendingProvisional = null;
  }
  
  /**
   * Check if we should delegate to a knowledge provider
   * CRE decides WHEN, provider decides HOW
   */
  shouldDelegateToSource() {
    // Need a source registry
    if (!this.collaborative.sourceRegistry) {
      return false;
    }
    
    // Check if any provider can handle this query
    const query = {
      domain: this.domain,
      temporalScope: this.epistemic.temporalScope,
      verifiability: this.epistemic.verifiability
    };
    
    // Delegate when:
    // 1. REALTIME data needed
    // 2. High volatility without evidence
    // 3. Official verification required
    const shouldDelegate = 
      (this.epistemic.temporalScope === TemporalScope.REALTIME) ||
      (this.epistemic.volatility === Volatility.HIGH && !this.epistemic.hasEvidence) ||
      (this.epistemic.verifiability === Verifiability.OFFICIAL && !this.epistemic.hasEvidence);
    
    if (!shouldDelegate) {
      return false;
    }
    
    return this.collaborative.sourceRegistry.hasCapableProvider(query);
  }
  
  /**
   * Get the best knowledge provider for current context
   */
  getBestProvider() {
    if (!this.collaborative.sourceRegistry) {
      return null;
    }
    
    const query = {
      domain: this.domain,
      temporalScope: this.epistemic.temporalScope,
      verifiability: this.epistemic.verifiability
    };
    
    return this.collaborative.sourceRegistry.findProvider(query);
  }
  
  /**
   * Record result from knowledge provider
   * @param {KnowledgeResult} result
   */
  recordKnowledgeResult(result) {
    this.collaborative.lastKnowledgeResult = result;
    
    // Update epistemic state based on result
    if (result.verified) {
      this.epistemic.hasEvidence = true;
      this.recordVerifiedAnswer(result.source, { temporalScope: result.temporalScope });
    } else {
      this.recordUnverifiedAnswer();
    }
    
    logger.info('DialogState', `Knowledge result recorded: confidence=${result.confidence}, verified=${result.verified}`);
  }
  
  _initializeSlots() {
    // Don't pre-initialize slots - they will be created on demand
    // This prevents hasOpenSlots() from returning true for all domains
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // SLOT MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════
  
  getSlot(key) {
    if (!this.slots.has(key)) {
      this.slots.set(key, new Slot(key));
    }
    return this.slots.get(key);
  }
  
  fillSlot(key, value, confidence = 1.0, source = 'user') {
    const slot = this.getSlot(key);
    const filled = slot.fill(value, confidence, source);
    if (filled) {
      logger.debug('DialogState', `Filled slot: ${key}=${value} (${confidence}, ${source})`);
    }
    return filled;
  }
  
  lockSlot(key) {
    const slot = this.getSlot(key);
    slot.lock();
    logger.debug('DialogState', `Locked slot: ${key}`);
  }
  
  lockAllResolved() {
    for (const [key, slot] of this.slots) {
      if (slot.isResolved()) {
        slot.lock();
      }
    }
    logger.debug('DialogState', `Locked all resolved slots`);
  }
  
  getOpenSlots() {
    const open = [];
    for (const [key, slot] of this.slots) {
      if (slot.isOpen() && !slot.locked) {
        open.push(key);
      }
    }
    return open;
  }
  
  getFilledSlots() {
    const filled = [];
    for (const [key, slot] of this.slots) {
      if (slot.isResolved()) {
        filled.push(key);
      }
    }
    return filled;
  }
  
  getResolvedSlots() {
    const resolved = {};
    for (const [key, slot] of this.slots) {
      if (slot.isResolved()) {
        resolved[key] = slot.value;
      }
    }
    return resolved;
  }
  
  hasOpenSlots() {
    return this.getOpenSlots().length > 0;
  }
  
  canAskAbout(key) {
    const slot = this.getSlot(key);
    return !slot.locked && slot.isOpen();
  }
  
  /**
   * Can we answer with bounded conditions instead of asking?
   * "Pokud myslíš X, pak Y. Pokud Z, pak W."
   * 
   * This prevents being a "bureaucrat" that always asks
   */
  canAnswerWithBounds() {
    // Must have EXPLORATORY or BOUNDED answer mode
    if (this.epistemic.answerMode === AnswerMode.PRECISE) {
      return false;
    }
    
    // Must have at least one slot filled (some context)
    const filledSlots = this.getFilledSlots();
    if (filledSlots.length === 0) {
      return false;
    }
    
    // Open slots must be few (≤ 2)
    const openSlots = this.getOpenSlots();
    if (openSlots.length > 2) {
      return false;
    }
    
    // Domain must allow bounded answers
    const boundabledomains = [
      Domain.FACTUAL, Domain.TECHNICAL, Domain.ASTRONOMICAL,
      Domain.CREATIVE, Domain.UNKNOWN
    ];
    if (!boundabledomains.includes(this.domain)) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Get bounded answer template
   * Returns structure for "if X then Y" style answer
   */
  getBoundedAnswerOptions() {
    const openSlots = this.getOpenSlots();
    const options = [];
    
    for (const slotKey of openSlots) {
      // Generate common values for this slot type
      const commonValues = this._getCommonSlotValues(slotKey);
      options.push({
        slot: slotKey,
        possibleValues: commonValues
      });
    }
    
    return options;
  }
  
  _getCommonSlotValues(slotKey) {
    // Common values per slot type
    const commonValues = {
      year: [new Date().getFullYear(), new Date().getFullYear() + 1],
      month: ['tento měsíc', 'příští měsíc'],
      location: ['Praha', 'ČR'],
      timeframe: ['aktuálně', 'tento rok']
    };
    return commonValues[slotKey] || ['(upřesnit)'];
  }
  
  getFirstAskableSlot(required = null) {
    // If required list provided, only check those
    if (required && Array.isArray(required)) {
      for (const key of required) {
        const slot = this.slots.get(key);
        if (!slot || (!slot.locked && slot.isOpen())) {
          // Slot doesn't exist or is open and not locked
          if (slot && slot.locked) continue;  // Skip locked
          return key;
        }
      }
      return null;
    }
    
    // Otherwise check all slots
    for (const [key, slot] of this.slots) {
      if (!slot.locked && slot.isOpen()) {
        return key;
      }
    }
    return null;
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // EPISTEMIC CONTROL (rozšířený)
  // ══════════════════════════════════════════════════════════════════════════
  
  setEpistemic(certainty, volatility, evidenceRequired = false) {
    this.epistemic.certainty = certainty;
    this.epistemic.volatility = volatility;
    this.epistemic.evidenceRequired = evidenceRequired;
    
    // Auto-set enforcement based on epistemic state
    this._updateEnforcement();
  }
  
  setVerifiability(verifiability) {
    this.epistemic.verifiability = verifiability;
    
    // CONSENSUS → can be more certain
    if (verifiability === Verifiability.CONSENSUS) {
      this.epistemic.certainty = Certainty.HIGH;
      this.epistemic.evidenceRequired = false;
    }
    // NONE → must be uncertain
    else if (verifiability === Verifiability.NONE) {
      this.epistemic.certainty = Certainty.LOW;
      this.enforcement.requireDisclaimer = true;
    }
  }
  
  setTemporalScope(scope) {
    this.epistemic.temporalScope = scope;
    
    // REALTIME → high volatility, evidence required
    if (scope === TemporalScope.REALTIME) {
      this.epistemic.volatility = Volatility.HIGH;
      this.epistemic.evidenceRequired = true;
      this.enforcement.forbidNumbers = true;
    }
    // STATIC → low volatility
    else if (scope === TemporalScope.STATIC) {
      this.epistemic.volatility = Volatility.LOW;
    }
  }
  
  /**
   * Set reasoning depth - how far the system can go
   */
  setReasoningDepth(depth) {
    this.epistemic.reasoningDepth = depth;
    
    // ADVISORY requires explicit permission
    if (depth === ReasoningDepth.ADVISORY) {
      this.permissions.mayGuess = false;
      this.enforcement.requireDisclaimer = true;
    }
    // EXPLORATORY allows bounded answers
    else if (depth === ReasoningDepth.EXPLORATORY) {
      this.epistemic.answerMode = AnswerMode.EXPLORATORY;
    }
    // COMPARATIVE allows comparisons
    else if (depth === ReasoningDepth.COMPARATIVE) {
      this.epistemic.answerMode = AnswerMode.BOUNDED;
    }
    // SURFACE is strict
    else {
      this.epistemic.answerMode = AnswerMode.PRECISE;
    }
  }
  
  /**
   * Set answer mode for handling uncertainty
   */
  setAnswerMode(mode) {
    this.epistemic.answerMode = mode;
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // EVIDENCE-BASED CONFIDENCE (topic-scoped!)
  // ══════════════════════════════════════════════════════════════════════════
  
  /**
   * Get current topic's confidence data
   */
  _getTopicConfidence() {
    const topic = this.domain || 'unknown';
    if (!this.confidence.byTopic.has(topic)) {
      this.confidence.byTopic.set(topic, {
        factualSupport: 0.0,
        verifiedClaims: 0,
        totalClaims: 0,
        userConfirmed: false,
        sourceVerified: false
      });
    }
    return this.confidence.byTopic.get(topic);
  }
  
  /**
   * Record a verified answer (with external evidence)
   * Only boosts confidence for CURRENT TOPIC
   * Uses SATURATED increment based on temporal scope
   * 
   * @param {string} source - Evidence source URL
   * @param {Object} claim - Optional claim with temporalScope
   */
  recordVerifiedAnswer(source = null, claim = null) {
    const topicConf = this._getTopicConfidence();
    
    // Saturated increment based on claim type
    // STATIC claims (definitions, history) → higher increment
    // REALTIME claims (prices, weather) → lower increment
    const temporalScope = claim?.temporalScope || this.epistemic.temporalScope;
    const increment = this._getSaturatedIncrement(temporalScope);
    
    topicConf.verifiedClaims += increment;
    topicConf.totalClaims++;
    topicConf.factualSupport = Math.min(1.0, topicConf.verifiedClaims / topicConf.totalClaims);
    
    if (source) {
      topicConf.sourceVerified = true;
    }
    
    logger.debug('DialogState', `Verified answer for ${this.domain}. ` +
                 `Increment: ${increment.toFixed(2)} (${temporalScope}). ` +
                 `FactualSupport: ${topicConf.factualSupport.toFixed(2)}`);
  }
  
  /**
   * Get saturated confidence increment based on temporal scope
   * STATIC claims deserve more confidence boost than REALTIME
   */
  _getSaturatedIncrement(temporalScope) {
    const increments = {
      [TemporalScope.STATIC]: 1.0,    // Full increment for timeless facts
      [TemporalScope.YEARLY]: 0.8,    // High for yearly data
      [TemporalScope.MONTHLY]: 0.5,   // Medium for monthly
      [TemporalScope.DAILY]: 0.3,     // Low for daily
      [TemporalScope.REALTIME]: 0.1   // Minimal for realtime (can change anytime)
    };
    return increments[temporalScope] || 0.5;
  }
  
  /**
   * Record an unverified answer (no external evidence)
   */
  recordUnverifiedAnswer() {
    const topicConf = this._getTopicConfidence();
    topicConf.totalClaims++;
    topicConf.factualSupport = topicConf.verifiedClaims / topicConf.totalClaims;
    
    logger.debug('DialogState', `Unverified answer for ${this.domain}. FactualSupport: ${topicConf.factualSupport.toFixed(2)}`);
  }
  
  /**
   * Record user confirmation (explicitly confirmed)
   * This is a STRONG confidence boost
   */
  recordUserConfirmation() {
    const topicConf = this._getTopicConfidence();
    topicConf.userConfirmed = true;
    // User confirmation = verified claim
    topicConf.verifiedClaims++;
    topicConf.totalClaims++;
    topicConf.factualSupport = topicConf.verifiedClaims / topicConf.totalClaims;
    
    logger.info('DialogState', `User confirmed for ${this.domain}. FactualSupport: ${topicConf.factualSupport.toFixed(2)}`);
  }
  
  /**
   * Record a correction (system was wrong)
   * Penalizes BOTH global coherence AND current topic
   */
  recordCorrection() {
    this.confidence.correctionCount++;
    // Global coherence penalty
    this.confidence.coherence = Math.max(0.1, this.confidence.coherence - 0.3);
    
    // Topic-specific penalty
    const topicConf = this._getTopicConfidence();
    topicConf.factualSupport = Math.max(0, topicConf.factualSupport - 0.3);
    topicConf.userConfirmed = false;
    topicConf.sourceVerified = false;
    
    logger.info('DialogState', `Correction recorded. Global coherence: ${this.confidence.coherence.toFixed(2)}`);
  }
  
  /**
   * Record negative feedback (user said "to nesedí", "to je blbost")
   * Similar to correction but without full penalty
   */
  recordNegativeFeedback() {
    const topicConf = this._getTopicConfidence();
    topicConf.factualSupport = Math.max(0, topicConf.factualSupport - 0.15);
    topicConf.userConfirmed = false;
    
    // Small global coherence penalty
    this.confidence.coherence = Math.max(0.1, this.confidence.coherence - 0.1);
    
    logger.info('DialogState', `Negative feedback recorded. FactualSupport: ${topicConf.factualSupport.toFixed(2)}`);
  }
  
  /**
   * Record repair attempt by quality gate
   * Each repair = confidence cost
   */
  recordRepairAttempt(penalty = 0.1) {
    if (!this.confidence.repairCount) {
      this.confidence.repairCount = 0;
      this.confidence.totalRepairPenalty = 0;
    }
    
    this.confidence.repairCount++;
    this.confidence.totalRepairPenalty += penalty;
    
    // Repair also affects coherence (system needed fixing)
    this.confidence.coherence = Math.max(0.1, this.confidence.coherence - penalty);
    
    logger.info('DialogState', `Repair recorded. Count: ${this.confidence.repairCount}, Total penalty: ${this.confidence.totalRepairPenalty.toFixed(2)}`);
  }
  
  /**
   * Get total repair penalty (affects trust in system)
   */
  getRepairPenalty() {
    return this.confidence.totalRepairPenalty || 0;
  }
  
  /**
   * Update coherence based on dialog flow
   */
  updateCoherence(delta) {
    this.confidence.coherence = Math.max(0, Math.min(1, this.confidence.coherence + delta));
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // VOLATILITY FEEDBACK (v36.1) - trace affects future behavior
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Increase volatility based on negative feedback
   * Called when: repair needed, contradiction, enforcement correction
   * Effect: Future responses will be more cautious
   * 
   * @param {number} delta - Amount to increase (0..0.3 typical)
   */
  increaseVolatilityFromFeedback(delta) {
    // Track accumulated volatility adjustment
    if (!this.epistemic.volatilityAdjustment) {
      this.epistemic.volatilityAdjustment = 0;
    }
    
    this.epistemic.volatilityAdjustment = Math.min(
      0.5,  // Max cumulative adjustment
      this.epistemic.volatilityAdjustment + delta
    );
    
    // If adjustment is significant, upgrade volatility level
    if (this.epistemic.volatilityAdjustment >= 0.3 && 
        this.epistemic.volatility !== Volatility.HIGH) {
      this.epistemic.volatility = Volatility.HIGH;
      logger.info('DialogState', `Volatility upgraded to HIGH due to feedback (adj: ${this.epistemic.volatilityAdjustment.toFixed(2)})`);
    } else if (this.epistemic.volatilityAdjustment >= 0.15 &&
               this.epistemic.volatility === Volatility.LOW) {
      this.epistemic.volatility = Volatility.MEDIUM;
      logger.info('DialogState', `Volatility upgraded to MEDIUM due to feedback (adj: ${this.epistemic.volatilityAdjustment.toFixed(2)})`);
    }
  }
  
  /**
   * Decrease volatility based on positive feedback
   * Called when: user confirms answer
   * Effect: Future responses can be slightly more confident
   * 
   * @param {number} delta - Amount to decrease (0..0.1 typical)
   */
  decreaseVolatilityFromFeedback(delta) {
    if (!this.epistemic.volatilityAdjustment) {
      this.epistemic.volatilityAdjustment = 0;
    }
    
    this.epistemic.volatilityAdjustment = Math.max(
      -0.2,  // Max negative adjustment (can't go too confident)
      this.epistemic.volatilityAdjustment - delta
    );
    
    // Don't downgrade volatility level - only upgrade is automatic
    // User must explicitly confirm to build trust
    logger.debug('DialogState', `Volatility adjustment decreased: ${this.epistemic.volatilityAdjustment.toFixed(2)}`);
  }
  
  /**
   * Get effective volatility score (base + adjustment)
   * Used by Decision Matrix for gradient decisions
   */
  getEffectiveVolatilityScore() {
    const baseScores = {
      [Volatility.LOW]: 0.2,
      [Volatility.MEDIUM]: 0.5,
      [Volatility.HIGH]: 0.9
    };
    
    const base = baseScores[this.epistemic.volatility] || 0.5;
    const adjustment = this.epistemic.volatilityAdjustment || 0;
    
    return Math.max(0.1, Math.min(1.0, base + adjustment));
  }
  
  /**
   * Check if enforcement can be relaxed for CURRENT TOPIC
   * STRICT CRITERIA:
   * - NO corrections
   * - User confirmed OR source verified
   * - Factual support >= 0.6
   * - Global coherence >= 0.7
   * 
   * NOTE: This is for GLOBAL relaxation. Per-claim relaxation is separate.
   */
  canRelaxEnforcement() {
    // NEVER relax if there were corrections
    if (this.confidence.correctionCount > 0) {
      logger.debug('DialogState', 'Cannot relax: corrections exist');
      return false;
    }
    
    // NEVER relax if there were repairs
    if (this.getRepairPenalty() > 0.2) {
      logger.debug('DialogState', `Cannot relax: repair penalty ${this.getRepairPenalty().toFixed(2)} > 0.2`);
      return false;
    }
    
    // NEVER relax if volatility has been increased by feedback
    if ((this.epistemic.volatilityAdjustment || 0) >= 0.15) {
      logger.debug('DialogState', `Cannot relax: volatility adjustment ${this.epistemic.volatilityAdjustment.toFixed(2)} >= 0.15`);
      return false;
    }
    
    // Need coherent conversation
    if (this.confidence.coherence < 0.7) {
      logger.debug('DialogState', `Cannot relax: coherence ${this.confidence.coherence.toFixed(2)} < 0.7`);
      return false;
    }
    
    // Topic-specific checks
    const topicConf = this._getTopicConfidence();
    
    // Need explicit confirmation (user OR source)
    if (!topicConf.userConfirmed && !topicConf.sourceVerified) {
      logger.debug('DialogState', 'Cannot relax: no user/source confirmation');
      return false;
    }
    
    // Need sufficient factual support
    if (topicConf.factualSupport < 0.6) {
      logger.debug('DialogState', `Cannot relax: factualSupport ${topicConf.factualSupport.toFixed(2)} < 0.6`);
      return false;
    }
    
    return true;
  }
  
  /**
   * Check if enforcement can be relaxed for a SPECIFIC CLAIM
   * Much stricter than global relaxation
   * 
   * @param {Object} claim - Claim with temporalScope, sourceStatus, etc.
   * @returns {boolean}
   */
  canRelaxEnforcementForClaim(claim) {
    // NEVER relax for REALTIME claims
    if (claim.temporalScope === TemporalScope.REALTIME) {
      return false;
    }
    
    // NEVER relax for unverified claims
    if (claim.sourceStatus !== 'VERIFIED' && claim.sourceStatus !== 'USER_CONFIRMED') {
      return false;
    }
    
    // NEVER relax for low confidence claims
    if (claim.confidence < 0.7) {
      return false;
    }
    
    // NEVER relax if system has been corrected
    if (this.confidence.correctionCount > 0) {
      return false;
    }
    
    // Only relax for STATIC or YEARLY temporal scope
    if (claim.temporalScope !== TemporalScope.STATIC && 
        claim.temporalScope !== TemporalScope.YEARLY) {
      return false;
    }
    
    // Only relax for CONSENSUS or OFFICIAL verifiability
    if (claim.verifiability !== Verifiability.CONSENSUS &&
        claim.verifiability !== Verifiability.OFFICIAL) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Get enforcement strength (gradient, not binary)
   * Returns 0-1 where 1 = full enforcement, 0 = no enforcement
   * Uses TOPIC-SCOPED confidence
   */
  getEnforcementStrength() {
    const { volatility } = this.epistemic;
    const topicConf = this._getTopicConfidence();
    
    // Base strength from volatility
    let strength = volatility === Volatility.HIGH ? 1.0 :
                   volatility === Volatility.MEDIUM ? 0.5 : 0.2;
    
    // Corrections INCREASE strength
    strength += this.confidence.correctionCount * 0.2;
    
    // Repairs INCREASE strength (new)
    strength += this.getRepairPenalty() * 0.5;
    
    // Topic factual support decreases strength (only if verified)
    if (topicConf.sourceVerified || topicConf.userConfirmed) {
      strength -= topicConf.factualSupport * 0.3;
    }
    
    // User/source confirmation decreases strength
    if (topicConf.userConfirmed) strength -= 0.2;
    if (topicConf.sourceVerified) strength -= 0.15;
    
    // Low global coherence increases strength
    strength += (1 - this.confidence.coherence) * 0.2;
    
    return Math.max(0.1, Math.min(1.0, strength));
  }
  
  /**
   * @deprecated Use recordVerifiedAnswer/recordUnverifiedAnswer instead
   */
  accumulateContextConfidence(delta = 0.1) {
    if (this.epistemic.hasEvidence) {
      this.recordVerifiedAnswer();
    } else {
      this.recordUnverifiedAnswer();
    }
    this.updateCoherence(delta * 0.3);  // Smaller coherence boost
  }
  
  _updateEnforcement() {
    const { volatility, certainty, verifiability, temporalScope } = this.epistemic;
    const enforcementStrength = this.getEnforcementStrength();
    
    // HIGH volatility + no evidence → strict enforcement
    if (volatility === Volatility.HIGH && this.epistemic.evidenceRequired) {
      // Use gradient enforcement
      if (enforcementStrength > 0.5) {
        this.enforcement.requireDisclaimer = true;
        this.enforcement.forbidNumbers = true;
        this.enforcement.forbidPrices = true;
      } else if (enforcementStrength > 0.3) {
        // Medium enforcement - disclaimer only
        this.enforcement.requireDisclaimer = true;
        this.enforcement.forbidNumbers = false;
      }
      this.permissions.mayGuess = false;
    }
    
    // LOW certainty → require disclaimer (gradient)
    if (certainty === Certainty.LOW) {
      if (enforcementStrength > 0.3) {
        this.enforcement.requireDisclaimer = true;
      }
      this.permissions.mayGuess = false;
    }
    
    // LOW volatility + HIGH certainty → relaxed
    if (volatility === Volatility.LOW && certainty === Certainty.HIGH) {
      this.enforcement.requireDisclaimer = false;
      this.enforcement.forbidNumbers = false;
    }
    
    // CONSENSUS verifiability → very relaxed
    if (verifiability === Verifiability.CONSENSUS) {
      this.enforcement.requireDisclaimer = false;
      this.enforcement.forbidNumbers = false;
      this.permissions.mayAnswer = true;
    }
    
    // REALTIME temporal → strict (always)
    if (temporalScope === TemporalScope.REALTIME) {
      this.enforcement.forbidNumbers = true;
      this.enforcement.forbidPrices = true;
      if (!this.epistemic.hasEvidence) {
        this.permissions.mayAnswer = false;
      }
    }
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // DOMAIN MANAGEMENT (rozšířený)
  // ══════════════════════════════════════════════════════════════════════════
  
  setDomain(domain) {
    if (this.domain !== Domain.UNKNOWN && this.domain !== domain) {
      // Domain change detected
      this.previousDomain = this.domain;
      logger.info('DialogState', `Domain change: ${this.domain} → ${domain}`);
    }
    this.domain = domain;
    
    // Set domain-specific requirements
    this._applyDomainRequirements();
  }
  
  _applyDomainRequirements() {
    switch (this.domain) {
      case Domain.PRICES:
        this.epistemic.volatility = Volatility.HIGH;
        this.epistemic.evidenceRequired = true;
        this.epistemic.verifiability = Verifiability.WEB;
        this.epistemic.temporalScope = TemporalScope.REALTIME;
        this.enforcement.forbidPrices = true;
        this.permissions.mayGuess = false;
        this._markRequiredSlots(['entity']);
        break;
        
      case Domain.WEATHER:
        this.epistemic.volatility = Volatility.HIGH;
        this.epistemic.evidenceRequired = true;
        this.epistemic.verifiability = Verifiability.WEB;
        this.epistemic.temporalScope = TemporalScope.REALTIME;
        this._markRequiredSlots(['location', 'timeframe']);
        break;
        
      case Domain.NEWS:
        this.epistemic.volatility = Volatility.HIGH;
        this.epistemic.evidenceRequired = true;
        this.epistemic.verifiability = Verifiability.WEB;
        this.epistemic.temporalScope = TemporalScope.REALTIME;
        this._markRequiredSlots(['topic', 'timeframe']);
        break;
        
      case Domain.ASTRONOMICAL:
        this.epistemic.volatility = Volatility.MEDIUM;
        this.epistemic.verifiability = Verifiability.OFFICIAL;
        this.epistemic.temporalScope = TemporalScope.YEARLY;
        this._markRequiredSlots(['year', 'month']);
        break;
        
      case Domain.FACTUAL:
        this.epistemic.volatility = Volatility.LOW;
        this.epistemic.certainty = Certainty.HIGH;
        this.epistemic.verifiability = Verifiability.CONSENSUS;
        this.epistemic.temporalScope = TemporalScope.STATIC;
        this.enforcement.requireDisclaimer = false;
        break;
        
      case Domain.TECHNICAL:
        this.epistemic.volatility = Volatility.LOW;
        this.epistemic.verifiability = Verifiability.CONSENSUS;
        this.epistemic.temporalScope = TemporalScope.STATIC;
        break;
        
      case Domain.CREATIVE:
        this.epistemic.volatility = Volatility.LOW;
        this.epistemic.verifiability = Verifiability.NONE;
        this.epistemic.temporalScope = TemporalScope.STATIC;
        this.enforcement.requireDisclaimer = false;
        break;
    }
  }
  
  _markRequiredSlots(slotKeys) {
    for (const key of slotKeys) {
      const slot = this.getSlot(key);
      if (slot.value === undefined) {
        // Mark as needed (confidence 0)
        slot.confidence = 0;
      }
    }
  }
  
  hasDomainChanged() {
    return this.previousDomain !== null && this.previousDomain !== this.domain;
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // PERMISSION CONTROL
  // ══════════════════════════════════════════════════════════════════════════
  
  setPermission(key, value) {
    if (this.permissions.hasOwnProperty(key)) {
      this.permissions[key] = value;
      logger.debug('DialogState', `Permission set: ${key}=${value}`);
    }
  }
  
  // Convenience methods for tests
  may(key) {
    return this.permissions[key] === true;
  }
  
  revoke(key) {
    this.setPermission(key, false);
  }
  
  grant(key) {
    this.setPermission(key, true);
  }
  
  revokeAllGuessing() {
    this.permissions.mayGuess = false;
    this.permissions.mayAnswer = false;
  }
  
  allowAnswer() {
    this.permissions.mayAnswer = true;
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // ENFORCEMENT CONTROL
  // ══════════════════════════════════════════════════════════════════════════
  
  require(key) {
    if (this.enforcement.hasOwnProperty(key)) {
      this.enforcement[key] = true;
      logger.debug('DialogState', `Enforcement required: ${key}`);
    }
  }
  
  forbid(what) {
    if (what === 'numbers') {
      this.enforcement.forbidNumbers = true;
      this.permissions.mayProvideNumbers = false;
    } else if (what === 'dates') {
      this.enforcement.forbidDates = true;
    } else if (what === 'specificClaims') {
      this.enforcement.forbidSpecificClaims = true;
    }
  }
  
  mustHave(key) {
    return this.enforcement[key] === true;
  }
  
  isForbidden(what) {
    if (what === 'numbers') return this.enforcement.forbidNumbers === true;
    if (what === 'dates') return this.enforcement.forbidDates === true;
    if (what === 'specificClaims') return this.enforcement.forbidSpecificClaims === true;
    return false;
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // SLOT CONVENIENCE METHODS
  // ══════════════════════════════════════════════════════════════════════════
  
  resolveSlot(key, value, source = 'user', confidence = 1.0) {
    return this.fillSlot(key, value, confidence, source);
  }
  
  hasSlot(key) {
    const slot = this.slots.get(key);
    return slot?.isResolved() || false;
  }
  
  getSlotValue(key) {
    return this.slots.get(key)?.value;
  }
  
  hasOpenSlotsIn(required) {
    for (const key of required) {
      const slot = this.slots.get(key);
      if (!slot || !slot.isResolved()) return true;
    }
    return false;
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // CORRECTION MODE
  // ══════════════════════════════════════════════════════════════════════════
  
  enterCorrectionMode(type = 'factual') {
    this.correctionMode = true;
    this.correctionType = type;
    this.enforcement.requireCorrection = true;
    logger.info('DialogState', `Correction mode: ${type}`);
  }
  
  exitCorrectionMode() {
    this.correctionMode = false;
    this.correctionType = null;
    this.enforcement.requireCorrection = false;
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // STATE QUERY ALIASES
  // ══════════════════════════════════════════════════════════════════════════
  
  domainChanged() {
    return this.hasDomainChanged();
  }
  
  justAsked() {
    return this.wasLastActionAsk();
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // DECISION RECORDING
  // ══════════════════════════════════════════════════════════════════════════
  
  recordDecision(action, reason, speechAct = null) {
    this.lastDecision = {
      action,
      reason,
      speechAct,
      timestamp: Date.now()
    };
    this.turnCount++;
    
    logger.info('DialogState', 'Decision recorded', this.lastDecision);
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // STATE QUERIES
  // ══════════════════════════════════════════════════════════════════════════
  
  isFollowUp() {
    return this.turnCount > 0;
  }
  
  wasLastActionAsk() {
    return this.lastDecision.action === SystemAction.ASK_CLARIFICATION;
  }
  
  needsDisclaimer() {
    return this.enforcement.requireDisclaimer && !this.disclaimerGiven;
  }
  
  // ══════════════════════════════════════════════════════════════════════════
  // SNAPSHOT
  // ══════════════════════════════════════════════════════════════════════════
  
  getSnapshot() {
    const slots = {};
    for (const [key, slot] of this.slots) {
      if (slot.value !== undefined || slot.locked) {
        slots[key] = slot.toJSON();
      }
    }
    
    return {
      domain: this.domain,
      dialogIntent: this.dialogIntent,
      slots,
      epistemic: { ...this.epistemic },
      permissions: { ...this.permissions },
      enforcement: { ...this.enforcement },
      lastDecision: { ...this.lastDecision },
      turnCount: this.turnCount,
      correctionMode: this.correctionMode
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
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
  SpeechAct
};
