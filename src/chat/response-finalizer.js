// Final response scoring, quality telemetry, and assistant-turn persistence.
//
// Decision 024/C removed the post-answer model-backed rewrite. TaggedResponse
// remains immutable and its content is now the only value scored, persisted,
// and returned by this boundary.

import { logger } from '../core/logger.js';
import { throwIfAborted } from '../core/abort-error.js';
import { ChatPersistenceError } from '../core/chat-turn-error.js';

async function defaultScoreResponse(...args) {
  const { scoreResponse } = await import('./quality/response-scorer.js');
  return scoreResponse(...args);
}

function scoreSummary(score) {
  if (!score || !Number.isFinite(score.total)) return null;
  return {
    total: score.total,
    ...(score.dimensions ? { dimensions: score.dimensions } : {}),
    ...(Array.isArray(score.issues) ? { issues: score.issues } : {}),
  };
}

/**
 * Finalize an immutable handler response before the remaining post-persistence
 * housekeeping in ChatController.handle().
 *
 * The scorer remains injectable at this internal boundary for deterministic
 * tests. No dependency at this boundary can make a model call after Decision
 * 024/C.
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
  const scoreResponse = dependencies.scoreResponse || defaultScoreResponse;

  const tag = result.tag;
  const metadata = tag?.metadata || {};
  const intent = metadata.decision?.intent || 'CONVERSATIONAL';
  const synthesisScore = metadata.semanticScore?.total ?? null;
  const finalContent = result.content;
  let qualityScore = null;
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
  } catch (err) {
    log.warn('QualityTelemetry', `Score logging failed (non-fatal): ${err.message}`);
  }

  const beforeScore = scoreSummary(metadata.semanticScore)
    || qualityScore;
  const quality = {
    schemaVersion: 1,
    refinementDisposition: 'removed',
    refinementOwner: null,
    attempted: false,
    accepted: false,
    outcome: 'removed_by_decision_024',
    scoreBefore: beforeScore,
    scoreAfter: null,
    candidateScore: null,
    finalScore: qualityScore,
    scoreDelta: null,
    candidateDelta: null,
    latencyMs: 0,
    providerDurationMs: null,
    usage: {},
    similarity: null,
    errorCode: null,
  };

  log.info('QualityTelemetry', `Chat response score: ${qualityScore?.total ?? 'unavailable'}`, {
    conversationId,
    intent,
    score: qualityScore?.total ?? null,
    dimensions: qualityScore?.dimensions ?? null,
    refined: false,
    refinementOwner: quality.refinementOwner,
    refinementOutcome: quality.outcome,
    refinementLatencyMs: quality.latencyMs,
    refinementUsage: quality.usage,
    synthesisScore,
  });

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
    throw new ChatPersistenceError(err);
  }

  return {
    response: finalContent,
    mode: result.mode,
    confidence: result.confidence,
    canExecute: result.canExecute,
    metadata,
    qualityScore,
    quality,
    conversationId,
  };
}
