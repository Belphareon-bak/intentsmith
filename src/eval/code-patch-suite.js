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

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../core/logger.js';
import { ModelEvaluationRunner } from './model-evaluation-runner.js';
import {
  applyAndTest, buildPrompt, deriveTask, extractFunctionCodes, normalizedGain,
  CODE_EVALUATION_OUTCOME,
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

function taskFromSnapshot(entry) {
  const snapshot = entry?.snapshot;
  const publicContract = snapshot?.publicContract;
  if (publicContract != null && (publicContract.version !== 1
    || !Array.isArray(publicContract.requirements) || !publicContract.requirements.length
    || publicContract.requirements.some(text => typeof text !== 'string' || !text.trim())
    || !Array.isArray(publicContract.sources) || !publicContract.sources.length
    || publicContract.sources.some(text => typeof text !== 'string' || !text.trim()))) {
    throw new Error(`CODE fixture task ${entry?.hash || 'unknown'} has an invalid public contract`);
  }
  const spans = snapshot?.spans;
  if (!Array.isArray(spans) || spans.length === 0
    || !Array.isArray(snapshot.functionTexts)
    || snapshot.functionTexts.length !== spans.length
    || !Array.isArray(snapshot.requirements)) {
    throw new Error(`CODE fixture task ${entry?.hash || 'unknown'} has no complete prompt snapshot`);
  }
  for (const span of spans) {
    if (!Number.isSafeInteger(span.startLine) || !Number.isSafeInteger(span.endLine)
      || span.startLine < 1 || span.endLine < span.startLine
      || typeof span.text !== 'string' || typeof span.header !== 'string') {
      throw new Error(`CODE fixture task ${entry.hash} has an invalid span snapshot`);
    }
  }
  return {
    hash: entry.hash,
    source: entry.source,
    taskFingerprint: entry.taskFingerprint || null,
    oracleCase: entry.oracleCase || entry.taskFingerprint?.slice(0,12),
    test: entry.test,
    tests: [...(entry.tests || [])],
    subject: entry.subject,
    spans: spans.map(span => ({ ...span })),
    functionTexts: [...snapshot.functionTexts],
    functionCount: spans.length,
    functionLines: spans.reduce((sum, span) => sum + span.endLine - span.startLine + 1, 0),
    requirements: [...snapshot.requirements],
    publicContract: publicContract ? structuredClone(publicContract) : null,
    oracleAcceptance: entry.oracleAcceptance || null,
  };
}

export class CodePatchRuntimeError extends Error {
  constructor(task, reason) {
    super(`CODE fixture runtime unavailable for ${task.hash}: ${reason}`);
    this.name = 'CodePatchRuntimeError';
    this.code = 'CODE_FIXTURE_RUNTIME_UNAVAILABLE';
  }
}

function hydrateRuntimeTask(repo, task) {
  const { task: derived, reason } = deriveTask(repo, task);
  if (!derived) throw new CodePatchRuntimeError(task, reason);
  if (buildPrompt(derived) !== buildPrompt(task)) {
    throw new CodePatchRuntimeError(task, 'historical prompt differs from the committed snapshot');
  }
  return {
    ...derived,
    taskFingerprint: task.taskFingerprint,
    oracleCase: task.oracleCase,
    scoreMode: task.scoreMode,
    failToPass: [...(task.failToPass || [])],
    passToPass: [...(task.passToPass || [])],
    knownFailing: [...(task.knownFailing || [])],
    oracleAcceptance: task.oracleAcceptance,
    publicContract: task.publicContract,
  };
}

/** Načte kurátorovanou sadu úloh; chybějící/porušený snapshot fail-close blokuje plán. */
export function loadFixtureTasks(repo = REPO_ROOT, fixturePath = FIXTURE, opts = {}) {
  if (!existsSync(fixturePath)) {
    throw new Error(`CODE fixture chybí (${fixturePath}); spusť build-code-suite.js`);
  }
  let meta;
  try {
    meta = JSON.parse(readFileSync(fixturePath, 'utf8'));
  } catch (err) {
    throw new Error(`CODE fixture se nedá přečíst: ${err.message}`);
  }
  if (meta.fixtureSchemaVersion !== 3) {
    throw new Error(`CODE fixture schema ${meta.fixtureSchemaVersion ?? 'missing'} is not supported`);
  }

  // Po kalibraci se běžně měří jen aktivní úlohy: rezervy jsou buď nad síly
  // celého panelu, nebo pod ním, takže by jen prodlužovaly běh a ředily průměr.
  // `INTENTSMITH_EVAL_INCLUDE_RESERVE=1` je vrátí zpět — na ověření, jestli už silnější
  // model nepřerostl podlahu.
  const includeReserve = opts.includeNonActive === true
    || (process.env.INTENTSMITH_EVAL_INCLUDE_RESERVE ?? process.env['C3_EVAL_INCLUDE_RESERVE']) === '1';
  const onlyPending = opts.onlyPending === true
    || (process.env.INTENTSMITH_EVAL_ONLY_PENDING ?? process.env['C3_EVAL_ONLY_PENDING']) === '1';
  const explicitStatuses = Array.isArray(opts.statuses) ? opts.statuses
    : String((process.env.INTENTSMITH_EVAL_STATUSES ?? process.env['C3_EVAL_STATUSES']) || '').split(',').map(value => value.trim()).filter(Boolean);
  const statusSet = new Set(explicitStatuses);
  const pendingMaxFunctionLines = Number(
    opts.pendingMaxFunctionLines ?? (process.env.INTENTSMITH_EVAL_PENDING_MAX_FUNCTION_LINES ?? process.env['C3_EVAL_PENDING_MAX_FUNCTION_LINES']),
  );

  const tasks = [];
  for (const entry of meta.tasks || []) {
    if (statusSet.size && !statusSet.has(entry.status)) continue;
    if (onlyPending && entry.status !== 'pending-recalibration') continue;
    if (onlyPending && Number.isFinite(pendingMaxFunctionLines)
      && entry.functionLines > pendingMaxFunctionLines) continue;
    // Fail closed: missing/pending/unknown status is not decision evidence.
    if (!statusSet.size && !onlyPending && !includeReserve && entry.status !== 'active') continue;
    const task = taskFromSnapshot(entry);
    // Identita cílových kontrol pochází z kurátorské stavby. Před inferencí
    // ověříme jejich funkčnost na gold/broken/alternative; cíle nepředefinujeme.
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

export function codePatchRuntimeAvailability(repo = REPO_ROOT, tasks = null) {
  const selected = tasks || loadFixtureTasks(repo);
  try {
    for (const task of selected) {
      execFileSync('git', ['-C', repo, 'cat-file', '-e', `${task.hash}^{commit}`], {
        stdio: 'ignore', timeout: 5_000,
      });
      execFileSync('git', ['-C', repo, 'cat-file', '-e', `${task.hash}~1^{commit}`], {
        stdio: 'ignore', timeout: 5_000,
      });
    }
    return Object.freeze({ ready: true, code: null, reason: null });
  } catch {
    return Object.freeze({
      ready: false,
      code: 'CODE_FIXTURE_RUNTIME_UNAVAILABLE',
      reason: 'historical CODE oracle commits are unavailable',
    });
  }
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
  return loaded.map(task => {
    const promptText = buildPrompt(task);
    let runtimeTask = null;
    return {
      name: codeTaskName(task),
      options: MODEL_OPTIONS,
      promptText,
      prepare: () => {
        runtimeTask = hydrateRuntimeTask(repo, task);
        return runtimeTask;
      },
      validateOracle: () => {
        const target = runtimeTask || hydrateRuntimeTask(repo, task);
        const gold = applyAndTest(repo, target, target.goldTexts);
        const broken = applyAndTest(repo, target, target.functionTexts);
        const alternative = target.oracleAcceptance?.alternativeTexts
          ? applyAndTest(repo, target, target.oracleAcceptance.alternativeTexts) : null;
        if (gold.valid !== true || gold.score !== 1 || broken.valid !== true
          || broken.timedOut || broken.score !== 0
          || alternative?.valid !== true || alternative.score < 0.9) {
          throw new CodePatchRuntimeError(task,
            `oracle controls failed: gold=${gold.score}, alternative=${alternative?.score}, broken=${broken.score}; ${gold.reason || alternative?.reason || broken.reason || ''}`);
        }
        return { verified: true, gold: gold.score, alternative: alternative.score, broken: broken.score };
      },
      prompt: () => ({ text: promptText, _task: runtimeTask || task }),
      contractMaterial: Object.freeze({
        prompt: Object.freeze({ kind: 'code-patch', text: promptText }),
        gradingInputs: Object.freeze({
          source: task.source,
          taskFingerprint: task.taskFingerprint,
          oracleCase: task.oracleCase,
          tests: Object.freeze([...(task.tests || [])]),
          spans: Object.freeze((task.spans || []).map(span => Object.freeze({
            kind: span.kind,
            name: span.name,
            startLine: span.startLine,
            endLine: span.endLine,
            header: span.header,
          }))),
          scoreMode: task.scoreMode,
          failToPass: Object.freeze([...(task.failToPass || [])]),
          passToPass: Object.freeze([...(task.passToPass || [])]),
          knownFailing: Object.freeze([...(task.knownFailing || [])]),
          oracleAcceptance: task.oracleAcceptance,
          publicContract: task.publicContract,
        }),
      }),
      grade: (response, ctx) => {
        const target = ctx?._task || runtimeTask;
        if (!target?.beforeFile) {
          throw new CodePatchRuntimeError(task, 'task was not prepared before grading');
        }
        const codes = extractFunctionCodes(response, target.spans);
        const result = applyAndTest(repo, target, codes);
        // Podlaha je z definice nula: test, který procházel i před opravou, není
        // cílový.  `normalizedGain` tak jen ořízne případné zhoršení na nulu.
        const gain = result.valid ? normalizedGain(result.score, 0) : null;
        return {
          valid: result.valid,
          outcome: result.outcome,
          timedOut: result.timedOut,
          passed: result.passed,
          score: gain,
          // Diagnostika: odlišuje „nepochopil vadu" od „nezvládl tvar odpovědi".
          detail: {
            rawScore: result.score,
            valid: result.valid,
            outcome: result.outcome,
            timedOut: result.timedOut,
            syntaxOk: result.syntaxOk,
            applied: result.applied,
            targetedPassed: result.targetedPassed,
            targeted: result.targeted,
            regressions: result.regressions?.length ?? 0,
            regressionNames: result.regressions || [],
            testFiles: target.tests || [target.test].filter(Boolean),
            targetNames: target.failToPass || [],
            testOutput: result.output || null,
            contractChecks: result.contractChecks || null,
            reason: result.reason,
          },
        };
      },
    };
  });
}

/**
 * Runner s vlastními parametry volání.
 *
 * Výchozí hodnoty runneru jsou `num_ctx` 4096, `num_predict` 512 a timeout
 * 120 s. Vadná
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
  async runSuite(suiteName, modelName, onProgress, expectedArtifact = null) {
    if (suiteName !== this._suite.name) {
      return super.runSuite(suiteName, modelName, onProgress, expectedArtifact);
    }

    this._cancelled = false;
    const startTime = Date.now();
    const tests = [];
    let passedCount = 0;
    let totalScore = 0;

    const defs = this._suite.tests;
    // Resolve every historical oracle before the first provider call. Missing
    // git history is infrastructure BLOCKED, never a zero-quality model run.
    for (const definition of defs) {
      definition.prepare?.();
      definition.validateOracle?.();
    }
    for (let i = 0; i < defs.length; i++) {
      if (this._cancelled) break;
      onProgress?.({
        suite: suiteName, testName: defs[i].name, status: 'running',
        currentTest: i + 1, totalTests: defs.length,
        percent: Math.round((i / defs.length) * 100),
      });
      const result = await this._runTest(defs[i], modelName, expectedArtifact);
      tests.push(result);
      if (result.passed) passedCount++;
      if (result.valid !== false) totalScore += result.score;
    }

    const valid = !this._cancelled && tests.length === defs.length
      && tests.every(result => result.valid !== false);
    const score = valid && defs.length ? totalScore / defs.length : null;
    onProgress?.({
      suite: suiteName, testName: null, status: 'complete',
      currentTest: tests.length, totalTests: defs.length,
      percent: Math.round(tests.length / (defs.length || 1) * 100), score,
    });

    return {
      suite: suiteName, model: modelName, score,
      passed: passedCount, total: defs.length, tests,
      valid, cancelled: this._cancelled,
      durationMs: Date.now() - startTime,
    };
  }

  async _runTest(testDef, modelName, expectedArtifact = null) {
    const promptResult = testDef.prompt();
    const result = await this._callModel(
      modelName,
      [{ role: 'user', content: promptResult.text }],
      testDef.options || {},
      expectedArtifact,
    );

    if (result.error) {
      return {
        name: testDef.name, passed: false, score: null, valid: false,
        outcome: CODE_EVALUATION_OUTCOME.ENVIRONMENT_INVALID, response: '',
        durationMs: result.durationMs, evalTokens: 0, error: result.error, timedOut: !!result.timedOut,
      };
    }

    const gradingStarted = Date.now();
    const graded = testDef.grade(result.content, promptResult);
    return {
      name: testDef.name,
      valid: graded.valid !== false,
      outcome: graded.outcome || (graded.passed ? CODE_EVALUATION_OUTCOME.SUCCESS : CODE_EVALUATION_OUTCOME.INCORRECT),
      timedOut: !!graded.timedOut,
      error: graded.valid === false ? 'CODE_ENVIRONMENT_INVALID' : null,
      passed: graded.passed,
      score: graded.score,
      // Preserve the complete patch for independent oracle replay. The old
      // 500-character preview truncated almost every nontrivial CODE answer.
      response: result.content,
      durationMs: result.durationMs,
      evalTokens: result.evalCount,
      detail: { ...(graded.detail || {}), gradingDurationMs: Date.now() - gradingStarted },
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

export { taskFromSnapshot };

export default { codePatchSuite, buildTests, loadFixtureTasks, MODEL_OPTIONS };
