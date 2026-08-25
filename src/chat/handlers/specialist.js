// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent — Specialist Handler v91 (D5)
// ══════════════════════════════════════════════════════════════════════════════
//
// Pipeline: Tool dispatch → Expertise discovery → Gap detection → Fallback
//
// When a specialist is active, this handler:
//  1. Checks specialist tools first (deterministic > LLM)
//  2. Discovers relevant expertise(s) from the specialist's collection
//  3. If no expertise matches, offers to create one or falls back
//  4. Always works — expertise enhances quality but isn't required
//
// ══════════════════════════════════════════════════════════════════════════════

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
  handleAnswerDecision,
  handleRefuseDecision,
} from './decisions.js';
import { randomUUID } from 'crypto';
import {
  generateExpertiseResponse,
  wrapWithExpertisePersona,
  handleMergedExpertises,
} from './expertise.js';
import { discoverExpertises, extractGapTopic } from '../../expertises/expertise-discovery.js';

// Gap choice detection patterns
const GAP_CREATE_PATTERNS = [
  /vytvo[rř]/i, /ano/i, /^1[.)\s]?$/i, /^1$/,
  /create/i, /yes/i, /jo\b/i, /jasn/i, /urcit/i,
];
const GAP_FALLBACK_PATTERNS = [
  /bez\s+n[ií]/i, /^2[.)\s]?$/i, /^2$/,
  /ne\b/i, /without/i, /rovnou/i, /bez\s+expert/i,
];

/**
 * Load specialist's expertise collection from DB.
 * Returns ExpertiseAgent objects enriched with label + priority from binding.
 *
 * @param {string} specialistId
 * @returns {Promise<Array>}
 */
async function loadSpecialistExpertises(specialistId) {
  try {
    const db = (await import('../../db/database.js')).default;
    const rows = db.db.prepare(
      'SELECT expertise_id, label, priority FROM specialist_expertises WHERE specialist_id = ? ORDER BY priority DESC'
    ).all(specialistId);

    if (rows.length === 0) return [];

    // Load expertise objects (built-in + custom)
    const { BUILTIN_EXPERTISES, expertiseRegistry } = await import('../../expertises/expertise-layer.js');

    const result = [];
    for (const row of rows) {
      // Try built-in first, then custom
      let exp = BUILTIN_EXPERTISES[row.expertise_id];
      if (!exp) {
        const custom = expertiseRegistry.getCustom().find(e => e.id === row.expertise_id);
        exp = custom ? (custom.toJSON ? custom.toJSON() : custom) : null;
      }
      if (exp) {
        // Enrich with binding metadata
        result.push({
          ...exp,
          label: row.label,
          priority: row.priority,
        });
      }
    }
    return result;
  } catch (err) {
    logger.warn('SpecialistHandler', `Failed to load expertises for ${specialistId}: ${err.message}`);
    return [];
  }
}

/**
 * Main specialist handler — D5 pipeline.
 *
 * @param {string} input — User message
 * @param {Object} context — Full context (specialist, sessionState, etc.)
 * @returns {Promise<TaggedResponse>}
 */
export async function specialistHandler(input, context) {
  const { specialist, sessionState } = context;
  const executionTraceId = randomUUID();
  context.executionTraceId = executionTraceId;

  logger.info('SpecialistHandler', `Specialist active: ${specialist.name}`, {
    specialistId: specialist.id,
    domain: specialist.domain,
    expertiseCount: specialist.expertiseCollection?.length || 0,
  });

  // ════════════════════════════════════════════════════════════════════════════
  // INTERCEPT: Gap choice continuation
  // ════════════════════════════════════════════════════════════════════════════
  // If previous turn offered gap choice, handle user's response
  if (sessionState?.get?.('_awaitingGapChoice')) {
    return await handleGapChoice(input, specialist, context);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 1: Specialist tool dispatch (deterministic > LLM)
  // ════════════════════════════════════════════════════════════════════════════

  const { specialistRuntime } = await import('../../expertises/specialist-runtime.js');

  // A persisted session selection is not runtime authority. Disable/remove
  // unregisters the package first; a stale chat session must then fail closed
  // without executing package code or falling through to a model persona.
  if (!specialistRuntime.isSpecialist(specialist.primaryExpertiseId)) {
    context.sessionState?.clearSpecialist?.();
    return specialistUnavailableResponse(specialist);
  }

  if (specialistRuntime.isSpecialist(specialist.primaryExpertiseId)) {
    if (typeof context.onSystemStep === 'function') {
      try { context.onSystemStep('specialist_dispatch', specialist.id, 1); } catch (_) {}
    }
    try {
      const toolResult = await specialistRuntime.tryToolExecution(
        specialist.primaryExpertiseId, input, {
          sessionId: context.sessionId,
          conversationId: context.conversationId || context.sessionId,
          userMessageId: context.userMessageId,
          project: context.project,
          signal: context.signal || null,
        }
      );

      if (toolResult) {
        if (toolResult.status === 'error') {
          return specialistToolFailureResponse(toolResult, specialist);
        }
        if (toolResult.status === 'clarify') {
          // Tool matched but needs more params — inject context for LLM
          context.toolClarification = {
            tool: toolResult.toolType,
            missingParams: toolResult.missingParams,
            extractedParams: toolResult.params,
          };
          // Fall through to expertise/fallback — LLM will ask for params
        } else {
          // Tool executed successfully — wrap with persona and return
          logger.info('SpecialistHandler', 'Tool dispatch: SUCCESS', {
            toolType: toolResult.toolType,
            specialist: specialist.id,
          });

          // Find the primary expertise for persona wrapping
          const primaryExpertise = specialist.expertiseCollection?.find(
            e => e.id === specialist.primaryExpertiseId
          ) || { id: specialist.id, name: specialist.name, domain: specialist.domain };

          if (typeof toolResult.presentation === 'string') {
            return deterministicSpecialistToolResponse(toolResult, specialist, primaryExpertise);
          }
          return await wrapWithSpecialistPersona(input, toolResult, primaryExpertise, context);
        }
      }
    } catch (err) {
      logger.warn('SpecialistHandler', `Tool dispatch failed, continuing: ${err.message}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 2: Expertise discovery (D5)
  // ════════════════════════════════════════════════════════════════════════════

  const collection = specialist.expertiseCollection || [];

  if (collection.length > 0) {
    if (typeof context.onSystemStep === 'function') {
      try { context.onSystemStep('expertise_discovery', specialist.id, 2); } catch (_) {}
    }

    const discovery = discoverExpertises(input, collection);

    if (discovery.matched.length === 1) {
      // Single expertise match — use it for enhanced response
      const expertise = discovery.matched[0];
      logger.info('SpecialistHandler', `Expertise discovery: ${expertise.id}`, {
        score: discovery.scores[expertise.id],
        reason: discovery.reason,
      });

      context.expertise = expertise;
      context.hasActiveExpertise = true;
      return await generateExpertiseResponse(input, expertise, context);
    }

    if (discovery.matched.length > 1) {
      // Multi-match — merge for complex queries
      logger.info('SpecialistHandler', `Multi-expertise discovery: ${discovery.matched.map(e => e.id).join(', ')}`, {
        reason: discovery.reason,
      });

      context.activeExpertises = discovery.matched;
      return await handleMergedExpertises(input, context, executionTraceId);
    }

    // ════════════════════════════════════════════════════════════════════════
    // PHASE 3: Gap detection — no expertise matched
    // ════════════════════════════════════════════════════════════════════════

    if (discovery.gap) {
      logger.info('SpecialistHandler', 'Expertise gap detected', {
        scores: discovery.scores,
        reason: discovery.reason,
      });

      return await handleExpertiseGap(input, specialist, context);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PHASE 4: Fallback — no expertises in collection, or skip gap
  // ════════════════════════════════════════════════════════════════════════════

  return await handleSpecialistFallback(input, specialist, context);
}

function specialistUnavailableResponse(specialist) {
  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.SPECIALIST,
    confidence: 1,
    canExecute: false,
    metadata: {
      specialistId: specialist.id,
      specialistAvailable: false,
      errorCode: 'M3_SPECIALIST_UNAVAILABLE',
    },
  });
  return new TaggedResponse({
    content: `Specialista **${specialist.name}** není aktivní. Nebyl spuštěn žádný jeho nástroj ani modelový fallback.`,
    tag,
  });
}

function specialistToolFailureResponse(toolResult, specialist) {
  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.SPECIALIST,
    confidence: 1,
    canExecute: false,
    metadata: {
      specialistId: specialist.id,
      specialistTool: toolResult.toolType,
      executionStatus: 'FAILED',
      errorCode: toolResult.errorCode,
      fallbackSuppressed: true,
    },
  });
  return new TaggedResponse({
    content: `Code review nebylo spuštěno: ${toolResult.error}`,
    tag,
  });
}

function deterministicSpecialistToolResponse(toolResult, specialist, expertise) {
  const tag = new ResponseTag({
    speaker: ResponseSpeaker.EXPERTISE,
    mode: ChatMode.SPECIALIST,
    confidence: 0.95,
    canExecute: false,
    metadata: {
      executionStatus: 'SUCCESS',
      specialist: {
        id: specialist.id,
        name: specialist.name,
        version: specialist.version || null,
      },
      expertise: {
        id: expertise.id,
        applied: true,
        evidence: toolResult.expertiseEvidence,
      },
      specialistTool: toolResult.toolType,
      toolResults: [{ type: toolResult.toolType, data: toolResult.result }],
      projectContext: toolResult.evidence,
      deterministicPresentation: true,
    },
  });
  return new TaggedResponse({ content: toolResult.presentation, tag });
}

/**
 * Handle expertise gap — offer to create expertise or fallback.
 */
async function handleExpertiseGap(input, specialist, context) {
  const gapTopic = extractGapTopic(input);

  // Store gap state for continuation
  if (context.sessionState?.set) {
    context.sessionState.set('_awaitingGapChoice', true);
    context.sessionState.set('_gapTopic', gapTopic);
    context.sessionState.set('_gapInput', input);
    context.sessionState.set('_gapSpecialistId', specialist.id);
  }

  const tag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.SPECIALIST,
    confidence: 0.9,
    canExecute: false,
    metadata: {
      awaitingGapChoice: true,
      gapTopic,
      specialistId: specialist.id,
    },
  });

  return new TaggedResponse({
    content: `Nemám specializovanou expertízu na téma **${gapTopic}**.\n\n` +
             `Můžu:\n` +
             `1. **Vytvořit expertízu** — bude se hodit i příště\n` +
             `2. **Odpovědět bez ní** — rovnou, ale bez specializovaných znalostí\n\n` +
             `Co preferuješ?`,
    tag,
  });
}

/**
 * Handle user's response to gap choice.
 */
async function handleGapChoice(input, specialist, context) {
  const { sessionState } = context;

  // Clear gap state
  const gapTopic = sessionState.get('_gapTopic');
  const originalInput = sessionState.get('_gapInput');
  sessionState.set('_awaitingGapChoice', false);
  sessionState.set('_gapTopic', null);
  sessionState.set('_gapInput', null);
  sessionState.set('_gapSpecialistId', null);

  // Check which choice user made
  const isCreate = GAP_CREATE_PATTERNS.some(p => p.test(input.trim()));
  const isFallback = GAP_FALLBACK_PATTERNS.some(p => p.test(input.trim()));

  if (isCreate && !isFallback) {
    // Trigger create-expertise skill
    logger.info('SpecialistHandler', `Gap → create expertise: ${gapTopic}`);

    // Store specialist ID so auto-bind can happen after skill completes
    if (sessionState.set) {
      sessionState.set('_pendingExpertiseBind', specialist.id);
    }

    // Return a response that signals skill trigger
    // The conversation handler's skill detection will pick up the next message
    const tag = new ResponseTag({
      speaker: ResponseSpeaker.SYSTEM,
      mode: ChatMode.SPECIALIST,
      confidence: 0.9,
      canExecute: false,
      metadata: {
        triggerSkill: 'create-expertise',
        skillParams: { topic: gapTopic },
        specialistId: specialist.id,
      },
    });

    return new TaggedResponse({
      content: `Dobře, vytvořím expertízu na téma **${gapTopic}**. ` +
               `Odpovím na pár otázek, abych ji nastavil správně.`,
      tag,
    });
  }

  // Fallback — answer without expertise using original input
  logger.info('SpecialistHandler', `Gap → fallback for: ${gapTopic}`);

  return await handleSpecialistFallback(originalInput || input, specialist, context);
}

/**
 * Fallback: CRE-routed response with specialist persona (no expertise).
 * Specialist still adds domain context (system prompt mentions their field).
 */
async function handleSpecialistFallback(input, specialist, context) {
  const decision = await creDecisionEngine.decide(input, context);
  assertDecision(decision);

  logger.info('SpecialistHandler', `Fallback CRE: ${decision.type} (${decision.intent})`, {
    specialist: specialist.id,
  });

  switch (decision.type) {
    case DecisionType.TOOL_CALL:
      return handleToolCallDecision(input, decision, context);

    case DecisionType.ASK_USER:
      return handleAskUserDecision(input, decision, context);

    case DecisionType.ANSWER:
    case DecisionType.PLAN:
      // Generate response with lightweight specialist persona
      return await generateSpecialistAnswer(input, specialist, context);

    default:
      return handleRefuseDecision(input, decision, context);
  }
}

/**
 * Generate an answer with specialist persona but without specific expertise.
 * Lighter than generateExpertiseResponse — no enforcement, no capability drift.
 */
async function generateSpecialistAnswer(input, specialist, context) {
  try {
    const creBridge = await import('../../llm/cre-bridge.js');

    const systemPrompt = `Jsi ${specialist.name}, specialista na ${specialist.domain || 'obecné poradenství'}.
${specialist.description || ''}

Odpovídej v rámci své odbornosti. Pokud nemáš specifické znalosti na dané téma, řekni to a navrhni alternativy.
Odpovídej v češtině.`;

    let prompt = input;
    if (context.history?.length > 0) {
      const historyContext = context.history
        .slice(-5)
        .map(h => `${h.response?.tag?.speaker || 'user'}: ${h.response?.content?.substring(0, 200) || ''}`)
        .join('\n');
      prompt = `Previous context:\n${historyContext}\n\nUser question: ${input}`;
    }

    if (context.toolClarification) {
      const tc = context.toolClarification;
      const missingList = tc.missingParams.map(p => `- ${p}`).join('\n');
      prompt += `\n\n[SYSTEM: Nástroj ${tc.tool} rozpoznal dotaz, ale chybí parametry:\n${missingList}\nZeptej se uživatele na chybějící parametry.]`;
    }

    const result = await creBridge.generateChatResponse(prompt, systemPrompt, {
      sessionId: `specialist-${context.sessionId}`,
      temperature: 0.4,
    });

    const tag = new ResponseTag({
      speaker: ResponseSpeaker.EXPERTISE, // Uses expertise speaker for consistent UI rendering
      mode: ChatMode.SPECIALIST,
      confidence: 0.75,
      canExecute: false,
      metadata: {
        specialist: { id: specialist.id, name: specialist.name, domain: specialist.domain },
        expertiseSource: 'fallback',
        model: result.model,
      },
    });

    return new TaggedResponse({
      content: result.content,
      tag,
    });
  } catch (err) {
    logger.error('SpecialistHandler', `Specialist answer failed: ${err.message}`);
    return handleRefuseDecision(input, { type: 'REFUSE', intent: 'ERROR' }, context);
  }
}

/**
 * Wrap specialist tool result with persona (reuses expertise wrapping).
 */
async function wrapWithSpecialistPersona(input, toolResult, expertise, context) {
  const { toolType, result, params, evidence, expertiseEvidence } = toolResult;

  const toolContent = JSON.stringify(result, null, 2);

  const rawTag = new ResponseTag({
    speaker: ResponseSpeaker.SYSTEM,
    mode: ChatMode.SPECIALIST,
    confidence: 0.95,
    canExecute: false,
    metadata: {
      executionStatus: 'SUCCESS',
      toolResults: [{ type: toolType, data: result }],
      specialistTool: toolType,
      extractedParams: params,
      projectContext: evidence || null,
      expertiseEvidence: expertiseEvidence || null,
    },
  });

  const rawResponse = new TaggedResponse({ content: toolContent, tag: rawTag });

  return await wrapWithExpertisePersona(input, rawResponse, expertise, context);
}

// Export for handler index + testing
export { loadSpecialistExpertises };
