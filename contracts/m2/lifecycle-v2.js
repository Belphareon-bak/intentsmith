import * as v1 from './lifecycle-v1.js';
import * as execution from './execution-v2.js';
import * as governance from './governance-v1.js';
import { isPlainRecord, validateExactKeys, validationResult } from '../m1/shared.js';

export const M2_LIFECYCLE_CONTRACT_VERSION = 2;
export const M2_LIFECYCLE_CONTRACT_STAGE = 'DEVELOPMENT_DRAFT';
export { M2_LIFECYCLE_CONTRACT_KIND, M2_LIFECYCLE_STATE, canonicalizeM2LifecycleValue,
  normalizeM2LifecycleValue, computeM2LifecycleValueDigest,
  validateM2LifecycleApprovalIntent, computeM2LifecycleApprovalIntentDigest,
  validateM2LifecycleTerminalSnapshot, computeM2LifecycleTerminalSnapshotDigest } from './lifecycle-v1.js';

const hash = v1.computeM2LifecycleValueDigest;
const FOCUSED_KEYS = ['binary', 'argv', 'argvDigest', 'environmentDigest', 'timeoutMs',
  'sandboxProfile', 'networkPolicy', 'networkPolicyDigest'];
function planBase(plan) {
  if (!isPlainRecord(plan)) return plan;
  if (!isPlainRecord(plan.focusedTest)) return { ...plan, version: 1 };
  const { sandboxProfile, networkPolicy, networkPolicyDigest, ...focusedTest } = plan.focusedTest;
  return { ...plan, version: 1, focusedTest };
}
function requestBase(request) {
  const { networkPolicy, networkPolicyDigest, ...focusedTest } = request.focusedTest;
  return { ...request, version: 1, focusedTest: { ...focusedTest, sandboxProfile: 'linux-bwrap-ro-v2' } };
}
function focusedSummary(focused) {
  return Object.fromEntries(FOCUSED_KEYS.map(key => [key, focused[key]]));
}

export function validateM2LifecyclePlanSnapshot(plan) {
  if (plan?.version === 1) return v1.validateM2LifecyclePlanSnapshot(plan);
  if (plan?.version !== 2) return validationResult(['lifecycle-plan-snapshot:unsupported-version'], plan);
  const errors = [...v1.validateM2LifecyclePlanSnapshot(planBase(plan)).errors,
    ...validateExactKeys(plan.focusedTest, FOCUSED_KEYS, [], 'lifecycle-plan-snapshot.focusedTest')];
  const focused = plan.focusedTest;
  const policy = execution.validateM2PrivateHttpNetworkPolicy(focused?.networkPolicy);
  errors.push(...policy.errors);
  if (focused?.sandboxProfile !== execution.M2_PRIVATE_HTTP_PROFILE) errors.push('lifecycle-plan-snapshot:invalid-sandboxProfile');
  if (policy.valid) {
    if (focused.networkPolicyDigest !== execution.computeM2PrivateHttpNetworkPolicyDigest(focused.networkPolicy)) {
      errors.push('lifecycle-plan-snapshot:network-policy-digest-mismatch');
    }
    if (focused.binary !== focused.networkPolicy.artifacts.runtimeExecutable.canonicalPath
      || focused.argv?.[0] !== focused.networkPolicy.artifacts.oracle.canonicalPath) errors.push('lifecycle-plan-snapshot:trusted-command-mismatch');
    if (typeof plan.project?.canonicalRoot === 'string' && Object.values(focused.networkPolicy.artifacts).some(ref => (
      ref.canonicalPath === plan.project.canonicalRoot || ref.canonicalPath.startsWith(`${plan.project.canonicalRoot}/`)
    ))) errors.push('lifecycle-plan-snapshot:trusted-artifact-inside-project');
  }
  return validationResult(errors, plan);
}
export function computeM2LifecyclePlanSnapshotDigest(plan) {
  if (plan?.version === 1) return v1.computeM2LifecyclePlanSnapshotDigest(plan);
  const result = validateM2LifecyclePlanSnapshot(plan);
  if (!result.valid) throw new TypeError(result.errors.join(','));
  return hash(plan);
}
export function validateM2LifecyclePlanSnapshotForRequest(request, plan) {
  if (request?.version === 1 && plan?.version === 1) return v1.validateM2LifecyclePlanSnapshotForRequest(request, plan);
  const errors = [...execution.validateM2ProjectChangeRequest(request).errors, ...validateM2LifecyclePlanSnapshot(plan).errors];
  if (request?.version !== 2 || plan?.version !== 2) errors.push('lifecycle-plan-snapshot:mixed-request-plan-versions');
  if (errors.length) return validationResult(errors, plan);
  const baseRequest = requestBase(request);
  errors.push(...v1.validateM2LifecyclePlanSnapshotForRequest(baseRequest, {
    ...planBase(plan), requestDigest: hash(baseRequest),
  }).errors);
  if (plan.requestDigest !== execution.computeM2ProjectChangeRequestDigest(request)) errors.push('lifecycle-plan-snapshot:request-digest-mismatch');
  if (hash(plan.focusedTest) !== hash(focusedSummary(request.focusedTest))) errors.push('lifecycle-plan-snapshot:focused-test-mismatch');
  return validationResult(errors, plan);
}
export function validateM2LifecyclePlanSnapshotForContext(contextSnapshot, plan) {
  if (plan?.version === 1) return v1.validateM2LifecyclePlanSnapshotForContext(contextSnapshot, plan);
  const result = validateM2LifecyclePlanSnapshot(plan);
  if (!result.valid) return result;
  return validationResult(v1.validateM2LifecyclePlanSnapshotForContext(contextSnapshot, planBase(plan)).errors, plan);
}
export function validateM2LifecyclePlanSnapshotForDecision(request, decision, plan) {
  if (request?.version === 1 && plan?.version === 1) return v1.validateM2LifecyclePlanSnapshotForDecision(request, decision, plan);
  const errors = [...validateM2LifecyclePlanSnapshotForRequest(request, plan).errors,
    ...governance.validateM2GovernanceDecision(decision).errors];
  if (errors.length) return validationResult(errors, plan);
  if (decision.verdict !== 'allow') errors.push('lifecycle-plan-snapshot:governance-not-allow');
  if (decision.lifecycleId !== plan.identity.lifecycleId || decision.milestoneId !== plan.identity.milestoneId
    || decision.executionId !== plan.identity.executionId || decision.runId !== plan.identity.runId
    || decision.projectId !== plan.project.projectId || decision.requestDigest !== plan.requestDigest
    || decision.policyDigest !== plan.governancePolicyDigest || decision.baselineDigest !== plan.governanceBaselineDigest
    || decision.expectedAfterRevision !== plan.expectedAfterRevision
    || plan.governanceDecisionDigest !== governance.computeM2GovernanceDecisionDigest(decision)) {
    errors.push('lifecycle-plan-snapshot:governance-decision-mismatch');
  }
  return validationResult(errors, plan);
}
export function validateM2LifecycleApprovalIntentForPlan(plan, approval) {
  if (plan?.version === 1) return v1.validateM2LifecycleApprovalIntentForPlan(plan, approval);
  const errors = [...validateM2LifecyclePlanSnapshot(plan).errors, ...v1.validateM2LifecycleApprovalIntent(approval).errors];
  if (errors.length) return validationResult(errors, approval);
  if (plan.state !== 'awaiting_approval') errors.push('lifecycle-approval-intent:plan-not-awaiting-approval');
  if (hash(approval.identity) !== hash(plan.identity) || approval.planVersion !== plan.planVersion
    || approval.planDigest !== computeM2LifecyclePlanSnapshotDigest(plan) || approval.requestDigest !== plan.requestDigest
    || approval.authoritySetDigest !== plan.authoritySetDigest || approval.projectId !== plan.project.projectId
    || approval.workspaceRevision !== plan.project.workspaceRevision
    || approval.actor.type !== plan.actor.type || approval.actor.id !== plan.actor.id) errors.push('lifecycle-approval-intent:plan-identity-mismatch');
  if (Date.parse(approval.approvedAt) > Date.parse(plan.approvalExpiresAt)) errors.push('lifecycle-approval-intent:plan-expired');
  if (Date.parse(approval.expiresAt) > Date.parse(plan.approvalExpiresAt)) errors.push('lifecycle-approval-intent:grant-window-exceeds-plan');
  return validationResult(errors, approval);
}

// Governance@1 wrappers: only crossbindings differ; standalone V1 IDs/validators remain unchanged.
export function validateM2GovernanceReceiptForDecision(request, result, decision, receipt) {
  if (request?.version === 1 && result?.version === 1) return governance.validateM2GovernanceReceiptForDecision(request, result, decision, receipt);
  const errors = [...execution.validateM2ProjectChangeResultForRequest(request, result).errors,
    ...governance.validateM2GovernanceDecision(decision).errors, ...governance.validateM2GovernanceReceipt(receipt).errors];
  if (errors.length) return validationResult(errors, receipt);
  if (decision.verdict !== 'allow') errors.push('governance-receipt:decision-not-allow');
  if (result.terminalStatus !== 'succeeded') errors.push('governance-receipt:result-not-succeeded');
  if (decision.executionId !== request.executionId || decision.runId !== request.runId
    || decision.projectId !== request.project.projectId || decision.requestDigest !== execution.computeM2ProjectChangeRequestDigest(request)) {
    errors.push('governance-receipt:decision-request-identity-mismatch');
  }
  if (['lifecycleId', 'milestoneId', 'executionId', 'runId', 'projectId', 'requestDigest',
    'policyDigest', 'baselineDigest', 'expectedAfterRevision'].some(key => receipt[key] !== decision[key])
    || receipt.decisionDigest !== governance.computeM2GovernanceDecisionDigest(decision)) errors.push('governance-receipt:decision-identity-mismatch');
  if (receipt.resultDigest !== hash(result) || receipt.actualAfterRevision !== result.changes.afterRevision
    || receipt.fencingGeneration !== result.fencingGeneration) errors.push('governance-receipt:result-identity-mismatch');
  if (result.changes.afterRevision !== decision.expectedAfterRevision) errors.push('governance-receipt:unexpected-after-revision');
  if (Date.parse(receipt.recordedAt) < Date.parse(result.completedAt)) errors.push('governance-receipt:recorded-before-result');
  const requiredEvidence = [...result.evidenceRefs, `governance-decision:${decision.decisionId}`,
    `project-change-result:${result.executionId}`].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (hash(receipt.evidenceRefs) !== hash(requiredEvidence)) errors.push('governance-receipt:evidence-set-mismatch');
  return validationResult(errors, receipt);
}
export function validateM2LifecycleTerminalSnapshotForExecution(input) {
  const { contextSnapshot, plan, approval, request, result, governanceDecision, governanceReceipt, terminal } = input;
  if (plan?.version === 1 && request?.version === 1 && result?.version === 1) return v1.validateM2LifecycleTerminalSnapshotForExecution(input);
  const errors = [
    ...validateM2LifecyclePlanSnapshotForContext(contextSnapshot, plan).errors,
    ...validateM2LifecyclePlanSnapshotForDecision(request, governanceDecision, plan).errors,
    ...validateM2LifecycleApprovalIntentForPlan(plan, approval).errors,
    ...validateM2GovernanceReceiptForDecision(request, result, governanceDecision, governanceReceipt).errors,
    ...v1.validateM2LifecycleTerminalSnapshot(terminal).errors,
  ];
  if (errors.length) return validationResult(errors, terminal);
  if (terminal.state !== 'succeeded') errors.push('lifecycle-terminal-snapshot:execution-evidence-requires-succeeded-state');
  if (result.terminalStatus !== 'succeeded') errors.push('lifecycle-terminal-snapshot:project-change-not-succeeded');
  if (governanceDecision.verdict !== 'allow') errors.push('lifecycle-terminal-snapshot:governance-not-allow');
  if (hash(terminal.identity) !== hash(plan.identity) || terminal.planVersion !== plan.planVersion
    || terminal.planDigest !== computeM2LifecyclePlanSnapshotDigest(plan)
    || terminal.approvalIntentDigest !== v1.computeM2LifecycleApprovalIntentDigest(approval)
    || terminal.requestDigest !== execution.computeM2ProjectChangeRequestDigest(request)
    || terminal.authoritySetDigest !== request.authoritySetDigest || terminal.projectId !== request.project.projectId
    || terminal.workspaceRevision !== result.changes.afterRevision || terminal.resultDigest !== hash(result)
    || terminal.governanceDecisionDigest !== governance.computeM2GovernanceDecisionDigest(governanceDecision)
    || terminal.governanceReceiptDigest !== governance.computeM2GovernanceReceiptDigest(governanceReceipt)) {
    errors.push('lifecycle-terminal-snapshot:execution-identity-mismatch');
  }
  if (governanceDecision.lifecycleId !== plan.identity.lifecycleId
    || governanceDecision.milestoneId !== plan.identity.milestoneId) errors.push('lifecycle-terminal-snapshot:governance-lifecycle-mismatch');
  return validationResult(errors, terminal);
}

export function validateM2LifecycleContract(value, expectedContract = null) {
  if (value?.contract !== 'LifecyclePlanSnapshot' || value?.version === 1) return v1.validateM2LifecycleContract(value, expectedContract);
  if (expectedContract !== null && value.contract !== expectedContract) return validationResult(['m2-lifecycle:unexpected-contract'], value);
  return validateM2LifecyclePlanSnapshot(value);
}
export function encodeM2LifecycleContract(value, expectedContract = null) {
  if (value?.contract !== 'LifecyclePlanSnapshot' || value?.version === 1) return v1.encodeM2LifecycleContract(value, expectedContract);
  const result = validateM2LifecycleContract(value, expectedContract);
  if (!result.valid) throw new TypeError(result.errors.join(','));
  return Buffer.from(v1.canonicalizeM2LifecycleValue(value), 'utf8');
}
export function decodeM2LifecycleContract(encoded, expectedContract = null) {
  if (!(typeof encoded === 'string' || Buffer.isBuffer(encoded) || encoded instanceof Uint8Array)) throw new TypeError('m2-lifecycle-decode:invalid-bytes');
  const bytes = Buffer.from(encoded);
  if (!bytes.length || bytes.length > 4_194_304) throw new TypeError('m2-lifecycle-decode:invalid-size');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new TypeError('m2-lifecycle-decode:invalid-utf8');
  let value;
  try { value = JSON.parse(text); } catch { throw new TypeError('m2-lifecycle-decode:invalid-json'); }
  if (value?.contract !== 'LifecyclePlanSnapshot' || value?.version === 1) return v1.decodeM2LifecycleContract(encoded, expectedContract);
  const result = validateM2LifecycleContract(value, expectedContract);
  if (!result.valid) throw new TypeError(result.errors.join(','));
  if (!encodeM2LifecycleContract(value, expectedContract).equals(bytes)) throw new TypeError('m2-lifecycle-decode:noncanonical');
  return Object.freeze(value);
}
