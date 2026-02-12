// Decision Sub-Handlers — extracted from handlers.js
// Shared by conversationHandler, projectHandler, expertHandler
//
// Contains: handleToolCallDecision, handleAskUserDecision,
//   handleAnswerDecision, handleRefuseDecision,
//   buildFailureFallback, formatClarificationRequest,
//   createForbiddenResponseError
//
// v56.2 Sprint C1 changes:
//   - enrichSearchQuery(): follow-up queries get lastTurnTopic prepended (#2A/C)
//   - handleAnswerDecision: proper user+assistant history pairs (#12)
//   - toolExecutor.execute calls use effectiveQuery (enriched for follow-ups)

import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from '../controller.js';
import {
  creDecisionEngine,
  DecisionType,
  IntentType,
  FORBIDDEN_PHRASES,
  assertDecision,
  assertNoDirectAnswer,
  ResponseIntent,
  detectResponseIntent,
} from '../cre-decision.js';
import { toolExecutor, ExecutionStatus } from '../../executor/tool-executor.js';
import { logger } from '../../core/logger.js';
import { preferenceEngine, Structure, FollowUpStyle } from '../../memory/preferences.js';
import { synthesizeWithLLM } from './utils/synthesis.js';
import { getLanguageContext } from './utils/language.js';
import { enforceOutputContract, buildOutputGateRetryPrompt } from './utils/output-gate.js';
import { styleWithConfidence, scoreToLevel } from './utils/confidence-styling.js';
import { assertCreativeQuality } from './utils/quality.js';
import { FollowUpType, detectFollowUpType, getPreviousToolData } from './utils/followup.js';
import { assessGoalAlignment } from './clarification.js';
import { buildReportFallback } from './report.js';

// ════════════════════════════════════════════════════════════════════════════════
// v56.2 Sprint C1: Follow-up Search Query Enrichment (#2A/C)
// ════════════════════════════════════════════════════════════════════════════════
// When user sends a follow-up like "A co jeho teorém?", the search query needs
// context from the previous turn. Without this, DDG receives "A co jeho teorém?"
// which returns irrelevant or zero results.
//
// Strategy: Detect follow-up indicators (pronouns, bare references), then prepend
// lastTurnTopic to create a meaningful search query.
//
// Examples:
//   lastTurnTopic: "Pythagoras"
//   input: "A co jeho teorém?" → "Pythagoras teorém"
//   input: "Kdy se narodil?"   → "Pythagoras kdy se narodil"
//   input: "A co Einstein?"    → "Einstein" (has own subject, no enrichment)
// ════════════════════════════════════════════════════════════════════════════════

// Czech/English follow-up indicators — pronouns/references without subject
const FOLLOW_UP_INDICATORS = [
  // CZ: follow-up connectors + pronouns
  /^a (co|jak|kde|kdy|proč)\b/i,      // "A co jeho teorém?"
  /^(a |)(ten|ta|to|ti|ty)\b/i,       // "A ten?"
  /\b(jeho|její|jejich|toho|tomu|tím|tom)\b/i,  // possessive/demonstrative
  /^(kdy|kde|jak|proč) se\b/i,        // "Kdy se narodil?" (no subject)
  // SK: follow-up
  /^a (čo|ako|kde|kedy|prečo)\b/i,    // "A čo jeho teorém?"
  /\b(jeho|jej|ich|toho|tomu|tým|tom)\b/i,  // SK possessive (overlap with CZ)
  /^(kedy|kde|ako|prečo) sa\b/i,      // "Kedy sa narodil?"
  // DE: follow-up
  /^und (was|wie|wo|wann|warum)\b/i,   // "Und was ist mit...?"
  /\b(sein|seine[rmns]?|ihr[ems]?|dessen|deren|davon|damit|darüber)\b/i, // DE pronouns
  /^(wann|wo|wie|warum) (hat|ist|war|wurde)\b/i,  // "Wann wurde er geboren?"
  // PL: follow-up
  /^a (co|jak|gdzie|kiedy|dlaczego)\b/i,  // "A co z jego..."
  /\b(jego|jej|ich|tego|temu|tym)\b/i,     // PL possessive
  /^(kiedy|gdzie|jak|dlaczego) si[ęe]\b/i, // "Kiedy się urodził?"
  // FR: follow-up
  /^et (que|comment|où|quand|pourquoi)\b/i, // "Et que dire de..."
  /\b(son|sa|ses|leur|leurs|celui|celle|ceux|celles|en|y)\b/i, // FR pronouns
  // ES: follow-up
  /^y (qué|cómo|dónde|cuándo|por qué)\b/i, // "¿Y qué hay de..."
  /\b(su|sus|él|ella|ellos|ellas|eso|esto|aquel)\b/i, // ES pronouns
  // EN: follow-up
  /\b(he|his|she|her|its|their|that|those|it)\b/i,    // English pronouns
  /^(when|where|how|why) (did|was|were|is)\b/i,       // "When was he born?"
];

// Patterns that indicate the input has its OWN subject (no enrichment needed)
// Must skip sentence-initial capitalization and question words
const QUESTION_WORDS = /^(co|kdo|kde|kdy|jak|proč|jaký|jaké|která|který|kolik|čo|kto|ako|kedy|prečo|aký|aké|koľko|was|wer|wo|wann|wie|warum|welch|wieviel|co|kto|jak|gdzie|kiedy|dlaczego|ile|jaki|jakie|qu[eéi]|qui|où|quand|comment|pourquoi|combien|quel|qué|quién|dónde|cuándo|cómo|cuánto|what|who|where|when|how|why|which|does|did|is|are|was|were|und|et|a|y|and)\s/i;

function hasOwnSubject(input) {
  // Strip leading question/connector words to find the real subject
  const stripped = input.replace(QUESTION_WORDS, '').trim();

  // Check for proper nouns (capitalized words that aren't sentence-initial)
  // Look for capitalized words NOT at position 0 of stripped text
  const words = stripped.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // Skip first word (might be capitalized just because sentence start)
    if (i === 0 && words.length > 1) continue;
    // Check if word starts with uppercase and is long enough to be a name
    if (/^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]{2,}/.test(w)) {
      return true;
    }
  }

  // Check explicit subject patterns: "co je X", "kdo je X"
  if (/^(co je|kdo je|co jsou|kdo byl|what is|who is|who was)\b/i.test(input)) {
    return true;
  }

  return false;
}

/**
 * v61.2: Detect "meta" follow-ups that carry no meaningful search terms.
 * These are messages like "dej mi to", "jo přesně", "tak ten report",
 * "no to jsem myslel" — the user is asking for the SAME thing, not a new search.
 *
 * @param {string} input
 * @returns {boolean}
 */
function isMetaContinuation(input) {
  const trimmed = input.trim().toLowerCase();

  // Direct meta patterns (CZ/SK/EN/DE/PL)
  const META_PATTERNS = [
    /^(no\s+)?(to\s+)?(jsem\s+myslel|přesně|exactly|genau)/i,
    /^(tak\s+)?(mi\s+)?(to\s+)?(dej|ukaž|pošli|give|show|send)/i,
    /^(jo|ano|yeah?|yes|ja)\s*(,\s*)?(to|přesně|exactly|genau)?/i,
    /^dej\s+(mi\s+)?(ten|to|tu)\s+(report|výsledek|result)/i,
    /^(ukaž|zobraz|pošli)\s+(mi\s+)?(to|ten|tu)/i,
    /^(tak|no)\s+(co|jak)\s+(ten|ta|to)\b/i,
    /^(chci|chtěl)\s+(ten|to|tu)\s+(report|výsledek|result|odpověď)/i,
  ];

  if (META_PATTERNS.some(p => p.test(trimmed))) return true;

  // Heuristic: strip common filler words and check if fewer than 3 content words remain
  const stripped = trimmed
    .replace(/\b(no|tak|jo|ano|a|to|ten|ta|tu|ty|ti|mi|mě|mně|si|se|jsem|myslel|přesně|prosím|dej|ukaž|report|dál|please|just|the|that|it|me|give|show)\b/gi, '')
    .replace(/[,!?.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // If after stripping meta words, fewer than 2 content words remain → meta continuation
  const contentWords = stripped.split(' ').filter(w => w.length > 2);
  return contentWords.length < 2;
}

/**
 * Enrich a follow-up search query with context from the last turn.
 *
 * @param {string} input - Current user input
 * @param {string|null} lastTurnTopic - Topic extracted from previous turn
 * @returns {{ query: string, enriched: boolean, topic: string|null }}
 */
function enrichSearchQuery(input, lastTurnTopic) {
  if (!lastTurnTopic || !input) {
    return { query: input, enriched: false, topic: null };
  }

  // Check if input is a follow-up (has pronouns/references without own subject)
  const isFollowUp = FOLLOW_UP_INDICATORS.some(p => p.test(input));

  if (!isFollowUp || hasOwnSubject(input)) {
    return { query: input, enriched: false, topic: lastTurnTopic };
  }

  // Strip follow-up connectors ("A co", "A jak") and pronouns for cleaner query
  let cleaned = input
    .replace(/^a\s+/i, '')           // strip leading "A "
    .replace(/\b(jeho|její|jejich|he|his|she|her|its|their|that|those|it)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Build enriched query: topic + cleaned follow-up
  const enriched = `${lastTurnTopic} ${cleaned}`.trim();

  logger.info('EnrichQuery', 'Follow-up query enriched with topic', {
    original: input.substring(0, 60),
    enriched: enriched.substring(0, 60),
    topic: lastTurnTopic,
  });

  return { query: enriched, enriched: true, topic: lastTurnTopic };
}

// ════════════════════════════════════════════════════════════════════════════════
// v56.2 Sprint C2: Build conversation context for synthesis (#11)
// ════════════════════════════════════════════════════════════════════════════════
// Transforms history into a lightweight format for the synthesis prompt.
// LLM sees what the user asked and a summary of what was answered,
// so pronouns like "jeho" can be resolved.
// ════════════════════════════════════════════════════════════════════════════════

function buildConversationContext(history) {
  if (!history || !Array.isArray(history) || history.length === 0) {
    return null;
  }

  return history.slice(-3).map(h => ({
    userInput: h.userInput || null,
    // Truncate assistant response to avoid bloating the prompt
    assistantSummary: h.response?.content
      ? h.response.content.substring(0, 150) + (h.response.content.length > 150 ? '...' : '')
      : null,
  })).filter(t => t.userInput || t.assistantSummary);
}

async function handleToolCallDecision(input, decision, context) {
  const { sessionState } = context;

  // v56.2 Sprint C2: Build conversation context for synthesis
  const conversationContext = buildConversationContext(context.history);

  logger.info('HandleToolCall', `Executing TOOL_CALL decision`, {
    tools: decision.tools,
    intent: decision.intent,
    projectDominant: decision.metadata?.projectDominant,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // v45.0 FIX 1.4 — FOLLOW-UP DETECTION
  // ════════════════════════════════════════════════════════════════════════════
  // Detect if this is a FORMAT_CHANGE (reuse previous data) or NEW_QUERY
  // ════════════════════════════════════════════════════════════════════════════
  const followUp = detectFollowUpType(input, sessionState);

  if (followUp.type === FollowUpType.FORMAT_CHANGE && followUp.reusePreviousData) {
    const previousData = getPreviousToolData(sessionState);

    if (previousData) {
      logger.info('HandleToolCall', 'FORMAT_CHANGE detected - reusing previous data', {
        followUpType: followUp.type,
        confidence: followUp.confidence,
      });

      // v45.0: Get optimized preferences from engine
      const optimizedPrefs = preferenceEngine.getPreferencesForSynthesis(decision.intent);

      // v45.0 KOLO 3: Detect ResponseIntent from format change request
      const responseIntent = detectResponseIntent(input, {
        lastResponseIntent: sessionState?.lastResponseIntent,
      });

      // Re-synthesize with new format request but same data
      const synthesizedResponse = await synthesizeWithLLM({
        query: input,
        intent: decision.intent,
        toolResults: previousData,
        context,
        userPreferences: {
          ...optimizedPrefs,
          ...context.userPreferences,
          formatChange: input,  // Pass the format change request
        },
        responseIntent,  // v45.0 KOLO 3: Pass detected responseIntent
        conversationContext,  // v56.2 C2
      });

      // v45.0 KOLO 3: Store responseIntent for next turn
      if (sessionState) {
        sessionState.lastResponseIntent = responseIntent;
      }

      const tag = new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM,
        mode: ChatMode.CONVERSATION,
        confidence: synthesizedResponse.confidence,
        canExecute: false,
        metadata: {
          decision: decision.toJSON(),
          followUpType: followUp.type,
          reusedPreviousData: true,
          synthesized: true,
        },
      });

      return new TaggedResponse({
        content: synthesizedResponse.content,
        tag,
      });
    }
  }

  logger.debug('HandleToolCall', 'Follow-up detection result', {
    type: followUp.type,
    confidence: followUp.confidence,
    reusePreviousData: followUp.reusePreviousData,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // v56.2 Sprint C1: Enrich search query with topic from last turn (#2A/C)
  // v61.2: Also handle meta follow-ups ("dej ten report", "jo, to přesně")
  //        that carry no search content — reuse previous query directly.
  // ════════════════════════════════════════════════════════════════════════════
  const { query: enrichedQuery, enriched: wasEnriched } =
    enrichSearchQuery(input, context.lastTurnTopic);

  let effectiveQuery;
  if (wasEnriched) {
    effectiveQuery = enrichedQuery;
  } else if (context.lastTurnTopic && isMetaContinuation(input)) {
    // v61.2: User sent a meta follow-up with no real search terms
    // ("no to jsem myslel, dej ten report", "jo přesně to", "tak mi to ukaž")
    // → reuse the previous query instead of searching for the literal follow-up
    effectiveQuery = context.lastTurnTopic;
    logger.info('EnrichQuery', 'Meta-continuation detected — reusing previous query', {
      currentInput: input.substring(0, 60),
      reusedQuery: effectiveQuery.substring(0, 60),
    });
  } else {
    effectiveQuery = input;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // v44.4 — PROJECT GOAL ENFORCEMENT (with confirmation)
  // v44.5 — Now blocks on 2nd+ drift instead of just warning
  // ════════════════════════════════════════════════════════════════════════════
  // When project mode is active with a goal, validate that the operation
  // is aligned with the project goal:
  // - 1st drift → ask for confirmation
  // - 2nd+ drift → block operation
  // ════════════════════════════════════════════════════════════════════════════
  const projectGoal = context.projectWorkingMemory?.goal || context.projectGoal;
  if (decision.metadata?.projectDominant && projectGoal && !context.goalDriftConfirmed) {
    const goalAlignment = assessGoalAlignment(input, projectGoal, decision.intent);
    if (!goalAlignment.aligned) {
      // v44.5 - Check if this is 2nd+ drift (should block, not warn)
      const shouldBlock = sessionState?.shouldBlockDrift?.() || false;

      logger.warn('HandleToolCall', 'Operation may drift from project goal', {
        input: input.substring(0, 50),
        goal: projectGoal,
        reason: goalAlignment.reason,
        driftCount: sessionState?.driftCount || 0,
        shouldBlock,
      });

      // v44.5 - On 2nd+ drift, block the operation entirely
      if (shouldBlock) {
        const tag = new ResponseTag({
          speaker: ResponseSpeaker.SYSTEM,
          mode: ChatMode.PROJECT,
          confidence: 1.0,
          canExecute: false,
          metadata: {
            decision: decision.toJSON(),
            goalDriftBlocked: true,
            projectGoal,
            driftCount: sessionState?.driftCount || 0,
          },
        });

        return new TaggedResponse({
          content: `🛑 **Operace zablokována**\n\n` +
                   `Opakovaně se pokoušíte o operace mimo cíl projektu.\n\n` +
                   `**Cíl projektu:** ${projectGoal}\n\n` +
                   `Pro pokračování buď:\n` +
                   `• Formulujte požadavek související s cílem projektu\n` +
                   `• Změňte cíl projektu v nastavení\n` +
                   `• Ukončete projektový režim`,
          tag,
        });
      }

      // 1st drift - Ask for confirmation
      // Increment drift count for next time
      if (sessionState?.incrementDriftCount) {
        sessionState.incrementDriftCount();
      }

      const tag = new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM,
        mode: ChatMode.PROJECT,
        confidence: 0.7,
        canExecute: false,
        metadata: {
          decision: decision.toJSON(),
          goalDrift: true,
          projectGoal,
          awaitingConfirmation: true,
          driftCount: sessionState?.driftCount || 1,
        },
      });

      // Save state for resume after confirmation
      if (sessionState) {
        sessionState.setPendingDecision({
          ...decision,
          type: 'GOAL_DRIFT_CONFIRMATION',
          originalInput: input,
          goalAlignment,
        }, ['goal_drift_confirmation']);
      }

      return new TaggedResponse({
        content: `⚠️ **Operace mimo aktuální cíl projektu**\n\n` +
                 `**Cíl projektu:** ${projectGoal}\n\n` +
                 `**Váš požadavek:** "${input.substring(0, 80)}${input.length > 80 ? '...' : ''}"\n\n` +
                 `Tento požadavek se zdá být mimo aktuální cíl. Chcete pokračovat?\n\n` +
                 `• **Ano** - pokračovat i tak\n` +
                 `• **Ne** - zrušit a vrátit se k cíli`,
        tag,
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // v44.11 — REPORT PIPELINE ORCHESTRATION
  // ════════════════════════════════════════════════════════════════════════════
  // REPORT is NOT a parallel tool call! It's a pipeline:
  // 1. SEARCH → get URLs from search results
  // 2. SCRAPE → fetch content from URLs (only if search succeeded)
  // 3. SYNTHESIZE → build report from scraped content
  //
  // If SEARCH fails → return degraded fallback (no ASK_USER)
  // If SEARCH returns 0 results → return degraded fallback
  // NEVER call SCRAPE without URLs!
  // ════════════════════════════════════════════════════════════════════════════
  if (decision.intent === IntentType.REPORT) {
    logger.info('HandleToolCall', 'REPORT pipeline started', { input: input.substring(0, 50) });

    // v59.0 IDE Bridge: Notify search tool call
    if (typeof context.onToolCall === 'function') {
      try { context.onToolCall('web.search', { query: effectiveQuery, pipeline: 'REPORT' }); } catch { /* */ }
    }

    // Step 1: Execute web.search
    const searchResult = await toolExecutor.execute({
      ...decision,
      tools: ['web.search'],
    }, {
      input,
      query: effectiveQuery,  // v56.2 C1: enriched follow-up
      sessionId: context.sessionId,
      projectGoal,
      ...context,
    });

    // v59.0 IDE Bridge: Notify search result
    if (typeof context.onToolResult === 'function') {
      const _sr = searchResult.toolResults?.find(r => r.type === 'search');
      try {
        context.onToolResult('web.search', {
          success: !!(_sr?.success),
          durationMs: searchResult.duration,
          summary: `${_sr?.data?.results?.length || 0} results`,
        });
      } catch { /* */ }
    }

    // Check if search succeeded and returned results
    // v45.0 FIX: ToolResult uses 'type', not 'tool'
    const searchData = searchResult.toolResults?.find(r => r.type === 'search');
    const hasResults = searchData?.success && searchData?.data?.results?.length > 0;

    if (!hasResults) {
      // Search failed or returned no results → return REPORT fallback
      logger.warn('HandleToolCall', 'REPORT pipeline: search failed or no results', {
        status: searchResult.status,
        hasData: !!searchData,
        resultCount: searchData?.data?.results?.length || 0,
      });

      return buildReportFallback(input, decision, searchResult, context);
    }

    // Step 2: Extract URLs from search results (max 5)
    const urls = searchData.data.results
      .filter(r => r.url && r.url.startsWith('http'))
      .slice(0, 5)
      .map(r => r.url);

    logger.info('HandleToolCall', 'REPORT pipeline: scraping URLs', {
      urlCount: urls.length,
      urls: urls.slice(0, 3),
    });

    // Step 3: Execute web.scrape with URLs (if we have any)
    let scrapeResults = [];
    if (urls.length > 0) {
      const scrapeResult = await toolExecutor.execute({
        ...decision,
        tools: ['web.scrape'],
      }, {
        input,
        urls,  // Pass URLs, not query!
        sessionId: context.sessionId,
        projectGoal,
        ...context,
      });

      scrapeResults = scrapeResult.toolResults || [];
    }

    // Step 4: SYNTHESIZE with LLM (v45.0 FIX - REPORT must use LLM, not string concatenation!)
    // ════════════════════════════════════════════════════════════════════════════
    // CRITICAL: REPORT = SYNTHESIS, not data dump!
    // LLM must:
    //   1. Analyze the scraped content
    //   2. Extract key points relevant to the query
    //   3. Synthesize a coherent summary
    //   4. NOT just list sources/links
    // ════════════════════════════════════════════════════════════════════════════

    // Prepare tool results for LLM synthesis
    const successfulScrapes = scrapeResults.filter(r => r.success);
    const allToolResults = [
      searchData,
      ...successfulScrapes,
    ].filter(Boolean);

    // v61.2: When scrapes mostly fail, log warning and hint synthesis to use snippets
    const scrapeSuccessRate = urls.length > 0 ? successfulScrapes.length / urls.length : 0;
    if (scrapeSuccessRate < 0.4 && urls.length > 0) {
      logger.warn('HandleToolCall', 'REPORT pipeline: most scrapes failed — synthesis uses snippets only', {
        attempted: urls.length,
        succeeded: successfulScrapes.length,
        rate: scrapeSuccessRate,
      });
    }

    // Get user preferences and expert hints from context
    const userPreferences = context.userPreferences || {};
    const expertHints = context.expertHints || null;
    const responseIntent = decision.responseIntent || ResponseIntent.SUMMARY;

    // v61.2: When scrapes mostly failed, add hint to synthesis context
    // so LLM extracts maximum info from search snippets
    const synthesisContext = scrapeSuccessRate < 0.4 && urls.length > 0
      ? { ...context, snippetOnlyMode: true }
      : context;

    // Call LLM for actual synthesis
    const synthesisResult = await synthesizeWithLLM({
      query: input,
      intent: decision.intent,
      toolResults: allToolResults,
      context: synthesisContext,
      userPreferences,
      expertHints,
      responseIntent,
      conversationContext,  // v56.2 C2
    });

    logger.info('HandleToolCall', 'REPORT synthesis complete', {
      query: input.substring(0, 50),
      synthesisLength: synthesisResult.content?.length || 0,
      confidence: synthesisResult.confidence,
    });

    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION,
      confidence: synthesisResult.confidence || decision.confidence,
      canExecute: false,
      metadata: {
        decision: decision.toJSON(),
        pipeline: 'REPORT',
        searchResults: searchData?.data?.results?.length || 0,
        scrapedUrls: urls.length,
        synthesisModel: synthesisResult.model,
      },
    });

    // Record successful decision
    if (sessionState) {
      sessionState.recordDecision(decision, input);
    }

    return new TaggedResponse({
      content: synthesisResult.content,
      tag,
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // v45.0: ITEM_LOOKUP PIPELINE
  // ════════════════════════════════════════════════════════════════════════════
  // Similar to REPORT but output must be SPECIFIC ITEMS with links
  // User asked for "4 inzeráty" → must return 4 actual listings
  // ════════════════════════════════════════════════════════════════════════════
  if (decision.intent === IntentType.ITEM_LOOKUP) {
    logger.info('HandleToolCall', 'ITEM_LOOKUP pipeline started', { input: input.substring(0, 50) });

    // v59.0 IDE Bridge: Notify search tool call
    if (typeof context.onToolCall === 'function') {
      try { context.onToolCall('web.search', { query: effectiveQuery, pipeline: 'ITEM_LOOKUP' }); } catch { /* */ }
    }

    // Step 1: Execute web.search
    const searchResult = await toolExecutor.execute({
      ...decision,
      tools: ['web.search'],
    }, {
      input,
      query: effectiveQuery,  // v56.2 C1: enriched follow-up
      sessionId: context.sessionId,
      projectGoal,
      ...context,
    });

    // Check if search succeeded
    const searchData = searchResult.toolResults?.find(r => r.type === 'search');

    // v59.0 IDE Bridge: Notify search result
    if (typeof context.onToolResult === 'function') {
      try {
        context.onToolResult('web.search', {
          success: !!(searchData?.success),
          durationMs: searchResult.duration,
          summary: `${searchData?.data?.results?.length || 0} results`,
        });
      } catch { /* */ }
    }

    const hasResults = searchData?.success && searchData?.data?.results?.length > 0;

    if (!hasResults) {
      logger.warn('HandleToolCall', 'ITEM_LOOKUP pipeline: search failed or no results', {
        status: searchResult.status,
        hasData: !!searchData,
        resultCount: searchData?.data?.results?.length || 0,
      });

      return buildReportFallback(input, decision, searchResult, context);
    }

    // Step 2: Extract URLs - prioritize marketplace/listing sites
    const urls = searchData.data.results
      .filter(r => r.url && r.url.startsWith('http'))
      .slice(0, 8) // More URLs for item lookup to find actual listings
      .map(r => r.url);

    logger.info('HandleToolCall', 'ITEM_LOOKUP pipeline: scraping URLs', {
      urlCount: urls.length,
      urls: urls.slice(0, 3),
    });

    // Step 3: Execute web.scrape
    let scrapeResults = [];
    if (urls.length > 0) {
      const scrapeResult = await toolExecutor.execute({
        ...decision,
        tools: ['web.scrape'],
      }, {
        input,
        urls,
        sessionId: context.sessionId,
        projectGoal,
        ...context,
      });

      scrapeResults = scrapeResult.toolResults || [];
    }

    // Step 4: SYNTHESIZE with LLM - but with ITEM_LOOKUP prompt (extract items, not synthesize)
    const allToolResults = [
      searchData,
      ...scrapeResults.filter(r => r.success),
    ].filter(Boolean);

    const userPreferences = context.userPreferences || {};
    const expertHints = context.expertHints || null;
    const responseIntent = decision.responseIntent || ResponseIntent.BULLETS;

    const synthesisResult = await synthesizeWithLLM({
      query: input,
      intent: decision.intent, // ITEM_LOOKUP - will use the correct prompt
      toolResults: allToolResults,
      context,
      userPreferences,
      expertHints,
      responseIntent,
      conversationContext,  // v56.2 C2
    });

    logger.info('HandleToolCall', 'ITEM_LOOKUP synthesis complete', {
      query: input.substring(0, 50),
      synthesisLength: synthesisResult.content?.length || 0,
      confidence: synthesisResult.confidence,
    });

    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION,
      confidence: synthesisResult.confidence || decision.confidence,
      canExecute: false,
      metadata: {
        decision: decision.toJSON(),
        pipeline: 'ITEM_LOOKUP',
        searchResults: searchData?.data?.results?.length || 0,
        scrapedUrls: urls.length,
        synthesisModel: synthesisResult.model,
      },
    });

    if (sessionState) {
      sessionState.recordDecision(decision, input);
    }

    return new TaggedResponse({
      content: synthesisResult.content,
      tag,
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // EXECUTE TOOLS - regular execution for non-REPORT intents
  // ════════════════════════════════════════════════════════════════════════════

  // v59.0 IDE Bridge: Notify tool call start
  if (typeof context.onToolCall === 'function') {
    try { context.onToolCall(decision.tools?.[0] || 'unknown', { query: effectiveQuery }); } catch { /* */ }
  }

  const executionResult = await toolExecutor.execute(decision, {
    input,
    query: effectiveQuery,  // v56.2 C1: enriched follow-up
    sessionId: context.sessionId,
    projectGoal, // v44.3 - Pass goal for context
    ...context,
  });

  // v59.0 IDE Bridge: Notify tool call result
  if (typeof context.onToolResult === 'function') {
    try {
      context.onToolResult(decision.tools?.[0] || 'unknown', {
        success: executionResult.status !== ExecutionStatus.FAILED,
        durationMs: executionResult.duration,
        summary: `${executionResult.toolResults?.length || 0} results`,
      });
    } catch { /* */ }
  }

  // v56.0 FIX: Defensive — ensure toolResults is always an array
  if (!Array.isArray(executionResult.toolResults)) {
    executionResult.toolResults = [];
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BUILD RESPONSE FROM EXECUTION RESULTS
  // ════════════════════════════════════════════════════════════════════════════

  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.CONVERSATION,
    confidence: decision.confidence,
    canExecute: false, // Already executed
    metadata: {
      decision: decision.toJSON(),
      executionStatus: executionResult.status,
      executionDuration: executionResult.duration,
      toolResults: executionResult.toolResults.map(r => ({
        tool: r.tool,
        success: r.success,
        error: r.error,
      })),
    },
  });

  // ════════════════════════════════════════════════════════════════════════════
  // v44.2 - Handle execution failure with FALLBACK instead of just ending
  // ════════════════════════════════════════════════════════════════════════════

  if (executionResult.status === ExecutionStatus.FAILED) {
    logger.error('HandleToolCall', 'All tools failed', {
      error: executionResult.error,
      tools: decision.tools,
    });

    // ═══════════════════════════════════════════════════════════════════════
    // v58.3: LLM fallback — when search fails, try answering from LLM knowledge
    // Many SEARCH queries (capitals, history, recommendations) can be answered
    // by the LLM without web data. Only fall through to error if LLM also fails.
    // ═══════════════════════════════════════════════════════════════════════
    if (decision.intent === IntentType.SEARCH || decision.intent === IntentType.FACTUAL) {
      try {
        logger.info('HandleToolCall', 'Search failed → trying LLM knowledge fallback', {
          intent: decision.intent,
          input: input.substring(0, 60),
        });
        const llmFallback = await handleAnswerDecision(input, {
          ...decision,
          type: DecisionType.ANSWER,
          intent: IntentType.CONVERSATIONAL,
          reason: 'LLM fallback after search failure',
          toJSON() { return { ...this, toJSON: undefined }; },
        }, context);
        // Tag it as degraded so we know it's not search-backed
        if (llmFallback?.content) {
          logger.info('HandleToolCall', 'LLM fallback succeeded', {
            contentLength: llmFallback.content.length,
          });
          return llmFallback;
        }
      } catch (llmErr) {
        logger.warn('HandleToolCall', 'LLM fallback also failed', { error: llmErr.message });
      }
    }

    // Check if we can offer alternatives
    const fallbackResponse = buildFailureFallback(input, decision, executionResult, context);

    // Save fallback state if we're offering alternatives
    if (sessionState && fallbackResponse.offeringAlternatives) {
      sessionState.setPendingDecision({
        ...decision,
        type: 'TOOL_CALL_FAILED',
        failedTools: decision.tools,
        originalInput: input,
      }, ['alternative_action']);

      logger.info('HandleToolCall', 'Saved fallback state for user choice', {
        originalTools: decision.tools,
      });
    }

    return new TaggedResponse({
      content: fallbackResponse.content,
      tag: new ResponseTag({
        ...tag.toJSON(),
        metadata: {
          ...tag.metadata,
          offeringFallback: fallbackResponse.offeringAlternatives,
          fallbackOptions: fallbackResponse.options,
          // v44.5 - Include structured ASK_USER data for UI
          structured: fallbackResponse.structured,
          awaitingUserChoice: true,
          slots: ['alternative_action'],
        },
      }),
    });
  }

  // Handle partial success
  if (executionResult.status === ExecutionStatus.PARTIAL) {
    logger.warn('HandleToolCall', 'Partial execution success', {
      succeeded: executionResult.toolResults.filter(r => r.success).length,
      failed: executionResult.toolResults.filter(r => !r.success).length,
    });
  }

  // Record successful decision
  if (sessionState) {
    sessionState.recordDecision(decision, input);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // v45.0 — LLM SYNTHESIS: Tools returned DATA, now LLM generates RESPONSE
  // ════════════════════════════════════════════════════════════════════════════
  // The key architectural change: tools don't "speak" — they provide data.
  // LLM synthesizes the user-facing response from tool data.
  // ════════════════════════════════════════════════════════════════════════════

  // v45.0: Get optimized preferences from engine
  const optimizedPrefs = preferenceEngine.getPreferencesForSynthesis(decision.intent);

  // v45.0 KOLO 3: Detect ResponseIntent from user input
  const responseIntent = detectResponseIntent(input, {
    lastResponseIntent: sessionState?.lastResponseIntent,
  });

  const synthesizedResponse = await synthesizeWithLLM({
    query: input,
    intent: decision.intent,
    toolResults: executionResult.toolResults,
    context,
    userPreferences: {
      ...optimizedPrefs,
      ...context.userPreferences,
    },
    responseIntent,  // v45.0 KOLO 3: Pass detected responseIntent
    conversationContext,  // v56.2 C2
  });

  // v45.0 FIX 1.4: Save tool results for FORMAT_CHANGE follow-ups
  if (sessionState) {
    sessionState.lastToolResults = executionResult.toolResults;
    sessionState.lastToolResultsTimestamp = Date.now();
    sessionState.lastResponseIntent = responseIntent;  // v45.0 KOLO 3: Store for next turn
  }

  // Update tag with synthesis metadata
  const finalTag = new ResponseTag({
    ...tag.toJSON(),
    metadata: {
      ...tag.metadata,
      synthesized: true,
      synthesisModel: synthesizedResponse.model,
      synthesisConfidence: synthesizedResponse.confidence,
      followUpType: followUp?.type,
    },
  });

  // A3: Apply confidence styling before returning to user
  const langCtx = getLanguageContext(input);
  const confidenceScore = synthesizedResponse.confidence || 0.5;
  const styled = styleWithConfidence(synthesizedResponse.content, {
    level: scoreToLevel(confidenceScore),
    score: confidenceScore,
  }, { lang: langCtx?.language || 'cs', mode: 'footer' });

  return new TaggedResponse({
    content: styled.text,
    tag: finalTag,
  });
}

/**
 * v44.5 - Build structured ASK_USER fallback when tool execution fails
 * Returns a proper ASK_USER decision structure that UI can handle
 */
function buildFailureFallback(input, decision, executionResult, context) {
  const hasRetryable = executionResult.toolResults.some(r => !r.success && r.retryable);
  const firstSuggestion = executionResult.toolResults
    .filter(r => !r.success && r.suggestion)
    .map(r => r.suggestion)[0];

  // Get error details
  const failedTools = executionResult.toolResults
    .filter(r => !r.success)
    .map(r => ({
      tool: r.tool,
      error: r.error,
      code: r.errorCode,
      retryable: r.retryable,
    }));

  // Check for SOURCE_BLOCKED - offer alternative sources
  const hasSourceBlocked = failedTools.some(t => t.code === 'SOURCE_BLOCKED');

  // Build structured options for UI
  const structuredOptions = [];
  const options = [];

  if (hasSourceBlocked) {
    structuredOptions.push(
      { id: 'alternative_source', label: 'Zkusit jiný zdroj', action: 'prompt', prompt: 'Zadejte jinou URL nebo téma' },
      { id: 'alternative_search', label: 'Použít DuckDuckGo', action: 'auto', tool: 'web.search', provider: 'duckduckgo' },
      { id: 'reformulate', label: 'Přeformulovat dotaz', action: 'prompt', prompt: 'Zadejte novou formulaci' },
      { id: 'cancel', label: 'Zrušit', action: 'cancel' }
    );
    options.push('alternative_source', 'alternative_search', 'reformulate');
  } else if (hasRetryable) {
    structuredOptions.push(
      { id: 'retry', label: 'Zkusit znovu', action: 'retry' },
      { id: 'reformulate', label: 'Přeformulovat dotaz', action: 'prompt', prompt: 'Zadejte novou formulaci' },
      { id: 'cancel', label: 'Zrušit', action: 'cancel' }
    );
    options.push('retry', 'reformulate');
  } else {
    structuredOptions.push(
      { id: 'reformulate', label: 'Přeformulovat dotaz', action: 'prompt', prompt: 'Zadejte novou formulaci' },
      { id: 'cancel', label: 'Zrušit', action: 'cancel' }
    );
    options.push('reformulate');
  }

  // Build human-readable content
  const toolNames = {
    'web.search': 'Vyhledávání',
    'web.scrape': 'Načtení stránky',
    'file.read': 'Čtení souboru',
  };

  let content = `⚠️ **Nepodařilo se zpracovat požadavek**\n\n`;
  content += `**Váš dotaz:** ${input}\n\n`;
  content += `**Problém:**\n`;
  for (const tool of failedTools) {
    content += `- ${toolNames[tool.tool] || tool.tool}: ${tool.error}\n`;
  }
  content += '\n';

  if (hasSourceBlocked) {
    content += `💡 **Zdroj blokuje automatické požadavky.**\n\n`;
  }

  if (firstSuggestion) {
    content += `💡 **Tip:** ${firstSuggestion}\n\n`;
  }

  content += `**Možnosti:**\n`;
  structuredOptions.forEach((opt, i) => {
    if (opt.id !== 'cancel') {
      content += `${i + 1}. ${opt.label}\n`;
    }
  });

  return {
    content,
    offeringAlternatives: structuredOptions.length > 1,
    options,
    // v44.5 - Structured response for UI
    structured: {
      type: 'ASK_USER',
      subtype: 'TOOL_FAILURE_RECOVERY',
      failedTools,
      options: structuredOptions,
      originalInput: input,
      originalIntent: decision.intent,
      suggestion: firstSuggestion,
    },
  };
}


/**
 * Handle ASK_USER decision - need clarification
 *
 * v44.2 - Now saves pending decision to session state for resumption
 * v44.6 FIX 2 - Tracks attempts to enforce max 1× clarification
 */
function handleAskUserDecision(input, decision, context) {
  const { sessionState } = context;

  // ════════════════════════════════════════════════════════════════════════════
  // v44.2 - SAVE PENDING DECISION FOR RESUMPTION
  // v44.6 FIX 2 - Track attempts (max 1× clarification)
  // ════════════════════════════════════════════════════════════════════════════

  if (sessionState) {
    // v44.6 - Calculate new attempts count
    const currentAttempts = sessionState.pendingDecision?.attempts ?? 0;
    const decisionWithAttempts = {
      ...decision,
      attempts: currentAttempts + 1,
    };

    sessionState.recordDecision(decisionWithAttempts, input);
    logger.info('HandleAskUser', 'Saved pending decision for resumption', {
      intent: decision.intent,
      slots: decision.slots,
      attempts: decisionWithAttempts.attempts,
    });
  }

  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.CONVERSATION,
    confidence: decision.confidence,
    canExecute: false,
    metadata: {
      decision: decision.toJSON(),
      awaitingClarification: true,
      slots: decision.slots,
    },
  });

  const content = formatClarificationRequest(input, decision);

  return new TaggedResponse({
    content,
    tag,
  });
}

/**
 * Format clarification request
 * v44.2 - Intent-specific templates instead of generic options
 */
function formatClarificationRequest(input, decision) {
  const shortInput = input.length > 60 ? input.substring(0, 60) + '...' : input;

  if (decision.slots.includes('intent_clarification')) {
    // v44.2 - Analyze input to show relevant options only
    const lower = input.toLowerCase();

    // Check if input looks like news/report request
    const looksLikeReport = /souhrn|přehled|prehled|zpráv|zprav|novinky|za|report|analýz/i.test(lower);
    const looksLikeSearch = /najdi|hledej|vyhledej|kde|kolik|cen|odkaz/i.test(lower);
    const looksLikeCode = /kód|kod|funkc|napš|oprav|bug|class|function/i.test(lower);

    // Show only relevant options based on input analysis
    if (looksLikeReport && !looksLikeSearch && !looksLikeCode) {
      return `📋 **"${shortInput}"**\n\n` +
             `Chcete:\n` +
             `• **Přehled** - vytvořit souhrn informací\n` +
             `• **Vyhledávání** - najít odkazy na webu`;
    }

    if (looksLikeSearch && !looksLikeReport && !looksLikeCode) {
      return `🔍 **"${shortInput}"**\n\n` +
             `Chcete:\n` +
             `• **Najít informace** - vyhledat na webu\n` +
             `• **Vytvořit přehled** - zpracovat do souhrnu`;
    }

    if (looksLikeCode) {
      return `💻 **"${shortInput}"**\n\n` +
             `Chcete:\n` +
             `• **Napsat kód** - vytvořit/upravit program\n` +
             `• **Vysvětlit** - obecná otázka o programování`;
    }

    // Fallback: generic but shorter
    return `🤔 **"${shortInput}"**\n\n` +
           `Upřesněte záměr:\n` +
           `• **Vyhledávání** - najít informace\n` +
           `• **Přehled** - vytvořit souhrn\n` +
           `• **Kód** - napsat program`;
  }

  if (decision.slots.includes('source')) {
    return `📎 **Pro tento požadavek potřebuji zdroj:**\n\n` +
           `Zadejte URL nebo téma pro vyhledávání.`;
  }

  // CODE intent without project context
  if (decision.slots.includes('project_context') || decision.slots.includes('file_path')) {
    return `💻 **"${shortInput}"**\n\n` +
           `V jakém projektu chcete pracovat?\n` +
           `(Vyberte projekt z nabídky nebo napište "obecná otázka")`;
  }

  return `❓ Potřebuji upřesnit: ${decision.slots[0] || 'kontext'}\n\n` +
         `**"${shortInput}"**`;
}

/**
 * Handle ANSWER decision - only for pure CONVERSATIONAL intent
 */
async function handleAnswerDecision(input, decision, context) {
  const { sessionId } = context;

  try {
    // Lazy import CRE bridge to avoid circular dependencies
    const creBridge = await import('../../llm/cre-bridge.js');

    // Build prompt with conversation history
    // v56.2 Sprint C1: History now contains user+assistant pairs
    let prompt = input;
    if (context.history?.length > 0) {
      const historyContext = context.history
        .slice(-5)
        .map(h => {
          const parts = [];
          // v56.2: Include user input if available (Sprint C1 fix #12)
          if (h.userInput) {
            parts.push(`User: ${h.userInput}`);
          }
          if (h.response?.content) {
            const speaker = h.response?.tag?.speaker || 'assistant';
            parts.push(`${speaker}: ${h.response.content.substring(0, 200)}`);
          }
          return parts.join('\n');
        })
        .filter(p => p.length > 0)
        .join('\n');
      if (historyContext) {
        prompt = `Context:\n${historyContext}\n\nUser: ${input}`;
      }
    }

    // System prompt for CONVERSATIONAL - strict rules
    // v57.3: Full language-native system prompt (not English + appended instruction)
    // Local models (Qwen/Ollama) need the ENTIRE prompt in target language to stay on track
    const langCtx = getLanguageContext(input);

    const CONVERSATIONAL_SYSTEM_PROMPTS = {
      cs: `Jsi užitečný AI asistent v konverzačním režimu.

PRAVIDLA:
- Zpracováváš pouze běžnou konverzaci (pozdravy, názory, obecné znalosti)
- NEMŮŽEŠ vyhledávat na webu — pokud uživatel potřebuje konkrétní data, řekni mu, že potřebuješ provést vyhledávání
- NEMŮŽEŠ přistupovat k URL — pokud dostaneš URL, řekni, že potřebuješ ji načíst
- NIKDY neříkej "nemám přístup", "nemohu vyhledávat" — místo toho řekni, jaká AKCE je potřeba
- Odpovídej VÝHRADNĚ ČESKY, nikdy nepřepínej do jiného jazyka

POVOLENO:
- Pozdravy a rozloučení
- Názory a preference
- Obecné znalosti z tvého tréninku
- Vysvětlení jak používat systém

ZAKÁZANÉ FRÁZE:
${FORBIDDEN_PHRASES.slice(0, 10).map(p => `- "${p}"`).join('\n')}`,

      sk: `Si užitočný AI asistent v konverzačnom režime.

PRAVIDLÁ:
- Spracúvaš iba bežnú konverzáciu (pozdravy, názory, všeobecné znalosti)
- NEMÔŽEŠ vyhľadávať na webe
- Odpovedaj VÝHRADNE SLOVENSKY

ZAKÁZANÉ FRÁZY:
${FORBIDDEN_PHRASES.slice(0, 10).map(p => `- "${p}"`).join('\n')}`,

      en: `You are a helpful AI assistant in CONVERSATIONAL mode.

CRITICAL RULES:
- You are ONLY handling casual conversation (greetings, opinions, small talk)
- You CANNOT search the web - if asked about facts, say you need to search first
- You CANNOT access URLs - if given a URL, say you need to fetch it first
- NEVER say "nemám přístup", "nemohu vyhledávat", etc. - instead say what ACTION is needed
- Respond EXCLUSIVELY IN ENGLISH

ALLOWED:
- Greetings and farewells
- Opinions and preferences
- General knowledge from your training
- Explaining how to use the system

FORBIDDEN PHRASES (never use these):
${FORBIDDEN_PHRASES.slice(0, 10).map(p => `- "${p}"`).join('\n')}`,

      de: `Du bist ein hilfreicher KI-Assistent im Konversationsmodus.

REGELN:
- Verarbeite nur normale Konversation (Begrüßungen, Meinungen, Allgemeinwissen)
- Antworte AUSSCHLIESSLICH AUF DEUTSCH

VERBOTENE PHRASEN:
${FORBIDDEN_PHRASES.slice(0, 10).map(p => `- "${p}"`).join('\n')}`,
    };

    // Use detected language or fallback to Czech
    const systemPrompt = CONVERSATIONAL_SYSTEM_PROMPTS[langCtx.language]
      || CONVERSATIONAL_SYSTEM_PROMPTS.cs  // Default to Czech, not English
      + (langCtx.instruction || '');

    // Call LLM via CRE bridge (authorized)
    // v55.2 Sprint 2: Retry loop with D6 gate + creative quality enforcement
    const MAX_ANSWER_RETRIES = 1;
    let answerRetry = 0;
    let currentPrompt = prompt;
    let result;

    // v59.0 IDE Bridge: Notify LLM start for ANSWER path
    if (typeof context.onLLMStart === 'function') {
      try { context.onLLMStart('answer', prompt.length); } catch { /* */ }
    }

    while (answerRetry <= MAX_ANSWER_RETRIES) {
      result = await creBridge.generateChatResponse(currentPrompt, systemPrompt, {
        sessionId: `conv-${sessionId}`,
        temperature: answerRetry === 0 ? 0.7 : 0.5,
      });

      // CRITICAL: Validate response against forbidden phrases
      const validation = creDecisionEngine.validateResponse(result.content);
      if (!validation.valid) {
        logger.error('ConversationHandler', 'LLM generated FORBIDDEN response', {
          violations: validation.violations,
          content: result.content.substring(0, 200),
        });
        return createForbiddenResponseError(input, validation.violations);
      }

      // ════════════════════════════════════════════════════════════════════════
      // v55.2 Sprint 2.1 — D6 Output Quality Gate for ANSWER path
      // ════════════════════════════════════════════════════════════════════════
      const gateVerdict = enforceOutputContract(result.content, {
        intent: decision.intent || 'CONVERSATIONAL',
        responseIntent: null,
      });

      if (!gateVerdict.ok && answerRetry < MAX_ANSWER_RETRIES) {
        logger.warn('ConversationHandler', `D6 gate failed on ANSWER path, retrying`, {
          dimension: gateVerdict.failDimension,
          reason: gateVerdict.reason,
          retry: answerRetry,
        });
        currentPrompt = buildOutputGateRetryPrompt(currentPrompt, gateVerdict);
        answerRetry++;
        continue;
      }

      // ════════════════════════════════════════════════════════════════════════
      // v55.2 Sprint 2.2 — Creative Quality Gate: RETRY, not log
      // ════════════════════════════════════════════════════════════════════════
      if (decision.intent === IntentType.CREATIVE) {
        const qualityCheck = assertCreativeQuality(result.content, input);
        if (!qualityCheck.valid && answerRetry < MAX_ANSWER_RETRIES) {
          logger.warn('ConversationHandler', 'CREATIVE quality gate → RETRY', {
            reason: qualityCheck.reason,
            contentLength: result.content.length,
            retry: answerRetry,
          });
          currentPrompt = `${prompt}\n\n` +
            `═══════════════════════════════════════════════════════════════\n` +
            `⚠️ PŘEDCHOZÍ ODPOVĚĎ BYLA ODMÍTNUTA: ${qualityCheck.reason}\n` +
            `═══════════════════════════════════════════════════════════════\n` +
            `POŽADAVEK: Odpověz s KONKRÉTNÍM obsahem. Žádné prázdné struktury,\n` +
            `žádné opakování otázky, žádné obecné fráze. Uveď konkrétní nápady,\n` +
            `jména, čísla, příklady.\n` +
            `═══════════════════════════════════════════════════════════════`;
          answerRetry++;
          continue;
        }
        if (!qualityCheck.valid) {
          logger.warn('ConversationHandler', 'CREATIVE quality gate failed after retry', {
            reason: qualityCheck.reason,
          });
        }
      }

      // Passed all gates — break retry loop
      break;
    }

    // Log if D6 gate still fails after retry (degraded response)
    const finalGate = enforceOutputContract(result.content, {
      intent: decision.intent || 'CONVERSATIONAL',
    });
    if (!finalGate.ok) {
      logger.warn('ConversationHandler', 'D6 gate still fails after retry — returning degraded', {
        dimension: finalGate.failDimension,
        reason: finalGate.reason,
      });
    }

    // v44.9 FIX: Record decision to sessionState (required for CREATIVE follow-up lock!)
    const { sessionState } = context;
    if (sessionState) {
      sessionState.recordDecision(decision, input);
    }

    // v59.0 IDE Bridge: Notify gate verdict and LLM done
    if (typeof context.onGateVerdict === 'function') {
      try { context.onGateVerdict({ ok: finalGate.ok, dimension: finalGate.failDimension }); } catch { /* */ }
    }
    if (typeof context.onLLMDone === 'function') {
      try { context.onLLMDone(result.content.length, result.duration); } catch { /* */ }
    }

    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION,
      confidence: 0.9,
      canExecute: false,
      metadata: {
        model: result.model,
        duration: result.duration,
        decision: decision.toJSON(),
      },
    });

    return new TaggedResponse({
      content: result.content,
      tag,
    });
  } catch (err) {
    logger.error('ConversationHandler', `LLM call failed: ${err.message}`);

    // CRITICAL: Never return free text on error - use REFUSE decision
    // This prevents fallback to "chatty" error messages
    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION,
      confidence: 1.0,
      canExecute: false,
      metadata: {
        error: true,
        errorType: 'LLM_CALL_FAILED',
        decision: { type: 'REFUSE', reason: err.message },
      },
    });

    return new TaggedResponse({
      content: `⚠️ **Chyba zpracování**\n\nSystém nemohl zpracovat váš požadavek.\n\n` +
               `**Důvod:** ${err.message}\n\n` +
               `Zkuste to prosím znovu nebo přeformulujte dotaz.`,
      tag,
    });
  }
}

/**
 * Create error response when LLM generates forbidden content
 */
function createForbiddenResponseError(input, violations) {
  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.CONVERSATION,
    confidence: 1.0,
    canExecute: true,
    metadata: {
      error: 'FORBIDDEN_PHRASE_DETECTED',
      violations,
      requiresToolExecution: true,
    },
  });

  return new TaggedResponse({
    content: `🔄 Váš dotaz vyžaduje získání aktuálních dat.\n\n` +
             `**Dotaz:** ${input}\n\n` +
             `Pro zodpovězení spustím vyhledávání...`,
    tag,
    actions: [{
      type: 'TOOL_CALL',
      tool: 'web.search',
      query: input,
      reason: 'forbidden_phrase_recovery',
    }],
  });
}

/**
 * Handle REFUSE decision
 */
function handleRefuseDecision(input, decision, context) {
  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.CONVERSATION,
    confidence: 1.0,
    canExecute: false,
    metadata: {
      decision: decision.toJSON(),
      refused: true,
    },
  });

  return new TaggedResponse({
    content: `⚠️ Tento požadavek nemohu zpracovat.\n\n` +
             `**Důvod:** ${decision.reason}\n\n` +
             `Zkuste prosím přeformulovat váš dotaz.`,
    tag,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// v44.7 - LOCAL Handler (TERMINAL - direct computation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle LOCAL decision - TERMINAL direct computation
 *
 * LOCAL is special: it's deterministic computation that doesn't need external APIs.
 * Examples: "kdy bude úplněk?", "kolik je hodin?", "5+3"
 *
 * v44.7 INVARIANT: LOCAL NEVER calls tools, NEVER goes to web.search
 */

export {
  handleToolCallDecision,
  buildFailureFallback,
  handleAskUserDecision,
  formatClarificationRequest,
  handleAnswerDecision,
  createForbiddenResponseError,
  handleRefuseDecision,
};
