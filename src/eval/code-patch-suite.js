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
// souboru a **spustí skrytý test**.  Skóre je 1 nebo 0 podle toho, jestli test
// prošel.  Klíčová slova v hodnocení nejsou — hodnotí `node tests/….test.js`.
//
// Sada se registruje pod novým jménem a **nepřebírá vazbu role CODE**.
// `model-profiles.js` je připnutý bajtovým hashem ve fail-closed proof policy
// a vazby rolí se nemění automaticky — přepnutí role na tuhle sadu je ruční
// rozhodnutí operátora, ne vedlejší efekt téhle změny.
//
// ══════════════════════════════════════════════════════════════════════════════

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../core/logger.js';
import {
  deriveTask, buildPrompt, extractFunctionCodes, applyAndTest, normalizedGain,
} from './code-patch-runner.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const FIXTURE = path.join(HERE, 'code-suite-tasks.json');

/**
 * Časový strop na generování.
 *
 * Výchozích 30 s ze `validation-suites.js` nestačí: funkce o 228 řádcích si
 * vyžádá skoro 2000 tokenů odpovědi a při studeném načtení modelu do VRAM to
 * změřeně trvalo 122 s.  Strop musí pokrýt načtení i generování, jinak by se
 * jako „selhání modelu" počítalo vypršení našeho vlastního limitu.
 */
const GENERATION_TIMEOUT_MS = 300_000;

const MODEL_OPTIONS = {
  timeout: GENERATION_TIMEOUT_MS,
  num_predict: 4096,
  num_ctx: 16384,     // vadná funkce + zadání se musí vejít i u delších funkcí
  temperature: 0.1,
};

/** Načte kurátorovanou sadu úloh; bez fixture je sada prázdná, ne rozbitá. */
export function loadFixtureTasks(repo = REPO_ROOT, fixturePath = FIXTURE) {
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
  const includeReserve = process.env.C3_EVAL_INCLUDE_RESERVE === '1';

  const tasks = [];
  for (const entry of meta.tasks || []) {
    if (!includeReserve && entry.status && entry.status !== 'active') continue;
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
 * Postaví testy sady ve tvaru, kterému rozumí `ValidationRunner`.
 *
 * `grade()` je záměrně synchronní — `applyAndTest()` stojí na `execFileSync`,
 * takže se vejde do stávajícího rozhraní a runner se kvůli téhle sadě nemusí
 * předělávat na asynchronní hodnocení.
 */
export function buildTests(repo = REPO_ROOT, tasks = null) {
  const loaded = tasks || loadFixtureTasks(repo);
  return loaded.map(task => ({
    name: `patch_${task.hash.slice(0, 8)}`,
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

let _tests = null;

/** Sada pro registraci v `SUITES`. Testy se staví líně — odvození sahá do gitu. */
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
