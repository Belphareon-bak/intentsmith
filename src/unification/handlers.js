// CRE v44.0 — Chat Handlers
// ══════════════════════════════════════════════════════════════════════════════
//
// Mode-specific handlers for ChatController
// All handlers use CRE Decision Engine for tool-first logic
//
// INVARIANTS:
// 1. No text response without CRE Decision
// 2. SEARCH/FACT/REPORT = TOOL_CALL first (never ANSWER without tool)
// 3. CHAT mode ≠ text mode (CHAT is a goal type, not "allow LLM")
//
// ══════════════════════════════════════════════════════════════════════════════

import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from './chat-controller.js';
import {
  creDecisionEngine,
  DecisionType,
  IntentType,
  FORBIDDEN_PHRASES,
  assertDecision,
  assertNoDirectAnswer,
} from './cre-decision.js';
import { toolExecutor, ExecutionStatus } from './tool-executor.js';
import { logger } from '../core/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Conversation Handler (with CRE Decision Logic)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle conversation mode - uses CRE Decision Engine
 * Only allows direct LLM response for pure CONVERSATIONAL intent
 */
export async function conversationHandler(input, context) {
  const { sessionId } = context;

  // STEP 1: Get CRE Decision
  const decision = creDecisionEngine.decide(input, context);

  // STEP 1.5: Fail-fast assertion - catch bugs early
  assertDecision(decision);

  logger.info('ConversationHandler', `CRE Decision: ${decision.type}`, {
    intent: decision.intent,
    tools: decision.tools,
    reason: decision.reason,
  });

  // STEP 2: Handle based on decision type
  switch (decision.type) {
    case DecisionType.TOOL_CALL:
      return await handleToolCallDecision(input, decision, context);

    case DecisionType.ASK_USER:
      return handleAskUserDecision(input, decision, context);

    case DecisionType.ANSWER:
      // CRITICAL: Only CONVERSATIONAL intent can get direct answer
      if (decision.intent !== IntentType.CONVERSATIONAL) {
        logger.warn('ConversationHandler', 'BLOCKED: ANSWER decision for non-CONVERSATIONAL intent', {
          intent: decision.intent,
        });
        return await handleToolCallDecision(input, {
          ...decision,
          type: DecisionType.TOOL_CALL,
          tools: ['web.search'],
          reason: 'Forced TOOL_CALL for non-conversational intent',
        }, context);
      }
      return await handleAnswerDecision(input, decision, context);

    case DecisionType.REFUSE:
      return handleRefuseDecision(input, decision, context);

    default:
      // Unknown decision type - refuse to proceed
      return handleRefuseDecision(input, {
        ...decision,
        reason: 'Unknown decision type',
      }, context);
  }
}

/**
 * Handle TOOL_CALL decision - EXECUTE tools, don't describe them
 *
 * CRITICAL: This function RUNS tools and returns RESULTS.
 * It does NOT return "Spouštím vyhledávání..." text.
 */
async function handleToolCallDecision(input, decision, context) {
  logger.info('HandleToolCall', `Executing TOOL_CALL decision`, {
    tools: decision.tools,
    intent: decision.intent,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // EXECUTE TOOLS - this is the critical fix
  // ════════════════════════════════════════════════════════════════════════════

  const executionResult = await toolExecutor.execute(decision, {
    input,
    query: input,
    sessionId: context.sessionId,
    ...context,
  });

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

  // Handle execution failure
  if (executionResult.status === ExecutionStatus.FAILED) {
    logger.error('HandleToolCall', 'All tools failed', {
      error: executionResult.error,
      tools: decision.tools,
    });

    return new TaggedResponse({
      content: formatExecutionError(input, decision, executionResult),
      tag,
    });
  }

  // Handle partial success
  if (executionResult.status === ExecutionStatus.PARTIAL) {
    logger.warn('HandleToolCall', 'Partial execution success', {
      succeeded: executionResult.toolResults.filter(r => r.success).length,
      failed: executionResult.toolResults.filter(r => !r.success).length,
    });
  }

  // Return execution results
  return new TaggedResponse({
    content: executionResult.summary,
    tag,
  });
}

/**
 * Format error response when tool execution fails
 */
function formatExecutionError(input, decision, executionResult) {
  const toolDescriptions = {
    'web.search': 'vyhledávání na webu',
    'web.scrape': 'načtení obsahu stránky',
    'file.read': 'čtení souboru',
    'file.write': 'zápis do souboru',
    'code.execute': 'spuštění kódu',
    'database.query': 'dotaz do databáze',
  };

  const failedTools = executionResult.toolResults
    .filter(r => !r.success)
    .map(r => `- **${toolDescriptions[r.tool] || r.tool}**: ${r.error}`)
    .join('\n');

  return `⚠️ **Nepodařilo se zpracovat požadavek**\n\n` +
         `**Váš dotaz:** ${input}\n\n` +
         `**Selhaly tyto nástroje:**\n${failedTools}\n\n` +
         `Zkuste to prosím znovu nebo přeformulujte dotaz.`;
}

/**
 * Handle ASK_USER decision - need clarification
 */
function handleAskUserDecision(input, decision, context) {
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
 */
function formatClarificationRequest(input, decision) {
  if (decision.slots.includes('intent_clarification')) {
    return `🤔 Potřebuji upřesnit váš požadavek.\n\n` +
           `**Váš vstup:** "${input}"\n\n` +
           `Co přesně potřebujete?\n` +
           `- **Vyhledávání** - najít informace na webu\n` +
           `- **Report** - vytvořit analýzu nebo přehled\n` +
           `- **Kód** - napsat nebo upravit program\n` +
           `- **Chat** - obecná konverzace`;
  }

  if (decision.slots.includes('source')) {
    return `📎 Pro splnění požadavku potřebuji zdroj dat.\n\n` +
           `Prosím, uveďte:\n` +
           `- URL stránky, nebo\n` +
           `- Konkrétní téma pro vyhledávání`;
  }

  // CODE intent without project context
  if (decision.slots.includes('project_context') || decision.slots.includes('file_path')) {
    return `💻 Pro práci s kódem potřebuji znát kontext.\n\n` +
           `**Váš požadavek:** "${input}"\n\n` +
           `Prosím, upřesněte:\n` +
           `- **Projekt** - v jakém projektu chcete pracovat?\n` +
           `- **Soubor** - který soubor chcete upravit?\n` +
           `- nebo mi sdělte, že jde o obecnou otázku ohledně kódu`;
  }

  return `❓ Potřebuji více informací: ${decision.slots.join(', ')}\n\n` +
         `**Váš vstup:** "${input}"`;
}

/**
 * Handle ANSWER decision - only for pure CONVERSATIONAL intent
 */
async function handleAnswerDecision(input, decision, context) {
  const { sessionId } = context;

  try {
    // Lazy import CRE bridge to avoid circular dependencies
    const creBridge = await import('../llm/cre-bridge.js');

    // Build prompt with conversation history
    let prompt = input;
    if (context.history?.length > 0) {
      const historyContext = context.history
        .slice(-5)
        .map(h => `${h.response?.tag?.speaker || 'user'}: ${h.response?.content || ''}`)
        .join('\n');
      prompt = `Context:\n${historyContext}\n\nUser: ${input}`;
    }

    // System prompt for CONVERSATIONAL - strict rules
    const systemPrompt = `You are a helpful AI assistant in CONVERSATIONAL mode.

CRITICAL RULES:
- You are ONLY handling casual conversation (greetings, opinions, small talk)
- You CANNOT search the web - if asked about facts, say you need to search first
- You CANNOT access URLs - if given a URL, say you need to fetch it first
- NEVER say "nemám přístup", "nemohu vyhledávat", etc. - instead say what ACTION is needed
- If the user asks about anything requiring real data, redirect them to ask properly

ALLOWED:
- Greetings and farewells
- Opinions and preferences
- General knowledge from your training
- Explaining how to use the system

FORBIDDEN PHRASES (never use these):
${FORBIDDEN_PHRASES.slice(0, 10).map(p => `- "${p}"`).join('\n')}`;

    // Call LLM via CRE bridge (authorized)
    const result = await creBridge.generateChatResponse(prompt, systemPrompt, {
      sessionId: `conv-${sessionId}`,
      temperature: 0.7,
    });

    // CRITICAL: Validate response against forbidden phrases
    const validation = creDecisionEngine.validateResponse(result.content);
    if (!validation.valid) {
      logger.error('ConversationHandler', 'LLM generated FORBIDDEN response', {
        violations: validation.violations,
        content: result.content.substring(0, 200),
      });

      // Return error instead of forbidden content
      return createForbiddenResponseError(input, validation.violations);
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
// Project Handler (v44.0 - proper implementation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle project mode - code-focused work
 *
 * INVARIANT: If context.project exists, we NEVER ask "select project"
 * Instead, we route to CRE with CODE intent and hasActiveProject=true
 */
export async function projectHandler(input, context) {
  const { sessionId, project } = context;

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 1: Project IS selected - route through CRE with CODE context
  // ════════════════════════════════════════════════════════════════════════════

  if (project && project.id) {
    logger.info('ProjectHandler', `Project active: ${project.name}`, {
      projectId: project.id,
      scope: project.scope || 'project',
    });

    // Get CRE decision with project context
    const decision = creDecisionEngine.decide(input, {
      ...context,
      hasActiveProject: true,
      projectId: project.id,
      projectName: project.name,
      projectScope: project.scope || 'project',
    });

    assertDecision(decision);

    logger.info('ProjectHandler', `CRE Decision: ${decision.type}`, {
      intent: decision.intent,
      tools: decision.tools,
    });

    // Handle based on decision
    switch (decision.type) {
      case DecisionType.TOOL_CALL:
        return await handleToolCallDecision(input, decision, {
          ...context,
          hasActiveProject: true,
        });

      case DecisionType.ASK_USER:
        return handleAskUserDecision(input, decision, context);

      case DecisionType.ANSWER:
        // In project mode, even CONVERSATIONAL gets project context
        return await handleAnswerDecision(input, decision, context);

      default:
        return handleRefuseDecision(input, decision, context);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 2: No project selected - ASK_USER (no text description!)
  // ════════════════════════════════════════════════════════════════════════════

  logger.info('ProjectHandler', 'No project selected - asking user');

  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.PROJECT,
    confidence: 1.0,
    canExecute: false,
    metadata: {
      decision: { type: 'ASK_USER', reason: 'PROJECT_REQUIRED' },
      slots: ['project'],
      awaitingSelection: true,
    },
  });

  // This is ASK_USER behavior, not "chatty" text
  return new TaggedResponse({
    content: `💻 **Vyber projekt**\n\nPro práci s kódem potřebuji znát kontext projektu.\n\n` +
             `**Váš požadavek:** "${input.substring(0, 100)}${input.length > 100 ? '...' : ''}"\n\n` +
             `Vyberte projekt z nabídky nebo vytvořte nový.`,
    tag,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Expert Handler (v44.0 - proper implementation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle expert mode - domain expertise
 *
 * INVARIANT: If context.expert exists, we use that expert for ALL responses
 * Expert is LOCKED until user explicitly changes it.
 * No automatic arbitration when expert is selected.
 */
export async function expertHandler(input, context) {
  const { sessionId, expert } = context;

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 1: Expert IS selected - use expert for response
  // ════════════════════════════════════════════════════════════════════════════

  if (expert && expert.id) {
    logger.info('ExpertHandler', `Expert active: ${expert.name}`, {
      expertId: expert.id,
      domain: expert.domain || 'general',
    });

    try {
      // Lazy import CRE bridge for LLM calls
      const creBridge = await import('../llm/cre-bridge.js');

      // Build expert system prompt
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

      // Call LLM with expert persona
      const result = await creBridge.generateChatResponse(prompt, expertSystemPrompt, {
        sessionId: `expert-${sessionId}`,
        temperature: 0.5,
      });

      // Validate response
      const validation = creDecisionEngine.validateResponse(result.content);
      if (!validation.valid) {
        logger.warn('ExpertHandler', 'Expert generated forbidden phrase', {
          expert: expert.id,
          violations: validation.violations,
        });
      }

      const tag = new ResponseTag({
        speaker: ResponseSpeaker.EXPERT,
        mode: ChatMode.EXPERT,
        confidence: 0.9,
        canExecute: false,
        metadata: {
          expert: {
            id: expert.id,
            name: expert.name,
            domain: expert.domain,
          },
          model: result.model,
          duration: result.duration,
        },
      });

      return new TaggedResponse({
        content: result.content,
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
 * Build expert system prompt based on expert profile
 */
function buildExpertSystemPrompt(expert) {
  const basePrompt = `You are ${expert.name}, an expert in ${expert.domain || 'technology'}.

Your expertise includes: ${expert.description || expert.domain || 'general software development'}

IMPORTANT RULES:
- Respond as ${expert.name}, using your domain expertise
- Be specific and technical when appropriate
- If a question is outside your expertise, say so
- Never claim you cannot access information - if you need data, explain what would be helpful`;

  if (expert.systemPrompt) {
    return `${basePrompt}\n\n${expert.systemPrompt}`;
  }

  return basePrompt;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent Handler (v44.0 - proper implementation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle agent mode - autonomous execution
 *
 * INVARIANT: Agent mode ALWAYS requires explicit confirmation before starting
 * Uses AgentOutputContract for structured responses
 */
export async function agentHandler(input, context) {
  const { sessionId, agent, confirmed } = context;

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 1: Pending confirmation - ask user to confirm
  // ════════════════════════════════════════════════════════════════════════════

  if (!confirmed && context.pendingConfirmation) {
    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.CONVERSATION, // Stay in conversation until confirmed
      confidence: 1.0,
      canExecute: false,
      metadata: {
        pendingModeSwitch: context.pendingConfirmation,
        awaitingConfirmation: true,
      },
    });

    return new TaggedResponse({
      content: `🤖 **Potvrzení autonomního režimu**\n\n` +
               `Chystám se spustit autonomní úlohu:\n\n` +
               `**Úloha:** "${input}"\n\n` +
               `⚠️ Agent bude pracovat samostatně a může:\n` +
               `- Provádět vyhledávání\n` +
               `- Číst a zapisovat soubory\n` +
               `- Spouštět příkazy\n\n` +
               `Odpovězte **"ano"** pro spuštění nebo **"ne"** pro zrušení.`,
      tag,
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CASE 2: Agent execution (confirmed or explicit)
  // ════════════════════════════════════════════════════════════════════════════

  logger.info('AgentHandler', `Starting agent execution`, {
    sessionId,
    agentId: agent?.id,
    task: input.substring(0, 100),
  });

  // Build AgentOutputContract-compatible response
  const agentOutput = {
    status: 'STARTED',
    progress: 0,
    task: input,
    steps: [],
    next_action: 'PLANNING',
    artifacts: [],
  };

  const tag = new ResponseTag({
    speaker: ResponseSpeaker.AGENT,
    mode: ChatMode.AGENT,
    confidence: 0.9,
    canExecute: true,
    metadata: {
      agentOutput,
      agent: agent ? { id: agent.id, name: agent.name } : null,
    },
  });

  // Return initial response with execution started
  return new TaggedResponse({
    content: `🤖 **Agent spuštěn**\n\n` +
             `**Úloha:** ${input}\n\n` +
             `**Status:** Plánování...\n` +
             `**Progress:** 0%\n\n` +
             `Agent pracuje autonomně. Další aktualizace přijdou automaticky.`,
    tag,
    actions: [{
      type: 'AGENT_START',
      task: input,
      agentId: agent?.id || `agent_${Date.now()}`,
    }],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Default Handlers Map
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get default handlers for all modes
 */
export function getDefaultHandlers() {
  return {
    [ChatMode.CONVERSATION]: conversationHandler,
    [ChatMode.PROJECT]: projectHandler,
    [ChatMode.EXPERT]: expertHandler,
    [ChatMode.AGENT]: agentHandler,
  };
}

export default {
  conversationHandler,
  projectHandler,
  expertHandler,
  agentHandler,
  getDefaultHandlers,
};
