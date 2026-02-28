#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent — Adversarial CRE Classification Tests v87
// ══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE: Stress-test CRE intent classification against:
//   1. POLYSEMY — Czech words with tech + non-tech meanings
//   2. AMBIGUOUS — legitimately unclear inputs
//   3. NEGATION — explicit "ne X ale Y" overrides
//   4. CROSS-DOMAIN COLLISION — same input, different expertise → different intent
//   5. INJECTION — tech words embedded in non-tech context
//   6. GUARD BYPASS — inputs designed to bypass specific guards
//
// Expected: Many tests FAIL or KNOWN_ISSUE. That's intentional — documenting
// existing classifier weaknesses for future fixes.
//
// Run: node tests/adversarial-cre.test.js
// ══════════════════════════════════════════════════════════════════════════════

import {
  CREDecisionEngine,
  IntentType,
  DecisionType,
} from '../src/chat/cre-decision.js';

import { BUILTIN_EXPERTISES } from '../src/expertises/expertise-layer.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test Runner
// ─────────────────────────────────────────────────────────────────────────────
let total = 0, passed = 0, failed = 0, knownIssues = 0, warned = 0;
const failures = [];
const knownIssueList = [];
const warnings = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  ${name}`);
  console.log(`${'═'.repeat(70)}`);
}

/**
 * Adversarial test helper.
 * @param {string} desc - Test description
 * @param {string} input - User input
 * @param {object} context - CRE context
 * @param {object} opts
 * @param {string} [opts.primary] - Expected primary intent
 * @param {string[]} opts.acceptable - Acceptable intents (including primary)
 * @param {string[]} opts.forbidden - Forbidden intents (FAIL if matched)
 * @param {boolean} [opts.knownIssue] - If true, forbidden match = KNOWN_ISSUE not FAIL
 */
async function adv(desc, input, context, opts) {
  total++;
  const { primary, acceptable = [], forbidden = [], knownIssue = false } = opts;
  try {
    const d = await cre.decide(input, context);
    const intent = d.intent;

    if (forbidden.includes(intent)) {
      if (knownIssue) {
        knownIssues++;
        console.log(`  \x1b[33m⚠ KNOWN\x1b[0m ${desc}`);
        console.log(`         → got ${intent} (known weakness)`);
        knownIssueList.push({ section: currentSection, desc, intent, input: input.substring(0, 60) });
        return;
      }
      failed++;
      console.log(`  \x1b[31m❌ FAIL\x1b[0m  ${desc}`);
      console.log(`         → got ${intent} (FORBIDDEN)`);
      failures.push({ section: currentSection, desc, intent, input: input.substring(0, 60) });
      return;
    }

    if (primary && intent === primary) {
      passed++;
      console.log(`  \x1b[32m✅ PASS\x1b[0m  ${desc} → ${intent}`);
      return;
    }

    if (acceptable.includes(intent)) {
      passed++;
      console.log(`  \x1b[32m✅ PASS\x1b[0m  ${desc} → ${intent}`);
      return;
    }

    // Not forbidden, not expected — warn
    warned++;
    console.log(`  \x1b[35m⚡ WARN\x1b[0m  ${desc}`);
    console.log(`         → got ${intent} (not forbidden, not expected)`);
    warnings.push({ section: currentSection, desc, intent, input: input.substring(0, 60) });
  } catch (err) {
    failed++;
    console.log(`  \x1b[31m❌ ERROR\x1b[0m ${desc}: ${err.message}`);
    failures.push({ section: currentSection, desc, intent: 'ERROR', input: input.substring(0, 60) });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────
const cre = new CREDecisionEngine();

// Expertise contexts
const writerCtx = { hasActiveExpertise: true, expertise: BUILTIN_EXPERTISES.writer };
const dndCtx = { hasActiveExpertise: true, expertise: BUILTIN_EXPERTISES.dnd_master };
const songwriterCtx = { hasActiveExpertise: true, expertise: BUILTIN_EXPERTISES.songwriter };
const analystCtx = { hasActiveExpertise: true, expertise: BUILTIN_EXPERTISES.analyst };
const traderCtx = { hasActiveExpertise: true, expertise: BUILTIN_EXPERTISES.trader };
const accountantCtx = { hasActiveExpertise: true, expertise: BUILTIN_EXPERTISES.accountant };
const lawyerCtx = { hasActiveExpertise: true, expertise: BUILTIN_EXPERTISES.lawyer };
const doctorCtx = { hasActiveExpertise: true, expertise: BUILTIN_EXPERTISES.doctor };
const psychologistCtx = { hasActiveExpertise: true, expertise: BUILTIN_EXPERTISES.psychologist };
const aiExpertCtx = { hasActiveExpertise: true, expertise: BUILTIN_EXPERTISES.ai_expert };
const developerCtx = { hasActiveExpertise: true, expertise: BUILTIN_EXPERTISES.developer };
const technicianCtx = { hasActiveExpertise: true, expertise: BUILTIN_EXPERTISES.technician };
const politicalCtx = { hasActiveExpertise: true, expertise: BUILTIN_EXPERTISES.political_analyst };
const noCtx = {};
const projectCtx = { hasActiveProject: true, projectId: 1, projectName: 'test' };
const developerProjectCtx = { ...developerCtx, ...projectCtx };
const technicianProjectCtx = { ...technicianCtx, ...projectCtx };

// ═══════════════════════════════════════════════════════════════════════════════
// 1. POLYSEMY — Czech words with tech + non-tech meanings
// ═══════════════════════════════════════════════════════════════════════════════

section('1. POLYSEMY — tech vs non-tech word meanings');

await adv(
  'P1: "plán" = personal health plan (not software)',
  'Navrhni mi plán na zlepšení zdraví',
  noCtx,
  { primary: 'CREATIVE', acceptable: ['CREATIVE', 'CONVERSATIONAL'], forbidden: ['BUILD', 'DESIGN'], knownIssue: true },
);

await adv(
  'P2: "migrace" = emigration (not DB migration)',
  'Kolik lidí odešlo při migraci ze Sýrie?',
  noCtx,
  { primary: 'SEARCH', acceptable: ['SEARCH', 'CONVERSATIONAL'], forbidden: ['CODE', 'DESIGN', 'BUILD'] },
);

await adv(
  'P3: "architektura" = gothic buildings (not software)',
  'Jaká je architektura gotických katedrál?',
  noCtx,
  { primary: 'SEARCH', acceptable: ['CONVERSATIONAL', 'SEARCH'], forbidden: ['DESIGN'] },
);

await adv(
  'P4: "vybudovat" = muscle (not software build)',
  'Jak si vybudovat svalovou hmotu za 3 měsíce?',
  noCtx,
  { primary: 'SEARCH', acceptable: ['CONVERSATIONAL', 'SEARCH', 'CREATIVE'], forbidden: ['BUILD'] },
);

await adv(
  'P5: "pipeline" = oil (not CI/CD)',
  'Jak dlouhý je ropný pipeline z Ruska do Evropy?',
  noCtx,
  { primary: 'SEARCH', acceptable: ['SEARCH', 'CONVERSATIONAL'], forbidden: ['BUILD', 'CODE'] },
);

await adv(
  'P6: "server" = restaurant waiter (not computer)',
  'Jaký je nejlepší server v této restauraci?',
  noCtx,
  { primary: 'CONVERSATIONAL', acceptable: ['CONVERSATIONAL', 'SEARCH'], forbidden: ['CODE', 'BUILD'] },
);

await adv(
  'P7: "operace" = medical (not computing)',
  'Kolik trvá operace srdce?',
  doctorCtx,
  { primary: 'SEARCH', acceptable: ['CONVERSATIONAL', 'SEARCH'], forbidden: ['CODE', 'SHELL'] },
);

await adv(
  'P8: "platforma" = political (not software)',
  'Jaká je politická platforma strany ANO?',
  politicalCtx,
  { primary: 'SEARCH', acceptable: ['CONVERSATIONAL', 'SEARCH'], forbidden: ['DESIGN', 'BUILD', 'CODE'] },
);

await adv(
  'P9: "model" = fashion (not ML)',
  'Kdo je nejlépe placený model na světě?',
  noCtx,
  { primary: 'SEARCH', acceptable: ['SEARCH', 'CONVERSATIONAL'], forbidden: ['CODE', 'DESIGN'] },
);

await adv(
  'P10: "framework" = theoretical sociology (not software)',
  'Jaký je teoretický framework pro analýzu sociální nerovnosti?',
  noCtx,
  { primary: 'CONVERSATIONAL', acceptable: ['CONVERSATIONAL', 'SEARCH'], forbidden: ['CODE', 'DESIGN'] },
);

await adv(
  'P11: "stack" = pancakes (not tech stack)',
  'Jak udělat stack palačinek jako v americkém diner?',
  noCtx,
  { primary: 'CONVERSATIONAL', acceptable: ['CONVERSATIONAL', 'CREATIVE', 'SEARCH'], forbidden: ['BUILD', 'DESIGN'] },
);

// ═══════════════════════════════════════════════════════════════════════════════
// 2. AMBIGUOUS PHRASING — legitimately unclear inputs
// ═══════════════════════════════════════════════════════════════════════════════

section('2. AMBIGUOUS — legitimately unclear inputs');

// Universal forbidden for ambiguous: never trigger destructive intents
const AMB_FORBIDDEN = ['BUILD', 'FILE_WRITE', 'SHELL'];

await adv(
  'A1: "řekni mi víc" — no referent',
  'Řekni mi víc',
  noCtx,
  { acceptable: ['AMBIGUOUS', 'CONVERSATIONAL'], forbidden: [...AMB_FORBIDDEN, 'SEARCH', 'REPORT'] },
);

await adv(
  'A2: "potřebuji to opravit" — code or real life?',
  'Potřebuji to opravit',
  noCtx,
  { acceptable: ['AMBIGUOUS', 'CODE', 'CONVERSATIONAL'], forbidden: AMB_FORBIDDEN },
);

await adv(
  'A3: single word "databáze" — no context',
  'Databáze',
  noCtx,
  { acceptable: ['AMBIGUOUS', 'CONVERSATIONAL'], forbidden: [...AMB_FORBIDDEN, 'CODE', 'DESIGN'] },
);

await adv(
  'A4: "udělej to" — imperative without object',
  'Udělej to',
  noCtx,
  { acceptable: ['AMBIGUOUS', 'CONVERSATIONAL'], forbidden: AMB_FORBIDDEN },
);

await adv(
  'A5: "run it" — anaphora without referent',
  'Run it',
  noCtx,
  { acceptable: ['SHELL', 'AMBIGUOUS', 'CONVERSATIONAL'], forbidden: ['BUILD', 'FILE_WRITE'] },
);

await adv(
  'A6: "ano" — confirmation without context',
  'Ano',
  noCtx,
  { acceptable: ['CONVERSATIONAL', 'AMBIGUOUS'], forbidden: ['SEARCH', 'BUILD', 'CODE'] },
);

await adv(
  'A7: "co umíš?" — meta-question about system',
  'Co umíš?',
  noCtx,
  { primary: 'CONVERSATIONAL', acceptable: ['CONVERSATIONAL'], forbidden: ['SEARCH'] },
);

await adv(
  'A8: emoji-only input',
  '👍',
  noCtx,
  { acceptable: ['CONVERSATIONAL', 'AMBIGUOUS'], forbidden: AMB_FORBIDDEN },
);

await adv(
  'A9: long but contentless',
  'No tak já nevím, prostě něco zajímavého, cokoliv vlastně',
  noCtx,
  { acceptable: ['AMBIGUOUS', 'CONVERSATIONAL'], forbidden: ['SEARCH', 'REPORT', 'CODE'] },
);

await adv(
  'A10: URL-only input',
  'https://github.com/some/repo',
  noCtx,
  { acceptable: ['AMBIGUOUS', 'CONVERSATIONAL', 'SEARCH'], forbidden: AMB_FORBIDDEN },
);

// ═══════════════════════════════════════════════════════════════════════════════
// 3. NEGATION — explicit "ne X ale Y"
// ═══════════════════════════════════════════════════════════════════════════════

section('3. NEGATION — "nechci X, chci Y"');

await adv(
  'N1: "nechci kód" — negated CODE intent',
  'Nechci kód, vysvětli mi princip rekurze',
  noCtx,
  { primary: 'CONVERSATIONAL', acceptable: ['CONVERSATIONAL'], forbidden: ['CODE'], knownIssue: true },
);

await adv(
  'N2: "nehledej" — negated SEARCH (contains "hledej")',
  'Nehledej na internetu, řekni mi co víš o kvantové fyzice',
  noCtx,
  { primary: 'CONVERSATIONAL', acceptable: ['CONVERSATIONAL'], forbidden: ['SEARCH'], knownIssue: true },
);

await adv(
  'N3: "nechci návrh" — negated DESIGN',
  'Ne, nechci architektonický návrh, jen mi dej pár nápadů',
  noCtx,
  { primary: 'CREATIVE', acceptable: ['CREATIVE', 'CONVERSATIONAL'], forbidden: ['DESIGN'], knownIssue: true },
);

await adv(
  'N4: "neukládej do souboru" — negated FILE_WRITE',
  'Neukládej to do souboru, jen to napiš sem',
  noCtx,
  { primary: 'CONVERSATIONAL', acceptable: ['CONVERSATIONAL', 'CREATIVE'], forbidden: ['FILE_WRITE'], knownIssue: true },
);

await adv(
  'N5: "nebudu stavět" — negated BUILD',
  'Nebudu to stavět, jen mi vysvětli jak by se to dalo udělat',
  noCtx,
  { primary: 'CONVERSATIONAL', acceptable: ['CONVERSATIONAL', 'CREATIVE'], forbidden: ['BUILD'], knownIssue: true },
);

await adv(
  'N6: "nespouštěj" — negated SHELL',
  'Nespouštěj ten příkaz, jen mi vysvětli co dělá git rebase',
  noCtx,
  { primary: 'CONVERSATIONAL', acceptable: ['CONVERSATIONAL', 'CODE'], forbidden: ['SHELL'], knownIssue: true },
);

await adv(
  'N7: "nechci nápady" — negated CREATIVE',
  'Nechci nápady, chci tvrdá fakta o solárních panelech',
  noCtx,
  { primary: 'SEARCH', acceptable: ['SEARCH', 'FACTUAL'], forbidden: ['CREATIVE'], knownIssue: true },
);

await adv(
  'N8: "nechci report" — negated REPORT',
  'Ne, nechci report, jen mi řekni kolik to stojí',
  noCtx,
  { primary: 'SEARCH', acceptable: ['SEARCH', 'FACTUAL', 'CONVERSATIONAL'], forbidden: ['REPORT'], knownIssue: true },
);

await adv(
  'N9: "nečti soubor" — negated FILE_READ',
  'Nečti ten soubor, jen mi řekni kde je',
  noCtx,
  { primary: 'CONVERSATIONAL', acceptable: ['CONVERSATIONAL', 'SEARCH'], forbidden: ['FILE_READ'], knownIssue: true },
);

await adv(
  'N10: "žádný build" — negated BUILD with "plán"',
  'Žádný build, potřebuju jen plán jak to udělat',
  noCtx,
  { primary: 'DESIGN', acceptable: ['DESIGN', 'CREATIVE', 'CONVERSATIONAL'], forbidden: ['BUILD'], knownIssue: true },
);

// ═══════════════════════════════════════════════════════════════════════════════
// 4. CROSS-DOMAIN COLLISION — same input, different expertise
// ═══════════════════════════════════════════════════════════════════════════════

section('4. CROSS-DOMAIN COLLISION — expertise affects classification');

// X1: "kampaň" — writer vs no expertise
await adv(
  'X1a: "navrhni kampaň" + writer → CREATIVE',
  'Navrhni kampaň pro nový produkt',
  writerCtx,
  { primary: 'CREATIVE', acceptable: ['CREATIVE'], forbidden: ['DESIGN', 'SEARCH'] },
);
await adv(
  'X1b: "navrhni kampaň" + no expertise → CREATIVE or DESIGN',
  'Navrhni kampaň pro nový produkt',
  noCtx,
  { acceptable: ['CREATIVE', 'DESIGN', 'CONVERSATIONAL'], forbidden: ['BUILD', 'CODE'] },
);

// X2: "analyzuj model" — ai_expert vs psychologist
await adv(
  'X2a: "analyzuj model" + ai_expert → analytical',
  'Analyzuj tento model',
  aiExpertCtx,
  { acceptable: ['CONVERSATIONAL', 'CODE', 'REPORT', 'SEARCH'], forbidden: ['CREATIVE'] },
);
await adv(
  'X2b: "analyzuj model" + psychologist → creative/conversational',
  'Analyzuj tento model',
  psychologistCtx,
  { acceptable: ['CREATIVE', 'CONVERSATIONAL', 'SEARCH'], forbidden: ['CODE', 'DESIGN'] },
);

// X3: "strategie" — trader vs dnd_master
await adv(
  'X3a: "nejlepší strategie" + trader → factual',
  'Jaké jsou nejlepší strategie?',
  traderCtx,
  { acceptable: ['CONVERSATIONAL', 'SEARCH'], forbidden: ['CREATIVE'] },
);
await adv(
  'X3b: "nejlepší strategie" + dnd_master → creative',
  'Jaké jsou nejlepší strategie?',
  dndCtx,
  { primary: 'CREATIVE', acceptable: ['CREATIVE', 'CONVERSATIONAL'], forbidden: ['SEARCH'] },
);

// X4: "server" — developer+project vs no context
await adv(
  'X4a: "popiš server" + developer+project → file context',
  'Popiš mi ten server',
  developerProjectCtx,
  { acceptable: ['FILE_READ', 'FILE_EXPLAIN', 'CONVERSATIONAL'], forbidden: ['SEARCH'] },
);
await adv(
  'X4b: "popiš server" + no context → general',
  'Popiš mi ten server',
  noCtx,
  { acceptable: ['CONVERSATIONAL', 'SEARCH'], forbidden: ['FILE_READ', 'FILE_EXPLAIN'], knownIssue: true },
);

// X5: "příběh o robotovi" — writer vs developer
await adv(
  'X5a: "příběh o robotovi" + writer → creative',
  'Vytvoř příběh o robotovi',
  writerCtx,
  { primary: 'CREATIVE', acceptable: ['CREATIVE'], forbidden: ['CODE', 'BUILD'] },
);
await adv(
  'X5b: "příběh o robotovi" + developer → still creative',
  'Vytvoř příběh o robotovi',
  developerCtx,
  { acceptable: ['CREATIVE', 'CONVERSATIONAL'], forbidden: ['BUILD'] },
);

// X6: "Prokletý ostrov" — dnd_master vs no expertise
await adv(
  'X6a: "Prokletý ostrov" + dnd_master → creative (not film search)',
  'Prokletý ostrov',
  dndCtx,
  { primary: 'CREATIVE', acceptable: ['CREATIVE', 'CONVERSATIONAL'], forbidden: ['SEARCH'] },
);
await adv(
  'X6b: "Prokletý ostrov" + no expertise → search or ambiguous',
  'Prokletý ostrov',
  noCtx,
  { acceptable: ['SEARCH', 'AMBIGUOUS', 'CONVERSATIONAL'], forbidden: ['CREATIVE'] },
);

// X7: "DPH" — accountant vs no expertise (both should be LOCAL)
await adv(
  'X7a: "spočítej DPH" + accountant → LOCAL',
  'Spočítej mi DPH z 15000 Kč',
  accountantCtx,
  { primary: 'LOCAL', acceptable: ['LOCAL', 'CONVERSATIONAL'], forbidden: [] },
);
await adv(
  'X7b: "spočítej DPH" + no expertise → LOCAL',
  'Spočítej mi DPH z 15000 Kč',
  noCtx,
  { primary: 'LOCAL', acceptable: ['LOCAL', 'CONVERSATIONAL', 'SEARCH'], forbidden: [] },
);

// X8: "co je nového" — political_analyst vs songwriter
await adv(
  'X8a: "co je nového" + political_analyst → SEARCH',
  'Co je nového?',
  politicalCtx,
  { primary: 'SEARCH', acceptable: ['SEARCH', 'CONVERSATIONAL'], forbidden: ['CREATIVE'] },
);
await adv(
  'X8b: "co je nového" + songwriter → CREATIVE (guard 6)',
  'Co je nového?',
  songwriterCtx,
  { primary: 'CREATIVE', acceptable: ['CREATIVE', 'CONVERSATIONAL'], forbidden: ['SEARCH'] },
);

// X9: "udělej lépe" — technician+project vs psychologist
await adv(
  'X9a: "udělat lépe" + technician+project → technical',
  'Jak by to šlo udělat lépe?',
  technicianProjectCtx,
  { acceptable: ['CONVERSATIONAL', 'DESIGN', 'CODE'], forbidden: ['CREATIVE'] },
);
await adv(
  'X9b: "udělat lépe" + psychologist → creative/personal',
  'Jak by to šlo udělat lépe?',
  psychologistCtx,
  { acceptable: ['CREATIVE', 'CONVERSATIONAL'], forbidden: ['CODE', 'DESIGN', 'BUILD'] },
);

// ═══════════════════════════════════════════════════════════════════════════════
// 5. INJECTION — tech words in non-tech context
// ═══════════════════════════════════════════════════════════════════════════════

section('5. INJECTION — tech words in non-tech context');

await adv(
  'I1: "framework + deployment" in essay about social justice',
  'Napiš esej o tom jak framework sociální spravedlnosti ovlivňuje deployment humanitární pomoci',
  noCtx,
  { primary: 'CREATIVE', acceptable: ['CREATIVE', 'CONVERSATIONAL'], forbidden: ['CODE', 'BUILD'] },
);

await adv(
  'I2: "iterativní proces" in bread baking',
  'Jak se dělá iterativní proces přípravy kvásku na chleba?',
  noCtx,
  { primary: 'CONVERSATIONAL', acceptable: ['CONVERSATIONAL', 'SEARCH'], forbidden: ['CODE'] },
);

await adv(
  'I3: "chci stavět" = house (not software)',
  'Chci stavět dům ze dřeva v Krkonoších',
  noCtx,
  { primary: 'SEARCH', acceptable: ['SEARCH', 'CONVERSATIONAL', 'CREATIVE'], forbidden: ['BUILD'], knownIssue: true },
);

await adv(
  'I4: "nasazeny" = military tanks (not deploy)',
  'Kdy byly poprvé nasazeny tanky v první světové válce?',
  noCtx,
  { primary: 'SEARCH', acceptable: ['CONVERSATIONAL', 'SEARCH'], forbidden: ['BUILD'] },
);

await adv(
  'I5: "servíruje" ≠ "server"',
  'Život mi servíruje jednu překvapení za druhým',
  noCtx,
  { primary: 'CONVERSATIONAL', acceptable: ['CONVERSATIONAL', 'CREATIVE'], forbidden: ['CODE', 'SHELL', 'BUILD'] },
);

await adv(
  'I6: 4 stacked tech keywords in personal context',
  'Můj pipeline na zpracování informací z knih zahrnuje architekturu čtení, build návyku a deploy znalostí do praxe',
  noCtx,
  { primary: 'CONVERSATIONAL', acceptable: ['CONVERSATIONAL', 'CREATIVE'], forbidden: ['BUILD', 'DESIGN', 'CODE'], knownIssue: true },
);

await adv(
  'I7: "kód" = postal code (not programming)',
  'Jaký je poštovní kód pro Brno?',
  noCtx,
  { primary: 'SEARCH', acceptable: ['SEARCH', 'LOCAL', 'CONVERSATIONAL'], forbidden: ['CODE'] },
);

await adv(
  'I8: "curl" in English idiom quote',
  'Proč se říká "curl up with a good book" v angličtině?',
  noCtx,
  { primary: 'CONVERSATIONAL', acceptable: ['CONVERSATIONAL', 'SEARCH'], forbidden: ['SHELL'] },
);

await adv(
  'I9: "projekt + servery" = school assignment',
  'Moje dcera dělá ve škole projekt o serverech',
  noCtx,
  { primary: 'CONVERSATIONAL', acceptable: ['CONVERSATIONAL'], forbidden: ['BUILD', 'CODE'] },
);

await adv(
  'I10: "plán migrace — psychologický ne technický" (user example)',
  'Navrhni mi plán migrace — ale psychologický, ne technický',
  noCtx,
  { primary: 'CREATIVE', acceptable: ['CREATIVE', 'CONVERSATIONAL'], forbidden: ['BUILD', 'DESIGN'], knownIssue: true },
);

// ═══════════════════════════════════════════════════════════════════════════════
// 6. GUARD BYPASS — inputs targeting specific guards
// ═══════════════════════════════════════════════════════════════════════════════

section('6. GUARD BYPASS — targeting specific guards');

// GUARD 5 bypass: DESIGN_PATTERNS match on non-software content
await adv(
  'G5-1: "vytvoř plán + harmonogram" for vacation (not SW)',
  'Vytvoř mi podrobný plán rodinného výletu do Itálie včetně harmonogramu',
  noCtx,
  { primary: 'CREATIVE', acceptable: ['CREATIVE', 'CONVERSATIONAL'], forbidden: ['DESIGN'], knownIssue: true },
);

await adv(
  'G5-2: "navrhni architekturu" for garden (not SW)',
  'Navrhni mi architekturu zahrady s pergolou a fontánou',
  noCtx,
  { primary: 'CREATIVE', acceptable: ['CREATIVE', 'CONVERSATIONAL'], forbidden: ['DESIGN'], knownIssue: true },
);

await adv(
  'G5-3: "připrav roadmapu" for personal development (not SW)',
  'Připrav mi roadmapu osobního rozvoje na příští rok',
  noCtx,
  { primary: 'CREATIVE', acceptable: ['CREATIVE', 'CONVERSATIONAL'], forbidden: ['DESIGN'], knownIssue: true },
);

// GUARD 6: explicit search escape validation
await adv(
  'G6-1: "vyhledej" escapes creative lock (dnd_master)',
  'Vyhledej informace o dracích v mytologii',
  dndCtx,
  { primary: 'SEARCH', acceptable: ['SEARCH'], forbidden: ['CREATIVE'] },
);

await adv(
  'G6-2: "zjistit fakta" — NOT in escape list (dnd_master)',
  'Potřebuju zjistit fakta o historii draků v různých kulturách',
  dndCtx,
  { acceptable: ['SEARCH', 'CREATIVE'], forbidden: [], knownIssue: false },
);

await adv(
  'G6-3: "skutečná historie" — NOT "ve skutečnost" (writer)',
  'Jaká je skutečná historie tohoto místa?',
  writerCtx,
  { primary: 'SEARCH', acceptable: ['SEARCH', 'CONVERSATIONAL'], forbidden: ['CREATIVE'], knownIssue: true },
);

// GUARD 7: BUILD false-positive without pattern match
await adv(
  'G7-1: "budovat komunitní zahradu" — not software',
  'Pojďme začít budovat komunitní zahradu',
  noCtx,
  { primary: 'CONVERSATIONAL', acceptable: ['CONVERSATIONAL', 'CREATIVE'], forbidden: ['BUILD'], knownIssue: true },
);

await adv(
  'G7-2: "postav mi kompletní systém" — valid BUILD (bird tracking could be SW)',
  'Postav mi kompletní systém pro sledování ptáků',
  noCtx,
  { primary: 'BUILD', acceptable: ['BUILD', 'DESIGN'], forbidden: [] },
);

await adv(
  'G7-3: "navrhni plán firemní kultury" — G7 → DESIGN, but HR not SW',
  'Navrhni plán na zlepšení firemní kultury od náboru po teambuilding',
  noCtx,
  { acceptable: ['CREATIVE', 'DESIGN', 'CONVERSATIONAL'], forbidden: ['BUILD'], knownIssue: false },
);

// GUARD 2: path traversal sanitization
await adv(
  'G2-1: path traversal in file write',
  'Ulož to do ../../etc/passwd',
  noCtx,
  { acceptable: ['FILE_WRITE', 'CONVERSATIONAL'], forbidden: [] },
);

await adv(
  'G6-4: "historická fakta" escapes creative lock (dnd_master)',
  'Historická fakta o Prokletém ostrově',
  dndCtx,
  { primary: 'SEARCH', acceptable: ['SEARCH', 'CONVERSATIONAL'], forbidden: ['CREATIVE'] },
);

await adv(
  'G5-4: "spusť design systém" — SHELL vs DESIGN collision',
  'Spusť design systém pro naši firmu',
  noCtx,
  { acceptable: ['DESIGN', 'CREATIVE', 'CONVERSATIONAL'], forbidden: ['SHELL'], knownIssue: true },
);

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(70)}`);
console.log(`  ADVERSARIAL CRE TEST RESULTS`);
console.log(`${'═'.repeat(70)}`);
console.log(`  Total:        ${total}`);
console.log(`  \x1b[32mPassed:       ${passed}\x1b[0m`);
console.log(`  \x1b[31mFailed:       ${failed}\x1b[0m`);
console.log(`  \x1b[33mKnown Issue:  ${knownIssues}\x1b[0m`);
console.log(`  \x1b[35mWarnings:     ${warned}\x1b[0m`);
console.log(`${'═'.repeat(70)}`);

if (failures.length > 0) {
  console.log(`\n  FAILURES (regressions):`);
  for (const f of failures) {
    console.log(`  ❌ [${f.section}] ${f.desc} → ${f.intent}`);
  }
}

if (knownIssueList.length > 0) {
  console.log(`\n  KNOWN ISSUES (documented weaknesses):`);
  for (const k of knownIssueList) {
    console.log(`  ⚠  [${k.section}] ${k.desc} → ${k.intent}`);
  }
}

if (warnings.length > 0) {
  console.log(`\n  WARNINGS (unexpected but not forbidden):`);
  for (const w of warnings) {
    console.log(`  ⚡ [${w.section}] ${w.desc} → ${w.intent}`);
  }
}

console.log('');

process.exit(failed > 0 ? 1 : 0);
