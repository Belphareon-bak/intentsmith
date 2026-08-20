#!/usr/bin/env node
// Discrimination Report — doloží, jestli sada vůbec rozlišuje mezi modely
// ══════════════════════════════════════════════════════════════════════════════
//
//     node src/eval/discrimination-report.js qwen2.5-coder:32b qwen3-coder:latest qwen3:14b
//
// Proč zvláštní krok:
//
// Sada, která dá všem modelům stejné skóre, neměří nic — a přesně to se stalo
// staré sadě `code`, kde 8 z 36 úloh dávalo 100 % komukoli včetně vision
// modelu.  Než se na novou sadu začne cokoli vázat, musí být doloženo, že
// rozptyl mezi nejlepším a nejhorším modelem je **větší než vlastní šum
// metriky** — tedy než kolik tatáž dvojice model+úloha kolísá mezi opakováními.
//
// Měří se přes `comparePair()` z `pairwise-trial.js`, ne vlastní cestou: ten
// už umí opakování, marži i práh odvozený z nestability.  Sdílená cache
// zajistí, že se každý model prožene sadou jen jednou, i když vstupuje do víc
// dvojic.
//
// Když sada nerozlišuje, skript to **nahlásí jako výsledek**, ne jako chybu.
// Zjištění „nerozlišuje" je pořád lepší než tvrdit, že je kandidát lepší,
// protože oba dali 100 %.
//
// ══════════════════════════════════════════════════════════════════════════════

import { execFileSync } from 'node:child_process';
import { ValidationRunner, SUITES } from '../upgrade/validation-suites.js';
import { comparePair, createSuiteCache, TASK_MARGIN_EPSILON } from '../upgrade/pairwise-trial.js';

const SUITE = 'code_patch';

/** Uvolní VRAM mezi modely — jinak se přetahují a měření zkresluje umístění. */
function unloadAll(models) {
  for (const m of models) {
    try { execFileSync('ollama', ['stop', m], { stdio: 'ignore', timeout: 30_000 }); } catch { /* nevadí */ }
  }
}

/**
 * @param {string[]} models
 * @returns {Promise<Object>} souhrn včetně verdiktu o rozlišování
 */
export async function measureDiscrimination(models, opts = {}) {
  const runner = opts.runner || new ValidationRunner();
  const repeats = opts.repeats ?? 3;
  const cache = createSuiteCache();
  const log = opts.log ?? (() => {});

  const pairs = [];
  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      log(`\n── ${models[i]} vs ${models[j]} ──`);
      const cmp = await comparePair(runner, SUITE, models[i], models[j], {
        repeats,
        suiteCache: cache,
        between: () => unloadAll(models),
        onProgress: opts.onProgress,
      });
      pairs.push({ a: models[i], b: models[j], comparison: cmp });
      log(`   rozlišujících úloh: ${cmp.discriminating}/${cmp.tasks.length}, marže ${cmp.margin}`);
    }
  }

  // Skóre modelu = průměr přes úlohy; šum = kolísání téhož modelu na téže
  // úloze mezi opakováními.  Rozdíl menší než šum není rozdíl v kvalitě.
  const perModel = new Map();
  const perTaskSpread = [];
  for (const { a, b, comparison } of pairs) {
    perModel.set(a, comparison.candidateSuiteScore);
    perModel.set(b, comparison.incumbentSuiteScore);
    for (const t of comparison.tasks) perTaskSpread.push(t.candidateSpread, t.incumbentSpread);
  }

  const scores = [...perModel.entries()].sort((x, y) => y[1] - x[1]);
  const best = scores[0], worst = scores[scores.length - 1];
  const range = best[1] - worst[1];
  const maxNoise = perTaskSpread.length ? Math.max(...perTaskSpread) : 0;
  const meanNoise = perTaskSpread.length
    ? perTaskSpread.reduce((s, v) => s + v, 0) / perTaskSpread.length : 0;

  // Šum na úrovni sady: jedna kolísající úloha z N posune skóre sady o 1/N.
  const taskCount = SUITES[SUITE].tests.length || 1;
  const suiteNoise = maxNoise / taskCount;
  const discriminates = range > Math.max(suiteNoise, TASK_MARGIN_EPSILON);

  return {
    suite: SUITE, models, repeats, taskCount,
    scores, range, maxNoise, meanNoise, suiteNoise, discriminates, pairs,
  };
}

if (process.argv[1]?.endsWith('discrimination-report.js')) {
  const models = process.argv.slice(2);
  if (models.length < 2) {
    console.error('použití: node src/eval/discrimination-report.js <model> <model> [model…]');
    process.exit(1);
  }

  const t0 = Date.now();
  const r = await measureDiscrimination(models, {
    log: (m) => console.log(m),
    onProgress: (p) => { if (p.status === 'running') process.stderr.write(`\r   ${p.suite} ${p.currentTest}/${p.totalTests} ${p.testName}      `); },
  });

  console.log('\n\n═══ SKÓRE SADY code_patch ═══');
  for (const [m, s] of r.scores) console.log(`  ${s.toFixed(3)}  ${m}`);
  console.log(`\nrozptyl nejlepší−nejhorší : ${r.range.toFixed(3)}`);
  console.log(`šum metriky (max kolísání téže úlohy): ${r.maxNoise.toFixed(3)} → na úrovni sady ${r.suiteNoise.toFixed(3)}`);
  console.log(`průměrné kolísání: ${r.meanNoise.toFixed(3)}`);
  console.log(`\nVERDIKT: sada ${r.discriminates ? '✅ ROZLIŠUJE' : '❌ NEROZLIŠUJE'} `
    + `(rozptyl ${r.range.toFixed(3)} ${r.discriminates ? '>' : '≤'} práh ${Math.max(r.suiteNoise, TASK_MARGIN_EPSILON).toFixed(3)})`);
  console.log('\n── dvojice ──');
  for (const p of r.pairs) {
    const c = p.comparison;
    console.log(`  ${p.a} vs ${p.b}: rozlišuje ${c.discriminating}/${c.tasks.length} úloh, marže ${c.margin}`
      + (c.inconclusive ? '  (nerozhodně)' : ''));
    for (const t of c.tasks) {
      console.log(`      ${t.name}  ${t.candidateScore.toFixed(2)} vs ${t.incumbentScore.toFixed(2)}`
        + `  Δ${t.delta.toFixed(2)} šum ${t.noise.toFixed(2)}${t.discriminating ? '  ← rozlišuje' : ''}`);
    }
  }
  console.log(`\ncelkem ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

export default { measureDiscrimination };
