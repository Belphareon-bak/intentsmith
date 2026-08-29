import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';

import {
  M6_CURRENT_VERSION_MIGRATION_COUNT,
  M6_LONG_SOAK_PROGRAM,
  M6_MAX_THROUGHPUT_PROGRAM,
  M6_PREVIOUS_VERSION_SHA,
  M6_PREVIOUS_VERSION_UPGRADE_PROGRAM,
  M6_RUNTIME_EVIDENCE_MARKER,
} from '../contracts/m6/runtime-evidence-v1.js';
import { validateM6RuntimeEvidence } from '../src/release/m6-runtime-evidence.js';
import { suite, summary, test } from './harness.js';

const candidateSha = 'a'.repeat(40);

function receipt(overrides = {}) {
  return {
    contract: 'M6PreviousVersionUpgradeReceipt',
    version: 3,
    backupContentFingerprint: `sha256:${'d'.repeat(64)}`,
    backupDatabaseSha256: 'e'.repeat(64),
    candidateSha,
    previousSha: M6_PREVIOUS_VERSION_SHA,
    previousVersion: '136.0.0',
    currentVersion: '136.1.0',
    databaseFileIdentitySha256: 'b'.repeat(64),
    failedUpgradeExitCode: 1,
    failedUpgradeLogSha256: 'f'.repeat(64),
    failedUpgradeMigrationCount: 70,
    previousMigrationCount: 56,
    currentMigrationCount: 90,
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
    restoredDatabaseSha256: 'e'.repeat(64),
    restoredMigrationCount: 56,
    currentServerCleanShutdown: true,
    networkScope: 'linux-user-network-namespace-loopback-only',
    namespaceInterfaces: ['lo'],
    verdict: 'PASS',
    ...overrides,
  };
}

function log(value = receipt()) {
  return `${M6_RUNTIME_EVIDENCE_MARKER}${Buffer.from(JSON.stringify(value)).toString('base64url')}\n`;
}

function diagnostics(completedRequests = 100_000) {
  return {
    activeRequests: 0,
    completedRequests,
    http5xx: 0,
    outboundDecisionCount: 0,
    databaseReady: true,
    lifecycleRecoveryComplete: true,
  };
}

function latency(samples, p95Ms = 15, p99Ms = 25) {
  return { samples, p50Ms: 7, p95Ms, p99Ms, maxMs: Math.max(40, p99Ms) };
}

function requestsPerSecond(requests, durationMs) {
  return Math.round((requests / (durationMs / 1_000)) * 1_000) / 1_000;
}

function longSoakReceipt(overrides = {}) {
  return {
    contract: 'M6LongSoakReceipt',
    version: 1,
    candidateSha,
    durationMs: 86_400_001,
    requestCount: 86_000,
    healthRequests: 43_000,
    projectRequests: 43_000,
    errorCount: 0,
    latency: latency(86_000),
    rss: { startMiB: 100, peakMiB: 115, endMiB: 110, growthMiB: 10 },
    timerDriftMaxMs: 12,
    diagnostics: diagnostics(86_000),
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
    ...overrides,
  };
}

function throughputReceipt(overrides = {}) {
  const levels = [1, 8, 32, 128, 512, 1_024];
  const stages = levels.map((concurrency, index) => {
    const durationMs = 15_000;
    const successes = 15_000 * (index + 1);
    return {
      concurrency,
      durationMs,
      successes,
      errorCount: 0,
      requestsPerSecond: requestsPerSecond(successes, durationMs),
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
    requestsPerSecond: requestsPerSecond(sustainedRequests, sustainedDurationMs),
    latency: latency(sustainedRequests),
    stable: true,
    sustained: true,
  });
  const completedRequests = stages.reduce((total, stage) => total + stage.successes, 0);
  return {
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
      requestsPerSecond: requestsPerSecond(sustainedRequests, sustainedDurationMs),
      latency: latency(sustainedRequests),
    },
    rss: {
      startMiB: 120,
      peakMiB: 260,
      endMiB: 180,
      growthMiB: 60,
      measurementError: null,
    },
    diagnostics: diagnostics(completedRequests),
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
    ...overrides,
  };
}

function saturatedThroughputReceipt() {
  const value = throughputReceipt();
  value.selectedConcurrency = 512;
  value.saturationObserved = true;
  value.ceilingReached = false;
  value.probeErrorCount = 1_024;
  value.stages[5] = {
    ...value.stages[5],
    successes: 0,
    errorCount: 1_024,
    requestsPerSecond: 0,
    latency: { samples: 0, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: 0 },
    stable: false,
  };
  value.stages.at(-1).concurrency = 512;
  value.diagnostics.completedRequests = value.stages.reduce(
    (total, stage) => total + stage.successes + stage.errorCount,
    0,
  );
  return value;
}

suite('M6 runtime evidence receipts');

test('current migration count stays bound to the release migration set', () => {
  const migrationCount = readdirSync(
    new URL('../src/db/migrations/', import.meta.url),
    { withFileTypes: true },
  ).filter(entry => entry.isFile() && entry.name.endsWith('.js')).length;
  assert.equal(M6_CURRENT_VERSION_MIGRATION_COUNT, migrationCount);
});

test('exact previous-version application receipt passes', () => {
  const result = validateM6RuntimeEvidence(
    M6_PREVIOUS_VERSION_UPGRADE_PROGRAM,
    log(),
    { candidateSha },
  );
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.receipt.canary.survivedUpgrade, true);
});

test('missing, duplicate, rebound and weaker upgrade receipts fail closed', () => {
  for (const bytes of [
    '',
    `${log()}${log()}`,
    log(receipt({ candidateSha: 'c'.repeat(40) })),
    log(receipt({ currentMigrationCount: 79 })),
    log(receipt({ previousServerCleanShutdown: false })),
    log(receipt({ failedUpgradeExitCode: 0 })),
    log(receipt({ failedUpgradeMigrationCount: 90 })),
    log(receipt({ restoredDatabaseSha256: '0'.repeat(64) })),
    log(receipt({ restoreVerified: false })),
    log(receipt({ networkScope: 'external' })),
    log(receipt({ namespaceInterfaces: ['lo', 'eth0'] })),
    log(receipt({ canary: { ...receipt().canary, description: 'forged' } })),
  ]) {
    assert.equal(validateM6RuntimeEvidence(
      M6_PREVIOUS_VERSION_UPGRADE_PROGRAM,
      bytes,
      { candidateSha },
    ).valid, false);
  }
});

test('exact 24-hour owned-server receipt passes', () => {
  const result = validateM6RuntimeEvidence(
    M6_LONG_SOAK_PROGRAM,
    log(longSoakReceipt()),
    { candidateSha },
  );
  assert.equal(result.valid, true, result.errors.join('\n'));
});

test('short, development-only, unbound and over-budget soak receipts fail closed', () => {
  for (const value of [
    longSoakReceipt({ durationMs: 10_000 }),
    longSoakReceipt({ verdict: 'DEV_ONLY' }),
    longSoakReceipt({ candidateSha: 'c'.repeat(40) }),
    longSoakReceipt({ latency: latency(86_000, 101, 200) }),
    longSoakReceipt({ namespaceInterfaces: ['lo', 'eth0'] }),
    longSoakReceipt({ serverCleanShutdown: false }),
  ]) {
    assert.equal(validateM6RuntimeEvidence(
      M6_LONG_SOAK_PROGRAM,
      log(value),
      { candidateSha },
    ).valid, false);
  }
});

test('exact maximum-throughput receipt passes', () => {
  for (const value of [throughputReceipt(), saturatedThroughputReceipt()]) {
    const result = validateM6RuntimeEvidence(
      M6_MAX_THROUGHPUT_PROGRAM,
      log(value),
      { candidateSha },
    );
    assert.equal(result.valid, true, result.errors.join('\n'));
  }
});

test('forged, short, slow and internally unbound throughput receipts fail closed', () => {
  const unboundStages = throughputReceipt().stages.map(stage => ({ ...stage }));
  unboundStages.at(-1).concurrency = 512;
  for (const value of [
    throughputReceipt({ durationMs: 20_000 }),
    throughputReceipt({ verdict: 'DEV_ONLY' }),
    throughputReceipt({ candidateSha: 'd'.repeat(40) }),
    throughputReceipt({ ceilingReached: false }),
    throughputReceipt({ selectedConcurrency: 512 }),
    throughputReceipt({ stages: unboundStages }),
    throughputReceipt({ sustained: { ...throughputReceipt().sustained, requestsPerSecond: 499 } }),
    throughputReceipt({ networkScope: 'host' }),
  ]) {
    assert.equal(validateM6RuntimeEvidence(
      M6_MAX_THROUGHPUT_PROGRAM,
      log(value),
      { candidateSha },
    ).valid, false);
  }
});

test('throughput receipt binds reported rates and full ramp plus sustained durations', () => {
  const forgedRate = throughputReceipt();
  forgedRate.stages[0].requestsPerSecond += 10_000;
  let result = validateM6RuntimeEvidence(
    M6_MAX_THROUGHPUT_PROGRAM,
    log(forgedRate),
    { candidateSha },
  );
  assert.equal(result.valid, false);
  assert(result.errors.includes('throughput-receipt:stage-rps-binding'));

  const shortRamp = throughputReceipt();
  shortRamp.stages[0].durationMs = 14_999;
  result = validateM6RuntimeEvidence(
    M6_MAX_THROUGHPUT_PROGRAM,
    log(shortRamp),
    { candidateSha },
  );
  assert.equal(result.valid, false);
  assert(result.errors.includes('throughput-receipt:ramp-duration'));

  const shortSustained = throughputReceipt();
  shortSustained.stages.at(-1).durationMs = 209_999;
  shortSustained.sustained.durationMs = 209_999;
  result = validateM6RuntimeEvidence(
    M6_MAX_THROUGHPUT_PROGRAM,
    log(shortSustained),
    { candidateSha },
  );
  assert.equal(result.valid, false);
  assert(result.errors.includes('throughput-receipt:sustained-duration'));

  const nonMonotonicRamp = throughputReceipt();
  nonMonotonicRamp.stages[4] = {
    ...nonMonotonicRamp.stages[4],
    successes: 0,
    errorCount: 10,
    requestsPerSecond: 0,
    latency: { samples: 0, p50Ms: null, p95Ms: null, p99Ms: null, maxMs: 0 },
    stable: false,
  };
  nonMonotonicRamp.probeErrorCount = 10;
  nonMonotonicRamp.diagnostics.completedRequests = nonMonotonicRamp.stages.reduce(
    (total, stage) => total + stage.successes + stage.errorCount,
    0,
  );
  result = validateM6RuntimeEvidence(
    M6_MAX_THROUGHPUT_PROGRAM,
    log(nonMonotonicRamp),
    { candidateSha },
  );
  assert.equal(result.valid, false);
  assert(result.errors.includes('throughput-receipt:selected-stage-binding'));

  const unownedRequest = throughputReceipt();
  unownedRequest.diagnostics.completedRequests += 1;
  result = validateM6RuntimeEvidence(
    M6_MAX_THROUGHPUT_PROGRAM,
    log(unownedRequest),
    { candidateSha },
  );
  assert.equal(result.valid, false);
  assert(result.errors.includes('throughput-receipt:completed-request-binding'));
});

summary();
