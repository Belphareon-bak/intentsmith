import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';

import {
  SIGNED_AUTHORITY_ALGORITHM,
  SIGNED_AUTHORITY_DOMAIN,
  SIGNED_AUTHORITY_RECEIPT_CONTRACT,
  SIGNED_AUTHORITY_ROLE,
  canonicalizeSignedAuthorityValue,
  computeSignedAuthorityReceiptId,
  signedAuthoritySigningBytes,
} from '../contracts/authority/signed-authority-receipt-v1.js';
import {
  M6_ACCEPTANCE_PAYLOAD_CONTRACT,
  M6_OPERATOR_DEMO_STEPS,
} from '../contracts/m6/acceptance-authority-v1.js';
import {
  applyM6AcceptanceReceipts,
  validateM6AcceptanceReceiptRaw,
} from '../src/release/m6-acceptance-authority.js';
import {
  createSignedAuthorityVerifier,
  signedAuthorityKeyId,
} from '../src/security/signed-authority-verifier.js';
import { suite, summary, test } from './harness.js';

const expected = Object.freeze({
  productCandidateSha: 'a'.repeat(40),
  productCandidateTree: 'b'.repeat(40),
  evidenceHeadSha: 'c'.repeat(40),
  registryFingerprint: 'd'.repeat(64),
  releaseEvidenceIndexSha256: `sha256:${'e'.repeat(64)}`,
  artifactManifestSha256: `sha256:${'f'.repeat(64)}`,
});
const privacyHistoryReceiptId = `sar1:${'0'.repeat(64)}`;

function fixtureKey(authorityId) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const der = publicKey.export({ format: 'der', type: 'spki' });
  return {
    authorityId,
    privateKey,
    trust: {
      algorithm: SIGNED_AUTHORITY_ALGORITHM,
      authorityId,
      keyId: signedAuthorityKeyId(publicKey),
      publicKeySpkiDerBase64url: der.toString('base64url'),
      status: 'ACTIVE',
    },
  };
}

const acceptanceKey = fixtureKey(SIGNED_AUTHORITY_ROLE.M5_ACCEPTANCE_OPERATOR);
const reviewKey = fixtureKey(SIGNED_AUTHORITY_ROLE.M6_INDEPENDENT_REVIEWER);
const releaseKey = fixtureKey(SIGNED_AUTHORITY_ROLE.M6_RELEASE_OPERATOR);
const verifier = createSignedAuthorityVerifier({
  trustStore: {
    contract: 'SignedAuthorityTrustStore',
    version: 1,
    algorithm: SIGNED_AUTHORITY_ALGORITHM,
    keys: [acceptanceKey.trust, reviewKey.trust, releaseKey.trust],
  },
});

const definitions = Object.freeze({
  'm5-acceptance': {
    key: acceptanceKey,
    domain: SIGNED_AUTHORITY_DOMAIN.M5_ACCEPTANCE,
    decision: 'M5_ACCEPTED',
    payload: {
      contract: M6_ACCEPTANCE_PAYLOAD_CONTRACT.M5,
      version: 1,
      reviewSectionsPassed: 9,
      rotationsCompleted: 8,
      historyDisposition: 'rewrite_and_rotate',
      privacyHistoryReceiptId,
      openCriticalHigh: 0,
      technicalReviewVerdict: 'REVIEW_PASSED',
      operatorRemediation: 'COMPLETE',
    },
  },
  'independent-read-only-review': {
    key: reviewKey,
    domain: SIGNED_AUTHORITY_DOMAIN.M6_INDEPENDENT_REVIEW,
    decision: 'REVIEW_PASSED',
    payload: {
      contract: M6_ACCEPTANCE_PAYLOAD_CONTRACT.REVIEW,
      version: 1,
      sectionsReviewed: 8,
      blockingFindings: 0,
      verdict: 'REVIEW_PASSED',
    },
  },
  'operator-demo-approval': {
    key: releaseKey,
    domain: SIGNED_AUTHORITY_DOMAIN.M6_OPERATOR_DEMO,
    decision: 'DEMO_APPROVED',
    payload: {
      contract: M6_ACCEPTANCE_PAYLOAD_CONTRACT.DEMO,
      version: 1,
      stepsPassed: [...M6_OPERATOR_DEMO_STEPS],
      verdict: 'APPROVED',
    },
  },
  'gate0-attestation': {
    key: releaseKey,
    domain: SIGNED_AUTHORITY_DOMAIN.M6_GATE0,
    decision: 'GATE_0_PASS',
    payload: {
      contract: M6_ACCEPTANCE_PAYLOAD_CONTRACT.GATE0,
      version: 1,
      chain: 'C-E-R-A',
      candidateEvidenceVerdict: 'PASS',
      reviewReceiptId: null,
      demoReceiptId: null,
      verdict: 'APPROVED',
    },
  },
});

function signedReceipt(checkId, previousReceiptId, index, payloadOverrides = {}) {
  const definition = definitions[checkId];
  const receipt = {
    contract: SIGNED_AUTHORITY_RECEIPT_CONTRACT,
    version: 1,
    algorithm: SIGNED_AUTHORITY_ALGORITHM,
    domain: definition.domain,
    authorityId: definition.key.authorityId,
    keyId: definition.key.trust.keyId,
    ...expected,
    artifacts: [{
      path: `docs/review/${checkId}.md`,
      bytes: 100 + index,
      gitMode: '100644',
      sha256: `sha256:${String(index + 1).repeat(64)}`,
    }],
    decision: definition.decision,
    issuedAtMs: 1_800_000_000_000 + index,
    nonce: Buffer.alloc(16, index + 10).toString('base64url'),
    previousReceiptId,
    actor: { actorType: 'user', actorId: `fixture:${definition.key.authorityId}` },
    payload: { ...definition.payload, ...payloadOverrides },
  };
  receipt.signature = sign(
    null,
    signedAuthoritySigningBytes(receipt),
    definition.key.privateKey,
  ).toString('base64url');
  receipt.receiptId = computeSignedAuthorityReceiptId(receipt);
  return receipt;
}

function chain(m5Payload = {}) {
  const m5 = signedReceipt('m5-acceptance', privacyHistoryReceiptId, 0, m5Payload);
  const review = signedReceipt('independent-read-only-review', m5.receiptId, 1);
  const demo = signedReceipt('operator-demo-approval', review.receiptId, 2);
  const gate0 = signedReceipt('gate0-attestation', demo.receiptId, 3, {
    reviewReceiptId: review.receiptId,
    demoReceiptId: demo.receiptId,
  });
  return [m5, review, demo, gate0];
}

function raw(receipt) {
  return `${canonicalizeSignedAuthorityValue(receipt)}\n`;
}

function releaseEvidence() {
  return {
    candidateSha: expected.productCandidateSha,
    registryFingerprint: expected.registryFingerprint,
    checks: [
      'm5-acceptance',
      'independent-read-only-review',
      'operator-demo-approval',
      'gate0-attestation',
    ].map(id => ({ id, status: 'BLOCKED', reasonCode: 'PENDING', artifacts: [] })),
  };
}

suite('M6 offline signed acceptance authority');

test('four exact signed role receipts promote all external authority rows', () => {
  const receipts = chain();
  let previous = privacyHistoryReceiptId;
  for (const receipt of receipts) {
    const result = validateM6AcceptanceReceiptRaw(raw(receipt), {
      verifier,
      expected,
      expectedPreviousReceiptId: previous,
    });
    assert.equal(result.valid, true, result.errors.join('\n'));
    previous = receipt.receiptId;
  }
  const result = applyM6AcceptanceReceipts(releaseEvidence(), receipts.map(raw), {
    verifier,
    expected,
    privacyHistoryReceiptId,
  });
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert(result.evidence.checks.every(row => row.status === 'PASS'));
  assert.equal(Object.isFrozen(result), true);
});

test('M5 v2 validates truthful category counts but cannot promote without the full category bundle', () => {
  const payload = { version: 2, categoriesResolved: 8, rotationsCompleted: 6, rotationsNotApplicable: 2 };
  const receipt = signedReceipt('m5-acceptance', privacyHistoryReceiptId, 0, payload);
  assert.equal(validateM6AcceptanceReceiptRaw(raw(receipt), { verifier, expected }).valid, true);
  for (const overrides of [
    { categoriesResolved: 7 }, { rotationsCompleted: 8 }, { rotationsNotApplicable: -1 },
    { rotationsNotApplicable: '2' }, { version: 3 }, { version: 1 },
  ]) {
    const invalid = signedReceipt('m5-acceptance', privacyHistoryReceiptId, 0, { ...payload, ...overrides });
    assert.equal(validateM6AcceptanceReceiptRaw(raw(invalid), { verifier, expected }).valid, false);
  }
  assert.throws(() => signedReceipt('m5-acceptance', privacyHistoryReceiptId, 0, {
    ...payload, rotationsCompleted: 6.5, rotationsNotApplicable: 1.5,
  }), /canonical-number-invalid/);
  const receipts = chain(payload);
  const result = applyM6AcceptanceReceipts(releaseEvidence(), receipts.map(raw), {
    verifier, expected, privacyHistoryReceiptId,
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ['m5:verified-category-bundle-required']);
  assert.equal(result.evidence, null);
});

test('wrong key, changed byte, stale candidate and unsigned legacy receipt fail closed', () => {
  const receipt = chain()[1];
  const changed = raw(receipt).replace('"blockingFindings":0', '"blockingFindings":1');
  assert.equal(validateM6AcceptanceReceiptRaw(changed, { verifier, expected }).valid, false);

  const staleExpected = { ...expected, productCandidateSha: '9'.repeat(40) };
  assert.equal(validateM6AcceptanceReceiptRaw(raw(receipt), {
    verifier,
    expected: staleExpected,
  }).valid, false);

  const wrongRole = structuredClone(receipt);
  wrongRole.authorityId = SIGNED_AUTHORITY_ROLE.M6_RELEASE_OPERATOR;
  assert.equal(validateM6AcceptanceReceiptRaw(raw(wrongRole), { verifier, expected }).valid, false);
  assert.equal(validateM6AcceptanceReceiptRaw(JSON.stringify({
    contract: 'M6AcceptanceReceipt',
    source: 'operator-provided',
    decision: 'PASS',
  }), { verifier, expected }).valid, false);
});

test('review blocker and incomplete operator journey cannot pass', () => {
  const receipts = chain();
  const blockedReview = signedReceipt(
    'independent-read-only-review',
    receipts[0].receiptId,
    1,
    { blockingFindings: 1 },
  );
  assert.equal(validateM6AcceptanceReceiptRaw(raw(blockedReview), {
    verifier,
    expected,
  }).valid, false);
  const incompleteDemo = signedReceipt(
    'operator-demo-approval',
    receipts[1].receiptId,
    2,
    { stepsPassed: M6_OPERATOR_DEMO_STEPS.slice(0, -1) },
  );
  assert.equal(validateM6AcceptanceReceiptRaw(raw(incompleteDemo), {
    verifier,
    expected,
  }).valid, false);
});

test('Gate 0 binds exact privacy history, independent review and demo receipt identities', () => {
  const receipts = chain();
  const wrongPrivacy = applyM6AcceptanceReceipts(releaseEvidence(), receipts.map(raw), {
    verifier,
    expected,
    privacyHistoryReceiptId: `sar1:${'9'.repeat(64)}`,
  });
  assert.equal(wrongPrivacy.valid, false);

  const wrongGate = signedReceipt('gate0-attestation', receipts[2].receiptId, 3, {
    reviewReceiptId: `sar1:${'8'.repeat(64)}`,
    demoReceiptId: receipts[2].receiptId,
  });
  const invalid = applyM6AcceptanceReceipts(
    releaseEvidence(),
    [...receipts.slice(0, 3), wrongGate].map(raw),
    { verifier, expected, privacyHistoryReceiptId },
  );
  assert.equal(invalid.valid, false);
  assert(invalid.errors.includes('gate0:review-receipt-binding'));
});

test('empty set remains blocked while partial, duplicate nonce and broken chain fail', () => {
  const empty = applyM6AcceptanceReceipts(releaseEvidence(), [], {
    verifier,
    expected,
    privacyHistoryReceiptId,
  });
  assert.equal(empty.valid, true);
  assert(empty.evidence.checks.every(row => row.status === 'BLOCKED'));

  const receipts = chain();
  assert.equal(applyM6AcceptanceReceipts(releaseEvidence(), receipts.slice(0, 2).map(raw), {
    verifier,
    expected,
    privacyHistoryReceiptId,
  }).valid, false);
  receipts[2].nonce = receipts[1].nonce;
  receipts[2].signature = sign(
    null,
    signedAuthoritySigningBytes(receipts[2]),
    releaseKey.privateKey,
  ).toString('base64url');
  receipts[2].receiptId = computeSignedAuthorityReceiptId(receipts[2]);
  assert.equal(applyM6AcceptanceReceipts(releaseEvidence(), receipts.map(raw), {
    verifier,
    expected,
    privacyHistoryReceiptId,
  }).valid, false);
});

summary();
