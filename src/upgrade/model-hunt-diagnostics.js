// Diagnose recorded evidence; this never changes a score, policy or model binding.
export function analyzeHuntDecisions(results = []) {
  const cases = [];
  let evaluated = 0;
  for (const result of results) for (const trial of result.trials || []) {
    if (trial.skipped || !trial.decision) continue;
    evaluated++;
    if (trial.decision.reasonCode !== 'INSUFFICIENT_EVIDENCE') continue;
    const comparison = trial.comparison || {};
    const epsilon = trial.policy?.taskMarginEpsilon ?? 0.05;
    const rounding = trial.policy?.scoreRoundingEpsilon ?? 0.0005;
    const tasks = comparison.tasks || [];
    const noiseLimited = tasks.filter(t => !t.discriminating && Math.abs(t.delta) > epsilon + rounding
      && Math.abs(t.delta) <= Math.max(epsilon, t.noise || 0) + rounding).map(t => t.name);
    const closeScores = tasks.filter(t => !t.discriminating && Math.abs(t.delta) <= epsilon + rounding).map(t => t.name);
    cases.push({ model: result.model, role: trial.role, suiteContractSha256: trial.policy?.suiteContractSha256,
      discriminating: comparison.discriminating, minimum: trial.policy?.minimumDiscriminatingTasks,
      noiseLimited, closeScores, unstableTasks: comparison.unstableTasks || [],
      diagnosis: noiseLimited.length ? 'VARIABILITY_LIMITED' : 'SMALL_OBSERVED_DIFFERENCE',
    });
  }
  return { evaluated, insufficient: cases.length,
    variabilityLimited: cases.filter(c => c.diagnosis === 'VARIABILITY_LIMITED').length,
    smallObservedDifference: cases.filter(c => c.diagnosis === 'SMALL_OBSERVED_DIFFERENCE').length,
    cases, limitation: 'Diagnostic of recorded tasks only; more repeats or new tasks require a new exact contract and incumbent baseline.' };
}
