// Agent Handler — extracted from handlers.js
// Handles AGENT mode - autonomous execution

import { ResponseTag, TaggedResponse, ResponseSpeaker, ChatMode } from '../controller.js';
import { logger } from '../../core/logger.js';

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


