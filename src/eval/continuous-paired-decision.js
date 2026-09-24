// Paired candidate/incumbent decision over continuous rubric scores in [0,1]
// (schema 2). Kept apart from the schema-1 binary completion plans, which
// stay KL-only: this plan seals the metric, the rubric contract with its grader
// acceptance, and the accepted feasibility evidence for the exact method, alpha,
// margins and group count. The helper computing an interval is not evidence
// that the method is safe for the role. Recommendation only.
import { DECISION_METHODS } from './decision-methods.js';
import { FEASIBILITY_MODEL_VERSION } from './decision-feasibility.js';
import { validatePairedPlanFields, decideScoredPairs } from './code-pilot-decision.js';

export const CONTINUOUS_PLAN_SCHEMA = 2;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0;

export function validateContinuousPairedPlan(plan, role, metric) {
  const fail = message => { throw new Error(`CONTINUOUS_PAIRED_PLAN_INVALID: ${message}`); };
  if (!text(role) || !text(metric)) fail('expected role and metric');
  if (plan?.schemaVersion !== CONTINUOUS_PLAN_SCHEMA || plan.scoreScale !== 'continuous-0-1'
    || plan.role !== role || plan.metric !== metric) fail('metric');
  validatePairedPlanFields(plan, fail, Object.values(DECISION_METHODS));
  const rubric = plan.rubric;
  if (!text(rubric?.id) || !hash(rubric.contractSha256) || !hash(rubric.graderAcceptanceSha256)) fail('rubric');
  // Planner output is evidence for exactly one plan shape. METHOD_UNSAFE and
  // EXPLORATORY_ONLY never qualify, nor does output of an older data model.
  const rule = plan.decision, evidence = plan.methodEvidence;
  const groups = new Set(plan.scenarios.map(s => s.independenceGroup)).size;
  if (evidence?.feasibilityModelVersion !== FEASIBILITY_MODEL_VERSION || evidence.verdict !== 'FEASIBLE'
    || evidence.orientation !== 'candidate-minus-incumbent'
    || evidence.method !== rule.method || evidence.alpha !== rule.alpha
    || evidence.minimumBenefit !== rule.minimumBenefit || evidence.nonInferiorityMargin !== rule.nonInferiorityMargin
    || evidence.groups !== groups || !hash(evidence.reportSha256)) fail('method evidence');
  const accepted = evidence.acceptance;
  if (accepted?.status !== 'ACCEPTED' || !text(accepted.acceptedBy)
    || !(Date.parse(accepted.acceptedAt) <= Date.parse(plan.lockedAt))) fail('method acceptance');
  return true;
}

// A graded attempt carries its rubric binding and grade record; an operational
// failure (timeout, crash) is a visible zero that costs the full attempt budget.
const CONTINUOUS_SCORING = Object.freeze({
  schemaVersion: CONTINUOUS_PLAN_SCHEMA,
  valid: (row, plan) => Number.isFinite(row.score) && row.score >= 0 && row.score <= 1
    && (row.outcome === 'GRADED'
      ? row.durationMs <= plan.budget.attemptMs && row.rubricContractSha256 === plan.rubric.contractSha256
        && hash(row.gradeSha256)
      : row.outcome === 'OPERATIONAL_FAILURE' && row.score === 0),
  timeMs: (row, plan) => (row.outcome === 'GRADED' ? row.durationMs : plan.budget.attemptMs),
});

export function decideContinuousPairedPlan(plan, attempts, qualifications = {}, { role, metric } = {}) {
  validateContinuousPairedPlan(plan, role, metric);
  return decideScoredPairs(plan, attempts, qualifications, CONTINUOUS_SCORING);
}
