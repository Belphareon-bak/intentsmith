/**
 * C3 Backend — Integration Guide
 *
 * Ukazuje jak napojit ws-server.js na existující C3 backend.
 * Vyžaduje: úpravu conversation handleru aby přijímal event hooks.
 *
 * KROK 1: Přidat ws-server k Express serveru
 * KROK 2: Upravit conversationHandler.handle() aby emitoval eventy
 * KROK 3: Testovat s IDE
 */

// ═══════════════════════════════════════════════════════════
// KROK 1: Přidání WS serveru k existujícímu Express serveru
// ═══════════════════════════════════════════════════════════

// Ve vašem hlavním souboru (např. server.js nebo app.js):

const http = require('http');
const express = require('express');
const { createC3WebSocketServer } = require('./ws-server.cjs');

const app = express();
const server = http.createServer(app);

// Existující Express routes...
// app.post('/api/chat', ...);

// Přidat WebSocket server
const wss = createC3WebSocketServer(server, conversationHandler, logger);

server.listen(3001, () => {
  console.log('C3 Backend running on :3001');
  console.log('WebSocket endpoint: ws://localhost:3001/c3/ws');
});


// ═══════════════════════════════════════════════════════════
// KROK 2: Úprava conversation handleru
// ═══════════════════════════════════════════════════════════

// Váš stávající conversationHandler.handle() pravděpodobně vypadá takto:
//
//   async handle(input, sessionId) {
//     const decision = cre.classify(input);
//     const response = await llm.generate(prompt);
//     const gated = outputGate.check(response);
//     return gated;
//   }
//
// Musíte přidat podporu pro event hooks:

class ConversationHandlerWithHooks {
  /**
   * @param {string} input — uživatelský vstup
   * @param {object} options
   * @param {string} options.turnId — ID turnu (z ws-server)
   * @param {AbortSignal} options.signal — pro cancel support
   * @param {function} options.onCREDecision — CRE event hook
   * @param {function} options.onToolCall — tool call event hook
   * @param {function} options.onToolResult — tool result event hook
   * @param {function} options.onLLMStart — LLM start event hook
   * @param {function} options.onLLMToken — streaming token event hook
   * @param {function} options.onLLMDone — LLM complete event hook
   * @param {function} options.onGateVerdict — output gate event hook
   */
  async handle(input, options = {}) {
    const {
      signal,
      onCREDecision = () => {},
      onToolCall = () => {},
      onToolResult = () => {},
      onLLMStart = () => {},
      onLLMToken = () => {},
      onLLMDone = () => {},
      onGateVerdict = () => {},
    } = options;

    // 1. CRE Classification
    const decision = this.cre.classify(input);
    onCREDecision(decision);

    // Check cancel
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    // 2. Tool calls (if needed)
    if (decision.tools && decision.tools.length > 0) {
      for (const tool of decision.tools) {
        onToolCall(tool.name, tool.args);

        const startTime = Date.now();
        const result = await this.executeTool(tool, signal);
        const durationMs = Date.now() - startTime;

        onToolResult(tool.name, {
          success: result.success,
          durationMs,
          summary: result.summary,
        });
      }
    }

    // 3. LLM Generation
    const prompt = this.buildPrompt(input, decision);
    const tokensIn = this.estimateTokens(prompt);

    onLLMStart(this.modelName, tokensIn);

    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const llmStartTime = Date.now();
    let fullResponse = '';

    // Streaming mode
    for await (const token of this.llm.stream(prompt, { signal })) {
      fullResponse += token;
      onLLMToken(token);
    }

    const llmDurationMs = Date.now() - llmStartTime;
    const tokensOut = this.estimateTokens(fullResponse);
    onLLMDone(tokensOut, llmDurationMs);

    // 4. Output Gate
    const gateResult = this.outputGate.check(fullResponse, decision.intent);
    onGateVerdict({
      d61: gateResult.d61 ? 'ok' : 'fail',
      d62: gateResult.d62 ? 'ok' : 'fail',
      d63: gateResult.d63 ? 'ok' : 'fail',
      d64: gateResult.d64 === 'suspicious' ? 'suspicious' : gateResult.d64 ? 'ok' : 'fail',
      retryCount: gateResult.retryCount,
    });

    // Handle gate failures (retry)
    if (!gateResult.passed) {
      // Retry logic... (omitted for brevity, same as existing)
    }

    return {
      content: fullResponse,
      intent: decision.intent,
      confidence: decision.confidence,
    };
  }
}


// ═══════════════════════════════════════════════════════════
// KROK 3: Minimální adaptér (pokud nechcete měnit handler)
// ═══════════════════════════════════════════════════════════

// Pokud nechcete měnit existující handler, wrapper:

function wrapConversationHandler(existingHandler) {
  return {
    async handle(input, options = {}) {
      const { onCREDecision, onLLMStart, onLLMDone, onGateVerdict } = options;

      // Emitovat start
      if (onLLMStart) onLLMStart('qwen2.5', 0);

      // Zavolat existující handler
      const result = await existingHandler.handle(input);

      // Emitovat done
      if (onCREDecision) onCREDecision({
        intent: result.intent || 'CONVERSATIONAL',
        confidence: result.confidence || 0.5,
      });
      if (onLLMDone) onLLMDone(0, 0);
      if (onGateVerdict) onGateVerdict({ d61: 'ok', d62: 'ok', d63: 'ok' });

      return result;
    }
  };
}

module.exports = {
  ConversationHandlerWithHooks,
  wrapConversationHandler,
};
