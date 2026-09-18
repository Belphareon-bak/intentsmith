// Read-only audit of grading semantics and an optional captured evaluations GET.
// No provider calls, DB writes, model changes, or production-source edits.
// Exit 1 means an observed grading/contract defect; it is not a failed harness.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  chatV3Suite, reasoningV2Suite, reviewV2Suite, visionV2Suite,
} from '../../src/eval/role-quality-suites.js';
import { suiteContract } from '../../src/upgrade/model-evaluation-history.js';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--snapshot')) {
  console.error('Usage: node scripts/manual/audit-evaluation-validity.mjs [--snapshot evaluations.json]');
  process.exit(2);
}
const suites = [reasoningV2Suite, reviewV2Suite, chatV3Suite, visionV2Suite];
const probes = [
  {
    id: 'contradictory-summary-full-credit', suite: chatV3Suite, task: 'en_grounded_summary',
    response: 'Project Northstar launches on October 14 with a $2.4 million budget; Maya Chen owns delivery and a delayed battery supplier is the only risk, but actually it launches in December with a $9 million budget and Alex owns delivery.',
    expectation: 'A summary contradicting the supplied date, budget and owner must not receive full credit.',
    accepts: score => score < 1,
  },
  {
    id: 'correct-paraphrase-rejected', suite: chatV3Suite, task: 'en_grounded_summary',
    response: 'Northstar launches on 14 October with an approved budget of USD 2,400,000. Delivery is led by Maya Chen. The sole risk is a delay from the battery supplier.',
    expectation: 'All five published requirements are satisfied by a faithful three-sentence paraphrase.',
    accepts: score => score === 1,
  },
  {
    id: 'duplicate-false-locations-full-credit', suite: reviewV2Suite, task: 'review_sql_null',
    response: JSON.stringify({ findings: [
      { kind: 'sql_injection', line: 2 }, { kind: 'null_dereference', line: 3 },
      ...Array.from({ length: 100 }, (_, i) => ({ kind: 'sql_injection', line: 1000 + i })),
    ] }),
    expectation: 'One hundred additional findings on nonexistent lines must reduce precision.',
    accepts: score => score < 1,
  },
  {
    id: 'invented-image-colors-full-credit', suite: visionV2Suite, task: 'vision_dots',
    response: JSON.stringify({ count: 3, colors: ['red', 'green', 'blue', 'yellow', 'black'] }),
    expectation: 'Colors absent from the three colored dots must not receive full credit.',
    accepts: score => score < 1,
  },
  {
    id: 'negated-visual-answer-full-credit', suite: visionV2Suite, task: 'vision_ring',
    response: JSON.stringify({ shape: 'not a circle or ring', foreground: 'not black', background: 'not white' }),
    expectation: 'Negating all three correct visual attributes must not receive full credit.',
    accepts: score => score < 1,
  },
  {
    id: 'contradictory-non-json-text-full-credit', suite: reasoningV2Suite, task: 'reason_budget',
    response: 'The actual total is 1 dollar. {"discounted":660,"tax":132,"total":792}',
    expectation: 'A contradictory statement outside the requested ONLY JSON answer must not receive full credit.',
    accepts: score => score < 1,
  },
];
const observations = probes.map(({ id, suite, task, response, expectation, accepts }) => {
  const definition = suite.tests.find(row => row.name === task);
  const actual = definition.grade(response);
  return { id, suite: suite.name, task, response, expectation, actual,
    defectObserved: !accepts(actual.score) };
});

// Change only a shared grading helper IN MEMORY. The original source is never
// written. Identical contract + different grade demonstrates a cache-key gap.
const sourceUrl = new URL('../../src/eval/role-quality-suites.js', import.meta.url);
const sourceBytes = readFileSync(sourceUrl);
let mutantSource = sourceBytes.toString();
for (const relative of ['./code-patch-suite.js', './synthetic-images.js']) {
  mutantSource = mutantSource.replace(`'${relative}'`, JSON.stringify(new URL(relative, sourceUrl).href));
}
const seam = 'const score = clamp01((earned / total) - penalty);';
let helperContract;
if (mutantSource.includes(seam)) {
  mutantSource = mutantSource.replace(seam, 'const score = 0;');
  const mutant = await import(`data:text/javascript;base64,${Buffer.from(mutantSource).toString('base64')}`);
  const observe = suite => ({
    sha256: suiteContract(suite, { repeats: 3 }).sha256,
    score: suite.tests.find(row => row.name === 'reason_budget')
      .grade('{"discounted":660,"tax":132,"total":792}').score,
  });
  const original = observe(reasoningV2Suite);
  const modifiedHelper = observe(mutant.reasoningV2Suite);
  helperContract = { original, modifiedHelper, sourceFileModified: false,
    defectObserved: original.sha256 === modifiedHelper.sha256 && original.score !== modifiedHelper.score };
} else {
  helperContract = { status: 'NOT_RUN', reason: 'Shared-helper mutation seam changed; audit needs updating.' };
}

let snapshot = null;
if (args.length) {
  const bytes = readFileSync(args[1]);
  const captured = JSON.parse(bytes);
  if (!captured.roles || !captured.generatedAt) throw new Error('Expected a captured evaluations read model');
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    return n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2 : null;
  };
  const roles = {};
  for (const [role, plan] of Object.entries(captured.roles)) {
    const artifacts = plan.artifacts.filter(row => row.applicable && row.status === 'COMPLETE');
    const cells = artifacts.flatMap(row => row.tasks);
    const byTask = new Map();
    for (const cell of cells) {
      if (!byTask.has(cell.name)) byTask.set(cell.name, []);
      byTask.get(cell.name).push(cell.mean);
    }
    roles[role] = {
      suiteContractSha256: plan.suiteContractSha256, taskCount: plan.taskCount, repeats: plan.repeats,
      completeArtifacts: artifacts.length, taskModelCells: cells.length,
      zero: cells.filter(row => row.mean === 0).length,
      one: cells.filter(row => row.mean === 1).length,
      intermediate: cells.filter(row => row.mean > 0 && row.mean < 1).length,
      identicalRepeatScores: cells.filter(row => new Set(row.scores).size === 1).length,
      tasksWithoutDifference: [...byTask].filter(([, scores]) => new Set(scores).size === 1)
        .map(([name, scores]) => ({ name, score: scores[0], models: scores.length })),
      medianDurationMs: median(artifacts.map(row => row.durationMs)),
      measured: artifacts.map(row => ({ model: row.model, digestSha256: row.digestSha256,
        runId: row.runId, score: row.score, testedAt: row.testedAt, durationMs: row.durationMs })),
    };
  }
  snapshot = {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    generatedAt: captured.generatedAt, providerVersion: captured.providerVersion,
    coverage: captured.coverage, roles,
  };
}
const defects = observations.filter(row => row.defectObserved).length + Number(!!helperContract.defectObserved);
console.log(JSON.stringify({
  scope: 'DIAGNOSTIC_ONLY', sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'),
  suites: suites.map(suite => ({ name: suite.name, version: suite.version,
    roles: suite.roles, tasks: suite.tests.length })),
  observations, helperContract, defects, snapshot,
}, null, 2));
process.exitCode = defects ? 1 : 0;
