// Paired decision methods and pre-collection feasibility. Synthetic, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DECISION_METHODS, PAIRED_T_MINIMUM_GROUPS, studentTCdf, studentTQuantile,
  pairedTGroupInterval, groupInterval } from '../src/eval/decision-methods.js';
import { boundedGroupInterval, codePilotPlanHash, validateCodePilotPlan, decideCodePilot } from '../src/eval/code-pilot-decision.js';
import { acceptanceRate, allowedFalseAccept, requiredGroups, planFeasibility } from '../src/eval/decision-feasibility.js';

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

function plan(method, groups) {
  const p = { schemaVersion: 1, role: 'CODE', metric: 'completed_without_repair_help', lockedAt: '2026-01-01T00:00:00Z',
    repeats: 1, decision: { method, alpha: 0.05, minimumBenefit: 0.04, nonInferiorityMargin: 0.05,
      minimumSpeedup: 1.25, allowSpeedDecision: false },
    budget: { attemptMs: 1000, totalMs: 1e8 }, profile: { numCtx: 16384, maxVramBytes: 22e9 },
    incumbent: { model: 'a', digest: 'a'.repeat(64) }, candidate: { model: 'b', digest: 'b'.repeat(64) },
    scenarios: Array.from({ length: groups }, (_, i) => ({ id: `case${i}`, independenceGroup: `group${i}`,
      groupRationale: 'distinct', contentSha256: 'c'.repeat(64) })) };
  p.planSha256 = codePilotPlanHash(p);
  return p;
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

test('paired t is an explicit sealed plan choice with a group floor', () => {
  assert.equal(validateCodePilotPlan(plan(DECISION_METHODS.PAIRED_T, 12)), true);
  assert.throws(() => validateCodePilotPlan(plan(DECISION_METHODS.PAIRED_T, 6)), /too few groups/);
  assert.equal(validateCodePilotPlan(plan(DECISION_METHODS.KL_BOUNDED, 6)), true);
  const sealed = plan(DECISION_METHODS.KL_BOUNDED, 12);
  sealed.decision.method = DECISION_METHODS.PAIRED_T; // swapping method after sealing is detected
  assert.throws(() => validateCodePilotPlan(sealed), /seal/);
});

test('same paired evidence: KL undecided, paired t decides a consistent win', () => {
  // Candidate wins 12 of 40 independent groups, ties the rest (mean +0.30).
  const t = plan(DECISION_METHODS.PAIRED_T, 40), k = plan(DECISION_METHODS.KL_BOUNDED, 40);
  const rt = decideCodePilot(t, attempts(t, 12), qualified(t));
  const rk = decideCodePilot(k, attempts(k, 12), qualified(k));
  assert.equal(rt.verdict, 'ZMENIT'); assert.equal(rt.reason, 'QUALITY_BENEFIT');
  assert.equal(rk.verdict, 'NEROZHODNUTO'); assert.equal(rk.reason, 'INSUFFICIENT_EVIDENCE');
  assert.equal(rt.qualityInterval.method, DECISION_METHODS.PAIRED_T);
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
