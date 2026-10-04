import { createHash } from 'node:crypto';

import {
  canonicalizeM2ExecutionValue,
  computeM2ExecutionValueDigest,
  computeM2ProjectChangeRequestDigest,
  validateM2ProjectChangeRequest,
  validateM2ProjectChangeResultForRequest,
  validateM2PrivateHttpProcessEffectForRequest,
} from '../../../contracts/m2/execution-v2.js';
import {
  canonicalizeM2GovernanceValue,
  computeM2GovernanceBaselineDigest,
  computeM2GovernanceDecisionDigest,
  computeM2GovernancePolicySnapshotDigest,
  computeM2GovernanceReceiptDigest,
  validateM2GovernanceBaselineSnapshot,
  validateM2GovernanceDecision,
  validateM2GovernancePolicySnapshot,
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
  validateM2GovernanceReceiptForDecision,
} from '../../../contracts/m2/lifecycle-v2.js';
import { isIdentifier, isPlainRecord, validateExactKeys } from '../../../contracts/m1/shared.js';

import { EXPECTED_M2_EXECUTION_SCHEMA_FINGERPRINT, computeM2ExecutionSchemaFingerprint, registerM2ExecutionSemanticFunctions } from './2026_08_24_078_m2_execution_authority.js';
import { computeM2LifecycleSchemaFingerprint, registerM2LifecycleSemanticFunctions } from './2026_08_24_079_m2_lifecycle_authority.js';

export const version = '2026_10_04_122_m2_private_http_authority';
export const description = 'Bind explicit private HTTP V2 payload, request, lifecycle and terminal SQL authority';
const ENVIRONMENT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const TERMINAL_WITHOUT_RESULT = new Set([M2_LIFECYCLE_STATE.BLOCKED, M2_LIFECYCLE_STATE.CANCELLED]);

function requestValid(requestJson) {
  try {
    const request = JSON.parse(requestJson);
    return validateM2ProjectChangeRequest(request).valid
      && (request.version !== 2 || canonicalizeM2ExecutionValue(request) === requestJson) ? 1 : 0;
  } catch {
    return 0;
  }
}

function resultMatchesRequest(requestJson, resultJson) {
  try {
    return validateM2ProjectChangeResultForRequest(
      JSON.parse(requestJson),
      JSON.parse(resultJson),
    ).valid ? 1 : 0;
  } catch {
    return 0;
  }
}

function fileMatchesRequest(
  requestJson,
  ordinal,
  relativePath,
  beforeExists,
  beforeDigest,
  beforeBytes,
  beforeMode,
  afterDigest,
  afterBytes,
  afterMode,
  forwardEffectId,
  rollbackEffectId,
) {
  try {
    const request = JSON.parse(requestJson);
    if (!validateM2ProjectChangeRequest(request).valid) return 0;
    const change = request.changes?.[ordinal];
    return change
      && change.path === relativePath
      && Number(change.before.exists) === beforeExists
      && change.before.digest === beforeDigest
      && change.before.bytes === beforeBytes
      && change.before.mode === beforeMode
      && change.after.digest === afterDigest
      && change.after.bytes === afterBytes
      && change.after.mode === afterMode
      && change.forwardAuthority?.effectId === forwardEffectId
      && change.rollbackAuthority?.effectId === rollbackEffectId
      ? 1 : 0;
  } catch {
    return 0;
  }
}

function stepMatchesRequest(requestJson, role, ordinal, effectId, requestDigest) {
  try {
    const request = JSON.parse(requestJson);
    if (!validateM2ProjectChangeRequest(request).valid) return 0;
    if (role === 'forward') {
      const authority = request.changes?.[ordinal]?.forwardAuthority;
      return authority?.effectId === effectId && authority?.requestDigest === requestDigest ? 1 : 0;
    }
    if (role === 'rollback') {
      const authority = request.changes?.[ordinal]?.rollbackAuthority;
      return authority?.effectId === effectId && authority?.requestDigest === requestDigest ? 1 : 0;
    }
    if (role === 'focused_test') {
      const authority = request.focusedTest?.authority;
      return ordinal === 0 && authority?.effectId === effectId && authority?.requestDigest === requestDigest ? 1 : 0;
    }
    if (role === 'git_commit') {
      const authority = request.gitCommit?.authority;
      return ordinal === 0 && authority?.effectId === effectId && authority?.requestDigest === requestDigest ? 1 : 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

function gitMaterialMatchesRequest(requestJson, message, identityJson) {
  try {
    const request = JSON.parse(requestJson);
    const identity = JSON.parse(identityJson);
    return validateM2ProjectChangeRequest(request).valid
      && request.gitCommit !== null
      && computeM2ExecutionValueDigest(message) === request.gitCommit.messageDigest
      && computeM2ExecutionValueDigest(identity) === request.gitCommit.identityDigest
      ? 1 : 0;
  } catch {
    return 0;
  }
}

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

export function validatePrivateHttpDurablePayload(request, effect, bytes) {
  try {
    if (request?.version !== 2 || !Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 4194304) return false;
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) return false;
    const payload = JSON.parse(text);
    return validateM2PrivateHttpProcessEffectForRequest(request, effect, bytes, payload.environment).valid;
  } catch { return false; }
}

function privateHttpRequestDigest(requestJson) {
  try {
    const request = JSON.parse(requestJson);
    return request.version === 2 && requestValid(requestJson) === 1
      ? computeM2ProjectChangeRequestDigest(request) : null;
  } catch { return null; }
}

function privateHttpPayloadMatches(requestJson, effectJson, payloadBytes) {
  try { return validatePrivateHttpDurablePayload(JSON.parse(requestJson), JSON.parse(effectJson), payloadBytes) ? 1 : 0; }
  catch { return 0; }
}

// Distinct names leave the historical V1 registrar/functions unchanged.
// The imported finite current contracts explicitly delegate version1 to V1,
// version2 to complete V2 and reject all unknown/mixed forms.
export function registerM2PrivateHttpSemanticFunctions(db) {
  registerM2ExecutionSemanticFunctions(db);
  registerM2LifecycleSemanticFunctions(db);
  const functions = [
    ['m2_execution_request_valid_current', requestValid, false],
    ['m2_execution_result_matches_request_current', resultMatchesRequest, false],
    ['m2_execution_file_matches_request_current', fileMatchesRequest, true],
    ['m2_execution_step_matches_request_current', stepMatchesRequest, false],
    ['m2_execution_git_material_matches_request_current', gitMaterialMatchesRequest, false],
    ['m2_lifecycle_operation_valid_current', operationValid, true],
    ['m2_lifecycle_approval_valid_current', approvalValid, false],
    ['m2_lifecycle_receipt_valid_current', receiptValid, true],
    ['m2_lifecycle_terminal_valid_current', terminalValid, true],
    ['m2_lifecycle_operation_digest_current', operationDigest, true],
    ['m2_execution_private_http_payload_matches_v2', privateHttpPayloadMatches, false],
    ['m2_execution_private_http_request_digest_v2', privateHttpRequestDigest, false],
  ];
  for (const [name, implementation, varargs] of functions) db.function(name, { deterministic: true, ...(varargs ? { varargs: true } : {}) }, implementation);
}

const TRIGGER_FUNCTIONS = Object.freeze({
  trg_m2_execution_requests_exact_contract: ['m2_execution_request_valid'],
  trg_m2_execution_git_material_exact_contract: ['m2_execution_git_material_matches_request'],
  trg_m2_execution_files_exact_contract: ['m2_execution_file_matches_request'],
  trg_m2_execution_steps_exact_contract: ['m2_execution_step_matches_request'],
  trg_m2_execution_results_terminal_truth: ['m2_execution_result_matches_request'],
  trg_m2_lifecycle_operations_exact: ['m2_lifecycle_operation_valid', 'm2_lifecycle_operation_digest'],
  trg_m2_lifecycle_approval_intents_exact: ['m2_lifecycle_approval_valid'],
  trg_m2_lifecycle_governance_receipts_exact: ['m2_lifecycle_receipt_valid'],
  trg_m2_lifecycle_terminals_exact: ['m2_lifecycle_terminal_valid'],
});
export const EXPECTED_M2_PRIVATE_HTTP_EXECUTION_FINGERPRINT = '77adfab252be7e01c7460832f584639ce46a7da7680485e5e688be3ebd7b2f63';
export const EXPECTED_M2_PRIVATE_HTTP_LIFECYCLE_FINGERPRINT = 'e088d8b80cd8404cf7ae95e653b2f9f0f44b38a7a24f7bc36f951506b8cd76a8';
// Canonical079 plus immutable106 index, as emitted by the complete current manifest.
const EXPECTED_SOURCE_LIFECYCLE_FINGERPRINT = 'e5e64b0508e1ee08e48bcdc420d4060f8e84d2afec769bda577374da3f19ffc7';

function targetSchema(db) {
  return computeM2ExecutionSchemaFingerprint(db) === EXPECTED_M2_PRIVATE_HTTP_EXECUTION_FINGERPRINT
    && computeM2LifecycleSchemaFingerprint(db) === EXPECTED_M2_PRIVATE_HTTP_LIFECYCLE_FINGERPRINT;
}

export function up(db) {
  registerM2PrivateHttpSemanticFunctions(db);
  const payloadColumn = db.prepare('PRAGMA table_info(m2_execution_requests)').all().some(row => row.name === 'focused_process_payload');
  if (payloadColumn) {
    if (!targetSchema(db)) throw new Error('M2_PRIVATE_HTTP_122_PARTIAL_SCHEMA');
    return;
  }
  if (computeM2ExecutionSchemaFingerprint(db) !== EXPECTED_M2_EXECUTION_SCHEMA_FINGERPRINT
    || computeM2LifecycleSchemaFingerprint(db) !== EXPECTED_SOURCE_LIFECYCLE_FINGERPRINT) {
    throw new Error('M2_PRIVATE_HTTP_122_SOURCE_SCHEMA_MISMATCH');
  }
  const updates = [];
  for (const [name, functions] of Object.entries(TRIGGER_FUNCTIONS)) {
    let sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name)?.sql;
    if (!sql) throw new Error('M2_PRIVATE_HTTP_122_TRIGGER_MISSING');
    for (const fn of functions) {
      const needle = `${fn}_v1(`;
      if (sql.split(needle).length !== 2) throw new Error('M2_PRIVATE_HTTP_122_TRIGGER_SOURCE_MISMATCH');
      sql = sql.replace(needle, `${fn}_current(`);
    }
    if (name === 'trg_m2_execution_requests_exact_contract') {
      const begin = '\n    BEGIN';
      if (sql.split(begin).length !== 2) throw new Error('M2_PRIVATE_HTTP_122_REQUEST_SOURCE_MISMATCH');
      sql = sql.replace(begin, `
      OR CASE json_extract(NEW.request_json, '$.version')
        WHEN 1 THEN NEW.focused_process_payload IS NOT NULL
        WHEN 2 THEN NEW.request_digest IS NOT m2_execution_private_http_request_digest_v2(NEW.request_json) OR NOT EXISTS (
          SELECT 1 FROM m2_effect_requests effect
          WHERE effect.effect_id = json_extract(NEW.request_json, '$.focusedTest.authority.effectId')
            AND m2_execution_private_http_payload_matches_v2(
              NEW.request_json, effect.request_json, NEW.focused_process_payload
            ) = 1
        )
        ELSE 1 END${begin}`);
    }
    updates.push([name, sql]);
  }
  db.exec('ALTER TABLE m2_execution_requests ADD COLUMN focused_process_payload BLOB CHECK (focused_process_payload IS NULL OR (typeof(focused_process_payload) = \'blob\' AND length(focused_process_payload) BETWEEN 1 AND 4194304))');
  for (const [name, sql] of updates) { db.exec(`DROP TRIGGER ${name};`); db.exec(`${sql};`); }
  if (!targetSchema(db)) {
    throw new Error('M2_PRIVATE_HTTP_122_TARGET_SCHEMA_MISMATCH');
  }
}

export default { version, description, up };
