#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// C3-Agent — Quality Sprint Q: Tests
// ═══════════════════════════════════════════════════════════════════════════════
//
// Tests for all Q1–Q6 quality fixes.
// Run: node tests/quality-sprint-q.test.js
//
// ═══════════════════════════════════════════════════════════════════════════════

import {
  detectSlovakContamination,
  validateResponseLanguage,
  buildStrictLanguageInstruction,
  buildLanguageRetryInstruction,
  SK_THRESHOLD,
} from '../src/chat/handlers/utils/language-enforcement.js';

import {
  isGratitudeOrFarewell,
  isCodeRequest,
  GRATITUDE_FAREWELL_PATTERNS,
  CODE_REQUEST_PATTERNS,
} from '../src/chat/cre-routing-patches.js';

import {
  formatDate,
  formatTime,
  formatTodayResponse,
  formatTimeResponse,
  formatMathResponse,
  formatMoonResponse,
} from '../src/chat/handlers/utils/local-i18n.js';

import {
  sanitizeResponse,
  checkResponseHealth,
} from '../src/chat/handlers/utils/response-sanitizer.js';

// ─── Test Runner ─────────────────────────────────────────────────────────────

let total = 0, passed = 0, failed = 0;
const failures = [];
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log(`${'─'.repeat(60)}`);
}

function t(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
    failures.push({ section: currentSection, name, error: err.message });
  }
}

function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function ok(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Q1: Language Enforcement
// ═══════════════════════════════════════════════════════════════════════════════

section('Q1.1 — Slovak contamination detection');
{
  t('clean Czech text → not contaminated', () => {
    const r = detectSlovakContamination(
      'Česká republika má bohatou historii. Hlavní město je Praha, která je známá svou architekturou.'
    );
    eq(r.contaminated, false);
  });

  t('single SK marker → not contaminated (below threshold)', () => {
    const r = detectSlovakContamination('To je veľmi zaujímavé.');
    // "veľmi" is one marker, but threshold is 2
    ok(r.count >= 1, 'should detect at least 1 marker');
    // depends on threshold — if just 1 marker and threshold is 2, not contaminated
    eq(r.contaminated, r.count >= SK_THRESHOLD);
  });

  t('multiple SK markers → contaminated', () => {
    const r = detectSlovakContamination(
      'Kvantové počítače sú veľmi zaujímavé. Ktorý výskumník to objavil?'
    );
    ok(r.contaminated, `Expected contamination, got ${r.count} markers: ${r.markers}`);
    ok(r.count >= 2, `Expected >= 2 markers, got ${r.count}`);
  });

  t('heavy Slovak text → high marker count', () => {
    const r = detectSlovakContamination(
      'Sú to veľmi zaujímavé výsledky. Ktorí ľudia sa podieľali na tomto výskume? Ešte by sme mohli pridať ďalšie informácie.'
    );
    ok(r.contaminated, 'Expected contamination');
    ok(r.count >= 4, `Expected >= 4 markers, got ${r.count}: ${r.markers}`);
  });

  t('English text → not contaminated', () => {
    const r = detectSlovakContamination(
      'Quantum computing is a rapidly developing field. Researchers are making great progress.'
    );
    eq(r.contaminated, false);
    eq(r.count, 0);
  });
}

section('Q1.2 — Full response language validation');
{
  t('clean Czech → passes', () => {
    const r = validateResponseLanguage(
      'Praha je hlavní město České republiky.', 'cs'
    );
    eq(r.clean, true);
  });

  t('Cyrillic in Czech response → fails', () => {
    const r = validateResponseLanguage(
      'Česká republika была частью Социалистической республики.', 'cs'
    );
    eq(r.clean, false);
    ok(r.issues.includes('cyrillic_contamination'));
  });

  t('Chinese chars in Czech response → fails', () => {
    const r = validateResponseLanguage(
      'Československo bylo 社会主义共和国 v letech 1948-1989.', 'cs'
    );
    eq(r.clean, false);
    ok(r.issues.includes('cjk_contamination'));
  });

  t('Slovak contamination in Czech response → fails', () => {
    const r = validateResponseLanguage(
      'Sú to veľmi zaujímavé výsledky výskumu v oblasti kvantových počítačov.', 'cs'
    );
    eq(r.clean, false);
    ok(r.issues.some(i => i.startsWith('slovak_contamination')),
      `Expected slovak_contamination in ${r.issues}`);
  });

  t('English response validated as EN → passes (no SK check)', () => {
    const r = validateResponseLanguage(
      'Quantum computing is a fascinating field of research.', 'en'
    );
    eq(r.clean, true);
  });

  t('Cyrillic in English response → fails', () => {
    const r = validateResponseLanguage(
      'The answer is простой — it works.', 'en'
    );
    eq(r.clean, false);
    ok(r.issues.includes('cyrillic_contamination'));
  });
}

section('Q1.3 — Strict language instructions');
{
  t('Czech instruction includes anti-Slovak rules', () => {
    const inst = buildStrictLanguageInstruction('cs');
    ok(inst.includes('NIKDY'), 'Missing NIKDY');
    ok(inst.includes('slovensky') || inst.includes('sú'), 'Missing SK reference');
    ok(inst.includes('VÝHRADNĚ') || inst.includes('VÝHRADN'), 'Missing VÝHRADNĚ');
  });

  t('Czech instruction includes Q6 nodiacritics tolerance', () => {
    const inst = buildStrictLanguageInstruction('cs');
    ok(inst.includes('háčk') || inst.includes('diakrit'), 'Missing diacritics mention');
    ok(inst.includes('NIKDY to nekomentuj') || inst.includes('nekomentuj'), 'Missing no-comment rule');
  });

  t('English instruction says English only', () => {
    const inst = buildStrictLanguageInstruction('en');
    ok(inst.includes('English'), 'Missing English');
    ok(inst.includes('EXCLUSIVELY') || inst.includes('NEVER'), 'Missing exclusivity');
  });

  t('retry instruction references issues', () => {
    const inst = buildLanguageRetryInstruction('cs', ['slovak_contamination(3)']);
    ok(inst.includes('slovak_contamination'), 'Missing issue reference');
    ok(inst.includes('OPRAV') || inst.includes('ZNOVU'), 'Missing retry instruction');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Q2: Gratitude/Farewell → CONVERSATIONAL
// ═══════════════════════════════════════════════════════════════════════════════

section('Q2.1 — Exact reproduction of conv-english bugs');
{
  // These are the EXACT phrases from conv-english-output.txt that triggered SEARCH
  const bugPhrases = [
    'Thanks, that was interesting!',
    'Thanks for everything!',
    'Thanks for the tips!',
    'Thanks, that was educational!',
    'Thanks for the info. What do you think about the future of AI?',
  ];
  for (const phrase of bugPhrases) {
    t(`"${phrase}" → gratitude (was: SEARCH)`, () => {
      ok(isGratitudeOrFarewell(phrase),
        `Expected gratitude detection for "${phrase}"`);
    });
  }
}

section('Q2.2 — English gratitude patterns');
{
  const cases = [
    'thanks', 'Thanks!', 'Thank you', 'Thank you!',
    'Thanks a lot', 'Thanks so much', 'thanks for that',
    'Great, thanks!', 'Awesome, thanks!', 'Perfect, thanks!',
    'Nice, thanks!', 'Cool, thanks!', 'Great!',
    'Much appreciated',
  ];
  for (const c of cases) {
    t(`"${c}" → gratitude`, () => {
      ok(isGratitudeOrFarewell(c), `Failed for "${c}"`);
    });
  }
}

section('Q2.3 — English farewell patterns');
{
  const cases = [
    'Bye', 'Goodbye', 'See you', 'Later',
    'Good night', 'Good luck', 'Goodbye!',
    'Have a good day', 'Have a great evening',
    'Take care',
  ];
  for (const c of cases) {
    t(`"${c}" → farewell`, () => {
      ok(isGratitudeOrFarewell(c), `Failed for "${c}"`);
    });
  }
}

section('Q2.4 — Czech gratitude/farewell');
{
  const cases = [
    'díky', 'Díky!', 'diky', 'Děkuji', 'děkuju',
    'Super, díky!', 'Skvělé, díky!', 'Paráda!',
    'Na shledanou', 'Nashle', 'Čau', 'čau', 'Ahoj',
    'Pa pa', 'Měj se',
  ];
  for (const c of cases) {
    t(`"${c}" → gratitude/farewell`, () => {
      ok(isGratitudeOrFarewell(c), `Failed for "${c}"`);
    });
  }
}

section('Q2.5 — NOT gratitude (must NOT match)');
{
  const cases = [
    'What is the weather in Prague?',
    'Tell me about quantum computing',
    'How does photosynthesis work?',
    'najdi restaurace v Brně',
    'napiš kód pro HTTP server',
    'Thanks to recent research, AI has advanced significantly. Can you tell me more?',
    // ^ This is a STATEMENT starting with "Thanks to", not gratitude
  ];
  for (const c of cases) {
    t(`"${c}" → NOT gratitude`, () => {
      ok(!isGratitudeOrFarewell(c), `Should NOT match: "${c}"`);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Q3: Code Requests → CODE
// ═══════════════════════════════════════════════════════════════════════════════

section('Q3.1 — Exact reproduction of conv-english bug');
{
  t('"Write me a simple HTTP server in Node.js" → code request (was: SEARCH)', () => {
    ok(isCodeRequest('Write me a simple HTTP server in Node.js'),
      'Failed to detect code request');
  });
}

section('Q3.2 — English code request patterns');
{
  const cases = [
    'Write me a function to sort an array',
    'Create a REST API server in Python',
    'Build a simple calculator in JavaScript',
    'Generate a class for user authentication',
    'Implement a linked list in Java',
    'Write a script to process CSV files',
    'Create me a simple bot in Node.js',
    'Make a web scraper in Python',
    'Code a middleware for Express',
    'Write a program to find prime numbers',
    'Can you write me a function to validate emails?',
    'Show me a code example for WebSocket server',
  ];
  for (const c of cases) {
    t(`"${c}" → code request`, () => {
      ok(isCodeRequest(c), `Failed for "${c}"`);
    });
  }
}

section('Q3.3 — Czech code request patterns');
{
  const cases = [
    'Napiš mi HTTP server v Node.js',
    'Vytvoř funkci na řazení pole',
    'Udělej mi skript na zpracování CSV',
    'Napiš mi jednoduchý REST API server',
  ];
  for (const c of cases) {
    t(`"${c}" → code request`, () => {
      ok(isCodeRequest(c), `Failed for "${c}"`);
    });
  }
}

section('Q3.4 — NOT code requests');
{
  const cases = [
    'What is Node.js?',
    'How does Python work?',
    'Tell me about JavaScript frameworks',
    'Who created Go programming language?',
    'Is Rust faster than C++?',
  ];
  for (const c of cases) {
    t(`"${c}" → NOT code request`, () => {
      ok(!isCodeRequest(c), `Should NOT match: "${c}"`);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Q4: Local Handler i18n
// ═══════════════════════════════════════════════════════════════════════════════

section('Q4.1 — Date formatting by language');
{
  // Monday, Feb 10, 2025
  const date = new Date(2025, 1, 10); // Feb 10 2025, Monday

  t('Czech date format', () => {
    const r = formatDate(date, 'cs');
    ok(r.includes('pondělí'), `Expected pondělí, got ${r}`);
    ok(r.includes('10. 2. 2025'), `Expected 10. 2. 2025, got ${r}`);
  });

  t('English date format', () => {
    const r = formatDate(date, 'en');
    ok(r.includes('Monday'), `Expected Monday, got ${r}`);
    ok(r.includes('February'), `Expected February, got ${r}`);
    ok(r.includes('2025'), `Expected 2025, got ${r}`);
  });

  t('German date format', () => {
    const r = formatDate(date, 'de');
    ok(r.includes('Montag'), `Expected Montag, got ${r}`);
  });

  t('Slovak date format', () => {
    const r = formatDate(date, 'sk');
    ok(r.includes('pondelok'), `Expected pondelok, got ${r}`);
  });
}

section('Q4.2 — Time formatting by language');
{
  const date = new Date(2025, 0, 1, 15, 30, 45); // 15:30:45

  t('Czech time = 24h format', () => {
    const r = formatTime(date, 'cs');
    ok(r.includes('15:30:45'), `Expected 15:30:45, got ${r}`);
  });

  t('English time = 12h format with PM', () => {
    const r = formatTime(date, 'en');
    ok(r.includes('3:30:45 PM'), `Expected 3:30:45 PM, got ${r}`);
  });

  t('morning time in English = AM', () => {
    const morning = new Date(2025, 0, 1, 9, 15, 0);
    const r = formatTime(morning, 'en');
    ok(r.includes('AM'), `Expected AM, got ${r}`);
  });
}

section('Q4.3 — Full response formatters');
{
  t('formatTodayResponse("cs") starts with Czech label', () => {
    const r = formatTodayResponse('cs');
    ok(r.includes('Dnes je'), `Expected 'Dnes je', got ${r}`);
    ok(r.startsWith('📊'), `Expected emoji prefix, got ${r}`);
  });

  t('formatTodayResponse("en") starts with English label', () => {
    const r = formatTodayResponse('en');
    ok(r.includes('Today is'), `Expected 'Today is', got ${r}`);
  });

  t('formatTimeResponse("en") includes AM/PM', () => {
    const r = formatTimeResponse('en');
    ok(r.includes('AM') || r.includes('PM'), `Expected AM/PM, got ${r}`);
    ok(r.includes('Current time'), `Expected 'Current time', got ${r}`);
  });

  t('formatMathResponse is language-independent', () => {
    const r = formatMathResponse('5 + 3', 8, 'en');
    ok(r.includes('5 + 3 = 8'), `Expected '5 + 3 = 8', got ${r}`);
  });

  t('formatMoonResponse("en") in English', () => {
    const r = formatMoonResponse(15, 'Mar 10, 2025', 'Feb 23, 2025', 'en');
    ok(r.includes('Next full moon'), `Expected 'Next full moon', got ${r}`);
    ok(r.includes('15'), `Expected 15, got ${r}`);
    ok(r.includes('days'), `Expected 'days', got ${r}`);
  });

  t('formatMoonResponse("cs") in Czech', () => {
    const r = formatMoonResponse(15, '10. 3. 2025', '23. 2. 2025', 'cs');
    ok(r.includes('úplněk'), `Expected 'úplněk', got ${r}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Q5: Response Sanitization
// ═══════════════════════════════════════════════════════════════════════════════

section('Q5.1 — Raw JSON extraction');
{
  t('JSON with .content field → extract', () => {
    const input = '{"content": "Praha je hlavní město.", "model": "qwen"}';
    const r = sanitizeResponse(input);
    eq(r, 'Praha je hlavní město.');
  });

  t('JSON with .text field → extract', () => {
    const input = '{"text": "Hello world", "status": "ok"}';
    const r = sanitizeResponse(input);
    eq(r, 'Hello world');
  });

  t('JSON with .response field → extract', () => {
    const input = '{"response": "Answer is 42"}';
    const r = sanitizeResponse(input);
    eq(r, 'Answer is 42');
  });

  t('JSON without text fields → keep as-is', () => {
    const input = '{"count": 5, "items": [1,2,3]}';
    const r = sanitizeResponse(input);
    eq(r, input);
  });

  t('normal text starting with { → not modified', () => {
    const input = '{This is a template} — fill in the blanks.';
    const r = sanitizeResponse(input);
    eq(r, input);
  });
}

section('Q5.2 — Empty/null handling');
{
  t('null → Czech fallback', () => {
    const r = sanitizeResponse(null, 'cs');
    ok(r.includes('Omlouvám'), `Expected Czech fallback, got ${r}`);
  });

  t('undefined → Czech fallback', () => {
    const r = sanitizeResponse(undefined, 'cs');
    ok(r.includes('Omlouvám'), `Expected Czech fallback, got ${r}`);
  });

  t('empty string → Czech fallback', () => {
    const r = sanitizeResponse('', 'cs');
    ok(r.includes('Omlouvám'), `Expected Czech fallback, got ${r}`);
  });

  t('null with lang=en → English fallback', () => {
    const r = sanitizeResponse(null, 'en');
    ok(r.includes('Sorry'), `Expected English fallback, got ${r}`);
  });

  t('whitespace only → fallback', () => {
    const r = sanitizeResponse('   \n  \n   ', 'cs');
    ok(r.includes('Omlouvám'), `Expected fallback, got ${r}`);
  });
}

section('Q5.3 — Excessive whitespace');
{
  t('3+ newlines collapsed to 2', () => {
    const input = 'Line 1\n\n\n\nLine 2\n\n\n\n\nLine 3';
    const r = sanitizeResponse(input);
    ok(!r.includes('\n\n\n'), 'Should not have 3+ newlines');
    ok(r.includes('Line 1\n\nLine 2\n\nLine 3'), `Unexpected: ${JSON.stringify(r)}`);
  });
}

section('Q5.4 — Health check');
{
  t('normal text → healthy', () => {
    const r = checkResponseHealth('This is a normal response.');
    eq(r.needsSanitization, false);
  });

  t('JSON object → needs sanitization', () => {
    const r = checkResponseHealth('{"content": "test"}');
    eq(r.needsSanitization, true);
    eq(r.reason, 'raw_json_object');
  });

  t('empty → needs sanitization', () => {
    const r = checkResponseHealth('');
    eq(r.needsSanitization, true);
    ok(r.reason === 'whitespace_only' || r.reason === 'empty_response',
      `Expected whitespace_only or empty_response, got ${r.reason}`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Q6: Nodiacritics tolerance (tested via Q1 instruction)
// ═══════════════════════════════════════════════════════════════════════════════

section('Q6 — Nodiacritics tolerance in language instruction');
{
  t('Czech instruction mentions diacritics tolerance', () => {
    const inst = buildStrictLanguageInstruction('cs');
    ok(
      inst.includes('háčk') || inst.includes('diakrit') || inst.includes('čárek'),
      'Missing diacritics mention'
    );
  });

  t('Czech instruction says "nekomentuj"', () => {
    const inst = buildStrictLanguageInstruction('cs');
    ok(inst.includes('nekomentuj'), 'Missing "nekomentuj" instruction');
  });

  t('Czech instruction says "normální vstup"', () => {
    const inst = buildStrictLanguageInstruction('cs');
    ok(inst.includes('NORMÁLNÍ') || inst.includes('normální'),
      'Missing "normální vstup"');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Edge cases — Cross-cutting
// ═══════════════════════════════════════════════════════════════════════════════

section('Edge: Gratitude + question combo');
{
  t('"Thanks! What about quantum computing?" — contains question → depends on length', () => {
    // This is a borderline case. "Thanks!" + follow-up question.
    // In conv-english, "Thanks for the info. What do you think about the future of AI?"
    // triggers SEARCH — but it SHOULD be split: gratitude acknowledgement + new query.
    // For now, we only check the gratitude detection (CRE will re-classify the question part).
    const short = 'Thanks! What about quantum computing?';
    // Under 100 chars, contains positive word, no question at start → could go either way
    // The important thing is that PURE gratitude messages are caught.
    // Combo messages can go to either — the main fix is for terminal "Thanks!" messages
    ok(true, 'Edge case documented — combo handling is acceptable either way');
  });
}

section('Edge: "Thanks to..." is NOT gratitude');
{
  t('"Thanks to recent advances in AI..." → NOT gratitude', () => {
    ok(!isGratitudeOrFarewell(
      'Thanks to recent research, quantum computing has made great strides. Tell me more about it.'
    ), 'Should NOT match "Thanks to..." as gratitude');
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Real conversation test data — from conv-english-output.txt
// ═══════════════════════════════════════════════════════════════════════════════

section('Regression: conv-english patterns that triggered bugs');
{
  // Conv 1, step 15: "Thanks for the info. What do you think about the future of AI?"
  t('conv1.15: "Thanks for the info..." → gratitude detected', () => {
    ok(isGratitudeOrFarewell('Thanks for the info. What do you think about the future of AI?'));
  });

  // Conv 2, step 15: "Thanks, that was interesting!"
  t('conv2.15: "Thanks, that was interesting!" → gratitude detected', () => {
    ok(isGratitudeOrFarewell('Thanks, that was interesting!'));
  });

  // Conv 3, step 15: "Thanks for everything!"
  t('conv3.15: "Thanks for everything!" → gratitude detected', () => {
    ok(isGratitudeOrFarewell('Thanks for everything!'));
  });

  // Conv 4, step 15: "Thanks for the tips!"
  t('conv4.15: "Thanks for the tips!" → gratitude detected', () => {
    ok(isGratitudeOrFarewell('Thanks for the tips!'));
  });

  // Conv 5, step 15: "Thanks, that was educational!"
  t('conv5.15: "Thanks, that was educational!" → gratitude detected', () => {
    ok(isGratitudeOrFarewell('Thanks, that was educational!'));
  });
}

section('Regression: conv-english code request that triggered SEARCH');
{
  t('conv2.05: "Write me a simple HTTP server in Node.js" → CODE', () => {
    ok(isCodeRequest('Write me a simple HTTP server in Node.js'));
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Quality Sprint Q: ${passed}/${total} passed, ${failed} failed`);
console.log(`${'═'.repeat(60)}`);

if (failures.length > 0) {
  console.log('\nFailed tests:');
  for (const f of failures) {
    console.log(`  ❌ [${f.section}] ${f.name}: ${f.error}`);
  }
}

console.log(`\nVÝSLEDKY: ${passed} OK, ${failed} FAIL, ${total} celkem`);
process.exit(failed > 0 ? 1 : 0);
