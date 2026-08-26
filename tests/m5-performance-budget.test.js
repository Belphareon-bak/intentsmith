#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  M5_PERFORMANCE_EVIDENCE_CONTRACT,
  M5_PERFORMANCE_EVIDENCE_VERSION,
  M5_PERFORMANCE_RAW_ARTIFACT_CONTRACT,
  M5_PERFORMANCE_RAW_ARTIFACT_VERSION,
  validateM5PerformanceEvidenceV2,
  validateM5PerformanceRawArtifactV1,
} from '../contracts/m5/performance-v2.js';
import {
  M5_PERFORMANCE_BUDGETS,
  derivePinnedPerformanceMetrics,
  evaluateM5PerformanceEvidence,
  nearestRank,
  summarizePerformanceMeasurement,
} from '../src/observability/performance-budget.js';
import { publishPerformanceArtifactExclusive } from '../src/observability/performance-artifact-store.js';
import { suite, summary, test } from './harness.js';

const repositoryRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)));

function git(args, cwd = repositoryRoot) {
  return execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8' }).trim();
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function measurement(surface, overrides = {}) {
  const latenciesMs = overrides.latenciesMs ?? Array.from({ length: 20 }, (_, index) => index + 1);
  return {
    surface,
    sampleCount: latenciesMs.length,
    errorCount: 0,
    latenciesMs,
    durationMs: 10_000,
    operations: latenciesMs.length,
    rss: { startMiB: 100, peakMiB: 120, endMiB: 110 },
    ...overrides,
  };
}

function rawArtifact(candidateRevision, candidateTree, host, measuredAtIso) {
  return {
    contract: M5_PERFORMANCE_RAW_ARTIFACT_CONTRACT,
    version: M5_PERFORMANCE_RAW_ARTIFACT_VERSION,
    candidateRevision,
    candidateTree,
    measuredAtIso,
    host,
    measurements: [
      measurement('chat.deterministic-http'),
      measurement('code-intelligence.project-context'),
      measurement('core.deterministic-soak', {
        latenciesMs: Array.from({ length: 1_000 }, () => 10),
        durationMs: 300_000,
        operations: 1_000,
      }),
    ],
  };
}

function pinnedBaselines() {
  return Object.values(M5_PERFORMANCE_BUDGETS.pinned).map(item => ({
    surface: item.surface,
    sourceRevision: item.sourceRevision,
    sourcePath: item.sourcePath,
    sourceBlobOid: item.sourceBlobOid,
    sourceSha256: item.sourceSha256,
  }));
}

function evidenceFixture(root = repositoryRoot) {
  const candidateRevision = git(['rev-parse', 'HEAD'], root);
  const candidateTree = git(['rev-parse', 'HEAD^{tree}'], root);
  const measuredAtIso = '2026-08-26T12:00:00.000Z';
  const host = { platform: 'linux', arch: 'x64', node: 'v22.0.0' };
  const artifact = rawArtifact(candidateRevision, candidateTree, host, measuredAtIso);
  const bytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  const relativePath = `.intentsmith-artifacts/m5-performance-test-${randomBytes(8).toString('hex')}.raw.json`;
  const artifactPath = path.join(root, relativePath);
  mkdirSync(path.dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, bytes, { flag: 'wx', mode: 0o600 });
  const evidence = {
    contract: M5_PERFORMANCE_EVIDENCE_CONTRACT,
    version: M5_PERFORMANCE_EVIDENCE_VERSION,
    candidateRevision,
    candidateTree,
    measuredAtIso,
    host,
    measurementArtifact: {
      path: relativePath,
      sha256: sha256(bytes),
      byteLength: bytes.byteLength,
    },
    pinnedBaselines: pinnedBaselines(),
    gpuDisposition: {
      currentMeasurement: 'not_run_foreign_activity',
      reason: 'shared compute is active',
      pinnedSurface: 'model.vram-authority',
    },
  };
  return {
    artifact,
    artifactPath,
    bytes,
    evidence,
    evaluate(options = {}) {
      return evaluateM5PerformanceEvidence(evidence, {
        repositoryRoot: root,
        expectedCandidateRevision: candidateRevision,
        ...options,
      });
    },
    cleanup() { rmSync(artifactPath, { force: true }); },
  };
}

suite('M5 performance evidence and release budgets');

test('nearest-rank p95 does not silently interpolate or discard the slow sample', () => {
  assert.equal(nearestRank([1, 2, 3, 4, 100], 95), 100);
  assert.equal(nearestRank(Array.from({ length: 20 }, (_, index) => index + 1), 95), 19);
  assert.throws(() => nearestRank([1, -1], 95), /invalid-sample/);
});

test('raw samples have their own strict content contract', () => {
  const fixture = evidenceFixture();
  try {
    assert.deepEqual(validateM5PerformanceRawArtifactV1(fixture.artifact).errors, []);
    fixture.artifact.measurements[0].latenciesMs.pop();
    assert.equal(validateM5PerformanceRawArtifactV1(fixture.artifact).valid, false);
  } finally { fixture.cleanup(); }
});

test('valid evidence derives current and pinned metrics from exact sources', () => {
  const fixture = evidenceFixture();
  try {
    assert.deepEqual(validateM5PerformanceEvidenceV2(fixture.evidence).errors, []);
    const result = fixture.evaluate();
    assert.equal(result.verdict, 'PASS', result.errors.join(', '));
    assert.equal(result.checks.every(check => check.passed), true);
    assert.deepEqual(
      result.pinnedSummaries.find(item => item.surface === 'chat.model-http').metrics,
      { coldMs: 51_206, warmP95Ms: 55_257, throughputTurnsPerMinute: 1.11 },
    );
    assert.deepEqual(
      result.pinnedSummaries.find(item => item.surface === 'studio.production-journey').metrics,
      { deterministicMs: 7, modelMs: 52_267 },
    );
  } finally { fixture.cleanup(); }
});

test('summary computes p50, p95, error rate and RSS growth from raw samples', () => {
  const result = summarizePerformanceMeasurement(measurement('summary', {
    errorCount: 1,
    latenciesMs: [1, 2, 3, 100],
    rss: { startMiB: 100, peakMiB: 140, endMiB: 125 },
  }));
  assert.equal(result.p50Ms, 2);
  assert.equal(result.p95Ms, 100);
  assert.equal(result.errorRateBps, 2_500);
  assert.equal(result.rssGrowthMiB, 25);
});

test('one slow p95 fails instead of being averaged away', () => {
  const fixture = evidenceFixture();
  try {
    fixture.artifact.measurements[0].latenciesMs[17] = 101;
    fixture.artifact.measurements[0].latenciesMs[18] = 101;
    const bytes = Buffer.from(`${JSON.stringify(fixture.artifact, null, 2)}\n`);
    writeFileSync(fixture.artifactPath, bytes);
    fixture.evidence.measurementArtifact.sha256 = sha256(bytes);
    fixture.evidence.measurementArtifact.byteLength = bytes.byteLength;
    const result = fixture.evaluate();
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.checks.some(check => check.id.endsWith(':p95') && !check.passed), true);
  } finally { fixture.cleanup(); }
});

test('short soak, RSS leak and any request error are independent blockers', () => {
  const fixture = evidenceFixture();
  try {
    const soak = fixture.artifact.measurements[2];
    soak.durationMs = 299_999;
    soak.errorCount = 1;
    soak.rss.endMiB = 200;
    soak.rss.peakMiB = 200;
    const bytes = Buffer.from(`${JSON.stringify(fixture.artifact, null, 2)}\n`);
    writeFileSync(fixture.artifactPath, bytes);
    fixture.evidence.measurementArtifact.sha256 = sha256(bytes);
    fixture.evidence.measurementArtifact.byteLength = bytes.byteLength;
    const failed = fixture.evaluate().checks.filter(check => !check.passed).map(check => check.id);
    assert.equal(failed.includes('core.deterministic-soak:duration'), true);
    assert.equal(failed.includes('core.deterministic-soak:errors'), true);
    assert.equal(failed.includes('core.deterministic-soak:rss-growth'), true);
  } finally { fixture.cleanup(); }
});

test('forged candidate revision and tree cannot pass even with zero latencies', () => {
  const fixture = evidenceFixture();
  try {
    fixture.evidence.candidateRevision = '0'.repeat(40);
    fixture.artifact.candidateRevision = '0'.repeat(40);
    const result = evaluateM5PerformanceEvidence(fixture.evidence, {
      repositoryRoot,
      expectedCandidateRevision: git(['rev-parse', 'HEAD']),
    });
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.errors.includes('performance-candidate:revision-mismatch'), true);
  } finally { fixture.cleanup(); }
});

test('missing, truncated or digest-mismatched raw artifact fails before budgets', () => {
  const fixture = evidenceFixture();
  try {
    fixture.evidence.measurementArtifact.sha256 = '0'.repeat(64);
    let result = fixture.evaluate();
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.errors.includes('performance-artifact:sha256-mismatch'), true);

    fixture.evidence.measurementArtifact.sha256 = sha256(fixture.bytes);
    writeFileSync(fixture.artifactPath, fixture.bytes.subarray(0, fixture.bytes.length - 1));
    result = fixture.evaluate();
    assert.equal(result.errors.includes('performance-artifact:byte-length-mismatch'), true);

    rmSync(fixture.artifactPath);
    result = fixture.evaluate();
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.checks.length, 0);
  } finally { fixture.cleanup(); }
});

test('pinned Git blob identity and SHA-256 cannot be rebound by caller data', () => {
  const fixture = evidenceFixture();
  try {
    fixture.evidence.pinnedBaselines[0].sourceSha256 = '0'.repeat(64);
    const result = fixture.evaluate();
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.errors[0], 'performance-source:chat.model-http:sourceSha256-mismatch');
    assert.equal('metrics' in fixture.evidence.pinnedBaselines[0], false);
  } finally { fixture.cleanup(); }
});

test('missing repository authority and missing Git source fail closed', () => {
  const fixture = evidenceFixture();
  try {
    let result = evaluateM5PerformanceEvidence(fixture.evidence, {
      expectedCandidateRevision: fixture.evidence.candidateRevision,
    });
    assert.equal(result.errors[0], 'performance-authority:repository-root-required');

    const budgets = structuredClone(M5_PERFORMANCE_BUDGETS);
    const model = budgets.pinned.model;
    model.sourcePath = 'docs/does-not-exist.md';
    fixture.evidence.pinnedBaselines[0].sourcePath = model.sourcePath;
    result = fixture.evaluate({ budgets });
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.errors[0].startsWith('Command failed:'), true);
  } finally { fixture.cleanup(); }
});

test('dirty candidate is rejected when clean binding is required', () => {
  const fixture = evidenceFixture();
  try {
    const dirtyPath = path.join(repositoryRoot, `.m5-performance-dirty-${randomBytes(8).toString('hex')}`);
    writeFileSync(dirtyPath, 'dirty\n', { flag: 'wx' });
    try {
      const result = fixture.evaluate({ requireCleanWorktree: true });
      assert.equal(result.verdict, 'FAIL');
      assert.equal(result.errors.includes('performance-candidate:dirty-worktree'), true);
    } finally { rmSync(dirtyPath, { force: true }); }
  } finally { fixture.cleanup(); }
});

test('source extractors reject ambiguous or unsupported prose', () => {
  const source = readFileSync(path.join(repositoryRoot, 'docs/execution/runs/m1-b6-fresh-install-20260823.md'));
  const duplicate = Buffer.concat([source, Buffer.from('\n'), source]);
  assert.throws(
    () => derivePinnedPerformanceMetrics('chat.model-http', duplicate),
    /expected-one-match:2/,
  );
  assert.throws(() => derivePinnedPerformanceMetrics('unknown', source), /unsupported-surface/);
});

test('malformed evidence fails closed before any source or budget comparison', () => {
  const fixture = evidenceFixture();
  try {
    fixture.evidence.measurementArtifact.byteLength = 0;
    const result = fixture.evaluate();
    assert.equal(result.verdict, 'FAIL');
    assert.equal(result.checks.length, 0);
    assert.equal(result.errors.some(error => error.includes('invalid-byteLength')), true);
  } finally { fixture.cleanup(); }
});

test('artifact publication is durable, mode-private and never clobbers an existing path', () => {
  const artifactPath = path.join(
    repositoryRoot,
    '.intentsmith-artifacts',
    `m5-performance-publication-${randomBytes(8).toString('hex')}.json`,
  );
  const original = Buffer.from('owned evidence\n');
  try {
    const receipt = publishPerformanceArtifactExclusive(artifactPath, original);
    assert.equal(receipt.sha256, sha256(original));
    assert.equal(receipt.byteLength, original.byteLength);
    assert.throws(
      () => publishPerformanceArtifactExclusive(artifactPath, Buffer.from('replacement\n')),
      error => error?.code === 'EEXIST',
    );
    assert.deepEqual(readFileSync(artifactPath), original);
  } finally { rmSync(artifactPath, { force: true }); }
});

summary();
