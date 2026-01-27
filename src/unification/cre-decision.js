// CRE v44.10 — Decision Engine
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
//
// CHANGELOG:
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
  /tell me.*(about|a joke|a story)/i,              // "tell me a story"
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
];

const REPORT_PATTERNS = [
  /vytvoř.*report/i, /create.*report/i,
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
  /nov.*měsíc/i,                          // "kdy bude nov"
  // Math calculations
  /kolik je \d+/i, /\d+ [+\-*/] \d+/,     // "kolik je 5+3"
  /vypočítej/i, /spočítej/i, /calculate/i,
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
    const ANSWER_ALLOWED_INTENTS = [IntentType.CONVERSATIONAL, IntentType.CREATIVE];
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

    // ════════════════════════════════════════════════════════════════════════
    // v44.8 FIX: CREATIVE/IDEATION - MUST be before SEARCH!
    // ════════════════════════════════════════════════════════════════════════
    // "vymyslet kampaň", "dej mi nápady", "navrhni příběh"
    // These want IDEAS, not web search results!
    // ════════════════════════════════════════════════════════════════════════
    if (CREATIVE_IDEATION_PATTERNS.some(p => p.test(text))) {
      return IntentType.CREATIVE;
    }

    // CODE patterns
    if (CODE_PATTERNS.some(p => p.test(text))) {
      return IntentType.CODE;
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
    const STICKY_INTENTS = [IntentType.REPORT, IntentType.SEARCH, IntentType.FACTUAL];
    const lastIntent = context.lastIntent || context.conversationState?.lastIntent;
    const awaitingSlots = context.awaitingSlots || context.sessionState?.awaitingSlots || [];
    const retryCount = context.retryCount ?? 0;

    // Only block sticky intent for actual intent clarification, not tool failure alternatives
    const blockStickyIntent = awaitingSlots.includes('intent_clarification');

    // v44.7 FIX: Strong intents NEVER get overridden by sticky intent
    // LOCAL and CONVERSATIONAL are terminal - they should not be changed by context
    // v44.8: Added CREATIVE - ideation requests must not be overridden by sticky SEARCH
    const STRONG_INTENTS = [IntentType.LOCAL, IntentType.CONVERSATIONAL, IntentType.CREATIVE];
    const isStrongIntent = STRONG_INTENTS.includes(intent);

    // ════════════════════════════════════════════════════════════════════════
    // v44.9 FIX A: CREATIVE FOLLOW-UP LOCK
    // ════════════════════════════════════════════════════════════════════════
    // When in CREATIVE mode, follow-up questions should STAY in CREATIVE.
    // "jaký to může mít vliv na hráče?" after "vymysli kampaň" = CREATIVE
    // User is exploring THEIR ideation, not asking for web search!
    // ════════════════════════════════════════════════════════════════════════
    if (lastIntent === IntentType.CREATIVE && !isStrongIntent) {
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

    // v44.7: Skip sticky intent if we have a strong intent (LOCAL, CONVERSATIONAL)
    if (!isStrongIntent && STICKY_INTENTS.includes(lastIntent) && !blockStickyIntent) {
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

    // INVARIANT 2: SEARCH/FACT/REPORT = TOOL_CALL first
    if ([IntentType.SEARCH, IntentType.FACTUAL, IntentType.REPORT].includes(intent)) {
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
