// CRE v55.1 — Handler Utilities Index
// ══════════════════════════════════════════════════════════════════════════════
// Re-exports all handler utilities for convenient importing
// ══════════════════════════════════════════════════════════════════════════════

// Intent detection utilities
export {
  CLARIFICATION_KEYWORDS,
  isClarification,
  resolveClarificationIntent,
  detectAffirmative,
  isVagueInput,
} from './intent.js';

// Quality gates
export {
  assertCreativeQuality,
  detectFluff,
  atomicAnswerGate,
  countSentences,
  buildAtomicRetryPrompt,
  buildFluffRetryPrompt,
  SYNTHESIS_THRESHOLDS,
} from './quality.js';

// LLM Synthesis
export {
  synthesizeWithLLM,
  buildSynthesisPrompt,
  buildSynthesisSystemPrompt,
  buildSynthesisFailureResponse,
  buildBasicSynthesis,
  applyAdaptiveResultCount,
  isListQuery,
  isSpecificQuery,
  calculateRelevanceScore,
} from './synthesis.js';

// Follow-up detection
export {
  FollowUpType,
  detectFollowUpType,
  getPreviousToolData,
  tryResolveClarification,
} from './followup.js';

// Default export with all utilities grouped
export default {
  // Intent
  CLARIFICATION_KEYWORDS: (await import('./intent.js')).CLARIFICATION_KEYWORDS,
  isClarification: (await import('./intent.js')).isClarification,
  resolveClarificationIntent: (await import('./intent.js')).resolveClarificationIntent,
  detectAffirmative: (await import('./intent.js')).detectAffirmative,
  isVagueInput: (await import('./intent.js')).isVagueInput,
  
  // Quality
  assertCreativeQuality: (await import('./quality.js')).assertCreativeQuality,
  detectFluff: (await import('./quality.js')).detectFluff,
  atomicAnswerGate: (await import('./quality.js')).atomicAnswerGate,
  
  // Synthesis
  synthesizeWithLLM: (await import('./synthesis.js')).synthesizeWithLLM,
  
  // Follow-up
  FollowUpType: (await import('./followup.js')).FollowUpType,
  detectFollowUpType: (await import('./followup.js')).detectFollowUpType,
};
