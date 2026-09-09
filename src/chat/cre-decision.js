// CRE v64.0 — Decision Engine + Gatekeeper (Single Authority Enforcement)
// ══════════════════════════════════════════════════════════════════════════════
//
// Tool-first decision logic for CRE.
//
// INVARIANTS:
// 1. No text response without CRE Decision
// 2. SEARCH/FACT/REPORT = TOOL_CALL first (never ANSWER without tool)
// 3. CHAT mode ≠ text mode (CHAT is a goal type, not "allow LLM")
// 4. LOCAL = terminal (direct computation, no tools)
// 5. CREATIVE = terminal (direct ideation, NEVER web.search)
// 6. CREATIVE follow-ups stay in CREATIVE mode (v44.9)
// 7. CREATIVE responses validated for quality (v44.10)
// 8. REPORT = SEARCH first, then SCRAPE URLs (v45.0) — NEVER scrape without URL!
// 9. No decision created outside decide() or overrideDecision() (v64.0 Gatekeeper)
//
// CHANGELOG:
// v64.0 - CRE GATEKEEPER: overrideDecision(), logIntercept(), bindAuditDb(),
//         cre_override_log table, all bypass points fixed (single authority)
// v56.2 - SELF_REFERENCE/STATEMENT/KNOWLEDGE pattern fixes, Czech diacritics
// v45.0 - REPORT pipeline fix (SEARCH→SCRAPE orchestration, URL guard, fallback)
// v44.10 - Response quality gate, expert style contract
// v44.9 - CREATIVE follow-up lock (FIX A), vague input first-turn blocking (FIX B)
// v44.8 - CREATIVE intent for ideation, first-turn ASK_USER blocking
// v44.7 - LOCAL as terminal decision, invariant guards
// v44.6 - Strong intents, sticky SEARCH continuation
// v44.4 - LOCAL intent for deterministic queries
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { isGratitudeOrFarewell, isCodeRequest } from './cre-routing-patches.js';
import { classifyIntent as llmClassify } from '../llm/cre-bridge.js';
import { extractJSON } from '../llm/client.js';
import { config } from '../config.js';
import { featureManager } from '../core/feature-manager.js';
import { throwIfAborted } from '../core/abort-error.js';

// v73: Lazy import to avoid circular dependency (followup.js → intent.js → cre-decision.js)
let _detectFollowUpType = null;
async function _getDetectFollowUpType() {
  if (!_detectFollowUpType) {
    const mod = await import('./handlers/utils/followup.js');
    _detectFollowUpType = mod.detectFollowUpType;
  }
  return _detectFollowUpType;
}

// v90: Lazy import — CODE→BUILD escalation uses isProjectScopeBuild from build-handoff
let _isProjectScopeBuild = null;
async function _getIsProjectScopeBuild() {
  if (!_isProjectScopeBuild) {
    const mod = await import('./handlers/build-handoff.js');
    _isProjectScopeBuild = mod.isProjectScopeBuild;
  }
  return _isProjectScopeBuild;
}

// ─────────────────────────────────────────────────────────────────────────────
// Decision Types
// ─────────────────────────────────────────────────────────────────────────────

export const DecisionType = {
  TOOL_CALL: 'TOOL_CALL',     // Must call a tool first
  ASK_USER: 'ASK_USER',       // Need more information from user
  ANSWER: 'ANSWER',           // Can answer directly (rare - only pure chat)
  REFUSE: 'REFUSE',           // Cannot/should not process this
  // v44.7 - LOCAL is a terminal decision (direct computation, no tools)
  LOCAL: 'LOCAL',             // Deterministic local computation (date, math, calendar)
  // PLAN: route to Planner pipeline (D1→CODE→R2→R1)
  PLAN: 'PLAN',              // User wants to build something → handoff to Planner
  // v85: SKILL — route to skill handler for resolution + execution
  SKILL: 'SKILL',            // User wants a known skill/macro-recipe
};

// ─────────────────────────────────────────────────────────────────────────────
// Intent Types (what the user wants)
// ─────────────────────────────────────────────────────────────────────────────

export const IntentType = {
  SEARCH: 'SEARCH',           // User wants to find information
  REPORT: 'REPORT',           // User wants a report/analysis requiring data
  FACTUAL: 'FACTUAL',         // User asks about facts (prices, events, URLs)
  LOCAL: 'LOCAL',             // v44.4 - Locally answerable (date, math, calendar)
  CODE: 'CODE',               // User wants code generation/help
  CONVERSATIONAL: 'CONVERSATIONAL', // Pure chat (greetings, opinions, etc.)
  COMMAND: 'COMMAND',         // System command (/help, /clear, etc.)
  AMBIGUOUS: 'AMBIGUOUS',     // Need clarification
  // v44.8 - CREATIVE: ideation, design, brainstorming (NEVER uses web search)
  CREATIVE: 'CREATIVE',       // User wants ideas, designs, suggestions, inspiration
  // v45.0 - ITEM_LOOKUP: specific product/listing queries with count constraints
  ITEM_LOOKUP: 'ITEM_LOOKUP', // User wants specific items (inzeráty, produkty, nabídky)
  // BUILD: user wants to build/create/deploy something (→ Planner handoff)
  BUILD: 'BUILD',             // User wants to construct a project, infra, app, automation
  // v58.0: DESIGN — structured synthesis from LLM knowledge (architecture, roadmap, plan)
  // NEVER uses web search. ANSWER only. Opinionated, structured output.
  DESIGN: 'DESIGN',           // User wants tech plan, roadmap, architecture, sprint breakdown
  // v63.0: FILE_READ — user wants to read/view/open a file
  // TERMINAL: reads from filesystem, no LLM, no web search.
  FILE_READ: 'FILE_READ',     // "otevři soubor", "přečti soubor X", "ukaž mi obsah"
  // v63.0: FILE_EXPLAIN — user wants file content + LLM explanation
  // Reads file, then LLM summarizes/explains the content.
  FILE_EXPLAIN: 'FILE_EXPLAIN', // "vysvětli soubor X", "co dělá tento soubor?"
  // v65.0: SHELL — user wants to execute a shell/terminal command
  // TERMINAL: routes to terminal execution, NOT LLM. No web search.
  SHELL: 'SHELL',             // "spusť npm test", "pusť ls -la", "runni git status"
  // v70: FILE_WRITE — user wants to save/write content to a file
  // TERMINAL: writes to filesystem, no LLM.
  FILE_WRITE: 'FILE_WRITE',   // "zapiš to do souboru", "ulož to do file.md", "save it to a file"
  // v85: SKILL — user wants to trigger a known deterministic skill/macro-recipe
  // Routes to SkillHandler which resolves, confirms, and executes the skill.
  SKILL: 'SKILL',             // "spusť skill X", "vytvoř expertizu pro Docker"
  // v94: CODE_ANALYSIS — user wants code analysis, debugging, code review
  // Routes to CodeAnalysisHandler: search → context → LLM → structured answer
  CODE_ANALYSIS: 'CODE_ANALYSIS', // "analyzuj kód", "najdi bug", "proč to padá", "explain this code"
};

// ─────────────────────────────────────────────────────────────────────────────
// v45.0 Task Type (controls execution constraints)
// ─────────────────────────────────────────────────────────────────────────────
// TaskType is used to enforce hard constraints on the response:
// - SYNTHESIS: must synthesize, cannot be data dump
// - ITEM_LIST: must return specific count of items with required fields
// - EXPLANATION: must explain, not just state
// ─────────────────────────────────────────────────────────────────────────────

export const TaskType = {
  SYNTHESIS: 'SYNTHESIS',     // Must synthesize content (REPORT, FACTUAL)
  ITEM_LIST: 'ITEM_LIST',     // Must return N specific items (ITEM_LOOKUP)
  EXPLANATION: 'EXPLANATION', // Must explain reasoning (CREATIVE, CODE)
  DIRECT: 'DIRECT',           // Can answer directly (CONVERSATIONAL, LOCAL)
  // v58.0: DESIGN — structured plan/architecture with opinionated decisions
  DESIGN_SYNTHESIS: 'DESIGN_SYNTHESIS',
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
  // v44.4 - Local tools (no external API needed)
  LOCAL_DATE: 'local.date',           // Current date/time
  LOCAL_CALENDAR: 'local.calendar',   // Calendar calculations
  LOCAL_MATH: 'local.math',           // Mathematical calculations
  // v65.0 - Shell/terminal execution
  SHELL_EXEC: 'shell.exec',
  // v121: Specialist tools removed from static enum — registered dynamically
  //       by specialist packages via registerToolType(). See specialist-loader.js.
};

// ─────────────────────────────────────────────────────────────────────────────
// v121: Dynamic specialist tool registry
// Specialist packages register their tool types during register(ctx).
// ─────────────────────────────────────────────────────────────────────────────
const _specialistTools = new Map();

/** Register a specialist tool type. Idempotent. */
export function registerToolType(toolId) {
  _specialistTools.set(toolId, true);
}

/** Unregister a specialist tool type. */
export function unregisterToolType(toolId) {
  _specialistTools.delete(toolId);
}

/** Check if a tool type is known (static + dynamic). */
export function isKnownTool(toolId) {
  return Object.values(ToolType).includes(toolId) || _specialistTools.has(toolId);
}

/** Get all registered specialist tool IDs. */
export function getSpecialistToolIds() {
  return [..._specialistTools.keys()];
}

// v121: Export for testing
export const _testCREInternals = {
  _specialistTools,
  classifierNumCtxOverride,
  get DESIGN_BUILD_HYBRID() { return [...DESIGN_BUILD_HYBRID]; },
  get DESIGN_BUILD_ESCALATION() { return [...DESIGN_BUILD_ESCALATION]; },
  get DESIGN_ADVISORY() { return [...DESIGN_ADVISORY]; },
};

// ─────────────────────────────────────────────────────────────────────────────
// v45.0 KOLO 3: Response Intent (HOW to present the answer)
// ─────────────────────────────────────────────────────────────────────────────
//
// ResponseIntent is SEPARATE from Intent (WHAT user wants).
// It controls synthesis style, NOT tool selection.
//
// CRITICAL: ResponseIntent affects buildSynthesisSystemPrompt(), not decide()
// ─────────────────────────────────────────────────────────────────────────────

export const ResponseIntent = {
  DIRECT: 'DIRECT',           // Single sentence/paragraph answer
  SUMMARY: 'SUMMARY',         // Condensed version of data
  BULLETS: 'BULLETS',         // Bullet point list
  COMPARISON: 'COMPARISON',   // Side-by-side comparison (table/list)
  STEP_BY_STEP: 'STEP_BY_STEP', // Numbered steps/process
  EXPLORATORY: 'EXPLORATORY', // Open-ended, multiple directions offered
  OPINIONATED: 'OPINIONATED', // Personal recommendation with reasoning
  MINIMAL: 'MINIMAL',         // Absolute minimum (number, yes/no, date)
};

// Patterns to detect ResponseIntent from user input
const RESPONSE_INTENT_PATTERNS = {
  [ResponseIntent.SUMMARY]: [
    /stručně/i, /stručněji/i, /kratší/i, /zkrať/i, /shrň/i, /shrnout/i,
    /summary/i, /summarize/i, /brief/i, /shorter/i, /condense/i,
  ],
  [ResponseIntent.BULLETS]: [
    /v bodech/i, /odrážk/i, /bullet/i, /seznam/i, /ve formě/i, /as list/i,
    /points/i, /list.*form/i,
  ],
  [ResponseIntent.COMPARISON]: [
    /porovnej/i, /srovnej/i, /compare/i, /rozdíl/i, /difference/i,
    /vs\.?/i, /versus/i, /oproti/i, /against/i,
  ],
  [ResponseIntent.STEP_BY_STEP]: [
    /krok.*za.*krok/i, /postup/i, /jak.*udělat/i, /návod/i,
    /step.*by.*step/i, /how.*to/i, /tutorial/i, /guide/i, /instructions/i,
  ],
  [ResponseIntent.MINIMAL]: [
    /jen číslo/i, /jen datum/i, /jen ano.*ne/i, /pouze/i, /jenom/i,
    /just.*number/i, /just.*date/i, /only/i, /nothing.*else/i,
    /\bhaiku\b/i,
  ],
  [ResponseIntent.OPINIONATED]: [
    /co.*bys.*doporučil/i, /co.*myslíš/i, /tvůj.*názor/i, /jaký.*je.*nejlepší/i,
    /what.*would.*you.*recommend/i, /your.*opinion/i, /which.*is.*best/i,
  ],
  [ResponseIntent.EXPLORATORY]: [
    /jaké.*možnosti/i, /co.*všechno/i, /různé.*způsoby/i,
    /what.*options/i, /different.*ways/i, /explore/i, /possibilities/i,
  ],
};

/**
 * v45.0 KOLO 3: Detect ResponseIntent from user input
 * @param {string} input - User input
 * @param {Object} context - Conversation context
 * @returns {string} ResponseIntent value
 */
export function detectResponseIntent(input, context = {}) {
  const inputLower = input.toLowerCase().trim();

  // Check each pattern group
  for (const [intent, patterns] of Object.entries(RESPONSE_INTENT_PATTERNS)) {
    if (patterns.some(p => p.test(inputLower))) {
      return intent;
    }
  }

  // Default based on context
  if (context.lastResponseIntent) {
    // Maintain previous ResponseIntent if no explicit change
    return context.lastResponseIntent;
  }

  return ResponseIntent.DIRECT;
}

// ─────────────────────────────────────────────────────────────────────────────
// v45.0 KOLO 3: Question Budget / Conversational Offers
// ─────────────────────────────────────────────────────────────────────────────
//
// RULES:
// 1. Don't ask if task is clear → execute immediately
// 2. Max 1 question per turn (budget=1)
// 3. Offer expansion when response is short AND user might want more
// 4. Never offer expansion on gratitude/minimal responses
// ─────────────────────────────────────────────────────────────────────────────

// Patterns indicating task is clear (no question needed)
const CLEAR_TASK_PATTERNS = [
  // Explicit commands
  /^(najdi|vyhledej|dej mi|popiš|vysvětli|napiš|vytvoř|shrň)/i,
  /^(find|search|get|describe|explain|write|create|summarize)/i,

  // Specific entities with clear intent
  /info(rmace)?\s+(o|about)\s+\w+/i,
  /report\s+(o|about|on)\s+\w+/i,
  /cen[auě]\s+\w+/i,  // "cena bitcoin", "cenu akcie"
  /price\s+(of\s+)?\w+/i,

  // Direct questions with clear scope
  /^(co|kdo|kde|kdy|jak|proč|kolik)\s+.{5,}/i,
  /^(what|who|where|when|how|why)\s+.{5,}/i,
];

// Patterns indicating task needs clarification
const UNCLEAR_TASK_PATTERNS = [
  // Too vague
  /^(něco|nějaké|cokoli|hmm+|eh+|no|nevím)$/i,
  /^(something|anything|stuff|hmm+|eh+|well|dunno)$/i,

  // Ambiguous scope
  /pomoz\s+mi\s*$/i,  // "pomoz mi" without specifics
  /help\s+me\s*$/i,

  // Missing key information
  /^(report|analýz[au]|srovn)/i,  // "report" without topic
];

/**
 * v45.0 KOLO 3: Check if task is clear enough to execute without questions
 * @param {string} input - User input
 * @param {Object} context - Conversation context
 * @returns {{ clear: boolean, reason: string }}
 */
export function isTaskClear(input, context = {}) {
  const inputLower = input.toLowerCase().trim();

  // Very short input is usually unclear
  if (inputLower.length < 5) {
    return { clear: false, reason: 'too_short' };
  }

  // Check for explicitly unclear patterns
  if (UNCLEAR_TASK_PATTERNS.some(p => p.test(inputLower))) {
    return { clear: false, reason: 'vague_input' };
  }

  // Check for clear task patterns
  if (CLEAR_TASK_PATTERNS.some(p => p.test(inputLower))) {
    return { clear: true, reason: 'explicit_command' };
  }

  // Follow-ups in existing conversation are usually clear
  if (context.lastIntent && context.conversationLength > 0) {
    return { clear: true, reason: 'conversation_context' };
  }

  // Default: medium-length inputs with content are usually clear
  if (inputLower.length >= 10 && inputLower.split(/\s+/).length >= 3) {
    return { clear: true, reason: 'sufficient_detail' };
  }

  return { clear: false, reason: 'insufficient_detail' };
}

/**
 * v45.0 KOLO 3: Determine if expansion offer should be made
 * @param {string} response - Generated response
 * @param {Object} context - Conversation context
 * @returns {{ offer: boolean, type: string | null }}
 */
export function shouldOfferExpansion(response, context = {}) {
  // Never offer on gratitude responses
  if (/^(rádo se stalo|není zač|rádi pomůžeme)/i.test(response)) {
    return { offer: false, type: null };
  }

  // Never offer if user requested minimal
  if (context.responseIntent === ResponseIntent.MINIMAL) {
    return { offer: false, type: null };
  }

  // Don't offer too frequently (max every 3 turns)
  if (context.turnsSinceLastOffer < 3) {
    return { offer: false, type: null };
  }

  // Offer expansion for short factual responses
  const wordCount = response.split(/\s+/).length;
  if (wordCount < 30 && context.intent === 'FACTUAL') {
    return { offer: true, type: 'expand_detail' };
  }

  // Offer comparison for single-item responses
  if (wordCount < 50 && !response.includes('vs') && !response.includes('srovnání')) {
    return { offer: true, type: 'offer_comparison' };
  }

  return { offer: false, type: null };
}

/**
 * v45.0 KOLO 3: Generate expansion offer text
 * @param {string} offerType - Type of expansion offer
 * @returns {string}
 * @deprecated Use getImplicitOffer() from KOLO 4.4 instead
 */
export function getExpansionOfferText(offerType) {
  const offers = {
    expand_detail: '\n\n💡 _Chcete podrobnější informace?_',
    offer_comparison: '\n\n💡 _Chcete srovnat s alternativami?_',
    offer_sources: '\n\n💡 _Chcete odkazy na zdroje?_',
    offer_next_steps: '\n\n💡 _Chcete návrh dalších kroků?_',
  };
  return offers[offerType] || '';
}

// ─────────────────────────────────────────────────────────────────────────────
// v45.0 KOLO 4.4 — Curiosity Budget (Implicit Offers)
// ─────────────────────────────────────────────────────────────────────────────
//
// CONTRACT:
// - NO questions (no "?")
// - Use parentheses format: "(Mohu případně rozvést...)"
// - Max 1 offer per response
// - Never on MINIMAL or gratitude
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Implicit offer types - statements, not questions
 */
export const ImplicitOfferType = {
  EXPAND_STRATEGY: 'expand_strategy',
  EXPAND_RISKS: 'expand_risks',
  EXPAND_EXAMPLES: 'expand_examples',
  EXPAND_ALTERNATIVES: 'expand_alternatives',
  EXPAND_SOURCES: 'expand_sources',
  EXPAND_STEPS: 'expand_steps',
};

/**
 * Implicit offers - NO QUESTIONS, just parenthetical statements
 */
const IMPLICIT_OFFERS = {
  [ImplicitOfferType.EXPAND_STRATEGY]: '(Mohu případně rozvést strategii.)',
  [ImplicitOfferType.EXPAND_RISKS]: '(Mohu případně upřesnit rizika.)',
  [ImplicitOfferType.EXPAND_EXAMPLES]: '(Mohu případně doplnit příklady.)',
  [ImplicitOfferType.EXPAND_ALTERNATIVES]: '(Mohu případně zmínit alternativy.)',
  [ImplicitOfferType.EXPAND_SOURCES]: '(Mohu případně doplnit zdroje.)',
  [ImplicitOfferType.EXPAND_STEPS]: '(Mohu případně popsat konkrétní kroky.)',
};

/**
 * v45.0 KOLO 4.4: Check if implicit offer should be included
 * @param {Object} context - Response context
 * @returns {{ shouldOffer: boolean, reason?: string }}
 */
export function shouldIncludeImplicitOffer(context = {}) {
  const {
    responseIntent,
    prefersMinimal,
    isGratitude,
    turnsSinceLastOffer = 0,
    responseLength = 0,
  } = context;

  // Never on MINIMAL
  if (responseIntent === ResponseIntent.MINIMAL || prefersMinimal) {
    return { shouldOffer: false, reason: 'MINIMAL_MODE' };
  }

  // Never on gratitude
  if (isGratitude) {
    return { shouldOffer: false, reason: 'GRATITUDE' };
  }

  // Not too frequently (every 3+ turns)
  if (turnsSinceLastOffer < 3) {
    return { shouldOffer: false, reason: 'TOO_FREQUENT' };
  }

  // Only on shorter responses (< 500 chars)
  if (responseLength > 500) {
    return { shouldOffer: false, reason: 'RESPONSE_TOO_LONG' };
  }

  return { shouldOffer: true };
}

/**
 * v45.0 KOLO 4.4: Get appropriate implicit offer based on context
 * @param {Object} context - Response context
 * @returns {string} Implicit offer text (or empty string)
 */
export function getImplicitOffer(context = {}) {
  const check = shouldIncludeImplicitOffer(context);
  if (!check.shouldOffer) {
    return '';
  }

  const { intent, responseContent = '' } = context;
  const contentLower = responseContent.toLowerCase();

  // Choose offer type based on content
  let offerType = ImplicitOfferType.EXPAND_EXAMPLES; // Default

  if (contentLower.includes('strateg') || contentLower.includes('plán')) {
    offerType = ImplicitOfferType.EXPAND_STRATEGY;
  } else if (contentLower.includes('rizik') || contentLower.includes('risk')) {
    offerType = ImplicitOfferType.EXPAND_RISKS;
  } else if (contentLower.includes('alternativ') || contentLower.includes('jiná')) {
    offerType = ImplicitOfferType.EXPAND_ALTERNATIVES;
  } else if (contentLower.includes('zdroj') || contentLower.includes('odkaz')) {
    offerType = ImplicitOfferType.EXPAND_SOURCES;
  } else if (contentLower.includes('krok') || contentLower.includes('postup')) {
    offerType = ImplicitOfferType.EXPAND_STEPS;
  }

  return '\n\n' + IMPLICIT_OFFERS[offerType];
}

/**
 * v45.0 KOLO 4.4: Validate that offer has no questions
 * @param {string} offer - Offer text
 * @returns {{ valid: boolean, violation?: string }}
 */
export function validateImplicitOffer(offer) {
  if (!offer || offer.trim() === '') {
    return { valid: true };
  }

  // Must not contain question marks
  if (offer.includes('?')) {
    return { valid: false, violation: 'CONTAINS_QUESTION' };
  }

  // Must be in parentheses format
  if (!offer.includes('(') || !offer.includes(')')) {
    return { valid: false, violation: 'NOT_PARENTHETICAL' };
  }

  return { valid: true };
}

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
  // v58.1: Global hedging/deflection (was only DESIGN-scoped)
  'informace jsou omezené',
  'informace byly omezené',
  'doporučuji vyhledat',
  'zkuste se podívat na web',
  'zkuste vyhledat na internetu',
  'no search results found',
  'nemám k dispozici aktuální',
  'nemohu poskytnout aktuální',
  'moje znalosti jsou omezené',
  'moje znalosti sahají pouze',
  'as a language model',
  'as an AI assistant',
  'I\'m just an AI',
  'my knowledge is limited',
  'my training data',
  'my knowledge cutoff',
  // v58.2 Fix #2: Additional hedging/deflection (from live conversation tests)
  'doporučuji konzultovat',           // "doporučuji konzultovat s odborníkem"
  'neváhejte se zeptat',              // "neváhejte se zeptat na další"
  'záleží na kontextu',               // "záleží na kontextu"
  'záleží na požadavcích',            // "záleží na vašich požadavcích"
  'existuje více možností',           // "existuje více možností"
  'existuje mnoho možností',          // "existuje mnoho možností"
  'pokud potřebujete další informace',// "pokud potřebujete další informace"
  'pokud máte konkrétní požadavky',   // chatbot hedging
  'je třeba zvážit',                  // "je třeba zvážit"
  'limited information',              // "based on limited information"
  'it depends on the context',        // EN hedging
  'I recommend consulting',           // EN hedging
  'feel free to ask',                 // EN hedging
  // v58.2: Polish/Spanish language leaks (Qwen contamination)
  'informacje',                       // PL: "informacje są ograniczone"
  'ograniczone',                      // PL: limited
  'zalecam',                          // PL: I recommend
  'lo siento',                        // ES: I'm sorry
  'no puedo',                         // ES: I cannot
];

// ─────────────────────────────────────────────────────────────────────────────
// Intent Classification Patterns
// ─────────────────────────────────────────────────────────────────────────────

const SEARCH_PATTERNS = [
  // ── Explicit search commands (always SEARCH) ──────────────────────────
  /najdi/i, /naj[íi]t/i, /hledej/i, /hled[áa]m/i, /vyhledej/i, /search/i, /find/i,

  // ── "co je" / "what is" ONLY with fresh-data modifier ─────────────────
  /co je .{0,15}\b(aktuáln|současn|dnes|teď|nyn|cena|kurz|verze|stav|nového?|nových)\b/i,
  /what is .{0,15}(current|latest|today|price|version|status|new)/i,

  // ── Standalone fresh-data keywords ────────────────────────────────────
  /aktuální/i, /current/i, /latest/i, /nejnovější/i,
  /kolik stojí/i,       // "kolik stojí X" = price query (inherently fresh)

  // ── v58.3: REMOVED overly broad patterns (now handled by Tier 1 FRESH_DATA_SIGNALS) ──
  // REMOVED: /kdo je/i, /who is/i → "kdo je Einstein" = knowledge
  // REMOVED: /cena/i, /price/i → "cena míru", "price of freedom" = knowledge
  // REMOVED: /how much/i → "how much does the earth weigh" = knowledge
  // REMOVED: /kde (je|jsou|najdu)/i → "kde je Mount Everest" = knowledge
  // REMOVED: /where (is|are|can)/i → "where is the Eiffel Tower" = knowledge
  // REMOVED: /kdy (je|jsou|bude)/i → "kdy byl vynalezen telefon" = knowledge
  // REMOVED: /when (is|are|will)/i → "when was Rome founded" = knowledge
  // All above now fall through to Tier 1 which routes to SEARCH only if
  // FRESH_DATA_SIGNALS are present (aktuální, dnes, teď, current, today, etc.)

  // ── Kept: explicit location search ────────────────────────────────────
  /kde\s+najdu/i,       // "kde najdu lékárnu" = needs web search (but not "kde je")
];

// v58.1: KNOWLEDGE patterns — "co je X" / "what is X" for general knowledge
// These go to CONVERSATIONAL/ANSWER, NOT SEARCH.
// Must be checked BEFORE SEARCH_PATTERNS in classification order.
export const KNOWLEDGE_EXPLANATION_PATTERNS = [
  // Historical biography forms are static knowledge unless an explicit fresh
  // signal later wins in the stricter SEARCH precedence.
  /^kdo\s+byl\s+/i,
  /^who\s+was\s+/i,
  // ─── CZ: "co je" + general concept (no fresh-data modifier) ─────────────
  /^co\s+je\s+/i,         // "co je neuronová síť", "co je Python"
  /^co\s+jsou\s+/i,       // "co jsou hashovací tabulky"
  /^co\s+znamená\s+/i,    // "co znamená OOP"
  /^co\s+to\s+je/i,       // "co to je za strukturu"
  // CZ: "jaký je rozdíl" — comparison questions (LLM knowledge)
  /jak[ýy]\s+je\s+rozd[ií]l/i,
  /jak[ýy]\s+je\s+rozdil/i,  // no diacritics
  // CZ: "vysvětli" — explanation requests
  /vysv[eě]tli/i,
  /vysvetli/i,   // no diacritics
  /popiš/i, /popis/i,
  // CZ: "jak funguje" — mechanism questions (LLM knowledge)
  /jak\s+(to\s+)?funguje/i,
  /jak\s+(to\s+)?funguj/i,
  /jak\s+(to\s+)?fungují/i,
  // ─── v58.2: EXPANDED CZ knowledge question forms ──────────────────────
  /jak\s+se\s+(dělá|dela|tvoří|tvori|vyrábí|vyrabi|říká|rika|počítá|pocita|měří|meri)/i,
  /jak\s+vzniká/i, /jak\s+vznikaji/i,
  /jak\s+probíhá/i,
  /proč\s+(je|jsou|se)\s+/i,       // "proč je nebe modré", "proč se říká"
  /proc\s+(je|jsou|se)\s+/i,       // no diacritics
  /kde\s+(je|jsou)\s+.{0,20}(v\s+těle|v\s+tele|v\s+organismu|anatomicky|v\s+přírodě|v\s+prirode)/i,
  /kdo\s+(vynalezl|vytvořil|vytvoril|objevil|navrhl|založil|zalozil|napsal|vymyslel|byl\s+první)/i,
  /kdo\s+je\s+.{0,20}(v\s+historii|postava|autor|spisovatel|filosof|vědec|vedec|malíř|malir|skladatel)/i,
  /co\s+způsobuje/i, /co\s+zpusobuje/i,
  /co\s+(dělá|dela)\s+/i,          // "co dělá insulin"
  /kdy\s+(vznikl|vznikla|byl[ao]?\s+(vynalezen|objeveno|založen))/i,
  /kolik\s+(má|ma)\s+.{0,20}(nohou|očí|oci|planet|dnů|dni|kostí|kosti|strun)/i,
  /kolik\s+(planet|kostí|kosti|nohou|oci|očí)/i,    // "kolik planet má sluneční soustava"
  // v58.3: Static facts — capitals, physical constants, counts
  /jak[ée]\s+(je|jsou)\s+hlavn[ií]\s+m[eě]sto/i,    // "jaké je hlavní město Itálie"
  /hlavn[ií]\s+m[eě]sto/i,                           // "hlavní město Japonska"
  /kolik\s+(je|jsou)\s+.{0,15}(rychlost|hmotnost|vzdálenost|vzd[aá]lenost|teplota|obyvatel)/i,
  /kolik\s+(je|jsou)\s+.{0,15}(planet|kontinent|oceán|ocean|světadíl|svetadil)/i,
  /co\s+se\s+(stalo|d[eě]lo)\s+/i,                   // "co se stalo v roce 1989"
  /kdo\s+byl\s+(prvn[ií]|posledn[ií]|nejv[eě]t[sš])/i, // "kdo byl první prezident"
  /jak[ée]\s+(jsou|byly)\s+nejv[eě]t[sš]/i,          // "jaké jsou největší vynálezy"
  /jak[ée]\s+(jsou|byly)\s+nejd[uů]le[zž]it[eě]j[sš]/i, // "jaké jsou nejdůležitější"
  /jak[ée]\s+(jsou|byly)\s+nejlep[sš][ií]/i,         // "jaké jsou nejlepší cviky"
  /jak[ée]\s+(jsou|byly)\s+nejhezc[ií]/i,            // "jaké jsou nejhezčí hrady"
  /co\s+pot[rř]ebuj/i,                               // "co potřebuji k přípravě"
  /jak\s+se\s+vyvarovat/i,                           // "jak se vyvarovat zranění"
  // ─── EN: "what is" + general concept ─────────────────────────────────────
  /^what\s+is\s+/i,        // "what is a neural network"
  /^what\s+are\s+/i,       // "what are hash tables"
  /^what\s+does\s+.*mean/i, // "what does OOP mean"
  /explain/i,
  /describe/i,
  /difference\s+between/i,
  /how\s+does.*work/i,
  /how\s+do.*work/i,
  // ─── v58.2: EXPANDED EN knowledge question forms ──────────────────────
  /how\s+is\s+.{0,30}(made|created|formed|calculated|measured|produced)/i,
  /why\s+(is|are|does|do)\s+/i,    // "why is the sky blue"
  /who\s+(invented|created|discovered|designed|founded|wrote|was\s+the\s+first)/i,
  /what\s+(causes|makes)\s+/i,     // "what causes rain"
  /when\s+was\s+.{0,30}(invented|discovered|founded|built|created|written)/i,
  /how\s+many\s+.{0,20}(legs|eyes|planets|days|bones|strings|continents|oceans)/i,
  // ─── v61.3: Role/impact/consequence/broader knowledge questions ──────
  // CZ: "jakou roli hraje X", "jaký dopad má Y"
  /jakou\s+roli/i,
  /jak[ýy]\s+dopad/i,
  /jak[ýy]\s+vliv/i,
  /jak[ée]\s+d[uů]sledky/i,                    // "jaké důsledky"
  /jak[ée]\s+n[áa]sledky/i,                    // "jaké následky"
  /jak[ée]\s+v[ýy]hody/i,                      // "jaké výhody"
  /jak[ée]\s+nev[ýy]hody/i,                    // "jaké nevýhody"
  /jak[ée]\s+rizik/i,                           // "jaké rizika"
  /jak[ée]\s+p[rř][ií]nosy/i,                  // "jaké přínosy"
  // CZ: Broader "proč" — "proč většina lidí přestane" (beyond je/jsou/se)
  /pro[čc]\s+v[eě]t[sš]in/i,                  // "proč/proc většina"
  /pro[čc]\s+lid[ié]/i,                        // "proč/proc lidé/lidi"
  /pro[čc]\s+n[eě]kter/i,                      // "proč/proc někteří"
  /pro[čc]\s+mnoho/i,                          // "proč/proc mnoho"
  /pro[čc]\s+\w{3,}\s+\w{3,}\s+/i,            // "proč/proc <word> <word>" — broad knowledge Q
  // CZ: No-diacritics expanded (users often type without háčky)
  /jakou\s+roli/i,                              // already diacritics-safe
  /jaky\s+dopad/i,                              // no diacritics "jaký dopad"
  /jake\s+(vyhody|nevyhody|rizika|dusledky|nasledky|prinosy)/i,
  // CZ: "které/kteří" prediction/consequence forms
  /kter[éeáa]\s+\w+\s+(budou|jsou|m[aá]j[ií]|mohou|m[uů][zž]ou)/i,
  // EN expanded: role/impact/consequence
  /what\s+role/i,                               // "what role does X play"
  /what\s+impact/i,                             // "what impact does X have"
  /what\s+(?:influence|effect)\b/i,
  /what\s+are\s+the\s+(benefits|risks|consequences|advantages|disadvantages|effects)/i,
  /why\s+do\s+(most|many|some|few)\s+/i,        // "why do most people quit..."
  /why\s+does\s+(the|a|an)\s+/i,                // "why does the body..."
  // v65: analysis/summary imperative → knowledge explanation (without fresh-data context)
  // "analyzuj resource Lotus Notes" → explain from LLM knowledge
  // "shrň co víš o HTTP protokolu" → explain from LLM knowledge
  // "porovnej SQL a NoSQL" → explain from LLM knowledge
  /^analyzuj\s/i,                               // "analyzuj resource Lotus Notes"
  /analyzuj\s+mi\s/i,                           // "analyzuj mi tento koncept"
  /^shrň\s/i, /^shrn\s/i,                       // "shrň co víš o..."
  /^porovnej\s/i,                                // "porovnej X a Y"
  /^srovnej\s/i,                                 // "srovnej React a Angular"
  // v128: Pronoun-based short follow-ups (after attachment/file context)
  // These are context-dependent imperatives using pronouns that reference prior content.
  /^co\s+to\s+d[eě]l[áa]\s*[?!.]?$/i,           // "co to dela" (what does it do)
  /^k\s+[cč]emu\s+(to\s+)?slou[zž][ií]\s*[?!.]?$/i,  // "k cemu to slouzi"
  /^o\s+[cč]em\s+to\s+(je|bylo)\s*[?!.]?$/i,     // "o cem to je"
  /^ud[eě]lej\s+(mi\s+)?(p[rř]ehled|souhrn|v[ýy]tah|shrnut[ií])\s*[?!.]?$/i,  // "udelej prehled"
  /^jak[ée]\s+(jsou|byly?)\s+(ty|tyto|tyhle)\s+/i,  // "jake jsou ty soubory"
  /^chci\s+(n[eě]jak[ýy]\s+)?(v[ýy]tah|souhrn|p[rř]ehled|shrnut[ií])/i,  // "chci nejaky vytah..."
  // EN pronoun follow-ups
  /^what\s+do\s+(these|those|the)\s+(file|code|script|module|function)s?\s+do\s*[?]?$/i,
  /^give\s+me\s+(a\s+)?(summary|overview|rundown|breakdown)/i,
  /^summarize\s+(it|them|this|that|these|those)\s*[?!.]?$/i,
];

// Stable, self-contained knowledge forms that do not need model arbitration.
// Keep this deliberately narrower than KNOWLEDGE_EXPLANATION_PATTERNS: author
// lookups and referential follow-ups still need the model/Guard 6 authority
// chain (for example, "kdo napsal ..." under a creative expertise).
const DETERMINISTIC_STATIC_KNOWLEDGE_PATTERNS = [
  /^kdo\s+byl\s+/i,
  /^who\s+was\s+/i,
  /^co\s+(?:je|jsou|znamen[áa])\s+/i,
  /^what\s+(?:is|are)\s+/i,
  /^what\s+does\s+.+\s+mean\b/i,
  /^vysv[eě]tli\s+(?!to\b|mi\s+to\b)/i,
  /^explain\s+(?!it\b|this\b|that\b)/i,
  /jak\s+(?:to\s+)?funguj/i,
  /how\s+(?:does|do)\s+.+\s+work\b/i,
  /^[čc]o\s+je\s+/i,
  /^was\s+ist\s+/i,
  /^odpov[eě]z\s+.{0,40}:\s*co\s+je\s+/i,
  /^hlavn[ií]\s+m[eě]sto\s+/i,
  /^(?:the\s+)?capital\s+of\s+/i,
];

function isClosedHistoricalQuestion(text, now = new Date()) {
  const match = text.match(
    /^(?:what\s+happened\s+in|co\s+se\s+(?:stalo|d[eě]lo)\s+(?:v\s+)?(?:roce\s+)?)\s*(\d{4})\s*[?!.]?$/iu,
  );
  return match !== null && Number(match[1]) < now.getFullYear();
}

// Stable opinion, recommendation, and planning-discussion forms do not need a
// second model merely to decide whether they are ordinary conversation. The
// explicit search command exclusion preserves outbound authority for callers
// who actually request live data.
const DETERMINISTIC_DISCUSSION_PATTERNS = [
  /(?:podle\s+tebe|co\s+si\s+mysl|what\s+do\s+you\s+think|in\s+your\s+opinion)/iu,
  /^(?:mysl[ií][sš]|do\s+you\s+think)\b/iu,
  /^(?:jak|how|co|what|kdy|when)\b.{0,100}\b(?:by|would|m[aá]\s+smysl|make\s+sense|doporu[cč]|recommend|poznat|recognize|udr[zž]et|maintain|p[rř]ipravit|prepare)\b/iu,
  /^(?:je\s+lep[sš][ií]|is\s+it\s+better)\b.{0,100}\b(?:nebo|or)\b/iu,
  /^(?:jak[eé]\b.{0,100}\bchyb|what\s+mistakes?\b)/iu,
  /^(?:shrn(?:i|out)|summarize)\b/iu,
  /^jak[eé]\s+jsou\s+nejhez[cč][ií]\s+(?:[cč]esk[eé]\s+)?hrady\b/iu,
  // A personal calorie-burn estimate depends on pace/body data, but not on
  // fresh web data. Keep it on the conversational path so the answer can
  // state assumptions instead of requesting outbound effect authority.
  /^kolik\s+kalori[ií]\s+(?:sp[aá]l[ií]m|se\s+sp[aá]l[ií])\b/iu,
  /^how\s+many\s+calories\s+(?:do\s+(?:i|you)|does\s+one|are)\s+burn/iu,
];

const DETERMINISTIC_LEARNING_GOAL_PATTERNS = [
  /^(?:chci\s+se|r[aá]d\s+bych\s+se)\s+(?:nau[cč]it|zlep[sš]it|zdokonalit)/iu,
  /^(?:i\s+want\s+to|i(?:'d|\s+would)\s+like\s+to)\s+(?:learn|improve|get\s+better)/iu,
  /^(?:chci|r[aá]d\s+bych)\s+za[cč][ií]t\s+(?:cvi[cč]it|sportovat|tr[eé]novat)\b/iu,
  /^(?:i\s+want\s+to|i(?:'d|\s+would)\s+like\s+to)\s+(?:start|begin)\s+(?:exercising|working\s+out|training)\b/iu,
];

// Strong single-artifact code requests are safe to classify without a second
// model pass. The later CODE authority branch still re-checks active-project
// scope and escalates multi-file work to BUILD before any effect can start.
const DETERMINISTIC_INLINE_CODE_PATTERNS = [
  /^(?:napi[sš]|write|show|give)(?:\s|$).{0,60}(?:funkci|function|middleware|regex|regul[aá]rn[ií]\s+v[ýiyií]raz|jednoduch[ýiyi]\s+(?:HTTP\s+)?server|simple\s+(?:HTTP\s+)?server|skript|script)\b/iu,
  /^(?:a\s+co\s+)?rekurzivn[ií]\s+verze\b/iu,
  /^recursive\s+version\b/iu,
];

const DETERMINISTIC_LIVE_SEARCH_PATTERNS = [
  /^kolik\s+tam\s+[zž]ije\s+lid[ií](?:\s|[?!.,]|$)/iu,
  /^how\s+many\s+people\s+live\s+there\b/iu,
  /^jak[eé]\s+jsou\s+trendy\s+v\s+IT\s+podnik[aá]n[ií]\s*[?!.]?$/iu,
  /^what\s+are\s+the\s+current\s+trends\s+in\s+IT\s+business\s*[?!.]?$/iu,
  /^ahoj[!,]?\s+co\s+je\s+nov[eé]ho\s+v\s+technologi[ií]ch\s*[?!.]?$/iu,
  /^hello[!,]?\s+what\s+is\s+new\s+in\s+technology\s*[?!.]?$/iu,
  /^jak[yý]\s+je\s+aktu[aá]ln[ií]\s+ekosyst[eé]m\s+knihoven\s+pro\s+ka[zž]d[yý]\s+framework\s*[?!.]?$/iu,
  /^jak[eé]\s+jsou\s+trendy\s+pro\s+rok\s+\d{4}\?\s+kter[yý]\s+framework\s+roste\s+nejrychleji\s*[?!.]?$/iu,
];

const EXPLICIT_SEARCH_COMMAND_PATTERN = /(?:vyhledej|najdi\s+(?:na\s+)?internetu|hledej\s+na\s+webu|search\s+(?:the\s+)?web|look\s+up|google)/iu;

// Ollama treats a context-size change as a different runner configuration.
// Forcing 1024 on the same artifact used by CHAT therefore evicts and reloads
// a large model between classification and answer generation. Preserve the
// compact context only when the operator configured a genuinely separate FAST
// artifact; otherwise let the shared model use its registered context.
function classifierNumCtxOverride() {
  const fastModel = config.models?.FAST;
  if (typeof fastModel !== 'string' || fastModel.length === 0) return null;
  return fastModel === config.models?.CHAT ? null : 1024;
}

// ════════════════════════════════════════════════════════════════════════════════
// v65: REPORT_SOFT_KEYWORDS — analysis/summary/comparison keywords that may or
// may not need web data. These overlap with REPORT_PATTERNS but should only
// trigger REPORT when accompanied by fresh-data context (temporal, web, market).
//
// Without fresh-data context:
//   "analyzuj resource Lotus Notes" → CONVERSATIONAL (LLM knowledge)
//   "shrň co víš o Pythonu" → CONVERSATIONAL
//   "porovnej React a Vue" → CONVERSATIONAL
//
// With fresh-data context:
//   "analyzuj trh za poslední měsíc" → REPORT (temporal)
//   "shrnutí novinek za tento týden" → REPORT (news + temporal)
//   "porovnej aktuální ceny GPU" → REPORT (current + prices)
// ════════════════════════════════════════════════════════════════════════════════
// Only analysis-family keywords are "soft" — other REPORT keywords (shrň, porovnej,
// přehled, souhrn) stay hard because they're typically combined with explicit report
// context ("dej mi souhrn", "give me overview", "přehled novinek za měsíc").
const REPORT_SOFT_KEYWORDS = /(?:anal[ýy]z|analyzuj|analyza|analysis|analyze)/i;

// v84: Added project-scope terms (z projektu, v projektu, ze složky, z folderu).
// "analyzuj X z projektu" = fresh-data context (project files), not LLM knowledge.
const REPORT_FRESH_CONTEXT = /(?:za\s+posledn|za\s+tento|za\s+minul|aktu[áa]ln|sou[čc]asn|current|latest|recent|dne[sš]|te[ďd]\b|today|now\b|live\b|real.?time|z\s+webu|novinky|news|zpráv|zprav|trh|market|cen[ay]|price|kurz|stock|akcie|krypto|bitcoin|po[čc]as[íi]|weather|report\b|z\s+projektu|v\s+projektu|ze?\s+slo[žz]ky|z\s+fold|z\s+adres[áa][řr]|from\s+(the\s+)?project|from\s+(this\s+)?folder|z\s+tohoto\s+fold)/i;

// ════════════════════════════════════════════════════════════════════════════════
// v44.8 - CREATIVE/IDEATION patterns (MUST be checked BEFORE SEARCH!)
// ════════════════════════════════════════════════════════════════════════════════
// These requests want IDEAS, DESIGNS, SUGGESTIONS - NOT web search!
// ════════════════════════════════════════════════════════════════════════════════
const CREATIVE_IDEATION_PATTERNS = [
  // Direct ideation requests
  /vymyslet/i, /vymysli/i,                      // "chci vymyslet kampan"
  /navrhni/i, /navrhovat/i, /navrhy/i,          // "navrhni mi", "pár návrhů"
  /nápady/i, /napady/i, /nápad/i,               // "dej mi nápady"
  /inspirac/i,                                   // "inspirace", "inspiruj mě"
  /brainstorm/i,                                 // explicit brainstorming
  /kreativn[ěí]/i,                               // "kreativní návrhy"

  // "Can you give me..." ideation
  /dokážeš mi dát.*(návrh|nápad|inspirac|tip)/i, // "dokážeš mi dát pár návrhů?"
  /dej mi.*(návrh|nápad|inspirac|tip|variace)/i, // "dej mi nápady"
  /dáš mi.*(návrh|nápad|inspirac)/i,             // "dáš mi pár tipů?"
  /můžeš (mi )?(navrhnout|vymyslet)/i,           // "můžeš mi navrhnout"

  // Design/creation requests
  /vytvoř.*kampaň/i, /vytvor.*kampan/i,         // "vytvoř kampaň"
  /navrhni.*příběh/i, /navrhni.*pribeh/i,       // "navrhni příběh"
  /vymysli.*postavu/i, /vymysli.*charakter/i,   // "vymysli postavu"
  /vymysli.*zápletk/i, /vymysli.*zapletk/i,     // "vymysli zápletku"

  // Style/variation requests
  /podobn[ýéě].*(styl|téma|tema|kampaň|kampan)/i, // "podobný styl", "podobné téma"
  /variace na/i, /variaci na/i,                 // "variace na téma"
  /něco jako/i, /neco jako/i,                   // "něco jako X"
  /ve stylu/i,                                   // "ve stylu X"

  // English equivalents
  /give me.*(ideas|suggestions|tips|options)/i,
  /suggest.*for me/i, /come up with/i,
  /brainstorm/i, /design.*for/i,
  /create.*(story|campaign|character|plot)/i,
  /similar.*style/i, /something like/i,

  // v44.8: Joke/humor requests (creative, not search)
  /vtip/i,                                         // "řekni mi vtip", "napiš vtip"
  /joke/i,                                          // "tell me a joke"
  /napiš.*(báse[ňn]|básničk|povidku|povídku|příběh|pribeh)/i, // "napiš báseň", "napiš básničku", "napiš příběh"
  /řekni mi.*(k tomu|o tom)/i,                     // "řekni mi k tomu" (contextual continuation)
  /tell me\s+(a joke|a story|a tale|a poem)/i,  // "tell me a story" (NOT "tell me about X")
];

// ════════════════════════════════════════════════════════════════════════════════
// v44.9 - CREATIVE FOLLOW-UP PATTERNS
// ════════════════════════════════════════════════════════════════════════════════
// When in CREATIVE mode, these follow-up questions should STAY in CREATIVE.
// "jaký to může mít vliv na hráče?" after "vymysli kampaň" = still CREATIVE
// User is exploring THEIR ideation, not asking for web search!
// ════════════════════════════════════════════════════════════════════════════════
const CREATIVE_FOLLOW_UP_PATTERNS = [
  // Impact/effect questions (exploring creative ideas)
  /jaký.*vliv/i,                    // "jaký to může mít vliv na hráče?"
  /jak.*ovlivn/i,                   // "jak to ovlivní atmosféru?"
  /co.*způsob/i,                    // "co to způsobí?"
  /co.*dělá/i,                      // "co to dělá s příběhem?"
  /jak.*půso/i,                     // "jak to působí?"
  /jaký.*dopad/i,                   // "jaký to má dopad?"
  /v čem.*jin/i,                    // "v čem je to jiné?"
  /co z toho plyn/i,                // "co z toho plyne?"

  // Exploration of created content
  /pro hráč/i,                      // "pro hráče", "jaké to bude pro hráče"
  /pro čtenář/i,                    // "pro čtenáře"
  /pro postav/i,                    // "pro postavy"
  /na atmosfér/i,                   // "jaký vliv na atmosféru"

  // Expansion requests (staying in creative mode)
  /rozviň/i, /rozvij/i,             // "rozviň tu myšlenku"
  /víc.*(o tom|k tomu)/i,           // "řekni mi víc o tom"
  /podrobněj/i,                     // "podrobněji"
  /detailn/i,                       // "detailněji"
  /hlubš/i,                         // "hlouběji", "hlubší"

  // Consequence questions
  /co když/i,                       // "co když to změním?"
  /jak by/i,                        // "jak by to vypadalo?"
  /co by se stalo/i,                // "co by se stalo?"

  // v45.0 FIX: Alternative/variation requests (MUST stay CREATIVE!)
  /alternativ/i,                    // "alternativní verzi", "alternativu"
  /jinak pojat/i,                   // "jinak pojaté"
  /jin(ou|[áéůý])\s*verz/i,               // "jinou verzi", "jiná verze", "jiné verze"
  /dát.*verz/i,                     // "dát jinou verzi"
  /zkus.*temnější/i,                // "zkus temnější"
  /zkus.*lehčí/i,                   // "zkus lehčí"
  /zkus.*jinak/i,                   // "zkus to jinak"
  /ještě.*verz/i,                   // "ještě jednu verzi"
  /další.*verz/i,                   // "další verzi"
  /podobn[ěé]/i,                    // "podobně", "podobné"
  /variac[ie]/i,                    // "variace", "variaci" - explicit check

  // v72: Style continuation patterns
  /^similar\s+style/i,              // "similar style"
  /^ve\s+stejn[ée]m\s+styl/i,      // "ve stejném stylu"
  /^podobn[ýé]\s+styl/i,           // "podobný styl", "podobné styly"
  /^stejn[ýé]\s+styl/i,            // "stejný styl"

  // English equivalents
  /what.*effect/i,
  /what.*impact/i,
  /how.*affect/i,
  /what.*happens/i,
  /for.*players/i,
  /for.*readers/i,
  /expand.*on/i,
  /tell me more/i,
  /go deeper/i,
  /alternative/i,                   // "alternative version"
  /another.*version/i,              // "another version"
  /different.*take/i,               // "different take"
  /similar.*style/i,                // "similar style", "in a similar style"
  /same.*style/i,                   // "same style", "in the same style"
  /try.*darker/i,                   // "try darker"
  /try.*lighter/i,                  // "try lighter"
];

const REPORT_PATTERNS = [
  /vytvo[rř].*report/i, /create.*report/i,
  // v57.3: Czech without diacritics + more report triggers
  /(ud[eě]lej|ud[eě]lat|p[rř]iprav|dej mi|napi[sš]).*report/i,  // "udelej mi report", "připrav report"
  /report\s+(?:z|ze|o|zpráv|zprav|novink|o\s)/i,                  // "report z webu", "report zprav"
  /(?:report|zpráv[ay]?|zprav|přehled|prehled).*(?:z\s+webu|z\s+\w+\.\w+)/i,  // "report z webu novinky.cz"
  /z\s+webu\s+\S+\.\S+/i,                                         // "z webu novinky.cz" (website + domain)
  /analýza/i, /analyza/i, /analysis/i, /analyze/i, /analyzuj/i,
  /shrnutí/i, /shrnuti/i, /summary/i, /summarize/i, /shrň/i, /shrn/i,
  /porovnej/i, /compare/i, /comparison/i, /srovnání/i, /srovnani/i,
  /přehled/i, /prehled/i, /overview/i,
  // v44.2 - explicit report triggers (with + without diacritics)
  /souhrn/i,                                    // "dej mi souhrn" → REPORT
  /za posledn[ií]/i,                            // "za poslední/posledni týden" → REPORT
  /za (tento|minul[ýy]) (t[ýy]den|m[ěe]s[íi]c)/i,  // "za tento tyden" → REPORT
  /weekly.*report/i, /monthly.*report/i,
  /dej mi.*(přehled|prehled|souhrn)/i, /give me.*overview/i,
  // v44.2 - news/events report patterns
  /zpráv.*za/i, /zprav.*za/i,                   // "zprávy za poslední týden"
  /novinky.*za/i,                               // "novinky za tento měsíc"
  /co (se stalo|je nového).*za/i,               // "co se stalo za poslední den"
  // v57.3 — domain-specific report triggers
  /zpráv[ay]?\s+(?:z|ze|na)/i,                  // "zprávy z/ze/na" (news from)
  /zprav\s+(?:z|ze|na)/i,                       // no-diacritics variant
];

const FACTUAL_PATTERNS = [
  /\bpočasí\b/i, /\bpocasi\b/i, /\bweather\b/i,
  /\bkurz\b/i, /\bexchange rate\b/i,      // v58.1: \b prevents "kurz" inside "rekurze"
  /\bakcie\b/i, /\bstock\b/i,
  /\bbitcoin\b/i, /\bcrypto\b/i, /\bkrypto\b/i,
  /\bzpráv[ay]\b/i, /\bzprav[ay]?\b/i, /\bnews\b/i,    // v57.3: "zpravy" + "zprav" without diacritics
  /\bvýsledk[yů]/i, /\bvysledk/i, /\bresults\b/i, /\bscore\b/i,
  /\bstatistik/i, /\bstatistic/i,
  /\bnovinky\b/i,                                // v57.3: "novinky" (Czech news)
];

// v94: CODE_ANALYSIS — code analysis, debugging, code review, explanation
// MUST be before CODE_PATTERNS — "analyzuj kód" is analysis, not code generation
const CODE_ANALYSIS_PATTERNS = [
  /analyz[uj].*(?:kód|code|modul|tříd|class)/i,
  /(?:najd[iěte]|find|hledej).*(?:bug|chyb[uya]|error|problém)/i,
  /(?:why|proč).*(?:fail|padá|nefunguje|crash|error|chyb)/i,
  /(?:explain|vysvětli).*(?:code|kód|modul|funkc|metod|class|tříd)/i,
  /(?:debug|ladění|stacktrace|exception|traceback)/i,
  // A cause question is not itself a code request; require an explicit code
  // anchor before the fallback classifier selects CODE_ANALYSIS intent.
  /^(?=.*(?:root.?cause|příčin))(?=.*(?:\b(?:code|codebase|bug|stacktrace|exception|traceback)\b|(?<![\p{L}\p{N}_])k[oó]d(?:u|em)?(?=\s|[.?!,:;]|$)))/iu,
  /(?:code.?review|review.*(?:kód|code))/i,
  /(?:how.*work|jak.*funguje).*(?:code|kód|modul|systém)/i,
  /(?:what.*does|co.*dělá).*(?:this|tato|ten|tento).*(?:code|kód|funkce|metoda)/i,
  /(?:analyze|propose.*solution|navrhni.*řešení)/i,
  /analyzuj.*(?:projekt|codebase|zdrojov)/i,
  /(?:kde|where).*(?:se.*volá|is.*called|se.*používá|is.*used)/i,
  /(?:projdi|prohledej|scan|inspect).*(?:kód|code|projekt|zdrojov|source)/i,
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
  // v58.1: Imperative + technical artifact (prevents ASK_USER for clear requests)
  /napi[sš]\s+.{0,30}(server|api|endpoint|handler|parser|crawler|bot|cli|script|modul|komponent)/i,
  /vytvo[rř]\s+.{0,30}(server|api|endpoint|handler|parser|crawler|bot|cli|script|modul|komponent)/i,
  /ud[eě]lej\s+.{0,30}(server|api|endpoint|handler|parser|crawler|bot|cli|script)/i,
  /naprogramuj/i,              // "naprogramuj crawler"
  /write\s+.{0,20}(server|api|endpoint|handler|parser|crawler|bot|cli|script|component|module)/i,
  /create\s+.{0,20}(server|api|endpoint|handler|parser|crawler|bot|cli|script|component|module)/i,
  // v58.3: Common code artifacts not covered above
  /napi[sš]\s+.{0,30}(regex|regexp|validaci|validátor|test|query|sql|html|css|algorit)/i,
  /write\s+.{0,20}(regex|regexp|validator|test|query|sql|html|css|algorit)/i,
  // v58.1: Imperative + language (clear intent to write code)
  /napi[sš]\s+.{0,40}(python|node|javascript|typescript|java|rust|go|ruby|php|bash|react|vue)/i,
  /write\s+.{0,30}(python|node|javascript|typescript|java|rust|go|ruby|php|bash|react|vue)/i,
  /create\s+.{0,30}(python|node|javascript|typescript|java|rust|go|ruby|php|bash|react|vue)/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// v63.0: FILE_READ PATTERNS — user wants to read/view/open a file
// ─────────────────────────────────────────────────────────────────────────────
// "otevři soubor X", "přečti soubor", "ukaž mi obsah souboru"
// TERMINAL: filesystem read, no web search, no LLM (unless FILE_EXPLAIN)
// ─────────────────────────────────────────────────────────────────────────────
const FILE_READ_PATTERNS = [
  // CZ: "otevři/otevřít soubor", "přečti soubor", "načti soubor"
  /(?:^|\s)(otev[rř]i|otev[rř][ií]t)\s+(soubor|file)/i,
  /(?:^|\s)(p[rř]e[cč]ti|p[rř]e[cč][ií]st)\s+(soubor|file|obsah)/i,
  /(?:^|\s)(na[cč]ti|na[cč][ií]st)\s+(soubor|file)/i,
  /(?:^|\s)uka[zž]\s+(mi\s+)?(soubor|file|obsah)/i,
  /(?:^|\s)zobraz\s+(mi\s+)?(soubor|file|obsah)/i,
  // CZ: "co je v souboru X", "co obsahuje soubor"
  /co\s+(je\s+)?(v\s+)?soubor/i,
  /co\s+obsahuje\s+(soubor|file)/i,
  // CZ: "co je v readme", "co je v .gitignore" — file ref by name (no "soubor" keyword)
  /co\s+(je\s+)?v\s+[\w./-]+\.?\w*\s*$/i,
  // CZ: "ukaž readme", "otevři readme", "přečti .gitignore" — known filenames without extension
  /(?:^|\s)(otev[rř]i|p[rř]e[cč]ti|na[cč]ti|uka[zž]|zobraz)\s+(mi\s+)?(readme|makefile|dockerfile|\.?\w+ignore|\.env\w*|changelog|license|todo)\s*$/i,
  // CZ: "co je součástí projektu", "jaké soubory jsou v projektu", "vypiš obsah projektu"
  /(?:co|jak[ée])\s+(?:je\s+)?(?:sou[cč][áa]st[ií]|v)\s+(?:tohoto\s+|toho\s+)?projekt/i,
  /vypi[sš]\s+(?:mi\s+)?(?:obsah|soubory|adres[áa][rř]|slo[zž]ku)\s*(?:projektu)?\s*$/i,
  /(?:jak[ée]|kter[ée]|co\s+za)\s+soubory\s+(?:jsou\s+)?(?:v|tady|zde)/i,
  // CZ: "jaké soubory obsahuje projekt", "co obsahuje projekt", "co má projekt za soubory"
  /(?:jak[ée]|kter[ée])\s+soubory\s+(?:obsahuje|m[áa])\s+(?:tento\s+|ten\s+|tenhle\s+)?projekt/i,
  /co\s+(?:obsahuje|m[áa])\s+(?:tento\s+|ten\s+|tenhle\s+)?projekt/i,
  /co\s+(?:je\s+)?(?:v|uvnit[rř])\s+(?:tohoto?\s+|toho\s+)?projektu?/i,
  // CZ: "ukaž strukturu projektu", "struktura projektu"
  /(?:uka[zž]|zobraz)\s+(?:mi\s+)?(?:strukturu|obsah)\s+projektu/i,
  /struktura\s+projektu/i,
  // CZ: "otevři X.js", "přečti config.json" — filename with extension
  /(?:^|\s)(otev[rř]i|p[rř]e[cč]ti|na[cč]ti|uka[zž]|zobraz)\s+(mi\s+)?[\w./-]+\.\w{1,10}\s*$/i,
  // EN: "open file", "read file", "show file", "cat file"
  /(?:^|\s)(open|read|show|display|cat)\s+(the\s+)?(file|content)/i,
  /(?:^|\s)(open|read|show|display|cat)\s+(the\s+)?[\w./-]+\.\w{1,10}\s*$/i,
  // EN: "what's in the project", "list files", "show project files"
  /(?:what'?s|what\s+is)\s+in\s+(?:the\s+)?project/i,
  /(?:list|show)\s+(?:the\s+)?(?:project\s+)?files/i,
];

// v63.0: FILE_EXPLAIN PATTERNS — user wants file read + LLM explanation
const FILE_EXPLAIN_PATTERNS = [
  // CZ: "vysvětli soubor", "co dělá soubor X", "analyzuj soubor"
  /vysv[eě]tli\s+(mi\s+)?(soubor|file|k[oó]d|obsah)/i,
  /analyzuj\s+(mi\s+)?(soubor|file|k[oó]d)/i,
  /co\s+d[eě]l[áa]\s+(tento\s+|tenhle\s+|ten\s+)?(soubor|file|k[oó]d|skript)/i,
  /popiš\s+(mi\s+)?(soubor|file|k[oó]d)/i,
  // CZ: "vysvětli X.js", "analyzuj config.json" (direct file ref)
  /(?:^|\s)(vysv[eě]tli|analyzuj|popiš)\s+(mi\s+)?[\w./-]+\.\w{1,10}\s*$/i,
  // CZ: "vysvětli mi co dělá X.js" — explain + "co dělá" + file path
  /(?:^|\s)(vysv[eě]tli|analyzuj|popiš)\s+(mi\s+)?(co\s+d[eě]l[áa]\s+)?[\w./-]+\.\w{1,10}\s*$/i,
  // EN: "explain file", "what does file X do", "analyze file"
  /(?:^|\s)(explain|analyze|describe)\s+(the\s+)?(file|code|script|content)/i,
  /what\s+does\s+(this\s+|the\s+)?(file|code|script)\s+do/i,
  /(?:^|\s)(explain|analyze|describe)\s+(the\s+)?[\w./-]+\.\w{1,10}\s*$/i,
  // EN: "explain what X.js does"
  /(?:^|\s)(explain|analyze|describe)\s+(what\s+)?[\w./-]+\.\w{1,10}\s+(does|contains|is)/i,
];

export function isExplicitFileReadIntent(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  return FILE_READ_PATTERNS.some(pattern => pattern.test(text))
    || FILE_EXPLAIN_PATTERNS.some(pattern => pattern.test(text));
}

export function isExplicitFileWriteIntent(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  return FILE_WRITE_PATTERNS.some(pattern => pattern.test(text));
}

// ─────────────────────────────────────────────────────────────────────────────
// v65.0: SHELL PATTERNS — user wants to execute a terminal/shell command
// ─────────────────────────────────────────────────────────────────────────────
// "spusť npm test", "pusť ls", "runni git status", "zavolej make"
// TERMINAL: routes to terminal execution channel, NOT LLM.
// ─────────────────────────────────────────────────────────────────────────────
const SHELL_COMMAND_PATTERNS = [
  // CZ: explicit execution verbs + command-like argument
  // v128: negative lookahead for BUILD keywords — "spusť build" is BUILD, not SHELL
  /(?:^|\s)(spusť|spust|spustit|pusť|pust|pustit|runni|zavolej|proved|proveď|vykonej|exec)\s+(?!(?:mi\s+)?(?:build|stav(?:bu|ět)|projekt|aplikac|deploy)\b)(.+)/i,
  // CZ: "dej/hoď do terminálu", "v terminálu spusť"
  /(?:^|\s)(v\s+termin[áa]lu|do\s+termin[áa]lu|v\s+shellu|do\s+shellu)\s+(.+)/i,
  /(?:^|\s)(.+)\s+(v\s+termin[áa]lu|do\s+termin[áa]lu|v\s+shellu)/i,
  // CZ: "spusť testy", "pusť linter", "runni docker"
  // v128: "build" removed — "spusť build" is BUILD intent, not SHELL
  /(?:^|\s)(spusť|spust|pusť|pust)\s+(testy|test[yů]?|lint|linter|server|docker|make)\b/i,
  // CZ: "npm test", "npm install", "yarn build" — bare package manager commands
  /^\s*(npm|yarn|pnpm|npx|bun)\s+(test|install|build|run|start|dev|lint|ci|exec)\b/i,
  // CZ/EN: "git status", "git pull", "git push" — bare git commands
  /^\s*git\s+(status|pull|push|commit|add|diff|log|branch|checkout|merge|stash|clone|fetch|rebase)\b/i,
  // EN: "run npm test", "execute make build"
  /^\s*(run|execute|exec)\s+(.+)/i,
  // Bare well-known commands (ls, cat, pwd, mkdir, cd, docker, make, curl, etc.)
  // v65.1: negative lookahead — exclude comparison/discussion words (Python vs JS, Node je...)
  /^\s*(ls|cat|pwd|mkdir|rmdir|cp|mv|touch|head|tail|grep|curl|wget|docker|docker-compose|make|cmake|python|node|deno|cargo|go\s+run|go\s+build|rustc|gcc|g\+\+)\s+(?!vs\b|versus\b|nebo\b|oproti\b|or\b|and\b|je\b|jsou\b|nen[ií]\b|a\s)/i,
  // find requires filesystem-like args (., /, -name, -type, -exec)
  /^\s*find\s+([.\/~]|.*-(?:name|type|exec|perm|mtime|iname|maxdepth))/i,
  /^\s*(ls|pwd|whoami|hostname|uname|uptime|df|du|free|top|htop|ps|env|printenv)\s*$/i,
];

// Helper: extract the command from a shell intent input
function extractShellCommand(input) {
  const text = input.trim();
  // Direct command patterns (npm test, git status, ls -la, etc.)
  const directMatch = text.match(/^\s*(npm|yarn|pnpm|npx|bun|git|ls|cat|pwd|mkdir|rmdir|cp|mv|touch|head|tail|grep|find|curl|wget|docker|docker-compose|make|cmake|python|node|deno|cargo|go|rustc|gcc|g\+\+|whoami|hostname|uname|uptime|df|du|free|top|htop|ps|env|printenv)\b.*/i);
  if (directMatch) return directMatch[0].trim();
  // "spusť X" / "run X" — extract X
  const verbMatch = text.match(/(?:spusť|spust|spustit|pusť|pust|pustit|runni|zavolej|proved|proveď|vykonej|exec|run|execute)\s+(.+)/i);
  if (verbMatch) return verbMatch[1].trim();
  // "v terminálu X" — extract X
  const termMatch = text.match(/(?:v\s+termin[áa]lu|do\s+termin[áa]lu|v\s+shellu|do\s+shellu)\s+(.+)/i);
  if (termMatch) return termMatch[1].trim();
  // "X v terminálu"
  const termMatch2 = text.match(/(.+)\s+(?:v\s+termin[áa]lu|do\s+termin[áa]lu|v\s+shellu)/i);
  if (termMatch2) return termMatch2[1].trim();
  // "spusť testy" → "npm test"
  if (/spusť\s+test[yů]?|pusť\s+test[yů]?/i.test(text)) return 'npm test';
  if (/spusť\s+build|pusť\s+build/i.test(text)) return 'npm run build';
  if (/spusť\s+lint|pusť\s+lint/i.test(text)) return 'npm run lint';
  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// v70→v71: FILE_WRITE PATTERNS — REGEX FALLBACK ONLY
// ─────────────────────────────────────────────────────────────────────────────
// v71: Primary classification is LLM-based (_llmClassifyIntent).
// These patterns are ONLY used when the LLM is unavailable or returns
// low confidence. The LLM handles semantic understanding of write intent
// in any phrasing (Czech, English, mixed).
// ─────────────────────────────────────────────────────────────────────────────
const FILE_WRITE_PATTERNS = [
  // CZ/EN explicit target with both imperative and infinitive forms.
  /(?:^|\s)(?:ulo[žz](?:it)?|zapi[šs]|zapsat|napi[šs]|napsat|vytvo[rř](?:it)?|save|write|create)(?=\s|$).{0,40}(?:do|into|to)\s+(?:souboru?\s+|file\s+)?[\w./-]+\.\w{1,10}/i,
  // CZ: "ulož/zapiš/napiš/dej ... do souboru"
  /(?:^|\s)(ulo[žz]|uloz|ulo[žz]it|zapi[šs]|zapsat|napi[šs]|napsat|dej|vlo[žz])\s+.{0,20}(do\s+souboru|do\s+file)/i,
  // CZ: "ulož/zapiš/napiš to/ho/ji/je" (short form)
  /(?:^|\s)(ulo[žz]|uloz|zapi[šs]|napi[šs]|dej)\s+(to|ho|ji|je)\b/i,
  // CZ: "vytvoř soubor X"
  /(?:^|\s)(vytvo[rř]|vytvo[rř]it|vytvorit)\s+.{0,10}soubor\b/i,
  // CZ: "ulož/zapiš to do plan.md" (explicit path)
  /(?:^|\s)(ulo[žz]|uloz|save|zapi[šs]|napi[šs])\s+(?:to\s+)?(?:do|jako|into)\s+[\w./-]+/i,
  // EN: "save it to a file / to disk"
  /(?:^|\s)save\s+.{0,10}(to\s+(?:a\s+)?file|to\s+disk)/i,
  // EN: "save it/this/that"
  /(?:^|\s)save\s+(it|this|that)\b/i,
  // EN: "create/write a file"
  /(?:^|\s)(create|write)\s+(?:a\s+)?file\b/i,
  // EN: "write to file X"
  /(?:^|\s)write\s+(?:it\s+)?to\s+(?:file\s+)?[\w./-]+/i,
];

// v70: Extract file path from file-write input
function extractWriteFilePath(input) {
  // "ulož to do plan.md" → "plan.md"
  const doMatch = input.match(/(?:do|jako|into|to)\s+["']?([\w./-]+\.[\w]{1,10})["']?\s*$/i);
  if (doMatch) return doMatch[1];
  // "ulož to do souboru plan.md" → "plan.md"
  const afterSoubor = input.match(/(?:souboru?|file)\s+["']?([\w./-]+\.[\w]{1,10})["']?\s*$/i);
  if (afterSoubor) return afterSoubor[1];
  // "create file plan.md" → "plan.md"
  const createFile = input.match(/(?:file|soubor)\s+["']?([\w./-]+\.[\w]{1,10})["']?\s*$/i);
  if (createFile) return createFile[1];
  // "zapiš to do souboru popisujici projekt" → no specific filename, auto-generate
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD PATTERNS — multi-step project-level work (→ Planner handoff)
// ─────────────────────────────────────────────────────────────────────────────
// Distinction from CODE: BUILD = project-level goal, CODE = single function/fix
// BUILD triggers Planner pipeline (D1→CODE→R2→R1), CODE stays in Chat Agent
// ─────────────────────────────────────────────────────────────────────────────
const BUILD_PATTERNS = [
  // Czech: explicit build/deploy commands
  /postav\s+(mi\s+)?/i,                    // "postav mi web", "postav API"
  /rozjeď\s+(mi\s+)?/i,                    // "rozjeď mi cluster"
  /nasaď\s+(mi\s+)?/i,                     // "nasaď to na server"
  /deployni/i, /deploy/i,                  // "deployni", "deploy to prod"
  /scaffoldni/i, /scaffold/i,              // "scaffoldni projekt"
  /nastav\s+(mi\s+)?.*infrastruktur/i,     // "nastav mi infrastrukturu"
  /nastav\s+(mi\s+)?.*pipeline/i,          // "nastav mi CI/CD pipeline"
  /nastav\s+(mi\s+)?.*monitoring/i,        // "nastav mi monitoring"
  /automatizuj/i,                          // "automatizuj deployment"

  // Czech: goal-level project requests
  /vytvoř\s+(mi\s+)?(celý|celej|kompletní|nový)(\s+\S+)*\s+(projekt|stack|app|systém)/i,
  /postav\s+(mi\s+)?(celý|celej|kompletní)\s+/i,  // "postav mi celý stack"
  /chci\s+mít\s+/i,                        // "chci mít monitoring"
  /potřebuji?\s+(systém|aplikaci|infrastruktur|pipeline|server)/i,
  /jdeme?\s+stavět/i,                      // "jdeme stavět", "jdi stavět"
  /jdi\s+stavět/i,
  /začni\s+stavět/i,                       // "začni stavět"
  /spusť\s+(mi\s+)?build/i,               // "spusť build"

  // English: explicit build commands
  /build\s+(me\s+)?(a\s+)?(\w+\s+)*(project|app|api|stack|system|service|microservice|infra)/i,
  /set\s+up\s+(a\s+)?(\w+\s+)*(project|server|cluster|pipeline|monitoring)/i,
  /create\s+(a\s+)?(full|complete|new)(\s+\w+)*\s+(project|stack|app|system|microservice)/i,
  /let'?s\s+build/i,                       // "let's build"
  /start\s+building/i,
  /spin\s+up/i,                            // "spin up a cluster"
  /provision/i,                            // "provision infrastructure"

  // Multi-step indicators (combined with action verb)
  /nakonfiguruj\s+(mi\s+)?(celý|celej|kompletní)/i,
  /připrav\s+(mi\s+)?(prostředí|environment|stack|infra)/i,

  // v128: Modal verb BUILD patterns ("můžeš začít implementovat", "chci abys začal stavět")
  /m[uůo][zž]e[sš]?\s+z[aá][cč][ií]t\s+(implement\S*|stav[eě]t|vytvo[rř]it|napsat|ud[eě]lat|programovat|k[oó]dovat)/i,
  /m[uůo]ze[sš]?\s+zacit\s+(implement\S*|stavet|vytvorit|napsat|udelat|programovat|kodovat)/i,  // no diacritics
  /(mohl|cht[eě]l)\s+bys?\s+(implement\S*|vytvo[rř]it|postavit|napsat|nakódovat|stavět)/i,
  /chci\s+abys?\s+(za[cč]al|implementoval|napsal|vytvo[rř]il|postavil)\b/i,
  /za[cč]ni\s+s\s+(buildem|build|implementac[ií]|ps[aá]n[ií]m\s+k[oó]du|v[ýy]vojem|programov[aá]n[ií]m)/i,
  /zacni\s+s\s+(buildem|build|implementaci|psanim\s+kodu|vyvojem|programovanim)/i,  // no diacritics
  /p[rř]epni\s+(?:se\s+)?do\s+(build|implementa[cč]n[ií]ho|k[oó]dovac[ií]ho)\s+(m[oó]du|re[zž]imu)/i,
  /^napsat\s+(program|aplikac\S*|app|web\S*|syst[eé]m|server|api|backend|frontend)\b/i,
  // EN: modal BUILD
  /can\s+you\s+(start|begin)\s+(building|implementing|coding|creating|developing)/i,
  /could\s+you\s+(build|implement|create|develop|code)\s/i,
  /I\s+want\s+you\s+to\s+(build|implement|create|develop|code)\s/i,
  /start\s+(implementing|coding|developing)\b/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// v123.3: DESIGN → BUILD ESCALATION in project mode
// ─────────────────────────────────────────────────────────────────────────────
// "chci vytvořit mobilní aplikaci" in project mode = lifecycle, not plain doc.
// Advisory requests ("navrhni schema", "jaký stack") stay DESIGN.
// ─────────────────────────────────────────────────────────────────────────────
const DESIGN_BUILD_HYBRID = [
  // A DESIGN request that also explicitly asks for implementation is a BUILD
  // signal even without an active project. Keep this narrower than the
  // project-only escalation vocabulary below.
  /navrhni\s+.{0,60}(implementuj|postav|buduj|naprogramuj|vytvo[rř]|napi[sš])\b/i,
  /navrhni\s+.{0,10}a\s+(implementuj|postav|buduj|naprogramuj|vytvo[rř]|napi[sš])/i,
  /design\s+.{0,30}(implement|build|create|develop)/i,
];

const DESIGN_BUILD_ESCALATION = [
  // CZ: "chci vytvořit/udělat/postavit [app type]" — intent to BUILD, not just plan
  /chci\s+(vytvo[rř]it|ud[eě]lat|postavit|napsat)\s+.{0,60}(aplikac|app|web|str[áa]nk|syst[eé]m|platform)/i,
  /chci\s+(vytvo[rř]it|ud[eě]lat)\s+.{0,60}(mobiln[ií]|android|ios|flutter)/i,
  // CZ no-diacritics
  /chci\s+(vytvorit|udelat)\s+.{0,60}(aplikac|app|web|system|mobilni)/i,
  // EN: "I want to create/build/make [app type]"
  /want\s+to\s+(create|build|make|develop)\s+.{0,60}(app|application|website|system|platform)/i,
  ...DESIGN_BUILD_HYBRID,
];

const DESIGN_ADVISORY = [
  /navrhni\s+.{0,30}(sch[eé]ma|datab[áa]z|api|endpoint)/i,
  /(ud[eě]lej|vytvo[rř]|napi[sš])\s+.{0,20}(roadmap|plán|harmonogram)/i,
  /jak[ýy]\s+stack/i,
  /jak[aá]\s+technologi/i,
  /doporu[cč]\s+/i,
  /navrhni\s+.{0,15}(jak|postup|strategii)/i,
];

// ─────────────────────────────────────────────────────────────────────────────
// BUILD DEFERRAL VOCABULARY — v101: sequential intent detection
// ─────────────────────────────────────────────────────────────────────────────
// "revizi zadání... a pak implementace" = discussion FIRST, build LATER.
// 3-part detection: DISCUSSION_VERBS + BUILD_VERBS + SEQUENCE_MARKERS
// Composite: all 3 must match. Standalone patterns for conditional mood.
// ─────────────────────────────────────────────────────────────────────────────

// CZ + EN verbs indicating review/discussion intent
const DISCUSSION_VERBS = /(?:reviz[ieí]|proj[ií]t|projd[eě]me|doladit|dolad[ií]me|probrat|probereme|prodiskut\S*|projedn\S*|zkontrol\S*|zhodnot\S*|konzult\S*|review|discuss|go\s+through|fine.?tune|refine|talk\s+about)/i;

// CZ + EN verbs indicating build/implementation intent (stem-based for conjugated forms)
const BUILD_VERBS = /(?:implement\S*|stav[eěií]\S*|build\S*|programov\S*|k[oó]d\S*|pust\S*|za[cč][ií]t\s+(?:stav|impl|prog|k[oó]d)|develop|code|start\S*)/i;

// CZ + EN temporal ordering markers
const SEQUENCE_MARKERS = /(?:a\s+pak|a\s+potom|a\s+n[aá]sledn[eě]|pot[ée]\s+|po\s+tom|nejd[rř][ií]v|nejdrive|p[rř]edt[ií]m|predtim|before|and\s+then)/i;

// CZ: conditional mood before build verb — future intent, not imperative
// Handles both word orders: "by ses mohl / bys mohl" AND "mohli bychom / mohla bych"
const CONDITIONAL_BUILD = /(?:(?:by\s+(?:ses?\s+)?|bys\s+)(?:mohl?a?|mohli)|(?:mohl?a?|mohli)\s+by(?:ch(?:om)?|ste|s)?(?:\s+se)?)\s+.{0,40}(?:pust\S*|za[cč][ií]t|implement\S*|stav[eěií]\S*|programov\S*|k[oó]d\S*)/i;

// CZ + EN: "nejdřív to projdeme" — implicit sequence without explicit build verb
const IMPLICIT_DISCUSSION_FIRST = /(?:nejd[rř][ií]v|nejdrive|p[rř]edt[ií]m|predtim|first|let'?s\s+first)\s+.{0,40}(?:proj[ií]t|projd|prober|diskut|dolad|reviz|review|discuss|go\s+through)/i;

// ─────────────────────────────────────────────────────────────────────────────
// SKILL PATTERNS — v88: deterministic triggers for skill/expertise creation
// ─────────────────────────────────────────────────────────────────────────────
// "vytvořit expertizu", "spusť skill", "přidej expertizu" → SKILL
// Needed because LLM prompt only triggers SKILL on "skill/recept/proceduru",
// but "expertizu" is the natural user-facing term.
// ─────────────────────────────────────────────────────────────────────────────
const SKILL_PATTERNS = [
  // CZ: create/add expertise
  /vytvo[rř]\S*\s+.{0,15}expert[iyíý][zs]/i,  // "vytvořit expertizu/expertýzu"
  /p[rř]id[eě]j\S*\s+.{0,15}expert[iyíý][zs]/i, // "přidej expertizu/expertýzu"
  /nov\S*\s+.{0,10}expert[iyíý][zs]/i,         // "nová/nový/novou expertiza/expertýza"
  /chci\s+.{0,15}expert[iyíý][zs]/i,          // "chci expertizu/expertýzu na..."

  // CZ: explicit skill/recept/procedura mentions
  /spus[tť]\S*\s+.{0,10}skill/i,              // "spusť skill X"
  /vytvo[rř]\S*\s+.{0,10}skill/i,             // "vytvoř skill"
  /spus[tť]\S*\s+.{0,10}recept/i,             // "spusť recept"
  /spus[tť]\S*\s+.{0,10}procedur/i,           // "spusť proceduru"

  // EN: explicit expertise/skill creation
  /create\s+(a\s+)?(new\s+)?(expertise|expert\s+profile)/i,
  /add\s+(a\s+)?(new\s+)?(expertise|expert\s+profile)/i,
  /run\s+(the\s+)?(skill|recipe|procedure)\b/i,
  /start\s+(the\s+)?(skill|recipe|procedure)\b/i,
];

// ═══════════════════════════════════════════════════════════════════════════════
// v58.0 — DESIGN PATTERNS: structured synthesis from LLM knowledge
// ═══════════════════════════════════════════════════════════════════════════════
// "udělej roadmapu", "navrhni architekturu", "chci vytvořit mobilní aplikaci"
// User wants STRUCTURED PLAN — NOT web search, NOT planner execution.
// DESIGN = LLM synthesizes from knowledge. BUILD = Planner executes code.
//
// Distinction:
//   DESIGN: "navrhni jak bys to řešil"    → structured doc, no tools
//   BUILD:  "postav mi to" / "jdeme stavět" → Planner pipeline with code
//   CREATIVE: "vymysli příběh" / "dej nápady" → free-form ideation
//   SEARCH: "co je Flutter" / "verze React" → web lookup
// ═══════════════════════════════════════════════════════════════════════════════
const DESIGN_PATTERNS = [
  // === CZ: Explicit plan/roadmap/architecture requests ===
  /(ud[eě]lej|vytvo[rř]|napi[sš]|p[rř]iprav|dej\s+mi)\s+.{0,20}(roadmap[ua]?|plán|harmonogram)/i,
  /(ud[eě]lej|vytvo[rř]|napi[sš]|p[rř]iprav)\s+.{0,20}(rozvrh|osnov|postup|kroky|návod|checklist)/i,
  /(ud[eě]lej|vytvo[rř]|napi[sš]|p[rř]iprav)\s+.{0,20}(architektur|návrh\s+(systém|aplikac|projekt))/i,

  // "navrhni" + system/app/platform = DESIGN (strongest signal)
  /navrhni\s+.{0,30}(aplikac|systém|system|platformu|infrastruktur|architekturu|řešení|reseni)/i,
  /navrhni\s+.{0,20}(jak|postup|plán|strategii|roadmap)/i,
  /navrhni\s+.{0,20}(technick|v[ýy]vojov|implementa[cč])/i,

  // "chci vytvořit" + project type = DESIGN (planning phase, not building yet)
  /chci\s+(vytvo[rř]it|ud[eě]lat|postavit|napsat)\s+.{0,20}(aplikac|app|web|str[aá]nk|syst[eé]m|platform)/i,
  /chci\s+(vytvo[rř]it|ud[eě]lat)\s+.{0,20}(mobiln[ií]|android|ios|flutter)/i,

  // Sprint/phase decomposition
  /rozd[eě]l\s+.{0,15}na\s+sprint/i,
  /rozd[eě]l\s+.{0,15}na\s+(f[aá]ze|etap|kroky|[úu]koly)/i,
  /od\s+za[cč][aá]tku\s+do\s+konce/i,
  /od\s+n[aá]vrhu\s+.{0,15}(po|do|a[zž])\s+(deploy|nasazen|produk)/i,
  /v[cč]etn[eě]\s+(test[uů]|deploy|nasazen|CI)/i,

  // Stack/tech planning
  /jak[ýy]\s+stack/i,
  /jak[aá]\s+technologi/i,
  /zvol\s+technologi/i,
  /doporu[cč]\s+.{0,15}(stack|technologi|framework|architektur)/i,

  // === CZ: No-diacritics ===
  /(udelej|vytvor|napis|priprav)\s+.{0,20}(roadmap|plan|architektur|navrh)/i,
  /chci\s+(vytvorit|udelat)\s+.{0,20}(aplikac|app|web|system|mobilni)/i,
  /rozdel\s+.{0,15}na\s+sprint/i,
  /vcetne\s+(testu|deploy|nasazeni)/i,

  // === EN: Design/architecture requests ===
  /design\s+.{0,20}(app|system|platform|architecture|solution)/i,
  /create\s+.{0,20}(roadmap|plan|architecture|blueprint)/i,
  /plan\s+.{0,20}(development|implementation|deployment|project)/i,
  /break\s+.{0,15}into\s+sprint/i,
  /from\s+scratch\s+to\s+(production|deployment)/i,
  /end.to.end\s+(plan|design|architecture)/i,
  /architect\s+.{0,20}(solution|system|app|platform)/i,
  /(propose|draft|outline)\s+.{0,20}(architecture|roadmap|plan|design)/i,

  // v58.3: "navrhni" + concrete tech artifact (API, app, web, service, tool, CLI)
  /navrhni\s+.{0,15}(api|rest\s*api|graphql|backend|frontend|server|microservice|service)/i,
  /navrhni\s+.{0,15}(mobiln[ií]\s+app|webov|cli\s+tool|desktop|saas|crm|erp|cms)/i,
];

// v58.3: Typo normalization for classification (CRE-level, not LLM-level)
// Only normalizes keywords critical for intent routing.
const TYPO_NORMALIZATIONS = [
  // "navrhni" variants
  [/\bnavrhn\b(?!i)/gi, 'navrhni'],           // "navrhn" → "navrhni" (missing i)
  [/\bnavhrni\b/gi, 'navrhni'],               // transposition
  // "architekturu/a" variants
  [/architekutru|architetkuru|architektruu/gi, 'architekturu'],
  [/architekutra|architetkura/gi, 'architektura'],
  // "aplikace" variants
  [/apliakce|aplikca|aplkiace/gi, 'aplikace'],
  // "mobilní" variants
  [/moblni|mobliní|mobiní/gi, 'mobilní'],
  // "sprinty" variants
  [/sprinyt|spritny|sprinst/gi, 'sprinty'],
  // "systém" variants
  [/sytsém|systme|sytém/gi, 'systém'],
  // "rozděl" variants
  [/rozdle|rozdel/gi, 'rozděl'],
  // "datový/datum" variants
  [/datmu|dtaum/gi, 'datum'],
  [/datvoy|daotvy/gi, 'datový'],
  // "rekurze"
  [/rekuzre|rekuzr\b/gi, 'rekurze'],
  // "ulož" — missing háček
  [/\buloz\b/gi, 'ulož'],
  [/\bzapis\b/gi, 'zapiš'],
];

export function normalizeForClassification(text) {
  let normalized = text;
  for (const [pattern, replacement] of TYPO_NORMALIZATIONS) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

// v87: Negation detection — identifies intent types the user explicitly rejects.
// Czech negation: "nechci kód", "nehledej", "žádný build", "neukládej do souboru"
// Returns Set of negated IntentType values.
// Used post-classification: if classifier returns a negated intent → downgrade.
function _detectNegatedIntents(input) {
  const negated = new Set();

  // "nechci X" — explicit rejection of intent category
  if (/nechci\s+(?:kód|code|programov)/i.test(input)) negated.add(IntentType.CODE);
  if (/nechci\s+(?:nápady?|kreativ|brainstorm)/i.test(input)) negated.add(IntentType.CREATIVE);
  if (/nechci\s+(?:report|analýz|zpráv)/i.test(input)) negated.add(IntentType.REPORT);
  if (/nechci\s+(?:návrh|design|architekturu)/i.test(input)) negated.add(IntentType.DESIGN);

  // Negated verbs (ne- prefix on verb stems)
  if (/nehledej|nevyhledávej/i.test(input)) negated.add(IntentType.SEARCH);
  if (/neukládej|nepiš\s+do\s+soubor|nesavuj/i.test(input)) negated.add(IntentType.FILE_WRITE);
  if (/nečti|neotvírej\s+(?:ten\s+)?soubor/i.test(input)) negated.add(IntentType.FILE_READ);
  if (/nespouštěj|nespusť|nerunuj/i.test(input)) negated.add(IntentType.SHELL);
  if (/nestavěj|nebuildi|nebudu\s+(?:to\s+)?stavět/i.test(input)) negated.add(IntentType.BUILD);

  // "žádný X" — explicit exclusion
  if (/žádn[ýáé]\s+(?:build|stavb)/i.test(input)) negated.add(IntentType.BUILD);
  if (/žádn[ýáé]\s+(?:report|analýz|zpráv)/i.test(input)) negated.add(IntentType.REPORT);
  if (/žádn[ýáé]\s+(?:kód|code)/i.test(input)) negated.add(IntentType.CODE);
  if (/žádn[ýáé]\s+(?:design|návrh)/i.test(input)) negated.add(IntentType.DESIGN);

  return negated;
}

const KNOWN_EXTENSIONLESS_FILENAME_RE = /^(readme|makefile|dockerfile|vagrantfile|gemfile|rakefile|procfile|changelog|license|todo|contributing|authors|codeowners)$/i;

// v63.0: Extract file path from user input
// Looks for quoted paths, paths with extensions, or common filename patterns
export function extractFilePath(input) {
  // 0. Project-content queries → return "." for directory listing
  if (/(?:co|jak[ée])\s+(?:je\s+)?(?:sou[cč][áa]st[ií]|v)\s+(?:tohoto\s+|toho\s+)?projekt/i.test(input) ||
      /vypi[sš]\s+(?:mi\s+)?(?:obsah|soubory|adres[áa][rř]|slo[zž]ku)/i.test(input) ||
      /(?:jak[ée]|kter[ée]|co\s+za)\s+soubory\s+(?:jsou\s+)?(?:v|tady|zde)/i.test(input) ||
      /(?:jak[ée]|kter[ée])\s+soubory\s+(?:obsahuje|m[áa])\s+(?:tento\s+|ten\s+|tenhle\s+)?projekt/i.test(input) ||
      /co\s+(?:obsahuje|m[áa])\s+(?:tento\s+|ten\s+|tenhle\s+)?projekt/i.test(input) ||
      /co\s+(?:je\s+)?(?:v|uvnit[rř])\s+(?:tohoto?\s+|toho\s+)?projektu?/i.test(input) ||
      /(?:uka[zž]|zobraz)\s+(?:mi\s+)?(?:strukturu|obsah)\s+projektu/i.test(input) ||
      /struktura\s+projektu/i.test(input) ||
      /(?:what'?s|what\s+is)\s+in\s+(?:the\s+)?project/i.test(input) ||
      /(?:list|show)\s+(?:the\s+)?(?:project\s+)?files/i.test(input)) {
    return '.';
  }

  // 1. Quoted path: "soubor.js", 'config.json'
  const quoted = input.match(/["']([^"']+\.\w{1,10})["']/);
  if (quoted) return quoted[1];

  // 2. Path with extension (last token matching *.ext pattern) or dotfile
  const tokens = input.split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i].replace(/[,;:!?]+$/, ''); // strip trailing punctuation
    if (/^[\w./-]+\.\w{1,10}$/.test(t) && !['mi', 'si', 'ti'].includes(t.toLowerCase())) {
      return t;
    }
    // Dotfile: .env, .gitignore, .bashrc, .env.local (no extension required)
    if (/^\.\w[\w.-]*$/.test(t)) {
      return t;
    }
  }

  // 3. Path after "soubor" / "file" keyword
  const afterKeyword = input.match(/(?:soubor|file)\s+["']?([^\s"']+\.\w{1,10})["']?/i);
  if (afterKeyword) return afterKeyword[1];

  // 3b. Dotfile after keyword: "soubor .env"
  const afterKeywordDotfile = input.match(/(?:soubor|file)\s+["']?(\.[\w.-]+)["']?/i);
  if (afterKeywordDotfile) return afterKeywordDotfile[1];

  // 4. Known filenames without extension (readme, makefile, dockerfile, license, etc.)
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i].replace(/[,;:!?]+$/, '');
    if (KNOWN_EXTENSIONLESS_FILENAME_RE.test(t)) {
      return t;
    }
  }

  // 5. "co je v [name]" pattern — extract name after "v" preposition
  const afterV = input.match(/co\s+(?:je\s+)?v\s+["']?([\w./-]+)["']?\s*[?!.]?\s*$/i);
  if (afterV) {
    const candidate = afterV[1];
    // Only accept if it looks like a file (not a Czech word like "projektu", "adresáři")
    if (!/^(projekt|adres|slo[zž]|tomto|toho|t[ée]to)/.test(candidate)) {
      return candidate;
    }
  }

  return null; // No file path found — handler will ask for clarification
}

// v58.3: Anti-DESIGN exclusions — "navrhni" + these = NOT architecture
const DESIGN_EXCLUSION_PATTERNS = [
  /navrhni\s+.{0,10}(n[áa]pad|n[áa]zv|jm[ée]n|titul)/i,     // "navrhni nápady/názvy"
  /navrhni\s+.{0,10}(p[rř][ií]b[eě]h|poh[áa]dk|bajk)/i,      // "navrhni příběh"
  /navrhni\s+.{0,10}(j[ií]deln|recept|menu)/i,                 // "navrhni jídelníček"
  /navrhni\s+.{0,10}(barv|logo|grafik|design\s+log)/i,         // "navrhni barvy/logo"
  /navrhni\s+.{0,10}(v[ýy]let|cestu|dovolen)/i,                // "navrhni výlet"
  /navrhni\s+.{0,10}(cvi[čc]en|tr[ée]nink|workout)/i,          // "navrhni cvičení"
  /navrhni\s+.{0,10}(dopis|email|zpr[áa]v)/i,                  // "navrhni dopis"
  /navrhni\s+\d+\s+(zp[ůu]sob|tip|n[áa]pad|bod)/i,            // "navrhni 5 způsobů"
];

// v58.0: DESIGN follow-up patterns (keep conversation in DESIGN mode)
export const DESIGN_CONTINUE_PATTERNS = [
  // Refinement requests
  /v[ií]ce\s+(podrobn|detail|inform)/i,
  /podrobn[eě]ji/i,
  /detailn[eě]ji/i,
  /rozd[eě]l\s+to\s+(na|do)\s/i,
  /rozepi[sš]\s+(to|sprint|f[aá]z|krok)/i,
  /rozepsat/i,

  // v58.3: Additional follow-up patterns found by E2E testing
  /rozeber/i,                                  // "rozeber víc datový model"
  /roz[sš]i[rř]/i,                            // "rozšiř datový model"
  /pokra[čc]uj\s+(v\s+)?(n[aá]vrh|design|pl[aá]n)/i,  // "pokračuj v návrhu"
  /pokra[čc]uj\s*$/i,                         // bare "pokračuj"
  /zp[eě]t\s+k\s+n[áa]vrhu/i,                // "zpět k návrhu"
  /jak\s+to\s+bude\s+(s|se)\s/i,              // "jak to bude s autentizací"
  /jak\s+bude\s+fungovat/i,                    // "jak bude fungovat platební systém"
  /(?:a\s+)?co\s+(rate|limit|error|handl|cachin|loggin|monitor|deploy|nasaz|škálov|autentiz|auth|plateb|payment|notifik|search)/i,  // "a co caching?"
  /p[rř]idej\s+(?!.*sprint)/i,                // "přidej caching" (but not "přidej sprint" which is already matched)
  /navrhni\s+.{0,15}(strategi|[rř]e[sš]en)/i,  // "navrhni caching strategii" (within session = CONTINUE)

  // Section-specific drill-down
  /jak\s+.{0,15}(test|deploy|CI|bezpe[cč]|architektur|autentiz|auth|nastav|škálov|nasad)/i,
  /co\s+s\s+.{0,15}(test|deploy|CI|bezpe[cč]|autentiz|auth)/i,
  /(?:a\s+)?co\s+.{0,10}(rizik|alternativ)/i,

  // Summary / wrap-up (still within DESIGN)
  /shr[nň]\s+(cel[ýéy]|n[áa]vrh|projekt|v[sš]e)/i,  // "shrň celý návrh"

  // Requirements / "what do we need" questions
  /jak[ée]\s+.{0,10}(test|testy)\s+(pot[rř]eb|budeme|m[áa]me)/i,  // "jaké testy potřebujeme"
  /jak[ée]\s+.{0,10}(n[áa]stroj|tool)/i,              // "jaké nástroje"
  /co\s+(pot[rř]eb|budeme\s+pot[rř]eb)/i,             // "co potřebujeme"
  /jak[ýy]\s+.{0,10}(test|testing|qa)\s+(framework|strateg)/i,

  // Modification requests
  /zm[eě][nň]\s+.{0,15}(stack|technologi|framework)/i,
  /m[ií]sto\s+.{0,15}(Flutter|React|Kotlin|Swift|Next|Node)/i,
  /pou[zž]ij\s+rad[eě]ji/i,
  /p[rř]idej\s+.{0,15}(sprint|f[aá]zi|krok|sekci)/i,
  /co\s+kdybych\s+.{0,15}(cht[eě]l|pou[zž]il|zm[eě]nil)/i,

  // Continuation / next step
  /dal[sš][ií]\s+(krok|sprint|f[aá]ze)/i,
  /co\s+d[aá]l/i,

  // v58.3-fix: Imperative continuation — "začni s X", "pusť se do X"
  /za[cč]ni\s+(s\s+|od\s+)?(prvn|druh|t[rř]et|[cč]tvrt|\d)/i,           // "začni s první fází"
  /za[cč]ni\s+(s\s+)?(implementac|prerekvizit|p[rř][ií]prav|nastaven)/i, // "začni s prerekvizitami"
  /za[cč]ni\s+(s\s+)?(sprint|f[aá]z[ií]|etap|krok)/i,                    // "začni s sprintem 1"
  /za[cč]ni\s+(to\s+)?(budovat|stav[eě]t|programovat|k[oó]dovat|implementovat)/i, // "začni to budovat"
  /m[uů][zž]e[sš]\s+za[cč][ií]t/i,                                       // "můžeš začít s..."
  /pus[tť]\s+se\s+(do|k)\s/i,                                             // "pusť se do toho"
  /spus[tť]\s+(to|implementac|v[ýy]voj)/i,                                // "spusť to"
  /jdi\s+na\s+(to|sprint|f[aá]z)/i,                                       // "jdi na to"
  /p[rř]ejdi\s+(k|na)\s+(sprint|f[aá]z|implementac|dal[sš])/i,            // "přejdi k implementaci"

  // v58.3-fix: Approval + action — "líbí se mi to, pokračuj/začni/udělej"
  /l[ií]b[ií]\s+se\s+mi/i,                             // "líbí se mi to" (approval = stay in DESIGN)
  /to\s+(je\s+)?(super|skv[eě]l|v[ýy]born|dobr[ée]|ok|fajn|par[aá]da)/i,  // "to je super"
  /dob[rř]e[\s,]+/i,                                   // "dobře, ..." (approval prefix)
  /ok[\s,]+(tak|te[dď]|za[cč]|m[uů][zž]|pokra[cč])/i, // "ok, začni"
  /souhlas[ií]m/i,                                      // "souhlasím"
  /s\s+t[ií]m\s+souhlas/i,                             // "s tím souhlasím"
  /vypad[aá]\s+to\s+(dob[rř]|skv[eě]l)/i,              // "vypadá to dobře"

  // v58.3-fix: Sprint/phase-specific start requests
  /sprint\s+\d/i,                                       // "sprint 1", "sprint 2"
  /f[aá]ze?\s+\d/i,                                    // "fáze 1"
  /prerekvizit/i,                                       // standalone "prerekvizity"

  // EN
  /more\s+detail/i,
  /break.*down/i,
  /what\s+about\s+(the\s+)?(test|deploy|CI|security|database|auth|caching|monitoring|scaling)/i,
  /change\s+.{0,15}(stack|tech|framework)/i,
  /use\s+.{0,15}instead/i,
  /next\s+(step|sprint|phase)/i,
  /continue\s+(the\s+)?(design|plan|draft)/i,
  /go\s+back\s+to\s+(the\s+)?(design|plan)/i,
  /add\s+(caching|monitoring|logging|auth|testing|deployment|ci)/i,
  /how\s+.{0,15}(deploy|scale|test|monitor|authenticate)/i,
  /summarize\s+(the\s+)?(whole|entire|full)?\s*(design|plan|project)/i,
];

// v58.0: Forbidden phrases for DESIGN responses (chatbot hedging)
export const DESIGN_FORBIDDEN_PHRASES = [
  // Generic AI hedging
  'informace jsou omezené',
  'doporučuji konzultovat',
  'záleží na požadavcích',
  'existuje více možností',
  'je třeba zvážit',
  'nemohu přistupovat',
  'nemohu vyhledávat',
  'omezené zdroje',
  'limited information',
  'available information is limited',
  // Chatbot phrases (not architect)
  'pokud potřebujete další informace',
  'pokud máte konkrétní požadavky',
  'neváhejte se zeptat',
  // Polish leaks (Qwen artifact)
  'informacje', 'ograniczone', 'zalecam',
];

const CONVERSATIONAL_PATTERNS = [
  // Standalone acknowledgements — a continuation guard may still reinterpret
  // these when a prior intent exists, but the first-pass classification is
  // deterministic and must not spend a model call on two or three characters.
  /^(?:ok(?:ay)?|dob[rř]e|jasn[eě]|rozum[ií]m)[.!]*$/i,
  /^(?:dobr[ýy]\s+den)[.!]*$/i,
  // Greetings — match even with trailing text ("Ahoj! Jak se mas?")
  /^(ahoj|čau|cau|nazdar|hi|hello|hey)\b/i,
  // Thanks — standalone or with trailing text ("Díky za motivaci!")
  /^(d[ií]ky|d[eě]kuji?|dekuju|thanks|thank you)\b/i,
  // How are you — with/without diacritics
  /jak se m[áa][sš]/i,                       // "jak se máš", "jak se mas"
  /how are you/i,
  // Opinion requests — "co si myslíš/myslis o..."
  /co si mysl[ií][sš]/i,                     // "co si myslíš", "co si myslis"
  /what do you think/i,
  /tvůj názor/i, /tv[uů]j n[aá]zor/i, /your opinion/i,
  // v58.3: Opinion/recommendation/advice requests — LLM can answer directly
  /co\s+bys\s+(doporu[cč]il|porovnal|popsal|vysv[eě]tlil)/i,     // "co bys doporučil", "co bys porovnal"
  /jak\s+bys\s+(porovnal|popsal|vysv[eě]tlil|zhodnotil)/i,       // "jak bys porovnal TypeScript a JS"
  /stoj[ií]\s+za\s+(n[áa]v[sš]t[eě]vu|to|zkus)/i,               // "stojí za návštěvu"

  // v44.8: Follow-up / educational continuation patterns (must NOT trigger SEARCH)
  // These are conversational continuations within an ongoing dialogue
  /vysvětli.*jednoduš/i,                          // "vysvětli jednodušeji"
  /můžeš.*mi.*to.*vysvětlit/i,                    // "můžeš mi to vysvětlit"
  /vysvětlit.*jednodušeji/i,                      // "vysvětlit jednodušeji"
  /^(ještě jednou|znovu|opakuj)/i,                // "ještě jednou", "znovu"
  /můžeš.*to.*(zopakovat|říct znovu)/i,           // "můžeš to zopakovat"
  /^(nechápu|nerozumím|I don'?t understand)/i,    // "nechápu"
  /^(proč|proc)\??$/i,                            // just "proč?"
  /^(jak|how)\??$/i,                              // just "jak?"
  /co to znamená/i, /what does.*mean/i,           // "co to znamená"
  /ještě.*víc/i,                                  // "řekni mi ještě víc"
  /povídej.*dál/i, /pokračuj/i,                   // "povídej dál", "pokračuj"
  /go on/i, /continue/i, /tell me more/i,         // English follow-ups
  /can you explain/i, /explain.*simpler/i,        // English explain patterns
  /^more$/i, /^více$/i,                           // just "more"

  // v44.9: Educational continuation patterns
  /zkus.*to.*vysvětlit/i,                         // "zkus to vysvětlit"
  /na příklad/i, /na příkladu/i,                  // "na příkladu z běžného života"
  /ukaz.*mi/i, /ukaž.*mi/i,                       // "ukaž mi příklad"
  /pořád.*ne(chápu|rozumím)/i,                    // "pořád nechápu"
  /stále.*ne(chápu|rozumím)/i,                    // "stále nerozumím"
  /není.*jasn/i,                                  // "pořád mi není jasný"
  /rozepiš/i,                                     // "rozepiš to"
  /přidej.*k/i,                                   // "přidej ke každému"
  /give.*example/i, /show.*example/i,             // English example patterns
  /still.*understand/i,                           // "I still don't understand"

  // v65→v70: File-write patterns moved to FILE_WRITE_PATTERNS (separate intent)
];

// v44.4 - Patterns for locally-answerable questions (no web search needed)
// v44.7 - Extended with more patterns for deterministic local computation
const LOCAL_DETERMINISTIC_PATTERNS = [
  // Date/time questions
  /kolik\s+(?:(?:je|to)\s+)?(?:hodin|dn[ií]|t[ýy]dn|m[eě]s[ií]c)/i,  // "kolik dní/hodin" (v72: tightened — won't match "kolik kalorií...za hodinu")
  /kdy.*bude.*([úu]pln[eě]k|nov|m[eě]s[ií]c)/i,  // "kdy bude úplněk/uplnek"
  /kdy.*uplnek/i,                         // "kdy bude uplnek" (without diacritics)
  /jak[ýyéae].*(\bden\b|\bdatum\b|\brok\b|m[eě]s[ií]c)/i, // "jaký/jaky je dnes den" (v62.2: \b prevents "kroky"→"rok" false match)
  /dnes.*datum/i,                          // "jaké je dnes datum"
  /kolik[áa]t[ée]ho/i,                    // "kolikátého/kolikateho je"
  /what\s+(is\s+(the\s+)?)?\bday\b/i, /what.*\bdate\b/i, /what.*\btime\b/i,
  // Calendar/astronomy (deterministic calculations)
  /fáze měsíce/i, /moon phase/i,
  /za kolik dn[ií]/i,                     // "za kolik dní/dni bude..."
  /kolik dn[ií] do/i,                     // "kolik dní/dni do vánoc/vanoc"
  /[úu]pln[eě]k/i, /uplnek/i,            // "kdy bude úplněk" direct match
  /nov[ýéě]h?o?\s+měsíc/i,                // "nový měsíc", "nového měsíce" (NOT "novinek za měsíc")
  // v72: EN moon/astronomy patterns — route to LOCAL computation (not LLM)
  /full\s*moon/i,                          // "full moon", "next full moon"
  /new\s*moon/i,                           // "new moon", "when is the new moon"
  /next.*(?:full|new)\s*moon/i,            // "when is the next full moon"
  // Math calculations
  // v62.2: Bare /\d+[+\-*/]\d+/ removed — catches "byt 2+1", "i7-14700K" as math.
  // Standalone math ("5+3") handled by anchored pattern; explicit intent by keywords.
  // v72: EN "days until" patterns (Christmas, etc.)
  /(?:how\s+many\s+)?days?\s+(?:until|till|to)\s+(?:christmas|easter|new\s+year)/i,
  /kolik\s+dn[ií]\s+do\s+(?:váno|vanoc|velikono|nového\s+roku)/i,  // CZ: "kolik dní do vánoc"
  // Math calculations
  /kolik je \d+/i,                                    // "kolik je 5+3"
  /^\s*\d+[\s()]*[+\-*/][\s()]*\d+[\s()=?]*\s*$/,   // ONLY standalone: "5+3", "100/4" (entire input IS the expression)
  /^\s*\d+(?:\s*[+\-*/]\s*\d+){2,}\s*[=?]?\s*$/u, // Standalone integer chains: "10 * 9 * 8"
  /^\s*\d+\s*(?:\*\*|\^)\s*\d+\s*$/,                 // v72: standalone power: "2**10", "2^8"
  /^\s*\d+\s*!\s*$/,                                  // v72: standalone factorial: "5!", "10!"
  /vypočítej/i, /spočítej/i, /vypocitej/i, /spocitej/i, /calculate\s+\d/i,
  // v44.7 FIX 3: Additional LOCAL patterns
  /napi[sš]\s*(mi\s+)?č[ií]slo/i,         // "napiš číslo", "napiš mi číslo"
  /bez\s*odkaz[ůu]/i,                     // "bez odkazů"
  /jen\s*datum/i,                         // "jen datum"
  /pouze\s*datum/i,                       // "pouze datum"
  /rovnou\s*(č[ií]slo|datum|odpov)/i,    // "rovnou číslo", "rovnou odpověď"
  /přímou\s*odpověď/i,                    // "přímou odpověď"
  /kolik\s+(je\s+)?hodin/i,               // "kolik je hodin" (v72: tightened — won't match "za hodinu")
  /current.*time/i, /current.*date/i,    // English variants
];

// v45.0 - ITEM_LOOKUP patterns: queries for specific items/listings with count constraints
// MUST be checked BEFORE REPORT to avoid "4 inzeráty" being treated as report request
const ITEM_LOOKUP_PATTERNS = [
  // Czech patterns for item/listing queries with numbers
  /\d+\s*(inzerát|inzerat|nabíd|nabid|produkt|auto|byt|dům|dum|nemovit|položk|polozk)/i,
  /dej\s*mi\s*\d+/i,                        // "dej mi 4 inzeráty"
  /najdi\s*(mi\s*)?\d+/i,                   // "najdi mi 3 auta", "najdi 5 bytů"
  /vyber\s*(mi\s*)?\d+/i,                   // "vyber 5 nejlepších"
  /uka[zž]\s*(mi\s*)?\d+/i,                  // "ukaž mi 4 nabídky", "ukaz mi 4"
  /seznam\s*\d+/i,                          // "seznam 10 aut"
  /top\s*\d+/i,                             // "top 5 nabídek"
  /\d+\s*nejlep/i,                          // "5 nejlepších"
  // v62.2d: "hledám pronájem/byt/auto" — item lookup without explicit count
  /hled[áa]m\s.{0,20}(pron[áa]jem|byt[ůuy]?|auto|dum|dům|nemovit|pr[áa]c[ie]|nab[ií]dk)/i,
  /\d+\s*nejlevn/i,                         // "3 nejlevnější"
  // English patterns
  /\d+\s*(listing|product|item|car|apartment|house|offer)/i,
  /find\s*(me\s*)?\d+/i,                    // "find me 5 cars"
  /show\s*(me\s*)?\d+/i,                    // "show me 3 listings"
  /get\s*(me\s*)?\d+/i,                     // "get me 4 products"
  /list\s*\d+/i,                            // "list 10 items"
];

// ════════════════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════════════════
// v57.3 — CORRECTION / CONTEXT-PROVIDING PATTERNS
// ════════════════════════════════════════════════════════════════════════════════
// User is correcting or providing context for previous response.
// "dnes je ale 8.2.2026" = user provides date context → should replay previous
// "ne, myslel jsem" = user corrects misunderstanding → clarification
// Must NOT be AMBIGUOUS — it's a continuation of previous intent.
// ════════════════════════════════════════════════════════════════════════════════
const CORRECTION_PATTERNS = [
  // Czech: "ale" + factual statement (correction)
  /(?:^|\s)ale\s+(?:dnes|dneska|teď|ted)\s+(je|jsou|máme|mame)/i,  // "ale dnes je 8.2."
  /(?:^|\s)ale\s+(?:já|ja)\s+(jsem|mám|mam|chci|mysl)/i,           // "ale já jsem myslel..."
  /(?:^|\s)ale\s+(?:to|ten|ta)\s+(je|jsou|byl|bylo|není|neni)/i,    // "ale to je jinak"
  /dnes\s+je\s+(?:ale\s+)?\d/i,                                     // "dnes je 8.2.2026", "dnes je ale 8.2."
  /dneska\s+je\s+(?:ale\s+)?\d/i,                                   // "dneska je 8.2."
  /(?:dnešní|dnesni)\s+datum/i,                                      // "dnešní datum je..."
  /(?:^|\s)ne[, ]\s*(?:myslel|myslela|chtěl|chtěla|měl|to je|to není)/i, // "ne, myslel jsem..."
  /(?:^|\s)špatně[, ]/i,                                             // "špatně, dnes je..."
  /(?:^|\s)spatne[, ]/i,                                             // "spatne" (no diacritics)

  // Date correction patterns
  /dnes\s+(?:je|máme|mame)\s+\d{1,2}\s*\.\s*\d{1,2}/i,             // "dnes je 8.2." or "dnes máme 8.2."
  /(?:aktuální|aktualni|současný|soucasny)\s+datum/i,               // "aktuální datum je..."

  // English
  /(?:^|\s)but\s+today\s+is/i,                                      // "but today is..."
  /(?:^|\s)no[, ]\s*(?:I meant|that'?s wrong|actually)/i,           // "no, I meant..."
  /today'?s\s+date\s+is/i,                                          // "today's date is..."
  /(?:^|\s)wrong[, ]/i,                                              // "wrong, today is..."
  /(?:^|\s)actually[, ]/i,                                           // "actually, it's..."
];

// v56.2 Sprint A — SELF-REFERENCE PATTERNS
// ════════════════════════════════════════════════════════════════════════════════
// Queries about the user's OWN context within the session.
// These should NEVER trigger web search — they refer to conversation state.
// Must be checked BEFORE the question-word catch-all.
// ════════════════════════════════════════════════════════════════════════════════
const SELF_REFERENCE_PATTERNS = [
  // Czech: questions about self / session context
  /jak se jmenuj/i,                   // "Jak se jmenuju?"
  /jaké je moje? jméno/i,            // "Jaké je moje jméno?"
  /kdo jsem/i,                       // "Kdo jsem?"
  /co jsem (ti |)říkal/i,            // "Co jsem ti říkal?"
  /co jsem (ti |)psal/i,             // "Co jsem ti psal?"
  /pamatuj(eš|ete)/i,               // "Pamatuješ si?"
  /co (víš|vís) o mně/i,            // "Co víš o mně?"
  /co o mně víš/i,                   // "Co o mně víš?" (word order variant)
  /co (sis |)zapamatoval/i,          // "Co sis zapamatoval?"
  /znáš m[ěe]/i,                     // "Znáš mě?"
  // Slovak
  /ako sa volám/i,                   // "Ako sa volám?"
  /aké je moje meno/i,              // "Aké je moje meno?"
  /kto som/i,                        // "Kto som?"
  /čo som (ti |)hovoril/i,          // "Čo som ti hovoril?"
  /pamätáš/i,                        // "Pamätáš si?"
  /čo (vieš|viete) o mne/i,         // "Čo vieš o mne?"
  // German
  /wie hei(ß|ss)e ich/i,            // "Wie heiße ich?"
  /wer bin ich/i,                     // "Wer bin ich?"
  /was wei(ß|ss)t du über mich/i,   // "Was weißt du über mich?"
  /erinnerst du dich/i,              // "Erinnerst du dich?"
  /kennst du m(ich|einen namen)/i,   // "Kennst du mich?"
  // Polish
  /jak si[ęe] nazywam/i,             // "Jak się nazywam?"
  /kim jestem/i,                      // "Kim jestem?"
  /co o mnie wiesz/i,               // "Co o mnie wiesz?"
  /pami[ęe]tasz/i,                   // "Pamiętasz?"
  // French
  /comment (?:je )?m'appelle/i,      // "Comment je m'appelle?"
  /qui suis[- ]je/i,                 // "Qui suis-je?"
  /tu te souviens de moi/i,          // "Tu te souviens de moi?"
  // Spanish
  /cómo me llamo/i,                  // "¿Cómo me llamo?"
  /quién soy/i,                      // "¿Quién soy?"
  /qué sabes de m[ií]/i,            // "¿Qué sabes de mí?"
  // English: self-referential queries
  /my name/i,                        // "What is my name?"
  /who am I/i,                       // "Who am I?"
  /what did (I|we) (say|discuss|talk)/i,  // "What did I say?"
  /do you (remember|know) (me|my)/i, // "Do you remember me?"
  /what do you know about me/i,      // "What do you know about me?"
];

// ════════════════════════════════════════════════════════════════════════════════
// v56.2 Sprint A — STATEMENT PATTERNS
// ════════════════════════════════════════════════════════════════════════════════
// Declarative user statements (NOT questions). The user is telling C3 something
// about themselves. Should be CONVERSATIONAL (acknowledge + optionally store).
// Must be checked BEFORE the question-word catch-all.
// ════════════════════════════════════════════════════════════════════════════════
const STATEMENT_PATTERNS = [
  // Czech: self-introduction / personal facts
  /moje? jméno je/i,                 // "Moje jméno je Alice"
  /jmenuj[ui] se /i,                 // "Jmenuju se Bob"
  /bydlím (v|na) /i,                // "Bydlím v Praze"
  /pracuj[ui] (v|jako|na|pro) /i,   // "Pracuju jako developer"
  /studu?j[ui] /i,                   // "Studuju informatiku"
  /mám (rád|ráda?) /i,              // "Mám rád Python"
  /preferuj[ui] /i,                  // "Preferuju tmavý režim"
  // Slovak
  /moje meno je/i,                   // "Moje meno je Alice"
  /volám sa /i,                      // "Volám sa Bob"
  /bývam (v|na) /i,                  // "Bývam v Bratislave"
  /pracujem (v|ako|na|pre) /i,      // "Pracujem ako developer"
  /(š|s)tudujem /i,                  // "Študujem informatiku"
  // German
  /ich hei(ß|ss)e /i,               // "Ich heiße Alice"
  /ich (bin|wohne|arbeite|studiere) /i, // "Ich bin Developer"
  /mein name ist /i,                 // "Mein Name ist Bob"
  /ich bevorzuge /i,                 // "Ich bevorzuge..."
  // Polish
  /nazywam si[ęe] /i,               // "Nazywam się Bob"
  /mieszkam (w|na) /i,              // "Mieszkam w Warszawie"
  /pracuj[ęe] (w|jako|na) /i,      // "Pracuję jako developer"
  /moje imi[ęe] to /i,              // "Moje imię to Alice"
  // French
  /je m'appelle /i,                  // "Je m'appelle Alice"
  /j'habite [àa] /i,                // "J'habite à Paris"
  /je (suis|travaille|étudie) /i,   // "Je suis développeur"
  // Spanish
  /me llamo /i,                      // "Me llamo Alice"
  /vivo en /i,                       // "Vivo en Madrid"
  /soy (un |una )?[A-Z]/,           // "Soy un desarrollador"
  /trabajo (en|como) /i,            // "Trabajo como developer"
  // English: self-introduction / personal facts
  /my name is /i,                    // "My name is Alice"
  /\bI (am|'m) (a |an )?\w/i,           // "I am a developer", "I'm an engineer"
  /I (live|work|study) (in|at|as|for) /i,  // "I live in Prague"
  /I prefer /i,                      // "I prefer dark mode"
];

// ════════════════════════════════════════════════════════════════════════════════
// v56.2 Sprint A — KNOWLEDGE REQUEST PATTERNS
// ════════════════════════════════════════════════════════════════════════════════
// User wants information about a topic but uses imperative/request form instead
// of a question. "Řekni mi o X" = "Tell me about X" = SEARCH, not AMBIGUOUS.
// Must be checked AFTER CONVERSATIONAL but BEFORE catch-all.
// ════════════════════════════════════════════════════════════════════════════════
const KNOWLEDGE_PATTERNS = [
  // Czech: knowledge requests in imperative form
  /řekni mi (o |víc o |něco o )/i,  // "řekni mi o Pythagorovi"
  /pověz mi (o |víc o |něco o )/i,  // "pověz mi o..."
  /popiš (mi )?.{3,}/i,             // "popiš mi Pythagora" (min 3 chars after)
  /informace o .{3,}/i,             // "informace o X"
  /co (víš|vís|víte) o .{3,}/i,    // "co víš o Pythagorovi" (info request, not self-ref)
  // Slovak
  /povedz mi (o |viac o |niečo o )/i,  // "Povedz mi o..."
  /opíš (mi )?.{3,}/i,              // "Opíš mi..."
  /informácie o .{3,}/i,            // "Informácie o X"
  /čo (vieš|viete) o .{3,}/i,      // "Čo vieš o..."
  // German
  /(?:er)?zähl mir (von|über|etwas über) /i, // "Erzähl mir von..."
  /was wei(ß|ss)t du (über|von) .{3,}/i,    // "Was weißt du über..."
  /erkl(ä|ae)r(e|) (mir )?.{3,}/i,  // "Erkläre mir..."
  /beschreib(e|) (mir )?.{3,}/i,    // "Beschreibe mir..."
  /informationen (über|zu) .{3,}/i,  // "Informationen über X"
  // Polish
  /powiedz mi o .{3,}/i,            // "Powiedz mi o..."
  /opowiedz (mi |)o .{3,}/i,       // "Opowiedz mi o..."
  /co wiesz o .{3,}/i,              // "Co wiesz o..."
  /wyja[śs]nij .{3,}/i,             // "Wyjaśnij..."
  // French
  /(?:dis|parle)[- ]moi (de|d') .{3,}/i, // "Dis-moi de..."
  /(?:qu'est-ce que|que sais)[- ]tu (de|sur) /i, // "Que sais-tu de..."
  /explique[- ](moi )?.{3,}/i,      // "Explique-moi..."
  /décris[- ](moi )?.{3,}/i,        // "Décris-moi..."
  // Spanish
  /(?:dime|cuéntame|háblame) (sobre|de|acerca) /i, // "Dime sobre..."
  /explica(me|) .{3,}/i,            // "Explícame..."
  /describe(me|) .{3,}/i,           // "Descríbeme..."
  /qué sabes (de|sobre) .{3,}/i,    // "¿Qué sabes de...?"
  // English: knowledge requests
  /tell me about .{3,}/i,           // "tell me about Pythagoras"
  /tell me (more )?about /i,        // "tell me more about..."
  /give me info(rmation)? (on|about) /i, // "give me info on..."
  /explain .{5,}/i,                  // "explain quantum computing" (min 5 chars)
  /describe .{3,}/i,                 // "describe the process"
];

// ════════════════════════════════════════════════════════════════════════════════
// v57.3 — REFORMULATION PATTERNS
// ════════════════════════════════════════════════════════════════════════════════
// User wants the SAME thing but expressed differently (language switch, retry).
// "zkus to v ceskem jazyce" = repeat previous intent, change language.
// "zkus to znovu" = retry previous action.
// Must be detected BEFORE CRE decide() — replays previous intent.
// ════════════════════════════════════════════════════════════════════════════════
export const REFORMULATION_PATTERNS = [
  // Language switch requests
  /zkus\s+to\s+(v|po)\s+(česk|cesk|češtin|cestin|anglick|angličtin|slovenštin|slovensk|německ|nemeck|polsk|francouzštin|francous|španělštin|spanelštin)/i,
  /(?:odpov[eě]z|řekni|piš|napi[sš])\s+(?:to\s+)?(česky|cesky|anglicky|slovensky|německy|nemecky|polsky|francouzsky|španělsky)/i,
  /(?:to\s+sam[ée]?|totéž|tote[zž])\s+(?:v|po)?\s*(česky|cesky|anglicky|slovensky)/i,
  /v\s+(?:česk[ée]m|cesk[ée]m|anglick[ée]m|slovensk[ée]m|německ[ée]m|nemeck[ée]m)\s+jazyce/i,
  /p[rř]elo[zž]\s+to\s+do\s+/i,                    // "přelož to do češtiny"

  // Retry / redo requests (repeat previous action)
  /zkus\s+to\s+(znovu|znova|je[sš]t[eě])/i,        // "zkus to znovu"
  /zopakuj\s+(to|posledn[ií])/i,                    // "zopakuj to"
  /ud[eě]lej\s+to\s+(znovu|znova|je[sš]t[eě])/i,   // "udelej to znovu"
  /(?:je[sš]t[eě]\s+jednou|once\s+more|try\s+again)/i,
  /(?:repeat|redo|again)\s+(?:in|but)/i,            // EN: "repeat in Czech"
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
    // INVARIANT GUARD: ANSWER only allowed for CONVERSATIONAL or CREATIVE
    // v44.8: CREATIVE intent also uses ANSWER (direct ideation, no tools)
    // ════════════════════════════════════════════════════════════════════════
    // v58.0: DESIGN intent also uses ANSWER (structured synthesis, no tools)
    // v58.1: CODE intent uses ANSWER for imperative+artifact (inline code)
    const ANSWER_ALLOWED_INTENTS = [IntentType.CONVERSATIONAL, IntentType.CREATIVE, IntentType.DESIGN, IntentType.CODE];
    if (type === DecisionType.ANSWER && !ANSWER_ALLOWED_INTENTS.includes(intent)) {
      const error = new Error(
        `ANSWER_NOT_ALLOWED_FOR_INTENT: Cannot create ANSWER decision for intent "${intent}". ` +
        `ANSWER is ONLY allowed for CONVERSATIONAL, CREATIVE, DESIGN, or CODE intent. Use TOOL_CALL or ASK_USER instead.`
      );
      logger.error('CREDecision', 'INVARIANT VIOLATION', {
        type,
        intent,
        reason,
        stack: error.stack?.split('\n').slice(0, 5).join(' <- '),
      });
      throw error;
    }

    // ════════════════════════════════════════════════════════════════════════
    // v44.6 FIX 4: CONVERSATIONAL must NEVER trigger TOOL_CALL
    // ════════════════════════════════════════════════════════════════════════
    // "napiš báseň" should ANSWER directly, not search the web
    // ════════════════════════════════════════════════════════════════════════
    if (type === DecisionType.TOOL_CALL && intent === IntentType.CONVERSATIONAL) {
      const error = new Error(
        `INVALID_DECISION: CONVERSATIONAL intent must NEVER call tools. ` +
        `Got TOOL_CALL for CONVERSATIONAL - this is a bug in decision logic.`
      );
      logger.error('CREDecision', 'INVARIANT VIOLATION: CONVERSATIONAL + TOOL_CALL', {
        type,
        intent,
        tools,
        reason,
        stack: error.stack?.split('\n').slice(0, 5).join(' <- '),
      });
      throw error;
    }

    // ════════════════════════════════════════════════════════════════════════
    // v44.8: CREATIVE must NEVER trigger TOOL_CALL
    // ════════════════════════════════════════════════════════════════════════
    // "vymysli mi kampaň" should ANSWER directly, not search the web
    // CREATIVE is for ideation/brainstorming - pure LLM creativity
    // ════════════════════════════════════════════════════════════════════════
    if (type === DecisionType.TOOL_CALL && intent === IntentType.CREATIVE) {
      const error = new Error(
        `INVALID_DECISION: CREATIVE intent must NEVER call tools. ` +
        `Got TOOL_CALL for CREATIVE - ideation should use ANSWER, not web search.`
      );
      logger.error('CREDecision', 'INVARIANT VIOLATION: CREATIVE + TOOL_CALL', {
        type,
        intent,
        tools,
        reason,
        stack: error.stack?.split('\n').slice(0, 5).join(' <- '),
      });
      throw error;
    }

    // v58.0: DESIGN must NEVER trigger TOOL_CALL
    // ════════════════════════════════════════════════════════════════════════
    // "navrhni architekturu" = structured synthesis from LLM knowledge
    // DESIGN is ANSWER-only — no web search, no scrape
    // ════════════════════════════════════════════════════════════════════════
    if (type === DecisionType.TOOL_CALL && intent === IntentType.DESIGN) {
      const error = new Error(
        `INVALID_DECISION: DESIGN intent must NEVER call tools. ` +
        `Got TOOL_CALL for DESIGN - structured synthesis uses ANSWER, not web search.`
      );
      logger.error('CREDecision', 'INVARIANT VIOLATION: DESIGN + TOOL_CALL', {
        type, intent, tools, reason,
        stack: error.stack?.split('\n').slice(0, 5).join(' <- '),
      });
      throw error;
    }

    // ════════════════════════════════════════════════════════════════════════
    // v44.7 FIX 1: LOCAL must NEVER trigger TOOL_CALL
    // ════════════════════════════════════════════════════════════════════════
    // LOCAL is a TERMINAL decision - direct computation, no tool execution
    // "kdy bude úplněk?" = LOCAL → direct answer, NOT web.search
    // ════════════════════════════════════════════════════════════════════════
    if (type === DecisionType.TOOL_CALL && intent === IntentType.LOCAL) {
      const error = new Error(
        `LOCAL_INTENT_CANNOT_CALL_TOOLS: LOCAL intent must use DecisionType.LOCAL, not TOOL_CALL. ` +
        `LOCAL is deterministic computation - no external tools needed.`
      );
      logger.error('CREDecision', 'INVARIANT VIOLATION: LOCAL + TOOL_CALL', {
        type,
        intent,
        tools,
        reason,
        stack: error.stack?.split('\n').slice(0, 5).join(' <- '),
      });
      throw error;
    }

    // ════════════════════════════════════════════════════════════════════════
    // v55: PLAN decision requires BUILD intent (and vice versa)
    // ════════════════════════════════════════════════════════════════════════
    if (type === DecisionType.PLAN && intent !== IntentType.BUILD) {
      const error = new Error(
        `BUILD_INTENT_REQUIRED: PLAN decision requires BUILD intent, got "${intent}". ` +
        `Only BUILD intent can trigger Planner pipeline handoff.`
      );
      logger.error('CREDecision', 'INVARIANT VIOLATION: PLAN without BUILD', {
        type, intent, reason,
      });
      throw error;
    }
    if (intent === IntentType.BUILD && type !== DecisionType.PLAN) {
      const error = new Error(
        `BUILD_MUST_USE_PLAN: BUILD intent must use PLAN decision, got "${type}". ` +
        `BUILD intent always routes to Planner pipeline.`
      );
      logger.error('CREDecision', 'INVARIANT VIOLATION: BUILD without PLAN', {
        type, intent, reason,
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
      // v44.7 - Include attempts for ASK_USER tracking
      attempts: this.attempts ?? 0,
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
    // v64.0: CRE Gatekeeper audit counters
    this._overrideCount = 0;
    this._interceptCount = 0;
    this._overrideLog = [];   // last N overrides for diagnostics
    this._interceptLog = [];  // last N intercepts for diagnostics
    this._maxLogEntries = 50;
    this._db = null;          // optional DB handle for persistent audit
    // v83: Autonomy — dynamic override threshold
    this._overrideThreshold = 0.85;
  }

  /**
   * Bind a DB prepared statement set for persistent override/intercept logging.
   * Called from server.js after DB init.
   *
   * @param {{ insert: import('better-sqlite3').Statement }} db
   *   db.insert should accept (event_type, source, reason, decision_type,
   *   decision_intent, original_type, original_intent, confidence, metadata,
   *   execution_trace_id, conversation_id, session_id)
   */
  bindAuditDb(db) {
    this._db = db;
  }

  /**
   * v83: Autonomy — set the L2 override confidence threshold.
   * Called by autonomy controller when tuning or restoring from DB.
   * @param {number} value — clamped to [0.5, 1.0] for safety
   */
  setOverrideThreshold(value) {
    if (typeof value !== 'number' || value < 0.5 || value > 1.0) return;
    this._overrideThreshold = value;
  }

  getOverrideThreshold() {
    return this._overrideThreshold;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // v64.0: CRE GATEKEEPER — Single Authority Enforcement
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // RULE: No decision may be created outside of:
  //   1. decide() — normal CRE classification + decision
  //   2. overrideDecision() — explicit, logged override with reason
  //
  // Pre-CRE intercepts (session resume, lifecycle, wizard) that return
  // responses without creating decisions must call logIntercept().
  //
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create an override decision — the ONLY way to create decisions outside decide().
   *
   * Use this when a handler needs to:
   *   - Replace what CRE decided (first-turn override, vague input)
   *   - Create a decision for a replayed intent (reformulation)
   *   - Create a decision for a stateful continuation (design continue)
   *
   * All overrides are logged with reason and source for full audit trail.
   *
   * @param {Object} config
   * @param {string} config.type - DecisionType
   * @param {string} config.intent - IntentType
   * @param {string[]} [config.tools] - Tools array
   * @param {string[]} [config.slots] - Missing info slots
   * @param {string} config.source - Who is overriding (e.g. 'first_turn_override', 'reformulation')
   * @param {string} config.reason - Why the override is needed
   * @param {number} [config.confidence] - Confidence (0-1)
   * @param {Object} [config.originalDecision] - The original CRE decision being overridden (if any)
   * @param {Object} [config.metadata] - Additional metadata
   * @returns {CREDecision}
   */
  overrideDecision({ type, intent, tools = [], slots = [], source, reason, confidence = 0.85, originalDecision = null, metadata = {} }) {
    const decision = new CREDecision({
      type,
      intent,
      tools,
      slots,
      reason,
      confidence,
      metadata: {
        ...metadata,
        override: true,
        overrideSource: source,
        overrideReason: reason,
        originalDecision: originalDecision?.toJSON?.() || originalDecision || null,
      },
    });

    this._logOverride(decision, source, reason, originalDecision);
    return decision;
  }

  /**
   * Log a pre-CRE intercept — when a handler bypasses CRE entirely.
   *
   * Use this for stateful intercepts where the system is in a known state
   * (active wizard, active lifecycle, session resume) and returns a response
   * without creating a CRE decision.
   *
   * @param {string} source - Intercept source (e.g. 'session_resume', 'lifecycle_handoff')
   * @param {string} reason - Why CRE was bypassed
   * @param {Object} [metadata] - Additional context
   */
  logIntercept(source, reason, metadata = {}) {
    this._interceptCount++;
    const entry = {
      source,
      reason,
      timestamp: Date.now(),
      ...metadata,
    };

    this._interceptLog.push(entry);
    if (this._interceptLog.length > this._maxLogEntries) {
      this._interceptLog.shift();
    }

    logger.info('CRE:Intercept', `Pre-CRE intercept: ${source}`, {
      reason,
      source,
      ...metadata,
    });

    // Persist to DB if available
    if (this._db?.insert) {
      try {
        this._db.insert.run(
          'intercept',
          source,
          reason,
          null,  // decision_type
          null,  // decision_intent
          null,  // original_type
          null,  // original_intent
          null,  // confidence
          JSON.stringify(metadata),
          metadata.executionTraceId || null,
          metadata.conversationId || null,
          metadata.sessionId || null,
        );
      } catch (err) {
        logger.debug('CRE:Intercept', `DB persist failed: ${err.message}`);
      }
    }
  }

  /**
   * Get CRE Gatekeeper audit stats.
   * @returns {{ overrideCount: number, interceptCount: number, recentOverrides: Object[], recentIntercepts: Object[] }}
   */
  getAuditStats() {
    return {
      overrideCount: this._overrideCount,
      interceptCount: this._interceptCount,
      recentOverrides: [...this._overrideLog],
      recentIntercepts: [...this._interceptLog],
    };
  }

  /** @private */
  _logOverride(decision, source, reason, originalDecision) {
    this._overrideCount++;
    const entry = {
      type: decision.type,
      intent: decision.intent,
      source,
      reason,
      originalIntent: originalDecision?.intent || null,
      originalType: originalDecision?.type || null,
      timestamp: Date.now(),
    };

    this._overrideLog.push(entry);
    if (this._overrideLog.length > this._maxLogEntries) {
      this._overrideLog.shift();
    }

    logger.info('CRE:Override', `Decision override: ${source}`, entry);

    // Persist to DB if available
    if (this._db?.insert) {
      try {
        this._db.insert.run(
          'override',
          source,
          reason,
          decision.type,
          decision.intent,
          originalDecision?.type || null,
          originalDecision?.intent || null,
          decision.confidence,
          JSON.stringify(decision.metadata || {}),
          decision.metadata?.executionTraceId || null,
          decision.metadata?.conversationId || null,
          decision.metadata?.sessionId || null,
        );
      } catch (err) {
        logger.debug('CRE:Override', `DB persist failed: ${err.message}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // v71.0 → v71.1: LLM-ASSISTED STRUCTURED INTENT CLASSIFICATION
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Hybrid model: LLM returns structured JSON intent classification.
  // Replaces regex pattern matching for action intents (FILE_WRITE, SHELL, etc.)
  //
  // Flow:
  //   1. Deterministic fast-path (LOCAL, gratitude) — no LLM needed
  //   2. LLM structured classification — primary classifier
  //   3. Deterministic guard layer — validates/downgrades LLM decision
  //   4. Regex classifyIntent() — fallback if LLM fails/unavailable
  //
  // SECURITY INVARIANTS (v71.1):
  //   - LLM NEVER generates shell commands (shellCommand removed from schema)
  //   - Shell commands are extracted by deterministic extractShellCommand()
  //   - LLM-suggested fileTarget is validated by deterministic guards
  //   - FILE_WRITE without fileTarget → downgrade to CONVERSATIONAL
  //   - Path traversal in fileTarget → reject, fallback to regex
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * LLM-based structured intent classifier.
   * Asks the LLM to semantically classify user input into an intent category
   * and extract structured metadata (file targets only — NO shell commands).
   *
   * Uses an explicit FAST override when configured, otherwise the CHAT model.
   *
   * @param {string} input - User message
   * @param {Object} context - Conversation context (history, project, session)
   * @returns {Promise<{intent: string, confidence: number, fileTarget?: string} | null>}
   *          Parsed classification or null on failure
   */
  async _llmClassifyIntent(input, context = {}) {
    const VALID_INTENTS = Object.values(IntentType);

    // v72: Conversation context REMOVED from classification prompt.
    // Intent is a property of the CURRENT message, not conversation history.
    // Anaphoric references ("udělej to znovu") are handled by continuity layer.
    // This saves ~200-400 input tokens → measurable latency reduction.

    // v71.1: shellCommand REMOVED from schema — LLM must NOT generate commands.
    // Shell command extraction stays in deterministic extractShellCommand().
    // v72: Optimized classification prompt — ~40% fewer tokens than v71.
    // Removed: examples in parentheses, verbose rule descriptions, JSON template.
    // Kept: intent list, critical disambiguation rules, security constraint.
    // v84: Project context hint — when active project exists, LLM knows
    // "z projektu"/"v projektu"/"z folderu" references project files, not LLM knowledge.
    const hasProject = context.hasActiveProject || context.project?.id;
    const projectHint = hasProject
      ? `\n- Uživatel má AKTIVNÍ PROJEKT. "z projektu"/"v projektu"/"z tohoto folderu"/"ze složky" = soubory projektu. Analyzuj/shrň/vysvětli obsah KONKRÉTNÍHO SOUBORU → FILE_EXPLAIN (musí uvést název souboru nebo cestu). Přečti/projdi/zobraz/výtah soubor → FILE_READ. Obecné otázky o projektu ("co jsme udělali", "shrň práci", "jaký je stav") → CONVERSATIONAL. FILE_EXPLAIN jen když je uveden konkrétní soubor.`
      : '';

    // v87: Expertise context — LLM knows active domain for better disambiguation.
    // Skip for creativeLock expertises — GUARD 6 in decide() handles those.
    // Adding the hint for creative expertises makes LLM avoid SEARCH (picks CONVERSATIONAL),
    // which bypasses GUARD 6's SEARCH→CREATIVE override.
    const _exp = context.expertise;
    const expertiseHint = (_exp && !_exp.creativeLock)
      ? `\n- Aktivní expertíza: ${_exp.id} (${_exp.outputBias || 'neutral'}). Při nejednoznačnosti preferuj CONVERSATIONAL interpretaci.`
      : '';

    const systemPrompt = `Klasifikuj záměr uživatele. Vrať JSON: {"intent":"X","confidence":0.9,"fileTarget":null}

ZÁMĚRY:
FILE_WRITE: uložit/zapsat do souboru
FILE_READ: přečíst/otevřít soubor
FILE_EXPLAIN: vysvětlit obsah souboru
SHELL: spustit terminálový příkaz
SEARCH: hledat aktuální info na internetu
REPORT: analýza/report vyžadující data
CODE: generování/pomoc s kódem
CONVERSATIONAL: chat, pozdravy, názory, vysvětlení
CREATIVE: brainstorming, nápady, kreativní psaní, itinerář, jídelníček, tréninkový plán
DESIGN: SOFTWAROVÁ architektura, technická roadmapa, plánování IT projektu
BUILD: vícekrokový projekt
LOCAL: datum/čas/matematika
SKILL: spustit naučenou proceduru/recept/skill (existující definovaný postup)
AMBIGUOUS: nejasný záměr

PRAVIDLA:
- "ulož/zapiš/hoď to do souboru" → FILE_WRITE
- "napiš kód" → CODE (ne FILE_WRITE)
- Soubor jako cíl → extrahuj do fileTarget (POUZE název, bez cest)
- Český "rust" = růst → CONVERSATIONAL/SEARCH, ne CODE
- DESIGN = POUZE softwarová architektura/IT projekty. Itinerář, jídelníček, tréninkový plán, výlet → CREATIVE, ne DESIGN
- "spusť skill/recept/proceduru X" → SKILL. "vytvořit/přidat expertizu" → SKILL. SKILL = spuštění existujícího postupu nebo vytvoření nové expertizy${projectHint}${expertiseHint}`;

    // v72: No conversation context — classify current message only
    const userPrompt = input;
    const classificationNumCtx = classifierNumCtxOverride();

    try {
      const result = await llmClassify(userPrompt, systemPrompt, {
        sessionId: context.sessionId || `cre-classify-${Date.now()}`,
        // v71.1: Use FAST model if available, otherwise CHAT (qwen3.5:27b).
        // Set C3_MODEL_FAST env var to use a dedicated classification model.
        model: config.models?.FAST || config.models?.CHAT,
        format: 'json',
        temperature: 0.1,
        // v72: maxTokens 150→80 (actual output ~30-40 tokens without reasoning)
        maxTokens: 80,
        // A dedicated FAST artifact needs <500 prompt tokens and can keep a
        // compact runner. A shared CHAT artifact must retain one runner shape.
        ...(classificationNumCtx === null ? {} : { num_ctx: classificationNumCtx }),
        signal: context.signal,
      });

      if (!result?.content) {
        logger.warn('CRE:LLM', 'LLM classifier returned empty response');
        return null;
      }

      const parsed = extractJSON(result.content);
      if (!parsed || !parsed.intent) {
        logger.warn('CRE:LLM', 'LLM classifier returned invalid JSON', {
          raw: result.content.substring(0, 200),
        });
        return null;
      }

      // Validate intent is a known type
      if (!VALID_INTENTS.includes(parsed.intent)) {
        logger.warn('CRE:LLM', `LLM returned unknown intent: ${parsed.intent}`);
        return null;
      }

      // Normalize confidence
      parsed.confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));

      // ════════════════════════════════════════════════════════════════════
      // v71.1: DETERMINISTIC GUARD LAYER — validates LLM output
      // LLM proposes, system disposes. Never trust LLM blindly.
      // ════════════════════════════════════════════════════════════════════

      // GUARD 1: Strip shellCommand — LLM must NOT generate commands
      delete parsed.shellCommand;

      // GUARD 2: FILE_WRITE requires fileTarget OR recognizable write intent
      if (parsed.intent === IntentType.FILE_WRITE) {
        // Sanitize fileTarget — reject path traversal
        if (parsed.fileTarget) {
          if (/\.\./.test(parsed.fileTarget) ||
              /^\//.test(parsed.fileTarget) ||
              /[/\\]etc[/\\]/.test(parsed.fileTarget)) {
            logger.warn('CRE:LLM:Guard', `PATH TRAVERSAL in fileTarget: ${parsed.fileTarget}`, {
              input: input.substring(0, 60),
            });
            parsed.fileTarget = null;
          }
        }
      }

      // GUARD 3: SHELL must NOT have high confidence for ambiguous inputs
      // (deterministic extractShellCommand will handle the actual command)
      if (parsed.intent === IntentType.SHELL && parsed.confidence > 0.95) {
        // Cap SHELL confidence — extractShellCommand does the real work
        parsed.confidence = 0.9;
      }

      // GUARD 4: SKILL requires feature flag
      if (parsed.intent === IntentType.SKILL && !featureManager.isEnabled('skills')) {
        logger.info('CRE:LLM:Guard', 'SKILL downgrade → CONVERSATIONAL (feature disabled)');
        parsed.intent = IntentType.CONVERSATIONAL;
      }

      // GUARD 5: DESIGN requires deterministic pattern confirmation.
      // v72: LLM over-classifies as DESIGN — "itinerary", "meal plan", "start a company"
      // all get DESIGN because LLM sees "plan". But DESIGN = software architecture only.
      // Solution: LLM proposes DESIGN → verify with DESIGN_PATTERNS. No match → CREATIVE.
      if (parsed.intent === IntentType.DESIGN) {
        const hasDesignPattern = DESIGN_PATTERNS.some(p => p.test(input)) &&
                                 !DESIGN_EXCLUSION_PATTERNS.some(p => p.test(input));
        if (!hasDesignPattern) {
          logger.info('CRE:LLM:Guard', `DESIGN downgrade → CREATIVE (no deterministic pattern match)`, {
            input: input.substring(0, 60),
          });
          parsed.intent = IntentType.CREATIVE;
        }
      }

      // GUARD 7: BUILD false-positive correction for non-software plans.
      // v87: LLM over-classifies personal plans as BUILD — "navrhni plán na zlepšení"
      // gets BUILD because LLM sees "plan" + "3 steps". But BUILD = software build/deploy.
      // Strategy: If LLM says BUILD but a MORE SPECIFIC pattern (DESIGN) positively matches,
      // override to that. Don't downgrade when no pattern matches — trust LLM for
      // legitimate BUILD requests that regex doesn't cover ("zacni s buildem").
      if (parsed.intent === IntentType.BUILD) {
        const hasBuildPattern = BUILD_PATTERNS.some(p => p.test(input));
        if (!hasBuildPattern) {
          const textNorm = normalizeForClassification(input);
          const hasDesignPattern = DESIGN_PATTERNS.some(p => p.test(textNorm)) &&
            !DESIGN_EXCLUSION_PATTERNS.some(p => p.test(textNorm));
          if (hasDesignPattern) {
            // Input matches DESIGN patterns (navrhni plán/roadmapu/architekturu)
            // → it's about planning/design, not building. DESIGN is the correct intent.
            parsed.intent = IntentType.DESIGN;
            logger.info('CRE:LLM:Guard', `BUILD downgrade → DESIGN (DESIGN pattern match overrides LLM BUILD)`, {
              input: input.substring(0, 60),
            });
          } else if (
            // v101: Discussion-before-build signal → downgrade confidence, NOT intent.
            // Final decision made by GUARD 10 in decide(), not here.
            (DISCUSSION_VERBS.test(input) && SEQUENCE_MARKERS.test(input)) ||
            CONDITIONAL_BUILD.test(input) ||
            IMPLICIT_DISCUSSION_FIRST.test(input)
          ) {
            parsed.confidence *= 0.6;
            logger.info('CRE:LLM:Guard', `BUILD confidence downgrade (discussion-before-build signal)`, {
              input: input.substring(0, 60),
              newConfidence: parsed.confidence,
            });
          }
          // Otherwise: no BUILD pattern AND no DESIGN pattern → trust LLM.
          // Many BUILD requests don't match regex ("zacni s buildem", "prepni do build modu").
        }
      }

      logger.info('CRE:LLM', `LLM classified intent: ${parsed.intent} (${parsed.confidence})`, {
        input: input.substring(0, 60),
        intent: parsed.intent,
        confidence: parsed.confidence,
        fileTarget: parsed.fileTarget || null,
        durationMs: result.duration || null,
        // v72: Token metrics from Ollama — key for latency analysis
        promptTokens: result.promptEvalCount || null,
        outputTokens: result.evalCount || null,
      });

      return parsed;
    } catch (err) {
      if (context.signal?.aborted) {
        throwIfAborted(context.signal);
      }
      logger.warn('CRE:LLM', `LLM intent classification failed: ${err.message}`, {
        input: input.substring(0, 60),
      });
      return null;
    }
  }

  /**
   * v71.1: Validate LLM classification result — required fields + sanity checks.
   * Action intents need more than just confidence — they need valid metadata.
   *
   * @param {Object} llmResult - Parsed LLM classification
   * @param {string} input - Original user input (for fallback extraction)
   * @returns {boolean} true if LLM result is trustworthy
   */
  _validateLLMResult(llmResult, input) {
    if (!llmResult || !llmResult.intent) return false;

    const { intent, fileTarget } = llmResult;

    // FILE_WRITE: needs fileTarget OR extractable path from input
    if (intent === IntentType.FILE_WRITE) {
      const hasTarget = fileTarget || extractWriteFilePath(input);
      if (!hasTarget) {
        // No target at all — but user might say "ulož to do souboru" (auto-generate)
        // Only reject if the input doesn't even mention saving
        const hasSaveSignal = /ulo[žz]|uloz|zapi[šs]|napi[šs]|save|write|hod[ˇ']?\s/i.test(input);
        if (!hasSaveSignal) {
          logger.info('CRE:LLM:Validate', 'FILE_WRITE rejected — no target and no save signal', {
            input: input.substring(0, 60),
          });
          return false;
        }
      }
    }

    // SHELL: deterministic extractShellCommand must find something
    if (intent === IntentType.SHELL) {
      const command = extractShellCommand(input);
      if (!command || command === input.trim()) {
        // extractShellCommand couldn't extract a meaningful command
        // Still allow if confidence is very high — LLM might understand context
        if (llmResult.confidence < 0.85) {
          logger.info('CRE:LLM:Validate', 'SHELL rejected — no extractable command and low confidence', {
            input: input.substring(0, 60),
          });
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Classify the intent of user input (REGEX FALLBACK)
   * @param {string} input - User message
   * @returns {IntentType}
   *
   * v71.0: This is now the FALLBACK classifier. Primary is _llmClassifyIntent().
   *
   * v44.6 FIX 3: Priority order is CRITICAL:
   * 1. LOCAL (absolute priority - deterministic, no external API)
   * 2. CONVERSATIONAL (direct response allowed)
   * 3. CODE (requires project context)
   * 4. REPORT (always TOOL_CALL)
   * 5. FACTUAL (always TOOL_CALL)
   * 6. SEARCH (always TOOL_CALL)
   */
  classifyIntent(input) {
    const text = input.trim();

    // v58.3: Typo-tolerant normalization for CLASSIFICATION ONLY
    // This normalized text is used for pattern matching, NOT for LLM input.
    // Handles: missing diacritics (already covered by patterns), common swaps,
    // missing/extra letters in key Czech tech vocabulary.
    const textNorm = normalizeForClassification(text);

    // ════════════════════════════════════════════════════════════════════════
    // v44.6 FIX 3: LOCAL INTENT HAS ABSOLUTE PRIORITY
    // ════════════════════════════════════════════════════════════════════════
    // "kdy bude úplněk?" MUST be LOCAL, not SEARCH
    // These are deterministic calculations - no external API needed
    // ════════════════════════════════════════════════════════════════════════
    if (LOCAL_DETERMINISTIC_PATTERNS.some(p => p.test(textNorm))) {
      return IntentType.LOCAL;
    }

    // ════════════════════════════════════════════════════════════════════════
    // Q2: Gratitude/farewell → CONVERSATIONAL (before SEARCH catches it)
    // "Thanks for the tips!" must NOT trigger SEARCH
    // ════════════════════════════════════════════════════════════════════════
    if (isGratitudeOrFarewell(text)) {
      return IntentType.CONVERSATIONAL;
    }

    // ════════════════════════════════════════════════════════════════════════
    // v94: CODE_ANALYSIS — MUST be BEFORE FILE_EXPLAIN
    // "analyzuj kód" = code analysis (project-wide), NOT file-explain
    // "analyzuj soubor X.js" = file-explain (specific file) — falls through
    // ════════════════════════════════════════════════════════════════════════
    if (CODE_ANALYSIS_PATTERNS.some(p => p.test(text))) {
      return IntentType.CODE_ANALYSIS;
    }

    // ════════════════════════════════════════════════════════════════════════
    // v63.0: FILE_EXPLAIN → FILE_EXPLAIN (before CODE catches "explain code")
    // "vysvětli soubor X", "co dělá tento soubor?" → FILE_EXPLAIN
    // Must be BEFORE FILE_READ (more specific) and before CODE
    // ════════════════════════════════════════════════════════════════════════
    if (FILE_EXPLAIN_PATTERNS.some(p => p.test(text))) {
      return IntentType.FILE_EXPLAIN;
    }

    // ════════════════════════════════════════════════════════════════════════
    // v63.0: FILE_READ → FILE_READ (before CODE and SEARCH)
    // "otevři soubor", "přečti config.json", "ukaž mi obsah"
    // ════════════════════════════════════════════════════════════════════════
    if (FILE_READ_PATTERNS.some(p => p.test(text))) {
      return IntentType.FILE_READ;
    }

    // ════════════════════════════════════════════════════════════════════════
    // Q3: Code requests → CODE (before SEARCH catches "Write me...")
    // "Write me a simple HTTP server in Node.js" → CODE, not SEARCH
    // ════════════════════════════════════════════════════════════════════════
    if (isCodeRequest(text)) {
      return IntentType.CODE;
    }

    // ════════════════════════════════════════════════════════════════════════
    // v44.6 FIX 4: CONVERSATIONAL - must detect BEFORE SEARCH
    // ════════════════════════════════════════════════════════════════════════
    // "napiš báseň", "napiš mi příběh" = CONVERSATIONAL (creative writing)
    // This MUST return ANSWER, never TOOL_CALL
    // ════════════════════════════════════════════════════════════════════════
    if (CONVERSATIONAL_PATTERNS.some(p => p.test(text))) {
      return IntentType.CONVERSATIONAL;
    }

    // Additional creative writing patterns (v44.6 → v44.10: now CREATIVE)
    // v44.10 FIX: Creative writing requests should use CREATIVE intent, not CONVERSATIONAL
    // "napiš báseň" = wants creative content, should get expert writer treatment
    if (/napiš.*(báseň|příběh|pohádku|text|esej|dopis)/i.test(text) ||
        /write.*(poem|story|tale|essay|letter)/i.test(text) ||
        /vytvoř.*(báseň|příběh|text)/i.test(text)) {
      return IntentType.CREATIVE;
    }

    // v88: SKILL — "vytvořit expertizu", "spusť skill" → SKILL
    // MUST be BEFORE DESIGN — "chci vytvořit expertizu na mobilní" matches DESIGN
    // patterns too (because of "mobilní"). SKILL is more specific.
    // ════════════════════════════════════════════════════════════════════════
    if (SKILL_PATTERNS.some(p => p.test(text))) {
      return IntentType.SKILL;
    }

    // v58.0: DESIGN — structured synthesis (architecture, roadmap, plan)
    // MUST be BEFORE CREATIVE_IDEATION — "navrhni architekturu" is DESIGN,
    // not CREATIVE. DESIGN patterns are more specific (require tech nouns).
    // Generic "navrhni" falls through to CREATIVE.
    // ════════════════════════════════════════════════════════════════════════
    // v58.3: DESIGN_EXCLUSION — "navrhni nápady/příběh/jídelníček" = NOT architecture
    if (DESIGN_PATTERNS.some(p => p.test(textNorm)) &&
        !DESIGN_EXCLUSION_PATTERNS.some(p => p.test(textNorm))) {
      // v126: If DESIGN matches AND the same request explicitly asks for
      // implementation, escalate to BUILD. Project-only requests such as
      // "chci vytvořit mobilní aplikaci" stay DESIGN until GUARD 11 proves
      // that project context is active.
      if (DESIGN_BUILD_HYBRID.some(p => p.test(textNorm))) {
        return IntentType.BUILD;
      }
      return IntentType.DESIGN;
    }

    // ════════════════════════════════════════════════════════════════════════
    // v44.8 FIX: CREATIVE/IDEATION - MUST be before SEARCH!
    // ════════════════════════════════════════════════════════════════════════
    // "vymyslet kampaň", "dej mi nápady", "navrhni příběh"
    // These want IDEAS, not web search results!
    // ════════════════════════════════════════════════════════════════════════
    if (CREATIVE_IDEATION_PATTERNS.some(p => p.test(text))) {
      return IntentType.CREATIVE;
    }

    // ════════════════════════════════════════════════════════════════════════
    // v71: FILE_WRITE — REGEX FALLBACK (primary is LLM in decide())
    // Only reached when LLM classifier fails or returns low confidence.
    // ════════════════════════════════════════════════════════════════════════
    if (FILE_WRITE_PATTERNS.some(p => p.test(text))) {
      return IntentType.FILE_WRITE;
    }

    // ════════════════════════════════════════════════════════════════════════
    // v65.0: SHELL — user wants to execute a terminal command
    // v128: "spusť build" now excluded by negative lookahead → falls to BUILD
    // ════════════════════════════════════════════════════════════════════════
    if (SHELL_COMMAND_PATTERNS.some(p => p.test(text))) {
      return IntentType.SHELL;
    }

    // ════════════════════════════════════════════════════════════════════════
    // BUILD — project-level goals (→ Planner pipeline, NOT Chat)
    // MUST be before CODE — "postav mi API" is BUILD, not CODE
    // ════════════════════════════════════════════════════════════════════════
    if (BUILD_PATTERNS.some(p => p.test(text))) {
      return IntentType.BUILD;
    }

    // CODE patterns
    if (CODE_PATTERNS.some(p => p.test(text))) {
      return IntentType.CODE;
    }

    // ════════════════════════════════════════════════════════════════════════
    // v45.0: ITEM_LOOKUP - MUST be BEFORE REPORT!
    // ════════════════════════════════════════════════════════════════════════
    // "dej mi 4 inzeráty na auta" = wants specific items, NOT a report
    // The user expects N concrete listings with links, not a synthesis
    // ════════════════════════════════════════════════════════════════════════
    if (ITEM_LOOKUP_PATTERNS.some(p => p.test(text))) {
      return IntentType.ITEM_LOOKUP;
    }

    // ════════════════════════════════════════════════════════════════════════
    // v57.3: SELF-REFERENCE and STATEMENTS must be BEFORE SEARCH_PATTERNS
    // ════════════════════════════════════════════════════════════════════════
    // "what is my name" has "what is" → SEARCH_PATTERNS would catch it
    // "I am a developer" would fall through to AMBIGUOUS
    // Both must be intercepted FIRST.
    // ════════════════════════════════════════════════════════════════════════
    if (SELF_REFERENCE_PATTERNS.some(p => p.test(text))) {
      return IntentType.CONVERSATIONAL;
    }
    if (STATEMENT_PATTERNS.some(p => p.test(text))) {
      return IntentType.CONVERSATIONAL;
    }

    // REPORT patterns
    // v65: FreshDataSignal guard — bare analysis/summary/comparison keywords
    // without fresh-data context are knowledge requests, not web reports.
    if (REPORT_PATTERNS.some(p => p.test(text))) {
      if (REPORT_SOFT_KEYWORDS.test(text) && !REPORT_FRESH_CONTEXT.test(text)) {
        logger.info('CRE', 'REPORT soft-keyword without fresh-data context — falling through to KNOWLEDGE', {
          input: text.substring(0, 80),
        });
        // Fall through — let KNOWLEDGE_EXPLANATION_PATTERNS or catch-all handle it
      } else {
        return IntentType.REPORT;
      }
    }

    // FACTUAL patterns
    if (FACTUAL_PATTERNS.some(p => p.test(text))) {
      return IntentType.FACTUAL;
    }

    // SEARCH patterns (v58.1: narrowed — "co je" only with fresh-data modifiers)
    if (SEARCH_PATTERNS.some(p => p.test(text))) {
      return IntentType.SEARCH;
    }

    // v58.1: KNOWLEDGE / EXPLANATION — "co je X", "vysvětli Y", "jak funguje Z"
    // MUST be AFTER SEARCH! SEARCH now only catches "co je + fresh-data".
    // Remaining "co je neuronová síť" (no fresh-data modifier) → LLM knowledge.
    // ════════════════════════════════════════════════════════════════════════
    if (KNOWLEDGE_EXPLANATION_PATTERNS.some(p => p.test(text))) {
      return IntentType.CONVERSATIONAL;
    }

    // ════════════════════════════════════════════════════════════════════════
    // v57.3: CORRECTION / CONTEXT → CONVERSATIONAL
    // ════════════════════════════════════════════════════════════════════════
    // "dnes je ale 8.2.2026" = user providing context/correction.
    // Should NOT be AMBIGUOUS. Route to CONVERSATIONAL so handler can
    // detect it as a continuation of previous intent.
    // ════════════════════════════════════════════════════════════════════════
    if (CORRECTION_PATTERNS.some(p => p.test(text))) {
      return IntentType.CONVERSATIONAL;
    }

    // ════════════════════════════════════════════════════════════════════════
    // v56.2 Sprint A: SELF-REFERENCE → CONVERSATIONAL
    // v57.3: MOVED to before SEARCH_PATTERNS (see above)
    // ════════════════════════════════════════════════════════════════════════

    // ════════════════════════════════════════════════════════════════════════
    // v56.2 Sprint A: STATEMENTS → CONVERSATIONAL
    // v57.3: MOVED to before SEARCH_PATTERNS (see above)
    // ════════════════════════════════════════════════════════════════════════

    // ════════════════════════════════════════════════════════════════════════
    // v56.2 Sprint A: KNOWLEDGE REQUESTS → SEARCH
    // ════════════════════════════════════════════════════════════════════════
    // "Řekni mi o Pythagorovi" "Tell me about X" "Popiš mi Y"
    // Imperative knowledge requests — user wants info, not conversation.
    // MUST be BEFORE catch-all (otherwise falls to AMBIGUOUS).
    // ════════════════════════════════════════════════════════════════════════
    if (KNOWLEDGE_PATTERNS.some(p => p.test(text))) {
      return IntentType.SEARCH;
    }

    // ════════════════════════════════════════════════════════════════════════
    // v58.3: RESTRUCTURED question-word catch-all
    // ════════════════════════════════════════════════════════════════════════
    // BEFORE v58.3: All compound question forms → SEARCH (massive false positive rate)
    //   "jak se jmenuje hlavní město Francie" → SEARCH (LLM knows this)
    //   "kolik planet má sluneční soustava" → SEARCH (LLM knows this)
    //
    // NOW: Question form + FRESH_DATA_SIGNAL → SEARCH
    //      Question form WITHOUT fresh signal → CONVERSATIONAL (LLM knowledge)
    //
    // FRESH_DATA_SIGNALS: keywords indicating the answer changes over time
    // (prices, versions, weather, news, current status, live scores)
    // ════════════════════════════════════════════════════════════════════════

    // Tier 1: Compound info-seeking phrases (CZ/SK/DE/PL/FR/ES/EN)
    // NOTE: Cannot use \b with non-ASCII chars (č, ľ, ó, ñ, é etc. are \W in JS).
    //       Use (?:^|\s) for start boundary and (?:\s|[?!.,;]|$) for end.
    const hasCompoundQuestionForm =
    // CZ (ASCII-safe subset can use \b)
        /\b(co je|co jsou|co to je|kdo je|kdo byl|kde je|kde jsou|kdy bude|kdy je|kdy byl|jak funguje|jak fungují|jak se dělá|jak se tvoří|jak vzniká)\b/i.test(text) ||
        // v65.5: CZ declensions of "co" — locative "o čem", dative "čemu", instrumental "čím"
        /(?:^|\s)(o\s+[čc][eě]m\s+je|o\s+[čc][eě]m\s+jsou|[čc][eě]mu\s+se|[čc][ií]m\s+se)(?:\s|[?!.,;]|$)/i.test(text) ||
        /(?:^|\s)(proč je|proč jsou|proč se)(?:\s|[?!.,;]|$)/i.test(text) ||
        /(?:^|\s)(jak[áéý] je|jak[áéý] jsou|jak[áéý] byl[aoy]?|kolik je|kolik má|kolik stojí)(?:\s|[?!.,;]|$)/i.test(text) ||
    // SK (ľ, č, ý, ô etc. — must avoid \b)
        /(?:^|\s)(čo je|čo sú|kto je|kto bol|kde je|kedy je|kedy bol|ako funguje|prečo je|prečo sú|koľko je|koľko má|koľko stojí|aký je|aká je|aké je|aké sú)(?:\s|[?!.,;]|$)/i.test(text) ||
    // DE (ß, ü, ä, ö — mostly ASCII-safe but be consistent)
        /(?:^|\s)(was ist|was sind|was war|wer ist|wer war|wo ist|wo sind|wann ist|wann war|wie funktioniert|warum ist|warum sind|wie viel|wie viele|welche[rs]? ist)(?:\s|[?!.,;]|$)/i.test(text) ||
    // PL (ł, ę, ś, ź, ż, ó — must avoid \b)
        /(?:^|\s)(co to jest|co to są|kto to jest|kto był|gdzie jest|kiedy jest|kiedy był|jak działa|dlaczego jest|ile jest|ile ma|ile kosztuje|jaki jest|jaka jest|jakie jest|jakie są)(?:\s|[?!.,;]|$)/i.test(text) ||
    // FR (é, è, ê, ç — must avoid \b)
        /(?:^|\s)(qu'est[- ]ce que|qui est|où est|où sont|quand est|comment fonctionne|pourquoi est|combien|quel est|quelle est|quels sont|quelles sont)(?:\s|[?!.,;]|$)/i.test(text) ||
    // ES (ñ, á, é, í, ó, ú — must avoid \b)
        /(?:^|\s)(qué es|qué son|quién es|quién fue|dónde está|dónde están|cuándo es|cuándo fue|cómo funciona|por qué es|por qué son|cuánto|cuántos|cuál es|cuáles son)(?:\s|[?!.,;]|$)/i.test(text) ||
    // EN (ASCII — \b safe)
        /\b(what is|what are|what was|who is|who was|where is|where are|when is|when was|how does|how do|how is|why is|why are|why does|how many|how much|which is)\b/i.test(text);

    // Tier 2: Bare question words in substantive text (>12 chars, 3+ words)
    // NOTE: Cannot use \b for Czech/Slovak words — č/ř/ž etc. are \W in JS regex.
    // v61.3: Added no-diacritics CZ variants (proc, jaky, jake, kolikatym...)
    // v65.5: Added CZ declensions of "co": čem (loc.), čemu (dat.), čeho (gen.), čím (instr.)
    const hasQuestionWord = /(?:^|\s)(jak[áéýoui]?|jaky|jake|co|[čc][eě]m|[čc][eě]mu|[čc]eho|[čc][ií]m|kdo|kde|kdy|proč|proc|kolik|čo|kto|ako|kedy|prečo|koľko|ak[áéý]|was|wer|wo|wann|wie|warum|welch|wieviel|jaki?e?|kto|gdzie|kiedy|dlaczego|ile|qu[eéi]|qui|où|quand|comment|combien|pourquoi|quel|qué|quién|dónde|cuándo|cómo|cuánto|por qué|how|what|who|where|when|why|which)(?:\s|[?!.,;]|$)/i.test(text);
    const wordCount = text.split(/\s+/).length;
    const hasTier2Form = hasQuestionWord && text.length > 12 && wordCount >= 3;

    if (hasCompoundQuestionForm || hasTier2Form) {
      // ── v58.3: FRESH_DATA_SIGNALS — only these route to SEARCH ────────
      // Everything else = LLM knowledge (CONVERSATIONAL)
      const hasFreshSignal =
        // CZ temporal keywords (no \b — diacritics break it)
        /aktu[áa]ln|sou[čc]asn|dne[sš]|te[ďd](?:\s|$|[?!.,;])|nyn[ií]|nyn[eě]j[šs]|tento rok|letos|leto[šs]n/i.test(text) ||
        // EN temporal keywords (\b safe — ASCII only)
        /\b(current|today|now|latest|this year|right now|live|real.?time)\b/i.test(text) ||
        // Price / cost / financial (inherently temporal)
        /\b(price|stock)\b|cena(?:\s|$|[?!.,;])|kolik\s+stoj[ií]|kurz(?:\s|$|[?!.,;])|verze|version/i.test(text) ||
        // Weather / news (inherently fresh)
        /po[čc]as[ií]|weather|forecast|zpr[áa]v|news|novinky/i.test(text) ||
        // Score / results / status
        /\b(score|status|result)\b|sk[oó]re|v[ýy]sledek|stav(?:\s|$|[?!.,;])/i.test(text) ||
        // v62.2: Product specifications / tech specs (inherently version-dependent fresh data)
        /specifikac|parametr[yů]|spot[rř]eb[auy]|specs|specification/i.test(text) ||
        // Location services (opening hours, address, nearest)
        /otev[rř]en|otev[ií]rac|opening.?hour|\baddress\b|adresa/i.test(text) ||
        // Proximity / "nearest" queries (location-dependent, inherently fresh)
        /nejbli[žz][sš][ií]|nejblizsi|\bnearest\b|\bclosest\b/i.test(text) ||
        // Calendar / schedule queries (voln[ýé] den, holiday, svátek)
        /voln[ýyée]\s+den|sv[áa]t[eě]k|holiday|state\s+holiday|bank\s+holiday/i.test(text) ||
        // Living person queries: "kdo je X" / "who is X" (status may change)
        /kdo\s+je\b|who\s+is\b/i.test(text) ||
        // DE temporal (stem match)
        /aktuell|heute|jetzt|derzeit|momentan|neueste/i.test(text) ||
        // SK temporal
        /aktu[áa]lne|teraz|s[úu][čc]asn/i.test(text) ||
        // FR temporal
        /actuel|maintenant|dernier|aujourd'?hui|en\s+ce\s+moment/i.test(text) ||
        // ES temporal
        /actual(?:mente)?|hoy|ahora|último|en\s+este\s+momento/i.test(text) ||
        // PL temporal (stem match)
        /aktualn|dzisiaj|teraz|najnowsz/i.test(text) ||
        // SK/PL/DE/FR/ES living person queries
        /kto\s+je|wer\s+ist|qui\s+est|quién\s+es/i.test(text);

      // v58.3 §2.2: Log decision for future classifier training data
      logger.info('FreshDataSignal', 'Question-form classification', {
        input: text.substring(0, 80),
        tier: hasCompoundQuestionForm ? 1 : 2,
        hasFreshSignal,
        decision: hasFreshSignal ? 'SEARCH' : 'CONVERSATIONAL',
      });

      if (hasFreshSignal) {
        return IntentType.SEARCH;
      }

      // No fresh-data signal → LLM can answer from knowledge
      return IntentType.CONVERSATIONAL;
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
        // v45.0 FIX: REPORT starts with SEARCH only
        // SCRAPE is orchestrated by handler AFTER search returns URLs
        // NEVER call scrape directly from CRE - it needs URLs from search!
        return [ToolType.WEB_SEARCH];

      // v45.0: ITEM_LOOKUP - search + scrape to get specific items
      case IntentType.ITEM_LOOKUP:
        return [ToolType.WEB_SEARCH];

      case IntentType.FACTUAL:
        return [ToolType.WEB_SEARCH];

      // v44.4 - LOCAL intent uses local tools (no external API)
      case IntentType.LOCAL:
        // Determine which local tool based on input
        if (/měsíc|úplněk|nov|moon/i.test(input)) {
          return [ToolType.LOCAL_CALENDAR];
        }
        if (/datum|den|hodin|time|date/i.test(input)) {
          return [ToolType.LOCAL_DATE];
        }
        if (/kolik\s+je\s+\d|^\s*\d+\s*[+\-*/]\s*\d+|vypočít|spočít|vypocit|spocit|calculate/i.test(input)) {
          return [ToolType.LOCAL_MATH];  // v62.2: tightened math detection
        }
        return [ToolType.LOCAL_DATE]; // Default to date

      // v63.0: FILE_READ/FILE_EXPLAIN — filesystem only, no web
      case IntentType.FILE_READ:
        return [ToolType.FILE_READ];
      case IntentType.FILE_EXPLAIN:
        return [ToolType.FILE_READ];

      case IntentType.CODE:
        // Code might need file operations
        return [ToolType.FILE_READ, ToolType.FILE_WRITE];

      case IntentType.BUILD:
        // BUILD routes to Planner pipeline, no Chat tools needed
        return [];

      default:
        return [];
    }
  }

  /**
   * Make a decision based on user input
   *
   * v71.0: Now async — uses LLM-first classification with regex fallback.
   *
   * @param {string} input - User message
   * @param {Object} context - Additional context
   * @returns {Promise<CREDecision>}
   */
  async decide(input, context = {}) {
    // ════════════════════════════════════════════════════════════════════════
    // v71.0: HYBRID INTENT CLASSIFICATION — LLM primary, regex fallback
    // v72: Timing metrics — classificationTimeMs, decideTimeMs
    // ════════════════════════════════════════════════════════════════════════
    const _decideStart = performance.now();
    let intent;
    let llmMeta = null;
    let _classificationTimeMs = 0;

    // v73: Diagnostic tracker — accumulates state through decide() for instrumentation
    const _diag = {
      initialIntent: null,       // Intent right after classification (before overrides)
      isIntentBreak: false,
      lastIntent: null,
      followUpResult: null,      // detectFollowUpType() result
      overrides: [],             // Array of override labels applied
      deferredIntent: null,      // v101: BUILD deferred to later (discussion-before-build)
    };

    // v72: Helper — injects timing metrics into every decision
    const _makeDecision = (config) => {
      const overrideSource = config.overrideSource;
      const overrideReason = config.overrideReason || config.reason;
      const originalDecision = config.originalDecision || null;
      delete config.overrideSource;
      delete config.overrideReason;
      delete config.originalDecision;

      const decideTimeMs = Math.round(performance.now() - _decideStart);
      const classifiedBy = llmMeta ? 'llm' : (isDeterministic ? 'deterministic' : 'regex');
      config.metadata = {
        ...config.metadata,
        classificationTimeMs: _classificationTimeMs,
        classifiedBy,
        llmConfidence: llmMeta?.confidence ?? null,
        decideTimeMs,
        deferredIntent: _diag.deferredIntent || null,  // v101: preserved BUILD signal
      };

      // v73: CRE Diagnostic log — captures full decision pipeline state
      const _diagSnapshot = {
        initialIntent: _diag.initialIntent,
        finalIntent: config.intent,
        isIntentBreak: _diag.isIntentBreak,
        lastIntent: _diag.lastIntent,
        followUp: _diag.followUpResult
          ? { rule: _diag.followUpResult.rule, confidence: _diag.followUpResult.confidence, type: _diag.followUpResult.type }
          : null,
        overrides: _diag.overrides.length > 0 ? _diag.overrides : null,
        deferredIntent: _diag.deferredIntent,  // v101: preserved BUILD signal
      };

      logger.info('CRE_DIAG', 'decide() trace', {
        input: input.substring(0, 80),
        classifiedBy,
        ..._diagSnapshot,
        confidence: config.confidence,
        slots: config.slots || null,
      });

      // v73: Attach diag to metadata for telemetry persistence
      config.metadata.diag = _diagSnapshot;

      if (overrideSource) {
        return this.overrideDecision({
          ...config,
          source: overrideSource,
          reason: overrideReason,
          originalDecision,
        });
      }

      return new CREDecision(config);
    };

    // Phase 0: Deterministic fast-path — skip LLM where the local classifier
    // already has an explicit semantic rule. classifyIntent() still applies
    // its stricter FILE/CODE/etc. precedence before CONVERSATIONAL.
    const _text = input.trim();
    const _norm = normalizeForClassification(_text);
    const deterministicIntent = this.classifyIntent(input);
    const isLowInformation = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\s!?.,…]+$/u.test(_text);
    const isAmbiguousTechnologyTopic = /^(?:python|javascript|typescript|java|rust|go|ruby|php|c\+\+|sql)$/iu.test(_text);
    // A numeric finance/tax question may need a specialist calculator. Keep the
    // LLM classification in the authority chain so an unsupported LOCAL label
    // is still caught by Guard 13 instead of being silently short-circuited as
    // ordinary conversation.
    const mayRequireLocalAuthority = /\d/u.test(_text)
      && /(?:\b(?:tax(?:es)?|income|vat|mortgage|interest)\b|da[nň]|p[rř]ijm|osv[cč]|dph|zaplat|hypot[eé]k|[uú]rok)/iu.test(_text);
    // Creative expertise may legitimately reinterpret a general-knowledge
    // query through Guard 6. Keep that audited arbitration reachable instead
    // of silently accepting the local CONVERSATIONAL fallback.
    const creativeKnowledgeNeedsArbitration = context.expertise?.creativeLock === true
      && KNOWLEDGE_EXPLANATION_PATTERNS.some(p => p.test(_text));
    const isExplicitConversation = isGratitudeOrFarewell(_text)
      || CONVERSATIONAL_PATTERNS.some(p => p.test(_text))
      || SELF_REFERENCE_PATTERNS.some(p => p.test(_text))
      || STATEMENT_PATTERNS.some(p => p.test(_text));
    const isStaticKnowledge = DETERMINISTIC_STATIC_KNOWLEDGE_PATTERNS.some(p => p.test(_text))
      || isClosedHistoricalQuestion(_text);
    const isStableKnowledgeExplanation = KNOWLEDGE_EXPLANATION_PATTERNS.some(p => p.test(_text));
    const isStableDiscussion = DETERMINISTIC_DISCUSSION_PATTERNS.some(p => p.test(_text))
      && !EXPLICIT_SEARCH_COMMAND_PATTERN.test(_text)
      && !REPORT_FRESH_CONTEXT.test(_text);
    const isStableLearningGoal = DETERMINISTIC_LEARNING_GOAL_PATTERNS.some(p => p.test(_text));
    const hasDeterministicInlineCodeForm = DETERMINISTIC_INLINE_CODE_PATTERNS.some(p => p.test(_text));
    const isDeterministicInlineCode = hasDeterministicInlineCodeForm
      && [IntentType.CODE, IntentType.CONVERSATIONAL, IntentType.AMBIGUOUS, IntentType.SEARCH].includes(deterministicIntent);
    const isDeterministicLiveSearch = DETERMINISTIC_LIVE_SEARCH_PATTERNS.some(p => p.test(_text));
    const isDeterministicCreative = deterministicIntent === IntentType.CREATIVE
      && !EXPLICIT_SEARCH_COMMAND_PATTERN.test(_text)
      && !REPORT_FRESH_CONTEXT.test(_text);
    const stableConversationOverride = !mayRequireLocalAuthority
      && !creativeKnowledgeNeedsArbitration
      && (
        ((isStableDiscussion || isStableLearningGoal)
          && [
            IntentType.SEARCH,
            IntentType.FACTUAL,
            IntentType.REPORT,
            IntentType.DESIGN,
            IntentType.AMBIGUOUS,
          ].includes(deterministicIntent))
        || (isStableKnowledgeExplanation && deterministicIntent === IntentType.DESIGN)
      );
    const resolvedDeterministicIntent = isDeterministicLiveSearch
      ? IntentType.SEARCH
      : isDeterministicInlineCode
        ? IntentType.CODE
        : stableConversationOverride
          ? IntentType.CONVERSATIONAL
          : deterministicIntent;
    const isDeterministic =
      (resolvedDeterministicIntent === IntentType.CONVERSATIONAL
        && !mayRequireLocalAuthority
        && !creativeKnowledgeNeedsArbitration
        && (isExplicitConversation
          || isStaticKnowledge
          || isStableKnowledgeExplanation
          || isStableDiscussion
          || isStableLearningGoal)) ||
      resolvedDeterministicIntent === IntentType.LOCAL ||
      isDeterministicInlineCode ||
      isDeterministicCreative ||
      isDeterministicLiveSearch ||
      isLowInformation ||
      isAmbiguousTechnologyTopic ||
      // v72: ITEM_LOOKUP is purely pattern-based (count + thing) — skip LLM
      resolvedDeterministicIntent === IntentType.ITEM_LOOKUP;

    if (isDeterministic) {
      const _classStart = performance.now();
      intent = resolvedDeterministicIntent;
      _classificationTimeMs = Math.round(performance.now() - _classStart);
    } else {
      // Phase 1: LLM structured classification (primary)
      const _classStart = performance.now();
      const llmResult = await this._llmClassifyIntent(input, context);
      _classificationTimeMs = Math.round(performance.now() - _classStart);

      // v71.1: Confidence AND required fields validation
      // LLM confidence alone is not enough — action intents need valid metadata.
      const llmAccepted = llmResult && llmResult.confidence >= 0.7 &&
        this._validateLLMResult(llmResult, input);

      if (llmAccepted) {
        intent = llmResult.intent;
        llmMeta = llmResult;
        logger.info('CRE', `v71 LLM classification: ${intent} (${llmResult.confidence})`, {
          input: input.substring(0, 60),
          classificationTimeMs: _classificationTimeMs,
        });
      } else {
        // Phase 2: Regex fallback
        intent = this.classifyIntent(input);
        logger.info('CRE', `v71 LLM fallback → regex: ${intent}`, {
          input: input.substring(0, 60),
          llmIntent: llmResult?.intent || null,
          llmConfidence: llmResult?.confidence || null,
          rejectReason: llmResult ? (llmResult.confidence < 0.7 ? 'low_confidence' : 'validation_failed') : 'no_result',
          classificationTimeMs: _classificationTimeMs,
        });
      }
    }

    // v73: Capture initial intent before any overrides
    _diag.initialIntent = intent;

    if (llmMeta && intent !== IntentType.BUILD) {
      const deterministicIntent = this.classifyIntent(input);
      if (deterministicIntent === IntentType.BUILD) {
        logger.info('CRE:LLM:Guard', `${intent} override → BUILD (strong deterministic BUILD signal)`, {
          input: input.substring(0, 60),
          llmIntent: intent,
          deterministicIntent,
          confidence: llmMeta.confidence,
        });
        llmMeta = {
          ...llmMeta,
          deterministicIntent,
          arbitration: 'deterministic_build_override',
        };
        intent = IntentType.BUILD;
        _diag.overrides.push('llm_to_build_deterministic_arbitration');
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // v88: GUARD 8 — SKILL deterministic upgrade + feature gate.
    // "vytvořit expertizu" → SKILL, regardless of LLM classification.
    // Also: SKILL from regex fallback → needs feature flag check (GUARD 4
    // only runs on LLM path).
    // ════════════════════════════════════════════════════════════════════════
    if (featureManager.isEnabled('skills')) {
      if (intent !== IntentType.SKILL) {
        const hasSkillPattern = SKILL_PATTERNS.some(p => p.test(input));
        if (hasSkillPattern) {
          logger.info('CRE:Guard8', `${intent} upgrade → SKILL (deterministic pattern match)`, {
            input: input.substring(0, 60),
            originalIntent: intent,
          });
          intent = IntentType.SKILL;
          _diag.overrides.push('guard8_skill_upgrade');
        }
      }
    } else if (intent === IntentType.SKILL) {
      // Feature disabled — downgrade (covers regex fallback path)
      logger.info('CRE:Guard8', 'SKILL downgrade → CONVERSATIONAL (feature disabled)', {
        input: input.substring(0, 60),
      });
      intent = IntentType.CONVERSATIONAL;
      _diag.overrides.push('guard8_skill_disabled');
    }

    // ════════════════════════════════════════════════════════════════════════
    // v87: NEGATION OVERRIDE — user explicitly rejects an intent category.
    // "Nechci kód, vysvětli mi princip" → CODE negated → downgrade to CONVERSATIONAL.
    // Runs post-classification: detects negated intents, checks if classifier
    // returned one of them, and downgrades if so.
    // ════════════════════════════════════════════════════════════════════════
    const _negatedIntents = _detectNegatedIntents(input);
    if (_negatedIntents.size > 0 && _negatedIntents.has(intent)) {
      logger.info('CRE:Negation', `${intent} downgrade → CONVERSATIONAL (user negated this intent)`, {
        input: input.substring(0, 60),
        negated: [..._negatedIntents],
        originalIntent: intent,
      });
      intent = IntentType.CONVERSATIONAL;
      _diag.overrides.push('negation_override');
    }

    // GUARD 13: an LLM may label domain arithmetic (for example a tax
    // calculation) as LOCAL even though none of the closed deterministic
    // handlers can execute it. LOCAL is an absolute terminal authority, so a
    // label without a matching deterministic pattern must not fall through to
    // the historical local.date default. Downgrade it to conversational
    // authority; an active specialist may then dispatch its own deterministic
    // calculator, while the ordinary conversation path remains non-mutating.
    if (intent === IntentType.LOCAL &&
        !LOCAL_DETERMINISTIC_PATTERNS.some(pattern => pattern.test(_norm))) {
      logger.info('CRE:Guard13', 'LOCAL downgrade -> CONVERSATIONAL (no deterministic handler)', {
        input: input.substring(0, 60),
      });
      intent = IntentType.CONVERSATIONAL;
      _diag.overrides.push('guard13_unbacked_local');
    }

    // ════════════════════════════════════════════════════════════════════════
    // GUARD 6: CREATIVE OVERRIDE — when creative expertise is active,
    // SEARCH and AMBIGUOUS should be downgraded to CREATIVE.
    // v87: Bug fix — "Prokletý ostrov" during DnD session triggered SEARCH (Shutter Island film)
    // instead of staying in creative domain. Creative expertises set creativeLock=true.
    // AMBIGUOUS is also captured: under creative expertise, ambiguous queries should
    // default to CREATIVE (the domain context), not trigger clarification.
    // Explicit factual queries ("vyhledej", "najdi na internetu") bypass this guard.
    // Placed in decide() to cover both LLM and regex classification paths.
    // ════════════════════════════════════════════════════════════════════════
    if ((intent === IntentType.SEARCH || intent === IntentType.AMBIGUOUS) && context.hasActiveExpertise) {
      const _exp = context.expertise;
      if (_exp && (_exp.outputBias === 'creative' || _exp.creativeLock)) {
        const EXPLICIT_SEARCH = [
          /vyhledej/i, /najdi na internetu/i, /ve? skutečnost/i,
          /v re[áa]ln[ée]m sv[ěe]t[ěe]/i, /ve? wikipedi/i, /googl/i,
          /faktick/i, /historick[áaéeý] fakta?/i,
          // v124.6: No-diacritic variants
          /vyhledej/i, /najdi na internetu/i, /ve? skutecnost/i,
        ];
        if (!EXPLICIT_SEARCH.some(p => p.test(input))) {
          logger.info('CRE:Guard6', `${intent} downgrade → CREATIVE (creative expertise active: ${_exp.id})`, {
            input: input.substring(0, 60),
            expertise: _exp.id,
            originalIntent: intent,
          });
          intent = IntentType.CREATIVE;
          _diag.overrides.push('guard6_creative_override');
        }
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // GUARD 9: META-PROJECT QUERY — prevent "o čem je tento projekt?" from
    // being classified as FILE_READ. FILE_READ patterns broadly match on
    // "projekt" keyword, but meta-project queries ask ABOUT the project
    // (topic, purpose, summary) — they need LLM synthesis, not file listing.
    // v91: Fixes lifecycle context loss — after lifecycle completion user asks
    // about the project and gets "Nebyl zadán žádný soubor" from file handler.
    // ════════════════════════════════════════════════════════════════════════
    if ((intent === IntentType.FILE_READ || intent === IntentType.FILE_EXPLAIN) &&
        (context.hasActiveProject || context.project?.id)) {
      const META_PROJECT = [
        /o\s+[cč][eě]m\s+(?:je\s+)?(?:ten(?:to|hle)?\s+)?projekt/i,
        /co\s+(?:je\s+)?to\s+za\s+projekt/i,
        /[rř]ekni\s+(?:mi\s+)?o\s+(?:tom(?:to)?\s+)?projekt/i,
        /popiš\s+(?:mi\s+)?(?:ten(?:to|hle)?\s+)?projekt/i,
        /jak[ýé]\s+(?:je\s+)?(?:ten(?:to|hle)?\s+)?projekt/i,
        /shr[nň]\s+(?:mi\s+)?(?:ten(?:to|hle)?\s+)?projekt/i,
        /co\s+(?:ten(?:to|hle)?\s+)?projekt\s+(?:d[eě]l[áa]|[rř]e[sš][ií]|umí)/i,
        /k\s+[cč]emu\s+(?:ten(?:to|hle)?\s+)?projekt\s+slou[zž][ií]/i,
        /(?:ten|projekt).*(?:otev[rř]en[ýé]|aktivn[ií])/i,
        // v135: Abstract summary/recall — no specific file referenced
        /shr[nň]\s+(?:mi\s+)?co\s+jsme/i,           // "shrň mi co jsme vytvořili/udělali"
        /shr[nň]\s+(?:mi\s+)?(?:celou?\s+)?(?:práci|konverzaci|diskusi)/i,  // "shrň práci/konverzaci"
        /co\s+(?:všechno\s+)?jsme\s+(?:tu\s+)?(?:vytvo[rř]ili|ud[eě]lali|naprogramovali|napsali|navrhli)/i,
        /vyjmenuj\s+(?:mi\s+)?(?:všechny?\s+)?soubory?\s+(?:z|které|co)\s+(?:jsme|naší)/i,
        /kolik\s+soubor[ůu]\s+(?:jsme|máme|má)/i,    // "kolik souborů jsme vytvořili"
        /jak[ýé]\s+soubory\s+(?:jsme|máme)/i,         // "jaké soubory jsme vytvořili"
        /seznam\s+(?:všech\s+)?soubor[ůu]/i,          // "seznam souborů"
        /stav\s+(?:naší|této)?\s*práce/i,             // "stav práce"
        // EN
        /what\s+(?:is|'s)\s+(?:this\s+)?project\s+(?:about|for)/i,
        /tell\s+me\s+about\s+(?:this\s+|the\s+)?project/i,
        /describe\s+(?:this\s+|the\s+)?project/i,
        /summarize\s+(?:this\s+|the\s+)?project/i,
        /what\s+(?:have\s+we|did\s+we)\s+(?:created?|built|done|made)/i,
        /list\s+(?:all\s+)?(?:the\s+)?files\s+(?:we|from)/i,
      ];
      if (META_PROJECT.some(p => p.test(input))) {
        logger.info('CRE:Guard9', `${intent} downgrade → CONVERSATIONAL (meta-project query)`, {
          input: input.substring(0, 60),
          project: context.project?.id || context.project?.name || 'unknown',
        });
        intent = IntentType.CONVERSATIONAL;
        _diag.overrides.push('guard9_meta_project');
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // GUARD 12: FILE_EXPLAIN/FILE_READ without file reference → CONVERSATIONAL
    // v135: LLM sometimes routes "shrň mi návrh" or "rekapituluj co jsme udělali"
    // to FILE_EXPLAIN, but no actual file is referenced. This causes
    // "Nebyl zadán žádný soubor" errors. If no file path/name pattern is found
    // in the input, downgrade to CONVERSATIONAL.
    // ════════════════════════════════════════════════════════════════════════
    if (intent === IntentType.FILE_EXPLAIN || intent === IntentType.FILE_READ) {
      // Detect actual file references (not just Czech words ending with period)
      const FILE_EXT_RE = /\w+\.(js|ts|py|json|md|txt|html|css|yml|yaml|toml|cfg|conf|sh|sql|go|rs|c|h|cpp|java|rb|php|vue|svelte|jsx|tsx)\b/i;
      const extractedFileRef = extractFilePath(input);
      const hasProjectListingRef = intent === IntentType.FILE_READ
        && Boolean(context.hasActiveProject || context.project?.id)
        && extractedFileRef === '.';
      const hasKnownFilenameRef = typeof extractedFileRef === 'string'
        && KNOWN_EXTENSIONLESS_FILENAME_RE.test(extractedFileRef);
      const hasFileRef = hasProjectListingRef || hasKnownFilenameRef
        || FILE_EXT_RE.test(input)                      // file.ext
        || /[\\/][\w.-]+/.test(input)                                 // path/file
        || /otev[rř]i|open/i.test(input)                             // explicit open verb
        || /p[rř]e[cč]ti\s+(si\s+)?soubor/i.test(input)             // "přečti soubor"
        || /read\s+file/i.test(input)                                 // "read file"
        || (context.attachments && context.attachments.length > 0);   // has inline attachments
      if (!hasFileRef) {
        logger.info('CRE:Guard12', `${intent} downgrade → CONVERSATIONAL (no file reference)`, {
          input: input.substring(0, 60),
        });
        intent = IntentType.CONVERSATIONAL;
        _diag.overrides.push('guard12_no_file_ref');
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // GUARD 10: BUILD DEFERRAL — "first discuss/review, then implement"
    // v101: When user asks to review/discuss/fine-tune BEFORE building,
    // primary intent = CONVERSATIONAL, deferred intent = BUILD.
    // BUILD signal preserved in _diag.deferredIntent for follow-up awareness.
    // Uses 3-part detection: DISCUSSION_VERBS + BUILD_VERBS + SEQUENCE_MARKERS
    // + standalone patterns for conditional mood and implicit "nejdřív projdeme".
    // Note: checks patterns regardless of current intent — GUARD 7 confidence
    // downgrade + regex fallback may have changed BUILD→SHELL/AMBIGUOUS,
    // but the user's discussion-before-build signal is still in the text.
    // ════════════════════════════════════════════════════════════════════════
    if (intent !== IntentType.CONVERSATIONAL) {
      const _g10text = input;
      // Detect discussion-before-build via 3 independent pattern groups
      const _g10isComposite = DISCUSSION_VERBS.test(_g10text) && BUILD_VERBS.test(_g10text) && SEQUENCE_MARKERS.test(_g10text);
      const _g10isConditional = CONDITIONAL_BUILD.test(_g10text);
      const _g10isImplicit = IMPLICIT_DISCUSSION_FIRST.test(_g10text);

      if (_g10isComposite || _g10isConditional || _g10isImplicit) {
        // Position check: only for composite pattern.
        // Standalone patterns (conditional mood, implicit "nejdřív") encode
        // position semantics internally — skip position check for them.
        let _g10shouldDefer = _g10isConditional || _g10isImplicit;
        if (!_g10shouldDefer && _g10isComposite) {
          const _g10discussionIdx = _g10text.search(DISCUSSION_VERBS);
          const _g10buildIdx = _g10text.search(BUILD_VERBS);
          _g10shouldDefer = _g10buildIdx === -1 || _g10discussionIdx < _g10buildIdx;
        }
        if (_g10shouldDefer) {
          logger.info('CRE:Guard10', `${intent} → CONVERSATIONAL (deferred, discussion-before-build)`, {
            input: input.substring(0, 80),
          });
          intent = IntentType.CONVERSATIONAL;
          _diag.deferredIntent = IntentType.BUILD;
          _diag.overrides.push('guard10_build_deferral');
        }
      }
    }

    // v73: Run detectFollowUpType for diagnostic purposes (lazy import to avoid circular dep)
    const _lastDec = context.lastDecision;
    if (_lastDec) {
      try {
        const _dft = await _getDetectFollowUpType();
        _diag.followUpResult = _dft(input, _lastDec);
      } catch (e) {
        _diag.followUpResult = { error: e.message };
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // v44.3 — INTENT CONTINUITY
    // v44.6 FIX 7 — Enhanced sticky SEARCH for follow-up queries
    // ════════════════════════════════════════════════════════════════════════
    // If previous intent was REPORT/SEARCH/FACTUAL and user is continuing
    // the conversation (not asking for clarification), maintain the intent.
    // This prevents REPORT falling to AMBIGUOUS after tool failure.
    //
    // IMPORTANT: We distinguish between:
    // - 'intent_clarification' → user said something ambiguous, need to ask
    // - 'alternative_action' → tool failed, offering alternatives (intent is valid!)
    // Sticky intent should work for alternative_action, not for intent_clarification.
    // ════════════════════════════════════════════════════════════════════════
    // v45.0: Added ITEM_LOOKUP to sticky intents
    const STICKY_INTENTS = [IntentType.REPORT, IntentType.SEARCH, IntentType.FACTUAL, IntentType.ITEM_LOOKUP];
    const lastIntent = context.lastIntent || context.conversationState?.lastIntent;
    _diag.lastIntent = lastIntent || null;
    const awaitingSlots = context.awaitingSlots || context.sessionState?.awaitingSlots || [];
    const retryCount = context.retryCount ?? 0;

    // Only block sticky intent for actual intent clarification, not tool failure alternatives
    const blockStickyIntent = awaitingSlots.includes('intent_clarification');

    // v44.7 FIX: Strong intents NEVER get overridden by sticky intent
    // LOCAL and CONVERSATIONAL are terminal - they should not be changed by context
    // v44.8: Added CREATIVE - ideation requests must not be overridden by sticky SEARCH
    // v45.0: Added ITEM_LOOKUP - explicit item requests must not be overridden by REPORT
    // v58.0: Added DESIGN - structured synthesis must not fall to SEARCH
    // v63.0: Added FILE_READ, FILE_EXPLAIN - file operations are terminal
    // v65.0: Added SHELL - terminal commands are terminal
    // v71: Added FILE_WRITE — LLM-classified action intents must not be overridden
    const STRONG_INTENTS = [IntentType.LOCAL, IntentType.CONVERSATIONAL, IntentType.CREATIVE, IntentType.ITEM_LOOKUP, IntentType.DESIGN, IntentType.FILE_READ, IntentType.FILE_EXPLAIN, IntentType.SHELL, IntentType.FILE_WRITE, IntentType.CODE_ANALYSIS];
    const isStrongIntent = STRONG_INTENTS.includes(intent);

    // ════════════════════════════════════════════════════════════════════════
    // v44.9 FIX A: CREATIVE FOLLOW-UP LOCK
    // v45.0 FIX: CREATIVE follow-up has priority even over CONVERSATIONAL!
    // ════════════════════════════════════════════════════════════════════════
    // When in CREATIVE mode, follow-up questions should STAY in CREATIVE.
    // "jaký to může mít vliv na hráče?" after "vymysli kampaň" = CREATIVE
    // "ukaž mi variaci" = CREATIVE (not CONVERSATIONAL!)
    // User is exploring THEIR ideation, not asking for web search!
    // ════════════════════════════════════════════════════════════════════════
    // v45.0: Check CREATIVE follow-up BEFORE respecting strong intents
    // Exception: LOCAL (deterministic) and explicit new CREATIVE (fresh ideation)
    const exceptCreativeFollowUp = [IntentType.LOCAL];
    if (lastIntent === IntentType.CREATIVE && !exceptCreativeFollowUp.includes(intent)) {
      // Check if this looks like a follow-up to creative work
      const isCreativeFollowUp = CREATIVE_FOLLOW_UP_PATTERNS.some(p => p.test(input.trim()));

      if (isCreativeFollowUp) {
        logger.info('CREDecision', 'CREATIVE follow-up detected, maintaining CREATIVE intent', {
          input: input.substring(0, 50),
          classifiedAs: intent,
          maintainingAs: IntentType.CREATIVE,
        });
        _diag.overrides.push(`creative_followup:${intent}→CREATIVE`);
        intent = IntentType.CREATIVE;
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // v58.0: DESIGN FOLLOW-UP LOCK
    // ════════════════════════════════════════════════════════════════════════
    // When in DESIGN mode, follow-up questions should STAY in DESIGN.
    // "více podrobností" / "rozděl na sprinty" after roadmap = DESIGN
    // NOT new SEARCH!
    // Exception: LOCAL (deterministic), explicit FACTUAL (escape hatch)
    // ════════════════════════════════════════════════════════════════════════
    const exceptDesignFollowUp = [IntentType.LOCAL, IntentType.FACTUAL];
    const isDesignFollowUp = lastIntent === IntentType.DESIGN &&
      !exceptDesignFollowUp.includes(intent) &&
      DESIGN_CONTINUE_PATTERNS.some(p => p.test(input.trim()));
    if (isDesignFollowUp) {
      logger.info('CREDecision', 'DESIGN follow-up detected, maintaining DESIGN intent', {
        input: input.substring(0, 50),
        classifiedAs: intent,
        maintainingAs: IntentType.DESIGN,
      });
      _diag.overrides.push(`design_followup:${intent}→DESIGN`);
      intent = IntentType.DESIGN;
    }

    // v44.6 FIX 7: Enhanced continuation patterns for SEARCH
    const SEARCH_CONTINUATION_PATTERNS = [
      /^(a |tak |no |co |jak )/i,           // "a co dál?", "tak co tam bylo?"
      /^(ještě|více|víc|další)/i,            // "ještě něco?", "další informace"
      /\?$/,                                  // Ends with question mark
      /^(ok|dobře|jasně|fajn)/i,             // Acknowledgment → wants more
      // v44.6 - Explicit search continuations
      /^zkus/i,                               // "zkus mi najít"
      /^najdi/i,                              // "najdi konkrétní"
      /^hledej/i,                             // "hledej dál"
      /konkrétn[ěí]/i,                        // "konkrétnější", "konkrétní"
      /jin[ýé]/i,                             // "jiný zdroj", "jiné"
      /podobn[ýé]/i,                          // "podobné", "podobný"
      /alternativ/i,                          // "alternativu", "alternativní"
      /^(vyhledej|prohledej)/i,              // explicit search commands
    ];

    // v45.0: Patterns that BREAK sticky intent - user is starting a NEW task
    const INTENT_BREAK_PATTERNS = [
      /^(teď|ted|nyní|nyni)\s/i,              // "teď chci...", "nyní najdi..."
      /^(změň|zmen|přepni|prepni)\s/i,        // "změň téma", "přepni na..."
      /^(něco|neco)\s(jin|úplně|uplne)/i,     // "něco jiného", "něco úplně jiného"
      /^(dost|stačí|staci|konec)\s/i,         // "dost reportů", "stačí"
      // v73: "chci" removed — not a topic shift by itself (see followup-contract-v2.md)
      /^(potřebuju|potrebuju)\s/i,             // "potřebuju..." (stronger intent signal than "chci")
      /^(now|switch|change)\s/i,              // English: "now find...", "switch to..."
      /\d+\s*(inzerát|nabíd|produkt|auto)/i,  // Explicit item request always breaks
    ];

    // v72: Follow-up patterns for sticky continuity override.
    // These detect short follow-up messages that the LLM classifies as CONVERSATIONAL
    // but which are actually continuations of the previous tool-using intent.
    const FOLLOW_UP_PATTERNS = [
      /^a\s+(co|jak|kde|kdy|kdo|proč)/i,       // "a co dál?", "a jak to dopadlo?"
      /^(ještě|jeste|víc|vic|více|vice)(\s|$)/i,  // "ještě něco?", "víc detailů"
      /^co\s+(dál|dal|jiného)(\s|$|[?!])/i,     // "co dál?", "co jiného?"
      /^(pokračuj|pokracuj)(\s|$)/i,             // "pokračuj"
      /^(tell|show|find)\s+me\s+more/i,         // English follow-ups
      /^(what|how)\s+(else|about|next)/i,        // "what else?", "how about..."
      /^more\b/i,                                // "more"
    ];

    // v72: Intents where sticky continuation makes sense (tool-calling intents)
    const STICKY_FOLLOW_UP_ALLOWED = new Set([
      IntentType.SEARCH, IntentType.ITEM_LOOKUP, IntentType.REPORT,
      IntentType.CREATIVE, IntentType.FACTUAL,
    ]);

    // v44.7: Skip sticky intent if we have a strong intent (LOCAL, CONVERSATIONAL)
    // v45.0: Also skip if INTENT_BREAK_PATTERNS match (user starting new task)
    // A domain-specific continuation is stronger than a generic leading
    // "změň/přepni" break. "Změň stack na Kotlin" refines the active design;
    // "změň téma" still breaks it.
    const isIntentBreak = !isDesignFollowUp &&
      INTENT_BREAK_PATTERNS.some(p => p.test(input.trim()));
    _diag.isIntentBreak = isIntentBreak;
    if (isIntentBreak) {
      logger.info('CREDecision', 'Intent break detected - not applying sticky intent', {
        input: input.substring(0, 50),
        lastIntent,
        newIntent: intent,
      });
    }

    if (!isStrongIntent && !isIntentBreak && STICKY_INTENTS.includes(lastIntent) && !blockStickyIntent) {
      // User is continuing a REPORT/SEARCH/FACTUAL flow
      if (intent === IntentType.AMBIGUOUS) {
        // Don't let REPORT degrade to AMBIGUOUS - maintain continuity
        logger.info('CREDecision', `Intent continuity: ${IntentType.AMBIGUOUS} → ${lastIntent}`, {
          input: input.substring(0, 50),
          lastIntent,
          retryCount,
        });
        _diag.overrides.push(`sticky:AMBIGUOUS→${lastIntent}`);
        intent = lastIntent;
      }

      // v44.6 FIX 7: Check for continuation patterns (follow-up questions)
      if (SEARCH_CONTINUATION_PATTERNS.some(p => p.test(input.trim()))) {
        logger.info('CREDecision', `Continuation detected, maintaining ${lastIntent}`, {
          input: input.substring(0, 50),
          pattern: 'SEARCH_CONTINUATION',
        });
        _diag.overrides.push(`continuation:→${lastIntent}`);
        intent = lastIntent;
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // v73: WEAK-AMBIGUOUS OVERRIDE (L2 → L3 bridge)
    // ════════════════════════════════════════════════════════════════════════
    // When L1 returns AMBIGUOUS but L2 (detectFollowUpType) produced a
    // strong contextual signal (R1 anaphoric or R2 processing request with
    // confidence ≥ 0.85), trust L2 and upgrade intent to lastDecision.intent.
    //
    // This closes the gap where sticky intent already handled AMBIGUOUS→last
    // but only for STICKY_INTENTS. The L2 bridge works for ANY lastIntent
    // because R1/R2 confidence proves genuine follow-up context.
    //
    // Safety: Only fires when intent is still AMBIGUOUS after sticky (i.e.
    // sticky didn't apply or lastIntent wasn't in STICKY_INTENTS).
    // ════════════════════════════════════════════════════════════════════════
    const _fuResult = _diag.followUpResult;
    if (
      intent === IntentType.AMBIGUOUS &&
      !isIntentBreak &&
      _fuResult &&
      !_fuResult.error &&
      (_fuResult.rule?.startsWith('R1') || _fuResult.rule?.startsWith('R2')) &&
      _fuResult.confidence >= this._overrideThreshold &&
      _lastDec?.intent
    ) {
      logger.info('CREDecision', `v73 L2 override: AMBIGUOUS → ${_lastDec.intent} (${_fuResult.rule}@${_fuResult.confidence})`, {
        input: input.substring(0, 50),
        rule: _fuResult.rule,
        confidence: _fuResult.confidence,
        targetIntent: _lastDec.intent,
      });
      _diag.overrides.push(`L2_strong_followup:AMBIGUOUS→${_lastDec.intent}(${_fuResult.rule})`);
      intent = _lastDec.intent;
    }

    // ════════════════════════════════════════════════════════════════════════
    // v72: FOLLOW-UP CONTINUITY OVERRIDE
    // ════════════════════════════════════════════════════════════════════════
    // Problem: LLM classifies short follow-ups ("a co dál?", "ještě něco?")
    // as CONVERSATIONAL because they lack semantic content. The LLM is correct
    // in isolation — but in context of a SEARCH/REPORT flow, the user wants
    // continuation, not chat.
    //
    // This is a decision-layer fix, not a classification fix.
    // Conditions: follow-up pattern + short input + allowed intent + previous
    // turn used a tool (safety brake against false positives).
    // ════════════════════════════════════════════════════════════════════════
    const lastDecision = context.lastDecision;
    const lastDecisionWasTool = lastDecision?.type === DecisionType.TOOL_CALL;

    if (
      intent === IntentType.CONVERSATIONAL &&
      !isIntentBreak &&
      input.trim().length < 40 &&
      FOLLOW_UP_PATTERNS.some(p => p.test(input.trim())) &&
      STICKY_FOLLOW_UP_ALLOWED.has(lastIntent) &&
      lastDecisionWasTool
    ) {
      logger.info('CREDecision', `v72 follow-up override: CONVERSATIONAL → ${lastIntent}`, {
        input: input.substring(0, 50),
        lastIntent,
        lastDecisionType: lastDecision?.type,
      });
      _diag.overrides.push(`v72_followup:CONVERSATIONAL→${lastIntent}`);
      intent = lastIntent;
    }

    // ════════════════════════════════════════════════════════════════════════
    // v72: INTENT BREAK → CONVERSATIONAL OVERRIDE
    // ════════════════════════════════════════════════════════════════════════
    // Problem: "dost reportů" triggers isIntentBreak (good), but LLM still
    // classifies as REPORT because "reportů" is a domain word. The break
    // blocks sticky continuity but can't prevent fresh LLM classification
    // from landing on the same intent.
    //
    // Fix: If break fired AND LLM re-classified to the SAME intent as
    // lastIntent, the LLM was fooled by domain vocabulary in the break
    // phrase. Override to CONVERSATIONAL.
    //
    // If break fired AND LLM classified to a DIFFERENT intent, that's a
    // genuine topic change ("teď chci najít restauraci") — leave it alone.
    // ════════════════════════════════════════════════════════════════════════
    if (isIntentBreak && lastIntent && intent === lastIntent) {
      logger.info('CREDecision', `v72 break override: ${intent} → CONVERSATIONAL (same as lastIntent)`, {
        input: input.substring(0, 50),
        lastIntent,
      });
      _diag.overrides.push(`v72_break:${intent}→CONVERSATIONAL`);
      intent = IntentType.CONVERSATIONAL;
    }

    const tools = this.getRequiredTools(intent, input);

    logger.debug('CREDecision', `Intent classified: ${intent}`, {
      input: input.substring(0, 50),
      tools,
      lastIntent,
      continuity: lastIntent && intent === lastIntent,
    });

    // ════════════════════════════════════════════════════════════════════════
    // v44.3 — PROJECT MODE AS DOMINANT CONTEXT
    // ════════════════════════════════════════════════════════════════════════
    // When project is active, ALL operations are scoped to project:
    // - File operations restricted to project directory (enforced by ToolExecutor)
    // - Web searches should include project context (for relevance)
    // - CODE intent always has project context
    // ════════════════════════════════════════════════════════════════════════
    const hasActiveProject = context.hasActiveProject || context.project?.id;
    const projectScope = hasActiveProject ? {
      projectId: context.project?.id || context.projectId,
      projectName: context.project?.name || context.projectName,
      projectPath: context.project?.path || context.projectPath,
      projectGoal: context.projectWorkingMemory?.goal || context.projectGoal,
    } : null;

    // ════════════════════════════════════════════════════════════════════════
    // v44.7 FIX 1: LOCAL is ABSOLUTE TERMINAL
    // ════════════════════════════════════════════════════════════════════════
    // LOCAL intent = direct computation, NO tools, NO external API
    // This is the FIRST check after intent classification
    // Once LOCAL → no more routing, no handlers.js decisions
    // ════════════════════════════════════════════════════════════════════════
    if (intent === IntentType.LOCAL) {
      // Determine which local handler to use
      let handler = 'local.date'; // default
      // v72: Added váno/christmas, days until → local.calendar
      if (/měsíc|úplněk|uplnek|nov|moon|fáze|váno|vanoc|christmas|days?\s+until/i.test(input)) {
        handler = 'local.calendar';
      } else if (/kolik\s+je\s+\d|^\s*\d+\s*[+\-*/^]\s*\d+|\d+\s*\*\*\s*\d+|\d+\s*!|vypočít|spočít|vypocit|spocit|calculate|dph\s+z/i.test(input)) {
        handler = 'local.math';  // v72: added ** power, ^ power, ! factorial; v82.1: DPH
      } else if (/datum|\bden\b|hodin|time|date/i.test(input)) {
        handler = 'local.date';
      }

      return _makeDecision({
        type: DecisionType.LOCAL,  // NOT TOOL_CALL!
        intent,
        tools: [],                 // No tools - direct computation
        reason: 'LOCAL is terminal - direct deterministic computation',
        confidence: 0.95,
        metadata: {
          inputPreview: input.substring(0, 100),
          handler,                 // Which local handler to use
          localComputation: true,
          projectScope,
        },
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // v63.0: FILE_READ is TERMINAL — filesystem read, no web search
    // ════════════════════════════════════════════════════════════════════════
    // "otevři soubor X", "přečti config.json"
    // Reads file from project sandbox and returns content.
    // ════════════════════════════════════════════════════════════════════════
    if (intent === IntentType.FILE_READ) {
      return _makeDecision({
        type: DecisionType.LOCAL,  // TERMINAL — like local.date
        intent,
        tools: [],                 // No external tools
        reason: 'FILE_READ is terminal - filesystem read, no web search',
        confidence: llmMeta?.confidence || 0.95,
        metadata: {
          inputPreview: input.substring(0, 100),
          handler: 'file.read',
          fileOperation: true,
          filePath: llmMeta?.fileTarget || extractFilePath(input),

          projectScope,
        },
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // v63.0: FILE_EXPLAIN is TERMINAL — read file + LLM explain
    // ════════════════════════════════════════════════════════════════════════
    // "vysvětli soubor X", "co dělá tento soubor?"
    // Reads file, then LLM explains/summarizes the content.
    // ════════════════════════════════════════════════════════════════════════
    if (intent === IntentType.FILE_EXPLAIN) {
      return _makeDecision({
        type: DecisionType.LOCAL,  // TERMINAL — file read + LLM synthesis
        intent,
        tools: [],
        reason: 'FILE_EXPLAIN is terminal - file read + LLM explanation',
        confidence: llmMeta?.confidence || 0.9,
        metadata: {
          inputPreview: input.substring(0, 100),
          handler: 'file.explain',
          fileOperation: true,
          filePath: llmMeta?.fileTarget || extractFilePath(input),

          projectScope,
        },
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // v65.0: SHELL is TERMINAL — execute command in terminal, no LLM
    // ════════════════════════════════════════════════════════════════════════
    // "spusť npm test", "git status", "ls -la"
    // Routes to terminal execution channel. Backend executes, returns output.
    // ════════════════════════════════════════════════════════════════════════
    if (intent === IntentType.SHELL) {
      // v71.1: ALWAYS use deterministic extractShellCommand — LLM never generates commands
      const command = extractShellCommand(input);
      return _makeDecision({
        type: DecisionType.LOCAL,  // TERMINAL — like local.date
        intent,
        tools: [],                 // No external tools — terminal handles it
        reason: 'SHELL is terminal - execute command in terminal',
        confidence: llmMeta?.confidence || 0.95,
        metadata: {
          inputPreview: input.substring(0, 100),
          handler: 'shell.exec',
          shellCommand: command,

          projectScope,
        },
      });
    }

    // v71: FILE_WRITE is TERMINAL — write content to filesystem, no LLM
    if (intent === IntentType.FILE_WRITE) {
      // v71: prefer LLM-extracted fileTarget, fallback to regex extraction
      const writePath = llmMeta?.fileTarget || extractWriteFilePath(input);
      return _makeDecision({
        type: DecisionType.LOCAL,
        intent,
        tools: [],
        reason: 'FILE_WRITE is terminal - write content to file',
        confidence: llmMeta?.confidence || 0.9,
        metadata: {
          inputPreview: input.substring(0, 100),
          handler: 'file.write',
          filePath: writePath,

          projectScope,
        },
      });
    }

    // v58.0: DESIGN is TERMINAL — structured synthesis, NEVER web search
    // ════════════════════════════════════════════════════════════════════════
    // v44.8 FIX: CREATIVE is TERMINAL - direct answer, NEVER web search
    // ════════════════════════════════════════════════════════════════════════
    // "vymyslet kampaň", "dej mi nápady", "navrhni příběh"
    // User wants IDEAS, INSPIRATION, DESIGN - not web search results!
    // ════════════════════════════════════════════════════════════════════════
    if (intent === IntentType.CREATIVE) {
      return _makeDecision({
        type: DecisionType.ANSWER,  // NOT TOOL_CALL! NEVER web.search!
        intent,
        tools: [],                  // No tools - LLM generates ideas directly
        reason: 'CREATIVE/IDEATION is terminal - direct creative response, no web search',
        confidence: 0.9,
        metadata: {
          inputPreview: input.substring(0, 100),
          creativeRequest: true,
          projectScope,
        },
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // GUARD 11: PROJECT + DESIGN → BUILD escalation
    // v123.3: In project mode, "chci vytvořit mobilní aplikaci" = lifecycle.
    // Advisory requests ("navrhni schema", "jaký stack") stay DESIGN.
    // Skip when lifecycle already active (prevents SPEC restart loop).
    // ════════════════════════════════════════════════════════════════════════
    if (intent === IntentType.DESIGN && hasActiveProject) {
      const _g11lifecycleActive = context.lifecyclePhase && context.lifecyclePhase !== 'COMPLETED';
      if (!_g11lifecycleActive && !context.expertise?.creativeLock &&
          DESIGN_BUILD_ESCALATION.some(p => p.test(input)) &&
          !DESIGN_ADVISORY.some(p => p.test(input))) {
        logger.info('CRE:Guard11', `DESIGN → BUILD (project mode, app-building request)`, {
          input: input.substring(0, 80),
          project: context.project?.id || context.project?.name || 'unknown',
        });
        intent = IntentType.BUILD;
        _diag.overrides.push('guard11_project_build_escalation');
      }
    }

    // ════════════════════════════════════════════════════════════════════════
    // v58.0: DESIGN is TERMINAL — structured synthesis, NEVER web search
    // ════════════════════════════════════════════════════════════════════════
    // "navrhni architekturu", "udělej roadmapu", "rozděl na sprinty"
    // User wants STRUCTURED PLAN from LLM knowledge, not web results.
    // DESIGN uses ANSWER (no tools), with specialized system prompt.
    // ════════════════════════════════════════════════════════════════════════
    if (intent === IntentType.DESIGN) {
      return _makeDecision({
        type: DecisionType.ANSWER,   // NOT TOOL_CALL! Pure LLM synthesis
        intent,
        tools: [],                    // EMPTY — no web.search, no scrape
        reason: 'DESIGN is terminal - structured synthesis from LLM knowledge',
        confidence: 0.9,
        metadata: {
          inputPreview: input.substring(0, 200),
          designRequest: true,
          taskType: TaskType.DESIGN_SYNTHESIS,
          projectScope,
        },
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // BUILD → PLAN: Route to Planner pipeline (D1→CODE→R2→R1)
    // ════════════════════════════════════════════════════════════════════════
    // "postav mi X", "deploy Y", "scaffold projekt"
    // Chat Agent doesn't build — it hands off to Planner with confirmation
    // ════════════════════════════════════════════════════════════════════════
    if (intent === IntentType.BUILD) {
      const buildArbitration = llmMeta?.arbitration === 'deterministic_build_override'
        ? {
            overrideSource: 'llm_to_build_deterministic_arbitration',
            overrideReason: `Accepted LLM intent ${llmMeta.intent} overridden by strong deterministic BUILD signal`,
            originalDecision: {
              type: null,
              intent: llmMeta.intent,
              confidence: llmMeta.confidence,
              metadata: {
                classifiedBy: 'llm',
                deterministicIntent: IntentType.BUILD,
              },
            },
          }
        : {};
      return _makeDecision({
        type: DecisionType.PLAN,
        intent,
        tools: [],                  // No Chat tools — Planner has its own pipeline
        reason: 'BUILD intent detected — handoff to Planner pipeline',
        confidence: 0.9,
        ...buildArbitration,
        metadata: {
          inputPreview: input.substring(0, 200),
          buildRequest: true,
          projectScope,
        },
      });
    }

    // ════════════════════════════════════════════════════════════════════════
    // SKILL: Route to Skill handler (v85)
    // ════════════════════════════════════════════════════════════════════════
    // Deterministic macro-recipe — resolver identifies skillId + params
    // ════════════════════════════════════════════════════════════════════════
    if (intent === IntentType.SKILL) {
      return _makeDecision({
        type: DecisionType.SKILL,
        intent,
        tools: [],
        reason: 'SKILL intent detected — handoff to skill resolver',
        confidence: 0.9,
        metadata: {
          inputPreview: input.substring(0, 200),
          projectScope,
        },
      });
    }

    // INVARIANT 2: SEARCH/FACT/REPORT/ITEM_LOOKUP = TOOL_CALL first
    // v45.0: Added ITEM_LOOKUP - requires web search to find specific items
    if ([IntentType.SEARCH, IntentType.FACTUAL, IntentType.REPORT, IntentType.ITEM_LOOKUP].includes(intent)) {
      // v62.2: Classify SEARCH sub-type for targeted synthesis prompts
      let searchSubType = 'GENERAL';
      if (intent === IntentType.SEARCH || intent === IntentType.FACTUAL) {
        if (/zpr[áa]v|novin|news|aktu[áa]ln[ií].*situac|co se d[eě]je/i.test(input)) {
          searchSubType = 'NEWS';
        } else if (/specifikac|parametr|specs|specification|spot[rř]eb/i.test(input)) {
          searchSubType = 'SPEC';
        } else if (/porovn[eě]j|srovn[eě]j|vs\.?(?:\s|$)|versus|\bvs\b/i.test(input)) {
          searchSubType = 'COMPARISON';
        } else if (/kurz|po[čc]as[ií]|weather|teplota|předpov[eě]ď|forecast/i.test(input)) {
          searchSubType = 'FACTUAL_NUMERIC';
        } else if (/kdo\s+je|who\s+is|prezident|president/i.test(input)) {
          searchSubType = 'PERSON';
        }
      } else if (intent === IntentType.ITEM_LOOKUP) {
        searchSubType = 'CLASSIFIED';
      }

      return _makeDecision({
        type: DecisionType.TOOL_CALL,
        intent,
        tools,
        reason: `Intent ${intent} requires tool execution before response`,
        confidence: 0.9,
        metadata: {
          inputPreview: input.substring(0, 100),
          intentContinuity: lastIntent === intent,
          retryCount,
          searchSubType,  // v62.2: NEWS/SPEC/COMPARISON/FACTUAL_NUMERIC/PERSON/CLASSIFIED/GENERAL
          // v44.3 - Project scope for all decisions when project is active
          projectScope,
          projectDominant: !!hasActiveProject,
        },
      });
    }

    // v94: CODE_ANALYSIS — search code, build context, LLM analysis
    if (intent === IntentType.CODE_ANALYSIS) {
      return _makeDecision({
        type: DecisionType.TOOL_CALL,
        intent,
        tools: [],  // Handler manages its own pipeline (search→context→LLM)
        reason: 'CODE_ANALYSIS — code search + multi-file context + LLM analysis',
        confidence: llmMeta?.confidence || 0.9,
        metadata: {
          inputPreview: input.substring(0, 100),
          handler: 'code_analysis',
          projectScope,
        },
      });
    }

    // CODE intent - always needs context or clarification
    if (intent === IntentType.CODE) {
      if (hasActiveProject) {
        // ════════════════════════════════════════════════════════════════════
        // v90: CODE→BUILD escalation — multi-file project scope detected
        // If the request mentions 3+ components or explicit project-scope
        // patterns, escalate to BUILD pipeline (D1→CODE→BUILD_VERIFY→R2→R1)
        // instead of single-file TOOL_CALL.
        // ════════════════════════════════════════════════════════════════════
        const isProjectScope = await _getIsProjectScopeBuild();
        if (isProjectScope(input)) {
          _diag.overrides.push('code_to_build_escalation');
          return _makeDecision({
            type: DecisionType.PLAN,
            intent: IntentType.BUILD,
            reason: 'CODE intent escalated to BUILD — multi-file project scope detected',
            confidence: 0.85,
            metadata: {
              escalatedFromCode: true,
              projectScope,
              projectDominant: true,
            },
          });
        }

        return _makeDecision({
          type: DecisionType.TOOL_CALL,
          intent,
          tools,
          reason: 'Code operation in active project context',
          confidence: 0.85,
          metadata: {
            // v44.3 - Project scope is DOMINANT for CODE intent
            projectScope,
            projectDominant: true,
            enforceSandbox: true,  // Signal to ToolExecutor that sandbox is mandatory
          },
        });
      }

      // ════════════════════════════════════════════════════════════════════
      // v58.1 Fix #3: Imperative + artifact → ANSWER (inline code)
      // "Napiš HTTP server v Node.js" → user wants CODE, not "vyberte záměr"
      // ASK_USER only for truly ambiguous: "něco s Pythonem", "pomoz s kódem"
      // NOTE: No \b boundaries — broken with Czech diacritics (š, ž, etc.)
      // ════════════════════════════════════════════════════════════════════
      const IMPERATIVE_WITH_ARTIFACT = /(napi[sš]|vytvo[rř]|ud[eě]lej|implementuj|naprogramuj|write|create|implement|code|build)\s.{0,30}(server|api|funkc[ie]|function|script|komponent|component|modul|class|tříd|endpoint|handler|parser|crawler|bot|cli|app|regex|regexp|valid[áa]t|valid[áa]ci|test|query|sql|algorit)/i;
      const IMPERATIVE_WITH_LANG = /(napi[sš]|vytvo[rř]|ud[eě]lej|write|create|implement)\s.{0,40}(python|node|javascript|typescript|java|c\+\+|rust|go|ruby|php|bash|sql|html|css|react|vue|angular|swift|kotlin)/i;

      if (isDeterministicInlineCode || IMPERATIVE_WITH_ARTIFACT.test(input) || IMPERATIVE_WITH_LANG.test(input)) {
        return _makeDecision({
          type: DecisionType.ANSWER,
          intent,
          reason: 'Code intent with clear imperative + artifact — inline code response (no project needed)',
          confidence: 0.85,
          metadata: {
            inlineCode: true,
            noProjectRequired: true,
          },
        });
      }

      // Truly ambiguous CODE — need clarification
      return _makeDecision({
        type: DecisionType.ASK_USER,
        intent,
        slots: ['project_context', 'file_path'],
        reason: 'Code intent requires project context - asking user to specify',
        confidence: 0.7,
      });
    }

    // AMBIGUOUS - need clarification
    if (intent === IntentType.AMBIGUOUS) {
      return _makeDecision({
        type: DecisionType.ASK_USER,
        intent,
        slots: ['intent_clarification'],
        reason: 'Cannot determine intent from input',
        confidence: 0.5,
      });
    }

    // CONVERSATIONAL - only case where direct ANSWER is allowed
    if (intent === IntentType.CONVERSATIONAL) {
      return _makeDecision({
        type: DecisionType.ANSWER,
        intent,
        reason: 'Pure conversational input - direct response allowed',
        confidence: 0.9,
      });
    }

    // Default: ask for clarification
    return _makeDecision({
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

  // v72: Runtime guard — catch forgotten `await` on async decide()
  if (decision instanceof Promise || typeof decision?.then === 'function') {
    throw new Error(
      'ASYNC_DECIDE_NOT_AWAITED: decide() returned a Promise — you forgot `await`. ' +
      'All callers must use `await creDecisionEngine.decide(...)` since v71.0.'
    );
  }

  if (!decision.type || !DecisionType[decision.type]) {
    throw new Error(`INVALID_DECISION: Unknown decision type "${decision.type}"`);
  }

  if (!decision.intent || !IntentType[decision.intent]) {
    throw new Error(`INVALID_DECISION: Unknown intent type "${decision.intent}"`);
  }

  // CRITICAL INVARIANT: ANSWER only for CONVERSATIONAL, CREATIVE, DESIGN, or CODE
  // v44.8: CREATIVE is also a direct-answer intent (ideation, not web search)
  // v58.0: DESIGN intent also uses ANSWER (structured synthesis, no tools)
  // v58.1: CODE intent uses ANSWER for imperative+artifact (inline code)
  const ANSWER_ALLOWED_INTENTS = [IntentType.CONVERSATIONAL, IntentType.CREATIVE, IntentType.DESIGN, IntentType.CODE];
  if (decision.type === DecisionType.ANSWER && !ANSWER_ALLOWED_INTENTS.includes(decision.intent)) {
    throw new Error(
      `INVALID_DECISION_FLOW: ANSWER decision for intent "${decision.intent}". ` +
      `ANSWER is only valid for CONVERSATIONAL, CREATIVE, DESIGN, or CODE intents.`
    );
  }

  // v44.8 INVARIANT: CREATIVE must NEVER use TOOL_CALL
  // CREATIVE wants ideas/inspiration - not web search!
  if (decision.intent === IntentType.CREATIVE && decision.type === DecisionType.TOOL_CALL) {
    throw new Error(
      `CREATIVE_MUST_NOT_SEARCH: CREATIVE intent must use ANSWER, not TOOL_CALL. ` +
      `User wants ideas/inspiration, not web search results.`
    );
  }

  // v44.7 INVARIANT: LOCAL decision must have LOCAL or FILE/SHELL intent
  // v63.0: FILE_READ and FILE_EXPLAIN are also terminal (no web, no tools)
  // v65.0: SHELL is terminal (execute in terminal)
  // v70: FILE_WRITE is terminal (write to filesystem)
  const LOCAL_VALID_INTENTS = [IntentType.LOCAL, IntentType.FILE_READ, IntentType.FILE_EXPLAIN, IntentType.SHELL, IntentType.FILE_WRITE];
  if (decision.type === DecisionType.LOCAL && !LOCAL_VALID_INTENTS.includes(decision.intent)) {
    throw new Error(
      `INVALID_DECISION_FLOW: LOCAL decision for non-LOCAL intent "${decision.intent}". ` +
      `LOCAL decision type is only for LOCAL/FILE_READ/FILE_EXPLAIN/SHELL/FILE_WRITE intents.`
    );
  }

  // TOOL_CALL must have tools
  if (decision.type === DecisionType.TOOL_CALL && (!decision.tools || decision.tools.length === 0)) {
    throw new Error(
      `INVALID_DECISION: TOOL_CALL decision without tools for intent "${decision.intent}"`
    );
  }

  // v44.7: LOCAL must NOT have tools
  if (decision.type === DecisionType.LOCAL && decision.tools && decision.tools.length > 0) {
    throw new Error(
      `INVALID_DECISION: LOCAL decision must not have tools (got: ${decision.tools.join(', ')}). ` +
      `LOCAL is direct computation, not tool execution.`
    );
  }

  // ASK_USER should have slots
  if (decision.type === DecisionType.ASK_USER && (!decision.slots || decision.slots.length === 0)) {
    logger.warn('CREDecision', 'ASK_USER decision without slots - may confuse user', {
      intent: decision.intent,
      reason: decision.reason,
    });
  }

  // PLAN decision must have BUILD intent
  if (decision.type === DecisionType.PLAN && decision.intent !== IntentType.BUILD) {
    throw new Error(
      `INVALID_DECISION_FLOW: PLAN decision for non-BUILD intent "${decision.intent}". ` +
      `PLAN decision type routes to Planner pipeline, only valid for BUILD intent.`
    );
  }

  // BUILD intent must use PLAN decision (never TOOL_CALL or ANSWER)
  if (decision.intent === IntentType.BUILD && decision.type !== DecisionType.PLAN) {
    throw new Error(
      `BUILD_MUST_USE_PLAN: BUILD intent must use PLAN decision, not ${decision.type}. ` +
      `BUILD routes to Planner pipeline (D1→CODE→R2→R1), not Chat tools.`
    );
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
  // v45.0 KOLO 3: Response Intent
  ResponseIntent,
  detectResponseIntent,
  // v45.0 KOLO 3: Question Budget
  isTaskClear,
  shouldOfferExpansion,
  getExpansionOfferText,
  // v45.0 KOLO 4.4: Curiosity Budget (Implicit Offers)
  ImplicitOfferType,
  shouldIncludeImplicitOffer,
  getImplicitOffer,
  validateImplicitOffer,
  FORBIDDEN_PHRASES,
  // v58.0: DESIGN
  DESIGN_FORBIDDEN_PHRASES,
  DESIGN_CONTINUE_PATTERNS,
  // v57.3: Reformulation
  REFORMULATION_PATTERNS,
  CREDecision,
  CREDecisionEngine,
  creDecisionEngine,
  assertDecision,
  assertNoDirectAnswer,
  // v58.3: Typo normalization
  normalizeForClassification,
};
