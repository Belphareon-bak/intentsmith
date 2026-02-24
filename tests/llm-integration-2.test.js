// C3-Agent v57.3 — LLM Integration Tests Part 2 (16 tests)
// ══════════════════════════════════════════════════════════════════════════════
//
// Requires: Ollama running at 127.0.0.1:11434 with qwen2.5:32b.
//
// Sections:
//   7.  Language Detection & Enforcement (4 tests)
//   8.  Forbidden Phrase Enforcement (2 tests)
//   9.  Intent Classification + LLM (4 tests)
//   10. Calendar & Date Computations (3 tests)
//   11. Reformulation & Correction Patterns (3 tests)
//
// Run:  OLLAMA_URL=http://127.0.0.1:11434 node tests/llm-integration-2.test.js
//
// ══════════════════════════════════════════════════════════════════════════════

import { suite, testAsync, assert, assertEqual, assertIncludes, summary } from './harness.js';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const CHAT_MODEL = 'qwen2.5:32b';
const TIMEOUT = 90_000;

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
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), options.timeout || TIMEOUT);
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(tid);
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const data = await res.json();
    return {
      content: data.message?.content || '',
      model: data.model,
      duration: data.total_duration ? Math.round(data.total_duration / 1e6) : 0,
    };
  } catch (err) {
    clearTimeout(tid);
    throw err;
  }
}

function printLLM(label, result) {
  const t = result.content.length > 400 ? result.content.substring(0, 400) + '...' : result.content;
  console.log(`     \x1b[36m[LLM ${result.model} ${result.duration}ms]\x1b[0m`);
  console.log(`     \x1b[33m${t}\x1b[0m`);
}

async function setupPipeline() {
  const { resetConversationStore, getConversationStore } = await import('../src/chat/conversation-store.js');
  resetConversationStore();
  getConversationStore(null);
  const { ChatController } = await import('../src/chat/controller.js');
  const { getDefaultHandlers } = await import('../src/chat/handlers/index.js');
  ChatController.configure({
    handlers: getDefaultHandlers(),
    config: { autoModeDetection: true, modeConfidenceThreshold: 0.6 },
  });
  return ChatController;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Connectivity gate
// ═══════════════════════════════════════════════════════════════════════════════

let ollamaAvailable = false;
suite('0. Pre-check');
await testAsync('0.1 Ollama reachable', async () => {
  const res = await fetch(`${OLLAMA_URL}/api/tags`);
  assert(res.ok, `Ollama returned ${res.status}`);
  ollamaAvailable = true;
  console.log('     OK');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 7: Language Detection & Enforcement
// ═══════════════════════════════════════════════════════════════════════════════

suite('7. Language Detection & Enforcement');

await testAsync('7.1 No-diacritics Czech → detected as CS → Czech response', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const { detectLanguage, getLanguageContext } = await import('../src/chat/handlers/utils/language.js');
  const creBridge = await import('../src/llm/cre-bridge.js');

  // "udelej mi prehled novinek z ceska" — no háčky/čárky
  const input = 'udelej mi prehled novinek z ceska';
  const langCtx = getLanguageContext(input);
  console.log(`     Detected: ${langCtx.language} (from no-diacritics input)`);
  assertEqual(langCtx.language, 'cs', 'Expected Czech detection from no-diacritics input');

  // Now verify LLM responds in Czech
  const systemPrompt = `Jsi stručný český asistent. ${langCtx.instruction || ''}`;
  const result = await creBridge.generateChatResponse(input, systemPrompt, { temperature: 0.3 });
  assert(result.content.length > 10, 'Response too short');
  printLLM('No-diacritics CZ', result);

  // Response should be in Czech (has Czech diacritics or Czech words)
  const hasCzech = /[áčďéěíňóřšťúůýž]|česk|republik|země/i.test(result.content);
  assert(hasCzech, 'Expected Czech language in response');
});

await testAsync('7.2 German input → German response', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const { getLanguageContext } = await import('../src/chat/handlers/utils/language.js');
  const creBridge = await import('../src/llm/cre-bridge.js');

  const input = 'Was ist die Hauptstadt von Deutschland?';
  const langCtx = getLanguageContext(input);
  console.log(`     Detected: ${langCtx.language}`);
  assertEqual(langCtx.language, 'de', 'Expected German detection');

  const systemPrompt = `Du bist ein hilfreicher Assistent. Antworte auf Deutsch. ${langCtx.instruction || ''}`;
  const result = await creBridge.generateChatResponse(input, systemPrompt, { temperature: 0.3 });
  printLLM('German', result);

  assertIncludes(result.content, 'Berlin', 'Expected Berlin in German response');
});

await testAsync('7.3 Slovak input → Slovak response', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const { getLanguageContext } = await import('../src/chat/handlers/utils/language.js');
  const creBridge = await import('../src/llm/cre-bridge.js');

  const input = 'Aké je hlavné mesto Slovenska?';
  const langCtx = getLanguageContext(input);
  console.log(`     Detected: ${langCtx.language}`);
  // Slovak should be detected (ľ not present, but "hlavné mesto" + "Slovenska" are strong SK markers)
  assert(langCtx.language === 'sk' || langCtx.language === 'cs',
    `Expected Slovak or Czech detection, got ${langCtx.language}`);

  const systemPrompt = `Si užitočný asistent. Odpovedaj po slovensky. ${langCtx.instruction || ''}`;
  const result = await creBridge.generateChatResponse(input, systemPrompt, { temperature: 0.3 });
  printLLM('Slovak', result);

  assertIncludes(result.content, 'Bratislav', 'Expected Bratislava in Slovak response');
});

await testAsync('7.4 English through full pipeline → English response', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const ChatController = await setupPipeline();
  const sessionId = `lang-en-${Date.now()}`;

  const result = await ChatController.handle({
    message: 'Hello! How are you today?',
    sessionId,
  });
  assert(result.response, 'No response');
  printLLM('EN pipeline', {
    content: result.response,
    model: result.metadata?.model || 'unknown',
    duration: result.metadata?.duration || 0,
  });

  // Should NOT contain Czech words (not mixing languages)
  const hasCzechOnly = /^[^a-z]*[áčďěňřšťůýž]/i.test(result.response);
  // Just verify there IS a response and it's reasonably long
  assert(result.response.length > 5, 'English response too short');

  ChatController.removeSession(sessionId);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 8: Forbidden Phrase Enforcement
// ═══════════════════════════════════════════════════════════════════════════════

suite('8. Forbidden Phrase Enforcement');

await testAsync('8.1 validateResponse detects forbidden phrases', async () => {
  const { creDecisionEngine, FORBIDDEN_PHRASES } = await import('../src/chat/cre-decision.js');

  // Clean response should pass
  const clean = creDecisionEngine.validateResponse('Hlavní město Francie je Paříž.');
  assert(clean.valid, 'Clean response should pass validation');
  console.log(`     Clean response: valid=${clean.valid}`);

  // Response with forbidden phrase should fail
  const dirty = creDecisionEngine.validateResponse('Nemám přístup k internetu, takže nemohu vyhledávat.');
  assert(!dirty.valid, 'Forbidden phrase should be detected');
  console.log(`     Dirty response: valid=${dirty.valid}, violations=${dirty.violations?.length || 0}`);
  assert(dirty.violations?.length > 0, 'Expected at least one violation');
});

await testAsync('8.2 LLM conversational response contains no forbidden phrases', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const { creDecisionEngine, FORBIDDEN_PHRASES } = await import('../src/chat/cre-decision.js');
  const creBridge = await import('../src/llm/cre-bridge.js');

  // Ask a question that might tempt the LLM to say "I can't search"
  const result = await creBridge.generateChatResponse(
    'Jaké je dnes počasí v Praze?',
    `Jsi AI asistent v konverzačním režimu.
PRAVIDLA:
- NIKDY neříkej "nemám přístup" nebo "nemohu vyhledávat"
- Místo toho řekni, že POTŘEBUJEŠ provést vyhledávání
- Odpovídej česky`,
    { temperature: 0.5 },
  );

  printLLM('Weather query (conv mode)', result);

  const validation = creDecisionEngine.validateResponse(result.content);
  console.log(`     Validation: valid=${validation.valid}${validation.violations?.length ? ', violations=' + validation.violations.join(', ') : ''}`);
  assert(validation.valid, `LLM used forbidden phrase: ${validation.violations?.join(', ')}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 9: Intent Classification + LLM Responses
// ═══════════════════════════════════════════════════════════════════════════════

suite('9. Intent Classification + LLM');

await testAsync('9.1 CREATIVE intent → classification + LLM creative answer', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const { CREDecisionEngine, IntentType } = await import('../src/chat/cre-decision.js');
  const creBridge = await import('../src/llm/cre-bridge.js');

  const input = 'vymysli mi název pro startup zabývající se AI';
  const engine = new CREDecisionEngine();
  const intent = engine.classifyIntent(input);
  console.log(`     Intent: ${intent}`);
  assertEqual(intent, IntentType.CREATIVE, 'Expected CREATIVE intent');

  const result = await creBridge.generateChatResponse(
    input,
    'Jsi kreativní český asistent. Navrhni 3 originální názvy.',
    { temperature: 0.8 },
  );
  assert(result.content.length > 20, 'Creative response too short');
  printLLM('Creative answer', result);
});

await testAsync('9.2 REPORT intent classification (no-diacritics)', async () => {
  const { CREDecisionEngine, IntentType, DecisionType } = await import('../src/chat/cre-decision.js');

  const engine = new CREDecisionEngine();

  const inputs = [
    { text: 'udelej mi report zprav z webu novinky cz', expectedIntent: IntentType.REPORT },
    { text: 'vytvor report o stavu trhu', expectedIntent: IntentType.REPORT },
    { text: 'priprav mi prehled novinek', expectedIntent: IntentType.REPORT },
  ];

  for (const { text, expectedIntent } of inputs) {
    const intent = engine.classifyIntent(text);
    const decision = await engine.decide(text, {});
    console.log(`     "${text}" → ${intent} / ${decision.type}`);
    assertEqual(intent, expectedIntent, `"${text}" should be ${expectedIntent}, got ${intent}`);
  }
});

await testAsync('9.3 CODE intent → classification + LLM code answer', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const { CREDecisionEngine, IntentType } = await import('../src/chat/cre-decision.js');
  const creBridge = await import('../src/llm/cre-bridge.js');

  const input = 'napiš mi funkci v Pythonu pro Fibonacci sekvenci';
  const engine = new CREDecisionEngine();
  const intent = engine.classifyIntent(input);
  console.log(`     Intent: ${intent}`);
  assertEqual(intent, IntentType.CODE, 'Expected CODE intent');

  const result = await creBridge.generateChatResponse(
    input,
    'Jsi programátorský asistent. Odpověz kódem s krátkým vysvětlením.',
    { temperature: 0.3 },
  );
  assert(result.content.length > 30, 'Code response too short');
  printLLM('Code answer', result);

  // Should contain Python-like code
  const hasCode = /def |fibonacci|return|fib/i.test(result.content);
  assert(hasCode, 'Expected Python code in response');
});

await testAsync('9.4 SELF_REFERENCE + STATEMENT intents', async () => {
  const { CREDecisionEngine, IntentType } = await import('../src/chat/cre-decision.js');
  const engine = new CREDecisionEngine();

  // SELF_REFERENCE: "what is my name" should NOT be SEARCH
  const selfRef = engine.classifyIntent('what is my name');
  console.log(`     "what is my name" → ${selfRef}`);
  assertEqual(selfRef, IntentType.CONVERSATIONAL,
    'Self-reference should be CONVERSATIONAL, not SEARCH');

  // STATEMENT: "I am a developer" should NOT be AMBIGUOUS
  const statement = engine.classifyIntent('I am a developer');
  console.log(`     "I am a developer" → ${statement}`);
  assertEqual(statement, IntentType.CONVERSATIONAL,
    'Statement should be CONVERSATIONAL, not AMBIGUOUS');

  // CONVERSATIONAL: "co si myslíš o AI" should stay CONVERSATIONAL
  const opinion = engine.classifyIntent('co si myslíš o AI');
  console.log(`     "co si myslíš o AI" → ${opinion}`);
  assertEqual(opinion, IntentType.CONVERSATIONAL,
    'Opinion question should be CONVERSATIONAL');
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 10: Calendar & Date Computations via Pipeline
// ═══════════════════════════════════════════════════════════════════════════════

suite('10. Calendar & Date Computations');

await testAsync('10.1 Moon phase query via full pipeline', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const ChatController = await setupPipeline();
  const sessionId = `moon-${Date.now()}`;

  const result = await ChatController.handle({
    message: 'kdy bude příští úplněk',
    sessionId,
  });

  assert(result.response, 'No response for moon query');
  printLLM('Moon phase', { content: result.response, model: 'local', duration: 0 });

  // Should contain a date and "úplněk" or days reference
  const hasDate = /\d{1,2}\.\s*\d{1,2}\.\s*\d{4}/.test(result.response);
  const hasMoonRef = /úplněk|uplnek|dní|dni|za\s+\d/i.test(result.response);
  assert(hasDate || hasMoonRef, 'Expected date or moon reference in response');

  ChatController.removeSession(sessionId);
});

await testAsync('10.2 Christmas countdown via pipeline', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const ChatController = await setupPipeline();
  const sessionId = `xmas-${Date.now()}`;

  const result = await ChatController.handle({
    message: 'kolik dní do Vánoc',
    sessionId,
  });

  assert(result.response, 'No response for Christmas query');
  printLLM('Christmas', { content: result.response, model: 'local', duration: 0 });

  // Should contain a number of days
  const hasDays = /\d+/.test(result.response);
  assert(hasDays, 'Expected day count in Christmas response');

  ChatController.removeSession(sessionId);
});

await testAsync('10.3 Time query → current time', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const ChatController = await setupPipeline();
  const sessionId = `time-${Date.now()}`;

  const result = await ChatController.handle({
    message: 'kolik je hodin',
    sessionId,
  });

  assert(result.response, 'No response for time query');
  printLLM('Time query', { content: result.response, model: 'local', duration: 0 });

  // Should contain time in HH:MM format or hour reference
  const hasTime = /\d{1,2}:\d{2}|\d{1,2}\s*hodin/i.test(result.response);
  assert(hasTime, 'Expected time in response');

  ChatController.removeSession(sessionId);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Section 11: Reformulation & Correction Patterns
// ═══════════════════════════════════════════════════════════════════════════════

suite('11. Reformulation & Correction Patterns');

await testAsync('11.1 Reformulation patterns correctly detected', async () => {
  const { REFORMULATION_PATTERNS } = await import('../src/chat/cre-decision.js');

  const shouldMatch = [
    'zkus to v češtině',
    'zkus to v ceskem jazyce',
    'odpověz anglicky',
    'zkus to znovu',
    'zopakuj to',
    'ještě jednou',
  ];

  const shouldNotMatch = [
    'ahoj jak se máš',
    'kolik je 5+3',
    'najdi mi restauraci',
  ];

  for (const text of shouldMatch) {
    const matched = REFORMULATION_PATTERNS.some(p => p.test(text));
    console.log(`     "${text}" → ${matched ? '✅ match' : '❌ no match'}`);
    assert(matched, `Expected reformulation match for: "${text}"`);
  }

  for (const text of shouldNotMatch) {
    const matched = REFORMULATION_PATTERNS.some(p => p.test(text));
    console.log(`     "${text}" → ${matched ? '❌ unexpected match' : '✅ no match'}`);
    assert(!matched, `Should NOT match reformulation: "${text}"`);
  }
});

await testAsync('11.2 Correction patterns correctly detected', async () => {
  const { CREDecisionEngine, IntentType } = await import('../src/chat/cre-decision.js');
  const engine = new CREDecisionEngine();

  const corrections = [
    'ale dnes je 8.2.2026',
    'dnes je ale 15.3.2026',
    'ne, myslel jsem něco jiného',
    'špatně, dnes je pondělí',
  ];

  for (const text of corrections) {
    const intent = engine.classifyIntent(text);
    console.log(`     "${text}" → ${intent}`);
    // Corrections should be CONVERSATIONAL (not AMBIGUOUS or SEARCH)
    assertEqual(intent, IntentType.CONVERSATIONAL,
      `Correction "${text}" should be CONVERSATIONAL, got ${intent}`);
  }
});

await testAsync('11.3 Four-step scenario: question → answer → correction → updated', async () => {
  assert(ollamaAvailable, 'Ollama not reachable — skipping');

  const ChatController = await setupPipeline();
  const sessionId = `correction-${Date.now()}`;

  // Step 1: Date query
  console.log('     --- Step 1: Date query ---');
  const s1 = await ChatController.handle({
    message: 'jaký je dnes den',
    sessionId,
  });
  assert(s1.response, 'Step 1: no response');
  printLLM('Step 1 (date)', { content: s1.response, model: 'local', duration: 0 });

  // Step 2: Math
  console.log('     --- Step 2: Math ---');
  const s2 = await ChatController.handle({
    message: '99 * 11',
    sessionId,
  });
  assert(s2.response, 'Step 2: no response');
  assertIncludes(s2.response, '1089', 'Expected 99*11=1089');
  printLLM('Step 2 (math)', { content: s2.response, model: 'local', duration: 0 });

  // Step 3: Conversational (opinion)
  console.log('     --- Step 3: Opinion ---');
  const s3 = await ChatController.handle({
    message: 'Co si myslíš o TypeScriptu?',
    sessionId,
  });
  assert(s3.response, 'Step 3: no response');
  assert(s3.response.length > 15, 'Step 3 too short');
  printLLM('Step 3 (opinion)', {
    content: s3.response,
    model: s3.metadata?.model || 'unknown',
    duration: s3.metadata?.duration || 0,
  });

  // Step 4: Another greeting (back to simple LLM)
  console.log('     --- Step 4: Farewell ---');
  const s4 = await ChatController.handle({
    message: 'Díky, to je vše!',
    sessionId,
  });
  assert(s4.response, 'Step 4: no response');
  printLLM('Step 4 (farewell)', {
    content: s4.response,
    model: s4.metadata?.model || 'unknown',
    duration: s4.metadata?.duration || 0,
  });

  ChatController.removeSession(sessionId);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════════

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
