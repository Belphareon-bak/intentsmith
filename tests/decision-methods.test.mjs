// Paired decision methods and pre-collection feasibility. Synthetic, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DECISION_METHODS, PAIRED_T_MINIMUM_GROUPS, studentTCdf, studentTQuantile,
  pairedTGroupInterval, groupInterval } from '../src/eval/decision-methods.js';
import { boundedGroupInterval, codePilotPlanHash, validateCodePilotPlan, decideCodePilot, decidePairedPlan } from '../src/eval/code-pilot-decision.js';
import { acceptanceRate, allowedFalseAccept, requiredGroups, planFeasibility, calibrateAlpha, boundedPopulation,
  boundedNormal, censoredNormalMean, normalCdf, orientedPairPools, describePopulations,
  FEASIBILITY_MODEL_VERSION, POPULATION_MEAN_TOLERANCE } from '../src/eval/decision-feasibility.js';
import { decideContinuousPairedPlan, validateContinuousPairedPlan } from '../src/eval/continuous-paired-decision.js';
import { decideRoleOperational } from '../src/eval/role-operational-decision.js';

test('Student t quantiles match reference values', () => {
  // scipy.stats.t.ppf(0.975, df)
  for (const [df, q] of [[1, 12.706204736], [5, 2.570581836], [19, 2.093024054], [39, 2.022690901], [100, 1.983971519]])
    assert.ok(Math.abs(studentTQuantile(0.975, df) - q) < 1e-6, `df=${df}`);
  assert.equal(studentTCdf(0, 7), 0.5);
  assert.ok(Math.abs(studentTCdf(-2, 9) + studentTCdf(2, 9) - 1) < 1e-12);
  assert.ok(Math.abs(studentTQuantile(0.025, 19) + 2.093024054) < 1e-6);
});

test('paired t interval uses observed variance and needs enough groups', () => {
  const values = Array.from({ length: 20 }, (_, i) => (i % 2 ? 0.2 : 0));
  const r = pairedTGroupInterval(values, 0.05);
  const sd = Math.sqrt(20 * 0.01 / 19), half = 2.093024054 * sd / Math.sqrt(20);
  assert.ok(Math.abs(r.mean - 0.1) < 1e-12 && Math.abs(r.lower - (0.1 - half)) < 1e-6 && Math.abs(r.upper - (0.1 + half)) < 1e-6);
  const few = pairedTGroupInterval(values.slice(0, PAIRED_T_MINIMUM_GROUPS - 1), 0.05);
  assert.deepEqual([few.lower, few.upper, few.reason], [-1, 1, 'TOO_FEW_GROUPS']);
  assert.throws(() => pairedTGroupInterval([0.5, 2], 0.05), /INVALID_GROUP_VALUES/);
  const clipped = pairedTGroupInterval([...Array(10).fill(1), ...Array(10).fill(-1)], 0.05);
  assert.ok(clipped.lower >= -1 && clipped.upper <= 1);
});

test('KL stays available unchanged; unknown methods fail closed', () => {
  const values = Array(20).fill(0.17);
  assert.equal(groupInterval(values, 0.05, DECISION_METHODS.KL_BOUNDED).lower, boundedGroupInterval(values, 0.05).lower);
  // The variance-free KL bound cannot see that all 20 groups agree; t can.
  assert.ok(boundedGroupInterval(values, 0.05).lower < 0);
  assert.ok(groupInterval(values, 0.05, DECISION_METHODS.PAIRED_T).lower > 0.04);
  assert.throws(() => groupInterval(values, 0.05, 'mean-of-vibes'), /UNKNOWN_DECISION_METHOD/);
});

function plan(method, groups, extra = {}) {
  const p = { schemaVersion: 1, role: 'CODE', metric: 'completed_without_repair_help', lockedAt: '2026-01-01T00:00:00Z',
    repeats: 1, decision: { method, alpha: 0.05, minimumBenefit: 0.04, nonInferiorityMargin: 0.05,
      minimumSpeedup: 1.25, allowSpeedDecision: false },
    budget: { attemptMs: 1000, totalMs: 1e8 }, profile: { numCtx: 16384, maxVramBytes: 22e9 },
    incumbent: { model: 'a', digest: 'a'.repeat(64) }, candidate: { model: 'b', digest: 'b'.repeat(64) },
    scenarios: Array.from({ length: groups }, (_, i) => ({ id: `case${i}`, independenceGroup: `group${i}`,
      groupRationale: 'distinct', contentSha256: 'c'.repeat(64) })), ...extra };
  p.planSha256 = codePilotPlanHash(p);
  return p;
}
const RUBRIC = { id: 'chat-conversation.test', contractSha256: 'd'.repeat(64), graderAcceptanceSha256: 'e'.repeat(64) };
function methodEvidence(method, groups, overrides = {}) {
  return { feasibilityModelVersion: FEASIBILITY_MODEL_VERSION, verdict: 'FEASIBLE', orientation: 'candidate-minus-incumbent',
    method, alpha: 0.05, minimumBenefit: 0.04, nonInferiorityMargin: 0.05, groups, reportSha256: 'f'.repeat(64),
    acceptance: { status: 'ACCEPTED', acceptedBy: 'operator', acceptedAt: '2025-12-31T00:00:00Z' }, ...overrides };
}
function continuousPlan(method, groups, { evidence, decision } = {}) {
  const p = plan(method, groups, { schemaVersion: 2, scoreScale: 'continuous-0-1', role: 'CHAT', metric: 'chat_rubric_score',
    rubric: RUBRIC, methodEvidence: evidence === undefined ? methodEvidence(method, groups) : evidence });
  if (decision) { Object.assign(p.decision, decision); p.planSha256 = codePilotPlanHash(p); }
  return p;
}
const CHAT = { role: 'CHAT', metric: 'chat_rubric_score' };
function graded(p, score, ms = { candidate: 100, incumbent: 100 }) {
  return p.scenarios.flatMap((s, i) => ['candidate', 'incumbent'].map(side => ({ scenario: s.id, repeat: 1, side,
    planSha256: p.planSha256, digest: p[side].digest, startedAt: '2026-01-02T00:00:00Z', valid: true,
    score: score(side, i), outcome: 'GRADED', rubricContractSha256: RUBRIC.contractSha256, gradeSha256: '9'.repeat(64),
    durationMs: ms[side] })));
}
function attempts(p, candidateWins) {
  return p.scenarios.flatMap((s, i) => ['candidate', 'incumbent'].map(side => {
    const success = side === 'incumbent' || i < candidateWins ? true : i % 4 !== 0;
    const score = side === 'candidate' ? 1 : (i < candidateWins ? 0 : 1);
    return { scenario: s.id, repeat: 1, side, planSha256: p.planSha256, digest: p[side].digest,
      startedAt: '2026-01-02T00:00:00Z', valid: true, score, outcome: score ? 'SUCCESS' : 'INCORRECT',
      repairHelp: 0, durationMs: 100, success };
  }));
}
const qualified = p => Object.fromEntries(['candidate', 'incumbent'].map(side => [side,
  { status: 'QUALIFIED', digest: p[side].digest, planSha256: p.planSha256 }]));

test('binary schema-1 plans keep KL: CODE and role workflow reject paired t', () => {
  assert.throws(() => validateCodePilotPlan(plan(DECISION_METHODS.PAIRED_T, 12)), /decision/);
  assert.equal(validateCodePilotPlan(plan(DECISION_METHODS.KL_BOUNDED, 6)), true);
  const sealed = plan(DECISION_METHODS.KL_BOUNDED, 12);
  sealed.decision.method = DECISION_METHODS.PAIRED_T; // swapping method after sealing is detected
  assert.throws(() => validateCodePilotPlan(sealed), /seal/);
  // Review 2026-09-24: 20 zero deltas give t [0,0]; with a speed path that was
  // ZMENIT although a 2% rare loss stays unseen in 20 groups with p = 0.98^20.
  const zero = plan(DECISION_METHODS.PAIRED_T, 20);
  zero.decision.allowSpeedDecision = true; zero.planSha256 = codePilotPlanHash(zero);
  assert.throws(() => decideCodePilot(zero, attempts(zero, 0), qualified(zero)), /decision/);
  const role = plan(DECISION_METHODS.PAIRED_T, 12, { role: 'CHAT', metric: 'completed_role_workflow_without_repair_help' });
  assert.throws(() => decideRoleOperational(role, [], qualified(role)), /CODE_PILOT_PLAN_INVALID: decision/);
});

test('continuous schema-2 plan: paired t decides only with accepted method evidence', () => {
  // Candidate wins 12 of 40 independent groups, ties the rest (mean +0.30).
  const t = continuousPlan(DECISION_METHODS.PAIRED_T, 40), k = plan(DECISION_METHODS.KL_BOUNDED, 40);
  const rt = decideContinuousPairedPlan(t, graded(t, (side, i) => (side === 'candidate' && i < 12 ? 1 : side === 'candidate' ? 0.8 : i < 12 ? 0 : 0.8)), qualified(t), CHAT);
  const rk = decideCodePilot(k, attempts(k, 12), qualified(k));
  assert.equal(rt.verdict, 'ZMENIT'); assert.equal(rt.reason, 'QUALITY_BENEFIT');
  assert.equal(rk.verdict, 'NEROZHODNUTO'); assert.equal(rk.reason, 'INSUFFICIENT_EVIDENCE');
  assert.equal(rt.qualityInterval.method, DECISION_METHODS.PAIRED_T);
  // Continuous rubric scores (review: 0.9 vs 0.7 was 40 invalid binary attempts).
  const c = decideContinuousPairedPlan(t, graded(t, side => (side === 'candidate' ? 0.9 : 0.7)), qualified(t), CHAT);
  assert.deepEqual([c.verdict, c.reason, c.invalidAttempts.length], ['ZMENIT', 'QUALITY_BENEFIT', 0]);
  // The binary engine never reads a schema-2 plan, whatever its scores.
  assert.throws(() => decidePairedPlan(t, graded(t, () => 1), qualified(t)), /PAIRED_PLAN_SCHEMA_MISMATCH/);
  assert.throws(() => decideContinuousPairedPlan(t, [], qualified(t)), /expected role and metric/);
  assert.throws(() => validateContinuousPairedPlan(continuousPlan(DECISION_METHODS.PAIRED_T, 6), 'CHAT', 'chat_rubric_score'), /too few groups/);
});

test('continuous plan fails closed without matching, accepted, current method evidence', () => {
  const T = DECISION_METHODS.PAIRED_T, bad = (evidence, message, groups = 20) => assert.throws(
    () => validateContinuousPairedPlan(continuousPlan(T, groups, { evidence }), 'CHAT', 'chat_rubric_score'), message);
  bad(null, /method evidence/);
  for (const verdict of ['METHOD_UNSAFE', 'EXPLORATORY_ONLY']) bad(methodEvidence(T, 20, { verdict }), /method evidence/);
  bad(methodEvidence(T, 20, { feasibilityModelVersion: 'clipped-location-shift-v1' }), /method evidence/);
  bad(methodEvidence(T, 20, { alpha: 0.02 }), /method evidence/);
  bad(methodEvidence(T, 20, { orientation: 'recency' }), /method evidence/);
  bad(methodEvidence(T, 40), /method evidence/);
  bad(methodEvidence(DECISION_METHODS.KL_BOUNDED, 20), /method evidence/);
  bad(methodEvidence(T, 20, { acceptance: { status: 'PROPOSED', acceptedBy: 'operator', acceptedAt: '2025-12-31T00:00:00Z' } }), /method acceptance/);
  bad(methodEvidence(T, 20, { acceptance: { status: 'ACCEPTED', acceptedBy: 'operator', acceptedAt: '2026-01-05T00:00:00Z' } }), /method acceptance/);
  assert.throws(() => validateContinuousPairedPlan(continuousPlan(T, 20), 'CODE', 'chat_rubric_score'), /metric/);
  const p = continuousPlan(T, 20);
  assert.equal(validateContinuousPairedPlan(p, 'CHAT', 'chat_rubric_score'), true);
  // A score from another rubric contract, or outside [0,1], is not paired evidence.
  const rows = graded(p, () => 0.5);
  rows[0].rubricContractSha256 = '0'.repeat(64); rows[2].score = 1.2;
  const r = decideContinuousPairedPlan(p, rows, qualified(p), CHAT);
  assert.deepEqual([r.verdict, r.reason, r.invalidAttempts.length], ['NEROZHODNUTO', 'INCOMPLETE_PAIRED_EVIDENCE', 2]);
});

test('feasibility: KL cannot decide continuous deltas; t keeps false acceptance near alpha/2', () => {
  const common = { alpha: 0.05, sigma: 0.2, sims: 1500, seed: 7 };
  assert.equal(acceptanceRate({ ...common, method: DECISION_METHODS.KL_BOUNDED, groups: 60, trueMean: 0.15, threshold: 0.04 }), 0);
  const fa = acceptanceRate({ ...common, method: DECISION_METHODS.PAIRED_T, groups: 40, trueMean: 0.04, threshold: 0.04 });
  assert.ok(fa <= allowedFalseAccept(0.05, 1500), `false accept ${fa}`);
  const n10 = requiredGroups({ ...common, method: DECISION_METHODS.PAIRED_T, trueMean: 0.10, threshold: 0.04 });
  const n15 = requiredGroups({ ...common, method: DECISION_METHODS.PAIRED_T, trueMean: 0.15, threshold: 0.04 });
  assert.ok(n15 < n10, `${n15} < ${n10}`);
});

test('feasibility verdicts and empirical pools are deterministic', () => {
  const pools = [Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? -0.3 : i % 3 === 1 ? 0 : 0.3))];
  const args = { method: DECISION_METHODS.PAIRED_T, minimumBenefit: 0.04, nonInferiorityMargin: 0.05,
    plannedEffect: 0.10, pools, sims: 400, seed: 3 };
  const small = planFeasibility({ ...args, availableGroups: 12 }), big = planFeasibility({ ...args, availableGroups: 300 });
  assert.equal(small.verdict, 'EXPLORATORY_ONLY');
  assert.equal(big.verdict, 'FEASIBLE');
  assert.deepEqual(planFeasibility({ ...args, availableGroups: 12 }), small);
  const kl = planFeasibility({ ...args, method: DECISION_METHODS.KL_BOUNDED, availableGroups: 300 });
  assert.equal(kl.verdict, 'EXPLORATORY_ONLY');
});

test('calibration: extreme rare drops are blocked, moderate skew gets a safe alpha', () => {
  const base = { method: DECISION_METHODS.PAIRED_T, minimumBenefit: 0.04, nonInferiorityMargin: 0.05,
    availableGroups: 40, plannedEffect: 0.10, sims: 1500, seed: 5 };
  // One -0.6 drop per 40 groups: a third of samples never see it, so no t alpha is safe.
  const extreme = Array.from({ length: 6 }, (_, k) => Array.from({ length: 40 }, (_, i) => (i === k ? -0.6 : 0)));
  const blocked = planFeasibility({ ...base, pools: extreme, calibrate: true });
  assert.equal(blocked.calibration, null);
  assert.equal(blocked.verdict, 'METHOD_UNSAFE');
  // Moderately skewed pools: calibration finds an alpha meeting the nominal tail on fresh draws.
  const moderate = Array.from({ length: 6 }, (_, k) => Array.from({ length: 40 }, (_, i) =>
    ((i + k) % 5 === 0 ? -0.35 : (i + k) % 5 === 1 ? 0.15 : (i + k) % 5 === 2 ? 0.1 : 0.05)));
  const ok = planFeasibility({ ...base, pools: moderate, calibrate: true });
  assert.ok(ok.calibration && ok.alpha <= 0.05);
  assert.ok(ok.quality.falseAcceptAtBoundary <= allowedFalseAccept(0.05, 1500));
  assert.notEqual(ok.verdict, 'METHOD_UNSAFE');
  assert.ok(ok.quality.switchWhenEqual <= ok.quality.falseAcceptAtBoundary);
});

test('bounded population has exactly the reported mean (review: clipping gave -0.056 for +0.04)', () => {
  const exact = (pool, trueMean) => {
    const p = boundedPopulation(pool, trueMean), m = p.values.reduce((a, b) => a + b, 0) / p.values.length;
    assert.ok(Math.abs(m - trueMean) <= POPULATION_MEAN_TOLERANCE, `${trueMean}: ${m}`);
    assert.ok(p.values.every(x => x >= -1 && x <= 1));
    return p;
  };
  const review = exact([-1, -1, -1, 1, 1], 0.04);
  assert.ok(Math.abs(review.shift - 0.2) < 1e-12 && review.boundMass === 0.4 && review.sdRatio < 1);
  exact([-1, -1, -1, 1, 1], 0); exact([-1, 0, ...Array(48).fill(0)], -0.05);
  // Without bound mass the shape is unchanged and simply moved.
  const inside = exact([-0.2, 0, 0.2], 0.1);
  assert.deepEqual([inside.boundMass, inside.shift], [0, 0.1]);
  // Deterministic sweep over pools and means reaching into the bounds.
  let seed = 11; const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 60; k++) {
    const pool = Array.from({ length: 5 + (k % 40) }, () => (next() < 0.3 ? Math.round(next()) * 2 - 1 : next() * 2 - 1));
    for (const trueMean of [-0.6, -0.05, 0, 0.04, 0.1, 0.35, 0.6]) exact(pool, trueMean);
  }
  assert.throws(() => boundedPopulation([0, 1], 1), /OUT_OF_BOUNDS/);
  assert.throws(() => boundedPopulation([0, 1.5], 0), /POOL_INVALID/);
});

test('every null and alternative used in calibration is the population it claims', () => {
  const pools = [[-1, ...Array(39).fill(0)], [-0.6, 0.4, 0, 0, 0.2, -0.2, 1, 0, 0, 0]];
  const r = planFeasibility({ method: DECISION_METHODS.PAIRED_T, minimumBenefit: 0.04, nonInferiorityMargin: 0.05,
    availableGroups: 40, plannedEffect: 0.1, pools, sims: 100, seed: 3, calibrate: true });
  assert.equal(r.population.modelVersion, FEASIBILITY_MODEL_VERSION);
  assert.deepEqual(Object.keys(r.population.at), ['qualityBoundary', 'nonInferiorityBoundary', 'equal', 'plannedEffect']);
  for (const at of Object.values(r.population.at)) assert.ok(at.maxActualMeanError <= POPULATION_MEAN_TOLERANCE);
  assert.ok(r.population.at.nonInferiorityBoundary.poolsWithBoundMass > 0, 'the -1 loss meets the bound');
  for (const alpha of [0.05, 0.02]) for (const trueMean of [0.04, -0.05, 0, 0.1]) {
    const d = describePopulations({ pools }, { m: trueMean }).at.m;
    assert.ok(d.maxActualMeanError <= POPULATION_MEAN_TOLERANCE, `${alpha} ${trueMean}`);
  }
});

test('normal data model: exact CDF and censored mean', () => {
  // scipy.stats.norm.cdf
  for (const [z, p] of [[1.959963984540054, 0.975], [-1, 0.15865525393145707], [3, 0.9986501019683699], [0.5, 0.6914624612740131]])
    assert.ok(Math.abs(normalCdf(z) - p) < 1e-14, `z=${z}`);
  // Censored mean against Simpson integration of the clipped density.
  const simpson = (shift, sigma) => {
    const n = 20000, lo = -1, hi = 1, h = (hi - lo) / n, f = x => x * Math.exp(-(((x - shift) / sigma) ** 2) / 2) / (sigma * Math.sqrt(2 * Math.PI));
    let s = f(lo) + f(hi); for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(lo + i * h);
    return -normalCdf((-1 - shift) / sigma) + 1 - normalCdf((1 - shift) / sigma) + s * h / 3;
  };
  for (const [shift, sigma] of [[0.04, 0.2], [0.7, 1], [-0.5, 0.6]])
    assert.ok(Math.abs(censoredNormalMean(shift, sigma) - simpson(shift, sigma)) < 1e-9);
  const n = boundedNormal(1, 0.5);
  assert.ok(Math.abs(censoredNormalMean(n.shift, 1) - 0.5) <= POPULATION_MEAN_TOLERANCE && n.shift > 0.5 && n.boundMass > 0.4);
  assert.equal(boundedNormal(0, 0.3).shift, 0.3);
  assert.ok(Math.abs(boundedNormal(0.2, 0).shift) < 1e-15, 'symmetric null needs no shift');
});

test('paired pools are candidate - incumbent and independent of run recency and row order', () => {
  // Review fixture: 50 groups, the incumbent succeeds once, the candidate never.
  const g = i => `g${String(i).padStart(2, '0')}`;
  const incumbent = { model: 'incumbent', digest: '1'.repeat(64), groups: new Map(Array.from({ length: 50 }, (_, i) => [g(i), i === 7 ? 1 : 0])) };
  const candidate = { model: 'candidate', digest: '2'.repeat(64), groups: new Map(Array.from({ length: 50 }, (_, i) => [g(49 - i), 0])) };
  const other = { model: 'other', digest: '0'.repeat(64), groups: new Map(Array.from({ length: 30 }, (_, i) => [g(i), i % 3 ? 0.5 : 1])) };
  const orders = [[incumbent, candidate, other], [other, candidate, incumbent], [candidate, other, incumbent]];
  const pools = orders.map(models => orientedPairPools(models, { incumbentDigest: incumbent.digest }));
  for (const p of pools) assert.deepEqual(p, pools[0]);
  const loss = pools[0].find(p => p.candidate === 'candidate');
  assert.equal(loss.incumbent, 'incumbent');
  assert.deepEqual([Math.min(...loss.deltas), Math.max(...loss.deltas)], [-1, 0], 'a rare candidate loss stays a loss');
  const all = orders.map(models => orientedPairPools(models));
  for (const p of all) assert.deepEqual(p, all[0]);
  assert.equal(all[0].length, 6, 'every unordered pair in both named directions');
  const plans = pools.map(p => planFeasibility({ method: DECISION_METHODS.PAIRED_T, minimumBenefit: 0.04, nonInferiorityMargin: 0.05,
    availableGroups: 50, plannedEffect: 0.1, pools: p.map(x => x.deltas), sims: 100, seed: 9, calibrate: true }));
  for (const p of plans) assert.deepEqual(p, plans[0]);
  // Why the sign matters: the same shape reversed looks safe; oriented, it is not.
  const common = { method: DECISION_METHODS.PAIRED_T, groups: 20, minimumBenefit: 0.04, nonInferiorityMargin: 0.05, sims: 200, seed: 20260924 };
  assert.equal(calibrateAlpha({ ...common, pools: [loss.deltas] }), null);
  assert.equal(calibrateAlpha({ ...common, pools: [loss.deltas.map(d => -d)] }).alpha, 0.05);
  assert.throws(() => orientedPairPools([incumbent, { ...candidate, digest: incumbent.digest }]), /MODEL_IDENTITY/);
});
