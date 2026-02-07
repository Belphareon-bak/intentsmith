// CRE v55.1 — Intent Detection Utilities
// ══════════════════════════════════════════════════════════════════════════════
// Extracted from handlers.js for better modularity
// ══════════════════════════════════════════════════════════════════════════════

import { IntentType } from '../../cre-decision.js';

// ─────────────────────────────────────────────────────────────────────────────
// CLARIFICATION KEYWORDS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * v44.2 - Intent resolution keywords for clarification responses
 * Maps single-word clarifications to their corresponding intent type
 */
export const CLARIFICATION_KEYWORDS = {
  // Search intent
  'vyhledávání': IntentType.SEARCH,
  'vyhledavani': IntentType.SEARCH,
  'hledat': IntentType.SEARCH,
  'search': IntentType.SEARCH,
  'najít': IntentType.SEARCH,
  'najit': IntentType.SEARCH,

  // Report intent
  'report': IntentType.REPORT,
  'souhrn': IntentType.REPORT,
  'analýza': IntentType.REPORT,
  'analyza': IntentType.REPORT,
  'přehled': IntentType.REPORT,
  'prehled': IntentType.REPORT,
  'summary': IntentType.REPORT,

  // Code intent
  'kód': IntentType.CODE,
  'kod': IntentType.CODE,
  'code': IntentType.CODE,
  'napsat': IntentType.CODE,
  'programovat': IntentType.CODE,

  // Conversational intent
  'chat': IntentType.CONVERSATIONAL,
  'konverzace': IntentType.CONVERSATIONAL,
  'povídání': IntentType.CONVERSATIONAL,
  'povidat': IntentType.CONVERSATIONAL,
};

// ─────────────────────────────────────────────────────────────────────────────
// CLARIFICATION DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * v44.5 - Helper to detect clarification-like responses
 * 
 * Detects inputs that are likely follow-up clarifications rather than
 * new questions. Used to maintain context across turns.
 * 
 * @param {string} input - User input to analyze
 * @returns {boolean} True if input appears to be a clarification
 */
export function isClarification(input) {
  if (!input || typeof input !== 'string') return false;

  const trimmed = input.trim();
  const words = trimmed.split(/\s+/).length;

  // Short responses (1-5 words) are likely clarifications
  if (words <= 5) return true;

  // Affirmative/negative patterns
  if (/^(ano|ne|jo|jasně|fajn|ok|yes|no|pokračuj|zrušit|cancel|stop)$/i.test(trimmed)) return true;

  // Single keywords from CLARIFICATION_KEYWORDS
  if (CLARIFICATION_KEYWORDS[trimmed.toLowerCase()]) return true;

  // Starts with clarification phrases
  if (/^(chci|chtěl bych|zkus|použij|raději|místo|instead)/i.test(trimmed)) return true;

  // URL only
  if (/^https?:\/\/\S+$/i.test(trimmed)) return true;

  // Number/selection only (e.g., "1", "první", "2.")
  if (/^[1-4]\.?$|^(první|druhý|třetí|čtvrtý|first|second|third)$/i.test(trimmed)) return true;

  return false;
}

/**
 * Resolve clarification keyword to intent type
 * 
 * @param {string} input - User input
 * @returns {string|null} IntentType if resolved, null otherwise
 */
export function resolveClarificationIntent(input) {
  if (!input || typeof input !== 'string') return null;
  
  const trimmed = input.trim().toLowerCase();
  return CLARIFICATION_KEYWORDS[trimmed] || null;
}

/**
 * Check if input is a simple affirmative/negative response
 * 
 * @param {string} input - User input
 * @returns {'yes'|'no'|null}
 */
export function detectAffirmative(input) {
  if (!input || typeof input !== 'string') return null;
  
  const trimmed = input.trim().toLowerCase();
  
  if (/^(ano|jo|jasně|fajn|ok|yes|sure|yeah|yep|správně|přesně)$/.test(trimmed)) {
    return 'yes';
  }
  
  if (/^(ne|no|nope|nechci|zrušit|cancel|stop|nevadí)$/.test(trimmed)) {
    return 'no';
  }
  
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// VAGUE INPUT DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * v44.9 - Patterns for vague first-turn inputs that should NOT trigger search
 */
const VAGUE_INPUT_PATTERNS = [
  /^(něco|cokoliv|cokoli|prostě|whatever|anything|hmm|hm+|eh|uh)$/i,
  /^(nevím|idk|dunno|no idea)$/i,
  /^(pomoz|help|poraď|porad)$/i,
  /^(ahoj|hi|hello|hey|čau|cau)$/i,
];

/**
 * Check if input is too vague for search (especially on first turn)
 * 
 * @param {string} input - User input
 * @returns {boolean} True if input is vague
 */
export function isVagueInput(input) {
  if (!input || typeof input !== 'string') return true;
  
  const trimmed = input.trim();
  
  // Very short = vague
  if (trimmed.length < 3) return true;
  
  // Check explicit vague patterns
  for (const pattern of VAGUE_INPUT_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  
  return false;
}

export default {
  CLARIFICATION_KEYWORDS,
  isClarification,
  resolveClarificationIntent,
  detectAffirmative,
  isVagueInput,
};
