// Sprint C1 v2 — with fixed hasOwnSubject

const FOLLOW_UP_INDICATORS = [
  /^a (co|jak|kde|kdy|proč)\b/i,
  /^(a |)(ten|ta|to|ti|ty)\b/i,
  /\b(jeho|její|jejich|toho|tomu|tím|tom)\b/i,
  /\b(he|his|she|her|its|their|that|those|it)\b/i,
  /^(kdy|kde|jak|proč) se\b/i,
  /^(when|where|how|why) (did|was|were|is)\b/i,
];

const QUESTION_WORDS = /^(co|kdo|kde|kdy|jak|proč|jaký|jaké|která|který|what|who|where|when|how|why|which|does|did|is|are|was|were|a|and)\s/i;

function hasOwnSubject(input) {
  const stripped = input.replace(QUESTION_WORDS, '').trim();
  const words = stripped.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (i === 0 && words.length > 1) continue;
    if (/^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ][a-záčďéěíňóřšťúůýž]{2,}/.test(w)) return true;
  }
  if (/^(co je|kdo je|co jsou|kdo byl|what is|who is|who was)\b/i.test(input)) return true;
  return false;
}

function enrichSearchQuery(input, lastTurnTopic) {
  if (!lastTurnTopic || !input) return { query: input, enriched: false, topic: null };
  const isFollowUp = FOLLOW_UP_INDICATORS.some(p => p.test(input));
  if (!isFollowUp || hasOwnSubject(input)) return { query: input, enriched: false, topic: lastTurnTopic };
  let cleaned = input
    .replace(/^a\s+/i, '')
    .replace(/\b(jeho|její|jejich|he|his|she|her|its|their|that|those|it)\b/gi, '')
    .replace(/\s+/g, ' ').trim();
  return { query: `${lastTurnTopic} ${cleaned}`.trim(), enriched: true, topic: lastTurnTopic };
}

function extractTurnTopic(userInput) {
  if (!userInput || typeof userInput !== 'string') return null;
  const text = userInput.trim();
  const aboutMatch = text.match(/\bo\s+(\S+(?:\s+\S+){0,3})/i);
  if (aboutMatch) return aboutMatch[1].replace(/[?.!,;]+$/, '').trim();
  const aboutEnMatch = text.match(/\babout\s+(.{3,40}?)(?:\?|$|\.)/i);
  if (aboutEnMatch) return aboutEnMatch[1].trim();
  const whatIsMatch = text.match(/(?:co je|co jsou|kdo je|kdo byl|what is|who is|who was)\s+(.{2,40}?)(?:\?|$|\.)/i);
  if (whatIsMatch) return whatIsMatch[1].trim();
  const SKIP = /^(jak|co|kdo|kde|kdy|proč|how|what|who|where|when|why|the|and|for|but|not|are|was|has|had|can|will|a|i|o|v|k|z|na|do|se|je|to|si|ale|že|pro)$/i;
  const candidates = text.replace(/[?.!,;]/g, '').split(/\s+/).filter(w => w.length > 3 && !SKIP.test(w));
  if (candidates.length > 0) return candidates.slice(0, 3).join(' ');
  return null;
}

// ═══════ ALL TESTS ═══════

const enrichTests = [
  ['A co jeho teorém?', 'Pythagoras', 'Pythagoras', true, 'STOP/GO: follow-up gets topic'],
  ['Kdy se narodil?', 'Pythagoras', 'Pythagoras', true, 'follow-up "kdy se" enriched'],
  ['A jak funguje?', 'gravitace', 'gravitace', true, 'follow-up "a jak" enriched'],
  ['When was he born?', 'Einstein', 'Einstein', true, 'English follow-up enriched'],
  ['What about his theory?', 'Newton', 'Newton', true, 'English "his" follow-up'],
  // Should NOT enrich (has own subject — proper noun inside sentence)
  ['Kdo je Einstein?', 'Pythagoras', 'Einstein', false, 'Own subject → no enrichment'],
  ['Co je to DNA?', 'Pythagoras', 'DNA', false, '"co je X" → own subject'],
  ['Tell me about Mars', 'Jupiter', 'Mars', false, '"about Mars" → has proper noun'],
  // No topic
  ['A co jeho teorém?', null, 'A co jeho teorém?', false, 'No topic → no enrichment'],
  // Not a follow-up
  ['Kolik je 2+2?', 'Pythagoras', '2+2', false, 'Not a follow-up pattern'],
];

let p1 = 0, f1 = 0;
for (const [input, topic, expected, shouldEnrich, desc] of enrichTests) {
  const r = enrichSearchQuery(input, topic);
  const ok = r.query.includes(expected) && r.enriched === shouldEnrich;
  if (ok) p1++; else { f1++; console.log(`  ❌ [enrich] ${desc}: "${r.query}" enriched=${r.enriched}`); }
}

const topicTests = [
  ['Řekni mi o Pythagorovi', 'Pythagorovi', '"o X" extraction'],
  ['Tell me about quantum computing', 'quantum computing', '"about X" extraction'],
  ['Co je to gravitace?', 'gravitace', '"co je X" extraction'],
  ['Kdo byl Napoleon?', 'Napoleon', '"kdo byl X" extraction'],
  ['What is photosynthesis?', 'photosynthesis', '"what is X" extraction'],
  ['Who was Einstein?', 'Einstein', '"who was X" extraction'],
  ['Jak funguje počítač?', 'funguje počítač', 'fallback to significant words'],
  ['Hi', null, 'Short greeting → null'],
  ['', null, 'Empty → null'],
];

let p2 = 0, f2 = 0;
for (const [input, expected, desc] of topicTests) {
  const r = extractTurnTopic(input);
  const ok = expected === null ? r === null : (r && r.includes(expected));
  if (ok) p2++; else { f2++; console.log(`  ❌ [topic] ${desc}: "${input}" → "${r}"`); }
}

// Integration
const scenarios = [
  { turn1: 'Řekni mi o Pythagorovi', turn2: 'A co jeho teorém?', check: 'Pythagorovi', desc: 'Pythagoras follow-up' },
  { turn1: 'Tell me about machine learning', turn2: 'How does it work?', check: 'machine learning', desc: 'ML follow-up' },
  { turn1: 'Co je to gravitace?', turn2: 'A proč je důležitá?', check: 'gravitace', desc: 'Gravitace follow-up' },
];

let p3 = 0, f3 = 0;
for (const { turn1, turn2, check, desc } of scenarios) {
  const topic = extractTurnTopic(turn1);
  const { query } = enrichSearchQuery(turn2, topic);
  const ok = query.toLowerCase().includes(check.toLowerCase());
  if (ok) p3++; else { f3++; console.log(`  ❌ [integ] ${desc}: topic="${topic}" → query="${query}"`); }
}

// hasOwnSubject unit tests
const subjTests = [
  ['Kdy se narodil?', false, 'Question word start → no own subject'],
  ['When was he born?', false, 'English question start → no'],
  ['A co jeho teorém?', false, 'Follow-up connector → no'],
  ['Kdo je Einstein?', true, '"kdo je X" → has subject'],
  ['What is photosynthesis?', true, '"what is X" → has subject'],
  ['Tell me about Newton', true, 'Proper noun "Newton" inside → has subject'],
  ['A co DNA?', false, 'Acronym only — short word, no match'],
];

let p4 = 0, f4 = 0;
for (const [input, expected, desc] of subjTests) {
  const r = hasOwnSubject(input);
  if (r === expected) p4++; else { f4++; console.log(`  ❌ [subj] ${desc}: "${input}" → ${r}`); }
}

const total = p1+p2+p3+p4;
const totalF = f1+f2+f3+f4;
console.log(`\n══════════════════════════════`);
console.log(`  Sprint C1: ${total}/${total+totalF} PASS, ${totalF} FAIL`);
console.log(`  enrich:      ${p1}/${p1+f1}`);
console.log(`  topic:       ${p2}/${p2+f2}`);
console.log(`  integration: ${p3}/${p3+f3}`);
console.log(`  hasOwnSubj:  ${p4}/${p4+f4}`);
console.log(`══════════════════════════════`);
if (totalF === 0) console.log('✅ ALL SPRINT C1 TESTS PASS');
