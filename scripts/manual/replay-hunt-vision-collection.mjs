#!/usr/bin/env node
// Re-score immutable VISION captures with the current deterministic content
// oracle. This is development evidence, never a role recommendation.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { visionV2Suite } from '../../src/eval/role-quality-suites.js';
import { collectionSuite } from '../../src/eval/role-collection-profile.js';
import { suiteContract } from '../../src/upgrade/model-evaluation-history.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = reason => { throw new Error(`VISION_REPLAY_INVALID:${reason}`); };
const read = path => readFileSync(path);
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;

export function replayVisionCollection(plan, result) {
  const suite = collectionSuite('VISION', visionV2Suite);
  if (plan?.schemaVersion !== 1 || plan.collectOnly !== true || plan.profile !== 'full'
    || plan.roles?.length !== 1 || plan.roles[0]?.role !== 'VISION'
    || plan.roles[0].contractSha256 !== suiteContract(suite, { repeats: plan.repeats }).sha256
    || !Number.isInteger(plan.repeats) || plan.repeats < 1
    || result?.planSha256 !== plan.sha256 || result.status !== 'COLLECTION_COMPLETE'
    || result.decisionAuthority !== false || result.operationPolicy?.removeModels !== false
    || result.artifacts?.model?.modelName !== plan.model
    || !/^[a-f0-9]{64}$/.test(result.artifacts.model.digestSha256)
    || !result.artifacts.model.providerVersion) fail('PLAN_OR_SOURCE');
  const expectedPlanSha = hash(JSON.stringify(Object.fromEntries(
    Object.entries(plan).filter(([key]) => key !== 'sha256'))));
  if (expectedPlanSha !== plan.sha256) fail('PLAN_HASH');
  const expected = new Map(suite.tests.map(task => [task.name, task]));
  if (plan.roles[0].tasks.length !== expected.size
    || new Set(plan.roles[0].tasks.map(row => row.name)).size !== expected.size
    || plan.roles[0].tasks.some(row => !expected.has(row.name)
      || JSON.stringify(row.options) !== JSON.stringify(expected.get(row.name).options))) fail('TASKS');
  const byKey = new Map();
  for (const attempt of result.attempts || []) {
    const key = `${attempt.role}/${attempt.task}/${attempt.repeat}`;
    if (byKey.has(key) || attempt.role !== 'VISION' || !expected.has(attempt.task)
      || !Number.isInteger(attempt.repeat) || attempt.repeat < 1 || attempt.repeat > plan.repeats
      || !['CAPTURED', 'OUTPUT_BUDGET_EXHAUSTED'].includes(attempt.captureStatus)
      || typeof attempt.response !== 'string'
      || attempt.artifact?.digestSha256 !== result.artifacts.model.digestSha256
      || attempt.artifact?.providerVersion !== result.artifacts.model.providerVersion)
      fail('ATTEMPT');
    byKey.set(key, attempt);
  }
  if (byKey.size !== expected.size * plan.repeats) fail('COVERAGE');
  const tasks = [];
  for (const [name, task] of expected) {
    const attempts = [];
    for (let repeat = 1; repeat <= plan.repeats; repeat++) {
      const attempt = byKey.get(`VISION/${name}/${repeat}`);
      if (!attempt) fail('COVERAGE');
      const grade = attempt.captureStatus === 'CAPTURED' ? task.grade(attempt.response) : null;
      if (grade && (!Number.isFinite(grade.score) || grade.score < 0 || grade.score > 1)) fail('GRADE');
      attempts.push({ repeat, captureStatus: attempt.captureStatus, responseSha256: hash(attempt.response),
        contentScore: grade?.score ?? null, passed: grade?.passed ?? false,
        detail: grade?.detail ?? { reason: 'MODEL_OUTPUT_BUDGET_EXHAUSTED' } });
    }
    tasks.push({ name, distinctResponses: new Set(attempts.map(row => row.responseSha256)).size,
      captured: attempts.filter(row => row.captureStatus === 'CAPTURED').length,
      outputBudgetExhausted: attempts.filter(row => row.captureStatus === 'OUTPUT_BUDGET_EXHAUSTED').length,
      contentMeanOnCaptured: attempts.some(row => row.contentScore !== null)
        ? mean(attempts.filter(row => row.contentScore !== null).map(row => row.contentScore)) : null,
      attempts });
  }
  const rows = tasks.flatMap(task => task.attempts);
  return { schemaVersion: 1, status: 'EXPLORATORY_VISION_TECHNICAL_REPLAY', decisionAuthority: false,
    acceptedOracle: false, sourceRevision: plan.sourceRevision,
    model: result.artifacts.model, contractSha256: plan.roles[0].contractSha256,
    planned: rows.length, captured: rows.filter(row => row.captureStatus === 'CAPTURED').length,
    outputBudgetExhausted: rows.filter(row => row.captureStatus === 'OUTPUT_BUDGET_EXHAUSTED').length,
    distinctResponses: tasks.reduce((n, task) => n + task.distinctResponses, 0),
    contentMeanOnCaptured: rows.some(row => row.contentScore !== null)
      ? mean(rows.filter(row => row.contentScore !== null).map(row => row.contentScore)) : null,
    operationalMeanIncludingOutputLimits: mean(rows.map(row => row.contentScore ?? 0)), tasks,
    limitations: ['Author-controlled deterministic oracle, not independently accepted.',
      'Known development images; repeated outputs from one image are not independent cases.',
      'Output-budget exhaustion is an operational failure, not a semantic content score.',
      'No model assignment, deletion or autonomous recommendation follows from this report.'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = Object.fromEntries(process.argv.slice(2).map(value => {
    const pair = /^--(run|out)=(.+)$/.exec(value);
    if (!pair || !isAbsolute(pair[2])) fail('ARGUMENTS');
    return [pair[1], pair[2]];
  }));
  if (process.argv.length !== 4 || !args.run || !args.out || existsSync(args.out)) fail('ARGUMENTS');
  const planBytes = read(join(args.run, 'plan.json'));
  const resultBytes = read(join(args.run, 'result.json'));
  const report = replayVisionCollection(JSON.parse(planBytes), JSON.parse(resultBytes));
  report.sources = { planSha256: hash(planBytes), resultSha256: hash(resultBytes),
    graderSourceSha256: hash(read(new URL('../../src/eval/role-quality-suites.js', import.meta.url))),
    runtimeParserSha256: hash(read(new URL('../../src/eval/runtime-json.js', import.meta.url))) };
  writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: report.status, model: report.model.modelName,
    captured: report.captured, distinctResponses: report.distinctResponses,
    operationalMeanIncludingOutputLimits: report.operationalMeanIncludingOutputLimits, out: args.out }));
}
