import { createHash } from 'node:crypto';

import {
  canonicalizeM2ExecutionValue,
  computeM2ExecutionValueDigest,
  computeM2ProjectChangeRequestDigest,
  validateM2ProjectChangeRequest,
  validateM2ProjectChangeResultForRequest,
} from '../../../contracts/m2/execution-v1.js';
import {
  canonicalizeM2GovernanceValue,
  computeM2GovernanceBaselineDigest,
  computeM2GovernanceDecisionDigest,
  computeM2GovernancePolicySnapshotDigest,
  computeM2GovernanceReceiptDigest,
  validateM2GovernanceBaselineSnapshot,
  validateM2GovernanceDecision,
  validateM2GovernancePolicySnapshot,
  validateM2GovernanceReceiptForDecision,
} from '../../../contracts/m2/governance-v1.js';
import {
  M2_LIFECYCLE_STATE,
  canonicalizeM2LifecycleValue,
  computeM2LifecycleApprovalIntentDigest,
  computeM2LifecyclePlanSnapshotDigest,
  computeM2LifecycleTerminalSnapshotDigest,
  computeM2LifecycleValueDigest,
  validateM2LifecycleApprovalIntentForPlan,
  validateM2LifecyclePlanSnapshotForContext,
  validateM2LifecyclePlanSnapshotForDecision,
  validateM2LifecycleTerminalSnapshot,
  validateM2LifecycleTerminalSnapshotForExecution,
} from '../../../contracts/m2/lifecycle-v1.js';
import { isIdentifier, isPlainRecord, validateExactKeys } from '../../../contracts/m1/shared.js';

export const version = '2026_08_24_079_m2_lifecycle_authority';
export const description = 'Add durable exact M2 lifecycle, governance, approval, and terminal authority';

// Filled from the canonical sqlite_master projection produced by this migration.
export const EXPECTED_M2_LIFECYCLE_SCHEMA_FINGERPRINT = 'e08966bdf3a40c6acd3a8832a4f8912968d506ab852e74ce776e74b6c5186b87';

const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const TERMINAL_WITHOUT_RESULT = new Set([
  M2_LIFECYCLE_STATE.BLOCKED,
  M2_LIFECYCLE_STATE.CANCELLED,
]);

function parseJson(value) {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function canonicalEquals(value, encoded, canonicalizer = canonicalizeM2LifecycleValue) {
  try {
    return canonicalizer(value) === encoded;
  } catch {
    return false;
  }
}

function validFocusedEnvironment(value) {
  if (!isPlainRecord(value)) return false;
  return Object.entries(value).every(([key, entry]) => (
    ENVIRONMENT_KEY_PATTERN.test(key)
    && typeof entry === 'string'
    && entry === entry.normalize('NFC')
    && !entry.includes('\0')
    && Buffer.from(entry, 'utf8').toString('utf8') === entry
    && Buffer.byteLength(entry, 'utf8') <= 32_768
  ));
}

function operationValid(
  planJson,
  requestJson,
  contextJson,
  focusedEnvironmentJson,
  policyJson,
  baselineJson,
  decisionJson,
) {
  try {
    const plan = parseJson(planJson);
    const request = parseJson(requestJson);
    const contextSnapshot = parseJson(contextJson);
    const focusedEnvironment = parseJson(focusedEnvironmentJson);
    const policySnapshot = parseJson(policyJson);
    const baselineSnapshot = parseJson(baselineJson);
    const decision = parseJson(decisionJson);
    if (!plan || !request || !contextSnapshot || !focusedEnvironment
      || !policySnapshot || !baselineSnapshot || !decision) return 0;
    const exact = canonicalEquals(plan, planJson)
      && canonicalEquals(request, requestJson, canonicalizeM2ExecutionValue)
      && canonicalEquals(contextSnapshot, contextJson)
      && canonicalEquals(focusedEnvironment, focusedEnvironmentJson)
      && canonicalEquals(policySnapshot, policyJson, canonicalizeM2GovernanceValue)
      && canonicalEquals(baselineSnapshot, baselineJson, canonicalizeM2GovernanceValue)
      && canonicalEquals(decision, decisionJson, canonicalizeM2GovernanceValue);
    if (!exact || !validateM2ProjectChangeRequest(request).valid
      || !validateM2LifecyclePlanSnapshotForContext(contextSnapshot, plan).valid
      || !validateM2LifecyclePlanSnapshotForDecision(request, decision, plan).valid
      || !validateM2GovernancePolicySnapshot(policySnapshot).valid
      || !validateM2GovernanceBaselineSnapshot(baselineSnapshot).valid
      || !validateM2GovernanceDecision(decision).valid
      || !validFocusedEnvironment(focusedEnvironment)) return 0;
    return plan.state === M2_LIFECYCLE_STATE.AWAITING_APPROVAL
      && baselineSnapshot.complete === true
      && policySnapshot.projectId === request.project.projectId
      && policySnapshot.workspaceRevision === request.project.workspaceRevision
      && baselineSnapshot.projectId === request.project.projectId
      && baselineSnapshot.workspaceRevision === request.project.workspaceRevision
      && computeM2GovernancePolicySnapshotDigest(policySnapshot) === plan.governancePolicyDigest
      && computeM2GovernanceBaselineDigest(baselineSnapshot) === plan.governanceBaselineDigest
      && computeM2GovernanceDecisionDigest(decision) === plan.governanceDecisionDigest
      && computeM2ExecutionValueDigest(focusedEnvironment) === request.focusedTest.environmentDigest
      ? 1 : 0;
  } catch {
    return 0;
  }
}

function approvalValid(planJson, approvalJson, approvedAtMs, expiresAtMs) {
  try {
    const plan = parseJson(planJson);
    const approval = parseJson(approvalJson);
    return plan && approval
      && canonicalEquals(plan, planJson)
      && canonicalEquals(approval, approvalJson)
      && validateM2LifecycleApprovalIntentForPlan(plan, approval).valid
      && Date.parse(approval.approvedAt) === approvedAtMs
      && Date.parse(approval.expiresAt) === expiresAtMs
      ? 1 : 0;
  } catch {
    return 0;
  }
}

function validateGrantSet(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 68) return false;
  const effectIds = [];
  const grantIds = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (validateExactKeys(entry, ['effectId', 'grantId'], [], `grant-set[${index}]`).length > 0
      || !isIdentifier(entry?.effectId)
      || !isIdentifier(entry?.grantId)) return false;
    effectIds.push(entry.effectId);
    grantIds.push(entry.grantId);
    if (index > 0 && Buffer.compare(
      Buffer.from(effectIds[index - 1], 'utf8'),
      Buffer.from(effectIds[index], 'utf8'),
    ) >= 0) return false;
  }
  return new Set(effectIds).size === effectIds.length
    && new Set(grantIds).size === grantIds.length;
}

function grantSetValid(grantSetJson) {
  try {
    const grantSet = parseJson(grantSetJson);
    return validateGrantSet(grantSet)
      && canonicalEquals(grantSet, grantSetJson)
      ? 1 : 0;
  } catch {
    return 0;
  }
}

function cancelValid(planJson, cancelJson, requestedAtMs) {
  try {
    const plan = parseJson(planJson);
    const cancel = parseJson(cancelJson);
    if (!plan || !cancel || !canonicalEquals(plan, planJson) || !canonicalEquals(cancel, cancelJson)) {
      return 0;
    }
    const errors = validateExactKeys(
      cancel,
      ['cancelId', 'identity', 'actor', 'reason', 'requestedAt'],
      [],
      'lifecycle-cancel-intent',
    );
    errors.push(...validateExactKeys(
      cancel.identity,
      ['lifecycleId', 'milestoneId', 'runId', 'executionId'],
      [],
      'lifecycle-cancel-intent.identity',
    ));
    errors.push(...validateExactKeys(cancel.actor, ['type', 'id'], [], 'lifecycle-cancel-intent.actor'));
    if (!isIdentifier(cancel.cancelId)
      || !['lifecycleId', 'milestoneId', 'runId', 'executionId'].every(
        key => isIdentifier(cancel.identity?.[key]),
      )
      || cancel.actor?.type !== 'user'
      || !isIdentifier(cancel.actor?.id)
      || typeof cancel.reason !== 'string'
      || cancel.reason.trim().length < 1
      || Buffer.byteLength(cancel.reason, 'utf8') > 1_024
      || typeof cancel.requestedAt !== 'string'
      || new Date(cancel.requestedAt).toISOString() !== cancel.requestedAt) return 0;
    return errors.length === 0
      && computeM2LifecycleValueDigest(cancel.identity) === computeM2LifecycleValueDigest(plan.identity)
      && cancel.actor.type === plan.actor.type
      && cancel.actor.id === plan.actor.id
      && Date.parse(cancel.requestedAt) === requestedAtMs
      ? 1 : 0;
  } catch {
    return 0;
  }
}

function receiptValid(requestJson, resultJson, decisionJson, receiptJson, recordedAtMs) {
  try {
    const request = parseJson(requestJson);
    const result = parseJson(resultJson);
    const decision = parseJson(decisionJson);
    const receipt = parseJson(receiptJson);
    return request && result && decision && receipt
      && canonicalEquals(request, requestJson, canonicalizeM2ExecutionValue)
      && canonicalEquals(result, resultJson, canonicalizeM2ExecutionValue)
      && canonicalEquals(decision, decisionJson, canonicalizeM2GovernanceValue)
      && canonicalEquals(receipt, receiptJson, canonicalizeM2GovernanceValue)
      && validateM2GovernanceReceiptForDecision(request, result, decision, receipt).valid
      && Date.parse(receipt.recordedAt) === recordedAtMs
      ? 1 : 0;
  } catch {
    return 0;
  }
}

function terminalValid(
  planJson,
  approvalJson,
  requestJson,
  contextJson,
  resultJson,
  decisionJson,
  receiptJson,
  terminalJson,
  completedAtMs,
) {
  try {
    const plan = parseJson(planJson);
    const approval = parseJson(approvalJson);
    const request = parseJson(requestJson);
    const contextSnapshot = parseJson(contextJson);
    const result = parseJson(resultJson);
    const decision = parseJson(decisionJson);
    const receipt = parseJson(receiptJson);
    const terminal = parseJson(terminalJson);
    if (!plan || !request || !contextSnapshot || !decision || !terminal
      || !canonicalEquals(plan, planJson)
      || !canonicalEquals(request, requestJson, canonicalizeM2ExecutionValue)
      || !canonicalEquals(contextSnapshot, contextJson)
      || !canonicalEquals(decision, decisionJson, canonicalizeM2GovernanceValue)
      || !canonicalEquals(terminal, terminalJson)
      || Date.parse(terminal.completedAt) !== completedAtMs) return 0;
    if (approval && !canonicalEquals(approval, approvalJson)) return 0;
    if (result && !canonicalEquals(result, resultJson, canonicalizeM2ExecutionValue)) return 0;
    if (receipt && !canonicalEquals(receipt, receiptJson, canonicalizeM2GovernanceValue)) return 0;

    if (terminal.state === M2_LIFECYCLE_STATE.SUCCEEDED) {
      if (!approval || !result || !receipt) return 0;
      return validateM2LifecycleTerminalSnapshotForExecution({
        contextSnapshot,
        plan,
        approval,
        request,
        result,
        governanceDecision: decision,
        governanceReceipt: receipt,
        terminal,
      }).valid ? 1 : 0;
    }

    if (!validateM2LifecycleTerminalSnapshot(terminal).valid
      || !validateM2LifecyclePlanSnapshotForContext(contextSnapshot, plan).valid
      || !validateM2LifecyclePlanSnapshotForDecision(request, decision, plan).valid) return 0;
    if (approval && !validateM2LifecycleApprovalIntentForPlan(plan, approval).valid) return 0;
    if (receipt !== null || terminal.governanceReceiptDigest !== null) return 0;
    if (
      computeM2LifecycleValueDigest(terminal.identity) !== computeM2LifecycleValueDigest(plan.identity)
      || terminal.planVersion !== plan.planVersion
      || terminal.planDigest !== computeM2LifecyclePlanSnapshotDigest(plan)
      || terminal.requestDigest !== computeM2ProjectChangeRequestDigest(request)
      || terminal.authoritySetDigest !== request.authoritySetDigest
      || terminal.projectId !== request.project.projectId
      || terminal.governanceDecisionDigest !== computeM2GovernanceDecisionDigest(decision)
      || terminal.approvalIntentDigest !== (
        approval === null ? null : computeM2LifecycleApprovalIntentDigest(approval)
      )
    ) return 0;
    if (result === null) {
      return TERMINAL_WITHOUT_RESULT.has(terminal.state)
        && terminal.resultDigest === null
        && terminal.workspaceRevision === request.project.workspaceRevision
        ? 1 : 0;
    }
    const resultValidation = validateM2ProjectChangeResultForRequest(request, result);
    const expectedRevision = result.changes.afterRevision ?? request.project.workspaceRevision;
    const orphanedSucceededResult = terminal.state === M2_LIFECYCLE_STATE.ORPHANED
      && result.terminalStatus === M2_LIFECYCLE_STATE.SUCCEEDED
      && [
        'M2_LIFECYCLE_RESULT_REVISION_MISMATCH',
        'M2_LIFECYCLE_LATE_SUCCESS_AFTER_CANCEL',
      ].includes(terminal.errorCode);
    return resultValidation.valid
      && (result.terminalStatus === terminal.state || orphanedSucceededResult)
      && terminal.resultDigest === computeM2ExecutionValueDigest(result)
      && (terminal.state === M2_LIFECYCLE_STATE.ORPHANED
        || terminal.workspaceRevision === expectedRevision)
      && result.evidenceRefs.every(reference => terminal.evidenceRefs.includes(reference))
      && (terminal.state !== M2_LIFECYCLE_STATE.ORPHANED
        || terminal.evidenceRefs.length > 0)
      ? 1 : 0;
  } catch {
    return 0;
  }
}

function jsonDigest(encoded) {
  try {
    const value = parseJson(encoded);
    if (value === null || !canonicalEquals(value, encoded)) return null;
    return computeM2LifecycleValueDigest(value);
  } catch {
    return null;
  }
}

function operationDigest(
  planJson,
  requestJson,
  contextJson,
  focusedEnvironmentJson,
  policyJson,
  baselineJson,
  decisionJson,
) {
  try {
    const plan = parseJson(planJson);
    const request = parseJson(requestJson);
    const contextSnapshot = parseJson(contextJson);
    const focusedEnvironment = parseJson(focusedEnvironmentJson);
    const policySnapshot = parseJson(policyJson);
    const baselineSnapshot = parseJson(baselineJson);
    const decision = parseJson(decisionJson);
    if (!plan || !request || !contextSnapshot || !focusedEnvironment
      || !policySnapshot || !baselineSnapshot || !decision
      || !canonicalEquals(plan, planJson)
      || !canonicalEquals(request, requestJson, canonicalizeM2ExecutionValue)
      || !canonicalEquals(contextSnapshot, contextJson)
      || !canonicalEquals(focusedEnvironment, focusedEnvironmentJson)
      || !canonicalEquals(policySnapshot, policyJson, canonicalizeM2GovernanceValue)
      || !canonicalEquals(baselineSnapshot, baselineJson, canonicalizeM2GovernanceValue)
      || !canonicalEquals(decision, decisionJson, canonicalizeM2GovernanceValue)) return null;
    return computeM2LifecycleValueDigest({
      plan,
      requestDigest: computeM2ProjectChangeRequestDigest(request),
      contextSnapshot,
      focusedEnvironment,
      policySnapshot,
      baselineSnapshot,
      decision,
    });
  } catch {
    return null;
  }
}

export function registerM2LifecycleSemanticFunctions(db) {
  db.function('m2_lifecycle_operation_valid_v1', {
    deterministic: true,
    varargs: true,
  }, operationValid);
  db.function('m2_lifecycle_approval_valid_v1', { deterministic: true }, approvalValid);
  db.function('m2_lifecycle_grant_set_valid_v1', { deterministic: true }, grantSetValid);
  db.function('m2_lifecycle_cancel_valid_v1', { deterministic: true }, cancelValid);
  db.function('m2_lifecycle_receipt_valid_v1', {
    deterministic: true,
    varargs: true,
  }, receiptValid);
  db.function('m2_lifecycle_terminal_valid_v1', {
    deterministic: true,
    varargs: true,
  }, terminalValid);
  db.function('m2_lifecycle_json_digest_v1', { deterministic: true }, jsonDigest);
  db.function('m2_lifecycle_operation_digest_v1', {
    deterministic: true,
    varargs: true,
  }, operationDigest);
}

export function computeM2LifecycleSchemaFingerprint(db) {
  const rows = db.prepare(`
    SELECT type, name, sql FROM sqlite_master
    WHERE sql IS NOT NULL AND (
      name GLOB 'm2_lifecycle_*'
      OR name GLOB 'trg_m2_lifecycle_*'
      OR name GLOB 'idx_m2_lifecycle_*'
    )
    ORDER BY type, name
  `).all().map(row => ({
    type: row.type,
    name: row.name,
    sql: row.sql.replace(/\s+/g, ' ').trim(),
  }));
  return createHash('sha256').update(JSON.stringify(rows), 'utf8').digest('hex');
}

function installLifecycleAuthority(db) {
  db.exec(`
    CREATE TABLE m2_lifecycle_operations (
      lifecycle_id TEXT PRIMARY KEY CHECK (length(trim(lifecycle_id)) BETWEEN 1 AND 128),
      milestone_id TEXT NOT NULL CHECK (length(trim(milestone_id)) BETWEEN 1 AND 128),
      run_id TEXT NOT NULL UNIQUE CHECK (length(trim(run_id)) BETWEEN 1 AND 128),
      execution_id TEXT NOT NULL UNIQUE
        REFERENCES m2_execution_requests(execution_id) ON DELETE RESTRICT,
      project_id INTEGER NOT NULL CHECK (typeof(project_id) = 'integer' AND project_id > 0),
      plan_version INTEGER NOT NULL CHECK (typeof(plan_version) = 'integer' AND plan_version > 0),
      plan_digest TEXT NOT NULL UNIQUE CHECK (length(plan_digest) = 71 AND substr(plan_digest, 1, 7) = 'sha256:'),
      request_digest TEXT NOT NULL CHECK (length(request_digest) = 71 AND substr(request_digest, 1, 7) = 'sha256:'),
      authority_set_digest TEXT NOT NULL CHECK (length(authority_set_digest) = 71 AND substr(authority_set_digest, 1, 7) = 'sha256:'),
      context_snapshot_digest TEXT NOT NULL CHECK (length(context_snapshot_digest) = 71 AND substr(context_snapshot_digest, 1, 7) = 'sha256:'),
      focused_environment_digest TEXT NOT NULL CHECK (length(focused_environment_digest) = 71 AND substr(focused_environment_digest, 1, 7) = 'sha256:'),
      policy_digest TEXT NOT NULL CHECK (length(policy_digest) = 71 AND substr(policy_digest, 1, 7) = 'sha256:'),
      baseline_digest TEXT NOT NULL CHECK (length(baseline_digest) = 71 AND substr(baseline_digest, 1, 7) = 'sha256:'),
      decision_digest TEXT NOT NULL UNIQUE CHECK (length(decision_digest) = 71 AND substr(decision_digest, 1, 7) = 'sha256:'),
      expected_after_revision TEXT NOT NULL CHECK (length(trim(expected_after_revision)) BETWEEN 1 AND 256),
      operation_digest TEXT NOT NULL UNIQUE CHECK (length(operation_digest) = 71 AND substr(operation_digest, 1, 7) = 'sha256:'),
      plan_json TEXT NOT NULL CHECK (json_valid(plan_json) AND length(CAST(plan_json AS BLOB)) <= 4194304),
      context_snapshot_json TEXT NOT NULL CHECK (json_valid(context_snapshot_json) AND length(CAST(context_snapshot_json AS BLOB)) <= 4194304),
      focused_environment_json TEXT NOT NULL CHECK (json_valid(focused_environment_json) AND length(CAST(focused_environment_json AS BLOB)) <= 1048576),
      policy_json TEXT NOT NULL CHECK (json_valid(policy_json) AND length(CAST(policy_json AS BLOB)) <= 4194304),
      baseline_json TEXT NOT NULL CHECK (json_valid(baseline_json) AND length(CAST(baseline_json AS BLOB)) <= 16777216),
      decision_json TEXT NOT NULL CHECK (json_valid(decision_json) AND length(CAST(decision_json AS BLOB)) <= 4194304),
      created_at_ms INTEGER NOT NULL CHECK (typeof(created_at_ms) = 'integer' AND created_at_ms >= 0),
      approval_expires_at_ms INTEGER NOT NULL CHECK (typeof(approval_expires_at_ms) = 'integer' AND approval_expires_at_ms > created_at_ms)
    );

    CREATE TRIGGER trg_m2_lifecycle_operations_exact
    BEFORE INSERT ON m2_lifecycle_operations
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_execution_requests request
      WHERE request.execution_id = NEW.execution_id
        AND request.run_id = NEW.run_id
        AND request.project_id = NEW.project_id
        AND request.request_digest = NEW.request_digest
        AND request.authority_set_digest = NEW.authority_set_digest
        AND m2_lifecycle_operation_valid_v1(
          NEW.plan_json, request.request_json, NEW.context_snapshot_json,
          NEW.focused_environment_json, NEW.policy_json, NEW.baseline_json,
          NEW.decision_json
        ) = 1
        AND json_extract(NEW.plan_json, '$.identity.lifecycleId') IS NEW.lifecycle_id
        AND json_extract(NEW.plan_json, '$.identity.milestoneId') IS NEW.milestone_id
        AND json_extract(NEW.plan_json, '$.identity.runId') IS NEW.run_id
        AND json_extract(NEW.plan_json, '$.identity.executionId') IS NEW.execution_id
        AND json_extract(NEW.plan_json, '$.project.projectId') IS NEW.project_id
        AND json_extract(NEW.plan_json, '$.planVersion') IS NEW.plan_version
        AND m2_lifecycle_json_digest_v1(NEW.plan_json) IS NEW.plan_digest
        AND json_extract(NEW.plan_json, '$.requestDigest') IS NEW.request_digest
        AND json_extract(NEW.plan_json, '$.authoritySetDigest') IS NEW.authority_set_digest
        AND json_extract(NEW.plan_json, '$.contextSnapshotDigest') IS NEW.context_snapshot_digest
        AND m2_lifecycle_json_digest_v1(NEW.context_snapshot_json) IS NEW.context_snapshot_digest
        AND m2_lifecycle_json_digest_v1(NEW.focused_environment_json) IS NEW.focused_environment_digest
        AND json_extract(NEW.plan_json, '$.governancePolicyDigest') IS NEW.policy_digest
        AND json_extract(NEW.plan_json, '$.governanceBaselineDigest') IS NEW.baseline_digest
        AND json_extract(NEW.plan_json, '$.governanceDecisionDigest') IS NEW.decision_digest
        AND json_extract(NEW.plan_json, '$.expectedAfterRevision') IS NEW.expected_after_revision
        AND m2_lifecycle_operation_digest_v1(
          NEW.plan_json, request.request_json, NEW.context_snapshot_json,
          NEW.focused_environment_json, NEW.policy_json, NEW.baseline_json,
          NEW.decision_json
        ) IS NEW.operation_digest
    )
    BEGIN
      SELECT RAISE(ABORT, 'M2_LIFECYCLE_OPERATION_AUTHORITY_MISMATCH');
    END;

    CREATE TABLE m2_lifecycle_approval_intents (
      lifecycle_id TEXT PRIMARY KEY REFERENCES m2_lifecycle_operations(lifecycle_id) ON DELETE RESTRICT,
      approval_id TEXT NOT NULL UNIQUE CHECK (length(trim(approval_id)) BETWEEN 1 AND 128),
      plan_digest TEXT NOT NULL,
      request_digest TEXT NOT NULL,
      authority_set_digest TEXT NOT NULL,
      actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) BETWEEN 1 AND 128),
      intent_digest TEXT NOT NULL UNIQUE CHECK (length(intent_digest) = 71 AND substr(intent_digest, 1, 7) = 'sha256:'),
      intent_json TEXT NOT NULL CHECK (json_valid(intent_json) AND length(CAST(intent_json AS BLOB)) <= 1048576),
      approved_at_ms INTEGER NOT NULL CHECK (typeof(approved_at_ms) = 'integer' AND approved_at_ms >= 0),
      expires_at_ms INTEGER NOT NULL CHECK (typeof(expires_at_ms) = 'integer' AND expires_at_ms > approved_at_ms),
      recorded_at_ms INTEGER NOT NULL CHECK (typeof(recorded_at_ms) = 'integer' AND recorded_at_ms >= approved_at_ms AND recorded_at_ms < expires_at_ms)
    );

    CREATE TRIGGER trg_m2_lifecycle_approval_intents_exact
    BEFORE INSERT ON m2_lifecycle_approval_intents
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_lifecycle_operations operation
      WHERE operation.lifecycle_id = NEW.lifecycle_id
        AND operation.plan_digest = NEW.plan_digest
        AND operation.request_digest = NEW.request_digest
        AND operation.authority_set_digest = NEW.authority_set_digest
        AND operation.approval_expires_at_ms >= NEW.expires_at_ms
        AND m2_lifecycle_approval_valid_v1(
          operation.plan_json, NEW.intent_json, NEW.approved_at_ms, NEW.expires_at_ms
        ) = 1
        AND json_extract(NEW.intent_json, '$.approvalId') IS NEW.approval_id
        AND json_extract(NEW.intent_json, '$.actor.id') IS NEW.actor_id
        AND m2_lifecycle_json_digest_v1(NEW.intent_json) IS NEW.intent_digest
      ) OR EXISTS (
        SELECT 1 FROM m2_lifecycle_terminals terminal
        WHERE terminal.lifecycle_id = NEW.lifecycle_id
      ) OR EXISTS (
        SELECT 1 FROM m2_lifecycle_cancel_intents cancel
        WHERE cancel.lifecycle_id = NEW.lifecycle_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'M2_LIFECYCLE_APPROVAL_AUTHORITY_MISMATCH');
    END;

    CREATE TABLE m2_lifecycle_grant_sets (
      lifecycle_id TEXT PRIMARY KEY REFERENCES m2_lifecycle_operations(lifecycle_id) ON DELETE RESTRICT,
      approval_intent_digest TEXT NOT NULL,
      authority_set_digest TEXT NOT NULL,
      grant_set_digest TEXT NOT NULL UNIQUE CHECK (length(grant_set_digest) = 71 AND substr(grant_set_digest, 1, 7) = 'sha256:'),
      grant_set_json TEXT NOT NULL CHECK (json_valid(grant_set_json) AND length(CAST(grant_set_json AS BLOB)) <= 1048576),
      recorded_at_ms INTEGER NOT NULL CHECK (typeof(recorded_at_ms) = 'integer' AND recorded_at_ms >= 0)
    );

    CREATE TRIGGER trg_m2_lifecycle_grant_sets_exact
    BEFORE INSERT ON m2_lifecycle_grant_sets
    WHEN m2_lifecycle_grant_set_valid_v1(NEW.grant_set_json) <> 1
      OR m2_lifecycle_json_digest_v1(NEW.grant_set_json) IS NOT NEW.grant_set_digest
      OR NOT EXISTS (
        SELECT 1 FROM m2_lifecycle_operations operation
        JOIN m2_lifecycle_approval_intents approval USING (lifecycle_id)
        WHERE operation.lifecycle_id = NEW.lifecycle_id
          AND operation.authority_set_digest = NEW.authority_set_digest
          AND approval.intent_digest = NEW.approval_intent_digest
          AND approval.recorded_at_ms <= NEW.recorded_at_ms
          AND approval.expires_at_ms > NEW.recorded_at_ms
          AND json_array_length(NEW.grant_set_json) = (
            SELECT count(*) FROM m2_execution_steps step
            WHERE step.execution_id = operation.execution_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM m2_execution_steps step
            WHERE step.execution_id = operation.execution_id
              AND NOT EXISTS (
                SELECT 1 FROM json_each(NEW.grant_set_json) member
                JOIN m2_approval_grants grant
                  ON grant.grant_id = json_extract(member.value, '$.grantId')
                 AND grant.effect_id = json_extract(member.value, '$.effectId')
                JOIN m2_effect_requests effect ON effect.effect_id = grant.effect_id
                WHERE grant.effect_id = step.effect_id
                  AND effect.request_digest = step.request_digest
                  AND grant.run_id = operation.run_id
                  AND grant.project_id = operation.project_id
                  AND grant.workspace_revision = json_extract(operation.plan_json, '$.project.workspaceRevision')
                  AND json_extract(grant.grant_json, '$.subject.actorType') = 'user'
                  AND json_extract(grant.grant_json, '$.subject.actorId') = approval.actor_id
                  AND grant.issued_at_ms <= NEW.recorded_at_ms
                  AND grant.expires_at_ms > NEW.recorded_at_ms
                  AND grant.consumed_at_ms IS NULL
                  AND grant.revoked_at_ms IS NULL
              )
          )
      ) OR EXISTS (
        SELECT 1 FROM m2_lifecycle_terminals terminal
        WHERE terminal.lifecycle_id = NEW.lifecycle_id
      ) OR EXISTS (
        SELECT 1 FROM m2_lifecycle_cancel_intents cancel
        WHERE cancel.lifecycle_id = NEW.lifecycle_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'M2_LIFECYCLE_GRANT_SET_INCOMPLETE');
    END;

    CREATE TABLE m2_lifecycle_cancel_intents (
      lifecycle_id TEXT PRIMARY KEY REFERENCES m2_lifecycle_operations(lifecycle_id) ON DELETE RESTRICT,
      cancel_id TEXT NOT NULL UNIQUE CHECK (length(trim(cancel_id)) BETWEEN 1 AND 128),
      actor_id TEXT NOT NULL CHECK (length(trim(actor_id)) BETWEEN 1 AND 128),
      intent_digest TEXT NOT NULL UNIQUE CHECK (length(intent_digest) = 71 AND substr(intent_digest, 1, 7) = 'sha256:'),
      intent_json TEXT NOT NULL CHECK (json_valid(intent_json) AND length(CAST(intent_json AS BLOB)) <= 1048576),
      requested_at_ms INTEGER NOT NULL CHECK (typeof(requested_at_ms) = 'integer' AND requested_at_ms >= 0)
    );

    CREATE TRIGGER trg_m2_lifecycle_cancel_intents_exact
    BEFORE INSERT ON m2_lifecycle_cancel_intents
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_lifecycle_operations operation
      WHERE operation.lifecycle_id = NEW.lifecycle_id
        AND m2_lifecycle_cancel_valid_v1(
          operation.plan_json, NEW.intent_json, NEW.requested_at_ms
        ) = 1
        AND json_extract(NEW.intent_json, '$.cancelId') IS NEW.cancel_id
        AND json_extract(NEW.intent_json, '$.actor.id') IS NEW.actor_id
        AND m2_lifecycle_json_digest_v1(NEW.intent_json) IS NEW.intent_digest
      ) OR EXISTS (
        SELECT 1 FROM m2_lifecycle_terminals terminal
        WHERE terminal.lifecycle_id = NEW.lifecycle_id
      ) OR EXISTS (
        SELECT 1 FROM m2_lifecycle_operations operation
        JOIN m2_execution_results result ON result.execution_id = operation.execution_id
        WHERE operation.lifecycle_id = NEW.lifecycle_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'M2_LIFECYCLE_CANCEL_AUTHORITY_MISMATCH');
    END;

    CREATE TABLE m2_lifecycle_governance_receipts (
      lifecycle_id TEXT PRIMARY KEY REFERENCES m2_lifecycle_operations(lifecycle_id) ON DELETE RESTRICT,
      receipt_id TEXT NOT NULL UNIQUE CHECK (length(trim(receipt_id)) BETWEEN 1 AND 128),
      decision_digest TEXT NOT NULL,
      result_digest TEXT NOT NULL,
      receipt_digest TEXT NOT NULL UNIQUE CHECK (length(receipt_digest) = 71 AND substr(receipt_digest, 1, 7) = 'sha256:'),
      receipt_json TEXT NOT NULL CHECK (json_valid(receipt_json) AND length(CAST(receipt_json AS BLOB)) <= 4194304),
      recorded_at_ms INTEGER NOT NULL CHECK (typeof(recorded_at_ms) = 'integer' AND recorded_at_ms >= 0)
    );

    CREATE TRIGGER trg_m2_lifecycle_governance_receipts_exact
    BEFORE INSERT ON m2_lifecycle_governance_receipts
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_lifecycle_operations operation
      JOIN m2_lifecycle_approval_intents approval USING (lifecycle_id)
      JOIN m2_lifecycle_grant_sets grant_set USING (lifecycle_id)
      JOIN m2_execution_requests request ON request.execution_id = operation.execution_id
      JOIN m2_execution_results result ON result.execution_id = operation.execution_id
      WHERE operation.lifecycle_id = NEW.lifecycle_id
        AND result.terminal_status = 'succeeded'
        AND operation.decision_digest = NEW.decision_digest
        AND json_extract(result.result_json, '$.requestDigest') = operation.request_digest
        AND m2_lifecycle_receipt_valid_v1(
          request.request_json, result.result_json, operation.decision_json,
          NEW.receipt_json, NEW.recorded_at_ms
        ) = 1
        AND json_extract(NEW.receipt_json, '$.receiptId') IS NEW.receipt_id
        AND json_extract(NEW.receipt_json, '$.resultDigest') IS NEW.result_digest
        AND m2_lifecycle_json_digest_v1(NEW.receipt_json) IS NEW.receipt_digest
      ) OR EXISTS (
        SELECT 1 FROM m2_lifecycle_terminals terminal
        WHERE terminal.lifecycle_id = NEW.lifecycle_id
      ) OR EXISTS (
        SELECT 1 FROM m2_lifecycle_cancel_intents cancel
        WHERE cancel.lifecycle_id = NEW.lifecycle_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'M2_LIFECYCLE_RECEIPT_AUTHORITY_MISMATCH');
    END;

    CREATE TABLE m2_lifecycle_terminals (
      lifecycle_id TEXT PRIMARY KEY REFERENCES m2_lifecycle_operations(lifecycle_id) ON DELETE RESTRICT,
      execution_id TEXT NOT NULL UNIQUE REFERENCES m2_execution_requests(execution_id) ON DELETE RESTRICT,
      terminal_status TEXT NOT NULL CHECK (terminal_status IN (
        'succeeded','failed','cancelled','timed_out','orphaned','blocked'
      )),
      terminal_digest TEXT NOT NULL UNIQUE CHECK (length(terminal_digest) = 71 AND substr(terminal_digest, 1, 7) = 'sha256:'),
      terminal_json TEXT NOT NULL CHECK (json_valid(terminal_json) AND length(CAST(terminal_json AS BLOB)) <= 4194304),
      completed_at_ms INTEGER NOT NULL CHECK (typeof(completed_at_ms) = 'integer' AND completed_at_ms >= 0)
    );

    CREATE TRIGGER trg_m2_lifecycle_terminals_exact
    BEFORE INSERT ON m2_lifecycle_terminals
    WHEN NOT EXISTS (
      SELECT 1 FROM m2_lifecycle_operations operation
      JOIN m2_execution_requests request ON request.execution_id = operation.execution_id
      LEFT JOIN m2_lifecycle_approval_intents approval USING (lifecycle_id)
      LEFT JOIN m2_execution_results result ON result.execution_id = operation.execution_id
      LEFT JOIN m2_lifecycle_governance_receipts receipt USING (lifecycle_id)
      WHERE operation.lifecycle_id = NEW.lifecycle_id
        AND operation.execution_id = NEW.execution_id
        AND json_extract(NEW.terminal_json, '$.state') IS NEW.terminal_status
        AND m2_lifecycle_json_digest_v1(NEW.terminal_json) IS NEW.terminal_digest
        AND m2_lifecycle_terminal_valid_v1(
          operation.plan_json, approval.intent_json, request.request_json,
          operation.context_snapshot_json, result.result_json,
          operation.decision_json, receipt.receipt_json, NEW.terminal_json,
          NEW.completed_at_ms
        ) = 1
        AND (
          NEW.terminal_status <> 'succeeded'
          OR (approval.lifecycle_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM m2_lifecycle_grant_sets grants WHERE grants.lifecycle_id = NEW.lifecycle_id)
            AND result.terminal_status = 'succeeded'
            AND receipt.lifecycle_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM m2_lifecycle_cancel_intents cancel WHERE cancel.lifecycle_id = NEW.lifecycle_id))
        )
        AND (
          result.execution_id IS NOT NULL
          OR NEW.terminal_status IN ('blocked', 'cancelled')
        )
        AND (
          NEW.terminal_status <> 'cancelled'
          OR result.execution_id IS NOT NULL
          OR EXISTS (SELECT 1 FROM m2_lifecycle_cancel_intents cancel WHERE cancel.lifecycle_id = NEW.lifecycle_id)
        )
        AND (
          json_extract(NEW.terminal_json, '$.errorCode') IS NOT 'M2_LIFECYCLE_LATE_SUCCESS_AFTER_CANCEL'
          OR (NEW.terminal_status = 'orphaned'
            AND result.terminal_status = 'succeeded'
            AND EXISTS (
              SELECT 1 FROM m2_lifecycle_cancel_intents cancel
              WHERE cancel.lifecycle_id = NEW.lifecycle_id
            ))
        )
        AND (
          result.execution_id IS NULL
          OR result.terminal_status <> 'succeeded'
          OR NOT EXISTS (
            SELECT 1 FROM m2_lifecycle_cancel_intents cancel
            WHERE cancel.lifecycle_id = NEW.lifecycle_id
          )
          OR (NEW.terminal_status = 'orphaned'
            AND json_extract(NEW.terminal_json, '$.errorCode') = 'M2_LIFECYCLE_LATE_SUCCESS_AFTER_CANCEL')
        )
        AND (
          result.execution_id IS NOT NULL
          OR NOT EXISTS (
            SELECT 1 FROM m2_execution_steps step
            JOIN m2_approval_grants grant ON grant.effect_id = step.effect_id
            WHERE step.execution_id = operation.execution_id
              AND grant.consumed_at_ms IS NULL
              AND grant.revoked_at_ms IS NULL
          )
        )
      )
    BEGIN
      SELECT RAISE(ABORT, 'M2_LIFECYCLE_TERMINAL_AUTHORITY_MISSING');
    END;

    CREATE TABLE m2_lifecycle_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE CHECK (length(trim(event_id)) BETWEEN 1 AND 128),
      lifecycle_id TEXT NOT NULL REFERENCES m2_lifecycle_operations(lifecycle_id) ON DELETE RESTRICT,
      event_type TEXT NOT NULL CHECK (event_type IN (
        'operation_registered','approval_recorded','grant_set_recorded',
        'cancel_requested','governance_receipt_recorded','terminal_recorded',
        'recovery_observed'
      )),
      occurred_at_ms INTEGER NOT NULL CHECK (typeof(occurred_at_ms) = 'integer' AND occurred_at_ms >= 0),
      details_json TEXT NOT NULL CHECK (json_valid(details_json) AND length(CAST(details_json AS BLOB)) <= 65536)
    );

    CREATE TRIGGER trg_m2_lifecycle_events_not_after_terminal
    BEFORE INSERT ON m2_lifecycle_events
    WHEN m2_lifecycle_json_digest_v1(NEW.details_json) IS NULL
      OR (NEW.event_type = 'approval_recorded' AND NOT EXISTS (
        SELECT 1 FROM m2_lifecycle_approval_intents approval
        WHERE approval.lifecycle_id = NEW.lifecycle_id
      ))
      OR (NEW.event_type = 'grant_set_recorded' AND NOT EXISTS (
        SELECT 1 FROM m2_lifecycle_grant_sets grants
        WHERE grants.lifecycle_id = NEW.lifecycle_id
      ))
      OR (NEW.event_type = 'cancel_requested' AND NOT EXISTS (
        SELECT 1 FROM m2_lifecycle_cancel_intents cancel
        WHERE cancel.lifecycle_id = NEW.lifecycle_id
      ))
      OR (NEW.event_type = 'governance_receipt_recorded' AND NOT EXISTS (
        SELECT 1 FROM m2_lifecycle_governance_receipts receipt
        WHERE receipt.lifecycle_id = NEW.lifecycle_id
      ))
      OR (NEW.event_type = 'terminal_recorded' AND NOT EXISTS (
        SELECT 1 FROM m2_lifecycle_terminals terminal
        WHERE terminal.lifecycle_id = NEW.lifecycle_id
      ))
      OR (EXISTS (
      SELECT 1 FROM m2_lifecycle_terminals terminal
      WHERE terminal.lifecycle_id = NEW.lifecycle_id
    ) AND NEW.event_type <> 'terminal_recorded')
    BEGIN
      SELECT RAISE(ABORT, 'M2_LIFECYCLE_EVENT_AFTER_TERMINAL');
    END;

    CREATE INDEX idx_m2_lifecycle_operations_execution
      ON m2_lifecycle_operations(execution_id, lifecycle_id);
    CREATE INDEX idx_m2_lifecycle_operations_project
      ON m2_lifecycle_operations(project_id, created_at_ms, lifecycle_id);
    CREATE INDEX idx_m2_lifecycle_events_journal
      ON m2_lifecycle_events(lifecycle_id, seq);
  `);

  const tables = [
    'm2_lifecycle_operations',
    'm2_lifecycle_approval_intents',
    'm2_lifecycle_grant_sets',
    'm2_lifecycle_cancel_intents',
    'm2_lifecycle_governance_receipts',
    'm2_lifecycle_terminals',
    'm2_lifecycle_events',
  ];
  for (const table of tables) {
    db.exec(`
      CREATE TRIGGER trg_${table}_append_only_update
      BEFORE UPDATE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, '${table} is append-only');
      END;
      CREATE TRIGGER trg_${table}_append_only_delete
      BEFORE DELETE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, '${table} is append-only');
      END;
    `);
  }
}

export function up(db) {
  registerM2LifecycleSemanticFunctions(db);
  const current = computeM2LifecycleSchemaFingerprint(db);
  if (current === EXPECTED_M2_LIFECYCLE_SCHEMA_FINGERPRINT) return;
  const existing = db.prepare(`
    SELECT count(*) AS count FROM sqlite_master
    WHERE name GLOB 'm2_lifecycle_*'
      OR name GLOB 'trg_m2_lifecycle_*'
      OR name GLOB 'idx_m2_lifecycle_*'
  `).get().count;
  if (existing !== 0) {
    throw new Error('M2_LIFECYCLE_079_SOURCE_SCHEMA_FINGERPRINT_MISMATCH');
  }
  const prerequisite = db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'm2_execution_requests'
  `).get();
  if (!prerequisite) throw new Error('M2_LIFECYCLE_079_PREREQUISITE_MISSING');
  installLifecycleAuthority(db);
  const installed = computeM2LifecycleSchemaFingerprint(db);
  if (installed !== EXPECTED_M2_LIFECYCLE_SCHEMA_FINGERPRINT) {
    throw new Error('M2_LIFECYCLE_079_FINAL_SCHEMA_FINGERPRINT_MISMATCH');
  }
}

export default { version, description, up };
