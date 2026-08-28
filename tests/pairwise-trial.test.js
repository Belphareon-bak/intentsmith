// tests/pairwise-trial.test.js — souboj kandidáta se stávajícím modelem
// ══════════════════════════════════════════════════════════════════════════════
// Bez sítě a bez modelů: runner je nahrazený atrapou vracející zadaná skóre.
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';

import {
  comparePair, decideRole, trialRole, createSuiteCache,
  TASK_MARGIN_EPSILON, DEFAULT_REPEATS,
} from '../src/upgrade/pairwise-trial.js';

const UNIT_TASKS = Object.freeze([
  Object.freeze({ name: 'unit_alpha' }),
  Object.freeze({ name: 'unit_beta' }),
  Object.freeze({ name: 'unit_gamma' }),
]);
const SUITES = Object.freeze({
  code: Object.freeze({ name: 'code', tests: UNIT_TASKS }),
  reasoning: Object.freeze({ name: 'reasoning', tests: UNIT_TASKS }),
});

/**
 * Runner, který pro každý model vrátí předepsaná skóre úloh.
 *
 * Hodnota může být číslo (stabilní) nebo pole (skóre pro jednotlivé běhy) —
 * tím se dá nasimulovat úloha, která mezi běhy přeskakuje.
 */
function fakeRunner(scoresByModel) {
  const runIndex = new Map();
  return {
    calls: [],
    async runSuite(suiteName, model, _onProgress, artifact) {
      this.calls.push({ suiteName, model, artifact: artifact || null });
      const key = `${suiteName}::${model}`;
      const n = runIndex.get(key) ?? 0;
      runIndex.set(key, n + 1);
      const per = scoresByModel[model] || {};
      const pick = (v) => (Array.isArray(v) ? v[Math.min(n, v.length - 1)] : v);
      const tests = SUITES[suiteName].tests.map(t => {
        const score = pick(per[t.name] ?? per._default ?? 1.0);
        return { name: t.name, score, passed: score >= 0.6 };
      });
      return {
        suite: suiteName, model, tests,
        score: tests.reduce((s, t) => s + t.score, 0) / tests.length,
      };
    },
  };
}

const ONCE = { repeats: 1 };
const artifactFor = model => Object.freeze({
  modelName: model,
  digestSha256: model === 'A' ? 'a'.repeat(64) : 'b'.repeat(64),
});
const CODE_PLAN = Object.freeze({
  role: 'CODE',
  suiteName: 'code',
  suite: SUITES.code,
  suiteVersion: 'unit-v1',
  suiteContractSha256: 'c'.repeat(64),
  repeats: 1,
  minimumDiscriminatingTasks: 0,
  minimumDiscriminatingByLanguage: Object.freeze({}),
});

const CODE_TASKS = SUITES.code.tests.map(t => t.name);

// ─── comparePair ────────────────────────────────────────────────────────────

suite('comparePair');

await testAsync('oba modely projdou tutéž sadu', async () => {
  const runner = fakeRunner({ A: { _default: 1 }, B: { _default: 1 } });
  await comparePair(runner, 'code', 'A', 'B', ONCE);
  assertEqual(runner.calls.length, 2);
  assert(runner.calls.every(c => c.suiteName === 'code'), 'stejná sada pro oba');
});

await testAsync('persistovaný běh předá runneru přesnou identitu artefaktu', async () => {
  const runner = fakeRunner({ A: { _default: 1 }, B: { _default: 1 } });
  const saved = [];
  await comparePair(runner, 'code', 'A', 'B', {
    ...ONCE,
    resolveArtifact: async model => artifactFor(model),
    saveHistoricalSummary: async input => { saved.push(input); },
  });
  assertEqual(runner.calls[0].artifact.digestSha256, 'a'.repeat(64));
  assertEqual(runner.calls[1].artifact.digestSha256, 'b'.repeat(64));
  assertEqual(saved[0].artifact.digestSha256, 'a'.repeat(64));
  assertEqual(saved[1].artifact.digestSha256, 'b'.repeat(64));
  for (const entry of saved) {
    const started = Date.parse(entry.summary.startedAt);
    const completed = Date.parse(entry.summary.completedAt);
    assert(Number.isFinite(started) && Number.isFinite(completed));
    assert(completed >= started, 'measurement completion must not precede its start');
    assertEqual(entry.summary.durationMs, completed - started);
  }
});

await testAsync('shodná skóre = žádná rozlišující úloha', async () => {
  // Přesně ta situace, kvůli které párové srovnání vzniklo: 26 z 65 běhů
  // skončilo na 100 %, takže absolutní skóre nerozliší nic.
  const runner = fakeRunner({ A: { _default: 1 }, B: { _default: 1 } });
  const r = await comparePair(runner, 'code', 'A', 'B', ONCE);
  assertEqual(r.discriminating, 0);
  assertEqual(r.inconclusive, true);
  assertEqual(r.margin, 0);
  assertEqual(r.candidateSuiteScore, 1, 'obě sady jsou na maximu');
});

await testAsync('rozdíl pod prahem se nepočítá za rozlišení', async () => {
  const runner = fakeRunner({
    A: { _default: 1 },
    B: { _default: 1 - (TASK_MARGIN_EPSILON / 2) },
  });
  const r = await comparePair(runner, 'code', 'A', 'B', ONCE);
  assertEqual(r.discriminating, 0, 'drobný rozdíl je šum, ne signál');
});

await testAsync('třídesetinné zaokrouhlení nepřekročí stejnou noise hranici', async () => {
  const task = CODE_TASKS[0];
  const historical = model => ({
    suite: 'code', model, runs: 3, score: model === 'A' ? 1 : 0.333,
    tasks: [{
      name: task,
      mean: model === 'A' ? 1 : 0.333,
      spread: model === 'A' ? 0 : (2 / 3),
      scores: [], responses: [], details: [], rubric: [], language: null,
    }],
    unstableTasks: model === 'A' ? [] : [task],
  });
  const r = await comparePair(fakeRunner({}), 'code', 'A', 'B', {
    ...ONCE,
    loadHistoricalSummary: ({ model }) => historical(model),
  });
  assertEqual(r.tasks[0].delta, 0.667);
  assertEqual(r.tasks[0].discriminating, false,
    'zaokrouhlovací artefakt nesmí být kvalitativní signál');
});

await testAsync('marže se počítá jen z rozlišujících úloh', async () => {
  const runner = fakeRunner({
    A: { _default: 1, [CODE_TASKS[0]]: 1.0 },
    B: { _default: 1, [CODE_TASKS[0]]: 0.5 },
  });
  const r = await comparePair(runner, 'code', 'A', 'B', ONCE);
  assertEqual(r.discriminating, 1);
  assertEqual(r.candidateWins, 1);
  assertEqual(r.incumbentWins, 0);
  // Marže je průměr přes rozlišující úlohy, ne přes všechny — jinak by se
  // jediný skutečný rozdíl utopil v shodných úlohách.
  assertEqual(r.margin, 0.5);
});

await testAsync('prohra kandidáta se pozná', async () => {
  const runner = fakeRunner({
    A: { _default: 1, [CODE_TASKS[0]]: 0.2 },
    B: { _default: 1, [CODE_TASKS[0]]: 1.0 },
  });
  const r = await comparePair(runner, 'code', 'A', 'B', ONCE);
  assertEqual(r.incumbentWins, 1);
  assert(r.margin < 0, 'marže musí být záporná');
});

await testAsync('neznámá sada vyhodí', async () => {
  let threw = false;
  try { await comparePair(fakeRunner({}), 'neexistuje', 'A', 'B', ONCE); } catch { threw = true; }
  assert(threw, 'neznámá sada nesmí projít tiše');
});

// ─── decideRole ─────────────────────────────────────────────────────────────

suite('decideRole');

test('kvalita nad prahem vyhrává', () => {
  const d = decideRole({ margin: 0.20, candidateWins: 4, incumbentWins: 1, discriminating: 5, inconclusive: false }, {}, 0.05);
  assertEqual(d.winner, 'candidate');
  assertEqual(d.basis, 'kvalita');
});

test('kvalita pod prahem nechává stávající', () => {
  const d = decideRole({ margin: 0.03, candidateWins: 3, incumbentWins: 1, discriminating: 4, inconclusive: false }, {}, 0.05);
  assertEqual(d.winner, 'incumbent');
  assert(/nedosáhl prahu/.test(d.detail));
});

test('víc výher nestačí, když je marže malá', () => {
  // Setrvačnost je záměrná: výměna má cenu jen tehdy, když je pro ni důvod.
  const d = decideRole({ margin: 0.01, candidateWins: 9, incumbentWins: 0, discriminating: 9, inconclusive: false }, {}, 0.05);
  assertEqual(d.winner, 'incumbent');
});

test('při remíze kvality nerozhodne ani výrazně vyšší rychlost', () => {
  const d = decideRole({ margin: 0, discriminating: 0, inconclusive: true }, { candidate: 140, incumbent: 70 }, 0.05);
  assertEqual(d.winner, 'incumbent');
  assertEqual(d.basis, 'nerozhodně');
  assertEqual(d.reasonCode, 'QUALITY_INCONCLUSIVE');
  assert(/není náhradní/.test(d.detail));
});

test('rozhodnutí vždy nese základ i vysvětlení', () => {
  for (const c of [
    { margin: 0.2, candidateWins: 3, incumbentWins: 0, discriminating: 3, inconclusive: false },
    { margin: -0.2, candidateWins: 0, incumbentWins: 3, discriminating: 3, inconclusive: false },
    { margin: 0, discriminating: 0, inconclusive: true },
  ]) {
    const d = decideRole(c, { candidate: 10, incumbent: 10 }, 0.05);
    assert(d.reasonCode && d.basis && d.detail, 'každé rozhodnutí musí být zdůvodněné');
  }
});

// ─── trialRole ──────────────────────────────────────────────────────────────

suite('trialRole');

await testAsync('role bez validační sady se přeskočí', async () => {
  const r = await trialRole(fakeRunner({}), 'NEEXISTUJICI_ROLE', 'A', 'B', ONCE);
  assertEqual(r.skipped, true);
});

await testAsync('vrátí porovnání i rozhodnutí', async () => {
  const runner = fakeRunner({
    A: { _default: 1 },
    B: { _default: 1, [CODE_TASKS[0]]: 0.2 },
  });
  const r = await trialRole(runner, 'CODE', 'A', 'B', {
    evaluationPlan: CODE_PLAN, threshold: 0.05, ...ONCE,
  });
  assertEqual(r.skipped, false);
  assertEqual(r.suite, 'code');
  assert(r.comparison && r.decision, 'musí nést obojí');
  assertEqual(r.decision.winner, 'candidate');
});

await testAsync('mezi modely se dá vložit úklid paměti', async () => {
  let drained = 0;
  const runner = fakeRunner({ A: { _default: 1 }, B: { _default: 1 } });
  await trialRole(runner, 'CODE', 'A', 'B', {
    evaluationPlan: CODE_PLAN, between: async () => { drained++; }, ...ONCE,
  });
  assertEqual(drained, 1, 'kontence ve VRAM zkresluje výsledek — paměť se musí uvolnit');
});

// ─── Cache sad ──────────────────────────────────────────────────────────────

suite('createSuiteCache');

await testAsync('tatáž sada se pro tentýž model nespustí dvakrát', async () => {
  // D1, D2 i R1 používají sadu `reasoning`. Bez cache by se pro jednu dvojici
  // modelů spustila třikrát a zkouška kandidáta by trvala skoro dvojnásobek.
  const runner = fakeRunner({ A: { _default: 1 }, B: { _default: 1 } });
  const suiteCache = createSuiteCache();
  await comparePair(runner, 'reasoning', 'A', 'B', { suiteCache, ...ONCE });
  await comparePair(runner, 'reasoning', 'A', 'B', { suiteCache, ...ONCE });
  await comparePair(runner, 'reasoning', 'A', 'B', { suiteCache, ...ONCE });
  assertEqual(runner.calls.length, 2, 'dva běhy pro dva modely, ne šest');
});

await testAsync('jiný stávající model se spustí znovu', async () => {
  const runner = fakeRunner({ A: { _default: 1 }, B: { _default: 1 }, C: { _default: 1 } });
  const suiteCache = createSuiteCache();
  await comparePair(runner, 'reasoning', 'A', 'B', { suiteCache, ...ONCE });
  await comparePair(runner, 'reasoning', 'A', 'C', { suiteCache, ...ONCE });
  assertEqual(runner.calls.length, 3, 'A z cache, B i C se musí změřit');
});

await testAsync('stejná sada a model se mezi rolemi znovu změří', async () => {
  const runner = fakeRunner({ A: { _default: 1 }, B: { _default: 1 } });
  const suiteCache = createSuiteCache();
  await comparePair(runner, 'reasoning', 'A', 'B', { suiteCache, role: 'D1', ...ONCE });
  await comparePair(runner, 'reasoning', 'A', 'B', { suiteCache, role: 'D2', ...ONCE });
  assertEqual(runner.calls.length, 4, 'role is part of the in-memory evidence identity');
});

await testAsync('stejný contract se mezi verzemi sady znovu změří', async () => {
  const runner = fakeRunner({ A: { _default: 1 }, B: { _default: 1 } });
  const suiteCache = createSuiteCache();
  const exact = { suiteCache, role: 'CHAT', suiteContractSha256: 'c'.repeat(64), ...ONCE };
  await comparePair(runner, 'reasoning', 'A', 'B', { ...exact, suiteVersion: 'v1' });
  await comparePair(runner, 'reasoning', 'A', 'B', { ...exact, suiteVersion: 'v2' });
  assertEqual(runner.calls.length, 4, 'suite version is part of the in-memory evidence identity');
});

await testAsync('bez cache se chování nemění', async () => {
  const runner = fakeRunner({ A: { _default: 1 }, B: { _default: 1 } });
  await comparePair(runner, 'reasoning', 'A', 'B', ONCE);
  await comparePair(runner, 'reasoning', 'A', 'B', ONCE);
  assertEqual(runner.calls.length, 4);
});

await testAsync('cache vrací tytéž výsledky jako přímý běh', async () => {
  const scores = { A: { _default: 1 }, B: { _default: 0.4 } };
  const direct = await comparePair(fakeRunner(scores), 'reasoning', 'A', 'B', ONCE);
  const suiteCache = createSuiteCache();
  await comparePair(fakeRunner(scores), 'reasoning', 'A', 'B', { suiteCache, ...ONCE });
  const cached = await comparePair(fakeRunner(scores), 'reasoning', 'A', 'B', { suiteCache, ...ONCE });
  assertEqual(cached.margin, direct.margin);
  assertEqual(cached.discriminating, direct.discriminating);
});

await testAsync('úklid paměti se přeskočí, když se druhý model nespouští', async () => {
  let drained = 0;
  const runner = fakeRunner({ A: { _default: 1 }, B: { _default: 1 } });
  const suiteCache = createSuiteCache();
  await comparePair(runner, 'reasoning', 'A', 'B', { suiteCache, between: async () => { drained++; }, ...ONCE });
  await comparePair(runner, 'reasoning', 'A', 'B', { suiteCache, between: async () => { drained++; }, ...ONCE });
  assertEqual(drained, 1, 'podruhé se nic nespouští, takže není co uvolňovat');
});

// ─── Opakování a nestabilita ────────────────────────────────────────────────

suite('opakování sad');

await testAsync('výchozí počet opakování je víc než jedno', () => {
  // Jeden běh nestačí: `czech_json` na témž modelu dala 1 → 0 → 1.
  assert(DEFAULT_REPEATS >= 3, `opakování musí být aspoň 3, je ${DEFAULT_REPEATS}`);
});

await testAsync('sada se spustí tolikrát, kolik se řekne', async () => {
  const runner = fakeRunner({ A: { _default: 1 }, B: { _default: 1 } });
  await comparePair(runner, 'code', 'A', 'B', { repeats: 3 });
  assertEqual(runner.calls.length, 6, '3 běhy na model');
});

await testAsync('nestabilní úloha nerozliší, i když se v jednom běhu liší', async () => {
  // Přesně případ, který vyrobil protichůdná rozhodnutí: úloha, která na
  // stávajícím modelu přeskakuje 0↔1, nesmí platit za rozdíl v kvalitě.
  const task = SUITES.code.tests[0].name;
  const runner = fakeRunner({
    A: { _default: 1, [task]: 1 },
    B: { _default: 1, [task]: [0, 1, 1] },
  });
  const r = await comparePair(runner, 'code', 'A', 'B', { repeats: 3 });
  const t = r.tasks.find(x => x.name === task);
  assertEqual(t.incumbentSpread, 1, 'nestabilita se změří');
  assertEqual(t.discriminating, false, 'rozdíl menší než šum nerozlišuje');
  assertEqual(r.inconclusive, true);
});

await testAsync('stabilní rozdíl rozliší i vedle nestabilní úlohy', async () => {
  const [flaky, solid] = SUITES.code.tests.map(t => t.name);
  const runner = fakeRunner({
    A: { _default: 1, [flaky]: [1, 0, 1], [solid]: 1 },
    B: { _default: 1, [flaky]: [0, 1, 0], [solid]: 0 },
  });
  const r = await comparePair(runner, 'code', 'A', 'B', { repeats: 3 });
  assertEqual(r.tasks.find(x => x.name === flaky).discriminating, false);
  assertEqual(r.tasks.find(x => x.name === solid).discriminating, true);
  assertEqual(r.candidateWins, 1);
});

await testAsync('nestabilní úlohy se vypíšou', async () => {
  const task = SUITES.code.tests[0].name;
  const runner = fakeRunner({ A: { _default: 1 }, B: { _default: 1, [task]: [0, 1, 1] } });
  const r = await comparePair(runner, 'code', 'A', 'B', { repeats: 3 });
  assert(r.unstableTasks.includes(task), 'operátor má vědět, které úlohy nejsou spolehlivé');
  assertEqual(r.repeats, 3);
});

await testAsync('skóre úlohy je průměr přes běhy', async () => {
  const task = SUITES.code.tests[0].name;
  const runner = fakeRunner({ A: { _default: 1, [task]: [0, 1, 1] }, B: { _default: 1 } });
  const r = await comparePair(runner, 'code', 'A', 'B', { repeats: 3 });
  assertEqual(r.tasks.find(x => x.name === task).candidateScore, 0.667);
});

// ─── Jistota rozhodnutí ─────────────────────────────────────────────────────

suite('jistota rozhodnutí');

test('rozhodnutí o jedinou úlohu je označené jako nízká jistota', () => {
  // Jedno pozorování není trend. Signál se nezahazuje, ale musí být vidět,
  // jak široký podklad za rozhodnutím stojí.
  const d = decideRole({ margin: 1, candidateWins: 1, incumbentWins: 0, discriminating: 1, inconclusive: false }, {}, 0.06);
  assertEqual(d.winner, 'candidate');
  assert(/nízká/.test(d.confidence), d.confidence);
  assert(/jistota nízká/.test(d.detail), d.detail);
});

test('víc rozlišujících úloh zvedá jistotu', () => {
  const two = decideRole({ margin: 0.5, candidateWins: 2, incumbentWins: 0, discriminating: 2, inconclusive: false }, {}, 0.05);
  const many = decideRole({ margin: 0.5, candidateWins: 5, incumbentWins: 0, discriminating: 5, inconclusive: false }, {}, 0.05);
  assertEqual(two.confidence, 'střední');
  assertEqual(many.confidence, 'vysoká');
});

test('role-specific evidence gate blocks a narrow language sample', () => {
  const comparison = {
    margin: 0.4, candidateWins: 2, incumbentWins: 0, discriminating: 2,
    inconclusive: false,
    tasks: [
      { name: 'cz_a', language: 'cs', discriminating: true },
      { name: 'cz_b', language: 'cs', discriminating: true },
    ],
  };
  const decision = decideRole(comparison, {}, 0.04, {
    minimumDiscriminatingTasks: 6,
    minimumDiscriminatingByLanguage: { en: 3, cs: 4 },
  });
  assertEqual(decision.winner, 'incumbent');
  assertEqual(decision.basis, 'nedostatečný důkaz');
  assertEqual(decision.reasonCode, 'INSUFFICIENT_EVIDENCE');
  assert(/cs 2\/4/.test(decision.detail), decision.detail);
});

test('role-specific evidence gate admits a broad bilingual sample', () => {
  const tasks = [
    ...Array.from({ length: 3 }, (_, i) => ({ name: `en_${i}`, language: 'en', discriminating: true })),
    ...Array.from({ length: 4 }, (_, i) => ({ name: `cs_${i}`, language: 'cs', discriminating: true })),
  ];
  const decision = decideRole({
    margin: 0.2, candidateWins: 6, incumbentWins: 1,
    discriminating: tasks.length, inconclusive: false, tasks,
  }, {}, 0.04, {
    minimumDiscriminatingTasks: 6,
    minimumDiscriminatingByLanguage: { en: 3, cs: 4 },
  });
  assertEqual(decision.winner, 'candidate');
});

test('jistota se hlásí i u prohry kandidáta', () => {
  const d = decideRole({ margin: -1, candidateWins: 0, incumbentWins: 3, discriminating: 3, inconclusive: false }, {}, 0.05);
  assertEqual(d.winner, 'incumbent');
  assertEqual(d.confidence, 'vysoká');
});

await testAsync('durable history prevents a second model run for the same contract', async () => {
  const runner = fakeRunner({ A: { _default: 0.9 }, B: { _default: 0.4 } });
  const stored = new Map();
  const options = {
    repeats: 1,
    suiteContractSha256: 'a'.repeat(64),
    suiteVersion: 'test-v1',
    resolveArtifact: async model => artifactFor(model),
    loadHistoricalSummary: async ({ model }) => stored.get(model) || null,
    saveHistoricalSummary: async ({ model, summary }) => { stored.set(model, summary); },
  };
  await comparePair(runner, 'code', 'A', 'B', options);
  assertEqual(runner.calls.length, 2);
  await comparePair(runner, 'code', 'A', 'B', options);
  assertEqual(runner.calls.length, 2, 'second comparison must reuse both durable summaries');
});

await testAsync('a different suite contract cannot reuse an old summary', async () => {
  const runner = fakeRunner({ A: { _default: 0.9 }, B: { _default: 0.4 } });
  const stored = new Map();
  const hooks = {
    repeats: 1,
    resolveArtifact: async model => artifactFor(model),
    loadHistoricalSummary: async ({ model, suiteContractSha256 }) => stored.get(`${suiteContractSha256}:${model}`) || null,
    saveHistoricalSummary: async ({ model, suiteContractSha256, summary }) => { stored.set(`${suiteContractSha256}:${model}`, summary); },
  };
  await comparePair(runner, 'code', 'A', 'B', { ...hooks, suiteContractSha256: 'a'.repeat(64) });
  await comparePair(runner, 'code', 'A', 'B', { ...hooks, suiteContractSha256: 'b'.repeat(64) });
  assertEqual(runner.calls.length, 4);
});

summary();
