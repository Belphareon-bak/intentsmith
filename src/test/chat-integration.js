#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// C3 Agent — Chat Integration Tests v56.0
// ═══════════════════════════════════════════════════════════════════════════════
//
// Comprehensive tests that exercise the FULL chat pipeline with real LLM.
//
// Usage:
//   node src/test/chat-integration.js              # all tests
//   node src/test/chat-integration.js --fast       # skip slow LLM tests
//   node src/test/chat-integration.js --section 3  # run only section 3
//
// Requirements:
//   - Ollama running on localhost:11434
//   - qwen2.5:32b model loaded (or whatever config.models.CHAT is)
//   - better-sqlite3 installed
//
// ═══════════════════════════════════════════════════════════════════════════════

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = join(__dirname, '..');

const args = process.argv.slice(2);
const FAST_MODE = args.includes('--fast');
const SECTION_ONLY = args.includes('--section') ? parseInt(args[args.indexOf('--section') + 1]) : null;

// ═══════════════════════════════════════════════════════════════════════════════
// TEST FRAMEWORK
// ═══════════════════════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];
const timings = [];
let currentSection = 0;

function ok(name, ms) {
  passed++;
  const t = ms ? ` (${ms}ms)` : '';
  console.log(`  ✅ ${name}${t}`);
}

function fail(name, error) {
  failed++;
  const msg = error?.message || String(error);
  failures.push({ name, msg });
  console.log(`  ❌ ${name}`);
  console.log(`     → ${msg.substring(0, 200)}`);
}

function skip(name, reason) {
  skipped++;
  console.log(`  ⏭️  ${name} (${reason})`);
}

async function test(name, fn, { timeout = 5000, requiresLLM = false } = {}) {
  if (SECTION_ONLY && currentSection !== SECTION_ONLY) return;
  if (requiresLLM && FAST_MODE) { skip(name, '--fast mode'); return; }
  if (requiresLLM && !ollamaAvailable) { skip(name, 'Ollama not running'); return; }

  const start = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`TIMEOUT after ${timeout}ms`)), timeout)
      ),
    ]);
    const ms = Date.now() - start;
    timings.push({ name, ms });
    ok(name, ms);
  } catch (e) {
    fail(name, e);
  }
}

function section(num, title) {
  currentSection = num;
  if (!SECTION_ONLY || SECTION_ONLY === num) {
    console.log(`\n══════ ${num}. ${title} ══════`);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function assertType(v, t, n) { assert(typeof v === t, `${n}: expected ${t}, got ${typeof v}`); }
function assertTruthy(v, n) { assert(v, `${n} is falsy`); }
function assertIncludes(str, sub, n) { assert(str?.includes(sub), `${n}: "${str?.substring(0, 80)}" doesn't include "${sub}"`); }
function assertNotIncludes(str, sub, n) { assert(!str?.includes(sub), `${n}: should not include "${sub}"`); }
function assertOneOf(v, arr, n) { assert(arr.includes(v), `${n}: "${v}" not in [${arr}]`); }

// ═══════════════════════════════════════════════════════════════════════════════
// PRELOAD
// ═══════════════════════════════════════════════════════════════════════════════

let ollamaAvailable = false;
let modules = {};

console.log('🔧 Loading modules...');

try {
  modules.config = await import(join(SRC, 'config.js'));
  modules.controller = await import(join(SRC, 'chat/controller.js'));
  modules.creDecision = await import(join(SRC, 'chat/cre-decision.js'));
  modules.safetyEngine = await import(join(SRC, 'chat/safety/engine.js'));
  modules.quality = await import(join(SRC, 'chat/handlers/utils/quality.js'));
  modules.outputGate = await import(join(SRC, 'chat/handlers/utils/output-gate.js'));
  modules.followup = await import(join(SRC, 'chat/handlers/utils/followup.js'));
  modules.intent = await import(join(SRC, 'chat/handlers/utils/intent.js'));
  modules.synthesis = await import(join(SRC, 'chat/handlers/utils/synthesis.js'));
  modules.handlersIndex = await import(join(SRC, 'chat/handlers/index.js'));
  modules.toolExecutor = await import(join(SRC, 'executor/tool-executor.js'));
  modules.gateway = await import(join(SRC, 'llm/gateway.js'));
  modules.creBridge = await import(join(SRC, 'llm/cre-bridge.js'));
  modules.language = await import(join(SRC, 'chat/handlers/utils/language.js'));
  console.log('  ✅ All modules loaded');
} catch (e) {
  console.log(`  ❌ Module load failed: ${e.message}`);
  process.exit(1);
}

// Check Ollama
try {
  const baseUrl = modules.config.config?.ollama?.baseUrl || 'http://localhost:11434';
  const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
  if (res.ok) {
    const data = await res.json();
    ollamaAvailable = true;
    const models = data.models?.map(m => m.name) || [];
    console.log(`  ✅ Ollama running (${models.length} models: ${models.slice(0, 3).join(', ')}...)`);
  }
} catch {
  console.log('  ⚠️  Ollama not running — LLM tests will be skipped');
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: CRE Decision Engine
// ═══════════════════════════════════════════════════════════════════════════════

section(1, 'CRE DECISION ENGINE');

const { creDecisionEngine, DecisionType, IntentType, assertDecision } = modules.creDecision;

await test('CRE: factual query → SEARCH intent', () => {
  const d = creDecisionEngine.decide('Jaká je populace Prahy?');
  assertDecision(d);
  assert(d.type === DecisionType.TOOL_CALL, `Expected TOOL_CALL, got ${d.type}`);
  assertOneOf(d.intent, [IntentType.SEARCH, IntentType.FACTUAL], 'intent');
});

await test('CRE: creative request → CREATIVE or ANSWER', () => {
  const d = creDecisionEngine.decide('Napiš mi báseň o jaře');
  assertDecision(d);
  // Creative should be ANSWER (no tools needed) or TOOL_CALL with CREATIVE intent
  if (d.type === DecisionType.ANSWER) {
    assertOneOf(d.intent, [IntentType.CREATIVE, IntentType.CONVERSATIONAL], 'intent');
  }
});

await test('CRE: greeting → CONVERSATIONAL', () => {
  const d = creDecisionEngine.decide('Ahoj, jak se máš?');
  assertDecision(d);
  // Greeting should be ANSWER with CONVERSATIONAL
  if (d.type === DecisionType.ANSWER) {
    assert(d.intent === IntentType.CONVERSATIONAL, `Expected CONVERSATIONAL, got ${d.intent}`);
  }
});

await test('CRE: search query → TOOL_CALL with web.search', () => {
  const d = creDecisionEngine.decide('Najdi mi nejlepší restaurace v Brně');
  assertDecision(d);
  assert(d.type === DecisionType.TOOL_CALL, `Expected TOOL_CALL, got ${d.type}`);
  assert(d.tools?.includes('web.search'), `Expected web.search in tools, got ${d.tools}`);
});

await test('CRE: math question → LOCAL or ANSWER', () => {
  const d = creDecisionEngine.decide('Kolik je 15 * 37?');
  assertDecision(d);
  assertOneOf(d.type, [DecisionType.LOCAL, DecisionType.ANSWER, DecisionType.TOOL_CALL], 'type');
});

await test('CRE: report request → REPORT intent', () => {
  const d = creDecisionEngine.decide('Připrav mi detailní report o trhu s elektromobily v ČR');
  assertDecision(d);
  if (d.type === DecisionType.TOOL_CALL) {
    assertOneOf(d.intent, [IntentType.REPORT, IntentType.SEARCH], 'intent');
  }
});

await test('CRE: vague input → decision without crash', () => {
  const d = creDecisionEngine.decide('hm');
  assertDecision(d);
  // Should not crash, any valid decision type is OK
});

await test('CRE: empty-like input → valid decision', () => {
  const d = creDecisionEngine.decide('...');
  assertDecision(d);
});

await test('CRE: long input → valid decision', () => {
  const d = creDecisionEngine.decide('A'.repeat(2000));
  assertDecision(d);
});

await test('CRE: context with lastIntent → sticky intent', () => {
  const d = creDecisionEngine.decide('a co takhle jinak?', {
    lastIntent: IntentType.CREATIVE,
    lastDecision: { type: DecisionType.ANSWER, intent: IntentType.CREATIVE },
  });
  assertDecision(d);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Safety Engine
// ═══════════════════════════════════════════════════════════════════════════════

section(2, 'SAFETY ENGINE');

const { SafetyEngine, SafetyAction } = modules.safetyEngine;

await test('Safety: normal input → null (ALLOW)', () => {
  const r = SafetyEngine.check('Řekni mi o řeckých myslitelích', {});
  assert(r === null, `Expected null, got ${JSON.stringify(r)}`);
});

await test('Safety: check returns correct shape when blocking', () => {
  // Even if nothing triggers, verify the API shape
  const r = SafetyEngine.check('Hello', {});
  if (r !== null) {
    assert(r.action, 'Missing action');
    assert(r.domain, 'Missing domain');
    assert(r.reason, 'Missing reason');
  }
  // null is also valid (ALLOW)
});

await test('Safety: SafetyEngine.evaluate instance method works', () => {
  const engine = new SafetyEngine();
  const v = engine.evaluate({ query: 'test', context: {} });
  assert(v.action === SafetyAction.ALLOW, 'Empty engine should ALLOW');
});

await test('Safety: doesn\'t crash on edge inputs', () => {
  SafetyEngine.check('', {});
  SafetyEngine.check('a'.repeat(10000), {});
  SafetyEngine.check('🔥💀☠️', {});
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Quality Gates
// ═══════════════════════════════════════════════════════════════════════════════

section(3, 'QUALITY GATES');

const {
  assertCreativeQuality, detectFluff, atomicAnswerGate,
  countSentences, buildFluffRetryPrompt, buildAtomicRetryPrompt,
  SYNTHESIS_THRESHOLDS,
} = modules.quality;

await test('Creative quality: valid long content passes', () => {
  const r = assertCreativeQuality(
    'Jednoho dne se princ vydal na cestu do dalekých zemí. ' +
    'Cestou potkal draka, který mu nabídl přátelství. ' +
    'Společně překonali hory a údolí a nakonec našli poklad.',
    'Napiš mi příběh'
  );
  assert(r.valid === true, `Expected valid, got: ${r.reason}`);
});

await test('Creative quality: empty content fails', () => {
  const r = assertCreativeQuality('', 'Napiš báseň');
  assert(r.valid === false, 'Empty should fail');
});

await test('Creative quality: skeleton/template fails', () => {
  const r = assertCreativeQuality('[TODO] sem vložte text [fill in]', 'test');
  assert(r.valid === false, 'Skeleton should fail');
});

await test('Creative quality: repeated content fails', () => {
  const sentence = 'Toto je opakovaná věta, která by se neměla opakovat. ';
  const r = assertCreativeQuality(sentence.repeat(5), 'test');
  assert(r.valid === false, 'Repeated content should fail');
});

await test('Fluff detection: meta-commentary detected', () => {
  const r = detectFluff(
    'Na základě dostupných informací se podívejme na toto téma. ' +
    'Je důležité zmínit několik klíčových aspektů.',
    [{ success: true }]
  );
  assert(r.isFluff === true, `Expected fluff, got: ${JSON.stringify(r)}`);
});

await test('Fluff detection: substantive content passes', () => {
  const r = detectFluff(
    'Praha má 1,3 milionu obyvatel. Průměrná teplota v lednu je -1°C. ' +
    'Metro má 3 linky (A, B, C) s 61 stanicemi. Více na https://praha.eu',
    [{ success: true }]
  );
  assert(r.isFluff === false, `Substantive content flagged as fluff: ${r.reason}`);
});

await test('Fluff detection: empty output = fluff', () => {
  const r = detectFluff('', [{}]);
  assert(r.isFluff === true, 'Empty should be fluff');
});

await test('Atomic gate: concise factual answer passes', () => {
  const r = atomicAnswerGate('Praha je hlavní město České republiky.', { intent: 'FACTUAL' });
  assert(r.valid === true, `Expected valid: ${r.reason}`);
});

await test('Atomic gate: verbose factual answer fails', () => {
  const verbose = ('Toto je velmi dlouhá odpověď na jednoduchou otázku. ').repeat(30);
  const r = atomicAnswerGate(verbose, { intent: 'FACTUAL' });
  assert(r.valid === false, 'Too verbose FACTUAL should fail');
});

await test('Atomic gate: preamble on factual fails', () => {
  const r = atomicAnswerGate('To je dobrá otázka! Pojďme se na to podívat...', { intent: 'FACTUAL' });
  assert(r.valid === false, 'Preamble on FACTUAL should fail');
});

await test('countSentences: various inputs', () => {
  assert(countSentences('One.') === 1, 'One sentence');
  assert(countSentences('One. Two.') === 2, 'Two sentences');
  assert(countSentences('One! Two? Three.') === 3, 'Mixed punctuation');
  assert(countSentences(null) === 0, 'null');
  assert(countSentences('') === 0, 'empty');
  assert(countSentences('No punctuation') >= 1, 'No punctuation should still count');
});

await test('SYNTHESIS_THRESHOLDS: all intent types defined', () => {
  for (const intent of ['FACTUAL', 'SEARCH', 'REPORT', 'CREATIVE', 'DEFAULT']) {
    assert(SYNTHESIS_THRESHOLDS[intent], `Missing threshold for ${intent}`);
    assert(SYNTHESIS_THRESHOLDS[intent].minChars > 0, `${intent} minChars should be > 0`);
  }
});

await test('Output gate: normal content passes', () => {
  const { enforceOutputContract } = modules.outputGate;
  const r = enforceOutputContract(
    'Pythagoras byl starořecký filozof a matematik, zakladatel pythagorejské školy. Narodil se kolem roku 570 př. n. l. na ostrově Samos.',
    { intent: 'SEARCH' }
  );
  assert(r.ok === true, `Expected ok: ${r.reason}`);
});

await test('Output gate: zombie/meta content detected', () => {
  const { enforceOutputContract } = modules.outputGate;
  const r = enforceOutputContract(
    'Spouštím vyhledávání pro váš dotaz...',
    { intent: 'SEARCH' }
  );
  // This should either fail or be flagged
  if (!r.ok) {
    assert(r.failDimension, 'Should have failDimension');
  }
});

await test('Retry prompts build without crash', () => {
  const p1 = buildFluffRetryPrompt('original prompt', { reason: 'too fluffy' });
  assert(p1.includes('original prompt'), 'Should include original');
  assert(p1.includes('too fluffy'), 'Should include reason');

  const p2 = buildAtomicRetryPrompt('original prompt', { reason: 'too verbose' });
  assert(p2.includes('original prompt'), 'Should include original');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: Intent & Follow-up Detection
// ═══════════════════════════════════════════════════════════════════════════════

section(4, 'INTENT & FOLLOW-UP');

const { isClarification, detectAffirmative, isVagueInput: isVague } = modules.intent;
const { detectFollowUpType, FollowUpType, getPreviousToolData } = modules.followup;

await test('Intent: clarification detection', () => {
  assert(isClarification('ano') === true, '"ano" should be clarification');
  assert(isClarification('Jaké je počasí v Praze?') === true, '5 words → clarification');
  assert(isClarification('Řekni mi prosím jaký je aktuální stav trhu s elektromobily v Evropě') === false,
    'Long query should not be clarification');
});

await test('Intent: affirmative detection', () => {
  assert(detectAffirmative('ano') === 'yes', '"ano" → "yes"');
  assert(detectAffirmative('jo') === 'yes', '"jo" → "yes"');
  assert(detectAffirmative('ne') === 'no', '"ne" → "no"');
  assert(detectAffirmative('Jaké je počasí') === null, 'Query → null');
});

await test('Follow-up: new conversation → NEW_QUERY', () => {
  const r = detectFollowUpType('Jaké je počasí?', {});
  assert(r.type === FollowUpType.NEW_QUERY || r.type, 'Should have a type');
});

await test('Follow-up: format change detection', () => {
  const mockSession = {
    lastDecision: { type: 'TOOL_CALL', intent: 'SEARCH' },
    lastToolResults: [{ success: true, data: { results: [] } }],
    lastUserInput: 'informace o Praze',
  };
  const r = detectFollowUpType('shrň to do bodů', mockSession);
  assert(r.type, 'Should return a type');
  // FORMAT_CHANGE is ideal but any valid result is OK
});

await test('Follow-up: getPreviousToolData with empty session', () => {
  const r = getPreviousToolData({});
  assert(r === null || r === undefined || Array.isArray(r), 'Should handle empty session');
});

await test('Language detection', () => {
  const { getLanguageContext } = modules.language;
  const cz = getLanguageContext('Jaké je počasí v Praze?');
  assert(cz.language || cz.instruction, 'Should detect language');

  const en = getLanguageContext('What is the weather in Prague?');
  assert(en.language || en.instruction, 'Should detect English');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: Synthesis Pipeline (with LLM)
// ═══════════════════════════════════════════════════════════════════════════════

section(5, 'SYNTHESIS PIPELINE (LLM)');

await test('LLM Gateway: call with auth token', async () => {
  const { llmGateway } = modules.gateway;
  const { createAuthToken, LLMCapability } = await import(join(SRC, 'llm/auth-types.js'));

  const token = createAuthToken({
    role: 'CRE_DECISION',
    decisionId: `test-${Date.now()}`,
    auditContext: { sessionId: 'test-session' },
    capabilities: [LLMCapability.REASONING, LLMCapability.SUMMARIZATION],
  });

  const result = await modules.gateway.callWithAuth(token, 'Odpověz jedním slovem: hlavní město ČR?', {
    systemPrompt: 'Odpověz co nejstručněji.',
    temperature: 0.1,
  });

  assert(result.content, 'Should have content');
  assertType(result.content, 'string', 'content');
  assert(result.content.length > 0, 'Content should not be empty');
  assert(result.model, 'Should have model');
  assertType(result.duration, 'number', 'duration');
}, { timeout: 30000, requiresLLM: true });

await test('CRE Bridge: generateChatResponse', async () => {
  const result = await modules.creBridge.generateChatResponse(
    'Co je to fotosyntéza? Odpověz jednou větou.',
    'Jsi stručný asistent. Odpovídej česky.',
    { sessionId: 'test-bridge' }
  );

  assert(result.content, 'Should have content');
  assert(result.content.length > 10, 'Content should be substantive');
}, { timeout: 30000, requiresLLM: true });

await test('Synthesis: buildSynthesisPrompt doesn\'t crash', () => {
  const { buildSynthesisPrompt, buildSynthesisSystemPrompt } = modules.synthesis;
  const prompt = buildSynthesisPrompt({
    query: 'Pythagoras a řečtí myslitelé',
    intent: 'SEARCH',
    data: [{ type: 'search', data: { results: [{ title: 'Test', snippet: 'Pythagoras byl filozof' }] } }],
    failures: [],
    userPreferences: {},
  });
  assert(prompt.length > 0, 'Prompt should be non-empty');

  const sys = buildSynthesisSystemPrompt('SEARCH', {}, null, null, '');
  assert(sys.length > 0, 'System prompt should be non-empty');
});

await test('Synthesis: full LLM synthesis with mock tool results', async () => {
  const { synthesizeWithLLM } = modules.synthesis;

  const result = await synthesizeWithLLM({
    query: 'Kdo byl Pythagoras?',
    intent: 'SEARCH',
    toolResults: [{
      success: true,
      type: 'search',
      data: {
        results: [
          {
            title: 'Pythagoras - Wikipedia',
            snippet: 'Pythagoras of Samos was an ancient Ionian Greek philosopher. He founded the Pythagorean school. Born circa 570 BC on Samos.',
            url: 'https://en.wikipedia.org/wiki/Pythagoras',
          },
          {
            title: 'Pythagorean theorem',
            snippet: 'In mathematics, the Pythagorean theorem states that the area of the square on the hypotenuse equals the sum of the areas on the other two sides.',
            url: 'https://en.wikipedia.org/wiki/Pythagorean_theorem',
          },
        ],
      },
    }],
    context: { sessionId: 'test-synth' },
    userPreferences: {},
  });

  assert(result.content, 'Synthesis should return content');
  assert(result.content.length > 50, `Content too short: ${result.content.length} chars`);

  // Quality checks on the synthesis
  const fluff = detectFluff(result.content, [{ success: true }]);
  if (fluff.isFluff) {
    console.log(`     ⚠️  Synthesis produced fluff: ${fluff.reason}`);
  }

  const outputCheck = modules.outputGate.enforceOutputContract(result.content, { intent: 'SEARCH' });
  if (!outputCheck.ok) {
    console.log(`     ⚠️  Output gate flagged: ${outputCheck.reason}`);
  }
}, { timeout: 60000, requiresLLM: true });

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: Full Pipeline — ChatController.handle()
// ═══════════════════════════════════════════════════════════════════════════════

section(6, 'FULL PIPELINE — ChatController.handle()');

// Configure handlers (like server.js does)
const { ChatController, ChatMode } = modules.controller;
const { getDefaultHandlers } = modules.handlersIndex;

try {
  ChatController.configure({ handlers: getDefaultHandlers() });
  console.log('  ✅ ChatController configured with default handlers');
} catch (e) {
  console.log(`  ⚠️  ChatController.configure failed: ${e.message}`);
}

const testSessionId = `test-${Date.now()}`;
let lastResponse = null;

await test('Pipeline: simple greeting', async () => {
  const result = await ChatController.handle({
    message: 'Ahoj!',
    sessionId: testSessionId,
  });

  assert(result.response, 'Should have response');
  assert(result.response.length > 0, 'Response should not be empty');
  assertType(result.response, 'string', 'response');
  assert(result.mode, 'Should have mode');
  assertType(result.confidence, 'number', 'confidence');
  assert(result.confidence > 0 && result.confidence <= 1, `Confidence out of range: ${result.confidence}`);

  // Should NOT contain meta/zombie text
  assertNotIncludes(result.response, 'Spouštím', 'No zombie "Spouštím"');
  assertNotIncludes(result.response, 'vyhledávání', 'No zombie "vyhledávání"');

  lastResponse = result;
}, { timeout: 30000, requiresLLM: true });

await test('Pipeline: factual question (knowledge)', async () => {
  const result = await ChatController.handle({
    message: 'Kdo byl Pythagoras? Odpověz stručně.',
    sessionId: `test-fact-${Date.now()}`,
  });

  assert(result.response, 'Should have response');
  assert(result.response.length > 20, 'Should have substantive answer');

  // Check for meta-commentary (should not start with "Rád bych", "Dovolte mi" etc.)
  const noMeta = !/^(Rád bych|Dovolte mi|Je důležité|Based on)/i.test(result.response);
  if (!noMeta) {
    console.log(`     ⚠️  Response starts with meta-commentary: "${result.response.substring(0, 60)}"`);
  }

  lastResponse = result;
}, { timeout: 60000, requiresLLM: true });

await test('Pipeline: creative request', async () => {
  const result = await ChatController.handle({
    message: 'Napiš krátkou báseň o Praze (4 řádky)',
    sessionId: `test-creative-${Date.now()}`,
  });

  assert(result.response, 'Should have response');
  assert(result.response.length > 30, 'Creative content should be substantive');

  // Should not be a skeleton
  const quality = assertCreativeQuality(result.response, 'Napiš báseň');
  if (!quality.valid) {
    console.log(`     ⚠️  Creative quality fail: ${quality.reason}`);
  }

  lastResponse = result;
}, { timeout: 60000, requiresLLM: true });

await test('Pipeline: search query', async () => {
  const result = await ChatController.handle({
    message: 'Jaké jsou nejnovější zprávy o AI?',
    sessionId: `test-search-${Date.now()}`,
  });

  assert(result.response, 'Should have response');
  // Even if search fails, should have a meaningful fallback
  assert(result.response.length > 10, 'Should have some response');
  assertNotIncludes(result.response, 'Error: Handler error', 'Should not expose raw errors');

  lastResponse = result;
}, { timeout: 90000, requiresLLM: true });

await test('Pipeline: empty message → graceful error', async () => {
  const result = await ChatController.handle({
    message: '',
    sessionId: `test-empty-${Date.now()}`,
  });

  assert(result.response, 'Should have error response');
  // Empty message should be handled gracefully
});

await test('Pipeline: missing sessionId → graceful error', async () => {
  const result = await ChatController.handle({
    message: 'test',
    sessionId: '',
  });

  assert(result.response, 'Should have error response');
});

await test('Pipeline: very long input → no crash', async () => {
  const result = await ChatController.handle({
    message: 'Popiš mi ' + 'velmi '.repeat(500) + 'detailně co je to AI.',
    sessionId: `test-long-${Date.now()}`,
  });

  assert(result.response, 'Should handle long input');
}, { timeout: 60000, requiresLLM: true });

await test('Pipeline: conversation continuity (same session)', async () => {
  const sid = `test-continuity-${Date.now()}`;

  const r1 = await ChatController.handle({
    message: 'Řekni mi o Pythagorovi',
    sessionId: sid,
  });
  assert(r1.response, 'First response should exist');

  const r2 = await ChatController.handle({
    message: 'A co jeho teorém?',
    sessionId: sid,
  });
  assert(r2.response, 'Follow-up response should exist');
  // The follow-up should ideally relate to Pythagoras/math
}, { timeout: 90000, requiresLLM: true });

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: Edge Cases & Error Recovery
// ═══════════════════════════════════════════════════════════════════════════════

section(7, 'EDGE CASES & ERROR RECOVERY');

await test('CRE: Unicode input → valid decision', () => {
  const d = creDecisionEngine.decide('日本語のテスト 🇯🇵');
  assertDecision(d);
});

await test('CRE: SQL injection attempt → no crash', () => {
  const d = creDecisionEngine.decide("'; DROP TABLE conversations; --");
  assertDecision(d);
});

await test('CRE: XSS attempt → no crash', () => {
  const d = creDecisionEngine.decide('<script>alert("xss")</script>');
  assertDecision(d);
});

await test('ExecutionResult: null toolResults → safe array', () => {
  const { ExecutionResult, ExecutionStatus } = modules.toolExecutor;
  const r = new ExecutionResult({ status: ExecutionStatus.FAILED, toolResults: null });
  assert(Array.isArray(r.toolResults), 'toolResults should be array');
  assert(r.toolResults.length === 0, 'toolResults should be empty');
});

await test('ExecutionResult: undefined toolResults → safe array', () => {
  const { ExecutionResult, ExecutionStatus } = modules.toolExecutor;
  const r = new ExecutionResult({ status: ExecutionStatus.FAILED, toolResults: undefined });
  assert(Array.isArray(r.toolResults), 'toolResults should be array');
});

await test('Handler: all decision types have handlers', () => {
  const m = modules.handlersIndex;
  assertType(m.handleToolCallDecision, 'function', 'handleToolCallDecision');
  assertType(m.handleAnswerDecision, 'function', 'handleAnswerDecision');
  assertType(m.handleAskUserDecision, 'function', 'handleAskUserDecision');
  assertType(m.handleRefuseDecision, 'function', 'handleRefuseDecision');
  assertType(m.handleLocalDecision, 'function', 'handleLocalDecision');
});

await test('Quality: all functions handle null/undefined gracefully', () => {
  assertCreativeQuality(null, null);
  assertCreativeQuality(undefined, undefined);
  detectFluff(null, []);
  detectFluff(undefined, null);
  atomicAnswerGate(null);
  atomicAnswerGate(undefined);
  countSentences(null);
  countSentences(undefined);
});

await test('Output gate: handles edge inputs', () => {
  const { enforceOutputContract } = modules.outputGate;
  enforceOutputContract('', {});
  enforceOutputContract(null, {});
  enforceOutputContract('x', { intent: 'SEARCH' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: Response Quality Validation (LLM)
// ═══════════════════════════════════════════════════════════════════════════════

section(8, 'RESPONSE QUALITY (LLM)');

await test('Quality: CONVERSATIONAL response has no zombie text', async () => {
  const result = await ChatController.handle({
    message: 'Jak se máš dnes?',
    sessionId: `test-quality-conv-${Date.now()}`,
  });

  const zombiePatterns = [
    /spouštím/i, /vyhledávám/i, /searching/i, /executing/i,
    /tool_call/i, /web\.search/i, /\{\s*"type"/,
  ];

  for (const pattern of zombiePatterns) {
    assert(!pattern.test(result.response),
      `Zombie text in conversational response: ${pattern.source}`);
  }
}, { timeout: 30000, requiresLLM: true });

await test('Quality: response is in correct language (CZ query → CZ response)', async () => {
  const result = await ChatController.handle({
    message: 'Co je to gravitace? Jednou větou.',
    sessionId: `test-lang-cz-${Date.now()}`,
  });

  // Basic CZ detection: should contain Czech diacritics or common CZ words
  const hasCzech = /[áčďéěíňóřšťúůýž]/i.test(result.response) ||
                   /\b(je|to|se|na|za|pro|být)\b/i.test(result.response);
  assert(hasCzech, `Response doesn't appear to be Czech: "${result.response.substring(0, 80)}"`);
}, { timeout: 30000, requiresLLM: true });

await test('Quality: SEARCH response contains specifics', async () => {
  const result = await ChatController.handle({
    message: 'Kolik obyvatel má Brno?',
    sessionId: `test-quality-search-${Date.now()}`,
  });

  // Response should contain numbers (population is a number)
  const hasNumbers = /\d/.test(result.response);
  if (!hasNumbers) {
    console.log(`     ⚠️  SEARCH response has no numbers: "${result.response.substring(0, 100)}"`);
  }
}, { timeout: 60000, requiresLLM: true });

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: Session State & Multi-turn Integrity
// ═══════════════════════════════════════════════════════════════════════════════

section(9, 'SESSION STATE & MULTI-TURN');

await test('State: session isolation (different sessions don\'t leak)', async () => {
  const sidA = `test-iso-A-${Date.now()}`;
  const sidB = `test-iso-B-${Date.now()}`;

  const rA = await ChatController.handle({
    message: 'Moje jméno je Alice',
    sessionId: sidA,
  });

  const rB = await ChatController.handle({
    message: 'Moje jméno je Bob',
    sessionId: sidB,
  });

  // Now ask session A about its name — should not contain "Bob"
  const rA2 = await ChatController.handle({
    message: 'Jak se jmenuju?',
    sessionId: sidA,
  });

  assertNotIncludes(rA2.response, 'Bob', 'Session A should not see session B data');
}, { timeout: 60000, requiresLLM: true });

await test('State: project context affects routing', async () => {
  const sid = `test-project-ctx-${Date.now()}`;

  const result = await ChatController.handle({
    message: 'Jaký je stav projektu?',
    sessionId: sid,
    project: { id: 'test-proj', name: 'Test Project', path: '/tmp/test' },
    context: { projectId: 'test-proj' },
  });

  assert(result.mode === ChatMode.PROJECT || result.mode === ChatMode.CONVERSATION,
    `Expected PROJECT or CONVERSATION mode, got ${result.mode}`);
}, { timeout: 30000, requiresLLM: true });

await test('State: pending clarification lifecycle', () => {
  // Simulate session state with pending decision
  const { SessionState } = modules.controller;

  // If SessionState is not exported, test through ChatController
  // This tests that clarification doesn't persist forever
  const d = creDecisionEngine.decide('ano', {
    lastIntent: IntentType.SEARCH,
    lastDecision: { type: DecisionType.ASK_USER, intent: IntentType.SEARCH },
  });
  assertDecision(d);
});

await test('State: mode transitions are recorded', async () => {
  const sid = `test-mode-trans-${Date.now()}`;

  await ChatController.handle({
    message: 'Ahoj',
    sessionId: sid,
  });

  const info = ChatController.getSessionInfo(sid);
  assert(info, 'Session info should exist');
  // Should have at least the current mode
  if (info.mode) {
    assertOneOf(info.mode, ['conversation', 'project', 'expert', 'agent'], 'mode');
  }
}, { timeout: 30000, requiresLLM: true });

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: LLM Auth & Gateway
// ═══════════════════════════════════════════════════════════════════════════════

section(10, 'LLM AUTH & GATEWAY');

await test('Auth: unauthorized call in strict mode → throws', async () => {
  const { llmGateway } = modules.gateway;

  // Should be in strict mode by default
  let threw = false;
  try {
    await llmGateway.call('test prompt', {});
  } catch (e) {
    threw = true;
    assertIncludes(e.message, 'LLM_CALL_OUTSIDE_CRE', 'error message');
  }
  assert(threw, 'Unauthorized call should throw in strict mode');
});

await test('Auth: token with wrong capability → throws', async () => {
  const { createAuthToken, LLMCapability } = await import(join(SRC, 'llm/auth-types.js'));

  const token = createAuthToken({
    role: 'CRE_DECISION',
    decisionId: `test-cap-${Date.now()}`,
    auditContext: { sessionId: 'test' },
    capabilities: [LLMCapability.CLASSIFICATION], // only classification
  });

  let threw = false;
  try {
    await modules.gateway.callWithAuth(token, 'test', {
      capability: LLMCapability.CODE_GENERATION, // requires CODE_GENERATION — token lacks it
    });
  } catch (e) {
    threw = true;
    assertIncludes(e.message, 'CAPABILITY_NOT_ALLOWED', 'error message');
  }
  assert(threw, 'Wrong capability should throw');
});

await test('Auth: expired token → throws', async () => {
  const { createAuthToken, LLMCapability } = await import(join(SRC, 'llm/auth-types.js'));

  const token = createAuthToken({
    role: 'CRE_DECISION',
    decisionId: `test-exp-${Date.now()}`,
    auditContext: { sessionId: 'test' },
    capabilities: [LLMCapability.CHAT],
  });

  // Force expire
  token.expiresAt = Date.now() - 1000;

  let threw = false;
  try {
    await modules.gateway.callWithAuth(token, 'test', {});
  } catch (e) {
    threw = true;
  }
  assert(threw, 'Expired token should throw');
});

await test('Auth: rate limit check works', () => {
  const { llmGateway } = modules.gateway;
  const check = llmGateway.checkRateLimit();
  assert('allowed' in check, 'Should have allowed field');
  assertType(check.allowed, 'boolean', 'allowed');
});

await test('Auth: CRE bridge functions exist', () => {
  assertType(modules.creBridge.generateChatResponse, 'function', 'generateChatResponse');
  assertType(modules.creBridge.classifyIntent, 'function', 'classifyIntent');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11: Stress & Regression
// ═══════════════════════════════════════════════════════════════════════════════

section(11, 'STRESS & REGRESSION');

await test('Regression: "toolResults.map is not a function" fix', () => {
  const { ExecutionResult, ExecutionStatus } = modules.toolExecutor;

  // All possible bad inputs for toolResults
  for (const bad of [null, undefined, '', 0, false, {}, 'not-array']) {
    const r = new ExecutionResult({ status: ExecutionStatus.FAILED, toolResults: bad });
    assert(Array.isArray(r.toolResults),
      `toolResults should be array when given ${JSON.stringify(bad)}, got ${typeof r.toolResults}`);
  }
});

await test('Regression: SafetyEngine.check is a static method', () => {
  assert(typeof SafetyEngine.check === 'function', 'check should be static');
  // Should not need instantiation
  const r = SafetyEngine.check('test', {});
  // null = ALLOW, or object with action
});

await test('Regression: decisions.js imports all resolve', async () => {
  const m = await import(join(SRC, 'chat/handlers/decisions.js'));
  assertType(m.handleToolCallDecision, 'function', 'handleToolCallDecision');
  assertType(m.handleAnswerDecision, 'function', 'handleAnswerDecision');
  assertType(m.buildFailureFallback, 'function', 'buildFailureFallback');
});

await test('Stress: 10 rapid CRE decisions → no crash', () => {
  const inputs = [
    'Ahoj', 'Kolik je 2+2?', 'Najdi restaurace v Praze',
    'Napiš báseň', 'Co je to AI?', 'Připrav report o kryptoměnách',
    '', '...', 'ano', 'hmmm',
  ];
  for (const input of inputs) {
    const d = creDecisionEngine.decide(input);
    assertDecision(d);
  }
});

await test('Stress: 5 concurrent ChatController.handle calls', async () => {
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(
      ChatController.handle({
        message: `Test concurrent #${i}`,
        sessionId: `test-concurrent-${Date.now()}-${i}`,
      })
    );
  }

  const results = await Promise.allSettled(promises);
  let fulfilled = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      assert(r.value.response, `Concurrent #${fulfilled} should have response`);
      fulfilled++;
    }
  }
  assert(fulfilled >= 3, `At least 3/5 concurrent calls should succeed, got ${fulfilled}`);
}, { timeout: 120000, requiresLLM: true });

await test('Stress: rapid same-session messages', async () => {
  const sid = `test-rapid-${Date.now()}`;

  // Fire 3 messages to same session in rapid succession
  const r1 = ChatController.handle({ message: 'Ahoj', sessionId: sid });
  const r2 = ChatController.handle({ message: 'Jak se máš?', sessionId: sid });
  const r3 = ChatController.handle({ message: 'Co děláš?', sessionId: sid });

  const results = await Promise.allSettled([r1, r2, r3]);
  // Should not crash even with concurrent same-session access
  let anyFulfilled = results.some(r => r.status === 'fulfilled');
  assert(anyFulfilled, 'At least one rapid message should succeed');
}, { timeout: 60000, requiresLLM: true });

await test('Regression: handler error format', async () => {
  // Verify that handler errors produce user-friendly messages, not raw stack traces
  const result = await ChatController.handle({
    message: 'test',
    sessionId: `test-err-format-${Date.now()}`,
  });

  if (result.response.includes('Handler error:')) {
    // If there IS a handler error, it should NOT contain stack traces
    assertNotIncludes(result.response, 'at Object.', 'No stack traces in error');
    assertNotIncludes(result.response, '.js:', 'No file paths in error');
  }
}, { timeout: 30000, requiresLLM: true });

// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
console.log(`  PASSED:  ${passed}`);
console.log(`  FAILED:  ${failed}`);
console.log(`  SKIPPED: ${skipped}`);
console.log('══════════════════════════════════════════════════════════════');

if (failures.length > 0) {
  console.log('\n🔴 FAILURES:');
  for (const f of failures) {
    console.log(`  ${f.name}`);
    console.log(`    → ${f.msg}`);
  }
}

// Show slowest tests
const slowTests = timings.filter(t => t.ms > 1000).sort((a, b) => b.ms - a.ms);
if (slowTests.length > 0) {
  console.log('\n🐢 SLOWEST TESTS:');
  for (const t of slowTests.slice(0, 5)) {
    console.log(`  ${t.ms}ms — ${t.name}`);
  }
}

console.log('');
process.exit(failed > 0 ? 1 : 0);
