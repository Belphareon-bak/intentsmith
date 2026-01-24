// C.3 v36.4.2 Decision Matrix
// ══════════════════════════════════════════════════════════════════════════════
// 
// JEDINÝ ZDROJ PRAVDY pro rozhodování.
// Lookup table, ne ify.
// + DecisionTrace pro transparentnost
// 
// v36.4: Epistemic impossibility, concept existence, refusal reasons
// v36.4.2: Workflow preconditions, data requirements
// 
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import {
  DialogState,
  DecisionTrace,
  Domain,
  DialogIntent,
  WorkflowIntent,
  DataRequirement,
  Certainty,
  Volatility,
  Verifiability,
  VerifiabilityScore,
  getVerifiabilityScore,
  TemporalScope,
  DataDependency,
  ConceptExistence,
  RefusalReason,
  SystemAction,
  SpeechAct
} from './dialog-state-v2.js';

// ════════════════════════════════════════════════════════════════════════════
// DECISION RESULT
// ════════════════════════════════════════════════════════════════════════════

export class Decision {
  constructor(action, reason, speechAct = null) {
    this.action = action;
    this.reason = reason;
    this.speechAct = speechAct;
    this.askSlot = null;
    this.constraints = [];
    this.trace = null;  // DecisionTrace
  }
  
  withSlot(slot) {
    this.askSlot = slot;
    return this;
  }
  
  withConstraint(c) {
    this.constraints.push(c);
    return this;
  }
  
  withTrace(trace) {
    this.trace = trace;
    return this;
  }
  
  /**
   * Get human-readable explanation of why this decision was made
   */
  explain() {
    if (!this.trace) {
      return `Decision: ${this.action} (${this.reason}) - No trace available`;
    }
    return this.trace.explain();
  }
}

// ════════════════════════════════════════════════════════════════════════════
// DECISION MATRIX (lookup table)
// Priority order - first match wins
// Each rule has: test, action, reason, speechAct, AND whyNot (negative reasoning)
// ════════════════════════════════════════════════════════════════════════════

const DECISION_RULES = [
  // ─────────────────────────────────────────────────────────────────────────
  // P0: DOMAIN CHANGED → reset context
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'DOMAIN_CHANGED',
    test: (state) => state.hasDomainChanged(),
    whyNot: (state) => `domain=${state.domain}, previousDomain=${state.previousDomain || 'none'}`,
    action: SystemAction.RESET_CONTEXT,
    reason: 'Domain changed mid-conversation',
    speechAct: null
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // P1: CORRECTION MODE → acknowledge and correct
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'CORRECTION_MODE',
    test: (state) => state.correctionMode === true,
    whyNot: (state) => `correctionMode=${state.correctionMode}`,
    action: SystemAction.CORRECT_PREVIOUS,
    reason: 'User correction detected',
    speechAct: SpeechAct.FACT
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // P2: CONFIRM INTENT → validate only, no questions
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'CONFIRM_INTENT',
    test: (state) => state.dialogIntent === DialogIntent.CONFIRM,
    whyNot: (state) => `intent=${state.dialogIntent}, expected=CONFIRM`,
    action: SystemAction.CONFIRM_CONTEXT,
    reason: 'User wants validation, not new info',
    speechAct: SpeechAct.CONFIRMATION
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // v36.4 HARD REFUSALS (epistemicky nepřekročitelné)
  // ═══════════════════════════════════════════════════════════════════════════
  
  // ─────────────────────────────────────────────────────────────────────────
  // P2.1: NON-EXISTENT CONCEPT (v36.4) - Pseudoscience, fiction
  // MUST refuse - no explanation of non-existent concepts
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'NON_EXISTENT_CONCEPT',
    test: (state) => {
      return state.epistemic.conceptExistence === ConceptExistence.NON_EXISTENT;
    },
    whyNot: (state) => `conceptExistence=${state.epistemic.conceptExistence}`,
    action: SystemAction.REFUSE,
    reason: 'Concept does not exist (pseudoscience/fiction)',
    speechAct: SpeechAct.REFUSAL,
    refusalReason: RefusalReason.NON_EXISTENT,
    enforcement: {
      forbidExplanation: true,
      forbidSpeculation: true,
      requireRejection: true
    }
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // P2.2: IMPOSSIBLE PREDICTION (v36.4) - Undeterministic future
  // MUST refuse - no PROVISIONAL/ESTIMATE allowed
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'IMPOSSIBLE_PREDICTION',
    test: (state) => {
      return state.epistemic.impossibility === true;
    },
    whyNot: (state) => `impossibility=${state.epistemic.impossibility}`,
    action: SystemAction.REFUSE,
    reason: 'Epistemically impossible question (undeterministic future)',
    speechAct: SpeechAct.REFUSAL,
    refusalReason: RefusalReason.IMPOSSIBLE,
    enforcement: {
      forbidNumbers: true,
      forbidPredictions: true,
      forbidScenarios: true,
      requireExplanation: true,
      explanationType: 'EPISTEMIC_IMPOSSIBILITY'
    },
    // OUTPUT CONTRACT: Must explain WHY it's impossible
    outputContract: {
      required: ['state_impossibility', 'explain_why_undeterministic'],
      optional: ['list_unknown_factors'],
      forbidden: ['provide_estimate', 'give_scenarios', 'use_numbers']
    }
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // P2.3: MULTI-DOMAIN QUERY (v36.4) - Must split or clarify
  // Cannot answer mixed domains in single response
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'MULTI_DOMAIN_QUERY',
    test: (state) => {
      return state.dialogFlags?.multiDomainQuery === true;
    },
    whyNot: (state) => `multiDomainQuery=${state.dialogFlags?.multiDomainQuery || false}`,
    action: SystemAction.SPLIT_OR_CLARIFY,
    reason: 'Multi-domain query requires separation',
    speechAct: SpeechAct.QUESTION,
    enforcement: {
      requireDomainSeparation: true,
      forbidMixedAnswer: true,
      requireExplicitDomainNaming: true
    },
    // OUTPUT CONTRACT: Must name both domains explicitly
    outputContract: {
      required: ['name_domain_1', 'name_domain_2', 'ask_priority'],
      optional: ['explain_difference'],
      forbidden: ['answer_both', 'pick_one_silently', 'vague_clarification']
    }
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // v36.4.2 WORKFLOW PRECONDITIONS
  // ═══════════════════════════════════════════════════════════════════════════
  
  // ─────────────────────────────────────────────────────────────────────────
  // P2.4: NEWS AGGREGATION WITHOUT CORPUS
  // Cannot generate news summary without external sources
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'NEWS_WITHOUT_CORPUS',
    test: (state) => {
      const isNews = state.workflow?.intent === WorkflowIntent.NEWS_AGGREGATION;
      const noData = !state.workflow?.dataAvailable;
      return isNews && noData;
    },
    whyNot: (state) => `workflowIntent=${state.workflow?.intent}, dataAvailable=${state.workflow?.dataAvailable}`,
    action: SystemAction.ASK_DATA_SOURCE,
    reason: 'News aggregation requires external sources',
    speechAct: SpeechAct.QUESTION,
    enforcement: {
      forbidArtifactGeneration: true,
      requireSourceQuestion: true
    },
    outputContract: {
      required: ['explain_need_for_sources', 'ask_source_preference'],
      optional: ['suggest_sources'],
      forbidden: ['generate_artifact', 'make_up_news', 'general_advice']
    }
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // P2.5: SEARCH WITHOUT BACKEND
  // Cannot search marketplace without access to data
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'SEARCH_WITHOUT_BACKEND',
    test: (state) => {
      const isSearch = state.workflow?.intent === WorkflowIntent.SEARCH;
      const noBackend = !state.workflow?.dataAvailable;
      return isSearch && noBackend;
    },
    whyNot: (state) => `workflowIntent=${state.workflow?.intent}, dataAvailable=${state.workflow?.dataAvailable}`,
    action: SystemAction.OFFER_SEARCH_SETUP,
    reason: 'Search requires marketplace/database access',
    speechAct: SpeechAct.QUESTION,
    enforcement: {
      forbidGenericAdvice: true,
      requireSearchOffer: true
    },
    outputContract: {
      required: ['acknowledge_search_intent', 'offer_marketplace_options'],
      optional: ['explain_limitations'],
      forbidden: ['give_generic_howto', 'pretend_searched', 'redirect_to_google']
    }
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // P2.6: REPORT WITHOUT DATA
  // Cannot generate artifact without underlying data
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'REPORT_WITHOUT_DATA',
    test: (state) => {
      const isReport = state.workflow?.intent === WorkflowIntent.REPORT;
      const needsData = state.workflow?.dataRequirement !== DataRequirement.NONE;
      const noData = !state.workflow?.dataAvailable;
      return isReport && needsData && noData;
    },
    whyNot: (state) => `workflowIntent=${state.workflow?.intent}, dataRequirement=${state.workflow?.dataRequirement}, dataAvailable=${state.workflow?.dataAvailable}`,
    action: SystemAction.BLOCK_NO_DATA,
    reason: 'Report generation requires data that is not available',
    speechAct: SpeechAct.QUESTION,
    enforcement: {
      forbidArtifactGeneration: true,
      requireDataQuestion: true
    },
    outputContract: {
      required: ['explain_data_requirement', 'ask_for_data_source'],
      optional: ['suggest_alternatives'],
      forbidden: ['generate_empty_artifact', 'make_up_data']
    }
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  
  // ─────────────────────────────────────────────────────────────────────────
  // P3: CANNOT ANSWER (no permission)
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'NO_ANSWER_PERMISSION',
    test: (state) => state.permissions.mayAnswer === false,
    whyNot: (state) => `mayAnswer=${state.permissions.mayAnswer}`,
    action: SystemAction.DEFER_TO_SEARCH,
    reason: 'No permission to answer without evidence',
    speechAct: SpeechAct.REFUSAL
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // P3.1: LIVE DATA REQUIRED (v36.3) - Cannot answer without real-time source
  // Weather, current prices, traffic - MUST admit ignorance
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'LIVE_DATA_REQUIRED',
    test: (state) => {
      const isLive = state.epistemic.dataDependency === 'LIVE';
      const noLiveSource = !state.epistemic.hasEvidence;
      return isLive && noLiveSource;
    },
    whyNot: (state) => `dataDependency=${state.epistemic.dataDependency}, hasEvidence=${state.epistemic.hasEvidence}`,
    action: SystemAction.REFUSE,
    reason: 'Live data required but no real-time source available',
    speechAct: SpeechAct.REFUSAL,
    enforcement: {
      forbidNumbers: true,
      forbidSpecificClaims: true,
      requireDisclaimer: true
    }
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // P3.2: VARIANT SENSITIVE NO EVIDENCE (v36.3) - Trims, specs, versions
  // Cannot claim specific features without verification
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'VARIANT_SENSITIVE_NO_EVIDENCE',
    test: (state) => {
      const isVariantSensitive = state.epistemic.variantSensitive === true;
      const noEvidence = !state.epistemic.hasEvidence;
      return isVariantSensitive && noEvidence;
    },
    whyNot: (state) => `variantSensitive=${state.epistemic.variantSensitive}, hasEvidence=${state.epistemic.hasEvidence}`,
    action: SystemAction.ANSWER_STRUCTURAL,
    reason: 'Variant-sensitive domain without verification',
    speechAct: SpeechAct.ESTIMATE,
    enforcement: {
      forbidSpecificClaims: true,
      requireDisclaimer: true
    }
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // P3.3: CERTAINTY PRESSURE (v36.4) - User demanding 100% guarantees
  // 100% certainty is IMPOSSIBLE - must refuse, not soften with disclaimer
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'CERTAINTY_PRESSURE_REFUSAL',
    test: (state) => {
      return state.dialogFlags?.certaintyPressure === true;
    },
    whyNot: (state) => `certaintyPressure=${state.dialogFlags?.certaintyPressure || false}`,
    action: SystemAction.REFUSE,
    reason: 'Absolute certainty is epistemically impossible',
    speechAct: SpeechAct.REFUSAL,
    refusalReason: RefusalReason.IMPOSSIBLE,
    enforcement: {
      forbidAbsoluteClaims: true,
      requireExplanation: true,
      explanationType: 'CERTAINTY_LIMITS'
    },
    // OUTPUT CONTRACT: Must explicitly refuse guarantee, then offer best available
    outputContract: {
      required: ['refuse_guarantee', 'explain_limits'],
      optional: ['offer_best_estimate'],
      forbidden: ['claim_certainty', 'soft_disclaimer']
    }
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // P4: OPEN SLOTS + EVIDENCE REQUIRED → ask clarification
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'OPEN_SLOTS_EVIDENCE_REQUIRED',
    test: (state) => {
      const openSlots = state.getOpenSlots();
      return openSlots.length > 0 && 
             state.epistemic.evidenceRequired && 
             state.permissions.mayAskClarification;
    },
    whyNot: (state) => {
      const openSlots = state.getOpenSlots();
      return `openSlots=${openSlots.length}, evidenceRequired=${state.epistemic.evidenceRequired}, mayAsk=${state.permissions.mayAskClarification}`;
    },
    action: SystemAction.ASK_CLARIFICATION,
    reason: 'Missing slots for evidence-based answer',
    speechAct: SpeechAct.QUESTION,
    getSlot: (state) => state.getFirstAskableSlot()
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // P5: OPEN SLOTS + CAN ANSWER WITH BOUNDS → bounded answer
  // "Pokud myslíš X, pak Y. Pokud Z, pak W."
  // Prevents being a "bureaucrat" that always asks
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'ANSWER_WITH_BOUNDS',
    test: (state) => {
      return state.hasOpenSlots() && state.canAnswerWithBounds();
    },
    whyNot: (state) => `hasOpenSlots=${state.hasOpenSlots()}, canAnswerWithBounds=${state.canAnswerWithBounds?.() || false}`,
    action: SystemAction.ANSWER_WITH_BOUNDS,
    reason: 'Can provide bounded answer with conditions',
    speechAct: SpeechAct.CONDITIONAL,
    getBounds: (state) => state.getBoundedAnswerOptions?.() || []
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // P5.5: DELEGATE TO SOURCE (v36.2) - BEFORE asking clarification
  // When CRE decides external knowledge is needed, fetch it first
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'DEFER_TO_SOURCE',
    test: (state) => {
      return state.shouldDelegateToSource?.() === true;
    },
    whyNot: (state) => {
      const hasRegistry = !!state.collaborative?.sourceRegistry;
      const shouldDelegate = state.shouldDelegateToSource?.() || false;
      return `hasRegistry=${hasRegistry}, shouldDelegate=${shouldDelegate}`;
    },
    action: SystemAction.DEFER_TO_SOURCE,
    reason: 'External knowledge source available and needed',
    speechAct: null,  // Will be determined by source result
    getProvider: (state) => state.getBestProvider?.()
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // P6: OPEN SLOTS (general) → ask
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'OPEN_SLOTS',
    test: (state) => {
      return state.hasOpenSlots() && state.permissions.mayAskClarification;
    },
    whyNot: (state) => `hasOpenSlots=${state.hasOpenSlots()}, mayAsk=${state.permissions.mayAskClarification}`,
    action: SystemAction.ASK_CLARIFICATION,
    reason: 'Missing required information',
    speechAct: SpeechAct.QUESTION,
    getSlot: (state) => state.getFirstAskableSlot()
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // P7: HIGH VOLATILITY + NO EVIDENCE → structural answer
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'HIGH_VOLATILITY_NO_EVIDENCE',
    test: (state) => {
      return state.epistemic.volatility === Volatility.HIGH &&
             state.epistemic.evidenceRequired &&
             !state.hasOpenSlots();
    },
    whyNot: (state) => `volatility=${state.epistemic.volatility}, evidenceRequired=${state.epistemic.evidenceRequired}, openSlots=${state.hasOpenSlots()}`,
    action: SystemAction.ANSWER_STRUCTURAL,
    reason: 'High volatility topic without evidence',
    speechAct: SpeechAct.ESTIMATE
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // P8: LOW CERTAINTY → answer with disclaimer
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'LOW_CERTAINTY',
    test: (state) => state.epistemic.certainty === Certainty.LOW,
    whyNot: (state) => `certainty=${state.epistemic.certainty}, expected=LOW`,
    action: SystemAction.ANSWER_WITH_DISCLAIMER,
    reason: 'Low certainty answer',
    speechAct: SpeechAct.ESTIMATE
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // P8.5: PROVISIONAL ANSWER (v36.2 - Collaborative Reasoning)
  // "Myslím že X. Souhlasíš?"
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'PROVISIONAL_ANSWER',
    test: (state) => {
      return state.shouldUseProvisionalAnswer?.() === true;
    },
    whyNot: (state) => {
      const shouldUse = state.shouldUseProvisionalAnswer?.() || false;
      return `shouldUseProvisional=${shouldUse}, certainty=${state.epistemic.certainty}, hasEvidence=${state.epistemic.hasEvidence}`;
    },
    action: SystemAction.ANSWER_PROVISIONAL,
    reason: 'Offering provisional answer for user confirmation',
    speechAct: SpeechAct.PROVISIONAL
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // P8: MEDIUM CERTAINTY + DISCLAIMER REQUIRED → answer with disclaimer
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'MEDIUM_CERTAINTY_DISCLAIMER',
    test: (state) => {
      return state.epistemic.certainty === Certainty.MEDIUM &&
             state.enforcement.requireDisclaimer;
    },
    whyNot: (state) => `certainty=${state.epistemic.certainty}, requireDisclaimer=${state.enforcement.requireDisclaimer}`,
    action: SystemAction.ANSWER_WITH_DISCLAIMER,
    reason: 'Medium certainty with disclaimer requirement',
    speechAct: SpeechAct.ESTIMATE
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // P9: EXPLORE INTENT → suggestion mode
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'EXPLORE_INTENT',
    test: (state) => state.dialogIntent === DialogIntent.EXPLORE,
    whyNot: (state) => `intent=${state.dialogIntent}, expected=EXPLORE`,
    action: SystemAction.ANSWER,
    reason: 'Open exploration',
    speechAct: SpeechAct.SUGGESTION
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // P10: DEFAULT → answer as fact (always matches)
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: 'DEFAULT_ANSWER',
    test: () => true,
    whyNot: () => 'fallback - always matches',
    action: SystemAction.ANSWER,
    reason: 'All conditions met',
    speechAct: SpeechAct.FACT
  }
];

// ════════════════════════════════════════════════════════════════════════════
// DECIDE FUNCTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Make decision based on DialogState
 * This is the ONLY decision point - no other ifs allowed
 * Returns Decision with full trace including NEGATIVE REASONING
 */
export function decide(state, debug = false) {
  // Create trace
  const trace = new DecisionTrace();
  trace.captureInputs(state);
  
  let ruleIndex = 0;
  for (const rule of DECISION_RULES) {
    const matched = rule.test(state);
    
    // Record evaluation with reason (NEGATIVE REASONING)
    const reason = matched ? 'Condition satisfied' : 
                   (rule.whyNot ? rule.whyNot(state) : 'Condition not met');
    trace.recordEvaluation(ruleIndex, rule.name, matched, reason);
    
    if (matched) {
      // Found matching rule
      trace.setMatchedRule(ruleIndex, rule.name, ruleIndex);
      
      const decision = new Decision(rule.action, rule.reason, rule.speechAct);
      decision.withTrace(trace);
      
      // Add slot if applicable
      if (rule.getSlot) {
        decision.withSlot(rule.getSlot(state));
      }
      
      // Add enforcement constraints
      if (state.enforcement.forbidNumbers) {
        decision.withConstraint('NO_SPECIFIC_NUMBERS');
      }
      if (state.enforcement.forbidDates) {
        decision.withConstraint('NO_SPECIFIC_DATES');
      }
      if (state.enforcement.forbidPrices) {
        decision.withConstraint('NO_SPECIFIC_PRICES');
      }
      if (state.enforcement.requireDisclaimer) {
        decision.withConstraint('REQUIRE_DISCLAIMER');
      }
      if (state.enforcement.forbidSpecificClaims) {
        decision.withConstraint('NO_SPECIFIC_CLAIMS');
      }
      
      // Store trace in state for debugging
      state.lastTrace = trace;
      
      if (debug) {
        logger.info('DecisionMatrix', `\n${trace.explain()}`);
      } else {
        logger.info('DecisionMatrix', `Rule matched: ${rule.name}`, {
          action: rule.action,
          reason: rule.reason
        });
      }
      
      // Record in state
      state.recordDecision(rule.action, rule.reason, rule.speechAct);
      
      return decision;
    }
    
    ruleIndex++;
  }
  
  // Should never reach (DEFAULT_ANSWER always matches)
  throw new Error('DecisionMatrix: No rule matched');
}

// ════════════════════════════════════════════════════════════════════════════
// ADAPTIVE RULE PENALTIES (v36.0)
// ════════════════════════════════════════════════════════════════════════════

// Rule penalties - adjusted based on repair/contradiction outcomes
const rulePenalties = new Map();

/**
 * Record that a rule led to a repair (bad outcome)
 * This affects future decisions
 */
export function penalizeRule(ruleName, penalty = 0.1) {
  const current = rulePenalties.get(ruleName) || 0;
  rulePenalties.set(ruleName, current + penalty);
  logger.info('DecisionMatrix', `Rule penalized: ${ruleName}, total: ${(current + penalty).toFixed(2)}`);
}

/**
 * Record that a rule led to good outcome
 * Small reward (to balance penalties)
 */
export function rewardRule(ruleName, reward = 0.02) {
  const current = rulePenalties.get(ruleName) || 0;
  rulePenalties.set(ruleName, Math.max(0, current - reward));
}

/**
 * Get current penalty for a rule
 */
export function getRulePenalty(ruleName) {
  return rulePenalties.get(ruleName) || 0;
}

/**
 * Clear all penalties (for testing)
 */
export function clearPenalties() {
  rulePenalties.clear();
}

/**
 * Decide with adaptive thresholds based on rule penalties
 * Penalized rules require HIGHER threshold to match
 */
export function decideAdaptive(state, context = {}, debug = false) {
  const trace = new DecisionTrace();
  trace.captureInputs(state);
  
  let ruleIndex = 0;
  
  for (const rule of DECISION_RULES) {
    // Check if rule matches
    let matched = rule.test(state);
    
    // Apply penalty: if rule has penalty, require additional conditions
    const penalty = getRulePenalty(rule.name);
    if (matched && penalty > 0) {
      // Penalized rules need stronger evidence to match
      if (penalty >= 0.3) {
        // Heavy penalty - require evidence
        matched = matched && state.epistemic.hasEvidence;
        if (!matched) {
          trace.recordEvaluation(ruleIndex, rule.name, false, 
            `Penalty blocked: ${penalty.toFixed(2)} - needs evidence`);
          ruleIndex++;
          continue;
        }
      } else if (penalty >= 0.15) {
        // Medium penalty - require confirmation
        const topicConf = state._getTopicConfidence?.();
        matched = matched && (topicConf?.userConfirmed || topicConf?.sourceVerified);
        if (!matched) {
          trace.recordEvaluation(ruleIndex, rule.name, false,
            `Penalty blocked: ${penalty.toFixed(2)} - needs confirmation`);
          ruleIndex++;
          continue;
        }
      }
      // Light penalty - just log
      logger.debug('DecisionMatrix', `Rule ${rule.name} has penalty ${penalty.toFixed(2)}`);
    }
    
    const reason = matched ? 'Condition satisfied' :
                   (rule.whyNot ? rule.whyNot(state) : 'Condition not met');
    trace.recordEvaluation(ruleIndex, rule.name, matched, reason);
    
    if (matched) {
      trace.setMatchedRule(ruleIndex, rule.name, ruleIndex);
      
      const decision = new Decision(rule.action, rule.reason, rule.speechAct);
      decision.withTrace(trace);
      decision.rulePenalty = penalty;  // Track for feedback
      
      // Add slot if applicable
      if (rule.getSlot) {
        decision.withSlot(rule.getSlot(state));
      }
      
      // Add enforcement constraints
      if (state.enforcement.forbidNumbers) {
        decision.withConstraint('NO_SPECIFIC_NUMBERS');
      }
      if (state.enforcement.forbidDates) {
        decision.withConstraint('NO_SPECIFIC_DATES');
      }
      if (state.enforcement.forbidPrices) {
        decision.withConstraint('NO_SPECIFIC_PRICES');
      }
      if (state.enforcement.requireDisclaimer) {
        decision.withConstraint('REQUIRE_DISCLAIMER');
      }
      if (state.enforcement.forbidSpecificClaims) {
        decision.withConstraint('NO_SPECIFIC_CLAIMS');
      }
      
      state.lastTrace = trace;
      
      if (debug) {
        logger.info('DecisionMatrix', `\n${trace.explain()}`);
      } else {
        logger.info('DecisionMatrix', `Rule matched: ${rule.name}`, {
          action: rule.action,
          reason: rule.reason,
          penalty: penalty > 0 ? penalty.toFixed(2) : 'none'
        });
      }
      
      state.recordDecision(rule.action, rule.reason, rule.speechAct);
      
      return decision;
    }
    
    ruleIndex++;
  }
  
  throw new Error('DecisionMatrix: No rule matched');
}

/**
 * Explain last decision (for debugging)
 */
export function explainDecision(state) {
  if (state.lastTrace) {
    return state.lastTrace.explain();
  }
  return 'No decision trace available';
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  decide,
  decideAdaptive,
  penalizeRule,
  rewardRule,
  getRulePenalty,
  clearPenalties,
  explainDecision,
  Decision,
  DecisionTrace,
  DECISION_RULES
};
