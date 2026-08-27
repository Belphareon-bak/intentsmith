#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  M6_ACCEPTANCE_RECEIPT_PATHS,
} from '../contracts/m6/acceptance-authority-v1.js';
import {
  M6_CANDIDATE_PHASE_IDS,
} from '../contracts/m6/candidate-plan-v1.js';
import {
  M6_RELEASE_EVIDENCE_INDEX_PATH,
} from '../contracts/m6/release-v1.js';
import { config } from '../src/config.js';
import {
  resolveM5ConditionalSurfaces,
} from '../src/release/conditional-surfaces.js';
import {
  applyM6AcceptanceReceipts,
} from '../src/release/m6-acceptance-authority.js';
import {
  validateM6ReleaseArtifactGitBlobs,
} from '../src/release/m6-release-artifact.js';
import {
  validateM6ReleaseEvidence,
  validateM6EvidenceCommitBoundary,
  validateM6ReleaseEvidenceIndex,
  validateM6ReportLogBindings,
  verifyM6GitArtifactBindings,
} from '../src/release/m6-release-validation.js';
import {
  evaluateM6TechnicalEvidence,
  projectM6ReleaseEvidence,
} from '../src/release/m6-technical-evidence.js';
import {
  loadTestRegistry,
  registryFingerprint,
} from './test-registry.js';

export const M6_RELEASE_EVIDENCE_PATH = M6_RELEASE_EVIDENCE_INDEX_PATH;

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function gitBytes(root, revision, artifactPath) {
  return execFileSync('git', ['show', `${revision}:${artifactPath}`], {
    cwd: root,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function gitArtifactReader(root, revision) {
  return async artifactPath => {
    const treeLine = git(root, ['ls-tree', revision, '--', artifactPath]);
    const match = /^(100644|100755) blob [a-f0-9]{40}\t(.+)$/u.exec(treeLine);
    if (!match || match[2] !== artifactPath) throw new Error('m6-evidence:not-git-blob');
    return {
      bytes: gitBytes(root, revision, artifactPath),
      executable: match[1] === '100755',
    };
  };
}

function gitObjectExists(root, revision, artifactPath) {
  return spawnSync('git', ['cat-file', '-e', `${revision}:${artifactPath}`], {
    cwd: root,
    stdio: 'ignore',
  }).status === 0;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label}:invalid-json`);
  }
}

function promoteReleaseArtifact(evidence, artifact) {
  const value = structuredClone(evidence);
  const row = value.checks.find(item => item.id === 'release-artifact');
  row.status = 'PASS';
  row.reasonCode = null;
  row.artifacts = [{ ...artifact }];
  return value;
}

export async function validateCurrentM6Release(root = process.cwd()) {
  const evidenceHeadSha = git(root, ['rev-parse', 'HEAD']);
  const worktreeClean = git(root, [
    'status', '--porcelain=v1', '--untracked-files=all',
  ]) === '';
  const registry = await loadTestRegistry(root);
  const fingerprint = registryFingerprint(registry);
  const conditional = resolveM5ConditionalSurfaces({ config });
  const readGitArtifact = gitArtifactReader(root, evidenceHeadSha);
  if (!gitObjectExists(root, evidenceHeadSha, M6_RELEASE_EVIDENCE_PATH)) {
    return Object.freeze({
      contract: 'M6ReleaseValidation',
      version: 1,
      valid: true,
      verdict: 'BLOCKED',
      exitCode: 2,
      errors: Object.freeze([]),
      reasonCode: 'M6_RELEASE_EVIDENCE_NOT_FOUND',
      candidateSha: evidenceHeadSha,
      evidenceHeadSha,
      registryFingerprint: fingerprint,
      evidencePath: M6_RELEASE_EVIDENCE_PATH,
    });
  }
  let index;
  try {
    index = parseJson(
      (await readGitArtifact(M6_RELEASE_EVIDENCE_PATH)).bytes,
      'm6-release-index',
    );
  } catch (error) {
    return Object.freeze({
      contract: 'M6ReleaseValidation',
      version: 1,
      valid: false,
      verdict: 'FAIL',
      exitCode: 1,
      errors: Object.freeze([error.message]),
      candidateSha: null,
      evidenceHeadSha,
      registryFingerprint: fingerprint,
      evidencePath: M6_RELEASE_EVIDENCE_PATH,
    });
  }
  const candidateSha = index.candidateSha;
  const ancestorProbe = spawnSync(
    'git',
    ['merge-base', '--is-ancestor', candidateSha, evidenceHeadSha],
    { cwd: root, stdio: 'ignore' },
  );
  const candidateIsAncestor = ancestorProbe.status === 0;
  let changedPaths = [];
  let candidateRegistryFingerprint = null;
  if (candidateIsAncestor) {
    changedPaths = git(root, [
      'diff', '--name-only', '--diff-filter=ACMR', `${candidateSha}..${evidenceHeadSha}`,
    ]).split('\n').filter(Boolean);
    try {
      const candidateRegistry = JSON.parse(git(root, [
        'show', `${candidateSha}:tests/registry.json`,
      ]));
      candidateRegistryFingerprint = registryFingerprint(candidateRegistry);
    } catch {
      candidateRegistryFingerprint = null;
    }
  }
  const boundary = validateM6EvidenceCommitBoundary({
    candidateSha,
    evidenceHeadSha,
    candidateIsAncestor,
    changedPaths,
    worktreeClean,
    candidateRegistryFingerprint,
    evidenceRegistryFingerprint: fingerprint,
  });
  const indexValidation = validateM6ReleaseEvidenceIndex(index, {
    candidateSha,
    registryFingerprint: fingerprint,
    expectedPhaseIds: M6_CANDIDATE_PHASE_IDS,
  });
  const pinnedBindings = [
    ...(index.reports || []).map(item => item.artifact),
    ...(index.reports || []).flatMap(item => (item.logs || []).map(log => log.artifact)),
    index.releaseArtifactManifest,
  ];
  const pinnedValidation = await verifyM6GitArtifactBindings(pinnedBindings, {
    readGitArtifact,
  });
  const structuralErrors = [
    ...boundary.errors,
    ...indexValidation.errors,
    ...pinnedValidation.errors,
  ];
  if (structuralErrors.length > 0) {
    return Object.freeze({
      contract: 'M6ReleaseValidation',
      version: 1,
      valid: false,
      verdict: 'FAIL',
      exitCode: 1,
      errors: Object.freeze(structuralErrors),
      candidateSha,
      evidenceHeadSha,
      evidenceBoundary: boundary,
      registryFingerprint: fingerprint,
      evidencePath: M6_RELEASE_EVIDENCE_PATH,
    });
  }

  const reports = [];
  const reportLogErrors = [];
  try {
    for (const item of index.reports) {
      const artifact = await readGitArtifact(item.artifact.path);
      const report = parseJson(artifact.bytes, `m6-report:${item.phaseId}`);
      const logValidation = validateM6ReportLogBindings(item, report);
      reportLogErrors.push(...logValidation.errors.map(error => `${item.phaseId}:${error}`));
      reports.push({
        report,
        artifact: item.artifact,
        logs: await Promise.all(item.logs.map(async log => ({
          programId: log.programId,
          bytes: (await readGitArtifact(log.artifact.path)).bytes,
        }))),
      });
    }
  } catch (error) {
    return Object.freeze({
      contract: 'M6ReleaseValidation',
      version: 1,
      valid: false,
      verdict: 'FAIL',
      exitCode: 1,
      errors: Object.freeze([error.message]),
      candidateSha,
      evidenceHeadSha,
      evidenceBoundary: boundary,
      registryFingerprint: fingerprint,
      evidencePath: M6_RELEASE_EVIDENCE_PATH,
    });
  }
  if (reportLogErrors.length > 0) {
    return Object.freeze({
      contract: 'M6ReleaseValidation',
      version: 1,
      valid: false,
      verdict: 'FAIL',
      exitCode: 1,
      errors: Object.freeze(reportLogErrors),
      candidateSha,
      evidenceHeadSha,
      evidenceBoundary: boundary,
      registryFingerprint: fingerprint,
      evidencePath: M6_RELEASE_EVIDENCE_PATH,
    });
  }
  const technical = evaluateM6TechnicalEvidence({
    candidateSha,
    registryFingerprint: fingerprint,
    registry,
    reports,
  });
  if (!technical.valid) {
    return Object.freeze({
      contract: 'M6ReleaseValidation',
      version: 1,
      valid: false,
      verdict: 'FAIL',
      exitCode: 1,
      errors: Object.freeze([...technical.errors]),
      candidateSha,
      evidenceHeadSha,
      evidenceBoundary: boundary,
      registryFingerprint: fingerprint,
      evidencePath: M6_RELEASE_EVIDENCE_PATH,
      technicalEvidence: technical,
    });
  }
  const manifestArtifact = await readGitArtifact(index.releaseArtifactManifest.path);
  let releaseArtifact;
  try {
    releaseArtifact = parseJson(manifestArtifact.bytes, 'm6-release-artifact');
  } catch (error) {
    return Object.freeze({
      contract: 'M6ReleaseValidation',
      version: 1,
      valid: false,
      verdict: 'FAIL',
      exitCode: 1,
      errors: Object.freeze([error.message]),
      candidateSha,
      evidenceHeadSha,
      evidenceBoundary: boundary,
      registryFingerprint: fingerprint,
      evidencePath: M6_RELEASE_EVIDENCE_PATH,
    });
  }
  const releaseArtifactValidation = await validateM6ReleaseArtifactGitBlobs(releaseArtifact, {
    candidateSha,
    readGitArtifact,
  });
  let evidence = projectM6ReleaseEvidence({
    candidateSha,
    registryFingerprint: fingerprint,
    generatedAt: index.generatedAt,
    technicalEvidence: technical,
  });
  if (releaseArtifactValidation.valid) {
    evidence = promoteReleaseArtifact(evidence, index.releaseArtifactManifest);
  }

  const receipts = [];
  const receiptArtifactBindings = [];
  const receiptErrors = [];
  for (const receiptPath of Object.values(M6_ACCEPTANCE_RECEIPT_PATHS)) {
    if (!gitObjectExists(root, evidenceHeadSha, receiptPath)) continue;
    try {
      const receipt = parseJson(
        (await readGitArtifact(receiptPath)).bytes,
        `m6-acceptance:${receiptPath}`,
      );
      receipts.push(receipt);
      receiptArtifactBindings.push(...(receipt.artifacts || []));
    } catch (error) {
      receiptErrors.push(error.message);
    }
  }
  const receiptArtifactValidation = await verifyM6GitArtifactBindings(
    receiptArtifactBindings,
    { readGitArtifact },
  );
  const promotion = applyM6AcceptanceReceipts(evidence, receipts);
  const acceptanceErrors = [
    ...receiptErrors,
    ...receiptArtifactValidation.errors,
    ...promotion.errors,
  ];
  if (promotion.valid) evidence = promotion.evidence;
  const validation = validateM6ReleaseEvidence(evidence, {
    candidateSha,
    worktreeClean: boundary.valid,
    registryFingerprint: fingerprint,
    expectedConditionalJourneys: conditional.requiredM6Journeys,
  });
  const derivedErrors = [
    ...technical.errors,
    ...releaseArtifactValidation.errors,
    ...acceptanceErrors,
    ...validation.errors,
  ];
  const finalValidation = derivedErrors.length === 0
    ? validation
    : Object.freeze({
      ...validation,
      valid: false,
      verdict: 'FAIL',
      exitCode: 1,
      errors: Object.freeze(derivedErrors),
    });
  return Object.freeze({
    ...finalValidation,
    candidateSha,
    evidenceHeadSha,
    evidenceBoundary: boundary,
    registryFingerprint: fingerprint,
    evidencePath: M6_RELEASE_EVIDENCE_PATH,
    indexSha256: createHash('sha256')
      .update((await readGitArtifact(M6_RELEASE_EVIDENCE_PATH)).bytes)
      .digest('hex'),
    technicalEvidence: technical,
    releaseArtifactValidation,
    acceptanceReceiptsFound: receipts.map(receipt => receipt.authorityId).sort(),
  });
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length > 0) throw new Error('M6 release validation accepts no arguments');
  const result = await validateCurrentM6Release();
  console.log(JSON.stringify(result, null, 2));
  return result.exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then(code => {
    process.exitCode = code;
  }).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
