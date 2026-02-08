// CRE v56.2 Sprint A — Decision Engine (Intent Routing Fixes)
// ══════════════════════════════════════════════════════════════════════════════
//
// v56.2 Sprint A changes:
//   - SELF_REFERENCE_PATTERNS → CONVERSATIONAL ("Jak se jmenuju?" no longer web-searched)
//   - STATEMENT_PATTERNS → CONVERSATIONAL ("Moje jméno je X" no longer AMBIGUOUS)
//   - KNOWLEDGE_PATTERNS → SEARCH ("Řekni mi o X" now triggers web search)
//   - Two-tier catch-all: compound phrases (tier1) + length-gated question words (tier2)
//   - Bare "Opravdu?", "Proč?", "Co?" → AMBIGUOUS (not SEARCH)
//   - \b replaced with (?:^|\s) for Czech diacritics compatibility
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
//
// CHANGELOG:
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
  // v57.3 - Accountant expert tools (deterministic, no LLM)
  TAX_CALCULATOR: 'accountant.tax_calculator',
  VAT_CALCULATOR: 'accountant.vat_calculator',
  SALARY_CALCULATOR: 'accountant.salary_calculator',
  DEADLINE_CHECKER: 'accountant.deadline_checker',
  COMPARE_TAX_ENTITIES: 'accountant.compare_tax_entities',
  COMPARE_SALARIES: 'accountant.compare_salaries',
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
  /počasí/i, /pocasi/i, /weather/i,
  /kurz/i, /exchange rate/i,
  /akcie/i, /stock/i,
  /bitcoin/i, /crypto/i, /krypto/i,
  /zpráv[ay]/i, /zprav[ay]?/i, /news/i,    // v57.3: "zpravy" + "zprav" without diacritics
  /výsledk[yů]/i, /vysledk/i, /results/i, /score/i,
  /statistik/i, /statistic/i,
  /novinky/i,                                // v57.3: "novinky" (Czech news)
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

  // Section-specific drill-down
  /jak\s+.{0,15}(test|deploy|CI|bezpe[cč]|architektur)/i,
  /co\s+s\s+.{0,15}(test|deploy|CI|bezpe[cč])/i,
  /(?:a\s+)?co\s+.{0,10}(rizik|alternativ)/i,

  // Modification requests
  /zm[eě][nň]\s+.{0,15}(stack|technologi|framework)/i,
  /m[ií]sto\s+.{0,15}(Flutter|React|Kotlin|Swift|Next|Node)/i,
  /pou[zž]ij\s+rad[eě]ji/i,
  /p[rř]idej\s+.{0,15}(sprint|f[aá]zi|krok|sekci)/i,
  /co\s+kdybych\s+.{0,15}(cht[eě]l|pou[zž]il|zm[eě]nil)/i,

  // Continuation / next step
  /dal[sš][ií]\s+(krok|sprint|f[aá]ze)/i,
  /co\s+d[aá]l/i,

  // EN
  /more\s+detail/i,
  /break.*down/i,
  /what\s+about\s+(test|deploy|CI|security)/i,
  /change\s+.{0,15}(stack|tech|framework)/i,
  /use\s+.{0,15}instead/i,
  /next\s+(step|sprint|phase)/i,
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
  // Greetings
  /^(ahoj|čau|nazdar|hi|hello|hey)[\s!.?]*$/i,
  /^(díky|děkuji|thanks|thank you)[\s!.?]*$/i,
  /^(jak se máš|how are you)/i,
  /^(co si myslíš|what do you think)/i,
  /tvůj názor/i, /your opinion/i,

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
];

// v44.4 - Patterns for locally-answerable questions (no web search needed)
// v44.7 - Extended with more patterns for deterministic local computation
const LOCAL_DETERMINISTIC_PATTERNS = [
  // Date/time questions
  /kolik.*(hodin|dní|týdn|měsíc)/i,      // "za kolik dní"
  /kdy.*bude.*(úplněk|nov|měsíc)/i,      // "kdy bude úplněk"
  /kdy.*uplnek/i,                         // "kdy bude uplnek" (without diacritics)
  /jak[ýéae].*(den|datum|rok|měsíc)/i,    // "jaký je dnes den", "jaké je datum"
  /dnes.*datum/i,                          // "jaké je dnes datum"
  /kolikátého/i,                          // "kolikátého je"
  /what.*day/i, /what.*date/i, /what.*time/i,
  // Calendar/astronomy (deterministic calculations)
  /fáze měsíce/i, /moon phase/i,
  /za kolik dní/i,                        // "za kolik dní bude..."
  /kolik dní do/i,                        // "kolik dní do vánoc"
  /úplněk/i, /uplnek/i,                   // "kdy bude úplněk" direct match
  /nov[ýéě]h?o?\s+měsíc/i,                // "nový měsíc", "nového měsíce" (NOT "novinek za měsíc")
  // Math calculations
  /kolik je \d+/i, /\d+\s*[+\-*/]\s*\d+/,     // "kolik je 5+3", "5+3", "5 + 3"
  /vypočítej/i, /spočítej/i, /calculate\s+\d/i,
  // v44.7 FIX 3: Additional LOCAL patterns
  /napi[sš]\s*(mi\s+)?č[ií]slo/i,         // "napiš číslo", "napiš mi číslo"
  /bez\s*odkaz[ůu]/i,                     // "bez odkazů"
  /jen\s*datum/i,                         // "jen datum"
  /pouze\s*datum/i,                       // "pouze datum"
  /rovnou\s*(č[ií]slo|datum|odpov)/i,    // "rovnou číslo", "rovnou odpověď"
  /přímou\s*odpověď/i,                    // "přímou odpověď"
  /kolik.*hodin/i,                        // "kolik je hodin"
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
    const ANSWER_ALLOWED_INTENTS = [IntentType.CONVERSATIONAL, IntentType.CREATIVE, IntentType.DESIGN];
    if (type === DecisionType.ANSWER && !ANSWER_ALLOWED_INTENTS.includes(intent)) {
      const error = new Error(
        `ANSWER_NOT_ALLOWED_FOR_INTENT: Cannot create ANSWER decision for intent "${intent}". ` +
        `ANSWER is ONLY allowed for CONVERSATIONAL or CREATIVE intent. Use TOOL_CALL or ASK_USER instead.`
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
  }

  /**
   * Classify the intent of user input
   * @param {string} input - User message
   * @returns {IntentType}
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

    // ════════════════════════════════════════════════════════════════════════
    // v44.6 FIX 3: LOCAL INTENT HAS ABSOLUTE PRIORITY
    // ════════════════════════════════════════════════════════════════════════
    // "kdy bude úplněk?" MUST be LOCAL, not SEARCH
    // These are deterministic calculations - no external API needed
    // ════════════════════════════════════════════════════════════════════════
    if (LOCAL_DETERMINISTIC_PATTERNS.some(p => p.test(text))) {
      return IntentType.LOCAL;
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

    // v58.0: DESIGN — structured synthesis (architecture, roadmap, plan)
    // MUST be BEFORE CREATIVE_IDEATION — "navrhni architekturu" is DESIGN,
    // not CREATIVE. DESIGN patterns are more specific (require tech nouns).
    // Generic "navrhni" falls through to CREATIVE.
    // ════════════════════════════════════════════════════════════════════════
    if (DESIGN_PATTERNS.some(p => p.test(text))) {
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
    if (REPORT_PATTERNS.some(p => p.test(text))) {
      return IntentType.REPORT;
    }

    // FACTUAL patterns
    if (FACTUAL_PATTERNS.some(p => p.test(text))) {
      return IntentType.FACTUAL;
    }

    // SEARCH patterns
    if (SEARCH_PATTERNS.some(p => p.test(text))) {
      return IntentType.SEARCH;
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
    // v56.2 Sprint A: STRICT question-word catch-all
    // ════════════════════════════════════════════════════════════════════════
    // BEFORE v56.2: /\?|jak|co|kdo|kde|kdy|proč|how|what|who|where|when|why/
    // This was too aggressive — matched "Jak se máš?", "Co děláš?", "Opravdu?"
    //
    // NOW: Two-tier approach:
    // Tier 1: Compound info-seeking phrases → always SEARCH
    // Tier 2: Question words in substantive text (>15 chars, 3+ words) → SEARCH
    //         Short/bare question words → AMBIGUOUS
    // ════════════════════════════════════════════════════════════════════════

    // Tier 1: Compound phrases (high confidence → SEARCH)
    // NOTE: Cannot use \b with non-ASCII chars (č, ľ, ó, ñ, é etc. are \W in JS).
    //       Use (?:^|\s) for start boundary and (?:\s|[?!.,;]|$) for end.
    // CZ (ASCII-safe subset can use \b)
    if (/\b(co je|co jsou|co to je|kdo je|kdo byl|kde je|kde jsou|kdy bude|kdy je|kdy byl|jak funguje|jak fungují|jak se dělá|jak se tvoří|jak vzniká)\b/i.test(text) ||
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
        /\b(what is|what are|what was|who is|who was|where is|where are|when is|when was|how does|how do|how is|why is|why are|why does|how many|how much|which is)\b/i.test(text)) {
      return IntentType.SEARCH;
    }

    // Tier 2: Question words in substantive input (length-gated)
    // "Kdo vyhrál MS?" = 3 words, 15 chars → SEARCH
    // "Proč?" = 1 word, 5 chars → AMBIGUOUS
    // "Ok" = no question word → AMBIGUOUS
    // NOTE: Cannot use \b for Czech/Slovak words — č/ř/ž etc. are \W in JS regex.
    const hasQuestionWord = /(?:^|\s)(jak[áéýoui]?|co|kdo|kde|kdy|proč|kolik|čo|kto|ako|kedy|prečo|koľko|ak[áéý]|was|wer|wo|wann|wie|warum|welch|wieviel|jaki?e?|kto|gdzie|kiedy|dlaczego|ile|qu[eéi]|qui|où|quand|comment|combien|pourquoi|quel|qué|quién|dónde|cuándo|cómo|cuánto|por qué|how|what|who|where|when|why|which)(?:\s|[?!.,;]|$)/i.test(text);
    const wordCount = text.split(/\s+/).length;
    if (hasQuestionWord && text.length > 12 && wordCount >= 3) {
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
        if (/\d+.*[+\-*/].*\d+|vypočít|spočít|calculate/i.test(input)) {
          return [ToolType.LOCAL_MATH];
        }
        return [ToolType.LOCAL_DATE]; // Default to date

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
   * @param {string} input - User message
   * @param {Object} context - Additional context
   * @returns {CREDecision}
   */
  decide(input, context = {}) {
    let intent = this.classifyIntent(input);

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
    const awaitingSlots = context.awaitingSlots || context.sessionState?.awaitingSlots || [];
    const retryCount = context.retryCount ?? 0;

    // Only block sticky intent for actual intent clarification, not tool failure alternatives
    const blockStickyIntent = awaitingSlots.includes('intent_clarification');

    // v44.7 FIX: Strong intents NEVER get overridden by sticky intent
    // LOCAL and CONVERSATIONAL are terminal - they should not be changed by context
    // v44.8: Added CREATIVE - ideation requests must not be overridden by sticky SEARCH
    // v45.0: Added ITEM_LOOKUP - explicit item requests must not be overridden by REPORT
    // v58.0: Added DESIGN - structured synthesis must not fall to SEARCH
    const STRONG_INTENTS = [IntentType.LOCAL, IntentType.CONVERSATIONAL, IntentType.CREATIVE, IntentType.ITEM_LOOKUP, IntentType.DESIGN];
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
    if (lastIntent === IntentType.DESIGN && !exceptDesignFollowUp.includes(intent)) {
      const isDesignFollowUp = DESIGN_CONTINUE_PATTERNS.some(p => p.test(input.trim()));

      if (isDesignFollowUp) {
        logger.info('CREDecision', 'DESIGN follow-up detected, maintaining DESIGN intent', {
          input: input.substring(0, 50),
          classifiedAs: intent,
          maintainingAs: IntentType.DESIGN,
        });
        intent = IntentType.DESIGN;
      }
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
      /^(chci|potřebuju|potrebuju)\s/i,       // "chci najít...", "potřebuju..."
      /^(now|switch|change)\s/i,              // English: "now find...", "switch to..."
      /\d+\s*(inzerát|nabíd|produkt|auto)/i,  // Explicit item request always breaks
    ];

    // v44.7: Skip sticky intent if we have a strong intent (LOCAL, CONVERSATIONAL)
    // v45.0: Also skip if INTENT_BREAK_PATTERNS match (user starting new task)
    const isIntentBreak = INTENT_BREAK_PATTERNS.some(p => p.test(input.trim()));
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
        intent = lastIntent;
      }

      // v44.6 FIX 7: Check for continuation patterns (follow-up questions)
      if (SEARCH_CONTINUATION_PATTERNS.some(p => p.test(input.trim()))) {
        logger.info('CREDecision', `Continuation detected, maintaining ${lastIntent}`, {
          input: input.substring(0, 50),
          pattern: 'SEARCH_CONTINUATION',
        });
        intent = lastIntent;
      }
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
      if (/měsíc|úplněk|uplnek|nov|moon|fáze/i.test(input)) {
        handler = 'local.calendar';
      } else if (/\d+.*[+\-*/].*\d+|vypočít|spočít|calculate/i.test(input)) {
        handler = 'local.math';
      } else if (/datum|den|hodin|time|date/i.test(input)) {
        handler = 'local.date';
      }

      return new CREDecision({
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

    // v58.0: DESIGN is TERMINAL — structured synthesis, NEVER web search
    // ════════════════════════════════════════════════════════════════════════
    // "navrhni architekturu", "udělej roadmapu", "rozděl na sprinty"
    // User wants STRUCTURED PLAN from LLM knowledge, not web results.
    // DESIGN uses ANSWER (no tools), with specialized system prompt.
    // ════════════════════════════════════════════════════════════════════════
    if (intent === IntentType.DESIGN) {
      return new CREDecision({
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
    // v44.8 FIX: CREATIVE is TERMINAL - direct answer, NEVER web search
    // ════════════════════════════════════════════════════════════════════════
    // "vymyslet kampaň", "dej mi nápady", "navrhni příběh"
    // User wants IDEAS, INSPIRATION, DESIGN - not web search results!
    // ════════════════════════════════════════════════════════════════════════
    if (intent === IntentType.CREATIVE) {
      return new CREDecision({
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
    // BUILD → PLAN: Route to Planner pipeline (D1→CODE→R2→R1)
    // ════════════════════════════════════════════════════════════════════════
    // "postav mi X", "deploy Y", "scaffold projekt"
    // Chat Agent doesn't build — it hands off to Planner with confirmation
    // ════════════════════════════════════════════════════════════════════════
    if (intent === IntentType.BUILD) {
      return new CREDecision({
        type: DecisionType.PLAN,
        intent,
        tools: [],                  // No Chat tools — Planner has its own pipeline
        reason: 'BUILD intent detected — handoff to Planner pipeline',
        confidence: 0.9,
        metadata: {
          inputPreview: input.substring(0, 200),
          buildRequest: true,
          projectScope,
        },
      });
    }

    // INVARIANT 2: SEARCH/FACT/REPORT/ITEM_LOOKUP = TOOL_CALL first
    // v45.0: Added ITEM_LOOKUP - requires web search to find specific items
    if ([IntentType.SEARCH, IntentType.FACTUAL, IntentType.REPORT, IntentType.ITEM_LOOKUP].includes(intent)) {
      return new CREDecision({
        type: DecisionType.TOOL_CALL,
        intent,
        tools,
        reason: `Intent ${intent} requires tool execution before response`,
        confidence: 0.9,
        metadata: {
          inputPreview: input.substring(0, 100),
          intentContinuity: lastIntent === intent,
          retryCount,
          // v44.3 - Project scope for all decisions when project is active
          projectScope,
          projectDominant: !!hasActiveProject,
        },
      });
    }

    // CODE intent - always needs context or clarification
    if (intent === IntentType.CODE) {
      if (hasActiveProject) {
        return new CREDecision({
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

  // CRITICAL INVARIANT: ANSWER only for CONVERSATIONAL or CREATIVE
  // v44.8: CREATIVE is also a direct-answer intent (ideation, not web search)
  const ANSWER_ALLOWED_INTENTS = [IntentType.CONVERSATIONAL, IntentType.CREATIVE];
  if (decision.type === DecisionType.ANSWER && !ANSWER_ALLOWED_INTENTS.includes(decision.intent)) {
    throw new Error(
      `INVALID_DECISION_FLOW: ANSWER decision for intent "${decision.intent}". ` +
      `ANSWER is only valid for CONVERSATIONAL or CREATIVE intents.`
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

  // v44.7 INVARIANT: LOCAL decision must have LOCAL intent
  if (decision.type === DecisionType.LOCAL && decision.intent !== IntentType.LOCAL) {
    throw new Error(
      `INVALID_DECISION_FLOW: LOCAL decision for non-LOCAL intent "${decision.intent}". ` +
      `LOCAL decision type is only for LOCAL intent.`
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
};
