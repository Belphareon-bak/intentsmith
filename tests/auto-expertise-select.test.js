#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════
// C3-Agent — Auto Expertise Selection Tests v87
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests for the deterministic vocabulary-based expertise matcher.
// Validates: exact matches, boost patterns, ambiguity, threshold, anti-flip-flop.
//
// Run: node tests/auto-expertise-select.test.js
// ══════════════════════════════════════════════════════════════════════════════

import { autoSelectExpertise, _testInternals } from '../src/expertises/auto-select.js';

const { _sharedTerms, THRESHOLD, HYSTERESIS_RATIO } = _testInternals;

// ─────────────────────────────────────────────────────────────────────────────
// Test Runner
// ─────────────────────────────────────────────────────────────────────────────
let total = 0, passed = 0, failed = 0;
const failures = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${'─'.repeat(60)}`);
}

function test(desc, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✅\x1b[0m ${desc}`);
  } catch (err) {
    failed++;
    const msg = `[${currentSection}] ${desc}: ${err.message}`;
    failures.push(msg);
    console.log(`  \x1b[31m❌\x1b[0m ${desc}`);
    console.log(`     → ${err.message}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg ? msg + ' — ' : ''}expected "${expected}", got "${actual}"`);
  }
}

function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. EXACT VOCABULARY MATCH — one per expertise
// ═══════════════════════════════════════════════════════════════════════════════
section('1. Exact vocabulary match (15 tests)');

test('writer: "kapitola" + "dialog"', () => {
  const r = autoSelectExpertise('Napiš mi druhou kapitolu s živým dialogem');
  assertEqual(r.expertiseId, 'writer');
});

test('dnd_master: "quest" + "NPC"', () => {
  const r = autoSelectExpertise('Vytvoř quest s NPC obchodníkem');
  assertEqual(r.expertiseId, 'dnd_master');
});

test('songwriter: "refrén" + "sloka"', () => {
  const r = autoSelectExpertise('Napiš mi refrén a druhou sloku');
  assertEqual(r.expertiseId, 'songwriter');
});

test('analyst: "srovnání" + "pro/proti"', () => {
  const r = autoSelectExpertise('Udělej srovnání pro a proti těchto variant');
  assertEqual(r.expertiseId, 'analyst');
});

test('trader: "marže" + "bazar"', () => {
  const r = autoSelectExpertise('Jaká je obvyklá marže na bazaru?');
  assertEqual(r.expertiseId, 'trader');
});

test('accountant: "DPH" + "základ daně"', () => {
  const r = autoSelectExpertise('Jak vypočítám DPH ze základu daně?');
  assertEqual(r.expertiseId, 'accountant');
});

test('lawyer: "paragraf" + "judikatura"', () => {
  const r = autoSelectExpertise('Jaký paragraf se na to vztahuje? Existuje judikatura?');
  assertEqual(r.expertiseId, 'lawyer');
});

test('doctor: "symptom" + "vyšetření"', () => {
  const r = autoSelectExpertise('Jaké symptomy vyžadují vyšetření?');
  assertEqual(r.expertiseId, 'doctor');
});

test('psychologist: "emoce" + "empatie"', () => {
  const r = autoSelectExpertise('Jak projevit emoce a empatii v rozhovoru?');
  assertEqual(r.expertiseId, 'psychologist');
});

test('ai_expert: "LLM" + "embedding"', () => {
  const r = autoSelectExpertise('Jak funguje LLM s embedding vrstvou?');
  assertEqual(r.expertiseId, 'ai_expert');
});

test('developer: "refactoring" + "clean code"', () => {
  const r = autoSelectExpertise('Potřebuju refactoring na clean code principech');
  assertEqual(r.expertiseId, 'developer');
});

test('technician: "nástroj" + "bezpečnost" + "postup"', () => {
  const r = autoSelectExpertise('Jaký nástroj použít? Dodržuj bezpečnost a správný postup');
  assertEqual(r.expertiseId, 'technician');
});

test('car_enthusiast: "převodovka" + "spotřeba"', () => {
  const r = autoSelectExpertise('Jaká převodovka má nižší spotřebu?');
  assertEqual(r.expertiseId, 'car_enthusiast');
});

test('biker: "helma" + "kubatura"', () => {
  const r = autoSelectExpertise('Jakou helmu na motorku s kubaturou 650?');
  assertEqual(r.expertiseId, 'biker');
});

test('political_analyst: "geopolitika" + "legislativa"', () => {
  const r = autoSelectExpertise('Jaký vliv má geopolitika na legislativu EU?');
  assertEqual(r.expertiseId, 'political_analyst');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. BOOST PATTERN MATCH — high-confidence domain indicators
// ═══════════════════════════════════════════════════════════════════════════════
section('2. Boost pattern match (10 tests)');

test('accountant boost: "DPH" alone', () => {
  const r = autoSelectExpertise('Kolik je DPH z 15000 Kč?');
  assertEqual(r.expertiseId, 'accountant');
});

test('accountant boost: "OSVČ"', () => {
  const r = autoSelectExpertise('Jak vyplnit daňové přiznání jako OSVČ?');
  assertEqual(r.expertiseId, 'accountant');
});

test('ai_expert boost: "transformer"', () => {
  const r = autoSelectExpertise('Vysvětli mi jak funguje transformer');
  assertEqual(r.expertiseId, 'ai_expert');
});

test('dnd_master boost: "D&D"', () => {
  const r = autoSelectExpertise('Hrajeme D&D a potřebuju dobrodružství');
  assertEqual(r.expertiseId, 'dnd_master');
});

test('developer boost: "naprogramuj"', () => {
  const r = autoSelectExpertise('Naprogramuj mi kalkulačku v Pythonu');
  assertEqual(r.expertiseId, 'developer');
});

test('political_analyst boost: "politický"', () => {
  const r = autoSelectExpertise('Jaká je politická situace v Evropě?');
  assertEqual(r.expertiseId, 'political_analyst');
});

test('lawyer boost: "§ 420"', () => {
  const r = autoSelectExpertise('Co říká § 420 občanského zákoníku?');
  assertEqual(r.expertiseId, 'lawyer');
});

test('doctor boost: "diagnóza"', () => {
  const r = autoSelectExpertise('Jaký lékař stanoví diagnózu?');
  assertEqual(r.expertiseId, 'doctor');
});

test('technician boost: "nefunguje"', () => {
  const r = autoSelectExpertise('Nefunguje mi tiskárna, co s tím?');
  assertEqual(r.expertiseId, 'technician');
});

test('biker boost: "motorka"', () => {
  const r = autoSelectExpertise('Jakou motorku pro začátečníka?');
  assertEqual(r.expertiseId, 'biker');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. AMBIGUOUS VOCABULARY — shared terms across expertises
// ═══════════════════════════════════════════════════════════════════════════════
section('3. Ambiguous vocabulary (8 tests)');

test('shared terms precomputation — "analýza" is shared', () => {
  assert(_sharedTerms.has('analýza'), '"analýza" should be shared between analyst and political_analyst');
});

test('shared terms precomputation — "diagnóza" is shared', () => {
  assert(_sharedTerms.has('diagnóza'), '"diagnóza" should be shared between doctor and technician');
});

test('shared terms precomputation — "perspektiva" is shared', () => {
  assert(_sharedTerms.has('perspektiva'), '"perspektiva" should be shared');
});

test('"analýza" alone → below threshold (shared term 0.5)', () => {
  const r = autoSelectExpertise('Udělej analýzu');
  // "analýza" is shared (0.5) — below threshold 2.0
  assertEqual(r.expertiseId, null, 'shared term alone should not select');
});

test('"analýza" + "srovnání" → analyst (2 vocab hits)', () => {
  const r = autoSelectExpertise('Potřebuju analýzu a srovnání');
  assertEqual(r.expertiseId, 'analyst');
});

test('"diagnóza" + doctor boost "symptomy" → doctor', () => {
  const r = autoSelectExpertise('Jaké symptomy vedou k diagnóze?');
  assertEqual(r.expertiseId, 'doctor');
});

test('"nefunguje" + technician vocab "postup" → technician', () => {
  const r = autoSelectExpertise('Nefunguje mi to, jaký je správný postup opravy?');
  assertEqual(r.expertiseId, 'technician');
});

test('"perspektiva" + "emoce" → psychologist', () => {
  const r = autoSelectExpertise('Z jaké perspektivy vnímáme emoce?');
  assertEqual(r.expertiseId, 'psychologist');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. BELOW THRESHOLD — generic inputs that should NOT select any expertise
// ═══════════════════════════════════════════════════════════════════════════════
section('4. Below threshold (5 tests)');

test('"ahoj" → null', () => {
  const r = autoSelectExpertise('ahoj');
  assertEqual(r.expertiseId, null);
});

test('"jak se máš?" → null', () => {
  const r = autoSelectExpertise('jak se máš?');
  assertEqual(r.expertiseId, null);
});

test('"díky za pomoc" → null', () => {
  const r = autoSelectExpertise('díky za pomoc');
  assertEqual(r.expertiseId, null);
});

test('"co je nového?" → null', () => {
  const r = autoSelectExpertise('co je nového?');
  assertEqual(r.expertiseId, null);
});

test('"jaké bude počasí?" → null', () => {
  const r = autoSelectExpertise('jaké bude počasí?');
  assertEqual(r.expertiseId, null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. ANTI-FLIP-FLOP — hysteresis for previous auto-selected expertise
// ═══════════════════════════════════════════════════════════════════════════════
section('5. Anti-flip-flop (3 tests)');

test('previous within hysteresis → preferred', () => {
  // analyst wins (vocab+boost), but political_analyst was previous and within 80%
  const r = autoSelectExpertise('Politická analýza a srovnání perspektiv', {
    previousAutoExpertiseId: 'political_analyst',
  });
  // analyst: 'analýza' shared 0.5 + 'srovnání' 1.0 + 'perspektiva' shared 0.5 + boost 'srovnání' 3.0 = 5.0
  // political_analyst: 'analýza' shared 0.5 + 'perspektiva' shared 0.5 + boost 'politick' 3.0 = 4.0
  // Winner: analyst (5.0), previous: political_analyst (4.0)
  // 4.0 >= 0.8 × 5.0 = 4.0 → YES → political_analyst preferred via hysteresis!
  assertEqual(r.expertiseId, 'political_analyst');
});

test('previous NOT within hysteresis → new winner', () => {
  // Clear mismatch — previous was writer but input is clearly accountant
  const r = autoSelectExpertise('Kolik je DPH ze základu daně?', {
    previousAutoExpertiseId: 'writer',
  });
  assertEqual(r.expertiseId, 'accountant');
});

test('no previous → normal selection', () => {
  const r = autoSelectExpertise('Jaký paragraf se vztahuje k tomuto případu?');
  assertEqual(r.expertiseId, 'lawyer');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════════
section('6. Edge cases (3 tests)');

test('empty string → null', () => {
  const r = autoSelectExpertise('');
  assertEqual(r.expertiseId, null);
});

test('emoji only → null', () => {
  const r = autoSelectExpertise('👍🎉😀');
  assertEqual(r.expertiseId, null);
});

test('very long input (10k chars) → no crash', () => {
  const longInput = 'a'.repeat(10000);
  const r = autoSelectExpertise(longInput);
  assertEqual(r.expertiseId, null);
  assert(r.confidence === 0, 'confidence should be 0');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. PERFORMANCE
// ═══════════════════════════════════════════════════════════════════════════════
section('7. Performance (1 test)');

test('1000 iterations < 100ms', () => {
  const inputs = [
    'Kolik je DPH?',
    'Napiš příběh o drakovi',
    'ahoj jak se máš',
    'Vysvětli mi transformer architekturu',
    'Jaký paragraf občanského zákoníku?',
    'Nefunguje mi tiskárna',
    'Jakou motorku doporučíš?',
    'Udělej analýzu a srovnání',
    'Jaká je politická situace?',
    'Kolik stojí ojetina?',
  ];
  const start = performance.now();
  for (let i = 0; i < 1000; i++) {
    autoSelectExpertise(inputs[i % inputs.length]);
  }
  const elapsed = performance.now() - start;
  assert(elapsed < 100, `1000 iterations took ${elapsed.toFixed(1)}ms (max 100ms)`);
  console.log(`     (${elapsed.toFixed(1)}ms for 1000 iterations)`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. RESULT STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════════
section('8. Result structure (3 tests)');

test('result has all required fields', () => {
  const r = autoSelectExpertise('Kolik je DPH?');
  assert('expertiseId' in r, 'missing expertiseId');
  assert('confidence' in r, 'missing confidence');
  assert('scores' in r, 'missing scores');
  assert('reason' in r, 'missing reason');
});

test('confidence is between 0 and 1', () => {
  const r = autoSelectExpertise('Kolik je DPH ze základu daně jako OSVČ s paušálními výdaji a odvody?');
  assert(r.confidence >= 0 && r.confidence <= 1, `confidence ${r.confidence} out of range`);
});

test('scores contains all 15 expertises', () => {
  const r = autoSelectExpertise('test');
  const expertiseCount = Object.keys(r.scores).length;
  assert(expertiseCount === 15, `expected 15 expertises in scores, got ${expertiseCount}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`);
console.log(`  AUTO-SELECT TEST RESULTS`);
console.log(`${'═'.repeat(60)}`);
console.log(`  Total:  ${total}`);
console.log(`  \x1b[32mPassed: ${passed}\x1b[0m`);
if (failed > 0) {
  console.log(`  \x1b[31mFailed: ${failed}\x1b[0m`);
  console.log(`${'═'.repeat(60)}\n`);
  console.log(`  FAILURES:`);
  for (const f of failures) {
    console.log(`  ❌ ${f}`);
  }
}
console.log(`${'═'.repeat(60)}`);

process.exit(failed > 0 ? 1 : 0);
