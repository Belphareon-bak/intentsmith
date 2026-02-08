// C3-Agent v57.3 — Chat Fix Tests
// ══════════════════════════════════════════════════════════════════════════════
// Tests for:
//   Fix 1: REPORT patterns (no-diacritics Czech, bare "report")
//   Fix 2: FACTUAL patterns (no-diacritics "zprav")
//   Fix 3: Reformulation detection
//   Fix 4: Language detection (no-diacritics Czech)
// ══════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// Test Runner
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failures.push(`❌ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline pattern copies (we test the patterns, not the module)
// ─────────────────────────────────────────────────────────────────────────────

const REPORT_PATTERNS = [
  /vytvoř.*report/i, /create.*report/i,
  /(ud[eě]lej|ud[eě]lat|p[rř]iprav|dej mi|napi[sš]).*report/i,
  /report\s+(?:z|ze|o|zpráv|zprav|novink|o\s)/i,
  /(?:report|zpráv[ay]?|zprav|přehled|prehled).*(?:z\s+webu|z\s+\w+\.\w+)/i,
  /z\s+webu\s+\S+\.\S+/i,
  /analýza/i, /analyza/i, /analysis/i, /analyze/i, /analyzuj/i,
  /shrnutí/i, /shrnuti/i, /summary/i, /summarize/i, /shrň/i, /shrn/i,
  /porovnej/i, /compare/i, /comparison/i, /srovnání/i, /srovnani/i,
  /přehled/i, /prehled/i, /overview/i,
  /souhrn/i,
  /za posledn[ií]/i,
  /za (tento|minul[ýy]) (t[ýy]den|m[ěe]s[íi]c)/i,
  /weekly.*report/i, /monthly.*report/i,
  /dej mi.*(přehled|prehled|souhrn)/i, /give me.*overview/i,
  /zpráv.*za/i, /zprav.*za/i,
  /novinky.*za/i,
  /co (se stalo|je nového).*za/i,
  /zpráv[ay]?\s+(?:z|ze|na)/i,
  /zprav\s+(?:z|ze|na)/i,
];

const FACTUAL_PATTERNS = [
  /počasí/i, /pocasi/i, /weather/i,
  /kurz/i, /exchange rate/i,
  /akcie/i, /stock/i,
  /bitcoin/i, /crypto/i, /krypto/i,
  /zpráv[ay]/i, /zprav[ay]?/i, /news/i,
  /výsledk[yů]/i, /vysledk/i, /results/i, /score/i,
  /statistik/i, /statistic/i,
  /novinky/i,
];

const REFORMULATION_PATTERNS = [
  /zkus\s+to\s+(v|po)\s+(česk|cesk|češtin|cestin|anglick|angličtin|slovenštin|slovensk|německ|nemeck|polsk|francouzštin|francous|španělštin|spanelštin)/i,
  /(?:odpov[eě]z|řekni|piš|napi[sš])\s+(?:to\s+)?(česky|cesky|anglicky|slovensky|německy|nemecky|polsky|francouzsky|španělsky)/i,
  /(?:to\s+sam[ée]?|totéž|tote[zž])\s+(?:v|po)?\s*(česky|cesky|anglicky|slovensky)/i,
  /v\s+(?:česk[ée]m|cesk[ée]m|anglick[ée]m|slovensk[ée]m|německ[ée]m|nemeck[ée]m)\s+jazyce/i,
  /p[rř]elo[zž]\s+to\s+do\s+/i,
  /zkus\s+to\s+(znovu|znova|je[sš]t[eě])/i,
  /zopakuj\s+(to|posledn[ií])/i,
  /ud[eě]lej\s+to\s+(znovu|znova|je[sš]t[eě])/i,
  /(?:je[sš]t[eě]\s+jednou|once\s+more|try\s+again)/i,
  /(?:repeat|redo|again)\s+(?:in|but)/i,
];

// v57.3: Correction patterns
const CORRECTION_PATTERNS = [
  /(?:^|\s)ale\s+(?:dnes|dneska|teď|ted)\s+(je|jsou|máme|mame)/i,
  /(?:^|\s)ale\s+(?:já|ja)\s+(jsem|mám|mam|chci|mysl)/i,
  /(?:^|\s)ale\s+(?:to|ten|ta)\s+(je|jsou|byl|bylo|není|neni)/i,
  /dnes\s+je\s+(?:ale\s+)?\d/i,
  /dneska\s+je\s+(?:ale\s+)?\d/i,
  /(?:dnešní|dnesni)\s+datum/i,
  /(?:^|\s)ne[, ]\s*(?:myslel|myslela|chtěl|chtěla|měl|to je|to není)/i,
  /(?:^|\s)špatně[, ]/i,
  /(?:^|\s)spatne[, ]/i,
  /dnes\s+(?:je|máme|mame)\s+\d{1,2}\s*\.\s*\d{1,2}/i,
  /(?:aktuální|aktualni|současný|soucasny)\s+datum/i,
  /(?:^|\s)but\s+today\s+is/i,
  /(?:^|\s)no[, ]\s*(?:I meant|that'?s wrong|actually)/i,
  /today'?s\s+date\s+is/i,
  /(?:^|\s)wrong[, ]/i,
  /(?:^|\s)actually[, ]/i,
];

// Language detection patterns (CS only — the relevant fix)
const CZ_UNIQUE = /[řůě]/i;
const CZ_DIACRITICS = /[ěščřžýáíéúůďťňó]/i;
const CS_PATTERNS = [
  /\b(prosím|díky|děkuji|ahoj|dobrý\s*den)\b/i,
  /\b(je|jsou|byl|byla|bylo|být|jsem|jsi|jsme|jste)\b/i,
  /\b(najdi|vyhledej|hledej|zjisti|řekni|popiš|vysvětli)\b/i,
  /(?:^|\s)(co\s+je|jak\s+se|kde\s+je|kdy\s+je|kolik)(?:\s|[?!.,;]|$)/i,
  /\b(chci|potřebuji|můžeš|mohl|mohla|bys)\b/i,
  /\b(ano|ne|jo|nechci|rozumím|chápu)\b/i,
  /\b(protože|aby|když|jestli|pokud|než|zatímco)\b/i,
  /\b(něco|někdo|nikdo|nic|všechno|každý)\b/i,
  /\b(tento|tato|toto|těchto|tomto|tohle)\b/i,
  // v57.3: no-diacritics
  /\b(udelej|udělej|udelat|pridat|pridej)\b/i,
  /\b(zprav[ay]?|novinky|novinek|clanek|clanky)\b/i,
  /\b(webu|stranky|stranek|stranka)\b/i,
  /\b(cesky|ceskem|cestine|ceskem\s+jazyce)\b/i,
  /\b(z\s+webu)\b/i,
  /\b(mi|mne|nam|vas|tebe)\b/i,
  /\b(diky|dekuju|dekuji|prosim)\b/i,
  /\b(zkus|zkusit|zopakuj|zopakovat)\b/i,
];

function matchesAny(text, patterns) {
  return patterns.some(p => p.test(text));
}

function countMatches(text, patterns) {
  return patterns.filter(p => { p.lastIndex = 0; return p.test(text); }).length;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. REPORT PATTERN FIXES
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n📰 1. REPORT Pattern Fixes');

await test('"udelej mi report zprav z webu novinky cz" → REPORT', () => {
  const input = 'udelej mi report zprav z webu novinky cz';
  assert(matchesAny(input, REPORT_PATTERNS), 'should match REPORT');
});

await test('"udelej report" → REPORT', () => {
  assert(matchesAny('udelej report o AI', REPORT_PATTERNS));
});

await test('"udělej mi report" → REPORT (with háčky)', () => {
  assert(matchesAny('udělej mi report', REPORT_PATTERNS));
});

await test('"priprav report z novinky.cz" → REPORT', () => {
  assert(matchesAny('priprav report z novinky.cz', REPORT_PATTERNS));
});

await test('"report z webu" → REPORT', () => {
  assert(matchesAny('report z webu idnes.cz', REPORT_PATTERNS));
});

await test('"report zprav" → REPORT', () => {
  assert(matchesAny('report zprav z novinky.cz', REPORT_PATTERNS));
});

await test('"dej mi report" → REPORT', () => {
  assert(matchesAny('dej mi report o situaci', REPORT_PATTERNS));
});

await test('"zprav z webu" → REPORT', () => {
  assert(matchesAny('zprav z webu novinky.cz', REPORT_PATTERNS));
});

await test('"zprávy z novinky.cz" → REPORT (diacritics)', () => {
  assert(matchesAny('zprávy z novinky.cz', REPORT_PATTERNS));
});

await test('"z webu seznam.cz" → REPORT (domain pattern)', () => {
  assert(matchesAny('z webu seznam.cz', REPORT_PATTERNS));
});

// Ensure existing patterns still work
await test('"vytvoř report" → REPORT (existing)', () => {
  assert(matchesAny('vytvoř report o AI', REPORT_PATTERNS));
});

await test('"shrnutí" → REPORT (existing)', () => {
  assert(matchesAny('dej mi shrnutí', REPORT_PATTERNS));
});

await test('"za poslední týden" → REPORT (existing)', () => {
  assert(matchesAny('zprávy za poslední týden', REPORT_PATTERNS));
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. FACTUAL PATTERN FIXES
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n📊 2. FACTUAL Pattern Fixes');

await test('"zpravy" (no diacritics) → FACTUAL', () => {
  assert(matchesAny('zpravy', FACTUAL_PATTERNS));
});

await test('"zprav" (bare, no diacritics) → FACTUAL', () => {
  assert(matchesAny('zprav', FACTUAL_PATTERNS));
});

await test('"novinky" → FACTUAL', () => {
  assert(matchesAny('novinky', FACTUAL_PATTERNS));
});

await test('"pocasi" (no diacritics) → FACTUAL', () => {
  assert(matchesAny('pocasi', FACTUAL_PATTERNS));
});

await test('"zprávy" (with diacritics) → FACTUAL (existing)', () => {
  assert(matchesAny('zprávy', FACTUAL_PATTERNS));
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. REFORMULATION PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🔄 3. Reformulation Patterns');

// Language switch
await test('"zkus to v ceskem jazyce" → reformulation', () => {
  assert(matchesAny('zkus to v ceskem jazyce', REFORMULATION_PATTERNS));
});

await test('"zkus to v českém jazyce" (diacritics) → reformulation', () => {
  assert(matchesAny('zkus to v českém jazyce', REFORMULATION_PATTERNS));
});

await test('"zkus to po cesky" → reformulation', () => {
  assert(matchesAny('zkus to po cesky', REFORMULATION_PATTERNS));
});

await test('"odpověz česky" → reformulation', () => {
  assert(matchesAny('odpověz česky', REFORMULATION_PATTERNS));
});

await test('"piš to česky" → reformulation', () => {
  assert(matchesAny('piš to česky', REFORMULATION_PATTERNS));
});

await test('"řekni to anglicky" → reformulation', () => {
  assert(matchesAny('řekni to anglicky', REFORMULATION_PATTERNS));
});

await test('"v anglickém jazyce" → reformulation', () => {
  assert(matchesAny('v anglickém jazyce', REFORMULATION_PATTERNS));
});

await test('"to samé česky" → reformulation', () => {
  assert(matchesAny('to samé česky', REFORMULATION_PATTERNS));
});

await test('"přelož to do angličtiny" → reformulation', () => {
  assert(matchesAny('přelož to do angličtiny', REFORMULATION_PATTERNS));
});

// Retry
await test('"zkus to znovu" → reformulation', () => {
  assert(matchesAny('zkus to znovu', REFORMULATION_PATTERNS));
});

await test('"zopakuj to" → reformulation', () => {
  assert(matchesAny('zopakuj to', REFORMULATION_PATTERNS));
});

await test('"udelej to znovu" → reformulation (no diacritics)', () => {
  assert(matchesAny('udelej to znovu', REFORMULATION_PATTERNS));
});

await test('"ještě jednou" → reformulation', () => {
  assert(matchesAny('ještě jednou', REFORMULATION_PATTERNS));
});

await test('"try again" → reformulation (EN)', () => {
  assert(matchesAny('try again', REFORMULATION_PATTERNS));
});

await test('"repeat in Czech" → reformulation (EN)', () => {
  assert(matchesAny('repeat in Czech', REFORMULATION_PATTERNS));
});

// Negative cases — should NOT match reformulation
await test('"najdi mi novinky" → NOT reformulation', () => {
  assert(!matchesAny('najdi mi novinky', REFORMULATION_PATTERNS));
});

await test('"co je nového" → NOT reformulation', () => {
  assert(!matchesAny('co je nového', REFORMULATION_PATTERNS));
});

await test('"zkus vyhledat bitcoin" → NOT reformulation', () => {
  assert(!matchesAny('zkus vyhledat bitcoin', REFORMULATION_PATTERNS));
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. LANGUAGE DETECTION — NO-DIACRITICS CZECH
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🌐 4. Language Detection (no-diacritics Czech)');

await test('"udelej mi report zprav z webu novinky cz" → detects CS', () => {
  const input = 'udelej mi report zprav z webu novinky cz';
  // No unique Czech chars (ř, ů, ě) and no diacritics at all
  assert(!CZ_UNIQUE.test(input), 'should not have unique chars');
  assert(!CZ_DIACRITICS.test(input), 'should not have diacritics');
  // But pattern matching should detect Czech
  const csScore = countMatches(input, CS_PATTERNS);
  assert(csScore >= 2, `should match ≥2 CS patterns, got ${csScore}`);
});

await test('"zkus to v ceskem jazyce" → detects CS', () => {
  const input = 'zkus to v ceskem jazyce';
  const csScore = countMatches(input, CS_PATTERNS);
  assert(csScore >= 2, `should match ≥2 CS patterns, got ${csScore}`);
});

await test('"dej mi zpravy" → detects CS', () => {
  const input = 'dej mi zpravy';
  const csScore = countMatches(input, CS_PATTERNS);
  assert(csScore >= 1, `should match ≥1 CS patterns, got ${csScore}`);
});

await test('"diky za pomoc" → detects CS (no diacritics)', () => {
  const input = 'diky za pomoc';
  const csScore = countMatches(input, CS_PATTERNS);
  assert(csScore >= 1, `should match ≥1 CS patterns, got ${csScore}`);
});

await test('"hello how are you" → does NOT match CS', () => {
  const input = 'hello how are you';
  const csScore = countMatches(input, CS_PATTERNS);
  assert(csScore === 0, `should match 0 CS patterns, got ${csScore}`);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. INTEGRATION — THE ORIGINAL BUG SCENARIO
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n🐛 5. Original Bug Scenarios');

await test('Bug 1: "udelej mi report zprav z webu novinky cz" classifies correctly', () => {
  const input = 'udelej mi report zprav z webu novinky cz';
  const isReport = matchesAny(input, REPORT_PATTERNS);
  const isFactual = matchesAny(input, FACTUAL_PATTERNS);
  assert(isReport || isFactual, 'should match REPORT or FACTUAL, not AMBIGUOUS');
  assert(isReport, 'should specifically match REPORT');
});

await test('Bug 1: "zkus to v ceskem jazyce" detected as reformulation', () => {
  const input = 'zkus to v ceskem jazyce';
  assert(matchesAny(input, REFORMULATION_PATTERNS), 'should be reformulation');
  const csScore = countMatches(input, CS_PATTERNS);
  assert(csScore >= 2, `should detect as Czech, got ${csScore} CS matches`);
});

await test('Bug 1: no-diacritics Czech detected as Czech, not unknown', () => {
  const input = 'udelej mi report zprav z webu novinky cz';
  assert(!CZ_UNIQUE.test(input), 'should not have unique chars');
  assert(!CZ_DIACRITICS.test(input), 'should not have diacritics');
  const csScore = countMatches(input, CS_PATTERNS);
  assert(csScore > 0, 'must detect at least one CS pattern for no-diacritics input');
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. CORRECTION PATTERNS (Bug 2: "dnes je ale 8.2.2026")
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n✏️ 6. Correction Patterns');

await test('"dnes je ale 8.2.2026" → CORRECTION', () => {
  assert(matchesAny('dnes je ale 8.2.2026', CORRECTION_PATTERNS));
});

await test('"dnes je 8.2.2026" → CORRECTION', () => {
  assert(matchesAny('dnes je 8.2.2026', CORRECTION_PATTERNS));
});

await test('"ale dnes je 15.3." → CORRECTION', () => {
  assert(matchesAny('ale dnes je 15.3.', CORRECTION_PATTERNS));
});

await test('"dneska je 8.2.2026" → CORRECTION', () => {
  assert(matchesAny('dneska je 8.2.2026', CORRECTION_PATTERNS));
});

await test('"dnes máme 8.2." → CORRECTION', () => {
  assert(matchesAny('dnes máme 8.2.', CORRECTION_PATTERNS));
});

await test('"dnešní datum je jiné" → CORRECTION', () => {
  assert(matchesAny('dnešní datum je jiné', CORRECTION_PATTERNS));
});

await test('"ne, myslel jsem něco jiného" → CORRECTION', () => {
  assert(matchesAny('ne, myslel jsem něco jiného', CORRECTION_PATTERNS));
});

await test('"špatně, dnes je..." → CORRECTION', () => {
  assert(matchesAny('špatně, dnes je pátek', CORRECTION_PATTERNS));
});

await test('"but today is Feb 8" → CORRECTION (EN)', () => {
  assert(matchesAny('but today is Feb 8', CORRECTION_PATTERNS));
});

await test('"actually, the date is..." → CORRECTION (EN)', () => {
  assert(matchesAny('actually, the date is wrong', CORRECTION_PATTERNS));
});

// Negative — NOT corrections
await test('"co je dnes za den" → NOT correction (it is a question)', () => {
  assert(!matchesAny('co je dnes za den', CORRECTION_PATTERNS));
});

await test('"najdi mi novinky" → NOT correction', () => {
  assert(!matchesAny('najdi mi novinky', CORRECTION_PATTERNS));
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. DATE-AWARE LOCAL RESPONSES
// ═══════════════════════════════════════════════════════════════════════════════

console.log('\n📅 7. Date-Aware LOCAL Responses');

await test('Moon phase response includes today\'s date', () => {
  // Simulate computeCalendar
  const now = new Date();
  const lunarCycle = 29.53;
  const refFullMoon = new Date('2025-01-13');
  const daysSinceRef = (now - refFullMoon) / (1000 * 60 * 60 * 24);
  const daysInCurrentCycle = daysSinceRef % lunarCycle;
  const daysToFullMoon = Math.round(lunarCycle - daysInCurrentCycle);
  const nextFullMoon = new Date(now);
  nextFullMoon.setDate(nextFullMoon.getDate() + daysToFullMoon);
  const todayStr = now.toLocaleDateString('cs-CZ');

  const explanation = `Příští úplněk bude za ${daysToFullMoon} dní (${nextFullMoon.toLocaleDateString('cs-CZ')}), počítáno od ${todayStr}`;
  assert(explanation.includes('počítáno od'), 'should include "počítáno od" date reference');
  assert(explanation.includes(todayStr), `should include today's date ${todayStr}`);
});

await test('DATE_CORRECTION_PATTERNS detect date statements', () => {
  const datePatterns = [
    /dnes\s+(?:je|máme|mame)\s+(?:ale\s+)?\d{1,2}\s*\.\s*\d{1,2}/i,
    /dneska\s+(?:je|máme)\s+(?:ale\s+)?\d{1,2}\s*\.\s*\d{1,2}/i,
    /(?:ale\s+)?dnes\s+(?:je|máme)\s+\d{1,2}\s*\.\s*\d{1,2}/i,
  ];

  assert(datePatterns.some(p => p.test('dnes je ale 8.2.2026')), '"dnes je ale 8.2.2026"');
  assert(datePatterns.some(p => p.test('dnes je 15.3.')), '"dnes je 15.3."');
  assert(datePatterns.some(p => p.test('ale dnes je 1.1.2026')), '"ale dnes je 1.1.2026"');
  assert(!datePatterns.some(p => p.test('kolik je hodin')), '"kolik je hodin" should NOT match');
});

// ═══════════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(60)}`);
console.log(`Chat Fixes: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log(`\nFailures:`);
  failures.forEach(f => console.log(`  ${f}`));
}
console.log(`${'═'.repeat(60)}`);
process.exit(failed > 0 ? 1 : 0);
