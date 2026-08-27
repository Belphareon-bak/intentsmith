#!/usr/bin/env node

import './helpers/isolated-test-db.js';

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';

import {
  M6_LONG_SOAK_CONTRACT,
  M6_LONG_SOAK_DURATION_MS,
  M6_LONG_SOAK_VERSION,
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

const REQUEST_INTERVAL_MS = 1_000;
const RSS_SAMPLE_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1_000;
const MAX_P95_MS = 100;
const MAX_P99_MS = 250;
const MAX_RSS_MIB = 1_024;
const MAX_RSS_GROWTH_MIB = 128;
const MINIMUM_ACCEPTANCE_REQUESTS = 80_000;

function selectedDurationMs() {
  if (process.env.INTENTSMITH_DIRECT_TEST_RUN !== '1') return M6_LONG_SOAK_DURATION_MS;
  const requested = Number(process.env.INTENTSMITH_M6_DEV_DURATION_MS);
  return Number.isSafeInteger(requested) && requested >= 5_000 && requested <= 600_000
    ? requested
    : M6_LONG_SOAK_DURATION_MS;
}

function rounded(value) {
  return Math.round(value * 1_000) / 1_000;
}

async function runLongSoak() {
  const namespace = assertLoopbackNetworkNamespace();
  const candidateSha = exactCandidateSha();
  const selectedDuration = selectedDurationMs();
  const evidenceEligible = selectedDuration === M6_LONG_SOAK_DURATION_MS;
  const adminToken = 'm6-long-soak-owned-admin-token';
  const server = await startOwnedProductionServer({
    root: isolatedTestRuntime.repositoryRoot,
    runtime: isolatedTestRuntime,
    adminToken,
  });
  const agent = createLoopbackAgent(8);
  const histogram = new LatencyHistogram();
  const errors = [];
  let requestCount = 0;
  let healthRequests = 0;
  let projectRequests = 0;
  let timerDriftMaxMs = 0;
  let shutdown = { clean: false, forced: false };
  const rssStartMiB = readProcessRssMiB(server.child.pid);
  let rssPeakMiB = rssStartMiB;
  let rssEndMiB = rssStartMiB;
  let diagnostics = null;
  const startedMonotonic = performance.now();
  let nextRequestAt = startedMonotonic;
  let nextRssAt = startedMonotonic;
  let nextHeartbeatAt = startedMonotonic + HEARTBEAT_INTERVAL_MS;

  try {
    while (performance.now() - startedMonotonic < selectedDuration) {
      const projectRead = requestCount % 2 === 1;
      try {
        const response = await requestJson({
          port: server.authority.port,
          pathname: projectRead ? '/api/projects' : '/api/health',
          headers: projectRead
            ? { 'x-intentsmith-local-capability': server.authority.localCapability }
            : {},
          agent,
        });
        histogram.add(response.durationMs);
        requestCount += 1;
        if (projectRead) projectRequests += 1;
        else healthRequests += 1;
        if (response.status !== 200
          || response.json === null
          || (!projectRead && (response.json.status !== 'ok' || response.json.ready !== true))
          || (projectRead && !Array.isArray(response.json.projects))) {
          errors.push(`HTTP_${response.status}:${projectRead ? 'projects' : 'health'}`);
        }
      } catch (error) {
        requestCount += 1;
        errors.push(error?.code || error?.message || 'REQUEST_FAILED');
      }

      const now = performance.now();
      if (now >= nextRssAt) {
        rssEndMiB = readProcessRssMiB(server.child.pid);
        rssPeakMiB = Math.max(rssPeakMiB, rssEndMiB);
        nextRssAt = now + RSS_SAMPLE_INTERVAL_MS;
      }
      if (now >= nextHeartbeatAt) {
        process.stdout.write(
          `M6_LONG_SOAK_HEARTBEAT elapsedMs=${Math.floor(now - startedMonotonic)} requests=${requestCount} errors=${errors.length}\n`,
        );
        nextHeartbeatAt = now + HEARTBEAT_INTERVAL_MS;
      }
      nextRequestAt += evidenceEligible ? REQUEST_INTERVAL_MS : 50;
      timerDriftMaxMs = Math.max(timerDriftMaxMs, now - nextRequestAt);
      await delay(Math.max(0, nextRequestAt - performance.now()));
    }

    rssEndMiB = readProcessRssMiB(server.child.pid);
    rssPeakMiB = Math.max(rssPeakMiB, rssEndMiB);
    const response = await requestJson({
      port: server.authority.port,
      pathname: '/api/system/diagnostics',
      headers: { authorization: `Bearer ${adminToken}` },
      agent,
    });
    assert.equal(response.status, 200, response.raw);
    diagnostics = response.json;
  } finally {
    agent.destroy();
    shutdown = await stopOwnedProductionServer(server);
  }

  const durationMs = Math.floor(performance.now() - startedMonotonic);
  const latency = histogram.summary();
  const outboundDecisionCount = Object.values(diagnostics?.outbound?.decisions || {})
    .reduce((total, count) => total + Number(count || 0), 0);
  const rssGrowthMiB = Math.max(0, rssEndMiB - rssStartMiB);
  const budgetsPassed = errors.length === 0
    && latency.samples === requestCount
    && latency.p95Ms <= MAX_P95_MS
    && latency.p99Ms <= MAX_P99_MS
    && rssPeakMiB <= MAX_RSS_MIB
    && rssGrowthMiB <= MAX_RSS_GROWTH_MIB
    && diagnostics?.readiness?.database === true
    && diagnostics?.readiness?.lifecycleRecovery?.complete === true
    && diagnostics?.http?.activeRequests <= 1
    && diagnostics?.http?.statusCounts?.['5xx'] === 0
    && outboundDecisionCount === 0
    && shutdown.clean === true
    && shutdown.forced === false;
  const acceptancePassed = budgetsPassed
    && evidenceEligible
    && durationMs >= M6_LONG_SOAK_DURATION_MS
    && requestCount >= MINIMUM_ACCEPTANCE_REQUESTS;
  const receipt = {
    contract: M6_LONG_SOAK_CONTRACT,
    version: M6_LONG_SOAK_VERSION,
    candidateSha,
    durationMs,
    requestCount,
    healthRequests,
    projectRequests,
    errorCount: errors.length,
    latency,
    rss: {
      startMiB: rounded(rssStartMiB),
      peakMiB: rounded(rssPeakMiB),
      endMiB: rounded(rssEndMiB),
      growthMiB: rounded(rssGrowthMiB),
    },
    timerDriftMaxMs: Math.ceil(timerDriftMaxMs),
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
      minimumRequestCount: MINIMUM_ACCEPTANCE_REQUESTS,
    },
    verdict: acceptancePassed ? 'PASS' : evidenceEligible ? 'FAIL' : 'DEV_ONLY',
  };
  process.stdout.write(`${encodeRuntimeReceipt(M6_RUNTIME_EVIDENCE_MARKER, receipt)}\n`);
  assert.equal(budgetsPassed, true, JSON.stringify({ receipt, errors: errors.slice(0, 20) }));
  if (evidenceEligible) assert.equal(acceptancePassed, true, JSON.stringify(receipt));
}

if (!(await reexecInLoopbackNetworkNamespace(import.meta.url))) {
  await runLongSoak();
}
