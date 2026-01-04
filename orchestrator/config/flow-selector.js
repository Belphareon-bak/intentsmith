/**
 * Flow Selector - Rule-based (Phase 1)
 * 
 * Deterministic flow selection based on request patterns.
 * NO AI calls - just pattern matching.
 * 
 * AI-powered selector will be added in Phase 2+ when runtime is stable.
 */

import { FLOWS } from "./flows.js";

/**
 * Selection rules (order matters - first match wins)
 */
const SELECTION_RULES = [
  {
    name: "dual-deliberation",
    match: (request, context) => {
      // Explicit request for dual deliberation
      if (request.flow === "dual-deliberation") return true;
      if (request.mode === "dual") return true;
      
      // Complex tasks that benefit from dual review
      const goal = (request.goal || request.prompt || "").toLowerCase();
      
      // Keywords suggesting complex decisions
      const complexKeywords = [
        "architect", "design", "refactor", "migrate",
        "security", "optimize", "scale", "infrastructure",
        "database", "api design", "system design"
      ];
      
      if (complexKeywords.some(kw => goal.includes(kw))) {
        return true;
      }
      
      // High-risk context
      if (context?.riskLevel === "high") return true;
      if (context?.requiresReview === true) return true;
      
      return false;
    },
    reasoning: "Complex task requiring dual deliberation"
  },
  
  {
    name: "single-pass",
    match: (request, context) => {
      // Explicit request
      if (request.flow === "single-pass") return true;
      if (request.mode === "single") return true;
      
      // Simple tasks
      const goal = (request.goal || request.prompt || "").toLowerCase();
      
      const simpleKeywords = [
        "fix bug", "add comment", "rename", "format",
        "update readme", "bump version", "simple"
      ];
      
      if (simpleKeywords.some(kw => goal.includes(kw))) {
        return true;
      }
      
      return false;
    },
    reasoning: "Simple task suitable for single-pass"
  }
];

/**
 * Select flow based on rules
 * 
 * @param {Object} request - Build request or prompt
 * @param {Object} context - Project context
 * @returns {{ selectedFlow: string, reasoning: string, confidence: number }}
 */
export function selectFlowRuleBased(request, context = {}) {
  for (const rule of SELECTION_RULES) {
    try {
      if (rule.match(request, context)) {
        return {
          selectedFlow: rule.name,
          reasoning: rule.reasoning,
          confidence: 1.0, // Rule-based = deterministic
          ruleMatched: rule.name
        };
      }
    } catch (err) {
      console.warn(`⚠️ Rule "${rule.name}" threw:`, err.message);
    }
  }
  
  // Default fallback
  return {
    selectedFlow: "single-pass",
    reasoning: "Default fallback - no specific rule matched",
    confidence: 0.5,
    ruleMatched: null
  };
}

/**
 * Get flow configuration by name
 * 
 * @param {string} flowName
 * @returns {Object|null}
 */
export function getFlow(flowName) {
  return FLOWS[flowName] || null;
}

/**
 * Get all available flow names
 * 
 * @returns {string[]}
 */
export function getAvailableFlows() {
  return Object.keys(FLOWS);
}

/**
 * Validate that a flow exists
 * 
 * @param {string} flowName
 * @returns {boolean}
 */
export function flowExists(flowName) {
  return flowName in FLOWS;
}
