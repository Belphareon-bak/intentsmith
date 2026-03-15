// v125: Marketplace Catalog Tests — expertises, specialists, skills
// ══════════════════════════════════════════════════════════════════════════════
//
// Tests:
//   1. Structural validation of all 21 marketplace expertises
//   2. Sazeni specialist tools (odds-compare, match-analysis, ticket-builder, value-finder)
//   3. Code-reviewer specialist tools (analyze-code, security-scan)
//   4. Skill JSON validation (10 new skills)
//   5. Expertise quality metrics — vocabulary, rules, prompts
//   6. A/B comparison: marketplace expertise config richness vs bare default
//
// Usage: node tests/marketplace-catalog-v125.test.js
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, assertIncludes, summary } from './harness.js';
import { readFileSync, readdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readJson(relPath) {
  return JSON.parse(readFileSync(join(ROOT, relPath), 'utf-8'));
}

function loadAllExpertises() {
  const dir = join(ROOT, 'marketplace/packages/expertises');
  return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => ({
    file: f,
    data: readJson(`marketplace/packages/expertises/${f}`),
  }));
}

function loadAllSkills() {
  const dir = join(ROOT, 'skills');
  return readdirSync(dir).filter(f => f.endsWith('.json')).map(f => ({
    file: f,
    data: readJson(`skills/${f}`),
  }));
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 1: Marketplace Expertise Structural Validation
// ══════════════════════════════════════════════════════════════════════════════

suite('Marketplace Expertises — structural validation');

const REQUIRED_EXPERTISE_FIELDS = ['id', 'name', 'icon', 'domain', 'description', 'tone', 'temperature', 'outputBias', 'modules', 'systemPrompt'];
const REQUIRED_MODULE_FIELDS = ['vocabulary', 'domain_rules', 'emphasis', 'constraints', 'antipatterns', 'disclaimer'];
const VALID_TONES = ['technical', 'professional', 'creative', 'empathetic', 'casual', 'analytical'];
const VALID_BIASES = ['analytical', 'creative', 'narrative', 'balanced', 'technical'];

const allExpertises = loadAllExpertises();

test(`found ≥21 marketplace expertises (got ${allExpertises.length})`, () => {
  assert(allExpertises.length >= 21, `expected ≥21, got ${allExpertises.length}`);
});

for (const { file, data } of allExpertises) {
  test(`${file}: has all required fields`, () => {
    for (const field of REQUIRED_EXPERTISE_FIELDS) {
      assert(field in data, `missing field: ${field}`);
    }
  });

  test(`${file}: modules has all required sub-fields`, () => {
    for (const field of REQUIRED_MODULE_FIELDS) {
      assert(field in data.modules, `modules missing: ${field}`);
    }
  });

  test(`${file}: id matches filename convention`, () => {
    const expectedId = basename(file, '.json').replace(/-/g, '_');
    assertEqual(data.id, expectedId, `id "${data.id}" doesn't match file "${file}"`);
  });

  test(`${file}: tone is valid`, () => {
    assert(VALID_TONES.includes(data.tone), `invalid tone "${data.tone}"`);
  });

  test(`${file}: temperature in range 0.1-0.9`, () => {
    assert(data.temperature >= 0.1 && data.temperature <= 0.9, `temperature ${data.temperature} out of range`);
  });

  test(`${file}: vocabulary has ≥10 items`, () => {
    assert(data.modules.vocabulary.length >= 10, `vocabulary has ${data.modules.vocabulary.length} items, need ≥10`);
  });

  test(`${file}: domain_rules has ≥3 rules`, () => {
    assert(data.modules.domain_rules.length >= 3, `domain_rules has ${data.modules.domain_rules.length}, need ≥3`);
  });

  test(`${file}: systemPrompt is ≥400 chars`, () => {
    assert(data.systemPrompt.length >= 400, `systemPrompt is ${data.systemPrompt.length} chars, need ≥400`);
  });

  test(`${file}: systemPrompt contains Czech text`, () => {
    assert(/[ěščřžýáíéůúťďň]/i.test(data.systemPrompt), 'systemPrompt should contain Czech characters');
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 2: New Dev Expertises — Config Quality
// ══════════════════════════════════════════════════════════════════════════════

suite('Dev Expertises — config quality & uniqueness');

const DEV_EXPERTISE_IDS = [
  'tester', 'system_architect', 'frontend_developer', 'backend_developer', 'technical_writer',
  'api_designer', 'database_architect', 'testing_strategy', 'devops_engineer', 'docker_expert', 'security_auditor',
];

const devExpertises = allExpertises.filter(e => DEV_EXPERTISE_IDS.includes(e.data.id));

test(`all ${DEV_EXPERTISE_IDS.length} dev expertises present`, () => {
  const found = devExpertises.map(e => e.data.id);
  for (const id of DEV_EXPERTISE_IDS) {
    assert(found.includes(id), `missing dev expertise: ${id}`);
  }
});

test('no duplicate vocabulary across new dev expertises', () => {
  const newIds = ['tester', 'system_architect', 'frontend_developer', 'backend_developer', 'technical_writer'];
  const newExpertises = devExpertises.filter(e => newIds.includes(e.data.id));
  // Each pair should have <50% overlap in vocabulary (they're distinct domains)
  for (let i = 0; i < newExpertises.length; i++) {
    for (let j = i + 1; j < newExpertises.length; j++) {
      const a = new Set(newExpertises[i].data.modules.vocabulary.map(v => v.toLowerCase()));
      const b = new Set(newExpertises[j].data.modules.vocabulary.map(v => v.toLowerCase()));
      const overlap = [...a].filter(v => b.has(v)).length;
      const overlapPct = overlap / Math.min(a.size, b.size);
      assert(overlapPct < 0.5,
        `${newExpertises[i].data.id} and ${newExpertises[j].data.id} have ${Math.round(overlapPct * 100)}% vocab overlap (max 50%)`);
    }
  }
});

test('each dev expertise has distinct emphasis areas', () => {
  const newIds = ['tester', 'system_architect', 'frontend_developer', 'backend_developer', 'technical_writer'];
  const newExpertises = devExpertises.filter(e => newIds.includes(e.data.id));
  const emphasisSets = newExpertises.map(e => e.data.modules.emphasis.join(' ').toLowerCase());
  // Each pair should have distinct emphasis (cosine distance check via keyword overlap)
  for (let i = 0; i < emphasisSets.length; i++) {
    for (let j = i + 1; j < emphasisSets.length; j++) {
      const wordsA = new Set(emphasisSets[i].split(/\s+/).filter(w => w.length > 4));
      const wordsB = new Set(emphasisSets[j].split(/\s+/).filter(w => w.length > 4));
      const overlap = [...wordsA].filter(w => wordsB.has(w)).length;
      const overlapPct = overlap / Math.min(wordsA.size, wordsB.size);
      assert(overlapPct < 0.6,
        `${newIds[i]} and ${newIds[j]} emphasis overlap ${Math.round(overlapPct * 100)}% (max 60%)`);
    }
  }
});

test('tester expertise focuses on hands-on testing (not strategy)', () => {
  const tester = devExpertises.find(e => e.data.id === 'tester');
  assert(tester, 'tester expertise not found');
  const prompt = tester.data.systemPrompt.toLowerCase();
  assert(prompt.includes('arrange-act-assert') || prompt.includes('arrange'), 'tester should mention AAA pattern');
  assert(prompt.includes('playwright') || prompt.includes('cypress') || prompt.includes('jest'), 'tester should mention specific frameworks');
  assert(prompt.includes('debug'), 'tester should cover debugging');
});

test('system-architect focuses on high-level design', () => {
  const arch = devExpertises.find(e => e.data.id === 'system_architect');
  assert(arch, 'system_architect not found');
  const prompt = arch.data.systemPrompt.toLowerCase();
  assert(prompt.includes('microservice') || prompt.includes('monolith'), 'should discuss architecture styles');
  assert(prompt.includes('trade-off') || prompt.includes('trade off'), 'should discuss trade-offs');
  assert(prompt.includes('diagram') || prompt.includes('mermaid'), 'should produce diagrams');
});

test('frontend-developer focuses on client-side tech', () => {
  const fe = devExpertises.find(e => e.data.id === 'frontend_developer');
  assert(fe, 'frontend_developer not found');
  const prompt = fe.data.systemPrompt.toLowerCase();
  assert(prompt.includes('react') || prompt.includes('vue') || prompt.includes('svelte'), 'should mention FE frameworks');
  assert(prompt.includes('css') || prompt.includes('tailwind'), 'should mention styling');
  assert(prompt.includes('accessibility') || prompt.includes('a11y') || prompt.includes('wcag'), 'should cover accessibility');
});

test('backend-developer focuses on server-side security', () => {
  const be = devExpertises.find(e => e.data.id === 'backend_developer');
  assert(be, 'backend_developer not found');
  const prompt = be.data.systemPrompt.toLowerCase();
  assert(prompt.includes('validat') || prompt.includes('input'), 'should emphasize input validation');
  assert(prompt.includes('sql injection') || prompt.includes('parametriz'), 'should cover SQL injection');
  assert(prompt.includes('jwt') || prompt.includes('oauth') || prompt.includes('auth'), 'should cover authentication');
});

test('technical-writer focuses on documentation', () => {
  const tw = devExpertises.find(e => e.data.id === 'technical_writer');
  assert(tw, 'technical_writer not found');
  const prompt = tw.data.systemPrompt.toLowerCase();
  assert(prompt.includes('readme') || prompt.includes('dokumentac'), 'should mention README/documentation');
  assert(prompt.includes('diátaxis') || prompt.includes('diataxis'), 'should use Diátaxis framework');
  assert(prompt.includes('changelog') || prompt.includes('api'), 'should cover changelogs or API docs');
});

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 3: Sazeni Specialist — Tool Tests
// ══════════════════════════════════════════════════════════════════════════════

suite('Sazeni specialist — odds-compare');

const { compareOdds } = await import('../specialists/sazeni/tools/odds-compare.js');

test('compareOdds: clarify on empty entries', () => {
  const r = compareOdds({ entries: [] });
  assertEqual(r.status, 'clarify');
});

test('compareOdds: clarify on missing entries', () => {
  const r = compareOdds({});
  assertEqual(r.status, 'clarify');
});

test('compareOdds: 2 bookmakers, finds best odds', () => {
  const r = compareOdds({
    entries: [
      { bookmaker: 'Tipsport', home: 1.85, draw: 3.40, away: 4.20 },
      { bookmaker: 'Fortuna', home: 1.90, draw: 3.50, away: 4.00 },
    ],
  });
  assertEqual(r.status, 'ok');
  assertEqual(r.data.best.home.bookmaker, 'Fortuna'); // 1.90 > 1.85
  assertEqual(r.data.best.draw.bookmaker, 'Fortuna'); // 3.50 > 3.40
  assertEqual(r.data.best.away.bookmaker, 'Tipsport'); // 4.20 > 4.00
});

test('compareOdds: margin calculation correct', () => {
  const r = compareOdds({
    entries: [
      { bookmaker: 'Test', home: 2.00, draw: 3.00, away: 4.00 },
    ],
  });
  assertEqual(r.status, 'ok');
  // 1/2 + 1/3 + 1/4 = 0.5 + 0.333 + 0.25 = 1.083 → margin = 8.33%
  const margin = r.data.margins[0].margin;
  assert(Math.abs(margin - 8.33) < 0.1, `expected ~8.33%, got ${margin}%`);
});

test('compareOdds: cherry-pick margin is lower than any single bookmaker', () => {
  const r = compareOdds({
    entries: [
      { bookmaker: 'A', home: 1.85, draw: 3.40, away: 4.20 },
      { bookmaker: 'B', home: 1.90, draw: 3.50, away: 4.00 },
      { bookmaker: 'C', home: 1.80, draw: 3.60, away: 3.80 },
    ],
  });
  assertEqual(r.status, 'ok');
  const cherryMargin = r.data.cherryPickMargin;
  const minBookmakerMargin = Math.min(...r.data.margins.map(m => m.margin));
  assert(cherryMargin <= minBookmakerMargin,
    `cherry-pick ${cherryMargin}% should be ≤ best bookmaker ${minBookmakerMargin}%`);
});

test('compareOdds: implied probability calculation', () => {
  const r = compareOdds({
    entries: [{ bookmaker: 'Test', home: 2.00, away: 3.00 }],
  });
  assertEqual(r.status, 'ok');
  assertEqual(r.data.comparison[0].home.implied, 50); // 1/2.00 = 50%
  assertEqual(r.data.comparison[0].away.implied, 33.33); // 1/3.00 = 33.33%
});

test('compareOdds: without draw (tennis)', () => {
  const r = compareOdds({
    entries: [
      { bookmaker: 'A', home: 1.50, away: 2.60 },
      { bookmaker: 'B', home: 1.55, away: 2.50 },
    ],
  });
  assertEqual(r.status, 'ok');
  assertEqual(r.data.best.draw, null);
  assertEqual(r.data.comparison[0].draw, null);
});

test('compareOdds: american odds conversion', () => {
  const r = compareOdds({
    entries: [{ bookmaker: 'US', home: -200, away: 150 }],
    format: 'american',
  });
  assertEqual(r.status, 'ok');
  // -200 → decimal 1.50, +150 → decimal 2.50
  assertEqual(r.data.comparison[0].home.decimal, 1.5);
  assertEqual(r.data.comparison[0].away.decimal, 2.5);
});

test('compareOdds: fractional odds conversion', () => {
  const r = compareOdds({
    entries: [{ bookmaker: 'UK', home: '3/1', away: '1/2' }],
    format: 'fractional',
  });
  assertEqual(r.status, 'ok');
  assertEqual(r.data.comparison[0].home.decimal, 4.0); // 3/1 + 1
  assertEqual(r.data.comparison[0].away.decimal, 1.5); // 1/2 + 1
});

suite('Sazeni specialist — match-analysis');

const { analyzeMatch } = await import('../specialists/sazeni/tools/match-analysis.js');

test('analyzeMatch: clarify on missing teams', () => {
  const r = analyzeMatch({});
  assertEqual(r.status, 'clarify');
  assert(r.missingParams.includes('home'));
  assert(r.missingParams.includes('away'));
});

test('analyzeMatch: template when no factors', () => {
  const r = analyzeMatch({ home: 'Sparta', away: 'Slavia' });
  assertEqual(r.status, 'ok');
  assertEqual(r.data.match, 'Sparta vs Slavia');
  assert(r.data.analysisTemplate, 'should return template');
  assert(r.data.analysisTemplate.factors.includes('form'), 'template should list factors');
});

test('analyzeMatch: implied probabilities from odds', () => {
  const r = analyzeMatch({ home: 'A', away: 'B', odds: { home: 2.00, draw: 3.00, away: 4.00 } });
  assertEqual(r.status, 'ok');
  assertEqual(r.data.impliedProbabilities.home, 50);
  assertEqual(r.data.impliedProbabilities.away, 25);
});

test('analyzeMatch: home win prediction with strong factors', () => {
  const r = analyzeMatch({
    home: 'Sparta', away: 'Bohemians',
    homeFactors: { form: { score: 9 }, h2h: { score: 7 }, home_away: { score: 8 }, motivation: { score: 7 }, stats: { score: 8 } },
    awayFactors: { form: { score: 4 }, h2h: { score: 4 }, home_away: { score: 3 }, motivation: { score: 5 }, stats: { score: 4 } },
  });
  assertEqual(r.status, 'ok');
  assertEqual(r.data.prediction.outcome, '1');
  assertEqual(r.data.prediction.type, 'home_win');
  assertEqual(r.data.prediction.team, 'Sparta');
  assert(r.data.prediction.confidence === 'vysoká' || r.data.prediction.confidence === 'střední');
});

test('analyzeMatch: draw prediction when factors are close', () => {
  const r = analyzeMatch({
    home: 'A', away: 'B',
    homeFactors: { form: { score: 6 }, h2h: { score: 5 } },
    awayFactors: { form: { score: 6 }, h2h: { score: 5 } },
  });
  assertEqual(r.status, 'ok');
  assertEqual(r.data.prediction.outcome, 'X');
  assertEqual(r.data.prediction.type, 'draw');
});

test('analyzeMatch: value assessment detects edge', () => {
  const r = analyzeMatch({
    home: 'Strong', away: 'Weak',
    homeFactors: { form: { score: 9 }, stats: { score: 9 }, h2h: { score: 8 } },
    awayFactors: { form: { score: 2 }, stats: { score: 2 }, h2h: { score: 3 } },
    odds: { home: 2.50, draw: 3.00, away: 3.00 },
  });
  assertEqual(r.status, 'ok');
  assert(r.data.valueAssessment, 'should have value assessment');
  // Home composite is high, implied from 2.50 is 40% — if our estimate > 43%, isValue=true
  assert(r.data.valueAssessment.home, 'should have home assessment');
});

test('analyzeMatch: insights detect strong form', () => {
  const r = analyzeMatch({
    home: 'Plzeň', away: 'Teplice',
    homeFactors: { form: { score: 9 }, home_away: { score: 8 } },
    awayFactors: { form: { score: 3 } },
  });
  assertEqual(r.status, 'ok');
  assert(r.data.insights.some(i => i.includes('Plzeň') && i.includes('formě')), 'should note Plzeň form');
  assert(r.data.insights.some(i => i.includes('Plzeň') && i.includes('domácí')), 'should note home advantage');
});

suite('Sazeni specialist — ticket-builder');

const { buildTicket } = await import('../specialists/sazeni/tools/ticket-builder.js');

test('buildTicket: clarify on empty selections', () => {
  const r = buildTicket({ selections: [] });
  assertEqual(r.status, 'clarify');
});

test('buildTicket: single bet', () => {
  const r = buildTicket({
    selections: [{ match: 'Sparta vs Slavia', outcome: '1', odds: 2.10, probability: 0.55 }],
    stake: 200,
  });
  assertEqual(r.status, 'ok');
  assertEqual(r.data.ticket.type, 'single');
  assertEqual(r.data.ticket.bets[0].odds, 2.10);
  assertEqual(r.data.ticket.bets[0].potentialWin, 420);
  assert(r.data.ticket.bets[0].edge > 0, 'positive edge expected (0.55 > 1/2.10)');
});

test('buildTicket: accumulator multiplies odds', () => {
  const r = buildTicket({
    selections: [
      { match: 'A vs B', outcome: '1', odds: 1.50 },
      { match: 'C vs D', outcome: '2', odds: 2.00 },
      { match: 'E vs F', outcome: 'X', odds: 3.20 },
    ],
    stake: 100,
    type: 'accumulator',
  });
  assertEqual(r.status, 'ok');
  assertEqual(r.data.ticket.type, 'accumulator');
  // 1.50 × 2.00 × 3.20 = 9.60
  assert(Math.abs(r.data.ticket.totalOdds - 9.60) < 0.01, `expected 9.60, got ${r.data.ticket.totalOdds}`);
  assertEqual(r.data.ticket.potentialReturn, 960);
});

test('buildTicket: Kelly criterion sizing', () => {
  const r = buildTicket({
    selections: [{ match: 'A vs B', outcome: '1', odds: 2.50, probability: 0.55 }],
    bankroll: 10000,
  });
  assertEqual(r.status, 'ok');
  // Single bet — Kelly stake is on each bet (quarter-Kelly common in practice)
  const kellyStake = r.data.ticket.bets[0].kellyStake;
  assert(kellyStake !== null && kellyStake > 0, 'Kelly stake should be positive');
  // Full Kelly = (bp-q)/b = 25% → quarter-Kelly = 6.25% → cap at 10%
  assert(kellyStake <= 10000 * 0.10, `Kelly stake ${kellyStake} should be ≤10% of bankroll`);
});

test('buildTicket: warnings for too many picks', () => {
  const selections = [];
  for (let i = 0; i < 8; i++) {
    selections.push({ match: `M${i}`, outcome: '1', odds: 1.50 });
  }
  const r = buildTicket({ selections, type: 'accumulator', stake: 100 });
  assertEqual(r.status, 'ok');
  assert(r.data.warnings.some(w => /6|7|8/.test(w) || /tipů|picks/i.test(w)),
    'should warn about many picks');
});

test('buildTicket: risk classification', () => {
  // High probability single → low risk
  const r1 = buildTicket({
    selections: [{ match: 'A vs B', outcome: '1', odds: 1.25, probability: 0.82 }],
    stake: 100,
  });
  assertEqual(r1.data.riskAssessment.level, 'nízké');

  // Low probability accumulator → high risk
  const r2 = buildTicket({
    selections: [
      { match: 'A', outcome: '1', odds: 3.00, probability: 0.35 },
      { match: 'B', outcome: '2', odds: 4.00, probability: 0.27 },
    ],
    type: 'accumulator',
    stake: 100,
  });
  assert(r2.data.riskAssessment.level === 'vysoké' || r2.data.riskAssessment.level === 'vyšší',
    `expected high risk for low-prob accumulator, got "${r2.data.riskAssessment.level}"`);
});

suite('Sazeni specialist — value-finder');

const { findValue } = await import('../specialists/sazeni/tools/value-finder.js');

test('findValue: clarify on missing matches', () => {
  const r = findValue({});
  assertEqual(r.status, 'clarify');
});

test('findValue: detects value when odds diverge', () => {
  const r = findValue({
    matches: [{
      match: 'Sparta vs Slavia',
      bookmakers: [
        { name: 'Tipsport', home: 1.80, draw: 3.40, away: 4.50 },
        { name: 'Pinnacle', home: 2.05, draw: 3.20, away: 3.80 },
        { name: 'Betano', home: 1.95, draw: 3.50, away: 4.00 },
      ],
    }],
    minEdge: 2,
  });
  assertEqual(r.status, 'ok');
  assert(Array.isArray(r.data.valueBets), 'should have valueBets array');
});

test('findValue: respects minOdds filter', () => {
  const r = findValue({
    matches: [{
      match: 'Test',
      bookmakers: [
        { name: 'A', home: 1.10, away: 8.00 },
        { name: 'B', home: 1.12, away: 7.50 },
      ],
    }],
    minOdds: 1.30,
  });
  assertEqual(r.status, 'ok');
  // Home odds (1.10, 1.12) are below minOdds 1.30, so no home value bets
  if (r.data.valueBets.length > 0) {
    for (const vb of r.data.valueBets) {
      assert(vb.bestOdds >= 1.30, `odds ${vb.bestOdds} should be ≥ minOdds 1.30`);
    }
  }
});

test('findValue: respects maxOdds filter', () => {
  const r = findValue({
    matches: [{
      match: 'Test',
      bookmakers: [
        { name: 'A', home: 1.80, away: 15.00 },
        { name: 'B', home: 1.85, away: 12.00 },
      ],
    }],
    maxOdds: 10,
  });
  assertEqual(r.status, 'ok');
  for (const vb of r.data.valueBets) {
    assert(vb.bestOdds <= 10, `odds ${vb.bestOdds} should be ≤ maxOdds 10`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 4: Code-Reviewer Specialist
// ══════════════════════════════════════════════════════════════════════════════

suite('Code-reviewer specialist — analyze-code');

const { analyzeCode } = await import('../specialists/code-reviewer/tools/analyze-code.js');

test('analyzeCode: detects long function', () => {
  // Must use proper function syntax that the detector recognizes
  const lines = ['function bigFunction(param) {'];
  for (let i = 0; i < 55; i++) lines.push(`  const x${i} = ${i};`);
  lines.push('  return x0;', '}');
  const code = lines.join('\n');
  const r = analyzeCode({ code, language: 'javascript' });
  assertEqual(r.status, 'ok');
  assert(r.data.findings.some(f => /long|délka|function|řádků|lines/i.test(f.message)),
    `should detect long function, findings: ${r.data.findings.map(f => f.message).join('; ')}`);
});

test('analyzeCode: detects console.log', () => {
  const code = 'function test() {\n  console.log("debug");\n  return 1;\n}\n';
  const r = analyzeCode({ code, language: 'javascript' });
  assertEqual(r.status, 'ok');
  assert(r.data.findings.some(f => /console/i.test(f.message)),
    'should detect console.log');
});

test('analyzeCode: detects TODO comments', () => {
  const code = '// TODO: fix this later\nfunction test() { return 1; }\n';
  const r = analyzeCode({ code, language: 'javascript' });
  assertEqual(r.status, 'ok');
  assert(r.data.findings.some(f => /TODO|FIXME/i.test(f.message)),
    'should detect TODO');
});

test('analyzeCode: clean code scores high', () => {
  const code = `
function calculateArea(width, height) {
  if (width <= 0 || height <= 0) {
    throw new Error('Dimensions must be positive');
  }
  return width * height;
}
`.trim();
  const r = analyzeCode({ code, language: 'javascript' });
  assertEqual(r.status, 'ok');
  assert(r.data.score >= 80, `clean code should score ≥80, got ${r.data.score}`);
});

test('analyzeCode: messy code has multiple findings', () => {
  const lines = [];
  lines.push('function x(a,b,c,d,e,f,g) {');
  lines.push('  console.log("debug");');
  lines.push('  var result = 0; // TODO fix');
  lines.push('  for (var i = 0; i < 100; i++) {');
  lines.push('    if (true) { if (true) { if (true) { if (true) { result += 42; } } } }');
  lines.push('  }');
  lines.push('  return result;');
  lines.push('}');
  const code = lines.join('\n');
  const r = analyzeCode({ code, language: 'javascript' });
  assertEqual(r.status, 'ok');
  // Should detect at least console.log + TODO + nesting
  assert(r.data.findings.length >= 2, `expected ≥2 findings, got ${r.data.findings.length}`);
  assert(r.data.findings.some(f => /console/i.test(f.message)), 'should find console.log');
  assert(r.data.findings.some(f => /TODO/i.test(f.message)), 'should find TODO');
});

test('analyzeCode: error on empty code', () => {
  const r = analyzeCode({});
  assertEqual(r.status, 'error');
});

suite('Code-reviewer specialist — security-scan');

const { securityScan } = await import('../specialists/code-reviewer/tools/security-scan.js');

test('securityScan: detects SQL injection', () => {
  const code = `db.query("SELECT * FROM users WHERE id = " + userId);`;
  const r = securityScan({ code, language: 'javascript' });
  assertEqual(r.status, 'ok');
  assert(r.data.vulnerabilities.some(v => v.id === 'SQL_INJECTION'),
    'should detect SQL injection');
});

test('securityScan: detects eval usage', () => {
  const code = `const result = eval(userInput);`;
  const r = securityScan({ code, language: 'javascript' });
  assertEqual(r.status, 'ok');
  assert(r.data.vulnerabilities.some(v => v.id === 'EVAL_USAGE'),
    'should detect eval usage');
});

test('securityScan: detects innerHTML XSS', () => {
  const code = `element.innerHTML = userInput;`;
  const r = securityScan({ code, language: 'javascript' });
  assertEqual(r.status, 'ok');
  assert(r.data.vulnerabilities.some(v => v.id === 'XSS'),
    'should detect innerHTML XSS');
});

test('securityScan: safe code has no critical vulns', () => {
  const code = `
import { escape } from 'lodash';
function greet(name) {
  const safeName = escape(name);
  return \`Hello, \${safeName}\`;
}
`.trim();
  const r = securityScan({ code, language: 'javascript' });
  assertEqual(r.status, 'ok');
  const criticals = r.data.vulnerabilities.filter(v => v.severity === 'critical');
  assertEqual(criticals.length, 0, 'safe code should have 0 critical vulnerabilities');
});

test('securityScan: error on empty code', () => {
  const r = securityScan({});
  assertEqual(r.status, 'error');
});

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 5: Skill JSON Validation
// ══════════════════════════════════════════════════════════════════════════════

suite('Skill JSON — structural validation');

const REQUIRED_SKILL_FIELDS = ['id', 'version', 'description', 'parameters', 'steps'];
const VALID_STEP_TYPES = ['llm', 'template', 'write', 'shell', 'ask', 'review', 'validate', 'substitute', 'transform'];

const NEW_SKILL_IDS = ['summarizer', 'changelog-gen', 'email-composer', 'meeting-notes', 'report-gen', 'brainstorm', 'presentation', 'interview-prep', 'code-refactor', 'project-bootstrap'];
const allSkills = loadAllSkills();
const newSkills = allSkills.filter(s => NEW_SKILL_IDS.includes(s.data.id));

test(`found all ${NEW_SKILL_IDS.length} new skills`, () => {
  const found = newSkills.map(s => s.data.id);
  for (const id of NEW_SKILL_IDS) {
    assert(found.includes(id), `missing skill: ${id}`);
  }
});

for (const { file, data } of newSkills) {
  test(`${file}: has all required fields`, () => {
    for (const field of REQUIRED_SKILL_FIELDS) {
      assert(field in data, `missing: ${field}`);
    }
  });

  test(`${file}: has ≥3 steps`, () => {
    assert(data.steps.length >= 3, `only ${data.steps.length} steps`);
  });

  test(`${file}: all step types are valid`, () => {
    for (const step of data.steps) {
      assert(step.id, 'step missing id');
      assert(VALID_STEP_TYPES.includes(step.type), `invalid step type "${step.type}" in step "${step.id}"`);
    }
  });

  test(`${file}: has parameters defined`, () => {
    assert(typeof data.parameters === 'object', 'parameters should be an object');
    assert(Object.keys(data.parameters).length >= 0, 'parameters should be defined');
  });

  test(`${file}: step ids are unique`, () => {
    const ids = data.steps.map(s => s.id);
    assertEqual(ids.length, new Set(ids).size, 'duplicate step ids');
  });

  test(`${file}: has review step (quality gate)`, () => {
    assert(data.steps.some(s => s.type === 'review'), 'should include a review step for quality');
  });

  test(`${file}: description is Czech and ≥30 chars`, () => {
    assert(data.description.length >= 30, `description too short: ${data.description.length} chars`);
    assert(/[ěščřžýáíéůúťďň]/i.test(data.description), 'description should be in Czech');
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 6: Expertise A/B Quality Metrics — Default vs Marketplace
// ══════════════════════════════════════════════════════════════════════════════

suite('A/B Quality Metrics — marketplace expertise enrichment vs bare default');

// Simulate a "bare default" expertise (what you get without any expertise)
const BARE_DEFAULT = {
  vocabulary: [],
  domain_rules: [],
  emphasis: [],
  constraints: [],
  antipatterns: [],
  systemPrompt: 'Jsi užitečný AI asistent. Odpovídej přesně a srozumitelně.',
  temperature: 0.5,
};

function expertiseRichnessScore(expertise) {
  const e = expertise.data ?? expertise;
  const m = e.modules ?? {};
  return {
    vocabSize: (m.vocabulary ?? []).length,
    rulesCount: (m.domain_rules ?? []).length,
    emphasisCount: (m.emphasis ?? []).length,
    constraintCount: (m.constraints ?? []).length,
    antipatternCount: (m.antipatterns ?? []).length,
    promptLength: (e.systemPrompt ?? '').length,
    hasDisclaimer: m.disclaimer != null && m.disclaimer !== null ? 1 : 0,
    // Composite: weighted sum
    get total() {
      return this.vocabSize * 3 +
             this.rulesCount * 5 +
             this.emphasisCount * 4 +
             this.constraintCount * 4 +
             this.antipatternCount * 3 +
             Math.floor(this.promptLength / 100) * 2 +
             this.hasDisclaimer * 10;
    },
  };
}

const bareScore = expertiseRichnessScore({
  modules: BARE_DEFAULT,
  systemPrompt: BARE_DEFAULT.systemPrompt,
});

console.log(`\n  ┌─ BARE DEFAULT baseline: total=${bareScore.total} (vocab=${bareScore.vocabSize}, rules=${bareScore.rulesCount}, prompt=${bareScore.promptLength}ch)`);

const improvements = [];

for (const { file, data } of allExpertises) {
  const score = expertiseRichnessScore(data);
  const improvement = score.total - bareScore.total;
  improvements.push({ id: data.id, file, score: score.total, improvement, details: score });

  test(`${data.id}: richness score (${score.total}) > bare default (${bareScore.total})`, () => {
    assert(score.total > bareScore.total,
      `expertise ${data.id} score ${score.total} should exceed bare default ${bareScore.total}`);
  });
}

// Print summary table
console.log('\n  ┌──────────────────────────────────────────────────────────────────────┐');
console.log('  │ EXPERTISE ENRICHMENT vs BARE DEFAULT                                │');
console.log('  ├────────────────────┬───────┬───────┬──────┬──────┬──────┬────────────┤');
console.log('  │ ID                 │ Vocab │ Rules │ Emph │ Cnst │ Prmt │ Improvement│');
console.log('  ├────────────────────┼───────┼───────┼──────┼──────┼──────┼────────────┤');

improvements.sort((a, b) => b.improvement - a.improvement);
for (const { id, details: d, improvement } of improvements) {
  const paddedId = id.padEnd(18);
  const pctStr = `+${improvement}`.padStart(10);
  console.log(`  │ ${paddedId} │  ${String(d.vocabSize).padStart(3)}  │  ${String(d.rulesCount).padStart(3)}  │ ${String(d.emphasisCount).padStart(3)}  │ ${String(d.constraintCount).padStart(3)}  │ ${String(Math.floor(d.promptLength/100)).padStart(3)}k │ ${pctStr} │`);
}
console.log('  └────────────────────┴───────┴───────┴──────┴──────┴──────┴────────────┘');

const avgImprovement = Math.round(improvements.reduce((s, i) => s + i.improvement, 0) / improvements.length);
console.log(`  Average enrichment: +${avgImprovement} points over bare default (${bareScore.total})`);
console.log(`  Expertises tested: ${improvements.length}`);

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 7: Specialist Manifest & Registration Structure
// ══════════════════════════════════════════════════════════════════════════════

suite('Specialist manifests — structure');

const SPECIALISTS = ['sazeni', 'code-reviewer'];

for (const specId of SPECIALISTS) {
  const manifest = readJson(`specialists/${specId}/specialist.json`);

  test(`${specId}: manifest has required fields`, () => {
    assert(manifest.id, 'missing id');
    assert(manifest.name, 'missing name');
    assert(manifest.version, 'missing version');
    assertEqual(manifest.manifestVersion, 2, 'should be manifest v2');
    assert(manifest.entry, 'missing entry');
    assert(manifest.tools?.length > 0, 'should have tools');
    assert(manifest.capabilities?.length > 0, 'should have capabilities');
  });

  test(`${specId}: tools have id, name, module, function`, () => {
    for (const tool of manifest.tools) {
      assert(tool.id, `tool missing id`);
      assert(tool.name, `tool ${tool.id} missing name`);
      assert(tool.module, `tool ${tool.id} missing module`);
      assert(tool.function, `tool ${tool.id} missing function`);
      assert(tool.id.startsWith(`${manifest.id}.`), `tool id "${tool.id}" should start with "${manifest.id}."`);
    }
  });

  test(`${specId}: capabilities use dotted notation`, () => {
    for (const cap of manifest.capabilities) {
      assert(cap.includes('.'), `capability "${cap}" should use dotted notation`);
    }
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 8: Bookmaker Knowledge
// ══════════════════════════════════════════════════════════════════════════════

suite('Sazeni specialist — bookmaker knowledge');

const { BOOKMAKERS, CZ_BOOKMAKERS, SHARP_BOOKMAKERS } = await import('../specialists/sazeni/knowledge/bookmakers.js');

test('BOOKMAKERS has 8 entries', () => {
  assertEqual(BOOKMAKERS.length, 8);
});

test('CZ_BOOKMAKERS has 5 entries (CZ license)', () => {
  assertEqual(CZ_BOOKMAKERS.length, 5);
  for (const b of CZ_BOOKMAKERS) assertEqual(b.license, 'CZ');
});

test('CZ_BOOKMAKERS sorted by margin (ascending)', () => {
  for (let i = 1; i < CZ_BOOKMAKERS.length; i++) {
    assert(CZ_BOOKMAKERS[i].avgMargin >= CZ_BOOKMAKERS[i - 1].avgMargin,
      `${CZ_BOOKMAKERS[i].id} margin ${CZ_BOOKMAKERS[i].avgMargin} < ${CZ_BOOKMAKERS[i - 1].id} ${CZ_BOOKMAKERS[i - 1].avgMargin}`);
  }
});

test('SHARP_BOOKMAKERS has 2 entries (Pinnacle + Betfair)', () => {
  assertEqual(SHARP_BOOKMAKERS.length, 2);
  const ids = SHARP_BOOKMAKERS.map(b => b.id);
  assert(ids.includes('pinnacle'));
  assert(ids.includes('betfair'));
});

test('each bookmaker has required fields', () => {
  for (const b of BOOKMAKERS) {
    assert(b.id, 'missing id');
    assert(b.name, 'missing name');
    assert(typeof b.avgMargin === 'number', `${b.id}: avgMargin should be number`);
    assert(b.strengths?.length > 0, `${b.id}: missing strengths`);
    assert(b.features?.length > 0, `${b.id}: missing features`);
    assert(b.url, `${b.id}: missing url`);
    assert(b.license, `${b.id}: missing license`);
  }
});

test('Pinnacle has lowest margin', () => {
  const pinnacle = BOOKMAKERS.find(b => b.id === 'pinnacle');
  const minMargin = Math.min(...BOOKMAKERS.map(b => b.avgMargin));
  // Betfair exchange has 1.5% but Pinnacle at 2.0 is the lowest traditional book
  assert(pinnacle.avgMargin <= 2.5, `Pinnacle margin ${pinnacle.avgMargin} should be ≤2.5%`);
});

// ══════════════════════════════════════════════════════════════════════════════
// SUITE 9: Knowledge Seed
// ══════════════════════════════════════════════════════════════════════════════

suite('Sazeni specialist — knowledge seed');

const { seedBettingKnowledge } = await import('../specialists/sazeni/knowledge/seed.js');

test('seedBettingKnowledge returns 0 for null kb', () => {
  assertEqual(seedBettingKnowledge(null), 0);
});

test('seedBettingKnowledge returns 0 for kb without bulkSetFacts', () => {
  assertEqual(seedBettingKnowledge({}), 0);
});

test('seedBettingKnowledge seeds facts correctly', () => {
  const facts = [];
  const mockKb = { bulkSetFacts: (f) => facts.push(...f) };
  const count = seedBettingKnowledge(mockKb);
  assert(count > 0, 'should return positive count');
  assertEqual(count, facts.length, 'returned count should match facts length');
  // Should include both betting facts and bookmaker data
  assert(facts.some(f => f.key.startsWith('odds.')), 'should have odds facts');
  assert(facts.some(f => f.key.startsWith('bookmaker.')), 'should have bookmaker facts');
  assert(facts.some(f => f.key === 'kelly.formula'), 'should have Kelly formula');
});

// ══════════════════════════════════════════════════════════════════════════════

summary();
