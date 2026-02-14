// ═══════════════════════════════════════════════════════════════════════════════
// QualityGate v2 — Idempotence Tests
// ═══════════════════════════════════════════════════════════════════════════════
//
// Verifies: runQualityPipeline(runQualityPipeline(x)) === runQualityPipeline(x)
//
// If this fails → hidden drift in the pipeline.
// Every fix layer MUST be idempotent: applying it twice = applying it once.
//
// ═══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import { runQualityGateV2 } from '../src/chat/quality/quality-gate-v2.js';
import { runQualityPipeline } from '../src/chat/quality/quality-pipeline.js';

// ─── Test vectors ─────────────────────────────────────────────────────────────

const TEST_VECTORS = [
  {
    name: 'Clean Czech text (no fixes needed)',
    input: 'Aktuální kurz eura vůči koruně je přibližně 25,20 Kč. Tento údaj se průběžně mění podle devizového trhu.',
    context: { lang: 'cs', intent: 'FACTUAL' },
  },
  {
    name: 'Slovak contamination (SK→CZ replacement)',
    input: 'Tieto výsledky sú veľmi zaujímavé, pretože ukazujú ktorý model je lepší. Ešte treba zvážiť niekoľko faktorov.',
    context: { lang: 'cs', intent: 'SEARCH' },
  },
  {
    name: 'JSON leak (structural fix)',
    input: '{"content":"Kurz eura je 25.20 Kč podle České národní banky."}',
    context: { lang: 'cs', intent: 'FACTUAL' },
  },
  {
    name: 'CJK contamination',
    input: 'Hlavní zprávy z České republiky 中文测试 zahrnují aktuální události v politice a ekonomice.',
    context: { lang: 'cs', intent: 'SEARCH' },
  },
  {
    name: 'Excessive whitespace',
    input: 'První odstavec.\n\n\n\n\nDruhý odstavec.\n\n\n\nTřetí odstavec.',
    context: { lang: 'cs', intent: 'CONVERSATIONAL' },
  },
  {
    name: 'SEARCH with links (no LinkGuard needed)',
    input: 'Hlavní zprávy: Česko se připravuje na volby.\n\n**Zdroje:**\n[1] [iDNES](https://idnes.cz/zpravy)\n[2] [Aktuálně](https://aktualne.cz/zpravy)',
    context: { lang: 'cs', intent: 'SEARCH', searchSubType: 'NEWS' },
  },
  {
    name: 'SEARCH without links + sourceUrls (LinkGuard fires)',
    input: 'Hlavní zprávy z České republiky zahrnují politické debaty a ekonomické trendy v regionu.',
    context: {
      lang: 'cs',
      intent: 'SEARCH',
      searchSubType: 'NEWS',
      sourceUrls: [
        { title: 'iDNES', url: 'https://idnes.cz/zpravy' },
        { title: 'Aktuálně', url: 'https://aktualne.cz/zpravy' },
      ],
    },
  },
  {
    name: 'Mixed: SK + whitespace + missing links',
    input: 'Výsledky sú veľmi zaujímavé.\n\n\n\n\nPretože model dokáže spracovať rôzne typy dotazov, ktoré užívatelia zadávajú.',
    context: {
      lang: 'cs',
      intent: 'SEARCH',
      sourceUrls: [
        { title: 'Test1', url: 'https://test1.cz' },
        { title: 'Test2', url: 'https://test2.cz' },
      ],
    },
  },
  {
    name: 'English text (no CZ fixes)',
    input: 'The current exchange rate is approximately 25.20 CZK per EUR according to the Czech National Bank.',
    context: { lang: 'en', intent: 'FACTUAL' },
  },
  {
    name: 'Empty string',
    input: '',
    context: { lang: 'cs' },
  },
  {
    name: 'Short conversational response',
    input: 'Ahoj! Rád ti pomůžu.',
    context: { lang: 'cs', intent: 'CONVERSATIONAL' },
  },
  {
    name: 'Technical text with English terms (no false positive)',
    input: 'React, Angular a Vue jsou populární JavaScript frameworky. Docker kontejnery běží na Linuxu s Kubernetes orchestrací.',
    context: { lang: 'cs', intent: 'SEARCH' },
  },
  {
    name: 'SK infinitive -ť → -t catch-all',
    input: 'Je potrebné zvážiť všetky možnosti a vybrať najlepšiu variantu. Treba povedať pravdu.',
    context: { lang: 'cs' },
  },
  {
    name: 'Sentence-start capitalization after SK fix',
    input: 'Základná doska je dôležitá. Ďalší komponenty sú tiež podstatné.',
    context: { lang: 'cs', intent: 'SEARCH' },
  },
];

// ─── Idempotence tests ────────────────────────────────────────────────────────

suite('QGv2 Idempotence — runQualityGateV2');

for (const vec of TEST_VECTORS) {
  test(`Idempotent: ${vec.name}`, () => {
    const pass1 = runQualityGateV2(vec.input, vec.context);
    const pass2 = runQualityGateV2(pass1.text, vec.context);

    assertEqual(
      pass2.text,
      pass1.text,
      `DRIFT DETECTED on "${vec.name}":\n` +
      `  Pass 1: "${pass1.text.substring(0, 100)}..."\n` +
      `  Pass 2: "${pass2.text.substring(0, 100)}..."`
    );
  });
}

suite('QGv2 Idempotence — runQualityPipeline');

for (const vec of TEST_VECTORS) {
  test(`Pipeline idempotent: ${vec.name}`, () => {
    const pass1 = runQualityPipeline(vec.input, vec.context);
    const pass2 = runQualityPipeline(pass1.text, vec.context);

    assertEqual(
      pass2.text,
      pass1.text,
      `PIPELINE DRIFT on "${vec.name}":\n` +
      `  Pass 1: "${pass1.text.substring(0, 100)}..."\n` +
      `  Pass 2: "${pass2.text.substring(0, 100)}..."`
    );
  });
}

// ─── Layer isolation tests ────────────────────────────────────────────────────

suite('QGv2 Layer Isolation');

test('Layer 1: JSON extract does not re-extract', () => {
  const json = '{"content":"Toto je odpověď."}';
  const pass1 = runQualityGateV2(json, { lang: 'cs' });
  assert(pass1.fixesApplied.includes('structural:json_extract'), 'Should extract JSON on pass 1');

  const pass2 = runQualityGateV2(pass1.text, { lang: 'cs' });
  assert(!pass2.fixesApplied.includes('structural:json_extract'), 'Should NOT extract JSON on pass 2');
});

test('Layer 2: SK→CZ does not match on already-Czech text', () => {
  const sk = 'Tieto výsledky sú veľmi zaujímavé.';
  const pass1 = runQualityGateV2(sk, { lang: 'cs' });
  assert(pass1.fixesApplied.some(f => f.startsWith('language:')), 'Should fix SK on pass 1');

  const pass2 = runQualityGateV2(pass1.text, { lang: 'cs' });
  assert(!pass2.fixesApplied.some(f => f.startsWith('language:')), 'Should NOT fix SK on pass 2 (already Czech)');
});

test('Layer 3: LinkGuard does not double-append', () => {
  // Text must be >100 chars to trigger LinkGuard
  const noLinks = 'Zprávy z České republiky zahrnují aktuální události v politice a ekonomice. Vláda představila nový návrh zákona o digitalizaci veřejné správy.';
  const ctx = {
    lang: 'cs',
    intent: 'SEARCH',
    sourceUrls: [
      { title: 'Test1', url: 'https://test1.cz' },
      { title: 'Test2', url: 'https://test2.cz' },
    ],
  };

  const pass1 = runQualityGateV2(noLinks, ctx);
  assert(pass1.fixesApplied.some(f => f.startsWith('intent:link_guard')), 'Should append links on pass 1');

  const pass2 = runQualityGateV2(pass1.text, ctx);
  assert(!pass2.fixesApplied.some(f => f.startsWith('intent:link_guard')), 'Should NOT append links on pass 2 (**Zdroje:** already exists)');
});

test('Layer 4: Content enforcement is detect-only (no text change)', () => {
  const zombie = 'Jako jazykový model nemohu odpovědět.';
  const pass1 = runQualityGateV2(zombie, { lang: 'cs' });
  assert(pass1.issuesDetected.some(i => i.type === 'zombie_detected'), 'Should detect zombie');
  assertEqual(pass1.text, zombie, 'Layer 4 should NOT modify text');
});

// ─── Fixes correctness ───────────────────────────────────────────────────────

suite('QGv2 Fix Correctness');

// Note: SK_THRESHOLD=2, so each test needs ≥2 SK markers to trigger replacement

test('SK "sú" → "jsou" (with second marker)', () => {
  const result = runQualityGateV2('Výsledky sú zajímavé, pretože sú důležité.', { lang: 'cs' });
  assert(!result.text.includes('sú'), `"sú" should be replaced, got: ${result.text}`);
  assert(result.text.includes('jsou'), `Should contain "jsou", got: ${result.text}`);
});

test('SK "ktorý" → "který" (with second marker)', () => {
  // Need ≥2 SK_MARKERS (detection), not just SK_TO_CZ_MAP entries
  const result = runQualityGateV2('Model, ktorý je veľmi dobrý pre gaming.', { lang: 'cs' });
  assert(!result.text.includes('ktorý'), `"ktorý" should be replaced, got: ${result.text}`);
  assert(result.text.includes('který'), `Should contain "který"`);
});

test('SK "pretože" → "protože" (with second marker)', () => {
  const result = runQualityGateV2('To je dobré, pretože to funguje. Sú tu ešte ďalšie výhody.', { lang: 'cs' });
  assert(!result.text.includes('pretože'), `"pretože" should be replaced, got: ${result.text}`);
  assert(result.text.includes('protože'), `Should contain "protože"`);
});

test('SK "ešte" → "ještě" (with second marker)', () => {
  const result = runQualityGateV2('Musíme ešte vyřešit tento problém, pretože je dôležitý.', { lang: 'cs' });
  assert(!result.text.includes('ešte'), `"ešte" should be replaced, got: ${result.text}`);
  assert(result.text.includes('ještě'), `Should contain "ještě"`);
});

test('SK ľ character stripped', () => {
  const result = runQualityGateV2('Dôležité informácie o veľkých projektoch.', { lang: 'cs' });
  assert(!result.text.includes('ľ'), `ľ should be stripped, got: ${result.text}`);
});

test('No false positive on Czech "Používejte"', () => {
  const cz = 'Používejte tento nástroj pro lepší výsledky.';
  const result = runQualityGateV2(cz, { lang: 'cs' });
  assertEqual(result.text, cz, 'Czech text should not be modified');
});

test('No false positive on English tech terms', () => {
  const tech = 'React a Angular jsou JavaScript frameworky běžící na Node.js.';
  const result = runQualityGateV2(tech, { lang: 'cs' });
  assertEqual(result.text, tech, 'Tech terms in Czech sentence should not trigger fixes');
});

// ─── Severity scoring ─────────────────────────────────────────────────────────

suite('QGv2 Severity Scoring');

test('Clean response → NONE', () => {
  const result = runQualityGateV2('Kurz eura je 25,20 Kč podle České národní banky.', { lang: 'cs', intent: 'FACTUAL' });
  assertEqual(result.severity, 'NONE', `Expected NONE, got ${result.severity}`);
});

test('Zombie response → HIGH', () => {
  const result = runQualityGateV2('Jako jazykový model nemohu pomoci.', { lang: 'cs' });
  assertEqual(result.severity, 'HIGH', `Expected HIGH, got ${result.severity}`);
});

test('Missing SEARCH links → MEDIUM', () => {
  // >100 chars to trigger SEARCH link check, no source URLs = search_no_sources
  const result = runQualityGateV2(
    'Zprávy z České republiky zahrnují aktuální události v politice a ekonomice. Vláda představila nový návrh zákona o digitalizaci.',
    { lang: 'cs', intent: 'SEARCH' },
  );
  assertEqual(result.severity, 'MEDIUM', `Expected MEDIUM, got ${result.severity}. Issues: ${JSON.stringify(result.issuesDetected)}`);
});

test('Short SEARCH response → MEDIUM', () => {
  const result = runQualityGateV2(
    'Zprávy z České republiky.',
    { lang: 'cs', intent: 'SEARCH' },
  );
  assertEqual(result.severity, 'MEDIUM', `Expected MEDIUM, got ${result.severity}. Issues: ${JSON.stringify(result.issuesDetected)}`);
});

// ─── Numeric score (0-100) — dual scoring ───────────────────────────────────

suite('QGv2 Numeric Score (score=output, scoreRaw=input)');

test('Clean response → score 0, scoreRaw 0', () => {
  const result = runQualityGateV2('Kurz eura je 25,20 Kč podle České národní banky.', { lang: 'cs', intent: 'FACTUAL' });
  assertEqual(result.score, 0, `Expected score 0, got ${result.score}`);
  assertEqual(result.scoreRaw, 0, `Expected scoreRaw 0, got ${result.scoreRaw}`);
});

test('Empty input → score 100, scoreRaw 100', () => {
  const result = runQualityGateV2(null, { lang: 'cs' });
  assertEqual(result.score, 100, `Expected score 100, got ${result.score}`);
  assertEqual(result.scoreRaw, 100, `Expected scoreRaw 100, got ${result.scoreRaw}`);
});

test('Zombie → score ≥ 40 (unfixable issue)', () => {
  const result = runQualityGateV2('Jako jazykový model nemohu pomoci.', { lang: 'cs' });
  assert(result.score >= 40, `Expected score ≥ 40, got ${result.score}`);
  // scoreRaw should equal score (zombie is an issue, not a fix)
  assertEqual(result.score, result.scoreRaw, 'Zombie: score and scoreRaw should match (no fixes applied)');
});

test('Missing SEARCH links → score ≥ 20 (unfixable issue)', () => {
  const result = runQualityGateV2(
    'Zprávy z České republiky zahrnují aktuální události v politice a ekonomice. Vláda představila nový návrh zákona o digitalizaci.',
    { lang: 'cs', intent: 'SEARCH' },
  );
  assert(result.score >= 20, `Expected score ≥ 20, got ${result.score}`);
});

test('SK contamination → score 0 (fixed!), scoreRaw > 0 (was dirty)', () => {
  const result = runQualityGateV2('Výsledky sú zajímavé, pretože sú důležité.', { lang: 'cs' });
  // score = issues only — SK was fixed, no remaining issues → 0
  assertEqual(result.score, 0, `Expected score 0 (SK was fixed), got ${result.score}`);
  // scoreRaw = issues + fix penalties — input was dirty → > 0
  assert(result.scoreRaw > 0, `Expected scoreRaw > 0 (input was dirty), got ${result.scoreRaw}`);
  assert(result.scoreRaw >= 3 && result.scoreRaw <= 15, `Expected scoreRaw 3-15, got ${result.scoreRaw}`);
});

test('Score is idempotent (pass1 === pass2)', () => {
  const input = 'Tieto výsledky sú veľmi zaujímavé, pretože ukazujú ktorý model je lepší.';
  const pass1 = runQualityGateV2(input, { lang: 'cs' });
  const pass2 = runQualityGateV2(pass1.text, { lang: 'cs' });
  // After fixing, pass2 should have score 0 and scoreRaw 0 (clean text)
  assertEqual(pass2.score, 0, `Pass2 score should be 0, got ${pass2.score}`);
  assertEqual(pass2.scoreRaw, 0, `Pass2 scoreRaw should be 0 (no fixes needed), got ${pass2.scoreRaw}`);
});

test('JSON leak → score 0 (fixed!), scoreRaw > 0 (structural fix applied)', () => {
  const result = runQualityGateV2('{"content":"Kurz eura je 25.20 Kč."}', { lang: 'cs', intent: 'FACTUAL' });
  assertEqual(result.score, 0, `Expected score 0 (JSON was fixed), got ${result.score}`);
  assert(result.scoreRaw >= 2, `Expected scoreRaw ≥ 2 (structural fix penalty), got ${result.scoreRaw}`);
});

test('scoreRaw ≥ score always (raw includes fix penalties)', () => {
  const vectors = [
    { input: 'Výsledky sú zajímavé, pretože sú důležité.', ctx: { lang: 'cs' } },
    { input: '{"content":"Test odpověď."}', ctx: { lang: 'cs' } },
    { input: 'Kurz eura je 25,20 Kč.', ctx: { lang: 'cs', intent: 'FACTUAL' } },
    { input: 'Jako jazykový model nemohu.', ctx: { lang: 'cs' } },
  ];
  for (const v of vectors) {
    const r = runQualityGateV2(v.input, v.ctx);
    assert(r.scoreRaw >= r.score, `scoreRaw (${r.scoreRaw}) should be ≥ score (${r.score}) for: "${v.input.substring(0, 40)}"`);
  }
});

// ─── languageDriftHigh flag ─────────────────────────────────────────────────

suite('QGv2 languageDriftHigh Flag');

test('Small SK fix → languageDriftHigh undefined (not set)', () => {
  // "sú" + "pretože" = 2 markers, ~10 chars changed
  const result = runQualityGateV2('Výsledky sú zajímavé, pretože sú důležité.', { lang: 'cs' });
  assert(!result.qualityFlags.languageDriftHigh, `Expected no languageDriftHigh for small fix, got ${result.qualityFlags.languageDriftHigh}`);
});

test('Heavy SK contamination → languageDriftHigh true', () => {
  // Many SK words = lots of chars changed
  const heavySK = 'Tieto výsledky sú veľmi zaujímavé, pretože ukazujú ktorý model je lepší. ' +
    'Ešte treba zvážiť niekoľko faktorov, ktoré ovplyvňujú výkon. ' +
    'Dôležité je povedať, že všetky komponenty sú navzájom prepojené. ' +
    'Základná doska a grafická karta sú kľúčové pre gaming.';
  const result = runQualityGateV2(heavySK, { lang: 'cs' });
  assert(result.qualityFlags.languageFixed, 'Should have languageFixed=true');
  assert(result.qualityFlags.languageDriftHigh === true, `Expected languageDriftHigh=true for heavy SK, got ${result.qualityFlags.languageDriftHigh}`);
});

test('No language fix → languageDriftHigh not set', () => {
  const clean = 'Kurz eura je 25,20 Kč podle České národní banky.';
  const result = runQualityGateV2(clean, { lang: 'cs', intent: 'FACTUAL' });
  assert(result.qualityFlags.languageDriftHigh === undefined, 'Clean text should not have languageDriftHigh');
});

test('English text → languageDriftHigh not set', () => {
  const result = runQualityGateV2(
    'The current exchange rate is 25.20 CZK per EUR.',
    { lang: 'en', intent: 'FACTUAL' },
  );
  assert(result.qualityFlags.languageDriftHigh === undefined, 'English text should not have languageDriftHigh');
});

// ─── Summary ──────────────────────────────────────────────────────────────────

const results = summary();
process.exit(results.failed > 0 ? 1 : 0);
