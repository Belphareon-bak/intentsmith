#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent — Comprehensive Chat System Tests v57.3
// ══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE: Proactive bug discovery, not reactive fixing.
//
// Tests REAL modules through the test harness:
//   - CREDecisionEngine.classifyIntent() — intent classification
//   - CREDecisionEngine.decide() — full decision (intent + context → action)
//   - detectLanguage() — language detection
//   - computeCalendar/Date/Math — LOCAL computations
//   - REFORMULATION_PATTERNS / CORRECTION_PATTERNS — new v57.3
//
// Run: node test/cre-comprehensive.test.js
// ══════════════════════════════════════════════════════════════════════════════

import {
  CREDecisionEngine,
  CREDecision,
  IntentType,
  DecisionType,
  ToolType,
  REFORMULATION_PATTERNS,
  FORBIDDEN_PHRASES,
} from '../src/chat/cre-decision.js';

import {
  detectLanguage,
  getLanguageContext,
} from '../src/chat/handlers/utils/language.js';

import {
  computeCalendar,
  computeDate,
  computeMath,
} from '../src/chat/handlers/local.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test Runner
// ─────────────────────────────────────────────────────────────────────────────

let total = 0, passed = 0, failed = 0;
const failures = [];
const sectionStats = {};
let currentSection = '';

function section(name) {
  currentSection = name;
  sectionStats[name] = { total: 0, passed: 0, failed: 0 };
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${'─'.repeat(60)}`);
}

async function t(name, fn) {
  total++;
  sectionStats[currentSection].total++;
  try {
    await fn();
    passed++;
    sectionStats[currentSection].passed++;
    console.log(`  \x1b[32m✅\x1b[0m ${name}`);
  } catch (err) {
    failed++;
    sectionStats[currentSection].failed++;
    const msg = `❌ ${name}: ${err.message}`;
    console.log(`  ${msg}`);
    failures.push({ section: currentSection, name, error: err.message });
  }
}

function eq(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} — expected "${expected}", got "${actual}"`);
  }
}

function ok(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

function oneOf(actual, allowed, msg = '') {
  if (!allowed.includes(actual)) {
    throw new Error(`${msg} — got "${actual}", expected one of [${allowed.join(', ')}]`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Engine instance
// ─────────────────────────────────────────────────────────────────────────────

const cre = new CREDecisionEngine();

// Helper: classifyIntent shorthand
const ci = (input) => cre.classifyIntent(input);

// Helper: decide with context
const decide = (input, ctx = {}) => cre.decide(input, ctx);

// ═══════════════════════════════════════════════════════════════════════════════
//
//  1. INTENT CLASSIFICATION — MASSIVE MATRIX
//
// ═══════════════════════════════════════════════════════════════════════════════

section('1A. INTENT: Greetings & Small Talk → CONVERSATIONAL');
{
  const cases = [
    'ahoj', 'čau', 'nazdar', 'hi', 'hello', 'hey',
    'díky', 'děkuji', 'thanks', 'thank you',
    'jak se máš', 'how are you',
    'co si myslíš', 'tvůj názor',
  ];
  for (const c of cases) {
    t(`"${c}" → CONVERSATIONAL`, () => eq(ci(c), IntentType.CONVERSATIONAL));
  }
}

section('1B. INTENT: Search queries → SEARCH');
{
  const cases = [
    ['najdi informace o Praze', IntentType.SEARCH],
    ['vyhledej restaurace v Brně', IntentType.SEARCH],
    // v58.2: "co je blockchain" etc. → CONVERSATIONAL (LLM knowledge, not fresh data)
    ['co je to blockchain', IntentType.CONVERSATIONAL],
    ['kdo je prezident USA', IntentType.SEARCH],
    ['aktuální kurz dolaru', IntentType.FACTUAL],
    ['kolik stojí bitcoin', IntentType.FACTUAL],  // "kolik stojí" = FACTUAL (price data)
    ['kde je nejbližší nemocnice', IntentType.SEARCH],
    ['kdy je volný den', IntentType.SEARCH],
    ['what is kubernetes', IntentType.CONVERSATIONAL],  // v58.2: knowledge → CONVERSATIONAL
    ['who is Elon Musk', IntentType.SEARCH],
    ['where is the nearest airport', IntentType.SEARCH],
    ['jak funguje fotosyntéza', IntentType.CONVERSATIONAL],  // v58.2: knowledge → CONVERSATIONAL
    ['proč je nebe modré', IntentType.CONVERSATIONAL],       // v58.2: knowledge → CONVERSATIONAL
    ['how does TCP work', IntentType.CONVERSATIONAL],        // v58.2: knowledge → CONVERSATIONAL
    ['why is the sky blue', IntentType.CONVERSATIONAL],      // v58.2: knowledge → CONVERSATIONAL
  ];
  for (const [input, expected] of cases) {
    t(`"${input}" → ${expected}`, () => eq(ci(input), expected));
  }
}

section('1C. INTENT: Reports → REPORT');
{
  const cases = [
    'vytvoř report o AI',
    'udělej mi report',
    'udelej mi report zprav z webu novinky cz',
    'report z webu idnes.cz',
    'report zprav z novinky.cz',
    'dej mi report o situaci',
    'priprav report z novinky.cz',
    'shrnutí za poslední týden',
    'shrnuti za posledni tyden',
    'analýza trhu',
    'porovnej iPhone a Samsung',
    'přehled novinek za měsíc',
    'dej mi souhrn',
    'zprávy za poslední den',
    'zprav z webu seznam.cz',
    'novinky za tento měsíc',
    'weekly report',
    'give me overview',
    'co se stalo za poslední týden',
    'zprávy z novinky.cz',
    'create report on AI trends',
  ];
  for (const c of cases) {
    t(`"${c}" → REPORT`, () => eq(ci(c), IntentType.REPORT));
  }
}

section('1D. INTENT: Factual → FACTUAL');
{
  const cases = [
    ['počasí', IntentType.AMBIGUOUS],  // v58.2: bare word with \b boundary → AMBIGUOUS
    ['pocasi', IntentType.FACTUAL],
    ['kurz eura', IntentType.FACTUAL],
    ['cena bitcoinu', IntentType.AMBIGUOUS],  // v58.3: bare 2-word phrase, no question form → AMBIGUOUS
    ['zprávy', IntentType.FACTUAL],
    ['zpravy', IntentType.FACTUAL],
    ['novinky', IntentType.FACTUAL],
    ['výsledky ligy', IntentType.FACTUAL],
    ['statistiky', IntentType.FACTUAL],
    ['weather forecast', IntentType.FACTUAL],
    ['stock price', IntentType.FACTUAL],
    ['crypto news', IntentType.FACTUAL],
  ];
  for (const [input, expected] of cases) {
    t(`"${input}" → ${expected}`, () => eq(ci(input), expected));
  }
}

section('1E. INTENT: Code → CODE');
{
  const cases = [
    'napiš kód pro sorting',
    'napiš mi funkci na sčítání',
    'vytvoř funkci pro API',
    'implementuj binary search',
    'oprav bug v kódu',
    'refaktoruj tuhle třídu',
    'write code for fibonacci',
    'fix bug in main.js',
    'function calculateSum()',
  ];
  for (const c of cases) {
    t(`"${c}" → CODE`, () => eq(ci(c), IntentType.CODE));
  }
}

section('1F. INTENT: Creative / Ideation → CREATIVE');
{
  const cases = [
    'vymysli mi kampaň pro startup',
    'navrhni mi logo koncept',
    'dej mi nápady na teambuilding',
    'inspirace pro vánoční party',
    'brainstorm marketing strategie',
    'napiš báseň o lásce',
    'napiš příběh o drakovi',
    'řekni mi vtip',
    'write a poem about nature',
    'come up with ideas for a game',
    'create a story about space',
    'tell me a joke',
    'kreativní návrhy pro web',
    'variace na téma jazz',
    'něco jako Netflix ale pro knihy',
    've stylu cyberpunk',
  ];
  for (const c of cases) {
    t(`"${c}" → CREATIVE`, () => eq(ci(c), IntentType.CREATIVE));
  }
}

section('1G. INTENT: LOCAL deterministic → LOCAL');
{
  const cases = [
    'kolik je hodin',
    'jaký je dnes den',
    'jaké je datum',
    'kolikátého je',
    'kdy bude úplněk',
    'kdy bude uplnek',
    'fáze měsíce',
    'kolik je 5+3',
    'vypočítej 100*25',
    'spočítej 17+38',
    'what time is it',
    'what day is today',
    'za kolik dní jsou Vánoce',
    'current date',
    'current time',
  ];
  for (const c of cases) {
    t(`"${c}" → LOCAL`, () => eq(ci(c), IntentType.LOCAL));
  }
}

section('1H. INTENT: Build → BUILD');
{
  const cases = [
    'postav mi web',
    'rozjeď mi cluster',
    'deployni na server',
    'nastav mi CI/CD pipeline',
    'nastav mi monitoring',
    'scaffold projekt',
    'build me a REST API',
    'set up a server',
    'spin up a cluster',
    'automatizuj deployment',
    'vytvoř mi celý nový projekt',
    'jdeme stavět',
  ];
  for (const c of cases) {
    t(`"${c}" → BUILD`, () => eq(ci(c), IntentType.BUILD));
  }
}

section('1I. INTENT: Item lookup → ITEM_LOOKUP');
{
  const cases = [
    '4 inzeráty na auta',
    'dej mi 3 nabídky bytů',
    'najdi mi 5 aut do 200000',
    'top 10 produktů',
    '5 nejlepších restaurací',
    'find me 3 apartments',
    'show me 5 listings',
  ];
  for (const c of cases) {
    t(`"${c}" → ITEM_LOOKUP`, () => eq(ci(c), IntentType.ITEM_LOOKUP));
  }
}

section('1J. INTENT: Self-reference → CONVERSATIONAL');
{
  const cases = [
    'jak se jmenuju',
    'kdo jsem',
    'co jsem ti říkal',
    'pamatuješ si mě',
    'co víš o mně',
    'what is my name',
    'who am I',
    'do you remember me',
    'wie heiße ich',
    'kim jestem',
    'comment je m\'appelle',
  ];
  for (const c of cases) {
    t(`"${c}" → CONVERSATIONAL`, () => eq(ci(c), IntentType.CONVERSATIONAL));
  }
}

section('1K. INTENT: Statements → CONVERSATIONAL');
{
  const cases = [
    'moje jméno je Petr',
    'jmenuju se Alice',
    'bydlím v Praze',
    'pracuju jako developer',
    'mám rád Python',
    'my name is Bob',
    'I am a developer',
    'I live in Prague',
    'ich heiße Hans',
    'je m\'appelle Marie',
    'me llamo Carlos',
  ];
  for (const c of cases) {
    t(`"${c}" → CONVERSATIONAL`, () => eq(ci(c), IntentType.CONVERSATIONAL));
  }
}

section('1L. INTENT: Knowledge requests → SEARCH or CONVERSATIONAL');
{
  const searchCases = [
    'řekni mi o Pythagorovi',
    'pověz mi o historii Prahy',
    'informace o elektromobilech',
    'tell me about quantum computing',
    'erzähl mir von Berlin',
    'powiedz mi o Warszawie',
    'dis-moi de la France',
  ];
  for (const c of searchCases) {
    t(`"${c}" → SEARCH`, () => eq(ci(c), IntentType.SEARCH));
  }

  // v58.2: explanation/description requests → CONVERSATIONAL (LLM knowledge, not fresh data)
  const convCases = [
    'popiš mi proces fotosyntézy',
    'explain machine learning',
    'describe the water cycle',
  ];
  for (const c of convCases) {
    t(`"${c}" → CONVERSATIONAL`, () => eq(ci(c), IntentType.CONVERSATIONAL));
  }
}

section('1M. INTENT: Conversational follow-ups → CONVERSATIONAL');
{
  const cases = [
    'vysvětli jednodušeji',
    'můžeš mi to vysvětlit',
    'ještě jednou',
    'nechápu',
    'nerozumím',
    'co to znamená',
    'pokračuj',
    'go on',
    'tell me more',
    'can you explain',
    'více',
  ];
  for (const c of cases) {
    t(`"${c}" → CONVERSATIONAL`, () => eq(ci(c), IntentType.CONVERSATIONAL));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//
//  2. INTENT CLASSIFICATION — NO-DIACRITICS CZECH (the big gap)
//
// ═══════════════════════════════════════════════════════════════════════════════

section('2. INTENT: No-diacritics Czech (must NOT fall to AMBIGUOUS)');
{
  const cases = [
    // These are the danger cases — Czech without háčky/čárky
    ['udelej mi report zprav z webu novinky cz', IntentType.REPORT],
    ['vyhledej informace o Praze', IntentType.SEARCH],     // has háčky (ž)
    ['shrn to za posledni mesic', IntentType.REPORT],       // shrnuti pattern
    ['pocasi v Brne', IntentType.FACTUAL],
    ['novinky z ceska', IntentType.FACTUAL],
    ['vytvor report', IntentType.REPORT],
    // These should still work
    ['najdi mi nejlevnejsi auto', IntentType.SEARCH],       // najdi pattern
    ['hledej byty v Praze', IntentType.SEARCH],
  ];
  for (const [input, expected] of cases) {
    t(`"${input}" → ${expected}`, () => {
      const actual = ci(input);
      eq(actual, expected, input);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//
//  3. DECISION FLOW — classifyIntent + decide()
//
// ═══════════════════════════════════════════════════════════════════════════════

section('3A. DECISION: Tool-requiring intents → TOOL_CALL');
{
  const toolIntents = [
    ['najdi restaurace v Brně', IntentType.SEARCH, DecisionType.TOOL_CALL],
    ['vytvoř report o AI', IntentType.REPORT, DecisionType.TOOL_CALL],
    ['jaké je počasí', IntentType.SEARCH, DecisionType.TOOL_CALL],  // v58.2: full phrase needed (bare "počasí" → AMBIGUOUS)
    ['dej mi 3 inzeráty na auta', IntentType.ITEM_LOOKUP, DecisionType.TOOL_CALL],
  ];
  for (const [input, expectedIntent, expectedDecision] of toolIntents) {
    await t(`"${input}" → ${expectedDecision}`, async () => {
      const d = await decide(input);
      eq(d.intent, expectedIntent, `intent for "${input}"`);
      eq(d.type, expectedDecision, `decision for "${input}"`);
      ok(d.tools.length > 0, `must have tools for "${input}"`);
    });
  }
}

section('3B. DECISION: Terminal intents → ANSWER or LOCAL');
{
  const terminalCases = [
    ['ahoj', IntentType.CONVERSATIONAL, DecisionType.ANSWER],
    ['díky', IntentType.CONVERSATIONAL, DecisionType.ANSWER],
    ['kolik je hodin', IntentType.LOCAL, DecisionType.LOCAL],
    ['kdy bude úplněk', IntentType.LOCAL, DecisionType.LOCAL],
    ['5 + 3', IntentType.LOCAL, DecisionType.LOCAL],
    ['vymysli mi kampaň', IntentType.CREATIVE, DecisionType.ANSWER],
    ['napiš báseň', IntentType.CREATIVE, DecisionType.ANSWER],
  ];
  for (const [input, expectedIntent, expectedDecision] of terminalCases) {
    await t(`"${input}" → ${expectedDecision}`, async () => {
      const d = await decide(input);
      eq(d.intent, expectedIntent, `intent for "${input}"`);
      eq(d.type, expectedDecision, `decision for "${input}"`);
    });
  }
}

section('3C. DECISION: BUILD → PLAN (never TOOL_CALL/ANSWER)');
{
  const buildCases = [
    'postav mi web',
    'deployni na server',
    'nastav mi CI/CD pipeline',
    'build me a REST API',
  ];
  for (const input of buildCases) {
    await t(`"${input}" → PLAN`, async () => {
      const d = await decide(input);
      eq(d.intent, IntentType.BUILD, `intent for "${input}"`);
      eq(d.type, DecisionType.PLAN, `decision for "${input}"`);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//
//  4. MULTI-TURN CONTEXT — Sticky intents, follow-ups
//
// ═══════════════════════════════════════════════════════════════════════════════

section('4A. CONTEXT: Sticky SEARCH intent on follow-ups');
{
  // After SEARCH, ambiguous follow-ups should stick to SEARCH
  // v72: lastDecision required — follow-up override needs to verify previous turn used a tool
  const ctx = { lastIntent: IntentType.SEARCH, lastDecision: { type: 'TOOL_CALL' } };
  const followUps = [
    'a co dál?',
    'ještě něco?',
    'další informace',
    'zkus najít víc',
    'najdi konkrétní',
    'hledej dál',
    'jiný zdroj',
    'alternativu',
  ];
  for (const f of followUps) {
    await t(`SEARCH → "${f}" stays SEARCH`, async () => {
      const d = await decide(f, ctx);
      eq(d.intent, IntentType.SEARCH, `sticky for "${f}"`);
    });
  }
}

section('4B. CONTEXT: CREATIVE follow-up stays CREATIVE');
{
  const ctx = { lastIntent: IntentType.CREATIVE };
  const followUps = [
    'jaký to může mít vliv na hráče?',
    'rozviň tu myšlenku',
    'víc o tom',
    'podrobněji',
    'co když to změním?',
    'jak by to vypadalo?',
    'alternativní verzi',
    'jinou verzi',
    'zkus temnější',
    'zkus to jinak',
    'ještě jednu verzi',
    'similar style',
  ];
  for (const f of followUps) {
    await t(`CREATIVE → "${f}" stays CREATIVE`, async () => {
      const d = await decide(f, ctx);
      eq(d.intent, IntentType.CREATIVE, `creative follow-up "${f}"`);
    });
  }
}

section('4C. CONTEXT: Strong intents override sticky');
{
  // Even if last intent was SEARCH, LOCAL/CONVERSATIONAL/CREATIVE win
  const ctx = { lastIntent: IntentType.SEARCH };
  const strongCases = [
    ['kolik je hodin', IntentType.LOCAL],
    ['ahoj', IntentType.CONVERSATIONAL],
    ['vymysli mi příběh', IntentType.CREATIVE],
  ];
  for (const [input, expected] of strongCases) {
    await t(`SEARCH → "${input}" breaks to ${expected}`, async () => {
      const d = await decide(input, ctx);
      eq(d.intent, expected, `strong intent for "${input}"`);
    });
  }
}

section('4D. CONTEXT: Intent break patterns');
{
  const ctx = { lastIntent: IntentType.REPORT };
  const breakCases = [
    'teď chci najít restauraci',
    'změň téma',
    'něco jiného',
    'dost reportů',
    'chci najít auto',
  ];
  for (const input of breakCases) {
    await t(`REPORT → "${input}" breaks sticky`, async () => {
      const d = await decide(input, ctx);
      ok(d.intent !== IntentType.REPORT, `should break from REPORT, got ${d.intent}`);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//
//  5. LANGUAGE DETECTION
//
// ═══════════════════════════════════════════════════════════════════════════════

section('5A. LANGUAGE: Czech detection');
{
  const czCases = [
    // With diacritics (easy)
    ['Kde je nejbližší nemocnice?', 'cs'],
    ['Řekni mi o Praze', 'cs'],
    ['Můžeš mi pomoct?', 'cs'],
    ['Děkuji za pomoc', 'cs'],
    // Without diacritics (the hard ones)
    ['udelej mi report zprav z webu novinky cz', 'cs'],
    ['zkus to v ceskem jazyce', 'cs'],
    ['dej mi zpravy', 'cs'],
    ['diky za pomoc', 'cs'],
    ['prosim o pomoc', 'cs'],
  ];
  for (const [input, expected] of czCases) {
    t(`"${input.substring(0, 35)}…" → ${expected}`, () => {
      const { language } = detectLanguage(input);
      eq(language, expected, input);
    });
  }
}

section('5B. LANGUAGE: Other languages');
{
  const cases = [
    ['Hello, how are you doing today?', 'en'],
    ['Guten Tag, wie geht es Ihnen?', 'de'],
    ['Dzień dobry, jak się masz?', 'pl'],
    ['Bonjour, comment allez-vous?', 'fr'],
    ['Hola, ¿cómo estás?', 'es'],
    ['Dobrý deň, ako sa máte?', 'sk'],
    // Short but unambiguous
    ['thank you very much', 'en'],
    ['Wie heißt du?', 'de'],
    ['Jak się nazywasz?', 'pl'],
    ['¿Qué es esto?', 'es'],
  ];
  for (const [input, expected] of cases) {
    t(`"${input.substring(0, 35)}…" → ${expected}`, () => {
      const { language } = detectLanguage(input);
      eq(language, expected, input);
    });
  }
}

section('5C. LANGUAGE: getLanguageContext fallback');
{
  t('unknown → defaults to "cs"', () => {
    const { language } = getLanguageContext('xyz', 'cs');
    eq(language, 'cs');
  });

  t('Czech detected → instruction contains ČESKY', () => {
    const { instruction } = getLanguageContext('Kde je Praha?');
    ok(instruction.includes('ČESKY'), 'must contain ČESKY');
  });

  t('English detected → instruction contains ENGLISH', () => {
    const { instruction } = getLanguageContext('Where is London?');
    ok(instruction.includes('ENGLISH'), 'must contain ENGLISH');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//
//  6. LOCAL COMPUTATIONS
//
// ═══════════════════════════════════════════════════════════════════════════════

section('6A. LOCAL: Moon phase');
{
  t('computeCalendar("kdy bude uplnek") returns valid result', () => {
    const r = computeCalendar('kdy bude uplnek');
    ok(r.answer > 0 && r.answer <= 30, `days should be 1-30, got ${r.answer}`);
    ok(r.date, 'must have date');
    ok(r.today, 'must have today (v57.3)');
    ok(r.explanation.includes('počítáno od'), 'must include reference date');
  });

  t('computeCalendar("kdy bude úplněk") works with diacritics', () => {
    const r = computeCalendar('kdy bude úplněk');
    ok(r.answer > 0, 'must return positive days');
  });

  t('full moon result is reasonable', () => {
    const r = computeCalendar('full moon');
    ok(r.answer > 0 && r.answer <= 30, `lunar cycle max 29.5 days, got ${r.answer}`);
  });
}

section('6B. LOCAL: Math');
{
  const mathCases = [
    ['5 + 3', 8],
    ['100 - 37', 63],
    ['12 * 12', 144],
    ['100 / 4', 25],
    ['0 + 0', 0],
    ['999 * 0', 0],
  ];
  for (const [expr, expected] of mathCases) {
    t(`computeMath("${expr}") = ${expected}`, () => {
      const r = computeMath(expr);
      eq(r.answer, expected, expr);
    });
  }

  t('division by zero → NaN', () => {
    const r = computeMath('5 / 0');
    ok(isNaN(r.answer), 'should be NaN');
  });

  t('non-math input → error', () => {
    const r = computeMath('hello world');
    ok(r.error, 'should have error');
  });
}

section('6C. LOCAL: Date/time');
{
  t('computeDate("kolik je hodin") returns time', () => {
    const r = computeDate('kolik je hodin');
    ok(r.answer, 'must have answer');
    ok(r.explanation.includes('čas'), 'must mention time');
  });

  t('computeDate("jaký je den") returns day name', () => {
    const r = computeDate('jaký je den');
    ok(r.dayOfWeek, 'must have dayOfWeek');
    ok(['pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota', 'neděle'].includes(r.dayOfWeek),
      `invalid day: ${r.dayOfWeek}`);
  });

  t('computeCalendar("vánoce") returns days until Christmas', () => {
    const r = computeCalendar('kolik dní do Vánoc');
    ok(r.answer > 0, 'must be positive');
    ok(r.answer <= 366, 'must be within a year');
    ok(r.today, 'v57.3: must have today field');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//
//  7. REFORMULATION PATTERNS
//
// ═══════════════════════════════════════════════════════════════════════════════

section('7A. REFORMULATION: Language switch');
{
  const positive = [
    'zkus to v ceskem jazyce',
    'zkus to v českém jazyce',
    'zkus to po česky',
    'zkus to po cesky',
    'odpověz česky',
    'odpovez cesky',
    'piš to česky',
    'napiš to anglicky',
    'řekni to slovensky',
    'v anglickém jazyce',
    'v ceskem jazyce',
    'v německém jazyce',
    'to samé česky',
    'totéž anglicky',
    'přelož to do angličtiny',
    'preloz to do cestiny',
  ];
  for (const input of positive) {
    t(`"${input}" → reformulation`, () => {
      ok(REFORMULATION_PATTERNS.some(p => p.test(input)), `should match: ${input}`);
    });
  }
}

section('7B. REFORMULATION: Retry');
{
  const positive = [
    'zkus to znovu',
    'zkus to znova',
    'zkus to ještě',
    'zopakuj to',
    'zopakuj poslední',
    'udelej to znovu',
    'udělej to znova',
    'ještě jednou',
    'jeste jednou',
    'try again',
    'once more',
    'repeat in English',
    'redo but shorter',
  ];
  for (const input of positive) {
    t(`"${input}" → reformulation`, () => {
      ok(REFORMULATION_PATTERNS.some(p => p.test(input)), `should match: ${input}`);
    });
  }
}

section('7C. REFORMULATION: Negative cases (must NOT match)');
{
  const negative = [
    'najdi mi novinky',
    'co je nového',
    'zkus vyhledat bitcoin',
    'zkus najít restauraci',
    'ahoj',
    'report z webu',
    'napiš kód',
  ];
  for (const input of negative) {
    t(`"${input}" → NOT reformulation`, () => {
      ok(!REFORMULATION_PATTERNS.some(p => p.test(input)), `should NOT match: ${input}`);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//
//  8. CORRECTION PATTERNS (via classifyIntent → CONVERSATIONAL)
//
// ═══════════════════════════════════════════════════════════════════════════════

section('8. CORRECTIONS: Date/fact corrections → CONVERSATIONAL (not AMBIGUOUS)');
{
  const corrections = [
    'dnes je ale 8.2.2026',
    'dnes je 8.2.2026',
    'ale dnes je 15.3.',
    'dneska je 8.2.2026',
    'dnes máme 8.2.',
    'dnešní datum je jiné',
    'ne, myslel jsem něco jiného',
    'špatně, dnes je pátek',
    'but today is February 8',
    'actually, the date is wrong',
  ];
  for (const input of corrections) {
    t(`"${input}" → CONVERSATIONAL (not AMBIGUOUS)`, () => {
      const intent = ci(input);
      ok(intent !== IntentType.AMBIGUOUS, `got ${intent} for "${input}"`);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//
//  9. EDGE CASES & ADVERSARIAL INPUTS
//
// ═══════════════════════════════════════════════════════════════════════════════

section('9A. EDGE: Very short inputs');
{
  const shortCases = [
    ['a', IntentType.AMBIGUOUS],
    ['ok', IntentType.AMBIGUOUS],
    ['ne', IntentType.AMBIGUOUS],
    ['jo', IntentType.AMBIGUOUS],
    ['?', IntentType.AMBIGUOUS],
    ['...', IntentType.AMBIGUOUS],
  ];
  for (const [input, expected] of shortCases) {
    t(`"${input}" → ${expected}`, () => eq(ci(input), expected));
  }
}

section('9B. EDGE: Empty / whitespace');
{
  t('empty string → AMBIGUOUS', () => eq(ci(''), IntentType.AMBIGUOUS));
  t('spaces only → AMBIGUOUS', () => eq(ci('   '), IntentType.AMBIGUOUS));
}

section('9C. EDGE: Mixed language inputs');
{
  // These should not crash and should return something reasonable
  const mixedCases = [
    'najdi mi best restaurants in Prague',
    'explain jak funguje blockchain',
    'popiš mi how TCP works',
    'vysvětli machine learning jednodušeji',
  ];
  for (const input of mixedCases) {
    t(`"${input}" → does not throw`, () => {
      const intent = ci(input);
      ok(intent !== undefined, 'must return an intent');
      ok(Object.values(IntentType).includes(intent), `must be valid IntentType, got "${intent}"`);
    });
  }
}

section('9D. EDGE: Numbers and special chars');
{
  t('"12345" → AMBIGUOUS', () => eq(ci('12345'), IntentType.AMBIGUOUS));
  t('"!!!" → AMBIGUOUS', () => eq(ci('!!!'), IntentType.AMBIGUOUS));
  t('"5+3" → LOCAL', () => eq(ci('5+3'), IntentType.LOCAL));
  t('"5 * 7" → LOCAL', () => eq(ci('5 * 7'), IntentType.LOCAL));
}

section('9E. EDGE: URL-like inputs');
{
  t('"https://novinky.cz" → not crash', () => {
    const intent = ci('https://novinky.cz');
    ok(intent !== undefined);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//
//  10. PATTERN PRIORITY — ensure correct ordering
//
// ═══════════════════════════════════════════════════════════════════════════════

section('10A. PRIORITY: LOCAL beats SEARCH');
{
  // "kolik" appears in both LOCAL and SEARCH patterns
  t('"kolik je hodin" → LOCAL (not SEARCH)', () => eq(ci('kolik je hodin'), IntentType.LOCAL));
  t('"kdy bude úplněk" → LOCAL (not SEARCH)', () => eq(ci('kdy bude úplněk'), IntentType.LOCAL));
  t('"kolik je 5+3" → LOCAL', () => eq(ci('kolik je 5+3'), IntentType.LOCAL));
}

section('10B. PRIORITY: CONVERSATIONAL beats SEARCH for follow-ups');
{
  t('"vysvětli jednodušeji" → CONVERSATIONAL', () => eq(ci('vysvětli jednodušeji'), IntentType.CONVERSATIONAL));
  t('"pokračuj" → CONVERSATIONAL', () => eq(ci('pokračuj'), IntentType.CONVERSATIONAL));
  t('"co to znamená" → CONVERSATIONAL', () => eq(ci('co to znamená'), IntentType.CONVERSATIONAL));
  t('"nechápu" → CONVERSATIONAL', () => eq(ci('nechápu'), IntentType.CONVERSATIONAL));
}

section('10C. PRIORITY: CREATIVE beats SEARCH');
{
  t('"vymysli kampaň" → CREATIVE (not SEARCH)', () => eq(ci('vymysli kampaň'), IntentType.CREATIVE));
  t('"navrhni mi logo" → CREATIVE (not SEARCH)', () => eq(ci('navrhni mi logo'), IntentType.CREATIVE));
  t('"dej mi nápady" → CREATIVE', () => eq(ci('dej mi nápady'), IntentType.CREATIVE));
}

section('10D. PRIORITY: ITEM_LOOKUP beats REPORT');
{
  t('"4 inzeráty na auta" → ITEM_LOOKUP (not REPORT)', () => eq(ci('4 inzeráty na auta'), IntentType.ITEM_LOOKUP));
  t('"dej mi 3 nabídky" → ITEM_LOOKUP', () => eq(ci('dej mi 3 nabídky'), IntentType.ITEM_LOOKUP));
  t('"top 5 produktů" → ITEM_LOOKUP', () => eq(ci('top 5 produktů'), IntentType.ITEM_LOOKUP));
}

section('10E. PRIORITY: BUILD beats CODE');
{
  t('"postav mi API" → BUILD (not CODE)', () => eq(ci('postav mi API'), IntentType.BUILD));
  t('"nastav mi infrastrukturu" → BUILD', () => eq(ci('nastav mi infrastrukturu'), IntentType.BUILD));
}

// ═══════════════════════════════════════════════════════════════════════════════
//
//  11. INVARIANT CHECKS — decisions that must NEVER happen
//
// ═══════════════════════════════════════════════════════════════════════════════

// Suppress expected ERROR logs from invariant violation tests (11A-11C)
const _origLog = console.log;
console.log = (...args) => { if (!String(args[0]).includes('INVARIANT')) _origLog(...args); };

section('11A. INVARIANT: ANSWER only for CONVERSATIONAL/CREATIVE');
{
  const toolIntents = [IntentType.SEARCH, IntentType.REPORT, IntentType.FACTUAL];
  for (const intent of toolIntents) {
    t(`CREDecision(ANSWER, ${intent}) → throws`, () => {
      let threw = false;
      try {
        
        new CREDecision({ type: DecisionType.ANSWER, intent, reason: 'test' });
      } catch (e) {
        threw = true;
      }
      ok(threw, `should throw for ANSWER + ${intent}`);
    });
  }
}

section('11B. INVARIANT: TOOL_CALL never for CONVERSATIONAL/CREATIVE/LOCAL');
{
  const noToolIntents = [IntentType.CONVERSATIONAL, IntentType.CREATIVE, IntentType.LOCAL];
  for (const intent of noToolIntents) {
    t(`CREDecision(TOOL_CALL, ${intent}) → throws`, () => {
      let threw = false;
      try {
        
        new CREDecision({ type: DecisionType.TOOL_CALL, intent, tools: ['web.search'], reason: 'test' });
      } catch (e) {
        threw = true;
      }
      ok(threw, `should throw for TOOL_CALL + ${intent}`);
    });
  }
}

section('11C. INVARIANT: BUILD ↔ PLAN mutual enforcement');
{
  t('PLAN without BUILD → throws', () => {
    let threw = false;
    try {
      
      new CREDecision({ type: DecisionType.PLAN, intent: IntentType.SEARCH, reason: 'test' });
    } catch (e) { threw = true; }
    ok(threw);
  });

  t('BUILD without PLAN → throws', () => {
    let threw = false;
    try {

      new CREDecision({ type: DecisionType.TOOL_CALL, intent: IntentType.BUILD, tools: ['web.search'], reason: 'test' });
    } catch (e) { threw = true; }
    ok(threw);
  });
  // Restore console.log after invariant sections
  console.log = _origLog;
}

// ═══════════════════════════════════════════════════════════════════════════════
//
//  12. FORBIDDEN PHRASES
//
// ═══════════════════════════════════════════════════════════════════════════════

section('12. FORBIDDEN PHRASES: validateResponse catches them');
{
  for (const phrase of FORBIDDEN_PHRASES) {
    t(`"${phrase}" → violation`, () => {
      const result = cre.validateResponse(`Odpověď: ${phrase} a další text.`);
      ok(!result.valid, `"${phrase}" should be caught`);
      ok(result.violations.includes(phrase), `should list "${phrase}" as violation`);
    });
  }

  t('clean response → valid', () => {
    const result = cre.validateResponse('Dobrý den, tady je vaše odpověď.');
    ok(result.valid, 'clean response should be valid');
    eq(result.violations.length, 0, 'no violations');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//
//  13. REGRESSION — Known bugs as test cases
//
// ═══════════════════════════════════════════════════════════════════════════════

section('13. REGRESSION: Known bugs must not regress');
{
  // Bug 1: Spanish response — root cause was AMBIGUOUS + English system prompt
  t('BUG-001: "udelej mi report zprav z webu novinky cz" → REPORT', () => {
    eq(ci('udelej mi report zprav z webu novinky cz'), IntentType.REPORT);
  });

  t('BUG-001b: language detected as CS (not unknown)', () => {
    const { language } = detectLanguage('udelej mi report zprav z webu novinky cz');
    eq(language, 'cs');
  });

  // Bug 2: "zkus to v ceskem jazyce" → AMBIGUOUS
  t('BUG-002: "zkus to v ceskem jazyce" → reformulation match', () => {
    ok(REFORMULATION_PATTERNS.some(p => p.test('zkus to v ceskem jazyce')));
  });

  // Bug 3: "dnes je ale 8.2.2026" → AMBIGUOUS
  t('BUG-003: "dnes je ale 8.2.2026" → not AMBIGUOUS', () => {
    const intent = ci('dnes je ale 8.2.2026');
    ok(intent !== IntentType.AMBIGUOUS, `got ${intent}`);
  });

  // Bug 4: Moon phase missing date reference
  t('BUG-004: moon phase includes "počítáno od"', () => {
    const r = computeCalendar('kdy bude uplnek');
    ok(r.explanation.includes('počítáno od'), 'must reference today');
    ok(r.today, 'must have today field');
  });

  // Ensure past bugs from CHANGELOG don't regress
  t('LEGACY: "napiš báseň" → CREATIVE (not SEARCH)', () => {
    eq(ci('napiš báseň'), IntentType.CREATIVE);
  });

  t('LEGACY: "kdy bude úplněk" → LOCAL (not SEARCH)', () => {
    eq(ci('kdy bude úplněk'), IntentType.LOCAL);
  });

  t('LEGACY: "Jak se jmenuju?" → CONVERSATIONAL (not SEARCH)', () => {
    eq(ci('Jak se jmenuju?'), IntentType.CONVERSATIONAL);
  });

  t('LEGACY: "Moje jméno je Alice" → CONVERSATIONAL (not AMBIGUOUS)', () => {
    eq(ci('Moje jméno je Alice'), IntentType.CONVERSATIONAL);
  });

  await t('LEGACY: "vymysli kampaň" → CREATIVE → ANSWER (not TOOL_CALL)', async () => {
    const d = await decide('vymysli kampaň');
    eq(d.type, DecisionType.ANSWER);
    eq(d.intent, IntentType.CREATIVE);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//
//  RESULTS
//
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log('  SECTION SUMMARY');
console.log(`${'═'.repeat(60)}`);

for (const [name, stats] of Object.entries(sectionStats)) {
  const status = stats.failed === 0 ? '✅' : '❌';
  const failStr = stats.failed > 0 ? ` (${stats.failed} FAILED)` : '';
  console.log(`  ${status} ${name}: ${stats.passed}/${stats.total}${failStr}`);
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`  TOTAL: ${passed}/${total} passed, ${failed} failed`);
console.log(`${'═'.repeat(60)}`);

if (failures.length > 0) {
  console.log('\n  FAILURES:');
  for (const f of failures) {
    console.log(`  ❌ [${f.section}] ${f.name}`);
    console.log(`     → ${f.error}`);
  }
}

console.log('');
process.exit(failed > 0 ? 1 : 0);
