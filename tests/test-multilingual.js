// ═══════ MULTILINGUAL PATTERN TESTS v2 ═══════
// Fixed: /g flag stateful .test() issue, uses fresh regex per call

let total = 0, fail = 0;
function run(name, tests, fn) {
  let p = 0, f = 0;
  for (const [input, expected, desc] of tests) {
    const result = fn(input);
    if (result === expected) { p++; } else { f++; console.log(`  ❌ [${name}] ${desc}: "${input}" → ${result}`); }
  }
  total += p + f; fail += f;
  console.log(`  ${name}: ${p}/${p+f}`);
}

// === 1. TIER 1 COMPOUND ===
function tier1(text) {
  // CZ
  return /\b(co je|co jsou|co to je|kdo je|kdo byl|kde je|kde jsou|kdy bude|kdy je|kdy byl|jak funguje|jak fungují|jak se dělá|jak se tvoří|jak vzniká)\b/i.test(text) ||
    /(?:^|\s)(proč je|proč jsou|proč se)(?:\s|[?!.,;]|$)/i.test(text) ||
    /(?:^|\s)(jak[áéý] je|jak[áéý] jsou|jak[áéý] byl[aoy]?|kolik je|kolik má|kolik stojí)(?:\s|[?!.,;]|$)/i.test(text) ||
  // SK
    /(?:^|\s)(čo je|čo sú|kto je|kto bol|kde je|kedy je|kedy bol|ako funguje|prečo je|prečo sú|koľko je|koľko má|koľko stojí|aký je|aká je|aké je|aké sú)(?:\s|[?!.,;]|$)/i.test(text) ||
  // DE
    /(?:^|\s)(was ist|was sind|was war|wer ist|wer war|wo ist|wo sind|wann ist|wann war|wie funktioniert|warum ist|warum sind|wie viel|wie viele|welche[rs]? ist)(?:\s|[?!.,;]|$)/i.test(text) ||
  // PL
    /(?:^|\s)(co to jest|co to są|kto to jest|kto był|gdzie jest|kiedy jest|kiedy był|jak działa|dlaczego jest|ile jest|ile ma|ile kosztuje|jaki jest|jaka jest|jakie jest|jakie są)(?:\s|[?!.,;]|$)/i.test(text) ||
  // FR
    /(?:^|\s)(qu'est[- ]ce que|qui est|où est|où sont|quand est|comment fonctionne|pourquoi est|combien|quel est|quelle est|quels sont|quelles sont)(?:\s|[?!.,;]|$)/i.test(text) ||
  // ES
    /(?:^|\s)(qué es|qué son|quién es|quién fue|dónde está|dónde están|cuándo es|cuándo fue|cómo funciona|por qué es|por qué son|cuánto|cuántos|cuál es|cuáles son)(?:\s|[?!.,;]|$)/i.test(text) ||
  // EN
    /\b(what is|what are|what was|who is|who was|where is|where are|when is|when was|how does|how do|how is|why is|why are|why does|how many|how much|which is)\b/i.test(text);
}

run('Tier1-Compound', [
  ['Jaká je populace Prahy?', true, 'CZ: jaká je'],
  ['Co je to gravitace?', true, 'CZ: co je'],
  ['Kolik stojí Bitcoin?', true, 'CZ: kolik stojí'],
  ['Čo je kvantová fyzika?', true, 'SK: čo je'],
  ['Kto bol Einstein?', true, 'SK: kto bol'],
  ['Koľko má Bratislava obyvateľov?', true, 'SK: koľko má'],
  ['Aký je stav ekonomiky?', true, 'SK: aký je'],
  ['Was ist Quantenphysik?', true, 'DE: was ist'],
  ['Wer war Einstein?', true, 'DE: wer war'],
  ['Wie funktioniert das?', true, 'DE: wie funktioniert'],
  ['Wo ist Berlin?', true, 'DE: wo ist'],
  ['Co to jest grawitacja?', true, 'PL: co to jest'],
  ['Kto był Einstein?', true, 'PL: kto był'],
  ['Ile kosztuje Bitcoin?', true, 'PL: ile kosztuje'],
  ['Jak działa komputer?', true, 'PL: jak działa'],
  ["Qu'est-ce que la gravité?", true, 'FR: qu\'est-ce que'],
  ['Qui est Macron?', true, 'FR: qui est'],
  ['Où est Paris?', true, 'FR: où est'],
  ['Quel est le prix?', true, 'FR: quel est'],
  ['Qué es la gravedad?', true, 'ES: qué es'],
  ['Quién fue Einstein?', true, 'ES: quién fue'],
  ['Dónde está Madrid?', true, 'ES: dónde está'],
  ['Cuál es la capital?', true, 'ES: cuál es'],
  ['What is quantum physics?', true, 'EN: what is'],
  ['How many planets exist?', true, 'EN: how many'],
  ['Hola amigo', false, 'greeting → no match'],
  ['Ahoj', false, 'CZ greeting → no match'],
  ['Guten Tag', false, 'DE greeting → no match'],
], tier1);

// === 2. SELF-REFERENCE ===
const SELF_REF = [
  /jak se jmenuj/i, /kdo jsem/i, /znáš m[ěe]/i,
  /ako sa volám/i, /kto som/i,
  /wie hei(ß|ss)e ich/i, /wer bin ich/i,
  /jak si[ęe] nazywam/i, /kim jestem/i,
  /comment (?:je )?m'appelle/i, /qui suis[- ]je/i,
  /cómo me llamo/i, /quién soy/i,
  /my name/i, /who am I/i,
];
run('Self-Reference', [
  ['Jak se jmenuju?', true, 'CZ'], ['Ako sa volám?', true, 'SK'],
  ['Wie heiße ich?', true, 'DE'], ['Jak się nazywam?', true, 'PL'],
  ["Comment je m'appelle?", true, 'FR'], ['Cómo me llamo?', true, 'ES'],
  ['Who am I?', true, 'EN'], ['Wer bin ich?', true, 'DE'],
  ['Kim jestem?', true, 'PL'], ['Qui suis-je?', true, 'FR'],
  ['Quién soy?', true, 'ES'],
], t => SELF_REF.some(p => p.test(t)));

// === 3. KNOWLEDGE ===
const KNOW = [
  /řekni mi (o |víc o |něco o )/i, /popiš (mi )?.{3,}/i,
  /povedz mi (o |viac o |niečo o )/i,
  /(?:er)?zähl mir (von|über|etwas über) /i,
  /powiedz mi o .{3,}/i,
  /(?:dis|parle)[- ]moi (de|d') .{3,}/i,
  /(?:dime|cuéntame|háblame) (sobre|de|acerca) /i,
  /tell me about .{3,}/i, /explain .{5,}/i,
];
run('Knowledge', [
  ['Řekni mi o Pythagorovi', true, 'CZ'], ['Povedz mi o Einsteinovi', true, 'SK'],
  ['Erzähl mir von Einstein', true, 'DE'], ['Powiedz mi o Einsteinie', true, 'PL'],
  ["Dis-moi de la physique", true, 'FR'], ['Cuéntame sobre la física', true, 'ES'],
  ['Tell me about Einstein', true, 'EN'], ['Explain quantum computing', true, 'EN'],
], t => KNOW.some(p => p.test(t)));

// === 4. STATEMENT ===
const STMT = [
  /jmenuj[ui] se /i, /bydlím (v|na) /i,
  /volám sa /i, /bývam (v|na) /i,
  /ich hei(ß|ss)e /i, /mein name ist /i,
  /nazywam si[ęe] /i, /mieszkam (w|na) /i,
  /je m'appelle /i, /j'habite [àa] /i,
  /me llamo /i, /vivo en /i,
  /my name is /i, /I (live|work|study) (in|at|as|for) /i,
];
run('Statement', [
  ['Jmenuju se Alice', true, 'CZ'], ['Bydlím v Praze', true, 'CZ'],
  ['Volám sa Bob', true, 'SK'], ['Ich heiße Alice', true, 'DE'],
  ['Mein Name ist Bob', true, 'DE'], ['Nazywam się Alice', true, 'PL'],
  ['Mieszkam w Warszawie', true, 'PL'], ["Je m'appelle Alice", true, 'FR'],
  ["J'habite à Paris", true, 'FR'], ['Me llamo Alice', true, 'ES'],
  ['Vivo en Madrid', true, 'ES'], ['My name is Alice', true, 'EN'],
  ['I work at Google', true, 'EN'],
], t => STMT.some(p => p.test(t)));

// === 5. FOLLOW-UP ===
const FU = [
  /^a (co|jak|kde|kdy|proč)\b/i, /\b(jeho|její|jejich|toho|tomu|tím|tom)\b/i,
  /^a (čo|ako|kde|kedy|prečo)\b/i,
  /^und (was|wie|wo|wann|warum)\b/i, /\b(sein|seine[rmns]?|dessen|deren|davon|damit|darüber)\b/i,
  /^a (co|jak|gdzie|kiedy|dlaczego)\b/i, /\b(jego|jej|tego|temu|tym)\b/i,
  /^et (que|comment|où|quand|pourquoi)\b/i, /\b(son|sa|ses|leur|leurs|celui|celle)\b/i,
  /^y (qué|cómo|dónde|cuándo)\b/i, /\b(su|sus|él|ella|eso|esto|aquel)\b/i,
  /\b(he|his|she|her|its|their|that|those|it)\b/i,
];
run('Follow-Up', [
  ['A co jeho teorém?', true, 'CZ'], ['A čo jeho teória?', true, 'SK'],
  ['Und was ist damit?', true, 'DE'], ['Und seine Theorie?', true, 'DE'],
  ['A co jego teoria?', true, 'PL'], ['Et que dire de lui?', true, 'FR'],
  ['Y qué hay de eso?', true, 'ES'], ['What about his theory?', true, 'EN'],
], t => FU.some(p => p.test(t)));

// === 6. SANITIZER (test .replace() not .test()) ===
const INSTR = [
  'odpověz', 'stručně', 'prosím', 'česky', 'anglicky',
  'odpovedz', 'stručne', 'slovensky',
  'antworte', 'kurz', 'bitte', 'auf deutsch',
  'odpowiedz', 'krótko', 'proszę', 'po polsku',
  'réponds', 'brièvement', 'en français',
  'responde', 'brevemente', 'por favor',
  'briefly', 'please', 'concisely',
];
function sanitize(input) {
  const re = new RegExp(
    '(?:^|\\s)(' + INSTR.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?:\\s|[.?!,;:]|$)', 'gi'
  );
  let q = input;
  q = q.replace(re, ' ').replace(re, ' ').trim();
  return q !== input.trim();  // true if anything was stripped
}
run('Sanitizer', [
  ['Odpověz stručně česky', true, 'CZ: stripped'],
  ['Odpovedz stručne slovensky', true, 'SK: stripped'],
  ['Antworte kurz bitte', true, 'DE: stripped'],
  ['Odpowiedz krótko proszę', true, 'PL: stripped'],
  ['Réponds brièvement', true, 'FR: stripped'],
  ['Responde brevemente por favor', true, 'ES: stripped'],
  ['Answer briefly please', true, 'EN: stripped'],
  ['Pythagoras theorem', false, 'content → NOT stripped'],
], sanitize);

// === SUMMARY ===
console.log(`\n══════════════════════════════`);
console.log(`  MULTILINGUAL: ${total-fail}/${total} PASS, ${fail} FAIL`);
console.log(`══════════════════════════════`);
if (fail === 0) console.log('✅ ALL MULTILINGUAL TESTS PASS');
