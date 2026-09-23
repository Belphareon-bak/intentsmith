// Re-grade immutable stored answers through the same task graders. This stage
// never regenerates an answer, changes a binding or imports a user-supplied mean.
import { acceptanceHash } from '../upgrade/model-evaluation-acceptance.js';
import { SemanticEvaluationJudge } from './semantic-evaluation-judge.js';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const mean = xs => xs.reduce((n, x) => n + x, 0) / xs.length;
export const collectionEvidenceHash = collection => acceptanceHash({ runId: collection.runId,
  role: collection.role, artifact: collection.artifact, providerVersion: collection.providerVersion,
  contractSha256: collection.contractSha256, repeats: collection.repeats, tasks: collection.tasks,
  collection: collection.metadata?.collection });

export function collectionGradingOptions(history, plans, runId) {
  const collection = history.getRun(runId);
  if (!collection) fail('EVALUATION_COLLECTION_NOT_FOUND');
  const plan = plans[collection.role];
  const graders = [], blocked = [];
  for (const accepted of plan?.acceptance.graders || []) {
    try {
      prepareCollectionGrading({plan, collection, graderAcceptanceId: accepted.id,
        judge: accepted.judge ? {artifact: accepted.judge} : null});
      graders.push(accepted);
    } catch (error) { blocked.push({id: accepted.id, code: error.code || error.message}); }
  }
  return { runId, role: collection.role, model: collection.artifact.modelName,
    sourceSha256: collectionEvidenceHash(collection), graders, blocked,
    code: graders.length ? null : blocked[0]?.code || 'EVALUATION_GRADER_ACCEPTANCE_MISSING' };
}

export async function gradeAcceptedCollection({ history, plan, runId, call, prepareJudge, finishJudge,
  onProgress, onReceipt, fresh = false }) {
  const preview = collectionGradingOptions(history, {[plan.role]:plan}, runId);
  if (!preview.graders.length) return null; // Raw capture remains useful without an accepted judge.
  const accepted = preview.graders[0], collection = history.getRun(runId);
  const current = history.getComplete({role:plan.role,digestSha256:collection.artifact.digestSha256,
    suiteName:plan.suiteName,suiteVersion:plan.suiteVersion,contractSha256:plan.suiteContractSha256});
  if (!fresh && current?.metadata?.grading?.graderAcceptanceId === accepted.id
    && current.metadata.grading.graderAcceptanceSha256 === accepted.payloadSha256
    && current.metadata.grading.sourceCollectionSha256 === preview.sourceSha256) return {...current,reused:true};
  const judge = accepted.judge && new SemanticEvaluationJudge({artifact:accepted.judge,call,onReceipt,
    isAccepted:()=>plan.acceptance.graders?.some(g=>g.id===accepted.id && g.payloadSha256===accepted.payloadSha256)===true});
  prepareCollectionGrading({plan,collection,judge,graderAcceptanceId:accepted.id});
  if (judge && (typeof prepareJudge !== 'function' || typeof finishJudge !== 'function')) fail('EVALUATION_GRADER_GPU_OWNER_REQUIRED');
  try {
    if (judge) await prepareJudge(accepted.judge);
    const summary = await gradeAnswerCollection({plan,collection,judge,graderAcceptanceId:accepted.id,onProgress});
    return persistGradedCollection({history,plan,collection,summary});
  } finally { if (judge) await finishJudge(accepted.judge); }
}

export function prepareCollectionGrading({ plan, collection, judge, graderAcceptanceId }) {
  if (!plan?.collectionOnly || !plan.measurementReady || collection?.role !== plan.role
    || !/^[a-f0-9]{64}$/.test(collection.contractSha256 || '') || collection.suiteName !== plan.suiteName
    || collection.repeats !== plan.repeats
    || collection.metadata?.collection?.status !== 'AWAITING_REVIEW') fail('EVALUATION_COLLECTION_CONTRACT_MISMATCH');
  const sourceSha256 = collectionEvidenceHash(collection), sourceDigest = collection.artifact.digestSha256;
  const checkAcceptance = () => {
    const accepted = plan.acceptance.graders?.find(g => g.id === graderAcceptanceId);
    if (!accepted) fail('EVALUATION_GRADER_ACCEPTANCE_MISSING');
    if (plan.suite.tests.some(t => t.tier === 'T4')) {
      if (!judge || !accepted.judge || accepted.judge.digestSha256 !== judge.artifact?.digestSha256
        || accepted.judge.providerVersion !== judge.artifact?.providerVersion) fail('EVALUATION_GRADER_IDENTITY_MISMATCH');
      if (sourceDigest === judge.artifact.digestSha256) fail('SEMANTIC_SELF_GRADING_FORBIDDEN');
    }
    return accepted;
  };
  const accepted = checkAcceptance();
  const expected = plan.suite.tests.map(t => t.name).sort();
  if (JSON.stringify(collection.tasks.map(t => t.name).sort()) !== JSON.stringify(expected)) fail('EVALUATION_COLLECTION_TASKS_MISMATCH');
  const planned = plan.taskCount * plan.repeats;
  if (collection.metadata.collection.planned !== planned || collection.metadata.collection.observed !== planned)
    fail('EVALUATION_COLLECTION_INCOMPLETE');
  // Validate the complete input before any judge inference.
  for (const task of collection.tasks) {
    const current = plan.suite.tests.find(t => t.name === task.name);
    if (task.input?.conversationTurns && typeof current.gradeConversation !== 'function') {
      fail('EVALUATION_CONVERSATION_GRADER_NOT_AVAILABLE');
    }
    // A grading implementation change may reuse captures only when every
    // public input and inference option is byte-for-byte equivalent. The old
    // contract and raw run remain immutable; this creates a new grading run.
    if (acceptanceHash(task.input) !== acceptanceHash(current.prompt())
      || acceptanceHash(task.options) !== acceptanceHash(current.options)) fail('EVALUATION_COLLECTION_INPUT_CHANGED');
    if (task.responses?.length !== plan.repeats || task.details?.length !== plan.repeats
      || new Set(task.details.map(d => d.repeat)).size !== plan.repeats
      || task.details.some(d => !Number.isInteger(d.repeat) || d.repeat < 1 || d.repeat > plan.repeats
        || !['CAPTURED', 'OUTPUT_BUDGET_EXHAUSTED'].includes(d.captureStatus)
        || d.artifact?.digestSha256 !== sourceDigest || d.artifact?.providerVersion !== collection.providerVersion)
      || task.responses.some(r => typeof r !== 'string')) fail('EVALUATION_COLLECTION_RESPONSE_UNVERIFIED');
  }
  return { sourceSha256, accepted, planned, checkAcceptance };
}

export async function gradeAnswerCollection({ plan, collection, judge, graderAcceptanceId, onProgress = () => {} }) {
  const { sourceSha256, accepted, planned, checkAcceptance } = prepareCollectionGrading({ plan, collection, judge, graderAcceptanceId });
  const started = Date.now(), startedAt = new Date(started).toISOString(), tasks = [];
  let completed = 0, invalid = 0;
  for (const task of plan.suite.tests) {
    const input = collection.tasks.find(t => t.name === task.name);
    const scores = [], details = [];
    for (let i = 0; i < input.responses.length; i++) {
      checkAcceptance();
      let grade;
      if (input.details[i].captureStatus === 'OUTPUT_BUDGET_EXHAUSTED') grade = {
        valid: true, score: 0, passed: false, outcome: 'OPERATIONAL_FAILURE',
        detail: { reason: 'MODEL_OUTPUT_BUDGET_EXHAUSTED', contentScoreEvaluated: false } };
      else {
        try {
          const context = { semanticJudge: judge, artifact: {
            ...collection.artifact, providerVersion: collection.providerVersion } };
          grade = input.input?.conversationTurns
            ? await task.gradeConversation(input.details[i].conversation, context)
            : await task.grade(input.responses[i], context);
        }
        catch (error) { grade = { valid: false, score: null, detail: { reason: error.code || error.message } }; }
      }
      checkAcceptance();
      const valid = grade.valid !== false && Number.isFinite(grade.score) && grade.score >= 0 && grade.score <= 1;
      if (!valid) invalid++;
      scores.push(valid ? grade.score : null);
      details.push({ ...grade.detail, ...input.details[i], gradingStatus: valid ? 'GRADED' : 'UNRESOLVED',
        valid, score: valid ? grade.score : null,
        outcome: valid ? grade.outcome || (grade.passed ? 'SUCCESS' : 'INCORRECT') : 'INVALID_MEASUREMENT',
        reason: grade.detail?.reason || null });
      completed++;
      const elapsedMs = Date.now() - started;
      await onProgress({ phase: 'grading', role: plan.role, testName: task.name,
        completedTests: completed, totalTests: planned, percent: Math.floor(100 * completed / planned),
        elapsedMs, etaMs: completed ? elapsedMs / completed * (planned - completed) : null });
    }
    tasks.push({ ...input, rubric: task.rubric || [], scores, mean: scores.every(Number.isFinite) ? mean(scores) : null,
      spread: scores.every(Number.isFinite) ? Math.max(...scores)-Math.min(...scores) : null, details });
  }
  checkAcceptance();
  if (collectionEvidenceHash(collection) !== sourceSha256) fail('EVALUATION_COLLECTION_CHANGED');
  return { score: invalid ? null : mean(tasks.map(t => t.mean)), runs: plan.repeats, tasks,
    startedAt, completedAt: new Date().toISOString(), durationMs: Date.now() - started,
    grading: { version: 1, status: invalid ? 'GRADING_INCOMPLETE' : 'GRADED',
      planned, observed: completed, invalid, graderAcceptanceId: accepted.id,
      graderAcceptanceSha256: accepted.payloadSha256, judge: accepted.judge,
      sourceCollectionRunId: collection.runId, sourceCollectionSha256: sourceSha256,
      sourceContractSha256: collection.contractSha256, targetContractSha256: plan.suiteContractSha256,
      collectedAt: collection.completedAt, collectionDurationMs: collection.durationMs } };
}

export function persistGradedCollection({ history, plan, collection, summary }) {
  return history._db.transaction(() => persist({ history, plan, collection, summary })).immediate();
}

function persist({ history, plan, collection, summary }) {
  // Re-read source and authority immediately before the append-only write. A
  // revoked grader or a different source cannot reuse an in-flight score.
  const source = history.getRun(collection.runId);
  const accepted = plan.acceptance.graders?.find(g => g.id === summary.grading?.graderAcceptanceId
    && g.payloadSha256 === summary.grading?.graderAcceptanceSha256);
  if (!source || collectionEvidenceHash(source) !== summary.grading?.sourceCollectionSha256)
    fail('EVALUATION_COLLECTION_CHANGED');
  if (!accepted) fail('EVALUATION_GRADER_ACCEPTANCE_MISSING');
  history.setProviderVersion(source.providerVersion);
  const input = { artifact: source.artifact, role: plan.role, suiteName: plan.suiteName,
    suiteVersion: plan.suiteVersion, contractSha256: plan.suiteContractSha256,
    hardware: source.hardware, vramBytes: source.vramBytes, fresh: true,
    startedAt: summary.startedAt, completedAt: summary.completedAt,
    metadata: { source: 'accepted-collection-grading-v1', grading: summary.grading } };
  if (summary.grading.status === 'GRADED' && Number.isFinite(summary.score))
    return history.recordComplete({ ...input, summary });
  return history.recordTerminal({ ...input, status: 'BLOCKED', repeats: summary.runs,
    tasks: summary.tasks, errorCode: 'EVALUATION_GRADING_INCOMPLETE',
    errorMessage: 'Hodnotitel nevydal platnou známku pro všechny pokusy. Souhrnné skóre nebylo vydáno.' });
}
