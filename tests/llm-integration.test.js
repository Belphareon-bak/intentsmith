// C3-Agent v57.3 — LLM Integration Tests (Multi-Step)
// ══════════════════════════════════════════════════════════════════════════════
//
// End-to-end tests that actually call Ollama and verify real LLM responses.
// Requires: Ollama running at localhost:11434 with qwen3.5:27b loaded.
//
// Sections:
//   1. Ollama Connectivity — verify model is reachable
//   2. CRE Bridge — direct LLM calls via auth gateway
//   3. Conversation Handler — CRE classify → decide → LLM → response
//   4. Multi-Turn — same session, context retention across turns
//   5. Full Pipeline — ChatController.handle() end-to-end
//   6. LOCAL + LLM Mix — deterministic first, then LLM follow-up
//
// Run:  node tests/llm-integration.test.js
//
// ══════════════════════════════════════════════════════════════════════════════

import { suite, testAsync, assert, assertEqual, assertIncludes, summary } from './harness.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const CHAT_MODEL = 'qwen3.5:27b';
const TIMEOUT = 90_000; // 90s per LLM call (32b model can be slow)

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

async function ollamaChat(messages, options = {}) {
  const body = {
    model: options.model || CHAT_MODEL,
    messages,
    stream: false,
    options: {
      temperature: options.temperature ?? 0.3,
      num_predict: options.maxTokens ?? 512,
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeout || TIMEOUT);

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return {
      content: data.message?.content || '',
      model: data.model,
      duration: data.total_duration ? Math.round(data.total_duration / 1e6) : 0,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

function printLLMResponse(label, result) {
  const truncated = result.content.length > 400
    ? result.content.substring(0, 400) + '...'
    : result.content;
  console.log(`     \x1b[36m[LLM ${result.model} ${result.duration}ms]\x1b[0m`);
  console.log(`     \x1b[33m${truncated}\x1b[0m`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Section 1: Ollama Connectivity
// ═══════════════════════════════════════════════════════════════════════════════

let ollamaAvailable = false;

suite('1. Ollama Connectivity');

await testAsync('1.1 Ollama API is reachable', async () => {
  const res = await fetch(`${OLLAMA_URL}/api/tags`);
  assert(res.ok, `Ollama API returned ${res.status}`);
  const data = await res.json();
  assert(Array.isArray(data.models), 'Expected models array');
  console.log(`     Models available: ${data.models.map(m => m.name).join(', ')}`);
  ollamaAvailable = true;
});

await testAsync('1.2 Chat model is loaded', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');
  const res = await fetch(`${OLLAMA_URL}/api/tags`);
  const data = await res.json();
  const hasModel = data.models.some(m => m.name === CHAT_MODEL);
  assert(hasModel, `Model ${CHAT_MODEL} not found in Ollama`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 2: Direct LLM Calls
// ═══════════════════════════════════════════════════════════════════════════════

suite('2. Direct LLM Calls');

await testAsync('2.1 Simple Czech greeting → Czech response', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const result = await ollamaChat([
    { role: 'system', content: 'Jsi český AI asistent. Odpovídej výhradně česky, stručně.' },
    { role: 'user', content: 'Ahoj, jak se máš?' },
  ]);

  assert(result.content.length > 5, 'Response too short');
  printLLMResponse('Czech greeting', result);

  // Should contain Czech characters or common Czech words
  const hasCzech = /[áčďéěíňóřšťúůýž]|ahoj|dobrý|dob[rř]/i.test(result.content);
  assert(hasCzech, 'Expected Czech language response');
});

await testAsync('2.2 English question → English response', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const result = await ollamaChat([
    { role: 'system', content: 'You are a helpful AI assistant. Respond in English only, briefly.' },
    { role: 'user', content: 'What is the capital of France?' },
  ]);

  assert(result.content.length > 3, 'Response too short');
  printLLMResponse('English factual', result);

  assertIncludes(result.content.toLowerCase(), 'paris', 'Expected Paris in response');
});

await testAsync('2.3 Multi-turn context retention', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  // Turn 1: Introduce a topic
  const turn1 = await ollamaChat([
    { role: 'system', content: 'Jsi český AI asistent. Odpovídej česky, stručně.' },
    { role: 'user', content: 'Jaké je hlavní město Japonska?' },
  ]);

  assert(turn1.content.length > 3, 'Turn 1 too short');
  printLLMResponse('Turn 1 (topic)', turn1);

  const hasTokyo = /tok[iy]o|tokio/i.test(turn1.content);
  assert(hasTokyo, 'Expected Tokyo/Tokio in first response');

  // Turn 2: Follow-up using pronoun (context-dependent)
  const turn2 = await ollamaChat([
    { role: 'system', content: 'Jsi český AI asistent. Odpovídej česky, stručně.' },
    { role: 'user', content: 'Jaké je hlavní město Japonska?' },
    { role: 'assistant', content: turn1.content },
    { role: 'user', content: 'Kolik tam žije lidí?' },
  ]);

  assert(turn2.content.length > 3, 'Turn 2 too short');
  printLLMResponse('Turn 2 (follow-up)', turn2);

  // Should reference population / millions (about Tokyo or Japan)
  const hasNumber = /\d/.test(turn2.content);
  assert(hasNumber, 'Expected numerical population data in follow-up');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 3: CRE Bridge (Authorized LLM Calls)
// ═══════════════════════════════════════════════════════════════════════════════

suite('3. CRE Bridge — Authorized LLM Calls');

await testAsync('3.1 generateChatResponse via CRE Bridge', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const creBridge = await import('../src/llm/cre-bridge.js');

  const result = await creBridge.generateChatResponse(
    'Co je to fotosyntéza? Odpověz jednou větou.',
    'Jsi stručný český asistent. Odpovídej jednou větou.',
    { temperature: 0.3 },
  );

  assert(result.content.length > 10, 'CRE bridge response too short');
  assert(result.model, 'Missing model field');
  printLLMResponse('CRE Bridge chat', result);

  // Should mention light/sun/plants
  const hasRelevant = /svět|sluneč|rostlin|fotosyn|chloro|energie/i.test(result.content);
  assert(hasRelevant, 'Expected photosynthesis-related content');
});

await testAsync('3.2 CRE Bridge with conversation history', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const creBridge = await import('../src/llm/cre-bridge.js');

  const prompt = `Context:
User: Kdo napsal Hamleta?
assistant: William Shakespeare napsal Hamleta.

User: Kdy se narodil?`;

  const result = await creBridge.generateChatResponse(
    prompt,
    'Jsi stručný český asistent. Odpovídej jednou nebo dvěma větami.',
    { temperature: 0.3 },
  );

  assert(result.content.length > 5, 'Response too short');
  printLLMResponse('CRE Bridge follow-up', result);

  // Should reference 1564 (Shakespeare's birth year)
  const has1564 = /1564/.test(result.content);
  assert(has1564, 'Expected 1564 (Shakespeare birth year) in follow-up response');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 4: CRE Decision + Handler (Conversation Mode)
// ═══════════════════════════════════════════════════════════════════════════════

suite('4. CRE Decision → Conversation Handler');

await testAsync('4.1 CONVERSATIONAL intent → LLM answer', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const { CREDecisionEngine, IntentType, DecisionType } = await import('../src/chat/cre-decision.js');
  const creBridge = await import('../src/llm/cre-bridge.js');
  const { getLanguageContext } = await import('../src/chat/handlers/utils/language.js');

  const input = 'Jak se máš?';

  // Step 1: CRE classifies intent
  const engine = new CREDecisionEngine();
  const intent = engine.classifyIntent(input);
  console.log(`     Intent: ${intent}`);
  assertEqual(intent, IntentType.CONVERSATIONAL, 'Expected CONVERSATIONAL intent');

  // Step 2: CRE makes decision
  const decision = await engine.decide(input, {});
  console.log(`     Decision: ${decision.type}`);
  assertEqual(decision.type, DecisionType.ANSWER, 'Expected ANSWER decision');

  // Step 3: Call LLM (simulating what handleAnswerDecision does)
  const langCtx = getLanguageContext(input);
  console.log(`     Language: ${langCtx.language}`);

  const result = await creBridge.generateChatResponse(
    input,
    'Jsi užitečný AI asistent. Odpovídej česky, stručně.',
    { temperature: 0.7 },
  );

  assert(result.content.length > 10, 'LLM response too short');
  printLLMResponse('Conversational answer', result);
});

await testAsync('4.2 LOCAL intent → deterministic + no LLM', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const { CREDecisionEngine, IntentType, DecisionType } = await import('../src/chat/cre-decision.js');
  const { computeMath } = await import('../src/chat/handlers/local.js');

  const input = '15 * 7';

  // CRE should classify as LOCAL
  const engine = new CREDecisionEngine();
  const intent = engine.classifyIntent(input);
  console.log(`     Intent: ${intent}`);
  assertEqual(intent, IntentType.LOCAL, 'Expected LOCAL intent');

  // Decision should be LOCAL (no LLM call needed)
  const decision = await engine.decide(input, {});
  console.log(`     Decision: ${decision.type}`);
  assertEqual(decision.type, DecisionType.LOCAL, 'Expected LOCAL decision');

  // Compute locally
  const mathResult = computeMath(input);
  console.log(`     \x1b[33mLocal result: ${JSON.stringify(mathResult)}\x1b[0m`);
  assert(mathResult !== null, 'computeMath returned null');
  assertEqual(mathResult.answer, 105, 'Expected 15*7=105');
});

await testAsync('4.3 SEARCH intent → TOOL_CALL decision', async () => {
  const { CREDecisionEngine, IntentType, DecisionType } = await import('../src/chat/cre-decision.js');

  const input = 'kdo je prezident České republiky';

  const engine = new CREDecisionEngine();
  const intent = engine.classifyIntent(input);
  console.log(`     Intent: ${intent}`);

  const decision = await engine.decide(input, {});
  console.log(`     Decision: ${decision.type}, tools: ${decision.tools?.join(', ') || 'none'}`);
  assertEqual(decision.type, DecisionType.TOOL_CALL, 'Expected TOOL_CALL for search query');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 5: Full Pipeline — ChatController.handle()
// ═══════════════════════════════════════════════════════════════════════════════

suite('5. Full Pipeline — ChatController.handle()');

await testAsync('5.1 Bootstrap pipeline and send greeting', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  // Initialize ConversationStore in-memory (no DB)
  const { resetConversationStore, getConversationStore } = await import('../src/chat/conversation-store.js');
  resetConversationStore();
  getConversationStore(null); // in-memory mode

  // Configure ChatController with default handlers
  const { ChatController } = await import('../src/chat/controller.js');
  const { getDefaultHandlers } = await import('../src/chat/handlers/index.js');

  ChatController.configure({
    handlers: getDefaultHandlers(),
    config: { autoModeDetection: true, modeConfidenceThreshold: 0.6 },
  });

  const sessionId = `llm-test-${Date.now()}`;

  // Send a greeting through the full pipeline
  const result = await ChatController.handle({
    message: 'Ahoj, jak se dnes máš?',
    sessionId,
  });

  console.log(`     Mode: ${result.mode}, Confidence: ${result.confidence}`);
  assert(result.response, 'No response from pipeline');
  assert(result.response.length > 5, `Response too short: "${result.response}"`);
  printLLMResponse('Full pipeline greeting', {
    content: result.response,
    model: result.metadata?.model || 'unknown',
    duration: result.metadata?.duration || 0,
  });

  // Clean up session
  ChatController.removeSession(sessionId);
});

await testAsync('5.2 Multi-turn: greeting → follow-up in same session', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const { resetConversationStore, getConversationStore } = await import('../src/chat/conversation-store.js');
  resetConversationStore();
  getConversationStore(null);

  const { ChatController } = await import('../src/chat/controller.js');
  const { getDefaultHandlers } = await import('../src/chat/handlers/index.js');

  ChatController.configure({
    handlers: getDefaultHandlers(),
    config: { autoModeDetection: true, modeConfidenceThreshold: 0.6 },
  });

  const sessionId = `llm-multi-${Date.now()}`;

  // Turn 1: greeting
  console.log('     --- Turn 1: Greeting ---');
  const turn1 = await ChatController.handle({
    message: 'Ahoj! Jsem vývojář a pracuji na projektu v Node.js.',
    sessionId,
  });
  assert(turn1.response, 'No response for turn 1');
  printLLMResponse('Turn 1', {
    content: turn1.response,
    model: turn1.metadata?.model || 'unknown',
    duration: turn1.metadata?.duration || 0,
  });

  // Turn 2: follow-up (should retain context about Node.js)
  console.log('     --- Turn 2: Follow-up ---');
  const turn2 = await ChatController.handle({
    message: 'Jaké frameworky bys doporučil?',
    sessionId,
  });
  assert(turn2.response, 'No response for turn 2');
  printLLMResponse('Turn 2', {
    content: turn2.response,
    model: turn2.metadata?.model || 'unknown',
    duration: turn2.metadata?.duration || 0,
  });

  // Clean up
  ChatController.removeSession(sessionId);
});

await testAsync('5.3 LOCAL computation through full pipeline', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const { resetConversationStore, getConversationStore } = await import('../src/chat/conversation-store.js');
  resetConversationStore();
  getConversationStore(null);

  const { ChatController } = await import('../src/chat/controller.js');
  const { getDefaultHandlers } = await import('../src/chat/handlers/index.js');

  ChatController.configure({
    handlers: getDefaultHandlers(),
    config: { autoModeDetection: true, modeConfidenceThreshold: 0.6 },
  });

  const sessionId = `llm-local-${Date.now()}`;

  const result = await ChatController.handle({
    message: 'kolik je 256 * 3',
    sessionId,
  });

  console.log(`     Mode: ${result.mode}`);
  assert(result.response, 'No response for LOCAL');
  printLLMResponse('LOCAL math', {
    content: result.response,
    model: 'local',
    duration: 0,
  });

  // Should contain 768
  assertIncludes(result.response, '768', 'Expected 256*3=768 in response');

  ChatController.removeSession(sessionId);
});

await testAsync('5.4 Date/calendar through full pipeline', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const { resetConversationStore, getConversationStore } = await import('../src/chat/conversation-store.js');
  resetConversationStore();
  getConversationStore(null);

  const { ChatController } = await import('../src/chat/controller.js');
  const { getDefaultHandlers } = await import('../src/chat/handlers/index.js');

  ChatController.configure({
    handlers: getDefaultHandlers(),
    config: { autoModeDetection: true, modeConfidenceThreshold: 0.6 },
  });

  const sessionId = `llm-date-${Date.now()}`;

  const result = await ChatController.handle({
    message: 'jaký je dnes den',
    sessionId,
  });

  console.log(`     Mode: ${result.mode}`);
  assert(result.response, 'No response for date query');
  printLLMResponse('LOCAL date', {
    content: result.response,
    model: 'local',
    duration: 0,
  });

  // Should contain today's date in some format
  const today = new Date();
  const day = today.getDate();
  assertIncludes(result.response, String(day), `Expected day ${day} in date response`);

  ChatController.removeSession(sessionId);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 6: Mixed Scenarios
// ═══════════════════════════════════════════════════════════════════════════════

suite('6. Mixed Scenarios — LOCAL then LLM');

await testAsync('6.1 LOCAL math → conversational follow-up', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const { resetConversationStore, getConversationStore } = await import('../src/chat/conversation-store.js');
  resetConversationStore();
  getConversationStore(null);

  const { ChatController } = await import('../src/chat/controller.js');
  const { getDefaultHandlers } = await import('../src/chat/handlers/index.js');

  ChatController.configure({
    handlers: getDefaultHandlers(),
    config: { autoModeDetection: true, modeConfidenceThreshold: 0.6 },
  });

  const sessionId = `llm-mixed-${Date.now()}`;

  // Turn 1: LOCAL math
  console.log('     --- Turn 1: LOCAL math ---');
  const turn1 = await ChatController.handle({
    message: '125 * 8',
    sessionId,
  });
  assert(turn1.response, 'No response for math');
  assertIncludes(turn1.response, '1000', 'Expected 125*8=1000');
  printLLMResponse('Math result', {
    content: turn1.response,
    model: 'local',
    duration: 0,
  });

  // Turn 2: Conversational follow-up
  console.log('     --- Turn 2: Conversational ---');
  const turn2 = await ChatController.handle({
    message: 'Díky! Co je nového ve světě AI?',
    sessionId,
  });
  assert(turn2.response, 'No response for conversational follow-up');
  assert(turn2.response.length > 20, 'Conversational response too short');
  printLLMResponse('Conversational follow-up', {
    content: turn2.response,
    model: turn2.metadata?.model || 'unknown',
    duration: turn2.metadata?.duration || 0,
  });

  ChatController.removeSession(sessionId);
});

await testAsync('6.2 Three-step: greeting → math → opinion', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const { resetConversationStore, getConversationStore } = await import('../src/chat/conversation-store.js');
  resetConversationStore();
  getConversationStore(null);

  const { ChatController } = await import('../src/chat/controller.js');
  const { getDefaultHandlers } = await import('../src/chat/handlers/index.js');

  ChatController.configure({
    handlers: getDefaultHandlers(),
    config: { autoModeDetection: true, modeConfidenceThreshold: 0.6 },
  });

  const sessionId = `llm-3step-${Date.now()}`;

  // Step 1: Greeting
  console.log('     --- Step 1: Greeting ---');
  const s1 = await ChatController.handle({ message: 'Ahoj!', sessionId });
  assert(s1.response, 'Step 1: no response');
  printLLMResponse('Step 1', {
    content: s1.response,
    model: s1.metadata?.model || 'unknown',
    duration: s1.metadata?.duration || 0,
  });

  // Step 2: Math
  console.log('     --- Step 2: Math ---');
  const s2 = await ChatController.handle({ message: '42 * 42', sessionId });
  assert(s2.response, 'Step 2: no response');
  assertIncludes(s2.response, '1764', 'Expected 42*42=1764');
  printLLMResponse('Step 2', {
    content: s2.response,
    model: 'local',
    duration: 0,
  });

  // Step 3: Opinion (back to LLM)
  console.log('     --- Step 3: Opinion ---');
  const s3 = await ChatController.handle({ message: 'Jaký je tvůj oblíbený programovací jazyk?', sessionId });
  assert(s3.response, 'Step 3: no response');
  assert(s3.response.length > 15, 'Step 3 response too short for opinion');
  printLLMResponse('Step 3', {
    content: s3.response,
    model: s3.metadata?.model || 'unknown',
    duration: s3.metadata?.duration || 0,
  });

  ChatController.removeSession(sessionId);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
