// Pairwise Trial — souboj kandidáta se stávajícím modelem na stejných úlohách
// ══════════════════════════════════════════════════════════════════════════════
//
// Proč nestačí absolutní skóre validačních sad:
//
// Změřeno 2026-08-19 na 13 modelech × 5 sad: hodnota 100 % padla **26× z 65**.
// `devstral-small-2:24b` měl 100 % ve čtyřech sadách z pěti, `llava:13b` —
// vision model — dostal 100 % v sadě `code`.  U špičky pole tedy sady
// nerozlišují a rozdíl mezi 1.00 a 1.00 nenese informaci.
//
// Řešení není zpřísňovat prahy, ale změnit otázku.  Místo „kolik procent dal
// kandidát" se ptáme „na kterých konkrétních úlohách je lepší než ten, koho má
// nahradit" — tytéž úlohy, tytéž prompty, porovnání po jednotlivých položkách:
//
//   - úloha, kde oba dopadnou stejně, do rozhodnutí nevstupuje (nerozlišuje);
//   - rozhoduje se z úloh, kde se skóre liší, podle **marže**, ne pass/fail;
//   - když nerozlišuje ani jedna úloha, kvalita se prohlásí za nerozhodnou a
//     rozhodne naměřená propustnost — což je poctivější než tvrdit, že je
//     kandidát lepší, protože oba dali 100 %.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';
import { SUITES, getSuiteForRole } from './validation-suites.js';

/** O kolik musí kandidát vést v marži, aby se to počítalo za rozdíl na úloze. */
export const TASK_MARGIN_EPSILON = 0.05;

/**
 * Kolikrát se každá sada spustí na každém modelu.
 *
 * Jeden běh nestačí.  Změřeno 2026-08-19 na `deepseek-r1-32b`, sada `reasoning`
 * třikrát po sobě:
 *
 *     json_compliance   0 → 1 → 1
 *     czech_json        1 → 0 → 1
 *     skóre sady       63% → 63% → 75%
 *
 * Dvě z osmi úloh přeskakují mezi 0 a 1, protože se hodnotí binárně a model
 * vzorkuje (temperature 0.1).  Při jednom běhu pak `TASK_MARGIN_EPSILON` bere
 * náhodný přeskok za silný signál — přesně to vyrobilo protichůdná rozhodnutí,
 * kdy tatáž dvojice modelů na téže sadě vyšla jednou 3:0 pro kandidáta a
 * podruhé 0:5 pro stávajícího.
 */
export const DEFAULT_REPEATS = 3;

/**
 * Cache výsledků sady pro jeden běh.
 *
 * Role sdílejí sady: `reasoning` obsluhuje D1, D2 i R1, takže bez cache by se
 * pro tutéž dvojici modelů spustila třikrát a celá zkouška kandidáta by trvala
 * skoro dvojnásobek.  Skóre modelu na dané sadě se v rámci běhu nemění, takže
 * je bezpečné ho podržet; klíčem je dvojice sada+model, aby si role nemíchaly
 * různé stávající modely.
 */
export function createSuiteCache() {
  return new Map();
}

/**
 * Spustí sadu několikrát a shrne každou úlohu na průměr a rozptyl.
 *
 * `spread` je rozdíl mezi nejlepším a nejhorším během téže úlohy na témž
 * modelu — tedy kolik z pozorovaného rozdílu jde na vrub náhodě, ne kvalitě.
 */
async function runSuiteRepeated(runner, suiteName, model, repeats, onProgress, between) {
  const runs = [];
  for (let i = 0; i < repeats; i++) {
    if (i > 0 && between) await between();
    runs.push(await runner.runSuite(suiteName, model, onProgress));
  }

  const byTask = new Map();
  for (const run of runs) {
    for (const t of run.tests) {
      if (!byTask.has(t.name)) byTask.set(t.name, []);
      byTask.get(t.name).push(t.score ?? 0);
    }
  }

  const tasks = [...byTask.entries()].map(([name, scores]) => ({
    name,
    mean: scores.reduce((a, b) => a + b, 0) / scores.length,
    spread: Math.max(...scores) - Math.min(...scores),
    scores,
  }));

  return {
    suite: suiteName,
    model,
    runs: runs.length,
    tasks,
    score: tasks.reduce((s, t) => s + t.mean, 0) / (tasks.length || 1),
    unstableTasks: tasks.filter(t => t.spread > 0).map(t => t.name),
  };
}

async function runSuiteCached(runner, suiteName, model, cache, opts = {}) {
  const key = `${suiteName}::${model}`;
  if (cache?.has(key)) return cache.get(key);
  const result = await runSuiteRepeated(
    runner, suiteName, model,
    opts.repeats ?? DEFAULT_REPEATS,
    opts.onProgress,
    opts.between,
  );
  cache?.set(key, result);
  return result;
}

/**
 * Spustí jednu sadu na obou modelech a porovná ji úlohu po úloze.
 *
 * @param {Object} runner - ValidationRunner
 * @param {string} suiteName
 * @param {string} candidate
 * @param {string} incumbent
 * @returns {Promise<{suite, tasks, discriminating, candidateWins, incumbentWins, margin, inconclusive}>}
 */
export async function comparePair(runner, suiteName, candidate, incumbent, opts = {}) {
  const suite = SUITES[suiteName];
  if (!suite) throw new Error(`Neznámá validační sada: ${suiteName}`);

  const cache = opts.suiteCache;
  const candidateCached = cache?.has(`${suiteName}::${candidate}`);
  const incumbentCached = cache?.has(`${suiteName}::${incumbent}`);

  // Pořadí je záměrné: oba modely projdou tutéž sadu, ale každý zvlášť, aby
  // se nepřetahovaly o VRAM. Kdo je rezidentní, ovlivňuje výsledek — změřeno
  // na `qwen3.5:27b`, který vedle jiného modelu vyšel jako přetékající.
  const candidateRun = await runSuiteCached(runner, suiteName, candidate, cache, opts);
  // Uvolnit paměť má smysl jen když se druhý model bude skutečně spouštět.
  if (opts.between && !incumbentCached && !candidateCached) await opts.between();
  const incumbentRun = await runSuiteCached(runner, suiteName, incumbent, cache, opts);

  const byName = new Map(incumbentRun.tasks.map(t => [t.name, t]));
  const tasks = [];
  for (const c of candidateRun.tasks) {
    const i = byName.get(c.name);
    if (!i) continue;
    const delta = c.mean - i.mean;
    // Úloha rozlišuje jen tehdy, když je rozdíl větší než vlastní nestabilita
    // obou modelů na téže úloze. Jinak by se náhodný přeskok 0↔1 počítal za
    // rozdíl v kvalitě.
    const noise = Math.max(c.spread, i.spread);
    const threshold = Math.max(TASK_MARGIN_EPSILON, noise);
    tasks.push({
      name: c.name,
      candidateScore: Math.round(c.mean * 1000) / 1000,
      incumbentScore: Math.round(i.mean * 1000) / 1000,
      candidateSpread: c.spread,
      incumbentSpread: i.spread,
      delta,
      noise,
      discriminating: Math.abs(delta) > threshold,
    });
  }

  const discriminating = tasks.filter(t => t.discriminating);
  const candidateWins = discriminating.filter(t => t.delta > 0).length;
  const incumbentWins = discriminating.filter(t => t.delta < 0).length;
  const margin = discriminating.length > 0
    ? discriminating.reduce((s, t) => s + t.delta, 0) / discriminating.length
    : 0;

  return {
    suite: suiteName,
    tasks,
    discriminating: discriminating.length,
    candidateWins,
    incumbentWins,
    margin: Math.round(margin * 10000) / 10000,
    inconclusive: discriminating.length === 0,
    candidateSuiteScore: candidateRun.score,
    incumbentSuiteScore: incumbentRun.score,
    repeats: candidateRun.runs,
    unstableTasks: [...new Set([...candidateRun.unstableTasks, ...incumbentRun.unstableTasks])],
  };
}

/**
 * Rozhodne souboj pro jednu roli.
 *
 * Kvalita rozhoduje, dokud rozlišuje.  Když nerozlišuje, rozhodne rychlost —
 * ale jen když je rozdíl výrazný, jinak se stávající model nechává být.
 * Setrvačnost je záměrná: výměna má cenu jen tehdy, když je pro ni důvod.
 *
 * @param {Object} comparison - výstup comparePair
 * @param {Object} speed - { candidate: tok/s, incumbent: tok/s }
 * @param {number} threshold - IMPROVEMENT_THRESHOLD pro roli
 */
export function decideRole(comparison, speed = {}, threshold = 0.05) {
  const { margin, candidateWins, incumbentWins, inconclusive } = comparison;

  if (!inconclusive) {
    if (margin >= threshold && candidateWins > incumbentWins) {
      return {
        winner: 'candidate',
        basis: 'kvalita',
        detail: `marže ${margin.toFixed(3)} ≥ práh ${threshold} na ${comparison.discriminating} rozlišujících úlohách `
          + `(${candidateWins}:${incumbentWins})`,
      };
    }
    if (margin <= -threshold && incumbentWins > candidateWins) {
      return {
        winner: 'incumbent',
        basis: 'kvalita',
        detail: `kandidát ztrácí ${Math.abs(margin).toFixed(3)} na ${comparison.discriminating} úlohách`,
      };
    }
    return {
      winner: 'incumbent',
      basis: 'kvalita',
      detail: `rozdíl ${margin.toFixed(3)} nedosáhl prahu ${threshold} — stávající zůstává`,
    };
  }

  // Kvalita nerozlišila. Rychlost rozhodne jen při zřetelném rozdílu.
  const c = speed.candidate;
  const i = speed.incumbent;
  if (c > 0 && i > 0) {
    const ratio = c / i;
    if (ratio >= 1.25) {
      return {
        winner: 'candidate',
        basis: 'rychlost',
        detail: `kvalita nerozlišila (všechny úlohy shodné), kandidát je ${ratio.toFixed(2)}× rychlejší `
          + `(${c} vs ${i} tok/s)`,
      };
    }
    return {
      winner: 'incumbent',
      basis: 'nerozhodně',
      detail: `kvalita nerozlišila a rychlost se liší jen ${ratio.toFixed(2)}× — stávající zůstává`,
    };
  }

  return {
    winner: 'incumbent',
    basis: 'nerozhodně',
    detail: 'kvalita nerozlišila a rychlost není změřená',
  };
}

/**
 * Kompletní souboj pro jednu roli: porovná a rozhodne.
 */
export async function trialRole(runner, role, candidate, incumbent, opts = {}) {
  const suiteName = getSuiteForRole(role);
  if (!suiteName) return { role, skipped: true, reason: `role ${role} nemá validační sadu` };

  const comparison = await comparePair(runner, suiteName, candidate, incumbent, opts);
  const decision = decideRole(comparison, opts.speed || {}, opts.threshold ?? 0.05);

  logger.info('PairwiseTrial',
    `${role}: ${candidate} vs ${incumbent} → ${decision.winner} (${decision.basis}) — ${decision.detail}`);

  return { role, suite: suiteName, comparison, decision, skipped: false };
}

export default {
  comparePair, decideRole, trialRole, createSuiteCache,
  TASK_MARGIN_EPSILON, DEFAULT_REPEATS,
};
