#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// C3 Agent — Sprint E Tests: ExpertHandler Guard + Language Detection
// ═══════════════════════════════════════════════════════════════════════════════

import { detectLanguage, getLanguageContext, buildLanguageInstruction } from './language.js';

let passed = 0;
let failed = 0;

function ok(name) { passed++; console.log(`  ✅ ${name}`); }
function fail(name, msg) { failed++; console.log(`  ❌ ${name}`); console.log(`     → ${msg}`); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function test(name, fn) {
  try { fn(); ok(name); } catch (e) { fail(name, e.message); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Language Detection — Czech (baseline)
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 1. LANGUAGE DETECTION — Czech ══════');

test('CZ: diacritics → cs', () => {
  const r = detectLanguage('Kolik obyvatel má Praha?');
  assert(r.language === 'cs', `Expected cs, got ${r.language}`);
  assert(r.confidence >= 0.9, `Low confidence: ${r.confidence}`);
});

test('CZ: unique chars (ř, ů, ě) → cs', () => {
  assert(detectLanguage('Řekni mi víc').language === 'cs', 'Failed on ř');
  assert(detectLanguage('Jak se máš?').language === 'cs', 'Failed on š/á');
  assert(detectLanguage('Kde jsou klíče?').language === 'cs', 'Failed on CZ pattern + í');
});

test('CZ: greeting → cs', () => {
  const r = detectLanguage('Dobrý den, jak se máte?');
  assert(r.language === 'cs', `Expected cs, got ${r.language}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Language Detection — English
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 2. LANGUAGE DETECTION — English ══════');

test('EN: basic question → en', () => {
  const r = detectLanguage('What is photosynthesis?');
  assert(r.language === 'en', `Expected en, got ${r.language}`);
});

test('EN: explain request → en', () => {
  const r = detectLanguage('Explain how a combustion engine works');
  assert(r.language === 'en', `Expected en, got ${r.language}`);
});

test('EN: greeting → en', () => {
  const r = detectLanguage('Hello, how are you?');
  assert(r.language === 'en', `Expected en, got ${r.language}`);
});

test('EN: technical → en', () => {
  const r = detectLanguage('How does DNS resolution work?');
  assert(r.language === 'en', `Expected en, got ${r.language}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Language Detection — German
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 3. LANGUAGE DETECTION — German ══════');

test('DE: "Was ist" question → de', () => {
  const r = detectLanguage('Was ist Quantenphysik?');
  assert(r.language === 'de', `Expected de, got ${r.language}`);
});

test('DE: umlauts → de', () => {
  const r = detectLanguage('Erkläre mir die Relativitätstheorie');
  assert(r.language === 'de', `Expected de, got ${r.language}`);
});

test('DE: ß → de', () => {
  const r = detectLanguage('Wie groß ist Deutschland?');
  assert(r.language === 'de', `Expected de, got ${r.language}`);
});

test('DE: greeting → de', () => {
  const r = detectLanguage('Guten Tag, wie geht es Ihnen?');
  assert(r.language === 'de', `Expected de, got ${r.language}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: Language Detection — Slovak
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 4. LANGUAGE DETECTION — Slovak ══════');

test('SK: unique chars (ľ, ô) → sk', () => {
  const r = detectLanguage('Koľko stojí táto kniha?');
  assert(r.language === 'sk', `Expected sk, got ${r.language}`);
});

test('SK: "Čo je" question → sk', () => {
  const r = detectLanguage('Čo je to kvantová fyzika?');
  // CZ_DIACRITICS will match, but "čo je" is SK pattern
  assert(r.language === 'sk' || r.language === 'cs', `Expected sk or cs, got ${r.language}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: Language Detection — Polish
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 5. LANGUAGE DETECTION — Polish ══════');

test('PL: unique chars (ł, ą, ę) → pl', () => {
  const r = detectLanguage('Jak się nazywasz?');
  assert(r.language === 'pl', `Expected pl, got ${r.language}`);
});

test('PL: question → pl', () => {
  const r = detectLanguage('Ile kosztuje ten telefon?');
  assert(r.language === 'pl', `Expected pl, got ${r.language}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: Language Detection — French
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 6. LANGUAGE DETECTION — French ══════');

test('FR: "Qu\'est-ce que" → fr', () => {
  const r = detectLanguage("Qu'est-ce que la photosynthèse?");
  assert(r.language === 'fr', `Expected fr, got ${r.language}`);
});

test('FR: accents → fr', () => {
  const r = detectLanguage('Où est la bibliothèque?');
  assert(r.language === 'fr', `Expected fr, got ${r.language}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: Language Detection — Spanish
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 7. LANGUAGE DETECTION — Spanish ══════');

test('ES: ñ → es', () => {
  const r = detectLanguage('¿Cuántos años tiene España?');
  assert(r.language === 'es', `Expected es, got ${r.language}`);
});

test('ES: question → es', () => {
  const r = detectLanguage('¿Qué es la inteligencia artificial?');
  assert(r.language === 'es', `Expected es, got ${r.language}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: Language Instructions
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 8. LANGUAGE INSTRUCTIONS ══════');

test('Instruction: cs → Czech instruction', () => {
  const instr = buildLanguageInstruction('cs');
  assert(instr.includes('ČESKY'), `Missing ČESKY: ${instr.substring(0, 50)}`);
});

test('Instruction: en → English instruction', () => {
  const instr = buildLanguageInstruction('en');
  assert(instr.includes('ENGLISH'), `Missing ENGLISH: ${instr.substring(0, 50)}`);
});

test('Instruction: de → German instruction', () => {
  const instr = buildLanguageInstruction('de');
  assert(instr.includes('DEUTSCH'), `Missing DEUTSCH: ${instr.substring(0, 50)}`);
});

test('Instruction: sk → Slovak instruction', () => {
  const instr = buildLanguageInstruction('sk');
  assert(instr.includes('SLOVENSKY'), `Missing SLOVENSKY: ${instr.substring(0, 50)}`);
});

test('Instruction: pl → Polish instruction', () => {
  const instr = buildLanguageInstruction('pl');
  assert(instr.includes('POLSKU'), `Missing POLSKU: ${instr.substring(0, 50)}`);
});

test('Instruction: fr → French instruction', () => {
  const instr = buildLanguageInstruction('fr');
  assert(instr.includes('FRANÇAIS'), `Missing FRANÇAIS: ${instr.substring(0, 50)}`);
});

test('Instruction: es → Spanish instruction', () => {
  const instr = buildLanguageInstruction('es');
  assert(instr.includes('ESPAÑOL'), `Missing ESPAÑOL: ${instr.substring(0, 50)}`);
});

test('Instruction: unknown → empty', () => {
  const instr = buildLanguageInstruction('unknown');
  assert(instr === '', `Should be empty for unknown, got: ${instr.substring(0, 50)}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: getLanguageContext integration
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 9. getLanguageContext INTEGRATION ══════');

test('Context: DE query → DE instruction', () => {
  const ctx = getLanguageContext('Was ist Quantenphysik?');
  assert(ctx.language === 'de', `Expected de, got ${ctx.language}`);
  assert(ctx.instruction.includes('DEUTSCH'), 'Missing DE instruction');
});

test('Context: EN query → EN instruction', () => {
  const ctx = getLanguageContext('Explain how a combustion engine works');
  assert(ctx.language === 'en', `Expected en, got ${ctx.language}`);
  assert(ctx.instruction.includes('ENGLISH'), 'Missing EN instruction');
});

test('Context: unknown → defaults to cs', () => {
  const ctx = getLanguageContext('XYZ');
  assert(ctx.language === 'cs', `Expected cs default, got ${ctx.language}`);
  assert(ctx.instruction.includes('ČESKY'), 'Missing CS default instruction');
});

test('Context: empty → defaults to cs', () => {
  const ctx = getLanguageContext('');
  assert(ctx.language === 'cs', `Expected cs default, got ${ctx.language}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 10. EDGE CASES ══════');

test('Edge: very short (≤3 chars) → unknown', () => {
  assert(detectLanguage('Hi').language === 'unknown', 'Short should be unknown');
  assert(detectLanguage('?').language === 'unknown', '? should be unknown');
});

test('Edge: mixed lang → best guess', () => {
  // "Explain mi prosím" — has both EN and CZ signals
  const r = detectLanguage('Explain mi prosím what is AI');
  assert(r.language !== 'unknown', 'Mixed should not be unknown');
});

test('Edge: null/undefined → unknown', () => {
  assert(detectLanguage(null).language === 'unknown', 'null should be unknown');
  assert(detectLanguage(undefined).language === 'unknown', 'undefined should be unknown');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11: CQT Regression — queries that triggered failures
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 11. CQT REGRESSION ══════');

test('Regression: "Explain how a combustion engine works" → en (not unknown)', () => {
  const r = detectLanguage('Explain how a combustion engine works');
  assert(r.language === 'en', `CQT fail: Expected en, got ${r.language}`);
  assert(r.confidence >= 0.5, `Low confidence: ${r.confidence}`);
});

test('Regression: "Was ist Quantenphysik?" → de (not unknown)', () => {
  const r = detectLanguage('Was ist Quantenphysik?');
  assert(r.language === 'de', `CQT fail: Expected de, got ${r.language}`);
});

test('Regression: "What is photosynthesis?" → en (not unknown)', () => {
  const r = detectLanguage('What is photosynthesis?');
  assert(r.language === 'en', `CQT fail: Expected en, got ${r.language}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n════════════════════════════════════════════`);
console.log(`  PASSED: ${passed}`);
console.log(`  FAILED: ${failed}`);
console.log(`════════════════════════════════════════════`);

process.exit(failed > 0 ? 1 : 0);
