// Expertise Handler — extracted from handlers.js
// v57.0 - Expert lifecycle with enforcement
// Handles EXPERT mode - domain expertise

import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from '../controller.js';
import {
  creDecisionEngine,
  DecisionType,
  assertDecision,
} from '../cre-decision.js';
import { logger } from '../../core/logger.js';
import {
  handleToolCallDecision,
  handleAskUserDecision,
  handleRefuseDecision,
} from './decisions.js';
import { randomUUID, createHash } from 'crypto';
import { ExpertiseEnforcer, quickCheck } from '../../expertises/expertise-enforcement.js';
import { enforceCapabilities } from '../../expertises/capability-enforcer.js';
import { mergeExpertisePrompt } from '../../expertises/merge-engine.js';
import { CompatibilityBlockError } from '../../expertises/merge-types.js';

// v63.2: Capability drift logging — always log, not just on failure
// v63.3: executionTraceId + executionStep for cross-layer tracing
async function logCapabilityDrift(conversationId, expertiseId, capabilityProfile, response, executionTraceId = null, executionStep = 'CAPABILITY') {
  if (!capabilityProfile || !response) return null;
  try {
    const result = enforceCapabilities(response, capabilityProfile);
    // Lazy import DB to avoid circular deps
    const { capabilityDriftLog } = await import('../../db/database.js');
    if (capabilityDriftLog?.log) {
      capabilityDriftLog.log({
        conversationId,
        executionTraceId,
        expertiseId,
        mergedPromptHash: null, // populated by merge path
        expectedProfile: capabilityProfile,
        observedScores: result.scores,
        driftScore: result.driftScore,
        violations: result.violations.length > 0 ? result.violations : null,
        executionStep,
      });
    }
    return result;
  } catch (err) {
    logger.debug('ExpertHandler', `Capability drift log failed: ${err.message}`);
    return null;
  }
}

// v63.3: Prompt hash for determinism analysis (never store the prompt itself)
function hashPrompt(prompt) {
  return createHash('sha256').update(prompt).digest('hex');
}

// v63.3: LLM execution step logging — model, temperature, latency, tokens
async function logLlmExecution(entry) {
  try {
    const { llmExecutionLog } = await import('../../db/database.js');
    if (llmExecutionLog?.log) {
      llmExecutionLog.log(entry);
    }
  } catch (err) {
    logger.debug('ExpertHandler', `LLM execution log failed: ${err.message}`);
  }
}

export async function expertiseHandler(input, context) {
  const { sessionId, expertise, sessionState } = context;

  // v63.3: ExecutionTrace ID — one UUID per user turn, shared across all audit layers
  const executionTraceId = randomUUID();
  // v79: Propagate via context so generateExpertiseResponse can access it
  context.executionTraceId = executionTraceId;

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 0: Multiple expertises active — delegate to merge handler
  // v63.0 — Merge Engine v2
  // ════════════════════════════════════════════════════════════════════════════

  if (context.activeExpertises && context.activeExpertises.length > 1) {
    return await handleMergedExpertises(input, context, executionTraceId);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 1: Expert IS selected - use CRE then apply expert persona
  // ════════════════════════════════════════════════════════════════════════════

  if (expertise && expertise.id) {
    logger.info('ExpertHandler', `Expertise active: ${expertise.name}`, {
      expertiseId: expertise.id,
      domain: expertise.domain || 'general',
    });

    // ════════════════════════════════════════════════════════════════════════
    // v44.6 FIX 6: Expert MUST NOT change decision type
    // ════════════════════════════════════════════════════════════════════════
    // Expert only INTERPRETS results, never changes what decision to make.
    // If user asks for creative writing with expert active, expert answers directly.
    // ════════════════════════════════════════════════════════════════════════

    // v44.2+ - Use CRE decision engine WITH expert context
    // v71: decide() is now async (LLM-first classification)
    const decision = await creDecisionEngine.decide(input, {
      ...context,
      hasActiveExpertise: true,
      expertise: expertise,
    });

    assertDecision(decision);

    logger.info('ExpertHandler', `CRE Decision: ${decision.type}`, {
      intent: decision.intent,
      tools: decision.tools,
      expertise: expertise.name,
    });

    // ════════════════════════════════════════════════════════════════════════
    // D1: Specialist tool interception (generalized from D-int2)
    // ════════════════════════════════════════════════════════════════════════
    // When a specialist expert is active and CRE says ANSWER, check if input
    // matches specialist tool patterns → execute deterministic tool directly,
    // then wrap result with expert persona for human-readable formatting.
    // This ensures "kolik zaplatím z 850k" gets a precise calculation,
    // not an LLM estimate.
    // ════════════════════════════════════════════════════════════════════════
    if (expertise.styleRules?.toolEnforcement && decision.type === DecisionType.ANSWER) {
      const { specialistRuntime } = await import('../../expertises/specialist-runtime.js');

      if (specialistRuntime.isSpecialist(expertise.id)) {
        try {
          const toolResult = await specialistRuntime.tryToolExecution(expertise.id, input, {
            sessionId: context.sessionId,
            conversationId: context.conversationId || context.sessionId,
          });

          if (toolResult) {
            // v75: Clarification — tool matched but needs more params
            if (toolResult.status === 'clarify') {
              logger.info('ExpertHandler', `Specialist needs clarification: ${toolResult.missingParams.join(', ')}`, {
                toolType: toolResult.toolType,
                expertise: expertise.id,
              });
              // Inject structured context for LLM to ask for missing params
              context.toolClarification = {
                tool: toolResult.toolType,
                missingParams: toolResult.missingParams,
                extractedParams: toolResult.params,
              };
              // Fall through to LLM — it will ask for the specific missing params
            } else {
              logger.info('ExpertHandler', 'Specialist tool interception: ANSWER → TOOL_CALL', {
                toolType: toolResult.toolType,
                expertise: expertise.id,
              });

              const toolResponse = await executeSpecialistTool(input, toolResult, expertise, context);
              return toolResponse;
            }
          }
        } catch (err) {
          logger.warn('ExpertHandler', `Specialist tool failed, falling back to LLM: ${err.message}`);
          // Fall through to normal ANSWER path
        }
      }
    }

    // v44.6 FIX 6: Expert MUST respect CRE decision type
    // If CRE says ANSWER (for CONVERSATIONAL), expert answers directly
    // Expert NEVER forces TOOL_CALL when CRE says ANSWER
    // Handle based on decision
    switch (decision.type) {
      case DecisionType.TOOL_CALL:
        // v44.2+ - Execute tools, then format response with expert persona
        const toolResult = await handleToolCallDecision(input, decision, context);

        // If tool succeeded, wrap response with expert persona
        if (toolResult.tag?.metadata?.executionStatus === 'SUCCESS') {
          return await wrapWithExpertisePersona(input, toolResult, expertise, context);
        }
        return toolResult;

      case DecisionType.ASK_USER:
        return handleAskUserDecision(input, decision, context);

      case DecisionType.ANSWER:
        // v44.6 - For CONVERSATIONAL, expert answers directly (no tools!)
        // This is the correct flow - expert uses their knowledge
        return await generateExpertiseResponse(input, expertise, context);

      default:
        return handleRefuseDecision(input, decision, context);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 2: No expert selected - ASK_USER to select one
  // ════════════════════════════════════════════════════════════════════════════

  logger.info('ExpertHandler', 'No expert selected - asking user');

  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.EXPERTISE,
    confidence: 1.0,
    canExecute: false,
    metadata: {
      decision: { type: 'ASK_USER', reason: 'EXPERT_REQUIRED' },
      slots: ['expertise'],
      awaitingSelection: true,
    },
  });

  return new TaggedResponse({
    content: `👨‍💻 **Vyber experta**\n\n` +
             `Pro odbornou konzultaci vyber experta z nabídky.\n\n` +
             `**Váš dotaz:** "${input.substring(0, 100)}${input.length > 100 ? '...' : ''}"`,
    tag,
  });
}

/**
 * v57.0 - Generate direct expert response with enforcement
 * Uses expertise.temperature, expertise.getSynthesisHints(), and forbiddenPhrases enforcement
 */
async function generateExpertiseResponse(input, expertise, context) {
  const { sessionId } = context;
  // v79: executionTraceId propagated via context from expertiseHandler
  const executionTraceId = context.executionTraceId || null;

  try {
    // Lazy import CRE bridge for LLM calls
    const creBridge = await import('../../llm/cre-bridge.js');

    // v57.0 - Build expert system prompt with synthesis hints
    // D4: Pass conversationId for specialist memory injection
    const conversationId = context.conversationId || sessionId;
    const expertiseSystemPrompt = await buildExpertiseSystemPrompt(expertise, conversationId);

    // Build prompt with context
    let prompt = input;
    if (context.history?.length > 0) {
      const historyContext = context.history
        .slice(-5)
        .map(h => `${h.response?.tag?.speaker || 'user'}: ${h.response?.content?.substring(0, 200) || ''}`)
        .join('\n');
      prompt = `Previous context:\n${historyContext}\n\nUser question: ${input}`;
    }

    // v75: Tool clarification — inject structured context for LLM
    if (context.toolClarification) {
      const tc = context.toolClarification;
      const missingList = tc.missingParams.map(p => `- ${p}`).join('\n');
      const extractedList = Object.entries(tc.extractedParams || {})
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n');
      prompt += `\n\n[SYSTEM: Nástroj ${tc.tool} rozpoznal dotaz, ale chybí povinné parametry.\nChybí:\n${missingList}\nExtrahováno:\n${extractedList}\nZeptej se uživatele na chybějící parametry. Nepočítej sám — čekej na odpověď.]`;
    }

    // v57.0 - Use expertise.temperature instead of hard-coded 0.5
    const temperature = expertise.temperature ?? 0.5;

    // v57.0 - Get synthesis hints for metadata
    const synthesisHints = expertise.getSynthesisHints ? expertise.getSynthesisHints() : null;

    // Create regeneration function for enforcement
    // v63.2: Accept retryOptions for temperature decay + seed
    const regenerateFn = async (retryPrompt, violations, retryOptions) => {
      const decay = retryOptions?.temperatureDecay || 0.1;
      const retryTemp = Math.max(0.1, temperature - decay); // floor 0.1
      const retryResult = await creBridge.generateChatResponse(retryPrompt, expertiseSystemPrompt, {
        sessionId: `expert-${sessionId}-retry`,
        temperature: retryTemp,
        seed: retryOptions?.seed,
      });
      return retryResult.content;
    };

    // Call LLM with expert persona
    // v63.3: Capture timing for LLM execution log (performance.now() for sub-ms precision)
    const llmStart = performance.now();
    const result = await creBridge.generateChatResponse(prompt, expertiseSystemPrompt, {
      sessionId: `expert-${sessionId}`,
      temperature,
    });
    const llmLatency = Math.round(performance.now() - llmStart);

    // v63.3: Log LLM execution step
    const singleTokenSource = result.promptTokens != null ? 'provider' : 'estimated';
    logLlmExecution({
      executionTraceId,
      conversationId: sessionId,
      executionStep: 'LLM',
      expertiseId: expertise.id,
      model: result.model || null,
      temperature,
      promptHash: hashPrompt(prompt + expertiseSystemPrompt),
      promptTokens: result.promptTokens ?? null,
      completionTokens: result.completionTokens ?? null,
      latencyMs: llmLatency,
      tokenSource: singleTokenSource,
      metadata: {
        promptLength: prompt.length,
        systemPromptLength: expertiseSystemPrompt.length,
      },
    });

    // v57.0 - ENFORCE: Check response against expert rules with retry
    // v63.2: Strict mode for experts with toolEnforcement (e.g. accountant)
    // v63.3: Pass executionTraceId for retry audit trail
    const enforcer = new ExpertiseEnforcer(expertise, regenerateFn, {
      strict: !!expertise.styleRules?.strictToolEnforcement,
      executionTraceId,
    });
    const enforcement = await enforcer.enforce(result.content, input);

    // Log enforcement results
    if (enforcement.wasRetried) {
      logger.info('ExpertHandler', `Response regenerated after ${enforcement.attempts} attempts`, {
        expertise: expertise.id,
        passed: enforcement.passed,
      });
    }

    // v63.2: Hard fail — strict enforcement suppressed the response
    if (enforcement.hardFail) {
      logger.warn('ExpertHandler', 'Strict enforcement hard fail', {
        expertise: expertise.id,
        violations: enforcement.violations,
        attempts: enforcement.attempts,
        executionTraceId,
      });
      const failTag = new ResponseTag({
        speaker: ResponseSpeaker.EXPERTISE,
        mode: ChatMode.EXPERTISE,
        confidence: 0.0,
        canExecute: false,
        metadata: {
          ...(context.debug ? { executionTraceId } : {}),
          expertise: { id: expertise.id, name: expertise.name, domain: expertise.domain },
          hardFail: true,
          enforcement: {
            passed: false,
            attempts: enforcement.attempts,
            violations: enforcement.violations,
            retryAudit: enforcement.retryAudit,
          },
        },
      });
      return new TaggedResponse({
        content: 'Omlouvám se, odpověď nesplnila požadavky kvality a byla zamítnuta. Zkuste prosím otázku přeformulovat.',
        tag: failTag,
      });
    }

    // v57.2 - Tool enforcement for direct expert responses (no tool data = all numbers unbacked)
    if (expertise.styleRules?.toolEnforcement) {
      const guard = await import('../../expertises/guards/tool-enforcement.js');
      const numericVerdict = guard.verifyNumericClaims(enforcement.response, []);
      if (!numericVerdict.ok) {
        logger.warn('ExpertHandler', 'Direct expert response has unbacked numbers', {
          expertise: expertise.id,
          unbacked: numericVerdict.unbacked.length,
        });
        enforcement.response += '\n\n---\n*⚠️ Uvedená čísla nebyla ověřena z externích zdrojů.*';
      }
    }

    // Build response tag with enforcement metadata
    const tag = new ResponseTag({
      speaker: ResponseSpeaker.EXPERTISE,
      mode: ChatMode.EXPERTISE,
      confidence: enforcement.passed ? 0.9 : 0.7,
      canExecute: false,
      metadata: {
        ...(context.debug ? { executionTraceId } : {}),
        expertise: {
          id: expertise.id,
          name: expertise.name,
          domain: expertise.domain,
          strength: expertise.strength,
        },
        model: result.model,
        duration: result.duration,
        temperature,
        synthesisHints: synthesisHints ? {
          preset: synthesisHints.preset,
          style: synthesisHints.style,
          depth: synthesisHints.depth,
        } : null,
        enforcement: {
          passed: enforcement.passed,
          attempts: enforcement.attempts,
          wasRetried: enforcement.wasRetried,
        },
      },
    });

    // Add warning to response if enforcement failed
    let finalContent = enforcement.response;
    if (!enforcement.passed && enforcement.warning) {
      logger.warn('ExpertHandler', `Expert response kept despite violations`, {
        expertise: expertise.id,
        violations: enforcement.violations,
      });
      // Don't show warning to user, just log it
    }

    // v63.2: Capability drift logging — ALWAYS log, not just on failure
    // v63.3: Pass executionTraceId for cross-layer tracing
    if (expertise.capabilities && finalContent) {
      logCapabilityDrift(sessionId, expertise.id, expertise.capabilities, finalContent, executionTraceId);
    }

    return new TaggedResponse({
      content: finalContent,
      tag,
    });

  } catch (err) {
    logger.error('ExpertHandler', `LLM call failed: ${err.message}`);

    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.EXPERTISE,
      confidence: 1.0,
      canExecute: false,
      metadata: {
        error: true,
        errorType: 'EXPERT_LLM_FAILED',
        expertise: expertise.id,
      },
    });

    return new TaggedResponse({
      content: `⚠️ **Chyba experta**\n\n` +
               `Expert "${expertise.name}" nemohl zpracovat dotaz.\n\n` +
               `**Důvod:** ${err.message}`,
      tag,
    });
  }
}

/**
 * v57.0 - Wrap tool execution result with expert persona
 * Takes raw tool results and has expert interpret them
 * Uses expertise.temperature and enforcement
 */
async function wrapWithExpertisePersona(input, toolResult, expertise, context) {
  try {
    const creBridge = await import('../../llm/cre-bridge.js');
    const wrapConvId = context.conversationId || context.sessionId;
    const expertiseSystemPrompt = await buildExpertiseSystemPrompt(expertise, wrapConvId);

    // Build prompt that includes tool results
    const toolContent = toolResult.content || '';
    const prompt = `User asked: "${input}"

Tool execution results:
${toolContent}

Based on these results, provide your expert analysis and response.`;

    // v57.0 - Use expertise.temperature
    const temperature = expertise.temperature ?? 0.5;

    const result = await creBridge.generateChatResponse(prompt, expertiseSystemPrompt, {
      sessionId: `expert-${context.sessionId}`,
      temperature,
    });

    // v57.0 - Quick check for forbidden phrases (no retry for wrapping)
    const check = quickCheck(result.content, expertise);
    if (!check.passed) {
      logger.warn('ExpertHandler', 'Expert wrap response had violations', {
        expertise: expertise.id,
        violations: check.violations,
      });
    }

    const tag = new ResponseTag({
      speaker: ResponseSpeaker.EXPERTISE,
      mode: ChatMode.EXPERTISE,
      confidence: check.passed ? 0.9 : 0.75,
      canExecute: false,
      metadata: {
        expertise: { id: expertise.id, name: expertise.name, domain: expertise.domain },
        toolResults: toolResult.tag?.metadata?.toolResults,
        model: result.model,
        temperature,
        enforcement: { passed: check.passed },
      },
    });

    return new TaggedResponse({
      content: result.content,
      tag,
    });

  } catch (err) {
    // If expert wrapping fails, return original tool result
    logger.warn('ExpertHandler', `Expert wrapping failed, returning raw result: ${err.message}`);
    return toolResult;
  }
}

/**
 * v57.0 - Build expert system prompt based on expert profile
 * D-int3: Now async — injects memory context for {{ memory_context }} placeholder
 * D4: Injects specialist memory context for cross-session recall
 * Uses expertise.getSynthesisHints() for style guidance
 * @param {Object} expertise
 * @param {string} [conversationId] - D4: for specialist memory context injection
 */
async function buildExpertiseSystemPrompt(expertise, conversationId) {
  const basePrompt = `You are ${expertise.name}, an expert in ${expertise.domain || 'technology'}.

Your expertise includes: ${expertise.description || expertise.domain || 'general software development'}

IMPORTANT RULES:
- Respond as ${expertise.name}, using your domain expertise
- Be specific and technical when appropriate
- If a question is outside your expertise, say so
- Never claim you cannot access information - if you need data, explain what would be helpful`;

  // v57.0 - Add synthesis hints from expert
  const hints = expertise.getSynthesisHints ? expertise.getSynthesisHints() : null;
  let styleGuidance = '';

  if (hints && hints.active && hints.systemAddition) {
    styleGuidance = `\n\nSTYLE GUIDANCE:\n${hints.systemAddition}`;
  }

  // v57.0 - Add forbidden phrases as explicit instructions
  const forbiddenPhrases = expertise.styleRules?.forbiddenPhrases || [];
  let qualityRules = '';

  if (forbiddenPhrases.length > 0) {
    // Extract readable patterns
    const readablePatterns = forbiddenPhrases
      .slice(0, 5) // Max 5 examples
      .map(p => {
        if (p instanceof RegExp) {
          return p.source.replace(/\\/g, '').replace(/\(.*?\)/g, '...').replace(/\|/g, ' or ');
        }
        return String(p);
      })
      .filter(p => p.length < 50); // Only short ones

    if (readablePatterns.length > 0) {
      qualityRules = `\n\nQUALITY RULES - AVOID these phrases:\n${readablePatterns.map(p => `- "${p}"`).join('\n')}`;
    }
  }

  // Combine all parts
  let fullPrompt = basePrompt + styleGuidance + qualityRules;

  if (expertise.systemPrompt) {
    fullPrompt = `${fullPrompt}\n\n${expertise.systemPrompt}`;
  }

  // D-int3: Inject memory context for {{ memory_context }} placeholder
  if (fullPrompt.includes('{{ memory_context }}')) {
    try {
      const { ExpertiseStore } = await import('../../expertises/expertise-store.js');
      const store = new ExpertiseStore();
      const memoryContext = store.getMemoryContext(expertise.id);
      fullPrompt = fullPrompt.replace(
        '{{ memory_context }}',
        memoryContext || 'Žádné uložené informace z předchozích relací.'
      );
    } catch (err) {
      logger.warn('ExpertHandler', `Failed to inject memory context: ${err.message}`);
      fullPrompt = fullPrompt.replace('{{ memory_context }}', 'Paměťový kontext nedostupný.');
    }
  }

  // D4: Inject specialist memory context (cross-session persistent data)
  if (conversationId && expertise.styleRules?.toolEnforcement) {
    try {
      const { getSpecialistMemory } = await import('../../expertises/specialist-memory.js');
      const memory = getSpecialistMemory();
      const memoryContext = memory.getContext(expertise.id, conversationId);
      if (memoryContext) {
        fullPrompt += `\n\nSPECIALIST MEMORY:\n${memoryContext}`;
      }
    } catch {
      // Memory not initialized or table doesn't exist — skip silently
    }
  }

  return fullPrompt;
}

/**
 * D1: Execute a specialist tool using the SpecialistRuntime result.
 * Takes the already-executed tool result, formats as TaggedResponse,
 * then wraps with expert persona via LLM for human-readable output.
 */
async function executeSpecialistTool(input, toolResult, expertise, context) {
  const { toolType, result, params } = toolResult;

  // Format tool result as content string
  const toolContent = JSON.stringify(result, null, 2);

  // Build TaggedResponse with tool data
  const rawTag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.EXPERTISE,
    confidence: 0.95,
    canExecute: false,
    metadata: {
      executionStatus: 'SUCCESS',
      toolResults: [{ type: toolType, data: result }],
      specialistTool: toolType,
      extractedParams: params,
    },
  });

  const rawResponse = new TaggedResponse({ content: toolContent, tag: rawTag });

  // Wrap with expert persona for human-readable formatting
  return await wrapWithExpertisePersona(input, rawResponse, expertise, context);
}

/**
 * v63.0 — Handle merged expertises flow.
 * Uses mergeExpertisePrompt() pure function to combine multiple expertises,
 * then uses the merged prompt + enforcement for LLM call.
 * v63.3: executionTraceId propagated from expertiseHandler entry point.
 */
async function handleMergedExpertises(input, context, executionTraceId) {
  const { sessionId, activeExpertises } = context;

  try {
    logger.info('ExpertHandler', `Merged expertise flow: ${activeExpertises.length} expertises`, {
      expertises: activeExpertises.map(e => e.id),
    });

    // Step 1: Call pure merge function
    const mergeResult = mergeExpertisePrompt(
      activeExpertises,
      context.specialistOverride || null,
      context.userContext || null,
      { registry: context.expertiseRegistry || {} },
    );

    // Step 2: Call LLM with merged prompt
    const creBridge = await import('../../llm/cre-bridge.js');

    let prompt = input;
    if (context.history?.length > 0) {
      const historyContext = context.history
        .slice(-5)
        .map(h => `${h.response?.tag?.speaker || 'user'}: ${h.response?.content?.substring(0, 200) || ''}`)
        .join('\n');
      prompt = `Previous context:\n${historyContext}\n\nUser question: ${input}`;
    }

    // v63.3: Capture timing for LLM execution log (performance.now() for sub-ms precision)
    const llmStart = performance.now();
    const result = await creBridge.generateChatResponse(prompt, mergeResult.prompt, {
      sessionId: `merged-${sessionId}`,
      temperature: mergeResult.metadata.temperature,
    });
    const llmLatency = Math.round(performance.now() - llmStart);

    // v63.3: Log LLM execution step for merged expertises
    const mergeTokenSource = result.promptTokens != null ? 'provider' : 'estimated';
    logLlmExecution({
      executionTraceId,
      conversationId: sessionId,
      executionStep: 'LLM',
      expertiseId: mergeResult.metadata.expertiseIds.join('+'),
      model: result.model || null,
      temperature: mergeResult.metadata.temperature,
      promptHash: hashPrompt(prompt + mergeResult.prompt),
      promptTokens: result.promptTokens ?? null,
      completionTokens: result.completionTokens ?? null,
      latencyMs: llmLatency,
      tokenSource: mergeTokenSource,
      metadata: {
        merged: true,
        expertiseCount: activeExpertises.length,
        promptLength: prompt.length,
        mergedPromptLength: mergeResult.prompt.length,
        tone: mergeResult.metadata.tone,
        temperatureMethod: mergeResult.metadata.temperatureMethod,
      },
    });

    // Step 3: Enforce with merged config
    // v63.2: Propagate strict mode if ANY active expertise has it
    const hasStrictExpertise = activeExpertises.some(
      e => e.styleRules?.strictToolEnforcement
    );

    const syntheticExpert = {
      id: '_merged',
      name: activeExpertises.map(e => e.name || e.id).join(' + '),
      domain: 'merged',
      styleRules: {
        forbiddenPhrases: mergeResult.enforcement.forbiddenPhrases,
        minResponseLength: mergeResult.enforcement.minResponseLength,
        toolEnforcement: mergeResult.enforcement.toolEnforcement,
        strictToolEnforcement: hasStrictExpertise,
      },
    };

    const regenerateFn = async (retryPrompt, violations, retryOptions) => {
      const decay = retryOptions?.temperatureDecay || 0.1;
      const retryTemp = Math.max(0.1, mergeResult.metadata.temperature - decay); // floor 0.1
      const retryResult = await creBridge.generateChatResponse(retryPrompt, mergeResult.prompt, {
        sessionId: `merged-${sessionId}-retry`,
        temperature: retryTemp,
        seed: retryOptions?.seed,
      });
      return retryResult.content;
    };

    const enforcer = new ExpertiseEnforcer(syntheticExpert, regenerateFn, {
      strict: hasStrictExpertise,
      executionTraceId,
    });
    const enforcement = await enforcer.enforce(result.content, input);

    // v63.2: Hard fail — strict enforcement suppressed the response
    if (enforcement.hardFail) {
      logger.warn('ExpertHandler', 'Merged enforcement hard fail', {
        expertises: activeExpertises.map(e => e.id),
        violations: enforcement.violations,
        attempts: enforcement.attempts,
        executionTraceId,
      });
      const failTag = new ResponseTag({
        speaker: ResponseSpeaker.EXPERTISE,
        mode: ChatMode.EXPERTISE,
        confidence: 0.0,
        canExecute: false,
        metadata: {
          ...(context.debug ? { executionTraceId } : {}),
          merged: true,
          hardFail: true,
          enforcement: {
            passed: false,
            attempts: enforcement.attempts,
            violations: enforcement.violations,
            retryAudit: enforcement.retryAudit,
          },
        },
      });
      return new TaggedResponse({
        content: 'Omlouvám se, odpověď nesplnila požadavky kvality a byla zamítnuta. Zkuste prosím otázku přeformulovat.',
        tag: failTag,
      });
    }

    // Step 4: Append disclaimers (deduplicated — 🟡6)
    let finalContent = enforcement.response;
    const disclaimers = mergeResult.enforcement.disclaimers || [];
    if (disclaimers.length > 0) {
      const seen = new Set();
      const uniqueDisclaimers = disclaimers.filter(d => {
        const normalized = d.trim().toLowerCase();
        if (seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      });
      if (uniqueDisclaimers.length > 0) {
        finalContent += '\n\n---\n';
        for (const d of uniqueDisclaimers) {
          finalContent += `*${d}*\n`;
        }
      }
    }

    // Step 5: Build response tag
    const tag = new ResponseTag({
      speaker: ResponseSpeaker.EXPERTISE,
      mode: ChatMode.EXPERTISE,
      confidence: enforcement.passed ? 0.9 : 0.7,
      canExecute: false,
      metadata: {
        ...(context.debug ? { executionTraceId } : {}),
        merged: true,
        expertises: mergeResult.metadata.expertiseIds,
        weights: mergeResult.metadata.weights,
        tone: mergeResult.metadata.tone,
        temperature: mergeResult.metadata.temperature,
        temperatureMethod: mergeResult.metadata.temperatureMethod,
        tokenCount: mergeResult.metadata.tokenCount,
        compatibility: mergeResult.metadata.compatibility,
        model: result.model,
        duration: result.duration,
        enforcement: {
          passed: enforcement.passed,
          attempts: enforcement.attempts,
          wasRetried: enforcement.wasRetried,
        },
      },
    });

    // Step 6: Audit log (in debug mode)
    // v63.3: Include executionTraceId in merge audit
    if (context.debug) {
      logger.debug('ExpertHandler', 'Merge audit', { ...mergeResult.audit, executionTraceId });
      try {
        const { mergeAuditLog } = await import('../../db/database.js');
        if (mergeAuditLog?.log) {
          mergeAuditLog.log(sessionId, { ...mergeResult.audit, executionTraceId }, executionTraceId);
        }
      } catch {
        // Non-critical — audit log failure doesn't block response
      }
    }

    // v63.2: Capability drift logging — ALWAYS log for merged expertises
    // v63.3: Pass executionTraceId + step='CAPABILITY' for cross-layer tracing
    if (mergeResult.metadata.capabilityVector && finalContent) {
      logCapabilityDrift(
        sessionId,
        mergeResult.metadata.expertiseIds.join('+'),
        mergeResult.metadata.capabilityVector,
        finalContent,
        executionTraceId,
        'CAPABILITY',
      );
    }

    return new TaggedResponse({ content: finalContent, tag });

  } catch (err) {
    if (err instanceof CompatibilityBlockError) {
      logger.warn('ExpertHandler', `Merge blocked: ${err.message}`);

      const tag = new ResponseTag({
        speaker: ResponseSpeaker.SYSTEM,
        mode: ChatMode.EXPERTISE,
        confidence: 1.0,
        canExecute: false,
        metadata: {
          error: true,
          errorType: 'MERGE_COMPATIBILITY_BLOCK',
          compatibility: err.compatibility,
        },
      });

      const conflictDetails = err.compatibility.conflicts
        .flatMap(c => c.conflicts?.map(cc => cc.detail) || [])
        .join('\n- ');

      return new TaggedResponse({
        content: `⚠️ **Nekompatibilní kombinace expertiz**\n\n` +
                 `Vybrané expertízy nelze zkombinovat:\n- ${conflictDetails}\n\n` +
                 `Zkuste jinou kombinaci nebo snižte počet expertíz.`,
        tag,
      });
    }

    logger.error('ExpertHandler', `Merge failed: ${err.message}`);

    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.EXPERTISE,
      confidence: 1.0,
      canExecute: false,
      metadata: {
        error: true,
        errorType: 'MERGE_FAILED',
      },
    });

    return new TaggedResponse({
      content: `⚠️ **Chyba při slučování expertíz**\n\n${err.message}`,
      tag,
    });
  }
}

export { generateExpertiseResponse, wrapWithExpertisePersona, buildExpertiseSystemPrompt, handleMergedExpertises };
