#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  M6_RELEASE_EVIDENCE_INDEX_CONTRACT,
  M6_RELEASE_EVIDENCE_INDEX_PATH,
  M6_RELEASE_EVIDENCE_INDEX_VERSION,
} from '../contracts/m6/release-v1.js';
import {
  M6_OPERATOR_DEMO_OBSERVATION_CONTRACT,
  M6_OPERATOR_DEMO_OBSERVATION_STAGE,
  M6_OPERATOR_DEMO_PLAN_DIGEST_V1,
  M6_OPERATOR_DEMO_PLAN_V1,
} from '../contracts/m6/operator-demo-v1.js';
import {
  buildM6CandidateExecutionPlan,
} from '../src/release/m6-candidate-plan.js';
import {
  applyVerifiedSignedAuthorityBundle,
  verifySignedAuthorityBundle,
} from '../src/release/signed-authority-bundle-verifier.js';
import { signedAuthorityKeyId } from '../src/security/signed-authority-verifier.js';
import { registryFingerprint } from '../scripts/test-registry.js';
import { suite, summary, testAsync } from './harness.js';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const standaloneVerifierPath = path.join(
  repositoryRoot,
  'scripts/verify-signed-authority-bundle.js',
);
const fullReleaseVerifierPath = path.join(repositoryRoot, 'scripts/validate-m6-release.js');

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

function demoEvidence(productCandidateSha, productCandidateTree, fingerprint) {
  const rawPrefix =
    `docs/execution/runs/m6/operator-demo/candidate-${productCandidateSha}/raw/`;
  const rawArtifacts = new Map(M6_OPERATOR_DEMO_PLAN_V1.steps.map((step, index) => [
    `${rawPrefix}step-${index}.json`,
    Buffer.from(`${JSON.stringify({ step: step.id, fixture: true })}\n`, 'utf8'),
  ]));
  const observation = {
    contract: M6_OPERATOR_DEMO_OBSERVATION_CONTRACT,
    version: 1,
    stage: M6_OPERATOR_DEMO_OBSERVATION_STAGE,
    planDigest: M6_OPERATOR_DEMO_PLAN_DIGEST_V1,
    candidate: {
      sha: productCandidateSha,
      tree: productCandidateTree,
      treeClean: true,
      standaloneCheckout: true,
    },
    registryFingerprint: fingerprint,
    startedAt: '2030-01-01T00:00:00.000Z',
    completedAt: '2030-01-01T00:09:00.000Z',
    durationMs: 540_000,
    recordedAt: '2030-01-01T00:10:00.000Z',
    environment: {
      freshCloneObserved: true,
      installProfile: 'core-minimal-offline',
      buildProfile: 'linux-x64-studio-production',
      unexpectedEgressAttempts: 0,
    },
    steps: M6_OPERATOR_DEMO_PLAN_V1.steps.map((step, index) => {
      const artifactPath = `${rawPrefix}step-${index}.json`;
      const bytes = rawArtifacts.get(artifactPath);
      return {
        id: step.id,
        status: 'PASS',
        notes: `Fixture operator observation ${index}.`,
        artifacts: [{
          path: artifactPath,
          bytes: bytes.length,
          sha256: digest(bytes).slice('sha256:'.length),
        }],
      };
    }),
    verdict: 'DEMO_COMPLETED_AWAITING_OPERATOR_APPROVAL',
    acceptance: {
      authorityId: SIGNED_AUTHORITY_ROLE.M6_RELEASE_OPERATOR,
      domain: SIGNED_AUTHORITY_DOMAIN.M6_OPERATOR_DEMO,
      receiptPath: M6_ACCEPTANCE_RECEIPT_PATHS['operator-demo-approval'],
      status: 'NOT_ISSUED',
      automaticApproval: 'forbidden',
    },
  };
  const observationBytes = Buffer.from(`${JSON.stringify(observation, null, 2)}\n`, 'utf8');
  const observationDigest = digest(observationBytes).slice('sha256:'.length);
  const observationPath =
    `docs/execution/runs/m6/operator-demo/candidate-${productCandidateSha}/` +
    `observation-${observationDigest}.json`;
  return {
    observationPath,
    observationBytes,
    rawArtifacts,
  };
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

function nonApplicabilityPayload(category, evidenceDigest, assessedAtMs) {
  const fixturePassword = category.categoryId === 'fixture-password-reuse';
  return {
    contract: 'M5PrivacyNonApplicabilityEvidence', version: 1,
    incidentId: 'G0-PRIVACY-001', categoryId: category.categoryId,
    authorityKind: category.authorityKind, assessmentCompleted: true, assessedAtMs,
    assessmentScope: 'HISTORICAL_EXPOSURE_AND_CURRENT_AUTHORITY',
    historicalExposureReviewed: true, remainingLocalAuthority: false,
    remainingExternalAuthority: false, secretMaterialIncluded: false,
    reason: fixturePassword ? 'FIXTURE_NOT_REUSED' : 'NEVER_EXISTED_IN_EXPOSURE_SCOPE',
    assessmentEvidenceSha256: evidenceDigest,
    ...(fixturePassword ? { fixtureReusedOutsideTests: false } : {}),
  };
}

function fixture({ nonApplicable = [], acceptanceVersion = nonApplicable.length ? 2 : 1, m5Overrides = {} } = {}) {
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
      decision: nonApplicable.includes(index) ? 'ROTATION_NOT_APPLICABLE' : 'ROTATION_COMPLETED',
      previousReceiptId,
      index,
      artifactStore,
      payload: nonApplicable.includes(index)
        ? nonApplicabilityPayload(category, providerDigest, 1_799_999_999_000) : {
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
      version: acceptanceVersion,
      reviewSectionsPassed: 9,
      rotationsCompleted: acceptanceVersion === 2 ? 8 - nonApplicable.length : 8,
      ...(acceptanceVersion === 2 ? { categoriesResolved: 8, rotationsNotApplicable: nonApplicable.length } : {}),
      ...m5Overrides,
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
  const demoArtifacts = demoEvidence(
    expected.productCandidateSha,
    expected.productCandidateTree,
    expected.registryFingerprint,
  );
  for (const [artifactPath, bytes] of demoArtifacts.rawArtifacts) {
    artifactStore.set(`${evidenceHeadSha}:${artifactPath}`, { bytes, gitMode: '100644' });
  }
  artifactStore.set(`${evidenceHeadSha}:${demoArtifacts.observationPath}`, {
    bytes: demoArtifacts.observationBytes,
    gitMode: '100644',
  });
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
  demo.artifacts = [{
    path: demoArtifacts.observationPath,
    bytes: demoArtifacts.observationBytes.length,
    gitMode: '100644',
    sha256: digest(demoArtifacts.observationBytes),
  }];
  demo.signature = sign(null, signedAuthoritySigningBytes(demo), keys.release.privateKey)
    .toString('base64url');
  demo.receiptId = computeSignedAuthorityReceiptId(demo);
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
  const evidenceChangedEntries = [...artifactStore.keys()]
    .filter(key => key.startsWith(`${evidenceHeadSha}:`))
    .map(key => ({ status: 'A', path: key.slice(evidenceHeadSha.length + 1) }));
  const evidenceCommit = Object.freeze({
    commitSha: evidenceHeadSha,
    parentShas: Object.freeze([candidateSha]),
    changesByParent: Object.freeze([Object.freeze({
      parentSha: candidateSha,
      changedEntries: Object.freeze(evidenceChangedEntries),
    })]),
  });
  const receiptCommit = Object.freeze({
    commitSha: finalEvidenceHeadSha,
    parentShas: Object.freeze([evidenceHeadSha]),
    changesByParent: Object.freeze([Object.freeze({
      parentSha: evidenceHeadSha,
      changedEntries: Object.freeze(SIGNED_AUTHORITY_BUNDLE_PATHS.map(
        path => ({ status: 'A', path }),
      )),
    })]),
  });
  const dependencies = {
    trustStore,
    expected,
    finalEvidenceHeadSha,
    evidenceCommitHistory: [evidenceCommit, receiptCommit],
    receiptEvidenceHistories: new Map([[evidenceHeadSha, [evidenceCommit]]]),
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

function writeGitFixtureFile(root, relativePath, bytes) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

function fixtureGit(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commitGitFixture(root, message) {
  fixtureGit(root, ['add', '--all']);
  fixtureGit(root, ['commit', '--quiet', '-m', message]);
  return fixtureGit(root, ['rev-parse', 'HEAD']);
}

function rawArtifactBinding(artifactPath, bytes) {
  return Object.freeze({
    path: artifactPath,
    bytes: bytes.length,
    gitMode: '100644',
    sha256: digest(bytes),
  });
}

function signGitFixtureReceipt({
  domain,
  roleKey,
  expectedBindings,
  evidenceHead,
  artifacts,
  decision,
  issuedIndex,
  previousReceiptId,
  payload,
}) {
  const receipt = {
    contract: SIGNED_AUTHORITY_RECEIPT_CONTRACT,
    version: 1,
    algorithm: SIGNED_AUTHORITY_ALGORITHM,
    domain,
    authorityId: roleKey.authorityId,
    keyId: roleKey.trust.keyId,
    ...expectedBindings,
    evidenceHeadSha: evidenceHead,
    artifacts,
    decision,
    issuedAtMs: 1_900_000_000_000 + issuedIndex,
    nonce: Buffer.alloc(16, issuedIndex + 1).toString('base64url'),
    previousReceiptId,
    actor: { actorType: 'user', actorId: `fixture:${roleKey.authorityId}` },
    payload,
  };
  receipt.signature = sign(null, signedAuthoritySigningBytes(receipt), roleKey.privateKey)
    .toString('base64url');
  receipt.receiptId = computeSignedAuthorityReceiptId(receipt);
  return receipt;
}

function buildRealGitBundle({ productMutationReverted = false, nonApplicable = [] } = {}) {
  const acceptanceVersion = nonApplicable.length ? 2 : 1;
  const m5Overrides = {};
  const scratchRoot = path.join(repositoryRoot, '.intentsmith-artifacts');
  mkdirSync(scratchRoot, { recursive: true });
  const root = mkdtempSync(path.join(scratchRoot, 'signed-authority-git-e2e-'));
  fixtureGit(root, ['init', '--quiet']);
  fixtureGit(root, ['config', 'user.name', 'IntentSmith Test Fixture']);
  fixtureGit(root, ['config', 'user.email', 'fixture@intentsmith.invalid']);

  const registryBytes = readFileSync(path.join(repositoryRoot, 'tests/registry.json'));
  const registry = JSON.parse(registryBytes.toString('utf8'));
  writeGitFixtureFile(root, 'tests/registry.json', registryBytes);
  const registeredPrograms = new Set([
    ...registry.suites.map(item => item.path),
    ...registry.exclusions.map(item => item.path),
  ]);
  for (const programPath of registeredPrograms) {
    const extension = path.extname(programPath);
    const source = extension === '.sh'
      ? '#!/bin/sh\nexit 0\n'
      : extension === '.py'
        ? '# IntentSmith registry fixture\n'
        : '// IntentSmith registry fixture\n';
    writeGitFixtureFile(root, programPath, source);
  }
  writeGitFixtureFile(
    root,
    'contracts/authority/trusted-public-keys-v1.json',
    `${JSON.stringify(trustStore, null, 2)}\n`,
  );
  const originalProductBytes = Buffer.from('export const serverFixture = true;\n', 'utf8');
  writeGitFixtureFile(root, 'src/server.js', originalProductBytes);
  const productCandidateSha = commitGitFixture(root, 'fixture product candidate');
  const productCandidateTree = fixtureGit(root, [
    'rev-parse', `${productCandidateSha}^{tree}`,
  ]);
  const fingerprint = registryFingerprint(registry);
  const plan = buildM6CandidateExecutionPlan(registry);

  const manifestBytes = Buffer.from('{"contract":"M6ReleaseArtifactFixture"}\n', 'utf8');
  const manifestPath = 'docs/execution/runs/m6/M6-RELEASE-ARTIFACT.json';
  const reports = plan.phases.map((phase, phaseIndex) => {
    const reportBytes = Buffer.from(`report:${phase.id}\n`, 'utf8');
    return {
      phaseId: phase.id,
      runner: phase.runner,
      artifact: {
        path: `docs/execution/runs/m6/fixture-phase-${phaseIndex}.json`,
        bytes: reportBytes.length,
        sha256: digest(reportBytes).slice('sha256:'.length),
      },
      logs: phase.programIds.map((programId, programIndex) => {
        const logBytes = Buffer.from(`log:${programId}\n`, 'utf8');
        return {
          programId,
          artifact: {
            path: `docs/execution/runs/m6/fixture-log-${phaseIndex}-${programIndex}.txt`,
            bytes: logBytes.length,
            sha256: digest(logBytes).slice('sha256:'.length),
          },
        };
      }),
    };
  });
  const index = {
    contract: M6_RELEASE_EVIDENCE_INDEX_CONTRACT,
    version: M6_RELEASE_EVIDENCE_INDEX_VERSION,
    candidateSha: productCandidateSha,
    registryFingerprint: fingerprint,
    generatedAt: '2030-01-01T00:00:00.000Z',
    reports,
    releaseArtifactManifest: {
      path: manifestPath,
      bytes: manifestBytes.length,
      sha256: digest(manifestBytes).slice('sha256:'.length),
    },
  };
  const indexBytes = Buffer.from(`${JSON.stringify(index)}\n`, 'utf8');
  writeGitFixtureFile(root, M6_RELEASE_EVIDENCE_INDEX_PATH, indexBytes);
  writeGitFixtureFile(root, manifestPath, manifestBytes);

  const authorityArtifacts = new Map();
  for (const category of M5_PRIVACY_ROTATION_CATEGORIES) {
    authorityArtifacts.set(
      `docs/execution/runs/m6/authority/provider-${category.categoryId}.json`,
      Buffer.from(`provider:${category.categoryId}\n`, 'utf8'),
    );
  }
  authorityArtifacts.set(
    'docs/execution/runs/m6/authority/ref-census.json',
    Buffer.from('ref-census\n', 'utf8'),
  );
  authorityArtifacts.set(
    'docs/execution/runs/m6/authority/privacy-scan.json',
    Buffer.from('privacy-scan\n', 'utf8'),
  );
  for (let indexPosition = 9; indexPosition <= 12; indexPosition += 1) {
    authorityArtifacts.set(
      `docs/execution/runs/m6/authority/acceptance-${indexPosition}.json`,
      Buffer.from(`acceptance:${indexPosition}\n`, 'utf8'),
    );
  }
  const demoArtifacts = demoEvidence(productCandidateSha, productCandidateTree, fingerprint);
  for (const [artifactPath, bytes] of demoArtifacts.rawArtifacts) {
    authorityArtifacts.set(artifactPath, bytes);
  }
  authorityArtifacts.set(demoArtifacts.observationPath, demoArtifacts.observationBytes);
  for (const [artifactPath, bytes] of authorityArtifacts) {
    writeGitFixtureFile(root, artifactPath, bytes);
  }
  commitGitFixture(root, 'fixture evidence');

  if (productMutationReverted) {
    writeGitFixtureFile(root, 'src/server.js', 'export const serverFixture = false;\n');
    commitGitFixture(root, 'temporary product mutation');
  }
  const evidenceHead = fixtureGit(root, ['rev-parse', 'HEAD']);
  const expectedBindings = Object.freeze({
    productCandidateSha,
    productCandidateTree,
    registryFingerprint: fingerprint,
    releaseEvidenceIndexSha256: digest(indexBytes),
    artifactManifestSha256: digest(manifestBytes),
  });

  const receipts = [];
  let previousReceiptId = null;
  for (const [indexPosition, category] of M5_PRIVACY_ROTATION_CATEGORIES.entries()) {
    const artifactPath = `docs/execution/runs/m6/authority/provider-${category.categoryId}.json`;
    const artifact = rawArtifactBinding(artifactPath, authorityArtifacts.get(artifactPath));
    const receipt = signGitFixtureReceipt({
      domain: SIGNED_AUTHORITY_DOMAIN.M5_PRIVACY_ROTATION,
      roleKey: keys.privacy,
      expectedBindings,
      evidenceHead,
      artifacts: [artifact],
      decision: nonApplicable.includes(indexPosition) ? 'ROTATION_NOT_APPLICABLE' : 'ROTATION_COMPLETED',
      issuedIndex: indexPosition,
      previousReceiptId,
      payload: nonApplicable.includes(indexPosition)
        ? nonApplicabilityPayload(category, artifact.sha256, 1_899_999_999_000) : {
        contract: M5_SIGNED_PRIVACY_PAYLOAD.ROTATION,
        version: 1,
        incidentId: 'G0-PRIVACY-001',
        categoryId: category.categoryId,
        authorityKind: category.authorityKind,
        operationCompleted: true,
        completedAtMs: 1_899_999_999_000,
        providerActionEvidenceSha256: artifact.sha256,
        secretMaterialIncluded: false,
      },
    });
    receipts.push(receipt);
    previousReceiptId = receipt.receiptId;
  }

  const refPath = 'docs/execution/runs/m6/authority/ref-census.json';
  const scanPath = 'docs/execution/runs/m6/authority/privacy-scan.json';
  const refArtifact = rawArtifactBinding(refPath, authorityArtifacts.get(refPath));
  const scanArtifact = rawArtifactBinding(scanPath, authorityArtifacts.get(scanPath));
  const history = signGitFixtureReceipt({
    domain: SIGNED_AUTHORITY_DOMAIN.M5_PRIVACY_HISTORY,
    roleKey: keys.privacy,
    expectedBindings,
    evidenceHead,
    artifacts: [refArtifact, scanArtifact],
    decision: 'HISTORY_DISPOSITION_COMPLETED',
    issuedIndex: 8,
    previousReceiptId,
    payload: {
      contract: M5_SIGNED_PRIVACY_PAYLOAD.HISTORY,
      version: 1,
      incidentId: 'G0-PRIVACY-001',
      disposition: M5_PRIVACY_HISTORY_DECISIONS.RETAIN_AND_ROTATE,
      completedAction: M5_PRIVACY_HISTORY_ACTION.RETAINED,
      repositoryVisibility: M5_PRIVACY_REPOSITORY_VISIBILITY.PRIVATE,
      operationCompleted: true,
      completedAtMs: 1_899_999_999_000,
      postDispositionHeadSha: productCandidateSha,
      refCensusSha256: refArtifact.sha256,
      privacyScanSha256: scanArtifact.sha256,
      secretMaterialIncluded: false,
    },
  });
  receipts.push(history);
  previousReceiptId = history.receiptId;

  const acceptanceArtifact = indexPosition => {
    const artifactPath = `docs/execution/runs/m6/authority/acceptance-${indexPosition}.json`;
    return rawArtifactBinding(artifactPath, authorityArtifacts.get(artifactPath));
  };
  const m5 = signGitFixtureReceipt({
    domain: SIGNED_AUTHORITY_DOMAIN.M5_ACCEPTANCE,
    roleKey: keys.acceptance,
    expectedBindings,
    evidenceHead,
    artifacts: [acceptanceArtifact(9)],
    decision: 'M5_ACCEPTED',
    issuedIndex: 9,
    previousReceiptId,
    payload: {
      contract: M6_ACCEPTANCE_PAYLOAD_CONTRACT.M5,
      version: acceptanceVersion,
      reviewSectionsPassed: 9,
      rotationsCompleted: acceptanceVersion === 2 ? 8 - nonApplicable.length : 8,
      ...(acceptanceVersion === 2 ? { categoriesResolved: 8, rotationsNotApplicable: nonApplicable.length } : {}),
      ...m5Overrides,
      historyDisposition: M5_PRIVACY_HISTORY_DECISIONS.RETAIN_AND_ROTATE,
      privacyHistoryReceiptId: history.receiptId,
      openCriticalHigh: 0,
      technicalReviewVerdict: 'REVIEW_PASSED',
      operatorRemediation: 'COMPLETE',
    },
  });
  receipts.push(m5);
  const review = signGitFixtureReceipt({
    domain: SIGNED_AUTHORITY_DOMAIN.M6_INDEPENDENT_REVIEW,
    roleKey: keys.review,
    expectedBindings,
    evidenceHead,
    artifacts: [acceptanceArtifact(10)],
    decision: 'REVIEW_PASSED',
    issuedIndex: 10,
    previousReceiptId: m5.receiptId,
    payload: {
      contract: M6_ACCEPTANCE_PAYLOAD_CONTRACT.REVIEW,
      version: 1,
      sectionsReviewed: 8,
      blockingFindings: 0,
      verdict: 'REVIEW_PASSED',
    },
  });
  receipts.push(review);
  const demo = signGitFixtureReceipt({
    domain: SIGNED_AUTHORITY_DOMAIN.M6_OPERATOR_DEMO,
    roleKey: keys.release,
    expectedBindings,
    evidenceHead,
    artifacts: [rawArtifactBinding(
      demoArtifacts.observationPath,
      demoArtifacts.observationBytes,
    )],
    decision: 'DEMO_APPROVED',
    issuedIndex: 11,
    previousReceiptId: review.receiptId,
    payload: {
      contract: M6_ACCEPTANCE_PAYLOAD_CONTRACT.DEMO,
      version: 1,
      stepsPassed: [...M6_OPERATOR_DEMO_STEPS],
      verdict: 'APPROVED',
    },
  });
  receipts.push(demo);
  const gate0 = signGitFixtureReceipt({
    domain: SIGNED_AUTHORITY_DOMAIN.M6_GATE0,
    roleKey: keys.release,
    expectedBindings,
    evidenceHead,
    artifacts: [acceptanceArtifact(12)],
    decision: 'GATE_0_PASS',
    issuedIndex: 12,
    previousReceiptId: demo.receiptId,
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

  SIGNED_AUTHORITY_BUNDLE_PATHS.forEach((receiptPath, indexPosition) => {
    writeGitFixtureFile(
      root,
      receiptPath,
      `${canonicalizeSignedAuthorityValue(receipts[indexPosition])}\n`,
    );
  });
  commitGitFixture(root, 'fixture signed receipts');
  if (productMutationReverted) {
    writeGitFixtureFile(root, 'src/server.js', originalProductBytes);
    commitGitFixture(root, 'revert temporary product mutation');
  }
  return Object.freeze({ root, productCandidateSha });
}

function runStandalone(scriptPath, root) {
  const execution = spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  let result = null;
  try {
    result = JSON.parse(execution.stdout);
  } catch {
    // Assertions report stdout/stderr when a CLI fails before emitting JSON.
  }
  return Object.freeze({ ...execution, result });
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

await testAsync('mixed category bundle binds actual completion counts and N/A artifact bytes', async () => {
  const value = fixture({ nonApplicable: [2, 5] });
  const verification = await verifySignedAuthorityBundle({
    rawReceiptsByPath: value.rawReceiptsByPath, ...value.dependencies,
  });
  assert.equal(verification.verdict, 'PASS', verification.errors.join('\n'));
  assert.equal(verification.receipts[9].payload.rotationsCompleted, 6);
  assert.equal(verification.receipts[9].payload.rotationsNotApplicable, 2);
  const naArtifact = value.receipts[2].artifacts[0];
  value.dependencies.artifactStore.get(`${evidenceHeadSha}:${naArtifact.path}`).bytes = Buffer.from('tampered assessment');
  const tampered = await verifySignedAuthorityBundle({
    rawReceiptsByPath: value.rawReceiptsByPath, ...value.dependencies,
  });
  assert.equal(tampered.verdict, 'FAIL');
  assert(tampered.errors.some(error => error.includes('artifact:binding')));
});

await testAsync('signed acceptance cannot relabel N/A as completed rotations or omit a category', async () => {
  for (const options of [
    { nonApplicable: [2, 5], acceptanceVersion: 1 },
    { nonApplicable: [2, 5], m5Overrides: { rotationsCompleted: 8, rotationsNotApplicable: 0 } },
  ]) {
    const value = fixture(options);
    const result = await verifySignedAuthorityBundle({ rawReceiptsByPath: value.rawReceiptsByPath, ...value.dependencies });
    assert.equal(result.verdict, 'FAIL');
    assert(result.errors.includes('bundle:m5-category-resolution-binding'), result.errors.join('\n'));
  }
  const missing = fixture({ nonApplicable: [2, 5] });
  missing.rawReceiptsByPath.delete(M5_SIGNED_PRIVACY_RECEIPT_PATHS[5]);
  const result = await verifySignedAuthorityBundle({ rawReceiptsByPath: missing.rawReceiptsByPath, ...missing.dependencies });
  assert.equal(result.verdict, 'BLOCKED');
  assert.equal(result.missingPaths.length, 1);
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
  const mutationSha = '9'.repeat(40);
  const revertSha = '8'.repeat(40);
  const receiptCommit = structuredClone(value.dependencies.evidenceCommitHistory.at(-1));
  receiptCommit.parentShas = [revertSha];
  receiptCommit.changesByParent[0].parentSha = revertSha;
  const verification = await verifySignedAuthorityBundle({
    rawReceiptsByPath: value.rawReceiptsByPath,
    ...value.dependencies,
    evidenceCommitHistory: [
      value.dependencies.evidenceCommitHistory[0],
      {
        commitSha: mutationSha,
        parentShas: [evidenceHeadSha],
        changesByParent: [{
          parentSha: evidenceHeadSha,
          changedEntries: [{ status: 'M', path: 'src/server.js' }],
        }],
      },
      {
        commitSha: revertSha,
        parentShas: [mutationSha],
        changesByParent: [{
          parentSha: mutationSha,
          changedEntries: [{ status: 'M', path: 'src/server.js' }],
        }],
      },
      receiptCommit,
    ],
  });
  assert.equal(verification.verdict, 'FAIL');
  assert(verification.errors.some(error => error.includes('product-path:src/server.js')));
});

await testAsync('each receipt evidence HEAD is independently checked back to the candidate', async () => {
  const value = fixture();
  const unsafeEvidence = structuredClone(
    value.dependencies.receiptEvidenceHistories.get(evidenceHeadSha),
  );
  unsafeEvidence[0].changesByParent[0].changedEntries.push({
    status: 'M',
    path: 'src/server.js',
  });
  const verification = await verifySignedAuthorityBundle({
    rawReceiptsByPath: value.rawReceiptsByPath,
    ...value.dependencies,
    receiptEvidenceHistories: new Map([[evidenceHeadSha, unsafeEvidence]]),
  });
  assert.equal(verification.verdict, 'FAIL');
  assert(verification.errors.some(error => (
    error.includes('history:commit[0]:product-path:src/server.js')
  )));
});

await testAsync('merge commits are forbidden even when every parent diff is evidence-only', async () => {
  const value = fixture();
  const merge = structuredClone(value.dependencies.evidenceCommitHistory.at(-1));
  merge.parentShas = [evidenceHeadSha, '7'.repeat(40)];
  merge.changesByParent = [
    merge.changesByParent[0],
    {
      parentSha: '7'.repeat(40),
      changedEntries: SIGNED_AUTHORITY_BUNDLE_PATHS.map(path => ({ status: 'A', path })),
    },
  ];
  const verification = await verifySignedAuthorityBundle({
    rawReceiptsByPath: value.rawReceiptsByPath,
    ...value.dependencies,
    evidenceCommitHistory: [value.dependencies.evidenceCommitHistory[0], merge],
  });
  assert.equal(verification.verdict, 'FAIL');
  assert(verification.errors.some(error => error.includes('merge-forbidden')));
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

await testAsync('standalone CLI validates a real Git bundle and rejects mutate-then-revert history', async () => {
  const passing = buildRealGitBundle();
  const reverted = buildRealGitBundle({ productMutationReverted: true });
  try {
    const pass = runStandalone(standaloneVerifierPath, passing.root);
    assert.equal(pass.status, 0, `${pass.stderr}\n${pass.stdout}`);
    assert.equal(pass.result?.verdict, 'PASS');

    const failedBundle = runStandalone(standaloneVerifierPath, reverted.root);
    assert.equal(failedBundle.status, 1, `${failedBundle.stderr}\n${failedBundle.stdout}`);
    assert.equal(
      failedBundle.result?.verdict,
      'FAIL',
      `${failedBundle.stderr}\n${failedBundle.stdout}`,
    );
    assert(failedBundle.result?.errors.some(error => error.includes('product-path:src/server.js')));

    const failedRelease = runStandalone(fullReleaseVerifierPath, reverted.root);
    assert.equal(failedRelease.status, 1, `${failedRelease.stderr}\n${failedRelease.stdout}`);
    assert.equal(
      failedRelease.result?.verdict,
      'FAIL',
      `${failedRelease.stderr}\n${failedRelease.stdout}`,
    );
    assert(failedRelease.result?.errors.some(error => error.includes('product-path:src/server.js')));
  } finally {
    rmSync(passing.root, { recursive: true, force: true });
    rmSync(reverted.root, { recursive: true, force: true });
  }
});

await testAsync('standalone CLI verifies mixed completed and N/A categories from actual Git bytes', async () => {
  const value = buildRealGitBundle({ nonApplicable: [2, 5] });
  try {
    const result = runStandalone(standaloneVerifierPath, value.root);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(result.result?.verdict, 'PASS');
    assert.equal(result.result?.receipts[9].payload.rotationsCompleted, 6);
    assert.equal(result.result?.receipts[9].payload.rotationsNotApplicable, 2);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

await testAsync('standalone CLI rejects replace refs, grafts and hidden index flags', async () => {
  const value = buildRealGitBundle();
  try {
    const replacement = fixtureGit(value.root, [
      'commit-tree', `${value.productCandidateSha}^{tree}`, '-m', 'replacement fixture',
    ]);
    fixtureGit(value.root, ['replace', value.productCandidateSha, replacement]);
    const replaceResult = runStandalone(standaloneVerifierPath, value.root);
    assert.equal(replaceResult.status, 1, `${replaceResult.stderr}\n${replaceResult.stdout}`);
    assert(replaceResult.result?.errors.includes('m6-git:replace-refs'));
    fixtureGit(value.root, ['replace', '-d', value.productCandidateSha]);

    const graftPath = path.join(value.root, '.git', 'info', 'grafts');
    writeFileSync(graftPath, `${value.productCandidateSha}\n`);
    const graftResult = runStandalone(standaloneVerifierPath, value.root);
    assert.equal(graftResult.status, 1, `${graftResult.stderr}\n${graftResult.stdout}`);
    assert(graftResult.result?.errors.includes('m6-git:grafts'));
    unlinkSync(graftPath);

    fixtureGit(value.root, ['update-index', '--assume-unchanged', 'src/server.js']);
    writeGitFixtureFile(value.root, 'src/server.js', 'export const hidden = true;\n');
    const assumeResult = runStandalone(standaloneVerifierPath, value.root);
    assert.equal(assumeResult.status, 1, `${assumeResult.stderr}\n${assumeResult.stdout}`);
    assert(assumeResult.result?.errors.some(error => error.startsWith('m6-git:index-flag:')));

    fixtureGit(value.root, ['update-index', '--no-assume-unchanged', 'src/server.js']);
    writeGitFixtureFile(value.root, 'src/server.js', 'export const serverFixture = true;\n');
    fixtureGit(value.root, ['update-index', '--skip-worktree', 'src/server.js']);
    writeGitFixtureFile(value.root, 'src/server.js', 'export const hiddenAgain = true;\n');
    const skipResult = runStandalone(standaloneVerifierPath, value.root);
    assert.equal(skipResult.status, 1, `${skipResult.stderr}\n${skipResult.stdout}`);
    assert(skipResult.result?.errors.some(error => error.startsWith('m6-git:index-flag:S:')));
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

summary();
