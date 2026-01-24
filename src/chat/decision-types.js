// CRE v36.8 Decision Types
// ══════════════════════════════════════════════════════════════════════════════
//
// Tool-First CREDecision Contract
//
// CRE NEVER returns text directly. It returns structured decisions.
// Text is generated ONLY by ResponseRenderer.
//
// This separation ensures:
// 1. CRE is pure decision-making
// 2. LLM is called only for synthesis (if needed)
// 3. Templates are deterministic
// 4. Quality gate is always applied
//
// ══════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// DECISION TYPES (ADT - Algebraic Data Type)
// ════════════════════════════════════════════════════════════════════════════

/**
 * CRE Decision Types
 * CRE returns ONE of these, never raw text
 */
export const DecisionType = {
  TOOL_CALL: 'TOOL_CALL',           // Execute a tool
  ASK_USER: 'ASK_USER',             // Need more information
  REFUSE: 'REFUSE',                 // Cannot/should not do this
  ANSWER: 'ANSWER',                 // Provide an answer
  MULTI_STEP: 'MULTI_STEP',         // Multiple steps needed
  DELEGATE: 'DELEGATE'              // Hand off to another system
};

/**
 * Reasons for refusal
 * NOT free-form text - enumerated reasons with specific handling
 */
export const RefusalReason = {
  // Epistemic reasons
  IMPOSSIBLE: 'IMPOSSIBLE',                       // Logically/physically impossible
  NON_EXISTENT: 'NON_EXISTENT',                  // Concept doesn't exist
  FUTURE_UNKNOWN: 'FUTURE_UNKNOWN',              // Cannot predict future
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',        // Not enough info
  
  // Capability reasons
  CAPABILITY_MISSING: 'CAPABILITY_MISSING',      // System doesn't have this capability
  BACKEND_UNAVAILABLE: 'BACKEND_UNAVAILABLE',    // Backend exists but offline
  PERMISSION_DENIED: 'PERMISSION_DENIED',        // Not allowed to do this
  
  // Safety reasons
  HARMFUL_REQUEST: 'HARMFUL_REQUEST',            // Would cause harm
  OUT_OF_SCOPE: 'OUT_OF_SCOPE',                  // Not within system scope
  
  // Data reasons
  DATA_UNAVAILABLE: 'DATA_UNAVAILABLE',          // Need live data but none available
  SOURCE_REQUIRED: 'SOURCE_REQUIRED'             // Need specific data source
};

/**
 * Slot request for ASK_USER
 */
export const SlotType = {
  YEAR: 'year',
  MONTH: 'month',
  LOCATION: 'location',
  ENTITY: 'entity',
  TOPIC: 'topic',
  TIMEFRAME: 'timeframe',
  SOURCE: 'source',
  FORMAT: 'format',
  CONFIRMATION: 'confirmation',
  CUSTOM: 'custom'
};

/**
 * Response templates for ANSWER
 * CRE specifies WHICH template, not the text
 */
export const ResponseTemplate = {
  // Informational
  FACT: 'FACT',                           // Simple factual answer
  EXPLANATION: 'EXPLANATION',             // Detailed explanation
  COMPARISON: 'COMPARISON',               // Compare multiple items
  LIST: 'LIST',                           // List of items
  SUMMARY: 'SUMMARY',                     // Summarize content
  
  // Search results
  SEARCH_RESULTS: 'SEARCH_RESULTS',       // Display search results
  SEARCH_OFFER: 'SEARCH_OFFER',           // Offer to search
  
  // Actions
  CONFIRMATION: 'CONFIRMATION',           // Confirm action taken
  CLARIFICATION: 'CLARIFICATION',         // Clarify previous response
  CORRECTION: 'CORRECTION',               // Correct previous error
  
  // Special
  CALENDAR: 'CALENDAR',                   // Calendar/date information
  ESTIMATE: 'ESTIMATE',                   // Estimated value with uncertainty
  HYPOTHESIS: 'HYPOTHESIS',               // Speculative answer
  
  // Capability-specific
  NEWS_SUMMARY: 'NEWS_SUMMARY',           // News aggregation result
  REPORT_READY: 'REPORT_READY',           // Report generation complete
  DATA_ANALYSIS: 'DATA_ANALYSIS'          // Data analysis result
};

/**
 * Verbosity levels for answers
 */
export const Verbosity = {
  MINIMAL: 'minimal',       // One sentence
  NORMAL: 'normal',         // Standard response
  DETAILED: 'detailed'      // Comprehensive explanation
};

// ════════════════════════════════════════════════════════════════════════════
// DECISION STRUCTURES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create a TOOL_CALL decision
 * 
 * @param {string} tool - Tool name (e.g., 'web.search', 'fs.read')
 * @param {Object} params - Tool parameters
 * @param {Object} [then] - Next decision after tool completes
 * @returns {CREDecision}
 */
export function toolCall(tool, params, then = null) {
  return {
    type: DecisionType.TOOL_CALL,
    tool,
    params,
    then
  };
}

/**
 * Create an ASK_USER decision
 * 
 * @param {Array<{slot: string, options?: string[]}>} slots - Required slots
 * @param {string} reasonKey - Template key for the reason
 * @returns {CREDecision}
 */
export function askUser(slots, reasonKey) {
  return {
    type: DecisionType.ASK_USER,
    slots: slots.map(s => typeof s === 'string' ? { slot: s } : s),
    reasonKey
  };
}

/**
 * Create a REFUSE decision
 * 
 * @param {RefusalReason} reason - Why refusing
 * @param {Object} [context] - Additional context
 * @returns {CREDecision}
 */
export function refuse(reason, context = {}) {
  return {
    type: DecisionType.REFUSE,
    reason,
    context
  };
}

/**
 * Create an ANSWER decision
 * 
 * @param {ResponseTemplate} template - Which template to use
 * @param {Object} [options] - Template options
 * @returns {CREDecision}
 */
export function answer(template, options = {}) {
  return {
    type: DecisionType.ANSWER,
    template,
    dataRef: options.dataRef || null,
    verbosity: options.verbosity || Verbosity.NORMAL,
    metadata: options.metadata || {}
  };
}

/**
 * Create a MULTI_STEP decision
 * 
 * @param {CREDecision[]} steps - Steps to execute
 * @param {boolean} [parallel=false] - Execute in parallel?
 * @returns {CREDecision}
 */
export function multiStep(steps, parallel = false) {
  return {
    type: DecisionType.MULTI_STEP,
    steps,
    parallel
  };
}

/**
 * Create a DELEGATE decision
 * 
 * @param {string} target - Target system (e.g., 'workflow', 'architect')
 * @param {Object} context - Context to pass
 * @returns {CREDecision}
 */
export function delegate(target, context) {
  return {
    type: DecisionType.DELEGATE,
    target,
    context
  };
}

// ════════════════════════════════════════════════════════════════════════════
// DECISION VALIDATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Validate a CRE decision structure
 * 
 * @param {CREDecision} decision
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateDecision(decision) {
  const errors = [];
  
  if (!decision) {
    return { valid: false, errors: ['Decision is null'] };
  }
  
  if (!decision.type) {
    errors.push('Decision missing type');
    return { valid: false, errors };
  }
  
  if (!Object.values(DecisionType).includes(decision.type)) {
    errors.push(`Invalid decision type: ${decision.type}`);
    return { valid: false, errors };
  }
  
  switch (decision.type) {
    case DecisionType.TOOL_CALL:
      if (!decision.tool) errors.push('TOOL_CALL missing tool');
      if (!decision.params) errors.push('TOOL_CALL missing params');
      break;
      
    case DecisionType.ASK_USER:
      if (!decision.slots || !Array.isArray(decision.slots)) {
        errors.push('ASK_USER missing slots array');
      }
      if (!decision.reasonKey) errors.push('ASK_USER missing reasonKey');
      break;
      
    case DecisionType.REFUSE:
      if (!decision.reason) errors.push('REFUSE missing reason');
      if (!Object.values(RefusalReason).includes(decision.reason)) {
        errors.push(`Invalid refusal reason: ${decision.reason}`);
      }
      break;
      
    case DecisionType.ANSWER:
      if (!decision.template) errors.push('ANSWER missing template');
      if (!Object.values(ResponseTemplate).includes(decision.template)) {
        errors.push(`Invalid response template: ${decision.template}`);
      }
      break;
      
    case DecisionType.MULTI_STEP:
      if (!decision.steps || !Array.isArray(decision.steps)) {
        errors.push('MULTI_STEP missing steps array');
      } else {
        // Recursively validate nested decisions
        for (let i = 0; i < decision.steps.length; i++) {
          const nested = validateDecision(decision.steps[i]);
          if (!nested.valid) {
            errors.push(`Step ${i}: ${nested.errors.join(', ')}`);
          }
        }
      }
      break;
      
    case DecisionType.DELEGATE:
      if (!decision.target) errors.push('DELEGATE missing target');
      break;
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Check if decision requires LLM synthesis
 * 
 * @param {CREDecision} decision
 * @returns {boolean}
 */
export function requiresLLMSynthesis(decision) {
  if (!decision) return false;
  
  // ANSWER with certain templates may need synthesis
  if (decision.type === DecisionType.ANSWER) {
    const synthesisTemplates = [
      ResponseTemplate.EXPLANATION,
      ResponseTemplate.COMPARISON,
      ResponseTemplate.SUMMARY,
      ResponseTemplate.HYPOTHESIS
    ];
    return synthesisTemplates.includes(decision.template);
  }
  
  return false;
}

/**
 * Check if decision is deterministic (no LLM needed)
 * 
 * @param {CREDecision} decision
 * @returns {boolean}
 */
export function isDeterministic(decision) {
  if (!decision) return true;
  
  switch (decision.type) {
    case DecisionType.ASK_USER:
    case DecisionType.REFUSE:
      return true;  // Always deterministic
      
    case DecisionType.TOOL_CALL:
      return true;  // Tool execution is deterministic
      
    case DecisionType.ANSWER:
      return !requiresLLMSynthesis(decision);
      
    case DecisionType.MULTI_STEP:
      return decision.steps.every(isDeterministic);
      
    case DecisionType.DELEGATE:
      return false;  // Depends on target
      
    default:
      return false;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// HELPER: CONVERT FROM LEGACY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Convert legacy SystemAction to CREDecision
 * Used during migration from old CRE
 * 
 * @param {string} action - Legacy SystemAction
 * @param {string} reason - Legacy reason text
 * @param {Object} state - Dialog state
 * @returns {CREDecision}
 */
export function fromLegacyAction(action, reason, state = {}) {
  switch (action) {
    case 'ANSWER':
    case 'ANSWER_WITH_HEDGE':
      return answer(ResponseTemplate.FACT, { 
        metadata: { legacyReason: reason }
      });
      
    case 'ESTIMATE':
      return answer(ResponseTemplate.ESTIMATE, {
        metadata: { legacyReason: reason }
      });
      
    case 'HYPOTHESIS':
      return answer(ResponseTemplate.HYPOTHESIS, {
        metadata: { legacyReason: reason }
      });
      
    case 'ASK':
    case 'ASK_SLOT':
      return askUser([{ slot: SlotType.CUSTOM }], 'legacy_ask');
      
    case 'DEFER':
      return toolCall('data.fetch', { query: reason });
      
    case 'REFUSE':
      return refuse(RefusalReason.OUT_OF_SCOPE, { legacyReason: reason });
      
    case 'CORRECT_PREVIOUS':
      return answer(ResponseTemplate.CORRECTION, {
        metadata: { legacyReason: reason }
      });
      
    case 'CONFIRM_CONTEXT':
      return answer(ResponseTemplate.CONFIRMATION, {
        metadata: { legacyReason: reason }
      });
      
    case 'RESET':
      return askUser([{ slot: SlotType.TOPIC }], 'topic_changed');
      
    default:
      return answer(ResponseTemplate.FACT, {
        metadata: { legacyAction: action, legacyReason: reason }
      });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  DecisionType,
  RefusalReason,
  SlotType,
  ResponseTemplate,
  Verbosity,
  toolCall,
  askUser,
  refuse,
  answer,
  multiStep,
  delegate,
  validateDecision,
  requiresLLMSynthesis,
  isDeterministic,
  fromLegacyAction
};
