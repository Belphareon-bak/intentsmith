#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent — DESIGN Intent Tests v58.0
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests DESIGN classification, disambiguation, follow-ups, forbidden phrases.
// Run: node test/design-tests.test.js
// ══════════════════════════════════════════════════════════════════════════════

import {
  CREDecisionEngine,
  CREDecision,
  DecisionType,
  IntentType,
  TaskType,
  DESIGN_FORBIDDEN_PHRASES,
  DESIGN_CONTINUE_PATTERNS,
} from '../src/chat/cre-decision.js';

import { detectLanguage } from '../src/chat/handlers/utils/language.js';

const engine = new CREDecisionEngine();

let totalPassed = 0;
let totalFailed = 0;
let currentSection = '';
let sectionPassed = 0;
let sectionFailed = 0;

function section(name) {
  if (currentSection && (sectionPassed + sectionFailed) > 0) {
    const status = sectionFailed === 0 ? '✅' : '❌';
    console.log(`  ${status} ${currentSection}: ${sectionPassed}/${sectionPassed + sectionFailed}`);
  }
  currentSection = name;
  sectionPassed = 0;
  sectionFailed = 0;
}

function assert(label, condition) {
  if (condition) {
    sectionPassed++;
    totalPassed++;
  } else {
    sectionFailed++;
    totalFailed++;
    console.log(`    ❌ FAIL: ${label}`);
  }
}

function classifyIntent(input) {
  return engine.classifyIntent(input);
}

function decide(input, context = {}) {
  return engine.decide(input, context);
}

console.log('══════════════════════════════════════════════════════════');
console.log('  C3-Agent DESIGN Tests v58.0');
console.log('══════════════════════════════════════════════════════════\n');

// ═══════════════════════════════════════════════════════════════════════════
// 1. DESIGN CLASSIFICATION — Czech with diacritics
// ═══════════════════════════════════════════════════════════════════════════
section('1A. DESIGN classification: Czech with diacritics');

assert('"udělej mi roadmapu vývoje aplikace" → DESIGN',
  classifyIntent('udělej mi roadmapu vývoje aplikace') === IntentType.DESIGN);

assert('"navrhni architekturu mobilní aplikace" → DESIGN',
  classifyIntent('navrhni architekturu mobilní aplikace') === IntentType.DESIGN);

assert('"navrhni systém pro správu objednávek" → DESIGN',
  classifyIntent('navrhni systém pro správu objednávek') === IntentType.DESIGN);

assert('"připrav plán vývoje" → DESIGN',
  classifyIntent('připrav plán vývoje') === IntentType.DESIGN);

assert('"chci vytvořit mobilní aplikaci" → DESIGN',
  classifyIntent('chci vytvořit mobilní aplikaci') === IntentType.DESIGN);

assert('"chci udělat webovou aplikaci" → DESIGN',
  classifyIntent('chci udělat webovou aplikaci') === IntentType.DESIGN);

assert('"rozděl to na sprinty" → DESIGN',
  classifyIntent('rozděl to na sprinty') === IntentType.DESIGN);

assert('"od začátku do konce včetně testů" → DESIGN',
  classifyIntent('od začátku do konce včetně testů') === IntentType.DESIGN);

assert('"včetně CI/CD a nasazení" → DESIGN',
  classifyIntent('včetně CI/CD a nasazení') === IntentType.DESIGN);

assert('"navrhni jak bys to řešil" → DESIGN',
  classifyIntent('navrhni jak bys to řešil') === IntentType.DESIGN);

assert('"jaký stack doporučuješ" → DESIGN',
  classifyIntent('jaký stack doporučuješ') === IntentType.DESIGN);

assert('"navrhni technický plán" → DESIGN',
  classifyIntent('navrhni technický plán') === IntentType.DESIGN);

// ═══════════════════════════════════════════════════════════════════════════
// 1B. DESIGN CLASSIFICATION — Czech without diacritics
// ═══════════════════════════════════════════════════════════════════════════
section('1B. DESIGN classification: Czech no diacritics');

assert('"udelej roadmapu" → DESIGN',
  classifyIntent('udelej roadmapu') === IntentType.DESIGN);

assert('"vytvor plan pro vyvoj" → DESIGN',
  classifyIntent('vytvor plan pro vyvoj') === IntentType.DESIGN);

assert('"chci vytvorit mobilni aplikaci" → DESIGN',
  classifyIntent('chci vytvorit mobilni aplikaci') === IntentType.DESIGN);

assert('"chci udelat webovou aplikaci" → DESIGN',
  classifyIntent('chci udelat webovou aplikaci') === IntentType.DESIGN);

assert('"rozdel to na sprinty" → DESIGN',
  classifyIntent('rozdel to na sprinty') === IntentType.DESIGN);

assert('"vcetne testu a deploy" → DESIGN',
  classifyIntent('vcetne testu a deploy') === IntentType.DESIGN);

// ═══════════════════════════════════════════════════════════════════════════
// 1C. DESIGN CLASSIFICATION — English
// ═══════════════════════════════════════════════════════════════════════════
section('1C. DESIGN classification: English');

assert('"design a mobile app architecture" → DESIGN',
  classifyIntent('design a mobile app architecture') === IntentType.DESIGN);

assert('"create a roadmap for the project" → DESIGN',
  classifyIntent('create a roadmap for the project') === IntentType.DESIGN);

assert('"plan the development from scratch" → DESIGN',
  classifyIntent('plan the development from scratch') === IntentType.DESIGN);

assert('"break it into sprints" → DESIGN',
  classifyIntent('break it into sprints') === IntentType.DESIGN);

assert('"architect a solution for real-time chat" → DESIGN',
  classifyIntent('architect a solution for real-time chat') === IntentType.DESIGN);

assert('"from scratch to production" → DESIGN',
  classifyIntent('from scratch to production') === IntentType.DESIGN);

assert('"end-to-end plan for the app" → DESIGN',
  classifyIntent('end-to-end plan for the app') === IntentType.DESIGN);

// ═══════════════════════════════════════════════════════════════════════════
// 2. DESIGN vs other intents — disambiguation
// ═══════════════════════════════════════════════════════════════════════════
section('2A. DESIGN vs SEARCH disambiguation');

assert('"co je Flutter" → CONVERSATIONAL (not DESIGN)',  // v58.2: "co je" knowledge → CONVERSATIONAL
  classifyIntent('co je Flutter') === IntentType.CONVERSATIONAL);

assert('"jaká je nejnovější verze React" → SEARCH (not DESIGN)',
  classifyIntent('jaká je nejnovější verze React') !== IntentType.DESIGN);

assert('"najdi mi dokumentaci k WireGuard" → SEARCH (not DESIGN)',
  classifyIntent('najdi mi dokumentaci k WireGuard') === IntentType.SEARCH);

assert('"navrhni architekturu pro chat app" → DESIGN (not SEARCH)',
  classifyIntent('navrhni architekturu pro chat app') === IntentType.DESIGN);

section('2B. DESIGN vs BUILD disambiguation');

assert('"postav mi web" → BUILD (not DESIGN)',
  classifyIntent('postav mi web') === IntentType.BUILD);

assert('"deployni na server" → BUILD (not DESIGN)',
  classifyIntent('deployni na server') === IntentType.BUILD);

assert('"scaffoldni projekt" → BUILD (not DESIGN)',
  classifyIntent('scaffoldni projekt') === IntentType.BUILD);

assert('"navrhni architekturu" → DESIGN (not BUILD)',
  classifyIntent('navrhni architekturu aplikace') === IntentType.DESIGN);

assert('"udělej roadmapu" → DESIGN (not BUILD)',
  classifyIntent('udělej roadmapu vývoje') === IntentType.DESIGN);

section('2C. DESIGN vs CREATIVE disambiguation');

assert('"navrhni příběh" → CREATIVE (not DESIGN)',
  classifyIntent('navrhni příběh') === IntentType.CREATIVE);

assert('"vymysli kampaň" → CREATIVE (not DESIGN)',
  classifyIntent('vymysli kampaň') === IntentType.CREATIVE);

assert('"napiš báseň" → CREATIVE (not DESIGN)',
  classifyIntent('napiš báseň') === IntentType.CREATIVE);

assert('"navrhni systém pro objednávky" → DESIGN (not CREATIVE)',
  classifyIntent('navrhni systém pro objednávky') === IntentType.DESIGN);

section('2D. DESIGN vs REPORT disambiguation');

assert('"udělej report novinek" → REPORT (not DESIGN)',
  classifyIntent('udělej report novinek z webu') === IntentType.REPORT);

assert('"udělej roadmapu" → DESIGN (not REPORT)',
  classifyIntent('udělej mi roadmapu aplikace') === IntentType.DESIGN);

// ═══════════════════════════════════════════════════════════════════════════
// 3. DECISION routing — DESIGN must be ANSWER with no tools
// ═══════════════════════════════════════════════════════════════════════════
section('3. DECISION: DESIGN → ANSWER with no tools');

{
  const d = decide('navrhni architekturu mobilní aplikace');
  assert('DESIGN decide() → type=ANSWER', d.type === DecisionType.ANSWER);
  assert('DESIGN decide() → intent=DESIGN', d.intent === IntentType.DESIGN);
  assert('DESIGN decide() → tools=[]', d.tools.length === 0);
  assert('DESIGN decide() → metadata.designRequest=true', d.metadata.designRequest === true);
}

{
  const d = decide('udělej mi roadmapu vývoje');
  assert('Roadmap decide() → type=ANSWER', d.type === DecisionType.ANSWER);
  assert('Roadmap decide() → intent=DESIGN', d.intent === IntentType.DESIGN);
}

{
  const d = decide('chci vytvořit mobilní aplikaci');
  assert('Create app decide() → type=ANSWER', d.type === DecisionType.ANSWER);
  assert('Create app decide() → intent=DESIGN', d.intent === IntentType.DESIGN);
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. INVARIANT: DESIGN + TOOL_CALL must throw
// ═══════════════════════════════════════════════════════════════════════════
section('4. INVARIANT: DESIGN + TOOL_CALL throws');

{
  let threw = false;
  try {
    new CREDecision({
      type: DecisionType.TOOL_CALL,
      intent: IntentType.DESIGN,
      tools: ['web.search'],
      reason: 'test',
    });
  } catch (e) {
    threw = true;
    assert('Error mentions DESIGN', e.message.includes('DESIGN'));
  }
  assert('TOOL_CALL + DESIGN throws invariant error', threw);
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. STRONG INTENT: DESIGN not overridden by sticky SEARCH
// ═══════════════════════════════════════════════════════════════════════════
section('5. STRONG: DESIGN overrides sticky SEARCH');

{
  const d = decide('navrhni architekturu aplikace', {
    lastIntent: IntentType.SEARCH,
  });
  assert('DESIGN with lastIntent=SEARCH → still DESIGN', d.intent === IntentType.DESIGN);
}

{
  const d = decide('udělej roadmapu', {
    lastIntent: IntentType.REPORT,
  });
  assert('DESIGN with lastIntent=REPORT → still DESIGN', d.intent === IntentType.DESIGN);
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. DESIGN FOLLOW-UP LOCK: stays in DESIGN after roadmap
// ═══════════════════════════════════════════════════════════════════════════
section('6A. DESIGN follow-up lock');

{
  const d = decide('více podrobností', { lastIntent: IntentType.DESIGN });
  assert('"více podrobností" with lastIntent=DESIGN → DESIGN',
    d.intent === IntentType.DESIGN);
}

{
  const d = decide('rozděl to na sprinty', { lastIntent: IntentType.DESIGN });
  assert('"rozděl to na sprinty" with lastIntent=DESIGN → DESIGN',
    d.intent === IntentType.DESIGN);
}

{
  const d = decide('podrobněji', { lastIntent: IntentType.DESIGN });
  assert('"podrobněji" with lastIntent=DESIGN → DESIGN',
    d.intent === IntentType.DESIGN);
}

{
  const d = decide('jak řešit testy', { lastIntent: IntentType.DESIGN });
  assert('"jak řešit testy" with lastIntent=DESIGN → DESIGN',
    d.intent === IntentType.DESIGN);
}

{
  const d = decide('co s deploymentem', { lastIntent: IntentType.DESIGN });
  assert('"co s deploymentem" with lastIntent=DESIGN → DESIGN',
    d.intent === IntentType.DESIGN);
}

{
  const d = decide('změň stack na Kotlin', { lastIntent: IntentType.DESIGN });
  assert('"změň stack na Kotlin" with lastIntent=DESIGN → DESIGN',
    d.intent === IntentType.DESIGN);
}

{
  const d = decide('další krok', { lastIntent: IntentType.DESIGN });
  assert('"další krok" with lastIntent=DESIGN → DESIGN',
    d.intent === IntentType.DESIGN);
}

{
  const d = decide('co dál', { lastIntent: IntentType.DESIGN });
  assert('"co dál" with lastIntent=DESIGN → DESIGN',
    d.intent === IntentType.DESIGN);
}

section('6B. DESIGN escape hatch: FACTUAL query during DESIGN');

{
  // FACTUAL should NOT be overridden by DESIGN follow-up lock
  // "kolik stojí bitcoin" has FACTUAL patterns → should escape
  const d = decide('kolik stojí Apple Developer Account', { lastIntent: IntentType.DESIGN });
  assert('"kolik stojí..." with lastIntent=DESIGN → escapes to FACTUAL (not locked)',
    d.intent === IntentType.FACTUAL || d.intent === IntentType.SEARCH);
}

{
  // LOCAL should always escape
  const d = decide('kolik je 5+3', { lastIntent: IntentType.DESIGN });
  assert('"5+3" with lastIntent=DESIGN → LOCAL (always escapes)',
    d.intent === IntentType.LOCAL);
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. DESIGN_CONTINUE_PATTERNS — explicit pattern tests
// ═══════════════════════════════════════════════════════════════════════════
section('7. DESIGN_CONTINUE_PATTERNS validation');

const shouldMatch = [
  'více podrobností',
  'podrobněji prosím',
  'detailněji',
  'rozděl to na sprinty',
  'rozepiš sprint 3',
  'jak řešit bezpečnost',
  'co s CI/CD',
  'co rizika',
  'změň technologii na Kotlin',
  'místo Flutter použij React Native',
  'přidej sprint na monitoring',
  'další krok',
  'co dál',
  'more detail please',
  'break it down further',
  'what about testing',
  'next step',
];

for (const input of shouldMatch) {
  const matches = DESIGN_CONTINUE_PATTERNS.some(p => p.test(input));
  assert(`"${input}" matches DESIGN_CONTINUE_PATTERNS`, matches);
}

const shouldNotMatch = [
  'ahoj',
  'díky',
  'najdi mi hotel',
  'kolik je hodin',
  'napiš báseň',
];

for (const input of shouldNotMatch) {
  const matches = DESIGN_CONTINUE_PATTERNS.some(p => p.test(input));
  assert(`"${input}" does NOT match DESIGN_CONTINUE_PATTERNS`, !matches);
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. DESIGN_FORBIDDEN_PHRASES
// ═══════════════════════════════════════════════════════════════════════════
section('8. DESIGN_FORBIDDEN_PHRASES coverage');

assert('Contains "informace jsou omezené"',
  DESIGN_FORBIDDEN_PHRASES.includes('informace jsou omezené'));

assert('Contains "doporučuji konzultovat"',
  DESIGN_FORBIDDEN_PHRASES.includes('doporučuji konzultovat'));

assert('Contains Polish leak "informacje"',
  DESIGN_FORBIDDEN_PHRASES.includes('informacje'));

assert('Contains "limited information"',
  DESIGN_FORBIDDEN_PHRASES.includes('limited information'));

assert('Contains chatbot phrase "neváhejte se zeptat"',
  DESIGN_FORBIDDEN_PHRASES.includes('neváhejte se zeptat'));

assert('At least 15 forbidden phrases',
  DESIGN_FORBIDDEN_PHRASES.length >= 15);

// ═══════════════════════════════════════════════════════════════════════════
// 9. REGRESSION: Original conversation bugs
// ═══════════════════════════════════════════════════════════════════════════
section('9. REGRESSION: Original conversation bugs');

assert('BUG#1: "Chci vytvorit mobilni aplikaci skze kterou s tebou budu komunikovat" → DESIGN (was AMBIGUOUS)',
  classifyIntent('Chci vytvorit mobilni aplikaci skze kterou s tebou budu komunikovat') === IntentType.DESIGN);

assert('BUG#2: "udelej roadmapu, co takovy vyvoj aplikace obnasi" → DESIGN (was SEARCH)',
  classifyIntent('udelej roadmapu, co takovy vyvoj aplikace obnasi') === IntentType.DESIGN);

assert('BUG#3: "dej mi to roadmapu v českém jazyce, ideálně 3-4 úrovně" → DESIGN (was SEARCH via reformulation)',
  classifyIntent('dej mi to roadmapu v českém jazyce') === IntentType.DESIGN);

assert('BUG#4: "rozděl na sprinty" with lastIntent=DESIGN → DESIGN (was SEARCH)',
  decide('chci mnohem vice podrobností, na sprinty to rozděl', { lastIntent: IntentType.DESIGN }).intent === IntentType.DESIGN);

// Additional regression: DESIGN must not break existing CREATIVE/BUILD
assert('REGRESSION: "vymysli kampaň" still → CREATIVE',
  classifyIntent('vymysli kampaň') === IntentType.CREATIVE);

assert('REGRESSION: "postav mi web" still → BUILD',
  classifyIntent('postav mi web') === IntentType.BUILD);

assert('REGRESSION: "napiš báseň" still → CREATIVE',
  classifyIntent('napiš báseň') === IntentType.CREATIVE);

assert('REGRESSION: "najdi restauraci" still → SEARCH',
  classifyIntent('najdi restauraci v centru') === IntentType.SEARCH);

assert('REGRESSION: "ahoj" still → CONVERSATIONAL',
  classifyIntent('ahoj') === IntentType.CONVERSATIONAL);

assert('REGRESSION: "kolik je hodin" still → LOCAL',
  classifyIntent('kolik je hodin') === IntentType.LOCAL);

// ═══════════════════════════════════════════════════════════════════════════
// FINAL REPORT
// ═══════════════════════════════════════════════════════════════════════════

// Print last section
if (currentSection) {
  const status = sectionFailed === 0 ? '✅' : '❌';
  console.log(`  ${status} ${currentSection}: ${sectionPassed}/${sectionPassed + sectionFailed}`);
}

console.log('\n══════════════════════════════════════════════════════════');
console.log(`  TOTAL: ${totalPassed}/${totalPassed + totalFailed} passed, ${totalFailed} failed`);
console.log('══════════════════════════════════════════════════════════\n');

if (totalFailed > 0) {
  process.exit(1);
}
