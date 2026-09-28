import {
  SIGNED_AUTHORITY_DOMAIN,
} from '../../contracts/authority/signed-authority-receipt-v1.js';
import {
  M6_ACCEPTANCE_DOMAIN_CHECK,
  M6_ACCEPTANCE_PAYLOAD_CONTRACT,
  M6_ACCEPTANCE_PAYLOAD_VERSION,
  M6_OPERATOR_DEMO_STEPS,
} from '../../contracts/m6/acceptance-authority-v1.js';

const RECEIPT_ID = /^sar1:[a-f0-9]{64}$/u;
const M5_PAYLOAD_KEYS = Object.freeze([
  'contract',
  'historyDisposition',
  'openCriticalHigh',
  'operatorRemediation',
  'privacyHistoryReceiptId',
  'reviewSectionsPassed',
  'rotationsCompleted',
  'technicalReviewVerdict',
  'version',
]);
const M5_PAYLOAD_KEYS_V2 = Object.freeze([
  ...M5_PAYLOAD_KEYS, 'categoriesResolved', 'rotationsNotApplicable',
]);
const REVIEW_PAYLOAD_KEYS = Object.freeze([
  'blockingFindings',
  'contract',
  'sectionsReviewed',
  'verdict',
  'version',
]);
const DEMO_PAYLOAD_KEYS = Object.freeze([
  'contract',
  'stepsPassed',
  'verdict',
  'version',
]);
const GATE0_PAYLOAD_KEYS = Object.freeze([
  'candidateEvidenceVerdict',
  'chain',
  'contract',
  'demoReceiptId',
  'reviewReceiptId',
  'verdict',
  'version',
]);

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

function validatePayload(receipt, errors) {
  const payload = receipt?.payload;
  if (receipt?.domain === SIGNED_AUTHORITY_DOMAIN.M5_ACCEPTANCE) {
    const keys = payload?.version === 2 ? M5_PAYLOAD_KEYS_V2 : M5_PAYLOAD_KEYS;
    if (!exactKeys(payload, keys)) return errors.push('payload:m5:keys');
    if (
      payload.contract !== M6_ACCEPTANCE_PAYLOAD_CONTRACT.M5
      || ![M6_ACCEPTANCE_PAYLOAD_VERSION, 2].includes(payload.version)
    ) errors.push('payload:m5:contract');
    if (payload.reviewSectionsPassed !== 9) errors.push('payload:m5:review-sections');
    if (payload.version === 2) {
      if (payload.categoriesResolved !== 8
        || !Number.isInteger(payload.rotationsCompleted) || payload.rotationsCompleted < 0
        || payload.rotationsCompleted > 8
        || !Number.isInteger(payload.rotationsNotApplicable) || payload.rotationsNotApplicable < 0
        || payload.rotationsNotApplicable > 8
        || payload.rotationsCompleted + payload.rotationsNotApplicable !== 8) {
        errors.push('payload:m5:category-resolutions');
      }
    } else if (payload.rotationsCompleted !== 8) errors.push('payload:m5:rotations');
    if (![
      'rewrite_and_rotate',
      'new_root_and_rotate',
      'retain_and_rotate',
    ].includes(payload.historyDisposition)) errors.push('payload:m5:history');
    if (!RECEIPT_ID.test(payload.privacyHistoryReceiptId || '')) {
      errors.push('payload:m5:privacy-history-receipt');
    }
    if (payload.openCriticalHigh !== 0) errors.push('payload:m5:blockers');
    if (payload.technicalReviewVerdict !== 'REVIEW_PASSED') {
      errors.push('payload:m5:review-verdict');
    }
    if (payload.operatorRemediation !== 'COMPLETE') errors.push('payload:m5:remediation');
    if (receipt.decision !== 'M5_ACCEPTED') errors.push('payload:m5:decision');
    return;
  }
  if (receipt?.domain === SIGNED_AUTHORITY_DOMAIN.M6_INDEPENDENT_REVIEW) {
    if (!exactKeys(payload, REVIEW_PAYLOAD_KEYS)) return errors.push('payload:review:keys');
    if (
      payload.contract !== M6_ACCEPTANCE_PAYLOAD_CONTRACT.REVIEW
      || payload.version !== M6_ACCEPTANCE_PAYLOAD_VERSION
    ) errors.push('payload:review:contract');
    if (payload.sectionsReviewed !== 8) errors.push('payload:review:sections');
    if (payload.blockingFindings !== 0) errors.push('payload:review:blockers');
    if (payload.verdict !== 'REVIEW_PASSED' || receipt.decision !== 'REVIEW_PASSED') {
      errors.push('payload:review:verdict');
    }
    return;
  }
  if (receipt?.domain === SIGNED_AUTHORITY_DOMAIN.M6_OPERATOR_DEMO) {
    if (!exactKeys(payload, DEMO_PAYLOAD_KEYS)) return errors.push('payload:demo:keys');
    if (
      payload.contract !== M6_ACCEPTANCE_PAYLOAD_CONTRACT.DEMO
      || payload.version !== M6_ACCEPTANCE_PAYLOAD_VERSION
    ) errors.push('payload:demo:contract');
    if (JSON.stringify(payload.stepsPassed) !== JSON.stringify(M6_OPERATOR_DEMO_STEPS)) {
      errors.push('payload:demo:steps');
    }
    if (payload.verdict !== 'APPROVED' || receipt.decision !== 'DEMO_APPROVED') {
      errors.push('payload:demo:verdict');
    }
    return;
  }
  if (receipt?.domain === SIGNED_AUTHORITY_DOMAIN.M6_GATE0) {
    if (!exactKeys(payload, GATE0_PAYLOAD_KEYS)) return errors.push('payload:gate0:keys');
    if (
      payload.contract !== M6_ACCEPTANCE_PAYLOAD_CONTRACT.GATE0
      || payload.version !== M6_ACCEPTANCE_PAYLOAD_VERSION
    ) errors.push('payload:gate0:contract');
    if (payload.chain !== 'C-E-R-A') errors.push('payload:gate0:chain');
    if (payload.candidateEvidenceVerdict !== 'PASS') errors.push('payload:gate0:evidence');
    if (!RECEIPT_ID.test(payload.reviewReceiptId || '')) errors.push('payload:gate0:review');
    if (!RECEIPT_ID.test(payload.demoReceiptId || '')) errors.push('payload:gate0:demo');
    if (payload.verdict !== 'APPROVED' || receipt.decision !== 'GATE_0_PASS') {
      errors.push('payload:gate0:verdict');
    }
    return;
  }
  errors.push('receipt:domain');
}

export function validateM6AcceptanceReceipt(receipt, {
  verifier,
  expected = {},
  expectedPreviousReceiptId,
} = {}) {
  const errors = [];
  if (!verifier || typeof verifier.verify !== 'function') {
    errors.push('receipt:verifier');
    return deepFreeze({ valid: false, errors, receipt: null });
  }
  const verified = verifier.verify(receipt, { expected });
  errors.push(...verified.errors);
  if (verified.valid) {
    if (!Object.hasOwn(M6_ACCEPTANCE_DOMAIN_CHECK, receipt.domain)) {
      errors.push('receipt:domain');
    }
    if (
      expectedPreviousReceiptId !== undefined
      && receipt.previousReceiptId !== expectedPreviousReceiptId
    ) errors.push('receipt:previous');
    validatePayload(receipt, errors);
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    receipt: errors.length === 0 ? receipt : null,
  });
}

export function validateM6AcceptanceReceiptRaw(rawReceipt, options = {}) {
  const errors = [];
  if (!options.verifier || typeof options.verifier.verifyRaw !== 'function') {
    return deepFreeze({ valid: false, errors: ['receipt:verifier'], receipt: null });
  }
  const verified = options.verifier.verifyRaw(rawReceipt, {
    expected: options.expected || {},
    seenNonceKeys: options.seenNonceKeys,
  });
  errors.push(...verified.errors);
  if (verified.valid) {
    const semantic = validateM6AcceptanceReceipt(verified.receipt, options);
    errors.push(...semantic.errors);
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    receipt: errors.length === 0 ? verified.receipt : null,
  });
}

function releaseArtifact(binding) {
  return Object.freeze({
    path: binding.path,
    bytes: binding.bytes,
    sha256: binding.sha256.slice('sha256:'.length),
  });
}

export function applyM6AcceptanceReceipts(releaseEvidence, rawReceipts, {
  verifier,
  expected = {},
  privacyHistoryReceiptId = null,
} = {}) {
  const inputs = rawReceipts || [];
  if (inputs.length === 0) {
    return deepFreeze({
      valid: true,
      errors: [],
      evidence: structuredClone(releaseEvidence),
      receipts: [],
    });
  }
  const errors = [];
  if (inputs.length !== 4) errors.push('receipt:set-incomplete');
  const expectedDomains = [
    SIGNED_AUTHORITY_DOMAIN.M5_ACCEPTANCE,
    SIGNED_AUTHORITY_DOMAIN.M6_INDEPENDENT_REVIEW,
    SIGNED_AUTHORITY_DOMAIN.M6_OPERATOR_DEMO,
    SIGNED_AUTHORITY_DOMAIN.M6_GATE0,
  ];
  const receipts = [];
  const seenNonceKeys = new Set();
  let previousReceiptId = privacyHistoryReceiptId;
  for (const [index, rawReceipt] of inputs.entries()) {
    const result = validateM6AcceptanceReceiptRaw(rawReceipt, {
      verifier,
      expected,
      expectedPreviousReceiptId: previousReceiptId,
      seenNonceKeys,
    });
    errors.push(...result.errors.map(error => `receipt[${index}]:${error}`));
    if (!result.valid) continue;
    if (result.receipt.domain !== expectedDomains[index]) {
      errors.push(`receipt[${index}]:order`);
    }
    receipts.push(result.receipt);
    seenNonceKeys.add(result.receipt.nonce);
    previousReceiptId = result.receipt.receiptId;
  }
  const [m5, review, demo, gate0] = receipts;
  if (m5?.payload.version === 2) errors.push('m5:verified-category-bundle-required');
  if (m5 && m5.payload.privacyHistoryReceiptId !== privacyHistoryReceiptId) {
    errors.push('m5:privacy-history-binding');
  }
  if (gate0) {
    if (!review || gate0.payload.reviewReceiptId !== review.receiptId) {
      errors.push('gate0:review-receipt-binding');
    }
    if (!demo || gate0.payload.demoReceiptId !== demo.receiptId) {
      errors.push('gate0:demo-receipt-binding');
    }
  }
  if (errors.length > 0) {
    return deepFreeze({ valid: false, errors, evidence: null, receipts: null });
  }
  const evidence = structuredClone(releaseEvidence);
  for (const receipt of receipts) {
    const checkId = M6_ACCEPTANCE_DOMAIN_CHECK[receipt.domain];
    const row = evidence.checks?.find(item => item.id === checkId);
    if (!row) {
      errors.push(`receipt:missing-release-row:${checkId}`);
      continue;
    }
    row.status = 'PASS';
    row.reasonCode = null;
    row.artifacts = receipt.artifacts.map(releaseArtifact);
  }
  return deepFreeze({
    valid: errors.length === 0,
    errors,
    evidence: errors.length === 0 ? evidence : null,
    receipts: errors.length === 0 ? receipts : null,
  });
}
