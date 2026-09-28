import {
  SIGNED_AUTHORITY_DOMAIN,
  SIGNED_AUTHORITY_ROLE,
  validateSignedAuthorityReceiptShape,
} from '../authority/signed-authority-receipt-v1.js';
import {
  M5_PRIVACY_INCIDENT_ID,
  expectedM5PrivacyAuthorityKind,
} from './privacy-remediation-v1.js';
import { validateSignedM5PrivacyRotationReceipt } from './signed-privacy-receipts-v1.js';

export const M5_PRIVACY_NON_APPLICABILITY_CONTRACT = 'M5PrivacyNonApplicabilityEvidence';
export const M5_PRIVACY_NON_APPLICABILITY_DECISION = 'ROTATION_NOT_APPLICABLE';
export const M5_PRIVACY_NON_APPLICABILITY_REASON = Object.freeze({
  NEVER_EXISTED: 'NEVER_EXISTED_IN_EXPOSURE_SCOPE',
  AUTHORITY_ENDED: 'NO_AUTHORITY_REMAINS',
  FIXTURE_NOT_REUSED: 'FIXTURE_NOT_REUSED',
});

const COMMON_KEYS = Object.freeze([
  'contract', 'version', 'incidentId', 'categoryId', 'authorityKind',
  'assessmentCompleted', 'assessedAtMs', 'assessmentScope',
  'historicalExposureReviewed', 'remainingLocalAuthority', 'remainingExternalAuthority',
  'reason', 'assessmentEvidenceSha256', 'secretMaterialIncluded',
]);
const AUTHORITY_END_KEYS = Object.freeze([
  'authorityEndedAtMs', 'authorityEndKind', 'authorityEndScope', 'authorityEndEvidenceSha256',
]);
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function evidenceErrors(receipt, value, label, errors) {
  if (!SHA256.test(value || '')) errors.push(`m5-non-applicable:${label}-digest`);
  else if (!Array.isArray(receipt?.artifacts)
    || !receipt.artifacts.some(artifact => artifact?.sha256 === value)) {
    errors.push(`m5-non-applicable:${label}-artifact-unbound`);
  }
}

export function validateSignedM5PrivacyNonApplicabilityReceipt(receipt) {
  const errors = [...validateSignedAuthorityReceiptShape(receipt).errors];
  if (receipt?.domain !== SIGNED_AUTHORITY_DOMAIN.M5_PRIVACY_ROTATION) {
    errors.push('m5-non-applicable:domain');
  }
  if (receipt?.authorityId !== SIGNED_AUTHORITY_ROLE.M5_PRIVACY_OPERATOR) {
    errors.push('m5-non-applicable:authority');
  }
  if (receipt?.decision !== M5_PRIVACY_NON_APPLICABILITY_DECISION) {
    errors.push('m5-non-applicable:decision');
  }
  const payload = receipt?.payload;
  const extraKeys = payload?.reason === M5_PRIVACY_NON_APPLICABILITY_REASON.AUTHORITY_ENDED
    ? AUTHORITY_END_KEYS
    : payload?.reason === M5_PRIVACY_NON_APPLICABILITY_REASON.FIXTURE_NOT_REUSED
      ? ['fixtureReusedOutsideTests'] : [];
  if (!exactKeys(payload, [...COMMON_KEYS, ...extraKeys])) {
    errors.push('m5-non-applicable:payload-keys');
    return Object.freeze({ valid: false, errors: Object.freeze(errors) });
  }
  if (payload.contract !== M5_PRIVACY_NON_APPLICABILITY_CONTRACT || payload.version !== 1) {
    errors.push('m5-non-applicable:contract');
  }
  if (payload.incidentId !== M5_PRIVACY_INCIDENT_ID) errors.push('m5-non-applicable:incident');
  const authority = expectedM5PrivacyAuthorityKind(payload.categoryId);
  if (authority === null || payload.authorityKind !== authority) {
    errors.push('m5-non-applicable:category-authority');
  }
  if (payload.assessmentCompleted !== true
    || payload.historicalExposureReviewed !== true
    || payload.assessmentScope !== 'HISTORICAL_EXPOSURE_AND_CURRENT_AUTHORITY') {
    errors.push('m5-non-applicable:assessment');
  }
  if (!Number.isSafeInteger(payload.assessedAtMs) || payload.assessedAtMs < 1
    || !Number.isSafeInteger(receipt?.issuedAtMs) || payload.assessedAtMs > receipt.issuedAtMs) {
    errors.push('m5-non-applicable:assessed-at');
  }
  if (payload.remainingLocalAuthority !== false || payload.remainingExternalAuthority !== false) {
    errors.push('m5-non-applicable:authority-remains');
  }
  if (payload.secretMaterialIncluded !== false) errors.push('m5-non-applicable:secret-material');
  if (!Object.values(M5_PRIVACY_NON_APPLICABILITY_REASON).includes(payload.reason)) {
    errors.push('m5-non-applicable:reason');
  }
  evidenceErrors(receipt, payload.assessmentEvidenceSha256, 'assessment', errors);
  if (payload.reason === M5_PRIVACY_NON_APPLICABILITY_REASON.FIXTURE_NOT_REUSED) {
    if (payload.categoryId !== 'fixture-password-reuse' || payload.fixtureReusedOutsideTests !== false) {
      errors.push('m5-non-applicable:fixture-reuse');
    }
  }
  if (payload.reason === M5_PRIVACY_NON_APPLICABILITY_REASON.AUTHORITY_ENDED) {
    if (!['REVOCATION', 'EXPIRY', 'DECOMMISSION'].includes(payload.authorityEndKind)
      || payload.authorityEndScope !== 'ALL_EXPOSED_CREDENTIALS_AND_REUSE') {
      errors.push('m5-non-applicable:authority-end-scope');
    }
    if (!Number.isSafeInteger(payload.authorityEndedAtMs) || payload.authorityEndedAtMs < 1
      || payload.authorityEndedAtMs > payload.assessedAtMs) {
      errors.push('m5-non-applicable:authority-ended-at');
    }
    evidenceErrors(receipt, payload.authorityEndEvidenceSha256, 'authority-end', errors);
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function validateSignedM5PrivacyCategoryReceipt(receipt) {
  return receipt?.decision === M5_PRIVACY_NON_APPLICABILITY_DECISION
    ? validateSignedM5PrivacyNonApplicabilityReceipt(receipt)
    : validateSignedM5PrivacyRotationReceipt(receipt);
}
