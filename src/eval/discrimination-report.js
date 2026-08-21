#!/usr/bin/env node
// Discrimination Report — co která úloha měří a jestli sada rozlišuje
// ══════════════════════════════════════════════════════════════════════════════
//
//     node src/eval/discrimination-report.js qwen2.5-coder:32b qwen3-coder:latest …
//
// Proč zvláštní krok:
//
// Sada, která dá všem modelům stejné skóre, neměří nic — a přesně to se stalo
// staré sadě `code`, kde 8 z 36 úloh dávalo 100 % komukoli včetně vision
// modelu.  Průměr přes sadu tohle schová: stačí jedna rozlišující úloha a sada
// vypadá funkčně, i když zbytek je mrtvý.
//
// Report proto hlásí **každou úlohu zvlášť** a zařadí ji do jedné ze čtyř
// kategorií:
//
//   rozlišuje — modely se na ní liší víc, než kolik sama kolísá
//   podlaha   — nevyřešil ji nikdo (dnes bez informace, ale rezerva pro
//               silnější modely — proto se nemaže, jen odkládá)
//   strop     — vyřešili ji všichni (bez informace, tohle byla nemoc staré sady)
//   shodné    — všichni stejně někde uprostřed
//
// Měří se přes `comparePair()` z `pairwise-trial.js`, ne vlastní cestou: ten už
// umí opakování, marži i práh odvozený z nestability.  Sdílená cache zajistí,
// že se každý model prožene sadou jen jednou, i když vstupuje do víc dvojic.
//
// Skóre je **přínos proti nečinnosti**, ne podíl prošlých testů — úlohy mají
// různou podlahu a bez normalizace by se sčítaly nesrovnatelné veličiny.
//
// ══════════════════════════════════════════════════════════════════════════════

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
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
 * Zařadí úlohu podle toho, co na daném panelu modelů dokáže rozlišit.
 *
 * `nestabilní` je vlastní kategorie, ne poddruh „shodné": úloha, která sama
 * kolísá víc, než činí rozdíl mezi modely, nemůže o modelech nic tvrdit —
 * a schovat ji mezi shodné by zakrylo vadu měření.  Změřeno na `286a9117`,
 * kde částečný pád běhu dostával plné skóre a úloha skákala mezi 0 a 1.
 */
export function classifyTask(values, noise) {
  const range = Math.max(...values) - Math.min(...values);
  if (noise > TASK_MARGIN_EPSILON && noise >= range) return 'nestabilní';
  if (range > Math.max(TASK_MARGIN_EPSILON, noise)) return 'rozlišuje';
  if (values.every(v => v <= TASK_MARGIN_EPSILON)) return 'podlaha';
  if (values.every(v => v >= 1 - TASK_MARGIN_EPSILON)) return 'strop';
  return 'shodné';
}

/**
 * @param {string[]} models
 * @returns {Promise<Object>} matice úloha × model, zařazení úloh a verdikt
 */
export async function measureDiscrimination(models, opts = {}) {
  const runner = opts.runner || new ValidationRunner();
  const repeats = opts.repeats ?? 3;
  const cache = createSuiteCache();
  const log = opts.log ?? (() => {});

  // matice: úloha → model → { mean, spread }
  const matrix = new Map();
  const record = (taskName, model, mean, spread) => {
    if (!matrix.has(taskName)) matrix.set(taskName, new Map());
    matrix.get(taskName).set(model, { mean, spread });
  };

  const pairs = [];
  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      log(`\n── ${models[i]} vs ${models[j]} ──`);
      const cmp = await comparePair(runner, SUITE, models[i], models[j], {
        repeats, suiteCache: cache, between: () => unloadAll(models), onProgress: opts.onProgress,
      });
      for (const t of cmp.tasks) {
        record(t.name, models[i], t.candidateScore, t.candidateSpread);
        record(t.name, models[j], t.incumbentScore, t.incumbentSpread);
      }
      pairs.push({ a: models[i], b: models[j], comparison: cmp });
      log(`   rozlišujících úloh: ${cmp.discriminating}/${cmp.tasks.length}, marže ${cmp.margin}`);
    }
  }

  const tasks = [...matrix.entries()].map(([name, byModel]) => {
    const values = models.map(m => byModel.get(m)?.mean ?? 0);
    const noise = Math.max(...models.map(m => byModel.get(m)?.spread ?? 0));
    return { name, values, noise, verdict: classifyTask(values, noise) };
  });

  const scores = models
    .map(m => [m, tasks.reduce((s, t) => s + t.values[models.indexOf(m)], 0) / (tasks.length || 1)])
    .sort((a, b) => b[1] - a[1]);

  const discriminating = tasks.filter(t => t.verdict === 'rozlišuje').length;
  const maxNoise = Math.max(0, ...tasks.map(t => t.noise));
  const range = scores.length ? scores[0][1] - scores[scores.length - 1][1] : 0;

  return {
    suite: SUITE, models, repeats, tasks, scores, pairs,
    discriminating, total: tasks.length, maxNoise, range,
    suiteDiscriminates: range > Math.max(maxNoise / (tasks.length || 1), TASK_MARGIN_EPSILON),
  };
}

if (process.argv[1]?.endsWith('discrimination-report.js')) {
  const jsonAt = process.argv.indexOf('--json');
  const jsonPath = jsonAt > -1 ? process.argv[jsonAt + 1] : null;
  const models = process.argv.slice(2).filter((a, i, all) => a !== '--json' && all[i - 1] !== '--json');
  if (models.length < 2) {
    console.error('použití: node src/eval/discrimination-report.js <model> <model> [model…]');
    process.exit(1);
  }

  const t0 = Date.now();
  const r = await measureDiscrimination(models, {
    log: (m) => console.log(m),
    onProgress: (p) => {
      if (p.status === 'running') process.stderr.write(`\r   ${p.suite} ${p.currentTest}/${p.totalTests} ${p.testName}      `);
    },
  });

  const short = (m) => (m.length > 13 ? `${m.slice(0, 12)}…` : m).padStart(13);

  console.log(`\n\n═══ PŘÍNOS PROTI NEČINNOSTI — sada ${r.suite} ═══\n`);
  console.log(`${'úloha'.padEnd(18)}${r.models.map(short).join('')}   ${'šum'.padStart(6)}  zařazení`);
  console.log('─'.repeat(18 + 13 * r.models.length + 22));
  for (const t of r.tasks) {
    const cells = t.values.map(v => v.toFixed(2).padStart(13)).join('');
    console.log(`${t.name.padEnd(18)}${cells}   ${t.noise.toFixed(2).padStart(6)}  ${t.verdict}`);
  }
  console.log('─'.repeat(18 + 13 * r.models.length + 22));
  const means = r.models.map(m => (r.scores.find(s => s[0] === m)[1]).toFixed(2).padStart(13)).join('');
  console.log(`${'průměr'.padEnd(18)}${means}`);

  console.log('\n═══ POŘADÍ ═══');
  for (const [m, s] of r.scores) console.log(`  ${s.toFixed(3)}  ${m}`);

  const counts = {};
  for (const t of r.tasks) counts[t.verdict] = (counts[t.verdict] || 0) + 1;
  console.log('\n═══ CO SADA MĚŘÍ ═══');
  console.log(`  rozlišuje: ${r.discriminating}/${r.total}` + Object.entries(counts)
    .filter(([k]) => k !== 'rozlišuje').map(([k, v]) => ` · ${k}: ${v}`).join(''));
  console.log(`  rozptyl mezi modely: ${r.range.toFixed(3)} · šum metriky: ${r.maxNoise.toFixed(3)}`);
  console.log(`\nVERDIKT: sada ${r.suiteDiscriminates ? '✅ ROZLIŠUJE' : '❌ NEROZLIŠUJE'}`
    + `, informaci nese ${r.discriminating} z ${r.total} úloh`);

  console.log('\n── dvojice ──');
  for (const p of r.pairs) {
    const c = p.comparison;
    console.log(`  ${p.a} vs ${p.b}: ${c.discriminating}/${c.tasks.length} úloh, marže ${c.margin}`
      + (c.inconclusive ? '  (nerozhodně)' : ''));
  }
  // Výsledek se ukládá, aby na něj mohla navázat kalibrace bez dalšího běhu
  // přes všechny modely — ten trvá desítky minut.
  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({
      measuredAt: new Date().toISOString(),
      models: r.models, repeats: r.repeats,
      tasks: r.tasks, scores: r.scores,
      discriminating: r.discriminating, total: r.total,
    }, null, 2) + '\n');
    console.log(`\nvýsledek uložen: ${jsonPath}`);
  }

  console.log(`\ncelkem ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

export default { measureDiscrimination, classifyTask };
