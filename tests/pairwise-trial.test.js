// tests/pairwise-trial.test.js — souboj kandidáta se stávajícím modelem
// ══════════════════════════════════════════════════════════════════════════════
// Bez sítě a bez modelů: runner je nahrazený atrapou vracející zadaná skóre.
// ══════════════════════════════════════════════════════════════════════════════

import { suite, test, testAsync, assert, assertEqual, summary } from './harness.js';

import { comparePair, decideRole, trialRole, createSuiteCache, TASK_MARGIN_EPSILON } from '../src/upgrade/pairwise-trial.js';
import { SUITES } from '../src/upgrade/validation-suites.js';

/** Runner, který pro každý model vrátí předepsaná skóre úloh. */
function fakeRunner(scoresByModel) {
  return {
    calls: [],
    async runSuite(suiteName, model) {
      this.calls.push({ suiteName, model });
      const per = scoresByModel[model] || {};
      const tests = SUITES[suiteName].tests.map(t => ({
        name: t.name,
        score: per[t.name] ?? per._default ?? 1.0,
        passed: (per[t.name] ?? per._default ?? 1.0) >= 0.6,
      }));
      return {
        suite: suiteName, model, tests,
        score: tests.reduce((s, t) => s + t.score, 0) / tests.length,
      };
    },
  };
}

const CODE_TASKS = SUITES.code.tests.map(t => t.name);

// ─── comparePair ────────────────────────────────────────────────────────────

suite('comparePair');

await testAsync('oba modely projdou tutéž sadu', async () => {
  const runner = fakeRunner({ A: { _default: 1 }, B: { _default: 1 } });
  await comparePair(runner, 'code', 'A', 'B');
  assertEqual(runner.calls.length, 2);
  assert(runner.calls.every(c => c.suiteName === 'code'), 'stejná sada pro oba');
});

await testAsync('shodná skóre = žádná rozlišující úloha', async () => {
  // Přesně ta situace, kvůli které párové srovnání vzniklo: 26 z 65 běhů
  // skončilo na 100 %, takže absolutní skóre nerozliší nic.
  const runner = fakeRunner({ A: { _default: 1 }, B: { _default: 1 } });
  const r = await comparePair(runner, 'code', 'A', 'B');
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
  const r = await comparePair(runner, 'code', 'A', 'B');
  assertEqual(r.discriminating, 0, 'drobný rozdíl je šum, ne signál');
});

await testAsync('marže se počítá jen z rozlišujících úloh', async () => {
  const runner = fakeRunner({
    A: { _default: 1, [CODE_TASKS[0]]: 1.0 },
    B: { _default: 1, [CODE_TASKS[0]]: 0.5 },
  });
  const r = await comparePair(runner, 'code', 'A', 'B');
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
  const r = await comparePair(runner, 'code', 'A', 'B');
  assertEqual(r.incumbentWins, 1);
  assert(r.margin < 0, 'marže musí být záporná');
});

await testAsync('neznámá sada vyhodí', async () => {
  let threw = false;
  try { await comparePair(fakeRunner({}), 'neexistuje', 'A', 'B'); } catch { threw = true; }
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

test('při remíze kvality rozhodne výrazně vyšší rychlost', () => {
  const d = decideRole({ margin: 0, discriminating: 0, inconclusive: true }, { candidate: 140, incumbent: 70 }, 0.05);
  assertEqual(d.winner, 'candidate');
  assertEqual(d.basis, 'rychlost');
  assert(/2\.00×/.test(d.detail), `detail má uvést poměr: ${d.detail}`);
});

test('malý rozdíl rychlosti výměnu neospravedlní', () => {
  const d = decideRole({ margin: 0, discriminating: 0, inconclusive: true }, { candidate: 78, incumbent: 70 }, 0.05);
  assertEqual(d.winner, 'incumbent');
  assertEqual(d.basis, 'nerozhodně');
});

test('bez změřené rychlosti se při remíze nemění nic', () => {
  const d = decideRole({ margin: 0, discriminating: 0, inconclusive: true }, {}, 0.05);
  assertEqual(d.winner, 'incumbent');
  assert(/není změřená/.test(d.detail));
});

test('rozhodnutí vždy nese základ i vysvětlení', () => {
  for (const c of [
    { margin: 0.2, candidateWins: 3, incumbentWins: 0, discriminating: 3, inconclusive: false },
    { margin: -0.2, candidateWins: 0, incumbentWins: 3, discriminating: 3, inconclusive: false },
    { margin: 0, discriminating: 0, inconclusive: true },
  ]) {
    const d = decideRole(c, { candidate: 10, incumbent: 10 }, 0.05);
    assert(d.basis && d.detail, 'každé rozhodnutí musí být zdůvodněné');
  }
});

// ─── trialRole ──────────────────────────────────────────────────────────────

suite('trialRole');

await testAsync('role bez validační sady se přeskočí', async () => {
  const r = await trialRole(fakeRunner({}), 'NEEXISTUJICI_ROLE', 'A', 'B');
  assertEqual(r.skipped, true);
});

await testAsync('vrátí porovnání i rozhodnutí', async () => {
  const runner = fakeRunner({
    A: { _default: 1 },
    B: { _default: 1, [CODE_TASKS[0]]: 0.2 },
  });
  const r = await trialRole(runner, 'CODE', 'A', 'B', { threshold: 0.05 });
  assertEqual(r.skipped, false);
  assertEqual(r.suite, 'code');
  assert(r.comparison && r.decision, 'musí nést obojí');
  assertEqual(r.decision.winner, 'candidate');
});

await testAsync('mezi modely se dá vložit úklid paměti', async () => {
  let drained = 0;
  const runner = fakeRunner({ A: { _default: 1 }, B: { _default: 1 } });
  await trialRole(runner, 'CODE', 'A', 'B', { between: async () => { drained++; } });
  assertEqual(drained, 1, 'kontence ve VRAM zkresluje výsledek — paměť se musí uvolnit');
});

// ─── Cache sad ──────────────────────────────────────────────────────────────

suite('createSuiteCache');

await testAsync('tatáž sada se pro tentýž model nespustí dvakrát', async () => {
  // D1, D2 i R1 používají sadu `reasoning`. Bez cache by se pro jednu dvojici
  // modelů spustila třikrát a zkouška kandidáta by trvala skoro dvojnásobek.
  const runner = fakeRunner({ A: { _default: 1 }, B: { _default: 1 } });
  const suiteCache = createSuiteCache();
  await comparePair(runner, 'reasoning', 'A', 'B', { suiteCache });
  await comparePair(runner, 'reasoning', 'A', 'B', { suiteCache });
  await comparePair(runner, 'reasoning', 'A', 'B', { suiteCache });
  assertEqual(runner.calls.length, 2, 'dva běhy pro dva modely, ne šest');
});

await testAsync('jiný stávající model se spustí znovu', async () => {
  const runner = fakeRunner({ A: { _default: 1 }, B: { _default: 1 }, C: { _default: 1 } });
  const suiteCache = createSuiteCache();
  await comparePair(runner, 'reasoning', 'A', 'B', { suiteCache });
  await comparePair(runner, 'reasoning', 'A', 'C', { suiteCache });
  assertEqual(runner.calls.length, 3, 'A z cache, B i C se musí změřit');
});

await testAsync('bez cache se chování nemění', async () => {
  const runner = fakeRunner({ A: { _default: 1 }, B: { _default: 1 } });
  await comparePair(runner, 'reasoning', 'A', 'B');
  await comparePair(runner, 'reasoning', 'A', 'B');
  assertEqual(runner.calls.length, 4);
});

await testAsync('cache vrací tytéž výsledky jako přímý běh', async () => {
  const scores = { A: { _default: 1 }, B: { _default: 0.4 } };
  const direct = await comparePair(fakeRunner(scores), 'reasoning', 'A', 'B');
  const suiteCache = createSuiteCache();
  await comparePair(fakeRunner(scores), 'reasoning', 'A', 'B', { suiteCache });
  const cached = await comparePair(fakeRunner(scores), 'reasoning', 'A', 'B', { suiteCache });
  assertEqual(cached.margin, direct.margin);
  assertEqual(cached.discriminating, direct.discriminating);
});

await testAsync('úklid paměti se přeskočí, když se druhý model nespouští', async () => {
  let drained = 0;
  const runner = fakeRunner({ A: { _default: 1 }, B: { _default: 1 } });
  const suiteCache = createSuiteCache();
  await comparePair(runner, 'reasoning', 'A', 'B', { suiteCache, between: async () => { drained++; } });
  await comparePair(runner, 'reasoning', 'A', 'B', { suiteCache, between: async () => { drained++; } });
  assertEqual(drained, 1, 'podruhé se nic nespouští, takže není co uvolňovat');
});

summary();
