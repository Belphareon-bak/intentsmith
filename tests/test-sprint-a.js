// Sprint A — Full intent classification test v2 (with \b fix)

const SELF_REFERENCE_PATTERNS = [
  /jak se jmenuj/i, /jaké je moje? jméno/i, /kdo jsem/i,
  /co jsem (ti |)říkal/i, /co jsem (ti |)psal/i, /pamatuj(eš|ete)/i,
  /co (víš|vís) o mně/i, /co o mně víš/i, /co (sis |)zapamatoval/i,
  /znáš m[ěe]/i, /my name/i, /who am I/i,
  /what did (I|we) (say|discuss|talk)/i, /do you (remember|know) (me|my)/i,
  /what do you know about me/i,
];

const STATEMENT_PATTERNS = [
  /moje? jméno je/i, /jmenuj[ui] se /i, /bydlím (v|na) /i,
  /pracuj[ui] (v|jako|na|pro) /i, /studu?j[ui] /i, /mám (rád|ráda?) /i,
  /preferuj[ui] /i, /my name is /i, /I (am|'m) (a |an )?[A-Z]/,
  /I (live|work|study) (in|at|as|for) /i, /I prefer /i,
];

const KNOWLEDGE_PATTERNS = [
  /řekni mi (o |víc o |něco o )/i, /pověz mi (o |víc o |něco o )/i,
  /popiš (mi )?.{3,}/i, /informace o .{3,}/i, /co (víš|vís|víte) o .{3,}/i,
  /tell me about .{3,}/i, /tell me (more )?about /i,
  /give me info(rmation)? (on|about) /i, /explain .{5,}/i, /describe .{3,}/i,
];

const COMPOUND_CZ = /\b(co je|co jsou|co to je|kdo je|kdo byl|kde je|kde jsou|kdy bude|kdy je|kdy byl|jak funguje|jak fungují|jak se dělá|jak se tvoří|jak vzniká|proč je|proč jsou|proč se)\b/i;
const COMPOUND_EN = /\b(what is|what are|what was|who is|who was|where is|where are|when is|when was|how does|how do|how is|why is|why are|why does)\b/i;

function classify(text) {
  text = text.trim();
  // (In full CRE, LOCAL/CONVERSATIONAL/CREATIVE etc. run before these)
  if (SELF_REFERENCE_PATTERNS.some(p => p.test(text))) return 'CONVERSATIONAL (self-ref)';
  if (STATEMENT_PATTERNS.some(p => p.test(text))) return 'CONVERSATIONAL (statement)';
  if (KNOWLEDGE_PATTERNS.some(p => p.test(text))) return 'SEARCH (knowledge)';
  // Tier 1: compound phrases
  if (COMPOUND_CZ.test(text) || COMPOUND_EN.test(text)) return 'SEARCH (compound)';
  // Tier 2: question words in substantive text
  const hasQW = /(?:^|\s)(jak|co|kdo|kde|kdy|proč|how|what|who|where|when|why)(?:\s|[?!.,;]|$)/i.test(text);
  const wc = text.split(/\s+/).length;
  if (hasQW && text.length > 12 && wc >= 3) return 'SEARCH (tier2)';
  return 'AMBIGUOUS';
}

// ═══════ ALL TEST CASES ═══════
const tests = [
  // ─── STOP/GO CRITERIA (MANDATORY) ───
  ['Řekni mi o Pythagorovi',     'SEARCH'],
  ['Jak se jmenuju?',            'CONVERSATIONAL'],
  ['Moje jméno je Alice',        'CONVERSATIONAL'],
  ['Opravdu?',                   'AMBIGUOUS'],

  // ─── Self-reference ───
  ['Kdo jsem?',                  'CONVERSATIONAL'],
  ['Co jsem ti říkal?',          'CONVERSATIONAL'],
  ['Pamatuješ si?',             'CONVERSATIONAL'],
  ['What is my name?',           'CONVERSATIONAL'],
  ['Do you remember me?',        'CONVERSATIONAL'],
  ['Co o mně víš?',             'CONVERSATIONAL'],

  // ─── Statements ───
  ['Jmenuju se Bob',             'CONVERSATIONAL'],
  ['Bydlím v Praze',            'CONVERSATIONAL'],
  ['Pracuju jako developer',     'CONVERSATIONAL'],
  ['My name is Alice',           'CONVERSATIONAL'],
  ['I am a Developer',           'CONVERSATIONAL'],
  ['I live in Prague',           'CONVERSATIONAL'],
  ['Mám rád Python',            'CONVERSATIONAL'],

  // ─── Knowledge requests ───
  ['Řekni mi o kvantové fyzice',   'SEARCH'],
  ['Pověz mi o Darwinovi',         'SEARCH'],
  ['Popiš mi proces fotosyntézy',  'SEARCH'],
  ['Tell me about machine learning','SEARCH'],
  ['Explain quantum computing basics','SEARCH'],
  ['Informace o Pythagorovi',       'SEARCH'],
  ['Describe the solar system',     'SEARCH'],

  // ─── Compound catch-all ───
  ['Co je to AI?',               'SEARCH'],
  ['Kdo je Elon Musk?',         'SEARCH'],
  ['Kdo byl Napoleon?',         'SEARCH'],
  ['Kde je Praha?',             'SEARCH'],
  ['Jak funguje gravitace?',    'SEARCH'],
  ['Proč je nebe modré?',       'SEARCH'],
  ['What is photosynthesis?',   'SEARCH'],
  ['Who is the president?',     'SEARCH'],
  ['How does gravity work?',    'SEARCH'],
  ['Why is the sky blue?',      'SEARCH'],

  // ─── Tier 2 (substantive questions) ───
  ['Kdo vyhrál MS ve fotbale?',    'SEARCH'],
  ['Jak opravit rozbitý kód?',     'SEARCH'],
  ['Proč nefunguje můj internet?', 'SEARCH'],
  ['Co znamená slovo paradigma?',  'SEARCH'],
  ['Kde najdu dobrou restauraci?', 'SEARCH'],
  ['What happened in the election?','SEARCH'],

  // ─── Should NOT be SEARCH ───
  ['Hm',        'AMBIGUOUS'],
  ['Ok',        'AMBIGUOUS'],
  ['Fajn',      'AMBIGUOUS'],
  ['Ne',        'AMBIGUOUS'],
  ['Proč?',     'AMBIGUOUS'],
  ['Co?',       'AMBIGUOUS'],
  ['Jak?',      'AMBIGUOUS'],
  ['test',      'AMBIGUOUS'],
  ['ano',       'AMBIGUOUS'],
  ['Jak se máš?',  'AMBIGUOUS'],
  ['Co děláš?',    'AMBIGUOUS'],
  ['Díky moc',     'AMBIGUOUS'],
];

let pass = 0, fail = 0;
for (const [input, expected] of tests) {
  const result = classify(input);
  const matches = result.startsWith(expected.split(' ')[0]);
  if (matches) { pass++; }
  else {
    fail++;
    console.log(`  ❌ "${input}" → ${result} (expected ${expected})`);
  }
}
console.log(`\n══════════════════════════════`);
console.log(`  Sprint A: ${pass}/${pass+fail} PASS, ${fail} FAIL`);
console.log(`══════════════════════════════`);
if (fail === 0) console.log('✅ ALL STOP/GO CRITERIA MET');
