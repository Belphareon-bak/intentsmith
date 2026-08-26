import { createHash } from 'node:crypto';

import {
  isIdentifier,
  isPlainRecord,
  validateExactKeys,
  validationResult,
} from '../m1/shared.js';

export const M5_PRIVACY_CONTRACT_VERSION = 1;
export const M5_PRIVACY_INCIDENT_ID = 'G0-PRIVACY-001';

export const M5_PRIVACY_KIND = Object.freeze({
  ROTATION_RECEIPT: 'PrivacyRotationReceipt',
  HISTORY_RECEIPT: 'PrivacyHistoryReceipt',
  REMEDIATION_STATUS: 'PrivacyRemediationStatus',
  TREE_SCAN: 'PrivacyTreeScan',
});

export const M5_PRIVACY_ROTATION_CATEGORIES = Object.freeze([
  Object.freeze({
    categoryId: 'administrative-api',
    authorityKind: 'local',
    incidentLabel: 'administrative and issued API credentials',
  }),
  Object.freeze({
    categoryId: 'ephemeral-authority',
    authorityKind: 'local',
    incidentLabel: 'ephemeral authorization material',
  }),
  Object.freeze({
    categoryId: 'fixture-password-reuse',
    authorityKind: 'mixed',
    incidentLabel: 'fixture passwords reused outside tests',
  }),
  Object.freeze({
    categoryId: 'license-agent',
    authorityKind: 'mixed',
    incidentLabel: 'license and agent credentials',
  }),
  Object.freeze({
    categoryId: 'license-signing-validation',
    authorityKind: 'mixed',
    incidentLabel: 'license signing and validation secrets',
  }),
  Object.freeze({
    categoryId: 'model-provider',
    authorityKind: 'external',
    incidentLabel: 'model and provider credentials',
  }),
  Object.freeze({
    categoryId: 'notification-credentials',
    authorityKind: 'external',
    incidentLabel: 'notification credentials',
  }),
  Object.freeze({
    categoryId: 'project-external',
    authorityKind: 'external',
    incidentLabel: 'project-scoped external credentials',
  }),
]);

export const M5_PRIVACY_HISTORY_DECISIONS = Object.freeze({
  RETAIN_AND_ROTATE: 'retain_and_rotate',
  REWRITE_AND_ROTATE: 'rewrite_and_rotate',
  NEW_ROOT_AND_ROTATE: 'new_root_and_rotate',
});

export const M5_PRIVACY_HISTORY_ACTION = Object.freeze({
  RETAINED: 'retained',
  REWRITE_COMPLETED: 'rewrite_completed',
  NEW_ROOT_COMPLETED: 'new_root_completed',
});

export const M5_PRIVACY_REPOSITORY_VISIBILITY = Object.freeze({
  PUBLIC: 'public',
  PRIVATE: 'private',
  REMOVED: 'removed',
});

const CATEGORY_BY_ID = new Map(
  M5_PRIVACY_ROTATION_CATEGORIES.map(category => [category.categoryId, category]),
);
const DECISION_ACTION = new Map([
  [M5_PRIVACY_HISTORY_DECISIONS.RETAIN_AND_ROTATE, M5_PRIVACY_HISTORY_ACTION.RETAINED],
  [M5_PRIVACY_HISTORY_DECISIONS.REWRITE_AND_ROTATE, M5_PRIVACY_HISTORY_ACTION.REWRITE_COMPLETED],
  [M5_PRIVACY_HISTORY_DECISIONS.NEW_ROOT_AND_ROTATE, M5_PRIVACY_HISTORY_ACTION.NEW_ROOT_COMPLETED],
]);
const REVISION = /^[a-f0-9]{40}$/;
const DIGEST_ID = /^(?:prr1|phr1):[a-f0-9]{64}$/;

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function canonicalize(value, seen = new Set(), depth = 0) {
  if (depth > 48) throw new TypeError('m5-privacy:canonical-too-deep');
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      throw new TypeError('m5-privacy:canonical-number-invalid');
    }
    return String(value);
  }
  if (typeof value !== 'object' || seen.has(value)) {
    throw new TypeError('m5-privacy:canonical-value-invalid');
  }
  seen.add(value);
  let encoded;
  if (Array.isArray(value)) {
    encoded = `[${value.map(item => canonicalize(item, seen, depth + 1)).join(',')}]`;
  } else if (isPlainRecord(value)) {
    encoded = `{${Object.keys(value).sort(compareUtf8).map(key => (
      `${JSON.stringify(key)}:${canonicalize(value[key], seen, depth + 1)}`
    )).join(',')}}`;
  } else {
    seen.delete(value);
    throw new TypeError('m5-privacy:canonical-object-invalid');
  }
  seen.delete(value);
  return encoded;
}

export function canonicalizeM5PrivacyValue(value) {
  return canonicalize(value);
}

function digestId(prefix, value) {
  return `${prefix}:${createHash('sha256').update(canonicalize(value), 'utf8').digest('hex')}`;
}

function validateActor(value, context) {
  const errors = validateExactKeys(value, ['actorType', 'actorId'], [], context);
  if (!isPlainRecord(value)) return errors;
  if (value.actorType !== 'user') errors.push(`${context}:invalid-actorType`);
  if (!isIdentifier(value.actorId)) errors.push(`${context}:invalid-actorId`);
  return errors;
}

function validateTimePair(value, context, errors) {
  if (!Number.isSafeInteger(value.completedAtMs) || value.completedAtMs < 1) {
    errors.push(`${context}:invalid-completedAtMs`);
  }
  if (!Number.isSafeInteger(value.attestedAtMs) || value.attestedAtMs < 1) {
    errors.push(`${context}:invalid-attestedAtMs`);
  }
  if (
    Number.isSafeInteger(value.completedAtMs)
    && Number.isSafeInteger(value.attestedAtMs)
    && value.completedAtMs > value.attestedAtMs
  ) errors.push(`${context}:completion-after-attestation`);
}

export function validateM5PrivacyRotationReceipt(value) {
  const context = 'm5-privacy-rotation-receipt';
  const errors = validateExactKeys(value, [
    'contract', 'version', 'receiptId', 'incidentId', 'categoryId',
    'authorityKind', 'completedAtMs', 'attestedAtMs', 'actor',
    'secretValuesRecorded',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M5_PRIVACY_KIND.ROTATION_RECEIPT) {
    errors.push(`${context}:invalid-contract`);
  }
  if (value.version !== M5_PRIVACY_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  if (!DIGEST_ID.test(value.receiptId || '') || !value.receiptId.startsWith('prr1:')) {
    errors.push(`${context}:invalid-receiptId`);
  }
  if (value.incidentId !== M5_PRIVACY_INCIDENT_ID) errors.push(`${context}:invalid-incidentId`);
  const category = CATEGORY_BY_ID.get(value.categoryId);
  if (!category) errors.push(`${context}:invalid-categoryId`);
  if (category && value.authorityKind !== category.authorityKind) {
    errors.push(`${context}:authorityKind-mismatch`);
  }
  validateTimePair(value, context, errors);
  errors.push(...validateActor(value.actor, `${context}.actor`));
  if (value.secretValuesRecorded !== false) errors.push(`${context}:secret-values-forbidden`);
  if (errors.length === 0) {
    const { receiptId, ...identity } = value;
    if (receiptId !== digestId('prr1', identity)) errors.push(`${context}:receiptId-mismatch`);
  }
  return validationResult(errors, value);
}

export function validateM5PrivacyHistoryReceipt(value) {
  const context = 'm5-privacy-history-receipt';
  const errors = validateExactKeys(value, [
    'contract', 'version', 'receiptId', 'incidentId', 'decision', 'actionStatus',
    'repositoryVisibility', 'completedAtMs', 'attestedAtMs', 'actor',
    'operatorAuthorityConfirmed', 'secretValuesRecorded',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M5_PRIVACY_KIND.HISTORY_RECEIPT) {
    errors.push(`${context}:invalid-contract`);
  }
  if (value.version !== M5_PRIVACY_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  if (!DIGEST_ID.test(value.receiptId || '') || !value.receiptId.startsWith('phr1:')) {
    errors.push(`${context}:invalid-receiptId`);
  }
  if (value.incidentId !== M5_PRIVACY_INCIDENT_ID) errors.push(`${context}:invalid-incidentId`);
  if (!DECISION_ACTION.has(value.decision)) errors.push(`${context}:invalid-decision`);
  if (DECISION_ACTION.get(value.decision) !== value.actionStatus) {
    errors.push(`${context}:actionStatus-mismatch`);
  }
  if (!Object.values(M5_PRIVACY_REPOSITORY_VISIBILITY).includes(value.repositoryVisibility)) {
    errors.push(`${context}:invalid-repositoryVisibility`);
  }
  validateTimePair(value, context, errors);
  errors.push(...validateActor(value.actor, `${context}.actor`));
  if (value.operatorAuthorityConfirmed !== true) {
    errors.push(`${context}:operator-authority-required`);
  }
  if (value.secretValuesRecorded !== false) errors.push(`${context}:secret-values-forbidden`);
  if (errors.length === 0) {
    const { receiptId, ...identity } = value;
    if (receiptId !== digestId('phr1', identity)) errors.push(`${context}:receiptId-mismatch`);
  }
  return validationResult(errors, value);
}

function createReceipt(prefix, fields) {
  const value = { ...fields };
  value.receiptId = digestId(prefix, value);
  const result = prefix === 'prr1'
    ? validateM5PrivacyRotationReceipt(value)
    : validateM5PrivacyHistoryReceipt(value);
  if (!result.valid) throw new TypeError(result.errors.join(','));
  return Object.freeze({
    ...value,
    actor: Object.freeze({ ...value.actor }),
  });
}

export function createM5PrivacyRotationReceipt({
  categoryId,
  authorityKind,
  completedAtMs,
  attestedAtMs,
  actorId,
}) {
  return createReceipt('prr1', {
    contract: M5_PRIVACY_KIND.ROTATION_RECEIPT,
    version: M5_PRIVACY_CONTRACT_VERSION,
    incidentId: M5_PRIVACY_INCIDENT_ID,
    categoryId,
    authorityKind,
    completedAtMs,
    attestedAtMs,
    actor: { actorType: 'user', actorId },
    secretValuesRecorded: false,
  });
}

export function createM5PrivacyHistoryReceipt({
  decision,
  actionStatus,
  repositoryVisibility,
  completedAtMs,
  attestedAtMs,
  actorId,
}) {
  return createReceipt('phr1', {
    contract: M5_PRIVACY_KIND.HISTORY_RECEIPT,
    version: M5_PRIVACY_CONTRACT_VERSION,
    incidentId: M5_PRIVACY_INCIDENT_ID,
    decision,
    actionStatus,
    repositoryVisibility,
    completedAtMs,
    attestedAtMs,
    actor: { actorType: 'user', actorId },
    operatorAuthorityConfirmed: true,
    secretValuesRecorded: false,
  });
}

export function validateM5PrivacyTreeScan(value) {
  const context = 'm5-privacy-tree-scan';
  const errors = validateExactKeys(value, [
    'contract', 'version', 'candidateRevision', 'scannedFiles',
    'contentReadFiles', 'distributionManifestDigest', 'findings', 'verdict',
    'secretValuesRecorded',
  ], [], context);
  if (!isPlainRecord(value)) return validationResult(errors, value);
  if (value.contract !== M5_PRIVACY_KIND.TREE_SCAN) errors.push(`${context}:invalid-contract`);
  if (value.version !== M5_PRIVACY_CONTRACT_VERSION) errors.push(`${context}:invalid-version`);
  if (!REVISION.test(value.candidateRevision || '')) errors.push(`${context}:invalid-revision`);
  if (!Number.isSafeInteger(value.scannedFiles) || value.scannedFiles < 0) {
    errors.push(`${context}:invalid-scannedFiles`);
  }
  if (
    !Number.isSafeInteger(value.contentReadFiles)
    || value.contentReadFiles < 0
    || value.contentReadFiles > value.scannedFiles
  ) errors.push(`${context}:invalid-contentReadFiles`);
  if (!/^sha256:[a-f0-9]{64}$/.test(value.distributionManifestDigest || '')) {
    errors.push(`${context}:invalid-distributionManifestDigest`);
  }
  if (!Array.isArray(value.findings)) errors.push(`${context}:invalid-findings`);
  else value.findings.forEach((finding, index) => {
    const findingContext = `${context}.findings[${index}]`;
    errors.push(...validateExactKeys(finding, ['ruleId', 'path', 'line'], [], findingContext));
    if (!isPlainRecord(finding)) return;
    if (typeof finding.ruleId !== 'string' || !/^[A-Z][A-Z0-9_]{0,95}$/.test(finding.ruleId)) {
      errors.push(`${findingContext}:invalid-ruleId`);
    }
    if (typeof finding.path !== 'string' || finding.path === '' || finding.path.includes('\0')) {
      errors.push(`${findingContext}:invalid-path`);
    }
    if (!(finding.line === null || (Number.isSafeInteger(finding.line) && finding.line > 0))) {
      errors.push(`${findingContext}:invalid-line`);
    }
  });
  const expectedVerdict = Array.isArray(value.findings) && value.findings.length === 0
    ? 'PASS'
    : 'FAIL';
  if (value.verdict !== expectedVerdict) errors.push(`${context}:verdict-mismatch`);
  if (value.secretValuesRecorded !== false) errors.push(`${context}:secret-values-forbidden`);
  return validationResult(errors, value);
}

export function expectedM5PrivacyAuthorityKind(categoryId) {
  return CATEGORY_BY_ID.get(categoryId)?.authorityKind ?? null;
}
