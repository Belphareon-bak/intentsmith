// The normal hunt can collect open answers without invoking an unaccepted judge.
// Every attempted generation is checkpointed in the existing evaluation history.
import { collectAnswer } from './role-collection-profile.js';

export async function collectRoleAnswers(runner, role, model, opts = {}) {
  const plan = opts.evaluationPlan;
  if (!plan?.collectionOnly || !plan.measurementReady) throw new Error('MODEL_COLLECTION_PLAN_UNAVAILABLE');
  if (!opts.resolveArtifact || !opts.saveCollection) throw new Error('MODEL_COLLECTION_PERSISTENCE_REQUIRED');
  const artifact = await opts.resolveArtifact(model);
  if (!artifact?.digestSha256 || !artifact.providerVersion) throw new Error('MODEL_COLLECTION_IDENTITY_REQUIRED');
  const identity = { role, model, artifact, suiteName: plan.suiteName,
    suiteVersion: plan.suiteVersion, suiteContractSha256: plan.suiteContractSha256 };
  if (!opts.fresh && opts.loadCollection) {
    const previous = await opts.loadCollection(identity);
    if (previous) return { ...previous, reused: true };
  }
  const started = Date.now(), startedAt = new Date(started).toISOString();
  const repeats = plan.repeats;
  const total = plan.suite.tests.length * repeats;
  const tasks = [], attempts = [];
  let historyRunId = null;
  const snapshot = (status) => ({ suite: plan.suiteName, model, artifact, score: null,
    runs: repeats, tasks: structuredClone(tasks), startedAt,
    completedAt: new Date().toISOString(), durationMs: Date.now() - started,
    collection: { version: 1, status, planned: total, observed: attempts.length,
      captured: attempts.filter(a => a.captureStatus === 'CAPTURED').length,
      budgetExhausted: attempts.filter(a => a.captureStatus === 'OUTPUT_BUDGET_EXHAUSTED').length,
      invalid: attempts.filter(a => !['CAPTURED','OUTPUT_BUDGET_EXHAUSTED'].includes(a.captureStatus)).length },
    historyRunId, reused: false });
  const persist = async status => {
    const summary = snapshot(status);
    const saved = await opts.saveCollection({ ...identity, summary });
    historyRunId = saved.runId;
    return { ...summary, historyRunId };
  };
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const task of plan.suite.tests) {
      const elapsedMs = Date.now() - started;
      opts.onProgress?.({ model, role, testName: task.name, status: 'running', repeat, repeats,
        completedTests: attempts.length, totalTests: total, percent: Math.floor(attempts.length / total * 100),
        elapsedMs, etaMs: attempts.length ? elapsedMs / attempts.length * (total - attempts.length) : null });
      let answer;
      try {
        answer = await collectAnswer(task, model, artifact, runner._callModel.bind(runner));
      } catch (error) {
        answer = { name: task.name, response: '', captureStatus: 'IDENTITY_OR_PROVIDER_ERROR',
          error: error.code || error.message, detail: error.detail || null, artifact: null };
      }
      attempts.push(answer);
      let row = tasks.find(t => t.name === task.name);
      if (!row) {
        row = { name: task.name, language: task.language || null, mean: null, scores: [], responses: [], details: [],
          rubric: task.rubric || [], input: task.prompt(), options: task.options,
          independenceGroup: task.independenceGroup || null };
        tasks.push(row);
      }
      row.responses.push(answer.response || '');
      row.details.push({ repeat, captureStatus: answer.captureStatus, reason: answer.error || null,
        artifact: answer.artifact, durationMs: answer.durationMs ?? null,
        evalTokens: answer.evalTokens ?? null, promptEvalTokens: answer.promptEvalTokens ?? null,
        doneReason: answer.doneReason || null, gradingStatus: 'NOT_GRADED' });
      const invalid = !['CAPTURED','OUTPUT_BUDGET_EXHAUSTED'].includes(answer.captureStatus);
      const status = invalid ? 'COLLECTION_PARTIAL' : attempts.length === total ? 'AWAITING_REVIEW' : 'COLLECTION_PARTIAL';
      const saved = await persist(status);
      if (invalid || attempts.length === total) {
        opts.onProgress?.({ model, role, status, completedTests: attempts.length, totalTests: total,
          percent: Math.floor(attempts.length / total * 100), elapsedMs: Date.now() - started, etaMs: invalid ? null : 0 });
        return saved;
      }
    }
  }
}
