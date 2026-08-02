// Final response selection, quality telemetry, and assistant-turn persistence.
//
// TaggedResponse is intentionally immutable. Any accepted self-refinement is
// therefore carried in a local finalContent value rather than written back to
// the handler result.

import { logger } from '../core/logger.js';
import { throwIfAborted } from '../core/abort-error.js';

// Intents whose answer no model wrote: a clock reading, a shell command's
// output, a file's contents, a write confirmation. Asking a model to improve
// them is a category error — they are values, not prose, and `improveResponse`
// is documented as taking "the final response from synthesis".
//
// Measured before this guard existed: "kolik je hodin?" spent 25 466 ms in the
// refinement loop and then threw the result away on semantic drift
// (similarity 0.05), while "kolik je 17 * 23?" answered in 65 ms purely because
// its answer was 17 characters and fell under the length threshold.
//
// FILE_EXPLAIN is deliberately NOT here: its answer *is* model synthesis, so
// refinement can genuinely improve it and stays enabled.
const NON_SYNTHESIZED_INTENTS = new Set([
  'LOCAL',
  'SHELL',
  'FILE_READ',
  'FILE_WRITE',
]);

async function defaultImproveResponse(...args) {
  const { improveResponse } = await import('./quality/improvement-loops.js');
  return improveResponse(...args);
}

async function defaultScoreResponse(...args) {
  const { scoreResponse } = await import('./quality/response-scorer.js');
  return scoreResponse(...args);
}

async function defaultGenerateChatResponse(...args) {
  const { generateChatResponse } = await import('../llm/cre-bridge.js');
  return generateChatResponse(...args);
}

/**
 * Finalize an immutable handler response before the remaining post-persistence
 * housekeeping in ChatController.handle().
 *
 * Dependencies are injectable only at this internal boundary so deterministic
 * tests can exercise accepted and rejected refinement without a real model.
 *
 * @param {Object} options
 * @param {Object} options.result - Immutable TaggedResponse-compatible value
 * @param {string} options.message - Original user message
 * @param {string} options.sessionId - Chat session identifier
 * @param {string} options.conversationId - Persisted conversation identifier
 * @param {AbortSignal|null} [options.signal]
 * @param {Function} options.persistAssistantTurn - Persists final content
 * @param {Object} [options.dependencies] - Deterministic test seams
 * @param {Object} [options.log] - Logger-compatible sink
 * @returns {Promise<Object>} Base response returned by ChatController.handle()
 */
export async function finalizeChatResponse({
  result,
  message,
  sessionId,
  conversationId,
  signal = null,
  persistAssistantTurn,
  dependencies = {},
  log = logger,
}) {
  const improveResponse = dependencies.improveResponse || defaultImproveResponse;
  const scoreResponse = dependencies.scoreResponse || defaultScoreResponse;
  const generateChatResponse = dependencies.generateChatResponse || defaultGenerateChatResponse;

  const tag = result.tag;
  const metadata = tag?.metadata || {};
  const intent = metadata.decision?.intent || 'CONVERSATIONAL';
  const synthesisScore = metadata.semanticScore?.total ?? null;
  let finalContent = result.content;
  let refinementApplied = false;
  let qualityScore = null;

  const isSynthesized = !NON_SYNTHESIZED_INTENTS.has(intent);
  const needsRefinement = Boolean(
    finalContent
      && finalContent.length > 20
      && isSynthesized
      && (synthesisScore === null || synthesisScore < 75),
  );

  if (needsRefinement) {
    try {
      const improvement = await improveResponse(
        finalContent,
        { query: message, intent, lang: 'cs' },
        async (prompt, systemPrompt, opts) => generateChatResponse(
          prompt,
          systemPrompt || '',
          {
            sessionId: opts?.sessionId || `refine-${sessionId}`,
            temperature: opts?.temperature ?? 0.3,
            signal: signal || null,
          },
        ),
        { signal, sessionId, mode: 'balanced' },
      );

      if (improvement.improved) {
        finalContent = improvement.response;
        refinementApplied = true;
        log.info('ChatController', 'Self-refinement applied', {
          originalScore: improvement.telemetry.originalScore,
          finalScore: improvement.telemetry.finalScore,
          delta: improvement.telemetry.finalScore - improvement.telemetry.originalScore,
        });
      }
    } catch (err) {
      log.warn('ChatController', `Self-refinement failed (non-fatal): ${err.message}`);
    }
  } else if (!isSynthesized) {
    log.debug('ChatController', `Skipping selfRefine: ${intent} answer is not model-authored`);
  } else if (synthesisScore !== null) {
    log.debug('ChatController', `Skipping selfRefine: synthesis score ${synthesisScore} >= 75`);
  }
  throwIfAborted(signal);

  try {
    const finalScore = await scoreResponse(finalContent || '', {
      query: message,
      intent,
      lang: 'cs',
    });
    qualityScore = {
      total: finalScore.total,
      dimensions: finalScore.dimensions,
      issues: finalScore.issues,
    };
    log.info('QualityTelemetry', `Chat response score: ${finalScore.total}`, {
      conversationId,
      intent,
      score: finalScore.total,
      dimensions: finalScore.dimensions,
      refined: refinementApplied,
      synthesisScore,
    });
  } catch (err) {
    log.warn('QualityTelemetry', `Score logging failed (non-fatal): ${err.message}`);
  }

  // No await occurs between this check and persistAssistantTurn(), so an
  // aborted turn cannot cross the persistence boundary on the same event-loop
  // tick.
  throwIfAborted(signal);

  try {
    persistAssistantTurn(finalContent, {
      mode: result.mode,
      confidence: result.confidence,
      model: metadata.model,
      intent: metadata.decision?.intent,
    });
  } catch (err) {
    log.error('ChatController', `Failed to persist assistant turn: ${err.message}`);
  }

  return {
    response: finalContent,
    mode: result.mode,
    confidence: result.confidence,
    canExecute: result.canExecute,
    metadata,
    qualityScore,
    conversationId,
  };
}
