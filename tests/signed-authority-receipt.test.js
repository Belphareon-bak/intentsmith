#!/usr/bin/env node

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
  createSignedAuthorityVerifier,
  signedAuthorityKeyId,
  validateSignedAuthorityTrustStore,
  verifySignedAuthorityReceiptSet,
} from '../src/security/signed-authority-verifier.js';
import { suite, summary, test } from './harness.js';

const candidateSha = 'a'.repeat(40);
const candidateTree = 'b'.repeat(40);
const evidenceHeadSha = 'c'.repeat(40);
const registryFingerprint = 'd'.repeat(64);
const releaseEvidenceIndexSha256 = `sha256:${'e'.repeat(64)}`;
const artifactManifestSha256 = `sha256:${'f'.repeat(64)}`;

function fixtureKey(authorityId, status = 'ACTIVE') {
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
      status,
    },
  };
}

const privacyKey = fixtureKey(SIGNED_AUTHORITY_ROLE.M5_PRIVACY_OPERATOR);
const acceptanceKey = fixtureKey(SIGNED_AUTHORITY_ROLE.M5_ACCEPTANCE_OPERATOR);
const reviewKey = fixtureKey(SIGNED_AUTHORITY_ROLE.M6_INDEPENDENT_REVIEWER);
const releaseKey = fixtureKey(SIGNED_AUTHORITY_ROLE.M6_RELEASE_OPERATOR);

function trustStore(keys = [privacyKey, acceptanceKey, reviewKey, releaseKey]) {
  return {
    contract: 'SignedAuthorityTrustStore',
    version: 1,
    algorithm: SIGNED_AUTHORITY_ALGORITHM,
    keys: keys.map(key => ({ ...key.trust })),
  };
}

function unsignedCore(key = reviewKey, overrides = {}) {
  return {
    contract: SIGNED_AUTHORITY_RECEIPT_CONTRACT,
    version: 1,
    algorithm: SIGNED_AUTHORITY_ALGORITHM,
    domain: SIGNED_AUTHORITY_DOMAIN.M6_INDEPENDENT_REVIEW,
    authorityId: key.authorityId,
    keyId: key.trust.keyId,
    productCandidateSha: candidateSha,
    productCandidateTree: candidateTree,
    evidenceHeadSha,
    registryFingerprint,
    releaseEvidenceIndexSha256,
    artifactManifestSha256,
    artifacts: [{
      path: 'docs/review/M6-INDEPENDENT-REVIEW-RESULT.json',
      bytes: 123,
      gitMode: '100644',
      sha256: `sha256:${'1'.repeat(64)}`,
    }],
    decision: 'REVIEW_PASSED',
    issuedAtMs: 1_800_000_000_000,
    nonce: Buffer.alloc(16, 7).toString('base64url'),
    previousReceiptId: null,
    actor: { actorType: 'user', actorId: 'reviewer:fixture' },
    payload: { blockingFindings: 0, sectionsReviewed: 8 },
    ...overrides,
  };
}

function signedReceipt(key = reviewKey, overrides = {}) {
  const value = unsignedCore(key, overrides);
  value.signature = sign(null, signedAuthoritySigningBytes(value), key.privateKey)
    .toString('base64url');
  value.receiptId = computeSignedAuthorityReceiptId(value);
  return value;
}

function expected() {
  return {
    productCandidateSha: candidateSha,
    productCandidateTree: candidateTree,
    evidenceHeadSha,
    registryFingerprint,
    releaseEvidenceIndexSha256,
    artifactManifestSha256,
  };
}

suite('SignedAuthorityReceipt@1 offline Ed25519 verifier');

test('Git-pinned trust store accepts four separate role keys', () => {
  const validation = validateSignedAuthorityTrustStore(trustStore());
  assert.equal(validation.valid, true, validation.errors.join('\n'));
  assert.equal(new Set(validation.keys.map(key => key.keyId)).size, 4);

  const universalKey = {
    ...reviewKey,
    trust: {
      ...reviewKey.trust,
      authorityId: SIGNED_AUTHORITY_ROLE.M6_RELEASE_OPERATOR,
    },
  };
  const reused = validateSignedAuthorityTrustStore(trustStore([reviewKey, universalKey]));
  assert.equal(reused.valid, false);
  assert(reused.errors.some(error => error.includes('key-reused-across-roles')));
});

test('exact canonical Ed25519 receipt verifies with all semantic bindings', () => {
  const verifier = createSignedAuthorityVerifier({ trustStore: trustStore() });
  const receipt = signedReceipt();
  assert.equal(verifier.verify(receipt, { expected: expected() }).valid, true);
  const raw = `${canonicalizeSignedAuthorityValue(receipt)}\n`;
  assert.equal(verifier.verifyRaw(raw, { expected: expected() }).valid, true);
  assert.equal(verifier.verifyRaw(JSON.stringify(receipt), { expected: expected() }).valid, false);
});

test('wrong key, changed byte, cross-role replay and wrong binding fail closed', () => {
  const verifier = createSignedAuthorityVerifier({ trustStore: trustStore() });
  const wrongKey = signedReceipt(acceptanceKey, {
    domain: SIGNED_AUTHORITY_DOMAIN.M6_INDEPENDENT_REVIEW,
    authorityId: SIGNED_AUTHORITY_ROLE.M6_INDEPENDENT_REVIEWER,
  });
  const changed = structuredClone(signedReceipt());
  changed.payload.blockingFindings = 1;
  const crossRole = structuredClone(signedReceipt());
  crossRole.domain = SIGNED_AUTHORITY_DOMAIN.M6_OPERATOR_DEMO;
  const wrongCandidate = { ...expected(), productCandidateSha: '9'.repeat(40) };
  for (const [receipt, bindings] of [
    [wrongKey, expected()],
    [changed, expected()],
    [crossRole, expected()],
    [signedReceipt(), wrongCandidate],
    [signedReceipt(), { ...expected(), evidenceHeadSha: '8'.repeat(40) }],
  ]) assert.equal(verifier.verify(receipt, { expected: bindings }).valid, false);

  const raw = `${canonicalizeSignedAuthorityValue(signedReceipt())}\n`;
  const changedByte = raw.replace('"blockingFindings":0', '"blockingFindings":1');
  assert.equal(Buffer.byteLength(changedByte), Buffer.byteLength(raw));
  assert.equal(verifier.verifyRaw(changedByte, { expected: expected() }).valid, false);

  const replacementReceipt = signedReceipt(reviewKey, {
    payload: { blockingFindings: 0, sectionsReviewed: 8, note: '\uFFFD' },
  });
  const replacementRaw = Buffer.from(
    `${canonicalizeSignedAuthorityValue(replacementReceipt)}\n`,
    'utf8',
  );
  const replacementOffset = replacementRaw.indexOf(Buffer.from([0xef, 0xbf, 0xbd]));
  assert.notEqual(replacementOffset, -1);
  const invalidUtf8Mutation = Buffer.from(replacementRaw);
  invalidUtf8Mutation[replacementOffset] = 0xf0;
  assert.equal(replacementRaw.equals(invalidUtf8Mutation), false);
  const invalidUtf8 = verifier.verifyRaw(invalidUtf8Mutation, { expected: expected() });
  assert.equal(invalidUtf8.valid, false);
  assert(invalidUtf8.errors.includes('raw:utf8'));
});

test('duplicate nonce and broken previous-receipt chain fail closed', () => {
  const verifier = createSignedAuthorityVerifier({ trustStore: trustStore() });
  const first = signedReceipt();
  const duplicateNonce = signedReceipt(reviewKey, { previousReceiptId: first.receiptId });
  const duplicate = verifySignedAuthorityReceiptSet(verifier, [first, duplicateNonce], {
    expected: expected(),
    requireLinearChain: true,
  });
  assert.equal(duplicate.valid, false);
  assert(duplicate.errors.some(error => error.includes('replay:nonce')));

  const second = signedReceipt(reviewKey, {
    nonce: Buffer.alloc(16, 8).toString('base64url'),
    previousReceiptId: 'sar1:' + '0'.repeat(64),
  });
  assert.equal(verifySignedAuthorityReceiptSet(verifier, [first, second], {
    expected: expected(),
    requireLinearChain: true,
  }).valid, false);
});

test('unknown, revoked and unsigned legacy receipts never verify', () => {
  const unknownVerifier = createSignedAuthorityVerifier({ trustStore: trustStore([privacyKey]) });
  assert(unknownVerifier.verify(signedReceipt(), { expected: expected() })
    .errors.includes('signature:unknown-key'));

  const revokedReview = {
    ...reviewKey,
    trust: { ...reviewKey.trust, status: 'REVOKED' },
  };
  const revokedVerifier = createSignedAuthorityVerifier({ trustStore: trustStore([revokedReview]) });
  assert(revokedVerifier.verify(signedReceipt(), { expected: expected() })
    .errors.includes('signature:revoked-key'));

  assert.equal(unknownVerifier.verify({
    contract: 'M6AcceptanceReceipt',
    version: 1,
    decision: 'PASS',
  }).valid, false);
});

summary();
