#!/usr/bin/env node
// Contract §3: reproduce the deterministic VISION grader probes without GPU,
// production data, a model download, or implicit independent acceptance.
import { writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { visionV2Suite } from '../../src/eval/role-quality-suites.js';
import { createRoleEvaluationPlans } from '../../src/eval/role-evaluation-plan.js';

const args = process.argv.slice(2);
if (!args.length || args[0] === '--help') {
  console.log('Usage: node scripts/manual/verify-vision-oracles.mjs --out /absolute/new-report.json');
  process.exit(0);
}
if (args.length !== 2 || args[0] !== '--out' || !isAbsolute(args[1])) {
  console.error('An absolute --out path is required.'); process.exit(2);
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const wrong = value => typeof value === 'boolean' ? !value
  : typeof value === 'number' ? value + 1
    : Array.isArray(value) ? ['__incorrect__'] : '__incorrect__';
const report = {
  schemaVersion: 1, startedAt: new Date().toISOString(),
  sourceRevision: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeDirty: !!execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim(),
  contractSha256: createRoleEvaluationPlans().VISION.suiteContractSha256,
  status: 'RUNNING', tasks: [], decisionAuthority: false,
  limitations: ['Authored oracle probes are not independent acceptance of task relevance or predictive validity.',
    'Synthetic images cover bounded perception and reasoning tasks, not natural photographs or arbitrary documents.'],
};
// Refuse to replace an earlier evidence report.
writeFileSync(args[1], JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const flush = () => writeFileSync(args[1], JSON.stringify(report, null, 2) + '\n');
for (const task of visionV2Suite.tests) {
  const { expected, rules = {} } = task.contractMaterial.gradingInputs;
  const alternative = Object.fromEntries(Object.entries(expected).reverse().map(([key, value]) => [key,
    typeof value === 'string' ? ` ${rules[key]?.aliases?.[0] || value.toUpperCase()} `
      : Array.isArray(value) ? (rules[key] === 'set' ? [...value].reverse() : value).map(v => v.toLowerCase()) : value]));
  const incorrect = Object.fromEntries(Object.entries(expected).map(([key, value]) => [key, wrong(value)]));
  const fields = Object.keys(expected);
  const firstOnly = { ...incorrect, [fields[0]]: expected[fields[0]] };
  const samples = [
    ['gold', JSON.stringify(expected), 1],
    ['alternative', JSON.stringify(alternative, null, 2), 1],
    ['fenced-alternative', '```json\n' + JSON.stringify(alternative) + '\n```', 1],
    ['prose-fenced-alternative', 'Here is the result:\n```json\n' + JSON.stringify(alternative) + '\n```\nEnd.', 1],
    ['empty', '', 0], ['prompt-echo', task.promptText, 0],
    ['keyword-stuffing', Object.values(expected).flat().join(' ') + ' correct passed success', 0],
    // Operator 2026-09-20 requires exact runtime parity: production extracts
    // these fields too. These are parser probes, not semantic acceptance.
    ['negated-prose-runtime-extraction', 'These values are NOT correct: ' + JSON.stringify(expected), 1],
    ['confident-wrong', JSON.stringify(incorrect), 0],
    ['partial-one-field', JSON.stringify(firstOnly), 1 / fields.length],
    ['contradictory-prose-runtime-extraction', 'The image contradicts these claims.\n' + JSON.stringify(expected), 1],
    ['extra-field', JSON.stringify({ ...expected, fabricated: true }), 1],
    ['wrong-field-types', JSON.stringify(Object.fromEntries(fields.map(key => [key, null]))), 0],
  ];
  const row = { name: task.name, tier: 'T2', floor: 0,
    imageDigests: task.contractMaterial.prompt.imageDigests || [], controls: [], passed: true };
  report.tasks.push(row);
  for (const [kind, response, score] of samples) {
    try {
      const actual = task.grade(response);
      const ok = Number.isFinite(actual.score) && Math.abs(actual.score - score) < 1e-12
        && (!kind.includes('fenced-alternative') || actual.detail?.strictJson === false)
        && (kind !== 'extra-field' || (actual.passed === false && actual.detail?.formatScore === 0));
      row.controls.push({ kind, response, responseSha256: hash(response), expected: score,
        score: actual.score, detail: actual.detail, ok });
      row.passed &&= ok;
    } catch (error) { row.passed = false; row.controls.push({ kind, error: error.message, ok: false }); }
  }
  flush(); console.log(`${row.name}: ${row.passed ? 'PASS' : 'FAIL'}`);
}
report.imageCount = new Set(report.tasks.flatMap(t => t.imageDigests)).size;
report.controls = report.tasks.reduce((n, t) => n + t.controls.length, 0);
report.status = report.tasks.every(t => t.passed) && report.imageCount >= 10 ? 'PASS' : 'FAIL';
report.finishedAt = new Date().toISOString();
flush(); if (report.status !== 'PASS') process.exitCode = 1;
