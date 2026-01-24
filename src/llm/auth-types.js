// CRE v36.7 LLM Auth Types
// ══════════════════════════════════════════════════════════════════════════════
//
// Capability-based authorization for LLM calls.
// ONLY authorized callers (CRE, Synthesizer, Reflector) can call LLM.
//
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Roles that can call LLM
 * Each role has different capabilities and limits
 */
export const LLMCallerRole = {
  // CRE decision making - full reasoning
  CRE_DECISION: 'CRE_DECISION',
  
  // Planning multi-step actions (v38+)
  CRE_PLANNING: 'CRE_PLANNING',
  
  // Response synthesis (v39+)
  SYNTHESIZER: 'SYNTHESIZER',
  
  // Self-correction reflection (v39+)
  REFLECTOR: 'REFLECTOR',
  
  // Tool-specific LLM (restricted, rare)
  TOOL_INTERNAL: 'TOOL_INTERNAL',
  
  // Workflow engine steps
  WORKFLOW_CLASSIFIER: 'WORKFLOW_CLASSIFIER',
  WORKFLOW_THINKER: 'WORKFLOW_THINKER',
  WORKFLOW_ANALYZER: 'WORKFLOW_ANALYZER',
  WORKFLOW_PLANNER: 'WORKFLOW_PLANNER',
  WORKFLOW_CODER: 'WORKFLOW_CODER',
  WORKFLOW_REVIEWER: 'WORKFLOW_REVIEWER',
  
  // Legacy support (will be removed)
  LEGACY_DIRECT: 'LEGACY_DIRECT'
};

/**
 * Capabilities that can be granted to a caller
 */
export const LLMCapability = {
  REASONING: 'reasoning',           // Complex reasoning chains
  JSON_OUTPUT: 'json_output',       // Structured JSON output
  SUMMARIZATION: 'summarization',   // Text summarization
  CLASSIFICATION: 'classification', // Intent/topic classification
  CODE_GENERATION: 'code_generation', // Generate code
  CODE_REVIEW: 'code_review',       // Review/analyze code
  TRANSLATION: 'translation',       // Language translation
  EXTRACTION: 'extraction'          // Information extraction
};

/**
 * Default capabilities for each role
 */
export const RoleCapabilities = {
  [LLMCallerRole.CRE_DECISION]: [
    LLMCapability.REASONING,
    LLMCapability.JSON_OUTPUT,
    LLMCapability.CLASSIFICATION
  ],
  
  [LLMCallerRole.CRE_PLANNING]: [
    LLMCapability.REASONING,
    LLMCapability.JSON_OUTPUT
  ],
  
  [LLMCallerRole.SYNTHESIZER]: [
    LLMCapability.SUMMARIZATION,
    LLMCapability.EXTRACTION
  ],
  
  [LLMCallerRole.REFLECTOR]: [
    LLMCapability.REASONING,
    LLMCapability.JSON_OUTPUT
  ],
  
  [LLMCallerRole.TOOL_INTERNAL]: [
    LLMCapability.EXTRACTION
  ],
  
  [LLMCallerRole.WORKFLOW_CLASSIFIER]: [
    LLMCapability.CLASSIFICATION,
    LLMCapability.JSON_OUTPUT
  ],
  
  [LLMCallerRole.WORKFLOW_THINKER]: [
    LLMCapability.REASONING
  ],
  
  [LLMCallerRole.WORKFLOW_ANALYZER]: [
    LLMCapability.REASONING,
    LLMCapability.JSON_OUTPUT
  ],
  
  [LLMCallerRole.WORKFLOW_PLANNER]: [
    LLMCapability.REASONING,
    LLMCapability.JSON_OUTPUT,
    LLMCapability.CODE_GENERATION
  ],
  
  [LLMCallerRole.WORKFLOW_CODER]: [
    LLMCapability.CODE_GENERATION,
    LLMCapability.JSON_OUTPUT
  ],
  
  [LLMCallerRole.WORKFLOW_REVIEWER]: [
    LLMCapability.CODE_REVIEW,
    LLMCapability.REASONING
  ],
  
  // Legacy - all capabilities (temporary)
  [LLMCallerRole.LEGACY_DIRECT]: Object.values(LLMCapability)
};

/**
 * Default token limits for each role
 */
export const RoleTokenLimits = {
  [LLMCallerRole.CRE_DECISION]: 2000,
  [LLMCallerRole.CRE_PLANNING]: 3000,
  [LLMCallerRole.SYNTHESIZER]: 1000,
  [LLMCallerRole.REFLECTOR]: 1500,
  [LLMCallerRole.TOOL_INTERNAL]: 500,
  [LLMCallerRole.WORKFLOW_CLASSIFIER]: 500,
  [LLMCallerRole.WORKFLOW_THINKER]: 2000,
  [LLMCallerRole.WORKFLOW_ANALYZER]: 2000,
  [LLMCallerRole.WORKFLOW_PLANNER]: 4000,
  [LLMCallerRole.WORKFLOW_CODER]: 8000,
  [LLMCallerRole.WORKFLOW_REVIEWER]: 3000,
  [LLMCallerRole.LEGACY_DIRECT]: 4096
};

/**
 * LLM Authorization Token
 * 
 * @typedef {Object} LLMAuthToken
 * @property {string} role - LLMCallerRole
 * @property {string} decisionId - Unique ID for this decision
 * @property {number} maxTokens - Maximum tokens for this call
 * @property {string[]} allowedCapabilities - What this call can do
 * @property {Object} auditContext - Context for audit logging
 * @property {string} auditContext.sessionId - Session ID
 * @property {string} [auditContext.goalId] - Goal ID (for persistent goals)
 * @property {string} [auditContext.stepId] - Step ID (for multi-step)
 * @property {number} issuedAt - Timestamp when token was issued
 * @property {number} expiresAt - Timestamp when token expires
 */

/**
 * Create an LLM auth token
 * 
 * @param {Object} params
 * @param {string} params.role - LLMCallerRole
 * @param {string} params.decisionId - Unique decision ID
 * @param {Object} params.auditContext - Audit context
 * @param {number} [params.maxTokens] - Override default token limit
 * @param {string[]} [params.capabilities] - Override default capabilities
 * @returns {LLMAuthToken}
 */
export function createAuthToken({
  role,
  decisionId,
  auditContext,
  maxTokens = null,
  capabilities = null
}) {
  if (!role || !LLMCallerRole[role]) {
    throw new Error(`Invalid LLM caller role: ${role}`);
  }
  
  if (!decisionId) {
    throw new Error('decisionId is required for LLM auth token');
  }
  
  if (!auditContext?.sessionId) {
    throw new Error('auditContext.sessionId is required');
  }
  
  const now = Date.now();
  
  return {
    role,
    decisionId,
    maxTokens: maxTokens ?? RoleTokenLimits[role] ?? 2000,
    allowedCapabilities: capabilities ?? RoleCapabilities[role] ?? [],
    auditContext: {
      sessionId: auditContext.sessionId,
      goalId: auditContext.goalId || null,
      stepId: auditContext.stepId || null
    },
    issuedAt: now,
    expiresAt: now + 300000  // 5 minutes default TTL
  };
}

/**
 * Validate an auth token
 * 
 * @param {LLMAuthToken} token
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateAuthToken(token) {
  if (!token) {
    return { valid: false, error: 'NO_TOKEN' };
  }
  
  if (!token.role) {
    return { valid: false, error: 'MISSING_ROLE' };
  }
  
  if (!token.decisionId) {
    return { valid: false, error: 'MISSING_DECISION_ID' };
  }
  
  if (Date.now() > token.expiresAt) {
    return { valid: false, error: 'TOKEN_EXPIRED' };
  }
  
  return { valid: true };
}

/**
 * Check if token has required capability
 * 
 * @param {LLMAuthToken} token
 * @param {string} capability
 * @returns {boolean}
 */
export function hasCapability(token, capability) {
  if (!token || !token.allowedCapabilities) return false;
  return token.allowedCapabilities.includes(capability);
}

export default {
  LLMCallerRole,
  LLMCapability,
  RoleCapabilities,
  RoleTokenLimits,
  createAuthToken,
  validateAuthToken,
  hasCapability
};
