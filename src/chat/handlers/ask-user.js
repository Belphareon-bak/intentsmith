// ASK_USER Decision Handler — extracted from decisions.js (v93.1)
//
// Handles clarification requests: saves pending decision state,
// formats intent-specific clarification templates.

import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from '../controller.js';
import { logger } from '../../core/logger.js';
import { pendingConversationQuestion } from '../conversation-context.js';
import { explicitSaveTargetChoice } from '../file-save-plan.js';

/**
 * Handle ASK_USER decision - need clarification
 *
 * v44.2 - Now saves pending decision to session state for resumption
 * v44.6 FIX 2 - Tracks attempts to enforce max 1× clarification
 */
export function handleAskUserDecision(input, decision, context) {
  const { sessionState } = context;
  const content = formatClarificationRequest(input, decision);
  const originalRequest = decision.metadata?.continuesPending === false ? input
    : sessionState?.pendingDecision?.metadata?.originalRequest || input;
  const originalRequestedOperation = decision.metadata?.continuesPending === false
    ? decision.metadata?.requestedOperation
    : sessionState?.pendingDecision?.metadata?.originalRequestedOperation
      || sessionState?.pendingDecision?.metadata?.requestedOperation || decision.metadata?.requestedOperation;

  // A repeated question must retain the core's already bound save source and
  // original user turn. New tasks and other projects must not inherit it.
  const pendingSave = sessionState?.awaitingClarification
    && decision.metadata?.continuesPending === true
    ? sessionState.pendingDecision?.metadata?.fileSaveClarification : null;
  const inheritedSave = pendingSave?.projectId === Number(context.project?.id ?? context.projectId)
    ? { ...pendingSave } : null;
  // A classifier question still records an unresolved target pair. This is
  // negative continuity only: the file resolver rechecks source and exact target
  // before it can propose any effect, and approval remains a separate boundary.
  if (inheritedSave?.targetRequired === true
    && Number.isSafeInteger(inheritedSave.projectId) && inheritedSave.projectId > 0
    && Number.isSafeInteger(inheritedSave.sourceMessageId) && inheritedSave.sourceMessageId > 0
    && ['write', 'create'].includes(pendingConversationQuestion(context)?.requestedOperation)) {
    const choices = explicitSaveTargetChoice(input);
    if (choices) inheritedSave.targetChoices = choices;
  }
  const pendingMetadata = { ...decision.metadata, contextualInterpretation: true,
    originalRequest, clarificationQuestion: content,
    ...(originalRequestedOperation ? { originalRequestedOperation } : {}) };
  // Save provenance comes only from the existing canonical pending state.
  delete pendingMetadata.fileSaveClarification;
  if (inheritedSave) pendingMetadata.fileSaveClarification = inheritedSave;

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
      metadata: pendingMetadata,
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
      clarificationQuestion: content,
      originalRequest,
    },
  });

  return new TaggedResponse({
    content,
    tag,
  });
}

/**
 * Format clarification request
 * v44.2 - Intent-specific templates instead of generic options
 */
export function formatClarificationRequest(input, decision) {
  if (typeof decision.metadata?.clarificationQuestion === 'string'
    && decision.metadata.clarificationQuestion.trim()) return decision.metadata.clarificationQuestion;
  const shortInput = input.length > 60 ? input.substring(0, 60) + '...' : input;

  if (decision.slots.includes('intent_clarification')) {
    // A missing semantic detail cannot be filled by choosing an internal
    // routing category. Prefer the model's concrete question above; keep the
    // fallback about the user's intended result.
    return `Čeho konkrétně chceš dosáhnout v zadání „${shortInput}“?`;
  }

  if (decision.slots.includes('source')) {
    return `📎 **Pro tento požadavek potřebuji zdroj:**\n\n` +
           `Zadejte URL nebo téma pro vyhledávání.`;
  }

  // CODE intent without project context
  if (decision.slots.includes('file_path') && /oprav|uprav|edit|fix|zm[eě]n/i.test(input)) {
    return 'Který konkrétní soubor chceš upravit a jakou změnu v něm potřebuješ?';
  }
  if (decision.slots.includes('project_context') || decision.slots.includes('file_path')) {
    return `💻 **"${shortInput}"**\n\n` +
           `V jakém projektu chcete pracovat?\n` +
           `(Vyberte projekt z nabídky nebo napište "obecná otázka")`;
  }

  return `❓ Potřebuji upřesnit: ${decision.slots[0] || 'kontext'}\n\n` +
         `**"${shortInput}"**`;
}
