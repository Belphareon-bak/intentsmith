import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  M6_CANDIDATE_PHASE_IDS,
} from '../contracts/m6/candidate-plan-v1.js';
import {
  M6_L0_IDS,
  M6_RELEASE_EVIDENCE_CONTRACT,
  M6_RELEASE_EVIDENCE_INDEX_CONTRACT,
  M6_RELEASE_EVIDENCE_INDEX_VERSION,
  M6_RELEASE_EVIDENCE_VERSION,
  M6_REQUIRED_CHECK_IDS,
} from '../contracts/m6/release-v1.js';
import {
  validateM6ReleaseEvidence,
  validateM6EvidenceCommitBoundary,
  validateM6ReleaseEvidenceIndex,
  validateM6ReportLogBindings,
  verifyM6ArtifactBindings,
  verifyM6GitArtifactBindings,
} from '../src/release/m6-release-validation.js';
import { suite, summary, testAsync } from './harness.js';

const candidateSha = 'a'.repeat(40);
const registryFingerprint = 'b'.repeat(64);
const journeyId = 'M6-JOURNEY-MODEL-DISCOVERY-V1';
const artifactBytes = Buffer.from('m6 evidence fixture\n');
const artifact = Object.freeze({
  path: '.intentsmith-artifacts/m6/fixture.txt',
  sha256: createHash('sha256').update(artifactBytes).digest('hex'),
  bytes: artifactBytes.length,
});

function row(id, status = 'PASS') {
  return {
    id,
    status,
    reasonCode: status === 'PASS' ? null : `M6_${status}`,
    artifacts: status === 'PASS' ? [{ ...artifact }] : [],
  };
}

function evidence(overrides = {}) {
  return {
    contract: M6_RELEASE_EVIDENCE_CONTRACT,
    version: M6_RELEASE_EVIDENCE_VERSION,
    candidateSha,
    registryFingerprint,
    generatedAt: '2026-08-27T00:00:00.000Z',
    checks: M6_REQUIRED_CHECK_IDS.map(id => row(id)),
    l0: M6_L0_IDS.map(id => row(id)),
    conditionalJourneys: [{
      journeyId,
      status: 'PASS',
      reasonCode: null,
      artifacts: [{ ...artifact }],
    }],
    ...overrides,
  };
}

function validate(value, overrides = {}) {
  return validateM6ReleaseEvidence(value, {
    candidateSha,
    worktreeClean: true,
    registryFingerprint,
    expectedConditionalJourneys: [journeyId],
    ...overrides,
  });
}

suite('M6 executable release contract');

await testAsync('all required checks, L0 rows and derived conditional journeys yield PASS', async () => {
  const result = validate(evidence());
  assert.equal(result.valid, true);
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.exitCode, 0);
  assert.equal(Object.isFrozen(result), true);
});

await testAsync('BLOCKED and NOT_RUN remain release-blocking without becoming malformed evidence', async () => {
  for (const status of ['BLOCKED', 'NOT_RUN']) {
    const value = evidence();
    value.checks[0] = row(value.checks[0].id, status);
    const result = validate(value);
    assert.equal(result.valid, true);
    assert.equal(result.verdict, 'BLOCKED');
    assert.equal(result.exitCode, 2);
  }
});

await testAsync('a required FAIL cannot be translated to BLOCKED or PASS', async () => {
  const value = evidence();
  value.l0[4] = row('L0-5', 'FAIL');
  const result = validate(value);
  assert.equal(result.valid, true);
  assert.equal(result.verdict, 'FAIL');
  assert.equal(result.exitCode, 1);
});

await testAsync('candidate, clean tree and registry bindings come from trusted runtime context', async () => {
  assert.equal(validate(evidence(), { candidateSha: 'c'.repeat(40) }).valid, false);
  assert.equal(validate(evidence(), { worktreeClean: false }).valid, false);
  assert.equal(validate(evidence(), { registryFingerprint: 'd'.repeat(64) }).valid, false);
});

await testAsync('missing, duplicate, invented or unreviewed matrix rows fail closed', async () => {
  for (const mutate of [
    value => value.checks.pop(),
    value => { value.checks[1].id = value.checks[0].id; },
    value => { value.checks[0].id = 'invented-check'; },
    value => { value.l0.pop(); },
  ]) {
    const value = evidence();
    mutate(value);
    assert.equal(validate(value).valid, false);
  }
});

await testAsync('enabled supported conditional journeys are exact and cannot be caller-omitted', async () => {
  const missing = evidence({ conditionalJourneys: [] });
  assert.equal(validate(missing).valid, false);
  assert.equal(validate(evidence(), { expectedConditionalJourneys: [] }).valid, false);
});

await testAsync('PASS always requires at least one content-addressed artifact', async () => {
  const value = evidence();
  value.checks[0].artifacts = [];
  const result = validate(value);
  assert.equal(result.valid, false);
  assert(result.errors.some(error => error.includes('pass-without-artifact')));
});

await testAsync('artifact verifier binds bytes and rejects symlinked evidence', async () => {
  const root = process.env.INTENTSMITH_TEST_ARTIFACT_DIR;
  const target = path.join(root, artifact.path);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, artifactBytes);
  assert.equal((await verifyM6ArtifactBindings(root, evidence())).valid, true);

  const wrong = evidence();
  wrong.checks[0].artifacts[0].sha256 = '0'.repeat(64);
  assert.equal((await verifyM6ArtifactBindings(root, wrong)).valid, false);

  const linkPath = path.join(root, '.intentsmith-artifacts/m6/link.txt');
  await symlink(target, linkPath);
  const linked = evidence();
  linked.checks[0].artifacts[0] = {
    ...artifact,
    path: '.intentsmith-artifacts/m6/link.txt',
  };
  assert.equal((await verifyM6ArtifactBindings(root, linked)).valid, false);
});

await testAsync('Git evidence index requires one pinned report per locked phase', async () => {
  const binding = phaseId => ({
    path: `docs/execution/runs/m6/${phaseId}.json`,
    sha256: artifact.sha256,
    bytes: artifact.bytes,
  });
  const index = {
    contract: M6_RELEASE_EVIDENCE_INDEX_CONTRACT,
    version: M6_RELEASE_EVIDENCE_INDEX_VERSION,
    candidateSha,
    registryFingerprint,
    generatedAt: '2026-08-27T00:00:00.000Z',
    reports: M6_CANDIDATE_PHASE_IDS.map(phaseId => ({
      phaseId,
      artifact: binding(phaseId),
      logs: [],
    })),
    releaseArtifactManifest: binding('release-manifest'),
  };
  const validateIndex = value => validateM6ReleaseEvidenceIndex(value, {
    candidateSha,
    registryFingerprint,
    expectedPhaseIds: M6_CANDIDATE_PHASE_IDS,
  });
  assert.equal(validateIndex(index).valid, true);
  const missing = structuredClone(index);
  missing.reports.pop();
  assert.equal(validateIndex(missing).valid, false);
  const ignored = structuredClone(index);
  ignored.reports[0].artifact.path = '.intentsmith-artifacts/m6/forged.json';
  assert.equal(validateIndex(ignored).valid, false);
});

await testAsync('each report result is bound to its exact pinned Git log', async () => {
  const report = {
    results: [{ id: 'PROGRAM-A', logPath: artifact.path, logSha256: artifact.sha256 }],
  };
  const indexReport = {
    phaseId: 'phase-a',
    artifact,
    logs: [{ programId: 'PROGRAM-A', artifact }],
  };
  assert.equal(validateM6ReportLogBindings(indexReport, report).valid, true);
  const missing = structuredClone(indexReport);
  missing.logs = [];
  assert.equal(validateM6ReportLogBindings(missing, report).valid, false);
  const rebound = structuredClone(indexReport);
  rebound.logs[0].artifact.sha256 = '0'.repeat(64);
  assert.equal(validateM6ReportLogBindings(rebound, report).valid, false);
});

await testAsync('Git artifact bindings are derived from pinned bytes, never local files', async () => {
  let reads = 0;
  const reader = async artifactPath => {
    reads += 1;
    assert.equal(artifactPath, artifact.path);
    return { bytes: artifactBytes, executable: false };
  };
  assert.equal((await verifyM6GitArtifactBindings([artifact], {
    readGitArtifact: reader,
  })).valid, true);
  assert.equal(reads, 1);
  assert.equal((await verifyM6GitArtifactBindings([{ ...artifact, sha256: '0'.repeat(64) }], {
    readGitArtifact: reader,
  })).valid, false);
  assert.equal((await verifyM6GitArtifactBindings([artifact], {
    readGitArtifact: async () => { throw new Error('missing'); },
  })).valid, false);
});

await testAsync('evidence-only descendant may record review without rebinding product candidate', async () => {
  const result = validateM6EvidenceCommitBoundary({
    candidateSha,
    evidenceHeadSha: 'c'.repeat(40),
    candidateIsAncestor: true,
    changedPaths: [
      'ROADMAP.md',
      'docs/execution/runs/m6-closeout.md',
      'docs/review/2026-08-27-M6-REVIEW.md',
    ],
    worktreeClean: true,
    candidateRegistryFingerprint: registryFingerprint,
    evidenceRegistryFingerprint: registryFingerprint,
  });
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.evidenceOnly, true);
});

await testAsync('product, registry, ancestry and dirty drift behind evidence commit fail closed', async () => {
  const base = {
    candidateSha,
    evidenceHeadSha: 'c'.repeat(40),
    candidateIsAncestor: true,
    changedPaths: ['docs/review/m6.md'],
    worktreeClean: true,
    candidateRegistryFingerprint: registryFingerprint,
    evidenceRegistryFingerprint: registryFingerprint,
  };
  for (const mutate of [
    value => { value.changedPaths = ['src/server.js']; },
    value => { value.evidenceRegistryFingerprint = 'd'.repeat(64); },
    value => { value.candidateIsAncestor = false; },
    value => { value.worktreeClean = false; },
  ]) {
    const value = structuredClone(base);
    mutate(value);
    assert.equal(validateM6EvidenceCommitBoundary(value).valid, false);
  }
});

summary();
