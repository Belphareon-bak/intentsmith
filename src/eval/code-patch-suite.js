// Code Patch Suite — sada CODE, kde o skóre rozhoduje spuštěný test
// ══════════════════════════════════════════════════════════════════════════════
//
// Vztah ke staré sadě `code`:
//
// Sada `code` hodnotí klíčovými slovy a měří tvar odpovědi, ne schopnost.
// Změřeno 2026-08-19: `llava:13b`, tedy vision model, v ní dostal 100 %, a
// nefunkční `isPrime` dostal 1.0 za to, že obsahoval `return` a cyklus.  Osm
// z 36 úloh dávalo všem modelům 100 %, takže souboj na roli CODE končil
// nerozhodně a 2026-08-19 se zablokoval.
//
// `code_patch` se ptá jinak: vezme skutečnou vadu z historie repa, dá modelu
// vadnou funkci a popis požadovaného chování, jeho odpověď vloží zpátky do
// souboru a **spustí skryté testy**. Skóre je podíl opravených cílových
// kontrol `0..1`; nová regrese skóre vynuluje. Klíčová slova v hodnocení
// nejsou — hodnotí skutečný výstup `node tests/….test.js`.
//
// Sada se registruje pod novým jménem a sama **nemutuje vazbu role CODE**.
// Hunt ji pro CODE předává explicitním evaluation planem, uloží evidence a
// portfolio decision, ale nikdy binding neaplikuje.
//
// Sada se do souboje předává explicitně v role evaluation planu. Neexistuje
// globální mutable registr ani fallback na odstraněnou v123 scoring cestu.
//
// ══════════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../core/logger.js';
import { ModelEvaluationRunner } from './model-evaluation-runner.js';
import {
  deriveTask, buildPrompt, extractFunctionCodes, applyAndTest, normalizedGain,
} from './code-patch-runner.js';
import { codeTaskName } from './build-code-suite.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const FIXTURE = path.join(HERE, 'code-suite-tasks.json');

/**
 * Časový strop na generování.
 *
 * Obecný 30s limit nestačí: funkce o 228 řádcích si
 * vyžádá skoro 2000 tokenů odpovědi a při studeném načtení modelu do VRAM to
 * změřeně trvalo 122 s.  Strop musí pokrýt načtení i generování, jinak by se
 * jako „selhání modelu" počítalo vypršení našeho vlastního limitu.
 */
const GENERATION_TIMEOUT_MS = 300_000;

export const MODEL_OPTIONS = {
  timeout: GENERATION_TIMEOUT_MS,
  num_predict: 4096,
  num_ctx: 16384,     // vadná funkce + zadání se musí vejít i u delších funkcí
  temperature: 0.1,
};

/** Načte kurátorovanou sadu úloh; bez fixture je sada prázdná, ne rozbitá. */
export function loadFixtureTasks(repo = REPO_ROOT, fixturePath = FIXTURE, opts = {}) {
  if (!existsSync(fixturePath)) {
    logger.warn('CodePatchSuite', `fixture chybí (${fixturePath}) — sada bude prázdná; spusť build-code-suite.js`);
    return [];
  }
  let meta;
  try {
    meta = JSON.parse(readFileSync(fixturePath, 'utf8'));
  } catch (err) {
    logger.warn('CodePatchSuite', `fixture se nedá přečíst: ${err.message}`);
    return [];
  }

  // Po kalibraci se běžně měří jen aktivní úlohy: rezervy jsou buď nad síly
  // celého panelu, nebo pod ním, takže by jen prodlužovaly běh a ředily průměr.
  // `C3_EVAL_INCLUDE_RESERVE=1` je vrátí zpět — na ověření, jestli už silnější
  // model nepřerostl podlahu.
  const includeReserve = opts.includeNonActive === true
    || process.env.C3_EVAL_INCLUDE_RESERVE === '1';
  const onlyPending = opts.onlyPending === true
    || process.env.C3_EVAL_ONLY_PENDING === '1';
  const explicitStatuses = Array.isArray(opts.statuses) ? opts.statuses
    : String(process.env.C3_EVAL_STATUSES || '').split(',').map(value => value.trim()).filter(Boolean);
  const statusSet = new Set(explicitStatuses);
  const pendingMaxFunctionLines = Number(
    opts.pendingMaxFunctionLines ?? process.env.C3_EVAL_PENDING_MAX_FUNCTION_LINES,
  );

  const tasks = [];
  for (const entry of meta.tasks || []) {
    if (statusSet.size && !statusSet.has(entry.status)) continue;
    if (onlyPending && entry.status !== 'pending-recalibration') continue;
    if (onlyPending && Number.isFinite(pendingMaxFunctionLines)
      && entry.functionLines > pendingMaxFunctionLines) continue;
    // Fail closed: missing/pending/unknown status is not decision evidence.
    if (!statusSet.size && !onlyPending && !includeReserve && entry.status !== 'active') continue;
    const { task, reason } = deriveTask(repo, entry);
    if (!task) {
      // Historie se přepsala (rebase, squash) — úloha se přestala odvozovat.
      logger.warn('CodePatchSuite', `úloha ${entry.hash?.slice(0, 8)} vypadla: ${reason}`);
      continue;
    }
    // Cílové sady jsou odvozené při kurátorské stavbě; přeměřovat je při každém
    // běhu by znamenalo dva testovací běhy navíc na úlohu a nic by to nepřineslo.
    task.scoreMode = entry.scoreMode || 'named';
    task.failToPass = entry.failToPass || [];
    task.passToPass = entry.passToPass || [];
    task.knownFailing = entry.knownFailing || [];
    if (entry.scoreMode !== 'file' && !task.failToPass.length) {
      logger.warn('CodePatchSuite', `úloha ${entry.hash?.slice(0, 8)} přišla o cílové testy — přeskočena`);
      continue;
    }
    tasks.push(task);
  }
  return tasks;
}

/**
 * Postaví testy sady ve tvaru, kterému rozumí `ModelEvaluationRunner`.
 *
 * `grade()` je záměrně synchronní — `applyAndTest()` stojí na `execFileSync`,
 * takže se vejde do stávajícího rozhraní a runner se kvůli téhle sadě nemusí
 * předělávat na asynchronní hodnocení.
 */
export function buildTests(repo = REPO_ROOT, tasks = null) {
  const loaded = tasks || loadFixtureTasks(repo);
  return loaded.map(task => ({
    name: codeTaskName(task),
    options: MODEL_OPTIONS,
    prompt: () => ({ text: buildPrompt(task), _task: task }),
    grade: (response, ctx) => {
      const target = ctx?._task || task;
      const codes = extractFunctionCodes(response, target.spans);
      const result = applyAndTest(repo, target, codes);
      // Podlaha je z definice nula: test, který procházel i před opravou, není
      // cílový.  `normalizedGain` tak jen ořízne případné zhoršení na nulu.
      const gain = normalizedGain(result.score, 0);
      return {
        passed: result.passed,
        score: gain,
        // Diagnostika: odlišuje „nepochopil vadu" od „nezvládl tvar odpovědi".
        detail: {
          rawScore: result.score,
          syntaxOk: result.syntaxOk,
          applied: result.applied,
          targetedPassed: result.targetedPassed,
          targeted: result.targeted,
          regressions: result.regressions?.length ?? 0,
          reason: result.reason,
        },
      };
    },
  }));
}

/**
 * Runner s vlastními parametry volání.
 *
 * Výchozí hodnoty runneru jsou `num_ctx` 4096, `num_predict` 512 a timeout
 * 30 s. Vadná
 * funkce se do 4096 tokenů nevejde, odpověď se do 512 tokenů nevejde a studené
 * načtení modelu s 2000 tokeny odpovědi trvalo změřeně 122 s.  Bez vlastních
 * parametrů by se tedy jako „selhání modelu" počítalo uříznuté generování.
 */
export class CodePatchEvaluationRunner extends ModelEvaluationRunner {
  constructor(baseUrl, suiteDef) {
    const selected = suiteDef || codePatchSuite;
    super(baseUrl, { suites: { [selected.name]: selected } });
    this._suite = selected;
  }

  /**
   * Runner nese explicitní suite contract; neexistuje globální fallback.
   */
  async runSuite(suiteName, modelName, onProgress) {
    if (suiteName !== this._suite.name) return super.runSuite(suiteName, modelName, onProgress);

    this._cancelled = false;
    const startTime = Date.now();
    const tests = [];
    let passedCount = 0;
    let totalScore = 0;

    const defs = this._suite.tests;
    for (let i = 0; i < defs.length; i++) {
      if (this._cancelled) break;
      onProgress?.({
        suite: suiteName, testName: defs[i].name, status: 'running',
        currentTest: i + 1, totalTests: defs.length,
        percent: Math.round((i / defs.length) * 100),
      });
      const result = await this._runTest(defs[i], modelName);
      tests.push(result);
      if (result.passed) passedCount++;
      totalScore += result.score;
    }

    const score = defs.length ? totalScore / defs.length : 0;
    onProgress?.({
      suite: suiteName, testName: null, status: 'complete',
      currentTest: defs.length, totalTests: defs.length, percent: 100, score,
    });

    return {
      suite: suiteName, model: modelName, score,
      passed: passedCount, total: defs.length, tests,
      durationMs: Date.now() - startTime,
    };
  }

  async _runTest(testDef, modelName) {
    const promptResult = testDef.prompt();
    const result = await this._callModel(
      modelName,
      [{ role: 'user', content: promptResult.text }],
      testDef.options || {},
    );

    if (result.error) {
      return {
        name: testDef.name, passed: false, score: 0, response: '',
        durationMs: result.durationMs, evalTokens: 0, error: result.error,
      };
    }

    const graded = testDef.grade(result.content, promptResult);
    return {
      name: testDef.name,
      passed: graded.passed,
      score: graded.score,
      response: result.content.substring(0, 500),
      durationMs: result.durationMs,
      evalTokens: result.evalCount,
      detail: graded.detail,
    };
  }
}

let _tests = null;

/** Current CODE suite. Testy se staví líně — odvození sahá do gitu. */
export const codePatchSuite = {
  name: 'code_patch',
  description: 'Oprava skutečné vady z historie repa, ověřená spuštěním skrytého testu',
  roles: [],   // vazbu role potvrzuje operátor ručně, viz hlavička
  get tests() {
    if (!_tests) _tests = buildTests();
    return _tests;
  },
};

/** Pro testy — zahodí načtenou sadu, aby se dala postavit znovu. */
export function _resetTests() { _tests = null; }

export default { codePatchSuite, buildTests, loadFixtureTasks, MODEL_OPTIONS };
