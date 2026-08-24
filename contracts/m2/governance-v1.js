import { createHash } from 'node:crypto';

import {
  canonicalizeM2ExecutionValue,
  computeM2ExecutionValueDigest,
  computeM2ProjectChangeRequestDigest,
  isM2ExecutionProjectRelativePath,
  validateM2ProjectChangeRequest,
  validateM2ProjectChangeResultForRequest,
} from './execution-v1.js';
import {
  isIdentifier,
  isPlainRecord,
  validateExactKeys,
  validationResult,
} from '../m1/shared.js';

export const M2_GOVERNANCE_CONTRACT_VERSION = 1;
export const M2_GOVERNANCE_CONTRACT_STAGE = 'CANDIDATE_V1';

export const M2_GOVERNANCE_CONTRACT_KIND = Object.freeze({
  POLICY_SNAPSHOT: 'GovernancePolicySnapshot',
  DECISION: 'GovernanceDecision',
  RECEIPT: 'GovernanceReceipt',
});

export const M2_GOVERNANCE_VERDICT = Object.freeze({
  ALLOW: 'allow',
  DENY: 'deny',
  UNAVAILABLE: 'unavailable',
});

export const M2_GOVERNANCE_CHECK_STATUS = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  UNAVAILABLE: 'unavailable',
});

export const M2_GOVERNANCE_REQUIRED_CHECKS = Object.freeze([
  'imports.allowed',
  'inventory.complete',
  'layers.mapped',
]);

export const M2_GOVERNANCE_DECISION_CHECKS = Object.freeze([
  'imports.allowed',
  'input.bindings',
  'inventory.complete',
  'layers.mapped',
]);

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const REVISION_PATTERN = /^wsr1:[0-9a-f]{64}$/;
const FINDING_ID_PATTERN = /^govfind1:[0-9a-f]{64}$/;
const DECISION_ID_PATTERN = /^govdec1:[0-9a-f]{64}$/;
const RECEIPT_ID_PATTERN = /^govreceipt1:[0-9a-f]{64}$/;
const FINDING_CODE_PATTERN = /^[A-Z][A-Z0-9_:-]{0,95}$/;
const SOURCE_EXTENSION_PATTERN = /^\.[a-z0-9][a-z0-9_-]{0,31}$/;
const CHECK_STATUSES = new Set(Object.values(M2_GOVERNANCE_CHECK_STATUS));
const VERDICTS = new Set(Object.values(M2_GOVERNANCE_VERDICT));

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
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

function isCanonicalSourceExtension(value) {
  return typeof value === 'string'
    && SOURCE_EXTENSION_PATTERN.test(value)
    && value === value.normalize('NFC')
    && value === value.toLowerCase();
}

function isNfcString(value, maximum = 4096) {
  return typeof value === 'string'
    && value === value.normalize('NFC')
    && Buffer.byteLength(value, 'utf8') <= maximum;
}

function validateSortedUniqueStrings(value, context, validator = isNfcString) {
  if (!Array.isArray(value)) return [`${context}:not-array`];
  const errors = [];
  value.forEach((item, index) => {
    if (!validator(item) || item.length === 0) errors.push(`${context}[${index}]:invalid`);
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

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((item, index) => item === right[index]);
}

function identifierFromDigest(prefix, digest) {
  return `${prefix}:${digest.slice('sha256:'.length)}`;
}

function withoutKey(value, key) {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

export function canonicalizeM2GovernanceValue(value) {
  return canonicalizeM2ExecutionValue(value);
}

export function computeM2GovernanceValueDigest(value) {
  return computeM2ExecutionValueDigest(value);
}

function sha256Bytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function decodeCanonicalBase64(value) {
  if (typeof value !== 'string' || value.length % 4 !== 0) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : null;
}

function validateSortedFilePaths(files, context) {
  const errors = [];
  for (let index = 1; index < files.length; index += 1) {
    const previousPath = files[index - 1]?.path;
    const currentPath = files[index]?.path;
    if (
      typeof previousPath === 'string'
      && typeof currentPath === 'string'
      && compareUtf8(previousPath, currentPath) >= 0
    ) {
      errors.push(`${context}:not-bytewise-sorted-unique`);
      break;
    }
  }
  return errors;
}

function validateBaselineFile(value, index) {
  const context = `governance-baseline.files[${index}]`;
  const errors = validateExactKeys(value, ['path', 'contentBase64', 'digest', 'bytes'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!isM2ExecutionProjectRelativePath(value.path)) errors.push(`${context}:invalid-path`);
  const content = decodeCanonicalBase64(value.contentBase64);
  if (content === null) errors.push(`${context}:invalid-contentBase64`);
  if (!isDigest(value.digest)) errors.push(`${context}:invalid-digest`);
  if (!Number.isSafeInteger(value.bytes) || value.bytes < 0) {
    errors.push(`${context}:invalid-bytes`);
  }
  if (content !== null) {
    if (value.bytes !== content.length) errors.push(`${context}:byte-count-mismatch`);
    if (value.digest !== sha256Bytes(content)) errors.push(`${context}:digest-mismatch`);
  }
  return errors;
}

/**
 * Exact durable governance input. `complete` is an assertion made by the
 * inventory producer and must only be set after its full enumeration succeeds.
 */
export function validateM2GovernanceBaselineSnapshot(value) {
  const context = 'governance-baseline';
  const errors = validateExactKeys(
    value,
    ['projectId', 'workspaceRevision', 'complete', 'files'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (!Number.isSafeInteger(value.projectId) || value.projectId < 1) {
    errors.push(`${context}:invalid-projectId`);
  }
  if (!isRevision(value.workspaceRevision)) errors.push(`${context}:invalid-workspaceRevision`);
  if (typeof value.complete !== 'boolean') errors.push(`${context}:invalid-complete`);
  if (!Array.isArray(value.files)) {
    errors.push(`${context}.files:not-array`);
  } else {
    value.files.forEach((file, index) => errors.push(...validateBaselineFile(file, index)));
    errors.push(...validateSortedFilePaths(value.files, `${context}.files`));
  }
  return validationResult(errors, value);
}

export function computeM2GovernanceBaselineDigest(value) {
  const validation = validateM2GovernanceBaselineSnapshot(value);
  if (!validation.valid) throw new TypeError(validation.errors.join(','));
  return computeM2GovernanceValueDigest(value);
}

function validateLayer(value, index) {
  const context = `governance-policy-snapshot.layers[${index}]`;
  const errors = validateExactKeys(value, ['name', 'roots'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!isIdentifier(value.name)) errors.push(`${context}:invalid-name`);
  errors.push(...validateSortedUniqueStrings(
    value.roots,
    `${context}.roots`,
    isM2ExecutionProjectRelativePath,
  ));
  if (value.roots?.length === 0) errors.push(`${context}.roots:empty`);
  return errors;
}

function validateRule(value, index, layerNames) {
  const context = `governance-policy-snapshot.rules[${index}]`;
  const errors = validateExactKeys(value, ['from', 'canImport'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!isIdentifier(value.from) || !layerNames.has(value.from)) {
    errors.push(`${context}:invalid-from`);
  }
  errors.push(...validateSortedUniqueStrings(value.canImport, `${context}.canImport`, isIdentifier));
  if (Array.isArray(value.canImport)) {
    value.canImport.forEach((target, targetIndex) => {
      if (!layerNames.has(target)) errors.push(`${context}.canImport[${targetIndex}]:unknown-layer`);
    });
  }
  return errors;
}

export function validateM2GovernancePolicySnapshot(value) {
  const context = 'governance-policy-snapshot';
  const errors = validateExactKeys(value, [
    'contract', 'version', 'policyId', 'projectId', 'workspaceRevision',
    'policyPath', 'layers', 'rules', 'externalImports', 'sourceExtensions',
    'requiredChecks', 'unmappedFilePolicy',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M2_GOVERNANCE_CONTRACT_KIND.POLICY_SNAPSHOT) {
    errors.push(`${context}:invalid-contract`);
  }
  if (value.version !== M2_GOVERNANCE_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  if (!isIdentifier(value.policyId)) errors.push(`${context}:invalid-policyId`);
  if (!Number.isSafeInteger(value.projectId) || value.projectId < 1) {
    errors.push(`${context}:invalid-projectId`);
  }
  if (!isRevision(value.workspaceRevision)) errors.push(`${context}:invalid-workspaceRevision`);
  if (!isM2ExecutionProjectRelativePath(value.policyPath)) errors.push(`${context}:invalid-policyPath`);
  errors.push(...validateSortedUniqueStrings(
    value.externalImports,
    `${context}.externalImports`,
  ));
  errors.push(...validateSortedUniqueStrings(
    value.sourceExtensions,
    `${context}.sourceExtensions`,
    isCanonicalSourceExtension,
  ));
  if (value.sourceExtensions?.length === 0) {
    errors.push(`${context}.sourceExtensions:empty`);
  }

  if (!Array.isArray(value.layers) || value.layers.length < 1 || value.layers.length > 64) {
    errors.push(`${context}:invalid-layers`);
  } else {
    value.layers.forEach((layer, index) => errors.push(...validateLayer(layer, index)));
    const names = value.layers.map(layer => layer?.name);
    errors.push(...validateSortedUniqueStrings(names, `${context}.layerNames`, isIdentifier));
    const roots = value.layers.flatMap(layer => Array.isArray(layer?.roots) ? layer.roots : []);
    if (new Set(roots).size !== roots.length) errors.push(`${context}:duplicate-root`);
  }

  const layerNames = new Set(
    Array.isArray(value.layers)
      ? value.layers.map(layer => layer?.name).filter(isIdentifier)
      : [],
  );
  if (!Array.isArray(value.rules) || value.rules.length !== layerNames.size) {
    errors.push(`${context}:one-rule-per-layer-required`);
  } else {
    value.rules.forEach((rule, index) => errors.push(...validateRule(rule, index, layerNames)));
    const fromNames = value.rules.map(rule => rule?.from);
    errors.push(...validateSortedUniqueStrings(fromNames, `${context}.ruleFrom`, isIdentifier));
    if (!arraysEqual(fromNames, [...layerNames].sort(compareUtf8))) {
      errors.push(`${context}:rule-layer-set-mismatch`);
    }
  }

  errors.push(...validateSortedUniqueStrings(value.requiredChecks, `${context}.requiredChecks`));
  if (!arraysEqual(value.requiredChecks, M2_GOVERNANCE_REQUIRED_CHECKS)) {
    errors.push(`${context}:required-check-set-mismatch`);
  }
  if (value.unmappedFilePolicy !== 'unavailable') {
    errors.push(`${context}:unmapped-policy-must-fail-closed`);
  }
  return validationResult(errors, value);
}

export function computeM2GovernancePolicySnapshotDigest(value) {
  const validation = validateM2GovernancePolicySnapshot(value);
  if (!validation.valid) throw new TypeError(validation.errors.join(','));
  return computeM2GovernanceValueDigest(value);
}

function findingProjection(value) {
  return {
    checkId: value.checkId,
    code: value.code,
    path: value.path,
    evidenceDigest: value.evidenceDigest,
  };
}

export function createM2GovernanceFinding({ checkId, code, path = null, evidence }) {
  const projection = {
    checkId,
    code,
    path,
    evidenceDigest: computeM2GovernanceValueDigest(evidence),
  };
  return Object.freeze({
    findingId: identifierFromDigest('govfind1', computeM2GovernanceValueDigest(projection)),
    ...projection,
  });
}

function validateFinding(value, index) {
  const context = `governance-decision.findings[${index}]`;
  const errors = validateExactKeys(
    value,
    ['findingId', 'checkId', 'code', 'path', 'evidenceDigest'],
    [],
    context,
  );
  if (!isPlainRecord(value)) return errors;
  if (typeof value.findingId !== 'string' || !FINDING_ID_PATTERN.test(value.findingId)) {
    errors.push(`${context}:invalid-findingId`);
  }
  if (!M2_GOVERNANCE_DECISION_CHECKS.includes(value.checkId)) errors.push(`${context}:invalid-checkId`);
  if (typeof value.code !== 'string' || !FINDING_CODE_PATTERN.test(value.code)) {
    errors.push(`${context}:invalid-code`);
  }
  if (!(value.path === null || isM2ExecutionProjectRelativePath(value.path))) {
    errors.push(`${context}:invalid-path`);
  }
  if (!isDigest(value.evidenceDigest)) errors.push(`${context}:invalid-evidenceDigest`);
  try {
    const expected = identifierFromDigest(
      'govfind1',
      computeM2GovernanceValueDigest(findingProjection(value)),
    );
    if (value.findingId !== expected) errors.push(`${context}:findingId-mismatch`);
  } catch {
    errors.push(`${context}:invalid-canonical-form`);
  }
  return errors;
}

function validateDecisionCheck(value, index, findings) {
  const context = `governance-decision.checks[${index}]`;
  const errors = validateExactKeys(value, ['checkId', 'required', 'status', 'findingIds'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (!M2_GOVERNANCE_DECISION_CHECKS.includes(value.checkId)) errors.push(`${context}:invalid-checkId`);
  if (value.required !== true) errors.push(`${context}:required-check-must-be-true`);
  if (!CHECK_STATUSES.has(value.status)) errors.push(`${context}:invalid-status`);
  errors.push(...validateSortedUniqueStrings(value.findingIds, `${context}.findingIds`));
  const expectedIds = findings
    .filter(finding => finding?.checkId === value.checkId)
    .map(finding => finding.findingId)
    .filter(findingId => typeof findingId === 'string')
    .sort(compareUtf8);
  if (!arraysEqual(value.findingIds, expectedIds)) errors.push(`${context}:finding-set-mismatch`);
  if (value.status === M2_GOVERNANCE_CHECK_STATUS.PASS && value.findingIds?.length !== 0) {
    errors.push(`${context}:findings-on-pass`);
  }
  if (value.status !== M2_GOVERNANCE_CHECK_STATUS.PASS && value.findingIds?.length === 0) {
    errors.push(`${context}:missing-finding`);
  }
  return errors;
}

function decisionProjection(value) {
  return withoutKey(value, 'decisionId');
}

export function validateM2GovernanceDecision(value) {
  const context = 'governance-decision';
  const errors = validateExactKeys(value, [
    'contract', 'version', 'decisionId', 'lifecycleId', 'milestoneId',
    'executionId', 'runId', 'projectId', 'requestDigest', 'policyDigest',
    'baselineDigest', 'expectedAfterRevision', 'verdict', 'checks',
    'findings', 'blockingFindingIds',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M2_GOVERNANCE_CONTRACT_KIND.DECISION) errors.push(`${context}:invalid-contract`);
  if (value.version !== M2_GOVERNANCE_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  if (typeof value.decisionId !== 'string' || !DECISION_ID_PATTERN.test(value.decisionId)) {
    errors.push(`${context}:invalid-decisionId`);
  }
  for (const key of ['lifecycleId', 'milestoneId', 'executionId', 'runId']) {
    if (!isIdentifier(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  if (!Number.isSafeInteger(value.projectId) || value.projectId < 1) errors.push(`${context}:invalid-projectId`);
  for (const key of ['requestDigest', 'policyDigest', 'baselineDigest']) {
    if (!isDigest(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  if (!(value.expectedAfterRevision === null || isRevision(value.expectedAfterRevision))) {
    errors.push(`${context}:invalid-expectedAfterRevision`);
  }
  if (!VERDICTS.has(value.verdict)) errors.push(`${context}:invalid-verdict`);

  const findings = Array.isArray(value.findings) ? value.findings : [];
  if (!Array.isArray(value.findings)) {
    errors.push(`${context}.findings:not-array`);
  } else {
    value.findings.forEach((finding, index) => errors.push(...validateFinding(finding, index)));
    errors.push(...validateSortedUniqueStrings(
      value.findings.map(finding => finding?.findingId),
      `${context}.findingIds`,
    ));
  }

  if (!Array.isArray(value.checks) || value.checks.length !== M2_GOVERNANCE_DECISION_CHECKS.length) {
    errors.push(`${context}:complete-check-set-required`);
  } else {
    value.checks.forEach((check, index) => errors.push(...validateDecisionCheck(check, index, findings)));
    const ids = value.checks.map(check => check?.checkId);
    if (!arraysEqual(ids, M2_GOVERNANCE_DECISION_CHECKS)) errors.push(`${context}:check-order-mismatch`);
  }

  errors.push(...validateSortedUniqueStrings(value.blockingFindingIds, `${context}.blockingFindingIds`));
  const allFindingIds = new Set(findings.map(finding => finding.findingId));
  if (Array.isArray(value.blockingFindingIds)) {
    value.blockingFindingIds.forEach((findingId, index) => {
      if (!allFindingIds.has(findingId)) {
        errors.push(`${context}.blockingFindingIds[${index}]:unknown-finding`);
      }
    });
  }

  const statuses = Array.isArray(value.checks) ? value.checks.map(check => check?.status) : [];
  const expectedBlockingFindingIds = value.verdict === M2_GOVERNANCE_VERDICT.ALLOW
    ? []
    : findings
      .map(finding => finding?.findingId)
      .filter(findingId => typeof findingId === 'string')
      .sort(compareUtf8);
  if (!arraysEqual(value.blockingFindingIds, expectedBlockingFindingIds)) {
    errors.push(`${context}:blocking-finding-set-mismatch`);
  }
  if (value.verdict === M2_GOVERNANCE_VERDICT.ALLOW && (
    value.expectedAfterRevision === null
    || statuses.some(status => status !== M2_GOVERNANCE_CHECK_STATUS.PASS)
    || findings.length !== 0
    || value.blockingFindingIds?.length !== 0
  )) errors.push(`${context}:false-allow`);
  if (value.verdict === M2_GOVERNANCE_VERDICT.DENY && (
    !statuses.includes(M2_GOVERNANCE_CHECK_STATUS.FAIL)
    || statuses.includes(M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE)
  )) errors.push(`${context}:invalid-deny`);
  if (value.verdict === M2_GOVERNANCE_VERDICT.UNAVAILABLE
    && !statuses.includes(M2_GOVERNANCE_CHECK_STATUS.UNAVAILABLE)) {
    errors.push(`${context}:invalid-unavailable`);
  }
  try {
    const expectedId = identifierFromDigest(
      'govdec1',
      computeM2GovernanceValueDigest(decisionProjection(value)),
    );
    if (value.decisionId !== expectedId) errors.push(`${context}:decisionId-mismatch`);
  } catch {
    errors.push(`${context}:invalid-canonical-form`);
  }
  return validationResult(errors, value);
}

export function createM2GovernanceDecision(fields) {
  const projection = {
    contract: M2_GOVERNANCE_CONTRACT_KIND.DECISION,
    version: M2_GOVERNANCE_CONTRACT_VERSION,
    ...fields,
  };
  const value = {
    decisionId: identifierFromDigest(
      'govdec1',
      computeM2GovernanceValueDigest(projection),
    ),
    ...projection,
  };
  const validation = validateM2GovernanceDecision(value);
  if (!validation.valid) throw new TypeError(validation.errors.join(','));
  return Object.freeze(value);
}

export function computeM2GovernanceDecisionDigest(value) {
  const validation = validateM2GovernanceDecision(value);
  if (!validation.valid) throw new TypeError(validation.errors.join(','));
  return computeM2GovernanceValueDigest(value);
}

function receiptProjection(value) {
  return withoutKey(value, 'receiptId');
}

export function validateM2GovernanceReceipt(value) {
  const context = 'governance-receipt';
  const errors = validateExactKeys(value, [
    'contract', 'version', 'receiptId', 'decisionDigest', 'lifecycleId',
    'milestoneId', 'executionId', 'runId', 'projectId', 'requestDigest',
    'policyDigest', 'baselineDigest', 'expectedAfterRevision', 'resultDigest',
    'actualAfterRevision', 'fencingGeneration', 'status', 'recordedAt',
    'evidenceRefs',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M2_GOVERNANCE_CONTRACT_KIND.RECEIPT) errors.push(`${context}:invalid-contract`);
  if (value.version !== M2_GOVERNANCE_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  if (typeof value.receiptId !== 'string' || !RECEIPT_ID_PATTERN.test(value.receiptId)) {
    errors.push(`${context}:invalid-receiptId`);
  }
  if (!isDigest(value.decisionDigest)) errors.push(`${context}:invalid-decisionDigest`);
  for (const key of ['lifecycleId', 'milestoneId', 'executionId', 'runId']) {
    if (!isIdentifier(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  if (!Number.isSafeInteger(value.projectId) || value.projectId < 1) errors.push(`${context}:invalid-projectId`);
  for (const key of ['requestDigest', 'policyDigest', 'baselineDigest', 'resultDigest']) {
    if (!isDigest(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  for (const key of ['expectedAfterRevision', 'actualAfterRevision']) {
    if (!isRevision(value[key])) errors.push(`${context}:invalid-${key}`);
  }
  if (value.actualAfterRevision !== value.expectedAfterRevision) {
    errors.push(`${context}:after-revision-mismatch`);
  }
  if (!Number.isSafeInteger(value.fencingGeneration) || value.fencingGeneration < 1) {
    errors.push(`${context}:invalid-fencingGeneration`);
  }
  if (value.status !== 'accepted') errors.push(`${context}:accepted-required`);
  if (!isCanonicalTimestamp(value.recordedAt)) errors.push(`${context}:invalid-recordedAt`);
  errors.push(...validateSortedUniqueStrings(value.evidenceRefs, `${context}.evidenceRefs`));
  if (value.evidenceRefs?.length < 2 || value.evidenceRefs?.length > 66) {
    errors.push(`${context}:invalid-evidence-count`);
  }
  try {
    const expectedId = identifierFromDigest(
      'govreceipt1',
      computeM2GovernanceValueDigest(receiptProjection(value)),
    );
    if (value.receiptId !== expectedId) errors.push(`${context}:receiptId-mismatch`);
  } catch {
    errors.push(`${context}:invalid-canonical-form`);
  }
  return validationResult(errors, value);
}

export function validateM2GovernanceReceiptForDecision(
  request,
  result,
  decision,
  receipt,
) {
  const errors = [];
  const requestValidation = validateM2ProjectChangeRequest(request);
  const resultValidation = validateM2ProjectChangeResultForRequest(request, result);
  const decisionValidation = validateM2GovernanceDecision(decision);
  const receiptValidation = validateM2GovernanceReceipt(receipt);
  errors.push(
    ...requestValidation.errors,
    ...resultValidation.errors,
    ...decisionValidation.errors,
    ...receiptValidation.errors,
  );
  if (!requestValidation.valid || !resultValidation.valid
    || !decisionValidation.valid || !receiptValidation.valid) {
    return validationResult(errors, receipt);
  }

  const requestDigest = computeM2ProjectChangeRequestDigest(request);
  const resultDigest = computeM2ExecutionValueDigest(result);
  const decisionDigest = computeM2GovernanceDecisionDigest(decision);
  if (decision.verdict !== M2_GOVERNANCE_VERDICT.ALLOW) {
    errors.push('governance-receipt:decision-not-allow');
  }
  if (result.terminalStatus !== 'succeeded') errors.push('governance-receipt:result-not-succeeded');
  if (
    decision.executionId !== request.executionId
    || decision.runId !== request.runId
    || decision.projectId !== request.project.projectId
    || decision.requestDigest !== requestDigest
  ) errors.push('governance-receipt:decision-request-identity-mismatch');
  if (
    receipt.lifecycleId !== decision.lifecycleId
    || receipt.milestoneId !== decision.milestoneId
    || receipt.executionId !== decision.executionId
    || receipt.runId !== decision.runId
    || receipt.projectId !== decision.projectId
    || receipt.requestDigest !== decision.requestDigest
    || receipt.policyDigest !== decision.policyDigest
    || receipt.baselineDigest !== decision.baselineDigest
    || receipt.expectedAfterRevision !== decision.expectedAfterRevision
    || receipt.decisionDigest !== decisionDigest
  ) errors.push('governance-receipt:decision-identity-mismatch');
  if (
    receipt.resultDigest !== resultDigest
    || receipt.actualAfterRevision !== result.changes.afterRevision
    || receipt.fencingGeneration !== result.fencingGeneration
  ) errors.push('governance-receipt:result-identity-mismatch');
  if (result.changes.afterRevision !== decision.expectedAfterRevision) {
    errors.push('governance-receipt:unexpected-after-revision');
  }
  if (Date.parse(receipt.recordedAt) < Date.parse(result.completedAt)) {
    errors.push('governance-receipt:recorded-before-result');
  }
  const requiredEvidence = [
    ...result.evidenceRefs,
    `governance-decision:${decision.decisionId}`,
    `project-change-result:${result.executionId}`,
  ].sort(compareUtf8);
  if (!arraysEqual(receipt.evidenceRefs, requiredEvidence)) {
    errors.push('governance-receipt:evidence-set-mismatch');
  }
  return validationResult(errors, receipt);
}

export function computeM2GovernanceReceiptDigest(value) {
  const validation = validateM2GovernanceReceipt(value);
  if (!validation.valid) throw new TypeError(validation.errors.join(','));
  return computeM2GovernanceValueDigest(value);
}

export function validateM2GovernanceContract(value, expectedContract = null) {
  if (!isPlainRecord(value)) return validationResult(['m2-governance:not-object'], value);
  if (expectedContract !== null && value.contract !== expectedContract) {
    return validationResult(['m2-governance:unexpected-contract'], value);
  }
  if (value.contract === M2_GOVERNANCE_CONTRACT_KIND.POLICY_SNAPSHOT) {
    return validateM2GovernancePolicySnapshot(value);
  }
  if (value.contract === M2_GOVERNANCE_CONTRACT_KIND.DECISION) {
    return validateM2GovernanceDecision(value);
  }
  if (value.contract === M2_GOVERNANCE_CONTRACT_KIND.RECEIPT) {
    return validateM2GovernanceReceipt(value);
  }
  return validationResult(['m2-governance:unknown-contract'], value);
}

export function encodeM2GovernanceContract(value, expectedContract = null) {
  const validation = validateM2GovernanceContract(value, expectedContract);
  if (!validation.valid) throw new TypeError(validation.errors.join(','));
  return Buffer.from(canonicalizeM2GovernanceValue(value), 'utf8');
}

export function decodeM2GovernanceContract(encoded, expectedContract = null) {
  if (!(typeof encoded === 'string' || Buffer.isBuffer(encoded) || encoded instanceof Uint8Array)) {
    throw new TypeError('m2-governance-decode:invalid-bytes');
  }
  const bytes = Buffer.isBuffer(encoded) ? encoded : Buffer.from(encoded);
  if (bytes.length === 0 || bytes.length > 4_194_304) {
    throw new TypeError('m2-governance-decode:invalid-size');
  }
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new TypeError('m2-governance-decode:invalid-utf8');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TypeError('m2-governance-decode:invalid-json');
  }
  const validation = validateM2GovernanceContract(value, expectedContract);
  if (!validation.valid) throw new TypeError(validation.errors.join(','));
  if (!Buffer.from(canonicalizeM2GovernanceValue(value), 'utf8').equals(bytes)) {
    throw new TypeError('m2-governance-decode:noncanonical');
  }
  return Object.freeze(value);
}
