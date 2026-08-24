// Decision Sub-Handlers — shared by conversationHandler, projectHandler, expertHandler
//
// v93.1: Split into modules:
//   - utils/search-enrichment.js — follow-up query enrichment, conversation context
//   - ask-user.js — handleAskUserDecision, formatClarificationRequest
//   - decisions.js (this file) — handleToolCallDecision, handleAnswerDecision,
//     handleRefuseDecision, buildFailureFallback, createForbiddenResponseError

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
import { buildProjectContext } from './utils/project-context-prompt.js';
import { styleWithConfidence, scoreToLevel } from './utils/confidence-styling.js';
import { assertCreativeQuality } from './utils/quality.js';
import { buildStrictLanguageInstruction, validateResponseLanguage, buildLanguageRetryInstruction } from './utils/language-enforcement.js';
import { FollowUpType, detectFollowUpType, getPreviousToolData } from './utils/followup.js';
import { assessGoalAlignment } from './clarification.js';
import { buildReportFallback } from './report.js';
import { patternTracker } from '../../memory/pattern-tracker.js';
// v93.1: Extracted modules — re-exported for backward compatibility
import { enrichSearchQuery, isMetaContinuation, buildConversationContext } from './utils/search-enrichment.js';
import { handleAskUserDecision, formatClarificationRequest } from './ask-user.js';

const M2_TOOL_FALLBACK_SUPPRESS_ERROR_CODES = new Set([
  'TOOL_EFFECT_AUTHORITY_REQUIRED',
  'TOOL_EFFECT_AUTHORITY_UNAVAILABLE',
  'TOOL_EFFECT_TRANSLATION_INVALID',
  'TOOL_EXECUTION_IN_PROGRESS',
]);

function isM2DurableEffectTerminal(result) {
  return result?.success === false
    && typeof result?.meta?.m2ToolRequestId === 'string'
    && result.meta.m2ToolRequestId.length > 0
    && typeof result?.meta?.m2RiskClass === 'string'
    && result.meta.m2RiskClass !== 'pure';
}

function findM2ToolTerminalDenial(executionResult) {
  return executionResult?.toolResults?.find(result => (
    result?.meta?.m2AuthorityFailure === true
    || isM2DurableEffectTerminal(result)
    || M2_TOOL_FALLBACK_SUPPRESS_ERROR_CODES.has(result?.errorCode)
  )) || null;
}

function buildM2ToolAuthorityDeniedResponse(decision, denial, context) {
  const effectId = denial?.meta?.effectRequestId || null;
  const approvalRequired = denial?.errorCode === 'TOOL_EFFECT_AUTHORITY_REQUIRED' && effectId;
  const executionInProgress = denial?.errorCode === 'TOOL_EXECUTION_IN_PROGRESS';
  const authorityFailure = denial?.meta?.m2AuthorityFailure === true;
  const durableEffectTerminal = isM2DurableEffectTerminal(denial);
  const content = approvalRequired
    ? `🔐 Nástroj čeká na přesné schválení efektu. Napiš: \`schválit efekt ${effectId}\``
    : executionInProgress
      ? '⏳ Stejný požadavek nástroje už zpracovává aktivní M2 execution claim. Tento pokus nespustil další nástroj ani náhradní LLM odpověď.'
      : authorityFailure
        ? '🔒 Autoritativní výsledek nástroje se nepodařilo bezpečně uložit nebo ověřit. Náhradní LLM odpověď nebyla spuštěna.'
        : durableEffectTerminal
          ? '⛔ Autoritativní M2 efekt skončil terminálním výsledkem. Náhradní LLM odpověď nebyla spuštěna.'
      : '🔒 Nástroj nebyl spuštěn: chybí přesná M2 effect authority. Žádné síťové spojení ani jiný efekt nevznikl.';
  return new TaggedResponse({
    content,
    tag: new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: context?.hasActiveProject ? ChatMode.PROJECT : ChatMode.CONVERSATION,
      confidence: 1,
      canExecute: false,
      metadata: {
        decision: decision.toJSON(),
        handler: 'tool.authority',
        securityBlocked: true,
        error: denial?.errorCode || 'TOOL_EFFECT_AUTHORITY_UNAVAILABLE',
        effectId,
        approvalRequired: Boolean(approvalRequired),
        executionInProgress,
        m2AuthorityFailure: authorityFailure,
        m2EffectTerminal: durableEffectTerminal,
        fallbackSuppressed: true,
      },
    }),
  });
}

async function handleToolCallDecision(input, decision, context) {
  const { sessionState } = context;

  // v86: Use budget-aware context when available — intent-specific history sizing
  let conversationContext;
  if (context.buildBudgetedContext) {
    try {
      const budgeted = await context.buildBudgetedContext(decision.intent);
      conversationContext = buildConversationContext(budgeted.handlerHistory);
    } catch (_) {
      conversationContext = buildConversationContext(context.history);
    }
  } else {
    conversationContext = buildConversationContext(context.history);
  }

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
  // v73: Context-oriented follow-up — pass lastDecision, not full sessionState
  const followUp = detectFollowUpType(input, sessionState?.lastDecision);

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
  // v44.11 — SEARCH-SCRAPE-SYNTHESIS PIPELINE (shared by REPORT + ITEM_LOOKUP)
  // ════════════════════════════════════════════════════════════════════════════
  // Pipeline: SEARCH → SCRAPE → SYNTHESIZE (deterministic steps, no parallel)
  // If SEARCH fails → degraded fallback. If aborted → early exit.
  // ════════════════════════════════════════════════════════════════════════════
  const SEARCH_PIPELINE_CONFIG = {
    REPORT:      { maxUrls: 5, defaultIntent: ResponseIntent.SUMMARY, searchSubType: null },
    ITEM_LOOKUP: { maxUrls: 8, defaultIntent: ResponseIntent.BULLETS, searchSubType: 'CLASSIFIED' },
  };

  const pipelineIntent = decision.intent === IntentType.REPORT ? 'REPORT'
    : decision.intent === IntentType.ITEM_LOOKUP ? 'ITEM_LOOKUP'
    : null;

  if (pipelineIntent) {
    const pipelineCfg = SEARCH_PIPELINE_CONFIG[pipelineIntent];
    logger.info('HandleToolCall', `${pipelineIntent} pipeline started`, { input: input.substring(0, 50) });

    // IDE Bridge: Notify search tool call
    if (typeof context.onToolCall === 'function') {
      try { context.onToolCall('web.search', { query: effectiveQuery, pipeline: pipelineIntent }); } catch { /* */ }
    }

    // v123.2: System step — search started
    if (typeof context.onSystemStep === 'function') {
      try { context.onSystemStep('search_start', effectiveQuery.substring(0, 60)); } catch (_) {}
    }

    // Step 1: Execute web.search
    const searchResult = await toolExecutor.execute({
      ...decision,
      tools: ['web.search'],
    }, {
      input,
      query: effectiveQuery,
      sessionId: context.sessionId,
      projectGoal,
      ...context,
    });

    const searchData = searchResult.toolResults?.find(r => r.type === 'search');

    // IDE Bridge: Notify search result
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
      const authorityDenial = findM2ToolTerminalDenial(searchResult);
      if (authorityDenial) {
        return buildM2ToolAuthorityDeniedResponse(decision, authorityDenial, context);
      }
      logger.warn('HandleToolCall', `${pipelineIntent} pipeline: search failed or no results`, {
        status: searchResult.status,
        hasData: !!searchData,
        resultCount: searchData?.data?.results?.length || 0,
      });
      return buildReportFallback(input, decision, searchResult, context);
    }

    // Abort check: user may have disconnected during search
    if (context.signal?.aborted) {
      logger.info('HandleToolCall', `${pipelineIntent} pipeline: aborted after search`);
      return buildReportFallback(input, decision, searchResult, context);
    }

    // Step 2: Extract URLs from search results
    const urls = searchData.data.results
      .filter(r => r.url && r.url.startsWith('http'))
      .slice(0, pipelineCfg.maxUrls)
      .map(r => r.url);

    logger.info('HandleToolCall', `${pipelineIntent} pipeline: scraping URLs`, {
      urlCount: urls.length,
      urls: urls.slice(0, 3),
    });

    // v123.2: System step — scraping
    if (typeof context.onSystemStep === 'function') {
      try { context.onSystemStep('search_scrape', `${urls.length} stránek`); } catch (_) {}
    }

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
      const scrapeAuthorityDenial = findM2ToolTerminalDenial(scrapeResult);
      if (scrapeAuthorityDenial) {
        return buildM2ToolAuthorityDeniedResponse(decision, scrapeAuthorityDenial, context);
      }
      scrapeResults = scrapeResult.toolResults || [];
    }

    // Abort check: user may have disconnected during scrape
    if (context.signal?.aborted) {
      logger.info('HandleToolCall', `${pipelineIntent} pipeline: aborted after scrape`);
      return buildReportFallback(input, decision, searchResult, context);
    }

    // Step 4: SYNTHESIZE with LLM
    const successfulScrapes = scrapeResults.filter(r => r.success);
    const allToolResults = [searchData, ...successfulScrapes].filter(Boolean);

    const scrapeSuccessRate = urls.length > 0 ? successfulScrapes.length / urls.length : 0;
    if (scrapeSuccessRate < 0.4 && urls.length > 0) {
      logger.warn('HandleToolCall', `${pipelineIntent} pipeline: most scrapes failed — snippets only`, {
        attempted: urls.length,
        succeeded: successfulScrapes.length,
        rate: scrapeSuccessRate,
      });
    }

    const synthesisContext = scrapeSuccessRate < 0.4 && urls.length > 0
      ? { ...context, snippetOnlyMode: true }
      : context;

    // v123.2: System step — synthesis
    if (typeof context.onSystemStep === 'function') {
      try { context.onSystemStep('search_synthesis', `${allToolResults.length} zdrojů, syntéza odpovědi`); } catch (_) {}
    }

    const synthesisOpts = {
      query: input,
      intent: decision.intent,
      toolResults: allToolResults,
      context: synthesisContext,
      userPreferences: context.userPreferences || {},
      expertiseHints: context.expertiseHints || null,
      responseIntent: decision.responseIntent || pipelineCfg.defaultIntent,
      conversationContext,
    };
    if (pipelineCfg.searchSubType) {
      synthesisOpts.searchSubType = pipelineCfg.searchSubType;
    }

    const synthesisResult = await synthesizeWithLLM(synthesisOpts);

    logger.info('HandleToolCall', `${pipelineIntent} synthesis complete`, {
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
        pipeline: pipelineIntent,
        searchResults: searchData?.data?.results?.length || 0,
        scrapedUrls: urls.length,
        synthesisModel: synthesisResult.model,
        semanticScore: synthesisResult.semanticScore || null, // v126.1
      },
    });

    if (sessionState) {
      sessionState.recordDecision(decision, input);
    }

    return new TaggedResponse({ content: synthesisResult.content, tag });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // EXECUTE TOOLS - regular execution for non-REPORT intents
  // ════════════════════════════════════════════════════════════════════════════

  // v59.0 IDE Bridge: Notify tool call start
  if (typeof context.onToolCall === 'function') {
    const selectedTools = Array.isArray(decision.tools) && decision.tools.length > 0
      ? decision.tools
      : ['unknown'];
    // Every selected tool crosses the security hook before the executor sees
    // the decision. A write hidden behind an earlier read/search must not bypass
    // authority merely because legacy telemetry used to report only tools[0].
    for (const tool of selectedTools) {
      try {
        await context.onToolCall(tool, { query: effectiveQuery });
      } catch (error) {
        logger.warn('HandleToolCall', `Tool-call hook failed: ${error.message}`);
      }
    }
  }

  // v123.2: System step — tool execution
  if (typeof context.onSystemStep === 'function') {
    try { context.onSystemStep('tool_executing', (decision.tools?.[0] || 'nástroj') + ': ' + effectiveQuery.substring(0, 50)); } catch (_) {}
  }

  const executionResult = await toolExecutor.execute(decision, {
    input,
    query: effectiveQuery,  // v56.2 C1: enriched follow-up
    sessionId: context.sessionId,
    projectGoal, // v44.3 - Pass goal for context
    ...context,
  });

  // v56.0 FIX: Defensive — ensure toolResults is always an array
  if (!Array.isArray(executionResult.toolResults)) {
    executionResult.toolResults = [];
  }

  // A mixed batch cannot turn an authority denial into PARTIAL success and
  // feed the successful subset to synthesis. Any authority denial is terminal
  // for the user-visible decision; no fallback or LLM call follows.
  const batchAuthorityDenial = findM2ToolTerminalDenial(executionResult);
  if (batchAuthorityDenial) {
    if (typeof context.onToolResult === 'function') {
      try {
        context.onToolResult(decision.tools?.[0] || 'unknown', {
          success: false,
          durationMs: executionResult.duration,
          summary: 'M2 durable tool terminal stopped the batch',
          errorCode: batchAuthorityDenial.errorCode,
          effectRequestId: batchAuthorityDenial.meta?.effectRequestId || null,
          m2AuthorityFailure: batchAuthorityDenial.meta?.m2AuthorityFailure === true,
        });
      } catch { /* */ }
    }
    return buildM2ToolAuthorityDeniedResponse(decision, batchAuthorityDenial, context);
  }

  // v59.0 IDE Bridge: notify only after authority classification so a PARTIAL
  // batch containing a denial cannot emit a contradictory success event.
  if (typeof context.onToolResult === 'function') {
    try {
      context.onToolResult(decision.tools?.[0] || 'unknown', {
        success: executionResult.status !== ExecutionStatus.FAILED,
        durationMs: executionResult.duration,
        summary: `${executionResult.toolResults.length} results`,
      });
    } catch { /* */ }
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
        const fallbackDecision = creDecisionEngine.overrideDecision({
          type: DecisionType.ANSWER,
          intent: IntentType.CONVERSATIONAL,
          source: 'search_failure_fallback',
          reason: 'LLM fallback after search failure',
          confidence: decision.confidence,
          originalDecision: decision,
        });
        const llmFallback = await handleAnswerDecision(input, fallbackDecision, context);
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

  // v86 M2: Track tool success for cross-conversation pattern learning
  try {
    const primaryTool = decision.tools?.[0];
    const toolSuccess = executionResult.status !== ExecutionStatus.FAILED;
    if (primaryTool) {
      patternTracker.recordTurn(decision.intent, input, { tool: primaryTool, toolSuccess });
    }
  } catch (_) {}

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
    searchSubType: decision.metadata?.searchSubType,  // v62.2: NEWS/SPEC/COMPARISON/etc.
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
      semanticScore: synthesizedResponse.semanticScore || null, // v126.1
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
      // v62.2: Removed "řekni mu, že potřebuješ provést vyhledávání" — caused meta-refusal loop
      cs: `Jsi užitečný AI asistent v konverzačním režimu.

PRAVIDLA:
- Zpracováváš běžnou konverzaci, názory a obecné znalosti
- Odpovídej na základě svých znalostí — NIKDY neříkej "potřeboval bych vyhledávání"
- NIKDY neříkej "nemám přístup", "nemohu vyhledávat", "nemám aktuální data"
- Pokud si nejsi jistý, odpověz co nejlépe na základě svých znalostí
- Odpovídej VÝHRADNĚ ČESKY, nikdy nepřepínej do jiného jazyka

KVALITA ODPOVĚDÍ:
- Odpovídej PODROBNĚ a KONKRÉTNĚ — žádné vágní obecnosti
- Když vysvětluješ koncept: vysvětli princip + uveď praktický příklad + ukaž kód pokud je relevantní
- Když generuješ kód: KOMPLETNÍ, funkční, spustitelný — žádné TODO, pass, placeholder, "doplňte zde"
- Když porovnáváš technologie: konkrétní výhody/nevýhody + doporučení pro daný use-case
- Když analyzuješ kód: najdi KONKRÉTNÍ problémy + navrhni KONKRÉTNÍ opravu s kódem
- Strukturuj odpověď: nadpisy, seznamy, code blocky — podle povahy dotazu
- Krátká otázka = stručná ale úplná odpověď. Složitá otázka = podrobná strukturovaná odpověď
- Pamatuj si kontext konverzace a odkazuj na předchozí diskusi

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
- You handle conversation, opinions, and general knowledge
- Answer based on your training knowledge — NEVER say "I would need to search" or "I cannot access"
- If unsure, answer to the best of your knowledge
- Respond EXCLUSIVELY IN ENGLISH

RESPONSE QUALITY:
- Answer with DETAIL and SPECIFICITY — no vague generalities
- When explaining concepts: explain the principle + give a practical example + show code if relevant
- When generating code: COMPLETE, functional, runnable — no TODO, pass, placeholder, "implement here"
- When comparing technologies: concrete pros/cons + recommendation for the use-case
- When analyzing code: find SPECIFIC problems + propose SPECIFIC fixes with code
- Structure responses: headings, lists, code blocks — as appropriate for the question
- Short question = concise but complete answer. Complex question = detailed structured answer
- Remember conversation context and reference previous discussion

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
    // v61.3: Fix operator precedence (|| vs +) and add strict language enforcement
    let systemPrompt = (CONVERSATIONAL_SYSTEM_PROMPTS[langCtx.language]
      || CONVERSATIONAL_SYSTEM_PROMPTS.cs)
      + (langCtx.instruction || '')
      + buildStrictLanguageInstruction(langCtx.language);

    // v65.4: Project context injection (sanitized, length-limited)
    systemPrompt += buildProjectContext(context);

    // v123.2: System step — prompt prepared
    if (typeof context.onSystemStep === 'function') {
      try { context.onSystemStep('preparing_prompt', `${prompt.length} znaků, jazyk: ${langCtx.language}`); } catch (_) {}
    }

    // Call LLM via CRE bridge (authorized)
    // v55.2 Sprint 2: Retry loop with D6 gate + creative quality enforcement
    // v61.3: Increased to 2 for D6 gate + language validation retries
    const MAX_ANSWER_RETRIES = 2;
    let answerRetry = 0;
    let currentPrompt = prompt;
    let result;

    // v59.0 IDE Bridge: Notify LLM start for ANSWER path
    if (typeof context.onLLMStart === 'function') {
      try { context.onLLMStart('answer', prompt.length); } catch { /* */ }
    }

    while (answerRetry <= MAX_ANSWER_RETRIES) {
      // v123.2: System step — calling LLM
      if (typeof context.onSystemStep === 'function') {
        try { context.onSystemStep('llm_calling', answerRetry > 0 ? `Opakuji (pokus ${answerRetry + 1})` : 'Generuji odpověď'); } catch (_) {}
      }

      result = await creBridge.generateChatResponse(currentPrompt, systemPrompt, {
        sessionId: `conv-${sessionId}`,
        temperature: answerRetry === 0 ? 0.7 : 0.5,
      });

      // v123.2: System step — LLM response received
      if (typeof context.onSystemStep === 'function') {
        try { context.onSystemStep('llm_response', `${result.content.length} znaků` + (result.duration ? `, ${result.duration}ms` : '')); } catch (_) {}
      }

      // CRITICAL: Validate response against forbidden phrases
      // v72: Skip for CONVERSATIONAL — farewell/gratitude naturally uses phrases like
      // "feel free to ask" or "neváhejte se zeptat" which are NOT hedging
      if (decision.intent !== IntentType.CONVERSATIONAL) {
        const validation = creDecisionEngine.validateResponse(result.content);
        if (!validation.valid) {
          logger.error('ConversationHandler', 'LLM generated FORBIDDEN response', {
            violations: validation.violations,
            content: result.content.substring(0, 200),
          });
          return createForbiddenResponseError(input, validation.violations);
        }
      }

      // ════════════════════════════════════════════════════════════════════════
      // v55.2 Sprint 2.1 — D6 Output Quality Gate for ANSWER path
      // ════════════════════════════════════════════════════════════════════════
      const gateVerdict = enforceOutputContract(result.content, {
        intent: decision.intent || 'CONVERSATIONAL',
        responseIntent: null,
      });

      // v123.2: System step — D6 quality gate
      if (typeof context.onSystemStep === 'function') {
        try { context.onSystemStep('quality_d6', gateVerdict.ok ? '\u2705' : 'retry: ' + gateVerdict.failDimension, 2); } catch (_) {}
      }

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
      // v61.3 — Language Validation Gate: detect SK/RU/CN contamination
      // ════════════════════════════════════════════════════════════════════════
      const langValidation = validateResponseLanguage(result.content, langCtx.language);

      // v123.2: System step — language validation
      if (typeof context.onSystemStep === 'function') {
        try { context.onSystemStep('quality_lang', langValidation.clean ? '\u2705' : langValidation.issues.join(', '), 2); } catch (_) {}
      }

      if (!langValidation.clean && answerRetry < MAX_ANSWER_RETRIES) {
        logger.warn('ConversationHandler', 'Language validation failed on ANSWER path, retrying', {
          issues: langValidation.issues,
          language: langCtx.language,
          retry: answerRetry,
        });
        currentPrompt = buildLanguageRetryInstruction(langCtx.language, langValidation.issues)
          + '\n\n' + prompt;
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

export {
  handleToolCallDecision,
  buildFailureFallback,
  handleAskUserDecision,
  formatClarificationRequest,
  handleAnswerDecision,
  createForbiddenResponseError,
  handleRefuseDecision,
};
