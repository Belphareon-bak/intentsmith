// CRE v36.8 Decision Types
// ══════════════════════════════════════════════════════════════════════════════
//
// TOOL-FIRST RESPONSE CONTRACT
//
// CRE NEVER returns text directly. It returns structured decisions.
// Text is generated ONLY in ResponseRenderer (COMMIT 3).
//
// Key principle:
//   CRE decides WHAT to do
//   ResponseRenderer decides HOW to say it
//
// ══════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// ENUMS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Available tools that CRE can invoke
 */
export const ToolName = {
  // Web tools
  'web.search': 'web.search',
  'web.fetch': 'web.fetch',
  'web.scrape': 'web.scrape',
  
  // Data tools
  'data.parse': 'data.parse',
  'data.compare': 'data.compare',
  'data.merge': 'data.merge',
  'data.filter': 'data.filter',
  
  // Artifact tools
  'artifact.pdf': 'artifact.pdf',
  'artifact.docx': 'artifact.docx',
  'artifact.xlsx': 'artifact.xlsx',
  'artifact.html': 'artifact.html',
  
  // Filesystem tools
  'fs.read': 'fs.read',
  'fs.write': 'fs.write',
  'fs.list': 'fs.list',
  'fs.delete': 'fs.delete',
  
  // Git tools
  'git.status': 'git.status',
  'git.diff': 'git.diff',
  'git.commit': 'git.commit',
  'git.push': 'git.push',
  
  // Shell tools
  'shell.exec': 'shell.exec',
  
  // Cache tools
  'cache.get': 'cache.get',
  'cache.set': 'cache.set',
  
  // Memory tools (v37+)
  'memory.recall': 'memory.recall',
  'memory.store': 'memory.store'
};

/**
 * Reasons why CRE refuses to execute
 * These are CODES, not user-facing text
 */
export const RefusalReason = {
  // Capability issues
  CAPABILITY_NOT_AVAILABLE: 'CAPABILITY_NOT_AVAILABLE',
  BACKEND_NOT_CONFIGURED: 'BACKEND_NOT_CONFIGURED',
  BACKEND_OFFLINE: 'BACKEND_OFFLINE',
  
  // Permission issues
  PERMISSION_REQUIRED: 'PERMISSION_REQUIRED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  
  // Data issues
  MISSING_REQUIRED_DATA: 'MISSING_REQUIRED_DATA',
  INVALID_INPUT: 'INVALID_INPUT',
  
  // Safety issues
  UNSAFE_OPERATION: 'UNSAFE_OPERATION',
  RATE_LIMITED: 'RATE_LIMITED',
  
  // Context issues
  AMBIGUOUS_REQUEST: 'AMBIGUOUS_REQUEST',
  OUT_OF_SCOPE: 'OUT_OF_SCOPE',
  
  // System issues
  INTERNAL_ERROR: 'INTERNAL_ERROR'
};

/**
 * Response templates
 * These define HOW to render the response, not WHAT to say
 */
export const ResponseTemplate = {
  // Search & Results
  SEARCH_RESULTS: 'search_results',
  SEARCH_NO_RESULTS: 'search_no_results',
  SEARCH_OFFER: 'search_offer',
  
  // Data & Analysis
  COMPARISON_TABLE: 'comparison_table',
  DATA_SUMMARY: 'data_summary',
  ANALYSIS_REPORT: 'analysis_report',
  
  // Artifacts
  ARTIFACT_CREATED: 'artifact_created',
  ARTIFACT_ERROR: 'artifact_error',
  
  // Confirmations
  CONFIRMATION: 'confirmation',
  ACKNOWLEDGMENT: 'acknowledgment',
  
  // Questions
  CLARIFICATION_NEEDED: 'clarification_needed',
  SLOT_REQUEST: 'slot_request',
  SOURCE_SELECTION: 'source_selection',
  
  // Informational
  FACTUAL_ANSWER: 'factual_answer',
  EXPLANATION: 'explanation',
  RECOMMENDATION: 'recommendation',
  
  // Calendar/Time
  CALENDAR_ANSWER: 'calendar_answer',
  
  // Errors
  REFUSAL: 'refusal',
  ERROR: 'error',
  
  // Chat
  GREETING: 'greeting',
  FAREWELL: 'farewell',
  CHITCHAT: 'chitchat'
};

/**
 * Verbosity levels for response rendering
 */
export const Verbosity = {
  MINIMAL: 'minimal',     // Just the facts
  NORMAL: 'normal',       // Balanced
  DETAILED: 'detailed'    // Full explanation
};

// ════════════════════════════════════════════════════════════════════════════
// SLOT REQUEST
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} SlotRequest
 * @property {string} name - Slot name
 * @property {string} type - 'text' | 'number' | 'date' | 'select' | 'boolean'
 * @property {string} [description] - Human-readable description
 * @property {string[]} [options] - For 'select' type
 * @property {any} [default] - Default value
 * @property {boolean} [required] - Is this required?
 */

/**
 * Create a slot request
 */
export function createSlotRequest(name, type, options = {}) {
  return {
    name,
    type,
    description: options.description || null,
    options: options.options || null,
    default: options.default ?? null,
    required: options.required ?? true
  };
}

// ════════════════════════════════════════════════════════════════════════════
// CRE DECISION TYPES
// ════════════════════════════════════════════════════════════════════════════

/**
 * CRE Decision - the output of CRE.process()
 * 
 * CRE NEVER returns text. It returns one of these decision types.
 * 
 * @typedef {
 *   | ToolCallDecision
 *   | AskUserDecision
 *   | RefuseDecision
 *   | AnswerDecision
 *   | MultiStepDecision
 * } CREDecision
 */

/**
 * Tool Call Decision - CRE wants to invoke a tool
 * 
 * @typedef {Object} ToolCallDecision
 * @property {'TOOL_CALL'} type
 * @property {string} tool - Tool name from ToolName
 * @property {Object} params - Parameters for the tool
 * @property {CREDecision} [then] - What to do after tool completes
 */

/**
 * Ask User Decision - CRE needs more information
 * 
 * @typedef {Object} AskUserDecision
 * @property {'ASK_USER'} type
 * @property {SlotRequest[]} slots - What information is needed
 * @property {string} template - ResponseTemplate for rendering the question
 * @property {Object} [context] - Additional context for rendering
 */

/**
 * Refuse Decision - CRE cannot/will not proceed
 * 
 * @typedef {Object} RefuseDecision
 * @property {'REFUSE'} type
 * @property {string} reason - RefusalReason code
 * @property {string[]} [alternatives] - Alternative actions user could take
 * @property {Object} [context] - Additional context
 */

/**
 * Answer Decision - CRE can provide information
 * 
 * NOTE: This does NOT contain text!
 * Text is generated by ResponseRenderer based on template + data
 * 
 * @typedef {Object} AnswerDecision
 * @property {'ANSWER'} type
 * @property {string} template - ResponseTemplate for rendering
 * @property {string} [dataRef] - Reference to data (from tool results or state)
 * @property {Object} [data] - Inline data for simple cases
 * @property {string} [verbosity] - Verbosity level
 * @property {Object} [context] - Additional context for rendering
 */

/**
 * Multi-Step Decision - CRE wants to do multiple things
 * 
 * @typedef {Object} MultiStepDecision
 * @property {'MULTI_STEP'} type
 * @property {CREDecision[]} steps - Steps to execute
 * @property {boolean} parallel - Can steps run in parallel?
 */

// ════════════════════════════════════════════════════════════════════════════
// DECISION CREATORS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Create a TOOL_CALL decision
 */
export function toolCall(tool, params, then = null) {
  if (!ToolName[tool]) {
    console.warn(`Unknown tool: ${tool}`);
  }
  
  return {
    type: 'TOOL_CALL',
    tool,
    params: params || {},
    then
  };
}

/**
 * Create an ASK_USER decision
 */
export function askUser(slots, template = ResponseTemplate.SLOT_REQUEST, context = {}) {
  return {
    type: 'ASK_USER',
    slots: Array.isArray(slots) ? slots : [slots],
    template,
    context
  };
}

/**
 * Create a REFUSE decision
 */
export function refuse(reason, alternatives = [], context = {}) {
  if (!RefusalReason[reason]) {
    console.warn(`Unknown refusal reason: ${reason}`);
  }
  
  return {
    type: 'REFUSE',
    reason,
    alternatives,
    context
  };
}

/**
 * Create an ANSWER decision
 * 
 * @param {string} template - ResponseTemplate
 * @param {Object} options - { dataRef?, data?, verbosity?, context? }
 */
export function answer(template, options = {}) {
  if (!ResponseTemplate[template] && !Object.values(ResponseTemplate).includes(template)) {
    console.warn(`Unknown response template: ${template}`);
  }
  
  return {
    type: 'ANSWER',
    template,
    dataRef: options.dataRef || null,
    data: options.data || null,
    verbosity: options.verbosity || Verbosity.NORMAL,
    context: options.context || {}
  };
}

/**
 * Create a MULTI_STEP decision
 */
export function multiStep(steps, parallel = false) {
  return {
    type: 'MULTI_STEP',
    steps,
    parallel
  };
}

// ════════════════════════════════════════════════════════════════════════════
// DECISION VALIDATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Validate a CRE decision
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateDecision(decision) {
  const errors = [];
  
  if (!decision) {
    return { valid: false, errors: ['Decision is null'] };
  }
  
  if (!decision.type) {
    return { valid: false, errors: ['Decision has no type'] };
  }
  
  switch (decision.type) {
    case 'TOOL_CALL':
      if (!decision.tool) errors.push('TOOL_CALL missing tool');
      if (decision.params === undefined) errors.push('TOOL_CALL missing params');
      break;
      
    case 'ASK_USER':
      if (!decision.slots || decision.slots.length === 0) {
        errors.push('ASK_USER missing slots');
      }
      if (!decision.template) errors.push('ASK_USER missing template');
      break;
      
    case 'REFUSE':
      if (!decision.reason) errors.push('REFUSE missing reason');
      break;
      
    case 'ANSWER':
      if (!decision.template) errors.push('ANSWER missing template');
      // ANSWER must NOT have content string
      if (typeof decision.content === 'string') {
        errors.push('ANSWER must not have content string - use template + data');
      }
      break;
      
    case 'MULTI_STEP':
      if (!decision.steps || decision.steps.length === 0) {
        errors.push('MULTI_STEP missing steps');
      } else {
        // Validate each step
        for (let i = 0; i < decision.steps.length; i++) {
          const stepValidation = validateDecision(decision.steps[i]);
          if (!stepValidation.valid) {
            errors.push(`Step ${i}: ${stepValidation.errors.join(', ')}`);
          }
        }
      }
      break;
      
    default:
      errors.push(`Unknown decision type: ${decision.type}`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Check if decision is a specific type
 */
export function isToolCall(decision) {
  return decision?.type === 'TOOL_CALL';
}

export function isAskUser(decision) {
  return decision?.type === 'ASK_USER';
}

export function isRefuse(decision) {
  return decision?.type === 'REFUSE';
}

export function isAnswer(decision) {
  return decision?.type === 'ANSWER';
}

export function isMultiStep(decision) {
  return decision?.type === 'MULTI_STEP';
}

// ════════════════════════════════════════════════════════════════════════════
// LEGACY COMPATIBILITY
// ════════════════════════════════════════════════════════════════════════════

/**
 * Convert legacy CRE result to new decision format
 * Used during migration period
 * 
 * @deprecated Will be removed after full migration
 */
export function fromLegacyResult(text, speechAct, action) {
  // Try to infer decision type from action
  if (action === 'REFUSE') {
    return refuse('OUT_OF_SCOPE', [], { legacyText: text });
  }
  
  if (action === 'ASK_CLARIFICATION' || action === 'REQUEST_CONTEXT') {
    return askUser(
      [createSlotRequest('clarification', 'text', { required: true })],
      ResponseTemplate.CLARIFICATION_NEEDED,
      { legacyText: text }
    );
  }
  
  // Default to ANSWER with legacy text in context
  // ResponseRenderer will use legacyText if no proper data
  return answer(ResponseTemplate.FACTUAL_ANSWER, {
    context: { legacyText: text, speechAct }
  });
}

/**
 * Check if decision has legacy text (needs migration)
 */
export function hasLegacyText(decision) {
  return decision?.context?.legacyText !== undefined;
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  // Enums
  ToolName,
  RefusalReason,
  ResponseTemplate,
  Verbosity,
  
  // Creators
  toolCall,
  askUser,
  refuse,
  answer,
  multiStep,
  createSlotRequest,
  
  // Validation
  validateDecision,
  isToolCall,
  isAskUser,
  isRefuse,
  isAnswer,
  isMultiStep,
  
  // Legacy
  fromLegacyResult,
  hasLegacyText
};
