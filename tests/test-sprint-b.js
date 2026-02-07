// Sprint B — Comprehensive tests for all 4 fixes

// ═══════ #1: sanitizeSearchQuery ═══════

function sanitizeSearchQuery(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return '';
  let q = rawInput.trim();

  q = q.replace(
    /\b(odpověz|řekni|napiš|vysvětli|jednou větou|stručně|podrobně|detailně|česky|anglicky|krátce|prosím|jednoduše|přesně|ve zkratce|briefly|concisely|in detail|please|in one sentence|in short|simply)\b\s*/gi,
    ' '
  );

  q = q.replace(/([.?!])\s+(odpověz|řekni|napiš|vysvětli|popiš|uveď|uved|buď|bud|piš|pis|mluv|write|answer|explain|describe|be|keep)\b.*$/gi, '$1');

  const words = q.split(/\s+/).filter(w => w.length > 0);
  const wordCounts = new Map();
  const deduped = [];
  for (const word of words) {
    const key = word.toLowerCase();
    const count = (wordCounts.get(key) || 0) + 1;
    wordCounts.set(key, count);
    if (count <= 2) deduped.push(word);
  }
  q = deduped.join(' ');

  if (q.length > 200) {
    q = q.substring(0, 200).replace(/\s\S*$/, '');
  }

  q = q.replace(/\s+/g, ' ').trim();

  if (q.length < 3) {
    q = rawInput.substring(0, 100).trim();
  }

  return q;
}

const sanitizeTests = [
  // [input, expected_substring, description]
  ['Kdo byl Pythagoras? Odpověz stručně.', 'Kdo byl Pythagoras?', 'Strip trailing instruction'],
  ['Co je to gravitace? Jednou větou.', 'Co je to gravitace?', 'Strip "jednou větou"'],
  ['Napiš mi prosím co je to AI', 'co je to AI', 'Strip "napiš mi prosím"'],
  ['Explain briefly what is quantum', 'what is quantum', 'Strip "briefly"'],
  // Deduplication
  ['velmi ' .repeat(100) + 'AI', null, 'Dedup repeated words (check length)'],
  // Short input preserved
  ['AI', 'AI', 'Short input preserved'],
  // Normal query unchanged
  ['hlavní město České republiky', 'hlavní město České republiky', 'Normal query untouched'],
];

let pass1 = 0, fail1 = 0;
for (const [input, expected, desc] of sanitizeTests) {
  const result = sanitizeSearchQuery(input);
  let ok;
  if (expected === null) {
    // Special: check it's reasonable length
    ok = result.length < 250 && result.length > 0;
    if (!ok) console.log(`  ❌ [sanitize] ${desc}: length=${result.length} "${result.substring(0, 50)}..."`);
  } else {
    ok = result.includes(expected);
    if (!ok) console.log(`  ❌ [sanitize] ${desc}: "${result}" does not contain "${expected}"`);
  }
  if (ok) pass1++; else fail1++;
}

// ═══════ #6: Per-session circuit breaker key ═══════

function breakerKey(toolType, sessionId) {
  return sessionId
    ? `${toolType}:${sessionId}`
    : `${toolType}:anonymous`;
}

const breakerTests = [
  ['search', 'abc123', 'search:abc123', 'Session ID included'],
  ['search', null, 'search:anonymous', 'Null session → anonymous'],
  ['search', undefined, 'search:anonymous', 'Undefined session → anonymous'],
  ['search', '', 'search:anonymous', 'Empty session → anonymous'],
  ['scrape', 'xyz', 'scrape:xyz', 'Different tool type'],
];

let pass6 = 0, fail6 = 0;
for (const [tool, session, expected, desc] of breakerTests) {
  const result = breakerKey(tool, session);
  if (result === expected) { pass6++; }
  else {
    fail6++;
    console.log(`  ❌ [breaker] ${desc}: "${result}" !== "${expected}"`);
  }
}

// ═══════ #10: STOP_WORDS ═══════

const STOP_WORDS = new Set([
  'a', 'i', 'o', 'v', 'k', 'z', 'na', 'do', 'se', 'je', 'to', 'si',
  'co', 'jak', 'kde', 'kdy', 'ten', 'ta', 'ty', 'pro', 'ale', 'že',
  'jsou', 'byl', 'být', 'jsem', 'jsi', 'jeho', 'její', 'mi', 'mě',
  'jako', 'nebo', 'ani', 'tak', 'jen', 'už', 'než', 'při', 'pod',
  'nad', 'mezi', 'před', 'po', 'za', 'od', 'bez', 'aby', 'když',
  'nejlepší', 'jaké', 'jaký', 'která', 'který', 'které',
  // NEW
  'odpověz', 'řekni', 'napiš', 'vysvětli', 'popiš', 'uveď',
  'stručně', 'podrobně', 'detailně', 'krátce', 'jednoduše', 'přesně',
  'jednou', 'větou', 'česky', 'anglicky', 'prosím',
]);

const stopTests = [
  ['odpověz', true, 'New CZ instructional word'],
  ['stručně', true, 'New CZ instructional word'],
  ['prosím', true, 'New CZ instructional word'],
  ['větou', true, 'New CZ instructional word'],
  ['python', false, 'Should NOT be stop word'],
  ['gravitace', false, 'Should NOT be stop word'],
  ['AI', false, 'Should NOT be stop word'],
];

let pass10 = 0, fail10 = 0;
for (const [word, shouldBeStop, desc] of stopTests) {
  const isStop = STOP_WORDS.has(word);
  if (isStop === shouldBeStop) { pass10++; }
  else {
    fail10++;
    console.log(`  ❌ [stopword] ${desc}: "${word}" isStop=${isStop}`);
  }
}

// ═══════ #10: Snippet threshold ═══════

function scoreResult(result) {
  let score = 0;
  if (result.title && result.title.trim().length > 3) score += 0.3;
  if (result.url && result.url.startsWith('http')) score += 0.2;
  if (result.snippet && result.snippet.trim().length > 0) {
    const snippetLen = result.snippet.trim().length;
    if (snippetLen >= 50) score += 0.5;       // v56.2: was 80
    else if (snippetLen >= 25) score += 0.3;  // v56.2: was 30
    else score += 0.1;
  }
  return Math.round(score * 100) / 100;
}

const snippetTests = [
  [{ title: 'Test', url: 'https://x.com', snippet: 'A'.repeat(60) }, 1.0, '60-char snippet = complete (was partial before v56.2)'],
  [{ title: 'Test', url: 'https://x.com', snippet: 'A'.repeat(80) }, 1.0, '80-char snippet = complete'],
  [{ title: 'Test', url: 'https://x.com', snippet: 'A'.repeat(30) }, 0.8, '30-char snippet = partial (was 0.3 before)'],
  [{ title: 'Test', url: 'https://x.com', snippet: 'A'.repeat(10) }, 0.6, '10-char snippet = tiny'],
];

let passSn = 0, failSn = 0;
for (const [result, expected, desc] of snippetTests) {
  const score = scoreResult(result);
  if (score === expected) { passSn++; }
  else {
    failSn++;
    console.log(`  ❌ [snippet] ${desc}: score=${score} (expected ${expected})`);
  }
}

// ═══════ SUMMARY ═══════
const totalPass = pass1 + pass6 + pass10 + passSn;
const totalFail = fail1 + fail6 + fail10 + failSn;
console.log(`\n══════════════════════════════`);
console.log(`  Sprint B: ${totalPass}/${totalPass+totalFail} PASS, ${totalFail} FAIL`);
console.log(`  #1 sanitize: ${pass1}/${pass1+fail1}`);
console.log(`  #6 breaker:  ${pass6}/${pass6+fail6}`);
console.log(`  #10 stop:    ${pass10}/${pass10+fail10}`);
console.log(`  #10 snippet: ${passSn}/${passSn+failSn}`);
console.log(`══════════════════════════════`);
if (totalFail === 0) console.log('✅ ALL SPRINT B TESTS PASS');
