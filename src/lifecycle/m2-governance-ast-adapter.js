import { evaluateM2Governance, prepareM2GovernanceSourceSet } from './m2-governance-evaluator.js';
import { observeM2Imports } from './m2-import-scanner.js';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Trusted internal service port. No scanner result is accepted from callers. */
export async function evaluateM2GovernanceWithAst(args, { signal } = {}) {
  // Snapshot complete request/policy/baseline/candidate strings before await.
  // Never keep a caller-owned Buffer or mutable view in an observation.
  const snapshot = freeze(structuredClone({
    lifecycleId: args.lifecycleId,
    milestoneId: args.milestoneId,
    request: args.request,
    policySnapshot: args.policySnapshot,
    baselineSnapshot: args.baselineSnapshot,
    candidateFiles: args.candidateFiles,
    expectedAfterRevision: args.expectedAfterRevision,
  }));
  const prepared = prepareM2GovernanceSourceSet(snapshot);
  if (!prepared.ready) return evaluateM2Governance(snapshot);
  const importObservation = await observeM2Imports(prepared, { signal });
  return evaluateM2Governance({ ...snapshot, importObservation });
}
