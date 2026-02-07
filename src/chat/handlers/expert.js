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
import { ExpertEnforcer, quickCheck } from '../../experts/expert-enforcement.js';

export async function expertHandler(input, context) {
  const { sessionId, expert, sessionState } = context;

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
    const expertSystemPrompt = buildExpertSystemPrompt(expert);

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
    const regenerateFn = async (retryPrompt, violations) => {
      const retryResult = await creBridge.generateChatResponse(retryPrompt, expertSystemPrompt, {
        sessionId: `expert-${sessionId}-retry`,
        temperature: Math.max(0.2, temperature - 0.1), // Slightly lower temp for retry
      });
      return retryResult.content;
    };

    // Call LLM with expert persona
    const result = await creBridge.generateChatResponse(prompt, expertSystemPrompt, {
      sessionId: `expert-${sessionId}`,
      temperature,
    });

    // v57.0 - ENFORCE: Check response against expert rules with retry
    const enforcer = new ExpertEnforcer(expert, regenerateFn);
    const enforcement = await enforcer.enforce(result.content, input);

    // Log enforcement results
    if (enforcement.wasRetried) {
      logger.info('ExpertHandler', `Response regenerated after ${enforcement.attempts} attempts`, {
        expert: expert.id,
        passed: enforcement.passed,
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
    const expertSystemPrompt = buildExpertSystemPrompt(expert);

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
 * Uses expert.getSynthesisHints() for style guidance
 */
function buildExpertSystemPrompt(expert) {
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

  return fullPrompt;
}

export { generateExpertResponse, wrapWithExpertPersona, buildExpertSystemPrompt };
