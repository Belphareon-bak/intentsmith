// CRE v36.4.3 Execution Contracts
// ══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE: Define what each CRE decision REQUIRES to execute
//
// This is the missing link between:
//   CRE Decision → Execution Layer
//
// Every action has preconditions. If not met → BLOCK, don't crash.
//
// ══════════════════════════════════════════════════════════════════════════════

import { SystemAction, WorkflowIntent, DataRequirement } from './dialog-state-v2.js';

// ════════════════════════════════════════════════════════════════════════════
// EXECUTION CONTRACT DEFINITION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Execution Contract - what an action REQUIRES to execute
 * 
 * @typedef {Object} ExecutionContract
 * @property {string} action - SystemAction that this contract applies to
 * @property {string[]} requires - List of required capabilities/data
 * @property {string[]} optional - List of optional capabilities
 * @property {Function} validate - Function to check if requirements are met
 * @property {string} blockMessage - Message to show if blocked
 */

// ════════════════════════════════════════════════════════════════════════════
// CONTRACT REGISTRY
// ════════════════════════════════════════════════════════════════════════════

export const ExecutionContracts = {
  // ─────────────────────────────────────────────────────────────────────────
  // ARTIFACT GENERATION CONTRACTS
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * REPORT generation requires underlying data
   */
  [SystemAction.ANSWER]: {
    action: SystemAction.ANSWER,
    requires: [],  // Basic answer needs nothing special
    optional: ['evidence'],
    validate: (context) => ({ valid: true, missing: [] }),
    blockMessage: null
  },
  
  /**
   * Report/Artifact generation requires data
   */
  ARTIFACT_GENERATION: {
    action: 'ARTIFACT_GENERATION',
    requires: ['data', 'dataLength'],
    optional: ['template', 'format'],
    validate: (context) => {
      const missing = [];
      
      if (!context.data) {
        missing.push('data');
      }
      if (context.data && (!Array.isArray(context.data) || context.data.length === 0)) {
        missing.push('dataLength');
      }
      
      return {
        valid: missing.length === 0,
        missing
      };
    },
    blockMessage: 'Artifact generation requires data. No data available.'
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // SEARCH CONTRACTS
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Market search requires search backend
   */
  MARKET_SEARCH: {
    action: 'MARKET_SEARCH',
    requires: ['searchBackend', 'marketplace'],
    optional: ['filters'],
    validate: (context) => {
      const missing = [];
      
      if (!context.searchBackend) {
        missing.push('searchBackend');
      }
      if (!context.marketplace) {
        missing.push('marketplace');
      }
      
      return {
        valid: missing.length === 0,
        missing
      };
    },
    blockMessage: 'Search requires marketplace access. No search backend configured.'
  },
  
  /**
   * Web search requires internet access
   */
  WEB_SEARCH: {
    action: 'WEB_SEARCH',
    requires: ['internetAccess'],
    optional: ['searchEngine'],
    validate: (context) => {
      const missing = [];
      
      if (!context.internetAccess) {
        missing.push('internetAccess');
      }
      
      return {
        valid: missing.length === 0,
        missing
      };
    },
    blockMessage: 'Web search requires internet access.'
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // NEWS/CORPUS CONTRACTS
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * News aggregation requires news sources
   */
  NEWS_AGGREGATION: {
    action: 'NEWS_AGGREGATION',
    requires: ['newsSources', 'corpus'],
    optional: ['timeRange', 'topic'],
    validate: (context) => {
      const missing = [];
      
      if (!context.newsSources || context.newsSources.length === 0) {
        missing.push('newsSources');
      }
      if (!context.corpus || context.corpus.length === 0) {
        missing.push('corpus');
      }
      
      return {
        valid: missing.length === 0,
        missing
      };
    },
    blockMessage: 'News aggregation requires external news sources. No sources available.'
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // REALTIME DATA CONTRACTS
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Realtime data query requires live source
   */
  REALTIME_DATA: {
    action: 'REALTIME_DATA',
    requires: ['liveDataSource'],
    optional: ['cacheTTL'],
    validate: (context) => {
      const missing = [];
      
      if (!context.liveDataSource) {
        missing.push('liveDataSource');
      }
      
      return {
        valid: missing.length === 0,
        missing
      };
    },
    blockMessage: 'Realtime data requires live data source.'
  }
};

// ════════════════════════════════════════════════════════════════════════════
// WORKFLOW → CONTRACT MAPPING
// ════════════════════════════════════════════════════════════════════════════

/**
 * Maps WorkflowIntent to required ExecutionContract
 */
export const WorkflowContracts = {
  [WorkflowIntent.SEARCH]: ExecutionContracts.MARKET_SEARCH,
  [WorkflowIntent.NEWS_AGGREGATION]: ExecutionContracts.NEWS_AGGREGATION,
  [WorkflowIntent.REPORT]: ExecutionContracts.ARTIFACT_GENERATION,
  [WorkflowIntent.ADVICE]: ExecutionContracts[SystemAction.ANSWER],
  [WorkflowIntent.CHAT]: ExecutionContracts[SystemAction.ANSWER]
};

// ════════════════════════════════════════════════════════════════════════════
// CONTRACT VALIDATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Validates if execution can proceed for given workflow intent
 * 
 * @param {WorkflowIntent} workflowIntent - The detected workflow intent
 * @param {Object} executionContext - Available capabilities and data
 * @returns {{ valid: boolean, missing: string[], blockMessage: string|null }}
 */
export function validateExecutionContract(workflowIntent, executionContext) {
  const contract = WorkflowContracts[workflowIntent];
  
  if (!contract) {
    // No contract defined = no special requirements
    return { valid: true, missing: [], blockMessage: null };
  }
  
  const result = contract.validate(executionContext);
  
  return {
    valid: result.valid,
    missing: result.missing,
    blockMessage: result.valid ? null : contract.blockMessage
  };
}

/**
 * Creates a safe execution context with defaults
 * Prevents undefined.length errors
 */
export function createSafeExecutionContext(rawContext) {
  // Handle null/undefined input
  const ctx = rawContext || {};
  
  return {
    // Data
    data: ctx.data || null,
    corpus: ctx.corpus || [],
    
    // Sources
    newsSources: ctx.newsSources || [],
    liveDataSource: ctx.liveDataSource || null,
    
    // Backends
    searchBackend: ctx.searchBackend || null,
    marketplace: ctx.marketplace || null,
    internetAccess: ctx.internetAccess || false,
    
    // Metadata
    filters: ctx.filters || {},
    timeRange: ctx.timeRange || null,
    topic: ctx.topic || null,
    
    // Raw access (for custom validation)
    _raw: ctx
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EXECUTION GUARD
// ════════════════════════════════════════════════════════════════════════════

/**
 * Guards execution - prevents crashes from missing data
 * 
 * This is the KEY function that should be called BEFORE any execution
 * 
 * @param {WorkflowIntent} workflowIntent - What we're trying to do
 * @param {Object} rawContext - Raw execution context (may have undefined)
 * @returns {{ canExecute: boolean, context: Object, error: string|null }}
 */
export function guardExecution(workflowIntent, rawContext) {
  // Step 1: Create safe context (no undefined)
  const safeContext = createSafeExecutionContext(rawContext);
  
  // Step 2: Validate contract
  const validation = validateExecutionContract(workflowIntent, safeContext);
  
  if (!validation.valid) {
    return {
      canExecute: false,
      context: safeContext,
      error: validation.blockMessage,
      missing: validation.missing
    };
  }
  
  return {
    canExecute: true,
    context: safeContext,
    error: null,
    missing: []
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  ExecutionContracts,
  WorkflowContracts,
  validateExecutionContract,
  createSafeExecutionContext,
  guardExecution
};
