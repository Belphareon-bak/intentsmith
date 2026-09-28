#!/usr/bin/env node

import { createHash } from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  SIGNED_AUTHORITY_BUNDLE_PATHS,
} from '../contracts/m6/acceptance-authority-v1.js';
import {
  M6_RELEASE_EVIDENCE_INDEX_PATH,
} from '../contracts/m6/release-v1.js';
import {
  buildM6CandidateExecutionPlan,
} from '../src/release/m6-candidate-plan.js';
import {
  validateM6EvidenceCommitHistory,
  validateM6ReleaseEvidenceIndex,
} from '../src/release/m6-release-validation.js';
import {
  verifySignedAuthorityBundle,
} from '../src/release/signed-authority-bundle-verifier.js';
import {
  assertM6GitMetadataSafe,
  gitBytes as runGitBytes,
  gitIsAncestor,
  gitObjectExists,
  gitText,
  m6WorktreeClean,
  readM6EvidenceCommitHistory,
} from './m6-git-evidence.js';
import { registryFingerprint } from './test-registry.js';

export const SIGNED_AUTHORITY_TRUST_STORE_PATH =
  'contracts/authority/trusted-public-keys-v1.json';

function git(root, args) {
  return gitText(root, args);
}

function gitBytes(root, revision, artifactPath) {
  return runGitBytes(root, ['show', `${revision}:${artifactPath}`]);
}

function objectExists(root, revision, artifactPath) {
  return gitObjectExists(root, revision, artifactPath);
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw new Error(`${label}:invalid-json`);
  }
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function readGitArtifact(root, revision, artifactPath) {
  const line = git(root, ['ls-tree', revision, '--', artifactPath]);
  const match = /^(100644|100755) blob [a-f0-9]{40}\t(.+)$/u.exec(line);
  if (!match || match[2] !== artifactPath) throw new Error('signed-authority:not-git-blob');
  return Object.freeze({
    bytes: gitBytes(root, revision, artifactPath),
    gitMode: match[1],
  });
}

function failResult(error) {
  return Object.freeze({
    contract: 'SignedAuthorityBundleVerification',
    version: 1,
    valid: false,
    verdict: 'FAIL',
    exitCode: 1,
    errors: Object.freeze([error?.message || String(error)]),
    missingPaths: Object.freeze([]),
    receipts: null,
  });
}

export async function verifyCurrentSignedAuthorityBundle(root = process.cwd()) {
  try {
    assertM6GitMetadataSafe(root);
    const finalEvidenceHeadSha = git(root, ['rev-parse', 'HEAD']);
    if (!objectExists(root, finalEvidenceHeadSha, M6_RELEASE_EVIDENCE_INDEX_PATH)) {
      return Object.freeze({
        contract: 'SignedAuthorityBundleVerification',
        version: 1,
        valid: true,
        verdict: 'BLOCKED',
        exitCode: 2,
        errors: Object.freeze([]),
        missingPaths: Object.freeze([...SIGNED_AUTHORITY_BUNDLE_PATHS]),
        receipts: Object.freeze([]),
        reasonCode: 'M6_RELEASE_EVIDENCE_NOT_FOUND',
      });
    }
    const indexBytes = gitBytes(root, finalEvidenceHeadSha, M6_RELEASE_EVIDENCE_INDEX_PATH);
    const index = parseJson(indexBytes, 'signed-authority:index');
    const candidateSha = index.candidateSha;
    if (!gitIsAncestor(root, candidateSha, finalEvidenceHeadSha)) {
      throw new Error('signed-authority:candidate-not-ancestor');
    }
    const candidateRegistry = parseJson(
      gitBytes(root, candidateSha, 'tests/registry.json'),
      'signed-authority:candidate-registry',
    );
    const fingerprint = registryFingerprint(candidateRegistry);
    const evidenceRegistry = parseJson(
      gitBytes(root, finalEvidenceHeadSha, 'tests/registry.json'),
      'signed-authority:evidence-registry',
    );
    const evidenceRegistryFingerprint = registryFingerprint(evidenceRegistry);
    const evidenceCommitHistory = readM6EvidenceCommitHistory(
      root,
      candidateSha,
      finalEvidenceHeadSha,
    );
    const worktreeClean = m6WorktreeClean(root);
    const boundary = validateM6EvidenceCommitHistory({
      candidateSha,
      evidenceHeadSha: finalEvidenceHeadSha,
      candidateIsAncestor: true,
      commits: evidenceCommitHistory,
      worktreeClean,
      candidateRegistryFingerprint: fingerprint,
      evidenceRegistryFingerprint,
    });
    if (!boundary.valid) {
      throw new Error(`signed-authority:evidence-boundary:${boundary.errors.join(',')}`);
    }
    const indexValidation = validateM6ReleaseEvidenceIndex(index, {
      candidateSha,
      registryFingerprint: fingerprint,
      expectedPhases: buildM6CandidateExecutionPlan(candidateRegistry).phases,
    });
    if (!indexValidation.valid) {
      throw new Error(`signed-authority:index-invalid:${indexValidation.errors.join(',')}`);
    }
    const manifest = readGitArtifact(
      root,
      finalEvidenceHeadSha,
      index.releaseArtifactManifest.path,
    );
    if (
      manifest.bytes.length !== index.releaseArtifactManifest.bytes
      || sha256(manifest.bytes) !== `sha256:${index.releaseArtifactManifest.sha256}`
    ) throw new Error('signed-authority:artifact-manifest-binding');
    const trustStore = parseJson(
      gitBytes(root, candidateSha, SIGNED_AUTHORITY_TRUST_STORE_PATH),
      'signed-authority:trust-store',
    );
    const rawReceiptsByPath = new Map();
    for (const receiptPath of SIGNED_AUTHORITY_BUNDLE_PATHS) {
      if (objectExists(root, finalEvidenceHeadSha, receiptPath)) {
        rawReceiptsByPath.set(receiptPath, gitBytes(root, finalEvidenceHeadSha, receiptPath));
      }
    }
    const receiptEvidenceHistories = new Map();
    for (const raw of rawReceiptsByPath.values()) {
      try {
        const receipt = parseJson(raw, 'signed-authority:receipt');
        if (
          /^[a-f0-9]{40}$/u.test(receipt.evidenceHeadSha || '')
          && !receiptEvidenceHistories.has(receipt.evidenceHeadSha)
        ) {
          receiptEvidenceHistories.set(
            receipt.evidenceHeadSha,
            readM6EvidenceCommitHistory(root, candidateSha, receipt.evidenceHeadSha),
          );
        }
      } catch {
        // The raw verifier below owns malformed-receipt classification.
      }
    }
    const expected = Object.freeze({
      productCandidateSha: candidateSha,
      productCandidateTree: git(root, ['rev-parse', `${candidateSha}^{tree}`]),
      registryFingerprint: fingerprint,
      releaseEvidenceIndexSha256: sha256(indexBytes),
      artifactManifestSha256: sha256(manifest.bytes),
    });
    const verification = await verifySignedAuthorityBundle({
      rawReceiptsByPath,
      trustStore,
      expected,
      finalEvidenceHeadSha,
      evidenceCommitHistory,
      receiptEvidenceHistories,
      worktreeClean,
      evidenceRegistryFingerprint,
      isAncestor: async (ancestor, descendant) => (
        gitIsAncestor(root, ancestor, descendant)
      ),
      readGitArtifact: async (revision, artifactPath) => (
        readGitArtifact(root, revision, artifactPath)
      ),
      resolveReceiptCommit: async receiptPath => {
        const commitSha = git(root, [
          'log', '-n', '1', '--format=%H', finalEvidenceHeadSha, '--', receiptPath,
        ]);
        if (!/^[a-f0-9]{40}$/u.test(commitSha)) throw new Error('receipt-commit-missing');
        const parents = git(root, ['show', '-s', '--format=%P', commitSha]).split(' ').filter(Boolean);
        if (parents.length !== 1) throw new Error('receipt-commit-not-single-parent');
        const changedPaths = git(root, [
          'diff-tree', '--no-commit-id', '--name-only', '-r', commitSha,
        ]).split('\n').filter(Boolean);
        return { commitSha, parentSha: parents[0], changedPaths };
      },
    });
    return Object.freeze({
      ...verification,
      candidateSha,
      finalEvidenceHeadSha,
      registryFingerprint: fingerprint,
      releaseEvidenceIndexSha256: expected.releaseEvidenceIndexSha256,
      artifactManifestSha256: expected.artifactManifestSha256,
    });
  } catch (error) {
    return failResult(error);
  }
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length > 0) throw new Error('Signed authority bundle verifier accepts no arguments');
  const verification = await verifyCurrentSignedAuthorityBundle();
  console.log(JSON.stringify(verification, null, 2));
  return verification.exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
