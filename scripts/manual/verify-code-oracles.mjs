// WP-GPU-HUNT-EVALUATION-CONTRACT-20260918 §§3/5: verify the existing CODE
// evaluator, without model inference, production DB writes or role changes.
import { writeFileSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { codePatchSuite } from '../../src/eval/code-patch-suite.js';
import { buildPrompt, extractFunctionCodes } from '../../src/eval/code-patch-runner.js';
import { createRoleEvaluationPlans } from '../../src/eval/role-evaluation-plan.js';

const args = process.argv.slice(2);
if (!args.length || args[0] === '--help') {
  console.log('Usage: node scripts/manual/verify-code-oracles.mjs --out /absolute/report.json');
  process.exit(0);
}
if (args.length !== 2 || args[0] !== '--out' || !isAbsolute(args[1])) {
  console.error('An absolute --out path is required.'); process.exit(2);
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const report = { startedAt: new Date().toISOString(),
  sourceRevision: execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTreeDirty: Boolean(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).trim()),
  contractSha256: createRoleEvaluationPlans().CODE.suiteContractSha256,
  tasks: [], status: 'RUNNING' };
const flush = () => writeFileSync(resolve(args[1]), JSON.stringify(report, null, 2) + '\n');
flush();
for (const definition of codePatchSuite.tests) {
  const row = { name: definition.name, controls: [] };
  report.tasks.push(row);
  try {
    const task = definition.prepare();
    row.independenceGroup = task.oracleAcceptance.independenceGroup;
    row.alternativeExplanation = task.oracleAcceptance.alternativeExplanation;
    row.oracle = definition.validateOracle();
    const fenced = codes => codes.map(code => '```javascript\n' + code + '\n```').join('\n');
    const samples = [
      ['gold', fenced(task.goldTexts), 1],
      ['alternative', fenced(task.oracleAcceptance.alternativeTexts), 1],
      ['empty', '', 0],
      ['prompt-echo', buildPrompt(task), 0],
      ['keyword-stuffing', task.requirements.join('\n') + '\ncorrect fixed passed success', 0],
      ['confidently-wrong', 'All requirements are satisfied.\n' + fenced(task.functionTexts), 0],
      ['negated-repair', 'The repair must NOT change this implementation.\n' + fenced(task.functionTexts), 0],
    ];
    for (const [kind, response, expected] of samples) {
      const result = definition.grade(response, { _task: task });
      const control = { kind, expected, score: result.score, valid: result.valid,
        outcome: result.outcome, reason: result.detail?.reason || null,
        ok: result.valid === true && result.score === expected };
      row.controls.push(control);
      // The alternative must take the parser and actual execution path, not
      // a special grader branch keyed by fixture identity.
      if (kind === 'alternative' && !extractFunctionCodes(response, task.spans)) control.ok = false;
      flush();
    }
    row.passed = row.controls.every(control => control.ok);
  } catch (error) { row.passed = false; row.error = error.message; }
  flush(); console.log(`${row.name}: ${row.passed ? 'PASS' : 'FAIL'}`);
}
report.finishedAt = new Date().toISOString();
report.independentGroups = new Set(report.tasks.map(task => task.independenceGroup).filter(Boolean)).size;
report.status = report.tasks.every(task => task.passed) ? 'PASS' : 'FAIL';
flush(); if (report.status !== 'PASS') process.exitCode = 1;
