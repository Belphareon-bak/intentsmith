import {
  canonicalizeM2ExecutionValue,
  computeM2ExecutionValueDigest,
  computeM2ProjectChangeRequestDigest,
  validateM2ProjectChangeRequest,
  validateM2ProjectChangeResultForRequest,
} from '../../contracts/m2/execution-v1.js';
import { timestampToMs } from '../../contracts/m2/effect-v1.js';
import {
  canonicalizeM2GovernanceValue,
  computeM2GovernanceBaselineDigest,
  computeM2GovernanceDecisionDigest,
  computeM2GovernancePolicySnapshotDigest,
  computeM2GovernanceReceiptDigest,
  validateM2GovernanceBaselineSnapshot,
  validateM2GovernanceDecision,
  validateM2GovernancePolicySnapshot,
  validateM2GovernanceReceipt,
  validateM2GovernanceReceiptForDecision,
} from '../../contracts/m2/governance-v1.js';
import {
  M2_LIFECYCLE_STATE,
  canonicalizeM2LifecycleValue,
  computeM2LifecycleApprovalIntentDigest,
  computeM2LifecyclePlanSnapshotDigest,
  computeM2LifecycleTerminalSnapshotDigest,
  computeM2LifecycleValueDigest,
  validateM2LifecycleApprovalIntent,
  validateM2LifecycleApprovalIntentForPlan,
  validateM2LifecyclePlanSnapshot,
  validateM2LifecyclePlanSnapshotForContext,
  validateM2LifecyclePlanSnapshotForDecision,
  validateM2LifecycleTerminalSnapshot,
  validateM2LifecycleTerminalSnapshotForExecution,
} from '../../contracts/m2/lifecycle-v1.js';
import { validateProjectContextSnapshot } from '../../contracts/m2/project-context-v1.js';
import {
  isIdentifier,
  isPlainRecord,
  validateExactKeys,
} from '../../contracts/m1/shared.js';
import { registerM2LifecycleSemanticFunctions } from '../db/migrations/2026_08_24_079_m2_lifecycle_authority.js';

const GRANT_SET_MAX = 68;
const EVENT_TYPES = new Set([
  'operation_registered',
  'approval_recorded',
  'grant_set_recorded',
  'cancel_requested',
  'governance_receipt_recorded',
  'terminal_recorded',
  'recovery_observed',
]);
const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export const M2LifecycleAuthorityErrorCode = Object.freeze({
  INPUT_INVALID: 'M2_LIFECYCLE_AUTHORITY_INPUT_INVALID',
  OPERATION_NOT_FOUND: 'M2_LIFECYCLE_OPERATION_NOT_FOUND',
  OPERATION_CONFLICT: 'M2_LIFECYCLE_OPERATION_CONFLICT',
  APPROVAL_CONFLICT: 'M2_LIFECYCLE_APPROVAL_CONFLICT',
  GRANT_SET_INCOMPLETE: 'M2_LIFECYCLE_GRANT_SET_INCOMPLETE',
  GRANT_SET_CONFLICT: 'M2_LIFECYCLE_GRANT_SET_CONFLICT',
  CANCEL_CONFLICT: 'M2_LIFECYCLE_CANCEL_CONFLICT',
  RECEIPT_CONFLICT: 'M2_LIFECYCLE_RECEIPT_CONFLICT',
  TERMINAL_AUTHORITY_MISSING: 'M2_LIFECYCLE_TERMINAL_AUTHORITY_MISSING',
  TERMINAL_CONFLICT: 'M2_LIFECYCLE_TERMINAL_CONFLICT',
  EVENT_CONFLICT: 'M2_LIFECYCLE_EVENT_CONFLICT',
  STORAGE_FAILURE: 'M2_LIFECYCLE_AUTHORITY_STORAGE_FAILURE',
});

export class M2LifecycleAuthorityError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'M2LifecycleAuthorityError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = null) {
  throw new M2LifecycleAuthorityError(code, message, details);
}

function requireDatabase(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'A better-sqlite3 database is required');
  }
  return db;
}

function requireClock(clock) {
  if (typeof clock !== 'function') {
    fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'A trusted lifecycle clock is required');
  }
  return clock;
}

function immediate(db, callback) {
  const transaction = db.transaction(callback);
  return transaction.immediate ? transaction.immediate() : transaction();
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function requireValid(value, validator, label) {
  const validation = validator(value);
  if (!validation.valid) {
    fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, `${label} is invalid`, {
      errors: [...validation.errors],
    });
  }
  return value;
}

function requireTimestamp(value, label) {
  try {
    return timestampToMs(value);
  } catch {
    fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, `${label} must be a canonical timestamp`);
  }
}

function storageFailure(operation, error) {
  fail(
    M2LifecycleAuthorityErrorCode.STORAGE_FAILURE,
    `M2 lifecycle authority storage failed during ${operation}`,
    { cause: error?.message || String(error), sqliteCode: error?.code || null },
  );
}

function parseStored(encoded, validator, label) {
  try {
    const value = JSON.parse(encoded);
    const validation = validator(value);
    if (!validation.valid || canonicalizeM2LifecycleValue(value) !== encoded) {
      throw new Error(`${label} invalid: ${validation.errors.join(',')}`);
    }
    return Object.freeze(value);
  } catch (error) {
    storageFailure(`${label} read`, error);
  }
}

function validateFocusedEnvironment(value) {
  return isPlainRecord(value) && Object.entries(value).every(([key, entry]) => (
    ENVIRONMENT_KEY_PATTERN.test(key)
    && typeof entry === 'string'
    && entry === entry.normalize('NFC')
    && !entry.includes('\0')
    && Buffer.from(entry, 'utf8').toString('utf8') === entry
    && Buffer.byteLength(entry, 'utf8') <= 32_768
  ));
}

function requireFocusedEnvironment(value, request) {
  if (!validateFocusedEnvironment(value)
    || computeM2ExecutionValueDigest(value) !== request.focusedTest.environmentDigest) {
    fail(
      M2LifecycleAuthorityErrorCode.INPUT_INVALID,
      'Focused environment is invalid or differs from ProjectChangeRequest',
    );
  }
  return value;
}

function operationProjection({
  plan,
  request,
  contextSnapshot,
  focusedEnvironment,
  policySnapshot,
  baselineSnapshot,
  decision,
}) {
  return {
    plan,
    requestDigest: computeM2ProjectChangeRequestDigest(request),
    contextSnapshot,
    focusedEnvironment,
    policySnapshot,
    baselineSnapshot,
    decision,
  };
}

function requireLifecycleId(value) {
  if (!isIdentifier(value)) {
    fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'A lifecycleId is required');
  }
  return value;
}

function validateCancelIntent(value, plan) {
  const errors = validateExactKeys(
    value,
    ['cancelId', 'identity', 'actor', 'reason', 'requestedAt'],
    [],
    'lifecycle-cancel-intent',
  );
  errors.push(...validateExactKeys(
    value?.identity,
    ['lifecycleId', 'milestoneId', 'runId', 'executionId'],
    [],
    'lifecycle-cancel-intent.identity',
  ));
  errors.push(...validateExactKeys(
    value?.actor,
    ['type', 'id'],
    [],
    'lifecycle-cancel-intent.actor',
  ));
  if (!isIdentifier(value?.cancelId)
    || !['lifecycleId', 'milestoneId', 'runId', 'executionId'].every(
      key => isIdentifier(value?.identity?.[key]),
    )
    || value?.actor?.type !== 'user'
    || !isIdentifier(value?.actor?.id)
    || typeof value?.reason !== 'string'
    || value.reason.trim().length < 1
    || Buffer.byteLength(value.reason, 'utf8') > 1_024) {
    errors.push('lifecycle-cancel-intent:invalid-fields');
  }
  try {
    requireTimestamp(value?.requestedAt, 'LifecycleCancelIntent.requestedAt');
  } catch (error) {
    if (error instanceof M2LifecycleAuthorityError) errors.push('lifecycle-cancel-intent:invalid-requestedAt');
    else throw error;
  }
  if (plan && (
    computeM2LifecycleValueDigest(value?.identity) !== computeM2LifecycleValueDigest(plan.identity)
    || value?.actor?.type !== plan.actor.type
    || value?.actor?.id !== plan.actor.id
  )) errors.push('lifecycle-cancel-intent:plan-identity-mismatch');
  return errors;
}

function canonicalGrantSet(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > GRANT_SET_MAX) {
    fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'A bounded complete grant set is required');
  }
  const grants = values.map((value, index) => {
    const errors = validateExactKeys(value, ['effectId', 'grantId'], [], `grant-set[${index}]`);
    if (errors.length > 0 || !isIdentifier(value?.effectId) || !isIdentifier(value?.grantId)) {
      fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'Grant set entries must be exact identities', {
        index,
        errors,
      });
    }
    return { effectId: value.effectId, grantId: value.grantId };
  }).sort((left, right) => compareUtf8(left.effectId, right.effectId));
  if (new Set(grants.map(entry => entry.effectId)).size !== grants.length
    || new Set(grants.map(entry => entry.grantId)).size !== grants.length) {
    fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'Grant set identities must be unique');
  }
  return Object.freeze(grants.map(entry => Object.freeze(entry)));
}

export class M2LifecycleAuthorityRepository {
  constructor(db, { clock = Date.now } = {}) {
    this.db = requireDatabase(db);
    this.clock = requireClock(clock);
    registerM2LifecycleSemanticFunctions(this.db);
  }

  #now() {
    const value = this.clock();
    if (!Number.isSafeInteger(value) || value < 0) {
      fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'Lifecycle clock returned an invalid time');
    }
    return value;
  }

  #request(executionId) {
    const row = this.db.prepare(`
      SELECT request_json AS requestJson FROM m2_execution_requests WHERE execution_id = ?
    `).get(executionId);
    if (!row) return null;
    try {
      const request = JSON.parse(row.requestJson);
      const validation = validateM2ProjectChangeRequest(request);
      if (!validation.valid || canonicalizeM2ExecutionValue(request) !== row.requestJson) {
        throw new Error(`ProjectChangeRequest invalid: ${validation.errors.join(',')}`);
      }
      return Object.freeze(request);
    } catch (error) {
      storageFailure('ProjectChangeRequest read', error);
    }
  }

  registerOperation({
    plan: planValue,
    request: requestValue,
    contextSnapshot: contextValue,
    focusedEnvironment: environmentValue,
    policySnapshot: policyValue,
    baselineSnapshot: baselineValue,
    decision: decisionValue,
  }) {
    const plan = requireValid(planValue, validateM2LifecyclePlanSnapshot, 'LifecyclePlanSnapshot');
    const request = requireValid(requestValue, validateM2ProjectChangeRequest, 'ProjectChangeRequest');
    const contextSnapshot = requireValid(
      contextValue,
      validateProjectContextSnapshot,
      'ProjectContextSnapshot',
    );
    const policySnapshot = requireValid(
      policyValue,
      validateM2GovernancePolicySnapshot,
      'GovernancePolicySnapshot',
    );
    const baselineSnapshot = requireValid(
      baselineValue,
      validateM2GovernanceBaselineSnapshot,
      'GovernanceBaselineSnapshot',
    );
    const decision = requireValid(
      decisionValue,
      validateM2GovernanceDecision,
      'GovernanceDecision',
    );
    const focusedEnvironment = requireFocusedEnvironment(environmentValue, request);
    const semantic = [
      validateM2LifecyclePlanSnapshotForContext(contextSnapshot, plan),
      validateM2LifecyclePlanSnapshotForDecision(request, decision, plan),
    ];
    if (semantic.some(validation => !validation.valid)
      || baselineSnapshot.complete !== true
      || policySnapshot.projectId !== request.project.projectId
      || policySnapshot.workspaceRevision !== request.project.workspaceRevision
      || baselineSnapshot.projectId !== request.project.projectId
      || baselineSnapshot.workspaceRevision !== request.project.workspaceRevision
      || computeM2GovernancePolicySnapshotDigest(policySnapshot) !== plan.governancePolicyDigest
      || computeM2GovernanceBaselineDigest(baselineSnapshot) !== plan.governanceBaselineDigest
      || computeM2GovernanceDecisionDigest(decision) !== plan.governanceDecisionDigest) {
      fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'Lifecycle operation material is not exact', {
        errors: semantic.flatMap(validation => [...validation.errors]),
      });
    }

    const planJson = canonicalizeM2LifecycleValue(plan);
    const contextJson = canonicalizeM2LifecycleValue(contextSnapshot);
    const focusedEnvironmentJson = canonicalizeM2LifecycleValue(focusedEnvironment);
    const policyJson = canonicalizeM2GovernanceValue(policySnapshot);
    const baselineJson = canonicalizeM2GovernanceValue(baselineSnapshot);
    const decisionJson = canonicalizeM2GovernanceValue(decision);
    const operationDigest = computeM2LifecycleValueDigest(operationProjection({
      plan,
      request,
      contextSnapshot,
      focusedEnvironment,
      policySnapshot,
      baselineSnapshot,
      decision,
    }));
    const planDigest = computeM2LifecyclePlanSnapshotDigest(plan);
    const requestDigest = computeM2ProjectChangeRequestDigest(request);
    const focusedEnvironmentDigest = computeM2ExecutionValueDigest(focusedEnvironment);
    const values = [
      plan.identity.lifecycleId,
      plan.identity.milestoneId,
      plan.identity.runId,
      plan.identity.executionId,
      plan.project.projectId,
      plan.planVersion,
      planDigest,
      requestDigest,
      request.authoritySetDigest,
      plan.contextSnapshotDigest,
      focusedEnvironmentDigest,
      plan.governancePolicyDigest,
      plan.governanceBaselineDigest,
      plan.governanceDecisionDigest,
      plan.expectedAfterRevision,
      operationDigest,
      planJson,
      contextJson,
      focusedEnvironmentJson,
      policyJson,
      baselineJson,
      decisionJson,
      requireTimestamp(plan.createdAt, 'LifecyclePlanSnapshot.createdAt'),
      requireTimestamp(plan.approvalExpiresAt, 'LifecyclePlanSnapshot.approvalExpiresAt'),
    ];

    try {
      return immediate(this.db, () => {
        const storedRequest = this.#request(request.executionId);
        if (!storedRequest || canonicalizeM2ExecutionValue(storedRequest) !== canonicalizeM2ExecutionValue(request)) {
          fail(
            M2LifecycleAuthorityErrorCode.OPERATION_NOT_FOUND,
            'Exact ProjectChangeRequest must be registered first',
            { executionId: request.executionId },
          );
        }
        const existing = this.db.prepare(`
          SELECT lifecycle_id AS lifecycleId, operation_digest AS operationDigest
          FROM m2_lifecycle_operations
          WHERE lifecycle_id = ? OR execution_id = ? OR run_id = ?
          ORDER BY CASE WHEN lifecycle_id = ? THEN 0 ELSE 1 END LIMIT 1
        `).get(
          plan.identity.lifecycleId,
          plan.identity.executionId,
          plan.identity.runId,
          plan.identity.lifecycleId,
        );
        if (existing) {
          if (existing.lifecycleId === plan.identity.lifecycleId
            && existing.operationDigest === operationDigest) {
            return Object.freeze({ created: false, operation: this.getOperation(plan.identity.lifecycleId) });
          }
          fail(M2LifecycleAuthorityErrorCode.OPERATION_CONFLICT, 'Lifecycle identity has different bytes');
        }
        this.db.prepare(`
          INSERT INTO m2_lifecycle_operations (
            lifecycle_id, milestone_id, run_id, execution_id, project_id,
            plan_version, plan_digest, request_digest, authority_set_digest,
            context_snapshot_digest, focused_environment_digest, policy_digest,
            baseline_digest, decision_digest, expected_after_revision,
            operation_digest, plan_json, context_snapshot_json,
            focused_environment_json, policy_json, baseline_json, decision_json,
            created_at_ms, approval_expires_at_ms
          ) VALUES (${new Array(24).fill('?').join(', ')})
        `).run(...values);
        return Object.freeze({ created: true, operation: this.getOperation(plan.identity.lifecycleId) });
      });
    } catch (error) {
      if (error instanceof M2LifecycleAuthorityError) throw error;
      if (String(error?.message).includes('M2_LIFECYCLE_OPERATION_AUTHORITY_MISMATCH')) {
        fail(M2LifecycleAuthorityErrorCode.OPERATION_CONFLICT, 'SQL rejected lifecycle operation authority');
      }
      storageFailure('operation registration', error);
    }
  }

  getOperation(lifecycleIdValue) {
    const lifecycleId = requireLifecycleId(lifecycleIdValue);
    const row = this.db.prepare(`
      SELECT lifecycle_id AS lifecycleId, milestone_id AS milestoneId,
             run_id AS runId, execution_id AS executionId, project_id AS projectId,
             plan_version AS planVersion, plan_digest AS planDigest,
             request_digest AS requestDigest, authority_set_digest AS authoritySetDigest,
             context_snapshot_digest AS contextSnapshotDigest,
             focused_environment_digest AS focusedEnvironmentDigest,
             policy_digest AS policyDigest, baseline_digest AS baselineDigest,
             decision_digest AS decisionDigest,
             expected_after_revision AS expectedAfterRevision,
             operation_digest AS operationDigest, created_at_ms AS createdAtMs,
             approval_expires_at_ms AS approvalExpiresAtMs
      FROM m2_lifecycle_operations WHERE lifecycle_id = ?
    `).get(lifecycleId);
    return row ? Object.freeze(row) : null;
  }

  listOwnedOperations({ actorId, limit }) {
    if (!isIdentifier(actorId)
      || !Number.isSafeInteger(limit)
      || limit < 1
      || limit > 2_001) {
      fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'Owned lifecycle query is invalid');
    }
    try {
      const rows = this.db.prepare(`
        SELECT lifecycle_id AS lifecycleId, created_at_ms AS createdAtMs
        FROM m2_lifecycle_operations
        WHERE json_extract(plan_json, '$.actor.id') = ?
        ORDER BY created_at_ms DESC, lifecycle_id DESC
        LIMIT ?
      `).all(actorId, limit);
      return Object.freeze(rows.map(row => {
        const plan = this.getPlan(row.lifecycleId);
        if (!plan || plan.actor?.type !== 'user' || plan.actor.id !== actorId
          || Date.parse(plan.createdAt) !== row.createdAtMs) {
          throw new Error('owned lifecycle index does not match canonical plan');
        }
        return Object.freeze(row);
      }));
    } catch (error) {
      if (error instanceof M2LifecycleAuthorityError) throw error;
      storageFailure('owned lifecycle list', error);
    }
  }

  #operationMaterial(lifecycleId) {
    const row = this.db.prepare(`
      SELECT operation.*, request.request_json AS request_json
      FROM m2_lifecycle_operations operation
      JOIN m2_execution_requests request ON request.execution_id = operation.execution_id
      WHERE operation.lifecycle_id = ?
    `).get(lifecycleId);
    if (!row) return null;
    return row;
  }

  getPlan(lifecycleIdValue) {
    const lifecycleId = requireLifecycleId(lifecycleIdValue);
    const row = this.#operationMaterial(lifecycleId);
    if (!row) return null;
    const plan = parseStored(row.plan_json, validateM2LifecyclePlanSnapshot, 'LifecyclePlanSnapshot');
    const request = this.#request(row.execution_id);
    const context = parseStored(
      row.context_snapshot_json,
      validateProjectContextSnapshot,
      'ProjectContextSnapshot',
    );
    const decision = parseStored(
      row.decision_json,
      validateM2GovernanceDecision,
      'GovernanceDecision',
    );
    if (!validateM2LifecyclePlanSnapshotForContext(context, plan).valid
      || !validateM2LifecyclePlanSnapshotForDecision(request, decision, plan).valid
      || computeM2LifecyclePlanSnapshotDigest(plan) !== row.plan_digest) {
      storageFailure('LifecyclePlanSnapshot semantic read', new Error('stored plan binding mismatch'));
    }
    return plan;
  }

  getRequest(lifecycleIdValue) {
    const lifecycleId = requireLifecycleId(lifecycleIdValue);
    const operation = this.getOperation(lifecycleId);
    return operation ? this.#request(operation.executionId) : null;
  }

  getContextSnapshot(lifecycleIdValue) {
    const lifecycleId = requireLifecycleId(lifecycleIdValue);
    const row = this.#operationMaterial(lifecycleId);
    return row ? parseStored(
      row.context_snapshot_json,
      validateProjectContextSnapshot,
      'ProjectContextSnapshot',
    ) : null;
  }

  getFocusedEnvironment(lifecycleIdValue) {
    const lifecycleId = requireLifecycleId(lifecycleIdValue);
    const row = this.#operationMaterial(lifecycleId);
    if (!row) return null;
    try {
      const environment = JSON.parse(row.focused_environment_json);
      if (!validateFocusedEnvironment(environment)
        || canonicalizeM2LifecycleValue(environment) !== row.focused_environment_json
        || computeM2ExecutionValueDigest(environment) !== row.focused_environment_digest) {
        throw new Error('stored focused environment mismatch');
      }
      return Object.freeze(environment);
    } catch (error) {
      storageFailure('focused environment read', error);
    }
  }

  getPolicy(lifecycleIdValue) {
    const lifecycleId = requireLifecycleId(lifecycleIdValue);
    const row = this.#operationMaterial(lifecycleId);
    return row ? parseStored(
      row.policy_json,
      validateM2GovernancePolicySnapshot,
      'GovernancePolicySnapshot',
    ) : null;
  }

  getBaseline(lifecycleIdValue) {
    const lifecycleId = requireLifecycleId(lifecycleIdValue);
    const row = this.#operationMaterial(lifecycleId);
    return row ? parseStored(
      row.baseline_json,
      validateM2GovernanceBaselineSnapshot,
      'GovernanceBaselineSnapshot',
    ) : null;
  }

  getDecision(lifecycleIdValue) {
    const lifecycleId = requireLifecycleId(lifecycleIdValue);
    const row = this.#operationMaterial(lifecycleId);
    return row ? parseStored(
      row.decision_json,
      validateM2GovernanceDecision,
      'GovernanceDecision',
    ) : null;
  }

  recordApprovalIntent(input) {
    const intentValue = input?.approval ?? input;
    if (input?.approval && input.lifecycleId !== intentValue?.identity?.lifecycleId) {
      fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'Approval lifecycle identity mismatch');
    }
    const intent = requireValid(
      intentValue,
      validateM2LifecycleApprovalIntent,
      'LifecycleApprovalIntent',
    );
    const plan = this.getPlan(intent.identity.lifecycleId);
    if (!plan) fail(M2LifecycleAuthorityErrorCode.OPERATION_NOT_FOUND, 'Lifecycle operation does not exist');
    const semantic = validateM2LifecycleApprovalIntentForPlan(plan, intent);
    if (!semantic.valid) {
      fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'Approval does not match current plan', {
        errors: [...semantic.errors],
      });
    }
    const approvedAtMs = requireTimestamp(intent.approvedAt, 'LifecycleApprovalIntent.approvedAt');
    const expiresAtMs = requireTimestamp(intent.expiresAt, 'LifecycleApprovalIntent.expiresAt');
    const encoded = canonicalizeM2LifecycleValue(intent);
    const digest = computeM2LifecycleApprovalIntentDigest(intent);
    const existing = this.db.prepare(`
      SELECT intent_json AS intentJson FROM m2_lifecycle_approval_intents
      WHERE lifecycle_id = ? OR approval_id = ? OR intent_digest = ? LIMIT 1
    `).get(intent.identity.lifecycleId, intent.approvalId, digest);
    if (existing?.intentJson === encoded) {
      return Object.freeze({ created: false, intent: Object.freeze(intent) });
    }
    if (existing) fail(M2LifecycleAuthorityErrorCode.APPROVAL_CONFLICT, 'Approval identity has different bytes');
    const now = this.#now();
    if (now < approvedAtMs || now >= expiresAtMs) {
      fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'Approval intent is not currently valid');
    }
    try {
      this.db.prepare(`
        INSERT INTO m2_lifecycle_approval_intents (
          lifecycle_id, approval_id, plan_digest, request_digest,
          authority_set_digest, actor_id, intent_digest, intent_json,
          approved_at_ms, expires_at_ms, recorded_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        intent.identity.lifecycleId,
        intent.approvalId,
        intent.planDigest,
        intent.requestDigest,
        intent.authoritySetDigest,
        intent.actor.id,
        digest,
        encoded,
        approvedAtMs,
        expiresAtMs,
        now,
      );
      return Object.freeze({ created: true, intent: Object.freeze(intent) });
    } catch (error) {
      const raced = this.db.prepare(`
        SELECT intent_json AS intentJson FROM m2_lifecycle_approval_intents
        WHERE lifecycle_id = ? OR approval_id = ? OR intent_digest = ? LIMIT 1
      `).get(intent.identity.lifecycleId, intent.approvalId, digest);
      if (raced?.intentJson === encoded) {
        return Object.freeze({ created: false, intent: Object.freeze(intent) });
      }
      if (raced) fail(M2LifecycleAuthorityErrorCode.APPROVAL_CONFLICT, 'Approval identity has different bytes');
      storageFailure('approval intent recording', error);
    }
  }

  getApprovalIntent(lifecycleIdValue) {
    const lifecycleId = requireLifecycleId(lifecycleIdValue);
    const row = this.db.prepare(`
      SELECT intent_json AS intentJson FROM m2_lifecycle_approval_intents WHERE lifecycle_id = ?
    `).get(lifecycleId);
    return row ? parseStored(
      row.intentJson,
      validateM2LifecycleApprovalIntent,
      'LifecycleApprovalIntent',
    ) : null;
  }

  recordGrantSet({ lifecycleId: lifecycleIdValue, approvalIntentDigest = null, grants: grantValues }) {
    const lifecycleId = requireLifecycleId(lifecycleIdValue);
    const operation = this.getOperation(lifecycleId);
    if (!operation) fail(M2LifecycleAuthorityErrorCode.OPERATION_NOT_FOUND, 'Lifecycle operation does not exist');
    const approval = this.getApprovalIntent(lifecycleId);
    if (!approval) fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'Approval intent must be recorded first');
    const durableApprovalDigest = computeM2LifecycleApprovalIntentDigest(approval);
    if (approvalIntentDigest !== null && approvalIntentDigest !== durableApprovalDigest) {
      fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'Grant set approval authority mismatch');
    }
    const grants = canonicalGrantSet(grantValues);
    const encoded = canonicalizeM2LifecycleValue(grants);
    const digest = computeM2LifecycleValueDigest(grants);
    const now = this.#now();
    try {
      this.db.prepare(`
        INSERT INTO m2_lifecycle_grant_sets (
          lifecycle_id, approval_intent_digest, authority_set_digest,
          grant_set_digest, grant_set_json, recorded_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        lifecycleId,
        durableApprovalDigest,
        operation.authoritySetDigest,
        digest,
        encoded,
        now,
      );
      return Object.freeze({ created: true, grants });
    } catch (error) {
      const existing = this.db.prepare(`
        SELECT grant_set_json AS grantSetJson FROM m2_lifecycle_grant_sets
        WHERE lifecycle_id = ? OR grant_set_digest = ? LIMIT 1
      `).get(lifecycleId, digest);
      if (existing?.grantSetJson === encoded) return Object.freeze({ created: false, grants });
      if (existing) fail(M2LifecycleAuthorityErrorCode.GRANT_SET_CONFLICT, 'Grant set identity has different bytes');
      if (String(error?.message).includes('M2_LIFECYCLE_GRANT_SET_INCOMPLETE')) {
        fail(M2LifecycleAuthorityErrorCode.GRANT_SET_INCOMPLETE, 'Grant set is not exact and complete');
      }
      storageFailure('grant set recording', error);
    }
  }

  getGrantSet(lifecycleIdValue) {
    const lifecycleId = requireLifecycleId(lifecycleIdValue);
    const row = this.db.prepare(`
      SELECT grant_set_json AS grantSetJson, grant_set_digest AS grantSetDigest
      FROM m2_lifecycle_grant_sets WHERE lifecycle_id = ?
    `).get(lifecycleId);
    if (!row) return null;
    try {
      const grants = JSON.parse(row.grantSetJson);
      const canonical = canonicalGrantSet(grants);
      if (canonicalizeM2LifecycleValue(canonical) !== row.grantSetJson
        || computeM2LifecycleValueDigest(canonical) !== row.grantSetDigest) {
        throw new Error('stored grant set mismatch');
      }
      return Object.freeze({
        grants: canonical,
        grantSetDigest: row.grantSetDigest,
      });
    } catch (error) {
      if (error instanceof M2LifecycleAuthorityError) throw error;
      storageFailure('grant set read', error);
    }
  }

  recordCancelIntent(input) {
    const serviceInput = input && !input.identity && isIdentifier(input.lifecycleId);
    const lifecycleId = serviceInput ? input.lifecycleId : input?.identity?.lifecycleId;
    requireLifecycleId(lifecycleId);
    const plan = this.getPlan(lifecycleId);
    if (!plan) fail(M2LifecycleAuthorityErrorCode.OPERATION_NOT_FOUND, 'Lifecycle operation does not exist');
    const intentValue = serviceInput ? Object.freeze({
      cancelId: `cancel:${computeM2LifecycleValueDigest({
        lifecycleId,
        actorId: input.actorId,
        reason: input.reason,
        requestedAt: input.requestedAt,
      }).slice(7)}`,
      identity: plan.identity,
      actor: { type: 'user', id: input.actorId },
      reason: input.reason,
      requestedAt: input.requestedAt,
    }) : input;
    const errors = validateCancelIntent(intentValue, plan);
    if (errors.length > 0) {
      fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'Lifecycle cancel intent is invalid', { errors });
    }
    const requestedAtMs = requireTimestamp(intentValue.requestedAt, 'LifecycleCancelIntent.requestedAt');
    if (requestedAtMs > this.#now()) {
      fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'Cancel intent cannot be from the future');
    }
    const encoded = canonicalizeM2LifecycleValue(intentValue);
    const digest = computeM2LifecycleValueDigest(intentValue);
    try {
      this.db.prepare(`
        INSERT INTO m2_lifecycle_cancel_intents (
          lifecycle_id, cancel_id, actor_id, intent_digest, intent_json, requested_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        lifecycleId,
        intentValue.cancelId,
        intentValue.actor.id,
        digest,
        encoded,
        requestedAtMs,
      );
      return Object.freeze({ created: true, intent: Object.freeze(intentValue) });
    } catch (error) {
      const existing = this.db.prepare(`
        SELECT intent_json AS intentJson FROM m2_lifecycle_cancel_intents
        WHERE lifecycle_id = ? OR cancel_id = ? OR intent_digest = ? LIMIT 1
      `).get(lifecycleId, intentValue.cancelId, digest);
      if (existing?.intentJson === encoded) {
        return Object.freeze({ created: false, intent: Object.freeze(intentValue) });
      }
      if (existing) fail(M2LifecycleAuthorityErrorCode.CANCEL_CONFLICT, 'Cancel identity has different bytes');
      storageFailure('cancel intent recording', error);
    }
  }

  getCancelIntent(lifecycleIdValue) {
    const lifecycleId = requireLifecycleId(lifecycleIdValue);
    const row = this.db.prepare(`
      SELECT intent_json AS intentJson FROM m2_lifecycle_cancel_intents WHERE lifecycle_id = ?
    `).get(lifecycleId);
    if (!row) return null;
    try {
      const intent = JSON.parse(row.intentJson);
      const plan = this.getPlan(lifecycleId);
      const errors = validateCancelIntent(intent, plan);
      if (errors.length > 0 || canonicalizeM2LifecycleValue(intent) !== row.intentJson) {
        throw new Error(`stored cancel intent invalid: ${errors.join(',')}`);
      }
      return Object.freeze(intent);
    } catch (error) {
      if (error instanceof M2LifecycleAuthorityError) throw error;
      storageFailure('cancel intent read', error);
    }
  }

  recordReceipt(input) {
    const receiptValue = input?.receipt ?? input;
    if (input?.receipt && input.lifecycleId !== receiptValue?.lifecycleId) {
      fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'Receipt lifecycle identity mismatch');
    }
    const receipt = requireValid(receiptValue, validateM2GovernanceReceipt, 'GovernanceReceipt');
    const operation = this.getOperation(receipt.lifecycleId);
    if (!operation) fail(M2LifecycleAuthorityErrorCode.OPERATION_NOT_FOUND, 'Lifecycle operation does not exist');
    if (this.getCancelIntent(receipt.lifecycleId)) {
      fail(M2LifecycleAuthorityErrorCode.RECEIPT_CONFLICT, 'Cancelled lifecycle cannot accept a success receipt');
    }
    const request = this.#request(operation.executionId);
    const resultRow = this.db.prepare(`
      SELECT result_json AS resultJson FROM m2_execution_results WHERE execution_id = ?
    `).get(operation.executionId);
    const decision = this.getDecision(receipt.lifecycleId);
    if (!resultRow || !decision) {
      fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'Succeeded execution and decision are required');
    }
    let result;
    try { result = JSON.parse(resultRow.resultJson); } catch (error) { storageFailure('ProjectChangeResult read', error); }
    const semantic = validateM2GovernanceReceiptForDecision(request, result, decision, receipt);
    if (!semantic.valid) {
      fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'Receipt does not prove exact governance', {
        errors: [...semantic.errors],
      });
    }
    const encoded = canonicalizeM2GovernanceValue(receipt);
    const digest = computeM2GovernanceReceiptDigest(receipt);
    try {
      this.db.prepare(`
        INSERT INTO m2_lifecycle_governance_receipts (
          lifecycle_id, receipt_id, decision_digest, result_digest,
          receipt_digest, receipt_json, recorded_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        receipt.lifecycleId,
        receipt.receiptId,
        receipt.decisionDigest,
        receipt.resultDigest,
        digest,
        encoded,
        requireTimestamp(receipt.recordedAt, 'GovernanceReceipt.recordedAt'),
      );
      return Object.freeze({ created: true, receipt: Object.freeze(receipt) });
    } catch (error) {
      const existing = this.db.prepare(`
        SELECT receipt_json AS receiptJson FROM m2_lifecycle_governance_receipts
        WHERE lifecycle_id = ? OR receipt_id = ? OR receipt_digest = ? LIMIT 1
      `).get(receipt.lifecycleId, receipt.receiptId, digest);
      if (existing?.receiptJson === encoded) {
        return Object.freeze({ created: false, receipt: Object.freeze(receipt) });
      }
      if (existing) fail(M2LifecycleAuthorityErrorCode.RECEIPT_CONFLICT, 'Receipt identity has different bytes');
      storageFailure('governance receipt recording', error);
    }
  }

  getReceipt(lifecycleIdValue) {
    const lifecycleId = requireLifecycleId(lifecycleIdValue);
    const row = this.db.prepare(`
      SELECT receipt_json AS receiptJson FROM m2_lifecycle_governance_receipts WHERE lifecycle_id = ?
    `).get(lifecycleId);
    return row ? parseStored(
      row.receiptJson,
      validateM2GovernanceReceipt,
      'GovernanceReceipt',
    ) : null;
  }

  recordTerminal(input) {
    const terminalValue = input?.terminal ?? input;
    if (input?.terminal && input.lifecycleId !== terminalValue?.identity?.lifecycleId) {
      fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'Terminal lifecycle identity mismatch');
    }
    const terminal = requireValid(
      terminalValue,
      validateM2LifecycleTerminalSnapshot,
      'LifecycleTerminalSnapshot',
    );
    const lifecycleId = terminal.identity.lifecycleId;
    const operation = this.getOperation(lifecycleId);
    if (!operation) fail(M2LifecycleAuthorityErrorCode.OPERATION_NOT_FOUND, 'Lifecycle operation does not exist');
    const plan = this.getPlan(lifecycleId);
    const contextSnapshot = this.getContextSnapshot(lifecycleId);
    const approval = this.getApprovalIntent(lifecycleId);
    const request = this.#request(operation.executionId);
    const decision = this.getDecision(lifecycleId);
    const receipt = this.getReceipt(lifecycleId);
    const resultRow = this.db.prepare(`
      SELECT result_json AS resultJson FROM m2_execution_results WHERE execution_id = ?
    `).get(operation.executionId);
    let result = null;
    if (resultRow) {
      try { result = JSON.parse(resultRow.resultJson); } catch (error) { storageFailure('ProjectChangeResult read', error); }
    }
    const encoded = canonicalizeM2LifecycleValue(terminal);
    const completedAtMs = requireTimestamp(terminal.completedAt, 'LifecycleTerminalSnapshot.completedAt');
    const terminalDigest = computeM2LifecycleTerminalSnapshotDigest(terminal);
    if (terminal.state === M2_LIFECYCLE_STATE.SUCCEEDED) {
      const semantic = validateM2LifecycleTerminalSnapshotForExecution({
        contextSnapshot,
        plan,
        approval,
        request,
        result,
        governanceDecision: decision,
        governanceReceipt: receipt,
        terminal,
      });
      if (!semantic.valid) {
        fail(M2LifecycleAuthorityErrorCode.TERMINAL_AUTHORITY_MISSING, 'Succeeded terminal lacks exact authority', {
          errors: [...semantic.errors],
        });
      }
    } else {
      const row = this.db.prepare(`
        SELECT m2_lifecycle_terminal_valid_v1(
          operation.plan_json, approval.intent_json, request.request_json,
          operation.context_snapshot_json, result.result_json,
          operation.decision_json, receipt.receipt_json, ?, ?
        ) AS valid
        FROM m2_lifecycle_operations operation
        JOIN m2_execution_requests request ON request.execution_id = operation.execution_id
        LEFT JOIN m2_lifecycle_approval_intents approval USING (lifecycle_id)
        LEFT JOIN m2_execution_results result ON result.execution_id = operation.execution_id
        LEFT JOIN m2_lifecycle_governance_receipts receipt USING (lifecycle_id)
        WHERE operation.lifecycle_id = ?
      `).get(encoded, completedAtMs, lifecycleId);
      if (row?.valid !== 1) {
        fail(M2LifecycleAuthorityErrorCode.TERMINAL_AUTHORITY_MISSING, 'Terminal lacks exact durable authority');
      }
    }
    try {
      this.db.prepare(`
        INSERT INTO m2_lifecycle_terminals (
          lifecycle_id, execution_id, terminal_status,
          terminal_digest, terminal_json, completed_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        lifecycleId,
        terminal.identity.executionId,
        terminal.state,
        terminalDigest,
        encoded,
        completedAtMs,
      );
      return Object.freeze({ created: true, terminal: Object.freeze(terminal) });
    } catch (error) {
      const existing = this.db.prepare(`
        SELECT terminal_json AS terminalJson FROM m2_lifecycle_terminals
        WHERE lifecycle_id = ? OR execution_id = ? OR terminal_digest = ? LIMIT 1
      `).get(lifecycleId, terminal.identity.executionId, terminalDigest);
      if (existing?.terminalJson === encoded) {
        return Object.freeze({ created: false, terminal: Object.freeze(terminal) });
      }
      if (String(error?.message).includes('M2_LIFECYCLE_TERMINAL_AUTHORITY_MISSING')) {
        fail(M2LifecycleAuthorityErrorCode.TERMINAL_AUTHORITY_MISSING, 'SQL rejected lifecycle terminal authority');
      }
      if (existing) fail(M2LifecycleAuthorityErrorCode.TERMINAL_CONFLICT, 'Lifecycle already has a different terminal');
      storageFailure('terminal recording', error);
    }
  }

  getTerminal(lifecycleIdValue) {
    const lifecycleId = requireLifecycleId(lifecycleIdValue);
    const row = this.db.prepare(`
      SELECT terminal_json AS terminalJson FROM m2_lifecycle_terminals WHERE lifecycle_id = ?
    `).get(lifecycleId);
    return row ? parseStored(
      row.terminalJson,
      validateM2LifecycleTerminalSnapshot,
      'LifecycleTerminalSnapshot',
    ) : null;
  }

  appendEvent({ eventId, lifecycleId: lifecycleIdValue, type = null, eventType = null, details = {} }) {
    const lifecycleId = requireLifecycleId(lifecycleIdValue);
    const resolvedType = type ?? eventType;
    if (!isIdentifier(eventId) || !EVENT_TYPES.has(resolvedType) || !isPlainRecord(details)) {
      fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'A bounded lifecycle event is required');
    }
    const detailsJson = canonicalizeM2LifecycleValue(details);
    if (Buffer.byteLength(detailsJson, 'utf8') > 65_536) {
      fail(M2LifecycleAuthorityErrorCode.INPUT_INVALID, 'Lifecycle event details are too large');
    }
    const occurredAtMs = this.#now();
    try {
      this.db.prepare(`
        INSERT INTO m2_lifecycle_events (
          event_id, lifecycle_id, event_type, occurred_at_ms, details_json
        ) VALUES (?, ?, ?, ?, ?)
      `).run(eventId, lifecycleId, resolvedType, occurredAtMs, detailsJson);
      return Object.freeze({ created: true, eventId, occurredAtMs });
    } catch (error) {
      const existing = this.db.prepare(`
        SELECT lifecycle_id AS lifecycleId, event_type AS type,
               occurred_at_ms AS occurredAtMs, details_json AS detailsJson
        FROM m2_lifecycle_events WHERE event_id = ?
      `).get(eventId);
      if (existing?.lifecycleId === lifecycleId
        && existing.type === resolvedType
        && existing.detailsJson === detailsJson) {
        return Object.freeze({ created: false, eventId, occurredAtMs: existing.occurredAtMs });
      }
      if (existing) fail(M2LifecycleAuthorityErrorCode.EVENT_CONFLICT, 'Event identity has different bytes');
      storageFailure('event append', error);
    }
  }

  listEvents(lifecycleIdValue) {
    const lifecycleId = requireLifecycleId(lifecycleIdValue);
    return Object.freeze(this.db.prepare(`
      SELECT seq, event_id AS eventId, event_type AS type,
             occurred_at_ms AS occurredAtMs, details_json AS detailsJson
      FROM m2_lifecycle_events WHERE lifecycle_id = ? ORDER BY seq
    `).all(lifecycleId).map(row => {
      try {
        return Object.freeze({
          seq: row.seq,
          eventId: row.eventId,
          type: row.type,
          occurredAtMs: row.occurredAtMs,
          details: Object.freeze(JSON.parse(row.detailsJson)),
        });
      } catch (error) {
        storageFailure('event read', error);
      }
    }));
  }

  listRecoverable() {
    return Object.freeze(this.db.prepare(`
      SELECT operation.lifecycle_id AS lifecycleId,
             operation.run_id AS runId,
             operation.execution_id AS executionId,
             operation.project_id AS projectId,
             json_extract(operation.plan_json, '$.state') AS planState,
             approval.lifecycle_id IS NOT NULL AS hasApproval,
             grants.lifecycle_id IS NOT NULL AS hasGrantSet,
             cancel.lifecycle_id IS NOT NULL AS hasCancelIntent,
             result.execution_id IS NOT NULL AS hasExecutionResult,
             result.terminal_status AS executionStatus,
             receipt.lifecycle_id IS NOT NULL AS hasReceipt
      FROM m2_lifecycle_operations operation
      LEFT JOIN m2_lifecycle_approval_intents approval USING (lifecycle_id)
      LEFT JOIN m2_lifecycle_grant_sets grants USING (lifecycle_id)
      LEFT JOIN m2_lifecycle_cancel_intents cancel USING (lifecycle_id)
      LEFT JOIN m2_execution_results result ON result.execution_id = operation.execution_id
      LEFT JOIN m2_lifecycle_governance_receipts receipt USING (lifecycle_id)
      LEFT JOIN m2_lifecycle_terminals terminal USING (lifecycle_id)
      WHERE terminal.lifecycle_id IS NULL
      ORDER BY operation.created_at_ms, operation.lifecycle_id
    `).all().map(row => Object.freeze({
      lifecycleId: row.lifecycleId,
      runId: row.runId,
      executionId: row.executionId,
      projectId: row.projectId,
      state: row.hasCancelIntent
        ? 'cancel_requested'
        : row.hasExecutionResult
          ? row.executionStatus === 'succeeded' && !row.hasReceipt
            ? 'governance_pending'
            : 'terminal_pending'
          : row.hasGrantSet
            ? M2_LIFECYCLE_STATE.EXECUTING
            : row.hasApproval
              ? 'approval_recorded'
              : row.planState,
      hasApproval: Boolean(row.hasApproval),
      hasGrantSet: Boolean(row.hasGrantSet),
      hasCancelIntent: Boolean(row.hasCancelIntent),
      hasExecutionResult: Boolean(row.hasExecutionResult),
      hasReceipt: Boolean(row.hasReceipt),
    })));
  }
}

export default M2LifecycleAuthorityRepository;
