import {
  SIGNED_AUTHORITY_DOMAIN,
  SIGNED_AUTHORITY_ROLE,
  validateSignedAuthorityReceiptShape,
} from '../authority/signed-authority-receipt-v1.js';
import {
  M5_PRIVACY_HISTORY_ACTION,
  M5_PRIVACY_HISTORY_DECISIONS,
  M5_PRIVACY_INCIDENT_ID,
  M5_PRIVACY_REPOSITORY_VISIBILITY,
  expectedM5PrivacyAuthorityKind,
} from './privacy-remediation-v1.js';

export const M5_SIGNED_PRIVACY_PAYLOAD = Object.freeze({
  ROTATION: 'M5PrivacyRotationEvidence',
  HISTORY: 'M5PrivacyHistoryEvidence',
});

const SHA = /^[a-f0-9]{40}$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

const ROTATION_KEYS = Object.freeze([
  'authorityKind',
  'categoryId',
  'completedAtMs',
  'contract',
  'incidentId',
  'operationCompleted',
  'providerActionEvidenceSha256',
  'secretMaterialIncluded',
  'version',
]);
const HISTORY_KEYS = Object.freeze([
  'completedAction',
  'completedAtMs',
  'contract',
  'disposition',
  'incidentId',
  'operationCompleted',
  'postDispositionHeadSha',
  'privacyScanSha256',
  'refCensusSha256',
  'repositoryVisibility',
  'secretMaterialIncluded',
  'version',
]);
const DECISION_ACTION = new Map([
  [M5_PRIVACY_HISTORY_DECISIONS.RETAIN_AND_ROTATE, M5_PRIVACY_HISTORY_ACTION.RETAINED],
  [M5_PRIVACY_HISTORY_DECISIONS.REWRITE_AND_ROTATE, M5_PRIVACY_HISTORY_ACTION.REWRITE_COMPLETED],
  [M5_PRIVACY_HISTORY_DECISIONS.NEW_ROOT_AND_ROTATE, M5_PRIVACY_HISTORY_ACTION.NEW_ROOT_COMPLETED],
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isRecord(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function hasArtifactDigest(receipt, digest) {
  return Array.isArray(receipt?.artifacts)
    && receipt.artifacts.some(artifact => artifact.sha256 === digest);
}

function baseErrors(receipt, domain, decision) {
  const shape = validateSignedAuthorityReceiptShape(receipt);
  const errors = [...shape.errors];
  if (receipt?.domain !== domain) errors.push('m5-signed-privacy:domain');
  if (receipt?.authorityId !== SIGNED_AUTHORITY_ROLE.M5_PRIVACY_OPERATOR) {
    errors.push('m5-signed-privacy:authority');
  }
  if (receipt?.decision !== decision) errors.push('m5-signed-privacy:decision');
  return errors;
}

function completedAtErrors(receipt, payload, errors) {
  if (!Number.isSafeInteger(payload.completedAtMs) || payload.completedAtMs < 1) {
    errors.push('m5-signed-privacy:completed-at');
  }
  if (
    Number.isSafeInteger(payload.completedAtMs)
    && Number.isSafeInteger(receipt?.issuedAtMs)
    && payload.completedAtMs > receipt.issuedAtMs
  ) errors.push('m5-signed-privacy:completion-after-issue');
  if (payload.operationCompleted !== true) errors.push('m5-signed-privacy:not-completed');
  if (payload.secretMaterialIncluded !== false) {
    errors.push('m5-signed-privacy:secret-material-forbidden');
  }
}

export function validateSignedM5PrivacyRotationReceipt(receipt) {
  const errors = baseErrors(
    receipt,
    SIGNED_AUTHORITY_DOMAIN.M5_PRIVACY_ROTATION,
    'ROTATION_COMPLETED',
  );
  const payload = receipt?.payload;
  if (!exactKeys(payload, ROTATION_KEYS)) {
    errors.push('m5-signed-privacy:rotation-payload-keys');
    return Object.freeze({ valid: false, errors: Object.freeze(errors) });
  }
  if (payload.contract !== M5_SIGNED_PRIVACY_PAYLOAD.ROTATION || payload.version !== 1) {
    errors.push('m5-signed-privacy:rotation-contract');
  }
  if (payload.incidentId !== M5_PRIVACY_INCIDENT_ID) {
    errors.push('m5-signed-privacy:incident');
  }
  const expectedAuthority = expectedM5PrivacyAuthorityKind(payload.categoryId);
  if (expectedAuthority === null || payload.authorityKind !== expectedAuthority) {
    errors.push('m5-signed-privacy:category-authority');
  }
  completedAtErrors(receipt, payload, errors);
  if (!SHA256.test(payload.providerActionEvidenceSha256 || '')) {
    errors.push('m5-signed-privacy:provider-action-digest');
  } else if (!hasArtifactDigest(receipt, payload.providerActionEvidenceSha256)) {
    errors.push('m5-signed-privacy:provider-action-artifact-unbound');
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function validateSignedM5PrivacyHistoryReceipt(receipt) {
  const errors = baseErrors(
    receipt,
    SIGNED_AUTHORITY_DOMAIN.M5_PRIVACY_HISTORY,
    'HISTORY_DISPOSITION_COMPLETED',
  );
  const payload = receipt?.payload;
  if (!exactKeys(payload, HISTORY_KEYS)) {
    errors.push('m5-signed-privacy:history-payload-keys');
    return Object.freeze({ valid: false, errors: Object.freeze(errors) });
  }
  if (payload.contract !== M5_SIGNED_PRIVACY_PAYLOAD.HISTORY || payload.version !== 1) {
    errors.push('m5-signed-privacy:history-contract');
  }
  if (payload.incidentId !== M5_PRIVACY_INCIDENT_ID) {
    errors.push('m5-signed-privacy:incident');
  }
  if (DECISION_ACTION.get(payload.disposition) !== payload.completedAction) {
    errors.push('m5-signed-privacy:history-action');
  }
  if (!Object.values(M5_PRIVACY_REPOSITORY_VISIBILITY).includes(payload.repositoryVisibility)) {
    errors.push('m5-signed-privacy:repository-visibility');
  }
  completedAtErrors(receipt, payload, errors);
  if (!SHA.test(payload.postDispositionHeadSha || '')) {
    errors.push('m5-signed-privacy:post-disposition-head');
  }
  for (const [field, label] of [
    ['refCensusSha256', 'ref-census'],
    ['privacyScanSha256', 'privacy-scan'],
  ]) {
    if (!SHA256.test(payload[field] || '')) errors.push(`m5-signed-privacy:${label}-digest`);
    else if (!hasArtifactDigest(receipt, payload[field])) {
      errors.push(`m5-signed-privacy:${label}-artifact-unbound`);
    }
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
