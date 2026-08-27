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
//   - když nerozlišuje dost úloh, výsledek je explicitně INCONCLUSIVE. Rychlost
//     je provozní metrika, ne náhradní důkaz kvality ani důvod k aktivaci.
//
// ══════════════════════════════════════════════════════════════════════════════

import { logger } from '../core/logger.js';

/** O kolik musí kandidát vést v marži, aby se to počítalo za rozdíl na úloze. */
export const TASK_MARGIN_EPSILON = 0.05;

// Historical panel summaries intentionally store task means to three decimal
// places. A rounded 0.333 must not beat an exact 2/3 noise boundary merely
// because 1 - 0.333 is a few ten-thousandths larger than 0.666666....
const SCORE_ROUNDING_EPSILON = 0.0005;
export const MODEL_EVALUATION_DECISION_POLICY_VERSION = 'role-pairwise-v1';
export const MODEL_EVALUATION_DECISION_REASON = Object.freeze({
  CANDIDATE_QUALITY: 'CANDIDATE_QUALITY',
  INCUMBENT_QUALITY: 'INCUMBENT_QUALITY',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',
  QUALITY_INCONCLUSIVE: 'QUALITY_INCONCLUSIVE',
});

export function decisionPolicyForRole(plan, threshold = 0.05) {
  if (!plan?.role || !plan?.suiteContractSha256) {
    throw new TypeError('decision policy requires a current role evaluation plan');
  }
  return Object.freeze({
    version: MODEL_EVALUATION_DECISION_POLICY_VERSION,
    role: plan.role,
    suiteName: plan.suiteName,
    suiteVersion: plan.suiteVersion,
    suiteContractSha256: plan.suiteContractSha256,
    repeats: plan.repeats,
    taskMarginEpsilon: TASK_MARGIN_EPSILON,
    scoreRoundingEpsilon: SCORE_ROUNDING_EPSILON,
    improvementThreshold: threshold,
    minimumDiscriminatingTasks: plan.minimumDiscriminatingTasks || 0,
    minimumDiscriminatingByLanguage: Object.freeze({
      ...(plan.minimumDiscriminatingByLanguage || {}),
    }),
  });
}

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
 * Role mohou sdílet zdrojovou sadu, ale výsledek je vždy role-specific
 * evidence. Cache proto zahrnuje roli, přesný kontrakt a model. D1, D2 a R1
 * si nesmějí vzájemně promítat ani čerstvě naměřený výsledek.
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
  const started = Date.now();
  const runs = [];
  for (let i = 0; i < repeats; i++) {
    if (i > 0 && between) await between();
    runs.push(await runner.runSuite(suiteName, model, onProgress));
  }

  const byTask = new Map();
  for (const run of runs) {
    for (const t of run.tests) {
      if (!byTask.has(t.name)) {
        byTask.set(t.name, {
          scores: [], responses: [], details: [], rubric: t.rubric || [],
          language: t.language || null,
        });
      }
      const row = byTask.get(t.name);
      row.scores.push(t.score ?? 0);
      row.responses.push(t.response || '');
      row.details.push(t.detail || null);
    }
  }

  const tasks = [...byTask.entries()].map(([name, row]) => ({
    name,
    mean: row.scores.reduce((a, b) => a + b, 0) / row.scores.length,
    spread: Math.max(...row.scores) - Math.min(...row.scores),
    scores: row.scores,
    responses: row.responses,
    details: row.details,
    rubric: row.rubric,
    language: row.language,
  }));

  return {
    suite: suiteName,
    model,
    runs: runs.length,
    tasks,
    score: tasks.reduce((s, t) => s + t.mean, 0) / (tasks.length || 1),
    unstableTasks: tasks.filter(t => t.spread > 0).map(t => t.name),
    durationMs: Date.now() - started,
    reused: false,
  };
}

function cacheKey(suiteName, model, opts = {}) {
  return `${String(opts.role || 'missing-role').toUpperCase()}::${suiteName}`
    + `::${opts.suiteContractSha256 || 'missing-contract'}::${model}`;
}

async function runSuiteCached(runner, suiteName, model, cache, opts = {}) {
  const key = cacheKey(suiteName, model, opts);
  if (cache?.has(key)) return cache.get(key);

  if (typeof opts.loadHistoricalSummary === 'function') {
    const historical = await opts.loadHistoricalSummary({
      role: opts.role || null,
      suiteName,
      suiteVersion: opts.suiteVersion || 'unversioned',
      suiteContractSha256: opts.suiteContractSha256 || null,
      model,
      repeats: opts.repeats ?? DEFAULT_REPEATS,
    });
    if (historical) {
      const reused = { ...historical, suite: suiteName, model, reused: true };
      cache?.set(key, reused);
      return reused;
    }
  }

  const result = await runSuiteRepeated(
    runner, suiteName, model,
    opts.repeats ?? DEFAULT_REPEATS,
    opts.onProgress,
    opts.between,
  );
  if (typeof opts.saveHistoricalSummary === 'function') {
    const saved = await opts.saveHistoricalSummary({
      role: opts.role || null,
      suiteName,
      suiteVersion: opts.suiteVersion || 'unversioned',
      suiteContractSha256: opts.suiteContractSha256 || null,
      model,
      summary: result,
    });
    if (saved?.runId) result.historyRunId = saved.runId;
  }
  cache?.set(key, result);
  return result;
}

/**
 * Spustí jednu sadu na obou modelech a porovná ji úlohu po úloze.
 *
 * @param {Object} runner - ModelEvaluationRunner-compatible runner
 * @param {string} suiteName
 * @param {string} candidate
 * @param {string} incumbent
 * @returns {Promise<{suite, tasks, discriminating, candidateWins, incumbentWins, margin, inconclusive}>}
 */
export async function comparePair(runner, suiteName, candidate, incumbent, opts = {}) {
  // Suite resolution belongs to the injected runner. Runtime callers reach
  // this function through trialRole(), which requires an explicit current
  // evaluation plan; unit runners may expose their own deterministic suites.

  const cache = opts.suiteCache;
  const candidateCached = cache?.has(cacheKey(suiteName, candidate, opts));
  const incumbentCached = cache?.has(cacheKey(suiteName, incumbent, opts));

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
      language: c.language || i.language || null,
      candidateScore: Math.round(c.mean * 1000) / 1000,
      incumbentScore: Math.round(i.mean * 1000) / 1000,
      candidateSpread: c.spread,
      incumbentSpread: i.spread,
      delta,
      noise,
      discriminating: Math.abs(delta) > threshold + SCORE_ROUNDING_EPSILON,
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
    candidateRunId: candidateRun.historyRunId || null,
    incumbentRunId: incumbentRun.historyRunId || null,
    repeats: candidateRun.runs,
    unstableTasks: [...new Set([...candidateRun.unstableTasks, ...incumbentRun.unstableTasks])],
  };
}

/**
 * Rozhodne souboj pro jednu roli.
 *
 * Kvalita rozhoduje jen nad explicitním důkazním minimem. Když sada
 * nerozlišuje, výsledek zůstává nerozhodný; propustnost se nesmí stát skrytou
 * náhradní aktivační politikou.
 *
 * @param {Object} comparison - výstup comparePair
 * @param {number} threshold - IMPROVEMENT_THRESHOLD pro roli
 */
export function decideRole(comparison, _speed = {}, threshold = 0.05, evidence = {}) {
  const { margin, candidateWins, incumbentWins, inconclusive } = comparison;

  const minimumTotal = Math.max(0, Number(evidence.minimumDiscriminatingTasks) || 0);
  const languageMinimums = evidence.minimumDiscriminatingByLanguage || {};
  const discriminatingRows = (comparison.tasks || []).filter(task => task.discriminating);
  const byLanguage = Object.fromEntries(Object.keys(languageMinimums).map(language => [
    language,
    discriminatingRows.filter(task => task.language === language).length,
  ]));
  const missingTotal = comparison.discriminating < minimumTotal;
  const missingLanguages = Object.entries(languageMinimums)
    .filter(([language, minimum]) => (byLanguage[language] || 0) < minimum);
  if (missingTotal || missingLanguages.length) {
    const requirements = [
      minimumTotal ? `${comparison.discriminating}/${minimumTotal} celkem` : null,
      ...Object.entries(languageMinimums).map(([language, minimum]) => (
        `${language} ${byLanguage[language] || 0}/${minimum}`
      )),
    ].filter(Boolean).join(', ');
    return {
      winner: 'incumbent',
      reasonCode: MODEL_EVALUATION_DECISION_REASON.INSUFFICIENT_EVIDENCE,
      basis: 'nedostatečný důkaz',
      confidence: 'nedostatečná',
      detail: `rozhodnutí kandidáta zablokováno: stabilně rozlišující úlohy ${requirements}`,
    };
  }

  // Rozhodnutí opřené o jedinou úlohu je jedno pozorování, ne trend. Signál se
  // nezahazuje — úloha stabilní přes tři běhy nese informaci — ale operátor má
  // vidět, jak široký podklad za rozhodnutím stojí.
  const confidence = comparison.discriminating >= 3 ? 'vysoká'
    : comparison.discriminating === 2 ? 'střední'
      : comparison.discriminating === 1 ? 'nízká (jediná úloha)' : 'žádná';

  if (!inconclusive) {
    if (margin >= threshold && candidateWins > incumbentWins) {
      return {
        winner: 'candidate',
        reasonCode: MODEL_EVALUATION_DECISION_REASON.CANDIDATE_QUALITY,
        basis: 'kvalita',
        confidence,
        detail: `marže ${margin.toFixed(3)} ≥ práh ${threshold} na ${comparison.discriminating} rozlišujících úlohách `
          + `(${candidateWins}:${incumbentWins}), jistota ${confidence}`,
      };
    }
    if (margin <= -threshold && incumbentWins > candidateWins) {
      return {
        winner: 'incumbent',
        reasonCode: MODEL_EVALUATION_DECISION_REASON.INCUMBENT_QUALITY,
        basis: 'kvalita',
        confidence,
        detail: `kandidát ztrácí ${Math.abs(margin).toFixed(3)} na ${comparison.discriminating} úlohách, jistota ${confidence}`,
      };
    }
    if (margin >= threshold && candidateWins <= incumbentWins) {
      return {
        winner: 'incumbent',
        reasonCode: MODEL_EVALUATION_DECISION_REASON.INCUMBENT_QUALITY,
        basis: 'kvalita',
        confidence,
        detail: `marže ${margin.toFixed(3)} splnila práh ${threshold}, ale poměr rozlišujících úloh `
          + `${candidateWins}:${incumbentWins} nepotvrdil většinu kandidáta — stávající zůstává`,
      };
    }
    return {
      winner: 'incumbent',
      reasonCode: MODEL_EVALUATION_DECISION_REASON.INCUMBENT_QUALITY,
      basis: 'kvalita',
      detail: `rozdíl ${margin.toFixed(3)} nedosáhl prahu ${threshold} — stávající zůstává`,
    };
  }

  return {
    winner: 'incumbent',
    reasonCode: MODEL_EVALUATION_DECISION_REASON.QUALITY_INCONCLUSIVE,
    basis: 'nerozhodně',
    detail: 'kvalita nerozlišila; rychlost není náhradní kvalitativní důkaz',
  };
}

/**
 * Kompletní souboj pro jednu roli: porovná a rozhodne.
 */
export async function trialRole(runner, role, candidate, incumbent, opts = {}) {
  const plan = opts.evaluationPlan || null;
  if (!plan) {
    return { role, skipped: true, reason: `role ${role} nemá explicitní current evaluation plan` };
  }
  const suiteName = plan.suiteName;

  const threshold = opts.threshold ?? 0.05;
  const policy = decisionPolicyForRole(plan, threshold);
  const comparison = await comparePair(runner, suiteName, candidate, incumbent, {
    ...opts,
    role,
    suite: plan?.suite || opts.suite,
    suiteVersion: plan?.suiteVersion || opts.suiteVersion,
    suiteContractSha256: plan?.suiteContractSha256 || opts.suiteContractSha256,
  });
  const decision = decideRole(comparison, {}, threshold, {
    minimumDiscriminatingTasks: plan?.minimumDiscriminatingTasks
      ?? opts.minimumDiscriminatingTasks,
    minimumDiscriminatingByLanguage: plan?.minimumDiscriminatingByLanguage
      ?? opts.minimumDiscriminatingByLanguage,
  });

  logger.info('PairwiseTrial',
    `${role}: ${candidate} vs ${incumbent} → ${decision.winner} (${decision.basis}) — ${decision.detail}`);

  return { role, suite: suiteName, policy, comparison, decision, skipped: false };
}

export default {
  comparePair, decideRole, trialRole, createSuiteCache,
  TASK_MARGIN_EPSILON, DEFAULT_REPEATS, MODEL_EVALUATION_DECISION_REASON,
  MODEL_EVALUATION_DECISION_POLICY_VERSION, decisionPolicyForRole,
};
