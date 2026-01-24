// CRE v36.6 Capability Truth Tests
// ══════════════════════════════════════════════════════════════════════════════
//
// PURPOSE: Test that system NEVER lies about its capabilities
//
// These tests verify:
// 1. META_IDENTITY_LEAK detection (no "jako AI")
// 2. CAPABILITY_DENIAL detection (no "nemohu vyhledávat")
// 3. System date never requested from user
// 4. Execution fallbacks are capability-truthful
//
// ══════════════════════════════════════════════════════════════════════════════

import { validateAnswer, applyQualityGate } from '../chat/answer-quality-gate.js';
import { DialogState, SystemAction, SpeechAct } from '../chat/dialog-state-v2.js';
import { Decision } from '../chat/decision-matrix.js';
import { 
  ExecutionBlockReason, 
  ExecutionFallbackTemplates,
  generateExecutionFallback 
} from '../chat/execution-contracts.js';
import { generateSystemContext, getSystemSlots } from '../chat/capability-registry.js';

// ════════════════════════════════════════════════════════════════════════════
// TEST FRAMEWORK
// ════════════════════════════════════════════════════════════════════════════

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, passed: true });
    console.log(`  ✅ ${name}`);
  } catch (error) {
    results.push({ name, passed: false, error: error.message });
    console.log(`  ❌ ${name}`);
    console.log(`     └─ ${error.message}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) throw new Error(msg || 'Expected true');
}

function assertFalse(condition, msg = '') {
  if (condition) throw new Error(msg || 'Expected false');
}

function assertContains(text, substring, msg = '') {
  if (!text || !text.includes(substring)) {
    throw new Error(`${msg}: expected "${substring}" in "${text?.substring(0, 100)}..."`);
  }
}

function assertNotContains(text, substring, msg = '') {
  if (text && text.includes(substring)) {
    throw new Error(`${msg}: did not expect "${substring}" in text`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 1: META_IDENTITY_LEAK DETECTION
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('🤖 META_IDENTITY_LEAK DETECTION');
console.log('════════════════════════════════════════════════════════════');

const FORBIDDEN_META_PHRASES = [
  'Jako AI asistent nemohu prohledávat internet',
  'Jako jazykový model nemám přístup k datům',
  'Jsem AI a nemohu v reálném čase vyhledávat',
  'Nejsem schopen vám pomoci s vyhledáváním',
  'Potřeboval bych znát aktuální datum',
  'Nevím, kdy je dnes',
  'Moje znalosti jsou omezeny cutoff datem'
];

for (const phrase of FORBIDDEN_META_PHRASES) {
  test(`META: detects "${phrase.substring(0, 40)}..."`, () => {
    const state = new DialogState();
    const decision = new Decision(SystemAction.ANSWER, 'test', SpeechAct.FACT);
    const result = validateAnswer(phrase, state, decision);
    
    assertTrue(
      result.violations.some(v => v.code === 'META_IDENTITY_LEAK') ||
      result.warnings.some(w => w.code === 'META_IDENTITY_LEAK'),
      'Should detect meta identity leak'
    );
  });
}

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 2: CAPABILITY_DENIAL DETECTION
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('🚫 CAPABILITY_DENIAL DETECTION');
console.log('════════════════════════════════════════════════════════════');

const CAPABILITY_DENIAL_PHRASES = [
  'Nemohu vám najít inzeráty',
  'Nedokážu vám vyhledat informace',
  'Nemůžu vám pomoci s hledáním',
  'Není v mých možnostech prohledávat weby',
  'To bohužel není možné',
  'Tuto službu neposkytujeme'
];

for (const phrase of CAPABILITY_DENIAL_PHRASES) {
  test(`DENIAL: detects "${phrase.substring(0, 40)}..."`, () => {
    const state = new DialogState();
    const decision = new Decision(SystemAction.ANSWER, 'test', SpeechAct.FACT);
    const result = validateAnswer(phrase, state, decision);
    
    assertTrue(
      result.violations.some(v => v.code === 'CAPABILITY_DENIAL') ||
      result.warnings.some(w => w.code === 'CAPABILITY_DENIAL'),
      'Should detect capability denial'
    );
  });
}

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 3: META_IDENTITY FIX
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('🔧 META_IDENTITY AUTO-FIX');
console.log('════════════════════════════════════════════════════════════');

test('FIX: removes "jako AI asistent"', () => {
  const state = new DialogState();
  const decision = new Decision(SystemAction.ANSWER, 'test', SpeechAct.FACT);
  const input = 'Jako AI asistent vám mohu pomoci s radou.';
  const result = applyQualityGate(input, state, decision);
  
  assertNotContains(result.text, 'Jako AI', 'Should remove AI identity');
});

test('FIX: rewrites "nemohu prohledávat internet"', () => {
  const state = new DialogState();
  const decision = new Decision(SystemAction.ANSWER, 'test', SpeechAct.FACT);
  const input = 'Nemohu prohledávat internet, ale mohu poradit.';
  const result = applyQualityGate(input, state, decision);
  
  assertNotContains(result.text, 'nemohu prohledávat internet', 'Should rewrite capability denial');
  // Should preserve the useful part and rewrite the bad part
  assertContains(result.text, 'mohu poradit', 'Should keep useful content');
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 4: SYSTEM SLOTS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📅 SYSTEM SLOTS');
console.log('════════════════════════════════════════════════════════════');

test('SLOTS: getSystemSlots has current date', () => {
  const slots = getSystemSlots();
  assertTrue(slots.now !== undefined, 'Should have now');
  assertTrue(slots.date !== undefined, 'Should have date');
  assertTrue(slots.dayOfWeek !== undefined, 'Should have dayOfWeek');
  assertTrue(slots.timezone !== undefined, 'Should have timezone');
});

test('SLOTS: date is today', () => {
  const slots = getSystemSlots();
  const today = new Date().toISOString().split('T')[0];
  assertTrue(slots.date === today, `Date should be ${today}, got ${slots.date}`);
});

test('SLOTS: system context includes date', () => {
  const context = generateSystemContext();
  assertContains(context, 'AKTUÁLNÍ ČAS', 'Should include time section');
  assertContains(context, 'Datum:', 'Should include date');
});

test('SLOTS: system context includes capabilities', () => {
  const context = generateSystemContext();
  assertContains(context, 'SCHOPNOSTI SYSTÉMU', 'Should include capabilities section');
  assertContains(context, 'SEARCH', 'Should mention search capability');
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 5: EXECUTION FALLBACK TEMPLATES
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📋 EXECUTION FALLBACK TEMPLATES');
console.log('════════════════════════════════════════════════════════════');

test('FALLBACK: MISSING_BACKEND is capability-truthful', () => {
  const response = generateExecutionFallback(ExecutionBlockReason.MISSING_BACKEND, {});
  assertContains(response, 'dostupné', 'Should say capability is available');
  assertNotContains(response, 'nemohu', 'Should not say "I cannot"');
});

test('FALLBACK: MISSING_DATA is capability-truthful', () => {
  const response = generateExecutionFallback(ExecutionBlockReason.MISSING_DATA, {});
  assertContains(response, 'umím provést', 'Should say action is possible');
  assertNotContains(response, 'nemohu', 'Should not say "I cannot"');
});

test('FALLBACK: MISSING_SOURCES is capability-truthful', () => {
  const response = generateExecutionFallback(ExecutionBlockReason.MISSING_SOURCES, {});
  assertContains(response, 'Mohu', 'Should say capability exists');
  assertContains(response, 'zdroje', 'Should mention sources');
});

test('FALLBACK: No generic "nemohu" in any template', () => {
  for (const reason of Object.values(ExecutionBlockReason)) {
    const response = generateExecutionFallback(reason, {});
    assertNotContains(
      response, 
      'nemohu', 
      `MISSING_${reason} fallback should not contain "nemohu"`
    );
  }
});

// ════════════════════════════════════════════════════════════════════════════
// TEST SUITE 6: VALID RESPONSES PASS
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('✅ VALID RESPONSES PASS');
console.log('════════════════════════════════════════════════════════════');

const VALID_RESPONSES = [
  'Mohu vám pomoci s vyhledáváním, ale potřebuji specifikovat zdroj.',
  'Pro tuto akci potřebuji data. Můžete mi je poskytnout?',
  'Vyhledávání je dostupné přes Sauto, Bazoš nebo Mobile.de.',
  'Dnes je pátek, 24. ledna 2026.',
  'Další úplněk bude za 8 dní.'
];

for (const response of VALID_RESPONSES) {
  test(`VALID: "${response.substring(0, 40)}..." passes`, () => {
    const state = new DialogState();
    const decision = new Decision(SystemAction.ANSWER, 'test', SpeechAct.FACT);
    const result = validateAnswer(response, state, decision);
    
    assertFalse(
      result.violations.some(v => 
        v.code === 'META_IDENTITY_LEAK' || v.code === 'CAPABILITY_DENIAL'
      ),
      'Valid response should not trigger meta violations'
    );
  });
}

// ════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════════════

console.log('\n════════════════════════════════════════════════════════════');
console.log('📊 CAPABILITY TRUTH TEST SUMMARY');
console.log('════════════════════════════════════════════════════════════');

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

console.log(`  ✅ Passed:  ${passed}`);
console.log(`  ❌ Failed:  ${failed}`);

if (failed > 0) {
  console.log('\n❌ FAILURES:');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`  ${r.name}: ${r.error}`);
  });
} else {
  console.log('\n✅ ALL CAPABILITY TRUTH TESTS PASSED');
}
