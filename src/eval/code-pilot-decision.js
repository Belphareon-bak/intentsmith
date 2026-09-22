// Bounded CODE pilot (§6/§8). Pure recommendation; never applies bindings,
// deletes models, or promotes exploratory benchmark rows to decision evidence.
import { createHash } from 'node:crypto';

const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object'
  && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export function codePilotPlanHash(plan) {
  const { planSha256, ...material } = plan;
  return createHash('sha256').update(canonical(material)).digest('hex');
}

// §4: environment faults have no score; exhausting an allowed operational
// budget is a visible zero. The independently verified final state takes
// precedence over a stale loop reason when completion stayed inside budget.
export function classifyCodePilotOutcome({ invalid, success, operationalFailure, loopReason }) {
  if (invalid) return { valid:false, score:null, outcome:'ENVIRONMENT_INVALID' };
  if (success) return { valid:true, score:1, outcome:'SUCCESS' };
  const operational = operationalFailure || ['budget_exhausted','oscillation_detected'].includes(loopReason);
  return { valid:true, score:0, outcome:operational ? 'OPERATIONAL_FAILURE' : 'INCORRECT' };
}

export function validateCodePilotPlan(plan) {
  return validatePairedPlan(plan, 'CODE', 'completed_without_repair_help');
}

// Shared arithmetic, explicit caller-owned workflow/metric. The CODE entrypoint
// remains strict so old callers cannot silently reinterpret another role.
export function validatePairedPlan(plan, role, metric) {
  const fail = message => { throw new Error(`CODE_PILOT_PLAN_INVALID: ${message}`); };
  if (plan?.schemaVersion !== 1 || plan.role !== role || plan.metric !== metric) fail('metric');
  if (plan.planSha256 !== codePilotPlanHash(plan)) fail('seal');
  if (!Number.isFinite(Date.parse(plan.lockedAt))) fail('lockedAt');
  if (!Number.isInteger(plan.repeats) || plan.repeats < 1) fail('repeats');
  const rule = plan.decision;
  if (rule?.method !== 'hoeffding-kl-bounded-groups' || !(rule.alpha > 0 && rule.alpha < 1)
    || !(rule.minimumBenefit > 0 && rule.minimumBenefit < 1)
    || !(rule.nonInferiorityMargin >= 0 && rule.nonInferiorityMargin < 1)
    || !(rule.minimumSpeedup > 1) || typeof rule.allowSpeedDecision !== 'boolean') fail('decision');
  if (!Number.isSafeInteger(plan.budget?.attemptMs) || !(plan.budget.attemptMs > 0)
    || !Number.isSafeInteger(plan.budget?.totalMs) || !(plan.budget.totalMs > 0)) fail('budget');
  if (!(plan.profile?.numCtx > 0) || !(plan.profile?.maxVramBytes > 0)) fail('profile');
  for (const key of ['incumbent', 'candidate']) {
    if (!plan[key]?.model || !/^[a-f0-9]{64}$/.test(plan[key].digest || '')) fail(key);
  }
  if (plan.incumbent.digest === plan.candidate.digest) fail('identical artifacts');
  if (!Array.isArray(plan.scenarios) || !plan.scenarios.length) fail('scenarios');
  const ids = new Set();
  for (const scenario of plan.scenarios) {
    if (!scenario.id || ids.has(scenario.id) || !scenario.independenceGroup
      || !scenario.groupRationale || !/^[a-f0-9]{64}$/.test(scenario.contentSha256 || '')) fail('scenario identity');
    ids.add(scenario.id);
  }
  return true;
}

// Invert the bounded-variable Chernoff/Hoeffding KL bound, with alpha/2
// in each tail. Group means are in [-1,1], transformed to [0,1]. This is
// conservative and conditional on independent groups, not proof that a
// curated set represents every future CODE task. Hoeffding (1963), §2.
export function boundedGroupInterval(values, alpha) {
  if (!values.length || !(alpha > 0 && alpha < 1)
    || values.some(x => !Number.isFinite(x) || x < -1 || x > 1)) throw new Error('INVALID_GROUP_VALUES');
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const p = (mean + 1) / 2;
  const limit = Math.log(2 / alpha) / values.length;
  const kl = q => (p ? p * Math.log(p / q) : 0) + (p < 1 ? (1 - p) * Math.log((1 - p) / (1 - q)) : 0);
  const root = lower => {
    if (lower && p === 0) return 0;
    if (!lower && p === 1) return 1;
    let lo = lower ? 0 : p, hi = lower ? p : 1;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if ((kl(mid) > limit) === lower) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return { mean, lower: 2 * root(true) - 1, upper: 2 * root(false) - 1,
    groups: values.length, confidence: 1 - alpha, independenceAssumed: true };
}

export function decideCodePilot(plan, attempts, qualifications = {}) {
  validateCodePilotPlan(plan);
  return decidePairedPlan(plan, attempts, qualifications);
}

export function decidePairedPlan(plan, attempts, qualifications = {}) {
  const result = { verdict: 'NEROZHODNUTO', bindingAction: 'UNCHANGED', activationAuthorized: false,
    planSha256: plan.planSha256, plannedAttempts: plan.scenarios.length * plan.repeats * 2,
    observedAttempts: attempts.length, invalidAttempts: [], missingAttempts: [], groups: [],
    qualityInterval: null, reason: null };
  const indexed = new Map();
  const outcomeCounts = {};
  result.outcomeCounts = outcomeCounts;
  for (const row of attempts) {
    outcomeCounts[row.outcome || 'UNKNOWN'] = (outcomeCounts[row.outcome || 'UNKNOWN'] || 0) + 1;
    const key = `${row.scenario}/${row.repeat}/${row.side}`;
    if (indexed.has(key) || !plan.scenarios.some(s => s.id === row.scenario)
      || !['candidate', 'incumbent'].includes(row.side)
      || !Number.isInteger(row.repeat) || row.repeat < 1 || row.repeat > plan.repeats) throw new Error('CODE_PILOT_ATTEMPT_IDENTITY');
    indexed.set(key, row);
    const validOutcome = ['SUCCESS', 'INCORRECT', 'OPERATIONAL_FAILURE'].includes(row.outcome);
    if (row.planSha256 !== plan.planSha256 || row.digest !== plan[row.side].digest
      || !Number.isFinite(Date.parse(row.startedAt)) || Date.parse(row.startedAt) < Date.parse(plan.lockedAt)
      || !validOutcome || row.valid !== true || ![0, 1].includes(row.score)
      || (row.outcome === 'SUCCESS') !== (row.score === 1)
      || !Number.isFinite(row.durationMs) || row.durationMs <= 0
      || (row.score === 1 && (row.durationMs > plan.budget.attemptMs || row.repairHelp !== 0))) {
      result.invalidAttempts.push({ key, outcome: row.outcome, reason: row.reason || 'UNVERIFIED_ATTEMPT' });
    }
  }
  if (attempts.reduce((sum, row) => sum + (Number.isFinite(row.durationMs) ? row.durationMs : 0), 0) > plan.budget.totalMs) {
    result.reason = 'TOTAL_BUDGET_EXCEEDED'; return result;
  }
  const perGroup = new Map();
  for (const scenario of plan.scenarios) {
    const deltas = [], candidateTimes = [], incumbentTimes = [];
    for (let repeat = 1; repeat <= plan.repeats; repeat++) {
      const pair = ['candidate', 'incumbent'].map(side => {
        const key = `${scenario.id}/${repeat}/${side}`;
        if (!indexed.has(key)) result.missingAttempts.push(key);
        return indexed.get(key);
      });
      if (pair.every(row => row?.valid && Number.isFinite(row.score))) {
        deltas.push(pair[0].score - pair[1].score);
        // Budget-consuming failures remain in timing as the full cap.
        candidateTimes.push(pair[0].score ? pair[0].durationMs : plan.budget.attemptMs);
        incumbentTimes.push(pair[1].score ? pair[1].durationMs : plan.budget.attemptMs);
      }
    }
    const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
    if (!perGroup.has(scenario.independenceGroup)) perGroup.set(scenario.independenceGroup, []);
    perGroup.get(scenario.independenceGroup).push({ scenario: scenario.id, delta: mean(deltas),
      candidateMs: mean(candidateTimes), incumbentMs: mean(incumbentTimes) });
  }
  if (result.invalidAttempts.length || result.missingAttempts.length) {
    result.reason = 'INCOMPLETE_PAIRED_EVIDENCE'; return result;
  }
  for (const [group, rows] of perGroup) result.groups.push({ group, scenarios: rows.map(r => r.scenario),
    delta: rows.reduce((sum, r) => sum + r.delta, 0) / rows.length,
    candidateMs: rows.reduce((sum, r) => sum + r.candidateMs, 0) / rows.length,
    incumbentMs: rows.reduce((sum, r) => sum + r.incumbentMs, 0) / rows.length });
  result.qualityInterval = boundedGroupInterval(result.groups.map(g => g.delta), plan.decision.alpha);
  for (const side of ['incumbent', 'candidate']) {
    const q = qualifications[side];
    if (!q || q.planSha256 !== plan.planSha256 || q.digest !== plan[side].digest || q.status !== 'QUALIFIED') {
      result.reason = 'PROFILE_NOT_QUALIFIED'; return result;
    }
  }
  const interval = result.qualityInterval;
  result.speedup = result.groups.reduce((s, g) => s + g.incumbentMs, 0)
    / result.groups.reduce((s, g) => s + g.candidateMs, 0);
  if (interval.lower > plan.decision.minimumBenefit) {
    result.verdict = 'ZMENIT'; result.reason = 'QUALITY_BENEFIT';
  } else if (plan.decision.allowSpeedDecision && interval.lower > -plan.decision.nonInferiorityMargin
    && result.speedup >= plan.decision.minimumSpeedup) {
    result.verdict = 'ZMENIT'; result.reason = 'SPEED_WITH_NONINFERIOR_QUALITY';
  } else if (interval.upper < -plan.decision.nonInferiorityMargin) {
    result.verdict = 'PONECHAT'; result.reason = 'CANDIDATE_QUALITY_LOSS';
  } else result.reason = 'INSUFFICIENT_EVIDENCE';
  // Recommendation only. Application always remains a separate authority.
  return result;
}
