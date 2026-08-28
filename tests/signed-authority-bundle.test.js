#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';

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
  M5_PRIVACY_HISTORY_ACTION,
  M5_PRIVACY_HISTORY_DECISIONS,
  M5_PRIVACY_REPOSITORY_VISIBILITY,
  M5_PRIVACY_ROTATION_CATEGORIES,
} from '../contracts/m5/privacy-remediation-v1.js';
import {
  M5_SIGNED_PRIVACY_PAYLOAD,
} from '../contracts/m5/signed-privacy-receipts-v1.js';
import {
  M5_SIGNED_PRIVACY_RECEIPT_PATHS,
  M6_ACCEPTANCE_PAYLOAD_CONTRACT,
  M6_ACCEPTANCE_RECEIPT_PATHS,
  M6_OPERATOR_DEMO_STEPS,
  SIGNED_AUTHORITY_BUNDLE_PATHS,
} from '../contracts/m6/acceptance-authority-v1.js';
import {
  M6_RELEASE_EVIDENCE_INDEX_PATH,
} from '../contracts/m6/release-v1.js';
import {
  applyVerifiedSignedAuthorityBundle,
  verifySignedAuthorityBundle,
} from '../src/release/signed-authority-bundle-verifier.js';
import { signedAuthorityKeyId } from '../src/security/signed-authority-verifier.js';
import { suite, summary, testAsync } from './harness.js';

const candidateSha = 'a'.repeat(40);
const evidenceHeadSha = 'b'.repeat(40);
const finalEvidenceHeadSha = 'c'.repeat(40);
const releaseManifestPath = 'docs/execution/runs/m6/M6-RELEASE-ARTIFACT.json';
const releaseManifestBytes = Buffer.from('{"contract":"M6ReleaseArtifactFixture"}\n', 'utf8');
const releaseIndexBytes = Buffer.from(`${JSON.stringify({
  releaseArtifactManifest: {
    path: releaseManifestPath,
    bytes: releaseManifestBytes.length,
    sha256: digest(releaseManifestBytes).slice('sha256:'.length),
  },
})}\n`, 'utf8');
const expected = Object.freeze({
  productCandidateSha: candidateSha,
  productCandidateTree: 'd'.repeat(40),
  registryFingerprint: 'e'.repeat(64),
  releaseEvidenceIndexSha256: digest(releaseIndexBytes),
  artifactManifestSha256: digest(releaseManifestBytes),
});

function key(authorityId) {
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

const keys = Object.freeze({
  privacy: key(SIGNED_AUTHORITY_ROLE.M5_PRIVACY_OPERATOR),
  acceptance: key(SIGNED_AUTHORITY_ROLE.M5_ACCEPTANCE_OPERATOR),
  review: key(SIGNED_AUTHORITY_ROLE.M6_INDEPENDENT_REVIEWER),
  release: key(SIGNED_AUTHORITY_ROLE.M6_RELEASE_OPERATOR),
});
const trustStore = Object.freeze({
  contract: 'SignedAuthorityTrustStore',
  version: 1,
  algorithm: SIGNED_AUTHORITY_ALGORITHM,
  keys: Object.values(keys).map(item => item.trust),
});

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function signed({ domain, roleKey, decision, payload, previousReceiptId, index, artifactStore }) {
  const bytes = Buffer.from(`signed-authority-artifact-${index}\n`, 'utf8');
  const artifact = {
    path: `docs/execution/runs/signed-authority/artifact-${index}.json`,
    bytes: bytes.length,
    gitMode: '100644',
    sha256: digest(bytes),
  };
  artifactStore.set(`${evidenceHeadSha}:${artifact.path}`, { bytes, gitMode: '100644' });
  const receipt = {
    contract: SIGNED_AUTHORITY_RECEIPT_CONTRACT,
    version: 1,
    algorithm: SIGNED_AUTHORITY_ALGORITHM,
    domain,
    authorityId: roleKey.authorityId,
    keyId: roleKey.trust.keyId,
    ...expected,
    evidenceHeadSha,
    artifacts: [artifact],
    decision,
    issuedAtMs: 1_800_000_000_000 + index,
    nonce: Buffer.alloc(16, index + 1).toString('base64url'),
    previousReceiptId,
    actor: { actorType: 'user', actorId: `fixture:${roleKey.authorityId}` },
    payload,
  };
  receipt.signature = sign(null, signedAuthoritySigningBytes(receipt), roleKey.privateKey)
    .toString('base64url');
  receipt.receiptId = computeSignedAuthorityReceiptId(receipt);
  return receipt;
}

function fixture() {
  const artifactStore = new Map();
  artifactStore.set(`${evidenceHeadSha}:${M6_RELEASE_EVIDENCE_INDEX_PATH}`, {
    bytes: releaseIndexBytes,
    gitMode: '100644',
  });
  artifactStore.set(`${evidenceHeadSha}:${releaseManifestPath}`, {
    bytes: releaseManifestBytes,
    gitMode: '100644',
  });
  const receipts = [];
  let previousReceiptId = null;
  for (const [index, category] of M5_PRIVACY_ROTATION_CATEGORIES.entries()) {
    const providerBytes = Buffer.from(`provider-${category.categoryId}\n`, 'utf8');
    const providerDigest = digest(providerBytes);
    const receipt = signed({
      domain: SIGNED_AUTHORITY_DOMAIN.M5_PRIVACY_ROTATION,
      roleKey: keys.privacy,
      decision: 'ROTATION_COMPLETED',
      previousReceiptId,
      index,
      artifactStore,
      payload: {
        contract: M5_SIGNED_PRIVACY_PAYLOAD.ROTATION,
        version: 1,
        incidentId: 'G0-PRIVACY-001',
        categoryId: category.categoryId,
        authorityKind: category.authorityKind,
        operationCompleted: true,
        completedAtMs: 1_799_999_999_000,
        providerActionEvidenceSha256: providerDigest,
        secretMaterialIncluded: false,
      },
    });
    receipt.artifacts[0].sha256 = providerDigest;
    artifactStore.set(`${evidenceHeadSha}:${receipt.artifacts[0].path}`, {
      bytes: providerBytes,
      gitMode: '100644',
    });
    receipt.artifacts[0].bytes = providerBytes.length;
    receipt.signature = sign(null, signedAuthoritySigningBytes(receipt), keys.privacy.privateKey)
      .toString('base64url');
    receipt.receiptId = computeSignedAuthorityReceiptId(receipt);
    receipts.push(receipt);
    previousReceiptId = receipt.receiptId;
  }

  const refBytes = Buffer.from('ref-census\n', 'utf8');
  const scanBytes = Buffer.from('privacy-scan\n', 'utf8');
  const history = signed({
    domain: SIGNED_AUTHORITY_DOMAIN.M5_PRIVACY_HISTORY,
    roleKey: keys.privacy,
    decision: 'HISTORY_DISPOSITION_COMPLETED',
    previousReceiptId,
    index: 8,
    artifactStore,
    payload: {
      contract: M5_SIGNED_PRIVACY_PAYLOAD.HISTORY,
      version: 1,
      incidentId: 'G0-PRIVACY-001',
      disposition: M5_PRIVACY_HISTORY_DECISIONS.RETAIN_AND_ROTATE,
      completedAction: M5_PRIVACY_HISTORY_ACTION.RETAINED,
      repositoryVisibility: M5_PRIVACY_REPOSITORY_VISIBILITY.PRIVATE,
      operationCompleted: true,
      completedAtMs: 1_799_999_999_000,
      postDispositionHeadSha: candidateSha,
      refCensusSha256: digest(refBytes),
      privacyScanSha256: digest(scanBytes),
      secretMaterialIncluded: false,
    },
  });
  history.artifacts = [
    {
      path: 'docs/execution/runs/signed-authority/ref-census.json',
      bytes: refBytes.length,
      gitMode: '100644',
      sha256: digest(refBytes),
    },
    {
      path: 'docs/execution/runs/signed-authority/privacy-scan.json',
      bytes: scanBytes.length,
      gitMode: '100644',
      sha256: digest(scanBytes),
    },
  ];
  artifactStore.set(`${evidenceHeadSha}:${history.artifacts[0].path}`, {
    bytes: refBytes, gitMode: '100644',
  });
  artifactStore.set(`${evidenceHeadSha}:${history.artifacts[1].path}`, {
    bytes: scanBytes, gitMode: '100644',
  });
  history.signature = sign(null, signedAuthoritySigningBytes(history), keys.privacy.privateKey)
    .toString('base64url');
  history.receiptId = computeSignedAuthorityReceiptId(history);
  receipts.push(history);
  previousReceiptId = history.receiptId;

  const m5 = signed({
    domain: SIGNED_AUTHORITY_DOMAIN.M5_ACCEPTANCE,
    roleKey: keys.acceptance,
    decision: 'M5_ACCEPTED',
    previousReceiptId,
    index: 9,
    artifactStore,
    payload: {
      contract: M6_ACCEPTANCE_PAYLOAD_CONTRACT.M5,
      version: 1,
      reviewSectionsPassed: 9,
      rotationsCompleted: 8,
      historyDisposition: M5_PRIVACY_HISTORY_DECISIONS.RETAIN_AND_ROTATE,
      privacyHistoryReceiptId: history.receiptId,
      openCriticalHigh: 0,
      technicalReviewVerdict: 'REVIEW_PASSED',
      operatorRemediation: 'COMPLETE',
    },
  });
  receipts.push(m5);
  const review = signed({
    domain: SIGNED_AUTHORITY_DOMAIN.M6_INDEPENDENT_REVIEW,
    roleKey: keys.review,
    decision: 'REVIEW_PASSED',
    previousReceiptId: m5.receiptId,
    index: 10,
    artifactStore,
    payload: {
      contract: M6_ACCEPTANCE_PAYLOAD_CONTRACT.REVIEW,
      version: 1,
      sectionsReviewed: 8,
      blockingFindings: 0,
      verdict: 'REVIEW_PASSED',
    },
  });
  receipts.push(review);
  const demo = signed({
    domain: SIGNED_AUTHORITY_DOMAIN.M6_OPERATOR_DEMO,
    roleKey: keys.release,
    decision: 'DEMO_APPROVED',
    previousReceiptId: review.receiptId,
    index: 11,
    artifactStore,
    payload: {
      contract: M6_ACCEPTANCE_PAYLOAD_CONTRACT.DEMO,
      version: 1,
      stepsPassed: [...M6_OPERATOR_DEMO_STEPS],
      verdict: 'APPROVED',
    },
  });
  receipts.push(demo);
  const gate0 = signed({
    domain: SIGNED_AUTHORITY_DOMAIN.M6_GATE0,
    roleKey: keys.release,
    decision: 'GATE_0_PASS',
    previousReceiptId: demo.receiptId,
    index: 12,
    artifactStore,
    payload: {
      contract: M6_ACCEPTANCE_PAYLOAD_CONTRACT.GATE0,
      version: 1,
      chain: 'C-E-R-A',
      candidateEvidenceVerdict: 'PASS',
      reviewReceiptId: review.receiptId,
      demoReceiptId: demo.receiptId,
      verdict: 'APPROVED',
    },
  });
  receipts.push(gate0);

  const rawReceiptsByPath = new Map(SIGNED_AUTHORITY_BUNDLE_PATHS.map(
    (receiptPath, index) => [
      receiptPath,
      `${canonicalizeSignedAuthorityValue(receipts[index])}\n`,
    ],
  ));
  const dependencies = {
    trustStore,
    expected,
    finalEvidenceHeadSha,
    changedEntries: [
      { status: 'A', path: M6_RELEASE_EVIDENCE_INDEX_PATH },
      { status: 'A', path: releaseManifestPath },
      ...SIGNED_AUTHORITY_BUNDLE_PATHS.map(path => ({ status: 'A', path })),
    ],
    worktreeClean: true,
    evidenceRegistryFingerprint: expected.registryFingerprint,
    artifactStore,
    isAncestor: async (ancestor, descendant) => (
      (ancestor === candidateSha && [evidenceHeadSha, finalEvidenceHeadSha].includes(descendant))
      || (ancestor === evidenceHeadSha && descendant === finalEvidenceHeadSha)
      || ancestor === descendant
    ),
    readGitArtifact: async (revision, artifactPath) => {
      const artifact = artifactStore.get(`${revision}:${artifactPath}`);
      if (!artifact) throw new Error('fixture-artifact-missing');
      return artifact;
    },
    resolveReceiptCommit: async receiptPath => ({
      commitSha: finalEvidenceHeadSha,
      parentSha: evidenceHeadSha,
      changedPaths: [...SIGNED_AUTHORITY_BUNDLE_PATHS],
      receiptPath,
    }),
  };
  return { rawReceiptsByPath, receipts, dependencies };
}

suite('Git-pinned signed authority bundle verifier');

await testAsync('complete 13-receipt privacy and C-E-R-A chain passes', async () => {
  const value = fixture();
  const verification = await verifySignedAuthorityBundle({
    rawReceiptsByPath: value.rawReceiptsByPath,
    ...value.dependencies,
  });
  assert.equal(verification.verdict, 'PASS', verification.errors.join('\n'));
  assert.equal(verification.receipts.length, 13);
});

await testAsync('no operator receipts remains truthfully BLOCKED', async () => {
  const value = fixture();
  const verification = await verifySignedAuthorityBundle({
    rawReceiptsByPath: new Map(),
    ...value.dependencies,
  });
  assert.equal(verification.valid, true);
  assert.equal(verification.verdict, 'BLOCKED');
  assert.equal(verification.missingPaths.length, 13);
});

await testAsync('different evidence HEAD and a changed artifact byte fail closed', async () => {
  const value = fixture();
  const wrongHead = structuredClone(value.receipts[0]);
  wrongHead.evidenceHeadSha = '9'.repeat(40);
  wrongHead.signature = sign(null, signedAuthoritySigningBytes(wrongHead), keys.privacy.privateKey)
    .toString('base64url');
  wrongHead.receiptId = computeSignedAuthorityReceiptId(wrongHead);
  value.rawReceiptsByPath.set(
    M5_SIGNED_PRIVACY_RECEIPT_PATHS[0],
    `${canonicalizeSignedAuthorityValue(wrongHead)}\n`,
  );
  const headResult = await verifySignedAuthorityBundle({
    rawReceiptsByPath: value.rawReceiptsByPath,
    ...value.dependencies,
  });
  assert.equal(headResult.verdict, 'FAIL');
  assert(headResult.errors.some(error => error.includes('binding:evidence-head')));

  const changed = fixture();
  const binding = changed.receipts[2].artifacts[0];
  changed.dependencies.artifactStore.set(`${evidenceHeadSha}:${binding.path}`, {
    bytes: Buffer.from('changed\n'),
    gitMode: '100644',
  });
  const artifactResult = await verifySignedAuthorityBundle({
    rawReceiptsByPath: changed.rawReceiptsByPath,
    ...changed.dependencies,
  });
  assert.equal(artifactResult.verdict, 'FAIL');
  assert(artifactResult.errors.some(error => error.includes('artifact:binding')));
});

await testAsync('receipt commit containing product changes fails evidence-only boundary', async () => {
  const value = fixture();
  const verification = await verifySignedAuthorityBundle({
    rawReceiptsByPath: value.rawReceiptsByPath,
    ...value.dependencies,
    resolveReceiptCommit: async () => ({
      commitSha: finalEvidenceHeadSha,
      parentSha: evidenceHeadSha,
      changedPaths: [...SIGNED_AUTHORITY_BUNDLE_PATHS, 'src/server.js'],
    }),
  });
  assert.equal(verification.verdict, 'FAIL');
  assert(verification.errors.some(error => error.includes('binding:evidence-head')));
});

await testAsync('a later product change anywhere in the candidate-to-HEAD range fails', async () => {
  const value = fixture();
  const verification = await verifySignedAuthorityBundle({
    rawReceiptsByPath: value.rawReceiptsByPath,
    ...value.dependencies,
    changedEntries: [
      ...value.dependencies.changedEntries,
      { status: 'M', path: 'src/server.js' },
    ],
  });
  assert.equal(verification.verdict, 'FAIL');
  assert(verification.errors.some(error => error.includes('boundary:product-path:src/server.js')));
});

await testAsync('every signed evidence HEAD must already contain the exact index and manifest', async () => {
  const missingIndex = fixture();
  missingIndex.dependencies.artifactStore.delete(
    `${evidenceHeadSha}:${M6_RELEASE_EVIDENCE_INDEX_PATH}`,
  );
  const indexResult = await verifySignedAuthorityBundle({
    rawReceiptsByPath: missingIndex.rawReceiptsByPath,
    ...missingIndex.dependencies,
  });
  assert.equal(indexResult.verdict, 'FAIL');
  assert(indexResult.errors.some(error => error.includes('evidence-index:unreadable')));

  const missingManifest = fixture();
  missingManifest.dependencies.artifactStore.delete(`${evidenceHeadSha}:${releaseManifestPath}`);
  const manifestResult = await verifySignedAuthorityBundle({
    rawReceiptsByPath: missingManifest.rawReceiptsByPath,
    ...missingManifest.dependencies,
  });
  assert.equal(manifestResult.verdict, 'FAIL');
  assert(manifestResult.errors.some(error => error.includes('artifact-manifest:unreadable')));
});

await testAsync('history disposition must precede the candidate and match M5 acceptance', async () => {
  const forked = fixture();
  const historyIndex = M5_SIGNED_PRIVACY_RECEIPT_PATHS.length - 1;
  const historyPath = M5_SIGNED_PRIVACY_RECEIPT_PATHS[historyIndex];
  const forkSha = '9'.repeat(40);
  const forkedHistory = structuredClone(forked.receipts[historyIndex]);
  forkedHistory.payload.postDispositionHeadSha = forkSha;
  forkedHistory.signature = sign(
    null,
    signedAuthoritySigningBytes(forkedHistory),
    keys.privacy.privateKey,
  ).toString('base64url');
  forkedHistory.receiptId = computeSignedAuthorityReceiptId(forkedHistory);
  forked.rawReceiptsByPath.set(
    historyPath,
    `${canonicalizeSignedAuthorityValue(forkedHistory)}\n`,
  );
  const forkResult = await verifySignedAuthorityBundle({
    rawReceiptsByPath: forked.rawReceiptsByPath,
    ...forked.dependencies,
    isAncestor: async (ancestor, descendant) => (
      (ancestor === forkSha && descendant === evidenceHeadSha)
      || forked.dependencies.isAncestor(ancestor, descendant)
    ),
  });
  assert.equal(forkResult.verdict, 'FAIL');
  assert(forkResult.errors.includes('bundle:history-post-disposition-ancestry'));

  const mismatch = fixture();
  const m5Index = M5_SIGNED_PRIVACY_RECEIPT_PATHS.length;
  const m5Path = Object.values(M6_ACCEPTANCE_RECEIPT_PATHS)[0];
  const mismatchedM5 = structuredClone(mismatch.receipts[m5Index]);
  mismatchedM5.payload.historyDisposition = M5_PRIVACY_HISTORY_DECISIONS.REWRITE_AND_ROTATE;
  mismatchedM5.signature = sign(
    null,
    signedAuthoritySigningBytes(mismatchedM5),
    keys.acceptance.privateKey,
  ).toString('base64url');
  mismatchedM5.receiptId = computeSignedAuthorityReceiptId(mismatchedM5);
  mismatch.rawReceiptsByPath.set(m5Path, `${canonicalizeSignedAuthorityValue(mismatchedM5)}\n`);
  const mismatchResult = await verifySignedAuthorityBundle({
    rawReceiptsByPath: mismatch.rawReceiptsByPath,
    ...mismatch.dependencies,
  });
  assert.equal(mismatchResult.verdict, 'FAIL');
  assert(mismatchResult.errors.includes('bundle:m5-history-disposition-binding'));
});

await testAsync('only a verified PASS bundle can promote the four external checks', async () => {
  const value = fixture();
  const verification = await verifySignedAuthorityBundle({
    rawReceiptsByPath: value.rawReceiptsByPath,
    ...value.dependencies,
  });
  const evidence = {
    checks: Object.keys(M6_ACCEPTANCE_RECEIPT_PATHS).map(id => ({
      id, status: 'BLOCKED', reasonCode: 'PENDING', artifacts: [],
    })),
  };
  const promoted = applyVerifiedSignedAuthorityBundle(evidence, verification);
  assert.equal(promoted.valid, true);
  assert(promoted.evidence.checks.every(row => row.status === 'PASS'));

  const blocked = await verifySignedAuthorityBundle({
    rawReceiptsByPath: new Map(),
    ...value.dependencies,
  });
  const unchanged = applyVerifiedSignedAuthorityBundle(evidence, blocked);
  assert.equal(unchanged.valid, true);
  assert(unchanged.evidence.checks.every(row => row.status === 'BLOCKED'));
});

summary();
