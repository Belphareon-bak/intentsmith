// CRE v36.6 Execution Contracts
// ══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE: Define what each CRE decision REQUIRES to execute
//
// This is the missing link between:
//   CRE Decision → Execution Layer
//
// Every action has preconditions. If not met → BLOCK, don't crash.
//
// v36.6: Added ExecutionBlockReason for deterministic fallback selection
//
// ══════════════════════════════════════════════════════════════════════════════

import { SystemAction, WorkflowIntent, DataRequirement } from './dialog-state-v2.js';

// ════════════════════════════════════════════════════════════════════════════
// EXECUTION BLOCK REASONS (v36.6)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Normalized reasons why execution was blocked
 * Each reason maps to a specific fallback response template
 */
export const ExecutionBlockReason = {
  MISSING_BACKEND: 'MISSING_BACKEND',       // No search/API backend configured
  MISSING_DATA: 'MISSING_DATA',             // No data to process
  MISSING_SOURCES: 'MISSING_SOURCES',       // No news/content sources
  MISSING_SLOTS: 'MISSING_SLOTS',           // Required parameters not provided
  PERMISSION_REQUIRED: 'PERMISSION_REQUIRED', // User permission needed
  BACKEND_UNAVAILABLE: 'BACKEND_UNAVAILABLE'  // Backend exists but offline
};

// ════════════════════════════════════════════════════════════════════════════
// EXECUTION FALLBACK TEMPLATES (v36.6)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Deterministic fallback responses based on block reason
 * NEVER generic, ALWAYS capability-truthful
 */
export const ExecutionFallbackTemplates = {
  [ExecutionBlockReason.MISSING_BACKEND]: (ctx) => `🔍 **Vyhledávání je dostupné**, ale není připojen backend.

${ctx.availableBackends?.length > 0 
  ? `Dostupné backendy: ${ctx.availableBackends.join(', ')}\n\n` 
  : ''}Mohu:
• připravit přesný vyhledávací dotaz
• doporučit vhodné zdroje
• navrhnout filtry a kritéria

Jak chceš pokračovat?`,

  [ExecutionBlockReason.MISSING_DATA]: (ctx) => `📊 **Tuto akci umím provést**, ale chybí vstupní data.

Pro ${ctx.action || 'tuto operaci'} potřebuji:
• data k analýze / zpracování
• nebo zdroj, odkud je získat

Můžeš mi poskytnout data, nebo mám navrhnout kde je sehnat?`,

  [ExecutionBlockReason.MISSING_SOURCES]: (ctx) => `📰 **Mohu vytvořit souhrn zpráv**, ale potřebuji zdroje.

Dostupné zdroje:
• Reuters, AP, ČTK (mezinárodní)
• Novinky, iDnes, Seznam Zprávy (české)
• Specializované podle tématu

Které zdroje mám použít?`,

  [ExecutionBlockReason.MISSING_SLOTS]: (ctx) => `❓ **Rozumím co chceš**, ale potřebuji upřesnění.

Chybí: ${ctx.missingSlots?.join(', ') || 'některé parametry'}

Můžeš mi to upřesnit?`,

  [ExecutionBlockReason.PERMISSION_REQUIRED]: (ctx) => `🔐 **Tuto akci umím**, ale vyžaduje povolení.

Pro ${ctx.action || 'tuto operaci'} potřebuji tvůj souhlas.

Chceš pokračovat?`,

  [ExecutionBlockReason.BACKEND_UNAVAILABLE]: (ctx) => `⚠️ **Backend je momentálně nedostupný.**

${ctx.backend ? `(${ctx.backend})` : ''}

Mohu:
• zkusit znovu za chvíli
• použít alternativní zdroj
• připravit data offline

Co preferuješ?`
};

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
  [WorkflowIntent.CALENDAR]: ExecutionContracts[SystemAction.ANSWER],  // Calendar needs nothing special
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
 * Determine the block reason from missing items
 */
function determineBlockReason(workflowIntent, missing) {
  if (missing.includes('searchBackend') || missing.includes('marketplace')) {
    return ExecutionBlockReason.MISSING_BACKEND;
  }
  if (missing.includes('data') || missing.includes('dataLength')) {
    return ExecutionBlockReason.MISSING_DATA;
  }
  if (missing.includes('newsSources') || missing.includes('corpus')) {
    return ExecutionBlockReason.MISSING_SOURCES;
  }
  if (missing.length > 0) {
    return ExecutionBlockReason.MISSING_SLOTS;
  }
  return null;
}

/**
 * Generate fallback response based on block reason
 */
export function generateExecutionFallback(blockReason, context = {}) {
  const template = ExecutionFallbackTemplates[blockReason];
  if (!template) {
    return '❓ Pro tuto akci chybí některé požadavky. Můžeš mi je upřesnit?';
  }
  return template(context);
}

/**
 * Guards execution - prevents crashes from missing data
 * 
 * This is the KEY function that should be called BEFORE any execution
 * 
 * @param {WorkflowIntent} workflowIntent - What we're trying to do
 * @param {Object} rawContext - Raw execution context (may have undefined)
 * @returns {{ canExecute: boolean, context: Object, error: string|null, blockReason: string|null, fallbackResponse: string|null }}
 */
export function guardExecution(workflowIntent, rawContext) {
  // Step 1: Create safe context (no undefined)
  const safeContext = createSafeExecutionContext(rawContext);
  
  // Step 2: Validate contract
  const validation = validateExecutionContract(workflowIntent, safeContext);
  
  if (!validation.valid) {
    const blockReason = determineBlockReason(workflowIntent, validation.missing);
    const fallbackResponse = generateExecutionFallback(blockReason, {
      ...safeContext,
      missingSlots: validation.missing,
      action: workflowIntent
    });
    
    return {
      canExecute: false,
      context: safeContext,
      error: validation.blockMessage,
      missing: validation.missing,
      blockReason,
      fallbackResponse
    };
  }
  
  return {
    canExecute: true,
    context: safeContext,
    error: null,
    missing: [],
    blockReason: null,
    fallbackResponse: null
  };
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

export default {
  ExecutionContracts,
  WorkflowContracts,
  ExecutionBlockReason,
  ExecutionFallbackTemplates,
  validateExecutionContract,
  createSafeExecutionContext,
  guardExecution,
  generateExecutionFallback
};
