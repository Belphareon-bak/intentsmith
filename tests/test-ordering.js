// Test that Sprint A patterns don't conflict with existing CRE patterns

// Existing CONVERSATIONAL_PATTERNS (subset for testing)
const CONV = [
  /^(ahoj|čau|nazdar|hi|hello|hey)[\s!.?]*$/i,
  /^(díky|děkuji|thanks|thank you)[\s!.?]*$/i,
  /^(jak se máš|how are you)/i,
  /^(co si myslíš|what do you think)/i,
  /tvůj názor/i, /your opinion/i,
  /vysvětli.*jednoduš/i,
  /můžeš.*mi.*to.*vysvětlit/i,
  /^(ještě jednou|znovu|opakuj)/i,
  /^(nechápu|nerozumím)/i,
  /^(proč|proc)\??$/i,
  /^(jak|how)\??$/i,
  /co to znamená/i,
  /pokračuj/i, /continue/i,
  /tell me more/i,
  /can you explain/i,
  /explain.*simpler/i,
];

const SEARCH = [
  /najdi/i, /hledej/i, /vyhledej/i, /search/i, /find/i,
  /co je/i, /kdo je/i, /what is/i, /who is/i,
  /aktuální/i, /current/i, /latest/i,
  /cena/i, /price/i,
  /kde (je|jsou|najdu)/i, /where (is|are|can)/i,
  /kdy (je|jsou|bude)/i, /when (is|are|will)/i,
];

// NEW patterns
const SELF_REF = [
  /jak se jmenuj/i, /jaké je moje? jméno/i, /kdo jsem/i,
  /co jsem (ti |)říkal/i, /pamatuj(eš|ete)/i,
  /co (víš|vís) o mně/i, /co o mně víš/i,
  /my name/i, /who am I/i,
  /what did (I|we) (say|discuss|talk)/i,
  /do you (remember|know) (me|my)/i,
];

const STMT = [
  /moje? jméno je/i, /jmenuj[ui] se /i, /bydlím (v|na) /i,
  /pracuj[ui] (v|jako|na|pro) /i, /my name is /i,
  /I (am|'m) (a |an )?[A-Z]/, /I (live|work|study) (in|at|as|for) /i,
];

const KNOW = [
  /řekni mi (o |víc o |něco o )/i, /pověz mi (o |víc o |něco o )/i,
  /popiš (mi )?.{3,}/i, /informace o .{3,}/i,
  /co (víš|vís|víte) o .{3,}/i,
  /tell me about .{3,}/i, /explain .{5,}/i, /describe .{3,}/i,
];

// Simulate full CRE order
function fullClassify(text) {
  text = text.trim();
  // 1. CONVERSATIONAL (existing — checked first in real CRE)
  if (CONV.some(p => p.test(text))) return 'CONV (existing)';
  // 2. SEARCH (existing explicit patterns)
  if (SEARCH.some(p => p.test(text))) return 'SEARCH (explicit)';
  // 3. NEW: self-reference
  if (SELF_REF.some(p => p.test(text))) return 'CONV (self-ref)';
  // 4. NEW: statement
  if (STMT.some(p => p.test(text))) return 'CONV (statement)';
  // 5. NEW: knowledge
  if (KNOW.some(p => p.test(text))) return 'SEARCH (knowledge)';
  return '(falls through)';
}

// Test potential conflicts
const conflicts = [
  // These should be caught by EXISTING patterns BEFORE new ones
  ['Jak se máš?',           'CONV (existing)',    'existing CONV catches first'],
  ['Díky',                  'CONV (existing)',    'existing CONV catches first'],
  ['Co to znamená?',        'CONV (existing)',    'existing CONV catches first'],
  ['Can you explain?',      'CONV (existing)',    'existing CONV catches first'],
  ['Tell me more',          'CONV (existing)',    'existing CONV catches first'],
  ['Proč?',                 'CONV (existing)',    'existing ^proč?$ catches'],
  ['Jak?',                  'CONV (existing)',    'existing ^jak?$ catches'],
  // These should be caught by EXISTING SEARCH before new patterns
  ['Co je to AI?',          'SEARCH (explicit)',  'existing "co je" catches'],
  ['Kdo je Musk?',          'SEARCH (explicit)',  'existing "kdo je" catches'],
  ['Najdi mi hotel',        'SEARCH (explicit)',  'existing "najdi" catches'],
  // These should be caught by NEW patterns
  ['Jak se jmenuju?',       'CONV (self-ref)',    'new self-ref catches'],
  ['Kdo jsem?',             'CONV (self-ref)',    'new self-ref catches'],
  ['Co víš o mně?',         'CONV (self-ref)',    'new self-ref catches'],
  ['Moje jméno je Alice',   'CONV (statement)',   'new statement catches'],
  ['I am a Developer',      'CONV (statement)',   'new statement catches'],
  ['Řekni mi o Pythagorovi','SEARCH (knowledge)', 'new knowledge catches'],
  ['Popiš mi fotosyntézu',  'SEARCH (knowledge)', 'new knowledge catches'],
  // Tricky: "Co víš o Pythagorovi?" — should be KNOWLEDGE, not SELF-REF
  ['Co víš o Pythagorovi?', 'SEARCH (knowledge)', 'knowledge, not self-ref (no "mně")'],
];

let pass = 0, fail = 0;
for (const [input, expected, note] of conflicts) {
  const result = fullClassify(input);
  const ok = result === expected;
  if (ok) { pass++; }
  else {
    fail++;
    console.log(`  ❌ "${input}" → ${result} (expected ${expected}) [${note}]`);
  }
}
console.log(`\nOrdering conflicts: ${pass}/${pass+fail} PASS, ${fail} FAIL`);
if (fail === 0) console.log('✅ No ordering conflicts detected');
