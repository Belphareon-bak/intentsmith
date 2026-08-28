import { createHash } from 'node:crypto';

import {
  M6_ACCEPTANCE_CHECK_DOMAIN,
  M6_ACCEPTANCE_DOMAIN_CHECK,
  SIGNED_AUTHORITY_BUNDLE_PATHS,
  M5_SIGNED_PRIVACY_RECEIPT_PATHS,
  M6_ACCEPTANCE_RECEIPT_PATHS,
} from '../../contracts/m6/acceptance-authority-v1.js';
import {
  M5_PRIVACY_ROTATION_CATEGORIES,
} from '../../contracts/m5/privacy-remediation-v1.js';
import {
  validateSignedM5PrivacyHistoryReceipt,
  validateSignedM5PrivacyRotationReceipt,
} from '../../contracts/m5/signed-privacy-receipts-v1.js';
import {
  createSignedAuthorityVerifier,
  verifySignedAuthorityReceiptSet,
} from '../security/signed-authority-verifier.js';
import {
  validateM6AcceptanceReceipt,
} from './m6-acceptance-authority.js';
import {
  validateM6EvidenceCommitHistory,
} from './m6-release-validation.js';

const AUTHORITY_RECEIPT_PATH_SET = new Set(SIGNED_AUTHORITY_BUNDLE_PATHS);

function result({ valid, verdict, errors = [], missingPaths = [], receipts = null }) {
  return Object.freeze({
    contract: 'SignedAuthorityBundleVerification',
    version: 1,
    valid,
    verdict,
    exitCode: verdict === 'PASS' ? 0 : verdict === 'BLOCKED' ? 2 : 1,
    errors: Object.freeze(errors),
    missingPaths: Object.freeze(missingPaths),
    receipts: receipts === null ? null : Object.freeze(receipts),
  });
}

function rawAt(rawReceiptsByPath, receiptPath) {
  if (rawReceiptsByPath instanceof Map) return rawReceiptsByPath.get(receiptPath);
  return rawReceiptsByPath?.[receiptPath];
}

function historyAt(receiptEvidenceHistories, evidenceHeadSha) {
  if (receiptEvidenceHistories instanceof Map) {
    return receiptEvidenceHistories.get(evidenceHeadSha);
  }
  return receiptEvidenceHistories?.[evidenceHeadSha];
}

function validatePathSemantic(receipt, index, verifier, expected) {
  if (index < M5_PRIVACY_ROTATION_CATEGORIES.length) {
    const semantic = validateSignedM5PrivacyRotationReceipt(receipt);
    if (
      semantic.valid
      && receipt.payload.categoryId !== M5_PRIVACY_ROTATION_CATEGORIES[index].categoryId
    ) return ['privacy:rotation-order'];
    return [...semantic.errors];
  }
  if (index === M5_SIGNED_PRIVACY_RECEIPT_PATHS.length - 1) {
    return [...validateSignedM5PrivacyHistoryReceipt(receipt).errors];
  }
  const acceptanceIndex = index - M5_SIGNED_PRIVACY_RECEIPT_PATHS.length;
  const expectedDomain = Object.values(M6_ACCEPTANCE_CHECK_DOMAIN)[acceptanceIndex];
  const semantic = validateM6AcceptanceReceipt(receipt, { verifier, expected });
  return [
    ...(receipt.domain === expectedDomain ? [] : ['receipt:path-domain']),
    ...semantic.errors,
  ];
}

async function verifyArtifactBinding(receipt, binding, readGitArtifact) {
  try {
    const artifact = await readGitArtifact(receipt.evidenceHeadSha, binding.path);
    const bytes = Buffer.from(artifact.bytes);
    const gitMode = artifact.gitMode || (artifact.executable ? '100755' : '100644');
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    return bytes.length === binding.bytes
      && gitMode === binding.gitMode
      && digest === binding.sha256
      ? null
      : 'artifact:binding';
  } catch {
    return 'artifact:unreadable';
  }
}

async function verifyPinnedEvidenceDocuments(receipt, readGitArtifact) {
  const errors = [];
  let indexArtifact;
  let index;
  try {
    indexArtifact = await readGitArtifact(
      receipt.evidenceHeadSha,
      'docs/execution/runs/m6/M6-RELEASE-EVIDENCE-INDEX.json',
    );
    const bytes = Buffer.from(indexArtifact.bytes);
    if (`sha256:${createHash('sha256').update(bytes).digest('hex')}`
        !== receipt.releaseEvidenceIndexSha256) {
      errors.push('evidence-index:binding');
    }
    index = JSON.parse(bytes.toString('utf8'));
  } catch {
    errors.push('evidence-index:unreadable');
  }
  const manifestBinding = index?.releaseArtifactManifest;
  if (
    typeof manifestBinding?.path !== 'string'
    || !Number.isSafeInteger(manifestBinding?.bytes)
    || !/^[a-f0-9]{64}$/u.test(manifestBinding?.sha256 || '')
  ) {
    errors.push('artifact-manifest:index-binding');
    return errors;
  }
  try {
    const artifact = await readGitArtifact(receipt.evidenceHeadSha, manifestBinding.path);
    const bytes = Buffer.from(artifact.bytes);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (
      bytes.length !== manifestBinding.bytes
      || digest !== manifestBinding.sha256
      || `sha256:${digest}` !== receipt.artifactManifestSha256
    ) errors.push('artifact-manifest:binding');
  } catch {
    errors.push('artifact-manifest:unreadable');
  }
  return errors;
}

export async function verifySignedAuthorityBundle({
  rawReceiptsByPath,
  trustStore,
  expected,
  finalEvidenceHeadSha,
  evidenceCommitHistory,
  receiptEvidenceHistories,
  worktreeClean,
  evidenceRegistryFingerprint,
  isAncestor,
  readGitArtifact,
  resolveReceiptCommit,
} = {}) {
  if (
    typeof isAncestor !== 'function'
    || typeof readGitArtifact !== 'function'
    || typeof resolveReceiptCommit !== 'function'
  ) return result({ valid: false, verdict: 'FAIL', errors: ['bundle:dependencies'] });
  let verifier;
  try {
    verifier = createSignedAuthorityVerifier({ trustStore });
  } catch (error) {
    return result({ valid: false, verdict: 'FAIL', errors: [error.message] });
  }
  const candidateIsAncestor = await isAncestor(
    expected?.productCandidateSha,
    finalEvidenceHeadSha,
  );
  const boundary = validateM6EvidenceCommitHistory({
    candidateSha: expected?.productCandidateSha,
    evidenceHeadSha: finalEvidenceHeadSha,
    candidateIsAncestor,
    commits: evidenceCommitHistory,
    worktreeClean,
    candidateRegistryFingerprint: expected?.registryFingerprint,
    evidenceRegistryFingerprint,
  });
  if (!boundary.valid) {
    return result({
      valid: false,
      verdict: 'FAIL',
      errors: boundary.errors.map(error => `bundle:${error}`),
    });
  }
  const missingPaths = SIGNED_AUTHORITY_BUNDLE_PATHS.filter(
    receiptPath => rawAt(rawReceiptsByPath, receiptPath) === undefined,
  );
  const receipts = [];
  const errors = [];
  const seenNonceKeys = new Set();
  for (const [index, receiptPath] of SIGNED_AUTHORITY_BUNDLE_PATHS.entries()) {
    const raw = rawAt(rawReceiptsByPath, receiptPath);
    if (raw === undefined) continue;
    const verified = verifier.verifyRaw(raw, { expected, seenNonceKeys });
    errors.push(...verified.errors.map(error => `${receiptPath}:${error}`));
    if (!verified.valid) continue;
    const receipt = verified.receipt;
    seenNonceKeys.add(receipt.nonce);
    errors.push(...validatePathSemantic(receipt, index, verifier, expected).map(
      error => `${receiptPath}:${error}`,
    ));
    let commit;
    try {
      commit = await resolveReceiptCommit(receiptPath);
    } catch {
      errors.push(`${receiptPath}:commit:unresolved`);
      continue;
    }
    if (
      commit?.parentSha !== receipt.evidenceHeadSha
      || !Array.isArray(commit.changedPaths)
      || !commit.changedPaths.includes(receiptPath)
      || commit.changedPaths.some(changedPath => !AUTHORITY_RECEIPT_PATH_SET.has(changedPath))
    ) errors.push(`${receiptPath}:binding:evidence-head`);
    if (
      !await isAncestor(expected.productCandidateSha, receipt.evidenceHeadSha)
      || !await isAncestor(receipt.evidenceHeadSha, finalEvidenceHeadSha)
    ) errors.push(`${receiptPath}:binding:evidence-ancestry`);
    const receiptHistory = validateM6EvidenceCommitHistory({
      candidateSha: expected.productCandidateSha,
      evidenceHeadSha: receipt.evidenceHeadSha,
      candidateIsAncestor: await isAncestor(
        expected.productCandidateSha,
        receipt.evidenceHeadSha,
      ),
      commits: historyAt(receiptEvidenceHistories, receipt.evidenceHeadSha),
      worktreeClean: true,
      candidateRegistryFingerprint: expected.registryFingerprint,
      evidenceRegistryFingerprint: expected.registryFingerprint,
    });
    errors.push(...receiptHistory.errors.map(error => `${receiptPath}:${error}`));
    for (const binding of receipt.artifacts) {
      const artifactError = await verifyArtifactBinding(receipt, binding, readGitArtifact);
      if (artifactError) errors.push(`${receiptPath}:${binding.path}:${artifactError}`);
    }
    errors.push(...(await verifyPinnedEvidenceDocuments(receipt, readGitArtifact)).map(
      error => `${receiptPath}:${error}`,
    ));
    receipts.push(receipt);
  }
  if (errors.length > 0) return result({ valid: false, verdict: 'FAIL', errors, missingPaths });
  if (missingPaths.length > 0) {
    return result({ valid: true, verdict: 'BLOCKED', missingPaths, receipts });
  }
  const set = verifySignedAuthorityReceiptSet(verifier, receipts, {
    expected,
    requireLinearChain: true,
  });
  if (!set.valid) errors.push(...set.errors);

  const privacyHistory = receipts[M5_SIGNED_PRIVACY_RECEIPT_PATHS.length - 1];
  const acceptance = receipts.slice(M5_SIGNED_PRIVACY_RECEIPT_PATHS.length);
  let previousReceiptId = privacyHistory?.receiptId;
  for (const [index, receipt] of acceptance.entries()) {
    const semantic = validateM6AcceptanceReceipt(receipt, {
      verifier,
      expected,
      expectedPreviousReceiptId: previousReceiptId,
    });
    errors.push(...semantic.errors.map(error => `acceptance[${index}]:${error}`));
    previousReceiptId = receipt.receiptId;
  }
  const [m5, review, demo, gate0] = acceptance;
  if (m5?.payload.privacyHistoryReceiptId !== privacyHistory?.receiptId) {
    errors.push('bundle:m5-privacy-history-binding');
  }
  if (m5?.payload.historyDisposition !== privacyHistory?.payload.disposition) {
    errors.push('bundle:m5-history-disposition-binding');
  }
  if (
    gate0?.payload.reviewReceiptId !== review?.receiptId
    || gate0?.payload.demoReceiptId !== demo?.receiptId
  ) errors.push('bundle:gate0-review-demo-binding');
  if (
    privacyHistory
    && (
      !await isAncestor(
        privacyHistory.payload.postDispositionHeadSha,
        expected.productCandidateSha,
      )
      || !await isAncestor(
        privacyHistory.payload.postDispositionHeadSha,
        privacyHistory.evidenceHeadSha,
      )
    )
  ) errors.push('bundle:history-post-disposition-ancestry');
  return errors.length === 0
    ? result({ valid: true, verdict: 'PASS', receipts })
    : result({ valid: false, verdict: 'FAIL', errors });
}

export function acceptanceReceiptsFromBundle(bundleResult) {
  if (bundleResult?.verdict !== 'PASS' || !Array.isArray(bundleResult.receipts)) return [];
  const byPathOffset = M5_SIGNED_PRIVACY_RECEIPT_PATHS.length;
  return Object.values(M6_ACCEPTANCE_RECEIPT_PATHS).map(
    (_receiptPath, index) => bundleResult.receipts[byPathOffset + index],
  );
}

export function applyVerifiedSignedAuthorityBundle(releaseEvidence, bundleResult) {
  if (bundleResult?.verdict !== 'PASS' || !Array.isArray(bundleResult.receipts)) {
    return Object.freeze({
      valid: bundleResult?.verdict !== 'FAIL',
      errors: Object.freeze(bundleResult?.verdict === 'FAIL' ? [...bundleResult.errors] : []),
      evidence: bundleResult?.verdict === 'FAIL' ? null : Object.freeze(structuredClone(releaseEvidence)),
    });
  }
  const evidence = structuredClone(releaseEvidence);
  for (const receipt of acceptanceReceiptsFromBundle(bundleResult)) {
    const checkId = M6_ACCEPTANCE_DOMAIN_CHECK[receipt.domain];
    const row = evidence.checks?.find(item => item.id === checkId);
    if (!row) {
      return Object.freeze({
        valid: false,
        errors: Object.freeze([`bundle:missing-release-row:${checkId}`]),
        evidence: null,
      });
    }
    row.status = 'PASS';
    row.reasonCode = null;
    row.artifacts = receipt.artifacts.map(binding => ({
      path: binding.path,
      bytes: binding.bytes,
      sha256: binding.sha256.slice('sha256:'.length),
    }));
  }
  return Object.freeze({ valid: true, errors: Object.freeze([]), evidence: Object.freeze(evidence) });
}
