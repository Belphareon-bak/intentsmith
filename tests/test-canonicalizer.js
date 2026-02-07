#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════════
// C3 Agent — Query Canonicalizer Tests
// ═══════════════════════════════════════════════════════════════════════════════
// Tests the canonicalizer in isolation (no LLM, no server).
// Uses inline implementation to avoid import dependency chain.
// ═══════════════════════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;

function ok(name) { passed++; console.log(`  ✅ ${name}`); }
function fail(name, msg) { failed++; console.log(`  ❌ ${name}`); console.log(`     → ${msg}`); }

function test(name, fn) {
  try { fn(); ok(name); } catch (e) { fail(name, e.message); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Inline canonicalizer (matches src/executor/query-canonicalizer.js)
// ═══════════════════════════════════════════════════════════════════════════════

const NOISE_PREFIXES = [
  /^a\s+te[ďd]\s+mi\s+o\s+/i,
  /^mi\s+n[ěe][čc]o\s+o\s+/i,
  /^mi\s+(v[íi]ce|v[íi]c)\s+o\s+/i,
  /^mi\s+co\s+je\s+to\s+/i,
  /^mi\s+co\s+je\s+/i,
  /^mi\s+o\s+/i,
  /^co\s+je\s+to\s+/i,
  /^co\s+je\s+/i,
  /^a\s+te[ďd]\s+mi\s+/i,
  /^a\s+(co|jak|kde|kdy|kdo)\s+/i,
  /^najdi\s+(informace\s+o|mi)\s+/i,
  /^(najdi|hledej|vyhledej)\s+o\s+/i,
  /^mi\s+/i,
  /^mi\s+[čc]o\s+je\s+to\s+/i,
  /^mi\s+[čc]o\s+je\s+/i,
  /^[čc]o\s+je\s+to\s+/i,
  /^[čc]o\s+je\s+/i,
  /^n[áa]jdi\s+(inform[áa]cie\s+o|mi)\s+/i,
  /^me\s+about\s+/i,
  /^information\s+about\s+/i,
  /^info\s+about\s+/i,
  /^mir\s+(etwas\s+)?[üu]ber\s+/i,
  /^informationen\s+[üu]ber\s+/i,
  /^mi\s+co\s+to\s+jest\s+/i,
  /^co\s+to\s+jest\s+/i,
  /^informacje\s+o\s+/i,
  /^moi\s+ce\s+que?\s+(c'est|est)\s+/i,
  /^qu'est-ce\s+que?\s+(c'est|le|la|l')\s+/i,
  /^des?\s+informations?\s+sur\s+/i,
  /^informaci[óo]n\s+sobre\s+/i,
  /^qu[ée]\s+es\s+(el|la|un|una)\s+/i,
];

const RESIDUAL_PUNCTUATION = [
  /^[:\-–—,;]+\s*/,
  /\s+[:\-–—,;]+$/,
  /^["'„""'']+\s*/,
  /\s*["'„""'']+$/,
];

const TRIVIAL_WORDS = new Set([
  'mi', 'o', 'co', 'je', 'to', 'jak', 'se', 'a', 'že', 'na', 'v', 'k', 'z',
  'do', 'od', 'za', 'po', 'při', 'pro', 'ale', 'i', 'ani', 'nebo',
  'me', 'about', 'the', 'a', 'an', 'of', 'to', 'in', 'is', 'it', 'and', 'or',
  'mir', 'über', 'der', 'die', 'das', 'und', 'ist',
  'mi', 'o', 'co', 'to', 'jest', 'i', 'lub',
]);

function canonicalizeQuery(sanitizedQuery) {
  if (!sanitizedQuery || typeof sanitizedQuery !== 'string') {
    return { query: sanitizedQuery || '', changed: false, stripped: [] };
  }
  const original = sanitizedQuery.trim();
  if (original.length === 0) return { query: '', changed: false, stripped: [] };

  let q = original;
  const stripped = [];

  for (const pattern of NOISE_PREFIXES) {
    const match = q.match(pattern);
    if (match) {
      stripped.push(match[0].trim());
      q = q.replace(pattern, '').trim();
      break;
    }
  }

  for (const pattern of RESIDUAL_PUNCTUATION) {
    q = q.replace(pattern, '').trim();
  }

  q = q.replace(/\s+/g, ' ').trim();

  const resultWords = q.split(/\s+/).filter(w => w.length > 0);
  const nonTrivialWords = resultWords.filter(w => !TRIVIAL_WORDS.has(w.toLowerCase()));

  if (q.length < 2 || nonTrivialWords.length === 0) {
    return { query: original, changed: false, stripped: [] };
  }

  return { query: q, changed: q !== original, stripped };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: CQT Regression — Exact fragments from test logs
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 1. CQT REGRESSION — Exact sanitizer outputs ══════');

test('CQT: "mi o Pythagorovi" → "Pythagorovi"', () => {
  const r = canonicalizeQuery('mi o Pythagorovi');
  if (r.query !== 'Pythagorovi') throw new Error(`Got: "${r.query}"`);
  if (!r.changed) throw new Error('Should be changed');
});

test('CQT: "mi co je to fotosyntéza" → "fotosyntéza"', () => {
  const r = canonicalizeQuery('mi co je to fotosyntéza');
  if (r.query !== 'fotosyntéza') throw new Error(`Got: "${r.query}"`);
});

test('CQT: "A teď mi o Praze" → "Praze"', () => {
  const r = canonicalizeQuery('A teď mi o Praze');
  if (r.query !== 'Praze') throw new Error(`Got: "${r.query}"`);
});

test('CQT: "prosím: co je to DNA?" → "DNA?"', () => {
  // After sanitizer strips "prosím", colon remains. Then "co je to" is noise.
  // Input to canonicalizer: "prosím: co je to DNA?"
  // But actually sanitizer already strips "prosím", so input is ": co je to DNA?"
  // Let's test both forms:
  const r1 = canonicalizeQuery(': co je to DNA?');
  if (!r1.query.includes('DNA')) throw new Error(`Got: "${r1.query}"`);
  // Also test if prosím leaks through
  const r2 = canonicalizeQuery('co je to DNA?');
  if (r2.query !== 'DNA?') throw new Error(`Got: "${r2.query}"`);
});

test('CQT: "Najdi informace o SpaceX" → "SpaceX"', () => {
  const r = canonicalizeQuery('Najdi informace o SpaceX');
  if (r.query !== 'SpaceX') throw new Error(`Got: "${r.query}"`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Czech noise prefixes
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 2. CZECH NOISE PREFIXES ══════');

test('CZ: "mi co je gravitace" → "gravitace"', () => {
  const r = canonicalizeQuery('mi co je gravitace');
  if (r.query !== 'gravitace') throw new Error(`Got: "${r.query}"`);
});

test('CZ: "mi něco o historii Prahy" → "historii Prahy"', () => {
  const r = canonicalizeQuery('mi něco o historii Prahy');
  if (r.query !== 'historii Prahy') throw new Error(`Got: "${r.query}"`);
});

test('CZ: "mi více o Albert Einstein" → "Albert Einstein"', () => {
  const r = canonicalizeQuery('mi více o Albert Einstein');
  if (r.query !== 'Albert Einstein') throw new Error(`Got: "${r.query}"`);
});

test('CZ: "co je to neuronová síť" → "neuronová síť"', () => {
  const r = canonicalizeQuery('co je to neuronová síť');
  if (r.query !== 'neuronová síť') throw new Error(`Got: "${r.query}"`);
});

test('CZ: "co je blockchain" → "blockchain"', () => {
  const r = canonicalizeQuery('co je blockchain');
  if (r.query !== 'blockchain') throw new Error(`Got: "${r.query}"`);
});

test('CZ: "a co Pythagoras" → "Pythagoras"', () => {
  const r = canonicalizeQuery('a co Pythagoras');
  if (r.query !== 'Pythagoras') throw new Error(`Got: "${r.query}"`);
});

test('CZ: "a jak funguje motor" → "funguje motor"', () => {
  const r = canonicalizeQuery('a jak funguje motor');
  if (r.query !== 'funguje motor') throw new Error(`Got: "${r.query}"`);
});

test('CZ: "hledej o Tesle" → "Tesle"', () => {
  const r = canonicalizeQuery('hledej o Tesle');
  if (r.query !== 'Tesle') throw new Error(`Got: "${r.query}"`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: English noise prefixes
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 3. ENGLISH NOISE PREFIXES ══════');

test('EN: "me about quantum physics" → "quantum physics"', () => {
  const r = canonicalizeQuery('me about quantum physics');
  if (r.query !== 'quantum physics') throw new Error(`Got: "${r.query}"`);
});

test('EN: "information about black holes" → "black holes"', () => {
  const r = canonicalizeQuery('information about black holes');
  if (r.query !== 'black holes') throw new Error(`Got: "${r.query}"`);
});

test('EN: "info about DNA" → "DNA"', () => {
  const r = canonicalizeQuery('info about DNA');
  if (r.query !== 'DNA') throw new Error(`Got: "${r.query}"`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: German noise prefixes
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 4. GERMAN NOISE PREFIXES ══════');

test('DE: "mir etwas über Quantenphysik" → "Quantenphysik"', () => {
  const r = canonicalizeQuery('mir etwas über Quantenphysik');
  if (r.query !== 'Quantenphysik') throw new Error(`Got: "${r.query}"`);
});

test('DE: "mir über das Sonnensystem" → "das Sonnensystem"', () => {
  const r = canonicalizeQuery('mir über das Sonnensystem');
  if (r.query !== 'das Sonnensystem') throw new Error(`Got: "${r.query}"`);
});

test('DE: "Informationen über SpaceX" → "SpaceX"', () => {
  const r = canonicalizeQuery('Informationen über SpaceX');
  if (r.query !== 'SpaceX') throw new Error(`Got: "${r.query}"`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: Polish noise prefixes
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 5. POLISH NOISE PREFIXES ══════');

test('PL: "co to jest fotosynteza" → "fotosynteza"', () => {
  const r = canonicalizeQuery('co to jest fotosynteza');
  if (r.query !== 'fotosynteza') throw new Error(`Got: "${r.query}"`);
});

test('PL: "informacje o Polsce" → "Polsce"', () => {
  const r = canonicalizeQuery('informacje o Polsce');
  if (r.query !== 'Polsce') throw new Error(`Got: "${r.query}"`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: French noise prefixes
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 6. FRENCH NOISE PREFIXES ══════');

test('FR: "des informations sur la France" → "la France"', () => {
  const r = canonicalizeQuery('des informations sur la France');
  if (r.query !== 'la France') throw new Error(`Got: "${r.query}"`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: Spanish noise prefixes
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 7. SPANISH NOISE PREFIXES ══════');

test('ES: "información sobre España" → "España"', () => {
  const r = canonicalizeQuery('información sobre España');
  if (r.query !== 'España') throw new Error(`Got: "${r.query}"`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: Residual punctuation
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 8. RESIDUAL PUNCTUATION ══════');

test('Punct: ": DNA?" → "DNA?"', () => {
  const r = canonicalizeQuery(': DNA?');
  if (r.query !== 'DNA?') throw new Error(`Got: "${r.query}"`);
});

test('Punct: "- gravitace" → "gravitace"', () => {
  const r = canonicalizeQuery('- gravitace');
  if (r.query !== 'gravitace') throw new Error(`Got: "${r.query}"`);
});

test('Punct: "„Pythagoras"" → "Pythagoras"', () => {
  const r = canonicalizeQuery('„Pythagoras"');
  if (r.query !== 'Pythagoras') throw new Error(`Got: "${r.query}"`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: Safety — should NOT modify clean queries
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 9. SAFETY — Clean queries unchanged ══════');

test('Safe: "Albert Einstein" → unchanged', () => {
  const r = canonicalizeQuery('Albert Einstein');
  if (r.query !== 'Albert Einstein') throw new Error(`Got: "${r.query}"`);
  if (r.changed) throw new Error('Should not be changed');
});

test('Safe: "Kolik obyvatel má Praha?" → unchanged', () => {
  const r = canonicalizeQuery('Kolik obyvatel má Praha?');
  if (r.query !== 'Kolik obyvatel má Praha?') throw new Error(`Got: "${r.query}"`);
  if (r.changed) throw new Error('Should not be changed');
});

test('Safe: "What is photosynthesis?" → unchanged', () => {
  const r = canonicalizeQuery('What is photosynthesis?');
  if (r.query !== 'What is photosynthesis?') throw new Error(`Got: "${r.query}"`);
  if (r.changed) throw new Error('Should not be changed');
});

test('Safe: "Was ist Quantenphysik?" → unchanged', () => {
  const r = canonicalizeQuery('Was ist Quantenphysik?');
  if (r.query !== 'Was ist Quantenphysik?') throw new Error(`Got: "${r.query}"`);
  if (r.changed) throw new Error('Should not be changed');
});

test('Safe: "Jak funguje DNS?" → unchanged', () => {
  const r = canonicalizeQuery('Jak funguje DNS?');
  if (r.query !== 'Jak funguje DNS?') throw new Error(`Got: "${r.query}"`);
  if (r.changed) throw new Error('Should not be changed');
});

test('Safe: "SpaceX Starship launch 2024" → unchanged', () => {
  const r = canonicalizeQuery('SpaceX Starship launch 2024');
  if (r.query !== 'SpaceX Starship launch 2024') throw new Error(`Got: "${r.query}"`);
  if (r.changed) throw new Error('Should not be changed');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 10. EDGE CASES ══════');

test('Edge: null → empty string', () => {
  const r = canonicalizeQuery(null);
  if (r.query !== '') throw new Error(`Got: "${r.query}"`);
  if (r.changed) throw new Error('Should not be changed');
});

test('Edge: empty → empty', () => {
  const r = canonicalizeQuery('');
  if (r.query !== '') throw new Error(`Got: "${r.query}"`);
});

test('Edge: just noise "mi o" → fallback to original', () => {
  const r = canonicalizeQuery('mi o');
  if (r.query !== 'mi o') throw new Error(`Got: "${r.query}"`);
  if (r.changed) throw new Error('Should fallback, not change');
});

test('Edge: just trivial word "co" → fallback to original', () => {
  const r = canonicalizeQuery('co');
  if (r.query !== 'co') throw new Error(`Got: "${r.query}"`);
  if (r.changed) throw new Error('Should fallback');
});

test('Edge: single meaningful word "mi gravitace" → "gravitace"', () => {
  const r = canonicalizeQuery('mi gravitace');
  if (r.query !== 'gravitace') throw new Error(`Got: "${r.query}"`);
  if (!r.changed) throw new Error('Should be changed');
});

test('Edge: long query untouched', () => {
  const long = 'Jaká je průměrná teplota ve Žďáru nad Sázavou v lednu 1987?';
  const r = canonicalizeQuery(long);
  if (r.query !== long) throw new Error(`Got: "${r.query}"`);
  if (r.changed) throw new Error('Should not touch long clean query');
});

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11: Returned metadata
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n══════ 11. METADATA ══════');

test('Meta: stripped array contains prefix', () => {
  const r = canonicalizeQuery('mi o Pythagorovi');
  if (!r.stripped.includes('mi o')) throw new Error(`Stripped: ${JSON.stringify(r.stripped)}`);
});

test('Meta: unchanged has empty stripped', () => {
  const r = canonicalizeQuery('Albert Einstein');
  if (r.stripped.length !== 0) throw new Error(`Stripped should be empty: ${JSON.stringify(r.stripped)}`);
});

test('Meta: changed=true when canonicalized', () => {
  if (!canonicalizeQuery('mi o Tesle').changed) throw new Error('Should be changed');
  if (canonicalizeQuery('Tesla').changed) throw new Error('Should not be changed');
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n════════════════════════════════════════════`);
console.log(`  PASSED: ${passed}`);
console.log(`  FAILED: ${failed}`);
console.log(`════════════════════════════════════════════`);

process.exit(failed > 0 ? 1 : 0);
