#!/usr/bin/env node
// Build Code Suite — vykurátoruje sadu CODE úloh z historie repa
// ══════════════════════════════════════════════════════════════════════════════
//
// Spouští se ručně, výstup se commituje:
//
//     node src/eval/build-code-suite.js [--max-function-lines 120] [--limit 1500]
//
// Fixture drží jen **metadata** — hash, cestu ke zdrojáku, cestu k testu a
// předmět commitu.  Zdrojový kód se nekopíruje: `deriveTask()` si ho v okamžiku
// evaluace vytáhne přes `git show`, což trvá jednotky milisekund a nezanáší do
// repa stovky kilobajtů duplikátů.
//
// Kurátorský filtr má čtyři síta a každé z nich něco vyřazuje:
//
//   1. jeden zdroják + jeden test v commitu   — jinak není jasné, co opravit
//   2. změna uvnitř jediné funkce             — jinak se nedá zadat „přepiš tuhle funkci"
//   3. funkce do N řádků                      — delší se generují minuty
//   4. test padá před opravou, prochází s gold patchem, **ve stejné izolaci**
//      jako pak poběží odpověď modelu
//
// Čtvrté síto je to podstatné: co jím projde, je zaručeně řešitelné a měřitelné.
//
// ══════════════════════════════════════════════════════════════════════════════

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findCandidates } from './code-task-extractor.js';
import { deriveTask, verifyTask } from './code-patch-runner.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = path.join(HERE, 'code-suite-tasks.json');

export function buildSuite(repo, opts = {}) {
  const maxFunctionLines = opts.maxFunctionLines ?? 120;
  const wanted = opts.count ?? 12;
  const log = opts.log ?? (() => {});

  const candidates = findCandidates(repo, { limit: opts.limit ?? 1500, maxDiffLines: opts.maxDiffLines ?? 60 });
  log(`kandidátů: ${candidates.length}`);

  const accepted = [];
  const rejected = [];

  for (const candidate of candidates) {
    if (accepted.length >= wanted) break;

    const { task, reason } = deriveTask(repo, candidate);
    if (!task) { rejected.push({ hash: candidate.hash, reason }); continue; }
    if (task.functionLines > maxFunctionLines) {
      rejected.push({ hash: candidate.hash, reason: `funkce má ${task.functionLines} ř. (limit ${maxFunctionLines})` });
      continue;
    }

    log(`  ověřuji ${candidate.hash.slice(0, 8)} (${task.functionLines} ř., ${task.functionCount} fn)…`);
    const verdict = verifyTask(repo, task, opts);
    if (!verdict.usable) { rejected.push({ hash: candidate.hash, reason: verdict.reason }); continue; }

    accepted.push({
      hash: task.hash,
      source: task.source,
      test: task.test,
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
    });
    log(`  ✅ ${candidate.hash.slice(0, 8)} [${verdict.scoreMode}] `
      + `${verdict.failToPass.length} cílových / ${verdict.passToPass.length} hlídaných`
      + ` — ${task.subject.slice(0, 38)}`);
  }

  return { tasks: accepted, rejected, examined: candidates.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const arg = (name, dflt) => {
    const i = process.argv.indexOf(name);
    return i > -1 ? Number(process.argv[i + 1]) : dflt;
  };
  const repo = process.cwd();
  const result = buildSuite(repo, {
    maxFunctionLines: arg('--max-function-lines', 120),
    maxDiffLines: arg('--max-diff-lines', 60),
    limit: arg('--limit', 1500),
    count: arg('--count', 12),
    log: (m) => console.log(m),
  });

  writeFileSync(FIXTURE_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    repoHead: process.env.EVAL_HEAD || null,
    tasks: result.tasks,
  }, null, 2) + '\n');

  console.log(`\nhotovo: ${result.tasks.length} úloh z ${result.examined} kandidátů → ${path.relative(repo, FIXTURE_PATH)}`);
  const reasons = {};
  for (const r of result.rejected) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  console.log('zamítnuto:', reasons);
}

export default { buildSuite, FIXTURE_PATH };
