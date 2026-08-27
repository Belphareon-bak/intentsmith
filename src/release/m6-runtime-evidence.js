import {
  M6_CURRENT_VERSION,
  M6_LONG_SOAK_CONTRACT,
  M6_LONG_SOAK_DURATION_MS,
  M6_LONG_SOAK_PROGRAM,
  M6_LONG_SOAK_VERSION,
  M6_MAX_THROUGHPUT_CONTRACT,
  M6_MAX_THROUGHPUT_DURATION_MS,
  M6_MAX_THROUGHPUT_PROGRAM,
  M6_MAX_THROUGHPUT_RAMP_DURATION_MS,
  M6_MAX_THROUGHPUT_SUSTAINED_DURATION_MS,
  M6_MAX_THROUGHPUT_VERSION,
  M6_PREVIOUS_VERSION,
  M6_PREVIOUS_VERSION_SHA,
  M6_PREVIOUS_VERSION_UPGRADE_CONTRACT,
  M6_PREVIOUS_VERSION_UPGRADE_PROGRAM,
  M6_PREVIOUS_VERSION_UPGRADE_VERSION,
  M6_RUNTIME_EVIDENCE_MARKER,
  M6_RUNTIME_EVIDENCE_PROGRAMS,
} from '../../contracts/m6/runtime-evidence-v1.js';

const SHA_PATTERN = /^[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const UPGRADE_KEYS = Object.freeze([
  'candidateSha',
  'canary',
  'contract',
  'currentMigrationCount',
  'currentServerCleanShutdown',
  'currentVersion',
  'databaseIdentitySha256',
  'networkScope',
  'previousMigrationCount',
  'previousServerCleanShutdown',
  'previousSha',
  'previousVersion',
  'verdict',
  'version',
]);
const LATENCY_KEYS = Object.freeze(['maxMs', 'p50Ms', 'p95Ms', 'p99Ms', 'samples']);
const DIAGNOSTIC_KEYS = Object.freeze([
  'activeRequests',
  'completedRequests',
  'databaseReady',
  'http5xx',
  'lifecycleRecoveryComplete',
  'outboundDecisionCount',
]);
const LONG_SOAK_KEYS = Object.freeze([
  'budgets',
  'candidateSha',
  'contract',
  'diagnostics',
  'durationMs',
  'errorCount',
  'forcedShutdown',
  'healthRequests',
  'latency',
  'namespaceInterfaces',
  'networkScope',
  'projectRequests',
  'requestCount',
  'rss',
  'serverCleanShutdown',
  'timerDriftMaxMs',
  'verdict',
  'version',
]);
const THROUGHPUT_KEYS = Object.freeze([
  'budgets',
  'candidateSha',
  'ceilingReached',
  'concurrencyLevels',
  'contract',
  'diagnostics',
  'durationMs',
  'forcedShutdown',
  'namespaceInterfaces',
  'networkScope',
  'probeErrorCount',
  'rss',
  'saturationObserved',
  'selectedConcurrency',
  'serverCleanShutdown',
  'stages',
  'surface',
  'sustained',
  'verdict',
  'version',
]);

function safeIntegerAtLeast(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function finiteAtLeast(value, minimum = 0) {
  return Number.isFinite(value) && value >= minimum;
}

function derivedRequestsPerSecond(successes, durationMs) {
  if (!safeIntegerAtLeast(successes) || !safeIntegerAtLeast(durationMs, 1)) return null;
  return Math.round((successes / (durationMs / 1_000)) * 1_000) / 1_000;
}

function validateCandidate(receipt, candidateSha, prefix, errors) {
  if (!SHA_PATTERN.test(candidateSha || '') || receipt.candidateSha !== candidateSha) {
    errors.push(`${prefix}:candidate`);
  }
}

function validateLatency(
  value,
  { samples, maximumP95Ms, maximumP99Ms, allowEmpty = false },
  prefix,
  errors,
) {
  if (!exactKeys(value, LATENCY_KEYS)) {
    errors.push(`${prefix}:latency-keys`);
    return;
  }
  if (!safeIntegerAtLeast(value.samples, allowEmpty ? 0 : 1) || value.samples !== samples) {
    errors.push(`${prefix}:latency-samples`);
  }
  if (allowEmpty && value.samples === 0) {
    if (value.p50Ms !== null
      || value.p95Ms !== null
      || value.p99Ms !== null
      || value.maxMs !== 0) errors.push(`${prefix}:empty-latency-values`);
    return;
  }
  if (![value.p50Ms, value.p95Ms, value.p99Ms, value.maxMs]
    .every(item => safeIntegerAtLeast(item))) errors.push(`${prefix}:latency-values`);
  if (!(value.p50Ms <= value.p95Ms
    && value.p95Ms <= value.p99Ms
    && value.p99Ms <= value.maxMs)) errors.push(`${prefix}:latency-order`);
  if (value.p95Ms > maximumP95Ms) errors.push(`${prefix}:p95-budget`);
  if (value.p99Ms > maximumP99Ms) errors.push(`${prefix}:p99-budget`);
}

function validateDiagnostics(value, prefix, errors) {
  if (!exactKeys(value, DIAGNOSTIC_KEYS)) {
    errors.push(`${prefix}:diagnostic-keys`);
    return;
  }
  if (!safeIntegerAtLeast(value.activeRequests) || value.activeRequests > 1) {
    errors.push(`${prefix}:active-requests`);
  }
  if (!safeIntegerAtLeast(value.completedRequests, 1)) errors.push(`${prefix}:completed-requests`);
  if (value.http5xx !== 0) errors.push(`${prefix}:http-5xx`);
  if (value.outboundDecisionCount !== 0) errors.push(`${prefix}:outbound`);
  if (value.databaseReady !== true) errors.push(`${prefix}:database`);
  if (value.lifecycleRecoveryComplete !== true) errors.push(`${prefix}:recovery`);
}

function validateRuntimeBoundary(receipt, prefix, errors) {
  if (receipt.networkScope !== 'linux-user-network-namespace-loopback-only') {
    errors.push(`${prefix}:network-scope`);
  }
  if (JSON.stringify(receipt.namespaceInterfaces) !== JSON.stringify(['lo'])) {
    errors.push(`${prefix}:namespace-interfaces`);
  }
  if (receipt.serverCleanShutdown !== true || receipt.forcedShutdown !== false) {
    errors.push(`${prefix}:shutdown`);
  }
  if (receipt.verdict !== 'PASS') errors.push(`${prefix}:verdict`);
}

function exactKeys(value, expected) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function extractReceipt(logBytes, errors) {
  if (!(typeof logBytes === 'string' || Buffer.isBuffer(logBytes))) {
    errors.push('runtime-receipt:log-bytes');
    return null;
  }
  const lines = String(logBytes).split(/\r?\n/u)
    .filter(line => line.startsWith(M6_RUNTIME_EVIDENCE_MARKER));
  if (lines.length !== 1) {
    errors.push('runtime-receipt:exact-marker');
    return null;
  }
  try {
    const encoded = lines[0].slice(M6_RUNTIME_EVIDENCE_MARKER.length);
    if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) throw new Error('invalid base64url');
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    errors.push('runtime-receipt:encoding');
    return null;
  }
}

function validateUpgradeReceipt(receipt, candidateSha, errors) {
  if (!exactKeys(receipt, UPGRADE_KEYS)) {
    errors.push('upgrade-receipt:keys');
    return;
  }
  if (receipt.contract !== M6_PREVIOUS_VERSION_UPGRADE_CONTRACT) {
    errors.push('upgrade-receipt:contract');
  }
  if (receipt.version !== M6_PREVIOUS_VERSION_UPGRADE_VERSION) {
    errors.push('upgrade-receipt:version');
  }
  if (!SHA_PATTERN.test(candidateSha || '') || receipt.candidateSha !== candidateSha) {
    errors.push('upgrade-receipt:candidate');
  }
  if (receipt.previousSha !== M6_PREVIOUS_VERSION_SHA) errors.push('upgrade-receipt:previous-sha');
  if (receipt.previousVersion !== M6_PREVIOUS_VERSION) errors.push('upgrade-receipt:previous-version');
  if (receipt.currentVersion !== M6_CURRENT_VERSION) errors.push('upgrade-receipt:current-version');
  if (!SHA256_PATTERN.test(receipt.databaseIdentitySha256 || '')) {
    errors.push('upgrade-receipt:database-identity');
  }
  if (!Number.isSafeInteger(receipt.previousMigrationCount) || receipt.previousMigrationCount <= 0) {
    errors.push('upgrade-receipt:previous-migrations');
  }
  if (
    !Number.isSafeInteger(receipt.currentMigrationCount)
    || receipt.currentMigrationCount <= receipt.previousMigrationCount
  ) errors.push('upgrade-receipt:current-migrations');
  if (!exactKeys(receipt.canary, ['id', 'name', 'survivedUpgrade'])) {
    errors.push('upgrade-receipt:canary-keys');
  } else if (
    !Number.isSafeInteger(receipt.canary.id)
    || receipt.canary.id <= 0
    || receipt.canary.name !== 'M6 Upgrade Canary'
    || receipt.canary.survivedUpgrade !== true
  ) errors.push('upgrade-receipt:canary');
  if (receipt.previousServerCleanShutdown !== true) errors.push('upgrade-receipt:previous-shutdown');
  if (receipt.currentServerCleanShutdown !== true) errors.push('upgrade-receipt:current-shutdown');
  if (receipt.networkScope !== 'loopback-only') errors.push('upgrade-receipt:network-scope');
  if (receipt.verdict !== 'PASS') errors.push('upgrade-receipt:verdict');
}

function validateLongSoakReceipt(receipt, candidateSha, errors) {
  const prefix = 'long-soak-receipt';
  if (!exactKeys(receipt, LONG_SOAK_KEYS)) {
    errors.push(`${prefix}:keys`);
    return;
  }
  if (receipt.contract !== M6_LONG_SOAK_CONTRACT) errors.push(`${prefix}:contract`);
  if (receipt.version !== M6_LONG_SOAK_VERSION) errors.push(`${prefix}:version`);
  validateCandidate(receipt, candidateSha, prefix, errors);
  if (!safeIntegerAtLeast(receipt.durationMs, M6_LONG_SOAK_DURATION_MS)) {
    errors.push(`${prefix}:duration`);
  }
  if (!safeIntegerAtLeast(receipt.requestCount, 80_000)
    || !safeIntegerAtLeast(receipt.healthRequests)
    || !safeIntegerAtLeast(receipt.projectRequests)
    || receipt.healthRequests + receipt.projectRequests !== receipt.requestCount) {
    errors.push(`${prefix}:request-counts`);
  }
  if (receipt.errorCount !== 0) errors.push(`${prefix}:errors`);
  if (!safeIntegerAtLeast(receipt.timerDriftMaxMs)) errors.push(`${prefix}:timer-drift`);
  if (!exactKeys(receipt.budgets, [
    'maximumP95Ms',
    'maximumP99Ms',
    'maximumRssGrowthMiB',
    'maximumRssMiB',
    'minimumRequestCount',
  ]) || receipt.budgets.maximumP95Ms !== 100
    || receipt.budgets.maximumP99Ms !== 250
    || receipt.budgets.maximumRssMiB !== 1_024
    || receipt.budgets.maximumRssGrowthMiB !== 128
    || receipt.budgets.minimumRequestCount !== 80_000) errors.push(`${prefix}:budgets`);
  validateLatency(receipt.latency, {
    samples: receipt.requestCount,
    maximumP95Ms: 100,
    maximumP99Ms: 250,
  }, prefix, errors);
  if (!exactKeys(receipt.rss, ['endMiB', 'growthMiB', 'peakMiB', 'startMiB'])
    || ![receipt.rss?.startMiB, receipt.rss?.peakMiB, receipt.rss?.endMiB]
      .every(item => finiteAtLeast(item, Number.EPSILON))
    || !finiteAtLeast(receipt.rss?.growthMiB)
    || receipt.rss.peakMiB < Math.max(receipt.rss.startMiB, receipt.rss.endMiB)
    || receipt.rss.peakMiB > 1_024
    || receipt.rss.growthMiB > 128
    || Math.abs(
      receipt.rss.growthMiB - Math.max(0, receipt.rss.endMiB - receipt.rss.startMiB)
    ) > 0.002) {
    errors.push(`${prefix}:rss`);
  }
  validateDiagnostics(receipt.diagnostics, prefix, errors);
  if (receipt.diagnostics?.completedRequests !== receipt.requestCount) {
    errors.push(`${prefix}:completed-request-binding`);
  }
  validateRuntimeBoundary(receipt, prefix, errors);
}

function validateThroughputReceipt(receipt, candidateSha, errors) {
  const prefix = 'throughput-receipt';
  if (!exactKeys(receipt, THROUGHPUT_KEYS)) {
    errors.push(`${prefix}:keys`);
    return;
  }
  if (receipt.contract !== M6_MAX_THROUGHPUT_CONTRACT) errors.push(`${prefix}:contract`);
  if (receipt.version !== M6_MAX_THROUGHPUT_VERSION) errors.push(`${prefix}:version`);
  validateCandidate(receipt, candidateSha, prefix, errors);
  if (!safeIntegerAtLeast(receipt.durationMs, M6_MAX_THROUGHPUT_DURATION_MS)) {
    errors.push(`${prefix}:duration`);
  }
  if (receipt.surface !== 'production-public-health-http') errors.push(`${prefix}:surface`);
  const levels = [1, 8, 32, 128, 512, 1_024];
  if (JSON.stringify(receipt.concurrencyLevels) !== JSON.stringify(levels)) {
    errors.push(`${prefix}:concurrency-levels`);
  }
  if (!levels.includes(receipt.selectedConcurrency)) errors.push(`${prefix}:selected-concurrency`);
  if (!(receipt.saturationObserved === true || receipt.ceilingReached === true)) {
    errors.push(`${prefix}:saturation`);
  }
  if (!safeIntegerAtLeast(receipt.probeErrorCount)) errors.push(`${prefix}:probe-errors`);
  if (!Array.isArray(receipt.stages) || receipt.stages.length !== levels.length + 1) {
    errors.push(`${prefix}:stages`);
  } else {
    let sustainedCount = 0;
    for (const [index, stage] of receipt.stages.entries()) {
      if (!exactKeys(stage, [
        'concurrency',
        'durationMs',
        'errorCount',
        'latency',
        'requestsPerSecond',
        'stable',
        'successes',
        'sustained',
      ])) {
        errors.push(`${prefix}:stage-keys`);
        continue;
      }
      if (!levels.includes(stage.concurrency)
        || (index < levels.length && stage.concurrency !== levels[index])
        || !safeIntegerAtLeast(stage.durationMs, 1)
        || !safeIntegerAtLeast(stage.successes)
        || !safeIntegerAtLeast(stage.errorCount)
        || !finiteAtLeast(stage.requestsPerSecond)
        || typeof stage.stable !== 'boolean'
        || typeof stage.sustained !== 'boolean') errors.push(`${prefix}:stage-values`);
      if (stage.requestsPerSecond !== derivedRequestsPerSecond(
        stage.successes,
        stage.durationMs,
      )) errors.push(`${prefix}:stage-rps-binding`);
      if (stage.sustained) sustainedCount += 1;
      validateLatency(stage.latency, {
        samples: stage.successes,
        maximumP95Ms: stage.stable ? 100 : Number.POSITIVE_INFINITY,
        maximumP99Ms: stage.stable ? 250 : Number.POSITIVE_INFINITY,
        allowEmpty: stage.stable === false,
      }, `${prefix}:stage`, errors);
      const derivedStable = stage.successes > 0
        && stage.errorCount === 0
        && stage.latency?.samples === stage.successes
        && stage.latency?.p95Ms <= 100
        && stage.latency?.p99Ms <= 250;
      if (stage.stable !== derivedStable) errors.push(`${prefix}:stage-stability-binding`);
    }
    if (sustainedCount !== 1 || receipt.stages.at(-1).sustained !== true) {
      errors.push(`${prefix}:sustained-stage`);
    }
    const minimumRampStageMs = M6_MAX_THROUGHPUT_RAMP_DURATION_MS / levels.length;
    if (receipt.stages.slice(0, levels.length)
      .some(stage => !safeIntegerAtLeast(stage?.durationMs, minimumRampStageMs))) {
      errors.push(`${prefix}:ramp-duration`);
    }
    if (!safeIntegerAtLeast(
      receipt.stages.at(-1)?.durationMs,
      M6_MAX_THROUGHPUT_SUSTAINED_DURATION_MS,
    )) errors.push(`${prefix}:sustained-duration`);
    const stableRamp = receipt.stages.filter(stage => stage.sustained !== true && stage.stable);
    const selectedRamp = stableRamp.at(-1);
    const unstableAfter = receipt.stages.find(stage => (
      stage.sustained !== true
      && stage.concurrency > (selectedRamp?.concurrency ?? Number.POSITIVE_INFINITY)
      && stage.stable === false
    ));
    if (!selectedRamp || selectedRamp.concurrency !== receipt.selectedConcurrency) {
      errors.push(`${prefix}:selected-stage-binding`);
    }
    if (receipt.ceilingReached !== (receipt.selectedConcurrency === levels.at(-1))
      || receipt.saturationObserved !== (unstableAfter !== undefined)) {
      errors.push(`${prefix}:saturation-binding`);
    }
    const probeErrors = receipt.stages
      .filter(stage => stage.sustained !== true)
      .reduce((total, stage) => total + stage.errorCount, 0);
    if (receipt.probeErrorCount !== probeErrors) errors.push(`${prefix}:probe-error-binding`);
  }
  if (!exactKeys(receipt.sustained, [
    'durationMs',
    'errorCount',
    'latency',
    'requests',
    'requestsPerSecond',
  ])
    || !safeIntegerAtLeast(receipt.sustained?.durationMs, 1)
    || !safeIntegerAtLeast(receipt.sustained?.requests, 1)
    || receipt.sustained?.errorCount !== 0
    || !finiteAtLeast(receipt.sustained?.requestsPerSecond, 500)) {
    errors.push(`${prefix}:sustained`);
  } else {
    validateLatency(receipt.sustained.latency, {
      samples: receipt.sustained.requests,
      maximumP95Ms: 100,
      maximumP99Ms: 250,
    }, `${prefix}:sustained`, errors);
    const stage = Array.isArray(receipt.stages)
      ? receipt.stages.find(item => item.sustained === true)
      : null;
    if (!stage
      || stage.concurrency !== receipt.selectedConcurrency
      || stage.durationMs !== receipt.sustained.durationMs
      || stage.successes !== receipt.sustained.requests
      || stage.errorCount !== receipt.sustained.errorCount
      || stage.requestsPerSecond !== receipt.sustained.requestsPerSecond
      || stage.stable !== true
      || JSON.stringify(stage.latency) !== JSON.stringify(receipt.sustained.latency)) {
      errors.push(`${prefix}:sustained-binding`);
    }
  }
  if (!exactKeys(receipt.rss, [
    'endMiB',
    'growthMiB',
    'measurementError',
    'peakMiB',
    'startMiB',
  ])
    || receipt.rss?.measurementError !== null
    || ![receipt.rss?.startMiB, receipt.rss?.peakMiB, receipt.rss?.endMiB]
      .every(item => finiteAtLeast(item, Number.EPSILON))
    || !finiteAtLeast(receipt.rss?.growthMiB)
    || receipt.rss.peakMiB < Math.max(receipt.rss.startMiB, receipt.rss.endMiB)
    || receipt.rss.peakMiB > 1_536
    || receipt.rss.growthMiB > 512
    || Math.abs(
      receipt.rss.growthMiB - Math.max(0, receipt.rss.endMiB - receipt.rss.startMiB)
    ) > 0.002) {
    errors.push(`${prefix}:rss`);
  }
  if (!exactKeys(receipt.budgets, [
    'maximumP95Ms',
    'maximumP99Ms',
    'maximumRssGrowthMiB',
    'maximumRssMiB',
    'minimumSustainedRequestsPerSecond',
  ]) || receipt.budgets.maximumP95Ms !== 100
    || receipt.budgets.maximumP99Ms !== 250
    || receipt.budgets.maximumRssMiB !== 1_536
    || receipt.budgets.maximumRssGrowthMiB !== 512
    || receipt.budgets.minimumSustainedRequestsPerSecond !== 500) {
    errors.push(`${prefix}:budgets`);
  }
  validateDiagnostics(receipt.diagnostics, prefix, errors);
  const successfulRequests = Array.isArray(receipt.stages)
    ? receipt.stages.reduce((total, stage) => total + (stage.successes || 0), 0)
    : 0;
  const measuredDurationMs = Array.isArray(receipt.stages)
    ? receipt.stages.reduce((total, stage) => total + (stage.durationMs || 0), 0)
    : 0;
  if (receipt.diagnostics?.completedRequests < successfulRequests) {
    errors.push(`${prefix}:completed-request-binding`);
  }
  if (measuredDurationMs < M6_MAX_THROUGHPUT_DURATION_MS
    || measuredDurationMs > receipt.durationMs) errors.push(`${prefix}:stage-duration-binding`);
  validateRuntimeBoundary(receipt, prefix, errors);
}

export function validateM6RuntimeEvidence(programId, logBytes, { candidateSha } = {}) {
  const errors = [];
  if (!M6_RUNTIME_EVIDENCE_PROGRAMS.includes(programId)) {
    errors.push(`runtime-receipt:unsupported-program:${programId}`);
    return Object.freeze({ valid: false, errors: Object.freeze(errors), receipt: null });
  }
  const receipt = extractReceipt(logBytes, errors);
  if (receipt && programId === M6_PREVIOUS_VERSION_UPGRADE_PROGRAM) {
    validateUpgradeReceipt(receipt, candidateSha, errors);
  } else if (receipt && programId === M6_LONG_SOAK_PROGRAM) {
    validateLongSoakReceipt(receipt, candidateSha, errors);
  } else if (receipt && programId === M6_MAX_THROUGHPUT_PROGRAM) {
    validateThroughputReceipt(receipt, candidateSha, errors);
  }
  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    receipt: errors.length === 0 ? Object.freeze(receipt) : null,
  });
}
