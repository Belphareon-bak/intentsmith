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
    row.spanCount = task.spans.length;
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
    // A single replacement can arrive as two successive code fragments.
    // Multi-span tasks already exercise two/three complete ordered blocks;
    // splitting their individual spans needs an explicit mapping protocol.
    if (task.spans.length === 1) {
      const split = code => {
        const lines = code.split('\n');
        const at = Math.floor(lines.length / 2);
        return fenced([lines.slice(0, at).join('\n'), lines.slice(at).join('\n')]);
      };
      samples.push(['alternative-split-two-blocks', split(task.oracleAcceptance.alternativeTexts[0]), 1]);
      samples.push(['incorrect-split-two-blocks', split(task.functionTexts[0]), 0]);
    }
    if (['0fe346cc820c','6fc5e4eb7dce'].includes(task.oracleCase)) {
      samples.push(['regression-drop-existing-reader', fenced(task.goldTexts.map(code => code.replace(/.*MODEL_ACTIVITY_OWNER\.BINDING_VERIFICATION,?\n/g, ''))), 0]);
      samples.push(['regression-drop-existing-owner', fenced(task.goldTexts.map(code => code.replace(/.*MODEL_VALIDATION:.*\n/g, ''))), 0]);
    }
    if (task.oracleCase === 'f63d14d5eb61') {
      samples.push(['equivalent-confidence-punctuation', fenced(task.goldTexts.map(code => code.replaceAll('jistota ${confidence}', 'jistota: ${confidence}'))), 1]);
    }
    for (const [kind, response, expected] of samples) {
      const result = definition.grade(response, { _task: task });
      const control = { kind, expected, score: result.score, valid: result.valid,
        outcome: result.outcome, reason: result.detail?.reason || null,
        responseBlocks: (response.match(/^```javascript$/gm) || []).length,
        ok: result.valid === true && result.score === expected };
      row.controls.push(control);
      // The alternative must take the parser and actual execution path, not
      // a special grader branch keyed by fixture identity.
      if (kind.startsWith('alternative') && !extractFunctionCodes(response, task.spans)) control.ok = false;
      flush();
    }
    row.passed = row.controls.every(control => control.ok);
  } catch (error) { row.passed = false; row.error = error.message; }
  flush(); console.log(`${row.name}: ${row.passed ? 'PASS' : 'FAIL'}`);
}
report.finishedAt = new Date().toISOString();
report.independentGroups = new Set(report.tasks.map(task => task.independenceGroup).filter(Boolean)).size;
// Compatibility field above counts declarations, not proven independence or
// an accepted decision rule. Do not infer completion of contract §6 from it.
report.groupingStatus = 'DECLARED_SCENARIO_GROUPS_ONLY';
report.decisionRuleStatus = 'NOT_IMPLEMENTED';
report.status = report.tasks.every(task => task.passed) ? 'PASS' : 'FAIL';
flush(); if (report.status !== 'PASS') process.exitCode = 1;
