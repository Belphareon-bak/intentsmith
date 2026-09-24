// Re-grade immutable stored answers through the same task graders. This stage
// never regenerates an answer, changes a binding or imports a user-supplied mean.
import { acceptanceHash } from '../upgrade/model-evaluation-acceptance.js';
import { randomUUID } from 'node:crypto';
import { acceptedGraderPair } from './independent-grader-pair.js';
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
  const reviews = plan ? storedGraderReviews(history,plan,collection) : [];
  const graders = [], blocked = [];
  for (const accepted of plan?.acceptance.graders || []) {
    try {
      prepareCollectionGrading({plan, collection, graderAcceptanceId: accepted.id,
        judge: accepted.judge ? {artifact: accepted.judge} : null});
      if (reviews.some(row => row.accepted?.id === accepted.id))
        blocked.push({id:accepted.id,code:'EVALUATION_GRADER_REVIEW_ALREADY_RECORDED'});
      else graders.push(accepted);
    } catch (error) { blocked.push({id: accepted.id, code: error.code || error.message}); }
  }
  const activeReviews = reviews.filter(row => row.accepted);
  const pair = acceptedGraderPair((plan?.acceptance.graders || []),collection.artifact.digestSha256);
  if (activeReviews.length && !pair) {
    for (const grader of graders) blocked.push({id:grader.id,code:'EVALUATION_GRADER_PAIR_NOT_AVAILABLE'});
    graders.length = 0;
  }
  const reconciliation = reconcileGraderReviews(activeReviews,plan,collection);
  return { runId, role: collection.role, model: collection.artifact.modelName,
    sourceSha256: collectionEvidenceHash(collection), graders, blocked,
    reviewed:reviews.map(row => ({reviewId:row.id,graderAcceptanceId:row.summary.grading.graderAcceptanceId,
      accepted:!!row.accepted,score:row.summary.score,recordedAt:row.recordedAt})),
    pairAvailable:!!pair,reviewStatus:reconciliation.status,
    disputes:reconciliation.disputes,
    code: graders.length ? null : reconciliation.status === 'REVIEW_DISPUTED'
      ? 'EVALUATION_GRADING_DISPUTE' : activeReviews.length && !pair
      ? 'EVALUATION_GRADER_PAIR_NOT_AVAILABLE' : blocked[0]?.code || 'EVALUATION_GRADER_ACCEPTANCE_MISSING' };
}

export async function gradeAcceptedCollection({ history, plan, runId, call, prepareJudge, finishJudge,
  onProgress, onReceipt }) {
  const collection = history.getRun(runId);
  if (!collection) fail('EVALUATION_COLLECTION_NOT_FOUND');
  const preview = collectionGradingOptions(history, {[plan.role]:plan}, runId);
  const current = history.getComplete({role:plan.role,digestSha256:collection.artifact.digestSha256,
    suiteName:plan.suiteName,suiteVersion:plan.suiteVersion,contractSha256:plan.suiteContractSha256});
  if (current?.metadata?.grading?.sourceCollectionSha256 === preview.sourceSha256)
    return {...current,reused:true};
  // Scheduled inference starts only with a unique accepted independent pair.
  // A manual operator may still store a first exploratory review separately.
  const pair = acceptedGraderPair(plan.acceptance.graders,collection.artifact.digestSha256);
  if (!pair) return preview.reviewed.length ? {status:'BLOCKED',score:null,reused:true,
    errorCode:preview.code || 'EVALUATION_GRADER_PAIR_NOT_AVAILABLE',
    errorMessage:'Bez jednoznačné nezávislé dvojice nelze vydat skóre.'} : null;
  let result = null;
  for (const accepted of pair) {
    if (!preview.graders.some(g => g.id === accepted.id)) continue;
    const judge = accepted.judge && new SemanticEvaluationJudge({artifact:accepted.judge,call,onReceipt,
      isAccepted:()=>plan.acceptance.graders?.some(g=>g.id===accepted.id
        && g.payloadSha256===accepted.payloadSha256)===true});
    prepareCollectionGrading({plan,collection,judge,graderAcceptanceId:accepted.id});
    if (judge && (typeof prepareJudge !== 'function' || typeof finishJudge !== 'function'))
      fail('EVALUATION_GRADER_GPU_OWNER_REQUIRED');
    try {
      if (judge) await prepareJudge(accepted.judge);
      const summary = await gradeAnswerCollection({plan,collection,judge,graderAcceptanceId:accepted.id,onProgress});
      result = persistGradedCollection({history,plan,collection,summary});
    } finally { if (judge) await finishJudge(accepted.judge); }
    if (result.status === 'COMPLETE' || result.errorCode !== 'EVALUATION_REVIEW_PENDING_PAIR') break;
  }
  return result || {status:'BLOCKED',score:null,reused:true,
    errorCode:preview.code || 'EVALUATION_GRADING_DISPUTE',
    errorMessage:'Dvojí posouzení není uzavřené.'};
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

// The first judge's result is an immutable review, not a model score. Only a
// second, independent accepted judge can close the pair. Disagreement remains
// an explicit BLOCKED event and preserves both original judgements.
export function storedGraderReviews(history, plan, collection) {
  const sourceSha256 = collectionEvidenceHash(collection);
  const rows = history._db.prepare(`SELECT * FROM model_evaluation_grader_reviews
    WHERE source_run_id=? ORDER BY recorded_at, review_id`).all(collection.runId);
  return rows.map(row => {
    const summary = JSON.parse(row.summary_json);
    if (acceptanceHash(summary) !== row.summary_sha256 || row.role !== plan.role
      || row.contract_sha256 !== plan.suiteContractSha256
      || summary.grading?.graderAcceptanceId !== row.grader_acceptance_id
      || summary.grading?.graderAcceptanceSha256 !== row.grader_acceptance_sha256)
      fail('EVALUATION_GRADER_REVIEW_TAMPERED');
    if (row.source_sha256 !== sourceSha256 || summary.grading.sourceCollectionSha256 !== sourceSha256)
      fail('EVALUATION_COLLECTION_CHANGED');
    const accepted = plan.acceptance.graders?.find(g => g.id === row.grader_acceptance_id
      && g.payloadSha256 === row.grader_acceptance_sha256);
    if (accepted && (summary.grading.judge?.digestSha256 !== accepted.judge?.digestSha256
      || summary.grading.judge?.providerVersion !== accepted.judge?.providerVersion))
      fail('EVALUATION_GRADER_REVIEW_TAMPERED');
    return { id: row.review_id, summarySha256: row.summary_sha256, accepted,
      summary, recordedAt: row.recorded_at };
  });
}

function gradingProjection(summary) {
  return { score: summary.score, runs: summary.runs, startedAt:summary.startedAt,
    completedAt:summary.completedAt, grading: summary.grading,
    tasks: summary.tasks.map(task => ({ name: task.name, scores: task.scores,
      mean: task.mean, spread: task.spread, details: task.details })) };
}

function comparableDetail(detail) {
  return { valid:detail.valid, score:detail.score, outcome:detail.outcome,
    // Compare the criteria, including each order-specific judgement; the same
    // mean can hide two cancelling mistakes.
    parts:detail.parts?.map(part => ({id:part.id,score:part.score,rawScores:part.rawScores})),
    criteria:detail.criteria, contractChecks:detail.contractChecks };
}

export function reconcileGraderReviews(reviews, plan, collection) {
  if (reviews.length !== 2 || reviews.some(row => !row.accepted))
    return { status:'REVIEW_PENDING_PAIR', disputes:[] };
  const pair = acceptedGraderPair(reviews.map(row => row.accepted),collection.artifact.digestSha256);
  if (!pair || reviews.some(row => !pair.some(g => g.id === row.accepted.id)))
    return { status:'REVIEW_PAIR_NOT_INDEPENDENT', disputes:[] };
  const [a,b] = reviews.map(row => row.summary), disputes = [];
  if (a.grading.status !== 'GRADED' || b.grading.status !== 'GRADED'
    || !Number.isFinite(a.score) || !Number.isFinite(b.score)
    || a.tasks.length !== b.tasks.length || a.tasks.length !== plan.taskCount)
    return { status:'REVIEW_INCOMPLETE', disputes:[] };
  for (let i = 0; i < a.tasks.length; i++) {
    const x = a.tasks[i], y = b.tasks[i];
    if (x.name !== y.name || x.details.length !== y.details.length || x.details.length !== plan.repeats)
      return { status:'REVIEW_INCOMPLETE', disputes:[] };
    for (let j = 0; j < x.details.length; j++) {
      if (JSON.stringify(comparableDetail(x.details[j])) !== JSON.stringify(comparableDetail(y.details[j])))
        disputes.push({task:x.name,repeat:j+1,first:x.details[j].score,second:y.details[j].score,
          firstParts:x.details[j].parts || null,secondParts:y.details[j].parts || null});
    }
  }
  if (disputes.length || a.score !== b.score) return { status:'REVIEW_DISPUTED', disputes };
  const tasks = a.tasks.map((graded,i) => {
    const source = collection.tasks.find(task => task.name === graded.name);
    const definition = plan.suite.tests.find(task => task.name === graded.name);
    if (!source || !definition) fail('EVALUATION_COLLECTION_TASKS_MISMATCH');
    return { ...source,rubric:definition.rubric || [],scores:graded.scores,
      mean:graded.mean,spread:graded.spread,
      details:graded.details.map((detail,j) => ({...detail,
        graderReviews:reviews.map(row => ({reviewId:row.id,graderAcceptanceId:row.accepted.id,
          score:row.summary.tasks[i].details[j].score,
          parts:row.summary.tasks[i].details[j].parts || null}))})) };
  });
  return { status:'GRADED', disputes:[], summary:{score:a.score,runs:plan.repeats,tasks,
    startedAt:a.startedAt,
    completedAt:new Date().toISOString(),
    grading:{version:2,status:'GRADED',sourceCollectionRunId:collection.runId,
      sourceCollectionSha256:collectionEvidenceHash(collection),
      sourceContractSha256:collection.contractSha256,targetContractSha256:plan.suiteContractSha256,
      graders:reviews.map(row => ({id:row.accepted.id,payloadSha256:row.accepted.payloadSha256,
        judge:row.accepted.judge,reviewId:row.id,reviewSha256:row.summarySha256}))}} };
}

function verifyGradedSummary(plan, source, summary) {
  const grading = summary?.grading;
  if (grading?.version !== 1 || grading.sourceCollectionRunId !== source.runId
    || grading.sourceCollectionSha256 !== collectionEvidenceHash(source)
    || grading.sourceContractSha256 !== source.contractSha256
    || grading.targetContractSha256 !== plan.suiteContractSha256
    || summary.runs !== plan.repeats || !Array.isArray(summary.tasks)
    || summary.tasks.length !== plan.taskCount
    || grading.planned !== plan.taskCount * plan.repeats
    || grading.observed !== grading.planned) fail('EVALUATION_GRADING_SUMMARY_INVALID');
  let invalid = 0;
  for (const definition of plan.suite.tests) {
    const task = summary.tasks.find(row => row.name === definition.name);
    const captured = source.tasks.find(row => row.name === definition.name);
    if (!task || !captured || summary.tasks.filter(row => row.name === definition.name).length !== 1
      || acceptanceHash(task.input) !== acceptanceHash(captured.input)
      || acceptanceHash(task.options) !== acceptanceHash(captured.options)
      || acceptanceHash(task.responses) !== acceptanceHash(captured.responses)
      || task.scores?.length !== plan.repeats || task.details?.length !== plan.repeats)
      fail('EVALUATION_GRADING_SUMMARY_INVALID');
    for (let i = 0; i < plan.repeats; i++) {
      const detail = task.details[i], capture = captured.details[i];
      const score = task.scores[i];
      if (!detail || detail.repeat !== capture.repeat
        || detail.captureStatus !== capture.captureStatus
        || acceptanceHash(detail.artifact) !== acceptanceHash(capture.artifact)
        || detail.score !== score || detail.valid !== Number.isFinite(score)
        || (Number.isFinite(score) && (score < 0 || score > 1)))
        fail('EVALUATION_GRADING_SUMMARY_INVALID');
      if (!Number.isFinite(score)) invalid++;
    }
    const scoresValid = task.scores.every(Number.isFinite);
    if (task.mean !== (scoresValid ? mean(task.scores) : null)
      || task.spread !== (scoresValid ? Math.max(...task.scores) - Math.min(...task.scores) : null))
      fail('EVALUATION_GRADING_SUMMARY_INVALID');
  }
  if (grading.invalid !== invalid
    || grading.status !== (invalid ? 'GRADING_INCOMPLETE' : 'GRADED')
    || summary.score !== (invalid ? null : mean(summary.tasks.map(task => task.mean))))
    fail('EVALUATION_GRADING_SUMMARY_INVALID');
}

export function persistGradedCollection({ history, plan, collection, summary }) {
  return history._db.transaction(() => persist({ history, plan, collection, summary })).immediate();
}

function persist({ history, plan, collection, summary }) {
  const source = history.getRun(collection.runId);
  const accepted = plan.acceptance.graders?.find(g => g.id === summary.grading?.graderAcceptanceId
    && g.payloadSha256 === summary.grading?.graderAcceptanceSha256);
  if (!source || collectionEvidenceHash(source) !== summary.grading?.sourceCollectionSha256)
    fail('EVALUATION_COLLECTION_CHANGED');
  if (!accepted) fail('EVALUATION_GRADER_ACCEPTANCE_MISSING');
  verifyGradedSummary(plan,source,summary);
  history.setProviderVersion(source.providerVersion);
  const input = { artifact:source.artifact,role:plan.role,suiteName:plan.suiteName,
    suiteVersion:plan.suiteVersion,contractSha256:plan.suiteContractSha256,
    hardware:source.hardware,vramBytes:source.vramBytes,fresh:true,
    startedAt:summary.startedAt,completedAt:summary.completedAt,
    metadata:{source:'accepted-collection-grading-v2',grading:summary.grading} };
  if (summary.grading.status !== 'GRADED' || !Number.isFinite(summary.score))
    return history.recordTerminal({...input,status:'BLOCKED',repeats:summary.runs,tasks:summary.tasks,
      errorCode:'EVALUATION_GRADING_INCOMPLETE',
      errorMessage:'Hodnotitel nevydal platnou známku pro všechny pokusy. Souhrnné skóre nebylo vydáno.'});
  const existing = storedGraderReviews(history,plan,source);
  if (existing.some(row => row.accepted?.id === accepted.id)) fail('EVALUATION_GRADER_REVIEW_ALREADY_RECORDED');
  const projected = gradingProjection(summary), reviewId = `review_${randomUUID()}`;
  history._db.prepare(`INSERT INTO model_evaluation_grader_reviews
    (review_id,source_run_id,role,contract_sha256,source_sha256,grader_acceptance_id,
      grader_acceptance_sha256,summary_json,summary_sha256) VALUES (?,?,?,?,?,?,?,?,?)`).run(
    reviewId,source.runId,plan.role,plan.suiteContractSha256,summary.grading.sourceCollectionSha256,
    accepted.id,accepted.payloadSha256,JSON.stringify(projected),acceptanceHash(projected));
  const reviews = storedGraderReviews(history,plan,source).filter(row => row.accepted);
  const pair = acceptedGraderPair(reviews.map(row => row.accepted),source.artifact.digestSha256);
  const reconciled = reconcileGraderReviews(pair
    ? reviews.filter(row => pair.some(g => g.id === row.accepted.id)) : reviews,plan,source);
  if (reconciled.status === 'GRADED') {
    // Re-check both acceptances under the same transaction as the COMPLETE row.
    if (!reconciled.summary.grading.graders.every(g => plan.acceptance.graders?.some(a =>
      a.id === g.id && a.payloadSha256 === g.payloadSha256))) fail('EVALUATION_GRADER_ACCEPTANCE_MISSING');
    return history.recordComplete({...input,metadata:{source:'accepted-collection-grading-v2',
      grading:reconciled.summary.grading},summary:reconciled.summary});
  }
  return history.recordTerminal({...input,status:'BLOCKED',repeats:summary.runs,tasks:[],
    metadata:{source:'accepted-collection-grading-v2',reviewId,reviewStatus:reconciled.status,
      sourceCollectionRunId:source.runId,disputes:reconciled.disputes},
    errorCode:reconciled.status === 'REVIEW_DISPUTED' ? 'EVALUATION_GRADING_DISPUTE'
      : 'EVALUATION_REVIEW_PENDING_PAIR',
    errorMessage:reconciled.status === 'REVIEW_DISPUTED'
      ? 'Dva nezávislé posudky se liší po kritériích. Skóre čeká na rozsouzení.'
      : 'První posudek je uložený; skóre čeká na druhého nezávislého hodnotitele.'});
}
