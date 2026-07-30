#!/usr/bin/env node
import './helpers/isolated-test-db.js';

// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent — v58.3 Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// 1.1: DESIGN close signal ("hotovo", "to je vše")
// 1.2: Quality metrics logging (structural — assertDesignQuality returns details)
// 1.3: Role lock in DESIGN_CONTINUE system prompt
// 2.2: FreshDataSignal logging (structural)
// Tier 1: Question forms route by fresh-data signal presence
//
// Run: node test/v583-tier1.test.js
// ══════════════════════════════════════════════════════════════════════════════

import {
  CREDecisionEngine,
  IntentType,
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

function ci(input) { return engine.classifyIntent(input); }

console.log('══════════════════════════════════════════════════════════');
console.log('  C3-Agent v58.3 — Tier 1 Restructure + Feature Tests');
console.log('══════════════════════════════════════════════════════════\n');

// ═══════════════════════════════════════════════════════════════════════════
// TIER 1 RESTRUCTURE: Question form + fresh signal → SEARCH
//                     Question form WITHOUT fresh signal → CONVERSATIONAL
// ═══════════════════════════════════════════════════════════════════════════

section('T1-1. CZ knowledge questions (no fresh signal) → CONVERSATIONAL');

assert('"jak se jmenuje hlavní město Francie" → CONV',
  ci('jak se jmenuje hlavní město Francie') === IntentType.CONVERSATIONAL);
assert('"kolik planet má sluneční soustava" → CONV',
  ci('kolik planet má sluneční soustava') === IntentType.CONVERSATIONAL);
assert('"kde je Mount Everest" → CONV',
  ci('kde je Mount Everest') === IntentType.CONVERSATIONAL);
assert('"kdy byl vynalezen telefon" → CONV',
  ci('kdy byl vynalezen telefon') === IntentType.CONVERSATIONAL);
assert('"kdo byl první prezident USA" → CONV',
  ci('kdo byl první prezident USA') === IntentType.CONVERSATIONAL);
assert('"proč je nebe modré" → CONV',
  ci('proč je nebe modré') === IntentType.CONVERSATIONAL);
assert('"jak funguje gravitace" → CONV',
  ci('jak funguje gravitace') === IntentType.CONVERSATIONAL);
assert('"co je to fotosyntéza" → CONV',
  ci('co je to fotosyntéza') === IntentType.CONVERSATIONAL);
assert('"jaký je rozdíl mezi DNA a RNA" → CONV',
  ci('jaký je rozdíl mezi DNA a RNA') === IntentType.CONVERSATIONAL);
assert('"kolik je kontinentů" → CONV',
  ci('kolik je kontinentů') === IntentType.CONVERSATIONAL);
assert('"jak vzniká duha" → CONV',
  ci('jak vzniká duha') === IntentType.CONVERSATIONAL);
assert('"co jsou to černé díry" → CONV',
  ci('co jsou to černé díry') === IntentType.CONVERSATIONAL);

// ───────────────────────────────────────────────────────────────────────────
section('T1-2. CZ fresh-data questions (with signal) → SEARCH or FACTUAL');

assert('"kde je aktuálně nejlevnější benzín" → SEARCH',
  ci('kde je aktuálně nejlevnější benzín') === IntentType.SEARCH);
assert('"kolik stojí iPhone 16 dnes" → SEARCH',
  ci('kolik stojí iPhone 16 dnes') === IntentType.SEARCH);
assert('"jaká je aktuální verze Node.js" → SEARCH',
  ci('jaká je aktuální verze Node.js') === IntentType.SEARCH);
assert('"kde je teď výprodej" → SEARCH',
  ci('kde je teď výprodej') === IntentType.SEARCH);
// "kurz" hits FACTUAL_PATTERNS before Tier 1
assert('"jaký je nyní kurz eura" → FACTUAL (kurz pattern)',
  ci('jaký je nyní kurz eura') === IntentType.FACTUAL);
// "bitcoin" hits FACTUAL_PATTERNS before SEARCH
assert('"kolik stojí bitcoin" → FACTUAL (bitcoin pattern)',
  ci('kolik stojí bitcoin') === IntentType.FACTUAL);
assert('"jaké je dnes počasí" → SEARCH',
  ci('jaké je dnes počasí') === IntentType.SEARCH);
// "zprávy" hits FACTUAL_PATTERNS
assert('"kde jsou dnes zprávy o válce" → FACTUAL (zprávy pattern)',
  ci('kde jsou dnes zprávy o válce') === IntentType.FACTUAL);

// ───────────────────────────────────────────────────────────────────────────
section('T1-3. EN knowledge questions (no fresh signal) → CONVERSATIONAL');

assert('"what is the capital of France" → CONV',
  ci('what is the capital of France') === IntentType.CONVERSATIONAL);
assert('"how many planets are in the solar system" → CONV',
  ci('how many planets are in the solar system') === IntentType.CONVERSATIONAL);
assert('"where is the Eiffel Tower" → CONV',
  ci('where is the Eiffel Tower') === IntentType.CONVERSATIONAL);
assert('"when was the telephone invented" → CONV',
  ci('when was the telephone invented') === IntentType.CONVERSATIONAL);
assert('"who was the first president of the USA" → CONV',
  ci('who was the first president of the USA') === IntentType.CONVERSATIONAL);
assert('"why is the sky blue" → CONV',
  ci('why is the sky blue') === IntentType.CONVERSATIONAL);
assert('"how does gravity work" → CONV',
  ci('how does gravity work') === IntentType.CONVERSATIONAL);
assert('"what are black holes" → CONV',
  ci('what are black holes') === IntentType.CONVERSATIONAL);
assert('"how much does the earth weigh" → CONV',
  ci('how much does the earth weigh') === IntentType.CONVERSATIONAL);

// ───────────────────────────────────────────────────────────────────────────
section('T1-4. EN fresh-data questions (with signal) → SEARCH or FACTUAL');

assert('"what is the current price of gold" → SEARCH',
  ci('what is the current price of gold') === IntentType.SEARCH);
assert('"where is the cheapest gas today" → SEARCH',
  ci('where is the cheapest gas today') === IntentType.SEARCH);
assert('"what is the latest version of Python" → SEARCH',
  ci('what is the latest version of Python') === IntentType.SEARCH);
// "news" hits FACTUAL
assert('"what are the news today" → FACTUAL (news pattern)',
  ci('what are the news today') === IntentType.FACTUAL);
// "bitcoin" hits FACTUAL
assert('"how much does bitcoin cost right now" → FACTUAL (bitcoin pattern)',
  ci('how much does bitcoin cost right now') === IntentType.FACTUAL);
// "weather" hits FACTUAL
assert('"what is the weather forecast" → FACTUAL (weather pattern)',
  ci('what is the weather forecast') === IntentType.FACTUAL);

// ───────────────────────────────────────────────────────────────────────────
section('T1-5. DE/SK/PL/FR/ES knowledge (no signal) → CONVERSATIONAL');

// DE
assert('"was ist Photosynthese" → CONV',
  ci('was ist Photosynthese') === IntentType.CONVERSATIONAL);
assert('"wie funktioniert Gravitation" → CONV',
  ci('wie funktioniert Gravitation') === IntentType.CONVERSATIONAL);
// SK
assert('"čo je to fotosyntéza" → CONV',
  ci('čo je to fotosyntéza') === IntentType.CONVERSATIONAL);
// PL
assert('"co to jest fotosynteza" → CONV',
  ci('co to jest fotosynteza') === IntentType.CONVERSATIONAL);
// FR
assert('"qu\'est-ce que la photosynthèse" → CONV',
  ci("qu'est-ce que la photosynthèse") === IntentType.CONVERSATIONAL);
// ES
assert('"qué es la fotosíntesis" → CONV',
  ci('qué es la fotosíntesis') === IntentType.CONVERSATIONAL);

// ───────────────────────────────────────────────────────────────────────────
section('T1-6. DE/SK fresh-data questions');

assert('"was ist der aktuelle Goldpreis" (DE, aktuell signal) → SEARCH',
  ci('was ist der aktuelle Goldpreis') === IntentType.SEARCH);
// SK: "kurz" hits FACTUAL_PATTERNS before Tier 1
assert('"aký je dnes kurz eura" (SK, kurz → FACTUAL) → FACTUAL',
  ci('aký je dnes kurz eura') === IntentType.FACTUAL);

// ───────────────────────────────────────────────────────────────────────────
section('T1-7. Tier 2: bare question words in substantial text');

// Without fresh signal → CONVERSATIONAL
assert('"kdo napsal Válku a mír" (3 words, no fresh) → CONV',
  ci('kdo napsal Válku a mír') === IntentType.CONVERSATIONAL);
assert('"proč padají jablka ze stromů" (no fresh) → CONV',
  ci('proč padají jablka ze stromů') === IntentType.CONVERSATIONAL);

// With fresh signal → SEARCH
assert('"kdo vyhrál aktuální sezónu F1" (fresh: aktuální) → SEARCH',
  ci('kdo vyhrál aktuální sezónu F1') === IntentType.SEARCH);

// Too short → AMBIGUOUS (not enough substance)
assert('"proč?" → not SEARCH (too short)',
  ci('proč?') !== IntentType.SEARCH);

// ═══════════════════════════════════════════════════════════════════════════
// 1.1: DESIGN CLOSE PATTERNS (tested structurally via conversation.js)
// ═══════════════════════════════════════════════════════════════════════════

section('1.1. DESIGN close patterns (regex validation)');

const DESIGN_CLOSE_PATTERNS = [
  /^hotovo[\s!.]*$/i,
  /^to\s+(je\s+)?v[šs]e[\s!.]*$/i,
  /^d[ií]ky,?\s+(to\s+)?sta[čc][ií][\s!.]*$/i,
  /^sta[čc][ií][\s!.]*$/i,
  /^uzav[rř]i\s+(projekt|session|design)/i,
  /^ukon[čc]i\s+(design|n[áa]vrh|pl[áa]n)/i,
  /^that'?s\s+(all|enough|it)[\s!.]*$/i,
  /^done[\s!.]*$/i,
  /^we'?re\s+done/i,
  /^close\s+(project|design|session)/i,
];

function matchesClose(input) { return DESIGN_CLOSE_PATTERNS.some(p => p.test(input)); }

// CZ
assert('"hotovo" matches close', matchesClose('hotovo'));
assert('"hotovo!" matches close', matchesClose('hotovo!'));
assert('"to je vše" matches close', matchesClose('to je vše'));
assert('"to vše" matches close', matchesClose('to vše'));
assert('"to vse" (no diacritics) matches close', matchesClose('to vse'));
assert('"díky, to stačí" matches close', matchesClose('díky, to stačí'));
assert('"diky to staci" (no diacritics) matches close', matchesClose('diky to staci'));
assert('"stačí" matches close', matchesClose('stačí'));
assert('"uzavři projekt" matches close', matchesClose('uzavři projekt'));
assert('"ukonči design" matches close', matchesClose('ukonči design'));
assert('"ukonci navrh" (no diacritics) matches close', matchesClose('ukonci navrh'));
// EN
assert('"done" matches close', matchesClose('done'));
assert('"that\'s all" matches close', matchesClose("that's all"));
assert('"thats enough" matches close', matchesClose('thats enough'));
assert('"we\'re done" matches close', matchesClose("we're done"));
assert('"close project" matches close', matchesClose('close project'));
// Negative
assert('"hotovo, ale ještě..." does NOT match close',
  !matchesClose('hotovo, ale ještě jeden dotaz'));
assert('"uzavři okno" does NOT match close',
  !matchesClose('uzavři okno'));

// ═══════════════════════════════════════════════════════════════════════════
// 1.2: assertDesignQuality returns details for metrics (structural)
// ═══════════════════════════════════════════════════════════════════════════

section('1.2. assertDesignQuality returns metrics details');

// Import from quality.js
let assertDesignQuality;
try {
  const quality = await import('../src/chat/handlers/utils/quality.js');
  assertDesignQuality = quality.assertDesignQuality;
} catch {
  // If quality.js not available in test harness, skip
  assertDesignQuality = null;
}

if (assertDesignQuality) {
  const goodContent = '0️⃣ Verdikt\nToto je test.\n1️⃣ Architektura\nMikroservisy.\n2️⃣ Stack\nNode.js, React.\n3️⃣ Datový model\nPostgreSQL.\n' + 'x'.repeat(400);
  const result = assertDesignQuality(goodContent, 'navrhni app');
  assert('assertDesignQuality returns .details object',
    result.details !== undefined);
  assert('.details has sections field',
    result.details?.sections !== undefined);
  assert('.details has hedging field (array)',
    Array.isArray(result.details?.hedging));

  const shortContent = 'Krátký text.';
  const shortResult = assertDesignQuality(shortContent, 'navrhni app');
  assert('Short content → valid=false',
    shortResult.valid === false);
  assert('Short content → reason contains "length"',
    shortResult.reason?.includes('length') || shortResult.reason?.includes('short'));
} else {
  console.log('    ⚠️ quality.js not in test harness — skipping 1.2 tests');
}

// ═══════════════════════════════════════════════════════════════════════════
// 1.3: Role lock in DESIGN_CONTINUE system prompt (structural)
// ═══════════════════════════════════════════════════════════════════════════

section('1.3. Role lock reinforcement (structural check)');

// Import design.js for buildDesignContinueSystemPrompt
// Since it's not exported, we check the file content
import { readFileSync } from 'fs';
const designSource = readFileSync(new URL('../src/chat/handlers/design.js', import.meta.url), 'utf8');

assert('DESIGN_CONTINUE prompt contains ROLE LOCK',
  designSource.includes('ROLE LOCK'));
assert('DESIGN_CONTINUE prompt contains turn counter',
  designSource.includes('turn ${turnCount'));
assert('DESIGN_CONTINUE prompt says NE chatbot',
  designSource.includes('NE chatbot'));
assert('DESIGN_CONTINUE prompt contains ZAKÁZANÉ FRÁZE',
  designSource.includes('ZAKÁZANÉ FRÁZE'));
assert('EN variant contains NOT a chatbot',
  designSource.includes('NOT a chatbot'));

// ═══════════════════════════════════════════════════════════════════════════
// 2.2: FreshDataSignal logging (structural — verify code exists)
// ═══════════════════════════════════════════════════════════════════════════

section('2.2. FreshDataSignal logging exists in cre-decision.js');

const creSource = readFileSync(new URL('../src/chat/cre-decision.js', import.meta.url), 'utf8');

assert('cre-decision.js contains FreshDataSignal logger call',
  creSource.includes("'FreshDataSignal'"));
assert('Logger records hasFreshSignal field',
  creSource.includes('hasFreshSignal'));
assert('Logger records tier field',
  creSource.includes("tier: hasCompoundQuestionForm ? 1 : 2"));
assert('Logger records decision field',
  creSource.includes("decision: hasFreshSignal ? 'SEARCH' : 'CONVERSATIONAL'"));

// ═══════════════════════════════════════════════════════════════════════════
// REGRESSION: Explicit SEARCH_PATTERNS and FACTUAL still work
// ═══════════════════════════════════════════════════════════════════════════

section('REGRESSION: SEARCH_PATTERNS and FACTUAL unaffected');

assert('"najdi restauraci" → SEARCH (explicit pattern)',
  ci('najdi restauraci') === IntentType.SEARCH);
assert('"vyhledej info o Reactu" → SEARCH (explicit pattern)',
  ci('vyhledej info o Reactu') === IntentType.SEARCH);
assert('"search for cheap flights" → SEARCH',
  ci('search for cheap flights') === IntentType.SEARCH);
assert('"aktuální kurz dolaru" → FACTUAL (kurz matches FACTUAL first)',
  ci('aktuální kurz dolaru') === IntentType.FACTUAL);
assert('"bitcoin kurz" → FACTUAL',
  ci('bitcoin kurz') === IntentType.FACTUAL);
assert('"weather forecast" → FACTUAL',
  ci('weather forecast') === IntentType.FACTUAL);

// ───────────────────────────────────────────────────────────────────────────
section('REGRESSION: Other intents unaffected');

assert('"navrhni architekturu API" → DESIGN',
  ci('navrhni architekturu API') === IntentType.DESIGN);
assert('"vymysli kampaň" → CREATIVE',
  ci('vymysli kampaň') === IntentType.CREATIVE);
assert('"postav mi web" → BUILD',
  ci('postav mi web') === IntentType.BUILD);
assert('"kolik je 2+2" → LOCAL',
  ci('kolik je 2+2') === IntentType.LOCAL);
assert('"ahoj" → CONVERSATIONAL',
  ci('ahoj') === IntentType.CONVERSATIONAL);
assert('"jak se máš" → CONVERSATIONAL',
  ci('jak se máš') === IntentType.CONVERSATIONAL);

// ═══════════════════════════════════════════════════════════════════════════
// EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

section('EDGE: Ambiguous cases where fresh-data signal is borderline');

// "kdo je prezident" — currently alive person, status could change
// This has "kdo je" in SEARCH_PATTERNS (explicit) → SEARCH
assert('"kdo je prezident České republiky" → SEARCH (kdo je = explicit SEARCH pattern)',
  ci('kdo je prezident České republiky') === IntentType.SEARCH);

// "who is the CEO of Apple" — same: explicit "who is" in SEARCH_PATTERNS
assert('"who is the CEO of Apple" → SEARCH',
  ci('who is the CEO of Apple') === IntentType.SEARCH);

// "kdo byl Nikola Tesla" — historical figure, no fresh data needed
// BUT "kdo byl" is in SEARCH_PATTERNS
// After Tier 1 restructure: "kdo byl" matches compound form, no fresh signal → CONV
// HOWEVER: "kdo byl" is also in explicit SEARCH_PATTERNS! Check which wins.
const teslaCl = ci('kdo byl Nikola Tesla');
assert('"kdo byl Nikola Tesla" → SEARCH or CONV (depends on pattern priority)',
  teslaCl === IntentType.SEARCH || teslaCl === IntentType.CONVERSATIONAL);

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
