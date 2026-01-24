// CRE v37.0 Reference Resolver
// ══════════════════════════════════════════════════════════════════════════════
//
// Resolves anaphoric references in user input:
//   "to předchozí" → last decision/result
//   "ten report" → last artifact
//   "to auto" → last search result matching 'auto'
//   "uprav to" → last tool result
//   "jinak" → correction of last decision
//
// NOT an LLM call. Pattern-based resolution from session context.
//
// CRE workflow:
//   raw input → ReferenceResolver.resolve(input, session) → ResolvedInput
//   → intent detection → decision
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ════════════════════════════════════════════════════════════════════════════
// REFERENCE PATTERNS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Pattern definitions for reference detection
 * Each pattern has:
 *   regex: what to match
 *   type: what kind of reference
 *   resolve: function(session) → resolved value
 */
const REFERENCE_PATTERNS = [
  // Czech: "to předchozí", "předchozí výsledek", "ten předchozí"
  {
    regex: /\b(to\s+)?předchoz[ií](\s+výsledek)?\b/i,
    type: 'LAST_RESULT',
    resolve: (session) => session.lastToolResult || session.lastDecision,
  },
  // Czech: "ten report", "ten dokument", "ten soubor"
  {
    regex: /\b(ten|ta|to)\s+(report|dokument|soubor|artifact|výstup)\b/i,
    type: 'LAST_ARTIFACT',
    resolve: (session) => findLastArtifact(session),
  },
  // Czech: "uprav to", "změň to", "oprav to"
  {
    regex: /\b(uprav|změň|oprav|předělej)\s+(to|ho|ji)\b/i,
    type: 'CORRECTION',
    resolve: (session) => session.lastDecision,
  },
  // Czech: "jinak", "myslel jsem jinak", "ne takhle"
  {
    regex: /\b(jinak|ne\s+takhle|myslel\s+jsem\s+jinak|špatně)\b/i,
    type: 'CORRECTION',
    resolve: (session) => session.lastDecision,
  },
  // Czech: "to samé", "znovu", "ještě jednou"
  {
    regex: /\b(to\s+samé|znovu|ještě\s+jednou|opakuj)\b/i,
    type: 'REPEAT',
    resolve: (session) => session.lastDecision,
  },
  // English: "the previous", "last result"
  {
    regex: /\b(the\s+)?(previous|last)\s*(result|output|one)?\b/i,
    type: 'LAST_RESULT',
    resolve: (session) => session.lastToolResult || session.lastDecision,
  },
  // English: "that file", "that document", "the report"
  {
    regex: /\b(that|the)\s+(file|document|report|artifact|output)\b/i,
    type: 'LAST_ARTIFACT',
    resolve: (session) => findLastArtifact(session),
  },
  // English: "fix it", "change it", "modify it"
  {
    regex: /\b(fix|change|modify|edit|update)\s+(it|that|this)\b/i,
    type: 'CORRECTION',
    resolve: (session) => session.lastDecision,
  },
  // English: "differently", "not like that", "wrong"
  {
    regex: /\b(differently|not\s+like\s+that|wrong|incorrect)\b/i,
    type: 'CORRECTION',
    resolve: (session) => session.lastDecision,
  },
];

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

function findLastArtifact(session) {
  // Look through recent turns for artifact-producing decisions
  const turns = session.recentTurns || session.getRecentTurns?.(5) || [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    const d = turn.decision;
    if (d && d.tool && d.tool.startsWith('artifact.')) {
      return turn.executionResult || d;
    }
    if (d && d.tool && d.tool === 'fs.write') {
      return turn.executionResult || d;
    }
  }
  // Fallback to last result
  return session.lastToolResult || session.lastDecision;
}

function findByKeyword(session, keyword) {
  // Search recent results for a keyword match
  const turns = session.recentTurns || session.getRecentTurns?.(10) || [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.executionResult && matchesKeyword(turn.executionResult, keyword)) {
      return turn.executionResult;
    }
    if (turn.userMessage && turn.userMessage.includes(keyword)) {
      return turn.executionResult || turn.decision;
    }
  }
  return null;
}

function matchesKeyword(result, keyword) {
  const str = JSON.stringify(result).toLowerCase();
  return str.includes(keyword.toLowerCase());
}

// ════════════════════════════════════════════════════════════════════════════
// RESOLVED INPUT
// ════════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} ResolvedInput
 * @property {string} original - Original user message
 * @property {boolean} hasReference - Whether a reference was detected
 * @property {string|null} referenceType - LAST_RESULT | LAST_ARTIFACT | CORRECTION | REPEAT | KEYWORD
 * @property {Object|null} resolvedFrom - The resolved context object
 * @property {Object|null} resolvedSlots - Current slot values
 * @property {boolean} isCorrection - Whether this is a correction of previous decision
 */

// ════════════════════════════════════════════════════════════════════════════
// REFERENCE RESOLVER
// ════════════════════════════════════════════════════════════════════════════

export class ReferenceResolver {
  constructor() {
    this.patterns = [...REFERENCE_PATTERNS];
    this.stats = { resolved: 0, unresolved: 0, byType: {} };
  }

  /**
   * Resolve references in user input using session context
   *
   * @param {string} message - Raw user message
   * @param {SessionMemory|Object} session - Session memory (or context from getContext())
   * @returns {ResolvedInput}
   */
  resolve(message, session) {
    if (!message || typeof message !== 'string') {
      return this.noReference(message || '');
    }

    // Try each pattern
    for (const pattern of this.patterns) {
      if (pattern.regex.test(message)) {
        const resolved = pattern.resolve(session);
        if (resolved) {
          this.stats.resolved++;
          this.stats.byType[pattern.type] = (this.stats.byType[pattern.type] || 0) + 1;

          logger.debug('ReferenceResolver', `Resolved: ${pattern.type}`, {
            message: message.slice(0, 50),
          });

          return {
            original: message,
            hasReference: true,
            referenceType: pattern.type,
            resolvedFrom: resolved,
            resolvedSlots: session.activeSlots || session.getAllSlots?.() || {},
            isCorrection: pattern.type === 'CORRECTION',
          };
        }
      }
    }

    // No pattern matched — try keyword-based reference ("to auto", "ten Jimny")
    const keywordRef = this.tryKeywordReference(message, session);
    if (keywordRef) {
      return keywordRef;
    }

    this.stats.unresolved++;
    return this.noReference(message);
  }

  /**
   * Try to resolve by extracting a keyword that matches previous results
   * Pattern: "to/ten/ta + noun" where noun matches something in session
   */
  tryKeywordReference(message, session) {
    const match = message.match(/\b(to|ten|ta|tu)\s+(\w+)\b/i);
    if (!match) return null;

    const keyword = match[2];
    // Skip common words that aren't references
    if (['je', 'jsem', 'bude', 'bylo', 'jsou', 'mám', 'chci'].includes(keyword.toLowerCase())) {
      return null;
    }

    const found = findByKeyword(session, keyword);
    if (found) {
      this.stats.resolved++;
      this.stats.byType.KEYWORD = (this.stats.byType.KEYWORD || 0) + 1;

      logger.debug('ReferenceResolver', `Keyword resolved: "${keyword}"`, {
        message: message.slice(0, 50),
      });

      return {
        original: message,
        hasReference: true,
        referenceType: 'KEYWORD',
        resolvedFrom: found,
        resolvedSlots: session.activeSlots || session.getAllSlots?.() || {},
        isCorrection: false,
      };
    }

    return null;
  }

  noReference(message) {
    return {
      original: message,
      hasReference: false,
      referenceType: null,
      resolvedFrom: null,
      resolvedSlots: null,
      isCorrection: false,
    };
  }

  /**
   * Check if message contains any reference (quick check without resolution)
   */
  containsReference(message) {
    if (!message) return false;
    return this.patterns.some(p => p.regex.test(message));
  }

  /**
   * Get resolver stats
   */
  getStats() {
    return { ...this.stats };
  }
}

// Singleton
export const referenceResolver = new ReferenceResolver();

export default ReferenceResolver;
