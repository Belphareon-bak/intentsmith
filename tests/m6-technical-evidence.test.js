import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  M6_EXTERNAL_AUTHORITY_CHECKS,
} from '../contracts/m6/technical-evidence-v1.js';
import {
  M6_LONG_SOAK_PROGRAM,
  M6_MAX_THROUGHPUT_PROGRAM,
  M6_PREVIOUS_VERSION_SHA,
  M6_PREVIOUS_VERSION_UPGRADE_PROGRAM,
  M6_RUNTIME_EVIDENCE_MARKER,
} from '../contracts/m6/runtime-evidence-v1.js';
import {
  evaluateM6TechnicalEvidence,
  projectM6ReleaseEvidence,
  validateM6TechnicalProgramMap,
} from '../src/release/m6-technical-evidence.js';
import { buildM6CandidateExecutionPlan } from '../src/release/m6-candidate-plan.js';
import { suite, summary, test } from './harness.js';
import registry from './registry.json' with { type: 'json' };

const candidateSha = 'a'.repeat(40);
const registryFingerprint = 'b'.repeat(64);
const plan = buildM6CandidateExecutionPlan(registry);
const artifact = Object.freeze({
  path: '.intentsmith-artifacts/m6/report.json',
  bytes: 123,
  sha256: 'c'.repeat(64),
});

function passingResult(program) {
  const logBytes = logForProgram(program.id);
  return {
    id: program.id,
    required: true,
    status: 'PASS',
    exitCode: 0,
    signal: null,
    timedOut: false,
    sourceRevision: candidateSha,
    cleanup: { checked: true, leakDetected: false, terminated: true },
    sourceTree: { checked: true, clean: true, head: candidateSha },
    logSha256: createHash('sha256').update(logBytes).digest('hex'),
  };
}

function logForProgram(programId) {
  if (programId === M6_LONG_SOAK_PROGRAM) {
    const receipt = {
      contract: 'M6LongSoakReceipt',
      version: 1,
      candidateSha,
      durationMs: 86_400_001,
      requestCount: 86_000,
      healthRequests: 43_000,
      projectRequests: 43_000,
      errorCount: 0,
      latency: { samples: 86_000, p50Ms: 5, p95Ms: 15, p99Ms: 25, maxMs: 40 },
      rss: { startMiB: 100, peakMiB: 115, endMiB: 110, growthMiB: 10 },
      timerDriftMaxMs: 10,
      diagnostics: {
        activeRequests: 0,
        completedRequests: 86_000,
        http5xx: 0,
        outboundDecisionCount: 0,
        databaseReady: true,
        lifecycleRecoveryComplete: true,
      },
      networkScope: 'linux-user-network-namespace-loopback-only',
      namespaceInterfaces: ['lo'],
      serverCleanShutdown: true,
      forcedShutdown: false,
      budgets: {
        maximumP95Ms: 100,
        maximumP99Ms: 250,
        maximumRssMiB: 1_024,
        maximumRssGrowthMiB: 128,
        minimumRequestCount: 80_000,
      },
      verdict: 'PASS',
    };
    return `${M6_RUNTIME_EVIDENCE_MARKER}${Buffer.from(JSON.stringify(receipt)).toString('base64url')}\n`;
  }
  if (programId === M6_MAX_THROUGHPUT_PROGRAM) {
    const levels = [1, 8, 32, 128, 512, 1_024];
    const latency = samples => ({ samples, p50Ms: 5, p95Ms: 15, p99Ms: 25, maxMs: 40 });
    const rps = (requests, durationMs) => (
      Math.round((requests / (durationMs / 1_000)) * 1_000) / 1_000
    );
    const stages = levels.map((concurrency, index) => {
      const durationMs = 15_000;
      const successes = 15_000 * (index + 1);
      return {
        concurrency,
        durationMs,
        successes,
        errorCount: 0,
        requestsPerSecond: rps(successes, durationMs),
        latency: latency(successes),
        stable: true,
        sustained: false,
      };
    });
    const sustainedDurationMs = 210_001;
    const sustainedRequests = 300_000;
    stages.push({
      concurrency: 1_024,
      durationMs: sustainedDurationMs,
      successes: sustainedRequests,
      errorCount: 0,
      requestsPerSecond: rps(sustainedRequests, sustainedDurationMs),
      latency: latency(sustainedRequests),
      stable: true,
      sustained: true,
    });
    const completedRequests = stages.reduce((total, stage) => total + stage.successes, 0);
    const receipt = {
      contract: 'M6MaxThroughputReceipt',
      version: 1,
      candidateSha,
      durationMs: 300_001,
      surface: 'production-public-health-http',
      concurrencyLevels: levels,
      selectedConcurrency: 1_024,
      saturationObserved: false,
      ceilingReached: true,
      probeErrorCount: 0,
      stages,
      sustained: {
        durationMs: sustainedDurationMs,
        requests: sustainedRequests,
        errorCount: 0,
        requestsPerSecond: rps(sustainedRequests, sustainedDurationMs),
        latency: latency(sustainedRequests),
      },
      rss: {
        startMiB: 120,
        peakMiB: 260,
        endMiB: 180,
        growthMiB: 60,
        measurementError: null,
      },
      diagnostics: {
        activeRequests: 0,
        completedRequests,
        http5xx: 0,
        outboundDecisionCount: 0,
        databaseReady: true,
        lifecycleRecoveryComplete: true,
      },
      networkScope: 'linux-user-network-namespace-loopback-only',
      namespaceInterfaces: ['lo'],
      serverCleanShutdown: true,
      forcedShutdown: false,
      budgets: {
        maximumP95Ms: 100,
        maximumP99Ms: 250,
        maximumRssMiB: 1_536,
        maximumRssGrowthMiB: 512,
        minimumSustainedRequestsPerSecond: 500,
      },
      verdict: 'PASS',
    };
    return `${M6_RUNTIME_EVIDENCE_MARKER}${Buffer.from(JSON.stringify(receipt)).toString('base64url')}\n`;
  }
  if (programId !== M6_PREVIOUS_VERSION_UPGRADE_PROGRAM) return `PASS ${programId}\n`;
  const receipt = {
    contract: 'M6PreviousVersionUpgradeReceipt',
    version: 3,
    backupContentFingerprint: `sha256:${'d'.repeat(64)}`,
    backupDatabaseSha256: 'c'.repeat(64),
    candidateSha,
    previousSha: M6_PREVIOUS_VERSION_SHA,
    previousVersion: '136.0.0',
    currentVersion: '136.1.0',
    databaseFileIdentitySha256: 'e'.repeat(64),
    failedUpgradeExitCode: 1,
    failedUpgradeLogSha256: 'd'.repeat(64),
    failedUpgradeMigrationCount: 70,
    previousMigrationCount: 56,
    currentMigrationCount: 87,
    canary: {
      id: 1,
      name: 'M6 Upgrade Canary',
      description: 'created by the exact 136.0.0 application',
      type: 'general',
      survivedUpgrade: true,
    },
    previousServerCleanShutdown: true,
    restoreSafetyBackupCreated: true,
    restoreVerified: true,
    restoredDatabaseSha256: 'c'.repeat(64),
    restoredMigrationCount: 56,
    currentServerCleanShutdown: true,
    networkScope: 'linux-user-network-namespace-loopback-only',
    namespaceInterfaces: ['lo'],
    verdict: 'PASS',
  };
  return `${M6_RUNTIME_EVIDENCE_MARKER}${Buffer.from(JSON.stringify(receipt)).toString('base64url')}\n`;
}

function report(results, phase) {
  const options = phase.runner === 'nightly-audit'
    ? { ids: [...phase.programIds], concurrency: 1 }
    : {
        authority: {
          'm6-owned-program': 'm6-owned-production-server-v1',
          'm6-runner-owned-server-programs': 'm6-runner-owned-server-programs-v1',
          'm6-fresh-clone': 'm6-fresh-clone-install-build-studio-v1',
        }[phase.runner],
        acceptsArguments: false,
        concurrency: 1,
      };
  return {
    schemaVersion: 1,
    manifestType: 'intentsmith.audit-report',
    sourceRevision: candidateSha,
    registryHash: registryFingerprint,
    dryRun: false,
    options,
    results,
  };
}

function reportItem(phase, value = report(phase.programIds.map(programId => (
  passingResult(registry.suites.find(program => program.id === programId))
)), phase)) {
  return {
    phaseId: phase.id,
    runner: phase.runner,
    report: value,
    artifact,
    logs: value.results.map(result => ({
      programId: result.id,
      bytes: logForProgram(result.id),
    })),
  };
}

function reportItems() {
  return plan.phases.map(phase => reportItem(phase));
}

function findReportItem(items, programId) {
  return items.find(item => item.report.results.some(result => result.id === programId));
}

function evaluate(reports = reportItems()) {
  return evaluateM6TechnicalEvidence({
    candidateSha,
    registryFingerprint,
    registry,
    plan,
    reports,
  });
}

suite('M6 candidate technical evidence authority');

test('program map names exact active required registry evidence for every technical check', () => {
  const result = validateM6TechnicalProgramMap(registry);
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert(result.programSets['deterministic-offline-database'].length > 200);
  assert.deepEqual(result.programSets['soak-nightly-resources'], [
    M6_LONG_SOAK_PROGRAM,
    M6_MAX_THROUGHPUT_PROGRAM,
  ]);
});

test('implementation programs cannot override external or semantic L0 blockers', () => {
  const result = evaluate();
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.verdict, 'FAIL');
  for (const id of M6_EXTERNAL_AUTHORITY_CHECKS) {
    const row = result.checks.find(item => item.id === id);
    assert.equal(row.status, 'BLOCKED');
    assert.match(row.reasonCode, /REQUIRES_EXTERNAL_AUTHORITY$/u);
  }
  assert(result.checks
    .filter(row => !M6_EXTERNAL_AUTHORITY_CHECKS.includes(row.id))
    .every(row => row.status === 'PASS'));
  assert.equal(result.l0.find(row => row.id === 'L0-11').status, 'FAIL');
  assert.equal(result.l0.find(row => row.id === 'L0-12').status, 'NOT_RUN');
  assert(result.l0
    .filter(row => !['L0-11', 'L0-12'].includes(row.id))
    .every(row => row.status === 'PASS'));
  assert.equal(result.conditionalJourneys[0].status, 'PASS');
});

test('missing phase result invalidates evidence and a red execution is FAIL', () => {
  const remoteId = 'IS-T1-TESTS-M5-REMOTE-CORE-ADAPTER-TEST';
  const missingReports = reportItems();
  const missingItem = findReportItem(missingReports, remoteId);
  missingItem.report.results = missingItem.report.results.filter(item => item.id !== remoteId);
  missingItem.logs = missingItem.logs.filter(item => item.programId !== remoteId);
  const missing = evaluate(missingReports);
  assert.equal(missing.valid, false);
  assert.equal(missing.verdict, 'FAIL');

  const redReports = reportItems();
  const redItem = findReportItem(redReports, remoteId);
  redItem.report.results = redItem.report.results.map(item => (
    item.id === remoteId ? { ...item, status: 'FAIL', exitCode: 1 } : item
  ));
  const failed = evaluate(redReports);
  assert.equal(failed.checks.find(row => row.id === 'remote-core-port').status, 'FAIL');
  assert.equal(failed.verdict, 'FAIL');
});

test('blocked, timed out, leaked, dirty or wrong-candidate PASS cannot become evidence PASS', () => {
  const targetId = 'IS-T1-TESTS-M6-MODEL-DISCOVERY-JOURNEY-TEST';
  const variants = [
    item => ({ ...item, status: 'BLOCKED', exitCode: null }),
    item => ({ ...item, timedOut: true }),
    item => ({ ...item, cleanup: { ...item.cleanup, leakDetected: true } }),
    item => ({ ...item, sourceTree: { ...item.sourceTree, clean: false } }),
    item => ({ ...item, sourceRevision: 'e'.repeat(40) }),
  ];
  for (const mutate of variants) {
    const reports = reportItems();
    const item = findReportItem(reports, targetId);
    item.report.results = item.report.results.map(result => (
      result.id === targetId ? mutate(result) : result
    ));
    const result = evaluate(reports);
    assert.equal(result.checks.find(row => row.id === 'conditional-surfaces').status, 'FAIL');
  }
});

test('report candidate, registry, contract, artifact and duplicate program binding fail closed', () => {
  for (const mutate of [
    item => { item.report.sourceRevision = 'e'.repeat(40); },
    item => { item.report.registryHash = 'f'.repeat(64); },
    item => { item.report.manifestType = 'forged'; },
    item => { item.artifact.sha256 = 'bad'; },
    item => { item.report.results.push(item.report.results[0]); },
    item => { item.phaseId = plan.phases[1].id; },
    item => { item.runner = 'm6-owned-program'; },
  ]) {
    const reports = reportItems();
    const item = reports[0];
    item.artifact = { ...artifact };
    mutate(item);
    const result = evaluate(reports);
    assert.equal(result.valid, false);
    assert.equal(result.verdict, 'FAIL');
  }
});

test('forged report PASS without exact log bytes or runtime receipt fails closed', () => {
  const missingReports = reportItems();
  const missingLog = findReportItem(missingReports, M6_PREVIOUS_VERSION_UPGRADE_PROGRAM);
  missingLog.logs = missingLog.logs.filter(
    log => log.programId !== M6_PREVIOUS_VERSION_UPGRADE_PROGRAM,
  );
  assert.equal(evaluate(missingReports).valid, false);

  const forgedReports = reportItems();
  const forgedReceipt = findReportItem(forgedReports, M6_PREVIOUS_VERSION_UPGRADE_PROGRAM);
  const target = forgedReceipt.logs.find(
    log => log.programId === M6_PREVIOUS_VERSION_UPGRADE_PROGRAM,
  );
  target.bytes = 'PASS\n';
  const result = forgedReceipt.report.results.find(
    item => item.id === M6_PREVIOUS_VERSION_UPGRADE_PROGRAM,
  );
  result.logSha256 = createHash('sha256').update(target.bytes).digest('hex');
  assert.equal(evaluate(forgedReports).valid, false);
});

test('phase and runner binding reject a valid offline result relabelled as soak evidence', () => {
  const reports = reportItems();
  const offline = reports.find(item => item.phaseId === 'deterministic-offline-database');
  const soak = reports.find(item => item.phaseId === 'controlled-soak');
  [offline.report, soak.report] = [soak.report, offline.report];
  [offline.logs, soak.logs] = [soak.logs, offline.logs];
  const result = evaluate(reports);
  assert.equal(result.valid, false);
  assert(result.errors.some(error => error.includes('phase-programs')));
  assert(result.errors.some(error => error.includes('runner-authority')));
});

test('release projection removes diagnostic internals but preserves truthful blocking', () => {
  const technical = evaluate();
  const projected = projectM6ReleaseEvidence({
    candidateSha,
    registryFingerprint,
    generatedAt: '2026-08-27T00:00:00.000Z',
    technicalEvidence: technical,
  });
  assert.equal(projected.checks.find(row => row.id === 'm5-acceptance').status, 'BLOCKED');
  assert.deepEqual(Object.keys(projected.checks[0]).sort(), [
    'artifacts',
    'id',
    'reasonCode',
    'status',
  ]);
  assert.equal(Object.isFrozen(projected), true);
});

summary();
