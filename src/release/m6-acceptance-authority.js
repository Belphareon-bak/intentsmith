import {
  M6_ACCEPTANCE_RECEIPT_CONTRACT,
  M6_ACCEPTANCE_RECEIPT_VERSION,
  M6_EXTERNAL_AUTHORITY_IDS,
  M6_OPERATOR_DEMO_STEPS,
} from '../../contracts/m6/acceptance-authority-v1.js';

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const RECEIPT_KEYS = Object.freeze([
  'actor',
  'artifacts',
  'authorityId',
  'candidateSha',
  'contract',
  'decision',
  'details',
  'recordedAt',
  'registryFingerprint',
  'source',
  'version',
]);
const ACTOR_KEYS = Object.freeze(['actorId', 'actorType']);
const ARTIFACT_KEYS = Object.freeze(['bytes', 'path', 'sha256']);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function exactKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function safePath(value) {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('\\')
    && !value.includes('\0')
    && !value.startsWith('/')
    && value !== '..'
    && !value.startsWith('../')
    && !value.includes('/../');
}

function validArtifact(value) {
  return exactKeys(value, ARTIFACT_KEYS)
    && safePath(value.path)
    && Number.isSafeInteger(value.bytes)
    && value.bytes > 0
    && SHA256_PATTERN.test(value.sha256 || '');
}

function validateDetails(authorityId, details, errors) {
  if (authorityId === 'm5-acceptance') {
    const keys = [
      'historyDisposition',
      'openCriticalHigh',
      'operatorRemediation',
      'reviewSectionsPassed',
      'rotationsCompleted',
      'technicalReviewVerdict',
    ];
    if (!exactKeys(details, keys)) return errors.push('details:m5:keys');
    if (details.reviewSectionsPassed !== 9) errors.push('details:m5:review-sections');
    if (details.rotationsCompleted !== 8) errors.push('details:m5:rotations');
    if (![
      'rewrite_and_rotate',
      'new_root_and_rotate',
      'retain_and_rotate',
    ].includes(details.historyDisposition)) errors.push('details:m5:history');
    if (details.openCriticalHigh !== 0) errors.push('details:m5:blockers');
    if (details.technicalReviewVerdict !== 'REVIEW_PASSED') {
      errors.push('details:m5:review-verdict');
    }
    if (details.operatorRemediation !== 'COMPLETE') errors.push('details:m5:remediation');
    return;
  }
  if (authorityId === 'independent-read-only-review') {
    const keys = ['blockingFindings', 'sectionsReviewed', 'verdict'];
    if (!exactKeys(details, keys)) return errors.push('details:review:keys');
    if (details.sectionsReviewed !== 8) errors.push('details:review:sections');
    if (details.blockingFindings !== 0) errors.push('details:review:blockers');
    if (details.verdict !== 'REVIEW_PASSED') errors.push('details:review:verdict');
    return;
  }
  if (authorityId === 'operator-demo-approval') {
    const keys = ['stepsPassed', 'verdict'];
    if (!exactKeys(details, keys)) return errors.push('details:demo:keys');
    if (JSON.stringify(details.stepsPassed) !== JSON.stringify(M6_OPERATOR_DEMO_STEPS)) {
      errors.push('details:demo:steps');
    }
    if (details.verdict !== 'APPROVED') errors.push('details:demo:verdict');
    return;
  }
  if (authorityId === 'gate0-attestation') {
    const keys = [
      'approvalArtifactSha256',
      'candidateEvidenceVerdict',
      'chain',
      'reviewArtifactSha256',
      'verdict',
    ];
    if (!exactKeys(details, keys)) return errors.push('details:gate0:keys');
    if (details.chain !== 'C-E-R-A') errors.push('details:gate0:chain');
    if (details.candidateEvidenceVerdict !== 'PASS') errors.push('details:gate0:evidence');
    if (!SHA256_PATTERN.test(details.reviewArtifactSha256 || '')) {
      errors.push('details:gate0:review-artifact');
    }
    if (!SHA256_PATTERN.test(details.approvalArtifactSha256 || '')) {
      errors.push('details:gate0:approval-artifact');
    }
    if (details.verdict !== 'APPROVED') errors.push('details:gate0:verdict');
  }
}

export function validateM6AcceptanceReceipt(receipt, {
  candidateSha,
  registryFingerprint,
} = {}) {
  const errors = [];
  if (!exactKeys(receipt, RECEIPT_KEYS)) {
    errors.push('receipt:keys');
    return deepFreeze({ valid: false, errors });
  }
  if (receipt.contract !== M6_ACCEPTANCE_RECEIPT_CONTRACT) errors.push('receipt:contract');
  if (receipt.version !== M6_ACCEPTANCE_RECEIPT_VERSION) errors.push('receipt:version');
  if (!M6_EXTERNAL_AUTHORITY_IDS.includes(receipt.authorityId)) errors.push('receipt:authority');
  if (!SHA_PATTERN.test(receipt.candidateSha || '') || receipt.candidateSha !== candidateSha) {
    errors.push('receipt:candidate');
  }
  if (
    !SHA256_PATTERN.test(receipt.registryFingerprint || '')
    || receipt.registryFingerprint !== registryFingerprint
  ) errors.push('receipt:registry');
  if (!Number.isFinite(Date.parse(receipt.recordedAt))) errors.push('receipt:recordedAt');
  if (receipt.source !== 'operator-provided') errors.push('receipt:source');
  if (receipt.decision !== 'PASS') errors.push('receipt:decision');
  if (!exactKeys(receipt.actor, ACTOR_KEYS)) errors.push('receipt:actor-keys');
  else {
    if (receipt.actor.actorType !== 'user') errors.push('receipt:actor-type');
    if (
      typeof receipt.actor.actorId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9_.:@-]{1,127}$/u.test(receipt.actor.actorId)
    ) errors.push('receipt:actor-id');
  }
  if (!Array.isArray(receipt.artifacts) || receipt.artifacts.length === 0) {
    errors.push('receipt:artifacts');
  } else if (receipt.artifacts.some(item => !validArtifact(item))) {
    errors.push('receipt:artifact-shape');
  }
  validateDetails(receipt.authorityId, receipt.details, errors);
  return deepFreeze({ valid: errors.length === 0, errors });
}

export function applyM6AcceptanceReceipts(releaseEvidence, receipts) {
  const errors = [];
  const byId = new Map();
  for (const receipt of receipts || []) {
    const validation = validateM6AcceptanceReceipt(receipt, {
      candidateSha: releaseEvidence?.candidateSha,
      registryFingerprint: releaseEvidence?.registryFingerprint,
    });
    if (!validation.valid) {
      errors.push(...validation.errors.map(error => `${receipt?.authorityId || 'unknown'}:${error}`));
      continue;
    }
    if (byId.has(receipt.authorityId)) errors.push(`receipt:duplicate:${receipt.authorityId}`);
    byId.set(receipt.authorityId, receipt);
  }
  const gate0 = byId.get('gate0-attestation');
  const review = byId.get('independent-read-only-review');
  const demo = byId.get('operator-demo-approval');
  if (gate0) {
    if (!review || !review.artifacts.some(item => (
      item.sha256 === gate0.details.reviewArtifactSha256
    ))) errors.push('gate0:review-receipt-binding');
    if (!demo || !demo.artifacts.some(item => (
      item.sha256 === gate0.details.approvalArtifactSha256
    ))) errors.push('gate0:approval-receipt-binding');
  }
  if (errors.length > 0) return deepFreeze({ valid: false, errors, evidence: null });
  const evidence = structuredClone(releaseEvidence);
  for (const [authorityId, receipt] of byId) {
    const row = evidence.checks?.find(item => item.id === authorityId);
    if (!row) {
      errors.push(`receipt:missing-release-row:${authorityId}`);
      continue;
    }
    row.status = 'PASS';
    row.reasonCode = null;
    row.artifacts = receipt.artifacts.map(item => ({ ...item }));
  }
  return deepFreeze({ valid: errors.length === 0, errors, evidence });
}

