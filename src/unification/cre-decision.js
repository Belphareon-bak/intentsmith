// CRE v44.0 — Decision Engine
// ══════════════════════════════════════════════════════════════════════════════
//
// Tool-first decision logic for CRE.
//
// INVARIANTS:
// 1. No text response without CRE Decision
// 2. SEARCH/FACT/REPORT = TOOL_CALL first (never ANSWER without tool)
// 3. CHAT mode ≠ text mode (CHAT is a goal type, not "allow LLM")
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Decision Types
// ─────────────────────────────────────────────────────────────────────────────

export const DecisionType = {
  TOOL_CALL: 'TOOL_CALL',     // Must call a tool first
  ASK_USER: 'ASK_USER',       // Need more information from user
  ANSWER: 'ANSWER',           // Can answer directly (rare - only pure chat)
  REFUSE: 'REFUSE',           // Cannot/should not process this
};

// ─────────────────────────────────────────────────────────────────────────────
// Intent Types (what the user wants)
// ─────────────────────────────────────────────────────────────────────────────

export const IntentType = {
  SEARCH: 'SEARCH',           // User wants to find information
  REPORT: 'REPORT',           // User wants a report/analysis requiring data
  FACTUAL: 'FACTUAL',         // User asks about facts (prices, events, URLs)
  CODE: 'CODE',               // User wants code generation/help
  CONVERSATIONAL: 'CONVERSATIONAL', // Pure chat (greetings, opinions, etc.)
  COMMAND: 'COMMAND',         // System command (/help, /clear, etc.)
  AMBIGUOUS: 'AMBIGUOUS',     // Need clarification
};

// ─────────────────────────────────────────────────────────────────────────────
// Tool Types
// ─────────────────────────────────────────────────────────────────────────────

export const ToolType = {
  WEB_SEARCH: 'web.search',
  WEB_SCRAPE: 'web.scrape',
  FILE_READ: 'file.read',
  FILE_WRITE: 'file.write',
  CODE_EXECUTE: 'code.execute',
  DATABASE_QUERY: 'database.query',
};

// ─────────────────────────────────────────────────────────────────────────────
// Forbidden Phrases (if LLM generates these, something is WRONG)
// ─────────────────────────────────────────────────────────────────────────────

export const FORBIDDEN_PHRASES = [
  'nemám přístup',
  'nemám aktuální',
  'nemohu procházet',
  'potřebuji URL',
  'potřeboval bych URL',
  'zadejte prosím URL',
  'poskytněte URL',
  'nemám k dispozici',
  'nemám možnost',
  'nemohu vyhledávat',
  'nemohu přistupovat',
  'I don\'t have access',
  'I cannot browse',
  'I cannot search',
  'provide a URL',
  'give me a URL',
  'I need a URL',
  'I don\'t have current',
  'I cannot access',
];

// ─────────────────────────────────────────────────────────────────────────────
// Intent Classification Patterns
// ─────────────────────────────────────────────────────────────────────────────

const SEARCH_PATTERNS = [
  /najdi/i, /hledej/i, /vyhledej/i, /search/i, /find/i,
  /co je/i, /kdo je/i, /what is/i, /who is/i,
  /aktuální/i, /current/i, /latest/i, /nejnovější/i,
  /cena/i, /price/i, /kolik stojí/i, /how much/i,
  /kde (je|jsou|najdu)/i, /where (is|are|can)/i,
  /kdy (je|jsou|bude)/i, /when (is|are|will)/i,
];

const REPORT_PATTERNS = [
  /vytvoř.*report/i, /create.*report/i,
  /analýza/i, /analysis/i, /analyze/i, /analyzuj/i,
  /shrnutí/i, /summary/i, /summarize/i, /shrň/i,
  /porovnej/i, /compare/i, /comparison/i, /srovnání/i,
  /přehled/i, /overview/i,
];

const FACTUAL_PATTERNS = [
  /počasí/i, /weather/i,
  /kurz/i, /exchange rate/i,
  /akcie/i, /stock/i,
  /bitcoin/i, /crypto/i, /krypto/i,
  /zpráv[ay]/i, /news/i,
  /výsledk[yů]/i, /results/i, /score/i,
  /statistik/i, /statistic/i,
];

const CODE_PATTERNS = [
  /napiš.*kód/i, /write.*code/i,
  /napiš.*funkci/i,           // "napiš mi funkci"
  /vytvoř.*funkci/i, /create.*function/i,
  /implementuj/i, /implement/i,
  /oprav.*bug/i, /fix.*bug/i,
  /refaktor/i, /refactor/i,
  /```/,  // Code block indicator
  /programuj/i,
  /kóduj/i,
  /funkci pro/i,              // "funkci pro sčítání"
  /class\s+\w+/i,             // "class Foo"
  /function\s+\w+/i,          // "function bar"
];

const CONVERSATIONAL_PATTERNS = [
  /^(ahoj|čau|nazdar|hi|hello|hey)[\s!.?]*$/i,
  /^(díky|děkuji|thanks|thank you)[\s!.?]*$/i,
  /^(jak se máš|how are you)/i,
  /^(co si myslíš|what do you think)/i,
  /tvůj názor/i, /your opinion/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// CRE Decision Engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CRE Decision - the result of analyzing user input
 *
 * CRITICAL INVARIANT: ANSWER is ONLY allowed for CONVERSATIONAL intent.
 * Any attempt to create ANSWER decision for other intents will throw.
 */
export class CREDecision {
  constructor({
    type,
    intent,
    tools = [],
    slots = [],
    reason,
    confidence = 0.8,
    metadata = {},
  }) {
    // ════════════════════════════════════════════════════════════════════════
    // INVARIANT GUARD: ANSWER only allowed for CONVERSATIONAL
    // ════════════════════════════════════════════════════════════════════════
    if (type === DecisionType.ANSWER && intent !== IntentType.CONVERSATIONAL) {
      const error = new Error(
        `ANSWER_NOT_ALLOWED_FOR_INTENT: Cannot create ANSWER decision for intent "${intent}". ` +
        `ANSWER is ONLY allowed for CONVERSATIONAL intent. Use TOOL_CALL or ASK_USER instead.`
      );
      logger.error('CREDecision', 'INVARIANT VIOLATION', {
        type,
        intent,
        reason,
        stack: error.stack?.split('\n').slice(0, 5).join(' <- '),
      });
      throw error;
    }

    this.type = type;
    this.intent = intent;
    this.tools = tools;      // Tools to call (for TOOL_CALL)
    this.slots = slots;      // Missing info (for ASK_USER)
    this.reason = reason;    // Why this decision
    this.confidence = confidence;
    this.metadata = metadata;
    this.timestamp = Date.now();
  }

  toJSON() {
    return {
      type: this.type,
      intent: this.intent,
      tools: this.tools,
      slots: this.slots,
      reason: this.reason,
      confidence: this.confidence,
      metadata: this.metadata,
    };
  }
}

/**
 * CRE Decision Engine
 * Analyzes user input and decides what action to take
 */
export class CREDecisionEngine {
  constructor(options = {}) {
    this.strictMode = options.strictMode ?? true;
    this.availableTools = options.availableTools || Object.values(ToolType);
  }

  /**
   * Classify the intent of user input
   * @param {string} input - User message
   * @returns {IntentType}
   */
  classifyIntent(input) {
    const text = input.trim();

    // Check patterns in order of specificity
    if (CODE_PATTERNS.some(p => p.test(text))) {
      return IntentType.CODE;
    }

    if (REPORT_PATTERNS.some(p => p.test(text))) {
      return IntentType.REPORT;
    }

    if (FACTUAL_PATTERNS.some(p => p.test(text))) {
      return IntentType.FACTUAL;
    }

    if (SEARCH_PATTERNS.some(p => p.test(text))) {
      return IntentType.SEARCH;
    }

    if (CONVERSATIONAL_PATTERNS.some(p => p.test(text))) {
      return IntentType.CONVERSATIONAL;
    }

    // If message contains question words but didn't match above, likely SEARCH
    if (/\?|jak|co|kdo|kde|kdy|proč|how|what|who|where|when|why/i.test(text)) {
      return IntentType.SEARCH;
    }

    // Default to AMBIGUOUS - need clarification
    return IntentType.AMBIGUOUS;
  }

  /**
   * Determine required tools for an intent
   * @param {IntentType} intent
   * @param {string} input
   * @returns {string[]}
   */
  getRequiredTools(intent, input) {
    switch (intent) {
      case IntentType.SEARCH:
        return [ToolType.WEB_SEARCH];

      case IntentType.REPORT:
        // Reports need search + possibly scrape
        return [ToolType.WEB_SEARCH, ToolType.WEB_SCRAPE];

      case IntentType.FACTUAL:
        return [ToolType.WEB_SEARCH];

      case IntentType.CODE:
        // Code might need file operations
        return [ToolType.FILE_READ, ToolType.FILE_WRITE];

      default:
        return [];
    }
  }

  /**
   * Make a decision based on user input
   * @param {string} input - User message
   * @param {Object} context - Additional context
   * @returns {CREDecision}
   */
  decide(input, context = {}) {
    const intent = this.classifyIntent(input);
    const tools = this.getRequiredTools(intent, input);

    logger.debug('CREDecision', `Intent classified: ${intent}`, {
      input: input.substring(0, 50),
      tools,
    });

    // INVARIANT 2: SEARCH/FACT/REPORT = TOOL_CALL first
    if ([IntentType.SEARCH, IntentType.FACTUAL, IntentType.REPORT].includes(intent)) {
      return new CREDecision({
        type: DecisionType.TOOL_CALL,
        intent,
        tools,
        reason: `Intent ${intent} requires tool execution before response`,
        confidence: 0.9,
        metadata: { inputPreview: input.substring(0, 100) },
      });
    }

    // CODE intent - always needs context or clarification
    if (intent === IntentType.CODE) {
      if (context.hasActiveProject) {
        return new CREDecision({
          type: DecisionType.TOOL_CALL,
          intent,
          tools,
          reason: 'Code operation in active project context',
          confidence: 0.85,
        });
      }
      // No project context - need clarification about what/where
      return new CREDecision({
        type: DecisionType.ASK_USER,
        intent,
        slots: ['project_context', 'file_path'],
        reason: 'Code intent requires project context - asking user to specify',
        confidence: 0.7,
      });
    }

    // AMBIGUOUS - need clarification
    if (intent === IntentType.AMBIGUOUS) {
      return new CREDecision({
        type: DecisionType.ASK_USER,
        intent,
        slots: ['intent_clarification'],
        reason: 'Cannot determine intent from input',
        confidence: 0.5,
      });
    }

    // CONVERSATIONAL - only case where direct ANSWER is allowed
    if (intent === IntentType.CONVERSATIONAL) {
      return new CREDecision({
        type: DecisionType.ANSWER,
        intent,
        reason: 'Pure conversational input - direct response allowed',
        confidence: 0.9,
      });
    }

    // Default: ask for clarification
    return new CREDecision({
      type: DecisionType.ASK_USER,
      intent: IntentType.AMBIGUOUS,
      slots: ['intent_clarification'],
      reason: 'Fallback - could not determine appropriate action',
      confidence: 0.3,
    });
  }

  /**
   * Validate a response against forbidden phrases
   * @param {string} response - LLM response to validate
   * @returns {{ valid: boolean, violations: string[] }}
   */
  validateResponse(response) {
    const violations = [];
    const lowerResponse = response.toLowerCase();

    for (const phrase of FORBIDDEN_PHRASES) {
      if (lowerResponse.includes(phrase.toLowerCase())) {
        violations.push(phrase);
      }
    }

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  /**
   * Check if decision allows direct answer
   * @param {CREDecision} decision
   * @returns {boolean}
   */
  canAnswerDirectly(decision) {
    // INVARIANT 1 & 2: Only CONVERSATIONAL intent can answer directly
    return decision.type === DecisionType.ANSWER &&
           decision.intent === IntentType.CONVERSATIONAL;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Instance
// ─────────────────────────────────────────────────────────────────────────────

export const creDecisionEngine = new CREDecisionEngine();

// ─────────────────────────────────────────────────────────────────────────────
// Assertion Helpers (fail-fast validation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assert that a decision is valid according to CRE invariants.
 * Use this at handler entry points to catch violations early.
 *
 * @param {CREDecision} decision - The decision to validate
 * @throws {Error} If decision violates invariants
 */
export function assertDecision(decision) {
  if (!decision) {
    throw new Error('INVALID_DECISION: Decision is null or undefined');
  }

  if (!decision.type || !DecisionType[decision.type]) {
    throw new Error(`INVALID_DECISION: Unknown decision type "${decision.type}"`);
  }

  if (!decision.intent || !IntentType[decision.intent]) {
    throw new Error(`INVALID_DECISION: Unknown intent type "${decision.intent}"`);
  }

  // CRITICAL INVARIANT: ANSWER only for CONVERSATIONAL
  if (decision.type === DecisionType.ANSWER && decision.intent !== IntentType.CONVERSATIONAL) {
    throw new Error(
      `INVALID_DECISION_FLOW: ANSWER decision for non-CONVERSATIONAL intent "${decision.intent}". ` +
      `This is a bug in the decision logic.`
    );
  }

  // TOOL_CALL must have tools
  if (decision.type === DecisionType.TOOL_CALL && (!decision.tools || decision.tools.length === 0)) {
    throw new Error(
      `INVALID_DECISION: TOOL_CALL decision without tools for intent "${decision.intent}"`
    );
  }

  // ASK_USER should have slots
  if (decision.type === DecisionType.ASK_USER && (!decision.slots || decision.slots.length === 0)) {
    logger.warn('CREDecision', 'ASK_USER decision without slots - may confuse user', {
      intent: decision.intent,
      reason: decision.reason,
    });
  }

  return true;
}

/**
 * Assert that intent should never result in ANSWER.
 * Use this for explicit guardrails in handlers.
 *
 * @param {string} intent - The intent to check
 * @throws {Error} If intent should never allow direct answer
 */
export function assertNoDirectAnswer(intent) {
  const NEVER_ANSWER_INTENTS = [
    IntentType.SEARCH,
    IntentType.FACTUAL,
    IntentType.REPORT,
  ];

  if (NEVER_ANSWER_INTENTS.includes(intent)) {
    throw new Error(
      `DIRECT_ANSWER_FORBIDDEN: Intent "${intent}" must always use TOOL_CALL first. ` +
      `Direct text response is not allowed.`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  DecisionType,
  IntentType,
  ToolType,
  FORBIDDEN_PHRASES,
  CREDecision,
  CREDecisionEngine,
  creDecisionEngine,
  assertDecision,
  assertNoDirectAnswer,
};
