import path from 'node:path';

import {
  canonicalizeM2ExecutionValue,
  computeM2ExecutionValueDigest,
  computeM2ProjectChangeRequestDigest,
  isM2ExecutionProjectRelativePath,
  normalizeM2ExecutionValue,
  validateM2ProjectChangeRequest,
  validateM2ProjectChangeResultForRequest,
} from './execution-v1.js';
import {
  validateProjectContextSnapshot,
} from './project-context-v1.js';
import {
  M2_GOVERNANCE_VERDICT,
  computeM2GovernanceDecisionDigest,
  computeM2GovernanceReceiptDigest,
  validateM2GovernanceDecision,
  validateM2GovernanceReceipt,
  validateM2GovernanceReceiptForDecision,
} from './governance-v1.js';
import {
  isIdentifier,
  isPlainRecord,
  validateExactKeys,
  validationResult,
} from '../m1/shared.js';

export const M2_LIFECYCLE_CONTRACT_VERSION = 1;
export const M2_LIFECYCLE_CONTRACT_STAGE = 'CANDIDATE_V1';

export const M2_LIFECYCLE_CONTRACT_KIND = Object.freeze({
  PLAN_SNAPSHOT: 'LifecyclePlanSnapshot',
  APPROVAL_INTENT: 'LifecycleApprovalIntent',
  TERMINAL_SNAPSHOT: 'LifecycleTerminalSnapshot',
});

export const M2_LIFECYCLE_STATE = Object.freeze({
  PLANNING: 'planning',
  AWAITING_APPROVAL: 'awaiting_approval',
  EXECUTING: 'executing',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  TIMED_OUT: 'timed_out',
  ORPHANED: 'orphaned',
  BLOCKED: 'blocked',
});

const PLAN_STATES = new Set([
  M2_LIFECYCLE_STATE.PLANNING,
  M2_LIFECYCLE_STATE.AWAITING_APPROVAL,
]);
const TERMINAL_STATES = new Set([
  M2_LIFECYCLE_STATE.SUCCEEDED,
  M2_LIFECYCLE_STATE.FAILED,
  M2_LIFECYCLE_STATE.CANCELLED,
  M2_LIFECYCLE_STATE.TIMED_OUT,
  M2_LIFECYCLE_STATE.ORPHANED,
  M2_LIFECYCLE_STATE.BLOCKED,
]);
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const REVISION_PATTERN = /^wsr1:[0-9a-f]{64}$/;
const GIT_OBJECT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const GIT_BRANCH_PATTERN = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]{0,247}$/;
const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_:-]{0,95}$/;

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function isNfcString(value, maximum = 4_096, { empty = false } = {}) {
  return typeof value === 'string'
    && value === value.normalize('NFC')
    && !value.includes('\0')
    && Buffer.from(value, 'utf8').toString('utf8') === value
    && (empty || value.trim().length > 0)
    && Buffer.byteLength(value, 'utf8') <= maximum;
}

function isDigest(value) {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

function isRevision(value) {
  return typeof value === 'string' && REVISION_PATTERN.test(value);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}

function isCanonicalAbsolute(value) {
  return isNfcString(value)
    && !value.includes('\\')
    && path.posix.isAbsolute(value)
    && path.posix.normalize(value) === value
    && (value === '/' || !value.endsWith('/'));
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function validateSortedUniqueStrings(value, context, validator = isNfcString) {
  if (!Array.isArray(value)) return [`${context}:not-array`];
  const errors = [];
  value.forEach((entry, index) => {
    if (!validator(entry)) errors.push(`${context}[${index}]:invalid`);
  });
  for (let index = 1; index < value.length; index += 1) {
    if (
      typeof value[index - 1] === 'string'
      && typeof value[index] === 'string'
      && compareUtf8(value[index - 1], value[index]) >= 0
    ) {
      errors.push(`${context}:not-bytewise-sorted-unique`);
      break;
    }
  }
  return errors;
}

function validateIdentity(value, context) {
  const errors = validateExactKeys(
    value,
    ['lifecycleId', 'milestoneId', 'runId', 'executionId'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  for (const key of ['lifecycleId', 'milestoneId', 'runId', 'executionId']) {
    if (!isIdentifier(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  return errors;
}

function validateActor(value, context) {
  const errors = validateExactKeys(value, ['type', 'id'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (value.type !== 'user') errors.push(`${context}:user-required`);
  if (!isIdentifier(value.id)) errors.push(`${context}:invalid-id`);
  return errors;
}

function validateOrigin(value, projectId, context) {
  const errors = validateExactKeys(
    value,
    ['surface', 'sessionId', 'conversationId', 'projectId'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (!['http', 'ws', 'studio', 'skill', 'lifecycle'].includes(value.surface)) {
    errors.push(`${context}:invalid-surface`);
  }
  for (const key of ['sessionId', 'conversationId']) {
    if (!(value[key] === null || isIdentifier(value[key]))) errors.push(`${context}:invalid-${key}`);
  }
  if (!Number.isSafeInteger(value.projectId) || value.projectId < 1) {
    errors.push(`${context}:invalid-projectId`);
  }
  if (value.projectId !== projectId) errors.push(`${context}:projectId-mismatch`);
  return errors;
}

function validateProject(value, context) {
  const errors = validateExactKeys(value, [
    'projectId', 'canonicalRoot', 'workspaceRevision', 'gitHead',
    'gitBranchRef', 'foreignDirtDigest',
  ], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!Number.isSafeInteger(value.projectId) || value.projectId < 1) {
    errors.push(`${context}:invalid-projectId`);
  }
  if (!isCanonicalAbsolute(value.canonicalRoot)) errors.push(`${context}:invalid-canonicalRoot`);
  if (!isRevision(value.workspaceRevision)) errors.push(`${context}:invalid-workspaceRevision`);
  if (typeof value.gitHead !== 'string' || !GIT_OBJECT_PATTERN.test(value.gitHead)) {
    errors.push(`${context}:invalid-gitHead`);
  }
  if (typeof value.gitBranchRef !== 'string' || !GIT_BRANCH_PATTERN.test(value.gitBranchRef)) {
    errors.push(`${context}:invalid-gitBranchRef`);
  }
  if (!isDigest(value.foreignDirtDigest)) errors.push(`${context}:invalid-foreignDirtDigest`);
  return errors;
}

function validatePlanChange(value, index) {
  const context = `lifecycle-plan-snapshot.changes[${index}]`;
  const errors = validateExactKeys(value, ['path', 'afterDigest', 'afterBytes'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!isM2ExecutionProjectRelativePath(value.path)) errors.push(`${context}:invalid-path`);
  if (!isDigest(value.afterDigest)) errors.push(`${context}:invalid-afterDigest`);
  if (!Number.isSafeInteger(value.afterBytes) || value.afterBytes < 0 || value.afterBytes > 1_048_576) {
    errors.push(`${context}:invalid-afterBytes`);
  }
  return errors;
}

function validateFocusedTest(value, context) {
  const errors = validateExactKeys(
    value,
    ['binary', 'argv', 'argvDigest', 'environmentDigest', 'timeoutMs'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (!isCanonicalAbsolute(value.binary)) errors.push(`${context}:invalid-binary`);
  if (
    !Array.isArray(value.argv)
    || value.argv.length > 128
    || value.argv.some(argument => !isNfcString(argument, 4_096, { empty: true }))
  ) errors.push(`${context}:invalid-argv`);
  if (!isDigest(value.argvDigest)) {
    errors.push(`${context}:invalid-argvDigest`);
  } else if (Array.isArray(value.argv)) {
    try {
      if (computeM2ExecutionValueDigest(value.argv) !== value.argvDigest) {
        errors.push(`${context}:argvDigest-mismatch`);
      }
    } catch {
      errors.push(`${context}:invalid-argv-canonical-form`);
    }
  }
  if (!isDigest(value.environmentDigest)) errors.push(`${context}:invalid-environmentDigest`);
  if (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 1 || value.timeoutMs > 3_600_000) {
    errors.push(`${context}:invalid-timeoutMs`);
  }
  return errors;
}

function validateGitCommit(value, project, paths, context) {
  if (value === null) return [];
  const errors = validateExactKeys(
    value,
    ['expectedHead', 'branchRef', 'paths', 'messageDigest', 'identityDigest'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (typeof value.expectedHead !== 'string' || !GIT_OBJECT_PATTERN.test(value.expectedHead)) {
    errors.push(`${context}:invalid-expectedHead`);
  }
  if (value.expectedHead !== project?.gitHead) errors.push(`${context}:head-mismatch`);
  if (typeof value.branchRef !== 'string' || !GIT_BRANCH_PATTERN.test(value.branchRef)) {
    errors.push(`${context}:invalid-branchRef`);
  }
  if (value.branchRef !== project?.gitBranchRef) errors.push(`${context}:branch-mismatch`);
  errors.push(...validateSortedUniqueStrings(value.paths, `${context}.paths`, isM2ExecutionProjectRelativePath));
  if (!arraysEqual(value.paths, paths)) errors.push(`${context}:paths-mismatch`);
  if (!isDigest(value.messageDigest)) errors.push(`${context}:invalid-messageDigest`);
  if (!isDigest(value.identityDigest)) errors.push(`${context}:invalid-identityDigest`);
  return errors;
}

export function canonicalizeM2LifecycleValue(value) {
  return canonicalizeM2ExecutionValue(value);
}

export function normalizeM2LifecycleValue(value) {
  return normalizeM2ExecutionValue(value);
}

export function computeM2LifecycleValueDigest(value) {
  return computeM2ExecutionValueDigest(value);
}

export function validateM2LifecyclePlanSnapshot(value) {
  const context = 'lifecycle-plan-snapshot';
  const errors = validateExactKeys(value, [
    'contract', 'version', 'identity', 'state', 'planVersion', 'actor', 'origin',
    'project', 'intent', 'requestDigest', 'patchSetDigest', 'authoritySetDigest',
    'changes', 'focusedTest', 'gitCommit', 'governancePolicyDigest',
    'governanceBaselineDigest', 'contextSnapshotDigest',
    'governanceDecisionDigest', 'expectedAfterRevision', 'createdAt',
    'approvalExpiresAt',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M2_LIFECYCLE_CONTRACT_KIND.PLAN_SNAPSHOT) {
    errors.push(`${context}:invalid-contract`);
  }
  if (value.version !== M2_LIFECYCLE_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  errors.push(...validateIdentity(value.identity, `${context}.identity`));
  if (!PLAN_STATES.has(value.state)) errors.push(`${context}:invalid-state`);
  if (!Number.isSafeInteger(value.planVersion) || value.planVersion < 1) {
    errors.push(`${context}:invalid-planVersion`);
  }
  errors.push(...validateActor(value.actor, `${context}.actor`));
  errors.push(...validateProject(value.project, `${context}.project`));
  errors.push(...validateOrigin(value.origin, value.project?.projectId, `${context}.origin`));
  if (!isNfcString(value.intent, 16_384)) errors.push(`${context}:invalid-intent`);
  for (const key of [
    'requestDigest', 'patchSetDigest', 'authoritySetDigest',
    'governancePolicyDigest', 'governanceBaselineDigest',
    'contextSnapshotDigest', 'governanceDecisionDigest',
  ]) {
    if (!isDigest(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  if (!isRevision(value.expectedAfterRevision)) {
    errors.push(`${context}:invalid-expectedAfterRevision`);
  }
  if (!Array.isArray(value.changes) || value.changes.length < 1 || value.changes.length > 32) {
    errors.push(`${context}:invalid-changes`);
  } else {
    value.changes.forEach((change, index) => errors.push(...validatePlanChange(change, index)));
    const paths = value.changes.map(change => change?.path);
    errors.push(...validateSortedUniqueStrings(paths, `${context}.changePaths`, isM2ExecutionProjectRelativePath));
    errors.push(...validateGitCommit(
      value.gitCommit,
      value.project,
      paths,
      `${context}.gitCommit`,
    ));
  }
  errors.push(...validateFocusedTest(value.focusedTest, `${context}.focusedTest`));
  if (!isCanonicalTimestamp(value.createdAt)) errors.push(`${context}:invalid-createdAt`);
  if (!isCanonicalTimestamp(value.approvalExpiresAt)) errors.push(`${context}:invalid-approvalExpiresAt`);
  if (
    isCanonicalTimestamp(value.createdAt)
    && isCanonicalTimestamp(value.approvalExpiresAt)
    && Date.parse(value.approvalExpiresAt) <= Date.parse(value.createdAt)
  ) errors.push(`${context}:invalid-approval-window`);
  return validationResult(errors, value);
}

export function computeM2LifecyclePlanSnapshotDigest(value) {
  const validation = validateM2LifecyclePlanSnapshot(value);
  if (!validation.valid) throw new TypeError(validation.errors.join(','));
  return computeM2LifecycleValueDigest(value);
}

export function validateM2LifecyclePlanSnapshotForRequest(request, plan) {
  const errors = [];
  const requestValidation = validateM2ProjectChangeRequest(request);
  const planValidation = validateM2LifecyclePlanSnapshot(plan);
  errors.push(...requestValidation.errors, ...planValidation.errors);
  if (!requestValidation.valid || !planValidation.valid) return validationResult(errors, plan);

  const expectedChanges = request.changes.map(change => ({
    path: change.path,
    afterDigest: change.after.digest,
    afterBytes: change.after.bytes,
  }));
  const expectedGit = request.gitCommit === null ? null : {
    expectedHead: request.gitCommit.expectedHead,
    branchRef: request.gitCommit.branchRef,
    paths: request.gitCommit.paths,
    messageDigest: request.gitCommit.messageDigest,
    identityDigest: request.gitCommit.identityDigest,
  };
  if (
    plan.identity.runId !== request.runId
    || plan.identity.executionId !== request.executionId
    || plan.actor.type !== request.actor.type
    || plan.actor.id !== request.actor.id
    || computeM2LifecycleValueDigest(plan.origin) !== computeM2LifecycleValueDigest(request.origin)
    || computeM2LifecycleValueDigest(plan.project) !== computeM2LifecycleValueDigest(request.project)
  ) errors.push('lifecycle-plan-snapshot:request-identity-mismatch');
  if (
    plan.requestDigest !== computeM2ProjectChangeRequestDigest(request)
    || plan.patchSetDigest !== request.patchSetDigest
    || plan.authoritySetDigest !== request.authoritySetDigest
  ) errors.push('lifecycle-plan-snapshot:request-digest-mismatch');
  if (computeM2LifecycleValueDigest(plan.changes) !== computeM2LifecycleValueDigest(expectedChanges)) {
    errors.push('lifecycle-plan-snapshot:change-summary-mismatch');
  }
  const expectedFocused = {
    binary: request.focusedTest.binary,
    argv: request.focusedTest.argv,
    argvDigest: request.focusedTest.argvDigest,
    environmentDigest: request.focusedTest.environmentDigest,
    timeoutMs: request.focusedTest.timeoutMs,
  };
  if (computeM2LifecycleValueDigest(plan.focusedTest) !== computeM2LifecycleValueDigest(expectedFocused)) {
    errors.push('lifecycle-plan-snapshot:focused-test-mismatch');
  }
  if (computeM2LifecycleValueDigest(plan.gitCommit) !== computeM2LifecycleValueDigest(expectedGit)) {
    errors.push('lifecycle-plan-snapshot:git-commit-mismatch');
  }
  return validationResult(errors, plan);
}

export function validateM2LifecyclePlanSnapshotForContext(contextSnapshot, plan) {
  const errors = [];
  const contextValidation = validateProjectContextSnapshot(contextSnapshot);
  const planValidation = validateM2LifecyclePlanSnapshot(plan);
  errors.push(...contextValidation.errors, ...planValidation.errors);
  if (!contextValidation.valid || !planValidation.valid) return validationResult(errors, plan);
  if (
    contextSnapshot.status !== 'ok'
    || contextSnapshot.projectId !== plan.project.projectId
    || contextSnapshot.workspaceRevision !== plan.project.workspaceRevision
    || plan.contextSnapshotDigest !== computeM2LifecycleValueDigest(contextSnapshot)
  ) errors.push('lifecycle-plan-snapshot:context-identity-mismatch');
  return validationResult(errors, plan);
}

export function validateM2LifecyclePlanSnapshotForDecision(request, decision, plan) {
  const errors = [];
  const requestPlanValidation = validateM2LifecyclePlanSnapshotForRequest(request, plan);
  const decisionValidation = validateM2GovernanceDecision(decision);
  errors.push(...requestPlanValidation.errors, ...decisionValidation.errors);
  if (!requestPlanValidation.valid || !decisionValidation.valid) {
    return validationResult(errors, plan);
  }
  if (decision.verdict !== M2_GOVERNANCE_VERDICT.ALLOW) {
    errors.push('lifecycle-plan-snapshot:governance-not-allow');
  }
  if (
    decision.lifecycleId !== plan.identity.lifecycleId
    || decision.milestoneId !== plan.identity.milestoneId
    || decision.executionId !== plan.identity.executionId
    || decision.runId !== plan.identity.runId
    || decision.projectId !== plan.project.projectId
    || decision.requestDigest !== plan.requestDigest
    || decision.policyDigest !== plan.governancePolicyDigest
    || decision.baselineDigest !== plan.governanceBaselineDigest
    || decision.expectedAfterRevision !== plan.expectedAfterRevision
    || plan.governanceDecisionDigest !== computeM2GovernanceDecisionDigest(decision)
  ) errors.push('lifecycle-plan-snapshot:governance-decision-mismatch');
  return validationResult(errors, plan);
}

export function validateM2LifecycleApprovalIntent(value) {
  const context = 'lifecycle-approval-intent';
  const errors = validateExactKeys(value, [
    'contract', 'version', 'approvalId', 'identity', 'state', 'decision',
    'planVersion', 'planDigest', 'requestDigest', 'authoritySetDigest',
    'projectId', 'workspaceRevision', 'actor', 'approvedAt', 'expiresAt',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M2_LIFECYCLE_CONTRACT_KIND.APPROVAL_INTENT) {
    errors.push(`${context}:invalid-contract`);
  }
  if (value.version !== M2_LIFECYCLE_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  if (!isIdentifier(value.approvalId)) errors.push(`${context}:invalid-approvalId`);
  errors.push(...validateIdentity(value.identity, `${context}.identity`));
  if (value.state !== M2_LIFECYCLE_STATE.AWAITING_APPROVAL) errors.push(`${context}:invalid-state`);
  if (value.decision !== 'approve') errors.push(`${context}:approve-required`);
  if (!Number.isSafeInteger(value.planVersion) || value.planVersion < 1) {
    errors.push(`${context}:invalid-planVersion`);
  }
  for (const key of ['planDigest', 'requestDigest', 'authoritySetDigest']) {
    if (!isDigest(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  if (!Number.isSafeInteger(value.projectId) || value.projectId < 1) {
    errors.push(`${context}:invalid-projectId`);
  }
  if (!isRevision(value.workspaceRevision)) errors.push(`${context}:invalid-workspaceRevision`);
  errors.push(...validateActor(value.actor, `${context}.actor`));
  if (!isCanonicalTimestamp(value.approvedAt)) errors.push(`${context}:invalid-approvedAt`);
  if (!isCanonicalTimestamp(value.expiresAt)) errors.push(`${context}:invalid-expiresAt`);
  if (
    isCanonicalTimestamp(value.approvedAt)
    && isCanonicalTimestamp(value.expiresAt)
    && Date.parse(value.expiresAt) <= Date.parse(value.approvedAt)
  ) errors.push(`${context}:invalid-approval-window`);
  return validationResult(errors, value);
}

export function computeM2LifecycleApprovalIntentDigest(value) {
  const validation = validateM2LifecycleApprovalIntent(value);
  if (!validation.valid) throw new TypeError(validation.errors.join(','));
  return computeM2LifecycleValueDigest(value);
}

export function validateM2LifecycleApprovalIntentForPlan(plan, approval) {
  const errors = [];
  const planValidation = validateM2LifecyclePlanSnapshot(plan);
  const approvalValidation = validateM2LifecycleApprovalIntent(approval);
  errors.push(...planValidation.errors, ...approvalValidation.errors);
  if (!planValidation.valid || !approvalValidation.valid) {
    return validationResult(errors, approval);
  }
  if (plan.state !== M2_LIFECYCLE_STATE.AWAITING_APPROVAL) {
    errors.push('lifecycle-approval-intent:plan-not-awaiting-approval');
  }
  if (
    computeM2LifecycleValueDigest(approval.identity) !== computeM2LifecycleValueDigest(plan.identity)
    || approval.planVersion !== plan.planVersion
    || approval.planDigest !== computeM2LifecyclePlanSnapshotDigest(plan)
    || approval.requestDigest !== plan.requestDigest
    || approval.authoritySetDigest !== plan.authoritySetDigest
    || approval.projectId !== plan.project.projectId
    || approval.workspaceRevision !== plan.project.workspaceRevision
    || approval.actor.type !== plan.actor.type
    || approval.actor.id !== plan.actor.id
  ) errors.push('lifecycle-approval-intent:plan-identity-mismatch');
  if (Date.parse(approval.approvedAt) > Date.parse(plan.approvalExpiresAt)) {
    errors.push('lifecycle-approval-intent:plan-expired');
  }
  if (Date.parse(approval.expiresAt) > Date.parse(plan.approvalExpiresAt)) {
    errors.push('lifecycle-approval-intent:grant-window-exceeds-plan');
  }
  return validationResult(errors, approval);
}

export function validateM2LifecycleTerminalSnapshot(value) {
  const context = 'lifecycle-terminal-snapshot';
  const errors = validateExactKeys(value, [
    'contract', 'version', 'identity', 'state', 'planVersion', 'planDigest',
    'approvalIntentDigest', 'requestDigest', 'authoritySetDigest', 'projectId',
    'workspaceRevision', 'resultDigest', 'governanceDecisionDigest',
    'governanceReceiptDigest', 'errorCode', 'completedAt', 'evidenceRefs',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M2_LIFECYCLE_CONTRACT_KIND.TERMINAL_SNAPSHOT) {
    errors.push(`${context}:invalid-contract`);
  }
  if (value.version !== M2_LIFECYCLE_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  errors.push(...validateIdentity(value.identity, `${context}.identity`));
  if (!TERMINAL_STATES.has(value.state)) errors.push(`${context}:invalid-state`);
  if (!Number.isSafeInteger(value.planVersion) || value.planVersion < 1) {
    errors.push(`${context}:invalid-planVersion`);
  }
  for (const key of ['planDigest', 'requestDigest', 'authoritySetDigest']) {
    if (!isDigest(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  for (const key of [
    'approvalIntentDigest', 'resultDigest', 'governanceDecisionDigest', 'governanceReceiptDigest',
  ]) {
    if (!(value[key] === null || isDigest(value[key]))) errors.push(`${context}:invalid-${key}`);
  }
  if (!Number.isSafeInteger(value.projectId) || value.projectId < 1) {
    errors.push(`${context}:invalid-projectId`);
  }
  if (!isRevision(value.workspaceRevision)) errors.push(`${context}:invalid-workspaceRevision`);
  if (!(value.errorCode === null || (
    typeof value.errorCode === 'string' && ERROR_CODE_PATTERN.test(value.errorCode)
  ))) errors.push(`${context}:invalid-errorCode`);
  if (!isCanonicalTimestamp(value.completedAt)) errors.push(`${context}:invalid-completedAt`);
  errors.push(...validateSortedUniqueStrings(value.evidenceRefs, `${context}.evidenceRefs`));
  if (value.evidenceRefs?.length > 128) errors.push(`${context}:too-many-evidenceRefs`);
  if (value.state === M2_LIFECYCLE_STATE.SUCCEEDED) {
    if (value.errorCode !== null) errors.push(`${context}:error-on-success`);
    for (const key of [
      'approvalIntentDigest', 'resultDigest', 'governanceDecisionDigest', 'governanceReceiptDigest',
    ]) {
      if (!isDigest(value[key])) errors.push(`${context}:missing-${key}-on-success`);
    }
  } else if (value.errorCode === null) {
    errors.push(`${context}:missing-errorCode`);
  }
  return validationResult(errors, value);
}

export function computeM2LifecycleTerminalSnapshotDigest(value) {
  const validation = validateM2LifecycleTerminalSnapshot(value);
  if (!validation.valid) throw new TypeError(validation.errors.join(','));
  return computeM2LifecycleValueDigest(value);
}

export function validateM2LifecycleTerminalSnapshotForExecution({
  contextSnapshot,
  plan,
  approval,
  request,
  result,
  governanceDecision,
  governanceReceipt,
  terminal,
}) {
  const errors = [];
  const planContextValidation = validateM2LifecyclePlanSnapshotForContext(contextSnapshot, plan);
  const planDecisionValidation = validateM2LifecyclePlanSnapshotForDecision(
    request,
    governanceDecision,
    plan,
  );
  const approvalValidation = validateM2LifecycleApprovalIntentForPlan(plan, approval);
  const resultValidation = validateM2ProjectChangeResultForRequest(request, result);
  const decisionValidation = validateM2GovernanceDecision(governanceDecision);
  const receiptValidation = validateM2GovernanceReceipt(governanceReceipt);
  const governanceValidation = validateM2GovernanceReceiptForDecision(
    request,
    result,
    governanceDecision,
    governanceReceipt,
  );
  const terminalValidation = validateM2LifecycleTerminalSnapshot(terminal);
  errors.push(
    ...planContextValidation.errors,
    ...planDecisionValidation.errors,
    ...approvalValidation.errors,
    ...resultValidation.errors,
    ...decisionValidation.errors,
    ...receiptValidation.errors,
    ...governanceValidation.errors,
    ...terminalValidation.errors,
  );
  if (
    !planContextValidation.valid
    || !planDecisionValidation.valid
    || !approvalValidation.valid
    || !resultValidation.valid
    || !decisionValidation.valid
    || !receiptValidation.valid
    || !governanceValidation.valid
    || !terminalValidation.valid
  ) return validationResult(errors, terminal);

  if (terminal.state !== M2_LIFECYCLE_STATE.SUCCEEDED) {
    errors.push('lifecycle-terminal-snapshot:execution-evidence-requires-succeeded-state');
  }
  if (result.terminalStatus !== 'succeeded') {
    errors.push('lifecycle-terminal-snapshot:project-change-not-succeeded');
  }
  if (governanceDecision.verdict !== M2_GOVERNANCE_VERDICT.ALLOW) {
    errors.push('lifecycle-terminal-snapshot:governance-not-allow');
  }
  if (
    computeM2LifecycleValueDigest(terminal.identity) !== computeM2LifecycleValueDigest(plan.identity)
    || terminal.planVersion !== plan.planVersion
    || terminal.planDigest !== computeM2LifecyclePlanSnapshotDigest(plan)
    || terminal.approvalIntentDigest !== computeM2LifecycleApprovalIntentDigest(approval)
    || terminal.requestDigest !== computeM2ProjectChangeRequestDigest(request)
    || terminal.authoritySetDigest !== request.authoritySetDigest
    || terminal.projectId !== request.project.projectId
    || terminal.workspaceRevision !== result.changes.afterRevision
    || terminal.resultDigest !== computeM2ExecutionValueDigest(result)
    || terminal.governanceDecisionDigest !== computeM2GovernanceDecisionDigest(governanceDecision)
    || terminal.governanceReceiptDigest !== computeM2GovernanceReceiptDigest(governanceReceipt)
  ) errors.push('lifecycle-terminal-snapshot:execution-identity-mismatch');
  if (
    governanceDecision.lifecycleId !== plan.identity.lifecycleId
    || governanceDecision.milestoneId !== plan.identity.milestoneId
  ) errors.push('lifecycle-terminal-snapshot:governance-lifecycle-mismatch');
  return validationResult(errors, terminal);
}

export function validateM2LifecycleContract(value, expectedContract = null) {
  if (!isPlainRecord(value)) return validationResult(['m2-lifecycle:not-object'], value);
  if (expectedContract !== null && value.contract !== expectedContract) {
    return validationResult(['m2-lifecycle:unexpected-contract'], value);
  }
  if (value.contract === M2_LIFECYCLE_CONTRACT_KIND.PLAN_SNAPSHOT) {
    return validateM2LifecyclePlanSnapshot(value);
  }
  if (value.contract === M2_LIFECYCLE_CONTRACT_KIND.APPROVAL_INTENT) {
    return validateM2LifecycleApprovalIntent(value);
  }
  if (value.contract === M2_LIFECYCLE_CONTRACT_KIND.TERMINAL_SNAPSHOT) {
    return validateM2LifecycleTerminalSnapshot(value);
  }
  return validationResult(['m2-lifecycle:unknown-contract'], value);
}

export function encodeM2LifecycleContract(value, expectedContract = null) {
  const validation = validateM2LifecycleContract(value, expectedContract);
  if (!validation.valid) throw new TypeError(validation.errors.join(','));
  return Buffer.from(canonicalizeM2LifecycleValue(value), 'utf8');
}

export function decodeM2LifecycleContract(encoded, expectedContract = null) {
  if (!(typeof encoded === 'string' || Buffer.isBuffer(encoded) || encoded instanceof Uint8Array)) {
    throw new TypeError('m2-lifecycle-decode:invalid-bytes');
  }
  const bytes = Buffer.isBuffer(encoded) ? encoded : Buffer.from(encoded);
  if (bytes.length === 0 || bytes.length > 4_194_304) {
    throw new TypeError('m2-lifecycle-decode:invalid-size');
  }
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new TypeError('m2-lifecycle-decode:invalid-utf8');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TypeError('m2-lifecycle-decode:invalid-json');
  }
  const validation = validateM2LifecycleContract(value, expectedContract);
  if (!validation.valid) throw new TypeError(validation.errors.join(','));
  if (!Buffer.from(canonicalizeM2LifecycleValue(value), 'utf8').equals(bytes)) {
    throw new TypeError('m2-lifecycle-decode:noncanonical');
  }
  return Object.freeze(value);
}
