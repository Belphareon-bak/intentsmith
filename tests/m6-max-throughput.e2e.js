#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import {
  M6_MAX_THROUGHPUT_CONTRACT,
  M6_MAX_THROUGHPUT_DURATION_MS,
  M6_MAX_THROUGHPUT_RAMP_DURATION_MS,
  M6_MAX_THROUGHPUT_SUSTAINED_DURATION_MS,
  M6_MAX_THROUGHPUT_VERSION,
  M6_RUNTIME_EVIDENCE_MARKER,
} from '../contracts/m6/runtime-evidence-v1.js';
import { isolatedTestRuntime } from './helpers/isolated-test-db.js';
import {
  LatencyHistogram,
  assertLoopbackNetworkNamespace,
  createLoopbackAgent,
  encodeRuntimeReceipt,
  exactCandidateSha,
  readProcessRssMiB,
  reexecInLoopbackNetworkNamespace,
  requestJson,
  startOwnedProductionServer,
  stopOwnedProductionServer,
} from './helpers/m6-owned-runtime-probe.js';

const CONCURRENCY_LEVELS = Object.freeze([1, 8, 32, 128, 512, 1_024]);
const MAX_P95_MS = 100;
const MAX_P99_MS = 250;
const MAX_RSS_MIB = 1_536;
const MAX_RSS_GROWTH_MIB = 512;
const MINIMUM_SUSTAINED_RPS = 500;

function selectedDurationMs() {
  if (process.env.INTENTSMITH_DIRECT_TEST_RUN !== '1') return M6_MAX_THROUGHPUT_DURATION_MS;
  const requested = Number(process.env.INTENTSMITH_M6_DEV_DURATION_MS);
  return Number.isSafeInteger(requested) && requested >= 10_000 && requested <= 120_000
    ? requested
    : M6_MAX_THROUGHPUT_DURATION_MS;
}

function rounded(value) {
  return Math.round(value * 1_000) / 1_000;
}

function stableRampPrefix(stages) {
  const firstUnstableIndex = stages.findIndex(stage => stage.stable !== true);
  return firstUnstableIndex === -1
    ? stages
    : stages.slice(0, firstUnstableIndex);
}

async function runLoadStage({ port, agent, concurrency, durationMs }) {
  const histogram = new LatencyHistogram();
  const errors = [];
  let successes = 0;
  const startedAt = performance.now();
  const deadline = startedAt + durationMs;
  const worker = async () => {
    while (performance.now() < deadline) {
      try {
        const response = await requestJson({ port, pathname: '/api/health', agent });
        histogram.add(response.durationMs);
        if (response.status === 200
          && response.json?.status === 'ok'
          && response.json?.ready === true) successes += 1;
        else errors.push(`HTTP_${response.status}`);
      } catch (error) {
        errors.push(error?.code || error?.message || 'REQUEST_FAILED');
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const actualDurationMs = performance.now() - startedAt;
  const measuredDurationMs = Math.floor(actualDurationMs);
  const latency = histogram.summary();
  return Object.freeze({
    concurrency,
    durationMs: measuredDurationMs,
    successes,
    errorCount: errors.length,
    // Derive the declared rate from the exact integer duration carried by the
    // receipt, so the independent validator can recompute it byte-for-byte.
    requestsPerSecond: rounded(successes / (measuredDurationMs / 1_000)),
    latency,
    stable: errors.length === 0
      && latency.samples === successes
      && latency.p95Ms <= MAX_P95_MS
      && latency.p99Ms <= MAX_P99_MS,
    errorSamples: Object.freeze(errors.slice(0, 10)),
  });
}

async function runMaximumThroughput() {
  const namespace = assertLoopbackNetworkNamespace();
  const candidateSha = exactCandidateSha();
  const selectedDuration = selectedDurationMs();
  const evidenceEligible = selectedDuration === M6_MAX_THROUGHPUT_DURATION_MS;
  const server = await startOwnedProductionServer({
    root: isolatedTestRuntime.repositoryRoot,
    runtime: isolatedTestRuntime,
    adminToken: 'm6-throughput-owned-admin-token',
  });
  const agent = createLoopbackAgent(CONCURRENCY_LEVELS.at(-1));
  const rssStartMiB = readProcessRssMiB(server.child.pid);
  let rssPeakMiB = rssStartMiB;
  let rssEndMiB = rssStartMiB;
  let rssMeasurementError = null;
  const rssTimer = setInterval(() => {
    try {
      rssPeakMiB = Math.max(rssPeakMiB, readProcessRssMiB(server.child.pid));
    } catch (error) {
      rssMeasurementError ||= error?.code || error?.message || 'RSS_READ_FAILED';
    }
  }, 250);
  let shutdown = { clean: false, forced: false };
  let diagnostics = null;
  const stages = [];
  const startedMonotonic = performance.now();

  try {
    const rampBudgetMs = evidenceEligible
      ? M6_MAX_THROUGHPUT_RAMP_DURATION_MS
      : Math.floor(selectedDuration * 0.45);
    const perStageMs = Math.max(1_000, Math.floor(rampBudgetMs / CONCURRENCY_LEVELS.length));
    for (const concurrency of CONCURRENCY_LEVELS) {
      stages.push(await runLoadStage({
        port: server.authority.port,
        agent,
        concurrency,
        durationMs: perStageMs,
      }));
    }
    const stableStages = stableRampPrefix(stages);
    assert(stableStages.length > 0, JSON.stringify(stages));
    const selected = stableStages.at(-1);
    const elapsed = performance.now() - startedMonotonic;
    const sustainDurationMs = evidenceEligible
      ? M6_MAX_THROUGHPUT_SUSTAINED_DURATION_MS
      : Math.max(1_000, selectedDuration - elapsed);
    stages.push(Object.freeze({
      ...(await runLoadStage({
        port: server.authority.port,
        agent,
        concurrency: selected.concurrency,
        durationMs: sustainDurationMs,
      })),
      sustained: true,
    }));
    const diagnosticResponse = await requestJson({
      port: server.authority.port,
      pathname: '/api/system/diagnostics',
      headers: { authorization: 'Bearer m6-throughput-owned-admin-token' },
      agent,
    });
    assert.equal(diagnosticResponse.status, 200, diagnosticResponse.raw);
    diagnostics = diagnosticResponse.json;
    rssEndMiB = readProcessRssMiB(server.child.pid);
    rssPeakMiB = Math.max(rssPeakMiB, rssEndMiB);
  } finally {
    clearInterval(rssTimer);
    agent.destroy();
    shutdown = await stopOwnedProductionServer(server);
  }

  const durationMs = Math.floor(performance.now() - startedMonotonic);
  const rssGrowthMiB = Math.max(0, rssEndMiB - rssStartMiB);
  const rampStages = stages.filter(stage => stage.sustained !== true);
  const stableRampStages = stableRampPrefix(rampStages);
  const selectedRamp = stableRampStages.at(-1);
  const sustained = stages.find(stage => stage.sustained === true);
  const firstUnstableAfterSelected = rampStages[stableRampStages.length];
  const ceilingReached = stableRampStages.length === CONCURRENCY_LEVELS.length;
  const probeErrorCount = stages
    .filter(stage => stage.sustained !== true)
    .reduce((total, stage) => total + stage.errorCount, 0);
  const outboundDecisionCount = Object.values(diagnostics?.outbound?.decisions || {})
    .reduce((total, count) => total + Number(count || 0), 0);
  const budgetsPassed = rssMeasurementError === null
    && sustained?.stable === true
    && sustained.requestsPerSecond >= MINIMUM_SUSTAINED_RPS
    && sustained.latency.p95Ms <= MAX_P95_MS
    && sustained.latency.p99Ms <= MAX_P99_MS
    && rssPeakMiB <= MAX_RSS_MIB
    && rssGrowthMiB <= MAX_RSS_GROWTH_MIB
    && diagnostics?.readiness?.database === true
    && diagnostics?.readiness?.lifecycleRecovery?.complete === true
    && diagnostics?.http?.activeRequests <= 1
    && diagnostics?.http?.statusCounts?.['5xx'] === 0
    && outboundDecisionCount === 0
    && shutdown.clean === true
    && shutdown.forced === false
    && (firstUnstableAfterSelected !== undefined || ceilingReached);
  const acceptancePassed = budgetsPassed
    && evidenceEligible
    && durationMs >= M6_MAX_THROUGHPUT_DURATION_MS;
  const receipt = {
    contract: M6_MAX_THROUGHPUT_CONTRACT,
    version: M6_MAX_THROUGHPUT_VERSION,
    candidateSha,
    durationMs,
    surface: 'production-public-health-http',
    concurrencyLevels: [...CONCURRENCY_LEVELS],
    selectedConcurrency: selectedRamp.concurrency,
    saturationObserved: firstUnstableAfterSelected !== undefined,
    ceilingReached,
    probeErrorCount,
    stages: stages.map(stage => ({
      concurrency: stage.concurrency,
      durationMs: stage.durationMs,
      successes: stage.successes,
      errorCount: stage.errorCount,
      requestsPerSecond: stage.requestsPerSecond,
      latency: stage.latency,
      stable: stage.stable,
      sustained: stage.sustained === true,
    })),
    sustained: {
      durationMs: sustained.durationMs,
      requests: sustained.successes,
      errorCount: sustained.errorCount,
      requestsPerSecond: sustained.requestsPerSecond,
      latency: sustained.latency,
    },
    rss: {
      startMiB: rounded(rssStartMiB),
      peakMiB: rounded(rssPeakMiB),
      endMiB: rounded(rssEndMiB),
      growthMiB: rounded(rssGrowthMiB),
      measurementError: rssMeasurementError,
    },
    diagnostics: {
      activeRequests: diagnostics?.http?.activeRequests ?? null,
      completedRequests: diagnostics?.http?.completedRequests ?? null,
      http5xx: diagnostics?.http?.statusCounts?.['5xx'] ?? null,
      outboundDecisionCount,
      databaseReady: diagnostics?.readiness?.database ?? null,
      lifecycleRecoveryComplete: diagnostics?.readiness?.lifecycleRecovery?.complete ?? null,
    },
    networkScope: 'linux-user-network-namespace-loopback-only',
    namespaceInterfaces: [...namespace.interfaceNames],
    serverCleanShutdown: shutdown.clean,
    forcedShutdown: shutdown.forced,
    budgets: {
      maximumP95Ms: MAX_P95_MS,
      maximumP99Ms: MAX_P99_MS,
      maximumRssMiB: MAX_RSS_MIB,
      maximumRssGrowthMiB: MAX_RSS_GROWTH_MIB,
      minimumSustainedRequestsPerSecond: MINIMUM_SUSTAINED_RPS,
    },
    verdict: acceptancePassed ? 'PASS' : evidenceEligible ? 'FAIL' : 'DEV_ONLY',
  };
  process.stdout.write(`${encodeRuntimeReceipt(M6_RUNTIME_EVIDENCE_MARKER, receipt)}\n`);
  assert.equal(budgetsPassed, true, JSON.stringify(receipt));
  if (evidenceEligible) assert.equal(acceptancePassed, true, JSON.stringify(receipt));
}

if (!(await reexecInLoopbackNetworkNamespace(import.meta.url))) {
  await runMaximumThroughput();
}
