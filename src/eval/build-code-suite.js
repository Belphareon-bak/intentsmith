#!/usr/bin/env node
// Build Code Suite — vykurátoruje sadu CODE úloh z historie repa
// ══════════════════════════════════════════════════════════════════════════════
//
// Spouští se ručně, výstup se commituje:
//
//     node src/eval/build-code-suite.js [--max-function-lines 120] [--limit 1500]
//     node src/eval/build-code-suite.js --append --count 40 [...stejne filtry...]
//
// Fixture drží jen **metadata** — hash, cestu ke zdrojáku, cestu k testu a
// předmět commitu.  Zdrojový kód se nekopíruje: `deriveTask()` si ho v okamžiku
// evaluace vytáhne přes `git show`, což trvá jednotky milisekund a nezanáší do
// repa stovky kilobajtů duplikátů.
//
// Kurátorský filtr má čtyři síta a každé z nich něco vyřazuje:
//
//   1. jeden zdroják v commitu                 — jinak není jasné, co opravit
//   2. změna se dá přiřadit úsekům souboru    — funkcím i vrcholovým konstrukcím
//   3. úseky do N řádků dohromady             — delší se generují minuty
//   4. test padá před opravou, prochází s gold patchem, **ve stejné izolaci**
//      jako pak poběží odpověď modelu
//
// Čtvrté síto je to podstatné: co jím projde, je zaručeně řešitelné a měřitelné.
//
// ─── Proč se kandidáti řadí, a ne berou popořadě ────────────────────────────
//
// Úloha s **jediným** cílovým testem umí dát jen 0, nebo 1 — žádnou mezipolohu,
// takže o modelech mezi podlahou a stropem neřekne nic.  `a33cc20a` rozlišila
// právě proto, že má tři cíle a šlo dát 0,33.  Kolik cílů úloha bude mít, se
// s jistotou pozná až po ověření, ale počet testů, které commit přidal, je
// levný a těsný odhad — `deriveTask()` ho vrací jako `requirements` a testy
// se nespouští.  Ověřuje se proto v pořadí podle něj, ne podle stáří commitu.
//
// ══════════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCandidates } from './code-task-extractor.js';
import { buildPrompt, deriveTask, verifyTask } from './code-patch-runner.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = path.join(HERE, 'code-suite-tasks.json');
export const CODE_TASK_CONTRACT_VERSION = 'code-task-v2';

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * Stable runtime identity of one patch task.
 *
 * A commit hash is not enough in multi-source mode: one commit can yield
 * several independently verified source-file tasks.  Prefer the complete
 * contract fingerprint; retain a deterministic fallback for older fixtures.
 */
export function codeTaskName(task) {
  const fingerprint = String(task?.taskFingerprint || '').toLowerCase();
  if (/^[0-9a-f]{64}$/.test(fingerprint)) return `patch_${fingerprint.slice(0, 12)}`;
  const hash = String(task?.hash || '').slice(0, 8);
  if (task?.source) return `patch_${hash}_${digest(String(task.source)).slice(0, 8)}`;
  return `patch_${hash}`;
}

export function taskFingerprint(task, verdict) {
  return digest({
    version: CODE_TASK_CONTRACT_VERSION,
    hash: task.hash,
    source: task.source,
    tests: task.tests,
    prompt: buildPrompt(task),
    scoreMode: verdict.scoreMode,
    failToPass: verdict.failToPass,
    passToPass: verdict.passToPass,
    knownFailing: verdict.knownFailing,
  });
}

export function preserveCalibration(tasks, previous = null) {
  const byFingerprint = new Map((previous?.tasks || [])
    .filter(task => task.taskFingerprint)
    .map(task => [task.taskFingerprint, task]));
  return tasks.map(task => {
    const old = byFingerprint.get(task.taskFingerprint);
    if (old?.calibration && old?.status) {
      return { ...task, status: old.status, calibration: old.calibration };
    }
    return { ...task, status: 'pending-recalibration', calibration: null };
  });
}

function taskSourceKey(task) {
  return `${String(task?.hash || '')}\0${String(task?.source || '')}`;
}

/**
 * Verified tasks are durable supply, not a disposable sample of the latest
 * rebuild.  A rebuild under the same task contract must retain them.  Across
 * a contract change they cannot be reused as measured truth, but every drop
 * must remain visible in `rejected` with an exact reason.
 */
export function reconcileVerifiedTaskSupply(tasks, rejected, previous = null,
  contractVersion = CODE_TASK_CONTRACT_VERSION) {
  const nextTasks = [...tasks];
  const nextRejected = [...rejected];
  const keys = new Set(nextTasks.map(taskSourceKey));
  const sameContract = previous?.taskContractVersion === contractVersion;

  for (const old of previous?.tasks || []) {
    const key = taskSourceKey(old);
    if (keys.has(key)) continue;
    if (sameContract && old.taskFingerprint) {
      nextTasks.push(old);
      keys.add(key);
      continue;
    }
    nextRejected.push({
      hash: old.hash,
      source: old.source,
      reason: `předchozí gold úloha nebyla znovu ověřena po změně kontraktu `
        + `${previous?.taskContractVersion || 'neznamy'} → ${contractVersion}`,
    });
  }

  return { tasks: nextTasks, rejected: nextRejected };
}

function normalizedRequiredHashes(values = []) {
  return [...new Set(values.map(value => String(value).trim().toLowerCase())
    .filter(value => /^[0-9a-f]{7,40}$/.test(value)))];
}

function matchingRequiredHash(hash, requiredHashes) {
  const full = String(hash || '').toLowerCase();
  return requiredHashes.find(required => full.startsWith(required)) || null;
}

/**
 * Seed pro levne rozsireni uz overene fixture.
 *
 * Append je bezpecny pouze uvnitr stejneho kontraktu ulohy. Pri zmene promptu,
 * scoringu nebo identity musi probehnout plny rebuild, ktery vse znovu overi.
 */
export function incrementalBuildSeed(previous, contractVersion = CODE_TASK_CONTRACT_VERSION) {
  if (!previous) return { existingTasks: [], rejectedHashes: [] };
  if (previous.taskContractVersion !== contractVersion) {
    throw new Error(`append vyzaduje ${contractVersion}, fixture ma ${previous.taskContractVersion || 'neznamy kontrakt'}`);
  }
  return {
    existingTasks: Array.isArray(previous.tasks) ? previous.tasks : [],
    rejectedHashes: [...new Set((previous.rejected || []).map(item => item?.hash).filter(Boolean))],
  };
}

export function buildSuite(repo, opts = {}) {
  const maxFunctionLines = opts.maxFunctionLines ?? 120;
  const maxRequirements = opts.maxRequirements ?? Number.POSITIVE_INFINITY;
  const wanted = opts.count ?? 24;
  const log = opts.log ?? (() => {});

  const existingTasks = Array.isArray(opts.existingTasks) ? opts.existingTasks : [];
  const existingKeys = new Set(existingTasks.map(taskSourceKey));
  const rejectedHashes = new Set(opts.rejectedHashes || []);
  const requiredHashes = normalizedRequiredHashes(opts.requiredHashes);
  const remainingRequired = new Set(requiredHashes.filter(required => !existingTasks
    .some(task => String(task.hash || '').toLowerCase().startsWith(required))));
  const seenRequired = new Set();
  const needsGeneralSupply = existingTasks.length < wanted;
  const candidates = findCandidates(repo, {
    limit: opts.limit ?? 1500,
    maxDiffLines: opts.maxDiffLines ?? 60,
    allowMultipleSources: opts.allowMultipleSources === true,
  }).filter(candidate => {
    if (existingKeys.has(taskSourceKey(candidate))) return false;
    const required = matchingRequiredHash(candidate.hash, [...remainingRequired]);
    if (!needsGeneralSupply && !required) return false;
    return required || !rejectedHashes.has(candidate.hash);
  });
  log(`nových kandidátů: ${candidates.length} (seed ${existingTasks.length} ověřených úloh)`);

  const accepted = [...existingTasks];
  const rejected = [];
  const timedOutCommits = new Set();

  // Odvození je levné (žádný spuštěný test), takže se udělá pro všechny
  // kandidáty najednou a teprve pak se rozhodne, v jakém pořadí se ověřují.
  const derived = [];
  for (const candidate of candidates) {
    const required = matchingRequiredHash(candidate.hash, [...remainingRequired]);
    if (required) seenRequired.add(required);
    const { task, reason } = deriveTask(repo, candidate);
    if (!task) { rejected.push({ hash: candidate.hash, source: candidate.source, reason }); continue; }
    if (task.requirements.length > maxRequirements) {
      rejected.push({
        hash: candidate.hash, source: candidate.source,
        reason: `úloha má ${task.requirements.length} požadavků (limit ${maxRequirements})`,
      });
      continue;
    }
    if (task.functionLines > maxFunctionLines) {
      rejected.push({ hash: candidate.hash, source: candidate.source, reason: `úseky mají ${task.functionLines} ř. (limit ${maxFunctionLines})` });
      continue;
    }
    derived.push({ candidate, task, required });
  }

  // Víc přidaných testů → víc cílů → úloha umí i mezistupeň.  Při shodě jde
  // napřed kratší zadání: generuje se rychleji a sada se dá proběhnout častěji.
  derived.sort((a, b) => (Number(Boolean(b.required)) - Number(Boolean(a.required)))
    || (b.task.requirements.length - a.task.requirements.length)
    || (a.task.functionLines - b.task.functionLines));
  log(`odvozeno: ${derived.length} (ověřuje se od nejvíc přidaných testů)`);

  for (const { candidate, task, required } of derived) {
    if (accepted.length >= wanted && remainingRequired.size === 0) break;
    if (accepted.length >= wanted && !required) continue;
    if (timedOutCommits.has(candidate.hash)) {
      rejected.push({ hash: candidate.hash, source: candidate.source, reason: 'jiný zdroj téhož commitu už timeoutoval' });
      continue;
    }

    log(`  ověřuji ${candidate.hash.slice(0, 8)} (${task.functionLines} ř., ${task.functionCount} úseků, `
      + `${task.requirements.length} přidaných testů)…`);
    const verdict = verifyTask(repo, task, opts);
    if (!verdict.usable) {
      if (/vypršel|timed?\s*out/i.test(verdict.reason || '')) timedOutCommits.add(candidate.hash);
      rejected.push({ hash: candidate.hash, source: candidate.source, reason: verdict.reason });
      continue;
    }

    accepted.push({
      hash: task.hash,
      source: task.source,
      test: task.test,
      tests: task.tests,
      subject: task.subject,
      functionCount: task.functionCount,
      functionLines: task.functionLines,
      requirements: task.requirements.length,
      // Cílové sady odvozené spuštěním, ne z textu commitu:
      //   failToPass — co má oprava spravit (zadání)
      //   passToPass — co nesmí rozbít (hlídač regresí)
      scoreMode: verdict.scoreMode,
      failToPass: verdict.failToPass,
      passToPass: verdict.passToPass,
      knownFailing: verdict.knownFailing,
      taskFingerprint: taskFingerprint(task, verdict),
    });
    if (required) remainingRequired.delete(required);
    log(`  ✅ ${candidate.hash.slice(0, 8)} [${verdict.scoreMode}] `
      + `${verdict.failToPass.length} cílových / ${verdict.passToPass.length} hlídaných`
      + ` — ${task.subject.slice(0, 38)}`);
  }

  for (const required of remainingRequired) {
    if (!seenRequired.has(required)) rejected.push({
      hash: required,
      source: null,
      reason: 'požadovaná gold úloha nebyla nalezena mezi kandidáty',
    });
  }

  return { tasks: accepted, rejected, examined: candidates.length, missingRequired: [...remainingRequired] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i > -1 ? Number(process.argv[i + 1]) : dflt;
  };
  const args = (name) => process.argv.flatMap((value, index) => (
    value === name && process.argv[index + 1] ? String(process.argv[index + 1]).split(',') : []
  ));
  const repo = process.cwd();
  let previous = null;
  if (existsSync(FIXTURE_PATH)) {
    try { previous = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')); } catch { previous = null; }
  }
  const append = process.argv.includes('--append');
  const seed = append ? incrementalBuildSeed(previous) : { existingTasks: [], rejectedHashes: [] };
  const result = buildSuite(repo, {
    maxFunctionLines: arg('--max-function-lines', 120),
    maxDiffLines: arg('--max-diff-lines', 60),
    maxRequirements: arg('--max-requirements', Number.POSITIVE_INFINITY),
    testTimeout: arg('--test-timeout', 120_000),
    limit: arg('--limit', 1500),
    count: arg('--count', 24),
    allowMultipleSources: process.argv.includes('--multi-source'),
    existingTasks: seed.existingTasks,
    rejectedHashes: seed.rejectedHashes,
    requiredHashes: args('--recover-hash'),
    log: (m) => console.log(m),
  });

  const repoHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  const workingTreeDirty = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim().length > 0;
  const reconciled = reconcileVerifiedTaskSupply(result.tasks, result.rejected, previous);
  const tasks = preserveCalibration(reconciled.tasks, previous)
    .sort((a, b) => (b.requirements - a.requirements) || (a.functionLines - b.functionLines));
  const rejected = append
    ? [...(previous?.rejected || []), ...reconciled.rejected]
      .filter((item, index, all) => index === all.findIndex(other => other.hash === item.hash
        && other.source === item.source && other.reason === item.reason))
    : reconciled.rejected;

  writeFileSync(FIXTURE_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    repoHead,
    workingTreeDirty,
    taskContractVersion: CODE_TASK_CONTRACT_VERSION,
    tasks,
    rejected,
  }, null, 2) + '\n');

  console.log(`\nhotovo: ${tasks.length} úloh (`
    + `${Math.max(0, result.tasks.length - seed.existingTasks.length)} nově gold ověřených) `
    + `z ${result.examined} kandidátů → ${path.relative(repo, FIXTURE_PATH)}`);
  if (result.missingRequired.length) console.log(`gold úlohy neobnovené: ${result.missingRequired.join(', ')}`);
  const reasons = {};
  for (const r of rejected) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  console.log('zamítnuto:', reasons);
}

export default {
  buildSuite, FIXTURE_PATH, CODE_TASK_CONTRACT_VERSION,
  taskFingerprint, preserveCalibration, reconcileVerifiedTaskSupply,
};
