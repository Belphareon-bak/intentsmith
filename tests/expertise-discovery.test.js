// tests/expertise-discovery.test.js — D5 Expertise Discovery Unit Tests
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, assert, assertEqual, summary } from './harness.js';
import {
  discoverExpertises,
  extractGapTopic,
  _testInternals,
} from '../src/expertises/expertise-discovery.js';

const { LABEL_BOOST, MULTI_MATCH_RATIO, MAX_MULTI_MATCH } = _testInternals;

// ─── Test expertise fixtures ────────────────────────────────────────────────

// Simulates ExpertiseAgent objects with vocabulary
function makeExpertise(id, vocabulary, opts = {}) {
  return {
    id,
    name: opts.name || id,
    domain: opts.domain || 'test',
    modules: { vocabulary },
    label: opts.label || null,
    priority: opts.priority ?? 0,
  };
}

// DPH expertise — Czech VAT
const EXP_DPH = makeExpertise('dph', [
  'DPH', 'daň z přidané hodnoty', 'sazba DPH', 'kontrolní hlášení',
  'přiznání DPH', 'plátce DPH', 'reverse charge', 'osvobození',
]);

// Income tax expertise
const EXP_DAN = makeExpertise('dan-prijem', [
  'daň z příjmu', 'přiznání', 'sleva na dani', 'OSVČ', 'paušál',
  'daňový základ', 'odpočet', 'daňové zvýhodnění',
]);

// Mortgage expertise (for gap testing — specialist might not have this)
const EXP_HYPO = makeExpertise('hypoteky', [
  'hypotéka', 'úroková sazba', 'fixace', 'LTV', 'refinancování',
  'splátka', 'zástava', 'nemovitost',
]);

// Social security expertise
const EXP_SOC = makeExpertise('socialni', [
  'sociální pojištění', 'důchod', 'nemocenská', 'OSSZ', 'odvody',
]);

// Collection for accountant specialist
const ACCOUNTANT_COLLECTION = [EXP_DPH, EXP_DAN, EXP_HYPO, EXP_SOC];

// ═══════════════════════════════════════════════════════════════════════════
suite('discoverExpertises — basic matching');

test('single match: DPH query matches DPH expertise', () => {
  // Need 2+ vocab hits to reach threshold (2.0). "DPH" + "kontrolní hlášení" = 1 + 2 = 3
  const result = discoverExpertises('Jak podat kontrolní hlášení k DPH?', ACCOUNTANT_COLLECTION);
  assert(!result.gap, 'should not be gap');
  assertEqual(result.matched.length, 1, 'should have 1 match');
  assertEqual(result.matched[0].id, 'dph', 'should match DPH');
  assert(result.scores['dph'] >= 2, 'DPH score should be >= threshold');
});

test('single match: income tax query matches dan-prijem', () => {
  const result = discoverExpertises('Jak vyplnit přiznání OSVČ?', ACCOUNTANT_COLLECTION);
  assert(!result.gap, 'should not be gap');
  assert(result.matched.some(m => m.id === 'dan-prijem'), 'should include dan-prijem');
});

test('single match: mortgage query matches hypoteky', () => {
  const result = discoverExpertises('Jaká je úroková sazba hypotéky?', ACCOUNTANT_COLLECTION);
  assert(!result.gap, 'should not be gap');
  assert(result.matched.some(m => m.id === 'hypoteky'), 'should include hypoteky');
});

test('gap detection: unrelated query returns gap=true', () => {
  const result = discoverExpertises('Jak uvařit guláš?', ACCOUNTANT_COLLECTION);
  assert(result.gap, 'should be gap');
  assertEqual(result.matched.length, 0, 'should have no matches');
});

test('gap detection: empty input returns gap=true', () => {
  const result = discoverExpertises('', ACCOUNTANT_COLLECTION);
  assert(result.gap, 'should be gap');
});

test('gap detection: empty collection returns gap=true', () => {
  const result = discoverExpertises('DPH sazba', []);
  assert(result.gap, 'should be gap');
  assertEqual(result.reason, 'empty collection');
});

// ═══════════════════════════════════════════════════════════════════════════
suite('discoverExpertises — multi-match');

test('multi-match: query touching 2 expertises returns both', () => {
  // "přiznání" is in both DPH and dan-prijem vocabularies
  const result = discoverExpertises(
    'Jak vyplnit přiznání DPH a daňové zvýhodnění?',
    ACCOUNTANT_COLLECTION
  );
  assert(!result.gap, 'should not be gap');
  assert(result.matched.length >= 2, `should have 2+ matches, got ${result.matched.length}`);
  const ids = result.matched.map(m => m.id);
  assert(ids.includes('dph'), 'should include DPH');
  assert(ids.includes('dan-prijem'), 'should include dan-prijem');
});

test('multi-match: max 3 expertises returned', () => {
  // Query touching all 4 expertises
  const result = discoverExpertises(
    'DPH přiznání OSVČ hypotéka sociální pojištění',
    ACCOUNTANT_COLLECTION
  );
  assert(result.matched.length <= MAX_MULTI_MATCH, `should have max ${MAX_MULTI_MATCH} matches`);
});

test('multi-match disabled returns only best', () => {
  const result = discoverExpertises(
    'přiznání DPH a daňové zvýhodnění',
    ACCOUNTANT_COLLECTION,
    { allowMultiMatch: false }
  );
  assert(!result.gap, 'should not be gap');
  assertEqual(result.matched.length, 1, 'should have 1 match when multi disabled');
});

// ═══════════════════════════════════════════════════════════════════════════
suite('discoverExpertises — label boost');

test('label boost gives priority to labeled expertise', () => {
  const labeledDPH = makeExpertise('dph-labeled', ['DPH', 'daň z přidané hodnoty'], { label: 'DPH expert' });
  const unlabeledDPH = makeExpertise('dph-unlabeled', ['DPH', 'daň z přidané hodnoty']);

  const collection = [unlabeledDPH, labeledDPH];
  const result = discoverExpertises('Kolik je DPH?', collection);

  assert(!result.gap, 'should not be gap');
  assertEqual(result.matched[0].id, 'dph-labeled', 'labeled should win');
  assert(
    result.scores['dph-labeled'] > result.scores['dph-unlabeled'],
    'labeled score should be higher'
  );
  assert(
    result.scores['dph-labeled'] - result.scores['dph-unlabeled'] >= LABEL_BOOST - 0.01,
    `label boost should be at least ${LABEL_BOOST}`
  );
});

// ═══════════════════════════════════════════════════════════════════════════
suite('discoverExpertises — priority tie-breaking');

test('higher priority wins tie', () => {
  // Need enough unique vocab to reach threshold (2.0)
  // Use multi-word terms (weight=2) that are unique to each expertise
  const lowPri = makeExpertise('exp-low', ['daň z příjmu', 'kontrolní hlášení'], { priority: 0 });
  const highPri = makeExpertise('exp-high', ['daň z příjmu', 'kontrolní hlášení'], { priority: 5 });

  const result = discoverExpertises('Jak podat kontrolní hlášení k daň z příjmu?', [lowPri, highPri]);
  assert(!result.gap, `should not be gap, scores: ${JSON.stringify(result.scores)}`);
  assertEqual(result.matched[0].id, 'exp-high', 'higher priority should be first');
});

// ═══════════════════════════════════════════════════════════════════════════
suite('discoverExpertises — shared term penalty');

test('shared terms get penalty, unique terms decide winner', () => {
  // "přiznání" is in both vocabularies → shared → penalty
  // "DPH" is only in exp-a → unique → full weight
  const expA = makeExpertise('exp-a', ['přiznání', 'DPH']);
  const expB = makeExpertise('exp-b', ['přiznání', 'účetnictví']);

  const result = discoverExpertises('přiznání DPH', [expA, expB]);
  assert(result.scores['exp-a'] > result.scores['exp-b'], 'exp-a should score higher (unique DPH)');
});

// ═══════════════════════════════════════════════════════════════════════════
suite('discoverExpertises — single expertise collection');

test('single expertise: matches above threshold → returned', () => {
  const result = discoverExpertises('DPH kontrolní hlášení', [EXP_DPH]);
  assert(!result.gap, 'should not be gap');
  assertEqual(result.matched.length, 1);
  assertEqual(result.matched[0].id, 'dph');
});

test('single expertise: below threshold → gap', () => {
  const result = discoverExpertises('Jak uvařit guláš?', [EXP_DPH]);
  assert(result.gap, 'should be gap');
  assertEqual(result.matched.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
suite('discoverExpertises — scores object');

test('scores object has entry for every expertise in collection', () => {
  const result = discoverExpertises('DPH', ACCOUNTANT_COLLECTION);
  for (const exp of ACCOUNTANT_COLLECTION) {
    assert(exp.id in result.scores, `scores should contain ${exp.id}`);
    assert(typeof result.scores[exp.id] === 'number', `score for ${exp.id} should be number`);
  }
});

test('reason string is non-empty', () => {
  const result = discoverExpertises('DPH', ACCOUNTANT_COLLECTION);
  assert(result.reason.length > 0, 'reason should be non-empty');
});

// ═══════════════════════════════════════════════════════════════════════════
suite('extractGapTopic');

test('extracts content words, skips stop words', () => {
  const topic = extractGapTopic('Pomoz mi s hypotékou prosím');
  assert(!topic.includes('mi'), 'should not include "mi"');
  assert(!topic.includes('prosím'), 'should not include "prosím"');
  assert(topic.includes('hypotékou'), 'should include "hypotékou"');
});

test('limits to 4 words', () => {
  const topic = extractGapTopic('velká dlouhá složitá komplikovaná obtížná otázka');
  const words = topic.split(/\s+/);
  assert(words.length <= 4, `should have max 4 words, got ${words.length}`);
});

test('returns substring of input when no content words', () => {
  const topic = extractGapTopic('a v na');
  assert(topic.length > 0, 'should return something');
});

test('handles empty input', () => {
  const topic = extractGapTopic('');
  assert(typeof topic === 'string', 'should return string');
});

test('strips punctuation', () => {
  const topic = extractGapTopic('Co je hypotéka? Jaká je sazba!');
  assert(!topic.includes('?'), 'should not include ?');
  assert(!topic.includes('!'), 'should not include !');
});

// ═══════════════════════════════════════════════════════════════════════════
suite('discoverExpertises — Czech stemming');

test('stem matching: inflected Czech words match vocabulary', () => {
  // "přiznání" in vocab, user writes "přiznáním" (instrumental case)
  const exp = makeExpertise('test-stem', ['přiznání', 'daň']);
  const result = discoverExpertises('Co potřebuji k přiznáním daní?', [exp]);
  // Should match at least "daň" via stemming
  assert(result.scores['test-stem'] >= 1, `should score >= 1 from stem match, got ${result.scores['test-stem']}`);
});

test('multi-word terms require exact substring match', () => {
  const exp = makeExpertise('test-multi', ['daň z přidané hodnoty']);
  const result = discoverExpertises('daň z přidané hodnoty je 21%', [exp]);
  assert(result.scores['test-multi'] >= 2, 'multi-word exact match should score >= 2');
});

// ═══════════════════════════════════════════════════════════════════════════
const { passed, failed } = summary();
process.exit(failed > 0 ? 1 : 0);
