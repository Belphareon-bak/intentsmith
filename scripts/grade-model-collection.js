#!/usr/bin/env node
// Supported post-capture grading entrypoint. --plan is read-only; --run must be
// owned by the same resource-bounded sidecar wrapper as the normal GPU hunt.
import Database from 'better-sqlite3';
import { isAbsolute, resolve } from 'node:path';
import { writeFileSync, renameSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createRoleEvaluationPlans } from '../src/eval/role-evaluation-plan.js';
import { ModelEvaluationHistory } from '../src/upgrade/model-evaluation-history.js';
import { prepareCollectionGrading, gradeAnswerCollection, persistGradedCollection, storedGraderReviews } from '../src/eval/grade-answer-collection.js';
import { ModelEvaluationRunner } from '../src/eval/model-evaluation-runner.js';
import { SemanticEvaluationJudge } from '../src/eval/semantic-evaluation-judge.js';
import { holdGpuEvaluationLock } from '../src/upgrade/gpu-evaluation-lock.js';
import { assertGradingGpuOwnership } from '../src/eval/grading-provider-guard.js';

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args.includes('--help')) {
    console.log('Read-only: node scripts/grade-model-collection.js --plan --db=/absolute/c3.db --run-id=eval_ID --grader-acceptance=accept_ID\nGrade: node scripts/run-model-hunt-provider.js --grade-collection --run --db=/absolute/c3.db --run-id=eval_ID --grader-acceptance=accept_ID --report=/absolute/result.json\nUses only a reviewed independent grader; never approves evidence or changes a role.');
    return;
  }
  const options = {};
  for (const arg of args) {
    const match = /^--(plan|run|db|run-id|grader-acceptance|report|expected-source)(?:=(.*))?$/.exec(arg);
    if (!match || Object.hasOwn(options, match[1])) throw new Error('INVALID_GRADING_ARGUMENTS');
    options[match[1]] = match[2] ?? true;
  }
  if ((options.plan !== undefined && options.plan !== true) || (options.run !== undefined && options.run !== true)
    || !!options.plan === !!options.run || typeof options.db !== 'string' || !isAbsolute(options.db)
    || typeof options['run-id'] !== 'string' || typeof options['grader-acceptance'] !== 'string'
    || !/^eval_[a-zA-Z0-9_-]+$/.test(options['run-id']) || !/^accept_[a-zA-Z0-9_-]+$/.test(options['grader-acceptance'])
    || (options.report !== undefined && (typeof options.report !== 'string' || !isAbsolute(options.report)))
    || (options['expected-source'] !== undefined && !/^[a-f0-9]{64}$/.test(options['expected-source'])))
    throw new Error('INVALID_GRADING_ARGUMENTS');
  const db = new Database(options.db, {fileMustExist: true, readonly: !options.run});
  let lease;
  try {
    const history = new ModelEvaluationHistory(db), collection = history.getRun(options['run-id']);
    if (!collection) throw new Error('EVALUATION_COLLECTION_NOT_FOUND');
    const plan = createRoleEvaluationPlans({db})[collection.role], graderAcceptanceId = options['grader-acceptance'];
    const accepted = plan?.acceptance.graders?.find(g => g.id === graderAcceptanceId);
    const runner = new ModelEvaluationRunner('http://127.0.0.1:11435');
    let cancelled = false;
    const deadline = Date.now() + 60 * 60 * 1000;
    const judge = accepted?.judge && new SemanticEvaluationJudge({ artifact: accepted.judge,
      isAccepted: () => plan.acceptance.graders?.some(g => g.id === graderAcceptanceId && g.payloadSha256 === accepted.payloadSha256) === true,
      onReceipt: receipt => {
        if (options.run && options.report) appendFileSync(options.report + '.judgements.jsonl', JSON.stringify(receipt) + '\n', {mode: 0o600});
      },
      call: async (...callArgs) => {
        if (cancelled || Date.now() >= deadline) throw new Error('GRADING_BUDGET_OR_CANCELLATION');
        await assertOwnedProvider();
        const result = await runner._callModel(...callArgs);
        await assertOwnedProvider();
        const response = await fetch('http://127.0.0.1:11435/api/ps', {signal: AbortSignal.timeout(5000)});
        if (!response.ok) throw new Error('GRADER_PLACEMENT_UNVERIFIED');
        const loaded = (await response.json()).models?.find(m => m.digest?.replace(/^sha256:/,'') === accepted.judge.digestSha256);
        if (!loaded || !Number.isSafeInteger(loaded.size) || loaded.size <= 0 || loaded.size_vram < loaded.size)
          throw new Error('GRADER_NOT_FULLY_GPU_RESIDENT');
        return result;
      } });
    const prepared = prepareCollectionGrading({plan, collection, judge, graderAcceptanceId});
    if (storedGraderReviews(history,plan,collection).some(row => row.accepted?.id === graderAcceptanceId))
      throw new Error('EVALUATION_GRADER_REVIEW_ALREADY_RECORDED');
    if (options['expected-source'] && options['expected-source'] !== prepared.sourceSha256)
      throw new Error('EVALUATION_COLLECTION_CHANGED');
    if (!options.run) {
      console.log(JSON.stringify({status: 'READY_TO_GRADE', sourceRunId: collection.runId, role: plan.role,
        sourceSha256: prepared.sourceSha256, planned: prepared.planned, judge: accepted.judge,
        decisionReady: plan.decisionReady, reviewStatus:'READY_FOR_INDEPENDENT_REVIEW', effects: []}, null, 2));
      return;
    }
    if (!options.report) throw new Error('GRADING_REPORT_REQUIRED');
    await assertOwnedProvider();
    lease = holdGpuEvaluationLock({command: `grade-model-collection ${collection.runId}`});
    const signal = () => { cancelled = true; runner.cancel(); };
    process.once('SIGTERM', signal); process.once('SIGINT', signal);
    try {
      const summary = await gradeAnswerCollection({plan, collection, judge, graderAcceptanceId,
        onProgress: progress => {
          if (cancelled || Date.now() >= deadline) throw new Error('GRADING_BUDGET_OR_CANCELLATION');
          const file = process.env.INTENTSMITH_HUNT_PROGRESS_FILE;
          if (file) { writeFileSync(file + '.tmp', JSON.stringify({phase:'grading',activeModel:collection.artifact.modelName,
            updatedAt:new Date().toISOString(),detail:progress}) + '\n', {mode: 0o600}); renameSync(file + '.tmp', file); }
        } });
      const saved = persistGradedCollection({history, plan, collection, summary});
      const result = {status: saved.status === 'COMPLETE' ? 'GRADED' : saved.errorCode,
        sourceRunId: collection.runId, runId: saved.runId,
        role: plan.role, model:collection.artifact.modelName, score: saved.score, grading: summary.grading,
        results: [{model:collection.artifact.modelName,
          stage:saved.status === 'COMPLETE' ? 'graded' : 'review-pending',
          trials:[{role:plan.role,evaluation:{score:saved.score}}]}],
        decisionReady: plan.decisionReady};
      writeFileSync(options.report, JSON.stringify(result, null, 2) + '\n', {mode: 0o600});
      console.log(JSON.stringify(result));
      if (saved.status !== 'COMPLETE' && saved.errorCode !== 'EVALUATION_REVIEW_PENDING_PAIR') process.exitCode = 2;
    } finally { process.removeListener('SIGTERM', signal); process.removeListener('SIGINT', signal); }
  } finally { lease?.release(); db.close(); }
}

async function assertOwnedProvider() {
  const pid = Number(process.env.INTENTSMITH_EVAL_PROVIDER_PID);
  if (!Number.isSafeInteger(pid) || pid <= 0 || !process.env.INTENTSMITH_HUNT_PROGRESS_FILE)
    throw new Error('GRADING_REQUIRES_MANAGED_PROVIDER');
  // The wrapper owns and terminates this process group. Do not contact the
  // system provider or unload anything owned by an interactive conversation.
  await assertGradingGpuOwnership(pid);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 2; });
}
