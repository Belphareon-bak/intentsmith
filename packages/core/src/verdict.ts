import type { Evidence, NormalizedError, TaskResult, WorkerClaim } from '@intentsmith/contracts';

export type VerdictInput = {
  id: string;
  taskId: string;
  runId: string;
  now: string;
  workerClaim?: WorkerClaim;
  deterministicEvidence: Evidence[];
  securityEvidence?: Evidence[];
  artifacts?: TaskResult['artifacts'];
  diffs?: TaskResult['diffs'];
  workerError?: NormalizedError;
  invalidWorkerEvent?: boolean;
  /** Schema-valid events emitted in an illegal order, e.g. after a terminal event. */
  workerProtocolViolation?: boolean;
  timedOut?: boolean;
  cancelled?: boolean;
};

export function decideVerdict(input: VerdictInput): TaskResult {
  const deterministicEvidence = input.deterministicEvidence;
  const securityEvidence = input.securityEvidence ?? [];
  const failures = deterministicEvidence.filter(evidence => evidence.status === 'fail');
  const passingEvidence = deterministicEvidence.filter(evidence => evidence.status === 'pass');
  const unresolvedRisks: string[] = [];

  let coreVerdict: TaskResult['coreVerdict'] = 'fail';

  if (input.cancelled) {
    coreVerdict = 'cancelled';
  } else if (input.invalidWorkerEvent) {
    unresolvedRisks.push('Worker emitted an event that failed schema validation.');
    coreVerdict = 'fail';
  } else if (input.workerProtocolViolation) {
    unresolvedRisks.push('Worker emitted an event after a terminal event.');
    coreVerdict = 'fail';
  } else if (input.timedOut) {
    unresolvedRisks.push('Worker timed out before producing a valid result.');
    coreVerdict = 'fail';
  } else if (input.workerError || input.workerClaim?.status === 'failure') {
    coreVerdict = 'fail';
  } else if (input.workerClaim?.status === 'success' && failures.length === 0 && passingEvidence.length > 0) {
    coreVerdict = 'pass';
  } else if (input.workerClaim?.status === 'success' && failures.length > 0) {
    // A worker claim can never convert deterministic failure evidence to pass.
    unresolvedRisks.push('Worker claimed success while deterministic evidence reported failure.');
    coreVerdict = 'fail';
  } else if (input.workerClaim?.status === 'success' && passingEvidence.length === 0) {
    unresolvedRisks.push('Worker claimed success without deterministic passing evidence.');
    coreVerdict = 'fail';
  } else if (!input.workerClaim) {
    unresolvedRisks.push('Worker produced no terminal claim.');
    coreVerdict = 'fail';
  }

  return {
    id: input.id,
    taskId: input.taskId,
    runId: input.runId,
    workerClaim: input.workerClaim,
    actions: [],
    diffs: input.diffs ?? [],
    artifacts: input.artifacts ?? [],
    deterministicEvidence,
    securityEvidence,
    governanceFindings: [],
    approvals: [],
    unresolvedRisks,
    coreVerdict,
    createdAt: input.now,
  };
}
