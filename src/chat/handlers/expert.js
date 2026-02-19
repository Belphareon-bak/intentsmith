// Expert Handler — extracted from handlers.js
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
import { ExpertEnforcer, quickCheck } from '../../experts/expert-enforcement.js';
import { enforceCapabilities } from '../../experts/capability-enforcer.js';
import { mergeExpertisePrompt } from '../../experts/merge-engine.js';
import { CompatibilityBlockError } from '../../experts/merge-types.js';

// v63.2: Capability drift logging — always log, not just on failure
// v63.3: executionTraceId + executionStep for cross-layer tracing
async function logCapabilityDrift(conversationId, expertId, capabilityProfile, response, executionTraceId = null, executionStep = 'CAPABILITY') {
  if (!capabilityProfile || !response) return null;
  try {
    const result = enforceCapabilities(response, capabilityProfile);
    // Lazy import DB to avoid circular deps
    const { capabilityDriftLog } = await import('../../db/database.js');
    if (capabilityDriftLog?.log) {
      capabilityDriftLog.log({
        conversationId,
        executionTraceId,
        expertId,
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

export async function expertHandler(input, context) {
  const { sessionId, expert, sessionState } = context;

  // v63.3: ExecutionTrace ID — one UUID per user turn, shared across all audit layers
  const executionTraceId = randomUUID();

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

  if (expert && expert.id) {
    logger.info('ExpertHandler', `Expert active: ${expert.name}`, {
      expertId: expert.id,
      domain: expert.domain || 'general',
    });

    // ════════════════════════════════════════════════════════════════════════
    // v44.6 FIX 6: Expert MUST NOT change decision type
    // ════════════════════════════════════════════════════════════════════════
    // Expert only INTERPRETS results, never changes what decision to make.
    // If user asks for creative writing with expert active, expert answers directly.
    // ════════════════════════════════════════════════════════════════════════

    // v44.2+ - Use CRE decision engine WITH expert context
    const decision = creDecisionEngine.decide(input, {
      ...context,
      hasActiveExpert: true,
      expert: expert,
    });

    assertDecision(decision);

    logger.info('ExpertHandler', `CRE Decision: ${decision.type}`, {
      intent: decision.intent,
      tools: decision.tools,
      expert: expert.name,
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
    if (expert.styleRules?.toolEnforcement && decision.type === DecisionType.ANSWER) {
      const { specialistRuntime } = await import('../../experts/specialist-runtime.js');

      if (specialistRuntime.isSpecialist(expert.id)) {
        try {
          const toolResult = await specialistRuntime.tryToolExecution(expert.id, input);

          if (toolResult) {
            logger.info('ExpertHandler', 'Specialist tool interception: ANSWER → TOOL_CALL', {
              toolType: toolResult.toolType,
              expert: expert.id,
            });

            const toolResponse = await executeSpecialistTool(input, toolResult, expert, context);
            return toolResponse;
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
          return await wrapWithExpertPersona(input, toolResult, expert, context);
        }
        return toolResult;

      case DecisionType.ASK_USER:
        return handleAskUserDecision(input, decision, context);

      case DecisionType.ANSWER:
        // v44.6 - For CONVERSATIONAL, expert answers directly (no tools!)
        // This is the correct flow - expert uses their knowledge
        return await generateExpertResponse(input, expert, context);

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
    mode: ChatMode.EXPERT,
    confidence: 1.0,
    canExecute: false,
    metadata: {
      decision: { type: 'ASK_USER', reason: 'EXPERT_REQUIRED' },
      slots: ['expert'],
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
 * Uses expert.temperature, expert.getSynthesisHints(), and forbiddenPhrases enforcement
 */
async function generateExpertResponse(input, expert, context) {
  const { sessionId } = context;

  try {
    // Lazy import CRE bridge for LLM calls
    const creBridge = await import('../../llm/cre-bridge.js');

    // v57.0 - Build expert system prompt with synthesis hints
    const expertSystemPrompt = await buildExpertSystemPrompt(expert);

    // Build prompt with context
    let prompt = input;
    if (context.history?.length > 0) {
      const historyContext = context.history
        .slice(-5)
        .map(h => `${h.response?.tag?.speaker || 'user'}: ${h.response?.content?.substring(0, 200) || ''}`)
        .join('\n');
      prompt = `Previous context:\n${historyContext}\n\nUser question: ${input}`;
    }

    // v57.0 - Use expert.temperature instead of hard-coded 0.5
    const temperature = expert.temperature ?? 0.5;

    // v57.0 - Get synthesis hints for metadata
    const synthesisHints = expert.getSynthesisHints ? expert.getSynthesisHints() : null;

    // Create regeneration function for enforcement
    // v63.2: Accept retryOptions for temperature decay + seed
    const regenerateFn = async (retryPrompt, violations, retryOptions) => {
      const decay = retryOptions?.temperatureDecay || 0.1;
      const retryTemp = Math.max(0.1, temperature - decay); // floor 0.1
      const retryResult = await creBridge.generateChatResponse(retryPrompt, expertSystemPrompt, {
        sessionId: `expert-${sessionId}-retry`,
        temperature: retryTemp,
        seed: retryOptions?.seed,
      });
      return retryResult.content;
    };

    // Call LLM with expert persona
    // v63.3: Capture timing for LLM execution log (performance.now() for sub-ms precision)
    const llmStart = performance.now();
    const result = await creBridge.generateChatResponse(prompt, expertSystemPrompt, {
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
      expertId: expert.id,
      model: result.model || null,
      temperature,
      promptHash: hashPrompt(prompt + expertSystemPrompt),
      promptTokens: result.promptTokens ?? null,
      completionTokens: result.completionTokens ?? null,
      latencyMs: llmLatency,
      tokenSource: singleTokenSource,
      metadata: {
        promptLength: prompt.length,
        systemPromptLength: expertSystemPrompt.length,
      },
    });

    // v57.0 - ENFORCE: Check response against expert rules with retry
    // v63.2: Strict mode for experts with toolEnforcement (e.g. accountant)
    // v63.3: Pass executionTraceId for retry audit trail
    const enforcer = new ExpertEnforcer(expert, regenerateFn, {
      strict: !!expert.styleRules?.strictToolEnforcement,
      executionTraceId,
    });
    const enforcement = await enforcer.enforce(result.content, input);

    // Log enforcement results
    if (enforcement.wasRetried) {
      logger.info('ExpertHandler', `Response regenerated after ${enforcement.attempts} attempts`, {
        expert: expert.id,
        passed: enforcement.passed,
      });
    }

    // v63.2: Hard fail — strict enforcement suppressed the response
    if (enforcement.hardFail) {
      logger.warn('ExpertHandler', 'Strict enforcement hard fail', {
        expert: expert.id,
        violations: enforcement.violations,
        attempts: enforcement.attempts,
        executionTraceId,
      });
      const failTag = new ResponseTag({
        speaker: ResponseSpeaker.EXPERT,
        mode: ChatMode.EXPERT,
        confidence: 0.0,
        canExecute: false,
        metadata: {
          ...(context.debug ? { executionTraceId } : {}),
          expert: { id: expert.id, name: expert.name, domain: expert.domain },
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
    if (expert.styleRules?.toolEnforcement) {
      const guard = await import('../../experts/guards/tool-enforcement.js');
      const numericVerdict = guard.verifyNumericClaims(enforcement.response, []);
      if (!numericVerdict.ok) {
        logger.warn('ExpertHandler', 'Direct expert response has unbacked numbers', {
          expert: expert.id,
          unbacked: numericVerdict.unbacked.length,
        });
        enforcement.response += '\n\n---\n*⚠️ Uvedená čísla nebyla ověřena z externích zdrojů.*';
      }
    }

    // Build response tag with enforcement metadata
    const tag = new ResponseTag({
      speaker: ResponseSpeaker.EXPERT,
      mode: ChatMode.EXPERT,
      confidence: enforcement.passed ? 0.9 : 0.7,
      canExecute: false,
      metadata: {
        ...(context.debug ? { executionTraceId } : {}),
        expert: {
          id: expert.id,
          name: expert.name,
          domain: expert.domain,
          strength: expert.strength,
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
        expert: expert.id,
        violations: enforcement.violations,
      });
      // Don't show warning to user, just log it
    }

    // v63.2: Capability drift logging — ALWAYS log, not just on failure
    // v63.3: Pass executionTraceId for cross-layer tracing
    if (expert.capabilities && finalContent) {
      logCapabilityDrift(sessionId, expert.id, expert.capabilities, finalContent, executionTraceId);
    }

    return new TaggedResponse({
      content: finalContent,
      tag,
    });

  } catch (err) {
    logger.error('ExpertHandler', `LLM call failed: ${err.message}`);

    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.EXPERT,
      confidence: 1.0,
      canExecute: false,
      metadata: {
        error: true,
        errorType: 'EXPERT_LLM_FAILED',
        expert: expert.id,
      },
    });

    return new TaggedResponse({
      content: `⚠️ **Chyba experta**\n\n` +
               `Expert "${expert.name}" nemohl zpracovat dotaz.\n\n` +
               `**Důvod:** ${err.message}`,
      tag,
    });
  }
}

/**
 * v57.0 - Wrap tool execution result with expert persona
 * Takes raw tool results and has expert interpret them
 * Uses expert.temperature and enforcement
 */
async function wrapWithExpertPersona(input, toolResult, expert, context) {
  try {
    const creBridge = await import('../../llm/cre-bridge.js');
    const expertSystemPrompt = await buildExpertSystemPrompt(expert);

    // Build prompt that includes tool results
    const toolContent = toolResult.content || '';
    const prompt = `User asked: "${input}"

Tool execution results:
${toolContent}

Based on these results, provide your expert analysis and response.`;

    // v57.0 - Use expert.temperature
    const temperature = expert.temperature ?? 0.5;

    const result = await creBridge.generateChatResponse(prompt, expertSystemPrompt, {
      sessionId: `expert-${context.sessionId}`,
      temperature,
    });

    // v57.0 - Quick check for forbidden phrases (no retry for wrapping)
    const check = quickCheck(result.content, expert);
    if (!check.passed) {
      logger.warn('ExpertHandler', 'Expert wrap response had violations', {
        expert: expert.id,
        violations: check.violations,
      });
    }

    const tag = new ResponseTag({
      speaker: ResponseSpeaker.EXPERT,
      mode: ChatMode.EXPERT,
      confidence: check.passed ? 0.9 : 0.75,
      canExecute: false,
      metadata: {
        expert: { id: expert.id, name: expert.name, domain: expert.domain },
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
 * Uses expert.getSynthesisHints() for style guidance
 */
async function buildExpertSystemPrompt(expert) {
  const basePrompt = `You are ${expert.name}, an expert in ${expert.domain || 'technology'}.

Your expertise includes: ${expert.description || expert.domain || 'general software development'}

IMPORTANT RULES:
- Respond as ${expert.name}, using your domain expertise
- Be specific and technical when appropriate
- If a question is outside your expertise, say so
- Never claim you cannot access information - if you need data, explain what would be helpful`;

  // v57.0 - Add synthesis hints from expert
  const hints = expert.getSynthesisHints ? expert.getSynthesisHints() : null;
  let styleGuidance = '';

  if (hints && hints.active && hints.systemAddition) {
    styleGuidance = `\n\nSTYLE GUIDANCE:\n${hints.systemAddition}`;
  }

  // v57.0 - Add forbidden phrases as explicit instructions
  const forbiddenPhrases = expert.styleRules?.forbiddenPhrases || [];
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

  if (expert.systemPrompt) {
    fullPrompt = `${fullPrompt}\n\n${expert.systemPrompt}`;
  }

  // D-int3: Inject memory context for {{ memory_context }} placeholder
  if (fullPrompt.includes('{{ memory_context }}')) {
    try {
      const { ExpertStore } = await import('../../experts/expert-store.js');
      const store = new ExpertStore();
      const memoryContext = store.getMemoryContext(expert.id);
      fullPrompt = fullPrompt.replace(
        '{{ memory_context }}',
        memoryContext || 'Žádné uložené informace z předchozích relací.'
      );
    } catch (err) {
      logger.warn('ExpertHandler', `Failed to inject memory context: ${err.message}`);
      fullPrompt = fullPrompt.replace('{{ memory_context }}', 'Paměťový kontext nedostupný.');
    }
  }

  return fullPrompt;
}

/**
 * D1: Execute a specialist tool using the SpecialistRuntime result.
 * Takes the already-executed tool result, formats as TaggedResponse,
 * then wraps with expert persona via LLM for human-readable output.
 */
async function executeSpecialistTool(input, toolResult, expert, context) {
  const { toolType, result, params } = toolResult;

  // Format tool result as content string
  const toolContent = JSON.stringify(result, null, 2);

  // Build TaggedResponse with tool data
  const rawTag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.EXPERT,
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
  return await wrapWithExpertPersona(input, rawResponse, expert, context);
}

/**
 * v63.0 — Handle merged expertises flow.
 * Uses mergeExpertisePrompt() pure function to combine multiple expertises,
 * then uses the merged prompt + enforcement for LLM call.
 * v63.3: executionTraceId propagated from expertHandler entry point.
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
      { registry: context.expertRegistry || {} },
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
      expertId: mergeResult.metadata.expertiseIds.join('+'),
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

    const enforcer = new ExpertEnforcer(syntheticExpert, regenerateFn, {
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
        speaker: ResponseSpeaker.EXPERT,
        mode: ChatMode.EXPERT,
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
      speaker: ResponseSpeaker.EXPERT,
      mode: ChatMode.EXPERT,
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
        mode: ChatMode.EXPERT,
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
      mode: ChatMode.EXPERT,
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

export { generateExpertResponse, wrapWithExpertPersona, buildExpertSystemPrompt, handleMergedExpertises };
