#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// C3 Agent — Chat Quality Tests (CQT) v56.2
// ═══════════════════════════════════════════════════════════════════════════════
//
// NOT correctness tests. These test whether responses are *acceptable*.
//
// Categories:
//   A) Factual Quality    — answer has substance, not deflection
//   B) Conversational     — social tone, not a lecture
//   C) Follow-up          — topic continuity across turns
//   D) Search Failure     — graceful degradation when search returns nothing
//   E) Zombie/Meta        — no LLM garbage in output
//   F) Language Match     — response language matches input language
//   G) Response Structure — appropriate length, no preamble spam
//
// Usage:
//   node src/test/chat-quality.test.js              # all tests
//   node src/test/chat-quality.test.js --section 2  # specific section
//
// Requirements:
//   - Ollama running on localhost:11434
//   - ChatController configured (run after chat-integration.js passes)
//
// ═══════════════════════════════════════════════════════════════════════════════

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { installOllamaLoopbackFetchBoundary } from './helpers/ollama-loopback-fetch-boundary.js';

installOllamaLoopbackFetchBoundary({ reportOnExit: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = join(__dirname, '..', 'src');

const args = process.argv.slice(2);
const SECTION_ONLY = args.includes('--section') ? parseInt(args[args.indexOf('--section') + 1]) : null;

// ═══════════════════════════════════════════════════════════════════════════════
// TEST FRAMEWORK (same as chat-integration.js)
// ═══════════════════════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;
let warnings = 0;
const failures = [];
const warningList = [];
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
  console.log(`     → ${msg.substring(0, 300)}`);
}

function warn(name, detail) {
  warnings++;
  warningList.push({ name, detail });
  console.log(`  ⚠️  ${name}: ${detail}`);
}

async function test(name, fn, { timeout = 60000 } = {}) {
  if (SECTION_ONLY && currentSection !== SECTION_ONLY) return;
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

// ═══════════════════════════════════════════════════════════════════════════════
// QUALITY PREDICATES — the core of CQT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Evaluate response quality. Returns a structured quality report.
 * Every check is binary, regex-based, deterministic.
 */
function qualityCheck(response, input, opts = {}) {
  const r = typeof response === 'string' ? response : '';
  const len = r.length;
  const sentences = r.split(/[.!?]+/).filter(s => s.trim().length > 3).length;
  const words = r.split(/\s+/).filter(w => w.length > 0).length;

  return {
    // Basic
    hasContent: len > 0,
    hasSubstance: len > 20 && sentences >= 1,
    wordCount: words,
    sentenceCount: sentences,

    // Zombie / meta detection
    hasZombieText: /spouštím|vyhledávám|executing|searching|tool_call|web\.search|\{"type"/i.test(r),
    hasMetaPreamble: /^(rád bych|dovolte mi|jako (ai|jazykový model)|je důležité (si |)uvědomit|based on (my|the)|I('d| would) (like|love) to|let me|here'?s what)/i.test(r),
    hasDeflection: /bohužel (nemám|nemohu|nejsem)|unfortunately|I (cannot|can't|don't have)|nemohu (vám |)poskytnout|nemám přístup|I('m| am) (just |)(an? )?(AI|language model)|jako umělá inteligence/i.test(r),
    hasApology: /omlouvám se|promiňte|I('m| am) sorry|apolog/i.test(r),
    hasRawJSON: /\{\s*"(type|intent|tools|query)"/i.test(r),
    hasInternalLabels: /(TOOL_CALL|ASK_USER|AMBIGUOUS|SEARCH|CONVERSATIONAL|CREATIVE|FACTUAL)/i.test(r),
    hasExpertHijack: /vyber experta|expert.*nabíd|odbornou konzultaci/i.test(r),

    // Language
    hasCzech: /[áčďéěíňóřšťúůýž]/i.test(r) || /\b(je|to|se|na|za|pro|být|jako|ale|nebo)\b/i.test(r),
    hasEnglish: /\b(the|is|are|was|have|has|this|that|with|from|about)\b/i.test(r),
    hasSlovak: /[ľôäŕĺ]/i.test(r) || /\b(je|nie|áno|alebo|prečo|kto)\b/i.test(r),
    hasGerman: /[äöüß]/i.test(r) || /\b(ist|und|oder|nicht|der|die|das)\b/i.test(r),

    // Structural
    hasNumbers: /\d/.test(r),
    hasProperNouns: /[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]{2,}/.test(r),
    startsWithContent: !/^\s*(Ah|Oh|Hmm|Well|So|Takže|No|Tedy|Ehm)\b/i.test(r),
    hasExcessiveHeaders: (r.match(/^#{1,3}\s/gm) || []).length > 3,
    hasExcessiveBullets: (r.match(/^[\-\*•]\s/gm) || []).length > 5,

    // Response-specific
    isQuestion: /\?\s*$/.test(r.trim()),
    mentionsEntity: opts.entity ? new RegExp(opts.entity, 'i').test(r) : null,
    matchesExpectedLang: opts.expectedLang === 'cs' ? (/[áčďéěíňóřšťúůýž]/i.test(r) || /\b(je|to|se|na)\b/i.test(r))
                       : opts.expectedLang === 'en' ? /\b(the|is|are|was|have)\b/i.test(r)
                       : opts.expectedLang === 'sk' ? /[ľôäŕĺ]/i.test(r) || /\b(je|nie|áno|alebo)\b/i.test(r)
                       : opts.expectedLang === 'de' ? /[äöüß]/i.test(r) || /\b(ist|und|oder|nicht)\b/i.test(r)
                       : null,
  };
}

/**
 * Assert quality predicate with clear error message.
 */
function assertQuality(q, predicate, msg) {
  if (!q[predicate]) {
    throw new Error(`Quality check failed: ${predicate} — ${msg}`);
  }
}

function assertNoQuality(q, predicate, msg) {
  if (q[predicate]) {
    throw new Error(`Quality anti-check failed: ${predicate} — ${msg}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT HELPER — wraps ChatController.handle with quality analysis
// ═══════════════════════════════════════════════════════════════════════════════

let ChatController, ChatMode;

async function chat(message, opts = {}) {
  const sid = opts.sessionId || `cqt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const result = await ChatController.handle({
    message,
    sessionId: sid,
    ...(opts.project ? { project: opts.project, context: { projectId: opts.project.id } } : {}),
  });

  const q = qualityCheck(result.response, message, opts);
  return { ...result, quality: q, sessionId: sid };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRELOAD
// ═══════════════════════════════════════════════════════════════════════════════

console.log('🔧 Loading modules...');

try {
  const controllerModule = await import(join(SRC, 'chat/controller.js'));
  ChatController = controllerModule.ChatController;
  ChatMode = controllerModule.ChatMode;

  const { getDefaultHandlers } = await import(join(SRC, 'chat/handlers/index.js'));
  ChatController.configure({ handlers: getDefaultHandlers() });
  console.log('  ✅ ChatController loaded and configured');
} catch (e) {
  console.error(`  ❌ Failed to load modules: ${e.message}`);
  process.exit(1);
}

// Check Ollama
try {
  const resp = await fetch('http://localhost:11434/api/tags');
  const data = await resp.json();
  const modelCount = data.models?.length || 0;
  console.log(`  ✅ Ollama running (${modelCount} models)`);
} catch {
  console.error('  ❌ Ollama not running — all quality tests require LLM');
  process.exit(1);
}

console.log('\n════════════════════════════════════════════════════════════');
console.log('  CHAT QUALITY TESTS (CQT) — Testing response acceptability');
console.log('════════════════════════════════════════════════════════════');

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: FACTUAL QUALITY
// ═══════════════════════════════════════════════════════════════════════════════
// Does the response contain actual information, or is it deflection?

section(1, 'FACTUAL QUALITY');

await test('Factual: biography query has substance', async () => {
  const { quality, response } = await chat('Kdo byl Albert Einstein?', { entity: 'Einstein', expectedLang: 'cs' });
  assertQuality(quality, 'hasSubstance', 'Response too short or empty');
  assertNoQuality(quality, 'hasZombieText', 'Contains zombie/debug text');
  assertNoQuality(quality, 'hasDeflection', 'Should not deflect on a simple biography');
  assertNoQuality(quality, 'hasRawJSON', 'Contains raw JSON');
  assert(quality.mentionsEntity, `Response doesn't mention "Einstein": "${response.substring(0, 100)}"`);
}, { timeout: 60000 });

await test('Factual: population query has numbers', async () => {
  const { quality, response } = await chat('Kolik obyvatel má Praha?', { expectedLang: 'cs' });
  assertQuality(quality, 'hasSubstance', 'Response too short');
  assertNoQuality(quality, 'hasDeflection', 'Should not deflect on factual query');
  // Numbers are expected but search might fail — warn, don't fail
  if (!quality.hasNumbers) {
    warn('Factual: population → numbers', `No numbers found: "${response.substring(0, 100)}"`);
  }
}, { timeout: 60000 });

await test('Factual: definition query is concise', async () => {
  const { quality, response } = await chat('Co je to gravitace? Jednou větou.', { expectedLang: 'cs' });
  assertQuality(quality, 'hasContent', 'Empty response');
  assertNoQuality(quality, 'hasMetaPreamble', `Starts with meta-preamble: "${response.substring(0, 60)}"`);
  // Conciseness check: user asked for one sentence
  if (quality.sentenceCount > 3) {
    warn('Factual: conciseness', `Asked for 1 sentence, got ${quality.sentenceCount}`);
  }
}, { timeout: 60000 });

await test('Factual: technical query has proper nouns', async () => {
  const { quality, response } = await chat('Jak funguje DNS?', { expectedLang: 'cs' });
  assertQuality(quality, 'hasSubstance', 'Response too short');
  assertNoQuality(quality, 'hasZombieText', 'Contains zombie text');
  if (!quality.hasProperNouns) {
    warn('Factual: DNS → proper nouns', `Expected technical terms: "${response.substring(0, 100)}"`);
  }
}, { timeout: 60000 });

await test('Factual: EN query gets EN response', async () => {
  const { quality, response } = await chat('What is photosynthesis?', { expectedLang: 'en' });
  assertQuality(quality, 'hasSubstance', 'Response too short');
  assertNoQuality(quality, 'hasExpertHijack', 'ExpertHandler hijacked EN query');
  assert(quality.matchesExpectedLang, `Expected English response: "${response.substring(0, 100)}"`);
}, { timeout: 60000 });

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: CONVERSATIONAL QUALITY
// ═══════════════════════════════════════════════════════════════════════════════
// Chat should feel like a conversation, not a search engine.

section(2, 'CONVERSATIONAL QUALITY');

await test('Conv: greeting gets greeting', async () => {
  const { quality, response } = await chat('Ahoj!');
  assertQuality(quality, 'hasContent', 'Empty response to greeting');
  assertNoQuality(quality, 'hasZombieText', 'Zombie in greeting response');
  assertNoQuality(quality, 'hasRawJSON', 'JSON in greeting response');
  // Greeting should be SHORT (not a lecture)
  if (quality.wordCount > 50) {
    warn('Conv: greeting length', `Greeting response too long (${quality.wordCount} words)`);
  }
}, { timeout: 30000 });

await test('Conv: "Díky" gets acknowledgment, not lecture', async () => {
  const { quality, response } = await chat('Díky');
  assertQuality(quality, 'hasContent', 'Empty response');
  if (quality.sentenceCount > 3) {
    warn('Conv: thanks verbosity', `"Díky" got ${quality.sentenceCount} sentences — too verbose`);
  }
}, { timeout: 30000 });

await test('Conv: "OK" gets brief response', async () => {
  const { quality, response } = await chat('OK');
  assertQuality(quality, 'hasContent', 'Empty response');
  if (quality.wordCount > 40) {
    warn('Conv: OK verbosity', `"OK" got ${quality.wordCount} words`);
  }
}, { timeout: 30000 });

await test('Conv: casual question gets casual answer', async () => {
  const { quality, response } = await chat('Jak se máš?');
  assertQuality(quality, 'hasContent', 'Empty response');
  assertNoQuality(quality, 'hasZombieText', 'Zombie in casual response');
  // Should NOT start searching the web for "jak se máš"
  assertNoQuality(quality, 'hasInternalLabels', 'Leaking internal labels');
}, { timeout: 30000 });

await test('Conv: opinion question stays conversational', async () => {
  const { quality, response } = await chat('Co si myslíš o Pythonu?');
  assertQuality(quality, 'hasSubstance', 'Response too short for opinion');
  assertNoQuality(quality, 'hasDeflection', 'Deflecting on opinion question');
  assertNoQuality(quality, 'hasExcessiveHeaders', 'Headers in casual opinion');
}, { timeout: 60000 });

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: FOLLOW-UP CONTINUITY
// ═══════════════════════════════════════════════════════════════════════════════
// Multi-turn: does the chat maintain topic across messages?

section(3, 'FOLLOW-UP CONTINUITY');

await test('Follow-up: maintains topic across 2 turns', async () => {
  const sid = `cqt-followup-${Date.now()}`;

  const r1 = await chat('Řekni mi o Pythagorovi', { sessionId: sid, entity: 'Pythagoras' });
  assertQuality(r1.quality, 'hasSubstance', 'First response empty');

  const r2 = await chat('A co jeho teorém?', { sessionId: sid, entity: 'Pythagoras|Pythagor|theorem|teorém|trojúhelník' });
  assertQuality(r2.quality, 'hasSubstance', 'Follow-up response empty');

  // Key check: follow-up should reference Pythagoras or math
  const hasContinuity = /pythag|teorém|theorem|trojúhel|přepona|hypoten/i.test(r2.response);
  if (!hasContinuity) {
    warn('Follow-up: topic continuity', `Follow-up doesn't reference Pythagoras: "${r2.response.substring(0, 100)}"`);
  }
}, { timeout: 120000 });

await test('Follow-up: pronoun resolution', async () => {
  const sid = `cqt-pronoun-${Date.now()}`;

  await chat('Albert Einstein byl slavný fyzik.', { sessionId: sid });
  const r2 = await chat('Kdy se narodil?', { sessionId: sid });

  assertQuality(r2.quality, 'hasContent', 'Empty response to pronoun follow-up');
  // Should reference Einstein or birth date/year, not ask "kdo?"
  const resolved = /einstein|1879|narod|born|ulm|německ|german/i.test(r2.response);
  if (!resolved) {
    warn('Follow-up: pronoun resolution', `Didn't resolve "on" to Einstein: "${r2.response.substring(0, 100)}"`);
  }
}, { timeout: 120000 });

await test('Follow-up: topic switch is clean', async () => {
  const sid = `cqt-switch-${Date.now()}`;

  await chat('Co je to gravitace?', { sessionId: sid });
  const r2 = await chat('A teď mi řekni o Praze', { sessionId: sid });

  assertQuality(r2.quality, 'hasSubstance', 'Topic switch response empty');
  // Should talk about Prague, NOT about gravity
  const aboutPrague = /prah|prague|praha|česk|czech|vltav/i.test(r2.response);
  assert(aboutPrague, `Topic switch failed — response doesn't mention Prague: "${r2.response.substring(0, 100)}"`);
}, { timeout: 120000 });

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: SEARCH FAILURE GRACE
// ═══════════════════════════════════════════════════════════════════════════════
// When search returns nothing, the response should still be useful.

section(4, 'SEARCH FAILURE GRACE');

await test('Grace: common knowledge fallback on search failure', async () => {
  // This query will likely search, but even if DDG fails, LLM knows the answer
  const { quality, response } = await chat('Jaká je chemická značka vody?', { expectedLang: 'cs' });
  assertQuality(quality, 'hasContent', 'Empty response');
  // Even without search, LLM should know H2O
  const hasAnswer = /H2O|h₂o|vod[aíy]|kyslík|hydrogen|oxygen/i.test(response);
  if (!hasAnswer) {
    warn('Grace: H2O fallback', `No H2O reference: "${response.substring(0, 100)}"`);
  }
}, { timeout: 60000 });

await test('Grace: no raw error messages in response', async () => {
  // Deliberately long/weird query that might cause issues
  const { quality, response } = await chat('Vysvětli kvantovou provázanost jednoduchými slovy');
  assertQuality(quality, 'hasContent', 'Empty response');
  assertNoQuality(quality, 'hasRawJSON', 'Raw JSON exposed to user');
  assertNoQuality(quality, 'hasInternalLabels', 'Internal labels exposed');

  // No raw error strings
  const noErrors = !/Error:|TypeError:|undefined is not|Cannot read/i.test(response);
  assert(noErrors, `Raw error in response: "${response.substring(0, 150)}"`);
}, { timeout: 60000 });

await test('Grace: no "zkus to jinak" on failed search', async () => {
  // Obscure query likely to get no DDG results
  const { quality, response } = await chat('Jaká byla průměrná teplota ve Žďáru nad Sázavou v lednu 1987?');
  assertQuality(quality, 'hasContent', 'Empty response');

  // Should NOT say "zkus to jinak" / "try again" / "nemůžu najít"
  const hasUselessDeflection = /zkus(te|) to (jinak|znovu)|try (again|differently)|nemůžu (to |)najít|could not find/i.test(response);
  if (hasUselessDeflection) {
    warn('Grace: useless deflection', `Response deflects: "${response.substring(0, 100)}"`);
  }
}, { timeout: 60000 });

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: ZOMBIE & META DETECTION
// ═══════════════════════════════════════════════════════════════════════════════
// LLM should never leak internal system state to the user.

section(5, 'ZOMBIE & META DETECTION');

await test('Zombie: no tool execution traces', async () => {
  const { quality } = await chat('Kolik je hodin v Tokiu?');
  assertNoQuality(quality, 'hasZombieText', 'Tool execution traces leaked');
  assertNoQuality(quality, 'hasRawJSON', 'Raw JSON leaked');
}, { timeout: 60000 });

await test('Zombie: no "jako AI" self-identification', async () => {
  const { response } = await chat('Pomoz mi napsat email');
  const aiSelfRef = /jako (AI|umělá inteligence|jazykový model)|I('m| am) (an? )?(AI|language model|artificial)/i.test(response);
  if (aiSelfRef) {
    warn('Zombie: AI self-ref', `Unnecessary AI self-identification: "${response.substring(0, 100)}"`);
  }
}, { timeout: 60000 });

await test('Zombie: no intent labels in output', async () => {
  const { quality } = await chat('Najdi informace o SpaceX');
  assertNoQuality(quality, 'hasInternalLabels', 'Internal intent labels visible to user');
}, { timeout: 60000 });

await test('Zombie: creative request has no meta-commentary', async () => {
  const { quality, response } = await chat('Napiš haiku o kávě');
  assertQuality(quality, 'hasContent', 'Empty creative response');
  assertNoQuality(quality, 'hasMetaPreamble', `Creative starts with meta: "${response.substring(0, 60)}"`);
  // Haiku should be short — if response is huge, it's probably wrapped in commentary
  if (quality.wordCount > 80) {
    warn('Zombie: creative verbosity', `Haiku request got ${quality.wordCount} words (expected ~20)`);
  }
}, { timeout: 60000 });

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: LANGUAGE MATCH
// ═══════════════════════════════════════════════════════════════════════════════
// Response language should match input language.

section(6, 'LANGUAGE MATCH');

await test('Lang: CZ input → CZ response', async () => {
  const { quality, response } = await chat('Vysvětli mi co je to fotosyntéza', { expectedLang: 'cs' });
  assertQuality(quality, 'hasSubstance', 'Response too short');
  assert(quality.matchesExpectedLang, `CZ query got non-CZ response: "${response.substring(0, 100)}"`);
}, { timeout: 60000 });

await test('Lang: EN input → EN response', async () => {
  const { quality, response } = await chat('Explain how a combustion engine works', { expectedLang: 'en' });
  assertNoQuality(quality, 'hasExpertHijack', 'ExpertHandler hijacked EN query');
  assertQuality(quality, 'hasSubstance', 'Response too short');
  assert(quality.matchesExpectedLang, `EN query got non-EN response: "${response.substring(0, 100)}"`);
}, { timeout: 60000 });

await test('Lang: SK input → SK/CZ response (acceptable)', async () => {
  const { quality, response } = await chat('Čo je to kvantová fyzika?', { expectedLang: 'cs' });
  // Slovak input → Slovak or Czech response both acceptable
  assertQuality(quality, 'hasSubstance', 'Response too short');
  const slavicResponse = /[áčďéěíňóřšťúůýžľôäŕĺ]/i.test(response);
  assert(slavicResponse, `SK query got non-Slavic response: "${response.substring(0, 100)}"`);
}, { timeout: 60000 });

await test('Lang: DE input → DE response', async () => {
  const { quality, response } = await chat('Was ist Quantenphysik?', { expectedLang: 'de' });
  assertNoQuality(quality, 'hasExpertHijack', 'ExpertHandler hijacked DE query');
  assertQuality(quality, 'hasSubstance', 'Response too short');
  assert(quality.matchesExpectedLang, `DE query got non-DE response: "${response.substring(0, 100)}"`);
}, { timeout: 60000 });

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: RESPONSE STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════════
// Formatting should match intent — no bullet lists for simple answers.

section(7, 'RESPONSE STRUCTURE');

await test('Structure: simple question → no headers/bullets', async () => {
  const { quality, response } = await chat('Kolik je 2+2?');
  assertQuality(quality, 'hasContent', 'Empty response');
  assertNoQuality(quality, 'hasExcessiveHeaders', `Simple math got headers: "${response.substring(0, 100)}"`);
  assertNoQuality(quality, 'hasExcessiveBullets', `Simple math got bullet list: "${response.substring(0, 100)}"`);
}, { timeout: 30000 });

await test('Structure: greeting → no lecture', async () => {
  const { quality } = await chat('Dobrý den');
  if (quality.sentenceCount > 4) {
    warn('Structure: greeting lecture', `Greeting got ${quality.sentenceCount} sentences`);
  }
}, { timeout: 30000 });

await test('Structure: factual → starts with content, not preamble', async () => {
  const { quality, response } = await chat('Hlavní město Francie?');
  assertQuality(quality, 'hasContent', 'Empty response');
  assertNoQuality(quality, 'hasMetaPreamble', `Starts with meta: "${response.substring(0, 60)}"`);
  assertQuality(quality, 'startsWithContent', `Starts with filler: "${response.substring(0, 40)}"`);
}, { timeout: 30000 });

await test('Structure: knowledge request → proportional length', async () => {
  const { quality } = await chat('Řekni mi o Pythagorovi');
  assertQuality(quality, 'hasSubstance', 'Response too short for knowledge request');
  // Should be meaningful but not a 2000-word essay
  if (quality.wordCount > 300) {
    warn('Structure: knowledge verbosity', `Knowledge response: ${quality.wordCount} words (expected 50-200)`);
  }
  if (quality.wordCount < 20) {
    warn('Structure: knowledge too brief', `Knowledge response: ${quality.wordCount} words (expected 50-200)`);
  }
}, { timeout: 60000 });

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: EDGE QUALITY
// ═══════════════════════════════════════════════════════════════════════════════
// Edge inputs that frequently produce bad quality.

section(8, 'EDGE QUALITY');

await test('Edge: ambiguous single word → no crash, has response', async () => {
  const { quality } = await chat('Python');
  assertQuality(quality, 'hasContent', 'Empty response to ambiguous input');
  assertNoQuality(quality, 'hasZombieText', 'Zombie on ambiguous input');
}, { timeout: 30000 });

await test('Edge: emoji input → handled gracefully', async () => {
  const { quality } = await chat('👋');
  assertQuality(quality, 'hasContent', 'Empty response to emoji');
}, { timeout: 30000 });

await test('Edge: very short input → no crash', async () => {
  const { quality } = await chat('?');
  assertQuality(quality, 'hasContent', 'Empty response to "?"');
}, { timeout: 30000 });

await test('Edge: mixed lang input → coherent response', async () => {
  const { quality, response } = await chat('Explain mi prosím what is AI');
  assertQuality(quality, 'hasContent', 'Empty response');
  assertNoQuality(quality, 'hasZombieText', 'Zombie on mixed-lang');
  assertNoQuality(quality, 'hasRawJSON', 'JSON on mixed-lang');
}, { timeout: 60000 });

await test('Edge: instruction-heavy query → clean response', async () => {
  const { quality, response } = await chat('Odpověz stručně česky prosím: co je to DNA?', { expectedLang: 'cs' });
  assertQuality(quality, 'hasContent', 'Empty response');
  assertNoQuality(quality, 'hasZombieText', 'Zombie on instruction query');
  // The instructions themselves should NOT appear in the response
  const echoesInstructions = /odpověz stručně česky prosím/i.test(response);
  assert(!echoesInstructions, `Response echoes instructions: "${response.substring(0, 100)}"`);
}, { timeout: 60000 });

// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log(`  PASSED:   ${passed}`);
console.log(`  FAILED:   ${failed}`);
console.log(`  WARNINGS: ${warnings}`);
console.log('════════════════════════════════════════════════════════════');

if (failures.length > 0) {
  console.log('\n🔴 FAILURES:');
  for (const f of failures) {
    console.log(`  ${f.name}`);
    console.log(`    → ${f.msg}`);
  }
}

if (warningList.length > 0) {
  console.log('\n🟡 WARNINGS (not failures, but review):');
  for (const w of warningList) {
    console.log(`  ${w.name}`);
    console.log(`    → ${w.detail}`);
  }
}

const top5 = timings.sort((a, b) => b.ms - a.ms).slice(0, 5);
if (top5.length > 0) {
  console.log('\n🐢 SLOWEST TESTS:');
  for (const t of top5) {
    console.log(`  ${t.ms}ms — ${t.name}`);
  }
}

console.log('');
process.exit(failed > 0 ? 1 : 0);
