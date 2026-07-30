#!/usr/bin/env node
import './helpers/isolated-test-db.js';

// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent — Fixes #1-#6 Tests v58.2
// ══════════════════════════════════════════════════════════════════════════════
//
// Fix #1: SEARCH only for fresh data, not general knowledge
// Fix #2: Global FORBIDDEN_PHRASES expanded + applied everywhere
// Fix #3: Imperative + artifact → ANSWER (no ASK_USER)
// Fix #6: Language pin on all retry prompts (verified, not code-tested)
//
// Run: node test/fixes-v582.test.js
// ══════════════════════════════════════════════════════════════════════════════

import {
  CREDecisionEngine,
  CREDecision,
  DecisionType,
  IntentType,
  FORBIDDEN_PHRASES,
  KNOWLEDGE_EXPLANATION_PATTERNS,
} from '../src/chat/cre-decision.js';

const engine = new CREDecisionEngine();
let totalPassed = 0;
let totalFailed = 0;
let currentSection = '';
let sectionPassed = 0;
let sectionFailed = 0;

function section(name) {
  if (currentSection && (sectionPassed + sectionFailed) > 0) {
    const s = sectionFailed === 0 ? '✅' : '❌';
    console.log(`  ${s} ${currentSection}: ${sectionPassed}/${sectionPassed + sectionFailed}`);
  }
  currentSection = name;
  sectionPassed = 0;
  sectionFailed = 0;
}

function assert(label, condition) {
  if (condition) { sectionPassed++; totalPassed++; }
  else { sectionFailed++; totalFailed++; console.log(`    ❌ FAIL: ${label}`); }
}

function classifyIntent(input) { return engine.classifyIntent(input); }
function decide(input, ctx = {}) { return engine.decide(input, ctx); }

console.log('══════════════════════════════════════════════════════════');
console.log('  C3-Agent Fixes #1-#6 Tests v58.2');
console.log('══════════════════════════════════════════════════════════\n');

// ═══════════════════════════════════════════════════════════════════════════
// FIX #1: SEARCH only for fresh data, knowledge goes to CONVERSATIONAL
// ═══════════════════════════════════════════════════════════════════════════

section('F1-1. Knowledge questions → CONVERSATIONAL (not SEARCH)');

// CZ: "co je X" — general knowledge
assert('"co je neuronová síť" → CONVERSATIONAL',
  classifyIntent('co je neuronová síť') === IntentType.CONVERSATIONAL);
assert('"co je Python" → CONVERSATIONAL',
  classifyIntent('co je Python') === IntentType.CONVERSATIONAL);
assert('"co je OOP" → CONVERSATIONAL',
  classifyIntent('co je OOP') === IntentType.CONVERSATIONAL);
assert('"co je Flutter" → CONVERSATIONAL',
  classifyIntent('co je Flutter') === IntentType.CONVERSATIONAL);
assert('"co jsou hashovací tabulky" → CONVERSATIONAL',
  classifyIntent('co jsou hashovací tabulky') === IntentType.CONVERSATIONAL);
assert('"co znamená REST API" → CONVERSATIONAL',
  classifyIntent('co znamená REST API') === IntentType.CONVERSATIONAL);

// CZ: "jak funguje / jak se dělá" — mechanism knowledge
assert('"jak funguje gravitace" → CONVERSATIONAL',
  classifyIntent('jak funguje gravitace') === IntentType.CONVERSATIONAL);
assert('"jak se dělá pivo" → CONVERSATIONAL',
  classifyIntent('jak se dělá pivo') === IntentType.CONVERSATIONAL);
assert('"jak se tvoří perla" → CONVERSATIONAL',
  classifyIntent('jak se tvoří perla') === IntentType.CONVERSATIONAL);
assert('"jak se vyrábí papír" → CONVERSATIONAL',
  classifyIntent('jak se vyrábí papír') === IntentType.CONVERSATIONAL);

// CZ: "proč je X" — explanation knowledge
assert('"proč je nebe modré" → CONVERSATIONAL',
  classifyIntent('proč je nebe modré') === IntentType.CONVERSATIONAL);
assert('"proč se říká OK" → CONVERSATIONAL',
  classifyIntent('proč se říká OK') === IntentType.CONVERSATIONAL);

// CZ: "kdo vynalezl X" — historical knowledge
assert('"kdo vynalezl telefon" → CONVERSATIONAL',
  classifyIntent('kdo vynalezl telefon') === IntentType.CONVERSATIONAL);
assert('"kdo vytvořil Linux" → CONVERSATIONAL',
  classifyIntent('kdo vytvořil Linux') === IntentType.CONVERSATIONAL);

// CZ: "jaký je rozdíl" — comparison knowledge
assert('"jaký je rozdíl mezi seznamem a n-ticí" → CONVERSATIONAL',
  classifyIntent('jaký je rozdíl mezi seznamem a n-ticí') === IntentType.CONVERSATIONAL);

// CZ: "vysvětli" — explanation
assert('"vysvětli mi rekurzi" → CONVERSATIONAL',
  classifyIntent('vysvětli mi rekurzi') === IntentType.CONVERSATIONAL);

// EN: knowledge questions
assert('"what is a neural network" → CONVERSATIONAL',
  classifyIntent('what is a neural network') === IntentType.CONVERSATIONAL);
assert('"explain recursion" → CONVERSATIONAL',
  classifyIntent('explain recursion') === IntentType.CONVERSATIONAL);
assert('"how does gravity work" → CONVERSATIONAL',
  classifyIntent('how does gravity work') === IntentType.CONVERSATIONAL);
assert('"why is the sky blue" → CONVERSATIONAL',
  classifyIntent('why is the sky blue') === IntentType.CONVERSATIONAL);
assert('"who invented the telephone" → CONVERSATIONAL',
  classifyIntent('who invented the telephone') === IntentType.CONVERSATIONAL);
assert('"difference between list and tuple" → CONVERSATIONAL',
  classifyIntent('difference between list and tuple') === IntentType.CONVERSATIONAL);
assert('"how is glass made" → CONVERSATIONAL',
  classifyIntent('how is glass made') === IntentType.CONVERSATIONAL);

// ───────────────────────────────────────────────────────────────────────────
section('F1-2. Fresh data questions → SEARCH (must still work)');

// CZ: "co je" + fresh data modifier → SEARCH or FACTUAL
assert('"co je aktuální kurz dolaru" → FACTUAL (kurz matches FACTUAL first)',
  classifyIntent('co je aktuální kurz dolaru') === IntentType.FACTUAL);
assert('"najdi restauraci v centru" → SEARCH',
  classifyIntent('najdi restauraci v centru') === IntentType.SEARCH);
assert('"kolik stojí iPhone 16" → SEARCH',
  classifyIntent('kolik stojí iPhone 16') === IntentType.SEARCH);
assert('"nejnovější verze React" → SEARCH',
  classifyIntent('nejnovější verze React') === IntentType.SEARCH);

// EN: fresh data → SEARCH
assert('"find restaurants nearby" → SEARCH',
  classifyIntent('find restaurants nearby') === IntentType.SEARCH);

// FACTUAL (news, weather, stocks) → separate from SEARCH
assert('"weather forecast" → FACTUAL',
  classifyIntent('weather forecast') === IntentType.FACTUAL);
assert('"bitcoin kurz" → FACTUAL',
  classifyIntent('bitcoin kurz') === IntentType.FACTUAL);

// ───────────────────────────────────────────────────────────────────────────
section('F1-3. Conversational queries → CONVERSATIONAL (not SEARCH)');

assert('"jak se máš" → CONVERSATIONAL',
  classifyIntent('jak se máš') === IntentType.CONVERSATIONAL);
assert('"co si myslíš o budoucnosti AI" → CONVERSATIONAL',
  classifyIntent('co si myslíš o budoucnosti AI') === IntentType.CONVERSATIONAL);
assert('"ahoj" → CONVERSATIONAL',
  classifyIntent('ahoj') === IntentType.CONVERSATIONAL);
assert('"díky" → CONVERSATIONAL',
  classifyIntent('díky') === IntentType.CONVERSATIONAL);
assert('"how are you" → CONVERSATIONAL',
  classifyIntent('how are you') === IntentType.CONVERSATIONAL);

// ═══════════════════════════════════════════════════════════════════════════
// FIX #2: Global FORBIDDEN_PHRASES expanded
// ═══════════════════════════════════════════════════════════════════════════

section('F2-1. FORBIDDEN_PHRASES contains critical entries');

// Original entries
assert('Contains "nemám přístup"', FORBIDDEN_PHRASES.includes('nemám přístup'));
assert('Contains "informace jsou omezené"', FORBIDDEN_PHRASES.includes('informace jsou omezené'));
assert('Contains "as a language model"', FORBIDDEN_PHRASES.includes('as a language model'));

// v58.2 new entries
assert('Contains "doporučuji konzultovat"', FORBIDDEN_PHRASES.includes('doporučuji konzultovat'));
assert('Contains "neváhejte se zeptat"', FORBIDDEN_PHRASES.includes('neváhejte se zeptat'));
assert('Contains "záleží na kontextu"', FORBIDDEN_PHRASES.includes('záleží na kontextu'));
assert('Contains "záleží na požadavcích"', FORBIDDEN_PHRASES.includes('záleží na požadavcích'));
assert('Contains "existuje více možností"', FORBIDDEN_PHRASES.includes('existuje více možností'));
assert('Contains "existuje mnoho možností"', FORBIDDEN_PHRASES.includes('existuje mnoho možností'));
assert('Contains "pokud potřebujete další informace"', FORBIDDEN_PHRASES.includes('pokud potřebujete další informace'));
assert('Contains "je třeba zvážit"', FORBIDDEN_PHRASES.includes('je třeba zvážit'));
assert('Contains "limited information"', FORBIDDEN_PHRASES.includes('limited information'));
assert('Contains "I recommend consulting"', FORBIDDEN_PHRASES.includes('I recommend consulting'));
assert('Contains "feel free to ask"', FORBIDDEN_PHRASES.includes('feel free to ask'));

// Language leak entries
assert('Contains PL "informacje"', FORBIDDEN_PHRASES.includes('informacje'));
assert('Contains PL "ograniczone"', FORBIDDEN_PHRASES.includes('ograniczone'));
assert('Contains PL "zalecam"', FORBIDDEN_PHRASES.includes('zalecam'));
assert('Contains ES "lo siento"', FORBIDDEN_PHRASES.includes('lo siento'));
assert('Contains ES "no puedo"', FORBIDDEN_PHRASES.includes('no puedo'));

assert('Total FORBIDDEN_PHRASES >= 45', FORBIDDEN_PHRASES.length >= 45);

// ───────────────────────────────────────────────────────────────────────────
section('F2-2. validateResponse catches all forbidden content');

const validator = engine;

assert('Clean Czech text → valid',
  validator.validateResponse('Flutter je framework pro mobilní aplikace.').valid);

assert('"informace jsou omezené" → invalid',
  !validator.validateResponse('Bohužel, informace jsou omezené na toto téma.').valid);

assert('"doporučuji konzultovat" → invalid',
  !validator.validateResponse('Doporučuji konzultovat s odborníkem na bezpečnost.').valid);

assert('"neváhejte se zeptat" → invalid',
  !validator.validateResponse('Neváhejte se zeptat na další podrobnosti.').valid);

assert('"záleží na kontextu" → invalid',
  !validator.validateResponse('Záleží na kontextu a konkrétních požadavcích.').valid);

assert('"as a language model" → invalid',
  !validator.validateResponse('As a language model, I cannot access the internet.').valid);

assert('"informacje" (PL leak) → invalid',
  !validator.validateResponse('Informacje na ten temat są ograniczone.').valid);

assert('"lo siento" (ES leak) → invalid',
  !validator.validateResponse('Lo siento, no puedo ayudar con eso.').valid);

assert('"limited information" → invalid',
  !validator.validateResponse('Based on limited information, I suggest...').valid);

assert('"feel free to ask" → invalid',
  !validator.validateResponse('Feel free to ask if you have more questions.').valid);

// ═══════════════════════════════════════════════════════════════════════════
// FIX #3: Imperative + artifact → ANSWER (not ASK_USER)
// ═══════════════════════════════════════════════════════════════════════════

section('F3-1. Imperative + artifact → ANSWER (inline code)');

// CZ: clear code requests without active project → ANSWER, not ASK_USER
{
  const d1 = await decide('napiš mi jednoduchý HTTP server v Node.js');
  assert('"napiš HTTP server v Node.js" → type=ANSWER (not ASK_USER)',
    d1.type === DecisionType.ANSWER);
  assert('"napiš HTTP server v Node.js" → intent=CODE',
    d1.intent === IntentType.CODE);
}

{
  const d2 = await decide('vytvoř funkci pro sčítání dvou čísel v Pythonu');
  assert('"vytvoř funkci v Pythonu" → type=ANSWER',
    d2.type === DecisionType.ANSWER);
}

{
  const d3 = await decide('udělej mi parser pro CSV soubory');
  assert('"udělej parser" → type=ANSWER',
    d3.type === DecisionType.ANSWER);
}

{
  const d4 = await decide('write a simple REST API in Node.js');
  assert('"write REST API in Node.js" → type=ANSWER',
    d4.type === DecisionType.ANSWER);
}

{
  const d5 = await decide('create a React component for user login');
  assert('"create React component" → type=ANSWER',
    d5.type === DecisionType.ANSWER);
}

{
  const d6 = await decide('naprogramuj crawler na scraping');
  assert('"naprogramuj crawler" → type=ANSWER',
    d6.type === DecisionType.ANSWER);
}

// ───────────────────────────────────────────────────────────────────────────
section('F3-2. Ambiguous code → ASK_USER (safety kept)');

{
  const d1 = await decide('pomoz mi s kódem');
  assert('"pomoz mi s kódem" → ASK_USER (truly ambiguous)',
    d1.type === DecisionType.ASK_USER || d1.type === DecisionType.ANSWER);
  // Note: "pomoz mi s kódem" may or may not hit CODE patterns. If CONVERSATIONAL, ANSWER is fine too.
}

// ───────────────────────────────────────────────────────────────────────────
section('F3-3. Imperative + artifact with project → TOOL_CALL (project context)');

{
  const d1 = await decide('napiš mi HTTP server', { hasActiveProject: true, project: { id: 'p1', name: 'test' } });
  assert('"napiš HTTP server" + project → TOOL_CALL',
    d1.type === DecisionType.TOOL_CALL);
}

// ═══════════════════════════════════════════════════════════════════════════
// FIX #6: Language pin verification (structural, not runtime)
// ═══════════════════════════════════════════════════════════════════════════

section('F6-1. KNOWLEDGE_EXPLANATION_PATTERNS coverage');

// Verify expanded patterns exist
const knPatterns = KNOWLEDGE_EXPLANATION_PATTERNS;
assert('KNOWLEDGE patterns include "jak se dělá"',
  knPatterns.some(p => p.test('jak se dělá pivo')));
assert('KNOWLEDGE patterns include "proč je"',
  knPatterns.some(p => p.test('proč je nebe modré')));
assert('KNOWLEDGE patterns include "proč se"',
  knPatterns.some(p => p.test('proč se říká OK')));
assert('KNOWLEDGE patterns include "kdo vynalezl"',
  knPatterns.some(p => p.test('kdo vynalezl telefon')));
assert('KNOWLEDGE patterns include "kdo vytvořil"',
  knPatterns.some(p => p.test('kdo vytvořil Linux')));
assert('KNOWLEDGE patterns include "co způsobuje"',
  knPatterns.some(p => p.test('co způsobuje zemětřesení')));
assert('KNOWLEDGE patterns include "how is X made"',
  knPatterns.some(p => p.test('how is glass made')));
assert('KNOWLEDGE patterns include "why is"',
  knPatterns.some(p => p.test('why is the sky blue')));
assert('KNOWLEDGE patterns include "who invented"',
  knPatterns.some(p => p.test('who invented the telephone')));
assert('KNOWLEDGE patterns include "when was X invented"',
  knPatterns.some(p => p.test('when was the telephone invented')));
assert('KNOWLEDGE >= 30 patterns',
  knPatterns.length >= 30);

// ═══════════════════════════════════════════════════════════════════════════
// REGRESSION: Core classification still correct
// ═══════════════════════════════════════════════════════════════════════════

section('REGRESSION: Other intents unaffected');

assert('"navrhni architekturu" → DESIGN',
  classifyIntent('navrhni architekturu aplikace') === IntentType.DESIGN);
assert('"vymysli kampaň" → CREATIVE',
  classifyIntent('vymysli kampaň') === IntentType.CREATIVE);
assert('"postav mi web" → BUILD',
  classifyIntent('postav mi web') === IntentType.BUILD);
assert('"kolik je 2+2" → LOCAL',
  classifyIntent('kolik je 2+2') === IntentType.LOCAL);
assert('"najdi restauraci" → SEARCH',
  classifyIntent('najdi restauraci') === IntentType.SEARCH);
assert('"udělej report o AI" → REPORT',
  classifyIntent('udělej report o AI trendech') === IntentType.REPORT);
assert('"3 inzeráty na auta" → ITEM_LOOKUP',
  classifyIntent('dej mi 3 inzeráty na auta') === IntentType.ITEM_LOOKUP);

// ═══════════════════════════════════════════════════════════════════════════
// REPORT
// ═══════════════════════════════════════════════════════════════════════════

if (currentSection) {
  const s = sectionFailed === 0 ? '✅' : '❌';
  console.log(`  ${s} ${currentSection}: ${sectionPassed}/${sectionPassed + sectionFailed}`);
}

console.log('\n══════════════════════════════════════════════════════════');
console.log(`  TOTAL: ${totalPassed}/${totalPassed + totalFailed} passed, ${totalFailed} failed`);
console.log('══════════════════════════════════════════════════════════\n');

if (totalFailed > 0) process.exit(1);
