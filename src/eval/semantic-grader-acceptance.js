// Independent labelled acceptance for T4. Author-written probes alone are never
// enough. All denominators and errors are recomputed from the sealed answers;
// a supplied PASS/average is not trusted.
import { createHash } from 'node:crypto';
import { SEMANTIC_JUDGE_VERSION, SEMANTIC_JUDGE_OPTIONS } from './semantic-evaluation-judge.js';

export const semanticEvidenceHash = value => createHash('sha256').update(JSON.stringify(value,
  (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest('hex');
export const semanticGraderContract = () => semanticEvidenceHash({ version: SEMANTIC_JUDGE_VERSION, options: SEMANTIC_JUDGE_OPTIONS });
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const requireValue = (ok, why) => { if (!ok) throw new Error(`SEMANTIC_ACCEPTANCE_INVALID:${why}`); };
const mean = values => values.reduce((sum, x) => sum + x, 0) / values.length;
const validScores = scores => Array.isArray(scores) && scores.length > 0 && scores.every(s => [0, .25, .5, .75, 1].includes(s));
const time = value => Number.isFinite(Date.parse(value));
export const semanticAcceptancePlanHash = plan => {
  const { planSha256, ...material } = plan;
  return semanticEvidenceHash(material);
};

export function validateSemanticAcceptance(evidence, identity) {
  const p = evidence?.plan;
  requireValue(p?.version === 1 && p.role === identity.role && p.contractSha256 === identity.contractSha256
    && p.runtimeSha256 === identity.runtimeSha256 && p.planSha256 === semanticAcceptancePlanHash(p)
    && time(p.lockedAt) && p.graderContractSha256 === semanticGraderContract(), 'plan');
  requireValue(hash(p.judge?.digestSha256) && text(p.judge.modelName) && text(p.judge.providerVersion), 'judge identity');
  requireValue(p.labels?.blindToModel === true && p.labels.blindToJudge === true
    && p.labels.disputesResolved === true && text(p.labels.reviewer)
    && text(p.labels.reference) && time(p.labels.reviewedAt)
    && Date.parse(p.labels.reviewedAt) <= Date.parse(p.lockedAt), 'independent labels');
  requireValue(Array.isArray(p.developmentGroups) && p.developmentGroups.length > 0
    && p.developmentGroups.every(text) && Array.isArray(p.developmentAnswerSha256)
    && p.developmentAnswerSha256.every(hash), 'development split');
  const rule = p.rule;
  requireValue(rule?.passThreshold === .7
    && Number.isSafeInteger(rule.minimumIndependentGroups) && rule.minimumIndependentGroups >= 20
    && Number.isSafeInteger(rule.minimumPerClass) && rule.minimumPerClass >= 8
    && [rule.maxFalsePositiveRate, rule.maxFalseNegativeRate, rule.maxMeanAbsoluteError]
      .every(x => Number.isFinite(x) && x >= 0 && x <= .1)
    && Number.isFinite(rule.maxOrderDifference) && rule.maxOrderDifference >= 0 && rule.maxOrderDifference <= .15, 'locked rule');
  requireValue(Array.isArray(p.cases) && p.cases.length > 0 && Array.isArray(evidence.results)
    && evidence.results.length === p.cases.length && new Set(p.cases.map(c => c.id)).size === p.cases.length
    && new Set(evidence.results.map(c => c.id)).size === p.cases.length, 'complete sample');
  const seenAnswers = new Set(), origins = new Map(), types = new Map();
  const results = new Map(evidence.results.map(r => [r.id, r]));
  const taskNames = new Set(identity.tasks.filter(t => t.tier === 'T4').map(t => t.name));
  const coveredTasks = new Set();
  for (const c of p.cases) {
    const task = identity.tasks.find(t => t.name === c.task);
    requireValue(text(c.id) && taskNames.has(c.task) && text(c.type) && text(c.independenceGroup)
      && hash(c.originSha256) && hash(c.answerSha256) && hash(c.answerArtifactDigestSha256)
      && c.answerArtifactDigestSha256 !== p.judge.digestSha256
      && validScores(c.expectedScores) && c.expectedScores.length === task?.criterionCount
      && c.type === task?.taskType, 'label identity or self grading');
    requireValue(!p.developmentGroups.includes(c.independenceGroup) && !p.developmentGroups.includes(c.originSha256)
      && !p.developmentAnswerSha256.includes(c.answerSha256) && !seenAnswers.has(c.answerSha256), 'holdout overlap');
    requireValue(!origins.has(c.originSha256) || origins.get(c.originSha256) === c.independenceGroup, 'split origin');
    seenAnswers.add(c.answerSha256); origins.set(c.originSha256, c.independenceGroup); coveredTasks.add(c.task);
    const r = results.get(c.id);
    requireValue(r?.planSha256 === p.planSha256 && r.answerSha256 === c.answerSha256
      && time(r.startedAt) && Date.parse(r.startedAt) >= Date.parse(p.lockedAt)
      && time(r.completedAt) && Date.parse(r.completedAt) >= Date.parse(r.startedAt)
      && Date.parse(r.completedAt) <= Date.parse(identity.completedAt) && Date.parse(r.completedAt) <= Date.now()
      && r.labelsSuppliedToJudge === false, 'result provenance');
    const scores = [];
    for (const order of ['forward', 'reverse']) {
      const prediction = r[order];
      requireValue(prediction?.artifact?.digestSha256 === p.judge.digestSha256
        && prediction.artifact.providerVersion === p.judge.providerVersion
        && hash(prediction.inputSha256) && hash(prediction.responseSha256)
        && validScores(prediction.scores) && prediction.scores.length === c.expectedScores.length
        && prediction.evidence?.length === c.expectedScores.length && prediction.evidence.every(text), `prediction ${order}`);
      scores.push(mean(prediction.scores));
    }
    const expected = mean(c.expectedScores), predicted = mean(scores);
    const error = mean(c.expectedScores.map((s, i) => Math.abs(s - (r.forward.scores[i] + r.reverse.scores[i]) / 2)));
    const row = { id: c.id, group: c.independenceGroup, positive: expected >= rule.passThreshold,
      falsePositive: expected < rule.passThreshold && predicted >= rule.passThreshold,
      falseNegative: expected >= rule.passThreshold && predicted < rule.passThreshold,
      error, orderDifference: Math.abs(scores[0] - scores[1]) };
    if (!types.has(c.type)) types.set(c.type, []);
    types.get(c.type).push(row);
  }
  requireValue(coveredTasks.size === taskNames.size, 'task coverage');
  const metrics = {};
  for (const [type, rows] of types) {
    // Several repeats/answers from an origin contribute one group, never N
    // independent observations. Use the worst error inside that group.
    const groups = [...new Set(rows.map(r => r.group))].map(group => rows.filter(r => r.group === group));
    const positives = groups.filter(g => g.some(r => r.positive));
    const negatives = groups.filter(g => g.some(r => !r.positive));
    const fp = negatives.filter(g => g.some(r => r.falsePositive)).length;
    const fn = positives.filter(g => g.some(r => r.falseNegative)).length;
    metrics[type] = { answers: rows.length, independentGroups: groups.length, positives: positives.length,
      negatives: negatives.length, falsePositives: fp, falseNegatives: fn,
      falsePositiveRate: fp / negatives.length, falseNegativeRate: fn / positives.length,
      meanAbsoluteError: mean(groups.map(g => Math.max(...g.map(r => r.error)))),
      maxOrderDifference: Math.max(...rows.map(r => r.orderDifference)) };
    const m = metrics[type];
    requireValue(groups.length >= rule.minimumIndependentGroups && positives.length >= rule.minimumPerClass
      && negatives.length >= rule.minimumPerClass, `insufficient ${type}`);
    requireValue(m.falsePositiveRate <= rule.maxFalsePositiveRate && m.falseNegativeRate <= rule.maxFalseNegativeRate
      && m.meanAbsoluteError <= rule.maxMeanAbsoluteError && m.maxOrderDifference <= rule.maxOrderDifference, `quality ${type}`);
  }
  return { judge: p.judge, graderContractSha256: p.graderContractSha256, planSha256: p.planSha256, metrics };
}
