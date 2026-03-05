// ASK_USER Decision Handler — extracted from decisions.js (v93.1)
//
// Handles clarification requests: saves pending decision state,
// formats intent-specific clarification templates.

import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from '../controller.js';
import { logger } from '../../core/logger.js';

/**
 * Handle ASK_USER decision - need clarification
 *
 * v44.2 - Now saves pending decision to session state for resumption
 * v44.6 FIX 2 - Tracks attempts to enforce max 1× clarification
 */
export function handleAskUserDecision(input, decision, context) {
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
export function formatClarificationRequest(input, decision) {
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
